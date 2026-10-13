/**
 * The Marching Boots on Carl: dark, hard-soled leather boots to mid-calf.
 *
 * Each foot is boxed in a boot whose silhouette follows the view his bare
 * foot is drawn in — a heel-to-toe profile with a squared heel block edge-on,
 * a round toe box coming at the camera head-on, a flat-heeled cup from
 * behind — and a shaft runs up the shin from it to a rolled top halfway to
 * the knee. The near-black sole is what separates a boot from a dark foot at
 * the tile, so it is drawn thick in every view.
 */

import type { CarlLegFrame } from '../../art/carl/carlParts';
import { FOOT_LEN } from '../../art/carl/feet';
import { offset, pt, TWO_PI } from '../../art/carl/geometry';
import { crease, shadeForm } from '../../art/carl/paint';
import { deriveGlossRamp, deriveRamp } from '../../art/carl/palette';
import { ANKLE_WIDTH, CALF_WIDTH } from '../../art/carl/proportions';
import { lerp, type Pt } from '../../art/carlArt';
import { fillSoftEllipse } from '../../art/softShade';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Near-black, cooler than his red-brown jacket: in a crouch the boots sit
 * against the jacket, and a leather of the jacket's own brown merged into it.
 */
const BOOT_LEATHER = '#2c2321';
const SOLE_LEATHER = '#120d0b';
const HOBNAIL = '#9b9aa0';
const LEATHER = deriveGlossRamp(BOOT_LEATHER);
const SOLE = deriveRamp(SOLE_LEATHER);
/** Worn leather takes a dull sheen, not a polished one. */
const LEATHER_SPECULAR = 0.45;

/** The foot's own measures, as `feet.ts` draws the bare foot the boot covers. */
const FOOT_DEPTH = FOOT_LEN * 0.5;
const HEEL_SHARE = 0.22;
const SOLE_DROP = 0.5;
const TOE_HEIGHT_SHARE = 0.38;
const POINTED_STRETCH = 0.9;
const FOOT_HALF_WIDTH = FOOT_LEN * 0.36;
const TOES_TOWARD_CAMERA = 0.5;
const TOE_SPLAY = FOOT_LEN * 0.12;
const TOE_ROW = 0.38;
const HEEL_SIDE_DROP = 0.35;
const BACK_HEEL_DROP = 0.35;
const BACK_HEEL_RADIUS = 0.55;

/** The shaft rises from the ankle to this share of the shin, counted from the knee. */
const SHAFT_TOP_AT = 0.42;
/** Half-widths against the bare leg's: leather stands off the ankle, and the top hugs the calf. */
const SHAFT_ANKLE_FLARE = 1.45;
const SHAFT_TOP_FIT = 0.9;
/** Edge-on the calf swells behind the shin, so the shaft carries more of its width at the back. */
const PROFILE_BACK_SHARE = 1.15;
const PROFILE_FRONT_SHARE = 0.85;
/** A leg swung toward the camera draws larger, and the shaft grows with it. */
const NEAR_LEG_GAIN = 1.16;
/** The shaft runs on past the ankle so it tucks under the foot's upper. */
const SHAFT_BELOW_ANKLE = 0.06;
/** The rolled top: a lit band, with a seam shadow under it. */
const CUFF_DEPTH = 0.035;
const CUFF_SEAM_WIDTH = 0.02;
const CUFF_SEAM_OPACITY = 0.9;
/** A strap round the ankle, just above the foot. */
const STRAP_ABOVE_ANKLE = 0.11;
const STRAP_WIDTH = 0.022;
const STRAP_OPACITY = 0.75;

/** How thick the sole and the heel block stand, in foot depths. */
const SOLE_THICKNESS = 0.28;
const HEEL_BLOCK_THICKNESS = 0.62;
const HEEL_BLOCK_LENGTH = 0.32;

