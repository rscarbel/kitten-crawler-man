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

const HEAD_CENTER_Y = -0.3;
const HEAD_RADIUS_X = 0.067;
const HEAD_RADIUS_Y = 0.082;
const JAW_Y = HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.9;

const NECK_HALF_WIDTH = 0.026;
const NECK_TOP_Y = JAW_Y - 0.01;

const SHOULDER_Y = -0.185;
const SHOULDER_HALF_WIDTH = 0.098;
const BUST_Y = -0.115;
const BUST_HALF_WIDTH = 0.104;
const WAIST_Y = -0.005;
const WAIST_HALF_WIDTH = 0.058;
const HIP_Y = 0.105;
const HIP_HALF_WIDTH = 0.098;
const CROTCH_Y = 0.175;
const CROTCH_HALF_WIDTH = 0.036;

/** Bust apex — the point the hair locks are required to cover. */
const BUST_POINT_X = 0.052;
const BUST_POINT_Y = -0.1;
const BUST_UNDERCURVE_RADIUS = 0.042;
/** Only the lower outside of the circle is drawn, so it reads as a soft crease. */
const BUST_UNDERCURVE_ARC_START = HALF_TURN * 0.12;
const BUST_UNDERCURVE_ARC_END = HALF_TURN * 0.72;

/* ── Back view ─────────────────────────────────────────────────────────── */

const SHOULDER_BLADE_X = 0.05;
const SHOULDER_BLADE_TOP_Y = -0.155;
const SHOULDER_BLADE_BOTTOM_Y = -0.075;
const SHOULDER_BLADE_FLARE = 0.02;
/**
 * The book puts the small fish on her shoulder blade. At this hair length the
 * blades themselves sit under her hair, so a fish drawn there would never be
 * seen at all — it rides just below the hairline instead, which is the closest
 * spot that actually reads.
 */
const BACK_FISH_X = 0.052;
const BACK_FISH_Y = 0.0;
const BACK_OF_HEAD_WIDTH_FRACTION = 1.08;
const BACK_OF_HEAD_HEIGHT_FRACTION = 1.02;

/* ── Legs ──────────────────────────────────────────────────────────────── */

const LEG_TOP_Y = HIP_Y - 0.01;
const KNEE_Y = 0.3;
const ANKLE_Y = 0.42;
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

const FOOT_HALF_WIDTH = 0.022;
/** Lifts the foot ellipse so its lower edge lands on the floor line. */
const FOOT_CENTER_RISE = 0.012;

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
/** The shoulders counter-rotate against the hips. */
const WALK_SHOULDER_ROLL = 0.055;
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
const FRONT_LOCK_BOTTOM_Y = -0.045;
const FRONT_LOCK_CENTER_X = BUST_POINT_X;
const FRONT_LOCK_HALF_WIDTH = 0.036;
/** How far the tapered tip of each lock runs past its bottom anchor. */
const FRONT_LOCK_TIP_LENGTH = 0.024;
const FRONT_LOCK_ROOT_HALF_WIDTH = 0.022;
/** Sideways drift of the lock tips; kept far smaller than the lock half-width. */
const FRONT_LOCK_DRIFT = 0.006;
const FRONT_LOCK_DRIFT_SPEED = 0.7;

/** The single length every fall of her hair ends at — the front locks' tips. */
const HAIR_LENGTH_Y = FRONT_LOCK_BOTTOM_Y + FRONT_LOCK_TIP_LENGTH;

const BACK_HAIR_HALF_WIDTH = 0.128;
const BACK_HAIR_TOP_Y = HEAD_CENTER_Y - HEAD_RADIUS_Y * 0.85;
const BACK_HAIR_BOTTOM_Y = HAIR_LENGTH_Y;
const BACK_HAIR_FLARE_Y = -0.15;

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

const EYE_X = 0.028;
const EYE_Y = HEAD_CENTER_Y - 0.004;
const EYE_RADIUS_X = 0.015;
const EYE_RADIUS_Y = 0.011;
const PUPIL_RADIUS = 0.006;
const EYE_GLOW_BLUR_IDLE_PX = 2;
const EYE_GLOW_BLUR_CAST_PX = 14;
/** The tile size the pixel blur radii above were chosen against. */
const GLOW_REFERENCE_TILE_PX = 32;
const INK_GLOW_BLUR_PX = 4;

