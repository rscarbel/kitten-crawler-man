/**
 * Carl's body measurements, in tile units before the figure is scaled into its
 * cell.
 */

// Heights are y values, so they are negative: the origin sits between the feet
// and the screen's +Y runs down. Carl stands two tiles tall.

/**
 * Total standing height and the head that height is divided into. The head
 * this sets is the skull's two radii; the skull traces past them at crown and
 * chin and the hair stands on top, so the painted head, hair to chin, is about
 * 1.3 of it and he draws about four and a half heads tall. That is a
 * game-character proportion, not a life drawing: the head has to be a clear
 * ball on top of the silhouette at a 32 px tile, and an anatomically-correct
 * seven-head figure reads as a pinhead there. Much past it the other way,
 * edge-on the head reads as deep as his chest — the profile is where a big
 * head shows first, because the torso there is only as deep as a ribcage.
 * The generator scales the whole figure down to the tile footprint afterwards.
 */
export const FIGURE_HEIGHT = 2.03;
const HEADS_TALL = 5.5;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

/**
 * Slack so a planted leg is not mathematically locked straight. It has to stay
 * tiny: the knee's sideways travel grows as the square root of it, and head-on
 * a knee should read as the leg *narrowing*, not as an angle in it. A few
 * percent here bows the legs into a pair of parentheses.
 */
const LEG_SLACK = 1.004;
export const ANKLE_Y = -0.085;
const KNEE_Y = -0.55;
/** The hip sits at half the standing height, which is where a human's does. */
export const HIP_Y = -FIGURE_HEIGHT / 2;
export const WAIST_Y = -1.17;
export const SHOULDER_Y = -1.6;
/**
 * The chin sits high enough over the shoulder line to show a short, thick
 * neck between it and the jacket's collar. Lower, the chin rests on the
 * collar and he reads as a man with no neck at all, which at the 32 px tile
 * is the same read as a hunch. The head is hung from the chin rather than
 * placed by its centre, so the neck keeps its length whatever the head's size.
 */
const CHIN_Y = -1.67;
/** How far the point of the chin hangs below the head's centre, in head radii. */
export const HEAD_CHIN_DROP = 1.22;
export const HEAD_CENTRE_Y = CHIN_Y - (HEAD_HEIGHT / 2) * HEAD_CHIN_DROP;

export const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
export const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
export const UPPER_ARM_LENGTH = 0.34;
export const FOREARM_LENGTH = 0.3;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/** Shoulders are the widest thing on him; the hips are markedly narrower. */
export const SHOULDER_HALF = 0.28;
/**
 * Head-on the shoulders carry the whole read of his build, and the arms hang
 * off them: set them at the profile's width and he stands with his arms tucked
 * in, which is a slight, unathletic stature at any tile size. Set wider than
 * the hands hang (`HAND_HANG_SPREAD`), the arms angle in from the deltoids to
 * the hips, and that is the V taper head-on and from behind: with the arms
 * hanging straight down the silhouette is a box however the jacket tapers.
 */
export const FACING_SHOULDER_SPREAD = 1.4;
export const HIP_HALF = 0.16;
/**
 * Where the thigh roots, measured in from the hip. It cannot be narrower than
 * the thigh's own half-width or the two thighs overlap into a single mass at
 * the top and the legs read as one wedge splitting downward.
 */
export const LEG_ROOT_HALF = 0.118;
export const CHEST_HALF = 0.26;
export const WAIST_HALF = 0.2;
/** Arms root at the jacket's shoulder edge, not inside its silhouette. */
const ARM_INSET = 1;
/** Half the distance between the two arm roots, before any view narrowing. */
export const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;
/** Where the arms root head-on, once the shoulders are spread. */
export const FACING_ARM_ROOT_HALF = ARM_ROOT_HALF * FACING_SHOULDER_SPREAD;
/** The shoulder joint hangs below the shoulder line, under the deltoid. */
export const SHOULDER_JOINT_DROP = 0.055;

/**
 * Limb half-widths are shares of the limb's own bone, never of the head: at
 * 4.8 heads tall the head is deliberately oversized, and a life-drawing ratio
 * hung off it inflates every limb. The shares are a heavy-framed lifter's —
 * a thigh at its root is half as wide as it is long.
 */
export const THIGH_WIDTH = THIGH_LENGTH * 0.3;
/**
 * Edge-on a thigh shows its depth — quad in front, hamstring behind — and a
 * heavy thigh is deeper than it is wide, so the profile draws it this much
 * wider than head-on. The boxers' cuffs have to clear that depth too.
 */
export const PROFILE_THIGH_DEPTH = 1.3;
/** Head-on a knee reads as the leg narrowing, so it sits well inside both thigh and calf. */
export const KNEE_WIDTH = THIGH_LENGTH * 0.14;
/** Big calves: at the belly nearly as wide as the thigh is just above the knee. */
export const CALF_WIDTH = THIGH_LENGTH * 0.24;
export const ANKLE_WIDTH = THIGH_LENGTH * 0.09;
/** How far down the shin the calf reaches its widest: the gastrocnemius sits high. */
export const CALF_AT = 0.28;
export const UPPER_ARM_WIDTH = 0.064;
export const ELBOW_WIDTH = FOREARM_LENGTH * 0.19;
/**
 * The brachioradialis and wrist extensors bunch just below the elbow, so the
 * forearm is widest a quarter of the way down — past the elbow's own width.
 */
export const FOREARM_BELLY_WIDTH = FOREARM_LENGTH * 0.31;
/** A thick wrist: three fifths of the forearm's belly rather than half. */
export const WRIST_WIDTH = FOREARM_LENGTH * 0.19;
/** The jacket sleeve is padded over the arm inside it. */
export const SLEEVE_BULK = 0.011;

/**
 * Head-on the head is a tall oval, not a ball: the skull is about three
 * quarters as wide as it is tall, and a round head is what makes any chin
 * drawn under it read as blocky, however narrow the chin.
 */
const HEAD_WIDTH_RATIO = 0.74;
const HEAD_DEPTH_RATIO = 0.85;
export const HEAD_RY = HEAD_HEIGHT / 2;
export const HEAD_RX = HEAD_RY * HEAD_WIDTH_RATIO;
/**
 * Half the head's depth, front to back. A head is markedly narrower across than
 * it is deep, so the profile keeps the roomier proportion the front view gave
 * up: sharing one radius makes the face either round head-on or shallow in
 * profile, and there is no value that is right for both. It stops short of
 * the skull's full height, though: with the nose and the hair behind it the
 * profile head is already most of his chest's depth, and a deeper one reads
 * as big as his torso.
 */
export const HEAD_DEPTH = HEAD_RY * HEAD_DEPTH_RATIO;
/**
 * Half-width of the neck column where it leaves the shoulders. A heavy-framed
 * man's neck is nearly as wide as his jaw — about three-quarters of the head's
 * width — and a narrower one puts his head on a stalk.
 */
export const NECK_WIDTH = 0.112;

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
export const PROFILE_LATERAL = 0.3;
