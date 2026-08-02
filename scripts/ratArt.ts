/**
 * The painter library behind the rat sprite sheet.
 *
 * The rat that shipped before this was a grey box with a pink circle on it. What
 * makes a rodent read as a rodent — at 32 px, in motion, from three viewpoints —
 * is a short list of cues that nothing else in the bestiary has: a long
 * unbroken wedge from ear to nose with no forehead stop, two big thin naked
 * ears, a scaly annulated tail as long as the body, naked pink feet with splayed
 * toes, a forest of whiskers, and orange incisors that only show when it bites.
 * Everything here exists to serve one of those.
 *
 * The coat is agouti: a brown-grey base whose individual hairs are banded, so
 * the fur reads as speckled rather than flat. That is painted the way a real
 * agouti coat works — a dense field of short strokes where a minority carry a
 * pale tip — rather than as a texture, because the same engine then handles the
 * pale belly and the dark dorsal stripe as tone patches without a second path.
 *
 * Naked skin (ears, tail, feet, nose) is a separate painter. It has to be: fur
 * and skin fail in opposite directions at tile size, and the tail in particular
 * lives or dies on its scale rings.
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

export function pt(x: number, y: number): Pt {
  return { x, y };
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

// ── Coat ─────────────────────────────────────────────────────────────────────

/**
 * The three bands of a wild agouti coat: a near-black dorsal stripe down the
 * spine, warm brown-grey flanks, and a dirty cream belly. Naming them by where
 * they sit rather than by colour is what lets the same patch list be reused on
 * the head, the haunch and the limbs without re-deriving a palette each time.
 */
export type FurTone = 'dorsal' | 'flank' | 'belly';

interface ToneColors {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
  /** The pale band near the hair's tip, which is what makes agouti fur speckle. */
  readonly tick: string;
}

/**
 * Dorsal is a warm near-black rather than a true one: pure black collapses into
 * a silhouette hole at 32 px and takes the whole back of the animal with it.
 */
const FUR: Record<FurTone, ToneColors> = {
  dorsal: { base: '#2e271f', dark: '#15120e', light: '#5c4f3d', tick: '#8a7452' },
  flank: { base: '#5d5041', dark: '#332c23', light: '#8e7c61', tick: '#bda67d' },
  belly: { base: '#8d8471', dark: '#5f594a', light: '#b8b09b', tick: '#cfc7b0' },
};

const RIM_LIGHT = '#c8d8ff';
const SHADOW_INK = '#0b0908';

/** A patch of one coat tone. */
export interface CoatBlob {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly tone: FurTone;
  readonly seed: number;
}

const BLOB_MOTTLE_MAJOR = 0.14;
const BLOB_MOTTLE_MINOR = 0.08;
const BLOB_MOTTLE_MAJOR_LOBES = 3;
const BLOB_MOTTLE_MINOR_LOBES = 7;
const BLOB_STEPS = 32;

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
export function toneAt(blobs: readonly CoatBlob[], base: FurTone, x: number, y: number): FurTone {
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
  ctx.fillStyle = FUR[blob.tone].base;
  ctx.fill();
}

// ── Outlines ─────────────────────────────────────────────────────────────────

const OUTLINE_STEPS = 44;
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
  wobble = 0.04,
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
  readonly base: FurTone;
  readonly seed: number;
  /** Length of the guard hairs that break the silhouette, in tile units. */
  readonly fringe: number;
  readonly strokes: number;
  readonly strokeLen: number;
  /** Hairs lie away from this point, the way a coat lies away from the spine. */
  readonly flowFrom: Pt;
  /** Direction the key light comes from, as a unit-ish vector. */
  readonly light?: Pt;
  /** Extra darkening, for limbs and far-side parts that sit in the body's shade. */
  readonly shade?: number;
  /**
   * Strength of the dark line drawn around the clump, 0 for none.
   *
   * The cat can do without one because a long-haired silhouette is supposed to
   * dissolve at its edge. A rat's does not: short sleek fur against a stone
   * floor needs a contour or the animal reads as a smudge at 32 px.
   */
  readonly contour?: number;
}

const DEFAULT_LIGHT: Pt = { x: -0.45, y: -0.9 };
/** Guard hairs are sampled between outline points too — sparse ones read as spikes. */
const FRINGE_SUBSAMPLES = 2;
const FRINGE_MIN_SCALE = 0.25;
const FRINGE_RANGE_SCALE = 1;
const FRINGE_HALF_WIDTH = 0.2;
const FRINGE_SPLAY = 0.55;
/**
 * Rat fur lies flat along the body rather than hanging, so the guard hairs get
 * almost no downward bias — the droop that gives the cat her long-haired
 * silhouette turns a rat into a dust mop.
 */
const FRINGE_DROOP = 0.08;
const FRINGE_LENGTH_BIAS = 2.1;
const OVER_FRINGE_ALPHA = 0.4;
const OVER_FRINGE_SHARE = 0.4;
const OVER_FRINGE_LENGTH = 0.8;
const FUR_STROKE_ATTEMPT_LIMIT = 4;
const FUR_STROKE_WIDTH = 0.007;
const FUR_STROKE_CURL = 0.18;
/**
 * Share of hairs that carry the pale agouti band. Below about a third the coat
 * reads as flat brown; above about a half it reads as grizzled grey and the
 * dorsal stripe stops separating from the flank.
 */
const TICKED_HAIR_SHARE = 0.38;
const FUR_GUARD_ALPHA = 0.75;
const HIGHLIGHT_ALPHA = 0.18;
const OCCLUSION_ALPHA = 0.32;
const OCCLUSION_INNER_STOP = 0.55;
const RIM_ALPHA = 0.28;
const RIM_WIDTH = 0.011;
const CONTOUR_WIDTH = 0.013;
const CONTOUR_ALPHA = 0.7;

/**
 * Guard hairs poking past the silhouette. `over` hairs are drawn after the fill
 * at partial alpha so the edge dissolves instead of ending in a hard line.
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
    ctx.fillStyle = mix(mix(FUR[tone].base, FUR[tone].dark, 0.2 + 0.3 * roll), SHADOW_INK, shade);
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
    const ticked = roll < TICKED_HAIR_SHARE;
    const tone = toneAt(part.blobs, part.base, x, y);
    const colors = FUR[tone];
    const tint = ticked
      ? mix(colors.base, colors.tick, 0.45 + 0.5 * roll)
      : mix(colors.base, colors.dark, 0.2 + 0.6 * roll);
    ctx.strokeStyle = rgba(mix(tint, SHADOW_INK, shade), ticked ? FUR_GUARD_ALPHA : 1);

    const flowAngle =
      Math.atan2(y - part.flowFrom.y, x - part.flowFrom.x) + (hash2(part.seed, i) - 0.5) * 0.7;
    const len = part.strokeLen * (0.6 + 0.7 * hash2(i * 5, part.seed));
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

/** Paints one clump: guard hairs, coat, hair strokes, volume shading, rim light. */
export function paintFur(ctx: Ctx, part: FurPart): void {
  drawFringe(ctx, part, false);

  ctx.save();
  traceOutline(ctx, part.outline);
  ctx.clip();

  const bounds = boundsOf(part.outline);
  const shade = part.shade ?? 0;
  ctx.fillStyle = mix(FUR[part.base].base, SHADOW_INK, shade);
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

  const contour = part.contour ?? 0;
  if (contour > 0) {
    ctx.strokeStyle = rgba(SHADOW_INK, CONTOUR_ALPHA * contour);
    ctx.lineWidth = CONTOUR_WIDTH;
    traceOutline(ctx, part.outline);
    ctx.stroke();
  }
}

// ── Naked skin ───────────────────────────────────────────────────────────────

/**
 * Ears, tail, feet and nose are hairless, and hairless skin fails in the
 * opposite direction to fur: the fur engine's guard hairs and mottling read as
 * grime on it. Skin gets its own smooth painter with a wet specular instead.
 */
