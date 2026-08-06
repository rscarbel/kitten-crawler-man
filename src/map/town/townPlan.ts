/**
 * Declarative description of the overworld town: where its wall stands, where
 * its streets run, which building stands on which plot, and what props furnish
 * the square.
 *
 * `generateOverworld` consumes a plan rather than holding the layout inline, so
 * moving a building is a data edit in one place instead of a code edit spread
 * across street rasterisation, door stubs and decoration offsets. Everything
 * here is tile-space geometry only — nothing in this module touches a grid.
 *
 * **The town is a walled market village, not a crossroads.** Streets come first
 * and buildings hang off street frontages: every building band is bounded below
 * by a street, and every building's south face — which is where
 * every sprite puts its door — sits on the band's own bottom row, so its door
 * opens directly onto the street below it. That is what removed the old
 * per-building road stub entirely: a stub only exists because a building was
 * dropped in open space and had to be connected back to a road afterwards.
 *
 * See `docs/town.md` for the street hierarchy and districts these coordinates
 * realise, and for the invariants a layout change must preserve.
 */

import type { FenceStyle } from '../tileTypes';
import {
  COBBLE_STREET,
  FloorTypeValue,
  LANE_STREET,
  PLAZA_STONE,
  VERGE_GRASS,
  YARD_GRAVEL,
} from '../tileTypes';

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
 * One paved or planted region of the town.
 *
 * Surfaces are painted in the order the `TownPlan` lists them and later ones win, so
 * the hierarchy is expressed by ordering rather than by priority numbers: soft
 * ground first, then alleys, lanes, main streets, and finally the plaza's
 * flagstone. Overlapping a lane across the plaza and letting the plaza win is
 * how junctions come out right without any junction-fillet code.
 */
export interface PlannedSurface {
  /**
   * Human-readable label, so the list below reads as a description of the town
   * and so `assertTownPlanIsSane` can say which surface is wrong. Nothing on a
   * render path reads it.
   */
  readonly name: string;
  readonly bounds: TileRect;
  readonly tileType: number;
}

/** An opening in the wall ring, and the road that leaves through it. */
export interface PlannedGate {
  /** Label only, as `PlannedSurface.name` is. */
  readonly name: string;
  /** The opening itself — a slice of the wall ring, paved with `tileType`. */
  readonly bounds: TileRect;
  readonly tileType: number;
  /**
   * Loose gravel outside the gate, wider than the opening, so the joint between
   * street and open road reads as a mouth rather than as a butt edge.
   *
   * It is *flanks* of gravel, not a gravel slab: `paintGateHighways` runs after the
   * apron is painted and paves the gate's own width of track straight through the
   * middle of it, which leaves roughly a third to a half of each apron as gravel
   * either side of the road.
   */
  readonly apron: TileRect;
  /**
   * Where a road leaving this gate meets open country: the centre of the gate,
   * one tile outside the wall. Outlying sites (the circus) route to the nearest
   * of these rather than to the town centre.
   */
  readonly exit: TilePoint;
  /** Unit direction the gate's highway runs, away from the town. */
  readonly outward: TownOffset;
}

/**
 * The device painted on a building's hanging shop sign.
 *
 * Declared here rather than in the sprite that draws it because it is part of
 * what the `TownPlan` *states* about a building — the trade it carries on — and every
 * plot must name one, which `PlannedBuilding.sign` being required enforces. The
 * painter for each device lives in `src/sprites/shopSign.ts`, keyed by this
 * union, so a device with no art is a compile error rather than a blank board.
 */
/**
 * The devices in the order their art occupies frames of `shop_sign.png`.
 *
 * Derived-union for the reason `TOWN_CLUTTER_KINDS` gives: the sheet is
 * addressed by frame index, so the list and the union must be the same thing.
 * Append only — reordering repoints every baked frame at the wrong emblem.
 */
export const SHOP_SIGN_EMBLEMS = [
  'moon',
  'fleece',
  'shield',
  'wheel',
  'sun',
  'mortar',
  'barrel',
  'bed',
  'horn',
  'cauldron',
  'hammer',
  'tankard',
  'quill',
  'cards',
  'sheaf',
] as const;

export type ShopSignEmblem = (typeof SHOP_SIGN_EMBLEMS)[number];

/**
 * A building rendered from a PNG. Its footprint and doorway both come from the
 * sprite manifest at paint time, so the `TownPlan` only has to say where the art's
 * anchor tile goes.
 */
export interface PlannedBuilding {
  /** West edge of the plot, as a column offset from the town centre. */
  readonly west: number;
  /**
   * Row the building's front (south) face stands on — always its band's last
   * row, so the street below is the street its door opens onto.
   *
   * Stated instead of an anchor row so the `TownPlan` never repeats a sprite's height.
   * `placeSpriteBuilding` derives the anchor by bottom-aligning the manifest
   * footprint to this row, which means re-scaling a building's art keeps its
   * frontage on the street and grows it northward into its own plot.
   */
  readonly frontRow: number;
  /**
   * North edge of the plot: its band's first row. The plot is therefore
   * `west .. west + sprite width - 1` by `plotTop .. frontRow`, which is the art
   * plus whatever back yard the band leaves behind it.
   *
   * The plot rather than the art is what ground scatter is suppressed over and
   * what the sliver check measures between, so shrinking a building's art leaves
   * a garden behind it rather than a strip of scattered weed nobody planted.
   */
  readonly plotTop: number;
  readonly spriteKey: string;
  readonly name: string;
  readonly kind: BuildingKind;
  /** Device on the shop sign hung over this building's door. */
  readonly sign: ShopSignEmblem;
}

/**
 * The town's main tower. Unlike the sprite buildings its door is stated
 * explicitly rather than derived, because the art is 23 tiles tall while only
 * its bottom two rows block movement, so the manifest's "front row" rule that
 * every other building's doorway comes from does not apply to it.
 *
 * The tower stands *in* the north wall: its two blocking rows are the wall row
 * and the row below, and the other 21 rows of spire overhang the fields outside
 * the town. That is what recovers the 6 x 22 dead corridor the tower used to
 * sterilise in the town centre.
 */
export interface PlannedTower {
  /** Tile carrying the `MAIN_TOWER` type that triggers the sprite render. */
  readonly anchor: TownOffset;
  readonly door: TownOffset;
  readonly name: string;
  readonly kind: BuildingKind;
}

