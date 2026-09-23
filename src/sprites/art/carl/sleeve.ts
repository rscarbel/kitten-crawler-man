/**
 * The leather sleeve over Carl's upper arm, shoved up past the elbow so the
 * forearm below it is bare.
 *
 * The sleeve belongs to the jacket, not to the arm: its top is the jacket's
 * shoulder, and the deltoid under it is what pushes the leather out into the
 * cap that makes his shoulders the widest point of the figure.
 */

import { angleBetween, HALF_PI, mixPt, pt, TWO_PI } from './geometry';
import { castShadow, crease, shadeForm } from './paint';
import { type GlossRamp, LEATHER, LIGHT, type Ramp, recededGloss } from './palette';
import { SLEEVE_BULK } from './proportions';
import { type BoneChain } from './rig';
import { mix, type Pt } from '../carlArt';
import { fillSoftEllipse } from '../softShade';

type Ctx = CanvasRenderingContext2D;

/** The bare arm a sleeve is laid over, as `limbs.ts` draws it. */
interface SleevedArm {
  readonly chain: BoneChain;
  /** Half-width of the bare upper arm at the shoulder. */
  readonly upperHalf: number;
  /** Half-width of the bare arm at the elbow. */
  readonly elbowHalf: number;
  /** Half-width of the bare forearm at its widest, which the shoved-up cuff grips. */
  readonly forearmHalf: number;
  /** The forearm's own ramp, for the cuff's shadow on the skin. */
  readonly flesh: Ramp;
  /** Traces the bare forearm, the surface the cuff's shadow falls on. */
  readonly traceForearm: () => void;
  /** How far the whole arm recedes into the body's shade; far arms recede. */
  readonly shade: number;
}

/**
 * How much further than the flesh a receding arm's sleeve recedes, so it reads
 * as its own panel against the body it hangs behind.
 */
const SLEEVE_SHADE = 0.16;

/**
 * A near arm's sleeve takes the jacket's full lit leather. It hangs over or
 * beside the jacket's flanks, which the torso paints in shadow, so the arm
 * reads lighter than the body behind it and stands off it; darkened to match,
 * the sleeve and the flank merge into one brown box.
 */
function sleeveLeather(arm: SleevedArm): GlossRamp {
  if (arm.shade === 0) return LEATHER;
  return recededGloss(LEATHER, arm.shade + SLEEVE_SHADE);
}

/**
 * The deltoid cap, as extra half-width over the padded arm. It is what makes
 * the shoulders — not the chest or the hips — the widest line of the figure,
 * and at the 32 px tile that width is most of what says "heavy frame".
 */
const DELTOID_SWELL = 0.04;
/** How far down the upper arm the deltoid gives way to the biceps and triceps. */
const DELTOID_INSERTION = 0.5;
/** The upper arm just below the deltoid, as a share of the cap's half-width. */
const INSERTION_PINCH = 0.8;
/** Where the arm mass below the deltoid is fullest, along the upper arm. */
const ARM_BELLY_AT = 0.68;
const ARM_BELLY_SWELL = 0.8;

/**
 * How far down the forearm the shoved-up sleeve reaches, as a share of the
 * forearm. Pushed up only just past the elbow: the forearm is where arm muscle
 * reads at game size, and it is bare.
 */
const CUFF_ALONG_FOREARM = 0.07;
/**
 * The shoved-up leather gathers into a roll wider than the arm it sits on;
 * that bunched ring is the whole visual difference between a sleeve pushed up
 * and a short sleeve.
 */
const BUNCH_BULK = 2.4;
/**
 * The concertina fold across the gathered roll, as a share of its length. One
 * fold: the roll is two or three pixels long at the tile, so a second one
 * lands on the same pixels.
 */
const BUNCH_FOLDS = [0.5] as const;

