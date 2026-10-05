/**
 * Fenna Splintertail's bulk processing: hand her the wood, pay a coin a
 * piece, and the whole batch comes back as boards or rope at once — a paid
 * service, so there is no waiting at the machine.
 *
 * The conversation follows her own lines: she offers the service, the player
 * picks boards or rope, she asks how many, and a quantity picker takes the
 * number. Short of coin, she says so and the picker comes back up with the
 * same number in it. The batch is capped at the party's wood, and at what
 * somebody has room to carry away.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { EventBus } from '../../../core/EventBus';
import { ITEM_DEF } from '../../../core/ItemDefs';
import type { BarkLine, NonEmpty } from '../../../dialog/line';
import { FENNA } from '../../../dialog/scripts/briarHollow';
import type { ProcessingStationKind } from '../processingStations';
import { onceFlagFor } from '../villagerCircumstances';
import type { ConversationHandle, ConversationTopic } from '../../../dialog/request';
import type { TopicProvider, VillagerConversationFlow } from '../villagerTopics';
import { BAG_FULL_LINE, otherCrawler, type ServiceParty, shopTrades } from './serviceContext';
import { canAffordCoins, spendPartyCoins } from '../../../core/partyCoins';
import {
  FENNA_FEE_PER_WOOD,
  outputFor,
  outputItem,
  partyWood,
  processWood,
  processableWood,
} from './woodProcessing';

const FOREMAN = 'fenna';
/** A batch starts at this many wood, or everything the party has if that is less. */
const DEFAULT_BATCH_WOOD = 10;
/** Why the picker stops short of the party's wood. */
export const BAG_LIMIT_NOTE = '(limited by bag space)';

/** Fenna's one-shot remark that processing counts as construction practice. */
export const CONSTRUCTION_EXPERIENCE_ONCE_FLAG = onceFlagFor(FOREMAN, 'construction_experience');

const SELECTED_LINE: Readonly<Record<ProcessingStationKind, BarkLine>> = {
  boards: FENNA.bulkProcessingBoardsSelected,
  rope: FENNA.bulkProcessingRopeSelected,
};

const PICKER_TITLE: Readonly<Record<ProcessingStationKind, string>> = {
  boards: 'Process into boards',
  rope: 'Process into rope',
};

/** What the picker needs to be told; `QuantityDialog.open` takes exactly this. */
export interface BatchPickerOptions {
  title: string;
  max: number;
  initial: number;
  unitLabel: string;
  costPerUnit: number;
  currencyLabel: string;
  confirmLabel: string;
  detail: (qty: number) => string;
  note?: string;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}

export interface LumberForemanHost {
  readonly party: ServiceParty;
  readonly state: BriarHollowState;
  readonly bus: EventBus | null;
  readonly audio: AudioManager | null;
  openPicker(options: BatchPickerOptions): void;
  /**
   * Fenna answers `lines` in the conversation the picker opened over, or —
   * when the player has since walked off or closed it — barks the first
   * line over her head instead, so a paid batch is never finished in
   * silence. Returns whether every line was shown in the conversation,
   * which is what tells a caller whether a one-shot line it included was
   * actually read.
   */
  respond(
    convo: ConversationHandle,
    flow: VillagerConversationFlow,
    lines: NonEmpty<BarkLine>,
  ): boolean;
  /** Brings the villager's own root topics back up, if the conversation the picker opened over is still there to bring them up on. */
  returnToRoot(convo: ConversationHandle, flow: VillagerConversationFlow): void;
  announce(message: string): void;
  noteResourceActivity(): void;
}

/** What a confirmed batch answers with, and whether the construction-experience remark is part of it. */
export interface BatchResult {
  /** The completion line, and — only when it qualifies to be shown — the construction-experience remark right after it. Empty when the batch's goods could not be carried away. */
  readonly lines: readonly BarkLine[];
  /**
   * Whether Fenna's one-shot construction remark qualifies to run. The flag
   * itself is spent by the caller, once it knows `lines` was actually shown
   * to the player — never here, so a batch that only ever gets barked at
   * (the player walked off) leaves the remark to be earned again.
   */
  readonly constructionExperienceEarned: boolean;
}

/** The biggest batch the picker offers, and whether bag space is what capped it. */
export function batchLimit(
  party: ServiceParty,
  output: ProcessingStationKind,
): { max: number; limitedByBag: boolean } {
  const wood = partyWood(party);
  const max = Math.min(wood, processableWood(party, party.active(), output));
  return { max, limitedByBag: max < wood };
}

/** The batch the picker opens on: ten, or less when that is all there is. */
export function initialBatch(max: number): number {
  return Math.min(DEFAULT_BATCH_WOOD, max);
}

function outputPhrase(output: ProcessingStationKind, wood: number): string {
  return `→ ${outputFor(output, wood)} ${ITEM_DEF[outputItem(output)].name}`;
}

/**
 * Runs a confirmed batch of `wood`: charges the steered crawler a coin a wood,
 * spends the wood, and hands the output over. `null` means nothing happened
 * because the party could not pay.
 */
