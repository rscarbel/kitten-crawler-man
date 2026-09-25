/**
 * Briar Hollow's authored street plan, in site-relative tile coordinates.
 *
 * Origin (0, 0) is the north-west corner of the palisade's bounding rectangle;
 * `shiftPoint` / `shiftRect` in `briarHollowSite.ts` move everything onto the
 * map. The village is a plan rather than a scatter because a real village has
 * one: a main street runs north from the south gate to the square, the
 * workshops stand where the work is (the forge and store by the west lane, the
 * sawmill in the lumber yard), the farm and its pasture take the quiet
 * north-east, and the homes sit in the south-east away from the traffic.
 *
 * **Nothing here may depend on the world seed.** Geometry is fixed so every
 * system that keys on a tile — the palisade's persisted segment ids, a
 * villager's work post, the sawmill's processing hook — sees the same village
 * on every map. Seeded variety is confined to dressing, which the painter
 * draws separately (`BriarHollowDressing`).
 */

import type { TilePoint, TileRect } from '../town/townPlan';

// ── The palisade ──────────────────────────────────────────────────────────────

/**
 * Outer size of the palisade ring, walls included.
 *
 * A little smaller than the town's 57 x 45 walled footprint, which is what the
 * village is meant to read as — and the smallest rectangle that seats fifteen
 * buildings, a fenced pasture, two crop fields, a grove and a square with a
 * tile of walkway round every building and two in front of every door.
 */
export const VILLAGE_BOUNDS_W = 58;
export const VILLAGE_BOUNDS_H = 40;

/**
 * Depth of the 45° chamfer cut from each corner of the ring, in tiles. The
 * corner becomes a stepped diagonal, which is what makes the ring read as a
 * built stockade rather than a box.
 */
export const PALISADE_CHAMFER_TILES = 3;

/** The gate: three tiles of the south wall, west of centre so the main street lines up with the square. */
export const GATE_X0 = 22;
export const GATE_WIDTH_TILES = 3;
/** How far outside and inside the wall the gate's approach tiles sit, from its middle tile. */
export const GATE_APPROACH_TILES = 2;

// ── Streets ───────────────────────────────────────────────────────────────────

/** Main street: from the gate north to the square, as wide as the gate. */
export const MAIN_STREET: TileRect = { x: GATE_X0, y: 26, w: GATE_WIDTH_TILES, h: 13 };
/** The cross lane between the north band (yard, farm, pasture) and the village's middle. */
export const CROSS_LANE: TileRect = { x: 2, y: 13, w: 54, h: 2 };
/** The square the main street opens into; the bell tower stands in its middle. */
export const SQUARE: TileRect = { x: 16, y: 16, w: 15, h: 10 };

/** Worn footpaths, drawn as `DIRT_PATCH`: the desire lines between doors and the lanes. */
export const WORN_PATHS: ReadonlyArray<TileRect> = [
  // Store and forge up to the lane.
  { x: 11, y: 15, w: 1, h: 16 },
  // From the square's east edge past the infirmary to the homes.
  { x: 31, y: 24, w: 2, h: 1 },
  { x: 32, y: 24, w: 1, h: 8 },
  { x: 32, y: 31, w: 18, h: 1 },
  // The farmhouse's door down to the lane.
  { x: 26, y: 8, w: 1, h: 5 },
  // The hall's door down to the infirmary path.
  { x: 39, y: 23, w: 2, h: 1 },
];

// ── Props ─────────────────────────────────────────────────────────────────────

/** How a prop sits in the world: blocking and low, blocking and tall, or flat dressing. */
export type VillagePropKind = 'low' | 'tall' | 'decal';

interface VillagePropSpec {
  readonly kind: VillagePropKind;
  /** Footprint, in tiles. The anchor is the footprint's north-west tile. */
  readonly w: number;
  readonly h: number;
}

/**
 * Every prop the village stands up, with its footprint and how it sits.
 *
 * Low props are the ones a crawler can see and shoot over (benches, troughs,
 * crates, beds, tables, counters); tall ones block sight (the bell tower, the
 * hearths, shelves, racks, the sawmill). The art for each is selected by
 * `villagePropSpriteKey`.
 */
