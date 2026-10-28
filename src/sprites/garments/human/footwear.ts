/**
 * Footwear on the biped rig: a shoe or boot of any leather and height, for
 * the garments that put one on.
 *
 * Each foot is boxed in a shoe whose silhouette follows the view his bare
 * foot is drawn in — a heel-to-toe profile with a squared heel block edge-on,
 * a round toe box coming at the camera head-on, a flat-heeled cup from
 * behind — and a shaft runs up the shin from it to a rolled top at the
 * look's height. The dark sole is what separates a shoe from a dark foot at
 * the tile, so it is drawn in every view.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import { FOOT_LEN } from '../../art/biped/feet';
import { offset, pt } from '../../art/biped/geometry';
import { crease, shadeForm } from '../../art/biped/paint';
import type { GlossRamp, Ramp } from '../../art/biped/palette';
import { ANKLE_WIDTH, CALF_WIDTH } from '../../art/biped/proportions';
import { scaleFootByBuild } from '../../art/biped/limbs';
import { lerp, type Pt, rgba } from '../../art/bipedArt';
import { fillSoftEllipse } from '../../art/softShade';

type Ctx = CanvasRenderingContext2D;

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

/** What a shoe or boot is made of and how high it stands. */
export interface BootLook {
  readonly leather: GlossRamp;
  readonly sole: Ramp;
  /** The shaft rises from the ankle to this share of the shin, counted from the knee. */
  readonly shaftTopAt: number;
  /**
   * How thick the sole and the heel block stand against a boot's
   * ({@link BOOT_SOLE}): a sneaker's flat foam sole is a thin band all the
   * way along, with no heel block over it.
   */
  readonly soleBuild: SoleBuild;
  /** Iron studs hammered through the sole, in this colour, for a hobnailed boot. */
  readonly studs?: string;
  /** A toe cap of hoof, in this colour, split down its middle into two trotters. */
  readonly trotter?: string;
  /** Laces in this colour up the instep, from the shaft's front to the toe cap. */
  readonly laces?: string;
}

export interface SoleBuild {
  readonly sole: number;
  readonly heel: number;
}

/** A boot's own sole and heel block. */
export const BOOT_SOLE: SoleBuild = { sole: 1, heel: 1 };

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
/**
 * The band is laid over the shaft's shading rather than over it flat: it is
 * the same leather turned down, round the same calf, so it keeps the shaft's
 * light and shade under its own lift.
 */
const CUFF_LIGHT_ALPHA = 0.55;
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

/** Hobnails along the sole: their heads, a share of the sole's depth, and where along the foot each sits. */
const STUD_RADIUS = FOOT_DEPTH * 0.11;
const PROFILE_STUDS = [0.08, 0.3, 0.5, 0.7, 0.9] as const;
/** Head-on the sole is seen end-on: the studs on its toe edge, across the foot. */
const FRONT_STUDS = [-0.55, 0, 0.55] as const;
/** From behind, the studs round the heel block. */
const BACK_STUDS = [-0.6, 0, 0.6] as const;
/** The studs sit on the sole's lower half, where they bite the floor. */
const STUD_DOWN_SOLE = 0.6;

/** The hoof cap: how far back from the toe it reaches, and its cleft's weight. */
const PROFILE_TROTTER_BACK = 1.15;
const FRONT_TROTTER_RISE = 1.9;
const TROTTER_CLEFT_WIDTH = 0.022;
const TROTTER_CLEFT_OPACITY = 1;
/** Edge-on the cleft shows as a notch into the toe, this share of the cap's height. */
const PROFILE_CLEFT_DEPTH = 0.45;

