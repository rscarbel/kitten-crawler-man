/**
 * Declarative description of the overworld town: where its streets run, which
 * building stands on which plot, and what props furnish the square.
 *
 * `generateOverworld` consumes a plan rather than holding the layout inline, so
 * moving a building is a data edit in one place instead of a code edit spread
 * across street rasterisation, door stubs and decoration offsets. Everything
 * here is tile-space geometry only — nothing in this module touches a grid.
 *
 * See `docs/town-redesign.md` §5 for how the plan and the painters divide up.
 */

/** Tile-space point. */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** Tile-space rectangle, anchored at its top-left corner. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Signed tile offset from the town centre. */
export interface TownOffset {
  readonly dx: number;
  readonly dy: number;
}

/** Categories `BuildingInteriorScene` keys its interiors off. */
export type BuildingKind = 'house' | 'tower' | 'restaurant' | 'store' | 'club';

/**
 * A building rendered from a PNG. Its footprint and doorway both come from the
 * sprite manifest at paint time, so the plan only has to say where the art's
 * anchor tile goes.
 */
export interface PlannedBuilding {
  readonly anchor: TownOffset;
  readonly spriteKey: string;
  readonly name: string;
  readonly kind: BuildingKind;
}

/**
 * The town's main tower. Unlike the sprite buildings its plot is stated
 * explicitly, because the art is 23 tiles tall while only its base blocks
 * movement, so the rectangle differs from the manifest footprint.
 */
export interface PlannedTower {
  /** Tile carrying the `MAIN_TOWER` type that triggers the sprite render. */
  readonly anchor: TownOffset;
  /**
   * The spire's ground, relative to the town centre — used *only* so street
   * bypass routing treats the tower as a structure to route around.
   *
   * It reserves nothing else, despite the name: the N-S main road band spans
   * `cx − 2 … cx + 2` and the plot spans `cx − 3 … cx + 2`, so the road runs
   * straight through it (98 of its 126 tiles are road), and ground scatter is
   * only suppressed over sprite footprints, so weeds and dirt land under the
   * spire too — about 7 tiles' worth per generation.
   */
  readonly plot: { readonly offset: TownOffset; readonly w: number; readonly h: number };
  readonly door: TownOffset;
  readonly name: string;
  readonly kind: BuildingKind;
}

/** A prop placed as tiles on the plan's ground, before any scatter runs. */
export type PlannedProp =
  | { readonly kind: 'fountain'; readonly bounds: TileRect }
  | { readonly kind: 'torch'; readonly tile: TilePoint }
  | { readonly kind: 'well'; readonly tile: TilePoint };

/** Per-tile chance that an eligible ground tile picks up a scatter decoration. */
export interface GroundCoverPlan {
  readonly weedDensityOnGrass: number;
  readonly dirtPatchDensityOnRoad: number;
}

