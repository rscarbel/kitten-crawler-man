/**
 * The Krakaren Clone painter.
 *
 * A cloned kraken: a wet, heaving tangle squatting in a flooded pink lair. A
 * lumpen mantle buried in thirteen tentacles that cross, clump, drape and arch
 * over its top, the whole mass split open by gashes and watched by too many
 * eyes. She never walks, so the tentacles are the entire performance.
 *
 * She is deliberately not a squid, and everything here is written against the
 * ways she kept turning back into one. The dome is a third of her height rather
 * than two thirds, and four limbs arch over it so nothing traces a clean arc
 * across her top edge. The limb table is clustered by hand, not divided, and
 * spans 3× in girth and 4× in length with two torn-off stubs in it. There is no
 * beak. The two big eyes differ by more than 2.5× and share no axis, and half
 * the small ones are clouded, burst or shut rather than the same yellow token
 * repeated. A mouth is a notched split with teeth on both margins and no
 * catchlight in it. The rim light is a broken green-grey, the sucker rows are
 * irregular and half-replaced by eyes and gashes, and the value range runs down
 * to a near-black bruise in the folds.
 *
 * Three subjects live here and share one flesh: the boss body, the small guard
 * tentacle that bursts out of the floor beside the player, and the giant slam
 * tentacle. All three route through `paintTentacle`, so the parentage is not a
 * matter of matching two palettes by hand.
 *
 * Coordinates are tile units. The origin sits on the floor at the subject's
 * centre with +Y running down the screen, so everything above the ground has a
 * negative y. The generator translates to that ground point, scales by one
 * tile, and calls one of the five painters. Side views are drawn facing +X; the
 * runtime mirrors them.
 *
 * Two traps this file is written around. Tentacle spines are integrated at a
 * constant arc step rather than sampled from control points, because knots
 * spaced by anything other than distance put visible corners at uneven
 * stations along the curve. And every computed alpha goes through `rgba`,
 * because node-canvas drops an `rgba()` string whose alpha serialized in
 * exponent notation and bakes the shape as an opaque smear.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { type Pt, clamp01, deg, lerp, mix } from './carlArt.js';
import { TWO_PI, easeInOut, hash1, ramp, rgba } from './ratArt.js';
import {
  KRAKAREN_SWIPE_FRAMES,
  KRAKAREN_SWIPE_IMPACT_PROGRESS,
  SLAM_SMASH_IMPACT_PROGRESS,
  TENTACLE_STRIKE_IMPACT_PROGRESS,
} from '../src/sprites/krakarenAttackTiming.js';

export type { Pt };

// ── Small math ───────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Halfway across a cell or a fan — the offset that samples its centre. */
const CENTRE = 0.5;

/** A deterministic value somewhere in `[min, max]`, so re-bakes are identical. */
function hashRange(seed: number, min: number, max: number): number {
  return lerp(min, max, hash1(seed));
}

/**
 * A 0→1→0 shape whose peak sits exactly at `peak`.
 *
 * Everything in this file that has to land a visual event on a contract
 * progress — the swipe's lash, the strike's connect, the smash's hit — is
 * shaped by this rather than by a sine window, so the frame the gate measures
 * as the peak is the frame the damage fires on.
 */
function peakAt(t: number, peak: number): number {
  const c = clamp01(t);
  return c <= peak ? easeInOut(ramp(c, 0, peak)) : easeInOut(1 - ramp(c, peak, 1));
}

/** Rises to 1 at `peak`, is back to 0 by `end`, and stays there. */
function riseFall(t: number, peak: number, end: number): number {
  const c = clamp01(t);
  return easeInOut(ramp(c, 0, peak)) * (1 - easeInOut(ramp(c, peak, end)));
}

const MOUTH_RISE_SHARE = 0.28;
const MOUTH_HOLD_SHARE = 0.22;
const MOUTH_FALL_SHARE = 0.3;

/**
 * How wide one mouth gapes at a point in its own open/close cycle.
 *
 * Deliberately an ease up, a hold and an ease down rather than a
 * `hump(1 - d/w)`-style window: that shape is zero at the centre of its own
 * window, so a mouth built on it opens twice per cycle and snaps shut in
 * between.
 */
function mouthOpenAt(cycle: number): number {
  const t = cycle - Math.floor(cycle);
  if (t < MOUTH_RISE_SHARE) return easeInOut(t / MOUTH_RISE_SHARE);
  const held = t - MOUTH_RISE_SHARE;
  if (held < MOUTH_HOLD_SHARE) return 1;
  const falling = held - MOUTH_HOLD_SHARE;
  if (falling < MOUTH_FALL_SHARE) return easeInOut(1 - falling / MOUTH_FALL_SHARE);
  return 0;
}

// ── Palette ──────────────────────────────────────────────────────────────────

interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

/**
 * Magenta-pink flesh. The boss meta colour is `#e05090` and her lair drips
 * pink slime; she is supposed to look like the source of it.
 *
 * The bottom of the ramp is deliberately desaturated toward grey-violet. A
 * shadow that is merely a darker version of the midtone keeps the whole
 * creature inside one candy hue; bruising the shade is what makes the same
 * midtone read as raw meat instead of bubblegum.
 */
const FLESH: Ramp = { dark: '#4a2340', mid: '#f292bf', light: '#fdc0da' };
/**
 * The near-black end of the flesh range, at about 13% luminance.
 *
 * Nothing on the first bake was darker than a midtone, which is why she read as
 * a flat printed toy: deep folds, the undersides of the heaped limbs and the
 * insides of the wounds all sat at the same value as her lit flesh. This is the
 * value those places are painted at.
 */
const FLESH_DEEP = '#2a1226';
/** The underside of every tentacle, where the sucker rows run. */
const VENTRAL: Ramp = { dark: '#4e2a3a', mid: '#a9707f', light: '#d3aebc' };
const INK = '#2c0a1e';

/**
 * A dim, sickly rim — not a clean cool one.
 *
 * The first bake ran a bright cyan line all the way round her, which at a 32 px
 * tile was the highest-contrast thing in the frame and drew her as a tidy
 * cartoon outline. What separates her from the lair floor now is value, not a
 * traced edge, and the rim is a broken green-grey sheen rather than a contour.
 */
const RIM_LIGHT = '#8ba284';
const RIM_ALPHA = 0.34;
/**
 * Share of the stations along a rim or specular run that are dropped, breaking
 * one continuous sweep into a handful of wet patches.
 */
const RIM_GAP_SHARE = 0.42;
/**
 * Stroke width of the rim light, in tile units. Exported because the bake
 * gate's spread limit has to allow for the half of this stroke that falls
 * *outside* the silhouette it traces.
 */
export const RIM_WIDTH = 0.026;
/**
 * Wet highlight along the top of every tentacle and over the mantle dome.
 *
 * Kept low and broken up rather than run as one clean sweep: a bright unbroken
 * specular is the single strongest "moulded plastic" cue there is, and she is
 * supposed to look slick and diseased, not buffed.
 */
const SPECULAR = '#ffe4f2';
const SPECULAR_ALPHA = 0.13;

/** Raw flesh torn back around a gash. Not lips — there are no lips on her. */
const RAW_FLESH: Ramp = { dark: '#78122c', mid: '#cf3a5c', light: '#f2879b' };
const MAW = '#38071a';
const TOOTH = '#f1e7d2';

const IRIS = '#c9a154';
const PUPIL = '#12060e';
const SCLERA = '#c4ab98';

const RUBBLE: Ramp = { dark: '#2b1520', mid: '#5a3446', light: '#8e6274' };
const SLIME = '#f07fb4';

const CONTACT_SHADOW = '#160610';
const CONTACT_SHADOW_ALPHA = 0.44;

/** The direction the key light travels, in figure space: down and to the right. */
const LIGHT_DIR: Pt = { x: 0.58, y: 0.81 };

/** How far a fully receded tentacle is pushed toward the ink. */
const DEPTH_SHADE = 0.42;
/**
 * How far a tube standing on its own is pushed toward the ink before anything
 * else touches it.
 *
 * Held where it is by the bake's own floor-contrast gate rather than by taste:
 * the gate refuses a sheet whose mean channel falls under 90, the boss's own
 * sheet sits at 91.5, and this is what brings the two lone tentacles down onto
 * that same number instead of leaving them a third brighter than the creature
 * they grow out of.
 */
const SOLITARY_FIELD_SHADE = 0.13;

function fleshAt(shade: number): string {
  return mix(FLESH.mid, INK, clamp01(shade));
}

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Half the widest baked spread, in tiles. The boss's cull margin was widened
 * for a 2.8-tile reach and the border-clip gate holds every frame to it, so
 * every length and root offset below is budgeted against this number.
 */
export const KRAKAREN_SPREAD_HALF_TILES = 1.4;

/**
 * A slumped lump, not a head.
 *
 * The dome carried two thirds of the silhouette's height for two bakes running,
 * and that alone was the octopus: a big smooth ball with limbs hanging off the
 * bottom is a cartoon cephalopod however the limbs are drawn. It is now under
 * two fifths of the drawn height, wider than it is tall, and the crown limbs
 * arch over the top of it — so the tallest thing in the frame is tentacle and
 * the dome is something they erupt from.
 *
 * It is also narrower than the ring its limbs root on. At 0.78 the dome
 * swallowed the whole root ring and every limb left the silhouette from inside
 * one unbroken convex arc, which traced as a single smooth curve for most of a
 * turn — the last thing on her that read as a moulded shell. The outermost
 * roots now sit at 0.60 against a 0.55 half-width, so a third of the limbs
 * break out through the dome's own contour rather than from under it.
 */
const MANTLE_HALF_WIDTH = 0.6;
/** Barely taller above the widest point than below it: a lump, not an egg. */
const MANTLE_UPPER_RY = 0.52;
const MANTLE_LOWER_RY = 0.44;
const MANTLE_CENTRE_Y = -0.78;
/** How far the dome pinches in toward its apex. A pure ellipse reads as an egg. */
const MANTLE_APEX_TAPER = 0.2;
/**
 * Fine enough to resolve the notches cut into the contour: a 20° notch on a
 * 72-step ring is four points, which rounds off into a dent rather than
 * interrupting anything.
 */
const MANTLE_OUTLINE_STEPS = 180;

/** The dome's own apex above her ground point, in tiles. */
const MANTLE_APEX_TILES = -(MANTLE_CENTRE_Y - MANTLE_UPPER_RY);

/**
 * How far the crown limbs arch above the dome's apex, in tiles.
 *
 * Measured off the bake rather than derived: a crown limb's crest is the peak
 * of an arc-integrated spline, so no closed form predicts it. `CROWN_LENGTH`,
 * `CROWN_ROOT_LIFT` and `CROWN_CURL` set it and the anchor gate holds this
 * number to what they actually produce, within its own 8px tolerance.
 */
const CROWN_OVERSHOOT_TILES = 1.045;

/**
 * How far the highest ink on a resting frame stands above her ground point.
 *
 * The bake gate anchors the sheet on this: she sprawls well below her own
 * contact point, so the lowest ink cannot say where the floor is. It used to be
 * the top of the dome; now the crown limbs arch over the dome, so the crest of
 * that arch is the top of her.
 */
export const KRAKAREN_CREST_TILES = MANTLE_APEX_TILES + CROWN_OVERSHOOT_TILES;

/** Breathing: the dome widens as it flattens, so its volume looks conserved. */
const MANTLE_BREATH_WIDTH = 0.05;
const MANTLE_BREATH_HEIGHT = 0.07;
/** Bracing for the slam compresses the whole dome down onto the tentacle ring. */
const MANTLE_BRACE_SQUASH = 0.14;
const MANTLE_BRACE_SPREAD = 0.1;

/**
 * What each limb is for.
 *
 * A heap made of one kind of limb is a fan whatever the angles are, because
 * every member of it ends the same way and reaches about as far. Three kinds
 * that behave differently is what stops the eye from finding the pattern.
 */
type LimbRole =
  /** Hangs and hooks around the body: the bulk of the mass. */
  | 'drape'
  /** Roots on the dome's shoulder and arches over its top. */
  | 'crown'
  /** Torn off short, ending in an open wound rather than a taper. */
  | 'stub';

/**
 * The limbs, one entry each, written out rather than divided.
 *
 * An even ring with jitter on it is still an even ring: neighbours stay one
 * share apart and a viewer who counts a gap can count the rest. These azimuths
 * are clustered by hand instead — six crowded across one flank, three strung
 * thin round the other, two out the back and the stubs wedged between — so the
 * split is eight limbs against five in all three views and neither side reads
 * as half of anything.
 *
 * `lengthShare` spans 3.8× and `widthShare` 3.2×, which is the other half of
 * making the count unreadable: a viewer tracking a limb loses it against a
 * neighbour four times its girth long before they finish counting.
 */
interface RingLimb {
  /** Fixed world azimuth. Subtracting the camera's turns one layout into three. */
  readonly azimuthDegrees: number;
  /** How far off the root ring this limb's own root sits. */
  readonly rootReach: number;
  readonly lengthShare: number;
  readonly widthShare: number;
  readonly curlShare: number;
  /** -1 hooks the limb back over its own side of the body, +1 lets it drape clear. */
  readonly hook: number;
  /** Pulls the limb out of depth order, so limbs at similar depths cross. */
  readonly layerBias: number;
  readonly role: LimbRole;
}

const RING_LIMBS: readonly RingLimb[] = [
  {
    azimuthDegrees: 10,
    rootReach: 0.78,
    lengthShare: 0.62,
    widthShare: 0.55,
    curlShare: 1.25,
    hook: -1,
    layerBias: 0.3,
    role: 'drape',
  },
  {
    azimuthDegrees: 26,
    rootReach: 1.12,
    lengthShare: 1.0,
    widthShare: 1.35,
    curlShare: 0.85,
    hook: 1,
    layerBias: -0.24,
    role: 'drape',
  },
  {
    azimuthDegrees: 44,
    rootReach: 0.92,
    lengthShare: 0.8,
    widthShare: 0.9,
    curlShare: 1.4,
    hook: -1,
    layerBias: 0.18,
    role: 'drape',
  },
  {
    azimuthDegrees: 63,
    rootReach: 1.05,
    lengthShare: 0.34,
    widthShare: 1.2,
    curlShare: 0.5,
    hook: 1,
    layerBias: 0.34,
    role: 'stub',
  },
  {
    azimuthDegrees: 84,
    rootReach: 0.7,
    lengthShare: 1.3,
    widthShare: 0.75,
    curlShare: 1.0,
    hook: -1,
    layerBias: 0,
    role: 'crown',
  },
  {
    azimuthDegrees: 106,
    rootReach: 1.16,
    lengthShare: 0.55,
    widthShare: 0.42,
    curlShare: 1.6,
    hook: 1,
    layerBias: -0.3,
    role: 'drape',
  },
  {
    azimuthDegrees: 128,
    rootReach: 0.86,
    lengthShare: 0.92,
    widthShare: 1.05,
    curlShare: 0.95,
    hook: -1,
    layerBias: 0.26,
    role: 'drape',
  },
  {
    azimuthDegrees: 150,
    rootReach: 0.74,
    lengthShare: 1.22,
    widthShare: 0.62,
    curlShare: 1.3,
    hook: 1,
    layerBias: -0.12,
    role: 'crown',
  },
  {
    azimuthDegrees: 196,
    rootReach: 1.0,
    lengthShare: 0.72,
    widthShare: 0.8,
    curlShare: 1.3,
    hook: -1,
    layerBias: 0.22,
    role: 'drape',
  },
  {
    azimuthDegrees: 238,
    rootReach: 0.7,
    lengthShare: 0.7,
    widthShare: 1.3,
    curlShare: 1.6,
    hook: 1,
    layerBias: -0.28,
    role: 'crown',
  },
  {
    azimuthDegrees: 276,
    rootReach: 1.1,
    lengthShare: 0.95,
    widthShare: 0.85,
    curlShare: 1.45,
    hook: -1,
    layerBias: 0.14,
    role: 'drape',
  },
  {
    azimuthDegrees: 300,
    rootReach: 0.88,
    lengthShare: 0.38,
    widthShare: 1.1,
    curlShare: 0.6,
    hook: 1,
    layerBias: -0.34,
    role: 'stub',
  },
  {
    azimuthDegrees: 315,
    rootReach: 0.72,
    lengthShare: 0.98,
    widthShare: 0.95,
    curlShare: 1.15,
    hook: -1,
    layerBias: 0.1,
    role: 'crown',
  },
];

/**
 * Thirteen, and no viewer is meant to arrive at that number. Derived from the
 * table rather than declared beside it, because a count that disagrees with the
 * limbs would send the swipe row at a tentacle that does not exist.
 */
export const KRAKAREN_TENTACLE_COUNT = RING_LIMBS.length;

/** The ellipse the tentacle roots sit on, seen from the game's fixed camera. */
const RING_RX = 0.52;
const RING_RY = 0.22;
/**
 * How far up the body the limbs come out.
 *
 * High on the mantle rather than under its skirt: the limbs then lie across the
 * dome's own lower half and bury it, which is the difference between a mass of
 * tentacles with a head somewhere in it and a balloon standing on legs.
 */
const RING_CENTRE_Y = -0.72;
const RING_SEED = 41;

/**
 * The crown limbs: aimed straight up out of the heap, and turned back over the
 * top of the dome.
 *
 * They are the reason the dome is no longer the top of her, and the reason
 * nothing traces a clean arc across her top edge. Their curl always takes them
 * inward across the mantle rather than outward, so they add height and
 * interruption without costing the border-clip gate a pixel of spread.
 */
const CROWN_LENGTH = 1.4;
/**
 * Turned hard, and turning from the moment it leaves the root.
 *
 * A crown limb that only begins to bend near its tip is a straight tapered tube
 * for the whole stretch where it crosses the dome, and four of those radiating
 * from one point cut the mantle into flat panels — the read is folded paper, not
 * flesh. Spreading the turn nearly evenly along the arc bows the over-dome
 * stretch itself, so what lies across her is a curve.
 */
const CROWN_CURL = 1.55;
const CROWN_CURL_BIAS = 0.45;
/** How far off straight up a crown limb leaves its root, in radians. */
const CROWN_LEAN = 0.35;
/**
 * A crown limb waves nearly three times as hard as a drape one.
 *
 * It is the stretch of limb that crosses the dome, and it crosses it early —
 * inside the first third of its own length, where a back-loaded curl has barely
 * started turning. Without a wave in it that stretch is a straight tube laid
 * over a curved body, which the eye reads as a fold in the body.
 */
const CROWN_WAVE = 0.72;
const CROWN_WAVE_CYCLES = 1.7;
/**
 * Crown limbs are drawn thinner than their table width.
 *
 * A thick limb standing up off the dome is a leg, and four of them is a stool.
 * What has to read is a whip laid over the top of a body.
 */
const CROWN_WIDTH_SHARE = 0.56;
/** How much of the ring's depth a crown limb's root rides. */
const CROWN_ROOT_DEPTH_SHARE = 0.25;

/**
 * A torn-off limb: blunt, and capped with an open wound instead of a taper.
 *
 * The tip share and the taper power are what keep it from being a rectangle.
 * At 0.62 of its own base over a third of a tile the two sides never converge
 * enough to read as a taper at all, and what the eye finds is a straight-sided
 * pink bar with a straight cut on the end — a panel, which is the same defect
 * the crown limbs used to have where they crossed the dome.
 */
const STUB_TIP_SHARE = 0.42;
const STUB_TAPER_POWER = 1.15;
const STUB_WOUND_SHARE = 1.45;
const STUB_WOUND_TEARS = 4;
const STUB_WOUND_SPREAD_SHARE = 0.7;
const STUB_WOUND_SEED = 617;

/**
 * The length one limb of `lengthShare` 1 reaches, in tiles of arc.
 *
 * Every share in the table is at or under 1.3, and only the crown limbs use the
 * top of that range — inward, over the dome, where the reach costs the
 * border-clip gate nothing. The widest thing on the resting body is still a
 * mid-length drape limb hooking outward.
 */
const TENTACLE_LENGTH = 1.05;
const TENTACLE_BASE_WIDTH = 0.2;
const TENTACLE_TIP_WIDTH = 0.032;
const TENTACLE_TIP_VARIANCE_MIN = 0.7;
const TENTACLE_TIP_VARIANCE_MAX = 1.9;
/** Thick and muscular for the first third, then a long taper. Linear reads as rope. */
const TENTACLE_TAPER_POWER = 0.66;
/**
 * Total turn a resting tentacle accumulates, in radians — the drape.
 *
 * Most of a turn and a half. The extra length above is spent coiling rather
 * than reaching: a limb that hooks back on itself adds mass to the heap without
 * adding a pixel to the spread the border-clip gate holds her to.
 */
const TENTACLE_CURL = 2.4;
/** Back-loads the turn so the tentacle leaves the body straight and hooks late. */
const TENTACLE_CURL_BIAS = 1.4;
const TENTACLE_SEGMENTS = 22;
const TUBE_BULGE_SLOW = 0.19;
const TUBE_BULGE_FAST = 0.085;
const TUBE_BULGE_PHASE_SKEW = 1.7;
/**
 * A swelling has a size in tiles, not a count per limb.
 *
 * A fixed lobe count spends the same number of bulges on a 0.4-tile stub and on
 * the 2.5-tile slam trunk, so the longer the limb the further apart they
 * stretch: over the slam's whole length the slow lobe never finished half a
 * cycle, which left a girth falling monotonically from 38px to 6px with two
 * dead-straight sides — a traffic cone rather than an arm. A rate fixes that end
 * and breaks the other, smoothing every short limb into a plain taper, so the
 * lobe count is a rate with the old fixed count as its floor.
 */
const TUBE_BULGE_SLOW_LOBES_PER_TILE = 3.4;
const TUBE_BULGE_FAST_LOBES_PER_TILE = 8.3;
const TUBE_BULGE_MIN_SLOW_LOBES = 3.4;
const TUBE_BULGE_MIN_FAST_LOBES = 8.3;
/**
 * How far a lone tube narrows into the hole it came up through, and how far up
 * it takes to swell to full girth.
 *
 * A tentacle drawn at full width right down to its root ends in a straight cut
 * two thirds of a tile across, and two straight sides converging on a straight
 * bottom edge is a wedge of card stood on the floor. A limb going into a hole
 * is *hidden* by the rim, so what should be visible at the ground line is the
 * narrowest part of it, not the widest. A limb in the heap has its root buried
 * in other limbs and wants none of this.
 */
