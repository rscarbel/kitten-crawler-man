/**
 * Dungeon walls seen from the game's 3/4 camera: front faces, end slivers and cap
 * rims, standing in a flat wall top that falls away into black.
 *
 * Which of those a tile shows is decided by `src/map/dungeon/wallShape.ts`, and
 * how much light reaches it by `src/map/dungeon/wallLight.ts`; this module paints
 * the answer. Depth comes from structure rather than texture — a lit cap along the
 * top of every face, a darker return where a face turns, slivers and rims at the
 * edges — and from the light dying away across the top of the rock with distance
 * from the floor, so the masonry inside a face stays quiet.
 *
 * ## How a tile is built
 *
 * 1. **The wall top**: dressed capstones on floor 1 and poured strips on floor 2,
 *    crisp and low in contrast, tiled from one patch per floor.
 * 2. **The structure**: each floor paints one face strip, two tiles tall and four
 *    across — the lit cap, then the face down to its foot, with the floor's finish
 *    (a damp tide line on floor 1, a painted two-tone band and rubber skirting on
 *    floor 2) over `paintCoursedBlocks` masonry. An upper-face tile takes the strip
 *    from its cap down, a lower-face tile its bottom half, a one-tile-thick wall the
 *    whole face squeezed into one tile. Slivers, rims, jambs and corners are drawn
 *    with it; the composite is cached per floor, shape and strip slice.
 * 3. **The dressing** a room's character hangs on its faces
 *    (`dungeonWallDressing.ts`).
 * 4. **The shadow**: black, its alpha eased from the distance to lit space at the
 *    tile's sample points, cached per quantised set of samples.
 *
 * **Every piece paints strictly inside its own tile.** Terrain is baked into
 * 16x16-tile chunks clipped to their own rect, so anything reaching past the tile
 * would be sliced off at a chunk seam.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { Surface, TILE_PX, positiveMod, type RGB } from '../../map/tilegen/raster';
import { NoiseField, hashLattice } from '../../map/tilegen/noise';
import { TILE_SIZE } from '../../core/constants';
import { paintCoursedBlocks, type CoursedBlockOptions } from '../../map/tilegen/materials';
import {
  CELLAR_WALL_RAMP,
  CINDERBLOCK_RAMP,
  mix,
  sampleRamp,
  shade,
  type Ramp,
} from '../../map/tilegen/palette';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import type { WallFacePart, WallShape } from '../../map/dungeon/wallShape';
import { WALL_LIGHT_SAMPLES, wallDarknessAt } from '../../map/dungeon/wallLight';
import {
  BODY_TOP_TILES,
  FACE_STRIP_ROWS,
  ARRIS_TILES,
  JAMB_TILES,
  WALL_TOP_TILES,
  rgba,
  type Side,
} from './dungeonWallGeometry';
import { drawDressing, type NeighbourFace, type WallDressingSet } from './dungeonWallDressing';

type Ctx = CanvasRenderingContext2D;

// ── geometry, in tiles ─────────────────────────────────────────────────────

/** Tiles of face strip across before its masonry repeats. */
const FACE_STRIP_COLUMNS = 4;
/** Differently laid bands of masonry, so faces on neighbouring rows are not copies. */
const FACE_STRIP_BANDS = 2;
const STRIP_WIDTH_PX = FACE_STRIP_COLUMNS * TILE_PX;
const STRIP_HEIGHT_PX = FACE_STRIP_ROWS * TILE_PX;
/** The masonry is painted on a square wrapped patch; each band is a slice of it. */
const MASONRY_PATCH_PX = STRIP_WIDTH_PX;

/** The line of shadow the cap's overhang throws on the face just under it. */
const CAP_SHADOW_TILES = 0.05;

/** The end of a wall seen edge-on: a narrow strip beside the wall top. */
const SLIVER_TILES = 0.17;
/** The cap rim a room sees along its south wall, then its shadow line. */
const LIP_TILES = 0.1;
const LIP_LINE_TILES = 0.04;

/** Alpha at a gradient stop that fully covers, and at one that has faded out. */
const OPAQUE = 1;
/** Rock past the light: the void's and the fog's colour, so the three are one. */
const MASS_COLOR = '#000000';

// ── face shading ───────────────────────────────────────────────────────────

/** How far down the body the cap's shadow reaches, as a fraction of the body. */
const BODY_TOP_SHADOW_REACH = 0.14;
const BODY_TOP_SHADOW_FACTOR = 0.66;
/** A face darkens toward its foot, away from the light above and in front. */
const BODY_FOOT_FACTOR = 0.84;
const CAP_HIGHLIGHT_ROWS_PX = 2;
const CAP_GRAIN_STRENGTH = 0.08;
const CAP_GRAIN_PERIOD = 32;
const CAP_GRAIN_SEED = 911;

// ── floor 1: rubble limestone, lime mortar, a damp tide line ───────────────

/**
 * How far a face is lifted above its floor's flat wall ramp. The face is the lit
 * front of the rock against a dark top, so it can carry more light than a wall
 * that was most of the screen — and it is still held well under every floor on
 * its level (the floor sweep gates the separation). The darker stops lift more,
 * which compresses the range: the texture inside a face stays quiet.
 */
const FACE_LIFT_SHADOW = 1.5;
const FACE_LIFT_MID = 1.4;
const FACE_LIFT_LIGHT = 1.32;
const FACE_LIFT_ACCENT = 1.24;

function liftedForFace(ramp: Ramp): Ramp {
  return {
    shadow: shade(ramp.shadow, FACE_LIFT_SHADOW),
    mid: shade(ramp.mid, FACE_LIFT_MID),
    light: shade(ramp.light, FACE_LIFT_LIGHT),
    accent: shade(ramp.accent, FACE_LIFT_ACCENT),
  };
}

