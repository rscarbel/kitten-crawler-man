/**
 * Donut's sockets: the named places on her figure a held or carried thing
 * attaches to, published for every frame of every row.
 *
 * - `mouth` — across her jaws, where a small thing is carried.
 * - `forePaw` — under the pad of the forepaw that holds a haft's butt: the
 *   screen-left paw head-on and from behind, the near paw in profile. Her
 *   other forepaw closes on the haft further along it (`upperPaw`).
 * - `back` — over the middle of her back, where a pack or saddle would ride.
 *
 * Each comes out of the pose her painter paints and the very placement
 * functions it places her paws, mouth and back with, so a socket cannot
 * disagree with the picture. A west-facing profile is painted, not flipped,
 * so its sockets are solved on the west painter's own geometry: the near paw
 * there is her left, and the thing it holds is reflected with her.
 *
 * Memoised per figure, row and frame: a cell's pose is fixed, and the key
 * space is bounded.
 */

import type { Vec3 } from '../held/heldPaint';
import { GRIP_ARCHETYPES, type DonutGripArchetype, type DonutSocket } from '../held/gripArchetypes';
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
  catFaceSide,
  catForepawBack,
  catForepawFront,
  catForepawSide,
  catMouthFront,
  catMouthSide,
  catSaddle,
  catSideTurn,
} from './catArt';
import { CAT_CELL_PX_PER_POSE_UNIT, catPoseToCell, catRowOf, type RowSpec } from './catFigure';

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
export interface DonutSocketFrames {
  readonly sockets: Readonly<Record<DonutSocket, CatSocketFrame>>;
  /** On a frame her paws close on a haft, where the second paw grips it, cell pixels. */
  readonly upperPaw: Pt | null;
  /** The middle of her face on a frame it is drawn, cell pixels, and its half-width. */
  readonly face: { readonly centre: Pt; readonly radius: number } | null;
}

/**
 * Her tools are drawn at this share of the size Carl holds the same tool at:
 * she is half his height, so she swings a shortened grip on it.
 */
const CAT_TOOL_SHARE = 0.7;
/**
 * A thing in her jaws is drawn larger than Carl holds it: at his size a
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

/** The slab a held thing sits directly in front of, by the slab it lies under. */
function layerUnder(under: CatSlab | undefined): CatSocketLayer {
  if (under === undefined) return CAT_SLABS.length - 1;
  return CAT_SLABS.indexOf(under) - 1;
}

/** The forepaw that holds a haft's butt, and the other, in pose space as painted facing east. */
function forepaws(row: RowSpec, pose: CatPose): { butt: Pt; upper: Pt } {
  if (row.view === 'side') {
    return { butt: catForepawSide(pose, true), upper: catForepawSide(pose, false) };
  }
  const buttSide = BUTT_FOREPAW[row.view] === 'frontL' ? -1 : 1;
  const place = row.view === 'front' ? catForepawFront : catForepawBack;
  return { butt: place(pose, buttSide), upper: place(pose, -buttSide) };
}

/**
 * How far below her closed mouth line a thing in her jaws sits head-on, per
 * unit of jaw opening: on the lower jaw, under her muzzle rather than across it.
 */
const BITE_DROP_PER_OPENING = 0.3;

function mouthOf(row: RowSpec, pose: CatPose): Pt {
  if (row.view === 'side') return catMouthSide(pose);
  const mouth = catMouthFront(pose);
  return { x: mouth.x, y: mouth.y + pose.mouth * BITE_DROP_PER_OPENING };
}

function faceOf(row: RowSpec, pose: CatPose): { centre: Pt; radius: number } | null {
  if (row.view === 'back') return null;
  return row.view === 'side' ? catFaceSide(pose) : catFaceFront(pose);
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

function solve(row: RowSpec, frame: number): DonutSocketFrames {
  const pose = row.pose(frame);
  const grip = pose.grip;
  const axis = heldAxis(row, pose);
  const padNormal = westward(grip?.padNormal ?? PADS_TO_CAMERA, row.facesWest, true);
  const layer = layerUnder(grip?.under);
  const behindHer = grip?.under === 'body';
  const paws = forepaws(row, pose);
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
  const face = faceOf(row, pose);
  return {
    sockets: {
      mouth: socket(mouthOf(row, pose), carries),
      forePaw: socket(paws.butt, holdsHaft),
      back: {
        centre: placed(row, catSaddle(pose, row.view)),
        axis: LEVEL,
        palmNormal: PADS_TO_CAMERA,
        layer: CAT_SLABS.length - 1,
        occupied: false,
        shaded: false,
        behind: false,
      },
    },
    upperPaw: holdsHaft ? placed(row, paws.upper) : null,
    face:
      face === null
        ? null
        : { centre: placed(row, face.centre), radius: face.radius * CAT_CELL_PX_PER_POSE_UNIT },
  };
}

const framesByCell = new Map<string, DonutSocketFrames>();

/** Every socket of figure `figureId` on one frame of one of her rows, or null for a name that is no row of hers. */
export function donutSocketsAt(
  figureId: string,
  state: string,
  frame: number,
): DonutSocketFrames | null {
  const key = `${figureId}:${state}:${frame}`;
  const known = framesByCell.get(key);
  if (known !== undefined) return known;
  const row = catRowOf(state);
  if (row === undefined) return null;
  const found = solve(row, frame);
  framesByCell.set(key, found);
  return found;
}

/**
 * How she holds `look`, or null for a thing she cannot hold: a thing made to
 * be carried in the jaws she carries there, and the tools Carl swings in both
 * hands she swings with both forepaws on the haft.
 */
export function catGripOf(look: HeldVisualDef): DonutGripArchetype | null {
  if (look.archetype === 'mouthCarry') return 'mouthCarry';
  if (look.archetype === 'pawTool' || look.archetype === 'twoHandHaft') return 'pawTool';
  return null;
}

/** The socket `look` is held at on a frame, or null where it is not held there. */
export function catHeldSocketOf(
  look: HeldVisualDef,
  frames: DonutSocketFrames,
): CatSocketFrame | null {
  const grip = catGripOf(look);
  if (grip === null) return null;
  const socket = frames.sockets[GRIP_ARCHETYPES[grip].heldIn[0]];
  return socket.occupied ? socket : null;
}
