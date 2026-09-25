/**
 * Carl working a resource node: chopping a trunk with an axe and breaking
 * rock with a pick, each a looping two-handed swing in all three views.
 *
 * The tool itself is not in these cells. Its tier changes what it looks like,
 * and a cell is shared by every tier, so it is drawn over the finished figure
 * by `toolOverlaySprite.ts`, along the line his two fists define on each
 * frame. That line is the contract with the overlay: one fist holds the butt
 * — his left unless the row table names his right — and the other sits
 * further up the haft, so the direction from one grip to the other is the
 * way the tool points.
 *
 * Both swings keep his feet where they stand: a man working a trunk or a rock
 * face plants his stance once and swings from the hips and shoulders.
 *
 * Every swing has the same shape: the blow lands, the tool is worked loose on
 * the next frame, lifted steadily back to full cock, and driven through four
 * fast frames onto the blow again. The recovery is interpolated so its steps
 * stay even — a swing whose slow half drifts by in tiny steps and whose fast
 * half jumps reads as a stutter, not a rhythm.
 */

import { mixPt, pt } from '../carl/geometry';
import { handGrip } from '../carl/limbs';
import { type BodySide, buildSkeleton, type CarlPose, type CarlView, VIEWS } from '../carl/rig';
import { deg, lerp, type Pt } from '../carlArt';
import { idleBack, idleFront, idleSide } from './idles';

// ── Timing ───────────────────────────────────────────────────────────────────

/**
 * One swing per loop: the blow, a frame to work the tool loose, seven lifting
 * it to full cock, and three driving it onto the next blow.
 */
export const CHOP_FRAMES = 12;
/** Five ticks a frame makes the chop one swing a second, the pace a wood harvest pays at. */
export const CHOP_TICKS_PER_FRAME = 5;
/** The frame the axe bites the trunk. */
export const CHOP_IMPACT_FRAME = 8;

export const MINE_FRAMES = 12;
/**
 * Seven ticks a frame is a swing every 1.4 s: the pick is heavier and swung
 * from overhead, so it comes round a little slower than the axe, near the
 * pace a stone harvest pays at.
 */
export const MINE_TICKS_PER_FRAME = 7;
/** The frame the pick's point strikes the rock. */
export const MINE_IMPACT_FRAME = 8;

/**
 * Frames from full cock to the blow. Four even steps: the drive is the
 * fastest the tool moves, and three would make each step a snap against the
 * lift's.
 */
const DRIVE_FRAMES = 4;

// ── The haft between the fists ───────────────────────────────────────────────

/**
 * How far up the haft the upper (right) fist sits from the butt (left) fist,
 * in rig units, with the haft lying in the picture plane: a hand's width
 * apart, enough for the line between the grips to say which way the tool
 * points on every frame. The overlay reads how much of it shows as how far
 * the haft is turned out of the picture.
 */
export const TOOL_GRIP_SPACING = 0.13;

/** The fist at the butt on a swing that names none. */
const DEFAULT_BUTT_HAND: BodySide = 'left';

/**
 * One moment of a swing: where the butt fist is, which way the haft points
 * (degrees, figure space as authored, 0 toward +X, positive turning clockwise
 * down the screen), and how much of the fists' spacing shows — under 1 while
 * the haft swings toward or away from the camera, which is the only way a
 * flat picture can show it turning out of the picture plane.
 *
 * Angles are unwrapped along the swing, so a key may read past 360: an
 * interpolation between two keys turns the way the tool travels.
 */
interface SwingKey {
  readonly butt: Pt;
  readonly haftDegrees: number;
  readonly spacing: number;
  /**
   * Which fist holds the butt on this frame; absent is his left. A swing
   * that carries the haft across his body slides his grip, so that the fist
   * further up the haft is always the one on the side the head points to.
   */
  readonly buttHand?: BodySide;
}

function key(
  x: number,
  y: number,
  haftDegrees: number,
  spacing = 1,
  buttHand?: BodySide,
): SwingKey {
  return { butt: pt(x, y), haftDegrees, spacing, ...(buttHand === undefined ? {} : { buttHand }) };
}