function shadeRamp(ramp: Ramp, factor: number): Ramp {
  return {
    shadow: shade(ramp.shadow, factor),
    mid: shade(ramp.mid, factor),
    light: shade(ramp.light, factor),
    accent: shade(ramp.accent, factor),
  };
}

/** A signed draw in -1..1 from a noise sample in 0..1. */
function signedNoise(sample: number): number {
  return sample * 2 - 1;
}

const CELLAR_FACE_RAMP: Ramp = liftedForFace(CELLAR_WALL_RAMP);
const CELLAR_MORTAR: RGB = [104, 94, 78];
const CELLAR_CAP: RGB = [118, 104, 84];
const CELLAR_CAP_HIGHLIGHT: RGB = [142, 127, 104];
const CELLAR_DAMP: RGB = [34, 36, 28];
/** Top of the tide line, as a fraction of the body from the cap down, before its wander. */
const CELLAR_TIDE_TOP = 0.78;
const CELLAR_TIDE_WANDER = 0.05;
const CELLAR_TIDE_PERIOD = 8;
const CELLAR_TIDE_SEED = 407;
const CELLAR_TIDE_ALPHA = 0.5;
/** Pixels the tide line's upper edge takes to fade in, and the pale salt bloom along it. */
const CELLAR_TIDE_EDGE_PX = 5;
const CELLAR_SALT_PX = 2;
const CELLAR_SALT_FACTOR = 1.14;

const CELLAR_MASONRY: CoursedBlockOptions = {
  coursesPerTile: 3,
  blocksPerCoursePerTile: 1.25,
  ramp: CELLAR_FACE_RAMP,
  jointRamp: { ...CELLAR_FACE_RAMP, mid: CELLAR_MORTAR, light: CELLAR_MORTAR },
  jointPx: 2.4,
  jointStrength: 0.55,
  bondOffset: 0.37,
  edgeBandPx: 2,
  topLight: 1.16,
  bottomShadow: 0.78,
  toneFloor: 0.22,
  toneSpread: 0.56,
  grainStrength: 0.18,
  jointWanderPx: 3.2,
};
const CELLAR_MASONRY_SEED = 0x51c3a7;

// ── floor 2: painted blockwork, a two-tone band, rubber skirting ───────────

/**
 * Floor 2's paint is held a step under the cellar face's lift: the level's
 * darkest floor, the rubber matting, sits closer to the walls than any floor on
 * floor 1 does, and the face must stay clear below it.
 */
const SERVICE_PAINT_TONE = 0.88;
const SERVICE_PAINT_RAMP: Ramp = shadeRamp(liftedForFace(CINDERBLOCK_RAMP), SERVICE_PAINT_TONE);
/** Paint pools in the joints, so they read a little darker than the block's own shadow. */
const SERVICE_JOINT_TONE = 0.9;
/** The lower band's colour as a multiplier on the paint above it: darker and greener. */
const SERVICE_BAND_TINT: RGB = [0.62, 0.74, 0.68];
/** Where the painted line sits, as a fraction of the body from the cap down: a third up from the floor. */
const SERVICE_BAND_TOP = 0.64;
const SERVICE_STRIPE_PX = 3;
const SERVICE_STRIPE: RGB = [44, 74, 64];
const SERVICE_SKIRTING_PX = 7;
const SERVICE_SKIRTING: RGB = [24, 26, 27];
const SERVICE_SKIRTING_HIGHLIGHT: RGB = [66, 72, 74];
/** The lit top edge of the skirting. */
const SERVICE_SKIRTING_HIGHLIGHT_PX = 1;
const SERVICE_CAP: RGB = [112, 120, 116];
const SERVICE_CAP_HIGHLIGHT: RGB = [138, 146, 142];
const SERVICE_SCUFF_PERIOD = 16;
const SERVICE_SCUFF_SEED = 613;
const SERVICE_SCUFF_THRESHOLD = 0.62;
const SERVICE_SCUFF_FACTOR = 0.8;
/** Scuffs sit in the lower part of the band, where boots and trolleys reach. */
const SERVICE_SCUFF_TOP = 0.8;

const SERVICE_MASONRY: CoursedBlockOptions = {
  coursesPerTile: 2.5,
  blocksPerCoursePerTile: 1.25,
  ramp: SERVICE_PAINT_RAMP,
  jointRamp: { ...SERVICE_PAINT_RAMP, mid: shade(SERVICE_PAINT_RAMP.shadow, SERVICE_JOINT_TONE) },
  jointPx: 1.6,
  jointStrength: 0.5,
  bondOffset: 0.5,
  edgeBandPx: 1.6,
  topLight: 1.06,
  bottomShadow: 0.9,
  toneFloor: 0.42,
  toneSpread: 0.14,
  grainStrength: 0.08,
  jointWanderPx: 0.3,
};
const SERVICE_MASONRY_SEED = 0x2e7b19;

// ── themes ─────────────────────────────────────────────────────────────────

interface WallTheme {
  readonly masonry: CoursedBlockOptions;
  readonly masonrySeed: number;
  readonly cap: RGB;
  readonly capHighlight: RGB;
  /** The floor's finish over the bare masonry, per body pixel. `v` runs 0 at the cap to 1 at the floor. */
  readonly finish: (pixel: RGB, v: number, x: number, y: number, noise: NoiseField) => RGB;
}

function cellarFinish(pixel: RGB, v: number, x: number, _y: number, noise: NoiseField): RGB {
  const tideTop =
    CELLAR_TIDE_TOP +
    signedNoise(noise.value(x, 0, CELLAR_TIDE_PERIOD, CELLAR_TIDE_SEED)) * CELLAR_TIDE_WANDER;
  const bodyPx = STRIP_HEIGHT_PX - BODY_TOP_TILES * TILE_PX;
  const pxBelowTide = (v - tideTop) * bodyPx;
  if (pxBelowTide >= 0) {
    const fadeIn = Math.min(1, pxBelowTide / CELLAR_TIDE_EDGE_PX);
    return mix(pixel, CELLAR_DAMP, CELLAR_TIDE_ALPHA * fadeIn);
  }
  if (pxBelowTide > -CELLAR_SALT_PX) return shade(pixel, CELLAR_SALT_FACTOR);
  return pixel;
}

