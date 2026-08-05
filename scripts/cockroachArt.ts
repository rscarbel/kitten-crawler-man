/**
 * The painter behind the cockroach sprite sheet: a *Periplaneta americana*, the
 * big reddish-brown one that boils out of a drain.
 *
 * What makes a shape read as this species rather than as a generic bug is a
 * short, specific list, and every structure below exists to serve one of them:
 *
 *   - the **pronotum shield** — a broad flat plate over the front of the thorax,
 *     wider than it is long, carrying a dark butterfly-shaped mark inside a pale
 *     yellow margin. It is the single most identifiable thing about the animal
 *     and it is drawn at the size that survives a 32 px tile, not at the size a
 *     photograph would justify;
 *   - a **flat, low, oval body**. The whole creature is a leaf pressed to the
 *     floor. Dome it and it becomes a beetle; segment it and it becomes a grub;
 *   - **tegmina** — leathery forewings — lying flat along the back, overlapping
 *     down the midline and running slightly past the abdomen, with longitudinal
 *     veins visible along them;
 *   - **antennae longer than the body**, thin, tapering, swept forward and out,
 *     and *curved*. Two straight sticks read as a diagram. These are most of
 *     what makes the silhouette an insect at all;
 *   - **six spiny legs socketed under the thorax** — all six roots on the front
 *     40% of the body, never along the abdomen. The mantid and the small spider
 *     both taught the same lesson: socket placement is the cue that sells an
 *     arthropod;
 *   - **two short cerci** at the rear tip, the pair of blunt prongs that says
 *     which end is which when the head is hidden;
 *   - a **small head tucked under and behind the shield**. A roach hides its
 *     head; a head drawn proud of the pronotum reads as an ant.
 *
 * Chitin is painted glossy: a hard directional gradient across each plate, a
 * narrow specular streak, a cool rim on the shadow side and a dark contour.
 *
 * Coordinates are tile units. The origin is the **centre of the body** — this
 * animal is much smaller than its tile, so it is centred in it rather than stood
 * on a ground line — and the canonical frame has the head toward **-Y**, up the
 * screen. A view is that frame rotated, plus how much of the head the camera
 * gets to see; see {@link VIEWS}. The side view is drawn heading +X and the
 * runtime mirrors it.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Small math ───────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/** Lengths below this are treated as degenerate; canvas rejects negative arcs. */