export const SKIN = {
  base: '#a3827c',
  dark: '#654642',
  shadow: '#38211f',
  light: '#c4a096',
  /**
   * The blush that shows through a thin ear held against a light. Dustier than
   * it looks in a photograph on purpose: a saturated pink ear at tile size
   * becomes a bubblegum dot that outshines the whole animal.
   */
  translucent: '#957370',
} as const;

const SKIN_RIM_ALPHA = 0.35;
const SKIN_SPECULAR_ALPHA = 0.22;

/** A smooth hairless shape: a body gradient, a wet specular and a dark contour. */
export function paintSkin(
  ctx: Ctx,
  outline: readonly Pt[],
  lightFrom: Pt,
  shade = 0,
  tint: string = SKIN.base,
): void {
  const bounds = boundsOf(outline);
  const centre = centroidOf(outline);
  const rx = Math.max((bounds.maxX - bounds.minX) / 2, MIN_RADIUS);
  const ry = Math.max((bounds.maxY - bounds.minY) / 2, MIN_RADIUS);
  const radius = Math.max(rx, ry);

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();

  const body = ctx.createRadialGradient(
    centre.x + lightFrom.x * rx * 0.5,
    centre.y + lightFrom.y * ry * 0.5,
    radius * 0.08,
    centre.x,
    centre.y,
    radius * 1.25,
  );
  body.addColorStop(0, mix(mix(tint, SKIN.light, 0.45), SHADOW_INK, shade));
  body.addColorStop(0.55, mix(tint, SHADOW_INK, shade));
  body.addColorStop(1, mix(SKIN.dark, SHADOW_INK, shade));
  ctx.fillStyle = body;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  const specular = ctx.createRadialGradient(
    centre.x + lightFrom.x * rx * 0.6,
    centre.y + lightFrom.y * ry * 0.6,
    0,
    centre.x + lightFrom.x * rx * 0.6,
    centre.y + lightFrom.y * ry * 0.6,
    radius * 0.55,
  );
  specular.addColorStop(0, rgba('#ffffff', SKIN_SPECULAR_ALPHA * (1 - shade)));
  specular.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = specular;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();

  ctx.strokeStyle = rgba(SKIN.shadow, SKIN_RIM_ALPHA + shade * 0.3);
  ctx.lineWidth = 0.009;
  traceOutline(ctx, outline);
  ctx.stroke();
}

/**
 * Lays a single dark line around the *union* of several clumps.
 *
 * Contouring each clump on its own draws the seams between them as well as the
 * outer edge, which turns one animal into a bag of overlapping ovals. Filling
 * and stroking every outline in the same ink first, then painting the coat over
 * the top, leaves ink showing only where no clump covers it — which is exactly
 * the silhouette and nothing else.
 */
export function paintSilhouette(
  ctx: Ctx,
  outlines: ReadonlyArray<readonly Pt[]>,
  width = CONTOUR_WIDTH,
): void {
  ctx.save();
  ctx.fillStyle = rgba(SHADOW_INK, CONTOUR_ALPHA);
  ctx.strokeStyle = rgba(SHADOW_INK, CONTOUR_ALPHA);
  ctx.lineWidth = width * 2;
  ctx.lineJoin = 'round';
  for (const outline of outlines) {
    traceOutline(ctx, outline);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ── Shared props ─────────────────────────────────────────────────────────────

const SHADOW_ALPHA = 0.42;

/**
 * Smallest radius any painter will work with. node-canvas throws on a NaN
 * gradient rather than drawing something wrong, so every divisor that a pose
 * could drive to zero is floored here instead.
 */
const MIN_RADIUS = 0.001;

export function drawGroundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  const radius = Math.max(rx, ry, MIN_RADIUS);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, rgba(SHADOW_INK, SHADOW_ALPHA));
  grad.addColorStop(1, rgba(SHADOW_INK, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / radius);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface FootPose {
  /** Offset from the foot's rest position, in tile units. */
  readonly dx: number;
  readonly dy: number;
  /** 0 planted, 1 fully raised — drives the toe curl and the foreshortening. */
  readonly lift: number;
  /** 0 toes together, 1 fully splayed. A planted rat foot splays; a lifted one curls. */
  readonly splay: number;
}

export interface TailPose {
  /** Direction the tail leaves the body, in radians. */
  readonly base: number;
  /** Total bend accumulated along the tail; positive curls toward the tip. */
  readonly curl: number;
  /** Amplitude of the travelling wave that makes the tail read as boneless. */
  readonly wave: number;
  readonly phase: number;
  /** Extra flick applied to the last third only, the way a real tail tips. */
  readonly flick: number;
  /** Shifts where the tail leaves the body. */
  readonly rootX: number;
  readonly rootY: number;
}

export interface RatPose {
  readonly bob: number;
  readonly sway: number;
  readonly lean: number;
  readonly squash: number;
  readonly breathe: number;
  /**
   * Spine flexion, -1 fully extended to +1 fully humped. A rat's back is never
   * straight: it bunches on the gather and stretches on the reach, and that
   * flexion carries more of the scurry than the legs do.
   */
  readonly arch: number;
  /** 0 on all fours, 1 sat back on the haunches with the forepaws off the floor. */
  readonly rear: number;

  readonly headX: number;
  readonly headY: number;
  readonly headTilt: number;
  /** -1 looking to its right, +1 to its left. */
  readonly headTurn: number;
  /** 0 level, 1 nose down to the floor. */
  readonly headBow: number;

  /** -1 pinned flat back, 0 neutral, 1 pricked wide. */
  readonly earL: number;
  readonly earR: number;

  readonly eyeOpen: number;
  /** 0 closed, 1 gaping. */
  readonly mouth: number;
  /** 0 covered by the lip, 1 incisors fully bared. */
  readonly incisor: number;
  /** Phase of the whisker twitch; rats fan their vibrissae constantly. */
  readonly whisker: number;

  readonly tail: TailPose;
  readonly frontL: FootPose;
  readonly frontR: FootPose;
  readonly hindL: FootPose;
  readonly hindR: FootPose;

  /** Forward drive of a bite, in tile units. Moves the whole animal, not just the head. */
  readonly lunge: number;
  /** Whole-body roll, used when it goes down. */
  readonly roll: number;
  readonly shadow: number;
  /** Phase used to animate quivers within a held pose. */
  readonly time: number;
}

const REST_FOOT: FootPose = { dx: 0, dy: 0, lift: 0, splay: 0.5 };

export function restPose(): RatPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    squash: 1,
    breathe: 0,
    arch: 0,
    rear: 0,
    headX: 0,
    headY: 0,
    headTilt: 0,
    headTurn: 0,
    headBow: 0,
    earL: 0,
    earR: 0,
    eyeOpen: 1,
    mouth: 0,
    incisor: 0,
    whisker: 0,
    tail: { base: 0, curl: 0, wave: 0, phase: 0, flick: 0, rootX: 0, rootY: 0 },
    frontL: REST_FOOT,
    frontR: REST_FOOT,
    hindL: REST_FOOT,
    hindR: REST_FOOT,
    lunge: 0,
    roll: 0,
    shadow: 1,
    time: 0,
  };
}

// ── Anatomy constants (tile units, origin = centre of the tile) ───────────────

/** Where the feet meet the floor, in tile units. */
export const GROUND_Y = 0.4;

/** How far the whole animal rises off its feet when it rears back. */
const REAR_LIFT = 0.13;

// ── Coat layouts ─────────────────────────────────────────────────────────────

/**
 * The dorsal stripe and the belly, expressed once and reused by every view.
 * A rat's counter-shading is the strongest tonal cue it has at tile size: dark
 * over the spine, pale under the belly, and the transition halfway down the
 * flank.
 */
const BODY_BLOBS: readonly CoatBlob[] = [
  { x: -0.02, y: -0.15, rx: 0.34, ry: 0.13, tone: 'dorsal', seed: 1.3 },
  { x: -0.02, y: 0.2, rx: 0.28, ry: 0.075, tone: 'belly', seed: 4.1 },
];

