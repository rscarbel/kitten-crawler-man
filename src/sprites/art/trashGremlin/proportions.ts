/**
 * The Trash Gremlin's body, in tile units with the origin on the ground between
 * its feet, +Y down. Every joint is pinned to the upright figure — the pose the
 * summon rears into — and the crouch it spends the rest of its life in is a
 * pose, not a second set of numbers.
 *
 * Nothing here is hung off the head. The head is deliberately broad and the
 * ears enormous, so a limb sized as a share of either would balloon; each limb
 * is sized off the joint heights it spans, and the hands off the forearm.
 */

/** Height the ankle stands above the sole. */
export const ANKLE_HEIGHT = 0.1;
/** The pelvis, standing fully upright. */
export const HIP_Y = -0.84;
/** How far below the pelvis point the thigh sockets sit. */
export const HIP_JOINT_DROP = 0.04;
/** Half the distance between the thigh sockets. */
export const LEG_ROOT_HALF = 0.13;

/**
 * IK slack goes into the knee as a square root, so the bones are a hair longer
 * than the joint spans they are drawn across and the reach stops a hair short
 * of locking — real bends come from the pose, never from slack.
 */
export const JOINT_SLACK = 0.0003;
export const THIGH_LENGTH = 0.42;
export const SHIN_LENGTH = 0.4;
export const LEG_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/** Pelvis to the shoulder line, along the spine. */
export const TORSO_LENGTH = 0.8;
/** Half the shoulder span: narrow, because the ears and the lid carry the width. */
export const SHOULDER_HALF = 0.25;
/** How far down the spine from the chest point the shoulder sockets sit. */
export const SHOULDER_DROP = 0.07;

/**
 * Arms long enough that a relaxed hand hangs past the knee when it stands
 * upright, and drags its knuckles near the floor in its crouch.
 */
export const UPPER_ARM_LENGTH = 0.52;
export const FOREARM_LENGTH = 0.5;
export const ARM_REACH = UPPER_ARM_LENGTH + FOREARM_LENGTH - JOINT_SLACK;
/** Oversized on purpose: most of the forearm, against a human's third. */
export const HAND_LENGTH = FOREARM_LENGTH * 0.7;

/** Where the neck leaves the chest, along the spine past the chest point. */
export const NECK_BASE = 0.03;
export const NECK_LENGTH = 0.14;

/** The head is broad and flat: much wider than tall, and shallower than wide. */
export const HEAD_RX = 0.4;
export const HEAD_RY = 0.27;
/** Half the head's depth front to back, which is what the profile shows. */
export const HEAD_DEPTH = 0.34;
/** The head's centre above the top of the neck. */
export const HEAD_ABOVE_NECK = HEAD_RY * 0.72;

/** Limb thicknesses, as radii. Stringy: the elbow and knee are knobs on sticks. */
export const THIGH_ROOT_RADIUS = 0.078;
export const KNEE_RADIUS = 0.05;
export const ANKLE_RADIUS = 0.034;
export const UPPER_ARM_ROOT_RADIUS = 0.072;
export const ELBOW_RADIUS = 0.05;
export const WRIST_RADIUS = 0.04;
export const NECK_RADIUS = 0.085;

/** The foot: a short heel and three long splayed toes. */
export const TOE_LENGTH = 0.34;
export const HEEL_LENGTH = 0.07;
export const TOE_RADIUS = 0.05;
export const CLAW_LENGTH = 0.09;

/** The tail, from its root at the base of the spine to its tip. */
export const TAIL_LENGTH = 1.45;
export const TAIL_ROOT_RADIUS = 0.04;
export const TAIL_TIP_RADIUS = 0.009;

/** The bin lid strapped to its back, and how far its dome bulges. */
export const LID_RADIUS = 0.43;
export const LID_DOME = 0.2;
