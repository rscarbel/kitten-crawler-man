/**
 * A tube of cloth, leather or iron round the human's forearm, for the
 * garments worn there: a wrap, a glove's cuff, a gauntlet's bell, a bracer.
 *
 * The cuff is painted in the forearm's own frame (origin at the elbow, +X
 * toward the wrist, +Y the bone's left-hand normal), sized off the bare
 * forearm's own silhouette at each end so it hugs the arm in every view and
 * build, and shaded across the bone with the figure's own form shading.
 */

import type { BipedForearmFrame } from '../../art/biped/bipedParts';
import { angleBetween, pt, rotate, TWO_PI } from '../../art/biped/geometry';
import { bareSegmentEdges, handLength, wristAngle } from '../../art/biped/limbs';
import { shadeForm } from '../../art/biped/paint';
import { FAR_LIMB_SHADE, LIGHT, receded, type Ramp } from '../../art/biped/palette';
import { fillSoftEllipse } from '../../art/softShade';
import type { BodySide } from '../../art/biped/rig';
import type { Pt } from '../../art/bipedArt';
import { mix } from '../../art/bipedArt';

type Ctx = CanvasRenderingContext2D;

/** Edge-on his left arm is the one behind the torso, painted in the body's shade. */
export const PROFILE_FAR_ARM: BodySide = 'left';

/** A quadratic only reaches halfway to its control point. */
const QUAD_CONTROL_REACH = 2;

export interface CuffShape {
  /** Where the cuff starts and ends along the forearm, 0 at the elbow and 1 at the wrist. */
  readonly from: number;
  readonly to: number;
  /** How far it stands proud of the bare forearm at its elbow end and at its wrist end. */
  readonly proudFrom: number;
  readonly proudTo: number;
  /**
   * How far each end bows toward the wrist, as a share of the cuff's half
   * width: each end is the rim of a tube seen a little from above, and a
   * straight cut end reads as a box stuck on the arm.
   */
  readonly endBow: number;
}

/** The cuff's own frame, handed to whatever is painted on it: the forearm's frame, in figure units. */
export interface CuffFrame {
  /** Its two ends along the forearm, in figure units from the elbow. */
  readonly fromX: number;
  readonly toX: number;
  /** Half its width either side of the bone at each end. */
  readonly fromHalf: number;
  readonly toHalf: number;
  /** The forearm's angle in figure space, for shading laid in the cuff's frame. */
  readonly angle: number;
  readonly ramp: Ramp;
  /**
   * The lit ridge of the arm's form under the cuff. A far arm's sinks only
   * half as far into the shade as the cuff does: sunk all the way, the ridge
   * is too close to the shadow beside it for the arm to read as round.
   */
  readonly formLight: string;
  /** The whole forearm's length, elbow to wrist, in figure units. */
  readonly forearmLength: number;
  /** How far the arm sits back in the body's shade: 0 near, {@link FAR_LIMB_SHADE} behind. */
  readonly depthShade: number;
}

/** The half width of the cuff at `x` along the forearm, between its two ends. */
export function cuffHalfAt(cuff: CuffFrame, x: number): number {
  const span = cuff.toX - cuff.fromX;
  if (span === 0) return cuff.fromHalf;
  const t = Math.min(Math.max((x - cuff.fromX) / span, 0), 1);
  return cuff.fromHalf + (cuff.toHalf - cuff.fromHalf) * t;
}

/** How far the arm `frame` dresses sits back in the body's shade. */
export function armDepthShade(frame: BipedForearmFrame): number {
  if (frame.piece !== 'arm') return 0;
  return frame.view.profile && frame.drawn === PROFILE_FAR_ARM ? FAR_LIMB_SHADE : 0;
}

/** A bright colour sunk into the shade a far arm stands in. */
export function inArmShade(colour: string, cuff: CuffFrame): string {
  return mix(colour, cuff.ramp.shadow, cuff.depthShade);
}

function traceCuff(ctx: Ctx, cuff: CuffFrame, bow: number): void {
  const fromBow = cuff.fromHalf * bow * QUAD_CONTROL_REACH;
  const toBow = cuff.toHalf * bow * QUAD_CONTROL_REACH;
  ctx.beginPath();
  ctx.moveTo(cuff.fromX, -cuff.fromHalf);
  ctx.lineTo(cuff.toX, -cuff.toHalf);
  ctx.quadraticCurveTo(cuff.toX + toBow, 0, cuff.toX, cuff.toHalf);
  ctx.lineTo(cuff.fromX, cuff.fromHalf);
  ctx.quadraticCurveTo(cuff.fromX + fromBow, 0, cuff.fromX, -cuff.fromHalf);
  ctx.closePath();
}

/**
 * Paints a cuff of `ramp` round the forearm `frame` dresses, then `inside`
 * clipped to it in the forearm's frame, then `over` unclipped in the same
 * frame (studs and rivets standing proud of the cuff's edge).
 */
