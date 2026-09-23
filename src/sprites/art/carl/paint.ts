/**
 * The painting primitives every part of Carl is built from: capsule traces,
 * the form-shading recipe, the cast shadow one form throws on another, the
 * leather/cloth crease, and the contact shadow on the floor.
 *
 * Every form is painted the same way — trace an anatomical silhouette, fill it
 * with the material's lit base, clip to it, and lay the shading down in the
 * form's own frame — so the terminator is a line running along the anatomy
 * rather than a ring round the middle of it. A part file supplies the shape and
 * the axis; this module decides where the light falls.
 *
 * No part draws its own outline. The dark line round Carl is derived once, from
 * the finished figure's silhouette, in `figure.ts`; internal boundaries are
 * separated by value and by {@link castShadow}.
 */

import { angleBetween, HALF_PI, rotate, TWO_PI } from './geometry';
import { type GlossRamp, LIGHT, OUTLINE, type Ramp } from './palette';
import { lerp, type Pt, rgba } from '../carlArt';
import { type CreaseLayer, fillSoftEllipse, strokeSoftCrease, withClip } from '../softShade';

type Ctx = CanvasRenderingContext2D;

/** Traces a capsule: a quad between two circles, with both caps rounded. */
function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  ctx.beginPath();
  addCapsule(ctx, a, b, wa, wb);
}

/**
 * Adds a capsule to the current path without starting a new one, so several
 * capsules can make up one silhouette.
 *
 * Every capsule is wound the same way whichever end is `a`, so a union of them
 * fills as one shape under the default non-zero rule instead of punching holes
 * where two overlap.
 */
export function addCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.arc(a.x, a.y, wa, normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, wb, normal + Math.PI, normal + TWO_PI);
  ctx.closePath();
}

export function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Line width for the handful of features that are a genuine dark mark — the
 * lid line, a knuckle notch, the mouth. Never for a silhouette.
 */
export const FEATURE_LINE_WIDTH = 0.014;

// ── Form shading ─────────────────────────────────────────────────────────────

/** The line a form runs along, from its root to its tip. */
interface FormAxis {
  readonly from: Pt;
  readonly to: Pt;
}

/** How one form is shaded. Only `halfWidth` is required. */
interface FormShading {
  /**
   * Half the form's width across its axis, in the context's units. The
   * terminator is placed as a fraction of this, so an over-estimate moves the
   * shadow off the form and an under-estimate crowds it into the middle.
   */
  readonly halfWidth: number;
  /**
   * How strongly the shading replaces the base, 0–1. A far limb or a flat plane
   * wants less; a muscle belly that has to survive the 32 px tile wants the full
   * value (see the note on banding in {@link shadeForm}).
   */
  readonly contrast?: number;
  /**
   * Where the terminator crosses the form, 0 at the lit edge and 1 at the shadow
   * edge. Left out, it is chosen from how side-on the key light is to this axis.
   */
  readonly terminator?: number;
  /**
   * Widens the half-tone band either side of the terminator. 1 is the narrow
   * band a limb wants; a broad or near-spherical form (a skull, a back) needs
   * more, or a crisp line down its middle reads as two materials.
   */
  readonly softness?: number;
  /** Strength of a specular streak; only painted for a {@link GlossRamp}. */
  readonly specular?: number;
  /**
   * The rotation the caller has already applied to the context, relative to
   * figure space. A hand or foot is painted inside its own rotated frame, and
   * the key light has to be turned back by that much or its shadow lands on the
   * wrong side.
   */
  readonly frameRotation?: number;
  /** False when the caller has already laid the base, e.g. one fill shared by several forms. */
  readonly fillBase?: boolean;
}

/**
 * The terminator for a form lit squarely from the side, and for one lit along
 * its length. The key is in front of the figure as well as above and to the
 * left of it, so even a side-lit form shows the viewer more lit surface than
 * shadow: a terminator at the halfway line splits every form into two panels.
 */
