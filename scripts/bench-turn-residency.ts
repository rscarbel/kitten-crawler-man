/**
 * Whether a quick turn ever finds Carl's or Donut's rows cold, run headlessly
 * against the real figure cache.
 *
 * Each crawler is built, warmed as a scene warms it, and driven through turns
 * a player makes: a fast circle-strafe on the run, and a long run in one
 * direction (past the cache's release window) followed by a keyboard snap of a
 * quarter or a half turn, on the move and standing; a menu held open past the
 * window (drawn, never ticked) before a turn; and the whole cache flushed, as a
 * render-quality change flushes it, before one — where every row held warm
 * must be asked for again on the very first frame drawn after the flush, not
 * on some later refresh. Every rendered frame draws
 * the crawler as the game does, and a cell that is not warm when it is drawn
 * is counted — a miss is a bake or a direct paint on the frame he turns, the
 * hitch this exists to rule out. The resident megabytes are reported beside
 * it, which is the price of ruling it out.
 *
 * Run on the low-end bake scale (a DPR-1 display, half-density cells) and the
 * full one, at one and two rendered frames per update — the release window is
 * counted in rendered frames, so a fast display sweeps sooner.
 *
 *   npm run bench:turn-residency
 *   npm run bench:turn-residency -- --scenario=menu
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { TOOL_TIER_BASIC, type WorkingTool } from '../src/core/toolTiers.js';
import { CAT_WORK_SWING_TICKS } from '../src/systems/WorkChannel.js';
import { HELD_VISUALS } from '../src/sprites/held/heldVisuals.js';
import { ITEM_DEF, isItemId, weaponStatsOf } from '../src/core/ItemDefs.js';
import {
  ARMED_MOTION_SETS,
  type ArmedMotionSet,
  motionSetOf,
} from '../src/sprites/art/human/motionSets.js';
import type { Player } from '../src/Player.js';
import {
  beginFigureFrame,
  figurePrewarmDepth,
  figureResidentBytes,
  flushFigureFrameCache,
  IDLE_FRAMES_BEFORE_RELEASE,
  isFigureStateQueued,
  setFigureBakeClock,
  touchFigureState,
} from '../src/sprites/figure/figureFrameCache.js';
import { BYTES_PER_MEGABYTE } from '../src/core/canvasSurface.js';
import {
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  activeHumanFigure,
  prewarmHumanSprite,
  residentViewSpans,
} from '../src/sprites/humanSprite.js';
import { activeCatFigure, prewarmCatSprite, RESIDENT_VIEW_ROWS } from '../src/sprites/catSprite.js';
import { mulberry32 } from '../src/sprites/person/rng.js';

installCanvasGlobals();

const UPDATES_PER_SECOND = 60;
const DEGREES_PER_TURN = 360;
const QUARTER_TURN_DEGREES = 90;
const HALF_TURN_DEGREES = 180;
const EAST = 0;
const SOUTH = 90;
const NORTH = 270;
/** Longer than the release window at the slowest rendered rate, so a view he left is swept. */
const DWELL_TICKS = IDLE_FRAMES_BEFORE_RELEASE + 2 * UPDATES_PER_SECOND;
const AFTER_TURN_SECONDS = 4;
const AFTER_TURN_TICKS = AFTER_TURN_SECONDS * UPDATES_PER_SECOND;
const CIRCLE_SECONDS = 20;
const CIRCLE_TICKS = CIRCLE_SECONDS * UPDATES_PER_SECOND;
/** A full circle a second, and one every two seconds. */
const FAST_CIRCLE_DEGREES_PER_TICK = DEGREES_PER_TURN / UPDATES_PER_SECOND;
const SLOW_CIRCLE_DEGREES_PER_TICK = FAST_CIRCLE_DEGREES_PER_TICK / 2;
/** Snapping between the four keyboard headings, moving for most of each hold. */
const KEYBOARD_HOLD_TICKS = UPDATES_PER_SECOND / 2;
/** The last stretch of each hold he stands still, as a player lets go of the key between turns. */
const KEYBOARD_STANDING_TICKS = 10;
const KEYBOARD_MOVING_TICKS = KEYBOARD_HOLD_TICKS - KEYBOARD_STANDING_TICKS;
const KEYBOARD_FIGHT_SECONDS = 30;
const KEYBOARD_FIGHT_TICKS = KEYBOARD_FIGHT_SECONDS * UPDATES_PER_SECOND;
const KEYBOARD_HEADINGS = [EAST, SOUTH, HALF_TURN_DEGREES, NORTH] as const;
/** Long enough for a scene's warm-up queue to drain before the turns start, on node's slow bakes. */
const WARM_UP_RELEASE_WINDOWS = 8;
const WARM_UP_FRAME_LIMIT = WARM_UP_RELEASE_WINDOWS * IDLE_FRAMES_BEFORE_RELEASE;
/** Her idle breaks are rolled on `Math.random`; seeded, a run is the same run every time. */
const RANDOM_SEED = 0x7475726e;
const RENDERED_FRAMES_PER_UPDATE = [1, 2] as const;
const LOW_END_PIXEL_RATIO = 1;
const FULL_PIXEL_RATIO = 2;
const MB_DIGITS = 1;