const ROOT_PINCH_SHARE = 0.52;
const ROOT_PINCH_T = 0.17;

/** How far out and how far down a tentacle leaves the ring, by ring position. */
const TENTACLE_BACK_LIFT = -0.55;
const TENTACLE_FRONT_DROOP = 0.75;
const TENTACLE_OUT_X = 0.85;

/** Idle coil: a slow travelling wave down each tentacle. */
const COIL_WAVE = 0.55;
const COIL_WAVE_CYCLES = 0.85;
/** Bracing pulls the tentacles taut and roots them; the coil nearly stops. */
const BRACE_WAVE_DAMP = 0.75;
const BRACE_CURL_GAIN = 0.55;
const BRACE_LENGTH_PULL = 0.12;

const BODY_MOUTHS_MIN = 2;
const BODY_MOUTHS_MAX = 5;
const BODY_MOUTH_SIZE = 0.095;
/** Some limbs watch, some do not. Every limb watching is as tidy as none doing. */
const BODY_EYES_MAX = 2;

/**
 * The big split low on the dome, where a beak used to be.
 *
 * A chitin beak is the single most recognisable thing an octopus has, and two
 * eyes above one is a face however far off the midline it is shoved. What is
 * there now is another wound — the largest one on her, running steeply rather
 * than level, well off the centre line and well below both eyes, so nothing
 * about it can be assembled into a mouth under a pair of eyes.
 */
const FACE_GASH_Y = -0.5;
const FACE_GASH_HALF = 0.2;
const FACE_GASH_X = 0.34;
const FACE_GASH_ANGLE_DEGREES = 118;
const FACE_GASH_ANGLE = deg(FACE_GASH_ANGLE_DEGREES);
/** It never closes: a split that seals reads as a mouth with lips. */
const FACE_GASH_CLOSED_OPEN = 0.16;
const FACE_GASH_SEED = 8123;

const BODY_SHADOW_RX = 1.15;
const BODY_SHADOW_RY = 0.3;
const BODY_SHADOW_Y = -0.04;

/** Risen height of the small guard tentacle. */
const GUARD_HEIGHT = 1.4;
const GUARD_BASE_WIDTH = 0.19;
const GUARD_TIP_WIDTH = 0.055;
const GUARD_MOUTH_COUNT = 5;
const GUARD_MOUTH_SIZE = 0.085;
const GUARD_EYE_COUNT = 2;
/** The knot of gashes near the tip is what makes it a creature, not scenery. */
const GUARD_TIP_CLUSTER_COUNT = 4;
const GUARD_TIP_CLUSTER_SIZE = 0.1;
const GUARD_TIP_CLUSTER_SPREAD = 0.11;
const GUARD_TIP_CLUSTER_T = 0.86;
/** One eye in among them, so the cluster is watching rather than just chewing. */
const GUARD_TIP_EYE_T = 0.74;
const GUARD_TIP_EYE_RADIUS = 0.05;
const GUARD_TIP_EYE_ACROSS = 0.45;

/**
 * The slam tentacle: the largest single piece of art in the fight, and
 * markedly thicker than the boss's own idle tentacles so the eye snaps to it
 * the moment the red ring appears.
 */
export const SLAM_HEIGHT = 2.5;
const SLAM_BASE_WIDTH = 0.34;
const SLAM_TIP_WIDTH = 0.1;
const SLAM_MOUTH_COUNT = 7;
const SLAM_MOUTH_SIZE = 0.13;
const SLAM_EYE_COUNT = 3;
const SLAM_SPLAY_TENDRILS = 4;
const SLAM_SPLAY_LENGTH = 0.5;
const SLAM_SPLAY_ARC_DEGREES = 120;
const SLAM_SPLAY_ARC = deg(SLAM_SPLAY_ARC_DEGREES);

// ── Views ────────────────────────────────────────────────────────────────────

export type KrakarenView = 'front' | 'back' | 'side';

interface ViewSpec {
  /**
   * Where the camera sits on the tentacle ring, in radians. Every tentacle
   * carries a fixed world azimuth; subtracting the camera's turns one layout
   * into three, so a given tentacle is the same tentacle in all three views.
   */
  readonly azimuth: number;
  /** Multiplier on the mantle's drawn width — the dome is not a sphere. */
  readonly girth: number;
  readonly showsFace: boolean;
  readonly profile: boolean;
  /** Re-rolls the scattered eyes and gashes, so no two views share a pattern. */
  readonly seed: number;
}

const PROFILE_GIRTH = 0.84;
const FRONT_SCATTER_SEED = 1811;
const SIDE_SCATTER_SEED = 3313;
const BACK_SCATTER_SEED = 4931;

const VIEWS: Record<KrakarenView, ViewSpec> = {
  front: { azimuth: 0, girth: 1, showsFace: true, profile: false, seed: FRONT_SCATTER_SEED },
  side: {
    azimuth: Math.PI / 2,
    girth: PROFILE_GIRTH,
    showsFace: true,
    profile: true,
    seed: SIDE_SCATTER_SEED,
  },
  back: { azimuth: Math.PI, girth: 1, showsFace: false, profile: false, seed: BACK_SCATTER_SEED },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/** The melee lash: one flank tentacle rears and whips through the melee arc. */
export interface KrakarenSwipe {
  /** Which ring tentacle performs it, 0 to `KRAKAREN_TENTACLE_COUNT - 1`. */
  readonly tentacle: number;
  /** 0→1 across the swipe row. The lash peaks at the timing contract's progress. */
  readonly progress: number;
}

/**
 * One frame of the boss body.
 *
 * She is rooted, so almost every dial here is a texture of motion rather than
 * a displacement: the coil cycle drives the tentacles, the breath drives the
 * mantle, the mouth cycle drives the mouths, and only the swipe moves anything
 * across the frame.
 */
export interface KrakarenPose {
  /** Advancing 0→1 cycle for the tentacle coil; wraps freely past 1. */
  coil: number;
  /**
   * How far the limbs are spread across the coil cycle. 0 puts them all in
   * lockstep, which reads as one object breathing rather than as a heap.
   */
  coilSpread: number;
  /** Mantle breath, 0 fully drawn in to 1 fully swelled. */
  breath: number;
  /** 0 relaxed, 1 fully braced: tentacles taut and rooted, dome compressed. */
  brace: number;
  /** Advancing 0→1 cycle for the mouths; each mouth carries its own offset. */
  mouthCycle: number;
  /** How far the mouths are spread across that cycle, so they open out of phase. */
  mouthSpread: number;
  /** Null on every frame where no tentacle is lashing. */
  swipe: KrakarenSwipe | null;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** Eye aim across the mantle, -1 to 1. Front-view eyes look at the camera at 0. */
  gaze: number;
  /** 0 closed beak, 1 full gape. */
  beakGape: number;
  /** Whole-body vertical offset; negative lifts her off the floor. */
  heave: number;
}

const RESTING_BREATH = 0.5;
const RESTING_COIL_SPREAD = 1;
const RESTING_MOUTH_SPREAD = 1;

/** A resting boss. Every row is written as edits to this. */
export function restingKrakarenPose(): KrakarenPose {
  return {
    coil: 0,
    coilSpread: RESTING_COIL_SPREAD,
    breath: RESTING_BREATH,
    brace: 0,
    mouthCycle: 0,
    mouthSpread: RESTING_MOUTH_SPREAD,
    swipe: null,
    blink: 0,
    gaze: 0,
    beakGape: 0,
    heave: 0,
  };
}

export type GuardTentaclePhase = 'emerge' | 'idle' | 'strike' | 'retreat';

/** One frame of the small guard tentacle. */
export interface GuardTentaclePose {
  readonly phase: GuardTentaclePhase;
  /** 0→1 across the phase's row. */
  progress: number;
  /** Which way a strike is aimed. Ignored by the other phases. */
  strikeView: KrakarenView;
  /** Advancing 0→1 cycle for the idle sway. */
  sway: number;
  /** Advancing 0→1 cycle for the mouths. */
  mouthCycle: number;
}

export function restingGuardTentaclePose(): GuardTentaclePose {
  return { phase: 'idle', progress: 0, strikeView: 'front', sway: 0, mouthCycle: 0 };
}

export type SlamTentaclePhase = 'rise' | 'loom' | 'dive' | 'smash';

/** One frame of the giant slam tentacle. */
export interface SlamTentaclePose {
  readonly phase: SlamTentaclePhase;
  /** 0→1 across the phase's row. */
  progress: number;
  /** Advancing 0→1 cycle for the loom's coil and quiver. */
  coil: number;
  /** Advancing 0→1 cycle for the mouths. */
  mouthCycle: number;
}

export function restingSlamTentaclePose(): SlamTentaclePose {
  return { phase: 'loom', progress: 0, coil: 0, mouthCycle: 0 };
}

// ── Tentacle spline core ─────────────────────────────────────────────────────

/**
 * Everything the shared tentacle painter needs. The boss's thirteen limbs, the
 * guard tentacle and the slam tentacle are all one of these, which is what
 * keeps the three sheets reading as one creature's flesh.
 */
export interface TentacleSpec {
  readonly root: Pt;
  /** Direction the tentacle leaves the root, in radians; +Y is down the screen. */
  readonly baseAngle: number;
  /** Arc length in tile units. */
  readonly length: number;
  readonly baseWidth: number;
  readonly tipWidth: number;
  /** Total turn accumulated along the length, in radians. */
  readonly curl: number;
  /** >1 back-loads the turn toward the tip; 1 spreads it evenly. */
  readonly curlBias: number;
  /** Amplitude of the travelling coil wave, in radians of extra turn. */
  readonly wave: number;
  readonly waveCycles: number;
  readonly wavePhase: number;
  readonly taperPower: number;
  /** 0 nearest the camera, 1 fully receded. Drives shading only. */
  readonly depth: number;
  readonly seed: number;
  /** How many gashes to try to fit along it; they land in clumps, not a row. */
  readonly mouths: number;
  /** Small eyes set into the flesh of the limb itself. */
  readonly eyes: number;
  readonly mouthSize: number;
  readonly mouthCycle: number;
  /** How far the mouths are spread across their cycle. */
  readonly mouthSpread: number;
  /** 0 none, 1 a full fan of sub-tendrils off the tip. */
  readonly splay: number;
  /** Torn off rather than tapered: the tip is capped flat and left open. */
  readonly stump: boolean;
  /**
   * How far this tube is standing on its own, 0 to 1.
   *
   * A limb in the boss's heap is modelled by everything around it: it recedes
   * behind its neighbours, the pocket under the dome darkens it, and the limbs
   * heaped on top cast onto it. A guard or slam tentacle has none of that — it
   * is one tube in an empty frame — so painted by the same rules it comes out
   * the palest, flattest thing in the fight and reads as pasted in off another
   * sheet. This is what a lone tube uses to supply its own value and its own
   * volume.
   *
   * It also shuts off the eye-flavoured suckers. A pale sclera disc in a ventral
   * row is telling against a body already covered in eyes of five other sizes;
   * on a lone tentacle it is simply a second kind of sucker, and the two
   * flavours in one row read as eyes down the limb's edge.
   */
  readonly solitary: number;
}

/**
 * How far a tube's flesh sits below the flat midtone: what the heap does to it,
 * plus what it has to do for itself.
 */
function tubeShade(spec: TentacleSpec): number {
  return clamp01(clamp01(spec.depth) * DEPTH_SHADE + clamp01(spec.solitary) * SOLITARY_FIELD_SHADE);
}

interface TentacleSpine {
  readonly points: readonly Pt[];
  readonly widths: readonly number[];
  readonly angles: readonly number[];
}

/**
 * Walks the spine at a constant arc step.
 *
 * The step is fixed and the turn is integrated, rather than the curve being
 * fitted through hand-placed control points: knots spaced by anything other
 * than arc distance put a visible corner wherever two stations crowd.
 */
function buildTentacleSpine(spec: TentacleSpec): TentacleSpine {
  const step = spec.length / TENTACLE_SEGMENTS;

  const turnWeights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < TENTACLE_SEGMENTS; i++) {
    const t = (i + CENTRE) / TENTACLE_SEGMENTS;
    const weight = Math.pow(t, spec.curlBias);
    turnWeights.push(weight);
    weightSum += weight;
  }

  const points: Pt[] = [spec.root];
  const angles: number[] = [spec.baseAngle];
  let angle = spec.baseAngle;
  let x = spec.root.x;
  let y = spec.root.y;
  for (let i = 0; i < TENTACLE_SEGMENTS; i++) {
    const t = i / TENTACLE_SEGMENTS;
    const coilTurn = Math.cos(t * TWO_PI * spec.waveCycles + spec.wavePhase) * spec.wave;
    angle += (spec.curl * turnWeights[i]) / weightSum + coilTurn / TENTACLE_SEGMENTS;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    points.push(pt(x, y));
    angles.push(angle);
  }

  // Two incommensurate bulges along the girth, so no stretch of a tube has two
  // parallel edges. A tapered tube with a smooth taper has *straight* sides
  // wherever it is not turning, and a straight-sided pink shape lying across a
  // body is read as a folded panel rather than as a limb — which is exactly how
  // four crown limbs over one dome turned her into origami.
  const slowLobes = Math.max(
    TUBE_BULGE_MIN_SLOW_LOBES,
    spec.length * TUBE_BULGE_SLOW_LOBES_PER_TILE,
  );
  const fastLobes = Math.max(
    TUBE_BULGE_MIN_FAST_LOBES,
    spec.length * TUBE_BULGE_FAST_LOBES_PER_TILE,
  );
  const solitary = clamp01(spec.solitary);
  const widths = points.map((_, i) => {
    const t = i / TENTACLE_SEGMENTS;
    const bulge =
      1 +
      Math.sin(t * slowLobes + spec.seed) * TUBE_BULGE_SLOW +
      Math.sin(t * fastLobes + spec.seed * TUBE_BULGE_PHASE_SKEW) * TUBE_BULGE_FAST;
    const pinch = lerp(1, lerp(ROOT_PINCH_SHARE, 1, easeInOut(ramp(t, 0, ROOT_PINCH_T))), solitary);
    return lerp(spec.baseWidth, spec.tipWidth, Math.pow(t, spec.taperPower)) * bulge * pinch;
  });
  return { points, widths, angles };
}

interface SpineSample {
  readonly point: Pt;
  readonly angle: number;
  readonly width: number;
}

function sampleSpine(spine: TentacleSpine, t: number): SpineSample {
  const last = spine.points.length - 1;
  const position = clamp01(t) * last;
  const index = Math.min(last - 1, Math.floor(position));
  const frac = position - index;
  const a = spine.points[index];
  const b = spine.points[index + 1];
  return {
    point: pt(lerp(a.x, b.x, frac), lerp(a.y, b.y, frac)),
    angle: lerp(spine.angles[index], spine.angles[index + 1], frac),
    width: lerp(spine.widths[index], spine.widths[index + 1], frac),
  };
}

/** Unit normal on the +side of the spine at `angle`. */
function normalAt(angle: number, side: number): Pt {
  return pt(-Math.sin(angle) * side, Math.cos(angle) * side);
}

/** The side of the tube the key light falls on: +1 or -1. */
function litSide(angle: number): number {
  const plus = normalAt(angle, 1);
  return plus.x * LIGHT_DIR.x + plus.y * LIGHT_DIR.y < 0 ? 1 : -1;
}

const TIP_CAP_OVERSHOOT = 1.5;
/**
 * The cut across a limb that has been torn off short.
 *
 * A single station past the tip closes the tube with one straight line drawn
 * square across it, and a barely-tapering stub shut by a perpendicular cut is a
 * length of pipe: the two stubs on her read as limbs clipped by a bounding box
 * rather than as limbs bitten off. The cut is walked across the tube at hashed
 * depths instead, so one corner of it is dragged out and another is chewed back
 * in behind the last station.
 */
const STUMP_CAP_STATIONS = 5;
const STUMP_CAP_MIN_OVERSHOOT = -0.4;
const STUMP_CAP_MAX_OVERSHOOT = 0.5;
const STUMP_CAP_SEED = 4241;
/**
 * The torn end every tentacle that has not been ripped off short still gets.
 *
 * One point at the end of two converging edges is a chisel: two straight cuts
 * meeting at a corner, which is what a blade leaves and what a growing thing
 * never has. These stations fan round the tip at hashed reaches instead, so a
 * limb ends in a ragged stub with lobes on it and no two of the thirteen end the
 * same way.
 */
const TIP_RAG_STATIONS = 7;
const TIP_RAG_MIN = 0.2;
const TIP_RAG_MAX = 1.15;
const TIP_RAG_ARC_DEGREES = 108;
const TIP_RAG_ARC = deg(TIP_RAG_ARC_DEGREES);
const TIP_RAG_SEED = 3167;

function tentacleOutline(spine: TentacleSpine, spec: TentacleSpec): Pt[] {
  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let i = 0; i < spine.points.length; i++) {
    const n = normalAt(spine.angles[i], 1);
    const p = spine.points[i];
    const w = spine.widths[i];
    near.push(pt(p.x + n.x * w, p.y + n.y * w));
    far.push(pt(p.x - n.x * w, p.y - n.y * w));
  }
  const last = spine.points.length - 1;
  const tip = spine.points[last];
  const tipAngle = spine.angles[last];
  const width = spine.widths[last];
  if (spec.stump) {
    const across = normalAt(tipAngle, 1);
    const cap: Pt[] = [];
    for (let i = 0; i < STUMP_CAP_STATIONS; i++) {
      const side = CENTRE - (i + CENTRE) / STUMP_CAP_STATIONS;
      const along =
        width *
        hashRange(spec.seed + STUMP_CAP_SEED + i, STUMP_CAP_MIN_OVERSHOOT, STUMP_CAP_MAX_OVERSHOOT);
      cap.push(
        pt(
          tip.x + across.x * width * 2 * side + Math.cos(tipAngle) * along,
          tip.y + across.y * width * 2 * side + Math.sin(tipAngle) * along,
        ),
      );
    }
    return [...near, ...cap, ...far.reverse()];
  }
  const rag: Pt[] = [];
  for (let i = 0; i < TIP_RAG_STATIONS; i++) {
    const seed = spec.seed + TIP_RAG_SEED + i;
    const around = tipAngle + (CENTRE - (i + CENTRE) / TIP_RAG_STATIONS) * TIP_RAG_ARC;
    const reach = width * TIP_CAP_OVERSHOOT * hashRange(seed, TIP_RAG_MIN, TIP_RAG_MAX);
    rag.push(pt(tip.x + Math.cos(around) * reach, tip.y + Math.sin(around) * reach));
  }
  return [...near, ...rag, ...far.reverse()];
}

/**
 * The three stretches of one tube that are wet enough to catch the light.
 *
 * Three, and never more: a highlight cut into more pieces than that is a dotted
 * line, and a dotted line down the middle of a tube is read as a continuous one
 * that happens to be interrupted. Their positions and lengths come off the
 * limb's own seed, so no two limbs shine in the same places.
 */
interface SpecularWindow {
  readonly from: number;
  readonly to: number;
}

const SPECULAR_RUNS = 3;
const SPECULAR_RUN_MIN = 0.06;
const SPECULAR_RUN_MAX = 0.17;
const SPECULAR_RUN_SEED_STRIDE = 37;
const SPECULAR_RUN_START_DRAW = 1;

function specularWindows(seed: number): SpecularWindow[] {
  const windows: SpecularWindow[] = [];
  for (let i = 0; i < SPECULAR_RUNS; i++) {
    const own = seed + i * SPECULAR_RUN_SEED_STRIDE;
    const band = 1 / SPECULAR_RUNS;
    const length = hashRange(own, SPECULAR_RUN_MIN, SPECULAR_RUN_MAX);
    const from = (i + hash1(own + SPECULAR_RUN_START_DRAW) * (1 - length / band)) * band;
    windows.push({ from, to: from + length });
  }
  return windows;
}

function tracePolygon(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function traceEllipse(ctx: Ctx, centre: Pt, rx: number, ry: number, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, Math.max(0, rx), Math.max(0, ry), rotation, 0, TWO_PI);
}

