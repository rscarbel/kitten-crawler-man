/**
 * Material painters.
 *
 * A material paints one **patch** — a square of `patchTiles x patchTiles` game
 * tiles, generated as a single wrapped field and sliced into tiles afterwards.
 * Adding a floor type to any level, present or future, means adding an entry
 * here and naming it in a sheet config; nothing else in the pipeline changes.
 *
 * ## Three rules that decide whether a floor is pleasant to stand on
 *
 * 1. **Everything must sample through `ctx.noise`.** Those functions wrap at the
 *    patch size. A hand-rolled `Math.floor(x / n)` against an unwrapped
 *    coordinate tears the joint; `positiveMod` exists for the cases that need it.
 *
 * 2. **Geometry comes from `ctx.structure`, detail from `ctx.detail`.** Wrapping
 *    makes a patch seamless against *itself*, not against a differently-seeded
 *    sibling. Two variants of a paved material whose stones were laid by
 *    different seeds will not line up where they meet, and the mismatch reads as
 *    a grid. Sharing the structure seed across a material's variants keeps the
 *    stonework continuous while tints, wear and scatter still vary.
 *
 * 3. **Joint contrast is a budget, not a free parameter.** At 32 px per tile a
 *    dark joint every half-tile is a hard line every 16 screen pixels, and a
 *    floor made of those is exhausting to look at. Prefer large units, soft
 *    joints, and `calm` materials that hold a stretch of ground without incident.
 */

import {
  Surface,
  wrappedDisc,
  wrappedStroke,
  positiveMod,
  TILE_PX,
  type RGB,
  type PatchTiles,
} from './raster.js';
import { hashLattice, NoiseField } from './noise.js';
import {
  sampleRamp,
  shade,
  mix,
  type Ramp,
  GRASS_RAMP,
  DEAD_GRASS_RAMP,
  STREET_STONE_RAMP,
  COBBLE_RAMP,
  FLAGSTONE_RAMP,
  DIRT_RAMP,
  GRAVEL_RAMP,
  BOPCA_TILE_RAMP,
  BOPCA_HEARTH_RAMP,
  BOPCA_SCUFF_RAMP,
  CELLAR_STONE_RAMP,
  CELLAR_DRESSED_STONE_RAMP,
  CELLAR_MORTAR_RAMP,
  CELLAR_TIMBER_RAMP,
  CELLAR_CINDER_RAMP,
  CELLAR_WALL_RAMP,
  POURED_CONCRETE_RAMP,
  TERRAZZO_RAMP,
  TERRAZZO_CHIP_RAMP,
  STEEL_PLATE_RAMP,
  INSTITUTIONAL_VINYL_RAMP,
  CINDERBLOCK_RAMP,
  INTERIOR_BOARD_RAMP,
  INTERIOR_STONE_RAMP,
  INTERIOR_PLASTER_RAMP,
  INTERIOR_COUNTER_RAMP,
  RIVER_WATER_RAMP,
  HIGHLAND_GRASS_RAMP,
  SCREE_RAMP,
} from './palette.js';

export interface PaintContext {
  readonly surface: Surface;
  /** Patch size in pixels — the wrap period for everything in this patch. */
  readonly size: number;
  readonly noise: NoiseField;
  /** Shared by every variant of this material: anything that must line up. */
  readonly structure: number;
  /** Unique per variant: tints, wear, scatter. */
  readonly detail: number;
}

export interface Material {
  readonly id: string;
  /** Shown in the in-game `?tiles` review route. */
  readonly label: string;
  /** How many tiles across each generated patch is. */
  readonly patchTiles: PatchTiles;
  /** Independently-seeded patches to emit. Geometric materials need fewer. */
  readonly variants: number;
  readonly paint: (ctx: PaintContext) => void;
}

// ── shared building blocks ─────────────────────────────────────────────────

const BASE_PATCH_OCTAVES = 3;
const BASE_GRAIN_OCTAVES = 2;
const BASE_GRAIN_PERIOD = 16;

interface GroundOptions {
  /**
   * Lattice period of the broad tonal layer, in cells across the whole patch.
   * Low values put one big light-to-dark sweep inside the patch, which reads as
   * tonal blocking once patches repeat. Large-scale variation belongs in the
   * renderer's world-space noise layer, not baked into the ground art.
   */
  readonly patchPeriod: number;
  readonly patchWeight: number;
  readonly contrast: number;
}

/**
 * Two-scale noise ground: broad tone from `structure`, fine grain from `detail`.
 *
 * Both periods are counts of lattice cells across the whole patch, so the grain
 * period must be multiplied by the patch's tile count or a 4x4 patch gets cells
 * four times larger than a 1x1 one and the material comes out blurry.
 */
function paintNoiseGround(ctx: PaintContext, ramp: Ramp, options: GroundOptions): void {
  const tiles = ctx.size / TILE_PX;
  const grainPeriod = BASE_GRAIN_PERIOD * tiles;
  ctx.surface.fill((x, y) => {
    const patches = ctx.noise.fbm(x, y, ctx.structure, BASE_PATCH_OCTAVES, options.patchPeriod);
    const grain = ctx.noise.fbm(x, y, ctx.detail, BASE_GRAIN_OCTAVES, grainPeriod);
    const blended = patches * options.patchWeight + grain * (1 - options.patchWeight);
    return sampleRamp(ramp, (blended - 0.5) * options.contrast + 0.5);
  });
}

/** Light direction for all relief shading, so materials agree with each other. */
const LIGHT_DIR_X = -0.55;
const LIGHT_DIR_Y = -0.83;
const RELIEF_LIGHT_GAIN = 0.34;

function reliefFactor(offsetX: number, offsetY: number, strength: number): number {
  const length = Math.hypot(offsetX, offsetY);
  if (length === 0) return 1;
  const dot = (offsetX / length) * LIGHT_DIR_X + (offsetY / length) * LIGHT_DIR_Y;
  return 1 + dot * strength * RELIEF_LIGHT_GAIN;
}

interface SpeckleOptions {
  readonly count: number;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly ramp: Ramp;
  readonly alpha: number;
  readonly softness: number;
}

/** Scatters small discs at wrapped positions — pebbles, lichen, litter. */
function paintSpeckles(ctx: PaintContext, seed: number, options: SpeckleOptions): void {
  // Density is per unit area, so a 4x4 patch gets 16x the count of a 1x1 patch
  // and every material keeps the same look regardless of its patch size.
  const areaScale = (ctx.size / TILE_PX) ** 2;
  const total = Math.round(options.count * areaScale);
  for (let i = 0; i < total; i++) {
    const x = hashLattice(i, 1, seed) * ctx.size;
    const y = hashLattice(i, 2, seed) * ctx.size;
    const radius =
      options.minRadius + hashLattice(i, 3, seed) * (options.maxRadius - options.minRadius);
    wrappedDisc(
      ctx.surface,
      x,
      y,
      radius,
      sampleRamp(options.ramp, hashLattice(i, 4, seed)),
      options.alpha,
      options.softness,
    );
  }
}

const MINERAL_GRAIN_PERIOD_PER_TILE = 32;
const MINERAL_GRAIN_OCTAVES = 2;
const MINERAL_GRAIN_STRENGTH = 0.5;

/**
 * Per-pixel mineral speckle for stone that has no joints to carry detail.
 * Without it a jointless material is a smooth gradient, which at 32 px per tile
 * looks like fog rather than rock.
 */
function paintMineralGrain(ctx: PaintContext, ramp: Ramp, seed: number): void {
  const period = MINERAL_GRAIN_PERIOD_PER_TILE * (ctx.size / TILE_PX);
  ctx.surface.fill((x, y) => {
    const grain = ctx.noise.fbm(x, y, seed, MINERAL_GRAIN_OCTAVES, period);
    const existing = ctx.surface.get(x, y);
    const speck = grain < 0.5 ? ramp.shadow : ramp.accent;
    return mix(existing, speck, Math.abs(grain - 0.5) * MINERAL_GRAIN_STRENGTH);
  });
}

// ── grass family ───────────────────────────────────────────────────────────

const BLADE_MIN_LENGTH = 2;
const BLADE_LENGTH_RANGE = 4;
const BLADE_MAX_LEAN = 0.8;
const BLADE_ALPHA = 0.72;
const BLADE_TAPER = 0.45;
const BLADE_SHADOW_SHARE = 0.42;
const BLADE_HIGHLIGHT_SHARE = 0.88;

/** Short upward strokes — what makes grass read as grass rather than green noise. */
function paintBlades(ctx: PaintContext, ramp: Ramp, seed: number, countPerTile: number): void {
  const total = Math.round(countPerTile * (ctx.size / TILE_PX) ** 2);
  for (let i = 0; i < total; i++) {
    const x = hashLattice(i, 11, seed) * ctx.size;
    const y = hashLattice(i, 12, seed) * ctx.size;
    const length = BLADE_MIN_LENGTH + hashLattice(i, 13, seed) * BLADE_LENGTH_RANGE;
    const lean = (hashLattice(i, 14, seed) - 0.5) * 2 * BLADE_MAX_LEAN;
    const tone = hashLattice(i, 15, seed);
    const color: RGB =
      tone < BLADE_SHADOW_SHARE
        ? ramp.shadow
        : tone < BLADE_HIGHLIGHT_SHARE
          ? ramp.light
          : ramp.accent;
    wrappedStroke(ctx.surface, x, y, lean, -1, length, color, BLADE_ALPHA, BLADE_TAPER);
  }
}

const GRASS_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.55, contrast: 1.35 };
const GRASS_BLADE_COUNT = 950;

const grass: Material = {
  id: 'grass',
  label: 'Field grass',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, GRASS_RAMP, GRASS_GROUND);
    paintBlades(ctx, GRASS_RAMP, ctx.detail, GRASS_BLADE_COUNT);
  },
};

const VERGE_DEAD_PATCH_COUNT = 14;
const VERGE_BLADE_COUNT = 560;
const VERGE_DEAD_BLADE_SHARE = 0.45;
const VERGE_PEBBLE_COUNT = 30;

/** Grass losing ground to stone — where a street meets a garden. */
const verge: Material = {
  id: 'verge',
  label: 'Verge (grass giving way to stone)',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, GRASS_RAMP, GRASS_GROUND);
    paintSpeckles(ctx, ctx.detail + 31, {
      count: VERGE_DEAD_PATCH_COUNT,
      minRadius: 4,
      maxRadius: 10,
      ramp: DEAD_GRASS_RAMP,
      alpha: 0.55,
      softness: 1,
    });
    paintBlades(ctx, GRASS_RAMP, ctx.detail, VERGE_BLADE_COUNT);
    paintBlades(ctx, DEAD_GRASS_RAMP, ctx.detail + 77, VERGE_BLADE_COUNT * VERGE_DEAD_BLADE_SHARE);
    paintSpeckles(ctx, ctx.detail + 53, {
      count: VERGE_PEBBLE_COUNT,
      minRadius: 0.7,
      maxRadius: 2.2,
      ramp: COBBLE_RAMP,
      alpha: 0.85,
      softness: 0.35,
    });
  },
};

// ── loose ground ───────────────────────────────────────────────────────────

const DIRT_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.35, contrast: 0.85 };

const dirt: Material = {
  id: 'dirt',
  label: 'Packed dirt / alley',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, DIRT_RAMP, DIRT_GROUND);
    paintSpeckles(ctx, ctx.detail + 17, {
      count: 8,
      minRadius: 5,
      maxRadius: 12,
      ramp: { ...DIRT_RAMP, mid: shade(DIRT_RAMP.shadow, 0.85) },
      alpha: 0.18,
      softness: 1,
    });
    paintSpeckles(ctx, ctx.detail + 19, {
      count: 40,
      minRadius: 0.6,
      maxRadius: 2,
      ramp: GRAVEL_RAMP,
      alpha: 0.6,
      softness: 0.4,
    });
  },
};

const GRAVEL_CELLS_PER_TILE = 16;
const GRAVEL_CHIP_EDGE = 0.34;
const GRAVEL_RELIEF_STRENGTH = 1.6;
const GRAVEL_SUBSTRATE: GroundOptions = { patchPeriod: 8, patchWeight: 0.4, contrast: 0.9 };

const gravel: Material = {
  id: 'gravel',
  label: 'Gravel yard',
  patchTiles: 2,
  // Four, not three: the eye finds a repeat after patchTiles * sqrt(variants)
  // tiles, and three variants of a 2x2 patch gives 3.5 — under the four the
  // town's ground is held to, and gravel is a yard material, laid in stretches.
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, { ...GRAVEL_RAMP, mid: GRAVEL_RAMP.shadow }, GRAVEL_SUBSTRATE);
    const cells = GRAVEL_CELLS_PER_TILE * (ctx.size / TILE_PX);
    ctx.surface.fill((x, y) => {
      const cell = ctx.noise.worley(x, y, cells, ctx.structure, 1);
      if (cell.nearest > GRAVEL_CHIP_EDGE) return ctx.surface.get(x, y);
      const chip = sampleRamp(GRAVEL_RAMP, cell.cellHash);
      return shade(chip, reliefFactor(cell.offsetX, cell.offsetY, GRAVEL_RELIEF_STRENGTH));
    });
  },
};

