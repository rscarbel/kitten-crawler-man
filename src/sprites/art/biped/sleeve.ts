/**
 * The leather sleeve over the figure's upper arm, shoved up past the elbow so the
 * forearm below it is bare.
 *
 * The sleeve belongs to the jacket, not to the arm: its top is the jacket's
 * shoulder, and the deltoid under it is what pushes the leather out into the
 * cap that makes his shoulders the widest point of the figure.
 */

import { angleBetween, HALF_PI, mixPt, pt, TWO_PI } from './geometry';
import { castShadow, crease, shadeForm } from './paint';
import { type GlossRamp, LIGHT, type Ramp, recededGloss } from './palette';
import { SLEEVE_BULK } from './proportions';
import { type BoneChain } from './rig';
import { mix, type Pt } from '../bipedArt';
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
  /** What the sleeve is made of: the torso garment's own material. */
  readonly material: GlossRamp;
  readonly cut: SleeveCut;
  /**
   * Which side of the upper arm's bone is the outside of the arm, as a sign on
   * its across axis, or null edge-on, where the deltoid's front and back heads
   * round both sides alike.
   */
  readonly outer: number | null;
}

/**
 * How a sleeve is cut: how far down the forearm it reaches and how far its
 * cuff stands off the arm, how padded it stands, how its cap swells and
 * slopes over the shoulder, and how hard its cloth is shaded.
 */
export interface SleeveCut {
  /**
   * How far down the forearm the sleeve reaches, as a share of the forearm.
   * The roll always shows a band below the upper sleeve's rounded elbow, so a
   * cut shorter than that reaches there instead.
   */
  readonly cuffAlongForearm: number;
  /** How far the cuff stands off the arm it sits on, in sleeve bulks. */
  readonly cuffBulk: number;
  /**
   * How far the sleeve stands off the arm, as a share of the jacket's padded
   * leather: cotton lies close to the arm.
   */
  readonly padding: number;
  /**
   * How far the cap over the shoulder swells past the arm, as a share of the
   * jacket's: the deltoid under any sleeve caps the arm and carries the
   * shoulder's line from the trapezius out into it.
   */
  readonly capSwell: number;
  /**
   * How far the cap falls from the neck side of the arm to the outside, as a
   * share of its half-width: {@link LEVEL_CAP} keeps the rig's cap, level
   * across the joint. A man whose shoulders slope has no shelf at the top of
   * his arm — the trapezius runs on down over the deltoid, which rounds
   * over at the outside and only reaches its full width a little below the
   * joint.
   */
  readonly capSlope: number;
  /**
   * How far the sleeve's light and shade reach from its cloth's base, against
   * padded leather's crisp cylinder ({@link LEATHER_SLEEVE_CONTRAST}): a
   * cotton sleeve lies soft on the arm, and shaded as hard as leather its
   * shadow side is a dark stripe down the inside of the arm that parts it
   * from the shirt as a tube.
   */
  readonly shadeContrast: number;
}

/**
 * The sleeves a garment worn over the torso brings with it: a hoodie or a coat
 * has sleeves of its own over whatever shirt is under it. `cut` replaces the
 * look's own sleeve cut where it says otherwise.
 */
export interface SleeveCloth {
  readonly cloth: GlossRamp;
  readonly cut?: Partial<SleeveCut>;
}

/** Padded leather's own sleeve shading, its whole ramp. */
export const LEATHER_SLEEVE_CONTRAST = 1;

/** The rig's cap, level across the shoulder joint. */
export const LEVEL_CAP = 0;

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
  if (arm.shade === 0) return arm.material;
  return recededGloss(arm.material, arm.shade + SLEEVE_SHADE);
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

/** A sleeve padded as the jacket's leather is: the rig's own sleeve. */
export const PADDED_SLEEVE = 1;

