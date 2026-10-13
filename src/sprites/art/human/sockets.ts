/**
 * Carl's sockets: the named places on his figure a held or stowed thing
 * attaches to, published for every frame of every row.
 *
 * - `mainHand` — his right hand, `offHand` his left. Bound to the hand, not to
 *   the side of the screen: a mirrored cell shows the main hand on the far
 *   side, which is right for a right-handed man walking left.
 * - `back` — across his back, where a heavy or two-handed weapon rides stowed.
 * - `hip` — at his left hip, where a light one-hander hangs stowed.
 *
 * Where the stowed places sit on him is `stowedGeometry.ts`, shared with the
 * draw and stow rows that reach for them.
 *
 * A socket comes out of the same solve the painter composes him from
 * (`carlHandSockets` in `carl/figure.ts`), so it cannot disagree with the
 * picture. Each is memoised per figure, row and frame: a cell's pose is
 * fixed, and the key space is bounded.
 *
 * The anchors that are not sockets live here too: where the Smush heel lands
 * on a stamp row.
 */

import type { Vec3 } from '../../held/heldPaint';
import type { CarlSocket } from '../../held/gripArchetypes';
import type { Pt } from '../carlArt';
import { type CarlHandSocket, type CarlHandSockets } from '../carl/figure';
import { buildSkeleton, drawnSide, poseAsDrawn, VIEWS, type BodySide } from '../carl/rig';
import { type ShownPlacement, stowedAxis, stowedCentre } from './stowedGeometry';
import {
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  type HumanFigurePainting,
  type HumanRowMeta,
  type HumanRowName,
  ORIGIN_X,
  ORIGIN_Y,
  paintedHandSockets,
  paintedPose,
  type RowSpec,
  TILE_X,
  TILE_Y,
} from '../humanFigure';
import {
  HUMAN_CELL_PX_PER_UNIT,
  HUMAN_SCALE,
  mirroredTileX,
  TILE_CENTRE_FRACTION,
  TILE_SCALE,
} from './figureScale';
import { smushHopStampSide, smushStampPoint } from './stomps';

/** The index of the body slab a held thing sits directly in front of, 0 the rearmost. */
export type SocketLayer = number;

/** One socket on one frame. */
export interface SocketFrame {
  /** Where the held thing's grip point lands, in the pixels of the unmirrored cell. */
  readonly centre: Pt;
  /** The held thing's axis, butt to head, unit, camera space (x right, y down, z toward the camera). */
  readonly axis: Vec3;
  /** Which way the holding palm faces, unit, camera space. */
  readonly palmNormal: Vec3;
  readonly layer: SocketLayer;
  /**
   * Whether an equipment-chosen item is held here on this frame. False while
   * the hand is doing something else — holding the row's own prop, lighting a
   * fuse, open on a shove — and on a stowed socket.
   */
  readonly occupied: boolean;
  /**
   * A hand closed on anything at all on this frame: an equipment-chosen item
   * or the row's own prop. Absent is false.
   */
  readonly grips?: boolean;
  /** In a hand behind him in profile, lit as that arm is. */
  readonly shaded: boolean;
  /** On an arm painted behind his torso. */
  readonly behind: boolean;
}

/** Every socket on one frame. */
export interface CarlSocketFrames {
  readonly sockets: Readonly<Record<CarlSocket, SocketFrame>>;
  /** On a two-handed haft, the hand socket holding its butt: the item's grip point is there. */
  readonly butt?: CarlSocket;
}

/** The figure a socket is read off: its id, for the memo, and how it paints a frame. */
export interface SocketSource {
  readonly id: string;
  readonly painting: HumanFigurePainting;
}

function toCell(p: Pt): Pt {
  return { x: ORIGIN_X + p.x * HUMAN_CELL_PX_PER_UNIT, y: ORIGIN_Y + p.y * HUMAN_CELL_PX_PER_UNIT };
}

function handSocket(hand: CarlHandSocket): SocketFrame {
  return {
    centre: toCell(hand.centre),
    axis: hand.axis,
    palmNormal: hand.palmNormal,
    layer: hand.layer,
    occupied: hand.occupant === 'item',
    grips: hand.occupant !== 'empty',
    shaded: hand.shaded,
    behind: hand.behind,
  };
}

/** A stowed thing's flat lies against him, to the camera. */
const STOWED_FACING: Vec3 = { x: 0, y: 0, z: 1 };
/** The rearmost slab: behind everything he is. */
export const REARMOST_SOCKET_LAYER: SocketLayer = 0;

