/**
 * Tsarina Signet — half-naiad, half-high-elf Summoner.
 *
 * Everything below the top-level draw entry point works in *tile fractions*:
 * the context is scaled by the tile size once, so a coordinate of `0.1` means
 * a tenth of a tile regardless of zoom. Shadow blur is the one exception —
 * canvas shadows ignore the transform — so those are computed from the raw
 * pixel tile size.
 */

const MS_PER_SECOND = 1000;
const HALF_TURN = Math.PI;
/** The tile spans -0.5..0.5 on both axes once the context is scaled. */
const TILE_HALF_SPAN = 0.5;
const TILE_SPAN = 1;

/* ── Figure proportions (tile fractions, origin at the tile centre) ─────── */

/**
 * The pelvis sits high and the knee low: her legs carry a little over half the
 * standing figure, which is what keeps a two-tile character from reading as a
 * long torso propped on stumps. Every landmark below the waist is derived from
 * `HIP_Y` and `CROTCH_Y`, so the whole seat, thong and thigh geometry travels
 * with them.
 */
const HEAD_CENTER_Y = -0.315;
const HEAD_RADIUS_X = 0.064;
const HEAD_RADIUS_Y = 0.082;
const JAW_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.9;

const NECK_HALF_WIDTH = 0.024;
const NECK_TOP_Y = JAW_Y - 0.01;

const SHOULDER_Y = -0.2;
const SHOULDER_HALF_WIDTH = 0.098;
const BUST_Y = -0.13;
const BUST_HALF_WIDTH = 0.104;
const WAIST_Y = -0.022;
const WAIST_HALF_WIDTH = 0.058;
const HIP_Y = 0.075;
const HIP_HALF_WIDTH = 0.098;
const CROTCH_Y = 0.142;
const CROTCH_HALF_WIDTH = 0.036;

/** Bust apex — the point the hair locks are required to cover. */
const BUST_POINT_X = 0.052;
const BUST_POINT_Y = -0.115;
const BUST_UNDERCURVE_RADIUS = 0.042;
/** Only the lower outside of the circle is drawn, so it reads as a soft crease. */
const BUST_UNDERCURVE_ARC_START = HALF_TURN * 0.12;
const BUST_UNDERCURVE_ARC_END = HALF_TURN * 0.72;
/** The undercurve carries the whole read of the form, so it is drawn heavier
 * than the other creases on her. */
const UNDERCURVE_WEIGHT = 1.3;
/** Deepest through the middle of the arc, fading out at both ends. */
const BUST_UNDERCURVE_FADE_IN = 0.18;
const BUST_UNDERCURVE_FADE_OUT = 0.85;

/**
 * The locks cover the apexes and nothing else, so the breasts themselves have
 * to carry their own volume. As on the seat, the chest is washed down before
 * either one is lit: the torso fill is the lightest tone on her, so a highlight
 * laid straight onto it cannot read.
 */
/** Must cover the breasts themselves, not just the ribs under them — a swell
 * lit outside the wash is lit-on-lit and vanishes. */
const BUST_SHADE_Y = BUST_POINT_Y + 0.008;
const BUST_SHADE_RADIUS_X = BUST_HALF_WIDTH;
const BUST_SHADE_RADIUS_Y = 0.062;
const BUST_SHADE_ALPHA = 0.6;

const BUST_HIGHLIGHT_X = BUST_POINT_X * 0.9;
const BUST_HIGHLIGHT_Y = BUST_POINT_Y - 0.018;
const BUST_HIGHLIGHT_RADIUS_X = 0.043;
const BUST_HIGHLIGHT_RADIUS_Y = 0.042;
const BUST_HIGHLIGHT_ALPHA = 1;

/**
 * The shadow each breast casts onto the ribs beneath it. The crease alone only
 * ever draws the edge of the form; this is what gives it its projection.
 */
const UNDERBUST_SHADOW_X = BUST_POINT_X * 0.98;
const UNDERBUST_SHADOW_Y = BUST_POINT_Y + 0.038;
const UNDERBUST_SHADOW_RADIUS_X = 0.043;
const UNDERBUST_SHADOW_RADIUS_Y = 0.024;
const UNDERBUST_SHADOW_ALPHA = 0.7;

/** Where each breast turns away toward the ribs. */
const BUST_OUTER_SHADE_X = BUST_HALF_WIDTH * 0.95;
const BUST_OUTER_SHADE_Y = BUST_POINT_Y + 0.004;
const BUST_OUTER_SHADE_RADIUS_X = 0.026;
const BUST_OUTER_SHADE_RADIUS_Y = 0.046;
const BUST_OUTER_SHADE_ALPHA = 0.5;

/** The valley between them; without it neither side reads as round. */
const CLEAVAGE_TOP_Y = BUST_Y - 0.042;
const CLEAVAGE_BOTTOM_Y = BUST_POINT_Y + 0.024;
const CLEAVAGE_HALF_WIDTH = 0.017;
const CLEAVAGE_ALPHA = 0.55;

/* ── Front pelvis ──────────────────────────────────────────────────────── */

/**
 * The crotch is a point, not a hem: the silhouette runs in along each hip and
 * dips to meet the thighs in the centre. A flat line across reads as the
 * bottom edge of a block.
 */
const FRONT_HEM_SIDE_Y = CROTCH_Y - 0.012;
const FRONT_HEM_POINT_Y = CROTCH_Y + 0.004;

/** The swell of each hip, so the front of the pelvis is not a flat field. */
const HIP_SWELL_X = HIP_HALF_WIDTH * 0.66;
const HIP_SWELL_Y = HIP_Y - 0.004;
const HIP_SWELL_RADIUS_X = 0.042;
const HIP_SWELL_RADIUS_Y = 0.048;
const HIP_SWELL_ALPHA = 0.6;

/**
 * The groin crease running from the hip bone down to the crotch. Deepest at
 * the crotch and faded out at the top, the same way the gluteal fold is — it is
 * a crease that dies away, not a line drawn across her.
 */
const GROIN_CREASE_TOP_X = HIP_HALF_WIDTH * 0.82;
const GROIN_CREASE_TOP_Y = HIP_Y - 0.03;
const GROIN_CREASE_CONTROL_X = HIP_HALF_WIDTH * 0.52;
const GROIN_CREASE_CONTROL_Y = CROTCH_Y - 0.018;
const GROIN_CREASE_BOTTOM_X = 0.017;
const GROIN_CREASE_BOTTOM_Y = CROTCH_Y - 0.008;
/** How far down the crease it reaches full depth, measured from the hip. */
const GROIN_CREASE_FADE_STOP = 0.5;

/* ── Back view ─────────────────────────────────────────────────────────── */

const SHOULDER_BLADE_X = 0.05;
const SHOULDER_BLADE_TOP_Y = -0.17;
const SHOULDER_BLADE_BOTTOM_Y = -0.092;
const SHOULDER_BLADE_FLARE = 0.02;
/** How far down the spine the groove reaches full depth, from the blades. */
const SPINE_FADE_STOP = 0.35;
/**
 * The book puts the small fish on her shoulder blade. At this hair length the
 * blades themselves sit under her hair, so a fish drawn there would never be
 * seen at all — it rides just below the hairline instead, which is the closest
 * spot that actually reads.
 */
const BACK_FISH_X = 0.052;
const BACK_FISH_Y = -0.012;
const BACK_OF_HEAD_WIDTH_FRACTION = 1.08;
const BACK_OF_HEAD_HEIGHT_FRACTION = 1.02;

/**
 * Her hair stops just past the bust, so from behind nothing covers her hips,
 * and the thong is the only garment — the seat has to be real geometry. The
 * back silhouette therefore leaves the hip line as two cheeks that swell out
 * past it and hang over the thighs, meeting in a notch at the crotch. Painting
 * curves onto a flat-bottomed slab instead is what makes it read as a square.
 */
const SEAT_HALF_WIDTH = HIP_HALF_WIDTH * 1.06;
const SEAT_WIDEST_Y = HIP_Y + 0.034;
const SEAT_FOLD_OUTER_X = HIP_HALF_WIDTH * 0.97;
const SEAT_FOLD_OUTER_Y = HIP_Y + 0.066;
/**
 * The cheeks hang *below* the crotch — that overhang is most of what gives the
 * seat depth, and it is also what closes the top of the gap between her thighs.
 */
const SEAT_UNDERSIDE_CONTROL_X = HIP_HALF_WIDTH * 0.56;
const SEAT_UNDERSIDE_CONTROL_Y = CROTCH_Y + 0.04;
const SEAT_INNER_BOTTOM_Y = CROTCH_Y + 0.024;
/** The notch between the cheeks; without it the hem is one flat line again. */
const SEAT_NOTCH_Y = CROTCH_Y + 0.012;

/**
 * The seat is washed down before anything is lit on it. The torso's own fill is
 * already the lightest tone on her body, so a highlight painted straight onto
 * it has nothing to stand out from and the cheeks stay flat however many
 * contour lines are drawn over them.
 *
 * The wash is deliberately wider and taller than the seat it covers. Sized to
 * the seat, its own soft edge lands *inside* the silhouette and the whole thing
 * reads as one dark patch painted onto her rather than as the cheeks turning
 * away from the light; only the lit domes over it are allowed to have edges.
 */
const SEAT_SHADE_Y = HIP_Y + 0.05;
const SEAT_SHADE_RADIUS_X = SEAT_HALF_WIDTH * 1.5;
const SEAT_SHADE_RADIUS_Y = 0.105;
const SEAT_SHADE_ALPHA = 0.62;

/** The lit swell of each cheek, read against that wash. */
const GLUTE_HIGHLIGHT_X = 0.05;
/**
 * Set high on the cheek rather than at its middle: what turns the wash from a
 * stain into a form is the band of it left unlit *below* the dome, where the
 * cheek rolls under toward the fold.
 */
const GLUTE_HIGHLIGHT_Y = HIP_Y + 0.024;
const GLUTE_HIGHLIGHT_RADIUS_X = 0.05;
const GLUTE_HIGHLIGHT_RADIUS_Y = 0.058;
const GLUTE_HIGHLIGHT_ALPHA = 1;

const GLUTE_OUTER_SHADE_X = HIP_HALF_WIDTH * 0.98;
const GLUTE_OUTER_SHADE_Y = HIP_Y + 0.04;
const GLUTE_OUTER_SHADE_RADIUS_X = 0.028;
const GLUTE_OUTER_SHADE_RADIUS_Y = 0.06;
const GLUTE_OUTER_SHADE_ALPHA = 0.55;

/**
 * The gluteal fold is drawn inset above the silhouette's underside, so what
 * shows below it is thigh — drawn on the edge it would just be an outline.
 *
 * It spans the full width of the thigh it sits down onto and runs all the way
 * in to meet its twin under the cleft, so the two cheeks read as one seat.
 * Stopped short at either end it is a pair of hooks hung on her back instead,
 * and cutting straight across — rather than tracking the underside down and
 * back up — is what gives it the sharp elbow that reads as a drawn angle.
 */
const GLUTE_FOLD_INSET = 0.009;
const GLUTE_FOLD_OUTER_X = SEAT_FOLD_OUTER_X * 0.99;
const GLUTE_FOLD_OUTER_Y = SEAT_FOLD_OUTER_Y - GLUTE_FOLD_INSET;
const GLUTE_FOLD_JUNCTION_Y = SEAT_NOTCH_Y - GLUTE_FOLD_INSET;
/** Pull the crease down along the hang of the cheek between those two ends. */
const GLUTE_FOLD_INNER_CONTROL_X = CROTCH_HALF_WIDTH * 0.8;
const GLUTE_FOLD_INNER_CONTROL_Y = SEAT_INNER_BOTTOM_Y - GLUTE_FOLD_INSET * 0.4;
const GLUTE_FOLD_OUTER_CONTROL_X = SEAT_UNDERSIDE_CONTROL_X * 1.3;
const GLUTE_FOLD_OUTER_CONTROL_Y = SEAT_UNDERSIDE_CONTROL_Y - GLUTE_FOLD_INSET;
/** How far along the crease, measured from the flank, it reaches full depth. */
const GLUTE_FOLD_FADE_STOP = 0.26;

const SACRAL_DIMPLE_X = 0.026;
const SACRAL_DIMPLE_Y = HIP_Y - 0.014;
const SACRAL_DIMPLE_RADIUS = 0.012;
const SACRAL_DIMPLE_ALPHA = 0.4;

const GLUTE_CLEFT_TOP_Y = HIP_Y + 0.004;
/** Ends where the two folds meet, so all three creases join into one form. */
const GLUTE_CLEFT_BOTTOM_Y = GLUTE_FOLD_JUNCTION_Y;
/** Tapered at both ends: a lens, not a line, so it reads as depth rather than ink. */
const GLUTE_CLEFT_HALF_WIDTH = 0.013;
const GLUTE_CLEFT_WIDEST_Y = HIP_Y + (GLUTE_CLEFT_BOTTOM_Y - HIP_Y) * 0.6;
/**
 * The cleft is a valley, not a stroke: a soft shadow this much wider than the
 * dark core, so the two cheeks fall away into it instead of being ruled apart.
 * The thong string covers most of the core anyway, which is why a core alone
 * reads as a painted line.
 */
const GLUTE_CLEFT_VALLEY_HALF_WIDTH = 0.034;
const GLUTE_CLEFT_VALLEY_ALPHA = 0.75;

/* ── Legs ──────────────────────────────────────────────────────────────── */

const LEG_TOP_Y = HIP_Y - 0.01;
/** Set near the midpoint of crotch-to-floor, so the shin is not the shorter half. */
const KNEE_Y = 0.278;
const ANKLE_Y = 0.418;
const FOOT_Y = 0.455;

