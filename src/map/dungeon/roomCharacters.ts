/**
 * Room characters: what kind of place each room and hallway of floors 1 and 2
 * is, as pure data.
 *
 * A character bundles everything that makes a room read as a wine cellar or a
 * boiler room rather than a rectangle: its floor material, an optional floor
 * feature, the dressing baked onto its wall faces, the props it is furnished
 * with, how it is lit, and what it sounds like. The generator picks one per
 * populated room and hallway segment from the weighted tables here
 * (`rollRoomCharacter` and `rollHallwayCharacter` in `regionCharacters.ts`),
 * and every consumer — prop placement, floor painting, wall painting,
 * lighting, ambience — reads the same record without knowing about the others.
 *
 * Every id is a string-literal union, so a table that names a prop family,
 * feature or sound that does not exist is a compile error rather than a room
 * that silently comes out bare. Several ids name things not built yet (new
 * props, sconces); they are declared here so the tables can describe the
 * finished room, and each consumer maps what it cannot draw yet to a stand-in
 * or skips it — see `propFamilyTileType` and `lightSourceTileType` in
 * `roomDressing.ts`. A floor material is drawn as named: the painters read it
 * through `FloorSurface` (`floorSurface.ts`).
 */

import type { DungeonFloorThemeId } from './floorTheme';
import type { Floor1Material } from './floor1Materials';
import type { Floor2Material } from './floor2Materials';
import type { Zone } from '../regionMap';

/** An inclusive whole-number range, rolled once per use. */
export interface CountRange {
  readonly min: number;
  readonly max: number;
}

// ── Floors ──────────────────────────────────────────────────────────────────

/** A walkable material a character's floor may be laid in; never a wall material. */
export type CharacterFloorMaterial =
  Exclude<Floor1Material, 'f1_wall'> | Exclude<Floor2Material, 'f2_wall'>;

/**
 * A large, quiet decal a room may carry one of. All are walkable; they
 * dress the floor and never change what a tile does.
 */
export type FloorFeatureId =
  | 'drain_stain'
  | 'mosaic_ring'
  | 'worn_rug'
  | 'hazard_stripes'
  | 'trapdoor'
  | 'wine_spill'
  | 'oil_spill'
  | 'scorch_mark'
  | 'puddle'
  | 'straw_bed'
  | 'gutter'
  | 'walk_line';

// ── Walls ───────────────────────────────────────────────────────────────────

/** Which static dressing is baked onto a region's wall faces. */
export type WallDressingId =
  | 'cellar_plain'
  | 'cellar_casks'
  | 'cellar_skull_niches'
  | 'cellar_damp_moss'
  | 'cellar_cracked_roots'
  | 'cellar_banners'
  | 'cellar_shackles'
  | 'cellar_cage_fronts'
  | 'cellar_cobwebs'
  | 'service_plain'
  | 'service_pipe_runs'
  | 'service_breaker_panels'
  | 'service_lockers'
  | 'service_water_stains'
  | 'service_filing'
  | 'service_notice_board'
  | 'service_monitors'
  | 'service_conduit';

// ── Props ───────────────────────────────────────────────────────────────────

/**
 * Every prop family a character can be furnished with, built or not.
 *
 * Which tile each family is placed as — its own, or a stand-in until its own
 * tile type exists — is decided in one table, `PROP_FAMILY_STAND_INS` in
 * `roomDressing.ts`, so this list never goes stale as families are painted.
 */
export type PropFamilyId =
  | 'barrel'
  | 'barrel_side'
  | 'crate'
  | 'bookshelf'
  | 'bone_scatter'
  | 'bone_pile'
  | 'slumped_skeleton'
  | 'clay_urn'
  | 'grain_sack'
  | 'rope_coil'
  | 'cask_cradle'
  | 'bottle_rack'
  | 'table_stools'
  | 'weapon_rack'
  | 'rubble_pile'
  | 'rubble_slope'
  | 'fallen_beam'
  | 'rotting_crate'
  | 'sarcophagus'
  | 'straw_scatter'
  | 'water_trough'
  | 'glow_fungus'
  | 'steel_shelving'
  | 'supply_boxes'
  | 'steel_drum'
  | 'gas_cylinder'
  | 'locker_bank'
  | 'bench'
  | 'dropped_towel'
  | 'filing_cabinet'
  | 'desk_monitor'
  | 'paper_drift'
  | 'mop_bucket'
  | 'pallet_stack'
  | 'vending_machine'
  | 'round_table'
  | 'boiler'
  | 'pump_housing'
  | 'cable_bundle';

/** The tiles one piece of a family covers, across by down, when it stands against a north face. */
export interface PropFootprint {
  readonly w: number;
  readonly h: number;
}

/** What a family is, independent of any one room. */
export interface PropFamily {
  readonly footprint: PropFootprint;
  /** Whether it stops movement. A blocking family counts against a room's coverage cap. */
  readonly blocks: boolean;
}

const ONE_TILE: PropFootprint = { w: 1, h: 1 };
const TWO_ACROSS: PropFootprint = { w: 2, h: 1 };
const TWO_BY_TWO: PropFootprint = { w: 2, h: 2 };

