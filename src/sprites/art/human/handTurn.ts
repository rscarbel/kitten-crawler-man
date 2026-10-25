/**
 * Authoring a gripping hand's turn in depth: the way its palm faces and which
 * way the haft it holds runs out of the picture. Every row that puts
 * something in his hand says this per frame, beside the pose, because a 2D
 * pose cannot: the same fist on screen may hold its handle with the knuckles
 * or the palm toward the camera, and which one decides whether the fingers
 * close over the handle's front or its back.
 *
 * Directions are in the pose's own frame, as every pose is authored: his
 * right toward +X (as seen from behind), +Y down the screen, +Z toward the
 * camera. The front view reflects them with the rest of the pose.
 */

import type { Vec3 } from '../../held/heldPaint';
import { type BodySide, type BipedPose, type HaftDepth, HAFT_IN_PLANE } from '../biped/rig';

/** A direction from its three parts, made unit. */
export function towards(x: number, y: number, z: number): Vec3 {
  const size = Math.hypot(x, y, z);
  return { x: x / size, y: y / size, z: z / size };
}

/** `a` turned toward `b` by `t`, unit: a wrist rolling from one to the other. */
export function rolled(a: Vec3, b: Vec3, t: number): Vec3 {
  return towards(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** Knuckles square to the camera: the palm faces into the body, or the work. */
export const KNUCKLES_TO_CAMERA: Vec3 = towards(0, 0, -1);
/** The palm square to the camera: the fingers close over the handle's front. */
export const PALM_TO_CAMERA: Vec3 = towards(0, 0, 1);

/**
 * Turns `side`'s gripping hand on `pose`: its palm toward `palmNormal`, the
 * haft it holds running out of the picture by `haftDepth`, and — for a
 * one-handed item the row does not hold as a prop — pointing along
 * `haftAngle` on screen.
 */
export function turnHand(
  pose: BipedPose,
  side: BodySide,
  palmNormal: Vec3,
  haftDepth: HaftDepth = HAFT_IN_PLANE,
  haftAngle?: number,
): void {
  const orientation = {
    palmNormal,
    haftDepth,
    ...(haftAngle === undefined ? {} : { haftAngle }),
  };
  if (side === 'left') pose.leftHandOrientation = orientation;
  else pose.rightHandOrientation = orientation;
}

/** Turns every hand the pose has given a prop by the palm `palmFor` names for its side. */
export function turnPropHands(pose: BipedPose, palmFor: (side: BodySide) => Vec3): void {
  for (const prop of pose.heldProps ?? []) turnHand(pose, prop.hand, palmFor(prop.hand));
}