const TERMINATOR_SIDE_LIT = 0.58;
const TERMINATOR_END_LIT = 0.82;
/**
 * Gradient stops across a form, 0 at the lit edge and 1 at the shadow edge.
 * The lit edge itself turns away from the viewer, so the brightest band sits a
 * little in from it; the far edge picks up light bounced off the floor, so the
 * shadow lifts back to `dark` right at the rim.
 */
const LIT_EDGE_STOP = 0;
const LIGHT_BAND_STOP = 0.2;
/** Width of the half-tone either side of the terminator. Narrow, so it bands. */
const TERMINATOR_HALF_BAND = 0.09;
const CORE_SHADOW_STOP = 0.9;
const BOUNCE_EDGE_STOP = 1;

/** A specular streak rides between the lit edge and the axis, toward the lit end. */
const SPECULAR_ACROSS = 0.5;
const SPECULAR_ALONG = 0.12;
const SPECULAR_LENGTH = 0.32;
const SPECULAR_WIDTH = 0.16;
const SPECULAR_CORE = 0.3;

/** The key light turned into a frame the context has already been rotated into. */
function lightIn(frameRotation: number): Pt {
  return rotate(LIGHT, -frameRotation);
}

function hasSpecular(ramp: Ramp | GlossRamp): ramp is GlossRamp {
  return 'specular' in ramp;
}

/**
 * Shades one form: fills `trace` with the ramp's lit base, then, clipped to
 * it, lays a light-to-shadow gradient straight across `axis`.
 *
 * Why across the axis: a limb, a torso or a finger is a cylinder, and a
 * cylinder's terminator is a line parallel to its length. Soft shade and
 * highlight blobs centred on the form put that boundary on a circle instead,
 * which is the look of paint airbrushed onto a flat board. Rotating the
 * gradient into the form's own frame is what keeps the line on the anatomy as
 * the limb swings.
 *
 * Why the band is narrow: at the 32 px tile a form is a handful of pixels
 * across, and a gentle two-tone roll-off averages into one flat colour. The
 * light, half-tone and shadow have to be separate steps to survive the shrink.
 *
 * There is no pool of light along the form's length: a top-of-the-thigh
 * brightening is a fraction of one ramp step spread over a few pixels, it
 * does not survive the 32 px tile, and every extra fill inside a clip costs
 * as much as the across-axis gradient itself.
 *
 * `inside` paints the form's sub-forms and folds in the same clip, which
 * costs one clip rather than two.
 *
 * The trace must be a closed silhouette; it is traced once to fill and once
 * more to clip, so it must not depend on being called only once.
 */
export function shadeForm(
  ctx: Ctx,
  trace: () => void,
  axis: FormAxis,
  ramp: Ramp | GlossRamp,
  shading: FormShading,
  inside?: () => void,
): void {
  if (shading.fillBase ?? true) {
    trace();
    ctx.fillStyle = ramp.base;
    ctx.fill();
  }
  withClip(ctx, trace, () => {
    shadeClipped(ctx, axis, ramp, shading);
    inside?.();
  });
}

/**
 * The shading half of {@link shadeForm}, for a caller that has already filled
 * its form and clipped the context to it — a shape built inline, or one whose
 * clip also has to hold detail painted after the shading (a face, a print).
 * Paints past the form in every direction, so it must be called inside a clip.
 */