export function paintForearmCuff(
  ctx: Ctx,
  frame: Extract<BipedForearmFrame, { piece: 'arm' }>,
  shape: CuffShape,
  ramp: Ramp,
  inside?: (cuff: CuffFrame) => void,
  over?: (cuff: CuffFrame) => void,
): void {
  const { chain, view } = frame;
  const depthShade = armDepthShade(frame);
  const angle = angleBetween(chain.joint, chain.end);
  const length = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const nearEdges = bareSegmentEdges('forearm', shape.from, view.profile, frame.look.limbs);
  const farEdges = bareSegmentEdges('forearm', shape.to, view.profile, frame.look.limbs);
  const cuff: CuffFrame = {
    fromX: length * shape.from,
    toX: length * shape.to,
    fromHalf: Math.max(nearEdges.plus, nearEdges.minus) + shape.proudFrom,
    toHalf: Math.max(farEdges.plus, farEdges.minus) + shape.proudTo,
    angle,
    ramp: receded(ramp, depthShade),
    formLight: mix(ramp.rim, ramp.shadow, depthShade * HALF),
    forearmLength: length,
    depthShade,
  };
  ctx.save();
  ctx.translate(chain.joint.x, chain.joint.y);
  ctx.rotate(angle);
  shadeForm(
    ctx,
    () => traceCuff(ctx, cuff, shape.endBow),
    { from: pt(cuff.fromX, 0), to: pt(cuff.toX, 0) },
    cuff.ramp,
    { halfWidth: Math.max(cuff.fromHalf, cuff.toHalf), frameRotation: angle },
    inside === undefined ? undefined : () => inside(cuff),
  );
  over?.(cuff);
  ctx.restore();
}

/**
 * The round form of the arm under a cuff: a lit ridge down the side turned to
 * the key and a shadowed one down the other. The cuff's own shading across
 * the bone is a ramp step or two at the tile; without these a cuff on a far
 * arm, sunk in the body's shade, is one flat bar where the forearm was.
 */
export function paintCuffForm(ctx: Ctx, cuff: CuffFrame): void {
  const light = rotate(LIGHT, -cuff.angle);
  const litSide = light.y <= 0 ? -1 : 1;
  // The ridges sit at fixed places along the forearm, not along the cuff, so
  // two cuffs stacked on one arm put the arm's form in the same place and the
  // outer one never hides the inner one's only ridge.
  for (const share of FORM_STATIONS) {
    const x = cuff.forearmLength * share;
    if (x < cuff.fromX || x > cuff.toX) continue;
    const half = cuffHalfAt(cuff, x);
    for (const [side, colour] of [
      [litSide, cuff.formLight],
      [-litSide, cuff.ramp.deep],
    ] as const) {
      fillSoftEllipse(
        ctx,
        x,
        side * half * FORM_RIDGE_ACROSS,
        cuff.forearmLength * FORM_STATION_REACH,
        half * FORM_RIDGE_WIDTH,
        colour,
        FORM_RIDGE_ALPHA,
      );
    }
  }
}
/** Where along the forearm the ridges sit, 0 at the elbow, and how far each reaches either way. */
const FORM_STATIONS = [0.45, 0.62, 0.79, 0.96] as const;
const FORM_STATION_REACH = 0.13;
/** How far off the bone each ridge runs, how wide it is, and how strong. */
const FORM_RIDGE_ACROSS = 0.5;
const FORM_RIDGE_WIDTH = 0.28;
const FORM_RIDGE_ALPHA = 1;
const HALF = 0.5;

/** A rivet head on a cuff: a lit dome over the dimple it is set in, which falls away from the key. */
export function paintCuffRivet(
  ctx: Ctx,
  cuff: CuffFrame,
  at: Pt,
  radius: number,
  lit: string,
): void {
  const shadeOffset = radius * RIVET_SHADE_SHARE;
  const fallX = Math.cos(-cuff.angle) * shadeOffset - Math.sin(-cuff.angle) * shadeOffset;
  const fallY = Math.sin(-cuff.angle) * shadeOffset + Math.cos(-cuff.angle) * shadeOffset;
  ctx.fillStyle = cuff.ramp.deep;
  ctx.beginPath();
  ctx.arc(at.x + fallX, at.y + fallY, radius * RIVET_DIMPLE_SHARE, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = inArmShade(lit, cuff);
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
}
const RIVET_SHADE_SHARE = 0.6;
const RIVET_DIMPLE_SHARE = 1.2;

/** Where the hand on the forearm `frame` dresses reaches to, along the wrist's own line. */
export interface HandReach {
  readonly wrist: Pt;
  readonly angle: number;
  readonly length: number;
  /** Whether it is closed on a handle: then its fingers are bands round the handle, not a block. */
  readonly gripping: boolean;
}

/** The hand at the end of the arm `frame` dresses, in figure space. */
export function handReachOf(frame: Extract<BipedForearmFrame, { piece: 'arm' }>): HandReach {
  return handReachOn(frame, frame.drawn);
}

/** The hand at the end of the `drawn` arm of the figure `frame` dresses, in figure space. */
export function handReachOn(frame: BipedForearmFrame, drawn: BodySide): HandReach {
  const left = drawn === 'left';
  const chain = left ? frame.skeleton.leftArm : frame.skeleton.rightArm;
  const fist = left ? frame.pose.leftFist : frame.pose.rightFist;
  const shape = (left ? frame.pose.leftHandShape : frame.pose.rightHandShape) ?? 'relaxed';
  return {
    wrist: chain.end,
    angle: wristAngle(chain),
    length: handLength(fist, shape, frame.look.limbs),
    gripping: shape === 'grip',
  };
}

/** A point `along` the hand's length past the wrist and `across` it, in figure space. */
export function onHand(hand: HandReach, along: number, across = 0): Pt {
  const cos = Math.cos(hand.angle);
  const sin = Math.sin(hand.angle);
  const x = hand.length * along;
  return { x: hand.wrist.x + cos * x - sin * across, y: hand.wrist.y + sin * x + cos * across };
}
