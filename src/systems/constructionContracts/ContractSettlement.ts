/**
 * Paying out a finished construction contract, the same way in either floor-3
 * scene: the contact's coins to whoever collected, the coins flown to the
 * HUD, `questCompleted`, and Wendell's note once the box is clear.
 *
 * A repeatable job settles quietly: no quest-complete screen, just the purse
 * and a short line from Wendell that floats over a running world.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { EventBus } from '../../core/EventBus';
import type { Conversation } from '../../dialog/Conversation';
import type { DialogLine } from '../../dialog/line';
import type { ConversationHandle } from '../../dialog/request';
import { wendellFollowUp } from '../../dialog/scripts/wendellContracts';
import type { Player } from '../../Player';
import { contractSiteFor } from './contractCatalog';
import { completeContract } from './contractGenerator';
import { CONSTRUCTION_CONTRACT_QUEST_ID } from './contractQuest';
import { playContractCue } from './contractSoundCues';

/** Whoever collects a contract's payment. */
export type ContractPayee = Pick<Player, 'earnCoins' | 'x' | 'y'>;

export interface ContractSettlementDeps {
  /** The contract record is read live, so a restored save is what gets settled. */
  readonly state: Pick<BriarHollowState, 'contracts'>;
  /** The scene's own bus, which `questCompleted` goes out on. */
  readonly bus: EventBus;
  readonly audio: Pick<AudioManager, 'play'> | null;
  /** The scene's one conversation, which Wendell's note opens on. */
  readonly conversation: Conversation;
  /** Flies `coins` from a world position to the HUD's coin pill. */
  readonly flyCoins: (coins: number, worldX: number, worldY: number) => void;
}

export class ContractSettlement {
  /** Wendell's note, waiting for the conversation box to be free. */
  private pendingFollowUp: DialogLine | null = null;
  private followUpHandle: ConversationHandle | null = null;

  constructor(private readonly deps: ContractSettlementDeps) {}

  /**
   * Pays the ready contract to `payee` and queues Wendell's note. Returns the
   * coins paid, or null when no ready contract is held, so a second close of
   * the same talk pays nothing.
   */
  settle(payee: ContractPayee): number | null {
    const active = this.deps.state.contracts.active;
    const site = active === null ? undefined : contractSiteFor(active.site);
    const payout = completeContract(this.deps.state.contracts);
    if (payout === null) return null;
    payee.earnCoins(payout);
    this.deps.flyCoins(payout, payee.x, payee.y);
    playContractCue(this.deps.audio, 'payout');
    playContractCue(this.deps.audio, 'payoutFanfare');
    this.deps.bus.emit('questCompleted', { questId: CONSTRUCTION_CONTRACT_QUEST_ID });
    if (site !== undefined) {
      this.pendingFollowUp = wendellFollowUp(
        site.name,
        this.deps.state.contracts.contractsCompleted,
      );
    }
    return payout;
  }

  /** Whether Wendell's note is waiting for the box to clear. */
  get isFollowUpPending(): boolean {
    return this.pendingFollowUp !== null;
  }

  /** Whether Wendell's note is the beat on screen. */
  get isFollowUpOpen(): boolean {
    return this.followUpHandle !== null && this.deps.conversation.isActive(this.followUpHandle);
  }

  /** Escape on Wendell's note. Returns whether it was showing. */
  dismissFollowUp(): boolean {
    if (!this.isFollowUpOpen) return false;
    return this.deps.conversation.dismiss();
  }

  /**
   * Once per frame. The note waits for the box to be free rather than opening
   * from the payout's own close: a payout that ran because something else
   * superseded the thanks must not open over the thing that superseded it.
   */
  update(): void {
    const line = this.pendingFollowUp;
    if (line === null || this.deps.conversation.isOpen) return;
    this.pendingFollowUp = null;
    this.followUpHandle = this.deps.conversation.open({
      lines: [line],
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: false,
      anchor: null,
      locksKeyboard: false,
    });
    playContractCue(this.deps.audio, 'wendellNote');
  }
}
