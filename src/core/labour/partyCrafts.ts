/**
 * Party-wide craft progress that is neither tool state alone nor a
 * per-crawler skill: the shared tool tiers plus which crafting explainers the
 * party has already been shown. Saved as `GameProgress.crafts`, alongside the
 * party rather than either crawler, because both halves are shared —
 * upgrading a tool updates both inventories, and an explainer shown to one
 * crawler should never replay for the other.
 */

import { isRecord, parseEvery } from '../util/guards';
import type { CraftSkillId } from './CraftSkills';
import { isCraftSkillId } from './CraftSkills';
import {
  createPartyToolsState,
  parsePartyToolsState,
  type PartyToolsState,
} from '../items/gathering/PartyTools';
import type { CrawlerKind } from '../skills/SkillManager';

/** Whether resourcing thralls join automatically when a crawler starts harvesting, keyed per crawler. */
export type AutoSummonThralls = Record<CrawlerKind, boolean>;

function defaultAutoSummonThralls(): AutoSummonThralls {
  return { human: true, cat: true };
}

export interface PartyCraftsState {
  tools: PartyToolsState;
  /** Craft skills whose "how it works" explainer has already played. */
  explainersSeen: CraftSkillId[];
  /**
   * Whether the processing explainer (the saw, the rope walk, and Fenna's
   * batch service) has already played. Kept apart from `explainersSeen`
   * because processing is not itself a leveled craft skill, so it has no
   * `CraftSkillId` to sit alongside there.
   */
  processingExplainerSeen: boolean;
  /**
   * Whether the hint about harvesting with both crawlers at once is spent:
   * set the first time it opens, or the first time both crawlers harvest at
   * once, whichever comes first.
   */
  dualHarvestHintDone: boolean;
  /** The auto-summon toggle from the axe/pickaxe context menu, on by default. */
  autoSummonThralls: AutoSummonThralls;
}

export function createPartyCraftsState(): PartyCraftsState {
  return {
    tools: createPartyToolsState(),
    explainersSeen: [],
    processingExplainerSeen: false,
    dualHarvestHintDone: false,
    autoSummonThralls: defaultAutoSummonThralls(),
  };
}

/** A value-equal copy, safe to hand to a checkpoint that must not alias the live object. */
export function clonePartyCraftsState(state: PartyCraftsState): PartyCraftsState {
  return {
    tools: { ...state.tools },
    explainersSeen: [...state.explainersSeen],
    processingExplainerSeen: state.processingExplainerSeen,
    dualHarvestHintDone: state.dualHarvestHintDone,
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
  target.processingExplainerSeen = snapshot.processingExplainerSeen;
  target.dualHarvestHintDone = snapshot.dualHarvestHintDone;
  target.autoSummonThralls = { ...snapshot.autoSummonThralls };
}

/** A saved {@link PartyCraftsState}, or undefined when any field is missing or not one this build wrote. */
export function parsePartyCraftsState(value: unknown): PartyCraftsState | undefined {
  if (!isRecord(value)) return undefined;
  const tools = parsePartyToolsState(value.tools);
  const explainersSeen = parseEvery(value.explainersSeen, (id) =>
    typeof id === 'string' && isCraftSkillId(id) ? id : undefined,
  );
  const autoSummonThralls = parseAutoSummonThralls(value.autoSummonThralls);
  const { processingExplainerSeen, dualHarvestHintDone } = value;
  if (
    tools === undefined ||
    explainersSeen === undefined ||
    autoSummonThralls === undefined ||
    typeof processingExplainerSeen !== 'boolean' ||
    typeof dualHarvestHintDone !== 'boolean'
  ) {
    return undefined;
  }
  return {
    tools,
    explainersSeen,
    processingExplainerSeen,
    dualHarvestHintDone,
    autoSummonThralls,
  };
}

function parseAutoSummonThralls(value: unknown): AutoSummonThralls | undefined {
  if (!isRecord(value)) return undefined;
  const { human, cat } = value;
  if (typeof human !== 'boolean' || typeof cat !== 'boolean') return undefined;
  return { human, cat };
}
