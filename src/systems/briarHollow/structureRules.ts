/**
 * The Construction numbers, as pure data and pure functions: what every
 * palisade tier, trebuchet, snare and set of spikes costs, how long it takes,
 * how much it can take, and what repairing it costs.
 *
 * Nothing here reads the world. `DefenseStructures` applies these rules to the
 * village's saved state and `ConstructionSystem` applies them to a job; keeping
 * the arithmetic apart is what lets `verify:construction` hold every table to
 * its numbers without building a map.
 */

import type { ResourceCost } from '../../core/partyResources';
import { applyDiscount } from '../../core/partyResources';
import { RESOURCE_IDS } from '../../core/resourceIds';
import {
  constructionDiscount,
  constructionHpMultiplier,
  constructionTimeFactor,
} from '../../core/craftPerks';
import { CONSTRUCTION_XP_PER_WOODEN_WALL } from '../../core/CraftSkills';
import type { PalisadeTier } from '../../map/tileTypes';

/** The fixed-step loop runs sixty updates a second; every timer below is counted in them. */
export const UPDATES_PER_SECOND = 60;

// ── Palisade tiers ──────────────────────────────────────────────────────────

export interface WallTierSpec {
  /**
   * Max HP for a segment {@link HP_REFERENCE_SEGMENT_TILES} tiles long, before
   * the builder's level-15 multiplier. Use {@link wallSegmentHp} rather than
   * this field directly — a real segment is rarely that exact length.
   */
  readonly baseHp: number;
  /** What it costs to raise a segment to this tier, or null for the fence it starts as. */
  readonly upgradeCost: ResourceCost | null;
  /** Seconds the raise takes at Construction level 1. */
  readonly buildSeconds: number;
  /** One "chunk" of repair (a fifth of the wall), or null for a tier that is never repaired. */
  readonly repairChunkCost: ResourceCost | null;
  /** Seconds a repair takes at Construction level 1, however many chunks it restores. */
  readonly repairSeconds: number;
  /** Player-facing name, as the menus print it. */
  readonly label: string;
}

/**
 * A fence has one hit point on purpose: it is the flimsy hurdle the village
 * starts with, which any blow flattens, and it exists to be upgraded.
 */
export const FENCE_HP = 1;

export const WALL_TIERS: Readonly<Record<PalisadeTier, WallTierSpec>> = {
  fence: {
    baseHp: FENCE_HP,
    upgradeCost: null,
    buildSeconds: 0,
    repairChunkCost: null,
    repairSeconds: 0,
    label: 'Wattle Fence',
  },
  wood: {
    baseHp: 150,
    upgradeCost: { wood_board: 5 },
    buildSeconds: 3,
    repairChunkCost: { wood_board: 1 },
    repairSeconds: 1.5,
    label: 'Wooden Wall',
  },
  stone: {
    baseHp: 450,
    upgradeCost: { stone: 5 },
    buildSeconds: 4,
    repairChunkCost: { stone: 1 },
    repairSeconds: 2,
    label: 'Stone Wall',
  },
  fortified: {
    baseHp: 1000,
    upgradeCost: { stone: 8, wood_board: 2 },
    buildSeconds: 5,
    repairChunkCost: { stone: 2 },
    repairSeconds: 2.5,
    label: 'Fortified Stone Wall',
  },
};

/** The tier each tier upgrades to; a fortified wall is the top. */
export const NEXT_WALL_TIER: Readonly<Record<PalisadeTier, PalisadeTier | null>> = {
  fence: 'wood',
  wood: 'stone',
  stone: 'fortified',
  fortified: null,
};

/** The segment length {@link WallTierSpec.baseHp} is tuned against. */
const HP_REFERENCE_SEGMENT_TILES = 3;

/**
 * A tier's HP for a real segment: a wall is priced, timed and repaired the
 * same regardless of how long the ring cuts it, but a segment's toughness has
 * to track its length, or cutting the ring into fewer, longer runs would leave
 * every tile of it thinner than the tier's number promises — the same total
 * HP now standing between a hostile and four times the frontage.
 */
export function wallSegmentHp(tier: PalisadeTier, tileCount: number): number {
  return (WALL_TIERS[tier].baseHp * tileCount) / HP_REFERENCE_SEGMENT_TILES;
}

// ── Repair chunks ───────────────────────────────────────────────────────────

/** A repair is priced per started fifth of the structure's max HP. */
export const REPAIR_CHUNKS_PER_FULL_REPAIR = 5;

