/**
 * What a wall is made of, chosen once and applied to whichever plane asked.
 *
 * The dispatch lives apart from the materials so the front wall and the side
 * return genuinely share a material rather than each choosing one: a building
 * whose return was dressed stone while its face was rubble would read as two
 * buildings meeting at a corner, and that mistake is invisible in a spec and
 * obvious in a picture.
 *
 * The foundation is handled here too, for the same reason. Every wall material
 * sits on the same taller, darker, mossier base course, and painting it inside
 * each material would give five subtly different foundations.
 */

import type { Plane } from '../projection.js';
import { getRamp } from '../ramps.js';
import type { WallPaintOptions } from './kit.js';
import { paintStone } from './stone.js';
import { paintPlaster } from './plaster.js';
import { paintPlankWall, paintTimberFrame } from './timber.js';

/**
 * Course and block sizes per masonry material, in tiles.
 *
 * Stated in tiles rather than pixels so the bake scale stays a knob, and chosen
 * so no course height divides a tile evenly — a course pitch of exactly a third
 * of a tile paints a horizontal band every 48 px that survives the downsample
 * and reads as a grid across the whole town.
 */
const FIELDSTONE_COURSE_TILES = 0.29;
const FIELDSTONE_BLOCK_TILES = 0.43;
const FIELDSTONE_DRESSED = 0.15;

const COURSED_STONE_COURSE_TILES = 0.235;
const COURSED_STONE_BLOCK_TILES = 0.51;
const COURSED_STONE_DRESSED = 0.55;

const DRESSED_STONE_COURSE_TILES = 0.27;
const DRESSED_STONE_BLOCK_TILES = 0.62;
const DRESSED_STONE_DRESSED = 0.95;

/** The base course is coarser and laid in bigger stones than the wall above it. */
const FOUNDATION_COURSE_FACTOR = 1.35;
const FOUNDATION_BLOCK_FACTOR = 1.25;
/** How much darker the foundation is than the wall it carries. */
const FOUNDATION_SHADE = 0.78;

export function paintWall(options: WallPaintOptions): void {
  const { band } = options;
  const foundationTop = Math.max(band.top, band.bottom - options.foundationPx);
  const hasFoundation = options.foundationPx > 0 && foundationTop > band.top;

  paintWallBody({
    ...options,
    band: { top: band.top, bottom: hasFoundation ? foundationTop : band.bottom },
  });

  if (hasFoundation) {
    paintFoundation(options, { top: foundationTop, bottom: band.bottom });
  }
}

function paintWallBody(options: WallPaintOptions): void {
  const { plane, noise, seed, band, wall, scale, quoins } = options;
  switch (wall.material) {
    case 'fieldstone':
      paintStone({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        jointRamp: getRamp(wall.trimRamp),
        coursePx: FIELDSTONE_COURSE_TILES * scale,
        blockPx: FIELDSTONE_BLOCK_TILES * scale,
        dressed: FIELDSTONE_DRESSED,
        quoins,
      });
      return;
    case 'coursed_stone':
      paintStone({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        jointRamp: getRamp(wall.trimRamp),
        coursePx: COURSED_STONE_COURSE_TILES * scale,
        blockPx: COURSED_STONE_BLOCK_TILES * scale,
        dressed: COURSED_STONE_DRESSED,
        quoins,
      });
      return;
    case 'dressed_stone':
      paintStone({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        jointRamp: getRamp(wall.trimRamp),
        coursePx: DRESSED_STONE_COURSE_TILES * scale,
        blockPx: DRESSED_STONE_BLOCK_TILES * scale,
        dressed: DRESSED_STONE_DRESSED,
        quoins,
      });
      return;
    case 'plaster':
      paintPlaster({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        trimRamp: getRamp(wall.trimRamp),
        painted: 0,
        scale,
      });
      return;
    case 'painted_plaster':
      paintPlaster({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        trimRamp: getRamp(wall.trimRamp),
        painted: PAINTED_COAT_STRENGTH,
        scale,
      });
      return;
    case 'timber_frame':
      paintTimberFrame({
        plane,
        noise,
        seed,
        band,
        beamRamp: getRamp(wall.ramp),
        infillRamp: getRamp(wall.trimRamp),
        scale,
        braces: true,
        sillBeam: true,
      });
      return;
    case 'plank':
      paintPlankWall({
        plane,
        noise,
        seed,
        band,
        ramp: getRamp(wall.ramp),
        scale,
        horizontal: false,
      });
      return;
  }
}

/** How far a painted coat covers the lime beneath it. Never 1 — paint wears. */
const PAINTED_COAT_STRENGTH = 0.82;

/**
 * The base course: bigger stones, darker, whatever the wall above is made of.
 *
 * Always masonry. A timber-framed building still stands on a stone plinth,
 * because timber in contact with the ground rots — and a jettied inn whose
 * plaster ran all the way into the mud would read as a model rather than as a
 * building.
 */
function paintFoundation(options: WallPaintOptions, band: { top: number; bottom: number }): void {
  const { plane, noise, seed, scale, wall } = options;
  const foundationRamp = getRamp(wall.material === 'dressed_stone' ? wall.ramp : 'fieldstone');
  paintStone({
    plane,
    noise,
    seed: seed + FOUNDATION_SEED_OFFSET,
    band,
    ramp: foundationRamp,
    jointRamp: getRamp(wall.trimRamp),
    coursePx: FIELDSTONE_COURSE_TILES * FOUNDATION_COURSE_FACTOR * scale,
    blockPx: FIELDSTONE_BLOCK_TILES * FOUNDATION_BLOCK_FACTOR * scale,
    dressed: FIELDSTONE_DRESSED,
    quoins: false,
  });
  darkenBand(plane, band, FOUNDATION_SHADE);
}

const FOUNDATION_SEED_OFFSET = 7717;

/**
 * Multiplies a band's colour in place.
 *
 * A multiply rather than a translucent black rectangle: the rectangle is what
 * flattens the circus tents, and the foundation is the one place on a wall where
 * losing the stone's variation would be most obvious.
 */
function darkenBand(plane: Plane, band: { top: number; bottom: number }, factor: number): void {
  const top = Math.max(0, Math.floor(band.top));
  const height = Math.min(plane.height, Math.ceil(band.bottom)) - top;
  if (height <= 0) return;
  const image = plane.ctx.getImageData(0, top, plane.width, height);
  const CHANNELS = 4;
  const ALPHA_OFFSET = 3;
  for (let i = 0; i < image.data.length; i += CHANNELS) {
    if (image.data[i + ALPHA_OFFSET] === 0) continue;
    image.data[i] *= factor;
    image.data[i + 1] *= factor;
    image.data[i + 2] *= factor;
  }
  plane.ctx.putImageData(image, 0, top);
}