const LEG_HIP_X = 0.056;
const LEG_KNEE_X = 0.046;
const LEG_ANKLE_X = 0.036;

const THIGH_HALF_WIDTH = 0.044;
const KNEE_HALF_WIDTH = 0.028;
const ANKLE_HALF_WIDTH = 0.018;
/** Outward bow of the thigh and calf silhouettes. */
const THIGH_BULGE = 0.014;
const CALF_BULGE = 0.017;

/**
 * The thighs nearly meet under the crotch and part gradually going down. Left
 * at the full thigh half-width the inner edges run parallel instead, and the
 * gap between them reads as a slot cut between two posts rather than as legs.
 */
const INNER_THIGH_TOP_X = 0;
const INNER_THIGH_TAPER_X = 0.006;
/** Slight outward bow of the adductor, so the inner edge is not a taut string. */
const INNER_THIGH_BOW = 0.004;

const FOOT_HALF_WIDTH = 0.022;
/** Lifts the foot ellipse so its lower edge lands on the floor line. */
const FOOT_CENTER_RISE = 0.012;

/**
 * Back view only: the seat casts onto the top of the thigh, and the hollow
 * behind the knee creases. Without them the legs are two flat skin fields.
 */
const THIGH_TOP_SHADOW_Y = CROTCH_Y + 0.03;
const THIGH_TOP_SHADOW_RADIUS_X = 0.045;
const THIGH_TOP_SHADOW_RADIUS_Y = 0.05;
const THIGH_TOP_SHADOW_ALPHA = 0.45;
const KNEE_CREASE_HALF_WIDTH_FRACTION = 0.6;
const KNEE_CREASE_DROP = 0.008;

/** Inner-thigh shading, kept soft so it reads as depth rather than a stripe. */
const INNER_THIGH_SHADE_X = 0.02;
const INNER_THIGH_SHADE_RADIUS_X = 0.024;
const INNER_THIGH_SHADE_ALPHA = 0.35;

/* ── Arms ──────────────────────────────────────────────────────────────── */

const ARM_ROOT_X_FRACTION = 0.92;
const ARM_ROOT_Y_OFFSET = 0.01;
const UPPER_ARM_LENGTH = 0.13;
const FOREARM_LENGTH = 0.125;
const UPPER_ARM_WIDTH = 0.032;
const FOREARM_WIDTH = 0.026;
const HAND_RADIUS = 0.019;
const NAIL_COUNT = 3;
const NAIL_LENGTH = 0.022;
/** How far past the wrist the palm centre sits, as a fraction of its radius. */
const HAND_CENTER_REACH_FRACTION = 0.4;

/** Resting pose: arms hang slightly clear of the hips. */
const ARM_REST_ANGLE = 0.28;
const ELBOW_REST_ANGLE = 0.14;
/** Summoning pose: both arms swept up and out, palms open. */
const ARM_SUMMON_ANGLE = 2.45;
const ELBOW_SUMMON_ANGLE = -0.5;
/** Casting pose: one-handed forward push, so the fireball reads as thrown. */
const ARM_CAST_ANGLE = 1.15;
const ELBOW_CAST_ANGLE = -0.55;

/* ── Walk cycle ────────────────────────────────────────────────────────── */

const WALK_LEG_SWING = 0.034;
/** The ankle overshoots the knee's swing by this much. */
const WALK_ANKLE_SWING_RATIO = 1.4;
const WALK_FOOT_LIFT = 0.042;
/** The knee rises less than the ankle, so the shin folds rather than telescopes. */
const KNEE_LIFT_SHARE = 0.45;
const WALK_BODY_BOB = 0.018;
/** Her weight shifts onto the planted foot, once per step. */
const WALK_HIP_SHIFT = 0.014;
/**
 * The hip shift moves the pelvis, which is part of the torso — so the thighs
 * have to travel with it or her hips visibly unseat from her legs. The knee
 * follows partway and the ankle not at all, since that foot is planted.
 */
const KNEE_HIP_FOLLOW_SHARE = 0.45;
/** The shoulders counter-rotate against the hips. */
const WALK_SHOULDER_ROLL = 0.055;
/**
 * The spine rolls over the pelvis, so the torso pivots at the hip rather than
 * at the drawing origin — pivoting at the origin swings the pelvis itself
 * sideways and tears it away from the legs, which do not rotate.
 */
const TORSO_PIVOT_Y = HIP_Y;
/** How much of the shoulder roll her neck cancels to keep her head level. */
const HEAD_LEVELLING_SHARE = 0.8;
const WALK_HAIR_SWAY = 0.055;
const WALK_ARM_SWING = 0.42;

/* ── Hair ──────────────────────────────────────────────────────────────── */

/**
 * Her hair is cut to exactly one length everywhere: just past the bust, which
 * is the length the two front locks need to cover the bust points at every
 * frame and every pose. Nothing is drawn on the chest underneath them.
 */
const FRONT_LOCK_TOP_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.2;
const FRONT_LOCK_BOTTOM_Y = -0.058;
const FRONT_LOCK_CENTER_X = BUST_POINT_X;
/**
 * Only wide enough to cover the apex it is centred on. Widened out, the pair of
 * them curtain the whole chest and the breasts stop reading at all — the point
 * of the locks is the nipples, not the bust.
 */
const FRONT_LOCK_HALF_WIDTH = 0.019;
/** How far the tapered tip of each lock runs past its bottom anchor. */
const FRONT_LOCK_TIP_LENGTH = 0.024;
const FRONT_LOCK_ROOT_HALF_WIDTH = 0.016;
/** Sideways drift of the lock tips; kept far smaller than the lock half-width. */
const FRONT_LOCK_DRIFT = 0.004;
const FRONT_LOCK_DRIFT_SPEED = 0.7;

/** The single length every fall of her hair ends at — the front locks' tips. */
const HAIR_LENGTH_Y = FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH;

const BACK_HAIR_HALF_WIDTH = 0.128;
const BACK_HAIR_TOP_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.85;
const BACK_HAIR_BOTTOM_Y = HAIR_LENGTH_Y;
const BACK_HAIR_FLARE_Y = -0.165;

/**
 * Seen from behind, her hair comes over both shoulders and meets in a V below
 * the shoulder blades — which is what leaves the small fish there *glimpsed*,
 * the word the book uses. Same length as every other fall of her hair.
 */
const BACK_LOCK_COUNT = 5;
const BACK_LOCK_HALF_WIDTH = 0.032;
const BACK_LOCK_TIP_LENGTH = 0.02;
const BACK_LOCK_TOP_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.35;
const BACK_LOCK_ROOT_SPREAD = HEAD_RADIUS_X * 0.85;
const BACK_LOCK_TIP_SPREAD = SHOULDER_HALF_WIDTH * 0.8;
/** Outer locks hang shorter, which is what makes the hem read as hair. */
const BACK_LOCK_LENGTH_FALLOFF = 0.022;
/** A centre parting, so a strip of her spine shows between the two falls. */
const BACK_LOCK_PARTING = 0.012;

const HAIR_STRAND_COUNT = 5;
const HAIR_STRAND_WIDTH = 0.006;

const FRINGE_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.15;

/* ── Skull ─────────────────────────────────────────────────────────────── */

/**
 * The face is not the head ellipse: an ellipse has the same width at the jaw as
 * at the cheekbone, which is the single thing that makes a drawn head read as
 * male or as a doll. Hers runs wide and round through the cranium, holds its
 * width at the cheekbone, then falls away to a narrow rounded chin.
 */
const HEAD_CROWN_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y;
const CHIN_Y = JAW_Y;
const CHEEKBONE_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.08;
const JAW_CORNER_X = HEAD_RADIUS_X * 0.74;
const JAW_CORNER_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.46;
const CHIN_HALF_WIDTH = HEAD_RADIUS_X * 0.26;
/** Where the jawline stops running in and the chin itself rounds off. */
const CHIN_SHOULDER_Y = CHIN_Y - HEAD_RADIUS_Y * 0.1;
/** Carries the cranium out past the eye line before it turns down. */
const TEMPLE_CONTROL_X = HEAD_RADIUS_X * 1.14;
const CRANIUM_CONTROL_RISE = HEAD_RADIUS_Y * 0.45;
const CHEEK_TO_JAW_CONTROL_DROP = HEAD_RADIUS_Y * 0.22;
const CHIN_ROUND_CONTROL_FRACTION = 0.85;

/**
 * She is lit from her left (screen right), so every shadow on the face falls on
 * the same side and the light never contradicts itself between features.
 */
const FACE_SHADOW_SIDE = -1;
const TEMPLE_SHADE_X = HEAD_RADIUS_X * 0.6;
const TEMPLE_SHADE_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.1;
const TEMPLE_SHADE_RADIUS_X = HEAD_RADIUS_X * 0.42;
const TEMPLE_SHADE_RADIUS_Y = HEAD_RADIUS_Y * 0.5;

/** The hollow under each cheekbone; what gives the taper somewhere to start. */
const CHEEK_HOLLOW_X = HEAD_RADIUS_X * 0.66;
const CHEEK_HOLLOW_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.34;
const CHEEK_HOLLOW_RADIUS_X = 0.012;
const CHEEK_HOLLOW_RADIUS_Y = 0.016;
const CHEEK_HOLLOW_ALPHA = 0.38;

const JAW_SHADE_Y = CHIN_Y - 0.006;
const JAW_SHADE_RADIUS_X = CHIN_HALF_WIDTH * 1.8;
const JAW_SHADE_RADIUS_Y = 0.01;
const JAW_SHADE_ALPHA = 0.3;

/* ── Head details ──────────────────────────────────────────────────────── */

const EAR_LENGTH = 0.076;
const EAR_ROOT_HALF_HEIGHT = 0.022;
const EAR_TIP_RISE = 0.042;
/** Ears sit at eye level, not on top of the skull. */
const EAR_ROOT_Y = HEAD_CENTER_Y + 0.014;

const HORN_X = 0.036;
const HORN_BASE_HALF_WIDTH = 0.015;
const HORN_LENGTH = 0.055;
/** How far up the skull the horns are rooted, as a fraction of its radius. */
const HORN_BASE_Y_FRACTION = 0.7;

const EYE_X = 0.027;
const EYE_Y = HEAD_CENTER_Y - 0.004;
const EYE_RADIUS_X = 0.0145;
const EYE_RADIUS_Y = 0.0105;
/** Outer corner lifted above the inner one, which is most of the almond. */
const EYE_OUTER_CORNER_RISE = 0.004;
const EYE_LID_CONTROL_RISE = 1.45;
const PUPIL_RADIUS = 0.0058;
const EYE_CATCHLIGHT_OFFSET = 0.0026;
const EYE_CATCHLIGHT_RADIUS = 0.0022;
/** Heavier at the outer corner and carried past it as a flick. */
const LASH_LINE_WIDTH = 0.0026;
const LASH_FLICK_LENGTH = 0.005;
const LASH_FLICK_RISE = 0.0035;
const EYE_GLOW_BLUR_IDLE_PX = 2;
const EYE_GLOW_BLUR_CAST_PX = 14;
/** The tile size the pixel blur radii above were chosen against. */
const GLOW_REFERENCE_TILE_PX = 32;
const INK_GLOW_BLUR_PX = 4;

/** High, thin and arched — a heavy straight brow is the most masculine mark
 * that can be put on a face this stylised. */
const BROW_INNER_X = 0.016;
const BROW_OUTER_X = 0.042;
const BROW_Y = EYE_Y - 0.028;
const BROW_ARCH_RISE = 0.007;
/** The arch peaks past the middle of the brow, nearer the outer end. */
const BROW_ARCH_X_FRACTION = 0.62;
const BROW_LINE_WIDTH = 0.0026;
const BROW_ALPHA = 0.6;

/**
 * Slight but present: at this size a drawn nose becomes a smudge, so hers is
 * built out of the light instead — a shadow down one side of the bridge, a lit
 * tip, and two nostril marks small enough to read as punctuation.
 */
const NOSE_TIP_Y = HEAD_CENTER_Y + 0.023;
const NOSE_HALF_WIDTH = 0.0085;
const NOSE_BRIDGE_TOP_Y = EYE_Y + 0.004;
const NOSE_BRIDGE_SHADE_RADIUS_X = 0.005;
const NOSE_BRIDGE_SHADE_ALPHA = 0.5;
const NOSE_TIP_SHADE_Y = NOSE_TIP_Y + 0.0045;
const NOSE_TIP_SHADE_RADIUS_X = 0.011;
const NOSE_TIP_SHADE_RADIUS_Y = 0.005;
const NOSE_TIP_SHADE_ALPHA = 0.62;
const NOSE_TIP_HIGHLIGHT_Y = NOSE_TIP_Y - 0.005;
const NOSE_TIP_HIGHLIGHT_RADIUS = 0.0065;
const NOSE_TIP_HIGHLIGHT_ALPHA = 0.85;
const NOSTRIL_X = NOSE_HALF_WIDTH * 0.8;
const NOSTRIL_RADIUS_X = 0.0034;
const NOSTRIL_RADIUS_Y = 0.0022;
const NOSTRIL_ALPHA = 0.7;

/**
 * Two lips with a seam between them, not a single stroke. The stroke was the
 * whole mouth before, and at her size a hairline in a skin tone simply is not
 * there — the mouth has to be a shape holding its own colour.
 */