export const VILLAGE_PROPS = {
  bell_tower: { kind: 'tall', w: 2, h: 2 },
  well: { kind: 'low', w: 1, h: 1 },
  notice_board: { kind: 'tall', w: 1, h: 1 },
  lamp_post: { kind: 'low', w: 1, h: 1 },
  bench: { kind: 'low', w: 1, h: 1 },
  forge_hearth: { kind: 'tall', w: 2, h: 2 },
  anvil: { kind: 'low', w: 1, h: 1 },
  quench_trough: { kind: 'low', w: 2, h: 1 },
  water_trough: { kind: 'low', w: 2, h: 1 },
  tool_rack: { kind: 'tall', w: 1, h: 1 },
  coal_bin: { kind: 'low', w: 1, h: 1 },
  cooking_hearth: { kind: 'tall', w: 2, h: 1 },
  serving_counter: { kind: 'low', w: 3, h: 1 },
  table: { kind: 'low', w: 2, h: 1 },
  long_table: { kind: 'low', w: 4, h: 1 },
  cot: { kind: 'low', w: 1, h: 2 },
  bed: { kind: 'low', w: 1, h: 2 },
  shelf_records: { kind: 'tall', w: 1, h: 1 },
  shelf_herbs: { kind: 'tall', w: 1, h: 1 },
  shelf_goods: { kind: 'tall', w: 1, h: 1 },
  desk: { kind: 'low', w: 2, h: 1 },
  banner: { kind: 'tall', w: 1, h: 1 },
  hearth: { kind: 'tall', w: 1, h: 1 },
  drafting_table: { kind: 'low', w: 2, h: 1 },
  trebuchet_model: { kind: 'low', w: 1, h: 1 },
  workbench: { kind: 'low', w: 2, h: 1 },
  gear_crate: { kind: 'low', w: 1, h: 1 },
  sawmill_machine: { kind: 'tall', w: 2, h: 3 },
  rope_frame: { kind: 'low', w: 2, h: 1 },
  log_pile: { kind: 'low', w: 2, h: 1 },
  board_stack: { kind: 'low', w: 1, h: 1 },
  stone_pile: { kind: 'low', w: 1, h: 1 },
  chopping_block: { kind: 'low', w: 1, h: 1 },
  crate: { kind: 'low', w: 1, h: 1 },
  barrel: { kind: 'low', w: 1, h: 1 },
  sack: { kind: 'low', w: 1, h: 1 },
  hay_bale: { kind: 'low', w: 1, h: 1 },
  feed_bin: { kind: 'low', w: 1, h: 1 },
  scarecrow: { kind: 'tall', w: 1, h: 1 },
  mushroom_log_bed: { kind: 'low', w: 2, h: 1 },
  weapon_rack: { kind: 'tall', w: 1, h: 1 },
  bunk: { kind: 'low', w: 1, h: 2 },
  loom: { kind: 'low', w: 2, h: 1 },
  half_built_cart: { kind: 'low', w: 2, h: 1 },
  broken_cart: { kind: 'low', w: 2, h: 1 },
  washbasin: { kind: 'low', w: 1, h: 1 },
  stool: { kind: 'low', w: 1, h: 1 },
  fabric_bolts: { kind: 'low', w: 1, h: 1 },
  bucket: { kind: 'low', w: 1, h: 1 },
  tool_pegs: { kind: 'tall', w: 1, h: 1 },
  lamp_shelf: { kind: 'tall', w: 1, h: 1 },
  oil_cans: { kind: 'low', w: 1, h: 1 },
  seed_sacks: { kind: 'low', w: 1, h: 1 },
  hoe_rack: { kind: 'tall', w: 1, h: 1 },
  pick_rack: { kind: 'tall', w: 1, h: 1 },
  sawdust: { kind: 'decal', w: 1, h: 1 },
  straw: { kind: 'decal', w: 1, h: 1 },
  soot: { kind: 'decal', w: 1, h: 1 },
  rug: { kind: 'decal', w: 1, h: 1 },
  leaves: { kind: 'decal', w: 1, h: 1 },
  path_wear: { kind: 'decal', w: 1, h: 1 },
  toy: { kind: 'decal', w: 1, h: 1 },
} as const satisfies Record<string, VillagePropSpec>;

export type VillagePropId = keyof typeof VILLAGE_PROPS;

/** Props that are clutter, and may be swapped for one another by the world seed. */
export const CLUTTER_PROPS = [
  'crate',
  'barrel',
  'sack',
] as const satisfies readonly VillagePropId[];
export type ClutterPropId = (typeof CLUTTER_PROPS)[number];

/** The sprite-key prefix of a village prop's anchor tile. */
const PROP_KEY_PREFIX = 'hollow:';
/** The sprite-key prefix of a prop's non-anchor footprint tile. */
const PROP_PART_KEY_PREFIX = 'hollow_part:';

/** The `spriteKey` a prop's anchor (north-west) tile carries. */
export function villagePropSpriteKey(prop: VillagePropId): string {
  return `${PROP_KEY_PREFIX}${prop}`;
}

/**
 * The `spriteKey` a prop's other footprint tiles carry: the offset back to the
 * anchor, so the tile blocks without drawing and a renderer can find the art.
 */
export function villagePropPartSpriteKey(dxToAnchor: number, dyToAnchor: number): string {
  return `${PROP_PART_KEY_PREFIX}${dxToAnchor},${dyToAnchor}`;
}

