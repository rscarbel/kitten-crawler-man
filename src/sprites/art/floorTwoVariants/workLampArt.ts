/**
 * The service level's torch: a site work lamp — yellow tripod, telescoping
 * pole, and a caged reflector head angled down over the room, its power lead
 * trailing away across the floor. The bulb is the only bright thing about it;
 * when struck the cage bends and the bulb, cracked, stutters.
 *
 * All measurements are authored on a 64-pixel tile.
 */

import { FLAME_FRAMES } from '../destructiblePropArt';
import {
  TWO_PI,
  contactShadow,
  cylinderRamp,
  lerp,
  signedUnit,
  verticalRamp,
  withRotation,
  type Ctx,
} from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  BULB_CORE,
  BULB_DIM,
  BULB_HOT,
  LAMP_YELLOW,
  LAMP_YELLOW_DARK,
  LAMP_YELLOW_LIGHT,
  STEEL_DARK,
  STEEL_EDGE,
  STEEL_SPEC,
  line,
} from './floorTwoPaint';

const WORK_LAMP_SEED = 0x3a5d;

const STAND = {
  footBaseFraction: 0.93,
  footSpread: [-13, 0, 13],
  frontFootDrop: 3,
  footWidth: 3,
  footLitOffset: -0.6,
  footPadHalfWidth: 2,
  footPadHeight: 2,
  hubFraction: 0.66,
  hubRadius: 2.6,
  lowerPoleWidth: 4.4,
  /** The lower pole runs a little past the hub, into it. */
  lowerPoleOverlap: 2,
  upperPoleWidth: 3.2,
  clampFraction: 0.2,
  clampHalfWidth: 3.5,
  clampHeight: 3,
  knobLength: 3,
  knobHeight: 1.6,
  headAboveTileFraction: 0.2,
  shadowScale: 0.8,
  shadowDrop: 2,
  damagedTilt: 0.14,
} as const;

const LOWER_POLE_STOPS = [
  [0, LAMP_YELLOW_DARK],
  [0.35, LAMP_YELLOW_LIGHT],
  [1, LAMP_YELLOW_DARK],
] as const;
const UPPER_POLE_STOPS = [
  [0, STEEL_DARK],
  [0.35, STEEL_SPEC],
  [1, STEEL_DARK],
] as const;

const HEAD = {
  rx: 11,
  ry: 8.5,
  tilt: 0.35,
  backOffsetX: -2,
  faceX: 1.5,
  faceY: 1,
  faceRxFraction: 0.62,
  faceRyFraction: 0.78,
  bulbR: 4.4,
  haloGrowth: 1.2,
  cageBars: 4,
  cageWidth: 0.9,
  cageLeftFraction: -0.5,
  cageRightFraction: 0.8,
  cageTopFraction: -0.75,
  cageBottomFraction: 0.85,
  cageBow: 1.5,
  bentBar: 1,
  bentSag: 2.5,
} as const;
const HOUSING_STOPS = [
  [0, LAMP_YELLOW_LIGHT],
  [0.45, LAMP_YELLOW],
  [1, LAMP_YELLOW_DARK],
] as const;
const REFLECTOR_LIT = '#d8cfae';
const REFLECTOR_DARK = '#4a4a46';

/** The crack across a struck bulb's glass, from the head's centre. */
const BULB_CRACK = { x0: 1, y0: -1, x1: 5, y1: 3, width: 0.8 } as const;

/** The power lead, from the head down the pole and away across the floor. */
const LEAD = {
  width: 1.4,
  startX: -2,
  startDrop: 4,
  bowX: -6,
  footX: -3,
  footRise: 2,
  trailBowX: -14,
  trailBowDrop: 4,
  endX: -24,
  endDrop: 2,
} as const;

/** How far the bulb's bright ring breathes with the filament's hum, in pixels. */
const HUM_AMPLITUDE = 0.7;

/** Frames of the damaged row the cracked bulb is out for, stuttering rather than dying. */
const FLICKER_OUT_FRAMES: ReadonlySet<number> = new Set([1, 4]);

