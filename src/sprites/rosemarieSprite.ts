import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { type FigureDef, figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  BERNIE_FIGURE,
  BERNIE_PORTRAIT_FIGURE,
  BERNIE_SNUFFLE_STATE,
  GROUND_OFFSET_IN_TILE,
  ROSEMARIE_FIGURE,
  ROSEMARIE_PORTRAIT_FIGURE,
  ROSEMARIE_ROWS,
  ROSEMARIE_VIEWS,
  type RosemarieRow,
  rosemariePose,
  rosemarieStateName,
} from './art/rosemarieFigure';
import {
  type RosemarieView,
  COIN_RADIUS,
  drawCoinDisc,
  rosemarieBernieSeat,
  rosemarieThrowHandPoint,
} from './art/rosemarieArt';
import {
  BERNIE_SNUFFLE_FPS,
  BERNIE_SNUFFLE_PATTERN,
  ROSEMARIE_COIN_TOSS_RELEASE_FRAME,
  ROSEMARIE_IDLE_FPS,
} from './rosemarieTiming';

export type { RosemarieRow } from './art/rosemarieFigure';
export type { RosemarieView } from './art/rosemarieArt';

/** Everything the Rosemarie sprite needs to pick a frame. */
export interface RosemarieSpriteState {
  /** Which row is playing. `idle` loops on the clock; `coin_toss` plays by progress. */
  readonly row: RosemarieRow;
  /** Head-on behind the desk, or in profile. Defaults to head-on. */
  readonly view?: RosemarieView;
  /** Profile only: negative faces left (the profile is mirrored). */
  readonly facingX?: number;
  /** Seconds on any steady clock; drives the idle loop and Bernie's snuffle. */
  readonly timeSeconds: number;
  /** 0 at the first frame of a coin toss, 1 at the last. */
  readonly progress?: number;
  /**
   * Offsets Bernie's clock from hers, in seconds, so he never twitches in step
   * with her hobble.
   */
  readonly bernieClockOffset?: number;
}

interface Build {
  readonly rosemarie: FigureDef;
  readonly bernie: FigureDef;
}

const IN_WORLD: Build = { rosemarie: ROSEMARIE_FIGURE, bernie: BERNIE_FIGURE };
const PORTRAIT: Build = { rosemarie: ROSEMARIE_PORTRAIT_FIGURE, bernie: BERNIE_PORTRAIT_FIGURE };

/**
 * Bernie's clock starts this far ahead of hers by default, so his first burst
 * does not begin on the same tick as her first idle frame. Keeping the two out
 * of step after that is the job of `BERNIE_SNUFFLE_PATTERN`'s length.
 */
const DEFAULT_BERNIE_CLOCK_OFFSET = 0.37;

function frameFor(build: Build, state: RosemarieSpriteState, name: string): number {
  const count = Math.max(1, figureFrameCount(build.rosemarie, name));
  if (state.row === 'idle') return timeFrameIndex(state.timeSeconds, ROSEMARIE_IDLE_FPS, count);
  return progressFrameIndex(state.progress ?? 0, count);
}

/** Bernie's frame: bursts of snuffling from `BERNIE_SNUFFLE_PATTERN`, then stillness. */
export function bernieSnuffleFrame(timeSeconds: number): number {
  const step = timeFrameIndex(timeSeconds, BERNIE_SNUFFLE_FPS, BERNIE_SNUFFLE_PATTERN.length);
  return BERNIE_SNUFFLE_PATTERN[step] ?? 0;
}

