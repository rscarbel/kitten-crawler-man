/**
 * The overworld's macro field: every broad light-and-colour effect on the
 * wilderness ground, folded into one RGBA sample per tile corner.
 *
 * Each effect is a source-over layer, `dest·(1−a) + colour·a`, and any stack of
 * those composes into a single layer of the same form. So the whole stack is
 * folded here, in plain arithmetic, once per map, and the bake draws the result
 * over the ground with one smoothly upscaled blit per tile. Adding an effect is
 * adding a layer to `MACRO_LAYERS`; the bake does not change.
 *
 * Pure: no canvas, so a headless gate can read exactly what the renderer draws.
 *
 * **Built places stay level.** Every layer derived from the landform is scaled
 * by a level mask that is 0 over the town's wall ring, Briar Hollow's
 * footprint, the circus lot and every camp, and rises to 1 a few tiles outside
 * them. Where the mask is 0 the field is the floor's periodic world tone and
 * nothing else, so those places draw exactly as the floor's other ground does,
 * with no trace of the landform.
 */

import { mulberry32, subSeed } from '../../sprites/person/rng';
import { LOWLAND_MAX, MEADOW_MAX, NoiseOctave, smoothstepUnit } from './elevation';
import type { OverworldTerrain } from '../tiles/overworldTerrainRegistry';

/** Samples outside the covered corners on every side, so an upscale never clamps at the edge. */
export const MACRO_MARGIN_SAMPLES = 1;

const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;

/**
 * A tile's corner sits half a tile up and left of its centre, and every
 * landform query is asked in tile-centre coordinates.
 */
const CORNER_TO_CENTRE_OFFSET = -0.5;

// ---------------------------------------------------------------------------
// Level mask
// ---------------------------------------------------------------------------

/**
 * How far past a level place's outermost tile *centre* its corners reach: the
 * far corner of a tile is half a diagonal from its centre. Holding the mask at
 * 0 out to here is what makes every corner of every tile inside the place
 * exactly 0.
 */
const LEVEL_HOLD_TILES = Math.SQRT1_2;
/** Tiles over which the landform fades back in around a level place. */
const LEVEL_FADE_TILES = 4;

// ---------------------------------------------------------------------------
// World tone
// ---------------------------------------------------------------------------

/**
 * The world tone outdoors: the same broad, darkening-only brightness drift the
 * floor's periodic tone fields give every other floor, and at the same depth,
 * but sampled over the finite map rather than wrapped, so it never repeats.
 *
 * Two independent fields darken in series, each `1 - sqrt(1 - depth)` deep,
 * which keeps the extremes rare the way the periodic pair does; one field
 * normalised to the full depth would spend far more of the map at either end.
 */
const WORLD_TONE_DEPTH = 0.12;
const WORLD_TONE_FIELD_DEPTH = 1 - Math.sqrt(1 - WORLD_TONE_DEPTH);
/**
 * Lattice spacing of each field's coarsest octave, in tiles: the spacings of
 * the periodic fields, so the outdoor tone has the same grain as the tone it
 * hands over to at the level places.
 */
const FIRST_TONE_FIELD_SPACING_TILES = 13.5;
const SECOND_TONE_FIELD_SPACING_TILES = 16;
const WORLD_TONE_FIELD_SPACINGS_TILES: readonly number[] = [
  FIRST_TONE_FIELD_SPACING_TILES,
  SECOND_TONE_FIELD_SPACING_TILES,
];
/** Octave weights, coarsest first, as the periodic fields weight theirs; each finer octave halves the spacing. */
const COARSE_TONE_OCTAVE_WEIGHT = 0.62;
const MID_TONE_OCTAVE_WEIGHT = 0.26;
const FINE_TONE_OCTAVE_WEIGHT = 0.12;
const WORLD_TONE_OCTAVE_WEIGHTS: readonly number[] = [
  COARSE_TONE_OCTAVE_WEIGHT,
  MID_TONE_OCTAVE_WEIGHT,
  FINE_TONE_OCTAVE_WEIGHT,
];
const WORLD_TONE_OCTAVE_SPACING_DIVISOR = 2;
const WORLD_TONE_SEED_SALT = 7301;

// ---------------------------------------------------------------------------
// Hillshade
// ---------------------------------------------------------------------------

/**
 * The sun, toward the viewer's upper left and well up the sky. The cliff
 * ledge's lit top lip, the boulders, the mineable rocks and the trees are all
 * lit from here; a hillshade from any other side would make every slope read
 * inverted against the ledges and rocks standing on it.
 */
const SUN_RAW = { x: -0.55, y: -0.72, z: 0.62 } as const;
const SUN_LENGTH = Math.hypot(SUN_RAW.x, SUN_RAW.y, SUN_RAW.z);
const SUN = { x: SUN_RAW.x / SUN_LENGTH, y: SUN_RAW.y / SUN_LENGTH, z: SUN_RAW.z / SUN_LENGTH };

/**
 * Tiles of horizontal distance per unit of normalised elevation. The field
 * spans 0..1 over features about a hundred tiles wide, so its true slopes are a
 * fraction of a degree; this is the exaggeration that makes them read.
 */
const RELIEF_EXAGGERATION_TILES = 70;
/**
 * Brightness swing either way at full slope. The soft clamp below approaches it
 * and never passes it, so a ridge flank shades rather than going black.
 */
const HILLSHADE_AMPLITUDE = 0.1;
/** A slope is read across the samples either side of the one being shaded. */
const CENTRAL_DIFFERENCE_SPAN_TILES = 2;
/** How quickly the shading approaches its amplitude as a slope steepens. */
const HILLSHADE_RESPONSE = 0.9;
/**
 * A white layer at alpha `a` lifts a mid-dark ground by far more than a black
 * one at the same alpha darkens it, so the lit side is scaled down to make a
 * sunward slope as much brighter as a lee slope is darker.
 */
