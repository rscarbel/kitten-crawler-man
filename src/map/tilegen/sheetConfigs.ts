/**
 * Which materials each generated ground sheet carries, and the seed slot that
 * decides their structure.
 *
 * Shared by the runtime painter (`src/map/ground/runtimeGroundSheets.ts`) and by
 * `scripts/generate-ground-tileset.ts`, which bakes the same sheets as preview
 * PNGs for review. One table means a material can never be on a row at runtime
 * that it is not on in a review bake.
 */

/** Every sheet's frames are one tile square, matching `TILE_PX` in `raster.ts`. */
export interface GroundSheetConfig {
  readonly key: string;
  /** File the review baker writes, under `src/images/environment/tilesets/`. */
  readonly file: string;
  readonly materials: ReadonlyArray<string>;
  /**
   * Seed slot of this sheet's first material; the rest run consecutively from
   * it, and the slot is all that decides a material's structure seed.
   *
   * Written down rather than derived from the sheet's position in this array,
   * which is what it used to be. Splitting the dungeon's materials across three
   * sheets moved every Bopca material to a different position and so regenerated
   * the safe room's floor — art that had already been reviewed — for no reason
   * other than that a sheet had been added above it. Slots are wide apart so a
   * sheet can grow without colliding with the next.
   */
  readonly seedSlotBase: number;
}

/**
 * The unseeded base of every material's structure seed. A floor's art seed is
 * added to this, so an art seed of zero reproduces the sheets exactly as they
 * were baked when they still shipped as PNGs.
 */
export const GROUND_SEED_BASE = 20260725;
export const MATERIAL_SEED_STRIDE = 9973;
export const VARIANT_SEED_STRIDE = 131;
/** Offset of the corner-mask set's seed from the sheet seed base. */
export const MASK_SEED_OFFSET = 5501;

export const GROUND_SHEETS: ReadonlyArray<GroundSheetConfig> = [
  {
    key: 'ground_overworld',
    file: 'ground_overworld.png',
    // Appended, never inserted: a material's seed slot is its index from
    // `seedSlotBase`, so putting the wilderness materials anywhere but the end
    // would reseed — and so regenerate — art that has already been reviewed.
    materials: [
      'grass',
      'verge',
      'dirt',
      'gravel',
      'lane',
      'cobble',
      'plaza',
      'water',
      'highland',
      'scree',
    ],
    seedSlotBase: 0,
  },
  // Shared by both dungeon floors: a Bopca station is the same waystation
  // wherever it is found, so it keeps its own sheet rather than being duplicated
  // into each floor's. Its slots are the ones it held when the sheet also
  // carried seven generic dungeon materials, so the station's floor is byte for
  // byte the art that was reviewed.
  {
    key: 'ground_dungeon',
    file: 'ground_dungeon.png',
    materials: ['bopca_scuff', 'bopca_hearth', 'bopca_tile'],
    seedSlotBase: 107,
  },
  {
    key: 'ground_floor1',
    file: 'ground_floor1.png',
    materials: ['f1_cinder', 'f1_flagstone', 'f1_flags', 'f1_timber', 'f1_wall'],
    seedSlotBase: 200,
  },
  {
    key: 'ground_floor2',
    file: 'ground_floor2.png',
    materials: ['f2_concrete', 'f2_vinyl', 'f2_terrazzo', 'f2_plate', 'f2_wall'],
    seedSlotBase: 300,
  },
  // The town's building interiors — a shop, a house and the tower seen from
  // inside. Their own sheet rather than rows on the overworld's, because they
  // are never drawn in the same frame as a street.
  {
    key: 'ground_interior',
    file: 'ground_interior.png',
    // Append only. A material's noise seed is `seedSlotBase + materialIndex`, so
    // inserting one in the middle re-rolls the art of every material after it
    // and silently changes floors that already shipped.
    materials: [
      'interior_boards',
      'interior_stone',
      'interior_plaster',
      'interior_counter',
      'interior_rushes',
      'interior_earth',
      'interior_flag',
      'interior_ink',
    ],
    seedSlotBase: 400,
  },
];

/** The sheet config for a key, or undefined when the key names no generated sheet. */
export function groundSheetConfig(key: string): GroundSheetConfig | undefined {
  return GROUND_SHEETS.find((sheet) => sheet.key === key);
}

/**
 * Structure seed of one material on one sheet, under one floor art seed.
 *
 * The art seed is added to the base rather than mixed into the slot so the slot
 * arithmetic — the thing that pins a reviewed material to its own art — stays
 * exactly what it has always been; a floor merely shifts the whole family.
 */
export function materialStructureSeed(
  sheet: GroundSheetConfig,
  materialIndex: number,
  artSeedTerm: number,
): number {
  return (
    GROUND_SEED_BASE + artSeedTerm + (sheet.seedSlotBase + materialIndex) * MATERIAL_SEED_STRIDE
  );
}

/** Detail seed of one variant of a material whose structure seed is `structure`. */
export function variantDetailSeed(structure: number, variant: number): number {
  return structure + variant * VARIANT_SEED_STRIDE;
}