const MOUTH_Y = HEAD_CENTER_Y + 0.045;
const MOUTH_HALF_WIDTH = 0.018;
const FANG_X = 0.012;
const FANG_HALF_WIDTH = 0.006;
const FANG_LENGTH = 0.014;

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
export const SIGNET_HALF_WIDTH =
  (SHOULDER_HALF_WIDTH * ARM_ROOT_X_FRACTION +
    UPPER_ARM_LENGTH +
    FOREARM_LENGTH +
    HAND_RADIUS +
    NAIL_LENGTH +
    WALK_HIP_SHIFT) *
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
const HAIR_DARK = '#12101c';
const HAIR_SHEEN = '#3a3550';
const THONG_COLOR = '#2a2c3d';
const THONG_TRIM = '#4a4d68';
const HORN_COLOR = '#4b4257';
const INK_COLOR = '#141a2a';
const INK_GLOW_COLOR = '#7fe6d4';
/** Charged ink — still dark enough to read against her skin. */
const INK_LIT_COLOR = '#0d5f57';
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

function pathTorso(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.quadraticCurveTo(-BUST_HALF_WIDTH, BUST_Y - 0.02, -BUST_HALF_WIDTH, BUST_Y + 0.02);
  ctx.quadraticCurveTo(-WAIST_HALF_WIDTH - 0.01, WAIST_Y - 0.04, -WAIST_HALF_WIDTH, WAIST_Y);
  ctx.quadraticCurveTo(-HIP_HALF_WIDTH, HIP_Y - 0.05, -HIP_HALF_WIDTH, HIP_Y);
  ctx.quadraticCurveTo(-HIP_HALF_WIDTH + 0.02, CROTCH_Y, -CROTCH_HALF_WIDTH, CROTCH_Y);
  ctx.lineTo(CROTCH_HALF_WIDTH, CROTCH_Y);
  ctx.quadraticCurveTo(HIP_HALF_WIDTH - 0.02, CROTCH_Y, HIP_HALF_WIDTH, HIP_Y);
  ctx.quadraticCurveTo(HIP_HALF_WIDTH, HIP_Y - 0.05, WAIST_HALF_WIDTH, WAIST_Y);
  ctx.quadraticCurveTo(WAIST_HALF_WIDTH + 0.01, WAIST_Y - 0.04, BUST_HALF_WIDTH, BUST_Y + 0.02);
  ctx.quadraticCurveTo(BUST_HALF_WIDTH, BUST_Y - 0.02, SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.quadraticCurveTo(NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.lineTo(-NECK_HALF_WIDTH, NECK_TOP_Y);
  ctx.quadraticCurveTo(-NECK_HALF_WIDTH * 2, SHOULDER_Y - 0.02, -SHOULDER_HALF_WIDTH, SHOULDER_Y);
  ctx.closePath();
}

function pathLeg(ctx: CanvasRenderingContext2D, side: BodySide, swing: number, lift: number): void {
  const hipX = side * LEG_HIP_X;
  const kneeX = side * LEG_KNEE_X + swing;
  const ankleX = side * LEG_ANKLE_X + swing * WALK_ANKLE_SWING_RATIO;
  const kneeY = KNEE_Y - lift * KNEE_LIFT_SHARE;
  const ankleY = ANKLE_Y - lift;
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
  ctx.quadraticCurveTo(
    hipX - side * (THIGH_HALF_WIDTH * 0.7),
    thighMidY,
    hipX - side * THIGH_HALF_WIDTH * 0.6,
    LEG_TOP_Y,
  );
  ctx.closePath();
}

/* ══ Body parts ═════════════════════════════════════════════════════════ */

function drawScalePatch(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = SCALE_COLOR;
  ctx.globalAlpha = SCALE_ALPHA;
  ctx.lineWidth = SCALE_CELL * SCALE_LINE_WIDTH_FRACTION;
  const rows = Math.ceil(height / SCALE_CELL);
  const columns = Math.ceil(width / SCALE_CELL);
  for (let row = 0; row < rows; row++) {
    const rowOffset = row % 2 === 0 ? 0 : SCALE_CELL / 2;
    for (let column = 0; column < columns; column++) {
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

function drawLegs(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  swingPhase: number,
  castGlow: number,
  tileSizePx: number,
): void {
  const INNER_THIGH_SHADE_WIDTH = 0.018;
  const INNER_THIGH_SHADE_ALPHA = 0.35;
  const SCALE_PATCH_INSET = 0.01;
  const SCALE_PATCH_WIDTH = 0.11;

  for (const side of SIDES) {
    const stridePhase = swingPhase * side;
    const swing = stridePhase * WALK_LEG_SWING;
    const lift = Math.max(0, stridePhase) * WALK_FOOT_LIFT;
    const footX = side * LEG_ANKLE_X + swing * WALK_ANKLE_SWING_RATIO;

    ctx.save();

    ctx.fillStyle = SKIN_BASE;
    ctx.beginPath();
    ctx.ellipse(
      footX,
      FOOT_Y - FOOT_CENTER_RISE - lift,
      FOOT_HALF_WIDTH,
      FOOT_Y - ANKLE_Y,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    pathLeg(ctx, side, swing, lift);
    ctx.fillStyle = side < 0 ? SKIN_BASE : SKIN_LIT;
    ctx.fill();

    ctx.save();
    pathLeg(ctx, side, swing, lift);
    ctx.clip();

    const scalePatchLeft = side > 0 ? SCALE_PATCH_INSET : -SCALE_PATCH_INSET - SCALE_PATCH_WIDTH;
    drawScalePatch(ctx, scalePatchLeft, LEG_TOP_Y, SCALE_PATCH_WIDTH, KNEE_Y - LEG_TOP_Y);

    ctx.fillStyle = SKIN_SHADE;
    ctx.globalAlpha = INNER_THIGH_SHADE_ALPHA;
    const innerEdgeX = side * (LEG_HIP_X - THIGH_HALF_WIDTH);
    ctx.fillRect(
      Math.min(innerEdgeX, innerEdgeX + side * INNER_THIGH_SHADE_WIDTH),
      LEG_TOP_Y,
      INNER_THIGH_SHADE_WIDTH,
      KNEE_Y - LEG_TOP_Y,
    );
    ctx.globalAlpha = 1;

    applyInkStyle(ctx, castGlow, tileSizePx);
    if (side < 0) {
      stampTattoo(ctx, drawThreeHeadedOgreMotif, timeSec, {
        x: -LEG_HIP_X,
        y: 0.21,
        size: 0.085,
        phase: 1.1,
      });
      stampTattoo(ctx, drawEelLightningMotif, timeSec, {
        x: -LEG_KNEE_X,
        y: 0.35,
        size: 0.07,
        phase: 3.7,
        detail: true,
      });
    } else {
      stampTattoo(ctx, drawHammerheadSharkMotif, timeSec, {
        x: LEG_HIP_X,
        y: 0.215,
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
const THONG_STRAP_SPAN = 0.9;
const THONG_PANEL_SPAN = 0.52;
const THONG_PANEL_BOTTOM_Y = CROTCH_Y - 0.005;

function drawThong(ctx: CanvasRenderingContext2D, facingAway: boolean): void {
  ctx.save();
  pathTorso(ctx);
  ctx.clip();

  ctx.fillStyle = THONG_COLOR;
  if (facingAway) {
    // From behind it is a string, and her hair covers it regardless — only the
    // hip straps are ever drawn.
    ctx.fillRect(
      -HIP_HALF_WIDTH * THONG_STRAP_SPAN,
      THONG_STRAP_Y - THONG_STRAP_HEIGHT,
      HIP_HALF_WIDTH * THONG_STRAP_SPAN * 2,
      THONG_STRAP_HEIGHT,
    );
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(-HIP_HALF_WIDTH * THONG_PANEL_SPAN, THONG_STRAP_Y);
  ctx.lineTo(HIP_HALF_WIDTH * THONG_PANEL_SPAN, THONG_STRAP_Y);
  ctx.quadraticCurveTo(
    HIP_HALF_WIDTH * THONG_PANEL_SPAN * 0.5,
    THONG_PANEL_BOTTOM_Y,
    0,
    THONG_PANEL_BOTTOM_Y,
  );
  ctx.quadraticCurveTo(
    -HIP_HALF_WIDTH * THONG_PANEL_SPAN * 0.5,
    THONG_PANEL_BOTTOM_Y,
    -HIP_HALF_WIDTH * THONG_PANEL_SPAN,
    THONG_STRAP_Y,
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(
    -HIP_HALF_WIDTH * THONG_STRAP_SPAN,
    THONG_STRAP_Y - THONG_STRAP_HEIGHT,
    HIP_HALF_WIDTH * THONG_STRAP_SPAN * 2,
    THONG_STRAP_HEIGHT,
  );

  ctx.strokeStyle = THONG_TRIM;
  ctx.lineWidth = HAIRLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-HIP_HALF_WIDTH * THONG_STRAP_SPAN, THONG_STRAP_Y - THONG_STRAP_HEIGHT);
  ctx.lineTo(HIP_HALF_WIDTH * THONG_STRAP_SPAN, THONG_STRAP_Y - THONG_STRAP_HEIGHT);
  ctx.stroke();

  ctx.restore();
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  castGlow: number,
  tileSizePx: number,
  facingAway: boolean,
): void {
  pathTorso(ctx);
  ctx.fillStyle = SKIN_LIT;
  ctx.fill();

  ctx.save();
  pathTorso(ctx);
  ctx.clip();

  // Waist and flank shading — the hourglass reads from the shading, not the outline
  ctx.fillStyle = SKIN_SHADE;
  ctx.globalAlpha = FLANK_SHADE_ALPHA;
  ctx.beginPath();
  for (const side of SIDES) {
    ctx.ellipse(
      side * WAIST_HALF_WIDTH,
      WAIST_Y,
      FLANK_SHADE_RADIUS_X,
      FLANK_SHADE_RADIUS_Y,
      0,
      0,
      Math.PI * 2,
    );
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  if (facingAway) {
    // Shoulder blades and the spine channel
    ctx.strokeStyle = SKIN_DEEP_SHADE;
    ctx.lineWidth = BUST_UNDERCURVE_LINE_WIDTH;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.moveTo(side * SHOULDER_BLADE_X, SHOULDER_BLADE_TOP_Y);
      ctx.quadraticCurveTo(
        side * (SHOULDER_BLADE_X + SHOULDER_BLADE_FLARE),
        (SHOULDER_BLADE_TOP_Y + SHOULDER_BLADE_BOTTOM_Y) / 2,
        side * SHOULDER_BLADE_X * 0.6,
        SHOULDER_BLADE_BOTTOM_Y,
      );
      ctx.stroke();
    }
    ctx.strokeStyle = SKIN_SHADE;
    ctx.lineWidth = CONTOUR_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(0, SHOULDER_BLADE_TOP_Y);
    ctx.lineTo(0, HIP_Y);
    ctx.stroke();
  } else {
    // Bust undercurve only — no forward detail is ever drawn, and the hair
    // locks cover the apexes on top of that
    ctx.strokeStyle = SKIN_DEEP_SHADE;
    ctx.lineWidth = BUST_UNDERCURVE_LINE_WIDTH;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(
        side * BUST_POINT_X,
        BUST_POINT_Y,
        BUST_UNDERCURVE_RADIUS,
        BUST_UNDERCURVE_ARC_START,
        BUST_UNDERCURVE_ARC_END,
      );
      ctx.stroke();
    }
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

  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  ctx.ellipse(0, HEAD_CENTER_Y, HEAD_RADIUS_X, HEAD_RADIUS_Y, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = SKIN_SHADE;
  ctx.globalAlpha = CHEEK_SHADE_ALPHA;
  ctx.beginPath();
  ctx.ellipse(
    -HEAD_RADIUS_X * 0.55,
    HEAD_CENTER_Y + HEAD_RADIUS_Y * 0.2,
    HEAD_RADIUS_X * 0.35,
    HEAD_RADIUS_Y * 0.4,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

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

  // Eyes — a permanent faint shine that flares while she casts
  ctx.save();
  ctx.shadowColor = castGlow > 0 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  ctx.shadowBlur =
    (EYE_GLOW_BLUR_IDLE_PX + (EYE_GLOW_BLUR_CAST_PX - EYE_GLOW_BLUR_IDLE_PX) * castGlow) *
    (tileSizePx / GLOW_REFERENCE_TILE_PX);
  ctx.fillStyle = castGlow > 0.5 ? EYE_CAST_COLOR : EYE_IDLE_COLOR;
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.ellipse(side * EYE_X, EYE_Y, EYE_RADIUS_X, EYE_RADIUS_Y, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Pupils vanish as the glow takes the eye over
  if (castGlow < 1) {
    ctx.fillStyle = HAIR_DARK;
    ctx.globalAlpha = 1 - castGlow;
    for (const side of SIDES) {
      ctx.beginPath();
      ctx.arc(side * EYE_X, EYE_Y, PUPIL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = SKIN_DEEP_SHADE;
  ctx.lineWidth = FINE_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-MOUTH_HALF_WIDTH, MOUTH_Y);
  ctx.quadraticCurveTo(0, MOUTH_Y + 0.012, MOUTH_HALF_WIDTH, MOUTH_Y);
  ctx.stroke();

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

  drawBackHair(ctx, swingPhase * WALK_HAIR_SWAY);
  drawLegs(ctx, timeSec, swingPhase, eyeGlow, glowTileSizePx);

  // Hips shift onto the planted foot and the shoulders roll back against them;
  // that opposition is what makes the front-on walk read as a walk.
  ctx.save();
  ctx.translate(swingPhase * WALK_HIP_SHIFT, 0);
  ctx.rotate(-swingPhase * WALK_SHOULDER_ROLL);
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
