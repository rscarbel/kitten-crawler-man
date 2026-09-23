/**
 * The slingshot shot, in all three views.
 *
 * A stone leaves the sling on the very tick the attack key is pressed — the
 * slingshot has no charge — so the row cannot wind up before it: its first
 * frame is the release, and the draw comes *after* it, as the reload. He lets
 * go, the bands snap forward past the fork, his drawing hand flicks open; then
 * the hand comes forward to the fork, pinches the pouch with a fresh stone,
 * and draws it back to the corner of his jaw. The draw reaches full anchor
 * exactly as the cooldown runs out, so a player firing as fast as the sling
 * allows sees one unbroken loop of release and redraw, and a player who waits
 * sees him hold at full draw, aiming.
 *
 * The frame stays in the extended left fist throughout. It is a held prop,
 * painted inside the figure, so from behind his head and shoulders cover the
 * parts of it they would.
 */

import { handGrip } from '../carl/limbs';
import { mixPt, offset, pt } from '../carl/geometry';
import { SLINGSHOT_LOADED, SLINGSHOT_TIPS_ABOVE_GRIP } from '../carl/props/slingshot';
import {
  type BodySide,
  buildSkeleton,
  type CarlPose,
  type CarlView,
  restingPose,
  setArmAngles,
  VIEWS,
} from '../carl/rig';
import { deg, type Pt } from '../carlArt';
import { SLINGSHOT_COOLDOWN_FRAMES } from '../../slingshotSprite';
import { anglesThrough, frameValue, upperArmShareThrough } from './gaitShared';

/**
 * Release, recoil, reach to the fork, pinch the pouch, a four-frame draw and
 * the settle at anchor. Nine frames at five ticks is the 45-tick cooldown, so
 * the anchor frame is the one on screen when the next shot becomes possible.
 */
export const SLING_FRAMES = 9;
/**
 * Ticks each frame holds, derived from the cooldown so the draw can never be
 * slower than the gun: the row ends on the tick the sling may fire again.
 */
export const SLING_TICKS_PER_FRAME = Math.round(SLINGSHOT_COOLDOWN_FRAMES / SLING_FRAMES);
/** The last frame the pouch hangs free, before the drawing hand reaches it. */
const REACH_FRAME = 2;
/** From this frame on the drawing hand holds the pouch; before it the hand is open. */
const PINCH_FRAME = 3;

/**
 * How far the pouch is drawn on each frame: 0 at the fork, 1 at the anchor on
 * the jaw. The release starts from the anchor it was let go at. The draw eases
 * — slow off the fork while the bands are slack, fastest through the middle,
 * and settling into the anchor — which is what a pull against rising
 * resistance looks like.
 */
const DRAW_BY_FRAME: readonly number[] = [1, 0.82, 0.38, 0, 0.14, 0.45, 0.78, 0.96, 1];
/**
 * How far the drawing hand flicks past where it let go, 1 on the release. The
 * fingers spring open and the hand jumps forward and out as the bands tear the
 * pouch away, then drifts on toward the fork.
 */
const SNAP_BY_FRAME: readonly number[] = [1, 0.7, 0.25, 0, 0, 0, 0, 0, 0];
/**
 * How far the pouch flies past the fork, 1 on the release: the bands overshoot
 * the fork on the release, whip back behind it, and hang.
 */
const BAND_OVERSHOOT_BY_FRAME: readonly number[] = [1, -0.45, 0.12];
/**
 * How far the fork is raised to the aim on each frame, 0 lowered to load and
 * 1 on the line of the shot: it drops as the reach begins, is loaded low, and
 * comes up with the draw, arriving at the aim a frame before the anchor.
 */
const RAISE_BY_FRAME: readonly number[] = [1, 0.7, 0.2, 0, 0.2, 0.6, 0.9, 1, 1];
/** How far the fork hand jumps as the bands let go, 1 on the release, settling on the next frame. */
const FRAME_KICK_BY_FRAME: readonly number[] = [1, 0.35, 0, 0, 0, 0, 0, 0, 0];

