/**
 * The painter library behind the Lava Llama sprite sheet.
 *
 * What makes a llama read as a llama — at 32 px, in motion, from three
 * viewpoints — is a short list of cues nothing else in the bestiary has: a very
 * long neck carried near-vertical in a shallow S, a small wedge head with a
 * blunt muzzle and a split upper lip, two long banana ears that curve toward
 * each other, an unusually deep and narrow chest, long slender legs on two-toed
 * padded feet, and a shaggy crimped fleece that hangs in clumps off the barrel
 * and breaks the silhouette everywhere. Everything here exists to serve one of
 * those.
 *
 * The fleece is painted as wool rather than as fur: short *crimped* strokes laid
 * in clumps, with the clump edges left ragged, because a llama's coat reads at
 * distance as lumps of fibre rather than as the smooth lie of a rodent's guard
 * hairs. That distinction is the whole difference between this animal and the
 * rat, and a straight-stroke coat on this silhouette comes out looking like a
 * badly drawn horse.
 *
 * The heat is kept to the points a real animal would show it — a soot-blackened
 * muzzle, scorched lower legs, an amber eye, and a throat that lights from
 * inside only while a charge is coming up. A llama whose whole fleece glows
 * stops reading as an animal and starts reading as a lamp.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen. The profile view faces +X; the runtime mirrors it.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Small math ───────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
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

// ── Fleece palette ───────────────────────────────────────────────────────────

/**
 * The four tones a llama's coat is built from, named by where they sit rather
 * than by colour so the same patch list can be reused on the barrel, the neck
 * and the haunch without re-deriving a palette each time.
 *
 * `soot` is the points colouring — muzzle, ear edges, lower legs. Real llamas
 * very often carry darker points, and here it doubles as the animal's only
 * standing cue that it handles something hot.
 */
export type Fleece = 'saddle' | 'flank' | 'cream' | 'soot';

interface ToneColors {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
}

/**
 * The saddle is a warm dark umber rather than a true brown-black: at a 32 px
 * tile a near-black back collapses into a silhouette hole and takes the whole
 * top line of the animal — the line that carries the neck — with it.
 */
const FLEECE: Record<Fleece, ToneColors> = {
  saddle: { base: '#75512f', dark: '#452f1c', light: '#9d7549' },
  flank: { base: '#a3794f', dark: '#6d4e31', light: '#c9a173' },
  // Kept a good deal darker than a real llama's cream underline. Painted at its
  // true value it is the brightest thing on any dungeon floor and pulls the eye
  // straight to the animal's belly rather than to its head.
  cream: { base: '#c2a87f', dark: '#94805e', light: '#dcc9a6' },
  soot: { base: '#3a3029', dark: '#1c1713', light: '#5f5147' },
};

const SHADOW_INK = '#120d09';

/** A patch of one fleece tone laid over a part's base colour. */
export interface CoatBlob {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tone: Fleece;
  readonly seed: number;
}

const BLOB_MOTTLE_MAJOR = 0.16;
const BLOB_MOTTLE_MINOR = 0.09;
const BLOB_MOTTLE_MAJOR_LOBES = 3;
const BLOB_MOTTLE_MINOR_LOBES = 7;
const BLOB_STEPS = 30;

/** The ragged radius of a patch at a given angle. Painting and hit-testing share it. */
function blobRadiusFactor(blob: CoatBlob, angle: number): number {
  return (
    1 +
    BLOB_MOTTLE_MAJOR * Math.sin(angle * BLOB_MOTTLE_MAJOR_LOBES + blob.seed) +
    BLOB_MOTTLE_MINOR * Math.sin(angle * BLOB_MOTTLE_MINOR_LOBES - blob.seed * 2)
  );
}

function blobContains(blob: CoatBlob, x: number, y: number): boolean {
  const dx = x - blob.x;
  const dy = y - blob.y;
  const angle = Math.atan2(dy, dx);
  const reach = Math.hypot(dx / Math.max(MIN_RADIUS, blob.rx), dy / Math.max(MIN_RADIUS, blob.ry));
  return reach < blobRadiusFactor(blob, angle);
}

/** Which tone a point lands on. Later patches paint over earlier ones. */
export function toneAt(blobs: readonly CoatBlob[], base: Fleece, x: number, y: number): Fleece {
  let tone = base;
  for (const blob of blobs) {
    if (blobContains(blob, x, y)) tone = blob.tone;
  }
  return tone;
}

/**
 * Feathering steps a tone patch is laid down in, from its outermost and
 * faintest to its innermost and solid.
 *
 * A patch filled in one pass has a crisp edge, and a crisp edge on a coat marking
 * reads as a decal stuck to the animal — most visibly on the pale underline,
 * which comes out as a white rectangle painted on the belly. Stepping the fill
 * costs two extra paths and buys a transition the eye reads as fur changing
 * colour.
 */
const BLOB_FEATHER: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.32],
  [0.88, 0.55],
  [0.74, 1.0],
];

function fillBlob(ctx: Ctx, blob: CoatBlob): void {
  for (const [scale, alpha] of BLOB_FEATHER) {
    ctx.beginPath();
    for (let i = 0; i <= BLOB_STEPS; i++) {
      const angle = (i / BLOB_STEPS) * TWO_PI;
      const factor = blobRadiusFactor(blob, angle) * scale;
      const px = blob.x + Math.cos(angle) * blob.rx * factor;
      const py = blob.y + Math.sin(angle) * blob.ry * factor;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(FLEECE[blob.tone].base, alpha);
    ctx.fill();
  }
}

// ── Outlines ─────────────────────────────────────────────────────────────────

const OUTLINE_STEPS = 40;
const OUTLINE_WOBBLE_MAJOR_LOBES = 3;
const OUTLINE_WOBBLE_MINOR_LOBES = 7;

/**
 * A closed, slightly irregular oval. The wobble is what stops a stack of
 * ellipses from reading as a stack of ellipses.
 */
export function ovalOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  seed: number,
  wobble = 0.05,
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

/** How far the brisket drops below a plain ellipse, as a fraction of `ry`. */
const BRISKET_DROP = 0.26;
/** How far the flank tucks up behind it, as a fraction of `ry`. */
const FLANK_TUCK = 0.3;
/** How much the back line rises over the withers, as a fraction of `ry`. */
const WITHERS_RISE = 0.1;

/**
 * The barrel silhouette.
 *
 * A plain ellipse gives a llama a straight underline, and a straight underline
 * is what makes the animal read as a barrel on sticks. The real shape has a
 * deep brisket dropping between the forelegs and a flank tucked well up behind
 * it, and that diagonal is most of what says "large herbivore" at tile size.
 * `direction` is baked in as +X-facing; the caller mirrors the whole view.
 */
export function barrelOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  steps = 44,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * TWO_PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const forward = clamp01(cos);
    const rearward = clamp01(-cos);
    const below = clamp01(sin);
    const above = clamp01(-sin);
    const depth = 1 + below * (forward * BRISKET_DROP - rearward * FLANK_TUCK);
    const rise = 1 + above * forward * WITHERS_RISE;
    const wobble =
      1 +
      0.035 *
        (Math.sin(angle * OUTLINE_WOBBLE_MAJOR_LOBES + seed) * 0.6 +
          Math.sin(angle * OUTLINE_WOBBLE_MINOR_LOBES - seed * 1.7) * 0.4);
    pts.push({
      x: cx + cos * rx * wobble,
      y: cy + sin * ry * wobble * depth * rise,
    });
  }
  return pts;
}

