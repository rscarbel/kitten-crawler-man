/**
 * Party-wide craft progress that is neither tool state alone nor a
 * per-crawler skill: the shared tool tiers plus which crafting explainers the
 * party has already been shown. Saved as `GameProgress.crafts`, alongside the
 * party rather than either crawler, because both halves are shared —
 * upgrading a tool updates both inventories, and an explainer shown to one
 * crawler should never replay for the other.
 */

import { isRecord } from './guards';
import type { CraftSkillId } from './CraftSkills';
import { isCraftSkillId } from './CraftSkills';
import { createPartyToolsState, parsePartyToolsState, type PartyToolsState } from './PartyTools';
import type { CrawlerKind } from './SkillManager';

/** Whether resourcing thralls join automatically when a crawler starts harvesting, keyed per crawler. */
export type AutoSummonThralls = Record<CrawlerKind, boolean>;

function defaultAutoSummonThralls(): AutoSummonThralls {
  return { human: true, cat: true };
}

export interface PartyCraftsState {
  tools: PartyToolsState;
  /** Craft skills whose "how it works" explainer has already played. */
  explainersSeen: CraftSkillId[];
  /** The auto-summon toggle from the axe/pickaxe context menu, on by default. */
  autoSummonThralls: AutoSummonThralls;
}

export function createPartyCraftsState(): PartyCraftsState {
  return {
    tools: createPartyToolsState(),
    explainersSeen: [],
    autoSummonThralls: defaultAutoSummonThralls(),
  };
}

/** A value-equal copy, safe to hand to a checkpoint that must not alias the live object. */
export function clonePartyCraftsState(state: PartyCraftsState): PartyCraftsState {
  return {
    tools: { ...state.tools },
    explainersSeen: [...state.explainersSeen],
    autoSummonThralls: { ...state.autoSummonThralls },
  };
}

/**
 * Mutates `target` in place: the same `PartyCraftsState` object is threaded by
 * reference through every scene, so rebinding a fresh one would strand every
 * holder still pointing at the old one.
 */
export function restorePartyCraftsState(
  target: PartyCraftsState,
  snapshot: PartyCraftsState,
): void {
  target.tools.axeTier = snapshot.tools.axeTier;
  target.tools.pickaxeTier = snapshot.tools.pickaxeTier;
  target.explainersSeen = [...snapshot.explainersSeen];
  target.autoSummonThralls = { ...snapshot.autoSummonThralls };
}

/**
 * Tolerant, unlike most save parsers here: a missing or malformed field falls
 * back to its empty default rather than failing the whole record, so an old
 * save with no craft progress at all loads as "nothing granted or seen yet".
 */
export function parsePartyCraftsState(value: unknown): PartyCraftsState | undefined {
  if (!isRecord(value)) return undefined;
  const tools = parsePartyToolsState(value.tools);
  const explainersSeen = Array.isArray(value.explainersSeen)
    ? value.explainersSeen.filter(
        (id): id is CraftSkillId => typeof id === 'string' && isCraftSkillId(id),
      )
    : [];
  const autoSummonThralls = parseAutoSummonThralls(value.autoSummonThralls);
  return { tools, explainersSeen, autoSummonThralls };
}

function parseAutoSummonThralls(value: unknown): AutoSummonThralls {
  const fallback = defaultAutoSummonThralls();
  if (!isRecord(value)) return fallback;
  return {
    human: typeof value.human === 'boolean' ? value.human : fallback.human,
    cat: typeof value.cat === 'boolean' ? value.cat : fallback.cat,
  };
}