/** Squint and brow draw down as he sights along the bands. */
const AIM_BROW = 1;
const AIM_SQUINT = 0.35;
const RELEASE_BROW = 0.8;
const RELAXED_FIST = 0.2;
const FULL_FIST = 1;

/**
 * An arm placed by where its elbow and wrist are, in figure space. The
 * upper arm and forearm are drawn at the length that joins them: an elbow
 * pointed at or away from the camera is closer to its shoulder on screen than
 * the bone is long, which is the only way a flat arm shows a draw run
 * straight at the viewer.
 */
interface ArmPlace {
  readonly elbow: Pt;
  readonly wrist: Pt;
}

/**
 * Where everything sits in one view. Hand positions are wrist targets in
 * figure space; `frameUp` is the absolute direction the handle's butt points,
 * which keeps the fork standing upright whatever angle the wrist takes.
 */
interface SlingStance {
  readonly view: CarlView;
  /**
   * The fork arm, raised on the line of the shot and lowered to load: a wrist
   * target the arm reaches for (edge-on, where the arm lies in the picture),
   * or the whole arm placed (head-on, where it points at or away from the
   * camera and a two-bone reach in the picture plane can only fold it).
   *
   * Loading low and raising the fork into the draw keeps the drawing elbow
   * under his shoulder while the hand is at the fork: loaded at eye height,
   * the drawing arm can only reach the fork with its upper arm standing up
   * beside his head, where it reads as a fall of hair.
   */
  readonly forkArm:
    | { readonly hand: Pt; readonly loadHand: Pt }
    | { readonly raised: ArmPlace; readonly load: ArmPlace };
  /** Which way the fork hand jumps on the release. */
  readonly kick: Pt;
  /**
   * The drawing arm at full draw: the fist on the corner of his jaw, the
   * elbow up level with the shoulder and back behind it.
   */
  readonly anchor: ArmPlace;
  /**
   * The drawing arm pinching the pouch, placed from the fork hand's wrist
   * wherever the fork is: the wrist just behind the tips, the elbow down in
   * front of his ribs.
   */
  readonly pinch: ArmPlace;
  /** Where the drawing wrist jumps to on the release, from the anchor; the elbow goes half as far. */
  readonly snap: Pt;
  /** Which way the pouch flies on the release: along the shot. */
  readonly shot: Pt;
  /** The direction the handle's butt points, in radians; π/2 stands the fork upright. */
  readonly frameUp: number;
  readonly leftFoot: Pt;
  readonly rightFoot: Pt;
  readonly lean: number;
  readonly crouch: number;
  readonly twist: number;
  readonly headTurn: number;
  readonly headTilt: number;
  readonly chinLift: number;
  /** Which way an edge-on fork arm, placed by its wrist, bows its elbow. */
  readonly elbowFlare: number;
  /**
   * Whether the arms are on the far side of him, painted behind his body and
   * head. From behind both hands are ahead of his face, hidden; what shows of
   * the drawing arm is the elbow standing out past his shoulder.
   */
  readonly armsBehind: boolean;
  /** Head-on legs are straight columns; edge-on they break at the knee. */
  readonly foreshorten: number;
}

const UPRIGHT = Math.PI / 2;
/** The elbow travels half as far as the wrist when the bands tear the pouch away. */
const SNAP_ELBOW_SHARE = 0.5;

/**
 * Profile, facing +X: side-on to the target the way a shooter stands, left
 * foot forward and the left arm straight out at shoulder height, so the fork's
 * tips come up level with his eye. At full draw the drawing elbow sits level
 * with the shoulder, straight back behind it — the silhouette that says "full
 * draw" from any distance — and on its way from the fork it swings under the
 * shoulder, never up past the head.
 */
const SIDE_STANCE: SlingStance = {
  view: 'side',
  forkArm: { hand: pt(0.675, -1.64), loadHand: pt(0.62, -1.42) },
  kick: pt(-0.012, -0.03),
  anchor: { elbow: pt(-0.2, -1.6), wrist: pt(0.05, -1.7) },
  pinch: { elbow: pt(-0.42, 0.17), wrist: pt(-0.175, -0.04) },
  snap: pt(0.09, -0.02),
  shot: pt(0.09, 0),
  frameUp: UPRIGHT,
  leftFoot: pt(0.18, 0),
  rightFoot: pt(-0.16, 0),
  lean: deg(9),
  crouch: 0.08,
  twist: 0,
  headTurn: 0.3,
  headTilt: deg(4),
  chinLift: 0,
  elbowFlare: 0.4,
  armsBehind: false,
  foreshorten: 0,
};

