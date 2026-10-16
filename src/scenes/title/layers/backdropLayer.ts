/**
 * The dark the hall stands in: a vertical falloff with a faint warm bloom
 * over the stairwell, so the screen is never flat black, and the vault's ribs
 * arching overhead from pilaster to pilaster, baked soft because they are only
 * ever glimpsed above the walls' fade.
 */

import { TITLE_INK } from '../../../ui/theme/titleInk';
import { TitleBakedPlane } from '../titleBake';
import {
  HALL_DEPTH,
  WALL_FADE_START_TILES,
  rowAtHeight,
  scaleAtDistance,
  titleHall,
} from '../titleHall';
import { applyTitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';

/** The ribs are part of the hall's structure, so they move with its plane. */
const VAULT_DEPTH = HALL_DEPTH;
/** Past the stage on every side, for the camera's drift and shake. */
const BAKE_MARGIN_PX = 28;
/** Baked this coarse and scaled up, the ribs blur the way something barely lit does. */
const VAULT_RESOLUTION = 0.35;

/** The bloom's reach, as a share of the stage's longer side. */
const GLOW_RADIUS_SHARE = 0.55;
const GLOW_INNER_RADIUS = 0;

/** Ribs spring a little above where the walls start to fade, so their feet are lost in the dark. */
const RIB_SPRING_ABOVE_FADE_TILES = 0.6;
const RIB_SPRING_TILES = WALL_FADE_START_TILES + RIB_SPRING_ABOVE_FADE_TILES;
/** How far the vault rises above its springing line. */
const VAULT_RISE_TILES = 3.2;
const RIB_THICKNESS_TILES = 0.55;
/** The ribs fade with distance, the farthest barely there. */
const NEAREST_RIB_ALPHA = 0.85;
const FARTHEST_RIB_ALPHA = 0.25;

const HALF_TURN = Math.PI;
const FULL_TURN = Math.PI * 2;

function paintVoid(ctx: CanvasRenderingContext2D, stage: TitleStage): void {
  const { width, height } = stage;
  const top = -BAKE_MARGIN_PX;
  const fullHeight = height + BAKE_MARGIN_PX * 2;
  const fall = ctx.createLinearGradient(0, top, 0, top + fullHeight);
  fall.addColorStop(0, TITLE_INK.void.top);
  fall.addColorStop(1, TITLE_INK.void.bottom);
  ctx.fillStyle = fall;
  ctx.fillRect(-BAKE_MARGIN_PX, top, width + BAKE_MARGIN_PX * 2, fullHeight);

  const { x, y } = stage.stairwell;
  const glowRadius = Math.max(width, height) * GLOW_RADIUS_SHARE;
  const glow = ctx.createRadialGradient(x, y, GLOW_INNER_RADIUS, x, y, glowRadius);
  glow.addColorStop(0, TITLE_INK.void.glow);
  glow.addColorStop(1, TITLE_INK.void.glowFade);
  ctx.fillStyle = glow;
  ctx.fillRect(-BAKE_MARGIN_PX, top, width + BAKE_MARGIN_PX * 2, fullHeight);
}

function paintVault(ctx: CanvasRenderingContext2D, stage: TitleStage): void {
  paintVoid(ctx, stage);
  const hall = titleHall(stage);
  const ribs = hall.ribDistancesTiles;
  ribs.forEach((distance, index) => {
    const scale = scaleAtDistance(hall, distance);
    const pxPerTile = hall.farPxPerTile * scale;
    const springY = rowAtHeight(hall, scale, RIB_SPRING_TILES);
    const radiusX = hall.farHalfWidth * scale;
    const radiusY = VAULT_RISE_TILES * pxPerTile;
    const along = ribs.length > 1 ? index / (ribs.length - 1) : 0;
    ctx.globalAlpha = NEAREST_RIB_ALPHA + (FARTHEST_RIB_ALPHA - NEAREST_RIB_ALPHA) * along;
    ctx.strokeStyle = TITLE_INK.void.rib;
    ctx.lineWidth = RIB_THICKNESS_TILES * pxPerTile;
    ctx.beginPath();
    ctx.ellipse(hall.vanish.x, springY, radiusX, radiusY, 0, HALF_TURN, FULL_TURN);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

export function backdropLayer(): TitleLayer {
  const vault = new TitleBakedPlane(paintVault, BAKE_MARGIN_PX, VAULT_RESOLUTION);
  return {
    id: 'backdrop',
    depth: VAULT_DEPTH,
    layout: () => vault.invalidate(),
    render: (ctx, _clock, stage, camera) => {
      applyTitleCamera(ctx, camera, VAULT_DEPTH);
      vault.draw(ctx, stage, camera.zoom);
    },
    dispose: () => vault.dispose(),
  };
}
