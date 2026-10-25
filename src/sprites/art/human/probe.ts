/**
 * Where the human's joints are on any frame of any row, in the pixels of the cell
 * that frame is baked into — for gates and review harnesses that need to
 * measure the rig itself rather than its ink.
 *
 * Everything here is read off the skeleton the painter solves and the landmark
 * helpers the painter draws with, so a probe can never disagree with the
 * picture it describes.
 */

import { type Pt } from '../bipedArt';
import { footSoleLandmarks, LEFT_FOOT_OUT, RIGHT_FOOT_OUT } from '../biped/feet';
import { handLength, RIG_LIMBS, wristAngle } from '../biped/limbs';
import { pt, rotate } from '../biped/geometry';
import { headAngle, mouthInHeadFrame, scaledHeadPoint } from '../biped/head';
import {
  aheadScreenSign,
  type BodySide,
  type BoneChain,
  buildSkeleton,
  type GroundPoint,
  type HandShape,
  HEAD_ON_FLOOR_FORESHORTENING,
  LEG_MAX_REACH,
  poseAsDrawn,
  projectGroundPoint,
  VIEWS,
} from '../biped/rig';
import { type CardinalView } from '../../facingView';
import {
  HUMAN_ROW_TABLE,
  type HumanGait,
  type HumanRowMeta,
  type HumanRowName,
  ORIGIN_X,
  ORIGIN_Y,
  type StrikeReachLimb,
} from '../humanFigure';
import { PLAYER_SPEED, TILE_SIZE } from '../../../core/constants';
import { HUMAN_SWING_FRAMES } from '../../../core/crawlerFormulas';
import { HUMAN_CELL_PX_PER_UNIT, TILE_SCALE } from './figureScale';
import { RUN_GROUND_PER_CYCLE_PX, WALK_GROUND_PER_CYCLE_PX } from './locomotion';
import { SMUSH_GROUND_PX_PER_FRAME } from './stomps';
import { RUN_FRAMES, WALK_FRAMES } from './timing';
import { cellPointInTile } from './sockets';
import { weaponTip } from './weaponReach';
import { type HumanLook, playerLookAxes, withLookBuild } from '../../looks/humanLook';

/** One leg, solved. Points are cell pixels; reach figures are rig units. */
export interface ProbedLeg {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  /** The heel end of the sole line. */
  readonly heel: Pt;
  /** The toe end of the sole line. */
  readonly toe: Pt;
  /** Hip→ankle distance the pose asked this leg for, in rig units. */
  readonly reachDemand: number;
  /** The furthest the leg's IK reaches, in rig units: `THIGH + SHIN − JOINT_SLACK`. */
  readonly reachLimit: number;
  /** True when the IK clamped the leg because the pose asked for more than it spans. */
  readonly clamped: boolean;
  /**
   * The screen height, in cell pixels, of the floor directly under the heel
   * and under the toe. In profile both are the ground line; head-on the floor
   * ahead of him runs up or down the screen, so a foot a stride ahead stands
   * on a different line from one under the hips.
   */
  readonly heelGroundY: number;
  readonly toeGroundY: number;
  /**
   * Whether the choreography has this foot bearing weight, when the row says
   * so; absent leaves it to the sole landmarks' heights over their floor.
   */
  readonly planted?: boolean;
  /**
   * Head-on only: where the ankle would draw if the floor's depth showed on
   * the screen not at all — the leg seen as an upright figure alone, with its
   * height and its sideways offset but none of its reach ahead or behind.
   * Against {@link ankle} it measures how much the floor's projection
   * stretches or shortens the drawn leg.
   */
  readonly uprightAnkle?: Pt;
}

/** One arm, solved, in cell pixels. */
export interface ProbedArm {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly wrist: Pt;
  /** The end of the hand past the wrist, open or fisted as the pose has it. */
  readonly handTip: Pt;
}

/**
 * Probed points are always the unmirrored cell, which profile rows paint
 * facing +X, whether or not the runtime mirrors the row for a −X facing.
 */
export interface HumanJointProbe {
  readonly view: CardinalView;
  /** The ground line — the y his soles stand on — in cell pixels. */
  readonly groundY: number;
  /** Cell pixels per rig unit down the cell, for converting a rig-unit height. */
  readonly pixelsPerUnit: number;
  /** Centre of the pelvis. */
  readonly pelvis: Pt;
  readonly headCentre: Pt;
  readonly leftLeg: ProbedLeg;
  readonly rightLeg: ProbedLeg;
  readonly leftArm: ProbedArm;
  readonly rightArm: ProbedArm;
}

/** The ground line in cell pixels: where the pose's origin, between his feet, is painted. */
export const HUMAN_GROUND_Y = ORIGIN_Y;

/** Figure space to the pixels of one look's cell in one view. */
type CellMap = (p: Pt) => Pt;

