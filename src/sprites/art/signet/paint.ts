/**
 * Path and shading primitives Signet's painters share.
 *
 * Her limbs are built as outlines offset from a joint chain — outer and inner
 * edges given as widths at shares along each bone — and traced as one smooth
 * closed curve. Muscle shape is then a matter of where a width swells, which
 * is how a figure stops reading as tubes: a calf that peaks high on the outside
 * and low on the inside, a thigh that sweeps out under the hip, a wrist that
 * narrows past the forearm's swell.
 *
 * Her shading is stepped rather than airbrushed. A form shadow is the shape
 * minus a copy of itself slid toward the light, so its inner edge is a
 * terminator that follows the form exactly and stays crisp at sixty pixels
 * tall; a soft wash there averages into grey at in-game size.
 */

import { mix } from '../bipedArt';
import type { Pt2 } from './skeleton';
import { resizeSurface, allocCanvas, releaseSurface } from '../../../core/rendering/canvasSurface';

export type Ctx = CanvasRenderingContext2D;

/** Catmull-Rom tension for every smooth outline: one third gives round joints without overshoot. */
const SMOOTHING = 1 / 6;

/**
 * Widest a single value step may be before it reads as a stripe. The authored
 * steps are sized for the figure at game scale; drawn larger, each gap between
 * them is filled with in-between steps so the turn stays a smooth ramp.
 */
const MAX_BAND_STEP_PIXELS = 1.5;
const MAX_STEPS_PER_GAP = 12;

/** Guards a normal taken along a segment that has collapsed to a point. */
const MIN_SEGMENT_LENGTH = 1e-6;

/** An alpha of one cannot be split into compounding steps. */
const MAX_COMPOUND_ALPHA = 0.98;

/** A smooth curve through `points`, as cubic Béziers on the current path. */
export function traceSmooth(ctx: Ctx, points: ReadonlyArray<Pt2>, closed: boolean): void {
  const n = points.length;
  if (n < 2) return;
  const at = (i: number): Pt2 => {
    if (closed) return points[((i % n) + n) % n];
    return points[Math.max(0, Math.min(n - 1, i))];
  };
  ctx.moveTo(points[0].x, points[0].y);
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * SMOOTHING,
      p1.y + (p2.y - p0.y) * SMOOTHING,
      p2.x - (p3.x - p1.x) * SMOOTHING,
      p2.y - (p3.y - p1.y) * SMOOTHING,
      p2.x,
      p2.y,
    );
  }
  if (closed) ctx.closePath();
}

/** One edge sample of a limb: a share along a bone and the half-width there. */
export type WidthKey = readonly [share: number, halfWidth: number];

export interface Bone {
  from: Pt2;
  to: Pt2;
  /** Widths on the side `sideNormal` points to, and on the other. */
  outer: ReadonlyArray<WidthKey>;
  inner: ReadonlyArray<WidthKey>;
}

function normalOf(from: Pt2, to: Pt2, sideNormal: number): Pt2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), MIN_SEGMENT_LENGTH);
  // Rotated a quarter turn: +1 points to the bone's right as it runs from→to.
  return { x: (-dy / length) * sideNormal, y: (dx / length) * sideNormal };
}

/**
 * The outline of a chain of bones: down the outer edge and back up the inner,
 * as points for {@link traceSmooth}. `sideNormal` picks which way "outer" is.
 */
export function limbOutline(bones: ReadonlyArray<Bone>, sideNormal: number): Pt2[] {
  const { outer, inner } = limbEdges(bones, sideNormal);
  return [...outer, ...inner.reverse()];
}

/** The two edges of a chain of bones, each running from the chain's root to its end. */
export function limbEdges(
  bones: ReadonlyArray<Bone>,
  sideNormal: number,
): { outer: Pt2[]; inner: Pt2[] } {
  const outer: Pt2[] = [];
  const inner: Pt2[] = [];
  for (const bone of bones) {
    const n = normalOf(bone.from, bone.to, sideNormal);
    const along = (share: number): Pt2 => ({
      x: bone.from.x + (bone.to.x - bone.from.x) * share,
      y: bone.from.y + (bone.to.y - bone.from.y) * share,
    });
    for (const [share, width] of bone.outer) {
      const p = along(share);
      outer.push({ x: p.x + n.x * width, y: p.y + n.y * width });
    }
    for (const [share, width] of bone.inner) {
      const p = along(share);
      inner.push({ x: p.x - n.x * width, y: p.y - n.y * width });
    }
  }
  return { outer, inner };
}