const SUNLIT_ALPHA_SCALE = 0.75;
/**
 * Warm light on the sunward slopes. The lee slopes simply darken: a tinted
 * shade greys the grass, and a whole hillside of it reads as mud.
 */
const SUNLIT_COLOUR = { r: 255, g: 240, b: 190 } as const;
const SHADE_COLOUR = { r: 0, g: 0, b: 0 } as const;

/**
 * Shading-only micro-relief: hummocks and swales so a meadow is never a
 * perfect plane. Added to the height the hillshade reads and to nothing else —
 * the bands, rivers and cliffs are placed from the plain field, and this
 * octave's seed is a sub-seed of the elevation seed that no placement pass ever
 * draws from.
 */
const MICRO_RELIEF_OCTAVES: ReadonlyArray<{ periodTiles: number; amplitude: number }> = [
  { periodTiles: 9, amplitude: 0.022 },
  { periodTiles: 5, amplitude: 0.011 },
];
const MICRO_RELIEF_SEED_SALT = 7311;
/** Centre of a noise octave's 0..1 range, so micro-relief raises as much as it lowers. */
const NOISE_MIDPOINT = 0.5;

// ---------------------------------------------------------------------------
// Cavity
// ---------------------------------------------------------------------------

/**
 * Radius of each box-blur pass the cavity compares the ground against. Two
 * passes of radius 3 approximate a smooth average over about six tiles.
 */
const CAVITY_BLUR_RADIUS_TILES = 3;
const CAVITY_BLUR_PASSES = 2;
/** The most a basin darkens. */
const CAVITY_MAX_DARKENING = 0.06;
/** Elevation below the neighbourhood average at which a basin reaches most of its darkening. */
const CAVITY_RESPONSE = 60;

// ---------------------------------------------------------------------------
// Mid-scale hue
// ---------------------------------------------------------------------------

/**
 * A faint drift between yellow-green and blue-green a few tiles across: the
 * scale between the grass patch and the world tone, where any repetition the
 * patch has left would otherwise show. Hue rather than brightness, because
 * brightness at this scale reads as lumps in the ground.
 */
const HUE_OCTAVES: ReadonlyArray<{ periodTiles: number; weight: number }> = [
  { periodTiles: 5, weight: 0.75 },
  { periodTiles: 9, weight: 0.25 },
];
/**
 * Stretches the octave sum, which crowds toward its midpoint, so a fair share
 * of the ground reaches the full shift; the extremes are clamped.
 */
const HUE_STRETCH = 3;
const HUE_MAX_ALPHA = 0.06;
const HUE_SEED_SALT = 7321;
const YELLOW_GREEN = { r: 200, g: 196, b: 64 } as const;
const BLUE_GREEN = { r: 30, g: 112, b: 110 } as const;

// ---------------------------------------------------------------------------
// Lush and dry ground
// ---------------------------------------------------------------------------

/**
 * Where the ground holds water the grass grows deep and cool; where it sheds
 * it — crests, high ground, slopes baking in the sun — it grows thin and
 * warm. This is the tint that says so: the one broad effect besides the light
 * that follows the landform, and the one that still shows where the hills are
 * when the light is flat.
 *
 * Each influence is 0..1 and they add; the lush sum minus the dry sum is the
 * tint, clamped to one full shift either way.
 */
const LUSH_MAX_ALPHA = 0.08;
const DRY_MAX_ALPHA = 0.08;
const LUSH_COLOUR = { r: 22, g: 78, b: 46 } as const;
const DRY_COLOUR = { r: 206, g: 172, b: 92 } as const;
/** Box-blur radius and passes that spread a riverbank's wetness a few tiles into the meadow. */
const WATER_REACH_BLUR_RADIUS_TILES = 4;
const WATER_REACH_BLUR_PASSES = 2;
/** Stretches the blurred water presence so ground beside a channel reaches the full lush shift. */
const WATER_REACH_GAIN = 3;
/**
 * Low ground greens from a little above the lowland's ceiling, so the lower
 * meadow already shares it, and is fully lush this far further down, in
 * normalised elevation.
 */
const LOW_GROUND_LEAD = 0.04;
const LOW_GROUND_SPAN = 0.12;
/** Ground climbing this far above the meadow's ceiling is fully dry. */
const HIGH_GROUND_SPAN = 0.16;
/** How far the meadow's ceiling the drying starts below, so the upper meadow already thins. */
const HIGH_GROUND_LEAD = 0.06;
const WATER_LUSH_WEIGHT = 0.75;
const LOW_GROUND_LUSH_WEIGHT = 0.5;
const BASIN_LUSH_WEIGHT = 0.55;
const HIGH_GROUND_DRY_WEIGHT = 0.55;
const CREST_DRY_WEIGHT = 0.5;
const SUNWARD_DRY_WEIGHT = 0.5;
/** Stretches the summed influences, which rarely all agree, so a fair share of the land reaches the full shift. */
const LUSHNESS_GAIN = 1.4;
/** Elevation above the neighbourhood average at which a crest is fully dry. */
const CREST_RESPONSE = 60;
/**
 * Brightening, relative to flat ground, at which a sunward slope is fully dry;
 * read from the plain landform, so the micro-relief's hummocks do not speckle it.
 */
const SUNWARD_FULL_DRY = 0.35;

// ---------------------------------------------------------------------------
// Cliff crests
// ---------------------------------------------------------------------------

