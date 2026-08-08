/**
 * The eleven pieces the Krakaren Clone and her guard tentacles come apart into.
 *
 * Two keyed creatures live here because they are one creature's flesh: the boss
 * drops seven pieces off the `krakaren` sheet, a killed guard tentacle drops
 * four off the `krakaren_tentacle` sheet, and a player who has seen one set must
 * recognise the other as having come off the same animal. The gashes are what
 * carry that — they are painted by `paintMouth` / `paintMouthCluster` out of
 * `krakarenArt.ts`, the same two functions the living creature is drawn with, so
 * a severed mouth is literally her mouth rather than a hand-matched imitation.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered Krakaren's injuries are
 * recognisably the same ones a dismembered rat has.
 *
 * The suckers are re-drawn here rather than borrowed from `paintTentacle`. That
 * painter rolls its ventral rows, its specular and its rim onto whichever side
 * of the tube faces a fixed key light, and `BodyPartGoreSystem` tumbles every
 * piece continuously: a directional cue is wrong most of the time a gore piece
 * is on screen. What is shared instead is the geometry — a sucker row inset on
 * one flank of a tapered tube — lit ambiently through `paintGoreMass`.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. Eleven cells
 * tumbling past at 16 px must not read as eleven identical pink blobs, so the
 * set spreads across a tapered dome with one dead eye in it, a gaping pair of
 * chitin mandibles, a ball on a stalk, a long bowed limb, a tight spiral,
 * a slab split by three gashes and watched by an eye, an open coil of gut, a
 * short cone capped by a knot of them, a fat barrel cut at both ends, a flared stump with the
 * lair floor still stuck in it, and a thin pale flap of sucker skin.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell; the bake re-centres each piece's ink there before writing.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import {
  AMBIENT_ALPHA,
  BLOOD,
  BLOOD_DARK,
  BLOOD_GLOSS,
  drawWound,
  grownOutline,
  paintGoreMass,
} from './goreWound.js';
import { paintMouth, paintMouthCluster } from './krakarenArt.js';
import {
  TWO_PI,
  type Pt,
  clamp01,
  deg,
  hash1,
  lerp,
  mix,
  ovalOutline,
  rgba,
  traceOutline,
} from './ratArt.js';

/**
 * How many tiles across one gore cell is baked. Her pieces are large — the
 * mantle alone is over two tiles wide on the living boss — so they are baked
 * with more room than a rat's and let down to size by the runtime.
 */
export const GORE_PIECE_SCALE = 1.7;

// ── Krakaren tones, as seen on a severed piece ───────────────────────────────

/**
 * Darker than the tones the living creature is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and flesh
 * painted at her standing brightness comes out reading as a pink pebble.
 */
const FLESH_MID = '#93375f';
const FLESH_DARK = '#3a0f27';
const FLESH_LIGHT = '#c96b96';
/** The pale ventral side, where the sucker rows run. */
const VENTRAL_MID = '#b4788f';
const VENTRAL_DARK = '#582e40';
const VENTRAL_LIGHT = '#e5bccb';
const GUT_MID = '#7c3d53';
const GUT_DARK = '#30111d';
const GUT_LIGHT = '#a86178';
/** The broken lair floor, embedded in the guard tentacle's root. */
const RUBBLE_MID = '#4a2a39';
const RUBBLE_DARK = '#1e0f19';
const RUBBLE_LIGHT = '#7d5567';
const SLIME = '#d96ea0';

const SCLERA_DEAD = '#cabeb6';
const IRIS_DEAD = '#a08543';
const PUPIL_DEAD = '#130810';
const OUTLINE_INK = '#180611';

interface Tone {
  readonly mid: string;
  readonly dark: string;
  readonly light: string;
}

const FLESH_TONE: Tone = { mid: FLESH_MID, dark: FLESH_DARK, light: FLESH_LIGHT };
const VENTRAL_TONE: Tone = { mid: VENTRAL_MID, dark: VENTRAL_DARK, light: VENTRAL_LIGHT };
const GUT_TONE: Tone = { mid: GUT_MID, dark: GUT_DARK, light: GUT_LIGHT };

type Trace = (grow: number) => void;

function paintMass(ctx: Ctx, trace: Trace, tone: Tone): void {
  paintGoreMass(ctx, trace, tone, OUTLINE_INK);
}

/** Traces a polygon outline grown outward from its own centroid. */
function tracerFor(ctx: Ctx, outline: readonly Pt[]): Trace {
  return (grow: number): void => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Halfway along a span — the offset that samples the centre of a step. */
const CENTRE = 0.5;

/** A deterministic value somewhere in `[min, max]`, so re-bakes are identical. */
function hashRange(seed: number, min: number, max: number): number {
  return lerp(min, max, hash1(seed));
}

// ── Tapered tubes ────────────────────────────────────────────────────────────

const SEGMENT_WOBBLE = 0.07;
const SEGMENT_LOBES = 2.3;

/** Tapered capsules threaded through a bent tube, as one closed outline. */
function chainOutline(points: readonly Pt[], halves: readonly number[], seed: number): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const nx = Math.cos(angle - Math.PI / 2);
    const ny = Math.sin(angle - Math.PI / 2);
    const half = halves[i] * (1 + SEGMENT_WOBBLE * Math.sin(i * SEGMENT_LOBES + seed));
    left.push(pt(here.x + nx * half, here.y + ny * half));
    right.push(pt(here.x - nx * half, here.y - ny * half));
  }
  return [...left, ...right.reverse()];
}

/**
 * A length of tentacle: its spine, the local half-width along it, the tangent
 * at every station, and the closed outline that wraps the lot. Everything a
 * piece needs to put suckers and mouths on the flesh it just painted.
 */
interface Chain {
  readonly points: readonly Pt[];
  readonly halves: readonly number[];
  readonly angles: readonly number[];
  readonly outline: readonly Pt[];
}

function makeChain(points: readonly Pt[], halves: readonly number[], seed: number): Chain {
  const angles = points.map((_unused, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    return Math.atan2(next.y - prev.y, next.x - prev.x);
  });
  return { points, halves, angles, outline: chainOutline(points, halves, seed) };
}

interface ChainSample {
  readonly point: Pt;
  readonly angle: number;
  readonly half: number;
}

function sampleChain(chain: Chain, t: number): ChainSample {
  const last = chain.points.length - 1;
  const position = clamp01(t) * last;
  const index = Math.min(last - 1, Math.floor(position));
  const frac = position - index;
  const a = chain.points[index];
  const b = chain.points[index + 1];
  return {
    point: pt(lerp(a.x, b.x, frac), lerp(a.y, b.y, frac)),
    angle: lerp(chain.angles[index], chain.angles[index + 1], frac),
    half: lerp(chain.halves[index], chain.halves[index + 1], frac),
  };
}

/** Half-widths tapering from root to tip; the power front-loads the girth. */
function taperedHalves(count: number, rootHalf: number, tipHalf: number, power: number): number[] {
  return Array.from({ length: count }, (_unused, i) =>
    lerp(rootHalf, tipHalf, Math.pow(i / (count - 1), power)),
  );
}

/** Thick and muscular for the first third, then a long taper. Linear reads as rope. */
const TUBE_TAPER_POWER = 0.66;

// ── Flesh texture ────────────────────────────────────────────────────────────

const MOTTLE_COUNT = 12;
const MOTTLE_ALPHA = 0.36;
const MOTTLE_MIN = 0.1;
const MOTTLE_RANGE = 0.18;
const MOTTLE_SQUASH = 0.78;
const MOTTLE_ACROSS_STRIDE = 3.7;
const MOTTLE_DOWN_STRIDE = 7.1;
const MOTTLE_DOWN_OFFSET = 31;
const MOTTLE_SIZE_STRIDE = 11.3;
const MOTTLE_SPIN_STRIDE = 2.3;

