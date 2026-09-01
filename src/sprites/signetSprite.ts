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
const BUST_HALF_WIDTH = 0.1;
/**
 * From behind, the bust still shows past the ribs at the sides, but only as a
 * side swell — carrying the full front projection round the back gives her two
 * bulges under her shoulder blades.
 */
const BACK_CHEST_HALF_WIDTH = 0.094;

/**
 * The chest silhouette is three segments per side, not one: the ribcage tucks
 * in under the deltoid, each breast swells out past the shoulder line, and the
 * outline falls back in to the ribs beneath it. Run as a single curve from
 * shoulder to waist the breasts exist only in the shading, and no amount of
 * modelling inside a straight-sided chest makes them read.
 */
const ARMPIT_Y = SHOULDER_Y + 0.026;
const ARMPIT_HALF_WIDTH = SHOULDER_HALF_WIDTH * 0.94;
const RIBCAGE_HALF_WIDTH = 0.072;
const WAIST_Y = -0.022;
const WAIST_HALF_WIDTH = 0.058;
const HIP_Y = 0.075;
const HIP_HALF_WIDTH = 0.098;
const CROTCH_Y = 0.142;
const CROTCH_HALF_WIDTH = 0.036;

/** Bust apex — the point the hair locks are required to cover. */
const BUST_POINT_X = 0.048;
const BUST_POINT_Y = -0.115;
const BUST_UNDERCURVE_RADIUS = 0.046;
/** Where each breast is widest, and where the ribs pick the outline back up. */
const BUST_WIDEST_Y = BUST_POINT_Y + 0.004;
const RIBCAGE_Y = BUST_POINT_Y + 0.052;
/** Only the lower outside of the circle is drawn, so it reads as a soft crease. */
const BUST_UNDERCURVE_ARC_START = HALF_TURN * 0.1;
const BUST_UNDERCURVE_ARC_END = HALF_TURN * 0.76;
/** The undercurve carries the whole read of the form, so it is drawn heavier
 * than the other creases on her. */
const UNDERCURVE_WEIGHT = 1.15;
/** Deepest through the middle of the arc, fading out at both ends. */
const BUST_UNDERCURVE_FADE_IN = 0.16;
const BUST_UNDERCURVE_FADE_OUT = 0.88;

/**
 * The locks cover the apexes and nothing else, so the breasts themselves have
 * to carry their own volume, and they carry it with four shapes per side and no
 * more. A form this small drowns in stacked soft ellipses: every extra pass
 * lands its own faded rim somewhere on the skin, and a dozen of those is not
 * shading but grain.
 */

/**
 * The chest wall between the collarbones and the breast tops, dropped a step.
 * The top of the breast is a border between two values, so there has to be a
 * second value for it to border against — without this the lit swell fades up
 * into skin of its own brightness and the form has no top at all.
 */
const UPPER_CHEST_SHADE_Y = SHOULDER_Y + 0.03;
const UPPER_CHEST_SHADE_RADIUS_X = 0.088;
const UPPER_CHEST_SHADE_RADIUS_Y = 0.042;
const UPPER_CHEST_SHADE_ALPHA = 0.5;

/**
 * The form shadow, offset down and outward from the apex rather than centred on
 * it. Concentric with the light it makes the terminator a circle, which is the
 * whole reason airbrushed shading reads as painted on; offset, the boundary
 * between the two becomes a diagonal running the way the breast actually turns.
 */
const BUST_SHADE_X = BUST_POINT_X * 1.24;
const BUST_SHADE_Y = BUST_POINT_Y + 0.026;
const BUST_SHADE_RADIUS_X = 0.05;
const BUST_SHADE_RADIUS_Y = 0.038;
const BUST_SHADE_ALPHA = 0.95;
/** Held nearly to the edge; at the default falloff the wash never reaches full
 * strength anywhere on a form this size. */
const BUST_SHADE_CORE_FRACTION = 0.55;

/** The lit swell, up and inboard, its upper edge the top of the form. */
const BUST_HIGHLIGHT_X = BUST_POINT_X * 0.86;
const BUST_HIGHLIGHT_Y = BUST_POINT_Y - 0.026;
const BUST_HIGHLIGHT_RADIUS_X = 0.044;
const BUST_HIGHLIGHT_RADIUS_Y = 0.03;
const BUST_HIGHLIGHT_ALPHA = 1;
const BUST_HIGHLIGHT_CORE_FRACTION = 0.5;

/**
 * The shadow each breast casts onto the ribs beneath it. The crease alone only
 * ever draws the edge of the form; this is what gives it its projection.
 */
const UNDERBUST_SHADOW_X = BUST_POINT_X * 0.96;
const UNDERBUST_SHADOW_Y = BUST_POINT_Y + 0.05;
const UNDERBUST_SHADOW_RADIUS_X = 0.042;
const UNDERBUST_SHADOW_RADIUS_Y = 0.018;
const UNDERBUST_SHADOW_ALPHA = 0.85;

/** The valley between them: narrow and deep where they press together at the
 * bottom, opening and dying out toward the collarbones. */
const CLEAVAGE_TOP_Y = BUST_Y - 0.022;
const CLEAVAGE_BOTTOM_Y = BUST_POINT_Y + 0.03;
const CLEAVAGE_TOP_HALF_WIDTH = 0.019;
const CLEAVAGE_BOTTOM_HALF_WIDTH = 0.006;
const CLEAVAGE_ALPHA = 0.85;
const CLEAVAGE_FADE_STOP = 0.34;

/**
 * Each breast sits on the ribcage turned up and outward, so the light and the
 * shadow on it share that axis. Left square to the sprite they read as two
 * discs shaded top-to-bottom.
 */
const BUST_AXIS_TILT = -0.34;

/**
 * The shelf the bust hangs from. Without it the whole span from the throat to
 * the breasts is one unbroken field, and the chest reads as a blank board with
 * two shapes shaded onto it.
 */
const COLLARBONE_INNER_X = 0.012;
const COLLARBONE_OUTER_X = SHOULDER_HALF_WIDTH * 0.84;
const COLLARBONE_Y = SHOULDER_Y + 0.012;
const COLLARBONE_DIP = 0.012;
const COLLARBONE_FADE_STOP = 0.72;
/** The lit edge sitting on top of the bone, without which it is only a groove. */
const COLLARBONE_RIDGE_RISE = 0.008;
const COLLARBONE_RIDGE_ALPHA = 0.7;
/** The hollow between the collarbones, at the foot of the throat. */
const SUPRASTERNAL_NOTCH_Y = SHOULDER_Y + 0.004;
const SUPRASTERNAL_NOTCH_RADIUS_X = 0.014;
const SUPRASTERNAL_NOTCH_RADIUS_Y = 0.008;
const SUPRASTERNAL_NOTCH_ALPHA = 0.55;

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
const HIP_SWELL_ALPHA = 0.45;

/**
 * The groin crease running from the hip bone down to the crotch. Deepest at
 * the crotch and faded out at the top, the same way the gluteal fold is — it is
 * a crease that dies away, not a line drawn across her.
 */
const GROIN_CREASE_TOP_X = HIP_HALF_WIDTH * 0.82;
const GROIN_CREASE_TOP_Y = HIP_Y - 0.03;
const GROIN_CREASE_CONTROL_X = HIP_HALF_WIDTH * 0.6;
const GROIN_CREASE_CONTROL_Y = CROTCH_Y - 0.018;
const GROIN_CREASE_BOTTOM_X = HIP_HALF_WIDTH * 0.5;
const GROIN_CREASE_BOTTOM_Y = CROTCH_Y - 0.034;
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
const SEAT_SHADE_ALPHA = 0.4;