function isVillagePropId(value: string): value is VillagePropId {
  return Object.prototype.hasOwnProperty.call(VILLAGE_PROPS, value);
}

/** The prop a `hollow:` sprite key names, or `null` for any other key. */
export function villagePropFromSpriteKey(spriteKey: string | undefined): VillagePropId | null {
  if (spriteKey?.startsWith(PROP_KEY_PREFIX) !== true) return null;
  const id = spriteKey.slice(PROP_KEY_PREFIX.length);
  return isVillagePropId(id) ? id : null;
}

/** The offset from a footprint part back to its anchor, or `null` for any other key. */
export function villagePropPartOffset(
  spriteKey: string | undefined,
): { readonly dx: number; readonly dy: number } | null {
  if (spriteKey?.startsWith(PROP_PART_KEY_PREFIX) !== true) return null;
  const [dxText, dyText] = spriteKey.slice(PROP_PART_KEY_PREFIX.length).split(',');
  const dx = Number(dxText);
  const dy = Number(dyText);
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return null;
  return { dx, dy };
}

/** One prop in the template: which prop, and its anchor (north-west) tile. */
export interface PropTemplate {
  readonly prop: VillagePropId;
  readonly x: number;
  readonly y: number;
}

/** A prop placed on the map, with its footprint resolved. */
export interface PropPlacement extends PropTemplate {
  readonly kind: VillagePropKind;
  readonly w: number;
  readonly h: number;
}

/** A prop's footprint tiles, anchor first. */
export function propFootprint(placement: PropTemplate): TilePoint[] {
  const spec: VillagePropSpec = VILLAGE_PROPS[placement.prop];
  const tiles: TilePoint[] = [];
  for (let dy = 0; dy < spec.h; dy++) {
    for (let dx = 0; dx < spec.w; dx++) tiles.push({ x: placement.x + dx, y: placement.y + dy });
  }
  return tiles;
}

/** A template prop resolved against the prop table. */
export function resolveProp(template: PropTemplate): PropPlacement {
  const spec: VillagePropSpec = VILLAGE_PROPS[template.prop];
  return { ...template, kind: spec.kind, w: spec.w, h: spec.h };
}

// ── Buildings ─────────────────────────────────────────────────────────────────

export type VillageBuildingId =
  | 'hall'
  | 'forge'
  | 'cookhouse'
  | 'infirmary'
  | 'store'
  | 'workshop'
  | 'sawmill'
  | 'guardhouse'
  | 'farmhouse'
  | 'barn'
  | 'home_nella'
  | 'home_cricket'
  | 'home_wicker'
  | 'home_midge'
  | 'garn_hut';

export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * A doorway: a run of wall replaced by threshold.
 *
 * `offset` counts from the wall's west end (north and south walls) or north end
 * (east and west walls), corners included, so an offset of 0 would be the corner
 * post — which no doorway uses, because every building keeps its corner posts.
 */
export interface DoorwaySpec {
  readonly side: WallSide;
  readonly offset: number;
  readonly width: number;
}

/**
 * What a building's floor is made of. Planks for rooms people live and trade
 * in; beaten earth and gravel for the ones where the work is dirty.
 */
export type VillageFloor = 'planks' | 'working';

export interface BuildingTemplate {
  readonly id: VillageBuildingId;
  /** Minimap and tooltip name. */
  readonly name: string;
  /** Outer footprint, walls included, in site coordinates. */
  readonly rect: TileRect;
  readonly doorways: ReadonlyArray<DoorwaySpec>;
  readonly floor: VillageFloor;
  /**
   * Where each occupant stands to work, relative to the building's north-west
   * corner. Each one is next to the prop the occupant works at.
   */
  readonly occupantAnchors: ReadonlyArray<TilePoint>;
  /** Furniture, relative to the building's north-west corner. */
  readonly furniture: ReadonlyArray<PropTemplate>;
}