const HAUNCH_BLOBS: readonly CoatBlob[] = [
  { x: -0.02, y: -0.1, rx: 0.17, ry: 0.1, tone: 'dorsal', seed: 7.7 },
  { x: 0.0, y: 0.12, rx: 0.13, ry: 0.08, tone: 'belly', seed: 3.1 },
];

const HEAD_BLOBS: readonly CoatBlob[] = [
  { x: -0.01, y: -0.1, rx: 0.15, ry: 0.09, tone: 'dorsal', seed: 3.9 },
  { x: 0.03, y: 0.11, rx: 0.11, ry: 0.06, tone: 'belly', seed: 6.6 },
];

// ── Face ─────────────────────────────────────────────────────────────────────

const EYE_INK = '#100606';
/**
 * A rat's eye is not quite black — it is a very dark garnet. Kept nearly at ink
 * because the bead is three pixels across in game, and anything redder than this
 * stops reading as an eye and starts reading as a glowing hazard light.
 */
const EYE_GARNET = '#33161a';
const EYE_GLINT = '#ffffff';
const INCISOR_ENAMEL = '#e0c579';
const INCISOR_ROOT = '#a8853c';
const MOUTH_DARK = '#3a161a';
const TONGUE_PINK = '#c9707a';
const WHISKER_PALE = '#f3ece0';

const EAR_INNER_RIDGE_ALPHA = 0.35;
/** Ears sit in the skull's shade; lit level they read as lamps stuck to a head. */
const EAR_SHADE = 0.18;
const EAR_VEIN_COUNT = 3;
const EAR_FUR_FRINGE = 0.016;

/**
 * The signature ear: a near-circular hairless cup with a fine fur fringe at its
 * base. Sized at roughly two thirds of the skull's height — a rat's ear is big,
 * but drawn any larger than this it stops reading as an ear and starts reading
 * as a balloon tied to the head.
 */
const EAR_RADIUS = 0.072;
const EAR_CUP_INSET = 0.6;

/**
 * @param side -1 for the ear on the screen's left, +1 for its right.
 * @param perk -1 pinned flat against the skull, +1 fanned wide.
 * @param widthScale foreshortening, for an ear seen edge-on in profile.
 */
function drawEar(
  ctx: Ctx,
  cx: number,
  cy: number,
  side: number,
  perk: number,
  widthScale = 1,
  shade = 0,
): void {
  const pinned = clamp01(-perk);
  const fanned = clamp01(perk);
  const width = EAR_RADIUS * lerp(1, 0.42, pinned) * lerp(1, 1.12, fanned) * widthScale;
  const height = EAR_RADIUS * lerp(1, 0.78, pinned) * lerp(1, 1.08, fanned);
  const lean = deg(22) * side * (1 - pinned) + deg(58) * side * pinned;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);

  const shell = ovalOutline(0, 0, width, height, 0, 12.4 + side, 0.07, 28);

  // Fur first and slightly larger, so the fuzz reads as growing out from behind
  // the ear rather than as a halo drawn around it.
  paintFur(ctx, {
    outline: ovalOutline(0, height * 0.34, width * 0.92, height * 0.72, 0, 5.2 + side, 0.1, 24),
    blobs: [],
    base: 'flank',
    seed: 71 + side * 3,
    fringe: EAR_FUR_FRINGE,
    strokes: 22,
    strokeLen: 0.03,
    flowFrom: { x: 0, y: height },
    shade: shade + 0.1,
  });

  paintSkin(ctx, shell, { x: -0.3, y: -0.6 }, shade + EAR_SHADE, SKIN.translucent);

  // The antihelix: the raised inner rim that keeps the ear from reading as a
  // flat disc pasted on the skull.
  ctx.save();
  traceOutline(ctx, shell);
  ctx.clip();
  ctx.strokeStyle = rgba(SKIN.dark, EAR_INNER_RIDGE_ALPHA);
  ctx.lineWidth = 0.01;
  traceOutline(
    ctx,
    ovalOutline(0, height * 0.12, width * EAR_CUP_INSET, height * EAR_CUP_INSET, 0, 9.9, 0.08, 22),
  );
  ctx.stroke();

  ctx.strokeStyle = rgba(SKIN.dark, EAR_INNER_RIDGE_ALPHA * 0.7);
  ctx.lineWidth = 0.006;
  for (let i = 0; i < EAR_VEIN_COUNT; i++) {
    const t = (i + 1) / (EAR_VEIN_COUNT + 1);
    const startX = lerp(-width * 0.5, width * 0.5, t);
    ctx.beginPath();
    ctx.moveTo(startX * 0.3, height * 0.55);
    ctx.quadraticCurveTo(startX * 0.8, height * 0.05, startX, -height * 0.5);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = rgba(SHADOW_INK, CONTOUR_ALPHA);
  ctx.lineWidth = 0.01;
  traceOutline(ctx, shell);
  ctx.stroke();

  ctx.restore();
}

const EYE_RADIUS = 0.032;

/** A small, wet, black bead. Anything larger reads as a mouse or a cartoon. */
function drawEye(ctx: Ctx, cx: number, cy: number, open: number, shade = 0): void {
  const openness = clamp01(open);
  if (openness < 0.12) {
    ctx.strokeStyle = rgba(FUR.dorsal.dark, 0.8);
    ctx.lineWidth = 0.009;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - EYE_RADIUS, cy);
    ctx.quadraticCurveTo(cx, cy + EYE_RADIUS * 0.6, cx + EYE_RADIUS, cy);
    ctx.stroke();
    return;
  }

  const ry = EYE_RADIUS * openness;
  const grad = ctx.createRadialGradient(
    cx - EYE_RADIUS * 0.3,
    cy - ry * 0.3,
    0,
    cx,
    cy,
    EYE_RADIUS * 1.2,
  );
  grad.addColorStop(0, mix(EYE_INK, SHADOW_INK, shade));
  grad.addColorStop(0.7, mix(EYE_INK, SHADOW_INK, shade));
  grad.addColorStop(1, mix(EYE_GARNET, SHADOW_INK, shade));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, EYE_RADIUS, ry, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = rgba(EYE_GLINT, 0.9 * (1 - shade));
  ctx.beginPath();
  ctx.ellipse(
    cx - EYE_RADIUS * 0.33,
    cy - ry * 0.38,
    EYE_RADIUS * 0.26,
    ry * 0.26,
    deg(-20),
    0,
    TWO_PI,
  );
  ctx.fill();

  // A lid line over the top third: without it the bead floats on the fur.
  ctx.strokeStyle = rgba(FUR.dorsal.dark, 0.6);
  ctx.lineWidth = 0.007;
  ctx.beginPath();
  ctx.arc(cx, cy, EYE_RADIUS * 1.05, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
}

const WHISKER_COUNT = 4;
const WHISKER_WIDTH = 0.004;
/**
 * Vibrissae sweep forward when the rat is hunting and back when it is running.
 *
 * They are drawn far sparser and dimmer than a photograph would suggest, and the
 * reason is the downsample: a dense pale fan in front of the snout averages into
 * a grey fog at 32 px that swallows the nose, the teeth and the eye behind it.
 * Four faint hairs survive as hairs; a dozen bright ones survive as haze.
 */
const WHISKER_LEN = 0.16;
const WHISKER_FAN = deg(46);
const WHISKER_MAX_ALPHA = 0.3;
/** How far a full forward sweep rotates the fan toward the direction of travel. */
const WHISKER_SWEEP_RANGE = deg(26);

/**
 * @param side -1 whiskers sweeping to screen left, +1 to screen right.
 * @param sweep -1 laid back along the body, 0 neutral, +1 fanned forward.
 */