/**
 * A whole swing, from which every frame is derived.
 *
 * - `impact`: the blow. `pull`: the frame after, the tool worked loose.
 * - `cock`: fully drawn back, {@link DRIVE_FRAMES} before the blow.
 * - `liftBulge`: how far the fists' path bows out on the way up, at its
 *   middle, so they travel round the body rather than straight through it.
 * - Each key's `spacing` may run past 1 for a grip wider than a hand's
 *   width: the overlay only reads the haft's direction and caps its length.
 * - `drive`: the frames between the cock and the blow, when a straight
 *   interpolation cannot show the haft swinging through the camera.
 * - `everyFrame`: a swing authored frame by frame, indexed by frame, where
 *   neither interpolation can keep the fists apart and the tool off his
 *   face; the other keys then only pace the body's coil.
 */
interface SwingPlan {
  readonly frames: number;
  readonly impactFrame: number;
  readonly impact: SwingKey;
  readonly pull: SwingKey;
  readonly cock: SwingKey;
  readonly liftBulge: Pt;
  readonly driveBulge: Pt;
  readonly drive?: readonly SwingKey[];
  readonly everyFrame?: readonly SwingKey[];
}

function mixKey(a: SwingKey, b: SwingKey, t: number, bulge: Pt): SwingKey {
  const bow = Math.sin(Math.PI * t);
  const along = mixPt(a.butt, b.butt, t);
  return {
    butt: pt(along.x + bulge.x * bow, along.y + bulge.y * bow),
    haftDegrees: lerp(a.haftDegrees, b.haftDegrees, t),
    spacing: lerp(a.spacing, b.spacing, t),
    ...(a.buttHand === undefined ? {} : { buttHand: a.buttHand }),
  };
}

function wrapFrame(frame: number, frames: number): number {
  return ((frame % frames) + frames) % frames;
}

/**
 * Where the swing is on `frame`: its key, and how coiled the body is — 1 at
 * full cock, 0 on the blow — for the channels that follow the swing (lean,
 * crouch, twist, the head).
 */
function swingAt(plan: SwingPlan, frame: number): { key: SwingKey; coil: number } {
  const paced = swingPacedAt(plan, frame);
  const authored = plan.everyFrame?.[wrapFrame(frame, plan.frames)];
  return authored === undefined ? paced : { key: authored, coil: paced.coil };
}

function swingPacedAt(plan: SwingPlan, frame: number): { key: SwingKey; coil: number } {
  const { frames, impactFrame } = plan;
  const sinceImpact = wrapFrame(frame - impactFrame, frames);
  if (sinceImpact === 0) return { key: plan.impact, coil: 0 };
  const liftSteps = frames - DRIVE_FRAMES - 1;
  if (sinceImpact <= liftSteps + 1) {
    const t = (sinceImpact - 1) / liftSteps;
    return { key: mixKey(plan.pull, plan.cock, t, plan.liftBulge), coil: t };
  }
  const intoDrive = sinceImpact - liftSteps - 1;
  const authored = plan.drive?.[intoDrive - 1];
  // Even steps: a drive that saves its travel for the last frame reads as the
  // tool teleporting onto the blow, not as speed.
  const t = intoDrive / DRIVE_FRAMES;
  return {
    key: authored ?? mixKey(plan.cock, plan.impact, t, plan.driveBulge),
    coil: 1 - t,
  };
}

/**
 * Passes of the grip correction below. Each pass moves a wrist by its grip's
 * remaining error, which changes the forearm's angle only slightly, so the
 * error shrinks several times over per pass; three leave it well under a
 * cell pixel.
 */
const GRIP_SOLVE_PASSES = 3;

/**
 * Places both fists round the haft of `swing`, gripping it.
 *
 * The pose's hand targets are wrists, but a fist grips a hand's length past
 * its wrist, along the forearm — and head-on the two forearms point in
 * opposite directions, so two wrists a hand's width apart put the two grips
 * almost on top of each other. The wrists are nudged until the grips, which
 * are what the tool is drawn through, land where the swing puts them.
 */