// ── Profile ──
/** The upper rises up the leg to meet the shaft, front and back. */
const PROFILE_UPPER_TOP = 0.9;
/** The heel is squared off behind the bare heel's bulb. */
const PROFILE_HEEL_BACK = 0.3;
const PROFILE_HEEL_ROUND = 0.5;
/** The toe box overshoots the big toe a little and stands a little taller than it. */
const PROFILE_TOE_LEAD = 0.95;
const PROFILE_TOE_HEIGHT = 1.45;
const PROFILE_TOE_CAP_BACK = 0.7;
/** The instep climbs from the toe cap to the front of the shaft. */
const PROFILE_INSTEP_AT = 0.35;
const PROFILE_INSTEP_RISE = 0.35;
const PROFILE_ANKLE_FRONT = 1.3;
const PROFILE_ANKLE_BACK = 1.6;
const PROFILE_TOE_CAP_SEAM_OPACITY = 0.7;
const INSTEP_LIGHT_LENGTH = 0.22;
const INSTEP_LIGHT_DEPTH = 0.14;
const INSTEP_LIGHT_ALPHA = 0.8;
const HOBNAIL_RADIUS = 0.01;
const HOBNAIL_SHARES: readonly number[] = [0.15, 0.45, 0.75];
const HOBNAIL_ALPHA = 0.85;

// ── Head-on ──
const FRONT_UPPER_TOP = 0.75;
const FRONT_HEEL_INNER = 1.75;
const FRONT_HEEL_OUTER = 2.1;
const FRONT_TOE_BOX = 1.5;
const FRONT_TOE_SHOULDER = 0.9;
const FRONT_TOE_CAP_RISE = 1.7;
/** The toe cap's seam arches up over the toes rather than running straight across. */
const FRONT_TOE_CAP_ARCH = 2;
const FRONT_TOE_LIGHT_INBOARD = 0.25;
const FRONT_TOE_LIGHT_WIDTH = 0.5;
const FRONT_TOE_LIGHT_HEIGHT = 0.5;
const FRONT_TOE_LIGHT_ALPHA = 1;

// ── From behind ──
const BACK_CUP_WIDTH = 1.55;
const BACK_CUP_SHOULDER = 0.45;
const BACK_HEEL_CORNER = 0.25;
const BACK_LIGHT_RISE = 1.1;
const BACK_LIGHT_WIDTH = 0.5;
const BACK_LIGHT_HEIGHT = 0.4;
const BACK_LIGHT_ALPHA = 0.6;

const HALF = 0.5;

/** Fills everything below `top` inside the current clip with the sole's dark leather. */
function fillSoleBand(ctx: Ctx, left: number, right: number, top: number, bottom: number): void {
  ctx.fillStyle = SOLE.base;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = SOLE.mid;
  ctx.fillRect(left, top, right - left, (bottom - top) * SOLE_LIP_SHARE);
}
/** The sole's top edge catches the key as a thin welt. */
const SOLE_LIP_SHARE = 0.25;

function legGain(frame: CarlLegFrame): number {
  const nearness =
    frame.drawn === 'left' ? frame.pose.leftLegNearness : frame.pose.rightLegNearness;
  return lerp(1, NEAR_LEG_GAIN, Math.min(Math.max(nearness, 0), 1));
}

