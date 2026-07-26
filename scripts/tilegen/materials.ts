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
  wrappedChunk,
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
  DUNGEON_STONE_RAMP,
  MOSS_RAMP,
  DUNGEON_WALL_RAMP,
  WATER_RAMP,
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

// ── worked stone ───────────────────────────────────────────────────────────

interface SettOptions {
  /** Stones across one tile; the patch scales this up automatically. */
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
    const face = sampleRamp(
      options.ramp,
      SETT_TONE_FLOOR + cell.cellHash * SETT_TONE_SPREAD + faceGrain,
    );
    const lit = shade(face, reliefFactor(cell.offsetX, cell.offsetY, options.reliefStrength));

    return mix(lit, sampleRamp(options.jointRamp, cell.cellHash * SETT_TONE_SPREAD), jointBlend);
  });
}

const LANE_CELLS_PER_TILE = 7;
const LANE_JOINT_WIDTH = 0.3;
const LANE_JOINT_WEED_THRESHOLD = 0.72;
const LANE_WEED_COUNT = 70;

const lane: Material = {
  id: 'lane',
  label: 'Village lane',
  patchTiles: 4,
  variants: 3,
  paint: (ctx) => {
    paintSetts(ctx, {
      cellsPerTile: LANE_CELLS_PER_TILE,
      jitter: 0.85,
      ramp: STREET_STONE_RAMP,
      jointRamp: DIRT_RAMP,
      jointWidth: LANE_JOINT_WIDTH,
      jointStrength: 0.75,
      reliefStrength: 1.2,
      warpAmplitude: 1.6,
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

const cobble: Material = {
  id: 'cobble',
  label: 'Main street cobble',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSetts(ctx, {
      cellsPerTile: 5,
      jitter: 0.7,
      ramp: COBBLE_RAMP,
      jointRamp: { ...DIRT_RAMP, mid: DIRT_RAMP.shadow },
      jointWidth: 0.22,
      jointStrength: 0.8,
      reliefStrength: 1.8,
      warpAmplitude: 1.1,
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

// ── dungeon set ────────────────────────────────────────────────────────────

const DUNGEON_CALM_GROUND: GroundOptions = { patchPeriod: 8, patchWeight: 0.45, contrast: 0.75 };

/**
 * The dungeon's default floor: quiet mottled stone with no joints at all.
 *
 * Every material in the first draft of this sheet had hard paving joints, so
 * there was nothing that could hold a long stretch of floor without becoming a
 * grid. This is that missing material — lay it across the bulk of a room and use
 * the jointed variants for edges, thresholds and accents.
 */
const dungeonPlain: Material = {
  id: 'dungeon_plain',
  label: 'Dungeon stone (calm, no joints)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintNoiseGround(ctx, DUNGEON_STONE_RAMP, DUNGEON_CALM_GROUND);
    paintSpeckles(ctx, ctx.detail + 23, {
      count: 5,
      minRadius: 6,
      maxRadius: 16,
      ramp: { ...DUNGEON_STONE_RAMP, mid: DUNGEON_STONE_RAMP.shadow },
      alpha: 0.12,
      softness: 1,
    });
    paintMineralGrain(ctx, DUNGEON_STONE_RAMP, ctx.detail + 24);
  },
};

const dungeonFlagstone: Material = {
  id: 'dungeon_flagstone',
  label: 'Dungeon flagstone (large slabs)',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    paintSlabs(ctx, {
      slabsPerTile: 1,
      ramp: DUNGEON_STONE_RAMP,
      jointRamp: { ...DUNGEON_STONE_RAMP, mid: shade(DUNGEON_STONE_RAMP.shadow, 0.8) },
      jointWidth: 0.09,
      jointStrength: 0.5,
      bevelStrength: 1.2,
      crackCount: 1,
    });
  },
};

const dungeonWorn: Material = {
  id: 'dungeon_worn',
  label: 'Dungeon stone, worn & chipped',
  patchTiles: 4,
  variants: 2,
  paint: (ctx) => {
    dungeonPlain.paint(ctx);
    paintSpeckles(ctx, ctx.detail + 29, {
      count: 26,
      minRadius: 0.8,
      maxRadius: 2.6,
      ramp: { ...DUNGEON_STONE_RAMP, mid: DUNGEON_STONE_RAMP.shadow },
      alpha: 0.35,
      softness: 0.6,
    });
    const cracks = Math.round(3 * (ctx.size / TILE_PX) ** 2);
    for (let i = 0; i < cracks; i++) {
      const angle = hashLattice(i, 51, ctx.detail) * Math.PI * 2;
      wrappedStroke(
        ctx.surface,
        hashLattice(i, 52, ctx.detail) * ctx.size,
        hashLattice(i, 53, ctx.detail) * ctx.size,
        Math.cos(angle),
        Math.sin(angle),
        22,
        DUNGEON_STONE_RAMP.shadow,
        0.28,
        0.75,
      );
    }
  },
};

const dungeonMossy: Material = {
  id: 'dungeon_mossy',
  label: 'Dungeon stone, mossy',
  patchTiles: 4,
  variants: 3,
  paint: (ctx) => {
    dungeonPlain.paint(ctx);
    paintSpeckles(ctx, ctx.detail + 61, {
      count: 14,
      minRadius: 4,
      maxRadius: 13,
      ramp: MOSS_RAMP,
      alpha: 0.5,
      softness: 0.9,
    });
    paintBlades(ctx, MOSS_RAMP, ctx.detail + 67, 260);
  },
};

const dungeonWet: Material = {
  id: 'dungeon_wet',
  label: 'Dungeon stone, wet',
  patchTiles: 4,
  variants: 3,
  paint: (ctx) => {
    dungeonPlain.paint(ctx);
    paintSpeckles(ctx, ctx.detail + 71, {
      count: 4,
      minRadius: 7,
      maxRadius: 18,
      ramp: WATER_RAMP,
      alpha: 0.42,
      softness: 0.75,
    });
    paintSpeckles(ctx, ctx.detail + 73, {
      count: 18,
      minRadius: 1.2,
      maxRadius: 3.4,
      ramp: { ...WATER_RAMP, mid: WATER_RAMP.accent },
      alpha: 0.12,
      softness: 1,
    });
  },
};

const RUBBLE_LOBES_PER_CHUNK = 3;
const RUBBLE_LOBE_SPREAD = 0.45;
const RUBBLE_LOBE_MIN_SCALE = 0.55;
const RUBBLE_LOBE_SCALE_RANGE = 0.45;

/** Largest first: real collapse debris is a few big slabs in a field of chips. */
const RUBBLE_SIZE_CLASSES: ReadonlyArray<{ readonly count: number; readonly radius: number }> = [
  { count: 5, radius: 5.5 },
  { count: 14, radius: 3.2 },
  { count: 34, radius: 1.9 },
  { count: 90, radius: 1 },
];

const dungeonRubble: Material = {
  id: 'dungeon_rubble',
  label: 'Collapsed rubble',
  patchTiles: 2,
  variants: 4,
  paint: (ctx) => {
    paintNoiseGround(
      ctx,
      { ...DUNGEON_STONE_RAMP, mid: DUNGEON_STONE_RAMP.shadow },
      {
        patchPeriod: 8,
        patchWeight: 0.4,
        contrast: 1,
      },
    );
    paintSpeckles(ctx, ctx.detail + 79, {
      count: 160,
      minRadius: 0.7,
      maxRadius: 1.4,
      ramp: DUNGEON_STONE_RAMP,
      alpha: 0.55,
      softness: 0.5,
    });

    const areaScale = (ctx.size / TILE_PX) ** 2;
    let chunkIndex = 0;
    for (const sizeClass of RUBBLE_SIZE_CLASSES) {
      const count = Math.round(sizeClass.count * areaScale);
      for (let i = 0; i < count; i++) {
        const lobes: Array<readonly [number, number, number]> = [];
        for (let lobe = 0; lobe < RUBBLE_LOBES_PER_CHUNK; lobe++) {
          lobes.push([
            (hashLattice(chunkIndex, 94 + lobe, ctx.detail) - 0.5) * 2 * RUBBLE_LOBE_SPREAD,
            (hashLattice(chunkIndex, 97 + lobe, ctx.detail) - 0.5) * 2 * RUBBLE_LOBE_SPREAD,
            RUBBLE_LOBE_MIN_SCALE +
              hashLattice(chunkIndex, 100 + lobe, ctx.detail) * RUBBLE_LOBE_SCALE_RANGE,
          ]);
        }
        wrappedChunk(
          ctx.surface,
          hashLattice(chunkIndex, 91, ctx.detail) * ctx.size,
          hashLattice(chunkIndex, 92, ctx.detail) * ctx.size,
          sizeClass.radius,
          sampleRamp(DUNGEON_STONE_RAMP, hashLattice(chunkIndex, 93, ctx.detail)),
          DUNGEON_STONE_RAMP.accent,
          shade(DUNGEON_STONE_RAMP.shadow, 0.45),
          lobes,
        );
        chunkIndex++;
      }
    }
  },
};

const WALL_COURSES_PER_TILE = 2;
const WALL_BLOCKS_PER_COURSE_PER_TILE = 1;
const WALL_JOINT_PX = 1.6;
const WALL_RUNNING_BOND_OFFSET = 0.5;
const WALL_TOP_LIGHT = 1.2;
const WALL_BOTTOM_SHADOW = 0.74;
const WALL_TONE_SPREAD = 0.6;
const WALL_TONE_FLOOR = 0.2;
const WALL_GRAIN_PERIOD_PER_TILE = 8;
const WALL_GRAIN_STRENGTH = 0.16;
const WALL_JOINT_WARP = 1;
const WALL_JOINT_WARP_PERIOD_PER_TILE = 16;

/**
 * Coursed masonry — the one place hard joints are wanted, because the relief is
 * what tells the player they cannot walk here.
 */
const dungeonWall: Material = {
  id: 'dungeon_wall',
  label: 'Dungeon wall',
  patchTiles: 2,
  variants: 2,
  paint: (ctx) => {
    const tiles = ctx.size / TILE_PX;
    const courseHeight = TILE_PX / WALL_COURSES_PER_TILE;
    const blockWidth = TILE_PX / WALL_BLOCKS_PER_COURSE_PER_TILE;
    const coursesInPatch = WALL_COURSES_PER_TILE * tiles;
    const blocksInPatch = WALL_BLOCKS_PER_COURSE_PER_TILE * tiles;

    ctx.surface.fill((x, y) => {
      const warped = ctx.noise.warp(
        x,
        y,
        ctx.structure + 4,
        WALL_JOINT_WARP,
        WALL_JOINT_WARP_PERIOD_PER_TILE * tiles,
      );
      const course = Math.floor(warped.y / courseHeight);
      const localY = warped.y - course * courseHeight;
      const shiftedX = warped.x + positiveMod(course, 2) * WALL_RUNNING_BOND_OFFSET * blockWidth;
      const block = Math.floor(shiftedX / blockWidth);
      const localX = shiftedX - block * blockWidth;

      const inJoint =
        localX < WALL_JOINT_PX ||
        localY < WALL_JOINT_PX ||
        localX > blockWidth - WALL_JOINT_PX ||
        localY > courseHeight - WALL_JOINT_PX;
      if (inJoint) return shade(DUNGEON_WALL_RAMP.shadow, 0.7);

      const blockHash = hashLattice(
        positiveMod(block, blocksInPatch),
        positiveMod(course, coursesInPatch),
        ctx.structure,
      );
      const grain =
        (ctx.noise.value(x, y, WALL_GRAIN_PERIOD_PER_TILE * tiles, ctx.detail + 6) - 0.5) *
        WALL_GRAIN_STRENGTH;
      const face = sampleRamp(
        DUNGEON_WALL_RAMP,
        WALL_TONE_FLOOR + blockHash * WALL_TONE_SPREAD + grain,
      );
      if (localY < WALL_JOINT_PX * 2) return shade(face, WALL_TOP_LIGHT);
      if (localY > courseHeight - WALL_JOINT_PX * 2) return shade(face, WALL_BOTTOM_SHADOW);
      return face;
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
  dungeonPlain,
  dungeonFlagstone,
  dungeonWorn,
  dungeonMossy,
  dungeonWet,
  dungeonRubble,
  dungeonWall,
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
