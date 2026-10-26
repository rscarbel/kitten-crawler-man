/**
 * Where a weapon rests on the human crawler while it is equipped and not in his hand, as
 * the drawn picture shows it: a light one-hander (and a slingshot) hangs at
 * his left hip, hilt up and point down and back; a heavy one-hander or a
 * two-hander lies across his back, its handle up behind his right shoulder
 * where his right hand reaches back for it, its head down toward his left
 * hip.
 *
 * Each place is an anchor on his solved skeleton, an offset from it and the
 * item's axis (butt to head), all as the cell is drawn — head-on his right is
 * on the viewer's left. The draw and stow rows put his fist on the same
 * place, along the same axis, so the item leaves its rest without a jump.
 */

import type { Vec3 } from '../../held/heldPaint';
import type { CardinalView } from '../../facingView';
import type { Pt } from '../bipedArt';
import { pt } from '../biped/geometry';
import { drawnSide, type Skeleton, VIEWS } from '../biped/rig';

/** The stowed places that show: a place of `none` is put away out of sight. */
export type ShownPlacement = 'hip' | 'back';

/** The part of him a stowed place hangs from. */
type StowedAnchor = 'leftHip' | 'rightShoulder';

interface StowedGeometry {
  readonly anchor: StowedAnchor;
  /** From the anchor to where the item's grip point rests, rig units, as drawn. */
  readonly offset: Pt;
  /** The item's axis as drawn, butt to head, camera space. */
  readonly axis: Vec3;
  /**
   * Which way the item's flat faces, camera space: it lies against him, so
   * this is the normal of the part of him it rests on.
   */
  readonly flatFacing: Vec3;
}

function unit(x: number, y: number, z: number): Vec3 {
  const size = Math.hypot(x, y, z);
  return { x: x / size, y: y / size, z: z / size };
}

/**
 * The anchor on a skeleton whose `left` and `right` fields are the drawn
 * picture's when `drawn`, or the authored pose's otherwise: head-on the
 * drawn picture's left fields carry his right side.
 */
function anchorOn(
  skeleton: Skeleton,
  anchor: StowedAnchor,
  view: CardinalView,
  drawn: boolean,
): Pt {
  const spec = VIEWS[view];
  if (anchor === 'leftHip') {
    const side = drawn ? drawnSide('left', spec) : 'left';
    return side === 'left' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
  }
  const side = drawn ? drawnSide('right', spec) : 'right';
  return side === 'right' ? skeleton.rightShoulder : skeleton.leftShoulder;
}

/** Square to the camera: a flat lying against a part of him that faces the viewer. */
const FACING_CAMERA: Vec3 = { x: 0, y: 0, z: 1 };
/**
 * Out of his back in profile, where he faces +X: a flat lying against his
 * back is seen on its edge, the way a strapped-on axe head shows only its
 * thickness from the side.
 */
const OUT_OF_HIS_BACK: Vec3 = { x: -1, y: 0, z: 0 };

/**
 * The hip: the hilt at his belt over the left hip, the scabbard hanging down
 * and a little back. Head-on and from behind it hangs a little out from the
 * thigh so the blade shows beside it; edge-on it slants back.
 */
const HIP: Readonly<Record<CardinalView, StowedGeometry>> = {
  side: {
    anchor: 'leftHip',
    offset: pt(0.04, 0.02),
    axis: unit(-0.45, 0.89, 0),
    flatFacing: FACING_CAMERA,
  },
  front: {
    anchor: 'leftHip',
    offset: pt(0.06, 0.04),
    axis: unit(0.26, 0.96, 0),
    flatFacing: FACING_CAMERA,
  },
  back: {
    anchor: 'leftHip',
    offset: pt(-0.06, 0.04),
    axis: unit(-0.26, 0.96, 0),
    flatFacing: FACING_CAMERA,
  },
};

/**
 * The back: the grip just above and behind his right shoulder, the item
 * slanting down across his back to his left hip, flat against him. Edge-on
 * the diagonal across his back runs mostly away from the camera, so it shows
 * as a short haft lying down the line of his back, the head on its edge.
 */
const BACK: Readonly<Record<CardinalView, StowedGeometry>> = {
  side: {
    anchor: 'rightShoulder',
    offset: pt(-0.13, 0.08),
    axis: unit(-0.14, 0.86, -0.5),
    flatFacing: OUT_OF_HIS_BACK,
  },
  front: {
    anchor: 'rightShoulder',
    offset: pt(0.02, -0.06),
    axis: unit(0.6, 0.8, 0),
    flatFacing: FACING_CAMERA,
  },
  back: {
    anchor: 'rightShoulder',
    offset: pt(-0.02, -0.06),
    axis: unit(-0.6, 0.8, 0),
    flatFacing: FACING_CAMERA,
  },
};

const STOWED: Readonly<Record<ShownPlacement, Readonly<Record<CardinalView, StowedGeometry>>>> = {
  hip: HIP,
  back: BACK,
};

/** Where an item stowed at `placement` rests on a drawn skeleton, in figure units. */
export function stowedCentre(
  placement: ShownPlacement,
  view: CardinalView,
  drawnSkeleton: Skeleton,
): Pt {
  const place = STOWED[placement][view];
  const anchor = anchorOn(drawnSkeleton, place.anchor, view, true);
  return pt(anchor.x + place.offset.x, anchor.y + place.offset.y);
}

/** The axis an item stowed at `placement` rests along, as drawn. */
export function stowedAxis(placement: ShownPlacement, view: CardinalView): Vec3 {
  return STOWED[placement][view].axis;
}

/** Which way the flat of an item stowed at `placement` faces, as drawn. */
export function stowedFlatFacing(placement: ShownPlacement, view: CardinalView): Vec3 {
  return STOWED[placement][view].flatFacing;
}

/**
 * The stowed axis's direction on screen as the pose is authored — his right
 * toward +X — for a fist that closes on the item where it rests: head-on the
 * drawn picture is the authored one reflected.
 */
export function stowedHaftAngle(placement: ShownPlacement, view: CardinalView): number {
  const axis = stowedAxis(placement, view);
  const drawn = Math.atan2(axis.y, axis.x);
  return VIEWS[view].mirrored ? Math.PI - drawn : drawn;
}

/**
 * Where an item stowed at `placement` rests, as the pose is authored, from a
 * skeleton built on the authored pose.
 */
export function stowedCentreAuthored(
  placement: ShownPlacement,
  view: CardinalView,
  authoredSkeleton: Skeleton,
): Pt {
  const place = STOWED[placement][view];
  const anchor = anchorOn(authoredSkeleton, place.anchor, view, false);
  const across = VIEWS[view].mirrored ? -place.offset.x : place.offset.x;
  return pt(anchor.x + across, anchor.y + place.offset.y);
}
