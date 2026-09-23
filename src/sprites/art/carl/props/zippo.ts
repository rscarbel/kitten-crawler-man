/**
 * Carl's Zippo: a small chrome lighter held upright in the fist, its lid
 * flipped open and a flame standing off the chimney when lit.
 *
 * The lighter is tiny against him — a couple of pixels at the 32 px tile — so
 * it is read by the flame, not the case: the case is kept to one bright shape
 * with a single glint, and the flame and its glow do the work.
 */

import { OUTLINE } from '../palette';
import type { PropPainter } from '../props';
import type { Pt } from '../../carlArt';
import { reachAround } from './reach';

/**
 * The looks a lighter can be posed with:
 * - `closed` (the default when absent): lid shut.
 * - `open`: lid flipped back, no flame yet.
 * - `lit`: lid back and burning.
 * - `lit-tall`: the same flame stretched, for a flicker step.
 */
export type ZippoVariant = 'closed' | 'open' | 'lit' | 'lit-tall';

/** The case, end to end along the fist's bore, and half its width. */
const CASE_LENGTH = 0.13;
const CASE_HALF_WIDTH = 0.03;
/**
 * How far the case rides up out of the fist, as a share of its length. A
 * lighter is held low with its top clear of the fingers, the thumb free to
 * flick the lid.
 */
const CASE_RISE_SHARE = 0.78;
const CASE_OUTLINE = 0.01;
const CHROME = '#c9ccd2';
const CHROME_SHADE = '#7d828c';
const CHROME_GLINT = '#ffffff';
/** The glint's size against the case's half width. */
const GLINT_SHARE = 0.45;
/** The lid is the case's top third, hinged at its back edge. */
const LID_SHARE = 0.34;
/** An open lid stands back from the case at this angle, radians. */
const LID_OPEN_ANGLE = 1.9;

/** The flame: a teardrop standing up off the chimney. */
const FLAME_HEIGHT = 0.16;
const FLAME_TALL_SCALE = 1.3;
const FLAME_HALF_WIDTH = 0.042;
const FLAME_OUTER = '#ff9a2e';
const FLAME_INNER = '#ffe46b';
const FLAME_CORE = '#fffbe6';
/** The inner flame's size against the outer. */
const FLAME_INNER_SHARE = 0.62;
const FLAME_CORE_SHARE = 0.3;
/** A soft pool of light round the flame, which is what survives at tile size. */
const FLAME_GLOW_RADIUS = 0.1;
const FLAME_GLOW = 'rgba(255, 196, 90, 0.22)';

/** Traces a teardrop standing on `base`, its tip `height` straight up. */
function traceFlame(ctx: CanvasRenderingContext2D, base: Pt, height: number, half: number): void {
  const tip = { x: base.x, y: base.y - height };
  const belly = base.y - height * FLAME_BELLY_SHARE;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.quadraticCurveTo(base.x + half, belly, base.x + half * FLAME_FOOT_SHARE, base.y);
  ctx.quadraticCurveTo(
    base.x,
    base.y + half * FLAME_FOOT_SHARE,
    base.x - half * FLAME_FOOT_SHARE,
    base.y,
  );
  ctx.quadraticCurveTo(base.x - half, belly, tip.x, tip.y);
  ctx.closePath();
}

/** Where a flame is widest, as a share of its height up from the base. */
const FLAME_BELLY_SHARE = 0.3;
/** How wide the flame's rounded foot is against its widest point. */
const FLAME_FOOT_SHARE = 0.7;

/** The tall flame's tip over the open case, widened by its glow. */
export const zippoReach = reachAround(
  Math.hypot(CASE_LENGTH * CASE_RISE_SHARE + FLAME_HEIGHT * FLAME_TALL_SCALE, FLAME_GLOW_RADIUS),
);

export const drawZippo: PropPainter = (ctx, grip, prop) => {
  const variant = prop.variant ?? 'closed';
  const scale = prop.scale ?? 1;
  // The case stands along the fist's bore, whichever way of the two ends is
  // up on screen, so the chimney is on top however the wrist is turned.
  const bore = grip.haftAngle + (prop.angle ?? 0);
  const upward = Math.sin(bore) <= 0 ? bore : bore + Math.PI;
  const length = CASE_LENGTH * scale;
  const half = CASE_HALF_WIDTH * scale;
  const rise = length * CASE_RISE_SHARE;
  const bottom = -(length - rise);
  const lidLine = rise - length * LID_SHARE;
  const isOpen = variant !== 'closed';

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(upward);

  const caseTop = isOpen ? lidLine : rise;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(
    bottom - CASE_OUTLINE,
    -half - CASE_OUTLINE,
    caseTop - bottom + CASE_OUTLINE * 2,
    (half + CASE_OUTLINE) * 2,
  );
  ctx.fillStyle = CHROME_SHADE;
  ctx.fillRect(bottom, -half, caseTop - bottom, half * 2);
  ctx.fillStyle = CHROME;
  ctx.fillRect(bottom, -half, caseTop - bottom, half);
  ctx.fillStyle = CHROME_GLINT;
  ctx.fillRect(caseTop - half * GLINT_SHARE * 2, -half, half * GLINT_SHARE, half * GLINT_SHARE);

  if (isOpen) {
    // The lid swings back about the hinge on the case's back edge.
    ctx.save();
    ctx.translate(lidLine, half);
    ctx.rotate(LID_OPEN_ANGLE);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(
      -CASE_OUTLINE,
      -CASE_OUTLINE,
      length * LID_SHARE + CASE_OUTLINE * 2,
      half + CASE_OUTLINE * 2,
    );
    ctx.fillStyle = CHROME;
    ctx.fillRect(0, 0, length * LID_SHARE, half);
    ctx.restore();
  }
  ctx.restore();

  if (variant !== 'lit' && variant !== 'lit-tall') return;
  const chimney = {
    x: grip.centre.x + Math.cos(upward) * lidLine,
    y: grip.centre.y + Math.sin(upward) * lidLine,
  };
  const height = FLAME_HEIGHT * scale * (variant === 'lit-tall' ? FLAME_TALL_SCALE : 1);
  const flameHalf = FLAME_HALF_WIDTH * scale;
  ctx.fillStyle = FLAME_GLOW;
  ctx.beginPath();
  ctx.arc(
    chimney.x,
    chimney.y - height * FLAME_BELLY_SHARE,
    FLAME_GLOW_RADIUS * scale,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  traceFlame(ctx, chimney, height, flameHalf);
  ctx.fillStyle = FLAME_OUTER;
  ctx.fill();
  traceFlame(ctx, chimney, height * FLAME_INNER_SHARE, flameHalf * FLAME_INNER_SHARE);
  ctx.fillStyle = FLAME_INNER;
  ctx.fill();
  traceFlame(ctx, chimney, height * FLAME_CORE_SHARE, flameHalf * FLAME_CORE_SHARE);
  ctx.fillStyle = FLAME_CORE;
  ctx.fill();
};
