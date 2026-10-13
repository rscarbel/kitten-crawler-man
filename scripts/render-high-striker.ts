/**
 * Headless review render of the circus grounds' high striker being played,
 * at game scale on the real generated third floor, through the game's real
 * decoration renderer, crawlers and `HighStrikerSystem`, with its clock
 * pinned so every panel is an exact moment of `high_striker_bell`.
 *
 *   npm run render:high-striker
 *   npx tsx scripts/render-high-striker.ts --seed=15838
 *
 * Each play starts south of the striker with the power meter up, then steps
 * to the side of the pad for the swing. Rows: Carl at full power (the bell
 * rings), at mid power and at low power (the puck stops partway, no bell),
 * then Donut at full power. The queued interaction prompts are drawn through
 * the game's own prompt surface, once as on a desktop and once as on a phone
 * at the largest UI size, so the lock prompt can be checked against the
 * meter. Writes `preview/high-striker.png` and `preview/high-striker-phone.png`,
 * blown up nearest-neighbour so the puck can be checked against the track.
 */

import { createCanvas, type Canvas } from 'canvas';

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
const { TICKS_PER_SECOND } = await import('../src/sprites/art/human/timing');
const { loadSprites } = await import('../src/core/SpriteLoader');
const { renderCanvas } = await import('../src/map/TileRenderer');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { worldText } = await import('../src/ui/world/worldText');
const { UiRoot } = await import('../src/ui/core/UiRoot');
const { NO_INSETS } = await import('../src/ui/core/viewport');
const { promptSurface } = await import('../src/ui/hud/prompt');
const { setInteractionPromptsSuppressed } = await import('../src/ui/InteractionPrompt');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer');
const { CatPlayer } = await import('../src/creatures/CatPlayer');
const { buildCircusSite } = await import('./verifyCircusGrounds/site.js');
const { HighStrikerSystem } = await import('../src/systems/circus/HighStrikerSystem');
const {
  HIGH_STRIKER_BELL_STRIKE_S,
  HIGH_STRIKER_METER_SWEEP_S,
  HIGH_STRIKER_PUCK_RISE_START_S,
  highStrikerMeterPower,
  highStrikerPeakAtS,
} = await import('../src/systems/circus/highStrikerTimeline');

type Site = Exclude<ReturnType<typeof buildCircusSite>, string>;
type Crawler = InstanceType<typeof HumanPlayer> | InstanceType<typeof CatPlayer>;

const DEFAULT_SEED = 7919;
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seed =
  seedArg === undefined ? DEFAULT_SEED : Number.parseInt(seedArg.slice('--seed='.length), 10);

/** The panel's window round the striker, in tiles: wide enough for the crawler beside it, tall enough for the bell. */
const VIEW_TILES_WIDE = 6;
const VIEW_TILES_HIGH = 7;
/** Rows of the view below the striker's own tile, for the crawler who starts south of it. */
const VIEW_ROWS_BELOW = 2;
const PANEL_GAP_PX = 4;
const LABEL_X = 3;
const LABEL_Y = 3;
/** Blown up nearest-neighbour, so a two-pixel puck can be read against the track. */
const SHEET_SCALE = 3;
const SHEET_BACKGROUND = '#111111';

/** Ticks into Carl's swing for the wind-up panel: the mallet at the top of its arc. */
const WIND_UP_TICKS = 35;
/** Ticks a swing is given to reach its impact; generous, the system says when it lands. */
const SWING_TICK_LIMIT = 120;
/** A hair past a mark, so a panel shows what the mark starts rather than what it ends. */
const JUST_AFTER_S = 0.01;
/** Mid-rise of a full swing: halfway through the rattle. */
const MID_RISE_S =
  HIGH_STRIKER_PUCK_RISE_START_S +
  (HIGH_STRIKER_BELL_STRIKE_S - HIGH_STRIKER_PUCK_RISE_START_S) / 2;
/** Early in the ring-out: the puck just off the bell, the bell still bright. */
const RINGING_S = 0.55;
/** Halfway down after a full swing, the bell fading. */
const FALLING_S = 0.75;
/** Long after any swing: the puck back at rest, the bell dark. */
const AT_REST_AGAIN_S = 1.6;
/** Into a short swing's fall, and into its verdict. */
const AFTER_PEAK_S = 0.25;
/** The powers rendered: the top of the meter, partway, and barely. */
const FULL_POWER = 1;
const MID_POWER = 0.55;
const WEAK_POWER = 0.2;
const TICK_S = 1 / TICKS_PER_SECOND;

