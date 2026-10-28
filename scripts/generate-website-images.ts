/**
 * Bakes the images the web page itself ships, into `src/images/website/`: the
 * link-share card every social site and chat app previews, the install
 * screenshots the PWA manifest offers, and the favicon / home-screen icon set.
 *
 * Everything is painted from the game's own art — a dungeon floor rendered by
 * `render-dungeon.ts` with the human, the cat and goblins painted from their figure
 * painters on top — so the card shows the game as it looks rather than a mock
 * of it. The icons are resampled from the goblin icon, `icon-512.png`.
 *
 *   npm run gen:website-images
 *
 * The outputs are committed product art, so this only needs re-running when
 * the look of the game has moved far enough that the card no longer matches.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas, loadImage, type Canvas, type Image } from 'canvas';

import { paintFigureCell } from './figureSheet.js';
import { PREVIEW_DIR } from './previewOut.js';
import { figureBakeDensity, type FigureDef } from '../src/sprites/figure/figureDef.js';
import { humanFigureWearing } from '../src/sprites/art/human/appearance.js';
import { defaultOutfitOf } from '../src/sprites/garments/human/humanDressing.js';
import { humanLookFlag } from './humanLooks.js';
import { catFigureFor, PLAYER_CAT_LOOK } from '../src/sprites/art/catFigure.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import { GOBLIN_AXE_FIGURE, GOBLIN_SWORD_FIGURE } from '../src/sprites/art/goblinFigure.js';
import { UI_FONT_FAMILY } from '../src/ui/theme/fonts.js';

const WEBSITE_DIR = 'src/images/website';
const BACKDROP_DIR = `${PREVIEW_DIR}/website-images`;

// ── The backdrop ─────────────────────────────────────────────────────────────

/**
 * A lit cell-block room on the first floor whose torch sits mid-wall, which is
 * what gives the card its warm pool of light. The seed fixes the layout; the
 * tile window is that room's north wall and the floor in front of it.
 */
const BACKDROP_LEVEL = 1;
const BACKDROP_SEED = 7;
const BACKDROP_RENDER_SCALE = 3;
/** Pixels per tile in the rendered backdrop: the game's 32 px tile at the render scale. */
const BACKDROP_TILE_PX = 32 * BACKDROP_RENDER_SCALE;

interface TileWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const LANDSCAPE_WINDOW: TileWindow = { x: 209, y: 419, w: 14, h: 8 };
const PORTRAIT_WINDOW: TileWindow = { x: 211, y: 419, w: 8, h: 14 };

function renderBackdrop(name: string, window: TileWindow): string {
  const out = resolve(`${BACKDROP_DIR}/${name}.png`);
  execFileSync(
    'npx',
    [
      'tsx',
      'scripts/render-dungeon.ts',
      `--level=${BACKDROP_LEVEL}`,
      `--seed=${BACKDROP_SEED}`,
      '--props',
      '--lighting',
      '--life',
      `--x=${window.x}`,
      `--y=${window.y}`,
      `--w=${window.w}`,
      `--h=${window.h}`,
      `--scale=${BACKDROP_RENDER_SCALE}`,
      `--out=${out}`,
    ],
    { stdio: 'inherit' },
  );
  return out;
}

// ── Figures ──────────────────────────────────────────────────────────────────

/** The human crawler the images show: `--look=<id>`, Ryan's by default. */
const HUMAN_LOOK = humanLookFlag();
const HUMAN = humanFigureWearing(HUMAN_LOOK, defaultOutfitOf(HUMAN_LOOK));
const CAT = catFigureFor(PLAYER_CAT_LOOK, outfitOf(PLAYER_CAT_LOOK, []));

interface FigurePlacement {
  readonly figure: FigureDef;
  readonly state: string;
  readonly frame: number;
  /** Where the figure's tile centre lands, as a fraction of the canvas. */
  readonly at: { readonly x: number; readonly y: number };
  readonly mirrored: boolean;
}

/** One cell painted at `density`, supersampled first exactly as the runtime cache bakes it. */
function paintFigure(def: FigureDef, state: string, frame: number, density: number): Canvas {
  const bakeDensity = figureBakeDensity(def);
  const painted = paintFigureCell(def, state, frame, density * bakeDensity);
  if (bakeDensity === 1) return painted;
  const cell = createCanvas(
    Math.ceil(def.frameWidth * density),
    Math.ceil(def.frameHeight * density),
  );
  const ctx = cell.getContext('2d');
  ctx.quality = 'best';
  ctx.drawImage(painted, 0, 0, cell.width, cell.height);
  return cell;
}