interface Scenario {
  readonly name: string;
  readonly ticks: number;
  readonly headingAt: (tick: number) => number;
  readonly movingAt: (tick: number) => boolean;
  /** Ticks on which the world is halted under a menu: drawn, never ticked. */
  readonly haltedAt?: (tick: number) => boolean;
  /** The tick the whole cache is flushed on, as a render-quality change flushes it. */
  readonly flushAt?: number;
  /** Cold cells are counted from this tick: a flush leaves even the row on screen cold. */
  readonly countFrom?: number;
  /** What she picks up or puts down, tick by tick: a scenario only she plays. */
  readonly holds?: (cat: CatPlayer, tick: number) => void;
}

/** Standing faced one way past the release window, then a tool out and worked as a harvest works it. */
function harvestStart(name: string, heading: number): Scenario {
  return {
    name,
    ticks: DWELL_TICKS + HARVEST_TICKS,
    headingAt: () => heading,
    movingAt: () => false,
    holds: (cat, tick) => {
      if (tick === DWELL_TICKS) cat.setWorkingTool(HARVEST_TOOL);
      const working = tick - DWELL_TICKS;
      if (working > 0 && working % CAT_WORK_SWING_TICKS === 0) cat.playWorkSwing();
    },
  };
}

const HARVEST_SECONDS = 5;
const HARVEST_TICKS = HARVEST_SECONDS * UPDATES_PER_SECOND;
const HARVEST_TOOL: WorkingTool = { kind: 'axe', tier: TOOL_TIER_BASIC };
/**
 * Cold cells are counted once she has carried the thing this long: the
 * carrying rows are asked for as it reaches her jaws, and the first frames
 * of them are drawn cold. Nothing in play puts a thing in her jaws yet.
 */
const PICK_UP_SETTLE_TICKS = UPDATES_PER_SECOND;
/** Walking off after putting down what she carried, long enough for every view to come round. */
const AFTER_DROP_SECONDS = 4;
const AFTER_DROP_TICKS = AFTER_DROP_SECONDS * UPDATES_PER_SECOND;

function snap(name: string, from: number, by: number, moving: boolean): Scenario {
  return {
    name,
    ticks: DWELL_TICKS + AFTER_TURN_TICKS,
    headingAt: (tick) => (tick < DWELL_TICKS ? from : from + by),
    movingAt: () => moving,
  };
}