await loadSprites('src/images/');
const { paintEnvironmentArtInNode } = await import('./nodeCanvasGlobals.js');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);

const built = buildCircusSite(seed);
if (typeof built === 'string') throw new Error(`seed ${seed}: ${built}`);
const site: Site = built;
const grounds = site.map.circusGrounds;
const placed = grounds?.structures.find((structure) => structure.structure === 'high_striker');
if (placed === undefined) throw new Error(`seed ${seed}: the grounds stood no high striker`);
const striker = { x: placed.rect.x, y: placed.rect.y };

if (!site.map.isWalkable(striker.x, striker.y + 1)) {
  throw new Error('the tile south of the striker, where each play starts, is not walkable');
}

interface Panel {
  readonly label: string;
  readonly canvas: Canvas;
}

type System = InstanceType<typeof HighStrikerSystem>;

/** A screen the prompts are drawn for: its CSS size, input density and the player's UI size. */
interface ReviewViewport {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly density: 'pointer' | 'touch';
  readonly uiSize: 'small' | 'medium' | 'large';
}
const DESKTOP: ReviewViewport = {
  name: 'desktop',
  w: 1440,
  h: 900,
  density: 'pointer',
  uiSize: 'medium',
};
/** A phone at the largest UI size: the biggest a prompt pill is drawn anywhere. */
const PHONE: ReviewViewport = { name: 'phone', w: 390, h: 844, density: 'touch', uiSize: 'large' };
let promptViewport: ReviewViewport = DESKTOP;

/** Draws the prompts queued this panel through the game's own prompt surface, as the scene's UiRoot would. */
function drawQueuedPrompts(ctx: CanvasRenderingContext2D): void {
  const viewport = promptViewport;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: viewport.w,
      cssHeight: viewport.h,
      density: viewport.density,
      uiSize: viewport.uiSize,
      safeArea: NO_INSETS,
    }),
    now: () => 0,
    warn: () => undefined,
  });
  root.mount(promptSurface());
  root.frame(ctx);
}

function renderPanel(system: System, crawler: Crawler, label: string): Panel {
  const width = VIEW_TILES_WIDE * TILE_SIZE;
  const height = VIEW_TILES_HIGH * TILE_SIZE;
  const camX = (striker.x - (VIEW_TILES_WIDE - 1) / 2) * TILE_SIZE;
  const camY = (striker.y + 1 + VIEW_ROWS_BELOW - VIEW_TILES_HIGH) * TILE_SIZE;
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  setInteractionPromptsSuppressed(false);
  renderCanvas(ctx, site.map.structure, TILE_SIZE, camX, camY, width, height);
  const draws: Array<{ sortY: number; draw: () => void }> = [];
  for (const { tx, ty, sortYAnchorPx } of site.map.getVisibleDecorationTiles(
    camX,
    camY,
    width,
    height,
  )) {
    draws.push({
      sortY: ty * TILE_SIZE + sortYAnchorPx,
      draw: () => site.map.drawDecorationAt(ctx, tx, ty, camX, camY),
    });
  }
  for (const piece of system.renderEntities()) {
    draws.push({
      sortY: piece.y + TILE_SIZE,
      draw: () => piece.render(ctx, camX, camY, TILE_SIZE),
    });
  }
  draws.push({
    sortY: crawler.y + TILE_SIZE,
    draw: () => crawler.render(ctx, camX, camY, TILE_SIZE),
  });
  draws.sort((a, b) => a.sortY - b.sortY);
  for (const item of draws) item.draw();
  system.renderAbove(ctx, camX, camY);
  if (!system.renderLockPrompt(ctx, camX, camY, crawler)) {
    system.renderPrompt(ctx, camX, camY, crawler);
  }
  drawQueuedPrompts(ctx);
  worldText(ctx, label, { style: 'label', x: LABEL_X, y: LABEL_Y, outline: true });
  return { label, canvas };
}

/** The meter's ticks until its sweep first reaches `power` on the way up. */
function ticksToPower(power: number): number {
  return Math.round((power * HIGH_STRIKER_METER_SWEEP_S) / 2 / TICK_S);
}

/**
 * One play of the striker by a crawler stood south of it, the meter locked
 * at `power`: the meter up, the swing, then the puck at each of `moments`,
 * seconds after the impact.
 */