/**
 * Head-on, aiming at the camera. The fork arm points straight at the viewer,
 * so it is barely any length on screen: the fist and fork stand in front of
 * his face, the tips on the line of his left eye. The drawing elbow is drawn
 * back away from the camera and out at shoulder height, its upper arm
 * foreshortened, the fist at his right jaw, the band a short line from the
 * tips to it. Two arms spread level across the chest instead read as a chest
 * expander.
 */
const FRONT_STANCE: SlingStance = {
  view: 'front',
  forkArm: {
    raised: { elbow: pt(-0.36, -1.44), wrist: pt(-0.27, -1.64) },
    load: { elbow: pt(-0.39, -1.32), wrist: pt(-0.17, -1.5) },
  },
  kick: pt(0, 0.03),
  anchor: { elbow: pt(0.6, -1.7), wrist: pt(0.33, -1.67) },
  pinch: { elbow: pt(0.34, 0.12), wrist: pt(0.1, -0.06) },
  snap: pt(0.08, -0.03),
  shot: pt(0, 0.06),
  frameUp: UPRIGHT,
  leftFoot: pt(-0.17, 0),
  rightFoot: pt(0.17, 0),
  lean: 0,
  crouch: 0.05,
  twist: -0.4,
  headTurn: 0.12,
  headTilt: 0,
  chinLift: -0.2,
  elbowFlare: 0,
  armsBehind: false,
  foreshorten: 1,
};

/**
 * From behind, aiming away: the fork arm points away from the camera, on the
 * far side of his head, so only the tips show past his left ear, canted a
 * little outward. What reads is the drawing elbow out at shoulder height and
 * back toward the camera, and the band from the tips to the fist behind his
 * right cheek.
 */
const BACK_STANCE: SlingStance = {
  ...FRONT_STANCE,
  view: 'back',
  forkArm: {
    raised: { elbow: pt(-0.36, -1.5), wrist: pt(-0.26, -1.6) },
    load: { elbow: pt(-0.38, -1.27), wrist: pt(-0.16, -1.42) },
  },
  kick: pt(0, -0.03),
  anchor: { elbow: pt(0.58, -1.62), wrist: pt(0.28, -1.7) },
  shot: pt(0, -0.06),
  frameUp: UPRIGHT + deg(10),
  twist: 0,
  headTurn: -0.12,
  armsBehind: true,
};

const STANCES: Readonly<Record<CarlView, SlingStance>> = {
  side: SIDE_STANCE,
  front: FRONT_STANCE,
  back: BACK_STANCE,
};

/** Poses an arm through the elbow and wrist `place` says, each segment drawn at the length that takes. */
function placeArmThrough(pose: CarlPose, side: BodySide, shoulder: Pt, place: ArmPlace): void {
  const angles = anglesThrough(shoulder, place.elbow, place.wrist);
  setArmAngles(pose, side, angles, upperArmShareThrough(shoulder, place.elbow));
}

function mixPlace(a: ArmPlace, b: ArmPlace, t: number): ArmPlace {
  return { elbow: mixPt(a.elbow, b.elbow, t), wrist: mixPt(a.wrist, b.wrist, t) };
}

function shiftPlace(place: ArmPlace, by: Pt): ArmPlace {
  return { elbow: offset(place.elbow, by.x, by.y), wrist: offset(place.wrist, by.x, by.y) };
}