export const PROP_FAMILIES = {
  barrel: { footprint: ONE_TILE, blocks: true },
  barrel_side: { footprint: ONE_TILE, blocks: true },
  crate: { footprint: ONE_TILE, blocks: true },
  bookshelf: { footprint: ONE_TILE, blocks: true },
  bone_scatter: { footprint: ONE_TILE, blocks: false },
  bone_pile: { footprint: ONE_TILE, blocks: true },
  slumped_skeleton: { footprint: ONE_TILE, blocks: true },
  clay_urn: { footprint: ONE_TILE, blocks: true },
  grain_sack: { footprint: ONE_TILE, blocks: true },
  rope_coil: { footprint: ONE_TILE, blocks: false },
  cask_cradle: { footprint: TWO_ACROSS, blocks: true },
  bottle_rack: { footprint: ONE_TILE, blocks: true },
  table_stools: { footprint: TWO_ACROSS, blocks: true },
  weapon_rack: { footprint: ONE_TILE, blocks: true },
  rubble_pile: { footprint: ONE_TILE, blocks: true },
  rubble_slope: { footprint: TWO_ACROSS, blocks: true },
  fallen_beam: { footprint: TWO_ACROSS, blocks: true },
  rotting_crate: { footprint: ONE_TILE, blocks: true },
  sarcophagus: { footprint: TWO_ACROSS, blocks: true },
  straw_scatter: { footprint: ONE_TILE, blocks: false },
  water_trough: { footprint: TWO_ACROSS, blocks: true },
  glow_fungus: { footprint: ONE_TILE, blocks: false },
  steel_shelving: { footprint: TWO_ACROSS, blocks: true },
  supply_boxes: { footprint: ONE_TILE, blocks: true },
  steel_drum: { footprint: ONE_TILE, blocks: true },
  gas_cylinder: { footprint: ONE_TILE, blocks: true },
  locker_bank: { footprint: ONE_TILE, blocks: true },
  bench: { footprint: TWO_ACROSS, blocks: true },
  dropped_towel: { footprint: ONE_TILE, blocks: false },
  filing_cabinet: { footprint: ONE_TILE, blocks: true },
  desk_monitor: { footprint: TWO_ACROSS, blocks: true },
  paper_drift: { footprint: ONE_TILE, blocks: false },
  mop_bucket: { footprint: ONE_TILE, blocks: true },
  pallet_stack: { footprint: ONE_TILE, blocks: true },
  vending_machine: { footprint: ONE_TILE, blocks: true },
  round_table: { footprint: ONE_TILE, blocks: true },
  boiler: { footprint: TWO_BY_TWO, blocks: true },
  pump_housing: { footprint: ONE_TILE, blocks: true },
  cable_bundle: { footprint: ONE_TILE, blocks: false },
} as const satisfies Record<PropFamilyId, PropFamily>;

/**
 * Where in a room a family's pieces go. Every hint keeps to the band along
 * the walls; the middle of a room stays open for combat.
 *
 * - `north-face`: in a row against the north wall, the face the camera sees.
 * - `wall`: against any wall, pieces side by side along it.
 * - `corner`: packed into one corner.
 * - `cluster`: a clump grown from a wall tile, one step deep at most.
 * - `scatter`: loose, one piece at a time, anywhere in the wall band. Walkable
 *   families only.
 */
export type PropPlacement = 'north-face' | 'wall' | 'corner' | 'cluster' | 'scatter';

/** One family in a character's furnishings. */
export interface PropSetEntry {
  readonly family: PropFamilyId;
  /** Relative priority: heavier families tend to be placed first and so win space under the coverage cap. */
  readonly weight: number;
  readonly count: CountRange;
  readonly placement: PropPlacement;
}

/**
 * The fixed arrangements a character may stamp against one of its walls, in
 * place of or alongside its loose families. Each is drawn in
 * `DRESSING_STAMPS` in `roomDressing.ts`.
 */
export type DressingStampId =
  | 'watch_brazier'
  | 'barrel_crate_rows'
  | 'torch_barrel_crate_row'
  | 'barrel_row'
  | 'barrel_bone_field'
  | 'barrel_corners'
  | 'barrel_crate_corner'
  | 'bone_shrine'
  | 'bone_crate_wall'
  | 'crate_heap'
  | 'shelf_brazier'
  | 'bone_barrel_altar';

export interface StampChoice {
  readonly id: DressingStampId;
  readonly weight: number;
}

// ── Light ───────────────────────────────────────────────────────────────────

/** How dark a region is before any of its lights are counted. */
export type AmbientLevel = 'lit' | 'dim' | 'dark';

export type LightSourceKind =
  | 'wall_sconce'
  | 'standing_torch'
  | 'brazier'
  | 'candle_cluster'
  | 'fluorescent_tube'
  | 'sodium_lamp'
  | 'emergency_light'
  | 'glow_fungus'
  | 'vending_glow'
  | 'monitor_glow'
  | 'boiler_window'
  | 'desk_lamp';

/**
 * Where a light source sits. `ceiling` lights hang over the room rather than
 * standing in it; `on-prop` lights are emitted by one of the room's props (a
 * vending machine, a boiler window) and are placed with that prop.
 */
export type LightPlacement = 'north-face' | 'wall' | 'corner' | 'cluster' | 'ceiling' | 'on-prop';

/** The tint a region's lights share. */
export type LightColour =
  'warm' | 'tallow' | 'cool_warm' | 'cool_white' | 'sodium' | 'cold' | 'monitor' | 'emergency_red';