/**
 * What a yard is for, which decides both the surface it must stand on and what
 * gets planted in it.
 *
 * A `garden` is soft ground — verge — and takes planting. A `workyard` is loose
 * gravel and takes none: it is a place things are done, and its clutter is props
 * rather than greenery. `paintYards` checks the surface underneath against this
 * rather than trusting it, because planting reports the material it is painted
 * *over*, so a garden accidentally laid on gravel would draw verge tufts on a
 * gravel row and be eroded by the surrounding gravel through the corner masks.
 */
export type YardKind = 'garden' | 'workyard';

/**
 * An enclosed or planted piece of block interior: a back garden, a drying green,
 * a kitchen garden, or a working yard.
 *
 * Yards are what turn the ground a building does not stand on from dead lawn
 * into somewhere that belongs to it. They deliberately overlap the plots they sit
 * behind — a back garden *is* part of its building's plot — so nothing here has
 * to be kept in step with the building list beyond staying on the right surface.
 */
export interface PlannedYard {
  readonly name: string;
  readonly bounds: TileRect;
  readonly kind: YardKind;
  /**
   * How the enclosure is built, for the fenced ones. Stated per yard rather than
   * derived from `kind` because the two are different questions: a workyard is
   * always post-and-rail, but a garden by the plaza and a kitchen garden against
   * the wall are both gardens and would not be fenced the same way.
   *
   * Required even on unfenced strips, so that fencing a strip later is a
   * one-word edit rather than a field that has to be added back.
   */
  readonly fence: FenceStyle;
  /**
   * Whether the yard gets a fenced perimeter, built in its `fence` style. Strips
   * one tile deep are planted but never fenced: a fence around them would be all
   * perimeter and no inside, and the town would read as a stockade rather than as
   * a place.
   */
  readonly fenced: boolean;
  /**
   * Gaps left in the perimeter so the yard can be walked into. Stated as
   * rectangles rather than as a side and an offset because that is what the
   * painter needs and what a reviewer can check against the map.
   */
  readonly gates: ReadonlyArray<TileRect>;
}

/**
 * A named quarter of the town, and where its name is written on the minimap.
 *
 * Only a name and a label anchor, because that is all anything asks for. An
 * earlier draft of this plan carried a `district` on every building and a
 * `TownDistrict` union, and a later review removed both: their docs claimed
 * the minimap read them, and nothing did. They come back here with their
 * consumer, and no wider than it needs.
 *
 * The anchors are spread by hand rather than computed as band centres. Three of
 * the bands are centred on the same column as the plaza, so their computed
 * anchors would stack within a few pixels of each other at the minimap's one
 * pixel per tile.
 */
export interface PlannedDistrict {
  readonly name: string;
  readonly label: TilePoint;
}

/** A prop placed as tiles on the `TownPlan`'s ground, before any scatter runs. */
export type PlannedProp =
  | { readonly kind: 'fountain'; readonly bounds: TileRect }
  | { readonly kind: 'torch'; readonly tile: TilePoint }
  | { readonly kind: 'well'; readonly tile: TilePoint };

/** Per-tile chance that an eligible ground tile picks up a scatter decoration. */
export interface GroundCoverPlan {
  readonly weedDensityOnGrass: number;
  readonly dirtPatchDensityOnRoad: number;
  /** Per-tile chance that a garden tile is planted rather than left as bare verge. */
  readonly plantingDensityInGardens: number;
}

export interface TownPlan {
  readonly centre: TilePoint;
  /** The wall ring, as the rectangle its stone occupies. */
  readonly wall: TileRect;
  /**
   * Everything strictly inside the wall — the ring inset by one on every side.
   *
   * Stated rather than left to callers to derive. Four separate checks in the
   * generator want it, and four hand-written `wall.x + 1` / `wall.w - 2` pairs is
   * four chances to write one of them as `wall.w - 1`.
   */
  readonly interior: TileRect;
  readonly gates: ReadonlyArray<PlannedGate>;
  /** Every surface of the town, in paint order — later entries win. */
  readonly surfaces: ReadonlyArray<PlannedSurface>;
  /** The market plaza slab, which is also what `townSquareCentre` is the centre of. */
  readonly plaza: TileRect;
  readonly tower: PlannedTower;
  readonly buildings: ReadonlyArray<PlannedBuilding>;
  /** Block interiors: back gardens, drying greens, planted strips and workyards. */
  readonly yards: ReadonlyArray<PlannedYard>;
  readonly props: ReadonlyArray<PlannedProp>;
  /** Named quarters, for the minimap's labels. */
  readonly districts: ReadonlyArray<PlannedDistrict>;
  /** Where the Doomsday finale's escape stairwell appears, just south of the tower door. */
  readonly doomsdayEscapeTile: TilePoint;
  /** Tiles from the centre inside which no hostile spawns and mobs deaggro. */
  readonly safeRadiusTiles: number;
  readonly groundCover: GroundCoverPlan;
}

// ── The town's frame ─────────────────────────────────────────────────────────

/**
 * The wall ring, as offsets from the plaza centre. The stone stands on these
 * lines; the interior is everything strictly inside them.
 *
 * 55 x 43 of interior. The 15 sprite buildings span rows -18..21, so their bounding
 * box is 55 x 40; the three interior rows none of them stands on are Low Street's,
 * 22..24.
 *
 * The band structure is not symmetric about the plaza, which is worth knowing before
 * reasoning about distances from it: Garrison Row starts on `INTERIOR_NORTH`, so the
 * northernmost buildings abut the wall's inner face directly, while in the south
 * Low Street's three rows separate the last building from it. The interior runs 18
 * rows north of the plaza and 24 south, so a plot in a north corner is a good deal
 * closer to the centre than one in a south corner.
 *
 * `townMetrics` reports **41** rows, one more than 40, because the tower's base
 * course stands *on* the wall line at row -19 — deliberately, since the tower is
 * part of the wall.
 */
const WALL_WEST = -28;
const WALL_EAST = 28;
const WALL_NORTH = -19;
const WALL_SOUTH = 25;

const INTERIOR_WEST = WALL_WEST + 1;
const INTERIOR_EAST = WALL_EAST - 1;
const INTERIOR_NORTH = WALL_NORTH + 1;
const INTERIOR_SOUTH = WALL_SOUTH - 1;

/**
 * Band boundaries, north to south. Each building band is bounded below by a
 * street, and every building in it is bottom-aligned to the band's last row so
 * its door lands on that street.
 */
