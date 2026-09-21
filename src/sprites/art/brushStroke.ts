/**
 * A hand-painted brush stroke, built from bristles rather than a filled shape.
 *
 * A flat fill reads as printed. Paint reads as paint when the stroke has a body
 * whose opacity wanders, a wet ridge along both edges, bristle streaks running
 * the way the brush travelled, dry gaps where the brush ran out, a blob of
 * pigment where it touched down and lifted off, and a faint stain where the
 * pigment wicked into the grain. This module paints all of that from one
 * polyline so every sign glyph and arrow shares a single hand.
 */

import { range, rangeInt, type Rng } from '../person/rng';

type Ctx = CanvasRenderingContext2D;

export type Vec = readonly [number, number];

export interface BrushPigment {
  readonly body: string;
  /** Lighter, thicker pigment where the brush was fully loaded. */
  readonly buildUp: string;
  /** Darker ridge that pools along a wet edge. */
  readonly wetEdge: string;
  /** Bare surface showing through where the brush ran dry. */
  readonly bareSurface: string;
  /** Stain that soaks past the stroke into the surrounding grain. */
  readonly soak: string;
}

export interface BrushStroke {
  readonly points: ReadonlyArray<Vec>;
  /** Full width of the stroke, in pixels. */
  readonly width: number;
  /** Whether a drip runs off the low end of the stroke. */
  readonly drips?: boolean;
}

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly normalX: number;
  readonly normalY: number;
  /** Fraction of the way along the stroke, 0 at touch-down and 1 at lift-off. */
  readonly along: number;
}

const SMOOTHING_PASSES = 2;
const CHAIKIN_NEAR = 0.25;
const CHAIKIN_FAR = 0.75;
const SAMPLE_SPACING_PER_WIDTH = 0.3;
const MIN_SAMPLE_SPACING_PX = 0.75;
const WOBBLE_AMPLITUDE_PER_WIDTH = 0.07;
const WOBBLE_WAVELENGTH_PER_WIDTH = 5;

const SOAK_WIDTH_RATIO = 1.5;
const SOAK_ALPHA = 0.13;
const BODY_WIDTH_RATIO = 0.92;
const BODY_ALPHA = 0.8;
const BUILD_UP_RUN_SAMPLES: readonly [number, number] = [4, 11];
const BUILD_UP_WIDTH_RATIO: readonly [number, number] = [0.5, 0.85];
const BUILD_UP_ALPHA: readonly [number, number] = [0.3, 0.6];

const WET_EDGE_OFFSET_RATIO = 0.43;
const WET_EDGE_WIDTH_RATIO = 0.16;
const WET_EDGE_ALPHA = 0.5;

const BRISTLE_COUNT = 7;
const BRISTLE_SPREAD_RATIO = 0.86;
const BRISTLE_WIDTH_RATIO = 0.13;
const MIN_BRISTLE_WIDTH_PX = 0.6;
const BRISTLE_GAP_ALPHA = 0.6;
const BRISTLE_STREAK_ALPHA = 0.32;
const BRISTLE_STREAK_CHANCE = 0.1;
const STREAK_RUN_SAMPLES: readonly [number, number] = [4, 12];
const GAP_BASE_CHANCE = 0.01;
const GAP_RUNOUT_CHANCE = 0.07;
const GAP_RUN_SAMPLES: readonly [number, number] = [2, 7];

const GRAIN_PER_STROKE_LENGTH = 0.22;
const GRAIN_LENGTH_RATIO: readonly [number, number] = [0.9, 1.5];
const GRAIN_ALPHA = 0.32;
const MIN_GRAIN_HEIGHT_PX = 0.7;

const TOUCHDOWN_BLOB_RATIO = 0.5;
const LIFT_OFF_BLOB_RATIO = 0.47;
const BLOB_ALPHA = 0.55;
const BLOB_RIM_WIDTH_PX = 0.8;

const DRIP_LENGTH_RATIO: readonly [number, number] = [0.45, 0.8];
const DRIP_WIDTH_RATIO = 0.28;
const DRIP_BULB_RATIO = 0.19;
const DRIP_ALPHA = 0.85;

const TWO_PI = Math.PI * 2;
const EPSILON = 1e-6;
const MIN_SAMPLES = 2;
const BUILD_UP_OFFSET_RATIO = 0.1;
const GRAIN_HEIGHT_RATIO = BRISTLE_WIDTH_RATIO / 2;
const WET_EDGE_SIDES: ReadonlyArray<number> = [-1, 1];
const CENTRE_RATIO = 0.5;

