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
import type { Circumstance } from '../ratkinDialogue';
import type { ProcessingStationKind } from '../processingStations';
import { onceFlagFor } from '../villagerCircumstances';
import type { ConversationController, ConversationTopic, TopicProvider } from '../villagerTopics';
import { BAG_FULL_LINE, type ServiceParty, shopTrades } from './serviceContext';
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

const SELECTED_LINE: Readonly<Record<ProcessingStationKind, Circumstance>> = {
  boards: 'bulk_processing_boards_selected',
  rope: 'bulk_processing_rope_selected',
};

const PICKER_TITLE: Readonly<Record<ProcessingStationKind, string>> = {
  boards: 'Process into boards',
  rope: 'Process into rope',
};

/** What the picker needs to be told; `QuantityPicker.open` takes exactly this. */
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
   * Fenna answers: in the conversation while it is still open, or over her
   * head when the player has since walked off — a paid batch is never
   * finished in silence.
   */
  respond(ctl: ConversationController, lines: readonly [Circumstance, ...Circumstance[]]): void;
  announce(message: string): void;
  noteResourceActivity(): void;
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
 * spends the wood, and hands the output over. Returns the lines Fenna answers
 * with; `null` means nothing happened because the party could not pay.
 */
export function runBatch(
  host: LumberForemanHost,
  output: ProcessingStationKind,
  wood: number,
): readonly Circumstance[] | null {
  const payer = host.party.active();
  const fee = wood * FENNA_FEE_PER_WOOD;
  if (payer.coins < fee) return null;
  // The goods are delivered before the coins move: a batch that cannot be
  // carried away must never cost anything.
  const result = processWood(host.party, payer, output, wood);
  if (result === null) {
    host.announce(BAG_FULL_LINE);
    return [];
  }
  payer.coins -= fee;
  host.audio?.play('purchase_success');
  host.noteResourceActivity();
  host.bus?.emit('woodProcessed', {
    output,
    count: result.produced,
    woodSpent: result.woodSpent,
    via: 'fenna',
  });
  const lines: Circumstance[] = ['bulk_processing_complete'];
  const onceFlags = host.state.onceFlags;
  const firstSinceLearning =
    payer.craftSkills.isLearned('construction') &&
    !onceFlags.includes(CONSTRUCTION_EXPERIENCE_ONCE_FLAG);
  if (firstSinceLearning) {
    onceFlags.push(CONSTRUCTION_EXPERIENCE_ONCE_FLAG);
    lines.push('construction_experience');
  }
  return lines;
}

function openBatchPicker(
  host: LumberForemanHost,
  ctl: ConversationController,
  output: ProcessingStationKind,
  initial: number | null,
): void {
  const { max, limitedByBag } = batchLimit(host.party, output);
  if (max < 1) {
    if (partyWood(host.party) < 1) {
      ctl.say('no_logs');
      return;
    }
    host.announce(BAG_FULL_LINE);
    ctl.showRootTopics();
    return;
  }
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
      const lines = runBatch(host, output, qty);
      if (lines === null) {
        host.respond(ctl, ['bulk_processing_insufficient_fee']);
        openBatchPicker(host, ctl, output, qty);
        return;
      }
      if (lines.length === 0) return;
      host.respond(ctl, [lines[0], ...lines.slice(1)]);
    },
    onCancel: () => ctl.showRootTopics(),
  };
  if (limitedByBag) options.note = BAG_LIMIT_NOTE;
  host.openPicker(options);
}

function outputChoice(
  host: LumberForemanHost,
  output: ProcessingStationKind,
  label: string,
): ConversationTopic {
  return {
    key: output,
    label,
    run: (ctl) => {
      ctl.say(SELECTED_LINE[output]);
      openBatchPicker(host, ctl, output, null);
    },
  };
}

/** Fenna's rows: the batch service while the mill runs, and the fee whenever asked. */
export function lumberForemanTopics(host: LumberForemanHost): TopicProvider {
  return {
    topics(villager, ctx) {
      if (villager !== FOREMAN) return [];
      const fee: ConversationTopic = {
        key: 'fee',
        label: "What's the fee?",
        run: (ctl) => void ctl.say('bulk_processing_fee_explanation'),
      };
      if (!shopTrades(ctx.quest.phase)) return [fee];
      const batch: ConversationTopic = {
        key: 'process_batch',
        label: 'Process a batch',
        run: (ctl) => {
          if (partyWood(host.party) < 1) {
            ctl.say('no_logs');
            return;
          }
          ctl.say('bulk_processing_service');
          ctl.showTopics([
            outputChoice(host, 'boards', 'Boards'),
            outputChoice(host, 'rope', 'Rope'),
          ]);
        },
      };
      return [batch, fee];
    },
  };
}
