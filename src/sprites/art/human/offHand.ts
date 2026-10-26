/**
 * How the human crawler carries a shield on his off hand through rows that
 * were never authored for one: his left fist closed on it wherever a row
 * leaves that hand free, the shield turned to face where he faces, and squared
 * to the shot on the block rows.
 *
 * A row decides for all its frames: an action or a fidget, or one that wants
 * his left hand on any frame — a prop in it, both fists on one haft, an open
 * hand at work, the Protective Shell gathered in it — leaves the shield
 * stowed for the whole row, so it
 * never jumps between his hand and his back mid-gesture. A two-handed weapon
 * out in his hand is not his to decide here: the runtime gives such a figure
 * no off-hand grip at all.
 */

import type { HandleRadius } from '../../held/gripArchetypes';
import type { OffHandHeldVisualDef } from '../../held/heldVisualDef';
import type { CardinalView } from '../../facingView';
import { type BipedPose, HAFT_IN_PLANE, type HandOrientation, type HaftDepth } from '../biped/rig';
import { deg } from '../bipedArt';
import type { HumanRowRole, RowSpec } from '../humanFigure';
import { towards } from './handTurn';
import { BLOCK_ROW_NAMES } from './offHandBlock';

/** What closes his off hand on a shield: how thick a strap the fingers wrap. */
export interface OffHandGrip {
  readonly handle: HandleRadius;
}

export function offHandGripOf(look: OffHandHeldVisualDef): OffHandGrip {
  return { handle: look.handle.radius };
}

/** A stable name for an off-hand grip, for a figure's id. */
export function offHandGripKey(grip: OffHandGrip): string {
  return `offhand-${grip.handle}`;
}

/** The strap runs down the back of his hand, so the shield's picture is never turned on its side. */
const STRAP_DOWN = deg(90);
/** The strap runs forward across the shield, which is turned out of the picture as it is in profile. */
const STRAP_FORWARD = 0;
/**
 * Blocking head-on and from behind, the strap runs up from his fist, so the
 * lid stands over his chest above the fist that holds it rather than hanging
 * below it at his belly.
 */
const STRAP_UP = deg(-90);
const AWAY_FROM_CAMERA: HaftDepth = -1;
/** Squared to a shot ahead of him, the lid is turned further from the camera. */
const BLOCKING_PROFILE_STRAP_SHARE = 0.6;

/**
 * Carried, the shield faces the way he does, a little out to his left. Head-on
 * the back of his hand is to the camera and the lid's whole face shows beside
 * his hip. From behind the palm is to the camera, the lid's face away from it.
 * In profile the lid on his far arm faces out from his side, its whole round
 * standing out ahead of his thigh, where an oval turned toward the camera
 * hid behind him.
 */
const CARRIED: Readonly<Record<CardinalView, HandOrientation>> = {
  front: { palmNormal: towards(0.3, 0, -0.95), haftDepth: HAFT_IN_PLANE, haftAngle: STRAP_DOWN },
  side: { palmNormal: towards(0, 0, 1), haftDepth: HAFT_IN_PLANE, haftAngle: STRAP_FORWARD },
  back: { palmNormal: towards(0.3, 0, 0.95), haftDepth: HAFT_IN_PLANE, haftAngle: STRAP_DOWN },
};

/**
 * Blocking, the shield is square to the shot. Head-on it faces the camera
 * outright. In profile it faces ahead, turned a little toward the camera so
 * it reads as a narrow upright oval in front of his chest.
 */
const BLOCKING: Readonly<Record<CardinalView, HandOrientation>> = {
  front: { palmNormal: towards(0, 0, -1), haftDepth: HAFT_IN_PLANE, haftAngle: STRAP_UP },
  side: {
    palmNormal: towards(-0.8, 0, -0.6),
    haftDepth: AWAY_FROM_CAMERA,
    haftAngle: STRAP_FORWARD,
    haftShare: BLOCKING_PROFILE_STRAP_SHARE,
  },
  back: { palmNormal: towards(0, 0, 1), haftDepth: HAFT_IN_PLANE, haftAngle: STRAP_UP },
};

const BLOCK_ROWS: ReadonlySet<string> = new Set(BLOCK_ROW_NAMES);

/** Whether `pose` has his left hand at something of its own. */
function wantsOffHand(pose: BipedPose): boolean {
  if (pose.twoHandGrip !== undefined) return true;
  const shape = pose.leftHandShape;
  if (shape === 'grip' || shape === 'open') return true;
  if (pose.heldProps?.some((prop) => prop.hand === 'left') === true) return true;
  return pose.palmGlow?.hand === 'left';
}

/**
 * Actions and fidgets are gestures with both hands — a bottle wiped from the
 * lips, a neck rubbed, a chest lid lifted — that would carry a shield across
 * his face, so the shield is stowed for them whatever the hand is doing.
 */
const GESTURE_ROLES: ReadonlySet<HumanRowRole> = new Set(['action', 'fidget']);

const freeByRow = new Map<string, boolean>();

/** Whether every frame of `row` leaves his left hand free; asked once a row and kept. */
export function rowLeavesOffHandFree(row: RowSpec): boolean {
  const known = freeByRow.get(row.name);
  if (known !== undefined) return known;
  let free = row.role === undefined || !GESTURE_ROLES.has(row.role);
  for (let frame = 0; frame < row.frameCount && free; frame++) {
    if (wantsOffHand(row.pose(frame))) free = false;
  }
  freeByRow.set(row.name, free);
  return free;
}

/** Closes his left fist on the shield on any row that leaves that hand free. */
export function carryInOffHand(pose: BipedPose, row: RowSpec, grip: OffHandGrip): BipedPose {
  if (!rowLeavesOffHandFree(row)) return pose;
  const turned = BLOCK_ROWS.has(row.name) ? BLOCKING[row.view] : CARRIED[row.view];
  return {
    ...pose,
    leftHandShape: 'grip',
    leftHandOrientation: { ...turned, handle: grip.handle },
  };
}