// ── the wilderness: river bed, uplands ─────────────────────────────────────

/**
 * A long low swell rather than fine grain: still water at 32 px a tile has no
 * texture of its own, and any detail baked in here would sit motionless under
 * the drifting highlights `WaterAnimationSystem` lays on top and read as grit
 * frozen in the surface.
 *
 * The broad-tone weight is well below the first cut's 0.8, and that is the
 * fourth rule of `add-ground-tile` biting: broad tone inside a patch makes each
 * *patch* read as a tonal block, and on a material as flat as water — with no
 * grain or joints to distract from it — a river came out as a mosaic of slightly
 * different squares. Large-scale variation belongs to the renderer's world-space
 * noise layer, not to the tile.
 */
const WATER_GROUND: GroundOptions = { patchPeriod: 12, patchWeight: 0.4, contrast: 0.32 };
const WATER_DEPTH_POOL_COUNT = 5;
const WATER_DEPTH_POOL_MIN_RADIUS = 8;
const WATER_DEPTH_POOL_MAX_RADIUS = 20;
const WATER_DEPTH_POOL_ALPHA = 0.2;
const WATER_DEPTH_POOL_SOFTNESS = 1;
const WATER_SILT_COUNT = 10;
const WATER_SILT_MIN_RADIUS = 3;
const WATER_SILT_MAX_RADIUS = 9;
const WATER_SILT_ALPHA = 0.11;
const WATER_SILT_SOFTNESS = 1;

const water: Material = {
  id: 'water',
  label: 'River water (static base — motion is a render overlay)',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, RIVER_WATER_RAMP, WATER_GROUND);
    const deepRamp: Ramp = { ...RIVER_WATER_RAMP, mid: shade(RIVER_WATER_RAMP.shadow, 0.8) };
    paintSpeckles(ctx, ctx.detail + 41, {
      count: WATER_DEPTH_POOL_COUNT,
      minRadius: WATER_DEPTH_POOL_MIN_RADIUS,
      maxRadius: WATER_DEPTH_POOL_MAX_RADIUS,
      ramp: deepRamp,
      alpha: WATER_DEPTH_POOL_ALPHA,
      softness: WATER_DEPTH_POOL_SOFTNESS,
    });
    paintSpeckles(ctx, ctx.detail + 43, {
      count: WATER_SILT_COUNT,
      minRadius: WATER_SILT_MIN_RADIUS,
      maxRadius: WATER_SILT_MAX_RADIUS,
      ramp: { ...RIVER_WATER_RAMP, mid: DIRT_RAMP.shadow },
      alpha: WATER_SILT_ALPHA,
      softness: WATER_SILT_SOFTNESS,
    });
  },
};

const HIGHLAND_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.5, contrast: 1.15 };
const HIGHLAND_BLADE_COUNT = 620;
const HIGHLAND_DEAD_BLADE_SHARE = 0.7;
const HIGHLAND_OUTCROP_COUNT = 9;
const HIGHLAND_OUTCROP_MIN_RADIUS = 3;
const HIGHLAND_OUTCROP_MAX_RADIUS = 8;
const HIGHLAND_OUTCROP_ALPHA = 0.3;
const HIGHLAND_OUTCROP_SOFTNESS = 0.8;
const HIGHLAND_PEBBLE_COUNT = 52;
const HIGHLAND_PEBBLE_MIN_RADIUS = 0.6;
const HIGHLAND_PEBBLE_MAX_RADIUS = 1.9;
const HIGHLAND_PEBBLE_ALPHA = 0.7;
const HIGHLAND_PEBBLE_SOFTNESS = 0.4;

/** Thin, stony upland turf — the band between field grass and bare scree. */
const highland: Material = {
  id: 'highland',
  label: 'Highland turf (thin upland grass)',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, HIGHLAND_GRASS_RAMP, HIGHLAND_GROUND);
    paintSpeckles(ctx, ctx.detail + 61, {
      count: HIGHLAND_OUTCROP_COUNT,
      minRadius: HIGHLAND_OUTCROP_MIN_RADIUS,
      maxRadius: HIGHLAND_OUTCROP_MAX_RADIUS,
      ramp: SCREE_RAMP,
      alpha: HIGHLAND_OUTCROP_ALPHA,
      softness: HIGHLAND_OUTCROP_SOFTNESS,
    });
    paintBlades(ctx, HIGHLAND_GRASS_RAMP, ctx.detail, HIGHLAND_BLADE_COUNT);
    paintBlades(
      ctx,
      DEAD_GRASS_RAMP,
      ctx.detail + 67,
      HIGHLAND_BLADE_COUNT * HIGHLAND_DEAD_BLADE_SHARE,
    );
    paintSpeckles(ctx, ctx.detail + 63, {
      count: HIGHLAND_PEBBLE_COUNT,
      minRadius: HIGHLAND_PEBBLE_MIN_RADIUS,
      maxRadius: HIGHLAND_PEBBLE_MAX_RADIUS,
      ramp: SCREE_RAMP,
      alpha: HIGHLAND_PEBBLE_ALPHA,
      softness: HIGHLAND_PEBBLE_SOFTNESS,
    });
  },
};

/**
 * Scree is `paintSetts` on a four-tile patch, not the gravel painter on a two.
 *
 * Two things had to be unlearned here, and both are general.
 *
 * The first cut copied gravel — discs of `nearest < edge` cells — which covers
 * about half the area and leaves every chip a separated lump with a lit rim and
 * a shadowed underside. At scree's coarser cell size that read as a tray of ball
 * bearings. What scree actually is, seen from above, is *tessellating angular
 * plates*, and the joint between a Worley cell and its neighbour is exactly
 * that — so this is a paving painter with the paving taken out of it.
 *
 * The second cut kept `patchTiles: 2`, and a slope of it read as woven fabric.
 * A material with **visible units** repeats at its patch, not at its cell, so a
 * two-tile patch shows the same handful of plates every 64 screen pixels however
 * irregular one patch is on its own. Every other cell-structured material in
 * this file is on a four-tile patch for that reason, and the fix was to join
 * them rather than to keep chasing the regularity with jitter and warp.
 *
 * The third cut went to 1.25 cells and failed the seam gate at 1.30 — which was
 * *not* a new seam. The generator's ratio is the wrap error over the patch's own
 * strongest interior edge, so calming a material shrinks the yardstick: scree's
 * absolute wrap error actually fell (4.34 → 3.30) while its interior denominator
 * fell further (4.76 → 2.39). The gate is right to fail it anyway, because a
 * fixed wrap error is more visible on a calm surface than on a busy one. 1.5 is
 * where the plates are large and the wrap error is genuinely small.
 */
const SCREE_CELLS_PER_TILE = 1.5;
const SCREE_JITTER = 0.85;
const SCREE_JOINT_WIDTH = 0.14;
const SCREE_JOINT_STRENGTH = 0.3;
const SCREE_RELIEF_STRENGTH = 0.38;
const SCREE_WARP_AMPLITUDE = 1.6;
/**
 * Wider than the paving materials — a hillside's plates are freshly broken and
 * genuinely differ in tone — but well under the `paintSetts` default of 0.7,
 * which put a near-black plate beside a near-white one and read as static.
 */
const SCREE_TONE_SPREAD = 0.3;
const SCREE_SHADE_POOL_COUNT = 5;
const SCREE_SHADE_POOL_MIN_RADIUS = 9;
const SCREE_SHADE_POOL_MAX_RADIUS = 26;
const SCREE_SHADE_POOL_ALPHA = 0.18;
const SCREE_SHADE_POOL_SOFTNESS = 1;
const SCREE_FINES_COUNT = 10;
const SCREE_FINES_MIN_RADIUS = 0.8;
const SCREE_FINES_MAX_RADIUS = 2.4;
const SCREE_FINES_ALPHA = 0.22;
const SCREE_FINES_SOFTNESS = 0.7;
/**
 * The joint tops out a long way above the ramp's shadow. Taking it all the way
 * down inked every plate boundary, and at scree's plate count that is most of
 * what the tile is — the slope has to read as one surface with cracks in it,
 * not as a mosaic of outlined chips.
 */
const SCREE_JOINT_DEPTH = 0.55;
/**
 * Raised well above the paving default. Scree's plates are few and large now,
 * so the material's whole value is carried by a handful of faces — sitting them
 * between shadow and mid, as the default floor does, made the slope read as a
 * dark smear rather than as lit rock.
 */
const SCREE_TONE_FLOOR = 0.42;
/**
 * Fractures run *across* plates, not around them. The plate joints say where
 * the rock broke; these say it is still breaking, and they are what stops a
 * calm cell lattice from reading as upholstery.
 */
const SCREE_FRACTURE_COUNT = 2.5;
const SCREE_FRACTURE_LENGTH = 18;
const SCREE_FRACTURE_ALPHA = 0.3;
const SCREE_FRACTURE_SOFTNESS = 0.8;

const scree: Material = {
  id: 'scree',
  label: 'Scree (broken hillside rock)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSetts(ctx, {
      cellsPerTile: SCREE_CELLS_PER_TILE,
      jitter: SCREE_JITTER,
      ramp: SCREE_RAMP,
      jointRamp: {
        ...SCREE_RAMP,
        mid: mix(SCREE_RAMP.mid, SCREE_RAMP.shadow, SCREE_JOINT_DEPTH),
        light: mix(SCREE_RAMP.light, SCREE_RAMP.shadow, SCREE_JOINT_DEPTH),
      },
      jointWidth: SCREE_JOINT_WIDTH,
      jointStrength: SCREE_JOINT_STRENGTH,
      reliefStrength: SCREE_RELIEF_STRENGTH,
      warpAmplitude: SCREE_WARP_AMPLITUDE,
      toneSpread: SCREE_TONE_SPREAD,
      toneFloor: SCREE_TONE_FLOOR,
    });
    const tiles = ctx.size / TILE_PX;
    const fractures = Math.round(SCREE_FRACTURE_COUNT * tiles * tiles);
    for (let i = 0; i < fractures; i++) {
      const x = hashLattice(i, 51, ctx.detail) * ctx.size;
      const y = hashLattice(i, 52, ctx.detail) * ctx.size;
      const angle = hashLattice(i, 53, ctx.detail) * Math.PI * 2;
      wrappedStroke(
        ctx.surface,
        x,
        y,
        Math.cos(angle),
        Math.sin(angle),
        SCREE_FRACTURE_LENGTH,
        SCREE_RAMP.shadow,
        SCREE_FRACTURE_ALPHA,
        SCREE_FRACTURE_SOFTNESS,
      );
    }
    // Broad soft shade pools over the plates, at a scale far larger than the
    // cell lattice. Their job is to break up the regularity the lattice cannot
    // avoid having, so the eye finds the slope's shape before it finds the grid.
    paintSpeckles(ctx, ctx.detail + 73, {
      count: SCREE_SHADE_POOL_COUNT,
      minRadius: SCREE_SHADE_POOL_MIN_RADIUS,
      maxRadius: SCREE_SHADE_POOL_MAX_RADIUS,
      ramp: { ...SCREE_RAMP, mid: shade(SCREE_RAMP.shadow, 0.75) },
      alpha: SCREE_SHADE_POOL_ALPHA,
      softness: SCREE_SHADE_POOL_SOFTNESS,
    });
    paintSpeckles(ctx, ctx.detail + 71, {
      count: SCREE_FINES_COUNT,
      minRadius: SCREE_FINES_MIN_RADIUS,
      maxRadius: SCREE_FINES_MAX_RADIUS,
      ramp: GRAVEL_RAMP,
      alpha: SCREE_FINES_ALPHA,
      softness: SCREE_FINES_SOFTNESS,
    });
  },
};

// ── worked stone ───────────────────────────────────────────────────────────

interface SettOptions {
  /** Stones across one tile; the patch scales this up automatically. Must
   *  multiply with the material's `patchTiles` to a whole number, or the cell
   *  lattice stops wrapping and the patch edges seam. */
  readonly cellsPerTile: number;
  readonly jitter: number;
  readonly ramp: Ramp;
  readonly jointRamp: Ramp;
  /** Joint width as a fraction of a cell. */
  readonly jointWidth: number;
  /** Peak opacity of the joint. Below 1 the joint reads as a shadowed gap
   *  rather than an inked outline, which is what keeps a paved area calm. */
  readonly jointStrength: number;
  readonly reliefStrength: number;
  readonly warpAmplitude: number;
  /** Per-stone tone variance. Lower values keep a large paved area from
   *  reading as noise; defaults to `SETT_TONE_SPREAD`. */
  readonly toneSpread?: number;
  /**
   * Where the per-stone tone band starts on the ramp. Narrowing `toneSpread`
   * alone drags the whole material down towards `shadow`, because the band is
   * anchored at its floor rather than centred — so a material that wants to be
   * calm *and* mid-toned has to raise this as it narrows the spread. Defaults
   * to `SETT_TONE_FLOOR`.
   */
  readonly toneFloor?: number;
}

