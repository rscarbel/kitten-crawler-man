/**
 * The horizontal and vertical divisions that turn a wall into an elevation.
 *
 * A facade painted as one material from plinth to eaves reads as a swatch of
 * that material at building size, however well the material itself is made —
 * which is the failure the whole kit was built to avoid, arriving by a different
 * road. Real frontages are divided: a plinth cap where the foundation stops
 * carrying, a string course at the floor line, piers between the bays. Every one
 * of those divisions is also an edge the sun catches, so they are the cheapest
 * value contrast a wall can have.
 *
 * Trim is painted after the wall and before the weathering, so the grime runs
 * over the mouldings rather than stopping politely at them.
 */

import type { Plane } from '../projection.js';
import { getRamp, rgb, rgba, sampleRamp } from '../ramps.js';
import { paintEdgeAo, paintEdgeLight } from '../lighting.js';
import type { FacadeBandSpec } from '../spec.js';
import { elementValue, ELEMENT_TONE_JITTER, ELEMENT_EDGE_PX } from './kit.js';

/** How far a projecting band stands proud, and how far its shadow reaches below. */
const BAND_SHADOW_REACH_PX = 5;
const BAND_SHADOW_DEPTH = 0.5;
const BAND_EDGE_LIGHT_ALPHA = 0.6;
const BAND_EDGE_LIGHT_PX = 1.5;

/** Blocks along a band, so it reads as coursed stone rather than as a painted stripe. */
const BAND_BLOCK_TILES = 0.42;
const BAND_JOINT_PX = 1.2;
const STREAM_BAND_BLOCK = 31;

export interface BandPaintOptions {
  readonly plane: Plane;
  readonly seed: number;
  readonly scale: number;
  /** Plane-space Y of the band's top and bottom, already converted by the caller. */
  readonly top: number;
  readonly bottom: number;
  readonly band: FacadeBandSpec;
}

export function paintFacadeBand(options: BandPaintOptions): void {
  const { plane, top, bottom } = options;
  const height = bottom - top;
  if (height < 1) return;
  const ctx = plane.ctx;
  const ramp = getRamp(options.band.ramp);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, plane.width, height);
  ctx.clip();

  // Laid as blocks rather than filled flat, for the same reason the walls are:
  // a solid stripe of one colour is the most recognisable procedural tell there
  // is, and a string course is masonry like everything else around it.
  ctx.fillStyle = rgb(sampleRamp(ramp, 0));
  ctx.fillRect(0, top, plane.width, height);
  const blockWidth = BAND_BLOCK_TILES * options.scale;
  for (let index = 0; index * blockWidth < plane.width; index++) {
    const tone =
      0.5 + (elementValue(options.seed, STREAM_BAND_BLOCK, index) - 0.5) * 2 * ELEMENT_TONE_JITTER;
    ctx.fillStyle = rgb(sampleRamp(ramp, tone));
    ctx.fillRect(index * blockWidth + BAND_JOINT_PX, top, blockWidth - BAND_JOINT_PX, height);
  }

  ctx.restore();

  if (options.band.projecting) {
    paintEdgeLight(
      ctx,
      { x: 0, y: top + ELEMENT_EDGE_PX },
      { x: plane.width, y: top + ELEMENT_EDGE_PX },
      sampleRamp(ramp, 1),
      BAND_EDGE_LIGHT_PX,
      BAND_EDGE_LIGHT_ALPHA,
    );
    // The shadow falls on the wall *below* the band, which is what states the
    // band is in front of it rather than painted onto it.
    paintEdgeAo(ctx, { x: 0, y: bottom, width: plane.width, height: BAND_SHADOW_REACH_PX }, 'top', {
      depth: BAND_SHADOW_DEPTH,
      reach: BAND_SHADOW_REACH_PX,
    });
  }
}

/** Width of a pier as a fraction of the bay it divides, and its relief. */
const PILASTER_WIDTH_TILES = 0.34;
const PILASTER_LIGHT_FRACTION = 0.3;
const PILASTER_SHADOW_FRACTION = 0.28;
const PILASTER_SHADOW_ALPHA = 0.45;
const PILASTER_CAP_TILES = 0.16;
const STREAM_PILASTER = 33;

export interface PilasterPaintOptions {
  readonly plane: Plane;
  readonly seed: number;
  readonly scale: number;
  readonly count: number;
  readonly rampId: string;
  /** Plane-space Y the piers rise from and to. */
  readonly top: number;
  readonly bottom: number;
}