/** Lays a smooth closed curve through the sample points. */
export function traceOutline(ctx: Ctx, pts: readonly Pt[]): void {
  const last = pts[pts.length - 1];
  const first = pts[0];
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
}

function pointInPolygon(pts: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    const straddles = a.y > y !== b.y > y;
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundsOf(pts: readonly Pt[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function centroidOf(pts: readonly Pt[]): Pt {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

// ── Wool engine ──────────────────────────────────────────────────────────────

/** One paintable clump of fleece: a silhouette plus the coat that fills it. */
export interface WoolPart {
  readonly outline: readonly Pt[];
  readonly blobs: readonly CoatBlob[];
  readonly base: Fleece;
  readonly seed: number;
  /** Length of the fleece locks that break the silhouette, in tile units. */
  readonly fringe: number;
  /** How many crimped strokes fill the body of the part. */
  readonly strokes: number;
  readonly strokeLen: number;
  /** Wool lies away from this point, the way a fleece hangs off the spine. */
  readonly flowFrom: Pt;
  /** Direction the key light comes from, as a unit-ish vector. */
  readonly light?: Pt;
  /** Extra darkening, for limbs and far-side parts that sit in the body's shade. */
  readonly shade?: number;
  /** Strength of the dark contour laid around the silhouette. */
  readonly contour?: number;
  /**
   * How tightly the wool crimps, 0 for a straight hair and 1 for a full curl.
   * The single control that separates fleece from fur.
   */
  readonly crimp?: number;
}

const DEFAULT_LIGHT: Pt = { x: -0.45, y: -0.89 };
const STROKE_ALPHA = 0.5;
const STROKE_WIDTH = 0.009;
const FRINGE_WIDTH = 0.011;
const FRINGE_ALPHA = 0.72;
/** Locks cluster rather than spacing evenly; this is how many sit in one clump. */
const LOCKS_PER_CLUMP = 3;
const CLUMP_SPREAD = 0.55;
const CONTOUR_WIDTH = 0.013;
const DEFAULT_CONTOUR = 0.85;
const DEFAULT_CRIMP = 0.95;
/** Segments a crimped stroke is drawn in; below three the curl is invisible. */
const CRIMP_SEGMENTS = 5;
const CRIMP_AMPLITUDE = 0.5;
const SHADE_TO_DARK = 0.55;
const LIGHT_TO_LIGHT = 0.5;

/**
 * How far a lock may lean along the silhouette rather than straight out of it.
 * Locks that all point dead outward read as a sea urchin; a real fleece hangs.
 */
const LOCK_LEAN = 0.5;

function shadeTone(tone: Fleece, shade: number, lit: number): string {
  const colors = FLEECE[tone];
  const shaded = mix(colors.base, colors.dark, clamp01(shade) * SHADE_TO_DARK);
  return mix(shaded, colors.light, clamp01(lit) * LIGHT_TO_LIGHT);
}

/**
 * Paints one fleece part: base fill, tone patches, crimped body strokes, a
 * ragged lock fringe on the silhouette, and a contour.
 *
 * The fringe is drawn last and deliberately outside the clip: locks that stop
 * at the silhouette are not locks, they are a texture, and the broken outline
 * is most of what sells wool at this size.
 */
export function paintWool(ctx: Ctx, part: WoolPart): void {
  const {
    outline,
    blobs,
    base,
    seed,
    fringe,
    strokes,
    strokeLen,
    flowFrom,
    light = DEFAULT_LIGHT,
    shade = 0,
    contour = DEFAULT_CONTOUR,
    crimp = DEFAULT_CRIMP,
  } = part;
  if (outline.length < 3) return;

  const bounds = boundsOf(outline);
  const centre = centroidOf(outline);

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();

  ctx.fillStyle = shadeTone(base, shade, 0);
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  for (const blob of blobs) fillBlob(ctx, blob);

  ctx.lineCap = 'round';
  ctx.lineWidth = STROKE_WIDTH;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  for (let i = 0; i < strokes; i++) {
    const px = bounds.minX + hash2(seed, i) * width;
    const py = bounds.minY + hash2(seed + 1.7, i) * height;
    if (!pointInPolygon(outline, px, py)) continue;

    const flowX = px - flowFrom.x;
    const flowY = py - flowFrom.y;
    const flowLen = Math.max(MIN_RADIUS, Math.hypot(flowX, flowY));
    const angle = Math.atan2(flowY / flowLen, flowX / flowLen) + (hash2(seed + 5.1, i) - 0.5);
    const len = strokeLen * (0.6 + hash2(seed + 9.3, i) * 0.8);
    const tone = toneAt(blobs, base, px, py);
    const lit = clamp01((flowX * light.x + flowY * light.y) / flowLen);
    ctx.strokeStyle = rgba(shadeTone(tone, shade, lit), STROKE_ALPHA);
    strokeCrimp(ctx, px, py, angle, len, crimp, seed + i);
  }
  ctx.restore();

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = FRINGE_WIDTH;
  const clumps = Math.max(1, Math.round(outline.length / LOCKS_PER_CLUMP));
  for (let clump = 0; clump < clumps; clump++) {
    const anchor = Math.floor((clump / clumps) * outline.length);
    for (let lock = 0; lock < LOCKS_PER_CLUMP; lock++) {
      const index = (anchor + lock) % outline.length;
      const here = outline[index];
      const next = outline[(index + 1) % outline.length];
      const outX = here.x - centre.x;
      const outY = here.y - centre.y;
      const outLen = Math.max(MIN_RADIUS, Math.hypot(outX, outY));
      const alongX = next.x - here.x;
      const alongY = next.y - here.y;
      const alongLen = Math.max(MIN_RADIUS, Math.hypot(alongX, alongY));
      const lean = (hash2(seed + 3.3, index) - 0.5) * 2 * LOCK_LEAN;
      const dirX = outX / outLen + (alongX / alongLen) * lean;
      const dirY = outY / outLen + (alongY / alongLen) * lean;
      const angle = Math.atan2(dirY, dirX);
      // Locks in one clump taper away from its middle, which is what makes the
      // fringe read as hanging fibre rather than as a row of identical spikes.
      const clumpFalloff = 1 - Math.abs(lock - (LOCKS_PER_CLUMP - 1) / 2) * CLUMP_SPREAD;
      const len = fringe * clumpFalloff * (0.5 + hash2(seed + 7.9, index) * 0.9);
      if (len <= MIN_RADIUS) continue;
      const tone = toneAt(blobs, base, here.x, here.y);
      const lit = clamp01((outX * light.x + outY * light.y) / outLen);
      ctx.strokeStyle = rgba(shadeTone(tone, shade, lit), FRINGE_ALPHA);
      strokeCrimp(ctx, here.x, here.y, angle, len, crimp, seed + index * 1.3);
    }
  }
  ctx.restore();

  if (contour > 0) {
    ctx.save();
    traceOutline(ctx, outline);
    ctx.strokeStyle = rgba(SHADOW_INK, contour * 0.45);
    ctx.lineWidth = CONTOUR_WIDTH;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A single wool fibre: a stroke that waves as it goes, so it reads as crimped
 * rather than as a bristle. `curl` scales the wave; zero draws a straight hair.
 */
function strokeCrimp(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  len: number,
  curl: number,
  seed: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const phase = hash1(seed) * TWO_PI;
  const amplitude = len * CRIMP_AMPLITUDE * clamp01(curl);
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let step = 1; step <= CRIMP_SEGMENTS; step++) {
    const t = step / CRIMP_SEGMENTS;
    const along = len * t;
    const across = Math.sin(phase + t * Math.PI * 2) * amplitude * t;
    ctx.lineTo(x + cos * along - sin * across, y + sin * along + cos * across);
  }
  ctx.stroke();
}

/** A soft elliptical shadow on the floor under the animal. */
export function drawGroundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= MIN_RADIUS || ry <= MIN_RADIUS) return;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(SHADOW_INK, 0.3);
  ctx.fill();
  ctx.restore();
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** One foot's displacement from where it rests, plus how spread its toes are. */
export interface FootPose {
  readonly dx: number;
  readonly dy: number;
  /** 0 planted, 1 at the top of its swing. Drives the toe curl and the shadow. */
  readonly lift: number;
  /** 0 toes together, 1 fully splayed on the plant. */
  readonly splay: number;
}

export interface LlamaPose {
  readonly bob: number;
  readonly sway: number;
  readonly lean: number;
  readonly squash: number;
  readonly breathe: number;

  /**
   * Where the base of the neck sits relative to the withers, and how the neck
   * curves on its way up. A llama's neck is the animal's whole read at tile
   * size, so it gets three controls of its own rather than riding on the head.
   */
  readonly neckLean: number;
  /** Positive bows the neck forward into a C, negative throws it back into an S. */
  readonly neckCurve: number;
  /** Shortening of the neck as the animal gathers to spit. */
  readonly neckCompress: number;

  readonly headPitch: number;
  /** -1 looking to its right, +1 to its left. */
  readonly headTurn: number;
  readonly headTilt: number;

  /** -1 pinned flat back, 0 neutral, 1 pricked upright. */
  readonly earL: number;
  readonly earR: number;

  readonly eyeOpen: number;
  /** 0 closed, 1 gaping. A spitting llama's jaw barely opens — see `drawHead`. */
  readonly jaw: number;
  /** 0 relaxed, 1 the upper lip fully curled back off the teeth. */
  readonly lipCurl: number;
  /**
   * 0 empty, 1 a charge fully worked up the throat. Drives both the bulge that
   * travels up the neck and the ember light that shows through the fleece.
   */
  readonly charge: number;

  readonly tailLift: number;
  readonly tailSway: number;

  readonly frontL: FootPose;
  readonly frontR: FootPose;
  readonly hindL: FootPose;
  readonly hindR: FootPose;

  /** Forward drive of a spit, in tile units. Moves the whole animal. */
  readonly lunge: number;
  readonly shadow: number;
  /** Phase used to animate quivers within a held pose. */
  readonly time: number;
}

const REST_FOOT: FootPose = { dx: 0, dy: 0, lift: 0, splay: 0.5 };

export function restPose(): LlamaPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    squash: 1,
    breathe: 0,
    neckLean: 0,
    neckCurve: 0,
    neckCompress: 0,
    headPitch: 0,
    headTurn: 0,
    headTilt: 0,
    earL: 0,
    earR: 0,
    eyeOpen: 1,
    jaw: 0,
    lipCurl: 0,
    charge: 0,
    tailLift: 0,
    tailSway: 0,
    frontL: REST_FOOT,
    frontR: REST_FOOT,
    hindL: REST_FOOT,
    hindR: REST_FOOT,
    lunge: 0,
    shadow: 1,
    time: 0,
  };
}

// ── Anatomy (tile units, origin = centre of the tile) ─────────────────────────

/** Where the feet meet the floor, in tile units. */
export const GROUND_Y = 0.46;

/**
 * The barrel, in profile. A llama's chest is deep and narrow — deeper front to
 * back than a horse's relative to its length — and getting that wrong is what
 * makes a long-necked quadruped read as a small horse instead.
 */
const BODY_CX = -0.02;
const BODY_CY = 0.0;
const BODY_RX = 0.255;
const BODY_RY = 0.135;

/**
 * The neck roots *inside* the shoulder mass rather than on top of it. Rooted at
 * the silhouette's edge it reads as a pole stuck into a barrel, and the step
 * where the two meet is visible at every size.
 */
const WITHERS_X = 0.15;
const WITHERS_Y = 0.02;
const RUMP_X = -0.2;
const RUMP_Y = 0.0;

/** Length of the neck from withers to the base of the skull. */
const NECK_LENGTH = 0.45;
/** Rest angle of the neck, measured off straight up the screen. */
const NECK_REST_ANGLE = deg(17);
const NECK_ROOT_HALF_WIDTH = 0.082;
const NECK_TIP_HALF_WIDTH = 0.036;
const NECK_SEGMENTS = 7;

const HEAD_LENGTH = 0.125;
const HEAD_DEPTH = 0.058;

const EAR_LENGTH = 0.105;
const EAR_HALF_WIDTH = 0.021;

/**
 * Segment lengths of the profile legs, hip/shoulder → mid joint → foot.
 *
 * The roots sit low in the barrel, not at its centre: a leg rooted at the body's
 * middle draws its whole upper segment straight across the flank, and the tube
 * that produces reads as a plank nailed to the animal. Rooted here, only the top
 * of the femur overlaps, which is what the join actually looks like.
 */
const SHOULDER_X = 0.115;
const SHOULDER_Y = 0.045;
const HIP_X = -0.155;
const HIP_Y = 0.035;

const FORE_UPPER = 0.17;
const FORE_LOWER = 0.235;
const HIND_UPPER = 0.17;
const HIND_LOWER = 0.25;

const TAIL_LENGTH = 0.1;

// ── Coat layouts ─────────────────────────────────────────────────────────────

/**
 * The counter-shading, expressed once and reused by every view: a dark saddle
 * over the spine, warm fawn flanks, and a pale cream underline. At tile size
 * this tonal split does more work than any amount of drawn detail.
 */
const BODY_BLOBS: readonly CoatBlob[] = [
  { x: -0.01, y: -0.095, rx: 0.245, ry: 0.07, tone: 'saddle', seed: 1.3 },
  { x: 0.01, y: 0.105, rx: 0.17, ry: 0.045, tone: 'cream', seed: 4.1 },
];

const NECK_BLOBS: readonly CoatBlob[] = [
  { x: -0.042, y: 0.0, rx: 0.038, ry: 0.26, tone: 'saddle', seed: 2.7 },
  { x: 0.05, y: 0.06, rx: 0.017, ry: 0.16, tone: 'cream', seed: 8.2 },
];

const HEAD_BLOBS: readonly CoatBlob[] = [
  { x: -0.01, y: -0.028, rx: 0.055, ry: 0.028, tone: 'saddle', seed: 3.9 },
  { x: 0.05, y: 0.014, rx: 0.032, ry: 0.022, tone: 'soot', seed: 6.6 },
];

const RUMP_BLOBS: readonly CoatBlob[] = [
  { x: -0.01, y: -0.06, rx: 0.12, ry: 0.055, tone: 'saddle', seed: 7.7 },
  { x: 0.0, y: 0.075, rx: 0.085, ry: 0.04, tone: 'cream', seed: 3.1 },
];

// ── Face ─────────────────────────────────────────────────────────────────────

/**
 * A llama's eye is very large, very dark and set well out on the side of the
 * skull. The amber here is the animal's one standing heat cue and is kept to a
 * ring around the pupil: a fully amber eye at 32 px reads as a lamp bolted to
 * the head rather than as an eye.
 */
const EYE_INK = '#0d0806';
const EYE_AMBER = '#b8631d';
const EYE_GLINT = '#fff6e2';
const LASH_INK = '#171009';
const NOSTRIL_INK = '#160f0b';
const LIP_DUSK = '#4a352a';
const GUM_DARK = '#3a1d1a';
const TOOTH_IVORY = '#e8dcc0';
const EMBER_HOT = '#ff9b2e';
const EMBER_CORE = '#ffe9a8';

const EYE_RX = 0.016;
const EYE_RY = 0.014;
const LASH_COUNT = 4;
const LASH_LENGTH = 0.015;

/**
 * Ears are the second-strongest cue after the neck: long, narrow, and curving
 * *toward each other* rather than standing parallel. A llama with straight ears
 * reads as a deer, and one with round ears reads as a donkey.
 */
const EAR_INWARD_CURL = deg(26);
const EAR_PINNED_ANGLE = deg(112);
const EAR_PRICKED_ANGLE = deg(-16);
const EAR_INNER_ALPHA = 0.42;

/**
 * One ear, rooted at the origin and growing up the -Y axis before `side` and
 * the pose rotate it. `side` is +1 for the ear on the viewer's right.
 */
function drawEar(ctx: Ctx, side: number, prick: number, shade: number, seed: number): void {
  const swing = lerp(EAR_PINNED_ANGLE, EAR_PRICKED_ANGLE, clamp01((prick + 1) / 2));
  ctx.save();
  ctx.rotate(side * (swing + EAR_INWARD_CURL));
  const outline = ovalOutline(
    0,
    -EAR_LENGTH / 2,
    EAR_HALF_WIDTH,
    EAR_LENGTH / 2,
    0,
    seed,
    0.09,
    26,
  );
  paintWool(ctx, {
    outline,
    blobs: [{ x: 0, y: -EAR_LENGTH * 0.85, rx: EAR_HALF_WIDTH, ry: 0.03, tone: 'soot', seed }],
    base: 'flank',
    seed,
    fringe: 0.009,
    strokes: 14,
    strokeLen: 0.018,
    flowFrom: { x: 0, y: 0.05 },
    shade,
    crimp: 0.45,
  });
  // The inner ear is a slot, not a cup: llamas carry their ears nearly edge-on
  // to the viewer, so a painted bowl inside one reads as a hole in the head.
  ctx.beginPath();
  ctx.ellipse(0, -EAR_LENGTH * 0.5, EAR_HALF_WIDTH * 0.4, EAR_LENGTH * 0.34, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(LIP_DUSK, EAR_INNER_ALPHA);
  ctx.fill();
  ctx.restore();
}

const TOPKNOT_RX = 0.042;
const TOPKNOT_RY = 0.03;

/**
 * The tuft of longer wool that sits on the forehead between the ears.
 *
 * Small, and doing a disproportionate amount of work: without it the skull runs
 * smoothly into the ears and the head reads as a deer's. The topknot is the
 * thing that says the animal is a fleece-bearing domestic camelid.
 */
function drawTopknot(ctx: Ctx, x: number, y: number, shade: number, seed: number): void {
  paintWool(ctx, {
    outline: ovalOutline(x, y, TOPKNOT_RX, TOPKNOT_RY, 0, seed, 0.14, 22),
    blobs: [],
    base: 'flank',
    seed,
    fringe: 0.018,
    strokes: 16,
    strokeLen: 0.02,
    flowFrom: { x, y: y + 0.05 },
    shade,
    contour: 0.4,
    crimp: 1,
  });
}

/** The eye, with the long lashes that are half of what makes a llama's face. */
function drawEye(ctx: Ctx, x: number, y: number, open: number, glow: number): void {
  const lidOpen = clamp01(open);
  const ry = EYE_RY * lidOpen;
  if (ry <= MIN_RADIUS) {
    ctx.beginPath();
    ctx.moveTo(x - EYE_RX, y);
    ctx.lineTo(x + EYE_RX, y);
    ctx.strokeStyle = LASH_INK;
    ctx.lineWidth = 0.008;
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX, ry, 0, 0, TWO_PI);
  ctx.fillStyle = mix(EYE_INK, EYE_AMBER, clamp01(glow) * 0.55);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX * 0.52, ry * 0.52, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_INK;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x - EYE_RX * 0.3, y - ry * 0.34, EYE_RX * 0.24, ry * 0.24, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(EYE_GLINT, 0.9);
  ctx.fill();

  ctx.strokeStyle = LASH_INK;
  ctx.lineWidth = 0.007;
  ctx.lineCap = 'round';
  for (let i = 0; i < LASH_COUNT; i++) {
    const t = (i + 0.5) / LASH_COUNT;
    const angle = lerp(deg(-150), deg(-30), t);
    const rootX = x + Math.cos(angle) * EYE_RX;
    const rootY = y + Math.sin(angle) * ry;
    const length = LASH_LENGTH * lidOpen;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.lineTo(
      rootX + Math.cos(angle - deg(14)) * length,
      rootY + Math.sin(angle - deg(14)) * length,
    );
    ctx.stroke();
  }
}

/**
 * The muzzle: a blunt soot-dark nose pad, two comma nostrils, and the split
 * upper lip. The split lip is the cue that separates a camelid from every other
 * long-faced herbivore, so it is drawn as an actual gap rather than a line.
 */
function drawMuzzle(ctx: Ctx, x: number, y: number, curl: number, jaw: number, glow: number): void {
  const NOSE_RX = 0.026;
  const NOSE_RY = 0.019;
  ctx.beginPath();
  ctx.ellipse(x, y, NOSE_RX, NOSE_RY, 0, 0, TWO_PI);
  ctx.fillStyle = mix('#2a201a', '#4a3a30', 0.4);
  ctx.fill();

  const NOSTRIL_RX = 0.011;
  const NOSTRIL_RY = 0.008;
  ctx.beginPath();
  ctx.ellipse(x + NOSE_RX * 0.25, y - NOSE_RY * 0.3, NOSTRIL_RX, NOSTRIL_RY, deg(-30), 0, TWO_PI);
  ctx.fillStyle = NOSTRIL_INK;
  ctx.fill();

  // The lip splits and peels upward as it curls; the gap between the halves is
  // the whole cue, so it opens with the curl rather than staying a fixed line.
  const split = 0.006 + curl * 0.016;
  const lipY = y + NOSE_RY * 0.72;
  const drop = jaw * 0.03;
  ctx.strokeStyle = LIP_DUSK;
  ctx.lineWidth = 0.009;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - NOSE_RX * 0.5, lipY - curl * 0.012);
  ctx.lineTo(x - split, lipY + drop * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + NOSE_RX * 0.7, lipY - curl * 0.016);
  ctx.lineTo(x + split, lipY + drop * 0.3);
  ctx.stroke();

  if (jaw > 0.02) {
    ctx.beginPath();
    ctx.ellipse(x + NOSE_RX * 0.1, lipY + drop * 0.6, NOSE_RX * 0.62, drop + 0.006, 0, 0, TWO_PI);
    ctx.fillStyle = mix(GUM_DARK, EMBER_HOT, clamp01(glow) * 0.7);
    ctx.fill();
  }
  if (curl > 0.25) {
    ctx.beginPath();
    ctx.rect(x - NOSE_RX * 0.35, lipY - 0.004, NOSE_RX * 0.7, 0.011 * curl);
    ctx.fillStyle = rgba(TOOTH_IVORY, curl);
    ctx.fill();
  }
}

// ── Legs and feet ────────────────────────────────────────────────────────────

/**
 * A joint that is exactly straight has an undefined bend direction and snaps
 * between the two as the foot crosses the threshold.
 */
const JOINT_LOCK_MARGIN = 0.001;

/** Two-bone solve; `bend` picks which side the joint breaks toward. */
function solveJoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  l1: number,
  l2: number,
  bend: number,
): Pt {
  const dx = bx - ax;
  const dy = by - ay;
  const reach = Math.min(Math.hypot(dx, dy), l1 + l2 - JOINT_LOCK_MARGIN);
  const dist = Math.max(MIN_RADIUS, reach);
  const base = Math.atan2(dy, dx);
  const cosA = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist * l1);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const jointAngle = base + angle * bend;
  return { x: ax + Math.cos(jointAngle) * l1, y: ay + Math.sin(jointAngle) * l1 };
}