/**
 * The ground at the top of a ledge catches the light the face below it is
 * turned away from. Brightest along the ledge's top edge and fading over the
 * tile above it; the ledge's own lit lip is drawn over the top of that.
 */
const CREST_EDGE_LIGHT = 1;
const CREST_UPPER_LIGHT = 0.35;
const CREST_MAX_ALPHA = 0.1;

// ---------------------------------------------------------------------------
// Riverbanks
// ---------------------------------------------------------------------------

/**
 * How wet a corner's bank reads, by how far the nearest water is: the
 * waterline itself, then the corners of the first tile up the bank, then the
 * second. The upscale between corners turns these into a soft band.
 */
const WATERLINE_WETNESS = 1;
const FIRST_ROW_WETNESS = 0.4;
const SECOND_ROW_WETNESS = 0.15;
const DAMP_BANK_MAX_ALPHA = 0.16;
/** Wet soil: darker, and a little toward the brown of the mud under it. */
const DAMP_BANK_COLOUR = { r: 24, g: 28, b: 12 } as const;

/** The mud margin is narrower than the damp: the waterline and a little up the first tile. */
const WATERLINE_MUD = 1;
const FIRST_ROW_MUD = 0.25;
const BANK_MUD_MAX_ALPHA = 0.24;
const BANK_MUD_COLOUR = { r: 98, g: 80, b: 50 } as const;

/** Tile rows up the bank the wetness is measured over; anything farther is dry. */
const BANK_ROWS_MEASURED = 2;
const FIRST_BANK_ROW = 1;
const SECOND_BANK_ROW = 2;
/** The four tiles meeting at a corner. */
const TILES_AT_A_CORNER = 4;

/**
 * Each map tile's distance from the river in tiles, counting diagonals as
 * one: 0 on a channel tile, `BANK_ROWS_MEASURED + 1` beyond the rows measured.
 */
function tilesFromChannel(spec: MacroFieldSpec): Uint8Array {
  const { cols, rows } = spec;
  const beyond = BANK_ROWS_MEASURED + 1;
  const distance = new Uint8Array(cols * rows).fill(beyond);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (spec.isChannel(tx, ty)) distance[ty * cols + tx] = 0;
    }
  }
  for (let row = 1; row <= BANK_ROWS_MEASURED; row++) {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        if (distance[ty * cols + tx] <= row) continue;
        let touchesPreviousRow = false;
        for (let dy = -1; dy <= 1 && !touchesPreviousRow; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            if (distance[ny * cols + nx] === row - 1) {
              touchesPreviousRow = true;
              break;
            }
          }
        }
        if (touchesPreviousRow) distance[ty * cols + tx] = row;
      }
    }
  }
  return distance;
}

/** Per-corner wetness and mud along the river's banks. */
function buildBankGrids(
  spec: MacroFieldSpec,
  spanX: number,
  spanY: number,
): { bankWetness: Float32Array; bankMud: Float32Array } {
  const { cols, rows } = spec;
  const distance = tilesFromChannel(spec);
  const beyond = BANK_ROWS_MEASURED + 1;
  const distanceAt = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= cols || ty >= rows ? beyond : distance[ty * cols + tx];
  const bankWetness = new Float32Array(spanX * spanY);
  const bankMud = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    const cornerY = j - MACRO_MARGIN_SAMPLES;
    for (let i = 0; i < spanX; i++) {
      const cornerX = i - MACRO_MARGIN_SAMPLES;
      let channelTiles = 0;
      let nearestDry = beyond;
      let lowland = false;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = cornerX + dx;
          const ty = cornerY + dy;
          const tileDistance = distanceAt(tx, ty);
          if (tileDistance === 0) {
            channelTiles++;
            continue;
          }
          nearestDry = Math.min(nearestDry, tileDistance);
          if (spec.isLowland(tx, ty)) lowland = true;
        }
      }
      if (channelTiles === TILES_AT_A_CORNER) continue;
      const index = j * spanX + i;
      const onWaterline = channelTiles > 0;
      if (onWaterline) {
        bankWetness[index] = WATERLINE_WETNESS;
      } else if (nearestDry === FIRST_BANK_ROW) {
        bankWetness[index] = FIRST_ROW_WETNESS;
      } else if (nearestDry === SECOND_BANK_ROW) {
        bankWetness[index] = SECOND_ROW_WETNESS;
      }
      if (!lowland) continue;
      if (onWaterline) bankMud[index] = WATERLINE_MUD;
      else if (nearestDry === FIRST_BANK_ROW) bankMud[index] = FIRST_ROW_MUD;
    }
  }
  return { bankWetness, bankMud };
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/** Per-sample grids every layer reads. One sample per tile corner, with the margin. */
export interface MacroSampleGrids {
  /** Samples per row, and rows. */
  readonly spanX: number;
  readonly spanY: number;
  /** Plain elevation plus micro-relief: the height the light falls on. */
  readonly shadingHeight: Float32Array;
  /** How far the plain elevation sits below its neighbourhood average; 0 on crests. */
  readonly basinDepth: Float32Array;
  /** 0 over every level place, rising to 1 clear of them. */
  readonly levelMask: Float32Array;
  /** 0 at a corner with open water on every side, 1 anywhere the ground shows. */
  readonly dryMask: Float32Array;
  /** Darkening of the non-periodic outdoor tone. */
  readonly worldTone: Float32Array;
  /** Darkening of the floor's periodic tone, where any level place is near enough to need it. */
  readonly periodicTone: Float32Array;
  /** -1 for the full blue-green shift, 1 for the full yellow-green one. */
  readonly hueBias: Float32Array;
  /** 1 along the waterline, falling to 0 a tile or so up the bank; 0 on open water. */
  readonly bankWetness: Float32Array;
  /** The narrower mud margin along a lowland waterline, 0..1; 0 on upland banks. */
  readonly bankMud: Float32Array;
  /** 1 for the full lush shift, -1 for the full dry one. */
  readonly lushness: Float32Array;
  /** 1 along the top edge of a ledge, fading up the tile above; 0 elsewhere. */
  readonly crestLight: Float32Array;
}