const SETT_WARP_PERIOD_PER_TILE = 8;
const SETT_JOINT_SOFTNESS = 0.55;
const SETT_FACE_GRAIN_OCTAVES = 2;
const SETT_FACE_GRAIN_PERIOD_PER_TILE = 32;
const SETT_FACE_GRAIN_STRENGTH = 0.12;
const SETT_TONE_SPREAD = 0.7;
const SETT_TONE_FLOOR = 0.15;

/**
 * Irregular paving stones with joints, from Worley cells. The gap between the
 * nearest and second-nearest feature point *is* the joint, so joints come out
 * closed without tracing outlines. Lattice and warp use the structure seed, so
 * every variant of a material lays its stones in the same places.
 */
function paintSetts(ctx: PaintContext, options: SettOptions): void {
  const tiles = ctx.size / TILE_PX;
  const cells = options.cellsPerTile * tiles;
  const toneSpread = options.toneSpread ?? SETT_TONE_SPREAD;
  const toneFloor = options.toneFloor ?? SETT_TONE_FLOOR;
  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 3,
      options.warpAmplitude,
      SETT_WARP_PERIOD_PER_TILE * tiles,
    );
    const cell = ctx.noise.worley(warped.x, warped.y, cells, ctx.structure, options.jitter);

    const jointDistance = cell.secondNearest - cell.nearest;
    const jointBlend =
      jointDistance >= options.jointWidth
        ? 0
        : (1 - (jointDistance / options.jointWidth) ** SETT_JOINT_SOFTNESS) * options.jointStrength;

    const faceGrain =
      (ctx.noise.fbm(
        x,
        y,
        ctx.detail + 5,
        SETT_FACE_GRAIN_OCTAVES,
        SETT_FACE_GRAIN_PERIOD_PER_TILE * tiles,
      ) -
        0.5) *
      SETT_FACE_GRAIN_STRENGTH;
    const face = sampleRamp(options.ramp, toneFloor + cell.cellHash * toneSpread + faceGrain);
    const lit = shade(face, reliefFactor(cell.offsetX, cell.offsetY, options.reliefStrength));

    return mix(lit, sampleRamp(options.jointRamp, cell.cellHash * toneSpread), jointBlend);
  });
}

/** Side lanes read as a rougher cousin of the main street, but at the same
 *  restrained stone size — see the note on `cobble`. */
const LANE_CELLS_PER_TILE = 2;
const LANE_JOINT_WIDTH = 0.15;
const LANE_JOINT_STRENGTH = 0.34;
const LANE_RELIEF_STRENGTH = 0.45;
const LANE_WARP_AMPLITUDE = 0.9;
const LANE_JITTER = 0.6;
const LANE_TONE_SPREAD = 0.26;
const LANE_JOINT_WEED_THRESHOLD = 0.72;
const LANE_WEED_COUNT = 40;

const lane: Material = {
  id: 'lane',
  label: 'Village lane',
  patchTiles: 4,
  variants: 3,
  paint: (ctx) => {
    paintSetts(ctx, {
      cellsPerTile: LANE_CELLS_PER_TILE,
      jitter: LANE_JITTER,
      ramp: STREET_STONE_RAMP,
      jointRamp: DIRT_RAMP,
      jointWidth: LANE_JOINT_WIDTH,
      jointStrength: LANE_JOINT_STRENGTH,
      reliefStrength: LANE_RELIEF_STRENGTH,
      warpAmplitude: LANE_WARP_AMPLITUDE,
      toneSpread: LANE_TONE_SPREAD,
    });
    const tiles = ctx.size / TILE_PX;
    const cells = LANE_CELLS_PER_TILE * tiles;
    const weeds = Math.round(LANE_WEED_COUNT * tiles * tiles);
    for (let i = 0; i < weeds; i++) {
      const x = hashLattice(i, 21, ctx.detail) * ctx.size;
      const y = hashLattice(i, 22, ctx.detail) * ctx.size;
      // Weeds only where a joint actually is, so growth follows the stonework.
      const cell = ctx.noise.worley(x, y, cells, ctx.structure, 0.85);
      if (cell.secondNearest - cell.nearest > LANE_JOINT_WIDTH * LANE_JOINT_WEED_THRESHOLD)
        continue;
      wrappedStroke(
        ctx.surface,
        x,
        y,
        (hashLattice(i, 23, ctx.detail) - 0.5) * 2 * BLADE_MAX_LEAN,
        -1,
        2.5,
        GRASS_RAMP.mid,
        0.5,
        0.6,
      );
    }
  },
};

/**
 * The town's main streets carry the most foot traffic on screen, so the paving
 * is deliberately understated: few large setts, faint joints and shallow relief.
 * Small high-contrast stones at 32 px/tile shimmer as the camera scrolls and
 * swallow the sprites standing on them.
 */
const COBBLE_CELLS_PER_TILE = 1.5;
const COBBLE_JOINT_WIDTH = 0.11;
const COBBLE_JOINT_STRENGTH = 0.3;
const COBBLE_RELIEF_STRENGTH = 0.42;
const COBBLE_WARP_AMPLITUDE = 1.1;
const COBBLE_TONE_SPREAD = 0.18;
const COBBLE_JITTER = 0.55;

const cobble: Material = {
  id: 'cobble',
  label: 'Main street cobble',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSetts(ctx, {
      cellsPerTile: COBBLE_CELLS_PER_TILE,
      jitter: COBBLE_JITTER,
      ramp: COBBLE_RAMP,
      jointRamp: { ...DIRT_RAMP, mid: DIRT_RAMP.shadow },
      jointWidth: COBBLE_JOINT_WIDTH,
      jointStrength: COBBLE_JOINT_STRENGTH,
      reliefStrength: COBBLE_RELIEF_STRENGTH,
      warpAmplitude: COBBLE_WARP_AMPLITUDE,
      toneSpread: COBBLE_TONE_SPREAD,
    });
  },
};

/**
 * Large irregular slabs.
 *
 * Deliberately *not* a running-bond grid of small bricks: at 32 px per tile that
 * puts a hard line every 16 screen pixels, and a whole floor of it is dizzying.
 * These are Worley cells at roughly one slab per tile, so units are big, joints
 * are sparse, and the boundaries are irregular rather than ruled.
 */
interface SlabOptions {
  readonly slabsPerTile: number;
  readonly ramp: Ramp;
  readonly jointRamp: Ramp;
  readonly jointWidth: number;
  readonly jointStrength: number;
  readonly bevelStrength: number;
  readonly crackCount: number;
}

const SLAB_WARP_PERIOD_PER_TILE = 4;
const SLAB_WARP_AMPLITUDE = 2.6;
const SLAB_FACE_GRAIN_PERIOD_PER_TILE = 8;
const SLAB_FACE_GRAIN_STRENGTH = 0.14;
const SLAB_TONE_SPREAD = 0.3;
const SLAB_TONE_FLOOR = 0.28;
const SLAB_BEVEL_BAND = 0.14;

function paintSlabs(ctx: PaintContext, options: SlabOptions): void {
  const tiles = ctx.size / TILE_PX;
  const cells = options.slabsPerTile * tiles;
  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 9,
      SLAB_WARP_AMPLITUDE,
      SLAB_WARP_PERIOD_PER_TILE * tiles,
    );
    const cell = ctx.noise.worley(warped.x, warped.y, cells, ctx.structure, 0.55);
    const jointDistance = cell.secondNearest - cell.nearest;

    const faceGrain =
      (ctx.noise.fbm(x, y, ctx.detail + 13, 3, SLAB_FACE_GRAIN_PERIOD_PER_TILE * tiles) - 0.5) *
      SLAB_FACE_GRAIN_STRENGTH;
    const face = sampleRamp(
      options.ramp,
      SLAB_TONE_FLOOR + cell.cellHash * SLAB_TONE_SPREAD + faceGrain,
    );

    if (jointDistance < options.jointWidth) {
      const depth = 1 - jointDistance / options.jointWidth;
      return mix(face, sampleRamp(options.jointRamp, cell.cellHash), depth * options.jointStrength);
    }
    // A narrow bevel just inside the joint gives the slab an edge without adding
    // a second line. Widening this is what makes slabs look inflated rather than
    // cut, so it stays a thin band and the relief stays gentle.
    if (jointDistance < options.jointWidth + SLAB_BEVEL_BAND) {
      const across = (jointDistance - options.jointWidth) / SLAB_BEVEL_BAND;
      const strength = options.bevelStrength * (1 - across);
      return shade(face, reliefFactor(cell.offsetX, cell.offsetY, strength));
    }
    return face;
  });

  const cracks = Math.round(options.crackCount * tiles * tiles);
  for (let i = 0; i < cracks; i++) {
    const x = hashLattice(i, 41, ctx.detail) * ctx.size;
    const y = hashLattice(i, 42, ctx.detail) * ctx.size;
    const angle = hashLattice(i, 43, ctx.detail) * Math.PI * 2;
    wrappedStroke(
      ctx.surface,
      x,
      y,
      Math.cos(angle),
      Math.sin(angle),
      14,
      options.ramp.shadow,
      0.22,
      0.7,
    );
  }
}

const plaza: Material = {
  id: 'plaza',
  label: 'Plaza flagstone',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSlabs(ctx, {
      slabsPerTile: 1.25,
      ramp: FLAGSTONE_RAMP,
      jointRamp: { ...DIRT_RAMP, mid: DIRT_RAMP.shadow },
      jointWidth: 0.1,
      jointStrength: 0.55,
      bevelStrength: 1.4,
      crackCount: 1.5,
    });
  },
};

// ── coursed masonry ────────────────────────────────────────────────────────

interface CoursedBlockOptions {
  /**
   * Courses across one game tile. `coursesPerTile * patchTiles` must come out a
   * whole **even** number — whole so the course lattice wraps, even so the
   * running bond's every-other-course shift has the same parity on both sides of
   * the patch joint. An odd count offsets the first course against the last and
   * every horizontal joint in the material steps at the seam.
   */
  readonly coursesPerTile: number;
  /** Blocks along a course per game tile; `* patchTiles` must be whole. */
  readonly blocksPerCoursePerTile: number;
  readonly ramp: Ramp;
  readonly jointRamp: Ramp;
  readonly jointPx: number;
  /** Peak opacity of the joint. Below 1 it reads as a recessed line of mortar
   *  rather than as an inked outline around every block. */
  readonly jointStrength: number;
  /** How far alternate courses shift, as a fraction of a block. */
  readonly bondOffset: number;
  /** Depth of the lit band along a block's top edge and the shadowed one along
   *  its bottom — the pair is what gives a block thickness. */
  readonly edgeBandPx: number;
  readonly topLight: number;
  readonly bottomShadow: number;
  readonly toneFloor: number;
  readonly toneSpread: number;
  readonly grainStrength: number;
  /** How far the joint lines wander, in pixels. Zero is a machine-laid block. */
  readonly jointWanderPx: number;
}

const COURSED_GRAIN_PERIOD_PER_TILE = 8;
const COURSED_WANDER_PERIOD_PER_TILE = 16;
const COURSED_BOND_PERIOD = 2;

/**
 * Where a ruled grid sits relative to the patch, as a fraction of one unit.
 *
 * A grid whose period divides the patch puts a joint at x = 0 by default, which
 * leaves each of the patch's two edges holding one half of the same line. The
 * profile across the boundary is symmetric, so it does not tear — but it is
 * still the worst available place for a hard line, because the patch boundary is
 * also where two differently-seeded *variants* meet, and the two halves of that
 * joint then take their grain and speckle from different detail seeds. It also
 * makes the seam audit compare a joint against a flat face and report a tear
 * that is not there: `f2_wall` scored 1.60 with the grid unshifted.
 *
 * The block offset is a **quarter** block, not a half. A running bond shifts
 * alternate courses by `bondOffset` of a block, and at the usual `bondOffset` of
 * 0.5 a half-block phase is exactly cancelled on every odd course — which put
 * the joint straight back on the boundary for half the wall and left `f2_wall`
 * at 1.50. A quarter clears both the shifted and the unshifted courses.
 */
const COURSE_PHASE_OFFSET = 0.5;
const BLOCK_PHASE_OFFSET = 0.25;

/**
 * Rectangular blocks in a running bond — brick paving, rubble walling, painted
 * blockwork.
 *
 * The block and course indices are taken from a *wrapped* warp of the sample
 * position and hashed through `positiveMod` against the counts in the patch, so
 * the last course of a patch is the neighbour of its first. Geometry comes from
 * `ctx.structure`, so every variant lays its blocks in the same places and two
 * variants meeting mid-floor keep one continuous bond.
 */