const LEG_UPPER_HALF_WIDTH = 0.038;
const LEG_LOWER_HALF_WIDTH = 0.019;
/** Lighter than the body's: a full-strength line on a 5 px cannon reads as a stick. */
const LEG_CONTOUR = 0.5;
/** Fleece stops well above the knee; below it the leg is short-haired. */
const LEG_UPPER_FRINGE = 0.016;
const LEG_LOWER_FRINGE = 0.004;

const TOE_LENGTH = 0.045;
const TOE_HALF_WIDTH = 0.016;
const PAD_ALPHA = 0.75;

/**
 * The two-toed foot. A llama walks on a soft pad with two forward-pointing
 * toenails, not a hoof — at tile size the readable part is that the foot is
 * *split*, so the two toes are drawn as separate shapes with a gap between.
 */
function drawFoot(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  splay: number,
  shade: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const spread = lerp(0.006, 0.016, clamp01(splay));
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * spread, 0);
    ctx.rotate(side * deg(9) * splay);
    ctx.beginPath();
    ctx.ellipse(0, TOE_LENGTH * 0.3, TOE_HALF_WIDTH, TOE_LENGTH * 0.55, 0, 0, TWO_PI);
    ctx.fillStyle = shadeTone('soot', shade + 0.2, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, TOE_LENGTH * 0.62, TOE_HALF_WIDTH * 1.9, TOE_LENGTH * 0.26, 0, 0, TWO_PI);
  ctx.fillStyle = rgba('#241a15', PAD_ALPHA);
  ctx.fill();
  ctx.restore();
}

