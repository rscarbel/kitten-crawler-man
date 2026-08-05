import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';

/**
 * The Hoarder's sheet has three views of every state, so which row is drawn is
 * decided here rather than in the creature — the same split every other
 * generated mob uses.
 *
 * `scripts/generate-hoarder-sprite.ts` owns the frame counts and the release
 * frame; the runtime cannot import from `scripts/`, so the numbers below are
 * duplicated and a bake gate holds the two equal.
 */

type HoarderView = 'front' | 'side' | 'away';
type HoarderBase = 'walk' | 'vomit' | 'idle';
type HoarderState =
  | 'walk'
  | 'walk_side'
  | 'walk_back'
  | 'vomit'
  | 'vomit_side'
  | 'vomit_back'
  | 'idle'
  | 'idle_side'
  | 'idle_back';

export const HOARDER_WALK_FRAMES = 12;
export const HOARDER_VOMIT_FRAMES = 12;
export const HOARDER_IDLE_FRAMES = 6;

/**
 * The frame the bolus leaves her mouth on, and the progress through the row at
 * which that frame is showing. `TheHoarder` fires the projectile on exactly
 * this progress so the bile appears the instant her jaw comes off its hinge.
 */
export const HOARDER_VOMIT_RELEASE_FRAME = 7;
export const HOARDER_VOMIT_RELEASE_PROGRESS =
  (HOARDER_VOMIT_RELEASE_FRAME + 0.5) / HOARDER_VOMIT_FRAMES;

/**
 * `drawSprite` clamps the frame index, so a row that lost frames would freeze
 * silently rather than error. Declaring the counts here is what lets the gate
 * catch that instead.
 */
export const HOARDER_FRAME_COUNT: Record<HoarderState, number> = {
  walk: HOARDER_WALK_FRAMES,
  walk_side: HOARDER_WALK_FRAMES,
  walk_back: HOARDER_WALK_FRAMES,
  vomit: HOARDER_VOMIT_FRAMES,
  vomit_side: HOARDER_VOMIT_FRAMES,
  vomit_back: HOARDER_VOMIT_FRAMES,
  idle: HOARDER_IDLE_FRAMES,
  idle_side: HOARDER_IDLE_FRAMES,
  idle_back: HOARDER_IDLE_FRAMES,
};

/**
 * The six pieces she comes apart into, in the generator's own order.
 * `BodyPartGoreSystem` reads this list; a bake gate holds it equal to the
 * sheet's gore columns, which is the one link in the chain that otherwise fails
 * silently — a renamed state is simply skipped at draw time.
 */
export const HOARDER_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_right_arm',
  'gore_left_arm',
  'gore_left_leg',
  'gore_right_leg',
  'gore_torso',
];

export const HOARDER_BODY_PART_KEY = 'hoarder';

export interface HoarderSpriteState {
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
  /** Progress through the vomit row, or null when she is not vomiting. */
  vomitProgress?: number | null;
  /** Pins the idle clock, for the preview harness. */
  idleFrame?: number | null;
}

/** Side wins ties: a diagonal reads better as a profile than as a head-on. */
function viewFor(facingX: number, facingY: number): HoarderView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * Spelled out rather than built from a template literal: a template gives back
 * a plain `string`, and the only way to hand that to `drawSpriteKey` is a cast.
 */
const STATE_OF: Record<HoarderBase, Record<HoarderView, HoarderState>> = {
  walk: { front: 'walk', side: 'walk_side', away: 'walk_back' },
  vomit: { front: 'vomit', side: 'vomit_side', away: 'vomit_back' },
  idle: { front: 'idle', side: 'idle_side', away: 'idle_back' },
};

function stateFor(base: HoarderBase, view: HoarderView): HoarderState {
  return STATE_OF[base][view];
}

const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

export function drawHoarderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: HoarderSpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  // Only the profile is mirrored; the head-on and away rows are drawn as they
  // are, and flipping one of those would swap which of her arms is in front.
  const flipX = view === 'side' && facingX < 0;

  if (state.vomitProgress !== null && state.vomitProgress !== undefined) {
    const key = stateFor('vomit', view);
    const frame = progressFrameIndex(state.vomitProgress, HOARDER_FRAME_COUNT[key]);
    drawSpriteKey(ctx, 'hoarder', key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  if (state.isMoving === true) {
    const key = stateFor('walk', view);
    const frame = walkFrameIndex(state.walkFrame ?? 0, HOARDER_FRAME_COUNT[key]);
    drawSpriteKey(ctx, 'hoarder', key, frame, sx, sy, tileSize, { flipX });
    return;
  }

  const key = stateFor('idle', view);
  const frames = HOARDER_FRAME_COUNT[key];
  // Clock-driven rather than tied to her own walk phase, so two of her — the
  // preview harness draws several — do not breathe in lockstep.
  const idleFrame =
    state.idleFrame ?? timeFrameIndex(Date.now() / MILLISECONDS_PER_SECOND, IDLE_FPS, frames);
  drawSpriteKey(ctx, 'hoarder', key, idleFrame % frames, sx, sy, tileSize, { flipX });
}