function paintShaft(ctx: Ctx, frame: CarlLegFrame): void {
  const { joint: knee, end: ankle } = frame.chain;
  const dx = ankle.x - knee.x;
  const dy = ankle.y - knee.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const along: Pt = pt(dx / length, dy / length);
  const across: Pt = pt(-along.y, along.x);
  const gain = legGain(frame);
  const profile = frame.view.profile;
  const backShare = profile ? PROFILE_BACK_SHARE : 1;
  const frontShare = profile ? PROFILE_FRONT_SHARE : 1;
  const topHalf = CALF_WIDTH * SHAFT_TOP_FIT * gain;
  const ankleHalf = ANKLE_WIDTH * SHAFT_ANKLE_FLARE * gain;
  const top = pt(lerp(knee.x, ankle.x, SHAFT_TOP_AT), lerp(knee.y, ankle.y, SHAFT_TOP_AT));
  const bottom = offset(ankle, along.x * SHAFT_BELOW_ANKLE, along.y * SHAFT_BELOW_ANKLE);
  const side = (at: Pt, half: number, sign: number): Pt => {
    const share = sign > 0 ? backShare : frontShare;
    return offset(at, across.x * half * share * sign, across.y * half * share * sign);
  };

  const trace = (): void => {
    ctx.beginPath();
    const topBack = side(top, topHalf, 1);
    const topFront = side(top, topHalf, -1);
    ctx.moveTo(topBack.x, topBack.y);
    const lowBack = side(bottom, ankleHalf, 1);
    const lowFront = side(bottom, ankleHalf, -1);
    ctx.lineTo(lowBack.x, lowBack.y);
    ctx.lineTo(lowFront.x, lowFront.y);
    ctx.lineTo(topFront.x, topFront.y);
    ctx.closePath();
  };
  shadeForm(
    ctx,
    trace,
    { from: top, to: bottom },
    LEATHER,
    { halfWidth: topHalf, specular: LEATHER_SPECULAR },
    () => {
      const cuffBack = side(top, topHalf, 1);
      const cuffFront = side(top, topHalf, -1);
      const cuffDrop = pt(along.x * CUFF_DEPTH, along.y * CUFF_DEPTH);
      ctx.fillStyle = LEATHER.light;
      ctx.beginPath();
      ctx.moveTo(cuffBack.x, cuffBack.y);
      ctx.lineTo(cuffFront.x, cuffFront.y);
      ctx.lineTo(cuffFront.x + cuffDrop.x, cuffFront.y + cuffDrop.y);
      ctx.lineTo(cuffBack.x + cuffDrop.x, cuffBack.y + cuffDrop.y);
      ctx.closePath();
      ctx.fill();
      crease(
        ctx,
        () => {
          ctx.moveTo(cuffBack.x + cuffDrop.x, cuffBack.y + cuffDrop.y);
          ctx.lineTo(cuffFront.x + cuffDrop.x, cuffFront.y + cuffDrop.y);
        },
        CUFF_SEAM_WIDTH,
        LEATHER,
        CUFF_SEAM_OPACITY,
      );
      const strapAt = offset(ankle, -along.x * STRAP_ABOVE_ANKLE, -along.y * STRAP_ABOVE_ANKLE);
      const strapBack = side(strapAt, topHalf, 1);
      const strapFront = side(strapAt, topHalf, -1);
      crease(
        ctx,
        () => {
          ctx.moveTo(strapBack.x, strapBack.y);
          ctx.lineTo(strapFront.x, strapFront.y);
        },
        STRAP_WIDTH,
        LEATHER,
        STRAP_OPACITY,
      );
    },
  );
}