/**
 * A fleeced two-segment leg ending in a two-toed foot.
 *
 * `bend` must be +1 for a foreleg and -1 for a hind leg (or the mirror of that
 * when the view is flipped): a quadruped whose hocks break the same way as its
 * knees is the single most obvious anatomy error available here, and it is
 * invisible in a still of a standing pose.
 *
 * @param limbId stable identity for this limb, used to seed its fleece. It must
 * not be derived from the pose — seeded off a live coordinate, a stepping limb
 * reshuffles every fibre each frame while a planted one holds still, and the
 * pair visibly behaves differently for no reason.
 */
function drawLeg(
  ctx: Ctx,
  limbId: number,
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number,
  shade: number,
  splay: number,
): void {
  const joint = solveJoint(hipX, hipY, footX, footY, upper, lower, bend);
  // The lower leg is *graded* into its dark points rather than painted soot
  // outright: a cannon filled with a flat near-black loses its own contour and
  // the leg stops reading as a limb and starts reading as a drawn line.
  const segments: ReadonlyArray<readonly [Pt, Pt, number, number, readonly CoatBlob[]]> = [
    [{ x: hipX, y: hipY }, joint, LEG_UPPER_HALF_WIDTH, LEG_UPPER_FRINGE, []],
    [
      joint,
      { x: footX, y: footY },
      LEG_LOWER_HALF_WIDTH,
      LEG_LOWER_FRINGE,
      [
        {
          x: 0,
          y: lower * 0.85,
          rx: LEG_LOWER_HALF_WIDTH * 1.4,
          ry: lower * 0.45,
          tone: 'soot',
          seed: 2.4 + limbId,
        },
      ],
    ],
  ];
  segments.forEach(([a, b, halfWidth, fringe, blobs], index) => {
    const isUpper = index === 0;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle - HALF_PI);
    paintWool(ctx, {
      outline: ovalOutline(0, len / 2, halfWidth, len / 2 + 0.01, 0, 15.5 + limbId * 3, 0.06, 22),
      blobs,
      base: 'flank',
      seed: 121 + limbId * 7 + halfWidth * 100,
      fringe,
      strokes: 18,
      strokeLen: 0.022,
      flowFrom: { x: 0, y: -0.12 },
      shade,
      // The upper segment is mostly buried in the barrel, and a contour drawn
      // round the buried part outlines a limb that should not be visible as a
      // limb at all — the near pair comes out looking bolted to the flank.
      contour: isUpper ? 0 : LEG_CONTOUR,
      crimp: 0.5,
    });
    ctx.restore();
  });
  const footAngle = Math.atan2(footY - joint.y, footX - joint.x) - HALF_PI;
  drawFoot(ctx, footX, footY, footAngle, splay, shade);
}