export function shadeClipped(
  ctx: Ctx,
  axis: FormAxis,
  ramp: Ramp | GlossRamp,
  shading: FormShading,
): void {
  const { halfWidth } = shading;
  const contrast = shading.contrast ?? 1;
  const light = lightIn(shading.frameRotation ?? 0);
  const length = Math.hypot(axis.to.x - axis.from.x, axis.to.y - axis.from.y);
  const angle = angleBetween(axis.from, axis.to);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const lightAcross = across.x * light.x + across.y * light.y;
  const lightAlong = along.x * light.x + along.y * light.y;
  const litSide = lightAcross >= 0 ? 1 : -1;
  const sideOn = Math.min(1, Math.abs(lightAcross) / LIGHT_SIDE_ON);
  const half = TERMINATOR_HALF_BAND * Math.max(1, shading.softness ?? 1);
  const terminator = clampTerminator(
    shading.terminator ?? lerp(TERMINATOR_END_LIT, TERMINATOR_SIDE_LIT, sideOn),
    half,
  );
  const centre = {
    x: (axis.from.x + axis.to.x) / 2,
    y: (axis.from.y + axis.to.y) / 2,
  };

  const reach = length / 2 + halfWidth * CLIP_OVERSHOOT;
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(angle);
  // Local +y is `across`; the lit edge is at litSide * halfWidth.
  const gradient = ctx.createLinearGradient(0, litSide * halfWidth, 0, -litSide * halfWidth);
  addOrderedStops(gradient, [
    [LIT_EDGE_STOP, ramp.base],
    [LIGHT_BAND_STOP, ramp.light],
    [terminator - half * 2, ramp.base],
    [terminator - half, ramp.base],
    [terminator, ramp.mid],
    [terminator + half, ramp.shadow],
    [CORE_SHADOW_STOP, ramp.shadow],
    [BOUNCE_EDGE_STOP, ramp.dark],
  ]);
  ctx.globalAlpha *= contrast;
  ctx.fillStyle = gradient;
  const bandHalf = halfWidth * CLIP_OVERSHOOT;
  ctx.fillRect(-reach, -bandHalf, reach * 2, bandHalf * 2);

  ctx.restore();

  const specular = shading.specular ?? 0;
  if (specular > 0 && hasSpecular(ramp)) {
    const streakAlong = Math.sign(lightAlong) * length * SPECULAR_ALONG;
    const streakAcross = litSide * halfWidth * SPECULAR_ACROSS;
    fillSoftEllipse(
      ctx,
      centre.x + along.x * streakAlong + across.x * streakAcross,
      centre.y + along.y * streakAlong + across.y * streakAcross,
      length * SPECULAR_LENGTH + halfWidth * SPECULAR_WIDTH,
      halfWidth * SPECULAR_WIDTH,
      ramp.specular,
      specular * contrast,
      angle,
      SPECULAR_CORE,
    );
  }
}

/**
 * Adds stops in the order given, each held at or after the one before it and
 * inside 0–1. A wide half-tone can push a stop past its neighbour or off the
 * end of the gradient, and canvas throws on an offset outside 0–1.
 */
function addOrderedStops(
  gradient: CanvasGradient,
  stops: ReadonlyArray<readonly [number, string]>,
): void {
  let previous = 0;
  for (const [offset, colour] of stops) {
    const clamped = Math.min(1, Math.max(previous, offset));
    gradient.addColorStop(clamped, colour);
    previous = clamped;
  }
}

/** Keeps every gradient stop in order and inside 0–1 whatever a caller asks for. */
function clampTerminator(terminator: number, half: number): number {
  const earliest = Math.min(LIGHT_BAND_STOP + half * 2, TERMINATOR_MIDDLE);
  const latest = Math.max(CORE_SHADOW_STOP - half, TERMINATOR_MIDDLE);
  return Math.min(latest, Math.max(earliest, terminator));
}

const TERMINATOR_MIDDLE = 0.5;

/** Past this much sideways light a form counts as fully side-lit. */
const LIGHT_SIDE_ON = 0.62;
/** The gradient rectangle runs past the form so the clip, not the rectangle, ends it. */
const CLIP_OVERSHOOT = 1.6;

// ── Overlap and creases ──────────────────────────────────────────────────────

/**
 * The halo steps every crease and cast shadow on Carl is stroked with. Three,
 * not the nine Signet uses: at the 32 px tile a crease is two or three pixels
 * across, the extra steps land in the same pixels, and each one is a full
 * stroke of the path.
 */
export const FIGURE_CREASE_LAYERS: ReadonlyArray<CreaseLayer> = [
  { widthScale: 2.4, alpha: 0.18 },
  { widthScale: 1, alpha: 0.5 },
];

/**
 * The lit lip beside a crease or a cast shadow is a single stroke: it is
 * under a pixel wide at the 32 px tile, so a halo round it has nothing to
 * soften.
 */
const LIP_LAYERS: ReadonlyArray<CreaseLayer> = [{ widthScale: 1.5, alpha: 0.4 }];

