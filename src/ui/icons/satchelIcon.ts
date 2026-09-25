/**
 * The Bag button's icon: a small drawstring satchel.
 *
 * Painted in code at whatever size the button needs, like the Journal's
 * compass rose and the Build button's crossed tools.
 */

const OUTLINE = '#1c1712';
const LEATHER = '#8a5a2e';
const LEATHER_DARK = '#6b431f';
const STRAP = '#5a3a1e';
const BUCKLE = '#cbd5e1';

/** Everything below is in fractions of the icon's size, from its top-left. */
const BODY_X = 0.14;
const BODY_Y = 0.34;
const BODY_W = 0.72;
const BODY_H = 0.54;
const BODY_RADIUS = 0.1;
const FLAP_X = 0.2;
const FLAP_Y = 0.28;
const FLAP_W = 0.6;
const FLAP_H = 0.22;
const FLAP_RADIUS = 0.06;
const STRAP_WIDTH = 0.1;
const STRAP_TOP_INSET = 0.3;
const BUCKLE_SIZE = 0.12;
const BUCKLE_Y = 0.4;
const OUTLINE_WIDTH = 0.04;
const SHADE_INSET = 0.06;
const SHADE_Y_SHARE = 0.4;
/** Strap arc centre — half the icon's own size, on both axes. */
const STRAP_CENTER_FRACTION = 0.5;
/**
 * The strap's arc sweeps from just past due-left to just short of due-right,
 * over the top — each in units of π radians, multiplied out at the call site.
 */
const STRAP_ARC_START_PI = 1.1;
const STRAP_ARC_END_PI = 1.9;
const BUCKLE_LINE_WIDTH_SHARE = 0.6;
const BUCKLE_LINE_WIDTH_MIN = 0.75;

export function drawSatchelIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  try {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH);
    ctx.strokeStyle = OUTLINE;

    // Strap, arcing over the top of the bag.
    ctx.strokeStyle = STRAP;
    ctx.lineWidth = Math.max(1, size * STRAP_WIDTH);
    ctx.beginPath();
    ctx.arc(
      x + size * STRAP_CENTER_FRACTION,
      y + size * STRAP_CENTER_FRACTION,
      size * (STRAP_CENTER_FRACTION - STRAP_TOP_INSET),
      Math.PI * STRAP_ARC_START_PI,
      Math.PI * STRAP_ARC_END_PI,
    );
    ctx.stroke();

    // Body.
    ctx.fillStyle = LEATHER;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(1, size * OUTLINE_WIDTH);
    ctx.beginPath();
    ctx.roundRect(
      x + size * BODY_X,
      y + size * BODY_Y,
      size * BODY_W,
      size * BODY_H,
      size * BODY_RADIUS,
    );
    ctx.fill();
    ctx.stroke();

    // A darker wash along the bottom half reads as the body's own shading
    // without a second light source.
    ctx.fillStyle = LEATHER_DARK;
    ctx.beginPath();
    ctx.rect(
      x + size * (BODY_X + SHADE_INSET),
      y + size * (BODY_Y + BODY_H * (1 - SHADE_Y_SHARE)),
      size * (BODY_W - SHADE_INSET * 2),
      size * BODY_H * SHADE_Y_SHARE,
    );
    ctx.fill();

    // Flap.
    ctx.fillStyle = LEATHER_DARK;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.roundRect(
      x + size * FLAP_X,
      y + size * FLAP_Y,
      size * FLAP_W,
      size * FLAP_H,
      size * FLAP_RADIUS,
    );
    ctx.fill();
    ctx.stroke();

    // Buckle, centred on the flap.
    ctx.fillStyle = BUCKLE;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(BUCKLE_LINE_WIDTH_MIN, size * OUTLINE_WIDTH * BUCKLE_LINE_WIDTH_SHARE);
    ctx.beginPath();
    ctx.rect(
      x + size * (STRAP_CENTER_FRACTION - BUCKLE_SIZE / 2),
      y + size * BUCKLE_Y,
      size * BUCKLE_SIZE,
      size * BUCKLE_SIZE,
    );
    ctx.fill();
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}
