/**
 * Every building a construction contract can send the party to, and the pool
 * of repair and rebuild spots each one offers.
 *
 * Pure data. A spot never holds tile coordinates: a prop spot names a placed
 * prop by the explicit id its layout gives it (`contractPropId`), and an area
 * spot names a rect the layout file exports beside its props, so the geometry
 * moves with the layout. `contractTargets.ts` resolves both into tiles.
 */

import type { ResourceCost } from '../../core/partyResources';
import type { VillagerId } from '../../dialog/scripts/briarHollow';
import { contractPropId } from '../../map/contractAreas';
import { BUILDINGS, type VillageBuildingId } from '../../map/overworld/briarHollowLayout';
import { PLANNED_BUILDING_NAMES, type TownBuildingName } from '../../map/town/townPlan';
import type { ResidentId } from '../townResidents';

/** The three materials a contract is costed in. */
export type ContractMaterialId = 'wood_board' | 'rope' | 'stone';

export type ContractSpotCost = Required<Pick<ResourceCost, ContractMaterialId>>;

/** A spot's id, unique within its site's pool. */
export type ContractSpotId = string;

/** What a contract spot is made of; picks its overlay art and its sound cues. */
export type ContractSpotMaterial = 'wood' | 'stone' | 'rope' | 'plaster';

export type ContractSpotTarget =
  | { readonly kind: 'prop'; readonly placedId: string }
  | { readonly kind: 'area'; readonly areaId: string };

export interface ContractSpotDef {
  readonly id: ContractSpotId;
  /**
   * `repair` overlays damage on something that still draws and blocks;
   * `rebuild` hides a prop behind a stripped build site until it is finished.
   */
  readonly kind: 'repair' | 'rebuild';
  /** Shown on the work prompt and in the Journal hint. */
  readonly label: string;
  readonly cost: ContractSpotCost;
  /** Picks the damage overlay art and the work sound. */
  readonly material: ContractSpotMaterial;
  readonly target: ContractSpotTarget;
}

/**
 * Skyfowl Town buildings that never host a contract: the tower, the club and
 * Wendell's own farm, where the contracts are handed out.
 */
export const CONTRACT_EXCLUDED_TOWN_BUILDINGS = [
  'Town Center Tower',
  'The Desperado Club',
  'Plumbline Farm',
] as const satisfies readonly TownBuildingName[];

export type ContractTownBuildingName = Exclude<
  TownBuildingName,
  (typeof CONTRACT_EXCLUDED_TOWN_BUILDINGS)[number]
>;

/** Every Briar Hollow building hosts contracts; none is excluded. */
export type ContractVillageBuildingId = VillageBuildingId;

export type ContractSiteKey =
  | { readonly town: 'skyfowl'; readonly buildingName: ContractTownBuildingName }
  | { readonly town: 'briar_hollow'; readonly buildingId: ContractVillageBuildingId };

interface ContractSiteDefBase {
  /**
   * Unique across both towns: the prefix of every placed-prop id the site's
   * spots target, and the key the contract state remembers a site by.
   */
  readonly slug: string;
  /** The building as Wendell and the Journal name it. */
  readonly name: string;
  readonly spots: readonly ContractSpotDef[];
}

export interface SkyfowlContractSiteDef extends ContractSiteDefBase {
  readonly town: 'skyfowl';
  readonly buildingName: ContractTownBuildingName;
  readonly contact: SkyfowlContractContactId;
}

export interface BriarHollowContractSiteDef extends ContractSiteDefBase {
  readonly town: 'briar_hollow';
  readonly buildingId: ContractVillageBuildingId;
  readonly contact: VillageContractContactId;
}

export type ContractSiteDef = SkyfowlContractSiteDef | BriarHollowContractSiteDef;

/** How a pool entry is written before its target is resolved against its site's slug. */
interface SpotSpec {
  readonly id: ContractSpotId;
  readonly kind: ContractSpotDef['kind'];
  readonly label: string;
  readonly cost: ContractSpotCost;
  readonly material: ContractSpotDef['material'];
  /** A placed prop with the explicit id `contract:<slug>:<id>`, or an exported area keyed by `id`. */
  readonly on: 'prop' | 'area';
}

