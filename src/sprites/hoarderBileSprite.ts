import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { HOARDER_ACID_FIGURE, HOARDER_BILE_ARC_FIGURE } from './art/hoarderBileFigure';

/**
 * The Hoarder's bile in flight and the acid pool it leaves.
 *
 * `src/sprites/art/hoarderBileFigure.ts` owns both painters; the row lengths
 * below are declared here rather than read off them because the draw call
 * clamps the frame index — a row that lost a frame would freeze on its last
 * cell rather than error. An art gate holds the two equal.
 */

export const BILE_ARC_FRAMES = 8;
export const ACID_SPLASH_FRAMES = 8;
export const ACID_FORM_FRAMES = 6;
export const ACID_POOL_FRAMES = 8;
export const ACID_FADE_FRAMES = 6;

/** How fast the in-flight bolus tumbles, and how fast the pool boils. */
const BILE_ARC_FPS = 18;
const ACID_POOL_FPS = 8;

/**
 * Game frames the impact crown and the spread are held for. The rows hand off
 * byte-exactly — the last splash frame *is* the first form frame — so the two
 * read as one event rather than as two effects in a row.
 */
const SPLASH_HOLD_FRAMES = 16;
const FORM_HOLD_FRAMES = 24;

/**
 * Ages arrive as game-frame counts and `timeFrameIndex` wants seconds. Handed
 * `age / fps` the fps cancels out and the row advances one cell per game frame,
 * which runs every sheet at 60 fps whatever the constant beside it says.
 */
const FRAMES_PER_SECOND = 60;

/**
 * The bolus, rotated onto its flight angle. The sheet is drawn travelling +X
 * with its drool trailing behind, so `(x, y)` is the pivot and the frame's own
 * centre is the anchor.
 */
export function drawHoarderBile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  ageFrames: number,
  angle: number,
): void {
  const frame = timeFrameIndex(ageFrames / FRAMES_PER_SECOND, BILE_ARC_FPS, BILE_ARC_FRAMES);
  drawFigureCached(ctx, HOARDER_BILE_ARC_FIGURE, 'arc', frame, x, y, tileSize, {
    rotation: angle,
  });
}

/**
 * The pool, picked by its own age rather than looping one decal for its whole
 * life: it splashes, spreads, boils, and then sinks away leaving an etched
 * stain. Drawn at `TILE_SIZE` the art covers exactly the radius that damages
 * the player, which an art gate measures.
 */
export function drawHoarderAcidPool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  ageFrames: number,
  framesLeft: number,
  fadeFrames: number,
): void {
  if (ageFrames < SPLASH_HOLD_FRAMES) {
    const progress = ageFrames / SPLASH_HOLD_FRAMES;
    const frame = progressFrameIndex(progress, ACID_SPLASH_FRAMES);
    drawFigureCached(ctx, HOARDER_ACID_FIGURE, 'splash', frame, x, y, tileSize);
    return;
  }
  if (ageFrames < SPLASH_HOLD_FRAMES + FORM_HOLD_FRAMES) {
    const progress = (ageFrames - SPLASH_HOLD_FRAMES) / FORM_HOLD_FRAMES;
    const frame = progressFrameIndex(progress, ACID_FORM_FRAMES);
    drawFigureCached(ctx, HOARDER_ACID_FIGURE, 'form', frame, x, y, tileSize);
    return;
  }
  if (framesLeft < fadeFrames) {
    const frame = progressFrameIndex(1 - framesLeft / fadeFrames, ACID_FADE_FRAMES);
    drawFigureCached(ctx, HOARDER_ACID_FIGURE, 'fade', frame, x, y, tileSize);
    return;
  }
  const frame = timeFrameIndex(ageFrames / FRAMES_PER_SECOND, ACID_POOL_FPS, ACID_POOL_FRAMES);
  drawFigureCached(ctx, HOARDER_ACID_FIGURE, 'pool', frame, x, y, tileSize);
}

/**
 * The bolus's row and the pool's whole life, warmed when the Hoarder's heave
 * telegraphs.
 *
 * At the telegraph rather than when the projectile spawns: the bolus is in the
 * air for a fraction of a second and the splash follows it immediately, so a
 * row that starts baking on the frame the bile appears is a row baking while
 * the player is already dodging it.
 */
export function prewarmHoarderBile(): void {
  prewarmFigureState(HOARDER_BILE_ARC_FIGURE, 'arc');
  for (const state of ['splash', 'form', 'pool', 'fade']) {
    prewarmFigureState(HOARDER_ACID_FIGURE, state);
  }
}