/** How many of a source a region gets: a fixed count, or one every so many tiles of run. */
export type LightAmount = { readonly count: CountRange } | { readonly everyTiles: CountRange };

export interface LightSourceSpec {
  readonly kind: LightSourceKind;
  readonly placement: LightPlacement;
  readonly amount: LightAmount;
}

export interface LightingProfile {
  readonly ambient: AmbientLevel;
  readonly colour: LightColour;
  readonly sources: ReadonlyArray<LightSourceSpec>;
}

/**
 * Regions that keep their own dressing and take no character, only a
 * lighting profile of their own.
 */
export type SpecialRegionTag = 'start' | 'safe' | 'boss' | 'quest' | 'spider_lab' | 'arena';

const FIXED_ONE: CountRange = { min: 1, max: 1 };
const FIXED_TWO: CountRange = { min: 2, max: 2 };

/**
 * The lighting of each special region. The spider lab is null: its own
 * darkness mask already lights it, and a second pass would darken it twice.
 * Boss rooms start fully lit so a tuned fight plays as it was tuned.
 */
export const SPECIAL_REGION_LIGHTING = {
  start: {
    ambient: 'lit',
    colour: 'warm',
    sources: [{ kind: 'standing_torch', placement: 'corner', amount: { count: FIXED_TWO } }],
  },
  safe: { ambient: 'lit', colour: 'warm', sources: [] },
  boss: { ambient: 'lit', colour: 'warm', sources: [] },
  // The nursery is fully lit under its sconces' warm pools: that look is the
  // reference every other room's lighting is tuned against.
  quest: {
    ambient: 'lit',
    colour: 'warm',
    sources: [{ kind: 'wall_sconce', placement: 'north-face', amount: { count: FIXED_TWO } }],
  },
  spider_lab: null,
  arena: { ambient: 'lit', colour: 'cool_white', sources: [] },
} as const satisfies Record<SpecialRegionTag, LightingProfile | null>;

// ── Sound ───────────────────────────────────────────────────────────────────

/** A looping bed; a character's own bed plays over its floor's. */
export type AmbienceBedId = 'cellar_bed' | 'service_level_bed' | 'flooded_room' | 'boiler_room';

/** A quiet one-shot the ambience scheduler may play while the player is in the region. */
export type AmbientOneShotId =
  'water_drip' | 'pipe_knock' | 'stone_settle' | 'distant_growl' | 'fluorescent_flicker';

export interface AmbienceSpec {
  /** Null when the region plays only its floor's bed. */
  readonly bed: AmbienceBedId | null;
  readonly oneShots: ReadonlyArray<AmbientOneShotId>;
}

/** The bed under everything on each floor. */
export const FLOOR_AMBIENCE_BED = {
  cellars: 'cellar_bed',
  service_level: 'service_level_bed',
} as const satisfies Record<DungeonFloorThemeId, AmbienceBedId>;

// ── Characters ──────────────────────────────────────────────────────────────

export const FLOOR1_ROOM_CHARACTER_IDS = [
  'wine_cellar',
  'storeroom',
  'ossuary',
  'flooded_cellar',
  'collapsed_hall',
  'crypt_chapel',
  'guard_post',
  'kennels',
] as const;
export const FLOOR2_ROOM_CHARACTER_IDS = [
  'maintenance_store',
  'boiler_room',
  'electrical',
  'locker_room',
  'flooded_pump_room',
  'records_office',
  'break_room',
  'security_nook',
] as const;
export const FLOOR1_HALLWAY_CHARACTER_IDS = [
  'cellar_passage',
  'drain_passage',
  'bone_passage',
] as const;
export const FLOOR2_HALLWAY_CHARACTER_IDS = [
  'service_corridor',
  'pipe_corridor',
  'storage_corridor',
] as const;

export type RoomCharacterId =
  (typeof FLOOR1_ROOM_CHARACTER_IDS)[number] | (typeof FLOOR2_ROOM_CHARACTER_IDS)[number];
export type HallwayCharacterId =
  (typeof FLOOR1_HALLWAY_CHARACTER_IDS)[number] | (typeof FLOOR2_HALLWAY_CHARACTER_IDS)[number];
export type CharacterId = RoomCharacterId | HallwayCharacterId;

/** What a populated room is. */
export interface RoomCharacter {
  readonly kind: 'room';
  readonly id: RoomCharacterId;
  readonly floor: DungeonFloorThemeId;
  /** Zones a room must lie in to be given this character. */
  readonly zones: ReadonlyArray<Zone>;
  /** Relative chance among the characters eligible for a room. */
  readonly weight: number;
  readonly floorMaterial: CharacterFloorMaterial;
  readonly floorFeature: FloorFeatureId | null;
  readonly wallDressing: WallDressingId;
  readonly props: ReadonlyArray<PropSetEntry>;
  readonly stamps: ReadonlyArray<StampChoice>;
  /** Chance one of {@link stamps} is set against a wall, before the loose families. */
  readonly stampChance: number;
  readonly lighting: LightingProfile;
  readonly ambience: AmbienceSpec;
}

/**
 * What a hallway segment is. Lighter than a room: its lights are spaced along
 * its run, its scatter is walkable, and a blocking prop may stand only in a
 * nook's alcove, never in the walking lane.
 */