/**
 * Figures are drawn a little larger than the floor tiles under them would
 * make them: at true scale a crawler is a speck on a 1200 px card, and a
 * thumbnail in a chat app shrinks that card to a third.
 */
const FIGURE_HERO_SCALE = 1.7;

function drawFigures(
  ctx: ReturnType<Canvas['getContext']>,
  canvas: Canvas,
  placements: readonly FigurePlacement[],
  tilePx: number,
): void {
  const ordered = [...placements].sort((a, b) => a.at.y - b.at.y);
  for (const placement of ordered) {
    const { figure } = placement;
    const density = (tilePx / figure.tileScale) * FIGURE_HERO_SCALE;
    const cell = paintFigure(figure, placement.state, placement.frame, density);
    const tileCentreX = (figure.tileX + figure.tileScale / 2) * density;
    const tileCentreY = (figure.tileY + figure.tileScale / 2) * density;
    const x = placement.at.x * canvas.width;
    const y = placement.at.y * canvas.height;
    ctx.save();
    ctx.translate(x, y);
    if (placement.mirrored) ctx.scale(-1, 1);
    ctx.drawImage(cell, -tileCentreX, -tileCentreY);
    ctx.restore();
  }
}

/** Scales the backdrop to cover the canvas, anchored at `focusY` (0 top, 1 bottom). */
function drawCover(
  ctx: ReturnType<Canvas['getContext']>,
  canvas: Canvas,
  image: Image,
  focusY: number,
): number {
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  const offsetX = (canvas.width - drawnWidth) / 2;
  const offsetY = (canvas.height - drawnHeight) * focusY;
  ctx.drawImage(image, offsetX, offsetY, drawnWidth, drawnHeight);
  return BACKDROP_TILE_PX * scale;
}

// ── The share card ───────────────────────────────────────────────────────────

/** The size every major preview (Open Graph, X, LinkedIn, Discord, Slack) is designed around. */
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const TITLE = 'KITTEN CRAWLER WORLD';
const TAGLINE = 'A man and his cat versus a very hostile dungeon';
const CALL_TO_ACTION = 'Free  ·  Plays in your browser';

const INK_GOLD = '#f2c14e';
const INK_GOLD_SHADOW = '#5a3a08';
const INK_CREAM = '#f3e9d6';
const INK_PILL_TEXT = '#1b1208';
const VIGNETTE_DARK = 'rgba(6, 4, 3, 0.92)';
const VIGNETTE_CLEAR = 'rgba(6, 4, 3, 0)';
const EDGE_SHADE = 'rgba(0, 0, 0, 0.55)';

const TITLE_FONT_PX = 82;
const TAGLINE_FONT_PX = 30;
const PILL_FONT_PX = 24;
const TITLE_TOP_PX = 46;
const TAGLINE_GAP_PX = 18;
const TITLE_SHADOW_OFFSET_PX = 5;
const PILL_PADDING_X = 22;
const PILL_HEIGHT = 46;
const PILL_MARGIN = 30;
/** How far down the card the top fade reaches before the scene shows through clean. */
const TOP_FADE_STOP = 0.5;

/** The human and the cat squaring up to two goblins across the torchlit floor. */
const CARD_CAST: readonly FigurePlacement[] = [
  { figure: HUMAN, state: 'guard_side', frame: 2, at: { x: 0.4, y: 0.66 }, mirrored: false },
  { figure: CAT, state: 'cast_side', frame: 3, at: { x: 0.31, y: 0.73 }, mirrored: false },
  {
    figure: GOBLIN_SWORD_FIGURE,
    state: 'walk',
    frame: 2,
    at: { x: 0.63, y: 0.68 },
    mirrored: true,
  },
  {
    figure: GOBLIN_AXE_FIGURE,
    state: 'idle',
    frame: 4,
    at: { x: 0.76, y: 0.76 },
    mirrored: true,
  },
];

function fontOf(px: number, weight: number): string {
  return `${weight} ${px}px "${UI_FONT_FAMILY}"`;
}

const TITLE_WEIGHT = 800;
const TAGLINE_WEIGHT = 600;
const PILL_WEIGHT = 700;