function fillEllipse(
  ctx: Ctx,
  centre: Pt,
  rx: number,
  ry: number,
  fill: string,
  rotation = 0,
): void {
  traceEllipse(ctx, centre, rx, ry, rotation);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Strokes a line along whichever side of the tube currently faces the light,
 * breaking the stroke wherever the curve rolls the lit side over. Carried
 * through a flip as one path it cuts straight across the tentacle.
 *
 * `gapShare` drops that share of the stations outright, which is how the rim
 * and the specular are kept from being clean traced contours: an unbroken line
 * all the way down a limb is the strongest "moulded plastic" cue available, and
 * at a 32 px tile it is the only thing a player sees.
 *
 * `windows` is the stricter version of the same idea, and the one the specular
 * uses. A hashed drop share scatters a line into a dotted one, which still reads
 * as a line; what stops a highlight reading as an inflated rubber tube is a
 * handful of wet patches with long dry stretches between them, and that is a
 * property of how the run is *cut up*, not of how much of it survives.
 */
function strokeRolledEdge(
  ctx: Ctx,
  spine: TentacleSpine,
  inset: number,
  colour: string,
  alpha: number,
  width: number,
  side: number,
  gapShare = 0,
  gapSeed = 0,
  windows: readonly SpecularWindow[] = [],
): void {
  ctx.strokeStyle = rgba(colour, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const last = spine.points.length - 1;
  let open = false;
  let previousSide = 0;
  ctx.beginPath();
  for (let i = 0; i < spine.points.length; i++) {
    const angle = spine.angles[i];
    const t = i / last;
    const outside =
      windows.length > 0 && !windows.some((window) => t >= window.from && t <= window.to);
    const dropped =
      outside || (gapShare > 0 && hash1(gapSeed + i * EDGE_GAP_SEED_STRIDE) < gapShare);
    const facing = dropped ? 0 : litSide(angle) * side;
    if (facing !== previousSide) {
      if (open) ctx.stroke();
      ctx.beginPath();
      open = false;
      previousSide = facing;
    }
    if (facing === 0) continue;
    const n = normalAt(angle, facing);
    const p = spine.points[i];
    const offset = spine.widths[i] * inset;
    const x = p.x + n.x * offset;
    const y = p.y + n.y * offset;
    if (open) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      open = true;
    }
  }
  if (open) ctx.stroke();
}

const SUCKERS_PER_TILE = 13;
const SUCKER_START_T = 0.08;
const SUCKER_END_T = 0.94;
const SUCKER_INSET = 0.42;
/**
 * How far a station may wander off the row's own line, as a share of the local
 * half-width.
 *
 * A row is a line of things going the same way. A *column* of things at exactly
 * one offset from the spine is a line whether or not the spacing along it
 * varies, and a straight column of discs down a tube is a rubber toy. Letting
 * each station sit a quarter of the arm's width to either side of the line is
 * what turns the column back into a scatter that happens to run lengthways.
 */
const SUCKER_LATERAL_JITTER = 0.25;
/** Suckers shrink faster than the tube does, so the rows crowd toward the tip. */
const SUCKER_RADIUS_SHARE = 0.3;
const SUCKER_PIT_ALPHA = 0.85;
const SUCKER_LIP_ALPHA = 0.3;
const SUCKER_HOLE_ALPHA = 0.82;
const SUCKER_FLEX = 0.22;
/**
 * The two kinds of step between one station and the next.
 *
 * A single jittered step is still an even row: shoving each station a little
 * off its own share keeps the mean spacing and only smudges it, which is why
 * the last bake measured a coefficient of variation under 0.15 down the slam's
 * whole length. What breaks a row is *clumping* — two or three crowded almost
 * on top of each other, then a long bare stretch — so the step is drawn from
 * one of two separated bands rather than from one range.
 */
const SUCKER_TIGHT_STEP_MIN = 0.16;
const SUCKER_TIGHT_STEP_MAX = 0.44;
const SUCKER_GAP_STEP_MIN = 1.35;
const SUCKER_GAP_STEP_MAX = 2.5;
const SUCKER_TIGHT_SHARE = 0.5;
/** Diameters span more than five to one, so no two neighbours are a matched set. */
const SUCKER_SIZE_MIN = 0.34;
const SUCKER_SIZE_MAX = 1.85;
/** Stations that grow an eye, and stations that split open, instead. */
const SUCKER_EYE_SHARE = 0.11;
const SUCKER_GASH_SHARE = 0.16;
const SUCKER_GASH_HALF_SHARE = 1.45;
const SUCKER_EYE_RADIUS_SHARE = 0.95;
/**
 * The share of suckers that stand proud of the tube instead of sitting in it.
 *
 * A sucker painted inside the clip cannot change the shape of the limb, so a
 * row of them is a texture printed on a smooth tube — and a smooth tube reads as
 * moulded whatever is printed on it. A proud one is drawn after the outline, sat
 * across it, and shows up in the silhouette as a knuckle.
 */
const SUCKER_PROUD_SHARE = 0.55;
const SUCKER_PROUD_INSET = 0.94;
const SUCKER_PROUD_JITTER_SHARE = 0.35;
/** Share of stations that cross to the lit flank instead of the shaded one. */
const SUCKER_DORSAL_SHARE = 0.24;
const SUCKER_SEED = 5477;
const SUCKER_STEP_DRAW = 1;
const SUCKER_SIZE_DRAW = 2;
const SUCKER_KIND_DRAW = 3;
const SUCKER_TONE_DRAW = 4;
const SUCKER_PHASE_DRAW = 5;
const SUCKER_TILT_DRAW = 6;
const SUCKER_ACROSS_DRAW = 7;
const SUCKER_PROUD_DRAW = 8;
const SUCKER_BAND_DRAW = 9;
const SUCKER_FLANK_DRAW = 10;

type SuckerKind = 'pit' | 'eye' | 'gash';

interface SuckerStation {
  readonly centre: Pt;
  readonly angle: number;
  readonly radius: number;
  readonly kind: SuckerKind;
  readonly tilt: number;
  readonly proud: boolean;
  readonly seed: number;
}

/**
 * Walks the ventral line once and settles every station on it, so the flush
 * pass and the proud pass are looking at the same suckers.
 */
function suckerStations(spine: TentacleSpine, spec: TentacleSpec): SuckerStation[] {
  const count = Math.max(2, Math.round(spec.length * SUCKERS_PER_TILE));
  const step = (SUCKER_END_T - SUCKER_START_T) / (count - 1);
  const eyeShare = SUCKER_EYE_SHARE * (1 - clamp01(spec.solitary));
  const stations: SuckerStation[] = [];
  let t = SUCKER_START_T;
  for (let i = 0; i < count && t <= SUCKER_END_T; i++) {
    const seed = spec.seed + SUCKER_SEED + i * MOUTH_SEED_STRIDE;
    const sample = sampleSpine(spine, t);
    const tight = hash1(seed + SUCKER_BAND_DRAW) < SUCKER_TIGHT_SHARE;
    t +=
      step *
      hashRange(
        seed + SUCKER_STEP_DRAW,
        tight ? SUCKER_TIGHT_STEP_MIN : SUCKER_GAP_STEP_MIN,
        tight ? SUCKER_TIGHT_STEP_MAX : SUCKER_GAP_STEP_MAX,
      );
    const kind = hash1(seed + SUCKER_KIND_DRAW);
    const proud =
      kind >= eyeShare + SUCKER_GASH_SHARE && hash1(seed + SUCKER_PROUD_DRAW) < SUCKER_PROUD_SHARE;
    // The ventral rows sit on the shaded side of the tube, away from the key
    // light — that is what makes the tentacle read as a rolled cylinder. A
    // quarter of them cross to the lit flank all the same: a row that never
    // leaves one side is a line down an edge, and it leaves the other edge of
    // the limb perfectly smooth.
    const flank = hash1(seed + SUCKER_FLANK_DRAW) < SUCKER_DORSAL_SHARE ? 1 : -1;
    const n = normalAt(sample.angle, flank * litSide(sample.angle));
    const inset =
      (proud ? SUCKER_PROUD_INSET : SUCKER_INSET) +
      hashRange(seed + SUCKER_ACROSS_DRAW, -SUCKER_LATERAL_JITTER, SUCKER_LATERAL_JITTER) *
        (proud ? SUCKER_PROUD_JITTER_SHARE : 1);
    const flex = 1 + Math.sin(spec.wavePhase + i) * SUCKER_FLEX;
    stations.push({
      centre: pt(
        sample.point.x + n.x * sample.width * inset,
        sample.point.y + n.y * sample.width * inset,
      ),
      angle: sample.angle,
      radius:
        sample.width *
        SUCKER_RADIUS_SHARE *
        flex *
        hashRange(seed + SUCKER_SIZE_DRAW, SUCKER_SIZE_MIN, SUCKER_SIZE_MAX),
      kind: kind < eyeShare ? 'eye' : kind < eyeShare + SUCKER_GASH_SHARE ? 'gash' : 'pit',
      tilt: hashRange(seed + SUCKER_TILT_DRAW, -TENTACLE_EYE_TILT, TENTACLE_EYE_TILT),
      proud,
      seed,
    });
  }
  return stations;
}

/**
 * One sucker, drawn as a hole rather than as a disc.
 *
 * The last bake drew a pale ring with a dark centre, which is exactly what an
 * eye is: a light annulus round a dark middle. Seven of them across one frame
 * made the eyes and the suckers one motif, and a motif repeated is read as
 * pattern. A sucker here is a recess — a lit lip on the upper edge, a dark cup
 * under it, a near-black hole in the middle — so it lands in a different value
 * class from every eye on her and cannot be mistaken for one.
 */
function paintSuckerPit(ctx: Ctx, station: SuckerStation, shade: number): void {
  const r = station.radius;
  if (r <= 0) return;
  const squash = r * VENTRAL_SUCKER_SQUASH;
  fillEllipse(
    ctx,
    pt(station.centre.x, station.centre.y - squash * SUCKER_LIP_LIFT),
    r,
    squash,
    rgba(mix(VENTRAL.mid, INK, shade), SUCKER_LIP_ALPHA),
  );
  fillEllipse(
    ctx,
    station.centre,
    r,
    squash,
    rgba(mix(VENTRAL.dark, INK, SUCKER_CUP_TINT + shade), SUCKER_PIT_ALPHA),
  );
  fillEllipse(
    ctx,
    station.centre,
    r * SUCKER_PIT_SHARE,
    squash * SUCKER_PIT_SHARE,
    rgba(FLESH_DEEP, SUCKER_HOLE_ALPHA),
  );
}

/** The suckers, eyes and splits that sit inside the tube's own outline. */
function paintFlushSuckers(ctx: Ctx, stations: readonly SuckerStation[], spec: TentacleSpec): void {
  const shade = tubeShade(spec);
  for (const station of stations) {
    if (station.proud) continue;
    if (station.kind === 'eye') {
      paintEyeball(ctx, {
        centre: station.centre,
        rx: station.radius * SUCKER_EYE_RADIUS_SHARE,
        ry: station.radius * SUCKER_EYE_RADIUS_SHARE * VENTRAL_SUCKER_SQUASH,
        tilt: station.angle + station.tilt,
        gaze: hashRange(station.seed + SUCKER_TONE_DRAW, -TENTACLE_EYE_GAZE, TENTACLE_EYE_GAZE),
        lid: hashRange(station.seed + SUCKER_PHASE_DRAW, 0, TENTACLE_EYE_LID_MAX),
        inkWidth: SMALL_EYE_INK_WIDTH,
        depth: spec.depth,
        form: eyeFormAt(station.seed + SUCKER_TILT_DRAW),
      });
      continue;
    }
    if (station.kind === 'gash') {
      paintMouth(ctx, {
        centre: station.centre,
        angle: station.angle + station.tilt,
        half: station.radius * SUCKER_GASH_HALF_SHARE,
        open: mouthOpenAt(
          spec.mouthCycle + hash1(station.seed + SUCKER_PHASE_DRAW) * spec.mouthSpread,
        ),
        depth: spec.depth,
        seed: station.seed + SUCKER_TONE_DRAW,
      });
      continue;
    }
    paintSuckerPit(ctx, station, shade);
  }
}

/** The suckers that stand out through the outline and change the silhouette. */
function paintProudSuckers(ctx: Ctx, stations: readonly SuckerStation[], spec: TentacleSpec): void {
  const shade = tubeShade(spec);
  for (const station of stations) {
    if (!station.proud) continue;
    const squash = station.radius * VENTRAL_SUCKER_SQUASH;
    fillEllipse(ctx, station.centre, station.radius, squash, fleshAt(shade));
    traceEllipse(ctx, station.centre, station.radius, squash);
    ctx.strokeStyle = INK;
    ctx.lineWidth = TENTACLE_INK_WIDTH;
    ctx.stroke();
    paintSuckerPit(ctx, station, shade);
  }
}

const VENTRAL_SUCKER_SQUASH = 0.78;
const SUCKER_PIT_SHARE = 0.5;
const SUCKER_LIP_LIFT = 0.28;
const SUCKER_CUP_TINT = 0.3;

const VENTRAL_BAND_INSET = 0.55;
const VENTRAL_BAND_ALPHA = 0.4;
const VENTRAL_BAND_WIDTH_SHARE = 0.7;
const SPECULAR_INSET = 0.52;
const SPECULAR_WIDTH_SHARE = 0.24;
/**
 * The near-black band along the unlit flank of every tube.
 *
 * The heap only reads as a heap if the limbs underneath are darker than the
 * limbs on top, and the first bake had nothing in its range dark enough to do
 * that: the shaded side of a tentacle was the same value as the lit side of the
 * one behind it, so twelve limbs stacked up as one pink field.
 */
const DEEP_SHADE_INSET = 0.86;
const DEEP_SHADE_ALPHA = 0.58;
const DEEP_SHADE_WIDTH_SHARE = 0.42;
/**
 * The broad shaded flank a tube standing on its own has to paint for itself.
 *
 * `DEEP_SHADE` above is a hairline pinned to the very edge. That is enough to
 * roll a limb already sitting in a heap's shadow, and it is nothing at all on a
 * tube alone in an empty frame: what came out was one flat pink field with a
 * dark line down one side of it. This is the wide soft half of the cylinder, so
 * the value runs lit edge → midtone → dark edge across the girth instead of
 * being constant right up to the ink.
 */
const CORE_SHADE_INSET = 0.4;
const CORE_SHADE_ALPHA = 0.32;
const CORE_SHADE_WIDTH_SHARE = 1.2;
/**
 * The pocket of shadow where a lone tube goes down into the floor it came up
 * through. Fades out over the first sixth of the limb.
 */
const ROOT_OCCLUSION_T = 0.13;
const ROOT_OCCLUSION_ALPHA = 0.12;
const ROOT_OCCLUSION_STEPS = 10;
const ROOT_OCCLUSION_SPREAD = 0.9;

/**
 * The modelling a tentacle that is its own subject has to carry, laid down
 * inside the tube's clip before the ventral and lit bands roll over it.
 */
function paintSolitaryVolume(ctx: Ctx, spine: TentacleSpine, spec: TentacleSpec): void {
  const strength = clamp01(spec.solitary);
  if (strength <= 0) return;
  strokeRolledEdge(
    ctx,
    spine,
    CORE_SHADE_INSET,
    FLESH.dark,
    CORE_SHADE_ALPHA * strength,
    spec.baseWidth * CORE_SHADE_WIDTH_SHARE,
    -1,
  );
  for (let i = 0; i < ROOT_OCCLUSION_STEPS; i++) {
    const along = (i / ROOT_OCCLUSION_STEPS) * ROOT_OCCLUSION_T;
    const sample = sampleSpine(spine, along);
    const fade = 1 - i / ROOT_OCCLUSION_STEPS;
    const radius = sample.width * ROOT_OCCLUSION_SPREAD;
    fillEllipse(
      ctx,
      sample.point,
      radius,
      radius,
      rgba(FLESH_DEEP, ROOT_OCCLUSION_ALPHA * fade * strength),
    );
  }
}
const LIT_BAND_INSET = 0.34;
const LIT_BAND_ALPHA = 0.34;
const LIT_BAND_WIDTH_SHARE = 0.55;
const LIT_BAND_GAP_SHARE = 0.3;
const LIT_BAND_GAP_SEED = 1493;
const LIT_BAND_LAYERS = 3;
const EDGE_GAP_SEED_STRIDE = 31;
const RIM_GAP_SEED = 271;
const SPECULAR_GAP_SEED = 733;
const TENTACLE_INK_WIDTH = 0.016;
const MOTTLE_PER_TILE = 15;
const MOTTLE_ALPHA = 0.27;
const MOTTLE_RADIUS_SHARE = 0.34;

function paintMottling(ctx: Ctx, spine: TentacleSpine, spec: TentacleSpec): void {
  const count = Math.max(1, Math.round(spec.length * MOTTLE_PER_TILE));
  ctx.fillStyle = rgba(FLESH.dark, MOTTLE_ALPHA);
  for (let i = 0; i < count; i++) {
    const t = hash1(spec.seed + i);
    const sample = sampleSpine(spine, t);
    const across = hash1(spec.seed + i + MOTTLE_ACROSS_SEED) * 2 - 1;
    const n = normalAt(sample.angle, 1);
    const centre = pt(
      sample.point.x + n.x * sample.width * across,
      sample.point.y + n.y * sample.width * across,
    );
    const r =
      sample.width *
      MOTTLE_RADIUS_SHARE *
      hashRange(spec.seed + i + MOTTLE_SIZE_SEED, MOTTLE_SIZE_MIN, MOTTLE_SIZE_MAX);
    traceEllipse(ctx, centre, r, r);
    ctx.fill();
  }
}

const MOTTLE_ACROSS_SEED = 311;
const MOTTLE_SIZE_SEED = 977;
const MOTTLE_SIZE_MIN = 0.5;
const MOTTLE_SIZE_MAX = 1.5;
const MOUTH_FIRST_T = 0.16;
const MOUTH_LAST_T = 0.88;
const MOUTH_SEED_STRIDE = 7;

/**
 * Where the gashes fall along one limb.
 *
 * Walked rather than divided: a clump of two or three splits crowded together,
 * then an irregular stretch of unbroken flesh, then the next clump. Dividing
 * the span evenly — which is what the first bake did — turns the horror into a
 * bead pattern, and a pattern is read as decoration.
 */
const MOUTH_CLUSTER_MAX = 3;
const MOUTH_CLUSTER_STEP = 0.075;
const MOUTH_CLUSTER_STEP_MIN = 0.7;
const MOUTH_CLUSTER_STEP_MAX = 1.5;
const MOUTH_GAP_MIN = 0.13;
const MOUTH_GAP_MAX = 0.33;
const MOUTH_START_SPAN = 0.14;
/** How far off the limb's centre line a gash may sit, as a share of its width. */
const MOUTH_ACROSS = 0.42;
/**
 * How far one gash may turn off the limb's own line, and how far its length may
 * run from the nominal.
 *
 * A 2.1× span of sizes inside a ±0.7 rad fan is not enough separation when the
 * same painter is called thirty times in one frame: what a viewer finds is one
 * slash motif stamped over the arms at what looks like a single size and angle,
 * which reads as a printed rash rather than as thirty separate injuries. Four
 * times in size and most of a half-turn in angle is what stops the repeats
 * grouping.
 */
const MOUTH_TILT = 1.25;
const MOUTH_SIZE_MIN = 0.42;
const MOUTH_SIZE_MAX = 1.8;
const MOUTH_START_SEED = 31;
const MOUTH_CLUSTER_SEED = 67;
const MOUTH_GAP_SEED = 89;
const MOUTH_STATION_SEED = 127;

/**
 * Which draw off a station's own seed each of its values takes.
 *
 * `hash1` scrambles a number rather than running a stream, so two values wanted
 * off one seed have to ask at different offsets or they come back identical.
 */
const STATION_TILT_DRAW = 1;
const STATION_SCALE_DRAW = 2;
const STATION_PHASE_DRAW = 3;
const STATION_STEP_DRAW = 4;

interface MouthStation {
  readonly t: number;
  /** Offset across the tube, as a share of the local half-width. */
  readonly across: number;
  readonly tilt: number;
  readonly scale: number;
  readonly phase: number;
  readonly seed: number;
}

function mouthStations(spec: TentacleSpec): MouthStation[] {
  const stations: MouthStation[] = [];
  let t = MOUTH_FIRST_T + hash1(spec.seed + MOUTH_START_SEED) * MOUTH_START_SPAN;
  let placed = 0;
  while (placed < spec.mouths && t <= MOUTH_LAST_T) {
    const clumpSeed = spec.seed + placed * MOUTH_SEED_STRIDE;
    const clump = 1 + Math.floor(hash1(clumpSeed + MOUTH_CLUSTER_SEED) * MOUTH_CLUSTER_MAX);
    for (let i = 0; i < clump && placed < spec.mouths && t <= MOUTH_LAST_T; i++) {
      const seed = spec.seed + placed * MOUTH_SEED_STRIDE + MOUTH_STATION_SEED;
      stations.push({
        t,
        across: hashRange(seed, -MOUTH_ACROSS, MOUTH_ACROSS),
        tilt: hashRange(seed + STATION_TILT_DRAW, -MOUTH_TILT, MOUTH_TILT),
        scale: hashRange(seed + STATION_SCALE_DRAW, MOUTH_SIZE_MIN, MOUTH_SIZE_MAX),
        phase: hash1(seed + STATION_PHASE_DRAW) * spec.mouthSpread,
        seed,
      });
      placed++;
      t +=
        MOUTH_CLUSTER_STEP *
        hashRange(seed + STATION_STEP_DRAW, MOUTH_CLUSTER_STEP_MIN, MOUTH_CLUSTER_STEP_MAX);
    }
    t += hashRange(clumpSeed + MOUTH_GAP_SEED, MOUTH_GAP_MIN, MOUTH_GAP_MAX);
  }
  return stations;
}

const TENTACLE_EYE_FIRST_T = 0.14;
const TENTACLE_EYE_LAST_T = 0.72;
const TENTACLE_EYE_ACROSS = 0.34;
const TENTACLE_EYE_SIZE_SHARE = 0.62;
const TENTACLE_EYE_WIDTH_LIMIT = 0.62;
const TENTACLE_EYE_SIZE_MIN = 0.7;
const TENTACLE_EYE_SIZE_MAX = 1.3;
const TENTACLE_EYE_SQUASH_MIN = 0.68;
const TENTACLE_EYE_LID_MAX = 0.5;
const TENTACLE_EYE_GAZE = 0.7;
const TENTACLE_EYE_TILT = 1.1;
const TENTACLE_EYE_SEED = 419;
const TENTACLE_EYE_SEED_STRIDE = 23;

/** Which draw off one scattered eye's seed each of its dimensions takes. */
const EYE_ACROSS_DRAW = 1;
const EYE_SIZE_DRAW = 2;
const EYE_SQUASH_DRAW = 3;
const EYE_TILT_DRAW = 4;
const EYE_GAZE_DRAW = 5;
const EYE_LID_DRAW = 6;
const EYE_GAZE_BIAS_DRAW = 7;
const EYE_BLINK_SHARE_DRAW = 8;
const EYE_FORM_DRAW = 9;

/**
 * The shared flesh painter. Every tentacle in the fight — the boss's thirteen,
 * the guard, the slam — is painted by this one function.
 */
export function paintTentacle(ctx: Ctx, spec: TentacleSpec): void {
  const spine = buildTentacleSpine(spec);
  const outline = tentacleOutline(spine, spec);
  const stations = suckerStations(spine, spec);

  tracePolygon(ctx, outline);
  ctx.fillStyle = fleshAt(tubeShade(spec));
  ctx.fill();

  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();

  paintSolitaryVolume(ctx, spine, spec);
  strokeRolledEdge(
    ctx,
    spine,
    DEEP_SHADE_INSET,
    FLESH_DEEP,
    DEEP_SHADE_ALPHA,
    spec.baseWidth * DEEP_SHADE_WIDTH_SHARE,
    -1,
  );
  strokeRolledEdge(
    ctx,
    spine,
    VENTRAL_BAND_INSET,
    VENTRAL.mid,
    VENTRAL_BAND_ALPHA * (1 - spec.depth),
    spec.baseWidth * VENTRAL_BAND_WIDTH_SHARE,
    -1,
  );
  // Local colour, not a sheen: the flesh on the side the light reaches is a
  // lighter pink, which is what gives a tube its roll without a traced
  // highlight down it. Broken up all the same, because an unbroken band is a
  // highlight however it is coloured.
  // Laid down as narrowing layers rather than as one stroke: a single band of
  // constant alpha has a hard edge down the middle of the tube, which cel-shades
  // it into two flat halves — the exact plastic read the whole rework is against.
  for (let layer = 0; layer < LIT_BAND_LAYERS; layer++) {
    const narrowing = 1 - layer / LIT_BAND_LAYERS;
    strokeRolledEdge(
      ctx,
      spine,
      LIT_BAND_INSET,
      FLESH.light,
      (LIT_BAND_ALPHA / LIT_BAND_LAYERS) * (1 - spec.depth),
      spec.baseWidth * LIT_BAND_WIDTH_SHARE * narrowing,
      1,
      LIT_BAND_GAP_SHARE,
      spec.seed + LIT_BAND_GAP_SEED + layer,
    );
  }
  paintFlushSuckers(ctx, stations, spec);
  paintMottling(ctx, spine, spec);
  strokeRolledEdge(
    ctx,
    spine,
    SPECULAR_INSET,
    SPECULAR,
    SPECULAR_ALPHA * (1 - spec.depth),
    spec.baseWidth * SPECULAR_WIDTH_SHARE,
    1,
    0,
    0,
    specularWindows(spec.seed + SPECULAR_GAP_SEED),
  );
  ctx.restore();

  tracePolygon(ctx, outline);
  ctx.strokeStyle = INK;
  ctx.lineWidth = TENTACLE_INK_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();

  strokeRolledEdge(
    ctx,
    spine,
    1,
    RIM_LIGHT,
    RIM_ALPHA * (1 - spec.depth),
    RIM_WIDTH,
    1,
    RIM_GAP_SHARE,
    spec.seed + RIM_GAP_SEED,
  );

  paintProudSuckers(ctx, stations, spec);

  if (spec.stump) paintStumpWound(ctx, spine, spec);
  if (spec.splay > 0) paintTipSplay(ctx, spine, spec);

  for (const station of mouthStations(spec)) {
    const sample = sampleSpine(spine, station.t);
    const n = normalAt(sample.angle, 1);
    paintMouth(ctx, {
      centre: pt(
        sample.point.x + n.x * sample.width * station.across,
        sample.point.y + n.y * sample.width * station.across,
      ),
      angle: sample.angle + station.tilt,
      half: Math.min(spec.mouthSize * station.scale, sample.width * MOUTH_WIDTH_LIMIT_SHARE),
      open: mouthOpenAt(spec.mouthCycle + station.phase),
      depth: spec.depth,
      seed: station.seed,
    });
  }

  for (let i = 0; i < spec.eyes; i++) {
    const seed = spec.seed + TENTACLE_EYE_SEED + i * TENTACLE_EYE_SEED_STRIDE;
    const sample = sampleSpine(spine, hashRange(seed, TENTACLE_EYE_FIRST_T, TENTACLE_EYE_LAST_T));
    const n = normalAt(sample.angle, 1);
    const across = hashRange(seed + EYE_ACROSS_DRAW, -TENTACLE_EYE_ACROSS, TENTACLE_EYE_ACROSS);
    const rx =
      Math.min(spec.mouthSize * TENTACLE_EYE_SIZE_SHARE, sample.width * TENTACLE_EYE_WIDTH_LIMIT) *
      hashRange(seed + EYE_SIZE_DRAW, TENTACLE_EYE_SIZE_MIN, TENTACLE_EYE_SIZE_MAX);
    paintEyeball(ctx, {
      centre: pt(
        sample.point.x + n.x * sample.width * across,
        sample.point.y + n.y * sample.width * across,
      ),
      rx,
      ry: rx * hashRange(seed + EYE_SQUASH_DRAW, TENTACLE_EYE_SQUASH_MIN, 1),
      tilt: sample.angle + hashRange(seed + EYE_TILT_DRAW, -TENTACLE_EYE_TILT, TENTACLE_EYE_TILT),
      gaze: hashRange(seed + EYE_GAZE_DRAW, -TENTACLE_EYE_GAZE, TENTACLE_EYE_GAZE),
      lid: hashRange(seed + EYE_LID_DRAW, 0, TENTACLE_EYE_LID_MAX),
      inkWidth: SMALL_EYE_INK_WIDTH,
      depth: spec.depth,
      form:
        spec.solitary > 0 ? soloEyeFormAt(seed + EYE_FORM_DRAW) : eyeFormAt(seed + EYE_FORM_DRAW),
    });
  }
}

/**
 * The torn end of a limb that has lost its tip.
 *
 * A knot of small splits rather than one big one. A single gash gaping at full
 * open across a flat cap draws its raw border as a ring of spikes round a dark
 * centre — a red starburst, which reads as a splash decal stuck on the limb
 * rather than as an injury to it. Three overlapping tears at different sizes and
 * angles have no radial symmetry for the eye to lock onto.
 */
function paintStumpWound(ctx: Ctx, spine: TentacleSpine, spec: TentacleSpec): void {
  const last = spine.points.length - 1;
  paintMouthCluster(ctx, {
    centre: spine.points[last],
    angle: spine.angles[last] + Math.PI / 2,
    count: STUB_WOUND_TEARS,
    size: spine.widths[last] * STUB_WOUND_SHARE,
    spread: spine.widths[last] * STUB_WOUND_SPREAD_SHARE,
    mouthCycle: spec.mouthCycle,
    mouthSpread: spec.mouthSpread,
    depth: spec.depth,
    seed: spec.seed + STUB_WOUND_SEED,
  });
}

const SPLAY_TIP_T = 0.9;
const SPLAY_WIDTH_SHARE = 0.55;
const SPLAY_WAVE = 0.8;
const SPLAY_WAVE_CYCLES = 1.4;

/**
 * The fan of sub-tendrils the slam tentacle throws out as it hits. Drawn as
 * ordinary tentacles with no mouths and no splay of their own, so they carry
 * the same suckers and the same rim as the trunk they grow from.
 */
function paintTipSplay(ctx: Ctx, spine: TentacleSpine, spec: TentacleSpec): void {
  const sample = sampleSpine(spine, SPLAY_TIP_T);
  for (let i = 0; i < SLAM_SPLAY_TENDRILS; i++) {
    const across = i / (SLAM_SPLAY_TENDRILS - 1) - CENTRE;
    paintTentacle(ctx, {
      root: sample.point,
      baseAngle: sample.angle + across * SLAM_SPLAY_ARC * spec.splay,
      length: SLAM_SPLAY_LENGTH * spec.splay,
      baseWidth: sample.width * SPLAY_WIDTH_SHARE,
      tipWidth: spec.tipWidth * SPLAY_WIDTH_SHARE,
      curl: across * SLAM_SPLAY_ARC * spec.splay,
      curlBias: 1,
      // Fronds scrabbling on the floor, not four rods bolted to a tip. The
      // phase comes off the trunk's own wave phase, which advances across the
      // smash row, so the fan keeps moving through the frames after the hit
      // where nothing else in the pose changes at all.
      wave: Math.sin(spec.wavePhase * SPLAY_WAVE_CYCLES + i) * SPLAY_WAVE,
      waveCycles: SPLAY_WAVE_CYCLES,
      wavePhase: spec.wavePhase + i,
      taperPower: spec.taperPower,
      depth: spec.depth,
      seed: spec.seed + i,
      mouths: 0,
      eyes: 0,
      mouthSize: 0,
      mouthCycle: 0,
      mouthSpread: 0,
      splay: 0,
      stump: false,
      solitary: spec.solitary,
    });
  }
}

// ── Mouths ───────────────────────────────────────────────────────────────────

/** How much of the local tube width one mouth is allowed to take. */
const MOUTH_WIDTH_LIMIT_SHARE = 0.85;

/**
 * A mouth on this creature is a split in the flesh, not a face's mouth.
 *
 * The first bake drew lips: a cupid's bow, a smooth symmetric curve, a wet
 * catchlight on the lower lip. A row of those down a tentacle read as a
 * decorative motif rather than as damage, and read as *human*, which is the one
 * thing they must not do. What is drawn now is a fissure — two independently
 * ragged edges pinned at two corners, a border of raw flesh torn back from the
 * split, a wet dark throat, and teeth that agree on neither length nor angle
 * nor which edge they grow from.
 *
 * The raw border is also what the bake's mouth-presence gate counts: it is the
 * only deeply saturated red on her, so a change that buries the gashes under
 * flesh takes the pixel count with it.
 */
const GASH_STATIONS = 9;
/**
 * How far off centre the split runs deepest.
 *
 * Drawn per *edge* rather than per gash, so the two edges of one split do not
 * bulge in the same place. A gash with one skew has a mirror axis across its
 * own length; a gash with two has none anywhere.
 */
const GASH_SKEW_MIN = 0.18;
const GASH_SKEW_MAX = 0.52;
/**
 * Near 1 rather than well under it, so the split tapers into a tear at both
 * ends. A low power holds the edge open almost to the corner and leaves a
 * rounded end, which is what makes a wound read as an oval with a lip on it.
 */
const GASH_PROFILE_POWER = 0.95;
/**
 * The pinches that keep a split's perimeter concave.
 *
 * Two stations per edge — four per gash — are pulled almost shut, so the outline
 * has notches in it rather than being a jittered oval. The two draws per edge
 * are forced into separate thirds of the run so they cannot land on the same
 * station and leave a gash with only two notches on it.
 */
const GASH_NOTCHES_PER_EDGE = 2;
const GASH_NOTCH_PINCH = 0.16;
const GASH_NOTCH_DRAW = 61;
/**
 * How far one end of a split runs past its nominal half-length, as a share of
 * it. Drawn independently for the two ends, so neither is the other's mirror.
 */
const GASH_END_RUN_MAX = 0.26;
const GASH_END_LEFT_DRAW = 71;
const GASH_END_RIGHT_DRAW = 73;
const GASH_SKEW_DRAW = 79;
const GASH_UPPER_SHARE = 0.3;
const GASH_LOWER_SHARE = 0.24;
/** Shut, the flesh still does not close flush — it is a wound, not a seam. */
const GASH_CLOSED_SHARE = 0.22;
/** Per-station raggedness, as a share of the edge's own depth. */
const GASH_JITTER = 0.55;
const GASH_ALONG_JITTER = 0.055;
/** The band of raw flesh outside the split, as a share of the gash's half-length. */
const GASH_RIM_SHARE = 0.26;
const GASH_RIM_LOWER_SHARE = 0.8;
const GASH_RIM_END_SHARE = 0.12;
const GASH_THROAT_GROW = 1.4;
const GASH_THROAT_ALPHA = 0.75;
const GASH_INK_WIDTH = 0.008;
const GASH_INK_TINT = 0.35;
const GASH_SEED_STRIDE = 17;
const GASH_LOWER_SEED = 211;
const GASH_RIM_SEED = 353;
const GASH_THROAT_SEED = 509;

const TOOTH_MIN_OPEN = 0.18;
const TOOTH_COUNT = 9;
/** Where along the split teeth may root; the corners are too shallow to hold one. */
const TOOTH_SPAN = 0.78;
/**
 * How many of the teeth grow from the upper margin, the rest from the lower.
 *
 * Split by count rather than by a coin toss per tooth. A hashed edge choice
 * leaves whole gashes with every tooth on one margin, which is a cartoon grin:
 * a row of wedges standing on a line. Both margins always bite here.
 */
const TOOTH_UPPER_COUNT = 4;
const TOOTH_ROOT_INSET = 0.92;
const TOOTH_LENGTH_MIN = 0.4;
const TOOTH_LENGTH_MAX = 1.6;
const TOOTH_WIDTH_MIN = 0.04;
const TOOTH_WIDTH_MAX = 0.14;
const TOOTH_LEAN = 0.11;
const TOOTH_SEED_STRIDE = 41;

/** Which draw off one tooth's seed each of its dimensions takes. */
const TOOTH_LENGTH_DRAW = 2;
const TOOTH_WIDTH_DRAW = 3;
const TOOTH_LEAN_DRAW = 4;

interface MouthSpec {
  readonly centre: Pt;
  /** Direction the split runs, in radians. */
  readonly angle: number;
  /** Half the split's length, in tile units. */
  readonly half: number;
  readonly open: number;
  readonly depth: number;
  /** Fixes how this one gash is torn, so a re-bake tears it the same way. */
  readonly seed: number;
}

/** Depth of the split along its own length: zero at both torn ends. */
function gashProfile(u: number, skew: number): number {
  return Math.pow(Math.max(0, 1 - u * u), GASH_PROFILE_POWER) * (1 + skew * u);
}

/** Whether station `i` is one of this edge's two pinched-shut notches. */
function isGashNotch(i: number, seed: number): boolean {
  const perDraw = Math.floor((GASH_STATIONS - 1) / GASH_NOTCHES_PER_EDGE);
  for (let draw = 0; draw < GASH_NOTCHES_PER_EDGE; draw++) {
    const within = Math.floor(hash1(seed + GASH_NOTCH_DRAW + draw) * perDraw);
    if (1 + draw * perDraw + within === i) return true;
  }
  return false;
}

/** How far past its nominal half-length each end of a split tears. */
function gashEnds(seed: number): { readonly left: number; readonly right: number } {
  return {
    left: -1 - hash1(seed + GASH_END_LEFT_DRAW) * GASH_END_RUN_MAX,
    right: 1 + hash1(seed + GASH_END_RIGHT_DRAW) * GASH_END_RUN_MAX,
  };
}

/**
 * One ragged edge of a split, tear to tear. `sign` is -1 for the edge above
 * the line the gash runs along and +1 for the one below.
 */
function gashEdge(half: number, depth: number, sign: number, seed: number): Pt[] {
  const ends = gashEnds(seed);
  const skew = hashRange(seed + GASH_SKEW_DRAW, GASH_SKEW_MIN, GASH_SKEW_MAX) * sign;
  const points: Pt[] = [];
  for (let i = 0; i <= GASH_STATIONS; i++) {
    const u = lerp(ends.left, ends.right, i / GASH_STATIONS);
    const torn = i === 0 || i === GASH_STATIONS;
    const ragged = torn ? 0 : hashRange(seed + i * GASH_SEED_STRIDE, -GASH_JITTER, GASH_JITTER);
    const along = torn
      ? 0
      : hashRange(seed + i * GASH_SEED_STRIDE + 1, -GASH_ALONG_JITTER, GASH_ALONG_JITTER);
    const pinch = !torn && isGashNotch(i, seed) ? GASH_NOTCH_PINCH : 1;
    points.push(pt(half * (u + along), sign * depth * gashProfile(u, skew) * (1 + ragged) * pinch));
  }
  return points;
}

function gashOutline(half: number, upper: number, lower: number, seed: number): Pt[] {
  return [
    ...gashEdge(half, upper, -1, seed),
    ...gashEdge(half, lower, 1, seed + GASH_LOWER_SEED).reverse(),
  ];
}

/**
 * Teeth in the throat of a split.
 *
 * Rooted at hashed positions, at hashed lengths and leans, and always growing
 * from both margins. An evenly spaced band of identical white wedges standing
 * on one line is a cartoon grin; what makes a fissure read as dangerous is that
 * no two of the things growing out of it match and they come from both sides.
 */
function paintTeeth(
  ctx: Ctx,
  half: number,
  upper: number,
  lower: number,
  shade: number,
  seed: number,
): void {
  ctx.fillStyle = mix(TOOTH, INK, shade);
  const upperSkew = hashRange(seed + GASH_SKEW_DRAW, GASH_SKEW_MIN, GASH_SKEW_MAX) * -1;
  const lowerSkew = hashRange(
    seed + GASH_LOWER_SEED + GASH_SKEW_DRAW,
    GASH_SKEW_MIN,
    GASH_SKEW_MAX,
  );
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const own = seed + i * TOOTH_SEED_STRIDE;
    const u = hashRange(own, -TOOTH_SPAN, TOOTH_SPAN);
    const fromUpper = i < TOOTH_UPPER_COUNT;
    const sign = fromUpper ? -1 : 1;
    const edge = (fromUpper ? upper : lower) * gashProfile(u, fromUpper ? upperSkew : lowerSkew);
    const rootY = sign * edge * TOOTH_ROOT_INSET;
    const reach = edge * hashRange(own + TOOTH_LENGTH_DRAW, TOOTH_LENGTH_MIN, TOOTH_LENGTH_MAX);
    const wide = half * hashRange(own + TOOTH_WIDTH_DRAW, TOOTH_WIDTH_MIN, TOOTH_WIDTH_MAX);
    const lean = half * hashRange(own + TOOTH_LEAN_DRAW, -TOOTH_LEAN, TOOTH_LEAN);
    const x = half * u;
    ctx.beginPath();
    ctx.moveTo(x - wide, rootY);
    ctx.lineTo(x + wide, rootY);
    ctx.lineTo(x + lean, rootY - sign * reach);
    ctx.closePath();
    ctx.fill();
  }
}