/**
 * Vertical piers dividing the frontage into bays.
 *
 * The end piers sit flush with the wall's edges rather than centred on them, so
 * a building's corners read as thickened rather than as a pier sliced in half by
 * the silhouette.
 */
export function paintPilasters(options: PilasterPaintOptions): void {
  const { plane, count } = options;
  if (count < 2) return;
  const ctx = plane.ctx;
  const ramp = getRamp(options.rampId);
  const width = PILASTER_WIDTH_TILES * options.scale;
  const height = options.bottom - options.top;
  if (height < 1) return;

  for (let pier = 0; pier < count; pier++) {
    const centre = (plane.width * pier) / (count - 1);
    const left = Math.min(plane.width - width, Math.max(0, centre - width / 2));
    // Doubled like every other per-element tone in the kit. Without it the piers
    // spanned half the range the bands beside them do, and the Desperado's six
    // came out with three of them pixel-identical.
    const tone =
      0.5 + (elementValue(options.seed, STREAM_PILASTER, pier) - 0.5) * 2 * ELEMENT_TONE_JITTER;

    ctx.fillStyle = rgb(sampleRamp(ramp, tone));
    ctx.fillRect(left, options.top, width, height);
    ctx.fillStyle = rgba(sampleRamp(ramp, 1), PILASTER_LIGHT_FRACTION);
    ctx.fillRect(left, options.top, Math.max(1, width * PILASTER_LIGHT_FRACTION), height);
    ctx.fillStyle = rgba(sampleRamp(ramp, 0), PILASTER_SHADOW_ALPHA);
    ctx.fillRect(
      left + width - Math.max(1, width * PILASTER_SHADOW_FRACTION),
      options.top,
      Math.max(1, width * PILASTER_SHADOW_FRACTION),
      height,
    );

    paintPilasterFlutes(options, left, width);

    // A capital: a pier that runs into the eaves with no head reads as a stripe.
    const capHeight = PILASTER_CAP_TILES * options.scale;
    const capOverhang = width * PILASTER_LIGHT_FRACTION;
    ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, tone + PILASTER_LIGHT_FRACTION)));
    ctx.fillRect(left - capOverhang / 2, options.top, width + capOverhang, capHeight);
    ctx.fillStyle = rgb(sampleRamp(ramp, Math.max(0, tone - PILASTER_SHADOW_FRACTION)));
    ctx.fillRect(left - capOverhang / 2, options.top + capHeight, width + capOverhang, 1);
  }
}

/**
 * Vertical flutes down a pier's face.
 *
 * Each flute is a shadow with a lit lip beside it, which is what makes a groove
 * read as cut into the stone rather than painted on it. Two of them are enough:
 * a pier is a third of a tile wide, and any more become a stripe pattern at the
 * display scale rather than a moulding.
 */
const FLUTE_COUNT = 2;
const FLUTE_SHADOW_ALPHA = 0.34;
const FLUTE_LIGHT_ALPHA = 0.3;
const FLUTE_WIDTH_PX = 1;
const FLUTE_MARGIN_FRACTION = 0.24;

function paintPilasterFlutes(options: PilasterPaintOptions, left: number, width: number): void {
  const ctx = options.plane.ctx;
  const ramp = getRamp(options.rampId);
  const usable = width * (1 - FLUTE_MARGIN_FRACTION * 2);
  if (usable < FLUTE_COUNT * FLUTE_WIDTH_PX * 2) return;
  for (let flute = 0; flute < FLUTE_COUNT; flute++) {
    const x = left + width * FLUTE_MARGIN_FRACTION + (usable * (flute + 0.5)) / FLUTE_COUNT;
    ctx.fillStyle = rgba(sampleRamp(ramp, 0), FLUTE_SHADOW_ALPHA);
    ctx.fillRect(x, options.top, FLUTE_WIDTH_PX, options.bottom - options.top);
    ctx.fillStyle = rgba(sampleRamp(ramp, 1), FLUTE_LIGHT_ALPHA);
    ctx.fillRect(x + FLUTE_WIDTH_PX, options.top, FLUTE_WIDTH_PX, options.bottom - options.top);
  }
}

/** Frame-space Y of a band's edges, for the caller that owns the projection. */
export function bandEdges(
  band: FacadeBandSpec,
  scale: number,
  groundY: number,
): { readonly topFrameY: number; readonly bottomFrameY: number } {
  const bottomFrameY = groundY - band.baseAboveGroundTiles * scale;
  return { topFrameY: bottomFrameY - band.heightTiles * scale, bottomFrameY };
}