export interface HallwayCharacter {
  readonly kind: 'hallway';
  readonly id: HallwayCharacterId;
  readonly floor: DungeonFloorThemeId;
  readonly zones: ReadonlyArray<Zone>;
  readonly weight: number;
  readonly floorMaterial: CharacterFloorMaterial;
  readonly floorFeature: FloorFeatureId | null;
  readonly wallDressing: WallDressingId;
  /** Walkable families strewn where corridors meet. */
  readonly junctionScatter: ReadonlyArray<PropSetEntry>;
  /** Blocking families a nook's alcove may hold. */
  readonly nookProps: ReadonlyArray<PropSetEntry>;
  readonly lighting: LightingProfile;
  readonly ambience: AmbienceSpec;
}

export type RegionCharacter = RoomCharacter | HallwayCharacter;

const ALL_ZONES: ReadonlyArray<Zone> = ['entrance', 'mid', 'deep'];
const MID_AND_DEEP: ReadonlyArray<Zone> = ['mid', 'deep'];
const DEEP_ONLY: ReadonlyArray<Zone> = ['deep'];

const ONE: CountRange = FIXED_ONE;
const TWO: CountRange = FIXED_TWO;
const ONE_OR_TWO: CountRange = { min: 1, max: 2 };
const TWO_OR_THREE: CountRange = { min: 2, max: 3 };
const TWO_TO_FOUR: CountRange = { min: 2, max: 4 };
const THREE_TO_FIVE: CountRange = { min: 3, max: 5 };
const UP_TO_ONE: CountRange = { min: 0, max: 1 };
const UP_TO_TWO: CountRange = { min: 0, max: 2 };

/** Hallway sconces and emergency lights are spaced by run length, not counted. */
const SCONCE_SPACING: CountRange = { min: 10, max: 14 };
const EMERGENCY_LIGHT_SPACING: CountRange = { min: 12, max: 12 };
const SODIUM_LAMP_SPACING: CountRange = { min: 14, max: 18 };

const CELLAR_ONE_SHOTS: ReadonlyArray<AmbientOneShotId> = [
  'water_drip',
  'stone_settle',
  'distant_growl',
];
const SERVICE_ONE_SHOTS: ReadonlyArray<AmbientOneShotId> = [
  'pipe_knock',
  'water_drip',
  'distant_growl',
];