/** The village's buildings, in site coordinates. Occupants are noted where they have one. */
export const BUILDINGS: ReadonlyArray<BuildingTemplate> = [
  {
    // Bramblewick.
    id: 'hall',
    name: "Mayor's Hall",
    rect: { x: 34, y: 15, w: 12, h: 8 },
    doorways: [{ side: 'south', offset: 5, width: 2 }],
    floor: 'planks',
    occupantAnchors: [{ x: 8, y: 2 }],
    furniture: [
      { prop: 'shelf_records', x: 1, y: 1 },
      { prop: 'shelf_records', x: 2, y: 1 },
      { prop: 'banner', x: 5, y: 1 },
      { prop: 'desk', x: 8, y: 1 },
      { prop: 'hearth', x: 10, y: 3 },
      { prop: 'long_table', x: 3, y: 3 },
      { prop: 'bench', x: 3, y: 4 },
      { prop: 'bench', x: 6, y: 4 },
      { prop: 'rug', x: 8, y: 3 },
    ],
  },
  {
    // Oren. Open on the south: the corner posts and a knee wall either side of
    // a three-tile opening.
    id: 'forge',
    name: 'Ironwhisker Forge',
    rect: { x: 2, y: 15, w: 9, h: 7 },
    doorways: [{ side: 'south', offset: 3, width: 3 }],
    floor: 'working',
    occupantAnchors: [{ x: 4, y: 3 }],
    furniture: [
      { prop: 'forge_hearth', x: 1, y: 1 },
      { prop: 'anvil', x: 4, y: 2 },
      { prop: 'quench_trough', x: 6, y: 1 },
      { prop: 'tool_rack', x: 7, y: 3 },
      { prop: 'coal_bin', x: 1, y: 4 },
      { prop: 'soot', x: 3, y: 2 },
    ],
  },
  {
    // Pipkin.
    id: 'cookhouse',
    name: "Pipkin's Cookhouse",
    rect: { x: 12, y: 28, w: 10, h: 7 },
    doorways: [
      { side: 'south', offset: 3, width: 2 },
      { side: 'east', offset: 3, width: 1 },
    ],
    floor: 'planks',
    occupantAnchors: [{ x: 5, y: 1 }],
    furniture: [
      { prop: 'cooking_hearth', x: 1, y: 1 },
      { prop: 'serving_counter', x: 4, y: 2 },
      { prop: 'sack', x: 8, y: 1 },
      { prop: 'table', x: 1, y: 4 },
      { prop: 'table', x: 6, y: 4 },
      { prop: 'bench', x: 2, y: 5 },
      { prop: 'bench', x: 7, y: 5 },
    ],
  },
  {
    // Sella.
    id: 'infirmary',
    name: 'Infirmary',
    rect: { x: 33, y: 25, w: 8, h: 6 },
    doorways: [{ side: 'west', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 4, y: 2 }],
    furniture: [
      { prop: 'cot', x: 5, y: 1 },
      { prop: 'cot', x: 6, y: 1 },
      { prop: 'shelf_herbs', x: 1, y: 1 },
      { prop: 'washbasin', x: 6, y: 4 },
      { prop: 'stool', x: 4, y: 3 },
      { prop: 'table', x: 2, y: 4 },
    ],
  },
  {
    // Vetch.
    id: 'store',
    name: 'Nibnose Trading Post',
    rect: { x: 2, y: 24, w: 8, h: 6 },
    doorways: [{ side: 'east', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 1 }],
    furniture: [
      { prop: 'serving_counter', x: 2, y: 2 },
      { prop: 'shelf_goods', x: 1, y: 1 },
      { prop: 'shelf_goods', x: 1, y: 3 },
      { prop: 'crate', x: 1, y: 4 },
      { prop: 'barrel', x: 2, y: 4 },
      { prop: 'sack', x: 5, y: 4 },
      { prop: 'barrel', x: 6, y: 4 },
    ],
  },
  {
    // Tikka.
    id: 'workshop',
    name: "Engineer's Workshop",
    rect: { x: 43, y: 24, w: 8, h: 7 },
    doorways: [{ side: 'west', offset: 3, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 2 }],
    furniture: [
      { prop: 'drafting_table', x: 3, y: 1 },
      { prop: 'gear_crate', x: 6, y: 1 },
      { prop: 'gear_crate', x: 6, y: 2 },
      { prop: 'trebuchet_model', x: 6, y: 5 },
      { prop: 'workbench', x: 3, y: 5 },
    ],
  },
  {
    // Fenna. Open along the whole north side, facing the grove the logs come
    // from; the sawmill machine is the manual processing station.
    id: 'sawmill',
    name: 'Splintertail Sawmill',
    rect: { x: 9, y: 7, w: 10, h: 6 },
    doorways: [{ side: 'north', offset: 1, width: 8 }],
    floor: 'working',
    occupantAnchors: [{ x: 3, y: 3 }],
    furniture: [
      { prop: 'sawmill_machine', x: 1, y: 2 },
      { prop: 'rope_frame', x: 5, y: 4 },
      { prop: 'log_pile', x: 7, y: 2 },
      { prop: 'board_stack', x: 8, y: 4 },
      { prop: 'sawdust', x: 3, y: 2 },
      { prop: 'sawdust', x: 4, y: 4 },
    ],
  },
  {
    // The militia's post, beside the gate and facing the main street.
    id: 'guardhouse',
    name: 'Guardhouse',
    rect: { x: 25, y: 32, w: 7, h: 6 },
    doorways: [{ side: 'west', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ],
    furniture: [
      { prop: 'table', x: 3, y: 1 },
      { prop: 'weapon_rack', x: 5, y: 1 },
      { prop: 'bunk', x: 4, y: 3 },
      { prop: 'bunk', x: 5, y: 3 },
    ],
  },
  {
    // Merrit.
    id: 'farmhouse',
    name: 'Roottail Farmhouse',
    rect: { x: 23, y: 2, w: 7, h: 6 },
    doorways: [{ side: 'south', offset: 3, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 2 }],
    furniture: [
      { prop: 'bed', x: 1, y: 1 },
      { prop: 'table', x: 3, y: 1 },
      { prop: 'seed_sacks', x: 5, y: 1 },
      { prop: 'seed_sacks', x: 5, y: 2 },
      { prop: 'hoe_rack', x: 5, y: 4 },
    ],
  },
  {
    // The cows' shelter. Open on the east, facing the pasture gate, so a cow can
    // walk from the paddock straight in under cover.
    id: 'barn',
    name: 'Barn',
    rect: { x: 32, y: 3, w: 9, h: 7 },
    doorways: [{ side: 'east', offset: 2, width: 3 }],
    floor: 'working',
    occupantAnchors: [{ x: 4, y: 3 }],
    furniture: [
      { prop: 'hay_bale', x: 1, y: 1 },
      { prop: 'hay_bale', x: 2, y: 1 },
      { prop: 'hay_bale', x: 1, y: 2 },
      { prop: 'water_trough', x: 3, y: 5 },
      { prop: 'feed_bin', x: 1, y: 5 },
    ],
  },
  {
    // Nella.
    id: 'home_nella',
    name: 'Softstep Cottage',
    rect: { x: 33, y: 32, w: 6, h: 5 },
    doorways: [{ side: 'south', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 2 }],
    furniture: [
      { prop: 'bed', x: 1, y: 1 },
      { prop: 'loom', x: 3, y: 1 },
      { prop: 'fabric_bolts', x: 4, y: 3 },
      { prop: 'rug', x: 2, y: 2 },
    ],
  },
  {
    // Cricket.
    id: 'home_cricket',
    name: 'Mudwhisk Cottage',
    rect: { x: 41, y: 32, w: 6, h: 5 },
    doorways: [{ side: 'west', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 2 }],
    furniture: [
      { prop: 'bed', x: 4, y: 1 },
      { prop: 'tool_pegs', x: 1, y: 1 },
      { prop: 'bucket', x: 2, y: 3 },
      { prop: 'rug', x: 2, y: 2 },
    ],
  },
  {
    // Wicker: a workshop-home, with the half-built cart outside.
    id: 'home_wicker',
    name: 'Longtooth Workshop',
    rect: { x: 3, y: 32, w: 7, h: 5 },
    doorways: [{ side: 'north', offset: 3, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 4, y: 2 }],
    furniture: [
      { prop: 'bed', x: 1, y: 1 },
      { prop: 'workbench', x: 4, y: 3 },
      { prop: 'board_stack', x: 5, y: 1 },
      { prop: 'rug', x: 2, y: 2 },
    ],
  },
  {
    // Midge, with the lamp shed.
    id: 'home_midge',
    name: 'Candleear Cottage',
    rect: { x: 49, y: 32, w: 6, h: 5 },
    doorways: [{ side: 'north', offset: 2, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 3, y: 2 }],
    furniture: [
      { prop: 'bed', x: 4, y: 2 },
      { prop: 'lamp_shelf', x: 1, y: 2 },
      { prop: 'oil_cans', x: 1, y: 3 },
      { prop: 'rug', x: 2, y: 3 },
    ],
  },
  {
    // Garn, out in the quarry.
    id: 'garn_hut',
    name: 'Quarry Hut',
    rect: { x: 51, y: 43, w: 5, h: 4 },
    doorways: [{ side: 'west', offset: 1, width: 1 }],
    floor: 'planks',
    occupantAnchors: [{ x: 2, y: 2 }],
    furniture: [
      { prop: 'stool', x: 3, y: 1 },
      { prop: 'pick_rack', x: 3, y: 2 },
    ],
  },
];

/** The buildings that stand inside the palisade — every one but the quarry hut. */
export const OUTSIDE_BUILDINGS: ReadonlySet<VillageBuildingId> = new Set(['garn_hut']);

/** The tiles of a doorway, in site coordinates. */
export function doorwayTiles(rect: TileRect, spec: DoorwaySpec): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let i = 0; i < spec.width; i++) {
    const along = spec.offset + i;
    switch (spec.side) {
      case 'north':
        tiles.push({ x: rect.x + along, y: rect.y });
        break;
      case 'south':
        tiles.push({ x: rect.x + along, y: rect.y + rect.h - 1 });
        break;
      case 'west':
        tiles.push({ x: rect.x, y: rect.y + along });
        break;
      case 'east':
        tiles.push({ x: rect.x + rect.w - 1, y: rect.y + along });
        break;
    }
  }
  return tiles;
}