function cellMapOf(look: HumanLook, view: CardinalView): CellMap {
  const axes = playerLookAxes(look, VIEWS[view].profile);
  const across = HUMAN_CELL_PX_PER_UNIT * axes.x;
  const down = HUMAN_CELL_PX_PER_UNIT * axes.y;
  return (p) => ({ x: ORIGIN_X + p.x * across, y: ORIGIN_Y + p.y * down });
}

/**
 * Cell-pixel height of the floor directly under a head-on ground point: the
 * same point dropped to the floor and drawn through the rig's own projection,
 * so the floor a sole is measured against is foreshortened exactly as the sole.
 */
function floorCellYUnder(point: GroundPoint, ahead: number, toCell: CellMap): number {
  return toCell(projectGroundPoint({ ...point, height: 0 }, ahead)).y;
}

/**
 * Where a head-on foot's sole really touches down: the side-on heel and toe
 * offsets at its pitch, set out from the ankle along the way he faces and drawn
 * through the rig's own depth projection. A head-on foot is painted as a blob
 * at the ankle, which cannot show a pitch; the landmarks here are the foot the
 * rig solved, which is what bears weight.
 */
function headOnSole(
  end: GroundPoint,
  pitch: number,
  ahead: number,
  toCell: CellMap,
): { heel: Pt; toe: Pt; heelGroundY: number; toeGroundY: number } {
  // Head-on a look's build narrows the foot across the picture and leaves its
  // length into it the rig's, so the sole the rig solved is the one it stands on.
  const offsets = footSoleLandmarks(pt(0, 0), pitch, VIEWS.side, RIGHT_FOOT_OUT, RIG_LIMBS);
  const landmark = (offset: Pt): GroundPoint => ({
    x: end.x,
    height: end.height - offset.y,
    depth: end.depth + offset.x,
  });
  const heel = landmark(offsets.heel);
  const toe = landmark(offsets.toe);
  return {
    heel: toCell(projectGroundPoint(heel, ahead)),
    toe: toCell(projectGroundPoint(toe, ahead)),
    heelGroundY: floorCellYUnder(heel, ahead, toCell),
    toeGroundY: floorCellYUnder(toe, ahead, toCell),
  };
}

function probeLeg(
  chain: BoneChain,
  pitch: number,
  view: CardinalView,
  outward: number,
  planted: boolean | undefined,
  point: number | undefined,
  toCell: CellMap,
): ProbedLeg {
  // The rows roll every look's foot on the rig's sole (`soleOffsets`), so the
  // sole a planted foot is held to is the rig's.
  const ahead = aheadScreenSign(VIEWS[view]);
  const sole =
    chain.groundEnd === undefined
      ? {
          ...mapSole(
            footSoleLandmarks(chain.end, pitch, VIEWS[view], outward, RIG_LIMBS, point),
            toCell,
          ),
          heelGroundY: HUMAN_GROUND_Y,
          toeGroundY: HUMAN_GROUND_Y,
        }
      : headOnSole(chain.groundEnd, pitch, ahead, toCell);
  const upright =
    chain.groundEnd === undefined
      ? {}
      : { uprightAnkle: toCell(pt(chain.groundEnd.x, -chain.groundEnd.height)) };
  const leg = {
    ...upright,
    hip: toCell(chain.root),
    knee: toCell(chain.joint),
    ankle: toCell(chain.end),
    heel: sole.heel,
    toe: sole.toe,
    reachDemand: chain.demand,
    reachLimit: LEG_MAX_REACH,
    clamped: chain.clamped,
    heelGroundY: sole.heelGroundY,
    toeGroundY: sole.toeGroundY,
  };
  return planted === undefined ? leg : { ...leg, planted };
}

function mapSole(sole: { heel: Pt; toe: Pt }, toCell: CellMap): { heel: Pt; toe: Pt } {
  return { heel: toCell(sole.heel), toe: toCell(sole.toe) };
}

function probeArm(
  chain: BoneChain,
  fist: number,
  shape: HandShape | undefined,
  look: HumanLook,
  toCell: CellMap,
): ProbedArm {
  const angle = wristAngle(chain);
  const reach = handLength(fist, shape ?? 'relaxed', look.limbs);
  const tip = {
    x: chain.end.x + Math.cos(angle) * reach,
    y: chain.end.y + Math.sin(angle) * reach,
  };
  return {
    shoulder: toCell(chain.root),
    elbow: toCell(chain.joint),
    wrist: toCell(chain.end),
    handTip: toCell(tip),
  };
}

/**
 * Solves the biped rig for one frame of one of the human's rows and reports his
 * key joints in the pixels of that frame's cell.
 *
 * Pure and deterministic in `(row, frame)`, like the painter it mirrors. The
 * frame is passed to the row's pose function as given, so `frameCount` itself
 * probes the frame a loop would play next. Measured in `look`'s cell.
 */
