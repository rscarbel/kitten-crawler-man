/**
 * Lime plaster, and the painted coats laid over it.
 *
 * Plaster has no elements — no courses, no blocks, nothing whose edges give the
 * eye something to hold — so everything that stops it reading as a flat fill has
 * to come out of the noise field. Three layers do that work and they operate at
 * genuinely different sizes: a broad tonal blocking that says one end of the
 * wall has been rained on harder than the other, a fine grain that says the
 * surface is granular, and patches where the wash has worn thin to a different
 * tone. The patches are sampled through a domain warp, because a low-frequency
 * threshold sampled straight gives smooth ellipses and a wall covered in smooth
 * ellipses is the most recognisable procedural artefact there is.
 *
 * Paint changes all of that in one direction: a painted coat *evens a wall out*.
 * So `painted` mixes the surface toward the trim ramp while scaling the mottling
 * down, and pays back a little variation as faint brush-direction streaking —
 * which is the only variation a freshly painted wall actually has.
 */

import type { NoiseField } from '../../tilegen/noise.js';
import { ALPHA, BLUE, GREEN, RED, pixelIndex, readPixels, writePixels } from '../pixels.js';
import type { Plane, Point } from '../projection.js';
import { LIGHT_DIR_X, LIGHT_DIR_Y, mix, rgba, sampleRamp, type Ramp } from '../ramps.js';
import { elementValue, type Band } from './kit.js';

export interface PlasterOptions {
  readonly plane: Plane;
  readonly noise: NoiseField;
  readonly seed: number;
  readonly band: Band;
  readonly ramp: Ramp;
  readonly trimRamp: Ramp;
  /** 0 = raw lime plaster, 1 = a saturated painted coat over it. */
  readonly painted: number;
  /** Pixels per tile, for measures that are architectural rather than textural. */
  readonly scale: number;
}

/** Ramp position most of the surface sits at, before any of the layers move it. */
const BASE_TONE = 0.58;

/** The midpoint every noise sample is centred on before being scaled. */
const NOISE_MIDPOINT = 0.5;

/**
 * The two octave scales. `BROAD` blocks the wall into large soft regions;
 * `GRAIN` is the per-pixel tooth of the lime itself. Running only one of them
 * gives either a smooth gradient or television static — the surface reads as
 * plaster only when both are present at very different periods.
 */
const BROAD_PERIOD_CELLS = 3;
const BROAD_OCTAVES = 2;
const BROAD_TONE_SWING = 0.2;
const GRAIN_PERIOD_CELLS = 48;
const GRAIN_OCTAVES = 3;
const GRAIN_TONE_SWING = 0.075;

/** How much of the mottling a full painted coat suppresses. */
const MOTTLE_DAMPING_AT_FULL_PAINT = 0.62;

/** Thinned-wash patches: a warped threshold, so their edges are not ellipses. */
const PATCH_PERIOD_CELLS = 5;
const PATCH_OCTAVES = 2;
const PATCH_WARP_PX = 11;
const PATCH_WARP_PERIOD_CELLS = 4;
const PATCH_THRESHOLD = 0.54;
const PATCH_TONE_LIFT = 0.15;

/**
 * Brush streaking. The x coordinate is squashed before sampling, which stretches
 * every feature along the stroke direction without needing a second noise field.
 */
const BRUSH_ALONG_SQUASH = 0.11;
const BRUSH_PERIOD_CELLS = 26;
const BRUSH_STREAK_SWING = 0.05;

/** Hairline cracks, counted per tile of surface area. */
const CRACKS_PER_TILE_AREA = 0.34;
const CRACK_SEGMENTS = 4;
const CRACK_LENGTH_TILES = 0.55;
const CRACK_LENGTH_MIN_FACTOR = 0.6;
const CRACK_LENGTH_SPREAD = 0.8;
const CRACK_ANGLE_SPREAD = 0.7;
const CRACK_SEGMENT_WAVER = 0.45;
const CRACK_TONE = 0.14;
const CRACK_ALPHA = 0.42;
const CRACK_LIP_TONE = 0.86;
const CRACK_LIP_ALPHA = 0.3;
const CRACK_LIP_PX = 1;
const HAIRLINE_WIDTH_PX = 1;

/** Spalled patches where the coat has come away, counted per tile of area. */
const SPALLS_PER_TILE_AREA = 0.075;
const SPALL_VERTICES = 7;
const SPALL_RADIUS_TILES = 0.09;
const SPALL_RADIUS_MIN_FACTOR = 0.55;
const SPALL_RADIUS_SPREAD = 0.9;
const SPALL_SUBSTRATE_TONE = 0.05;
const SPALL_SUBSTRATE_ALPHA = 0.9;
const SPALL_LIP_TONE = 0.92;
const SPALL_LIP_ALPHA = 0.45;
const SPALL_LIP_OFFSET_PX = 1.2;

/** Opaque alpha, for the pixels the surface pass claims. */
const PIXEL_OPAQUE = 255;