export interface TownPlan {
  readonly centre: TilePoint;
  /** Width of both arms of the main crossroads, in tiles. */
  readonly mainRoadWidth: number;
  /**
   * Row (or column) where a road approaching the crossroads from the south or
   * east stops, as an offset from the centre line.
   *
   * **This currently overshoots the road's far kerb, so an approach taking the
   * far-side branch stops short of the junction** — with a 5-wide road the band
   * ends at +2 and the approach starts at +4, leaving row +3 (southward) or
   * column +3 (eastward) unpaved. The near-side branch has no such gap: it
   * targets `−floor(mainRoadWidth / 2)`, a tile on the band itself.
   *
   * So the circus is only actually cut off from the town's paved network when it
   * lies south *and* east: roughly 45% of the seeds in that quadrant, ~11% of all
   * seeds, and zero in the other three quadrants — measured over 2000 seeds at
   * size 280, and reproduced independently. Even in that quadrant the skipped tile is
   * often paved anyway by the plaza slab or a nearby door stub. Grass is
   * walkable, so it reads as sloppy rather than breaking anything, and it is
   * preserved verbatim from the pre-refactor generator; Phase 3 should set this to
   * `Math.floor(mainRoadWidth / 2)` — the kerb row itself. It must stay an
   * integer: it is used directly as a loop bound, and a fractional tile
   * coordinate passes `TileGrid.inBounds` and then throws on the row lookup.
   */
  readonly approachRoadStopOffset: number;
  /**
   * How far south of the centre line a building's frontage must reach before
   * its door stub turns along that frontage to meet the N-S road.
   *
   * Numerically equal to `approachRoadStopOffset` today, and it was one shared
   * constant before the refactor, but it is a different quantity — a threshold
   * on a building's position, not a target a road is paved to — and the two are
   * free to move independently.
   */
  readonly frontageTurnThreshold: number;
  readonly square: TileRect;
  readonly tower: PlannedTower;
  readonly buildings: ReadonlyArray<PlannedBuilding>;
  readonly props: ReadonlyArray<PlannedProp>;
  /** Where the Doomsday finale's escape stairwell appears, just south of the tower door. */
  readonly doomsdayEscapeTile: TilePoint;
  /** Tiles from the centre inside which no hostile spawns and mobs deaggro. */
  readonly safeRadiusTiles: number;
  readonly groundCover: GroundCoverPlan;
}

// ── Street and square geometry ───────────────────────────────────────────────

/** Both arms of the main crossroads are this wide. */
const MAIN_ROAD_WIDTH = 5;

/**
 * Tiles past the main road's kerb that both `approachRoadStopOffset` and
 * `frontageTurnThreshold` sit at. One shared value only because that is what
 * the pre-refactor generator used for both; see their docs.
 */
const MAIN_ROAD_KERB_MARGIN = 2;

/** The plaza is a square slab of road tiles centred on the town centre. */
const TOWN_SQUARE_HALF = 11;
const TOWN_SQUARE_SIZE = TOWN_SQUARE_HALF * 2;

// ── Tower ────────────────────────────────────────────────────────────────────

/**
 * The tower's plot is taller and set further north than its blocking base
 * because the art's 22-tile spire overhangs the ground to the north — anything
 * placed under it would be hidden. See `docs/town-redesign.md` §1.5.
 */
const TOWER_PLOT_WEST_OFFSET = 3;
const TOWER_PLOT_NORTH_OFFSET = 36;
const TOWER_PLOT_WIDTH = 6;
const TOWER_PLOT_HEIGHT = 21;

/** Row of the tower's anchor tile, north of the town centre. */
const TOWER_ANCHOR_NORTH_OFFSET = 15;
/** Row of the tower's doorway, one further north than the anchor. */
const TOWER_DOOR_NORTH_OFFSET = 16;
const TOWER_DOOR_WEST_OFFSET = 1;

/**
 * The escape stairwell sits this far south of the tower door — inside the
 * square, clear of the tower's own footprint.
 */
const STAIRWELL_SOUTH_OF_TOWER_DOOR = 6;

// ── Props ────────────────────────────────────────────────────────────────────

/** The fountain block sits diagonally out from the centre, in the square's SE quadrant. */
const FOUNTAIN_SE_OFFSET = 4;
const FOUNTAIN_SIZE = 3;

/** Gate torches stand this far to either side of each of the square's four entrances. */
const GATE_TORCH_INNER_OFFSET = 3;

/** Wells sit on the square's SW and NE diagonals. */
const WELL_DIAGONAL_OFFSET = 7;

/** Torches flanking the tower entrance, on the anchor's row. */
const TOWER_TORCH_WEST_OFFSET = 2;
const TOWER_TORCH_EAST_OFFSET = 1;

// ── Ground cover ─────────────────────────────────────────────────────────────

const GRASSY_WEED_DENSITY = 0.015;
const DIRT_PATCH_DENSITY = 0.06;

// ── Safe zone ────────────────────────────────────────────────────────────────

