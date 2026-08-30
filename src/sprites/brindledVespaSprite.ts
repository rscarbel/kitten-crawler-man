import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { BRINDLED_VESPA_FIGURE } from './art/brindledVespaFigure';
import {
  SPIT_STATE,
  VESPA_ACID_SPIT_IMPACT_FIGURE,
  VESPA_ACID_SPIT_PROJECTILE_FIGURE,
} from './art/vespaSpitFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const HOVER_FPS = 8;
const PERF_NOW_TO_SECONDS = 1000;

/** Which of the figure's three viewpoints a facing vector selects, mirroring Mantid's `viewFor()`. */
type VespaView = 'front' | 'side' | 'away';

/** The action a hornet is showing, before it is resolved against a viewpoint. */
type VespaAction = 'hover' | 'spit_windup';

function viewFor(facingX: number, facingY: number): VespaView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: VespaAction, view: VespaView): string {
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
  return Math.max(1, figureFrameCount(BRINDLED_VESPA_FIGURE, state));
}

/** Everything the Vespa sprite needs to pick a pose. */
export interface VespaSpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the charge-up, 1 at the last; null when not winding up. */
  readonly spitWindupProgress?: number | null;
}

export function drawBrindledVespaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: VespaSpriteState = {},
): void {
  const { facingX = 1, facingY = 0, spitWindupProgress = null } = state;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;

  if (spitWindupProgress !== null) {
    const key = stateFor('spit_windup', view);
    drawFigureCached(
      ctx,
      BRINDLED_VESPA_FIGURE,
      key,
      progressFrameIndex(spitWindupProgress, frameCountOf(key)),
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
    BRINDLED_VESPA_FIGURE,
    key,
    timeFrameIndex(performance.now() / PERF_NOW_TO_SECONDS, HOVER_FPS, frameCountOf(key)),
    sx,
    sy,
    s,
    { flipX },
  );
}

const VESPA_VIEWS: ReadonlyArray<VespaView> = ['front', 'side', 'away'];
const VESPA_ACTIONS: ReadonlyArray<VespaAction> = ['hover', 'spit_windup'];

/**
 * Every state name `drawBrindledVespaSprite` can ask the figure for.
 *
 * Composed through `stateFor` rather than listed by hand, so a view or an action
 * added to one is present in the other. The art gates feed this to
 * `missingStateFailures`: the draw path returns silently on a state the figure
 * does not paint, so a name only the runtime knows is an invisible creature and
 * no log line.
 */
export const BRINDLED_VESPA_STATES: ReadonlyArray<string> = VESPA_ACTIONS.flatMap((action) =>
  VESPA_VIEWS.map((view) => stateFor(action, view)),
);

/**
 * Warms every row the hornet can draw, called a second before the grub it grows
 * out of finishes evolving.
 *
 * An evolution is a spawn with a clock on it, and it is the only warning this
 * creature has: a Vespa exists from one frame to the next, hovering
 * immediately, and starts winding up a spit as soon as something walks into
 * range. Both rows are warmed together because there is no second telegraph
 * between them.
 */
export function prewarmBrindledVespa(): void {
  for (const state of BRINDLED_VESPA_STATES) prewarmFigureState(BRINDLED_VESPA_FIGURE, state);
}

/**
 * Warms the severed pieces, which are all requested on the one frame a Vespa
 * comes apart, with no telegraph of their own.
 */
export function prewarmBrindledVespaGore(): void {
  for (const part of BRINDLED_VESPA_GORE_PARTS) {
    prewarmFigureState(BRINDLED_VESPA_FIGURE, part);
  }
}

/**
 * The eight pieces a Brindled Vespa comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side:
 * `src/sprites/art/brindledVespaGore.ts` paints them in this order and
 * `BodyPartGoreSystem` spawns them in it.
 */
export const BRINDLED_VESPA_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_thorax',
  'gore_abdomen',
  'gore_stinger',
  'gore_wing',
  'gore_leg',
  'gore_antenna',
  'gore_entrails',
];

/** The `BodyPartGoreSystem` registry key the Vespa's flying pieces come from. */
export const BRINDLED_VESPA_BODY_PART_KEY = 'brindled_vespa';

// ── Acid spit projectile + impact ───────────────────────────────────────────

const SPIT_PROJECTILE_FRAME_COUNT = figureFrameCount(VESPA_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE);
const SPIT_PROJECTILE_FPS = 14;
const SPIT_IMPACT_FRAME_COUNT = figureFrameCount(VESPA_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE);

/**
 * Warms both spit rows when the hornet starts its wind-up.
 *
 * The wind-up is the only warning either row gets: the glob is drawn on the
 * frame it launches, and the splash a flight after that.
 */
export function prewarmVespaSpit(): void {
  prewarmFigureState(VESPA_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE);
  prewarmFigureState(VESPA_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE);
}
/** How long the impact splash plays before `BrindleGrub` stops drawing it. */
export const SPIT_IMPACT_TOTAL_FRAMES = 24;

/**
 * Draws the acid spit: an in-flight glowing glob rotated to face its own
 * velocity, or (once it has hit something) the bubbling impact splash.
 *
 * `hitAge` is frames elapsed since impact, 0 while still in flight. Kept as a
 * frame count rather than a 0–1 progress so `BrindleGrub` doesn't need to know
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
    drawFigureCached(ctx, VESPA_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE, frame, sx, sy, tileSize);
    return;
  }

  const rotation = Math.atan2(vy, vx);
  const nowSeconds = performance.now() / PERF_NOW_TO_SECONDS;
  drawFigureCached(
    ctx,
    VESPA_ACID_SPIT_PROJECTILE_FIGURE,
    SPIT_STATE,
    timeFrameIndex(nowSeconds, SPIT_PROJECTILE_FPS, SPIT_PROJECTILE_FRAME_COUNT),
    sx,
    sy,
    tileSize,
    { rotation },
  );
}
