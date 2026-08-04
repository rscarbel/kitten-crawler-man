/**
 * The painter library behind the Mantid sprite sheets.
 *
 * Two creatures are baked from this one module — the bounty boss (`mantid`) and
 * the crony mantises that escort him (`mantis`) — because they are the same
 * species. Only the `MantidBuild` differs: palette, wing-case wear, scarring and
 * limb heft. Scale is applied by the generator, not here.
 *
 * What makes a shape read as a *praying mantis* rather than as a generic bug is
 * a short, specific list, and every structure below exists to serve one of them:
 *
 *   - a **triangular head** far wider than it is deep, with a huge bulging
 *     compound eye at each upper corner and a dark pseudopupil that tracks;
 *   - a **long pronotum** — the "neck" — carried at an angle, which is what
 *     gives a mantis its upright, watchful posture. Shorten it and the animal
 *     collapses into a grasshopper;
 *   - **raptorial forelimbs socketed at the front of that pronotum, right
 *     behind the head** — never on the abdomen and never level with the walking
 *     legs. The small spider taught us that socket placement is the single cue
 *     that sells an arthropod, and this is the mantis's;
 *   - those forelimbs folded in the **prayer**: femur up and forward, tibia
 *     folded back against it, both edges lined with grasping **spines**;
 *   - exactly **four** walking legs, slender, with the knee breaking well above
 *     the body — the forelimbs are not walking legs and must never plant;
 *   - **wing cases lying flat along the abdomen**, a long leaf with a straight
 *     leading edge and a visible longitudinal vein.
 *
 * Chitin is painted rather than furred: a hard directional gradient, a narrow
 * specular streak, a cool rim on the shadow side and a dark contour. The boss
 * additionally carries an iridescent sheen — a second, hue-shifted gradient at
 * low alpha — which is what makes him read as a different, older animal at a
 * glance rather than merely a bigger one.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen. The profile view faces +X; the runtime mirrors it.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Small math ───────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/** Radii below this are treated as degenerate; canvas rejects negative arcs. */
const MIN_RADIUS = 1e-4;

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

