/**
 * Carl doing things between fights: casting Protective Shell, drinking a
 * potion, picking something up, heaving open a chest, and talking.
 *
 * Every one-shot here starts and ends on the idle's first frame in its view,
 * so the animator can drop it into standing and take it back out without a
 * pop. The talking loop starts there too and closes back on it, so a
 * conversation can begin and end on any loop seam.
 *
 * Hands are placed by target (the IK reaches for them) except where a head-on
 * forearm has to come up toward the camera, which only joint angles can draw:
 * solved in the picture plane, a hand raised in front of the chest drags the
 * elbow out sideways into a chicken wing.
 */

import { mixPt, pt } from '../carl/geometry';
import { handGrip } from '../carl/limbs';
import {
  type ArmAngles,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  FULL_UPPER_ARM,
  type HandShape,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { deg, lerp, type Pt } from '../carlArt';
import {
  facingArmAngles,
  fromRest,
  LEFT_ARM,
  offsetTrack,
  type PathKey,
  RIGHT_ARM,
  type Track,
  trackAt,
} from './gaitShared';
import { idleBack, idleFront, idleSide } from './idles';
import { HUMAN_SCALE } from './figureScale';

// ── Row lengths and timing ───────────────────────────────────────────────────

/**
 * The cast: a gather, the drive down, a two-frame press into the floor, and
 * the rise. Fast, because the dome it raises is a defence thrown in the middle
 * of a fight — the hand reaches the floor two frames (eight ticks) after the
 * key.
 */
export const SHELL_CAST_FRAMES = 8;
export const SHELL_CAST_TICKS_PER_FRAME = 4;
/** The frame his palm meets the dome's centre: the dome is raised here. */
export const SHELL_CAST_FRAME = 2;

/**
 * Bottle up, three swallows with the head back, bottle down, a wipe of the
 * mouth, hands down: a little over a second, the length of a real swig.
 */
export const DRINK_FRAMES = 12;
export const DRINK_TICKS_PER_FRAME = 6;

/**
 * A dip and a snatch, over in a third of a second: a pickup is picked up
 * whether or not he stoops, so the stoop must not hold him up.
 */
export const GRAB_FRAMES = 6;
export const GRAB_TICKS_PER_FRAME = 3;

/** Squat, grip the lid, heave it up and over, look in, stand. */
export const CHEST_OPEN_FRAMES = 10;
export const CHEST_OPEN_TICKS_PER_FRAME = 5;
/** The frame the lid comes up past his chest: what is inside is shown from here. */
export const CHEST_LID_UP_FRAME = 5;

/**
 * One loop of talking: a gesture with the right hand, a smaller one with the
 * left, the mouth working through it. A frame every eight ticks keeps a mouth
 * shape up long enough to be seen as a syllable, not as a flicker.
 */
export const TALK_FRAMES = 12;
export const TALK_TICKS_PER_FRAME = 8;

// ── Shared machinery ─────────────────────────────────────────────────────────

/** A hand's path in figure space, keyed per frame, leaving from and returning to the seam's wrist. */
interface HandPath {
  readonly x: Track;
  readonly y: Track;
}

function handPath(seam: Pt, last: number, keys: readonly (readonly [number, Pt])[]): HandPath {
  return {
    x: fromRest(
      seam.x,
      last,
      keys.map(([frame, p]): PathKey => [frame, p.x]),
    ),
    y: fromRest(
      seam.y,
      last,
      keys.map(([frame, p]): PathKey => [frame, p.y]),
    ),
  };
}

function handAt(frame: number, path: HandPath): Pt {
  return pt(trackAt(frame, path.x), trackAt(frame, path.y));
}

/** The idle frame every row here leaves from and returns to. */
function seamPose(view: CarlView): CarlPose {
  if (view === 'front') return idleFront(0);
  if (view === 'back') return idleBack(0);
  return idleSide(0);
}

interface SeamWrists {
  readonly left: Pt;
  readonly right: Pt;
}

/** Where the wrists hang on the seam frame, solved from the rig so a path starts exactly there. */
function seamWrists(view: CarlView): SeamWrists {
  const skeleton = buildSkeleton(seamPose(view), VIEWS[view]);
  return { left: skeleton.leftArm.end, right: skeleton.rightArm.end };
}

const SEAM_WRISTS: Readonly<Record<CarlView, SeamWrists>> = {
  front: seamWrists('front'),
  side: seamWrists('side'),
  back: seamWrists('back'),
};

/** Whether a frame is a seam frame, which is the idle's own pose and is left untouched. */
function isSeam(frame: number, last: number): boolean {
  return frame <= 0 || frame >= last;
}

/** Hands both arms to their target paths, dropping the seam's joint angles. */
function placeHands(pose: CarlPose, frame: number, right: HandPath, left: HandPath): void {
  pose.rightArmAngles = null;
  pose.leftArmAngles = null;
  pose.rightHand = handAt(frame, right);
  pose.leftHand = handAt(frame, left);
}

/** Squatting head-on, the knees spread over the feet rather than bowing at the camera. */
const SQUAT_FORESHORTEN = 0.9;
/** A folded thigh points at the camera: short and wide rather than a leg bowed sideways. */
const SQUAT_THIGH_NEARNESS = 0.9;

/** Head-on legs for a crouch of `crouch`: a column standing, a squat folded. */
function squatLegs(pose: CarlPose, crouch: number): void {
  const fold = Math.min(1, crouch * 2);
  pose.leftForeshorten = lerp(pose.leftForeshorten, SQUAT_FORESHORTEN, fold);
  pose.rightForeshorten = pose.leftForeshorten;
  pose.leftLegNearness = SQUAT_THIGH_NEARNESS * Math.min(1, crouch);
  pose.rightLegNearness = pose.leftLegNearness;
}

/**
 * Edge-on the head does not ride the spine's lean on its own, so a man bent
 * over at the hips is drawn with his face still level — which, against a
 * torso tipped toward the floor, reads as his chin thrown up. Stooping, the
 * head tips down with the spine by this share of its lean, eyes on the floor.
 */
const STOOP_HEAD_FOLLOWS_SPINE = 0.7;

/** Both feet stay where the idle put them: none of these rows takes a step. */
function plantFeet(pose: CarlPose): void {
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = true;
}

/**
 * A head-on forearm brought up in front of the body, by joint angles: the
 * upper arm tilted out from hanging by `upperOut`, the forearm turned in and
 * up by `foreUp` (a half turn points straight up) and drawn at `foreScale` of
 * its length, the share left once it has turned toward the camera.
 */
function raisedArm(side: number, upperOut: number, foreUp: number, foreScale: number): ArmAngles {
  const hanging = facingArmAngles(side, 0, 0, 0);
  return {
    upper: hanging.upper + side * upperOut,
    fore: -side * foreUp,
    foreScale,
  };
}

/** Keys of a head-on raised arm: how far out the upper arm, how far up the forearm, how long it draws. */
interface RaisedKey {
  readonly out: number;
  readonly up: number;
  readonly scale: number;
  /**
   * The upper arm's drawn share of its length, for an elbow brought forward
   * at the camera; absent is the full length, the elbow at his side.
   */
  readonly upperScale?: number;
}

/** Joint-angle paths for a head-on raised arm, from and back to the seam's hanging arm. */
interface RaisedPath {
  readonly out: Track;
  readonly up: Track;
  readonly scale: Track;
  readonly upperScale: Track;
}

function raisedPath(
  side: number,
  last: number,
  keys: readonly (readonly [number, RaisedKey])[],
): RaisedPath {
  const hanging = facingArmAngles(side, 0, 0, 0);
  const restUp = -side * hanging.fore;
  return {
    out: fromRest(
      0,
      last,
      keys.map(([frame, key]): PathKey => [frame, key.out]),
    ),
    up: fromRest(
      restUp,
      last,
      keys.map(([frame, key]): PathKey => [frame, key.up]),
    ),
    scale: fromRest(
      hanging.foreScale,
      last,
      keys.map(([frame, key]): PathKey => [frame, key.scale]),
    ),
    upperScale: fromRest(
      FULL_UPPER_ARM,
      last,
      keys.map(([frame, key]): PathKey => [frame, key.upperScale ?? FULL_UPPER_ARM]),
    ),
  };
}

/** Poses one head-on arm where its raise path has it at `frame`. */
function raiseArm(pose: CarlPose, side: number, frame: number, path: RaisedPath): void {
  const angles = raisedArm(
    side,
    trackAt(frame, path.out),
    trackAt(frame, path.up),
    trackAt(frame, path.scale),
  );
  setArmAngles(
    pose,
    side === RIGHT_ARM ? 'right' : 'left',
    angles,
    trackAt(frame, path.upperScale),
  );
}

/**
 * The `angle` a held prop needs for its long axis (base to neck, for the
 * bottle) to point along `aim` — an absolute figure-space angle — given the
 * way the gripping hand holds it in this pose. Measured off the solved chain,
 * because the grip's own haft angle follows the forearm and the wrist.
 */
function propAngleFor(pose: CarlPose, view: CarlView, hand: 'left' | 'right', aim: number): number {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const chain = hand === 'right' ? skeleton.rightArm : skeleton.leftArm;
  return aim - handGrip(chain).haftAngle;
}

/** A mouth shape: how far the lips part and how wide they stretch, 1 being the resting width. */
interface MouthShape {
  readonly open: number;
  readonly width: number;
}

const MOUTH_SHUT: MouthShape = { open: 0, width: 1 };

// ── Protective Shell ─────────────────────────────────────────────────────────

const SHELL_LAST = SHELL_CAST_FRAMES - 1;

/**
 * The dome is centred on the middle of his tile, which stands this far above
 * the floor he stands on. The cast drives the right palm as near that point as
 * a crouch lets it reach, so the dome visibly comes out of his hand.
 */
const TILE_CENTRE_ABOVE_GROUND_TILES = 0.4;
const DOME_CENTRE_Y = -TILE_CENTRE_ABOVE_GROUND_TILES / HUMAN_SCALE;

/** He sinks as he gathers it, so the drive's drop is split over two frames. */
const SHELL_CROUCH: Track = offsetTrack(SHELL_LAST, [
  [1, 0.3],
  [SHELL_CAST_FRAME, 0.55],
  [3, 0.62],
  [4, 0.58],
  [5, 0.3],
  [6, 0.08],
]);
/** His weight drops into the drive and settles a frame after the palm lands. */
const SHELL_BOB: Track = offsetTrack(SHELL_LAST, [
  [1, 0.004],
  [SHELL_CAST_FRAME, 0.01],
  [3, 0.018],
  [4, 0.012],
  [5, 0.004],
]);
const SHELL_CHIN: Track = offsetTrack(SHELL_LAST, [
  [1, -0.3],
  [SHELL_CAST_FRAME, -0.75],
  [3, -0.8],
  [4, -0.7],
  [5, -0.35],
]);
const SHELL_MOUTH: Track = offsetTrack(SHELL_LAST, [
  [1, 0.05],
  [SHELL_CAST_FRAME, 0.55],
  [3, 0.35],
  [4, 0.15],
]);
const SHELL_JACKET: Track = offsetTrack(SHELL_LAST, [
  [SHELL_CAST_FRAME, 0.45],
  [3, 0.3],
  [4, 0.15],
]);
const SHELL_HAIR: Track = offsetTrack(SHELL_LAST, [
  [1, -0.2],
  [SHELL_CAST_FRAME, 0.45],
  [3, 0.2],
]);
const SHELL_BROW = 1;
/** The right hand gathers into a fist at the chest, then opens flat as it strikes the floor. */
const SHELL_GATHER_FIST = 0.95;

/**
 * Head-on the right arm drives down and a little out from his side, locked
 * straight, palm spread at the floor; the left swings out the other way for
 * balance. Driven down his centreline instead, a hand in front of the hips
 * reads at the 32 px tile as a hand on his crotch, whatever the arm is doing —
 * so the palm goes down past the outside of the thigh, carried toward his
 * knee by the chest pitching over it rather than by the arm swinging out
 * sideways, which reads as a throw. The arm is drawn full length: reaching
 * at the floor in front of him points it down the screen, not into it.
 * Joint angles, not a hand target: a target that close to the shoulder folds
 * the elbow up.
 */
const SHELL_FRONT_RIGHT: RaisedPath = raisedPath(RIGHT_ARM, SHELL_LAST, [
  [1, { out: deg(-2), up: deg(118), scale: 0.62 }],
  [SHELL_CAST_FRAME, { out: deg(16), up: deg(-14), scale: 1 }],
  [3, { out: deg(17), up: deg(-15), scale: 1 }],
  [4, { out: deg(16), up: deg(-14), scale: 1 }],
  [5, { out: deg(10), up: deg(-8), scale: 1 }],
  [6, { out: deg(4), up: deg(-4), scale: 1 }],
]);
/**
 * Head-on the chest pitches forward over the driving hand, which is the only
 * way the camera sees him bend down to the floor rather than squat upright.
 */
const SHELL_PITCH: Track = offsetTrack(SHELL_LAST, [
  [1, 0.12],
  [SHELL_CAST_FRAME, 0.62],
  [3, 0.66],
  [4, 0.58],
  [5, 0.26],
  [6, 0.05],
]);
const SHELL_FRONT_LEFT: RaisedPath = raisedPath(LEFT_ARM, SHELL_LAST, [
  [1, { out: deg(2), up: deg(-4), scale: 1 }],
  [SHELL_CAST_FRAME, { out: deg(14), up: deg(-12), scale: 1 }],
  [3, { out: deg(15), up: deg(-13), scale: 1 }],
  [4, { out: deg(13), up: deg(-11), scale: 1 }],
  [5, { out: deg(6), up: deg(-5), scale: 1 }],
]);
/**
 * Edge-on the fist gathers up by his chest, the elbow back, then the palm
 * drives forward and down in front of him; the far arm swings back. Gathered
 * out in front at elbow height instead, the forearm lies level across his
 * chest and the glow sits under it, nowhere near where the palm lands.
 */
const SHELL_SIDE_RIGHT: HandPath = handPath(SEAM_WRISTS.side.right, SHELL_LAST, [
  [1, pt(0.1, -1.42)],
  [SHELL_CAST_FRAME, pt(0.48, DOME_CENTRE_Y - 0.33)],
  [3, pt(0.48, DOME_CENTRE_Y - 0.3)],
  [4, pt(0.46, DOME_CENTRE_Y - 0.32)],
  [5, pt(0.3, -0.88)],
  [6, pt(0.06, -0.9)],
]);
const SHELL_SIDE_LEFT: HandPath = handPath(SEAM_WRISTS.side.left, SHELL_LAST, [
  [1, pt(-0.06, -0.95)],
  [SHELL_CAST_FRAME, pt(-0.26, -1.0)],
  [3, pt(-0.27, -0.99)],
  [4, pt(-0.25, -0.97)],
  [5, pt(-0.14, -0.93)],
]);
/**
 * Edge-on he leans into the drive from the hips, only a little — the arm
 * reaches out in front of him rather than him folding down after it, which
 * with bent knees reads as squatting to sit.
 */
const SHELL_SIDE_LEAN: Track = offsetTrack(SHELL_LAST, [
  [1, deg(-3)],
  [SHELL_CAST_FRAME, deg(12)],
  [3, deg(13)],
  [4, deg(11)],
  [5, deg(5)],
  [6, deg(1)],
]);
/** In profile the crouch is kept shallow for the same reason. */
const SHELL_SIDE_CROUCH_SHARE = 0.45;
/** The elbow locks straight on the drive; a bent one reads as a pat, not a strike. */
const SHELL_ELBOW_FLARE = 0.05;

/**
 * The shell's light gathers in the right palm as it is driven down and flares
 * on the cast frame, where the dome is centred, and stays lit while the palm
 * is pressed down: one bright frame is gone before the eye finds it.
 */
const SHELL_PALM_GLOW: Track = offsetTrack(SHELL_LAST, [
  [SHELL_CAST_FRAME - 1, 0.5],
  [SHELL_CAST_FRAME, 1],
  [SHELL_CAST_FRAME + 1, 0.9],
  [SHELL_CAST_FRAME + 2, 0.45],
  [SHELL_CAST_FRAME + 3, 0],
]);

function shellShapes(pose: CarlPose, frame: number): void {
  const gathering = frame === 1;
  const striking = frame >= SHELL_CAST_FRAME && frame <= SHELL_LAST - 2;
  if (gathering) pose.rightFist = SHELL_GATHER_FIST;
  if (striking) {
    const open: HandShape = 'open';
    pose.rightHandShape = open;
    pose.leftHandShape = open;
  }
  const glow = trackAt(frame, SHELL_PALM_GLOW);
  if (glow > 0) pose.palmGlow = { hand: 'right', strength: glow };
}

function shellBody(pose: CarlPose, frame: number): void {
  pose.crouch += trackAt(frame, SHELL_CROUCH);
  pose.bob += trackAt(frame, SHELL_BOB);
  pose.chinLift = trackAt(frame, SHELL_CHIN);
  pose.mouth = trackAt(frame, SHELL_MOUTH);
  pose.jacketFlare += trackAt(frame, SHELL_JACKET);
  pose.hairFlow += trackAt(frame, SHELL_HAIR);
  pose.brow = SHELL_BROW;
  plantFeet(pose);
}

/** Protective Shell, toward the camera: the right palm driven down onto the dome's centre. */
export function shellCastFront(frame: number): CarlPose {
  const pose = seamPose('front');
  if (isSeam(frame, SHELL_LAST)) return pose;
  shellBody(pose, frame);
  squatLegs(pose, pose.crouch);
  pose.torsoPitch = trackAt(frame, SHELL_PITCH);
  raiseArm(pose, RIGHT_ARM, frame, SHELL_FRONT_RIGHT);
  raiseArm(pose, LEFT_ARM, frame, SHELL_FRONT_LEFT);
  shellShapes(pose, frame);
  return pose;
}

/** From behind the arms are the same; out past his sides, they show. */
export function shellCastBack(frame: number): CarlPose {
  const pose = shellCastFront(frame);
  if (isSeam(frame, SHELL_LAST)) return seamPose('back');
  pose.headTurn = -pose.headTurn;
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  return pose;
}

export function shellCastSide(frame: number): CarlPose {
  const pose = seamPose('side');
  if (isSeam(frame, SHELL_LAST)) return pose;
  shellBody(pose, frame);
  // Edge-on the chin is a true rotation of the head, and bending at the hips
  // already tips the face down at the floor.
  pose.chinLift = 0;
  pose.crouch = seamPose('side').crouch + trackAt(frame, SHELL_CROUCH) * SHELL_SIDE_CROUCH_SHARE;
  pose.lean += trackAt(frame, SHELL_SIDE_LEAN);
  pose.elbowFlare = SHELL_ELBOW_FLARE;
  placeHands(pose, frame, SHELL_SIDE_RIGHT, SHELL_SIDE_LEFT);
  shellShapes(pose, frame);
  return pose;
}

// ── Drinking ─────────────────────────────────────────────────────────────────

const DRINK_LAST = DRINK_FRAMES - 1;
/** The frames the bottle is in his hand: it comes out of the pack on the first and is gone by the last. */
const DRINK_BOTTLE_FROM = 1;
const DRINK_BOTTLE_TO = DRINK_LAST - 1;

/**
 * Head tipped back as the bottle comes up, furthest on the middle swallow.
 * Head-on this is the chin lift; edge-on it is a true tilt of the head.
 */
const DRINK_HEAD_BACK: Track = offsetTrack(DRINK_LAST, [
  [1, 0.05],
  [2, 0.2],
  [3, 0.7],
  [4, 0.85],
  [5, 0.75],
  [6, 0.2],
  [7, 0],
  [8, -0.1],
  [9, -0.05],
]);
/** Leaning back a little into the swig, then forward over the wipe. */
const DRINK_SIDE_LEAN: Track = offsetTrack(DRINK_LAST, [
  [2, deg(-1)],
  [3, deg(-4)],
  [4, deg(-5)],
  [5, deg(-4)],
  [6, deg(-1)],
  [8, deg(2)],
]);
const DRINK_SIDE_TILT = deg(-40);
/** The bottle's base rises through the three swallows, so the drink goes down. */
const DRINK_TIP: Track = fromRest(0, DRINK_LAST, [
  [1, 0],
  [2, 0.25],
  [3, 0.7],
  [4, 0.9],
  [5, 1],
  [6, 0.3],
  [7, 0],
]);
/** The bottle's neck points at his mouth: its long axis runs from base to cork. */
const DRINK_FRONT_AIM_LEVEL = deg(-150);
const DRINK_FRONT_AIM_TIPPED = deg(-250);
const DRINK_SIDE_AIM_LEVEL = deg(-172);
const DRINK_SIDE_AIM_TIPPED = deg(-222);
/** Carried at his hip and on the way up, the bottle stands upright in his fist. */
const DRINK_AIM_UPRIGHT = deg(-90);
const DRINK_BROW: Track = fromRest(0.55, DRINK_LAST, [
  [2, 0.4],
  [4, 0.2],
  [6, 0.3],
  [7, 0.85],
  [8, 0.95],
  [9, 0.8],
]);
/** Eyes close through the swallows. */
const DRINK_EYES: Track = offsetTrack(DRINK_LAST, [
  [2, 0.2],
  [3, 0.7],
  [4, 0.9],
  [5, 0.75],
  [6, 0.1],
]);
/** The "ahh" once the bottle comes down, a grimace under the wipe. */
const DRINK_MOUTHS: readonly MouthShape[] = [
  MOUTH_SHUT,
  MOUTH_SHUT,
  { open: 0.15, width: 0.8 },
  { open: 0.1, width: 0.8 },
  { open: 0.1, width: 0.8 },
  { open: 0.1, width: 0.8 },
  { open: 0.5, width: 1.05 },
  { open: 0.25, width: 1.2 },
  { open: 0.05, width: 1.3 },
  { open: 0, width: 1.1 },
  MOUTH_SHUT,
  MOUTH_SHUT,
];

/** Where his mouth is on the posed body, in figure space. */
function mouthOf(pose: CarlPose, view: CarlView): Pt {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const head = skeleton.headCentre;
  if (view === 'side') {
    const forward = MOUTH_PROFILE_FORWARD;
    const down = MOUTH_BELOW_HEAD_CENTRE;
    const tilt = pose.headTilt;
    return pt(
      head.x + forward * Math.cos(tilt) - down * Math.sin(tilt),
      head.y + forward * Math.sin(tilt) + down * Math.cos(tilt),
    );
  }
  const lift = (pose.chinLift ?? 0) * MOUTH_CHIN_LIFT_RISE;
  return pt(head.x, head.y + MOUTH_BELOW_HEAD_CENTRE - lift);
}

const MOUTH_BELOW_HEAD_CENTRE = 0.11;
const MOUTH_PROFILE_FORWARD = 0.17;
/** Head-on, a chin tipped all the way back carries the mouth this far up the face. */
const MOUTH_CHIN_LIFT_RISE = 0.05;

/**
 * Where the bottle hand sits against the mouth: its fist just to his right of
 * and below the lips, so the neck it grips reaches them. Keyed by how far the
 * bottle is tipped.
 */
const BOTTLE_FIST_BESIDE_MOUTH_FRONT = pt(0.15, 0.06);
const BOTTLE_FIST_BESIDE_MOUTH_FRONT_TIPPED = pt(0.14, -0.01);
const BOTTLE_FIST_BESIDE_MOUTH_SIDE = pt(0.13, 0.04);
const BOTTLE_FIST_BESIDE_MOUTH_SIDE_TIPPED = pt(0.1, -0.05);

/** Head-on right arm, by joint angles: up at the side on the way to the mouth, and back down. */
const DRINK_FRONT_RIGHT_RAISE: RaisedPath = raisedPath(RIGHT_ARM, DRINK_LAST, [
  [1, { out: deg(4), up: deg(95), scale: 0.45 }],
  [6, { out: deg(10), up: deg(40), scale: 0.6 }],
  [7, { out: deg(24), up: deg(62), scale: 0.72 }],
  [8, { out: deg(22), up: deg(58), scale: 0.74 }],
  [9, { out: deg(18), up: deg(42), scale: 0.8 }],
  [10, { out: deg(6), up: deg(-4), scale: 1 }],
]);
/** The frames the bottle is at his lips, where the hand is placed against the mouth instead. */
const DRINK_AT_MOUTH_FROM = 2;
const DRINK_AT_MOUTH_TO = 5;
/**
 * The frame the bottle comes away from the lips, still up by his jaw: the arm
 * has to come down from the mouth to his side, and in one step the whole
 * forearm jumps.
 */
const DRINK_LOWERED_FRAME = DRINK_AT_MOUTH_TO + 1;
const BOTTLE_LOWERED_FRONT = pt(0.2, 0.26);

/**
 * The wipe: the back of the free hand drawn across the lips, from his left
 * to his right, and away. Head-on that is the left hand coming up by joint
 * angles; the hand is then placed by target through the stroke.
 */
const WIPE_FROM = 7;
const WIPE_TO = 9;
const DRINK_FRONT_LEFT_RAISE: RaisedPath = raisedPath(LEFT_ARM, DRINK_LAST, [
  [5, { out: 0, up: deg(20), scale: 0.95 }],
  [6, { out: deg(2), up: deg(80), scale: 0.5 }],
  [10, { out: 0, up: deg(40), scale: 0.8 }],
]);
/** The wiping hand's knuckles, against the mouth, per wipe frame. */
const WIPE_FRONT: readonly Pt[] = [pt(-0.12, 0.04), pt(0.02, 0.03), pt(0.12, 0.05)];
/** Edge-on the bottle hand wipes too, its wrist drawn back across the lips toward the cheek. */
const WIPE_SIDE: readonly Pt[] = [pt(0.14, 0.05), pt(0.05, 0.04), pt(-0.02, 0.07)];

function drinkFace(pose: CarlPose, frame: number): void {
  const mouth = DRINK_MOUTHS[Math.min(frame, DRINK_MOUTHS.length - 1)];
  pose.mouth = mouth.open;
  pose.mouthWidth = mouth.width;
  pose.brow = trackAt(frame, DRINK_BROW);
  pose.blink = Math.max(pose.blink, trackAt(frame, DRINK_EYES));
  plantFeet(pose);
}

function holdBottle(pose: CarlPose, view: CarlView, aim: number): void {
  pose.rightHandShape = 'grip';
  pose.heldProps = [
    {
      kind: 'bottle',
      hand: 'right',
      angle: propAngleFor(pose, view, 'right', aim),
      scale: HELD_BOTTLE_SCALE,
    },
  ];
}

/**
 * Held up at his face the bottle is half hidden by the fist and the head, so
 * it is drawn a size up: at the 32 px tile what shows past the fingers has to
 * be more than a red pixel.
 */
const HELD_BOTTLE_SCALE = 1.25;

function drinkAim(frame: number, level: number, tipped: number): number {
  if (frame < DRINK_AT_MOUTH_FROM || frame > DRINK_AT_MOUTH_TO + 1) return DRINK_AIM_UPRIGHT;
  return lerp(level, tipped, trackAt(frame, DRINK_TIP));
}

/** Where the mouth-relative bottle hand sits at `frame`, whether or not that frame is actually in the at-mouth range. */
function drinkMouthTargetFront(pose: CarlPose, view: CarlView, frame: number): Pt {
  const mouth = mouthOf(pose, view);
  const beside = mixPt(
    BOTTLE_FIST_BESIDE_MOUTH_FRONT,
    BOTTLE_FIST_BESIDE_MOUTH_FRONT_TIPPED,
    trackAt(frame, DRINK_TIP),
  );
  return pt(mouth.x + beside.x, mouth.y + beside.y);
}

/** Where the lowered bottle hand sits, just under the chin. */
function drinkLoweredTargetFront(pose: CarlPose, view: CarlView): Pt {
  const mouth = mouthOf(pose, view);
  return pt(mouth.x + BOTTLE_LOWERED_FRONT.x, mouth.y + BOTTLE_LOWERED_FRONT.y);
}

/** Where the wiping hand's knuckles sit against the mouth, at a wipe frame's own offset. */
function drinkWipeTargetFront(pose: CarlPose, view: CarlView, knuckles: Pt): Pt {
  const mouth = mouthOf(pose, view);
  return pt(mouth.x + knuckles.x, mouth.y + knuckles.y);
}

/**
 * The wrist position the head-on FK raise track would reach at `frame`,
 * found by resolving the chain forward rather than guessed — used only to
 * pull a placed-target frame on the far side of a mechanism handoff toward
 * it, so the switch from joint angles to a placed hand reads as one
 * continued arc rather than a snap.
 */
function raiseHandPos(
  pose: CarlPose,
  view: CarlView,
  side: number,
  frame: number,
  path: RaisedPath,
): Pt {
  const probe: CarlPose = { ...pose };
  raiseArm(probe, side, frame, path);
  const skeleton = buildSkeleton(probe, VIEWS[view]);
  return side === RIGHT_ARM ? skeleton.rightArm.end : skeleton.leftArm.end;
}

/**
 * How far a placed-hand frame next to a mechanism handoff (joint angles to a
 * placed target, or back) is pulled toward the pose the other mechanism
 * would have produced at that same frame, so a bottle raise or a wipe eases
 * across the switch instead of snapping.
 */
const DRINK_HANDOFF_EASE = 0.4;

function drinkHeadOn(frame: number, view: 'front' | 'back'): CarlPose {
  const pose = seamPose(view);
  if (isSeam(frame, DRINK_LAST)) return pose;
  drinkFace(pose, frame);
  pose.chinLift = trackAt(frame, DRINK_HEAD_BACK);
  if (frame >= DRINK_AT_MOUTH_FROM && frame <= DRINK_AT_MOUTH_TO) {
    let target = drinkMouthTargetFront(pose, view, frame);
    if (frame === DRINK_AT_MOUTH_FROM) {
      target = mixPt(
        target,
        raiseHandPos(pose, view, RIGHT_ARM, frame, DRINK_FRONT_RIGHT_RAISE),
        DRINK_HANDOFF_EASE,
      );
    }
    pose.rightArmAngles = null;
    pose.rightHand = target;
    // Raised to the mouth, the drinking elbow comes up and out from the ribs.
    pose.elbowFlare = DRINK_ELBOW_FLARE;
  } else if (frame === DRINK_LOWERED_FRAME) {
    let target = drinkLoweredTargetFront(pose, view);
    target = mixPt(
      target,
      raiseHandPos(pose, view, RIGHT_ARM, frame, DRINK_FRONT_RIGHT_RAISE),
      DRINK_HANDOFF_EASE,
    );
    pose.rightArmAngles = null;
    pose.rightHand = target;
    pose.elbowFlare = DRINK_ELBOW_FLARE;
  } else if (frame === DRINK_AT_MOUTH_FROM - 1) {
    // The last frame of the raise, eased forward toward the mouth so the
    // hand is already most of the way there before the mechanism switches.
    let target = raiseHandPos(pose, view, RIGHT_ARM, frame, DRINK_FRONT_RIGHT_RAISE);
    target = mixPt(target, drinkMouthTargetFront(pose, view, frame), DRINK_HANDOFF_EASE);
    pose.rightArmAngles = null;
    pose.rightHand = target;
    pose.elbowFlare = DRINK_ELBOW_FLARE;
  } else {
    raiseArm(pose, RIGHT_ARM, frame, DRINK_FRONT_RIGHT_RAISE);
  }
  if (frame <= DRINK_BOTTLE_TO && frame >= DRINK_BOTTLE_FROM) {
    holdBottle(pose, view, drinkAim(frame, DRINK_FRONT_AIM_LEVEL, DRINK_FRONT_AIM_TIPPED));
  }
  if (frame >= WIPE_FROM && frame <= WIPE_TO) {
    const knuckles = WIPE_FRONT[frame - WIPE_FROM];
    let target = drinkWipeTargetFront(pose, view, knuckles);
    if (frame === WIPE_FROM || frame === WIPE_TO) {
      target = mixPt(
        target,
        raiseHandPos(pose, view, LEFT_ARM, frame, DRINK_FRONT_LEFT_RAISE),
        DRINK_HANDOFF_EASE,
      );
    }
    pose.leftArmAngles = null;
    pose.leftHand = target;
    pose.leftFist = WIPE_FIST;
    pose.elbowFlare = WIPE_ELBOW_FLARE;
  } else if (frame === WIPE_TO + 1) {
    // The raise resuming just past the wipe, eased back toward it so the
    // hand's return to his side is not a jump.
    let target = raiseHandPos(pose, view, LEFT_ARM, frame, DRINK_FRONT_LEFT_RAISE);
    target = mixPt(
      target,
      drinkWipeTargetFront(pose, view, WIPE_FRONT[WIPE_FRONT.length - 1]),
      DRINK_HANDOFF_EASE,
    );
    pose.leftArmAngles = null;
    pose.leftHand = target;
    pose.leftFist = WIPE_FIST;
    pose.elbowFlare = WIPE_ELBOW_FLARE;
  } else {
    raiseArm(pose, LEFT_ARM, frame, DRINK_FRONT_LEFT_RAISE);
  }
  return pose;
}

/**
 * Positive drops the elbow down and out under the raised fist, so the forearm
 * rises diagonally to the lips beside the face. Thrown up and out level with
 * the shoulder instead, the forearm lies flat across his whole face and
 * reads at the 32 px tile as a sneeze into the elbow.
 */
const DRINK_ELBOW_FLARE = 0.5;
/** The wiping hand is loosely curled: it is the back of the fingers that does the wiping. */
const WIPE_FIST = 0.55;
const WIPE_ELBOW_FLARE = 0.7;

/** Drinking, toward the camera: bottle to the mouth, head back, and a wipe with the back of the left hand. */
export function drinkFront(frame: number): CarlPose {
  return drinkHeadOn(frame, 'front');
}

/**
 * Seen from behind: the bottle and the wiping hand are in front of his face,
 * out of sight, so the drink reads from the head tipping back, the elbow
 * coming up and the bottle's base rising above his crown.
 */
export function drinkBack(frame: number): CarlPose {
  const pose = drinkHeadOn(frame, 'back');
  pose.rightArmBehind = true;
  pose.leftArmBehind = true;
  if (isSeam(frame, DRINK_LAST)) return pose;
  // The same hands, reached for by target with the elbows thrown wide: from
  // behind, an elbow out at shoulder height is most of what says a hand is
  // up at his face.
  const skeleton = buildSkeleton(pose, VIEWS.back);
  pose.rightArmAngles = null;
  pose.rightHand = skeleton.rightArm.end;
  pose.elbowFlare = DRINK_BACK_ELBOW_FLARE;
  // The wipe is in front of his face, out of sight; its raised elbow alone
  // reads from behind as scratching his head, so the left arm stays down.
  const seam = seamPose('back');
  pose.leftArmAngles = seam.leftArmAngles;
  pose.leftUpperArmScale = seam.leftUpperArmScale;
  pose.leftFist = seam.leftFist;
  if (pose.heldProps !== undefined) {
    holdBottle(pose, 'back', drinkAim(frame, DRINK_FRONT_AIM_LEVEL, DRINK_FRONT_AIM_TIPPED));
  }
  return pose;
}

const DRINK_BACK_ELBOW_FLARE = -2.2;

/** Edge-on the bottle hand does both: the swig, then the back of its wrist across the lips. */
const DRINK_SIDE_RIGHT: HandPath = handPath(SEAM_WRISTS.side.right, DRINK_LAST, [
  [1, pt(0.14, -1.28)],
  [10, pt(0.12, -1.12)],
]);
/**
 * Just off the lips, under the chin: the bottle comes down between swallow
 * and wipe rather than swinging out in front of him and back.
 */
const BOTTLE_LOWERED_SIDE = pt(0.12, 0.16);

export function drinkSide(frame: number): CarlPose {
  const pose = seamPose('side');
  if (isSeam(frame, DRINK_LAST)) return pose;
  drinkFace(pose, frame);
  pose.lean += trackAt(frame, DRINK_SIDE_LEAN);
  pose.headTilt = DRINK_SIDE_TILT * trackAt(frame, DRINK_HEAD_BACK);
  const tip = trackAt(frame, DRINK_TIP);
  const mouth = mouthOf(pose, 'side');
  if (frame >= DRINK_AT_MOUTH_FROM && frame <= DRINK_AT_MOUTH_TO) {
    const beside = mixPt(BOTTLE_FIST_BESIDE_MOUTH_SIDE, BOTTLE_FIST_BESIDE_MOUTH_SIDE_TIPPED, tip);
    pose.rightHand = pt(mouth.x + beside.x, mouth.y + beside.y);
  } else if (frame === DRINK_LOWERED_FRAME) {
    pose.rightHand = pt(mouth.x + BOTTLE_LOWERED_SIDE.x, mouth.y + BOTTLE_LOWERED_SIDE.y);
  } else if (frame >= WIPE_FROM && frame <= WIPE_TO) {
    const wrist = WIPE_SIDE[frame - WIPE_FROM];
    pose.rightHand = pt(mouth.x + wrist.x, mouth.y + wrist.y);
  } else {
    pose.rightHand = handAt(frame, DRINK_SIDE_RIGHT);
  }
  // Raised to the face, the elbow drops under the forearm rather than
  // flaring back behind him.
  pose.elbowFlare = SIDE_RAISED_ELBOW_FLARE;
  if (frame <= DRINK_BOTTLE_TO && frame >= DRINK_BOTTLE_FROM) {
    const wiping = frame >= WIPE_FROM && frame <= WIPE_TO;
    const aim = wiping
      ? SIDE_WIPE_BOTTLE_AIM
      : drinkAim(frame, DRINK_SIDE_AIM_LEVEL, DRINK_SIDE_AIM_TIPPED);
    holdBottle(pose, 'side', aim);
  }
  return pose;
}

const SIDE_RAISED_ELBOW_FLARE = -0.6;
/** Wiping with the back of the bottle hand's wrist, the bottle hangs neck-down out of the way. */
const SIDE_WIPE_BOTTLE_AIM = deg(110);

// ── Picking up ───────────────────────────────────────────────────────────────

const GRAB_LAST = GRAB_FRAMES - 1;
/** The frame the hand closes on what it reached for. */
const GRAB_TAKE_FRAME = 2;

const GRAB_CROUCH: Track = offsetTrack(GRAB_LAST, [
  [1, 0.5],
  [GRAB_TAKE_FRAME, 1],
  [3, 0.8],
  [4, 0.25],
]);
/**
 * A full crouch only drops the hips a third of their height; the snatch sinks
 * past it, the knees folding further under him, or head-on — where he cannot
 * be seen to bend forward — the stoop hardly reads as one.
 */
const GRAB_BOB: Track = offsetTrack(GRAB_LAST, [
  [1, 0.06],
  [GRAB_TAKE_FRAME, 0.2],
  [3, 0.12],
  [4, 0.02],
]);
const GRAB_CHIN: Track = offsetTrack(GRAB_LAST, [
  [1, -0.55],
  [GRAB_TAKE_FRAME, -0.85],
  [3, -0.6],
  [4, -0.15],
]);
const GRAB_JACKET: Track = offsetTrack(GRAB_LAST, [
  [GRAB_TAKE_FRAME, 0.3],
  [3, 0.2],
]);
/** The snatching hand: open as it reaches, shut round the thing on the take, still shut coming up. */
function grabFist(frame: number): number {
  if (frame < GRAB_TAKE_FRAME) return 0;
  return 1;
}
/**
 * Head-on he bends forward over the snatching hand — the chest pitched toward
 * the camera, head dropped to watch his hand — with only a little dip toward
 * his left, the side it reaches on; and the arm goes straight down and out
 * past the knee to the floor. Never down his centreline: a hand low in front
 * of the hips reads at the 32 px tile as a hand on his crotch. The right arm
 * stays in by his side.
 */
const GRAB_FRONT_REACH: RaisedPath = raisedPath(LEFT_ARM, GRAB_LAST, [
  [1, { out: deg(10), up: deg(-12), scale: 1 }],
  [GRAB_TAKE_FRAME, { out: deg(16), up: deg(-18), scale: 1 }],
  [3, { out: deg(12), up: deg(24), scale: 0.9 }],
  [4, { out: deg(5), up: deg(92), scale: 0.62 }],
]);
const GRAB_FRONT_BALANCE: RaisedPath = raisedPath(RIGHT_ARM, GRAB_LAST, [
  [1, { out: deg(6), up: deg(-8), scale: 1 }],
  [GRAB_TAKE_FRAME, { out: deg(8), up: deg(-8), scale: 1 }],
  [3, { out: deg(6), up: deg(10), scale: 0.95 }],
  [4, { out: deg(6), up: deg(-4), scale: 1 }],
]);
/** Negative drops his left shoulder, over the reaching hand. */
const GRAB_FRONT_LEAN: Track = offsetTrack(GRAB_LAST, [
  [1, deg(-4)],
  [GRAB_TAKE_FRAME, deg(-9)],
  [3, deg(-6)],
  [4, deg(-2)],
]);
/** Head-on the bend at the hips, toward the camera in front and away from it behind. */
const GRAB_FRONT_PITCH: Track = offsetTrack(GRAB_LAST, [
  [1, 0.45],
  [GRAB_TAKE_FRAME, 0.95],
  [3, 0.6],
  [4, 0.15],
]);
/**
 * Edge-on he stoops: hips back, spine tipped forward, knees bent, the near
 * hand reaching the floor ahead of his toes and the far one braced on its
 * thigh — the lift in Muybridge's plate, taken in a hurry.
 */
const GRAB_SIDE_LEAN: Track = offsetTrack(GRAB_LAST, [
  [1, deg(22)],
  [GRAB_TAKE_FRAME, deg(50)],
  [3, deg(38)],
  [4, deg(10)],
]);
const GRAB_SIDE_CROUCH_SHARE = 0.85;
/** The near hand reaches the floor itself, a finger's width above it, on the take. */
const GRAB_SIDE_RIGHT: HandPath = handPath(SEAM_WRISTS.side.right, GRAB_LAST, [
  [1, pt(0.3, -0.66)],
  [GRAB_TAKE_FRAME, pt(0.48, -0.12)],
  [3, pt(0.38, -0.62)],
  [4, pt(0.2, -1.18)],
]);
const GRAB_SIDE_LEFT: HandPath = handPath(SEAM_WRISTS.side.left, GRAB_LAST, [
  [1, pt(0.08, -0.78)],
  [GRAB_TAKE_FRAME, pt(0.2, -0.62)],
  [3, pt(0.16, -0.66)],
  [4, pt(-0.02, -0.86)],
]);
/** Hips thrust back to balance the reach, so his weight stays over his feet. */
const GRAB_SIDE_SWAY: Track = offsetTrack(GRAB_LAST, [
  [1, -0.05],
  [GRAB_TAKE_FRAME, -0.14],
  [3, -0.1],
  [4, -0.02],
]);

function grabBody(pose: CarlPose, frame: number): void {
  pose.bob += trackAt(frame, GRAB_BOB);
  pose.jacketFlare += trackAt(frame, GRAB_JACKET);
  pose.rightFist = grabFist(frame);
  pose.brow = GRAB_BROW;
  plantFeet(pose);
}

const GRAB_BROW = 0.7;

function grabHeadOn(frame: number, view: 'front' | 'back'): CarlPose {
  const pose = seamPose(view);
  if (isSeam(frame, GRAB_LAST)) return pose;
  grabBody(pose, frame);
  pose.crouch += trackAt(frame, GRAB_CROUCH);
  pose.chinLift = trackAt(frame, GRAB_CHIN);
  pose.lean += trackAt(frame, GRAB_FRONT_LEAN);
  pose.torsoPitch = trackAt(frame, GRAB_FRONT_PITCH);
  squatLegs(pose, pose.crouch);
  raiseArm(pose, LEFT_ARM, frame, GRAB_FRONT_REACH);
  raiseArm(pose, RIGHT_ARM, frame, GRAB_FRONT_BALANCE);
  pose.leftFist = grabFist(frame);
  pose.rightFist = seamPose(view).rightFist;
  if (view === 'back') pose.headTurn = -pose.headTurn;
  return pose;
}

/** Edge-on the far hand is braced on its thigh, half curled over it. */
const GRAB_BRACING_FIST = 0.35;

/** Stooping for something at his feet, toward the camera. */
export function grabFront(frame: number): CarlPose {
  return grabHeadOn(frame, 'front');
}

export function grabBack(frame: number): CarlPose {
  const pose = grabHeadOn(frame, 'back');
  pose.rightArmBehind = true;
  pose.leftArmBehind = true;
  return pose;
}

export function grabSide(frame: number): CarlPose {
  const pose = seamPose('side');
  if (isSeam(frame, GRAB_LAST)) return pose;
  grabBody(pose, frame);
  pose.crouch += trackAt(frame, GRAB_CROUCH) * GRAB_SIDE_CROUCH_SHARE;
  pose.lean += trackAt(frame, GRAB_SIDE_LEAN);
  pose.headTilt = trackAt(frame, GRAB_SIDE_LEAN) * STOOP_HEAD_FOLLOWS_SPINE;
  pose.sway += trackAt(frame, GRAB_SIDE_SWAY);
  placeHands(pose, frame, GRAB_SIDE_RIGHT, GRAB_SIDE_LEFT);
  pose.leftFist = GRAB_BRACING_FIST;
  return pose;
}

// ── Opening a chest ──────────────────────────────────────────────────────────

const CHEST_LAST = CHEST_OPEN_FRAMES - 1;
/** The frame his fingers hook under the lid, from which the hands close on it. */
const CHEST_GRIP_FRAME = 2;
/** From here the lid is up and his hands push it over, open. */
const CHEST_PUSH_FRAME = 6;

const CHEST_CROUCH: Track = offsetTrack(CHEST_LAST, [
  [1, 0.4],
  [CHEST_GRIP_FRAME, 0.82],
  [3, 0.86],
  [4, 0.58],
  [CHEST_LID_UP_FRAME, 0.32],
  [CHEST_PUSH_FRAME, 0.22],
  [7, 0.26],
  [8, 0.1],
]);
/** Braced for the heave, then driving up out of the legs. */
const CHEST_BOB: Track = offsetTrack(CHEST_LAST, [
  [1, 0.03],
  [CHEST_GRIP_FRAME, 0.1],
  [3, 0.11],
  [4, 0.03],
  [CHEST_LID_UP_FRAME, -0.006],
]);
const CHEST_CHIN: Track = offsetTrack(CHEST_LAST, [
  [1, -0.5],
  [CHEST_GRIP_FRAME, -0.8],
  [3, -0.6],
  [4, -0.2],
  [CHEST_LID_UP_FRAME, 0.1],
  [CHEST_PUSH_FRAME, 0],
  [7, -0.6],
  [8, -0.3],
]);
const CHEST_MOUTH: Track = offsetTrack(CHEST_LAST, [
  [3, 0.2],
  [4, 0.5],
  [CHEST_LID_UP_FRAME, 0.3],
  [7, 0.1],
]);
const CHEST_JACKET: Track = offsetTrack(CHEST_LAST, [
  [CHEST_GRIP_FRAME, 0.3],
  [4, 0.35],
  [CHEST_LID_UP_FRAME, 0.2],
]);
/** Straining under the lid, the brow knits; looking in, it lifts. */
const CHEST_BROW: Track = fromRest(0.55, CHEST_LAST, [
  [3, 1],
  [4, 1],
  [CHEST_PUSH_FRAME, 0.7],
  [7, 0.15],
  [8, 0.35],
]);

/** Both hands, head-on, keyed as a pair mirrored about his centreline: x is his right hand's. */
/**
 * Head-on, by joint angles, both arms the same: straight down and out past the
 * knees to take the lid by its two ends — a chest is wider than he is — then
 * the forearms come up toward the camera, palms up under the lid, and push it
 * up and away. Placed by hand target, the same lift either bows the elbows
 * out level with the shoulders (a strongman's flex) or folds the forearms
 * across each other (arms crossed); only a forearm foreshortened toward the
 * camera reads as hands raised in front of him.
 */
const CHEST_ARM_KEYS: readonly (readonly [number, RaisedKey])[] = [
  [1, { out: deg(12), up: deg(-12), scale: 1 }],
  [CHEST_GRIP_FRAME, { out: deg(15), up: deg(-14), scale: 1 }],
  [3, { out: deg(15), up: deg(-14), scale: 1 }],
  [4, { out: deg(20), up: deg(64), scale: 0.72 }],
  [CHEST_LID_UP_FRAME, { out: deg(12), up: deg(98), scale: 0.5 }],
  [CHEST_PUSH_FRAME, { out: deg(16), up: deg(116), scale: 0.52 }],
  [7, { out: deg(10), up: deg(82), scale: 0.6 }],
  [8, { out: deg(6), up: deg(-6), scale: 1 }],
];
const CHEST_FRONT_RIGHT = raisedPath(RIGHT_ARM, CHEST_LAST, CHEST_ARM_KEYS);
/**
 * Head-on the same bend into the lift that the profile draws as a lean, held
 * over the chest while the lid goes over: without it the squat is a man
 * sitting upright on nothing with his arms at his sides.
 */
const CHEST_PITCH: Track = offsetTrack(CHEST_LAST, [
  [1, 0.3],
  [CHEST_GRIP_FRAME, 0.7],
  [3, 0.68],
  [4, 0.36],
  [CHEST_LID_UP_FRAME, 0.22],
  [CHEST_PUSH_FRAME, 0.2],
  [7, 0.12],
  [8, 0.04],
]);
const CHEST_FRONT_LEFT = raisedPath(LEFT_ARM, CHEST_LAST, CHEST_ARM_KEYS);
/** Edge-on he bends into it and straightens as the lid comes up; the far hand works just behind the near one. */
/** Bent over the chest to take the lid, and still leaning into it as it goes over. */
const CHEST_SIDE_LEAN: Track = offsetTrack(CHEST_LAST, [
  [1, deg(18)],
  [CHEST_GRIP_FRAME, deg(40)],
  [3, deg(40)],
  [4, deg(22)],
  [CHEST_LID_UP_FRAME, deg(12)],
  [CHEST_PUSH_FRAME, deg(10)],
  [7, deg(8)],
  [8, deg(4)],
]);
const CHEST_SIDE_SWAY: Track = offsetTrack(CHEST_LAST, [
  [CHEST_GRIP_FRAME, -0.08],
  [3, -0.09],
  [4, -0.05],
  [CHEST_LID_UP_FRAME, -0.01],
]);
/**
 * The hands take the lid down at the floor ahead of his toes and carry it up
 * and away from him along the arc a hinged lid swings through, arms reaching
 * out over the chest, then set it over — held, not shoved: a hand thrown
 * forward and pulled back reads as a punch. Drawn in to his chest instead,
 * with him leaning back, the lift reads as fists raised after a jump.
 */
const CHEST_SIDE_RIGHT = handPath(SEAM_WRISTS.side.right, CHEST_LAST, [
  [1, pt(0.32, -0.7)],
  [CHEST_GRIP_FRAME, pt(0.5, -0.3)],
  [3, pt(0.5, -0.28)],
  [4, pt(0.48, -0.74)],
  [CHEST_LID_UP_FRAME, pt(0.52, -1.02)],
  [CHEST_PUSH_FRAME, pt(0.6, -1.14)],
  [7, pt(0.46, -1.02)],
  [8, pt(0.24, -0.96)],
]);
const CHEST_SIDE_LEFT_BEHIND = 0.05;
const CHEST_SIDE_LEFT = handPath(SEAM_WRISTS.side.left, CHEST_LAST, [
  [1, pt(0.27, -0.7)],
  [CHEST_GRIP_FRAME, pt(0.5 - CHEST_SIDE_LEFT_BEHIND, -0.3)],
  [3, pt(0.5 - CHEST_SIDE_LEFT_BEHIND, -0.28)],
  [4, pt(0.48 - CHEST_SIDE_LEFT_BEHIND, -0.74)],
  [CHEST_LID_UP_FRAME, pt(0.52 - CHEST_SIDE_LEFT_BEHIND, -1.02)],
  [CHEST_PUSH_FRAME, pt(0.6 - CHEST_SIDE_LEFT_BEHIND, -1.14)],
  [7, pt(0.46 - CHEST_SIDE_LEFT_BEHIND, -1.02)],
  [8, pt(0.16, -1.0)],
]);
/** Open to reach for the lid, closed on it from the grip to the push. */
function chestHands(pose: CarlPose, frame: number): void {
  const reaching = frame > 0 && frame < CHEST_GRIP_FRAME;
  const holding = frame >= CHEST_GRIP_FRAME && frame <= CHEST_PUSH_FRAME;
  if (holding) {
    pose.rightFist = CHEST_GRIP_FIST;
    pose.leftFist = CHEST_GRIP_FIST;
  }
  if (reaching) {
    const open: HandShape = 'open';
    pose.rightHandShape = open;
    pose.leftHandShape = open;
  }
}

/**
 * The hands stay closed on the lid's edge from the grip right through the
 * push: at the 32 px tile an open hand held up in front of him has nothing in
 * it and reads as a sleepwalker's reach, a closed one as holding something.
 */
const CHEST_GRIP_FIST = 0.9;

function chestBody(pose: CarlPose, frame: number): void {
  pose.bob += trackAt(frame, CHEST_BOB);
  pose.mouth = trackAt(frame, CHEST_MOUTH);
  pose.jacketFlare += trackAt(frame, CHEST_JACKET);
  pose.brow = trackAt(frame, CHEST_BROW);
  plantFeet(pose);
  chestHands(pose, frame);
}

function chestHeadOn(frame: number, view: 'front' | 'back'): CarlPose {
  const pose = seamPose(view);
  if (isSeam(frame, CHEST_LAST)) return pose;
  chestBody(pose, frame);
  pose.crouch += trackAt(frame, CHEST_CROUCH);
  pose.chinLift = trackAt(frame, CHEST_CHIN);
  pose.torsoPitch = trackAt(frame, CHEST_PITCH);
  squatLegs(pose, pose.crouch);
  raiseArm(pose, RIGHT_ARM, frame, CHEST_FRONT_RIGHT);
  raiseArm(pose, LEFT_ARM, frame, CHEST_FRONT_LEFT);
  if (view === 'back') pose.headTurn = -pose.headTurn;
  return pose;
}

/** Heaving open a chest at his feet, toward the camera. */
export function chestOpenFront(frame: number): CarlPose {
  return chestHeadOn(frame, 'front');
}

export function chestOpenBack(frame: number): CarlPose {
  const pose = chestHeadOn(frame, 'back');
  pose.rightArmBehind = true;
  pose.leftArmBehind = true;
  return pose;
}

export function chestOpenSide(frame: number): CarlPose {
  const pose = seamPose('side');
  if (isSeam(frame, CHEST_LAST)) return pose;
  chestBody(pose, frame);
  pose.crouch += trackAt(frame, CHEST_CROUCH);
  pose.lean += trackAt(frame, CHEST_SIDE_LEAN);
  pose.headTilt = trackAt(frame, CHEST_SIDE_LEAN) * STOOP_HEAD_FOLLOWS_SPINE;
  pose.sway += trackAt(frame, CHEST_SIDE_SWAY);
  placeHands(pose, frame, CHEST_SIDE_RIGHT, CHEST_SIDE_LEFT);
  return pose;
}

// ── Talking ──────────────────────────────────────────────────────────────────

const TALK_LAST = TALK_FRAMES;

/**
 * The mouth through one loop: a syllable held a frame, never the same shape
 * twice running. Shut on the first frame, which is the idle's own, so talking
 * starts out of standing; the last frame is still mid-word, so the wrap back
 * to it is one more syllable rather than a held pause.
 */
const TALK_MOUTHS: readonly MouthShape[] = [
  MOUTH_SHUT,
  { open: 0.35, width: 1 },
  { open: 0.12, width: 1.25 },
  { open: 0.45, width: 0.9 },
  { open: 0.2, width: 0.75 },
  { open: 0.4, width: 1.1 },
  { open: 0.05, width: 1.15 },
  MOUTH_SHUT,
  { open: 0.3, width: 0.8 },
  { open: 0.42, width: 1 },
  { open: 0.1, width: 1.2 },
  { open: 0.22, width: 0.9 },
];
/** A nod on the stressed word of each gesture, one down-up per gesture. */
const TALK_NOD: Track = [
  [0, 0],
  [2, -0.05],
  [3, -0.28],
  [4, -0.05],
  [5, -0.2],
  [7, 0],
  [9, -0.22],
  [10, -0.05],
  [TALK_LAST, 0],
];
const TALK_BROW: Track = [
  [0, 0.55],
  [2, 0.35],
  [3, 0.7],
  [5, 0.6],
  [7, 0.5],
  [9, 0.25],
  [TALK_LAST, 0.55],
];
/**
 * Head-on the explaining hand is the one a listener sees: the elbow comes a
 * little forward off his ribs (the upper arm drawn short) and the forearm
 * rises forward and out, palm up, the open hand at the side of his lower
 * chest — a bent arm, so the elbow shows. With the elbow left at his side
 * and the forearm foreshortened low, the two segments line up into one
 * straight arm pointing at the floor. He makes his
 * point twice, a beat down and back over three frames each, the left hand
 * half-lifting with the stressed beat, then the left answers once, smaller. Swung out sideways instead, level with the hip, the
 * same arm reads as pointing somebody the way.
 */
const TALK_FRONT_RIGHT: RaisedPath = raisedPath(RIGHT_ARM, TALK_LAST, [
  [1, { out: deg(2), up: deg(-96), scale: 0.62, upperScale: 0.86 }],
  [2, { out: deg(4), up: deg(-150), scale: 0.72, upperScale: 0.74 }],
  [3, { out: deg(4), up: deg(-122), scale: 0.66, upperScale: 0.8 }],
  [4, { out: deg(5), up: deg(-154), scale: 0.72, upperScale: 0.74 }],
  [5, { out: deg(4), up: deg(-124), scale: 0.66, upperScale: 0.8 }],
  [6, { out: deg(2), up: deg(-86), scale: 0.66, upperScale: 0.88 }],
  [7, { out: 0, up: deg(-8), scale: 0.98 }],
]);
const TALK_FRONT_LEFT: RaisedPath = raisedPath(LEFT_ARM, TALK_LAST, [
  [2, { out: 0, up: deg(-8), scale: 0.98 }],
  [4, { out: deg(3), up: deg(-80), scale: 0.66, upperScale: 0.9 }],
  [6, { out: 0, up: deg(-10), scale: 0.96 }],
  [7, { out: 0, up: deg(-6), scale: 0.98 }],
  [8, { out: deg(3), up: deg(-100), scale: 0.62, upperScale: 0.86 }],
  [9, { out: deg(4), up: deg(-146), scale: 0.7, upperScale: 0.76 }],
  [10, { out: deg(3), up: deg(-100), scale: 0.62, upperScale: 0.86 }],
  [11, { out: deg(2), up: deg(-36), scale: 0.86 }],
]);
/** The hands open once they are up in front of him, and curl loose again on the way down. */
const TALK_RIGHT_OPEN_FROM = 2;
const TALK_RIGHT_OPEN_TO = 5;
const TALK_LEFT_OPEN_FROM = 8;
const TALK_LEFT_OPEN_TO = 10;
/** The left hand half-lifts, open, with the right's stressed beat. */
const TALK_LEFT_ECHO_FRAME = 4;
/** The shoulders turn a little into each gesturing hand. */
const TALK_TWIST: Track = [
  [0, 0],
  [3, 0.12],
  [5, 0.1],
  [7, 0],
  [9, -0.1],
  [TALK_LAST, 0],
];
/**
 * How far into each point he is, 0 to 1: his weight goes onto the foot on the
 * gesturing side and, edge-on, he leans in toward whoever he is talking to.
 */
const TALK_EMPHASIS: Track = [
  [0, 0],
  [2, 0.7],
  [4, 1],
  [6, 0.3],
  [8, 0.6],
  [9, 0.8],
  [TALK_LAST, 0],
];
const TALK_SIDE_LEAN_IN = deg(4);
/** Head-on the weight shifts toward the gesturing hand: right for the first point, left for the second. */
const TALK_WEIGHT_SHIFT: Track = [
  [0, 0],
  [3, 0.014],
  [5, 0.012],
  [7, 0],
  [9, -0.012],
  [TALK_LAST, 0],
];

/**
 * The head leads each gesture a little, turning toward the hand that makes
 * it: with only the arm moving, the rest of him stands stiff as a puppet.
 */
const TALK_HEAD_TURN: Track = [
  [0, 0],
  [2, 0.14],
  [5, 0.12],
  [7, 0],
  [9, -0.12],
  [TALK_LAST, 0],
];

/** Edge-on the gesturing hand comes forward, toward whoever is in front of him. */
/**
 * Edge-on the near hand makes both points, well out in front of him toward
 * whoever he faces; the far hand, behind his body, would only be a lump on
 * the jacket. Each beat drops the hand a clear step and brings it back.
 */
const TALK_SIDE_RIGHT: HandPath = handPath(SEAM_WRISTS.side.right, TALK_LAST, [
  [1, pt(0.2, -1.26)],
  [2, pt(0.44, -1.46)],
  [3, pt(0.44, -1.3)],
  [4, pt(0.46, -1.48)],
  [5, pt(0.42, -1.32)],
  [6, pt(0.3, -1.26)],
  [7, pt(0.36, -1.4)],
  [8, pt(0.42, -1.44)],
  [9, pt(0.4, -1.28)],
  [10, pt(0.3, -1.24)],
  [11, pt(0.26, -1.24)],
]);
/** Edge-on the near hand's second point, open again. */
const TALK_SIDE_SECOND_OPEN_FROM = 7;
const TALK_SIDE_SECOND_OPEN_TO = 9;
const TALK_SIDE_ELBOW_FLARE = -0.5;

function talkFace(pose: CarlPose, frame: number): void {
  const mouth = TALK_MOUTHS[frame % TALK_MOUTHS.length];
  pose.mouth = mouth.open;
  pose.mouthWidth = mouth.width;
  pose.brow = trackAt(frame, TALK_BROW);
}

function talkHands(pose: CarlPose, frame: number): void {
  if (frame >= TALK_RIGHT_OPEN_FROM && frame <= TALK_RIGHT_OPEN_TO) {
    pose.rightHandShape = 'open';
    pose.rightFist = 0;
  }
  const leftEchoes = frame === TALK_LEFT_ECHO_FRAME;
  if (leftEchoes || (frame >= TALK_LEFT_OPEN_FROM && frame <= TALK_LEFT_OPEN_TO)) {
    pose.leftHandShape = 'open';
    pose.leftFist = 0;
  }
}

function talkHeadOn(frame: number, view: 'front' | 'back'): CarlPose {
  const pose = seamPose(view);
  if (frame <= 0) return pose;
  talkFace(pose, frame);
  pose.chinLift = trackAt(frame, TALK_NOD);
  pose.twist = trackAt(frame, TALK_TWIST);
  pose.headTurn += (view === 'back' ? -1 : 1) * trackAt(frame, TALK_HEAD_TURN);
  pose.sway += trackAt(frame, TALK_WEIGHT_SHIFT);
  raiseArm(pose, RIGHT_ARM, frame, TALK_FRONT_RIGHT);
  raiseArm(pose, LEFT_ARM, frame, TALK_FRONT_LEFT);
  talkHands(pose, frame);
  return pose;
}

/** Talking to someone in front of him, toward the camera: a point made with each hand, a nod on each. */
export function talkFront(frame: number): CarlPose {
  return talkHeadOn(frame, 'front');
}

export function talkBack(frame: number): CarlPose {
  const pose = talkHeadOn(frame, 'back');
  // From behind, the raised forearms are in front of him and out of sight;
  // only the elbows and the shoulders turning say he is gesturing.
  pose.rightArmBehind = true;
  pose.leftArmBehind = true;
  return pose;
}

export function talkSide(frame: number): CarlPose {
  const pose = seamPose('side');
  if (frame <= 0) return pose;
  talkFace(pose, frame);
  pose.headTilt = TALK_SIDE_NOD * trackAt(frame, TALK_NOD);
  pose.rightHand = handAt(frame, TALK_SIDE_RIGHT);
  pose.elbowFlare = TALK_SIDE_ELBOW_FLARE;
  pose.lean += TALK_SIDE_LEAN_IN * trackAt(frame, TALK_EMPHASIS);
  talkHands(pose, frame);
  if (frame >= TALK_SIDE_SECOND_OPEN_FROM && frame <= TALK_SIDE_SECOND_OPEN_TO) {
    pose.rightHandShape = 'open';
    pose.rightFist = 0;
  }
  return pose;
}

/** Edge-on a nod is a real rotation of the head: a tuck of the chin is a forward tilt. */
const TALK_SIDE_NOD = deg(-40);