/** Blotching over a patch of flesh, clipped to it. */
function mottleFlesh(ctx: Ctx, trace: Trace, seed: number, spread: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.globalAlpha = MOTTLE_ALPHA;
  ctx.fillStyle = FLESH_DARK;
  for (let i = 0; i < MOTTLE_COUNT; i++) {
    const x = (hash1(seed + i * MOTTLE_ACROSS_STRIDE) - CENTRE) * 2 * spread;
    const y = (hash1(seed + i * MOTTLE_DOWN_STRIDE + MOTTLE_DOWN_OFFSET) - CENTRE) * 2 * spread;
    const r = spread * (MOTTLE_MIN + hash1(seed + i * MOTTLE_SIZE_STRIDE) * MOTTLE_RANGE);
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      r,
      r * MOTTLE_SQUASH,
      hash1(seed + i * MOTTLE_SPIN_STRIDE) * Math.PI,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

const SUCKER_FIRST_T = 0.1;
const SUCKER_LAST_T = 0.92;
const SUCKER_INSET = 0.42;
/** Suckers shrink faster than the tube does, so the row crowds toward the tip. */
const SUCKER_RADIUS_SHARE = 0.36;
const SUCKER_PIT_SHARE = 0.5;
const SUCKER_SQUASH = 0.8;
const SUCKER_LIP_ALPHA = 0.45;
const SUCKER_LIP_LIFT = 0.3;
const SUCKER_CUP_ALPHA = 0.78;
const SUCKER_PIT_ALPHA = 0.72;
const SUCKER_RIM_ALPHA = 0.55;
const SUCKER_RIM_WIDTH = 0.005;

/**
 * A row of ventral suckers inset on one flank of a tube. `side` is +1 or -1 and
 * chooses which flank — a fixed choice per piece rather than one derived from a
 * light direction, because the piece is tumbling.
 */
function paintSuckerRow(
  ctx: Ctx,
  chain: Chain,
  trace: Trace,
  count: number,
  side: number,
  sizeShare: number,
): void {
  ctx.save();
  trace(0);
  ctx.clip();
  for (let i = 0; i < count; i++) {
    const t = lerp(SUCKER_FIRST_T, SUCKER_LAST_T, count === 1 ? CENTRE : i / (count - 1));
    const sample = sampleChain(chain, t);
    const nx = -Math.sin(sample.angle) * side;
    const ny = Math.cos(sample.angle) * side;
    const centre = pt(
      sample.point.x + nx * sample.half * SUCKER_INSET,
      sample.point.y + ny * sample.half * SUCKER_INSET,
    );
    const r = sample.half * sizeShare;
    // A lit lip above, a dark cup, a near-black hole. The living creature's
    // suckers were re-cut as recesses so nothing on her could be mistaken for
    // one of her eyes, and a severed piece has to carry the same flesh: a pale
    // ring with a dark middle *is* an eye, and these pieces have real dead eyes
    // on them to be told apart from.
    ctx.fillStyle = rgba(VENTRAL_MID, SUCKER_LIP_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      centre.x - nx * r * SUCKER_LIP_LIFT,
      centre.y - ny * r * SUCKER_LIP_LIFT,
      r,
      r * SUCKER_SQUASH,
      sample.angle,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = rgba(VENTRAL_DARK, SUCKER_CUP_ALPHA);
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, r, r * SUCKER_SQUASH, sample.angle, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(FLESH_DARK, SUCKER_PIT_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      centre.y,
      r * SUCKER_PIT_SHARE,
      r * SUCKER_PIT_SHARE * SUCKER_SQUASH,
      sample.angle,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = rgba(OUTLINE_INK, SUCKER_RIM_ALPHA);
    ctx.lineWidth = SUCKER_RIM_WIDTH;
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, r, r * SUCKER_SQUASH, sample.angle, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The blood a piece is lying in, and the drips still running off it.
 *
 * Two of the eleven had none at all, and a length of viscera with no blood
 * anywhere on it does not read as viscera: the gut came back from a blind
 * naming as "a croissant, a segmented hose, a fat pale worm" and the flap of
 * sucker skin as "a leaf". Nothing else separates a piece of an animal from a
 * piece of a thing at 16px.
 */
const POOL_WOBBLE = 0.34;
const POOL_ALPHA = 0.82;
const POOL_CORE_SHARE = 0.58;
const POOL_GLOSS_SHARE = 0.3;
const POOL_GLOSS_AT = -0.35;
const DRIP_COUNT = 4;
const DRIP_LENGTH_MIN = 0.3;
const DRIP_LENGTH_MAX = 0.85;
const DRIP_WIDTH_SHARE = 0.45;
const DRIP_ARC_DEGREES = 150;
const DRIP_ARC = deg(DRIP_ARC_DEGREES);
const DRIP_SEED_STRIDE = 47;
const DRIP_SIZE_STRIDE = 89;
const POOL_CORE_SEED = 137;

function paintBloodPool(ctx: Ctx, at: Pt, rx: number, ry: number, runAngle: number, seed: number) {
  const pool = ovalOutline(at.x, at.y, rx, ry, runAngle, seed, POOL_WOBBLE);
  ctx.fillStyle = rgba(BLOOD, POOL_ALPHA);
  traceOutline(ctx, pool);
  ctx.fill();
  ctx.fillStyle = rgba(BLOOD_DARK, POOL_ALPHA);
  traceOutline(
    ctx,
    ovalOutline(
      at.x,
      at.y,
      rx * POOL_CORE_SHARE,
      ry * POOL_CORE_SHARE,
      runAngle,
      seed + POOL_CORE_SEED,
      POOL_WOBBLE,
    ),
  );
  ctx.fill();
  ctx.fillStyle = BLOOD_GLOSS;
  ctx.beginPath();
  ctx.ellipse(
    at.x + rx * POOL_GLOSS_AT,
    at.y + ry * POOL_GLOSS_AT,
    rx * POOL_GLOSS_SHARE,
    ry * POOL_GLOSS_SHARE * MOTTLE_SQUASH,
    runAngle,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = BLOOD;
  for (let i = 0; i < DRIP_COUNT; i++) {
    const around =
      runAngle + lerp(-CENTRE, CENTRE, (i + CENTRE) / DRIP_COUNT) * DRIP_ARC + hash1(seed + i);
    const reach =
      Math.max(rx, ry) * hashRange(seed + i * DRIP_SEED_STRIDE, DRIP_LENGTH_MIN, DRIP_LENGTH_MAX);
    const wide = Math.min(rx, ry) * DRIP_WIDTH_SHARE * (1 + hash1(seed + i * DRIP_SIZE_STRIDE));
    ctx.beginPath();
    ctx.ellipse(
      at.x + Math.cos(around) * reach * CENTRE,
      at.y + Math.sin(around) * reach * CENTRE,
      reach * CENTRE,
      wide,
      around,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** How much of the local tube width one mouth is allowed to take. */
const MOUTH_WIDTH_LIMIT_SHARE = 0.85;

/** One gash split into a length of tentacle, at `t` along its spine. */
function paintChainMouth(
  ctx: Ctx,
  chain: Chain,
  t: number,
  size: number,
  open: number,
  seed: number,
): void {
  const sample = sampleChain(chain, t);
  paintMouth(ctx, {
    centre: sample.point,
    angle: sample.angle,
    half: Math.min(size, sample.half * MOUTH_WIDTH_LIMIT_SHARE),
    open,
    depth: 0,
    seed,
  });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

const DOME_STEPS = 56;
/** How far the dome pinches in toward its apex. A pure ellipse reads as an egg. */
const DOME_APEX_TAPER = 0.2;
const DOME_WOBBLE = 0.05;
const DOME_WOBBLE_LOBES = 3;

/** The mantle silhouette: a tall dome over a short round skirt. */
function domeOutline(rx: number, upperRy: number, lowerRy: number, seed: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < DOME_STEPS; i++) {
    const theta = (i / DOME_STEPS) * TWO_PI;
    const up = Math.cos(theta);
    const ry = up > 0 ? upperRy : lowerRy;
    const apex = Math.max(0, up);
    const taper = 1 - DOME_APEX_TAPER * apex * apex;
    const wobble = 1 + DOME_WOBBLE * Math.sin(theta * DOME_WOBBLE_LOBES + seed);
    points.push(pt(rx * Math.sin(theta) * taper * wobble, -up * ry * wobble));
  }
  return points;
}

/** How far along the mandible the hook's control point sits. */

// ── The pieces ───────────────────────────────────────────────────────────────

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const BODY_SEED_BASE = 5171;
const TENTACLE_SEED_BASE = 7717;
const SEED_STEP = 941;

/**
 * A source of construction-time seeds.
 *
 * Seeds are drawn **when the piece list is built**, never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be
 * applied to another and every piece would bake off-centre in its cell. The
 * same rule is what lets the review harness's onion and delta modes diff two
 * paints of the same piece and see nothing but the change under test.
 */
function seedSource(base: number): () => number {
  let drawn = 0;
  return () => base + drawn++ * SEED_STEP;
}

// ── Body: the seven pieces off the boss ──────────────────────────────────────

const MANTLE_HALF_WIDTH = 0.215;
const MANTLE_UPPER_RY = 0.2;
const MANTLE_LOWER_RY = 0.105;
const MANTLE_EYE_X = -0.075;
const MANTLE_EYE_Y = -0.075;
const MANTLE_EYE_RX = 0.062;
const MANTLE_EYE_RY = 0.052;
const EYE_IRIS_SHARE = 0.6;
const EYE_PUPIL_WIDTH_SHARE = 0.88;
const EYE_PUPIL_HEIGHT_SHARE = 0.3;
const EYE_INK_WIDTH = 0.008;
/** A dead eye is a slack eye: the lid has come halfway down and stayed there. */
const DEAD_LID_DROP = 0.42;
const DEAD_LID_ALPHA = 0.9;
const MANTLE_RIDGE_COUNT = 3;
const MANTLE_RIDGE_ALPHA = 0.3;
const MANTLE_RIDGE_WIDTH = 0.009;
const MANTLE_RIDGE_SPAN = 0.55;
const MANTLE_RIDGE_BOW = 1.4;

/** The dull, filmed-over eye every piece that carries one shares. */
function paintDeadEye(ctx: Ctx, centre: Pt, rx: number, ry: number, gaze: number): void {
  ctx.fillStyle = SCLERA_DEAD;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  const irisX = centre.x + rx * gaze;
  ctx.fillStyle = IRIS_DEAD;
  ctx.beginPath();
  ctx.ellipse(irisX, centre.y, rx * EYE_IRIS_SHARE, ry * EYE_IRIS_SHARE, 0, 0, TWO_PI);
  ctx.fill();
  // A horizontal bar pupil. It is the single cue that says cephalopod rather
  // than mammal, and it survives the downscale where an iris pattern does not.
  ctx.fillStyle = PUPIL_DEAD;
  ctx.beginPath();
  ctx.ellipse(
    irisX,
    centre.y,
    rx * EYE_IRIS_SHARE * EYE_PUPIL_WIDTH_SHARE,
    ry * EYE_IRIS_SHARE * EYE_PUPIL_HEIGHT_SHARE,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, TWO_PI);
  ctx.clip();
  ctx.fillStyle = rgba(FLESH_MID, DEAD_LID_ALPHA);
  ctx.fillRect(centre.x - rx, centre.y - ry, rx * 2, ry * 2 * DEAD_LID_DROP);
  ctx.restore();

  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = EYE_INK_WIDTH;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, TWO_PI);
  ctx.stroke();
}

const EYEBALL_R = 0.088;
const EYEBALL_SQUASH = 0.94;
const OPTIC_STATIONS = 4;
const OPTIC_ROOT_HALF = 0.042;
const OPTIC_TIP_HALF = 0.018;
const OPTIC_TAPER_POWER = 0.9;
const OPTIC_STRAND_COUNT = 4;
const OPTIC_STRAND_ALPHA = 0.7;
const OPTIC_STRAND_WIDTH = 0.008;
const OPTIC_STRAND_REACH = 0.075;
const OPTIC_STRAND_ARC_DEGREES = 70;
const OPTIC_STRAND_ARC = deg(OPTIC_STRAND_ARC_DEGREES);
const EYEBALL_WOBBLE = 0.03;

const TENTACLE_A_STEPS = 12;
const TENTACLE_A_FROM_X = -0.25;
const TENTACLE_A_TO_X = 0.22;
const TENTACLE_A_FROM_Y = 0.15;
const TENTACLE_A_TO_Y = -0.16;
const TENTACLE_A_BOW = 0.13;
const TENTACLE_A_ROOT_HALF = 0.062;
const TENTACLE_A_TIP_HALF = 0.014;
const TENTACLE_A_SUCKERS = 9;
const TENTACLE_A_MOUTH_SIZE = 0.05;
const TENTACLE_A_MOUTH_NEAR_T = 0.32;
const TENTACLE_A_MOUTH_FAR_T = 0.62;
const TENTACLE_A_MOUTH_NEAR_OPEN = 0.85;
const TENTACLE_A_MOUTH_FAR_OPEN = 0.15;

const TENTACLE_B_STEPS = 17;
const TENTACLE_B_TURNS = 1.12;
const TENTACLE_B_START_DEGREES = 195;
const TENTACLE_B_START_ANGLE = deg(TENTACLE_B_START_DEGREES);
const TENTACLE_B_START_RADIUS = 0.2;
const TENTACLE_B_END_RADIUS = 0.045;
const TENTACLE_B_SQUASH = 0.86;
const TENTACLE_B_ROOT_HALF = 0.056;
const TENTACLE_B_TIP_HALF = 0.013;
const TENTACLE_B_SUCKERS = 11;
const TENTACLE_B_MOUTH_SIZE = 0.045;
const TENTACLE_B_MOUTH_T = 0.24;
const TENTACLE_B_MOUTH_OPEN = 0.55;

const SLAB_RX = 0.185;
const SLAB_RY = 0.145;
const SLAB_WOBBLE = 0.15;
const SLAB_MOUTH_BIG_HALF = 0.105;
const SLAB_MOUTH_SMALL_HALF = 0.072;
const SLAB_MOUTH_BIG_AT = { x: -0.045, y: -0.045 } as const;
const SLAB_MOUTH_SMALL_AT = { x: 0.075, y: 0.055 } as const;
const SLAB_MOUTH_BIG_DEGREES = -14;
const SLAB_MOUTH_SMALL_DEGREES = 38;
const SLAB_MOUTH_BIG_ANGLE = deg(SLAB_MOUTH_BIG_DEGREES);
const SLAB_MOUTH_SMALL_ANGLE = deg(SLAB_MOUTH_SMALL_DEGREES);
const SLAB_TOP_BITE_FROM = 0.55;
const SLAB_TOP_BITE_UNTIL = 0.68;
const SLAB_TOP_BITE_X = 0.86;
const SLAB_TOP_BITE_Y = 0.38;
const SLAB_END_BITE_FROM = 0.86;
const SLAB_END_BITE_UNTIL = 0.97;
const SLAB_END_BITE_X = 0.6;
const SLAB_END_BITE_Y = 0.8;
const SLAB_MOUTH_BIG_OPEN = 1;
const SLAB_MOUTH_SMALL_OPEN = 0.35;
const SLAB_MOUTH_THIRD_HALF = 0.055;
const SLAB_MOUTH_THIRD_AT = { x: -0.105, y: 0.075 } as const;
const SLAB_MOUTH_THIRD_DEGREES = 74;
const SLAB_MOUTH_THIRD_ANGLE = deg(SLAB_MOUTH_THIRD_DEGREES);
const SLAB_MOUTH_THIRD_OPEN = 0.62;
const SLAB_EYE_AT = { x: 0.085, y: -0.062 } as const;
const SLAB_EYE_RX = 0.042;
const SLAB_EYE_RY = 0.036;
const SLAB_EYE_GAZE = 0.2;

/** Keeps two gashes on one piece from being torn along the same ragged edge. */
const GASH_SEED_OFFSET = 313;

const GUT_COIL_RADIUS = 0.12;
const GUT_TURNS = 0.74;
const GUT_STEPS = 22;
const GUT_START_DEGREES = 150;
const GUT_START_ANGLE = deg(GUT_START_DEGREES);
const GUT_TAIL_FROM = 0.82;
const GUT_TAIL_REACH = 1.5;
const GUT_TAIL_DROP = 0.8;
const GUT_STRETCH = 1.2;
const GUT_ROOT_HALF = 0.05;
const GUT_TIP_HALF = 0.03;
const GUT_SEGMENT_FIRST = 2;
const GUT_SEGMENT_STEP_MIN = 1.2;
const GUT_SEGMENT_STEP_MAX = 4.6;
const GUT_SEGMENT_STEP_SEED = 401;
const GUT_SEGMENT_MIN = 0.45;
const GUT_SEGMENT_ALPHA = 0.5;
const GUT_SEGMENT_WIDTH = 0.01;
const GUT_SEGMENT_REACH = 0.05;
const GUT_LUMP = 0.22;
const GUT_LUMP_LOBES = 5.3;
const GUT_LUMP_FAST = 0.11;
const GUT_LUMP_FAST_LOBES = 12.7;
const GUT_POOL_X = 0.45;
const GUT_POOL_Y = 1.05;
const GUT_POOL_RX = 0.95;
const GUT_POOL_RY = 0.42;
const GUT_POOL_ANGLE_DEGREES = 12;
const GUT_WET_COUNT = 7;
const GUT_WET_STRIDE = 23;
const GUT_WET_INSET = 0.4;
const GUT_WET_MIN_SHARE = 0.16;
const GUT_WET_MAX_SHARE = 0.4;
const GUT_WOUND_SHARE = 1.0;
const GUT_WOUND_SQUASH = 0.44;
const GUT_TEAR_SHARE = 1.5;
/** Keeps the gut's two ends, and the blood under it, from tearing alike. */
const GUT_ROOT_TEAR_SEED = 811;
const GUT_TAIL_TEAR_SEED = 971;
const GUT_SHEEN_ALPHA_GAIN = 1.5;
const GUT_SAC_RX = 0.075;
const GUT_SAC_RY = 0.058;
const GUT_SAC_AT = { x: -0.135, y: 0.045 } as const;

/**
 * The seven body pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Every seed below is drawn here, at construction — see {@link seedSource}.
 */
export function krakarenGorePieces(): readonly GorePiece[] {
  const nextSeed = seedSource(BODY_SEED_BASE);

  const mantleSeed = nextSeed();
  const mantleMottleSeed = nextSeed();
  const mantleWoundSeed = nextSeed();
  const mantle: GorePiece = {
    state: 'gore_mantle',
    paint: (ctx) => {
      const outline = domeOutline(MANTLE_HALF_WIDTH, MANTLE_UPPER_RY, MANTLE_LOWER_RY, mantleSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, mantleMottleSeed, MANTLE_HALF_WIDTH);

      // Ridges over the dome. A bare taper is a pink egg, and the set already
      // has two rounded pieces in it.
      ctx.save();
      trace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(FLESH_DARK, MANTLE_RIDGE_ALPHA);
      ctx.lineWidth = MANTLE_RIDGE_WIDTH;
      ctx.lineCap = 'round';
      for (let i = 0; i < MANTLE_RIDGE_COUNT; i++) {
        const across =
          lerp(-1, 1, (i + CENTRE) / MANTLE_RIDGE_COUNT) * MANTLE_HALF_WIDTH * MANTLE_RIDGE_SPAN;
        ctx.beginPath();
        ctx.moveTo(across, -MANTLE_UPPER_RY * CENTRE);
        ctx.quadraticCurveTo(across * MANTLE_RIDGE_BOW, 0, across, MANTLE_LOWER_RY * CENTRE);
        ctx.stroke();
      }
      ctx.restore();

      paintDeadEye(
        ctx,
        pt(MANTLE_EYE_X, MANTLE_EYE_Y),
        MANTLE_EYE_RX,
        MANTLE_EYE_RY,
        MANTLE_EYE_GAZE,
      );
      // A second, smaller one nowhere near it. Her dome carries a scatter of
      // eyes over the two big ones, so one eye on the severed dome is a mammal.
      paintDeadEye(
        ctx,
        pt(MANTLE_SPARE_EYE_X, MANTLE_SPARE_EYE_Y),
        MANTLE_EYE_RX * MANTLE_SPARE_EYE_SHARE,
        MANTLE_EYE_RY * MANTLE_SPARE_EYE_SHARE,
        MANTLE_SPARE_EYE_GAZE,
      );

      // Torn off the tentacle ring, which sat under the skirt: the wound goes
      // on the underside and its blood runs down away from the dome.
      drawWound(ctx, {
        kind: 'torn',
        centre: pt(MANTLE_HALF_WIDTH * MANTLE_WOUND_X, MANTLE_LOWER_RY * MANTLE_WOUND_Y),
        radius: MANTLE_WOUND_RADIUS,
        squash: MANTLE_WOUND_SQUASH,
        angle: deg(MANTLE_WOUND_ANGLE_DEGREES),
        bones: [],
        runAngle: deg(MANTLE_WOUND_RUN_DEGREES),
        seed: mantleWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const stubSeed = nextSeed();
  const stubMottleSeed = nextSeed();
  const stubWoundSeed = nextSeed();
  const stub: GorePiece = {
    state: 'gore_stub',
    paint: (ctx) => {
      // The creature has no beak to lose. What she does carry is limbs already
      // torn off short, and this is one of those knocked the rest of the way
      // off: a stout wedge of a tube, blunt at both ends, split across the tip.
      const spine: Pt[] = [];
      for (let i = 0; i <= STUB_STEPS; i++) {
        const t = i / STUB_STEPS;
        spine.push(
          pt(
            lerp(STUB_FROM_X, STUB_TO_X, t) + Math.sin(t * Math.PI) * STUB_BOW,
            lerp(STUB_FROM_Y, STUB_TO_Y, t),
          ),
        );
      }
      const chain = makeChain(
        spine,
        taperedHalves(spine.length, STUB_ROOT_HALF, STUB_TIP_HALF, STUB_TAPER_POWER),
        stubSeed,
      );
      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, stubMottleSeed, STUB_ROOT_HALF);
      paintSuckerRow(ctx, chain, trace, STUB_SUCKERS, -1, SUCKER_RADIUS_SHARE);

      paintChainMouth(ctx, chain, STUB_MOUTH_T, STUB_MOUTH_SIZE, STUB_MOUTH_OPEN, stubSeed);
      // The split across the torn end, gaping. It is the whole read of the
      // piece: without it this is a sausage.
      paintMouth(ctx, {
        centre: spine[spine.length - 1],
        angle: chain.angles[chain.angles.length - 1] + Math.PI / 2,
        half: STUB_TIP_HALF * STUB_TEAR_SHARE,
        open: 1,
        depth: 0,
        seed: stubSeed + GASH_SEED_OFFSET,
      });
      paintDeadEye(ctx, pt(STUB_EYE_X, STUB_EYE_Y), STUB_EYE_RX, STUB_EYE_RY, STUB_EYE_GAZE);

      drawWound(ctx, {
        kind: 'crushed',
        centre: spine[0],
        radius: STUB_WOUND_RADIUS,
        squash: STUB_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: stubWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const eyeSeed = nextSeed();
  const eyeWoundSeed = nextSeed();
  const eye: GorePiece = {
    state: 'gore_eye',
    paint: (ctx) => {
      // The optic stalk goes down first so the ball covers its root: a ball
      // with a tail is the only silhouette in the set that has both.
      const stalk = makeChain(
        [
          pt(EYEBALL_R * OPTIC_ROOT_X, EYEBALL_R * OPTIC_ROOT_Y),
          pt(OPTIC_MID_X, OPTIC_MID_Y),
          pt(OPTIC_BEND_X, OPTIC_BEND_Y),
          pt(OPTIC_END_X, OPTIC_END_Y),
        ],
        taperedHalves(OPTIC_STATIONS, OPTIC_ROOT_HALF, OPTIC_TIP_HALF, OPTIC_TAPER_POWER),
        eyeSeed,
      );
      paintMass(ctx, tracerFor(ctx, stalk.outline), FLESH_TONE);

      const ball = ovalOutline(
        0,
        0,
        EYEBALL_R,
        EYEBALL_R * EYEBALL_SQUASH,
        0,
        eyeSeed,
        EYEBALL_WOBBLE,
      );
      const trace = tracerFor(ctx, ball);
      paintMass(ctx, trace, VENTRAL_TONE);

      ctx.save();
      trace(0);
      ctx.clip();
      paintDeadEye(
        ctx,
        pt(EYEBALL_R * EYE_FACE_X, EYEBALL_R * EYE_FACE_Y),
        EYEBALL_R * EYE_FACE_RX,
        EYEBALL_R * EYE_FACE_RY,
        EYE_FACE_GAZE,
      );
      ctx.restore();

      // Torn muscle still attached round the back of the globe.
      ctx.strokeStyle = rgba(FLESH_DARK, OPTIC_STRAND_ALPHA);
      ctx.lineWidth = OPTIC_STRAND_WIDTH;
      ctx.lineCap = 'round';
      for (let i = 0; i < OPTIC_STRAND_COUNT; i++) {
        const angle =
          OPTIC_STRAND_BASE_ANGLE +
          lerp(-CENTRE, CENTRE, (i + CENTRE) / OPTIC_STRAND_COUNT) * OPTIC_STRAND_ARC;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * EYEBALL_R * CENTRE, Math.sin(angle) * EYEBALL_R * CENTRE);
        ctx.lineTo(
          Math.cos(angle) * (EYEBALL_R + OPTIC_STRAND_REACH),
          Math.sin(angle) * (EYEBALL_R + OPTIC_STRAND_REACH),
        );
        ctx.stroke();
      }

      drawWound(ctx, {
        kind: 'torn',
        centre: pt(OPTIC_END_X, OPTIC_END_Y),
        radius: EYE_WOUND_RADIUS,
        squash: EYE_WOUND_SQUASH,
        angle: deg(EYE_WOUND_ANGLE_DEGREES),
        bones: [],
        runAngle: deg(EYE_WOUND_RUN_DEGREES),
        seed: eyeWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const tentacleASeed = nextSeed();
  const tentacleAMottleSeed = nextSeed();
  const tentacleAWoundSeed = nextSeed();
  const tentacleA: GorePiece = {
    state: 'gore_tentacle_a',
    paint: (ctx) => {
      // A long bowed limb lying nearly corner to corner. Its whole job is to be
      // the piece that is not a spiral.
      const spine: Pt[] = [];
      for (let i = 0; i <= TENTACLE_A_STEPS; i++) {
        const t = i / TENTACLE_A_STEPS;
        spine.push(
          pt(
            lerp(TENTACLE_A_FROM_X, TENTACLE_A_TO_X, t),
            lerp(TENTACLE_A_FROM_Y, TENTACLE_A_TO_Y, t) + Math.sin(t * Math.PI) * TENTACLE_A_BOW,
          ),
        );
      }
      const chain = makeChain(
        spine,
        taperedHalves(spine.length, TENTACLE_A_ROOT_HALF, TENTACLE_A_TIP_HALF, TUBE_TAPER_POWER),
        tentacleASeed,
      );
      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, tentacleAMottleSeed, TENTACLE_A_MOTTLE_SPREAD);
      paintSuckerRow(ctx, chain, trace, TENTACLE_A_SUCKERS, 1, SUCKER_RADIUS_SHARE);

      paintChainMouth(
        ctx,
        chain,
        TENTACLE_A_MOUTH_NEAR_T,
        TENTACLE_A_MOUTH_SIZE,
        TENTACLE_A_MOUTH_NEAR_OPEN,
        tentacleASeed,
      );
      paintChainMouth(
        ctx,
        chain,
        TENTACLE_A_MOUTH_FAR_T,
        TENTACLE_A_MOUTH_SIZE,
        TENTACLE_A_MOUTH_FAR_OPEN,
        tentacleASeed + GASH_SEED_OFFSET,
      );

      drawWound(ctx, {
        kind: 'clean',
        centre: spine[0],
        radius: TENTACLE_A_WOUND_RADIUS,
        squash: TENTACLE_A_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: tentacleAWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const tentacleBSeed = nextSeed();
  const tentacleBMottleSeed = nextSeed();
  const tentacleBWoundSeed = nextSeed();
  const tentacleB: GorePiece = {
    state: 'gore_tentacle_b',
    paint: (ctx) => {
      // The same flesh wound into a tight spiral. The distinctness gate scores
      // these two against each other on a 16x16 mask, and a bowed line and a
      // coil are the furthest apart two lengths of the same tube can be.
      const spine: Pt[] = [];
      for (let i = 0; i <= TENTACLE_B_STEPS; i++) {
        const t = i / TENTACLE_B_STEPS;
        const around = TENTACLE_B_START_ANGLE + t * TWO_PI * TENTACLE_B_TURNS;
        const radius = lerp(TENTACLE_B_START_RADIUS, TENTACLE_B_END_RADIUS, t);
        spine.push(pt(Math.cos(around) * radius, Math.sin(around) * radius * TENTACLE_B_SQUASH));
      }
      const chain = makeChain(
        spine,
        taperedHalves(spine.length, TENTACLE_B_ROOT_HALF, TENTACLE_B_TIP_HALF, TUBE_TAPER_POWER),
        tentacleBSeed,
      );
      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, tentacleBMottleSeed, TENTACLE_B_START_RADIUS);
      // Inward-facing row: a coil shows the player its inside face, and suckers
      // on the outside of a spiral read as beading on a shell.
      paintSuckerRow(ctx, chain, trace, TENTACLE_B_SUCKERS, -1, SUCKER_RADIUS_SHARE);

      paintChainMouth(
        ctx,
        chain,
        TENTACLE_B_MOUTH_T,
        TENTACLE_B_MOUTH_SIZE,
        TENTACLE_B_MOUTH_OPEN,
        tentacleBSeed,
      );

      drawWound(ctx, {
        kind: 'torn',
        centre: spine[0],
        radius: TENTACLE_B_WOUND_RADIUS,
        squash: TENTACLE_B_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: tentacleBWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const slabSeed = nextSeed();
  const slabMottleSeed = nextSeed();
  const slabWoundSeed = nextSeed();
  const mouthCluster: GorePiece = {
    state: 'gore_mouth_cluster',
    paint: (ctx) => {
      // The signature piece. Two mouths rather than a scatter of small ones:
      // at a 32 px tile the horror hook depends on a player being able to see
      // lips and teeth, and a texture of dots is just a texture.
      // A convex lump is the same silhouette as the mantle once the
      // distinctness gate normalises scale. Two bites out of the outline —
      // where the slab tore away from the tentacle it sat on — give it
      // concavities the dome does not have. Placed by fraction of the way
      // round rather than by index, because the outline's own step count is a
      // constant private to `ratArt` and moving it would slide the bites off.
      const slab = ovalOutline(0, 0, SLAB_RX, SLAB_RY, 0, slabSeed, SLAB_WOBBLE).map(
        (p, i, all) => {
          const around = i / all.length;
          if (around > SLAB_TOP_BITE_FROM && around < SLAB_TOP_BITE_UNTIL) {
            return pt(p.x * SLAB_TOP_BITE_X, p.y * SLAB_TOP_BITE_Y);
          }
          if (around > SLAB_END_BITE_FROM && around < SLAB_END_BITE_UNTIL) {
            return pt(p.x * SLAB_END_BITE_X, p.y * SLAB_END_BITE_Y);
          }
          return p;
        },
      );
      const trace = tracerFor(ctx, slab);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, slabMottleSeed, SLAB_RX);

      paintMouth(ctx, {
        centre: SLAB_MOUTH_BIG_AT,
        angle: SLAB_MOUTH_BIG_ANGLE,
        half: SLAB_MOUTH_BIG_HALF,
        open: SLAB_MOUTH_BIG_OPEN,
        depth: 0,
        seed: slabSeed,
      });
      paintMouth(ctx, {
        centre: SLAB_MOUTH_SMALL_AT,
        angle: SLAB_MOUTH_SMALL_ANGLE,
        half: SLAB_MOUTH_SMALL_HALF,
        open: SLAB_MOUTH_SMALL_OPEN,
        depth: 0,
        seed: slabSeed + GASH_SEED_OFFSET,
      });
      paintMouth(ctx, {
        centre: SLAB_MOUTH_THIRD_AT,
        angle: SLAB_MOUTH_THIRD_ANGLE,
        half: SLAB_MOUTH_THIRD_HALF,
        open: SLAB_MOUTH_THIRD_OPEN,
        depth: 0,
        seed: slabSeed + GASH_SEED_OFFSET * 2,
      });

      // A stray eye among them. The living creature carries eyes on flesh that
      // has no face on it, so the piece cut out of that flesh has to as well.
      paintDeadEye(ctx, SLAB_EYE_AT, SLAB_EYE_RX, SLAB_EYE_RY, SLAB_EYE_GAZE);

      drawWound(ctx, {
        kind: 'crushed',
        centre: pt(SLAB_RX * SLAB_WOUND_X, SLAB_RY * SLAB_WOUND_Y),
        radius: SLAB_WOUND_RADIUS,
        squash: SLAB_WOUND_SQUASH,
        angle: deg(SLAB_WOUND_ANGLE_DEGREES),
        bones: [],
        runAngle: deg(SLAB_WOUND_RUN_DEGREES),
        seed: slabWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const gutSeed = nextSeed();
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      // An open coil, not a closed ring. A ring is a rounded blob with a dot in
      // it, which is the same silhouette as the mantle once the distinctness
      // gate normalises scale; a spiral with a tail sticking out is nobody
      // else's shape in this set.
      const spine: Pt[] = [];
      const halves: number[] = [];
      for (let i = 0; i <= GUT_STEPS; i++) {
        const t = i / GUT_STEPS;
        const around = t * TWO_PI * GUT_TURNS + GUT_START_ANGLE;
        const radius = GUT_COIL_RADIUS * lerp(1, CENTRE, t);
        const tail = t > GUT_TAIL_FROM ? (t - GUT_TAIL_FROM) / (1 - GUT_TAIL_FROM) : 0;
        spine.push(
          pt(
            Math.cos(around) * radius * GUT_STRETCH + tail * GUT_COIL_RADIUS * GUT_TAIL_REACH,
            Math.sin(around) * radius + tail * GUT_COIL_RADIUS * GUT_TAIL_DROP,
          ),
        );
        // Peristalsis, not plumbing. A bowel that tapers evenly along its whole
        // run has parallel sides, and eight near-identical segments of it at
        // near-identical spacing is a manufactured rhythm — a ribbed hose.
        const lump =
          1 +
          Math.sin(t * GUT_LUMP_LOBES + gutSeed) * GUT_LUMP +
          Math.sin(t * GUT_LUMP_FAST_LOBES - gutSeed) * GUT_LUMP_FAST;
        halves.push(lerp(GUT_ROOT_HALF, GUT_TIP_HALF, t) * lump);
      }
      const chain = makeChain(spine, halves, gutSeed);

      // The pool it is lying in goes down first, so the coil sits in its own
      // blood rather than having some painted on top of it.
      paintBloodPool(
        ctx,
        pt(GUT_COIL_RADIUS * GUT_POOL_X, GUT_COIL_RADIUS * GUT_POOL_Y),
        GUT_COIL_RADIUS * GUT_POOL_RX,
        GUT_COIL_RADIUS * GUT_POOL_RY,
        deg(GUT_POOL_ANGLE_DEGREES),
        gutSeed + GASH_SEED_OFFSET,
      );

      // A swollen sac hanging off the coil: bowel alone is a rope, and a rope
      // is what the long tentacle already is.
      const sac = ovalOutline(
        GUT_SAC_AT.x,
        GUT_SAC_AT.y,
        GUT_SAC_RX,
        GUT_SAC_RY,
        0,
        gutSeed,
        GUT_SAC_WOBBLE,
      );
      paintMass(ctx, tracerFor(ctx, sac), GUT_TONE);

      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, GUT_TONE);

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(GUT_DARK, GUT_SEGMENT_ALPHA);
      ctx.lineWidth = GUT_SEGMENT_WIDTH;
      ctx.lineCap = 'round';
      // Walked at hashed steps rather than every third station: a constant
      // stride is what made the ribs read as eight repeats of one part.
      let station = GUT_SEGMENT_FIRST;
      while (station < spine.length - 1) {
        const index = Math.floor(station);
        const here = spine[index];
        const across = chain.angles[index] + Math.PI / 2;
        const reach = GUT_SEGMENT_REACH * hashRange(gutSeed + index, GUT_SEGMENT_MIN, 1);
        ctx.beginPath();
        ctx.moveTo(here.x + Math.cos(across) * reach, here.y + Math.sin(across) * reach);
        ctx.lineTo(here.x - Math.cos(across) * reach, here.y - Math.sin(across) * reach);
        ctx.stroke();
        station += hashRange(
          gutSeed + index + GUT_SEGMENT_STEP_SEED,
          GUT_SEGMENT_STEP_MIN,
          GUT_SEGMENT_STEP_MAX,
        );
      }
      ctx.fillStyle = rgba(GUT_LIGHT, AMBIENT_ALPHA * GUT_SHEEN_ALPHA_GAIN);
      ctx.beginPath();
      ctx.ellipse(
        -GUT_COIL_RADIUS * CENTRE,
        -GUT_COIL_RADIUS * GUT_SHEEN_Y,
        GUT_COIL_RADIUS * GUT_SHEEN_RX,
        GUT_COIL_RADIUS * GUT_SHEEN_RY,
        deg(GUT_SHEEN_ANGLE_DEGREES),
        0,
        TWO_PI,
      );
      ctx.fill();
      // Wet, in patches, down the length of it. A single sheen on the inside of
      // the coil is a shadow shape; what says "this came out of a body five
      // seconds ago" is a scatter of small highlights riding the swellings.
      ctx.fillStyle = BLOOD_GLOSS;
      for (let i = 0; i < GUT_WET_COUNT; i++) {
        const sample = sampleChain(chain, hashRange(gutSeed + i * GUT_WET_STRIDE, 0, 1));
        const across = sample.angle - Math.PI / 2;
        const r = sample.half * hashRange(gutSeed + i, GUT_WET_MIN_SHARE, GUT_WET_MAX_SHARE);
        ctx.beginPath();
        ctx.ellipse(
          sample.point.x + Math.cos(across) * sample.half * GUT_WET_INSET,
          sample.point.y + Math.sin(across) * sample.half * GUT_WET_INSET,
          r,
          r * MOTTLE_SQUASH,
          sample.angle,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
      ctx.restore();

      // Both ends were clean rounded caps, which is the single strongest reason
      // it named as a hose: a length of gut has been *pulled* out of something
      // at one end and torn off at the other.
      const tail = spine[spine.length - 1];
      drawWound(ctx, {
        kind: 'torn',
        centre: spine[0],
        radius: GUT_ROOT_HALF * GUT_WOUND_SHARE,
        squash: GUT_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: gutSeed + GUT_ROOT_TEAR_SEED,
        hide: GUT_DARK,
      });
      paintMouth(ctx, {
        centre: tail,
        angle: chain.angles[chain.angles.length - 1] + Math.PI / 2,
        half: GUT_TIP_HALF * GUT_TEAR_SHARE,
        open: 1,
        depth: 0,
        seed: gutSeed + GUT_TAIL_TEAR_SEED,
      });
    },
  };

  return [mantle, stub, eye, tentacleA, tentacleB, mouthCluster, entrails];
}

const MANTLE_EYE_GAZE = -0.12;
const MANTLE_SPARE_EYE_X = 0.085;
const MANTLE_SPARE_EYE_Y = 0.035;
const MANTLE_SPARE_EYE_SHARE = 0.52;
const MANTLE_SPARE_EYE_GAZE = 0.35;
const MANTLE_WOUND_X = -0.5;
const MANTLE_WOUND_Y = 0.8;
const MANTLE_WOUND_RADIUS = 0.078;
const MANTLE_WOUND_SQUASH = 0.5;
const MANTLE_WOUND_ANGLE_DEGREES = 16;
const MANTLE_WOUND_RUN_DEGREES = 104;

const OPTIC_ROOT_X = 0.5;
const OPTIC_ROOT_Y = 0.45;
const OPTIC_MID_X = 0.115;
const OPTIC_MID_Y = 0.115;
const OPTIC_BEND_X = 0.165;
const OPTIC_BEND_Y = 0.2;
const OPTIC_END_X = 0.135;
const OPTIC_END_Y = 0.275;
const OPTIC_STRAND_BASE_DEGREES = 150;
const OPTIC_STRAND_BASE_ANGLE = deg(OPTIC_STRAND_BASE_DEGREES);
const EYE_FACE_X = -0.16;
const EYE_FACE_Y = -0.1;
const EYE_FACE_RX = 0.72;
const EYE_FACE_RY = 0.68;
const EYE_FACE_GAZE = -0.18;
const EYE_WOUND_RADIUS = 0.038;
const EYE_WOUND_SQUASH = 0.5;
const EYE_WOUND_ANGLE_DEGREES = 130;
const EYE_WOUND_RUN_DEGREES = 68;

const TENTACLE_A_MOTTLE_SPREAD = 0.16;
const TENTACLE_A_WOUND_RADIUS = 0.062;
const TENTACLE_A_WOUND_SQUASH = 0.42;
const TENTACLE_B_WOUND_RADIUS = 0.056;
const TENTACLE_B_WOUND_SQUASH = 0.45;

const SLAB_WOUND_X = -0.72;
const SLAB_WOUND_Y = 0.62;
const SLAB_WOUND_RADIUS = 0.062;
const SLAB_WOUND_SQUASH = 0.5;
const SLAB_WOUND_ANGLE_DEGREES = 128;
const SLAB_WOUND_RUN_DEGREES = 148;

const GUT_SAC_WOBBLE = 0.12;
const GUT_SHEEN_Y = 0.4;
const GUT_SHEEN_RX = 0.4;
const GUT_SHEEN_RY = 0.22;
const GUT_SHEEN_ANGLE_DEGREES = -20;

// ── Guard tentacle: the four pieces off a killed guard ───────────────────────

const TIP_STEPS = 9;
const TIP_FROM = { x: -0.13, y: 0.185 } as const;
const TIP_TO = { x: 0.06, y: -0.14 } as const;
const TIP_BOW = 0.07;
const TIP_ROOT_HALF = 0.082;
const TIP_TIP_HALF = 0.034;
const TIP_SUCKERS = 6;
const TIP_CLUSTER_T = 0.86;
const TIP_CLUSTER_COUNT = 3;
const TIP_CLUSTER_SIZE = 0.058;
const TIP_CLUSTER_SPREAD = 0.052;
const TIP_CLUSTER_CYCLE = 0.12;
const TIP_CLUSTER_MOUTH_SPREAD = 1;
const TIP_WOUND_RADIUS = 0.07;
const TIP_WOUND_SQUASH = 0.45;

const MID_STEPS = 8;
const MID_HALF_LENGTH = 0.17;
const MID_LEAN = 0.035;
/** A barrel, not a cylinder: it bulges at the waist and pinches at both cuts. */
const MID_WAIST_HALF = 0.105;
const MID_END_HALF = 0.072;
const MID_BULGE_POWER = 0.62;
const MID_SUCKERS_MAIN = 7;
const MID_SUCKERS_SECOND = 5;
const MID_SECOND_ROW_SHARE = 0.62;
const MID_WOUND_RADIUS = 0.068;
const MID_WOUND_SQUASH = 0.4;

const ROOT_HALF_WIDTH = 0.185;
const ROOT_TOP_HALF = 0.088;
const ROOT_HEIGHT = 0.17;
const ROOT_FLARE_STEPS = 20;
const ROOT_FLARE_POWER = 2.2;
const ROOT_RAG_LOBES = 7;
const ROOT_RAG = 0.09;
const ROOT_SUCKERS = 5;
const ROOT_MOUTH_SIZE = 0.048;
const ROOT_MOUTH_AT = { x: 0.03, y: -0.055 } as const;
const ROOT_MOUTH_DEGREES = 8;
const ROOT_MOUTH_ANGLE = deg(ROOT_MOUTH_DEGREES);
const ROOT_MOUTH_OPEN = 0.7;
const ROOT_WOUND_RADIUS = 0.062;
const ROOT_WOUND_SQUASH = 0.42;

/** Only piece in the eleven that carries anything that is not her. */
const DEBRIS_EMBEDDED_COUNT = 5;
const DEBRIS_LOOSE_COUNT = 4;
const DEBRIS_SIZE_MIN = 0.032;
const DEBRIS_SIZE_MAX = 0.072;
const DEBRIS_ASPECT = 0.44;
const DEBRIS_INK_WIDTH = 0.006;
const DEBRIS_SEED_STRIDE = 53;
const DEBRIS_SPIN_STRIDE = 101;
const DEBRIS_TONE_STRIDE = 149;
const DEBRIS_SIZE_STRIDE = 197;
const SLIME_STRAND_COUNT = 3;
const SLIME_STRAND_ALPHA = 0.5;
const SLIME_STRAND_WIDTH = 0.008;
const SLIME_STRAND_SAG = 0.045;

const SHRED_RX = 0.175;
const SHRED_RY = 0.062;
const SHRED_WOBBLE = 0.3;
const SHRED_TILT_DEGREES = -22;
const SHRED_TILT = deg(SHRED_TILT_DEGREES);
const SHRED_SUCKERS = 5;
const SHRED_SUCKER_SIZE_SHARE = 0.62;
const SHRED_SPINE_STEPS = 7;
const SHRED_CURVE = 0.055;
const SHRED_NOTCH_COUNT = 9;
const SHRED_NOTCH_ALPHA = 0.8;
const SHRED_NOTCH_RADIUS = 0.03;
const SHRED_NOTCH_MIN_SHARE = 0.35;
const SHRED_NOTCH_STRIDE = 29;
const SHRED_NOTCH_ACROSS_STRIDE = 137;
const SHRED_NOTCH_ALONG_STRIDE = 211;
const SHRED_NOTCH_REACH = 1.05;
/** The flap has no round side to inset toward, so its row sits on the spine. */
const SHRED_ROW_ON_SPINE = 0;
/**
 * Where round the flap the tear runs, and how far each vertex of it is dragged.
 *
 * A smooth unbroken rim all the way round is what let this piece name as a leaf
 * and a filleted fish: it is the only outline in either set with no interruption
 * in it at all. Half the perimeter is now pulled about in a jagged run, which is
 * what an edge that came off something under tension looks like.
 */
const SHRED_TEAR_FROM = 0.04;
const SHRED_TEAR_UNTIL = 0.58;
const SHRED_TEAR_MIN = 0.58;
const SHRED_TEAR_MAX = 1.26;
const SHRED_TEAR_STRIDE = 71;
/**
 * Its own tone, and a darker one than the eyeball's.
 *
 * Painted in the shared pale ventral ramp it came out the lightest-valued
 * object in the whole gore set — a different *material* from the seven pieces
 * of flesh it falls beside, which reads as shell or bone rather than as skin.
 * Pale is still its job; brightest is not.
 */
const SHRED_MID = '#7f4f61';
const SHRED_DARK = '#331923';
const SHRED_LIGHT = '#ab8091';
const SHRED_TONE: Tone = { mid: SHRED_MID, dark: SHRED_DARK, light: SHRED_LIGHT };
const SHRED_BLOOD_RX = 0.62;
const SHRED_BLOOD_RY = 0.9;
const SHRED_BLOOD_AT_X = -0.72;
const SHRED_BLOOD_AT_Y = 0.55;
const SHRED_BLOOD_ANGLE_DEGREES = -34;
const SHRED_UNDERSIDE_ALPHA = 0.5;
const SHRED_UNDERSIDE_LIFT = 0.55;

/**
 * The four guard-tentacle pieces, in the order `BodyPartGoreSystem` spawns
 * them. Same construction-time seed rule as the body set.
 */
export function krakarenTentacleGorePieces(): readonly GorePiece[] {
  const nextSeed = seedSource(TENTACLE_SEED_BASE);

  const tipSeed = nextSeed();
  const tipWoundSeed = nextSeed();
  const tip: GorePiece = {
    state: 'gore_tip',
    paint: (ctx) => {
      const spine: Pt[] = [];
      for (let i = 0; i <= TIP_STEPS; i++) {
        const t = i / TIP_STEPS;
        spine.push(
          pt(
            lerp(TIP_FROM.x, TIP_TO.x, t) + Math.sin(t * Math.PI) * TIP_BOW,
            lerp(TIP_FROM.y, TIP_TO.y, t),
          ),
        );
      }
      const chain = makeChain(
        spine,
        taperedHalves(spine.length, TIP_ROOT_HALF, TIP_TIP_HALF, TUBE_TAPER_POWER),
        tipSeed,
      );
      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, tipSeed, TIP_ROOT_HALF);
      paintSuckerRow(ctx, chain, trace, TIP_SUCKERS, -1, SUCKER_RADIUS_SHARE);

      // The face-like knot at the tip is the whole reason a player recognises
      // the guard tentacle as a creature rather than as scenery, so it is what
      // the piece it came off has to carry.
      const head = sampleChain(chain, TIP_CLUSTER_T);
      paintMouthCluster(ctx, {
        centre: head.point,
        angle: head.angle,
        count: TIP_CLUSTER_COUNT,
        size: Math.min(TIP_CLUSTER_SIZE, head.half * MOUTH_WIDTH_LIMIT_SHARE),
        spread: TIP_CLUSTER_SPREAD,
        mouthCycle: TIP_CLUSTER_CYCLE,
        mouthSpread: TIP_CLUSTER_MOUTH_SPREAD,
        depth: 0,
        seed: tipSeed,
      });

      drawWound(ctx, {
        kind: 'clean',
        centre: spine[0],
        radius: TIP_WOUND_RADIUS,
        squash: TIP_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: tipWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const midSeed = nextSeed();
  const midRootWoundSeed = nextSeed();
  const midTipWoundSeed = nextSeed();
  const mid: GorePiece = {
    state: 'gore_mid',
    paint: (ctx) => {
      // Cut at both ends. Two wounds on one piece is the read that says "this
      // came out of the middle of something", and no other piece in either set
      // has more than one.
      const spine: Pt[] = [];
      const halves: number[] = [];
      for (let i = 0; i <= MID_STEPS; i++) {
        const t = i / MID_STEPS;
        spine.push(pt(lerp(-MID_HALF_LENGTH, MID_HALF_LENGTH, t), lerp(MID_LEAN, -MID_LEAN, t)));
        const fromEnd = 1 - Math.abs(t - CENTRE) / CENTRE;
        halves.push(lerp(MID_END_HALF, MID_WAIST_HALF, Math.pow(fromEnd, MID_BULGE_POWER)));
      }
      const chain = makeChain(spine, halves, midSeed);
      const trace = tracerFor(ctx, chain.outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, midSeed, MID_HALF_LENGTH);
      paintSuckerRow(ctx, chain, trace, MID_SUCKERS_MAIN, 1, SUCKER_RADIUS_SHARE);
      paintSuckerRow(
        ctx,
        chain,
        trace,
        MID_SUCKERS_SECOND,
        -1,
        SUCKER_RADIUS_SHARE * MID_SECOND_ROW_SHARE,
      );

      const last = spine.length - 1;
      drawWound(ctx, {
        kind: 'clean',
        centre: spine[0],
        radius: MID_WOUND_RADIUS,
        squash: MID_WOUND_SQUASH,
        angle: chain.angles[0] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[0] + Math.PI,
        seed: midRootWoundSeed,
        hide: FLESH_DARK,
      });
      drawWound(ctx, {
        kind: 'torn',
        centre: spine[last],
        radius: MID_WOUND_RADIUS,
        squash: MID_WOUND_SQUASH,
        angle: chain.angles[last] + Math.PI / 2,
        bones: [],
        runAngle: chain.angles[last],
        seed: midTipWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const rootSeed = nextSeed();
  const rootDebrisSeed = nextSeed();
  const rootWoundSeed = nextSeed();
  const root: GorePiece = {
    state: 'gore_root',
    paint: (ctx) => {
      // A flared stump with the lair floor still stuck in it. The debris is the
      // read: everything else in both sets is nothing but her, so the one piece
      // with grey-violet stone in it is the one that came out of the ground.
      const outline: Pt[] = [];
      for (let i = 0; i <= ROOT_FLARE_STEPS; i++) {
        const t = i / ROOT_FLARE_STEPS;
        const half = lerp(ROOT_TOP_HALF, ROOT_HALF_WIDTH, Math.pow(t, ROOT_FLARE_POWER));
        const rag = 1 + ROOT_RAG * Math.sin(t * ROOT_RAG_LOBES * Math.PI + rootSeed);
        outline.push(pt(half * rag, lerp(-ROOT_HEIGHT, ROOT_HEIGHT, t)));
      }
      for (let i = ROOT_FLARE_STEPS; i >= 0; i--) {
        const t = i / ROOT_FLARE_STEPS;
        const half = lerp(ROOT_TOP_HALF, ROOT_HALF_WIDTH, Math.pow(t, ROOT_FLARE_POWER));
        const rag = 1 + ROOT_RAG * Math.sin(t * ROOT_RAG_LOBES * Math.PI - rootSeed);
        outline.push(pt(-half * rag, lerp(-ROOT_HEIGHT, ROOT_HEIGHT, t)));
      }
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, FLESH_TONE);
      mottleFlesh(ctx, trace, rootSeed, ROOT_HALF_WIDTH);

      const stump = makeChain(
        [pt(0, -ROOT_HEIGHT), pt(0, 0), pt(0, ROOT_HEIGHT)],
        [ROOT_TOP_HALF, (ROOT_TOP_HALF + ROOT_HALF_WIDTH) / 2, ROOT_HALF_WIDTH],
        rootSeed,
      );
      paintSuckerRow(ctx, stump, trace, ROOT_SUCKERS, 1, SUCKER_RADIUS_SHARE);
      paintMouth(ctx, {
        centre: ROOT_MOUTH_AT,
        angle: ROOT_MOUTH_ANGLE,
        half: ROOT_MOUTH_SIZE,
        open: ROOT_MOUTH_OPEN,
        depth: 0,
        seed: rootSeed,
      });

      paintFloorDebris(ctx, trace, rootDebrisSeed);

      drawWound(ctx, {
        kind: 'torn',
        centre: pt(0, -ROOT_HEIGHT),
        radius: ROOT_WOUND_RADIUS,
        squash: ROOT_WOUND_SQUASH,
        angle: 0,
        bones: [],
        runAngle: -Math.PI / 2,
        seed: rootWoundSeed,
        hide: FLESH_DARK,
      });
    },
  };

  const shredSeed = nextSeed();
  const suckerShred: GorePiece = {
    state: 'gore_sucker_shred',
    paint: (ctx) => {
      // A thin pale flap with the sucker row still on it. Nothing else in
      // either set is both flat and pale, which is the whole point of it.
      ctx.save();
      ctx.rotate(SHRED_TILT);
      const flap = ovalOutline(0, 0, SHRED_RX, SHRED_RY, 0, shredSeed, SHRED_WOBBLE).map(
        (p, i, all) => {
          const around = i / all.length;
          if (around < SHRED_TEAR_FROM || around > SHRED_TEAR_UNTIL) return p;
          const drag = hashRange(shredSeed + i * SHRED_TEAR_STRIDE, SHRED_TEAR_MIN, SHRED_TEAR_MAX);
          return pt(p.x * drag, p.y * drag);
        },
      );
      const trace = tracerFor(ctx, flap);
      // The blood it tore away in goes down before the skin, so the flap is
      // lying in it and the run shows past the torn rim rather than on top.
      paintBloodPool(
        ctx,
        pt(SHRED_RX * SHRED_BLOOD_AT_X, SHRED_RY * SHRED_BLOOD_AT_Y),
        SHRED_RX * SHRED_BLOOD_RX,
        SHRED_RY * SHRED_BLOOD_RY,
        deg(SHRED_BLOOD_ANGLE_DEGREES),
        shredSeed + GASH_SEED_OFFSET,
      );
      paintMass(ctx, trace, SHRED_TONE);

      // Raw underside showing along the torn edge: the flap is skin, and skin
      // has a wet side.
      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = rgba(BLOOD, SHRED_UNDERSIDE_ALPHA);
      ctx.beginPath();
      ctx.ellipse(0, SHRED_RY * SHRED_UNDERSIDE_LIFT, SHRED_RX, SHRED_RY, 0, 0, TWO_PI);
      ctx.fill();
      ctx.restore();

      const spine: Pt[] = [];
      const halves: number[] = [];
      for (let i = 0; i <= SHRED_SPINE_STEPS; i++) {
        const t = i / SHRED_SPINE_STEPS;
        spine.push(pt(lerp(-SHRED_RX, SHRED_RX, t), Math.sin(t * Math.PI) * SHRED_CURVE));
        halves.push(SHRED_RY);
      }
      paintSuckerRow(
        ctx,
        makeChain(spine, halves, shredSeed),
        trace,
        SHRED_SUCKERS,
        SHRED_ROW_ON_SPINE,
        SHRED_SUCKER_SIZE_SHARE,
      );

      // Bites out of the rim, so the flap reads as torn rather than as cut.
      ctx.save();
      trace(0);
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = rgba(OUTLINE_INK, SHRED_NOTCH_ALPHA);
      for (let i = 0; i < SHRED_NOTCH_COUNT; i++) {
        const across =
          SHRED_RX * (hash1(shredSeed + i * SHRED_NOTCH_ACROSS_STRIDE) * 2 - 1) * SHRED_NOTCH_REACH;
        const above = hash1(shredSeed + i * SHRED_NOTCH_ALONG_STRIDE) < CENTRE ? -1 : 1;
        const radius =
          SHRED_NOTCH_RADIUS *
          hashRange(shredSeed + i * SHRED_NOTCH_STRIDE, SHRED_NOTCH_MIN_SHARE, 1);
        ctx.beginPath();
        ctx.arc(across, above * SHRED_RY, radius, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
      ctx.restore();
    },
  };

  return [tip, mid, root, suckerShred];
}

/**
 * Broken lair floor worked into the guard tentacle's root: chips embedded under
 * the flesh's own edge, shards standing off the ragged rim, and slime strands
 * bridging the two.
 */
function paintFloorDebris(ctx: Ctx, trace: Trace, seed: number): void {
  const shardAt = (index: number, reach: number): void => {
    const around =
      (index / (DEBRIS_EMBEDDED_COUNT + DEBRIS_LOOSE_COUNT)) * TWO_PI + hash1(seed + index);
    const size = hashRange(seed + index * DEBRIS_SIZE_STRIDE, DEBRIS_SIZE_MIN, DEBRIS_SIZE_MAX);
    ctx.save();
    ctx.translate(Math.cos(around) * reach, Math.sin(around) * reach);
    ctx.rotate(hash1(seed + index * DEBRIS_SPIN_STRIDE) * TWO_PI);
    ctx.fillStyle = mix(RUBBLE_MID, RUBBLE_LIGHT, hash1(seed + index * DEBRIS_TONE_STRIDE));
    ctx.fillRect(-size / 2, (-size * DEBRIS_ASPECT) / 2, size, size * DEBRIS_ASPECT);
    ctx.strokeStyle = RUBBLE_DARK;
    ctx.lineWidth = DEBRIS_INK_WIDTH;
    ctx.strokeRect(-size / 2, (-size * DEBRIS_ASPECT) / 2, size, size * DEBRIS_ASPECT);
    ctx.restore();
  };

  ctx.save();
  trace(0);
  ctx.clip();
  for (let i = 0; i < DEBRIS_EMBEDDED_COUNT; i++) {
    shardAt(i, hashRange(seed + i * DEBRIS_SEED_STRIDE, 0, ROOT_HALF_WIDTH));
  }
  ctx.restore();

  for (let i = 0; i < DEBRIS_LOOSE_COUNT; i++) {
    const index = DEBRIS_EMBEDDED_COUNT + i;
    shardAt(
      index,
      hashRange(seed + index * DEBRIS_SEED_STRIDE, ROOT_HALF_WIDTH, ROOT_HALF_WIDTH + ROOT_HEIGHT),
    );
  }

  ctx.strokeStyle = rgba(SLIME, SLIME_STRAND_ALPHA);
  ctx.lineWidth = SLIME_STRAND_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < SLIME_STRAND_COUNT; i++) {
    const across = lerp(-ROOT_HALF_WIDTH, ROOT_HALF_WIDTH, (i + CENTRE) / SLIME_STRAND_COUNT);
    ctx.beginPath();
    ctx.moveTo(across, ROOT_HEIGHT * CENTRE);
    ctx.quadraticCurveTo(
      across + SLIME_STRAND_SAG,
      ROOT_HEIGHT,
      across - SLIME_STRAND_SAG,
      ROOT_HEIGHT + SLIME_STRAND_SAG,
    );
    ctx.stroke();
  }
}

/**
 * The eleven states, in spawn order, for the two keyed creatures. The sprite
 * modules re-export these names as `KRAKAREN_GORE_PARTS` and
 * `KRAKAREN_TENTACLE_GORE_PARTS`, and `gateGoreContract` asserts the three
 * registrations agree — so a rename here has exactly one place to start.
 */
export const KRAKAREN_GORE_STATES: readonly string[] = krakarenGorePieces().map(
  (piece) => piece.state,
);
export const KRAKAREN_TENTACLE_GORE_STATES: readonly string[] = krakarenTentacleGorePieces().map(
  (piece) => piece.state,
);

const STUB_STEPS = 9;
const STUB_FROM_X = -0.02;
const STUB_FROM_Y = -0.16;
const STUB_TO_X = 0.05;
const STUB_TO_Y = 0.15;
const STUB_BOW = 0.05;
const STUB_ROOT_HALF = 0.105;
const STUB_TIP_HALF = 0.072;
const STUB_TAPER_POWER = 1.5;
const STUB_SUCKERS = 3;
const STUB_MOUTH_T = 0.34;
const STUB_MOUTH_SIZE = 0.07;
const STUB_MOUTH_OPEN = 0.7;
const STUB_TEAR_SHARE = 1.2;
const STUB_EYE_X = -0.045;
const STUB_EYE_Y = -0.02;
const STUB_EYE_RX = 0.032;
const STUB_EYE_RY = 0.027;
const STUB_EYE_GAZE = 0.3;
const STUB_WOUND_RADIUS = 0.075;
const STUB_WOUND_SQUASH = 0.4;