function drawWhiskers(
  ctx: Ctx,
  cx: number,
  cy: number,
  side: number,
  sweep: number,
  lengthScale = 1,
  seed = 0,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < WHISKER_COUNT; i++) {
    const t = i / (WHISKER_COUNT - 1);
    const spread = lerp(-WHISKER_FAN / 2, WHISKER_FAN / 2, t);
    const twitch = deg(4) * Math.sin(seed + i);
    const angle = spread - sweep * WHISKER_SWEEP_RANGE + twitch;
    const len = WHISKER_LEN * lengthScale * lerp(0.72, 1, hump(t));
    // The longest whiskers are the boldest; the short ones nearest the nose all
    // but vanish in-game, which is what keeps the fan from reading as a comb.
    ctx.strokeStyle = rgba(WHISKER_PALE, WHISKER_MAX_ALPHA * (0.45 + 0.55 * hump(t)));
    ctx.lineWidth = WHISKER_WIDTH;
    const dirX = Math.cos(angle) * side;
    const dirY = Math.sin(angle);
    const droop = len * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + dirX * len * 0.55,
      cy + dirY * len * 0.55 - droop * 0.3,
      cx + dirX * len,
      cy + dirY * len + droop,
    );
    ctx.stroke();
  }
  ctx.restore();
}

const NOSE_WIDTH = 0.032;
const NOSE_HEIGHT = 0.024;

/** The wet rhinarium at the tip of the snout, with its cleft. */
function drawNose(ctx: Ctx, cx: number, cy: number, squash = 1): void {
  const outline: Pt[] = [
    { x: cx - NOSE_WIDTH, y: cy },
    { x: cx - NOSE_WIDTH * 0.5, y: cy - NOSE_HEIGHT * squash },
    { x: cx + NOSE_WIDTH * 0.5, y: cy - NOSE_HEIGHT * squash },
    { x: cx + NOSE_WIDTH, y: cy + NOSE_HEIGHT * 0.2 },
    { x: cx, y: cy + NOSE_HEIGHT * squash },
    { x: cx - NOSE_WIDTH * 0.6, y: cy + NOSE_HEIGHT * 0.6 },
  ];
  paintSkin(ctx, outline, { x: -0.4, y: -0.6 }, 0, SKIN.translucent);
  ctx.strokeStyle = rgba(SKIN.shadow, 0.6);
  ctx.lineWidth = 0.006;
  ctx.beginPath();
  ctx.moveTo(cx, cy - NOSE_HEIGHT * 0.4 * squash);
  ctx.lineTo(cx, cy + NOSE_HEIGHT * squash);
  ctx.stroke();
}

const INCISOR_WIDTH = 0.026;
const INCISOR_LENGTH = 0.055;

/**
 * The pair of chisel incisors. They are drawn as one block split by a seam
 * rather than as two teeth: at tile size two separate teeth turn into noise, and
 * the block plus seam survives the downsample.
 *
 * @param drop how far the lower jaw has swung open, in tile units.
 */
function drawIncisors(ctx: Ctx, cx: number, cy: number, bared: number, drop: number): void {
  const show = clamp01(bared);
  if (show <= 0.02) return;
  const length = INCISOR_LENGTH * show;

  const upper: Pt[] = [
    { x: cx - INCISOR_WIDTH, y: cy },
    { x: cx + INCISOR_WIDTH, y: cy },
    { x: cx + INCISOR_WIDTH * 0.8, y: cy + length },
    { x: cx - INCISOR_WIDTH * 0.8, y: cy + length },
  ];
  const grad = ctx.createLinearGradient(0, cy, 0, cy + length);
  grad.addColorStop(0, INCISOR_ROOT);
  grad.addColorStop(1, INCISOR_ENAMEL);
  ctx.fillStyle = grad;
  traceOutline(ctx, upper);
  ctx.fill();
  ctx.strokeStyle = rgba(INCISOR_ROOT, 0.7);
  ctx.lineWidth = 0.005;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + length * 0.85);
  ctx.stroke();

  // The lower pair is shorter and rides the jaw down, which is what sells the
  // gape: two teeth separating is motion, one tooth getting longer is a glitch.
  const lowerY = cy + length * 0.5 + drop;
  const lower: Pt[] = [
    { x: cx - INCISOR_WIDTH * 0.75, y: lowerY + length * 0.6 },
    { x: cx + INCISOR_WIDTH * 0.75, y: lowerY + length * 0.6 },
    { x: cx + INCISOR_WIDTH * 0.6, y: lowerY },
    { x: cx - INCISOR_WIDTH * 0.6, y: lowerY },
  ];
  ctx.fillStyle = mix(INCISOR_ENAMEL, INCISOR_ROOT, 0.3);
  traceOutline(ctx, lower);
  ctx.fill();
}

// ── Feet ─────────────────────────────────────────────────────────────────────

const TOE_COUNT_FRONT = 4;
const TOE_COUNT_HIND = 5;
const FOOT_PAD_RX = 0.034;
const FOOT_PAD_RY = 0.023;
const TOE_LENGTH = 0.04;
const TOE_WIDTH = 0.009;
const CLAW_LENGTH = 0.016;

/**
 * A naked pink foot with long separated toes. The toes are the whole point:
 * a rounded pad alone is a cat's paw, and the splayed digits are what say rodent.
 *
 * @param angle direction the toes point, in radians.
 */
function drawFoot(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  splay: number,
  hind: boolean,
  scale = 1,
  shade = 0,
): void {
  const toes = hind ? TOE_COUNT_HIND : TOE_COUNT_FRONT;
  const fan = lerp(deg(26), deg(74), clamp01(splay));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  for (let i = 0; i < toes; i++) {
    const t = i / (toes - 1);
    const toeAngle = lerp(-fan / 2, fan / 2, t);
    // The outer digits of a rat's foot are visibly shorter than the middle ones.
    const length = TOE_LENGTH * lerp(0.72, 1, hump(t)) * (hind ? 1.15 : 1);
    const tipX = Math.cos(toeAngle) * length;
    const tipY = Math.sin(toeAngle) * length;
    const toeOutline: Pt[] = [
      { x: -TOE_WIDTH * 0.6, y: 0 },
      { x: tipX - Math.sin(toeAngle) * TOE_WIDTH, y: tipY + Math.cos(toeAngle) * TOE_WIDTH },
      { x: tipX, y: tipY },
      { x: tipX + Math.sin(toeAngle) * TOE_WIDTH, y: tipY - Math.cos(toeAngle) * TOE_WIDTH },
      { x: TOE_WIDTH * 0.6, y: 0 },
    ];
    paintSkin(ctx, toeOutline, { x: -0.3, y: -0.7 }, shade);

    ctx.strokeStyle = rgba('#f0e6d2', 0.75 * (1 - shade));
    ctx.lineWidth = 0.005;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(toeAngle) * CLAW_LENGTH,
      tipY + Math.sin(toeAngle) * CLAW_LENGTH - CLAW_LENGTH * 0.35,
    );
    ctx.stroke();
  }

  paintSkin(
    ctx,
    ovalOutline(0, -FOOT_PAD_RY * 0.3, FOOT_PAD_RX, FOOT_PAD_RY, 0, 3.7 + x * 9, 0.09, 20),
    { x: -0.3, y: -0.7 },
    shade,
  );

  ctx.restore();
}

// ── Limbs ────────────────────────────────────────────────────────────────────

/**
 * How far short of full extension a two-bone solve is held. A limb solved dead
 * straight has an undefined bend direction and snaps between the two as the foot
 * crosses the threshold.
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
  // Floored away from zero: a coincident hip and foot would make `cosA` 0/0, and
  // the clamp below reads as if it makes the solve total but cannot absorb NaN.
  const reach = Math.min(Math.hypot(dx, dy), l1 + l2 - JOINT_LOCK_MARGIN);
  const dist = Math.max(MIN_RADIUS, reach);
  const base = Math.atan2(dy, dx);
  const cosA = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist * l1);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const jointAngle = base + angle * bend;
  return { x: ax + Math.cos(jointAngle) * l1, y: ay + Math.sin(jointAngle) * l1 };
}

const LIMB_UPPER_HALF_WIDTH = 0.04;
const LIMB_LOWER_HALF_WIDTH = 0.023;
/** Lighter than the body's: a full-strength line on a 5px shank reads as a stick. */
const LIMB_CONTOUR = 0.55;

