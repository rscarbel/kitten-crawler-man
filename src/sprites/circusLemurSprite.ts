import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { drawKnife } from './art/circusLemurArt';
import { CIRCUS_LEMUR_FIGURE } from './art/circusLemurFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const IDLE_FPS = 5;
const MILLISECONDS_PER_SECOND = 1000;
/** The knife's grip-to-point span is off-centre; this puts its middle on the flight path. */
const KNIFE_SPIN_CENTRE = 0.055;
/** A knife in flight is drawn a touch larger than the one in the paw so it reads mid-air. */
const THROWN_KNIFE_SCALE = 1.15;

/**
 * How many frames a row holds, read from the figure that paints it:
 * `drawFigureCached` clamps the frame index, so a stale hand-copied count
 * would freeze a shortened row on its last frame rather than fail.
 */
function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(CIRCUS_LEMUR_FIGURE, state));
}

/**
 * Draw a Former Circus Lemur — a ring-tailed lemur in a red fez and collar,
 * one of Grimaldi's sideshow performers, which skitters in packs and hurls
 * knives from its old act.
 *
 * @param attackAnim 0–1 progress through the nip lunge (0 = idle/walk).
 * @param throwAnim 0–1 progress through the knife-throw windup/release.
 */
export function drawCircusLemurSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
  throwAnim = 0,
): void {
  const opts = { flipX: facingX < 0 };
  if (throwAnim > 0) {
    const frame = progressFrameIndex(throwAnim, frameCountOf('throw'));
    drawFigureCached(ctx, CIRCUS_LEMUR_FIGURE, 'throw', frame, sx, sy, s, opts);
    return;
  }
  if (attackAnim > 0) {
    const frame = progressFrameIndex(attackAnim, frameCountOf('attack'));
    drawFigureCached(ctx, CIRCUS_LEMUR_FIGURE, 'attack', frame, sx, sy, s, opts);
    return;
  }
  if (isMoving) {
    const frame = walkFrameIndex(walkFrame, frameCountOf('walk'));
    drawFigureCached(ctx, CIRCUS_LEMUR_FIGURE, 'walk', frame, sx, sy, s, opts);
    return;
  }
  const idleFrame = timeFrameIndex(
    Date.now() / MILLISECONDS_PER_SECOND,
    IDLE_FPS,
    frameCountOf('idle'),
  );
  drawFigureCached(ctx, CIRCUS_LEMUR_FIGURE, 'idle', idleFrame, sx, sy, s, opts);
}

/** Draw a spinning thrown knife centred at (x, y). */
export function drawThrownKnife(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rotation: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(s * THROWN_KNIFE_SCALE, s * THROWN_KNIFE_SCALE);
  ctx.translate(-KNIFE_SPIN_CENTRE, 0);
  drawKnife(ctx);
  ctx.restore();
}

/**
 * Warms every row a lemur draws. Lemurs arrive in packs — three at once in the
 * circus assault — so the rows are asked for when one is built rather than on
 * the frame the pack first appears; repeated requests merge.
 */
export function prewarmCircusLemur(): void {
  for (const state of CIRCUS_LEMUR_FIGURE.states.keys()) {
    prewarmFigureState(CIRCUS_LEMUR_FIGURE, state);
  }
}
