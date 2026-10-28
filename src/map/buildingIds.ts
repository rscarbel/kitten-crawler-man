/**
 * Every enterable building's stable id, and the name its sign shows.
 *
 * The id is the building's identity everywhere: layouts, occupants, services,
 * music, quests, contracts, dev routes and saved data. It names what the
 * building is and where it stands, never who runs it, so repainting a sign or
 * renaming a character never changes it. The display name is data, read only
 * where text reaches the player.
 */

import type { LevelId } from '../levels/levelIds';

/** The settlements a building or a construction contract can stand in. */
export const TOWN_IDS = ['taloncrest', 'briar_hollow'] as const;
export type TownId = (typeof TOWN_IDS)[number];

/** Where a building stands, which is the prefix of its id: a town, or the dungeon level its door is on. */
type BuildingLocation = TownId | LevelId;

/** Taloncrest's sprite buildings, in the order their plots run, north to south. */
const TALONCREST_PLOT_SLUGS = [
  'garrison_lodge',
  'builder_farm',
  'barracks',
  'crafting_house',
  'temple',
  'apothecary',
  'general_store',
  'inn',
  'flagon_tavern',
  'old_lady_cottage',
  'smithy',
  'pub',
  'tattoo_parlor',
  'nightclub',
  'mill_farm',
] as const;

/**
 * Briar Hollow's buildings, in the order the village lays them out
 * (`BUILDINGS` in `briarHollowLayout.ts`), which is also the order its
 * contract sites are drawn in.
 */
const BRIAR_HOLLOW_SLUGS = [
  'hall',
  'forge',
  'cookhouse',
  'infirmary',
  'store',
  'workshop',
  'sawmill',
  'guardhouse',
  'farmhouse',
  'barn',
  'seamstress_cottage',
  'well_keeper_cottage',
  'carpenter_workshop',
  'lamplighter_cottage',
  'quarry_hut',
] as const;

/** The slugs of every building, per location. A building's id is `<location>_<slug>`. */
const BUILDING_SLUGS = {
  taloncrest: [...TALONCREST_PLOT_SLUGS, 'tower', 'circus_tent'],
  briar_hollow: BRIAR_HOLLOW_SLUGS,
  level2: ['goblin_prison'],
} as const satisfies Partial<Record<BuildingLocation, readonly string[]>>;

type BuildingSlugs = typeof BUILDING_SLUGS;

/** The ids of the buildings at one location. */
type BuildingIdAt<L extends keyof BuildingSlugs> = `${L}_${BuildingSlugs[L][number]}`;

export type BuildingId = { [L in keyof BuildingSlugs]: BuildingIdAt<L> }[keyof BuildingSlugs];

/** Briar Hollow's buildings. They have no door in `GameMap.buildingEntries`; the village draws them roofless. */
export type BriarHollowBuildingId = BuildingIdAt<'briar_hollow'>;

/** The id of one building, from its location and slug. */
function buildingId<L extends keyof BuildingSlugs, S extends BuildingSlugs[L][number]>(
  location: L,
  slug: S,
): `${L}_${S}` {
  return `${location}_${slug}`;
}

function located<L extends BuildingLocation, S extends string>(
  location: L,
  slugs: readonly S[],
): ReadonlyArray<`${L}_${S}`> {
  return slugs.map((slug): `${L}_${S}` => `${location}_${slug}`);
}

/** Taloncrest's sprite buildings, north to south, as the `TownPlan` lays out their plots. */
export const PLANNED_BUILDING_IDS = located('taloncrest', TALONCREST_PLOT_SLUGS);

export type PlannedBuildingId = (typeof PLANNED_BUILDING_IDS)[number];

export const TOWN_TOWER_ID = buildingId('taloncrest', 'tower');

/** Every enterable building inside Taloncrest's wall: the sprite buildings and the tower. */
export type TownBuildingId = PlannedBuildingId | typeof TOWN_TOWER_ID;