/** The hard glint riding the deltoid cap, where the leather is stretched tightest. */
const CAP_GLINT_ALPHA = 0.8;
/** Where on the cap the glint sits, along the bone from the shoulder joint and toward the lit side. */
const CAP_GLINT_ALONG = 0.12;
const CAP_GLINT_ACROSS = 0.45;
const CAP_GLINT_LENGTH = 0.6;
const CAP_GLINT_WIDTH = 0.3;
const CAP_GLINT_CORE = 0.55;

/**
 * Worn leather never lies smooth down a sleeve: it breaks into a few slanted
 * wrinkles where the arm bends and twists. Without them the sleeve is one
 * unbroken gradient round a cylinder, and a smooth glossy cylinder reads as
 * rubber or moulded plastic. One, not several: evenly spaced bands down a
 * sleeve read as a quilted puffer. It starts past one edge (the clip ends it)
 * and dies out partway across, slanting down toward `reach`.
 */
const SLEEVE_WRINKLES: readonly { at: number; slant: number; reach: number }[] = [
  { at: 0.66, slant: 0.14, reach: 0.2 },
];
const WRINKLE_OPACITY = 0.7;

/** Stiff leather folds sharp: a narrow core with a bright lower lip. */
const FOLD_WIDTH = 0.03;
const FOLD_OPACITY = 0.85;
/** Below this bend the elbow is straight and the leather lies flat. */
const CROOK_MIN_BEND = 0.25;
/** The crook fold spans this share of the elbow's width, on the inside of the bend. */
const CROOK_SPAN = 0.8;
/** How far a crook fold sits up the upper arm from the elbow, as a share of its half-width. */
const CROOK_RISE = 0.5;
/** The crook fold slants down toward the inside of the bend, ending this share of its rise lower. */
const CROOK_FALL = 0.3;
/** Folds are stroked past the form's edge so the clip, not the stroke's round cap, ends them. */
const FOLD_OVERREACH = 1.2;
/** A roll fold bows toward the cuff, by this share of the cuff's half-width. */
const FOLD_SAG = 0.3;

/** The cuff's shadow on the forearm, as a share of the cuff's half-width. */
const CUFF_SHADOW_WIDTH = 0.45;
/** The rolled edge of the cuff, a lip one step darker than the leather it turns under. */
const CUFF_LIP = 0.22;
const CUFF_LIP_LIFT = 0.35;

interface ArmFrame {
  readonly at: (along: number, across: number) => Pt;
  readonly length: number;
  readonly angle: number;
}

function frameOf(from: Pt, to: Pt): ArmFrame {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = angleBetween(from, to);
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  return {
    length,
    angle,
    at: (along, across) => pt(from.x + ax * along - ay * across, from.y + ay * along + ax * across),
  };
}

/**
 * The upper sleeve's silhouette: a round deltoid cap over the shoulder joint,
 * pinched where the deltoid inserts, swelling again over the biceps and
 * triceps, and rounding into the elbow.
 */
function traceUpperSleeve(ctx: Ctx, frame: ArmFrame, cap: number, elbow: number): void {
  const { at, length, angle } = frame;
  const insertion = cap * INSERTION_PINCH;
  const belly = Math.max(elbow, cap * ARM_BELLY_SWELL);
  const root = at(0, 0);
  const end = at(length, 0);
  ctx.beginPath();
  // The cap is flatter than a half-circle: the deltoid bulges out to the side
  // far more than it rises over the joint, and a round cap puts the top of
  // the sleeve level with the collar, squaring off the trapezius's slope.
  ctx.ellipse(root.x, root.y, cap * CAP_RISE, cap, angle, HALF_PI, HALF_PI * 3);
  for (const side of [-1, 1]) {
    const shoulderControl = at(length * DELTOID_INSERTION * HALF, side * cap);
    const pinch = at(length * DELTOID_INSERTION, side * insertion);
    const bellyControl = at(length * ARM_BELLY_AT, side * belly * BELLY_CONTROL_REACH);
    const elbowSide = at(length, side * elbow);
    if (side < 0) {
      ctx.quadraticCurveTo(shoulderControl.x, shoulderControl.y, pinch.x, pinch.y);
      ctx.quadraticCurveTo(bellyControl.x, bellyControl.y, elbowSide.x, elbowSide.y);
      ctx.arc(end.x, end.y, elbow, angle - HALF_PI, angle + HALF_PI);
    } else {
      const capSide = at(0, cap);
      ctx.quadraticCurveTo(bellyControl.x, bellyControl.y, pinch.x, pinch.y);
      ctx.quadraticCurveTo(shoulderControl.x, shoulderControl.y, capSide.x, capSide.y);
    }
  }
  ctx.closePath();
}

