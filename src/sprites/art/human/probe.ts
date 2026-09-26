/**
 * Where Carl's joints are on any frame of any row, in the pixels of the cell
 * that frame is baked into — for gates and review harnesses that need to
 * measure the rig itself rather than its ink.
 *
 * Everything here is read off the skeleton the painter solves and the landmark
 * helpers the painter draws with, so a probe can never disagree with the
 * picture it describes.
 */

import { type Pt } from '../carlArt';
import { footSoleLandmarks, LEFT_FOOT_OUT, RIGHT_FOOT_OUT } from '../carl/feet';
import { handGrip, handLength, wristAngle } from '../carl/limbs';
import { pt } from '../carl/geometry';
import {
  aheadScreenSign,
  type BodySide,
  type BoneChain,
  buildSkeleton,
  type CarlView,
  drawnSide,
  type GroundPoint,
  HEAD_ON_FLOOR_FORESHORTENING,
  LEG_MAX_REACH,
  poseAsDrawn,
  projectGroundPoint,
  VIEWS,
} from '../carl/rig';
import {
  HUMAN_ROW_TABLE,
  type HumanGait,
  type HumanRowMeta,
  type HumanRowName,
  ORIGIN_X,
  ORIGIN_Y,
  type StrikeReachLimb,
  TILE_X,
  TILE_Y,
} from '../humanFigure';
import { PLAYER_SPEED, TILE_SIZE } from '../../../core/constants';
import { HUMAN_SWING_FRAMES } from '../../../core/crawlerFormulas';
import { HUMAN_CELL_PX_PER_UNIT, mirroredTileX, TILE_SCALE } from './figureScale';
import { RUN_GROUND_PER_CYCLE_PX, WALK_GROUND_PER_CYCLE_PX } from './locomotion';
import { SMUSH_GROUND_PX_PER_FRAME } from './stomps';
import { RUN_FRAMES, WALK_FRAMES } from './timing';

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
  readonly view: CarlView;
  /** The ground line — the y his soles stand on — in cell pixels. */
  readonly groundY: number;
  /** Cell pixels per rig unit, for converting a rig-unit length. */
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

function toCell(p: Pt): Pt {
  return { x: ORIGIN_X + p.x * HUMAN_CELL_PX_PER_UNIT, y: ORIGIN_Y + p.y * HUMAN_CELL_PX_PER_UNIT };
}

/**
 * Cell-pixel height of the floor directly under a head-on ground point: the
 * same point dropped to the floor and drawn through the rig's own projection,
 * so the floor a sole is measured against is foreshortened exactly as the sole.
 */
function floorCellYUnder(point: GroundPoint, ahead: number): number {
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
): { heel: Pt; toe: Pt; heelGroundY: number; toeGroundY: number } {
  const offsets = footSoleLandmarks(pt(0, 0), pitch, VIEWS.side, RIGHT_FOOT_OUT);
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
    heelGroundY: floorCellYUnder(heel, ahead),
    toeGroundY: floorCellYUnder(toe, ahead),
  };
}

