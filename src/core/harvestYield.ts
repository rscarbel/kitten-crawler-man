/**
 * The arithmetic of one harvest tick: how long it takes, how much it yields,
 * what lucky extra it may turn up, and how much Resourcing XP it is worth.
 *
 * Pure functions of their arguments, so the gathering system, the thralls and
 * the verification script all run the same numbers. Every perk here is read
 * at the level passed in — the harvesting crawler's own, never a party-wide
 * figure, because craft skills are never shared.
 */

import {
  type HarvestKind,
  refinedChance,
  resourcingDoubles,
  resourcingSpeedFactor,
  trapKitChances,
} from './craftPerks';
import { RESOURCING_XP_PER_BASIC_HARVEST, THRALL_XP_FRACTION } from './CraftSkills';
import type { ItemId } from './ItemDefs';
import type { ResourceId } from './resourceIds';
import type { ToolKind } from './toolTiers';

/** Seconds between wood awards at Resourcing speed factor 1 and no tool speed bonus. */
export const WOOD_HARVEST_INTERVAL_SECONDS = 1.5;
/** Seconds between stone awards at Resourcing speed factor 1 and no tool speed bonus. */
export const STONE_HARVEST_INTERVAL_SECONDS = 2.75;

/** The fixed update rate harvest intervals are counted in, so a doubled `Scene.loop` catch-up cannot speed them up. */
const HARVEST_TICKS_PER_SECOND = 60;

/** Which node family a tool works. */
export function harvestKindForTool(tool: ToolKind): HarvestKind {
  return tool === 'axe' ? 'wood' : 'stone';
}

/** Which tool a node family needs. */
export function toolForHarvestKind(kind: HarvestKind): ToolKind {
  return kind === 'wood' ? 'axe' : 'pickaxe';
}

/** The raw resource a node family yields. */
export function resourceForHarvestKind(kind: HarvestKind): ResourceId {
  return kind === 'wood' ? 'wood' : 'stone';
}

/**
 * The share of the base harvest interval one award takes for a harvester at
 * `level` carrying a tool with `toolSpeedBonus` — and, by the same token, the
 * share of a node's capacity that award spends.
 *
 * Both readers go through this one function so speed and node health cannot
 * drift apart: a node's capacity is counted in base-speed harvests, so a
 * faster harvester lands more awards on it but spends less of it per award,
 * and a tree or rock lasts the same wall-clock time at every tool tier and
 * Resourcing level.
 *
 * The tool's speed bonus stacks additively with Resourcing's own speed steps
 * rather than multiplying with them: `resourcingSpeedFactor` is already
 * `1 - skillBonus`, so subtracting the tool's bonus from it gives
 * `1 - skillBonus - toolBonus` directly.
 */
export function harvestTimeFactor(level: number, toolSpeedBonus: number): number {
  return resourcingSpeedFactor(level) - toolSpeedBonus;
}

/**
 * Seconds between awards on a node of `kind` for a harvester at `level`,
 * carrying a tool with `toolSpeedBonus`.
 */
export function harvestIntervalSeconds(
  kind: HarvestKind,
  level: number,
  toolSpeedBonus: number,
): number {
  const base = kind === 'wood' ? WOOD_HARVEST_INTERVAL_SECONDS : STONE_HARVEST_INTERVAL_SECONDS;
  return base * harvestTimeFactor(level, toolSpeedBonus);
}

/**
 * How much of a node's capacity one crawler award spends. See
 * {@link harvestTimeFactor}: it is exactly that factor, so the node's
 * wall-clock life is independent of harvest speed.
 */
export function harvestNodeWork(level: number, toolSpeedBonus: number): number {
  return harvestTimeFactor(level, toolSpeedBonus);
}

/**
 * {@link harvestIntervalSeconds} in fixed update ticks. Deliberately not
 * rounded: a channel accumulates ticks and subtracts this, so 85.5 ticks
 * really does award twice every 171 ticks rather than drifting to 85 or 86.
 */
export function harvestIntervalTicks(
  kind: HarvestKind,
  level: number,
  toolSpeedBonus: number,
): number {
  return harvestIntervalSeconds(kind, level, toolSpeedBonus) * HARVEST_TICKS_PER_SECOND;
}

/** One tick's award and the fractional remainder carried into the next. */
export interface HarvestAward {
  readonly amount: number;
  readonly carry: number;
}

/**
 * Units awarded by one harvest tick.
 *
 * The tool's yield multiplier scales each action, and a fractional multiplier
 * is not rounded away: the remainder is carried to the next tick, so a 1.5×
 * multiplier yields 1, 2, 1, 2 … rather than always 1. The level-15 doubling
 * applies to the whole units.
 */
export function harvestAward(yieldMultiplier: number, carry: number, level: number): HarvestAward {
  const raw = yieldMultiplier + carry;
  const base = Math.floor(raw);
  const amount = resourcingDoubles(level) ? base * 2 : base;
  return { amount, carry: raw - base };
}

/** Resourcing XP one crawler harvest is worth: better tools train faster in proportion to what they gather. */
export function harvestXp(yieldMultiplier: number): number {
  return RESOURCING_XP_PER_BASIC_HARVEST * yieldMultiplier;
}

/** Resourcing XP a summoner earns when a thrall performs the same harvest. */
export function thrallHarvestXp(yieldMultiplier: number): number {
  return harvestXp(yieldMultiplier) * THRALL_XP_FRACTION;
}

/** Something extra a lucky harvest tick turns up. */
export type LuckyDrop = Extract<
  ItemId,
  'trebuchet_kit' | 'snare_kit' | 'wood_board' | 'rope' | 'goblin_dynamite'
>;

/** A refined wood drop is a board or a rope, evenly. */
const REFINED_WOOD_BOARD_SHARE = 0.5;

/**
 * Rolls a crawler harvest's luck: a trap kit first (treb, then snare), and
 * only if neither lands, the refined material. Each roll draws from `rng`
 * whether or not its chance is zero, so a level change never shifts which
 * draw a later roll sees. Thralls never call this.
 */
export function rollHarvestLuck(
  level: number,
  kind: HarvestKind,
  rng: () => number,
): LuckyDrop | null {
  const kits = trapKitChances(level);
  if (rng() < kits.treb) return 'trebuchet_kit';
  if (rng() < kits.snare) return 'snare_kit';
  if (rng() >= refinedChance(level, kind)) return null;
  if (kind === 'stone') return 'goblin_dynamite';
  return rng() < REFINED_WOOD_BOARD_SHARE ? 'wood_board' : 'rope';
}
