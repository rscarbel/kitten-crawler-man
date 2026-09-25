/**
 * Pure functions of a craft skill's level. No state, no side effects — every
 * caller (harvesting, construction, the level-up dialog, the Crafts tab) reads
 * the same table.
 */

// ── Resourcing ───────────────────────────────────────────────────────────────

interface SpeedStepLevel {
  readonly level: number;
}

/** Levels at which Resourcing collection speed steps up by another 5%. */
const RESOURCING_SPEED_LEVELS: readonly SpeedStepLevel[] = [
  { level: 3 },
  { level: 6 },
  { level: 8 },
  { level: 11 },
  { level: 12 },
];

/** Fraction shaved off harvest time at each Resourcing speed level. */
export const RESOURCING_SPEED_STEP = 0.05;

/** Multiplier on harvest time at the given Resourcing level (1 = no speedup). */
export function resourcingSpeedFactor(level: number): number {
  const stepsReached = RESOURCING_SPEED_LEVELS.filter((step) => level >= step.level).length;
  return 1 - RESOURCING_SPEED_STEP * stepsReached;
}

interface CapacityBonusStep {
  readonly level: number;
  readonly bonus: number;
}

/** Resourcing levels at which the bonus to a node's harvest capacity increases, and its new value. */
const RESOURCING_CAPACITY_LEVELS: readonly CapacityBonusStep[] = [
  { level: 2, bonus: 1 },
  { level: 4, bonus: 2 },
  { level: 7, bonus: 3 },
  { level: 9, bonus: 5 },
  { level: 13, bonus: 10 },
];

/**
 * Extra harvests a freshly worked tree or rock holds before it is spent, at the
 * given Resourcing level. It lengthens the node's life; it never changes how
 * much one harvest awards.
 */
export function resourcingNodeCapacityBonus(level: number): number {
  let bonus = 0;
  for (const step of RESOURCING_CAPACITY_LEVELS) {
    if (level >= step.level) bonus = step.bonus;
  }
  return bonus;
}

/** Resourcing level at which every harvest yields double resources. */
export const RESOURCING_DOUBLE_YIELD_LEVEL = 15;

/** True once harvests yield double resources (Resourcing level 15). */
export function resourcingDoubles(level: number): boolean {
  return level >= RESOURCING_DOUBLE_YIELD_LEVEL;
}

/** Resourcing level at which a refined-material chance first appears. */
const REFINED_CHANCE_MIN_LEVEL = 5;
/** Resourcing level at which the refined-material chance becomes certain. */
const REFINED_CHANCE_MAX_LEVEL = 15;

/** Chance (0–1) a wood harvest at levels 5–14 also yields a refined material. */
export const REFINED_CHANCE_WOOD = 0.07;
/** Chance (0–1) a stone harvest at levels 5–14 also yields a refined material. */
export const REFINED_CHANCE_STONE = 0.04;

export type HarvestKind = 'wood' | 'stone';

/** Chance (0–1) a harvest of `kind` also grants a refined material, at the given Resourcing level. */
export function refinedChance(level: number, kind: HarvestKind): number {
  if (level >= REFINED_CHANCE_MAX_LEVEL) return 1;
  if (level < REFINED_CHANCE_MIN_LEVEL) return 0;
  return kind === 'wood' ? REFINED_CHANCE_WOOD : REFINED_CHANCE_STONE;
}

/** Resourcing level at which a harvest can roll a fully formed trap kit instead of a refined material. */
export const TRAP_KIT_MIN_LEVEL = 14;

/** Chance (0–1) a qualifying harvest rolls a trebuchet kit instead. */
export const TREBUCHET_KIT_CHANCE = 0.01;
/** Chance (0–1) a qualifying harvest rolls a snare kit instead. */
export const SNARE_KIT_CHANCE = 0.05;

export interface TrapKitChances {
  treb: number;
  snare: number;
}

/** Chances (0–1 each) a harvest at the given Resourcing level rolls a trap kit, checked before the refined-material roll. */
export function trapKitChances(level: number): TrapKitChances {
  if (level < TRAP_KIT_MIN_LEVEL) return { treb: 0, snare: 0 };
  return { treb: TREBUCHET_KIT_CHANCE, snare: SNARE_KIT_CHANCE };
}

/** Resourcing level at which a harvesting thrall can first be summoned. */
const THRALL_MIN_LEVEL = 10;
/** Resourcing level at which summoning grants three thralls instead of one. */
const THRALL_TRIPLE_LEVEL = 15;
/** Thralls summoned at once once {@link THRALL_TRIPLE_LEVEL} is reached. */
const THRALL_TRIPLE_COUNT = 3;

