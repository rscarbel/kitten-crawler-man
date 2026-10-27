import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { type DrawnFigureRow, drawnFigureRow, figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { OtterView } from './art/steveArt';
import {
  BOLT_FLY_STATE,
  BOLT_STUCK_STATE,
  OTTER_TILE_X,
  OTTER_TILE_Y,
  STEVE_BOLT_FIGURE,
  STEVE_FIGURE,
  STEVE_ROW_NAMES,
  STEVE_TILES_PER_WALK_CYCLE,
  STEVE_VIEWS,
  TILE_SCALE,
  type SteveRow,
  steveMuzzleInCell,
  steveStateName,
} from './art/steveFigure';
import { STEVE_AIM_FPS, STEVE_BOLT_FPS, STEVE_BOLT_FRAMES, STEVE_IDLE_FPS } from './steveTiming';

/**
 * Steve Cartwright, the otter wheelwright, and the crossbow bolt he looses at
 * his workshop target.
 *
 * Painted at runtime from `src/sprites/art/steveArt.ts` through the figure
 * cache; reviewed with `npm run render:steve`. Frame counts, the frame the bolt
 * leaves on, and the row lengths live in `steveTiming.ts`.
 */

export type { SteveRow };

/** Everything his sprite needs to pick a frame. */
export interface SteveSpriteState {
  readonly row: SteveRow;
  readonly facingX: number;
  readonly facingY: number;
  /** The walk cycle angle, radians 0..2π, advanced by ground covered. */
  readonly walkPhase: number;
  /** 0 on a one-shot row's first frame, 1 on its last; read by `shoot` and `reload`. */
  readonly progress: number;
  /**
   * Seconds on the clock the idle and the held aim loop on. Pass something per
   * instance so two otters on screen do not breathe in lockstep.
   */
  readonly timeSeconds: number;
}

/** Views split on whichever axis he is facing hardest along. */
function viewFor(facingX: number, facingY: number): OtterView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** Only the profile is mirrored: flipping a head-on view would move the crossbow into his other paw. */
function mirrored(facingX: number, facingY: number): boolean {
  return viewFor(facingX, facingY) === 'side' && facingX < 0;
}

/**
 * How many frames a row actually holds, read from the figure that paints it:
 * `drawFigureCached` clamps the frame index, so a row that got shorter would
 * freeze on its last frame rather than throw.
 */
function framesIn(state: string): number {
  return Math.max(1, figureFrameCount(STEVE_FIGURE, state));
}

function frameOf(state: SteveSpriteState, name: string): number {
  const frames = framesIn(name);
  switch (state.row) {
    case 'idle':
      return timeFrameIndex(state.timeSeconds, STEVE_IDLE_FPS, frames);
    case 'aim':
      return timeFrameIndex(state.timeSeconds, STEVE_AIM_FPS, frames);
    case 'walk':
      return walkFrameIndex(state.walkPhase, frames);
    case 'shoot':
    case 'reload':
      return progressFrameIndex(state.progress, frames);
    default: {
      const unhandled: never = state.row;
      return unhandled;
    }
  }
}

/** Draws Steve with his tile's top-left at (sx, sy) and returns the row drawn. */
export function drawSteveSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: SteveSpriteState,
): DrawnFigureRow {
  const name = steveStateName(state.row, viewFor(state.facingX, state.facingY));
  drawFigureCached(ctx, STEVE_FIGURE, name, frameOf(state, name), sx, sy, tileSize, {
    flipX: mirrored(state.facingX, state.facingY),
  });
  return drawnFigureRow(STEVE_FIGURE, name);
}

/** Frames in his walk cycle, for a caller pacing the walk phase by frames. */
export function steveWalkFrames(): number {
  return framesIn(steveStateName('walk', 'side'));
}

/** Ground one walk cycle covers, in tiles: advance `walkPhase` by 2π per this much travel. */
export { STEVE_TILES_PER_WALK_CYCLE };

/**
 * Every state the draw path can ask for, built through the same
 * `steveStateName` it uses, so this list and the draw call can never name
 * different rows. Narrowed by row and view, never by what the figure happens
 * to declare.
 */
export function steveReachableStates(): readonly string[] {
  return Object.values(REACHABLE_ROWS).flatMap((row) =>
    STEVE_VIEWS.map((view) => steveStateName(row, view)),
  );
}

/** Keyed by row so a row added to `SteveRow` cannot ship without being listed. */
const REACHABLE_ROWS: Readonly<Record<SteveRow, SteveRow>> = {
  idle: 'idle',
  walk: 'walk',
  aim: 'aim',
  shoot: 'shoot',
  reload: 'reload',
};

/** Warms every row in every view, and both states of his bolt. */
export function prewarmSteve(): void {
  for (const row of STEVE_ROW_NAMES) {
    for (const view of STEVE_VIEWS) prewarmFigureState(STEVE_FIGURE, steveStateName(row, view));
  }
  prewarmFigureState(STEVE_BOLT_FIGURE, BOLT_FLY_STATE);
  prewarmFigureState(STEVE_BOLT_FIGURE, BOLT_STUCK_STATE);
}

const muzzleByView = new Map<OtterView, { readonly x: number; readonly y: number }>();

/**
 * Where the bolt leaves the crossbow on the shoot row's release frame, in tiles
 * from his tile's top-left, mirrored with the sprite. Spawn the flying bolt's
 * tip here and it starts exactly at the crossbow.
 */
export function steveMuzzlePoint(facingX: number, facingY: number): { x: number; y: number } {
  const view = viewFor(facingX, facingY);
  let inCell = muzzleByView.get(view);
  if (inCell === undefined) {
    inCell = steveMuzzleInCell(view);
    muzzleByView.set(view, inCell);
  }
  const x = (inCell.x - OTTER_TILE_X) / TILE_SCALE;
  const y = (inCell.y - OTTER_TILE_Y) / TILE_SCALE;
  return { x: mirrored(facingX, facingY) ? 1 - x : x, y };
}

/**
 * A crossbow bolt in flight. The art points along +X with its **point on the
 * anchor**; `heading` is the direction of travel in radians
 * (`Math.atan2(dy, dx)`), so (x, y) in screen pixels is where the point is.
 */
export function drawSteveBolt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  heading: number,
  ageSeconds: number,
): void {
  drawFigureCached(
    ctx,
    STEVE_BOLT_FIGURE,
    BOLT_FLY_STATE,
    timeFrameIndex(ageSeconds, STEVE_BOLT_FPS, STEVE_BOLT_FRAMES),
    x,
    y,
    tileSize,
    { rotation: heading },
  );
}

/**
 * The same bolt driven into wood. (x, y) in screen pixels is where it went
 * in — the point the flying bolt's tip had reached — so swapping the flying
 * bolt for this one at the same point and heading does not jump; the point is
 * buried past it and only the shaft behind shows. `alpha` fades it out.
 */
export function drawSteveBoltStuck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  heading: number,
  alpha: number,
): void {
  drawFigureCached(ctx, STEVE_BOLT_FIGURE, BOLT_STUCK_STATE, 0, x, y, tileSize, {
    rotation: heading,
    alpha,
  });
}