function probeLeg(
  chain: BoneChain,
  pitch: number,
  view: CarlView,
  outward: number,
  planted: boolean | undefined,
  point: number | undefined,
): ProbedLeg {
  const ahead = aheadScreenSign(VIEWS[view]);
  const sole =
    chain.groundEnd === undefined
      ? {
          ...mapSole(footSoleLandmarks(chain.end, pitch, VIEWS[view], outward, point)),
          heelGroundY: HUMAN_GROUND_Y,
          toeGroundY: HUMAN_GROUND_Y,
        }
      : headOnSole(chain.groundEnd, pitch, ahead);
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

function mapSole(sole: { heel: Pt; toe: Pt }): { heel: Pt; toe: Pt } {
  return { heel: toCell(sole.heel), toe: toCell(sole.toe) };
}

function probeArm(chain: BoneChain, fist: number): ProbedArm {
  const angle = wristAngle(chain);
  const reach = handLength(fist);
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
 * Solves Carl's rig for one frame of one row and reports his key joints in the
 * pixels of that frame's cell.
 *
 * Pure and deterministic in `(row, frame)`, like the painter it mirrors. The
 * frame is passed to the row's pose function as given, so `frameCount` itself
 * probes the frame a loop would play next.
 */
export function probeHumanJoints(row: HumanRowName, frame: number): HumanJointProbe {
  const spec = HUMAN_ROW_TABLE[row];
  const view = VIEWS[spec.view];
  const pose = poseAsDrawn(spec.pose(frame), view);
  const skeleton = buildSkeleton(pose, view);
  const drawnLeftLeg = probeLeg(
    skeleton.leftLeg,
    pose.leftFootPitch,
    spec.view,
    LEFT_FOOT_OUT,
    pose.leftFootPlanted,
    pose.leftFootPoint,
  );
  const drawnRightLeg = probeLeg(
    skeleton.rightLeg,
    pose.rightFootPitch,
    spec.view,
    RIGHT_FOOT_OUT,
    pose.rightFootPlanted,
    pose.rightFootPoint,
  );
  const drawnLeftArm = probeArm(skeleton.leftArm, pose.leftFist);
  const drawnRightArm = probeArm(skeleton.rightArm, pose.rightFist);
  // A mirrored view draws his right side from the pose's left fields; the
  // probe names each limb by his own side, whichever fields drew it.
  const mirrored = view.mirrored;
  return {
    view: spec.view,
    groundY: HUMAN_GROUND_Y,
    pixelsPerUnit: HUMAN_CELL_PX_PER_UNIT,
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
export const TRAVEL_DIRECTION: Readonly<Record<CarlView, Pt>> = {
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
 * World pixels of ground Carl covers while one frame of a row plays, at his
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
const FLOOR_SLIDE_SHARE: Readonly<Record<CarlView, number>> = {
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
export function standingHipAboveSolePx(tileSize: number): number {
  const standing = probeHumanJoints('idle', 0);
  return ((standing.groundY - standing.pelvis.y) * tileSize) / TILE_SCALE;
}

/** Which of his hands, by his own left and right. */
export type HumanHandSide = BodySide;

/**
 * Where a cell pixel lands, in fractions of his tile from the sprite's own
 * tile origin — the frame the runtime draws the cell in, scaled by whatever
 * tile size it is drawn at. A mirrored cell flips about the tile's centre, as
 * `drawFigureCached` flips it.
 */
function cellPointInTile(point: Pt, flipX: boolean): Pt {
  const x = (point.x - TILE_X) / TILE_SCALE;
  return {
    x: mirroredTileX(x, flipX),
    y: (point.y - TILE_Y) / TILE_SCALE,
  };
}

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
): Pt {
  const probe = probeHumanJoints(row, frame);
  const arm = side === 'left' ? probe.leftArm : probe.rightArm;
  return cellPointInTile(arm.handTip, flipX);
}

/**
 * Where a strike's own `reachLimb` lands on one drawn cell, in tile fractions
 * from the sprite's tile origin — a fist's knuckles, a boot's toe, a driven
 * knee, the lead shoulder of a barge — read off the same solved rig the
 * painter draws, so an impact effect starts from the limb the picture
 * actually threw rather than a fixed offset that only matches some strikes.
 */
export function strikeContactInTile(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
  reachLimb: StrikeReachLimb,
): Pt {
  const isLeft = reachLimb.startsWith('left');
  if (reachLimb === 'hand' || reachLimb === 'leftHand') {
    return handTipInTile(row, frame, flipX, isLeft ? 'left' : 'right');
  }
  const probe = probeHumanJoints(row, frame);
  if (reachLimb === 'shoulder') {
    // A profile-only blow; in profile his right arm is always the lead one.
    return cellPointInTile(probe.rightArm.shoulder, flipX);
  }
  const leg = isLeft ? probe.leftLeg : probe.rightLeg;
  const point = reachLimb === 'knee' || reachLimb === 'leftKnee' ? leg.knee : leg.toe;
  return cellPointInTile(point, flipX);
}

/** Where one of his fists closes round a haft on one drawn cell. */
interface HandGripInTile {
  /** The middle of the fist's bore, in tile fractions from the sprite's tile origin, mirrored with the cell. */
  readonly centre: Pt;
  /** Whether the row already puts a prop in that hand, painted inside the figure. */
  readonly holdsProp: boolean;
  /** Whether that arm is painted behind his torso in this cell. */
  readonly armBehind: boolean;
}

/**
 * Where one of his hands grips on one drawn cell — the bore a painted prop's
 * haft would run through, read off the same solved arm the painter draws — so
 * something drawn over the figure can sit in his fist wherever the row has
 * put it.
 */
export function handGripInTile(
  row: HumanRowName,
  frame: number,
  flipX: boolean,
  side: HumanHandSide,
): HandGripInTile {
  const spec = HUMAN_ROW_TABLE[row];
  const view = VIEWS[spec.view];
  const pose = poseAsDrawn(spec.pose(frame), view);
  const skeleton = buildSkeleton(pose, view);
  const drawn = drawnSide(side, view);
  const chain = drawn === 'left' ? skeleton.leftArm : skeleton.rightArm;
  const armFlaggedBehind = drawn === 'left' ? pose.leftArmBehind : pose.rightArmBehind;
  // In profile the left arm is always the far one: every profile row is
  // painted facing +X, and a mirrored cell only flips that picture.
  const farArmInProfile = view.profile && side === 'left';
  return {
    centre: cellPointInTile(toCell(handGrip(chain).centre), flipX),
    holdsProp: pose.heldProps?.some((prop) => prop.hand === drawn) ?? false,
    armBehind: farArmInProfile || armFlaggedBehind,
  };
}