/** Number of harvesting thralls the given Resourcing level can summon at once. */
export function thrallCount(level: number): number {
  if (level >= THRALL_TRIPLE_LEVEL) return THRALL_TRIPLE_COUNT;
  if (level >= THRALL_MIN_LEVEL) return 1;
  return 0;
}

// ── Construction ─────────────────────────────────────────────────────────────

/** Fraction shaved off construct/repair time per Construction level above 1, additive. */
export const CONSTRUCTION_SPEED_STEP_PER_LEVEL = 0.05;

/** Multiplier on construct/repair time at the given Construction level (1 = no speedup). */
export function constructionTimeFactor(level: number): number {
  return 1 - CONSTRUCTION_SPEED_STEP_PER_LEVEL * (level - 1);
}

/** Construction level at which resource costs drop by 1 per line. */
const CONSTRUCTION_DISCOUNT_TIER_1_LEVEL = 10;
/** Construction level at which resource costs drop by 2 per line. */
const CONSTRUCTION_DISCOUNT_TIER_2_LEVEL = 14;

/** Flat units knocked off every resource line of a build cost, at the given Construction level. */
export function constructionDiscount(level: number): number {
  if (level >= CONSTRUCTION_DISCOUNT_TIER_2_LEVEL) return 2;
  if (level >= CONSTRUCTION_DISCOUNT_TIER_1_LEVEL) return 1;
  return 0;
}

/** Construction level at which spiked upgrades unlock. */
export const SPIKES_UNLOCK_LEVEL = 5;

/** True once spiked upgrades can be added to a construction, at the given Construction level. */
export function spikesUnlocked(level: number): boolean {
  return level >= SPIKES_UNLOCK_LEVEL;
}

/** Construction level at which built structures' max HP doubles. */
export const CONSTRUCTION_HP_DOUBLE_LEVEL = 15;
/** HP multiplier applied to a structure once its builder reaches {@link CONSTRUCTION_HP_DOUBLE_LEVEL}. */
export const CONSTRUCTION_HP_MULTIPLIER = 2;

/**
 * HP multiplier for a structure, keyed to its builder's Construction level
 * (not the acting crawler's — a structure keeps the perk of whoever built it).
 */
export function constructionHpMultiplier(level: number): number {
  return level >= CONSTRUCTION_HP_DOUBLE_LEVEL ? CONSTRUCTION_HP_MULTIPLIER : 1;
}

/** Construction level at which ammo for constructed materials becomes unlimited. */
export const UNLIMITED_AMMO_LEVEL = 15;

/** True once ammo for constructed materials is unlimited, at the given Construction level. */
export function unlimitedAmmo(level: number): boolean {
  return level >= UNLIMITED_AMMO_LEVEL;
}

/** Construction level at which trebuchets imbue their projectiles with fire and a lingering gas cloud. */
export const INFERNAL_TREBUCHET_LEVEL = 15;

/** True once trebuchets fire infernal projectiles, at the given Construction level. */
export function infernalTrebuchets(level: number): boolean {
  return level >= INFERNAL_TREBUCHET_LEVEL;
}

/** Construction level at which snares gain a chance to convert an enemy into an ally. */
export const SNARE_CONVERT_LEVEL = 15;
/** Chance (0–1) a snare converts an enemy into an ally, once {@link SNARE_CONVERT_LEVEL} is reached. */
export const SNARE_CONVERT_CHANCE = 0.5;

/** Chance (0–1) a snare converts a non-boss enemy into an ally, at the given Construction level. */
export function snareConvertChance(level: number): number {
  return level >= SNARE_CONVERT_LEVEL ? SNARE_CONVERT_CHANCE : 0;
}

// ── Player-facing descriptions ────────────────────────────────────────────────
//
// Every string below quotes the wording of the original per-level perk lists,
// only lightly smoothed for grammar and with the source's own bracketed
// clarifications folded into the sentence.

/** One level's player-facing perk text: what the level-up dialog shows on ding, and what the Crafts tab lists as an unlock. */
export interface PerkUnlock {
  readonly level: number;
  readonly text: string;
}

const NO_PERK_TEXT = 'No perk at this level.';