function serviceFinish(pixel: RGB, v: number, x: number, y: number, noise: NoiseField): RGB {
  const bodyPx = STRIP_HEIGHT_PX - BODY_TOP_TILES * TILE_PX;
  const pxToFloor = (1 - v) * bodyPx;
  if (pxToFloor < SERVICE_SKIRTING_PX) {
    const onSkirtingTop = pxToFloor > SERVICE_SKIRTING_PX - SERVICE_SKIRTING_HIGHLIGHT_PX;
    return onSkirtingTop ? SERVICE_SKIRTING_HIGHLIGHT : SERVICE_SKIRTING;
  }
  const pxBelowStripe = (v - SERVICE_BAND_TOP) * bodyPx;
  if (pxBelowStripe >= 0 && pxBelowStripe < SERVICE_STRIPE_PX) return SERVICE_STRIPE;
  if (pxBelowStripe < 0) return pixel;
  const banded: RGB = [
    pixel[0] * SERVICE_BAND_TINT[0],
    pixel[1] * SERVICE_BAND_TINT[1],
    pixel[2] * SERVICE_BAND_TINT[2],
  ];
  const inScuffReach = v > SERVICE_SCUFF_TOP;
  const scuffed =
    inScuffReach &&
    noise.value(x, y, SERVICE_SCUFF_PERIOD, SERVICE_SCUFF_SEED) > SERVICE_SCUFF_THRESHOLD;
  return scuffed ? shade(banded, SERVICE_SCUFF_FACTOR) : banded;
}

const THEMES: Readonly<Record<DungeonFloorThemeId, WallTheme>> = {
  cellars: {
    masonry: CELLAR_MASONRY,
    masonrySeed: CELLAR_MASONRY_SEED,
    cap: CELLAR_CAP,
    capHighlight: CELLAR_CAP_HIGHLIGHT,
    finish: cellarFinish,
  },
  service_level: {
    masonry: SERVICE_MASONRY,
    masonrySeed: SERVICE_MASONRY_SEED,
    cap: SERVICE_CAP,
    capHighlight: SERVICE_CAP_HIGHLIGHT,
    finish: serviceFinish,
  },
};

// ── the face strip ─────────────────────────────────────────────────────────

/** A face strip's pixels, before they become a canvas. */
export interface FaceStripPixels {
  readonly width: number;
  readonly height: number;
  /** RGB triples, row-major. */
  readonly rgb: Float64Array;
  /**
   * First row of the cap. The rows above it are never drawn: the wall top there
   * comes from the wall-top patch instead.
   */
  readonly capTopRow: number;
}

const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const ALPHA_MAX = 255;

function paintMasonry(theme: WallTheme): Surface {
  const surface = new Surface(MASONRY_PATCH_PX);
  paintCoursedBlocks(
    {
      surface,
      size: MASONRY_PATCH_PX,
      noise: new NoiseField(MASONRY_PATCH_PX),
      structure: theme.masonrySeed,
      detail: theme.masonrySeed + 1,
    },
    theme.masonry,
  );
  return surface;
}

const masonryPatches = new Map<DungeonFloorThemeId, Surface>();

function masonryFor(themeId: DungeonFloorThemeId): Surface {
  const cached = masonryPatches.get(themeId);
  if (cached !== undefined) return cached;
  const painted = paintMasonry(THEMES[themeId]);
  masonryPatches.set(themeId, painted);
  return painted;
}

/**
 * Paints one band of a floor's face strip. Pure maths, no canvas: the floor sweep
 * measures faces against floors from exactly these pixels.
 */
export function paintFaceStrip(themeId: DungeonFloorThemeId, band: number): FaceStripPixels {
  const theme = THEMES[themeId];
  const masonry = masonryFor(themeId);
  const noise = new NoiseField(STRIP_WIDTH_PX);
  const rgb = new Float64Array(STRIP_WIDTH_PX * STRIP_HEIGHT_PX * RGB_CHANNELS);
  const capTop = Math.round(WALL_TOP_TILES * TILE_PX);
  const bodyTop = Math.round(BODY_TOP_TILES * TILE_PX);
  const capShadowRows = Math.round(CAP_SHADOW_TILES * TILE_PX);
  const bandOffset = positiveMod(band, FACE_STRIP_BANDS) * STRIP_HEIGHT_PX;

  for (let y = 0; y < STRIP_HEIGHT_PX; y++) {
    for (let x = 0; x < STRIP_WIDTH_PX; x++) {
      let pixel: RGB;
      if (y < capTop) {
        pixel = [0, 0, 0];
      } else if (y < bodyTop) {
        const grain =
          signedNoise(noise.value(x, y, CAP_GRAIN_PERIOD, CAP_GRAIN_SEED)) * CAP_GRAIN_STRENGTH;
        const base = y - capTop < CAP_HIGHLIGHT_ROWS_PX ? theme.capHighlight : theme.cap;
        pixel = shade(base, 1 + grain);
      } else {
        const v = (y - bodyTop) / (STRIP_HEIGHT_PX - bodyTop);
        const underCap = y - bodyTop < capShadowRows;
        const topShade =
          v < BODY_TOP_SHADOW_REACH
            ? BODY_TOP_SHADOW_FACTOR + (1 - BODY_TOP_SHADOW_FACTOR) * (v / BODY_TOP_SHADOW_REACH)
            : 1;
        const footShade = 1 - (1 - BODY_FOOT_FACTOR) * v;
        const capShadow = underCap ? BODY_TOP_SHADOW_FACTOR : 1;
        const lit = shade(masonry.get(x, bandOffset + y), topShade * footShade * capShadow);
        pixel = theme.finish(lit, v, x, y, noise);
      }
      const index = (y * STRIP_WIDTH_PX + x) * RGB_CHANNELS;
      rgb[index] = pixel[0];
      rgb[index + 1] = pixel[1];
      rgb[index + 2] = pixel[2];
    }
  }
  return { width: STRIP_WIDTH_PX, height: STRIP_HEIGHT_PX, rgb, capTopRow: capTop };
}