const MOUTH_Y = HEAD_CENTER_Y + 0.042;
const MOUTH_HALF_WIDTH = 0.016;
const UPPER_LIP_HEIGHT = 0.0075;
const LOWER_LIP_HEIGHT = 0.0115;
/** The peaks of the cupid's bow, either side of the philtrum dip. */
const CUPIDS_BOW_X = 0.0055;
const CUPIDS_BOW_DIP = 0.35;
const LIP_PEAK_CONTROL_FRACTION = 0.55;
const LIP_SEAM_DROP = 0.0018;
const LIP_SEAM_LINE_WIDTH = 0.0026;
const LOWER_LIP_SHEEN_Y_FRACTION = 0.55;
const LOWER_LIP_SHEEN_RADIUS_X = 0.008;
const LOWER_LIP_SHEEN_RADIUS_Y = 0.0032;
const LOWER_LIP_SHEEN_ALPHA = 0.5;
/** The shadow the lower lip throws onto the chin, which sets it forward. */
const CHIN_SHADOW_Y = MOUTH_Y + LOWER_LIP_HEIGHT + 0.005;
const CHIN_SHADOW_RADIUS_X = 0.011;
const CHIN_SHADOW_RADIUS_Y = 0.004;
const CHIN_SHADOW_ALPHA = 0.35;

const FANG_X = 0.0095;
const FANG_HALF_WIDTH = 0.0038;
const FANG_LENGTH = 0.009;

/* ── Ink ───────────────────────────────────────────────────────────────── */

/* ── Line weights and shading strengths for the body itself ────────────── */

const BUST_UNDERCURVE_LINE_WIDTH = 0.007;
const CONTOUR_LINE_WIDTH = 0.006;
const FINE_LINE_WIDTH = 0.005;
const HAIRLINE_WIDTH = 0.004;
const FLANK_SHADE_ALPHA = 0.4;
const FLANK_SHADE_RADIUS_X = 0.03;
const FLANK_SHADE_RADIUS_Y = 0.06;
const CHEEK_SHADE_ALPHA = 0.5;
const ABDOMEN_LINE_RISE = 0.05;
const ABDOMEN_LINE_DROP = 0.03;

/** Old-school flash: one heavy outline weight, no shading. */
const INK_LINE_WIDTH = 0.008;
const INK_DETAIL_LINE_WIDTH = 0.005;
const INK_ALPHA = 0.82;

/**
 * The tattoos swim under the skin rather than sitting still on it, so each
 * motif gets its own slow drift and roll, phase-offset by its index.
 */
const INK_DRIFT_AMPLITUDE = 0.011;
const INK_DRIFT_SPEED = 0.55;
const INK_ROLL_AMPLITUDE = 0.13;
const INK_ROLL_SPEED = 0.4;

/** A travelling highlight band that makes the skin look like it is rippling. */
const RIPPLE_BAND_HEIGHT = 0.06;
const RIPPLE_TRAVEL_SPEED = 0.22;
const RIPPLE_ALPHA = 0.2;

/* ── Naiad scales ──────────────────────────────────────────────────────── */

const SCALE_CELL = 0.026;
const SCALE_ALPHA = 0.22;
const SCALE_LINE_WIDTH_FRACTION = 0.12;
const SCALE_ARC_RADIUS_FRACTION = 0.45;
/** Each scale is the lower arc of a circle, giving the fish-scale overlap. */
const SCALE_ARC_START = HALF_TURN * 0.15;
const SCALE_ARC_END = HALF_TURN * 0.85;
/** Fraction of the patch, at each edge, over which the scales fade to nothing. */
const SCALE_PATCH_FADE_FRACTION = 0.32;
const SHIMMER_ALPHA = 0.12;
const SHIMMER_PULSE_SPEED = 1.7;
const SHIMMER_PULSE_FLOOR = 0.6;
const SHIMMER_PULSE_SWING = 0.4;
const SHIMMER_WIDTH_FRACTION = 0.8;
const SHIMMER_HEIGHT_FRACTION = 0.6;

/* ── Summon effects ────────────────────────────────────────────────────── */

const INK_DROP_COUNT = 5;
const INK_DROP_RADIUS = 0.016;
const INK_DROP_RISE = 0.28;
const SUMMON_AURA_RADIUS = 0.34;
const SUMMON_AURA_ALPHA = 0.3;

/* ── Overall figure scale ──────────────────────────────────────────────── */

/**
 * Signet is drawn at twice tile scale — she is a major character and has to
 * read as one beside the player rather than as another tile-sized silhouette.
 * The growth is anchored on her feet so she stays planted on her own tile.
 */
const FIGURE_SCALE = 2;
/** Topmost drawn point of the unscaled figure: the horn tips. */
const FIGURE_TOP_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * HORN_BASE_Y_FRACTION - HORN_LENGTH;

function scaledFromFeet(y: number): number {
  return FOOT_Y + (y - FOOT_Y) * FIGURE_SCALE;
}

/** Distance above the tile's *top edge* that her head reaches, in tile fractions. */
const SIGNET_HEAD_CLEARANCE = -(scaledFromFeet(FIGURE_TOP_Y) + TILE_HALF_SPAN);

/**
 * Where her chest sits relative to the tile's top edge, so spells launch from
 * her hands rather than from the tile she happens to occupy.
 */
export const SIGNET_CHEST_Y_OFFSET = scaledFromFeet(BUST_Y) + TILE_HALF_SPAN;

/**
 * Half-width she reaches in her widest pose (both arms out, summoning), in
 * tile fractions from her centre.
 */
/** How far the shoulder roll alone carries the arm root sideways. */
const SHOULDER_ROLL_REACH = Math.sin(WALK_SHOULDER_ROLL) * (TORSO_PIVOT_Y - SHOULDER_Y);

export const SIGNET_HALF_WIDTH =
  (SHOULDER_HALF_WIDTH * ARM_ROOT_X_FRACTION +
    UPPER_ARM_LENGTH +
    FOREARM_LENGTH +
    HAND_RADIUS +
    NAIL_LENGTH +
    WALK_HIP_SHIFT +
    SHOULDER_ROLL_REACH) *
  FIGURE_SCALE;

/* ── Elite marker ──────────────────────────────────────────────────────── */

const ELITE_MARKER_RADIUS = 0.14;
const ELITE_MARKER_CROSS_ARM = 0.08;
const ELITE_MARKER_GAP = 0.06;
const ELITE_MARKER_BOB_AMP = 0.03;
const ELITE_MARKER_Y_OFFSET = -SIGNET_HEAD_CLEARANCE - ELITE_MARKER_RADIUS - ELITE_MARKER_GAP;

/**
 * How far above the tile's top edge anything else must sit to clear both her
 * head and the elite marker floating over it — health bar, aggro mark,
 * interaction prompts. Derived so callers never re-guess the marker geometry.
 */
export const SIGNET_OVERLAY_CLEARANCE =
  -ELITE_MARKER_Y_OFFSET + ELITE_MARKER_RADIUS + ELITE_MARKER_BOB_AMP;
const ELITE_MARKER_BOB_SPEED = 2.2;
const ELITE_MARKER_STROKE_FRACTION = 0.035;
const ELITE_MARKER_MIN_STROKE_PX = 1.5;

/* ── Palette ───────────────────────────────────────────────────────────── */

const SKIN_LIT = '#f2f6ff';
const SKIN_BASE = '#dfe8fa';
const SKIN_SHADE = '#bfcde8';
const SKIN_DEEP_SHADE = '#a4b5d6';
/** The deepest tone on her, for creases that have to actually read as deep. */
const SKIN_CREASE = '#8c9ec2';
/** Fully transparent twins of the tones above; must track them by hand. */
const SKIN_LIT_FADE = 'rgba(242,246,255,0)';
const SKIN_SHADE_FADE = 'rgba(191,205,232,0)';
const SKIN_CREASE_FADE = 'rgba(140,158,194,0)';
const HAIR_DARK = '#12101c';
const HAIR_SHEEN = '#3a3550';
const THONG_COLOR = '#2a2c3d';
const THONG_TRIM = '#4a4d68';
const HORN_COLOR = '#4b4257';
const INK_COLOR = '#141a2a';
const INK_GLOW_COLOR = '#7fe6d4';
/** Charged ink — still dark enough to read against her skin. */
const INK_LIT_COLOR = '#0d5f57';
/**
 * Kept cool and desaturated: a warm red mouth on skin this glacial reads as a
 * sticker rather than as part of her. The upper lip is the darker of the two
 * because it faces down and away from the light.
 */
const LIP_COLOR = '#b3899e';
const LIP_UPPER_COLOR = '#9d788c';
const LIP_SEAM_COLOR = '#5f4257';
const LIP_SHEEN_COLOR = '#e6d4de';
const LIP_SHEEN_FADE = 'rgba(230,212,222,0)';
const EYE_IDLE_COLOR = '#9fd8f0';
const EYE_CAST_COLOR = '#d6fff4';
const SCALE_COLOR = '#8fc4e8';
const SHIMMER_COLOR = '#7fb8ff';
const SHIMMER_EDGE_COLOR = 'rgba(127,184,255,0)';
const NAIL_COLOR = '#1b1826';

const SIDES = [-1, 1] as const;
type BodySide = (typeof SIDES)[number];

/** Pose and animation inputs for {@link drawSignetSprite}. */
export interface SignetPose {
  /** Free-running walk counter; only read while `isMoving`. */
  walkFrame: number;
  isMoving: boolean;
  /** 0–1 progress through the summoning gesture. */
  summonProgress: number;
  /** 0–1 progress through a fireball cast; drives the eye glow and throw. */
  castProgress: number;
  /** Horizontal facing; negative mirrors the figure. */
  facingX: number;
  /** True when she has her back to the camera, which swaps her to the back view. */
  facingAway: boolean;
}

/**
 * Draw the Dungeon's elite mark — a black cross in a white circle — floating
 * above an elite NPC's head.
 */
export function drawEliteMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const timeSec = performance.now() / MS_PER_SECOND;
  const cx = sx + s / 2;
  const cy =
    sy +
    ELITE_MARKER_Y_OFFSET * s +
    Math.sin(timeSec * ELITE_MARKER_BOB_SPEED) * ELITE_MARKER_BOB_AMP * s;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, ELITE_MARKER_RADIUS * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(ELITE_MARKER_MIN_STROKE_PX, s * ELITE_MARKER_STROKE_FRACTION);
  ctx.beginPath();
  ctx.moveTo(cx - ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.lineTo(cx + ELITE_MARKER_CROSS_ARM * s, cy);
  ctx.moveTo(cx, cy - ELITE_MARKER_CROSS_ARM * s);
  ctx.lineTo(cx, cy + ELITE_MARKER_CROSS_ARM * s);
  ctx.stroke();
  ctx.restore();
}

/* ══ Tattoo flash ═══════════════════════════════════════════════════════ */

/**
 * Every motif is drawn inside a unit box spanning -0.5..0.5 on both axes, so a
 * single `size` places it anywhere on the body at any scale.
 */
type TattooMotif = (ctx: CanvasRenderingContext2D) => void;

function drawHammerheadSharkMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.5, 0);
  ctx.lineTo(-0.42, -0.14);
  ctx.lineTo(-0.34, 0);
  ctx.lineTo(-0.42, 0.14);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.34, -0.05);
  ctx.quadraticCurveTo(0.05, -0.2, 0.34, -0.06);
  ctx.lineTo(0.5, -0.22);
  ctx.lineTo(0.42, 0);
  ctx.lineTo(0.5, 0.22);
  ctx.lineTo(0.34, 0.06);
  ctx.quadraticCurveTo(0.05, 0.18, -0.34, 0.05);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -0.15);
  ctx.lineTo(0.08, -0.34);
  ctx.lineTo(0.14, -0.13);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.05, 0.12);
  ctx.lineTo(-0.12, 0.28);
  ctx.stroke();
}

function drawOctopusMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, -0.22, 0.19, 0.24, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-0.08, -0.24, 0.045, 0, Math.PI * 2);
  ctx.arc(0.08, -0.24, 0.045, 0, Math.PI * 2);
  ctx.stroke();

  const TENTACLE_COUNT = 6;
  for (let i = 0; i < TENTACLE_COUNT; i++) {
    const spread = (i / (TENTACLE_COUNT - 1) - 0.5) * 2;
    const rootX = spread * 0.16;
    const curlX = spread * 0.46;
    const tipX = spread * 0.3;
    ctx.beginPath();
    ctx.moveTo(rootX, -0.02);
    ctx.bezierCurveTo(curlX, 0.16, curlX * 0.6, 0.36, tipX, 0.48);
    ctx.stroke();
  }
}

function drawThreeHeadedOgreMotif(ctx: CanvasRenderingContext2D): void {
  const HEAD_RADIUS = 0.09;
  const HEAD_Y = -0.3;
  for (const headX of [-0.17, 0, 0.17]) {
    ctx.beginPath();
    ctx.arc(headX, HEAD_Y, HEAD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX - HEAD_RADIUS * 0.5, HEAD_Y + HEAD_RADIUS * 0.35);
    ctx.lineTo(headX + HEAD_RADIUS * 0.5, HEAD_Y + HEAD_RADIUS * 0.35);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.16);
  ctx.lineTo(0.24, -0.16);
  ctx.lineTo(0.16, 0.32);
  ctx.lineTo(-0.16, 0.32);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.12);
  ctx.lineTo(-0.4, 0.1);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0.24, -0.12);
  ctx.lineTo(0.42, -0.02);
  ctx.stroke();

  // The curved sword, swept up from the raised right fist
  ctx.beginPath();
  ctx.moveTo(0.34, -0.08);
  ctx.quadraticCurveTo(0.5, -0.3, 0.3, -0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.28, 0.02);
  ctx.lineTo(0.46, -0.08);
  ctx.stroke();
}

function drawDragonMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.1, -0.42);
  ctx.bezierCurveTo(0.3, -0.24, -0.32, 0.02, 0.06, 0.2);
  ctx.bezierCurveTo(0.24, 0.32, 0.0, 0.42, -0.14, 0.48);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.1, -0.42);
  ctx.lineTo(-0.3, -0.46);
  ctx.lineTo(-0.16, -0.32);
  ctx.closePath();
  ctx.stroke();

  const SPINE_SPIKE_COUNT = 4;
  for (let i = 0; i < SPINE_SPIKE_COUNT; i++) {
    const t = i / SPINE_SPIKE_COUNT;
    const spikeY = -0.3 + t * 0.5;
    const spikeX = 0.12 - t * 0.3;
    ctx.beginPath();
    ctx.moveTo(spikeX, spikeY);
    ctx.lineTo(spikeX + 0.1, spikeY - 0.06);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(-0.02, -0.16);
  ctx.quadraticCurveTo(-0.36, -0.24, -0.3, 0.04);
  ctx.stroke();
}

function drawEelLightningMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.46);
  ctx.bezierCurveTo(0.26, -0.26, -0.24, -0.02, 0.12, 0.18);
  ctx.bezierCurveTo(0.28, 0.3, 0.06, 0.38, -0.06, 0.46);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.06, -0.46);
  ctx.lineTo(-0.2, -0.4);
  ctx.lineTo(-0.06, -0.34);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.24, -0.34);
  ctx.lineTo(-0.34, -0.2);
  ctx.lineTo(-0.24, -0.18);
  ctx.lineTo(-0.36, 0.02);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0.3, -0.06);
  ctx.lineTo(0.2, 0.06);
  ctx.lineTo(0.3, 0.08);
  ctx.lineTo(0.18, 0.24);
  ctx.stroke();
}

function drawSmallFishMotif(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.2, 0);
  ctx.quadraticCurveTo(0.05, -0.28, 0.34, 0);
  ctx.quadraticCurveTo(0.05, 0.28, -0.2, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-0.2, 0);
  ctx.lineTo(-0.44, -0.2);
  ctx.lineTo(-0.44, 0.2);
  ctx.closePath();
  ctx.stroke();
}

interface TattooPlacement {
  x: number;
  y: number;
  /** Edge length of the motif's unit box once placed on the body. */
  size: number;
  /** Offsets this motif's drift and roll so no two move in lockstep. */
  phase: number;
  /** Base orientation, e.g. a shark turned to swim down a thigh. */
  rotation?: number;
  /** Thinner outline for motifs small enough that the heavy weight fills in. */
  detail?: boolean;
}

/**
 * Place a motif on the body with its own drift and roll, so the flash appears
 * to swim beneath the skin instead of being printed on it.
 */
function stampTattoo(
  ctx: CanvasRenderingContext2D,
  motif: TattooMotif,
  timeSec: number,
  placement: TattooPlacement,
): void {
  const { x, y, size, phase, rotation = 0, detail = false } = placement;
  const driftX = Math.sin(timeSec * INK_DRIFT_SPEED + phase) * INK_DRIFT_AMPLITUDE;
  const driftY = Math.cos(timeSec * INK_DRIFT_SPEED * 0.8 + phase) * INK_DRIFT_AMPLITUDE * 0.6;
  const roll = Math.sin(timeSec * INK_ROLL_SPEED + phase) * INK_ROLL_AMPLITUDE;

  ctx.save();
  ctx.translate(x + driftX, y + driftY);
  ctx.rotate(rotation + roll);
  ctx.scale(size, size);
  // Undo the motif scaling so the flash keeps one constant outline weight,
  // which is what makes it read as old-school tattooing rather than sketching.
  ctx.lineWidth = (detail ? INK_DETAIL_LINE_WIDTH : INK_LINE_WIDTH) / size;
  motif(ctx);
  ctx.restore();
}

function applyInkStyle(ctx: CanvasRenderingContext2D, castGlow: number, tileSizePx: number): void {
  ctx.strokeStyle = INK_COLOR;
  ctx.globalAlpha = INK_ALPHA;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (castGlow > 0) {
    // The line itself stays dark: a pale glow colour on her pale skin erases
    // the flash entirely. The halo is what reads as the ink lighting up.
    ctx.strokeStyle = INK_LIT_COLOR;
    ctx.shadowColor = INK_GLOW_COLOR;
    ctx.shadowBlur = castGlow * INK_GLOW_BLUR_PX * (tileSizePx / GLOW_REFERENCE_TILE_PX);
  }
}

/* ══ Body paths ═════════════════════════════════════════════════════════ */

/** Fraction of the radius held at full strength before the fade starts. */
const SOFT_SHADE_CORE_FRACTION = 0.4;

/**
 * A flat-alpha ellipse leaves a hard rim wherever it is not clipped away, and
 * on a body that rim reads as a crease or a seam where there is no anatomy at
 * all — every soft shadow and highlight on her fades out at its edge instead.
 */
function fillSoftEllipse(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: string,
  fadeColor: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(centerX, centerY);
  ctx.scale(radiusX, radiusY);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, color);
  shade.addColorStop(SOFT_SHADE_CORE_FRACTION, color);
  shade.addColorStop(1, fadeColor);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Canvas has no cheap blur, so a crease is built from a few strokes of
 * decreasing width and rising opacity: a wide faint halo of shadow around a
 * narrow dark core. A single stroke of even width reads as ink on the skin
 * however dark it is, because a real crease has no edge.
 */
const CREASE_LAYERS = [
  { widthScale: 3.4, alpha: 0.16 },
  { widthScale: 2, alpha: 0.24 },
  { widthScale: 1, alpha: 0.6 },
] as const;

