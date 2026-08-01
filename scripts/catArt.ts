/**
 * The painter library behind Donut's sprite sheet.
 *
 * She is a long-haired tortoiseshell — a brindled black-and-ginger coat with a
 * cream bib, cream socks and a split face — and she is comfortably chubby, so
 * the silhouette is built from overlapping ovals rather than one clean body
 * shape: a low round barrel, a heavy rump, a deep chest ruff and cheek ruffs
 * that break the head outline. Every shape is painted by the same fur engine:
 * a wobbled outline, a fringe of tufts poking past it, tortie patches painted
 * inside a clip, then a few hundred individual hair strokes that take their
 * colour from whichever patch they start in, which is what softens the patch
 * borders into the brindled mottling a real tortie has.
 *
 * All three viewpoints (toward the camera, away, and profile) share the fur
 * engine, the palette and the pose struct; only the anatomy differs.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen.  The profile view faces +X; the runtime mirrors it.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Small math ───────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

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

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

// ── Coat ─────────────────────────────────────────────────────────────────────

export type CoatTone = 'black' | 'ginger' | 'cream';

interface ToneColors {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
}

/**
 * Tortie black is a warm charcoal, never pure black — pure black flattens into
 * a hole at the 32px in-game size and kills the fur texture.
 */
const COAT: Record<CoatTone, ToneColors> = {
  black: { base: '#342c27', dark: '#181310', light: '#5f5045' },
  ginger: { base: '#a95d22', dark: '#6b3611', light: '#e0943f' },
  cream: { base: '#e9d8bc', dark: '#b39a76', light: '#fdf4e4' },
};

const RIM_LIGHT = '#c8d8ff';
const SHADOW_INK = '#0d0a08';

/** A tortoiseshell patch: a wobbled ellipse of one coat tone. */
export interface CoatBlob {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tone: CoatTone;
  readonly seed: number;
}

const BLOB_MOTTLE_MAJOR = 0.19;
const BLOB_MOTTLE_MINOR = 0.11;
const BLOB_MOTTLE_MAJOR_LOBES = 3;
const BLOB_MOTTLE_MINOR_LOBES = 7;
const BLOB_STEPS = 36;

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
  const reach = Math.hypot(dx / blob.rx, dy / blob.ry);
  return reach < blobRadiusFactor(blob, angle);
}

/** Which tone a point lands on. Later patches paint over earlier ones. */
export function toneAt(blobs: readonly CoatBlob[], base: CoatTone, x: number, y: number): CoatTone {
  let tone = base;
  for (const blob of blobs) {
    if (blobContains(blob, x, y)) tone = blob.tone;
  }
  return tone;
}

