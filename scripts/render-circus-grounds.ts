/**
 * Headless review render of the circus grounds on the real generated third
 * floor, at game scale (32 px a tile), through the game's real ground and
 * decoration renderers in the Y-sorted order `RenderPipeline` draws in.
 *
 * Carl and Donut stand at the Big Top's door, a fat clown on the forecourt and
 * a stilt clown in the east field, so every tent and prop is judged against
 * the bodies that fight round it. The quest's own cast for the chosen stage
 * (Signet, and in the assault the first wave) is stood up by a real
 * `CircusQuestSystem` and drawn too.
 *
 *   npm run render:circus-grounds
 *   npx tsx scripts/render-circus-grounds.ts --stage=assault
 *   npx tsx scripts/render-circus-grounds.ts --seeds=7919,15838 --stage=redeemed
 *   npx tsx scripts/render-circus-grounds.ts --label=after
 *   npx tsx scripts/render-circus-grounds.ts --time=3.2   # the live ambience's clock, in seconds
 *   npx tsx scripts/render-circus-grounds.ts --sheet      # also lay each "before" beside this render
 *
 * Seeds default to the first of a sweep that each reach the grounds from a
 * different heading, so every approach the road can take is looked at.
 *
 * Writes `preview/circus-grounds-<seed>-<stage>.png`. The first render of a
 * seed and stage is also kept as `preview/circus-grounds-before-<seed>-<stage>.png`
 * and never overwritten, so a later render can be laid beside it; `--label=`
 * writes `preview/circus-grounds-<label>-<seed>-<stage>.png` instead (and
 * `--label=before` replaces the kept copy on purpose).
 */

import { copyFileSync, existsSync } from 'node:fs';
import { createCanvas, loadImage, type Canvas } from 'canvas';

import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;

/** Retina, so the sheets render at the resolution they were baked at — see `render-town.ts`. */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { loadSprites } = await import('../src/core/SpriteLoader');
const { renderCanvas } = await import('../src/map/TileRenderer');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { worldText } = await import('../src/ui/world/worldText');
const { findNearbyWalkableTile } = await import('../src/map/findWalkableTile');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer');
const { CatPlayer } = await import('../src/creatures/CatPlayer');
const { FatClown } = await import('../src/creatures/FatClown');
const { StiltClown } = await import('../src/creatures/StiltClown');
const { buildCircusSite, buildQuestRig, approachHeading } =
  await import('./verifyCircusGrounds/site.js');
const { CircusGroundsAmbience } = await import('../src/systems/circus/CircusGroundsAmbience');
const { isCircusResolvedStage } = await import('../src/core/CircusQuestProgress');

type CircusSite = Exclude<ReturnType<typeof buildCircusSite>, string>;
type CircusQuestStage = Parameters<typeof buildQuestRig>[1];

const SEED_STRIDE = 7919;
/** Seeds swept for distinct approach headings when none are given. */
const HEADING_SWEEP_SEEDS = 40;
/** The fewest seeds rendered by default, whatever the headings turn out to be. */
const MIN_DEFAULT_SEEDS = 3;
/** Tiles of wilderness framed round the grounds' disc. */
const FRAME_MARGIN_TILES = 3;
/** Game scale: one tile is drawn at `TILE_SIZE` pixels. */
const RENDER_SCALE = 1;
const TITLE_X = 12;
const TITLE_Y = 10;
const BEFORE_LABEL = 'before';

const STAGES = {
  'pre-quest': 'not_started',
  assault: 'assault',
  redeemed: 'grimaldi_redeemed',
} as const satisfies Readonly<Record<string, CircusQuestStage>>;
type StageName = keyof typeof STAGES;

function isStageName(value: string): value is StageName {
  return Object.keys(STAGES).some((name) => name === value);
}

/** Where the scale figures stand, as offsets: the door's for the crawlers, the centre's for the clowns. */
const CAT_BESIDE_CARL_TILES = 1;
const CRAWLER_ROWS_SOUTH_OF_DOOR = 2;
const FAT_CLOWN_OFFSET = { x: -2, y: 2 } as const;
const STILT_CLOWN_OFFSET = { x: 9, y: 1 } as const;
/** How far a scale figure may be moved to find ground it can stand on. */
const FIGURE_SEARCH_RADIUS_TILES = 3;

function stringArg(name: string): string | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? undefined : raw.slice(`--${name}=`.length);
}

