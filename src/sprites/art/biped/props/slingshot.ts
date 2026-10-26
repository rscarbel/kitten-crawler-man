/**
 * The Rattlestick Sling: a bark-on forked stick gripped by its handle below
 * the fork, tape wound round the butt, two strips cut from a red inner tube
 * for bands, the leather pouch they carry, and a knot of pebbles tied to the
 * butt that rattles as he moves.
 *
 * The bands run from the prong tips to `prop.tether` — the pouch, wherever the
 * choreography has put it: pinched in the drawing hand, snapped forward past
 * the fork on the release, or hanging slack. Without a tether they hang
 * straight across the tips.
 *
 * `variant` `'loaded'` sits a stone in the pouch.
 */

import { addCapsule, shadeForm } from '../paint';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { PropPainter, PropReach } from '../props';
import { mixPt, TWO_PI } from '../geometry';
import { deg, mix, type Pt } from '../../bipedArt';
import { squareAround } from './reach';

/** The pouch hangs midway between the tips when nothing pulls it. */
const HALF = 0.5;

/**
 * A forked stick with its bark still on, grey-brown rather than whittled
 * pale: the red bands and black tape carry the read against his clothes, so
 * the wood can be the dull thing it is.
 */
const WOOD: Ramp = {
  deep: '#2e2318',
  shadow: '#45352a',
  dark: '#5e4a38',
  mid: '#755d45',
  base: '#8d7253',
  light: '#a98d6a',
  rim: '#c9ad86',
};

/**
 * Red inner-tube rubber, more saturated than anything he wears, so the two
 * bands read as lines at the 32 px tile rather than dissolving into his clothes.
 */
const BAND = '#e2573b';
const BAND_SHADE = '#7c2216';
/** Black tape wound round the butt below his fist. */
const TAPE = '#262427';
const TAPE_HALF = 0.03;
/** The rattle: pebbles knotted to the butt on a short cord, either side of the haft. */
const RATTLE_CORD = '#6b5a44';
const RATTLE_CORD_WIDTH = 0.01;
const RATTLE_BEYOND_BUTT = 0.04;
const RATTLE_SPREAD = 0.024;
const RATTLE_PEBBLE_R = 0.017;
const POUCH = '#5a3a26';
const STONE = '#9a938a';
const STONE_LIGHT = '#d9d4cb';

/** The variant that sits a stone in the pouch. */
export const SLINGSHOT_LOADED = 'loaded';

/**
 * The handle, measured along the haft the fist closes round: a stub below the
 * fist and a short neck above it up to the crotch of the fork. The haft
 * direction `handGrip` reports points down out of the little-finger side, so
 * "below the fist" is +X in the prop's own frame and the fork is −X.
 */
const BUTT_BELOW_GRIP = 0.075;
const CROTCH_ABOVE_GRIP = 0.075;
const HANDLE_HALF = 0.026;
/**
 * Each prong, crotch to tip. Long enough that the fork stands clear of the fist
 * by more than the fist is wide: the fork is the whole read of the prop, and a
 * fork shorter than the knuckles hides inside them at tile size.
 */
const PRONG_LENGTH = 0.2;
const PRONG_HALF_AT_CROTCH = 0.022;
const PRONG_HALF_AT_TIP = 0.017;
/**
 * Half the angle between the prongs, seen square on. A real frame opens to
 * roughly sixty degrees between the tips; wider reads as a catapult arm.
 */
const PRONG_HALF_ANGLE = deg(36);
/**
 * How far the prong tips stand above the grip, along the handle: where a slack
 * pouch hangs between them, and the line a released one flies along.
 */
export const SLINGSHOT_TIPS_ABOVE_GRIP =
  CROTCH_ABOVE_GRIP + PRONG_LENGTH * Math.cos(PRONG_HALF_ANGLE);
/**
 * How much of the fork's width is seen in profile. Held upright and aimed
 * along the way he faces, the fork's plane is square to the aim, so edge-on it
 * would be a single stick. A shooter cants the frame, and the eye reads the
 * cant as width.
 */
const PROFILE_FORK_WIDTH = 0.7;

/** A strip cut from a tube is flat and broad, wider than a bought band. */
const BAND_WIDTH = 0.032;
/** The band's darker underside, a hair below it, so the line has a lit and a shaded edge. */
const BAND_SHADE_WIDTH = 0.04;
const POUCH_RX = 0.034;
const POUCH_RY = 0.026;
const STONE_R = 0.026;
const STONE_LIGHT_R = 0.011;
const STONE_LIGHT_OFFSET = 0.009;