function paintCoursedBlocks(ctx: PaintContext, options: CoursedBlockOptions): void {
  const tiles = ctx.size / TILE_PX;
  const courseHeight = TILE_PX / options.coursesPerTile;
  const blockWidth = TILE_PX / options.blocksPerCoursePerTile;
  const coursesInPatch = options.coursesPerTile * tiles;
  const blocksInPatch = options.blocksPerCoursePerTile * tiles;

  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 4,
      options.jointWanderPx,
      COURSED_WANDER_PERIOD_PER_TILE * tiles,
    );
    const phasedY = warped.y + courseHeight * COURSE_PHASE_OFFSET;
    const course = Math.floor(phasedY / courseHeight);
    const localY = phasedY - course * courseHeight;
    const bondShift = positiveMod(course, COURSED_BOND_PERIOD) * options.bondOffset * blockWidth;
    const shiftedX = warped.x + blockWidth * BLOCK_PHASE_OFFSET + bondShift;
    const block = Math.floor(shiftedX / blockWidth);
    const localX = shiftedX - block * blockWidth;

    const blockHash = hashLattice(
      positiveMod(block, blocksInPatch),
      positiveMod(course, coursesInPatch),
      ctx.structure,
    );
    const grain =
      (ctx.noise.value(x, y, COURSED_GRAIN_PERIOD_PER_TILE * tiles, ctx.detail + 6) - 0.5) *
      options.grainStrength;
    const face = sampleRamp(
      options.ramp,
      options.toneFloor + blockHash * options.toneSpread + grain,
    );

    const edgeDistance = Math.min(localX, localY, blockWidth - localX, courseHeight - localY);
    if (edgeDistance < options.jointPx) {
      return mix(face, sampleRamp(options.jointRamp, blockHash), options.jointStrength);
    }
    const bandEnd = options.jointPx + options.edgeBandPx;
    if (localY < bandEnd) return shade(face, options.topLight);
    if (localY > courseHeight - bandEnd) return shade(face, options.bottomShadow);
    return face;
  });
}

// ── boarded floor ──────────────────────────────────────────────────────────

interface PlankOptions {
  /** Boards across one game tile; `* patchTiles` must be whole. */
  readonly boardsPerTile: number;
  /** Distance between a board's butt joints, in game tiles. `patchTiles /
   *  boardLengthTiles` must be whole or the joints tear at the patch edge. */
  readonly boardLengthTiles: number;
  readonly ramp: Ramp;
  readonly gapRamp: Ramp;
  readonly gapPx: number;
  readonly gapStrength: number;
  readonly bevelPx: number;
  readonly bevelStrength: number;
  readonly toneFloor: number;
  readonly toneSpread: number;
  readonly grainStrength: number;
}

const PLANK_WANDER_PX = 0.6;
const PLANK_WANDER_PERIOD_PER_TILE = 12;
/** Keeps a grain line off its own board's edges, where the bevel already is. */
const PLANK_GRAIN_MARGIN = 0.2;
/** Half-width of a grain line, as a fraction of the board's height. */
const PLANK_GRAIN_HALF_WIDTH = 0.07;
/** One seed per grain line. Two reads as sawn oak; more reads as corduroy. */
const PLANK_GRAIN_SEEDS: ReadonlyArray<number> = [71, 73];
/**
 * How many start offsets a board can take along its length.
 *
 * Quantised rather than continuous so that the half-step in `COURSE_PHASE_OFFSET`
 * keeps every one of them clear of the patch boundary. A continuous stagger puts
 * a butt joint on the boundary for roughly one board row in ten, and even though
 * that joint stays symmetric across the wrap it is still a hard line sitting
 * exactly where two variants meet — `f1_timber` scored 1.52 before this.
 */
const PLANK_STAGGER_STEPS = 4;

/**
 * Sawn boards running east–west, with staggered butt joints and a grain line or
 * two along each.
 *
 * Grain is drawn as lines at hashed heights inside a board rather than sampled
 * from a stretched noise field, because stretching a coordinate before sampling
 * breaks the wrap: `noise.value` wraps at the patch, and `x / 4` reaches the
 * patch edge a quarter of the way through its period.
 */
function paintPlanks(ctx: PaintContext, options: PlankOptions): void {
  const tiles = ctx.size / TILE_PX;
  const boardHeight = TILE_PX / options.boardsPerTile;
  const segmentWidth = TILE_PX * options.boardLengthTiles;
  const boardsInPatch = options.boardsPerTile * tiles;
  const segmentsInPatch = tiles / options.boardLengthTiles;

  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 8,
      PLANK_WANDER_PX,
      PLANK_WANDER_PERIOD_PER_TILE * tiles,
    );
    const phasedY = warped.y + boardHeight * COURSE_PHASE_OFFSET;
    const board = Math.floor(phasedY / boardHeight);
    const localY = phasedY - board * boardHeight;
    const boardIndex = positiveMod(board, boardsInPatch);

    // Each board carries its own start offset, so the butt joints do not line up
    // into one seam running across the whole floor.
    const staggerStep = Math.floor(
      hashLattice(boardIndex, 61, ctx.structure) * PLANK_STAGGER_STEPS,
    );
    const stagger = ((staggerStep + COURSE_PHASE_OFFSET) / PLANK_STAGGER_STEPS) * segmentWidth;
    const shiftedX = warped.x + stagger;
    const segment = Math.floor(shiftedX / segmentWidth);
    const localX = shiftedX - segment * segmentWidth;
    const segmentIndex = positiveMod(segment, segmentsInPatch);

    const boardHash = hashLattice(boardIndex, segmentIndex, ctx.structure);
    let face = sampleRamp(options.ramp, options.toneFloor + boardHash * options.toneSpread);

    const heightInBoard = localY / boardHeight;
    for (const grainSeed of PLANK_GRAIN_SEEDS) {
      const grainHeight =
        PLANK_GRAIN_MARGIN +
        hashLattice(boardIndex, segmentIndex, ctx.structure + grainSeed) *
          (1 - 2 * PLANK_GRAIN_MARGIN);
      const offGrain = Math.abs(heightInBoard - grainHeight);
      if (offGrain >= PLANK_GRAIN_HALF_WIDTH) continue;
      const depth = 1 - offGrain / PLANK_GRAIN_HALF_WIDTH;
      face = mix(face, options.ramp.shadow, depth * options.grainStrength);
    }

    const fromNorth = localY;
    const fromSouth = boardHeight - localY;
    const fromWest = localX;
    const fromEast = segmentWidth - localX;
    const edgeDistance = Math.min(fromNorth, fromSouth, fromWest, fromEast);
    if (edgeDistance < options.gapPx) {
      return mix(face, sampleRamp(options.gapRamp, boardHash), options.gapStrength);
    }

    const bevelEnd = options.gapPx + options.bevelPx;
    if (edgeDistance < bevelEnd) {
      const across = (edgeDistance - options.gapPx) / options.bevelPx;
      const strength = options.bevelStrength * (1 - across);
      const offsetX = fromWest === edgeDistance ? -1 : fromEast === edgeDistance ? 1 : 0;
      const offsetY = fromNorth === edgeDistance ? -1 : fromSouth === edgeDistance ? 1 : 0;
      return shade(face, reliefFactor(offsetX, offsetY, strength));
    }
    return face;
  });
}

// ── pressed steel ──────────────────────────────────────────────────────────

interface DiamondPlateOptions {
  /** Lozenge cells across one game tile. `cellsPerTile * patchTiles` must be a
   *  whole **even** number: whole so the cell grid wraps, even so the
   *  alternating lean has the same parity on both sides of the patch joint. */
  readonly cellsPerTile: number;
  readonly lozengeHalfLengthPx: number;
  readonly lozengeHalfWidthPx: number;
  /** Share of the lozenge spent falling away to the plate, as a fraction of its
   *  own extent. */
  readonly bevelBand: number;
  readonly topLight: number;
  readonly bevelStrength: number;
}

/** cos and sin of 45°, which is the only angle a lozenge is ever drawn at. */
const PLATE_AXIS = Math.SQRT1_2;
const PLATE_LEAN_PERIOD = 2;

/**
 * Raised lozenges over whatever is already on the surface — checker plate.
 *
 * Drawn on an exact grid with no warp at all, which is the point: floor 1 is
 * laid by hand and every joint in it wanders, so a machine-pressed pattern is
 * the cheapest way to say *this floor was made in a factory*.
 */
function paintDiamondPlate(ctx: PaintContext, options: DiamondPlateOptions): void {
  const cellSize = TILE_PX / options.cellsPerTile;

  ctx.surface.fill((x, y) => {
    const plate = ctx.surface.get(x, y);
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const localX = x - cellX * cellSize - cellSize / 2;
    const localY = y - cellY * cellSize - cellSize / 2;

    // Alternating lean is what makes this read as checker plate rather than as a
    // field of identical studs.
    const lean = positiveMod(cellX + cellY, PLATE_LEAN_PERIOD) === 0 ? 1 : -1;
    const along = (localX + lean * localY) * PLATE_AXIS;
    const across = (localY - lean * localX) * PLATE_AXIS;
    const outward =
      Math.abs(along) / options.lozengeHalfLengthPx + Math.abs(across) / options.lozengeHalfWidthPx;
    if (outward >= 1) return plate;

    const faceEnd = 1 - options.bevelBand;
    if (outward < faceEnd) return shade(plate, options.topLight);

    const downBevel = (outward - faceEnd) / options.bevelBand;
    const lit = reliefFactor(localX, localY, options.bevelStrength * downBevel);
    return shade(plate, options.topLight * lit);
  });
}

// ── marbling ───────────────────────────────────────────────────────────────

interface MarblingOptions {
  readonly periodPerTile: number;
  readonly octaves: number;
  readonly warpAmplitudePx: number;
  readonly warpPeriodPerTile: number;
  readonly strength: number;
}

const MARBLING_MIDPOINT = 0.5;

/**
 * Warped light-and-dark swirl over whatever is already on the surface, crossing
 * any joints under it — which is exactly what a sheet material does and a laid
 * one does not, so it is what separates vinyl from ceramic at a glance.
 */
function paintMarbling(
  ctx: PaintContext,
  ramp: Ramp,
  seed: number,
  options: MarblingOptions,
): void {
  const tiles = ctx.size / TILE_PX;
  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      seed + 1,
      options.warpAmplitudePx,
      options.warpPeriodPerTile * tiles,
    );
    const swirl = ctx.noise.fbm(
      warped.x,
      warped.y,
      seed,
      options.octaves,
      options.periodPerTile * tiles,
    );
    const tint = swirl < MARBLING_MIDPOINT ? ramp.shadow : ramp.light;
    const weight = Math.abs(swirl - MARBLING_MIDPOINT) * 2 * options.strength;
    return mix(ctx.surface.get(x, y), tint, weight);
  });
}

// ── poured slab ────────────────────────────────────────────────────────────

interface ControlJointOptions {
  /** Bays across one game tile. `TILE_PX / baysPerTile` must divide the patch
   *  size, or the grooves tear at the patch edge. */
  readonly baysPerTile: number;
  readonly widthPx: number;
  readonly strength: number;
  readonly ramp: Ramp;
  readonly wanderPx: number;
  readonly wanderPeriodPerTile: number;
}

/** Where a groove samples its ramp — near the shadow end, since it is a cut. */
const CONTROL_JOINT_RAMP_POSITION = 0.2;

/**
 * Straight grooves on a regular grid, cut into whatever is already on the
 * surface.
 *
 * A slab is poured in bays and cut so that it cracks where it is told to. This
 * is the only geometry on an otherwise jointless material, which is why the grid
 * is kept as coarse as it is — see rule 3 at the top of this file.
 */
function paintControlJoints(ctx: PaintContext, options: ControlJointOptions): void {
  const tiles = ctx.size / TILE_PX;
  const bay = TILE_PX / options.baysPerTile;
  ctx.surface.fill((x, y) => {
    const slab = ctx.surface.get(x, y);
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 11,
      options.wanderPx,
      options.wanderPeriodPerTile * tiles,
    );
    const phase = bay * COURSE_PHASE_OFFSET;
    const localX = positiveMod(warped.x + phase, bay);
    const localY = positiveMod(warped.y + phase, bay);
    const offGroove = Math.min(localX, bay - localX, localY, bay - localY);
    if (offGroove >= options.widthPx) return slab;
    const depth = 1 - offGroove / options.widthPx;
    return mix(
      slab,
      sampleRamp(options.ramp, CONTROL_JOINT_RAMP_POSITION),
      depth * options.strength,
    );
  });
}

// ── floor 1: the cellars ───────────────────────────────────────────────────
//
// Hand-laid, warm and old: limestone slabs over most of it, brick where a floor
// was repaved, oak boards where one was boxed in, and coal ash trodden into the
// rest. The five share a yellow-to-red cast, because hue is what a player reads
// before pattern at 32 px a tile, and it is the one property floor 2 must not
// share.