/** The unit step from a doorway out of its building. */
export function outwardStep(side: WallSide): { readonly dx: number; readonly dy: number } {
  switch (side) {
    case 'north':
      return { dx: 0, dy: -1 };
    case 'south':
      return { dx: 0, dy: 1 };
    case 'west':
      return { dx: -1, dy: 0 };
    case 'east':
      return { dx: 1, dy: 0 };
  }
}

// ── The square ────────────────────────────────────────────────────────────────

/** The bell tower's north-west tile: the middle of the square, on the main street's line. */
export const BELL_TOWER: TilePoint = { x: 23, y: 19 };
export const WELLS: ReadonlyArray<TilePoint> = [
  { x: 18, y: 18 },
  { x: 28, y: 23 },
];
export const NOTICE_BOARD: TilePoint = { x: 27, y: 17 };
/** Lamp posts at the square's corners and along the main street. */
export const LAMP_POSTS: ReadonlyArray<TilePoint> = [
  { x: 16, y: 16 },
  { x: 30, y: 16 },
  { x: 16, y: 25 },
  { x: 30, y: 25 },
  { x: 21, y: 26 },
  { x: 25, y: 29 },
  { x: 21, y: 36 },
];
/** The sheltered bench, and the bench by the other well. */
export const SQUARE_BENCHES: ReadonlyArray<TilePoint> = [
  { x: 19, y: 24 },
  { x: 27, y: 21 },
];