function smooth(points: ReadonlyArray<Vec>): Vec[] {
  let current: Vec[] = [...points];
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    const next: Vec[] = [];
    const first = current[0];
    const last = current[current.length - 1];
    next.push(first);
    for (let index = 0; index < current.length - 1; index++) {
      const a = current[index];
      const b = current[index + 1];
      next.push([a[0] + (b[0] - a[0]) * CHAIKIN_NEAR, a[1] + (b[1] - a[1]) * CHAIKIN_NEAR]);
      next.push([a[0] + (b[0] - a[0]) * CHAIKIN_FAR, a[1] + (b[1] - a[1]) * CHAIKIN_FAR]);
    }
    next.push(last);
    current = next;
  }
  return current;
}

function sampleStroke(stroke: BrushStroke, rng: Rng): Sample[] {
  const path = smooth(stroke.points);
  const spacing = Math.max(MIN_SAMPLE_SPACING_PX, stroke.width * SAMPLE_SPACING_PER_WIDTH);
  const lengths: number[] = [0];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1];
    const b = path[index];
    lengths.push(lengths[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1];
  const count = Math.max(MIN_SAMPLES, Math.ceil(total / spacing) + 1);
  const wobblePhase = range(rng, 0, TWO_PI);
  const wobbleAmplitude = stroke.width * WOBBLE_AMPLITUDE_PER_WIDTH;
  const wobbleWavelength = stroke.width * WOBBLE_WAVELENGTH_PER_WIDTH;

  const samples: Sample[] = [];
  let segment = 0;
  for (let step = 0; step < count; step++) {
    const distance = (step / (count - 1)) * total;
    while (segment < path.length - 2 && lengths[segment + 1] < distance) segment++;
    const a = path[segment];
    const b = path[segment + 1];
    const segmentStart = lengths[segment];
    const segmentLength = Math.max(EPSILON, lengths[segment + 1] - segmentStart);
    const t = (distance - segmentStart) / segmentLength;
    const tangentX = (b[0] - a[0]) / segmentLength;
    const tangentY = (b[1] - a[1]) / segmentLength;
    const normalX = -tangentY;
    const normalY = tangentX;
    const drift = Math.sin(distance / wobbleWavelength + wobblePhase) * wobbleAmplitude;
    samples.push({
      x: a[0] + (b[0] - a[0]) * t + normalX * drift,
      y: a[1] + (b[1] - a[1]) * t + normalY * drift,
      normalX,
      normalY,
      along: distance / Math.max(total, EPSILON),
    });
  }
  return samples;
}