const F1_FLAGSTONE_SLABS_PER_TILE = 0.75;
const F1_FLAGSTONE_JOINT_WIDTH = 0.08;
const F1_FLAGSTONE_JOINT_STRENGTH = 0.45;
const F1_FLAGSTONE_BEVEL_STRENGTH = 1.1;
const F1_FLAGSTONE_CRACK_COUNT = 1.2;
const F1_FLAGSTONE_DAMP_COUNT = 4;
const F1_FLAGSTONE_DAMP_MIN_RADIUS = 6;
const F1_FLAGSTONE_DAMP_MAX_RADIUS = 17;
const F1_FLAGSTONE_DAMP_ALPHA = 0.13;
const F1_FLAGSTONE_DAMP_SOFTNESS = 1;

/**
 * Floor 1's calm bulk material: slabs a third again as wide as a game tile, with
 * mortar rather than shadow in the joints.
 *
 * Every other material on the floor is jointed at half a tile or less, so this
 * one carries the long stretches — see rule 3 at the top of this file.
 */
const cellarFlagstone: Material = {
  id: 'f1_flagstone',
  label: 'Cellar flagstone (calm bulk floor)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSlabs(ctx, {
      slabsPerTile: F1_FLAGSTONE_SLABS_PER_TILE,
      ramp: CELLAR_STONE_RAMP,
      jointRamp: { ...CELLAR_MORTAR_RAMP, mid: CELLAR_MORTAR_RAMP.shadow },
      jointWidth: F1_FLAGSTONE_JOINT_WIDTH,
      jointStrength: F1_FLAGSTONE_JOINT_STRENGTH,
      bevelStrength: F1_FLAGSTONE_BEVEL_STRENGTH,
      crackCount: F1_FLAGSTONE_CRACK_COUNT,
    });
    // Damp pooling in the low spots, crossing the joints. Without it the slabs
    // are uniform enough that a room reads as one flat tone.
    paintSpeckles(ctx, ctx.detail + 23, {
      count: F1_FLAGSTONE_DAMP_COUNT,
      minRadius: F1_FLAGSTONE_DAMP_MIN_RADIUS,
      maxRadius: F1_FLAGSTONE_DAMP_MAX_RADIUS,
      ramp: { ...CELLAR_STONE_RAMP, mid: CELLAR_STONE_RAMP.shadow },
      alpha: F1_FLAGSTONE_DAMP_ALPHA,
      softness: F1_FLAGSTONE_DAMP_SOFTNESS,
    });
  },
};

/**
 * One dressed flag to a game tile: the largest square unit that still reads as a
 * cut stone rather than as a blank panel, and calm enough to floor a whole room.
 */
const F1_FLAGS_TILES_PER_GAME_TILE = 1;
const F1_FLAGS_JOINT_WIDTH_PX = 1.2;
const F1_FLAGS_JOINT_STRENGTH = 0.45;
const F1_FLAGS_BEVEL_PX = 1.8;
const F1_FLAGS_BEVEL_STRENGTH = 0.9;
/** Wider than a fired tile's: no two blocks out of the same quarry match. */
const F1_FLAGS_TONE_SPREAD = 0.36;
const F1_FLAGS_WEAR_COUNT = 5;
const F1_FLAGS_WEAR_MIN_RADIUS = 5;
const F1_FLAGS_WEAR_MAX_RADIUS = 14;
const F1_FLAGS_WEAR_ALPHA = 0.14;
const F1_FLAGS_WEAR_SOFTNESS = 1;
const F1_FLAGS_CRACK_COUNT = 1.2;
const F1_FLAGS_CRACK_LENGTH_PX = 16;
const F1_FLAGS_CRACK_ALPHA = 0.22;
const F1_FLAGS_CRACK_TAPER = 0.75;

/**
 * Sandstone cut square and laid on ruled joints — the cellar's finished rooms.
 *
 * Square units on a grid, **not** a running bond. A bond of any kind is what a
 * wall is built in, and the brick this replaced read as masonry laid flat when it
 * was seen in a room rather than in a swatch. The same reasoning already governs
 * the Bopca station's floors; see the note above `paintCeramicTiles`.
 */
const cellarDressedFlags: Material = {
  id: 'f1_flags',
  label: 'Cellar dressed sandstone flags',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: F1_FLAGS_TILES_PER_GAME_TILE,
      ramp: CELLAR_DRESSED_STONE_RAMP,
      groutRamp: { ...CELLAR_MORTAR_RAMP, mid: CELLAR_MORTAR_RAMP.shadow },
      groutWidthPx: F1_FLAGS_JOINT_WIDTH_PX,
      groutStrength: F1_FLAGS_JOINT_STRENGTH,
      bevelPx: F1_FLAGS_BEVEL_PX,
      bevelStrength: F1_FLAGS_BEVEL_STRENGTH,
      toneSpread: F1_FLAGS_TONE_SPREAD,
      gridPhase: COURSE_PHASE_OFFSET,
    });
    paintMineralGrain(ctx, CELLAR_DRESSED_STONE_RAMP, ctx.detail + 29);
    // Both of these cross the joints, which is what stops a ruled grid of
    // near-identical squares reading as tiling rather than as stone.
    paintSpeckles(ctx, ctx.detail + 31, {
      count: F1_FLAGS_WEAR_COUNT,
      minRadius: F1_FLAGS_WEAR_MIN_RADIUS,
      maxRadius: F1_FLAGS_WEAR_MAX_RADIUS,
      ramp: { ...CELLAR_DRESSED_STONE_RAMP, mid: CELLAR_DRESSED_STONE_RAMP.shadow },
      alpha: F1_FLAGS_WEAR_ALPHA,
      softness: F1_FLAGS_WEAR_SOFTNESS,
    });
    const cracks = Math.round(F1_FLAGS_CRACK_COUNT * (ctx.size / TILE_PX) ** 2);
    for (let i = 0; i < cracks; i++) {
      const angle = hashLattice(i, 33, ctx.detail) * Math.PI * 2;
      wrappedStroke(
        ctx.surface,
        hashLattice(i, 34, ctx.detail) * ctx.size,
        hashLattice(i, 35, ctx.detail) * ctx.size,
        Math.cos(angle),
        Math.sin(angle),
        F1_FLAGS_CRACK_LENGTH_PX,
        CELLAR_DRESSED_STONE_RAMP.shadow,
        F1_FLAGS_CRACK_ALPHA,
        F1_FLAGS_CRACK_TAPER,
      );
    }
  },
};

const F1_TIMBER_BOARDS_PER_TILE = 2;
const F1_TIMBER_BOARD_LENGTH_TILES = 2;
const F1_TIMBER_GAP_PX = 1.2;
const F1_TIMBER_GAP_STRENGTH = 0.62;
const F1_TIMBER_BEVEL_PX = 1.4;
const F1_TIMBER_BEVEL_STRENGTH = 0.9;
const F1_TIMBER_TONE_FLOOR = 0.24;
const F1_TIMBER_TONE_SPREAD = 0.5;
const F1_TIMBER_GRAIN_STRENGTH = 0.3;
const F1_TIMBER_WEAR_COUNT = 7;
const F1_TIMBER_WEAR_MIN_RADIUS = 4;
const F1_TIMBER_WEAR_MAX_RADIUS = 12;
const F1_TIMBER_WEAR_ALPHA = 0.14;
const F1_TIMBER_WEAR_SOFTNESS = 1;

const cellarTimber: Material = {
  id: 'f1_timber',
  label: 'Cellar oak boarding',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintPlanks(ctx, {
      boardsPerTile: F1_TIMBER_BOARDS_PER_TILE,
      boardLengthTiles: F1_TIMBER_BOARD_LENGTH_TILES,
      ramp: CELLAR_TIMBER_RAMP,
      gapRamp: { ...CELLAR_TIMBER_RAMP, mid: shade(CELLAR_TIMBER_RAMP.shadow, 0.6) },
      gapPx: F1_TIMBER_GAP_PX,
      gapStrength: F1_TIMBER_GAP_STRENGTH,
      bevelPx: F1_TIMBER_BEVEL_PX,
      bevelStrength: F1_TIMBER_BEVEL_STRENGTH,
      toneFloor: F1_TIMBER_TONE_FLOOR,
      toneSpread: F1_TIMBER_TONE_SPREAD,
      grainStrength: F1_TIMBER_GRAIN_STRENGTH,
    });
    // Traffic polish, which crosses the boards and so keeps the floor from
    // reading as a stack of identical strips.
    paintSpeckles(ctx, ctx.detail + 31, {
      count: F1_TIMBER_WEAR_COUNT,
      minRadius: F1_TIMBER_WEAR_MIN_RADIUS,
      maxRadius: F1_TIMBER_WEAR_MAX_RADIUS,
      ramp: { ...CELLAR_TIMBER_RAMP, mid: CELLAR_TIMBER_RAMP.light },
      alpha: F1_TIMBER_WEAR_ALPHA,
      softness: F1_TIMBER_WEAR_SOFTNESS,
    });
  },
};

const F1_CINDER_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.4, contrast: 0.9 };
const F1_CINDER_ASH_COUNT = 7;
const F1_CINDER_ASH_MIN_RADIUS = 4;
const F1_CINDER_ASH_MAX_RADIUS = 13;
const F1_CINDER_ASH_ALPHA = 0.16;
const F1_CINDER_ASH_SOFTNESS = 1;
const F1_CINDER_COAL_COUNT = 44;
const F1_CINDER_COAL_MIN_RADIUS = 0.6;
const F1_CINDER_COAL_MAX_RADIUS = 2.1;
const F1_CINDER_COAL_ALPHA = 0.5;
const F1_CINDER_COAL_SOFTNESS = 0.4;

/**
 * The floor's darkest end, and the only jointless one — so like the flagstone it
 * can hold a whole room without adding a second grid to the level.
 *
 * "Darkest" is relative to the other three floors, not to the wall. See
 * `CELLAR_TIMBER_RAMP` for why nothing on this level is allowed near the wall's
 * value.
 */
const cellarCinder: Material = {
  id: 'f1_cinder',
  label: 'Cellar ash floor (no joints)',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, CELLAR_CINDER_RAMP, F1_CINDER_GROUND);
    paintSpeckles(ctx, ctx.detail + 37, {
      count: F1_CINDER_ASH_COUNT,
      minRadius: F1_CINDER_ASH_MIN_RADIUS,
      maxRadius: F1_CINDER_ASH_MAX_RADIUS,
      ramp: { ...CELLAR_CINDER_RAMP, mid: CELLAR_CINDER_RAMP.light },
      alpha: F1_CINDER_ASH_ALPHA,
      softness: F1_CINDER_ASH_SOFTNESS,
    });
    paintMineralGrain(ctx, CELLAR_CINDER_RAMP, ctx.detail + 41);
    paintSpeckles(ctx, ctx.detail + 43, {
      count: F1_CINDER_COAL_COUNT,
      minRadius: F1_CINDER_COAL_MIN_RADIUS,
      maxRadius: F1_CINDER_COAL_MAX_RADIUS,
      ramp: { ...CELLAR_CINDER_RAMP, mid: CELLAR_CINDER_RAMP.shadow },
      alpha: F1_CINDER_COAL_ALPHA,
      softness: F1_CINDER_COAL_SOFTNESS,
    });
  },
};

const F1_WALL_COURSES_PER_TILE = 2;
const F1_WALL_BLOCKS_PER_COURSE_PER_TILE = 1;
const F1_WALL_JOINT_PX = 1.8;
const F1_WALL_JOINT_STRENGTH = 0.85;
const F1_WALL_BOND_OFFSET = 0.5;
const F1_WALL_EDGE_BAND_PX = 1.8;
const F1_WALL_TOP_LIGHT = 1.18;
const F1_WALL_BOTTOM_SHADOW = 0.76;
const F1_WALL_TONE_FLOOR = 0.2;
const F1_WALL_TONE_SPREAD = 0.5;
const F1_WALL_GRAIN_STRENGTH = 0.18;
const F1_WALL_JOINT_WANDER_PX = 1.3;
const F1_WALL_PIT_COUNT = 26;
const F1_WALL_PIT_MIN_RADIUS = 0.7;
const F1_WALL_PIT_MAX_RADIUS = 2.2;
const F1_WALL_PIT_ALPHA = 0.28;
const F1_WALL_PIT_SOFTNESS = 0.6;

/**
 * Rubble masonry. Hard joints are wanted here and only here: the relief is what
 * tells the player they cannot walk through it.
 */
