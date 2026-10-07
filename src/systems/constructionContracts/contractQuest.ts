/**
 * The construction contracts as a questline: the id the Journal, the counter
 * and the quest events know it by, when it opens, and the world facts its
 * eligibility reads, built from the state either floor-3 scene threads.
 */

import type { AnchorQuestProgress } from '../../core/AnchorQuestProgress';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { EventBus } from '../../core/EventBus';
import { releaseAutoPin, type JournalProgress } from '../../core/JournalProgress';
import type { MurderQuestProgress } from '../../core/MurderQuestProgress';
import type { ContractWorld } from './contractEligibility';

export const CONSTRUCTION_CONTRACT_QUEST_ID = 'construction_contract';
export const CONSTRUCTION_CONTRACT_QUEST_NAME = 'Construction Contract';

/** Wendell hands out contracts once "The Borrowed Blueprints" is finished. */
export function contractsUnlocked(state: Pick<BriarHollowState, 'blueprints'>): boolean {
  return state.blueprints.phase === 'complete';
}

/**
 * Drops the automatic pin a contract's start set once that contract is paid
 * or dropped. The idle offer to take another reuses the contract's tracker
 * id, so a leftover auto pin would otherwise resolve to it and light
 * Wendell's door with a beam and arrow the player never asked for. Returns
 * the unsubscribe.
 */
export function releaseContractAutoPinOnEnd(bus: EventBus, progress: JournalProgress): () => void {
  const release = (event: { readonly questId: string }): void => {
    if (event.questId === CONSTRUCTION_CONTRACT_QUEST_ID) releaseAutoPin(progress, event.questId);
  };
  const stopCompleted = bus.on('questCompleted', release);
  const stopAbandoned = bus.on('questAbandoned', release);
  return () => {
    stopCompleted();
    stopAbandoned();
  };
}

/** Everything {@link buildContractWorld} reads, as either floor-3 scene holds it. */
export interface ContractWorldSources {
  /** Absent in a harness with no murder questline behind it. */
  readonly murderQuest: Pick<MurderQuestProgress, 'stage'> | undefined;
  readonly anchorQuest: Pick<AnchorQuestProgress, 'temple' | 'hildaRepairedTypes'>;
  readonly briarHollow: Pick<BriarHollowState, 'quest'>;
}

/**
 * The world facts contract eligibility reads, read live from the records the
 * scene threads by reference, so a contract issued indoors and one checked on
 * the street see the same story.
 */
export function buildContractWorld(sources: ContractWorldSources): ContractWorld {
  return {
    murderStage: sources.murderQuest?.stage,
    anchor: sources.anchorQuest,
    villagePhase: sources.briarHollow.quest.phase,
  };
}