const FRONT_LEG_HALF_WIDTH = 0.033;
/** How far up inside the body a head-on leg roots, as a fraction of its length. */
const FRONT_LEG_ROOT_RISE = 0.4;

/**
 * The fleeced column between the body and a foot, for the head-on views.
 *
 * Seen end-on a llama's leg is a foreshortened post with the knee hidden behind
 * the cannon, so this is one tapered segment rather than the two-bone solve the
 * profile uses. Without it the feet read as detached specks on the floor.
 */
function drawFrontLeg(
  ctx: Ctx,
  limbId: number,
  rootX: number,
  rootY: number,
  footX: number,
  footY: number,
  shade: number,
  splay: number,
): void {
  const dx = footX - rootX;
  const dy = footY - rootY;
  const length = Math.hypot(dx, dy);
  if (length <= MIN_RADIUS) return;

  ctx.save();
  ctx.translate(rootX, rootY);
  ctx.rotate(Math.atan2(dy, dx) - HALF_PI);
  paintWool(ctx, {
    outline: ovalOutline(
      0,
      length / 2,
      FRONT_LEG_HALF_WIDTH,
      length / 2 + FRONT_LEG_HALF_WIDTH,
      0,
      19.7 + limbId * 5,
      0.06,
      22,
    ),
    blobs: [
      {
        x: 0,
        y: length * 0.78,
        rx: FRONT_LEG_HALF_WIDTH,
        ry: length * 0.3,
        tone: 'soot',
        seed: 4.4 + limbId,
      },
    ],
    base: 'flank',
    seed: 61 + limbId * 11,
    fringe: LEG_UPPER_FRINGE * 0.7,
    strokes: 20,
    strokeLen: 0.024,
    flowFrom: { x: 0, y: -length * FRONT_LEG_ROOT_RISE },
    shade,
    contour: LEG_CONTOUR,
    crimp: 0.55,
  });
  ctx.restore();
  drawFoot(ctx, footX, footY, 0, splay, shade);
}