/** One split in the flesh, wherever it is: body, guard tentacle, slam, or gore. */
export function paintMouth(ctx: Ctx, spec: MouthSpec): void {
  const half = spec.half;
  if (half <= 0) return;
  const open = clamp01(spec.open);
  const shade = clamp01(spec.depth) * DEPTH_SHADE;
  const gape = lerp(GASH_CLOSED_SHARE, 1, open);
  const upper = half * GASH_UPPER_SHARE * gape;
  const lower = half * GASH_LOWER_SHARE * gape;
  const rimBand = half * GASH_RIM_SHARE;

  ctx.save();
  ctx.translate(spec.centre.x, spec.centre.y);
  ctx.rotate(spec.angle);

  const rim = gashOutline(
    half * (1 + GASH_RIM_END_SHARE),
    upper + rimBand,
    lower + rimBand * GASH_RIM_LOWER_SHARE,
    spec.seed + GASH_RIM_SEED,
  );
  tracePolygon(ctx, rim);
  ctx.fillStyle = mix(RAW_FLESH.mid, INK, shade);
  ctx.fill();
  ctx.strokeStyle = mix(INK, RAW_FLESH.dark, GASH_INK_TINT);
  ctx.lineWidth = GASH_INK_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // A darker ring of undercut flesh between the raw border and the throat, so
  // the split has a depth to it rather than being a red patch with a hole.
  tracePolygon(
    ctx,
    gashOutline(
      half,
      upper * GASH_THROAT_GROW,
      lower * GASH_THROAT_GROW,
      spec.seed + GASH_THROAT_SEED,
    ),
  );
  ctx.fillStyle = rgba(RAW_FLESH.dark, GASH_THROAT_ALPHA);
  ctx.fill();

  tracePolygon(ctx, gashOutline(half, upper, lower, spec.seed));
  ctx.fillStyle = mix(MAW, INK, shade);
  ctx.fill();

  // No wet catchlight in the throat. A specular blob inside a mouth is what
  // makes a drawn mouth read as a *mouth* — it is the cue for a tongue behind a
  // lower lip — and it was the last thing keeping these splits cartoonish.
  ctx.save();
  ctx.clip();
  if (open > TOOTH_MIN_OPEN) paintTeeth(ctx, half, upper, lower, shade, spec.seed);
  ctx.restore();

  ctx.restore();
}

/**
 * A knot of splits in one patch of flesh — the guard tentacle's tip, and
 * anywhere else a single gash is too small to carry the read.
 */
export interface MouthClusterSpec {
  readonly centre: Pt;
  readonly angle: number;
  readonly count: number;
  /** Half-length of the largest mouth in the cluster. */
  readonly size: number;
  /** How far the cluster's mouths scatter from its centre, in tile units. */
  readonly spread: number;
  readonly mouthCycle: number;
  readonly mouthSpread: number;
  readonly depth: number;
  readonly seed: number;
}

const CLUSTER_SIZE_FLOOR = 0.42;
const CLUSTER_ANGLE_JITTER = 1.3;
const CLUSTER_AROUND_JITTER = 0.9;
const CLUSTER_REACH_FLOOR = 0.35;
const CLUSTER_SEED_STRIDE = 13;
const CLUSTER_ANGLE_SEED = 2;
const CLUSTER_SIZE_SEED = 3;
const CLUSTER_PHASE_SEED = 4;
const CLUSTER_MOUTH_SEED = 5;

export function paintMouthCluster(ctx: Ctx, spec: MouthClusterSpec): void {
  for (let i = 0; i < spec.count; i++) {
    const seed = spec.seed + i * CLUSTER_SEED_STRIDE;
    const around = (i / spec.count) * TWO_PI + hash1(seed) * CLUSTER_AROUND_JITTER;
    const reach = spec.spread * (i === 0 ? 0 : hashRange(seed + 1, CLUSTER_REACH_FLOOR, 1));
    const centre = pt(
      spec.centre.x + Math.cos(around) * reach,
      spec.centre.y + Math.sin(around) * reach,
    );
    paintMouth(ctx, {
      centre,
      // Free of the patch's own axis: gashes that all run the same way across a
      // knot of flesh line up into a grille.
      angle:
        spec.angle +
        hashRange(seed + CLUSTER_ANGLE_SEED, -CLUSTER_ANGLE_JITTER, CLUSTER_ANGLE_JITTER),
      half: spec.size * hashRange(seed + CLUSTER_SIZE_SEED, CLUSTER_SIZE_FLOOR, 1),
      open: mouthOpenAt(spec.mouthCycle + hash1(seed + CLUSTER_PHASE_SEED) * spec.mouthSpread),
      depth: spec.depth,
      seed: seed + CLUSTER_MOUTH_SEED,
    });
  }
}

// ── Eyes ─────────────────────────────────────────────────────────────────────

/**
 * The iris takes half the eye, not two thirds.
 *
 * At a 32 px tile an iris that fills its eye is a yellow bean, and a dozen of
 * those scattered over pink flesh read as eggs stuck to her. The white either
 * side of the bar pupil is what makes the shape an eye.
 */
const IRIS_SHARE = 0.5;
const PUPIL_WIDTH_SHARE = 0.9;
const PUPIL_HEIGHT_SHARE = 0.42;
const EYE_GAZE_TRAVEL = 0.3;
const EYE_GLINT_SHARE = 0.16;
const EYE_GLINT_X = -0.3;
const EYE_GLINT_Y = -0.35;
const EYE_GLINT_ALPHA = 0.42;
const LID_ALPHA = 1;
const PRIMARY_EYE_INK_WIDTH = 0.014;
const SMALL_EYE_INK_WIDTH = 0.009;

