/**
 * The skirt of a long coat on the human crawler: the part of a duster or a
 * tailcoat that hangs below his jacket's hem, painted through his `back`
 * part. Facing the camera and edge-on it hangs behind his legs; from behind it
 * lies over them. It leaves the body at the waist and hangs from there under
 * its own weight, so a lean tips where it is attached but not which way it
 * falls; edge-on it follows his thighs as well, so a stride or a fall carries
 * it with the legs instead of leaving it hanging in the air.
 */

import type { BipedBackFrame } from '../../art/biped/bipedParts';
import { mixPt, pt } from '../../art/biped/geometry';
import { shadeForm } from '../../art/biped/paint';
import type { Ramp } from '../../art/biped/palette';
import type { BoneChain } from '../../art/biped/rig';
import { torsoFrame } from '../../art/biped/torso';
import { clamp01, type Pt } from '../../art/bipedArt';

type Ctx = CanvasRenderingContext2D;

/** How a coat's skirt is cut, in rig units. */
export interface SkirtCut {
  /** How far the hem hangs below the waist. */
  readonly length: number;
  /** Half its width where it leaves the waist, head-on. */
  readonly waistHalf: number;
  /** Half its width at the hem, head-on: past the waist for a skirt that flares. */
  readonly hemHalf: number;
  /** Edge-on, how far behind the small of his back the hem's trailing edge stands. */
  readonly profileBehind: number;
  /**
   * Edge-on, where the skirt's front edge leaves the waist, as a share of the
   * way from his side seam to the front of his belly: a duster's fronts start
   * at the belly, a tailcoat's tails behind the hip.
   */
  readonly profileFrontShare: number;
  /** Edge-on, how far ahead of where its front edge leaves the waist the hem's front corner hangs. */
  readonly profileAhead: number;
  /**
   * How far up the skirt the split up its back reaches, as a share of its
   * length, and how wide the split opens at the hem, as a share of the hem's
   * half-width: a duster's riding vent is a closed slit, a tailcoat parts
   * into two tails.
   */
  readonly splitRise: number;
  readonly splitOpen: number;
}

/** A skirt's silhouette and the points across it, in figure space. */
export interface SkirtShape {
  /** Begins its own path and traces the closed silhouette. */
  readonly trace: (ctx: Ctx) => void;
  /**
   * A point on the skirt: `u` across it from −1 to 1 (head-on his left to his
   * right as drawn; edge-on, back to front), `v` down it from the waist (0)
   * to the hem (1).
   */
  readonly at: (u: number, v: number) => Pt;
  /** Edge-on the skirt is seen from its side, head-on from its front or back. */
  readonly profile: boolean;
  /** Where the centre-back split begins and ends, head-on; null edge-on. */
  readonly split: { readonly top: Pt; readonly hem: Pt } | null;
}

/** Where the skirt leaves the body, a little above the waist so no gap shows under his jacket's hem. */
const WAIST_OVERLAP = 0.05;
/** The hem never passes through the floor; lower than that and it lies spread on the floor. */
const HEM_FLOOR_CLEARANCE = 0.03;
/** What lies on the floor spreads the hem out across it rather than piling up. */
const POOL_SPREAD = 0.8;
/** A long skirt is a looser pendulum than his jacket's short hem, so the same lag swings it wider. */
const SKIRT_LAG_GAIN = 2.5;
/** Lag grows down the skirt by this power of the share of its length. */
const LAG_FALLOFF = 1.6;
/** The sides belly outward a little between waist and hem, as leather does under its own weight. */
const SIDE_BELLY = 0.03;
/** The hem dips at its middle by this much, a coat hanging round a body rather than a board. */
const HEM_DIP = 0.03;
/** A quadratic reaches only halfway to its control point. */
const QUAD_CONTROL_REACH = 2;
const HALF = 0.5;

/** Edge-on, the back and front of his waist in the torso's own frame, before his build's depth. */
const PROFILE_WAIST_BACK = -0.19;
const PROFILE_WAIST_FRONT = 0.2;
/**
 * Edge-on, how far the skirt follows his thighs rather than hanging plumb:
 * a stride swings it with the forward leg and a fall lays it along the legs.
 */
const THIGH_FOLLOW = 0.35;
/**
 * Edge-on, the furthest the hem reaches sideways from where it leaves the
 * waist: lying down, a coat bunches under him rather than spreading out past
 * his knees, and its back part may reach no further than that.
 */
const PROFILE_MAX_REACH = 0.45;

function thighDirection(chain: BoneChain): Pt {
  const dx = chain.joint.x - chain.root.x;
  const dy = chain.joint.y - chain.root.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? pt(dx / length, dy / length) : pt(0, 1);
}

/** The way the skirt falls from his waist edge-on: plumb, pulled toward his thighs. */
function profileFall(frame: BipedBackFrame): Pt {
  const left = thighDirection(frame.skeleton.leftLeg);
  const right = thighDirection(frame.skeleton.rightLeg);
  const x = (left.x + right.x) * HALF * THIGH_FOLLOW;
  const y = (left.y + right.y) * HALF * THIGH_FOLLOW + (1 - THIGH_FOLLOW);
  const length = Math.hypot(x, y);
  return pt(x / length, y / length);
}

/** `p` held off the floor; returns how far it had to be raised. */
function offFloor(p: Pt): { readonly p: Pt; readonly raised: number } {
  const floorY = -HEM_FLOOR_CLEARANCE;
  if (p.y <= floorY) return { p, raised: 0 };
  return { p: pt(p.x, floorY), raised: p.y - floorY };
}

