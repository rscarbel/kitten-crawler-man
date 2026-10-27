import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { idleFrameAtSeconds } from './art/human/timing';
import { figureFrameCount } from './figure/figureDef';
import { BAGGI_FIGURE, baggiStateName } from './art/baggiFigure';
import { BAGGI_CORPSE_FIGURE, BAGGI_CORPSE_STATE } from './art/baggiCorpseArt';

/**
 * How much larger than a street citizen Baggi is drawn, about her feet. An orc
 * stands a head over the humans around her, and as the quest's hook she must
 * not get lost in the traffic outside the club.
 */
export const BAGGI_DRAW_SCALE = 1.12;

/** Standing she faces the camera; walking she turns to her heading, mirrored for −X. */
export const BAGGI_STANDING_STATE = baggiStateName('idle', 'front');
export const BAGGI_WALK_STATE = baggiStateName('walk', 'side');
const MS_PER_SECOND = 1000;

/**
 * Warms the one row she plays standing, so she never pays a cold bake on the
 * frame she first shows. She never walks, so her walk rows are left to bake on
 * demand; her corpse is a single cell, cheap enough to bake when first drawn.
 */
export function prewarmBaggiSprite(): void {
  prewarmFigureState(BAGGI_FIGURE, BAGGI_STANDING_STATE);
}

/**
 * Draw Baggi — a stout, kindly orc in a patched mustard coat and a washed
 * apron, waiting outside the club for somebody to listen. Standing still she
 * faces the camera; a walk turns her to her heading.
 */
export function drawBaggiSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
): void {
  if (isMoving) {
    const frames = figureFrameCount(BAGGI_FIGURE, BAGGI_WALK_STATE);
    drawFigureCached(
      ctx,
      BAGGI_FIGURE,
      BAGGI_WALK_STATE,
      walkFrameIndex(walkFrame, frames),
      sx,
      sy,
      s,
      { flipX: facingX < 0 },
    );
    return;
  }
  const nowSeconds = performance.now() / MS_PER_SECOND;
  drawFigureCached(
    ctx,
    BAGGI_FIGURE,
    BAGGI_STANDING_STATE,
    idleFrameAtSeconds(nowSeconds),
    sx,
    sy,
    s,
  );
}

/**
 * Draw Baggi's body as it is found behind the club: the same orc in the same
 * coat and apron, headless, sprawled in her own blood. `sx`/`sy`/`s` are the
 * alley tile's box; the body and the pool spill past it.
 */
export function drawBaggiCorpse(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  drawFigureCached(ctx, BAGGI_CORPSE_FIGURE, BAGGI_CORPSE_STATE, 0, sx, sy, s);
}