function gripHaft(pose: CarlPose, swing: SwingKey, view: CarlView): void {
  const buttHand = swing.buttHand ?? DEFAULT_BUTT_HAND;
  const reach = TOOL_GRIP_SPACING * swing.spacing;
  const haft = deg(swing.haftDegrees);
  const buttGrip = swing.butt;
  const upperGrip = pt(buttGrip.x + Math.cos(haft) * reach, buttGrip.y + Math.sin(haft) * reach);
  const leftGrip = buttHand === 'left' ? buttGrip : upperGrip;
  const rightGrip = buttHand === 'left' ? upperGrip : buttGrip;
  pose.leftArmAngles = null;
  pose.rightArmAngles = null;
  pose.leftHandShape = 'grip';
  pose.rightHandShape = 'grip';
  pose.leftHand = leftGrip;
  pose.rightHand = rightGrip;
  for (let pass = 0; pass < GRIP_SOLVE_PASSES; pass++) {
    const skeleton = buildSkeleton(pose, VIEWS[view]);
    const left = handGrip(skeleton.leftArm).centre;
    const right = handGrip(skeleton.rightArm).centre;
    pose.leftHand = pt(
      pose.leftHand.x + leftGrip.x - left.x,
      pose.leftHand.y + leftGrip.y - left.y,
    );
    pose.rightHand = pt(
      pose.rightHand.x + rightGrip.x - right.x,
      pose.rightHand.y + rightGrip.y - right.y,
    );
  }
}

/** A body channel's value at `coil`, between its value on the blow and at full cock. */
interface CoilRange {
  readonly blow: number;
  readonly cocked: number;
}

function coiled(range: CoilRange, coil: number): number {
  return lerp(range.blow, range.cocked, coil);
}

const WORK_BROW = 0.8;
/** The grunt as a blow lands. */
const IMPACT_MOUTH = 0.35;
/** Edge-on both elbows fold forward, in front of the chest. */
const SIDE_WORK_ELBOW_FLARE = -0.35;
/**
 * Head-on the elbows are held well out from the ribs: with the fists close
 * together on one haft, elbows kept in draw the two forearms crossed over
 * his chest.
 */
const FACING_WORK_ELBOW_FLARE = 0.9;

// ── Profile ──────────────────────────────────────────────────────────────────
//
// Both profile swings are one round turn of the tool, clockwise: from the
// blow the head swings down past his shins and back behind him, rises behind
// his back to stand over his head, and comes over the top onto the next blow.
// The tool never passes in front of his face — edge-on an elbow folds forward,
// so a tool raised straight up in front of him lays both it and the near arm
// across the face.

/** The fists' path bows down and back on the lift, round his hip rather than up his chest. */
const SIDE_LIFT_BULGE = pt(-0.14, 0.16);

/**
 * An angled notch cut into the trunk ahead of him at waist height. The drive
 * is authored for the reason the pick's is: brought over the crown, not
 * across the face.
 */
const CHOP_SIDE: SwingPlan = {
  frames: CHOP_FRAMES,
  impactFrame: CHOP_IMPACT_FRAME,
  impact: key(0.47, -1.08, 732),
  pull: key(0.4, -1.14, 352),
  cock: key(-0.3, -1.8, 570),
  liftBulge: SIDE_LIFT_BULGE,
  driveBulge: pt(0, 0),
  drive: [key(-0.16, -2.0, 610), key(0.22, -1.66, 668), key(0.4, -1.38, 705)],
};
const CHOP_SIDE_LEAN: CoilRange = { blow: 0.2, cocked: -0.04 };
/** Eyes on the notch through the swing, a little down. */
const CHOP_SIDE_HEAD_TILT = 0.18;
const CHOP_CROUCH: CoilRange = { blow: 0.16, cocked: 0.1 };
/** A wide split stance, the lead (far) foot toward the trunk. */
const CHOP_SIDE_LEAD_FOOT = pt(0.19, 0);
const CHOP_SIDE_REAR_FOOT = pt(-0.17, 0);

/**
 * The pick brought over the crown and down until its point strikes the rock
 * ahead of his feet. The drive is authored: interpolated, it would carry the
 * fists across his face on the way over.
 */