export function runBatch(
  host: LumberForemanHost,
  output: ProcessingStationKind,
  wood: number,
): BatchResult | null {
  const payer = host.party.active();
  const companion = otherCrawler(host.party, payer);
  const fee = wood * FENNA_FEE_PER_WOOD;
  if (!canAffordCoins(payer, companion, fee)) return null;
  // The goods are delivered before the coins move: a batch that cannot be
  // carried away must never cost anything.
  const result = processWood(host.party, payer, output, wood);
  if (result === null) {
    host.announce(BAG_FULL_LINE);
    return { lines: [], constructionExperienceEarned: false };
  }
  spendPartyCoins(payer, companion, fee, payer);
  host.audio?.play('purchase_success');
  host.noteResourceActivity();
  host.bus?.emit('woodProcessed', {
    output,
    count: result.produced,
    woodSpent: result.woodSpent,
    via: 'fenna',
  });
  const constructionExperienceEarned =
    payer.craftSkills.isLearned('construction') &&
    !host.state.onceFlags.includes(CONSTRUCTION_EXPERIENCE_ONCE_FLAG);
  const lines: BarkLine[] = [FENNA.bulkProcessingComplete];
  if (constructionExperienceEarned) lines.push(FENNA.constructionExperience);
  return { lines, constructionExperienceEarned };
}

/**
 * Opens the picker for `output`, at `initial` wood or the picker's own
 * default, over the conversation still open on `convo`. Assumes at least one
 * wood can be batched — callers check that first.
 */
function openBatchPicker(
  host: LumberForemanHost,
  convo: ConversationHandle,
  flow: VillagerConversationFlow,
  output: ProcessingStationKind,
  initial: number | null,
): void {
  const { max, limitedByBag } = batchLimit(host.party, output);
  const options: BatchPickerOptions = {
    title: PICKER_TITLE[output],
    max,
    initial: Math.min(max, initial ?? initialBatch(max)),
    unitLabel: 'wood',
    costPerUnit: FENNA_FEE_PER_WOOD,
    currencyLabel: 'coins',
    confirmLabel: 'Process',
    detail: (qty) => outputPhrase(output, qty),
    onConfirm: (qty) => {
      const result = runBatch(host, output, qty);
      if (result === null) {
        host.respond(convo, flow, [FENNA.bulkProcessingInsufficientFee]);
        openBatchPicker(host, convo, flow, output, qty);
        return;
      }
      if (result.lines.length === 0) return;
      const [first, ...rest] = result.lines;
      const shownInFull = host.respond(convo, flow, [first, ...rest]);
      if (result.constructionExperienceEarned && shownInFull) {
        host.state.onceFlags.push(CONSTRUCTION_EXPERIENCE_ONCE_FLAG);
      }
    },
    onCancel: () => host.returnToRoot(convo, flow),
  };
  if (limitedByBag) options.note = BAG_LIMIT_NOTE;
  host.openPicker(options);
}

function outputChoice(
  host: LumberForemanHost,
  flow: VillagerConversationFlow,
  output: ProcessingStationKind,
  label: string,
): ConversationTopic {
  return {
    key: output,
    label,
    tone: 'normal',
    repeatable: false,
    grouping: 'root',
    run: (convo: ConversationHandle) => {
      const { max } = batchLimit(host.party, output);
      if (max < 1) {
        if (partyWood(host.party) < 1) {
          convo.play(flow.answer([FENNA.noLogs]));
        } else {
          host.announce(BAG_FULL_LINE);
          convo.play(flow.closeNow());
        }
        return;
      }
      convo.play(flow.sayKeepingMenu([SELECTED_LINE[output]]));
      openBatchPicker(host, convo, flow, output, null);
    },
  };
}

/** Fenna's rows: the batch service while the mill runs, and the fee whenever asked. */
export function lumberForemanTopics(host: LumberForemanHost): TopicProvider {
  return {
    topics(villager, ctx, flow) {
      if (villager !== FOREMAN) return [];
      const fee: ConversationTopic = {
        key: 'fee',
        label: "What's the fee?",
        tone: 'normal',
        repeatable: false,
        grouping: 'question',
        run: (convo) => convo.play(flow.answer([FENNA.bulkProcessingFeeExplanation])),
      };
      if (!shopTrades(ctx.quest.phase) || !ctx.unlocks.processingStations) return [fee];
      const batch: ConversationTopic = {
        key: 'process_batch',
        label: 'Process a batch',
        tone: 'normal',
        repeatable: false,
        grouping: 'root',
        run: (convo) => {
          if (partyWood(host.party) < 1) {
            convo.play(flow.answer([FENNA.noLogs]));
            return;
          }
          convo.play(
            flow.answerWithTopics(
              [FENNA.bulkProcessingService],
              [
                outputChoice(host, flow, 'boards', 'Boards'),
                outputChoice(host, flow, 'rope', 'Rope'),
              ],
            ),
          );
        },
      };
      return [batch, fee];
    },
  };
}