/** Standing about before a menu opens, so the scene's warm-up is behind him. */
const SETTLE_TICKS = UPDATES_PER_SECOND;
/** A menu held open past the release window: the views he is not drawn in are swept. */
const HALT_PAST_WINDOW_SECONDS = 5;
const HALT_TICKS = IDLE_FRAMES_BEFORE_RELEASE + HALT_PAST_WINDOW_SECONDS * UPDATES_PER_SECOND;
const HALT_ENDS = SETTLE_TICKS + HALT_TICKS;
/** Running before the flush, and after it long enough for the rewarm to land on node's bakes. */
const FLUSH_TICK = 2 * UPDATES_PER_SECOND;
const REWARM_SECONDS = 8;
const FLUSH_SNAP_TICK = FLUSH_TICK + REWARM_SECONDS * UPDATES_PER_SECOND;

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'stand east, a menu open past the release window, snap a quarter north',
    ticks: HALT_ENDS + AFTER_TURN_TICKS,
    headingAt: (tick) => (tick < HALT_ENDS ? EAST : EAST - QUARTER_TURN_DEGREES),
    movingAt: () => false,
    haltedAt: (tick) => tick >= SETTLE_TICKS && tick < HALT_ENDS,
  },
  {
    name: 'run east, the cache flushed, snap a quarter north',
    ticks: FLUSH_SNAP_TICK + AFTER_TURN_TICKS,
    headingAt: (tick) => (tick < FLUSH_SNAP_TICK ? EAST : EAST - QUARTER_TURN_DEGREES),
    movingAt: () => true,
    flushAt: FLUSH_TICK,
    countFrom: FLUSH_SNAP_TICK,
  },
  {
    name: 'circle-strafe, a turn a second',
    ticks: CIRCLE_TICKS,
    headingAt: (tick) => tick * FAST_CIRCLE_DEGREES_PER_TICK,
    movingAt: () => true,
  },
  {
    name: 'circle-strafe, a turn every two seconds',
    ticks: CIRCLE_TICKS,
    headingAt: (tick) => tick * SLOW_CIRCLE_DEGREES_PER_TICK,
    movingAt: () => true,
  },
  snap('run east, snap a quarter north', EAST, -QUARTER_TURN_DEGREES, true),
  snap('run east, snap a quarter south', EAST, QUARTER_TURN_DEGREES, true),
  snap('run south, snap a half north', SOUTH, HALF_TURN_DEGREES, true),
  snap('run north, snap a quarter east', NORTH, QUARTER_TURN_DEGREES, true),
  snap('stand north, snap a half south', NORTH, HALF_TURN_DEGREES, false),
  harvestStart('stand north past the release window, then a tool out and working', NORTH),
  harvestStart('stand south past the release window, then a tool out and working', SOUTH),
  harvestStart('stand east past the release window, then a tool out and working', EAST),
  harvestStart(
    'stand west past the release window, then a tool out and working',
    HALF_TURN_DEGREES,
  ),
  {
    name: 'carry past the release window, put it down and walk a circle',
    ticks: DWELL_TICKS + AFTER_DROP_TICKS,
    headingAt: (tick) =>
      tick < DWELL_TICKS ? SOUTH : SOUTH + (tick - DWELL_TICKS) * FAST_CIRCLE_DEGREES_PER_TICK,
    movingAt: (tick) => tick > DWELL_TICKS,
    countFrom: PICK_UP_SETTLE_TICKS,
    holds: (cat, tick) => {
      if (tick === 0) cat.setMouthCarry(HELD_VISUALS.carried_wrench);
      if (tick === DWELL_TICKS) cat.setMouthCarry(null);
    },
  },
  {
    name: 'keyboard fight, snapping four ways',
    ticks: KEYBOARD_FIGHT_TICKS,
    headingAt: (tick) =>
      KEYBOARD_HEADINGS[Math.floor(tick / KEYBOARD_HOLD_TICKS) % KEYBOARD_HEADINGS.length],
    movingAt: (tick) => tick % KEYBOARD_HOLD_TICKS < KEYBOARD_MOVING_TICKS,
  },
];

interface Crawler {
  readonly name: string;
  readonly build: () => Player;
  readonly figure: () => FigureDef;
  readonly prewarm: () => void;
  /** The rows the sprite holds warm from every draw. */
  readonly residentRows: readonly string[];
  /** Plays the scenarios of picking things up and putting them down. */
  readonly holds: boolean;
}