const GARRISON_TOP = INTERIOR_NORTH;
const GARRISON_BOTTOM = -12;
const UPPER_LANE_TOP = -11;
const UPPER_LANE_BOTTOM = -9;
const PLAZA_RING_TOP = -8;
const PLAZA_RING_BOTTOM = -2;
const CROSS_LANE_TOP = -1;
const CROSS_LANE_BOTTOM = 1;
const MARKET_ROW_TOP = 2;
const MARKET_ROW_BOTTOM = 7;
const MARKET_STREET_TOP = 8;
const MARKET_STREET_BOTTOM = 11;
const LOW_QUARTER_TOP = 12;
const LOW_QUARTER_BOTTOM = 21;
const LOW_STREET_TOP = 22;
const LOW_STREET_BOTTOM = INTERIOR_SOUTH;

/** Column boundaries. The plaza splits the town's east and west building bands. */
const PLAZA_WEST = -8;
const PLAZA_EAST = 8;
/** The civic terrace runs from the tower's foot down into the plaza. */
const TERRACE_WEST = -6;
const TERRACE_EAST = 5;

const WEST_LANE_WEST = -19;
const WEST_LANE_EAST = -17;
const EAST_LANE_WEST = 17;
const EAST_LANE_EAST = 19;

/**
 * West edge of each building plot. The east and west bands are each cut as an
 * 8-tile plot, a 3-tile lane and another 8-tile plot, which is exactly what the
 * widest building sprites need.
 *
 * Garrison Row is the exception on its **west** side only: the West Lane starts
 * at the Upper Lane, because the rows above it are the dead-end alley and the
 * Lodge that fronts it, so the band's two 7-tile cottages pack side by side from
 * the wall instead. The East Lane runs the full height of the town and does cross
 * Garrison Row.
 */
const PLOT_WIDTH = 8;
const COTTAGE_WIDTH = 7;
const OUTER_WEST_PLOT = INTERIOR_WEST;
const INNER_WEST_PLOT = -16;
const INNER_EAST_PLOT = PLAZA_EAST + 1;
const OUTER_EAST_PLOT = EAST_LANE_EAST + 1;
const GARRISON_SECOND_COTTAGE = INTERIOR_WEST + COTTAGE_WIDTH;
/** The Barracks stands one tile of drill yard east of the terrace. */
const BARRACKS_PLOT_WEST = TERRACE_EAST + 2;

/** King's Road: the arrival axis, south gate to Market Street. */
const KINGS_ROAD_WEST = -3;
const KINGS_ROAD_EAST = 0;

/** Two-wide alleys through the Low Quarter's block. */
const SERVICE_ALLEY_WEST = 1;
const SERVICE_ALLEY_EAST = 2;
const MURDER_ALLEY_WEST = 15;
const MURDER_ALLEY_EAST = 16;

/**
 * The dead-end alley Blackwood Lodge fronts. It runs west off the West Lane along
 * the Garrison band's south face and stops at the wall, and the Lodge is the only
 * building on it — which is the cult hideout it is meant to be rather than a
 * lodge on a main lane. (Its door is at the alley's middle, not its end: the alley
 * runs three tiles further west to the wall.)
 */
const LODGE_ALLEY_TOP = UPPER_LANE_TOP;
const LODGE_ALLEY_BOTTOM = -10;

/**
 * Miller's Farm stands on the southern end of the Low Quarter band, so the crop
 * rows in front of it fill the band's first three rows. Purely cosmetic if the
 * farm's art grows: the surplus gravel or verge ends up under its roof.
 */
const FARM_YARD_BOTTOM = LOW_QUARTER_TOP + 2;

/** Gate geometry. Aprons are wider than their opening so the joint reads as a mouth. */
const GATE_APRON_DEPTH = 3;
const GATE_APRON_OVERHANG = 2;

/**
 * A gateway's stone piers stand on the wall tile immediately beyond each end of
 * the opening they arch over, so a gate needs this much clear wall either side
 * of itself as well as the opening itself.
 */
export const GATE_ARCH_PIER_TILES = 1;

/**
 * The north gate's opening, west of the tower's foot.
 *
 * The tower stands *in* the north wall and its blocking base spans the columns
 * either side of the town's centre line, so the only stretch of north wall a
 * gate can be cut into is the terrace's own frontage west of it. It opens
 * straight onto existing flagstone — the Civic Terrace already leads south past
 * the tower's foot into the plaza — so no interior street has to be added to
 * serve it.
 *
 * A postern rather than a carriage gate, two tiles wide against the other three
 * gates' four, because that is what the frontage holds: the terrace's west
 * column is the westmost the corridor can start at without running into the
 * Garrison Green's fence a few rows south, and the east edge has to leave the
 * tower's base a pier's width of clear wall. The tower's own width comes from
 * its manifest footprint, which this file deliberately does not read —
 * `assertTownPlanIsSane` compares the two, so a re-drawn tower that reaches
 * further west fails generation rather than growing over the gate.
 */
const TOWER_BASE_WEST = -3;
const NORTH_GATE_WEST = TERRACE_WEST;
const NORTH_GATE_EAST = TOWER_BASE_WEST - 1 - GATE_ARCH_PIER_TILES;

// ── Tower ────────────────────────────────────────────────────────────────────

/**
 * The tower stands in the north wall. Its anchor is two rows inside the wall
 * line because the manifest blocks the two rows *above* the anchor — those two
 * are the wall row and the row below it, which is where the door falls.
 */
const TOWER_ANCHOR_NORTH_OFFSET = 17;
const TOWER_DOOR_NORTH_OFFSET = 18;
const TOWER_DOOR_WEST_OFFSET = 1;

/**
 * The escape stairwell sits this far south of the tower door — on the terrace,
 * clear of the tower's own blocking rows and of the Upper Lane junction.
 */
const STAIRWELL_SOUTH_OF_TOWER_DOOR = 5;

// ── Props ────────────────────────────────────────────────────────────────────

/** The fountain block sits in the plaza's south-east quadrant, off the arrival axis. */
const FOUNTAIN_WEST_COLUMN = 3;
const FOUNTAIN_NORTH_ROW = 2;
const FOUNTAIN_SIZE = 3;

/** Wells on the plaza's south-west and north-east diagonals. */
const WELL_SOUTH_WEST: TownOffset = { dx: -5, dy: 4 };
const WELL_NORTH_EAST: TownOffset = { dx: 5, dy: -5 };