/**
 * What state one of her eyes is in.
 *
 * Every eye on the first bake was the same token — a yellow ring with a black
 * bar in it — repeated a dozen times over her flesh, and a token repeated a
 * dozen times is read as a *pattern*: polka dots, not eyes. Nearly half of them
 * are now something that has gone wrong with an eye instead, so the count reads
 * as a disease rather than as decoration.
 */
type EyeForm =
  | 'seeing'
  /** Filmed over: no iris, no pupil, no gleam. */
  | 'clouded'
  /** Burst: the globe has collapsed into the wound it sat in. */
  | 'ruptured'
  /** Almost shut, whatever the pose's blink is doing. */
  | 'lidded'
  /**
   * A tall slit pupil in a wide iris, rather than the horizontal bar the rest
   * of her carries.
   *
   * The bar pupil is the cephalopod cue and most of her keeps it, but a token
   * repeated at every size across a body is read as a *motif*, and a motif is
   * decoration. One eye in five turning its pupil through ninety degrees is
   * what stops the count from resolving into a pattern.
   */
  | 'slit';

const EYE_CLOUDED_SHARE = 0.2;
const EYE_RUPTURED_SHARE = 0.13;
const EYE_LIDDED_SHARE = 0.11;
const EYE_SLIT_SHARE = 0.18;
const SLIT_PUPIL_WIDTH_SHARE = 0.24;
const SLIT_PUPIL_HEIGHT_SHARE = 1.15;
const SLIT_IRIS_GROW = 1.3;
const EYE_SHUT_LID = 0.84;
const CLOUD_TINT = 0.62;
const CLOUD_BLOT_SHARE = 0.34;
const CLOUD_BLOT_ALPHA = 0.4;
const RUPTURE_TINT = 0.28;
const RUPTURE_PIT_SHARE = 0.46;
const RUPTURE_FLAP_SHARE = 0.7;
const RUPTURE_FLAP_ALPHA = 0.75;

/** Which form an eye seeded on `seed` takes. */
function eyeFormAt(seed: number): EyeForm {
  const roll = hash1(seed);
  let floor = EYE_CLOUDED_SHARE;
  if (roll < floor) return 'clouded';
  floor += EYE_RUPTURED_SHARE;
  if (roll < floor) return 'ruptured';
  floor += EYE_LIDDED_SHARE;
  if (roll < floor) return 'lidded';
  floor += EYE_SLIT_SHARE;
  if (roll < floor) return 'slit';
  return 'seeing';
}

/**
 * The only two forms an eye on a lone tentacle may take.
 *
 * Half her eyes have gone wrong, and against a dome wearing eyes at five sizes
 * a clouded or burst one still reads as an eye — that is what the count is for.
 * A guard tentacle carries two and the slam three, set in a row of dark sucker
 * pits, and a clouded eye there is a pale blank disc: exactly the thing the pits
 * were re-cut as recesses to stop being mistaken for. What has to survive on a
 * lone limb is the iris.
 */
function soloEyeFormAt(seed: number): EyeForm {
  return hash1(seed) < EYE_SLIT_SHARE ? 'slit' : 'seeing';
}

/**
 * One eye anywhere on her.
 *
 * The same painter does the two large ones on the mantle and every small one
 * scattered over flesh that has no business carrying an eye, so a player who
 * notices the third or ninth of them recognises it as the same organ rather
 * than as a spot.
 */
interface EyeballSpec {
  readonly centre: Pt;
  readonly rx: number;
  readonly ry: number;
  /** How far the eye is rolled out of level, in radians. */
  readonly tilt: number;
  /** Where the iris sits across the eye, -1 to 1. */
  readonly gaze: number;
  /** 0 open, 1 shut; the lid comes down from the top. */
  readonly lid: number;
  readonly inkWidth: number;
  readonly depth: number;
  readonly form: EyeForm;
}

function paintEyeball(ctx: Ctx, spec: EyeballSpec): void {
  const { rx, ry } = spec;
  if (rx <= 0 || ry <= 0) return;
  const shade = clamp01(spec.depth) * DEPTH_SHADE;
  const origin = pt(0, 0);

  ctx.save();
  ctx.translate(spec.centre.x, spec.centre.y);
  ctx.rotate(spec.tilt);

  if (spec.form === 'ruptured') {
    fillEllipse(ctx, origin, rx, ry, mix(RAW_FLESH.dark, INK, RUPTURE_TINT + shade));
    fillEllipse(ctx, origin, rx * RUPTURE_PIT_SHARE, ry * RUPTURE_PIT_SHARE, mix(MAW, INK, shade));
    fillEllipse(
      ctx,
      pt(rx * EYE_GLINT_X, ry * EYE_GLINT_Y),
      rx * RUPTURE_FLAP_SHARE,
      ry * RUPTURE_FLAP_SHARE * CLOUD_BLOT_SHARE,
      rgba(RAW_FLESH.mid, RUPTURE_FLAP_ALPHA),
    );
  } else {
    fillEllipse(ctx, origin, rx, ry, mix(SCLERA, INK, shade));
    if (spec.form === 'clouded') {
      fillEllipse(ctx, origin, rx, ry, rgba(mix(SCLERA, VENTRAL.mid, CLOUD_TINT), LID_ALPHA));
      fillEllipse(
        ctx,
        pt(rx * EYE_GAZE_TRAVEL * spec.gaze, 0),
        rx * CLOUD_BLOT_SHARE,
        ry * CLOUD_BLOT_SHARE,
        rgba(PUPIL, CLOUD_BLOT_ALPHA),
      );
    } else {
      const irisCentre = pt(rx * EYE_GAZE_TRAVEL * spec.gaze, 0);
      const slit = spec.form === 'slit';
      const irisShare = IRIS_SHARE * (slit ? SLIT_IRIS_GROW : 1);
      fillEllipse(ctx, irisCentre, rx * irisShare, ry * irisShare, mix(IRIS, INK, shade));
      // A horizontal bar pupil. It is the single cue that says cephalopod rather
      // than mammal, and it survives the downscale where an iris pattern does not.
      fillEllipse(
        ctx,
        irisCentre,
        rx * irisShare * (slit ? SLIT_PUPIL_WIDTH_SHARE : PUPIL_WIDTH_SHARE),
        ry * irisShare * (slit ? SLIT_PUPIL_HEIGHT_SHARE : PUPIL_HEIGHT_SHARE),
        PUPIL,
      );
      fillEllipse(
        ctx,
        pt(rx * EYE_GLINT_X, ry * EYE_GLINT_Y),
        rx * EYE_GLINT_SHARE,
        ry * EYE_GLINT_SHARE,
        rgba(SPECULAR, EYE_GLINT_ALPHA * (1 - shade)),
      );
    }
  }

  const lid = clamp01(spec.form === 'lidded' ? Math.max(spec.lid, EYE_SHUT_LID) : spec.lid);
  if (lid > 0) {
    ctx.save();
    traceEllipse(ctx, origin, rx, ry);
    ctx.clip();
    ctx.fillStyle = rgba(mix(FLESH.mid, INK, shade), LID_ALPHA);
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2 * lid);
    ctx.restore();
  }

  traceEllipse(ctx, origin, rx, ry);
  ctx.strokeStyle = INK;
  ctx.lineWidth = spec.inkWidth;
  ctx.stroke();

  ctx.restore();
}

// ── Ground, shadow and debris ────────────────────────────────────────────────

function paintContactShadow(
  ctx: Ctx,
  centreX: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  fillEllipse(ctx, pt(centreX, BODY_SHADOW_Y), rx, ry, rgba(CONTACT_SHADOW, alpha));
}

const SHARD_COUNT = 9;
const SHARD_RING_SHARE = 0.62;
const SHARD_LENGTH_SHARE = 0.5;
const SHARD_WIDTH_SHARE = 0.22;
const CRACK_COUNT = 7;
const CRACK_WIDTH = 0.018;
const CRACK_ALPHA = 0.7;
const DUST_ALPHA = 0.3;
const DUST_RY_SHARE = 0.3;
const SLIME_STRAND_COUNT = 5;
const SLIME_STRAND_ALPHA = 0.55;
const SLIME_STRAND_WIDTH = 0.012;

/**
 * The broken floor a tentacle comes out of: a dust wash, radiating cracks,
 * thrown shards, and slime strands bridging the hole. Drawn under the tentacle
 * so the flesh sits in the hole rather than on top of it.
 */
function paintGroundBurst(ctx: Ctx, radius: number, intensity: number, seed: number): void {
  const strength = clamp01(intensity);
  if (strength <= 0) return;

  fillEllipse(
    ctx,
    pt(0, 0),
    radius,
    radius * DUST_RY_SHARE,
    rgba(RUBBLE.mid, DUST_ALPHA * strength),
  );

  ctx.strokeStyle = rgba(INK, CRACK_ALPHA * strength);
  ctx.lineWidth = CRACK_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < CRACK_COUNT; i++) {
    const angle = (i / CRACK_COUNT) * TWO_PI + hash1(seed + i);
    const reach =
      radius * hashRange(seed + i + CRACK_SEED_STRIDE, CRACK_REACH_MIN, CRACK_REACH_MAX);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach * DUST_RY_SHARE);
    ctx.stroke();
  }

  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = (i / SHARD_COUNT) * TWO_PI + hash1(seed + i + SHARD_SEED_STRIDE) * TWO_PI;
    const reach = radius * SHARD_RING_SHARE * hashRange(seed + i, SHARD_RING_MIN, SHARD_RING_MAX);
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach * DUST_RY_SHARE - radius * SHARD_LIFT_SHARE * strength;
    const size =
      radius * SHARD_LENGTH_SHARE * hashRange(seed + i + SHARD_SIZE_STRIDE, SHARD_SIZE_MIN, 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hash1(seed + i + SHARD_SPIN_STRIDE) * TWO_PI);
    ctx.fillStyle = mix(RUBBLE.mid, RUBBLE.light, hash1(seed + i + SHARD_TONE_STRIDE));
    ctx.fillRect(-size / 2, (-size * SHARD_WIDTH_SHARE) / 2, size, size * SHARD_WIDTH_SHARE);
    ctx.strokeStyle = rgba(RUBBLE.dark, strength);
    ctx.lineWidth = SHARD_INK_WIDTH;
    ctx.strokeRect(-size / 2, (-size * SHARD_WIDTH_SHARE) / 2, size, size * SHARD_WIDTH_SHARE);
    ctx.restore();
  }

  ctx.strokeStyle = rgba(SLIME, SLIME_STRAND_ALPHA * strength);
  ctx.lineWidth = SLIME_STRAND_WIDTH;
  for (let i = 0; i < SLIME_STRAND_COUNT; i++) {
    const spread = lerp(-radius, radius, (i + CENTRE) / SLIME_STRAND_COUNT);
    const sag =
      radius *
      DUST_RY_SHARE *
      hashRange(seed + i + SLIME_SEED_STRIDE, SLIME_SAG_MIN, SLIME_SAG_MAX);
    ctx.beginPath();
    ctx.moveTo(spread, -sag);
    ctx.quadraticCurveTo(spread * SLIME_STRAND_BOW, 0, spread, sag * SLIME_STRAND_DROP);
    ctx.stroke();
  }
}

/**
 * The floor coming apart where something has hit it, rather than where
 * something has come up through it.
 *
 * The same broken ground as {@link paintGroundBurst} with the cues a blow needs
 * on top of it: a puff of pale dust thrown up off the contact, and a ring
 * running out from it. Everything here is held inside the burst's own radius —
 * a ring that widens past it makes the frame *after* the hit the widest in the
 * row, and the impact-is-the-peak gate reads the blow off exactly that width.
 */
const LANDING_PUFF_COUNT = 6;
const LANDING_PUFF_ALPHA = 0.4;
const LANDING_PUFF_RING_SHARE = 0.62;
const LANDING_PUFF_SIZE_MIN = 0.26;
const LANDING_PUFF_SIZE_MAX = 0.52;
const LANDING_PUFF_LIFT_SHARE = 1.25;
/**
 * How much the cloud swells as it climbs — upward only. Growing it sideways
 * would make the frame *after* the hit the widest in the row, which is the one
 * thing the impact-is-the-peak gate refuses.
 */
const LANDING_PUFF_SWELL = 1.1;
const LANDING_PUFF_SEED_STRIDE = 173;
const LANDING_PUFF_SIZE_STRIDE = 313;
const SHOCK_RING_FROM = 0.34;
const SHOCK_RING_ALPHA = 0.55;
const SHOCK_RING_WIDTH = 0.022;

function paintLandingBurst(
  ctx: Ctx,
  radius: number,
  strength: number,
  shock: number,
  seed: number,
): void {
  const hit = clamp01(strength);
  if (hit <= 0) return;
  paintGroundBurst(ctx, radius, hit, seed);

  const ring = radius * lerp(SHOCK_RING_FROM, 1, clamp01(shock));
  ctx.strokeStyle = rgba(RUBBLE.light, SHOCK_RING_ALPHA * hit);
  ctx.lineWidth = SHOCK_RING_WIDTH;
  ctx.beginPath();
  ctx.ellipse(0, 0, ring, ring * DUST_RY_SHARE, 0, 0, TWO_PI);
  ctx.stroke();

  for (let i = 0; i < LANDING_PUFF_COUNT; i++) {
    const around = (i / LANDING_PUFF_COUNT) * TWO_PI + hash1(seed + i);
    const reach = radius * LANDING_PUFF_RING_SHARE;
    const size =
      radius *
      hashRange(seed + i * LANDING_PUFF_SIZE_STRIDE, LANDING_PUFF_SIZE_MIN, LANDING_PUFF_SIZE_MAX);
    const lift = radius * LANDING_PUFF_LIFT_SHARE * clamp01(shock);
    fillEllipse(
      ctx,
      pt(
        Math.cos(around) * reach,
        Math.sin(around) * reach * DUST_RY_SHARE -
          lift * hash1(seed + i + LANDING_PUFF_SEED_STRIDE),
      ),
      size,
      size * VENTRAL_SUCKER_SQUASH * (1 + clamp01(shock) * LANDING_PUFF_SWELL),
      rgba(RUBBLE.light, LANDING_PUFF_ALPHA * hit),
    );
  }
}

/**
 * The mound of flesh a tentacle heaps round the hole it comes up through.
 *
 * Without one the base of a lone tube is two straight sides meeting a straight
 * cut across the bottom — a paper wedge stood on the floor with a tapering limb
 * balanced on top of it, detached from the tubular part above and from the
 * broken ground below. It is drawn in two passes: the far rim behind the tube,
 * and the near rim over it, which buries the flat cut and puts the limb *in*
 * the floor rather than on it.
 */
const COLLAR_RX_SHARE = 1.4;
const COLLAR_SQUASH = 0.34;
const COLLAR_STEPS = 64;
const COLLAR_LOBES_SLOW = 5;
const COLLAR_LOBES_FAST = 11;
const COLLAR_RAG_SLOW = 0.14;
const COLLAR_RAG_FAST = 0.05;
const COLLAR_FAR_SHADE = 0.28;
const COLLAR_NEAR_SHADE = 0.24;
/** How far in from the collar's rim the near lip's inner edge runs. */
const COLLAR_LIP_SHARE = 0.6;
const COLLAR_PIT_SHARE = 0.55;
const COLLAR_PIT_ALPHA = 0.58;
const COLLAR_INK_WIDTH = 0.018;
const COLLAR_RIM_ALPHA = 0.28;
/** Underground, the mound has not been shouldered fully open yet. */
const COLLAR_RISEN_FLOOR = 0.72;

function collarOutline(halfWidth: number, seed: number): Pt[] {
  const rx = halfWidth * COLLAR_RX_SHARE;
  const points: Pt[] = [];
  for (let i = 0; i < COLLAR_STEPS; i++) {
    const around = (i / COLLAR_STEPS) * TWO_PI;
    const rag =
      1 +
      Math.sin(around * COLLAR_LOBES_SLOW + seed) * COLLAR_RAG_SLOW +
      Math.sin(around * COLLAR_LOBES_FAST - seed) * COLLAR_RAG_FAST;
    points.push(pt(Math.cos(around) * rx * rag, Math.sin(around) * rx * COLLAR_SQUASH * rag));
  }
  return points;
}

/**
 * One pass of the collar. The far rim goes down before the tentacle and carries
 * the black of the hole; the near rim goes over it as a crescent of lit flesh,
 * which is the piece that hides the tube's own square-cut base.
 */
function paintEmergenceCollar(
  ctx: Ctx,
  halfWidth: number,
  risen: number,
  seed: number,
  near: boolean,
): void {
  const swell = lerp(COLLAR_RISEN_FLOOR, 1, clamp01(risen));
  const outer = collarOutline(halfWidth * swell, seed);
  if (!near) {
    tracePolygon(ctx, outer);
    ctx.fillStyle = fleshAt(COLLAR_FAR_SHADE);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = COLLAR_INK_WIDTH;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const pit = collarOutline(halfWidth * swell * COLLAR_PIT_SHARE, seed + COLLAR_STEPS);
    tracePolygon(ctx, pit);
    ctx.fillStyle = rgba(FLESH_DEEP, COLLAR_PIT_ALPHA);
    ctx.fill();
    return;
  }

  // The lower arc only, walled by its own shrunken copy: a crescent lip rather
  // than a half-disc, so the mound has a thickness the tube disappears behind.
  const lower = Math.floor(COLLAR_STEPS / 2) + 1;
  // Pinched to nothing at both ends. A lip of constant thickness closes on two
  // straight radial joins, and a straight edge across a mound of flesh is the
  // same panel seam the crown limbs used to cut into the dome.
  const inner = outer.slice(0, lower).map((p, i) => {
    const along = Math.sin((i / (lower - 1)) * Math.PI);
    const share = lerp(1, COLLAR_LIP_SHARE, along);
    return pt(p.x * share, p.y * share);
  });
  const crescent = [...outer.slice(0, lower), ...inner.slice().reverse()];
  tracePolygon(ctx, crescent);
  ctx.fillStyle = fleshAt(COLLAR_NEAR_SHADE);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = COLLAR_INK_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = rgba(RIM_LIGHT, COLLAR_RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < lower; i++) ctx.lineTo(inner[i].x, inner[i].y);
  ctx.stroke();
}

const CRACK_SEED_STRIDE = 53;
const SHARD_SEED_STRIDE = 101;
const SHARD_SIZE_STRIDE = 149;
const SHARD_SPIN_STRIDE = 197;
const SHARD_TONE_STRIDE = 233;
const SLIME_SEED_STRIDE = 281;
const SHARD_LIFT_SHARE = 0.35;
const SHARD_INK_WIDTH = 0.008;
const SLIME_STRAND_BOW = 0.4;
const CRACK_REACH_MIN = 0.5;
const CRACK_REACH_MAX = 1.15;
const SHARD_RING_MIN = 0.6;
const SHARD_RING_MAX = 1.4;
const SHARD_SIZE_MIN = 0.35;
const SLIME_SAG_MIN = 0.4;
const SLIME_SAG_MAX = 1.1;
const SLIME_STRAND_DROP = 0.5;

// ── Mantle ───────────────────────────────────────────────────────────────────

interface MantleShape {
  readonly rx: number;
  readonly upperRy: number;
  readonly lowerRy: number;
  readonly centreY: number;
}

function mantleShape(pose: KrakarenPose, view: ViewSpec): MantleShape {
  const swell = pose.breath - RESTING_BREATH;
  const rx =
    MANTLE_HALF_WIDTH *
    view.girth *
    (1 + swell * MANTLE_BREATH_WIDTH + pose.brace * MANTLE_BRACE_SPREAD);
  const squash = 1 - swell * MANTLE_BREATH_HEIGHT - pose.brace * MANTLE_BRACE_SQUASH;
  return {
    rx,
    upperRy: MANTLE_UPPER_RY * squash,
    lowerRy: MANTLE_LOWER_RY * squash,
    centreY: MANTLE_CENTRE_Y + pose.heave,
  };
}

/**
 * Low-frequency swellings that keep the dome from reading as a moulded shell.
 *
 * Three lobe counts with unrelated phases, so the silhouette has a heavy
 * shoulder on one side and a slump on the other rather than a rhythm.
 */
interface MantleLump {
  readonly lobes: number;
  readonly amplitude: number;
  readonly phase: number;
}

const MANTLE_LUMPS: readonly MantleLump[] = [
  { lobes: 2, amplitude: 0.082, phase: 0.9 },
  { lobes: 3, amplitude: 0.055, phase: 2.4 },
  { lobes: 5, amplitude: 0.03, phase: 5.1 },
];

/**
 * How much of the lump survives at the apex.
 *
 * The bake anchors the whole sheet on the apex's height above the ground line,
 * so the vertical swelling is damped out of the top of the dome; the horizontal
 * swelling is free everywhere.
 */
const MANTLE_APEX_LUMP_DAMP = 0.15;

function mantleLumpAt(theta: number): number {
  let sum = 0;
  for (const lump of MANTLE_LUMPS)
    sum += Math.sin(theta * lump.lobes + lump.phase) * lump.amplitude;
  return sum;
}

/**
 * A local interruption of the dome's contour: a wedge bitten out of it, or a
 * knuckle pushed out through it.
 *
 * Low-frequency lumps alone cannot do this. A sum of sines with amplitudes
 * under a tenth of the radius is still a convex closed curve — it wobbles, and
 * a viewer reads a wobbling convex curve as one smooth shape with texture on
 * it. What breaks the read is a handful of places where the boundary reverses:
 * a gash cut in to a quarter of the radius, or a lump standing proud of it, over
 * an angular span narrow enough that the curvature actually flips sign.
 *
 * `atDegrees` is measured the same way `theta` runs in {@link mantleOutline}: 0
 * at the apex, increasing toward the creature's own +X side.
 */
interface MantleNotch {
  readonly atDegrees: number;
  readonly spanDegrees: number;
  /** Negative bites into the dome, positive pushes a knuckle out through it. */
  readonly depth: number;
}

/**
 * Seven of them, five of which cut inward. Written out rather than spaced,
 * because an evenly notched circle is a cog.
 */