function stowedSockets(
  painting: HumanFigurePainting,
  row: RowSpec,
  frame: number,
  hands: CarlHandSockets,
): Pick<Record<CarlSocket, SocketFrame>, 'back' | 'hip'> {
  const spec = VIEWS[row.view];
  const skeleton = buildSkeleton(poseAsDrawn(paintedPose(painting, row, frame), spec), spec);
  const stowed = (placement: ShownPlacement, overHim: boolean): SocketFrame => ({
    centre: toCell(stowedCentre(placement, row.view, skeleton)),
    axis: stowedAxis(placement, row.view),
    palmNormal: STOWED_FACING,
    layer: overHim ? hands.frontLayer : REARMOST_SOCKET_LAYER,
    occupied: false,
    // Edge-on both places are on his far side, in his shadow.
    shaded: spec.profile,
    behind: !overHim,
  });
  // Seen from behind his back faces the camera, and a thing stowed on it lies
  // over him; from anywhere else it is behind him. His left hip is on the far
  // side edge-on, and hangs clear of him head-on and from behind. A garment
  // hanging over his back covers both places, and since it hides every part
  // of him a stowed thing could cross there, behind him is under it.
  const coveredFromBehind = spec.showsBack && hands.backCovered;
  return {
    back: stowed('back', spec.showsBack && !coveredFromBehind),
    hip: stowed('hip', !spec.profile && !coveredFromBehind),
  };
}

const framesByCell = new Map<string, CarlSocketFrames>();

/** Every socket of `source`'s figure on one frame of one row. */
export function carlSocketsAt(
  source: SocketSource,
  rowName: HumanRowName,
  frame: number,
): CarlSocketFrames {
  const key = `${source.id}:${rowName}:${frame}`;
  const known = framesByCell.get(key);
  if (known !== undefined) return known;
  const row: RowSpec = { name: rowName, ...HUMAN_ROW_TABLE[rowName] };
  const spec = VIEWS[row.view];
  const hands = paintedHandSockets(source.painting, row, frame);
  const mainDrawn = drawnSide('right', spec);
  const main = mainDrawn === 'right' ? hands.right : hands.left;
  const off = mainDrawn === 'right' ? hands.left : hands.right;
  const butt = hands.twoHandButt;
  const found: CarlSocketFrames = {
    sockets: {
      mainHand: handSocket(main),
      offHand: handSocket(off),
      ...stowedSockets(source.painting, row, frame, hands),
    },
    ...(butt === undefined ? {} : { butt: butt === mainDrawn ? 'mainHand' : 'offHand' }),
  };
  framesByCell.set(key, found);
  return found;
}

/** The cell pixel column a mirrored cell flips about: his tile's centre. */
const MIRROR_AXIS_X = TILE_X + TILE_SCALE * TILE_CENTRE_FRACTION;

function mirroredDirection(direction: Vec3): Vec3 {
  return { x: -direction.x, y: direction.y, z: direction.z };
}

/**
 * A socket as a cell drawn mirrored shows it: reflected about his tile's
 * centre, its directions reflected with it. The hand it belongs to is
 * unchanged — a mirrored cell's main hand is still his right.
 */
export function mirroredSocket(socket: SocketFrame, flipX: boolean): SocketFrame {
  if (!flipX) return socket;
  return {
    ...socket,
    centre: { x: 2 * MIRROR_AXIS_X - socket.centre.x, y: socket.centre.y },
    axis: mirroredDirection(socket.axis),
    palmNormal: mirroredDirection(socket.palmNormal),
  };
}

/** A cell pixel as a fraction of his tile from the sprite's own tile origin, mirrored with the cell. */
export function cellPointInTile(point: Pt, flipX: boolean): Pt {
  return {
    x: mirroredTileX((point.x - TILE_X) / TILE_SCALE, flipX),
    y: (point.y - TILE_Y) / TILE_SCALE,
  };
}

/**
 * Where a stamp row's heel lands on its impact frame, in tile fractions from
 * the sprite's own tile origin — the choreography's stamp point, painted at
 * `HUMAN_SCALE` of a tile about the ground line — or null on any row that is
 * not a stamp. The art gates re-measure it against the painted pose.
 */
export function stampAnchorOf(row: HumanRowMeta): Pt | null {
  if (row.role !== 'stomp') return null;
  const hop = row.locomotion === 'travelling';
  const side: BodySide =
    hop && row.entryFootPhase !== undefined ? smushHopStampSide(row.entryFootPhase) : 'right';
  const point = smushStampPoint(row.view, hop, side);
  return {
    x: TILE_CENTRE_FRACTION + point.x * HUMAN_SCALE,
    y: GROUND_OFFSET_IN_TILE + point.y * HUMAN_SCALE,
  };
}