/** Torches flanking the tower's foot, clear of the art's own 6-tile width. */
const TOWER_TORCH_WEST_OFFSET = 4;
const TOWER_TORCH_EAST_OFFSET = 3;
const TOWER_TORCH_ROW_OFFSET = 16;

/** Torches marking where the terrace opens onto the plaza. */
const TERRACE_MOUTH_ROW = UPPER_LANE_BOTTOM;

/**
 * Torches inside the south gate, in the outer row of Low Street.
 *
 * **Two columns clear of the road, not one.** The gate arch's piers stand on the
 * wall tiles immediately flanking the opening and are 0.7 of a tile wide, so they
 * cover the outer 70% of the first column either side — which is where these
 * torches used to be, and both were about 70% painted over whichever row the arch
 * was anchored on. Measured against a render with no gateway: at one column out,
 * 69.6% and 71.9% overpainted at the two anchor rows that were tried; at two, the
 * piers do not touch them at all.
 */
const SOUTH_GATE_TORCH_WEST = KINGS_ROAD_WEST - 2;
const SOUTH_GATE_TORCH_EAST = KINGS_ROAD_EAST + 2;

/** Torches inside the side gates, in the band below Market Street. */
const SIDE_GATE_TORCH_ROW = LOW_QUARTER_TOP;

// ── Ground cover ─────────────────────────────────────────────────────────────

const GRASSY_WEED_DENSITY = 0.015;
const DIRT_PATCH_DENSITY = 0.06;
/**
 * Planting is dense where the outdoor scatter is sparse: a garden that is one
 * bed in twenty reads as a neglected lot rather than as a garden, and the
 * planting tile draws rows rather than a lone tuft, so a run of them lines up
 * into beds.
 */
const GARDEN_PLANTING_DENSITY = 0.55;

// ── Safe zone ────────────────────────────────────────────────────────────────

/**
 * Covers the whole walled town with a margin — the farthest wall corners are
 * (+-28, -19) and (+-28, +25), i.e. 33.9 and 37.5 tiles out — while leaving a
 * wide ruins band before the circus, which is placed 70-90 tiles from the centre.
 */
const TOWN_SAFE_RADIUS_TILES = 40;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A rectangle from inclusive edge offsets, which is how the bands are stated. */
function span(west: number, north: number, east: number, south: number): TileRect {
  return { x: west, y: north, w: east - west + 1, h: south - north + 1 };
}