const cellarWall: Material = {
  id: 'f1_wall',
  label: 'Cellar rubble wall',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintCoursedBlocks(ctx, {
      coursesPerTile: F1_WALL_COURSES_PER_TILE,
      blocksPerCoursePerTile: F1_WALL_BLOCKS_PER_COURSE_PER_TILE,
      ramp: CELLAR_WALL_RAMP,
      jointRamp: { ...CELLAR_WALL_RAMP, mid: shade(CELLAR_WALL_RAMP.shadow, 0.7) },
      jointPx: F1_WALL_JOINT_PX,
      jointStrength: F1_WALL_JOINT_STRENGTH,
      bondOffset: F1_WALL_BOND_OFFSET,
      edgeBandPx: F1_WALL_EDGE_BAND_PX,
      topLight: F1_WALL_TOP_LIGHT,
      bottomShadow: F1_WALL_BOTTOM_SHADOW,
      toneFloor: F1_WALL_TONE_FLOOR,
      toneSpread: F1_WALL_TONE_SPREAD,
      grainStrength: F1_WALL_GRAIN_STRENGTH,
      jointWanderPx: F1_WALL_JOINT_WANDER_PX,
    });
    paintSpeckles(ctx, ctx.detail + 47, {
      count: F1_WALL_PIT_COUNT,
      minRadius: F1_WALL_PIT_MIN_RADIUS,
      maxRadius: F1_WALL_PIT_MAX_RADIUS,
      ramp: { ...CELLAR_WALL_RAMP, mid: CELLAR_WALL_RAMP.shadow },
      alpha: F1_WALL_PIT_ALPHA,
      softness: F1_WALL_PIT_SOFTNESS,
    });
  },
};

// ── floor 2: the service level ─────────────────────────────────────────────
//
// Poured, pressed and bolted rather than laid. Everything is cool grey or an
// institutional green, every unit is machine-exact, and nothing weathers — so a
// player who has just come down the stairs knows before reading a word that they
// are not on floor 1 any more. Still unmistakably indoors: a concrete slab,
// terrazzo, checker plate and painted blockwork are all building materials, and
// none of them belongs outside.

const F2_CONCRETE_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.42, contrast: 0.95 };
const F2_CONCRETE_STAIN_COUNT = 4;
const F2_CONCRETE_STAIN_MIN_RADIUS = 7;
const F2_CONCRETE_STAIN_MAX_RADIUS = 19;
const F2_CONCRETE_STAIN_ALPHA = 0.17;
const F2_CONCRETE_STAIN_SOFTNESS = 1;
const F2_CONCRETE_CRACK_COUNT = 2;
const F2_CONCRETE_CRACK_LENGTH_PX = 20;
const F2_CONCRETE_CRACK_ALPHA = 0.26;
const F2_CONCRETE_CRACK_TAPER = 0.8;
/** One bay every four tiles, which is about where a real slab is cut. */
const F2_CONCRETE_CONTROL_JOINTS: ControlJointOptions = {
  baysPerTile: 0.25,
  widthPx: 3,
  strength: 0.55,
  ramp: POURED_CONCRETE_RAMP,
  wanderPx: 0.5,
  wanderPeriodPerTile: 16,
};

/**
 * Floor 2's calm bulk material: a poured slab, jointless except for the control
 * joints cut across it every four tiles.
 */
const serviceConcrete: Material = {
  id: 'f2_concrete',
  label: 'Poured concrete slab (calm bulk floor)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintNoiseGround(ctx, POURED_CONCRETE_RAMP, F2_CONCRETE_GROUND);
    paintSpeckles(ctx, ctx.detail + 53, {
      count: F2_CONCRETE_STAIN_COUNT,
      minRadius: F2_CONCRETE_STAIN_MIN_RADIUS,
      maxRadius: F2_CONCRETE_STAIN_MAX_RADIUS,
      ramp: { ...POURED_CONCRETE_RAMP, mid: POURED_CONCRETE_RAMP.shadow },
      alpha: F2_CONCRETE_STAIN_ALPHA,
      softness: F2_CONCRETE_STAIN_SOFTNESS,
    });
    paintMineralGrain(ctx, POURED_CONCRETE_RAMP, ctx.detail + 59);

    const cracks = Math.round(F2_CONCRETE_CRACK_COUNT * (ctx.size / TILE_PX) ** 2);
    for (let i = 0; i < cracks; i++) {
      const angle = hashLattice(i, 81, ctx.detail) * Math.PI * 2;
      wrappedStroke(
        ctx.surface,
        hashLattice(i, 82, ctx.detail) * ctx.size,
        hashLattice(i, 83, ctx.detail) * ctx.size,
        Math.cos(angle),
        Math.sin(angle),
        F2_CONCRETE_CRACK_LENGTH_PX,
        POURED_CONCRETE_RAMP.shadow,
        F2_CONCRETE_CRACK_ALPHA,
        F2_CONCRETE_CRACK_TAPER,
      );
    }
    paintControlJoints(ctx, F2_CONCRETE_CONTROL_JOINTS);
  },
};

const F2_TERRAZZO_TILES_PER_GAME_TILE = 1;
const F2_TERRAZZO_GROUT_WIDTH_PX = 1;
const F2_TERRAZZO_GROUT_STRENGTH = 0.4;
const F2_TERRAZZO_BEVEL_PX = 1.2;
const F2_TERRAZZO_BEVEL_STRENGTH = 0.5;
const F2_TERRAZZO_TONE_SPREAD = 0.12;
const F2_TERRAZZO_CHIP_COUNT = 210;
const F2_TERRAZZO_CHIP_MIN_RADIUS = 0.5;
const F2_TERRAZZO_CHIP_MAX_RADIUS = 1.8;
const F2_TERRAZZO_CHIP_ALPHA = 0.62;
const F2_TERRAZZO_CHIP_SOFTNESS = 0.25;

/**
 * Terrazzo: pale panels divided by thin strips, with the aggregate scattered
 * across them.
 *
 * The chips carry all the detail, which is why the panel joint can stay as faint
 * as it does — a whole corridor of this needs to be readable, not busy.
 */
const serviceTerrazzo: Material = {
  id: 'f2_terrazzo',
  label: 'Terrazzo panel floor',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: F2_TERRAZZO_TILES_PER_GAME_TILE,
      ramp: TERRAZZO_RAMP,
      groutRamp: { ...TERRAZZO_RAMP, mid: TERRAZZO_RAMP.shadow },
      groutWidthPx: F2_TERRAZZO_GROUT_WIDTH_PX,
      groutStrength: F2_TERRAZZO_GROUT_STRENGTH,
      bevelPx: F2_TERRAZZO_BEVEL_PX,
      bevelStrength: F2_TERRAZZO_BEVEL_STRENGTH,
      toneSpread: F2_TERRAZZO_TONE_SPREAD,
      gridPhase: COURSE_PHASE_OFFSET,
    });
    paintSpeckles(ctx, ctx.detail + 61, {
      count: F2_TERRAZZO_CHIP_COUNT,
      minRadius: F2_TERRAZZO_CHIP_MIN_RADIUS,
      maxRadius: F2_TERRAZZO_CHIP_MAX_RADIUS,
      ramp: TERRAZZO_CHIP_RAMP,
      alpha: F2_TERRAZZO_CHIP_ALPHA,
      softness: F2_TERRAZZO_CHIP_SOFTNESS,
    });
  },
};

const F2_VINYL_TILES_PER_GAME_TILE = 2;
const F2_VINYL_GROUT_WIDTH_PX = 0.8;
const F2_VINYL_GROUT_STRENGTH = 0.3;
const F2_VINYL_BEVEL_PX = 1;
const F2_VINYL_BEVEL_STRENGTH = 0.35;
const F2_VINYL_TONE_SPREAD = 0.14;
const F2_VINYL_MARBLING: MarblingOptions = {
  periodPerTile: 6,
  octaves: 3,
  warpAmplitudePx: 5,
  warpPeriodPerTile: 10,
  strength: 0.5,
};

/**
 * Institutional vinyl tile: small squares, faint seams, and a marbled swirl that
 * runs straight across them.
 *
 * The swirl is the whole point. Ignoring the seams under it is what a sheet
 * material does and a laid one cannot, so it separates this from the terrazzo at
 * a glance even though both are square units on a grid.
 */
const serviceVinyl: Material = {
  id: 'f2_vinyl',
  label: 'Institutional vinyl tile',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: F2_VINYL_TILES_PER_GAME_TILE,
      ramp: INSTITUTIONAL_VINYL_RAMP,
      groutRamp: { ...INSTITUTIONAL_VINYL_RAMP, mid: INSTITUTIONAL_VINYL_RAMP.shadow },
      groutWidthPx: F2_VINYL_GROUT_WIDTH_PX,
      groutStrength: F2_VINYL_GROUT_STRENGTH,
      bevelPx: F2_VINYL_BEVEL_PX,
      bevelStrength: F2_VINYL_BEVEL_STRENGTH,
      toneSpread: F2_VINYL_TONE_SPREAD,
      gridPhase: COURSE_PHASE_OFFSET,
    });
    paintMarbling(ctx, INSTITUTIONAL_VINYL_RAMP, ctx.detail + 67, F2_VINYL_MARBLING);
  },
};

const F2_PLATE_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.35, contrast: 0.55 };
const F2_PLATE_CELLS_PER_TILE = 2;
const F2_PLATE_LOZENGE_HALF_LENGTH_PX = 15;
const F2_PLATE_LOZENGE_HALF_WIDTH_PX = 5;
const F2_PLATE_BEVEL_BAND = 0.34;
const F2_PLATE_TOP_LIGHT = 1.2;
const F2_PLATE_BEVEL_STRENGTH = 1.8;
const F2_PLATE_SCUFF_COUNT = 5;
const F2_PLATE_SCUFF_MIN_RADIUS = 5;
const F2_PLATE_SCUFF_MAX_RADIUS = 14;
const F2_PLATE_SCUFF_ALPHA = 0.14;
const F2_PLATE_SCUFF_SOFTNESS = 1;

/** Floor 2's dark end, in the same slot floor 1 fills with trodden ash. */
const servicePlate: Material = {
  id: 'f2_plate',
  label: 'Steel checker plate',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintNoiseGround(ctx, STEEL_PLATE_RAMP, F2_PLATE_GROUND);
    paintMineralGrain(ctx, STEEL_PLATE_RAMP, ctx.detail + 71);
    paintDiamondPlate(ctx, {
      cellsPerTile: F2_PLATE_CELLS_PER_TILE,
      lozengeHalfLengthPx: F2_PLATE_LOZENGE_HALF_LENGTH_PX,
      lozengeHalfWidthPx: F2_PLATE_LOZENGE_HALF_WIDTH_PX,
      bevelBand: F2_PLATE_BEVEL_BAND,
      topLight: F2_PLATE_TOP_LIGHT,
      bevelStrength: F2_PLATE_BEVEL_STRENGTH,
    });
    // Over the lozenges rather than under them: traffic wears the raised pattern
    // first, so the scuffing has to cross it.
    paintSpeckles(ctx, ctx.detail + 73, {
      count: F2_PLATE_SCUFF_COUNT,
      minRadius: F2_PLATE_SCUFF_MIN_RADIUS,
      maxRadius: F2_PLATE_SCUFF_MAX_RADIUS,
      ramp: { ...STEEL_PLATE_RAMP, mid: STEEL_PLATE_RAMP.light },
      alpha: F2_PLATE_SCUFF_ALPHA,
      softness: F2_PLATE_SCUFF_SOFTNESS,
    });
  },
};

const F2_WALL_COURSES_PER_TILE = 1;
const F2_WALL_BLOCKS_PER_COURSE_PER_TILE = 0.5;
const F2_WALL_JOINT_PX = 2.2;
const F2_WALL_JOINT_STRENGTH = 0.8;
const F2_WALL_BOND_OFFSET = 0.5;
const F2_WALL_EDGE_BAND_PX = 2;
const F2_WALL_TOP_LIGHT = 1.16;
const F2_WALL_BOTTOM_SHADOW = 0.78;
const F2_WALL_TONE_FLOOR = 0.3;
const F2_WALL_TONE_SPREAD = 0.24;
const F2_WALL_GRAIN_STRENGTH = 0.12;
const F2_WALL_JOINT_WANDER_PX = 0.3;
const F2_WALL_POROSITY_COUNT = 40;
const F2_WALL_POROSITY_MIN_RADIUS = 0.5;
const F2_WALL_POROSITY_MAX_RADIUS = 1.5;
const F2_WALL_POROSITY_ALPHA = 0.2;
const F2_WALL_POROSITY_SOFTNESS = 0.5;

/**
 * Painted blockwork: one course to a tile, two tiles to a block, and barely any
 * tone variation between them.
 *
 * Everything that makes floor 1's wall read as hand-built is inverted here — the
 * units are four times the area, the joints hardly wander, and a coat of paint
 * has flattened the stone out. It is the single biggest visual difference
 * between the two floors, because a wall is most of what is on screen in a
 * corridor.
 */