const faceStrips = new Map<string, CanvasSurface>();

function faceStripCanvas(themeId: DungeonFloorThemeId, band: number): CanvasSurface {
  const key = `${themeId}|${band}`;
  const cached = faceStrips.get(key);
  if (cached !== undefined) return cached;
  const pixels = paintFaceStrip(themeId, band);
  const canvas = allocCanvas(pixels.width, pixels.height);
  const stripCtx = surfaceContext(canvas);
  const image = stripCtx.createImageData(pixels.width, pixels.height);
  const pixelCount = pixels.width * pixels.height;
  for (let p = 0; p < pixelCount; p++) {
    image.data[p * RGBA_CHANNELS] = pixels.rgb[p * RGB_CHANNELS];
    image.data[p * RGBA_CHANNELS + 1] = pixels.rgb[p * RGB_CHANNELS + 1];
    image.data[p * RGBA_CHANNELS + 2] = pixels.rgb[p * RGB_CHANNELS + 2];
    image.data[p * RGBA_CHANNELS + 3] = ALPHA_MAX;
  }
  stripCtx.putImageData(image, 0, 0);
  faceStrips.set(key, canvas);
  return canvas;
}

/** The face's mid-tone, for the pieces drawn with canvas calls rather than from the strip. */
function faceTone(themeId: DungeonFloorThemeId): RGB {
  return THEMES[themeId].masonry.ramp.mid;
}

// ── composite pieces ───────────────────────────────────────────────────────

/**
 * Sliver tone relative to the face's mid-tone: the end of a wall is turned from
 * the light, so a little darker than the face — but only a little, or a strip this
 * narrow beside a lit floor reads as a shadow on the floor rather than as wall.
 */
const SLIVER_TONE = 0.85;
/** The shadowed line where a sliver or a lip meets the wall top behind it. */
const EDGE_SHADOW_TONE = 0.45;
const EDGE_SHADOW_TILES = 0.04;
/** Jamb return tone relative to the face. */
const JAMB_TONE = 0.45;
/** A back corner's return is in the corner's shadow, darker than an open jamb. */
const RETURN_TONE = 0.55;
/** Course marks down a sliver, as a fraction of the sliver colour. */
const SLIVER_COURSE_TONE = 0.55;
const SLIVER_COURSE_ALPHA = 0.7;
const SLIVER_COURSE_PX = 1;
const LIP_LINE_TONE = 0.35;
/** The brightest top share of the lip, where it catches the light square-on. */
const LIP_HIGHLIGHT_SHARE = 1 / 3;

/**
 * A piece's size in whole pixels, at least one. Edges that land between pixels
 * are smeared by the canvas into a half-tone, and a lit arris smeared that way
 * reads as a grey line instead of a catch of light.
 */
function wholePx(tiles: number, ts: number): number {
  return Math.max(1, Math.round(tiles * ts));
}

/** The edge strip of a vertical piece: its x and width on a side of the tile. */
function edgeStrip(side: Side, width: number, ts: number): number {
  return side === 'west' ? 0 : ts - width;
}

/**
 * A side sliver along the west or east edge of a tile, over `top..bottom`: the
 * end of the wall seen edge-on, a lit arris on the floor side and a shadow line
 * where it meets the wall top.
 */
function drawSliver(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  ts: number,
  side: Side,
  top: number,
  bottom: number,
  tone = SLIVER_TONE,
): void {
  if (bottom <= top) return;
  const theme = THEMES[themeId];
  const sliverColor = shade(faceTone(themeId), tone);
  const width = wholePx(SLIVER_TILES, ts);
  const arris = wholePx(ARRIS_TILES, ts);
  const shadow = wholePx(EDGE_SHADOW_TILES, ts);
  const height = bottom - top;

  ctx.fillStyle = rgba(sliverColor, OPAQUE);
  ctx.fillRect(edgeStrip(side, width, ts), top, width, height);
  ctx.fillStyle = rgba(theme.cap, OPAQUE);
  ctx.fillRect(edgeStrip(side, arris, ts), top, arris, height);
  ctx.fillStyle = rgba(shade(sliverColor, EDGE_SHADOW_TONE), OPAQUE);
  ctx.fillRect(side === 'west' ? width : ts - width - shadow, top, shadow, height);

  // Course marks: the ends of the courses the face is laid in, seen edge-on.
  const coursePitch = ts / theme.masonry.coursesPerTile;
  ctx.fillStyle = rgba(shade(sliverColor, SLIVER_COURSE_TONE), SLIVER_COURSE_ALPHA);
  for (let y = Math.ceil(top / coursePitch) * coursePitch; y < bottom; y += coursePitch) {
    ctx.fillRect(edgeStrip(side, width, ts), y, width, SLIVER_COURSE_PX);
  }
}

/**
 * The cap rim along the top edge of a tile, over `left..right`: what a room sees
 * of its south wall, and the cap a back corner's return wears. `top` is where the
 * rim's lit edge sits.
 */
