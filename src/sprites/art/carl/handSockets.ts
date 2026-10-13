/**
 * What each of Carl's hands holds on a drawn pose, and how: where the handle
 * runs through the fist, which way it points in depth, which way the palm
 * faces, and the fingers solved round it.
 *
 * Solved from the very skeleton the painter draws, so a socket can never
 * disagree with the hand it describes.
 */

import type { Vec3 } from '../../held/heldPaint';
import { HANDLE_HALF_WIDTH, type HandleRadius } from '../../held/gripArchetypes';
import { scriptedPropVisual } from '../../held/art/scriptedPropHeld';
import type { Pt } from '../carlArt';
import { type GripWrap, solveGrip } from './grip';
import { GRIP_HAND_WIDTH, handGrip, wristAngle } from './limbs';
import type { HeldProp } from './props';
import type { BodySide, BoneChain, CarlPose, HandOrientation, Skeleton } from './rig';

/**
 * What a hand is doing with its socket: nothing; a prop its row always holds,
 * painted into the cell; or whatever item equipment puts there, composited
 * into the cell at runtime.
 */
export type HandOccupant = 'empty' | 'prop' | 'item';

/** One hand of a drawn pose, solved. */
export interface SolvedHand {
  /** The side of the drawn pose whose fields posed it. */
  readonly drawnSide: BodySide;
  /** The middle of the fist's bore, figure units. */
  readonly centre: Pt;
  /** The handle's direction, butt to head, unit, camera space as drawn. */
  readonly axis: Vec3;
  /** The way the palm faces, unit, camera space as drawn. */
  readonly palmNormal: Vec3;
  readonly occupant: HandOccupant;
  /** The row's own prop, when the occupant is one. */
  readonly prop?: HeldProp;
  /** The fingers closed round the handle; absent on a hand holding nothing it wraps. */
  readonly wrap?: GripWrap;
  /** The handle's half-thickness the fingers close round, figure units. */
  readonly handleRadius: number;
}

/** Both hands of a drawn pose, solved, and the haft they share if they share one. */
export interface SolvedHands {
  readonly left: SolvedHand;
  readonly right: SolvedHand;
  /** On a two-handed grip, which drawn side holds the butt. */
  readonly twoHandButt?: BodySide;
}

/** A palm turned to the camera: what an empty hand's socket reports. */
const PALM_TO_CAMERA: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * The least share of a haft's length a grip ever draws, so a haft swung
 * straight at the camera keeps a direction.
 */
const MIN_HAFT_SHARE = 0.3;

function unit(x: number, y: number, z: number): Vec3 {
  const size = Math.hypot(x, y, z);
  return { x: x / size, y: y / size, z: z / size };
}

function inPlane(angle: number): Vec3 {
  return { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
}

/** A one-handed item's axis: along `angle` on screen, turned out of the picture as the hand says. */
function oneHandAxis(angle: number, orientation: HandOrientation | undefined): Vec3 {
  const share = Math.max(MIN_HAFT_SHARE, Math.min(1, orientation?.haftShare ?? 1));
  const depth = orientation?.haftDepth ?? 0;
  if (share >= 1 || depth === 0) return inPlane(angle);
  return unit(
    Math.cos(angle) * share,
    Math.sin(angle) * share,
    Math.sqrt(1 - share * share) * depth,
  );
}

function propIn(pose: CarlPose, side: BodySide): HeldProp | undefined {
  return pose.heldProps?.find((prop) => prop.hand === side);
}

function chainOf(skeleton: Skeleton, side: BodySide): BoneChain {
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

function orientationOf(pose: CarlPose, side: BodySide): HandOrientation | undefined {
  return side === 'left' ? pose.leftHandOrientation : pose.rightHandOrientation;
}

function occupantOf(pose: CarlPose, side: BodySide): HandOccupant {
  const shape = side === 'left' ? pose.leftHandShape : pose.rightHandShape;
  if (shape !== 'grip') return 'empty';
  if (propIn(pose, side) !== undefined) return 'prop';
  return orientationOf(pose, side) === undefined ? 'empty' : 'item';
}

/** The haft of a two-handed grip, from the butt fist through the other, with its depth. */
function twoHandAxis(butt: Pt, upper: Pt, flatSpacing: number, depth: number): Vec3 {
  const dx = upper.x - butt.x;
  const dy = upper.y - butt.y;
  const spacing = Math.hypot(dx, dy);
  const share = Math.max(MIN_HAFT_SHARE, Math.min(1, spacing / flatSpacing));
  const angle = Math.atan2(dy, dx);
  const outOfPlane = Math.sqrt(1 - share * share) * depth;
  return unit(Math.cos(angle) * share, Math.sin(angle) * share, outOfPlane);
}

function solveHand(
  pose: CarlPose,
  skeleton: Skeleton,
  side: BodySide,
  itemHandle: HandleRadius,
  sharedAxis: Vec3 | undefined,
): SolvedHand {
  const chain = chainOf(skeleton, side);
  const grip = handGrip(chain);
  const occupant = occupantOf(pose, side);
  const orientation = orientationOf(pose, side);
  const prop = propIn(pose, side);
  const propVisual = prop === undefined ? undefined : scriptedPropVisual(prop);
  const propAngle = grip.haftAngle + (prop?.angle ?? 0) - (propVisual?.painterTurn ?? 0);
  const axis =
    sharedAxis ??
    (prop !== undefined
      ? inPlane(propAngle)
      : oneHandAxis(orientation?.haftAngle ?? grip.haftAngle, orientation));
  const palmNormal = orientation?.palmNormal ?? PALM_TO_CAMERA;
  const itemRadius = orientation?.handle ?? itemHandle;
  const handleRadius =
    HANDLE_HALF_WIDTH[propVisual === undefined ? itemRadius : propVisual.def.handle.radius];
  const wraps = occupant !== 'empty' && orientation !== undefined;
  const wrap = wraps
    ? solveGrip({
        centre: grip.centre,
        axis,
        palmNormal,
        handAngle: wristAngle(chain),
        handleRadius,
        handWidth: GRIP_HAND_WIDTH,
      })
    : undefined;
  return {
    drawnSide: side,
    centre: grip.centre,
    axis,
    palmNormal,
    occupant,
    handleRadius,
    ...(prop === undefined ? {} : { prop }),
    ...(wrap === undefined ? {} : { wrap }),
  };
}

/**
 * Solves both hands of a drawn pose on the skeleton the painter draws.
 * `itemHandle` is how thick a handle an equipment-chosen item has where the
 * hand's own orientation does not say, for the fingers to close round; a
 * row's own prop closes them round its own.
 */
export function solveHands(
  pose: CarlPose,
  skeleton: Skeleton,
  itemHandle: HandleRadius,
): SolvedHands {
  const shared = pose.twoHandGrip;
  if (shared === undefined) {
    return {
      left: solveHand(pose, skeleton, 'left', itemHandle, undefined),
      right: solveHand(pose, skeleton, 'right', itemHandle, undefined),
    };
  }
  const upperSide: BodySide = shared.butt === 'left' ? 'right' : 'left';
  const butt = handGrip(chainOf(skeleton, shared.butt)).centre;
  const upper = handGrip(chainOf(skeleton, upperSide)).centre;
  const depth = orientationOf(pose, shared.butt)?.haftDepth ?? 0;
  const axis = twoHandAxis(butt, upper, shared.flatSpacing, depth);
  return {
    left: solveHand(pose, skeleton, 'left', itemHandle, axis),
    right: solveHand(pose, skeleton, 'right', itemHandle, axis),
    twoHandButt: shared.butt,
  };
}