/** What one layer lays over the ground at one sample. Reused across samples. */
export interface LayerPaint {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export interface MacroLayer {
  /**
   * Derived from the landform, and so scaled by the level mask: flat, neutral
   * ground over the built places whatever the landform does there.
   */
  readonly fromLandform: boolean;
  paint(grids: MacroSampleGrids, index: number, out: LayerPaint): void;
}

function setBlack(out: LayerPaint, alpha: number): void {
  out.r = 0;
  out.g = 0;
  out.b = 0;
  out.alpha = alpha;
}

/**
 * The tone every ground tile takes. Over the level places it is the floor's
 * periodic tone, exactly, and it hands over to the non-periodic tone across the
 * level mask's fade, so there is no seam where one meets the other.
 */
const worldToneLayer: MacroLayer = {
  fromLandform: false,
  paint(grids, index, out) {
    const outdoor = grids.levelMask[index];
    const alpha =
      grids.periodicTone[index] + (grids.worldTone[index] - grids.periodicTone[index]) * outdoor;
    setBlack(out, alpha);
  },
};

function heightAt(grids: MacroSampleGrids, i: number, j: number): number {
  const ci = clampTo(i, 0, grids.spanX - 1);
  const cj = clampTo(j, 0, grids.spanY - 1);
  return grids.shadingHeight[cj * grids.spanX + ci];
}

/**
 * Lambert shading of the exaggerated slope, relative to flat ground,
 * soft-clamped. Not on open water: a river's surface is level whatever the
 * valley it runs down, and a lit slope across it reads as haze on the water.
 */
const hillshadeLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    const i = index % grids.spanX;
    const j = Math.floor(index / grids.spanX);
    const riseX = heightAt(grids, i + 1, j) - heightAt(grids, i - 1, j);
    const riseY = heightAt(grids, i, j + 1) - heightAt(grids, i, j - 1);
    const slopeX = (riseX / CENTRAL_DIFFERENCE_SPAN_TILES) * RELIEF_EXAGGERATION_TILES;
    const slopeY = (riseY / CENTRAL_DIFFERENCE_SPAN_TILES) * RELIEF_EXAGGERATION_TILES;
    const normalLength = Math.hypot(slopeX, slopeY, 1);
    const lambert = Math.max(0, (-slopeX * SUN.x - slopeY * SUN.y + SUN.z) / normalLength);
    const relativeToFlat = lambert / SUN.z - 1;
    const shade =
      HILLSHADE_AMPLITUDE * Math.tanh((relativeToFlat * HILLSHADE_RESPONSE) / HILLSHADE_AMPLITUDE);
    const sunlit = shade > 0;
    const colour = sunlit ? SUNLIT_COLOUR : SHADE_COLOUR;
    out.r = colour.r;
    out.g = colour.g;
    out.b = colour.b;
    const strength = sunlit ? shade * SUNLIT_ALPHA_SCALE : -shade;
    out.alpha = strength * grids.dryMask[index];
  },
};

/** Valley floors and hollows sit a little darker, whatever the sun's angle. */
const cavityLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    const darkening = CAVITY_MAX_DARKENING * Math.tanh(grids.basinDepth[index] * CAVITY_RESPONSE);
    setBlack(out, darkening);
  },
};

/** Not on open water, for the reason the hillshade is not. */
const hueLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    const bias = grids.hueBias[index];
    const colour = bias > 0 ? YELLOW_GREEN : BLUE_GREEN;
    out.r = colour.r;
    out.g = colour.g;
    out.b = colour.b;
    out.alpha = Math.abs(bias) * HUE_MAX_ALPHA * grids.dryMask[index];
  },
};

/** Deep cool grass where the ground holds water, thin warm grass where it sheds it. Not on open water. */
const lushDryLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    const lushness = grids.lushness[index];
    const lush = lushness > 0;
    const colour = lush ? LUSH_COLOUR : DRY_COLOUR;
    out.r = colour.r;
    out.g = colour.g;
    out.b = colour.b;
    const maxAlpha = lush ? LUSH_MAX_ALPHA : DRY_MAX_ALPHA;
    out.alpha = Math.abs(lushness) * maxAlpha * grids.dryMask[index];
  },
};

/** The lit ground along the top of a ledge, in the warm light of the sunward slopes. */
const crestLightLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    out.r = SUNLIT_COLOUR.r;
    out.g = SUNLIT_COLOUR.g;
    out.b = SUNLIT_COLOUR.b;
    out.alpha = grids.crestLight[index] * CREST_MAX_ALPHA;
  },
};

/** A narrow margin of silt and mud where a lowland bank meets the water. */
const bankMudLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    out.r = BANK_MUD_COLOUR.r;
    out.g = BANK_MUD_COLOUR.g;
    out.b = BANK_MUD_COLOUR.b;
    out.alpha = grids.bankMud[index] * BANK_MUD_MAX_ALPHA;
  },
};

/** Ground the river keeps wet: a soft dark band about a tile wide along every bank. */
const dampBankLayer: MacroLayer = {
  fromLandform: true,
  paint(grids, index, out) {
    out.r = DAMP_BANK_COLOUR.r;
    out.g = DAMP_BANK_COLOUR.g;
    out.b = DAMP_BANK_COLOUR.b;
    out.alpha = grids.bankWetness[index] * DAMP_BANK_MAX_ALPHA;
  },
};