/**
 * Each cheek is a mass tipped up and outward, and its light and its shadow both
 * run on that axis. Square to the sprite they stack as concentric ellipses,
 * which puts the terminator on a circle and gives the seat the airbrushed look
 * of two discs rather than two masses.
 */
const GLUTE_AXIS_TILT = -0.42;

/**
 * Lit high and outboard, shaded low and inboard, and the two offset from each
 * other rather than sharing a centre — the diagonal left between them is the
 * cheek turning under toward the fold and in toward the cleft.
 */
const GLUTE_HIGHLIGHT_X = 0.056;
const GLUTE_HIGHLIGHT_Y = HIP_Y + 0.016;
const GLUTE_HIGHLIGHT_RADIUS_X = 0.05;
const GLUTE_HIGHLIGHT_RADIUS_Y = 0.036;
const GLUTE_HIGHLIGHT_ALPHA = 0.72;
const GLUTE_HIGHLIGHT_CORE_FRACTION = 0.3;

const GLUTE_SHADE_X = 0.04;
const GLUTE_SHADE_Y = HIP_Y + 0.056;
const GLUTE_SHADE_RADIUS_X = 0.052;
const GLUTE_SHADE_RADIUS_Y = 0.036;
const GLUTE_SHADE_ALPHA = 0.7;
const GLUTE_SHADE_CORE_FRACTION = 0.4;

/**
 * The hollow over the great trochanter, below the flare of the pelvis and above
 * the widest part of the cheek. It is the landmark that separates a hip from a
 * balloon: without it the outline runs from waist to seat as one unbroken swell
 * and the whole pelvis reads as inflated rather than built on bone.
 */
const TROCHANTER_DIP_X = HIP_HALF_WIDTH * 0.99;
const TROCHANTER_DIP_Y = HIP_Y + 0.004;
const TROCHANTER_DIP_RADIUS_X = 0.019;
const TROCHANTER_DIP_RADIUS_Y = 0.026;
const TROCHANTER_DIP_ALPHA = 0.45;

/**
 * The flat plane of the sacrum above the cleft, between the two dimples. The
 * cheeks do not meet the small of her back directly — this shelf sits between
 * them, and it is the reason the cleft appears to start below the hip line
 * rather than running the whole height of the seat.
 */
const SACRUM_HALF_WIDTH = 0.032;
const SACRUM_TOP_Y = HIP_Y - 0.042;
const SACRUM_ALPHA = 0.45;
const SACRUM_FADE_STOP = 0.45;

const SACRAL_DIMPLE_X = 0.03;
const SACRAL_DIMPLE_Y = HIP_Y - 0.03;
const SACRAL_DIMPLE_RADIUS = 0.009;
const SACRAL_DIMPLE_ALPHA = 0.3;

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
/**
 * Narrower than the bust's undercurve. The crease halo scales off this, and at
 * the undercurve's weight the halo comes out nearly half a cheek wide, which
 * turns the one edge that proves the seat overhangs the thigh into a smear
 * across the bottom of it.
 */
const GLUTE_FOLD_WEIGHT = 0.85;
/**
 * The lit top of the thigh, just under the crease. A shadow alone only says
 * something is dark there; the light immediately below it is what says one form
 * is sitting on top of another.
 */
const GLUTE_UNDERHANG_LIGHT_DROP = 0.014;
const GLUTE_UNDERHANG_LIGHT_ALPHA = 0.5;
const GLUTE_UNDERHANG_LIGHT_WEIGHT = 0.6;

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
 * The gap between her legs is a lens, not a slot. The adductors close it just
 * under the crotch, it opens through the lower thigh, and the knees bring it
 * back in — held at one width from crotch to ankle it reads as a channel milled
 * between two tubes, which is exactly what a constant inner-edge inset gives.
 *
 * Every landmark is expressed against the line between the crotch and the inner
 * knee rather than in absolute x, so the whole shape travels with the walk's hip
 * shift and leg swing instead of tearing away from the leg it belongs to.
 */
const INNER_THIGH_CROTCH_X = 0.011;
const INNER_THIGH_CROTCH_Y = FRONT_HEM_POINT_Y + 0.011;
/** How far the inner edge bows out from that line, and where it peaks. */
const THIGH_GAP_BOW = 0.018;
const THIGH_GAP_WIDEST_Y = CROTCH_Y + (KNEE_Y - CROTCH_Y) * 0.62;
const THIGH_GAP_LOWER_CONTROL_SHARE = 0.25;
const THIGH_GAP_UPPER_CONTROL_SHARE = 0.7;
/** The knee is wider on the inside than the shin below it, which is what brings
 * the two legs back together at the joint and closes the foot of the lens. */
const INNER_KNEE_INSET = 0.008;

const FOOT_HALF_WIDTH = 0.022;
/** Lifts the foot ellipse so its lower edge lands on the floor line. */
const FOOT_CENTER_RISE = 0.012;
/** The foot rolls away toward the toes; the ankle above it stays lit. */
const TOE_SHADE_RADIUS_Y = 0.016;
const TOE_SHADE_ALPHA = 0.5;

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

/**
 * The swinging leg darkens, and only while it is swinging. Keyed to the side
 * instead, one leg is a step darker in every pose including standing still —
 * which also puts a hard value edge along the torso's crotch hem, where the lit
 * pelvis meets a thigh a whole tone below it. It also does real work here: the
 * swing foot passes close to the planted one, and two legs in the same tone
 * merge into a single mass at exactly the moment the stride should read.
 */
const SWING_LEG_SHADE_ALPHA = 0.3;

/**
 * Front view: the pelvis casting onto the top of the inner thigh. The torso is
 * drawn over the legs and both are the same fill, so without a form here the
 * only thing marking the junction is whatever the two happen to have shaded
 * differently — a seam that follows the hem for no reason a viewer can name.
 */
const CROTCH_SHADOW_X = 0.032;
const CROTCH_SHADOW_Y = CROTCH_Y + 0.022;
const CROTCH_SHADOW_RADIUS_X = 0.03;
const CROTCH_SHADOW_RADIUS_Y = 0.032;
const CROTCH_SHADOW_ALPHA = 0.42;

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

/**
 * One phase drives the whole cycle. `stridePhase` is that phase seen from one
 * leg's side, and it is positive exactly while that leg is swinging.
 *
 * Every leg displacement is gated on `Math.max(0, stridePhase)` so the stance
 * leg is completely static and the pelvis travels over it. Driven off the
 * signed phase instead, both legs move on every frame and the planted foot
 * slides sideways under her through the whole step, which no amount of tuning
 * anywhere else can make read as a walk.
 */

/**
 * The knee barely travels while the ankle swings in under her. That difference
 * is what puts the shin on a diagonal, and a diagonal shin is the only thing
 * that reads as a bent knee from head on — moved together, the leg just gets
 * shorter, and a shortened vertical leg reads as a stump rather than a stride.
 */
const WALK_KNEE_SWING = 0.005;
const WALK_ANKLE_SWING = 0.024;
const WALK_FOOT_LIFT = 0.05;
/**
 * The knee barely rises: a real swing leg folds at the knee, so the shin is
 * what shortens. Sharing the lift evenly between the two shortens both and the
 * leg telescopes instead of bending.
 */