/** The gathered roll of leather from the elbow to the cuff, wider than the arm under it. */
function traceBunch(ctx: Ctx, frame: ArmFrame, elbow: number, cuff: number): void {
  const { at, length } = frame;
  ctx.beginPath();
  const start = at(0, -elbow);
  ctx.moveTo(start.x, start.y);
  for (const side of [-1, 1]) {
    const bulge = at(length * HALF, side * cuff * BUNCH_BULGE);
    const cuffEdge = at(length, side * cuff);
    const elbowEdge = at(0, side * elbow);
    if (side < 0) {
      ctx.quadraticCurveTo(bulge.x, bulge.y, cuffEdge.x, cuffEdge.y);
      const lip = at(length + cuff * CUFF_ROUND, 0);
      const otherCuff = at(length, cuff);
      ctx.quadraticCurveTo(lip.x, lip.y, otherCuff.x, otherCuff.y);
    } else {
      ctx.quadraticCurveTo(bulge.x, bulge.y, elbowEdge.x, elbowEdge.y);
    }
  }
  ctx.closePath();
}

const HALF = 0.5;
/** How far the cap rises over the shoulder joint, as a share of its half-width. */
const CAP_RISE = 0.42;
/** A quadratic's control sits past the curve it bends; this puts the belly's peak on `ARM_BELLY_SWELL`. */
const BELLY_CONTROL_REACH = 1.12;
/** The roll bows a little past its cuff between the elbow and the cuff. */
const BUNCH_BULGE = 1.06;
/** How far the cuff's rolled edge rounds past the cuff line, as a share of its half-width. */
const CUFF_ROUND = 0.35;

/**
 * Paints the sleeve over an arm `limbs.ts` has already drawn bare: the cuff's
 * shadow on the forearm, then the gathered roll at the elbow, then the upper
 * sleeve and its deltoid cap over the top of it all.
 */