/**
 * Carl with a weapon out whose grip and weight play `set`, read off the item
 * table so no bench names a weapon.
 */
function carlHolding(set: ArmedMotionSet): HumanPlayer {
  const carl = new HumanPlayer(0, 0, TILE_SIZE);
  const weapon = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .find((id) => {
      const stats = weaponStatsOf(id);
      return stats !== null && motionSetOf(HELD_VISUALS[stats.heldVisual]) === set;
    });
  if (weapon === undefined) throw new Error(`no weapon item plays the ${set} rows`);
  carl.inventory.addItem(weapon, 1);
  carl.inventory.equipment.equipById(weapon);
  carl.restoreWeaponDrawn(true);
  return carl;
}

const CRAWLERS: readonly Crawler[] = [
  {
    name: 'Carl',
    build: () => new HumanPlayer(0, 0, TILE_SIZE),
    figure: activeHumanFigure,
    prewarm: prewarmHumanSprite,
    residentRows: residentViewSpans('unarmed').map((span) => span.row),
    holds: false,
  },
  ...ARMED_MOTION_SETS.map((set) => ({
    name: `Carl with a ${set} weapon out`,
    build: () => carlHolding(set),
    figure: activeHumanFigure,
    prewarm: prewarmHumanSprite,
    residentRows: residentViewSpans(set).map((span) => span.row),
    holds: false,
  })),
  {
    name: 'Donut',
    build: () => new CatPlayer(0, 0, TILE_SIZE),
    figure: activeCatFigure,
    prewarm: prewarmCatSprite,
    residentRows: RESIDENT_VIEW_ROWS,
    holds: true,
  },
];

interface Measured {
  readonly missFrames: number;
  /** Held rows neither warm nor queued on the first frame drawn after the flush. */
  readonly unaskedAfterFlush: number;
  readonly directDraws: number;
  readonly peakMegabytes: number;
  readonly endMegabytes: number;
}

const ctx = gameContext(TILE_SIZE, TILE_SIZE);

const MS_PER_SECOND = 1000;
/**
 * The clock her looping rows pick their frame by, run at the display rate
 * being simulated rather than at however fast node gets through a frame: a
 * headless frame that bakes takes many times a display frame, and one that
 * does not takes a sliver of one, so on the real clock which idle frame she is
 * drawn in depends on the machine's load. Bake costs stay on the real clock,
 * since the cache paces itself by what a bake actually cost.
 */
const realNow = performance.now.bind(performance);
let simulatedMs = 0;
performance.now = () => simulatedMs;
setFigureBakeClock(realNow);

/** One rendered frame of the display being simulated. */
function renderFrame(framesPerUpdate: number): void {
  simulatedMs += MS_PER_SECOND / (UPDATES_PER_SECOND * framesPerUpdate);
  beginFigureFrame();
}

function megabytes(def: FigureDef): number {
  return figureResidentBytes(def) / BYTES_PER_MEGABYTE;
}