/**
 * A furred two-segment leg ending in a naked foot.
 *
 * @param limbId stable identity for this limb, used to seed its fur. It must not
 * be derived from the pose: seeded off a live coordinate, a stepping limb
 * reshuffles every hair each frame while a planted one holds still, and the pair
 * visibly behaves differently for no reason.
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
  hind: boolean,
): void {
  const joint = solveJoint(hipX, hipY, footX, footY, upper, lower, bend);
  const segments: Array<readonly [Pt, Pt, number]> = [
    [{ x: hipX, y: hipY }, joint, LIMB_UPPER_HALF_WIDTH],
    [joint, { x: footX, y: footY }, LIMB_LOWER_HALF_WIDTH],
  ];
  for (const [a, b, halfWidth] of segments) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle - HALF_PI);
    paintFur(ctx, {
      outline: ovalOutline(0, len / 2, halfWidth, len / 2 + 0.012, 0, 15.5 + limbId * 3, 0.06, 24),
      blobs: [],
      base: 'flank',
      seed: 121 + limbId * 7 + halfWidth * 100,
      fringe: 0.011,
      strokes: 26,
      strokeLen: 0.03,
      flowFrom: { x: 0, y: -0.1 },
      shade,
      contour: LIMB_CONTOUR,
    });
    ctx.restore();
  }
  const footAngle = Math.atan2(footY - joint.y, footX - joint.x) - HALF_PI;
  drawFoot(ctx, footX, footY, footAngle, splay, hind, 1, shade);
}

const FRONT_LIMB_HALF_WIDTH = 0.03;
/** How far up inside the body a head-on limb roots, as a fraction of its depth. */
const FRONT_LIMB_ROOT_RISE = 0.45;
/** How far inboard of its own foot a head-on limb's root sits. */
const FRONT_LIMB_ROOT_INSET = 0.62;

/**
 * The furred column between the body and a foot, for the head-on views.
 *
 * Seen end-on a rat's leg is a short foreshortened post with the knee hidden
 * behind the shank, so this is one tapered segment rather than the two-bone
 * solve the profile uses. Without it the feet read as detached pink specks
 * sitting on the floor under the animal.
 */
function drawFrontLimb(
  ctx: Ctx,
  limbId: number,
  rootX: number,
  rootY: number,
  footX: number,
  footY: number,
  scale: number,
  shade: number,
): void {
  const dx = footX - rootX;
  const dy = footY - rootY;
  const length = Math.hypot(dx, dy);
  if (length <= MIN_RADIUS) return;
  const halfWidth = FRONT_LIMB_HALF_WIDTH * scale;

  ctx.save();
  ctx.translate(rootX, rootY);
  ctx.rotate(Math.atan2(dy, dx) - HALF_PI);
  paintFur(ctx, {
    outline: ovalOutline(
      0,
      length / 2,
      halfWidth,
      length / 2 + halfWidth,
      0,
      19.7 + limbId * 5,
      0.06,
      22,
    ),
    blobs: [],
    base: 'flank',
    seed: 201 + limbId * 11,
    fringe: 0.01,
    strokes: 20,
    strokeLen: 0.026,
    flowFrom: { x: 0, y: -0.1 },
    shade,
    contour: LIMB_CONTOUR,
  });
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

interface TailSpine {
  readonly points: Pt[];
  readonly widths: number[];
}

const TAIL_SEGMENTS = 16;
/**
 * A brown rat's tail is very nearly as long as its head and body together. Any
 * shorter and the silhouette becomes a vole; this is the cue the whole animal
 * is recognised by from across a room.
 */
const TAIL_LENGTH = 0.82;
const TAIL_BASE_WIDTH = 0.03;
const TAIL_TIP_WIDTH = 0.006;
/** Rings of keratin scales; the count is what separates the tail from a wire. */
const TAIL_RINGS = 22;
const TAIL_RING_ALPHA = 0.3;
const TAIL_FUR_ROOT_FRACTION = 0.16;

function buildTailSpine(baseX: number, baseY: number, tail: TailPose): TailSpine {
  const points: Pt[] = [{ x: baseX, y: baseY }];
  const widths: number[] = [];
  const step = TAIL_LENGTH / TAIL_SEGMENTS;
  let angle = tail.base;
  let x = baseX;
  let y = baseY;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    const t = i / TAIL_SEGMENTS;
    const wave = Math.sin(t * Math.PI * 1.8 + tail.phase) * tail.wave;
    const tipFlick = t > 0.6 ? (tail.flick * (t - 0.6)) / 0.4 : 0;
    angle +=
      (tail.curl / TAIL_SEGMENTS) * lerp(0.4, 1.7, t) +
      wave / TAIL_SEGMENTS +
      tipFlick / TAIL_SEGMENTS;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    points.push({ x, y });
    // The taper is strongly non-linear: thick and muscular for the first
    // quarter, then a long thin whip. A linear taper reads as a rope.
    widths.push(lerp(TAIL_BASE_WIDTH, TAIL_TIP_WIDTH, Math.pow(t, 0.62)));
  }
  widths.push(TAIL_TIP_WIDTH);
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
    x: tip.x + Math.cos(tipAngle) * widths[widths.length - 1] * 1.6,
    y: tip.y + Math.sin(tipAngle) * widths[widths.length - 1] * 1.6,
  };
  return [...left, cap, ...right.reverse()];
}

/** The scaly tail. Drawn behind or in front of the body depending on the view. */
export function drawTail(ctx: Ctx, baseX: number, baseY: number, tail: TailPose, shade = 0): void {
  const spine = buildTailSpine(baseX, baseY, tail);
  const outline = tailOutline(spine);

  paintSkin(ctx, outline, { x: -0.3, y: -0.8 }, shade);

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();

  ctx.strokeStyle = rgba(SKIN.shadow, TAIL_RING_ALPHA * (1 - shade * 0.5));
  ctx.lineWidth = 0.006;
  for (let i = 0; i < TAIL_RINGS; i++) {
    const t = (i + 0.5) / TAIL_RINGS;
    const index = Math.min(spine.points.length - 2, Math.floor(t * (spine.points.length - 1)));
    const p = spine.points[index];
    const next = spine.points[index + 1];
    const angle = Math.atan2(next.y - p.y, next.x - p.x);
    const w = spine.widths[index] * 1.3;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.sin(angle) * w, p.y + Math.cos(angle) * w);
    ctx.quadraticCurveTo(
      p.x + Math.cos(angle) * w * 0.5,
      p.y + Math.sin(angle) * w * 0.5,
      p.x + Math.sin(angle) * w,
      p.y - Math.cos(angle) * w,
    );
    ctx.stroke();
  }
  ctx.restore();

  // Coarse hairs only where the tail leaves the rump; the rest is bare.
  const rootIndex = Math.max(1, Math.floor(spine.points.length * TAIL_FUR_ROOT_FRACTION));
  ctx.strokeStyle = rgba(FUR.flank.dark, 0.6 * (1 - shade));
  ctx.lineWidth = 0.005;
  ctx.lineCap = 'round';
  for (let i = 0; i < rootIndex; i++) {
    const p = spine.points[i];
    const next = spine.points[i + 1];
    const angle = Math.atan2(next.y - p.y, next.x - p.x);
    const w = spine.widths[i];
    for (const side of [-1, 1]) {
      const hairLen = 0.03 * (0.6 + hash2(i, side));
      ctx.beginPath();
      ctx.moveTo(p.x - Math.sin(angle) * w * side, p.y + Math.cos(angle) * w * side);
      ctx.lineTo(
        p.x - Math.sin(angle) * (w + hairLen) * side - Math.cos(angle) * hairLen,
        p.y + Math.cos(angle) * (w + hairLen) * side - Math.sin(angle) * hairLen,
      );
      ctx.stroke();
    }
  }
}

// ── Side view (profile, facing +X) ───────────────────────────────────────────