const stageArg = stringArg('stage') ?? 'pre-quest';
if (!isStageName(stageArg)) {
  console.error(`unknown --stage=${stageArg}; one of ${Object.keys(STAGES).join(', ')}`);
  process.exit(2);
}
const stageName: StageName = stageArg;
const label = stringArg('label');
/**
 * The ambience's clock at the moment rendered, in seconds. The default
 * catches the caravan's curtain mid-twitch and the loose balloon well up.
 */
const DEFAULT_AMBIENCE_SECONDS = 15.45;
const ambienceSeconds = Number.parseFloat(stringArg('time') ?? '') || DEFAULT_AMBIENCE_SECONDS;

await loadSprites('src/images/');
const { paintEnvironmentArtInNode } = await import('./nodeCanvasGlobals.js');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);

/** One site per approach heading found in the sweep, topped up to the minimum. */
function defaultSites(): CircusSite[] {
  const byHeading = new Map<string, CircusSite>();
  const spare: CircusSite[] = [];
  for (let index = 1; index <= HEADING_SWEEP_SEEDS; index++) {
    const site = buildCircusSite(SEED_STRIDE * index);
    if (typeof site === 'string') continue;
    const heading = approachHeading(site);
    if (byHeading.has(heading)) {
      spare.push(site);
      continue;
    }
    byHeading.set(heading, site);
  }
  const sites = [...byHeading.values()];
  for (const site of spare) {
    if (sites.length >= MIN_DEFAULT_SEEDS) break;
    sites.push(site);
  }
  return sites;
}

function requestedSites(): CircusSite[] {
  const listed = stringArg('seeds');
  if (listed === undefined) return defaultSites();
  return listed
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .map((seed) => {
      const site = buildCircusSite(seed);
      if (typeof site === 'string') throw new Error(`seed ${seed}: ${site}`);
      return site;
    });
}

interface Figure {
  readonly y: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}

function standingTile(site: CircusSite, x: number, y: number): { x: number; y: number } {
  return findNearbyWalkableTile(site.map, x, y, FIGURE_SEARCH_RADIUS_TILES) ?? { x, y };
}

/** Carl, Donut, a fat clown and a stilt clown, stood on open ground for scale. */
function scaleFigures(site: CircusSite): Figure[] {
  const door = site.bigTop.doorTile;
  const carlTile = standingTile(site, door.x, door.y + CRAWLER_ROWS_SOUTH_OF_DOOR);
  const catTile = standingTile(site, carlTile.x + CAT_BESIDE_CARL_TILES, carlTile.y);
  const fatTile = standingTile(
    site,
    site.centre.x + FAT_CLOWN_OFFSET.x,
    site.centre.y + FAT_CLOWN_OFFSET.y,
  );
  const stiltTile = standingTile(
    site,
    site.centre.x + STILT_CLOWN_OFFSET.x,
    site.centre.y + STILT_CLOWN_OFFSET.y,
  );
  const carl = new HumanPlayer(carlTile.x, carlTile.y, TILE_SIZE);
  const donut = new CatPlayer(catTile.x, catTile.y, TILE_SIZE);
  const fat = new FatClown(fatTile.x, fatTile.y, TILE_SIZE);
  const stilt = new StiltClown(stiltTile.x, stiltTile.y, TILE_SIZE);
  for (const figure of [donut, fat, stilt]) figure.setMap(site.map);
  return [carl, donut, fat, stilt];
}

/** The stage's own cast — Signet, and the first wave in the assault — as the quest stands it up. */
function stageCast(site: CircusSite, stage: CircusQuestStage): Figure[] {
  const rig = buildQuestRig(site, stage, site.centre);
  return rig.roster.mobs.filter((mob) => mob.isAlive);
}

interface SortedDraw {
  readonly sortY: number;
  readonly draw: () => void;
}