export function probeHumanJoints(
  row: HumanRowName,
  frame: number,
  look: HumanLook,
): HumanJointProbe {
  const spec = HUMAN_ROW_TABLE[row];
  const toCell = cellMapOf(look, spec.view);
  const view = VIEWS[spec.view];
  const pose = poseAsDrawn(withLookBuild(spec.pose(frame), look), view);
  const skeleton = buildSkeleton(pose, view);
  const drawnLeftLeg = probeLeg(
    skeleton.leftLeg,
    pose.leftFootPitch,
    spec.view,
    LEFT_FOOT_OUT,
    pose.leftFootPlanted,
    pose.leftFootPoint,
    toCell,
  );
  const drawnRightLeg = probeLeg(
    skeleton.rightLeg,
    pose.rightFootPitch,
    spec.view,
    RIGHT_FOOT_OUT,
    pose.rightFootPlanted,
    pose.rightFootPoint,
    toCell,
  );
  const drawnLeftArm = probeArm(skeleton.leftArm, pose.leftFist, pose.leftHandShape, look, toCell);
  const drawnRightArm = probeArm(
    skeleton.rightArm,
    pose.rightFist,
    pose.rightHandShape,
    look,
    toCell,
  );
  // A mirrored view draws his right side from the pose's left fields; the
  // probe names each limb by his own side, whichever fields drew it.
  const mirrored = view.mirrored;
  return {
    view: spec.view,
    groundY: HUMAN_GROUND_Y,
    pixelsPerUnit: HUMAN_CELL_PX_PER_UNIT * playerLookAxes(look, view.profile).y,
    pelvis: toCell(skeleton.hip),
    headCentre: toCell(skeleton.headCentre),
    leftLeg: mirrored ? drawnRightLeg : drawnLeftLeg,
    rightLeg: mirrored ? drawnLeftLeg : drawnRightLeg,
    leftArm: mirrored ? drawnRightArm : drawnLeftArm,
    rightArm: mirrored ? drawnLeftArm : drawnRightArm,
  };
}

/**
 * The screen direction a row's sprite is carried in while it plays: profile
 * rows are painted facing +X; toward the camera he travels down the screen,
 * and away from it up.
 */
export const TRAVEL_DIRECTION: Readonly<Record<CardinalView, Pt>> = {
  side: { x: 1, y: 0 },
  front: { x: 0, y: 1 },
  back: { x: 0, y: -1 },
};

/** Cell pixels per world pixel: the cell paints a tile at `TILE_SCALE`, the world at `TILE_SIZE`. */
const CELL_PX_PER_WORLD_PX = TILE_SCALE / TILE_SIZE;

/** World pixels of ground one run frame covers: the stride the run's planted foot sweeps per frame. */
const RUN_GROUND_PX_PER_FRAME = RUN_GROUND_PER_CYCLE_PX / RUN_FRAMES;
/** World pixels of ground one walk frame covers. */
const WALK_GROUND_PX_PER_FRAME = WALK_GROUND_PER_CYCLE_PX / WALK_FRAMES;

/**
 * World pixels of ground the human covers while one frame of a row plays, at his
 * base speed — the one derivation both the animator (which paces a run's
 * start by it) and every gate and review image (which carry a planted foot's
 * ground position by it) read.
 *
 * - A locomotion cycle's phase is paced by ground covered, so one of its
 *   frames is its gait's cycle of ground over its frame count.
 * - A strike thrown on the move is played off the swing's timer, so each of
 *   its frames lasts its share of the swing's ticks at base speed.
 * - A Smush hop is played off the Smush's own timer, the same way.
 * - A start is paced by ground, one frame of its gait's cycle per frame: its
 *   planted foot is the gait's own, carried back a cycle frame at a time.
 *
 * A row that does not travel covers none.
 */
export function groundPxPerFrame(row: HumanRowName): number {
  const spec: HumanRowMeta = HUMAN_ROW_TABLE[row];
  if (spec.locomotion !== 'travelling') return 0;
  if (spec.role === 'stomp') return SMUSH_GROUND_PX_PER_FRAME;
  if (spec.role === 'strike') return (HUMAN_SWING_FRAMES / spec.frameCount) * PLAYER_SPEED;
  if (spec.gait !== undefined) return groundPxPerGaitFrame(spec.gait, spec.frameCount);
  if (spec.bridges === 'walk') return WALK_GROUND_PX_PER_FRAME;
  return RUN_GROUND_PX_PER_FRAME;
}

/** World pixels of ground covered while one frame of a `frameCount`-frame gait cycle plays. */
export function groundPxPerGaitFrame(gait: HumanGait, frameCount: number): number {
  const groundPerCycle = gait === 'run' ? RUN_GROUND_PER_CYCLE_PX : WALK_GROUND_PER_CYCLE_PX;
  return groundPerCycle / frameCount;
}

