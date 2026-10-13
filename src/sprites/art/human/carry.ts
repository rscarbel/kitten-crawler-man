/**
 * How Carl carries an equipment-chosen item in his main hand on rows that
 * were not authored for it: his right fist closed round its handle, the item
 * carried point-forward and low, and on a blow he throws with that fist,
 * run on down the line of the fist, so a punch reads as a thrust or a cut.
 *
 * A row whose own business occupies him — a prop in either hand, a tool in
 * both, a sling's pouch pinched, the Protective Shell's glow gathered in that
 * palm — keeps its hands, and the item is not drawn on it.
 */

import { deg } from '../carlArt';
import { handGrip, wristAngle } from '../carl/limbs';
import { HEAD_RX } from '../carl/proportions';
import type { Pt } from '../carlArt';
import {
  type BoneChain,
  buildSkeleton,
  type CarlPose,
  drawnSide,
  HAFT_IN_PLANE,
  HEAD_ON_FLOOR_FORESHORTENING,
  poseAsDrawn,
  VIEWS,
} from '../carl/rig';
import type { CardinalView } from '../../facingView';
import type { RowSpec } from '../humanFigure';
import { towards } from './handTurn';
import type { HandleRadius } from '../../held/gripArchetypes';
import type { WeaponHeldVisualDef } from '../../held/heldVisualDef';
import { type MotionSet, motionSetOf } from './motionSets';

/**
 * How an item is carried on rows not authored for it: a one-hander point
 * forward and low; anything long enough to need two hands with its head up,
 * the haft standing back past his shoulder, clear of the floor.
 */
export type CarryStyle = 'low' | 'shouldered';

/**
 * The way the item points while carried, as authored (his right toward +X),
 * per view and style. Low: forward and low, clear of his leg — upright it
 * would stand against the jacket and vanish at the tile; head-on it leans out
 * past his right hip. Shouldered: up and back past his shoulder in profile,
 * up and out beside his head head-on. Head-on either is reflected for a fist
 * crossed to his left.
 */
const CARRY_HAFT_ANGLE: Readonly<Record<CarryStyle, Readonly<Record<CardinalView, number>>>> = {
  low: { side: deg(38), front: deg(50), back: deg(50) },
  shouldered: { side: deg(-118), front: deg(-72), back: deg(-72) },
};
/**
 * A fist raised past his shoulder — the guard, the wind-up of a blow — holds
 * its item out to the side, nearly level, so the blade lies off his face
 * rather than down across it.
 */
const RAISED_HAFT_ANGLE: Readonly<Record<CardinalView, number>> = {
  side: deg(10),
  front: deg(12),
  back: deg(12),
};

/**
 * The carrying fist's knuckles are out, turned a little in toward the thigh:
 * the flat of a blade shows, and the fingers close over the handle's near
 * side.
 */
const CARRY_PALM = towards(-0.3, 0, -0.95);
/** A fist driving a blow turns its palm down, the flat of the blade still to the camera. */
const STRIKING_PALM = towards(0, 0.5, -0.85);

function busy(pose: CarlPose): boolean {
  if (pose.rightHandShape === 'grip' || pose.leftHandShape === 'grip') return true;
  if ((pose.heldProps?.length ?? 0) > 0) return true;
  return pose.palmGlow?.hand === 'right';
}

/**
 * Whether a row throws its blow with his right fist, driven out: the item
 * runs on down the line of the fist. A fist brought down — a hammer-fist —
 * lands with its heel, and the item is carried as it is between blows.
 */
function thrustsWithRightFist(row: RowSpec): boolean {
  const strike = row.strike;
  if (row.role !== 'strike' || strike === undefined) return false;
  return strike.reachLimb === 'hand' && strike.drive !== 'down';
}

/** His right arm and head on the drawn cell. */
function drawnRightArm(pose: CarlPose, view: CardinalView): { arm: BoneChain; head: Pt } {
  const spec = VIEWS[view];
  const skeleton = buildSkeleton(poseAsDrawn(pose, spec), spec);
  const arm = drawnSide('right', spec) === 'right' ? skeleton.rightArm : skeleton.leftArm;
  return { arm, head: skeleton.headCentre };
}

/** A drawn screen angle carried back into the authored pose, or the other way: a reflection is its own inverse. */
function reflectedFor(angle: number, view: CardinalView): number {
  return VIEWS[view].mirrored ? Math.PI - angle : angle;
}

/**
 * How far a carried item is assumed to reach past the fist and behind it,
 * rig units, per style: the longest one-hander's blade, a two-hander's haft
 * and head. The dresser does not know which item it carries, only how.
 */
const CARRY_REACH: Readonly<
  Record<CarryStyle, { readonly ahead: number; readonly behind: number }>
> = {
  low: { ahead: 1, behind: 0.15 },
  shouldered: { ahead: 1.5, behind: 0.1 },
};
/**
 * How far clear of the head's centre the item has to pass, rig units, per
 * style: past the face and a crossguard's spread, or a two-hander's head.
 */
const FACE_CLEARANCE: Readonly<Record<CarryStyle, number>> = {
  low: HEAD_RX + 0.14,
  shouldered: HEAD_RX + 0.22,
};
/**
 * The lowest the item's far end may be drawn, rig units below his soles:
 * edge-on the floor is his ground line; head-on the floor ahead of him is
 * drawn down the screen.
 */