/** Folded in order, lowest first. */
const MACRO_LAYERS: readonly MacroLayer[] = [
  worldToneLayer,
  hillshadeLayer,
  cavityLayer,
  hueLayer,
  bankMudLayer,
  dampBankLayer,
  lushDryLayer,
  crestLightLayer,
];

export interface MacroFieldSpec {
  readonly terrain: OverworldTerrain;
  /** Map size in tiles. Landform queries past it read its edge. */
  readonly cols: number;
  readonly rows: number;
  /** Tiles the field covers, at least the map; the corners cover one more on each axis. */
  readonly coverCols: number;
  readonly coverRows: number;
  /** The floor art's tone seed, so the outdoor tone varies with the floor's look as the periodic one does. */
  readonly toneSeed: number;
  /**
   * Darkening of the floor's periodic tone at a tile corner. Only asked near a
   * level place, where the field must reproduce it exactly.
   */
  readonly periodicToneAt: (cornerX: number, cornerY: number) => number;
  /** Whether the tile at (tx, ty) is open water — the river or a bridge over it. */
  readonly isWater: (tx: number, ty: number) => boolean;
  /** Whether the tile at (tx, ty)'s ground is the river itself; a deck's abutments are bank. */
  readonly isChannel: (tx: number, ty: number) => boolean;
  /** Whether the tile at (tx, ty) is lowland meadow, where a bank is soft enough to be mud. */
  readonly isLowland: (tx: number, ty: number) => boolean;
  /** Whether the tile at (tx, ty) is a cliff ledge. */
  readonly isLedge: (tx: number, ty: number) => boolean;
}

export interface MacroField {
  /** Samples per row; sample `(i, j)` is tile corner `(i - MACRO_MARGIN_SAMPLES, j - MACRO_MARGIN_SAMPLES)`. */
  readonly spanX: number;
  readonly spanY: number;
  /** Straight-alpha RGBA, ready for `ImageData`. */
  readonly rgba: Uint8ClampedArray;
  /** The combined opacity of the landform layers alone, per sample. */
  readonly landformAlpha: Float32Array;
  readonly levelTiles: LevelTileMap;
}

/** Which covered tiles have a level mask of exactly 0 on all four corners, one byte per tile. */
export class LevelTileMap {
  private readonly flags: Uint8Array;
  private readonly cols: number;
  private readonly rows: number;

  constructor(flags: Uint8Array, cols: number, rows: number) {
    this.flags = flags;
    this.cols = cols;
    this.rows = rows;
  }

  isLevel(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
    return this.flags[ty * this.cols + tx] === 1;
  }
}

/**
 * Flags each covered tile whose four corners are all exactly level. Kept
 * instead of the mask itself: the bake needs only this, and it is a quarter
 * of the mask's size.
 */
