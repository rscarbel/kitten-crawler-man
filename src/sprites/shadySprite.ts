import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { SHADY_FIGURE } from './art/shadyFigure';
import { figureFrameCount } from './figure/figureDef';

/** The three rows he paints. He has one facing and never turns. */
export type ShadyState = 'idle' | 'scratch' | 'talk';

/**
 * Every state this wrapper can ask the figure for. An art gate holds it against
 * what the figure actually paints: the draw call returns silently on a state it
 * cannot find, so a name that drifts is an invisible NPC and no log line.
 */
export const SHADY_DRAWN_STATES: ReadonlyArray<ShadyState> = ['idle', 'scratch', 'talk'];

/**
 * Frame counts read off the figure that paints them, rather than retyped here.
 * A hand-kept copy is invisible when it drifts: the draw call clamps the index,
 * so too many frames stalls the animation on its last one and too few leaves
 * frames that never play — neither raises anything.
 */
const FRAME_COUNT: Record<ShadyState, number> = {
  idle: figureFrameCount(SHADY_FIGURE, 'idle'),
  scratch: figureFrameCount(SHADY_FIGURE, 'scratch'),
  talk: figureFrameCount(SHADY_FIGURE, 'talk'),
};

/**
 * The rows worth warming the moment the town stands him up.
 *
 * His idle plays from the frame he exists, and his talk row is one keypress
 * away from any player who walks up to the notice board. The scratch tic is
 * minutes away at worst and cheap enough to paint directly if it beats its own
 * bake.
 */
export const SHADY_PREWARMED_STATES: ReadonlyArray<ShadyState> = ['idle', 'talk'];

/** Warms the rows he starts playing immediately. Called when he is placed. */
export function prewarmShadySprite(): void {
  for (const state of SHADY_PREWARMED_STATES) prewarmFigureState(SHADY_FIGURE, state);
}

/**
 * How far his hood's crown stands above the top of his own tile, in tiles.
 *
 * He is about 1.4 tiles of art anchored with the soles near the tile's floor,
 * so everything hung off the tile origin — the quest marker most of all — lands
 * somewhere around his chest unless it is lifted by this. It clears his painted
 * crown with a deliberate gap above it rather than sitting on it, and
 * `scripts/gates-shady.ts` re-measures the crown against it on every render.
 */
export const SHADY_HEAD_ABOVE_TILE_TILES = 0.78;

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
    drawFigureCached(ctx, SHADY_FIGURE, 'scratch', frame, sx, sy, s);
    return;
  }
  const key: ShadyState = state.activity === 'talk' ? 'talk' : 'idle';
  const nowSeconds = performance.now() / MS_PER_SECOND + state.loopOffsetSeconds;
  drawFigureCached(
    ctx,
    SHADY_FIGURE,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]),
    sx,
    sy,
    s,
  );
}