const FLOOR_ALLOWANCE: Readonly<Record<CardinalView, number>> = {
  side: 0,
  front: HEAD_ON_FLOOR_FORESHORTENING * CARRY_REACH.shouldered.ahead,
  back: HEAD_ON_FLOOR_FORESHORTENING * CARRY_REACH.shouldered.ahead,
};
/** Turns tried either side of the preferred angle, each this far, until the item is clear. */
const CLEAR_STEP = deg(10);
const CLEAR_STEPS = 18;

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const along = lengthSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * How clear an item carried at drawn `angle` from `grip` stands of his face
 * and of the floor, rig units: the lesser margin, negative where it crosses
 * one of them.
 */
function clearance(
  angle: number,
  grip: Pt,
  head: Pt,
  style: CarryStyle,
  view: CardinalView,
): number {
  const reach = CARRY_REACH[style];
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const tip = { x: grip.x + dir.x * reach.ahead, y: grip.y + dir.y * reach.ahead };
  const butt = { x: grip.x - dir.x * reach.behind, y: grip.y - dir.y * reach.behind };
  const floor = FLOOR_ALLOWANCE[view];
  const offFace = distanceToSegment(head, butt, tip) - FACE_CLEARANCE[style];
  return Math.min(offFace, floor - tip.y, floor - butt.y);
}

/**
 * The drawn angle nearest `preferred` at which the item clears his face and
 * the floor, turning a step at a time — away from his head first, so a
 * swinging arm turns the item the same way frame after frame. Where no angle
 * clears both, the one that crosses them least.
 */
function clearedAngle(
  preferred: number,
  grip: Pt,
  head: Pt,
  style: CarryStyle,
  view: CardinalView,
): number {
  const toHead = { x: head.x - grip.x, y: head.y - grip.y };
  const headClockwise = Math.cos(preferred) * toHead.y - Math.sin(preferred) * toHead.x > 0;
  const away = headClockwise ? -1 : 1;
  let best = preferred;
  let bestMargin = Number.NEGATIVE_INFINITY;
  for (let step = 0; step <= CLEAR_STEPS; step++) {
    for (const sign of [away, -away]) {
      const angle = preferred + sign * step * CLEAR_STEP;
      const margin = clearance(angle, grip, head, style, view);
      if (margin >= 0) return angle;
      if (margin > bestMargin) {
        best = angle;
        bestMargin = margin;
      }
    }
  }
  return best;
}

function carryAngle(pose: CarlPose, view: CardinalView, style: CarryStyle): number {
  const { arm, head } = drawnRightArm(pose, view);
  const raised = style === 'low' && arm.end.y < arm.root.y;
  const base = raised ? RAISED_HAFT_ANGLE[view] : CARRY_HAFT_ANGLE[style][view];
  const authored = view !== 'side' && pose.rightHand.x < 0 ? Math.PI - base : base;
  const grip = handGrip(arm).centre;
  return reflectedFor(clearedAngle(reflectedFor(authored, view), grip, head, style, view), view);
}

/**
 * What closes his main hand on a carried item: how thick its handle is, how
 * it is carried on a row not authored for it, and the set of rows it is
 * played in.
 */
export interface CarriedGrip {
  readonly handle: HandleRadius;
  readonly style: CarryStyle;
  readonly motionSet: MotionSet;
}

/** How each set's weapon rides on a row its set has none of its own for. */
const CARRY_STYLE: Readonly<Record<MotionSet, CarryStyle>> = {
  unarmed: 'low',
  oneHandLight: 'low',
  oneHandHeavy: 'shouldered',
  twoHand: 'shouldered',
};

/** How a weapon of `set` rides on a row its set has none of its own for. */
export function carryStyleOf(set: MotionSet): CarryStyle {
  return CARRY_STYLE[set];
}

/** How the weapon `look` is carried: its handle, and the set of rows its grip and weight play. */
export function carriedGripOf(look: WeaponHeldVisualDef): CarriedGrip {
  const motionSet = motionSetOf(look);
  return { handle: look.handle.radius, style: CARRY_STYLE[motionSet], motionSet };
}

/**
 * A stable name for a carried grip, for a figure's id. The set is left out:
 * every set's rows are cells of the same figure, and a figure that differs
 * only in which of them are played paints the same pictures.
 */
export function carriedGripKey(grip: CarriedGrip): string {
  return `${grip.handle}-${grip.style}`;
}

/**
 * The handle a carried item's fingers close round, stamped on each hand an
 * armed row has turned to grip it: the row says how the hand turns, the
 * item how thick a handle it closes on.
 */
function withCarriedHandle(pose: CarlPose, grip: CarriedGrip): CarlPose {
  const { handle } = grip;
  const right = pose.rightHandOrientation;
  const left = pose.leftHandOrientation;
  const twoHanded = pose.twoHandGrip !== undefined;
  return {
    ...pose,
    ...(right === undefined ? {} : { rightHandOrientation: { ...right, handle } }),
    ...(left === undefined || !twoHanded ? {} : { leftHandOrientation: { ...left, handle } }),
  };
}

/**
 * Closes his right fist round a carried item on any row that leaves that
 * hand free. An armed row holds it as it was authored to, on the carried
 * item's handle.
 */
export function carryInMainHand(pose: CarlPose, row: RowSpec, grip: CarriedGrip): CarlPose {
  const { style } = grip;
  if (row.motionSet !== undefined) return withCarriedHandle(pose, grip);
  if (busy(pose)) return pose;
  const thrusting = style === 'low' && thrustsWithRightFist(row);
  const haftAngle = thrusting
    ? reflectedFor(wristAngle(drawnRightArm(pose, row.view).arm), row.view)
    : carryAngle(pose, row.view, style);
  return {
    ...pose,
    rightHandShape: 'grip',
    rightHandOrientation: {
      palmNormal: thrusting ? STRIKING_PALM : CARRY_PALM,
      haftDepth: HAFT_IN_PLANE,
      haftAngle,
      handle: grip.handle,
    },
  };
}
