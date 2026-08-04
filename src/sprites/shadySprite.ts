import npcsManifest from '../images/npcs/manifest.json';
import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

type ShadyState = SpriteStates['shady'];

/**
 * Frame counts read straight out of the manifest the bake writes, rather than
 * retyped here. A hand-kept copy is invisible when it drifts: `drawSprite`
 * clamps the index, so too many frames stalls the animation on its last one and
 * too few leaves frames that never play — neither raises anything.
 */
const FRAME_COUNT: Record<ShadyState, number> = {
  idle: npcsManifest.shady.states.idle.frameCount,
  scratch: npcsManifest.shady.states.scratch.frameCount,
  talk: npcsManifest.shady.states.talk.frameCount,
};

/** Loop speed for the fidget, which is driven by the clock rather than a timer. */
const IDLE_FPS = 9;
/**
 * How long the scratch one-shot runs, in game frames. Owned here beside the
 * frame count it has to spread across, so the creature cannot pick a duration
 * that plays the row at a different speed from the rest of him.
 */
export const SCRATCH_DURATION_FRAMES = 66;
const MS_PER_SECOND = 1000;

/** Everything the sprite needs to pick a pose. */
export interface ShadySpriteState {
  /** What he is doing. `scratch` and `talk` both override the idle fidget. */
  readonly activity: 'idle' | 'scratch' | 'talk';
  /** Progress through the scratch one-shot, 0–1. Ignored unless scratching. */
  readonly scratchProgress: number;
  /**
   * Phase offset for the looping rows, so a second Shady in a test scene would
   * not fidget in lockstep with him. The loops run off the wall clock, which is
   * identical for every instance.
   */
  readonly loopOffsetSeconds: number;
}

/**
 * Draw Shady.
 *
 * Never mirrored: he has one baked facing and stands at a fixed spot, and the
 * flip would put his belt pouch on the wrong hip.
 */
export function drawShadySprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: ShadySpriteState,
): void {
  if (state.activity === 'scratch') {
    const frame = progressFrameIndex(state.scratchProgress, FRAME_COUNT.scratch);
    drawSpriteKey(ctx, 'shady', 'scratch', frame, sx, sy, s);
    return;
  }
  const key: ShadyState = state.activity === 'talk' ? 'talk' : 'idle';
  const nowSeconds = performance.now() / MS_PER_SECOND + state.loopOffsetSeconds;
  drawSpriteKey(
    ctx,
    'shady',
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    s,
  );
}
