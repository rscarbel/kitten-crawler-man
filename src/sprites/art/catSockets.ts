/**
 * The cat's sockets: the named places on her figure a held or carried thing
 * attaches to, published for every frame of every row.
 *
 * - `mouth` — across her jaws, where a small thing is carried.
 * - `forePaw` — under the pad of the forepaw that holds a haft's butt: the
 *   screen-left paw head-on and from behind, the near paw in profile. Her
 *   other forepaw closes on the haft further along it (`upperPaw`).
 * - `back` — over the middle of her back, where a pack or saddle would ride
 *   and where her paw tool rides stowed between uses: along her spine in
 *   profile, slung up past a shoulder head-on and from behind.
 *
 * Each comes out of the pose her painter paints and the very placement
 * functions it places her paws, mouth and back with, so a socket cannot
 * disagree with the picture. A west-facing profile is painted, not flipped,
 * so its sockets are solved on the west painter's own geometry: the near paw
 * there is her left, and the thing it holds is reflected with her.
 *
 * Memoised per look, row and frame: a cell's pose is fixed, her garments move
 * no socket, and the key space is bounded.
 */

import type { Vec3 } from '../held/heldPaint';
import { GRIP_ARCHETYPES, type CatGripArchetype, type CatSocket } from '../held/gripArchetypes';
import type { HeldVisualDef } from '../held/heldVisualDef';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import {
  BUTT_FOREPAW,
  CAT_SLABS,
  type CatDirection,
  type CatPose,
  type CatSlab,
  type Pt,
  catFaceFront,
  catFrontHeldUnder,
  catFaceSide,
  catForepawBack,
  catForepawFront,
  catForepawSide,
  catMouthFront,
  catMouthSide,
  catSaddle,
  catSideTurn,
  deg,
} from './catArt';
import { CAT_CELL_PX_PER_POSE_UNIT, catPoseToCell, catRowOf, type RowSpec } from './catFigure';
import type { CatLook } from '../looks/catLook';
import type { CardinalView } from '../facingView';

/** The index of the slab of hers a held thing sits directly in front of, in {@link CAT_SLABS}. */
export type CatSocketLayer = number;

/** One socket of hers on one frame. */
export interface CatSocketFrame {
  /** Where the held thing's grip point lands, cell pixels. */
  readonly centre: Pt;
  /** The held thing's axis, butt to head, unit, camera space (x right, y down, z toward the camera). */
  readonly axis: Vec3;
  /** Which way the pads closed on it face, unit, camera space. */
  readonly palmNormal: Vec3;
  readonly layer: CatSocketLayer;
  /** Whether a held thing is drawn here on this frame. */
  readonly occupied: boolean;
  /** Held behind her body, in its shadow. */
  readonly shaded: boolean;
  /** Behind her body. */
  readonly behind: boolean;
}

/** Every socket on one frame of hers. */
export interface CatSocketFrames {
  readonly sockets: Readonly<Record<CatSocket, CatSocketFrame>>;
  /** On a frame her paws close on a haft, where the second paw grips it, cell pixels. */
  readonly upperPaw: Pt | null;
  /** The middle of her face on a frame it is drawn, cell pixels, and its half-width. */
  readonly face: { readonly centre: Pt; readonly radius: number } | null;
}

/**
 * Her tools are drawn at this share of the size the human holds the same tool at:
 * she is half his height, so she swings a shortened grip on it.
 */
const CAT_TOOL_SHARE = 0.7;
/**
 * A thing in her jaws is drawn larger than the human holds it: at his size a
 * wrench across her muzzle is a bar no wider than her face, and reads as a
 * strap rather than a thing she carries.
 */
const CAT_MOUTH_SHARE = 1.3;

/** Cell pixels of hers per rig unit of `look`'s own dimensions, by how she holds it. */
export function catHeldPxPerUnit(look: HeldVisualDef): number {
  const share = catGripOf(look) === 'mouthCarry' ? CAT_MOUTH_SHARE : CAT_TOOL_SHARE;
  return HUMAN_CELL_PX_PER_UNIT * share;
}

/** Pads turned to the camera: what a socket nothing is held in reports. */
const PADS_TO_CAMERA: CatDirection = { x: 0, y: 0, z: 1 };