/** Briar Hollow's buildings, in `BRIAR_HOLLOW_SLUGS` order. */
const BRIAR_HOLLOW_BUILDING_IDS = located('briar_hollow', BRIAR_HOLLOW_SLUGS);

const IDS_BY_LOCATION: { readonly [L in keyof BuildingSlugs]: ReadonlyArray<BuildingIdAt<L>> } = {
  taloncrest: located('taloncrest', BUILDING_SLUGS.taloncrest),
  briar_hollow: BRIAR_HOLLOW_BUILDING_IDS,
  level2: located('level2', BUILDING_SLUGS.level2),
};

export const BUILDING_IDS: readonly BuildingId[] = Object.values(IDS_BY_LOCATION).flat();

/** The name on each building's sign, and on every prompt, title and line that names it. */
const BUILDING_DISPLAY_NAMES = {
  taloncrest_garrison_lodge: 'Blackwood Lodge',
  taloncrest_builder_farm: 'Plumbline Farm',
  taloncrest_barracks: 'The Barracks',
  taloncrest_crafting_house: "Cartwright's Workshop",
  taloncrest_temple: 'Temple of the Sky',
  taloncrest_apothecary: 'Herb & Remedy',
  taloncrest_general_store: 'General Store',
  taloncrest_inn: 'The Sleeping Cat Inn',
  taloncrest_flagon_tavern: 'The Horned Flagon',
  taloncrest_old_lady_cottage: "Old Lori's Cottage",
  taloncrest_smithy: 'The Rusty Anvil',
  taloncrest_pub: 'The Sunken Stump Pub',
  taloncrest_tattoo_parlor: 'The Quiet Needle',
  taloncrest_nightclub: 'The Cloak & Dagger',
  taloncrest_mill_farm: "Miller's Farm",
  taloncrest_tower: 'Town Center Tower',
  taloncrest_circus_tent: 'The Starlight Tent',
  briar_hollow_hall: "Mayor's Hall",
  briar_hollow_forge: 'Ironwhisker Forge',
  briar_hollow_cookhouse: "Pipkin's Cookhouse",
  briar_hollow_infirmary: 'Infirmary',
  briar_hollow_store: 'Nibnose Trading Post',
  briar_hollow_workshop: "Engineer's Workshop",
  briar_hollow_sawmill: 'Splintertail Sawmill',
  briar_hollow_guardhouse: 'Guardhouse',
  briar_hollow_farmhouse: 'Roottail Farmhouse',
  briar_hollow_barn: 'Barn',
  briar_hollow_seamstress_cottage: 'Softstep Cottage',
  briar_hollow_well_keeper_cottage: 'Mudwhisk Cottage',
  briar_hollow_carpenter_workshop: 'Longtooth Workshop',
  briar_hollow_lamplighter_cottage: 'Candleear Cottage',
  briar_hollow_quarry_hut: 'Quarry Hut',
  level2_goblin_prison: 'Goblin High Security Prison',
} as const satisfies Record<BuildingId, string>;

/** The name the player reads for a building. Never a key: key by the id. */
export function buildingDisplayName(id: BuildingId): string {
  return BUILDING_DISPLAY_NAMES[id];
}

/** Narrows a value read from outside the type system, such as a save or a command line. */
export function isBuildingId(value: unknown): value is BuildingId {
  return BUILDING_IDS.some((id) => id === value);
}

/**
 * A building-keyed table as a map, in `BUILDING_IDS` order. `Object.entries`
 * would widen its keys to `string`; this keeps them `BuildingId`.
 */
export function mapByBuildingId<V>(
  table: Readonly<Partial<Record<BuildingId, V>>>,
): ReadonlyMap<BuildingId, V> {
  const byId = new Map<BuildingId, V>();
  for (const id of BUILDING_IDS) {
    const value = table[id];
    if (value !== undefined) byId.set(id, value);
  }
  return byId;
}