function levelTileMap(
  levelMask: Float32Array,
  spanX: number,
  coverCols: number,
  coverRows: number,
): LevelTileMap {
  const sampleAt = (cornerX: number, cornerY: number): number =>
    (cornerY + MACRO_MARGIN_SAMPLES) * spanX + cornerX + MACRO_MARGIN_SAMPLES;
  const flags = new Uint8Array(coverCols * coverRows);
  for (let ty = 0; ty < coverRows; ty++) {
    for (let tx = 0; tx < coverCols; tx++) {
      const level =
        levelMask[sampleAt(tx, ty)] === 0 &&
        levelMask[sampleAt(tx + 1, ty)] === 0 &&
        levelMask[sampleAt(tx, ty + 1)] === 0 &&
        levelMask[sampleAt(tx + 1, ty + 1)] === 0;
      if (level) flags[ty * coverCols + tx] = 1;
    }
  }
  return new LevelTileMap(flags, coverCols, coverRows);
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A level place, as a disc or a rectangle of tile centres. */
type LevelZone =
  | { readonly kind: 'disc'; readonly x: number; readonly y: number; readonly radius: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    };

function levelZones(terrain: OverworldTerrain): LevelZone[] {
  const { wall } = terrain.town;
  const zones: LevelZone[] = [{ kind: 'rect', x: wall.x, y: wall.y, w: wall.w, h: wall.h }];
  for (const shape of terrain.briarHollowKeepOut.shapes) {
    zones.push(
      shape.kind === 'disc'
        ? { kind: 'disc', x: shape.centre.x, y: shape.centre.y, radius: shape.radiusTiles }
        : { kind: 'rect', ...shape.rect },
    );
  }
  for (const disc of [terrain.circus, ...terrain.camps]) {
    zones.push({ kind: 'disc', x: disc.centre.x, y: disc.centre.y, radius: disc.radiusTiles });
  }
  return zones;
}

/** Tiles from the tile-centre position (x, y) to a zone's edge; 0 inside it. */
function zoneDistance(zone: LevelZone, x: number, y: number): number {
  if (zone.kind === 'disc') return Math.max(0, Math.hypot(x - zone.x, y - zone.y) - zone.radius);
  const dx = Math.max(zone.x - x, 0, x - (zone.x + zone.w - 1));
  const dy = Math.max(zone.y - y, 0, y - (zone.y + zone.h - 1));
  return Math.hypot(dx, dy);
}

/** The zone's tile-centre extent: its first and last column and row. */
function zoneExtent(zone: LevelZone): { x0: number; y0: number; x1: number; y1: number } {
  if (zone.kind === 'disc') {
    return {
      x0: zone.x - zone.radius,
      y0: zone.y - zone.radius,
      x1: zone.x + zone.radius,
      y1: zone.y + zone.radius,
    };
  }
  return { x0: zone.x, y0: zone.y, x1: zone.x + zone.w - 1, y1: zone.y + zone.h - 1 };
}

function maskForDistance(distance: number): number {
  const beyondHold = distance - LEVEL_HOLD_TILES;
  if (beyondHold <= 0) return 0;
  if (beyondHold >= LEVEL_FADE_TILES) return 1;
  return smoothstepUnit(beyondHold / LEVEL_FADE_TILES);
}

/**
 * The level mask per sample. Visited zone by zone over each zone's reach
 * rather than sample by sample over every zone, since nearly all of the map is
 * far from every one of them.
 */
function buildLevelMask(
  terrain: OverworldTerrain,
  spanX: number,
  spanY: number,
  positionX: (i: number) => number,
  positionY: (j: number) => number,
): Float32Array {
  const mask = new Float32Array(spanX * spanY).fill(1);
  const reach = LEVEL_HOLD_TILES + LEVEL_FADE_TILES;
  const sampleOf = (position: number) => position - CORNER_TO_CENTRE_OFFSET + MACRO_MARGIN_SAMPLES;
  for (const zone of levelZones(terrain)) {
    const extent = zoneExtent(zone);
    const i0 = Math.max(0, Math.floor(sampleOf(extent.x0 - reach)));
    const i1 = Math.min(spanX - 1, Math.ceil(sampleOf(extent.x1 + reach)));
    const j0 = Math.max(0, Math.floor(sampleOf(extent.y0 - reach)));
    const j1 = Math.min(spanY - 1, Math.ceil(sampleOf(extent.y1 + reach)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const index = j * spanX + i;
        const zoneMask = maskForDistance(zoneDistance(zone, positionX(i), positionY(j)));
        if (zoneMask < mask[index]) mask[index] = zoneMask;
      }
    }
  }
  return mask;
}

function buildOctaves(
  seed: number,
  spans: ReadonlyArray<{ periodTiles: number }>,
  coverTiles: number,
): NoiseOctave[] {
  return spans.map(
    ({ periodTiles }, index) =>
      new NoiseOctave(periodTiles, coverTiles, mulberry32(subSeed(seed, index))),
  );
}

/** One world-tone field's raw (unnormalised) level per sample. */
function worldToneLevels(
  seed: number,
  spacingTiles: number,
  spanX: number,
  spanY: number,
  coverTiles: number,
): Float32Array {
  const octaves = WORLD_TONE_OCTAVE_WEIGHTS.map((weight, index) => ({
    weight,
    octave: new NoiseOctave(
      spacingTiles / WORLD_TONE_OCTAVE_SPACING_DIVISOR ** index,
      coverTiles,
      mulberry32(subSeed(seed, index)),
    ),
  }));
  const levels = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    for (let i = 0; i < spanX; i++) {
      let level = 0;
      for (const { weight, octave } of octaves) level += weight * octave.sample(i, j);
      levels[j * spanX + i] = level;
    }
  }
  return levels;
}

/**
 * Darkening of the non-periodic tone, two fields in series. Each is stretched
 * to its full 0..1 range over the map first, for the reason the periodic
 * fields are: a weighted sum of hashed octaves never reaches its extremes, and
 * the quoted depth would otherwise be half true.
 */
function buildWorldTone(
  seed: number,
  spanX: number,
  spanY: number,
  coverTiles: number,
): Float32Array {
  const lightness = new Float32Array(spanX * spanY).fill(1);
  WORLD_TONE_FIELD_SPACINGS_TILES.forEach((spacing, fieldIndex) => {
    const levels = worldToneLevels(subSeed(seed, fieldIndex), spacing, spanX, spanY, coverTiles);
    let lowest = Infinity;
    let highest = -Infinity;
    for (const level of levels) {
      lowest = Math.min(lowest, level);
      highest = Math.max(highest, level);
    }
    const spread = highest - lowest;
    for (let index = 0; index < levels.length; index++) {
      const normalised = spread <= 0 ? 1 : (levels[index] - lowest) / spread;
      lightness[index] *= 1 - WORLD_TONE_FIELD_DEPTH * (1 - normalised);
    }
  });
  return lightness.map((value) => 1 - value);
}

/** Separable box blur, edges clamped. */
function boxBlur(source: Float32Array, spanX: number, spanY: number, radius: number): Float32Array {
  const window = radius * 2 + 1;
  const horizontal = new Float32Array(source.length);
  for (let j = 0; j < spanY; j++) {
    for (let i = 0; i < spanX; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum += source[j * spanX + clampTo(i + k, 0, spanX - 1)];
      horizontal[j * spanX + i] = sum / window;
    }
  }
  const blurred = new Float32Array(source.length);
  for (let j = 0; j < spanY; j++) {
    for (let i = 0; i < spanX; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += horizontal[clampTo(j + k, 0, spanY - 1) * spanX + i];
      }
      blurred[j * spanX + i] = sum / window;
    }
  }
  return blurred;
}

function buildHueBias(
  seed: number,
  spanX: number,
  spanY: number,
  coverTiles: number,
): Float32Array {
  const octaves = buildOctaves(seed, HUE_OCTAVES, coverTiles);
  const bias = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    for (let i = 0; i < spanX; i++) {
      let level = 0;
      for (let octave = 0; octave < octaves.length; octave++) {
        level += octaves[octave].sample(i, j) * HUE_OCTAVES[octave].weight;
      }
      bias[j * spanX + i] = clampTo((level - NOISE_MIDPOINT) * HUE_STRETCH, -1, 1);
    }
  }
  return bias;
}

