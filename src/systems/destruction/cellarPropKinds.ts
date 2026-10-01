/**
 * What each breakable piece of cellar furniture is, as data: which tile it
 * stands on, how much it takes, what it is made of, what falls out of it and
 * what it spills.
 *
 * `DestructiblePropSystem` reads this table for every cellar kind, so a new
 * piece is one row here plus its art.
 */

import type { BreakMaterial, SmashCue } from './breakMaterials';
import type { CellarBreakableKind } from '../../sprites/sheets/cellarPropSheets';
import {
  BOTTLE_RACK,
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  CLAY_URN,
  FALLEN_BEAM,
  GLOW_FUNGUS,
  GRAIN_SACK,
  RUBBLE_HEAP,
  RUBBLE_SLOPE,
  SPEAR_RACK,
  WINE_CASK,
} from '../../map/tileTypes';
import type { PropContentsTable } from './serviceLevelPropKinds';

/** The decal a break leaves spread round the wreckage, beyond the wreckage itself. */
export type CellarSpill = 'grain' | 'wine' | 'wax' | 'dust' | 'slime';

export interface CellarPropKindDef {
  readonly tileType: number;
  readonly hp: number;
  /** What it is chiefly made of, first, and anything else that comes out of it. */
  readonly materials: readonly [BreakMaterial, ...BreakMaterial[]];
  readonly smashCue: SmashCue;
  readonly contents: PropContentsTable;
  /** What it spills when it goes, or null for a clean break. */
  readonly spill: CellarSpill | null;
  /** Where its splinters come off, in tile heights from the tile centre; negative is up. */
  readonly splinterOffsetTiles: number;
  /** How tall a span its splinters come off over, in tile heights. */
  readonly splinterSpanTiles: number;
  readonly splinterShades: readonly [string, ...string[]];
}

const NO_CONTENTS: PropContentsTable = { coinChance: 0, itemChance: 0, items: [] };

/**
 * A sealed urn is where a cellar's owner hid things: often a few coins, now
 * and then a potion. The rest held grain.
 */
const URN_CONTENTS: PropContentsTable = {
  coinChance: 0.45,
  itemChance: 0.1,
  items: [{ id: 'health_potion', weight: 1 }],
};

/** A grain sack is grain; once in a while someone tucked a purse into it. */
const SACK_CONTENTS: PropContentsTable = { coinChance: 0.12, itemChance: 0, items: [] };

/** A guardroom table's drawer: the guards' dice money. */
const TABLE_CONTENTS: PropContentsTable = { coinChance: 0.5, itemChance: 0, items: [] };

/** Coins wedged in a cask's cradle or a rack's cubbies, now and then. */
const LOOSE_CHANGE: PropContentsTable = { coinChance: 0.2, itemChance: 0, items: [] };

/** Something buried under a heap of fallen vault. */
const RUBBLE_CONTENTS: PropContentsTable = { coinChance: 0.15, itemChance: 0, items: [] };

const CLAY_SHADES = ['#5f3a29', '#7c5038', '#966a4c', '#b08566'] as const;
const BURLAP_SHADES = ['#5c4a30', '#7a6443', '#b39a5c', '#987f58'] as const;
const OAK_SHADES = ['#43291a', '#62401f', '#82592f', '#a37542'] as const;
const CASK_SHADES = ['#43291a', '#62401f', '#82592f', '#3a0f14'] as const;
const BOTTLE_SHADES = ['#1f3a26', '#3a2614', '#b9d6c0', '#62401f'] as const;
const SPEAR_SHADES = ['#5b4029', '#62401f', '#5a4031', '#7d5537'] as const;
const STONE_SHADES = ['#4e483e', '#6c6555', '#8a826e', '#a59d85'] as const;
const BEAM_SHADES = ['#3d3027', '#56463a', '#6f5d4d', '#887563'] as const;
const WAX_SHADES = ['#b4a272', '#d4c493', '#ebdfb4'] as const;
const FUNGUS_SHADES = ['#2f4a44', '#4f7d70', '#9df0d8'] as const;

const TALL_SPLINTER_OFFSET = -0.25;
const TALL_SPLINTER_SPAN = 0.8;
const LOW_SPLINTER_OFFSET = 0;
const LOW_SPLINTER_SPAN = 0.3;
const FLOOR_SPLINTER_OFFSET = 0.15;
const FLOOR_SPLINTER_SPAN = 0.1;

/** Fired clay: one good swing cracks it, the second finishes it. */
const URN_HP = 3;
const SACK_HP = 4;
/** A full cask is a lot of oak and iron. */
const CASK_HP = 9;
const BOTTLE_RACK_HP = 5;
const TABLE_HP = 7;
const SPEAR_RACK_HP = 5;
const RUBBLE_HP = 8;
/** Twice the stone of a heap. */
const RUBBLE_SLOPE_HP = 12;
const BEAM_HP = 8;
/** Anything knocks a candle over. */
const CANDLE_HP = 1;
/** A single blow squashes a fungus. */
const FUNGUS_HP = 1;

