/**
 * The brass dance pole a stage dancer works: one painter and one set of
 * dimensions every dancer and every stage shares.
 *
 * **Units and origin.** Everything here is in tiles, measured from the pole's
 * base on the floor, +Y down — the same units a dancer's choreography places
 * its hands in. A dancer declares where its pole stands relative to its own
 * ground point and grips it at a height above the floor; the stage draws the
 * pole at that spot, behind the dancer, so a gripping hand is painted over the
 * pole and the brass shows above and below the fist.
 *
 * The pole is drawn live rather than baked into a dancer's cells: it is a few
 * flat fills, it runs past the top of any dancer's cell to the ceiling rig,
 * and a stage may light or size it however it likes.
 */

import { clampAlpha, type Pt } from '../bipedArt';

type Ctx = CanvasRenderingContext2D;

/** Half the pole's width: a 45 mm stage pole on a figure two tiles tall. */
export const DANCE_POLE_RADIUS_TILES = 0.032;
/**
 * Floor to ceiling mount, the same on every stage. Tall enough to clear a
 * raised hand even from a third of a tile behind the pole, where standing
 * further back carries a dancer up the screen.
 */
export const DANCE_POLE_HEIGHT_TILES = 2.6;

const FLANGE_RX = 0.1;
const FLANGE_RY = 0.032;
const FLANGE_HEIGHT = 0.03;
const TOP_MOUNT_HALF_WIDTH = 0.075;
const TOP_MOUNT_HEIGHT = 0.05;

/** Polished brass, dark at the edges where the cylinder turns away. */
const BRASS_DEEP = '#4a3210';
const BRASS_SHADOW = '#8a6424';
const BRASS_BASE = '#c99a3f';
const BRASS_LIGHT = '#f2d27e';
const BRASS_GLINT = '#fff6d6';
const POLE_OUTLINE = '#27131b';
const POLE_OUTLINE_WIDTH = 0.022;
const POLE_OUTLINE_ALPHA = 0.85;
const FLOOR_SHADOW = '#000000';
const FLOOR_SHADOW_ALPHA = 0.3;
const FLOOR_SHADOW_SPREAD = 1.6;

/**
 * Where the light catches the cylinder, as shares of its width from the left
 * edge: the key light is upper left, so the hot line sits left of centre.
 */
const GLINT_AT = 0.32;
const GLINT_HALF = 0.09;
const LIGHT_HALF = 0.2;
const SHADOW_FROM = 0.68;
const STOP_SHADOW_EDGE = 0.92;

function brassAcross(ctx: Ctx, left: number, right: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(left, 0, right, 0);
  gradient.addColorStop(0, BRASS_SHADOW);
  gradient.addColorStop(GLINT_AT - LIGHT_HALF, BRASS_BASE);
  gradient.addColorStop(GLINT_AT - GLINT_HALF, BRASS_LIGHT);
  gradient.addColorStop(GLINT_AT, BRASS_GLINT);
  gradient.addColorStop(GLINT_AT + GLINT_HALF, BRASS_LIGHT);
  gradient.addColorStop(GLINT_AT + LIGHT_HALF, BRASS_BASE);
  gradient.addColorStop(SHADOW_FROM, BRASS_SHADOW);
  gradient.addColorStop(STOP_SHADOW_EDGE, BRASS_DEEP);
  gradient.addColorStop(1, BRASS_DEEP);
  return gradient;
}

/**
 * Paints the pole with its base at `base`, in tile units on a context already
 * scaled to tiles. `height` is how far up it runs, the full pole by default.
 */
export function paintDancePole(ctx: Ctx, base: Pt, height = DANCE_POLE_HEIGHT_TILES): void {
  const left = base.x - DANCE_POLE_RADIUS_TILES;
  const right = base.x + DANCE_POLE_RADIUS_TILES;
  const top = base.y - height;
  const alpha = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = clampAlpha(alpha * FLOOR_SHADOW_ALPHA);
  ctx.fillStyle = FLOOR_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    base.x,
    base.y,
    FLANGE_RX * FLOOR_SHADOW_SPREAD,
    FLANGE_RY * FLOOR_SHADOW_SPREAD,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = clampAlpha(alpha * POLE_OUTLINE_ALPHA);
  ctx.strokeStyle = POLE_OUTLINE;
  ctx.lineWidth = POLE_OUTLINE_WIDTH;
  ctx.strokeRect(left, top, right - left, height);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = brassAcross(ctx, left, right);
  ctx.fillRect(left, top, right - left, height);
  // The ceiling mount and the floor flange: two brass collars.
  ctx.fillStyle = brassAcross(ctx, base.x - TOP_MOUNT_HALF_WIDTH, base.x + TOP_MOUNT_HALF_WIDTH);
  ctx.fillRect(base.x - TOP_MOUNT_HALF_WIDTH, top, TOP_MOUNT_HALF_WIDTH * 2, TOP_MOUNT_HEIGHT);
  ctx.fillStyle = brassAcross(ctx, base.x - FLANGE_RX, base.x + FLANGE_RX);
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - FLANGE_HEIGHT / 2, FLANGE_RX, FLANGE_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the pole on screen with its base at the pixel `(sx, sy)` and a tile
 * `tileSize` pixels across: the call a stage makes before drawing the dancer
 * that works it.
 */
export function drawDancePole(
  ctx: Ctx,
  sx: number,
  sy: number,
  tileSize: number,
  height = DANCE_POLE_HEIGHT_TILES,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(tileSize, tileSize);
  paintDancePole(ctx, { x: 0, y: 0 }, height);
  ctx.restore();
}
