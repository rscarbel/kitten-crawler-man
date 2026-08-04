import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

const HOVER_FRAME_COUNT = 8;
const HOVER_FPS = 8;
const WINDUP_FRAME_COUNT = 9;
const PERF_NOW_TO_SECONDS = 1000;

/** Which of the sheet's three viewpoints a facing vector selects, mirroring Mantid's `viewFor()`. */
type VespaView = 'front' | 'side' | 'away';

function viewFor(facingX: number, facingY: number): VespaView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'hover' | 'spit_windup', view: VespaView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the Vespa sprite needs to pick a pose. */
export interface VespaSpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of the charge-up, 1 at the last; null when not winding up. */
  readonly spitWindupProgress?: number | null;
}

function isVespaState(
  state: string,
): state is
  'hover' | 'hover_side' | 'hover_away' | 'spit_windup' | 'spit_windup_side' | 'spit_windup_away' {
  return (
    state === 'hover' ||
    state === 'hover_side' ||
    state === 'hover_away' ||
    state === 'spit_windup' ||
    state === 'spit_windup_side' ||
    state === 'spit_windup_away'
  );
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
    if (!isVespaState(key)) return;
    drawSpriteKey(
      ctx,
      'brindled_vespa',
      key,
      progressFrameIndex(spitWindupProgress, WINDUP_FRAME_COUNT),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  const key = stateFor('hover', view);
  if (!isVespaState(key)) return;
  drawSpriteKey(
    ctx,
    'brindled_vespa',
    key,
    timeFrameIndex(performance.now() / PERF_NOW_TO_SECONDS, HOVER_FPS, HOVER_FRAME_COUNT),
    sx,
    sy,
    s,
    { flipX },
  );
}

/**
 * The eight pieces a Brindled Vespa comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/brindledVespaGore.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it.
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

const SPIT_PROJECTILE_FRAME_COUNT = 6;
const SPIT_PROJECTILE_FPS = 14;
const SPIT_IMPACT_FRAME_COUNT = 8;
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
    drawSpriteKey(ctx, 'vespa_acid_spit_impact', 'default', frame, sx, sy, tileSize);
    return;
  }

  const rotation = Math.atan2(vy, vx);
  const nowSeconds = performance.now() / PERF_NOW_TO_SECONDS;
  drawSpriteKey(
    ctx,
    'vespa_acid_spit_projectile',
    'default',
    timeFrameIndex(nowSeconds, SPIT_PROJECTILE_FPS, SPIT_PROJECTILE_FRAME_COUNT),
    sx,
    sy,
    tileSize,
    { rotation },
  );
}