/**
 * Comfortably covers every named village building while leaving a ruins buffer
 * before the circus footprint.
 */
const TOWN_SAFE_RADIUS_TILES = 55;

// ── Building plots ───────────────────────────────────────────────────────────

/**
 * Building anchors, as signed tile offsets from the town centre.
 *
 * The town reads as two streets ringing the square: the north street carries the
 * store, barracks and cottages, the south street the club, taverns and inn. Every
 * placement dodges the square, the main road bands and the tower plot, and every
 * door's road stub runs clear of its neighbours. Footprints scale with each
 * sprite's manifest `tileScale`, so changing a building's on-screen size
 * re-spaces its neighbours too.
 *
 * Listed north street → square ring → south street, so the table reads
 * top-to-bottom the way the town does on screen.
 */
const PLANNED_BUILDINGS: ReadonlyArray<PlannedBuilding> = [
  {
    anchor: { dx: -20, dy: -30 },
    spriteKey: 'village_house_1',
    name: "Shepherd's Cabin",
    kind: 'house',
  },
  {
    anchor: { dx: 4, dy: -24 },
    spriteKey: 'village_house_2',
    name: 'Blackwood Lodge',
    kind: 'house',
  },
  {
    anchor: { dx: -12, dy: -24 },
    spriteKey: 'village_house_3',
    name: "Old Hilda's Cottage",
    kind: 'house',
  },
  { anchor: { dx: -26, dy: -20 }, spriteKey: 'shop', name: 'General Store', kind: 'store' },
  { anchor: { dx: 13, dy: -20 }, spriteKey: 'barracks', name: 'The Barracks', kind: 'restaurant' },
  {
    anchor: { dx: 34, dy: -20 },
    spriteKey: 'village_house_4',
    name: "Cartwright's Workshop",
    kind: 'house',
  },
  {
    anchor: { dx: -20, dy: -11 },
    spriteKey: 'village_house_1',
    name: 'Herb & Remedy',
    kind: 'house',
  },
  { anchor: { dx: 20, dy: -10 }, spriteKey: 'tavern_2', name: 'The Horned Flagon', kind: 'house' },
  { anchor: { dx: -25, dy: 4 }, spriteKey: 'temple', name: 'Temple of the Sky', kind: 'house' },
  { anchor: { dx: 21, dy: 6 }, spriteKey: 'blacksmith', name: 'The Rusty Anvil', kind: 'house' },
  {
    anchor: { dx: -32, dy: 15 },
    spriteKey: 'small_inn',
    name: 'The Sleeping Cat Inn',
    kind: 'house',
  },
  {
    anchor: { dx: -19, dy: 15 },
    spriteKey: 'tavern_1',
    name: 'The Sunken Stump Pub',
    kind: 'house',
  },
  {
    anchor: { dx: 3, dy: 16 },
    spriteKey: 'desperado_club',
    name: 'The Desperado Club',
    kind: 'club',
  },
  {
    anchor: { dx: -30, dy: 27 },
    spriteKey: 'village_house_4',
    name: "Miller's Farm",
    kind: 'house',
  },
  {
    anchor: { dx: 21, dy: 31 },
    spriteKey: 'tattoo_parlor',
    name: "Signet's Ink",
    kind: 'house',
  },
];

