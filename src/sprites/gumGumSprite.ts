import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { walkFrameIndex } from '../core/SpriteRenderer';
import { idleFrameAtSeconds } from './art/human/timing';
import { figureFrameCount } from './figure/figureDef';
import { GUMGUM_FIGURE, gumGumStateName } from './art/gumGumFigure';
import { GUMGUM_CORPSE_FIGURE, GUMGUM_CORPSE_STATE } from './art/gumGumCorpseArt';

/**
 * How much larger than a street citizen GumGum is drawn, about her feet. An orc
 * stands a head over the humans around her, and as the quest's hook she must
 * not get lost in the traffic outside the club.
 */
export const GUMGUM_DRAW_SCALE = 1.12;

/** Standing she faces the camera; walking she turns to her heading, mirrored for −X. */
export const GUMGUM_STANDING_STATE = gumGumStateName('idle', 'front');
export const GUMGUM_WALK_STATE = gumGumStateName('walk', 'side');
const MS_PER_SECOND = 1000;

/**
 * Warms the one row she plays standing, so she never pays a cold bake on the
 * frame she first shows. She never walks, so her walk rows are left to bake on
 * demand; her corpse is a single cell, cheap enough to bake when first drawn.
 */
export function prewarmGumGumSprite(): void {
  prewarmFigureState(GUMGUM_FIGURE, GUMGUM_STANDING_STATE);
}

/**
 * Draw GumGum — a stout, kindly orc in a patched mustard coat and a washed
 * apron, waiting outside the club for somebody to listen. Standing still she
 * faces the camera; a walk turns her to her heading.
 */
export function drawGumGumSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
): void {
  if (isMoving) {
    const frames = figureFrameCount(GUMGUM_FIGURE, GUMGUM_WALK_STATE);
    drawFigureCached(
      ctx,
      GUMGUM_FIGURE,
      GUMGUM_WALK_STATE,
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
    GUMGUM_FIGURE,
    GUMGUM_STANDING_STATE,
    idleFrameAtSeconds(nowSeconds),
    sx,
    sy,
    s,
  );
}

/**
 * Draw GumGum's body as it is found behind the club: the same orc in the same
 * coat and apron, headless, sprawled in her own blood. `sx`/`sy`/`s` are the
 * alley tile's box; the body and the pool spill past it.
 */
export function drawGumGumCorpse(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  drawFigureCached(ctx, GUMGUM_CORPSE_FIGURE, GUMGUM_CORPSE_STATE, 0, sx, sy, s);
}