function paintProfileFoot(ctx: Ctx, pitch: number): void {
  const length = FOOT_LEN;
  const toeX = length * (1 - HEEL_SHARE);
  const heelX = -length * HEEL_SHARE;
  const sole = FOOT_DEPTH * SOLE_DROP;
  const toeHalf = FOOT_DEPTH * TOE_HEIGHT_SHARE;
  const upperTop = -FOOT_DEPTH * PROFILE_UPPER_TOP;
  const heelBack = heelX - FOOT_DEPTH * PROFILE_HEEL_BACK;
  const toeTip = toeX + toeHalf * PROFILE_TOE_LEAD;
  const toeTop = sole - toeHalf * PROFILE_TOE_HEIGHT;
  const capBack = toeX - toeHalf * PROFILE_TOE_CAP_BACK;

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(-ANKLE_WIDTH * PROFILE_ANKLE_BACK, upperTop);
    ctx.lineTo(heelBack, sole - FOOT_DEPTH * PROFILE_HEEL_ROUND);
    ctx.lineTo(heelBack, sole);
    ctx.lineTo(toeX, sole);
    ctx.quadraticCurveTo(toeTip, sole, toeTip, lerp(sole, toeTop, HALF));
    ctx.quadraticCurveTo(toeTip, toeTop, capBack, toeTop);
    ctx.quadraticCurveTo(
      toeX * PROFILE_INSTEP_AT,
      -FOOT_DEPTH * PROFILE_INSTEP_RISE,
      ANKLE_WIDTH * PROFILE_ANKLE_FRONT,
      upperTop,
    );
    ctx.closePath();
  };
  const soleTop = sole - FOOT_DEPTH * SOLE_THICKNESS;
  const heelTop = sole - FOOT_DEPTH * HEEL_BLOCK_THICKNESS;
  shadeForm(
    ctx,
    trace,
    { from: pt(heelBack, 0), to: pt(toeTip, 0) },
    LEATHER,
    { halfWidth: FOOT_DEPTH * HALF, frameRotation: pitch, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        toeX * PROFILE_INSTEP_AT,
        toeTop,
        length * INSTEP_LIGHT_LENGTH,
        FOOT_DEPTH * INSTEP_LIGHT_DEPTH,
        LEATHER.light,
        INSTEP_LIGHT_ALPHA,
      );
      crease(
        ctx,
        () => {
          ctx.moveTo(capBack, toeTop);
          ctx.quadraticCurveTo(capBack, soleTop, capBack + toeHalf * HALF, soleTop);
        },
        CUFF_SEAM_WIDTH,
        LEATHER,
        PROFILE_TOE_CAP_SEAM_OPACITY,
        pitch,
      );
      fillSoleBand(ctx, heelBack, toeTip, soleTop, sole);
      fillSoleBand(ctx, heelBack, heelBack + length * HEEL_BLOCK_LENGTH, heelTop, sole);
      ctx.fillStyle = HOBNAIL;
      ctx.globalAlpha *= HOBNAIL_ALPHA;
      for (const share of HOBNAIL_SHARES) {
        ctx.beginPath();
        ctx.arc(lerp(heelBack, toeTip, share), sole, HOBNAIL_RADIUS, 0, TWO_PI);
        ctx.fill();
      }
    },
  );
}

function paintHeadOnFoot(ctx: Ctx, outward: number, shaftHalf: number): void {
  const sole = FOOT_DEPTH * (SOLE_DROP + TOES_TOWARD_CAMERA);
  const toeRow = FOOT_DEPTH * TOE_ROW;
  const inner = -outward;
  const toes = outward * TOE_SPLAY;
  const f = FOOT_HALF_WIDTH;
  const a = ANKLE_WIDTH;
  const top = -FOOT_DEPTH * FRONT_UPPER_TOP;
  const heelY = FOOT_DEPTH * HEEL_SIDE_DROP;
  const toeInner = toes + inner * f * FRONT_TOE_BOX;
  const toeOuter = toes - inner * f * FRONT_TOE_BOX;
  const shoulderY = sole - toeRow * FRONT_TOE_SHOULDER;

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(inner * shaftHalf, top);
    ctx.lineTo(inner * a * FRONT_HEEL_INNER, heelY);
    ctx.quadraticCurveTo(toeInner, heelY, toeInner, shoulderY);
    ctx.quadraticCurveTo(toeInner, sole, toes, sole);
    ctx.quadraticCurveTo(toeOuter, sole, toeOuter, shoulderY);
    ctx.quadraticCurveTo(toeOuter, heelY, outward * a * FRONT_HEEL_OUTER, heelY);
    ctx.lineTo(outward * shaftHalf, top);
    ctx.closePath();
  };
  const soleTop = sole - FOOT_DEPTH * SOLE_THICKNESS;
  const left = Math.min(toeInner, toeOuter, -a * FRONT_HEEL_OUTER);
  const right = Math.max(toeInner, toeOuter, a * FRONT_HEEL_OUTER);
  shadeForm(
    ctx,
    trace,
    { from: pt(0, top), to: pt(toes, sole) },
    LEATHER,
    { halfWidth: f, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        toes + inner * f * FRONT_TOE_LIGHT_INBOARD,
        sole - toeRow * FRONT_TOE_CAP_RISE,
        f * FRONT_TOE_LIGHT_WIDTH,
        toeRow * FRONT_TOE_LIGHT_HEIGHT,
        LEATHER.light,
        FRONT_TOE_LIGHT_ALPHA,
      );
      crease(
        ctx,
        () => {
          ctx.moveTo(toeOuter, sole - toeRow * FRONT_TOE_CAP_RISE);
          ctx.quadraticCurveTo(
            toes,
            sole - toeRow * FRONT_TOE_CAP_RISE * FRONT_TOE_CAP_ARCH,
            toeInner,
            sole - toeRow * FRONT_TOE_CAP_RISE,
          );
        },
        CUFF_SEAM_WIDTH,
        LEATHER,
        PROFILE_TOE_CAP_SEAM_OPACITY,
      );
      fillSoleBand(ctx, left, right, soleTop, sole);
    },
  );
}

