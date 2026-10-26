/**
 * The painter library behind a cat's sprite sheet.
 *
 * The silhouette is built from overlapping ovals rather than one clean body
 * shape: a low round barrel, a heavy rump, a chest ruff and cheek ruffs that
 * break the head outline. Every shape is painted by the same fur engine: a
 * wobbled outline, a fringe of tufts poking past it, coat patches painted
 * inside a clip, then a few hundred individual hair strokes that take their
 * colour from whichever patch they start in, which is what softens the patch
 * borders into the brindled mottling a real tortie has.
 *
 * Which cat is painted — her coat tones and patches, her face, her proportions
 * and her fur — is the `CatLook` every painter is handed; nothing here names a
 * colour of hers.
 *
 * All three viewpoints (toward the camera, away, and profile) share the fur
 * engine and the pose struct; only the anatomy differs.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen. The profile view faces +X; facing west it is painted
 * mirrored with her other flank's coat, never flipped at runtime.
 */

import type {
  CatDressing,
  CatHeadLandmarks,
  CatNeckFrame,
  CatSide,
  CatTailFrame,
} from './catParts';
import type {
  CatBlaze,
  CatFlankCoat,
  CatHindHock,
  CatLook,
  CatRimLight,
  CatTailCoat,
} from '../looks/catLook';

type Ctx = CanvasRenderingContext2D;

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

/**
 * One colour of coat, as the fur engine shades it: hair strokes lighten toward
 * `light` and darken toward `dark`. A look declares and names its own tones.
 */
export interface CoatTone {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
}

const RIM_LIGHT = '#c8d8ff';
const SHADOW_INK = '#0d0a08';

/** A coat patch: a wobbled ellipse of one coat tone. */
export interface CoatBlob {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tone: CoatTone;
  readonly seed: number;
  /**
   * The share of the patch's radius, from its edge inward, over which it fades
   * into the coat under it; absent or 0 for a crisp edge. A tortoiseshell's
   * colours drift into each other, and crisp-edged patches small enough to be
   * brindle turn to speckle at the 32 px tile.
   */
  readonly feather?: number;
}

/** One piece's coat: its ground tone, and the patches over it, later ones painted over earlier. */
export interface CoatLayout {
  readonly base: CoatTone;
  readonly blobs: readonly CoatBlob[];
}

/**
 * Patches authored in a unit frame, placed in a painter's own: each centre is
 * scaled by `scale` about `origin`, each radius by `scale`.
 */
function placeBlobs(blobs: readonly CoatBlob[], origin: Pt, scale: Pt): CoatBlob[] {
  return blobs.map((b) => ({
    ...b,
    x: origin.x + b.x * scale.x,
    y: origin.y + b.y * scale.y,
    rx: b.rx * scale.x,
    ry: b.ry * scale.y,
  }));
}

const UNIT_ORIGIN: Pt = { x: 0, y: 0 };

const BLOB_MOTTLE_MAJOR = 0.19;
const BLOB_MOTTLE_MINOR = 0.11;
const BLOB_MOTTLE_MAJOR_LOBES = 3;
const BLOB_MOTTLE_MINOR_LOBES = 7;
const BLOB_STEPS = 36;
/** A feathered patch keeps this much of its colour at its nominal edge, fading out past it to its wobble's reach. */
const FEATHER_EDGE_ALPHA = 0.35;
/** How much of a patch's edge wobble its feathering takes out, at full feather. */
const FEATHER_WOBBLE_DAMPING = 0.7;

/** The ragged radius of a patch at a given angle. Painting and hit-testing share it. */
function blobRadiusFactor(blob: CoatBlob, angle: number): number {
  // A feathered patch is a soft cloud: its edge wobbles less, or the fade
  // reads as a stain with a ragged rim.
  const wobble = 1 - clamp01(blob.feather ?? 0) * FEATHER_WOBBLE_DAMPING;
  return (
    1 +
    wobble *
      (BLOB_MOTTLE_MAJOR * Math.sin(angle * BLOB_MOTTLE_MAJOR_LOBES + blob.seed) +
        BLOB_MOTTLE_MINOR * Math.sin(angle * BLOB_MOTTLE_MINOR_LOBES - blob.seed * 2))
  );
}

/**
 * How much of a patch's colour lies at a point, 0–1: the same fade
 * {@link fillBlob} paints, so hair laid over a feathered edge takes its colour
 * softly instead of drawing the hard edge back in.
 */
function blobCoverage(blob: CoatBlob, x: number, y: number): number {
  const dx = x - blob.x;
  const dy = y - blob.y;
  const angle = Math.atan2(dy, dx);
  const reach = Math.hypot(dx / blob.rx, dy / blob.ry);
  if (reach >= blobRadiusFactor(blob, angle)) return 0;
  const feather = clamp01(blob.feather ?? 0);
  if (feather === 0) return 1;
  const solidUntil = 1 - feather;
  if (reach <= solidUntil) return 1;
  if (reach <= 1) return lerp(1, FEATHER_EDGE_ALPHA, (reach - solidUntil) / feather);
  return lerp(FEATHER_EDGE_ALPHA, 0, (reach - 1) / (BLOB_MAX_REACH - 1));
}

function mixTone(under: CoatTone, over: CoatTone, share: number): CoatTone {
  if (share >= 1) return over;
  return {
    base: mix(under.base, over.base, share),
    dark: mix(under.dark, over.dark, share),
    light: mix(under.light, over.light, share),
  };
}

/** Which tone a point lands on, feathered patches blended in. Later patches paint over earlier ones. */
export function toneAt(blobs: readonly CoatBlob[], base: CoatTone, x: number, y: number): CoatTone {
  let tone = base;
  for (const blob of blobs) {
    const coverage = blobCoverage(blob, x, y);
    if (coverage > 0) tone = mixTone(tone, blob.tone, coverage);
  }
  return tone;
}