export function drawSleeve(ctx: Ctx, arm: SleevedArm): void {
  const { chain } = arm;
  const leather = sleeveLeather(arm);
  const cap = arm.upperHalf + SLEEVE_BULK + DELTOID_SWELL;
  const elbow = arm.elbowHalf + SLEEVE_BULK;
  const cuffHalf = arm.forearmHalf + SLEEVE_BULK * BUNCH_BULK;
  const cuffAt = mixPt(chain.joint, chain.end, CUFF_ALONG_FOREARM);

  const upper = frameOf(chain.root, chain.joint);
  const lower = frameOf(chain.joint, cuffAt);

  // The cuff throws its shadow on the forearm before the roll is laid over,
  // so only the part that falls past the cuff survives.
  const across = lower.at(lower.length, cuffHalf);
  const acrossOther = lower.at(lower.length, -cuffHalf);
  castShadow(
    ctx,
    arm.traceForearm,
    () => {
      ctx.beginPath();
      ctx.moveTo(across.x, across.y);
      ctx.lineTo(acrossOther.x, acrossOther.y);
    },
    arm.flesh,
    cuffHalf * CUFF_SHADOW_WIDTH,
  );

  const traceRoll = (): void => traceBunch(ctx, lower, elbow, cuffHalf);
  shadeForm(
    ctx,
    traceRoll,
    { from: chain.joint, to: cuffAt },
    leather,
    {
      halfWidth: cuffHalf,
    },
    () => {
      for (const share of BUNCH_FOLDS) {
        const l = lower.at(lower.length * share, -cuffHalf * FOLD_OVERREACH);
        const r = lower.at(lower.length * share, cuffHalf * FOLD_OVERREACH);
        const sag = lower.at(lower.length * share + cuffHalf * FOLD_SAG, 0);
        crease(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(l.x, l.y);
            ctx.quadraticCurveTo(sag.x, sag.y, r.x, r.y);
          },
          FOLD_WIDTH,
          leather,
          FOLD_OPACITY,
        );
      }
      const lipL = lower.at(lower.length - cuffHalf * CUFF_LIP, -cuffHalf * FOLD_OVERREACH);
      const lipR = lower.at(lower.length - cuffHalf * CUFF_LIP, cuffHalf * FOLD_OVERREACH);
      ctx.strokeStyle = mix(leather.dark, leather.mid, CUFF_LIP_LIFT);
      ctx.lineWidth = cuffHalf * CUFF_LIP * 2;
      ctx.beginPath();
      ctx.moveTo(lipL.x, lipL.y);
      ctx.lineTo(lipR.x, lipR.y);
      ctx.stroke();
    },
  );

  const traceUpper = (): void => traceUpperSleeve(ctx, upper, cap, elbow);
  shadeForm(
    ctx,
    traceUpper,
    { from: chain.root, to: chain.joint },
    leather,
    // No specular streak along the sleeve: on a cylinder it runs the whole
    // length as one hard stripe and the sleeve reads as a polished tube. The
    // gloss lives in the cap glint, where the leather is stretched tightest.
    {
      halfWidth: cap,
    },
    () => {
      const litSide = litSideOf(upper.angle);
      const glintAt = upper.at(upper.length * CAP_GLINT_ALONG, litSide * cap * CAP_GLINT_ACROSS);
      fillSoftEllipse(
        ctx,
        glintAt.x,
        glintAt.y,
        cap * CAP_GLINT_LENGTH,
        cap * CAP_GLINT_WIDTH,
        leather.specular,
        CAP_GLINT_ALPHA,
        upper.angle,
        CAP_GLINT_CORE,
      );

      for (const wrinkle of SLEEVE_WRINKLES) {
        const from = upper.at(upper.length * wrinkle.at, -cap * FOLD_OVERREACH);
        const to = upper.at(upper.length * (wrinkle.at + wrinkle.slant), cap * wrinkle.reach);
        crease(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
          },
          FOLD_WIDTH,
          leather,
          WRINKLE_OPACITY,
        );
      }

      const bend = bendOf(chain);
      if (Math.abs(bend) > CROOK_MIN_BEND) {
        const inside = Math.sign(bend);
        const from = upper.at(upper.length - elbow * CROOK_RISE, inside * elbow * (1 - CROOK_SPAN));
        const to = upper.at(
          upper.length - elbow * CROOK_RISE * CROOK_FALL,
          inside * elbow * FOLD_OVERREACH,
        );
        crease(
          ctx,
          () => {
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
          },
          FOLD_WIDTH,
          leather,
          FOLD_OPACITY,
        );
      }
    },
  );
}

/** +1 when the key light falls on the +across side of a bone at `angle`, else −1. */
function litSideOf(angle: number): number {
  const acrossX = -Math.sin(angle);
  const acrossY = Math.cos(angle);
  return acrossX * LIGHT.x + acrossY * LIGHT.y >= 0 ? 1 : -1;
}

/** Signed elbow bend: positive when the forearm turns toward the upper arm's +across side. */
function bendOf(chain: BoneChain): number {
  const upperAngle = angleBetween(chain.root, chain.joint);
  const foreAngle = angleBetween(chain.joint, chain.end);
  let bend = foreAngle - upperAngle;
  while (bend > Math.PI) bend -= TWO_PI;
  while (bend < -Math.PI) bend += TWO_PI;
  return bend;
}
