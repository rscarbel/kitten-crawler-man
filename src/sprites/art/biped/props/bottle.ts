/**
 * A stoppered potion bottle, gripped round its body: a round-shouldered flask
 * of red liquid, a pale glass neck, and a cork. The fist closes over the body,
 * so what reads at the 32 px tile is what sticks out of it — the red belly
 * below the fingers and the neck and cork above them.
 *
 * One bottle for every drink. A cell is shared by every drink he takes, so a
 * per-potion tint would need a row per potion; red is the health potion's
 * colour, the drink he takes by far the most, and it stands off the brown
 * jacket and the skin it is held against where an amber bottle would vanish.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { PropPainter } from '../props';
import { reachAround } from './reach';

/** The potion seen through the glass. */
const POTION: Ramp = {
  deep: '#3a060b',
  shadow: '#5e0c14',
  dark: '#86131d',
  mid: '#a81d27',
  base: '#c42a31',
  light: '#e2524f',
  rim: '#f59a8a',
};

/** Empty glass: the neck, which the liquid does not reach. */
const GLASS: Ramp = {
  deep: '#39464a',
  shadow: '#56686d',
  dark: '#71878c',
  mid: '#8ea4a8',
  base: '#a9bec1',
  light: '#cadadb',
  rim: '#eef6f6',
};

const CORK: Ramp = {
  deep: '#3b2612',
  shadow: '#5a3a1d',
  dark: '#7a5230',
  mid: '#946744',
  base: '#ad7f57',
  light: '#c89d74',
  rim: '#e0bf97',
};

/**
 * Base to the top of the cork, along the bottle's axis. Drawn a little larger
 * than a real half-pint flask: at the 32 px tile anything shorter is a red dot
 * in his fist rather than something he could drink from.
 */
const BODY_BOTTOM = -0.1;
/** Where the round body turns in at the shoulder to the neck. */
const BODY_TOP = 0.06;
const BODY_HALF_WIDTH = 0.052;
const NECK_TOP = 0.13;
const NECK_HALF_WIDTH = 0.019;
const CORK_TOP = 0.16;
const CORK_HALF_WIDTH = 0.022;

/** A narrow lit streak down the lit side of the glass, the one mark that says glass. */
const GLINT_HALF_WIDTH = 0.008;
const GLINT_OFFSET = -0.024;
const GLINT_FROM = -0.06;
const GLINT_TO = 0.035;

/** The cork's top at the body's width: past every corner of the bottle. */
export const bottleReach = reachAround(Math.hypot(CORK_TOP, BODY_HALF_WIDTH));

export const drawBottle: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const scale = prop.scale ?? 1;
  const shade = behindHand ? FAR_LIMB_SHADE : 0;
  const potion = receded(POTION, shade);
  const glass = receded(GLASS, shade);
  const cork = receded(CORK, shade);

  const base = { x: BODY_BOTTOM * scale, y: 0 };
  const shoulder = { x: BODY_TOP * scale, y: 0 };
  const neckTop = { x: NECK_TOP * scale, y: 0 };
  const corkTop = { x: CORK_TOP * scale, y: 0 };
  const bodyHalf = BODY_HALF_WIDTH * scale;
  const neckHalf = NECK_HALF_WIDTH * scale;
  const corkHalf = CORK_HALF_WIDTH * scale;

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(angle);

  const traceNeck = (): void => {
    ctx.beginPath();
    addCapsule(ctx, shoulder, neckTop, neckHalf, neckHalf);
  };
  shadeForm(ctx, traceNeck, { from: shoulder, to: neckTop }, glass, {
    halfWidth: neckHalf,
    frameRotation: angle,
  });

  const traceCork = (): void => {
    ctx.beginPath();
    addCapsule(ctx, neckTop, corkTop, corkHalf, corkHalf);
  };
  shadeForm(ctx, traceCork, { from: neckTop, to: corkTop }, cork, {
    halfWidth: corkHalf,
    frameRotation: angle,
  });

  const traceBody = (): void => {
    ctx.beginPath();
    addCapsule(ctx, base, shoulder, bodyHalf, bodyHalf);
  };
  shadeForm(ctx, traceBody, { from: base, to: shoulder }, potion, {
    halfWidth: bodyHalf,
    frameRotation: angle,
  });

  ctx.beginPath();
  addCapsule(
    ctx,
    { x: GLINT_FROM * scale, y: GLINT_OFFSET * scale },
    { x: GLINT_TO * scale, y: GLINT_OFFSET * scale },
    GLINT_HALF_WIDTH * scale,
    GLINT_HALF_WIDTH * scale,
  );
  ctx.fillStyle = potion.rim;
  ctx.fill();

  ctx.restore();
};
