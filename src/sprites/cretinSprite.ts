import { walkFrameIndex } from '../core/SpriteRenderer';
import { type CretinVariant, type CretinView } from './art/cretinArt';
import {
  CRETIN_ACTIONS,
  CRETIN_FIGURES,
  CRETIN_SHIELD_FIGURE,
  CRETIN_VIEWS,
  type CretinAction,
  type CretinShieldRow,
  cretinStateName,
} from './art/cretinFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
  CRETIN_DEATH_TICKS_PER_FRAME,
  CRETIN_HURT_TICKS_PER_FRAME,
  CRETIN_IDLE_TICKS_PER_FRAME,
  CRETIN_PUNCH_TICKS_PER_FRAME,
  CRETIN_ROBOT_TICKS_PER_FRAME,
  CRETIN_SHIELD_APPEAR_TICKS_PER_FRAME,
  CRETIN_SHIELD_FADE_TICKS_PER_FRAME,
  CRETIN_SHIELD_HOLD_TICKS_PER_FRAME,
  cretinLoopFrame,
  cretinOneShotFrame,
} from './cretinTiming';

export type { CretinVariant, CretinView } from './art/cretinArt';
export type { CretinAction, CretinShieldRow } from './art/cretinFigure';

/**
 * How each row is clocked. The walk is driven by distance covered and takes a
 * gait phase; the rest are played at a fixed number of game ticks per frame,
 * looping or holding their last frame.
 */
const ROW_CLOCK: Readonly<
  Record<Exclude<CretinAction, 'walk'>, { ticksPerFrame: number; loops: boolean }>
> = {
  idle: { ticksPerFrame: CRETIN_IDLE_TICKS_PER_FRAME, loops: true },
  robot: { ticksPerFrame: CRETIN_ROBOT_TICKS_PER_FRAME, loops: true },
  punch: { ticksPerFrame: CRETIN_PUNCH_TICKS_PER_FRAME, loops: false },
  cast_shield: { ticksPerFrame: CRETIN_CAST_SHIELD_TICKS_PER_FRAME, loops: false },
  hurt: { ticksPerFrame: CRETIN_HURT_TICKS_PER_FRAME, loops: false },
  death: { ticksPerFrame: CRETIN_DEATH_TICKS_PER_FRAME, loops: false },
};

/** Everything a Cretin draw needs to pick a cell. */
export interface CretinSpriteState {
  readonly variant: CretinVariant;
  readonly row: CretinAction;
  /** Facing vector; the dominant axis picks the view, and a profile facing −X is mirrored. */
  readonly facingX: number;
  readonly facingY: number;
  /**
   * Gait phase in radians for the walk, advanced by distance covered:
   * `2π / (CRETIN_WALK_TILES_PER_CYCLE * tileSize)` per pixel moved.
   */
  readonly walkPhase?: number;
  /**
   * Game ticks since the row started (one-shots), or a running clock (the idle
   * and the robot). A one-shot past its end holds its last frame — the death's
   * corpse frame among them.
   */
  readonly ticks?: number;
  /** Draw opacity, for a corpse fading out. */
  readonly alpha?: number;
}

/** Which view a facing vector selects: whichever axis it points along hardest. */
export function cretinViewFor(facingX: number, facingY: number): CretinView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** The sheet frame a state resolves to. */
export function cretinFrameFor(state: CretinSpriteState): number {
  const stateName = cretinStateName(state.row, cretinViewFor(state.facingX, state.facingY));
  const frames = Math.max(1, figureFrameCount(CRETIN_FIGURES[state.variant], stateName));
  if (state.row === 'walk') return walkFrameIndex(state.walkPhase ?? 0, frames);
  const clock = ROW_CLOCK[state.row];
  const ticks = state.ticks ?? 0;
  return clock.loops
    ? cretinLoopFrame(ticks, clock.ticksPerFrame, frames)
    : cretinOneShotFrame(ticks, clock.ticksPerFrame, frames);
}