function measure(crawler: Crawler, scenario: Scenario, framesPerUpdate: number): Measured {
  Math.random = mulberry32(RANDOM_SEED);
  flushFigureFrameCache();
  const player = crawler.build();
  crawler.prewarm();
  // Standing in view while the scene's warm-up drains, as he is in play: a
  // queue left to drain with nothing drawn sweeps its own first rows before
  // the last ones land.
  for (let frame = 0; frame < WARM_UP_FRAME_LIMIT && figurePrewarmDepth() > 0; frame++) {
    player.isMoving = false;
    player.tickTimers();
    renderFrame(framesPerUpdate);
    player.render(ctx, player.x, player.y, TILE_SIZE);
  }
  if (figurePrewarmDepth() > 0) {
    throw new Error(`${crawler.name}'s warm-up did not drain in ${WARM_UP_FRAME_LIMIT} frames`);
  }
  let missFrames = 0;
  let unaskedAfterFlush = 0;
  let directDraws = 0;
  let peakMegabytes = 0;
  for (let tick = 0; tick < scenario.ticks; tick++) {
    const radians = (scenario.headingAt(tick) / DEGREES_PER_TURN) * Math.PI * 2;
    player.facingX = Math.cos(radians);
    player.facingY = Math.sin(radians);
    if (tick === scenario.flushAt) flushFigureFrameCache();
    const halted = scenario.haltedAt?.(tick) ?? false;
    const counted = tick >= (scenario.countFrom ?? 0);
    if (scenario.holds !== undefined && player instanceof CatPlayer) scenario.holds(player, tick);
    if (!halted) {
      player.isMoving = scenario.movingAt(tick);
      if (player.isMoving) {
        player.x += player.facingX * PLAYER_SPEED;
        player.y += player.facingY * PLAYER_SPEED;
      }
      player.tickTimers();
    }
    for (let frame = 0; frame < framesPerUpdate; frame++) {
      renderFrame(framesPerUpdate);
      player.render(ctx, player.x, player.y, TILE_SIZE);
      const stats = getFigureCacheStats();
      const firstFrameAfterFlush = tick === scenario.flushAt && frame === 0;
      if (firstFrameAfterFlush) unaskedAfterFlush = unaskedRows(crawler);
      if (!counted) continue;
      if (stats.misses > 0) missFrames++;
      directDraws += stats.directDraws;
      peakMegabytes = Math.max(peakMegabytes, megabytes(crawler.figure()));
    }
  }
  return {
    missFrames,
    unaskedAfterFlush,
    directDraws,
    peakMegabytes,
    endMegabytes: megabytes(crawler.figure()),
  };
}

function unaskedRows(crawler: Crawler): number {
  const def = crawler.figure();
  return crawler.residentRows.filter(
    (row) => !touchFigureState(def, row) && !isFigureStateQueued(def, row),
  ).length;
}

/** `--scenario=<text>` runs only the scenarios whose name contains it. */
const SCENARIO_FLAG = '--scenario=';
const SCENARIO_FILTER =
  process.argv.find((arg) => arg.startsWith(SCENARIO_FLAG))?.slice(SCENARIO_FLAG.length) ?? '';

setFigureCacheStatsRecording(true);
const shimmed: { window?: unknown } = globalThis;
let failures = 0;
for (const [scale, pixelRatio] of [
  ['low-end', LOW_END_PIXEL_RATIO],
  ['full', FULL_PIXEL_RATIO],
] as const) {
  shimmed.window = { devicePixelRatio: pixelRatio };
  for (const framesPerUpdate of RENDERED_FRAMES_PER_UPDATE) {
    for (const crawler of CRAWLERS) {
      const chosen = SCENARIOS.filter((each) => each.name.includes(SCENARIO_FILTER));
      for (const scenario of chosen.filter((each) => each.holds === undefined || crawler.holds)) {
        const result = measure(crawler, scenario, framesPerUpdate);
        const clean = result.missFrames === 0 && result.unaskedAfterFlush === 0;
        if (!clean) failures++;
        const unasked =
          scenario.flushAt === undefined
            ? ''
            : `, ${result.unaskedAfterFlush} held rows unasked on the first frame after the flush`;
        console.log(
          `  ${clean ? 'ok  ' : 'MISS'} ${crawler.name}, ${scale} bake, ${framesPerUpdate} frame(s) ` +
            `per update, ${scenario.name}: ${result.missFrames} frames with a cold cell${unasked} ` +
            `(${result.directDraws} painted directly), resident ` +
            `${result.peakMegabytes.toFixed(MB_DIGITS)} MB at peak, ` +
            `${result.endMegabytes.toFixed(MB_DIGITS)} MB at the end`,
        );
      }
    }
  }
}
if (failures > 0) {
  console.error(`FAIL ${failures} turn runs drew a cold cell or left a held row unasked`);
  process.exitCode = 1;
}
