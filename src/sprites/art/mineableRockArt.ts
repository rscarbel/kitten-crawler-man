/**
 * Drawing engine for the rocks a pickaxe works: the wilderness's boulders and
 * the quarry's outcrops, each in four damage stages.
 *
 * ## How a rock is built
 *
 * The outline is a front elevation — a boxy superellipse with a flat foot,
 * wobbled by low harmonics so it stays a lump rather than a caltrop — and the
 * body inside it is a **low faceted solid**: every outline vertex sits at depth
 * zero, two or three interior peaks stand out toward the viewer, and the
 * triangles between them are flat planes shaded by their real normals against
 * one light. That is what makes the rock read as a mass with a lit shoulder and
 * a shadowed flank instead of a grey disc with texture on it.
 *
 * ## How it breaks
 *
 * Damage is geometry, not decals. A chip or a chunk is an edit to the outline:
 * a run of vertices is replaced by a notch biting into the body, and the band
 * just inside the notch is painted as a fresh fracture face — the rock's
 * unweathered colour, shaded by which way the face points, with a dark step
 * where it meets the old surface. The remnant is the broken rock with its top
 * sheared off, showing the flat fracture of the stump from above. Every stage is
 * drawn from the same seeded geometry, so a rock breaks down rather than being
 * replaced by a different rock.
 *
 * Everything stays inside `MAX_HALF_WIDTH_TILES` of the tile's centre, because
 * only the anchor tile blocks and ink beside it is ground a player could stand
 * on while drawn behind the stone. Light comes from the upper left, like every
 * other prop.
 */

import type { RockDamageState } from '../../map/rockDamage';
import { mulberry32, range, rangeInt, subSeed, type Rng } from '../person/rng';
import {
  MAX_HALF_WIDTH_TILES,
  MOSS_DARK,
  MOSS_LIGHT,
  type Lithology,
  type RockFrame,
} from './rockArt';

type Ctx = CanvasRenderingContext2D;

/** Wilderness boulders come in two sizes; an outcrop is the quarry's bedrock breaking the surface. */
export type MineableRockKind = 'small' | 'large' | 'outcrop';