function shift(rect: TileRect, centre: TilePoint): TileRect {
  return { x: rect.x + centre.x, y: rect.y + centre.y, w: rect.w, h: rect.h };
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * Every surface in the town, in paint order, as centre-relative rectangles.
 *
 * Read this as four passes. The whole interior goes down as verge first, so
 * every tile inside the walls that nothing else claims is a kept, weed-invaded
 * surface rather than open field: bare default grass exists only outside the
 * walls. Then the yards, then alleys,
 * lanes and the two main streets in order of importance, so a junction takes the
 * material of the more important street without any special case. The plaza and
 * terrace go last, which is what lets the Upper and Cross Lanes be stated as
 * full-width bands that simply disappear where the plaza takes over.
 */
const PLANNED_SURFACES: ReadonlyArray<PlannedSurface> = [
  {
    name: 'town interior',
    bounds: span(INTERIOR_WEST, INTERIOR_NORTH, INTERIOR_EAST, INTERIOR_SOUTH),
    tileType: VERGE_GRASS,
  },

  // Working yards: the loose gravel of a place that gets used.
  {
    name: 'Barracks drill yard (west)',
    bounds: span(TERRACE_EAST + 1, GARRISON_TOP, BARRACKS_PLOT_WEST - 1, GARRISON_BOTTOM),
    tileType: YARD_GRAVEL,
  },
  {
    name: 'Barracks drill yard (east)',
    bounds: span(
      BARRACKS_PLOT_WEST + PLOT_WIDTH,
      GARRISON_TOP,
      EAST_LANE_WEST - 1,
      GARRISON_BOTTOM,
    ),
    tileType: YARD_GRAVEL,
  },
  /**
   * The open block east of the East Lane, level with Market Row.
   *
   * Named for what it is, not for the smithy: The Rusty Anvil's coal, anvil and
   * quench trough want a yard, and this band is the only gravel in the row — but
   * the Anvil fills columns 9..16 and the East Lane separates it from here, so
   * nothing in this band adjoins the forge. The smithy's props therefore live on
   * the Anvil's own Market Street frontage; do not drop an anvil here and call it
   * the forge's yard.
   */
  {
    name: 'Market Row east yard',
    bounds: span(EAST_LANE_EAST + 1, MARKET_ROW_TOP, INTERIOR_EAST, MARKET_ROW_BOTTOM),
    tileType: YARD_GRAVEL,
  },
  /**
   * Soft ground, not gravel: it is Miller's kitchen garden, and the planting the
   * `South Green` yard puts here reports the material it is drawn *over*. On
   * gravel the beds would draw verge tufts on a gravel row and the surrounding
   * gravel would erode them through the corner masks.
   */
  {
    name: 'South Green crop rows',
    bounds: span(EAST_LANE_EAST + 1, LOW_QUARTER_TOP, INTERIOR_EAST, FARM_YARD_BOTTOM),
    tileType: VERGE_GRASS,
  },

  // Alleys — packed earth, the lowest rung of the street hierarchy.
  {
    name: 'Blackwood alley (dead end)',
    bounds: span(INTERIOR_WEST, LODGE_ALLEY_TOP, WEST_LANE_EAST, LODGE_ALLEY_BOTTOM),
    tileType: FloorTypeValue.road,
  },
  {
    name: 'club service alley',
    bounds: span(SERVICE_ALLEY_WEST, LOW_QUARTER_TOP, SERVICE_ALLEY_EAST, LOW_QUARTER_BOTTOM),
    tileType: FloorTypeValue.road,
  },
  {
    name: 'murder alley',
    bounds: span(MURDER_ALLEY_WEST, LOW_QUARTER_TOP, MURDER_ALLEY_EAST, LOW_QUARTER_BOTTOM),
    tileType: FloorTypeValue.road,
  },

  // Lanes — the three-wide side streets that define the building bands.
  {
    name: 'Upper Lane',
    bounds: span(WEST_LANE_EAST + 1, UPPER_LANE_TOP, INTERIOR_EAST, UPPER_LANE_BOTTOM),
    tileType: LANE_STREET,
  },
  {
    name: 'Cross Lane',
    bounds: span(INTERIOR_WEST, CROSS_LANE_TOP, INTERIOR_EAST, CROSS_LANE_BOTTOM),
    tileType: LANE_STREET,
  },
  {
    name: 'Low Street',
    bounds: span(INTERIOR_WEST, LOW_STREET_TOP, INTERIOR_EAST, LOW_STREET_BOTTOM),
    tileType: LANE_STREET,
  },
  {
    name: 'West Lane',
    bounds: span(WEST_LANE_WEST, UPPER_LANE_TOP, WEST_LANE_EAST, LOW_STREET_BOTTOM),
    tileType: LANE_STREET,
  },
  {
    name: 'East Lane',
    bounds: span(EAST_LANE_WEST, GARRISON_TOP, EAST_LANE_EAST, LOW_STREET_BOTTOM),
    tileType: LANE_STREET,
  },

  // Main streets — cobble, four wide, and the only two that reach a gate.
  {
    name: 'Market Street',
    bounds: span(INTERIOR_WEST, MARKET_STREET_TOP, INTERIOR_EAST, MARKET_STREET_BOTTOM),
    tileType: COBBLE_STREET,
  },
  {
    name: "King's Road",
    bounds: span(KINGS_ROAD_WEST, LOW_QUARTER_TOP, KINGS_ROAD_EAST, INTERIOR_SOUTH),
    tileType: COBBLE_STREET,
  },

  // Flagstone last: the plaza and the terrace that carries the tower's axis into it.
  {
    name: 'Market Plaza',
    bounds: span(PLAZA_WEST, PLAZA_RING_TOP, PLAZA_EAST, MARKET_ROW_BOTTOM),
    tileType: PLAZA_STONE,
  },
  {
    name: 'Civic Terrace',
    bounds: span(TERRACE_WEST, GARRISON_TOP, TERRACE_EAST, UPPER_LANE_BOTTOM),
    tileType: PLAZA_STONE,
  },
];

/** The plaza slab, restated so consumers do not have to search `surfaces` by name. */
const PLAZA_BOUNDS = span(PLAZA_WEST, PLAZA_RING_TOP, PLAZA_EAST, MARKET_ROW_BOTTOM);

// ── Gates ────────────────────────────────────────────────────────────────────

interface GateTemplate {
  readonly name: string;
  readonly bounds: TileRect;
  readonly apron: TileRect;
  readonly exit: TownOffset;
  readonly outward: TownOffset;
}

const GATE_TEMPLATES: ReadonlyArray<GateTemplate> = [
  {
    name: 'north gate',
    bounds: span(NORTH_GATE_WEST, WALL_NORTH, NORTH_GATE_EAST, WALL_NORTH),
    apron: span(
      NORTH_GATE_WEST - GATE_APRON_OVERHANG,
      WALL_NORTH - GATE_APRON_DEPTH,
      NORTH_GATE_EAST + GATE_APRON_OVERHANG,
      WALL_NORTH - 1,
    ),
    exit: { dx: Math.floor((NORTH_GATE_WEST + NORTH_GATE_EAST) / 2), dy: WALL_NORTH - 1 },
    outward: { dx: 0, dy: -1 },
  },
  {
    name: 'south gate',
    bounds: span(KINGS_ROAD_WEST, WALL_SOUTH, KINGS_ROAD_EAST, WALL_SOUTH),
    apron: span(
      KINGS_ROAD_WEST - GATE_APRON_OVERHANG,
      WALL_SOUTH + 1,
      KINGS_ROAD_EAST + GATE_APRON_OVERHANG,
      WALL_SOUTH + GATE_APRON_DEPTH,
    ),
    exit: { dx: Math.floor((KINGS_ROAD_WEST + KINGS_ROAD_EAST) / 2), dy: WALL_SOUTH + 1 },
    outward: { dx: 0, dy: 1 },
  },
  {
    name: 'west gate',
    bounds: span(WALL_WEST, MARKET_STREET_TOP, WALL_WEST, MARKET_STREET_BOTTOM),
    apron: span(
      WALL_WEST - GATE_APRON_DEPTH,
      MARKET_STREET_TOP - GATE_APRON_OVERHANG,
      WALL_WEST - 1,
      MARKET_STREET_BOTTOM + GATE_APRON_OVERHANG,
    ),
    exit: { dx: WALL_WEST - 1, dy: Math.floor((MARKET_STREET_TOP + MARKET_STREET_BOTTOM) / 2) },
    outward: { dx: -1, dy: 0 },
  },
  {
    name: 'east gate',
    bounds: span(WALL_EAST, MARKET_STREET_TOP, WALL_EAST, MARKET_STREET_BOTTOM),
    apron: span(
      WALL_EAST + 1,
      MARKET_STREET_TOP - GATE_APRON_OVERHANG,
      WALL_EAST + GATE_APRON_DEPTH,
      MARKET_STREET_BOTTOM + GATE_APRON_OVERHANG,
    ),
    exit: { dx: WALL_EAST + 1, dy: Math.floor((MARKET_STREET_TOP + MARKET_STREET_BOTTOM) / 2) },
    outward: { dx: 1, dy: 0 },
  },
];

// ── Building plots ───────────────────────────────────────────────────────────

/**
 * Building anchors, as signed tile offsets from the town centre.
 *
 * Listed north to south, band by band. Within a band every building is
 * bottom-aligned to the band's last row, which is what puts its door on the
 * street below, and the columns are packed shoulder to shoulder against the
 * lanes: the west band is an 8-tile plot, the West Lane, and an 8-tile plot;
 * the east band is the mirror of it. Widths come from each sprite's manifest
 * footprint, so a re-scaled building re-spaces its own band and the overlap
 * assertion in `generateOverworld` catches it if it no longer fits.
 */
const PLANNED_BUILDINGS: ReadonlyArray<PlannedBuilding> = [
  // Garrison Row — the north band, either side of the civic terrace.
  {
    west: OUTER_WEST_PLOT,
    frontRow: GARRISON_BOTTOM,
    plotTop: GARRISON_TOP,
    spriteKey: 'village_house_2',
    name: 'Blackwood Lodge',
    kind: 'house',
    sign: 'moon',
  },
  {
    west: GARRISON_SECOND_COTTAGE,
    frontRow: GARRISON_BOTTOM,
    plotTop: GARRISON_TOP,
    spriteKey: 'village_house_1',
    name: "Shepherd's Cabin",
    kind: 'house',
    sign: 'fleece',
  },
  {
    west: BARRACKS_PLOT_WEST,
    frontRow: GARRISON_BOTTOM,
    plotTop: GARRISON_TOP,
    spriteKey: 'barracks',
    name: 'The Barracks',
    kind: 'restaurant',
    sign: 'shield',
  },
  {
    west: OUTER_EAST_PLOT,
    frontRow: GARRISON_BOTTOM,
    plotTop: GARRISON_TOP,
    spriteKey: 'village_house_4',
    name: "Cartwright's Workshop",
    kind: 'house',
    sign: 'wheel',
  },

  // Plaza Ring — faith, medicine, supplies and beds around the square.
  {
    west: OUTER_WEST_PLOT,
    frontRow: PLAZA_RING_BOTTOM,
    plotTop: PLAZA_RING_TOP,
    spriteKey: 'temple',
    name: 'Temple of the Sky',
    kind: 'house',
    sign: 'sun',
  },
  {
    west: INNER_WEST_PLOT,
    frontRow: PLAZA_RING_BOTTOM,
    plotTop: PLAZA_RING_TOP,
    spriteKey: 'village_house_1',
    name: 'Herb & Remedy',
    kind: 'house',
    sign: 'mortar',
  },
  {
    west: INNER_EAST_PLOT,
    frontRow: PLAZA_RING_BOTTOM,
    plotTop: PLAZA_RING_TOP,
    spriteKey: 'shop',
    name: 'General Store',
    kind: 'store',
    sign: 'barrel',
  },
  {
    west: OUTER_EAST_PLOT,
    frontRow: PLAZA_RING_BOTTOM,
    plotTop: PLAZA_RING_TOP,
    spriteKey: 'small_inn',
    name: 'The Sleeping Cat Inn',
    kind: 'house',
    sign: 'bed',
  },

  // Market Row — the trades, fronting Market Street.
  {
    west: OUTER_WEST_PLOT,
    frontRow: MARKET_ROW_BOTTOM,
    plotTop: MARKET_ROW_TOP,
    spriteKey: 'tavern_2',
    name: 'The Horned Flagon',
    kind: 'house',
    sign: 'horn',
  },
  {
    west: INNER_WEST_PLOT,
    frontRow: MARKET_ROW_BOTTOM,
    plotTop: MARKET_ROW_TOP,
    spriteKey: 'village_house_3',
    name: "Old Hilda's Cottage",
    kind: 'house',
    sign: 'cauldron',
  },
  {
    west: INNER_EAST_PLOT,
    frontRow: MARKET_ROW_BOTTOM,
    plotTop: MARKET_ROW_TOP,
    spriteKey: 'blacksmith',
    name: 'The Rusty Anvil',
    kind: 'house',
    sign: 'hammer',
  },

  // Low Quarter — nightlife, and the alleys that serve it.
  {
    west: OUTER_WEST_PLOT,
    frontRow: LOW_QUARTER_BOTTOM,
    plotTop: LOW_QUARTER_TOP,
    spriteKey: 'tavern_1',
    name: 'The Sunken Stump Pub',
    kind: 'house',
    sign: 'tankard',
  },
  {
    west: INNER_WEST_PLOT,
    frontRow: LOW_QUARTER_BOTTOM,
    plotTop: LOW_QUARTER_TOP,
    spriteKey: 'tattoo_parlor',
    name: "Signet's Ink",
    kind: 'house',
    sign: 'quill',
  },
  {
    west: SERVICE_ALLEY_EAST + 1,
    frontRow: LOW_QUARTER_BOTTOM,
    plotTop: LOW_QUARTER_TOP,
    spriteKey: 'desperado_club',
    name: 'The Desperado Club',
    kind: 'club',
    sign: 'cards',
  },

  // South Green — the farm, against the south-east wall.
  {
    west: OUTER_EAST_PLOT,
    frontRow: LOW_QUARTER_BOTTOM,
    plotTop: LOW_QUARTER_TOP,
    spriteKey: 'village_house_4',
    name: "Miller's Farm",
    kind: 'house',
    sign: 'sheaf',
  },
];

// ── Yards, gardens and planted strips ────────────────────────────────────────

/**
 * The Garrison band's own green, between Shepherd's Cabin and the civic terrace.
 * It is the largest piece of block interior in the town — seven tiles square —
 * and the one place a fenced enclosure reads at a glance from a main street.
 */
const GARRISON_GREEN_WEST = -13;
const GARRISON_GREEN_EAST = TERRACE_WEST - 1;
/**
 * The green starts one row below the band's top, because the row above it is the
 * only way in or out of the strip behind Blackwood Lodge and Shepherd's Cabin.
 *
 * That strip is a single row wide, pinned between the north wall and the two
 * cottages' back walls, and its one lateral exit is east past the green. A green
 * that reached the wall put a corner post in exactly that gap and stranded
 * **14 walkable tiles** behind the cottages — reachable in the old town, dead in
 * the new one, and invisible on any screenshot of the finished map. Row `-18` is
 * therefore a back lane along the wall, running from the west wall to the civic
 * terrace, and the green's north fence faces it.
 */
const GARRISON_GREEN_TOP = GARRISON_TOP + 1;

/**
 * The Low Quarter's back gardens start one row below the band's top, leaving the
 * band's first row as a verge margin under Market Street. That row also carries
 * the two side-gate torches, and a fence line through a torch is a fence with a
 * hole in it.
 */
const BACK_GARDEN_TOP = LOW_QUARTER_TOP + 1;
const BACK_GARDEN_BOTTOM = 16;

/** Gates are stated as rectangles; these are the two widths the town uses. */
const SINGLE_GATE_WIDTH = 1;
const CART_GATE_WIDTH = 2;
/**
 * How far along an edge a gate starts. Two tiles in on every yard, so no gate
 * lands on a corner post — a corner is where two fence runs meet and is the one
 * tile that has to stay.
 */
const GATE_INSET_TILES = 2;

/**
 * Every yard, garden and planted strip in the town.
 *
 * Fenced entries enclose a block interior; the unfenced ones are the single-row
 * strips a band leaves behind or beside a building, which are planted but never
 * fenced — a fence around a one-tile-deep strip is all perimeter and no inside.
 *
 * Every one of them must land on the surface its kind implies, which
 * `assertYardsStandOnTheirOwnSurface` checks against the painted grid rather than
 * against these rectangles: the surfaces above are painted in order and a later
 * one can take a tile a yard was written for.
 */
const PLANNED_YARDS: ReadonlyArray<PlannedYard> = [
  {
    name: 'Garrison Green',
    bounds: span(GARRISON_GREEN_WEST, GARRISON_GREEN_TOP, GARRISON_GREEN_EAST, GARRISON_BOTTOM),
    kind: 'garden',
    fence: 'picket',
    fenced: true,
    // Onto the Upper Lane, which is the only side of it that is not a building,
    // the terrace or the wall.
    gates: [
      span(
        GARRISON_GREEN_WEST + GATE_INSET_TILES,
        GARRISON_BOTTOM,
        GARRISON_GREEN_WEST + GATE_INSET_TILES + CART_GATE_WIDTH - 1,
        GARRISON_BOTTOM,
      ),
    ],
  },
  {
    name: 'Sunken Stump back garden',
    bounds: span(INTERIOR_WEST, BACK_GARDEN_TOP, WEST_LANE_WEST - 1, BACK_GARDEN_BOTTOM),
    kind: 'garden',
    fence: 'wattle',
    fenced: true,
    gates: [
      span(
        WEST_LANE_WEST - 1,
        BACK_GARDEN_TOP + SINGLE_GATE_WIDTH,
        WEST_LANE_WEST - 1,
        BACK_GARDEN_TOP + SINGLE_GATE_WIDTH + CART_GATE_WIDTH - 1,
      ),
    ],
  },
  /**
   * Signet's Ink's garden and the drying green beside it, as one enclosure: the
   * two are an L rather than two rectangles, and the fence painter skips any tile
   * standing under building art, so stating the whole block and letting Signet's
   * own facade close the middle of it is simpler than fencing two plots back to
   * back along a line nobody can walk.
   */
  {
    name: "Signet's back garden",
    bounds: span(INNER_WEST_PLOT, BACK_GARDEN_TOP, KINGS_ROAD_WEST - 1, LOW_QUARTER_BOTTOM),
    kind: 'garden',
    fence: 'picket',
    fenced: true,
    gates: [
      span(
        INNER_WEST_PLOT,
        BACK_GARDEN_TOP + SINGLE_GATE_WIDTH,
        INNER_WEST_PLOT,
        BACK_GARDEN_TOP + SINGLE_GATE_WIDTH + CART_GATE_WIDTH - 1,
      ),
      span(
        KINGS_ROAD_WEST - GATE_INSET_TILES - CART_GATE_WIDTH,
        LOW_QUARTER_BOTTOM,
        KINGS_ROAD_WEST - GATE_INSET_TILES - 1,
        LOW_QUARTER_BOTTOM,
      ),
    ],
  },
  {
    name: "Miller's kitchen garden",
    bounds: span(OUTER_EAST_PLOT, LOW_QUARTER_TOP, INTERIOR_EAST, FARM_YARD_BOTTOM),
    kind: 'garden',
    fence: 'wattle',
    fenced: true,
    gates: [
      span(
        OUTER_EAST_PLOT,
        LOW_QUARTER_TOP + SINGLE_GATE_WIDTH,
        OUTER_EAST_PLOT,
        LOW_QUARTER_TOP + SINGLE_GATE_WIDTH,
      ),
    ],
  },
  {
    name: 'Market Row east workyard',
    bounds: span(OUTER_EAST_PLOT, MARKET_ROW_TOP, INTERIOR_EAST, MARKET_ROW_BOTTOM),
    kind: 'workyard',
    fence: 'post_and_rail',
    fenced: true,
    gates: [
      span(
        OUTER_EAST_PLOT,
        MARKET_ROW_TOP + GATE_INSET_TILES,
        OUTER_EAST_PLOT,
        MARKET_ROW_TOP + GATE_INSET_TILES + CART_GATE_WIDTH - 1,
      ),
    ],
  },

  // Planted strips: the single rows and columns a band leaves over once its
  // buildings are packed against the lanes. Left bare they read as offcuts.
  {
    name: 'Garrison back strip',
    bounds: span(INTERIOR_WEST, GARRISON_TOP, TERRACE_WEST - 1, GARRISON_TOP),
    kind: 'garden',
    fence: 'wattle',
    fenced: false,
    gates: [],
  },
  {
    name: 'Herb & Remedy back strip',
    bounds: span(INNER_WEST_PLOT, PLAZA_RING_TOP, PLAZA_WEST - 1, PLAZA_RING_TOP),
    kind: 'garden',
    fence: 'picket',
    fenced: false,
    gates: [],
  },
  {
    name: 'Herb & Remedy side strip',
    bounds: span(PLAZA_WEST - 1, PLAZA_RING_TOP + 1, PLAZA_WEST - 1, PLAZA_RING_BOTTOM),
    kind: 'garden',
    fence: 'picket',
    fenced: false,
    gates: [],
  },
  {
    name: 'General Store back strip',
    bounds: span(INNER_EAST_PLOT, PLAZA_RING_TOP, INNER_EAST_PLOT + PLOT_WIDTH - 1, PLAZA_RING_TOP),
    kind: 'garden',
    fence: 'picket',
    fenced: false,
    gates: [],
  },
  {
    name: 'Sleeping Cat back strip',
    bounds: span(OUTER_EAST_PLOT, PLAZA_RING_TOP, INTERIOR_EAST, PLAZA_RING_TOP),
    kind: 'garden',
    fence: 'picket',
    fenced: false,
    gates: [],
  },
  {
    name: 'Horned Flagon back strip',
    bounds: span(INTERIOR_WEST, MARKET_ROW_TOP, WEST_LANE_WEST - 1, MARKET_ROW_TOP),
    kind: 'garden',
    fence: 'wattle',
    fenced: false,
    gates: [],
  },
  {
    name: "Old Hilda's side strip",
    bounds: span(PLAZA_WEST - 1, MARKET_ROW_TOP, PLAZA_WEST - 1, MARKET_ROW_BOTTOM),
    kind: 'garden',
    fence: 'wattle',
    fenced: false,
    gates: [],
  },
  {
    name: 'Rusty Anvil back strip',
    bounds: span(INNER_EAST_PLOT, MARKET_ROW_TOP, INNER_EAST_PLOT + PLOT_WIDTH - 1, MARKET_ROW_TOP),
    kind: 'garden',
    fence: 'post_and_rail',
    fenced: false,
    gates: [],
  },
];

/**
 * The town's named quarters, with an anchor each.
 *
 * **Four, not five, and stacked vertically.** The expanded minimap draws one
 * pixel per tile, so the whole 55-tile town is 55 px across — and one of these
 * captions is *wider than that* at the 9 px it is drawn: measured through the
 * real text path, their ink boxes run 62–68 px. Two labels therefore cannot share
 * a row at any size worth reading, and at 11 px of line height only four fit in
 * the town's 43 rows. Market Row lost its label to that arithmetic; it is the
 * band between the plaza and Market Street and reads as the plaza's own orbit.
 *
 * The anchors are hand-placed rather than computed as band centres for the same
 * reason: three of the bands are centred on the plaza's own column, so computed
 * anchors would stack on top of each other.
 */
const DISTRICT_LABELS: ReadonlyArray<{ name: string; label: TownOffset }> = [
  { name: 'Garrison Row', label: { dx: -6, dy: -15 } },
  { name: 'Market Plaza', label: { dx: 0, dy: 0 } },
  { name: 'Low Quarter', label: { dx: -13, dy: 12 } },
  { name: 'South Green', label: { dx: 23, dy: 23 } },
];

function planProps(centre: TilePoint): ReadonlyArray<PlannedProp> {
  const { x: cx, y: cy } = centre;
  const towerTorchRow = cy - TOWER_TORCH_ROW_OFFSET;
  const at = (dx: number, dy: number): TilePoint => ({ x: cx + dx, y: cy + dy });
  return [
    {
      kind: 'fountain',
      bounds: {
        x: cx + FOUNTAIN_WEST_COLUMN,
        y: cy + FOUNTAIN_NORTH_ROW,
        w: FOUNTAIN_SIZE,
        h: FOUNTAIN_SIZE,
      },
    },
    // The plaza's four corners.
    { kind: 'torch', tile: at(PLAZA_WEST, PLAZA_RING_TOP) },
    { kind: 'torch', tile: at(PLAZA_EAST, PLAZA_RING_TOP) },
    // One row in from the plaza's south corners, not on them: a prop takes the
    // material of the first real floor south of it, and the slab's last row has
    // Market Street's cobble below, so a torch on the corner itself drew cobble
    // ground in the middle of the flagstone — and dragged the neighbouring tiles'
    // blend toward cobble with it.
    { kind: 'torch', tile: at(PLAZA_WEST, MARKET_ROW_BOTTOM - 1) },
    { kind: 'torch', tile: at(PLAZA_EAST, MARKET_ROW_BOTTOM - 1) },
    // Where the terrace opens onto the plaza, and the tower's own foot.
    { kind: 'torch', tile: at(TERRACE_WEST, TERRACE_MOUTH_ROW) },
    { kind: 'torch', tile: at(TERRACE_EAST, TERRACE_MOUTH_ROW) },
    { kind: 'torch', tile: { x: cx - TOWER_TORCH_WEST_OFFSET, y: towerTorchRow } },
    { kind: 'torch', tile: { x: cx + TOWER_TORCH_EAST_OFFSET, y: towerTorchRow } },
    // Just inside each gate.
    { kind: 'torch', tile: at(SOUTH_GATE_TORCH_WEST, INTERIOR_SOUTH) },
    { kind: 'torch', tile: at(SOUTH_GATE_TORCH_EAST, INTERIOR_SOUTH) },
    { kind: 'torch', tile: at(INTERIOR_WEST, SIDE_GATE_TORCH_ROW) },
    { kind: 'torch', tile: at(INTERIOR_EAST, SIDE_GATE_TORCH_ROW) },
    { kind: 'well', tile: at(WELL_SOUTH_WEST.dx, WELL_SOUTH_WEST.dy) },
    { kind: 'well', tile: at(WELL_NORTH_EAST.dx, WELL_NORTH_EAST.dy) },
  ];
}

/** Builds the town plan for a map of `size` tiles a side, centred on that map. */
export function createTownPlan(size: number): TownPlan {
  const centre: TilePoint = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const { x: cx, y: cy } = centre;

  return {
    centre,
    wall: shift(span(WALL_WEST, WALL_NORTH, WALL_EAST, WALL_SOUTH), centre),
    interior: shift(span(INTERIOR_WEST, INTERIOR_NORTH, INTERIOR_EAST, INTERIOR_SOUTH), centre),
    gates: GATE_TEMPLATES.map((gate) => ({
      name: gate.name,
      bounds: shift(gate.bounds, centre),
      tileType: COBBLE_STREET,
      apron: shift(gate.apron, centre),
      exit: { x: cx + gate.exit.dx, y: cy + gate.exit.dy },
      outward: gate.outward,
    })),
    surfaces: PLANNED_SURFACES.map((surface) => ({
      name: surface.name,
      bounds: shift(surface.bounds, centre),
      tileType: surface.tileType,
    })),
    plaza: shift(PLAZA_BOUNDS, centre),
    tower: {
      anchor: { dx: 0, dy: -TOWER_ANCHOR_NORTH_OFFSET },
      door: { dx: -TOWER_DOOR_WEST_OFFSET, dy: -TOWER_DOOR_NORTH_OFFSET },
      name: 'Town Center Tower',
      kind: 'tower',
    },
    buildings: PLANNED_BUILDINGS,
    yards: PLANNED_YARDS.map((yard) => ({
      name: yard.name,
      bounds: shift(yard.bounds, centre),
      kind: yard.kind,
      fence: yard.fence,
      fenced: yard.fenced,
      gates: yard.gates.map((gate) => shift(gate, centre)),
    })),
    props: planProps(centre),
    districts: DISTRICT_LABELS.map((district) => ({
      name: district.name,
      label: { x: cx + district.label.dx, y: cy + district.label.dy },
    })),
    doomsdayEscapeTile: {
      x: cx - TOWER_DOOR_WEST_OFFSET,
      y: cy - TOWER_DOOR_NORTH_OFFSET + STAIRWELL_SOUTH_OF_TOWER_DOOR,
    },
    safeRadiusTiles: TOWN_SAFE_RADIUS_TILES,
    groundCover: {
      weedDensityOnGrass: GRASSY_WEED_DENSITY,
      dirtPatchDensityOnRoad: DIRT_PATCH_DENSITY,
      plantingDensityInGardens: GARDEN_PLANTING_DENSITY,
    },
  };
}

/** Resolves a centre-relative offset to an absolute tile. */
export function offsetToTile(plan: TownPlan, offset: TownOffset): TilePoint {
  return { x: plan.centre.x + offset.dx, y: plan.centre.y + offset.dy };
}