/** Decimal places kept on an alpha; see `rgba` for why the rounding is needed. */
const ALPHA_PRECISION = 4;

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  // A computed alpha can come out vanishingly small, and `String(5e-17)` is
  // exponent notation that node-canvas cannot parse — it drops the whole colour
  // and the shape bakes as an opaque smear. Rounding kills the exponent form.
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${c.r},${c.g},${c.b},${safe})`;
}

// ── Build (what separates the boss from a crony) ─────────────────────────────

export interface ChitinPalette {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
  /** Cool bounce on the shadow edge; what stops chitin reading as plastic. */
  readonly rim: string;
  readonly ink: string;
  /** Hue the iridescent second gradient shifts toward. */
  readonly sheen: string;
  readonly eye: string;
  readonly eyeDark: string;
  /** Translucent hind-wing membrane, seen only when the wings flare. */
  readonly membrane: string;
  readonly spine: string;
}

export interface MantidBuild {
  readonly palette: ChitinPalette;
  /** 0 pristine wing cases, 1 shredded into notches and splits. */
  readonly wingWear: number;
  /** 0 unmarked, 1 the boss's battle-scored raptorial femurs. */
  readonly scarring: number;
  /** Extra thickness on the raptorial arms and pronotum. The boss is not just bigger. */
  readonly heft: number;
  /** Strength of the iridescent second gradient. */
  readonly iridescence: number;
  readonly seed: number;
}

/**
 * The crony: a leaf-green mantis of ordinary colouring. Bright enough to read
 * against the floor-3 grass without glowing, and the reference the boss is a
 * deliberate departure from.
 */
export const MANTIS_CRONY_BUILD: MantidBuild = {
  palette: {
    base: '#6f9c3a',
    dark: '#2f4a17',
    light: '#a8cf62',
    rim: '#d3ec93',
    ink: '#15200a',
    sheen: '#79d6c2',
    eye: '#d8e58a',
    eyeDark: '#20300f',
    membrane: '#cfe0a8',
    spine: '#e3dfb4',
  },
  wingWear: 0.12,
  scarring: 0,
  heft: 0,
  iridescence: 0.1,
  seed: 3.7,
};

/**
 * The boss. Deliberately *not* green: a bounty target has to be identifiable as
 * the named thing from across a field, and the reliable way to do that with the
 * same anatomy is to change the whole value range. Dark teal chitin, an
 * iridescent violet sheen, amber eyes and wing cases that have plainly been
 * through something.
 */
export const MANTID_BOSS_BUILD: MantidBuild = {
  palette: {
    base: '#2f6b56',
    dark: '#0d2019',
    light: '#63ac84',
    rim: '#8fe3bd',
    ink: '#040e0a',
    sheen: '#8f4fd0',
    eye: '#f2a83c',
    eyeDark: '#2a1405',
    membrane: '#7a5f86',
    spine: '#efe6c6',
  },
  wingWear: 0.85,
  scarring: 1,
  heft: 1,
  // Held well below the crony's contrast budget: past about half, the violet
  // band stops reading as a sheen on green chitin and starts reading as grey.
  iridescence: 0.45,
  seed: 11.3,
};

// ── Outlines ─────────────────────────────────────────────────────────────────

const OUTLINE_STEPS = 40;
const OUTLINE_WOBBLE_MAJOR_LOBES = 3;
const OUTLINE_WOBBLE_MINOR_LOBES = 7;

/** A closed, slightly irregular oval. Chitin wobbles far less than fur does. */
export function ovalOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  seed: number,
  wobble = 0.02,
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

interface Bounds {
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

/** Scales an outline about its own centroid; used for insets and specular streaks. */
export function shrinkOutline(pts: readonly Pt[], factor: number): Pt[] {
  const c = centroidOf(pts);
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
}

/**
 * A tapered capsule between two points — one limb segment.
 *
 * `bow` bends the segment sideways at its middle. Every arthropod limb segment
 * has some curve to it, and a limb built of dead-straight capsules reads as a
 * diagram of a limb rather than as one.
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
  const len = Math.max(MIN_RADIUS, Math.hypot(dx, dy));
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
 * Solves the knee of a two-bone limb.
 *
 * The walking legs have to keep their feet on the ground line while the body
 * bobs, and forward kinematics cannot do that — the foot slides. `bendSign`
 * picks which side the joint breaks toward; a mantis's knees break *up and
 * outward*, well above the line from hip to foot, and that high knee is a large
 * part of what reads as "insect" in the silhouette.
 */
export function solveTwoBone(
  root: Pt,
  foot: Pt,
  upper: number,
  lower: number,
  bendSign: number,
): Pt {
  const dx = foot.x - root.x;
  const dy = foot.y - root.y;
  const span = Math.max(MIN_RADIUS, Math.hypot(dx, dy));
  const reach = Math.min(span, (upper + lower) * 0.999);
  const along = (reach * reach + upper * upper - lower * lower) / (2 * reach);
  const across = Math.sqrt(Math.max(0, upper * upper - along * along));
  const ax = dx / span;
  const ay = dy / span;
  return {
    x: root.x + ax * along - ay * across * bendSign,
    y: root.y + ay * along + ax * across * bendSign,
  };
}

// ── Chitin engine ────────────────────────────────────────────────────────────

/** Fraction of a part's own size the specular streak is inset by. */
const SPECULAR_INSET = 0.62;
const SPECULAR_ALPHA = 0.3;
/** Inset of the cool rim, as a fraction of the part. */
const RIM_INSET = 0.9;
const RIM_ALPHA = 0.34;
const RIM_WIDTH = 0.008;
const CONTOUR_WIDTH = 0.011;
const DEFAULT_CONTOUR = 0.9;
const SHADE_TO_DARK = 0.7;
/** Where along the light axis the plate's own base tone sits, before it falls off. */
const GRADIENT_BASE_STOP = 0.55;
/** How far the specular streak is pushed toward the light, as a fraction of the part. */
const SPECULAR_LIGHT_OFFSET = 0.12;
/** How much a shaded part loses of its specular. A far-side plate barely glints. */
const SPECULAR_SHADE_LOSS = 0.7;
/** How far the cool rim is pushed away from the light, as a fraction of the part. */
const RIM_LIGHT_OFFSET = 0.05;
const GRADIENT_DARK_MIX = 0.85;
const GRADIENT_LIGHT_MIX = 0.55;
const IRIDESCENCE_ALPHA = 0.42;
/** Key light: high and from the viewer's upper left, shared by every part. */
const LIGHT_DIR: Pt = { x: -0.5, y: -0.87 };

export interface ChitinPart {
  readonly outline: readonly Pt[];
  readonly build: MantidBuild;
  /** Extra darkening for far-side limbs and parts lying in the body's shade. */
  readonly shade?: number;
  readonly contour?: number;
  /** 0 skips the specular streak entirely — right for matte membranes. */
  readonly gloss?: number;
}

/**
 * Paints one chitin plate: base fill, directional gradient, iridescent overlay,
 * specular streak, cool shadow-side rim, dark contour.
 *
 * The order matters. The specular sits *inside* the clip so it never breaks the
 * silhouette, and the contour is drawn last and outside it so a plate laid over
 * another still separates from it.
 */
export function paintChitin(ctx: Ctx, part: ChitinPart): void {
  const { outline, build, shade = 0, contour = DEFAULT_CONTOUR, gloss = 1 } = part;
  if (outline.length < 3) return;
  const { palette } = build;
  const bounds = boundsOf(outline);
  const width = Math.max(MIN_RADIUS, bounds.maxX - bounds.minX);
  const height = Math.max(MIN_RADIUS, bounds.maxY - bounds.minY);
  const span = Math.max(width, height);

  const shaded = mix(palette.base, palette.dark, clamp01(shade) * SHADE_TO_DARK);

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
  gradient.addColorStop(0, mix(shaded, palette.light, GRADIENT_LIGHT_MIX));
  gradient.addColorStop(GRADIENT_BASE_STOP, shaded);
  gradient.addColorStop(1, mix(shaded, palette.dark, GRADIENT_DARK_MIX));
  ctx.fillStyle = gradient;
  ctx.fillRect(bounds.minX, bounds.minY, width, height);

  if (build.iridescence > 0) {
    // Perpendicular to the key light so the hue shift lands on the *turn* of the
    // plate rather than on its lit face — that off-axis band is what an
    // iridescent shell actually does.
    const sheen = ctx.createLinearGradient(
      cx - LIGHT_DIR.y * span,
      cy + LIGHT_DIR.x * span,
      cx + LIGHT_DIR.y * span,
      cy - LIGHT_DIR.x * span,
    );
    sheen.addColorStop(0, rgba(palette.sheen, 0));
    sheen.addColorStop(0.5, rgba(palette.sheen, build.iridescence * IRIDESCENCE_ALPHA));
    sheen.addColorStop(1, rgba(palette.sheen, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(bounds.minX, bounds.minY, width, height);
  }

  if (gloss > 0) {
    const streak = shrinkOutline(outline, SPECULAR_INSET);
    ctx.save();
    ctx.translate(
      LIGHT_DIR.x * span * SPECULAR_LIGHT_OFFSET,
      LIGHT_DIR.y * span * SPECULAR_LIGHT_OFFSET,
    );
    traceOutline(ctx, streak);
    ctx.fillStyle = rgba(
      palette.light,
      SPECULAR_ALPHA * gloss * (1 - clamp01(shade) * SPECULAR_SHADE_LOSS),
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(-LIGHT_DIR.x * span * RIM_LIGHT_OFFSET, -LIGHT_DIR.y * span * RIM_LIGHT_OFFSET);
  traceOutline(ctx, shrinkOutline(outline, RIM_INSET));
  ctx.strokeStyle = rgba(palette.rim, RIM_ALPHA);
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  if (contour > 0) {
    traceOutline(ctx, outline);
    ctx.strokeStyle = rgba(palette.ink, contour);
    ctx.lineWidth = CONTOUR_WIDTH;
    ctx.stroke();
  }
}

/** A soft elliptical shadow on the floor under the animal. */
export function drawGroundShadow(
  ctx: Ctx,
  build: MantidBuild,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  if (rx <= MIN_RADIUS || ry <= MIN_RADIUS) return;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(build.palette.ink, 0.32);
  ctx.fill();
}

// ── Spines ───────────────────────────────────────────────────────────────────

const SPINE_ALPHA = 0.95;
const SPINE_INK_ALPHA = 0.5;

/**
 * The row of grasping spines down one edge of a raptorial segment.
 *
 * These are not decoration. The spines are the difference between "the bug has
 * long front arms" and "the bug has *traps* on the front" — at 32 px they are
 * the only thing that says the forelimbs are weapons, so they are drawn
 * proportionally larger than life and always on the *inner* edge, the edge that
 * closes on prey.
 */
export function drawSpineRow(
  ctx: Ctx,
  build: MantidBuild,
  from: Pt,
  to: Pt,
  count: number,
  length: number,
  innerSign: number,
  seed: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(MIN_RADIUS, Math.hypot(dx, dy));
  const ax = dx / len;
  const ay = dy / len;
  const nx = -ay * innerSign;
  const ny = ax * innerSign;
  const START_INSET = 0.12;
  const END_INSET = 0.94;
  for (let i = 0; i < count; i++) {
    const t = lerp(START_INSET, END_INSET, count === 1 ? 0.5 : i / (count - 1));
    // Alternating long and short spines: a real raptorial femur carries two
    // interleaved ranks, and an even comb reads as a saw blade instead.
    const rank = i % 2 === 0 ? 1 : 0.6;
    const jitter = 0.85 + hash2(seed, i) * 0.3;
    const spineLen = length * rank * jitter;
    const baseX = from.x + ax * len * t;
    const baseY = from.y + ay * len * t;
    // Spines rake backward toward the joint, the way a barb on a hook does.
    const rakeX = ax * -spineLen * 0.35;
    const rakeY = ay * -spineLen * 0.35;
    const tipX = baseX + nx * spineLen + rakeX;
    const tipY = baseY + ny * spineLen + rakeY;
    const halfBase = spineLen * 0.28;
    ctx.beginPath();
    ctx.moveTo(baseX - ax * halfBase, baseY - ay * halfBase);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + ax * halfBase, baseY + ay * halfBase);
    ctx.closePath();
    ctx.fillStyle = rgba(build.palette.spine, SPINE_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(build.palette.ink, SPINE_INK_ALPHA);
    ctx.lineWidth = 0.004;
    ctx.stroke();
  }
}

/** Battle scoring across a plate: pale hairline gouges, boss only. */
function drawScars(
  ctx: Ctx,
  build: MantidBuild,
  outline: readonly Pt[],
  count: number,
  seed: number,
): void {
  if (build.scarring <= 0) return;
  const bounds = boundsOf(outline);
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = lerp(bounds.minX, bounds.maxX, hash2(seed, i));
    const y = lerp(bounds.minY, bounds.maxY, hash2(seed + 4.1, i));
    const angle = hash2(seed + 8.3, i) * TWO_PI;
    const len = lerp(0.02, 0.06, hash2(seed + 2.9, i));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.strokeStyle = rgba(build.palette.rim, 0.4 * build.scarring);
    ctx.lineWidth = 0.005;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 0.006);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len + 0.006);
    ctx.strokeStyle = rgba(build.palette.ink, 0.35 * build.scarring);
    ctx.lineWidth = 0.004;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** One raptorial forelimb. Angles are radians; lengths are tile units. */
export interface RaptorialPose {
  /** Rotation of the whole arm about its socket. 0 is the rest prayer. */
  readonly swing: number;
  /** 0 folded into the prayer, 1 snapped out nearly straight. */
  readonly unfold: number;
  /** Front and back views only: how far the arm is held off the midline. */
  readonly spread: number;
  /** Extra reach along the arm's aim, in tile units. */
  readonly reach: number;
}

/** One walking leg's foot, relative to where that foot rests. */
export interface LegPose {
  readonly dx: number;
  readonly dy: number;
  /** 0 planted, 1 at the top of its swing. */
  readonly lift: number;
  /** How far the knee breaks out from the body. 1 is the standing default. */
  readonly splay: number;
}

export interface MantidPose {
  readonly bob: number;
  readonly sway: number;
  readonly lean: number;
  readonly squash: number;
  readonly breathe: number;
  /** 0 normal stance, 1 reared up over the hind legs. */
  readonly rear: number;
  /** Amplitude of the held-pose shiver, in tile units. */
  readonly tremble: number;

  /** Angle of the pronotum off its rest carriage. Positive lifts the head. */
  readonly pronotumPitch: number;
  /** Front/back views: the neck leaning across the screen. */
  readonly pronotumYaw: number;

  readonly headPitch: number;
  /** -1 looking to its right, +1 to its left. */
  readonly headTurn: number;
  readonly headTilt: number;
  /** Where the pseudopupil sits, -1 to 1. A mantis tracks with its whole head *and* this. */
  readonly gaze: number;
  /** Phase of the antennal sweep. */
  readonly antenna: number;

  readonly abdomenLift: number;
  readonly abdomenSway: number;
  /** Positive curls the abdomen tip up over the back, the threat carriage. */
  readonly abdomenCurl: number;
  /** 0 wing cases flat on the abdomen, 1 raised in a deimatic display. */
  readonly wingFlare: number;

  readonly foreL: RaptorialPose;
  readonly foreR: RaptorialPose;
  readonly midL: LegPose;
  readonly midR: LegPose;
  readonly hindL: LegPose;
  readonly hindR: LegPose;

  /** Forward drive of a strike, in tile units. Moves the whole animal. */
  readonly lunge: number;
  readonly shadow: number;
  /** Phase used to animate quivers within a held pose. */
  readonly time: number;
}

const REST_LEG: LegPose = { dx: 0, dy: 0, lift: 0, splay: 1 };
const REST_ARM: RaptorialPose = { swing: 0, unfold: 0, spread: 0, reach: 0 };

export function restPose(): MantidPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    squash: 1,
    breathe: 0,
    rear: 0,
    tremble: 0,
    pronotumPitch: 0,
    pronotumYaw: 0,
    headPitch: 0,
    headTurn: 0,
    headTilt: 0,
    gaze: 0,
    antenna: 0,
    abdomenLift: 0,
    abdomenSway: 0,
    abdomenCurl: 0,
    wingFlare: 0,
    foreL: REST_ARM,
    foreR: REST_ARM,
    midL: REST_LEG,
    midR: REST_LEG,
    hindL: REST_LEG,
    hindR: REST_LEG,
    lunge: 0,
    shadow: 1,
    time: 0,
  };
}

// ── Anatomy (tile units, origin = centre of the tile) ────────────────────────

/** Where the feet meet the floor, in tile units. */
export const GROUND_Y = 0.46;

/**
 * The leg-bearing thorax, in profile. Small on purpose: on a mantis this is the
 * *short* part of the body, sandwiched between a long pronotum in front and a
 * long abdomen behind, and inflating it is the fastest way to turn the animal
 * into a wasp.
 */
const THORAX_CX = -0.02;
const THORAX_CY = 0.02;
export const THORAX_RX = 0.1;
const THORAX_RY = 0.075;

/** Abdomen: long, tapering to a point, carried above the ground line. */
const ABDOMEN_ROOT_X = -0.08;
const ABDOMEN_ROOT_Y = 0.02;
export const ABDOMEN_LENGTH = 0.42;
const ABDOMEN_ROOT_HALF = 0.085;
const ABDOMEN_MID_HALF = 0.095;
const ABDOMEN_TIP_HALF = 0.016;
const ABDOMEN_SEGMENTS = 7;
/** Rest carriage of the abdomen off horizontal; it slopes up toward the tip. */
const ABDOMEN_REST_ANGLE = deg(-22);

/**
 * The pronotum — the elongated prothorax a mantis carries its head on. This is
 * the animal's whole posture: it roots inside the thorax and rises forward at a
 * steep angle, and the raptorial arms socket at its *far* end.
 */
const PRONOTUM_ROOT_X = 0.05;
const PRONOTUM_ROOT_Y = -0.01;
export const PRONOTUM_LENGTH = 0.34;
const PRONOTUM_REST_ANGLE = deg(-58);
const PRONOTUM_ROOT_HALF = 0.05;
const PRONOTUM_TIP_HALF = 0.03;
/** Extra thickness the boss's `heft` adds to the pronotum. */
const PRONOTUM_HEFT_GAIN = 0.22;
/** Battle gouges scored across a boss's pronotum. */
const PRONOTUM_SCARS = 5;
/** Where along the pronotum the raptorial sockets sit; 1 is the head end. */
export const FORELIMB_SOCKET_ALONG = 0.82;

export const HEAD_WIDTH = 0.19;
export const HEAD_DEPTH = 0.12;
/** Profile length of the head, front to back. Shorter than it is wide. */
const HEAD_SIDE_LENGTH = 0.135;
const EYE_RX = 0.055;
const EYE_RY = 0.064;
const ANTENNA_LENGTH = 0.3;

/** Raptorial arm segment lengths. The femur is the long, heavy, spined one. */
const COXA_LENGTH = 0.11;
export const FEMUR_LENGTH = 0.21;
export const TIBIA_LENGTH = 0.18;
const COXA_HALF = 0.024;
const FEMUR_HALF = 0.046;
const TIBIA_HALF = 0.024;
/** Battle gouges scored across a boss's raptorial femur. */
const RAPTORIAL_FEMUR_SCARS = 6;
export const FEMUR_SPINES = 7;
export const TIBIA_SPINES = 9;
const SPINE_LENGTH = 0.026;

/**
 * Where a raptorial arm sits at rest and where it ends up on a strike.
 *
 * The profile and the head-on views need genuinely different numbers, not one
 * set mirrored: seen from the side the prayer is a narrow V held out in *front*
 * of the chest, and seen head-on it is two Vs held out to the *sides* of it. A
 * single rig produced arms that lay flat across the animal's own face.
 */
export interface ArmRig {
  /** Direction the coxa leaves its socket, relative to the view's base angle. */
  readonly coxaOffset: number;
  /** Femur angle off the coxa, folded and fully unfolded. */
  readonly femurFold: number;
  readonly femurStrike: number;
  /** Tibia angle off the femur. Folded, it doubles back along it — the prayer. */
  readonly tibiaFold: number;
  readonly tibiaStrike: number;
  /**
   * How far one unit of `spread` swings the arm off the body. Signed, because
   * "wider" is a larger screen angle in one view and a smaller one in the other.
   */
  readonly spreadAngle: number;
}

/** Measured off the pronotum's own angle: the profile prayer is held forward. */
const SIDE_ARM_RIG: ArmRig = {
  coxaOffset: deg(78),
  femurFold: deg(35),
  femurStrike: deg(-24),
  tibiaFold: deg(-136),
  tibiaStrike: deg(-8),
  spreadAngle: deg(-14),
};

/** Measured off straight down: head-on, the prayer is held out to the sides. */
const AXIAL_ARM_RIG: ArmRig = {
  coxaOffset: deg(-35),
  femurFold: deg(60),
  femurStrike: deg(-30),
  tibiaFold: deg(-140),
  tibiaStrike: deg(-14),
  spreadAngle: deg(-30),
};

/** Walking-leg roots along the thorax, and their segment lengths. */
const MID_LEG_ROOT: Pt = { x: 0.02, y: 0.03 };
const HIND_LEG_ROOT: Pt = { x: -0.09, y: 0.04 };
const LEG_FEMUR = 0.3;
const LEG_TIBIA = 0.32;
const LEG_HALF_ROOT = 0.019;
const LEG_HALF_KNEE = 0.014;
const LEG_HALF_FOOT = 0.008;
const TARSUS_LENGTH = 0.055;
/** Where each walking foot rests, measured from the tile centre along +X. */
const MID_FOOT_REST_X = 0.2;
const HIND_FOOT_REST_X = -0.24;
/** How far above the hip the knee is pushed. Mantis knees ride high. */
const KNEE_BEND_SIGN = -1;

// ── Shared part painters ─────────────────────────────────────────────────────

interface Placed {
  readonly origin: Pt;
  readonly angle: number;
}

/** Advances a point along an angle. */
function along(p: Pt, angle: number, distance: number): Pt {
  return { x: p.x + Math.cos(angle) * distance, y: p.y + Math.sin(angle) * distance };
}

/**
 * The pronotum plus its dorsal keel. Returned so the caller can socket the arms
 * and the head onto it without recomputing the geometry.
 */
function drawPronotum(ctx: Ctx, build: MantidBuild, p: MantidPose): Placed {
  const root: Pt = { x: PRONOTUM_ROOT_X, y: PRONOTUM_ROOT_Y };
  const angle = PRONOTUM_REST_ANGLE - p.pronotumPitch;
  const tip = along(root, angle, PRONOTUM_LENGTH);
  paintPronotumPlate(ctx, build, root, tip, PRONOTUM_SIDE_BOW);
  return { origin: tip, angle };
}

/** Sideways bow on the profile pronotum; the head-on column has none to show. */
const PRONOTUM_SIDE_BOW = 0.014;
/** The pale ridge running the length of the pronotum. */
const PRONOTUM_KEEL_ALPHA = 0.4;
const PRONOTUM_KEEL_WIDTH = 0.009;

/**
 * The pronotum plate, its scars and its keel.
 *
 * Shared by all three views rather than reimplemented for the head-on ones,
 * which is how those quietly lost the keel — the ridge that stops the segment
 * reading as a smooth tube, and takes the neck's whole length cue with it.
 */
function paintPronotumPlate(ctx: Ctx, build: MantidBuild, root: Pt, tip: Pt, bow: number): void {
  const half = pronotumHalfWidths(build);
  const outline = segmentOutline(root, tip, half.root, half.tip, bow);
  paintChitin(ctx, { outline, build });
  drawScars(ctx, build, outline, PRONOTUM_SCARS, build.seed + 1.1);

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = rgba(build.palette.light, PRONOTUM_KEEL_ALPHA);
  ctx.lineWidth = PRONOTUM_KEEL_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/** Abdomen with its segment banding and, at the tip, the cerci. */
function drawAbdomen(
  ctx: Ctx,
  build: MantidBuild,
  p: MantidPose,
  baseAngle: number,
  rootX: number,
  foreshorten: number,
): void {
  const root: Pt = { x: rootX, y: ABDOMEN_ROOT_Y + p.abdomenLift };
  const length = ABDOMEN_LENGTH * foreshorten;
  /**
   * The curl accumulates *along* the abdomen: none at the root, all of it by the
   * tip. Applied in full at the root and unwound toward the tip instead — which
   * is what this did — the whole abdomen swings as one rigid piece off a hinge,
   * which is exactly the tail read the shape exists to avoid.
   */
  const spineAngleAt = (t: number): number => baseAngle + p.abdomenCurl * t;
  const pts: Pt[] = [];
  const STEPS = 16;
  const swell = 1 + p.breathe * 0.05;
  const buildHalf = (t: number): number => {
    if (t < 0.4) return lerp(ABDOMEN_ROOT_HALF, ABDOMEN_MID_HALF, t / 0.4) * swell;
    return lerp(ABDOMEN_MID_HALF, ABDOMEN_TIP_HALF, (t - 0.4) / 0.6) * swell;
  };
  const spine = (t: number): Pt => {
    // The abdomen curls upward along its length rather than pivoting at the
    // root; a straight cone hinged at one point reads as a tail.
    const a = spineAngleAt(t);
    return {
      x: root.x + Math.cos(a) * length * t,
      y: root.y + Math.sin(a) * length * t - p.abdomenSway * Math.sin(t * Math.PI) * 0.05,
    };
  };
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = spine(t);
    const a = spineAngleAt(t);
    pts.push({ x: c.x - Math.sin(a) * buildHalf(t), y: c.y + Math.cos(a) * buildHalf(t) });
  }
  for (let i = STEPS; i >= 0; i--) {
    const t = i / STEPS;
    const c = spine(t);
    const a = spineAngleAt(t);
    pts.push({ x: c.x + Math.sin(a) * buildHalf(t), y: c.y - Math.cos(a) * buildHalf(t) });
  }
  paintChitin(ctx, { outline: pts, build, gloss: 0.7 });

  ctx.save();
  traceOutline(ctx, pts);
  ctx.clip();
  for (let s = 1; s < ABDOMEN_SEGMENTS; s++) {
    const t = s / ABDOMEN_SEGMENTS;
    const c = spine(t);
    const a = spineAngleAt(t);
    const half = buildHalf(t) * 1.4;
    ctx.beginPath();
    ctx.moveTo(c.x - Math.sin(a) * half, c.y + Math.cos(a) * half);
    ctx.lineTo(c.x + Math.sin(a) * half, c.y - Math.cos(a) * half);
    ctx.strokeStyle = rgba(build.palette.ink, 0.3);
    ctx.lineWidth = 0.008;
    ctx.stroke();
  }
  ctx.restore();

  // Cerci: the two short sensory bristles every mantis carries at the tip.
  const tip = spine(1);
  const tipAngle = spineAngleAt(1);
  for (const sign of [-1, 1]) {
    const end = {
      x: tip.x + Math.cos(tipAngle + sign * deg(24)) * 0.05,
      y: tip.y + Math.sin(tipAngle + sign * deg(24)) * 0.05,
    };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = rgba(build.palette.ink, 0.8);
    ctx.lineWidth = 0.008;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

/**
 * How far a full display throws a wing case off the abdomen.
 *
 * Signed by the caller rather than baked in: the two cases have to open *away
 * from each other* into a V. One fixed sign lifts one wing and drives the other
 * into the abdomen, so the deimatic display appears on one side of the animal
 * only — in `rage_pause`, the single pose whose whole job is being readable.
 */
const WING_FLARE_ANGLE = deg(46);
/** How far the hind wing fans out from under its lifted case. */
const HIND_WING_FAN_ANGLE = deg(26);
/** Flare below which no hind wing shows, and the ramp it fades in over. */
const HIND_WING_REVEAL_FLARE = 0.2;
const HIND_WING_MAX_ALPHA = 0.75;

/** Deepest a tear may eat into the trailing edge, as a fraction of the wing's half-width. */
const WING_TEAR_DEPTH = 0.85;
/** How many splits run down a worn wing. Few and deep; many and shallow is a saw blade. */
const WING_TEAR_COUNT = 3;
/** Fraction of the wing's length nearest the root that never tears. */
const WING_TEAR_ROOT_GUARD = 0.35;

/**
 * How far the trailing edge is eaten away at `t` along the wing.
 *
 * A low-frequency function of three splits, not per-sample noise. Noise at the
 * sample rate produced an even comb of notches that read as a saw blade painted
 * on the abdomen rather than as a wing that has been through something.
 */
function tearAt(build: MantidBuild, seed: number, t: number): number {
  if (build.wingWear <= 0 || t < WING_TEAR_ROOT_GUARD) return 0;
  let deepest = 0;
  for (let i = 0; i < WING_TEAR_COUNT; i++) {
    const centre = lerp(WING_TEAR_ROOT_GUARD + 0.08, 0.98, hash2(seed, i));
    const width = lerp(0.05, 0.13, hash2(seed + 3.1, i));
    const distance = Math.abs(t - centre) / width;
    if (distance >= 1) continue;
    const depth = Math.cos((distance * Math.PI) / 2) * lerp(0.4, 1, hash2(seed + 6.7, i));
    deepest = Math.max(deepest, depth);
  }
  return deepest * WING_TEAR_DEPTH * build.wingWear;
}

/**
 * A wing case (tegmen) lying along the abdomen, or lifted off it.
 *
 * Wear is punched in as splits in the trailing edge rather than painted on:
 * a torn wing has to break the *silhouette* or it reads as a stain.
 */
function drawWingCase(
  ctx: Ctx,
  build: MantidBuild,
  p: MantidPose,
  baseAngle: number,
  rootX: number,
  rootY: number,
  length: number,
  half: number,
  extraAngle: number,
  /** Which way this case opens on a display. Mirrored by the axial views. */
  flareSign: number,
  shade: number,
  seed: number,
): void {
  const angle = baseAngle + extraAngle + flareSign * p.wingFlare * WING_FLARE_ANGLE;
  const root: Pt = { x: rootX, y: rootY };
  const pts: Pt[] = [];
  const STEPS = 18;
  const edgeHalf = (t: number): number => Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62) * half;
  // Leading edge: straight and hard, the way a real tegmen's costal margin is.
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pts.push({
      x: root.x + Math.cos(angle) * length * t - Math.sin(angle) * edgeHalf(t) * 0.35,
      y: root.y + Math.sin(angle) * length * t + Math.cos(angle) * edgeHalf(t) * 0.35,
    });
  }
  for (let i = STEPS; i >= 0; i--) {
    const t = i / STEPS;
    const trailing = Math.max(0, edgeHalf(t) - tearAt(build, seed, t) * half);
    pts.push({
      x: root.x + Math.cos(angle) * length * t + Math.sin(angle) * trailing,
      y: root.y + Math.sin(angle) * length * t - Math.cos(angle) * trailing,
    });
  }
  paintChitin(ctx, { outline: pts, build, shade, gloss: 0.55 });

  ctx.save();
  traceOutline(ctx, pts);
  ctx.clip();
  // The longitudinal vein plus a few cross veins. One long vein is what makes
  // the plate read as a wing rather than as another body segment.
  const VEIN_COUNT = 4;
  for (let v = 0; v < VEIN_COUNT; v++) {
    const offset = lerp(-half * 0.45, half * 0.5, v / (VEIN_COUNT - 1));
    ctx.beginPath();
    ctx.moveTo(root.x - Math.sin(angle) * offset, root.y + Math.cos(angle) * offset);
    ctx.lineTo(
      root.x + Math.cos(angle) * length - Math.sin(angle) * offset * 0.4,
      root.y + Math.sin(angle) * length + Math.cos(angle) * offset * 0.4,
    );
    ctx.strokeStyle = rgba(build.palette.ink, v === 1 ? 0.42 : 0.2);
    ctx.lineWidth = v === 1 ? 0.008 : 0.005;
    ctx.stroke();
  }
  ctx.restore();

  if (p.wingFlare > HIND_WING_REVEAL_FLARE) {
    // The hind wing showing under the lifted case: translucent, and the only
    // warm-lit part of the animal. It is the whole point of a display.
    const hind = segmentOutline(
      root,
      along(root, angle + flareSign * HIND_WING_FAN_ANGLE, length * 0.92),
      half * 0.7,
      half * 1.35,
      0.05,
    );
    ctx.save();
    ctx.globalAlpha =
      clamp01((p.wingFlare - HIND_WING_REVEAL_FLARE) / (1 - HIND_WING_REVEAL_FLARE)) *
      HIND_WING_MAX_ALPHA;
    paintChitin(ctx, {
      outline: hind,
      build: { ...build, palette: { ...build.palette, base: build.palette.membrane } },
      gloss: 0.2,
      contour: 0.4,
    });
    ctx.restore();
  }
}

/**
 * The head, seen head-on or from behind: the triangle, both compound eyes, the
 * ocelli and the antennae.
 *
 * The head sits on the pronotum's tip and is drawn in a frame where +Y runs on
 * along the pronotum, so a pitching neck carries it. `headTurn` swings it about
 * that axis — a mantis turns its head on its neck further than anything else in
 * the bestiary, and it is worth the extra control.
 */
function drawHeadAxial(
  ctx: Ctx,
  build: MantidBuild,
  p: MantidPose,
  neck: Placed,
  facingCamera: boolean,
): void {
  ctx.save();
  ctx.translate(neck.origin.x, neck.origin.y);
  ctx.rotate(neck.angle + Math.PI / 2 + p.headPitch + p.headTilt);

  const halfWidth = HEAD_WIDTH / 2;
  // Foreshortening from the head turning on its neck; the far eye shrinks and
  // slides toward the middle as it goes round.
  const turn = clamp01(Math.abs(p.headTurn));
  const backEdge = -HEAD_DEPTH * 0.46;
  const chinDepth = HEAD_DEPTH * 0.54;
  const shift = p.headTurn * halfWidth * 0.22;

  const outline: Pt[] = [
    { x: -halfWidth + shift, y: backEdge },
    { x: -halfWidth * 0.84 + shift, y: chinDepth * 0.3 },
    { x: -halfWidth * 0.32 + shift, y: chinDepth },
    { x: halfWidth * 0.32 + shift, y: chinDepth },
    { x: halfWidth * 0.84 + shift, y: chinDepth * 0.3 },
    { x: halfWidth + shift, y: backEdge },
  ];
  paintChitin(ctx, { outline, build, contour: 1 });

  if (facingCamera) {
    const eyeSpread = halfWidth * 0.7;
    const eyeY = backEdge + EYE_RY * 0.5;
    for (const side of [-1, 1]) {
      // Turning the face toward +x carries the +x eye *away* from the viewer, so
      // that is the one that narrows and slides in toward the midline. Narrowing
      // the other instead — which is what this did — reads as the head turning
      // the wrong way, and is why the pivot never quite landed.
      const away = Math.sign(p.headTurn) === side ? turn : 0;
      drawCompoundEye(
        ctx,
        build,
        p,
        side * eyeSpread * (1 - away * EYE_TURN_SLIDE) + shift,
        eyeY,
        1 - away * EYE_TURN_SHRINK,
        1 - away * EYE_TURN_NARROW,
      );
    }
    drawOcelli(ctx, build, shift, backEdge, halfWidth);
    drawMandibles(ctx, build, shift, chinDepth, halfWidth);
  }

  const antennaBaseY = backEdge + HEAD_DEPTH * 0.12;
  for (const side of [-1, 1]) {
    drawAntenna(
      ctx,
      build,
      halfWidth * 0.46 * side + shift,
      antennaBaseY,
      side,
      p.antenna,
      deg(30),
    );
  }
  ctx.restore();
}

/**
 * The head in profile.
 *
 * Deliberately its own shape rather than the front triangle squashed on one
 * axis: from the side a mantis head is a short rounded wedge that is *almost
 * entirely eye*, with the mandibles as a small dark notch at the front-bottom.
 * Squashing the triangle instead gave a narrow slab with a bead on it, which is
 * how the head ended up reading as part of the arm.
 */
function drawHeadSide(ctx: Ctx, build: MantidBuild, p: MantidPose, neck: Placed): void {
  ctx.save();
  ctx.translate(neck.origin.x, neck.origin.y);
  // Anchored to the pronotum but carried level: a mantis pitches its head
  // forward off the neck so it looks where it is going, not straight up.
  ctx.rotate(neck.angle + Math.PI / 2 + HEAD_SIDE_REST_PITCH + p.headPitch + p.headTilt);

  const halfLen = HEAD_SIDE_LENGTH / 2;
  const halfDepth = HEAD_DEPTH * 0.5;
  // +X is forward here; the wedge is deepest at the back and tapers to the jaw.
  const outline: Pt[] = [
    { x: -halfLen, y: -halfDepth * 0.8 },
    { x: halfLen * 0.55, y: -halfDepth },
    { x: halfLen, y: -halfDepth * 0.2 },
    { x: halfLen * 0.8, y: halfDepth * 0.7 },
    { x: 0, y: halfDepth },
    { x: -halfLen * 0.9, y: halfDepth * 0.5 },
  ];
  paintChitin(ctx, { outline, build, contour: 1 });

  // One eye, and it owns the head. Set forward and high, where a hunting insect
  // carries it.
  drawCompoundEye(ctx, build, p, halfLen * 0.28, -halfDepth * 0.22, 0.92, 0.8);

  // Mandibles: a dark notch at the front of the jaw line.
  ctx.beginPath();
  ctx.moveTo(halfLen * 0.86, halfDepth * 0.1);
  ctx.lineTo(halfLen * 1.12, halfDepth * 0.6);
  ctx.lineTo(halfLen * 0.4, halfDepth * 0.86);
  ctx.closePath();
  ctx.fillStyle = rgba(build.palette.dark, 0.92);
  ctx.fill();
  ctx.strokeStyle = rgba(build.palette.ink, 0.7);
  ctx.lineWidth = 0.006;
  ctx.stroke();

  // In profile the two antennae would overlap into one thick line, so they are
  // fanned fore and aft instead of out to the sides.
  drawAntenna(ctx, build, halfLen * 0.5, -halfDepth * 0.86, 1, p.antenna, deg(-52));
  drawAntenna(ctx, build, halfLen * 0.1, -halfDepth * 0.92, -1, p.antenna + 0.3, deg(-18));
  ctx.restore();
}

/** How far forward the head is carried off the pronotum's own line. */
const HEAD_SIDE_REST_PITCH = deg(-44);

/** The three simple eyes in a triangle between the antennal bases. */
function drawOcelli(
  ctx: Ctx,
  build: MantidBuild,
  shift: number,
  top: number,
  halfWidth: number,
): void {
  const OCELLUS_RADIUS = 0.009;
  for (let i = 0; i < 3; i++) {
    const ox = lerp(-halfWidth * 0.2, halfWidth * 0.2, i / 2) + shift;
    const oy = top + HEAD_DEPTH * (i === 1 ? 0.26 : 0.36);
    ctx.beginPath();
    ctx.arc(ox, oy, OCELLUS_RADIUS, 0, TWO_PI);
    ctx.fillStyle = rgba(build.palette.eyeDark, 0.85);
    ctx.fill();
  }
}

function drawMandibles(
  ctx: Ctx,
  build: MantidBuild,
  shift: number,
  chinDepth: number,
  halfWidth: number,
): void {
  ctx.beginPath();
  ctx.moveTo(-halfWidth * 0.3 + shift, chinDepth * 0.7);
  ctx.lineTo(shift, chinDepth * 1.24);
  ctx.lineTo(halfWidth * 0.3 + shift, chinDepth * 0.7);
  ctx.closePath();
  ctx.fillStyle = rgba(build.palette.dark, 0.92);
  ctx.fill();
  ctx.strokeStyle = rgba(build.palette.ink, 0.6);
  ctx.lineWidth = 0.006;
  ctx.stroke();
}

/** How far a receding eye slides toward the midline, and how it shrinks and flattens. */
const EYE_TURN_SLIDE = 0.28;
const EYE_TURN_SHRINK = 0.35;
const EYE_TURN_NARROW = 0.5;

const EYE_FACET_RINGS = 3;

function drawCompoundEye(
  ctx: Ctx,
  build: MantidBuild,
  p: MantidPose,
  cx: number,
  cy: number,
  scale: number,
  widthScale = 1,
): void {
  const rx = EYE_RX * scale * widthScale;
  const ry = EYE_RY * scale;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  const gradient = ctx.createRadialGradient(
    cx - rx * 0.35,
    cy - ry * 0.4,
    rx * 0.1,
    cx,
    cy,
    rx * 1.4,
  );
  gradient.addColorStop(0, mix(build.palette.eye, '#ffffff', 0.35));
  gradient.addColorStop(0.6, build.palette.eye);
  gradient.addColorStop(1, mix(build.palette.eye, build.palette.eyeDark, 0.75));
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.clip();
  // Faceting: concentric rings of fine dots. Cheap, and it is the difference
  // between a compound eye and a marble.
  for (let ring = 1; ring <= EYE_FACET_RINGS; ring++) {
    const r = (ring / (EYE_FACET_RINGS + 1)) * 1.05;
    const count = 6 + ring * 5;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TWO_PI + ring;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, rx * 0.055, 0, TWO_PI);
      ctx.fillStyle = rgba(build.palette.eyeDark, 0.18);
      ctx.fill();
    }
  }

  // The pseudopupil — the black spot that appears to follow the viewer. Nothing
  // else makes a bug look like it has *noticed* you.
  const pupilX = cx + p.gaze * rx * 0.42;
  const pupilY = cy + ry * 0.16;
  ctx.beginPath();
  ctx.ellipse(pupilX, pupilY, rx * 0.3, ry * 0.34, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(build.palette.eyeDark, 0.92);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.strokeStyle = rgba(build.palette.ink, 0.8);
  ctx.lineWidth = 0.007;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.4, cy - ry * 0.45, rx * 0.22, ry * 0.16, deg(-25), 0, TWO_PI);
  ctx.fillStyle = rgba('#ffffff', 0.6);
  ctx.fill();
}

const ANTENNA_SEGMENTS = 10;

function drawAntenna(
  ctx: Ctx,
  build: MantidBuild,
  baseX: number,
  baseY: number,
  sign: number,
  phase: number,
  spreadAngle: number,
): void {
  const spread = spreadAngle * sign;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
    const t = i / ANTENNA_SEGMENTS;
    const curl = deg(34) * t * t * sign + Math.sin(phase * TWO_PI + t * 2.6) * deg(9) * sign;
    const a = -Math.PI / 2 + spread + curl;
    const step = (ANTENNA_LENGTH / ANTENNA_SEGMENTS) * (1 - t * 0.25);
    baseX += Math.cos(a) * step;
    baseY += Math.sin(a) * step;
    ctx.lineTo(baseX, baseY);
  }
  ctx.strokeStyle = rgba(build.palette.ink, 0.82);
  ctx.lineWidth = 0.008;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * One raptorial forelimb, socketed on the pronotum.
 *
 * At `unfold = 0` the tibia lies folded back along the femur — the prayer. At
 * `unfold = 1` the whole arm is nearly straight, which is the only frame of a
 * strike anyone actually sees.
 */
function drawRaptorial(
  ctx: Ctx,
  build: MantidBuild,
  arm: RaptorialPose,
  rig: ArmRig,
  socket: Pt,
  baseAngle: number,
  mirror: number,
  shade: number,
  seed: number,
): void {
  const heft = 1 + build.heft * 0.28;
  const unfold = easeInOut(arm.unfold);
  const coxaAngle =
    baseAngle + mirror * (rig.coxaOffset + arm.swing + arm.spread * rig.spreadAngle);
  const coxaEnd = along(socket, coxaAngle, COXA_LENGTH);

  // The femur rides forward off the coxa; unfolding rotates it out toward the
  // strike line.
  const femurAngle = coxaAngle + mirror * lerp(rig.femurFold, rig.femurStrike, unfold);
  const femurEnd = along(coxaEnd, femurAngle, FEMUR_LENGTH + arm.reach * 0.4);

  // Folded, the tibia doubles back on the femur at a hair over 180°; extended it
  // continues it. That reversal is the mantis's signature.
  const tibiaAngle = femurAngle + mirror * lerp(rig.tibiaFold, rig.tibiaStrike, unfold);
  const tibiaEnd = along(femurEnd, tibiaAngle, TIBIA_LENGTH + arm.reach * 0.6);

  const coxa = segmentOutline(socket, coxaEnd, COXA_HALF * heft, COXA_HALF * 0.85 * heft, 0.008);
  paintChitin(ctx, { outline: coxa, build, shade });

  const femur = segmentOutline(
    coxaEnd,
    femurEnd,
    FEMUR_HALF * heft,
    FEMUR_HALF * 0.55 * heft,
    0.022 * mirror,
  );
  paintChitin(ctx, { outline: femur, build, shade });
  drawScars(ctx, build, femur, RAPTORIAL_FEMUR_SCARS, seed);
  drawSpineRow(ctx, build, coxaEnd, femurEnd, FEMUR_SPINES, SPINE_LENGTH * heft, mirror, seed);

  const tibia = segmentOutline(
    femurEnd,
    tibiaEnd,
    TIBIA_HALF * heft,
    TIBIA_HALF * 0.4 * heft,
    0.016 * mirror,
  );
  paintChitin(ctx, { outline: tibia, build, shade });
  drawSpineRow(
    ctx,
    build,
    femurEnd,
    tibiaEnd,
    TIBIA_SPINES,
    SPINE_LENGTH * 0.72 * heft,
    -mirror,
    seed + 3.3,
  );

  // The terminal claw: a single dark hook. It is what the strike lands with.
  const clawEnd = along(tibiaEnd, tibiaAngle - mirror * deg(34), 0.045);
  ctx.beginPath();
  ctx.moveTo(tibiaEnd.x, tibiaEnd.y);
  ctx.quadraticCurveTo(
    (tibiaEnd.x + clawEnd.x) / 2 - Math.sin(tibiaAngle) * 0.012 * mirror,
    (tibiaEnd.y + clawEnd.y) / 2 + Math.cos(tibiaAngle) * 0.012 * mirror,
    clawEnd.x,
    clawEnd.y,
  );
  ctx.strokeStyle = rgba(build.palette.ink, 0.9);
  ctx.lineWidth = 0.014;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** One walking leg, IK-solved so its foot stays on the ground line. */
function drawWalkingLeg(
  ctx: Ctx,
  build: MantidBuild,
  root: Pt,
  foot: Pt,
  splay: number,
  shade: number,
  outward: number,
): void {
  const knee = solveTwoBone(root, foot, LEG_FEMUR * splay, LEG_TIBIA, KNEE_BEND_SIGN * outward);
  const femur = segmentOutline(root, knee, LEG_HALF_ROOT, LEG_HALF_KNEE, 0.01 * outward);
  paintChitin(ctx, { outline: femur, build, shade, gloss: 0.5 });
  const tibia = segmentOutline(knee, foot, LEG_HALF_KNEE, LEG_HALF_FOOT, -0.008 * outward);
  paintChitin(ctx, { outline: tibia, build, shade, gloss: 0.5 });

  // Tarsus: a short foot laid flat on the ground, angled the way the leg came in.
  const legAngle = Math.atan2(foot.y - knee.y, foot.x - knee.x);
  const toe = along(foot, legAngle - Math.PI / 2 + deg(96) * outward, TARSUS_LENGTH);
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(toe.x, toe.y);
  ctx.strokeStyle = rgba(mix(build.palette.dark, build.palette.ink, 0.4), 0.95);
  ctx.lineWidth = 0.012;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ── Views ────────────────────────────────────────────────────────────────────

/** How far a lifted foot rises off the ground line per unit of `lift`. */
const FOOT_LIFT_HEIGHT = 0.11;
/** Shade applied to the limbs on the far side of the body. */
const FAR_SIDE_SHADE = 0.75;

/** Where the abdomen and wing cases point in profile: back and slightly up. */
const SIDE_TAIL_ANGLE = Math.PI - ABDOMEN_REST_ANGLE;
/**
 * Where they point head-on: down the screen.
 *
 * Geometrically the abdomen recedes from the camera and would project to almost
 * nothing. Drawing it as a short mass hanging below the thorax is the standing
 * convention in this bestiary's head-on views, and it is the only way the wing
 * cases stay part of the silhouette from the front.
 */
const AXIAL_TAIL_ANGLE = deg(96);

function footFor(restX: number, leg: LegPose): Pt {
  return {
    x: restX + leg.dx,
    y: GROUND_Y + leg.dy - leg.lift * FOOT_LIFT_HEIGHT,
  };
}

/** Shivers per frame-cycle in a held rage pose. Slow enough to read, fast enough to alarm. */
const TREMBLE_CYCLES = 9;
/** How far rearing lifts the body off its stance, in tile units. */
const REAR_LIFT = 0.09;
const REAR_PITCH = deg(-11);

function applyBodyTransform(ctx: Ctx, p: MantidPose): void {
  const shiver = p.tremble * Math.sin(p.time * TWO_PI * TREMBLE_CYCLES);
  ctx.translate(p.sway + p.lunge + shiver, p.bob - p.rear * REAR_LIFT);
  ctx.rotate(p.lean - p.rear * REAR_PITCH);
  ctx.scale(1, p.squash);
}

function pronotumHalfWidths(build: MantidBuild): { root: number; tip: number } {
  const heft = 1 + build.heft * PRONOTUM_HEFT_GAIN;
  return { root: PRONOTUM_ROOT_HALF * heft, tip: PRONOTUM_TIP_HALF * heft };
}

export function drawMantidSide(ctx: Ctx, p: MantidPose, build: MantidBuild): void {
  ctx.save();
  drawGroundShadow(ctx, build, 0, GROUND_Y + 0.02, 0.34, 0.07 * p.shadow);
  applyBodyTransform(ctx, p);

  // Far-side walking legs first, shaded, so the body separates from them.
  drawWalkingLeg(
    ctx,
    build,
    MID_LEG_ROOT,
    footFor(MID_FOOT_REST_X * 0.86, p.midR),
    p.midR.splay,
    FAR_SIDE_SHADE,
    1,
  );
  drawWalkingLeg(
    ctx,
    build,
    HIND_LEG_ROOT,
    footFor(HIND_FOOT_REST_X * 0.86, p.hindR),
    p.hindR.splay,
    FAR_SIDE_SHADE,
    1,
  );

  drawAbdomen(ctx, build, p, SIDE_TAIL_ANGLE, ABDOMEN_ROOT_X, 1);
  drawWingCase(
    ctx,
    build,
    p,
    SIDE_TAIL_ANGLE,
    ABDOMEN_ROOT_X + 0.06,
    ABDOMEN_ROOT_Y - 0.05 + p.abdomenLift,
    ABDOMEN_LENGTH * 0.92,
    0.085,
    deg(-4),
    1,
    0,
    build.seed + 6.1,
  );

  const thorax = ovalOutline(THORAX_CX, THORAX_CY, THORAX_RX, THORAX_RY, 0, build.seed);
  paintChitin(ctx, { outline: thorax, build });

  const neck = drawPronotum(ctx, build, p);
  const socket = along(
    { x: PRONOTUM_ROOT_X, y: PRONOTUM_ROOT_Y },
    neck.angle,
    PRONOTUM_LENGTH * FORELIMB_SOCKET_ALONG,
  );

  // The far arm goes behind the head, the near arm in front of it, so the prayer
  // reads as two arms rather than as one thick one.
  drawRaptorial(
    ctx,
    build,
    { ...p.foreR, swing: p.foreR.swing + SIDE_FAR_ARM_SWING },
    SIDE_ARM_RIG,
    { x: socket.x - SIDE_FAR_ARM_OFFSET.x, y: socket.y + SIDE_FAR_ARM_OFFSET.y },
    neck.angle,
    1,
    FAR_SIDE_SHADE,
    build.seed + 2.2,
  );
  drawHeadSide(ctx, build, p, neck);
  drawRaptorial(ctx, build, p.foreL, SIDE_ARM_RIG, socket, neck.angle, 1, 0, build.seed + 5.5);

  // Near-side walking legs last: they cross in front of the body.
  drawWalkingLeg(ctx, build, MID_LEG_ROOT, footFor(MID_FOOT_REST_X, p.midL), p.midL.splay, 0, 1);
  drawWalkingLeg(
    ctx,
    build,
    HIND_LEG_ROOT,
    footFor(HIND_FOOT_REST_X, p.hindL),
    p.hindL.splay,
    0,
    1,
  );
  ctx.restore();
}

/**
 * Parallax on the far raptorial in profile.
 *
 * Both arms move together in the prayer, so drawn on the same socket at the same
 * angle the far one hides exactly behind the near one and the animal appears to
 * have grown a single thick club. A few degrees and a couple of hundredths of a
 * tile is all it takes to separate them.
 */
const SIDE_FAR_ARM_SWING = deg(11);
const SIDE_FAR_ARM_OFFSET: Pt = { x: 0.022, y: 0.016 };

/** Foreshortening applied to the abdomen head-on and from behind. */
const FRONT_TAIL_FORESHORTEN = 0.34;
const BACK_TAIL_FORESHORTEN = 0.72;
/** How much of its profile length the pronotum keeps when seen end-on. */
const AXIAL_PRONOTUM_FORESHORTEN = 0.78;
/** Half the gap between the two walking-leg roots seen head-on. */
const AXIAL_HIP_HALF = 0.07;
/**
 * Where the head-on feet plant. The pair further from the camera stands
 * narrower and higher up the screen — that difference is the only depth cue an
 * orthographic head-on view has, and without it all four legs read as two.
 */
const AXIAL_NEAR_FOOT_SPREAD = 0.35;
const AXIAL_FAR_FOOT_SPREAD = 0.21;
const AXIAL_FAR_FOOT_RISE = 0.07;
/** Straight down the screen; the axial arm rig measures its angles off this. */
const AXIAL_ARM_BASE_ANGLE = Math.PI / 2;

interface AxialLegSpec {
  readonly rootY: number;
  readonly spread: number;
  readonly rise: number;
  readonly leg: LegPose;
  readonly sign: number;
}

function drawAxialLegs(
  ctx: Ctx,
  build: MantidBuild,
  specs: readonly AxialLegSpec[],
  shade: number,
): void {
  for (const spec of specs) {
    const root: Pt = { x: AXIAL_HIP_HALF * spec.sign, y: spec.rootY };
    const foot: Pt = {
      x: spec.sign * (spec.spread + spec.leg.dx),
      y: GROUND_Y - spec.rise + spec.leg.dy - spec.leg.lift * FOOT_LIFT_HEIGHT,
    };
    drawWalkingLeg(ctx, build, root, foot, spec.leg.splay, shade, spec.sign);
  }
}

function axialLegPair(
  rootY: number,
  spread: number,
  rise: number,
  left: LegPose,
  right: LegPose,
): AxialLegSpec[] {
  return [
    { rootY, spread, rise, leg: left, sign: -1 },
    { rootY, spread, rise, leg: right, sign: 1 },
  ];
}

/** Draws the pronotum column and both raptorials for a head-on or away view. */
function drawAxialNeckAndArms(
  ctx: Ctx,
  build: MantidBuild,
  p: MantidPose,
  neckAngle: number,
  armShade: number,
  extraSpread: number,
): Placed {
  const root: Pt = { x: 0, y: PRONOTUM_ROOT_Y };
  const length = PRONOTUM_LENGTH * AXIAL_PRONOTUM_FORESHORTEN;
  const tip = along(root, neckAngle, length);
  paintPronotumPlate(ctx, build, root, tip, 0);
  const half = pronotumHalfWidths(build);

  const socket = along(root, neckAngle, length * FORELIMB_SOCKET_ALONG);
  for (const side of [-1, 1]) {
    const arm = side < 0 ? p.foreL : p.foreR;
    drawRaptorial(
      ctx,
      build,
      { ...arm, spread: arm.spread + extraSpread },
      AXIAL_ARM_RIG,
      { x: socket.x + side * half.tip, y: socket.y },
      AXIAL_ARM_BASE_ANGLE,
      side,
      armShade,
      build.seed + 2.2 + side,
    );
  }
  return { origin: tip, angle: neckAngle };
}

export function drawMantidFront(ctx: Ctx, p: MantidPose, build: MantidBuild): void {
  ctx.save();
  drawGroundShadow(ctx, build, 0, GROUND_Y + 0.02, 0.3, 0.065 * p.shadow);
  applyBodyTransform(ctx, p);

  drawAxialLegs(
    ctx,
    build,
    axialLegPair(HIND_LEG_ROOT.y, AXIAL_FAR_FOOT_SPREAD, AXIAL_FAR_FOOT_RISE, p.hindL, p.hindR),
    FAR_SIDE_SHADE,
  );

  // Head-on the abdomen is almost entirely behind the thorax; what shows of it
  // is its widest point and the wing tips flaring past the body on both sides.
  drawAbdomen(ctx, build, { ...p, abdomenSway: 0 }, AXIAL_TAIL_ANGLE, 0, FRONT_TAIL_FORESHORTEN);
  for (const side of [-1, 1]) {
    drawWingCase(
      ctx,
      build,
      p,
      AXIAL_TAIL_ANGLE,
      side * 0.045,
      ABDOMEN_ROOT_Y - 0.03 + p.abdomenLift,
      ABDOMEN_LENGTH * 0.46,
      0.062,
      side * deg(30),
      side,
      0.35,
      build.seed + 6.1 + side,
    );
  }

  const thorax = ovalOutline(0, THORAX_CY, THORAX_RX * 0.92, THORAX_RY, 0, build.seed);
  paintChitin(ctx, { outline: thorax, build });

  drawAxialLegs(
    ctx,
    build,
    axialLegPair(MID_LEG_ROOT.y, AXIAL_NEAR_FOOT_SPREAD, 0, p.midL, p.midR),
    0,
  );

  const neckAngle = -Math.PI / 2 - p.pronotumPitch + p.pronotumYaw;
  const neck = drawAxialNeckAndArms(ctx, build, p, neckAngle, 0, 0);
  // The head goes on last so the prayer can never cover the face — the eyes are
  // the whole read of this view.
  drawHeadAxial(ctx, build, p, neck, true);
  ctx.restore();
}

/** Extra outward spread on the arms seen from behind, where they hang wide of the body. */
const BACK_ARM_SPREAD = 0.6;

export function drawMantidBack(ctx: Ctx, p: MantidPose, build: MantidBuild): void {
  ctx.save();
  drawGroundShadow(ctx, build, 0, GROUND_Y + 0.02, 0.3, 0.065 * p.shadow);
  applyBodyTransform(ctx, p);

  drawAxialLegs(
    ctx,
    build,
    axialLegPair(MID_LEG_ROOT.y, AXIAL_FAR_FOOT_SPREAD, AXIAL_FAR_FOOT_RISE, p.midL, p.midR),
    FAR_SIDE_SHADE,
  );

  const neckAngle = -Math.PI / 2 - p.pronotumPitch - p.pronotumYaw;
  // From behind, only the crown of the head and the antennae clear the pronotum,
  // and the arms hang wide of it. Both go down before the neck covers them —
  // inventing more of either here would be a lie.
  const neckTip = along(
    { x: 0, y: PRONOTUM_ROOT_Y },
    neckAngle,
    PRONOTUM_LENGTH * AXIAL_PRONOTUM_FORESHORTEN,
  );
  drawHeadAxial(ctx, build, p, { origin: neckTip, angle: neckAngle }, false);
  drawAxialNeckAndArms(ctx, build, p, neckAngle, FAR_SIDE_SHADE, BACK_ARM_SPREAD);

  const thorax = ovalOutline(0, THORAX_CY, THORAX_RX * 0.98, THORAX_RY, 0, build.seed);
  paintChitin(ctx, { outline: thorax, build });

  // The abdomen and its wing cases own this view: one broad leaf down the middle
  // with the seam between the two cases running its length.
  drawAbdomen(
    ctx,
    build,
    { ...p, abdomenSway: p.abdomenSway * 0.4 },
    AXIAL_TAIL_ANGLE,
    0,
    BACK_TAIL_FORESHORTEN,
  );
  for (const side of [-1, 1]) {
    drawWingCase(
      ctx,
      build,
      p,
      AXIAL_TAIL_ANGLE,
      side * 0.03,
      ABDOMEN_ROOT_Y - 0.04 + p.abdomenLift,
      ABDOMEN_LENGTH * 0.86,
      0.098,
      side * deg(8),
      side,
      side < 0 ? 0.28 : 0,
      build.seed + 6.1 + side,
    );
  }

  drawAxialLegs(
    ctx,
    build,
    axialLegPair(HIND_LEG_ROOT.y, AXIAL_NEAR_FOOT_SPREAD, 0, p.hindL, p.hindR),
    0,
  );
  ctx.restore();
}
