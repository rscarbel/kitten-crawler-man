import npcsManifest from '../images/npcs/manifest.json';
import { drawSpriteKey, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

type RatKinState = SpriteStates['rat_kin'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type RatKinView = 'front' | 'side' | 'away';

/**
 * Frame counts read straight out of the manifest the bake writes, rather than
 * retyped here.
 *
 * A hand-kept copy is invisible when it drifts: `drawSprite` clamps the index,
 * so too many frames stalls the animation on its last one and too few leaves
 * frames that never play — neither raises anything. The bake's manifest gate
 * already pins the manifest to the sheet, so reading from it closes the loop.
 */
const FRAME_COUNT: Record<RatKinState, number> = {
  walk: npcsManifest.rat_kin.states.walk.frameCount,
  walk_side: npcsManifest.rat_kin.states.walk_side.frameCount,
  walk_away: npcsManifest.rat_kin.states.walk_away.frameCount,
  idle: npcsManifest.rat_kin.states.idle.frameCount,
  idle_side: npcsManifest.rat_kin.states.idle_side.frameCount,
  idle_away: npcsManifest.rat_kin.states.idle_away.frameCount,
};

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 8;
const MS_PER_SECOND = 1000;

/**
 * Ground the baked walk covers in one full cycle, in tiles.
 *
 * The sheet's stance foot is planted: it holds still on the floor while the body
 * travels over it. That only reads as walking if the caller advances the cycle
 * at the rate he is actually moving — pace a walk with a phase speed derived
 * from distance, never by scaling the frame index against a frame counter, or
 * the feet skate.
 *
 * `npm run gen:rat-kin` prints this figure on every bake and the stride-sync
 * gate fails if this constant drifts from it, because the runtime cannot import
 * from `scripts/` (rootDir is `src/`).
 */
export const RAT_KIN_TILES_PER_WALK_CYCLE = 0.4303;

/** Everything the Rat Kin sprite needs to pick a pose. */
export interface RatKinSpriteState {
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * Phase offset for the idle loop, so two Mordecais on one floor do not breathe
   * in lockstep. The idle runs off the wall clock, which is identical for both.
   */
  readonly idleOffsetSeconds?: number;
}

/** Views split on whichever axis he is facing hardest along. */
function viewFor(facingX: number, facingY: number): RatKinView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'walk' | 'idle', view: RatKinView): RatKinState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the Rat Kin.
 *
 * Only the profile art is mirrored: flipping a head-on view would swap the side
 * his satchel hangs on every time he turned around.
 */
export function drawRatKinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RatKinSpriteState,
): void {
  const view = viewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;

  if (state.isWalking) {
    const key = stateFor('walk', view);
    const frame = walkFrameIndex(state.walkPhase, FRAME_COUNT[key]);
    drawSpriteKey(ctx, 'rat_kin', key, frame, sx, sy, s, { flipX });
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MS_PER_SECOND + (state.idleOffsetSeconds ?? 0);
  const frame = timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]);
  drawSpriteKey(ctx, 'rat_kin', key, frame, sx, sy, s, { flipX });
}