function poolFor(slug: string, specs: readonly SpotSpec[]): readonly ContractSpotDef[] {
  return specs.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    cost: spec.cost,
    material: spec.material,
    target:
      spec.on === 'prop'
        ? { kind: 'prop', placedId: contractPropId(slug, spec.id) }
        : { kind: 'area', areaId: spec.id },
  }));
}

interface SkyfowlSiteData {
  readonly slug: string;
  readonly contact: ResidentId;
  readonly spots: readonly SpotSpec[];
}

interface VillageSiteData {
  readonly name: string;
  readonly contact: VillagerId;
  readonly spots: readonly SpotSpec[];
}

const SKYFOWL_SITE_DATA = {
  'The Barracks': {
    slug: 'barracks',
    contact: 'quartermaster_dann',
    spots: [
      {
        id: 'bunk',
        kind: 'rebuild',
        label: 'Rebuild a collapsed bunk',
        cost: { wood_board: 6, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'weapon_rack',
        kind: 'repair',
        label: 'Re-peg the weapon rack',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'brazier',
        kind: 'repair',
        label: 'Reline the brazier',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'trough',
        kind: 'repair',
        label: 'Re-mortar a leaking trough',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'issue_counter',
        kind: 'repair',
        label: 'Replank the issue counter',
        cost: { wood_board: 6, rope: 0, stone: 1 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'archery_butt',
        kind: 'rebuild',
        label: 'Rebuild and lash the archery butt',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'muster_floor',
        kind: 'repair',
        label: 'Relay cracked flagstones',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'sparring_ring',
        kind: 'repair',
        label: 'Re-rope the sparring ring',
        cost: { wood_board: 3, rope: 3, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'pell_posts',
        kind: 'repair',
        label: 'Reset a pell post in stone',
        cost: { wood_board: 2, rope: 0, stone: 6 },
        material: 'stone',
        on: 'prop',
      },
    ],
  },
  'Blackwood Lodge': {
    slug: 'blackwood_lodge',
    contact: 'sgt_kessler',
    spots: [
      {
        id: 'bunk',
        kind: 'rebuild',
        label: 'Rebuild a lodge bunk',
        cost: { wood_board: 6, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'stove',
        kind: 'repair',
        label: 'Rebuild the stove firebox',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'map_table',
        kind: 'repair',
        label: 'Brace the map table',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'spear_rack',
        kind: 'repair',
        label: 'Re-lash the spear rack',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'duty_board',
        kind: 'repair',
        label: 'Re-hang the duty board',
        cost: { wood_board: 2, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'floorboards',
        kind: 'repair',
        label: 'Replace rotten floorboards',
        cost: { wood_board: 7, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'chimney',
        kind: 'repair',
        label: 'Repoint the stove chimney',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'north_wall',
        kind: 'repair',
        label: 'Underpin the sagging wall',
        cost: { wood_board: 2, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  "Cartwright's Workshop": {
    slug: 'cartwrights_workshop',
    contact: 'brann_cartwright',
    spots: [
      {
        id: 'joiner_bench',
        kind: 'repair',
        label: "Replace the joiner's bench top",
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'lathe',
        kind: 'repair',
        label: 'Re-cord the lathe treadle',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'timber_rack',
        kind: 'rebuild',
        label: 'Rebuild the timber rack',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'wheel_stand',
        kind: 'repair',
        label: 'Set the wheel stand on stone footings',
        cost: { wood_board: 2, rope: 0, stone: 6 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'wagon_bed',
        kind: 'rebuild',
        label: 'Rebuild the wagon bed',
        cost: { wood_board: 6, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bay_pad',
        kind: 'repair',
        label: 'Lay a flagstone pad in the timber bay',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'north_wall',
        kind: 'repair',
        label: 'Patch the timber bay wall',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'glue_hearth',
        kind: 'repair',
        label: 'Rebuild the glue-pot hearth',
        cost: { wood_board: 1, rope: 0, stone: 6 },
        material: 'stone',
        on: 'prop',
      },
    ],
  },
  'General Store': {
    slug: 'general_store',
    contact: 'keeper_brenna_kestrel',
    spots: [
      {
        id: 'counter',
        kind: 'repair',
        label: 'Replank the shop counter',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'goods_wall',
        kind: 'rebuild',
        label: 'Rebuild a goods wall',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'storeroom_shelf',
        kind: 'repair',
        label: 'Re-lash the storeroom shelving',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'display_table',
        kind: 'repair',
        label: 'Brace a display table',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'perch_rail',
        kind: 'repair',
        label: 'Re-rope the perch rail',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'door_boards',
        kind: 'repair',
        label: 'Replace worn floorboards',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'plinth',
        kind: 'repair',
        label: 'Rebuild the stone plinth under the wall',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'bulk_bins',
        kind: 'repair',
        label: 'Set the bulk bins on a stone plinth',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'storeroom_flags',
        kind: 'repair',
        label: 'Flag the storeroom floor against damp',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  'Temple of the Sky': {
    slug: 'temple_of_the_sky',
    contact: 'deacon_aviel',
    spots: [
      {
        id: 'pew',
        kind: 'rebuild',
        label: 'Rebuild a broken pew',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'scripture_shelf',
        kind: 'repair',
        label: 'Rebuild a scripture shelf',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'banner',
        kind: 'repair',
        label: 'Re-hang a sky banner',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'font',
        kind: 'repair',
        label: 'Recut the font basin',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'dais',
        kind: 'repair',
        label: 'Relay the dais steps',
        cost: { wood_board: 2, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'altar',
        kind: 'repair',
        label: 'Reset the altar slab',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'perches',
        kind: 'repair',
        label: 'Re-lash a perch stand',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'nave_flags',
        kind: 'repair',
        label: 'Relay cracked nave flagstones',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'lectern',
        kind: 'rebuild',
        label: 'Rebuild the lectern',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'votive_rack',
        kind: 'repair',
        label: 'Rebuild a votive rack',
        cost: { wood_board: 4, rope: 1, stone: 1 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  'Herb & Remedy': {
    slug: 'herb_and_remedy',
    contact: 'apothecary_fen',
    spots: [
      {
        id: 'drying_rack',
        kind: 'repair',
        label: 'Re-string the drying rack',
        cost: { wood_board: 2, rope: 3, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'counter',
        kind: 'repair',
        label: 'Replank the counter',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'potting_bench',
        kind: 'rebuild',
        label: 'Rebuild the potting bench',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'still',
        kind: 'repair',
        label: 'Rebuild the still firebox',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'drying_floor',
        kind: 'repair',
        label: 'Replace rotten floorboards',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'hearth_wall',
        kind: 'repair',
        label: 'Rebuild the stone hearth wall',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'planters',
        kind: 'repair',
        label: 'Build stone planter beds',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'specimen_case',
        kind: 'rebuild',
        label: 'Rebuild the specimen case',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'sorting_table',
        kind: 'repair',
        label: 'Brace the sorting table',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  'The Sleeping Cat Inn': {
    slug: 'sleeping_cat_inn',
    contact: 'innkeep_ossie',
    spots: [
      {
        id: 'guest_bed',
        kind: 'rebuild',
        label: 'Rebuild a rope-strung guest bed',
        cost: { wood_board: 5, rope: 3, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'cot',
        kind: 'repair',
        label: 'Restring the cheap room cot',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'taproom_hearth',
        kind: 'repair',
        label: 'Rebuild the taproom hearth',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'best_fire',
        kind: 'repair',
        label: 'Repoint the best room fireplace',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'bar',
        kind: 'repair',
        label: 'Replank the bar',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'cask_rack',
        kind: 'rebuild',
        label: 'Rebuild the cask rack',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bench',
        kind: 'rebuild',
        label: 'Rebuild a taproom bench',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'hearth_apron',
        kind: 'repair',
        label: 'Lay a stone hearth apron',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'dresser',
        kind: 'repair',
        label: 'Rebuild the dresser',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  'The Horned Flagon': {
    slug: 'horned_flagon',
    contact: 'innkeep_brend',
    spots: [
      {
        id: 'bar',
        kind: 'repair',
        label: 'Replank the bar',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'hearth',
        kind: 'repair',
        label: 'Rebuild the great hearth',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'feast_table',
        kind: 'repair',
        label: 'Brace the feast table',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'feast_bench',
        kind: 'rebuild',
        label: 'Rebuild a feast bench',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'trophy_banner',
        kind: 'repair',
        label: 'Re-hang the trophy banner',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'booth_screen',
        kind: 'rebuild',
        label: 'Rebuild the booth screen',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'hearth_flags',
        kind: 'repair',
        label: 'Relay cracked flagstones',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'trestle',
        kind: 'rebuild',
        label: "Rebuild a labourers' trestle",
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'fire_wall',
        kind: 'repair',
        label: 'Repoint the fireplace wall',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  "Old Hilda's Cottage": {
    slug: 'old_hildas_cottage',
    contact: 'old_hilda',
    spots: [
      {
        id: 'bed',
        kind: 'repair',
        label: 'Restring the cottage bed',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'hearth',
        kind: 'repair',
        label: "Rebuild the witch's hearth",
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'drying_beam',
        kind: 'repair',
        label: 'Re-hang the drying beam',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'crockery_shelf',
        kind: 'rebuild',
        label: 'Rebuild the crockery shelf',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'jar_dresser',
        kind: 'rebuild',
        label: 'Rebuild the jar dresser',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'floorboards',
        kind: 'repair',
        label: 'Replace rotten floorboards',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'chimney',
        kind: 'repair',
        label: 'Patch the chimney breast',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'worktable',
        kind: 'repair',
        label: 'Brace the worktable',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'door_step',
        kind: 'repair',
        label: 'Lay a stone door step',
        cost: { wood_board: 0, rope: 0, stone: 6 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  'The Rusty Anvil': {
    slug: 'rusty_anvil',
    contact: 'smith_varga',
    spots: [
      {
        id: 'forge',
        kind: 'repair',
        label: 'Rebuild the forge firebox',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'bellows',
        kind: 'repair',
        label: 'Re-rope the bellows',
        cost: { wood_board: 2, rope: 3, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'quench',
        kind: 'repair',
        label: 'Re-mortar the quench trough',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'blade_rack',
        kind: 'rebuild',
        label: 'Rebuild a blade rack',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'counter',
        kind: 'repair',
        label: 'Replank the shop counter',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'vice_bench',
        kind: 'rebuild',
        label: 'Rebuild the vice bench',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'tool_wall',
        kind: 'repair',
        label: 'Re-hang the tool wall',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'shop_flags',
        kind: 'repair',
        label: 'Relay the shop flagstones',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'mail_stand',
        kind: 'rebuild',
        label: 'Rebuild the mail stand',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  'The Sunken Stump Pub': {
    slug: 'sunken_stump_pub',
    contact: 'innkeep_marlow',
    spots: [
      {
        id: 'bar',
        kind: 'repair',
        label: 'Rebuild the bar front',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'stove',
        kind: 'repair',
        label: 'Reline the stove',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'back_shelf',
        kind: 'rebuild',
        label: 'Rebuild a back shelf',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'dice_table',
        kind: 'rebuild',
        label: 'Rebuild the dice table',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'keg_cradle',
        kind: 'repair',
        label: 'Build a keg cradle',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'mud_flags',
        kind: 'repair',
        label: 'Flag over the worst of the mud',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'plaster',
        kind: 'repair',
        label: 'Patch the crumbling plaster',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'plaster',
        on: 'area',
      },
      {
        id: 'lamp',
        kind: 'repair',
        label: 'Re-hang the lamp on new rope',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'stump_table',
        kind: 'repair',
        label: 'Brace the stump table',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  'The Quiet Needle': {
    slug: 'quiet_needle',
    contact: 'tattooist_nim',
    spots: [
      {
        id: 'ink_chair',
        kind: 'rebuild',
        label: 'Rebuild the inking chair',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'pigment_cabinet',
        kind: 'rebuild',
        label: 'Rebuild the pigment cabinet',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'grinding_bench',
        kind: 'repair',
        label: 'Reset the grinding stone',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'settee',
        kind: 'rebuild',
        label: 'Rebuild a settee frame',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'flash_wall',
        kind: 'repair',
        label: 'Re-hang the flash boards',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'waiting_floor',
        kind: 'repair',
        label: 'Replace worn floorboards',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'plaster',
        kind: 'repair',
        label: 'Patch the plaster',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'plaster',
        on: 'area',
      },
      {
        id: 'wash_floor',
        kind: 'repair',
        label: 'Lay a stone wash-floor',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'low_table',
        kind: 'repair',
        label: 'Brace the low table',
        cost: { wood_board: 3, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
    ],
  },
  "Miller's Farm": {
    slug: 'millers_farm',
    contact: 'marta_miller',
    spots: [
      {
        id: 'millstone',
        kind: 'repair',
        label: 'Re-dress the millstone',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'hearth',
        kind: 'repair',
        label: 'Rebuild the farm hearth',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'farm_table',
        kind: 'rebuild',
        label: 'Rebuild the farm table',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'larder_shelf',
        kind: 'rebuild',
        label: 'Rebuild the larder shelf',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'sieve_rack',
        kind: 'repair',
        label: 'Re-string the sieve rack',
        cost: { wood_board: 2, rope: 3, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'grain_bin',
        kind: 'rebuild',
        label: 'Rebuild the grain bin',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'pot_rack',
        kind: 'repair',
        label: 'Re-hang the pot rack',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'kitchen_floor',
        kind: 'repair',
        label: 'Replace rotten floorboards',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'mill_flags',
        kind: 'repair',
        label: 'Relay the mill-room flags',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
} as const satisfies Record<ContractTownBuildingName, SkyfowlSiteData>;

/** The north-wall run every roofless village room offers. */
const REPOINT_NORTH_WALL: SpotSpec = {
  id: 'north_wall',
  kind: 'repair',
  label: 'Repoint the north wall',
  cost: { wood_board: 1, rope: 0, stone: 8 },
  material: 'stone',
  on: 'area',
};

/** The plank floor every roofless village room offers. */
const REPLACE_FLOOR_PLANKS: SpotSpec = {
  id: 'floor',
  kind: 'repair',
  label: 'Replace rotten floor planks',
  cost: { wood_board: 6, rope: 0, stone: 0 },
  material: 'wood',
  on: 'area',
};

const RESTRING_BED: SpotSpec = {
  id: 'bed',
  kind: 'repair',
  label: 'Restring the bed',
  cost: { wood_board: 3, rope: 2, stone: 0 },
  material: 'rope',
  on: 'prop',
};

const VILLAGE_SITE_DATA = {
  hall: {
    name: "Mayor's Hall",
    contact: 'bramblewick',
    spots: [
      {
        id: 'records_shelf',
        kind: 'rebuild',
        label: 'Rebuild a records shelf',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'banner',
        kind: 'repair',
        label: 'Re-hang the hall banner',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'desk',
        kind: 'repair',
        label: "Replank the mayor's desk",
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'hearth',
        kind: 'repair',
        label: 'Rebuild the hall hearth',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'long_table',
        kind: 'repair',
        label: 'Brace the long table',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bench',
        kind: 'rebuild',
        label: 'Rebuild a bench',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'threshold',
        kind: 'repair',
        label: 'Lay a stone threshold',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  forge: {
    name: 'Ironwhisker Forge',
    contact: 'oren',
    spots: [
      {
        id: 'forge_hearth',
        kind: 'repair',
        label: 'Rebuild the forge hearth',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'anvil_block',
        kind: 'repair',
        label: 'Reset the anvil block in stone',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'quench',
        kind: 'repair',
        label: 'Re-mortar the quench trough',
        cost: { wood_board: 1, rope: 0, stone: 6 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'tool_rack',
        kind: 'repair',
        label: 'Re-lash the tool rack',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'coal_bin',
        kind: 'rebuild',
        label: 'Rebuild the coal bin',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'back_wall',
        kind: 'repair',
        label: 'Rebuild the soot-cracked back wall',
        cost: { wood_board: 1, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'walkway',
        kind: 'repair',
        label: 'Plank a walkway over the gravel',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'awning',
        kind: 'rebuild',
        label: 'Rig a canvas awning over the open front',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'rope',
        on: 'area',
      },
    ],
  },
  cookhouse: {
    name: "Pipkin's Cookhouse",
    contact: 'pipkin',
    spots: [
      {
        id: 'hearth',
        kind: 'repair',
        label: 'Rebuild the cooking hearth',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'counter',
        kind: 'repair',
        label: 'Replank the serving counter',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'table',
        kind: 'rebuild',
        label: 'Rebuild a table',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bench',
        kind: 'repair',
        label: 'Re-lash a bench',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      {
        id: 'floor',
        kind: 'repair',
        label: 'Replace rotten floor planks',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'hearth_apron',
        kind: 'repair',
        label: 'Lay a stone hearth apron',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_door',
        kind: 'repair',
        label: 'Reframe the east door',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  infirmary: {
    name: 'Infirmary',
    contact: 'sella',
    spots: [
      {
        id: 'cot_a',
        kind: 'repair',
        label: 'Restring a cot',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'cot_b',
        kind: 'repair',
        label: 'Restring a cot',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'herb_shelf',
        kind: 'repair',
        label: 'Re-lash the herb shelf',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'basin',
        kind: 'repair',
        label: 'Reset the washbasin on a stone stand',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'table',
        kind: 'rebuild',
        label: 'Rebuild the table',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'wash_floor',
        kind: 'repair',
        label: 'Lay a scrubbable stone floor',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  store: {
    name: 'Nibnose Trading Post',
    contact: 'vetch',
    spots: [
      {
        id: 'counter',
        kind: 'repair',
        label: 'Replank the counter',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'shelf_a',
        kind: 'rebuild',
        label: 'Rebuild a goods shelf',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'shelf_b',
        kind: 'repair',
        label: 'Re-lash a goods shelf',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'barrel',
        kind: 'repair',
        label: 'Re-hoop and rope a barrel',
        cost: { wood_board: 1, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      REPLACE_FLOOR_PLANKS,
      REPOINT_NORTH_WALL,
      {
        id: 'rat_floor',
        kind: 'repair',
        label: 'Lay stone against the rats',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'sack_plinth',
        kind: 'repair',
        label: 'Build a stone plinth for the sacks',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
    ],
  },
  workshop: {
    name: "Engineer's Workshop",
    contact: 'tikka',
    spots: [
      {
        id: 'drafting_table',
        kind: 'repair',
        label: 'Brace the drafting table',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'gear_crate_a',
        kind: 'repair',
        label: 'Rope-handle a gear crate',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'gear_crate_b',
        kind: 'repair',
        label: 'Rope-handle a gear crate',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'trebuchet_model',
        kind: 'repair',
        label: 'Restring the trebuchet model',
        cost: { wood_board: 1, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'workbench',
        kind: 'rebuild',
        label: 'Rebuild the workbench',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'test_pad',
        kind: 'repair',
        label: 'Lay a stone test pad',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'threshold',
        kind: 'repair',
        label: 'Reset the stone threshold',
        cost: { wood_board: 0, rope: 0, stone: 6 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  sawmill: {
    name: 'Splintertail Sawmill',
    contact: 'fenna',
    spots: [
      {
        id: 'log_chocks',
        kind: 'repair',
        label: 'Build log chocks',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'board_rack',
        kind: 'rebuild',
        label: 'Rebuild the board rack',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'south_wall',
        kind: 'repair',
        label: 'Rebuild the south wall footing',
        cost: { wood_board: 1, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'saw_flags',
        kind: 'repair',
        label: 'Flag the floor under the saw bay',
        cost: { wood_board: 0, rope: 0, stone: 10 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'loading_floor',
        kind: 'repair',
        label: 'Plank the loading floor',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'hoist',
        kind: 'rebuild',
        label: 'Rig a timber hoist',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'rope',
        on: 'area',
      },
      {
        id: 'west_wall',
        kind: 'repair',
        label: 'Rebuild the west wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Patch the east wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  guardhouse: {
    name: 'Guardhouse',
    contact: 'sedge',
    spots: [
      {
        id: 'table',
        kind: 'repair',
        label: 'Brace the table',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'weapon_rack',
        kind: 'repair',
        label: 'Re-lash the weapon rack',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'bunk_a',
        kind: 'rebuild',
        label: 'Rebuild a bunk',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bunk_b',
        kind: 'rebuild',
        label: 'Rebuild a bunk',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'entry_flags',
        kind: 'repair',
        label: 'Flag the entry',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'west_door',
        kind: 'repair',
        label: 'Reframe the door in stone',
        cost: { wood_board: 2, rope: 0, stone: 6 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  farmhouse: {
    name: 'Roottail Farmhouse',
    contact: 'merrit',
    spots: [
      RESTRING_BED,
      {
        id: 'table',
        kind: 'rebuild',
        label: 'Rebuild the table',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'seed_platform',
        kind: 'rebuild',
        label: 'Build a raised seed platform',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'hoe_rack',
        kind: 'repair',
        label: 'Re-lash the hoe rack',
        cost: { wood_board: 2, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'door_flags',
        kind: 'repair',
        label: 'Lay a stone floor by the door',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'west_wall',
        kind: 'repair',
        label: 'Rebuild the west wall footing',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
  barn: {
    name: 'Barn',
    contact: 'merrit',
    spots: [
      {
        id: 'hay_rack',
        kind: 'rebuild',
        label: 'Build a hay rack',
        cost: { wood_board: 4, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'trough',
        kind: 'repair',
        label: 'Re-mortar the trough',
        cost: { wood_board: 1, rope: 0, stone: 7 },
        material: 'stone',
        on: 'prop',
      },
      {
        id: 'feed_bin',
        kind: 'rebuild',
        label: 'Rebuild the feed bin',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'north_wall',
        kind: 'repair',
        label: 'Repoint the north wall',
        cost: { wood_board: 2, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'stall_floor',
        kind: 'repair',
        label: 'Replank the stall floor',
        cost: { wood_board: 6, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'barn_door',
        kind: 'rebuild',
        label: 'Hang a barn door on rope runners',
        cost: { wood_board: 4, rope: 2, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'drain',
        kind: 'repair',
        label: 'Flag the drain channel',
        cost: { wood_board: 0, rope: 0, stone: 9 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'south_wall',
        kind: 'repair',
        label: 'Patch the south wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  home_nella: {
    name: 'Softstep Cottage',
    contact: 'nella',
    spots: [
      RESTRING_BED,
      {
        id: 'loom',
        kind: 'repair',
        label: 'Restring the loom',
        cost: { wood_board: 2, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'bolt_shelf',
        kind: 'rebuild',
        label: 'Build a bolt shelf',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'threshold',
        kind: 'repair',
        label: 'Lay a stone threshold',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'west_wall',
        kind: 'repair',
        label: 'Rebuild the west wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Patch the east wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  home_cricket: {
    name: 'Mudwhisk Cottage',
    contact: 'cricket',
    spots: [
      RESTRING_BED,
      {
        id: 'tool_pegs',
        kind: 'repair',
        label: 'Re-peg the tool wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'bucket',
        kind: 'repair',
        label: 'Re-hoop and rope the bucket',
        cost: { wood_board: 1, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'west_door',
        kind: 'repair',
        label: 'Reframe the door in stone',
        cost: { wood_board: 3, rope: 0, stone: 5 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Rebuild the east wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'south_wall',
        kind: 'repair',
        label: 'Patch the south wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  home_wicker: {
    name: 'Longtooth Workshop',
    contact: 'wicker',
    spots: [
      RESTRING_BED,
      {
        id: 'workbench',
        kind: 'rebuild',
        label: 'Rebuild the workbench with a rope vice',
        cost: { wood_board: 5, rope: 1, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'board_stack',
        kind: 'repair',
        label: 'Re-lash the board stack',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'threshold',
        kind: 'repair',
        label: 'Lay a stone threshold',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'west_wall',
        kind: 'repair',
        label: 'Rebuild the west wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Patch the east wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  home_midge: {
    name: 'Candleear Cottage',
    contact: 'midge',
    spots: [
      RESTRING_BED,
      {
        id: 'lamp_shelf',
        kind: 'repair',
        label: 'Re-lash the lamp shelf',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'oil_rack',
        kind: 'rebuild',
        label: 'Build an oil-can rack',
        cost: { wood_board: 4, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      REPOINT_NORTH_WALL,
      REPLACE_FLOOR_PLANKS,
      {
        id: 'threshold',
        kind: 'repair',
        label: 'Lay a stone threshold',
        cost: { wood_board: 0, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Rebuild the east wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'west_wall',
        kind: 'repair',
        label: 'Patch the west wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
    ],
  },
  garn_hut: {
    name: 'Quarry Hut',
    contact: 'garn',
    spots: [
      {
        id: 'stool',
        kind: 'rebuild',
        label: 'Rebuild the stool',
        cost: { wood_board: 2, rope: 0, stone: 0 },
        material: 'wood',
        on: 'prop',
      },
      {
        id: 'pick_rack',
        kind: 'repair',
        label: 'Re-lash the pick rack',
        cost: { wood_board: 3, rope: 2, stone: 0 },
        material: 'rope',
        on: 'prop',
      },
      {
        id: 'north_wall',
        kind: 'repair',
        label: 'Repoint the north wall',
        cost: { wood_board: 2, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'floor',
        kind: 'repair',
        label: 'Replace rotten floor planks',
        cost: { wood_board: 5, rope: 0, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'west_door',
        kind: 'repair',
        label: 'Reframe the door',
        cost: { wood_board: 4, rope: 1, stone: 2 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'east_wall',
        kind: 'repair',
        label: 'Rebuild the east wall footing',
        cost: { wood_board: 2, rope: 0, stone: 7 },
        material: 'stone',
        on: 'area',
      },
      {
        id: 'south_wall',
        kind: 'repair',
        label: 'Patch the south wall',
        cost: { wood_board: 3, rope: 1, stone: 0 },
        material: 'wood',
        on: 'area',
      },
      {
        id: 'step',
        kind: 'repair',
        label: 'Lay a stone step at the door',
        cost: { wood_board: 0, rope: 0, stone: 8 },
        material: 'stone',
        on: 'area',
      },
    ],
  },
} as const satisfies Record<ContractVillageBuildingId, VillageSiteData>;

/** The Skyfowl Town residents who pay out a contract: one per site, derived so a new site's contact joins the union. */
export type SkyfowlContractContactId =
  (typeof SKYFOWL_SITE_DATA)[keyof typeof SKYFOWL_SITE_DATA]['contact'];

/** The Briar Hollow villagers who pay out a contract; one villager may be the contact for several sites. */
export type VillageContractContactId =
  (typeof VILLAGE_SITE_DATA)[keyof typeof VILLAGE_SITE_DATA]['contact'];

/** Everyone who pays out a contract, in either town. */
export type ContractContactId = SkyfowlContractContactId | VillageContractContactId;

function skyfowlSite(buildingName: ContractTownBuildingName): SkyfowlContractSiteDef {
  const entry = SKYFOWL_SITE_DATA[buildingName];
  const data: SkyfowlSiteData = entry;
  return {
    town: 'skyfowl',
    buildingName,
    slug: data.slug,
    name: buildingName,
    contact: entry.contact,
    spots: poolFor(data.slug, data.spots),
  };
}

function villageSite(buildingId: ContractVillageBuildingId): BriarHollowContractSiteDef {
  const entry = VILLAGE_SITE_DATA[buildingId];
  const data: VillageSiteData = entry;
  return {
    town: 'briar_hollow',
    buildingId,
    slug: buildingId,
    name: data.name,
    contact: entry.contact,
    spots: poolFor(buildingId, data.spots),
  };
}

function isContractTownBuildingName(name: TownBuildingName): name is ContractTownBuildingName {
  return name in SKYFOWL_SITE_DATA;
}

/** Every contract site in both towns, Skyfowl Town first, in the fixed order the generator draws from. */
export const CONTRACT_SITES: readonly ContractSiteDef[] = [
  ...PLANNED_BUILDING_NAMES.filter(isContractTownBuildingName).map(skyfowlSite),
  ...BUILDINGS.map((building) => villageSite(building.id)),
];

const SITES_BY_SLUG = new Map<string, ContractSiteDef>(
  CONTRACT_SITES.map((site) => [site.slug, site]),
);

/** The site a slug names, or undefined for a slug no site carries (a stale save). */
export function contractSiteBySlug(slug: string): ContractSiteDef | undefined {
  return SITES_BY_SLUG.get(slug);
}

/** The catalogue entry a saved site key names, or undefined when it names none. */
export function contractSiteFor(key: ContractSiteKey): ContractSiteDef | undefined {
  return CONTRACT_SITES.find((site) =>
    site.town === 'skyfowl'
      ? key.town === 'skyfowl' && key.buildingName === site.buildingName
      : key.town === 'briar_hollow' && key.buildingId === site.buildingId,
  );
}

/** The durable key for a site, as the contract state stores it. */
export function contractSiteKey(site: ContractSiteDef): ContractSiteKey {
  return site.town === 'skyfowl'
    ? { town: 'skyfowl', buildingName: site.buildingName }
    : { town: 'briar_hollow', buildingId: site.buildingId };
}

/** The Skyfowl Town site for a building, or undefined when that building hosts none. */
export function skyfowlContractSite(buildingName: string): SkyfowlContractSiteDef | undefined {
  for (const site of CONTRACT_SITES) {
    if (site.town === 'skyfowl' && site.buildingName === buildingName) return site;
  }
  return undefined;
}

/** The spot with this id in a site's pool, or undefined. */
export function contractSpot(
  site: ContractSiteDef,
  spotId: ContractSpotId,
): ContractSpotDef | undefined {
  return site.spots.find((spot) => spot.id === spotId);
}
