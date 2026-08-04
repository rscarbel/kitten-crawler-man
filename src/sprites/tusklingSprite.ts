import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import {
  TUSKLING_CHARGE_FRAMES,
  TUSKLING_HOOK_FRAMES,
  TUSKLING_IDLE_FRAMES,
  TUSKLING_SNORT_FRAMES,
  TUSKLING_WALK_FRAMES,
} from './tusklingAttackTiming';

/**
 * The three views the sheet carries. There is no fourth row: the profile is
 * mirrored for the other direction, and mirroring a head-on view would put the
 * creature's eyes and hooves on the wrong sides every time it turned around.
 */
type TusklingView = 'front' | 'side' | 'away';

type TusklingBase = 'idle' | 'walk' | 'hook' | 'snort' | 'charge';

type TusklingState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'hook'
  | 'hook_side'
  | 'hook_away'
  | 'snort'
  | 'snort_side'
  | 'snort_away'
  | 'charge'
  | 'charge_side'
  | 'charge_away';

/**
 * Exhaustive by construction: a row added to the manifest but not to this map
 * is a compile error, which is safer than reading the count off the sheet —
 * `drawSprite` *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<TusklingState, number> = {
  idle: TUSKLING_IDLE_FRAMES,
  idle_side: TUSKLING_IDLE_FRAMES,
  idle_away: TUSKLING_IDLE_FRAMES,
  walk: TUSKLING_WALK_FRAMES,
  walk_side: TUSKLING_WALK_FRAMES,
  walk_away: TUSKLING_WALK_FRAMES,
  hook: TUSKLING_HOOK_FRAMES,
  hook_side: TUSKLING_HOOK_FRAMES,
  hook_away: TUSKLING_HOOK_FRAMES,
  snort: TUSKLING_SNORT_FRAMES,
  snort_side: TUSKLING_SNORT_FRAMES,
  snort_away: TUSKLING_SNORT_FRAMES,
  charge: TUSKLING_CHARGE_FRAMES,
  charge_side: TUSKLING_CHARGE_FRAMES,
  charge_away: TUSKLING_CHARGE_FRAMES,
};

/**
 * The severed pieces, in the order the bake lays them into the gore row.
 * `BodyPartGoreSystem` silently skips a state it cannot find, so this list and
 * `GORE_STATES` in the generator are held equal by a bake gate.
 */
export const TUSKLING_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_arm',
  'gore_leg',
  'gore_ribcage',
  'gore_entrails',
  'gore_tusk',
  'gore_jaw',
];

export const TUSKLING_BODY_PART_KEY = 'tuskling';

/** Frames per second the idle cycle runs at, off the wall clock. */
const IDLE_FPS = 8;
const MILLISECONDS_PER_SECOND = 1000;

export interface TusklingSpriteState {
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through the tusk hook, or null when it is not attacking. */
  readonly hookProgress?: number | null;
  /** 0–1 through the charge wind-up, or null when it is not winding up. */
  readonly snortProgress?: number | null;
  /** Sprite frame of the charging run, or null when it is not charging. */
  readonly chargeFrame?: number | null;
  /** Pins the clock-driven idle, for the preview harness. */
  readonly idleFrame?: number;
}

/** Views split on whichever axis the creature is facing hardest along. */
function viewFor(facingX: number, facingY: number): TusklingView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: TusklingBase, view: TusklingView): TusklingState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draws a Tuskling.
 *
 * Priority is hook → wind-up → charge → walk → idle, so a committed attack
 * always wins over the approach it interrupted.
 */
export function drawTusklingSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: TusklingSpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;
  const opts = { flipX };

  const hookProgress = state.hookProgress ?? null;
  if (hookProgress !== null) {
    const key = stateFor('hook', view);
    drawSpriteKey(
      ctx,
      'tuskling',
      key,
      progressFrameIndex(hookProgress, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const snortProgress = state.snortProgress ?? null;
  if (snortProgress !== null) {
    const key = stateFor('snort', view);
    drawSpriteKey(
      ctx,
      'tuskling',
      key,
      progressFrameIndex(snortProgress, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const chargeFrame = state.chargeFrame ?? null;
  if (chargeFrame !== null) {
    const key = stateFor('charge', view);
    drawSpriteKey(ctx, 'tuskling', key, chargeFrame % FRAME_COUNT[key], sx, sy, tileSize, opts);
    return;
  }

  if (state.isMoving === true) {
    const key = stateFor('walk', view);
    drawSpriteKey(
      ctx,
      'tuskling',
      key,
      walkFrameIndex(state.walkFrame ?? 0, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  // Clock-driven rather than timer-driven so that two Tusklings in the same
  // room do not breathe in lockstep.
  drawSpriteKey(
    ctx,
    'tuskling',
    key,
    state.idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    tileSize,
    opts,
  );
}