/** The skirt `cut` makes on the body `frame` describes. */
export function coatSkirt(frame: BipedBackFrame, cut: SkirtCut): SkirtShape {
  const { skeleton, pose, view, look } = frame;
  const torso = torsoFrame(skeleton, pose, look);
  const topY = torso.waistY - WAIST_OVERLAP;
  const rawLag = pose.jacketHemLag ?? pt(0, 0);
  const lag = pt(rawLag.x * SKIRT_LAG_GAIN, rawLag.y * SKIRT_LAG_GAIN);
  const lagAt = (p: Pt, v: number): Pt => {
    const weight = clamp01(v) ** LAG_FALLOFF;
    return pt(p.x + lag.x * weight, p.y + lag.y * weight);
  };

  let topLeft: Pt;
  let topRight: Pt;
  let hemLeft: Pt;
  let hemRight: Pt;
  if (view.profile) {
    const depth = look.garmentCut.profileDepth;
    const back = torso.at(PROFILE_WAIST_BACK * depth, topY);
    const front = torso.at(PROFILE_WAIST_FRONT * depth * cut.profileFrontShare, topY);
    const side = torso.at(0, topY);
    const aheadSign = Math.sign(torso.at(1, topY).x - side.x) || 1;
    const fall = profileFall(frame);
    const hang = (from: Pt, ahead: number): Pt =>
      pt(from.x + fall.x * cut.length + aheadSign * ahead, from.y + fall.y * cut.length);
    const backHem = offFloor(hang(back, -cut.profileBehind));
    const frontHem = offFloor(hang(front, cut.profileAhead));
    const pooled = Math.max(backHem.raised, frontHem.raised) * POOL_SPREAD;
    topLeft = back;
    topRight = front;
    const reachFrom = (from: Pt, x: number): number =>
      from.x + Math.max(-PROFILE_MAX_REACH, Math.min(PROFILE_MAX_REACH, x - from.x));
    hemLeft = pt(reachFrom(back, backHem.p.x - aheadSign * pooled), backHem.p.y);
    hemRight = pt(reachFrom(front, frontHem.p.x + aheadSign * pooled), frontHem.p.y);
  } else {
    const waistHalf = cut.waistHalf * view.girth;
    topLeft = torso.at(-waistHalf, topY);
    topRight = torso.at(waistHalf, topY);
    const top = mixPt(topLeft, topRight, HALF);
    const hemCentre = offFloor(pt(top.x, top.y + cut.length));
    const hemHalf = cut.hemHalf * view.girth + hemCentre.raised * POOL_SPREAD;
    hemLeft = pt(hemCentre.p.x - hemHalf, hemCentre.p.y);
    hemRight = pt(hemCentre.p.x + hemHalf, hemCentre.p.y);
  }
  hemLeft = lagAt(hemLeft, 1);
  hemRight = lagAt(hemRight, 1);

  const at = (u: number, v: number): Pt => {
    const across = (u + 1) * HALF;
    const top = mixPt(topLeft, topRight, across);
    const hem = mixPt(hemLeft, hemRight, across);
    return mixPt(top, hem, v);
  };
  const bellyLeft = at(-1, HALF);
  const bellyRight = at(1, HALF);
  const sideBelly = view.profile ? 0 : SIDE_BELLY;
  const hemMid = at(0, 1);
  const split =
    view.profile || cut.splitRise <= 0 ? null : { top: at(0, 1 - cut.splitRise), hem: hemMid };
  const open = cut.splitOpen * HALF;

  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.moveTo(topLeft.x, topLeft.y);
    ctx.lineTo(topRight.x, topRight.y);
    ctx.quadraticCurveTo(bellyRight.x + sideBelly, bellyRight.y, hemRight.x, hemRight.y);
    if (split !== null && open > 0) {
      const right = at(open, 1);
      const left = at(-open, 1);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(split.top.x, split.top.y);
      ctx.lineTo(left.x, left.y);
    } else {
      const dip = view.profile ? 0 : HEM_DIP * QUAD_CONTROL_REACH;
      ctx.quadraticCurveTo(hemMid.x, hemMid.y + dip, hemLeft.x, hemLeft.y);
    }
    ctx.lineTo(hemLeft.x, hemLeft.y);
    ctx.quadraticCurveTo(bellyLeft.x - sideBelly, bellyLeft.y, topLeft.x, topLeft.y);
    ctx.closePath();
  };
  return { trace, at, profile: view.profile, split };
}

/** How soft the skirt's shading turns across it. */
const SKIRT_SOFTNESS = 1.4;

/** Fills and form-shades the skirt in `ramp`, then paints `inside` clipped to it. */
export function paintSkirt(ctx: Ctx, skirt: SkirtShape, ramp: Ramp, inside: () => void): void {
  const left = skirt.at(-1, 0);
  const right = skirt.at(1, 0);
  shadeForm(
    ctx,
    () => skirt.trace(ctx),
    { from: skirt.at(0, 0), to: skirt.at(0, 1) },
    ramp,
    { halfWidth: Math.hypot(right.x - left.x, right.y - left.y) * HALF, softness: SKIRT_SOFTNESS },
    inside,
  );
}

/**
 * Whether the back part's `piece` is where the skirt belongs in his draw
 * order: from behind it lies over him; otherwise it hangs behind him.
 */
export function skirtPieceIs(frame: BipedBackFrame): boolean {
  const overHim = frame.view.showsBack && !frame.view.profile;
  return (frame.piece === 'over') === overHim;
}
