/**
 * A Taloncrest contract's contact, indoors: the green `?` over them once
 * every spot is done, and the thanks that pays the party out.
 *
 * One of `BuildingInteriorScene`'s resident quest hooks, asked before the
 * others since it speaks only while a payment is owed, and built for the ground floor of every building that can host a
 * contract. While a story state owns the room the contact is not there to be
 * paid by, so the hook stands aside until it is free again.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { BriarHollowState } from '../../core/quests/briarHollowState';
import type { EventBus } from '../../core/EventBus';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { Conversation } from '../../dialog/Conversation';
import type { ConversationHandle } from '../../dialog/request';
import { contractThanksLines } from '../../dialog/scripts/contractThanks';
import type { CitizenSpeechStyle } from '../../dialog/speakers';
import type { Player } from '../../Player';
import { interiorRoomOwnedByStory, type InteriorStoryState } from '../interiorStoryOwnership';
import type { ResidentQuestHook } from '../residentQuestHooks';
import type { ResidentId } from '../../core/state/residentIds';
import {
  contractSiteFor,
  taloncrestContractSite,
  type TaloncrestContractSiteDef,
} from './contractCatalog';
import { contractPayout, isContractReady } from './contractGenerator';
import { ContractSettlement, type ContractSettlementDeps } from './ContractSettlement';
import type { BuildingId } from '../../map/buildingIds';

/** Every Taloncrest contract building is paid out on its ground floor. */
const CONTACT_FLOOR = 0;

export interface ContractContactHookDeps {
  readonly state: BriarHollowState;
  /** The story records that decide whether a story state owns this room, read live. */
  readonly story: () => InteriorStoryState;
  /** The interior scene's own bus. */
  readonly bus: EventBus;
  readonly audio: Pick<AudioManager, 'playRandom'> | null;
  readonly conversation: Conversation;
  readonly flyCoins: ContractSettlementDeps['flyCoins'];
  readonly party: ContractSettlementDeps['party'];
  /** The voice a resident standing in this room speaks in, or null when they are not here. */
  readonly speechStyleOf: (residentId: ResidentId) => CitizenSpeechStyle | null;
}

export class ContractContactHook implements ResidentQuestHook {
  /** The payout and Wendell's note, exposed for a headless check. */
  readonly settlement: ContractSettlement;
  private conversationHandle: ConversationHandle | null = null;

  private constructor(
    private readonly site: TaloncrestContractSiteDef,
    private readonly deps: ContractContactHookDeps,
  ) {
    this.settlement = new ContractSettlement({
      state: deps.state,
      bus: deps.bus,
      audio: deps.audio,
      conversation: deps.conversation,
      flyCoins: deps.flyCoins,
      party: deps.party,
    });
  }

  /** The hook for this room, or null anywhere but the ground floor of a building that can host a contract. */
  static forBuilding(
    buildingId: BuildingId,
    floor: number,
    deps: ContractContactHookDeps,
  ): ContractContactHook | null {
    if (floor !== CONTACT_FLOOR) return null;
    const site = taloncrestContractSite(buildingId);
    return site === undefined ? null : new ContractContactHook(site, deps);
  }

  /** The thanks box; never Wendell's note, which floats over a running room. */
  get isDialogOpen(): boolean {
    return (
      this.conversationHandle !== null && this.deps.conversation.isActive(this.conversationHandle)
    );
  }

  /** Whether this room's contract is finished and its contact here to pay for it. */
  private get awaitingPayment(): boolean {
    const active = this.deps.state.contracts.active;
    if (active === null || contractSiteFor(active.site) !== this.site) return false;
    if (!isContractReady(active)) return false;
    return !interiorRoomOwnedByStory(this.site.buildingId, this.deps.story());
  }

  tryOpenDialog(residentId: ResidentId, talker: Player): boolean {
    if (residentId !== this.site.contact || !this.awaitingPayment) return false;
    const active = this.deps.state.contracts.active;
    const speechStyle = this.deps.speechStyleOf(residentId);
    if (active === null || speechStyle === null || this.isDialogOpen) return false;
    const payOut = (): void => void this.settlement.settle(talker);
    this.conversationHandle = this.deps.conversation.open({
      lines: contractThanksLines(
        { town: 'taloncrest', contact: this.site.contact, speechStyle },
        {
          siteName: this.site.name,
          payout: contractPayout(active),
          variant: this.deps.state.contracts.contractsCompleted,
        },
      ),
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed: payOut },
      // The thanks has been said by the time anyone walks off; the purse is
      // handed over either way, as it is by a Briar Hollow contact.
      dismiss: { kind: 'allowed', onDismissed: payOut },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
    return true;
  }

  /**
   * `'question'` over this room's contact while their payment waits. Null
   * otherwise, so another questline's glyph over the same resident (the
   * Anchor's over Aviel or Lori) still shows.
   */
  markerFor(residentId: ResidentId): NPCMarkerType | null {
    return residentId === this.site.contact && this.awaitingPayment ? 'question' : null;
  }

  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    return this.deps.conversation.dismiss();
  }

  /** Whether Wendell's note is on screen. */
  get isFollowUpOpen(): boolean {
    return this.settlement.isFollowUpOpen;
  }

  /** Escape on Wendell's note. Returns whether it was showing. */
  dismissFollowUp(): boolean {
    return this.settlement.dismissFollowUp();
  }

  update(): void {
    this.settlement.update();
  }
}