/**
 * The handle and fork in the grip's own frame, where the haft runs along +X:
 * the butt, the crotch, and the two prong tips.
 */
function frameLandmarks(widthShare: number): { butt: Pt; crotch: Pt; leftTip: Pt; rightTip: Pt } {
  const along = -SLINGSHOT_TIPS_ABOVE_GRIP;
  const across = PRONG_LENGTH * Math.sin(PRONG_HALF_ANGLE) * widthShare;
  return {
    butt: { x: BUTT_BELOW_GRIP, y: 0 },
    crotch: { x: -CROTCH_ABOVE_GRIP, y: 0 },
    leftTip: { x: along, y: -across },
    rightTip: { x: along, y: across },
  };
}

/** A point in the grip's frame carried into figure space. */
function toFigure(local: Pt, centre: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: centre.x + local.x * cos - local.y * sin,
    y: centre.y + local.x * sin + local.y * cos,
  };
}

function strokeBand(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * A prong tip, the farthest point of the frame from the grip; the frame is not
 * scaled. A drawn pouch is at the pose's tether, which the figure bounds itself.
 */
const FRAME_REACH =
  Math.hypot(SLINGSHOT_TIPS_ABOVE_GRIP, PRONG_LENGTH * Math.sin(PRONG_HALF_ANGLE)) +
  PRONG_HALF_AT_TIP;
export const slingshotReach: PropReach = (grip) => squareAround(grip.centre, FRAME_REACH);

export const drawSlingshot: PropPainter = (ctx, grip, prop, view, behindHand) => {
  const frameAngle = grip.haftAngle + (prop.angle ?? 0);
  const shade = behindHand ? FAR_LIMB_SHADE : 0;
  const wood = receded(WOOD, shade);
  const band = mix(BAND, BAND_SHADE, shade);
  const { butt, crotch, leftTip, rightTip } = frameLandmarks(view.profile ? PROFILE_FORK_WIDTH : 1);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(grip.centre.x, grip.centre.y);
  ctx.rotate(frameAngle);
  const traceFrame = (): void => {
    ctx.beginPath();
    addCapsule(ctx, butt, crotch, HANDLE_HALF, HANDLE_HALF);
    addCapsule(ctx, crotch, leftTip, PRONG_HALF_AT_CROTCH, PRONG_HALF_AT_TIP);
    addCapsule(ctx, crotch, rightTip, PRONG_HALF_AT_CROTCH, PRONG_HALF_AT_TIP);
  };
  shadeForm(ctx, traceFrame, { from: butt, to: crotch }, wood, {
    halfWidth: HANDLE_HALF,
    frameRotation: frameAngle,
  });
  const rattleKnot: Pt = { x: butt.x + RATTLE_BEYOND_BUTT, y: 0 };
  ctx.strokeStyle = RATTLE_CORD;
  ctx.lineWidth = RATTLE_CORD_WIDTH;
  ctx.beginPath();
  ctx.moveTo(butt.x, 0);
  ctx.lineTo(rattleKnot.x, 0);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.fillStyle = STONE;
    ctx.beginPath();
    ctx.arc(rattleKnot.x, side * RATTLE_SPREAD, RATTLE_PEBBLE_R, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = TAPE;
  ctx.beginPath();
  addCapsule(ctx, butt, { x: 0, y: 0 }, TAPE_HALF, TAPE_HALF);
  ctx.fill();
  ctx.restore();

  const tips = [leftTip, rightTip].map((tip) => toFigure(tip, grip.centre, frameAngle));
  const pouch = prop.tether ?? toFigure(mixPt(leftTip, rightTip, HALF), grip.centre, frameAngle);
  for (const tip of tips) strokeBand(ctx, tip, pouch, BAND_SHADE, BAND_SHADE_WIDTH);
  for (const tip of tips) strokeBand(ctx, tip, pouch, band, BAND_WIDTH);

  ctx.fillStyle = POUCH;
  ctx.beginPath();
  ctx.ellipse(pouch.x, pouch.y, POUCH_RX, POUCH_RY, frameAngle, 0, TWO_PI);
  ctx.fill();

  if (prop.variant === SLINGSHOT_LOADED) {
    ctx.fillStyle = STONE;
    ctx.beginPath();
    ctx.arc(pouch.x, pouch.y, STONE_R, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = STONE_LIGHT;
    ctx.beginPath();
    ctx.arc(pouch.x - STONE_LIGHT_OFFSET, pouch.y - STONE_LIGHT_OFFSET, STONE_LIGHT_R, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
};