const MINE_SIDE: SwingPlan = {
  frames: MINE_FRAMES,
  impactFrame: MINE_IMPACT_FRAME,
  impact: key(0.42, -0.95, 742),
  pull: key(0.4, -1.0, 370),
  cock: key(-0.29, -1.9, 555),
  liftBulge: SIDE_LIFT_BULGE,
  driveBulge: pt(0, 0),
  drive: [key(-0.02, -2.06, 592), key(0.36, -1.62, 665), key(0.44, -1.25, 705)],
};
/** Bent over the rock on the blow, upright to lift the pick overhead. */
const MINE_SIDE_LEAN: CoilRange = { blow: 0.42, cocked: -0.06 };
const MINE_CROUCH: CoilRange = { blow: 0.34, cocked: 0.06 };
/** Watching the point: down at the rock, up at the pick overhead. */
const MINE_SIDE_HEAD_TILT: CoilRange = { blow: 0.4, cocked: -0.14 };
const MINE_SIDE_LEAD_FOOT = pt(0.18, 0);
const MINE_SIDE_REAR_FOOT = pt(-0.18, 0);

// ── Head-on and from behind ─────────────────────────────────────────────────
//
// The pick is an overhead swing: carried up his right side, off his face, to
// stand over his head with both fists above his crown, and brought down over
// his right shoulder onto the blow. The axe is a level swing at the waist.
// Each fist stays on its own side of his centreline wherever the tool shows
// its length, which keeps the forearms from reading as crossed.

/** Up his right side on the lift, clear of the face. */
const FACING_LIFT_BULGE = pt(0.27, 0);

/**
 * The pick, head-on and from behind, comes down over his right shoulder and
 * strikes the ground ahead of his right foot. Brought down his
 * middle, the tool is lost against his body: head-on it collapses into his
 * torso, and from behind his body hides it outright. Out to the side, the
 * head stays outside his silhouette on the blow and the frames round it.
 *
 * The overhead is set a little to his right as well, so the handle stands
 * beside his head rather than down over his face.
 */
const OVER_RIGHT_SHOULDER_COCK = key(0.08, -2.0, -62, 0.7);
const OVER_RIGHT_SHOULDER_DRIVE: readonly SwingKey[] = [
  key(0.08, -1.96, -68),
  key(0.12, -1.66, -25),
  key(0.13, -1.36, 20),
];

/**
 * The axe, head-on and from behind: an overhead chop into a trunk in front
 * of him. It is raised high over his right shoulder, then brought down on a
 * diagonal across his front and driven into the foot of the trunk before
 * him: bent over from the hips and deep in his knees, arms reaching down,
 * the fists together low in front of him and the head landing at his feet on
 * his centreline. It recovers back up the same line.
 *
 * It is told apart from the pick by where it lands: the pick drops out to
 * the rock beside his right foot, the axe onto the trunk straight ahead.
 *
 * The tool is drawn from the butt fist through the other, so the fist
 * further up the haft has to be on the side the head points to or his
 * forearms cross. His grip slides as the haft passes upright over his
 * shoulder: his left fist holds the butt while the head is up on his right,
 * his right fist once it swings over. His fists climb to shoulder height on
 * his right before the haft tips over, so the haft passes above his face
 * rather than across it. On the blow the arms reach down to the fists at
 * nearly their full length: bent to fists held higher, the forearms lie
 * level across his belly and read as folded, and from behind as hands on
 * hips.
 */
const CHOP_FRONT_FRAMES: readonly SwingKey[] = [
  key(0.22, -1.72, 222, 1, 'right'),
  key(0.17, -1.9, 248, 1, 'right'),
  key(0.12, -1.89, -80),
  key(0.11, -1.87, -72),
  key(0.1, -1.85, -65),
  key(0.17, -1.72, 240, 1, 'right'),
  key(0.14, -1.44, 190, 1, 'right'),
  key(0.08, -1.12, 128, 1, 'right'),
  key(0.02, -0.8, 100, 1, 'right'),
  key(0.04, -0.9, 110, 0.8, 'right'),
  key(0.1, -1.18, 150, 1, 'right'),
  key(0.2, -1.38, 178, 1, 'right'),
];
const CHOP_FRONT: SwingPlan = {
  frames: CHOP_FRAMES,
  impactFrame: CHOP_IMPACT_FRAME,
  impact: CHOP_FRONT_FRAMES[CHOP_IMPACT_FRAME],
  pull: CHOP_FRONT_FRAMES[CHOP_IMPACT_FRAME + 1],
  cock: CHOP_FRONT_FRAMES[CHOP_IMPACT_FRAME - DRIVE_FRAMES],
  liftBulge: pt(0, 0),
  driveBulge: pt(0, 0),
  everyFrame: CHOP_FRONT_FRAMES,
};
/**
 * From behind, a blow straight down in front of him happens behind his
 * body, so the haft is angled out toward his left on the blow: the head
 * comes down by his left foot, clear of his leg, where it can be seen.
 */