function fillBlob(ctx: Ctx, blob: CoatBlob): void {
  ctx.beginPath();
  for (let i = 0; i <= BLOB_STEPS; i++) {
    const angle = (i / BLOB_STEPS) * TWO_PI;
    const factor = blobRadiusFactor(blob, angle);
    const px = blob.x + Math.cos(angle) * blob.rx * factor;
    const py = blob.y + Math.sin(angle) * blob.ry * factor;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = COAT[blob.tone].base;
  ctx.fill();
}

// ── Outlines ─────────────────────────────────────────────────────────────────

const OUTLINE_STEPS = 48;
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

// ── Fur engine ───────────────────────────────────────────────────────────────

/** One paintable clump of fur: a silhouette plus the coat that fills it. */
export interface FurPart {
  readonly outline: readonly Pt[];
  readonly blobs: readonly CoatBlob[];
  readonly base: CoatTone;
  readonly seed: number;
  /** Length of the tufts that break the silhouette, in tile units. */
  readonly fringe: number;
  readonly strokes: number;
  readonly strokeLen: number;
  /** Hairs lie away from this point, the way a coat lies away from the spine. */
  readonly flowFrom: Pt;
  /** Direction the key light comes from, as a unit-ish vector. */
  readonly light?: Pt;
  /** Extra darkening, for limbs and far-side parts that sit in the body's shade. */
  readonly shade?: number;
}

const DEFAULT_LIGHT: Pt = { x: -0.5, y: -0.85 };
/** Tufts are sampled between outline points too — sparse tufts read as spikes. */
const FRINGE_SUBSAMPLES = 3;
const FRINGE_MIN_SCALE = 0.15;
const FRINGE_RANGE_SCALE = 1.15;
/** Hair tapers to a point; a wide base turns the silhouette into a starburst. */
const FRINGE_HALF_WIDTH = 0.24;
const FRINGE_SPLAY = 0.7;
/** Long fur hangs, so tufts bias downhill rather than radiating evenly. */
const FRINGE_DROOP = 0.3;
const FRINGE_LENGTH_BIAS = 1.7;
const OVER_FRINGE_ALPHA = 0.45;
const OVER_FRINGE_SHARE = 0.45;
const OVER_FRINGE_LENGTH = 0.75;
const FUR_STROKE_ATTEMPT_LIMIT = 4;
const FUR_STROKE_WIDTH = 0.008;
const FUR_STROKE_CURL = 0.35;
const FUR_UNDERCOAT_ALPHA = 0.45;
const FUR_GUARD_ALPHA = 0.7;
const HIGHLIGHT_ALPHA = 0.16;
const OCCLUSION_ALPHA = 0.34;
const OCCLUSION_INNER_STOP = 0.5;
const RIM_ALPHA = 0.3;
const RIM_WIDTH = 0.012;

/**
 * Tufts poking past the silhouette. `over` hairs are drawn after the fill at
 * partial alpha so the edge dissolves instead of ending in a hard line.
 */
function drawFringe(ctx: Ctx, part: FurPart, over: boolean): void {
  if (part.fringe <= 0) return;
  const centre = centroidOf(part.outline);
  const count = part.outline.length;
  const total = count * FRINGE_SUBSAMPLES;
  ctx.save();
  if (over) ctx.globalAlpha = OVER_FRINGE_ALPHA;
  for (let i = 0; i < total; i++) {
    const index = Math.floor(i / FRINGE_SUBSAMPLES);
    const blend = (i % FRINGE_SUBSAMPLES) / FRINGE_SUBSAMPLES;
    const a = part.outline[index];
    const b = part.outline[(index + 1) % count];
    const p: Pt = { x: lerp(a.x, b.x, blend), y: lerp(a.y, b.y, blend) };

    const roll = hash2(part.seed + i, i * 3.7);
    if (over && roll > OVER_FRINGE_SHARE) continue;
    const nx = p.x - centre.x;
    const ny = p.y - centre.y;
    const len = Math.hypot(nx, ny) || 1;
    let ux = nx / len;
    let uy = ny / len + FRINGE_DROOP;
    const norm = Math.hypot(ux, uy) || 1;
    ux /= norm;
    uy /= norm;

    const tuft =
      part.fringe *
      (FRINGE_MIN_SCALE + FRINGE_RANGE_SCALE * Math.pow(roll, FRINGE_LENGTH_BIAS)) *
      (over ? OVER_FRINGE_LENGTH : 1);
    const splay = (hash2(i, part.seed) - 0.5) * FRINGE_SPLAY;
    const tipX = p.x + (ux * Math.cos(splay) - uy * Math.sin(splay)) * tuft;
    const tipY = p.y + (ux * Math.sin(splay) + uy * Math.cos(splay)) * tuft;
    const halfW = Math.max(tuft, part.fringe * 0.5) * FRINGE_HALF_WIDTH;
    const tone = toneAt(part.blobs, part.base, p.x - ux * tuft, p.y - uy * tuft);
    const shade = part.shade ?? 0;
    ctx.fillStyle = mix(
      mix(COAT[tone].base, COAT[tone].dark, 0.15 + 0.3 * roll),
      SHADOW_INK,
      shade,
    );
    ctx.beginPath();
    ctx.moveTo(p.x - uy * halfW - ux * halfW, p.y + ux * halfW - uy * halfW);
    ctx.quadraticCurveTo(p.x + ux * tuft * 0.4, p.y + uy * tuft * 0.4, tipX, tipY);
    ctx.quadraticCurveTo(
      p.x + ux * tuft * 0.4,
      p.y + uy * tuft * 0.4,
      p.x + uy * halfW - ux * halfW,
      p.y - ux * halfW - uy * halfW,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFurStrokes(ctx: Ctx, part: FurPart): void {
  const bounds = boundsOf(part.outline);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const shade = part.shade ?? 0;
  ctx.lineCap = 'round';
  ctx.lineWidth = FUR_STROKE_WIDTH;

  for (let i = 0; i < part.strokes; i++) {
    let x = 0;
    let y = 0;
    let placed = false;
    for (let attempt = 0; attempt < FUR_STROKE_ATTEMPT_LIMIT; attempt++) {
      x = bounds.minX + hash2(part.seed + i, attempt * 2 + 1) * width;
      y = bounds.minY + hash2(part.seed - i, attempt * 2 + 7) * height;
      if (pointInPolygon(part.outline, x, y)) {
        placed = true;
        break;
      }
    }
    if (!placed) continue;

    const roll = hash2(i, part.seed + 13);
    const guard = roll > FUR_UNDERCOAT_ALPHA;
    const tone = toneAt(part.blobs, part.base, x, y);
    const colors = COAT[tone];
    const tint = guard
      ? mix(colors.base, colors.light, 0.3 + 0.55 * roll)
      : mix(colors.base, colors.dark, 0.25 + 0.5 * roll);
    ctx.strokeStyle = rgba(mix(tint, SHADOW_INK, shade), guard ? FUR_GUARD_ALPHA : 1);

    const flowAngle =
      Math.atan2(y - part.flowFrom.y, x - part.flowFrom.x) + (hash2(part.seed, i) - 0.5) * 0.9;
    const len = part.strokeLen * (0.55 + 0.8 * hash2(i * 5, part.seed));
    const curl = (hash2(i, i + part.seed) - 0.5) * FUR_STROKE_CURL;
    const midX = x + Math.cos(flowAngle) * len * 0.5 - Math.sin(flowAngle) * len * curl;
    const midY = y + Math.sin(flowAngle) * len * 0.5 + Math.cos(flowAngle) * len * curl;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(midX, midY, x + Math.cos(flowAngle) * len, y + Math.sin(flowAngle) * len);
    ctx.stroke();
  }
}

function shadeVolume(ctx: Ctx, part: FurPart): void {
  const bounds = boundsOf(part.outline);
  const centre = centroidOf(part.outline);
  const rx = (bounds.maxX - bounds.minX) / 2;
  const ry = (bounds.maxY - bounds.minY) / 2;
  const radius = Math.max(rx, ry);
  const light = part.light ?? DEFAULT_LIGHT;

  const glow = ctx.createRadialGradient(
    centre.x + light.x * rx * 0.55,
    centre.y + light.y * ry * 0.55,
    radius * 0.05,
    centre.x + light.x * rx * 0.35,
    centre.y + light.y * ry * 0.35,
    radius * 1.15,
  );
  glow.addColorStop(0, rgba('#ffffff', HIGHLIGHT_ALPHA));
  glow.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = glow;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  const occlude = ctx.createRadialGradient(
    centre.x,
    centre.y,
    radius * OCCLUSION_INNER_STOP,
    centre.x,
    centre.y,
    radius * 1.1,
  );
  occlude.addColorStop(0, rgba(SHADOW_INK, 0));
  occlude.addColorStop(1, rgba(SHADOW_INK, OCCLUSION_ALPHA));
  ctx.fillStyle = occlude;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/** Paints one clump: fringe, coat, hair strokes, volume shading, rim light. */
export function paintFur(ctx: Ctx, part: FurPart): void {
  drawFringe(ctx, part, false);

  ctx.save();
  traceOutline(ctx, part.outline);
  ctx.clip();

  const bounds = boundsOf(part.outline);
  const shade = part.shade ?? 0;
  ctx.fillStyle = mix(COAT[part.base].base, SHADOW_INK, shade);
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  for (const blob of part.blobs) fillBlob(ctx, blob);
  if (shade > 0) {
    ctx.fillStyle = rgba(SHADOW_INK, shade);
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }

  drawFurStrokes(ctx, part);
  shadeVolume(ctx, part);
  ctx.restore();

  drawFringe(ctx, part, true);

  const light = part.light ?? DEFAULT_LIGHT;
  ctx.save();
  traceOutline(ctx, part.outline);
  ctx.clip();
  const centre = centroidOf(part.outline);
  const rim = ctx.createLinearGradient(
    centre.x + light.x * 0.5,
    centre.y + light.y * 0.5,
    centre.x - light.x * 0.2,
    centre.y - light.y * 0.2,
  );
  rim.addColorStop(0, rgba(RIM_LIGHT, RIM_ALPHA * (1 - shade)));
  rim.addColorStop(1, rgba(RIM_LIGHT, 0));
  ctx.strokeStyle = rim;
  ctx.lineWidth = RIM_WIDTH;
  traceOutline(ctx, part.outline);
  ctx.stroke();
  ctx.restore();
}

// ── Shared props ─────────────────────────────────────────────────────────────

const SHADOW_ALPHA = 0.4;

export function drawGroundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, rgba(SHADOW_INK, SHADOW_ALPHA));
  grad.addColorStop(1, rgba(SHADOW_INK, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / Math.max(rx, ry));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(rx, ry), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Soft ambient occlusion where one body part sits in front of another. */
function drawContactShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, rgba(SHADOW_INK, alpha));
  grad.addColorStop(1, rgba(SHADOW_INK, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / Math.max(rx, ry));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(rx, ry), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface PawPose {
  /**
   * Offset from the paw's rest position, in tile units. This is the only thing
   * that moves a paw: `lift` describes the pose, it does not add height.
   */
  readonly dx: number;
  readonly dy: number;
  /** 0 planted, 1 fully raised — drives the toe splay and the foreshortening. */
  readonly lift: number;
  /** 0 sheathed, 1 fully extended claws. */
  readonly claw: number;
}

export interface TailPose {
  /** Direction the tail leaves the body, in radians. */
  readonly base: number;
  /** Total bend accumulated along the tail; positive curls toward the tip. */
  readonly curl: number;
  /** Amplitude of the travelling wave that makes the tail read as boneless. */
  readonly wave: number;
  readonly phase: number;
  /** 0 relaxed, 1 bottle-brushed. */
  readonly puff: number;
  /** Shifts where the tail leaves the body, so a raised tail clears the flank. */
  readonly rootX: number;
  readonly rootY: number;
  /** Extra flick applied to the last third only, the way a real tail tips. */
  readonly flick: number;
}

export interface CatPose {
  readonly bob: number;
  readonly sway: number;
  readonly lean: number;
  readonly squash: number;
  /** 0 standing, 1 sat back on the haunches. */
  readonly sit: number;
  readonly breathe: number;

  readonly headX: number;
  readonly headY: number;
  readonly headTilt: number;
  /** -1 looking to her right, +1 to her left. */
  readonly headTurn: number;
  /** 0 level, 1 nose tucked to the chest. */
  readonly headBow: number;

  /** -1 flattened back, 0 neutral, 1 pricked forward. */
  readonly earL: number;
  readonly earR: number;

  readonly eyeOpen: number;
  /** 0 slit, 1 fully dilated. */
  readonly pupil: number;
  readonly mouth: number;
  readonly tongue: number;

  readonly tail: TailPose;
  readonly frontL: PawPose;
  readonly frontR: PawPose;
  readonly hindL: PawPose;
  readonly hindR: PawPose;

  /** Progress 0→1 of the claw arc, or null when no swipe is in flight. */
  readonly slash: number | null;
  /** 0→1 charge of the missile orb held between the paws. */
  readonly cast: number;
  /** 0→1 of the release, once the orb leaves her paws. */
  readonly castRelease: number;
  /** Whole-body roll, used when she goes down. */
  readonly roll: number;
  readonly shadow: number;
  /** 0→1 celebratory motes for the level-up dance. */
  readonly sparkle: number;
  /** Phase used to animate sparkles and quivers within a held pose. */
  readonly time: number;
}

const REST_PAW: PawPose = { dx: 0, dy: 0, lift: 0, claw: 0 };

export function restPose(): CatPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    squash: 1,
    sit: 0,
    breathe: 0,
    headX: 0,
    headY: 0,
    headTilt: 0,
    headTurn: 0,
    headBow: 0,
    earL: 0,
    earR: 0,
    eyeOpen: 1,
    pupil: 0.55,
    mouth: 0,
    tongue: 0,
    tail: { base: 0, curl: 0, wave: 0, phase: 0, puff: 0, flick: 0, rootX: 0, rootY: 0 },
    frontL: REST_PAW,
    frontR: REST_PAW,
    hindL: REST_PAW,
    hindR: REST_PAW,
    slash: null,
    cast: 0,
    castRelease: 0,
    roll: 0,
    shadow: 1,
    sparkle: 0,
    time: 0,
  };
}

// ── Anatomy constants (tile units, origin = centre of the tile) ───────────────

/** Where her paws meet the floor, in tile units. */
export const GROUND_Y = 0.4;

const BODY_CY = 0.11;
const BODY_RX = 0.34;
const BODY_RY = 0.28;
const SIT_BODY_RX = 0.29;
const SIT_BODY_RY = 0.32;
const SIT_BODY_CY = 0.14;

const RUFF_CY = 0.0;
const RUFF_RX = 0.29;
const RUFF_RY = 0.155;

const HEAD_CY = -0.325;
/** How far the head sinks toward the chest at full bow — enough to reach a raised paw. */
const HEAD_BOW_DROP = 0.2;
const HEAD_RX = 0.25;
const HEAD_RY = 0.228;
const CHEEK_DX = 0.198;
const CHEEK_DY = 0.045;
const CHEEK_RX = 0.115;
const CHEEK_RY = 0.115;

const EAR_DX = 0.155;
const EAR_DY = -0.128;
const EAR_HALF_W = 0.094;
const EAR_HEIGHT = 0.178;

const EYE_DX = 0.101;
const EYE_DY = -0.02;
const EYE_RX = 0.068;
const EYE_RY = 0.057;

const MUZZLE_DY = 0.095;
const NOSE_DY = 0.062;
const NOSE_W = 0.038;
const NOSE_H = 0.03;

const FRONT_PAW_DX = 0.125;
const FRONT_PAW_Y = 0.355;
const HIND_PAW_DX = 0.278;
const HIND_PAW_Y = 0.3;
const PAW_RX = 0.082;
/** How much a raised forepaw grows as it comes toward the camera. */
const FRONT_PAW_FORESHORTEN = 0.35;
const PAW_RY = 0.06;

const TAIL_SEGMENTS = 14;
const TAIL_LENGTH = 0.82;
const TAIL_BASE_WIDTH = 0.062;
const TAIL_TIP_WIDTH = 0.03;
const TAIL_PUFF_GAIN = 0.55;
/** Above this lift a hind paw is drawn in front of the body, not behind it. */
const HIND_HOIST_THRESHOLD = 0.5;
/**
 * Head-on, the hind pair stands a body-length further from the camera than the
 * front pair, so it is drawn smaller and deeper in shade. From behind the
 * relationship inverts: the forepaws are the far pair and barely clear the
 * flanks at all.
 */
const HIND_PAW_SCALE = 0.92;
const HIND_PAW_SHADE = 0.22;
const BACK_FOREPAW_SPREAD = 1.35;
const BACK_FOREPAW_TUCK = 0.02;
const BACK_FOREPAW_SCALE = 0.85;
const BACK_FOREPAW_SHADE = 0.18;
const BACK_HIND_PAW_SPREAD = 0.78;
const BACK_HIND_PAW_SHADE = 0.05;

// ── Coat layouts ─────────────────────────────────────────────────────────────

/**
 * Torties are asymmetric by definition, so the patches are hand-placed rather
 * than generated: a ginger flank on her left, black over the right shoulder and
 * rump, a cream bib running down the chest.
 */
const BODY_BLOBS: readonly CoatBlob[] = [
  { x: -0.17, y: -0.04, rx: 0.19, ry: 0.17, tone: 'ginger', seed: 1.3 },
  { x: -0.09, y: 0.19, rx: 0.15, ry: 0.12, tone: 'ginger', seed: 4.1 },
  { x: 0.21, y: 0.09, rx: 0.12, ry: 0.11, tone: 'ginger', seed: 2.7 },
  { x: 0.05, y: -0.16, rx: 0.09, ry: 0.07, tone: 'ginger', seed: 5.9 },
  { x: 0.16, y: -0.06, rx: 0.11, ry: 0.13, tone: 'black', seed: 3.3 },
  { x: -0.24, y: 0.14, rx: 0.09, ry: 0.08, tone: 'black', seed: 6.4 },
];

const BIB_BLOBS: readonly CoatBlob[] = [
  { x: 0.0, y: 0.06, rx: 0.11, ry: 0.13, tone: 'cream', seed: 2.2 },
  { x: -0.02, y: -0.04, rx: 0.055, ry: 0.045, tone: 'cream', seed: 7.1 },
];

const RUFF_BLOBS: readonly CoatBlob[] = [
  { x: -0.16, y: -0.02, rx: 0.13, ry: 0.1, tone: 'ginger', seed: 8.3 },
  { x: 0.18, y: 0.0, rx: 0.11, ry: 0.09, tone: 'black', seed: 1.9 },
  ...BIB_BLOBS,
];

/** The split face: black down her right side, ginger down her left, cream chin. */
const HEAD_BLOBS: readonly CoatBlob[] = [
  { x: -0.12, y: -0.03, rx: 0.14, ry: 0.16, tone: 'ginger', seed: 3.9 },
  { x: -0.05, y: -0.18, rx: 0.07, ry: 0.06, tone: 'ginger', seed: 9.2 },
  { x: 0.13, y: 0.08, rx: 0.06, ry: 0.05, tone: 'ginger', seed: 5.1 },
  { x: 0.0, y: 0.12, rx: 0.105, ry: 0.075, tone: 'cream', seed: 6.6 },
  { x: -0.05, y: 0.05, rx: 0.05, ry: 0.045, tone: 'cream', seed: 2.4 },
];

const HEAD_BACK_BLOBS: readonly CoatBlob[] = [
  { x: -0.11, y: 0.0, rx: 0.13, ry: 0.15, tone: 'ginger', seed: 3.9 },
  { x: 0.08, y: -0.1, rx: 0.07, ry: 0.06, tone: 'ginger', seed: 8.8 },
];

const PAW_BLOBS: readonly CoatBlob[] = [
  { x: 0.0, y: 0.01, rx: 0.07, ry: 0.05, tone: 'cream', seed: 4.4 },
];

const HAUNCH_BLOBS: readonly CoatBlob[] = [
  { x: -0.04, y: -0.03, rx: 0.13, ry: 0.12, tone: 'ginger', seed: 7.7 },
  { x: 0.08, y: 0.07, rx: 0.08, ry: 0.07, tone: 'black', seed: 3.1 },
];

// ── Face ─────────────────────────────────────────────────────────────────────

const NOSE_PINK = '#bd6f76';
const NOSE_DARK = '#8d4650';
const INNER_EAR = '#c08b8b';
const INNER_EAR_DARK = '#8f5f63';
const TONGUE_PINK = '#e28c96';
const MOUTH_DARK = '#3b1c21';
const FANG_WHITE = '#fdf6ec';
const WHISKER = '#f6efe2';

const IRIS_OUTER = '#4e7a24';
const IRIS_MID = '#9cc648';
const IRIS_INNER = '#dcec96';
const PUPIL_INK = '#0c0b09';
const EYE_GLINT = '#ffffff';

const EAR_TUFT_COUNT = 7;
const EAR_TUFT_LEN = 0.055;
const WHISKER_COUNT = 4;
const WHISKER_LEN = 0.26;
const WHISKER_WIDTH = 0.006;
const BROW_WHISKER_COUNT = 2;
const WHISKER_DOTS_PER_SIDE = 3;
const WHISKER_DOT_COUNT = WHISKER_DOTS_PER_SIDE * 2;

/**
 * @param side -1 for her right ear (screen left), +1 for her left.
 * @param tilt -1 flattened back against the skull, +1 pricked forward.
 */
function drawEar(
  ctx: Ctx,
  cx: number,
  cy: number,
  side: number,
  tilt: number,
  back: boolean,
  widthScale = 1,
): void {
  const flatten = clamp01(-tilt);
  const prick = clamp01(tilt);
  const height = EAR_HEIGHT * lerp(1, 0.55, flatten) * lerp(1, 1.08, prick);
  const lean = deg(18) * side + deg(30) * side * flatten - deg(8) * side * prick;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);
  ctx.scale(widthScale, 1);

  const tipX = 0;
  const tipY = -height;
  // The base runs well below the anchor so the ear roots inside the skull
  // instead of perching on top of it.
  const outline: Pt[] = [
    { x: -EAR_HALF_W * 1.05, y: 0.055 },
    { x: -EAR_HALF_W * 0.95, y: -height * 0.42 },
    { x: tipX - EAR_HALF_W * 0.2, y: tipY + height * 0.06 },
    { x: tipX, y: tipY },
    { x: EAR_HALF_W * 0.62, y: tipY + height * 0.26 },
    { x: EAR_HALF_W, y: -height * 0.18 },
    { x: EAR_HALF_W * 0.95, y: 0.06 },
    { x: 0, y: 0.085 },
  ];

  paintFur(ctx, {
    outline,
    blobs: back
      ? []
      : [{ x: 0, y: -height * 0.55, rx: EAR_HALF_W, ry: height * 0.4, tone: 'black', seed: 4.8 }],
    base: back ? 'black' : 'black',
    seed: 11 + side,
    fringe: 0.022,
    strokes: 40,
    strokeLen: 0.05,
    flowFrom: { x: 0, y: 0.1 },
    shade: back ? 0.12 : 0,
  });

  if (!back) {
    ctx.beginPath();
    ctx.moveTo(-EAR_HALF_W * 0.4, 0.0);
    ctx.quadraticCurveTo(-EAR_HALF_W * 0.32, -height * 0.55, 0, -height * 0.74);
    ctx.quadraticCurveTo(EAR_HALF_W * 0.4, -height * 0.5, EAR_HALF_W * 0.44, 0.0);
    ctx.closePath();
    const innerGrad = ctx.createLinearGradient(0, -height, 0, 0);
    innerGrad.addColorStop(0, INNER_EAR_DARK);
    innerGrad.addColorStop(1, INNER_EAR);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    ctx.strokeStyle = rgba(WHISKER, 0.55);
    ctx.lineWidth = 0.006;
    ctx.lineCap = 'round';
    for (let i = 0; i < EAR_TUFT_COUNT; i++) {
      const t = (i + 0.5) / EAR_TUFT_COUNT;
      const x = lerp(-EAR_HALF_W * 0.45, EAR_HALF_W * 0.45, t);
      const y = -height * (0.1 + 0.35 * hash1(i + side * 3));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - side * EAR_TUFT_LEN * 0.5, y - EAR_TUFT_LEN * (0.6 + 0.5 * hash1(i * 2)));
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * @param side -1 her right eye, +1 her left.
 * @param gaze horizontal pupil shift, -1 to 1.
 */
function drawEye(
  ctx: Ctx,
  cx: number,
  cy: number,
  side: number,
  open: number,
  pupil: number,
  gaze: number,
): void {
  const openness = clamp01(open);

  if (openness < 0.12) {
    ctx.strokeStyle = COAT.black.dark;
    ctx.lineWidth = 0.011;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - EYE_RX * 0.9, cy);
    ctx.quadraticCurveTo(cx, cy + EYE_RY * 0.5, cx + EYE_RX * 0.9, cy);
    ctx.stroke();
    return;
  }

  const ry = EYE_RY * openness;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - EYE_RX, cy + ry * 0.15);
  ctx.quadraticCurveTo(cx - EYE_RX * 0.3, cy - ry * 1.25, cx + EYE_RX * 0.75, cy - ry * 0.55);
  ctx.quadraticCurveTo(cx + EYE_RX, cy - ry * 0.1, cx + EYE_RX * 0.7, cy + ry * 0.6);
  ctx.quadraticCurveTo(cx, cy + ry * 1.15, cx - EYE_RX, cy + ry * 0.15);
  ctx.closePath();
  ctx.clip();

  const iris = ctx.createRadialGradient(
    cx - EYE_RX * 0.2,
    cy - ry * 0.3,
    EYE_RX * 0.1,
    cx,
    cy,
    EYE_RX * 1.15,
  );
  iris.addColorStop(0, IRIS_INNER);
  iris.addColorStop(0.55, IRIS_MID);
  iris.addColorStop(1, IRIS_OUTER);
  ctx.fillStyle = iris;
  ctx.fillRect(cx - EYE_RX * 1.2, cy - EYE_RY * 1.4, EYE_RX * 2.4, EYE_RY * 2.8);

  const pupilW = EYE_RX * lerp(0.16, 0.72, clamp01(pupil));
  const pupilH = ry * 1.5;
  const pupilX = cx + gaze * EYE_RX * 0.3;
  ctx.fillStyle = PUPIL_INK;
  ctx.beginPath();
  ctx.ellipse(pupilX, cy, pupilW, pupilH, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(EYE_GLINT, 0.92);
  ctx.beginPath();
  ctx.ellipse(cx - EYE_RX * 0.32, cy - ry * 0.42, EYE_RX * 0.19, ry * 0.24, deg(-20), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(EYE_GLINT, 0.35);
  ctx.beginPath();
  ctx.ellipse(cx + EYE_RX * 0.34, cy + ry * 0.4, EYE_RX * 0.12, ry * 0.16, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(SHADOW_INK, 0.28);
  ctx.fillRect(cx - EYE_RX * 1.2, cy - EYE_RY * 1.4, EYE_RX * 2.4, EYE_RY * 0.85 * (2 - openness));
  ctx.restore();

  ctx.strokeStyle = rgba(COAT.black.dark, 0.85);
  ctx.lineWidth = 0.009;
  ctx.beginPath();
  ctx.moveTo(cx - EYE_RX, cy + ry * 0.15);
  ctx.quadraticCurveTo(cx - EYE_RX * 0.3, cy - ry * 1.25, cx + EYE_RX * 0.75, cy - ry * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - EYE_RX * 0.95, cy + ry * 0.2);
  ctx.quadraticCurveTo(cx, cy + ry * 1.15, cx + EYE_RX * 0.7, cy + ry * 0.6);
  ctx.strokeStyle = rgba(COAT.black.dark, 0.45);
  ctx.stroke();

  // The outer corner tapers into a fur line the way a cat's eye does.
  ctx.strokeStyle = rgba(COAT.black.dark, 0.6);
  ctx.lineWidth = 0.007;
  ctx.beginPath();
  ctx.moveTo(cx + side * EYE_RX * 0.9, cy - ry * 0.35);
  ctx.lineTo(cx + side * EYE_RX * 1.35, cy - ry * 0.75);
  ctx.stroke();
}

function drawWhiskers(
  ctx: Ctx,
  cx: number,
  cy: number,
  side: number,
  droop: number,
  lengthScale = 1,
): void {
  ctx.save();
  ctx.strokeStyle = rgba(WHISKER, 0.8);
  ctx.lineWidth = WHISKER_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < WHISKER_COUNT; i++) {
    const t = i / (WHISKER_COUNT - 1);
    const rise = lerp(-0.03, 0.028, t);
    const sag = lerp(-0.055, 0.075, t) + droop * 0.05;
    const len = WHISKER_LEN * lengthScale * lerp(1, 0.78, Math.abs(t - 0.4));
    ctx.beginPath();
    ctx.moveTo(cx, cy + rise);
    ctx.quadraticCurveTo(
      cx + side * len * 0.55,
      cy + rise + sag * 0.35,
      cx + side * len,
      cy + rise + sag,
    );
    ctx.stroke();
  }
  // Brow whiskers.
  ctx.strokeStyle = rgba(WHISKER, 0.55);
  for (let i = 0; i < BROW_WHISKER_COUNT; i++) {
    const y = cy - 0.13 - i * 0.018;
    ctx.beginPath();
    ctx.moveTo(cx + side * 0.03, y);
    ctx.quadraticCurveTo(cx + side * 0.1, y - 0.05, cx + side * 0.16, y - 0.085);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMuzzle(ctx: Ctx, cx: number, cy: number, mouth: number, tongue: number): void {
  const padRx = 0.072;
  const padRy = 0.05;
  for (const side of [-1, 1]) {
    const px = cx + side * 0.045;
    const grad = ctx.createRadialGradient(px, cy - padRy * 0.4, 0.005, px, cy, padRx);
    grad.addColorStop(0, COAT.cream.light);
    grad.addColorStop(1, COAT.cream.base);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(px, cy, padRx, padRy, 0, 0, TWO_PI);
    ctx.fill();
  }

  // Whisker dots read as pores at review scale and vanish in-game, which is right.
  ctx.fillStyle = rgba(COAT.black.dark, 0.35);
  for (let i = 0; i < WHISKER_DOT_COUNT; i++) {
    const side = i < WHISKER_DOTS_PER_SIDE ? -1 : 1;
    const k = i % WHISKER_DOTS_PER_SIDE;
    ctx.beginPath();
    ctx.arc(cx + side * (0.028 + k * 0.022), cy - 0.012 + k * 0.014, 0.004, 0, TWO_PI);
    ctx.fill();
  }

  const noseY = cy - NOSE_DY;
  ctx.beginPath();
  ctx.moveTo(cx - NOSE_W, noseY - NOSE_H * 0.55);
  ctx.quadraticCurveTo(cx, noseY - NOSE_H * 0.95, cx + NOSE_W, noseY - NOSE_H * 0.55);
  ctx.quadraticCurveTo(cx + NOSE_W * 0.55, noseY + NOSE_H * 0.75, cx, noseY + NOSE_H);
  ctx.quadraticCurveTo(
    cx - NOSE_W * 0.55,
    noseY + NOSE_H * 0.75,
    cx - NOSE_W,
    noseY - NOSE_H * 0.55,
  );
  ctx.closePath();
  const noseGrad = ctx.createLinearGradient(0, noseY - NOSE_H, 0, noseY + NOSE_H);
  noseGrad.addColorStop(0, NOSE_PINK);
  noseGrad.addColorStop(1, NOSE_DARK);
  ctx.fillStyle = noseGrad;
  ctx.fill();
  ctx.fillStyle = rgba(SHADOW_INK, 0.5);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * NOSE_W * 0.45,
      noseY - NOSE_H * 0.15,
      NOSE_W * 0.16,
      NOSE_H * 0.3,
      deg(side * 25),
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  const openness = clamp01(mouth);
  if (openness > 0.05) {
    const mouthY = cy + 0.02;
    const w = 0.05 * lerp(0.6, 1.2, openness);
    const h = 0.055 * openness;
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.moveTo(cx - w, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + h * 1.6, cx + w, mouthY);
    ctx.quadraticCurveTo(cx, mouthY - h * 0.3, cx - w, mouthY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = FANG_WHITE;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * w * 0.62, mouthY);
      ctx.lineTo(cx + side * w * 0.4, mouthY + h * 0.85);
      ctx.lineTo(cx + side * w * 0.28, mouthY + 0.002);
      ctx.closePath();
      ctx.fill();
    }

    if (tongue > 0.05) {
      ctx.fillStyle = TONGUE_PINK;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        mouthY + h * (0.7 + 0.6 * tongue),
        w * 0.42,
        h * 0.55 * (0.6 + tongue),
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = rgba(COAT.black.dark, 0.7);
    ctx.lineWidth = 0.008;
    ctx.lineCap = 'round';
    const mouthY = cy + 0.012;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, mouthY - 0.008);
      ctx.quadraticCurveTo(cx + side * 0.018, mouthY + 0.016, cx + side * 0.038, mouthY + 0.004);
      ctx.stroke();
    }
    if (tongue > 0.05) {
      ctx.fillStyle = TONGUE_PINK;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY + 0.022 * tongue + 0.012, 0.018, 0.022 * tongue, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// ── Paws and limbs ───────────────────────────────────────────────────────────

const CLAW_LEN = 0.055;
const CLAW_COUNT = 4;
const TOE_COUNT = 3;
const PAW_ANKLE_SHADE_ALPHA = 0.42;
/** How far the toes bulge past the ankle's width. */
const PAW_TOE_BULGE = 0.3;
const PAW_OUTLINE_STEPS = 30;

/**
 * A paw silhouette: narrow at the ankle, spreading into toes at the bottom.
 * The toe lobes are what stop it reading as a circle at tile size.
 */
function pawOutline(seed: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < PAW_OUTLINE_STEPS; i++) {
    const angle = (i / PAW_OUTLINE_STEPS) * TWO_PI;
    const downward = Math.max(0, Math.sin(angle));
    const toes = PAW_TOE_BULGE * downward * Math.abs(Math.cos(angle * TOE_COUNT));
    const wobble = 1 + 0.06 * Math.sin(angle * 3 + seed);
    pts.push({
      x: Math.cos(angle) * PAW_RX * wobble * lerp(0.86, 1, downward),
      y: Math.sin(angle) * PAW_RY * wobble * (1 + toes),
    });
  }
  return pts;
}

/**
 * A fluffy paw seen from the front, with toe tufts and optional claws.
 * @param angle rotation of the paw, used when a leg reaches across the body.
 */
function drawPaw(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  claw: number,
  scale = 1,
  shade = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  if (claw > 0.02) {
    ctx.save();
    ctx.strokeStyle = rgba(FANG_WHITE, 0.95);
    ctx.lineWidth = 0.011;
    ctx.lineCap = 'round';
    for (let i = 0; i < CLAW_COUNT; i++) {
      const t = (i + 0.5) / CLAW_COUNT;
      const cx = lerp(-PAW_RX * 0.8, PAW_RX * 0.8, t);
      const len = CLAW_LEN * claw * (0.75 + 0.4 * Math.sin(t * Math.PI));
      ctx.beginPath();
      ctx.moveTo(cx, PAW_RY * 0.3);
      ctx.quadraticCurveTo(
        cx + len * 0.25,
        PAW_RY * 0.3 + len * 0.7,
        cx + len * 0.15,
        PAW_RY * 0.3 + len,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  paintFur(ctx, {
    outline: pawOutline(5.5 + x * 7),
    blobs: PAW_BLOBS,
    base: 'cream',
    seed: 21 + x * 13 + y * 3,
    fringe: 0.02,
    strokes: 34,
    strokeLen: 0.04,
    flowFrom: { x: 0, y: -PAW_RY * 2 },
    shade,
  });

  // The ankle is in the leg's shadow. Without this the paw reads as a disc
  // floating in front of the chest rather than as the end of a limb.
  const ankleShade = ctx.createLinearGradient(0, -PAW_RY * 1.2, 0, PAW_RY * 0.4);
  ankleShade.addColorStop(0, rgba(SHADOW_INK, PAW_ANKLE_SHADE_ALPHA));
  ankleShade.addColorStop(1, rgba(SHADOW_INK, 0));
  ctx.save();
  traceOutline(ctx, pawOutline(5.5 + x * 7));
  ctx.clip();
  ctx.fillStyle = ankleShade;
  ctx.fillRect(-PAW_RX * 1.5, -PAW_RY * 1.5, PAW_RX * 3, PAW_RY * 3);
  ctx.restore();

  ctx.strokeStyle = rgba(COAT.cream.dark, 0.65);
  ctx.lineWidth = 0.006;
  ctx.lineCap = 'round';
  for (let i = 1; i < TOE_COUNT; i++) {
    const cx = lerp(-PAW_RX * 0.6, PAW_RX * 0.6, i / TOE_COUNT);
    ctx.beginPath();
    ctx.moveTo(cx, PAW_RY * 0.95);
    ctx.lineTo(cx * 0.7, PAW_RY * 0.1);
    ctx.stroke();
  }

  ctx.restore();
}

/** A limb column from shoulder or hip to paw — the fluff that hides the joint. */
function drawLimbColumn(
  ctx: Ctx,
  hipX: number,
  hipY: number,
  pawX: number,
  pawY: number,
  shade: number,
): void {
  const dx = pawX - hipX;
  const dy = pawY - hipY;
  const angle = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);
  ctx.save();
  ctx.translate(hipX, hipY);
  ctx.rotate(angle - HALF_PI);
  paintFur(ctx, {
    outline: ovalOutline(0, len / 2, 0.052, len / 2 + 0.015, 0, 9.1 + hipX * 5, 0.06, 30),
    blobs: [{ x: 0, y: len * 0.15, rx: 0.05, ry: len * 0.3, tone: 'ginger', seed: 3.4 }],
    base: 'cream',
    seed: 31 + hipX * 11,
    fringe: 0.018,
    strokes: 38,
    strokeLen: 0.045,
    flowFrom: { x: 0, y: -0.2 },
    shade,
  });
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

interface TailSpine {
  readonly points: Pt[];
  readonly widths: number[];
}

/**
 * Builds the tail as a chain of segments whose bend accumulates, plus a
 * travelling sine wave — a cat's tail never bends on a single hinge.
 */
function buildTailSpine(baseX: number, baseY: number, tail: TailPose): TailSpine {
  const points: Pt[] = [{ x: baseX, y: baseY }];
  const widths: number[] = [];
  const step = TAIL_LENGTH / TAIL_SEGMENTS;
  let angle = tail.base;
  let x = baseX;
  let y = baseY;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    const t = i / TAIL_SEGMENTS;
    const wave = Math.sin(t * Math.PI * 1.6 + tail.phase) * tail.wave;
    const tipFlick = t > 0.6 ? (tail.flick * (t - 0.6)) / 0.4 : 0;
    angle +=
      (tail.curl / TAIL_SEGMENTS) * lerp(0.5, 1.6, t) +
      wave / TAIL_SEGMENTS +
      tipFlick / TAIL_SEGMENTS;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    points.push({ x, y });
    const taper = lerp(TAIL_BASE_WIDTH, TAIL_TIP_WIDTH, t * t);
    const plume = 1 + TAIL_PUFF_GAIN * tail.puff + 0.35 * Math.sin(t * Math.PI);
    widths.push(taper * plume);
  }
  widths.push(TAIL_TIP_WIDTH * (1 + TAIL_PUFF_GAIN * tail.puff));
  return { points, widths };
}

function tailOutline(spine: TailSpine): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const { points, widths } = spine;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const w = widths[i];
    left.push({ x: points[i].x + nx * w, y: points[i].y + ny * w });
    right.push({ x: points[i].x - nx * w, y: points[i].y - ny * w });
  }
  const tip = points[points.length - 1];
  const beforeTip = points[points.length - 2];
  const tipAngle = Math.atan2(tip.y - beforeTip.y, tip.x - beforeTip.x);
  const cap: Pt = {
    x: tip.x + Math.cos(tipAngle) * widths[widths.length - 1] * 1.4,
    y: tip.y + Math.sin(tipAngle) * widths[widths.length - 1] * 1.4,
  };
  return [...left, cap, ...right.reverse()];
}

const TAIL_RING_COUNT = 5;
/** Ring radius as a multiple of the tail's half-width at that point. */
const TAIL_RING_SPREAD = 1.5;
/** Hairs drawn per tail segment. */
const TAIL_HAIRS_PER_SEGMENT = 9;
const TAIL_CONTOUR_WIDTH = 0.03;
const TAIL_CONTOUR_ALPHA = 0.5;

/** Draws the tail behind or in front of the body, depending on the view. */
export function drawTail(ctx: Ctx, baseX: number, baseY: number, tail: TailPose, shade = 0): void {
  const spine = buildTailSpine(baseX, baseY, tail);
  const outline = tailOutline(spine);

  ctx.save();
  drawFringe(
    ctx,
    {
      outline,
      blobs: [],
      base: 'black',
      seed: 41,
      fringe: 0.05 * (1 + tail.puff),
      strokes: 0,
      strokeLen: 0,
      flowFrom: { x: baseX, y: baseY },
      shade,
    },
    false,
  );

  traceOutline(ctx, outline);
  ctx.clip();
  const bounds = boundsOf(outline);
  ctx.fillStyle = mix(COAT.black.base, SHADOW_INK, shade);
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  // Tortie tails band rather than blotch, so the patches follow the spine.
  const rings: CoatBlob[] = [];
  for (let i = 0; i < TAIL_RING_COUNT; i++) {
    const t = (i + 0.5) / TAIL_RING_COUNT;
    const idx = Math.min(spine.points.length - 1, Math.round(t * (spine.points.length - 1)));
    const p = spine.points[idx];
    const tone: CoatTone = i % 2 === 0 ? 'ginger' : 'black';
    const w = spine.widths[Math.min(idx, spine.widths.length - 1)];
    rings.push({
      x: p.x,
      y: p.y,
      rx: w * TAIL_RING_SPREAD,
      ry: w * TAIL_RING_SPREAD,
      tone,
      seed: 3 + i * 2.3,
    });
  }
  for (const ring of rings) fillBlob(ctx, ring);
  if (shade > 0) {
    ctx.fillStyle = rgba(SHADOW_INK, shade);
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }

  // Hair on the tail lies along it, not away from a centre, so the strokes are
  // drawn from the spine outward per segment rather than by the generic pass.
  ctx.lineCap = 'round';
  ctx.lineWidth = FUR_STROKE_WIDTH;
  for (let i = 0; i < spine.points.length - 1; i++) {
    const p = spine.points[i];
    const next = spine.points[i + 1];
    const angle = Math.atan2(next.y - p.y, next.x - p.x);
    const w = spine.widths[i];
    for (let k = 0; k < TAIL_HAIRS_PER_SEGMENT; k++) {
      const across = (hash2(i * 7 + k, 5) - 0.5) * 2 * w;
      const sx = p.x - Math.sin(angle) * across;
      const sy = p.y + Math.cos(angle) * across;
      const tone = toneAt(rings, 'black', sx, sy);
      const light = hash2(k, i) > 0.4;
      ctx.strokeStyle = rgba(
        mix(COAT[tone].base, light ? COAT[tone].light : COAT[tone].dark, 0.5),
        light ? 0.5 : 0.7,
      );
      const len = 0.05 * (0.6 + hash2(k * 3, i));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
      ctx.stroke();
    }
  }

  const shine = ctx.createLinearGradient(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  shine.addColorStop(0, rgba('#ffffff', 0.1));
  shine.addColorStop(1, rgba(SHADOW_INK, 0.2));
  ctx.fillStyle = shine;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  // A raised tail is drawn over the body it matches in colour, so it needs a
  // contour of its own or it disappears into the coat behind it.
  ctx.strokeStyle = rgba(SHADOW_INK, TAIL_CONTOUR_ALPHA);
  ctx.lineWidth = TAIL_CONTOUR_WIDTH;
  traceOutline(ctx, outline);
  ctx.stroke();
  ctx.restore();

  drawFringe(
    ctx,
    {
      outline,
      blobs: [],
      base: 'black',
      seed: 41,
      fringe: 0.05 * (1 + tail.puff),
      strokes: 0,
      strokeLen: 0,
      flowFrom: { x: baseX, y: baseY },
      shade,
    },
    true,
  );
}

// ── Effects ──────────────────────────────────────────────────────────────────

const MAGIC_CORE = '#f3e8ff';
const MAGIC_MID = '#a855f7';
const MAGIC_EDGE = '#6b21a8';
const SPARK_COUNT = 7;
const SLASH_ARC_COUNT = 3;

/** The missile orb charging between her paws. */
export function drawCastOrb(
  ctx: Ctx,
  cx: number,
  cy: number,
  charge: number,
  release: number,
  time: number,
): void {
  const strength = clamp01(charge) * (1 - clamp01(release));
  if (strength <= 0.02) return;
  const radius = 0.05 + 0.075 * strength;

  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 2.2);
  grad.addColorStop(0, rgba(MAGIC_CORE, 0.95 * strength));
  grad.addColorStop(0.35, rgba(MAGIC_MID, 0.7 * strength));
  grad.addColorStop(1, rgba(MAGIC_EDGE, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.2, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(MAGIC_CORE, 0.9 * strength);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.45, 0, TWO_PI);
  ctx.fill();

  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = (i / SPARK_COUNT) * TWO_PI + time * TWO_PI;
    const dist = radius * (1.3 + 0.5 * Math.sin(time * TWO_PI * 2 + i));
    const size = 0.008 + 0.01 * hash1(i + 3);
    ctx.fillStyle = rgba(MAGIC_CORE, 0.8 * strength);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, size, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The claw arc. Progress 0 is the first contrail, 1 is the last fading streak.
 * @param angle direction the swipe travels, in radians.
 */
export function drawSlashArc(
  ctx: Ctx,
  cx: number,
  cy: number,
  angle: number,
  progress: number,
  reach: number,
): void {
  const t = clamp01(progress);
  const fade = hump(t);
  if (fade <= 0.02) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  const sweep = deg(115);
  const start = -sweep / 2 + sweep * t * 0.35;
  for (let i = 0; i < SLASH_ARC_COUNT; i++) {
    const offset = (i - 1) * 0.035;
    const radius = reach + offset;
    const alpha = fade * (0.85 - i * 0.2);
    const grad = ctx.createLinearGradient(0, -radius, 0, radius);
    grad.addColorStop(0, rgba('#ffffff', 0));
    grad.addColorStop(0.5, rgba('#fff4f6', Math.min(1, alpha * 1.35)));
    grad.addColorStop(1, rgba('#ff9aa8', 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.024 * (1 - i * 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + sweep * lerp(0.6, 1, t));
    ctx.stroke();
  }
  ctx.restore();
}

const MOTE_COUNT = 9;

/** Level-up motes for the dance row. */
export function drawSparkles(ctx: Ctx, strength: number, time: number): void {
  if (strength <= 0.02) return;
  ctx.save();
  for (let i = 0; i < MOTE_COUNT; i++) {
    const seedAngle = hash1(i * 3.1) * TWO_PI;
    const rise = (time + hash1(i * 5.7)) % 1;
    const x = Math.cos(seedAngle) * lerp(0.18, 0.44, hash1(i * 2.3));
    const y = lerp(0.34, -0.66, rise);
    const alpha = strength * hump(rise) * 0.9;
    const size = 0.012 * (0.6 + hash1(i));
    ctx.fillStyle = rgba('#ffe9a8', alpha);
    ctx.beginPath();
    ctx.moveTo(x, y - size * 2);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size * 2);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ── Front view (walking toward the camera) ───────────────────────────────────

function bodyMetrics(p: CatPose): { cx: number; cy: number; rx: number; ry: number } {
  const cx = p.sway;
  const cy = lerp(BODY_CY, SIT_BODY_CY, p.sit) + p.bob;
  const rx = lerp(BODY_RX, SIT_BODY_RX, p.sit) * (1 + p.breathe * 0.03);
  const ry = lerp(BODY_RY, SIT_BODY_RY, p.sit) * p.squash * (1 + p.breathe * 0.04);
  return { cx, cy, rx, ry };
}

function headAnchor(p: CatPose): Pt {
  const body = bodyMetrics(p);
  return {
    x: body.cx + p.headX + p.headTurn * 0.035,
    y: lerp(HEAD_CY, HEAD_CY - 0.04, p.sit) + p.headY + p.bob * 0.6 + p.headBow * HEAD_BOW_DROP,
  };
}

function drawHeadFront(ctx: Ctx, p: CatPose, back: boolean): void {
  const anchor = headAnchor(p);
  const turn = p.headTurn;

  const BACK_HEAD_SCALE = 0.9;
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(p.headTilt);
  ctx.scale(
    (1 - Math.abs(turn) * 0.08) * (back ? BACK_HEAD_SCALE : 1),
    (1 + p.headBow * 0.04) * (back ? BACK_HEAD_SCALE : 1),
  );

  const earShiftL = turn * 0.03;
  drawEar(ctx, -EAR_DX + earShiftL, EAR_DY, -1, p.earL, back);
  drawEar(ctx, EAR_DX + earShiftL, EAR_DY, 1, p.earR, back);

  const blobs = back ? HEAD_BACK_BLOBS : HEAD_BLOBS;
  const skull = ovalOutline(turn * 0.02, 0, HEAD_RX, HEAD_RY, 0, 2.6, 0.05);
  paintFur(ctx, {
    outline: skull,
    blobs,
    base: 'black',
    seed: 51,
    fringe: 0.03,
    strokes: 150,
    strokeLen: 0.055,
    flowFrom: { x: 0, y: -0.05 },
    shade: back ? 0.1 : 0,
  });

  // Cheek ruffs break the skull outline; a long-haired cat's head is not an oval.
  for (const side of [-1, 1]) {
    const cheekX = side * CHEEK_DX + turn * 0.05 * side;
    paintFur(ctx, {
      outline: ovalOutline(
        cheekX,
        CHEEK_DY,
        CHEEK_RX,
        CHEEK_RY,
        deg(side * 12),
        7.4 + side,
        0.09,
        34,
      ),
      blobs:
        side < 0
          ? [{ x: cheekX, y: CHEEK_DY, rx: CHEEK_RX, ry: CHEEK_RY, tone: 'ginger', seed: 4.2 }]
          : [],
      base: 'black',
      seed: 61 + side * 4,
      fringe: 0.045,
      strokes: 60,
      strokeLen: 0.06,
      flowFrom: { x: 0, y: -0.02 },
      shade: back ? 0.12 : 0,
    });
  }

  if (!back) {
    const gaze = turn;
    drawEye(ctx, -EYE_DX + turn * 0.05, EYE_DY, -1, p.eyeOpen, p.pupil, gaze);
    drawEye(ctx, EYE_DX + turn * 0.05, EYE_DY, 1, p.eyeOpen, p.pupil, gaze);

    // A pale mask around the muzzle, the way the cream runs up between the eyes.
    ctx.fillStyle = rgba(COAT.cream.base, 0.5);
    ctx.beginPath();
    ctx.ellipse(turn * 0.05, MUZZLE_DY - 0.01, 0.085, 0.07, 0, 0, TWO_PI);
    ctx.fill();

    drawWhiskers(ctx, -0.03 + turn * 0.05, MUZZLE_DY, -1, p.headBow);
    drawWhiskers(ctx, 0.03 + turn * 0.05, MUZZLE_DY, 1, p.headBow);
    drawMuzzle(ctx, turn * 0.05, MUZZLE_DY, p.mouth, p.tongue);
  }

  ctx.restore();
}

function frontPawRest(p: CatPose, side: number): Pt {
  return {
    x: side * FRONT_PAW_DX * lerp(1, 0.78, p.sit) + p.sway * 0.6,
    y: FRONT_PAW_Y + p.bob * 0.25,
  };
}

function hindPawRest(p: CatPose, side: number): Pt {
  return {
    x: side * HIND_PAW_DX * lerp(1, 1.06, p.sit) + p.sway * 0.4,
    y: HIND_PAW_Y + p.bob * 0.15,
  };
}

/** Donut seen head-on: the view used for walking toward the camera and for every sit-down animation. */
export function drawCatFront(ctx: Ctx, p: CatPose): void {
  const body = bodyMetrics(p);

  ctx.save();
  ctx.rotate(p.roll);

  drawGroundShadow(ctx, p.sway * 0.5, GROUND_Y + 0.045, 0.34 * p.shadow, 0.09 * p.shadow);

  drawTail(ctx, body.cx + 0.12 + p.tail.rootX, body.cy + 0.16 + p.tail.rootY, p.tail);

  const drawHindPaw = (side: number): void => {
    const paw = side < 0 ? p.hindL : p.hindR;
    const rest = hindPawRest(p, side);
    if (paw.lift > HIND_HOIST_THRESHOLD) {
      drawLimbColumn(
        ctx,
        body.cx + side * body.rx * 0.75,
        body.cy + 0.14,
        rest.x + paw.dx,
        rest.y + paw.dy,
        0.06,
      );
    }
    drawPaw(
      ctx,
      rest.x + paw.dx,
      rest.y + paw.dy,
      deg(side * 14) + paw.lift * deg(side * 30),
      paw.claw,
      HIND_PAW_SCALE,
      HIND_PAW_SHADE,
    );
  };
  /** A hoisted hind leg — the grooming pose — swings clear of the flank. */
  const hindLegIsHoisted = (side: number): boolean =>
    (side < 0 ? p.hindL : p.hindR).lift > HIND_HOIST_THRESHOLD;

  for (const side of [-1, 1]) {
    const haunchX = body.cx + side * (body.rx * 0.82);
    paintFur(ctx, {
      outline: ovalOutline(
        haunchX,
        body.cy + 0.12,
        0.155,
        0.145,
        deg(side * -10),
        12.5 + side,
        0.08,
        34,
      ),
      blobs: HAUNCH_BLOBS.map((b) => ({ ...b, x: b.x + haunchX, y: b.y + body.cy + 0.12 })),
      base: 'black',
      seed: 71 + side * 5,
      fringe: 0.04,
      strokes: 70,
      strokeLen: 0.06,
      flowFrom: { x: body.cx, y: body.cy },
      shade: 0.08,
    });
    if (!hindLegIsHoisted(side)) drawHindPaw(side);
  }

  paintFur(ctx, {
    outline: ovalOutline(body.cx, body.cy, body.rx, body.ry, p.lean, 1.7, 0.06),
    blobs: BODY_BLOBS.map((b) => ({ ...b, x: b.x + body.cx, y: b.y + body.cy })),
    base: 'black',
    seed: 81,
    fringe: 0.045,
    strokes: 240,
    strokeLen: 0.07,
    flowFrom: { x: body.cx, y: body.cy - body.ry },
  });

  paintFur(ctx, {
    outline: ovalOutline(body.cx, body.cy + RUFF_CY - 0.06, RUFF_RX, RUFF_RY, 0, 4.9, 0.1, 40),
    blobs: RUFF_BLOBS.map((b) => ({ ...b, x: b.x + body.cx, y: b.y + body.cy - 0.06 })),
    base: 'black',
    seed: 91,
    fringe: 0.055,
    strokes: 120,
    strokeLen: 0.075,
    flowFrom: { x: body.cx, y: body.cy - 0.2 },
  });

  for (const side of [-1, 1]) {
    if (hindLegIsHoisted(side)) drawHindPaw(side);
  }

  const frontHead = headAnchor(p);
  /** Below the chin the forelimb passes behind the head; above it, in front. */
  const chinY = frontHead.y + HEAD_RY * 0.6;
  const drawFrontLimb = (side: number): void => {
    const paw = side < 0 ? p.frontL : p.frontR;
    const rest = frontPawRest(p, side);
    const pawX = rest.x + paw.dx;
    const pawY = rest.y + paw.dy;
    drawLimbColumn(ctx, body.cx + side * 0.095, body.cy + 0.175, pawX, pawY, 0.04);
    drawPaw(
      ctx,
      pawX,
      pawY,
      deg(side * 6) + paw.lift * deg(side * 20),
      paw.claw,
      1 + paw.lift * FRONT_PAW_FORESHORTEN,
    );
  };
  const limbReachesFace = (side: number): boolean => {
    const paw = side < 0 ? p.frontL : p.frontR;
    return frontPawRest(p, side).y + paw.dy < chinY;
  };

  for (const side of [-1, 1]) {
    if (!limbReachesFace(side)) drawFrontLimb(side);
  }

  drawContactShadow(ctx, frontHead.x, frontHead.y + HEAD_RY * 0.95, HEAD_RX * 1.15, 0.07, 0.35);
  drawHeadFront(ctx, p, false);

  // A paw held up to be washed has to sit in front of the muzzle it is being
  // washed against.
  for (const side of [-1, 1]) {
    if (limbReachesFace(side)) drawFrontLimb(side);
  }

  if (p.cast > 0.02) {
    const orbX = body.cx + (p.frontL.dx + p.frontR.dx) / 2;
    const orbY = frontPawRest(p, 0).y + (p.frontL.dy + p.frontR.dy) / 2 - 0.05;
    drawCastOrb(ctx, orbX, orbY, p.cast, p.castRelease, p.time);
  }
  if (p.slash !== null) {
    drawSlashArc(ctx, body.cx, body.cy - 0.06, HALF_PI, p.slash, 0.38);
  }
  drawSparkles(ctx, p.sparkle, p.time);

  ctx.restore();
}

// ── Back view (walking away) ─────────────────────────────────────────────────

export function drawCatBack(ctx: Ctx, p: CatPose): void {
  const body = bodyMetrics(p);

  ctx.save();
  ctx.rotate(p.roll);
  drawGroundShadow(ctx, p.sway * 0.5, GROUND_Y + 0.045, 0.34 * p.shadow, 0.09 * p.shadow);

  for (const side of [-1, 1]) {
    const paw = side < 0 ? p.frontL : p.frontR;
    const rest = frontPawRest(p, side * BACK_FOREPAW_SPREAD);
    drawPaw(
      ctx,
      rest.x + paw.dx,
      rest.y + paw.dy - BACK_FOREPAW_TUCK,
      deg(side * 8),
      0,
      BACK_FOREPAW_SCALE,
      BACK_FOREPAW_SHADE,
    );
  }

  paintFur(ctx, {
    outline: ovalOutline(body.cx, body.cy, body.rx * 1.02, body.ry, p.lean, 3.2, 0.06),
    blobs: BODY_BLOBS.map((b) => ({ ...b, x: -b.x + body.cx, y: b.y + body.cy })),
    base: 'black',
    seed: 101,
    fringe: 0.05,
    strokes: 240,
    strokeLen: 0.07,
    flowFrom: { x: body.cx, y: body.cy - body.ry * 1.4 },
  });

  // The rump is the widest thing in this view, and she knows it.
  for (const side of [-1, 1]) {
    const haunchX = body.cx + side * body.rx * 0.7;
    paintFur(ctx, {
      outline: ovalOutline(
        haunchX,
        body.cy + 0.14,
        0.165,
        0.15,
        deg(side * -8),
        13.5 + side,
        0.08,
        34,
      ),
      blobs: HAUNCH_BLOBS.map((b) => ({ ...b, x: b.x * side + haunchX, y: b.y + body.cy + 0.14 })),
      base: 'black',
      seed: 111 + side * 3,
      fringe: 0.045,
      strokes: 80,
      strokeLen: 0.06,
      flowFrom: { x: body.cx, y: body.cy },
      shade: 0.03,
    });
    const paw = side < 0 ? p.hindL : p.hindR;
    const rest = hindPawRest(p, side * BACK_HIND_PAW_SPREAD);
    drawPaw(ctx, rest.x + paw.dx, rest.y + paw.dy, deg(side * 10), 0, 1, BACK_HIND_PAW_SHADE);
  }

  drawTail(ctx, body.cx + 0.16 + p.tail.rootX, body.cy + 0.12 + p.tail.rootY, p.tail);
  const backHead = headAnchor(p);
  drawContactShadow(ctx, backHead.x, backHead.y + HEAD_RY * 0.9, HEAD_RX * 1.1, 0.07, 0.35);
  drawHeadFront(ctx, p, true);

  if (p.cast > 0.02) {
    drawCastOrb(ctx, body.cx, body.cy - 0.36, p.cast, p.castRelease, p.time);
  }
  if (p.slash !== null) {
    drawSlashArc(ctx, body.cx, body.cy - 0.1, -HALF_PI, p.slash, 0.4);
  }
  drawSparkles(ctx, p.sparkle, p.time);

  ctx.restore();
}

// ── Side view (profile, facing +X) ───────────────────────────────────────────

const SIDE_BODY_CX = -0.02;
const SIDE_BODY_CY = 0.08;
const SIDE_BODY_RX = 0.36;
const SIDE_BODY_RY = 0.235;
const SIDE_HAUNCH_X = -0.245;
const SIDE_HAUNCH_Y = 0.075;
const SIDE_CHEST_X = 0.235;
const SIDE_CHEST_Y = 0.02;
const SIDE_HEAD_X = 0.355;
const SIDE_HEAD_Y = -0.19;
const SIDE_HEAD_RX = 0.2;
const SIDE_HEAD_RY = 0.19;
const SIDE_SHOULDER_X = 0.215;
const SIDE_HIP_X = -0.235;
const SIDE_LIMB_Y = 0.12;
const SIDE_FORE_UPPER = 0.16;
const SIDE_FORE_LOWER = 0.17;
const SIDE_HIND_UPPER = 0.19;
const SIDE_HIND_LOWER = 0.2;

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
  const dist = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.001);
  const base = Math.atan2(dy, dx);
  const cosA = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist * l1);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const jointAngle = base + angle * bend;
  return { x: ax + Math.cos(jointAngle) * l1, y: ay + Math.sin(jointAngle) * l1 };
}

function drawSideLimb(
  ctx: Ctx,
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number,
  shade: number,
  claw: number,
): void {
  const joint = solveJoint(hipX, hipY, footX, footY, upper, lower, bend);
  const segments: Array<[Pt, Pt, number]> = [
    [{ x: hipX, y: hipY }, joint, 0.072],
    [joint, { x: footX, y: footY }, 0.05],
  ];
  for (const [a, b, halfWidth] of segments) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle - HALF_PI);
    paintFur(ctx, {
      outline: ovalOutline(
        0,
        len / 2,
        halfWidth,
        len / 2 + 0.02,
        0,
        15.5 + hipX * 3 + halfWidth * 40,
        0.07,
        28,
      ),
      blobs: [{ x: 0, y: len * 0.8, rx: halfWidth, ry: len * 0.3, tone: 'cream', seed: 5.6 }],
      // Legs carry the flank's ginger down into cream socks; a black column
      // reads as a hole punched in the coat.
      base: 'ginger',
      seed: 121 + hipX * 7 + halfWidth * 100,
      fringe: 0.02,
      strokes: 40,
      strokeLen: 0.05,
      flowFrom: { x: 0, y: -0.15 },
      shade,
    });
    ctx.restore();
  }
  drawPaw(ctx, footX, footY, 0, claw, 0.92, shade);
}

function drawHeadSide(ctx: Ctx, p: CatPose): void {
  const hx = SIDE_HEAD_X + p.headX;
  const hy = SIDE_HEAD_Y + p.headY + p.bob * 0.7 + p.headBow * 0.16;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(p.headTilt + p.headBow * deg(28));

  // Far ear first so the near ear overlaps it.
  drawEar(ctx, -0.105, -0.13, -1, p.earL, true, 0.55);

  paintFur(ctx, {
    outline: ovalOutline(0, 0, SIDE_HEAD_RX, SIDE_HEAD_RY, 0, 6.1, 0.05),
    blobs: HEAD_BLOBS.map((b) => ({ ...b, x: b.x * 0.7 + 0.02, y: b.y })),
    base: 'black',
    seed: 131,
    fringe: 0.032,
    strokes: 130,
    strokeLen: 0.055,
    flowFrom: { x: -0.05, y: -0.05 },
  });

  // Muzzle wedge out front — the profile silhouette lives or dies on this shape.
  paintFur(ctx, {
    outline: [
      { x: 0.02, y: -0.02 },
      { x: 0.12, y: -0.005 },
      { x: 0.175, y: 0.035 },
      { x: 0.17, y: 0.085 },
      { x: 0.1, y: 0.115 },
      { x: 0.0, y: 0.115 },
      { x: -0.05, y: 0.06 },
    ],
    blobs: [{ x: 0.08, y: 0.06, rx: 0.11, ry: 0.07, tone: 'cream', seed: 8.1 }],
    base: 'cream',
    seed: 141,
    fringe: 0.022,
    strokes: 60,
    strokeLen: 0.045,
    flowFrom: { x: -0.05, y: 0 },
  });

  const noseX = 0.168;
  const noseY = 0.045;
  ctx.fillStyle = NOSE_PINK;
  ctx.beginPath();
  ctx.ellipse(noseX, noseY, 0.022, 0.018, deg(-15), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(SHADOW_INK, 0.45);
  ctx.beginPath();
  ctx.ellipse(noseX - 0.004, noseY + 0.004, 0.007, 0.005, deg(-15), 0, TWO_PI);
  ctx.fill();

  const openness = clamp01(p.mouth);
  if (openness > 0.05) {
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.moveTo(0.155, 0.072);
    ctx.quadraticCurveTo(0.1, 0.08 + 0.06 * openness, 0.03, 0.075 + 0.03 * openness);
    ctx.quadraticCurveTo(0.09, 0.06, 0.155, 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = FANG_WHITE;
    ctx.beginPath();
    ctx.moveTo(0.128, 0.066);
    ctx.lineTo(0.118, 0.066 + 0.045 * openness);
    ctx.lineTo(0.108, 0.064);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = rgba(COAT.black.dark, 0.6);
    ctx.lineWidth = 0.007;
    ctx.beginPath();
    ctx.moveTo(0.152, 0.068);
    ctx.quadraticCurveTo(0.11, 0.082, 0.06, 0.072);
    ctx.stroke();
  }
  if (p.tongue > 0.05) {
    ctx.fillStyle = TONGUE_PINK;
    ctx.beginPath();
    ctx.ellipse(0.16, 0.085 + 0.02 * p.tongue, 0.022 * p.tongue + 0.008, 0.016, deg(20), 0, TWO_PI);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(0.062, -0.012);
  ctx.scale(0.78, 0.82);
  drawEye(ctx, 0, 0, 1, p.eyeOpen, p.pupil, 0.4);
  ctx.restore();
  drawWhiskers(ctx, 0.135, 0.05, 1, p.headBow + 0.4, 0.62);
  drawEar(ctx, -0.035, -0.15, 1, p.earR, false, 0.5);

  ctx.restore();
}

export function drawCatSide(ctx: Ctx, p: CatPose): void {
  const cx = SIDE_BODY_CX + p.sway;
  const cy = SIDE_BODY_CY + p.bob + lerp(0, 0.05, p.sit);
  const rx = SIDE_BODY_RX * (1 + p.breathe * 0.02);
  const ry = SIDE_BODY_RY * p.squash * (1 + p.breathe * 0.05);

  ctx.save();
  drawGroundShadow(ctx, cx, GROUND_Y + 0.045, 0.4 * p.shadow, 0.09 * p.shadow);
  // A downed cat rolls about her own barrel, not about the floor, so the pose
  // that drops her onto her side is `bob` plus a roll around the body centre.
  ctx.translate(cx, cy);
  ctx.rotate(p.roll);
  ctx.translate(-cx, -cy);
  ctx.rotate(p.lean);

  const shoulderY = cy + SIDE_LIMB_Y - 0.16;
  const hipY = cy + SIDE_LIMB_Y - 0.14;

  // Far legs sit in the body's shadow, which is what separates the pairs.
  const farShade = 0.3;
  drawSideLimb(
    ctx,
    SIDE_HIP_X + 0.02,
    hipY,
    SIDE_HIP_X + p.hindL.dx + 0.02,
    GROUND_Y + p.hindL.dy,
    SIDE_HIND_UPPER,
    SIDE_HIND_LOWER,
    1,
    farShade,
    0,
  );
  drawSideLimb(
    ctx,
    SIDE_SHOULDER_X - 0.02,
    shoulderY,
    SIDE_SHOULDER_X + p.frontL.dx - 0.02,
    GROUND_Y + p.frontL.dy,
    SIDE_FORE_UPPER,
    SIDE_FORE_LOWER,
    -1,
    farShade,
    0,
  );

  drawTail(ctx, cx - rx * 0.95 + p.tail.rootX, cy + 0.02 + p.tail.rootY, p.tail);

  paintFur(ctx, {
    outline: ovalOutline(
      SIDE_HAUNCH_X + cx,
      SIDE_HAUNCH_Y + cy,
      0.2,
      0.19,
      deg(-8),
      16.3,
      0.07,
      40,
    ),
    blobs: HAUNCH_BLOBS.map((b) => ({
      ...b,
      x: b.x + SIDE_HAUNCH_X + cx,
      y: b.y + SIDE_HAUNCH_Y + cy,
    })),
    base: 'black',
    seed: 151,
    fringe: 0.05,
    strokes: 110,
    strokeLen: 0.065,
    flowFrom: { x: cx, y: cy - 0.1 },
  });

  paintFur(ctx, {
    outline: ovalOutline(cx, cy, rx, ry, deg(-3), 2.1, 0.06),
    blobs: BODY_BLOBS.map((b) => ({ ...b, x: b.x * 1.15 + cx, y: b.y * 0.85 + cy })),
    base: 'black',
    seed: 161,
    fringe: 0.045,
    strokes: 230,
    strokeLen: 0.07,
    flowFrom: { x: cx - 0.1, y: cy - ry },
  });

  // The belly pouch: the giveaway that she is not a lean cat.
  paintFur(ctx, {
    outline: ovalOutline(cx - 0.02, cy + ry * 0.75, rx * 0.62, 0.1, deg(2), 9.7, 0.08, 32),
    blobs: [{ x: cx - 0.02, y: cy + ry * 0.75, rx: rx * 0.5, ry: 0.08, tone: 'cream', seed: 6.3 }],
    base: 'cream',
    seed: 171,
    fringe: 0.05,
    strokes: 70,
    strokeLen: 0.06,
    flowFrom: { x: cx, y: cy },
    shade: 0.12,
  });

  paintFur(ctx, {
    outline: ovalOutline(
      SIDE_CHEST_X + cx,
      SIDE_CHEST_Y + cy,
      0.165,
      0.175,
      deg(6),
      11.2,
      0.09,
      36,
    ),
    blobs: [
      {
        x: SIDE_CHEST_X + cx,
        y: SIDE_CHEST_Y + cy + 0.02,
        rx: 0.1,
        ry: 0.11,
        tone: 'cream',
        seed: 7.8,
      },
      {
        x: SIDE_CHEST_X + cx - 0.06,
        y: SIDE_CHEST_Y + cy - 0.08,
        rx: 0.07,
        ry: 0.06,
        tone: 'ginger',
        seed: 2.9,
      },
    ],
    base: 'black',
    seed: 181,
    fringe: 0.055,
    strokes: 100,
    strokeLen: 0.07,
    flowFrom: { x: cx, y: cy - 0.15 },
  });

  drawSideLimb(
    ctx,
    SIDE_HIP_X,
    hipY,
    SIDE_HIP_X + p.hindR.dx,
    GROUND_Y + p.hindR.dy,
    SIDE_HIND_UPPER,
    SIDE_HIND_LOWER,
    1,
    0,
    p.hindR.claw,
  );
  drawSideLimb(
    ctx,
    SIDE_SHOULDER_X,
    shoulderY,
    SIDE_SHOULDER_X + p.frontR.dx,
    GROUND_Y + p.frontR.dy,
    SIDE_FORE_UPPER,
    SIDE_FORE_LOWER,
    -1,
    0,
    p.frontR.claw,
  );

  drawHeadSide(ctx, p);

  if (p.cast > 0.02) {
    drawCastOrb(
      ctx,
      SIDE_SHOULDER_X + p.frontR.dx + 0.06,
      GROUND_Y + p.frontR.dy - 0.05,
      p.cast,
      p.castRelease,
      p.time,
    );
  }
  if (p.slash !== null) {
    drawSlashArc(ctx, SIDE_SHOULDER_X + 0.16, cy - 0.06, 0, p.slash, 0.3);
  }
  drawSparkles(ctx, p.sparkle, p.time);

  ctx.restore();
}