// ── Neck ─────────────────────────────────────────────────────────────────────

interface NeckShape {
  /** Centre-line samples from the withers up to the base of the skull. */
  readonly spine: readonly Pt[];
  /** Direction the skull leaves the neck, in radians. */
  readonly tipAngle: number;
}

/**
 * Samples the neck's centre line.
 *
 * The neck is drawn as a swept centre line rather than as stacked ellipses
 * because its silhouette is the animal: a llama carries it in a shallow S that
 * straightens as the head comes up, and a segmented neck visibly kinks at every
 * joint the moment it moves.
 */
function neckShape(p: LlamaPose, rootX: number, rootY: number, direction: number): NeckShape {
  const length = NECK_LENGTH * (1 - p.neckCompress * 0.18);
  const spine: Pt[] = [];
  let x = rootX;
  let y = rootY;
  // Angles are measured off straight up the screen, so a zero-curve neck stands
  // vertical and the whole pose vocabulary reads as "lean" and "bend".
  const baseAngle = -HALF_PI + direction * (NECK_REST_ANGLE + p.neckLean);
  for (let i = 0; i <= NECK_SEGMENTS; i++) {
    spine.push({ x, y });
    if (i === NECK_SEGMENTS) break;
    const t = i / NECK_SEGMENTS;
    // Curvature is front-loaded: a llama bends at the base of the neck and
    // carries the top third almost straight, which is what gives the S its kink.
    const bend = direction * p.neckCurve * (1 - t) * 1.4;
    const angle = baseAngle + bend;
    const step = length / NECK_SEGMENTS;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
  }
  const last = spine[spine.length - 1];
  const prev = spine[spine.length - 2];
  return { spine, tipAngle: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

/** Builds the closed silhouette of a neck by offsetting its centre line. */
function neckOutline(shape: NeckShape): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const { spine } = shape;
  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    const halfWidth = lerp(NECK_ROOT_HALF_WIDTH, NECK_TIP_HALF_WIDTH, easeInOut(t));
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const nx = Math.cos(angle - HALF_PI);
    const ny = Math.sin(angle - HALF_PI);
    left.push({ x: spine[i].x + nx * halfWidth, y: spine[i].y + ny * halfWidth });
    right.push({ x: spine[i].x - nx * halfWidth, y: spine[i].y - ny * halfWidth });
  }
  return [...left, ...right.reverse()];
}

/** How far up the neck a charge has travelled, as a 0–1 position on the spine. */
const CHARGE_TRAVEL_START = 0.15;
const CHARGE_BULGE_RADIUS = 0.05;

/**
 * The ember glow of a charge working up the throat.
 *
 * Drawn as a soft blob riding the neck's centre line rather than as a gradient
 * over the whole neck: the point of the cue is that the player can see *where*
 * the charge is and therefore how long they have, and a uniform glow tells them
 * only that something is happening.
 */
function drawChargeGlow(ctx: Ctx, shape: NeckShape, charge: number): void {
  if (charge <= 0.02) return;
  const travel = CHARGE_TRAVEL_START + clamp01(charge) * (1 - CHARGE_TRAVEL_START);
  const index = Math.min(shape.spine.length - 1, Math.floor(travel * (shape.spine.length - 1)));
  const at = shape.spine[index];
  const radius = CHARGE_BULGE_RADIUS * (0.6 + charge * 0.6);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, radius, radius * 1.25, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(EMBER_HOT, 0.72 * charge);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, radius * 0.45, radius * 0.6, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(EMBER_CORE, 0.85 * charge);
  ctx.fill();
  ctx.restore();
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * The head in profile, rooted at the base of the skull and drawn along +X.
 *
 * `direction` is +1 when the animal faces screen-right. The skull is a wedge
 * that tapers to the muzzle with no forehead stop, and the topknot of longer
 * fleece between the ears is what stops it reading as a goat.
 */
function drawHeadSide(ctx: Ctx, p: LlamaPose, direction: number, shade: number): void {
  const glow = p.charge;
  ctx.save();
  ctx.scale(direction, 1);

  const outline = ovalOutline(
    HEAD_LENGTH * 0.34,
    0,
    HEAD_LENGTH * 0.62,
    HEAD_DEPTH,
    deg(6),
    5.5,
    0.07,
    30,
  );
  ctx.save();
  ctx.translate(0, -EAR_LENGTH * 0.1);
  drawEar(ctx, -1, p.earL, shade + 0.25, 31.7);
  ctx.restore();

  paintWool(ctx, {
    outline,
    blobs: HEAD_BLOBS,
    base: 'flank',
    seed: 41.3,
    fringe: 0.012,
    strokes: 30,
    strokeLen: 0.022,
    flowFrom: { x: -HEAD_LENGTH * 0.4, y: 0.02 },
    shade,
    crimp: 0.55,
  });

  drawEye(ctx, HEAD_LENGTH * 0.16, -HEAD_DEPTH * 0.22, p.eyeOpen, glow);
  drawMuzzle(ctx, HEAD_LENGTH * 0.86, HEAD_DEPTH * 0.16, p.lipCurl, p.jaw, glow);

  drawTopknot(ctx, -HEAD_LENGTH * 0.06, -HEAD_DEPTH * 0.72, shade, 17.4);

  ctx.save();
  ctx.translate(-HEAD_LENGTH * 0.04, -HEAD_DEPTH * 0.62);
  drawEar(ctx, 1, p.earR, shade, 12.9);
  ctx.restore();

  ctx.restore();
}

/**
 * The head seen head-on (`toward` true) or from behind. Both are the same
 * narrow wedge with a symmetric pair of ears; the difference is that from
 * behind there is no face, and inventing one is how a back view starts reading
 * as a front view with the legs on wrong.
 */
function drawHeadAxial(ctx: Ctx, p: LlamaPose, toward: boolean, shade: number): void {
  const HEAD_HALF_WIDTH = 0.058;
  const HEAD_AXIAL_DEPTH = 0.085;
  const glow = p.charge;

  ctx.save();
  ctx.rotate(p.headTilt);
  const spread = 0.052;
  drawEarAxial(ctx, -1, -spread, -HEAD_AXIAL_DEPTH * 0.55, p.earL, shade + 0.1, 27.1);
  drawEarAxial(ctx, 1, spread, -HEAD_AXIAL_DEPTH * 0.55, p.earR, shade + 0.1, 51.4);
  drawTopknot(ctx, 0, -HEAD_AXIAL_DEPTH * 0.72, shade, 17.4);

  paintWool(ctx, {
    outline: ovalOutline(0, 0, HEAD_HALF_WIDTH, HEAD_AXIAL_DEPTH, 0, 9.1, 0.08, 28),
    blobs: [
      {
        x: 0,
        y: -HEAD_AXIAL_DEPTH * 0.5,
        rx: HEAD_HALF_WIDTH,
        ry: 0.04,
        tone: 'saddle',
        seed: 2.2,
      },
      ...(toward
        ? [
            {
              x: 0,
              y: HEAD_AXIAL_DEPTH * 0.62,
              rx: HEAD_HALF_WIDTH * 0.7,
              ry: 0.028,
              tone: 'soot' as const,
              seed: 5.4,
            },
          ]
        : []),
    ],
    base: 'flank',
    seed: 73.9,
    fringe: 0.012,
    strokes: 26,
    strokeLen: 0.021,
    flowFrom: { x: 0, y: -HEAD_AXIAL_DEPTH },
    shade,
    crimp: 0.55,
  });

  if (toward) {
    const eyeX = HEAD_HALF_WIDTH * 0.72;
    const eyeY = -HEAD_AXIAL_DEPTH * 0.12;
    drawEye(ctx, -eyeX, eyeY, p.eyeOpen, glow);
    drawEye(ctx, eyeX, eyeY, p.eyeOpen, glow);
    drawMuzzleAxial(ctx, 0, HEAD_AXIAL_DEPTH * 0.66, p.lipCurl, p.jaw, glow);
  }
  ctx.restore();
}

/** An ear in the axial views, where both are visible and splay symmetrically. */
function drawEarAxial(
  ctx: Ctx,
  side: number,
  x: number,
  y: number,
  prick: number,
  shade: number,
  seed: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  drawEar(ctx, side, prick, shade, seed);
  ctx.restore();
}

/** The muzzle head-on: a symmetric nose pad with both nostrils and the split lip. */
function drawMuzzleAxial(
  ctx: Ctx,
  x: number,
  y: number,
  curl: number,
  jaw: number,
  glow: number,
): void {
  const NOSE_RX = 0.032;
  const NOSE_RY = 0.024;
  ctx.beginPath();
  ctx.ellipse(x, y, NOSE_RX, NOSE_RY, 0, 0, TWO_PI);
  ctx.fillStyle = mix('#2a201a', '#4a3a30', 0.4);
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x + side * NOSE_RX * 0.45,
      y - NOSE_RY * 0.2,
      0.009,
      0.007,
      side * deg(28),
      0,
      TWO_PI,
    );
    ctx.fillStyle = NOSTRIL_INK;
    ctx.fill();
  }

  const split = 0.005 + curl * 0.014;
  const lipY = y + NOSE_RY * 0.85;
  ctx.strokeStyle = LIP_DUSK;
  ctx.lineWidth = 0.008;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * NOSE_RX * 0.8, lipY - curl * 0.012);
    ctx.lineTo(x + side * split, lipY);
    ctx.stroke();
  }
  if (jaw > 0.02) {
    ctx.beginPath();
    ctx.ellipse(x, lipY + jaw * 0.016, NOSE_RX * 0.55, jaw * 0.026 + 0.005, 0, 0, TWO_PI);
    ctx.fillStyle = mix(GUM_DARK, EMBER_HOT, clamp01(glow) * 0.7);
    ctx.fill();
  }
}