/**
 * How much of the ground he covers a planted foot slides back through the cell
 * in each view. In profile the floor runs across the screen and a foot on it
 * slides the full distance. Head-on the floor runs up the screen, and the
 * figure draws it at {@link HEAD_ON_FLOOR_FORESHORTENING} of its depth, so a
 * planted foot slides that share: the rest is carried by the hips with the
 * sprite, and the leg between them keeps its length.
 */
const FLOOR_SLIDE_SHARE: Readonly<Record<CardinalView, number>> = {
  side: 1,
  front: HEAD_ON_FLOOR_FORESHORTENING,
  back: HEAD_ON_FLOOR_FORESHORTENING,
};

/**
 * How far the floor under him moves back through the cell between two frames
 * of a row, in cell pixels, against {@link TRAVEL_DIRECTION}: the ground the
 * sprite covers ({@link groundPxPerFrame}) at the cell's scale, drawn as the
 * row's view draws the floor. A planted foot has to slide back by exactly
 * this much to hold its place on the floor.
 */
export function floorDriftPerFrameCellPx(row: HumanRowName): number {
  const share = FLOOR_SLIDE_SHARE[HUMAN_ROW_TABLE[row].view];
  return groundPxPerFrame(row) * CELL_PX_PER_WORLD_PX * share;
}

/**
 * How far his hip joint stands above his soles in his relaxed front idle, in
 * screen pixels at a `tileSize`-pixel tile: where a waist-deep waterline
 * crosses him.
 */
export function standingHipAboveSolePx(tileSize: number, look: HumanLook): number {
  const standing = probeHumanJoints('idle', 0, look);
  return ((standing.groundY - standing.pelvis.y) * tileSize) / TILE_SCALE;
}

/** Which of his hands, by his own left and right. */
export type HumanHandSide = BodySide;

/**
 * The tip of one of his hands — a fist's knuckles, an open hand's fingertips —
 * on one drawn cell, in tile fractions from the sprite's tile origin: where a
 * thrown thing leaves his hand or a held tool meets what it works on.
 */
export function handTipInTile(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
  side: HumanHandSide,
  look: HumanLook,
): Pt {
  const probe = probeHumanJoints(row, frame, look);
  const arm = side === 'left' ? probe.leftArm : probe.rightArm;
  return cellPointInTile(arm.handTip, flipX);
}

/**
 * Where a strike's own `reachLimb` lands on one drawn cell, in tile fractions
 * from the sprite's tile origin — a fist's knuckles, a boot's toe, a driven
 * knee, the lead shoulder of a barge, a weapon out past the fist — read off the same solved rig the
 * painter draws, so an impact effect starts from the limb the picture
 * actually threw rather than a fixed offset that only matches some strikes.
 */
export function strikeContactInTile(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
  reachLimb: StrikeReachLimb,
  look: HumanLook,
): Pt {
  const isLeft = reachLimb.startsWith('left');
  if (reachLimb === 'weapon') {
    const spec = HUMAN_ROW_TABLE[row];
    const tip = weaponTip(withLookBuild(spec.pose(frame), look), spec.view, look);
    return cellPointInTile(cellMapOf(look, spec.view)(pt(tip.x, tip.y)), flipX);
  }
  if (reachLimb === 'hand' || reachLimb === 'leftHand') {
    return handTipInTile(row, frame, flipX, isLeft ? 'left' : 'right', look);
  }
  const probe = probeHumanJoints(row, frame, look);
  if (reachLimb === 'shoulder') {
    // A profile-only blow; in profile his right arm is always the lead one.
    return cellPointInTile(probe.rightArm.shoulder, flipX);
  }
  const leg = isLeft ? probe.leftLeg : probe.rightLeg;
  const point = reachLimb === 'knee' || reachLimb === 'leftKnee' ? leg.knee : leg.toe;
  return cellPointInTile(point, flipX);
}

/**
 * Where his mouth is painted on one drawn cell, in tile fractions from the
 * sprite's tile origin, mirrored with the cell; null when the cell shows the
 * back of his head.
 */
export function mouthInTile(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
  look: HumanLook,
): Pt | null {
  const spec = HUMAN_ROW_TABLE[row];
  const view = VIEWS[spec.view];
  const pose = poseAsDrawn(withLookBuild(spec.pose(frame), look), view);
  const mouth = mouthInHeadFrame(pose, view);
  if (mouth === null) return null;
  const skeleton = buildSkeleton(pose, view);
  const turned = rotate(scaledHeadPoint(mouth, look), headAngle(pose));
  const inFigure = pt(skeleton.headCentre.x + turned.x, skeleton.headCentre.y + turned.y);
  return cellPointInTile(cellMapOf(look, spec.view)(inFigure), flipX);
}