/** Floor 1, the cellars: warm, old stone, tallow light and damp. */
export const FLOOR1_ROOM_CHARACTERS = [
  {
    kind: 'room',
    id: 'wine_cellar',
    floor: 'cellars',
    zones: ALL_ZONES,
    weight: 10,
    floorMaterial: 'f1_flagstone',
    floorFeature: 'wine_spill',
    wallDressing: 'cellar_casks',
    props: [
      { family: 'cask_cradle', weight: 5, count: TWO_OR_THREE, placement: 'north-face' },
      { family: 'bottle_rack', weight: 3, count: ONE_OR_TWO, placement: 'north-face' },
      { family: 'barrel', weight: 2, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [
      { id: 'barrel_crate_rows', weight: 2 },
      { id: 'barrel_row', weight: 1 },
    ],
    stampChance: 0.2,
    lighting: {
      ambient: 'dim',
      colour: 'warm',
      sources: [{ kind: 'wall_sconce', placement: 'north-face', amount: { count: TWO } }],
    },
    ambience: { bed: null, oneShots: CELLAR_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'storeroom',
    floor: 'cellars',
    zones: ALL_ZONES,
    weight: 12,
    floorMaterial: 'f1_timber',
    floorFeature: 'worn_rug',
    wallDressing: 'cellar_plain',
    props: [
      { family: 'crate', weight: 5, count: TWO_TO_FOUR, placement: 'cluster' },
      { family: 'grain_sack', weight: 3, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'clay_urn', weight: 2, count: UP_TO_TWO, placement: 'corner' },
      { family: 'barrel', weight: 4, count: TWO_OR_THREE, placement: 'wall' },
      { family: 'rope_coil', weight: 1, count: UP_TO_ONE, placement: 'scatter' },
    ],
    stamps: [
      { id: 'barrel_crate_rows', weight: 3 },
      { id: 'barrel_crate_corner', weight: 3 },
      { id: 'torch_barrel_crate_row', weight: 2 },
      { id: 'barrel_row', weight: 2 },
      { id: 'barrel_corners', weight: 1 },
    ],
    stampChance: 0.35,
    lighting: {
      ambient: 'dim',
      colour: 'warm',
      sources: [{ kind: 'standing_torch', placement: 'corner', amount: { count: ONE } }],
    },
    ambience: { bed: null, oneShots: CELLAR_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'ossuary',
    floor: 'cellars',
    zones: MID_AND_DEEP,
    weight: 8,
    floorMaterial: 'f1_flags',
    floorFeature: 'trapdoor',
    wallDressing: 'cellar_skull_niches',
    props: [
      // Remains are capped per room by the placer, so the urns carry the rest
      // of the room's furnishing.
      { family: 'bone_pile', weight: 4, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'slumped_skeleton', weight: 3, count: UP_TO_ONE, placement: 'north-face' },
      { family: 'clay_urn', weight: 2, count: TWO_TO_FOUR, placement: 'corner' },
      { family: 'bone_scatter', weight: 1, count: UP_TO_TWO, placement: 'scatter' },
    ],
    stamps: [
      { id: 'barrel_bone_field', weight: 2 },
      { id: 'bone_shrine', weight: 2 },
      { id: 'bone_barrel_altar', weight: 1 },
    ],
    stampChance: 0.3,
    lighting: {
      ambient: 'dark',
      colour: 'tallow',
      sources: [{ kind: 'candle_cluster', placement: 'cluster', amount: { count: TWO_OR_THREE } }],
    },
    ambience: { bed: null, oneShots: CELLAR_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'flooded_cellar',
    floor: 'cellars',
    zones: MID_AND_DEEP,
    weight: 6,
    floorMaterial: 'f1_flagstone',
    floorFeature: 'puddle',
    wallDressing: 'cellar_damp_moss',
    props: [
      { family: 'rotting_crate', weight: 4, count: TWO_OR_THREE, placement: 'cluster' },
      { family: 'glow_fungus', weight: 2, count: UP_TO_TWO, placement: 'scatter' },
      { family: 'barrel_side', weight: 2, count: UP_TO_ONE, placement: 'wall' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'dark',
      colour: 'warm',
      sources: [
        { kind: 'wall_sconce', placement: 'north-face', amount: { count: ONE } },
        { kind: 'glow_fungus', placement: 'on-prop', amount: { count: UP_TO_TWO } },
      ],
    },
    ambience: { bed: 'flooded_room', oneShots: ['water_drip', 'stone_settle'] },
  },
  {
    kind: 'room',
    id: 'collapsed_hall',
    floor: 'cellars',
    zones: MID_AND_DEEP,
    weight: 6,
    floorMaterial: 'f1_cinder',
    floorFeature: null,
    wallDressing: 'cellar_cracked_roots',
    props: [
      { family: 'rubble_slope', weight: 6, count: ONE, placement: 'corner' },
      { family: 'rubble_pile', weight: 5, count: TWO_TO_FOUR, placement: 'corner' },
      { family: 'fallen_beam', weight: 3, count: ONE, placement: 'wall' },
      { family: 'rotting_crate', weight: 2, count: ONE_OR_TWO, placement: 'cluster' },
      { family: 'bone_scatter', weight: 1, count: UP_TO_TWO, placement: 'scatter' },
    ],
    stamps: [{ id: 'crate_heap', weight: 1 }],
    stampChance: 0.25,
    // No static light of its own: what reaches it spills in from the doorways.
    lighting: { ambient: 'dark', colour: 'warm', sources: [] },
    ambience: { bed: null, oneShots: ['stone_settle', 'distant_growl'] },
  },
  {
    kind: 'room',
    id: 'crypt_chapel',
    floor: 'cellars',
    zones: DEEP_ONLY,
    weight: 5,
    floorMaterial: 'f1_herringbone',
    floorFeature: 'mosaic_ring',
    wallDressing: 'cellar_banners',
    props: [
      { family: 'sarcophagus', weight: 5, count: ONE, placement: 'north-face' },
      { family: 'clay_urn', weight: 2, count: UP_TO_TWO, placement: 'corner' },
      { family: 'bookshelf', weight: 2, count: UP_TO_TWO, placement: 'wall' },
      { family: 'bone_scatter', weight: 1, count: UP_TO_TWO, placement: 'scatter' },
    ],
    stamps: [{ id: 'shelf_brazier', weight: 1 }],
    stampChance: 0.3,
    lighting: {
      ambient: 'dim',
      colour: 'cool_warm',
      sources: [{ kind: 'candle_cluster', placement: 'corner', amount: { count: TWO } }],
    },
    ambience: { bed: null, oneShots: ['water_drip', 'distant_growl'] },
  },
  {
    kind: 'room',
    id: 'guard_post',
    floor: 'cellars',
    zones: ALL_ZONES,
    weight: 9,
    floorMaterial: 'f1_flagstone',
    floorFeature: 'scorch_mark',
    wallDressing: 'cellar_shackles',
    props: [
      { family: 'weapon_rack', weight: 4, count: ONE_OR_TWO, placement: 'north-face' },
      { family: 'table_stools', weight: 3, count: ONE, placement: 'wall' },
      { family: 'barrel', weight: 2, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [{ id: 'watch_brazier', weight: 1 }],
    stampChance: 0.25,
    lighting: {
      ambient: 'dim',
      colour: 'warm',
      sources: [{ kind: 'brazier', placement: 'wall', amount: { count: ONE } }],
    },
    ambience: { bed: null, oneShots: CELLAR_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'kennels',
    floor: 'cellars',
    zones: MID_AND_DEEP,
    weight: 6,
    floorMaterial: 'f1_earth',
    floorFeature: 'straw_bed',
    wallDressing: 'cellar_cage_fronts',
    props: [
      { family: 'straw_scatter', weight: 3, count: TWO_TO_FOUR, placement: 'scatter' },
      { family: 'bone_scatter', weight: 3, count: TWO_OR_THREE, placement: 'scatter' },
      // What the kennels' last occupants left of their last meal, heaped in a corner.
      { family: 'bone_pile', weight: 2, count: UP_TO_ONE, placement: 'corner' },
      { family: 'water_trough', weight: 2, count: ONE, placement: 'wall' },
      { family: 'crate', weight: 1, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [{ id: 'bone_crate_wall', weight: 1 }],
    stampChance: 0.25,
    lighting: {
      ambient: 'dark',
      colour: 'warm',
      sources: [{ kind: 'wall_sconce', placement: 'north-face', amount: { count: ONE } }],
    },
    ambience: { bed: null, oneShots: ['distant_growl', 'water_drip'] },
  },
] as const satisfies ReadonlyArray<
  RoomCharacter & { readonly id: (typeof FLOOR1_ROOM_CHARACTER_IDS)[number] }
>;

/** Floor 2, the service level: cold, concrete, steel, fluorescent and sodium light. */
export const FLOOR2_ROOM_CHARACTERS = [
  {
    kind: 'room',
    id: 'maintenance_store',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 12,
    floorMaterial: 'f2_concrete',
    floorFeature: 'oil_spill',
    wallDressing: 'service_plain',
    props: [
      { family: 'steel_shelving', weight: 5, count: ONE_OR_TWO, placement: 'north-face' },
      { family: 'supply_boxes', weight: 4, count: TWO_TO_FOUR, placement: 'cluster' },
      { family: 'mop_bucket', weight: 1, count: UP_TO_ONE, placement: 'wall' },
      { family: 'pallet_stack', weight: 2, count: ONE_OR_TWO, placement: 'corner' },
    ],
    stamps: [
      { id: 'barrel_crate_rows', weight: 2 },
      { id: 'barrel_crate_corner', weight: 2 },
    ],
    stampChance: 0.25,
    lighting: {
      ambient: 'lit',
      colour: 'cool_white',
      sources: [{ kind: 'fluorescent_tube', placement: 'ceiling', amount: { count: TWO } }],
    },
    ambience: { bed: null, oneShots: SERVICE_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'boiler_room',
    floor: 'service_level',
    zones: MID_AND_DEEP,
    weight: 6,
    floorMaterial: 'f2_grating',
    floorFeature: 'hazard_stripes',
    wallDressing: 'service_pipe_runs',
    props: [
      { family: 'boiler', weight: 5, count: ONE, placement: 'north-face' },
      { family: 'steel_drum', weight: 3, count: TWO_OR_THREE, placement: 'cluster' },
      { family: 'gas_cylinder', weight: 1, count: UP_TO_ONE, placement: 'corner' },
    ],
    stamps: [{ id: 'barrel_row', weight: 1 }],
    stampChance: 0.2,
    lighting: {
      ambient: 'dim',
      colour: 'sodium',
      sources: [
        { kind: 'sodium_lamp', placement: 'ceiling', amount: { count: ONE } },
        { kind: 'boiler_window', placement: 'on-prop', amount: { count: ONE } },
        { kind: 'brazier', placement: 'wall', amount: { count: UP_TO_ONE } },
      ],
    },
    ambience: { bed: 'boiler_room', oneShots: ['pipe_knock'] },
  },
  {
    kind: 'room',
    id: 'electrical',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 9,
    floorMaterial: 'f2_vinyl',
    floorFeature: null,
    wallDressing: 'service_breaker_panels',
    props: [
      { family: 'cable_bundle', weight: 4, count: THREE_TO_FIVE, placement: 'scatter' },
      { family: 'supply_boxes', weight: 3, count: TWO_TO_FOUR, placement: 'corner' },
      { family: 'steel_shelving', weight: 2, count: ONE, placement: 'wall' },
      { family: 'pallet_stack', weight: 1, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'steel_drum', weight: 1, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'lit',
      colour: 'cool_white',
      sources: [{ kind: 'fluorescent_tube', placement: 'ceiling', amount: { count: TWO } }],
    },
    ambience: { bed: null, oneShots: ['fluorescent_flicker', 'pipe_knock'] },
  },
  {
    kind: 'room',
    id: 'locker_room',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 8,
    floorMaterial: 'f2_rubber',
    floorFeature: null,
    // Plain block rather than lockers baked into the face: the room's lockers
    // stand along that face as breakable props, and baked ones behind them
    // would draw every locker twice.
    wallDressing: 'service_plain',
    props: [
      { family: 'locker_bank', weight: 5, count: THREE_TO_FIVE, placement: 'north-face' },
      { family: 'bench', weight: 3, count: ONE, placement: 'wall' },
      { family: 'dropped_towel', weight: 1, count: UP_TO_ONE, placement: 'scatter' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'lit',
      colour: 'cool_white',
      sources: [{ kind: 'fluorescent_tube', placement: 'ceiling', amount: { count: TWO } }],
    },
    ambience: { bed: null, oneShots: ['fluorescent_flicker', 'water_drip'] },
  },
  {
    kind: 'room',
    id: 'flooded_pump_room',
    floor: 'service_level',
    zones: MID_AND_DEEP,
    weight: 5,
    floorMaterial: 'f2_concrete',
    floorFeature: 'drain_stain',
    wallDressing: 'service_water_stains',
    props: [
      { family: 'pump_housing', weight: 4, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'steel_drum', weight: 2, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'dark',
      colour: 'cold',
      sources: [{ kind: 'fluorescent_tube', placement: 'ceiling', amount: { count: ONE } }],
    },
    ambience: { bed: 'flooded_room', oneShots: ['water_drip', 'pipe_knock'] },
  },
  {
    kind: 'room',
    id: 'records_office',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 9,
    floorMaterial: 'f2_vinyl',
    floorFeature: null,
    wallDressing: 'service_filing',
    props: [
      { family: 'filing_cabinet', weight: 5, count: TWO_TO_FOUR, placement: 'north-face' },
      { family: 'desk_monitor', weight: 3, count: ONE, placement: 'wall' },
      { family: 'paper_drift', weight: 2, count: TWO_TO_FOUR, placement: 'scatter' },
      { family: 'bookshelf', weight: 2, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'supply_boxes', weight: 1, count: ONE_OR_TWO, placement: 'corner' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'dark',
      colour: 'warm',
      sources: [{ kind: 'desk_lamp', placement: 'on-prop', amount: { count: ONE } }],
    },
    ambience: { bed: null, oneShots: SERVICE_ONE_SHOTS },
  },
  {
    kind: 'room',
    id: 'break_room',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 8,
    floorMaterial: 'f2_vinyl',
    floorFeature: null,
    wallDressing: 'service_notice_board',
    props: [
      { family: 'vending_machine', weight: 5, count: ONE, placement: 'north-face' },
      { family: 'round_table', weight: 3, count: ONE, placement: 'wall' },
      { family: 'supply_boxes', weight: 1, count: UP_TO_ONE, placement: 'corner' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'dim',
      colour: 'cool_white',
      sources: [
        { kind: 'vending_glow', placement: 'on-prop', amount: { count: ONE } },
        { kind: 'fluorescent_tube', placement: 'ceiling', amount: { count: ONE } },
      ],
    },
    ambience: { bed: null, oneShots: ['fluorescent_flicker', 'pipe_knock'] },
  },
  {
    kind: 'room',
    id: 'security_nook',
    floor: 'service_level',
    zones: MID_AND_DEEP,
    weight: 5,
    floorMaterial: 'f2_concrete',
    floorFeature: null,
    wallDressing: 'service_monitors',
    props: [
      { family: 'desk_monitor', weight: 4, count: ONE, placement: 'north-face' },
      { family: 'filing_cabinet', weight: 2, count: UP_TO_TWO, placement: 'corner' },
    ],
    stamps: [],
    stampChance: 0,
    lighting: {
      ambient: 'dark',
      colour: 'monitor',
      sources: [{ kind: 'monitor_glow', placement: 'north-face', amount: { count: ONE } }],
    },
    ambience: { bed: null, oneShots: SERVICE_ONE_SHOTS },
  },
] as const satisfies ReadonlyArray<
  RoomCharacter & { readonly id: (typeof FLOOR2_ROOM_CHARACTER_IDS)[number] }
>;

/** Floor 1's passages: worn flagstone runs, sconces along north faces, cobwebbed corners. */
export const FLOOR1_HALLWAY_CHARACTERS = [
  {
    kind: 'hallway',
    id: 'cellar_passage',
    floor: 'cellars',
    zones: ALL_ZONES,
    weight: 6,
    floorMaterial: 'f1_flagstone',
    floorFeature: null,
    wallDressing: 'cellar_cobwebs',
    junctionScatter: [],
    nookProps: [{ family: 'barrel', weight: 2, count: ONE_OR_TWO, placement: 'corner' }],
    lighting: {
      ambient: 'dim',
      colour: 'warm',
      sources: [
        { kind: 'wall_sconce', placement: 'north-face', amount: { everyTiles: SCONCE_SPACING } },
      ],
    },
    ambience: { bed: null, oneShots: CELLAR_ONE_SHOTS },
  },
  {
    kind: 'hallway',
    id: 'drain_passage',
    floor: 'cellars',
    zones: ALL_ZONES,
    weight: 3,
    floorMaterial: 'f1_flagstone',
    floorFeature: 'gutter',
    wallDressing: 'cellar_damp_moss',
    junctionScatter: [],
    nookProps: [{ family: 'crate', weight: 2, count: ONE_OR_TWO, placement: 'corner' }],
    lighting: {
      ambient: 'dim',
      colour: 'warm',
      sources: [
        { kind: 'wall_sconce', placement: 'north-face', amount: { everyTiles: SCONCE_SPACING } },
      ],
    },
    ambience: { bed: null, oneShots: ['water_drip', 'stone_settle'] },
  },
  {
    kind: 'hallway',
    id: 'bone_passage',
    floor: 'cellars',
    zones: DEEP_ONLY,
    weight: 6,
    floorMaterial: 'f1_flagstone',
    floorFeature: null,
    wallDressing: 'cellar_cobwebs',
    junctionScatter: [
      { family: 'bone_scatter', weight: 1, count: ONE_OR_TWO, placement: 'scatter' },
    ],
    nookProps: [{ family: 'bone_pile', weight: 2, count: ONE, placement: 'corner' }],
    lighting: {
      ambient: 'dark',
      colour: 'warm',
      sources: [
        { kind: 'wall_sconce', placement: 'north-face', amount: { everyTiles: SCONCE_SPACING } },
      ],
    },
    ambience: { bed: null, oneShots: ['distant_growl', 'stone_settle'] },
  },
] as const satisfies ReadonlyArray<
  HallwayCharacter & { readonly id: (typeof FLOOR1_HALLWAY_CHARACTER_IDS)[number] }
>;

/** Floor 2's corridors: sealed concrete, conduit on the faces, emergency lights spaced along the run. */
export const FLOOR2_HALLWAY_CHARACTERS = [
  {
    kind: 'hallway',
    id: 'service_corridor',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 6,
    floorMaterial: 'f2_concrete',
    floorFeature: 'walk_line',
    wallDressing: 'service_conduit',
    junctionScatter: [],
    nookProps: [],
    lighting: {
      ambient: 'dim',
      colour: 'emergency_red',
      sources: [
        {
          kind: 'emergency_light',
          placement: 'north-face',
          amount: { everyTiles: EMERGENCY_LIGHT_SPACING },
        },
      ],
    },
    ambience: { bed: null, oneShots: SERVICE_ONE_SHOTS },
  },
  {
    kind: 'hallway',
    id: 'pipe_corridor',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 4,
    floorMaterial: 'f2_concrete',
    floorFeature: null,
    wallDressing: 'service_pipe_runs',
    junctionScatter: [],
    nookProps: [],
    lighting: {
      ambient: 'dim',
      colour: 'sodium',
      sources: [
        { kind: 'sodium_lamp', placement: 'ceiling', amount: { everyTiles: SODIUM_LAMP_SPACING } },
        {
          kind: 'emergency_light',
          placement: 'north-face',
          amount: { everyTiles: EMERGENCY_LIGHT_SPACING },
        },
      ],
    },
    ambience: { bed: null, oneShots: ['pipe_knock', 'water_drip'] },
  },
  {
    kind: 'hallway',
    id: 'storage_corridor',
    floor: 'service_level',
    zones: ALL_ZONES,
    weight: 3,
    floorMaterial: 'f2_concrete',
    floorFeature: 'walk_line',
    wallDressing: 'service_conduit',
    junctionScatter: [{ family: 'paper_drift', weight: 1, count: UP_TO_ONE, placement: 'scatter' }],
    nookProps: [
      { family: 'pallet_stack', weight: 2, count: ONE, placement: 'corner' },
      { family: 'mop_bucket', weight: 1, count: UP_TO_ONE, placement: 'corner' },
    ],
    lighting: {
      ambient: 'dim',
      colour: 'emergency_red',
      sources: [
        {
          kind: 'emergency_light',
          placement: 'north-face',
          amount: { everyTiles: EMERGENCY_LIGHT_SPACING },
        },
      ],
    },
    ambience: { bed: null, oneShots: SERVICE_ONE_SHOTS },
  },
] as const satisfies ReadonlyArray<
  HallwayCharacter & { readonly id: (typeof FLOOR2_HALLWAY_CHARACTER_IDS)[number] }
>;

/** Each floor's room characters. */
export const ROOM_CHARACTERS_BY_FLOOR = {
  cellars: FLOOR1_ROOM_CHARACTERS,
  service_level: FLOOR2_ROOM_CHARACTERS,
} as const satisfies Record<DungeonFloorThemeId, ReadonlyArray<RoomCharacter>>;

/** Each floor's hallway characters. */
export const HALLWAY_CHARACTERS_BY_FLOOR = {
  cellars: FLOOR1_HALLWAY_CHARACTERS,
  service_level: FLOOR2_HALLWAY_CHARACTERS,
} as const satisfies Record<DungeonFloorThemeId, ReadonlyArray<HallwayCharacter>>;

/**
 * The loose props each special region is furnished with, per floor. Only the
 * start room takes any: a few pieces of the floor's own stores against its
 * walls, so the first room a crawler sees reads as a place rather than an
 * empty box. Every other special room is furnished by its own system (the
 * safe room's lanterns and stove, the nursery, the boss arenas), and props
 * from here would stack on top of theirs.
 */
export const SPECIAL_REGION_PROPS: Record<
  DungeonFloorThemeId,
  Partial<Record<SpecialRegionTag, ReadonlyArray<PropSetEntry>>>
> = {
  cellars: {
    start: [
      { family: 'barrel', weight: 3, count: ONE_OR_TWO, placement: 'corner' },
      { family: 'crate', weight: 3, count: TWO_OR_THREE, placement: 'cluster' },
      { family: 'grain_sack', weight: 2, count: ONE_OR_TWO, placement: 'wall' },
      { family: 'straw_scatter', weight: 1, count: ONE_OR_TWO, placement: 'scatter' },
    ],
  },
  service_level: {
    start: [
      { family: 'supply_boxes', weight: 3, count: TWO_OR_THREE, placement: 'cluster' },
      { family: 'steel_drum', weight: 3, count: ONE_OR_TWO, placement: 'corner' },
      { family: 'pallet_stack', weight: 2, count: ONE, placement: 'wall' },
      { family: 'paper_drift', weight: 1, count: ONE_OR_TWO, placement: 'scatter' },
    ],
  },
};

/** Every character on every floor, for lookups by id. */
export const ALL_REGION_CHARACTERS: ReadonlyArray<RegionCharacter> = [
  ...FLOOR1_ROOM_CHARACTERS,
  ...FLOOR2_ROOM_CHARACTERS,
  ...FLOOR1_HALLWAY_CHARACTERS,
  ...FLOOR2_HALLWAY_CHARACTERS,
];

/** The character an id names, or null for an id no table lists. */
export function regionCharacterById(id: string): RegionCharacter | null {
  return ALL_REGION_CHARACTERS.find((character) => character.id === id) ?? null;
}

/**
 * The share of populated mid- and deep-zone rooms left unlit, one in eight: no static light
 * at all, so what the player sees is what they carry in.
 */
export const UNLIT_ROOM_CHANCE = 0.125;

/** Zones an unlit room may be rolled in; the entrance is always lit so a floor opens readable. */
export const UNLIT_ROOM_ZONES: ReadonlyArray<Zone> = MID_AND_DEEP;