// ── The farm ──────────────────────────────────────────────────────────────────

/** The paddock, fence line included. */
export const PASTURE: TileRect = { x: 42, y: 3, w: 13, h: 10 };
/** The gap in the pasture fence, facing the barn's open side. */
export const PASTURE_FENCE_GATES: ReadonlyArray<TilePoint> = [{ x: 42, y: 6 }];
export const CROP_FIELDS: ReadonlyArray<TileRect> = [
  { x: 47, y: 15, w: 8, h: 3 },
  { x: 47, y: 20, w: 8, h: 3 },
];
/** The farmhouse's kitchen garden; the column in line with its door stays a path. */
export const KITCHEN_GARDEN: TileRect = { x: 23, y: 9, w: 7, h: 3 };
export const KITCHEN_GARDEN_PATH_X = 26;
export const FARM_PROPS: ReadonlyArray<PropTemplate> = [
  { prop: 'mushroom_log_bed', x: 48, y: 18 },
  { prop: 'scarecrow', x: 51, y: 16 },
  { prop: 'water_trough', x: 46, y: 9 },
  { prop: 'hay_bale', x: 52, y: 5 },
];

// ── The lumber yard ───────────────────────────────────────────────────────────

/**
 * The yard, from the grove's first row down to the lane. It starts a row below
 * the walkway along the north wall because the north-west chamfer's inner step
 * sits at (2, 2), and a district never holds a palisade tile.
 */
export const LUMBER_YARD: TileRect = { x: 2, y: 3, w: 19, h: 10 };
/**
 * The managed grove: loose rows, an orchard rather than a wild wood, every tree
 * with open ground beside it so it can be felled from a walkable tile.
 */
export const GROVE_TREES: ReadonlyArray<TilePoint> = [
  { x: 4, y: 3 },
  { x: 6, y: 3 },
  { x: 8, y: 3 },
  { x: 10, y: 3 },
  { x: 12, y: 3 },
  { x: 14, y: 3 },
  { x: 16, y: 3 },
  { x: 18, y: 3 },
  { x: 20, y: 3 },
  { x: 3, y: 6 },
  { x: 5, y: 6 },
  { x: 4, y: 8 },
  { x: 6, y: 8 },
  { x: 3, y: 10 },
  { x: 5, y: 10 },
];
export const LUMBER_YARD_PROPS: ReadonlyArray<PropTemplate> = [
  { prop: 'log_pile', x: 2, y: 12 },
  { prop: 'log_pile', x: 5, y: 12 },
  { prop: 'log_pile', x: 19, y: 5 },
  { prop: 'board_stack', x: 20, y: 8 },
  { prop: 'board_stack', x: 20, y: 10 },
  { prop: 'chopping_block', x: 8, y: 5 },
];
export const LUMBER_YARD_DECALS: ReadonlyArray<PropTemplate> = [
  { prop: 'sawdust', x: 11, y: 5 },
  { prop: 'sawdust', x: 14, y: 6 },
  { prop: 'sawdust', x: 16, y: 5 },
  { prop: 'sawdust', x: 7, y: 6 },
];

