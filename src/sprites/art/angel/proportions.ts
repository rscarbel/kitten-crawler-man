/**
 * Angel's body landmarks, in figure units.
 *
 * A figure unit is half a tile: she is painted at `FIGURE_SCALE` tiles per unit
 * so she stands about two tiles tall. The origin is her centreline at the
 * height of her tile's centre, +y runs down, and the floor under her is
 * `FOOT_Y`. Every view and every painter reads its geometry from here, so the
 * front, back and profile drawings are always the same woman.
 *
 * She is about six heads tall with the crotch at roughly 44 % of her height —
 * an idealised figure with the oversized head every character in this game
 * carries. Legs shorter than that read as a long torso on stumps the moment she
 * walks.
 */

export const FIGURE_SCALE = 2;
/** Where her soles meet the floor, in tile fractions below the tile's centre. */
export const TILE_GROUND_Y = 0.455;

/* ── Head and neck ─────────────────────────────────────────────────────── */

export const HEAD_CENTER_Y = -0.315;
export const HEAD_RADIUS_X = 0.064;
export const HEAD_RADIUS_Y = 0.082;
export const JAW_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.9;
export const NECK_HALF_WIDTH = 0.024;
export const NECK_TOP_Y = JAW_Y - 0.01;

/* ── Torso ─────────────────────────────────────────────────────────────── */

export const SHOULDER_Y = -0.2;
export const SHOULDER_HALF_WIDTH = 0.098;
export const BUST_Y = -0.13;
export const BUST_HALF_WIDTH = 0.1;
/**
 * From behind the bust still shows past the ribs, but only as a side swell;
 * carried round at full projection it puts two bulges under her shoulder blades.
 */
export const BACK_CHEST_HALF_WIDTH = 0.094;
export const ARMPIT_Y = SHOULDER_Y + 0.026;
export const ARMPIT_HALF_WIDTH = SHOULDER_HALF_WIDTH * 0.94;
export const RIBCAGE_HALF_WIDTH = 0.072;
export const WAIST_Y = -0.022;
export const WAIST_HALF_WIDTH = 0.058;
export const HIP_Y = 0.075;
export const HIP_HALF_WIDTH = 0.098;
export const CROTCH_Y = 0.142;
export const WAIST_TO_HIP_CONTROL_RISE = 0.05;

export const BUST_POINT_X = 0.048;
export const BUST_POINT_Y = -0.115;
export const BUST_WIDEST_Y = BUST_POINT_Y + 0.004;
export const RIBCAGE_Y = BUST_POINT_Y + 0.052;

/* ── Legs ──────────────────────────────────────────────────────────────── */

export const FOOT_Y = 0.572;
/** The femoral head sits low in the pelvis, level with the top of the thigh gap. */
export const HIP_JOINT_Y = 0.09;
export const HIP_JOINT_X = 0.05;
export const KNEE_Y = 0.312;
export const ANKLE_Y = 0.53;
export const THIGH_LENGTH = KNEE_Y - HIP_JOINT_Y;
export const SHIN_LENGTH = ANKLE_Y - KNEE_Y;
export const ANKLE_HEIGHT = FOOT_Y - ANKLE_Y;
export const LEG_LENGTH = THIGH_LENGTH + SHIN_LENGTH;

/**
 * The foot in profile: heel to toe tip along the sole. The ankle stands over
 * the back quarter of it and the ball of the foot — where it bends at push-off —
 * sits about three quarters of the way along.
 */
export const FOOT_LENGTH = 0.13;
export const HEEL_TO_ANKLE = 0.03;
export const HEEL_TO_BALL = 0.094;

/* ── Arms ──────────────────────────────────────────────────────────────── */

export const ARM_ROOT_X = SHOULDER_HALF_WIDTH * 0.9;
export const ARM_ROOT_Y = SHOULDER_Y + 0.012;
/** Hung straight, her wrists come level with her crotch and her fingertips to mid-thigh. */
export const UPPER_ARM_LENGTH = 0.158;
export const FOREARM_LENGTH = 0.138;
export const HAND_LENGTH = 0.08;

/* ── Derived extents ───────────────────────────────────────────────────── */

/** The crown of her hair stands this share of the skull's radius above the skull. */
export const HAIR_CROWN_RISE_SHARE = 0.32;
/** Topmost drawn point standing upright: the crown of her hair. */
export const FIGURE_TOP_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * (1 + HAIR_CROWN_RISE_SHARE);

/** A figure-unit height expressed in tile fractions from the tile's centre. */
export function tileYOf(y: number): number {
  return TILE_GROUND_Y + (y - FOOT_Y) * FIGURE_SCALE;
}