function playRow(
  makeCrawler: (x: number, y: number) => Crawler,
  power: number,
  moments: ReadonlyArray<readonly [number, string]>,
): Panel[] {
  let now = 0;
  const system = new HighStrikerSystem({ audio: null, clock: () => now });
  const step = (crawler: Crawler): void => {
    now += TICK_S;
    crawler.tickTimers();
    system.update(site.map, false);
  };
  system.update(site.map, false);
  const crawler = makeCrawler(striker.x, striker.y + 1);
  crawler.isActive = true;
  crawler.facingX = 0;
  crawler.facingY = -1;
  const who = crawler instanceof HumanPlayer ? 'Carl' : 'Donut';
  if (!system.tryInteract(crawler)) throw new Error(`${who} could not raise the meter`);
  const meterTicks = ticksToPower(power);
  for (let tick = 0; tick < meterTicks; tick++) step(crawler);
  const locked = highStrikerMeterPower(meterTicks * TICK_S);
  const panels: Panel[] = [renderPanel(system, crawler, `${who} meter ${locked.toFixed(2)}`)];
  if (!system.claimPress(crawler)) throw new Error(`${who}'s lock-in was not taken`);

  let impactAt: number | null = null;
  for (let tick = 1; tick <= SWING_TICK_LIMIT && impactAt === null; tick++) {
    step(crawler);
    if (tick === WIND_UP_TICKS && crawler instanceof HumanPlayer) {
      panels.push(renderPanel(system, crawler, 'wind-up'));
    }
    impactAt = system.latestImpactAt();
  }
  if (impactAt === null) throw new Error(`${who}'s swing never struck`);
  panels.push(renderPanel(system, crawler, 'impact 0.00 s'));

  for (const [seconds, name] of moments) {
    while (now - impactAt < seconds - TICK_S / 2) step(crawler);
    now = impactAt + seconds;
    panels.push(renderPanel(system, crawler, `${name} ${seconds.toFixed(2)} s`));
  }
  return panels;
}

const FULL_MOMENTS: ReadonlyArray<readonly [number, string]> = [
  [MID_RISE_S, 'mid-rise'],
  [HIGH_STRIKER_BELL_STRIKE_S + JUST_AFTER_S, 'bell'],
  [RINGING_S, 'ringing'],
  [FALLING_S, 'falling'],
  [AT_REST_AGAIN_S, 'rest'],
];

function shortMoments(power: number): ReadonlyArray<readonly [number, string]> {
  const peak = highStrikerPeakAtS(power);
  return [
    [peak / 2 + HIGH_STRIKER_PUCK_RISE_START_S / 2, 'rising'],
    [peak + JUST_AFTER_S, 'peak'],
    [peak + AFTER_PEAK_S, 'falling'],
    [AT_REST_AGAIN_S, 'rest'],
  ];
}

const makeCarl = (x: number, y: number): Crawler => new HumanPlayer(x, y, TILE_SIZE);
const makeDonut = (x: number, y: number): Crawler => {
  const cat = new CatPlayer(x, y, TILE_SIZE);
  cat.setMap(site.map);
  return cat;
};
for (const viewport of [DESKTOP, PHONE]) {
  promptViewport = viewport;
  const rows: Panel[][] = [
    playRow(makeCarl, FULL_POWER, FULL_MOMENTS),
    playRow(makeCarl, MID_POWER, shortMoments(MID_POWER)),
    playRow(makeCarl, WEAK_POWER, shortMoments(WEAK_POWER)),
    playRow(makeDonut, FULL_POWER, FULL_MOMENTS),
  ];

  const panelW = VIEW_TILES_WIDE * TILE_SIZE;
  const panelH = VIEW_TILES_HIGH * TILE_SIZE;
  const columns = Math.max(...rows.map((row) => row.length));
  const sheet = createCanvas(
    columns * (panelW + PANEL_GAP_PX) * SHEET_SCALE,
    rows.length * (panelH + PANEL_GAP_PX) * SHEET_SCALE,
  );
  const sheetCtx = sheet.getContext('2d');
  sheetCtx.imageSmoothingEnabled = false;
  sheetCtx.fillStyle = SHEET_BACKGROUND;
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
  rows.forEach((row, rowIndex) => {
    row.forEach((panel, column) => {
      sheetCtx.drawImage(
        panel.canvas,
        column * (panelW + PANEL_GAP_PX) * SHEET_SCALE,
        rowIndex * (panelH + PANEL_GAP_PX) * SHEET_SCALE,
        panelW * SHEET_SCALE,
        panelH * SHEET_SCALE,
      );
    });
  });
  const suffix = viewport === DESKTOP ? '' : `-${viewport.name}`;
  const written = writePreviewPng(
    `${PREVIEW_DIR}/high-striker${suffix}.png`,
    sheet.toBuffer('image/png'),
  );
  console.log(`${written}: seed ${seed}, ${rows.length} plays, prompts as on ${viewport.name}`);
}
