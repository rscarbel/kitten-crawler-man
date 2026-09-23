/**
 * A short claw hammer, gripped through its haft: a wooden handle and a steel
 * head crossing it near the top. The proof-of-concept entry in
 * `PROP_PAINTERS` — copy this file's shape (own local materials, one
 * `shadeForm` per solid, painted in the grip's own rotated frame) for a new
 * held prop.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { PropPainter } from '../props';
import { reachAround } from './reach';

/**
 * Warm-toned hardwood. Local to this prop rather than added to `palette.ts`:
 * nothing else on the figure is painted as wood.
 */
const WOOD: Ramp = {
  deep: '#2a1a10',
  shadow: '#4a2f18',
  dark: '#6b431f',
  mid: '#8a5827',
  base: '#a86f34',
  light: '#c99248',
  rim: '#e6b667',
};

/** Blued steel for the head. */
const STEEL: Ramp = {
  deep: '#1c1e22',
  shadow: '#33363d',
  dark: '#4c5058',
  mid: '#666b75',
  base: '#828893',
  light: '#a8adb6',
  rim: '#cfd3d9',
};

/**
 * Butt to the point just under the head. Sized well past the fist's own bore
 * on purpose: at the 32 px tile a prop sized to disappear inside the grip has
 * no silhouette left to read as a hammer at all.
 */
const HANDLE_LENGTH = 0.32;
/** Where the fist's grip centres along the handle, from the butt. Past this the head sits. */
const HANDLE_GRIP_SHARE = 0.3;
/** The grip end is held thicker than the neck under the head, like a real haft. */
const HANDLE_HALF_AT_BUTT = 0.028;
const HANDLE_HALF_AT_HEAD = 0.02;

/** Poll to claw, crossing the handle rather than running along it. */
const HEAD_LENGTH = 0.16;
const HEAD_HALF_WIDTH = 0.05;

/** The head's far corner, the farthest ink from the grip. */
export const hammerReach = reachAround(
  Math.hypot(HANDLE_LENGTH * (1 - HANDLE_GRIP_SHARE) + HEAD_HALF_WIDTH, HEAD_LENGTH / 2),
);

export const drawHammer: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const scale = prop.scale ?? 1;
  const shade = behindHand ? FAR_LIMB_SHADE : 0;
  const wood = receded(WOOD, shade);
  const steel = receded(STEEL, shade);

  const handleLength = HANDLE_LENGTH * scale;
  const butt = { x: -handleLength * HANDLE_GRIP_SHARE, y: 0 };
  const underHead = { x: handleLength * (1 - HANDLE_GRIP_SHARE), y: 0 };
  const halfAtButt = HANDLE_HALF_AT_BUTT * scale;
  const halfAtHead = HANDLE_HALF_AT_HEAD * scale;

  const headHalfLength = (HEAD_LENGTH * scale) / 2;
  const headHalfWidth = HEAD_HALF_WIDTH * scale;
  const poll = { x: underHead.x, y: -headHalfLength };
  const claw = { x: underHead.x, y: headHalfLength };

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(angle);

  const traceHandle = (): void => {
    ctx.beginPath();
    addCapsule(ctx, butt, underHead, halfAtButt, halfAtHead);
  };
  shadeForm(ctx, traceHandle, { from: butt, to: underHead }, wood, {
    halfWidth: Math.max(halfAtButt, halfAtHead),
    frameRotation: angle,
  });

  const traceHead = (): void => {
    ctx.beginPath();
    addCapsule(ctx, poll, claw, headHalfWidth, headHalfWidth);
  };
  shadeForm(ctx, traceHead, { from: poll, to: claw }, steel, {
    halfWidth: headHalfWidth,
    frameRotation: angle,
  });

  ctx.restore();
};