const MIN_EXTENT = 1e-4;

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease used for every limb swing and body transition. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Maps a value from one range onto a clamped 0→1 progress. */
export function ramp(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

/** A single hump: 0 at both ends, 1 in the middle. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
export function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

export function hash2(a: number, b: number): number {
  const MIX_A = 127.1;
  const MIX_B = 311.7;
  return hash1(a * MIX_A + b * MIX_B);
}

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A point `distance` from `from` along `angle`. */
export function along(from: Pt, angle: number, distance: number): Pt {
  return { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance };
}

// ── Colour ───────────────────────────────────────────────────────────────────

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.slice(1);
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

/** Blend two hex colours; t=0 returns `a`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${channel(lerp(ca.r, cb.r, t))}${channel(lerp(ca.g, cb.g, t))}${channel(lerp(ca.b, cb.b, t))}`;
}

/** Decimal places kept on an alpha; see below for why the rounding is needed. */
const ALPHA_PRECISION = 4;

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  // A computed alpha can come out vanishingly small, and `String(5e-17)` is
  // exponent notation node-canvas cannot parse — it drops the whole colour and
  // the shape bakes as an opaque smear. Rounding kills the exponent form.
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${c.r},${c.g},${c.b},${safe})`;
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * The mahogany ramp. Everything on the animal is a mix of these: a roach whose
 * plates disagree about their hue reads as a toy rather than as one shell.
 */
export const CHESTNUT_DARK = '#4a2612';
export const CHESTNUT_BASE = '#9b5728';
export const CHESTNUT_LIGHT = '#d08a48';
/** The pale yellow margin around the pronotum's mark — the species' signature. */
export const PRONOTUM_MARGIN = '#b18d4b';
/** The dark butterfly inside that margin. */
export const PRONOTUM_MARK = '#4a2210';
/** Tegmina run slightly warmer and glossier than the plates under them. */
export const TEGMEN_DARK = '#5a2f16';
export const TEGMEN_BASE = '#a05c2b';
export const TEGMEN_LIGHT = '#dc9852';
/** The abdomen seen past the wings: duller, because it is unsclerotised. */
export const ABDOMEN_DARK = '#3a1d0e';
export const ABDOMEN_BASE = '#6d3a1b';
export const ABDOMEN_LIGHT = '#9a5c2c';
export const LEG_DARK = '#3d1e0d';
export const LEG_BASE = '#804723';
export const LEG_LIGHT = '#bd7c42';
/** Spines and tarsal claws: the one pale accent on an otherwise dark limb. */
export const SPINE_TONE = '#b08a4e';
export const HEAD_BASE = '#5f3216';
export const HEAD_DARK = '#2e1608';
export const HEAD_LIGHT = '#96552a';
export const EYE_DARK = '#160b05';
export const EYE_GLINT = '#c8b189';
/** The two pale ocelli spots either side of the antennal sockets. */
export const OCELLUS = '#e2d3a8';
/**
 * A cool bounce along the shadow edge of every plate. Without it the chestnut
 * ramp is one hue from end to end and the shell reads as moulded plastic.
 */
export const COOL_RIM = '#93a3b2';
export const INK = '#170a04';

/** Key light: high, from the viewer's upper left, shared by every part. */
const LIGHT_DIR: Pt = { x: -0.45, y: -0.89 };

export interface ChitinTone {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
}

export const PLATE_TONE: ChitinTone = {
  base: CHESTNUT_BASE,
  dark: CHESTNUT_DARK,
  light: CHESTNUT_LIGHT,
};
export const TEGMEN_TONE: ChitinTone = {
  base: TEGMEN_BASE,
  dark: TEGMEN_DARK,
  light: TEGMEN_LIGHT,
};
export const ABDOMEN_TONE: ChitinTone = {
  base: ABDOMEN_BASE,
  dark: ABDOMEN_DARK,
  light: ABDOMEN_LIGHT,
};
export const LEG_TONE: ChitinTone = { base: LEG_BASE, dark: LEG_DARK, light: LEG_LIGHT };
export const HEAD_TONE: ChitinTone = { base: HEAD_BASE, dark: HEAD_DARK, light: HEAD_LIGHT };
export const MARGIN_TONE: ChitinTone = {
  base: PRONOTUM_MARGIN,
  dark: mix(PRONOTUM_MARGIN, CHESTNUT_DARK, 0.55),
  light: mix(PRONOTUM_MARGIN, '#ffffff', 0.35),
};

// ── Proportions, in tile units ───────────────────────────────────────────────

/** Pronotum front to the tip of the abdomen. The antennae run well past it. */
export const BODY_LENGTH = 0.62;
/**
 * Across the tegmina at their widest.
 *
 * The length:width ratio is the measurement that decides beetle or roach: a
 * *P. americana* runs 2.4-2.7 long for 1 wide, and at 1.8 — where this started —
 * a blind reviewer named it a beetle from the outline alone.
 */
export const BODY_WIDTH = 0.255;
const BODY_FRONT_Y = -BODY_LENGTH / 2;
const BODY_REAR_Y = BODY_LENGTH / 2;

/**
 * The shield. Wider than it is long by more than two to one — that ratio *is*
 * the read at 32 px, where the plate is eight screen pixels across and its mark
 * is five.
 */
export const PRONOTUM_WIDTH = 0.275;
export const PRONOTUM_LENGTH = 0.135;
const PRONOTUM_CENTRE_Y = BODY_FRONT_Y + PRONOTUM_LENGTH / 2;
/** The front edge is narrower than the rear, which is where the plate is widest. */
const PRONOTUM_FRONT_WIDTH_SHARE = 0.62;
const PRONOTUM_REAR_BOW = 0.04;

/** Head length front to back; it sits mostly under the shield. */
const HEAD_LENGTH = 0.125;
const HEAD_WIDTH = 0.155;
/** How far the head's centre sits ahead of the pronotum's front edge, fully out. */
const HEAD_MAX_EXPOSURE = 0.062;
const EYE_RX = 0.029;
const EYE_RY = 0.036;
const EYE_OUT = 0.062;
const EYE_ALONG = -0.03;
const OCELLUS_R = 0.011;
const PALP_LENGTH = 0.055;
const PALP_HALF = 0.009;
const PALP_SPLAY = deg(28);

/** One forewing: root under the rear of the shield, tip past the abdomen. */
const TEGMEN_ROOT_Y = PRONOTUM_CENTRE_Y + PRONOTUM_LENGTH * 0.32;
const TEGMEN_TIP_Y = BODY_REAR_Y + 0.055;
/** Overlap across the midline, which is why the two wings read as a seam. */
const TEGMEN_INNER_X = 0.014;
/** How much further across the midline each wing reaches by its own tip. */
const TEGMEN_OVERLAP_GAIN = 1.1;
const TEGMEN_OUTER_X = BODY_WIDTH / 2;
/** Where along the wing it is widest, and its width at the root and the tip. */
const TEGMEN_WIDEST_AT = 0.3;
const TEGMEN_ROOT_SHARE = 0.82;
const TEGMEN_TIP_SHARE = 0.2;
const TEGMEN_VEINS = 4;
const TEGMEN_VEIN_ALPHA = 0.44;
/** How far in from the outer edge the innermost vein sits. */
const TEGMEN_VEIN_INNERMOST = 0.42;
const TEGMEN_VEIN_ROOT_SHARE = 0.88;
const TEGMEN_VEIN_TIP_SHARE = 0.36;
/** Sideways bow on a vein; the inner ones carry the most, which fans the set. */
const TEGMEN_VEIN_BOW = 0.3;
const TEGMEN_VEIN_WIDTH = 0.0055;

const ABDOMEN_CENTRE_Y = BODY_REAR_Y - 0.145;
const ABDOMEN_RX = 0.135;
const ABDOMEN_RY = 0.16;
const ABDOMEN_SEGMENTS = 5;
const ABDOMEN_SEGMENT_ALPHA = 0.3;

const CERCUS_ROOT_Y = BODY_REAR_Y + 0.005;
const CERCUS_ROOT_X = 0.035;
const CERCUS_LENGTH = 0.1;
const CERCUS_HALF_ROOT = 0.019;
const CERCUS_HALF_TIP = 0.004;
/** Splay from the body's own axis, before the pose's own spread is added. */
const CERCUS_SPLAY = deg(26);

/**
 * Antenna length, in tile units. Longer than the body on purpose: a roach's
 * antennae are its whole forward silhouette, and the gate that measures the
 * baked span exists because a frame-size change can crop them silently.
 */
export const ANTENNA_LENGTH = 0.82;
/** Rest sweep away from straight ahead. */
const ANTENNA_SPLAY = deg(34);
/** How far the filament curves outward over its own length. */
const ANTENNA_CURVE = deg(46);
const ANTENNA_SAMPLES = 18;
const ANTENNA_HALF_ROOT = 0.028;
const ANTENNA_HALF_TIP = 0.007;
/**
 * The smallest span, in tiles, the antennae must carry the silhouette to on
 * every skitter frame. Declared here rather than in the gate so the number the
 * art promises and the number the gate enforces cannot drift apart.
 */
export const ANTENNA_MIN_SPAN_TILES = 0.98;

// ── Legs ─────────────────────────────────────────────────────────────────────

export const LEG_COUNT = 6;

interface LegBuild {
  /** Socket on the thorax, for the right-hand leg of the pair. */
  readonly socket: Pt;
  readonly femur: number;
  readonly tibia: number;
  readonly tarsus: number;
  /** Rest bearing of the femur, right-hand side; 0 is straight out to +X. */
  readonly restAngle: number;
  /** How far the knee folds the tibia toward the front of the animal. */
  readonly fold: number;
  readonly spines: number;
}

/**
 * All three sockets sit on the thorax — the front 40% of the body — and the
 * legs lengthen toward the rear, which is why a running roach's hind legs
 * overtake its own abdomen.
 */
const LEG_BUILDS: readonly LegBuild[] = [
  {
    socket: { x: 0.05, y: BODY_FRONT_Y + 0.075 },
    femur: 0.17,
    tibia: 0.15,
    tarsus: 0.06,
    restAngle: deg(-62),
    fold: deg(34),
    spines: 4,
  },
  {
    socket: { x: 0.072, y: BODY_FRONT_Y + 0.15 },
    femur: 0.2,
    tibia: 0.19,
    tarsus: 0.07,
    restAngle: deg(4),
    fold: deg(52),
    spines: 5,
  },
  {
    socket: { x: 0.078, y: BODY_FRONT_Y + 0.225 },
    femur: 0.24,
    tibia: 0.235,
    tarsus: 0.08,
    restAngle: deg(48),
    fold: deg(62),
    spines: 6,
  },
];

const FEMUR_HALF_ROOT = 0.034;
const FEMUR_HALF_TIP = 0.022;
const TIBIA_HALF_ROOT = 0.023;
const TIBIA_HALF_TIP = 0.014;
const TARSUS_HALF_ROOT = 0.013;
const TARSUS_HALF_TIP = 0.006;
const COXA_R = 0.034;
const TIBIA_SPINE_LENGTH = 0.034;
const TARSUS_KINK = deg(22);
/** A lifted leg is nearer the camera, so its projection shortens. */
const LIFT_FORESHORTEN = 0.16;
/** …and catches more light, which is the only other cue a top-down view has. */
const LIFT_BRIGHTEN = 0.5;
/** Legs on the far side of the body lie in its shade. */
const FAR_SIDE_SHADE = 0.35;

/** Right-hand legs are even indices, left-hand odd; pair index is `i >> 1`. */
export function legSideOf(index: number): number {
  return index % 2 === 0 ? 1 : -1;
}

export function legPairOf(index: number): number {
  return index >> 1;
}

/**
 * Which alternating tripod a leg belongs to: 0 or 1.
 *
 * A cockroach runs on legs 1-3-5 and 2-4-6 in strict alternation, and that
 * pattern — front and hind of one side with the middle of the other — is what
 * separates a skittering insect from a centipede's ripple.
 */
export function tripodOf(index: number): number {
  return (legPairOf(index) + (index % 2)) % 2;
}

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface LegPose {
  /** Femur swing about its socket; positive swings the leg toward the rear. */
  readonly swing: number;
  /** Extension of the whole limb: 1 is the rest length. */
  readonly reach: number;
  /** 0 planted on the floor, 1 at the top of the recovery stroke. */
  readonly lift: number;
}

export interface AntennaPose {
  /** Extra sweep away from the midline, added to the rest splay. */
  readonly spread: number;
  /** Extra curl along the filament; positive curls further outward. */
  readonly curl: number;
  /** Fraction of the full length currently extended. */
  readonly extend: number;
}

export interface CockroachPose {
  /** Six legs, right-hand ones on the even indices. */
  readonly legs: readonly LegPose[];
  readonly leftAntenna: AntennaPose;
  readonly rightAntenna: AntennaPose;
  /** Body yaw about its own centre; positive swings the head toward +X. */
  readonly yaw: number;
  /** Shove along the body axis, in tile units; positive is forward. */
  readonly surge: number;
  /** Shove across the body axis, in tile units. */
  readonly sway: number;
  /**
   * The front of the animal lifting off the floor, 0 flat to 1 fully reared.
   * Seen from above this is a scale-up of everything ahead of the thorax, which
   * is what "nearer the camera" looks like in a dorsal projection.
   */
  readonly rear: number;
  /** Head pitched down and forward into the bite. */
  readonly gape: number;
  /** Abdomen tip swinging aside; positive toward +X. */
  readonly abdomenSwing: number;
  /** Extra spread on the cerci, in radians. */
  readonly cerciSpread: number;
}

export function restLeg(): LegPose {
  return { swing: 0, reach: 1, lift: 0 };
}

export function restAntenna(): AntennaPose {
  return { spread: 0, curl: 0, extend: 1 };
}

export function restPose(): CockroachPose {
  return {
    legs: Array.from({ length: LEG_COUNT }, () => restLeg()),
    leftAntenna: restAntenna(),
    rightAntenna: restAntenna(),
    yaw: 0,
    surge: 0,
    sway: 0,
    rear: 0,
    gape: 0,
    abdomenSwing: 0,
    cerciSpread: 0,
  };
}

// ── Outlines ─────────────────────────────────────────────────────────────────

const OUTLINE_STEPS = 44;
const OUTLINE_WOBBLE_MAJOR_LOBES = 3;
const OUTLINE_WOBBLE_MINOR_LOBES = 7;

/** A closed, very slightly irregular oval. Chitin wobbles far less than fur. */
export function ovalOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  seed: number,
  wobble = 0.015,
  steps = OUTLINE_STEPS,
): Pt[] {
  const pts: Pt[] = [];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * TWO_PI;
    const factor =
      1 +
      wobble *
        (Math.sin(angle * OUTLINE_WOBBLE_MAJOR_LOBES + seed) * 0.6 +
          Math.sin(angle * OUTLINE_WOBBLE_MINOR_LOBES - seed * 1.7) * 0.4);
    const lx = Math.cos(angle) * rx * factor;
    const ly = Math.sin(angle) * ry * factor;
    pts.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  }
  return pts;
}

/** Lays a smooth closed curve through the sample points. */
export function traceOutline(ctx: Ctx, pts: readonly Pt[]): void {
  if (pts.length < 3) return;
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const here = pts[i];
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(here.x, here.y, (here.x + next.x) / 2, (here.y + next.y) / 2);
  }
  ctx.closePath();
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOf(pts: readonly Pt[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function centroidOf(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Scales an outline about its own centroid; used for insets and streaks. */
export function shrinkOutline(pts: readonly Pt[], factor: number): Pt[] {
  const c = centroidOf(pts);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
}

/**
 * A tapered capsule between two points — one limb segment, one antenna span.
 *
 * `bow` bends it sideways at its middle. Every arthropod segment has some curve
 * to it, and a limb built of dead-straight capsules reads as a diagram of a limb
 * rather than as one.
 */
export function segmentOutline(
  from: Pt,
  to: Pt,
  halfFrom: number,
  halfTo: number,
  bow = 0,
  steps = 12,
): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(MIN_EXTENT, Math.hypot(dx, dy));
  const ax = dx / len;
  const ay = dy / len;
  const nx = -ay;
  const ny = ax;
  const side = (t: number, sign: number): Pt => {
    const half = lerp(halfFrom, halfTo, t);
    const arch = Math.sin(t * Math.PI) * bow;
    return {
      x: from.x + ax * len * t + nx * (half * sign + arch),
      y: from.y + ay * len * t + ny * (half * sign + arch),
    };
  };
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) pts.push(side(i / steps, 1));
  for (let i = steps; i >= 0; i--) pts.push(side(i / steps, -1));
  return pts;
}

/**
 * A tapered ribbon threaded through a whole polyline, for the antennae.
 *
 * Built as one outline rather than as a chain of capsules so the filament has no
 * bulges at its joints: at the widths an antenna is drawn at, a single stacked
 * end-cap is a visible bead.
 */
export function filamentOutline(spine: readonly Pt[], halfRoot: number, halfTip: number): Pt[] {
  if (spine.length < 2) return [];
  const normals: Pt[] = spine.map((_unused, i) => {
    const before = spine[Math.max(0, i - 1)];
    const after = spine[Math.min(spine.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const len = Math.max(MIN_EXTENT, Math.hypot(dx, dy));
    return { x: -dy / len, y: dx / len };
  });
  const halfAt = (i: number): number => lerp(halfRoot, halfTip, i / (spine.length - 1));
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < spine.length; i++) {
    const half = halfAt(i);
    left.push({ x: spine[i].x + normals[i].x * half, y: spine[i].y + normals[i].y * half });
    right.push({ x: spine[i].x - normals[i].x * half, y: spine[i].y - normals[i].y * half });
  }
  return [...left, ...right.reverse()];
}

// ── Chitin engine ────────────────────────────────────────────────────────────

const SPECULAR_INSET = 0.6;
const SPECULAR_ALPHA = 0.32;
const SPECULAR_LIGHT_OFFSET = 0.13;
/** A plate lying in the body's shade barely glints. */
const SPECULAR_SHADE_LOSS = 0.7;
const RIM_INSET = 0.9;
const RIM_ALPHA = 0.3;
const RIM_WIDTH = 0.007;
const RIM_LIGHT_OFFSET = 0.05;
const CONTOUR_WIDTH = 0.0095;
const DEFAULT_CONTOUR = 0.92;
/**
 * The halo: a warm light stroke laid down *before* each plate's fill, so the
 * fill covers its inner half and only an outer band survives.
 *
 * This is the whole reason the animal is visible on a dungeon floor. Measured
 * without it, the outline ran at luminance 51 against a floor of 46 — a Weber
 * contrast of 10%, with a third of the outline pixels *darker* than the ground
 * — so a brightly painted roach sat in a rim value-matched to the stone and the
 * silhouette disappeared. A dark contour cannot fix that: the floor is already
 * dark. The edge has to go light.
 */
const HALO_TONE = '#d59457';
const HALO_ALPHA = 0.55;
const HALO_WIDTH = 0.024;
const SHADE_TO_DARK = 0.72;
/** Where along the light axis the plate's own base tone sits before it falls off. */
const GRADIENT_BASE_STOP = 0.54;
const GRADIENT_DARK_MIX = 0.82;
const GRADIENT_LIGHT_MIX = 0.5;

export interface ChitinPart {
  readonly outline: readonly Pt[];
  readonly tone: ChitinTone;
  /** Extra darkening for far-side limbs and parts lying in the body's shade. */
  readonly shade?: number;
  /** Extra brightening for parts lifted toward the camera. */
  readonly lit?: number;
  readonly contour?: number;
  /** 0 skips the specular streak entirely — right for a matte membrane. */
  readonly gloss?: number;
  /** Strength of the outer halo; 0 for a part that never touches the floor. */
  readonly halo?: number;
}

/**
 * Paints one chitin plate: light halo, base fill, directional gradient,
 * specular streak, cool shadow-side rim, dark contour.
 *
 * The order matters. The halo goes down first so the fill eats its inner half;
 * the specular sits *inside* the clip so it never breaks the silhouette; and the
 * contour is drawn last and outside it so a plate laid over another still
 * separates from it.
 */
export function paintChitin(ctx: Ctx, part: ChitinPart): void {
  const {
    outline,
    tone,
    shade = 0,
    lit = 0,
    contour = DEFAULT_CONTOUR,
    gloss = 1,
    halo = 1,
  } = part;
  if (outline.length < 3) return;
  const bounds = boundsOf(outline);
  const width = Math.max(MIN_EXTENT, bounds.maxX - bounds.minX);
  const height = Math.max(MIN_EXTENT, bounds.maxY - bounds.minY);
  const span = Math.max(width, height);

  const shaded = mix(
    mix(tone.base, tone.dark, clamp01(shade) * SHADE_TO_DARK),
    tone.light,
    clamp01(lit) * LIFT_BRIGHTEN,
  );

  if (halo > 0) {
    traceOutline(ctx, outline);
    ctx.strokeStyle = rgba(HALO_TONE, HALO_ALPHA * halo);
    ctx.lineWidth = HALO_WIDTH;
    ctx.stroke();
  }

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const gradient = ctx.createLinearGradient(
    cx + LIGHT_DIR.x * span,
    cy + LIGHT_DIR.y * span,
    cx - LIGHT_DIR.x * span,
    cy - LIGHT_DIR.y * span,
  );
  gradient.addColorStop(0, mix(shaded, tone.light, GRADIENT_LIGHT_MIX));
  gradient.addColorStop(GRADIENT_BASE_STOP, shaded);
  gradient.addColorStop(1, mix(shaded, tone.dark, GRADIENT_DARK_MIX));
  ctx.fillStyle = gradient;
  ctx.fillRect(bounds.minX, bounds.minY, width, height);

  if (gloss > 0) {
    const streak = shrinkOutline(outline, SPECULAR_INSET);
    ctx.save();
    ctx.translate(
      LIGHT_DIR.x * span * SPECULAR_LIGHT_OFFSET,
      LIGHT_DIR.y * span * SPECULAR_LIGHT_OFFSET,
    );
    traceOutline(ctx, streak);
    ctx.fillStyle = rgba(
      tone.light,
      SPECULAR_ALPHA * gloss * (1 - clamp01(shade) * SPECULAR_SHADE_LOSS),
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(-LIGHT_DIR.x * span * RIM_LIGHT_OFFSET, -LIGHT_DIR.y * span * RIM_LIGHT_OFFSET);
  traceOutline(ctx, shrinkOutline(outline, RIM_INSET));
  ctx.strokeStyle = rgba(COOL_RIM, RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  if (contour > 0) {
    traceOutline(ctx, outline);
    ctx.strokeStyle = rgba(INK, contour);
    ctx.lineWidth = CONTOUR_WIDTH;
    ctx.stroke();
  }
}

const SHADOW_ALPHA = 0.34;

/** The soft blot on the floor under a flat animal pressed against it. */
export function drawGroundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= MIN_EXTENT || ry <= MIN_EXTENT) return;
  const blot = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  blot.addColorStop(0, rgba(INK, SHADOW_ALPHA));
  blot.addColorStop(1, rgba(INK, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / Math.max(MIN_EXTENT, rx));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = blot;
  ctx.beginPath();
  ctx.arc(cx, cy, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Spines ───────────────────────────────────────────────────────────────────

const SPINE_ALPHA = 0.88;
const SPINE_INK_ALPHA = 0.45;
const SPINE_INK_WIDTH = 0.0035;
const SPINE_START_INSET = 0.14;
const SPINE_END_INSET = 0.93;
const SPINE_RAKE_SHARE = 0.45;
const SPINE_HALF_BASE_SHARE = 0.3;
/** Alternating long and short spines; an even comb reads as a saw blade. */
const SPINE_SHORT_RANK = 0.62;

/**
 * The rank of spines along a tibia.
 *
 * At 32 px these are the difference between "the bug has legs" and "the bug has
 * *bristles*", which is the whole reason a roach reads as unpleasant rather than
 * as a beetle. They are drawn proportionally larger than life for that reason.
 */
export function drawSpineRow(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  count: number,
  length: number,
  outwardSign: number,
  seed: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(MIN_EXTENT, Math.hypot(dx, dy));
  const ax = dx / len;
  const ay = dy / len;
  const nx = -ay * outwardSign;
  const ny = ax * outwardSign;
  for (let i = 0; i < count; i++) {
    const t = lerp(SPINE_START_INSET, SPINE_END_INSET, count === 1 ? 0.5 : i / (count - 1));
    const rank = i % 2 === 0 ? 1 : SPINE_SHORT_RANK;
    const jitter = 0.85 + hash2(seed, i) * 0.3;
    const spineLen = length * rank * jitter;
    const baseX = from.x + ax * len * t;
    const baseY = from.y + ay * len * t;
    // Spines rake backward toward the joint, the way a barb on a hook does.
    const tipX = baseX + nx * spineLen - ax * spineLen * SPINE_RAKE_SHARE;
    const tipY = baseY + ny * spineLen - ay * spineLen * SPINE_RAKE_SHARE;
    const halfBase = spineLen * SPINE_HALF_BASE_SHARE;
    ctx.beginPath();
    ctx.moveTo(baseX - ax * halfBase, baseY - ay * halfBase);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + ax * halfBase, baseY + ay * halfBase);
    ctx.closePath();
    ctx.fillStyle = rgba(SPINE_TONE, SPINE_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(INK, SPINE_INK_ALPHA);
    ctx.lineWidth = SPINE_INK_WIDTH;
    ctx.stroke();
  }
}

// ── Parts ────────────────────────────────────────────────────────────────────

export interface LegJoints {
  readonly socket: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  readonly foot: Pt;
}

/**
 * Where one leg's joints land, in the canonical body frame.
 *
 * Exported because the gore module builds its severed legs from the same
 * geometry: a torn-off leg that does not match the ones on the living animal is
 * the kind of mismatch only a reviewer looking at both at once ever catches.
 */
export function legJoints(index: number, pose: LegPose): LegJoints {
  const build = LEG_BUILDS[legPairOf(index)];
  const side = legSideOf(index);
  const shorten = 1 - clamp01(pose.lift) * LIFT_FORESHORTEN;
  const femurLength = build.femur * pose.reach * shorten;
  const tibiaLength = build.tibia * pose.reach * shorten;
  const tarsusLength = build.tarsus * pose.reach * shorten;
  const femurAngle = build.restAngle + pose.swing;
  const tibiaAngle = femurAngle - build.fold;
  const tarsusAngle = tibiaAngle - TARSUS_KINK;

  // The chain is solved once on the right-hand side and *reflected in X* for the
  // left. Negating the angles instead reflects across the other axis, which
  // silently puts all six legs on the same side of the animal — it bakes as a
  // roach dragging itself sideways and reads as a shrimp.
  const socket: Pt = { x: build.socket.x, y: build.socket.y };
  const knee = along(socket, femurAngle, femurLength);
  const ankle = along(knee, tibiaAngle, tibiaLength);
  const foot = along(ankle, tarsusAngle, tarsusLength);
  const reflect = (p: Pt): Pt => ({ x: p.x * side, y: p.y });
  return {
    socket: reflect(socket),
    knee: reflect(knee),
    ankle: reflect(ankle),
    foot: reflect(foot),
  };
}

const LEG_SEGMENT_BOW = 0.008;

function drawLeg(ctx: Ctx, index: number, pose: LegPose, shade: number): void {
  const build = LEG_BUILDS[legPairOf(index)];
  const side = legSideOf(index);
  const joints = legJoints(index, pose);
  const lit = clamp01(pose.lift);
  const paint = (outline: readonly Pt[]): void => {
    paintChitin(ctx, { outline, tone: LEG_TONE, shade, lit, gloss: 0.6 });
  };

  paint(
    segmentOutline(
      joints.socket,
      joints.knee,
      FEMUR_HALF_ROOT,
      FEMUR_HALF_TIP,
      LEG_SEGMENT_BOW * side,
    ),
  );
  paint(
    segmentOutline(
      joints.knee,
      joints.ankle,
      TIBIA_HALF_ROOT,
      TIBIA_HALF_TIP,
      -LEG_SEGMENT_BOW * side,
    ),
  );
  paint(segmentOutline(joints.ankle, joints.foot, TARSUS_HALF_ROOT, TARSUS_HALF_TIP, 0));
  drawSpineRow(
    ctx,
    joints.knee,
    joints.ankle,
    build.spines,
    TIBIA_SPINE_LENGTH,
    side,
    legPairOf(index) + index,
  );
  // The coxa: a knuckle where the leg meets the body, which is what stops the
  // limb reading as a wire pushed into a hole. It sits under the thorax and
  // never meets the floor, so it carries no halo.
  paintChitin(ctx, {
    outline: ovalOutline(joints.socket.x, joints.socket.y, COXA_R, COXA_R * 0.8, 0, index),
    tone: LEG_TONE,
    shade,
    gloss: 0.5,
    halo: 0,
  });
}

function antennaSpine(root: Pt, side: number, pose: AntennaPose): Pt[] {
  const baseAngle = -Math.PI / 2 + (ANTENNA_SPLAY + pose.spread) * side;
  const step = (ANTENNA_LENGTH * pose.extend) / ANTENNA_SAMPLES;
  const spine: Pt[] = [root];
  let here = root;
  for (let i = 1; i <= ANTENNA_SAMPLES; i++) {
    const t = i / ANTENNA_SAMPLES;
    // The curve tightens toward the tip: a roach's antenna trails, so its far
    // half carries most of the bend and a constant-curvature arc reads as wire.
    const angle = baseAngle + (ANTENNA_CURVE * t * t + pose.curl * t) * side;
    here = along(here, angle, step);
    spine.push(here);
  }
  return spine;
}

const ANTENNA_ANNULATIONS = 9;
const ANTENNA_ANNULATION_ALPHA = 0.4;

/** Exported so the severed head piece carries the same two filaments. */
export function drawAntenna(ctx: Ctx, root: Pt, side: number, pose: AntennaPose): void {
  const spine = antennaSpine(root, side, pose);
  const outline = filamentOutline(spine, ANTENNA_HALF_ROOT, ANTENNA_HALF_TIP);
  paintChitin(ctx, {
    outline,
    tone: { base: mix(CHESTNUT_BASE, CHESTNUT_DARK, 0.3), dark: INK, light: CHESTNUT_LIGHT },
    gloss: 0.45,
    contour: 0.55,
  });

  // Annulations. Invisible in game and worth every stroke at gore scale, where
  // the severed head's antennae are the piece's whole identity.
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.strokeStyle = rgba(INK, ANTENNA_ANNULATION_ALPHA);
  ctx.lineWidth = ANTENNA_HALF_TIP;
  for (let i = 1; i <= ANTENNA_ANNULATIONS; i++) {
    const at = Math.min(
      spine.length - 2,
      Math.floor((i / (ANTENNA_ANNULATIONS + 1)) * spine.length),
    );
    const a = spine[at];
    const b = spine[at + 1];
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.max(MIN_EXTENT, Math.hypot(nx, ny));
    const half = ANTENNA_HALF_ROOT;
    ctx.beginPath();
    ctx.moveTo(a.x + (nx / len) * half, a.y + (ny / len) * half);
    ctx.lineTo(a.x - (nx / len) * half, a.y - (ny / len) * half);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The head, drawn at `exposure` of its full protrusion past the shield.
 *
 * A roach carries its head *under* the pronotum, tipped down so the mouthparts
 * point at the floor. From above, most of what shows is the pale rear margin of
 * the vertex and the two eyes at the corners; from in front, the whole face.
 */
export function drawHead(ctx: Ctx, pose: CockroachPose, exposure: number): Pt {
  const out = clamp01(exposure);
  const centre: Pt = {
    x: 0,
    y: BODY_FRONT_Y + HEAD_LENGTH * 0.1 - HEAD_MAX_EXPOSURE * out - pose.gape * HEAD_MAX_EXPOSURE,
  };
  const outline = ovalOutline(centre.x, centre.y, HEAD_WIDTH / 2, HEAD_LENGTH / 2, 0, 4.1);
  paintChitin(ctx, { outline, tone: HEAD_TONE, gloss: 0.7 });

  for (const side of [-1, 1]) {
    paintChitin(ctx, {
      outline: ovalOutline(
        centre.x + EYE_OUT * side,
        centre.y + EYE_ALONG,
        EYE_RX,
        EYE_RY,
        deg(12) * side,
        7.3,
        0.01,
      ),
      tone: { base: EYE_DARK, dark: '#000000', light: EYE_GLINT },
      gloss: 1,
      contour: 0.7,
      halo: 0,
    });
    ctx.fillStyle = rgba(OCELLUS, 0.85);
    ctx.beginPath();
    ctx.arc(centre.x + EYE_OUT * 0.45 * side, centre.y - HEAD_LENGTH * 0.24, OCELLUS_R, 0, TWO_PI);
    ctx.fill();
  }

  // Maxillary palps, hanging off the face toward the floor — which, seen from
  // above, means toward the front of the animal. Two of them, short and
  // clubbed, and they are the reason the front view has a *mouth* rather than a
  // blank plate. They swing apart as the roach opens up to bite.
  const PALP_GAPE_SPLAY = deg(20);
  const PALP_GAPE_REACH = 0.45;
  for (const side of [-1, 1]) {
    const root: Pt = { x: centre.x + HEAD_WIDTH * 0.24 * side, y: centre.y + HEAD_LENGTH * 0.1 };
    // Forward of the face, not behind it: the head is tipped down and forward,
    // so from above the mouthparts project past the front margin.
    const angle = -Math.PI / 2 + (PALP_SPLAY + PALP_GAPE_SPLAY * pose.gape) * side;
    const tip = along(root, angle, PALP_LENGTH * (1 + pose.gape * PALP_GAPE_REACH));
    paintChitin(ctx, {
      outline: segmentOutline(root, tip, PALP_HALF, PALP_HALF * 0.7, 0.004 * side),
      tone: HEAD_TONE,
      shade: 0.3,
      gloss: 0.4,
      contour: 0.6,
      halo: 0,
    });
  }
  return { x: centre.x, y: centre.y - HEAD_LENGTH * 0.3 };
}

/** Steps along the shield's front and rear margins, and along each side. */
const PRONOTUM_EDGE_STEPS = 26;
const PRONOTUM_SIDE_STEPS = 10;
/** How far the front margin bows forward over the head it covers. */
const PRONOTUM_FRONT_BOW = 0.042;

/**
 * The shield's outline: a front edge bowed forward over the head, sides flaring
 * to the widest point at the rear corners, and a rear margin bowed backward over
 * the wing roots. Exported because the severed shield is the same shape.
 */
function pronotumOutline(): Pt[] {
  const halfRear = PRONOTUM_WIDTH / 2;
  const halfFront = halfRear * PRONOTUM_FRONT_WIDTH_SHARE;
  const front = BODY_FRONT_Y;
  const rear = BODY_FRONT_Y + PRONOTUM_LENGTH;
  const pts: Pt[] = [];
  for (let i = 0; i <= PRONOTUM_EDGE_STEPS; i++) {
    const t = i / PRONOTUM_EDGE_STEPS;
    pts.push({ x: lerp(-halfFront, halfFront, t), y: front - hump(t) * PRONOTUM_FRONT_BOW });
  }
  for (let i = 1; i <= PRONOTUM_SIDE_STEPS; i++) {
    const t = i / PRONOTUM_SIDE_STEPS;
    pts.push({ x: lerp(halfFront, halfRear, easeInOut(t)), y: lerp(front, rear, t) });
  }
  for (let i = 1; i <= PRONOTUM_EDGE_STEPS; i++) {
    const t = i / PRONOTUM_EDGE_STEPS;
    pts.push({ x: lerp(halfRear, -halfRear, t), y: rear + hump(t) * PRONOTUM_REAR_BOW });
  }
  for (let i = 1; i < PRONOTUM_SIDE_STEPS; i++) {
    const t = i / PRONOTUM_SIDE_STEPS;
    pts.push({ x: lerp(-halfRear, -halfFront, easeInOut(t)), y: lerp(rear, front, t) });
  }
  return pts;
}

const MARK_INSET = 0.84;
const MARK_LOBE_RX = 0.062;
const MARK_LOBE_RY = 0.036;
const MARK_LOBE_OUT = 0.046;
const MARK_LOBE_TILT = deg(22);
const MARK_WAIST_RX = 0.022;
const MARK_WAIST_RY = 0.034;
/** The pale wedge between the two lobes: narrow at the rear, open at the front. */
const MARK_WEDGE_HALF_REAR = 0.006;
const MARK_WEDGE_HALF_FRONT = 0.026;
/** How far back down the mark the wedge cuts, as a share of a lobe's half-depth. */
const MARK_WEDGE_REACH = 0.15;
const MARK_SPLIT_ALPHA = 0.55;
const MARK_SPLIT_WIDTH = 0.008;

/**
 * The pronotum: the pale plate, then the dark butterfly inside it.
 *
 * The mark is built from two tilted lobes with a narrow waist between them
 * rather than as one blob, because the waist is what makes it a *butterfly* and
 * the butterfly is what makes the animal an American cockroach rather than any
 * other brown insect. A pale hairline splits the two lobes down the midline.
 */
function drawPronotum(ctx: Ctx, shade: number): void {
  const outline = pronotumOutline();
  paintChitin(ctx, { outline, tone: MARGIN_TONE, shade, gloss: 0.85 });

  const inner = shrinkOutline(outline, MARK_INSET);
  ctx.save();
  traceOutline(ctx, inner);
  ctx.clip();
  const centreY = PRONOTUM_CENTRE_Y + PRONOTUM_LENGTH * 0.06;
  ctx.fillStyle = PRONOTUM_MARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      MARK_LOBE_OUT * side,
      centreY,
      MARK_LOBE_RX,
      MARK_LOBE_RY,
      MARK_LOBE_TILT * side,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  // The bar that joins the two lobes across the rear of the plate. It is a bar
  // and not an ellipse because the pale wedge below has to be able to cut up
  // into the mark from the front without meeting a curved wall.
  ctx.beginPath();
  ctx.ellipse(0, centreY + MARK_WAIST_RY * 0.5, MARK_WAIST_RX, MARK_WAIST_RY, 0, 0, TWO_PI);
  ctx.fill();

  // The pale median wedge: narrow at the rear, opening forward. This is what
  // makes the mark two *lobes* rather than one trapezoidal bowl, and a blind
  // reviewer named the bowl a beetle's thorax.
  ctx.fillStyle = PRONOTUM_MARGIN;
  ctx.beginPath();
  ctx.moveTo(-MARK_WEDGE_HALF_REAR, centreY + MARK_LOBE_RY * MARK_WEDGE_REACH);
  ctx.lineTo(MARK_WEDGE_HALF_REAR, centreY + MARK_LOBE_RY * MARK_WEDGE_REACH);
  ctx.lineTo(MARK_WEDGE_HALF_FRONT, BODY_FRONT_Y - PRONOTUM_LENGTH);
  ctx.lineTo(-MARK_WEDGE_HALF_FRONT, BODY_FRONT_Y - PRONOTUM_LENGTH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(INK, MARK_SPLIT_ALPHA);
  ctx.lineWidth = MARK_SPLIT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, centreY - MARK_LOBE_RY * 1.4);
  ctx.lineTo(0, centreY + MARK_LOBE_RY * 1.4);
  ctx.stroke();
  ctx.restore();

  // A second, tighter specular over the mark: the shield is the glossiest thing
  // on the animal and a dark mark with no highlight flattens the whole plate.
  ctx.save();
  traceOutline(ctx, shrinkOutline(outline, SPECULAR_INSET * 0.8));
  ctx.fillStyle = rgba(CHESTNUT_LIGHT, 0.16);
  ctx.fill();
  ctx.restore();
}

function tegmenOutline(side: number, seed: number): Pt[] {
  const STEPS = 18;
  const outerEdge: Pt[] = [];
  const innerEdge: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const y = lerp(TEGMEN_ROOT_Y, TEGMEN_TIP_Y, t);
    // Widest early, then falling continuously to a point. A profile that holds
    // its maximum over the middle of the wing measured as a parallel-sided
    // capsule — 41% of the body's length at full width — and a capsule with a
    // domed end is a beetle's elytra however the rest of the animal is drawn.
    const share =
      t <= TEGMEN_WIDEST_AT
        ? lerp(TEGMEN_ROOT_SHARE, 1, easeInOut(t / TEGMEN_WIDEST_AT))
        : lerp(1, TEGMEN_TIP_SHARE, easeInOut((t - TEGMEN_WIDEST_AT) / (1 - TEGMEN_WIDEST_AT)));
    outerEdge.push({ x: TEGMEN_OUTER_X * share * side, y });
    // The inner edge crosses the midline further as it runs back, so the right
    // wing finishes lying over the left instead of meeting it point to point.
    innerEdge.push({ x: -TEGMEN_INNER_X * side * (1 + t * TEGMEN_OVERLAP_GAIN), y });
  }
  const wobble = (p: Pt, i: number): Pt => ({
    x: p.x * (1 + Math.sin(i * 0.9 + seed) * 0.012),
    y: p.y,
  });
  return [...outerEdge.map(wobble), ...innerEdge.reverse()];
}

/** Longitudinal veins, the texture that says "leathery" rather than "shell". */
function drawTegmenVeins(ctx: Ctx, outline: readonly Pt[], side: number): void {
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.strokeStyle = rgba(TEGMEN_DARK, TEGMEN_VEIN_ALPHA);
  ctx.lineWidth = TEGMEN_VEIN_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < TEGMEN_VEINS; i++) {
    // Veins live in the *outer* half of the wing and fan outward as they run
    // back. Evenly spaced parallel lines down the whole panel are elytral
    // striae, which is a beetle's texture and not a roach's.
    const across = lerp(TEGMEN_VEIN_INNERMOST, 1, (i + 0.5) / TEGMEN_VEINS);
    const rootX = TEGMEN_OUTER_X * across * TEGMEN_VEIN_ROOT_SHARE * side;
    const tipX = TEGMEN_OUTER_X * across * TEGMEN_VEIN_TIP_SHARE * side;
    const bow = TEGMEN_OUTER_X * TEGMEN_VEIN_BOW * (1 - across) * side;
    ctx.beginPath();
    ctx.moveTo(rootX, TEGMEN_ROOT_Y + 0.02);
    ctx.quadraticCurveTo(
      lerp(rootX, tipX, 0.5) + bow,
      lerp(TEGMEN_ROOT_Y, TEGMEN_TIP_Y, 0.5),
      tipX,
      TEGMEN_TIP_Y - 0.05,
    );
    ctx.stroke();
  }
  // The specular streak runs the length of the wing rather than round its
  // outline: a long flat leathery panel glints in a line, not in a patch.
  ctx.strokeStyle = rgba(TEGMEN_LIGHT, 0.26);
  ctx.lineWidth = TEGMEN_VEIN_WIDTH * 3.4;
  ctx.beginPath();
  ctx.moveTo(TEGMEN_OUTER_X * 0.42 * side, TEGMEN_ROOT_Y + 0.04);
  ctx.quadraticCurveTo(
    TEGMEN_OUTER_X * 0.62 * side,
    lerp(TEGMEN_ROOT_Y, TEGMEN_TIP_Y, 0.55),
    TEGMEN_OUTER_X * 0.3 * side,
    TEGMEN_TIP_Y - 0.06,
  );
  ctx.stroke();
  ctx.restore();
}

function drawAbdomen(ctx: Ctx, pose: CockroachPose): void {
  const swing = pose.abdomenSwing;
  const outline = ovalOutline(
    swing * ABDOMEN_RY * 0.5,
    ABDOMEN_CENTRE_Y,
    ABDOMEN_RX,
    ABDOMEN_RY,
    swing * 0.5,
    2.7,
  );
  paintChitin(ctx, { outline, tone: ABDOMEN_TONE, gloss: 0.5 });
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.strokeStyle = rgba(ABDOMEN_DARK, ABDOMEN_SEGMENT_ALPHA);
  ctx.lineWidth = TEGMEN_VEIN_WIDTH;
  for (let i = 1; i <= ABDOMEN_SEGMENTS; i++) {
    const y = lerp(
      ABDOMEN_CENTRE_Y - ABDOMEN_RY,
      ABDOMEN_CENTRE_Y + ABDOMEN_RY,
      i / (ABDOMEN_SEGMENTS + 1),
    );
    ctx.beginPath();
    ctx.moveTo(-ABDOMEN_RX, y);
    ctx.quadraticCurveTo(0, y + ABDOMEN_RY * 0.08, ABDOMEN_RX, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The two blunt prongs at the tail. Exported: the rear-tip gore piece reuses it. */
export function drawCerci(ctx: Ctx, spread: number, swing: number): void {
  for (const side of [-1, 1]) {
    const root: Pt = { x: CERCUS_ROOT_X * side + swing * 0.02, y: CERCUS_ROOT_Y };
    const angle = Math.PI / 2 + (CERCUS_SPLAY + spread) * side + swing * 0.4;
    const tip = along(root, angle, CERCUS_LENGTH);
    paintChitin(ctx, {
      outline: segmentOutline(root, tip, CERCUS_HALF_ROOT, CERCUS_HALF_TIP, 0.004 * side),
      tone: ABDOMEN_TONE,
      shade: 0.2,
      gloss: 0.5,
    });
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

export type CockroachView = 'front' | 'side' | 'back';

export interface ViewSpec {
  /** Rotation applied to the canonical head-up frame, in radians. */
  readonly rotation: number;
  /**
   * How much of the head shows past the shield. The camera sees the face of an
   * animal walking toward it and almost none of one walking away.
   */
  readonly headExposure: number;
}

export const VIEWS: Record<CockroachView, ViewSpec> = {
  // The spread between these is how much longer the head-on view is than the
  // away view. Measured at 0.92 against 0.12 the back view baked 9% shorter
  // than the front and read as a stubbier animal; the three views are supposed
  // to be one creature turned round.
  front: { rotation: Math.PI, headExposure: 0.5 },
  side: { rotation: Math.PI / 2, headExposure: 0.3 },
  back: { rotation: 0, headExposure: 0.15 },
};

const REAR_LIFT_SCALE = 0.28;
const SHADOW_RX = BODY_WIDTH * 0.62;
const SHADOW_RY = BODY_LENGTH * 0.5;
const SHADOW_DROP = 0.03;
/** How far the shadow shrinks and slips back as the front of the body rises. */
const SHADOW_REAR_SHRINK = 0.22;

/**
 * The whole animal in its canonical frame: head toward -Y, legs splayed either
 * side, drawn back to front.
 *
 * Draw order is the whole trick on a flat animal. Legs and antennae go down
 * first because they emerge from *under* the plates; the abdomen, then the
 * tegmina over it, then the shield over their roots, is the actual stacking of a
 * roach's back and is what makes the midline seam read.
 */
function drawCanonical(ctx: Ctx, pose: CockroachPose, view: ViewSpec): void {
  const rear = clamp01(pose.rear);

  drawGroundShadow(
    ctx,
    pose.sway * 0.5,
    SHADOW_DROP + rear * SHADOW_REAR_SHRINK * BODY_LENGTH * 0.5,
    SHADOW_RX * (1 - rear * SHADOW_REAR_SHRINK),
    SHADOW_RY * (1 - rear * SHADOW_REAR_SHRINK),
  );

  ctx.save();
  ctx.translate(pose.sway, -pose.surge);
  ctx.rotate(pose.yaw);

  for (let index = 0; index < LEG_COUNT; index++) {
    // Shade keys off the light's own direction: the legs on the far side of the
    // body from the key light sit in its shade whichever way the animal points.
    const shade = legSideOf(index) === Math.sign(LIGHT_DIR.x) ? 0 : FAR_SIDE_SHADE;
    drawLeg(ctx, index, pose.legs[index], shade);
  }

  // Everything ahead of the thorax scales up as the animal rears: in a dorsal
  // projection, "nearer the camera" is the only way up reads at all.
  ctx.save();
  ctx.translate(0, BODY_FRONT_Y);
  ctx.scale(1 + rear * REAR_LIFT_SCALE, 1 + rear * REAR_LIFT_SCALE);
  ctx.translate(0, -BODY_FRONT_Y);

  const antennaRoot = drawHead(ctx, pose, view.headExposure);
  // The antennae are inside the rear's scale-up, so their roots ride with the
  // head — but a filament tipped toward the camera foreshortens rather than
  // growing, and letting it grow costs every cell on the sheet the pixels the
  // longest reared frame needs.
  const rearForeshorten = 1 / (1 + rear * REAR_LIFT_SCALE);
  const projected = (antenna: AntennaPose): AntennaPose => ({
    ...antenna,
    extend: antenna.extend * rearForeshorten,
  });
  drawAntenna(ctx, antennaRoot, -1, projected(pose.leftAntenna));
  drawAntenna(ctx, antennaRoot, 1, projected(pose.rightAntenna));
  // The head again, over its own antennae: the sockets are on the face, so a
  // filament crossing the head is a filament stuck to the outside of it.
  drawHead(ctx, pose, view.headExposure);
  ctx.restore();

  drawAbdomen(ctx, pose);

  for (const side of [-1, 1]) {
    // The right wing overlaps the left down the midline, always the same way —
    // a seam that swaps sides between frames is the flicker nobody can name.
    const outline = tegmenOutline(side, side > 0 ? 1.7 : 5.2);
    paintChitin(ctx, {
      outline,
      tone: TEGMEN_TONE,
      shade: side === Math.sign(LIGHT_DIR.x) ? 0 : 0.22,
      gloss: 0.9,
    });
    drawTegmenVeins(ctx, outline, side);
  }

  // After the wings, not before them. Drawn first the cerci vanish under the
  // tegmen tips and the animal ends in a bare dome — which is a beetle's
  // elytra, and was exactly what a blind reviewer called it.
  drawCerci(ctx, pose.cerciSpread, pose.abdomenSwing);

  ctx.save();
  ctx.translate(0, BODY_FRONT_Y);
  ctx.scale(1 + rear * REAR_LIFT_SCALE, 1 + rear * REAR_LIFT_SCALE);
  ctx.translate(0, -BODY_FRONT_Y);
  drawPronotum(ctx, 0);
  ctx.restore();

  ctx.restore();
}

/**
 * A view is a **pure rotation** of the canonical frame, plus how much head shows.
 *
 * There was a vertical squash here for the camera's tilt. It measured as the
 * animal changing shape when it turned — 12% longer and 11% narrower edge-on
 * than head-on, off the same rig — and a flat creature lying on the floor of a
 * near-overhead camera has no business doing that. A rotation is the honest
 * transform for a leaf pressed to the ground.
 */
function drawView(ctx: Ctx, pose: CockroachPose, view: ViewSpec): void {
  ctx.save();
  ctx.rotate(view.rotation);
  drawCanonical(ctx, pose, view);
  ctx.restore();
}

/** Walking toward the camera: the face and both palps are visible. */
export function drawCockroachFront(ctx: Ctx, pose: CockroachPose): void {
  drawView(ctx, pose, VIEWS.front);
}

/** Profile-ish dorsal, always drawn heading +X; the runtime mirrors it. */
export function drawCockroachSide(ctx: Ctx, pose: CockroachPose): void {
  drawView(ctx, pose, VIEWS.side);
}

/** Walking away: the shield hides the head and the cerci are nearest. */
export function drawCockroachBack(ctx: Ctx, pose: CockroachPose): void {
  drawView(ctx, pose, VIEWS.back);
}

export function drawCockroach(ctx: Ctx, pose: CockroachPose, view: CockroachView): void {
  if (view === 'front') drawCockroachFront(ctx, pose);
  else if (view === 'back') drawCockroachBack(ctx, pose);
  else drawCockroachSide(ctx, pose);
}

// ── Geometry the gore module needs ──────────────────────────────────────────

export { LEG_BUILDS, pronotumOutline, type LegBuild };