export const CELLAR_PROP_KINDS: Readonly<Record<CellarBreakableKind, CellarPropKindDef>> = {
  clay_urn: {
    tileType: CLAY_URN,
    hp: URN_HP,
    materials: ['clay'],
    smashCue: 'trash',
    contents: URN_CONTENTS,
    spill: 'grain',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: CLAY_SHADES,
  },
  grain_sack: {
    tileType: GRAIN_SACK,
    hp: SACK_HP,
    materials: ['cloth'],
    smashCue: 'trash',
    contents: SACK_CONTENTS,
    spill: 'grain',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: BURLAP_SHADES,
  },
  wine_cask: {
    tileType: WINE_CASK,
    hp: CASK_HP,
    materials: ['wood', 'metal'],
    smashCue: 'wood',
    contents: LOOSE_CHANGE,
    spill: 'wine',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: CASK_SHADES,
  },
  bottle_rack: {
    tileType: BOTTLE_RACK,
    hp: BOTTLE_RACK_HP,
    materials: ['glass', 'wood'],
    smashCue: 'trash',
    contents: LOOSE_CHANGE,
    spill: 'wine',
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: BOTTLE_SHADES,
  },
  cellar_table: {
    tileType: CELLAR_TABLE,
    hp: TABLE_HP,
    materials: ['wood', 'wax'],
    smashCue: 'wood',
    contents: TABLE_CONTENTS,
    spill: null,
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: OAK_SHADES,
  },
  spear_rack: {
    tileType: SPEAR_RACK,
    hp: SPEAR_RACK_HP,
    materials: ['wood', 'metal'],
    smashCue: 'wood',
    contents: NO_CONTENTS,
    spill: null,
    splinterOffsetTiles: TALL_SPLINTER_OFFSET,
    splinterSpanTiles: TALL_SPLINTER_SPAN,
    splinterShades: SPEAR_SHADES,
  },
  rubble_heap: {
    tileType: RUBBLE_HEAP,
    hp: RUBBLE_HP,
    materials: ['stone'],
    smashCue: 'iron',
    contents: RUBBLE_CONTENTS,
    spill: 'dust',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: STONE_SHADES,
  },
  rubble_slope: {
    tileType: RUBBLE_SLOPE,
    hp: RUBBLE_SLOPE_HP,
    materials: ['stone'],
    smashCue: 'iron',
    contents: RUBBLE_CONTENTS,
    spill: 'dust',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: STONE_SHADES,
  },
  fallen_beam: {
    tileType: FALLEN_BEAM,
    hp: BEAM_HP,
    materials: ['wood'],
    smashCue: 'wood',
    contents: NO_CONTENTS,
    spill: 'dust',
    splinterOffsetTiles: LOW_SPLINTER_OFFSET,
    splinterSpanTiles: LOW_SPLINTER_SPAN,
    splinterShades: BEAM_SHADES,
  },
  candle_cluster: {
    tileType: CANDLE_CLUSTER,
    hp: CANDLE_HP,
    materials: ['wax'],
    smashCue: 'trash',
    contents: NO_CONTENTS,
    spill: 'wax',
    splinterOffsetTiles: FLOOR_SPLINTER_OFFSET,
    splinterSpanTiles: FLOOR_SPLINTER_SPAN,
    splinterShades: WAX_SHADES,
  },
  glow_fungus: {
    tileType: GLOW_FUNGUS,
    hp: FUNGUS_HP,
    // The material list has nothing organic; a fungus bursts soft and
    // quiet, which is cloth's break rather than any hard material's.
    materials: ['cloth'],
    smashCue: 'trash',
    contents: NO_CONTENTS,
    spill: 'slime',
    splinterOffsetTiles: FLOOR_SPLINTER_OFFSET,
    splinterSpanTiles: FLOOR_SPLINTER_SPAN,
    splinterShades: FUNGUS_SHADES,
  },
};

/** Whether a kind name is one of the cellars'. */
export function isCellarPropKind(kind: string): kind is CellarBreakableKind {
  return kind in CELLAR_PROP_KINDS;
}

/** The cellar kind standing on a tile of this type, or null. */
export function cellarPropKindForTileType(type: number): CellarBreakableKind | null {
  for (const [kind, def] of Object.entries(CELLAR_PROP_KINDS)) {
    if (def.tileType === type && isCellarPropKind(kind)) return kind;
  }
  return null;
}

/** Every cellar kind. */
export const CELLAR_PROP_KIND_LIST: ReadonlyArray<CellarBreakableKind> =
  Object.keys(CELLAR_PROP_KINDS).filter(isCellarPropKind);

/** One value per cellar kind, built from its definition. */
export function perCellarKind<T>(
  value: (def: CellarPropKindDef) => T,
): Record<CellarBreakableKind, T> {
  const k = CELLAR_PROP_KINDS;
  return {
    clay_urn: value(k.clay_urn),
    grain_sack: value(k.grain_sack),
    wine_cask: value(k.wine_cask),
    bottle_rack: value(k.bottle_rack),
    cellar_table: value(k.cellar_table),
    spear_rack: value(k.spear_rack),
    rubble_heap: value(k.rubble_heap),
    rubble_slope: value(k.rubble_slope),
    fallen_beam: value(k.fallen_beam),
    candle_cluster: value(k.candle_cluster),
    glow_fungus: value(k.glow_fungus),
  };
}
