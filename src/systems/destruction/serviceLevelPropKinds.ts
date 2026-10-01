/**
 * What each breakable piece of service-level furniture is, as data: which
 * tile it stands on, how much it takes, what it is made of, and what falls out
 * of it.
 *
 * `DestructiblePropSystem` reads this table for every service-level kind, so a
 * new piece is one row here plus its art.
 */

import { TILE_SIZE } from '../../core/constants';
import type { ItemId } from '../../core/ItemDefs';
import type { BreakMaterial, SmashCue } from './breakMaterials';
import type { ServicePropKind } from '../../sprites/art/serviceProps/serviceFurnitureArt';
import {
  FILING_CABINET,
  GAS_CYLINDER,
  LOCKER_BANK,
  LOCKER_BENCH,
  MOP_BUCKET,
  PALLET_STACK,
  SERVICE_DESK,
  VENDING_MACHINE,
} from '../../map/tileTypes';

/** One possible find in a piece's contents, weighted against the others. */
export interface ContentsItem {
  readonly id: ItemId;
  readonly weight: number;
}

/**
 * What a broken piece may hold. Rolled once per break: coins on
 * `coinChance`, and independently one item on `itemChance`.
 */
export interface PropContentsTable {
  readonly coinChance: number;
  readonly itemChance: number;
  readonly items: ReadonlyArray<ContentsItem>;
}

/** The decal a break leaves spread round the wreckage, beyond the wreckage itself. */
export type ServiceSpill = 'paper' | 'water' | 'glass' | 'clutter';

export interface ServicePropKindDef {
  readonly tileType: number;
  readonly hp: number;
  /** What it is chiefly made of, first, and anything else that comes out of it. */
  readonly materials: readonly [BreakMaterial, ...BreakMaterial[]];
  readonly smashCue: SmashCue;
  /**
   * Breaking it lights a fuse rather than ending it: it hisses for
   * {@link GAS_CYLINDER_FUSE_FRAMES} and then goes off.
   */
  readonly explosive: boolean;
  readonly contents: PropContentsTable;
  /** What it spills round its wreckage when it goes, or null for a clean break. */
  readonly spill: ServiceSpill | null;
  /**
   * Whether the first blow that cracks it sends its sign skidding: a live
   * overlay from its sheet's `skid` row, played once over the damaged art.
   */
  readonly skidsSignOnCrack: boolean;
  /** Where its splinters come off, in tile heights from the tile centre; negative is up. */
  readonly splinterOffsetTiles: number;
  /** How tall a span its splinters come off over, in tile heights. */
  readonly splinterSpanTiles: number;
  readonly splinterShades: readonly [string, ...string[]];
}

/**
 * The gas bottle's fuse: about 1.2 s of visible hiss between the break and
 * the blast. Far longer than the locked-telegraph floor, so a crawler who
 * hears it always has time to get clear.
 */
export const GAS_CYLINDER_FUSE_FRAMES = 72;

/**
 * How far a gas bottle's blast reaches: two tiles, smaller than a stick of
 * dynamite's three, so a bottle clears its corner rather than the room.
 */
export const GAS_CYLINDER_BLAST_RADIUS_TILES = 2;
export const GAS_CYLINDER_BLAST_RADIUS_PX = TILE_SIZE * GAS_CYLINDER_BLAST_RADIUS_TILES;

/**
 * What a gas blast does to a crawler caught in it: a hard knock, well short of
 * a stick of dynamite's, so walking into one is a mistake rather than a death.
 */
export const GAS_CYLINDER_CRAWLER_DAMAGE = 5;

/** A gas blast's damage to a mob, as a share of what a stick of dynamite would do. */
export const GAS_CYLINDER_MOB_DAMAGE_FRACTION = 0.5;

const NO_CONTENTS: PropContentsTable = { coinChance: 0, itemChance: 0, items: [] };

/** A locker is someone's: loose change usually, a potion or a fizz now and then. */
const LOCKER_CONTENTS: PropContentsTable = {
  coinChance: 0.5,
  itemChance: 0.08,
  items: [
    { id: 'health_potion', weight: 2 },
    { id: 'speed_fizz', weight: 1 },
  ],
};

/** A filing cabinet's petty-cash tin, sometimes. Its paper is the spill, not the find. */
const FILING_CABINET_CONTENTS: PropContentsTable = { coinChance: 0.35, itemChance: 0, items: [] };

/**
 * A vending machine always pays out something: its float, and often one of
 * what it was selling — a can of fizz or a bag of crisps.
 */
const VENDING_CONTENTS: PropContentsTable = {
  coinChance: 1,
  itemChance: 0.35,
  items: [
    { id: 'speed_fizz', weight: 1 },
    { id: 'cooldown_crisp', weight: 1 },
  ],
};

/** A desk drawer's loose change. */
const DESK_CONTENTS: PropContentsTable = { coinChance: 0.4, itemChance: 0, items: [] };

const STEEL_SHADES = ['#3f4f55', '#647a80', '#8d9ea2', '#a9babd'] as const;
const CABINET_SHADES = ['#5d5a51', '#878275', '#cfcbbd', '#e0dccf'] as const;
const VENDING_SHADES = ['#5e2a28', '#c8dbe4', '#dcebf3', '#d0a23b', '#b8473a'] as const;
const CYLINDER_SHADES = ['#55241d', '#7f3a2f', '#c8c3b5', '#5c656b'] as const;
const YELLOW_PLASTIC_SHADES = ['#8d711b', '#bf9d2c', '#d8b843', '#4b4a3c'] as const;
const PALLET_SHADES = ['#6a5639', '#8e7754', '#b39a72', '#c9b28a'] as const;
const DESK_SHADES = ['#615b4d', '#a39b86', '#a29c89', '#c8d4d0', '#cfcbbd'] as const;
const BENCH_SHADES = ['#5b452b', '#7d613f', '#a3825a', '#5c656b'] as const;