/** 1 at a corner touching the river channel, else 0. */
function channelPresence(spec: MacroFieldSpec, spanX: number, spanY: number): Float32Array {
  const presence = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    const cornerY = j - MACRO_MARGIN_SAMPLES;
    for (let i = 0; i < spanX; i++) {
      const cornerX = i - MACRO_MARGIN_SAMPLES;
      const touchesChannel =
        spec.isChannel(cornerX - 1, cornerY - 1) ||
        spec.isChannel(cornerX, cornerY - 1) ||
        spec.isChannel(cornerX - 1, cornerY) ||
        spec.isChannel(cornerX, cornerY);
      if (touchesChannel) presence[j * spanX + i] = 1;
    }
  }
  return presence;
}

/** Brightening of a sunward slope relative to flat ground, from the plain landform; 0 on a lee slope. */
function sunwardAt(
  height: Float32Array,
  spanX: number,
  spanY: number,
  i: number,
  j: number,
): number {
  const at = (si: number, sj: number) =>
    height[clampTo(sj, 0, spanY - 1) * spanX + clampTo(si, 0, spanX - 1)];
  const slopeX =
    ((at(i + 1, j) - at(i - 1, j)) / CENTRAL_DIFFERENCE_SPAN_TILES) * RELIEF_EXAGGERATION_TILES;
  const slopeY =
    ((at(i, j + 1) - at(i, j - 1)) / CENTRAL_DIFFERENCE_SPAN_TILES) * RELIEF_EXAGGERATION_TILES;
  const lambert = Math.max(
    0,
    (-slopeX * SUN.x - slopeY * SUN.y + SUN.z) / Math.hypot(slopeX, slopeY, 1),
  );
  return Math.max(0, lambert / SUN.z - 1);
}

function buildLushness(
  spec: MacroFieldSpec,
  spanX: number,
  spanY: number,
  plainHeight: Float32Array,
  neighbourhoodAverage: Float32Array,
): Float32Array {
  let waterReach = channelPresence(spec, spanX, spanY);
  for (let pass = 0; pass < WATER_REACH_BLUR_PASSES; pass++) {
    waterReach = boxBlur(waterReach, spanX, spanY, WATER_REACH_BLUR_RADIUS_TILES);
  }
  const lushness = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    for (let i = 0; i < spanX; i++) {
      const index = j * spanX + i;
      const height = plainHeight[index];
      const relativeToNeighbourhood = height - neighbourhoodAverage[index];
      const nearWater = Math.min(1, waterReach[index] * WATER_REACH_GAIN);
      const lowGround = smoothstepUnit(
        clampTo((LOWLAND_MAX + LOW_GROUND_LEAD - height) / LOW_GROUND_SPAN, 0, 1),
      );
      const basin = Math.tanh(Math.max(0, -relativeToNeighbourhood) * CAVITY_RESPONSE);
      const highGround = smoothstepUnit(
        clampTo((height - (MEADOW_MAX - HIGH_GROUND_LEAD)) / HIGH_GROUND_SPAN, 0, 1),
      );
      const crest = Math.tanh(Math.max(0, relativeToNeighbourhood) * CREST_RESPONSE);
      const sunward = Math.min(1, sunwardAt(plainHeight, spanX, spanY, i, j) / SUNWARD_FULL_DRY);
      const lush =
        nearWater * WATER_LUSH_WEIGHT +
        lowGround * LOW_GROUND_LUSH_WEIGHT +
        basin * BASIN_LUSH_WEIGHT;
      const dry =
        highGround * HIGH_GROUND_DRY_WEIGHT +
        crest * CREST_DRY_WEIGHT +
        sunward * SUNWARD_DRY_WEIGHT;
      lushness[index] = clampTo((lush - dry) * LUSHNESS_GAIN, -1, 1);
    }
  }
  return lushness;
}

/** Light along the top edge of every ledge: the corners it shares with the tile above, then that tile's top. */
function buildCrestLight(spec: MacroFieldSpec, spanX: number, spanY: number): Float32Array {
  const crest = new Float32Array(spanX * spanY);
  for (let j = 0; j < spanY; j++) {
    const cornerY = j - MACRO_MARGIN_SAMPLES;
    for (let i = 0; i < spanX; i++) {
      const cornerX = i - MACRO_MARGIN_SAMPLES;
      const onLedgeTop = spec.isLedge(cornerX - 1, cornerY) || spec.isLedge(cornerX, cornerY);
      const aboveLedgeTop =
        spec.isLedge(cornerX - 1, cornerY + 1) || spec.isLedge(cornerX, cornerY + 1);
      if (onLedgeTop) crest[j * spanX + i] = CREST_EDGE_LIGHT;
      else if (aboveLedgeTop) crest[j * spanX + i] = CREST_UPPER_LIGHT;
    }
  }
  return crest;
}

