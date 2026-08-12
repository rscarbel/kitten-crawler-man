/**
 * The Lich's falling orb: the thing that lands inside a warning circle.
 *
 * Only the object in the air is drawn here. The circle it is aimed at is
 * `drawDangerCircle` and the impact is `drawSoulBurst`; this is the fall in
 * between, drawn for the whole of the warning the circle is showing, and its
 * whole job is to tell the player that the ring on the floor is about to become
 * real and roughly *when*.
 *
 * Which is why it grows. A projectile that comes straight down the camera axis
 * has no travel to show — its screen position barely moves — so height is sold
 * entirely by size and by the trail lengthening behind it. At a 32-pixel tile
 * the orb is a handful of pixels across at launch, and a handful of pixels that
 * does not change is indistinguishable from a decoration on the floor.
 */

import { SOUL_CORE, SOUL_DEEP, SOUL_MID, soulRgba } from './soulPalette';

/** How far above its impact point the orb is at launch, in tiles. */
const ORB_LAUNCH_HEIGHT_TILES = 3.4;
/** The orb at the moment before impact, as a share of a tile. */
const ORB_LANDING_RADIUS_TILES = 0.34;
/** What fraction of that it is at launch — the distance cue. */
const ORB_LAUNCH_SCALE = 0.34;

/** The pool of light around the core, as a multiple of its radius. */
const ORB_GLOW_SCALE = 2.6;
const ORB_GLOW_ALPHA = 0.5;
/** Where the body gradient hands over from core to mid to deep. */
const ORB_CORE_STOP = 0.34;
const ORB_MID_STOP = 0.72;
/** The white-hot pinpoint that survives being drawn six pixels across. */
const ORB_SPECULAR_SCALE = 0.36;
const ORB_SPECULAR_OFFSET = 0.26;
const ORB_SPECULAR_ALPHA = 0.9;

/**
 * Ghosts of where the orb was, and how far back in its fall each one looks.
 *
 * Sampled from the same fall curve as the orb rather than laid out as a fixed
 * streak, so the trail stretches on its own as the thing accelerates — which is
 * the only part of this that reads as speed.
 */
const ORB_TRAIL_COUNT = 5;
const ORB_TRAIL_LOOKBACK = 0.2;
const ORB_TRAIL_ALPHA = 0.45;
const ORB_TRAIL_SHRINK = 0.62;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How far above the impact point the orb is at a given point in its fall.
 *
 * Squared, because a falling thing accelerates: a linear descent reads as an
 * orb being lowered on a string, and the player's whole read on when to move is
 * how fast the gap is closing.
 */
function heightAt(progress: number, tileSize: number): number {
  const fallen = progress * progress;
  return tileSize * ORB_LAUNCH_HEIGHT_TILES * (1 - fallen);
}

function radiusAt(progress: number, tileSize: number): number {
  const landing = tileSize * ORB_LANDING_RADIUS_TILES;
  return landing * (ORB_LAUNCH_SCALE + (1 - ORB_LAUNCH_SCALE) * progress);
}

function paintOrbBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  const glowRadius = radius * ORB_GLOW_SCALE;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  glow.addColorStop(0, soulRgba(SOUL_MID, ORB_GLOW_ALPHA * alpha));
  glow.addColorStop(1, soulRgba(SOUL_DEEP, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(x, y, 0, x, y, radius);
  body.addColorStop(0, soulRgba(SOUL_CORE, alpha));
  body.addColorStop(ORB_CORE_STOP, soulRgba(SOUL_CORE, 0.95 * alpha));
  body.addColorStop(ORB_MID_STOP, soulRgba(SOUL_MID, 0.95 * alpha));
  body.addColorStop(1, soulRgba(SOUL_DEEP, 0.6 * alpha));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws the orb in flight.
 *
 * `(cx, cy)` is the screen-space centre of the impact point — the middle of the
 * warning circle, not of the orb — and `fallProgress` runs 0 at launch to 1 the
 * frame before it lands.
 */
export function drawLichOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  fallProgress: number,
): void {
  const progress = clamp01(fallProgress);

  ctx.save();
  for (let i = ORB_TRAIL_COUNT; i >= 1; i--) {
    const back = clamp01(progress - (ORB_TRAIL_LOOKBACK * i) / ORB_TRAIL_COUNT);
    const fade = 1 - i / (ORB_TRAIL_COUNT + 1);
    paintOrbBody(
      ctx,
      cx,
      cy - heightAt(back, tileSize),
      radiusAt(back, tileSize) * ORB_TRAIL_SHRINK * fade,
      ORB_TRAIL_ALPHA * fade,
    );
  }

  const y = cy - heightAt(progress, tileSize);
  const radius = radiusAt(progress, tileSize);
  paintOrbBody(ctx, cx, y, radius, 1);

  ctx.fillStyle = soulRgba(SOUL_CORE, ORB_SPECULAR_ALPHA);
  ctx.beginPath();
  ctx.arc(
    cx - radius * ORB_SPECULAR_OFFSET,
    y - radius * ORB_SPECULAR_OFFSET,
    radius * ORB_SPECULAR_SCALE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