// ── Tail ─────────────────────────────────────────────────────────────────────

/**
 * The tail: short, carried out and slightly up, with a tuft at the tip. It is
 * the one place a llama looks nothing like a horse, so it stays stubby however
 * much a longer one would animate better.
 */
function drawTail(ctx: Ctx, x: number, y: number, lift: number, sway: number, shade: number): void {
  const angle = deg(150) - lift * deg(55);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + sway * deg(12));
  paintWool(ctx, {
    outline: ovalOutline(TAIL_LENGTH * 0.45, 0, TAIL_LENGTH * 0.55, 0.03, 0, 88.2, 0.1, 20),
    blobs: [],
    base: 'saddle',
    seed: 88.2,
    fringe: 0.016,
    strokes: 12,
    strokeLen: 0.024,
    flowFrom: { x: -0.04, y: 0 },
    shade,
    crimp: 0.75,
  });
  ctx.restore();
}

// ── Views ────────────────────────────────────────────────────────────────────

/** Bend signs for a profile facing +X: knees break forward, hocks backward. */
const FORE_BEND = 1;
const HIND_BEND = -1;
/**
 * How far the near and far leg of a pair are offset from each other in profile.
 * Small enough and the far pair hides behind the near pair entirely, and the
 * animal appears to be standing on two legs.
 */
const SIDE_LEG_SPREAD = 0.038;
/** How much darker the far-side pair of legs is drawn than the near pair. */
const FAR_SIDE_SHADE = 0.45;
const BREATHE_DEPTH = 0.008;

interface BodyAnchor {
  readonly cx: number;
  readonly cy: number;
}

/** The whole-body transform every view opens with. */
function bodyAnchor(p: LlamaPose): BodyAnchor {
  return {
    cx: p.sway + p.lunge,
    cy: p.bob + p.breathe * BREATHE_DEPTH,
  };
}

/**
 * The profile view, facing +X.
 *
 * Draw order is far legs → barrel → near legs → neck → head, which is the only
 * order in which the near pair reads as being on this side of the animal.
 */