function paintStud(ctx: Ctx, x: number, y: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, STUD_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The laces: a line up the instep with a few crossings over it. At the tile
 * the line is all that shows, so it is drawn a little bolder than a seam.
 */
const LACE_WIDTH = 0.03;
const LACE_CROSSING_HALF = 0.07;
const LACE_CROSSINGS = [0.2, 0.5, 0.8] as const;
/** Edge-on the laces run along the instep's curve, set a little in from its edge. */
const PROFILE_LACE_FROM = 0.1;
const PROFILE_LACE_TO = 0.7;
const PROFILE_LACE_INSET = 0.08;
const PROFILE_LACE_STEPS = 6;
/** Head-on they run down the middle of the vamp to just above the toe cap. */
const FRONT_LACE_TOP = 0.15;
const FRONT_LACE_TOE_SHARE = 0.6;
const FRONT_LACE_BOTTOM_RISE = 1.35;

function strokeLace(ctx: Ctx, points: readonly Pt[], colour: string): void {
  if (points.length === 0) return;
  const first = points[0];
  ctx.strokeStyle = colour;
  ctx.lineWidth = LACE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const at of points.slice(1)) ctx.lineTo(at.x, at.y);
  ctx.stroke();
}

/** Laces from `from` to `to`, crossed by short strokes along `across`. */
function paintLaceRun(ctx: Ctx, from: Pt, to: Pt, across: Pt, colour: string): void {
  strokeLace(ctx, [from, to], colour);
  for (const share of LACE_CROSSINGS) {
    const at = pt(lerp(from.x, to.x, share), lerp(from.y, to.y, share));
    strokeLace(
      ctx,
      [
        offset(at, -across.x * LACE_CROSSING_HALF, -across.y * LACE_CROSSING_HALF),
        offset(at, across.x * LACE_CROSSING_HALF, across.y * LACE_CROSSING_HALF),
      ],
      colour,
    );
  }
}

/** A point on the quadratic from `a` through control `c` to `b`. */
function onQuadratic(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return pt(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  );
}

/** Fills everything below `top` inside the current clip with the sole's dark leather. */
function fillSoleBand(
  ctx: Ctx,
  look: BootLook,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  ctx.fillStyle = look.sole.base;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = look.sole.mid;
  ctx.fillRect(left, top, right - left, (bottom - top) * SOLE_LIP_SHARE);
}
/** The sole's top edge catches the key as a thin welt. */
const SOLE_LIP_SHARE = 0.25;

function legGain(frame: BipedLegFrame): number {
  const nearness =
    frame.drawn === 'left' ? frame.pose.leftLegNearness : frame.pose.rightLegNearness;
  return lerp(1, NEAR_LEG_GAIN, Math.min(Math.max(nearness, 0), 1));
}

function paintShaft(ctx: Ctx, frame: BipedLegFrame, look: BootLook): void {
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
  const top = pt(lerp(knee.x, ankle.x, look.shaftTopAt), lerp(knee.y, ankle.y, look.shaftTopAt));
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
    look.leather,
    { halfWidth: topHalf, specular: LEATHER_SPECULAR },
    () => {
      const cuffBack = side(top, topHalf, 1);
      const cuffFront = side(top, topHalf, -1);
      const cuffDrop = pt(along.x * CUFF_DEPTH, along.y * CUFF_DEPTH);
      ctx.fillStyle = rgba(look.leather.light, CUFF_LIGHT_ALPHA);
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
        look.leather,
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
        look.leather,
        STRAP_OPACITY,
      );
    },
  );
}

