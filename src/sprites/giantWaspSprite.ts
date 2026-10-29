import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { GIANT_WASP_FIGURE, type WaspAction } from './art/giantWaspFigure';
import {
  SPIT_STATE,
  WASP_ACID_SPIT_IMPACT_FIGURE,
  WASP_ACID_SPIT_PROJECTILE_FIGURE,
} from './art/waspSpitFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const HOVER_FPS = 8;
const PERF_NOW_TO_SECONDS = 1000;

/** Which of the figure's three viewpoints a facing vector selects, mirroring Mantid's `viewFor()`. */
type WaspView = 'front' | 'side' | 'away';

function viewFor(facingX: number, facingY: number): WaspView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: WaspAction, view: WaspView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * How many frames a row actually holds, read from the figure that paints it.
 *
 * Not a hand-copied table: `drawFigureCached` *clamps* the frame index, so a row
 * that got shorter would silently freeze on its last frame rather than throw.
 * There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(GIANT_WASP_FIGURE, state));
}

/** Everything the wasp sprite needs to pick a pose. */
export interface WaspSpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the charge-up, 1 at the last; null when not winding up. */
  readonly spitWindupProgress?: number | null;
  /** 0 at the first frame of the sting, 1 at the last; null when not stinging. */
  readonly stingProgress?: number | null;
}

export function drawGiantWaspSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: WaspSpriteState = {},
): void {
  const { facingX = 1, facingY = 0, spitWindupProgress = null, stingProgress = null } = state;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  const oneShot =
    stingProgress !== null
      ? { action: 'sting' as const, progress: stingProgress }
      : spitWindupProgress !== null
        ? { action: 'spit_windup' as const, progress: spitWindupProgress }
        : null;
  if (oneShot !== null) {
    const key = stateFor(oneShot.action, view);
    drawFigureCached(
      ctx,
      GIANT_WASP_FIGURE,
      key,
      progressFrameIndex(oneShot.progress, frameCountOf(key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  const key = stateFor('hover', view);
  drawFigureCached(
    ctx,
    GIANT_WASP_FIGURE,
    key,
    timeFrameIndex(performance.now() / PERF_NOW_TO_SECONDS, HOVER_FPS, frameCountOf(key)),
    sx,
    sy,
    s,
    { flipX },
  );
}

const WASP_VIEWS: ReadonlyArray<WaspView> = ['front', 'side', 'away'];
const WASP_ACTIONS: ReadonlyArray<WaspAction> = ['hover', 'spit_windup', 'sting'];

/**
 * Every state name `drawGiantWaspSprite` can ask the figure for.
 *
 * Composed through `stateFor` rather than listed by hand, so a view or an action
 * added to one is present in the other. The art gates feed this to
 * `missingStateFailures`: the draw path returns silently on a state the figure
 * does not paint, so a name only the runtime knows is an invisible creature and
 * no log line.
 */
export const GIANT_WASP_STATES: ReadonlyArray<string> = WASP_ACTIONS.flatMap((action) =>
  WASP_VIEWS.map((view) => stateFor(action, view)),
);

/**
 * Warms every row the wasp can draw.
 *
 * A wasp hovers from the frame it appears and starts winding up a spit or a
 * sting as soon as something comes into range, with no second telegraph
 * between them, so every row is warmed together.
 */
export function prewarmGiantWasp(): void {
  for (const state of GIANT_WASP_STATES) prewarmFigureState(GIANT_WASP_FIGURE, state);
}

/**
 * Warms the severed pieces, which are all requested on the one frame a wasp
 * comes apart, with no telegraph of their own.
 */
export function prewarmGiantWaspGore(): void {
  for (const part of GIANT_WASP_GORE_PARTS) {
    prewarmFigureState(GIANT_WASP_FIGURE, part);
  }
}

/**
 * The eight pieces a Giant Wasp comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side:
 * `src/sprites/art/giantWaspGore.ts` paints them in this order and
 * `BodyPartGoreSystem` spawns them in it.
 */
export const GIANT_WASP_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_thorax',
  'gore_abdomen',
  'gore_stinger',
  'gore_wing',
  'gore_leg',
  'gore_antenna',
  'gore_entrails',
];

/** The `BodyPartGoreSystem` registry key the wasp's flying pieces come from. */
export const GIANT_WASP_BODY_PART_KEY = 'giant_wasp';

// ── Acid spit projectile + impact ───────────────────────────────────────────

const SPIT_PROJECTILE_FRAME_COUNT = figureFrameCount(WASP_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE);
const SPIT_PROJECTILE_FPS = 14;
const SPIT_IMPACT_FRAME_COUNT = figureFrameCount(WASP_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE);

/**
 * Warms both spit rows when the wasp starts its wind-up.
 *
 * The wind-up is the only warning either row gets: the glob is drawn on the
 * frame it launches, and the splash a flight after that.
 */
export function prewarmWaspSpit(): void {
  prewarmFigureState(WASP_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE);
  prewarmFigureState(WASP_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE);
}
/** How long the impact splash plays before its owner stops drawing it. */
export const SPIT_IMPACT_TOTAL_FRAMES = 24;

/**
 * Draws the acid spit: an in-flight glowing glob rotated to face its own
 * velocity, or (once it has hit something) the bubbling impact splash.
 *
 * `hitAge` is frames elapsed since impact, 0 while still in flight. Kept as a
 * frame count rather than a 0–1 progress so the owner doesn't need to know
 * the impact row's length to drive it.
 */
export function drawAcidSpit(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  vx: number,
  vy: number,
  hit: boolean,
  hitAge: number,
): void {
  if (hit) {
    const frame = Math.min(
      SPIT_IMPACT_FRAME_COUNT - 1,
      Math.floor((hitAge / SPIT_IMPACT_TOTAL_FRAMES) * SPIT_IMPACT_FRAME_COUNT),
    );
    drawFigureCached(ctx, WASP_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE, frame, sx, sy, tileSize);
    return;
  }

  const rotation = Math.atan2(vy, vx);
  const nowSeconds = performance.now() / PERF_NOW_TO_SECONDS;
  drawFigureCached(
    ctx,
    WASP_ACID_SPIT_PROJECTILE_FIGURE,
    SPIT_STATE,
    timeFrameIndex(nowSeconds, SPIT_PROJECTILE_FPS, SPIT_PROJECTILE_FRAME_COUNT),
    sx,
    sy,
    tileSize,
    { rotation },
  );
}