function drawLip(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  ts: number,
  left: number,
  right: number,
  top = 0,
): void {
  if (right <= left) return;
  const theme = THEMES[themeId];
  const rim = wholePx(LIP_TILES, ts);
  const line = wholePx(LIP_LINE_TILES, ts);
  ctx.fillStyle = rgba(theme.cap, OPAQUE);
  ctx.fillRect(left, top, right - left, rim);
  ctx.fillStyle = rgba(theme.capHighlight, OPAQUE);
  ctx.fillRect(left, top, right - left, Math.max(1, Math.round(rim * LIP_HIGHLIGHT_SHARE)));
  ctx.fillStyle = rgba(shade(theme.cap, LIP_LINE_TONE), OPAQUE);
  ctx.fillRect(left, top + rim, right - left, line);
}

/** Where a face turns away at an open side: a dark return with a lit arris. */
function drawJamb(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  ts: number,
  side: Side,
  top: number,
): void {
  const width = wholePx(JAMB_TILES, ts);
  const arris = wholePx(ARRIS_TILES, ts);
  ctx.fillStyle = rgba(shade(faceTone(themeId), JAMB_TONE), OPAQUE);
  ctx.fillRect(edgeStrip(side, width, ts), top, width, ts - top);
  ctx.fillStyle = rgba(THEMES[themeId].cap, OPAQUE);
  ctx.fillRect(side === 'west' ? width : ts - width - arris, top, arris, ts - top);
}

/**
 * A room's back corner: the side wall's end face rises beside the end of the back
 * wall's face, in the corner's shadow, up to the cap — which wraps over it. Drawn
 * on the tiles diagonal to the face, from `top` (the cap) down.
 */
function drawCornerReturn(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  ts: number,
  side: Side,
  capTop: number | null,
): void {
  const width = wholePx(SLIVER_TILES, ts);
  const top = capTop ?? 0;
  drawSliver(ctx, themeId, ts, side, top, ts, RETURN_TONE);
  if (capTop !== null) {
    const left = edgeStrip(side, width, ts);
    drawLip(ctx, themeId, ts, left, left + width, capTop);
  }
}

/**
 * The rounded turn where a sliver running down one tile meets the lip running
 * along the next, drawn on the tile they both touch only at a corner: a quarter
 * disc of rim about that corner, lit at its centre where the two meet.
 */