/** The patch's wobbled outline, centred on (cx, cy) with radii (rx, ry). */
function traceBlob(ctx: Ctx, blob: CoatBlob, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  for (let i = 0; i <= BLOB_STEPS; i++) {
    const angle = (i / BLOB_STEPS) * TWO_PI;
    const factor = blobRadiusFactor(blob, angle);
    const px = cx + Math.cos(angle) * rx * factor;
    const py = cy + Math.sin(angle) * ry * factor;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The furthest a patch's wobble reaches, as a multiple of its radius. */
const BLOB_MAX_REACH = 1 + BLOB_MOTTLE_MAJOR + BLOB_MOTTLE_MINOR;

function fillBlob(ctx: Ctx, blob: CoatBlob): void {
  const feather = clamp01(blob.feather ?? 0);
  if (feather === 0) {
    traceBlob(ctx, blob, blob.x, blob.y, blob.rx, blob.ry);
    ctx.fillStyle = blob.tone.base;
    ctx.fill();
    return;
  }
  // Painted as a round patch squashed to its height, so one radial gradient
  // fades it evenly all the way round.
  ctx.save();
  ctx.translate(blob.x, blob.y);
  ctx.scale(1, blob.ry / blob.rx);
  const reach = blob.rx * BLOB_MAX_REACH;
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  fade.addColorStop(0, blob.tone.base);
  fade.addColorStop((1 - feather) / BLOB_MAX_REACH, blob.tone.base);
  fade.addColorStop(1 / BLOB_MAX_REACH, rgba(blob.tone.base, FEATHER_EDGE_ALPHA));
  fade.addColorStop(1, rgba(blob.tone.base, 0));
  traceBlob(ctx, blob, 0, 0, blob.rx, blob.rx);
  ctx.fillStyle = fade;
  ctx.fill();
  ctx.restore();
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
/** How far each clump's tufts poke past its outline, before the look's own `fur.fringe` scales them. */
const PIECE_FRINGE = {
  ear: 0.022,
  paw: 0.02,
  limbColumn: 0.018,
  frontSkull: 0.03,
  frontCheek: 0.045,
  frontHaunch: 0.04,
  frontBarrel: 0.045,
  frontRuff: 0.055,
  backBarrel: 0.05,
  backHaunch: 0.045,
  sideLimb: 0.02,
  sideSkull: 0.032,
  sideMuzzle: 0.022,
  sideHaunch: 0.05,
  sideBarrel: 0.045,
  sideBelly: 0.05,
  sideChest: 0.055,
} as const;
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
    ctx.fillStyle = mix(mix(tone.base, tone.dark, 0.15 + 0.3 * roll), SHADOW_INK, shade);
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
    const colors = toneAt(part.blobs, part.base, x, y);
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
  ctx.fillStyle = mix(part.base.base, SHADOW_INK, shade);
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
  /**
   * The share of her tail's length the picture shows, 0–1: under 1 while it
   * points toward or away from the camera, as a tail swung straight back
   * past her centreline does seen head-on or from behind.
   */
  readonly reach: number;
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
  /** Present while she holds something: a tool in her forepaws or a small thing in her jaws. */
  readonly grip?: CatGrip;
}

/**
 * Her painted slabs in the order a held thing can sit among them: the floor
 * shadow, her body and legs, her forepaws closed on a haft, her head. A held
 * thing under a slab is drawn after everything painted before that slab and
 * before the slab itself.
 */
export const CAT_SLABS = ['shadow', 'body', 'forepaws', 'head'] as const;
export type CatSlab = (typeof CAT_SLABS)[number];

/** A direction in camera space: x screen right, y screen down, z toward the camera. */
export interface CatDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What she holds on a frame, and how, as her own painter and her sockets both read it. */
export interface CatGrip {
  /**
   * The slab the held thing lies directly under: it and everything painted
   * after it is in front of the thing. Absent where the thing lies over all of
   * her, as a toy in her jaws does seen from the front or the side.
   */
  readonly under?: CatSlab;
  /** Both forepaws close on a haft: curled over it, claws hooked, beans showing. */
  readonly pawsClosed: boolean;
  /**
   * The held thing's direction, butt to head, in the pose's own frame facing
   * east (her lean and roll turn it with her): screen radians, and how far it
   * turns toward the camera as the sine of its angle out of the screen.
   */
  readonly haftAngle: number;
  readonly haftDepth: number;
  /** Which way the pads closed on it face, camera space facing east. */
  readonly padNormal: CatDirection;
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
    tail: { base: 0, curl: 0, wave: 0, phase: 0, puff: 0, flick: 0, rootX: 0, rootY: 0, reach: 1 },
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
const SIT_BODY_CY = 0.14;

const RUFF_CY = 0.0;

const HEAD_CY = -0.325;
/** How far the head sinks toward the chest at full bow — enough to reach a raised paw. */
const HEAD_BOW_DROP = 0.2;
const CHEEK_DX = 0.198;
const CHEEK_DY = 0.045;

const EAR_DX = 0.155;
const EAR_DY = -0.128;

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
/** Above this lift a hind paw is drawn in front of the body, not behind it. */
const HIND_HOIST_THRESHOLD = 0.5;
/**
 * Head-on, the hind pair stands a body-length further from the camera than the
 * front pair, so it is drawn smaller and deeper in shade. From behind the
 * relationship inverts: the forepaws are the far pair and barely clear the
 * flanks at all.
 */
const HIND_PAW_SCALE = 0.92;
/**
 * Whether her hind legs show as columns below her haunches head-on and from
 * behind: on a cat whose legs hold her above the engine's stance they always
 * do. Decided by the look, not the frame, so a breath cannot make them come
 * and go.
 */
function hindLegsShow(look: CatLook): boolean {
  return look.proportions.legLift.headOn > 0;
}

/** Head-on, each haunch's centre sits this far below her barrel's. */
const FRONT_HAUNCH_DROP = 0.12;
const HIND_PAW_SHADE = 0.22;
const BACK_FOREPAW_SPREAD = 1.35;
const BACK_FOREPAW_TUCK = 0.02;
const BACK_FOREPAW_SCALE = 0.85;
const BACK_FOREPAW_SHADE = 0.18;
const BACK_HIND_PAW_SPREAD = 0.78;
const BACK_HIND_PAW_SHADE = 0.05;

// ── Face ─────────────────────────────────────────────────────────────────────

const EAR_TUFT_COUNT = 7;
const EAR_TUFT_LEN = 0.055;
const WHISKER_COUNT = 4;
const WHISKER_LEN = 0.26;
const WHISKER_WIDTH = 0.006;
const BROW_WHISKER_COUNT = 2;
const WHISKER_ALPHA = 0.8;
const BROW_WHISKER_ALPHA = 0.55;
const EAR_TUFT_ALPHA = 0.55;
const WHISKER_DOT_INK_ALPHA = 0.35;
const EYE_GLINT_ALPHA = 0.92;
const EYE_BOUNCE_GLINT_ALPHA = 0.35;
const EYE_UPPER_LID_INK_ALPHA = 0.85;
const EYE_LOWER_LID_INK_ALPHA = 0.45;
const EYE_CORNER_INK_ALPHA = 0.6;
const FRONT_MOUTH_INK_ALPHA = 0.7;
const SIDE_MOUTH_INK_ALPHA = 0.6;
const WHISKER_DOTS_PER_SIDE = 3;
const WHISKER_DOT_COUNT = WHISKER_DOTS_PER_SIDE * 2;

/** How far up the ear the pale inside reaches by default, as a share of its height. */
const INNER_EAR_REACH = 0.74;

/**
 * @param ear which of her ears this is.
 * @param side -1 for the ear on screen left, +1 for the one on screen right.
 * @param tilt -1 flattened back against the skull, +1 pricked forward.
 */
function drawEar(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  ear: CatSide,
  cx: number,
  cy: number,
  side: number,
  tilt: number,
  back: boolean,
  widthScale = 1,
  heightScale = 1,
): void {
  const flatten = clamp01(-tilt);
  const prick = clamp01(tilt);
  const { halfWidth, height: earHeight, lean: restLean } = look.proportions.ear;
  const height = earHeight * heightScale * lerp(1, 0.55, flatten) * lerp(1, 1.08, prick);
  const lean = restLean * side + deg(30) * side * flatten - deg(8) * side * prick;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);
  ctx.scale(widthScale, 1);

  const tipX = 0;
  const tipY = -height;
  const tip: Pt = { x: tipX, y: tipY };
  // The base runs well below the anchor so the ear roots inside the skull
  // instead of perching on top of it.
  const innerBase: Pt = { x: -halfWidth * 1.05, y: 0.055 };
  const outerBase: Pt = { x: halfWidth * 0.95, y: 0.06 };
  const straight = look.proportions.ear.straightEdges;
  /** An edge point, pulled toward the straight line from its base corner to the tip. */
  const edge = (base: Pt, point: Pt): Pt => {
    const along = (base.y - point.y) / (base.y - tipY);
    return { x: lerp(point.x, lerp(base.x, tipX, along), straight), y: point.y };
  };
  const outline: Pt[] = [
    innerBase,
    edge(innerBase, { x: -halfWidth * 0.95, y: -height * 0.42 }),
    edge(innerBase, { x: tipX - halfWidth * 0.2, y: tipY + height * 0.06 }),
    tip,
    edge(outerBase, { x: halfWidth * 0.62, y: tipY + height * 0.26 }),
    edge(outerBase, { x: halfWidth, y: -height * 0.18 }),
    outerBase,
    { x: 0, y: 0.085 },
  ];

  const coat = back ? look.coat.ear.back : look.coat.ear.front;
  const fur: FurPart = {
    outline,
    blobs: placeBlobs(coat.blobs, UNIT_ORIGIN, { x: halfWidth, y: height }),
    base: coat.base,
    seed: 11 + side,
    fringe: PIECE_FRINGE.ear * look.fur.fringe,
    strokes: 40,
    strokeLen: 0.05 * look.fur.hairLength,
    flowFrom: { x: 0, y: 0.1 },
    shade: back ? 0.12 : 0,
  };
  dressing.part(ctx, 'head', { piece: 'ear', side: ear, fur, envelope: outline });

  if (!back) {
    const reach = look.face.innerEar.reach / INNER_EAR_REACH;
    ctx.beginPath();
    ctx.moveTo(-halfWidth * 0.4, 0.0);
    ctx.quadraticCurveTo(-halfWidth * 0.32, -height * 0.55 * reach, 0, -height * 0.74 * reach);
    ctx.quadraticCurveTo(halfWidth * 0.4, -height * 0.5 * reach, halfWidth * 0.44, 0.0);
    ctx.closePath();
    const innerGrad = ctx.createLinearGradient(0, -height, 0, 0);
    innerGrad.addColorStop(0, look.face.innerEar.dark);
    innerGrad.addColorStop(1, look.face.innerEar.light);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    ctx.strokeStyle = rgba(look.face.innerEar.furnishing, EAR_TUFT_ALPHA);
    ctx.lineWidth = 0.006;
    ctx.lineCap = 'round';
    for (let i = 0; i < EAR_TUFT_COUNT; i++) {
      const t = (i + 0.5) / EAR_TUFT_COUNT;
      const x = lerp(-halfWidth * 0.45, halfWidth * 0.45, t);
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
 * One eye at the look's size, scaled about its own centre so the lids and
 * the fur around it stay where the engine placed them.
 *
 * @param side -1 her right eye, +1 her left.
 * @param gaze horizontal pupil shift, -1 to 1.
 */
function drawEye(
  ctx: Ctx,
  look: CatLook,
  cx: number,
  cy: number,
  side: number,
  open: number,
  pupil: number,
  gaze: number,
): void {
  const scale = look.face.eyeScale;
  if (scale === 1) {
    paintEye(ctx, look, cx, cy, side, open, pupil, gaze);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  paintEye(ctx, look, 0, 0, side, open, pupil, gaze);
  ctx.restore();
}

function paintEye(
  ctx: Ctx,
  look: CatLook,
  cx: number,
  cy: number,
  side: number,
  open: number,
  pupil: number,
  gaze: number,
): void {
  const openness = clamp01(open);
  const { face } = look;

  if (openness < 0.12) {
    ctx.strokeStyle = face.ink;
    ctx.lineWidth = 0.011;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - EYE_RX * 0.9, cy);
    ctx.quadraticCurveTo(cx, cy + EYE_RY * 0.5, cx + EYE_RX * 0.9, cy);
    ctx.stroke();
    return;
  }

  const ry = EYE_RY * look.face.eyeRoundness * openness;
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
  iris.addColorStop(0, face.iris.inner);
  iris.addColorStop(0.55, face.iris.mid);
  iris.addColorStop(1, face.iris.outer);
  ctx.fillStyle = iris;
  ctx.fillRect(cx - EYE_RX * 1.2, cy - EYE_RY * 1.4, EYE_RX * 2.4, EYE_RY * 2.8);

  const pupilW = EYE_RX * lerp(0.16, 0.72, clamp01(pupil)) * look.proportions.pupilScale;
  const pupilH = ry * face.pupilHeight;
  const pupilX = cx + gaze * EYE_RX * 0.3;
  ctx.fillStyle = face.pupil;
  ctx.beginPath();
  ctx.ellipse(pupilX, cy, pupilW, pupilH, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(face.glint, EYE_GLINT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(cx - EYE_RX * 0.32, cy - ry * 0.42, EYE_RX * 0.19, ry * 0.24, deg(-20), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(face.glint, EYE_BOUNCE_GLINT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(cx + EYE_RX * 0.34, cy + ry * 0.4, EYE_RX * 0.12, ry * 0.16, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(SHADOW_INK, 0.28);
  ctx.fillRect(cx - EYE_RX * 1.2, cy - EYE_RY * 1.4, EYE_RX * 2.4, EYE_RY * 0.85 * (2 - openness));
  ctx.restore();

  ctx.strokeStyle = rgba(face.ink, EYE_UPPER_LID_INK_ALPHA);
  ctx.lineWidth = 0.009;
  ctx.beginPath();
  ctx.moveTo(cx - EYE_RX, cy + ry * 0.15);
  ctx.quadraticCurveTo(cx - EYE_RX * 0.3, cy - ry * 1.25, cx + EYE_RX * 0.75, cy - ry * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - EYE_RX * 0.95, cy + ry * 0.2);
  ctx.quadraticCurveTo(cx, cy + ry * 1.15, cx + EYE_RX * 0.7, cy + ry * 0.6);
  ctx.strokeStyle = rgba(face.ink, EYE_LOWER_LID_INK_ALPHA);
  ctx.stroke();

  // The outer corner tapers into a fur line the way a cat's eye does.
  ctx.strokeStyle = rgba(face.ink, EYE_CORNER_INK_ALPHA);
  ctx.lineWidth = 0.007;
  ctx.beginPath();
  ctx.moveTo(cx + side * EYE_RX * 0.9, cy - ry * 0.35);
  ctx.lineTo(cx + side * EYE_RX * 1.35, cy - ry * 0.75);
  ctx.stroke();
}

function drawWhiskers(
  ctx: Ctx,
  look: CatLook,
  cx: number,
  cy: number,
  side: number,
  droop: number,
  lengthScale = 1,
): void {
  ctx.save();
  const { whisker, whiskerAlternate } = look.face;
  ctx.lineWidth = WHISKER_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < WHISKER_COUNT; i++) {
    const alternate = whiskerAlternate !== null && i % 2 === 1;
    ctx.strokeStyle = rgba(
      alternate ? whiskerAlternate : whisker,
      WHISKER_ALPHA * look.face.whiskerAlpha,
    );
    const t = i / (WHISKER_COUNT - 1);
    const rise = lerp(-0.03, 0.028, t);
    const sag = lerp(-0.055, 0.075, t) + droop * 0.05;
    const len =
      WHISKER_LEN * lengthScale * look.face.whiskerLength * lerp(1, 0.78, Math.abs(t - 0.4));
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
  ctx.strokeStyle = rgba(look.face.whisker, BROW_WHISKER_ALPHA * look.face.browWhiskerAlpha);
  for (let i = 0; i < BROW_WHISKER_COUNT; i++) {
    const y = cy - 0.13 - i * 0.018 - look.face.browWhiskerRise;
    const rootX = cx + side * 0.03;
    ctx.save();
    ctx.translate(rootX, y);
    ctx.scale(look.face.browWhiskerLength, look.face.browWhiskerLength);
    ctx.translate(-rootX, -y);
    ctx.beginPath();
    ctx.moveTo(rootX, y);
    ctx.quadraticCurveTo(cx + side * 0.1, y - 0.05, cx + side * 0.16, y - 0.085);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Which way her own `side` lies on screen head-on: her left is screen right
 * facing the camera.
 */
function headOnScreenSign(side: CatSide): number {
  return side === 'left' ? 1 : -1;
}

/** Specks of a blaze's tone over the muzzle on its side, head-local units about the muzzle's centre. */
const BLAZE_SPECK_REACH_X = 0.075;
const BLAZE_SPECK_INNER_X = 0.008;
const BLAZE_SPECK_TOP = -0.05;
const BLAZE_SPECK_DEPTH = 0.075;
const BLAZE_SPECK_RADIUS = 0.009;
const BLAZE_SPECK_RADIUS_RANGE = 0.007;
const BLAZE_SPECK_SEED = 37;

function drawBlazeSpecks(ctx: Ctx, blaze: CatBlaze, cx: number, cy: number): void {
  const sign = headOnScreenSign(blaze.side);
  for (let i = 0; i < blaze.muzzleSpecks; i++) {
    const across = lerp(BLAZE_SPECK_INNER_X, BLAZE_SPECK_REACH_X, hash2(i, BLAZE_SPECK_SEED));
    const down = BLAZE_SPECK_TOP + BLAZE_SPECK_DEPTH * hash2(BLAZE_SPECK_SEED, i);
    const radius = BLAZE_SPECK_RADIUS + BLAZE_SPECK_RADIUS_RANGE * hash1(i + BLAZE_SPECK_SEED);
    ctx.fillStyle = i % 2 === 0 ? blaze.tone.base : blaze.tone.light;
    ctx.beginPath();
    ctx.arc(cx + sign * across, cy + down, radius, 0, TWO_PI);
    ctx.fill();
  }
}

/** Spots of a mottled nose: how many of each colour, and their size as a share of the nose's half-width. */
const NOSE_MOTTLE_SPOTS_PER_COLOUR = 4;
const NOSE_MOTTLE_RADIUS = 0.42;
const NOSE_MOTTLE_SEED = 53;

/** Spots scatter over this share of the nose's half-size, so none is cut in half by its edge. */
const NOSE_MOTTLE_SPREAD = 0.8;
/** A spot is this much taller than wide: the leather's grain runs down the nose. */
const NOSE_MOTTLE_STRETCH = 1.4;
/** Spreads each spot's angle hash away from its position hash. */
const NOSE_MOTTLE_ANGLE_SEED_STRIDE = 3;

/** Scatters `mottle` spots over a nose already traced as the current path, inside it. */
function drawNoseMottle(
  ctx: Ctx,
  mottle: readonly string[],
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): void {
  if (mottle.length === 0) return;
  ctx.save();
  ctx.clip();
  mottle.forEach((colour, c) => {
    ctx.fillStyle = colour;
    for (let i = 0; i < NOSE_MOTTLE_SPOTS_PER_COLOUR; i++) {
      const seed = NOSE_MOTTLE_SEED + c * NOSE_MOTTLE_SPOTS_PER_COLOUR + i;
      ctx.beginPath();
      ctx.ellipse(
        cx + (hash1(seed) * 2 - 1) * halfWidth * NOSE_MOTTLE_SPREAD,
        cy + (hash2(seed, c) * 2 - 1) * halfHeight * NOSE_MOTTLE_SPREAD,
        halfWidth * NOSE_MOTTLE_RADIUS,
        halfHeight * NOSE_MOTTLE_RADIUS * NOSE_MOTTLE_STRETCH,
        hash1(seed * NOSE_MOTTLE_ANGLE_SEED_STRIDE) * Math.PI,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  });
  ctx.restore();
}

/**
 * Her snaggle tooth head-on: a slim canine hanging over her lower lip, its
 * root on the lip line this far from the middle of her mouth, head units.
 */
const FRONT_TOOTH_DX = 0.05;
/** A canine is a narrow, slightly curved point, small against her head. */
const TOOTH_HALF_WIDTH = 0.007;
const TOOTH_LENGTH = 0.03;
/** The tip curves this far toward the middle of her mouth, as a share of the tooth's length. */
const TOOTH_CURVE = 0.22;
/**
 * The fewest pixels of the surface it is painted on the tooth spans across:
 * one, which the figure cache's 2× supersample blends into a single soft
 * light pixel of the picture shown — a hint of a fang, not a white dot.
 * Large, the slim tooth is drawn as it is.
 */
const TOOTH_MIN_SURFACE_PX = 1;
/** At its smallest it is a pixel and a half long, so its point still hangs below the lip. */
const TOOTH_MIN_LENGTH_SHARE = 1.5;

/**
 * How far down the tooth each edge keeps its width before running in to the
 * point, as shares of its length: the outer edge fuller than the inner, which
 * is what curves a canine.
 */
const TOOTH_OUTER_BELLY = 0.6;
const TOOTH_INNER_BELLY = 0.45;

/**
 * A canine from a root on `rootY`, `halfWidth` either side of `rootX`,
 * tapering to a point `length` below that curves `curve` (signed, along x)
 * as it goes — never smaller than a pixel of the surface's picture.
 */
function drawFang(
  ctx: Ctx,
  colour: string,
  rootX: number,
  rootY: number,
  halfWidth: number,
  length: number,
  curve: number,
): void {
  const placed = ctx.getTransform();
  const surfacePxPerUnit = Math.hypot(placed.a, placed.b);
  const minimum = TOOTH_MIN_SURFACE_PX / surfacePxPerUnit;
  const half = Math.max(halfWidth, minimum / 2);
  const long = Math.max(length, minimum * TOOTH_MIN_LENGTH_SHARE);
  const tipX = rootX + curve * long;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(rootX - half, rootY);
  ctx.quadraticCurveTo(rootX - half, rootY + long * TOOTH_OUTER_BELLY, tipX, rootY + long);
  ctx.quadraticCurveTo(rootX + half, rootY + long * TOOTH_INNER_BELLY, rootX + half, rootY);
  ctx.closePath();
  ctx.fill();
}

/** The head-on muzzle at the look's width, narrowed about its own middle so it stays under her nose. */
function drawMuzzleFront(
  ctx: Ctx,
  look: CatLook,
  cx: number,
  cy: number,
  mouth: number,
  tongue: number,
): void {
  const width = look.proportions.muzzleWidth;
  if (width === 1) {
    drawMuzzle(ctx, look, cx, cy, mouth, tongue);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(width, 1);
  drawMuzzle(ctx, look, 0, 0, mouth, tongue);
  ctx.restore();
}

function drawMuzzle(
  ctx: Ctx,
  look: CatLook,
  cx: number,
  cy: number,
  mouth: number,
  tongue: number,
): void {
  const { face } = look;
  const padRx = 0.072;
  const padRy = 0.05;
  for (const side of [-1, 1]) {
    const px = cx + side * 0.045;
    const grad = ctx.createRadialGradient(px, cy - padRy * 0.4, 0.005, px, cy, padRx);
    grad.addColorStop(0, face.muzzlePads.light);
    grad.addColorStop(1, face.muzzlePads.base);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(px, cy, padRx, padRy, 0, 0, TWO_PI);
    ctx.fill();
  }
  if (face.blaze !== null) drawBlazeSpecks(ctx, face.blaze, cx, cy);

  // Whisker dots read as pores at review scale and vanish in-game, which is right.
  ctx.fillStyle = rgba(face.ink, WHISKER_DOT_INK_ALPHA);
  for (let i = 0; i < WHISKER_DOT_COUNT; i++) {
    const side = i < WHISKER_DOTS_PER_SIDE ? -1 : 1;
    const k = i % WHISKER_DOTS_PER_SIDE;
    ctx.beginPath();
    ctx.arc(cx + side * (0.028 + k * 0.022), cy - 0.012 + k * 0.014, 0.004, 0, TWO_PI);
    ctx.fill();
  }

  const noseY = cy - NOSE_DY + look.proportions.noseDrop;
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
  noseGrad.addColorStop(0, face.nose.light);
  noseGrad.addColorStop(1, face.nose.dark);
  ctx.fillStyle = noseGrad;
  ctx.fill();
  drawNoseMottle(ctx, face.nose.mottle, cx, noseY, NOSE_W, NOSE_H);
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
    ctx.fillStyle = face.mouth;
    ctx.beginPath();
    ctx.moveTo(cx - w, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + h * 1.6, cx + w, mouthY);
    ctx.quadraticCurveTo(cx, mouthY - h * 0.3, cx - w, mouthY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = face.fang;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * w * 0.62, mouthY);
      ctx.lineTo(cx + side * w * 0.4, mouthY + h * 0.85);
      ctx.lineTo(cx + side * w * 0.28, mouthY + 0.002);
      ctx.closePath();
      ctx.fill();
    }

    if (tongue > 0.05) {
      ctx.fillStyle = face.tongue;
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
    ctx.strokeStyle = rgba(face.ink, FRONT_MOUTH_INK_ALPHA);
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
      ctx.fillStyle = face.tongue;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY + 0.022 * tongue + 0.012, 0.018, 0.022 * tongue, 0, 0, TWO_PI);
      ctx.fill();
    }
  }

  const tooth = face.tooth;
  if (tooth !== null) {
    const sign = headOnScreenSign(tooth.side);
    drawFang(
      ctx,
      tooth.colour,
      cx + sign * FRONT_TOOTH_DX,
      cy + FRONT_MOUTH_BELOW_MUZZLE,
      TOOTH_HALF_WIDTH,
      TOOTH_LENGTH,
      -sign * TOOTH_CURVE,
    );
  }
}

// ── Paws and limbs ───────────────────────────────────────────────────────────

const CLAW_LEN = 0.055;
const CLAW_COUNT = 4;
const TOE_COUNT = 3;
const TOE_LINE_ALPHA = 0.65;
const CLAW_ALPHA = 0.95;
/** Claws out less than this are drawn sheathed. */
const SHEATHED_CLAW = 0.02;
const PAW_ANKLE_SHADE_ALPHA = 0.42;
/** How far the toes bulge past the ankle's width. */
const PAW_TOE_BULGE = 0.3;
const PAW_OUTLINE_STEPS = 30;
/** A head-on limb column's half-width, before its fur wobbles it. */
const LIMB_COLUMN_HALF_WIDTH = 0.052;

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

/** Which pair a leg belongs to, as the dressing names its part. */
type LegPart = 'foreleg' | 'hindleg';

/**
 * A fluffy paw seen from the front, with toe tufts and optional claws.
 * @param angle rotation of the paw, used when a leg reaches across the body.
 */
function drawPaw(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  leg: LegPart,
  legSide: CatSide,
  x: number,
  y: number,
  angle: number,
  claw: number,
  scale = 1,
  shade = 0,
  closed = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const sized = scale * look.proportions.pawScale;
  ctx.scale(sized, sized);

  if (claw > SHEATHED_CLAW && !closed) drawClaws(ctx, look, claw);

  const pawCoat = look.coat.headOn.paw;
  const pawFur: FurPart = {
    outline: pawOutline(5.5 + x * 7),
    blobs: pawCoat.blobs,
    base: pawCoat.base,
    seed: 21 + x * 13 + y * 3,
    fringe: PIECE_FRINGE.paw * look.fur.fringe,
    strokes: 34,
    strokeLen: 0.04 * look.fur.hairLength,
    flowFrom: { x: 0, y: -PAW_RY * 2 },
    shade,
  };
  dressing.part(ctx, leg, {
    piece: 'paw',
    side: legSide,
    radiusX: PAW_RX,
    radiusY: PAW_RY,
    claw: closed || claw <= SHEATHED_CLAW ? 0 : claw,
    shade,
    fur: pawFur,
    envelope: pawFur.outline,
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

  ctx.strokeStyle = rgba(look.paws.toeLine, TOE_LINE_ALPHA);
  ctx.lineWidth = 0.006;
  ctx.lineCap = 'round';
  for (let i = 1; i < TOE_COUNT; i++) {
    const cx = lerp(-PAW_RX * 0.6, PAW_RX * 0.6, i / TOE_COUNT);
    ctx.beginPath();
    ctx.moveTo(cx, PAW_RY * 0.95);
    ctx.lineTo(cx * 0.7, PAW_RY * 0.1);
    ctx.stroke();
  }

  if (closed) {
    drawToeBeans(ctx, look);
    drawClaws(ctx, look, claw);
  }

  ctx.restore();
}

/** One claw of a forepaw, in the paw's frame: it roots at `root` and curls through `bend` to `tip`. */
export interface CatClaw {
  readonly root: Pt;
  readonly bend: Pt;
  readonly tip: Pt;
}

/** The claws spread across this share of the paw's half-width, the middle two longest. */
const CLAW_SPREAD = 0.8;
const CLAW_ROOT_Y = 0.3;
const CLAW_SHORTEST_SHARE = 0.75;
const CLAW_MIDDLE_EXTRA_SHARE = 0.4;
/** A claw curls forward of its root as it comes out: the hook at its bend, less so at its tip. */
const CLAW_BEND_FORWARD = 0.25;
const CLAW_BEND_DOWN = 0.7;
const CLAW_TIP_FORWARD = 0.15;

/**
 * Where each claw of a paw lies at `claw` (0 sheathed, 1 fully out), in the
 * paw's frame before its paw scale: what the paw paints, and what anything
 * worn over her claws is fitted to.
 */
export function catPawClaws(claw: number): readonly CatClaw[] {
  return Array.from({ length: CLAW_COUNT }, (_unused, i) => {
    const t = (i + 0.5) / CLAW_COUNT;
    const x = lerp(-PAW_RX * CLAW_SPREAD, PAW_RX * CLAW_SPREAD, t);
    const rootY = PAW_RY * CLAW_ROOT_Y;
    const len =
      CLAW_LEN * claw * (CLAW_SHORTEST_SHARE + CLAW_MIDDLE_EXTRA_SHARE * Math.sin(t * Math.PI));
    return {
      root: { x, y: rootY },
      bend: { x: x + len * CLAW_BEND_FORWARD, y: rootY + len * CLAW_BEND_DOWN },
      tip: { x: x + len * CLAW_TIP_FORWARD, y: rootY + len },
    };
  });
}

function drawClaws(ctx: Ctx, look: CatLook, claw: number): void {
  ctx.save();
  ctx.strokeStyle = rgba(look.paws.claw, CLAW_ALPHA);
  ctx.lineWidth = 0.011;
  ctx.lineCap = 'round';
  for (const { root, bend, tip } of catPawClaws(claw)) {
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(bend.x, bend.y, tip.x, tip.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Where the pads under her toes sit, showing where the toes curl over whatever the paw has closed on. */
const TOE_BEAN_ROW_Y = 0.78;
const TOE_BEAN_RX = 0.017;
const TOE_BEAN_RY = 0.012;
const TOE_BEAN_SPREAD = 0.62;

function drawToeBeans(ctx: Ctx, look: CatLook): void {
  ctx.save();
  ctx.fillStyle = look.paws.toeBean;
  for (let i = 0; i < TOE_COUNT; i++) {
    const t = i / (TOE_COUNT - 1);
    const bx = lerp(-PAW_RX * TOE_BEAN_SPREAD, PAW_RX * TOE_BEAN_SPREAD, t);
    ctx.beginPath();
    ctx.ellipse(bx, PAW_RY * TOE_BEAN_ROW_Y, TOE_BEAN_RX, TOE_BEAN_RY, 0, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** A limb column from shoulder or hip to paw — the fluff that hides the joint. */
function drawLimbColumn(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  leg: LegPart,
  legSide: CatSide,
  hipX: number,
  hipY: number,
  pawX: number,
  pawY: number,
  shade: number,
  near = false,
): void {
  const dx = pawX - hipX;
  const dy = pawY - hipY;
  const angle = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy);
  ctx.save();
  ctx.translate(hipX, hipY);
  ctx.rotate(angle - HALF_PI);
  const coat = look.coat.headOn.legColumn;
  const halfWidth = LIMB_COLUMN_HALF_WIDTH * look.proportions.limbWidth;
  const fur: FurPart = {
    outline: ovalOutline(0, len / 2, halfWidth, len / 2 + 0.015, 0, 9.1 + hipX * 5, 0.06, 30),
    blobs: placeBlobs(coat.blobs, UNIT_ORIGIN, { x: 1, y: len }),
    base: coat.base,
    seed: 31 + hipX * 11,
    fringe: PIECE_FRINGE.limbColumn * look.fur.fringe,
    strokes: 38,
    strokeLen: 0.045 * look.fur.hairLength,
    flowFrom: { x: 0, y: -0.2 },
    shade,
  };
  dressing.part(ctx, leg, {
    piece: 'column',
    side: legSide,
    length: len,
    halfWidth,
    shade,
    fur,
    envelope: fur.outline,
  });
  if (near) drawNearLegRim(ctx, look, fur.outline);
  ctx.restore();
}

/** A rim light is this many surface pixels wide; clipped to its part, half of it shows. */
const RIM_LIGHT_SURFACE_PX = 2;

/** The look's cool rim light along the inside of a near leg's outline, if it has one. */
function drawNearLegRim(ctx: Ctx, look: CatLook, outline: readonly Pt[]): void {
  drawRimLight(ctx, look.coat.nearLegRim, outline);
}

/** A rim light along the inside of `outline`, a fixed number of surface pixels wide at any bake density. */
function drawRimLight(ctx: Ctx, rim: CatRimLight | null, outline: readonly Pt[]): void {
  if (rim === null) return;
  const placed = ctx.getTransform();
  const surfacePxPerUnit = Math.hypot(placed.a, placed.b);
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  traceOutline(ctx, outline);
  ctx.strokeStyle = rgba(rim.colour, rim.alpha);
  ctx.lineWidth = RIM_LIGHT_SURFACE_PX / surfacePxPerUnit;
  ctx.stroke();
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

interface TailSpine {
  readonly points: readonly Pt[];
  readonly widths: readonly number[];
}

/**
 * Builds the tail as a chain of segments whose bend accumulates, plus a
 * travelling sine wave — a cat's tail never bends on a single hinge.
 */
function buildTailSpine(look: CatLook, baseX: number, baseY: number, tail: TailPose): TailSpine {
  const { length, baseWidth, tipWidth } = look.proportions.tail;
  const puffGain = look.fur.tailPuff;
  const points: Pt[] = [{ x: baseX, y: baseY }];
  const widths: number[] = [];
  const step = (length * tail.reach) / TAIL_SEGMENTS;
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
    const taper = lerp(baseWidth, tipWidth, t * t);
    const plume = 1 + puffGain * tail.puff + look.proportions.tail.swell * Math.sin(t * Math.PI);
    widths.push(taper * plume);
  }
  widths.push(tipWidth * (1 + puffGain * tail.puff));
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

/** Where the tail roots, from the body's centre, seen head-on. */
const FRONT_TAIL_ROOT: Pt = { x: 0.12, y: 0.16 };
/** Where the tail roots, from the body's centre, seen from behind. */
const BACK_TAIL_ROOT: Pt = { x: 0.16, y: 0.12 };
const TAIL_RING_COUNT = 5;
/** Ring radius as a multiple of the tail's half-width at that point. */
const TAIL_RING_SPREAD = 1.5;
/** Hairs drawn per tail segment. */
const TAIL_HAIRS_PER_SEGMENT = 9;
const TAIL_CONTOUR_WIDTH = 0.03;
const TAIL_CONTOUR_ALPHA = 0.5;
/** The tail's tufts at rest, before her `puff` fluffs them out. */
const TAIL_FRINGE = 0.05;

/** Hands her tail to the dressing: called behind or in front of the body, depending on the view. */
function drawTail(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  baseX: number,
  baseY: number,
  tail: TailPose,
  shade = 0,
): void {
  const spine = buildTailSpine(look, baseX, baseY, tail);
  dressing.part(ctx, 'tail', {
    piece: 'tail',
    spine: spine.points,
    widths: spine.widths,
    coat: look.coat.tail,
    fringe: TAIL_FRINGE * (1 + tail.puff) * look.fur.fringe,
    shade,
    envelope: tailOutline(spine),
  });
}

const TAIL_FLECK_SEED = 61;

/** The coat's flecks laid along the root end of `spine`, each across the tail at a seeded offset. */
function tailFlecks(coat: CatTailCoat, spine: TailSpine): CoatBlob[] {
  const flecks = coat.flecks;
  if (flecks === null) return [];
  const last = spine.points.length - 1;
  return Array.from({ length: flecks.count }, (_unused, i) => {
    // Placed between spine points rather than snapped to one, so a fleck
    // glides with the tail instead of hopping a segment between frames.
    const along = hash1(i + TAIL_FLECK_SEED) * flecks.reach * last;
    const index = Math.min(last - 1, Math.floor(along));
    const blend = along - index;
    const from = spine.points[index];
    const to = spine.points[index + 1];
    const point = { x: lerp(from.x, to.x, blend), y: lerp(from.y, to.y, blend) };
    const width = spine.widths[Math.min(index, spine.widths.length - 1)];
    const across = (hash2(i, TAIL_FLECK_SEED) - 0.5) * 2 * width;
    return {
      x: point.x + across,
      y: point.y + (hash2(TAIL_FLECK_SEED, i) - 0.5) * width,
      rx: width * flecks.size,
      ry: width * flecks.size,
      tone: flecks.tones[i % flecks.tones.length],
      seed: hash1(i * 2 + TAIL_FLECK_SEED) * TAIL_FLECK_SEED,
      feather: flecks.feather,
    };
  });
}

/** The tone of band `index` from the root: the coat's ring tones taken in turn. */
function ringTone(coat: CatTailCoat, index: number): CoatTone {
  return coat.rings[index % coat.rings.length];
}

/** Paints her tail's fur: banded rings along the spine, hairs lying along it. */
export function paintTailCoat(ctx: Ctx, frame: CatTailFrame): void {
  const spine: TailSpine = { points: frame.spine, widths: frame.widths };
  const outline = frame.envelope;
  const { x: baseX, y: baseY } = frame.spine[0];
  const { coat, fringe, shade } = frame;

  ctx.save();
  drawFringe(
    ctx,
    {
      outline,
      blobs: [],
      base: coat.base,
      seed: 41,
      fringe,
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
  ctx.fillStyle = mix(coat.base.base, SHADOW_INK, shade);
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  // Tail patches band along the spine rather than blotching.
  const rings: CoatBlob[] = [];
  for (let i = 0; i < TAIL_RING_COUNT; i++) {
    const t = (i + 0.5) / TAIL_RING_COUNT;
    const idx = Math.min(spine.points.length - 1, Math.round(t * (spine.points.length - 1)));
    const p = spine.points[idx];
    const tone = ringTone(coat, i);
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
  rings.push(...tailFlecks(coat, spine));
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
      const tone = toneAt(rings, coat.base, sx, sy);
      const light = hash2(k, i) > 0.4;
      ctx.strokeStyle = rgba(
        mix(tone.base, light ? tone.light : tone.dark, 0.5),
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
  drawRimLight(ctx, coat.rim, outline);

  drawFringe(
    ctx,
    {
      outline,
      blobs: [],
      base: coat.base,
      seed: 41,
      fringe,
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
/** The faintest charge the orb is painted at. */
const CAST_ORB_VISIBLE = 0.02;
/** The orb rides this far above the paws that cup it. */
const CAST_ORB_ABOVE_PAWS = 0.05;
/** In profile the orb rides this far ahead of her near forepaw. */
const SIDE_CAST_ORB_REACH = 0.06;
/** From behind, the orb's centre sits this share of her head's half-height below its centre. */
const BACK_CAST_ORB_UNDER_HEAD = 0.5;
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
  if (strength <= CAST_ORB_VISIBLE) return;
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

// ── Slabs and the held thing between them ────────────────────────────────────

/**
 * Lays her down slab by slab into her cell and, when she holds something
 * between two layers, every slab from the held thing's own onward into the
 * front layer as well, under the same transform. Painting the front slabs a
 * second time is what keeps the two layers in register: her fur is seeded
 * from the shape, so a slab painted twice is the same pixels twice.
 */
export class CatLayers {
  private inFront = false;

  constructor(
    readonly ctx: Ctx,
    private readonly front: Ctx | null = null,
    private readonly under: CatSlab | null = null,
  ) {}

  /** Paints one slab: into the cell, and into the front layer once the held thing is behind it. */
  slab(name: CatSlab, paint: (c: Ctx) => void): void {
    if (name === this.under) this.inFront = true;
    paint(this.ctx);
    const front = this.front;
    if (!this.inFront || front === null) return;
    const placed = this.ctx.getTransform();
    front.save();
    front.setTransform(placed.a, placed.b, placed.c, placed.d, placed.e, placed.f);
    paint(front);
    front.restore();
  }
}

/** The slab a pose's held thing lies under, if it lies under any. */
function heldUnder(p: CatPose): CatSlab | null {
  return p.grip?.under ?? null;
}

/**
 * The slab a head-on pose's held thing lies under on a cat looking like
 * `look`. A haft raised past her head is authored to lie under her head,
 * paws and all, where her paws close on it inside her face's outline; a
 * narrower face leaves a paw out past its edge, and that paw is in front of
 * the haft, so there it lies under her forepaws instead.
 */
export function catFrontHeldUnder(p: CatPose, look: CatLook): CatSlab | null {
  const under = heldUnder(p);
  if (under !== 'head') return under;
  const { head, cheek } = look.proportions;
  const faceHalfWidth = Math.max(head.rx, look.fur.cheekRuffs ? CHEEK_DX + cheek.rx : 0);
  const headX = headAnchor(p, look).x;
  const pawOutside = [-1, 1].some(
    (side) => Math.abs(frontForepawLocal(p, side).x - headX) > faceHalfWidth,
  );
  return pawOutside ? 'forepaws' : under;
}

/** Whether a pose's forepaws close on a haft. */
function pawsClosed(p: CatPose): boolean {
  return p.grip?.pawsClosed === true;
}

/** Claws half out, hooked over a haft she has closed her paws on. */
const CLOSED_PAW_CLAW = 0.55;

// ── Front view (walking toward the camera) ───────────────────────────────────

/**
 * Sat back on her haunches, longer legs raise her this share as far as
 * standing: her forelegs still stand under her chest, but her hind legs fold.
 */
const SITTING_LIFT_SHARE = 0.4;
/**
 * A roll this far has her lying on her side, legs no longer under her, so
 * they lift her no higher than any other cat lying down.
 */
const LYING_ROLL = deg(20);

/** How far `look`'s legs hold her barrel and head above the engine's stance in pose `p`, seen `view`. */
export function legLiftOf(p: CatPose, look: CatLook, view: 'headOn' | 'profile'): number {
  const standing = 1 - clamp01(Math.abs(p.roll) / LYING_ROLL);
  return look.proportions.legLift[view] * lerp(1, SITTING_LIFT_SHARE, p.sit) * standing;
}

/** Her barrel's centre head-on: where it sways and bobs to, whatever its size. */
function bodyCentre(p: CatPose, look: CatLook): { cx: number; cy: number } {
  return {
    cx: p.sway,
    cy: lerp(BODY_CY, SIT_BODY_CY, p.sit) + p.bob - legLiftOf(p, look, 'headOn'),
  };
}

function bodyMetrics(
  p: CatPose,
  look: CatLook,
): { cx: number; cy: number; rx: number; ry: number } {
  const { cx, cy } = bodyCentre(p, look);
  const body = look.proportions.body;
  const rx = lerp(body.rx, body.sittingRx, p.sit) * (1 + p.breathe * 0.03);
  const ry = lerp(body.ry, body.sittingRy, p.sit) * p.squash * (1 + p.breathe * 0.04);
  return { cx, cy, rx, ry };
}

/**
 * Where a collar sits, view by view: head-on just under her chin on the ruff,
 * from behind across her nape, in profile a band across the neck between her
 * chest ruff and her jaw, placed from the head so it follows every bob and bow.
 */
const FRONT_COLLAR_BELOW_HEAD = 0.24;
const FRONT_COLLAR_RX = 0.13;
/** A bowed head carries the collar no lower than this share of the ruff's half-height above its middle. */
const FRONT_COLLAR_LOWEST_ON_RUFF = 0.5;
const FRONT_COLLAR_RY = 0.035;
const BACK_COLLAR_BELOW_HEAD = 0.2;
const BACK_COLLAR_RX = 0.14;
const BACK_COLLAR_RY = 0.035;
const SIDE_COLLAR_OFFSET: Pt = { x: -0.07, y: 0.17 };
const SIDE_COLLAR_RX = 0.045;
const SIDE_COLLAR_RY = 0.12;
const SIDE_COLLAR_TILT = deg(-35);
const COLLAR_ENVELOPE_STEPS = 24;

function collarFrame(centre: Pt, rx: number, ry: number, tilt: number): CatNeckFrame {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const envelope: Pt[] = [];
  for (let i = 0; i < COLLAR_ENVELOPE_STEPS; i++) {
    const angle = (i / COLLAR_ENVELOPE_STEPS) * TWO_PI;
    const lx = Math.cos(angle) * rx;
    const ly = Math.sin(angle) * ry;
    envelope.push({ x: centre.x + lx * cos - ly * sin, y: centre.y + lx * sin + ly * cos });
  }
  return { piece: 'collar', band: { cx: centre.x, cy: centre.y, rx, ry }, tilt, envelope };
}

function headAnchor(p: CatPose, look: CatLook): Pt {
  const body = bodyCentre(p, look);
  return {
    x: body.cx + p.headX + p.headTurn * 0.035,
    y:
      lerp(HEAD_CY, HEAD_CY - 0.04, p.sit) +
      p.headY +
      p.bob * 0.6 +
      p.headBow * HEAD_BOW_DROP -
      legLiftOf(p, look, 'headOn') +
      look.proportions.neckDrop.headOn,
  };
}

/** A head turned fully narrows by this share, seen head-on. */
const HEAD_TURN_NARROWING = 0.08;
/** A head bowed fully lengthens by this share, seen head-on. */
const HEAD_BOW_STRETCH = 0.04;
/** A turned head slides its face this far across the skull, head-on. */
const HEAD_TURN_FACE_SLIDE = 0.05;
/** The closed mouth line sits this far under the muzzle's centre. */
const FRONT_MOUTH_BELOW_MUZZLE = 0.012;

/** How the head-on head is placed: where, at what tilt, and how squeezed. */
function frontHeadPlacement(
  p: CatPose,
  look: CatLook,
  back: boolean,
): { anchor: Pt; tilt: number; scaleX: number; scaleY: number } {
  const BACK_HEAD_SCALE = 0.9;
  const backView = look.proportions.backView;
  const backScale = back ? BACK_HEAD_SCALE * backView.headScale : 1;
  const backHeight = back ? backView.headHeight : 1;
  return {
    anchor: headAnchor(p, look),
    tilt: p.headTilt,
    scaleX: (1 - Math.abs(p.headTurn) * HEAD_TURN_NARROWING) * backScale,
    scaleY: (1 + p.headBow * HEAD_BOW_STRETCH) * backScale * backHeight,
  };
}

function rotatePoint(point: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * Her closed mouth in the head-on view, in pose space — placed by the same
 * head placement and body roll {@link drawCatFront} paints with, so art drawn
 * at her mouth follows it through every bob, bow and turn.
 */
export function catMouthFront(p: CatPose, look: CatLook): Pt {
  const head = frontHeadPlacement(p, look, false);
  const local = {
    x: p.headTurn * HEAD_TURN_FACE_SLIDE * head.scaleX,
    y: (MUZZLE_DY + FRONT_MOUTH_BELOW_MUZZLE) * head.scaleY,
  };
  const tilted = rotatePoint(local, head.tilt);
  return rotatePoint({ x: head.anchor.x + tilted.x, y: head.anchor.y + tilted.y }, p.roll);
}

/** Her own side of the head-on screen half `side` (-1 left, +1 right): mirrored from behind. */
function headOnSide(side: number, back: boolean): CatSide {
  const onScreenLeft = side < 0;
  return onScreenLeft === back ? 'left' : 'right';
}

/**
 * Where her shoulder blades ride on the top of her barrel head-on, as shares of its half-width out from the middle and of
 * its half-height above it, and their size as a share of the barrel's
 * half-width.
 */
const BLADE_SPREAD = 0.38;
const BLADE_RISE = 0.82;
const BLADE_SIZE = 0.32;
const BLADE_SEED = 23;
const BLADE_STROKES = 24;
const BLADE_STROKE_LENGTH = 0.05;
/** A blade is a little flatter than round, lying along her back. */
const BLADE_ASPECT = 0.8;
const BLADE_OUTLINE_WOBBLE = 0.06;
const BLADE_OUTLINE_STEPS = 24;
/** Keeps each blade's fur seed apart from its outline seed. */
const BLADE_FUR_SEED_STRIDE = 2;

/**
 * The blades over a cat's forelegs head-on, each riding up
 * by the look's `bladeRise` while the leg under it is planted and settling as
 * it swings: in a walk they rise and fall in turn on the top of her
 * silhouette, which is how a step shows from the front at the tile.
 */
function drawBladeBumps(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  barrel: { cx: number; cy: number; rx: number; ry: number },
  leftLift: number,
  rightLift: number,
): void {
  const rise = look.proportions.bladeRise;
  if (rise <= 0) return;
  const coat = look.coat.headOn.barrel;
  for (const [side, lift] of [
    [-1, leftLift],
    [1, rightLift],
  ] as const) {
    const cx = barrel.cx + side * barrel.rx * BLADE_SPREAD;
    const cy = barrel.cy - barrel.ry * BLADE_RISE - rise * (1 - clamp01(lift));
    const radius = barrel.rx * BLADE_SIZE;
    const outline = ovalOutline(
      cx,
      cy,
      radius,
      radius * BLADE_ASPECT,
      0,
      BLADE_SEED + side,
      BLADE_OUTLINE_WOBBLE,
      BLADE_OUTLINE_STEPS,
    );
    dressing.part(ctx, 'body', {
      piece: 'blade',
      side: null,
      shape: { cx, cy, rx: radius, ry: radius * BLADE_ASPECT },
      fur: {
        outline,
        blobs: coat.blobs.map((b) => ({ ...b, x: b.x + barrel.cx, y: b.y + barrel.cy })),
        base: coat.base,
        seed: BLADE_SEED + side * BLADE_FUR_SEED_STRIDE,
        fringe: PIECE_FRINGE.frontBarrel * look.fur.fringe,
        strokes: BLADE_STROKES,
        strokeLen: BLADE_STROKE_LENGTH * look.fur.hairLength,
        flowFrom: { x: cx, y: cy - radius },
      },
      envelope: outline,
    });
  }
}

/**
 * A head-on skull outline narrowed toward the chin: each point below the
 * skull's middle is pulled toward its centre line by `taper` of its width at
 * the chin, less higher up.
 */
function taperedTowardChin(
  outline: readonly Pt[],
  centreX: number,
  halfHeight: number,
  taper: number,
): readonly Pt[] {
  if (taper === 0) return outline;
  return outline.map((point) => {
    const below = clamp01(point.y / halfHeight);
    return { x: centreX + (point.x - centreX) * (1 - taper * below), y: point.y };
  });
}

/**
 * From behind, the skull narrows toward her nape by this share of the taper
 * her face narrows toward her chin: only a little, or it reads as a teardrop.
 */
const BACK_NAPE_TAPER_SHARE = 0.35;

/** Where her nape meets her back from behind, pose space: how low and how wide it ends. */
interface CatNapeEnd {
  readonly y: number;
  readonly halfWidth: number;
}

/**
 * The nape ends this share of the barrel's half-height above its middle, low
 * enough to run into the back rather than stop on it.
 */
const BACK_NAPE_END_RISE = 0.05;
/** The nape spreads to this share of the barrel's half-width where it meets the back. */
const BACK_NAPE_END_SPREAD = 0.98;
/** Where along the nape its sides turn from neck to shoulder slope. */
const NAPE_SHOULDER_TURN = 0.3;
/** At that turn the nape has spread this share of the way to its end width. */
const NAPE_SHOULDER_TURN_SPREAD = 0.45;

/**
 * The skull outline from behind with a nape: the arc under the skull narrower
 * than the nape gives way to a neck that flows down and out into the
 * shoulders, so the head grows out of the back instead of sitting on it.
 */
function withNape(
  outline: readonly Pt[],
  centreX: number,
  napeHalfWidth: number,
  end: CatNapeEnd,
): readonly Pt[] {
  const underNape = (point: Pt): boolean =>
    point.y > 0 && Math.abs(point.x - centreX) < napeHalfWidth;
  const first = outline.findIndex(underNape);
  if (first < 0) return outline;
  let last = first;
  while (last + 1 < outline.length && underNape(outline[last + 1])) last++;
  const neckTopY = Math.min(outline[first].y, outline[last].y);
  const turnY = lerp(neckTopY, end.y, NAPE_SHOULDER_TURN);
  const turnHalfWidth = lerp(napeHalfWidth, end.halfWidth, NAPE_SHOULDER_TURN_SPREAD);
  // The outline runs clockwise on screen, so the run under the skull goes from her screen right to left.
  const neck: Pt[] = [
    { x: centreX + napeHalfWidth, y: outline[first].y },
    { x: centreX + turnHalfWidth, y: turnY },
    { x: centreX + end.halfWidth, y: end.y },
    { x: centreX - end.halfWidth, y: end.y },
    { x: centreX - turnHalfWidth, y: turnY },
    { x: centreX - napeHalfWidth, y: outline[last].y },
  ];
  return [...outline.slice(0, first), ...neck, ...outline.slice(last + 1)];
}

/** How far a blaze's top and bottom slide across the face as her head turns, head-on. */
const BLAZE_TOP_TURN_SLIDE = 0.03;
const BLAZE_HAIR_COUNT = 21;
const BLAZE_BREAK_EVERY = 3;
const BLAZE_HAIR_ALPHA = 0.7;
const BLAZE_HAIR_SEED = 71;
/** Each hair lies down the blaze for this share of its length. */
const BLAZE_HAIR_LENGTH_SHARE = 0.15;

/**
 * Her blaze head-on: a stripe from her forehead to the top of her nose,
 * clipped to her skull, with hairs of its light tone lying down it.
 */
function drawBlazeFront(
  ctx: Ctx,
  blaze: CatBlaze,
  skull: readonly Pt[],
  skullHalfHeight: number,
  turn: number,
  noseDrop: number,
): void {
  const sign = headOnScreenSign(blaze.side);
  const topY = -skullHalfHeight * blaze.topShare;
  const bottomY = MUZZLE_DY - NOSE_DY - NOSE_H + noseDrop;
  const topX = sign * blaze.offsetTop + turn * BLAZE_TOP_TURN_SLIDE;
  const bottomX = sign * blaze.offsetBottom + turn * HEAD_TURN_FACE_SLIDE;
  const midY = (topY + bottomY) / 2;
  const midX = (topX + bottomX) / 2 + sign * blaze.bend;
  const midHalfWidth = (blaze.halfWidthTop + blaze.halfWidthBottom) / 2;
  ctx.save();
  traceOutline(ctx, skull);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(topX - blaze.halfWidthTop, topY);
  ctx.quadraticCurveTo(midX - midHalfWidth, midY, bottomX - blaze.halfWidthBottom, bottomY);
  ctx.lineTo(bottomX + blaze.halfWidthBottom, bottomY);
  ctx.quadraticCurveTo(midX + midHalfWidth, midY, topX + blaze.halfWidthTop, topY);
  ctx.closePath();
  ctx.globalAlpha = blaze.opacity;
  ctx.fillStyle = blaze.tone.base;
  ctx.fill();
  ctx.clip();
  ctx.lineWidth = FUR_STROKE_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < BLAZE_HAIR_COUNT; i++) {
    const t = hash1(i + BLAZE_HAIR_SEED);
    const bow = sign * blaze.bend * 2 * t * (1 - t);
    const x = lerp(topX, bottomX, t) + bow + (hash2(i, BLAZE_HAIR_SEED) - 0.5) * 2 * midHalfWidth;
    const y = lerp(topY, bottomY, t);
    // Every few hairs are her black coat's, crossing the stripe, so the blaze
    // breaks up the way a tortie's does rather than reading as a painted bar.
    const tone =
      i % BLAZE_BREAK_EVERY === 0 ? SHADOW_INK : i % 2 === 0 ? blaze.tone.light : blaze.tone.dark;
    ctx.strokeStyle = rgba(tone, BLAZE_HAIR_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + (bottomX - topX) * BLAZE_HAIR_LENGTH_SHARE,
      y + (bottomY - topY) * BLAZE_HAIR_LENGTH_SHARE,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeadFront(
  ctx: Ctx,
  p: CatPose,
  back: boolean,
  dressing: CatDressing,
  look: CatLook,
  napeEnd: CatNapeEnd | null = null,
): void {
  const { head: headSize, cheek: cheekSize } = look.proportions;
  const fringe = look.fur.fringe;
  const placement = frontHeadPlacement(p, look, back);
  const anchor = placement.anchor;
  const turn = p.headTurn;

  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(placement.tilt);
  ctx.scale(placement.scaleX, placement.scaleY);

  const earShiftL = turn * 0.03;
  const earDx =
    EAR_DX * look.proportions.earSpread * (back ? 1 - look.proportions.backView.earInset : 1);
  const leftEarRoot = { x: -earDx + earShiftL, y: EAR_DY };
  const rightEarRoot = { x: earDx + earShiftL, y: EAR_DY };
  const leftSide = headOnSide(-1, back);
  const rightSide = headOnSide(1, back);
  // Seen from behind her ears stand against the dome of her skull rather
  // than above her face, and a look may carry them taller there to read.
  const earHeight = back ? look.proportions.backView.earHeight : 1;
  drawEar(
    ctx,
    dressing,
    look,
    leftSide,
    leftEarRoot.x,
    leftEarRoot.y,
    -1,
    p.earL,
    back,
    1,
    earHeight,
  );
  drawEar(
    ctx,
    dressing,
    look,
    rightSide,
    rightEarRoot.x,
    rightEarRoot.y,
    1,
    p.earR,
    back,
    1,
    earHeight,
  );

  const headCoat = back ? look.coat.headOn.backOfHead : look.coat.headOn.face;
  const skullCentreX = turn * 0.02;
  const taperedSkull = taperedTowardChin(
    ovalOutline(skullCentreX, 0, headSize.rx, headSize.ry, 0, 2.6, 0.05),
    skullCentreX,
    headSize.ry,
    look.proportions.chinTaper * (back ? BACK_NAPE_TAPER_SHARE : 1),
  );
  const napeShare = look.proportions.backView.nape;
  const skull =
    back && napeEnd !== null && napeShare > 0
      ? withNape(taperedSkull, skullCentreX, headSize.rx * napeShare, {
          y: (napeEnd.y - anchor.y) / placement.scaleY,
          halfWidth: napeEnd.halfWidth / placement.scaleX,
        })
      : taperedSkull;
  dressing.part(ctx, 'head', {
    piece: 'skull',
    fur: {
      outline: skull,
      blobs: headCoat.blobs,
      base: headCoat.base,
      seed: 51,
      fringe: PIECE_FRINGE.frontSkull * fringe,
      strokes: 150,
      strokeLen: 0.055 * look.fur.hairLength,
      flowFrom: { x: 0, y: -0.05 },
      shade: back ? 0.1 : 0,
    },
    envelope: skull,
  });

  // Cheek ruffs break the skull outline; a long-haired cat's head is not an oval.
  const cheekSides = look.fur.cheekRuffs ? [-1, 1] : [];
  for (const side of cheekSides) {
    const cheekX = side * CHEEK_DX + turn * 0.05 * side;
    const cheek = ovalOutline(
      cheekX,
      CHEEK_DY,
      cheekSize.rx,
      cheekSize.ry,
      deg(side * 12),
      7.4 + side,
      0.09,
      34,
    );
    const cheekCoat =
      side < 0 ? look.coat.headOn.cheeks.screenLeft : look.coat.headOn.cheeks.screenRight;
    dressing.part(ctx, 'head', {
      piece: 'cheek',
      side: headOnSide(side, back),
      fur: {
        outline: cheek,
        blobs: placeBlobs(
          cheekCoat.blobs,
          { x: cheekX, y: CHEEK_DY },
          { x: cheekSize.rx, y: cheekSize.ry },
        ),
        base: cheekCoat.base,
        seed: 61 + side * 4,
        fringe: PIECE_FRINGE.frontCheek * fringe,
        strokes: 60,
        strokeLen: 0.06 * look.fur.hairLength,
        flowFrom: { x: 0, y: -0.02 },
        shade: back ? 0.12 : 0,
      },
      envelope: cheek,
    });
  }

  const eyeDx = EYE_DX * look.face.eyeSpread;
  const eyeY = EYE_DY + look.face.eyeDrop;
  const leftEye = { x: -eyeDx + turn * 0.05, y: eyeY };
  const rightEye = { x: eyeDx + turn * 0.05, y: eyeY };
  const landmarks: CatHeadLandmarks = {
    skull: { cx: skullCentreX, cy: 0, rx: headSize.rx, ry: headSize.ry },
    eyes: back ? [] : [leftEye, rightEye],
    eyeLine: eyeY,
    turn,
  };

  if (!back) {
    if (look.face.blaze !== null)
      drawBlazeFront(ctx, look.face.blaze, skull, headSize.ry, turn, look.proportions.noseDrop);
    const gaze = turn;
    drawEye(ctx, look, leftEye.x, leftEye.y, -1, p.eyeOpen, p.pupil, gaze);
    drawEye(ctx, look, rightEye.x, rightEye.y, 1, p.eyeOpen, p.pupil, gaze);

    // A pale mask around the muzzle, the way the cream runs up between the eyes.
    const mask = look.face.muzzleMask;
    if (mask !== null) {
      ctx.fillStyle = rgba(mask, 0.5);
      ctx.beginPath();
      ctx.ellipse(turn * 0.05, MUZZLE_DY - 0.01, 0.085, 0.07, 0, 0, TWO_PI);
      ctx.fill();
    }

    drawWhiskers(ctx, look, -0.03 + turn * 0.05, MUZZLE_DY, -1, p.headBow);
    drawWhiskers(ctx, look, 0.03 + turn * 0.05, MUZZLE_DY, 1, p.headBow);
    drawMuzzleFront(ctx, look, turn * HEAD_TURN_FACE_SLIDE, MUZZLE_DY, p.mouth, p.tongue);
  }
  dressing.part(ctx, 'head', { piece: 'features', landmarks, envelope: null });
  dressing.part(ctx, 'head', { piece: 'top', landmarks, envelope: null });

  ctx.restore();
}

function frontPawRest(p: CatPose, side: number): Pt {
  return {
    x: side * FRONT_PAW_DX * lerp(1, 0.78, p.sit) + p.sway * 0.6,
    y: FRONT_PAW_Y + p.bob * 0.25,
  };
}

function hindPawRest(p: CatPose, look: CatLook, side: number): Pt {
  return {
    x: side * HIND_PAW_DX * look.proportions.hindPawSpread * lerp(1, 1.06, p.sit) + p.sway * 0.4,
    y: HIND_PAW_Y + p.bob * 0.15,
  };
}

/**
 * The head-on forepaw's centre in the pose's own frame, before her body roll:
 * where the painter puts it and where a haft she grips runs under it.
 */
function frontForepawLocal(p: CatPose, side: number): Pt {
  const paw = side < 0 ? p.frontL : p.frontR;
  const rest = frontPawRest(p, side);
  return { x: rest.x + paw.dx, y: rest.y + paw.dy };
}

/** Her forepaw on screen half `side` (-1 left, +1 right) head-on, pose space, as the painter places it. */
export function catForepawFront(p: CatPose, side: number): Pt {
  return rotatePoint(frontForepawLocal(p, side), p.roll);
}

/** The middle of her face head-on, pose space, and its half-width: the eyes and muzzle, not the ears. */
export function catFaceFront(p: CatPose, look: CatLook): { centre: Pt; radius: number } {
  // Her face reaches as far down as her skull does, which on a narrow head is
  // further than it reaches across.
  const { rx, ry } = look.proportions.head;
  return { centre: rotatePoint(headAnchor(p, look), p.roll), radius: Math.max(rx, ry) };
}

/**
 * The cat seen head-on: the view used for walking toward the camera and for
 * every sit-down animation. `front` receives the slabs in front of anything
 * she holds.
 */
export function drawCatFront(
  ctx: Ctx,
  p: CatPose,
  dressing: CatDressing,
  look: CatLook,
  front: Ctx | null = null,
): void {
  const body = bodyMetrics(p, look);
  const coat = look.coat.headOn;
  const fringe = look.fur.fringe;
  const headSize = look.proportions.head;
  const ruffSize = look.proportions.ruff;
  const layers = new CatLayers(ctx, front, catFrontHeldUnder(p, look));
  const closed = pawsClosed(p);

  ctx.save();
  ctx.rotate(p.roll);

  layers.slab('shadow', (c) =>
    drawGroundShadow(c, p.sway * 0.5, GROUND_Y + 0.045, 0.34 * p.shadow, 0.09 * p.shadow),
  );

  layers.slab('body', (c) =>
    drawTail(
      c,
      dressing,
      look,
      body.cx + FRONT_TAIL_ROOT.x + p.tail.rootX,
      body.cy + FRONT_TAIL_ROOT.y + p.tail.rootY,
      p.tail,
    ),
  );

  const drawHindPaw = (c: Ctx, side: number): void => {
    const paw = side < 0 ? p.hindL : p.hindR;
    const rest = hindPawRest(p, look, side);
    const legSide = headOnSide(side, false);
    if (paw.lift > HIND_HOIST_THRESHOLD || hindLegsShow(look)) {
      drawLimbColumn(
        c,
        dressing,
        look,
        'hindleg',
        legSide,
        body.cx + side * body.rx * 0.75,
        body.cy + 0.14,
        rest.x + paw.dx,
        rest.y + paw.dy,
        0.06,
      );
    }
    drawPaw(
      c,
      dressing,
      look,
      'hindleg',
      legSide,
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
    layers.slab('body', (c) => {
      const { headOn, headOnStandingShare } = look.proportions.haunch;
      const shown = lerp(headOnStandingShare, 1, p.sit);
      const haunch = {
        cx: body.cx + side * (body.rx * 0.82),
        cy: body.cy + FRONT_HAUNCH_DROP,
        rx: headOn.rx * shown,
        ry: headOn.ry * shown,
      };
      const outline = ovalOutline(
        haunch.cx,
        haunch.cy,
        haunch.rx,
        haunch.ry,
        deg(side * -10),
        12.5 + side,
        0.08,
        34,
      );
      dressing.part(c, 'body', {
        piece: 'haunch',
        side: headOnSide(side, false),
        shape: haunch,
        fur: {
          outline,
          blobs: coat.haunch.blobs.map((b) => ({
            ...b,
            x: b.x + haunch.cx,
            y: b.y + body.cy + FRONT_HAUNCH_DROP,
          })),
          base: coat.haunch.base,
          seed: 71 + side * 5,
          fringe: PIECE_FRINGE.frontHaunch * fringe,
          strokes: 70,
          strokeLen: 0.06 * look.fur.hairLength,
          flowFrom: { x: body.cx, y: body.cy },
          shade: 0.08,
        },
        envelope: outline,
      });
      if (!hindLegIsHoisted(side)) drawHindPaw(c, side);
    });
  }

  layers.slab('body', (c) => {
    const barrel = ovalOutline(body.cx, body.cy, body.rx, body.ry, p.lean, 1.7, 0.06);
    dressing.part(c, 'body', {
      piece: 'barrel',
      side: null,
      shape: body,
      fur: {
        outline: barrel,
        blobs: coat.barrel.blobs.map((b) => ({ ...b, x: b.x + body.cx, y: b.y + body.cy })),
        base: coat.barrel.base,
        seed: 81,
        fringe: PIECE_FRINGE.frontBarrel * fringe,
        strokes: 240,
        strokeLen: 0.07 * look.fur.hairLength,
        flowFrom: { x: body.cx, y: body.cy - body.ry },
      },
      envelope: barrel,
    });

    drawBladeBumps(c, dressing, look, body, p.frontL.lift, p.frontR.lift);

    if (look.fur.ruff) {
      const ruff = { cx: body.cx, cy: body.cy + RUFF_CY - 0.06, rx: ruffSize.rx, ry: ruffSize.ry };
      const ruffOutline = ovalOutline(ruff.cx, ruff.cy, ruff.rx, ruff.ry, 0, 4.9, 0.1, 40);
      dressing.part(c, 'body', {
        piece: 'ruff',
        side: null,
        shape: ruff,
        fur: {
          outline: ruffOutline,
          blobs: coat.ruff.blobs.map((b) => ({ ...b, x: b.x + body.cx, y: b.y + body.cy - 0.06 })),
          base: coat.ruff.base,
          seed: 91,
          fringe: PIECE_FRINGE.frontRuff * fringe,
          strokes: 120,
          strokeLen: 0.075 * look.fur.hairLength,
          flowFrom: { x: body.cx, y: body.cy - 0.2 },
        },
        envelope: ruffOutline,
      });
    }

    for (const side of [-1, 1]) {
      if (hindLegIsHoisted(side)) drawHindPaw(c, side);
    }
  });

  const frontHead = headAnchor(p, look);
  /** Below the chin the forelimb passes behind the head; above it, in front. */
  const chinY = frontHead.y + headSize.ry * 0.6;
  const drawFrontColumn = (c: Ctx, side: number): void => {
    const pawAt = frontForepawLocal(p, side);
    drawLimbColumn(
      c,
      dressing,
      look,
      'foreleg',
      headOnSide(side, false),
      body.cx + side * 0.095,
      body.cy + 0.175,
      pawAt.x,
      pawAt.y,
      0.04,
      true,
    );
  };
  const drawFrontPaw = (c: Ctx, side: number): void => {
    const paw = side < 0 ? p.frontL : p.frontR;
    const pawAt = frontForepawLocal(p, side);
    drawPaw(
      c,
      dressing,
      look,
      'foreleg',
      headOnSide(side, false),
      pawAt.x,
      pawAt.y,
      deg(side * 6) + paw.lift * deg(side * 20),
      closed ? CLOSED_PAW_CLAW : paw.claw,
      1 + paw.lift * FRONT_PAW_FORESHORTEN,
      0,
      closed,
    );
  };
  const limbReachesFace = (side: number): boolean => frontForepawLocal(p, side).y < chinY;
  /**
   * Both columns before either paw when her paws close on a haft, so the haft
   * can pass over her forearms and under both paws.
   */
  const drawFrontLimbs = (atFace: boolean): void => {
    const sides = [-1, 1].filter((side) => limbReachesFace(side) === atFace);
    if (!closed) {
      for (const side of sides) {
        layers.slab('body', (c) => {
          drawFrontColumn(c, side);
          drawFrontPaw(c, side);
        });
      }
      return;
    }
    for (const side of sides) layers.slab('body', (c) => drawFrontColumn(c, side));
    for (const side of sides) layers.slab('forepaws', (c) => drawFrontPaw(c, side));
  };

  drawFrontLimbs(false);

  layers.slab('head', (c) => {
    dressing.part(
      c,
      'neck',
      collarFrame(
        {
          x: frontHead.x,
          y: Math.min(
            frontHead.y + FRONT_COLLAR_BELOW_HEAD,
            body.cy + RUFF_CY - 0.06 - ruffSize.ry * FRONT_COLLAR_LOWEST_ON_RUFF,
          ),
        },
        FRONT_COLLAR_RX,
        FRONT_COLLAR_RY,
        0,
      ),
    );
    drawContactShadow(
      c,
      frontHead.x,
      frontHead.y + headSize.ry * 0.95,
      headSize.rx * 1.15,
      0.07,
      0.35,
    );
    drawHeadFront(c, p, false, dressing, look);
  });

  // A paw held up to be washed has to sit in front of the muzzle it is being
  // washed against.
  drawFrontLimbs(true);

  layers.slab('head', (c) => {
    if (p.cast > CAST_ORB_VISIBLE) {
      const orbX = body.cx + (p.frontL.dx + p.frontR.dx) / 2;
      const orbY = frontPawRest(p, 0).y + (p.frontL.dy + p.frontR.dy) / 2 - CAST_ORB_ABOVE_PAWS;
      drawCastOrb(c, orbX, orbY, p.cast, p.castRelease, p.time);
    }
    if (p.slash !== null) {
      drawSlashArc(c, body.cx, body.cy - 0.06, HALF_PI, p.slash, 0.38);
    }
    drawSparkles(c, p.sparkle, p.time);
  });

  ctx.restore();
}

// ── Back view (walking away) ─────────────────────────────────────────────────

/** Her forepaw from behind, in the pose's own frame before her roll, where the painter puts it. */
function backForepawLocal(p: CatPose, side: number): Pt {
  const paw = side < 0 ? p.frontL : p.frontR;
  const rest = frontPawRest(p, side * BACK_FOREPAW_SPREAD);
  return { x: rest.x + paw.dx, y: rest.y + paw.dy - BACK_FOREPAW_TUCK };
}

/** Her forepaw on screen half `side` (-1 left, +1 right) from behind, pose space, as the painter places it. */
export function catForepawBack(p: CatPose, side: number): Pt {
  return rotatePoint(backForepawLocal(p, side), p.roll);
}

/** Where a raised forearm leaves her shoulders from behind, as a share of her barrel's half-size. */
const BACK_SHOULDER_SPREAD = 0.42;
const BACK_SHOULDER_RISE = 0.55;
const BACK_FORELEG_SHADE = 0.1;

export function drawCatBack(
  ctx: Ctx,
  p: CatPose,
  dressing: CatDressing,
  look: CatLook,
  front: Ctx | null = null,
): void {
  const body = bodyMetrics(p, look);
  const coat = look.coat.headOn;
  const fringe = look.fur.fringe;
  const headSize = look.proportions.head;
  const layers = new CatLayers(ctx, front, heldUnder(p));
  const closed = pawsClosed(p);
  /** Paws closed on a haft above her shoulders show over her back, forearms and all. */
  const raised = (side: number): boolean =>
    closed && backForepawLocal(p, side).y < body.cy - body.ry;

  ctx.save();
  ctx.rotate(p.roll);
  layers.slab('shadow', (c) =>
    drawGroundShadow(c, p.sway * 0.5, GROUND_Y + 0.045, 0.34 * p.shadow, 0.09 * p.shadow),
  );

  const drawBackPaw = (c: Ctx, side: number): void => {
    const pawAt = backForepawLocal(p, side);
    drawPaw(
      c,
      dressing,
      look,
      'foreleg',
      headOnSide(side, true),
      pawAt.x,
      pawAt.y,
      deg(side * 8),
      closed ? CLOSED_PAW_CLAW : 0,
      BACK_FOREPAW_SCALE,
      BACK_FOREPAW_SHADE,
      closed,
    );
  };
  // The orb charges just under her chin. From behind that is beyond her, and
  // the game's high camera lifts what is further away up the screen, so it
  // sits behind her head: her head and shoulders hide it and only its glow
  // rims them.
  if (p.cast > CAST_ORB_VISIBLE) {
    layers.slab('body', (c) => {
      const hiddenMuzzle = headAnchor(p, look);
      const orbY = hiddenMuzzle.y + headSize.ry * BACK_CAST_ORB_UNDER_HEAD;
      drawCastOrb(c, hiddenMuzzle.x, orbY, p.cast, p.castRelease, p.time);
    });
  }
  for (const side of [-1, 1]) {
    if (!raised(side)) layers.slab(closed ? 'forepaws' : 'body', (c) => drawBackPaw(c, side));
  }

  const drawBackTail = (c: Ctx): void =>
    drawTail(
      c,
      dressing,
      look,
      body.cx + BACK_TAIL_ROOT.x + p.tail.rootX,
      body.cy + BACK_TAIL_ROOT.y + p.tail.rootY,
      p.tail,
    );

  layers.slab('body', (c) => {
    const barrel = { cx: body.cx, cy: body.cy, rx: body.rx * 1.02, ry: body.ry };
    const barrelOutline = ovalOutline(
      barrel.cx,
      barrel.cy,
      barrel.rx,
      barrel.ry,
      p.lean,
      3.2,
      0.06,
    );
    dressing.part(c, 'body', {
      piece: 'barrel',
      side: null,
      shape: barrel,
      fur: {
        outline: barrelOutline,
        blobs: coat.backBarrel.blobs.map((b) => ({ ...b, x: b.x + body.cx, y: b.y + body.cy })),
        base: coat.backBarrel.base,
        seed: 101,
        fringe: PIECE_FRINGE.backBarrel * fringe,
        strokes: 240,
        strokeLen: 0.07 * look.fur.hairLength,
        flowFrom: { x: body.cx, y: body.cy - body.ry * 1.4 },
      },
      envelope: barrelOutline,
    });

    // The rump is the widest thing in this view, and she knows it.
    for (const side of [-1, 1]) {
      const haunchX = body.cx + side * body.rx * 0.7;
      const haunch = {
        cx: haunchX,
        cy: body.cy + 0.14,
        rx: look.proportions.haunch.back.rx,
        ry: look.proportions.haunch.back.ry,
      };
      const haunchOutline = ovalOutline(
        haunch.cx,
        haunch.cy,
        haunch.rx,
        haunch.ry,
        deg(side * -8),
        13.5 + side,
        0.08,
        34,
      );
      const legSide = headOnSide(side, true);
      dressing.part(c, 'body', {
        piece: 'haunch',
        side: legSide,
        shape: haunch,
        fur: {
          outline: haunchOutline,
          blobs: coat.haunch.blobs.map((b) => ({
            ...b,
            x: b.x * side + haunchX,
            y: b.y + body.cy + 0.14,
          })),
          base: coat.haunch.base,
          seed: 111 + side * 3,
          fringe: PIECE_FRINGE.backHaunch * fringe,
          strokes: 80,
          strokeLen: 0.06 * look.fur.hairLength,
          flowFrom: { x: body.cx, y: body.cy },
          shade: 0.03,
        },
        envelope: haunchOutline,
      });
      const paw = side < 0 ? p.hindL : p.hindR;
      const rest = hindPawRest(p, look, side * BACK_HIND_PAW_SPREAD);
      if (hindLegsShow(look)) {
        drawLimbColumn(
          c,
          dressing,
          look,
          'hindleg',
          legSide,
          haunch.cx,
          haunch.cy,
          rest.x + paw.dx,
          rest.y + paw.dy,
          BACK_HIND_PAW_SHADE,
          true,
        );
      }
      drawPaw(
        c,
        dressing,
        look,
        'hindleg',
        legSide,
        rest.x + paw.dx,
        rest.y + paw.dy,
        deg(side * 10),
        0,
        1,
        BACK_HIND_PAW_SHADE,
      );
    }

    if (!look.proportions.backView.tailOverNape) drawBackTail(c);
  });

  for (const side of [-1, 1]) {
    if (!raised(side)) continue;
    layers.slab('body', (c) => {
      const pawAt = backForepawLocal(p, side);
      drawLimbColumn(
        c,
        dressing,
        look,
        'foreleg',
        headOnSide(side, true),
        body.cx + side * body.rx * BACK_SHOULDER_SPREAD,
        body.cy - body.ry * BACK_SHOULDER_RISE,
        pawAt.x,
        pawAt.y,
        BACK_FORELEG_SHADE,
      );
    });
  }

  const backHead = headAnchor(p, look);
  layers.slab('head', (c) => {
    dressing.part(
      c,
      'neck',
      collarFrame(
        { x: backHead.x, y: backHead.y + BACK_COLLAR_BELOW_HEAD },
        BACK_COLLAR_RX,
        BACK_COLLAR_RY,
        0,
      ),
    );
    drawContactShadow(c, backHead.x, backHead.y + headSize.ry * 0.9, headSize.rx * 1.1, 0.07, 0.35);
    drawHeadFront(c, p, true, dressing, look, {
      y: body.cy - body.ry * BACK_NAPE_END_RISE,
      halfWidth: body.rx * BACK_NAPE_END_SPREAD,
    });
    if (look.proportions.backView.tailOverNape) drawBackTail(c);
  });

  for (const side of [-1, 1]) {
    if (raised(side)) layers.slab('forepaws', (c) => drawBackPaw(c, side));
  }

  layers.slab('head', (c) => {
    if (p.slash !== null) {
      drawSlashArc(c, body.cx, body.cy - 0.1, -HALF_PI, p.slash, 0.4);
    }
    drawSparkles(c, p.sparkle, p.time);
  });

  ctx.restore();
}

// ── Side view (profile, facing +X) ───────────────────────────────────────────

const SIDE_BODY_CX = -0.02;
const SIDE_BODY_CY = 0.08;
const SIDE_HAUNCH_X = -0.245;
const SIDE_HAUNCH_Y = 0.075;
const SIDE_CHEST_X = 0.235;
const SIDE_CHEST_Y = 0.02;
const SIDE_HEAD_X = 0.355;
const SIDE_HEAD_Y = -0.19;
const SIDE_SHOULDER_X = 0.215;
const SIDE_HIP_X = -0.235;
const SIDE_LIMB_Y = 0.12;
const SIDE_PAW_SCALE = 0.92;

/** A profile leg's half-widths at the thigh or upper arm, and below the knee or elbow. */
const SIDE_UPPER_LEG_HALF_WIDTH = 0.072;
const SIDE_LOWER_LEG_HALF_WIDTH = 0.05;

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
  dressing: CatDressing,
  look: CatLook,
  leg: LegPart,
  legSide: CatSide,
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number,
  shade: number,
  claw: number,
  withPaw = true,
  near = false,
): void {
  const coat = look.coat.profile.limb;
  const width = look.proportions.limbWidth;
  const hock = leg === 'hindleg' ? look.proportions.hindHock : null;
  const segments =
    hock === null
      ? twoBoneLimb(hipX, hipY, footX, footY, upper, lower, bend, width)
      : hockedHindLimb(hipX, hipY, footX, footY, upper, lower, bend, width, hock);
  for (const [a, b, halfWidth, piece] of segments) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle - HALF_PI);
    const outline = ovalOutline(
      0,
      len / 2,
      halfWidth,
      len / 2 + 0.02,
      0,
      15.5 + hipX * 3 + halfWidth * 40,
      0.07,
      28,
    );
    dressing.part(ctx, leg, {
      piece,
      side: legSide,
      length: len,
      halfWidth,
      shade,
      fur: {
        outline,
        blobs: placeBlobs(coat.blobs, UNIT_ORIGIN, { x: halfWidth, y: len }),
        base: coat.base,
        seed: 121 + hipX * 7 + halfWidth * 100,
        fringe: PIECE_FRINGE.sideLimb * look.fur.fringe,
        strokes: 40,
        strokeLen: 0.05 * look.fur.hairLength,
        flowFrom: { x: 0, y: -0.15 },
        shade,
      },
      envelope: outline,
    });
    if (near) drawNearLegRim(ctx, look, outline);
    ctx.restore();
  }
  if (withPaw) drawSidePaw(ctx, dressing, look, leg, legSide, footX, footY, claw, shade);
}

type LimbSegment = readonly [Pt, Pt, number, 'upper' | 'lower' | 'shank' | 'hock'];

function twoBoneLimb(
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number,
  width: number,
): LimbSegment[] {
  const joint = solveJoint(hipX, hipY, footX, footY, upper, lower, bend);
  return [
    [{ x: hipX, y: hipY }, joint, SIDE_UPPER_LEG_HALF_WIDTH * width, 'upper'],
    [joint, { x: footX, y: footY }, SIDE_LOWER_LEG_HALF_WIDTH * width, 'lower'],
  ];
}

/** The hock's long bone rises from the paw this steeply, leaning back behind it. */
const HOCK_RISE = deg(62);
/** The metatarsus is a little narrower than the shank above the hock. */
const HOCK_BONE_WIDTH_SHARE = 0.85;

/**
 * A cat's hind leg in profile: a heavy thigh to the stifle, which points
 * forward, a shank back down to the hock, which points back, and the long
 * hock bone standing steeply to the paw — the zigzag that tells a hind leg
 * from a foreleg.
 */
function hockedHindLimb(
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number,
  width: number,
  hock: CatHindHock,
): LimbSegment[] {
  const hockBone = lower * hock.share;
  const shank = lower - hockBone;
  const hockAt = {
    x: footX - Math.cos(HOCK_RISE) * hockBone,
    y: footY - Math.sin(HOCK_RISE) * hockBone,
  };
  const stifle = solveJoint(hipX, hipY, hockAt.x, hockAt.y, upper, shank, -bend);
  const lowerHalfWidth = SIDE_LOWER_LEG_HALF_WIDTH * width;
  return [
    [{ x: hipX, y: hipY }, stifle, SIDE_UPPER_LEG_HALF_WIDTH * width * hock.thigh, 'upper'],
    [stifle, hockAt, lowerHalfWidth, 'shank'],
    [hockAt, { x: footX, y: footY }, lowerHalfWidth * HOCK_BONE_WIDTH_SHARE, 'hock'],
  ];
}

/** A profile paw. Closed on a haft, it turns its toes over the haft rather than down to the floor. */
function drawSidePaw(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  leg: LegPart,
  legSide: CatSide,
  footX: number,
  footY: number,
  claw: number,
  shade: number,
  closedOn: number | null = null,
): void {
  const closed = closedOn !== null;
  drawPaw(
    ctx,
    dressing,
    look,
    leg,
    legSide,
    footX,
    footY,
    closedOn ?? 0,
    closed ? CLOSED_PAW_CLAW : claw,
    SIDE_PAW_SCALE,
    shade,
    closed,
  );
}

/** Share of the body's bob the profile head rides. */
const SIDE_HEAD_BOB_SHARE = 0.7;
/** How far the profile head drops at full bow. */
const SIDE_HEAD_BOW_DROP = 0.16;
/** How far the profile head pitches nose-down at full bow. */
const SIDE_HEAD_BOW_PITCH = deg(28);
/** The front corner of her closed mouth line, in the profile head's own frame. */
const SIDE_MOUTH: Pt = { x: 0.152, y: 0.068 };

function sideHeadPlacement(p: CatPose, look: CatLook): { x: number; y: number; angle: number } {
  return {
    x: SIDE_HEAD_X * look.proportions.profileLength + p.headX,
    y:
      SIDE_HEAD_Y +
      p.headY +
      p.bob * SIDE_HEAD_BOB_SHARE +
      p.headBow * SIDE_HEAD_BOW_DROP -
      legLiftOf(p, look, 'profile') +
      look.proportions.neckDrop.profile,
    angle: p.headTilt + p.headBow * SIDE_HEAD_BOW_PITCH,
  };
}

/** Her barrel's centre in profile, which a downed roll turns about. */
function sideBodyCentre(p: CatPose, look: CatLook): Pt {
  return {
    x: SIDE_BODY_CX + p.sway,
    y: SIDE_BODY_CY + p.bob + lerp(0, 0.05, p.sit) - legLiftOf(p, look, 'profile'),
  };
}

/**
 * Her mouth in the profile view, facing +X, in pose space — placed through
 * the same roll, lean and head placement {@link drawCatSide} paints with.
 */
export function catMouthSide(p: CatPose, look: CatLook): Pt {
  const head = sideHeadPlacement(p, look);
  const mouth = { x: SIDE_MOUTH.x * look.proportions.profileMuzzle, y: SIDE_MOUTH.y };
  const turned = rotatePoint(mouth, head.angle);
  return sidePainted(p, look, { x: head.x + turned.x, y: head.y + turned.y });
}

/** A point of the profile pose's own frame where {@link drawCatSide} paints it: leaned, then rolled about her barrel. */
function sidePainted(p: CatPose, look: CatLook, point: Pt): Pt {
  const leaned = rotatePoint(point, p.lean);
  const centre = sideBodyCentre(p, look);
  const rolled = rotatePoint({ x: leaned.x - centre.x, y: leaned.y - centre.y }, p.roll);
  return { x: centre.x + rolled.x, y: centre.y + rolled.y };
}

/** How far her far forepaw stands behind her near one in profile. */
const SIDE_FAR_LIMB_SETBACK = 0.02;

/** A profile forepaw in the pose's own frame, before her lean and roll: where the painter puts it. */
function sideForepawLocal(p: CatPose, look: CatLook, near: boolean): Pt {
  const paw = near ? p.frontR : p.frontL;
  const setback = near ? 0 : SIDE_FAR_LIMB_SETBACK;
  const shoulderX = SIDE_SHOULDER_X * look.proportions.profileLength;
  return { x: shoulderX + paw.dx - setback, y: GROUND_Y + paw.dy };
}

/** Her near or far forepaw in profile facing +X, pose space, as {@link drawCatSide} places it. */
export function catForepawSide(p: CatPose, look: CatLook, near: boolean): Pt {
  return sidePainted(p, look, sideForepawLocal(p, look, near));
}

/** In profile her face reaches at least this far past her mouth: a long muzzle carries the face forward with it. */
const SIDE_FACE_PAST_MOUTH = 1.1;

/** The middle of her face in profile facing +X, pose space, and its half-width. */
export function catFaceSide(p: CatPose, look: CatLook): { centre: Pt; radius: number } {
  const head = sideHeadPlacement(p, look);
  const mouthReach = Math.hypot(SIDE_MOUTH.x * look.proportions.profileMuzzle, SIDE_MOUTH.y);
  return {
    centre: sidePainted(p, look, { x: head.x, y: head.y }),
    radius: Math.max(look.proportions.profileHead.rx, mouthReach * SIDE_FACE_PAST_MOUTH),
  };
}

/** How a held haft's direction in a profile pose's own frame turns on screen: by her lean and her roll. */
export function catSideTurn(p: CatPose): number {
  return p.lean + p.roll;
}

/** In profile, where each ear roots into the skull: the near one forward of the far one. */
const SIDE_NEAR_EAR: Pt = { x: -0.035, y: -0.15 };
const SIDE_FAR_EAR: Pt = { x: -0.105, y: -0.13 };
/**
 * Where her snaggle tooth roots in profile, in the head's own frame. On the
 * side facing the camera it hangs over her lip behind the corner of her
 * mouth; on the far side it peeks out below the lip line a little further
 * back, past her near jaw.
 */
const SIDE_NEAR_TOOTH_ROOT: Pt = { x: 0.122, y: 0.07 };
const SIDE_FAR_TOOTH_ROOT: Pt = { x: 0.116, y: 0.074 };
/** In profile her ears are seen edge-on: this share of their head-on width, the far one a touch wider for its turn. */
const SIDE_FAR_EAR_WIDTH = 0.55;
const SIDE_NEAR_EAR_WIDTH = 0.5;
/** In profile, her near eye in the head's own frame. */
const SIDE_EYE: Pt = { x: 0.062, y: -0.012 };

function otherSide(side: CatSide): CatSide {
  return side === 'left' ? 'right' : 'left';
}

const SIDE_ON_EAR_LEAN = deg(-14);
/** The ear's base, as a share of its height, either side of its root: wider behind than in front. */
const SIDE_ON_EAR_BACK = 0.5;
const SIDE_ON_EAR_FRONT = 0.42;
/** Where its point sits, as a share of its height back from the root. */
const SIDE_ON_EAR_TIP_BACK = 0.12;
/** The base runs this far down into the skull so the ear roots in it. */
const SIDE_ON_EAR_ROOT_DEPTH = 0.04;
/** The pink sliver of the inside along the front edge: how far in from that edge, and how far up. */
const SIDE_ON_EAR_INNER_INSET = 0.12;
const SIDE_ON_EAR_INNER_REACH = 0.72;
/** The pink sliver's point sits this share of the way back to the ear's tip, and its root this share of the front edge in. */
const SIDE_ON_EAR_INNER_TIP_SHARE = 0.5;
const SIDE_ON_EAR_INNER_ROOT_SHARE = 0.25;
/**
 * Where each edge turns in toward the point, as shares of the base's half on
 * that side and of the ear's height: the back edge bellies out lower than
 * the front.
 */
const SIDE_ON_EAR_BACK_SHOULDER: Pt = { x: 0.7, y: 0.45 };
const SIDE_ON_EAR_FRONT_SHOULDER: Pt = { x: 0.55, y: 0.5 };
/** Flattened right back, the ear shortens to this share of its height and turns back this far. */
const SIDE_ON_EAR_FLATTENED_HEIGHT = 0.55;
const SIDE_ON_EAR_FLATTEN_TURN = deg(30);
/**
 * Where side-on ears root on the profile skull: the near ear's front edge
 * over the back of her eye, the far ear just behind it, shaded.
 */
const SIDE_ON_NEAR_EAR: Pt = { x: 0.0, y: -0.125 };
const SIDE_ON_FAR_EAR: Pt = { x: -0.045, y: -0.13 };
const SIDE_ON_FAR_EAR_SHADE = 0.18;
const SIDE_ON_EAR_SEED = 17;
const SIDE_ON_EAR_STROKES = 30;
const SIDE_ON_EAR_STROKE_LENGTH = 0.04;

/**
 * A side-on ear, for a look that asks for one: a broad-based triangle seen
 * edge-on to its opening, which faces forward, so the camera sees the back of
 * the flap with only a sliver of its pink inside along the front edge. Its
 * point leans back over her skull. The far ear stands just behind the near
 * one, so only its tip shows past it.
 */
function drawSideOnEar(
  ctx: Ctx,
  dressing: CatDressing,
  look: CatLook,
  ear: CatSide,
  root: Pt,
  tilt: number,
  far: boolean,
): void {
  const flatten = clamp01(-tilt);
  const height =
    look.proportions.ear.height *
    look.proportions.profileEarHeight *
    lerp(1, SIDE_ON_EAR_FLATTENED_HEIGHT, flatten);
  const back = height * SIDE_ON_EAR_BACK * look.proportions.profileEarWidth;
  const front = height * SIDE_ON_EAR_FRONT * look.proportions.profileEarWidth;
  ctx.save();
  ctx.translate(root.x, root.y);
  ctx.rotate(SIDE_ON_EAR_LEAN - SIDE_ON_EAR_FLATTEN_TURN * flatten);
  const tip: Pt = { x: -height * SIDE_ON_EAR_TIP_BACK, y: -height };
  const outline: Pt[] = [
    { x: -back, y: SIDE_ON_EAR_ROOT_DEPTH },
    { x: -back * SIDE_ON_EAR_BACK_SHOULDER.x, y: -height * SIDE_ON_EAR_BACK_SHOULDER.y },
    // Twice over, so the smoothed outline keeps a point there instead of rounding it off.
    tip,
    tip,
    { x: front * SIDE_ON_EAR_FRONT_SHOULDER.x, y: -height * SIDE_ON_EAR_FRONT_SHOULDER.y },
    { x: front, y: SIDE_ON_EAR_ROOT_DEPTH },
  ];
  const coat = look.coat.ear.back;
  const shade = far ? SIDE_ON_FAR_EAR_SHADE : 0;
  const fur: FurPart = {
    outline,
    blobs: placeBlobs(coat.blobs, UNIT_ORIGIN, { x: back, y: height }),
    base: coat.base,
    seed: SIDE_ON_EAR_SEED + (far ? 1 : 0),
    fringe: PIECE_FRINGE.ear * look.fur.fringe,
    strokes: SIDE_ON_EAR_STROKES,
    strokeLen: SIDE_ON_EAR_STROKE_LENGTH * look.fur.hairLength,
    flowFrom: { x: 0, y: SIDE_ON_EAR_ROOT_DEPTH },
    shade,
  };
  dressing.part(ctx, 'head', { piece: 'ear', side: ear, fur, envelope: outline });
  if (!far) {
    const inset = front * SIDE_ON_EAR_INNER_INSET;
    ctx.beginPath();
    ctx.moveTo(front - inset, 0);
    ctx.lineTo(
      front * SIDE_ON_EAR_FRONT_SHOULDER.x - inset,
      -height * SIDE_ON_EAR_FRONT_SHOULDER.y,
    );
    ctx.lineTo(tip.x * SIDE_ON_EAR_INNER_TIP_SHARE, -height * SIDE_ON_EAR_INNER_REACH);
    ctx.lineTo(front * SIDE_ON_EAR_INNER_ROOT_SHARE, 0);
    ctx.closePath();
    const inner = ctx.createLinearGradient(0, -height, 0, 0);
    inner.addColorStop(0, look.face.innerEar.dark);
    inner.addColorStop(1, look.face.innerEar.light);
    ctx.fillStyle = inner;
    ctx.fill();
  }
  ctx.restore();
}

/** @param near the side of her head facing the camera. */
function drawHeadSide(
  ctx: Ctx,
  p: CatPose,
  dressing: CatDressing,
  look: CatLook,
  coat: CatFlankCoat,
  near: CatSide,
): void {
  const headCoat = coat.head;
  const muzzleCoat = coat.muzzle;
  const head = sideHeadPlacement(p, look);
  const headSize = look.proportions.profileHead;
  const { face } = look;
  const fringe = look.fur.fringe;

  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(head.angle);

  // Far ear first so the near ear overlaps it.
  const sideOnEars = look.proportions.profileEars === 'sideOn';
  if (sideOnEars) {
    drawSideOnEar(ctx, dressing, look, otherSide(near), SIDE_ON_FAR_EAR, p.earL, true);
  } else {
    const farEar = otherSide(near);
    drawEar(
      ctx,
      dressing,
      look,
      farEar,
      SIDE_FAR_EAR.x,
      SIDE_FAR_EAR.y,
      -1,
      p.earL,
      true,
      SIDE_FAR_EAR_WIDTH * look.proportions.profileEarWidth,
      look.proportions.profileEarHeight,
    );
  }

  const skull = ovalOutline(0, 0, headSize.rx, headSize.ry, 0, 6.1, 0.05);
  dressing.part(ctx, 'head', {
    piece: 'skull',
    fur: {
      outline: skull,
      blobs: headCoat.blobs,
      base: headCoat.base,
      seed: 131,
      fringe: PIECE_FRINGE.sideSkull * fringe,
      strokes: 130,
      strokeLen: 0.055 * look.fur.hairLength,
      flowFrom: { x: -0.05, y: -0.05 },
    },
    envelope: skull,
  });

  // Everything forward of the skull is drawn stretched by her muzzle's
  // length, so a longer muzzle carries its nose, mouth and tooth with it.
  ctx.save();
  ctx.scale(look.proportions.profileMuzzle, 1);
  // Muzzle wedge out front — the profile silhouette lives or dies on this shape.
  const muzzle: Pt[] = [
    { x: 0.02, y: -0.02 },
    { x: 0.12, y: -0.005 },
    { x: 0.175, y: 0.035 },
    { x: 0.17, y: 0.085 },
    { x: 0.1, y: 0.115 },
    { x: 0.0, y: 0.115 },
    { x: -0.05, y: 0.06 },
  ];
  dressing.part(ctx, 'head', {
    piece: 'muzzle',
    fur: {
      outline: muzzle,
      blobs: muzzleCoat.blobs,
      base: muzzleCoat.base,
      seed: 141,
      fringe: PIECE_FRINGE.sideMuzzle * fringe,
      strokes: 60,
      strokeLen: 0.045 * look.fur.hairLength,
      flowFrom: { x: -0.05, y: 0 },
    },
    envelope: muzzle,
  });

  const noseX = 0.168;
  const noseY = 0.045;
  ctx.fillStyle = face.nose.light;
  ctx.beginPath();
  ctx.ellipse(noseX, noseY, 0.022, 0.018, deg(-15), 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(SHADOW_INK, 0.45);
  ctx.beginPath();
  ctx.ellipse(noseX - 0.004, noseY + 0.004, 0.007, 0.005, deg(-15), 0, TWO_PI);
  ctx.fill();

  const openness = clamp01(p.mouth);
  if (openness > 0.05) {
    ctx.fillStyle = face.mouth;
    ctx.beginPath();
    ctx.moveTo(0.155, 0.072);
    ctx.quadraticCurveTo(0.1, 0.08 + 0.06 * openness, 0.03, 0.075 + 0.03 * openness);
    ctx.quadraticCurveTo(0.09, 0.06, 0.155, 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = face.fang;
    ctx.beginPath();
    ctx.moveTo(0.128, 0.066);
    ctx.lineTo(0.118, 0.066 + 0.045 * openness);
    ctx.lineTo(0.108, 0.064);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = rgba(face.ink, SIDE_MOUTH_INK_ALPHA);
    ctx.lineWidth = 0.007;
    ctx.beginPath();
    ctx.moveTo(0.152, 0.068);
    ctx.quadraticCurveTo(0.11, 0.082, 0.06, 0.072);
    ctx.stroke();
  }
  if (p.tongue > 0.05) {
    ctx.fillStyle = face.tongue;
    ctx.beginPath();
    ctx.ellipse(0.16, 0.085 + 0.02 * p.tongue, 0.022 * p.tongue + 0.008, 0.016, deg(20), 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(SIDE_EYE.x, SIDE_EYE.y);
  ctx.scale(0.78, 0.82);
  drawEye(ctx, look, 0, 0, 1, p.eyeOpen, p.pupil, 0.4);
  ctx.restore();
  ctx.save();
  ctx.scale(look.proportions.profileMuzzle, 1);
  drawWhiskers(ctx, look, 0.135, 0.05, 1, p.headBow + 0.4, 0.62);
  ctx.restore();
  // Over her whiskers, which cross her lip: under them it dims below a whole
  // pixel at the tile. Carried forward with her muzzle, but never stretched
  // with it.
  if (face.tooth !== null) {
    const root = face.tooth.side === near ? SIDE_NEAR_TOOTH_ROOT : SIDE_FAR_TOOTH_ROOT;
    drawFang(
      ctx,
      face.tooth.colour,
      root.x * look.proportions.profileMuzzle,
      root.y,
      TOOTH_HALF_WIDTH,
      TOOTH_LENGTH,
      // Seen side-on, a canine curves back toward her throat.
      -TOOTH_CURVE,
    );
  }
  const landmarks: CatHeadLandmarks = {
    skull: { cx: 0, cy: 0, rx: headSize.rx, ry: headSize.ry },
    eyes: [SIDE_EYE],
    eyeLine: SIDE_EYE.y,
    turn: 0,
  };
  dressing.part(ctx, 'head', { piece: 'features', landmarks, envelope: null });
  if (sideOnEars) {
    drawSideOnEar(ctx, dressing, look, near, SIDE_ON_NEAR_EAR, p.earR, false);
  } else {
    drawEar(
      ctx,
      dressing,
      look,
      near,
      SIDE_NEAR_EAR.x,
      SIDE_NEAR_EAR.y,
      1,
      p.earR,
      false,
      SIDE_NEAR_EAR_WIDTH * look.proportions.profileEarWidth,
      look.proportions.profileEarHeight,
    );
  }
  dressing.part(ctx, 'head', { piece: 'top', landmarks, envelope: null });

  ctx.restore();
}

/** Which of her flanks a profile shows: her right facing east, her left facing west. */
export type Flank = 'right' | 'left';

/**
 * The cat in profile. Facing east she shows her right flank; facing west the
 * same anatomy is painted mirrored with her left flank's coat, so her patches
 * stay on her own sides rather than swapping as a flipped picture would.
 * `front` receives the slabs in front of anything she holds.
 */
export function drawCatSide(
  ctx: Ctx,
  p: CatPose,
  dressing: CatDressing,
  look: CatLook,
  flank: Flank,
  front: Ctx | null = null,
): void {
  const coat = look.coat.profile.flanks[flank];
  ctx.save();
  if (flank === 'left') ctx.scale(-1, 1);
  paintProfile(new CatLayers(ctx, front, heldUnder(p)), p, dressing, look, coat, flank);
  ctx.restore();
}

/** @param near the flank facing the camera, which is also the side of her near legs. */
function paintProfile(
  layers: CatLayers,
  p: CatPose,
  dressing: CatDressing,
  look: CatLook,
  coat: CatFlankCoat,
  near: CatSide,
): void {
  const ctx = layers.ctx;
  const far = otherSide(near);
  const { x: cx, y: cy } = sideBodyCentre(p, look);
  const { profileBody, legs } = look.proportions;
  const fringe = look.fur.fringe;
  const rx = profileBody.rx * (1 + p.breathe * 0.02);
  const ry = profileBody.ry * p.squash * (1 + p.breathe * 0.05);
  const closedOn = pawsClosed(p) ? (p.grip?.haftAngle ?? 0) : null;

  ctx.save();
  layers.slab('shadow', (c) =>
    drawGroundShadow(c, cx, GROUND_Y + 0.045, 0.4 * p.shadow, 0.09 * p.shadow),
  );
  // A downed cat rolls about her own barrel, not about the floor, so the pose
  // that drops her onto her side is `bob` plus a roll around the body centre.
  ctx.translate(cx, cy);
  ctx.rotate(p.roll);
  ctx.translate(-cx, -cy);
  ctx.rotate(p.lean);

  const shoulderY = cy + SIDE_LIMB_Y - 0.16;
  const hipY = cy + SIDE_LIMB_Y - 0.14;
  const farPaw = sideForepawLocal(p, look, false);
  const nearPaw = sideForepawLocal(p, look, true);
  const length = look.proportions.profileLength;
  const hipX = SIDE_HIP_X * length;
  const shoulderX = SIDE_SHOULDER_X * length;
  const haunchX = SIDE_HAUNCH_X * length;
  const chestX = SIDE_CHEST_X * length;

  layers.slab('body', (c) => {
    const farShade = look.coat.profile.farLimbShade;
    drawSideLimb(
      c,
      dressing,
      look,
      'hindleg',
      far,
      hipX + 0.02,
      hipY,
      hipX + p.hindL.dx + 0.02,
      GROUND_Y + p.hindL.dy,
      legs.hindUpper,
      legs.hindLower,
      1,
      farShade,
      0,
    );
    drawSideLimb(
      c,
      dressing,
      look,
      'foreleg',
      far,
      shoulderX - SIDE_FAR_LIMB_SETBACK,
      shoulderY,
      farPaw.x,
      farPaw.y,
      legs.foreUpper,
      legs.foreLower,
      -1,
      farShade,
      0,
      closedOn === null,
    );
    if (closedOn !== null) {
      drawSidePaw(c, dressing, look, 'foreleg', far, farPaw.x, farPaw.y, 0, farShade, closedOn);
    }

    drawTail(c, dressing, look, cx - rx * 0.95 + p.tail.rootX, cy + 0.02 + p.tail.rootY, p.tail);

    const haunch = {
      cx: haunchX + cx,
      cy: SIDE_HAUNCH_Y + cy,
      rx: look.proportions.haunch.profile.rx,
      ry: look.proportions.haunch.profile.ry,
    };
    const haunchOutline = ovalOutline(
      haunch.cx,
      haunch.cy,
      haunch.rx,
      haunch.ry,
      deg(-8),
      16.3,
      0.07,
      40,
    );
    dressing.part(c, 'body', {
      piece: 'haunch',
      side: near,
      shape: haunch,
      fur: {
        outline: haunchOutline,
        blobs: coat.haunch.blobs.map((b) => ({
          ...b,
          x: b.x + haunchX + cx,
          y: b.y + SIDE_HAUNCH_Y + cy,
        })),
        base: coat.haunch.base,
        seed: 151,
        fringe: PIECE_FRINGE.sideHaunch * fringe,
        strokes: 110,
        strokeLen: 0.065 * look.fur.hairLength,
        flowFrom: { x: cx, y: cy - 0.1 },
      },
      envelope: haunchOutline,
    });

    const barrel = ovalOutline(cx, cy, rx, ry, deg(-3), 2.1, 0.06);
    dressing.part(c, 'body', {
      piece: 'barrel',
      side: null,
      shape: { cx, cy, rx, ry },
      fur: {
        outline: barrel,
        blobs: coat.barrel.blobs.map((b) => ({ ...b, x: b.x + cx, y: b.y + cy })),
        base: coat.barrel.base,
        seed: 161,
        fringe: PIECE_FRINGE.sideBarrel * fringe,
        strokes: 230,
        strokeLen: 0.07 * look.fur.hairLength,
        flowFrom: { x: cx - 0.1, y: cy - ry },
      },
      envelope: barrel,
    });

    // The belly pouch: the giveaway that she is not a lean cat.
    const bellySize = look.proportions.belly;
    const belly = {
      cx: cx - 0.02,
      cy: cy + ry * 0.75,
      rx: rx * bellySize.widthShare,
      ry: bellySize.ry,
    };
    const bellyOutline = ovalOutline(belly.cx, belly.cy, belly.rx, belly.ry, deg(2), 9.7, 0.08, 32);
    const bellyCoat = look.coat.profile.belly;
    dressing.part(c, 'body', {
      piece: 'belly',
      side: null,
      shape: belly,
      fur: {
        outline: bellyOutline,
        blobs: placeBlobs(bellyCoat.blobs, { x: belly.cx, y: belly.cy }, { x: rx, y: 1 }),
        base: bellyCoat.base,
        seed: 171,
        fringe: PIECE_FRINGE.sideBelly * fringe,
        strokes: 70,
        strokeLen: 0.06 * look.fur.hairLength,
        flowFrom: { x: cx, y: cy },
        shade: 0.12,
      },
      envelope: bellyOutline,
    });

    const chest = {
      cx: chestX + cx,
      cy: SIDE_CHEST_Y + cy,
      rx: look.proportions.profileChest.rx,
      ry: look.proportions.profileChest.ry,
    };
    const chestOutline = ovalOutline(
      chest.cx,
      chest.cy,
      chest.rx,
      chest.ry,
      deg(6),
      11.2,
      0.09,
      36,
    );
    dressing.part(c, 'body', {
      piece: 'chest',
      side: null,
      shape: chest,
      fur: {
        outline: chestOutline,
        blobs: coat.chest.blobs.map((b) => ({
          ...b,
          x: chestX + cx + b.x,
          y: SIDE_CHEST_Y + cy + b.y,
        })),
        base: coat.chest.base,
        seed: 181,
        fringe: PIECE_FRINGE.sideChest * fringe,
        strokes: 100,
        strokeLen: 0.07 * look.fur.hairLength,
        flowFrom: { x: cx, y: cy - 0.15 },
      },
      envelope: chestOutline,
    });

    drawSideLimb(
      c,
      dressing,
      look,
      'hindleg',
      near,
      hipX,
      hipY,
      hipX + p.hindR.dx,
      GROUND_Y + p.hindR.dy,
      legs.hindUpper,
      legs.hindLower,
      1,
      0,
      p.hindR.claw,
      true,
      true,
    );
    drawSideLimb(
      c,
      dressing,
      look,
      'foreleg',
      near,
      shoulderX,
      shoulderY,
      nearPaw.x,
      nearPaw.y,
      legs.foreUpper,
      legs.foreLower,
      -1,
      0,
      p.frontR.claw,
      closedOn === null,
      true,
    );
  });
  if (closedOn !== null) {
    layers.slab('forepaws', (c) =>
      drawSidePaw(c, dressing, look, 'foreleg', near, nearPaw.x, nearPaw.y, 0, 0, closedOn),
    );
  }

  const head = sideHeadPlacement(p, look);
  layers.slab('head', (c) => {
    dressing.part(
      c,
      'neck',
      collarFrame(
        { x: head.x + SIDE_COLLAR_OFFSET.x, y: head.y + SIDE_COLLAR_OFFSET.y },
        SIDE_COLLAR_RX,
        SIDE_COLLAR_RY,
        SIDE_COLLAR_TILT,
      ),
    );
    drawHeadSide(c, p, dressing, look, coat, near);

    if (p.cast > CAST_ORB_VISIBLE) {
      drawCastOrb(
        c,
        shoulderX + p.frontR.dx + SIDE_CAST_ORB_REACH,
        GROUND_Y + p.frontR.dy - CAST_ORB_ABOVE_PAWS,
        p.cast,
        p.castRelease,
        p.time,
      );
    }
    if (p.slash !== null) {
      drawSlashArc(c, shoulderX + 0.16, cy - 0.06, 0, p.slash, 0.3);
    }
    drawSparkles(c, p.sparkle, p.time);
  });

  ctx.restore();
}

// ── Paws on a haft ───────────────────────────────────────────────────────────

/** The painted views a pose is authored for. */
type PawView = 'front' | 'side' | 'back';

/**
 * Which forepaw holds a haft's butt in each view, as the pose names it: the
 * screen-left paw head-on and from behind, the near paw in profile. The other
 * forepaw closes on the haft further along it.
 */
export const BUTT_FOREPAW: Readonly<Record<PawView, 'frontL' | 'frontR'>> = {
  front: 'frontL',
  side: 'frontR',
  back: 'frontL',
};

function forepawRestFor(p: CatPose, view: PawView, field: 'frontL' | 'frontR'): Pt {
  const side = field === 'frontL' ? -1 : 1;
  if (view === 'front') return frontPawRest(p, side);
  if (view === 'back') {
    const rest = frontPawRest(p, side * BACK_FOREPAW_SPREAD);
    return { x: rest.x, y: rest.y - BACK_FOREPAW_TUCK };
  }
  const setback = field === 'frontR' ? 0 : SIDE_FAR_LIMB_SETBACK;
  return { x: SIDE_SHOULDER_X - setback, y: GROUND_Y };
}

/**
 * The forepaw offsets that close both her paws on one haft: the butt paw at
 * `butt`, the other `spacing` along the haft's on-screen direction, both in
 * the pose's own frame before her lean and roll.
 */
export function forepawsOnHaft(
  p: CatPose,
  view: PawView,
  butt: Pt,
  grip: Pick<CatGrip, 'haftAngle' | 'haftDepth'>,
  spacing: number,
  lift: number,
): Pick<CatPose, 'frontL' | 'frontR'> {
  const onScreen = Math.sqrt(Math.max(0, 1 - grip.haftDepth * grip.haftDepth)) * spacing;
  const upper = {
    x: butt.x + Math.cos(grip.haftAngle) * onScreen,
    y: butt.y + Math.sin(grip.haftAngle) * onScreen,
  };
  const buttField = BUTT_FOREPAW[view];
  const upperField = buttField === 'frontL' ? 'frontR' : 'frontL';
  const pawAt = (field: 'frontL' | 'frontR', at: Pt): PawPose => {
    const rest = forepawRestFor(p, view, field);
    return { dx: at.x - rest.x, dy: at.y - rest.y, lift, claw: 0 };
  };
  const buttPaw = pawAt(buttField, butt);
  const upperPaw = pawAt(upperField, upper);
  return buttField === 'frontL'
    ? { frontL: buttPaw, frontR: upperPaw }
    : { frontL: upperPaw, frontR: buttPaw };
}

/**
 * The middle of her back, pose space, where a pack or saddle would ride:
 * head-on and from behind over the top of her barrel, in profile over her
 * spine facing +X.
 */
export function catSaddle(p: CatPose, view: PawView, look: CatLook): Pt {
  if (view === 'side') {
    const { x, y } = sideBodyCentre(p, look);
    return sidePainted(p, look, { x, y: y - look.proportions.profileBody.ry * SADDLE_RISE });
  }
  const body = bodyMetrics(p, look);
  return rotatePoint({ x: body.cx, y: body.cy - body.ry * SADDLE_RISE }, p.roll);
}

/** A saddle rides this share of her barrel's half-height above its middle. */
const SADDLE_RISE = 0.8;