const serviceWall: Material = {
  id: 'f2_wall',
  label: 'Painted blockwork wall',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCoursedBlocks(ctx, {
      coursesPerTile: F2_WALL_COURSES_PER_TILE,
      blocksPerCoursePerTile: F2_WALL_BLOCKS_PER_COURSE_PER_TILE,
      ramp: CINDERBLOCK_RAMP,
      jointRamp: { ...CINDERBLOCK_RAMP, mid: shade(CINDERBLOCK_RAMP.shadow, 0.72) },
      jointPx: F2_WALL_JOINT_PX,
      jointStrength: F2_WALL_JOINT_STRENGTH,
      bondOffset: F2_WALL_BOND_OFFSET,
      edgeBandPx: F2_WALL_EDGE_BAND_PX,
      topLight: F2_WALL_TOP_LIGHT,
      bottomShadow: F2_WALL_BOTTOM_SHADOW,
      toneFloor: F2_WALL_TONE_FLOOR,
      toneSpread: F2_WALL_TONE_SPREAD,
      grainStrength: F2_WALL_GRAIN_STRENGTH,
      jointWanderPx: F2_WALL_JOINT_WANDER_PX,
    });
    // The open pores a breeze block keeps however many coats it is given.
    paintSpeckles(ctx, ctx.detail + 79, {
      count: F2_WALL_POROSITY_COUNT,
      minRadius: F2_WALL_POROSITY_MIN_RADIUS,
      maxRadius: F2_WALL_POROSITY_MAX_RADIUS,
      ramp: { ...CINDERBLOCK_RAMP, mid: CINDERBLOCK_RAMP.shadow },
      alpha: F2_WALL_POROSITY_ALPHA,
      softness: F2_WALL_POROSITY_SOFTNESS,
    });
  },
};

// ── town building interiors ────────────────────────────────────────────────
//
// A shop, a house and the tower, seen from inside. These exist because those
// three used to be floored and walled in the dungeon's generic tile types and so
// wore whichever cellar's art was loaded; see the note above `INTERIOR_WALL` in
// `src/map/tileTypes.ts`.

const INTERIOR_BOARDS_PER_TILE = 2;
const INTERIOR_BOARD_LENGTH_TILES = 2;
const INTERIOR_BOARD_GAP_PX = 1;
const INTERIOR_BOARD_GAP_STRENGTH = 0.5;
const INTERIOR_BOARD_BEVEL_PX = 1.4;
const INTERIOR_BOARD_BEVEL_STRENGTH = 0.7;
const INTERIOR_BOARD_TONE_FLOOR = 0.3;
const INTERIOR_BOARD_TONE_SPREAD = 0.42;
const INTERIOR_BOARD_GRAIN_STRENGTH = 0.24;
const INTERIOR_BOARD_POLISH_COUNT = 6;
const INTERIOR_BOARD_POLISH_MIN_RADIUS = 5;
const INTERIOR_BOARD_POLISH_MAX_RADIUS = 14;
const INTERIOR_BOARD_POLISH_ALPHA = 0.13;
const INTERIOR_BOARD_POLISH_SOFTNESS = 1;

/**
 * A shop's and a house's floor: the same joinery as the cellar's boarding, but
 * finished — narrower gaps, a shallower bevel and a wax sheen over the top.
 */
const interiorBoards: Material = {
  id: 'interior_boards',
  label: 'Interior board floor (shop, house)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintPlanks(ctx, {
      boardsPerTile: INTERIOR_BOARDS_PER_TILE,
      boardLengthTiles: INTERIOR_BOARD_LENGTH_TILES,
      ramp: INTERIOR_BOARD_RAMP,
      gapRamp: { ...INTERIOR_BOARD_RAMP, mid: shade(INTERIOR_BOARD_RAMP.shadow, 0.7) },
      gapPx: INTERIOR_BOARD_GAP_PX,
      gapStrength: INTERIOR_BOARD_GAP_STRENGTH,
      bevelPx: INTERIOR_BOARD_BEVEL_PX,
      bevelStrength: INTERIOR_BOARD_BEVEL_STRENGTH,
      toneFloor: INTERIOR_BOARD_TONE_FLOOR,
      toneSpread: INTERIOR_BOARD_TONE_SPREAD,
      grainStrength: INTERIOR_BOARD_GRAIN_STRENGTH,
    });
    // Wax, pooled where the room is walked. Crosses the boards, which is what
    // separates a swept shop floor from a cellar's bare planking.
    paintSpeckles(ctx, ctx.detail + 83, {
      count: INTERIOR_BOARD_POLISH_COUNT,
      minRadius: INTERIOR_BOARD_POLISH_MIN_RADIUS,
      maxRadius: INTERIOR_BOARD_POLISH_MAX_RADIUS,
      ramp: { ...INTERIOR_BOARD_RAMP, mid: INTERIOR_BOARD_RAMP.light },
      alpha: INTERIOR_BOARD_POLISH_ALPHA,
      softness: INTERIOR_BOARD_POLISH_SOFTNESS,
    });
  },
};

const INTERIOR_STONE_TILES_PER_GAME_TILE = 1;
const INTERIOR_STONE_JOINT_WIDTH_PX = 1.1;
const INTERIOR_STONE_JOINT_STRENGTH = 0.42;
const INTERIOR_STONE_BEVEL_PX = 1.6;
const INTERIOR_STONE_BEVEL_STRENGTH = 0.8;
const INTERIOR_STONE_TONE_SPREAD = 0.3;

/** The tower's floor: flags cut square and laid true, as a mason would. */
const interiorStone: Material = {
  id: 'interior_stone',
  label: 'Interior flagged stone (tower)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: INTERIOR_STONE_TILES_PER_GAME_TILE,
      ramp: INTERIOR_STONE_RAMP,
      groutRamp: { ...INTERIOR_STONE_RAMP, mid: INTERIOR_STONE_RAMP.shadow },
      groutWidthPx: INTERIOR_STONE_JOINT_WIDTH_PX,
      groutStrength: INTERIOR_STONE_JOINT_STRENGTH,
      bevelPx: INTERIOR_STONE_BEVEL_PX,
      bevelStrength: INTERIOR_STONE_BEVEL_STRENGTH,
      toneSpread: INTERIOR_STONE_TONE_SPREAD,
      gridPhase: COURSE_PHASE_OFFSET,
    });
    paintMineralGrain(ctx, INTERIOR_STONE_RAMP, ctx.detail + 89);
  },
};

const INTERIOR_PLASTER_GROUND: GroundOptions = {
  patchPeriod: 8,
  patchWeight: 0.45,
  contrast: 0.6,
};
const INTERIOR_PLASTER_TROWEL_COUNT = 9;
const INTERIOR_PLASTER_TROWEL_MIN_RADIUS = 5;
const INTERIOR_PLASTER_TROWEL_MAX_RADIUS = 16;
const INTERIOR_PLASTER_TROWEL_ALPHA = 0.12;
const INTERIOR_PLASTER_TROWEL_SOFTNESS = 1;
const INTERIOR_PLASTER_STAIN_COUNT = 5;
const INTERIOR_PLASTER_STAIN_MIN_RADIUS = 3;
const INTERIOR_PLASTER_STAIN_MAX_RADIUS = 9;
const INTERIOR_PLASTER_STAIN_ALPHA = 0.14;
const INTERIOR_PLASTER_STAIN_SOFTNESS = 0.9;

/**
 * Lime plaster: no joints at all, because plaster is a skin rather than a bond.
 *
 * That absence is the whole design. The dungeon walls are coursed, and coursing
 * is what says "quarried and stacked"; a wall with nothing but trowel marks on
 * it says "finished room" without a single line being drawn.
 */
const interiorPlaster: Material = {
  id: 'interior_plaster',
  label: 'Interior plastered wall',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, INTERIOR_PLASTER_RAMP, INTERIOR_PLASTER_GROUND);
    paintSpeckles(ctx, ctx.detail + 91, {
      count: INTERIOR_PLASTER_TROWEL_COUNT,
      minRadius: INTERIOR_PLASTER_TROWEL_MIN_RADIUS,
      maxRadius: INTERIOR_PLASTER_TROWEL_MAX_RADIUS,
      ramp: { ...INTERIOR_PLASTER_RAMP, mid: INTERIOR_PLASTER_RAMP.light },
      alpha: INTERIOR_PLASTER_TROWEL_ALPHA,
      softness: INTERIOR_PLASTER_TROWEL_SOFTNESS,
    });
    paintSpeckles(ctx, ctx.detail + 97, {
      count: INTERIOR_PLASTER_STAIN_COUNT,
      minRadius: INTERIOR_PLASTER_STAIN_MIN_RADIUS,
      maxRadius: INTERIOR_PLASTER_STAIN_MAX_RADIUS,
      ramp: { ...INTERIOR_PLASTER_RAMP, mid: INTERIOR_PLASTER_RAMP.shadow },
      alpha: INTERIOR_PLASTER_STAIN_ALPHA,
      softness: INTERIOR_PLASTER_STAIN_SOFTNESS,
    });
  },
};

const INTERIOR_COUNTER_BOARDS_PER_TILE = 1;
const INTERIOR_COUNTER_BOARD_LENGTH_TILES = 4;
const INTERIOR_COUNTER_GAP_PX = 1.2;
const INTERIOR_COUNTER_GAP_STRENGTH = 0.7;
const INTERIOR_COUNTER_BEVEL_PX = 2.2;
const INTERIOR_COUNTER_BEVEL_STRENGTH = 1.6;
const INTERIOR_COUNTER_TONE_FLOOR = 0.26;
const INTERIOR_COUNTER_TONE_SPREAD = 0.34;
const INTERIOR_COUNTER_GRAIN_STRENGTH = 0.3;

/**
 * A counter top: one wide board to a tile, running the length of the counter.
 *
 * Boards four times the size of the floor's and a bevel twice as deep, so the
 * run reads as a raised slab of joinery the player cannot walk through rather
 * than as more floor in a darker colour.
 */
const interiorCounter: Material = {
  id: 'interior_counter',
  label: 'Interior counter / bar top',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintPlanks(ctx, {
      boardsPerTile: INTERIOR_COUNTER_BOARDS_PER_TILE,
      boardLengthTiles: INTERIOR_COUNTER_BOARD_LENGTH_TILES,
      ramp: INTERIOR_COUNTER_RAMP,
      gapRamp: { ...INTERIOR_COUNTER_RAMP, mid: shade(INTERIOR_COUNTER_RAMP.shadow, 0.55) },
      gapPx: INTERIOR_COUNTER_GAP_PX,
      gapStrength: INTERIOR_COUNTER_GAP_STRENGTH,
      bevelPx: INTERIOR_COUNTER_BEVEL_PX,
      bevelStrength: INTERIOR_COUNTER_BEVEL_STRENGTH,
      toneFloor: INTERIOR_COUNTER_TONE_FLOOR,
      toneSpread: INTERIOR_COUNTER_TONE_SPREAD,
      grainStrength: INTERIOR_COUNTER_GRAIN_STRENGTH,
    });
  },
};

// ── Bopca station set ──────────────────────────────────────────────────────
//
// A safe room is a waystation mess hall on floors 1 and 2, both of which are
// **indoors**. That is the whole reason these three are laid on a regular grid
// rather than built from Worley cells like `plaza` and `dungeon_flagstone`: an
// irregular cell with a rounded bevel is a cobble or a flagstone, and a floor of
// them reads as a courtyard however warm the palette is. Screenshotted in-game,
// the first cut of these materials made the safe room look like it had been
// carved out of the open air. Square units on straight grout lines are what say
// *tiled room*.

interface CeramicOptions {
  /** Ceramic tiles across one game tile. Must multiply with the material's
   *  `patchTiles` to a whole number, or the grid stops wrapping and the patch
   *  edges seam. */
  readonly tilesPerGameTile: number;
  readonly ramp: Ramp;
  readonly groutRamp: Ramp;
  readonly groutWidthPx: number;
  /** Peak opacity of the grout. Below 1 it reads as a recessed line rather than
   *  an inked outline, which is what keeps a whole tiled room calm. */
  readonly groutStrength: number;
  readonly bevelPx: number;
  readonly bevelStrength: number;
  /** Per-tile tone variance. Fired ceramic varies, but only a little. */
  readonly toneSpread: number;
  /**
   * Where the grid sits relative to the patch, as a fraction of a ceramic tile —
   * see `COURSE_PHASE_OFFSET` for why a grid should generally not sit at zero.
   *
   * The Bopca station's floors are the exception and pass zero deliberately: the
   * counter run, the galley strip and the rug are laid out on whole game tiles,
   * so the grout has to agree with the game grid or every fixture in the room
   * sits half a tile off its own floor.
   */
  readonly gridPhase: number;
}

/**
 * Where a tile's own hash starts on the ramp, and — with `toneSpread` — how far
 * it can travel.
 *
 * Kept on one side of the ramp's midpoint on purpose. A range that straddles it
 * splits every tile into "sampled shadow→mid" or "sampled mid→light", which is
 * bimodal rather than varied: the first cut spanned 0.30–0.56 and the floor came
 * out as a two-tone chessboard rather than fired ceramic.
 */