function strokeSoftCrease(
  ctx: CanvasRenderingContext2D,
  baseWidth: number,
  stroke: string | CanvasGradient,
  tracePath: () => void,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'round';
  for (const layer of CREASE_LAYERS) {
    ctx.globalAlpha = layer.alpha;
    ctx.lineWidth = baseWidth * layer.widthScale;
    ctx.beginPath();
    tracePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * The underside of the seat, back view only: the hip line continues into two
 * cheeks that swell past it, hang over the thighs, and meet in a notch at the
 * crotch. Traced left to right, picking up where the left hip point ends.
 */
function pathSeatUnderside(ctx: CanvasRenderingContext2D): void {
  ctx.quadraticCurveTo(-SEAT_HALF_WIDTH, SEAT_WIDEST_Y, -SEAT_FOLD_OUTER_X, SEAT_FOLD_OUTER_Y);
  ctx.quadraticCurveTo(
    -SEAT_UNDERSIDE_CONTROL_X,
    SEAT_UNDERSIDE_CONTROL_Y,
    -CROTCH_HALF_WIDTH,
    SEAT_INNER_BOTTOM_Y,
  );
  ctx.quadraticCurveTo(0, SEAT_NOTCH_Y, CROTCH_HALF_WIDTH, SEAT_INNER_BOTTOM_Y);
  ctx.quadraticCurveTo(
    SEAT_UNDERSIDE_CONTROL_X,
    SEAT_UNDERSIDE_CONTROL_Y,
    SEAT_FOLD_OUTER_X,
    SEAT_FOLD_OUTER_Y,
  );
  ctx.quadraticCurveTo(SEAT_HALF_WIDTH, SEAT_WIDEST_Y, HIP_HALF_WIDTH, HIP_Y);
}

function pathTorso(ctx: CanvasRenderingContext2D, facingAway: boolean): void {
  ctx.beginPath();
  ctx.moveTo(-SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.quadraticCurveTo(-BUST_HALF_WIDTH, BUST_Y - 0.02, -BUST_HALF_WIDTH, BUST_Y + 0.02);
  ctx.quadraticCurveTo(-WAIST_HALF_WIDTH - 0.01, WAIST_Y - 0.04, -WAIST_HALF_WIDTH, WAIST_Y);
  ctx.quadraticCurveTo(-HIP_HALF_WIDTH, HIP_Y - 0.05, -HIP_HALF_WIDTH, HIP_Y);
  if (facingAway) {
    pathSeatUnderside(ctx);
  } else {
    ctx.quadraticCurveTo(
      -HIP_HALF_WIDTH + 0.02,
      FRONT_HEM_SIDE_Y,
      -CROTCH_HALF_WIDTH,
      FRONT_HEM_SIDE_Y,
    );
    ctx.quadraticCurveTo(0, FRONT_HEM_POINT_Y, CROTCH_HALF_WIDTH, FRONT_HEM_SIDE_Y);
    ctx.quadraticCurveTo(HIP_HALF_WIDTH - 0.02, FRONT_HEM_SIDE_Y, HIP_HALF_WIDTH, HIP_Y);
  }
  ctx.quadraticCurveTo(HIP_HALF_WIDTH, HIP_Y - 0.05, WAIST_HALF_WIDTH, WAIST_Y);
  ctx.quadraticCurveTo(WAIST_HALF_WIDTH + 0.01, WAIST_Y - 0.04, BUST_HALF_WIDTH, BUST_Y + 0.02);
  ctx.quadraticCurveTo(BUST_HALF_WIDTH, BUST_Y - 0.02, SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.quadraticCurveTo(NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.lineTo(-NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.quadraticCurveTo(-NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, -SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.closePath();
}

interface LegJoints {
  hipX: number;
  kneeX: number;
  kneeY: number;
  ankleX: number;
  ankleY: number;
}

/**
 * One leg's joint positions for the current step. Shared by the silhouette and
 * by the shading drawn on top of it, so the two can never drift apart.
 */
function legJoints(side: BodySide, swing: number, lift: number, hipShift: number): LegJoints {
  return {
    hipX: side * LEG_HIP_X + hipShift,
    kneeX: side * LEG_KNEE_X + swing + hipShift * KNEE_HIP_FOLLOW_SHARE,
    kneeY: KNEE_Y - lift * KNEE_LIFT_SHARE,
    ankleX: side * LEG_ANKLE_X + swing * WALK_ANKLE_SWING_RATIO,
    ankleY: ANKLE_Y - lift,
  };
}

function pathLeg(ctx: CanvasRenderingContext2D, side: BodySide, joints: LegJoints): void {
  const { hipX, kneeX, kneeY, ankleX, ankleY } = joints;
  const thighMidY = (LEG_TOP_Y + kneeY) / 2;
  const calfMidY = (kneeY + ankleY) / 2;

  ctx.beginPath();
  ctx.moveTo(hipX + side * THIGH_HALF_WIDTH, LEG_TOP_Y);
  ctx.quadraticCurveTo(
    hipX + side * (THIGH_HALF_WIDTH + THIGH_BULGE),
    thighMidY,
    kneeX + side * KNEE_HALF_WIDTH,
    kneeY,
  );
  ctx.quadraticCurveTo(
    kneeX + side * (KNEE_HALF_WIDTH + CALF_BULGE),
    calfMidY,
    ankleX + side * ANKLE_HALF_WIDTH,
    ankleY,
  );
  ctx.lineTo(ankleX - side * ANKLE_HALF_WIDTH, ankleY);
  ctx.quadraticCurveTo(
    kneeX - side * (KNEE_HALF_WIDTH + CALF_BULGE * 0.3),
    calfMidY,
    kneeX - side * KNEE_HALF_WIDTH,
    kneeY,
  );
  const innerKneeX = kneeX - side * KNEE_HALF_WIDTH;
  const innerTaperX = hipX - side * LEG_HIP_X + side * INNER_THIGH_TAPER_X;
  ctx.quadraticCurveTo(
    (innerKneeX + innerTaperX) / 2 + side * INNER_THIGH_BOW,
    thighMidY,
    innerTaperX,
    (LEG_TOP_Y + thighMidY) / 2,
  );
  ctx.lineTo(hipX - side * LEG_HIP_X + side * INNER_THIGH_TOP_X, LEG_TOP_Y);
  ctx.closePath();
}

/* ══ Body parts ═════════════════════════════════════════════════════════ */

/**
 * A patch is laid out on a grid, so at full strength its border is a straight
 * line of scales — a visible rectangle drawn across her waist and thighs. The
 * cells fade out over the outermost fraction of the patch instead.
 */
function scalePatchEdgeFade(position: number, span: number): number {
  const distanceFromNearestEdge = Math.min(position, span - position);
  return Math.min(1, distanceFromNearestEdge / (span * SCALE_PATCH_FADE_FRACTION));
}

function drawScalePatch(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = SCALE_COLOR;
  ctx.lineWidth = SCALE_CELL * SCALE_LINE_WIDTH_FRACTION;
  const rows = Math.ceil(height / SCALE_CELL);
  const columns = Math.ceil(width / SCALE_CELL);
  for (let row = 0; row < rows; row++) {
    const rowOffset = row % 2 === 0 ? 0 : SCALE_CELL / 2;
    const rowFade = scalePatchEdgeFade(row * SCALE_CELL, height);
    for (let column = 0; column < columns; column++) {
      const columnFade = scalePatchEdgeFade(column * SCALE_CELL + rowOffset, width);
      ctx.globalAlpha = SCALE_ALPHA * rowFade * columnFade;
      const cellX = left + column * SCALE_CELL + rowOffset;
      const cellY = top + row * SCALE_CELL;
      ctx.beginPath();
      ctx.arc(cellX, cellY, SCALE_CELL * SCALE_ARC_RADIUS_FRACTION, SCALE_ARC_START, SCALE_ARC_END);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSkinRipple(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  top: number,
  bottom: number,
): void {
  const span = bottom - top;
  const travel = (timeSec * RIPPLE_TRAVEL_SPEED) % 1;
  const bandCenterY = top + travel * span;
  const gradient = ctx.createLinearGradient(
    0,
    bandCenterY - RIPPLE_BAND_HEIGHT,
    0,
    bandCenterY + RIPPLE_BAND_HEIGHT,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, `rgba(255,255,255,${RIPPLE_ALPHA})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(
    -TILE_HALF_SPAN,
    bandCenterY - RIPPLE_BAND_HEIGHT,
    TILE_SPAN,
    RIPPLE_BAND_HEIGHT * 2,
  );
}

/** Flash on the legs rides mid-thigh and just above the knee. */
const THIGH_TATTOO_Y = LEG_TOP_Y + (KNEE_Y - LEG_TOP_Y) * 0.55;
const KNEE_TATTOO_Y = KNEE_Y + 0.05;

function drawLegs(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  swingPhase: number,
  hipShift: number,
  facingAway: boolean,
  castGlow: number,
  tileSizePx: number,
): void {
  const SCALE_PATCH_INSET = 0.01;
  const SCALE_PATCH_WIDTH = 0.11;

  for (const side of SIDES) {
    const stridePhase = swingPhase * side;
    const swing = stridePhase * WALK_LEG_SWING;
    const lift = Math.max(0, stridePhase) * WALK_FOOT_LIFT;
    const joints = legJoints(side, swing, lift, hipShift);

    ctx.save();

    ctx.fillStyle = SKIN_BASE;
    ctx.beginPath();
    ctx.ellipse(
      joints.ankleX,
      FOOT_Y - FOOT_CENTER_RISE - lift,
      FOOT_HALF_WIDTH,
      FOOT_Y - ANKLE_Y,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    pathLeg(ctx, side, joints);
    ctx.fillStyle = side < 0 ? SKIN_BASE : SKIN_LIT;
    ctx.fill();

    ctx.save();
    pathLeg(ctx, side, joints);
    ctx.clip();

    const scalePatchLeft = side > 0 ? SCALE_PATCH_INSET : -SCALE_PATCH_INSET - SCALE_PATCH_WIDTH;
    drawScalePatch(ctx, scalePatchLeft, LEG_TOP_Y, SCALE_PATCH_WIDTH, KNEE_Y - LEG_TOP_Y);

    fillSoftEllipse(
      ctx,
      side * INNER_THIGH_SHADE_X + hipShift,
      (LEG_TOP_Y + joints.kneeY) / 2,
      INNER_THIGH_SHADE_RADIUS_X,
      (joints.kneeY - LEG_TOP_Y) / 2,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      INNER_THIGH_SHADE_ALPHA,
    );

    if (facingAway) {
      fillSoftEllipse(
        ctx,
        joints.hipX,
        THIGH_TOP_SHADOW_Y,
        THIGH_TOP_SHADOW_RADIUS_X,
        THIGH_TOP_SHADOW_RADIUS_Y,
        SKIN_SHADE,
        SKIN_SHADE_FADE,
        THIGH_TOP_SHADOW_ALPHA,
      );

      ctx.strokeStyle = SKIN_SHADE;
      ctx.lineWidth = FINE_LINE_WIDTH;
      const creaseHalfWidth = KNEE_HALF_WIDTH * KNEE_CREASE_HALF_WIDTH_FRACTION;
      ctx.beginPath();
      ctx.moveTo(joints.kneeX - creaseHalfWidth, joints.kneeY);
      ctx.quadraticCurveTo(
        joints.kneeX,
        joints.kneeY + KNEE_CREASE_DROP,
        joints.kneeX + creaseHalfWidth,
        joints.kneeY,
      );
      ctx.stroke();
    }

    applyInkStyle(ctx, castGlow, tileSizePx);
    // Anchored on the joints rather than on the rest pose, so the flash rides
    // the leg through the stride instead of sliding across the skin.
    if (side < 0) {
      stampTattoo(ctx, drawThreeHeadedOgreMotif, timeSec, {
        x: joints.hipX,
        y: THIGH_TATTOO_Y,
        size: 0.085,
        phase: 1.1,
      });
      stampTattoo(ctx, drawEelLightningMotif, timeSec, {
        x: joints.kneeX,
        y: KNEE_TATTOO_Y,
        size: 0.07,
        phase: 3.7,
        detail: true,
      });
    } else {
      stampTattoo(ctx, drawHammerheadSharkMotif, timeSec, {
        x: joints.hipX,
        y: THIGH_TATTOO_Y,
        size: 0.13,
        phase: 2.3,
        rotation: HALF_TURN * 0.5,
      });
    }
    ctx.restore();

    ctx.restore();
  }
}

const THONG_STRAP_Y = HIP_Y - 0.005;
const THONG_STRAP_HEIGHT = 0.009;
/**
 * Wider than the hip, because the band is clipped to the torso: run short of
 * the silhouette and it ends in mid-skin, which reads as a bar laid across her
 * instead of a band going around her.
 */
const THONG_STRAP_HALF_SPAN = HIP_HALF_WIDTH * 1.12;
/**
 * A waistband drawn as a rectangle is a straight bar laid across a body that
 * curves, which reads as a painted stripe. It sags at the centre front and sits
 * nearly level at the back, the way a low-rise band actually hangs.
 */
const THONG_WAISTBAND_FRONT_SAG = 0.012;
const THONG_WAISTBAND_BACK_SAG = 0.004;

/**
 * The front panel is a high-cut V, narrow at the band and tapering to a point.
 * Widened out, with its sides bowing *outward*, it stops reading as a thong and
 * becomes a loincloth hanging off her hips.
 */
const THONG_PANEL_HALF_WIDTH = HIP_HALF_WIDTH * 0.44;
/** Stops above the crotch, or its point runs on into the gap between her legs
 * and panel and gap read as one long dark wedge. */
const THONG_PANEL_BOTTOM_Y = CROTCH_Y - 0.012;
/** Pulled well inside the straight line, so each leg opening cuts in. */
const THONG_PANEL_CONTROL_X_FRACTION = 0.22;
const THONG_PANEL_CONTROL_Y_FRACTION = 0.72;

/** Narrow enough that the cleft shadow still shows on either side of it. */
const THONG_STRING_HALF_WIDTH = GLUTE_CLEFT_HALF_WIDTH * 0.38;
/**
 * It ends where the cleft is deepest, which is where the cheeks close over it —
 * run all the way down, it is a hard straight spike ruled down her instead.
 */
const THONG_STRING_BOTTOM_Y = GLUTE_CLEFT_WIDEST_Y + 0.008;

/** Height of a band edge at a given x: a parabola, sagging to `sag` at centre. */
function waistbandEdgeY(x: number, y: number, sag: number): number {
  const acrossBand = x / THONG_STRAP_HALF_SPAN;
  return y + sag * (1 - acrossBand * acrossBand);
}

/**
 * A band edge across `±halfWidth`. Any span of that parabola is itself a
 * quadratic, so the panel can share the band's exact edge instead of
 * approximating it and leaving its corners poking out above the band.
 */
function pathWaistbandEdgeSpan(
  ctx: CanvasRenderingContext2D,
  halfWidth: number,
  y: number,
  sag: number,
  moveToStart: boolean,
): void {
  const edgeY = waistbandEdgeY(halfWidth, y, sag);
  /** A quadratic's midpoint sits half way to its control. */
  const controlY = 2 * (y + sag) - edgeY;
  if (moveToStart) {
    ctx.moveTo(-halfWidth, edgeY);
  } else {
    ctx.lineTo(-halfWidth, edgeY);
  }
  ctx.quadraticCurveTo(0, controlY, halfWidth, edgeY);
}

function drawWaistband(ctx: CanvasRenderingContext2D, sag: number): void {
  const bandTopY = THONG_STRAP_Y - THONG_STRAP_HEIGHT;

  ctx.fillStyle = THONG_COLOR;
  ctx.beginPath();
  pathWaistbandEdgeSpan(ctx, THONG_STRAP_HALF_SPAN, bandTopY, sag, true);
  ctx.lineTo(THONG_STRAP_HALF_SPAN, THONG_STRAP_Y);
  ctx.quadraticCurveTo(0, THONG_STRAP_Y + sag * 2, -THONG_STRAP_HALF_SPAN, THONG_STRAP_Y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = THONG_TRIM;
  ctx.lineWidth = HAIRLINE_WIDTH;
  ctx.beginPath();
  pathWaistbandEdgeSpan(ctx, THONG_STRAP_HALF_SPAN, bandTopY, sag, true);
  ctx.stroke();
}

function drawThong(ctx: CanvasRenderingContext2D, facingAway: boolean): void {
  ctx.save();
  pathTorso(ctx, facingAway);
  ctx.clip();

  const sag = facingAway ? THONG_WAISTBAND_BACK_SAG : THONG_WAISTBAND_FRONT_SAG;
  ctx.fillStyle = THONG_COLOR;

  if (facingAway) {
    // From behind the panel is only a string, running down the cleft from the
    // band — it has to sit slightly narrower than the cleft or it reads as a
    // painted stripe instead of a garment.
    const stringTopY = THONG_STRAP_Y + sag;
    ctx.beginPath();
    ctx.moveTo(-THONG_STRING_HALF_WIDTH, stringTopY);
    ctx.lineTo(THONG_STRING_HALF_WIDTH, stringTopY);
    ctx.quadraticCurveTo(THONG_STRING_HALF_WIDTH, THONG_STRING_BOTTOM_Y, 0, THONG_STRING_BOTTOM_Y);
    ctx.quadraticCurveTo(
      -THONG_STRING_HALF_WIDTH,
      THONG_STRING_BOTTOM_Y,
      -THONG_STRING_HALF_WIDTH,
      stringTopY,
    );
    ctx.closePath();
    ctx.fill();
  } else {
    const controlX = THONG_PANEL_HALF_WIDTH * THONG_PANEL_CONTROL_X_FRACTION;
    const controlY =
      THONG_STRAP_Y + (THONG_PANEL_BOTTOM_Y - THONG_STRAP_Y) * THONG_PANEL_CONTROL_Y_FRACTION;

    // Hung from the band's top edge rather than butted against its lower one,
    // so the band covers the join exactly and no seam can open along it.
    const panelTopY = THONG_STRAP_Y - THONG_STRAP_HEIGHT;
    const panelCornerY = waistbandEdgeY(THONG_PANEL_HALF_WIDTH, panelTopY, sag);

    ctx.beginPath();
    pathWaistbandEdgeSpan(ctx, THONG_PANEL_HALF_WIDTH, panelTopY, sag, true);
    ctx.quadraticCurveTo(controlX, controlY, 0, THONG_PANEL_BOTTOM_Y);
    ctx.quadraticCurveTo(-controlX, controlY, -THONG_PANEL_HALF_WIDTH, panelCornerY);
    ctx.closePath();
    ctx.fill();
  }

  drawWaistband(ctx, sag);
  ctx.restore();
}

/**
 * The seat, back view only. Expects the caller to have already clipped to the
 * torso path, so the hip silhouette keeps deciding her outline.
 */
function drawGlutes(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    0,
    SEAT_SHADE_Y,
    SEAT_SHADE_RADIUS_X,
    SEAT_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    SEAT_SHADE_ALPHA,
  );

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * GLUTE_HIGHLIGHT_X,
      GLUTE_HIGHLIGHT_Y,
      GLUTE_HIGHLIGHT_RADIUS_X,
      GLUTE_HIGHLIGHT_RADIUS_Y,
      SKIN_LIT,
      SKIN_LIT_FADE,
      GLUTE_HIGHLIGHT_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      side * GLUTE_OUTER_SHADE_X,
      GLUTE_OUTER_SHADE_Y,
      GLUTE_OUTER_SHADE_RADIUS_X,
      GLUTE_OUTER_SHADE_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      GLUTE_OUTER_SHADE_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      side * SACRAL_DIMPLE_X,
      SACRAL_DIMPLE_Y,
      SACRAL_DIMPLE_RADIUS,
      SACRAL_DIMPLE_RADIUS,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      SACRAL_DIMPLE_ALPHA,
    );
  }

  // The valley the two cheeks fall away into. The dark core alone is what the
  // thong string already covers, so on its own it can only ever read as a line.
  fillSoftEllipse(
    ctx,
    0,
    (GLUTE_CLEFT_TOP_Y + GLUTE_CLEFT_BOTTOM_Y) / 2,
    GLUTE_CLEFT_VALLEY_HALF_WIDTH,
    (GLUTE_CLEFT_BOTTOM_Y - GLUTE_CLEFT_TOP_Y) / 2,
    SKIN_CREASE,
    SKIN_CREASE_FADE,
    GLUTE_CLEFT_VALLEY_ALPHA,
  );

  ctx.fillStyle = SKIN_CREASE;
  ctx.beginPath();
  ctx.moveTo(0, GLUTE_CLEFT_TOP_Y);
  ctx.quadraticCurveTo(GLUTE_CLEFT_HALF_WIDTH, GLUTE_CLEFT_WIDEST_Y, 0, GLUTE_CLEFT_BOTTOM_Y);
  ctx.quadraticCurveTo(-GLUTE_CLEFT_HALF_WIDTH, GLUTE_CLEFT_WIDEST_Y, 0, GLUTE_CLEFT_TOP_Y);
  ctx.closePath();
  ctx.fill();

  // The fold each cheek makes where it sits down onto the thigh: a cubic that
  // tracks the silhouette's underside a little way inside it, from the outer
  // edge of the thigh all the way in to the foot of the cleft, where it meets
  // its twin. Deepest at that junction and fading out toward the flank, the way
  // the crease dies away there.
  for (const side of SIDES) {
    const outerX = side * GLUTE_FOLD_OUTER_X;

    const crease = ctx.createLinearGradient(outerX, GLUTE_FOLD_OUTER_Y, 0, GLUTE_FOLD_JUNCTION_Y);
    crease.addColorStop(0, SKIN_CREASE_FADE);
    crease.addColorStop(GLUTE_FOLD_FADE_STOP, SKIN_CREASE);
    crease.addColorStop(1, SKIN_CREASE);

    strokeSoftCrease(ctx, BUST_UNDERCURVE_LINE_WIDTH * UNDERCURVE_WEIGHT, crease, () => {
      ctx.moveTo(outerX, GLUTE_FOLD_OUTER_Y);
      ctx.bezierCurveTo(
        side * GLUTE_FOLD_OUTER_CONTROL_X,
        GLUTE_FOLD_OUTER_CONTROL_Y,
        side * GLUTE_FOLD_INNER_CONTROL_X,
        GLUTE_FOLD_INNER_CONTROL_Y,
        0,
        GLUTE_FOLD_JUNCTION_Y,
      );
    });
  }
}

/**
 * The bust, front view only. No forward detail is ever drawn on it: the shape
 * is carried entirely by the lit swell of each breast, the valley between them
 * and the crease underneath, and the hair locks cover the apexes on top of it.
 * Expects the caller to have already clipped to the torso path.
 */
function drawBust(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    0,
    BUST_SHADE_Y,
    BUST_SHADE_RADIUS_X,
    BUST_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    BUST_SHADE_ALPHA,
  );

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * UNDERBUST_SHADOW_X,
      UNDERBUST_SHADOW_Y,
      UNDERBUST_SHADOW_RADIUS_X,
      UNDERBUST_SHADOW_RADIUS_Y,
      SKIN_CREASE,
      SKIN_CREASE_FADE,
      UNDERBUST_SHADOW_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      side * BUST_HIGHLIGHT_X,
      BUST_HIGHLIGHT_Y,
      BUST_HIGHLIGHT_RADIUS_X,
      BUST_HIGHLIGHT_RADIUS_Y,
      SKIN_LIT,
      SKIN_LIT_FADE,
      BUST_HIGHLIGHT_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      side * BUST_OUTER_SHADE_X,
      BUST_OUTER_SHADE_Y,
      BUST_OUTER_SHADE_RADIUS_X,
      BUST_OUTER_SHADE_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      BUST_OUTER_SHADE_ALPHA,
    );
  }

  fillSoftEllipse(
    ctx,
    0,
    (CLEAVAGE_TOP_Y + CLEAVAGE_BOTTOM_Y) / 2,
    CLEAVAGE_HALF_WIDTH,
    (CLEAVAGE_BOTTOM_Y - CLEAVAGE_TOP_Y) / 2,
    SKIN_CREASE,
    SKIN_CREASE_FADE,
    CLEAVAGE_ALPHA,
  );

  for (const side of SIDES) {
    const centerX = side * BUST_POINT_X;
    const arcStartX = centerX + BUST_UNDERCURVE_RADIUS * Math.cos(BUST_UNDERCURVE_ARC_START);
    const arcStartY = BUST_POINT_Y + BUST_UNDERCURVE_RADIUS * Math.sin(BUST_UNDERCURVE_ARC_START);
    const arcEndX = centerX + BUST_UNDERCURVE_RADIUS * Math.cos(BUST_UNDERCURVE_ARC_END);
    const arcEndY = BUST_POINT_Y + BUST_UNDERCURVE_RADIUS * Math.sin(BUST_UNDERCURVE_ARC_END);

    const crease = ctx.createLinearGradient(arcStartX, arcStartY, arcEndX, arcEndY);
    crease.addColorStop(0, SKIN_CREASE_FADE);
    crease.addColorStop(BUST_UNDERCURVE_FADE_IN, SKIN_CREASE);
    crease.addColorStop(BUST_UNDERCURVE_FADE_OUT, SKIN_CREASE);
    crease.addColorStop(1, SKIN_CREASE_FADE);

    strokeSoftCrease(ctx, BUST_UNDERCURVE_LINE_WIDTH * UNDERCURVE_WEIGHT, crease, () => {
      ctx.arc(
        centerX,
        BUST_POINT_Y,
        BUST_UNDERCURVE_RADIUS,
        BUST_UNDERCURVE_ARC_START,
        BUST_UNDERCURVE_ARC_END,
      );
    });
  }
}

/**
 * The front of the pelvis, front view only. Expects the caller to have already
 * clipped to the torso path. Most of it is left bare by the thong, so without
 * the hip swells and the groin creases it is the widest blank field on her.
 */
function drawPelvisFront(ctx: CanvasRenderingContext2D): void {
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * HIP_SWELL_X,
      HIP_SWELL_Y,
      HIP_SWELL_RADIUS_X,
      HIP_SWELL_RADIUS_Y,
      SKIN_LIT,
      SKIN_LIT_FADE,
      HIP_SWELL_ALPHA,
    );
  }

  ctx.lineWidth = CONTOUR_LINE_WIDTH;
  for (const side of SIDES) {
    const topX = side * GROIN_CREASE_TOP_X;
    const bottomX = side * GROIN_CREASE_BOTTOM_X;

    const crease = ctx.createLinearGradient(
      topX,
      GROIN_CREASE_TOP_Y,
      bottomX,
      GROIN_CREASE_BOTTOM_Y,
    );
    crease.addColorStop(0, SKIN_SHADE_FADE);
    crease.addColorStop(GROIN_CREASE_FADE_STOP, SKIN_SHADE);
    crease.addColorStop(1, SKIN_SHADE);
    ctx.strokeStyle = crease;

    ctx.beginPath();
    ctx.moveTo(topX, GROIN_CREASE_TOP_Y);
    ctx.quadraticCurveTo(
      side * GROIN_CREASE_CONTROL_X,
      GROIN_CREASE_CONTROL_Y,
      bottomX,
      GROIN_CREASE_BOTTOM_Y,
    );
    ctx.stroke();
  }
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  castGlow: number,
  tileSizePx: number,
  facingAway: boolean,
): void {
  pathTorso(ctx, facingAway);
  ctx.fillStyle = SKIN_LIT;
  ctx.fill();

  ctx.save();
  pathTorso(ctx, facingAway);
  ctx.clip();

  // Waist and flank shading — the hourglass reads from the shading, not the outline
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * WAIST_HALF_WIDTH,
      WAIST_Y,
      FLANK_SHADE_RADIUS_X,
      FLANK_SHADE_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      FLANK_SHADE_ALPHA,
    );
  }

  if (facingAway) {
    for (const side of SIDES) {
      strokeSoftCrease(ctx, BUST_UNDERCURVE_LINE_WIDTH, SKIN_DEEP_SHADE, () => {
        ctx.moveTo(side * SHOULDER_BLADE_X, SHOULDER_BLADE_TOP_Y);
        ctx.quadraticCurveTo(
          side * (SHOULDER_BLADE_X + SHOULDER_BLADE_FLARE),
          (SHOULDER_BLADE_TOP_Y + SHOULDER_BLADE_BOTTOM_Y) / 2,
          side * SHOULDER_BLADE_X * 0.6,
          SHOULDER_BLADE_BOTTOM_Y,
        );
      });
    }

    // The spine is a groove that deepens toward the small of her back, not a
    // ruled line down the middle of a flat panel.
    const spine = ctx.createLinearGradient(0, SHOULDER_BLADE_TOP_Y, 0, HIP_Y);
    spine.addColorStop(0, SKIN_SHADE_FADE);
    spine.addColorStop(SPINE_FADE_STOP, SKIN_SHADE);
    spine.addColorStop(1, SKIN_CREASE);
    strokeSoftCrease(ctx, CONTOUR_LINE_WIDTH, spine, () => {
      ctx.moveTo(0, SHOULDER_BLADE_TOP_Y);
      ctx.lineTo(0, HIP_Y);
    });

    drawGlutes(ctx);
  } else {
    drawBust(ctx);
    drawPelvisFront(ctx);
  }

  // Navel and the soft line of the abdomen
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = CONTOUR_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, WAIST_Y - ABDOMEN_LINE_RISE);
  ctx.lineTo(0, WAIST_Y + ABDOMEN_LINE_DROP);
  ctx.stroke();

  drawScalePatch(ctx, -HIP_HALF_WIDTH * 0.7, WAIST_Y + 0.04, HIP_HALF_WIDTH * 1.4, HIP_Y - WAIST_Y);

  applyInkStyle(ctx, castGlow, tileSizePx);
  if (facingAway) {
    // The book's shoulder-blade fish — see BACK_FISH_Y for why it sits a little
    // below the blades themselves.
    stampTattoo(ctx, drawSmallFishMotif, timeSec, {
      x: -BACK_FISH_X,
      y: BACK_FISH_Y,
      size: 0.05,
      phase: 5.2,
      detail: true,
    });
    stampTattoo(ctx, drawDragonMotif, timeSec, {
      x: 0.004,
      y: WAIST_Y + 0.05,
      size: 0.115,
      phase: 1.9,
    });
  } else {
    stampTattoo(ctx, drawOctopusMotif, timeSec, {
      x: 0.004,
      y: WAIST_Y + 0.045,
      size: 0.115,
      phase: 1.9,
    });
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  drawSkinRipple(ctx, timeSec, SHOULDER_Y, CROTCH_Y);
  ctx.restore();
}

const ARM_ROOT_Y = SHOULDER_Y + ARM_ROOT_Y_OFFSET;

function armRootX(side: BodySide): number {
  return side * SHOULDER_HALF_WIDTH * ARM_ROOT_X_FRACTION;
}

/**
 * Where a given arm's hand ends up, so effects can be emitted from it instead
 * of from a pose-specific guess that only lines up in one gesture.
 *
 * Mirrors the transform `drawArm` builds: canvas rotates clockwise, and each
 * segment is drawn down its own +y axis.
 */
function armHandPoint(
  side: BodySide,
  shoulderAngle: number,
  elbowAngle: number,
): { x: number; y: number } {
  const shoulderRotation = -side * shoulderAngle;
  const elbowRotation = shoulderRotation - side * elbowAngle;
  const elbowX = armRootX(side) - UPPER_ARM_LENGTH * Math.sin(shoulderRotation);
  const elbowY = ARM_ROOT_Y + UPPER_ARM_LENGTH * Math.cos(shoulderRotation);
  const handReach = FOREARM_LENGTH + HAND_RADIUS * HAND_CENTER_REACH_FRACTION;
  return {
    x: elbowX - handReach * Math.sin(elbowRotation),
    y: elbowY + handReach * Math.cos(elbowRotation),
  };
}

/**
 * The capsule a stroked limb actually covers, so its flash can be clipped to
 * the skin instead of trailing off the arm into the air.
 */
function pathLimb(ctx: CanvasRenderingContext2D, width: number, length: number): void {
  const radius = width / 2;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(-radius, length);
  ctx.arc(0, length, radius, HALF_TURN, 0, true);
  ctx.lineTo(radius, 0);
  ctx.arc(0, 0, radius, 0, HALF_TURN, true);
  ctx.closePath();
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  side: BodySide,
  shoulderAngle: number,
  elbowAngle: number,
  timeSec: number,
  castGlow: number,
  tileSizePx: number,
): void {
  ctx.save();
  ctx.translate(armRootX(side), ARM_ROOT_Y);
  ctx.rotate(-side * shoulderAngle);

  ctx.strokeStyle = SKIN_LIT;
  ctx.lineCap = 'round';
  ctx.lineWidth = UPPER_ARM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, UPPER_ARM_LENGTH);
  ctx.stroke();

  ctx.save();
  pathLimb(ctx, UPPER_ARM_WIDTH, UPPER_ARM_LENGTH);
  ctx.clip();
  applyInkStyle(ctx, castGlow, tileSizePx);
  stampTattoo(ctx, drawDragonMotif, timeSec, {
    x: 0,
    y: UPPER_ARM_LENGTH * 0.6,
    size: 0.095,
    phase: side < 0 ? 0.9 : 2.8,
    detail: true,
  });
  ctx.restore();

  ctx.translate(0, UPPER_ARM_LENGTH);
  ctx.rotate(-side * elbowAngle);

  ctx.strokeStyle = SKIN_BASE;
  ctx.lineWidth = FOREARM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, FOREARM_LENGTH);
  ctx.stroke();

  ctx.save();
  pathLimb(ctx, FOREARM_WIDTH, FOREARM_LENGTH);
  ctx.clip();
  applyInkStyle(ctx, castGlow, tileSizePx);
  stampTattoo(ctx, drawEelLightningMotif, timeSec, {
    x: 0,
    y: FOREARM_LENGTH * 0.5,
    size: 0.095,
    phase: side < 0 ? 3.3 : 1.6,
    detail: true,
  });
  ctx.restore();

  ctx.fillStyle = SKIN_BASE;
  ctx.beginPath();
  ctx.arc(
    0,
    FOREARM_LENGTH + HAND_RADIUS * HAND_CENTER_REACH_FRACTION,
    HAND_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Long dark nails, as in her portrait
  ctx.strokeStyle = NAIL_COLOR;
  ctx.lineWidth = CONTOUR_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < NAIL_COUNT; i++) {
    const spread = (i / (NAIL_COUNT - 1) - 0.5) * 1.4;
    const nailRootX = spread * HAND_RADIUS;
    ctx.beginPath();
    ctx.moveTo(nailRootX, FOREARM_LENGTH + HAND_RADIUS);
    ctx.lineTo(nailRootX * 1.6, FOREARM_LENGTH + HAND_RADIUS + NAIL_LENGTH);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBackHair(ctx: CanvasRenderingContext2D, sway: number): void {
  ctx.fillStyle = HAIR_DARK;
  ctx.beginPath();
  ctx.moveTo(0, BACK_HAIR_TOP_Y);
  for (const side of SIDES) {
    ctx.quadraticCurveTo(
      side * BACK_HAIR_HALF_WIDTH * 0.5,
      SHOULDER_Y,
      side * BACK_HAIR_HALF_WIDTH,
      BACK_HAIR_FLARE_Y,
    );
    ctx.quadraticCurveTo(
      side * BACK_HAIR_HALF_WIDTH * 0.8 + sway,
      BACK_HAIR_BOTTOM_Y,
      side * BACK_HAIR_HALF_WIDTH * 0.18 + sway,
      BACK_HAIR_BOTTOM_Y,
    );
    ctx.quadraticCurveTo(side * 0.02, BACK_HAIR_FLARE_Y, 0, BACK_HAIR_TOP_Y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = HAIR_SHEEN;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  for (let i = 0; i < HAIR_STRAND_COUNT; i++) {
    const spread = (i / (HAIR_STRAND_COUNT - 1) - 0.5) * 2;
    ctx.beginPath();
    ctx.moveTo(spread * 0.04, BACK_HAIR_TOP_Y + 0.03);
    ctx.quadraticCurveTo(
      spread * BACK_HAIR_HALF_WIDTH * 0.9,
      BACK_HAIR_FLARE_Y,
      spread * BACK_HAIR_HALF_WIDTH * 0.55 + sway,
      BACK_HAIR_BOTTOM_Y - 0.04,
    );
    ctx.stroke();
  }
}

/**
 * The two chest locks. They start behind the ears, pass straight over the bust
 * apexes and end below the ribs, so the apexes are covered in every pose — the
 * locks are part of the silhouette, not a decoration that can drift off it.
 */
function drawChestLocks(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  headRotation: number,
): void {
  const rootCos = Math.cos(headRotation);
  const rootSin = Math.sin(headRotation);
  /** Follows the head, which rotates about the body origin. */
  const rootPoint = (x: number): { x: number; y: number } => ({
    x: x * rootCos - FRONT_LOCK_TOP_Y * rootSin,
    y: x * rootSin + FRONT_LOCK_TOP_Y * rootCos,
  });

  ctx.fillStyle = HAIR_DARK;
  for (const side of SIDES) {
    const drift = Math.sin(timeSec * FRONT_LOCK_DRIFT_SPEED + side) * FRONT_LOCK_DRIFT;
    const rootX = side * (HEAD_RADIUS_X * 0.75);
    const tipX = side * FRONT_LOCK_CENTER_X + drift;

    // The apex-height anchors are explicit path points rather than curve
    // controls, so the lock is provably `FRONT_LOCK_HALF_WIDTH` wide exactly
    // where it has to be — coverage cannot be lost to curve slack.
    const outerRoot = rootPoint(rootX - FRONT_LOCK_ROOT_HALF_WIDTH);
    const innerRoot = rootPoint(rootX + FRONT_LOCK_ROOT_HALF_WIDTH);

    ctx.beginPath();
    ctx.moveTo(outerRoot.x, outerRoot.y);
    ctx.quadraticCurveTo(
      rootX - FRONT_LOCK_HALF_WIDTH,
      BUST_Y,
      tipX - FRONT_LOCK_HALF_WIDTH,
      BUST_POINT_Y,
    );
    ctx.quadraticCurveTo(
      tipX - FRONT_LOCK_HALF_WIDTH * 0.9,
      FRONT_LOCK_BOTTOM_Y - FRONT_LOCK_TIP_LENGTH,
      tipX - FRONT_LOCK_HALF_WIDTH * 0.25,
      FRONT_LOCK_BOTTOM_Y,
    );
    ctx.lineTo(tipX, FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH);
    ctx.quadraticCurveTo(
      tipX + FRONT_LOCK_HALF_WIDTH * 0.9,
      FRONT_LOCK_BOTTOM_Y - FRONT_LOCK_TIP_LENGTH,
      tipX + FRONT_LOCK_HALF_WIDTH,
      BUST_POINT_Y,
    );
    ctx.quadraticCurveTo(rootX + FRONT_LOCK_HALF_WIDTH, BUST_Y, innerRoot.x, innerRoot.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    ctx.beginPath();
    const strandRoot = rootPoint(rootX);
    ctx.moveTo(strandRoot.x, strandRoot.y + 0.02);
    ctx.quadraticCurveTo(rootX + side * 0.01, BUST_Y, tipX, FRONT_LOCK_BOTTOM_Y - 0.03);
    ctx.stroke();
  }
}

/**
 * The fall of hair down her back: separate tapered locks rather than one mass,
 * because a single slab with one clean hem reads as a garment. Every lock ends
 * at the same `HAIR_LENGTH_Y` as the front, shortened toward the outside by
 * `BACK_LOCK_LENGTH_FALLOFF` so the hem is ragged, and split by a centre
 * parting.
 */
function drawBackCurtain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = HAIR_DARK;
  for (let i = 0; i < BACK_LOCK_COUNT; i++) {
    const spread = (i / (BACK_LOCK_COUNT - 1) - 0.5) * 2;
    const parting = Math.sign(spread) * BACK_LOCK_PARTING;
    const rootX = spread * BACK_LOCK_ROOT_SPREAD + parting;
    const tipX = spread * BACK_LOCK_TIP_SPREAD + parting;
    const bottomY = HAIR_LENGTH_Y - Math.abs(spread) * BACK_LOCK_LENGTH_FALLOFF;

    ctx.beginPath();
    ctx.moveTo(rootX - BACK_LOCK_HALF_WIDTH, BACK_LOCK_TOP_Y);
    ctx.quadraticCurveTo(
      tipX - BACK_LOCK_HALF_WIDTH,
      BUST_Y,
      tipX - BACK_LOCK_HALF_WIDTH * 0.3,
      bottomY,
    );
    ctx.lineTo(tipX, bottomY + BACK_LOCK_TIP_LENGTH);
    ctx.quadraticCurveTo(
      tipX + BACK_LOCK_HALF_WIDTH,
      BUST_Y,
      rootX + BACK_LOCK_HALF_WIDTH,
      BACK_LOCK_TOP_Y,
    );
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    ctx.beginPath();
    ctx.moveTo(rootX, BACK_LOCK_TOP_Y + 0.02);
    ctx.quadraticCurveTo(tipX, BUST_Y, tipX, bottomY - 0.01);
    ctx.stroke();
  }
}

/** Crown down one side of the face to the point of the chin. */
function traceFaceSideDown(ctx: CanvasRenderingContext2D, side: BodySide): void {
  ctx.bezierCurveTo(
    side * TEMPLE_CONTROL_X,
    HEAD_CROWN_Y,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y - CRANIUM_CONTROL_RISE,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y,
  );
  ctx.bezierCurveTo(
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y + CHEEK_TO_JAW_CONTROL_DROP,
    side * JAW_CORNER_X,
    JAW_CORNER_Y,
    side * CHIN_HALF_WIDTH,
    CHIN_SHOULDER_Y,
  );
  ctx.quadraticCurveTo(side * CHIN_HALF_WIDTH * CHIN_ROUND_CONTROL_FRACTION, CHIN_Y, 0, CHIN_Y);
}

/** The same profile walked the other way, to close the outline at the crown. */
function traceFaceSideUp(ctx: CanvasRenderingContext2D, side: BodySide): void {
  ctx.quadraticCurveTo(
    side * CHIN_HALF_WIDTH * CHIN_ROUND_CONTROL_FRACTION,
    CHIN_Y,
    side * CHIN_HALF_WIDTH,
    CHIN_SHOULDER_Y,
  );
  ctx.bezierCurveTo(
    side * JAW_CORNER_X,
    JAW_CORNER_Y,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y + CHEEK_TO_JAW_CONTROL_DROP,
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y,
  );
  ctx.bezierCurveTo(
    side * HEAD_RADIUS_X,
    CHEEKBONE_Y - CRANIUM_CONTROL_RISE,
    side * TEMPLE_CONTROL_X,
    HEAD_CROWN_Y,
    0,
    HEAD_CROWN_Y,
  );
}

function pathFace(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, HEAD_CROWN_Y);
  traceFaceSideDown(ctx, 1);
  traceFaceSideUp(ctx, -1);
  ctx.closePath();
}

/**
 * Modelling only — no drawn line anywhere on it. A face this small is carried
 * by where the light stops: the shaded side, the hollow under each cheekbone,
 * and the shadow the jaw casts on the neck.
 */
function shadeFace(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    FACE_SHADOW_SIDE * TEMPLE_SHADE_X,
    TEMPLE_SHADE_Y,
    TEMPLE_SHADE_RADIUS_X,
    TEMPLE_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    CHEEK_SHADE_ALPHA,
  );

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * CHEEK_HOLLOW_X,
      CHEEK_HOLLOW_Y,
      CHEEK_HOLLOW_RADIUS_X,
      CHEEK_HOLLOW_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      CHEEK_HOLLOW_ALPHA,
    );
  }

  fillSoftEllipse(
    ctx,
    0,
    JAW_SHADE_Y,
    JAW_SHADE_RADIUS_X,
    JAW_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    JAW_SHADE_ALPHA,
  );
}

function drawBrows(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = HAIR_DARK;
  ctx.globalAlpha = BROW_ALPHA;
  ctx.lineWidth = BROW_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of SIDES) {
    const archX = BROW_INNER_X + (BROW_OUTER_X - BROW_INNER_X) * BROW_ARCH_X_FRACTION;
    ctx.beginPath();
    ctx.moveTo(side * BROW_INNER_X, BROW_Y);
    ctx.quadraticCurveTo(side * archX, BROW_Y - BROW_ARCH_RISE, side * BROW_OUTER_X, BROW_Y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The almond outline of one eye, inner corner low and outer corner lifted. */
function pathEye(ctx: CanvasRenderingContext2D, side: BodySide): void {
  const innerX = side * (EYE_X - EYE_RADIUS_X);
  const outerX = side * (EYE_X + EYE_RADIUS_X);
  const outerY = EYE_Y - EYE_OUTER_CORNER_RISE;
  ctx.beginPath();
  ctx.moveTo(innerX, EYE_Y);
  ctx.quadraticCurveTo(side * EYE_X, EYE_Y - EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, outerX, outerY);
  ctx.quadraticCurveTo(side * EYE_X, EYE_Y + EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, innerX, EYE_Y);
  ctx.closePath();
}

function drawEyes(ctx: CanvasRenderingContext2D, castGlow: number, tileSizePx: number): void {
  ctx.save();
  ctx.shadowColor = castGlow > 0 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  ctx.shadowBlur =
    (EYE_GLOW_BLUR_IDLE_PX + (EYE_GLOW_BLUR_CAST_PX - EYE_GLOW_BLUR_IDLE_PX) * castGlow) *
    (tileSizePx / GLOW_REFERENCE_TILE_PX);
  ctx.fillStyle = castGlow > 0.5 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  for (const side of SIDES) {
    pathEye(ctx, side);
    ctx.fill();
  }
  ctx.restore();

  if (castGlow < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - castGlow;
    ctx.fillStyle = HAIR_DARK;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(side * EYE_X, EYE_Y, PUPIL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(
        side * EYE_X - EYE_CATCHLIGHT_OFFSET,
        EYE_Y - EYE_CATCHLIGHT_OFFSET,
        EYE_CATCHLIGHT_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  // The lash line, laid over the upper lid and flicked past the outer corner.
  ctx.save();
  ctx.strokeStyle = HAIR_DARK;
  ctx.lineWidth = LASH_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of SIDES) {
    const innerX = side * (EYE_X - EYE_RADIUS_X);
    const outerX = side * (EYE_X + EYE_RADIUS_X);
    const outerY = EYE_Y - EYE_OUTER_CORNER_RISE;
    ctx.beginPath();
    ctx.moveTo(innerX, EYE_Y);
    ctx.quadraticCurveTo(side * EYE_X, EYE_Y - EYE_RADIUS_Y * EYE_LID_CONTROL_RISE, outerX, outerY);
    ctx.quadraticCurveTo(
      outerX + side * LASH_FLICK_LENGTH * 0.6,
      outerY - LASH_FLICK_RISE * 0.4,
      outerX + side * LASH_FLICK_LENGTH,
      outerY - LASH_FLICK_RISE,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawNose(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    FACE_SHADOW_SIDE * NOSE_HALF_WIDTH * 0.55,
    (NOSE_BRIDGE_TOP_Y + NOSE_TIP_Y) / 2,
    NOSE_BRIDGE_SHADE_RADIUS_X,
    (NOSE_TIP_Y - NOSE_BRIDGE_TOP_Y) / 2,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    NOSE_BRIDGE_SHADE_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    0,
    NOSE_TIP_SHADE_Y,
    NOSE_TIP_SHADE_RADIUS_X,
    NOSE_TIP_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    NOSE_TIP_SHADE_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    -FACE_SHADOW_SIDE * NOSE_HALF_WIDTH * 0.3,
    NOSE_TIP_HIGHLIGHT_Y,
    NOSE_TIP_HIGHLIGHT_RADIUS,
    NOSE_TIP_HIGHLIGHT_RADIUS,
    SKIN_LIT,
    SKIN_LIT_FADE,
    NOSE_TIP_HIGHLIGHT_ALPHA,
  );
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * NOSTRIL_X,
      NOSE_TIP_Y,
      NOSTRIL_RADIUS_X,
      NOSTRIL_RADIUS_Y,
      SKIN_CREASE,
      SKIN_CREASE_FADE,
      NOSTRIL_ALPHA,
    );
  }
}

/**
 * The seam where the lips meet, continued from the current point across to the
 * far corner. Both lip shapes and the line drawn over them trace the same
 * curve, so no sliver of skin can open along the join.
 */
function pathLipSeam(ctx: CanvasRenderingContext2D, towardX: number): void {
  ctx.quadraticCurveTo(0, MOUTH_Y + LIP_SEAM_DROP, towardX, MOUTH_Y);
}

function drawMouth(ctx: CanvasRenderingContext2D): void {
  const peakY = MOUTH_Y - UPPER_LIP_HEIGHT;
  const bowDipY = MOUTH_Y - UPPER_LIP_HEIGHT * CUPIDS_BOW_DIP;
  const peakControlX = MOUTH_HALF_WIDTH * LIP_PEAK_CONTROL_FRACTION;

  ctx.fillStyle = LIP_UPPER_COLOR;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  ctx.quadraticCurveTo(-peakControlX, peakY, -CUPIDS_BOW_X, peakY);
  ctx.quadraticCurveTo(0, bowDipY, CUPIDS_BOW_X, peakY);
  ctx.quadraticCurveTo(peakControlX, peakY, MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, -MOUTH_HALF_WIDTH);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = LIP_COLOR;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, MOUTH_HALF_WIDTH);
  ctx.quadraticCurveTo(
    MOUTH_HALF_WIDTH * 0.62,
    MOUTH_Y + LOWER_LIP_HEIGHT,
    0,
    MOUTH_Y + LOWER_LIP_HEIGHT,
  );
  ctx.quadraticCurveTo(
    -MOUTH_HALF_WIDTH * 0.62,
    MOUTH_Y + LOWER_LIP_HEIGHT,
    -MOUTH_HALF_WIDTH,
    MOUTH_Y,
  );
  ctx.closePath();
  ctx.fill();

  fillSoftEllipse(
    ctx,
    0,
    MOUTH_Y + LOWER_LIP_HEIGHT * LOWER_LIP_SHEEN_Y_FRACTION,
    LOWER_LIP_SHEEN_RADIUS_X,
    LOWER_LIP_SHEEN_RADIUS_Y,
    LIP_SHEEN_COLOR,
    LIP_SHEEN_FADE,
    LOWER_LIP_SHEEN_ALPHA,
  );

  ctx.strokeStyle = LIP_SEAM_COLOR;
  ctx.lineWidth = LIP_SEAM_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  pathLipSeam(ctx, MOUTH_HALF_WIDTH);
  ctx.stroke();

  fillSoftEllipse(
    ctx,
    0,
    CHIN_SHADOW_Y,
    CHIN_SHADOW_RADIUS_X,
    CHIN_SHADOW_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    CHIN_SHADOW_ALPHA,
  );

  ctx.fillStyle = '#ffffff';
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * FANG_X - FANG_HALF_WIDTH, MOUTH_Y);
    ctx.lineTo(side * FANG_X + FANG_HALF_WIDTH, MOUTH_Y);
    ctx.lineTo(side * FANG_X, MOUTH_Y + FANG_LENGTH);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  castGlow: number,
  tileSizePx: number,
  facingAway: boolean,
): void {
  // Long high-elf ears, swept up and back behind the face
  ctx.fillStyle = SKIN_BASE;
  for (const side of SIDES) {
    const earRootX = side * HEAD_RADIUS_X * 0.8;
    ctx.beginPath();
    ctx.moveTo(earRootX, EAR_ROOT_Y - EAR_ROOT_HALF_HEIGHT);
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * 0.6,
      EAR_ROOT_Y - EAR_TIP_RISE * 0.6,
      earRootX + side * EAR_LENGTH,
      EAR_ROOT_Y - EAR_TIP_RISE,
    );
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * 0.5,
      EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT * 0.4,
      earRootX,
      EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT,
    );
    ctx.closePath();
    ctx.fill();

    // A shaded inner hollow, or the ears read as flat white paddles
    ctx.save();
    ctx.strokeStyle = SKIN_SHADE;
    ctx.lineWidth = FINE_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(earRootX + side * EAR_LENGTH * 0.15, EAR_ROOT_Y + EAR_ROOT_HALF_HEIGHT * 0.3);
    ctx.quadraticCurveTo(
      earRootX + side * EAR_LENGTH * 0.6,
      EAR_ROOT_Y - EAR_TIP_RISE * 0.25,
      earRootX + side * EAR_LENGTH * 0.85,
      EAR_ROOT_Y - EAR_TIP_RISE * 0.8,
    );
    ctx.stroke();
    ctx.restore();
  }

  pathFace(ctx);
  ctx.fillStyle = SKIN_LIT;
  ctx.fill();

  if (!facingAway) {
    ctx.save();
    pathFace(ctx);
    ctx.clip();
    shadeFace(ctx);
    ctx.restore();
  }

  ctx.fillStyle = HORN_COLOR;
  for (const side of SIDES) {
    const hornBaseY = HEAD_CENTER_Y - HEAD_RADIUS_Y * HORN_BASE_Y_FRACTION;
    ctx.beginPath();
    ctx.moveTo(side * HORN_X - HORN_BASE_HALF_WIDTH, hornBaseY);
    ctx.lineTo(side * HORN_X + HORN_BASE_HALF_WIDTH, hornBaseY);
    ctx.lineTo(side * (HORN_X + HORN_BASE_HALF_WIDTH), hornBaseY - HORN_LENGTH);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = HAIR_DARK;
  if (facingAway) {
    // The back of the head is all hair, so the whole skull is capped.
    ctx.beginPath();
    ctx.ellipse(
      0,
      HEAD_CENTER_Y,
      HEAD_RADIUS_X * BACK_OF_HEAD_WIDTH_FRACTION,
      HEAD_RADIUS_Y * BACK_OF_HEAD_HEIGHT_FRACTION,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = HAIR_SHEEN;
    ctx.lineWidth = HAIR_STRAND_WIDTH;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.moveTo(side * HEAD_RADIUS_X * 0.25, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.6);
      ctx.quadraticCurveTo(
        side * HEAD_RADIUS_X * 0.7,
        HEAD_CENTER_Y,
        side * HEAD_RADIUS_X * 0.45,
        HEAD_CENTER_Y + HEAD_RADIUS_Y,
      );
      ctx.stroke();
    }
    return;
  }

  // Hair crown and a centre-parted fringe framing the face
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTER_Y - 0.012, HEAD_RADIUS_X * 1.1, HEAD_RADIUS_Y * 0.95, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(0, HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.75);
    ctx.quadraticCurveTo(
      side * HEAD_RADIUS_X * 1.15,
      FRINGE_Y,
      side * HEAD_RADIUS_X * 1.0,
      HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.5,
    );
    ctx.quadraticCurveTo(
      side * HEAD_RADIUS_X * 0.95,
      FRINGE_Y,
      side * HEAD_RADIUS_X * 0.45,
      HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.55,
    );
    ctx.closePath();
    ctx.fill();
  }

  drawBrows(ctx);
  drawEyes(ctx, castGlow, tileSizePx);
  drawNose(ctx);
  drawMouth(ctx);
}

function drawSummonEffects(
  ctx: CanvasRenderingContext2D,
  summonProgress: number,
  handPoints: ReadonlyArray<{ x: number; y: number }>,
): void {
  const auraFade = Math.sin(summonProgress * Math.PI);
  ctx.save();
  ctx.globalAlpha = auraFade * SUMMON_AURA_ALPHA;
  const aura = ctx.createRadialGradient(0, WAIST_Y, 0, 0, WAIST_Y, SUMMON_AURA_RADIUS);
  aura.addColorStop(0, INK_GLOW_COLOR);
  aura.addColorStop(1, 'rgba(127,230,212,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, WAIST_Y, SUMMON_AURA_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = INK_GLOW_COLOR;
  for (const hand of handPoints) {
    for (let i = 0; i < INK_DROP_COUNT; i++) {
      const rise = (summonProgress + i / INK_DROP_COUNT) % 1;
      ctx.globalAlpha = (1 - rise) * auraFade;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y - rise * INK_DROP_RISE, INK_DROP_RADIUS * (1 - rise), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw Tsarina Signet: a tall, feminine half-naiad/half-high-elf summoner with
 * luminous pale skin, black hair cut just past the bust, long pointed ears, and heavy
 * old-school flash — a hammerhead, an octopus, dragons, a lightning eel, a
 * three-headed ogre and a small fish — that drifts beneath her skin. She wears
 * only a thong; the two chest locks of hair are load-bearing coverage and are
 * drawn over the bust in every pose.
 */
export function drawSignetSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pose: SignetPose,
): void {
  const timeSec = performance.now() / MS_PER_SECOND;
  const swingPhase = pose.isMoving ? Math.sin(pose.walkFrame) : 0;
  const bob = Math.abs(swingPhase) * WALK_BODY_BOB;
  const summonEase = pose.summonProgress > 0 ? Math.sin(pose.summonProgress * Math.PI) : 0;
  const castEase = pose.castProgress > 0 ? Math.sin(pose.castProgress * Math.PI) : 0;
  const eyeGlow = Math.max(summonEase, castEase);
  /** Her neck cancels most of the shoulder roll so her head stays near level. */
  const headRotation = swingPhase * WALK_SHOULDER_ROLL * HEAD_LEVELLING_SHARE;

  // Glow blur is in device pixels and ignores the transform, so the figure
  // scale has to be folded in by hand or her glows shrink as she grows.
  const glowTileSizePx = s * FIGURE_SCALE;

  ctx.save();
  ctx.translate(sx + s / 2, sy + s / 2);
  if (pose.facingX < 0) ctx.scale(-1, 1);
  ctx.scale(s, s);
  ctx.translate(0, FOOT_Y);
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
  ctx.translate(0, -FOOT_Y - bob);

  const hipShift = swingPhase * WALK_HIP_SHIFT;

  drawBackHair(ctx, swingPhase * WALK_HAIR_SWAY);
  drawLegs(ctx, timeSec, swingPhase, hipShift, pose.facingAway, eyeGlow, glowTileSizePx);

  // Hips shift onto the planted foot and the shoulders roll back against them;
  // that opposition is what makes the front-on walk read as a walk. The legs
  // took the same shift above, and the roll pivots at the hip, so the pelvis
  // and the thighs stay one body through the whole stride.
  ctx.save();
  ctx.translate(hipShift, 0);
  ctx.translate(0, TORSO_PIVOT_Y);
  ctx.rotate(-swingPhase * WALK_SHOULDER_ROLL);
  ctx.translate(0, -TORSO_PIVOT_Y);
  drawTorso(ctx, timeSec, eyeGlow, glowTileSizePx, pose.facingAway);
  drawThong(ctx, pose.facingAway);

  const handPoints: { x: number; y: number }[] = [];
  for (const side of SIDES) {
    const walkSwing = swingPhase * -side * WALK_ARM_SWING;
    const restShoulder = ARM_REST_ANGLE + walkSwing;
    // The right arm leads the throw; the left stays near its resting swing so
    // the cast reads as a one-handed push rather than a symmetric shrug.
    const castShoulder = side > 0 ? ARM_CAST_ANGLE : restShoulder;
    const castElbow = side > 0 ? ELBOW_CAST_ANGLE : ELBOW_REST_ANGLE;
    const shoulderAngle =
      restShoulder +
      (castShoulder - restShoulder) * castEase +
      (ARM_SUMMON_ANGLE - restShoulder) * summonEase;
    const elbowAngle =
      ELBOW_REST_ANGLE +
      (castElbow - ELBOW_REST_ANGLE) * castEase +
      (ELBOW_SUMMON_ANGLE - ELBOW_REST_ANGLE) * summonEase;
    drawArm(ctx, side, shoulderAngle, elbowAngle, timeSec, eyeGlow, glowTileSizePx);
    handPoints.push(armHandPoint(side, shoulderAngle, elbowAngle));
  }

  if (pose.facingAway) {
    drawBackCurtain(ctx);
  } else {
    drawChestLocks(ctx, timeSec, headRotation);
  }

  // Her head rides with the shoulders but keeps itself close to level, the way
  // a walker's gaze stays on the horizon.
  ctx.save();
  ctx.rotate(headRotation);
  drawHead(ctx, eyeGlow, glowTileSizePx, pose.facingAway);
  ctx.restore();

  // Inside the torso transform so the ink leaves the hands as drawn, not where
  // an unshifted body would have put them.
  if (summonEase > 0) drawSummonEffects(ctx, pose.summonProgress, handPoints);

  ctx.restore();

  const shimmerPulse =
    SHIMMER_PULSE_FLOOR + SHIMMER_PULSE_SWING * Math.sin(timeSec * SHIMMER_PULSE_SPEED);
  const shimmerCenterY = (HEAD_CENTER_Y + FOOT_Y) / 2;
  const shimmerRadiusY = (FOOT_Y - HEAD_CENTER_Y) * SHIMMER_HEIGHT_FRACTION;
  const shimmerRadiusX = BACK_HAIR_HALF_WIDTH * SHIMMER_WIDTH_FRACTION;
  ctx.save();
  ctx.globalAlpha = SHIMMER_ALPHA * shimmerPulse;
  // Vertically stretched so one radial gradient covers the whole figure and
  // still fades out before the empty tile around her head and shoulders.
  ctx.translate(0, shimmerCenterY);
  ctx.scale(1, shimmerRadiusY / shimmerRadiusX);
  const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, shimmerRadiusX);
  sheen.addColorStop(0, SHIMMER_COLOR);
  sheen.addColorStop(1, SHIMMER_EDGE_COLOR);
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(0, 0, shimmerRadiusX, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