const KNEE_LIFT_SHARE = 0.15;
const WALK_BODY_BOB = 0.017;
/**
 * The whole figure is translated up by the bob, feet included, so a foot on the
 * floor has to have it taken back off or she bounces clear of the ground on
 * every step. The knee follows part way, because the leg is what extends.
 */
const KNEE_BOB_FOLLOW_SHARE = 0.5;

/**
 * The pelvis tilts and swings under a level shoulder line, which is the shape
 * of a real walk seen head on — the hip on the swinging side drops, and the
 * pelvis travels over the foot that is carrying her.
 *
 * That is why the torso pivots at the *shoulder*. Pivoting at the hip instead
 * swings her shoulders and head through the widest arc in the frame and leaves
 * the pelvis still, which reads as a metronome rather than as walking.
 */
const WALK_PELVIS_TILT = 0.085;
const TORSO_PIVOT_Y = SHOULDER_Y;
/** A little weight transfer on top of what the pelvis swing already gives. */
const WALK_HIP_SHIFT = 0.005;
/**
 * The pelvis belongs to the torso, so the thighs have to travel with it or her
 * hips visibly unseat from her legs. The knee follows partway and the ankle not
 * at all, since that foot is planted.
 */
const KNEE_HIP_FOLLOW_SHARE = 0.45;
/** How much of the pelvis swing her neck cancels to keep her head level. */
const HEAD_LEVELLING_SHARE = 0.85;
const WALK_HAIR_SWAY = 0.03;
/**
 * Seen head on an arm swings toward and away from the viewer, not out to the
 * side. Nearly all of that is foreshortening — the arm shortens at both ends of
 * its swing and is longest hanging straight down at the passing position — and
 * only a little of it is lateral. Swung wide in the picture plane instead, she
 * flaps.
 */
const WALK_ARM_SWING = 0.2;
const ARM_FORESHORTEN = 0.15;

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
const ABDOMEN_LINE_RISE = 0.028;
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
const PELVIS_SWING_REACH = Math.abs(Math.sin(WALK_PELVIS_TILT) * (HIP_Y - TORSO_PIVOT_Y));

export const SIGNET_HALF_WIDTH =
  (SHOULDER_HALF_WIDTH * ARM_ROOT_X_FRACTION +
    UPPER_ARM_LENGTH +
    FOREARM_LENGTH +
    HAND_RADIUS +
    NAIL_LENGTH +
    WALK_HIP_SHIFT +
    PELVIS_SWING_REACH) *
  FIGURE_SCALE;

/* ── Level of detail ───────────────────────────────────────────────────── */

/**
 * Her fine passes are drawn only where they resolve.
 *
 * She is two tiles tall, which on a 32-pixel tile at the performance render
 * scale is sixty-four device pixels for a whole woman. Her tattoos are line
 * work a fiftieth of a tile wide and her scales are a cell a fortieth across:
 * at that size neither resolves into a mark, they average into grey blotches
 * that read as dirt or damage, and — worse — they sit on top of the shading and
 * destroy the forms underneath. Muting them is not a saving, it is the
 * difference between a figure and a smudge.
 *
 * Measured in *device* pixels, so the same rule answers correctly for the two
 * render-quality presets without knowing either exists: at the sharp scale she
 * is twice the pixels and gets her ink back.
 */
const INK_MIN_FIGURE_HEIGHT_PX = 100;
/** The scale cells and the ripple are finer still, and go one rung later. */
const SKIN_TEXTURE_MIN_FIGURE_HEIGHT_PX = 140;

interface SignetDetail {
  readonly ink: boolean;
  readonly skinTexture: boolean;
}

/**
 * Her drawn height in device pixels. Read off the destination transform rather
 * than from the render-quality setting, so a review harness, an offscreen
 * composite and the game canvas are all answered by the same call.
 */
function figureHeightPx(ctx: CanvasRenderingContext2D, tileSizePx: number): number {
  const transform = ctx.getTransform();
  const verticalScale = Math.abs(transform.d);
  const isPlainScale = transform.b === 0 && transform.c === 0 && verticalScale > 0;
  return tileSizePx * FIGURE_SCALE * (isPlainScale ? verticalScale : 1);
}

function resolveDetail(heightPx: number): SignetDetail {
  return {
    ink: heightPx >= INK_MIN_FIGURE_HEIGHT_PX,
    skinTexture: heightPx >= SKIN_TEXTURE_MIN_FIGURE_HEIGHT_PX,
  };
}

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

/**
 * Above the fill tone, so a lit form has somewhere to go. The torso is filled
 * `SKIN_LIT`, which means every highlight on her can only ever restore what a
 * wash took away — a breast washed down and lit back to the fill is a dark
 * patch with a pale middle, never a volume standing off the ribs.
 */
const SKIN_HIGHLIGHT = '#ffffff';
const SKIN_HIGHLIGHT_FADE = 'rgba(255,255,255,0)';
const SKIN_LIT = '#f2f6ff';
const SKIN_BASE = '#dae5f8';
const SKIN_SHADE = '#b3c3e0';
const SKIN_DEEP_SHADE = '#92a6cb';
/** The deepest tone on her, for creases that have to actually read as deep. */
const SKIN_CREASE = '#7086b2';
/**
 * One step below the deepest skin tone, for the two creases that have to carry
 * a form on their own — the underbust and the cleavage. Her skin is so pale
 * that a crease in `SKIN_CREASE` still sits in the top third of the range.
 */
const SKIN_DEEP_CREASE = '#4e6291';
const SKIN_DEEP_CREASE_FADE = 'rgba(78,98,145,0)';
/** Fully transparent twins of the tones above; must track them by hand. */
const SKIN_LIT_FADE = 'rgba(242,246,255,0)';
const SKIN_SHADE_FADE = 'rgba(179,195,224,0)';
const SKIN_CREASE_FADE = 'rgba(112,134,178,0)';
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
  lod: SignetDetail,
  motif: TattooMotif,
  timeSec: number,
  placement: TattooPlacement,
): void {
  if (!lod.ink) return;
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
 *
 * `rotation` matters wherever a form does not run square to the sprite. Stacked
 * axis-aligned ellipses put the boundary between light and shadow on a circle,
 * which is the whole reason airbrushed shading reads as painted on: a real
 * terminator is a line that follows the anatomy underneath it.
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
  rotation = 0,
  coreFraction: number = SOFT_SHADE_CORE_FRACTION,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.scale(radiusX, radiusY);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, color);
  shade.addColorStop(coreFraction, color);
  shade.addColorStop(1, fadeColor);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Canvas has no cheap blur, so a crease is built from strokes of decreasing
 * width and rising opacity: a wide faint halo of shadow around a narrow dark
 * core. A single stroke of even width reads as ink on the skin however dark it
 * is, because a real crease has no edge.
 *
 * The count matters as much as the range. Three layers spanning 3.4× in width
 * is a visible step between each pair, and on a wide crease in a strong colour
 * that stack stops reading as one soft shadow and starts reading as concentric
 * bands — nested arcs under the bust and ripples across the seat.
 */
const CREASE_LAYERS = [
  { widthScale: 4, alpha: 0.045 },
  { widthScale: 3.5, alpha: 0.05 },
  { widthScale: 3, alpha: 0.06 },
  { widthScale: 2.6, alpha: 0.07 },
  { widthScale: 2.2, alpha: 0.085 },
  { widthScale: 1.8, alpha: 0.1 },
  { widthScale: 1.5, alpha: 0.13 },
  { widthScale: 1.2, alpha: 0.18 },
  { widthScale: 1, alpha: 0.42 },
] as const;

