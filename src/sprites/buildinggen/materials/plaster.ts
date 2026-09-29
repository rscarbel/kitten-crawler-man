/**
 * Lime plaster, and the painted coats laid over it.
 *
 * Plaster has no elements — no courses, no blocks, nothing whose edges give the
 * eye something to hold — so everything that stops it reading as a flat fill has
 * to be drawn on deliberately. A plaster wall reads clean in the way this town
 * wants when it is treated like a smooth painted surface with a handful of
 * legible marks on it — a few broad patches where the wash sits a shade
 * different, a scatter of hairline cracks and small spalls — rather than as a
 * field of per-pixel grain. Every layer here is a drawn shape at a known
 * position, never a sampled noise field: the patches are irregular polygons,
 * not a thresholded texture, so the wall stays a flat, readable plane with
 * marks on it instead of a granular surface.
 *
 * Paint changes all of that in one direction: a painted coat *evens a wall out*.
 * So `painted` mixes the surface toward the trim ramp and quiets the patchwork
 * down — a freshly painted wall has almost no variation left to show.
 */

import type { Plane, Point } from '../projection';
import { LIGHT_DIR_X, LIGHT_DIR_Y, mix, rgb, rgba, sampleRamp, type Ramp } from '../ramps';
import { elementValue, type Band } from './kit';

export interface PlasterOptions {
  readonly plane: Plane;
  readonly seed: number;
  readonly band: Band;
  readonly ramp: Ramp;
  readonly trimRamp: Ramp;
  /** 0 = raw lime plaster, 1 = a saturated painted coat over it. */
  readonly painted: number;
  /** Pixels per tile, for measures that are architectural rather than textural. */
  readonly scale: number;
  /** 0..1: how far a fresh limewash has hidden the patches, cracks and spalls. Absent means 0. */
  readonly upkeep?: number;
}

/** What survives of the wall's marks under its owner's upkeep. */
function wearRemaining(options: PlasterOptions): number {
  return 1 - Math.min(1, Math.max(0, options.upkeep ?? 0));
}

/** Ramp position most of the surface sits at, before any of the layers move it. */
const BASE_TONE = 0.58;

/** The midpoint every jitter sample is centred on before being scaled. */
const NOISE_MIDPOINT = 0.5;

/**
 * A handful of broad patches where the wash sits a shade lighter or darker —
 * the "this end caught more rain" read a flat wall needs, drawn as a few
 * soft-edged irregular shapes rather than sampled per pixel. Sized in tiles
 * of surface area so a wide wall gets proportionally more of them, not
 * bigger ones.
 */
const PATCH_AREA_PER_TILE = 2.2;
const PATCH_RADIUS_TILES = 0.65;
const PATCH_RADIUS_JITTER = 0.45;
const PATCH_TONE_SWING = 0.12;
const PATCH_VERTICES = 7;
const PATCH_VERTEX_JITTER = 0.4;
const PATCH_VERTEX_KEY_STRIDE = 11;

/** How much of the patchwork a full painted coat suppresses. */
const MOTTLE_DAMPING_AT_FULL_PAINT = 0.75;

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

/** Element streams, so two properties of one feature never share a number. */
const STREAM_CRACK_X = 11;
const STREAM_CRACK_Y = 12;
const STREAM_CRACK_LENGTH = 13;
const STREAM_CRACK_ANGLE = 14;
const STREAM_CRACK_WAVER = 15;
const STREAM_SPALL_X = 16;
const STREAM_SPALL_Y = 17;
const STREAM_SPALL_RADIUS = 18;
const STREAM_SPALL_VERTEX = 19;
const STREAM_PATCH_X = 20;
const STREAM_PATCH_Y = 21;
const STREAM_PATCH_RADIUS = 22;
const STREAM_PATCH_SIGN = 23;
const STREAM_PATCH_VERTEX = 24;

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
 * A flat wash, plus a handful of drawn patches where it sits a shade off.
 *
 * The base fill is one colour — a plaster wall is a smooth painted plane, and
 * flat is correct for it in a way it never is for masonry — and the patches
 * are the only thing that varies it, each one an irregular polygon at its own
 * tone rather than a sampled field. `firstRow`/`lastRow` confine the fill to
 * the band; the patch pass runs under the caller's own clip.
 */
function paintSurface(options: PlasterOptions, firstRow: number, lastRow: number): void {
  const { plane, ramp, trimRamp, painted } = options;
  const ctx = plane.ctx;
  const bandHeight = lastRow - firstRow;
  const baseColor = mix(sampleRamp(ramp, BASE_TONE), sampleRamp(trimRamp, BASE_TONE), painted);
  ctx.fillStyle = rgb(baseColor);
  ctx.fillRect(0, firstRow, plane.width, bandHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, firstRow, plane.width, bandHeight);
  ctx.clip();
  paintWashPatches(options, firstRow, bandHeight);
  ctx.restore();
}

/**
 * The broad, soft-shade patches that keep a plaster wall from reading as a
 * single flat swatch: a full painted coat suppresses most of them, since an
 * even coat of paint is exactly what a plaster wall does not have once it is
 * covered.
 */
function paintWashPatches(options: PlasterOptions, firstRow: number, bandHeight: number): void {
  const { plane, seed, ramp, trimRamp, painted } = options;
  const ctx = plane.ctx;
  const strength = (1 - painted * MOTTLE_DAMPING_AT_FULL_PAINT) * wearRemaining(options);
  if (strength <= 0) return;

  const bandTiles = (plane.width * bandHeight) / (options.scale * options.scale);
  const count = Math.max(1, Math.round(bandTiles / PATCH_AREA_PER_TILE));
  const baseRadius = PATCH_RADIUS_TILES * options.scale;

  for (let patch = 0; patch < count; patch++) {
    const centreX = elementValue(seed, STREAM_PATCH_X, patch) * plane.width;
    const centreY = firstRow + elementValue(seed, STREAM_PATCH_Y, patch) * bandHeight;
    const radius =
      baseRadius *
      (1 +
        (elementValue(seed, STREAM_PATCH_RADIUS, patch) - NOISE_MIDPOINT) *
          2 *
          PATCH_RADIUS_JITTER);
    const lighter = elementValue(seed, STREAM_PATCH_SIGN, patch) < 0.5;
    const tone = BASE_TONE + (lighter ? PATCH_TONE_SWING : -PATCH_TONE_SWING) * strength;
    const color = mix(sampleRamp(ramp, tone), sampleRamp(trimRamp, tone), painted);

    ctx.beginPath();
    for (let vertex = 0; vertex < PATCH_VERTICES; vertex++) {
      const angle = (vertex / PATCH_VERTICES) * Math.PI * 2;
      const key = patch * PATCH_VERTEX_KEY_STRIDE + vertex;
      const stretch =
        1 +
        (elementValue(seed, STREAM_PATCH_VERTEX, key) - NOISE_MIDPOINT) * 2 * PATCH_VERTEX_JITTER;
      const x = centreX + Math.cos(angle) * radius * stretch;
      const y = centreY + Math.sin(angle) * radius * stretch;
      if (vertex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = rgb(color);
    ctx.fill();
  }
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
  const count = Math.round(bandTileArea(options) * CRACKS_PER_TILE_AREA * wearRemaining(options));
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
  const count = Math.round(bandTileArea(options) * SPALLS_PER_TILE_AREA * wearRemaining(options));
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