/** Noise seed offsets, so no two layers sample the same field. */
const BROAD_NOISE_SEED = 0;
const GRAIN_NOISE_SEED = 313;
const PATCH_NOISE_SEED = 691;
const PATCH_WARP_SEED = 1187;
const BRUSH_NOISE_SEED = 1699;

/** Element streams, so two properties of one crack never share a number. */
const STREAM_CRACK_X = 11;
const STREAM_CRACK_Y = 12;
const STREAM_CRACK_LENGTH = 13;
const STREAM_CRACK_ANGLE = 14;
const STREAM_CRACK_WAVER = 15;
const STREAM_SPALL_X = 16;
const STREAM_SPALL_Y = 17;
const STREAM_SPALL_RADIUS = 18;
const STREAM_SPALL_VERTEX = 19;

export function paintPlaster(options: PlasterOptions): void {
  const { plane, band } = options;
  const firstRow = Math.max(0, Math.floor(band.top));
  const lastRow = Math.min(plane.height, Math.ceil(band.bottom));
  if (lastRow <= firstRow) return;

  paintSurface(options, firstRow, lastRow);

  const ctx = plane.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band.top, plane.width, band.bottom - band.top);
  ctx.clip();
  paintCracks(options);
  paintSpalls(options);
  ctx.restore();
}

/**
 * The three noise layers, written straight into the pixel buffer.
 *
 * A buffer write ignores the canvas clip, so the row range is what confines this
 * pass to the band — and the rows outside it are read and written back
 * unchanged, which leaves an upper story's plaster alone when the ground story
 * paints.
 */
function paintSurface(options: PlasterOptions, firstRow: number, lastRow: number): void {
  const { plane, noise, seed, ramp, trimRamp, painted } = options;
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  const mottleScale = 1 - painted * MOTTLE_DAMPING_AT_FULL_PAINT;

  for (let y = firstRow; y < lastRow; y++) {
    for (let x = 0; x < plane.width; x++) {
      const broad = noise.fbm(x, y, seed + BROAD_NOISE_SEED, BROAD_OCTAVES, BROAD_PERIOD_CELLS);
      const grain = noise.fbm(x, y, seed + GRAIN_NOISE_SEED, GRAIN_OCTAVES, GRAIN_PERIOD_CELLS);
      const broadTone = (broad - NOISE_MIDPOINT) * 2 * BROAD_TONE_SWING * mottleScale;
      const grainTone = (grain - NOISE_MIDPOINT) * 2 * GRAIN_TONE_SWING * mottleScale;

      const warped = noise.warp(
        x,
        y,
        seed + PATCH_WARP_SEED,
        PATCH_WARP_PX,
        PATCH_WARP_PERIOD_CELLS,
      );
      const patch = noise.fbm(
        warped.x,
        warped.y,
        seed + PATCH_NOISE_SEED,
        PATCH_OCTAVES,
        PATCH_PERIOD_CELLS,
      );
      const thinned =
        patch <= PATCH_THRESHOLD ? 0 : (patch - PATCH_THRESHOLD) / (1 - PATCH_THRESHOLD);

      const brush = noise.value(
        x * BRUSH_ALONG_SQUASH,
        y,
        BRUSH_PERIOD_CELLS,
        seed + BRUSH_NOISE_SEED,
      );
      const brushTone = (brush - NOISE_MIDPOINT) * 2 * BRUSH_STREAK_SWING * painted;

      const tone = BASE_TONE + broadTone + grainTone + thinned * PATCH_TONE_LIFT + brushTone;
      const color = mix(sampleRamp(ramp, tone), sampleRamp(trimRamp, tone), painted);

      const index = pixelIndex(buffer, x, y);
      buffer.data[index + RED] = color[0];
      buffer.data[index + GREEN] = color[1];
      buffer.data[index + BLUE] = color[2];
      buffer.data[index + ALPHA] = PIXEL_OPAQUE;
    }
  }

  writePixels(plane.ctx, buffer);
}

function bandTileArea(options: PlasterOptions): number {
  const { plane, band, scale } = options;
  return (plane.width * (band.bottom - band.top)) / (scale * scale);
}

/**
 * Settlement cracks: a dark hairline with a lit lip alongside it.
 *
 * The lip is what turns a scratch into a crack — one side of a split has been
 * pushed proud of the other and catches the light. It goes on the side the sun
 * is on, which is why the offset takes its sign from the town's light direction
 * rather than being written down as a pixel.
 */