/** A tall piece's splinters come off its chest and down its height. */
const TALL_SPLINTER_OFFSET = -0.25;
const TALL_SPLINTER_SPAN = 0.8;
const LOW_SPLINTER_OFFSET = 0;
const LOW_SPLINTER_SPAN = 0.3;

/** Steel and tall: takes more than a bookshelf. */
const LOCKER_HP = 9;
const FILING_CABINET_HP = 8;
/** The biggest box on the floor, and the most worth breaking. */
const VENDING_HP = 12;
/** A bottle of compressed gas is thick-walled; it takes a few good swings to crack. */
const GAS_CYLINDER_HP = 7;
/** Plastic: a kick sends it. */
const MOP_BUCKET_HP = 3;
const PALLET_HP = 6;
const DESK_HP = 9;
const BENCH_HP = 6;

export const SERVICE_PROP_KINDS: Readonly<Record<ServicePropKind, ServicePropKindDef>> = {
  gas_cylinder: {
    tileType: GAS_CYLINDER,
    hp: GAS_CYLINDER_HP,
    materials: ['metal', 'gas'],
    smashCue: 'iron',
    explosive: true,
    contents: NO_CONTENTS,
    spill: null,
    skidsSignOnCrack: false,
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: CYLINDER_SHADES,
  },
  locker_bank: {
    tileType: LOCKER_BANK,
    hp: LOCKER_HP,
    materials: ['metal'],
    smashCue: 'iron',
    explosive: false,
    contents: LOCKER_CONTENTS,
    spill: 'clutter',
    skidsSignOnCrack: false,
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: STEEL_SHADES,
  },
  filing_cabinet: {
    tileType: FILING_CABINET,
    hp: FILING_CABINET_HP,
    materials: ['metal', 'paper'],
    smashCue: 'iron',
    explosive: false,
    contents: FILING_CABINET_CONTENTS,
    spill: 'paper',
    skidsSignOnCrack: false,
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: CABINET_SHADES,
  },
  mop_bucket: {
    tileType: MOP_BUCKET,
    hp: MOP_BUCKET_HP,
    materials: ['plastic'],
    smashCue: 'trash',
    explosive: false,
    contents: NO_CONTENTS,
    spill: 'water',
    skidsSignOnCrack: true,
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: YELLOW_PLASTIC_SHADES,
  },
  pallet_stack: {
    tileType: PALLET_STACK,
    hp: PALLET_HP,
    materials: ['wood'],
    smashCue: 'wood',
    explosive: false,
    contents: NO_CONTENTS,
    spill: null,
    skidsSignOnCrack: false,
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: PALLET_SHADES,
  },
  vending_machine: {
    tileType: VENDING_MACHINE,
    hp: VENDING_HP,
    materials: ['glass', 'metal'],
    smashCue: 'iron',
    explosive: false,
    contents: VENDING_CONTENTS,
    spill: 'glass',
    skidsSignOnCrack: false,
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: VENDING_SHADES,
  },
  service_desk: {
    tileType: SERVICE_DESK,
    hp: DESK_HP,
    materials: ['wood', 'glass'],
    smashCue: 'wood',
    explosive: false,
    contents: DESK_CONTENTS,
    spill: 'paper',
    skidsSignOnCrack: false,
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: DESK_SHADES,
  },
  locker_bench: {
    tileType: LOCKER_BENCH,
    hp: BENCH_HP,
    materials: ['wood', 'metal'],
    smashCue: 'wood',
    explosive: false,
    contents: NO_CONTENTS,
    spill: null,
    skidsSignOnCrack: false,
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: BENCH_SHADES,
  },
};

/** The service-level kind standing on a tile of this type, or null. */
export function servicePropKindForTileType(type: number): ServicePropKind | null {
  for (const [kind, def] of Object.entries(SERVICE_PROP_KINDS)) {
    if (def.tileType === type && isServicePropKind(kind)) return kind;
  }
  return null;
}

function isServicePropKind(kind: string): kind is ServicePropKind {
  return kind in SERVICE_PROP_KINDS;
}

/** Every service-level kind. */
export const SERVICE_PROP_KIND_LIST: ReadonlyArray<ServicePropKind> =
  Object.keys(SERVICE_PROP_KINDS).filter(isServicePropKind);

/** Rolls a kind's contents with `random`, returning the coins flag and the item found, if any. */
export function rollContents(
  table: PropContentsTable,
  random: () => number,
): { readonly coins: boolean; readonly item: ItemId | null } {
  const coins = random() < table.coinChance;
  if (table.items.length === 0 || random() >= table.itemChance) return { coins, item: null };
  const total = table.items.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = random() * total;
  for (const entry of table.items) {
    pick -= entry.weight;
    if (pick < 0) return { coins, item: entry.id };
  }
  return { coins, item: table.items[table.items.length - 1]?.id ?? null };
}

/** One value per service-level kind, built from its definition. */
export function perServiceKind<T>(
  value: (def: ServicePropKindDef) => T,
): Record<ServicePropKind, T> {
  const k = SERVICE_PROP_KINDS;
  return {
    gas_cylinder: value(k.gas_cylinder),
    locker_bank: value(k.locker_bank),
    filing_cabinet: value(k.filing_cabinet),
    mop_bucket: value(k.mop_bucket),
    pallet_stack: value(k.pallet_stack),
    vending_machine: value(k.vending_machine),
    service_desk: value(k.service_desk),
    locker_bench: value(k.locker_bench),
  };
}