export function drawLlamaSide(ctx: Ctx, p: LlamaPose): void {
  const anchor = bodyAnchor(p);
  drawGroundShadow(ctx, anchor.cx - 0.03, GROUND_Y + 0.03, 0.3 * p.shadow, 0.055 * p.shadow);

  ctx.save();
  ctx.translate(anchor.cx, anchor.cy);
  ctx.rotate(p.lean);
  ctx.scale(1, p.squash);

  const floor = (foot: FootPose): number => GROUND_Y + foot.dy - anchor.cy;

  drawLeg(
    ctx,
    0,
    HIP_X - SIDE_LEG_SPREAD,
    HIP_Y,
    HIP_X - SIDE_LEG_SPREAD + p.hindL.dx,
    floor(p.hindL),
    HIND_UPPER,
    HIND_LOWER,
    HIND_BEND,
    FAR_SIDE_SHADE,
    p.hindL.splay,
  );
  drawLeg(
    ctx,
    1,
    SHOULDER_X - SIDE_LEG_SPREAD,
    SHOULDER_Y,
    SHOULDER_X - SIDE_LEG_SPREAD + p.frontL.dx,
    floor(p.frontL),
    FORE_UPPER,
    FORE_LOWER,
    FORE_BEND,
    FAR_SIDE_SHADE,
    p.frontL.splay,
  );

  drawTail(ctx, RUMP_X - 0.09, RUMP_Y - 0.05, p.tailLift, p.tailSway, 0.2);

  // The haunch overlaps the barrel heavily on purpose. Drawn as a separate mass
  // clear of it, the two read as a lump sitting behind a lump; overlapped, the
  // pair reads as one deep body with a rounded quarter, which is the shape a
  // llama actually has.
  paintWool(ctx, {
    outline: ovalOutline(RUMP_X, RUMP_Y + 0.015, 0.125, 0.115, deg(-8), 63.1, 0.07, 30),
    blobs: RUMP_BLOBS,
    base: 'flank',
    seed: 63.1,
    fringe: 0.02,
    strokes: 38,
    strokeLen: 0.026,
    flowFrom: { x: RUMP_X, y: RUMP_Y - 0.14 },
    shade: 0.08,
  });

  // The neck is painted *before* the barrel and rooted deep inside it. Laid on
  // top, its root terminates in a straight edge across the shoulder — a step
  // that no amount of contour softening hides, and the single thing that most
  // makes a long-necked quadruped read as assembled from parts.
  const neck = neckShape(p, WITHERS_X, WITHERS_Y, 1);
  paintWool(ctx, {
    outline: neckOutline(neck),
    blobs: NECK_BLOBS.map((b) => ({
      ...b,
      x: b.x + WITHERS_X,
      y: b.y + WITHERS_Y - NECK_LENGTH * 0.5,
    })),
    base: 'flank',
    seed: 34.6,
    fringe: 0.017,
    strokes: 52,
    strokeLen: 0.024,
    flowFrom: { x: WITHERS_X - 0.1, y: WITHERS_Y - NECK_LENGTH },
  });

  paintWool(ctx, {
    outline: barrelOutline(BODY_CX, BODY_CY, BODY_RX, BODY_RY, 21.7),
    blobs: BODY_BLOBS,
    base: 'flank',
    seed: 21.7,
    fringe: 0.022,
    strokes: 78,
    strokeLen: 0.028,
    flowFrom: { x: BODY_CX, y: BODY_CY - 0.22 },
  });

  drawLeg(
    ctx,
    2,
    HIP_X + SIDE_LEG_SPREAD,
    HIP_Y,
    HIP_X + SIDE_LEG_SPREAD + p.hindR.dx,
    floor(p.hindR),
    HIND_UPPER,
    HIND_LOWER,
    HIND_BEND,
    0,
    p.hindR.splay,
  );
  drawLeg(
    ctx,
    3,
    SHOULDER_X + SIDE_LEG_SPREAD,
    SHOULDER_Y,
    SHOULDER_X + SIDE_LEG_SPREAD + p.frontR.dx,
    floor(p.frontR),
    FORE_UPPER,
    FORE_LOWER,
    FORE_BEND,
    0,
    p.frontR.splay,
  );

  drawChargeGlow(ctx, neck, p.charge);

  const tip = neck.spine[neck.spine.length - 1];
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(neck.tipAngle + HALF_PI + p.headPitch);
  drawHeadSide(ctx, p, 1, 0);
  ctx.restore();

  ctx.restore();
}

/** Feet that show in an axial view, as offsets from the body centre line. */
const AXIAL_FORE_TRACK = 0.062;
const AXIAL_HIND_TRACK = 0.085;
const AXIAL_BODY_HALF_WIDTH = 0.135;
const AXIAL_BODY_DEPTH = 0.15;

/**
 * The head-on and rear views.
 *
 * They share a painter because a llama is near enough symmetric front to back
 * at this size that two separate ones would drift apart for no benefit: what
 * actually differs is which leg pair leads, whether a face is drawn, and
 * whether the tail sits in front of the rump.
 */
function drawLlamaAxial(ctx: Ctx, p: LlamaPose, toward: boolean): void {
  const anchor = bodyAnchor(p);
  drawGroundShadow(ctx, anchor.cx, GROUND_Y + 0.03, 0.17 * p.shadow, 0.05 * p.shadow);

  ctx.save();
  ctx.translate(anchor.cx, anchor.cy);
  ctx.rotate(p.lean);
  ctx.scale(1, p.squash);

  const trailing = toward ? [p.hindL, p.hindR] : [p.frontL, p.frontR];
  const leading = toward ? [p.frontL, p.frontR] : [p.hindL, p.hindR];
  const trailingTrack = toward ? AXIAL_HIND_TRACK : AXIAL_FORE_TRACK;
  const leadingTrack = toward ? AXIAL_FORE_TRACK : AXIAL_HIND_TRACK;

  trailing.forEach((foot, index) => {
    const side = index === 0 ? -1 : 1;
    const footX = side * trailingTrack + foot.dx;
    drawFrontLeg(
      ctx,
      10 + index,
      side * trailingTrack * 0.6,
      0.02,
      footX,
      GROUND_Y + foot.dy - anchor.cy,
      FAR_SIDE_SHADE,
      foot.splay,
    );
  });

  if (!toward) {
    drawTail(ctx, 0.0, -AXIAL_BODY_DEPTH * 0.5, p.tailLift, p.tailSway, 0.1);
  }

  paintWool(ctx, {
    outline: ovalOutline(0, BODY_CY, AXIAL_BODY_HALF_WIDTH, AXIAL_BODY_DEPTH, 0, 44.8, 0.07, 36),
    blobs: [
      {
        x: 0,
        y: -AXIAL_BODY_DEPTH * 0.55,
        rx: AXIAL_BODY_HALF_WIDTH,
        ry: 0.07,
        tone: 'saddle',
        seed: 1.9,
      },
      {
        x: 0,
        y: AXIAL_BODY_DEPTH * 0.6,
        rx: AXIAL_BODY_HALF_WIDTH * 0.7,
        ry: 0.05,
        tone: 'cream',
        seed: 6.1,
      },
    ],
    base: 'flank',
    seed: 44.8,
    fringe: 0.022,
    strokes: 66,
    strokeLen: 0.032,
    flowFrom: { x: 0, y: BODY_CY - 0.22 },
  });

  leading.forEach((foot, index) => {
    const side = index === 0 ? -1 : 1;
    const footX = side * leadingTrack + foot.dx;
    drawFrontLeg(
      ctx,
      20 + index,
      side * leadingTrack * 0.7,
      0.0,
      footX,
      GROUND_Y + foot.dy - anchor.cy,
      0,
      foot.splay,
    );
  });

  const neck = neckShape(p, 0, WITHERS_Y - 0.02, 0);
  paintWool(ctx, {
    outline: neckOutline(neck),
    blobs: [
      {
        x: 0,
        y: WITHERS_Y - NECK_LENGTH * 0.5,
        rx: 0.03,
        ry: NECK_LENGTH * 0.45,
        tone: toward ? 'cream' : 'saddle',
        seed: 5.8,
      },
    ],
    base: 'flank',
    seed: 57.2,
    fringe: 0.017,
    strokes: 46,
    strokeLen: 0.028,
    flowFrom: { x: 0, y: WITHERS_Y - NECK_LENGTH },
  });
  drawChargeGlow(ctx, neck, p.charge);

  const tip = neck.spine[neck.spine.length - 1];
  ctx.save();
  ctx.translate(tip.x + p.headTurn * 0.02, tip.y);
  ctx.rotate(p.headPitch * 0.4);
  drawHeadAxial(ctx, p, toward, 0);
  ctx.restore();

  ctx.restore();
}

/** Facing the camera. */
export function drawLlamaFront(ctx: Ctx, p: LlamaPose): void {
  drawLlamaAxial(ctx, p, true);
}

/** Walking away from the camera. */
export function drawLlamaBack(ctx: Ctx, p: LlamaPose): void {
  drawLlamaAxial(ctx, p, false);
}