/**
 * Dave's jacket sleeve, shoved up only just past the elbow: the forearm is
 * where arm muscle reads at game size, and it is bare. The shoved-up leather
 * gathers into a roll wider than the arm it sits on; that bunched ring is the
 * whole visual difference between a sleeve pushed up and a short sleeve.
 */
export const DAVE_SHOVED_UP_SLEEVE: SleeveCut = {
  cuffAlongForearm: 0.07,
  cuffBulk: 2.4,
  padding: PADDED_SLEEVE,
  capSwell: PADDED_SLEEVE,
  capSlope: LEVEL_CAP,
  shadeContrast: LEATHER_SLEEVE_CONTRAST,
};
/** A thin rolled band: a few turns of cotton add little to the arm. */
const ROLLED_CUFF_BULK = 1.2;
/** A lean man's deltoid, a little less than the rig's heavy cap. */
const ROLLED_CAP_SWELL = 0.2;
/** Cotton chambray: its shade lies light round the arm. */
export const COTTON_SLEEVE_CONTRAST = 0.6;
/** His shoulders slope: the cap carries the trapezius's fall on out over the arm. */
const ROLLED_CAP_SLOPE = 1;
/** The roll lies just below the elbow, a twelfth of the way down the forearm. */
const ROLL_ALONG_FOREARM = 0.08;
/**
 * A shirt sleeve, rolled in flat turns to just below the elbow: the roll
 * sits further down the forearm than a sleeve shoved up, and lies flatter
 * against it, because cotton folds into a band where leather bunches.
 */