function buildGrids(spec: MacroFieldSpec, spanX: number, spanY: number): MacroSampleGrids {
  const { terrain } = spec;
  const { elevation } = terrain;
  const coverTiles = Math.max(spec.coverCols, spec.coverRows) + MACRO_MARGIN_SAMPLES * 2;
  const microSeed = subSeed(elevation.seed, MICRO_RELIEF_SEED_SALT);
  const microOctaves = buildOctaves(microSeed, MICRO_RELIEF_OCTAVES, coverTiles);
  // The map's own seed as well as the art's, so two maps drawn under the same
  // look still have their own tone.
  const toneSeed = subSeed((spec.toneSeed ^ elevation.seed) >>> 0, WORLD_TONE_SEED_SALT);

  const count = spanX * spanY;
  const plainHeight = new Float32Array(count);
  const shadingHeight = new Float32Array(count);
  const periodicTone = new Float32Array(count);
  const lastX = spec.cols - 1;
  const lastY = spec.rows - 1;
  const positionX = (i: number) =>
    clampTo(i - MACRO_MARGIN_SAMPLES + CORNER_TO_CENTRE_OFFSET, 0, lastX);
  const positionY = (j: number) =>
    clampTo(j - MACRO_MARGIN_SAMPLES + CORNER_TO_CENTRE_OFFSET, 0, lastY);
  const levelMask = buildLevelMask(terrain, spanX, spanY, positionX, positionY);

  for (let j = 0; j < spanY; j++) {
    const cornerY = j - MACRO_MARGIN_SAMPLES;
    const y = positionY(j);
    for (let i = 0; i < spanX; i++) {
      const cornerX = i - MACRO_MARGIN_SAMPLES;
      const x = positionX(i);
      const index = j * spanX + i;

      const relief = elevation.reliefWeightAt(x, y);
      const height = elevation.elevationWithRelief(x, y, relief);
      plainHeight[index] = height;
      shadingHeight[index] = height;
      if (relief > 0) {
        let micro = 0;
        for (let octave = 0; octave < microOctaves.length; octave++) {
          const centred = microOctaves[octave].sample(i, j) - NOISE_MIDPOINT;
          micro += centred * MICRO_RELIEF_OCTAVES[octave].amplitude;
        }
        shadingHeight[index] += micro * relief;
      }

      if (levelMask[index] < 1) periodicTone[index] = spec.periodicToneAt(cornerX, cornerY);
    }
  }

  const dryMask = new Float32Array(count).fill(1);
  for (let j = 0; j < spanY; j++) {
    const cornerY = j - MACRO_MARGIN_SAMPLES;
    for (let i = 0; i < spanX; i++) {
      const cornerX = i - MACRO_MARGIN_SAMPLES;
      const surroundedByWater =
        spec.isWater(cornerX - 1, cornerY - 1) &&
        spec.isWater(cornerX, cornerY - 1) &&
        spec.isWater(cornerX - 1, cornerY) &&
        spec.isWater(cornerX, cornerY);
      if (surroundedByWater) dryMask[j * spanX + i] = 0;
    }
  }

  let average: Float32Array = plainHeight;
  for (let pass = 0; pass < CAVITY_BLUR_PASSES; pass++) {
    average = boxBlur(average, spanX, spanY, CAVITY_BLUR_RADIUS_TILES);
  }
  const basinDepth = average.map((neighbourhood, index) =>
    Math.max(0, neighbourhood - plainHeight[index]),
  );

  return {
    spanX,
    spanY,
    shadingHeight,
    basinDepth,
    levelMask,
    dryMask,
    worldTone: buildWorldTone(toneSeed, spanX, spanY, coverTiles),
    periodicTone,
    hueBias: buildHueBias(subSeed(toneSeed, HUE_SEED_SALT), spanX, spanY, coverTiles),
    ...buildBankGrids(spec, spanX, spanY),
    lushness: buildLushness(spec, spanX, spanY, plainHeight, average),
    crestLight: buildCrestLight(spec, spanX, spanY),
  };
}

/**
 * Accumulates source-over layers as one: after each, the stack is
 * `dest·(1−alpha) + premultiplied`.
 */
interface Folded {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

function foldLayer(into: Folded, layer: LayerPaint, alpha: number): void {
  const keep = 1 - alpha;
  into.r = into.r * keep + layer.r * alpha;
  into.g = into.g * keep + layer.g * alpha;
  into.b = into.b * keep + layer.b * alpha;
  into.alpha = into.alpha * keep + alpha;
}

/** Builds the macro field for one overworld map. Pure; a few tens of milliseconds. */
export function buildMacroField(spec: MacroFieldSpec): MacroField {
  const spanX = spec.coverCols + 1 + MACRO_MARGIN_SAMPLES * 2;
  const spanY = spec.coverRows + 1 + MACRO_MARGIN_SAMPLES * 2;
  const grids = buildGrids(spec, spanX, spanY);
  const rgba = new Uint8ClampedArray(spanX * spanY * RGBA_CHANNELS);
  const landformAlpha = new Float32Array(spanX * spanY);
  const paint: LayerPaint = { r: 0, g: 0, b: 0, alpha: 0 };
  const folded: Folded = { r: 0, g: 0, b: 0, alpha: 0 };

  for (let index = 0; index < spanX * spanY; index++) {
    folded.r = 0;
    folded.g = 0;
    folded.b = 0;
    folded.alpha = 0;
    let landformKeep = 1;
    for (const layer of MACRO_LAYERS) {
      layer.paint(grids, index, paint);
      const alpha = layer.fromLandform ? paint.alpha * grids.levelMask[index] : paint.alpha;
      if (alpha <= 0) continue;
      foldLayer(folded, paint, alpha);
      if (layer.fromLandform) landformKeep *= 1 - alpha;
    }
    landformAlpha[index] = 1 - landformKeep;
    const at = index * RGBA_CHANNELS;
    if (folded.alpha > 0) {
      rgba[at + RED] = folded.r / folded.alpha;
      rgba[at + GREEN] = folded.g / folded.alpha;
      rgba[at + BLUE] = folded.b / folded.alpha;
    }
    rgba[at + ALPHA] = Math.round(folded.alpha * BYTE_MAX);
  }

  return {
    spanX,
    spanY,
    rgba,
    landformAlpha,
    levelTiles: levelTileMap(grids.levelMask, spanX, spec.coverCols, spec.coverRows),
  };
}