function paintCracks(options: PlasterOptions): void {
  const { plane, seed, band, ramp, scale } = options;
  const ctx = plane.ctx;
  const count = Math.round(bandTileArea(options) * CRACKS_PER_TILE_AREA);
  const lipOffset = Math.sign(LIGHT_DIR_X) * CRACK_LIP_PX;

  ctx.lineWidth = HAIRLINE_WIDTH_PX;
  for (let crack = 0; crack < count; crack++) {
    const startX = elementValue(seed, STREAM_CRACK_X, crack) * plane.width;
    const startY = band.top + elementValue(seed, STREAM_CRACK_Y, crack) * (band.bottom - band.top);
    const length =
      scale *
      CRACK_LENGTH_TILES *
      (CRACK_LENGTH_MIN_FACTOR +
        elementValue(seed, STREAM_CRACK_LENGTH, crack) * CRACK_LENGTH_SPREAD);

    // Plaster splits with gravity, so a crack runs broadly downhill and wavers
    // off that line rather than picking a direction at random.
    let angle =
      Math.PI / 2 +
      (elementValue(seed, STREAM_CRACK_ANGLE, crack) - NOISE_MIDPOINT) * 2 * CRACK_ANGLE_SPREAD;
    const segmentLength = length / CRACK_SEGMENTS;
    const path: Point[] = [{ x: startX, y: startY }];
    for (let segment = 0; segment < CRACK_SEGMENTS; segment++) {
      const waver =
        (elementValue(seed, STREAM_CRACK_WAVER, crack * CRACK_SEGMENTS + segment) -
          NOISE_MIDPOINT) *
        2 *
        CRACK_SEGMENT_WAVER;
      angle += waver;
      const previous = path[path.length - 1];
      path.push({
        x: previous.x + Math.cos(angle) * segmentLength,
        y: previous.y + Math.sin(angle) * segmentLength,
      });
    }

    ctx.strokeStyle = rgba(sampleRamp(ramp, CRACK_LIP_TONE), CRACK_LIP_ALPHA);
    strokePath(ctx, path, lipOffset, 0);
    ctx.strokeStyle = rgba(sampleRamp(ramp, CRACK_TONE), CRACK_ALPHA);
    strokePath(ctx, path, 0, 0);
  }
}

function strokePath(
  ctx: Plane['ctx'],
  path: ReadonlyArray<Point>,
  offsetX: number,
  offsetY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(path[0].x + offsetX, path[0].y + offsetY);
  for (let point = 1; point < path.length; point++) {
    ctx.lineTo(path[point].x + offsetX, path[point].y + offsetY);
  }
  ctx.stroke();
}

/**
 * Places where the coat has come away and the darker substrate shows.
 *
 * Kept rare and small — spalling is a detail that says "old wall" at a glance
 * and says "diseased wall" the moment there is enough of it to notice as a
 * pattern. Each patch is an irregular polygon with a lit lip along one edge, so
 * it reads as a shallow bowl rather than a sticker.
 */
function paintSpalls(options: PlasterOptions): void {
  const { plane, seed, band, ramp, scale } = options;
  const ctx = plane.ctx;
  const count = Math.round(bandTileArea(options) * SPALLS_PER_TILE_AREA);
  // A spall is a shallow bowl, so the wall of it that faces the sun is the one
  // on the far side: the lit lip goes away from the light, not toward it. Offset
  // it the other way and the same two polygons read as a blister.
  const lipOffsetX = -Math.sign(LIGHT_DIR_X) * SPALL_LIP_OFFSET_PX;
  const lipOffsetY = -Math.sign(LIGHT_DIR_Y) * SPALL_LIP_OFFSET_PX;

  for (let spall = 0; spall < count; spall++) {
    const centreX = elementValue(seed, STREAM_SPALL_X, spall) * plane.width;
    const centreY = band.top + elementValue(seed, STREAM_SPALL_Y, spall) * (band.bottom - band.top);
    const radius =
      scale *
      SPALL_RADIUS_TILES *
      (SPALL_RADIUS_MIN_FACTOR +
        elementValue(seed, STREAM_SPALL_RADIUS, spall) * SPALL_RADIUS_SPREAD);

    const outline: Point[] = [];
    for (let vertex = 0; vertex < SPALL_VERTICES; vertex++) {
      const angle = (vertex / SPALL_VERTICES) * Math.PI * 2;
      const stretch =
        SPALL_RADIUS_MIN_FACTOR +
        elementValue(seed, STREAM_SPALL_VERTEX, spall * SPALL_VERTICES + vertex) *
          SPALL_RADIUS_SPREAD;
      outline.push({
        x: centreX + Math.cos(angle) * radius * stretch,
        y: centreY + Math.sin(angle) * radius * stretch,
      });
    }

    ctx.fillStyle = rgba(sampleRamp(ramp, SPALL_LIP_TONE), SPALL_LIP_ALPHA);
    fillPolygon(ctx, outline, lipOffsetX, lipOffsetY);
    ctx.fillStyle = rgba(sampleRamp(ramp, SPALL_SUBSTRATE_TONE), SPALL_SUBSTRATE_ALPHA);
    fillPolygon(ctx, outline, 0, 0);
  }
}

function fillPolygon(
  ctx: Plane['ctx'],
  outline: ReadonlyArray<Point>,
  offsetX: number,
  offsetY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(outline[0].x + offsetX, outline[0].y + offsetY);
  for (let point = 1; point < outline.length; point++) {
    ctx.lineTo(outline[point].x + offsetX, outline[point].y + offsetY);
  }
  ctx.closePath();
  ctx.fill();
}
