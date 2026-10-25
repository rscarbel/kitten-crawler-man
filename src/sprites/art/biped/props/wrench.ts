/**
 * An open-ended spanner, gripped by its shank: a flat steel bar with a jaw at
 * the working end. What reads at the 32 px tile is a short grey bar out of the
 * fist with a knob on its end — the jaw is what separates it from a stick, so
 * the jaw is kept wider than the bar by a clear margin rather than drawn to
 * scale.
 *
 * Painted in the grip's own rotated frame like the hammer: the shank runs
 * along the haft `handGrip` reports, turned by the prop's `angle`, with the
 * jaw toward +X.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { PropPainter } from '../props';
import { reachAround } from './reach';

const STEEL: Ramp = {
  deep: '#1f2226',
  shadow: '#383c43',
  dark: '#50555e',
  mid: '#6c727c',
  base: '#8a919b',
  light: '#b3b9c1',
  rim: '#dde1e6',
};

/** Butt to jaw centre. Longer than a real spanner in a fist this size, or nothing shows. */
const SHANK_LENGTH = 0.36;
/** Where the fist closes along the shank, from the butt. */
const SHANK_GRIP_SHARE = 0.3;
const SHANK_HALF = 0.02;
const JAW_RADIUS = 0.058;
/** The mouth of the jaw: a notch cut into the jaw's far side. */
const JAW_MOUTH_HALF = 0.022;
const JAW_MOUTH_DEPTH = 0.035;

/**
 * A hard glint on the shank near the jaw: polished steel against his skin is
 * otherwise the same mid value, and the spanner dissolves into the hand.
 */
const GLINT_ALONG_SHARE = 0.55;
const GLINT_HALF_LENGTH = 0.04;
const GLINT_HALF_WIDTH = 0.012;

/** The jaw's rim, the farthest ink from the grip. */
export const wrenchReach = reachAround(SHANK_LENGTH * (1 - SHANK_GRIP_SHARE) + JAW_RADIUS);

export const drawWrench: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const scale = prop.scale ?? 1;
  const steel = receded(STEEL, behindHand ? FAR_LIMB_SHADE : 0);
  const length = SHANK_LENGTH * scale;
  const butt = { x: -length * SHANK_GRIP_SHARE, y: 0 };
  const jaw = { x: length * (1 - SHANK_GRIP_SHARE), y: 0 };
  const half = SHANK_HALF * scale;
  const jawRadius = JAW_RADIUS * scale;

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(angle);

  const trace = (): void => {
    ctx.beginPath();
    addCapsule(ctx, butt, jaw, half, half);
    ctx.moveTo(jaw.x + jawRadius, jaw.y);
    ctx.arc(jaw.x, jaw.y, jawRadius, 0, Math.PI * 2);
  };
  shadeForm(ctx, trace, { from: butt, to: jaw }, steel, {
    halfWidth: jawRadius,
    frameRotation: angle,
  });

  const mouthHalf = JAW_MOUTH_HALF * scale;
  ctx.fillStyle = steel.deep;
  ctx.fillRect(
    jaw.x + jawRadius - JAW_MOUTH_DEPTH * scale,
    jaw.y - mouthHalf,
    JAW_MOUTH_DEPTH * scale,
    mouthHalf * 2,
  );
  ctx.fillStyle = steel.rim;
  const glintX = jaw.x * GLINT_ALONG_SHARE;
  ctx.fillRect(
    glintX - GLINT_HALF_LENGTH * scale,
    -half - GLINT_HALF_WIDTH * scale,
    GLINT_HALF_LENGTH * 2 * scale,
    GLINT_HALF_WIDTH * 2 * scale,
  );
  ctx.restore();
};