function paintHeelFromBehind(ctx: Ctx, shaftHalf: number): void {
  const radius = FOOT_DEPTH * BACK_HEEL_RADIUS;
  const bottom = FOOT_DEPTH * BACK_HEEL_DROP + radius;
  const cup = radius * BACK_CUP_WIDTH;
  const shoulderY = bottom - radius * BACK_CUP_SHOULDER;
  const corner = radius * BACK_HEEL_CORNER;

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(-shaftHalf, 0);
    ctx.quadraticCurveTo(-cup, 0, -cup, shoulderY);
    ctx.lineTo(-cup, bottom - corner);
    ctx.quadraticCurveTo(-cup, bottom, -cup + corner, bottom);
    ctx.lineTo(cup - corner, bottom);
    ctx.quadraticCurveTo(cup, bottom, cup, bottom - corner);
    ctx.lineTo(cup, shoulderY);
    ctx.quadraticCurveTo(cup, 0, shaftHalf, 0);
    ctx.closePath();
  };
  shadeForm(
    ctx,
    trace,
    { from: pt(0, 0), to: pt(0, bottom) },
    LEATHER,
    { halfWidth: cup, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        -cup * HALF,
        bottom - radius * BACK_LIGHT_RISE,
        cup * BACK_LIGHT_WIDTH,
        radius * BACK_LIGHT_HEIGHT,
        LEATHER.light,
        BACK_LIGHT_ALPHA,
      );
      fillSoleBand(ctx, -cup, cup, bottom - FOOT_DEPTH * HEEL_BLOCK_THICKNESS, bottom);
    },
  );
}

function pointedStretch(frame: CarlLegFrame): number {
  const point =
    (frame.drawn === 'left' ? frame.pose.leftFootPoint : frame.pose.rightFootPoint) ?? 0;
  return 1 + Math.min(Math.max(point, 0), 1) * POINTED_STRETCH;
}

function paintFoot(ctx: Ctx, frame: CarlLegFrame): void {
  const { view } = frame;
  const shaftHalf = ANKLE_WIDTH * SHAFT_ANKLE_FLARE * legGain(frame);
  ctx.save();
  ctx.translate(frame.chain.end.x, frame.chain.end.y);
  ctx.scale(frame.footScale, frame.footScale);
  if (view.showsBack) paintHeelFromBehind(ctx, shaftHalf);
  else if (view.profile) {
    ctx.rotate(frame.footPitch);
    paintProfileFoot(ctx, frame.footPitch);
  } else {
    ctx.scale(1, pointedStretch(frame));
    paintHeadOnFoot(ctx, frame.footOut, shaftHalf);
  }
  ctx.restore();
}

function paintLeg(ctx: Ctx, frame: CarlLegFrame): void {
  if (frame.segments === 'thigh') return;
  paintShaft(ctx, frame);
  paintFoot(ctx, frame);
}

export const CARL_BOOTS = defineGarment({
  id: 'carl_boots',
  name: 'Marching Boots',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  hides: [
    { kind: 'garment', garment: 'carl_toe_ring' },
    { kind: 'garment', garment: 'carl_pedicure' },
  ],
  paint: { leg: carlEveryView(paintLeg) },
});
