import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  GLUTEUS_MAXX_FIGURE,
  GLUTEUS_MAXX_FINISHER_FIGURE,
  MAXX_FACINGS,
  MAXX_ROW_BASES,
  MAXX_WALK_GROUND_PER_CYCLE_TILES,
  maxxFigureFor,
  maxxStateName,
  type MaxxFacing,
  type MaxxRowBase,
} from './art/gluteusMaxxFigure';
import {
  MAXX_IDLE_FPS,
  MAXX_JAB_IMPACT_FRAME,
  MAXX_MAX_WALK_FRAMES_PER_TICK,
  MAXX_WALK_FRAMES,
} from './gluteusMaxxTiming';

export type { MaxxFacing, MaxxRowBase };
export { GLUTEUS_MAXX_FIGURE, GLUTEUS_MAXX_FINISHER_FIGURE };

/** The rows a kit plays once and then hands back: attacks, the finisher, reactions. */
export type MaxxAction = Exclude<MaxxRowBase, 'idle' | 'walk'>;

/** Everything the sprite needs to pick a frame. All fields are optional. */
export interface GluteusMaxxSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** A one-shot row that wins over walking and standing, or null. */
  readonly action?: MaxxAction | null;
  /** 0 at the first frame of the action, 1 at its last. */
  readonly actionProgress?: number;
}

/** Views split on whichever axis he is facing hardest along. */
function facingFor(facingX: number, facingY: number): MaxxFacing {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

interface ResolvedRow {
  readonly base: MaxxRowBase;
  readonly name: string;
  readonly frame: number;
  readonly flipX: boolean;
}

/**
 * How many frames a row actually holds, read from the figure that paints it.
 * `drawFigureCached` clamps the index, so a row that got shorter would
 * otherwise freeze silently on its last frame.
 */
function frameCountOf(base: MaxxRowBase, state: string): number {
  return Math.max(1, figureFrameCount(maxxFigureFor(base), state));
}

function resolveRow(state: GluteusMaxxSpriteState): ResolvedRow {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    action = null,
    actionProgress = 0,
  } = state;
  const facing = facingFor(facingX, facingY);
  // Only the profile is mirrored: the head-on views carry the armband on one
  // arm, and flipping them would move it to the other.
  const flipX = facing === 'side' && facingX < 0;
  if (action !== null) {
    const name = maxxStateName(action, facing);
    return {
      base: action,
      name,
      frame: progressFrameIndex(actionProgress, frameCountOf(action, name)),
      flipX,
    };
  }
  if (isMoving) {
    const name = maxxStateName('walk', facing);
    return {
      base: 'walk',
      name,
      frame: walkFrameIndex(walkFrame, frameCountOf('walk', name)),
      flipX,
    };
  }
  const name = maxxStateName('idle', facing);
  return {
    base: 'idle',
    name,
    frame: timeFrameIndex(performance.now() / 1000, MAXX_IDLE_FPS, frameCountOf('idle', name)),
    flipX,
  };
}

/**
 * Draw Gluteus Maxx with his tile's top-left at (sx, sy).
 *
 * Priority runs action → walk → idle, so a jab thrown on the move shows the
 * jab.
 */
export function drawGluteusMaxxSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: GluteusMaxxSpriteState = {},
  alpha = 1,
): void {
  const row = resolveRow(state);
  drawFigureCached(ctx, maxxFigureFor(row.base), row.name, row.frame, sx, sy, tileSize, {
    flipX: row.flipX,
    alpha,
  });
}

/**
 * How far above the top of his tile his hair reaches, standing or walking, in
 * tiles: where a health bar or an aggro marker has to sit to clear him.
 * Measured off the painted art, frozen here because nothing can measure ink at
 * runtime, and re-measured by `gateHeadClearance` in `scripts/gates-gluteus-maxx.ts`.
 */
export const GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES = 0.3;

/**
 * How far the walk phase turns per world pixel he actually covers, at a tile
 * size. One cycle covers exactly the ground his planted foot sweeps, so a
 * phase advanced by this keeps his feet from skating.
 */
export function gluteusMaxxWalkRadiansPerPixel(tileSize: number): number {
  return (Math.PI * 2) / (MAXX_WALK_GROUND_PER_CYCLE_TILES * tileSize);
}

/**
 * The most the walk phase may turn in one tick: one frame of the row. Ground
 * covered faster than he runs (a separation shove, a knockback) would
 * otherwise skip frames and strobe his legs.
 */
export const GLUTEUS_MAXX_MAX_WALK_RADIANS_PER_TICK =
  ((Math.PI * 2) / MAXX_WALK_FRAMES) * MAXX_MAX_WALK_FRAMES_PER_TICK;

/**
 * Every state name the draw path can ask for, built through the same
 * `maxxStateName` it uses, so this list and the draw call cannot disagree.
 */
export function gluteusMaxxReachableStates(): readonly string[] {
  return MAXX_ROW_BASES.flatMap((base) =>
    MAXX_FACINGS.map((facing) => maxxStateName(base, facing)),
  );
}

/** One row a prewarm asks the cache for, and how many of its frames. */
export interface MaxxWarmRequest {
  readonly figure: FigureDef;
  readonly state: string;
  /** Frames to warm from the start of the row; the whole row when absent. */
  readonly frames?: number;
}

/**
 * The rows warmed when a hire is scheduled: the ones he crosses the ground
 * and stands on, plus each jab up to its impact so the first punch is never a
 * cold bake.
 */
export function gluteusMaxxApproachWarmSet(): readonly MaxxWarmRequest[] {
  return MAXX_FACINGS.flatMap((facing): MaxxWarmRequest[] => [
    { figure: maxxFigureFor('walk'), state: maxxStateName('walk', facing) },
    { figure: maxxFigureFor('idle'), state: maxxStateName('idle', facing) },
    ...(['jab_left', 'jab_right'] as const).map((jab): MaxxWarmRequest => ({
      figure: maxxFigureFor(jab),
      state: maxxStateName(jab, facing),
      frames: MAXX_JAB_IMPACT_FRAME + 1,
    })),
  ]);
}

/**
 * The rows warmed when he engages: the flinch and the fall, played the moment
 * something hits him with no wind-up to hide a cold bake, and the finisher.
 */
export function gluteusMaxxFightWarmSet(): readonly MaxxWarmRequest[] {
  return [...wholeRows('hurt'), ...wholeRows('death'), ...wholeRows('crush')];
}

function wholeRows(base: MaxxRowBase): MaxxWarmRequest[] {
  return MAXX_FACINGS.map((facing) => ({
    figure: maxxFigureFor(base),
    state: maxxStateName(base, facing),
  }));
}

function warm(requests: readonly MaxxWarmRequest[]): void {
  for (const request of requests) prewarmFigureState(request.figure, request.state, request.frames);
}

/** Warms the approach set, when a hire is scheduled rather than when he first renders. */
export function prewarmGluteusMaxx(): void {
  warm(gluteusMaxxApproachWarmSet());
}

/** Warms the finisher, for a kit to call once a target is close to dying. */
export function prewarmGluteusMaxxCrush(): void {
  warm(wholeRows('crush'));
}

/** Warms the flinch and the fall, for a kit to call when he engages. */
export function prewarmGluteusMaxxReactions(): void {
  warm([...wholeRows('hurt'), ...wholeRows('death')]);
}
