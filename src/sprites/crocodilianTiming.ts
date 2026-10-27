/**
 * Frame counts, event frames and play durations for the crocodilian rows —
 * the janitor's and Sydney's.
 *
 * The choreography (`src/sprites/art/crocodilianFigure.ts`), the runtime sprite
 * (`src/sprites/crocodilianSprite.ts`) and whatever kit drives them all read
 * these. A swish that sounds a frame before the mop moves, or a slosh before the
 * strands reach the water, is two copies of a number drifting apart.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

export const JANITOR_WALK_MOP_FRAMES = 16;
/**
 * Twelve, not eight: the idle carries a weight shift *and* a glance over the
 * shoulder, and a head turn sampled by fewer frames snaps between two poses.
 */
export const JANITOR_IDLE_FRAMES = 12;
/** One row cycle is two strokes, there and back, so the row loops on the spot he is mopping. */
export const JANITOR_MOP_FRAMES = 16;
/**
 * The frames each stroke is moving fastest, a quarter and three quarters of
 * the way round: the strands swish across the floor there.
 */
export const JANITOR_MOP_STROKE_FRAMES = [4, 12] as const satisfies readonly [number, number];
/** Set the pail down, dunk, wring, lift out, pick the pail back up. */
export const JANITOR_WRING_FRAMES = 20;
/** The first frame the strands are under the water line: the slosh. */
export const JANITOR_WRING_DUNK_FRAME = 6;

export const SYDNEY_WALK_FRAMES = 16;
export const SYDNEY_IDLE_FRAMES = 8;
/** Arms crossed → palm out → arms crossed again, so the row can loop for as long as she talks. */
export const SYDNEY_TALK_FRAMES = 12;
/** The frame her palm is fully out: "that'll be three hundred". */
export const SYDNEY_TALK_PALM_FRAME = 5;

/** One two-stroke cycle of the mop row: the row's progress runs 0–1 over it. */
export const JANITOR_MOP_CYCLE_MS = 1400;
/** How long the wring one-shot plays. */
export const JANITOR_WRING_DURATION_MS = 2000;

/** Loop speeds for the rows driven by the clock rather than by a timer or a walk phase. */
export const JANITOR_IDLE_FPS = 7;
export const SYDNEY_IDLE_FPS = 5;
export const SYDNEY_TALK_FPS = 8;

/**
 * The progress, 0–1, at which a one-shot row first shows `frame`.
 *
 * The runtime picks a frame with `progressFrameIndex`, which floors
 * `progress × frames`, so frame `f` is on screen from `f / frames` until the
 * next. A kit that lands its effect when progress crosses this value lands it
 * on the first tick the impact pose is drawn.
 */
function progressAtFrame(frame: number, frames: number): number {
  return frame / frames;
}

/** The progress at which each mop stroke's swish lands, as shares of one two-stroke cycle. */
export const JANITOR_MOP_STROKE_PROGRESS: readonly [number, number] = [
  progressAtFrame(JANITOR_MOP_STROKE_FRAMES[0], JANITOR_MOP_FRAMES),
  progressAtFrame(JANITOR_MOP_STROKE_FRAMES[1], JANITOR_MOP_FRAMES),
];

/** The progress at which the mop hits the water in the wring row. */
export const JANITOR_WRING_DUNK_PROGRESS = progressAtFrame(
  JANITOR_WRING_DUNK_FRAME,
  JANITOR_WRING_FRAMES,
);