async function bakeShareCard(backdropPath: string): Promise<Canvas> {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  const backdrop = await loadImage(backdropPath);
  const tilePx = drawCover(ctx, canvas, backdrop, 1);

  const topFade = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT * TOP_FADE_STOP);
  topFade.addColorStop(0, VIGNETTE_DARK);
  topFade.addColorStop(1, VIGNETTE_CLEAR);
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const edgeShade = ctx.createRadialGradient(
    CARD_WIDTH / 2,
    CARD_HEIGHT * 0.6,
    CARD_HEIGHT * 0.35,
    CARD_WIDTH / 2,
    CARD_HEIGHT * 0.6,
    CARD_WIDTH * 0.75,
  );
  edgeShade.addColorStop(0, VIGNETTE_CLEAR);
  edgeShade.addColorStop(1, EDGE_SHADE);
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawFigures(ctx, canvas, CARD_CAST, tilePx);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = fontOf(TITLE_FONT_PX, TITLE_WEIGHT);
  ctx.fillStyle = INK_GOLD_SHADOW;
  ctx.fillText(TITLE, CARD_WIDTH / 2, TITLE_TOP_PX + TITLE_SHADOW_OFFSET_PX);
  ctx.fillStyle = INK_GOLD;
  ctx.fillText(TITLE, CARD_WIDTH / 2, TITLE_TOP_PX);

  ctx.font = fontOf(TAGLINE_FONT_PX, TAGLINE_WEIGHT);
  ctx.fillStyle = INK_CREAM;
  ctx.fillText(TAGLINE, CARD_WIDTH / 2, TITLE_TOP_PX + TITLE_FONT_PX + TAGLINE_GAP_PX);

  ctx.font = fontOf(PILL_FONT_PX, PILL_WEIGHT);
  const pillWidth = ctx.measureText(CALL_TO_ACTION).width + PILL_PADDING_X * 2;
  const pillX = (CARD_WIDTH - pillWidth) / 2;
  const pillY = CARD_HEIGHT - PILL_MARGIN - PILL_HEIGHT;
  ctx.fillStyle = INK_GOLD;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2);
  ctx.fill();
  ctx.fillStyle = INK_PILL_TEXT;
  ctx.textBaseline = 'middle';
  ctx.fillText(CALL_TO_ACTION, pillX + pillWidth / 2, pillY + PILL_HEIGHT / 2);

  return canvas;
}

// ── Install screenshots ──────────────────────────────────────────────────────

const WIDE_SHOT = { width: 1280, height: 720 } as const;
const NARROW_SHOT = { width: 720, height: 1280 } as const;

const WIDE_CAST: readonly FigurePlacement[] = [
  { figure: HUMAN, state: 'jab_side', frame: 3, at: { x: 0.42, y: 0.62 }, mirrored: false },
  { figure: CAT, state: 'idle_side', frame: 0, at: { x: 0.3, y: 0.74 }, mirrored: false },
  {
    figure: GOBLIN_SWORD_FIGURE,
    state: 'attack_light',
    frame: 3,
    at: { x: 0.56, y: 0.63 },
    mirrored: true,
  },
];

const NARROW_CAST: readonly FigurePlacement[] = [
  { figure: HUMAN, state: 'idle', frame: 0, at: { x: 0.45, y: 0.55 }, mirrored: false },
  { figure: CAT, state: 'idle', frame: 0, at: { x: 0.68, y: 0.6 }, mirrored: false },
  {
    figure: GOBLIN_SWORD_FIGURE,
    state: 'idle',
    frame: 0,
    at: { x: 0.5, y: 0.82 },
    mirrored: false,
  },
];

async function bakeScreenshot(
  backdropPath: string,
  size: { readonly width: number; readonly height: number },
  cast: readonly FigurePlacement[],
): Promise<Canvas> {
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const backdrop = await loadImage(backdropPath);
  const tilePx = drawCover(ctx, canvas, backdrop, 1);
  drawFigures(ctx, canvas, cast, tilePx);
  return canvas;
}

// ── Icons ────────────────────────────────────────────────────────────────────

const ICON_SOURCE = `${WEBSITE_DIR}/icon-512.png`;
/** The source icon has a one-pixel keyline at its edge that turns to a smudge when shrunk. */
const ICON_SOURCE_INSET_PX = 4;
/**
 * How far each icon zooms into the source, whose goblin fills only the middle
 * two thirds of its square. A favicon is a handful of pixels, so it crops in
 * until the ear tips nearly touch the edges. A maskable icon may be cut to any
 * shape inside its central 80 % circle, which the source's own framing already
 * keeps the ears inside, so it is not zoomed at all.
 */
const FAVICON_ZOOM = 1.4;
const HOME_SCREEN_ZOOM = 1.2;
const MASKABLE_ZOOM = 1;
const ICON_BACKGROUND = '#323d52';