const RESOURCING_PERK_ROWS: readonly PerkUnlock[] = [
  { level: 1, text: 'Players can collect wood and stone with the right tools.' },
  {
    level: 2,
    text: 'Resources yield more harvest before expiring',
  },
  { level: 3, text: 'Resource collection is faster.' },
  {
    level: 4,
    text: 'Resources yield more harvest before expiring',
  },
  {
    level: 5,
    text: 'There is a chance a harvest will yield a refined material in addition to the resource.',
  },
  { level: 6, text: 'Resource collection is faster.' },
  {
    level: 7,
    text: 'Resources yield more harvest before expiring',
  },
  { level: 8, text: 'Resource collection is faster.' },
  {
    level: 9,
    text: 'Resources yield more harvest before expiring',
  },
  {
    level: 10,
    text: 'A ghostly thrall can be summoned to harvest on your behalf; by right-clicking or long-pressing the axe or the pickaxe, a "summon" option appears, causing a translucent ghostly axeman or pickaxeman to appear and start harvesting the appropriate resources at the same rate as the player. The thralls do not get the level-5 bonus of a refined material. Collected resources automatically appear in the player\'s inventory.',
  },
  { level: 11, text: 'Resource collection is faster.' },
  { level: 12, text: 'Resource collection is faster.' },
  {
    level: 13,
    text: 'Resources yield more harvest before expiring',
  },
  {
    level: 14,
    text: 'There is a chance of getting a fully formed trap from harvesting a resource.',
  },
  {
    level: 15,
    text: 'All harvests yield double the resources. In addition, there is now a 100% chance that there will be an additional refined material granted. Finally, summoning a helper thrall summons three of them now.',
  },
];

const CONSTRUCTION_PERK_ROWS: readonly PerkUnlock[] = [
  { level: 1, text: 'Construction is unlocked.' },
  { level: 2, text: 'Constructing and repairing is faster.' },
  { level: 3, text: 'Constructing and repairing is faster.' },
  { level: 4, text: 'Constructing and repairing is faster.' },
  {
    level: 5,
    text: 'Constructing and repairing is faster. The player unlocks the ability to add spikes to their constructions.',
  },
  { level: 6, text: 'Constructing and repairing is faster.' },
  { level: 7, text: 'Constructing and repairing is faster.' },
  { level: 8, text: 'Constructing and repairing is faster.' },
  { level: 9, text: 'Constructing and repairing is faster.' },
  {
    level: 10,
    text: 'Constructing and repairing is faster. The cost of every resource goes down by 1.',
  },
  { level: 11, text: 'Constructing and repairing is faster.' },
  { level: 12, text: 'Constructing and repairing is faster.' },
  { level: 13, text: 'Constructing and repairing is faster.' },
  {
    level: 14,
    text: 'Constructing and repairing is faster. The cost of every resource goes down by 2.',
  },
  {
    level: 15,
    text: 'Constructing and repairing is faster. All ammo is unlimited for any constructed materials, and the health of all things the player constructs is doubled. Additionally, trebuchets now magically imbue their projectiles with a flame that burns enemies and a lingering gas cloud that does damage over time to enemies and slows them down. Snare traps now have a chance to convert non-boss enemies into an ally instead of trapping or damaging them.',
  },
];

function perkAtLevel(rows: readonly PerkUnlock[], level: number): string {
  const row = rows.find((candidate) => candidate.level === level);
  return row?.text ?? NO_PERK_TEXT;
}

function nextUnlock(rows: readonly PerkUnlock[], level: number): PerkUnlock | null {
  const row = rows.find((candidate) => candidate.level > level);
  return row ?? null;
}

/** Player-facing text for the Resourcing perk unlocked at `level`, for the level-up dialog. */
export function describeResourcingPerk(level: number): string {
  return perkAtLevel(RESOURCING_PERK_ROWS, level);
}

/** Player-facing text for the Construction perk unlocked at `level`, for the level-up dialog. */
export function describeConstructionPerk(level: number): string {
  return perkAtLevel(CONSTRUCTION_PERK_ROWS, level);
}

/** The next Resourcing perk still to unlock above `level`, or `null` once maxed, for the Crafts tab's "next unlock" line. */
export function nextResourcingUnlock(level: number): PerkUnlock | null {
  return nextUnlock(RESOURCING_PERK_ROWS, level);
}

/** The next Construction perk still to unlock above `level`, or `null` once maxed, for the Crafts tab's "next unlock" line. */
export function nextConstructionUnlock(level: number): PerkUnlock | null {
  return nextUnlock(CONSTRUCTION_PERK_ROWS, level);
}