function drawLampStand(ctx: Ctx, cx: number, footY: number, hubY: number, headY: number): void {
  for (const dx of STAND.footSpread) {
    const y = footY + (dx === 0 ? STAND.frontFootDrop : 0);
    line(ctx, cx, hubY, cx + dx, y, LAMP_YELLOW_DARK, STAND.footWidth);
    line(
      ctx,
      cx + STAND.footLitOffset,
      hubY,
      cx + dx + STAND.footLitOffset,
      y,
      LAMP_YELLOW_LIGHT,
      1,
    );
    ctx.fillStyle = STEEL_EDGE;
    ctx.fillRect(
      cx + dx - STAND.footPadHalfWidth,
      y - STAND.footPadHeight / 2,
      STAND.footPadHalfWidth * 2,
      STAND.footPadHeight,
    );
  }
  const clampY = lerp(hubY, headY, STAND.clampFraction);
  const lowerHalf = STAND.lowerPoleWidth / 2;
  const upperHalf = STAND.upperPoleWidth / 2;
  ctx.fillStyle = cylinderRamp(ctx, cx - lowerHalf, cx + lowerHalf, 0, LOWER_POLE_STOPS);
  ctx.fillRect(
    cx - lowerHalf,
    clampY,
    STAND.lowerPoleWidth,
    hubY - clampY + STAND.lowerPoleOverlap,
  );
  ctx.fillStyle = cylinderRamp(ctx, cx - upperHalf, cx + upperHalf, 0, UPPER_POLE_STOPS);
  ctx.fillRect(cx - upperHalf, headY, STAND.upperPoleWidth, clampY - headY);
  // The clamp knob that sets the pole's height.
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(
    cx - STAND.clampHalfWidth,
    clampY - STAND.clampHeight / 2,
    STAND.clampHalfWidth * 2,
    STAND.clampHeight,
  );
  ctx.fillRect(
    cx + STAND.clampHalfWidth,
    clampY - STAND.knobHeight / 2,
    STAND.knobLength,
    STAND.knobHeight,
  );
  ctx.fillStyle = LAMP_YELLOW;
  ctx.beginPath();
  ctx.arc(cx, hubY, STAND.hubRadius, 0, TWO_PI);
  ctx.fill();
}

/** The reflector head: a housing tipped toward the viewer, its bulb behind a wire cage. */
function drawLampHead(
  ctx: Ctx,
  cx: number,
  headY: number,
  bulbOn: boolean,
  bent: boolean,
  hum: number,
): void {
  ctx.save();
  ctx.translate(cx, headY);
  ctx.rotate(HEAD.tilt);
  ctx.fillStyle = verticalRamp(ctx, 0, -HEAD.ry, HEAD.ry, HOUSING_STOPS);
  ctx.beginPath();
  ctx.ellipse(HEAD.backOffsetX, 0, HEAD.rx, HEAD.ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = bulbOn ? REFLECTOR_LIT : REFLECTOR_DARK;
  ctx.beginPath();
  ctx.ellipse(
    HEAD.faceX,
    HEAD.faceY,
    HEAD.rx * HEAD.faceRxFraction,
    HEAD.ry * HEAD.faceRyFraction,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  if (bulbOn) {
    ctx.fillStyle = BULB_HOT;
    ctx.beginPath();
    ctx.arc(HEAD.faceX, HEAD.faceY, HEAD.bulbR + HEAD.haloGrowth + hum, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = bulbOn ? BULB_CORE : BULB_DIM;
  ctx.beginPath();
  ctx.arc(HEAD.faceX, HEAD.faceY, HEAD.bulbR, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = HEAD.cageWidth;
  for (let i = 0; i < HEAD.cageBars; i++) {
    const t = (i + 0.5) / HEAD.cageBars;
    const x =
      lerp(HEAD.rx * HEAD.cageLeftFraction, HEAD.rx * HEAD.cageRightFraction, t) + HEAD.faceX;
    const sag = bent && i === HEAD.bentBar ? HEAD.bentSag : 0;
    ctx.beginPath();
    ctx.moveTo(x, HEAD.ry * HEAD.cageTopFraction);
    ctx.quadraticCurveTo(x + HEAD.cageBow + sag, HEAD.faceY, x, HEAD.ry * HEAD.cageBottomFraction);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWorkLamp(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  frame: number,
): void {
  const rng = mulberry32(WORK_LAMP_SEED);
  const cx = ox + ts / 2;
  const footY = oy + ts * STAND.footBaseFraction;
  const hubY = oy + ts * STAND.hubFraction;
  const headY = oy - ts * STAND.headAboveTileFraction;
  contactShadow(ctx, cx, footY + STAND.shadowDrop, ts, STAND.shadowScale);

  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = LEAD.width;
  ctx.beginPath();
  ctx.moveTo(cx + LEAD.startX, headY + LEAD.startDrop);
  ctx.quadraticCurveTo(cx + LEAD.bowX, hubY, cx + LEAD.footX, footY - LEAD.footRise);
  ctx.quadraticCurveTo(
    cx + LEAD.trailBowX + signedUnit(rng),
    footY + LEAD.trailBowDrop,
    cx + LEAD.endX,
    footY + LEAD.endDrop,
  );
  ctx.stroke();

  drawLampStand(ctx, cx, footY, hubY, headY);
  const bulbOn = !(damaged && FLICKER_OUT_FRAMES.has(frame));
  // The filament's hum: the bright ring round the bulb breathes by a fraction of a pixel.
  const hum = Math.sin((frame / FLAME_FRAMES) * TWO_PI) * HUM_AMPLITUDE;
  if (damaged) {
    withRotation(ctx, cx, hubY, STAND.damagedTilt, () => {
      drawLampHead(ctx, cx, headY, bulbOn, true, hum);
      line(
        ctx,
        cx + BULB_CRACK.x0,
        headY + BULB_CRACK.y0,
        cx + BULB_CRACK.x1,
        headY + BULB_CRACK.y1,
        STEEL_EDGE,
        BULB_CRACK.width,
      );
    });
  } else {
    drawLampHead(ctx, cx, headY, bulbOn, false, hum);
  }
}