/** How far a cast shadow falls from its edge, in shadow widths, away from the key. */
const CAST_DROP = 0.7;
/** The lit sliver sits beyond the shadow, where the surface turns back up to the light. */
const SLIVER_DROP = 2.2;
const SLIVER_WIDTH = 0.5;
const CAST_OPACITY = 1;
const SLIVER_OPACITY = 0.55;

/**
 * The shadow one form throws on the form beneath it, and the lit sliver just
 * past it.
 *
 * `receiver` traces the surface being shaded (the shadow is clipped to it);
 * `edge` traces the occluding form's edge as an open path, in the same space.
 * The shadow falls away from the key light by a fraction of `width`, so it
 * shows below and to the right of an upper-left-lit occluder.
 *
 * The sliver is the half people leave out, and it is the half that does the
 * work: a dark band on its own only says "dark here", while a dark band with a
 * lit lip beyond it says one form is sitting on another.
 */
export function castShadow(
  ctx: Ctx,
  receiver: () => void,
  edge: () => void,
  ramp: Ramp,
  width: number,
  frameRotation = 0,
): void {
  const light = lightIn(frameRotation);
  withClip(ctx, receiver, () => {
    ctx.save();
    ctx.translate(-light.x * width * SLIVER_DROP, -light.y * width * SLIVER_DROP);
    strokeSoftCrease(ctx, width * SLIVER_WIDTH, ramp.rim, edge, SLIVER_OPACITY, LIP_LAYERS);
    ctx.restore();
    ctx.save();
    ctx.translate(-light.x * width * CAST_DROP, -light.y * width * CAST_DROP);
    strokeSoftCrease(ctx, width, ramp.deep, edge, CAST_OPACITY, FIGURE_CREASE_LAYERS);
    ctx.restore();
  });
}

/** The bounce highlight rides the crease's lower lip, which faces up into the key. */
const BOUNCE_DROP = 1.3;
const BOUNCE_WIDTH = 0.45;
const BOUNCE_OPACITY = 0.6;

/**
 * A fold: a soft dark core with a thin bounce highlight on the lip below it.
 * Leather creases want a narrow `width` (stiff, sharp-cored folds) and cotton a
 * wide one at lower `opacity` (soft bunching). Clip it to the form it creases.
 */
export function crease(
  ctx: Ctx,
  trace: () => void,
  width: number,
  ramp: Ramp,
  opacity = 1,
  frameRotation = 0,
): void {
  const light = lightIn(frameRotation);
  ctx.save();
  strokeSoftCrease(ctx, width, ramp.deep, trace, opacity, FIGURE_CREASE_LAYERS);
  ctx.translate(-light.x * width * BOUNCE_DROP, -light.y * width * BOUNCE_DROP);
  strokeSoftCrease(
    ctx,
    width * BOUNCE_WIDTH,
    ramp.rim,
    trace,
    opacity * BOUNCE_OPACITY,
    LIP_LAYERS,
  );
  ctx.restore();
}

// ── Floor ────────────────────────────────────────────────────────────────────

/** Soft elliptical shadow under the figure. */
export function drawGroundShadow(
  ctx: Ctx,
  centreX: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
  centreY = 0,
): void {
  // A gradient resolves in the user space it is painted in, not the one it was
  // built in, so the transform has to be in place before the gradient is made.
  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(radiusX, radiusY);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(OUTLINE, alpha));
  gradient.addColorStop(1, rgba(OUTLINE, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Deterministic 0–1 jitter so the heart print does not crawl between frames. */
export function printHash(row: number, col: number): number {
  const seeded = Math.sin(row * HASH_ROW_FREQ + col * HASH_COL_FREQ) * HASH_SCATTER;
  return seeded - Math.floor(seeded);
}

/**
 * The classic sine hash: two incommensurate frequencies so neighbouring cells
 * do not share a phase, and a large scatter so the fractional part is noise.
 */
const HASH_ROW_FREQ = 127.1;
const HASH_COL_FREQ = 311.7;
const HASH_SCATTER = 43758.5453;