const CHOP_BACK_FRAMES: readonly SwingKey[] = CHOP_FRONT_FRAMES.map((frameKey, frame) => {
  if (frame === CHOP_IMPACT_FRAME) return key(0.03, -0.75, 125, 1, 'right');
  if (frame === CHOP_IMPACT_FRAME + 1) return key(0.05, -0.82, 132, 0.95, 'right');
  return frameKey;
});
const CHOP_BACK: SwingPlan = { ...CHOP_FRONT, everyFrame: CHOP_BACK_FRAMES };

/** Which fist holds the butt on each frame of the head-on and from-behind chop, for the row table. */
export const CHOP_FACING_TOOL_BUTTS: readonly BodySide[] = CHOP_FRONT_FRAMES.map(
  (frameKey) => frameKey.buttHand ?? DEFAULT_BUTT_HAND,
);
/** Head-on the shoulders turn with the swing: toward his right at the wind-up, his left on the blow. */
const CHOP_FACING_TWIST: CoilRange = { blow: -0.25, cocked: 0.25 };
/** Leaning a little into the blow, toward his left, and back over his right on the wind-up. */
const CHOP_FACING_LEAN: CoilRange = { blow: -0.06, cocked: 0.04 };
/** Elbows kept in, so each arm runs straight to its fist rather than folding across his front. */
const CHOP_FACING_ELBOW_FLARE = 0.3;
/** Sunk into his knees on the blow, which lets his arms reach down in front of him. */
const CHOP_FACING_CROUCH: CoilRange = { blow: 0.6, cocked: 0.1 };
/**
 * On the blow he bends from the hips over the strike, head-on toward the
 * camera and from behind away from it: with the knee bend, it is what lets
 * his arms reach down to fists low enough for the head to land ahead of his
 * feet. Applied mostly near the blow — the bend grows faster than how far
 * he has uncoiled, so the wind-up stands tall.
 */
const CHOP_FACING_BLOW_PITCH = 0.9;
/** How sharply the bend gathers toward the blow: 1 grows it evenly through the swing, higher saves it for the blow. */
const CHOP_FACING_PITCH_RISE = 1.5;
const CHOP_FACING_FOOT_SPREAD = 0.19;

/** The pick lands outside his right foot, a little further out than the axe bites. */
const MINE_FRONT: SwingPlan = {
  frames: MINE_FRAMES,
  impactFrame: MINE_IMPACT_FRAME,
  impact: key(0.14, -1.06, 58),
  pull: key(0.16, -1.12, 48),
  cock: OVER_RIGHT_SHOULDER_COCK,
  liftBulge: FACING_LIFT_BULGE,
  driveBulge: pt(0, 0),
  drive: OVER_RIGHT_SHOULDER_DRIVE,
};
const MINE_BACK: SwingPlan = MINE_FRONT;
/** Head-on the chest pitches over the rock on the blow. */
const MINE_FACING_PITCH: CoilRange = { blow: 0.45, cocked: -0.05 };
/** Head-on a head tipped down to the rock is the chin dropping. */
const MINE_FACING_CHIN: CoilRange = { blow: -0.6, cocked: 0.35 };
const MINE_FACING_FOOT_SPREAD = 0.2;