const SIDE_BODY_CX = -0.04;
const SIDE_BODY_CY = 0.145;
const SIDE_BODY_RX = 0.272;
const SIDE_BODY_RY = 0.148;
/**
 * How far the spine humps at full arch.
 *
 * A rat does bunch its back as it gathers, but only just: pitched high enough to
 * be obvious frame by frame it stops reading as effort and starts reading as a
 * wobble in the sprite, because the back line is the one line the eye tracks.
 */
const SIDE_ARCH_RISE = 0.024;
const SIDE_HAUNCH_X = -0.24;
const SIDE_HAUNCH_Y = 0.08;
/**
 * How far the underline rises between the loin and the chest. This taper is the
 * difference between a rat's profile and a barrel with legs on it.
 */
const BELLY_TUCK = 0.085;
const SIDE_HAUNCH_RX = 0.175;
const SIDE_HAUNCH_RY = 0.16;
const SIDE_SHOULDER_X = 0.17;
const SIDE_SHOULDER_Y = 0.02;
const SIDE_SHOULDER_RX = 0.128;
const SIDE_SHOULDER_RY = 0.125;
/**
 * The neck is a short thick cone rather than a joint. A rat has no visible neck
 * at all — drawing one is the single fastest way to turn it into a weasel.
 */
/**
 * Where the skull sits relative to the body centre.
 *
 * A rat has no visible neck, so the head has to *overlap* the chest by a real
 * margin rather than perch next to it — pitched even slightly high and forward,
 * the two shapes only touch at a corner and the head reads as floating.
 */
const SIDE_HEAD_X = 0.318;
const SIDE_HEAD_Y = -0.012;
const SIDE_SKULL_RX = 0.135;
const SIDE_SKULL_RY = 0.115;
/** How far the snout runs past the skull. This wedge is the whole profile. */
const SIDE_SNOUT_REACH = 0.14;
const SIDE_HIP_X = -0.235;
const SIDE_HIP_Y = 0.145;
const SIDE_FORE_UPPER = 0.14;
const SIDE_FORE_LOWER = 0.15;
const SIDE_HIND_UPPER = 0.185;
const SIDE_HIND_LOWER = 0.2;
const FAR_LIMB_SHADE = 0.34;

/**
 * Fur seeds, one per limb. Constants rather than anything derived from the pose,
 * so a limb's hairs stay put as it steps — see `drawLeg`.
 */
const LIMB_ID = {
  farHind: 1,
  farFore: 2,
  nearHind: 3,
  nearFore: 4,
  // The head-on views show a left/right pair rather than a near/far one, so
  // those four get ids of their own rather than sharing the profile's.
  headOnFarLeft: 5,
  headOnFarRight: 6,
  headOnNearLeft: 7,
  headOnNearRight: 8,
} as const;

function sideBodyMetrics(p: RatPose): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: SIDE_BODY_CX + p.sway + p.lunge,
    cy: SIDE_BODY_CY + p.bob - REAR_LIFT * p.rear,
    // Both radii are divisors in the arch and belly-tuck terms of `drawRatSide`,
    // so both are floored; a pose that collapsed either would bake a NaN.
    rx: Math.max(MIN_RADIUS, SIDE_BODY_RX * (1 - 0.06 * clamp01(p.arch)) * (1 + p.breathe * 0.02)),
    ry: Math.max(MIN_RADIUS, SIDE_BODY_RY * p.squash * (1 + p.breathe * 0.05)),
  };
}

/**
 * The profile head: skull, snout wedge, ear behind, eye, incisors, whiskers.
 * Drawn in its own local frame so the whole head can bow and turn as a unit.
 */