function drawRimCorner(ctx: Ctx, themeId: DungeonFloorThemeId, ts: number, side: Side): void {
  const theme = THEMES[themeId];
  const cornerX = side === 'west' ? 0 : ts;
  const radius = wholePx(SLIVER_TILES, ts);
  const sliverColor = shade(faceTone(themeId), SLIVER_TONE);
  const gradient = ctx.createRadialGradient(cornerX, 0, 0, cornerX, 0, radius);
  gradient.addColorStop(0, rgba(theme.cap, OPAQUE));
  gradient.addColorStop(LIP_TILES / SLIVER_TILES, rgba(sliverColor, OPAQUE));
  gradient.addColorStop(1, rgba(shade(sliverColor, EDGE_SHADOW_TONE), OPAQUE));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cornerX, 0);
  ctx.arc(cornerX, 0, radius, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

/** Rounds the outside of a turn where a lip and a sliver meet on one tile. */
function drawRimJoin(ctx: Ctx, themeId: DungeonFloorThemeId, ts: number, side: Side): void {
  const theme = THEMES[themeId];
  const radius = wholePx(SLIVER_TILES, ts);
  const cornerX = side === 'west' ? 0 : ts;
  const gradient = ctx.createRadialGradient(cornerX, 0, 0, cornerX, 0, radius);
  gradient.addColorStop(0, rgba(theme.capHighlight, OPAQUE));
  gradient.addColorStop(1, rgba(theme.cap, OPAQUE));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cornerX, 0);
  ctx.arc(cornerX, 0, radius, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

/**
 * Tone of a one-tile-thick wall's top relative to its cap. A wall that thin is
 * lit from both sides across its whole width, so its top is cap stone catching
 * the light — the rock's own dark top in a strip that narrow, between two lit
 * slivers, reads as a slot cut into the floor rather than as a wall.
 */
const THIN_TOP_TONE = 0.8;
/** Joints between the capstones laid along a thin wall's top, per tile. */
const THIN_TOP_JOINTS_PER_TILE = 2;
const THIN_TOP_JOINT_TONE = 0.55;

/** The top of a wall with floor on both its east and west, from the tile's top to `bottom`. */
function drawThinTop(ctx: Ctx, themeId: DungeonFloorThemeId, ts: number, bottom: number): void {
  if (bottom <= 0) return;
  const topColor = shade(THEMES[themeId].cap, THIN_TOP_TONE);
  ctx.fillStyle = rgba(topColor, OPAQUE);
  ctx.fillRect(0, 0, ts, bottom);
  const jointPitch = ts / THIN_TOP_JOINTS_PER_TILE;
  const line = wholePx(LIP_LINE_TILES, ts);
  ctx.fillStyle = rgba(shade(topColor, THIN_TOP_JOINT_TONE), OPAQUE);
  for (let y = jointPitch; y < bottom; y += jointPitch) {
    ctx.fillRect(0, Math.round(y), ts, line);
  }
}

// ── the composite ──────────────────────────────────────────────────────────

/** Source rows of the strip a face part takes; the upper part starts at its cap. */
function stripRowsFor(part: Exclude<WallFacePart, 'none'>): { top: number; height: number } {
  const capTop = Math.round(WALL_TOP_TILES * TILE_PX);
  if (part === 'upper') return { top: capTop, height: TILE_PX - capTop };
  if (part === 'lower') return { top: TILE_PX, height: TILE_PX };
  return { top: capTop, height: STRIP_HEIGHT_PX - capTop };
}

/** Top of the face (its cap) within a tile, in pixels; everything above it is wall top. */
function faceTopPx(part: WallFacePart, ts: number): number {
  return part === 'upper' ? Math.round(WALL_TOP_TILES * ts) : 0;
}

/**
 * Bounded, and cleared rather than evicted piecemeal: a floor draws on a few
 * hundred distinct entries, so reaching the cap means the cache is holding tiles
 * from a floor that is no longer loaded.
 */
const MAX_COMPOSITES = 2048;
const composites = new Map<string, CanvasSurface>();

function shapeKey(shape: WallShape): string {
  const flags = [
    shape.openN,
    shape.openS,
    shape.openE,
    shape.openW,
    shape.openNE,
    shape.openNW,
    shape.openSE,
    shape.openSW,
    shape.openSE2,
    shape.openSW2,
  ];
  return `${shape.face}|${flags.map((flag) => (flag ? 1 : 0)).join('')}`;
}

/**
 * Where a back corner's return starts on this tile, if it has one: the cap's
 * height on the tile beside the back wall's upper face, the top of the tile beside
 * a squeezed face, and the whole tile beside the foot of a full face.
 */
function cornerReturnTop(
  shape: WallShape,
  side: Side,
  ts: number,
): { readonly capTop: number | null } | null {
  if (shape.face !== 'none') return null;
  const east = side === 'east';
  const openAcross = east ? shape.openE : shape.openW;
  const openBelowAcross = east ? shape.openSE : shape.openSW;
  const openTwoBelowAcross = east ? shape.openSE2 : shape.openSW2;
  const openAboveAcross = east ? shape.openNE : shape.openNW;
  if (openAcross || shape.openS) return null;
  if (openBelowAcross) return { capTop: openAboveAcross ? 0 : null };
  if (openTwoBelowAcross) return { capTop: Math.round(WALL_TOP_TILES * ts) };
  return null;
}

function paintComposite(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  shape: WallShape,
  ts: number,
  column: number,
  band: number,
): void {
  const { face } = shape;
  const faceTop = faceTopPx(face, ts);
  if (face !== 'none') {
    const rows = stripRowsFor(face);
    ctx.drawImage(
      faceStripCanvas(themeId, band),
      column * TILE_PX,
      rows.top,
      TILE_PX,
      rows.height,
      0,
      faceTop,
      ts,
      ts - faceTop,
    );
  }

  const sliverBottom = face === 'none' ? ts : faceTop;
  const showsSliver = face !== 'lower' && face !== 'compressed';
  if (shape.openW && shape.openE && showsSliver) drawThinTop(ctx, themeId, ts, sliverBottom);
  if (shape.openW && showsSliver) drawSliver(ctx, themeId, ts, 'west', 0, sliverBottom);
  if (shape.openE && showsSliver) drawSliver(ctx, themeId, ts, 'east', 0, sliverBottom);
  if (face !== 'none') {
    if (shape.openW) drawJamb(ctx, themeId, ts, 'west', faceTop);
    if (shape.openE) drawJamb(ctx, themeId, ts, 'east', faceTop);
  }

  for (const side of ['west', 'east'] as const) {
    const corner = cornerReturnTop(shape, side, ts);
    if (corner !== null) drawCornerReturn(ctx, themeId, ts, side, corner.capTop);
  }

  if (shape.openN && face !== 'compressed') {
    drawLip(ctx, themeId, ts, 0, ts);
    if (shape.openW) drawRimJoin(ctx, themeId, ts, 'west');
    if (shape.openE) drawRimJoin(ctx, themeId, ts, 'east');
  }
  if (face === 'none' || face === 'upper') {
    if (shape.openNE && !shape.openN && !shape.openE) drawRimCorner(ctx, themeId, ts, 'east');
    if (shape.openNW && !shape.openN && !shape.openW) drawRimCorner(ctx, themeId, ts, 'west');
  }
}

function compositeFor(
  themeId: DungeonFloorThemeId,
  shape: WallShape,
  ts: number,
  column: number,
  band: number,
): CanvasSurface {
  const hasFace = shape.face !== 'none';
  const sliceColumn = hasFace ? column : 0;
  const sliceBand = hasFace ? band : 0;
  const key = `${themeId}|${ts}|${shapeKey(shape)}|${sliceColumn}|${sliceBand}`;
  const cached = composites.get(key);
  if (cached !== undefined) return cached;
  if (composites.size >= MAX_COMPOSITES) composites.clear();
  const size = Math.max(1, Math.ceil(ts));
  const canvas = allocCanvas(size, size);
  paintComposite(surfaceContext(canvas), themeId, shape, ts, sliceColumn, sliceBand);
  composites.set(key, canvas);
  return canvas;
}

// ── the wall top ───────────────────────────────────────────────────────────

/**
 * Tiles of wall-top texture across before it repeats, both ways. Six, so the
 * courses can be a tile and a half deep and still wrap: a course a whole tile
 * deep lines up with the tile grid and the top reads as a second floor.
 */
const TOP_PATCH_TILES = 6;
/**
 * Painted at the game's own pixel size, not the sheets' doubled one, so every
 * seam and pit lands on a whole screen pixel and stays crisp instead of being
 * resampled into a blur.
 */
const TOP_PX_PER_TILE = TILE_SIZE;
const TOP_PATCH_PX = TOP_PATCH_TILES * TOP_PX_PER_TILE;

interface WallTopFinish {
  readonly ramp: Ramp;
  readonly seed: number;
  /** Depth of one course of stone or one poured strip, in pixels; must divide the patch. */
  readonly courseHeightPx: number;
  /** Lengths a unit along a course may take, in pixels. */
  readonly unitLengthsPx: ReadonlyArray<number>;
  /** Spacing of the faint lines the formwork boards left, or 0 for none. */
  readonly boardLinePx: number;
}

/**
 * The flat top of the rock, seen from above. Built from a few crisp shapes — the
 * joints between units, a lit arris along each, the odd pit — on near-flat
 * tones, so it reads as a solid surface at 32 px a tile while staying quiet: it
 * is what the light dies away across. Units are of uneven length in courses that
 * do not match the tile grid, so it reads as wall mass rather than as floor.
 *
 * Floor 1 is capped with big dressed capstones; floor 2 is poured in long strips
 * that still carry their formwork's board marks.
 */
const WALL_TOPS: Readonly<Record<DungeonFloorThemeId, WallTopFinish>> = {
  cellars: {
    ramp: { shadow: [30, 28, 26], mid: [46, 43, 39], light: [54, 50, 45], accent: [62, 57, 51] },
    seed: 0x7a11c3,
    courseHeightPx: 48,
    unitLengthsPx: [40, 56, 72, 88],
    boardLinePx: 0,
  },
  service_level: {
    ramp: { shadow: [29, 32, 33], mid: [44, 48, 49], light: [52, 56, 57], accent: [60, 64, 65] },
    seed: 0x7a11c4,
    courseHeightPx: 96,
    unitLengthsPx: [80, 112, 144],
    boardLinePx: 8,
  },
};

/** How far one unit's tone may sit from another's, either way, as a share of the ramp. */
const TOP_UNIT_TONE_SPREAD = 0.18;
const TOP_TONE_CENTRE = 0.5;
const TOP_JOINT_TONE = 0.62;
/** The lit arris along a unit's top and left edges, where the light from above catches it. */
const TOP_ARRIS_TONE = 1.1;
const TOP_BOARD_LINE_TONE = 0.95;
/** Pits are 2 x 2 pixel cells: big enough to read as a shape, not as grain. */
const TOP_PIT_CELL_PX = 2;
const TOP_PIT_CHANCE = 0.015;
const TOP_PIT_TONE = 0.72;
const TOP_FLECK_CHANCE = 0.012;
const TOP_FLECK_TONE = 1.12;
const TOP_UNIT_SALT = 1;
const TOP_PIT_SALT = 2;
const TOP_CUT_SALT = 3;
/** The courses start part-way down a tile, so no joint runs along a tile edge. */
const TOP_COURSE_PHASE_PX = 11;

/**
 * Where each course's units start along it, in pixels, wrapping at the patch.
 * Lengths are drawn from the finish's list; the last unit takes what is left,
 * merged into the one before when that would be shorter than any listed length.
 */
function courseCuts(finish: WallTopFinish, course: number): number[] {
  const shortest = Math.min(...finish.unitLengthsPx);
  const start = Math.floor(hashLattice(course, 0, finish.seed + TOP_CUT_SALT) * shortest);
  const cuts = [start];
  let position = start;
  for (let unit = 1; ; unit++) {
    const pick = hashLattice(course, unit, finish.seed + TOP_CUT_SALT);
    const length = finish.unitLengthsPx[Math.floor(pick * finish.unitLengthsPx.length)] ?? shortest;
    if (position + length > start + TOP_PATCH_PX - shortest) break;
    position += length;
    cuts.push(position);
  }
  return cuts.map((cut) => positiveMod(cut, TOP_PATCH_PX)).sort((a, b) => a - b);
}

function paintWallTop(themeId: DungeonFloorThemeId): Surface {
  const finish = WALL_TOPS[themeId];
  const surface = new Surface(TOP_PATCH_PX);
  const courses = TOP_PATCH_PX / finish.courseHeightPx;
  const cutsByCourse = Array.from({ length: courses }, (_, course) => courseCuts(finish, course));
  surface.fill((x, rawY) => {
    const y = rawY + TOP_COURSE_PHASE_PX;
    const course = positiveMod(Math.floor(y / finish.courseHeightPx), courses);
    const localY = positiveMod(y, finish.courseHeightPx);
    const cuts = cutsByCourse[course] ?? [];
    let unit = cuts.length - 1;
    for (let index = 0; index < cuts.length; index++) {
      if ((cuts[index] ?? 0) <= x) unit = index;
    }
    const localX = positiveMod(x - (cuts[unit] ?? 0), TOP_PATCH_PX);

    const unitTone = signedNoise(hashLattice(unit, course, finish.seed + TOP_UNIT_SALT));
    let pixel = sampleRamp(finish.ramp, TOP_TONE_CENTRE + unitTone * TOP_UNIT_TONE_SPREAD);

    if (localX === 0 || localY === 0) return shade(pixel, TOP_JOINT_TONE);
    if (localX === 1 || localY === 1) pixel = shade(pixel, TOP_ARRIS_TONE);
    else if (finish.boardLinePx > 0 && localY % finish.boardLinePx === 0) {
      pixel = shade(pixel, TOP_BOARD_LINE_TONE);
    }

    const pitRoll = hashLattice(
      Math.floor(x / TOP_PIT_CELL_PX),
      Math.floor(rawY / TOP_PIT_CELL_PX),
      finish.seed + TOP_PIT_SALT,
    );
    if (pitRoll < TOP_PIT_CHANCE) return shade(pixel, TOP_PIT_TONE);
    if (pitRoll < TOP_PIT_CHANCE + TOP_FLECK_CHANCE) return shade(pixel, TOP_FLECK_TONE);
    return pixel;
  });
  return surface;
}

const wallTopCanvases = new Map<DungeonFloorThemeId, CanvasSurface>();

function wallTopCanvas(themeId: DungeonFloorThemeId): CanvasSurface {
  const cached = wallTopCanvases.get(themeId);
  if (cached !== undefined) return cached;
  const surface = paintWallTop(themeId);
  const canvas = allocCanvas(TOP_PATCH_PX, TOP_PATCH_PX);
  const topCtx = surfaceContext(canvas);
  const image = topCtx.createImageData(TOP_PATCH_PX, TOP_PATCH_PX);
  image.data.set(surface.toRgba());
  topCtx.putImageData(image, 0, 0);
  wallTopCanvases.set(themeId, canvas);
  return canvas;
}

// ── the fade into shadow ───────────────────────────────────────────────────

/** Light samples are rounded to this fraction of a tile before keying the cache. */
const LIGHT_KEY_STEP = 1 / 16;
const MAX_SHADOWS = 2048;
const shadows = new Map<string, CanvasSurface>();

/**
 * The darkness over one tile, as black of varying alpha: distance to lit space
 * interpolated between the tile's light samples, then eased. Interpolating the
 * distance rather than the darkness keeps the curve's shape inside the tile.
 */
function shadowFor(light: Float32Array, ts: number): CanvasSurface {
  const quantised = Array.from(light, (sample) => Math.round(sample / LIGHT_KEY_STEP));
  // Painted from the rounded values, so every tile sharing a key gets exactly the
  // shadow that key describes rather than whichever tile asked first.
  const samples = quantised.map((steps) => steps * LIGHT_KEY_STEP);
  const key = `${ts}|${quantised.join(',')}`;
  const cached = shadows.get(key);
  if (cached !== undefined) return cached;
  if (shadows.size >= MAX_SHADOWS) shadows.clear();

  const size = Math.max(1, Math.ceil(ts));
  const canvas = allocCanvas(size, size);
  const shadowCtx = surfaceContext(canvas);
  const image = shadowCtx.createImageData(size, size);
  const cells = WALL_LIGHT_SAMPLES - 1;
  for (let py = 0; py < size; py++) {
    const v = ((py + PIXEL_CENTRE) / size) * cells;
    const row = Math.min(cells - 1, Math.floor(v));
    const fy = v - row;
    for (let px = 0; px < size; px++) {
      const u = ((px + PIXEL_CENTRE) / size) * cells;
      const col = Math.min(cells - 1, Math.floor(u));
      const fx = u - col;
      const at = (i: number, j: number): number => samples[j * WALL_LIGHT_SAMPLES + i];
      const top = at(col, row) + (at(col + 1, row) - at(col, row)) * fx;
      const bottom = at(col, row + 1) + (at(col + 1, row + 1) - at(col, row + 1)) * fx;
      const distance = top + (bottom - top) * fy;
      const index = (py * size + px) * RGBA_CHANNELS;
      image.data[index + RGBA_CHANNELS - 1] = Math.round(ALPHA_MAX * wallDarknessAt(distance));
    }
  }
  shadowCtx.putImageData(image, 0, 0);
  shadows.set(key, canvas);
  return canvas;
}

/** A pixel is sampled at its centre. */
const PIXEL_CENTRE = 0.5;

/**
 * The row a face's masonry and dressing are keyed on: its lower tile's, so the
 * two halves of one face agree. A tile with no face keys on its own row.
 */
function faceRowOf(shape: WallShape, ty: number): number {
  return shape.face === 'upper' ? ty + 1 : ty;
}

// ── entry point ────────────────────────────────────────────────────────────

/** Everything a lit wall tile is drawn from. */
export interface LitWallTile {
  readonly shape: WallShape;
  /** Distances to lit space at the tile's sample points; see `wallTileLightSamples`. */
  readonly light: Float32Array;
  /** What the face may carry here; see `wallDressingAt`. */
  readonly dressing: WallDressingSet;
  /** The wall tiles either side, for fittings that run along a face; null where open. */
  readonly west: NeighbourFace | null;
  readonly east: NeighbourFace | null;
  readonly tx: number;
  readonly ty: number;
}

/**
 * Draws one dungeon wall tile: the wall top, the face, sliver, rim or corner its
 * shape shows, its dressing, then the fall into shadow. A tile wholly beyond the
 * light (`null`) is pure black.
 */
export function drawDungeonWallTile(
  ctx: Ctx,
  themeId: DungeonFloorThemeId,
  tile: LitWallTile | null,
  sx: number,
  sy: number,
  ts: number,
): void {
  if (tile === null) {
    ctx.fillStyle = MASS_COLOR;
    ctx.fillRect(sx, sy, ts, ts);
    return;
  }
  const { shape, light, dressing, west, east, tx, ty } = tile;
  const column = positiveMod(tx, FACE_STRIP_COLUMNS);
  const band = positiveMod(faceRowOf(shape, ty), FACE_STRIP_BANDS);
  // Unsmoothed, because a smoothed blit into a scaled context samples past the
  // source's edge and leaves a faint seam between every pair of wall tiles.
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    wallTopCanvas(themeId),
    positiveMod(tx, TOP_PATCH_TILES) * TOP_PX_PER_TILE,
    positiveMod(ty, TOP_PATCH_TILES) * TOP_PX_PER_TILE,
    TOP_PX_PER_TILE,
    TOP_PX_PER_TILE,
    sx,
    sy,
    ts,
    ts,
  );
  ctx.drawImage(compositeFor(themeId, shape, ts, column, band), sx, sy, ts, ts);
  drawDressing(ctx, shape, faceRowOf(shape, ty), sx, sy, ts, tx, dressing, west, east);
  ctx.drawImage(shadowFor(light, ts), sx, sy, ts, ts);
  ctx.imageSmoothingEnabled = smoothing;
}

/** Mean luminance of a floor's face — cap and body, not the rows above the cap — for the floor sweep. */
export function faceMeanLuminance(themeId: DungeonFloorThemeId): number {
  const LUMA_RED = 0.2126;
  const LUMA_GREEN = 0.7152;
  const LUMA_BLUE = 0.0722;
  let total = 0;
  let samples = 0;
  for (let band = 0; band < FACE_STRIP_BANDS; band++) {
    const strip = paintFaceStrip(themeId, band);
    for (let y = strip.capTopRow; y < strip.height; y++) {
      for (let x = 0; x < strip.width; x++) {
        const index = (y * strip.width + x) * RGB_CHANNELS;
        total +=
          LUMA_RED * strip.rgb[index] +
          LUMA_GREEN * strip.rgb[index + 1] +
          LUMA_BLUE * strip.rgb[index + 2];
        samples++;
      }
    }
  }
  return samples === 0 ? 0 : total / samples;
}