function tracePath(
  ctx: Ctx,
  samples: ReadonlyArray<Sample>,
  from: number,
  to: number,
  offset: number,
): void {
  ctx.beginPath();
  for (let index = from; index <= to; index++) {
    const sample = samples[index];
    const x = sample.x + sample.normalX * offset;
    const y = sample.y + sample.normalY * offset;
    if (index === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function paintRun(
  ctx: Ctx,
  samples: ReadonlyArray<Sample>,
  from: number,
  to: number,
  offset: number,
  colour: string,
  lineWidth: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  tracePath(ctx, samples, from, to, offset);
  ctx.stroke();
}

function paintBlob(
  ctx: Ctx,
  sample: Sample | undefined,
  radius: number,
  pigment: BrushPigment,
): void {
  if (sample === undefined) return;
  ctx.globalAlpha = BLOB_ALPHA;
  ctx.fillStyle = pigment.body;
  ctx.beginPath();
  ctx.arc(sample.x, sample.y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = WET_EDGE_ALPHA;
  ctx.strokeStyle = pigment.wetEdge;
  ctx.lineWidth = BLOB_RIM_WIDTH_PX;
  ctx.stroke();
}

function paintDrip(
  ctx: Ctx,
  sample: Sample | undefined,
  width: number,
  pigment: BrushPigment,
  rng: Rng,
): void {
  if (sample === undefined) return;
  const length = width * range(rng, ...DRIP_LENGTH_RATIO);
  const dripWidth = width * DRIP_WIDTH_RATIO;
  const bulb = width * DRIP_BULB_RATIO;
  ctx.globalAlpha = DRIP_ALPHA;
  ctx.fillStyle = pigment.body;
  ctx.fillRect(sample.x - dripWidth * CENTRE_RATIO, sample.y, dripWidth, length);
  ctx.beginPath();
  ctx.arc(sample.x, sample.y + length, bulb, 0, TWO_PI);
  ctx.fill();
}

function paintBristles(
  ctx: Ctx,
  samples: ReadonlyArray<Sample>,
  width: number,
  pigment: BrushPigment,
  rng: Rng,
): void {
  const last = samples.length - 1;
  const lineWidth = Math.max(MIN_BRISTLE_WIDTH_PX, width * BRISTLE_WIDTH_RATIO);
  for (let bristle = 0; bristle < BRISTLE_COUNT; bristle++) {
    const offset = (bristle / (BRISTLE_COUNT - 1) - CENTRE_RATIO) * width * BRISTLE_SPREAD_RATIO;
    let index = 0;
    while (index < last) {
      const along = samples[index].along;
      const dryChance = GAP_BASE_CHANCE + along * along * GAP_RUNOUT_CHANCE;
      const isGap = rng() < dryChance;
      const isStreak = !isGap && rng() < BRISTLE_STREAK_CHANCE;
      if (!isGap && !isStreak) {
        index++;
        continue;
      }
      const [minRun, maxRun] = isGap ? GAP_RUN_SAMPLES : STREAK_RUN_SAMPLES;
      const end = Math.min(last, index + rangeInt(rng, minRun, maxRun));
      if (isGap) {
        paintRun(
          ctx,
          samples,
          index,
          end,
          offset,
          pigment.bareSurface,
          lineWidth,
          BRISTLE_GAP_ALPHA,
        );
      } else {
        paintRun(
          ctx,
          samples,
          index,
          end,
          offset,
          pigment.buildUp,
          lineWidth,
          BRISTLE_STREAK_ALPHA,
        );
      }
      index = end + 1;
    }
  }
}

function paintGrain(
  ctx: Ctx,
  samples: ReadonlyArray<Sample>,
  width: number,
  pigment: BrushPigment,
  rng: Rng,
): void {
  const first = samples[0];
  const final = samples[samples.length - 1];
  const strokeLength = Math.hypot(final.x - first.x, final.y - first.y) + width;
  const count = Math.ceil((strokeLength / width) * GRAIN_PER_STROKE_LENGTH * BRISTLE_COUNT);
  ctx.globalAlpha = GRAIN_ALPHA;
  ctx.fillStyle = pigment.bareSurface;
  for (let flake = 0; flake < count; flake++) {
    const sample = samples[rangeInt(rng, 0, samples.length - 1)];
    const length = width * range(rng, ...GRAIN_LENGTH_RATIO);
    const jitter = range(rng, -width * CENTRE_RATIO, width * CENTRE_RATIO);
    ctx.fillRect(
      sample.x - length * CENTRE_RATIO,
      sample.y + jitter,
      length,
      Math.max(MIN_GRAIN_HEIGHT_PX, width * GRAIN_HEIGHT_RATIO),
    );
  }
}

/** Paints one stroke onto `ctx`. Deterministic for a given `rng` state. */
export function paintBrushStroke(
  ctx: Ctx,
  stroke: BrushStroke,
  pigment: BrushPigment,
  rng: Rng,
): void {
  const samples = sampleStroke(stroke, rng);
  const last = samples.length - 1;
  if (last < 1) return;
  const { width } = stroke;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  paintRun(ctx, samples, 0, last, 0, pigment.soak, width * SOAK_WIDTH_RATIO, SOAK_ALPHA);
  paintRun(ctx, samples, 0, last, 0, pigment.body, width * BODY_WIDTH_RATIO, BODY_ALPHA);

  ctx.lineCap = 'butt';
  let cursor = 0;
  while (cursor < last) {
    const end = Math.min(last, cursor + rangeInt(rng, ...BUILD_UP_RUN_SAMPLES));
    paintRun(
      ctx,
      samples,
      cursor,
      end,
      range(rng, -width * BUILD_UP_OFFSET_RATIO, width * BUILD_UP_OFFSET_RATIO),
      pigment.buildUp,
      width * range(rng, ...BUILD_UP_WIDTH_RATIO),
      range(rng, ...BUILD_UP_ALPHA),
    );
    cursor = end;
  }

  ctx.lineCap = 'round';
  const edgeWidth = Math.max(MIN_BRISTLE_WIDTH_PX, width * WET_EDGE_WIDTH_RATIO);
  for (const side of WET_EDGE_SIDES) {
    paintRun(
      ctx,
      samples,
      0,
      last,
      side * width * WET_EDGE_OFFSET_RATIO,
      pigment.wetEdge,
      edgeWidth,
      WET_EDGE_ALPHA,
    );
  }

  paintBristles(ctx, samples, width, pigment, rng);
  paintGrain(ctx, samples, width, pigment, rng);
  paintBlob(ctx, samples[0], width * TOUCHDOWN_BLOB_RATIO, pigment);
  paintBlob(ctx, samples[last], width * LIFT_OFF_BLOB_RATIO, pigment);

  if (stroke.drips === true) {
    const lowest = samples.reduce((low, sample) => (sample.y > low.y ? sample : low), samples[0]);
    paintDrip(ctx, lowest, width, pigment, rng);
  }
  ctx.restore();
}