function paintProfileFoot(ctx: Ctx, pitch: number, look: BootLook): void {
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
  const soleTop = sole - FOOT_DEPTH * SOLE_THICKNESS * look.soleBuild.sole;
  const heelTop = sole - FOOT_DEPTH * HEEL_BLOCK_THICKNESS * look.soleBuild.heel;
  shadeForm(
    ctx,
    trace,
    { from: pt(heelBack, 0), to: pt(toeTip, 0) },
    look.leather,
    { halfWidth: FOOT_DEPTH * HALF, frameRotation: pitch, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        toeX * PROFILE_INSTEP_AT,
        toeTop,
        length * INSTEP_LIGHT_LENGTH,
        FOOT_DEPTH * INSTEP_LIGHT_DEPTH,
        look.leather.light,
        INSTEP_LIGHT_ALPHA,
      );
      if (look.laces !== undefined) {
        const ankleFront = pt(ANKLE_WIDTH * PROFILE_ANKLE_FRONT, upperTop);
        const instepControl = pt(toeX * PROFILE_INSTEP_AT, -FOOT_DEPTH * PROFILE_INSTEP_RISE);
        const capTop = pt(capBack, toeTop);
        const run: Pt[] = [];
        for (let step = 0; step <= PROFILE_LACE_STEPS; step++) {
          const t = lerp(PROFILE_LACE_FROM, PROFILE_LACE_TO, step / PROFILE_LACE_STEPS);
          const on = onQuadratic(capTop, instepControl, ankleFront, t);
          run.push(offset(on, 0, FOOT_DEPTH * PROFILE_LACE_INSET));
        }
        strokeLace(ctx, run, look.laces);
      }
      crease(
        ctx,
        () => {
          ctx.moveTo(capBack, toeTop);
          ctx.quadraticCurveTo(capBack, soleTop, capBack + toeHalf * HALF, soleTop);
        },
        CUFF_SEAM_WIDTH,
        look.leather,
        PROFILE_TOE_CAP_SEAM_OPACITY,
        pitch,
      );
      if (look.trotter !== undefined) {
        const hoofBack = toeX - toeHalf * PROFILE_TROTTER_BACK;
        ctx.fillStyle = look.trotter;
        ctx.fillRect(hoofBack, toeTop, toeTip - hoofBack, sole - toeTop);
        crease(
          ctx,
          () => {
            ctx.moveTo(hoofBack, toeTop);
            ctx.lineTo(hoofBack, sole);
          },
          CUFF_SEAM_WIDTH,
          look.leather,
          PROFILE_TOE_CAP_SEAM_OPACITY,
          pitch,
        );
        const cleftTop = lerp(sole, toeTop, PROFILE_CLEFT_DEPTH);
        crease(
          ctx,
          () => {
            ctx.moveTo(toeTip, cleftTop);
            ctx.lineTo(toeX, lerp(cleftTop, soleTop, HALF));
          },
          TROTTER_CLEFT_WIDTH,
          look.leather,
          TROTTER_CLEFT_OPACITY,
          pitch,
        );
      }
      fillSoleBand(ctx, look, heelBack, toeTip, soleTop, sole);
      fillSoleBand(ctx, look, heelBack, heelBack + length * HEEL_BLOCK_LENGTH, heelTop, sole);
      const studs = look.studs;
      if (studs !== undefined) {
        const studY = lerp(soleTop, sole, STUD_DOWN_SOLE);
        for (const at of PROFILE_STUDS) paintStud(ctx, lerp(heelBack, toeTip, at), studY, studs);
      }
    },
  );
}