const CERAMIC_TONE_FLOOR = 0.5;
const CERAMIC_GRAIN_OCTAVES = 2;
const CERAMIC_GRAIN_PERIOD_PER_TILE = 24;
const CERAMIC_GRAIN_STRENGTH = 0.1;
/**
 * How far the grout lines wander, in pixels, and over what period.
 *
 * A fraction of a pixel, deliberately. Ruler-straight lines read as vinyl; this
 * much is a hand-laid floor. More than about a pixel and the grid starts to look
 * like crazy paving again, which is the thing these materials exist to avoid.
 */
const CERAMIC_LINE_WANDER_PX = 0.7;
/** The station's grout lines sit on the game grid — see `gridPhase`. */
const BOPCA_GRID_PHASE = 0;
const CERAMIC_WANDER_PERIOD_PER_TILE = 12;

/**
 * Square ceramic tiles on a regular grid, with grout lines and a lit bevel.
 *
 * The grid is indexed off a *wrapped* warp of the sample position, and the
 * per-tile hash takes `positiveMod` of the cell index against the cells in the
 * patch — so the last column of a patch is the neighbour of its first and the
 * joint cannot tear. Geometry comes from `ctx.structure`, so every variant of a
 * material lays its tiles in the same places and two variants meeting mid-floor
 * keep one continuous grid.
 */
function paintCeramicTiles(ctx: PaintContext, options: CeramicOptions): void {
  const tiles = ctx.size / TILE_PX;
  const cellSize = TILE_PX / options.tilesPerGameTile;
  const cellsAcross = options.tilesPerGameTile * tiles;

  ctx.surface.fill((x, y) => {
    const warped = ctx.noise.warp(
      x,
      y,
      ctx.structure + 7,
      CERAMIC_LINE_WANDER_PX,
      CERAMIC_WANDER_PERIOD_PER_TILE * tiles,
    );
    const phase = cellSize * options.gridPhase;
    const phasedX = warped.x + phase;
    const phasedY = warped.y + phase;
    const cellX = Math.floor(phasedX / cellSize);
    const cellY = Math.floor(phasedY / cellSize);
    const localX = phasedX - cellX * cellSize;
    const localY = phasedY - cellY * cellSize;

    const cellHash = hashLattice(
      positiveMod(cellX, cellsAcross),
      positiveMod(cellY, cellsAcross),
      ctx.structure,
    );
    const grain =
      (ctx.noise.fbm(
        x,
        y,
        ctx.detail + 3,
        CERAMIC_GRAIN_OCTAVES,
        CERAMIC_GRAIN_PERIOD_PER_TILE * tiles,
      ) -
        0.5) *
      CERAMIC_GRAIN_STRENGTH;
    const face = sampleRamp(
      options.ramp,
      CERAMIC_TONE_FLOOR + cellHash * options.toneSpread + grain,
    );

    // Distance to the nearest of the four edges, and which way that edge lies —
    // the bevel needs the direction to catch the light the same way the relief
    // on every other material does.
    const fromWest = localX;
    const fromNorth = localY;
    const fromEast = cellSize - localX;
    const fromSouth = cellSize - localY;
    const edgeDistance = Math.min(fromWest, fromNorth, fromEast, fromSouth);
    if (edgeDistance < options.groutWidthPx) {
      return mix(face, sampleRamp(options.groutRamp, cellHash), options.groutStrength);
    }

    const bevelEnd = options.groutWidthPx + options.bevelPx;
    if (edgeDistance < bevelEnd) {
      const across = (edgeDistance - options.groutWidthPx) / options.bevelPx;
      const strength = options.bevelStrength * (1 - across);
      const offsetX = fromWest === edgeDistance ? -1 : fromEast === edgeDistance ? 1 : 0;
      const offsetY = fromNorth === edgeDistance ? -1 : fromSouth === edgeDistance ? 1 : 0;
      return shade(face, reliefFactor(offsetX, offsetY, strength));
    }
    return face;
  });
}

/**
 * One glazed tile per game tile: the largest unit that still reads as ceramic
 * rather than as a slab, and the calmest thing a whole room can stand on.
 *
 * Must multiply with `patchTiles` to a whole number, or the grid stops wrapping.
 */
const BOPCA_TILE_TILES_PER_GAME_TILE = 1;
/**
 * A whole room stands on this, so its grout is the softest of the three. At 32 px
 * a tile a grout line lands every 32 screen pixels, and giving it `plaza`'s joint
 * strength turns the only room on the floor the player relaxes in into a lattice.
 */
const BOPCA_TILE_GROUT_WIDTH_PX = 1;
const BOPCA_TILE_GROUT_STRENGTH = 0.35;
const BOPCA_TILE_BEVEL_PX = 1.6;
const BOPCA_TILE_BEVEL_STRENGTH = 0.7;
const BOPCA_TILE_TONE_SPREAD = 0.16;
const BOPCA_TILE_SHEEN_COUNT = 3;
const BOPCA_TILE_SHEEN_MIN_RADIUS = 6;
const BOPCA_TILE_SHEEN_MAX_RADIUS = 15;
const BOPCA_TILE_SHEEN_ALPHA = 0.08;
const BOPCA_TILE_SHEEN_SOFTNESS = 1;

const bopcaTile: Material = {
  id: 'bopca_tile',
  label: 'Bopca station tile (glazed, calm)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: BOPCA_TILE_TILES_PER_GAME_TILE,
      ramp: BOPCA_TILE_RAMP,
      groutRamp: { ...BOPCA_TILE_RAMP, mid: BOPCA_TILE_RAMP.shadow },
      groutWidthPx: BOPCA_TILE_GROUT_WIDTH_PX,
      groutStrength: BOPCA_TILE_GROUT_STRENGTH,
      bevelPx: BOPCA_TILE_BEVEL_PX,
      bevelStrength: BOPCA_TILE_BEVEL_STRENGTH,
      toneSpread: BOPCA_TILE_TONE_SPREAD,
      gridPhase: BOPCA_GRID_PHASE,
    });
    // Broad, very faint pools of glaze highlight, crossing the grout rather than
    // respecting it — a fired floor catches the lamplight in patches, and without
    // them the calm grid leaves nothing at all for the eye to land on.
    paintSpeckles(ctx, ctx.detail + 37, {
      count: BOPCA_TILE_SHEEN_COUNT,
      minRadius: BOPCA_TILE_SHEEN_MIN_RADIUS,
      maxRadius: BOPCA_TILE_SHEEN_MAX_RADIUS,
      ramp: { ...BOPCA_TILE_RAMP, mid: BOPCA_TILE_RAMP.light },
      alpha: BOPCA_TILE_SHEEN_ALPHA,
      softness: BOPCA_TILE_SHEEN_SOFTNESS,
    });
  },
};

/**
 * Four small quarry tiles to a game tile. Half the room tile's unit size, which
 * is what makes the galley read as a different surface at a glance rather than
 * as the same floor in a different colour.
 */
const BOPCA_HEARTH_TILES_PER_GAME_TILE = 2;
const BOPCA_HEARTH_GROUT_WIDTH_PX = 1.2;
const BOPCA_HEARTH_GROUT_STRENGTH = 0.5;
const BOPCA_HEARTH_BEVEL_PX = 1.2;
const BOPCA_HEARTH_BEVEL_STRENGTH = 0.8;
const BOPCA_HEARTH_TONE_SPREAD = 0.2;
const BOPCA_HEARTH_SOOT_COUNT = 6;
const BOPCA_HEARTH_SOOT_MIN_RADIUS = 4;
const BOPCA_HEARTH_SOOT_MAX_RADIUS = 11;
const BOPCA_HEARTH_SOOT_ALPHA = 0.16;
const BOPCA_HEARTH_SOOT_SOFTNESS = 1;

const bopcaHearth: Material = {
  id: 'bopca_hearth',
  label: 'Bopca station quarry tile (galley)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintCeramicTiles(ctx, {
      tilesPerGameTile: BOPCA_HEARTH_TILES_PER_GAME_TILE,
      ramp: BOPCA_HEARTH_RAMP,
      groutRamp: { ...BOPCA_HEARTH_RAMP, mid: BOPCA_HEARTH_RAMP.shadow },
      groutWidthPx: BOPCA_HEARTH_GROUT_WIDTH_PX,
      groutStrength: BOPCA_HEARTH_GROUT_STRENGTH,
      bevelPx: BOPCA_HEARTH_BEVEL_PX,
      bevelStrength: BOPCA_HEARTH_BEVEL_STRENGTH,
      toneSpread: BOPCA_HEARTH_TONE_SPREAD,
      gridPhase: BOPCA_GRID_PHASE,
    });
    // Soot from the range, which is why the galley is laid in quarry tile in the
    // first place.
    paintSpeckles(ctx, ctx.detail + 41, {
      count: BOPCA_HEARTH_SOOT_COUNT,
      minRadius: BOPCA_HEARTH_SOOT_MIN_RADIUS,
      maxRadius: BOPCA_HEARTH_SOOT_MAX_RADIUS,
      ramp: { ...BOPCA_HEARTH_RAMP, mid: BOPCA_HEARTH_RAMP.shadow },
      alpha: BOPCA_HEARTH_SOOT_ALPHA,
      softness: BOPCA_HEARTH_SOOT_SOFTNESS,
    });
  },
};

const BOPCA_SCUFF_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.4, contrast: 0.8 };
const BOPCA_SCUFF_GRIT_COUNT = 34;
const BOPCA_SCUFF_GRIT_MIN_RADIUS = 0.6;
const BOPCA_SCUFF_GRIT_MAX_RADIUS = 1.6;
const BOPCA_SCUFF_GRIT_ALPHA = 0.4;
const BOPCA_SCUFF_GRIT_SOFTNESS = 0.4;
const BOPCA_SCUFF_WEAR_COUNT = 9;
const BOPCA_SCUFF_WEAR_MIN_RADIUS = 3;
const BOPCA_SCUFF_WEAR_MAX_RADIUS = 8;
const BOPCA_SCUFF_WEAR_ALPHA = 0.2;
const BOPCA_SCUFF_WEAR_SOFTNESS = 0.9;

/**
 * Where the tile has been walked off: bare grey screed, grit and scuffing.
 *
 * Deliberately *not* tiled. A threshold band is where the ceramic has worn
 * through, so it is the layer underneath rather than a third pattern — and it is
 * grey screed rather than anything sandy, because a warm loose surface indoors
 * reads as bare earth and puts the room back outside.
 */
const bopcaScuff: Material = {
  id: 'bopca_scuff',
  label: 'Bopca station worn threshold (bare screed)',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(ctx, BOPCA_SCUFF_RAMP, BOPCA_SCUFF_GROUND);
    paintSpeckles(ctx, ctx.detail + 43, {
      count: BOPCA_SCUFF_WEAR_COUNT,
      minRadius: BOPCA_SCUFF_WEAR_MIN_RADIUS,
      maxRadius: BOPCA_SCUFF_WEAR_MAX_RADIUS,
      ramp: { ...BOPCA_SCUFF_RAMP, mid: BOPCA_SCUFF_RAMP.shadow },
      alpha: BOPCA_SCUFF_WEAR_ALPHA,
      softness: BOPCA_SCUFF_WEAR_SOFTNESS,
    });
    paintMineralGrain(ctx, BOPCA_SCUFF_RAMP, ctx.detail + 47);
    paintSpeckles(ctx, ctx.detail + 53, {
      count: BOPCA_SCUFF_GRIT_COUNT,
      minRadius: BOPCA_SCUFF_GRIT_MIN_RADIUS,
      maxRadius: BOPCA_SCUFF_GRIT_MAX_RADIUS,
      ramp: GRAVEL_RAMP,
      alpha: BOPCA_SCUFF_GRIT_ALPHA,
      softness: BOPCA_SCUFF_GRIT_SOFTNESS,
    });
  },
};

export const MATERIALS: ReadonlyArray<Material> = [
  grass,
  verge,
  dirt,
  gravel,
  lane,
  cobble,
  plaza,
  water,
  highland,
  scree,
  cellarCinder,
  cellarFlagstone,
  cellarDressedFlags,
  cellarTimber,
  cellarWall,
  serviceConcrete,
  serviceVinyl,
  serviceTerrazzo,
  servicePlate,
  serviceWall,
  interiorBoards,
  interiorStone,
  interiorPlaster,
  interiorCounter,
  bopcaScuff,
  bopcaHearth,
  bopcaTile,
];

export function getMaterial(id: string): Material {
  const found = MATERIALS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`Unknown material '${id}'`);
  return found;
}

/** Paints one patch of a material. */
export function paintPatch(material: Material, structure: number, detail: number): Surface {
  const size = TILE_PX * material.patchTiles;
  const surface = new Surface(size);
  material.paint({ surface, size, noise: new NoiseField(size), structure, detail });
  return surface;
}