/**
 * Draws a Cretin standing on the tile whose top-left corner is (sx, sy).
 *
 * The figure stands two tiles tall with its feet on the bottom of that tile;
 * health bars and markers belong over the tile, not over the art.
 */
export function drawCretinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CretinSpriteState,
): void {
  const view = cretinViewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(
    ctx,
    CRETIN_FIGURES[state.variant],
    cretinStateName(state.row, view),
    cretinFrameFor(state),
    sx,
    sy,
    tileSize,
    { flipX, alpha: state.alpha },
  );
}

/**
 * Every state a Cretin can be asked for, composed through the same
 * `cretinStateName` the draw path uses, so the two can never name different
 * rows.
 */
export function cretinReachableStates(): readonly string[] {
  return CRETIN_ACTIONS.flatMap((action) =>
    CRETIN_VIEWS.map((view) => cretinStateName(action, view)),
  );
}

/**
 * Warms the rows a Cretin is seen in first — standing and walking, in every
 * view — at the moment its appearance is scheduled (a hire, an escort being
 * booked) rather than when it first renders.
 */
export function prewarmCretin(variant: CretinVariant): void {
  prewarmCretinRows(variant, ['idle', 'walk']);
}

/** Warms the named rows of one Cretin in every view — its punch when it engages, say. */
export function prewarmCretinRows(variant: CretinVariant, actions: readonly CretinAction[]): void {
  const figure = CRETIN_FIGURES[variant];
  for (const action of actions) {
    for (const view of CRETIN_VIEWS) prewarmFigureState(figure, cretinStateName(action, view));
  }
}

// ── The Shield dome ──────────────────────────────────────────────────────────

const SHIELD_CLOCK: Readonly<Record<CretinShieldRow, { ticksPerFrame: number; loops: boolean }>> = {
  appear: { ticksPerFrame: CRETIN_SHIELD_APPEAR_TICKS_PER_FRAME, loops: false },
  hold: { ticksPerFrame: CRETIN_SHIELD_HOLD_TICKS_PER_FRAME, loops: true },
  fade: { ticksPerFrame: CRETIN_SHIELD_FADE_TICKS_PER_FRAME, loops: false },
};

export interface CretinShieldState {
  readonly row: CretinShieldRow;
  /** Ticks since the row started (appear, fade) or a running clock (hold). */
  readonly ticks: number;
  /**
   * Size of the dome relative to one sized for Carl, about his height and
   * shoulders. A smaller ally takes a smaller dome; the feet stay put.
   */
  readonly scale?: number;
  readonly alpha?: number;
}

/**
 * Draws the amber Shield over the ally standing on the tile whose top-left
 * corner is (sx, sy). Draw it after the ally so it sits over them.
 */
export function drawCretinShieldSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: CretinShieldState,
): void {
  const scale = state.scale ?? 1;
  const drawnTile = tileSize * scale;
  // Grown about the centre of the tile's bottom edge, where the ally's feet are.
  const left = sx + (tileSize - drawnTile) / 2;
  const top = sy + tileSize - drawnTile;
  const clock = SHIELD_CLOCK[state.row];
  const frames = Math.max(1, figureFrameCount(CRETIN_SHIELD_FIGURE, state.row));
  const frame = clock.loops
    ? cretinLoopFrame(state.ticks, clock.ticksPerFrame, frames)
    : cretinOneShotFrame(state.ticks, clock.ticksPerFrame, frames);
  drawFigureCached(ctx, CRETIN_SHIELD_FIGURE, state.row, frame, left, top, drawnTile, {
    alpha: state.alpha,
  });
}

/** Warms the dome's three rows, when a Cretin that can cast it is hired. */
export function prewarmCretinShield(): void {
  for (const row of ['appear', 'hold', 'fade'] as const)
    prewarmFigureState(CRETIN_SHIELD_FIGURE, row);
}