/** A thing lying across her, level: where a socket nothing is held in points. */
const LEVEL: Vec3 = { x: 1, y: 0, z: 0 };

function unit(x: number, y: number, z: number): Vec3 {
  const size = Math.hypot(x, y, z);
  return { x: x / size, y: y / size, z: z / size };
}

/** In profile a stowed tool is tipped up this far from her spine, clear of her rump. */
const STOWED_PROFILE_RISE = deg(20);
/**
 * Slung across her back, head-on or from behind, it stands this far up from
 * level and leans this share of its length away from the camera.
 */
const STOWED_SLING_RISE = deg(56.5);
const STOWED_SLING_DEPTH = 0.1;

/**
 * How a tool rides stowed on her back, butt to head, facing east. In profile
 * it lies along her spine, head toward her tail and tipped up so it clears
 * her rump; head-on it is slung behind her, its head up past her shoulder on
 * her right (the viewer's left); from behind it is over her back, the same
 * shoulder now on the viewer's right.
 */
const STOWED_AXIS: Readonly<Record<CardinalView, Vec3>> = {
  side: unit(-Math.cos(STOWED_PROFILE_RISE), -Math.sin(STOWED_PROFILE_RISE), 0),
  front: unit(-Math.cos(STOWED_SLING_RISE), -Math.sin(STOWED_SLING_RISE), -STOWED_SLING_DEPTH),
  back: unit(Math.cos(STOWED_SLING_RISE), -Math.sin(STOWED_SLING_RISE), STOWED_SLING_DEPTH),
};
/** The rearmost of her slabs' layers: a thing there is drawn behind all of her. */
const BEHIND_ALL_OF_HER: CatSocketLayer = -1;

/** Head-on her back is the side away from the camera, so what rides there is behind all of her. */
function backSocket(row: RowSpec, pose: CatPose, look: CatLook): CatSocketFrame {
  const behindHer = row.view === 'front';
  return {
    centre: placed(row, catSaddle(pose, row.view, look)),
    axis: westward(STOWED_AXIS[row.view], row.facesWest, false),
    palmNormal: westward(PADS_TO_CAMERA, row.facesWest, true),
    layer: behindHer ? BEHIND_ALL_OF_HER : CAT_SLABS.length - 1,
    occupied: false,
    shaded: behindHer,
    behind: behindHer,
  };
}

/** The slab a held thing sits directly in front of, by the slab it lies under. */
function layerUnder(under: CatSlab | undefined): CatSocketLayer {
  if (under === undefined) return CAT_SLABS.length - 1;
  return CAT_SLABS.indexOf(under) - 1;
}

/** The forepaw that holds a haft's butt, and the other, in pose space as painted facing east. */
function forepaws(row: RowSpec, pose: CatPose, look: CatLook): { butt: Pt; upper: Pt } {
  if (row.view === 'side') {
    return { butt: catForepawSide(pose, look, true), upper: catForepawSide(pose, look, false) };
  }
  const buttSide = BUTT_FOREPAW[row.view] === 'frontL' ? -1 : 1;
  const place = row.view === 'front' ? catForepawFront : catForepawBack;
  return { butt: place(pose, buttSide), upper: place(pose, -buttSide) };
}

/**
 * How far below her closed mouth line a thing in her jaws sits head-on, per
 * unit of jaw opening, as a share of her head's half-height: on the lower
 * jaw, under her muzzle rather than across it. A share of the head, not a
 * length, so on a smaller head it stays on her jaw instead of under her chin.
 */
const BITE_DROP_PER_OPENING = 1.32;

function mouthOf(row: RowSpec, pose: CatPose, look: CatLook): Pt {
  if (row.view === 'side') return catMouthSide(pose, look);
  const mouth = catMouthFront(pose, look);
  const drop = pose.mouth * BITE_DROP_PER_OPENING * look.proportions.head.ry;
  return { x: mouth.x, y: mouth.y + drop };
}

function faceOf(row: RowSpec, pose: CatPose, look: CatLook): { centre: Pt; radius: number } | null {
  if (row.view === 'back') return null;
  return row.view === 'side' ? catFaceSide(pose, look) : catFaceFront(pose, look);
}

