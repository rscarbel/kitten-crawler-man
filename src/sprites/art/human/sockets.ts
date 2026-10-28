/**
 * The human crawler's sockets: the named places on his figure a held or stowed thing
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
 * (`bipedHandSockets` in `biped/figure.ts`), so it cannot disagree with the
 * picture. Each is memoised per figure, row and frame: a cell's pose is
 * fixed, and the key space is bounded.
 *
 * The anchors that are not sockets live here too: where the Seismic Stomp heel lands
 * on a stamp row.
 */

import type { Vec3 } from '../../held/heldPaint';
import type { HumanSocket } from '../../held/gripArchetypes';
import type { Pt } from '../bipedArt';
import { type BipedHandSocket, type BipedHandSockets } from '../biped/figure';
import { buildSkeleton, drawnSide, poseAsDrawn, VIEWS, type BodySide } from '../biped/rig';
import { type ShownPlacement, stowedAxis, stowedCentre, stowedFlatFacing } from './stowedGeometry';
import {
  CHOP_ROWS,
  GROUND_OFFSET_IN_TILE,
  HUMAN_ROW_TABLE,
  type HumanFigurePainting,
  MINE_ROWS,
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
import { seismicStompHopStampSide, seismicStompStampPoint } from './stomps';
import { type HumanLook, type LookAxes, playerLookAxes } from '../../looks/humanLook';

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
  /**
   * Which way the business side of the head faces, unit, camera space: on a
   * blow, the way the head travels into the impact; otherwise down, and
   * forward in profile. A palm alone cannot say it — the same grip carries
   * an axe edge down at rest and swings it edge first — so it is decided
   * from the row rather than the hand.
   */
  readonly leading: Vec3;
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
export interface HumanSocketFrames {
  readonly sockets: Readonly<Record<HumanSocket, SocketFrame>>;
  /** On a two-handed haft, the hand socket holding its butt: the item's grip point is there. */
  readonly butt?: HumanSocket;
}

/** The figure a socket is read off: its id, for the memo, and how it paints a frame. */
export interface SocketSource {
  readonly id: string;
  readonly painting: HumanFigurePainting;
}

/** A figure-space point of a look as the cell paints it in a view, the look's own build applied. */
function toCell(p: Pt, axes: LookAxes): Pt {
  return {
    x: ORIGIN_X + p.x * HUMAN_CELL_PX_PER_UNIT * axes.x,
    y: ORIGIN_Y + p.y * HUMAN_CELL_PX_PER_UNIT * axes.y,
  };
}

function isUnstretched(axes: LookAxes): boolean {
  return axes.x === 1 && axes.y === 1 && axes.z === 1;
}

/**
 * A camera-space direction as the look's build stretches it: a direction
 * along the body scales with the body, a surface normal against it. An
 * unstretched direction is returned as it is, since renormalising a unit
 * vector can move its last bit and every cell drawn from it.
 */
function stretched(direction: Vec3, axes: LookAxes, kind: 'along' | 'normal'): Vec3 {
  if (isUnstretched(axes)) return direction;
  const scale = (value: number, axis: number): number =>
    kind === 'along' ? value * axis : value / axis;
  const x = scale(direction.x, axes.x);
  const y = scale(direction.y, axes.y);
  const z = scale(direction.z, axes.z);
  const length = Math.hypot(x, y, z);
  return length === 0 ? direction : { x: x / length, y: y / length, z: z / length };
}

/** Which way round the haft, on screen, the business side lies: 1 clockwise of the axis, −1 anticlockwise. */
type EdgeSide = 1 | -1;

const SCREEN_EPSILON = 1e-6;
/** At rest the business side faces down, and in profile as much forward again: an axe edge toward the floor ahead. */
const PROFILE_FORWARD_BIAS = 1;

/** The direction a side of `axis` faces on screen, a quarter turn from it. */
function sideOf(axis: Vec3, side: EdgeSide): Vec3 {
  const length = Math.hypot(axis.x, axis.y);
  if (length < SCREEN_EPSILON) return { x: 0, y: 1, z: 0 };
  return { x: (-side * axis.y) / length, y: (side * axis.x) / length, z: 0 };
}

/** The side of `axis` that faces down, and forward where he faces +X in profile. */
function restingSide(axis: Vec3, profile: boolean): EdgeSide {
  const forward = profile ? PROFILE_FORWARD_BIAS : 0;
  return axis.x - forward * axis.y >= 0 ? 1 : -1;
}

function handSocket(
  hand: BipedHandSocket,
  axes: LookAxes,
  side: EdgeSide | null,
  profile: boolean,
): SocketFrame {
  const axis = stretched(hand.axis, axes, 'along');
  return {
    centre: toCell(hand.centre, axes),
    axis,
    palmNormal: stretched(hand.palmNormal, axes, 'normal'),
    leading: sideOf(axis, side ?? restingSide(axis, profile)),
    layer: hand.layer,
    occupied: hand.occupant === 'item',
    grips: hand.occupant !== 'empty',
    shaded: hand.shaded,
    behind: hand.behind,
  };
}

/** The rearmost slab: behind everything he is. */
export const REARMOST_SOCKET_LAYER: SocketLayer = 0;

function stowedSockets(
  painting: HumanFigurePainting,
  row: RowSpec,
  frame: number,
  hands: BipedHandSockets,
): Pick<Record<HumanSocket, SocketFrame>, 'back' | 'hip'> {
  const spec = VIEWS[row.view];
  const axes = playerLookAxes(painting.look, spec.profile);
  const skeleton = buildSkeleton(poseAsDrawn(paintedPose(painting, row, frame), spec), spec);
  const stowed = (placement: ShownPlacement, overHim: boolean): SocketFrame => {
    const axis = stretched(stowedAxis(placement, row.view), axes, 'along');
    return {
      centre: toCell(stowedCentre(placement, row.view, skeleton), axes),
      axis,
      palmNormal: stretched(stowedFlatFacing(placement, row.view), axes, 'normal'),
      leading: sideOf(axis, restingSide(axis, spec.profile)),
      layer: overHim ? hands.frontLayer : REARMOST_SOCKET_LAYER,
      occupied: false,
      // Edge-on both places are on his far side, in his shadow.
      shaded: spec.profile,
      behind: !overHim,
    };
  };
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

const framesByCell = new Map<string, HumanSocketFrames>();
const strikeSideByRow = new Map<string, EdgeSide | null>();

/** The haft's angle on screen on one frame of a row, from the hand its item turns in. */
function haftAngleAt(source: SocketSource, row: RowSpec, frame: number): number {
  const spec = VIEWS[row.view];
  const hands = paintedHandSockets(source.painting, row, frame);
  const main = drawnSide('right', spec) === 'right' ? hands.right : hands.left;
  return Math.atan2(main.axis.y, main.axis.x);
}

/** The shorter turn from `from` to `to`, radians. */
function turnBetween(from: number, to: number): number {
  const turn = to - from;
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}

/** Tool swings and an armed set's own blows; a bare-handed blow thrown with something in hand does not swing it. */
const TOOL_SWING_ROWS: ReadonlySet<HumanRowName> = new Set([
  ...Object.values(CHOP_ROWS),
  ...Object.values(MINE_ROWS),
]);

function strikesWithWhatIsHeld(row: RowSpec): boolean {
  return row.motionSet !== undefined || TOOL_SWING_ROWS.has(row.name);
}

/**
 * The side of the haft a blow's business side lies on for the whole row: the
 * way the haft turns into its first impact. Held for every frame, so the
 * wind-up carries the edge trailing and the blow lands edge first, with no
 * roll of the head between frames. Null for a row that strikes nothing.
 */
function strikeSideOf(source: SocketSource, row: RowSpec): EdgeSide | null {
  const key = `${source.id}:${row.name}`;
  const known = strikeSideByRow.get(key);
  if (known !== undefined) return known;
  let side: EdgeSide | null = null;
  const hasImpact = row.impactFrames.length > 0;
  if (hasImpact && strikesWithWhatIsHeld(row)) {
    const impact = row.impactFrames[0];
    const before = Math.max(0, impact - 1);
    const after = Math.min(row.frameCount - 1, impact + 1);
    const into = turnBetween(haftAngleAt(source, row, before), haftAngleAt(source, row, impact));
    const through =
      Math.abs(into) > SCREEN_EPSILON
        ? into
        : turnBetween(haftAngleAt(source, row, impact), haftAngleAt(source, row, after));
    side = through >= 0 ? 1 : -1;
  }
  strikeSideByRow.set(key, side);
  return side;
}

/** Every socket of `source`'s figure on one frame of one row. */
export function humanSocketsAt(
  source: SocketSource,
  rowName: HumanRowName,
  frame: number,
): HumanSocketFrames {
  const key = `${source.id}:${rowName}:${frame}`;
  const known = framesByCell.get(key);
  if (known !== undefined) return known;
  const row: RowSpec = { name: rowName, ...HUMAN_ROW_TABLE[rowName] };
  const spec = VIEWS[row.view];
  const hands = paintedHandSockets(source.painting, row, frame);
  const axes = playerLookAxes(source.painting.look, spec.profile);
  const mainDrawn = drawnSide('right', spec);
  const main = mainDrawn === 'right' ? hands.right : hands.left;
  const off = mainDrawn === 'right' ? hands.left : hands.right;
  const butt = hands.twoHandButt;
  const strikeSide = strikeSideOf(source, row);
  const found: HumanSocketFrames = {
    sockets: {
      mainHand: handSocket(main, axes, strikeSide, spec.profile),
      offHand: handSocket(off, axes, strikeSide, spec.profile),
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
    leading: mirroredDirection(socket.leading),
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
 * Where a stamp row's heel lands on its impact frame for `look`, in tile
 * fractions from the sprite's own tile origin — the choreography's stamp
 * point, painted at `HUMAN_SCALE` of a tile about the ground line and
 * stretched by the look's build — or null on any row that is not a stamp.
 * The art gates re-measure it against the painted pose.
 */
export function stampAnchorOf(row: HumanRowMeta, look: HumanLook): Pt | null {
  if (row.role !== 'stomp') return null;
  const hop = row.locomotion === 'travelling';
  const side: BodySide =
    hop && row.entryFootPhase !== undefined
      ? seismicStompHopStampSide(row.entryFootPhase)
      : 'right';
  const point = seismicStompStampPoint(row.view, hop, side);
  const axes = playerLookAxes(look, VIEWS[row.view].profile);
  return {
    x: TILE_CENTRE_FRACTION + point.x * HUMAN_SCALE * axes.x,
    y: GROUND_OFFSET_IN_TILE + point.y * HUMAN_SCALE * axes.y,
  };
}