/**
 * Keeps float noise from charging an extra chunk: 30 missing of 150 is exactly
 * one fifth, and must cost one chunk, not two.
 */
const CHUNK_EPSILON = 1e-9;

/**
 * How many chunks restoring `missingHp` of `maxHp` costs: one per started 20%,
 * so a scratch costs one chunk and a wall at zero costs five.
 */
export function repairChunks(missingHp: number, maxHp: number): number {
  if (missingHp <= 0 || maxHp <= 0) return 0;
  const fifths = (missingHp * REPAIR_CHUNKS_PER_FULL_REPAIR) / maxHp;
  return Math.min(REPAIR_CHUNKS_PER_FULL_REPAIR, Math.ceil(fifths - CHUNK_EPSILON));
}

/** Every line of `unit` multiplied by `count`; a zero count costs nothing. */
export function scaleCost(unit: ResourceCost, count: number): ResourceCost {
  const scaled: ResourceCost = {};
  if (count <= 0) return scaled;
  for (const id of RESOURCE_IDS) {
    const amount = unit[id];
    if (amount !== undefined && amount > 0) scaled[id] = amount * count;
  }
  return scaled;
}

/** `cost`, with every line held to at most the same line of `cap`. A line `cap` lacks is dropped. */
export function capCost(cost: ResourceCost, cap: ResourceCost): ResourceCost {
  const capped: ResourceCost = {};
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    const ceiling = cap[id];
    if (amount === undefined || ceiling === undefined) continue;
    const held = Math.min(amount, ceiling);
    if (held > 0) capped[id] = held;
  }
  return capped;
}

/** Whether a cost has no line left to pay. */
export function isFreeCost(cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= 0);
}

// ── Trebuchets and snares ───────────────────────────────────────────────────

/** A trebuchet's footprint, in the art's own orientation whichever way it was built facing. */
export const TREBUCHET_WIDTH_TILES = 2;
export const TREBUCHET_HEIGHT_TILES = 3;
export const TREBUCHET_BASE_HP = 100;
export const TREBUCHET_BUILD_COST: ResourceCost = { wood_board: 15, rope: 5 };
export const TREBUCHET_BUILD_SECONDS = 8;
export const TREBUCHET_REPAIR_SECONDS = 3;
/** One chunk of trebuchet repair, and the extra chunk a broken trebuchet owes for its snapped arm. */
export const TREBUCHET_REPAIR_UNIT: ResourceCost = { wood_board: 3, rope: 1 };
/** Stone a trebuchet's bucket holds. */
export const TREBUCHET_MAX_AMMO = 25;
/** How far a trebuchet reaches, in tiles. The firing itself lives with the trebuchet's own system. */
export const TREBUCHET_RANGE_TILES = 10;

/**
 * Snares hold enough HP that a blast or an undead's claws can wreck one, so
 * a trap line is something a siege wears down rather than something it ignores.
 */
export const SNARE_BASE_HP = 40;
export const SNARE_BUILD_COST: ResourceCost = { wood_board: 3, rope: 1 };
export const SNARE_BUILD_SECONDS = 2;
export const SNARE_REPAIR_SECONDS = 1;
export const SNARE_REPAIR_COST: ResourceCost = { wood_board: 1, rope: 1 };
/** How long a sprung snare holds whatever it caught. */
export const SNARE_HOLD_SECONDS = 10;
/**
 * Once a snare has been repaired, each later break has this chance of
 * wrecking it for good — the record is removed and the materials are lost.
 */
export const SNARE_PERMANENT_BREAK_CHANCE = 0.5;

/**
 * A trebuchet's repair bill: one unit for a snapped arm if it is broken, plus
 * one unit per started fifth of HP missing, never more on any line than
 * building a new one would cost. The Construction discount is applied after,
 * by whoever charges it.
 */
export function trebuchetRepairCost(hp: number, maxHp: number, broken: boolean): ResourceCost {
  const brokenUnits = broken ? 1 : 0;
  const units = brokenUnits + repairChunks(maxHp - hp, maxHp);
  return capCost(scaleCost(TREBUCHET_REPAIR_UNIT, units), TREBUCHET_BUILD_COST);
}

// ── Spikes ──────────────────────────────────────────────────────────────────

export const SPIKES_BASE_HP = 150;
export const SPIKES_COST: ResourceCost = { wood_board: 1 };
export const SPIKES_SECONDS = 1;

