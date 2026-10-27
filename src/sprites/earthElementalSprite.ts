import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { type EarthElementalVariant, type EarthElementalView } from './art/earthElementalArt';
import {
  EARTH_ELEMENTAL_ACTIONS,
  EARTH_ELEMENTAL_FIGURES,
  EARTH_ELEMENTAL_SHIELD_FIGURE,
  EARTH_ELEMENTAL_VIEWS,
  type EarthElementalAction,
  type EarthElementalShieldRow,
  earthElementalStateName,
} from './art/earthElementalFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_DEATH_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_IDLE_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_SHIELD_APPEAR_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_SHIELD_FADE_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_SHIELD_HOLD_TICKS_PER_FRAME,
  earthElementalLoopFrame,
  earthElementalOneShotFrame,
} from './earthElementalTiming';

export type { EarthElementalVariant, EarthElementalView } from './art/earthElementalArt';
export type { EarthElementalAction, EarthElementalShieldRow } from './art/earthElementalFigure';

/**
 * How each row is clocked. The walk is driven by distance covered and takes a
 * gait phase; the rest are played at a fixed number of game ticks per frame,
 * looping or holding their last frame.
 */
const ROW_CLOCK: Readonly<
  Record<Exclude<EarthElementalAction, 'walk'>, { ticksPerFrame: number; loops: boolean }>
> = {
  idle: { ticksPerFrame: EARTH_ELEMENTAL_IDLE_TICKS_PER_FRAME, loops: true },
  punch: { ticksPerFrame: EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME, loops: false },
  cast_shield: { ticksPerFrame: EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME, loops: false },
  hurt: { ticksPerFrame: EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME, loops: false },
  death: { ticksPerFrame: EARTH_ELEMENTAL_DEATH_TICKS_PER_FRAME, loops: false },
};

/** Everything an Earth Elemental draw needs to pick a cell. */
export interface EarthElementalSpriteState {
  readonly variant: EarthElementalVariant;
  readonly row: EarthElementalAction;
  /** Facing vector; the dominant axis picks the view, and a profile facing −X is mirrored. */
  readonly facingX: number;
  readonly facingY: number;
  /**
   * Gait phase in radians for the walk, advanced by distance covered:
   * `2π / (EARTH_ELEMENTAL_WALK_TILES_PER_CYCLE * tileSize)` per pixel moved.
   */
  readonly walkPhase?: number;
  /**
   * Game ticks since the row started (one-shots), or a running clock (the idle). A one-shot past its end holds its last frame — the death's
   * corpse frame among them.
   */
  readonly ticks?: number;
  /** Draw opacity, for a corpse fading out. */
  readonly alpha?: number;
}

/** Which view a facing vector selects: whichever axis it points along hardest. */
export function earthElementalViewFor(facingX: number, facingY: number): EarthElementalView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** The sheet frame a state resolves to. */
export function earthElementalFrameFor(state: EarthElementalSpriteState): number {
  const stateName = earthElementalStateName(
    state.row,
    earthElementalViewFor(state.facingX, state.facingY),
  );
  const frames = Math.max(1, figureFrameCount(EARTH_ELEMENTAL_FIGURES[state.variant], stateName));
  if (state.row === 'walk') return walkFrameIndex(state.walkPhase ?? 0, frames);
  const clock = ROW_CLOCK[state.row];
  const ticks = state.ticks ?? 0;
  return clock.loops
    ? earthElementalLoopFrame(ticks, clock.ticksPerFrame, frames)
    : earthElementalOneShotFrame(ticks, clock.ticksPerFrame, frames);
}

/**
 * Draws an Earth Elemental standing on the tile whose top-left corner is (sx, sy).
 *
 * The figure stands two tiles tall with its feet on the bottom of that tile;
 * health bars and markers belong over the tile, not over the art.
 */