function drawWith(
  build: Build,
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RosemarieSpriteState,
): void {
  const view = state.view ?? 'front';
  const flipX = view === 'side' && (state.facingX ?? 1) < 0;
  const name = rosemarieStateName(state.row, view);
  const frame = frameFor(build, state, name);
  drawFigureCached(ctx, build.rosemarie, name, frame, sx, sy, s, { flipX });

  const seat = rosemarieBernieSeat(view, rosemariePose(state.row, frame));
  const originX = sx + s / 2;
  const originY = sy + s * GROUND_OFFSET_IN_TILE;
  const seatX = originX + (flipX ? -seat.x : seat.x) * s;
  const seatY = originY + seat.y * s;
  const bernieTime = state.timeSeconds + (state.bernieClockOffset ?? DEFAULT_BERNIE_CLOCK_OFFSET);
  const bernieFrame = bernieSnuffleFrame(bernieTime);
  // His cell's anchor is his seat, not a tile centre, so he is mirrored about
  // the seat here rather than through the cache's tile-centred flip.
  ctx.save();
  if (flipX) {
    ctx.translate(seatX, 0);
    ctx.scale(-1, 1);
    ctx.translate(-seatX, 0);
  }
  drawFigureCached(ctx, build.bernie, BERNIE_SNUFFLE_STATE, bernieFrame, seatX, seatY, s);
  ctx.restore();
}

/**
 * Draws Rosemarie with Bernie on her shoulder. (sx, sy) is her tile's top-left
 * on screen and `s` the tile size, like every other figure.
 */
export function drawRosemarieSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RosemarieSpriteState,
): void {
  drawWith(IN_WORLD, ctx, sx, sy, s, state);
}

/**
 * The same figure from its double-density cells, for a panel that shows her
 * several tiles tall: pass the size one tile should be drawn at. Placement is
 * identical to `drawRosemarieSprite`; only the sharpness differs.
 */
export function drawRosemariePortrait(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RosemarieSpriteState,
): void {
  drawWith(PORTRAIT, ctx, sx, sy, s, state);
}

/**
 * Where the coin leaves her hand on the release frame, in tiles from her tile's
 * top-left. A thrown coin spawned here starts exactly where the flick draws the
 * empty hand, so the hand-off from sprite to projectile has no jump.
 */
export function rosemarieCoinReleasePoint(
  view: RosemarieView = 'front',
  facingX = 1,
): { x: number; y: number } {
  const hand = rosemarieThrowHandPoint(
    view,
    rosemariePose('coin_toss', ROSEMARIE_COIN_TOSS_RELEASE_FRAME),
  );
  const flip = view === 'side' && facingX < 0;
  const tileCentre = 0.5;
  return {
    x: tileCentre + (flip ? -hand.x : hand.x),
    y: GROUND_OFFSET_IN_TILE + hand.y,
  };
}

/**
 * A thrown coin at (x, y) screen pixels, spinning: `spinPhase` in turns, so
 * a coin in flight passes `timeSeconds * spinRate`. Drawn live rather than
 * cached because it is a few pixels and its position is continuous.
 */
export function drawThrownCoin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  spinPhase: number,
): void {
  const spin = Math.cos(spinPhase * Math.PI * 2);
  drawCoinDisc(ctx, x, y, COIN_RADIUS * tileSize, spin);
}

/** Every state name the draw paths can ask the figures for. */
export function rosemarieReachableStates(): readonly string[] {
  return ROSEMARIE_ROWS.flatMap((row) =>
    ROSEMARIE_VIEWS.map((view) => rosemarieStateName(row, view)),
  );
}

/**
 * Warms the head-on idle, the coin toss and Bernie's snuffle — what the desk
 * shows — when the club floor is being set up. Pass `includeProfile` for a
 * caller that turns her sideways, and `portrait` for the hire panel's build.
 */
export function prewarmRosemarie(
  options: { includeProfile?: boolean; portrait?: boolean } = {},
): void {
  const build = options.portrait === true ? PORTRAIT : IN_WORLD;
  const views: readonly RosemarieView[] =
    options.includeProfile === true ? ROSEMARIE_VIEWS : ['front'];
  for (const row of ROSEMARIE_ROWS) {
    for (const view of views) prewarmFigureState(build.rosemarie, rosemarieStateName(row, view));
  }
  prewarmFigureState(build.bernie, BERNIE_SNUFFLE_STATE);
}