export interface MineableRockSpec {
  readonly kind: MineableRockKind;
  readonly lithology: Lithology;
  /** How far the rock leans; negative leans left. */
  readonly lean: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Point3 extends Point {
  readonly z: number;
}

interface Ramp {
  readonly deep: string;
  readonly shadow: string;
  readonly body: string;
  readonly light: string;
  readonly high: string;
  /** Freshly broken stone, not yet weathered: lighter and cleaner than the skin. */
  readonly freshDark: string;
  readonly fresh: string;
  readonly freshLit: string;
  readonly outline: string;
  readonly crack: string;
  /** Crystals catching the light: quartz in granite, calcite in limestone. */
  readonly fleck: string;
  readonly lichen: string;
}

/**
 * One ramp per lithology, spaced in value as well as hue — basalt darker than
 * the ground it stands on, limestone lighter, sandstone warmer — because two
 * rocks that differ only in hue read as one rock under different weather.
 * Granite sits beside the generated scree ground, where most rocks are seen.
 */
const RAMPS: Readonly<Record<Lithology, Ramp>> = {
  granite: {
    deep: '#2c2b2a',
    shadow: '#474642',
    body: '#67655f',
    light: '#8a877e',
    high: '#aea99d',
    freshDark: '#8d8a82',
    fresh: '#aaa69c',
    freshLit: '#cbc6ba',
    outline: '#1b1a19',
    crack: '#232220',
    fleck: '#ece8de',
    lichen: '#b9b87c',
  },
  sandstone: {
    deep: '#3d2c1d',
    shadow: '#664b33',
    body: '#8f7049',
    light: '#b08e62',
    high: '#cfb083',
    freshDark: '#b79466',
    fresh: '#d3b283',
    freshLit: '#ebd1a6',
    outline: '#261a0f',
    crack: '#35261a',
    fleck: '#f2e2c0',
    lichen: '#c98a3a',
  },
  basalt: {
    deep: '#141518',
    shadow: '#26282d',
    body: '#3c3f45',
    light: '#575a62',
    high: '#7a7e88',
    freshDark: '#595c64',
    fresh: '#71747d',
    freshLit: '#90949e',
    outline: '#0b0c0e',
    crack: '#0f1012',
    fleck: '#a9b0bd',
    lichen: '#a7ab74',
  },
  limestone: {
    deep: '#4f5149',
    shadow: '#73756b',
    body: '#98998d',
    light: '#b9b9ab',
    high: '#d8d7c8',
    freshDark: '#c3c2b4',
    fresh: '#d8d7ca',
    freshLit: '#eeede1',
    outline: '#34352f',
    crack: '#51524a',
    fleck: '#f7f6ee',
    lichen: '#c7b35b',
  },
};

// ── Light ─────────────────────────────────────────────────────────────────────

/**
 * Upper left and toward the viewer. The toward-viewer share is what lets a
 * facet facing straight out of the picture sit mid-ramp rather than black.
 */
const LIGHT_RAW = { x: -0.55, y: -0.72, z: 0.62 } as const;
const LIGHT_LENGTH = Math.hypot(LIGHT_RAW.x, LIGHT_RAW.y, LIGHT_RAW.z);
const LIGHT = {
  x: LIGHT_RAW.x / LIGHT_LENGTH,
  y: LIGHT_RAW.y / LIGHT_LENGTH,
  z: LIGHT_RAW.z / LIGHT_LENGTH,
} as const;

/** Lambert values mapped onto the ends of the five-step ramp. */
const LAMBERT_DARK = -0.45;
const LAMBERT_BRIGHT = 1;
/** Per-facet nudge along the ramp, so two facets of one orientation still part. */
const FACET_TONE_JITTER = 0.1;

// ── Proportions, in tiles ─────────────────────────────────────────────────────

/** How far the rock's foot sits above the tile's bottom edge; rubble and shadow live below it. */
const BASE_LIFT_TILES = 0.17;

interface KindProfile {
  readonly heightMin: number;
  readonly heightRange: number;
  readonly halfWidthShareMin: number;
  readonly halfWidthShareRange: number;
  /** Superellipse exponent: 2 is an ellipse; higher stands the sides up and flattens the crown. */
  readonly squareness: number;
  readonly vertexMin: number;
  readonly vertexMax: number;
  readonly wobble: number;
  /** How much narrower the crown is than the foot: a boulder settles, it does not stand like a sack. */
  readonly taper: number;
  /** Interior points the body is triangulated through: more points, more planes. */
  readonly interiorPoints: number;
}

/**
 * A small boulder stops short of its own tile's top edge and hides nothing; a
 * large one reaches into the row above and hides a standing player's feet. An
 * outcrop is squat and square-shouldered: bedrock, not a stone that rolled here.
 */
const KIND_PROFILES: Readonly<Record<MineableRockKind, KindProfile>> = {
  small: {
    heightMin: 0.52,
    heightRange: 0.16,
    halfWidthShareMin: 0.8,
    halfWidthShareRange: 0.16,
    squareness: 2.4,
    taper: 0.22,
    vertexMin: 8,
    vertexMax: 9,
    wobble: 0.07,
    interiorPoints: 4,
  },
  large: {
    heightMin: 0.86,
    heightRange: 0.2,
    halfWidthShareMin: 0.94,
    halfWidthShareRange: 0.06,
    squareness: 2.6,
    taper: 0.28,
    vertexMin: 9,
    vertexMax: 11,
    wobble: 0.08,
    interiorPoints: 7,
  },
  outcrop: {
    heightMin: 0.66,
    heightRange: 0.16,
    halfWidthShareMin: 0.95,
    halfWidthShareRange: 0.05,
    squareness: 3.2,
    taper: 0.14,
    vertexMin: 9,
    vertexMax: 10,
    wobble: 0.06,
    interiorPoints: 6,
  },
};

const TWO_PI = Math.PI * 2;
const HALF = 0.5;
/** Share of an even angular step a vertex may drift, so corners are not evenly spaced. */
const VERTEX_ANGLE_JITTER = 0.32;
/** Per-rock spread of the superellipse exponent, so one kind holds round stones and square ones. */
const SQUARENESS_JITTER = 0.5;
/**
 * How much blockier or rounder each lithology weathers than its kind's
 * default. Sandstone rounds off: square, it reads as a crate or a sack.
 */
const LITHOLOGY_SQUARENESS: Readonly<Record<Lithology, number>> = {
  granite: 0,
  sandstone: -0.5,
  basalt: 0.1,
  limestone: -0.2,
};
/** Harmonic numbers of the outline wobble: low ones only, so the rim stays a lump. */
const WOBBLE_HARMONICS = [2, 3, 5] as const;
const WOBBLE_FALLOFF = 0.6;
/** Vertices whose foot falls below this share of the half height are flattened onto the ground. */
const FOOT_FLATTEN_SIN = 0.55;
/** A flattened foot is not ruler-straight: this much lift, in tiles. */
const FOOT_LIFT_TILES = 0.03;

/**
 * The dome the body's planes are lifted onto: its summit, as shares of the
 * rock's half width and height from the crown; how far past the outline it
 * reaches, so the rim is steep but not vertical; and how deep it stands, as a
 * share of the half width.
 */
const SUMMIT_X_MIN = -0.35;
const SUMMIT_X_RANGE = 0.3;
const SUMMIT_Y_MIN = 0.2;
const SUMMIT_Y_RANGE = 0.2;
const DOME_OVERREACH = 0.12;
const DOME_DEPTH = 1.2;
/** The outline sits this far up the dome rather than on the ground plane. */
const RIM_DEPTH_SHARE = 0.25;
/** Interior points are scattered within this share of the half extents, kept this far apart. */
const INTERIOR_REACH = 0.8;
const INTERIOR_SPACING_SHARE = 0.34;
const INTERIOR_ATTEMPTS = 80;
/** Per-point depth jitter: what turns a smooth dome into broken planes. */
const INTERIOR_DEPTH_JITTER = 0.2;

// ── Surface ──────────────────────────────────────────────────────────────────

/** Soft upper-left bloom and lower gloom laid over the flat facets, so the planes curve into one mass. */
const BLOOM_ALPHA = 0.18;
const GLOOM_ALPHA = 0.34;
const GLOOM_START = 0.45;
/** Ridge lines along facet edges that face the light. */
const RIDGE_ALPHA = 0.42;
const RIDGE_FACING_MIN = 0.25;

const GRAIN_ALPHA = 0.16;
const GRAIN_DENSITY = 0.42;
const FLECK_DENSITY: Readonly<Record<Lithology, number>> = {
  granite: 0.014,
  sandstone: 0.004,
  basalt: 0.004,
  limestone: 0.006,
};
const FLECK_ALPHA = 0.5;
const BEDDING_SPACING_TILES = 0.11;
const BEDDING_ALPHA = 0.12;
const BEDDING_DIP = 0.12;
const PIT_COUNT_MIN = 3;
const PIT_COUNT_MAX = 6;

const RIM_LIGHT_ALPHA = 0.55;
const RIM_LIGHT_WIDTH = 3.2;
/** How squarely an edge must face the light to carry the rim light. */
const RIM_FACING_MIN = 0.2;
const OUTLINE_WIDTH = 2;
const OUTLINE_ALPHA = 0.92;

const MOSS_PATCHES_MIN = 0;
const MOSS_PATCHES_MAX = 2;
/** Outcrops are worked bedrock: bare stone, less moss. */
const OUTCROP_MOSS_CHANCE = 0.4;
const MOSS_BLOBS_MIN = 3;
const MOSS_BLOBS_MAX = 6;
const MOSS_RADIUS_TILES_MIN = 0.02;
const MOSS_RADIUS_TILES_RANGE = 0.025;
const MOSS_SPREAD_TILES = 0.07;
/** A facet counts as upward-facing, and so as ground for moss, below this normal y. */
const UPWARD_NORMAL_Y = -0.3;
const LICHEN_SPECKS_MIN = 3;
const LICHEN_SPECKS_MAX = 7;

const CRACK_SEGMENTS = 4;
const CRACK_WANDER = 0.5;
const CRACK_LIP_ALPHA = 0.4;
const STEP_ALPHA = 0.9;
const STEP_WIDTH = 1.3;
const WEATHER_CRACK_CHANCE = 0.6;
const WEATHER_CRACK_LENGTH_TILES = 0.18;
const DAMAGE_CRACK_LENGTH_TILES = 0.3;
const DEEP_CRACK_LENGTH_TILES = 0.42;
const DEEP_CRACK_WIDTH = 1.3;
const HAIRLINE_CRACK_WIDTH = 0.9;

/** Quartz veins crossing an outcrop: the mineral that makes it worth quarrying. */
const VEIN_COUNT_MIN = 1;
const VEIN_COUNT_MAX = 2;
const VEIN_WIDTH = 1;
const VEIN_ALPHA = 0.65;
const VEIN_GLINTS = 2;
const VEIN_SEGMENTS = 4;
/** Veins dip steeply rather than running level, which would read as a painted stripe. */
const VEIN_HEADING_MIN = 0.35;
const VEIN_HEADING_MAX = 1.1;
const VEIN_LENGTH_TILES_MIN = 0.28;
const VEIN_LENGTH_TILES_RANGE = 0.18;
const GLINT = '#ffffff';
const RUST = '#8a4a22';
const RUST_ALPHA = 0.35;
const RUST_LENGTH_TILES = 0.16;
const RUST_STREAK_WIDTH_PX = 2;

// ── Damage ───────────────────────────────────────────────────────────────────

interface NotchSize {
  /** Vertices of the outline the notch replaces. */
  readonly span: number;
  /** How far the notch bites into the body, in tiles. */
  readonly depthMin: number;
  readonly depthRange: number;
  /** Width of the fresh fracture band inside the notch, in tiles. */
  readonly faceMin: number;
  readonly faceRange: number;
}

const CHIP: NotchSize = {
  span: 1,
  depthMin: 0.09,
  depthRange: 0.03,
  faceMin: 0.14,
  faceRange: 0.04,
};
const CHUNK: NotchSize = {
  span: 2,
  depthMin: 0.04,
  depthRange: 0.05,
  faceMin: 0.12,
  faceRange: 0.05,
};
/** A chunk out of a stone with few corners takes one corner, bitten deeper. */
const NARROW_CHUNK: NotchSize = {
  span: 1,
  depthMin: 0.09,
  depthRange: 0.04,
  faceMin: 0.14,
  faceRange: 0.04,
};
/** How strongly notch placement prefers the shadowed shoulder, in the same units as its height and reach. */
const SHADOW_SHOULDER_BONUS = 0.45;
/** Outlines with at least this many corners can lose two at once to a chunk. */
const WIDE_CHUNK_MIN_VERTICES = 10;
/** Where along its end edges a notch starts and stops. */
const NOTCH_END_MIN = 0.3;
const NOTCH_END_RANGE = 0.4;
/** Sideways jitter of a notch's inner points, as a share of its chord. */
const NOTCH_JAG = 0.18;

/** The stump's cut, as a share of the rock's height above its foot. */
const REMNANT_CUT_SHARE_MIN = 0.45;
const REMNANT_CUT_SHARE_RANGE = 0.1;
const REMNANT_CUT_TILT = 0.22;
/** Depth of the stump's flat top as seen from the three-quarter camera, in tiles. */
const REMNANT_TOP_DEPTH_TILES = 0.16;
const REMNANT_TOP_POINTS = 5;
const REMNANT_TOP_JAG_TILES = 0.035;

interface RubbleAmount {
  readonly count: number;
  readonly radiusMin: number;
  readonly radiusRange: number;
  /** Chunks big enough to read as pieces of the rock rather than grit. */
  readonly chunks: number;
}

const RUBBLE_BY_STAGE: Readonly<Record<RockDamageState, RubbleAmount>> = {
  idle: { count: 0, radiusMin: 0, radiusRange: 0, chunks: 0 },
  chipped: { count: 3, radiusMin: 0.8, radiusRange: 0.7, chunks: 0 },
  broken: { count: 7, radiusMin: 0.9, radiusRange: 1.1, chunks: 2 },
  remnant: { count: 9, radiusMin: 1, radiusRange: 1.3, chunks: 4 },
};
/**
 * A small stone sheds less: a full heap round a knee-high rock buries it and
 * reads as noise.
 */
const FULL_RUBBLE = 1;
const RUBBLE_SHARE_BY_KIND: Readonly<Record<MineableRockKind, number>> = {
  small: 0.6,
  large: FULL_RUBBLE,
  outcrop: FULL_RUBBLE,
};
const RUBBLE_CHUNK_RADIUS_MIN = 2.3;
const RUBBLE_CHUNK_RADIUS_RANGE = 1.3;
/** How far below the rock's foot rubble may lie, in pixels short of the tile's bottom edge. */
const RUBBLE_BOTTOM_MARGIN_PX = 2.5;
/** Rubble may creep this far up the rock's face, in tiles. */
const RUBBLE_RISE_TILES = 0.1;
const RUBBLE_SIDE_MARGIN_PX = 1.5;
const RUBBLE_VERTICES = 5;
const RUBBLE_SHADOW_ALPHA = 0.4;
/**
 * A heap of spoil banked against the foot once the rock is broken: loose
 * pebbles on bare ground read as a scatter of dots, a heap reads as debris.
 * Height in tiles, width as a share of the tile.
 */
const APRON_HEIGHT_TILES: Readonly<Record<RockDamageState, number>> = {
  idle: 0,
  chipped: 0,
  broken: 0.1,
  remnant: 0.14,
};
const APRON_WIDTH_SHARE = 0.8;
const APRON_POINTS = 7;
const PEBBLE_OUTLINE_ALPHA = 0.6;
const DUST_SPECKS = 10;
const DUST_ALPHA = 0.45;

const CONTACT_LINE_ALPHA = 0.62;
const CONTACT_LINE_HEIGHT_PX = 1.8;
const CAST_SHADOW_ALPHA = 0.42;
const CAST_SHADOW_HEIGHT_TILES = 0.1;
const CAST_SHADOW_WIDTH_SHARE = 1.05;
const CAST_SHADOW_OFFSET_PX = 1.5;

const SALT_SHAPE = 1;
const SALT_PEAKS = 2;
const SALT_TONE = 3;
const SALT_GRAIN = 4;
const SALT_MOSS = 5;
const SALT_WEATHER = 6;
const SALT_NOTCHES = 7;
const SALT_DAMAGE_CRACKS = 8;
const SALT_REMNANT = 9;
const SALT_RUBBLE = 10;
const SALT_VEINS = 11;

// ── Painting details ─────────────────────────────────────────────────────────

/** Centre of the bloom down the rock, and its reach across it, as shares of height and half width. */
const BLOOM_HEIGHT_SHARE = 0.25;
const BLOOM_RADIUS_SHARE = 1.2;
/** Bedding planes are not evenly spaced: each gap is the spacing scaled by this range. */
const BEDDING_SPACING_JITTER_MIN = 0.8;
const BEDDING_SPACING_JITTER_MAX = 1.3;
/** A pit is a dark pixel with a lit rim below-right of it, kept clear of the outline. */
const PIT_INSET_PX = 2;
const PIT_ALPHA = 0.7;
const PIT_RIM_ALPHA = 0.45;
/** Where a vein starts, as shares of half width from the centre and of height from the crown. */
const VEIN_START_X_MIN = -0.7;
const VEIN_START_X_MAX = 0.2;
const VEIN_START_Y_MIN = 0.25;
const VEIN_START_Y_MAX = 0.55;
/** Moss cushions are wider than tall, with a lit crown up and to the left. */
const MOSS_WIDENING = 1.3;
const MOSS_HIGHLIGHT_OFFSET = 0.32;
const MOSS_HIGHLIGHT_SIZE = 0.5;
const MOSS_HIGHLIGHT_FLATTEN = 0.7;
const LICHEN_ALPHA_MAX = 0.9;
/** The lit lip runs one pixel down-right of the crack, a little thinner than it. */
const CRACK_LIP_OFFSET_PX = 1;
const CRACK_LIP_WIDTH_SHARE = 0.8;
/** A deep crack forks off at this angle, in radians, to either side. */
const FORK_ANGLE_MIN = 0.7;
const FORK_ANGLE_MAX = 1.2;
/** Damage cracks run from a notch toward this height up the rock, as a share of its height. */
const CRACK_TARGET_HEIGHT_SHARE = 0.4;
const DAMAGE_CRACK_WIDTH = 1;
/** A crack across the stump's top runs back from its front edge, away from the ends. */
const STUMP_CRACK_ALONG_MIN = 0.3;
const STUMP_CRACK_SPREAD = 0.8;
const STUMP_CRACK_LENGTH_TILES = 0.14;
const STUMP_ARRIS_ALPHA = 0.9;
/** The stump's top is fresh stone seen from above, so its grain is denser than the skin's. */
const STUMP_GRAIN_BOOST = 2;
/** Pebbles: a flattened, uneven polygon with a shadow under it and a lit face up and to the left. */
const PEBBLE_REACH_MIN = 0.75;
const PEBBLE_REACH_MAX = 1.1;
const PEBBLE_FLATTEN = 0.72;
const PEBBLE_SHADOW_WIDTH_SHARE = 1.05;
const PEBBLE_SHADOW_HEIGHT_SHARE = 0.45;
const PEBBLE_LIT_OFFSET_X = 0.35;
const PEBBLE_LIT_OFFSET_Y = 0.4;
const PEBBLE_LIT_SHRINK = 0.45;
/** Freshly broken pieces outnumber weathered ones: most of the rubble came off the new faces. */
const FRESH_PEBBLE_SHARE = 0.65;
const CONTACT_LINE_WIDTH_SHARE = 0.92;
const CAST_SHADOW_MID_STOP = 0.7;
const APRON_JAG_MIN = 0.7;
const APRON_JAG_MAX = 1.1;
/**
 * A fracture face points out along the break and partly toward the viewer:
 * the two shares of its (roughly unit) normal.
 */
const NOTCH_FACE_SIDEWAYS = 0.75;
const NOTCH_FACE_TOWARD_VIEWER = 0.66;

// ── Geometry ─────────────────────────────────────────────────────────────────

interface Facet {
  readonly corners: readonly [Point3, Point3, Point3];
  readonly normal: Point3;
  readonly tone: string;
}

interface Rock {
  readonly centreX: number;
  readonly baseY: number;
  readonly topY: number;
  readonly halfWidth: number;
  readonly height: number;
  readonly outline: readonly Point[];
  readonly facets: readonly Facet[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function signedPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

function traceRing(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function tracePolyline(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function withClip(ctx: Ctx, ring: readonly Point[], paint: () => void): void {
  ctx.save();
  try {
    traceRing(ctx, ring);
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

function hexChannels(hex: string): readonly [number, number, number] {
  const HEX_RADIX = 16;
  const RED = 1;
  const GREEN = 3;
  const BLUE = 5;
  const DIGITS = 2;
  return [
    Number.parseInt(hex.slice(RED, RED + DIGITS), HEX_RADIX),
    Number.parseInt(hex.slice(GREEN, GREEN + DIGITS), HEX_RADIX),
    Number.parseInt(hex.slice(BLUE, BLUE + DIGITS), HEX_RADIX),
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexChannels(a);
  const [br, bg, bb] = hexChannels(b);
  const mix = (from: number, to: number): number => Math.round(lerp(from, to, clamp01(t)));
  return `rgb(${mix(ar, br)},${mix(ag, bg)},${mix(ab, bb)})`;
}

function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = hexChannels(hex);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** A colour from the five-step skin ramp, `t` running dark to bright. */
function skinTone(ramp: Ramp, t: number): string {
  const steps = [ramp.deep, ramp.shadow, ramp.body, ramp.light, ramp.high];
  const scaled = clamp01(t) * (steps.length - 1);
  const lower = Math.min(steps.length - 2, Math.floor(scaled));
  return mixHex(steps[lower], steps[lower + 1], scaled - lower);
}

function freshTone(ramp: Ramp, t: number): string {
  const clamped = clamp01(t);
  return clamped < HALF
    ? mixHex(ramp.freshDark, ramp.fresh, clamped / HALF)
    : mixHex(ramp.fresh, ramp.freshLit, (clamped - HALF) / HALF);
}

function lambertShare(normal: Point3): number {
  const lambert = normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z;
  return (lambert - LAMBERT_DARK) / (LAMBERT_BRIGHT - LAMBERT_DARK);
}

function facetNormal(a: Point3, b: Point3, c: Point3): Point3 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  const facingViewer = nz >= 0 ? 1 : -1;
  return {
    x: (nx / length) * facingViewer,
    y: (ny / length) * facingViewer,
    z: (nz / length) * facingViewer,
  };
}

/**
 * The outline: a superellipse wobbled by smooth harmonics, feet flattened onto
 * the ground, leaned, then normalised so it spans exactly its width budget and
 * its height. Normalising after the wobble is what keeps the width budget a
 * guarantee rather than a starting point.
 */
function buildOutline(
  centreX: number,
  baseY: number,
  halfWidth: number,
  height: number,
  profile: KindProfile,
  lithology: Lithology,
  lean: number,
  ts: number,
  rng: Rng,
): Point[] {
  const count = rangeInt(rng, profile.vertexMin, profile.vertexMax);
  const phases = WOBBLE_HARMONICS.map(() => range(rng, 0, TWO_PI));
  const squareness =
    profile.squareness +
    LITHOLOGY_SQUARENESS[lithology] +
    range(rng, -SQUARENESS_JITTER, SQUARENESS_JITTER);
  const exponent = 2 / squareness;
  const step = TWO_PI / count;
  const startAngle = range(rng, 0, step);
  const raw: Point[] = [];
  for (let index = 0; index < count; index++) {
    const angle = startAngle + index * step + range(rng, -1, 1) * step * VERTEX_ANGLE_JITTER;
    let wobble = 1;
    WOBBLE_HARMONICS.forEach((harmonic, harmonicIndex) => {
      const amplitude = profile.wobble * WOBBLE_FALLOFF ** harmonicIndex;
      wobble += amplitude * Math.sin(harmonic * angle + phases[harmonicIndex]);
    });
    const sin = Math.sin(angle);
    const x = signedPow(Math.cos(angle), exponent) * wobble;
    const onFoot = sin > FOOT_FLATTEN_SIN;
    const footLift = (ts * FOOT_LIFT_TILES) / (height * HALF);
    const y = onFoot ? 1 - range(rng, 0, footLift) : signedPow(sin, exponent) * wobble;
    const heightShare = (1 - y) * HALF;
    const tapered = x * (1 - profile.taper * heightShare);
    raw.push({ x: tapered + heightShare * lean, y });
  }
  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return raw.map((point) => ({
    x: centreX - halfWidth + ((point.x - minX) / (maxX - minX)) * halfWidth * 2,
    y: baseY - height + ((point.y - minY) / (maxY - minY)) * height,
  }));
}

function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

type Triangle = readonly [number, number, number];

/**
 * Delaunay triangulation (Bowyer–Watson) of a small point set. Delaunay rather
 * than a fan because it keeps every facet fat: a fan from one peak makes long
 * slivers, and a sliver reads as a scratch rather than as a plane of stone.
 */
function triangulate(points: readonly Point[]): Triangle[] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const superScale = 20;
  const all: Point[] = [
    ...points,
    { x: minX - span * superScale, y: minY - span },
    { x: minX + span * HALF, y: minY + span * superScale },
    { x: minX + span * superScale, y: minY - span },
  ];
  const superA = points.length;
  let triangles: Triangle[] = [[superA, superA + 1, superA + 2]];
  const circumcircle = (triangle: Triangle): { x: number; y: number; r2: number } => {
    const [a, b, c] = triangle.map((index) => all[index]);
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const a2 = a.x * a.x + a.y * a.y;
    const b2 = b.x * b.x + b.y * b.y;
    const c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x, y, r2: (a.x - x) ** 2 + (a.y - y) ** 2 };
  };
  points.forEach((point, pointIndex) => {
    const bad = triangles.filter((triangle) => {
      const circle = circumcircle(triangle);
      return (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 < circle.r2;
    });
    const edges: [number, number][] = [];
    for (const triangle of bad) {
      for (let corner = 0; corner < triangle.length; corner++) {
        const edge: [number, number] = [triangle[corner], triangle[(corner + 1) % triangle.length]];
        const sharedIndex = edges.findIndex(
          ([from, to]) =>
            (from === edge[0] && to === edge[1]) || (from === edge[1] && to === edge[0]),
        );
        if (sharedIndex >= 0) edges.splice(sharedIndex, 1);
        else edges.push(edge);
      }
    }
    triangles = triangles.filter((triangle) => !bad.includes(triangle));
    for (const [from, to] of edges) triangles.push([from, to, pointIndex]);
  });
  return triangles.filter((triangle) => triangle.every((index) => index < superA));
}

/**
 * The body's planes: the outline at depth zero plus a scatter of interior
 * points lifted onto a dome whose summit sits up and to the left of centre,
 * triangulated, and every triangle shaded by its real normal. The dome is what
 * gives a lit top and a shadowed flank; the scatter is what breaks it into
 * planes instead of a smooth egg.
 */
function buildFacets(
  outline: readonly Point[],
  centreX: number,
  topY: number,
  halfWidth: number,
  height: number,
  interiorCount: number,
  ramp: Ramp,
  seed: number,
): Facet[] {
  const rng = mulberry32(subSeed(seed, SALT_PEAKS));
  const summit = {
    x: centreX + halfWidth * range(rng, SUMMIT_X_MIN, SUMMIT_X_MIN + SUMMIT_X_RANGE),
    y: topY + height * range(rng, SUMMIT_Y_MIN, SUMMIT_Y_MIN + SUMMIT_Y_RANGE),
  };
  const reachX = halfWidth * (1 + DOME_OVERREACH);
  const reachY = height * (HALF + DOME_OVERREACH);
  const domeDepth = (point: Point): number => {
    const dx = (point.x - summit.x) / reachX;
    const dy = (point.y - summit.y) / reachY;
    return halfWidth * DOME_DEPTH * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  };
  const interior: Point[] = [];
  const minSpacing = halfWidth * INTERIOR_SPACING_SHARE;
  for (let attempt = 0; attempt < INTERIOR_ATTEMPTS && interior.length < interiorCount; attempt++) {
    const candidate = {
      x: centreX + halfWidth * range(rng, -INTERIOR_REACH, INTERIOR_REACH),
      y: topY + height * range(rng, 1 - INTERIOR_REACH, INTERIOR_REACH),
    };
    if (!pointInRing(candidate, outline)) continue;
    const nearEdge = outline.some(
      (corner) => Math.hypot(corner.x - candidate.x, corner.y - candidate.y) < minSpacing,
    );
    const nearOther = interior.some(
      (other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) < minSpacing,
    );
    if (!nearEdge && !nearOther) interior.push(candidate);
  }
  const points: Point3[] = [
    ...outline.map((point) => ({ ...point, z: domeDepth(point) * RIM_DEPTH_SHARE })),
    ...interior.map((point) => ({
      ...point,
      z: domeDepth(point) * range(rng, 1 - INTERIOR_DEPTH_JITTER, 1 + INTERIOR_DEPTH_JITTER),
    })),
  ];
  const toneRng = mulberry32(subSeed(seed, SALT_TONE));
  return triangulate(points)
    .filter((triangle) => {
      const [a, b, c] = triangle.map((index) => points[index]);
      return pointInRing({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }, outline);
    })
    .map((triangle) => {
      const corners: [Point3, Point3, Point3] = [
        points[triangle[0]],
        points[triangle[1]],
        points[triangle[2]],
      ];
      const normal = facetNormal(corners[0], corners[1], corners[2]);
      const jitter = range(toneRng, -FACET_TONE_JITTER, FACET_TONE_JITTER);
      return { corners, normal, tone: skinTone(ramp, lambertShare(normal) + jitter) };
    });
}

function buildRock(spec: MineableRockSpec, seed: number, frame: RockFrame, ramp: Ramp): Rock {
  const ts = frame.tileScale;
  const profile = KIND_PROFILES[spec.kind];
  const shapeRng = mulberry32(subSeed(seed, SALT_SHAPE));
  const height = ts * (profile.heightMin + shapeRng() * profile.heightRange);
  const halfWidth =
    ts *
    MAX_HALF_WIDTH_TILES *
    (profile.halfWidthShareMin + shapeRng() * profile.halfWidthShareRange);
  const centreX = frame.originX + ts * HALF;
  const baseY = frame.originY + ts * (1 - BASE_LIFT_TILES);
  const topY = baseY - height;
  const outline = buildOutline(
    centreX,
    baseY,
    halfWidth,
    height,
    profile,
    spec.lithology,
    spec.lean,
    ts,
    shapeRng,
  );
  const facets = buildFacets(
    outline,
    centreX,
    topY,
    halfWidth,
    height,
    profile.interiorPoints,
    ramp,
    seed,
  );
  return { centreX, baseY, topY, halfWidth, height, outline, facets };
}

// ── Damage geometry ──────────────────────────────────────────────────────────

interface Notch {
  /** The notch's new silhouette edge, from where it leaves the old outline to where it rejoins. */
  readonly edge: readonly Point[];
  /** The step where the fracture face meets the weathered skin, deeper inside the body. */
  readonly step: readonly Point[];
  /** Outward direction of the break, for shading its face. */
  readonly outward: Point;
}

interface Breakage {
  readonly outline: readonly Point[];
  readonly notches: readonly Notch[];
}

/**
 * Cuts one notch into `outline`, replacing `size.span` vertices starting at
 * `first`. Returns the new outline and the notch, or null where the vertices
 * are the rock's foot — a pick does not take a bite out of the ground line.
 */
function cutNotch(
  outline: readonly Point[],
  first: number,
  size: NotchSize,
  centre: Point,
  baseY: number,
  ts: number,
  rng: Rng,
): { outline: Point[]; notch: Notch } | null {
  const count = outline.length;
  const at = (index: number): Point => outline[((index % count) + count) % count];
  const footTolerance = ts * FOOT_LIFT_TILES * 2;
  for (let offset = 0; offset < size.span; offset++) {
    if (at(first + offset).y > baseY - footTolerance) return null;
  }
  const before = at(first - 1);
  const firstRemoved = at(first);
  const lastRemoved = at(first + size.span - 1);
  const after = at(first + size.span);
  const start = lerpPoint(before, firstRemoved, NOTCH_END_MIN + rng() * NOTCH_END_RANGE);
  const end = lerpPoint(lastRemoved, after, 1 - (NOTCH_END_MIN + rng() * NOTCH_END_RANGE));
  const chordMid = lerpPoint(start, end, HALF);
  const inwardX = centre.x - chordMid.x;
  const inwardY = centre.y - chordMid.y;
  const inwardLength = Math.hypot(inwardX, inwardY) || 1;
  const inward = { x: inwardX / inwardLength, y: inwardY / inwardLength };
  const depth = ts * (size.depthMin + rng() * size.depthRange);
  const faceWidth = ts * (size.faceMin + rng() * size.faceRange);
  const innerCount = size.span;
  const edge: Point[] = [start];
  const step: Point[] = [start];
  for (let index = 1; index <= innerCount; index++) {
    const along = index / (innerCount + 1) + range(rng, -NOTCH_JAG, NOTCH_JAG) / (innerCount + 1);
    const onChord = lerpPoint(start, end, along);
    const bite = depth * range(rng, 1 - NOTCH_JAG * 2, 1);
    const inner = { x: onChord.x + inward.x * bite, y: onChord.y + inward.y * bite };
    edge.push(inner);
    step.push({ x: inner.x + inward.x * faceWidth, y: inner.y + inward.y * faceWidth });
  }
  edge.push(end);
  step.push(end);
  const next: Point[] = [];
  for (let index = 0; index < count; index++) {
    const relative = (((index - first) % count) + count) % count;
    if (relative === 0) next.push(...edge);
    else if (relative >= size.span) next.push(outline[index]);
  }
  return {
    outline: next,
    notch: { edge, step, outward: { x: -inward.x, y: -inward.y } },
  };
}

/**
 * The notches a stage has: chips at the chipped stage, and the chips grown into
 * chunks plus a fresh chunk once broken. Every stage draws its candidates from
 * the same stream in the same order, so the broken rock's bites are where the
 * chipped rock's were.
 */
function breakRock(rock: Rock, stage: RockDamageState, seed: number, ts: number): Breakage {
  if (stage === 'idle') return { outline: rock.outline, notches: [] };
  const rng = mulberry32(subSeed(seed, SALT_NOTCHES));
  const count = rock.outline.length;
  // Shoulders first, and the shadowed right-hand shoulder before the lit left:
  // a bite shows its pale fresh face against a dark flank, where one out of
  // the lit crown is lost in the light.
  const shoulderness = (index: number): number => {
    const corner = rock.outline[index];
    const sideways = Math.abs(corner.x - rock.centreX) / rock.halfWidth;
    const upward = (rock.baseY - corner.y) / rock.height;
    const inShadow = corner.x > rock.centreX ? SHADOW_SHOULDER_BONUS : 0;
    return sideways + upward + inShadow;
  };
  const shouldersFirst = [...rock.outline.keys()].sort((a, b) => shoulderness(b) - shoulderness(a));
  const chosen: number[] = [];
  const minGap = CHUNK.span + 1;
  const gap = (a: number, b: number): number => {
    const forward = (((a - b) % count) + count) % count;
    return Math.min(forward, count - forward);
  };
  for (const index of shouldersFirst) {
    const skipChance = HALF;
    if (chosen.length > 0 && rng() < skipChance) continue;
    const wrapsRing = index + CHUNK.span > count;
    if (wrapsRing) continue;
    if (chosen.every((other) => gap(index, other) >= minGap)) chosen.push(index);
    const plannedNotches = 3;
    if (chosen.length >= plannedNotches) break;
  }
  // A two-vertex chunk out of an eight-sided stone takes a quarter of its
  // outline, which reads as a different shape rather than a damaged one.
  const chunk = count >= WIDE_CHUNK_MIN_VERTICES ? CHUNK : NARROW_CHUNK;
  const sizes: NotchSize[] = stage === 'chipped' ? [CHIP, CHIP] : [chunk, CHIP, chunk];
  const centre = { x: rock.centreX, y: rock.baseY - rock.height * HALF };
  const planned = chosen
    .slice(0, sizes.length)
    .map((first, index) => ({ first, size: sizes[index] }));
  // Later vertices first, so an earlier notch's indices survive a later cut.
  planned.sort((a, b) => b.first - a.first);
  let outline: Point[] = [...rock.outline];
  const notches: Notch[] = [];
  for (const { first, size } of planned) {
    const cut = cutNotch(
      outline,
      first,
      size,
      centre,
      rock.baseY,
      ts,
      mulberry32(subSeed(subSeed(seed, SALT_NOTCHES), first)),
    );
    if (cut === null) continue;
    outline = cut.outline;
    notches.push(cut.notch);
  }
  return { outline, notches };
}

interface Stump {
  readonly outline: readonly Point[];
  /** The flat fracture on top, seen from above: back edge along the silhouette, front edge inside it. */
  readonly top: readonly Point[];
  readonly frontEdge: readonly Point[];
}

/**
 * Shears the rock off along a tilted line and stands a flat broken top on what
 * is left. Clips the outline to the half-plane below the cut, then replaces the
 * cut edge with the top's jagged back rim, so the top face reads as a surface
 * seen from above rather than as a straight saw line.
 */
function shearToStump(outline: readonly Point[], rock: Rock, seed: number, ts: number): Stump {
  const rng = mulberry32(subSeed(seed, SALT_REMNANT));
  const cutHeight = rock.height * (REMNANT_CUT_SHARE_MIN + rng() * REMNANT_CUT_SHARE_RANGE);
  const tilt = range(rng, -REMNANT_CUT_TILT, REMNANT_CUT_TILT);
  const cutY = (x: number): number => rock.baseY - cutHeight + (x - rock.centreX) * tilt;
  const below = (point: Point): boolean => point.y >= cutY(point.x);
  const crossing = (a: Point, b: Point): Point => {
    const da = a.y - cutY(a.x);
    const db = b.y - cutY(b.x);
    return lerpPoint(a, b, da / (da - db));
  };
  const clipped: Point[] = [];
  let exitIndex = -1;
  outline.forEach((current, index) => {
    const next = outline[(index + 1) % outline.length];
    const currentBelow = below(current);
    const nextBelow = below(next);
    if (currentBelow) clipped.push(current);
    if (currentBelow && !nextBelow) {
      clipped.push(crossing(current, next));
      exitIndex = clipped.length - 1;
    } else if (!currentBelow && nextBelow) {
      clipped.push(crossing(current, next));
    }
  });
  const exitPoint = clipped[exitIndex];
  const entryPoint = clipped[(exitIndex + 1) % clipped.length];
  const topDepth = ts * REMNANT_TOP_DEPTH_TILES;
  const jag = ts * REMNANT_TOP_JAG_TILES;
  const back: Point[] = [];
  const front: Point[] = [exitPoint];
  for (let index = 1; index < REMNANT_TOP_POINTS; index++) {
    const t = index / REMNANT_TOP_POINTS;
    const onCut = lerpPoint(exitPoint, entryPoint, t);
    const bulge = Math.sin(t * Math.PI);
    back.push({ x: onCut.x, y: onCut.y - topDepth * bulge - range(rng, 0, jag) });
    front.push({ x: onCut.x, y: onCut.y + range(rng, -jag, jag) * bulge });
  }
  front.push(entryPoint);
  const stumpOutline = [
    ...clipped.slice(0, exitIndex + 1),
    ...back,
    ...clipped.slice(exitIndex + 1),
  ];
  const top = [exitPoint, ...back, entryPoint, ...[...front].reverse().slice(1, -1)];
  return { outline: stumpOutline, top, frontEdge: front };
}

// ── Painting ─────────────────────────────────────────────────────────────────

function paintFacets(ctx: Ctx, rock: Rock, ramp: Ramp): void {
  traceRing(ctx, rock.outline);
  ctx.fillStyle = ramp.body;
  ctx.fill();
  for (const facet of rock.facets) {
    traceRing(ctx, facet.corners);
    ctx.fillStyle = facet.tone;
    ctx.fill();
    // Stroking each facet in its own colour closes the antialiased seam two
    // neighbouring fills leave, which otherwise reads as a light crack.
    ctx.strokeStyle = facet.tone;
    ctx.lineWidth = HALF;
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  for (const facet of rock.facets) {
    const [peak, from, to] = facet.corners;
    for (const end of [from, to]) {
      const dx = end.x - peak.x;
      const dy = end.y - peak.y;
      const length = Math.hypot(dx, dy) || 1;
      // A ridge running up-left to down-right catches the light along its crest.
      const facing = -(dx / length) * LIGHT.y + (dy / length) * LIGHT.x;
      if (Math.abs(facing) < RIDGE_FACING_MIN || facet.normal.y > 0) continue;
      tracePolyline(ctx, [peak, end]);
      ctx.strokeStyle = withAlpha(ramp.high, RIDGE_ALPHA * Math.abs(facing));
      ctx.stroke();
    }
  }
}

function paintVolume(ctx: Ctx, rock: Rock, ramp: Ramp): void {
  const bloom = ctx.createRadialGradient(
    rock.centreX - rock.halfWidth * HALF,
    rock.topY + rock.height * BLOOM_HEIGHT_SHARE,
    0,
    rock.centreX - rock.halfWidth * HALF,
    rock.topY + rock.height * BLOOM_HEIGHT_SHARE,
    rock.halfWidth * BLOOM_RADIUS_SHARE,
  );
  bloom.addColorStop(0, withAlpha(ramp.high, BLOOM_ALPHA));
  bloom.addColorStop(1, withAlpha(ramp.high, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(rock.centreX - rock.halfWidth, rock.topY, rock.halfWidth * 2, rock.height);
  const gloom = ctx.createLinearGradient(0, rock.topY + rock.height * GLOOM_START, 0, rock.baseY);
  gloom.addColorStop(0, withAlpha(ramp.deep, 0));
  gloom.addColorStop(1, withAlpha(ramp.deep, GLOOM_ALPHA));
  ctx.fillStyle = gloom;
  ctx.fillRect(rock.centreX - rock.halfWidth, rock.topY, rock.halfWidth * 2, rock.height);
}

/** Pixel grain, crystal flecks and the lithology's own marks, clipped to the skin by the caller. */
function paintGrain(
  ctx: Ctx,
  rock: Rock,
  lithology: Lithology,
  ramp: Ramp,
  ts: number,
  rng: Rng,
): void {
  const left = Math.floor(rock.centreX - rock.halfWidth);
  const right = Math.ceil(rock.centreX + rock.halfWidth);
  const top = Math.floor(rock.topY);
  const bottom = Math.ceil(rock.baseY);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const roll = rng();
      if (roll < FLECK_DENSITY[lithology]) {
        ctx.fillStyle = withAlpha(ramp.fleck, FLECK_ALPHA * range(rng, HALF, 1));
        ctx.fillRect(x, y, 1, 1);
      } else if (roll < GRAIN_DENSITY) {
        const lighter = rng() < HALF;
        ctx.fillStyle = withAlpha(lighter ? ramp.high : ramp.deep, GRAIN_ALPHA * rng());
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  if (lithology === 'sandstone') {
    const spacing = ts * BEDDING_SPACING_TILES;
    const dip = range(rng, -BEDDING_DIP, BEDDING_DIP);
    ctx.lineWidth = 1;
    for (
      let y = rock.topY + spacing * range(rng, HALF, 1);
      y < rock.baseY;
      y += spacing * range(rng, BEDDING_SPACING_JITTER_MIN, BEDDING_SPACING_JITTER_MAX)
    ) {
      tracePolyline(ctx, [
        { x: left, y: y - rock.halfWidth * dip },
        { x: right, y: y + rock.halfWidth * dip },
      ]);
      ctx.strokeStyle = withAlpha(ramp.deep, BEDDING_ALPHA);
      ctx.stroke();
      tracePolyline(ctx, [
        { x: left, y: y + 1 - rock.halfWidth * dip },
        { x: right, y: y + 1 + rock.halfWidth * dip },
      ]);
      ctx.strokeStyle = withAlpha(ramp.high, BEDDING_ALPHA * HALF);
      ctx.stroke();
    }
  }
  if (lithology === 'basalt' || lithology === 'limestone') {
    const pits = rangeInt(rng, PIT_COUNT_MIN, PIT_COUNT_MAX);
    for (let index = 0; index < pits; index++) {
      const x = Math.round(range(rng, left + PIT_INSET_PX, right - PIT_INSET_PX));
      const y = Math.round(range(rng, top + PIT_INSET_PX, bottom - PIT_INSET_PX));
      ctx.fillStyle = withAlpha(ramp.deep, PIT_ALPHA);
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = withAlpha(ramp.high, PIT_RIM_ALPHA);
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
}

/**
 * Quartz veins crossing an outcrop, each trailing a rust stain down the face
 * below it. The stain is what reads as "ore" at play size, where a one-pixel
 * vein alone is only a scratch.
 */
function paintVeins(ctx: Ctx, rock: Rock, ramp: Ramp, ts: number, rng: Rng): void {
  const veins = rangeInt(rng, VEIN_COUNT_MIN, VEIN_COUNT_MAX);
  for (let index = 0; index < veins; index++) {
    const start = {
      x: rock.centreX + rock.halfWidth * range(rng, VEIN_START_X_MIN, VEIN_START_X_MAX),
      y: rock.topY + rock.height * range(rng, VEIN_START_Y_MIN, VEIN_START_Y_MAX),
    };
    const heading = range(rng, VEIN_HEADING_MIN, VEIN_HEADING_MAX);
    const length =
      ts * range(rng, VEIN_LENGTH_TILES_MIN, VEIN_LENGTH_TILES_MIN + VEIN_LENGTH_TILES_RANGE);
    const points: Point[] = [start];
    let angle = heading;
    for (let step = 1; step <= VEIN_SEGMENTS; step++) {
      angle += range(rng, -CRACK_WANDER, CRACK_WANDER) * HALF;
      const previous = points[step - 1];
      points.push({
        x: previous.x + (Math.cos(angle) * length) / VEIN_SEGMENTS,
        y: previous.y + (Math.sin(angle) * length) / VEIN_SEGMENTS,
      });
    }
    const stain = ctx.createLinearGradient(0, start.y, 0, start.y + ts * RUST_LENGTH_TILES);
    stain.addColorStop(0, withAlpha(RUST, RUST_ALPHA));
    stain.addColorStop(1, withAlpha(RUST, 0));
    ctx.fillStyle = stain;
    for (const point of points) {
      ctx.fillRect(Math.round(point.x) - 1, point.y, RUST_STREAK_WIDTH_PX, ts * RUST_LENGTH_TILES);
    }
    tracePolyline(ctx, points);
    ctx.lineWidth = VEIN_WIDTH;
    ctx.strokeStyle = withAlpha(ramp.fleck, VEIN_ALPHA);
    ctx.stroke();
    for (let glint = 0; glint < VEIN_GLINTS; glint++) {
      const at = points[rangeInt(rng, 0, points.length - 1)];
      ctx.fillStyle = GLINT;
      ctx.fillRect(Math.round(at.x), Math.round(at.y), 1, 1);
    }
  }
}

function pointInFacet(facet: Facet, rng: Rng): Point {
  let a = rng();
  let b = rng();
  if (a + b > 1) {
    a = 1 - a;
    b = 1 - b;
  }
  const [p, q, r] = facet.corners;
  return { x: p.x + (q.x - p.x) * a + (r.x - p.x) * b, y: p.y + (q.y - p.y) * a + (r.y - p.y) * b };
}

function paintMoss(
  ctx: Ctx,
  rock: Rock,
  ramp: Ramp,
  kind: MineableRockKind,
  ts: number,
  rng: Rng,
): void {
  const upward = rock.facets.filter((facet) => facet.normal.y < UPWARD_NORMAL_Y);
  if (upward.length === 0) return;
  const mossy = kind !== 'outcrop' || rng() < OUTCROP_MOSS_CHANCE;
  const patches = mossy ? rangeInt(rng, MOSS_PATCHES_MIN, MOSS_PATCHES_MAX) : 0;
  for (let patch = 0; patch < patches; patch++) {
    const facet = upward[Math.floor(rng() * upward.length)];
    const centre = pointInFacet(facet, rng);
    const blobs = rangeInt(rng, MOSS_BLOBS_MIN, MOSS_BLOBS_MAX);
    for (let blob = 0; blob < blobs; blob++) {
      const radius = ts * (MOSS_RADIUS_TILES_MIN + rng() * MOSS_RADIUS_TILES_RANGE);
      const x = centre.x + range(rng, -1, 1) * ts * MOSS_SPREAD_TILES;
      const y = centre.y + range(rng, -HALF, 1) * ts * MOSS_SPREAD_TILES * HALF;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * MOSS_WIDENING, radius, 0, 0, TWO_PI);
      ctx.fillStyle = MOSS_DARK;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        x - radius * MOSS_HIGHLIGHT_OFFSET,
        y - radius * MOSS_HIGHLIGHT_OFFSET,
        radius * MOSS_HIGHLIGHT_SIZE,
        radius * MOSS_HIGHLIGHT_SIZE * MOSS_HIGHLIGHT_FLATTEN,
        0,
        0,
        TWO_PI,
      );
      ctx.fillStyle = MOSS_LIGHT;
      ctx.fill();
    }
  }
  const specks = rangeInt(rng, LICHEN_SPECKS_MIN, LICHEN_SPECKS_MAX);
  for (let speck = 0; speck < specks; speck++) {
    const facet = upward[Math.floor(rng() * upward.length)];
    const at = pointInFacet(facet, rng);
    ctx.fillStyle = withAlpha(ramp.lichen, range(rng, HALF, LICHEN_ALPHA_MAX));
    ctx.fillRect(Math.round(at.x), Math.round(at.y), rng() < HALF ? 1 : 2, 1);
  }
}

/** A crack wandering from `start` in `heading`, with a lit lip on its lower-right side. */
function paintCrack(
  ctx: Ctx,
  start: Point,
  heading: number,
  length: number,
  width: number,
  ramp: Ramp,
  rng: Rng,
): Point[] {
  const points: Point[] = [start];
  let angle = heading;
  let at = start;
  const segment = length / CRACK_SEGMENTS;
  for (let index = 0; index < CRACK_SEGMENTS; index++) {
    angle += range(rng, -CRACK_WANDER, CRACK_WANDER);
    at = { x: at.x + Math.cos(angle) * segment, y: at.y + Math.sin(angle) * segment };
    points.push(at);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePolyline(
    ctx,
    points.map((point) => ({ x: point.x + CRACK_LIP_OFFSET_PX, y: point.y + CRACK_LIP_OFFSET_PX })),
  );
  ctx.lineWidth = width * CRACK_LIP_WIDTH_SHARE;
  ctx.strokeStyle = withAlpha(ramp.high, CRACK_LIP_ALPHA);
  ctx.stroke();
  tracePolyline(ctx, points);
  ctx.lineWidth = width;
  ctx.strokeStyle = ramp.crack;
  ctx.stroke();
  return points;
}

function paintWeatherCracks(ctx: Ctx, rock: Rock, ramp: Ramp, ts: number, rng: Rng): void {
  if (rng() >= WEATHER_CRACK_CHANCE) return;
  const start = rock.outline[Math.floor(rng() * rock.outline.length)];
  const heading = Math.atan2(rock.baseY - rock.height * HALF - start.y, rock.centreX - start.x);
  paintCrack(ctx, start, heading, ts * WEATHER_CRACK_LENGTH_TILES, HAIRLINE_CRACK_WIDTH, ramp, rng);
}

function paintNotchFace(ctx: Ctx, notch: Notch, ramp: Ramp): void {
  const face = [...notch.edge, ...[...notch.step].reverse().slice(1, -1)];
  const facing = lambertShare({
    x: notch.outward.x * NOTCH_FACE_SIDEWAYS,
    y: notch.outward.y * NOTCH_FACE_SIDEWAYS,
    z: NOTCH_FACE_TOWARD_VIEWER,
  });
  traceRing(ctx, face);
  ctx.fillStyle = freshTone(ramp, facing);
  ctx.fill();
  // The fracture is conchoidal: a lit ripple halfway across the face.
  const ripple = notch.edge.map((point, index) => lerpPoint(point, notch.step[index], HALF));
  tracePolyline(ctx, ripple);
  ctx.lineWidth = HALF;
  ctx.strokeStyle = withAlpha(ramp.freshLit, HALF);
  ctx.stroke();
  // Where the new face meets the old skin the rock steps back, and the step
  // is always in shadow: even on the lit crown it is the line that says a
  // piece is missing.
  tracePolyline(ctx, notch.step);
  ctx.lineWidth = STEP_WIDTH;
  ctx.strokeStyle = withAlpha(ramp.crack, STEP_ALPHA);
  ctx.stroke();
}

function paintDamageCracks(
  ctx: Ctx,
  rock: Rock,
  breakage: Breakage,
  stage: RockDamageState,
  ramp: Ramp,
  ts: number,
  rng: Rng,
): void {
  const centre = { x: rock.centreX, y: rock.baseY - rock.height * CRACK_TARGET_HEIGHT_SHARE };
  const deep = stage !== 'chipped';
  for (const notch of breakage.notches) {
    const from = notch.step[Math.floor(notch.step.length / 2)];
    const heading = Math.atan2(centre.y - from.y, centre.x - from.x) + range(rng, -HALF, HALF);
    const length = ts * (deep ? DEEP_CRACK_LENGTH_TILES : DAMAGE_CRACK_LENGTH_TILES);
    const width = deep ? DEEP_CRACK_WIDTH : DAMAGE_CRACK_WIDTH;
    const crack = paintCrack(ctx, from, heading, length, width, ramp, rng);
    if (deep) {
      const forkFrom = crack[Math.floor(crack.length / 2)];
      const forkSide = rng() < HALF ? 1 : -1;
      const forkHeading = heading + range(rng, FORK_ANGLE_MIN, FORK_ANGLE_MAX) * forkSide;
      paintCrack(ctx, forkFrom, forkHeading, length * HALF, HAIRLINE_CRACK_WIDTH, ramp, rng);
    }
  }
}

function paintStumpTop(ctx: Ctx, stump: Stump, ramp: Ramp, ts: number, rng: Rng): void {
  traceRing(ctx, stump.top);
  const bounds = stump.top.reduce(
    (box, point) => ({
      left: Math.min(box.left, point.x),
      right: Math.max(box.right, point.x),
      top: Math.min(box.top, point.y),
      bottom: Math.max(box.bottom, point.y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );
  const wash = ctx.createLinearGradient(bounds.left, bounds.top, bounds.right, bounds.bottom);
  wash.addColorStop(0, ramp.freshLit);
  wash.addColorStop(1, ramp.fresh);
  ctx.fillStyle = wash;
  ctx.fill();
  withClip(ctx, stump.top, () => {
    for (let y = Math.floor(bounds.top); y < bounds.bottom; y++) {
      for (let x = Math.floor(bounds.left); x < bounds.right; x++) {
        if (rng() < GRAIN_DENSITY) {
          ctx.fillStyle = withAlpha(
            rng() < HALF ? ramp.freshDark : ramp.fleck,
            GRAIN_ALPHA * STUMP_GRAIN_BOOST * rng(),
          );
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const firstInner = stump.frontEdge[1];
    const lastInner = stump.frontEdge[stump.frontEdge.length - 2];
    const crackFoot = lerpPoint(
      firstInner,
      lastInner,
      range(rng, STUMP_CRACK_ALONG_MIN, 1 - STUMP_CRACK_ALONG_MIN),
    );
    const backward = -Math.PI * HALF + range(rng, -STUMP_CRACK_SPREAD, STUMP_CRACK_SPREAD);
    const start = { x: crackFoot.x, y: crackFoot.y - 1 };
    paintCrack(ctx, start, backward, ts * STUMP_CRACK_LENGTH_TILES, DAMAGE_CRACK_WIDTH, ramp, rng);
  });
  tracePolyline(ctx, stump.frontEdge);
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(ramp.freshLit, STUMP_ARRIS_ALPHA);
  ctx.stroke();
}

function paintOutline(ctx: Ctx, outline: readonly Point[], ramp: Ramp): void {
  withClip(ctx, outline, () => {
    ctx.lineJoin = 'round';
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length];
      const dx = next.x - point.x;
      const dy = next.y - point.y;
      const length = Math.hypot(dx, dy) || 1;
      // Outward normal of a clockwise-on-screen ring.
      const facing = (dy / length) * LIGHT.x - (dx / length) * LIGHT.y;
      if (facing < RIM_FACING_MIN) return;
      tracePolyline(ctx, [point, next]);
      ctx.lineWidth = RIM_LIGHT_WIDTH;
      ctx.strokeStyle = withAlpha(ramp.high, RIM_LIGHT_ALPHA * facing);
      ctx.stroke();
    });
    traceRing(ctx, outline);
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.strokeStyle = withAlpha(ramp.outline, OUTLINE_ALPHA);
    ctx.stroke();
  });
}

interface RubbleBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly baseY: number;
  readonly tileScale: number;
}

function paintApron(
  ctx: Ctx,
  bounds: RubbleBounds,
  apronHeight: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const width = (bounds.right - bounds.left) * APRON_WIDTH_SHARE;
  const centre = lerp(bounds.left + width * HALF, bounds.right - width * HALF, rng());
  const foot = bounds.bottom;
  const crest: Point[] = [];
  for (let index = 0; index <= APRON_POINTS; index++) {
    const t = index / APRON_POINTS;
    const rise =
      Math.sin(t * Math.PI) ** HALF * apronHeight * range(rng, APRON_JAG_MIN, APRON_JAG_MAX);
    crest.push({ x: centre - width * HALF + width * t, y: foot - rise });
  }
  traceRing(ctx, crest);
  const fill = ctx.createLinearGradient(0, foot - apronHeight, 0, foot);
  fill.addColorStop(0, mixHex(ramp.freshDark, ramp.body, HALF));
  fill.addColorStop(1, ramp.shadow);
  ctx.fillStyle = fill;
  ctx.fill();
  tracePolyline(ctx, crest.slice(0, Math.ceil(crest.length * HALF) + 1));
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(ramp.freshLit, HALF);
  ctx.stroke();
}

function paintPebble(
  ctx: Ctx,
  at: Point,
  radius: number,
  ramp: Ramp,
  fresh: boolean,
  rng: Rng,
): void {
  const corners: Point[] = [];
  const phase = range(rng, 0, TWO_PI);
  for (let index = 0; index < RUBBLE_VERTICES; index++) {
    const angle = phase + (index / RUBBLE_VERTICES) * TWO_PI;
    const reach = radius * range(rng, PEBBLE_REACH_MIN, PEBBLE_REACH_MAX);
    const flattened = Math.sin(angle) * reach * PEBBLE_FLATTEN;
    corners.push({ x: at.x + Math.cos(angle) * reach, y: at.y + flattened });
  }
  ctx.beginPath();
  const shadowWidth = radius * PEBBLE_SHADOW_WIDTH_SHARE;
  const shadowHeight = radius * PEBBLE_SHADOW_HEIGHT_SHARE;
  ctx.ellipse(at.x + HALF, at.y + radius * HALF, shadowWidth, shadowHeight, 0, 0, TWO_PI);
  ctx.fillStyle = withAlpha(ramp.outline, RUBBLE_SHADOW_ALPHA);
  ctx.fill();
  traceRing(ctx, corners);
  ctx.fillStyle = fresh ? ramp.freshDark : ramp.shadow;
  ctx.fill();
  ctx.lineWidth = HALF;
  ctx.strokeStyle = withAlpha(ramp.outline, PEBBLE_OUTLINE_ALPHA);
  ctx.stroke();
  const litCentre = {
    x: at.x - radius * PEBBLE_LIT_OFFSET_X,
    y: at.y - radius * PEBBLE_LIT_OFFSET_Y,
  };
  const litFace = corners.map((corner) => lerpPoint(corner, litCentre, PEBBLE_LIT_SHRINK));
  traceRing(ctx, litFace);
  ctx.fillStyle = fresh ? ramp.freshLit : ramp.light;
  ctx.fill();
}

function paintRubble(
  ctx: Ctx,
  bounds: RubbleBounds,
  stage: RockDamageState,
  share: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const amount = RUBBLE_BY_STAGE[stage];
  if (amount.count === 0) return;
  const pebbleCount = Math.round(amount.count * share);
  const chunkCount = Math.round(amount.chunks * share);
  const apronHeight = bounds.tileScale * APRON_HEIGHT_TILES[stage];
  if (apronHeight > 0) paintApron(ctx, bounds, apronHeight, ramp, rng);
  const pieces: { at: Point; radius: number; fresh: boolean }[] = [];
  for (let index = 0; index < chunkCount; index++) {
    const radius = RUBBLE_CHUNK_RADIUS_MIN + rng() * RUBBLE_CHUNK_RADIUS_RANGE;
    pieces.push({
      at: {
        x: range(rng, bounds.left + radius, bounds.right - radius),
        y: range(rng, bounds.top, bounds.bottom - radius * HALF),
      },
      radius,
      fresh: rng() < HALF,
    });
  }
  for (let index = 0; index < pebbleCount; index++) {
    const radius = amount.radiusMin + rng() * amount.radiusRange;
    pieces.push({
      at: {
        x: range(rng, bounds.left + radius, bounds.right - radius),
        y: range(rng, bounds.top, bounds.bottom - radius * HALF),
      },
      radius,
      fresh: rng() < FRESH_PEBBLE_SHARE,
    });
  }
  // Painted back to front, so a nearer pebble overlaps a further one.
  pieces.sort((a, b) => a.at.y - b.at.y);
  for (const piece of pieces) paintPebble(ctx, piece.at, piece.radius, ramp, piece.fresh, rng);
  for (let speck = 0; speck < DUST_SPECKS; speck++) {
    ctx.fillStyle = withAlpha(ramp.fresh, DUST_ALPHA * rng());
    ctx.fillRect(
      Math.round(range(rng, bounds.left, bounds.right)),
      Math.round(range(rng, bounds.top, bounds.bottom)),
      1,
      1,
    );
  }
}

/** Rubble lies across the rock's foot, inside the one tile the rock blocks. */
function rubbleBounds(frame: RockFrame, baseY: number): RubbleBounds {
  const ts = frame.tileScale;
  return {
    left: frame.originX + RUBBLE_SIDE_MARGIN_PX,
    right: frame.originX + ts - RUBBLE_SIDE_MARGIN_PX,
    top: baseY - ts * RUBBLE_RISE_TILES,
    bottom: frame.originY + ts - RUBBLE_BOTTOM_MARGIN_PX,
    baseY,
    tileScale: ts,
  };
}

/** A hard dark line where stone meets ground, and the soft shadow it casts down-right, under everything. */
function paintGroundShadow(
  ctx: Ctx,
  centreX: number,
  baseY: number,
  halfWidth: number,
  ts: number,
): void {
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.beginPath();
    const contactWidth = halfWidth * CONTACT_LINE_WIDTH_SHARE;
    ctx.ellipse(centreX, baseY - HALF, contactWidth, CONTACT_LINE_HEIGHT_PX, 0, 0, TWO_PI);
    ctx.fillStyle = `rgba(0,0,0,${CONTACT_LINE_ALPHA})`;
    ctx.fill();
    const shadowX = centreX + CAST_SHADOW_OFFSET_PX;
    const shadowHeight = ts * CAST_SHADOW_HEIGHT_TILES;
    const cast = ctx.createRadialGradient(
      shadowX,
      baseY,
      0,
      shadowX,
      baseY,
      halfWidth * CAST_SHADOW_WIDTH_SHARE,
    );
    cast.addColorStop(0, `rgba(0,0,0,${CAST_SHADOW_ALPHA})`);
    cast.addColorStop(CAST_SHADOW_MID_STOP, `rgba(0,0,0,${CAST_SHADOW_ALPHA * HALF})`);
    cast.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(shadowX, baseY);
    ctx.scale(1, shadowHeight / (halfWidth * CAST_SHADOW_WIDTH_SHARE));
    ctx.translate(-shadowX, -baseY);
    ctx.beginPath();
    ctx.arc(shadowX, baseY, halfWidth * CAST_SHADOW_WIDTH_SHARE, 0, TWO_PI);
    ctx.fillStyle = cast;
    ctx.fill();
    ctx.restore();
  } finally {
    ctx.restore();
  }
}

/**
 * Paints one mineable rock at one damage stage into its cell. The same seed
 * paints the same rock at every stage.
 */
export function drawMineableRock(
  ctx: Ctx,
  spec: MineableRockSpec,
  seed: number,
  frame: RockFrame,
  stage: RockDamageState,
): void {
  const ts = frame.tileScale;
  const ramp = RAMPS[spec.lithology];
  const rock = buildRock(spec, seed, frame, ramp);
  const breakage = breakRock(rock, stage, seed, ts);
  const stump = stage === 'remnant' ? shearToStump(breakage.outline, rock, seed, ts) : null;
  const silhouette = stump?.outline ?? breakage.outline;

  ctx.save();
  try {
    withClip(ctx, silhouette, () => {
      paintFacets(ctx, rock, ramp);
      paintVolume(ctx, rock, ramp);
      paintGrain(ctx, rock, spec.lithology, ramp, ts, mulberry32(subSeed(seed, SALT_GRAIN)));
      if (spec.kind === 'outcrop')
        paintVeins(ctx, rock, ramp, ts, mulberry32(subSeed(seed, SALT_VEINS)));
      paintMoss(ctx, rock, ramp, spec.kind, ts, mulberry32(subSeed(seed, SALT_MOSS)));
      paintWeatherCracks(ctx, rock, ramp, ts, mulberry32(subSeed(seed, SALT_WEATHER)));
      for (const notch of breakage.notches) paintNotchFace(ctx, notch, ramp);
      paintDamageCracks(
        ctx,
        rock,
        breakage,
        stage,
        ramp,
        ts,
        mulberry32(subSeed(seed, SALT_DAMAGE_CRACKS)),
      );
      if (stump !== null)
        paintStumpTop(ctx, stump, ramp, ts, mulberry32(subSeed(seed, SALT_REMNANT)));
    });
    paintOutline(ctx, silhouette, ramp);
    const rubbleRng = mulberry32(subSeed(seed, SALT_RUBBLE));
    const rubbleShare = RUBBLE_SHARE_BY_KIND[spec.kind];
    paintRubble(ctx, rubbleBounds(frame, rock.baseY), stage, rubbleShare, ramp, rubbleRng);
    paintGroundShadow(ctx, rock.centreX, rock.baseY, rock.halfWidth, ts);
  } finally {
    ctx.restore();
  }
}

/**
 * Rubble at the foot of a rock painted by another engine — the quarry's dressed
 * wall stubs — so every mineable stone sheds the same debris as it is worked.
 */
export function drawRockRubble(
  ctx: Ctx,
  lithology: Lithology,
  seed: number,
  frame: RockFrame,
  stage: RockDamageState,
): void {
  const baseY = frame.originY + frame.tileScale * (1 - BASE_LIFT_TILES);
  const rubbleRng = mulberry32(subSeed(seed, SALT_RUBBLE));
  paintRubble(ctx, rubbleBounds(frame, baseY), stage, FULL_RUBBLE, RAMPS[lithology], rubbleRng);
}