function planProps(centre: TilePoint): ReadonlyArray<PlannedProp> {
  const { x: cx, y: cy } = centre;
  const towerRow = cy - TOWER_ANCHOR_NORTH_OFFSET;
  return [
    {
      kind: 'fountain',
      bounds: {
        x: cx + FOUNTAIN_SE_OFFSET,
        y: cy + FOUNTAIN_SE_OFFSET,
        w: FOUNTAIN_SIZE,
        h: FOUNTAIN_SIZE,
      },
    },
    // Two torches flanking each of the square's four road gates.
    { kind: 'torch', tile: { x: cx - GATE_TORCH_INNER_OFFSET, y: cy - TOWN_SQUARE_HALF } },
    { kind: 'torch', tile: { x: cx + GATE_TORCH_INNER_OFFSET, y: cy - TOWN_SQUARE_HALF } },
    { kind: 'torch', tile: { x: cx - GATE_TORCH_INNER_OFFSET, y: cy + TOWN_SQUARE_HALF } },
    { kind: 'torch', tile: { x: cx + GATE_TORCH_INNER_OFFSET, y: cy + TOWN_SQUARE_HALF } },
    { kind: 'torch', tile: { x: cx - TOWN_SQUARE_HALF, y: cy - GATE_TORCH_INNER_OFFSET } },
    { kind: 'torch', tile: { x: cx - TOWN_SQUARE_HALF, y: cy + GATE_TORCH_INNER_OFFSET } },
    { kind: 'torch', tile: { x: cx + TOWN_SQUARE_HALF, y: cy - GATE_TORCH_INNER_OFFSET } },
    { kind: 'torch', tile: { x: cx + TOWN_SQUARE_HALF, y: cy + GATE_TORCH_INNER_OFFSET } },
    { kind: 'torch', tile: { x: cx - TOWER_TORCH_WEST_OFFSET, y: towerRow } },
    { kind: 'torch', tile: { x: cx + TOWER_TORCH_EAST_OFFSET, y: towerRow } },
    { kind: 'well', tile: { x: cx - WELL_DIAGONAL_OFFSET, y: cy + WELL_DIAGONAL_OFFSET } },
    { kind: 'well', tile: { x: cx + WELL_DIAGONAL_OFFSET, y: cy - WELL_DIAGONAL_OFFSET } },
  ];
}

/** Builds the town plan for a map of `size` tiles a side, centred on that map. */
export function createTownPlan(size: number): TownPlan {
  const centre: TilePoint = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const { x: cx, y: cy } = centre;

  return {
    centre,
    mainRoadWidth: MAIN_ROAD_WIDTH,
    approachRoadStopOffset: Math.floor(MAIN_ROAD_WIDTH / 2) + MAIN_ROAD_KERB_MARGIN,
    frontageTurnThreshold: Math.floor(MAIN_ROAD_WIDTH / 2) + MAIN_ROAD_KERB_MARGIN,
    square: {
      x: cx - TOWN_SQUARE_HALF,
      y: cy - TOWN_SQUARE_HALF,
      w: TOWN_SQUARE_SIZE,
      h: TOWN_SQUARE_SIZE,
    },
    tower: {
      anchor: { dx: 0, dy: -TOWER_ANCHOR_NORTH_OFFSET },
      plot: {
        offset: { dx: -TOWER_PLOT_WEST_OFFSET, dy: -TOWER_PLOT_NORTH_OFFSET },
        w: TOWER_PLOT_WIDTH,
        h: TOWER_PLOT_HEIGHT,
      },
      door: { dx: -TOWER_DOOR_WEST_OFFSET, dy: -TOWER_DOOR_NORTH_OFFSET },
      name: 'Town Center Tower',
      kind: 'tower',
    },
    buildings: PLANNED_BUILDINGS,
    props: planProps(centre),
    doomsdayEscapeTile: {
      x: cx - TOWER_DOOR_WEST_OFFSET,
      y: cy - TOWER_DOOR_NORTH_OFFSET + STAIRWELL_SOUTH_OF_TOWER_DOOR,
    },
    safeRadiusTiles: TOWN_SAFE_RADIUS_TILES,
    groundCover: {
      weedDensityOnGrass: GRASSY_WEED_DENSITY,
      dirtPatchDensityOnRoad: DIRT_PATCH_DENSITY,
    },
  };
}

/** Resolves a centre-relative offset to an absolute tile. */
export function offsetToTile(plan: TownPlan, offset: TownOffset): TilePoint {
  return { x: plan.centre.x + offset.dx, y: plan.centre.y + offset.dy };
}