function paintHeadOnFoot(ctx: Ctx, outward: number, shaftHalf: number, look: BootLook): void {
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
  const soleTop = sole - FOOT_DEPTH * SOLE_THICKNESS * look.soleBuild.sole;
  const left = Math.min(toeInner, toeOuter, -a * FRONT_HEEL_OUTER);
  const right = Math.max(toeInner, toeOuter, a * FRONT_HEEL_OUTER);
  shadeForm(
    ctx,
    trace,
    { from: pt(0, top), to: pt(toes, sole) },
    look.leather,
    { halfWidth: f, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        toes + inner * f * FRONT_TOE_LIGHT_INBOARD,
        sole - toeRow * FRONT_TOE_CAP_RISE,
        f * FRONT_TOE_LIGHT_WIDTH,
        toeRow * FRONT_TOE_LIGHT_HEIGHT,
        look.leather.light,
        FRONT_TOE_LIGHT_ALPHA,
      );
      if (look.laces !== undefined) {
        const laceTop = pt(0, lerp(top, sole, FRONT_LACE_TOP));
        const laceBottom = pt(
          toes * FRONT_LACE_TOE_SHARE,
          sole - toeRow * FRONT_LACE_BOTTOM_RISE * FRONT_TOE_CAP_ARCH,
        );
        paintLaceRun(ctx, laceTop, laceBottom, pt(1, 0), look.laces);
      }
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
        look.leather,
        PROFILE_TOE_CAP_SEAM_OPACITY,
      );
      if (look.trotter !== undefined) {
        const hoofTop = sole - toeRow * FRONT_TROTTER_RISE;
        ctx.fillStyle = look.trotter;
        ctx.fillRect(left, hoofTop, right - left, sole - hoofTop);
        crease(
          ctx,
          () => {
            ctx.moveTo(toes, hoofTop);
            ctx.lineTo(toes, sole);
          },
          TROTTER_CLEFT_WIDTH,
          look.leather,
          TROTTER_CLEFT_OPACITY,
        );
      }
      fillSoleBand(ctx, look, left, right, soleTop, sole);
      const studs = look.studs;
      if (studs !== undefined) {
        const studY = lerp(soleTop, sole, STUD_DOWN_SOLE);
        for (const across of FRONT_STUDS) paintStud(ctx, toes + across * f, studY, studs);
      }
    },
  );
}

function paintHeelFromBehind(ctx: Ctx, shaftHalf: number, look: BootLook): void {
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
    look.leather,
    { halfWidth: cup, specular: LEATHER_SPECULAR },
    () => {
      fillSoftEllipse(
        ctx,
        -cup * HALF,
        bottom - radius * BACK_LIGHT_RISE,
        cup * BACK_LIGHT_WIDTH,
        radius * BACK_LIGHT_HEIGHT,
        look.leather.light,
        BACK_LIGHT_ALPHA,
      );
      const heelTop = bottom - FOOT_DEPTH * HEEL_BLOCK_THICKNESS * look.soleBuild.heel;
      fillSoleBand(ctx, look, -cup, cup, heelTop, bottom);
      const studs = look.studs;
      if (studs !== undefined) {
        const studY = lerp(heelTop, bottom, STUD_DOWN_SOLE);
        for (const across of BACK_STUDS) paintStud(ctx, across * cup, studY, studs);
      }
    },
  );
}

function pointedStretch(frame: BipedLegFrame): number {
  const point =
    (frame.drawn === 'left' ? frame.pose.leftFootPoint : frame.pose.rightFootPoint) ?? 0;
  return 1 + Math.min(Math.max(point, 0), 1) * POINTED_STRETCH;
}

function paintFoot(ctx: Ctx, frame: BipedLegFrame, look: BootLook): void {
  const { view } = frame;
  const shaftHalf = ANKLE_WIDTH * SHAFT_ANKLE_FLARE * legGain(frame);
  ctx.save();
  ctx.translate(frame.chain.end.x, frame.chain.end.y);
  ctx.scale(frame.footScale, frame.footScale);
  scaleFootByBuild(ctx, view, frame.look.limbs);
  if (view.showsBack) paintHeelFromBehind(ctx, shaftHalf, look);
  else if (view.profile) {
    ctx.rotate(frame.footPitch);
    paintProfileFoot(ctx, frame.footPitch, look);
  } else {
    ctx.scale(1, pointedStretch(frame));
    paintHeadOnFoot(ctx, frame.footOut, shaftHalf, look);
  }
  ctx.restore();
}

/**
 * Paints a boot of `look` over one leg frame's foot and shin: the foot boxed
 * the way the bare foot is drawn in the view, and a shaft up the shin.
 */
export function paintBootOnLeg(ctx: Ctx, frame: BipedLegFrame, look: BootLook): void {
  if (frame.segments === 'thigh') return;
  paintShaft(ctx, frame, look);
  paintFoot(ctx, frame, look);
}