// ── Blasts ──────────────────────────────────────────────────────────────────

/** What one dynamite blast does to every structure it reaches; a wooden wall survives two. */
export const STRUCTURE_BLAST_DAMAGE = 60;

// ── Level scaling ───────────────────────────────────────────────────────────

/** Max HP for a structure whose builder is at `builderLevel`. */
export function scaledMaxHp(baseHp: number, builderLevel: number): number {
  return baseHp * constructionHpMultiplier(builderLevel);
}

/** Update frames a job takes for a builder at `builderLevel`. */
export function jobFrames(baseSeconds: number, builderLevel: number): number {
  return Math.max(
    1,
    Math.round(baseSeconds * UPDATES_PER_SECOND * constructionTimeFactor(builderLevel)),
  );
}

/** `cost` as a builder at `builderLevel` pays it. */
export function discountedCost(cost: ResourceCost, builderLevel: number): ResourceCost {
  return applyDiscount(cost, constructionDiscount(builderLevel));
}

// ── Construction XP ─────────────────────────────────────────────────────────

/**
 * Construction XP per job, as multiples of a wooden wall so the skill's level
 * landmarks (which are counted in wooden walls) stay in one place.
 */
const STONE_WALL_XP_RATIO = 1.4;
const FORTIFIED_WALL_XP_RATIO = 2.2;
const TREBUCHET_XP_RATIO = 4.5;
const SNARE_XP_RATIO = 0.8;
const SPIKES_XP_RATIO = 0.3;

export const CONSTRUCTION_XP = {
  woodenWall: CONSTRUCTION_XP_PER_WOODEN_WALL,
  stoneWall: Math.round(CONSTRUCTION_XP_PER_WOODEN_WALL * STONE_WALL_XP_RATIO),
  fortifiedWall: Math.round(CONSTRUCTION_XP_PER_WOODEN_WALL * FORTIFIED_WALL_XP_RATIO),
  trebuchet: Math.round(CONSTRUCTION_XP_PER_WOODEN_WALL * TREBUCHET_XP_RATIO),
  snare: Math.round(CONSTRUCTION_XP_PER_WOODEN_WALL * SNARE_XP_RATIO),
  spikes: Math.round(CONSTRUCTION_XP_PER_WOODEN_WALL * SPIKES_XP_RATIO),
} as const;

/** Build XP for raising a segment to `tier`; the fence is never built. */
export function wallTierXp(tier: PalisadeTier): number {
  switch (tier) {
    case 'fence':
      return 0;
    case 'wood':
      return CONSTRUCTION_XP.woodenWall;
    case 'stone':
      return CONSTRUCTION_XP.stoneWall;
    case 'fortified':
      return CONSTRUCTION_XP.fortifiedWall;
  }
}

/** A repair earns half the build XP, scaled by how much of the structure it put back. */
const REPAIR_XP_FRACTION = 0.5;

/** XP for a repair that restored `restoredFraction` (0–1) of a structure worth `buildXp`. Never less than 1. */
export function repairXp(buildXp: number, restoredFraction: number): number {
  const clamped = Math.max(0, Math.min(1, restoredFraction));
  return Math.max(1, Math.round(buildXp * clamped * REPAIR_XP_FRACTION));
}

// ── Damage stages ───────────────────────────────────────────────────────────

/** Intact, cracked, wrecked: the three looks a standing wall has between full and fallen. */
export const DAMAGE_STAGE_INTACT = 0;
export const DAMAGE_STAGE_CRACKED = 1;
export const DAMAGE_STAGE_WRECKED = 2;
/** The looks split a wall's health into equal thirds: whole, cracked, wrecked. */
const DAMAGE_LOOKS = DAMAGE_STAGE_WRECKED + 1;
const CRACKED_BELOW_FRACTION = (DAMAGE_LOOKS - 1) / DAMAGE_LOOKS;
const WRECKED_BELOW_FRACTION = 1 / DAMAGE_LOOKS;

/** Which of the three damage looks a structure at `hp` of `maxHp` wears. */
export function damageStageFor(hp: number, maxHp: number): number {
  if (maxHp <= 0) return DAMAGE_STAGE_INTACT;
  const fraction = hp / maxHp;
  if (fraction > CRACKED_BELOW_FRACTION) return DAMAGE_STAGE_INTACT;
  if (fraction > WRECKED_BELOW_FRACTION) return DAMAGE_STAGE_CRACKED;
  return DAMAGE_STAGE_WRECKED;
}