function drawHeadSide(ctx: Ctx, p: RatPose): void {
  const body = sideBodyMetrics(p);
  const hx = SIDE_HEAD_X + body.cx - SIDE_BODY_CX + p.headX;
  const hy =
    SIDE_HEAD_Y + body.cy - SIDE_BODY_CY + p.headY - SIDE_ARCH_RISE * clamp01(p.arch) * 0.4;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(p.headTilt + p.headBow * deg(34));

  // Far ear first, foreshortened, so the near ear overlaps it.
  drawEar(ctx, -0.1, -0.07, -1, p.earL, 0.45, 0.26);

  const skull = ovalOutline(0, 0, SIDE_SKULL_RX, SIDE_SKULL_RY, deg(-6), 6.1, 0.05);
  // The snout: a straight-topped wedge running out of the skull with no stop
  // where a cat has a brow. That unbroken line is the whole rodent profile.
  const snoutTipX = SIDE_SKULL_RX * 0.35 + SIDE_SNOUT_REACH;
  const snout: Pt[] = [
    { x: -0.02, y: -SIDE_SKULL_RY * 0.78 },
    { x: SIDE_SKULL_RX * 0.6, y: -SIDE_SKULL_RY * 0.66 },
    { x: snoutTipX * 0.84, y: -SIDE_SKULL_RY * 0.42 },
    { x: snoutTipX, y: SIDE_SKULL_RY * 0.02 },
    { x: snoutTipX * 0.92, y: SIDE_SKULL_RY * 0.4 },
    { x: SIDE_SKULL_RX * 0.55, y: SIDE_SKULL_RY * 0.7 },
    { x: -0.02, y: SIDE_SKULL_RY * 0.72 },
  ];
  paintSilhouette(ctx, [skull, snout]);

  paintFur(ctx, {
    outline: skull,
    blobs: HEAD_BLOBS,
    base: 'flank',
    seed: 131,
    fringe: 0.013,
    strokes: 90,
    strokeLen: 0.035,
    flowFrom: { x: -0.12, y: -0.03 },
  });

  paintFur(ctx, {
    outline: snout,
    blobs: [
      { x: snoutTipX * 0.5, y: SIDE_SKULL_RY * 0.34, rx: 0.11, ry: 0.05, tone: 'belly', seed: 8.1 },
    ],
    base: 'flank',
    seed: 141,
    fringe: 0.011,
    strokes: 55,
    strokeLen: 0.028,
    flowFrom: { x: -0.1, y: 0 },
  });

  const noseX = snoutTipX * 0.98;
  const noseY = SIDE_SKULL_RY * 0.06;

  // Mouth and teeth sit under the snout tip, tucked back from the nose the way a
  // rodent's do — the incisors protrude from *behind* the rhinarium, not from it.
  const gape = clamp01(p.mouth);
  const jawDrop = gape * 0.075;
  if (gape > 0.04) {
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.moveTo(noseX - 0.015, noseY + 0.012);
    ctx.quadraticCurveTo(
      noseX - 0.09,
      noseY + 0.03 + jawDrop * 0.8,
      SIDE_SKULL_RX * 0.35,
      noseY + 0.028 + jawDrop * 0.4,
    );
    ctx.quadraticCurveTo(noseX - 0.07, noseY + 0.014, noseX - 0.015, noseY + 0.012);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba(TONGUE_PINK, 0.9);
    ctx.beginPath();
    ctx.ellipse(
      noseX - 0.075,
      noseY + 0.026 + jawDrop * 0.5,
      0.03,
      0.012 + 0.008 * gape,
      deg(6),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  drawIncisors(ctx, noseX - 0.028, noseY + 0.012, p.incisor, jawDrop);
  drawNose(ctx, noseX, noseY, 1);

  drawWhiskers(ctx, noseX - 0.02, noseY - 0.008, 1, p.whisker, 1, p.time * 7);
  drawWhiskers(ctx, noseX - 0.02, noseY + 0.014, 1, p.whisker - 0.35, 0.85, p.time * 7 + 2);

  drawEye(ctx, SIDE_SKULL_RX * 0.4, -SIDE_SKULL_RY * 0.2, p.eyeOpen);
  drawEar(ctx, -0.062, -0.085, 1, p.earR, 0.88);

  ctx.restore();
}

export function drawRatSide(ctx: Ctx, p: RatPose): void {
  const body = sideBodyMetrics(p);
  const archRise = SIDE_ARCH_RISE * p.arch;
  // Everything downstream is authored against the rest pose, so the lunge and
  // the sway are folded in once here as a whole-body drift rather than being
  // re-added at twenty call sites.
  const drift = body.cx - SIDE_BODY_CX;
  const rise = body.cy - SIDE_BODY_CY;

  ctx.save();
  drawGroundShadow(ctx, body.cx, GROUND_Y + 0.04, 0.36 * p.shadow, 0.075 * p.shadow);
  ctx.translate(body.cx, body.cy);
  ctx.rotate(p.roll);
  ctx.translate(-body.cx, -body.cy);
  ctx.rotate(p.lean);

  const shoulderX = SIDE_SHOULDER_X + drift;
  const shoulderY = body.cy + SIDE_SHOULDER_Y;
  const hipX = SIDE_HIP_X + drift;
  const hipY = body.cy + SIDE_HIP_Y - SIDE_BODY_CY;

  drawTail(
    ctx,
    body.cx - body.rx * 0.92 + p.tail.rootX,
    body.cy + 0.02 + p.tail.rootY,
    p.tail,
    0.1,
  );

  // Far pair first and in the body's shade — the tonal split is what separates
  // four legs into two pairs at a size where four outlines would merge.
  const FAR_LIMB_INSET = 0.02;
  drawLeg(
    ctx,
    LIMB_ID.farHind,
    hipX + FAR_LIMB_INSET,
    hipY,
    hipX + p.hindL.dx + FAR_LIMB_INSET,
    GROUND_Y + p.hindL.dy,
    SIDE_HIND_UPPER,
    SIDE_HIND_LOWER,
    1,
    FAR_LIMB_SHADE,
    p.hindL.splay,
    true,
  );
  drawLeg(
    ctx,
    LIMB_ID.farFore,
    shoulderX - FAR_LIMB_INSET,
    shoulderY,
    shoulderX + p.frontL.dx - FAR_LIMB_INSET,
    GROUND_Y + p.frontL.dy,
    SIDE_FORE_UPPER,
    SIDE_FORE_LOWER,
    -1,
    FAR_LIMB_SHADE,
    p.frontL.splay,
    false,
  );

  const haunchX = SIDE_HAUNCH_X + drift;
  const haunchY = SIDE_HAUNCH_Y + rise - archRise * 0.4;
  const haunch = ovalOutline(
    haunchX,
    haunchY,
    SIDE_HAUNCH_RX,
    SIDE_HAUNCH_RY,
    deg(-6),
    16.3,
    0.05,
    36,
  );

  // The barrel is an oval whose top is pushed up by the arch, which is cheaper
  // and reads better than deforming a spline: the silhouette change all happens
  // along the back line, and the back line is the only one the eye tracks.
  const barrel = ovalOutline(body.cx, body.cy, body.rx, body.ry, deg(-2), 2.1, 0.05).map((q) => {
    const aboveSpine = Math.max(0, (body.cy - q.y) / body.ry);
    const belowBelly = Math.max(0, (q.y - body.cy) / body.ry);
    const towardChest = clamp01((q.x - body.cx) / body.rx);
    // The tuck is quadratic in `towardChest` so the underline stays deep across
    // the whole loin and then lifts sharply behind the forelegs, which is where
    // a rat's belly actually leaves the floor.
    const tuck = BELLY_TUCK * belowBelly * towardChest * towardChest;
    return { x: q.x, y: q.y - archRise * aboveSpine - tuck };
  });

  const chestY = shoulderY - 0.02;
  const chest = ovalOutline(
    shoulderX,
    chestY,
    SIDE_SHOULDER_RX,
    SIDE_SHOULDER_RY,
    deg(4),
    11.2,
    0.06,
    32,
  );

  paintSilhouette(ctx, [haunch, barrel, chest]);

  paintFur(ctx, {
    outline: haunch,
    blobs: HAUNCH_BLOBS.map((b) => ({ ...b, x: b.x + haunchX, y: b.y + haunchY })),
    base: 'flank',
    seed: 151,
    fringe: 0.014,
    strokes: 80,
    strokeLen: 0.04,
    flowFrom: { x: body.cx, y: body.cy - 0.12 },
  });

  paintFur(ctx, {
    outline: barrel,
    blobs: BODY_BLOBS.map((b) => ({
      ...b,
      x: b.x + body.cx,
      y: b.y * 0.85 + body.cy - archRise * 0.4,
    })),
    base: 'flank',
    seed: 161,
    fringe: 0.015,
    strokes: 190,
    strokeLen: 0.045,
    flowFrom: { x: body.cx - 0.16, y: body.cy - body.ry },
  });

  paintFur(ctx, {
    outline: chest,
    blobs: [
      {
        x: shoulderX,
        y: chestY - SIDE_SHOULDER_RY * 0.5,
        rx: 0.11,
        ry: 0.07,
        tone: 'dorsal',
        seed: 2.9,
      },
      {
        x: shoulderX,
        y: chestY + SIDE_SHOULDER_RY * 0.68,
        rx: 0.08,
        ry: 0.045,
        tone: 'belly',
        seed: 7.8,
      },
    ],
    base: 'flank',
    seed: 181,
    fringe: 0.014,
    strokes: 75,
    strokeLen: 0.04,
    flowFrom: { x: body.cx, y: body.cy - 0.16 },
  });

  drawLeg(
    ctx,
    LIMB_ID.nearHind,
    hipX,
    hipY,
    hipX + p.hindR.dx,
    GROUND_Y + p.hindR.dy,
    SIDE_HIND_UPPER,
    SIDE_HIND_LOWER,
    1,
    0,
    p.hindR.splay,
    true,
  );
  drawLeg(
    ctx,
    LIMB_ID.nearFore,
    shoulderX,
    shoulderY,
    shoulderX + p.frontR.dx,
    GROUND_Y + p.frontR.dy,
    SIDE_FORE_UPPER,
    SIDE_FORE_LOWER,
    -1,
    0,
    p.frontR.splay,
    false,
  );

  drawHeadSide(ctx, p);

  ctx.restore();
}

// ── Head-on views ────────────────────────────────────────────────────────────

const FRONT_BODY_CY = 0.13;
/**
 * Head-on the body is slightly taller than it is wide, and its width tracks the
 * profile's depth: drawn rounder than that, the same animal reads as a barrel
 * from the front and as a rat from the side.
 */
const FRONT_BODY_RX = 0.166;
const FRONT_BODY_RY = 0.178;
const FRONT_HEAD_CY = -0.14;
const FRONT_SKULL_RX = 0.135;
const FRONT_SKULL_RY = 0.125;
/** How far the snout drops below the skull toward the camera. */
const FRONT_SNOUT_DROP = 0.122;
const FRONT_SNOUT_RX = 0.062;
const FRONT_EAR_DX = 0.132;
const FRONT_EAR_DY = -0.075;
const FRONT_EYE_DX = 0.082;
const FRONT_EYE_DY = -0.03;
const FRONT_FOOT_DX = 0.098;
const FRONT_FOOT_Y = 0.355;
const FRONT_HIND_FOOT_DX = 0.185;
const FRONT_HIND_FOOT_Y = 0.335;
/** The far pair stands a body-length deeper, so it is smaller and darker. */
const FAR_FOOT_SCALE = 0.86;
const FAR_FOOT_SHADE = 0.24;

function frontHeadAnchor(p: RatPose): Pt {
  return {
    x: p.sway + p.headX + p.headTurn * 0.03,
    y: FRONT_HEAD_CY + p.headY + p.bob * 0.6 + p.headBow * 0.14 - REAR_LIFT * p.rear,
  };
}

/**
 * The head coming at the camera. The wedge is the whole problem: seen head-on a
 * rat's skull is narrow and its snout hangs below and in front of it, so the
 * silhouette is a rounded triangle with the ears at the top corners.
 */
function drawHeadFront(ctx: Ctx, p: RatPose, back: boolean): void {
  const anchor = frontHeadAnchor(p);
  const turn = p.headTurn;

  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(p.headTilt);

  drawEar(ctx, -FRONT_EAR_DX + turn * 0.03, FRONT_EAR_DY, -1, p.earL, 1, back ? 0.12 : 0);
  drawEar(ctx, FRONT_EAR_DX + turn * 0.03, FRONT_EAR_DY, 1, p.earR, 1, back ? 0.12 : 0);

  paintFur(ctx, {
    outline: ovalOutline(turn * 0.02, 0, FRONT_SKULL_RX, FRONT_SKULL_RY, 0, 2.6, 0.05),
    blobs: back
      ? [{ x: 0, y: -0.02, rx: 0.13, ry: 0.1, tone: 'dorsal', seed: 3.9 }]
      : HEAD_BLOBS.map((b) => ({ ...b, x: b.x * 0.6, y: b.y * 0.8 })),
    base: 'flank',
    seed: 51,
    fringe: 0.014,
    strokes: 110,
    strokeLen: 0.035,
    flowFrom: { x: 0, y: -0.04 },
    shade: back ? 0.1 : 0,
    contour: 1,
  });

  if (back) {
    ctx.restore();
    return;
  }

  const snoutY = FRONT_SNOUT_DROP;
  const snoutX = turn * 0.05;
  const snoutWedge: Pt[] = [
    { x: snoutX - FRONT_SNOUT_RX, y: snoutY - FRONT_SNOUT_RX * 0.85 },
    { x: snoutX + FRONT_SNOUT_RX, y: snoutY - FRONT_SNOUT_RX * 0.85 },
    { x: snoutX + FRONT_SNOUT_RX * 0.78, y: snoutY + FRONT_SNOUT_RX * 0.35 },
    { x: snoutX + FRONT_SNOUT_RX * 0.38, y: snoutY + FRONT_SNOUT_RX * 0.95 },
    { x: snoutX - FRONT_SNOUT_RX * 0.38, y: snoutY + FRONT_SNOUT_RX * 0.95 },
    { x: snoutX - FRONT_SNOUT_RX * 0.78, y: snoutY + FRONT_SNOUT_RX * 0.35 },
  ];
  paintFur(ctx, {
    outline: snoutWedge,
    blobs: [{ x: snoutX, y: snoutY + 0.03, rx: 0.05, ry: 0.035, tone: 'belly', seed: 6.6 }],
    base: 'flank',
    seed: 61,
    fringe: 0.012,
    strokes: 40,
    strokeLen: 0.026,
    flowFrom: { x: 0, y: -0.05 },
    contour: 1,
  });

  drawEye(ctx, -FRONT_EYE_DX + turn * 0.05, FRONT_EYE_DY, p.eyeOpen);
  drawEye(ctx, FRONT_EYE_DX + turn * 0.05, FRONT_EYE_DY, p.eyeOpen);

  const noseX = snoutX;
  const noseY = snoutY + FRONT_SNOUT_RX * 0.72;
  const gape = clamp01(p.mouth);
  const jawDrop = gape * 0.06;
  if (gape > 0.04) {
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.ellipse(noseX, noseY + 0.03 + jawDrop * 0.5, 0.042, 0.02 + jawDrop, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(TONGUE_PINK, 0.9);
    ctx.beginPath();
    ctx.ellipse(noseX, noseY + 0.038 + jawDrop * 0.7, 0.022, 0.01 + 0.008 * gape, 0, 0, TWO_PI);
    ctx.fill();
  }
  drawIncisors(ctx, noseX, noseY + 0.016, p.incisor, jawDrop);
  drawNose(ctx, noseX, noseY, 0.85);

  drawWhiskers(ctx, noseX - 0.02, noseY - 0.004, -1, p.whisker, 0.92, p.time * 7);
  drawWhiskers(ctx, noseX + 0.02, noseY - 0.004, 1, p.whisker, 0.92, p.time * 7 + 1);

  ctx.restore();
}

function frontFootRest(p: RatPose, side: number, hind: boolean): Pt {
  const dx = hind ? FRONT_HIND_FOOT_DX : FRONT_FOOT_DX;
  const y = hind ? FRONT_HIND_FOOT_Y : FRONT_FOOT_Y;
  return { x: side * dx + p.sway * (hind ? 0.4 : 0.7), y: y + p.bob * (hind ? 0.15 : 0.3) };
}

/** Shared body for the two head-on views; `back` flips which pair of feet shows. */
function drawRatHeadOn(ctx: Ctx, p: RatPose, back: boolean): void {
  const cx = p.sway;
  const cy = FRONT_BODY_CY + p.bob - REAR_LIFT * p.rear;
  const rx = FRONT_BODY_RX * (1 + p.breathe * 0.03);
  const ry = FRONT_BODY_RY * p.squash * (1 + p.breathe * 0.04);

  ctx.save();
  ctx.rotate(p.roll);
  drawGroundShadow(ctx, cx * 0.5, GROUND_Y + 0.04, 0.26 * p.shadow, 0.07 * p.shadow);
  ctx.rotate(p.lean);

  // From behind the tail leaves the rump straight at the camera, so it is drawn
  // over the body; from the front it disappears behind one flank.
  if (!back) drawTail(ctx, cx + rx * 0.5 + p.tail.rootX, cy + 0.02 + p.tail.rootY, p.tail, 0.25);

  const farFeet: ReadonlyArray<readonly [FootPose, number]> = back
    ? [
        [p.frontL, -1],
        [p.frontR, 1],
      ]
    : [
        [p.hindL, -1],
        [p.hindR, 1],
      ];
  for (const [foot, side] of farFeet) {
    const rest = frontFootRest(p, side, !back);
    const footX = rest.x + foot.dx;
    const footY = rest.y + foot.dy;
    drawFrontLimb(
      ctx,
      side < 0 ? LIMB_ID.headOnFarLeft : LIMB_ID.headOnFarRight,
      cx + (footX - cx) * FRONT_LIMB_ROOT_INSET,
      cy + ry * FRONT_LIMB_ROOT_RISE,
      footX,
      footY,
      FAR_FOOT_SCALE,
      FAR_FOOT_SHADE,
    );
    drawFoot(ctx, footX, footY, 0, foot.splay, !back, FAR_FOOT_SCALE, FAR_FOOT_SHADE);
  }

  paintFur(ctx, {
    outline: ovalOutline(cx, cy, rx, ry, 0, 2.1, 0.05),
    blobs: BODY_BLOBS.map((b) => ({
      ...b,
      x: b.x * 0.55 + cx,
      y: b.y * 0.9 + cy,
      rx: b.rx * 0.55,
    })),
    base: 'flank',
    seed: 161,
    fringe: 0.015,
    strokes: 150,
    strokeLen: 0.042,
    flowFrom: { x: cx, y: cy - ry },
    shade: back ? 0.06 : 0,
    contour: 1,
  });

  if (back) drawTail(ctx, cx + p.tail.rootX, cy - ry * 0.5 + p.tail.rootY, p.tail, 0);

  const nearFeet: ReadonlyArray<readonly [FootPose, number]> = back
    ? [
        [p.hindL, -1],
        [p.hindR, 1],
      ]
    : [
        [p.frontL, -1],
        [p.frontR, 1],
      ];
  for (const [foot, side] of nearFeet) {
    const rest = frontFootRest(p, side, back);
    const footX = rest.x + foot.dx;
    const footY = rest.y + foot.dy;
    drawFrontLimb(
      ctx,
      side < 0 ? LIMB_ID.headOnNearLeft : LIMB_ID.headOnNearRight,
      cx + (footX - cx) * FRONT_LIMB_ROOT_INSET,
      cy + ry * FRONT_LIMB_ROOT_RISE,
      footX,
      footY,
      1,
      0,
    );
    drawFoot(ctx, footX, footY, 0, foot.splay, back, 1, 0);
  }

  drawHeadFront(ctx, p, back);

  ctx.restore();
}

/** The rat walking toward the camera. */
export function drawRatFront(ctx: Ctx, p: RatPose): void {
  drawRatHeadOn(ctx, p, false);
}

/** The rat walking away from the camera. */
export function drawRatBack(ctx: Ctx, p: RatPose): void {
  drawRatHeadOn(ctx, p, true);
}
