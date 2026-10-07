/**
 * Wendell indoors at Plumbline Farm once "The Borrowed Blueprints" is done:
 * the man who hands out construction contracts.
 *
 * One of `BuildingInteriorScene`'s resident quest hooks, asked after the
 * Blueprints hook so that quest keeps its first refusal; once the contracts
 * unlock, this hook takes every talk with him. His two everyday behaviours,
 * the hayloft rest and his ordinary small talk, ride along as rows on his
 * menu so neither is lost behind the job board.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { ActiveContract, BriarHollowState } from '../../core/briarHollowState';
import type { EventBus } from '../../core/EventBus';
import { formatCost } from '../../core/partyResources';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { Conversation } from '../../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../../dialog/line';
import type { Choice, ConversationHandle, ConversationRequest, Ending } from '../../dialog/request';
import { WENDELL_CONTRACTS } from '../../dialog/scripts/wendellContracts';
import type { Player } from '../../Player';
import { PLUMBLINE_FARM_NAME } from '../briarHollow/blueprints/blueprintsProgress';
import type { ResidentQuestHook } from '../residentQuestHooks';
import type { ResidentId } from '../townResidents';
import { contractSiteFor, contractSpot, type ContractSiteDef } from './contractCatalog';
import { contractContactName } from './contractContacts';
import { contractSiteEligible, type ContractWorld } from './contractEligibility';
import { contractCost, dropContract, isContractReady, issueContract } from './contractGenerator';
import { CONSTRUCTION_CONTRACT_QUEST_ID, contractsUnlocked } from './contractQuest';
import { playContractCue } from './contractSoundCues';

export interface WendellContractsHookDeps {
  readonly state: BriarHollowState;
  /** The interior scene's own bus. */
  readonly bus: EventBus;
  readonly audio: Pick<AudioManager, 'play'> | null;
  readonly conversation: Conversation;
  /** The floor-3 overworld's world seed, which the contract stream is drawn from. */
  readonly worldSeed: number;
  /** The story facts eligibility reads, asked at the moment a contract is issued. */
  readonly world: () => ContractWorld;
  /** Opens his hayloft rest menu. Called once his own box has closed. */
  readonly openHayloft: () => void;
  /** His ordinary small talk for this visit. */
  readonly chatLine: () => DialogLine;
}

/** The only floor of Plumbline Farm, where Wendell stands. */
const WENDELL_FLOOR = 0;

const WENDELL_RESIDENT_ID: ResidentId = 'wendell';

/** A held contract, with the catalogue entry its site key names. */
interface HeldContract {
  readonly active: ActiveContract;
  readonly site: ContractSiteDef;
}

export class WendellContractsHook implements ResidentQuestHook {
  private conversationHandle: ConversationHandle | null = null;

  private constructor(private readonly deps: WendellContractsHookDeps) {}

  /** The hook for this room, or null anywhere but Plumbline Farm's ground floor. */
  static forBuilding(
    buildingName: string,
    floor: number,
    deps: WendellContractsHookDeps,
  ): WendellContractsHook | null {
    if (buildingName !== PLUMBLINE_FARM_NAME || floor !== WENDELL_FLOOR) return null;
    return new WendellContractsHook(deps);
  }

  get isDialogOpen(): boolean {
    return (
      this.conversationHandle !== null && this.deps.conversation.isActive(this.conversationHandle)
    );
  }

  private get contracts(): BriarHollowState['contracts'] {
    return this.deps.state.contracts;
  }

  /**
   * The held contract, or null with none held. A held contract whose site the
   * catalogue no longer carries is dropped here, so he simply re-offers.
   */
  private heldContract(): HeldContract | null {
    const active = this.contracts.active;
    if (active === null) return null;
    const site = contractSiteFor(active.site);
    if (site === undefined) {
      this.drop();
      return null;
    }
    return { active, site };
  }

  /** Every talk with Wendell once the contracts are unlocked; false before, and for anyone else. */
  tryOpenDialog(residentId: ResidentId, _talker: Player): boolean {
    if (residentId !== WENDELL_RESIDENT_ID) return false;
    if (!contractsUnlocked(this.deps.state)) return false;
    if (this.isDialogOpen) return false;
    this.conversationHandle = this.deps.conversation.open(this.openingRequest());
    return true;
  }