function slingPose(stance: SlingStance, frame: number): CarlPose {
  const pose = restingPose();
  const draw = frameValue(DRAW_BY_FRAME, frame);
  const snap = frameValue(SNAP_BY_FRAME, frame);
  const kick = frameValue(FRAME_KICK_BY_FRAME, frame);
  const raise = frameValue(RAISE_BY_FRAME, frame);
  const pinched = frame >= PINCH_FRAME;

  pose.crouch = stance.crouch;
  pose.lean = stance.lean;
  pose.twist = stance.twist;
  pose.leftFoot = stance.leftFoot;
  pose.rightFoot = stance.rightFoot;
  pose.leftForeshorten = stance.foreshorten;
  pose.rightForeshorten = stance.foreshorten;
  pose.headTurn = stance.headTurn;
  pose.headTilt = stance.headTilt;
  pose.chinLift = stance.chinLift;
  pose.elbowFlare = stance.elbowFlare;
  pose.leftArmBehind = stance.armsBehind;
  pose.rightArmBehind = stance.armsBehind;
  pose.brow = pinched ? AIM_BROW : RELEASE_BROW;
  pose.blink = pinched ? AIM_SQUINT * draw : 0;

  const shoulders = buildSkeleton(pose, VIEWS[stance.view]);
  const kickBy = pt(stance.kick.x * kick, stance.kick.y * kick);
  // The pinch follows the fork down to where it is loaded, so the pouch is
  // taken from between the tips wherever they are.
  let forkWrist: Pt;
  if ('hand' in stance.forkArm) {
    const { hand, loadHand } = stance.forkArm;
    forkWrist = mixPt(loadHand, hand, raise);
    pose.leftHand = offset(forkWrist, kickBy.x, kickBy.y);
  } else {
    const forkArm = shiftPlace(mixPlace(stance.forkArm.load, stance.forkArm.raised, raise), kickBy);
    forkWrist = forkArm.wrist;
    placeArmThrough(pose, 'left', shoulders.leftArm.root, forkArm);
  }
  const pinch = shiftPlace(stance.pinch, forkWrist);
  const drawn = mixPlace(pinch, stance.anchor, draw);
  const snapBy = pt(stance.snap.x * snap, stance.snap.y * snap);
  const drawingArm = {
    elbow: offset(drawn.elbow, snapBy.x * SNAP_ELBOW_SHARE, snapBy.y * SNAP_ELBOW_SHARE),
    wrist: offset(drawn.wrist, snapBy.x, snapBy.y),
  };
  placeArmThrough(pose, 'right', shoulders.rightArm.root, drawingArm);
  pose.leftHandShape = 'grip';
  pose.leftFist = FULL_FIST;
  pose.rightHandShape = pinched ? 'grip' : 'open';
  pose.rightFist = pinched ? FULL_FIST : RELAXED_FIST;

  // The fork's angle and the pouch's place are read off the solved rig: the
  // fork is set upright against whatever angle the wrist ends up at, and the
  // pouch sits in the drawing fist, wherever the arm's solve put it.
  const skeleton = buildSkeleton(pose, VIEWS[stance.view]);
  const forkGrip = handGrip(skeleton.leftArm);
  const angle = stance.frameUp - forkGrip.haftAngle;
  const tether = pinched
    ? handGrip(skeleton.rightArm).centre
    : releasedPouch(stance, forkGrip.centre, frame);
  pose.heldProps = [
    {
      kind: 'slingshot',
      hand: 'left',
      angle,
      tether,
      ...(pinched ? { variant: SLINGSHOT_LOADED } : {}),
    },
  ];
  return pose;
}

/** Where the pouch is while no hand holds it: flying past the fork, whipping back, hanging. */
function releasedPouch(stance: SlingStance, forkGrip: Pt, frame: number): Pt | undefined {
  if (frame > REACH_FRAME) return undefined;
  const overshoot = frameValue(BAND_OVERSHOOT_BY_FRAME, frame);
  const betweenTips = offset(forkGrip, 0, -SLINGSHOT_TIPS_ABOVE_GRIP);
  return offset(betweenTips, stance.shot.x * overshoot, stance.shot.y * overshoot);
}

export function slingSide(frame: number): CarlPose {
  return slingPose(STANCES.side, frame);
}

export function slingFront(frame: number): CarlPose {
  return slingPose(STANCES.front, frame);
}

export function slingBack(frame: number): CarlPose {
  return slingPose(STANCES.back, frame);
}