function strokeSoftCrease(
  ctx: CanvasRenderingContext2D,
  baseWidth: number,
  stroke: string | CanvasGradient,
  tracePath: () => void,
  opacity = 1,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'round';
  for (const layer of CREASE_LAYERS) {
    ctx.globalAlpha = layer.alpha * opacity;
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

/**
 * One side of the chest, from the shoulder down to the waist: armpit tuck,
 * breast swell, ribcage tuck. `side` is -1 tracing down the left, +1 tracing up
 * the right, so the two calls are mirror images of the same three segments.
 */
function pathChestSide(
  ctx: CanvasRenderingContext2D,
  side: BodySide,
  chestHalfWidth: number,
): void {
  const armpitDrop = 0.01;
  const bustEntryDrop = 0.022;
  const bustExitDrop = 0.03;
  const ribApproachRise = 0.01;

  if (side < 0) {
    ctx.quadraticCurveTo(-SHOULDER_HALF_WIDTH, ARMPIT_Y - armpitDrop, -ARMPIT_HALF_WIDTH, ARMPIT_Y);
    ctx.bezierCurveTo(
      -chestHalfWidth,
      ARMPIT_Y + bustEntryDrop,
      -chestHalfWidth,
      BUST_WIDEST_Y - bustEntryDrop,
      -chestHalfWidth,
      BUST_WIDEST_Y,
    );
    ctx.bezierCurveTo(
      -chestHalfWidth,
      BUST_WIDEST_Y + bustExitDrop,
      -RIBCAGE_HALF_WIDTH - 0.008,
      RIBCAGE_Y - ribApproachRise,
      -RIBCAGE_HALF_WIDTH,
      RIBCAGE_Y,
    );
    ctx.quadraticCurveTo(-WAIST_HALF_WIDTH - 0.008, WAIST_Y - 0.03, -WAIST_HALF_WIDTH, WAIST_Y);
    return;
  }

  ctx.quadraticCurveTo(WAIST_HALF_WIDTH + 0.008, WAIST_Y - 0.03, RIBCAGE_HALF_WIDTH, RIBCAGE_Y);
  ctx.bezierCurveTo(
    RIBCAGE_HALF_WIDTH + 0.008,
    RIBCAGE_Y - ribApproachRise,
    chestHalfWidth,
    BUST_WIDEST_Y + bustExitDrop,
    chestHalfWidth,
    BUST_WIDEST_Y,
  );
  ctx.bezierCurveTo(
    chestHalfWidth,
    BUST_WIDEST_Y - bustEntryDrop,
    chestHalfWidth,
    ARMPIT_Y + bustEntryDrop,
    ARMPIT_HALF_WIDTH,
    ARMPIT_Y,
  );
  ctx.quadraticCurveTo(SHOULDER_HALF_WIDTH, ARMPIT_Y - armpitDrop, SHOULDER_HALF_WIDTH, SHOULDER_Y);
}

function pathTorso(ctx: CanvasRenderingContext2D, facingAway: boolean): void {
  const chestHalfWidth = facingAway ? BACK_CHEST_HALF_WIDTH : BUST_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-SHOULDER_HALF_WIDTH, SHOULDER_Y);
  pathChestSide(ctx, -1, chestHalfWidth);
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
  pathChestSide(ctx, 1, chestHalfWidth);
  ctx.quadraticCurveTo(NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.lineTo(-NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.quadraticCurveTo(-NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, -SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.closePath();
}

interface LegJoints {
  hipX: number;
  hipY: number;
  kneeX: number;
  kneeY: number;
  ankleX: number;
  ankleY: number;
}

/**
 * One leg's joint positions for the current step. Shared by the silhouette and
 * by the shading drawn on top of it, so the two can never drift apart.
 */
function legJoints(
  side: BodySide,
  stridePhase: number,
  hipShift: number,
  hipDrop: number,
  bob: number,
): LegJoints {
  const swing = Math.max(0, stridePhase);
  const lift = swing * WALK_FOOT_LIFT;
  /** Cancels the body bob for as long as this foot is carrying her. */
  const plant = (1 - swing) * bob;

  return {
    hipX: side * LEG_HIP_X + hipShift,
    hipY: LEG_TOP_Y + hipDrop,
    kneeX: side * (LEG_KNEE_X - swing * WALK_KNEE_SWING) + hipShift * KNEE_HIP_FOLLOW_SHARE,
    kneeY: KNEE_Y - lift * KNEE_LIFT_SHARE + plant * KNEE_BOB_FOLLOW_SHARE,
    ankleX: side * (LEG_ANKLE_X - swing * WALK_ANKLE_SWING),
    ankleY: ANKLE_Y - lift + plant,
  };
}

function pathLeg(ctx: CanvasRenderingContext2D, side: BodySide, joints: LegJoints): void {
  const { hipX, hipY, kneeX, kneeY, ankleX, ankleY } = joints;
  const thighMidY = (hipY + kneeY) / 2;
  const calfMidY = (kneeY + ankleY) / 2;

  ctx.beginPath();
  ctx.moveTo(hipX + side * THIGH_HALF_WIDTH, hipY);
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
  const pelvisCenterX = hipX - side * LEG_HIP_X;
  const innerCrotchX = pelvisCenterX + side * INNER_THIGH_CROTCH_X;
  const innerKneeX = kneeX - side * (KNEE_HALF_WIDTH + INNER_KNEE_INSET);
  const thighSpan = kneeY - INNER_THIGH_CROTCH_Y;
  const widestShare = (THIGH_GAP_WIDEST_Y - INNER_THIGH_CROTCH_Y) / thighSpan;
  const widestX = innerCrotchX + (innerKneeX - innerCrotchX) * widestShare + side * THIGH_GAP_BOW;

  ctx.quadraticCurveTo(
    kneeX - side * (KNEE_HALF_WIDTH + CALF_BULGE * 0.3),
    calfMidY,
    innerKneeX,
    kneeY,
  );
  ctx.bezierCurveTo(
    widestX,
    kneeY - thighSpan * THIGH_GAP_LOWER_CONTROL_SHARE,
    widestX,
    kneeY - thighSpan * THIGH_GAP_UPPER_CONTROL_SHARE,
    innerCrotchX,
    INNER_THIGH_CROTCH_Y,
  );
  ctx.lineTo(pelvisCenterX, hipY);
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
  pelvisTiltSin: number,
  bob: number,
  facingAway: boolean,
  castGlow: number,
  tileSizePx: number,
  detail: SignetDetail,
): void {
  const SCALE_PATCH_INSET = 0.01;
  const SCALE_PATCH_WIDTH = 0.11;

  for (const side of SIDES) {
    const stridePhase = swingPhase * side;
    // The pelvis drops on the swinging side, so that leg's root rides down with
    // it — the tilt of the two hips against each other is most of what a walk
    // looks like from the front.
    const hipDrop = side * pelvisTiltSin * LEG_HIP_X;
    const joints = legJoints(side, stridePhase, hipShift, hipDrop, bob);

    ctx.save();

    // Hung off the ankle joint rather than off `FOOT_Y`, so it takes the bob
    // compensation that keeps a planted foot on the floor. Positioned from the
    // constants instead, the foot rides the body's bob while the ankle above it
    // stays down, and the two come apart every step.
    const footHalfHeight = FOOT_Y - ANKLE_Y;
    const footSoleY = joints.ankleY + footHalfHeight;
    ctx.fillStyle = SKIN_LIT;
    ctx.beginPath();
    ctx.ellipse(
      joints.ankleX,
      footSoleY - FOOT_CENTER_RISE,
      FOOT_HALF_WIDTH,
      footHalfHeight,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    fillSoftEllipse(
      ctx,
      joints.ankleX,
      footSoleY,
      FOOT_HALF_WIDTH,
      TOE_SHADE_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      TOE_SHADE_ALPHA,
    );

    pathLeg(ctx, side, joints);
    ctx.fillStyle = SKIN_LIT;
    ctx.fill();

    ctx.save();
    pathLeg(ctx, side, joints);
    ctx.clip();

    if (stridePhase > 0) {
      ctx.save();
      ctx.globalAlpha = SWING_LEG_SHADE_ALPHA * Math.min(1, stridePhase);
      ctx.fillStyle = SKIN_SHADE;
      pathLeg(ctx, side, joints);
      ctx.fill();
      ctx.restore();
    }

    const scalePatchLeft = side > 0 ? SCALE_PATCH_INSET : -SCALE_PATCH_INSET - SCALE_PATCH_WIDTH;
    if (detail.skinTexture) {
      drawScalePatch(ctx, scalePatchLeft, LEG_TOP_Y, SCALE_PATCH_WIDTH, KNEE_Y - LEG_TOP_Y);
    }

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

    fillSoftEllipse(
      ctx,
      side * CROTCH_SHADOW_X + hipShift,
      CROTCH_SHADOW_Y,
      CROTCH_SHADOW_RADIUS_X,
      CROTCH_SHADOW_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      CROTCH_SHADOW_ALPHA,
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
      stampTattoo(ctx, detail, drawThreeHeadedOgreMotif, timeSec, {
        x: joints.hipX,
        y: THIGH_TATTOO_Y,
        size: 0.085,
        phase: 1.1,
      });
      stampTattoo(ctx, detail, drawEelLightningMotif, timeSec, {
        x: joints.kneeX,
        y: KNEE_TATTOO_Y,
        size: 0.07,
        phase: 3.7,
        detail: true,
      });
    } else {
      stampTattoo(ctx, detail, drawHammerheadSharkMotif, timeSec, {
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

/**
 * The band rides the hip crest. Slung under it the whole garment hangs off the
 * front of the pelvis with nothing holding it, which is what makes a low band
 * read as pasted on rather than worn.
 */
const THONG_STRAP_Y = HIP_Y - 0.022;
const THONG_STRAP_HEIGHT = 0.013;
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
const THONG_WAISTBAND_FRONT_SAG = 0.026;
const THONG_WAISTBAND_BACK_SAG = 0.011;
/**
 * Fraction of its height the band still shows at her sides. It is a ring seen
 * head on, so it turns away from the viewer toward both ends and has to
 * foreshorten there; held at full height to the ends it stays a bar laid across
 * her however far it is curved.
 */
const THONG_BAND_EDGE_HEIGHT_FRACTION = 0.16;
/** The band edges are parabolas, but the panel hangs off one of them and any
 * curve fitted to the other opens a seam along the join, so both are walked. */
const BAND_EDGE_SAMPLES = 24;

/**
 * The front panel is a high-cut V. Narrow at the band it is a triangle taped to
 * her; wide with its sides bowing *outward* it becomes a loincloth. It is wide
 * across the top and cut away hard at the legs.
 */
const THONG_PANEL_HALF_WIDTH = HIP_HALF_WIDTH * 0.74;
/** Stops above the crotch, or its point runs on into the gap between her legs
 * and panel and gap read as one long dark wedge. */
const THONG_PANEL_BOTTOM_Y = CROTCH_Y - 0.019;
/** A point has no fabric in it; the gusset keeps a width all the way down. */
const THONG_PANEL_BOTTOM_HALF_WIDTH = 0.013;
const THONG_PANEL_BOTTOM_DIP = 0.005;
/**
 * The leg opening as a cubic between the band corner and the gusset, its
 * controls pulled in from the straight line between them. That inward bow is
 * the whole difference between a cut garment and a flat triangle.
 */
const THONG_LEG_OPENING_UPPER_WIDTH_FRACTION = 0.6;
const THONG_LEG_OPENING_UPPER_DROP_FRACTION = 0.3;
const THONG_LEG_OPENING_LOWER_WIDTH_FRACTION = 0.16;
const THONG_LEG_OPENING_LOWER_DROP_FRACTION = 0.68;

/** Narrow enough that the cleft shadow still shows on either side of it. */
const THONG_STRING_HALF_WIDTH = GLUTE_CLEFT_HALF_WIDTH * 0.38;
/**
 * It ends where the cleft is deepest, which is where the cheeks close over it —
 * run all the way down, it is a hard straight spike ruled down her instead.
 */
const THONG_STRING_BOTTOM_Y = GLUTE_CLEFT_WIDEST_Y + 0.008;

/** Centre of the band at `x`: a parabola sagging to `sag` at the middle. */
function bandCenterY(x: number, sag: number): number {
  const acrossBand = x / THONG_STRAP_HALF_SPAN;
  return THONG_STRAP_Y + sag * (1 - acrossBand * acrossBand);
}

/** Half the band's visible height at `x`, foreshortened toward her sides. */
function bandHalfHeight(x: number): number {
  const acrossBand = x / THONG_STRAP_HALF_SPAN;
  const facing =
    THONG_BAND_EDGE_HEIGHT_FRACTION +
    (1 - THONG_BAND_EDGE_HEIGHT_FRACTION) * (1 - acrossBand * acrossBand);
  return (THONG_STRAP_HEIGHT / 2) * facing;
}

function bandTopEdgeY(x: number, sag: number): number {
  return bandCenterY(x, sag) - bandHalfHeight(x);
}

function bandBottomEdgeY(x: number, sag: number): number {
  return bandCenterY(x, sag) + bandHalfHeight(x);
}

function traceBandEdge(
  ctx: CanvasRenderingContext2D,
  edgeY: (x: number, sag: number) => number,
  fromX: number,
  toX: number,
  sag: number,
  moveToStart: boolean,
): void {
  for (let i = 0; i <= BAND_EDGE_SAMPLES; i++) {
    const x = fromX + ((toX - fromX) * i) / BAND_EDGE_SAMPLES;
    const y = edgeY(x, sag);
    if (i === 0 && moveToStart) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
}

function drawWaistband(ctx: CanvasRenderingContext2D, sag: number): void {
  ctx.fillStyle = THONG_COLOR;
  ctx.beginPath();
  traceBandEdge(ctx, bandTopEdgeY, -THONG_STRAP_HALF_SPAN, THONG_STRAP_HALF_SPAN, sag, true);
  traceBandEdge(ctx, bandBottomEdgeY, THONG_STRAP_HALF_SPAN, -THONG_STRAP_HALF_SPAN, sag, false);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = THONG_TRIM;
  ctx.lineWidth = HAIRLINE_WIDTH;
  ctx.beginPath();
  traceBandEdge(ctx, bandTopEdgeY, -THONG_STRAP_HALF_SPAN, THONG_STRAP_HALF_SPAN, sag, true);
  ctx.stroke();
}

/**
 * One leg opening, from the band corner down to the gusset. Traced downward on
 * the right of the panel and upward on the left, so both sides are the same
 * curve.
 */
function pathLegOpening(ctx: CanvasRenderingContext2D, side: BodySide, sag: number): void {
  const cornerY = bandTopEdgeY(side * THONG_PANEL_HALF_WIDTH, sag);
  const drop = THONG_PANEL_BOTTOM_Y - cornerY;
  const spread = THONG_PANEL_HALF_WIDTH - THONG_PANEL_BOTTOM_HALF_WIDTH;

  const upperX =
    side * (THONG_PANEL_BOTTOM_HALF_WIDTH + spread * THONG_LEG_OPENING_UPPER_WIDTH_FRACTION);
  const lowerX =
    side * (THONG_PANEL_BOTTOM_HALF_WIDTH + spread * THONG_LEG_OPENING_LOWER_WIDTH_FRACTION);
  const upperY = cornerY + drop * THONG_LEG_OPENING_UPPER_DROP_FRACTION;
  const lowerY = cornerY + drop * THONG_LEG_OPENING_LOWER_DROP_FRACTION;

  if (side > 0) {
    ctx.bezierCurveTo(
      upperX,
      upperY,
      lowerX,
      lowerY,
      THONG_PANEL_BOTTOM_HALF_WIDTH,
      THONG_PANEL_BOTTOM_Y,
    );
    return;
  }
  ctx.bezierCurveTo(lowerX, lowerY, upperX, upperY, -THONG_PANEL_HALF_WIDTH, cornerY);
}

function pathFrontPanel(ctx: CanvasRenderingContext2D, sag: number): void {
  ctx.beginPath();
  traceBandEdge(ctx, bandTopEdgeY, -THONG_PANEL_HALF_WIDTH, THONG_PANEL_HALF_WIDTH, sag, true);
  pathLegOpening(ctx, 1, sag);
  ctx.quadraticCurveTo(
    0,
    THONG_PANEL_BOTTOM_Y + THONG_PANEL_BOTTOM_DIP,
    -THONG_PANEL_BOTTOM_HALF_WIDTH,
    THONG_PANEL_BOTTOM_Y,
  );
  pathLegOpening(ctx, -1, sag);
  ctx.closePath();
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
    const stringTopY = bandBottomEdgeY(0, sag);
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
    // Hung from the band's top edge rather than butted against its lower one,
    // so the band covers the join exactly and no seam can open along it.
    pathFrontPanel(ctx, sag);
    ctx.fill();

    ctx.strokeStyle = THONG_TRIM;
    ctx.lineWidth = HAIRLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(THONG_PANEL_HALF_WIDTH, bandTopEdgeY(THONG_PANEL_HALF_WIDTH, sag));
    pathLegOpening(ctx, 1, sag);
    ctx.quadraticCurveTo(
      0,
      THONG_PANEL_BOTTOM_Y + THONG_PANEL_BOTTOM_DIP,
      -THONG_PANEL_BOTTOM_HALF_WIDTH,
      THONG_PANEL_BOTTOM_Y,
    );
    pathLegOpening(ctx, -1, sag);
    ctx.stroke();
  }

  drawWaistband(ctx, sag);
  ctx.restore();
}

function drawSacrum(ctx: CanvasRenderingContext2D): void {
  const plane = ctx.createLinearGradient(0, SACRUM_TOP_Y, 0, GLUTE_CLEFT_TOP_Y);
  plane.addColorStop(0, SKIN_SHADE_FADE);
  plane.addColorStop(SACRUM_FADE_STOP, SKIN_SHADE);
  plane.addColorStop(1, SKIN_SHADE);

  ctx.save();
  ctx.globalAlpha = SACRUM_ALPHA;
  ctx.fillStyle = plane;
  ctx.beginPath();
  ctx.moveTo(-SACRUM_HALF_WIDTH, SACRUM_TOP_Y);
  ctx.quadraticCurveTo(0, SACRUM_TOP_Y - SACRUM_HALF_WIDTH * 0.2, SACRUM_HALF_WIDTH, SACRUM_TOP_Y);
  ctx.quadraticCurveTo(SACRUM_HALF_WIDTH * 0.5, GLUTE_CLEFT_TOP_Y, 0, GLUTE_CLEFT_TOP_Y);
  ctx.quadraticCurveTo(
    -SACRUM_HALF_WIDTH * 0.5,
    GLUTE_CLEFT_TOP_Y,
    -SACRUM_HALF_WIDTH,
    SACRUM_TOP_Y,
  );
  ctx.closePath();
  ctx.fill();
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
    const tilt = side * GLUTE_AXIS_TILT;

    fillSoftEllipse(
      ctx,
      side * GLUTE_SHADE_X,
      GLUTE_SHADE_Y,
      GLUTE_SHADE_RADIUS_X,
      GLUTE_SHADE_RADIUS_Y,
      SKIN_DEEP_SHADE,
      SKIN_SHADE_FADE,
      GLUTE_SHADE_ALPHA,
      tilt,
      GLUTE_SHADE_CORE_FRACTION,
    );
    fillSoftEllipse(
      ctx,
      side * GLUTE_HIGHLIGHT_X,
      GLUTE_HIGHLIGHT_Y,
      GLUTE_HIGHLIGHT_RADIUS_X,
      GLUTE_HIGHLIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      SKIN_HIGHLIGHT_FADE,
      GLUTE_HIGHLIGHT_ALPHA,
      tilt,
      GLUTE_HIGHLIGHT_CORE_FRACTION,
    );
    fillSoftEllipse(
      ctx,
      side * TROCHANTER_DIP_X,
      TROCHANTER_DIP_Y,
      TROCHANTER_DIP_RADIUS_X,
      TROCHANTER_DIP_RADIUS_Y,
      SKIN_SHADE,
      SKIN_SHADE_FADE,
      TROCHANTER_DIP_ALPHA,
    );
  }

  drawSacrum(ctx);

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * SACRAL_DIMPLE_X,
      SACRAL_DIMPLE_Y,
      SACRAL_DIMPLE_RADIUS,
      SACRAL_DIMPLE_RADIUS,
      SKIN_CREASE,
      SKIN_CREASE_FADE,
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

  ctx.fillStyle = SKIN_DEEP_CREASE;
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
    const traceFold = (drop: number): void => {
      ctx.moveTo(outerX, GLUTE_FOLD_OUTER_Y + drop);
      ctx.bezierCurveTo(
        side * GLUTE_FOLD_OUTER_CONTROL_X,
        GLUTE_FOLD_OUTER_CONTROL_Y + drop,
        side * GLUTE_FOLD_INNER_CONTROL_X,
        GLUTE_FOLD_INNER_CONTROL_Y + drop,
        0,
        GLUTE_FOLD_JUNCTION_Y + drop,
      );
    };

    const crease = ctx.createLinearGradient(outerX, GLUTE_FOLD_OUTER_Y, 0, GLUTE_FOLD_JUNCTION_Y);
    crease.addColorStop(0, SKIN_DEEP_CREASE_FADE);
    crease.addColorStop(GLUTE_FOLD_FADE_STOP, SKIN_DEEP_CREASE);
    crease.addColorStop(1, SKIN_DEEP_CREASE);

    strokeSoftCrease(ctx, BUST_UNDERCURVE_LINE_WIDTH * GLUTE_FOLD_WEIGHT, crease, () =>
      traceFold(0),
    );

    const bounce = ctx.createLinearGradient(outerX, GLUTE_FOLD_OUTER_Y, 0, GLUTE_FOLD_JUNCTION_Y);
    bounce.addColorStop(0, SKIN_HIGHLIGHT_FADE);
    bounce.addColorStop(GLUTE_FOLD_FADE_STOP, SKIN_HIGHLIGHT);
    bounce.addColorStop(1, SKIN_HIGHLIGHT);
    strokeSoftCrease(
      ctx,
      BUST_UNDERCURVE_LINE_WIDTH * GLUTE_UNDERHANG_LIGHT_WEIGHT,
      bounce,
      () => traceFold(GLUTE_UNDERHANG_LIGHT_DROP),
      GLUTE_UNDERHANG_LIGHT_ALPHA,
    );
  }
}

function drawCollarbones(ctx: CanvasRenderingContext2D): void {
  fillSoftEllipse(
    ctx,
    0,
    SUPRASTERNAL_NOTCH_Y,
    SUPRASTERNAL_NOTCH_RADIUS_X,
    SUPRASTERNAL_NOTCH_RADIUS_Y,
    SKIN_CREASE,
    SKIN_CREASE_FADE,
    SUPRASTERNAL_NOTCH_ALPHA,
  );

  for (const side of SIDES) {
    const innerX = side * COLLARBONE_INNER_X;
    const outerX = side * COLLARBONE_OUTER_X;
    const midX = (side * (COLLARBONE_INNER_X + COLLARBONE_OUTER_X)) / 2;

    fillSoftEllipse(
      ctx,
      midX,
      COLLARBONE_Y + COLLARBONE_DIP / 2 - COLLARBONE_RIDGE_RISE,
      (COLLARBONE_OUTER_X - COLLARBONE_INNER_X) / 2,
      COLLARBONE_RIDGE_RISE,
      SKIN_HIGHLIGHT,
      SKIN_HIGHLIGHT_FADE,
      COLLARBONE_RIDGE_ALPHA,
    );

    const bone = ctx.createLinearGradient(innerX, COLLARBONE_Y, outerX, COLLARBONE_Y);
    bone.addColorStop(0, SKIN_CREASE_FADE);
    bone.addColorStop(COLLARBONE_FADE_STOP, SKIN_CREASE);
    bone.addColorStop(1, SKIN_CREASE_FADE);

    strokeSoftCrease(ctx, FINE_LINE_WIDTH, bone, () => {
      ctx.moveTo(innerX, COLLARBONE_Y);
      ctx.quadraticCurveTo(midX, COLLARBONE_Y + COLLARBONE_DIP, outerX, COLLARBONE_Y);
    });
  }
}

/**
 * A wedge, not an ellipse: the two breasts close on each other going down, so
 * the valley is narrowest and deepest at the bottom and opens out to nothing at
 * the collarbones. A symmetric blob with a stroke down the middle of it is the
 * shape that reads as a line ruled on her.
 */
function drawCleavage(ctx: CanvasRenderingContext2D): void {
  const valley = ctx.createLinearGradient(0, CLEAVAGE_TOP_Y, 0, CLEAVAGE_BOTTOM_Y);
  valley.addColorStop(0, SKIN_DEEP_CREASE_FADE);
  valley.addColorStop(CLEAVAGE_FADE_STOP, SKIN_CREASE);
  valley.addColorStop(1, SKIN_DEEP_CREASE);

  ctx.save();
  ctx.globalAlpha = CLEAVAGE_ALPHA;
  ctx.fillStyle = valley;
  ctx.beginPath();
  for (const side of SIDES) {
    ctx.moveTo(0, CLEAVAGE_BOTTOM_Y);
    ctx.quadraticCurveTo(
      side * CLEAVAGE_BOTTOM_HALF_WIDTH,
      (CLEAVAGE_TOP_Y + CLEAVAGE_BOTTOM_Y) / 2,
      side * CLEAVAGE_TOP_HALF_WIDTH,
      CLEAVAGE_TOP_Y,
    );
    ctx.quadraticCurveTo(side * CLEAVAGE_TOP_HALF_WIDTH * 0.3, CLEAVAGE_TOP_Y, 0, CLEAVAGE_TOP_Y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function drawBust(ctx: CanvasRenderingContext2D): void {
  drawCollarbones(ctx);

  fillSoftEllipse(
    ctx,
    0,
    UPPER_CHEST_SHADE_Y,
    UPPER_CHEST_SHADE_RADIUS_X,
    UPPER_CHEST_SHADE_RADIUS_Y,
    SKIN_SHADE,
    SKIN_SHADE_FADE,
    UPPER_CHEST_SHADE_ALPHA,
  );

  for (const side of SIDES) {
    const tilt = side * BUST_AXIS_TILT;

    fillSoftEllipse(
      ctx,
      side * BUST_SHADE_X,
      BUST_SHADE_Y,
      BUST_SHADE_RADIUS_X,
      BUST_SHADE_RADIUS_Y,
      SKIN_DEEP_SHADE,
      SKIN_SHADE_FADE,
      BUST_SHADE_ALPHA,
      tilt,
      BUST_SHADE_CORE_FRACTION,
    );
    fillSoftEllipse(
      ctx,
      side * BUST_HIGHLIGHT_X,
      BUST_HIGHLIGHT_Y,
      BUST_HIGHLIGHT_RADIUS_X,
      BUST_HIGHLIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      SKIN_HIGHLIGHT_FADE,
      BUST_HIGHLIGHT_ALPHA,
      tilt,
      BUST_HIGHLIGHT_CORE_FRACTION,
    );
    fillSoftEllipse(
      ctx,
      side * UNDERBUST_SHADOW_X,
      UNDERBUST_SHADOW_Y,
      UNDERBUST_SHADOW_RADIUS_X,
      UNDERBUST_SHADOW_RADIUS_Y,
      SKIN_DEEP_CREASE,
      SKIN_DEEP_CREASE_FADE,
      UNDERBUST_SHADOW_ALPHA,
      tilt,
    );
  }

  drawCleavage(ctx);

  for (const side of SIDES) {
    const centerX = side * BUST_POINT_X;
    const arcStartX = centerX + BUST_UNDERCURVE_RADIUS * Math.cos(BUST_UNDERCURVE_ARC_START);
    const arcStartY = BUST_POINT_Y + BUST_UNDERCURVE_RADIUS * Math.sin(BUST_UNDERCURVE_ARC_START);
    const arcEndX = centerX + BUST_UNDERCURVE_RADIUS * Math.cos(BUST_UNDERCURVE_ARC_END);
    const arcEndY = BUST_POINT_Y + BUST_UNDERCURVE_RADIUS * Math.sin(BUST_UNDERCURVE_ARC_END);

    const crease = ctx.createLinearGradient(arcStartX, arcStartY, arcEndX, arcEndY);
    crease.addColorStop(0, SKIN_DEEP_CREASE_FADE);
    crease.addColorStop(BUST_UNDERCURVE_FADE_IN, SKIN_DEEP_CREASE);
    crease.addColorStop(BUST_UNDERCURVE_FADE_OUT, SKIN_DEEP_CREASE);
    crease.addColorStop(1, SKIN_DEEP_CREASE_FADE);

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

    // An even stroke here runs parallel to the leg opening just outside it and
    // reads as a second garment edge rather than as a fold in her.
    strokeSoftCrease(ctx, FINE_LINE_WIDTH, crease, () => {
      ctx.moveTo(topX, GROIN_CREASE_TOP_Y);
      ctx.quadraticCurveTo(
        side * GROIN_CREASE_CONTROL_X,
        GROIN_CREASE_CONTROL_Y,
        bottomX,
        GROIN_CREASE_BOTTOM_Y,
      );
    });
  }
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  castGlow: number,
  tileSizePx: number,
  detail: SignetDetail,
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

  // Her scales and the ripple that travels over them both stop at the hip from
  // behind. Run down over the seat they lay a band of hard little arcs across
  // the one form on her that is carried entirely by soft value, and the cheeks
  // read as rippled rather than round.
  const texturedBottomY = facingAway ? HIP_Y : CROTCH_Y;
  if (detail.skinTexture) {
    drawScalePatch(
      ctx,
      -HIP_HALF_WIDTH * 0.7,
      WAIST_Y + 0.04,
      HIP_HALF_WIDTH * 1.4,
      texturedBottomY - WAIST_Y - 0.04,
    );
  }

  applyInkStyle(ctx, castGlow, tileSizePx);
  if (facingAway) {
    // The book's shoulder-blade fish — see BACK_FISH_Y for why it sits a little
    // below the blades themselves.
    stampTattoo(ctx, detail, drawSmallFishMotif, timeSec, {
      x: -BACK_FISH_X,
      y: BACK_FISH_Y,
      size: 0.05,
      phase: 5.2,
      detail: true,
    });
    stampTattoo(ctx, detail, drawDragonMotif, timeSec, {
      x: 0.004,
      y: WAIST_Y + 0.05,
      size: 0.115,
      phase: 1.9,
    });
  } else {
    stampTattoo(ctx, detail, drawOctopusMotif, timeSec, {
      x: 0.004,
      y: WAIST_Y + 0.045,
      size: 0.115,
      phase: 1.9,
    });
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  if (detail.skinTexture) drawSkinRipple(ctx, timeSec, SHOULDER_Y, texturedBottomY);
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
  reach: number,
): { x: number; y: number } {
  const shoulderRotation = -side * shoulderAngle;
  const elbowRotation = shoulderRotation - side * elbowAngle;
  const elbowX = armRootX(side) - UPPER_ARM_LENGTH * reach * Math.sin(shoulderRotation);
  const elbowY = ARM_ROOT_Y + UPPER_ARM_LENGTH * reach * Math.cos(shoulderRotation);
  const handReach = FOREARM_LENGTH * reach + HAND_RADIUS * HAND_CENTER_REACH_FRACTION;
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
  reach: number,
  timeSec: number,
  castGlow: number,
  tileSizePx: number,
  detail: SignetDetail,
): void {
  const upperArmLength = UPPER_ARM_LENGTH * reach;
  const forearmLength = FOREARM_LENGTH * reach;

  ctx.save();
  ctx.translate(armRootX(side), ARM_ROOT_Y);
  ctx.rotate(-side * shoulderAngle);

  ctx.strokeStyle = SKIN_LIT;
  ctx.lineCap = 'round';
  ctx.lineWidth = UPPER_ARM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, upperArmLength);
  ctx.stroke();

  ctx.save();
  pathLimb(ctx, UPPER_ARM_WIDTH, upperArmLength);
  ctx.clip();
  applyInkStyle(ctx, castGlow, tileSizePx);
  stampTattoo(ctx, detail, drawDragonMotif, timeSec, {
    x: 0,
    y: upperArmLength * 0.6,
    size: 0.095,
    phase: side < 0 ? 0.9 : 2.8,
    detail: true,
  });
  ctx.restore();

  ctx.translate(0, upperArmLength);
  ctx.rotate(-side * elbowAngle);

  ctx.strokeStyle = SKIN_BASE;
  ctx.lineWidth = FOREARM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, forearmLength);
  ctx.stroke();

  ctx.save();
  pathLimb(ctx, FOREARM_WIDTH, forearmLength);
  ctx.clip();
  applyInkStyle(ctx, castGlow, tileSizePx);
  stampTattoo(ctx, detail, drawEelLightningMotif, timeSec, {
    x: 0,
    y: forearmLength * 0.5,
    size: 0.095,
    phase: side < 0 ? 3.3 : 1.6,
    detail: true,
  });
  ctx.restore();

  ctx.fillStyle = SKIN_BASE;
  ctx.beginPath();
  ctx.arc(0, forearmLength + HAND_RADIUS * HAND_CENTER_REACH_FRACTION, HAND_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Long dark nails, as in her portrait
  ctx.strokeStyle = NAIL_COLOR;
  ctx.lineWidth = CONTOUR_LINE_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < NAIL_COUNT; i++) {
    const spread = (i / (NAIL_COUNT - 1) - 0.5) * 1.4;
    const nailRootX = spread * HAND_RADIUS;
    ctx.beginPath();
    ctx.moveTo(nailRootX, forearmLength + HAND_RADIUS);
    ctx.lineTo(nailRootX * 1.6, forearmLength + HAND_RADIUS + NAIL_LENGTH);
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
  /**
   * Positive when her right leg is swinging: the pelvis rotates under a level
   * shoulder line, carrying her hips away from that leg and over the foot that
   * is holding her up, and dropping the hip on the side with nothing under it.
   */
  const pelvisTilt = swingPhase * WALK_PELVIS_TILT;
  const pelvisTiltSin = Math.sin(pelvisTilt);
  /** Her neck cancels most of the pelvis swing so her head stays near level. */
  const headRotation = -pelvisTilt * HEAD_LEVELLING_SHARE;

  // Glow blur is in device pixels and ignores the transform, so the figure
  // scale has to be folded in by hand or her glows shrink as she grows.
  const glowTileSizePx = s * FIGURE_SCALE;
  const detail = resolveDetail(figureHeightPx(ctx, s));

  ctx.save();
  ctx.translate(sx + s / 2, sy + s / 2);
  if (pose.facingX < 0) ctx.scale(-1, 1);
  ctx.scale(s, s);
  ctx.translate(0, FOOT_Y);
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
  ctx.translate(0, -FOOT_Y - bob);

  // Where the torso's rotation about the shoulders leaves the pelvis. The legs
  // have to take the same travel or her hips unseat from her thighs.
  const pelvisTravel = -pelvisTiltSin * (HIP_Y - TORSO_PIVOT_Y);
  const hipShift = -swingPhase * WALK_HIP_SHIFT + pelvisTravel;

  drawBackHair(ctx, swingPhase * WALK_HAIR_SWAY);
  drawLegs(
    ctx,
    timeSec,
    swingPhase,
    hipShift,
    pelvisTiltSin,
    bob,
    pose.facingAway,
    eyeGlow,
    glowTileSizePx,
    detail,
  );

  ctx.save();
  ctx.translate(-swingPhase * WALK_HIP_SHIFT, 0);
  ctx.translate(0, TORSO_PIVOT_Y);
  ctx.rotate(pelvisTilt);
  ctx.translate(0, -TORSO_PIVOT_Y);
  drawTorso(ctx, timeSec, eyeGlow, glowTileSizePx, detail, pose.facingAway);
  drawThong(ctx, pose.facingAway);

  const handPoints: { x: number; y: number }[] = [];
  // Longest hanging straight down at the passing position, shortest at both
  // ends of the swing — the arm is turning toward and away from the viewer.
  const armReach = 1 - ARM_FORESHORTEN * Math.abs(swingPhase);

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
    drawArm(
      ctx,
      side,
      shoulderAngle,
      elbowAngle,
      armReach,
      timeSec,
      eyeGlow,
      glowTileSizePx,
      detail,
    );
    handPoints.push(armHandPoint(side, shoulderAngle, elbowAngle, armReach));
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