/**
 * Fill the part of the current clip covered by `trace` but not by the same
 * shape slid by (dx, dy): a band along the side facing away from the slide,
 * whose inner edge is the shape's own contour moved — a terminator that
 * follows the form.
 *
 * Drawn large, one band that wide is a flat stripe with a hard inner edge, so
 * it is laid as several nested bands whose alphas compound to `alpha` at the
 * edge: the tone eases off toward the terminator. At game size a band is a
 * pixel or two and stays a single crisp step.
 */
export function fillCrescent(
  ctx: Ctx,
  trace: () => void,
  dx: number,
  dy: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const m = ctx.getTransform();
  const slidePixels = Math.hypot(m.a * dx + m.c * dy, m.b * dx + m.d * dy);
  const count = Math.min(
    MAX_STEPS_PER_GAP,
    Math.max(1, Math.ceil(slidePixels / MAX_BAND_STEP_PIXELS)),
  );
  const stepAlpha = 1 - Math.pow(1 - Math.min(alpha, MAX_COMPOUND_ALPHA), 1 / count);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha *= stepAlpha;
  for (let k = 1; k <= count; k++) {
    const share = k / count;
    ctx.save();
    ctx.beginPath();
    trace();
    ctx.translate(dx * share, dy * share);
    trace();
    ctx.fill('evenodd');
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A band of even width just inside a silhouette: the silhouette stroked at
 * twice the width while clipped to itself. The edge of a round form turning
 * away from the eye; it can never wander off the edge it belongs to.
 */
export function strokeRim(
  ctx: Ctx,
  trace: () => void,
  width: number,
  color: string | CanvasGradient,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.beginPath();
  trace();
  ctx.clip();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  trace();
  ctx.stroke();
  ctx.restore();
}

export function midpoint(a: Pt2, b: Pt2, share = 0.5): Pt2 {
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
}

export function angleOf(from: Pt2, to: Pt2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * The bands of {@link shadeSilhouette}, narrowest and darkest first: each is
 * the union slid toward the light by its own distance and cut away, leaving
 * the far edge. Several close steps of value read as the form rolling away;
 * two far-apart ones read as a doubled outline.
 */
export interface SilhouetteShade {
  steps: ReadonlyArray<{ slide: Pt2; color: string }>;
  alpha: number;
}

/** Figure-unit box the whole figure stays inside, for sizing the scratch surface. */
export interface FigureBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function bandSteps(
  steps: SilhouetteShade['steps'],
  pixelsPerUnit: number,
): SilhouetteShade['steps'] {
  const filled: Array<{ slide: Pt2; color: string }> = [];
  steps.forEach((step, i) => {
    if (i === 0) {
      filled.push(step);
      return;
    }
    const previous = steps[i - 1];
    const gapPixels =
      Math.hypot(step.slide.x - previous.slide.x, step.slide.y - previous.slide.y) * pixelsPerUnit;
    const count = Math.min(
      MAX_STEPS_PER_GAP,
      Math.max(1, Math.ceil(gapPixels / MAX_BAND_STEP_PIXELS)),
    );
    for (let k = 1; k <= count; k++) {
      const t = k / count;
      filled.push({
        slide: {
          x: previous.slide.x + (step.slide.x - previous.slide.x) * t,
          y: previous.slide.y + (step.slide.y - previous.slide.y) * t,
        },
        color: mix(previous.color, step.color, t),
      });
    }
  });
  return filled;
}

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** The union's mask, one band being coloured, and the bands gathered so far. */
const scratches: Scratch[] = [];
const SCRATCH_COUNT = 3;

function scratchSurfaces(width: number, height: number): readonly Scratch[] | null {
  if (scratches.length === 0) {
    if (typeof document === 'undefined') return null;
    const made: Scratch[] = [];
    for (let i = 0; i < SCRATCH_COUNT; i++) {
      const canvas = allocCanvas('signet', width, height);
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        releaseSurface(canvas);
        for (const partial of made) releaseSurface(partial.canvas);
        return null;
      }
      made.push({ canvas, ctx });
    }
    scratches.push(...made);
  }
  for (const { canvas } of scratches) {
    const grownWidth = Math.max(canvas.width, width);
    const grownHeight = Math.max(canvas.height, height);
    if (grownWidth !== canvas.width || grownHeight !== canvas.height) {
      resizeSurface(canvas, grownWidth, grownHeight);
    }
  }
  return scratches;
}

/**
 * Edge-shade several overlapping shapes as one silhouette.
 *
 * A body painted in parts — a torso over two legs — shaded part by part gets a
 * band down the edge of each, and where the parts meet the bands start and
 * stop: a seam across the top of the thigh that no anatomy explains. Here the
 * parts are filled together on a scratch surface and every band is cut from
 * that one union, then laid over the figure in a single blit.
 * The surfaces are reused frame to frame and fully cleared before each use, so
 * nothing carries from one drawing to the next.
 */
export function shadeSilhouette(
  ctx: Ctx,
  box: FigureBox,
  traces: ReadonlyArray<(target: Ctx) => void>,
  shade: SilhouetteShade,
): void {
  const m = ctx.getTransform();
  const corners = [
    [box.left, box.top],
    [box.right, box.top],
    [box.left, box.bottom],
    [box.right, box.bottom],
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const left = Math.floor(Math.min(...corners.map((c) => c.x)));
  const top = Math.floor(Math.min(...corners.map((c) => c.y)));
  const width = Math.ceil(Math.max(...corners.map((c) => c.x))) - left;
  const height = Math.ceil(Math.max(...corners.map((c) => c.y))) - top;
  if (width <= 0 || height <= 0) return;
  const surfaces = scratchSurfaces(width, height);
  if (surfaces === null) return;
  const [mask, band, bands] = surfaces;
  for (const { ctx: surface } of surfaces) {
    surface.setTransform(1, 0, 0, 1, 0, 0);
    surface.globalCompositeOperation = 'source-over';
    surface.clearRect(0, 0, width, height);
  }
  // The union is filled once and every band is cut from copies of it: blits
  // are far cheaper than filling every curve of every part again per band.
  // Each part is filled on its own: their outlines wind either way, and one
  // nonzero fill of all of them would punch holes where they overlap.
  mask.ctx.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
  for (const trace of traces) {
    mask.ctx.beginPath();
    trace(mask.ctx);
    mask.ctx.fill();
  }
  mask.ctx.setTransform(1, 0, 0, 1, 0, 0);
  const blitMask = (target: CanvasRenderingContext2D, dx: number, dy: number): void => {
    target.drawImage(mask.canvas, 0, 0, width, height, dx, dy, width, height);
  };
  // Each wider band is laid in behind the narrower ones already there, then
  // cut back to its own width; the narrower bands lie inside that cut, so
  // they survive it.
  const pixelsPerUnit = Math.hypot(m.a, m.b);
  bandSteps(shade.steps, pixelsPerUnit).forEach((step, i) => {
    band.ctx.globalCompositeOperation = 'copy';
    blitMask(band.ctx, 0, 0);
    band.ctx.globalCompositeOperation = 'source-in';
    band.ctx.fillStyle = step.color;
    band.ctx.fillRect(0, 0, width, height);
    bands.ctx.globalCompositeOperation = i === 0 ? 'source-over' : 'destination-over';
    bands.ctx.drawImage(band.canvas, 0, 0, width, height, 0, 0, width, height);
    bands.ctx.globalCompositeOperation = 'destination-out';
    blitMask(
      bands.ctx,
      m.a * step.slide.x + m.c * step.slide.y,
      m.b * step.slide.x + m.d * step.slide.y,
    );
  });
  bands.ctx.globalCompositeOperation = 'source-over';
  band.ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= shade.alpha;
  ctx.drawImage(bands.canvas, 0, 0, width, height, left, top, width, height);
  ctx.restore();
}
