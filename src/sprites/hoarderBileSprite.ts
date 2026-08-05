import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

/**
 * The Hoarder's bile in flight and the acid pool it leaves.
 *
 * `scripts/generate-hoarder-bile-sprites.ts` owns both sheets; the runtime
 * cannot import from `scripts/`, so the row lengths below are duplicated and a
 * bake gate holds the two equal. They are declared rather than inferred because
 * `drawSprite` clamps the frame index — a row that lost a frame would freeze on
 * its last cell rather than error.
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
  drawSpriteKey(ctx, 'hoarder_vomit_arc', 'arc', frame, x, y, tileSize, { rotation: angle });
}

/**
 * The pool, picked by its own age rather than looping one decal for its whole
 * life: it splashes, spreads, boils, and then sinks away leaving an etched
 * stain. Drawn at `TILE_SIZE` the art covers exactly the radius that damages
 * the player, which a bake gate measures.
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
    drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'splash', frame, x, y, tileSize);
    return;
  }
  if (ageFrames < SPLASH_HOLD_FRAMES + FORM_HOLD_FRAMES) {
    const progress = (ageFrames - SPLASH_HOLD_FRAMES) / FORM_HOLD_FRAMES;
    const frame = progressFrameIndex(progress, ACID_FORM_FRAMES);
    drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'form', frame, x, y, tileSize);
    return;
  }
  if (framesLeft < fadeFrames) {
    const frame = progressFrameIndex(1 - framesLeft / fadeFrames, ACID_FADE_FRAMES);
    drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'fade', frame, x, y, tileSize);
    return;
  }
  const frame = timeFrameIndex(ageFrames / FRAMES_PER_SECOND, ACID_POOL_FPS, ACID_POOL_FRAMES);
  drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'pool', frame, x, y, tileSize);
}