export const ROLLED_SLEEVE: SleeveCut = {
  cuffAlongForearm: ROLL_ALONG_FOREARM,
  cuffBulk: ROLLED_CUFF_BULK,
  padding: 0,
  capSwell: ROLLED_CAP_SWELL,
  capSlope: ROLLED_CAP_SLOPE,
  shadeContrast: COTTON_SLEEVE_CONTRAST,
};
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
function traceUpperSleeve(
  ctx: Ctx,
  frame: ArmFrame,
  cap: number,
  elbow: number,
  slope: number,
  outer: number | null,
): void {
  const { at, length, angle } = frame;
  const insertion = cap * INSERTION_PINCH;
  const belly = Math.max(elbow, cap * ARM_BELLY_SWELL);
  const root = at(0, 0);
  const end = at(length, 0);
  ctx.beginPath();
  if (outer === null || slope === LEVEL_CAP) {
    // The cap is flatter than a half-circle: the deltoid bulges out to the side
    // far more than it rises over the joint, and a round cap puts the top of
    // the sleeve level with the collar, squaring off the trapezius's slope.
    ctx.ellipse(root.x, root.y, cap * CAP_RISE, cap, angle, HALF_PI, HALF_PI * 3);
  } else traceSlopedCap(ctx, frame, cap, slope, outer);
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

/** How far the cap rises over the shoulder joint, as a share of its half-width. */
const CAP_RISE = 0.42;
/**
 * How a sloped cap is shaped, in shares of its half-width along the bone from
 * the joint (negative toward the shoulder): its neck side rises as high as the
 * rig's level cap, and its outside meets the arm's edge this far below the
 * joint, rounding over through a control that stands this far above it.
 */
const SLOPED_CAP_INNER_RISE = CAP_RISE * 3;
const SLOPED_CAP_OUTER_DROP = 0.9;
const SLOPED_CAP_OUTER_CONTROL = 0.15;
/** How far across toward the outside the neck side's control reaches, so the top crowns rather than peaks. */
const SLOPED_CAP_CROWN = 0.5;

/**
 * The cap of a sloped shoulder, from the bone's `+across` side over the top
 * to its `−across` side, as {@link traceUpperSleeve} continues from it: high
 * on the neck side, where the trapezius runs into it, and rounding down over
 * the deltoid on the outside, `slope` scaling how far it falls.
 */
function traceSlopedCap(
  ctx: Ctx,
  frame: ArmFrame,
  cap: number,
  slope: number,
  outer: number,
): void {
  const { at } = frame;
  const innerTop = at(-cap * SLOPED_CAP_INNER_RISE, -outer * cap * (1 - SLOPED_CAP_CROWN));
  const outerControl = at(-cap * SLOPED_CAP_OUTER_CONTROL * slope, outer * cap);
  const outerSide = at(cap * SLOPED_CAP_OUTER_DROP * slope, outer * cap);
  const innerSide = at(0, -outer * cap);
  const [from, fromControl, toControl, to] =
    outer > 0
      ? [outerSide, outerControl, innerTop, innerSide]
      : [innerSide, innerTop, outerControl, outerSide];
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(fromControl.x, fromControl.y, toControl.x, toControl.y, to.x, to.y);
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
/** A quadratic's control sits past the curve it bends; this puts the belly's peak on `ARM_BELLY_SWELL`. */
const BELLY_CONTROL_REACH = 1.12;
/** The roll bows a little past its cuff between the elbow and the cuff. */
const BUNCH_BULGE = 1.06;
/** How far the cuff's rolled edge rounds past the cuff line, as a share of its half-width. */
const CUFF_ROUND = 0.35;
/**
 * The least of the roll that shows below the upper sleeve's rounded elbow, as
 * a share of the cuff's half-width: enough for one band of leather at the tile.
 */
const ROLL_MIN_SHOWN = 0.2;

/** How far the sleeve's deltoid cap stands either side of an arm `upperHalf` across. */
export function sleeveCapHalf(upperHalf: number, cut: SleeveCut): number {
  return upperHalf + SLEEVE_BULK * cut.padding + DELTOID_SWELL * cut.capSwell;
}

/**
 * Paints the sleeve over an arm `limbs.ts` has already drawn bare: the cuff's
 * shadow on the forearm, then the gathered roll at the elbow, then the upper
 * sleeve and its deltoid cap over the top of it all.
 */
export function drawSleeve(ctx: Ctx, arm: SleevedArm): void {
  const { chain } = arm;
  const leather = softenedTowardBase(sleeveLeather(arm), arm.cut.shadeContrast);
  const padding = arm.cut.padding;
  const cap = sleeveCapHalf(arm.upperHalf, arm.cut);
  const elbow = arm.elbowHalf + SLEEVE_BULK * padding;
  const cuffHalf = arm.forearmHalf + SLEEVE_BULK * arm.cut.cuffBulk;
  const forearmLength = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const cutReach = forearmLength * arm.cut.cuffAlongForearm;
  // The upper sleeve rounds off `elbow` past the joint and is laid over the
  // roll, so a cuff cut shorter than that is buried under it: only the roll's
  // flared sides would show, as thin slivers sticking out past the arm.
  const leastShownReach = elbow + cuffHalf * ROLL_MIN_SHOWN;
  const cuffReach = Math.max(cutReach, leastShownReach);
  const cuffAt = mixPt(chain.joint, chain.end, forearmLength > 0 ? cuffReach / forearmLength : 0);

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

  const traceUpper = (): void =>
    traceUpperSleeve(ctx, upper, cap, elbow, arm.cut.capSlope, arm.outer);
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

/**
 * A ramp whose every step is drawn `contrast` of the way from the base to its
 * own value. The sleeve's light and shade are softened in its colours, not by
 * laying the shading on part-transparent: a translucent gradient's last-level
 * rounding falls differently with where the composing surface starts, so the
 * same cell would bake differently on two surfaces.
 */
function softenedTowardBase(ramp: GlossRamp, contrast: number): GlossRamp {
  if (contrast >= 1) return ramp;
  const step = (colour: string): string => mix(ramp.base, colour, contrast);
  return {
    deep: step(ramp.deep),
    shadow: step(ramp.shadow),
    dark: step(ramp.dark),
    mid: step(ramp.mid),
    base: ramp.base,
    light: step(ramp.light),
    rim: step(ramp.rim),
    specular: step(ramp.specular),
  };
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