function renderSite(site: CircusSite, stage: CircusQuestStage): Canvas {
  const reach = site.radiusTiles + FRAME_MARGIN_TILES;
  const viewTiles = reach * 2 + 1;
  const camX = (site.centre.x - reach) * TILE_SIZE;
  const camY = (site.centre.y - reach) * TILE_SIZE;
  const viewPx = viewTiles * TILE_SIZE;
  const canvas = createCanvas(Math.round(viewPx * RENDER_SCALE), Math.round(viewPx * RENDER_SCALE));
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(RENDER_SCALE, RENDER_SCALE);
  const ctx = asGameContext(nodeCtx);

  const ambience = new CircusGroundsAmbience();
  ambience.update(site.map, ambienceSeconds, isCircusResolvedStage(stage));
  renderCanvas(ctx, site.map.structure, TILE_SIZE, camX, camY, viewPx, viewPx);
  ambience.renderGround(ctx, camX, camY);

  const draws: SortedDraw[] = [];
  for (const { tx, ty, sortYAnchorPx } of site.map.getVisibleDecorationTiles(
    camX,
    camY,
    viewPx,
    viewPx,
  )) {
    draws.push({
      sortY: ty * TILE_SIZE + sortYAnchorPx,
      draw: () => site.map.drawDecorationAt(ctx, tx, ty, camX, camY),
    });
  }
  for (const figure of [...scaleFigures(site), ...stageCast(site, stage)]) {
    draws.push({
      sortY: figure.y + TILE_SIZE,
      draw: () => figure.render(ctx, camX, camY, TILE_SIZE),
    });
  }
  for (const piece of ambience.renderEntities()) {
    draws.push({
      sortY: piece.y + TILE_SIZE,
      draw: () => piece.render(ctx, camX, camY, TILE_SIZE),
    });
  }
  // Stable, like the game's: at a tie the decoration pushed first draws first.
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const item of draws) item.draw();
  ambience.renderAbove(ctx, camX, camY);

  worldText(ctx, `seed ${site.seed} — road from the ${approachHeading(site)} — ${stageName}`, {
    style: 'label',
    x: TITLE_X,
    y: TITLE_Y,
    outline: true,
  });
  return canvas;
}

/** Every seed rendered this run whose "before" was already kept, so the sheet never pairs a render with itself. */
const rendered: Array<{ seed: number; before: string; after: string }> = [];
for (const site of requestedSites()) {
  const stage = STAGES[stageName];
  const png = renderSite(site, stage).toBuffer('image/png');
  const tag = label === undefined ? '' : `${label}-`;
  const written = writePreviewPng(
    `${PREVIEW_DIR}/circus-grounds-${tag}${site.seed}-${stageName}.png`,
    png,
  );
  console.log(`${written}: road from the ${approachHeading(site)}`);
  const keptBefore = `${PREVIEW_DIR}/circus-grounds-${BEFORE_LABEL}-${site.seed}-${stageName}.png`;
  if (existsSync(keptBefore))
    rendered.push({ seed: site.seed, before: keptBefore, after: written });
  if (label !== undefined) continue;
  const beforePath = `${PREVIEW_DIR}/circus-grounds-${BEFORE_LABEL}-${site.seed}-${stageName}.png`;
  if (!existsSync(beforePath)) {
    copyFileSync(written, beforePath);
    console.log(`  kept as ${beforePath}`);
  }
}

/** Half size: the sheet is for comparing layouts side by side, not for judging paint. */
const SHEET_SCALE = 0.5;
const SHEET_GAP_PX = 8;
const SHEET_BACKGROUND = '#111111';

/**
 * `--sheet` lays every rendered seed's kept "before" beside this render, one
 * row per seed, as `preview/circus-grounds-before-after.png`.
 */
if (process.argv.includes('--sheet')) {
  const images = await Promise.all(
    rendered.map(async (row) => ({
      before: await loadImage(row.before),
      after: await loadImage(row.after),
    })),
  );
  if (images.length > 0) {
    const cellW = Math.round(images[0].after.width * SHEET_SCALE);
    const cellH = Math.round(images[0].after.height * SHEET_SCALE);
    const sheet = createCanvas(cellW * 2 + SHEET_GAP_PX, (cellH + SHEET_GAP_PX) * images.length);
    const sheetCtx = sheet.getContext('2d');
    sheetCtx.fillStyle = SHEET_BACKGROUND;
    sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
    images.forEach((pair, index) => {
      const y = index * (cellH + SHEET_GAP_PX);
      sheetCtx.drawImage(pair.before, 0, y, cellW, cellH);
      sheetCtx.drawImage(pair.after, cellW + SHEET_GAP_PX, y, cellW, cellH);
    });
    const sheetPath = writePreviewPng(
      `${PREVIEW_DIR}/circus-grounds-before-after.png`,
      sheet.toBuffer('image/png'),
    );
    console.log(`${sheetPath}: before | after, ${images.length} seed(s)`);
  }
}