/** Halves repeatedly before the final step, so a 512 → 16 shrink keeps detail instead of aliasing. */
function resample(source: Canvas | Image, size: number, zoom: number): Canvas {
  let current: Canvas | Image = source;
  let currentWidth = source.width;
  while (currentWidth / 2 >= size * zoom) {
    const half = createCanvas(Math.round(currentWidth / 2), Math.round(currentWidth / 2));
    const halfCtx = half.getContext('2d');
    halfCtx.quality = 'best';
    halfCtx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
    currentWidth = half.width;
  }
  const out = createCanvas(size, size);
  const ctx = out.getContext('2d');
  ctx.fillStyle = ICON_BACKGROUND;
  ctx.fillRect(0, 0, size, size);
  ctx.quality = 'best';
  const drawn = size * zoom;
  const inset = (size - drawn) / 2;
  ctx.drawImage(current, inset, inset, drawn, drawn);
  return out;
}

function insetSource(image: Image): Canvas {
  const side = image.width - ICON_SOURCE_INSET_PX * 2;
  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ICON_BACKGROUND;
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(image, -ICON_SOURCE_INSET_PX, -ICON_SOURCE_INSET_PX);
  return canvas;
}

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICO_TYPE_ICON = 1;
const ICO_COLOR_PLANES = 1;
const ICO_BITS_PER_PIXEL = 32;
/** An ICO directory stores 256 as 0, since its size fields are one byte. */
const ICO_MAX_DIMENSION = 256;

/** Packs PNG images into one `.ico`, which every browser and Windows reads natively. */
function packIco(pngs: ReadonlyArray<{ readonly size: number; readonly png: Buffer }>): Buffer {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(ICO_TYPE_ICON, 2);
  header.writeUInt16LE(pngs.length, 4);
  const directory = Buffer.alloc(ICO_ENTRY_BYTES * pngs.length);
  let offset = ICO_HEADER_BYTES + directory.length;
  pngs.forEach(({ size, png }, index) => {
    const entry = index * ICO_ENTRY_BYTES;
    const dimension = size >= ICO_MAX_DIMENSION ? 0 : size;
    directory.writeUInt8(dimension, entry);
    directory.writeUInt8(dimension, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(ICO_COLOR_PLANES, entry + 4);
    directory.writeUInt16LE(ICO_BITS_PER_PIXEL, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...pngs.map(({ png }) => png)]);
}

const ICO_SIZES = [16, 32, 48] as const;
const FAVICON_PNG_SIZES = [16, 32] as const;
const APPLE_TOUCH_ICON_SIZE = 180;
const MANIFEST_ICON_SIZES = [192, 512] as const;

// ── Output ───────────────────────────────────────────────────────────────────

/** Share cards are photographic; JPEG at this quality keeps the card well under the 300 KB some scrapers cap at. */
const JPEG_QUALITY = 0.86;
const BYTES_PER_KB = 1024;

function write(name: string, buffer: Buffer): void {
  const path = `${WEBSITE_DIR}/${name}`;
  writeFileSync(path, buffer);
  console.log(`${path}  ${(statSync(path).size / BYTES_PER_KB).toFixed(1)} KB`);
}

function jpeg(canvas: Canvas): Buffer {
  return canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
}

mkdirSync(BACKDROP_DIR, { recursive: true });
const landscapeBackdrop = renderBackdrop('landscape', LANDSCAPE_WINDOW);
const portraitBackdrop = renderBackdrop('portrait', PORTRAIT_WINDOW);

write('share-card.jpg', jpeg(await bakeShareCard(landscapeBackdrop)));
write('screenshot-wide.jpg', jpeg(await bakeScreenshot(landscapeBackdrop, WIDE_SHOT, WIDE_CAST)));
write(
  'screenshot-narrow.jpg',
  jpeg(await bakeScreenshot(portraitBackdrop, NARROW_SHOT, NARROW_CAST)),
);

const iconSource = insetSource(await loadImage(ICON_SOURCE));
const icoImages = ICO_SIZES.map((size) => ({
  size,
  png: resample(iconSource, size, FAVICON_ZOOM).toBuffer('image/png'),
}));
write('favicon.ico', packIco(icoImages));
for (const size of FAVICON_PNG_SIZES) {
  write(`favicon-${size}.png`, resample(iconSource, size, FAVICON_ZOOM).toBuffer('image/png'));
}
write(
  'apple-touch-icon.png',
  resample(iconSource, APPLE_TOUCH_ICON_SIZE, HOME_SCREEN_ZOOM).toBuffer('image/png'),
);
for (const size of MANIFEST_ICON_SIZES) {
  write(`icon-any-${size}.png`, resample(iconSource, size, HOME_SCREEN_ZOOM).toBuffer('image/png'));
  write(
    `icon-maskable-${size}.png`,
    resample(iconSource, size, MASKABLE_ZOOM).toBuffer('image/png'),
  );
}