// ── Everywhere else inside the walls ──────────────────────────────────────────

/**
 * Clutter: crates, barrels and sacks against walls. Which of the three stands at
 * each spot is seeded dressing; the spot is not.
 */
export const CLUTTER_SPOTS: ReadonlyArray<TilePoint> = [
  { x: 12, y: 26 },
  { x: 20, y: 26 },
  { x: 32, y: 21 },
  { x: 52, y: 26 },
  { x: 54, y: 30 },
];

/** Tables out front of the cookhouse. */
export const COOKHOUSE_TABLES: ReadonlyArray<PropTemplate> = [
  { prop: 'table', x: 12, y: 36 },
  { prop: 'table', x: 18, y: 36 },
];
export const MISC_PROPS: ReadonlyArray<PropTemplate> = [{ prop: 'half_built_cart', x: 11, y: 37 }];
export const MISC_DECALS: ReadonlyArray<PropTemplate> = [
  { prop: 'soot', x: 5, y: 22 },
  { prop: 'soot', x: 7, y: 22 },
  { prop: 'straw', x: 41, y: 5 },
  { prop: 'straw', x: 41, y: 7 },
  // A child's wooden cart left in the lane behind the homes.
  { prop: 'toy', x: 40, y: 37 },
  // Leaves blown out of the grove.
  { prop: 'leaves', x: 7, y: 12 },
  { prop: 'leaves', x: 15, y: 13 },
  { prop: 'leaves', x: 20, y: 6 },
  // Bare earth where feet turn in at a door, off the planned paths.
  { prop: 'path_wear', x: 10, y: 26 },
  { prop: 'path_wear', x: 4, y: 22 },
  { prop: 'path_wear', x: 42, y: 27 },
  { prop: 'path_wear', x: 40, y: 34 },
  { prop: 'path_wear', x: 51, y: 31 },
  { prop: 'path_wear', x: 6, y: 31 },
  { prop: 'path_wear', x: 15, y: 35 },
  { prop: 'path_wear', x: 16, y: 35 },
];

// ── Outside the walls ─────────────────────────────────────────────────────────

/** The quarry, south-east of the palisade on the ruins side. */
export const QUARRY: TileRect = { x: 44, y: 42, w: 14, h: 10 };
/** Minable outcrops, in clusters of one to three, each with open ground on two sides. */
export const QUARRY_DEPOSITS: ReadonlyArray<TilePoint> = [
  { x: 46, y: 44 },
  { x: 47, y: 44 },
  { x: 45, y: 48 },
  { x: 45, y: 49 },
  { x: 46, y: 49 },
  { x: 49, y: 49 },
  { x: 50, y: 49 },
  { x: 53, y: 49 },
  { x: 54, y: 49 },
  { x: 54, y: 50 },
  { x: 48, y: 46 },
];
export const QUARRY_PROPS: ReadonlyArray<PropTemplate> = [
  { prop: 'stone_pile', x: 44, y: 43 },
  { prop: 'stone_pile', x: 51, y: 51 },
  { prop: 'broken_cart', x: 47, y: 51 },
];
/** Half-buried ruined wall stubs along the quarry's ruins side. */
export const QUARRY_WALL_STUBS: ReadonlyArray<TilePoint> = [
  { x: 57, y: 44 },
  { x: 57, y: 45 },
  { x: 57, y: 49 },
  { x: 56, y: 50 },
];

/** The necromancer's ruins: a reserved disc east-south-east of the palisade, beyond the quarry. */
export const RUINS_CENTRE: TilePoint = { x: 70, y: 46 };
export const RUINS_RADIUS_TILES = 8;
/** Half-width of the clear patch at the ruins' centre that the necromancer arrives on. */
export const RUINS_CLEAR_HALF_TILES = 2;
/** Chebyshev radius of the broken ring of wall around that patch. */
export const RUINS_WALL_RING_TILES = 5;
/** Every how-many tiles of the ruin ring a gap is broken through. */
export const RUINS_WALL_GAP_PERIOD = 3;

/** The south road: from the gate outside, south past the quarry turn, twenty tiles beyond the gate. */
export const SOUTH_ROAD: TileRect = { x: GATE_X0, y: 40, w: GATE_WIDTH_TILES, h: 23 };
/** The spur east from the south road into the quarry. */
export const QUARRY_SPUR: TileRect = { x: 25, y: 46, w: 19, h: 2 };
/** Where the road to town leaves the south road: just west of it, below the gate. */
export const TOWN_ROAD_START: TilePoint = { x: GATE_X0 - 1, y: 52 };

/** How far beyond the gate's outside tile the south assault lane's spawn stands. */
export const SOUTH_LANE_SPAWN_DISTANCE_TILES = 20;
/** The east lane approaches the palisade here, three tiles off its east wall. */
export const EAST_LANE_APPROACH: TilePoint = { x: 60, y: 20 };