/** How far a pose's own frame is turned on screen: her roll, and her lean too in profile. */
function screenTurn(row: RowSpec, pose: CatPose): number {
  return row.view === 'side' ? catSideTurn(pose) : pose.roll;
}

/** A pose-space point facing east, as her cell paints it — reflected about her tile's centre facing west. */
function placed(row: RowSpec, point: Pt): Pt {
  return catPoseToCell(row.facesWest ? { x: -point.x, y: point.y } : point);
}

/**
 * A direction facing east as her west twin paints it: reflected left for
 * right, and the pads' facing turned with it so a picture drawn along it is
 * reflected rather than turned end for end.
 */
function westward(direction: CatDirection, facesWest: boolean, pad: boolean): CatDirection {
  if (!facesWest) return direction;
  return { x: -direction.x, y: direction.y, z: pad ? -direction.z : direction.z };
}

function heldAxis(row: RowSpec, pose: CatPose): Vec3 {
  const grip = pose.grip;
  if (grip === undefined) return LEVEL;
  const angle = grip.haftAngle + screenTurn(row, pose);
  const onScreen = Math.sqrt(Math.max(0, 1 - grip.haftDepth * grip.haftDepth));
  return westward(
    { x: Math.cos(angle) * onScreen, y: Math.sin(angle) * onScreen, z: grip.haftDepth },
    row.facesWest,
    false,
  );
}

function solve(row: RowSpec, frame: number, look: CatLook): CatSocketFrames {
  const pose = row.pose(frame, look);
  const grip = pose.grip;
  const axis = heldAxis(row, pose);
  const padNormal = westward(grip?.padNormal ?? PADS_TO_CAMERA, row.facesWest, true);
  const under = row.view === 'front' ? catFrontHeldUnder(pose, look) : grip?.under;
  const layer = layerUnder(under ?? undefined);
  const behindHer = grip?.under === 'body';
  const paws = forepaws(row, pose, look);
  const holdsHaft = grip?.pawsClosed === true;
  const carries = row.hold === 'carry';
  const socket = (centre: Pt, occupied: boolean): CatSocketFrame => ({
    centre: placed(row, centre),
    axis,
    palmNormal: padNormal,
    layer,
    occupied,
    shaded: behindHer,
    behind: behindHer,
  });
  const face = faceOf(row, pose, look);
  return {
    sockets: {
      mouth: socket(mouthOf(row, pose, look), carries),
      forePaw: socket(paws.butt, holdsHaft),
      back: backSocket(row, pose, look),
    },
    upperPaw: holdsHaft ? placed(row, paws.upper) : null,
    face:
      face === null
        ? null
        : { centre: placed(row, face.centre), radius: face.radius * CAT_CELL_PX_PER_POSE_UNIT },
  };
}

const framesByCell = new Map<string, CatSocketFrames>();

/** Every socket of a cat looking like `look` on one frame of one of her rows, or null for a name that is no row of hers. */
export function catSocketsAt(look: CatLook, state: string, frame: number): CatSocketFrames | null {
  const key = `${look.id}:${state}:${frame}`;
  const known = framesByCell.get(key);
  if (known !== undefined) return known;
  const row = catRowOf(state);
  if (row === undefined) return null;
  const found = solve(row, frame, look);
  framesByCell.set(key, found);
  return found;
}

/**
 * How she holds `look`, or null for a thing she cannot hold: a thing made to
 * be carried in the jaws she carries there, and the tools the human swings in both
 * hands she swings with both forepaws on the haft.
 */
export function catGripOf(look: HeldVisualDef): CatGripArchetype | null {
  if (look.archetype === 'mouthCarry') return 'mouthCarry';
  if (look.archetype === 'pawTool' || look.archetype === 'twoHandHaft') return 'pawTool';
  return null;
}

/** The socket `look` is held at on a frame, or null where it is not held there. */
export function catHeldSocketOf(
  look: HeldVisualDef,
  frames: CatSocketFrames,
): CatSocketFrame | null {
  const grip = catGripOf(look);
  if (grip === null) return null;
  const socket = frames.sockets[GRIP_ARCHETYPES[grip].heldIn[0]];
  return socket.occupied ? socket : null;
}