export function drawEarthElementalSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: EarthElementalSpriteState,
): void {
  const view = earthElementalViewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;
  drawFigureCached(
    ctx,
    EARTH_ELEMENTAL_FIGURES[state.variant],
    earthElementalStateName(state.row, view),
    earthElementalFrameFor(state),
    sx,
    sy,
    tileSize,
    { flipX, alpha: state.alpha },
  );
}

/**
 * Every state an Earth Elemental can be asked for, composed through the same
 * `earthElementalStateName` the draw path uses, so the two can never name different
 * rows.
 */
export function earthElementalReachableStates(): readonly string[] {
  return EARTH_ELEMENTAL_ACTIONS.flatMap((action) =>
    EARTH_ELEMENTAL_VIEWS.map((view) => earthElementalStateName(action, view)),
  );
}

/**
 * Warms the rows an Earth Elemental is seen in first — standing and walking, in every
 * view — at the moment its appearance is scheduled (a hire, an escort being
 * booked) rather than when it first renders.
 */
export function prewarmEarthElemental(variant: EarthElementalVariant): void {
  prewarmEarthElementalRows(variant, ['idle', 'walk']);
}

/** Warms the named rows of one Earth Elemental in every view — its punch when it engages, say. */
export function prewarmEarthElementalRows(
  variant: EarthElementalVariant,
  actions: readonly EarthElementalAction[],
): void {
  const figure = EARTH_ELEMENTAL_FIGURES[variant];
  for (const action of actions) {
    for (const view of EARTH_ELEMENTAL_VIEWS)
      prewarmFigureState(figure, earthElementalStateName(action, view));
  }
}

// ── The Shield dome ──────────────────────────────────────────────────────────

const SHIELD_CLOCK: Readonly<
  Record<EarthElementalShieldRow, { ticksPerFrame: number; loops: boolean }>
> = {
  appear: { ticksPerFrame: EARTH_ELEMENTAL_SHIELD_APPEAR_TICKS_PER_FRAME, loops: false },
  hold: { ticksPerFrame: EARTH_ELEMENTAL_SHIELD_HOLD_TICKS_PER_FRAME, loops: true },
  fade: { ticksPerFrame: EARTH_ELEMENTAL_SHIELD_FADE_TICKS_PER_FRAME, loops: false },
};

export interface EarthElementalShieldState {
  readonly row: EarthElementalShieldRow;
  /** Ticks since the row started (appear, fade) or a running clock (hold). */
  readonly ticks: number;
  /**
   * Size of the dome relative to one sized for the human crawler, about his height and
   * shoulders. A smaller ally takes a smaller dome; the feet stay put.
   */
  readonly scale?: number;
  readonly alpha?: number;
}

/**
 * Draws the amber Shield over the ally standing on the tile whose top-left
 * corner is (sx, sy). Draw it after the ally so it sits over them.
 */
export function drawEarthElementalShieldSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: EarthElementalShieldState,
): void {
  const scale = state.scale ?? 1;
  const drawnTile = tileSize * scale;
  // Grown about the centre of the tile's bottom edge, where the ally's feet are.
  const left = sx + (tileSize - drawnTile) / 2;
  const top = sy + tileSize - drawnTile;
  const clock = SHIELD_CLOCK[state.row];
  const frames = Math.max(1, figureFrameCount(EARTH_ELEMENTAL_SHIELD_FIGURE, state.row));
  const frame = clock.loops
    ? earthElementalLoopFrame(state.ticks, clock.ticksPerFrame, frames)
    : earthElementalOneShotFrame(state.ticks, clock.ticksPerFrame, frames);
  drawFigureCached(ctx, EARTH_ELEMENTAL_SHIELD_FIGURE, state.row, frame, left, top, drawnTile, {
    alpha: state.alpha,
  });
}

/** Warms the dome's three rows, when an Earth Elemental that can cast it is hired. */
export function prewarmEarthElementalShield(): void {
  for (const row of ['appear', 'hold', 'fade'] as const)
    prewarmFigureState(EARTH_ELEMENTAL_SHIELD_FIGURE, row);
}