// ── Districts ─────────────────────────────────────────────────────────────────

export type VillageDistrictId =
  'square' | 'farm' | 'pasture' | 'lumber_yard' | 'workshops' | 'homes' | 'quarry' | 'ruins';

export interface DistrictTemplate {
  readonly id: VillageDistrictId;
  /** Minimap label, or `null` for a district that is a HUD zone only. */
  readonly label: string | null;
  readonly rect: TileRect;
}

/**
 * Districts, most specific first: `briarHollowDistrictAt` returns the first one
 * that contains a tile. A district may appear twice when it is two places (the
 * homes are in the south-east and in the south-west).
 */
export const DISTRICTS: ReadonlyArray<DistrictTemplate> = [
  { id: 'square', label: 'Briar Hollow', rect: SQUARE },
  { id: 'pasture', label: null, rect: PASTURE },
  { id: 'lumber_yard', label: 'Lumber Yard', rect: LUMBER_YARD },
  { id: 'farm', label: 'Farm', rect: { x: 22, y: 1, w: 20, h: 12 } },
  { id: 'farm', label: null, rect: { x: 46, y: 15, w: 10, h: 9 } },
  { id: 'workshops', label: null, rect: { x: 1, y: 15, w: 11, h: 16 } },
  { id: 'workshops', label: null, rect: { x: 33, y: 24, w: 19, h: 8 } },
  { id: 'homes', label: null, rect: { x: 33, y: 32, w: 22, h: 6 } },
  { id: 'homes', label: null, rect: { x: 3, y: 31, w: 8, h: 7 } },
  { id: 'quarry', label: 'Quarry', rect: QUARRY },
  {
    id: 'ruins',
    label: 'The Blue-Lit Ruins',
    rect: {
      x: RUINS_CENTRE.x - RUINS_RADIUS_TILES,
      y: RUINS_CENTRE.y - RUINS_RADIUS_TILES,
      w: RUINS_RADIUS_TILES * 2 + 1,
      h: RUINS_RADIUS_TILES * 2 + 1,
    },
  },
];

// ── Villager anchors ──────────────────────────────────────────────────────────

/**
 * The kinds of place a villager can be sent to: a work post, a stroll target,
 * or a shelter. Work posts come from the buildings' occupant anchors; the rest
 * are listed in `OPEN_AIR_ANCHORS`.
 */
export type VillagerAnchorKind =
  | VillageBuildingId
  | 'square'
  | 'well'
  | 'bench'
  | 'notice_board'
  | 'bell'
  | 'cookhouse_tables'
  | 'kitchen_garden'
  | 'crop_fields'
  | 'pasture_fence'
  | 'lumber_yard'
  | 'quarry'
  | 'gate'
  | 'homes'
  | 'hall_shelter';

/**
 * Where civilians without a home of their own shelter during the assault: the
 * hall's open floor along its south wall, clear of the meeting table and of
 * the doorway's inner tiles. Site coordinates.
 */
export const HALL_SHELTER_SPOTS: ReadonlyArray<TilePoint> = [
  { x: 36, y: 21 },
  { x: 37, y: 21 },
  { x: 43, y: 21 },
];

/** Open-air anchors, in site coordinates. Each is a walkable tile. */
export const OPEN_AIR_ANCHORS: Readonly<
  Record<Exclude<VillagerAnchorKind, VillageBuildingId | 'homes' | 'hall_shelter'>, TilePoint[]>
> = {
  square: [
    { x: 20, y: 19 },
    { x: 26, y: 19 },
    { x: 21, y: 23 },
    { x: 25, y: 23 },
  ],
  well: [
    { x: 18, y: 19 },
    { x: 28, y: 22 },
  ],
  bench: [
    { x: 19, y: 23 },
    { x: 27, y: 20 },
  ],
  notice_board: [{ x: 27, y: 18 }],
  bell: [{ x: 22, y: 21 }],
  cookhouse_tables: [
    { x: 14, y: 36 },
    { x: 17, y: 37 },
  ],
  kitchen_garden: [
    { x: 26, y: 10 },
    { x: 24, y: 12 },
  ],
  crop_fields: [
    { x: 50, y: 18 },
    { x: 53, y: 19 },
  ],
  pasture_fence: [
    { x: 41, y: 8 },
    { x: 48, y: 13 },
  ],
  lumber_yard: [
    { x: 9, y: 5 },
    { x: 12, y: 4 },
  ],
  quarry: [
    { x: 48, y: 44 },
    { x: 51, y: 48 },
  ],
  gate: [
    { x: 21, y: 37 },
    { x: 25, y: 38 },
  ],
};