  /**
   * `'exclamation'` over Wendell while a contract is his to give, `'none'`
   * while one is held; null before the contracts unlock, leaving his glyph to
   * the Blueprints quest, and for anyone else.
   */
  markerFor(residentId: ResidentId): NPCMarkerType | null {
    if (residentId !== WENDELL_RESIDENT_ID) return null;
    if (!contractsUnlocked(this.deps.state)) return null;
    return this.contracts.active === null ? 'exclamation' : 'none';
  }

  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    return this.deps.conversation.dismiss();
  }

  update(): void {
    return;
  }

  private openingRequest(): ConversationRequest {
    if (!this.contracts.introSeen) {
      return this.request([WENDELL_CONTRACTS.intro], {
        kind: 'confirm',
        accept: {
          label: WENDELL_CONTRACTS.acceptLabel,
          tone: 'quest',
          run: (convo) => {
            this.contracts.introSeen = true;
            this.issueAndAnnounce(convo);
          },
        },
        decline: {
          label: WENDELL_CONTRACTS.declineLabel,
          tone: 'exit',
          run: (convo) => {
            this.contracts.introSeen = true;
            convo.close();
          },
        },
        keyboardDefault: 'accept',
      });
    }
    const held = this.heldContract();
    return this.request([this.openingLine(held)], { kind: 'choices', choices: this.menu(held) });
  }

  private openingLine(held: HeldContract | null): DialogLine {
    if (held === null) {
      return this.contracts.contractsIssued === 0
        ? WENDELL_CONTRACTS.reOffer
        : WENDELL_CONTRACTS.idle;
    }
    if (isContractReady(held.active)) {
      return WENDELL_CONTRACTS.activeReady({ contactName: contractContactName(held.site) });
    }
    return WENDELL_CONTRACTS.activeNotReady({
      siteName: held.site.name,
      remaining: remainingSpotLabels(held),
    });
  }

  /** His menu: the job first and on Space, then his rest, his chat and the way out. */
  private menu(held: HeldContract | null): NonEmpty<Choice> {
    const takeAnother: Choice = {
      label: WENDELL_CONTRACTS.takeAnotherLabel,
      tone: 'quest',
      keyboard: 'default',
      run: (convo) => this.takeAnother(convo),
    };
    const rest: Choice = {
      label: WENDELL_CONTRACTS.restLabel,
      tone: 'normal',
      run: (convo) => {
        convo.close();
        this.deps.openHayloft();
      },
    };
    const chat: Choice = {
      label: WENDELL_CONTRACTS.chatLabel,
      tone: 'normal',
      run: (convo) => convo.play(this.closingRequest(this.deps.chatLine())),
    };
    const leave: Choice = {
      label: WENDELL_CONTRACTS.leaveLabel,
      tone: 'exit',
      run: (convo) => convo.close(),
    };
    const offersDrop = held !== null && !isContractReady(held.active);
    if (!offersDrop) return [takeAnother, rest, chat, leave];
    return [takeAnother, this.dropChoice(), rest, chat, leave];
  }

  /**
   * Never what a bare Space picks: dropping throws away the spots already
   * worked, and a player holding Space through his menu means "go on".
   */
  private dropChoice(): Choice {
    return {
      label: WENDELL_CONTRACTS.dropLabel,
      tone: 'normal',
      keyboard: 'never',
      run: (convo) => convo.play(this.dropConfirmRequest()),
    };
  }

  private neverMind(): Choice {
    return {
      label: WENDELL_CONTRACTS.neverMindLabel,
      tone: 'exit',
      run: (convo) => convo.close(),
    };
  }

  private drop(): void {
    dropContract(this.contracts);
    this.deps.bus.emit('questAbandoned', { questId: CONSTRUCTION_CONTRACT_QUEST_ID });
  }

  private dropConfirmRequest(): ConversationRequest {
    return this.request([WENDELL_CONTRACTS.dropConfirm], {
      kind: 'choices',
      choices: [
        {
          label: WENDELL_CONTRACTS.confirmDropLabel,
          tone: 'normal',
          keyboard: 'never',
          run: (convo) => {
            this.drop();
            convo.play(this.closingRequest(WENDELL_CONTRACTS.dropped));
          },
        },
        this.neverMind(),
      ],
    });
  }

  /** One press issues the next job; while one is held, he says so instead. */
  private takeAnother(convo: ConversationHandle): void {
    const held = this.heldContract();
    if (held === null) {
      this.issueAndAnnounce(convo);
      return;
    }
    if (isContractReady(held.active)) {
      convo.play(
        this.closingRequest(
          WENDELL_CONTRACTS.collectFirst({ contactName: contractContactName(held.site) }),
        ),
      );
      return;
    }
    convo.play(
      this.request([WENDELL_CONTRACTS.finishFirst({ siteName: held.site.name })], {
        kind: 'choices',
        choices: [this.dropChoice(), this.neverMind()],
      }),
    );
  }

  private issueAndAnnounce(convo: ConversationHandle): void {
    const world = this.deps.world();
    const active = issueContract(
      this.contracts,
      (site) => contractSiteEligible(site, world),
      this.deps.worldSeed,
    );
    const site = active === null ? undefined : contractSiteFor(active.site);
    if (active === null || site === undefined) {
      convo.play(this.closingRequest(WENDELL_CONTRACTS.nothingDoing));
      return;
    }
    convo.play(
      this.closingRequest(
        WENDELL_CONTRACTS.issued({
          siteName: site.name,
          contactName: contractContactName(site),
          costText: formatCost(contractCost(active)),
        }),
      ),
    );
    this.deps.bus.emit('questStarted', { questId: CONSTRUCTION_CONTRACT_QUEST_ID });
    playContractCue(this.deps.audio, 'contractSigned');
  }

  private closingRequest(line: DialogLine): ConversationRequest {
    return this.request([line], { kind: 'close', onClosed: () => undefined });
  }

  private request(lines: NonEmpty<DialogLine>, ending: Ending): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: true,
      ending,
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    };
  }
}

/** The labels of a held contract's unfinished spots, in the order they were issued. */
function remainingSpotLabels(held: HeldContract): string[] {
  return held.active.spotIds.flatMap((id, index) => {
    if (held.active.spotsDone[index]) return [];
    const spot = contractSpot(held.site, id);
    return spot === undefined ? [] : [spot.label];
  });
}