function workingSide(
  plan: SwingPlan,
  frame: number,
  body: {
    readonly crouch: CoilRange;
    readonly lean: CoilRange;
    readonly headTilt: CoilRange;
    readonly lead: Pt;
    readonly rear: Pt;
  },
): CarlPose {
  const { key: swing, coil } = swingAt(plan, frame);
  const pose = idleSide(0);
  pose.crouch = coiled(body.crouch, coil);
  pose.leftFoot = body.lead;
  pose.rightFoot = body.rear;
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = true;
  pose.lean = coiled(body.lean, coil);
  pose.headTilt = coiled(body.headTilt, coil);
  pose.elbowFlare = SIDE_WORK_ELBOW_FLARE;
  gripHaft(pose, swing, 'side');
  return pose;
}

function workingFacing(
  plan: SwingPlan,
  frame: number,
  back: boolean,
  footSpread: number,
  crouch: CoilRange,
  shape: (pose: CarlPose, coil: number) => void,
): CarlPose {
  const { key: swing, coil } = swingAt(plan, frame);
  const pose = back ? idleBack(0) : idleFront(0);
  pose.crouch = coiled(crouch, coil);
  pose.leftFoot = pt(-footSpread, 0);
  pose.rightFoot = pt(footSpread, 0);
  pose.leftFootPlanted = true;
  pose.rightFootPlanted = true;
  pose.elbowFlare = FACING_WORK_ELBOW_FLARE;
  if (back) {
    pose.leftArmBehind = true;
    pose.rightArmBehind = true;
  }
  // Shaped before the grip is solved: the fists are placed from shoulders
  // wherever the body's lean and turn have put them.
  shape(pose, coil);
  gripHaft(pose, swing, back ? 'back' : 'front');
  return pose;
}

export function chop(frame: number, view: CarlView): CarlPose {
  const f = wrapFrame(frame, CHOP_FRAMES);
  let pose: CarlPose;
  if (view === 'side') {
    pose = workingSide(CHOP_SIDE, f, {
      crouch: CHOP_CROUCH,
      lean: CHOP_SIDE_LEAN,
      headTilt: { blow: CHOP_SIDE_HEAD_TILT, cocked: CHOP_SIDE_HEAD_TILT },
      lead: CHOP_SIDE_LEAD_FOOT,
      rear: CHOP_SIDE_REAR_FOOT,
    });
  } else {
    const back = view === 'back';
    pose = workingFacing(
      back ? CHOP_BACK : CHOP_FRONT,
      f,
      back,
      CHOP_FACING_FOOT_SPREAD,
      CHOP_FACING_CROUCH,
      (body, coil) => {
        body.twist = coiled(CHOP_FACING_TWIST, coil);
        body.torsoPitch = CHOP_FACING_BLOW_PITCH * Math.pow(1 - coil, CHOP_FACING_PITCH_RISE);
        body.lean = coiled(CHOP_FACING_LEAN, coil);
        body.elbowFlare = CHOP_FACING_ELBOW_FLARE;
      },
    );
  }
  pose.brow = WORK_BROW;
  pose.mouth = f === CHOP_IMPACT_FRAME ? IMPACT_MOUTH : 0;
  return pose;
}

export function mine(frame: number, view: CarlView): CarlPose {
  const f = wrapFrame(frame, MINE_FRAMES);
  let pose: CarlPose;
  if (view === 'side') {
    pose = workingSide(MINE_SIDE, f, {
      crouch: MINE_CROUCH,
      lean: MINE_SIDE_LEAN,
      headTilt: MINE_SIDE_HEAD_TILT,
      lead: MINE_SIDE_LEAD_FOOT,
      rear: MINE_SIDE_REAR_FOOT,
    });
  } else {
    const back = view === 'back';
    pose = workingFacing(
      back ? MINE_BACK : MINE_FRONT,
      f,
      back,
      MINE_FACING_FOOT_SPREAD,
      MINE_CROUCH,
      (body, coil) => {
        body.torsoPitch = coiled(MINE_FACING_PITCH, coil);
        body.chinLift = coiled(MINE_FACING_CHIN, coil);
      },
    );
  }
  pose.brow = WORK_BROW;
  pose.mouth = f === MINE_IMPACT_FRAME ? IMPACT_MOUTH : 0;
  return pose;
}
