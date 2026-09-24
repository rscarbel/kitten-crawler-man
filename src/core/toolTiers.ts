import type { ItemId } from './ItemDefs';

/** What a tool gathers. Also the two harvest node families (`07`). */
export type ToolKind = 'axe' | 'pickaxe';

/** An index into a kind's tier table. 0 is the free starter tool. */
export type ToolTier = 0 | 1 | 2 | 3 | 4 | 5;

/** Free starter tier: Basic Axe / Basic Pickaxe. */
export const TOOL_TIER_BASIC: ToolTier = 0;
/** Hardened Axe / Hardened Pickaxe. */
export const TOOL_TIER_HARDENED: ToolTier = 1;
/** Lumberjack's Axe / Quarryman's Pick. */
export const TOOL_TIER_LONG_HAFT: ToolTier = 2;
/** Ratkin Forge Axe / Ratkin Forge Pick. */
export const TOOL_TIER_RATKIN_FORGE: ToolTier = 3;
/** Deepwood Cleaver / Stonebreaker. */
export const TOOL_TIER_DEEPWOOD: ToolTier = 4;
/** Graveyard's Bane / Worldscar Pick, the top tier. */
export const TOOL_TIER_GRAVEYARD: ToolTier = 5;

/** Highest valid {@link ToolTier}, for loops and upgrade-cap checks. */
export const MAX_TOOL_TIER: ToolTier = TOOL_TIER_GRAVEYARD;

/** Narrows a number to a {@link ToolTier}. */
export function isToolTier(n: number): n is ToolTier {
  return Number.isInteger(n) && n >= 0 && n <= MAX_TOOL_TIER;
}

/** One rung of a tool kind's upgrade ladder. */
export interface ToolTierDef {
  readonly id: ItemId;
  readonly name: string;
  readonly description: string;
  /** Coin price at the forge. The starter tier (0) costs nothing. */
  readonly costCoins: number;
  /** Multiplier applied to a harvest tick's yield. */
  readonly efficiency: number;
}

/**
 * Every axe and pickaxe tier, transcribed once from the source data so
 * `ITEM_DEF` and the forge shop both read the same numbers.
 */
export const TOOL_TIERS: Record<ToolKind, readonly ToolTierDef[]> = {
  axe: [
    {
      id: 'basic_axe',
      name: 'Basic Axe',
      description:
        'A simple iron-headed axe made for everyday woodcutting. Nothing fancy, but sturdy enough to bring down the trees around Briar Hollow.',
      costCoins: 0,
      efficiency: 1.0,
    },
    {
      id: 'hardened_axe',
      name: 'Hardened Axe',
      description:
        'A professionally sharpened axe with a hardened steel edge. It bites deeper into timber and stays sharp considerably longer than a basic tool.',
      costCoins: 250,
      efficiency: 1.5,
    },
    {
      id: 'lumberjacks_axe',
      name: "Lumberjack's Axe",
      description:
        'A long-handled felling axe designed to make every swing count. The broad, razor-sharp head cuts through thick trunks with surprising speed.',
      costCoins: 750,
      efficiency: 2.0,
    },
    {
      id: 'ratkin_forge_axe',
      name: 'Ratkin Forge Axe',
      description:
        'A masterwork axe forged by a Ratkin smith who understands exactly how to turn a small frame into a powerful swing. Its strange balance makes it exceptionally efficient in practiced hands.',
      costCoins: 2000,
      efficiency: 3.0,
    },
    {
      id: 'deepwood_cleaver',
      name: 'Deepwood Cleaver',
      description:
        'A formidable felling axe made from exceptional steel and fitted with a reinforced haft. Each swing tears through timber with far less wasted effort than an ordinary axe.',
      costCoins: 5000,
      efficiency: 4.0,
    },
    {
      id: 'graveyards_bane',
      name: "Graveyard's Bane",
      description:
        "A legendary-looking blacksmith's axe whose edge has been honed to an almost absurd sharpness. Oren refuses to explain the name and insists that it is still, technically, a woodcutting tool.",
      costCoins: 12000,
      efficiency: 6.0,
    },
  ],
  pickaxe: [
    {
      id: 'basic_pickaxe',
      name: 'Basic Pickaxe',
      description:
        'A plain iron pickaxe with a solid wooden handle. It can break the exposed rock around the village, though your arms will be doing most of the work.',
      costCoins: 0,
      efficiency: 1.0,
    },
    {
      id: 'hardened_pickaxe',
      name: 'Hardened Pickaxe',
      description:
        'A reinforced pickaxe forged with a hardened steel head. Its weight and shape are balanced to crack stubborn stone with fewer strikes.',
      costCoins: 250,
      efficiency: 1.5,
    },
    {
      id: 'quarrymans_pick',
      name: "Quarryman's Pick",
      description:
        'A heavy quarry pick built for breaking stone rather than merely chipping it. Its reinforced head and weight make short work of large deposits.',
      costCoins: 750,
      efficiency: 2.0,
    },
    {
      id: 'ratkin_forge_pick',
      name: 'Ratkin Forge Pick',
      description:
        'A masterwork mining pick built for speed and precision. The unusually shaped head concentrates force into a narrow point, splitting stone with remarkable efficiency.',
      costCoins: 2000,
      efficiency: 3.0,
    },
    {
      id: 'stonebreaker',
      name: 'Stonebreaker',
      description:
        'A brutal, beautifully balanced mining pick intended for the hardest rock. The head is dense enough to shatter stone rather than simply dent it.',
      costCoins: 5000,
      efficiency: 4.0,
    },
    {
      id: 'worldscar_pick',
      name: 'Worldscar Pick',
      description:
        'An extraordinary pick forged for extracting material from dungeon-hardened stone. It feels almost too heavy at first, until you realize the tool is doing most of the work for you.',
      costCoins: 12000,
      efficiency: 6.0,
    },
  ],
};

/** Looks up a tier's data by kind and tier index. */
export function toolTierDef(kind: ToolKind, tier: ToolTier): ToolTierDef {
  return TOOL_TIERS[kind][tier];
}

/** Colours the tool icon painter and the in-world tool overlay share for a given tier. */
export interface ToolTierLook {
  readonly headColor: string;
  readonly edgeColor: string;
  readonly hafColor: string;
  readonly accent?: string;
  /** Tier 2's long-handled variants (Lumberjack's Axe, Quarryman's Pick). */
  readonly longHaft?: boolean;
  /** Tier 5's faint soul-green glow line along the edge. */
  readonly glow?: string;
}

/** Per-tier look, keyed by {@link ToolTier} so both tool kinds share one table. */
export const TOOL_TIER_LOOKS: Record<ToolTier, ToolTierLook> = {
  0: {
    headColor: '#8c8c88',
    edgeColor: '#a8a8a4',
    hafColor: '#7a5a3a',
  },
  1: {
    headColor: '#3d4a5c',
    edgeColor: '#dde6ef',
    hafColor: '#6b4a30',
  },
  2: {
    headColor: '#4a4c50',
    edgeColor: '#c7cbd0',
    hafColor: '#79542f',
    longHaft: true,
  },
  3: {
    headColor: '#a9722f',
    edgeColor: '#d9a24a',
    hafColor: '#5a3d22',
    accent: '#6b8f3f',
  },
  4: {
    headColor: '#1c2420',
    edgeColor: '#39443c',
    hafColor: '#4a3826',
    accent: '#1f6b52',
  },
  5: {
    headColor: '#2a2a2e',
    edgeColor: '#f2efe6',
    hafColor: '#3a3a3e',
    glow: '#39ff8c',
  },
};