const MANTLE_NOTCHES: readonly MantleNotch[] = [
  { atDegrees: 14, spanDegrees: 13, depth: 0.2 },
  { atDegrees: 44, spanDegrees: 18, depth: 0.22 },
  { atDegrees: 83, spanDegrees: 16, depth: -0.18 },
  { atDegrees: 120, spanDegrees: 22, depth: 0.26 },
  { atDegrees: 208, spanDegrees: 20, depth: -0.32 },
  { atDegrees: 255, spanDegrees: 17, depth: -0.3 },
  { atDegrees: 292, spanDegrees: 18, depth: -0.31 },
  { atDegrees: 336, spanDegrees: 15, depth: -0.26 },
];

/** The shortest angular distance between two angles, in radians. */
function angleGap(a: number, b: number): number {
  const raw = Math.abs(((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(raw, TWO_PI - raw);
}

/**
 * How much every notch moves the contour at `theta`.
 *
 * The window is a raised cosine squared rather than a plain one: the squared
 * shoulder holds the notch's walls steep while its ends still meet the
 * surrounding contour without a corner, which is what makes the interruption
 * read as torn flesh instead of as a bite from a hole punch.
 */
function mantleNotchAt(theta: number): number {
  let sum = 0;
  for (const notch of MANTLE_NOTCHES) {
    const span = deg(notch.spanDegrees);
    const gap = angleGap(theta, deg(notch.atDegrees));
    if (gap >= span) continue;
    const window = Math.cos((gap / span) * (Math.PI / 2));
    sum += notch.depth * window * window;
  }
  return sum;
}

function mantleOutline(shape: MantleShape): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < MANTLE_OUTLINE_STEPS; i++) {
    const theta = (i / MANTLE_OUTLINE_STEPS) * TWO_PI;
    const up = Math.cos(theta);
    const ry = up > 0 ? shape.upperRy : shape.lowerRy;
    const taper = 1 - MANTLE_APEX_TAPER * Math.max(0, up) * Math.max(0, up);
    const lump = mantleLumpAt(theta) + mantleNotchAt(theta);
    const acrossLump = 1 + lump;
    const upLump = 1 + lump * lerp(1, MANTLE_APEX_LUMP_DAMP, up * up);
    points.push(
      pt(shape.rx * Math.sin(theta) * taper * acrossLump, shape.centreY - up * ry * upLump),
    );
  }
  return points;
}

/**
 * How far the dome's flesh is pushed toward the shade.
 *
 * The limbs that cross it are painted in the plain midtone, so a dome at the
 * same value swallows them and the crossings read as creases in one lump
 * rather than as limbs lying over a body.
 */
const MANTLE_TINT = 0.26;
const MANTLE_INK_WIDTH = 0.022;
const MANTLE_UNDERSHADE_ALPHA = 0.55;
const MANTLE_UNDERSHADE_LIFT = 0.35;
/**
 * The occlusion under the dome's own shoulder, where the limbs are heaped
 * against it. Painted at the bottom of the flesh range so the near limbs have
 * something dark to sit in front of.
 */
const MANTLE_OCCLUSION_ALPHA = 0.42;
const MANTLE_OCCLUSION_LIFT = 1.05;
const MANTLE_OCCLUSION_SQUASH = 0.8;
/**
 * The wet patches on top of the dome.
 *
 * Four small uneven smears covering about 4% of the dome, rather than one big
 * soft ellipse over a fifth of it: a single broad highlight on a round shape is
 * the most reliable "moulded toy" cue in the whole vocabulary, and it was most
 * of what made the first two bakes read as one.
 */
interface MantleGloss {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly alpha: number;
  readonly tiltDegrees: number;
}

const MANTLE_GLOSS: readonly MantleGloss[] = [
  { x: -0.44, y: -0.5, rx: 0.13, ry: 0.09, alpha: 0.11, tiltDegrees: -24 },
  { x: -0.12, y: -0.62, rx: 0.07, ry: 0.05, alpha: 0.08, tiltDegrees: 12 },
  { x: 0.31, y: -0.28, rx: 0.05, ry: 0.11, alpha: 0.07, tiltDegrees: 38 },
  { x: 0.09, y: 0.16, rx: 0.08, ry: 0.04, alpha: 0.06, tiltDegrees: -61 },
];

/**
 * The creases folded into the dome's flesh.
 *
 * Every one of them is bowed, and the bow is not decoration: a straight line
 * drawn across a curved body is read as an edge between two flat panels, and
 * five of those radiating from a point is origami. The control point of each
 * curve below stands at least a seventh of its own chord off the straight line
 * between its ends, which is the whole reason the table is written as three
 * points rather than two.
 *
 * Coordinates are shares: x of the dome's half-width, y of its upper radius
 * measured from the dome's centre.
 */
interface MantleCrease {
  readonly fromX: number;
  readonly fromY: number;
  readonly bowX: number;
  readonly bowY: number;
  readonly toX: number;
  readonly toY: number;
  readonly alpha: number;
  readonly width: number;
}

const MANTLE_CREASES: readonly MantleCrease[] = [
  {
    fromX: -0.86,
    fromY: -0.34,
    bowX: -0.18,
    bowY: -0.95,
    toX: 0.42,
    toY: -0.52,
    alpha: 0.5,
    width: 0.03,
  },
  {
    fromX: -0.62,
    fromY: -0.78,
    bowX: -0.72,
    bowY: -0.02,
    toX: -0.2,
    toY: 0.5,
    alpha: 0.42,
    width: 0.024,
  },
  {
    fromX: 0.9,
    fromY: -0.5,
    bowX: 0.34,
    bowY: -0.24,
    toX: 0.56,
    toY: 0.46,
    alpha: 0.46,
    width: 0.028,
  },
  {
    fromX: -0.1,
    fromY: -0.88,
    bowX: 0.58,
    bowY: -0.66,
    toX: 0.82,
    toY: 0.06,
    alpha: 0.36,
    width: 0.02,
  },
  {
    fromX: -0.48,
    fromY: 0.34,
    bowX: 0.02,
    bowY: 0.02,
    toX: 0.44,
    toY: 0.36,
    alpha: 0.4,
    width: 0.022,
  },
];

/**
 * How deep the shadow that fills each bitten notch runs, as a share of the
 * dome's half-width, and how far past the notch's own wall it spills.
 *
 * A notch with no shadow in it is a change of outline the eye reads at the
 * silhouette and nowhere else. Filling it puts near-black into the *upper* half
 * of the creature, which is the half that had none: every dark value on the
 * last bake sat in the pocket under the dome, so from the shoulders up she
 * flattened into one pink field at a 32 px tile.
 */
const NOTCH_SHADOW_REACH = 0.46;
const NOTCH_SHADOW_ALPHA = 0.5;
const NOTCH_SHADOW_SQUASH = 0.72;

/** Grit over the flesh, so the sheen sits on something rather than on plastic. */
const MANTLE_GRIT_COUNT = 40;
const MANTLE_GRIT_RADIUS = 0.024;
const MANTLE_GRIT_ALPHA = 0.38;
const MANTLE_GRIT_PALE_SHARE = 0.28;
const MANTLE_GRIT_SEED = 4457;
const GRIT_PALE_DRAW = 2;
const GRIT_SIZE_DRAW = 3;
const MANTLE_MOTTLE_COUNT = 34;
const MANTLE_MOTTLE_ALPHA = 0.26;
const MANTLE_MOTTLE_RADIUS = 0.16;
const MANTLE_MOTTLE_SEED = 613;
const MANTLE_MOTTLE_SIZE_SEED = 2;
const MANTLE_MOTTLE_SIZE_MIN = 0.4;
const MANTLE_MOTTLE_SIZE_MAX = 1.4;
/**
 * The broken rim up the lit side of the dome.
 *
 * Three short arcs covering 108° of the ellipse — under a third of its
 * circumference — rather than the single 165° sweep the last bake ran. A rim
 * that traces most of a contour *is* the contour at a 32 px tile, and a clean
 * continuous outline is the definition of a cartoon.
 */
interface RimArc {
  readonly fromDegrees: number;
  readonly toDegrees: number;
}

const MANTLE_RIM_ARCS: readonly RimArc[] = [
  { fromDegrees: 158, toDegrees: 196 },
  { fromDegrees: 211, toDegrees: 253 },
  { fromDegrees: 287, toDegrees: 315 },
];
const DORSAL_RIDGE_COUNT = 4;
const DORSAL_RIDGE_ALPHA = 0.3;
const DORSAL_RIDGE_WIDTH = 0.02;
const DORSAL_RIDGE_SPAN = 0.55;

function paintMantle(ctx: Ctx, pose: KrakarenPose, view: ViewSpec, shape: MantleShape): void {
  const outline = mantleOutline(shape);

  tracePolygon(ctx, outline);
  ctx.fillStyle = mix(FLESH.mid, FLESH.dark, MANTLE_TINT);
  ctx.fill();

  ctx.save();
  tracePolygon(ctx, outline);
  ctx.clip();

  fillEllipse(
    ctx,
    pt(0, shape.centreY + shape.lowerRy * MANTLE_UNDERSHADE_LIFT),
    shape.rx,
    shape.lowerRy,
    rgba(FLESH.dark, MANTLE_UNDERSHADE_ALPHA),
  );
  fillEllipse(
    ctx,
    pt(0, shape.centreY + shape.lowerRy * MANTLE_OCCLUSION_LIFT),
    shape.rx,
    shape.lowerRy * MANTLE_OCCLUSION_SQUASH,
    rgba(FLESH_DEEP, MANTLE_OCCLUSION_ALPHA),
  );

  ctx.fillStyle = rgba(FLESH.dark, MANTLE_MOTTLE_ALPHA);
  for (let i = 0; i < MANTLE_MOTTLE_COUNT; i++) {
    const seed = MANTLE_MOTTLE_SEED + i;
    const x = (hash1(seed) * 2 - 1) * shape.rx;
    const y = shape.centreY - (hash1(seed + 1) * 2 - 1) * shape.upperRy;
    const r =
      MANTLE_MOTTLE_RADIUS *
      hashRange(seed + MANTLE_MOTTLE_SIZE_SEED, MANTLE_MOTTLE_SIZE_MIN, MANTLE_MOTTLE_SIZE_MAX);
    traceEllipse(ctx, pt(x, y), r, r * VENTRAL_SUCKER_SQUASH);
    ctx.fill();
  }

  // Each bitten notch drags its own shadow in behind it, so the interruption is
  // a fold with a dark side rather than a nick in an outline.
  for (const notch of MANTLE_NOTCHES) {
    if (notch.depth >= 0) continue;
    const theta = deg(notch.atDegrees);
    const up = Math.cos(theta);
    const ry = up > 0 ? shape.upperRy : shape.lowerRy;
    const reach = 1 + mantleLumpAt(theta) + notch.depth;
    const at = pt(shape.rx * Math.sin(theta) * reach, shape.centreY - up * ry * reach);
    const radius = shape.rx * NOTCH_SHADOW_REACH * Math.abs(notch.depth);
    fillEllipse(
      ctx,
      at,
      radius,
      radius * NOTCH_SHADOW_SQUASH,
      rgba(FLESH_DEEP, NOTCH_SHADOW_ALPHA),
      theta,
    );
  }

  ctx.lineCap = 'round';
  for (const crease of MANTLE_CREASES) {
    ctx.strokeStyle = rgba(FLESH_DEEP, crease.alpha);
    ctx.lineWidth = crease.width;
    ctx.beginPath();
    ctx.moveTo(shape.rx * crease.fromX, shape.centreY + shape.upperRy * crease.fromY);
    ctx.quadraticCurveTo(
      shape.rx * crease.bowX,
      shape.centreY + shape.upperRy * crease.bowY,
      shape.rx * crease.toX,
      shape.centreY + shape.upperRy * crease.toY,
    );
    ctx.stroke();
  }

  for (const gloss of MANTLE_GLOSS) {
    fillEllipse(
      ctx,
      pt(shape.rx * gloss.x, shape.centreY + shape.upperRy * gloss.y),
      shape.rx * gloss.rx,
      shape.upperRy * gloss.ry,
      rgba(SPECULAR, gloss.alpha),
      deg(gloss.tiltDegrees),
    );
  }

  for (let i = 0; i < MANTLE_GRIT_COUNT; i++) {
    const seed = MANTLE_GRIT_SEED + i * MANTLE_EYE_SEED_STRIDE;
    const at = scatterOnMantle(shape, seed);
    const pale = hash1(seed + GRIT_PALE_DRAW) < MANTLE_GRIT_PALE_SHARE;
    const r = MANTLE_GRIT_RADIUS * hash1(seed + GRIT_SIZE_DRAW);
    fillEllipse(ctx, at, r, r, rgba(pale ? SPECULAR : INK, MANTLE_GRIT_ALPHA));
  }

  if (!view.showsFace) {
    // Seen from behind there is no face to carry the dome, so the mantle needs
    // its own structure or the away rows are a bare pink egg.
    ctx.strokeStyle = rgba(FLESH.dark, DORSAL_RIDGE_ALPHA);
    ctx.lineWidth = DORSAL_RIDGE_WIDTH;
    ctx.lineCap = 'round';
    for (let i = 0; i < DORSAL_RIDGE_COUNT; i++) {
      const across = lerp(-1, 1, (i + CENTRE) / DORSAL_RIDGE_COUNT) * shape.rx * DORSAL_RIDGE_SPAN;
      ctx.beginPath();
      ctx.moveTo(across, shape.centreY - shape.upperRy * DORSAL_RIDGE_TOP);
      ctx.quadraticCurveTo(
        across * DORSAL_RIDGE_BOW,
        shape.centreY,
        across,
        shape.centreY + shape.lowerRy * DORSAL_RIDGE_BOTTOM,
      );
      ctx.stroke();
    }
  }
  ctx.restore();

  tracePolygon(ctx, outline);
  ctx.strokeStyle = INK;
  ctx.lineWidth = MANTLE_INK_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.strokeStyle = rgba(RIM_LIGHT, RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  for (const arc of MANTLE_RIM_ARCS) {
    ctx.beginPath();
    ctx.ellipse(
      0,
      shape.centreY,
      shape.rx,
      shape.upperRy,
      0,
      deg(arc.fromDegrees),
      deg(arc.toDegrees),
    );
    ctx.stroke();
  }

  if (view.showsFace) paintFace(ctx, pose, view, shape);
  paintMantleScatter(ctx, pose, view, shape);
}

/**
 * The eyes and gashes strewn over the dome.
 *
 * Painted on every view, the back included: an away row with no eyes on it is
 * the one angle from which she is safe to look at, and she is not.
 */
function paintMantleScatter(
  ctx: Ctx,
  pose: KrakarenPose,
  view: ViewSpec,
  shape: MantleShape,
): void {
  for (let i = 0; i < MANTLE_GASH_COUNT; i++) {
    const seed = view.seed + MANTLE_GASH_SEED + i * MANTLE_GASH_SEED_STRIDE;
    paintMouth(ctx, {
      centre: scatterOnMantle(shape, seed),
      angle: hash1(seed + SCATTER_GASH_ANGLE_DRAW) * TWO_PI,
      half: hashRange(seed + SCATTER_GASH_SIZE_DRAW, MANTLE_GASH_SIZE_MIN, MANTLE_GASH_SIZE_MAX),
      open: mouthOpenAt(pose.mouthCycle + hash1(seed + SCATTER_GASH_PHASE_DRAW) * pose.mouthSpread),
      depth: 0,
      seed: seed + SCATTER_GASH_TEAR_DRAW,
    });
  }

  const scattered: ScatterEye[] = [];
  for (let i = 0; i < MANTLE_EYE_COUNT; i++) {
    const seed = view.seed + MANTLE_EYE_SEED + i * MANTLE_EYE_SEED_STRIDE;
    const at = scatterOnMantle(shape, seed);
    const clustered = hash1(seed + EYE_CLUSTER_DRAW) < MANTLE_EYE_CLUSTER_SHARE;
    const inFold = clustered
      ? 2 + Math.floor(hash1(seed + EYE_CLUSTER_COUNT_DRAW) * MANTLE_EYE_FOLD_EXTRA)
      : 1;
    if (clustered) {
      // The fold of skin the little ones share. Without it a knot of three eyes
      // is three separate spots that happen to be near each other.
      fillEllipse(
        ctx,
        pt(at.x, at.y + MANTLE_EYE_FOLD_RY * MANTLE_EYE_FOLD_DROP),
        MANTLE_EYE_FOLD_RX,
        MANTLE_EYE_FOLD_RY,
        rgba(FLESH_DEEP, MANTLE_EYE_FOLD_ALPHA),
        hash1(seed + EYE_TILT_DRAW) * TWO_PI,
      );
    }
    // A fold is a chain running *down* the skin rather than a huddle. Members
    // side by side at the same height is exactly the arrangement the pair rule
    // below exists to break, so the fold is built already obeying it.
    let chainY = at.y;
    for (let member = 0; member < inFold; member++) {
      const own = seed + member * MANTLE_EYE_FOLD_SEED_STRIDE;
      const rx = mantleEyeRadius(own) * (clustered ? MANTLE_EYE_FOLD_SIZE_SHARE : 1);
      if (member > 0) chainY += rx * 2 * MANTLE_EYE_FOLD_STEP_DIAMETERS;
      scattered.push({
        centre: pt(at.x + (member % 2 === 0 ? 0 : MANTLE_EYE_FOLD_STAGGER), chainY),
        rx,
        ry: rx * hashRange(own + EYE_SQUASH_DRAW, MANTLE_EYE_SQUASH_MIN, 1),
        tilt: hash1(own + EYE_TILT_DRAW) * TWO_PI,
        gaze:
          pose.gaze * hash1(own + EYE_GAZE_DRAW) +
          hashRange(own + EYE_GAZE_BIAS_DRAW, -MANTLE_EYE_GAZE, MANTLE_EYE_GAZE),
        lid:
          hashRange(own + EYE_LID_DRAW, 0, MANTLE_EYE_LID_MAX) +
          pose.blink * hash1(own + EYE_BLINK_SHARE_DRAW),
        form: eyeFormAt(own + EYE_FORM_DRAW),
      });
    }
  }

  for (const eye of separatedEyes(scattered, primaryEyeDiscs(pose, view, shape), shape)) {
    paintEyeball(ctx, {
      centre: eye.centre,
      rx: eye.rx,
      ry: eye.ry,
      tilt: eye.tilt,
      gaze: eye.gaze,
      lid: eye.lid,
      inkWidth: SMALL_EYE_INK_WIDTH,
      depth: 0,
      form: eye.form,
    });
  }
}

/** One eye the scatter wants to place, before the pair rule has had its say. */
interface ScatterEye {
  centre: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly tilt: number;
  readonly gaze: number;
  readonly lid: number;
  readonly form: EyeForm;
}

/** Where an eye sits and how wide it is: all the pair rule needs to judge it. */
interface EyeDisc {
  readonly centre: Pt;
  readonly rx: number;
}

/**
 * How close two eyes may come before they read as a pair.
 *
 * Two discs of similar size, side by side at the same height, with anything at
 * all under them, is a face — and a viewer who finds a face stops looking. The
 * rule is written in diameters rather than tiles because it is about how the
 * *shapes* group, so it has to scale with them: the pair that survived the last
 * bake was two eyes about one diameter apart with barely any height between
 * them and a gash directly below, which is a face however small it is.
 */
const EYE_PAIR_MIN_GAP_DIAMETERS = 2.5;
const EYE_PAIR_LEVEL_DIAMETERS = 1;
/**
 * How far apart two eyes' diameters have to be before proximity stops mattering.
 *
 * Size is half of what makes two discs read as a pair. A big eye with a small
 * one beside it is a big eye with a small one beside it; the face only assembles
 * when the two are close enough in size to be taken for each other, which is
 * what the surviving pair on the last bake was at 1.2×.
 */
const EYE_PAIR_SIZE_RATIO = 2;
/** How far a violating eye is shoved, in diameters, and how many shoves it gets. */
const EYE_PAIR_PUSH_DIAMETERS = 1.6;
const EYE_PAIR_MAX_PUSHES = 5;

function eyesPair(a: EyeDisc, b: EyeDisc): boolean {
  const bigger = Math.max(a.rx, b.rx);
  if (bigger / Math.min(a.rx, b.rx) >= EYE_PAIR_SIZE_RATIO) return false;
  const diameter = bigger * 2;
  return (
    Math.abs(a.centre.x - b.centre.x) < diameter * EYE_PAIR_MIN_GAP_DIAMETERS &&
    Math.abs(a.centre.y - b.centre.y) < diameter * EYE_PAIR_LEVEL_DIAMETERS
  );
}

/**
 * Moves or drops every eye that would read as one of a pair.
 *
 * Vertical shoves only: separating two level eyes sideways gives a wider face,
 * not fewer faces. The shoves alternate up and down and grow, and an eye with no
 * clear station left is dropped outright — a count that varies by one is
 * invisible next to a face that does not.
 */
function separatedEyes(
  candidates: readonly ScatterEye[],
  fixed: readonly EyeDisc[],
  shape: MantleShape,
): ScatterEye[] {
  const placed: EyeDisc[] = [...fixed];
  const kept: ScatterEye[] = [];
  for (const eye of candidates) {
    for (let push = 0; push <= EYE_PAIR_MAX_PUSHES; push++) {
      const step =
        push === 0
          ? 0
          : eye.rx * 2 * EYE_PAIR_PUSH_DIAMETERS * Math.ceil(push / 2) * (push % 2 === 0 ? -1 : 1);
      const candidate: EyeDisc = {
        centre: heldOnMantle(shape, pt(eye.centre.x, eye.centre.y + step), eye.rx),
        rx: eye.rx,
      };
      if (placed.some((other) => eyesPair(candidate, other))) continue;
      eye.centre = candidate.centre;
      placed.push(candidate);
      kept.push(eye);
      break;
    }
  }
  return kept;
}

/** Which draw off a scattered eye's seed decides whether it shares a fold. */
const EYE_CLUSTER_DRAW = 10;
const EYE_CLUSTER_COUNT_DRAW = 11;
/** A third of the scatter is not one eye but a knot of two or three. */
const MANTLE_EYE_CLUSTER_SHARE = 0.34;
const MANTLE_EYE_FOLD_EXTRA = 2;
const MANTLE_EYE_FOLD_SEED_STRIDE = 197;
const MANTLE_EYE_FOLD_SIZE_SHARE = 0.6;
const MANTLE_EYE_FOLD_RX = 0.075;
const MANTLE_EYE_FOLD_RY = 0.11;
const MANTLE_EYE_FOLD_ALPHA = 0.55;
/** The fold runs down from its first eye, so its skin has to hang that way too. */
const MANTLE_EYE_FOLD_DROP = 0.55;
const MANTLE_EYE_FOLD_STEP_DIAMETERS = 1.9;
const MANTLE_EYE_FOLD_STAGGER = 0.028;

const DORSAL_RIDGE_TOP = 0.5;
const DORSAL_RIDGE_BOTTOM = 0.5;
const DORSAL_RIDGE_BOW = 1.5;

// ── Face ─────────────────────────────────────────────────────────────────────

/**
 * The two eyes big enough to track with.
 *
 * Deliberately not a pair. They differ in size, in height, in the angle they
 * are set at, in how far the lid has come down and in where they are looking,
 * because two matched almonds either side of a centred beak is a face, and the
 * moment a viewer parses a face they have finished looking at her.
 */
interface PrimaryEye {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tiltDegrees: number;
  /** Lid drop this eye carries before any blink is added. */
  readonly lid: number;
  /** How much of the pose's gaze this eye follows, and where it looks anyway. */
  readonly gazeShare: number;
  readonly gazeBias: number;
}

const PRIMARY_EYES: readonly PrimaryEye[] = [
  {
    x: -0.62,
    y: -0.94,
    rx: 0.15,
    ry: 0.128,
    tiltDegrees: -11,
    lid: 0.06,
    gazeShare: 1,
    gazeBias: 0,
  },
  {
    x: 0.46,
    y: -1.19,
    rx: 0.058,
    ry: 0.052,
    tiltDegrees: 31,
    lid: 0.5,
    gazeShare: 0.35,
    gazeBias: 0.4,
  },
];

/** The near eye in profile, and a second, far smaller one set further back. */
const PROFILE_EYES: readonly PrimaryEye[] = [
  {
    x: 0.58,
    y: -0.9,
    rx: 0.155,
    ry: 0.15,
    tiltDegrees: 7,
    lid: 0.06,
    gazeShare: 1,
    gazeBias: 0,
  },
  {
    x: -0.52,
    y: -1.17,
    rx: 0.06,
    ry: 0.054,
    tiltDegrees: -24,
    lid: 0.44,
    gazeShare: 0.3,
    gazeBias: -0.45,
  },
];

/** Scattered over the dome at hashed spots, on every view including the back. */
const MANTLE_EYE_COUNT = 9;
/**
 * The three sizes a scattered eye comes in, in tile units of radius.
 *
 * Classes rather than a range, and a range of 3.7× rather than the 2.5× the
 * last bake drew from. A dozen discs whose diameters all sit inside a third of
 * each other are not read as "too many eyes to count" — they are read as spots,
 * because the eye that finds two shapes the same size assumes they are the same
 * *kind* of thing and stops resolving them. Three separated sizes with nothing
 * between them is what makes the count refuse to settle.
 */
const MANTLE_EYE_RADIUS_SMALL = 0.03;
const MANTLE_EYE_RADIUS_MIDDLING = 0.058;
const MANTLE_EYE_RADIUS_LARGE = 0.111;
const MANTLE_EYE_RADIUS_CLASSES: readonly number[] = [
  MANTLE_EYE_RADIUS_SMALL,
  MANTLE_EYE_RADIUS_MIDDLING,
  MANTLE_EYE_RADIUS_LARGE,
];
const MANTLE_EYE_SQUASH_MIN = 0.6;
const MANTLE_EYE_LID_MAX = 0.62;
const MANTLE_EYE_GAZE = 0.8;
const MANTLE_EYE_SEED = 7331;
const MANTLE_EYE_SEED_STRIDE = 19;
/** How much of the dome the scatter may reach, leaving its own rim clear. */
const MANTLE_SCATTER_REACH = 0.8;

const MANTLE_GASH_COUNT = 6;
const MANTLE_GASH_SIZE_MIN = 0.075;
const MANTLE_GASH_SIZE_MAX = 0.13;
const MANTLE_GASH_SEED = 9173;
const MANTLE_GASH_SEED_STRIDE = 29;

/** Which draw off one scattered gash's seed each of its dimensions takes. */
const SCATTER_GASH_ANGLE_DRAW = 2;
const SCATTER_GASH_SIZE_DRAW = 3;
const SCATTER_GASH_PHASE_DRAW = 4;
const SCATTER_GASH_TEAR_DRAW = 5;

/**
 * How far out along `theta` the dome's flesh actually runs, as a share of its
 * nominal radius. Both the low lumps and the bitten notches move it, so a
 * feature scattered against the nominal radius alone lands in mid air wherever
 * a notch has been cut.
 */
function mantleReachAt(theta: number): number {
  return 1 + mantleLumpAt(theta) + mantleNotchAt(theta);
}

/** A hashed point inside the dome, in the mantle's own drawn coordinates. */
function scatterOnMantle(shape: MantleShape, seed: number): Pt {
  const around = hash1(seed) * TWO_PI;
  const theta = Math.PI / 2 - around;
  const reach = Math.sqrt(hash1(seed + 1)) * MANTLE_SCATTER_REACH * mantleReachAt(theta);
  const up = -Math.sin(around);
  const ry = up > 0 ? shape.upperRy : shape.lowerRy;
  return pt(shape.rx * Math.cos(around) * reach, shape.centreY - up * ry * reach);
}

/**
 * Pulls a point back inside the dome's flesh.
 *
 * The pair rule shoves eyes vertically until they stop reading as pairs, and a
 * shove of a couple of diameters off a spot already near the skirt puts an eye
 * in the air below her. An eye floating clear of the body is worse than the
 * face it was moved to avoid.
 */
function heldOnMantle(shape: MantleShape, at: Pt, margin: number): Pt {
  const across = at.x / shape.rx;
  const rise = (shape.centreY - at.y) / (at.y <= shape.centreY ? shape.upperRy : shape.lowerRy);
  const radius = Math.hypot(across, rise);
  if (radius <= 0) return at;
  const theta = Math.atan2(across, rise);
  const limit = MANTLE_SCATTER_REACH * mantleReachAt(theta) - margin / shape.rx;
  if (radius <= limit) return at;
  const scale = limit / radius;
  const up = rise * scale;
  return pt(
    shape.rx * across * scale,
    shape.centreY - up * (up > 0 ? shape.upperRy : shape.lowerRy),
  );
}

/** Which of the three size classes the eye seeded on `seed` belongs to. */
function mantleEyeRadius(seed: number): number {
  const index = Math.min(
    MANTLE_EYE_RADIUS_CLASSES.length - 1,
    Math.floor(hash1(seed + EYE_SIZE_DRAW) * MANTLE_EYE_RADIUS_CLASSES.length),
  );
  return MANTLE_EYE_RADIUS_CLASSES[index];
}

/**
 * The eyes the scatter has to keep clear of. Painted by {@link paintFace}
 * before the scatter runs, so the scatter is the one that has to move.
 */
function primaryEyeDiscs(pose: KrakarenPose, view: ViewSpec, shape: MantleShape): EyeDisc[] {
  if (!view.showsFace) return [];
  return (view.profile ? PROFILE_EYES : PRIMARY_EYES).map((eye) => ({
    centre: pt(shape.rx * eye.x, eye.y + pose.heave),
    rx: eye.rx,
  }));
}

function paintPrimaryEye(ctx: Ctx, eye: PrimaryEye, pose: KrakarenPose, shape: MantleShape): void {
  paintEyeball(ctx, {
    centre: pt(shape.rx * eye.x, eye.y + pose.heave),
    rx: eye.rx,
    ry: eye.ry,
    tilt: deg(eye.tiltDegrees),
    gaze: pose.gaze * eye.gazeShare + eye.gazeBias,
    lid: eye.lid + pose.blink,
    inkWidth: PRIMARY_EYE_INK_WIDTH,
    depth: 0,
    form: 'seeing',
  });
}

/**
 * The two eyes big enough to track with, and the big split below them.
 *
 * There is no beak. A hooked chitin beak between two eyes is the most
 * recognisable single feature an octopus has, and shoving it off the midline
 * only made it a face that was looking away. What sits there now is the largest
 * wound on her, running steeply across the low flank of the dome, well off the
 * centre line and well below either eye. Everything else that reads as features
 * comes from the scatter, which is painted with the mantle and does not know or
 * care where this one is.
 */
function paintFace(ctx: Ctx, pose: KrakarenPose, view: ViewSpec, shape: MantleShape): void {
  // Foreshortened, not flattened: the near eye keeps its full height and loses
  // width.
  const eyes = view.profile ? PROFILE_EYES : PRIMARY_EYES;
  for (const eye of eyes) paintPrimaryEye(ctx, eye, pose, shape);
  const gashX = view.profile ? shape.rx * PROFILE_FACE_GASH_X : FACE_GASH_X;
  paintMouth(ctx, {
    centre: pt(gashX, FACE_GASH_Y + pose.heave),
    angle: FACE_GASH_ANGLE,
    half: FACE_GASH_HALF,
    open: lerp(FACE_GASH_CLOSED_OPEN, 1, clamp01(pose.beakGape)),
    depth: 0,
    seed: FACE_GASH_SEED + view.seed,
  });
}

const PROFILE_FACE_GASH_X = 0.45;

// ── Body tentacle ring ───────────────────────────────────────────────────────

interface RingTentacle {
  readonly spec: TentacleSpec;
  /** 1 nearest the camera, -1 furthest. Decides which side of the mantle it lies. */
  readonly nearness: number;
  /** Painted after the mantle whatever its depth says. */
  readonly overDome: boolean;
  /**
   * What the painter actually sorts on: nearness with a fixed per-tentacle
   * offset, so limbs at similar depths trade places and their masses cross.
   * Sorting strictly by depth is what laid an earlier bake's limbs out in a
   * clean fan with no limb ever passing in front of another.
   */
  readonly layer: number;
}

const SWIPE_REAR_ANGLE_DEGREES = 70;
const SWIPE_REAR_ANGLE = deg(SWIPE_REAR_ANGLE_DEGREES);
/**
 * Where on the ring the lashing limb ends up: square out to whichever flank it
 * started nearest.
 *
 * Aimed at a place on the ring rather than turned by a fixed number of degrees.
 * A fixed swing sends whichever limb the row picked wherever it happens to
 * land — for the front row that was almost straight away from the camera, where
 * a tentacle is at its most foreshortened and half of it is behind the mantle,
 * so the hardest-driven frame of the attack was also its narrowest.
 */
const SWIPE_FLANK_AZIMUTH = Math.PI / 2;
/** How far around the ring the limb winds the other way before it goes. */
const SWIPE_WIND_BACK_DEGREES = 35;
const SWIPE_WIND_BACK = deg(SWIPE_WIND_BACK_DEGREES);
const SWIPE_EXTEND = 0.12;
/**
 * Sharpens the crest of the lash.
 *
 * The row is ten frames and the drive either side of the peak frame samples at
 * about 0.9 of it, which is inside the impact-is-the-peak gate's band: three
 * frames all but tie for "the blow" and the gate cannot tell which was meant.
 * Squaring pulls the neighbours down to about 0.8 and reads as a whip — slow
 * wind, snapped crest — rather than as a limb waved through an arc.
 */
const SWIPE_CREST_SHARPNESS = 2;
const SWIPE_THICKEN = 0.36;
/** The lash straightens as it crosses: a coiled tentacle cannot look like a blow. */
const SWIPE_UNCURL = 0.75;

/**
 * The crest of the swipe, snapped onto the frame the damage actually fires on.
 *
 * `KRAKAREN_SWIPE_IMPACT_PROGRESS` is 0.5 of a ten-frame row, which lands
 * exactly between frames 4 and 5; the bake and the gate both resolve that to
 * frame 5. A crest left at the raw 0.5 is one no frame ever samples, and the
 * two frames either side of it are then drawn equally hard — so which of them
 * reads as the blow is settled by nothing but which side of her body the limb
 * happens to be on that frame. Quantising moves nothing about when the damage
 * fires; it puts the peak of the art on the frame that fires it.
 */
const SWIPE_PEAK_PROGRESS =
  Math.round(KRAKAREN_SWIPE_IMPACT_PROGRESS * (KRAKAREN_SWIPE_FRAMES - 1)) /
  (KRAKAREN_SWIPE_FRAMES - 1);

/** Where in the row the tentacle finishes rearing and starts to travel. */
const SWIPE_REAR_SHARE_OF_IMPACT = 0.55;
const SWIPE_REAR_PEAK = SWIPE_PEAK_PROGRESS * SWIPE_REAR_SHARE_OF_IMPACT;

interface SwipeShape {
  readonly rear: number;
  readonly lash: number;
}

/**
 * The blow lands at full extension, at the end of the swing rather than in the
 * middle of it.
 *
 * The first cut of this row swept the limb symmetrically through the melee arc
 * and crossed the body's centre line on the impact frame. That put the lashing
 * tentacle at its most *tucked in* on the frame the damage fires — the side
 * view's cell was measurably narrower there than at rest — and left the frames
 * either side of the impact drawn equally hard, so which one read as the blow
 * came down to which flank the limb happened to be on. Winding back and then
 * whipping out to a single extreme, with extension and azimuth cresting
 * together on the damage frame, makes the hit the widest and hardest-driven
 * frame in the row in every view.
 */
function swipeShape(progress: number): SwipeShape {
  const p = clamp01(progress);
  return {
    // Gone by the impact frame: a tentacle still cocked on the frame that deals
    // the damage reads as a hit that never happened.
    rear: riseFall(p, SWIPE_REAR_PEAK, SWIPE_PEAK_PROGRESS),
    // Both ends of the row sit on the resting pose, so the one-shot settle
    // check has something to settle onto and the loop out is not a snap.
    lash: Math.pow(peakAt(p, SWIPE_PEAK_PROGRESS), SWIPE_CREST_SHARPNESS),
  };
}

/** The shortest way round from one angle to another, in radians. */
function angleDelta(from: number, to: number): number {
  return ((((to - from + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

function buildRingTentacle(
  index: number,
  pose: KrakarenPose,
  view: ViewSpec,
  shape: MantleShape,
  swipe: SwipeShape | null,
): RingTentacle {
  const limb = RING_LIMBS[index];
  const seed = RING_SEED + index * MOUTH_SEED_STRIDE;
  const restAzimuth = deg(limb.azimuthDegrees) - view.azimuth;
  const flank = Math.sin(restAzimuth) >= 0 ? 1 : -1;
  const toFlank = angleDelta(restAzimuth, flank * SWIPE_FLANK_AZIMUTH);
  const azimuthSwing =
    swipe === null ? 0 : toFlank * swipe.lash - flank * SWIPE_WIND_BACK * swipe.rear;
  const ringA = restAzimuth + azimuthSwing;

  const nearness = Math.cos(ringA);
  const depth = clamp01((1 - nearness) / 2);
  const crown = limb.role === 'crown';
  const stump = limb.role === 'stub';
  const lash = swipe === null ? 0 : swipe.lash;
  const rear = swipe === null ? 0 : swipe.rear;

  // Every limb roots on the same ring, crown limbs included. Rooting a crown on
  // the dome's shoulder instead left the flat cut its tube starts with sitting
  // in the middle of the dome, which reads as a slab bolted on rather than as a
  // limb: the base of a tentacle has to be buried in the heap.
  // A crown limb's root barely rides the ring's depth. It rides it fully for a
  // drape limb — that is the perspective — but a crown limb carries the top of
  // the whole creature, and a root that sits a third of a tile higher when the
  // camera is behind it moves the crest by more than the anchor gate's whole
  // tolerance between one facing row and the next.
  const rootDepth = crown ? CROWN_ROOT_DEPTH_SHARE : 1;
  const root = pt(
    RING_RX * Math.sin(ringA) * limb.rootReach,
    RING_CENTRE_Y + RING_RY * nearness * limb.rootReach * rootDepth + pose.heave,
  );

  const near01 = (nearness + 1) / 2;
  const outX = Math.sin(ringA) * TENTACLE_OUT_X;
  const outY = lerp(TENTACLE_BACK_LIFT, TENTACLE_FRONT_DROOP, near01);
  const drapeAngle =
    Math.atan2(outY, outX) +
    hashRange(seed + BASE_ANGLE_SEED, -TENTACLE_BASE_ANGLE_JITTER, TENTACLE_BASE_ANGLE_JITTER);
  // Straight up and leaning outward, so the curl below has the whole height of
  // the dome to turn the limb back across it.
  //
  // The lean takes only its *side* from the ring, never its size. Scaling it by
  // `sin(ringA)` instead stood a crown limb facing the camera bolt upright and
  // laid the same limb over at a third of a radian from the side, which moved
  // the top of the whole creature by a quarter of a tile between one facing row
  // and the next — more than twice what the anchor gate can absorb.
  const crownAngle = -Math.PI / 2 + (Math.sin(ringA) >= 0 ? 1 : -1) * CROWN_LEAN;
  const baseAngle = (crown ? crownAngle : drapeAngle) - rear * SWIPE_REAR_ANGLE;

  // Foreshortening: a limb swung toward or away from the camera keeps its
  // girth and loses its length. Flattening it instead is what makes a ring of
  // tentacles read as a flat pinwheel.
  //
  // A crown limb is exempt because it stands up rather than reaching out: its
  // length runs along the camera's vertical, which no azimuth shortens. Applying
  // the ring's foreshortening to it also moved the top of the whole creature by
  // a third of a tile between views, which is the one thing the anchor gate
  // cannot absorb.
  const foreshorten = crown ? 1 : lerp(1, FORESHORTEN_MIN, Math.abs(nearness));
  // A lashing limb pulls itself out to full length whatever its resting share
  // is: the impact-is-the-peak gate reads the blow off the frame's own width,
  // and a limb that happens to have drawn a short straw never widens the cell.
  const rest = (crown ? CROWN_LENGTH : TENTACLE_LENGTH) * limb.lengthShare;
  const reach = lerp(rest, crown ? CROWN_LENGTH : TENTACLE_LENGTH, lash);
  const length =
    reach * foreshorten * (1 - pose.brace * BRACE_LENGTH_PULL) * (1 + lash * SWIPE_EXTEND);

  // A crown limb always turns inward, over the dome. A drape limb turns
  // whichever way its own `hook` says, which is what piles the heap up: a limb
  // hooking back lays its mass over the roots of the two either side of it.
  const drapeSign = crown
    ? -(Math.sin(ringA) >= 0 ? 1 : -1)
    : (Math.sin(ringA) >= 0 ? 1 : -1) * limb.hook;
  const curl =
    (crown ? CROWN_CURL : TENTACLE_CURL) *
    limb.curlShare *
    drapeSign *
    (1 + pose.brace * BRACE_CURL_GAIN) *
    (1 - lash * SWIPE_UNCURL);

  const phase = (pose.coil + (index / KRAKAREN_TENTACLE_COUNT) * pose.coilSpread) * TWO_PI;
  const width = TENTACLE_BASE_WIDTH * limb.widthShare * (crown ? CROWN_WIDTH_SHARE : 1);
  const tipWidth = stump
    ? width * STUB_TIP_SHARE
    : TENTACLE_TIP_WIDTH *
      hashRange(seed + TIP_WIDTH_SEED, TENTACLE_TIP_VARIANCE_MIN, TENTACLE_TIP_VARIANCE_MAX);

  return {
    nearness,
    // A crown limb is drawn over the dome whatever its depth says, because
    // burying one behind the mantle is the same as not having drawn it.
    overDome: crown,
    layer: nearness + limb.layerBias,
    spec: {
      root,
      baseAngle,
      length,
      baseWidth: width * (1 + lash * SWIPE_THICKEN),
      tipWidth,
      curl,
      curlBias: crown ? CROWN_CURL_BIAS : TENTACLE_CURL_BIAS,
      wave: (crown ? CROWN_WAVE : COIL_WAVE) * drapeSign * (1 - pose.brace * BRACE_WAVE_DAMP),
      waveCycles: crown ? CROWN_WAVE_CYCLES : COIL_WAVE_CYCLES,
      wavePhase: phase,
      taperPower: stump ? STUB_TAPER_POWER : TENTACLE_TAPER_POWER,
      depth,
      seed,
      mouths: Math.round(hashRange(seed + MOUTH_COUNT_SEED, BODY_MOUTHS_MIN, BODY_MOUTHS_MAX)),
      eyes: Math.round(hashRange(seed + EYE_COUNT_SEED, 0, BODY_EYES_MAX)),
      mouthSize: BODY_MOUTH_SIZE,
      mouthCycle: pose.mouthCycle + (index / KRAKAREN_TENTACLE_COUNT) * pose.mouthSpread,
      mouthSpread: pose.mouthSpread,
      splay: 0,
      stump,
      // A limb in the heap is modelled by the heap: its depth, the pocket under
      // the dome, and whatever is lying on top of it.
      solitary: 0,
    },
  };
}

const FORESHORTEN_MIN = 0.62;
const TENTACLE_BASE_ANGLE_JITTER = 0.22;
const BASE_ANGLE_SEED = 11;
const TIP_WIDTH_SEED = 23;
const MOUTH_COUNT_SEED = 37;
const EYE_COUNT_SEED = 43;

// ── Body assembly ────────────────────────────────────────────────────────────

/** Nearness at or below which a tentacle is painted behind the mantle. */
const BEHIND_MANTLE_NEARNESS = 0;

/**
 * The pocket of shadow the heaped limbs sit in, laid over everything already
 * painted there.
 *
 * A limb crossing that pocket was being drawn in the plain flesh midtone, which
 * is the brightest large-area colour on her: the result was a bright convex
 * patch of pink sitting in the darkest part of the creature, and the eye went
 * to it before it went to anything she is actually made of. It is composited
 * `source-atop` so it can only ever darken flesh that is already there — a
 * plain fill would paint a dark ellipse into the empty air beside her.
 */
const POCKET_SHADOW_RX = 0.66;
const POCKET_SHADOW_RY = 0.3;
const POCKET_SHADOW_Y = -0.44;
const POCKET_SHADOW_ALPHA = 0.46;

/**
 * The shadow a limb lying over the dome throws onto it.
 *
 * Without one, a limb crossing the mantle in the plain midtone against a dome
 * only a little darker is separated from it by nothing but a hairline of ink —
 * and a hairline between two similar values is read as a *crease*, so four
 * crown limbs cut the dome into flat panels and the whole creature folded up
 * into origami. A limb with a shadow under it is lying on something.
 */
const DOME_CAST_OFFSET = 0.07;
const DOME_CAST_ALPHA = 0.46;

function paintDomeCastShadow(ctx: Ctx, spec: TentacleSpec, dome: readonly Pt[]): void {
  const outline = tentacleOutline(buildTentacleSpine(spec), spec);
  ctx.save();
  tracePolygon(ctx, dome);
  ctx.clip();
  tracePolygon(
    ctx,
    outline.map((p) =>
      pt(p.x + LIGHT_DIR.x * DOME_CAST_OFFSET, p.y + LIGHT_DIR.y * DOME_CAST_OFFSET),
    ),
  );
  ctx.fillStyle = rgba(FLESH_DEEP, DOME_CAST_ALPHA);
  ctx.fill();
  ctx.restore();
}

function drawKrakaren(ctx: Ctx, view: ViewSpec, pose: KrakarenPose): void {
  const shape = mantleShape(pose, view);
  const swipe = pose.swipe === null ? null : swipeShape(pose.swipe.progress);

  paintContactShadow(ctx, 0, BODY_SHADOW_RX * view.girth, BODY_SHADOW_RY, CONTACT_SHADOW_ALPHA);

  ctx.save();
  ctx.translate(swipeLean(pose, view, swipe), 0);

  const ring: RingTentacle[] = [];
  for (let i = 0; i < KRAKAREN_TENTACLE_COUNT; i++) {
    const lashing = pose.swipe !== null && pose.swipe.tentacle === i;
    ring.push(buildRingTentacle(i, pose, view, shape, lashing ? swipe : null));
  }
  ring.sort((a, b) => a.layer - b.layer);

  const behind = (tentacle: RingTentacle): boolean =>
    !tentacle.overDome && tentacle.nearness <= BEHIND_MANTLE_NEARNESS;
  for (const tentacle of ring) {
    if (behind(tentacle)) paintTentacle(ctx, tentacle.spec);
  }
  paintMantle(ctx, pose, view, shape);
  const dome = mantleOutline(shape);
  for (const tentacle of ring) {
    if (tentacle.overDome) paintDomeCastShadow(ctx, tentacle.spec, dome);
  }
  for (const tentacle of ring) {
    if (!behind(tentacle)) paintTentacle(ctx, tentacle.spec);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  fillEllipse(
    ctx,
    pt(0, POCKET_SHADOW_Y + pose.heave),
    POCKET_SHADOW_RX * view.girth,
    POCKET_SHADOW_RY,
    rgba(FLESH_DEEP, POCKET_SHADOW_ALPHA),
  );
  ctx.restore();

  ctx.restore();
}

/**
 * How far she hauls herself the other way as a tentacle whips out.
 *
 * A rooted creature throwing a limb of its own girth out to full length on one
 * flank has to put something the other way, or the whole mass simply moves — and
 * on the side row, where the ring's own clustering already leans her a couple of
 * pixels, the lash's peak frame carried her ink centroid nearly six pixels off
 * her contact point. The counterweight is worth about three of those, and it is
 * the pose a body braced against a blow actually takes.
 */
const SWIPE_LEAN = 0.055;

function swipeLean(pose: KrakarenPose, view: ViewSpec, swipe: SwipeShape | null): number {
  if (pose.swipe === null || swipe === null) return 0;
  const restAzimuth = deg(RING_LIMBS[pose.swipe.tentacle].azimuthDegrees) - view.azimuth;
  const flank = Math.sin(restAzimuth) >= 0 ? 1 : -1;
  return -flank * SWIPE_LEAN * swipe.lash;
}

/** Head-on, eyes at the camera. */
export function drawKrakarenFront(ctx: Ctx, pose: KrakarenPose): void {
  drawKrakaren(ctx, VIEWS.front, pose);
}

/** In profile, always facing +X. The runtime mirrors it for the other side. */
export function drawKrakarenSide(ctx: Ctx, pose: KrakarenPose): void {
  drawKrakaren(ctx, VIEWS.side, pose);
}

/** From behind. No face — the dorsal ridges carry the dome instead. */
export function drawKrakarenBack(ctx: Ctx, pose: KrakarenPose): void {
  drawKrakaren(ctx, VIEWS.back, pose);
}

// ── Guard tentacle ───────────────────────────────────────────────────────────

const GUARD_BURST_RADIUS = 0.5;
const GUARD_SWAY_ANGLE_DEGREES = 16;
const GUARD_SWAY_ANGLE = deg(GUARD_SWAY_ANGLE_DEGREES);
const GUARD_SWAY_WAVE = 0.45;
const GUARD_WAVE_CYCLES = 0.7;
const GUARD_REST_CURL_DEGREES = 24;
const GUARD_REST_CURL = deg(GUARD_REST_CURL_DEGREES);
const GUARD_TAPER_POWER = 0.7;
const GUARD_SEED = 907;
/** The burst fades once the tentacle is up; only the emergence throws floor. */
const GUARD_EMERGE_BURST_PEAK = 0.3;
const GUARD_IDLE_BURST = 0.35;
/** The broken floor a risen or retracted tentacle always leaves behind. */
const GROUND_HOLE_BURST = 0.32;
const GUARD_STRIKE_REAR_DEGREES = 55;
const GUARD_STRIKE_REAR = deg(GUARD_STRIKE_REAR_DEGREES);
const GUARD_STRIKE_LASH_DEGREES = 95;
const GUARD_STRIKE_LASH = deg(GUARD_STRIKE_LASH_DEGREES);
const GUARD_STRIKE_EXTEND = 0.3;
const GUARD_REAR_SHARE_OF_IMPACT = 0.5;
const GUARD_STRIKE_REAR_PEAK = TENTACLE_STRIKE_IMPACT_PROGRESS * GUARD_REAR_SHARE_OF_IMPACT;
/** A strike aimed at or away from the camera is shorter on screen and fatter. */
const GUARD_VIEW_FORESHORTEN = 0.66;
const GUARD_VIEW_THICKEN = 1.2;

interface GuardShape {
  /** 0 fully underground, 1 at full height. */
  readonly risen: number;
  readonly burst: number;
  readonly rear: number;
  readonly lash: number;
}

function guardShape(pose: GuardTentaclePose): GuardShape {
  const p = clamp01(pose.progress);
  switch (pose.phase) {
    case 'emerge':
      return { risen: easeInOut(p), burst: peakAt(p, GUARD_EMERGE_BURST_PEAK), rear: 0, lash: 0 };
    case 'idle':
      return { risen: 1, burst: GUARD_IDLE_BURST, rear: 0, lash: 0 };
    case 'strike':
      return {
        risen: 1,
        burst: GUARD_IDLE_BURST,
        // Cocked well before the connect and unwound by it, so the frame the
        // damage lands on is the frame the tentacle is fully driven over.
        rear: riseFall(p, GUARD_STRIKE_REAR_PEAK, TENTACLE_STRIKE_IMPACT_PROGRESS),
        lash: peakAt(p, TENTACLE_STRIKE_IMPACT_PROGRESS),
      };
    case 'retreat':
      return { risen: easeInOut(1 - p), burst: GUARD_IDLE_BURST, rear: 0, lash: 0 };
  }
}

/** Which way a strike in this view whips across the screen. */
function strikeTurnSign(view: KrakarenView): number {
  return view === 'back' ? -1 : 1;
}

/** A strike toward the camera drives the tip down the screen; away, up it. */
const GUARD_FRONT_PLUNGE = 1;
const GUARD_BACK_PLUNGE = -0.55;
const GUARD_SIDE_PLUNGE = 0.6;

function strikePlunge(view: KrakarenView): number {
  switch (view) {
    case 'side':
      return GUARD_SIDE_PLUNGE;
    case 'front':
      return GUARD_FRONT_PLUNGE;
    case 'back':
      return GUARD_BACK_PLUNGE;
  }
}

export function drawGuardTentacle(ctx: Ctx, pose: GuardTentaclePose): void {
  const shape = guardShape(pose);
  const striking = pose.phase === 'strike';
  // Ramped in with the strike rather than applied flat across the row: a whip
  // aimed at the camera is foreshortened while it travels, but on the row's
  // first frame it has not moved yet, and a row that opens already shortened
  // jumps the moment the idle hands over to it.
  const facing = striking && pose.strikeView !== 'side' ? Math.max(shape.rear, shape.lash) : 0;
  const foreshorten = lerp(1, GUARD_VIEW_FORESHORTEN, facing);
  const thicken = lerp(1, GUARD_VIEW_THICKEN, facing);

  // The hole never closes: a frame with the tentacle fully under the floor and
  // no broken ground in it is a blank cell, which the bake has nothing to
  // anchor and the player reads as a dropped frame.
  paintGroundBurst(ctx, GUARD_BURST_RADIUS, Math.max(shape.burst, GROUND_HOLE_BURST), GUARD_SEED);
  if (shape.risen <= 0) return;

  paintContactShadow(
    ctx,
    0,
    GUARD_BURST_RADIUS * GUARD_SHADOW_SHARE,
    GUARD_BURST_RADIUS * GUARD_SHADOW_SHARE * DUST_RY_SHARE,
    CONTACT_SHADOW_ALPHA * shape.risen,
  );

  const sway = Math.sin(pose.sway * TWO_PI) * GUARD_SWAY_ANGLE;
  const turn = striking ? strikeTurnSign(pose.strikeView) : 1;
  const plunge = striking ? strikePlunge(pose.strikeView) : 0;

  // Straight up at rest; the rear tips it back, the lash drives it over.
  const baseAngle =
    -Math.PI / 2 + sway + (shape.lash * GUARD_STRIKE_LASH - shape.rear * GUARD_STRIKE_REAR) * turn;
  // Only the strike's own turn takes the sign. Folding the resting curl into it
  // too flips the tentacle's lie the instant the away row starts, and again the
  // instant it ends, which the runtime plays as a pop straight out of the idle.
  const curl = GUARD_REST_CURL + shape.lash * GUARD_STRIKE_LASH * plunge * turn;

  const spec: TentacleSpec = {
    root: pt(0, 0),
    baseAngle,
    length: GUARD_HEIGHT * shape.risen * foreshorten * (1 + shape.lash * GUARD_STRIKE_EXTEND),
    baseWidth: GUARD_BASE_WIDTH * thicken,
    tipWidth: GUARD_TIP_WIDTH * thicken,
    curl,
    curlBias: TENTACLE_CURL_BIAS,
    wave: GUARD_SWAY_WAVE * Math.cos(pose.sway * TWO_PI),
    waveCycles: GUARD_WAVE_CYCLES,
    wavePhase: pose.sway * TWO_PI,
    taperPower: GUARD_TAPER_POWER,
    depth: 0,
    seed: GUARD_SEED,
    mouths: GUARD_MOUTH_COUNT,
    eyes: GUARD_EYE_COUNT,
    mouthSize: GUARD_MOUTH_SIZE,
    mouthCycle: pose.mouthCycle,
    mouthSpread: RESTING_MOUTH_SPREAD,
    splay: 0,
    stump: false,
    solitary: 1,
  };
  paintEmergenceCollar(ctx, GUARD_BASE_WIDTH, shape.risen, GUARD_SEED, false);
  paintTentacle(ctx, spec);
  paintEmergenceCollar(ctx, GUARD_BASE_WIDTH, shape.risen, GUARD_SEED, true);

  const spine = buildTentacleSpine(spec);
  const tip = sampleSpine(spine, GUARD_TIP_CLUSTER_T);
  paintMouthCluster(ctx, {
    centre: tip.point,
    angle: tip.angle,
    count: GUARD_TIP_CLUSTER_COUNT,
    size: Math.min(GUARD_TIP_CLUSTER_SIZE, tip.width * MOUTH_WIDTH_LIMIT_SHARE),
    spread: GUARD_TIP_CLUSTER_SPREAD * shape.risen,
    mouthCycle: pose.mouthCycle,
    mouthSpread: RESTING_MOUTH_SPREAD,
    depth: 0,
    seed: GUARD_SEED + GUARD_TIP_CLUSTER_SEED,
  });

  // An eye just below the knot. Gashes alone read as a wound; one eye above
  // them is what makes the tip a head that is looking at the player.
  const brow = sampleSpine(spine, GUARD_TIP_EYE_T);
  const acrossBrow = normalAt(brow.angle, 1);
  paintEyeball(ctx, {
    centre: pt(
      brow.point.x + acrossBrow.x * brow.width * GUARD_TIP_EYE_ACROSS,
      brow.point.y + acrossBrow.y * brow.width * GUARD_TIP_EYE_ACROSS,
    ),
    rx: GUARD_TIP_EYE_RADIUS,
    ry: GUARD_TIP_EYE_RADIUS * GUARD_TIP_EYE_SQUASH,
    tilt: brow.angle,
    gaze: GUARD_TIP_EYE_GAZE,
    lid: GUARD_TIP_EYE_LID,
    inkWidth: SMALL_EYE_INK_WIDTH,
    depth: 0,
    form: 'seeing',
  });
}

const GUARD_TIP_EYE_SQUASH = 0.82;
const GUARD_TIP_EYE_GAZE = -0.4;
const GUARD_TIP_EYE_LID = 0.14;

const GUARD_SHADOW_SHARE = 1.2;
const GUARD_TIP_CLUSTER_SEED = 29;

// ── Slam tentacle ────────────────────────────────────────────────────────────

const SLAM_BURST_RADIUS = 0.85;
const SLAM_SEED = 1291;
const SLAM_TAPER_POWER = 0.72;
const SLAM_REST_CURL_DEGREES = 22;
const SLAM_REST_CURL = deg(SLAM_REST_CURL_DEGREES);
const SLAM_LOOM_SWAY_DEGREES = 20;
const SLAM_LOOM_SWAY = deg(SLAM_LOOM_SWAY_DEGREES);
const SLAM_LOOM_WAVE = 0.7;
const SLAM_LOOM_CYCLES = 1.1;
const SLAM_RISE_BURST_PEAK = 0.28;
const SLAM_DIVE_BURST_PEAK = 0.55;
/** The smash drives the trunk over from vertical to nearly flat on the floor. */
const SLAM_SMASH_ARC_DEGREES = 105;
const SLAM_SMASH_ARC = deg(SLAM_SMASH_ARC_DEGREES);
const SLAM_SMASH_BURST_PEAK = SLAM_SMASH_IMPACT_PROGRESS;
/** After the hit the row is the retract: the trunk slides back under the floor. */
const SLAM_RETRACT_START = 0.45;
const SLAM_SMASH_HEIGHT_SHARE = 0.8;
/**
 * When the fan of fronds is thrown out, as shares of the impact progress.
 *
 * Finished *before* the hit rather than on it. A fan still opening on the
 * damage frame makes the frame after it the widest in the row, and the
 * impact-is-the-peak gate reads the blow off exactly that width.
 */
const SLAM_SPLAY_RAMP_FROM = 0.35;
const SLAM_SPLAY_RAMP_TO = 0.86;
/**
 * The floor coming apart under the fronds, and the ring of dust it throws.
 *
 * The emergence point has thrown broken floor since the first bake and the
 * *landing* point never had anything at all, so the payoff pose was an arm
 * hanging in mid air. The runtime paints the kill-radius ring over the top of
 * this; what is baked here is the hit itself.
 */
const SLAM_LANDING_T = 0.97;
const SLAM_LANDING_RADIUS = 0.5;
/** How far ahead of the hit the floor starts to go. */
const SLAM_LANDING_LEAD = 0.6;
const SLAM_LANDING_FADE_END = 0.8;
const SLAM_LANDING_SEED = 3557;
/**
 * The bounce off her own blow.
 *
 * Between the hit at 0.2 and the retract at 0.45 every dial in the pose was
 * already at its extreme and none of them moved: three frames of a twelve-frame
 * row were the same drawing, and one adjacent pair changed 1512px of ink where
 * every other pair in the row changes four to ten thousand. Nothing here moves
 * the hit — the drive still crests on the contract's own frame — it is what the
 * trunk does *after* it, which is where the dead air was.
 */
/**
 * How many half-swings the trunk takes settling, and how far each of them turns
 * it.
 *
 * A damped oscillation rather than one rise and fall: a single hump over the
 * quarter of the row between the hit and the retract has a flat top in the
 * middle of it wherever the peak is put, and a flat top is the stall this
 * exists to remove.
 */
const SLAM_RECOIL_BOUNCES = 2;
const SLAM_RECOIL_CURL = 0.46;

interface SlamShape {
  readonly risen: number;
  readonly burst: number;
  readonly drive: number;
  readonly splay: number;
  readonly sway: number;
  /** How hard the floor is breaking under the fronds, 0 to 1. */
  readonly landing: number;
  /** How far the dust ring has travelled out from the contact point, 0 to 1. */
  readonly shock: number;
  /** How far the trunk has rebounded off its own blow, 0 to 1. */
  readonly recoil: number;
}

const SLAM_NO_IMPACT = { landing: 0, shock: 0, recoil: 0 } as const;

function slamShape(pose: SlamTentaclePose): SlamShape {
  const p = clamp01(pose.progress);
  const quiver = Math.sin(pose.coil * TWO_PI) * SLAM_LOOM_SWAY;
  switch (pose.phase) {
    case 'rise':
      return {
        risen: easeInOut(p),
        burst: peakAt(p, SLAM_RISE_BURST_PEAK),
        drive: 0,
        splay: 0,
        sway: quiver,
        ...SLAM_NO_IMPACT,
      };
    case 'loom':
      return {
        risen: 1,
        burst: GUARD_IDLE_BURST,
        drive: 0,
        splay: 0,
        sway: quiver,
        ...SLAM_NO_IMPACT,
      };
    case 'dive':
      return {
        risen: easeInOut(1 - p),
        burst: peakAt(p, SLAM_DIVE_BURST_PEAK),
        drive: 0,
        splay: 0,
        sway: quiver,
        ...SLAM_NO_IMPACT,
      };
    case 'smash': {
      const drive = easeInOut(ramp(p, 0, SLAM_SMASH_IMPACT_PROGRESS));
      const since = ramp(p, SLAM_SMASH_IMPACT_PROGRESS, 1);
      const recoil = Math.sin(since * Math.PI * SLAM_RECOIL_BOUNCES) * (1 - since);
      const struck = easeInOut(
        ramp(p, SLAM_SMASH_IMPACT_PROGRESS * SLAM_LANDING_LEAD, SLAM_SMASH_IMPACT_PROGRESS),
      );
      const settled = easeInOut(ramp(p, SLAM_SMASH_IMPACT_PROGRESS, SLAM_LANDING_FADE_END));
      return {
        risen:
          easeInOut(ramp(p, 0, SLAM_SMASH_IMPACT_PROGRESS * SLAM_SMASH_RISE_SHARE)) *
          (1 - easeInOut(ramp(p, SLAM_RETRACT_START, 1))) *
          SLAM_SMASH_HEIGHT_SHARE,
        burst: peakAt(p, SLAM_SMASH_BURST_PEAK),
        drive,
        splay: clamp01(
          ramp(
            p,
            SLAM_SMASH_IMPACT_PROGRESS * SLAM_SPLAY_RAMP_FROM,
            SLAM_SMASH_IMPACT_PROGRESS * SLAM_SPLAY_RAMP_TO,
          ),
        ),
        sway: 0,
        landing: struck * (1 - settled),
        shock: settled,
        recoil,
      };
    }
  }
}

const SLAM_SMASH_RISE_SHARE = 0.7;

export function drawSlamTentacle(ctx: Ctx, pose: SlamTentaclePose): void {
  const shape = slamShape(pose);

  paintGroundBurst(ctx, SLAM_BURST_RADIUS, Math.max(shape.burst, GROUND_HOLE_BURST), SLAM_SEED);
  if (shape.risen <= 0) return;

  paintContactShadow(
    ctx,
    0,
    SLAM_BURST_RADIUS,
    SLAM_BURST_RADIUS * DUST_RY_SHARE,
    CONTACT_SHADOW_ALPHA * shape.risen,
  );

  const spec: TentacleSpec = {
    root: pt(0, 0),
    baseAngle: -Math.PI / 2 + shape.sway + shape.drive * SLAM_SMASH_ARC,
    length: SLAM_HEIGHT * shape.risen,
    baseWidth: SLAM_BASE_WIDTH,
    tipWidth: SLAM_TIP_WIDTH,
    curl: SLAM_REST_CURL + shape.drive * SLAM_SMASH_ARC * (1 + shape.recoil * SLAM_RECOIL_CURL),
    curlBias: TENTACLE_CURL_BIAS,
    wave: SLAM_LOOM_WAVE * Math.cos(pose.coil * TWO_PI) * (1 - shape.drive),
    waveCycles: SLAM_LOOM_CYCLES,
    wavePhase: pose.coil * TWO_PI,
    taperPower: SLAM_TAPER_POWER,
    depth: 0,
    seed: SLAM_SEED,
    mouths: SLAM_MOUTH_COUNT,
    eyes: SLAM_EYE_COUNT,
    mouthSize: SLAM_MOUTH_SIZE,
    mouthCycle: pose.mouthCycle,
    mouthSpread: RESTING_MOUTH_SPREAD,
    splay: shape.splay,
    stump: false,
    solitary: 1,
  };

  // The floor goes before the flesh does: painted after the tentacle the dust
  // and the shards would be lying on the arm rather than under it.
  if (shape.landing > 0) {
    const contact = sampleSpine(buildTentacleSpine(spec), SLAM_LANDING_T);
    ctx.save();
    ctx.translate(contact.point.x, contact.point.y);
    paintLandingBurst(
      ctx,
      SLAM_LANDING_RADIUS,
      shape.landing,
      shape.shock,
      SLAM_SEED + SLAM_LANDING_SEED,
    );
    ctx.restore();
  }

  paintEmergenceCollar(ctx, SLAM_BASE_WIDTH, shape.risen, SLAM_SEED, false);
  paintTentacle(ctx, spec);
  paintEmergenceCollar(ctx, SLAM_BASE_WIDTH, shape.risen, SLAM_SEED, true);
}
