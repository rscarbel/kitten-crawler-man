/**
 * Merrit's side of "The Borrowed Blueprints": asking her for a cow, the
 * fence, the grain, calling Midge over, and the glyph over her head in the
 * steps that need her.
 *
 * `BlueprintsQuestSystem` routes every `lineFor` and `markerFor` call for
 * Merrit here. Her conversation that opens by itself once Midge arrives is
 * an auto-opener: it waits for the shared conversation to be free and owns
 * its beat through the handle `Conversation.open` returns. The pages come
 * from `blueprintsDialog.ts`.
 *
 * While "Briar Hollow's Plea" is under siege Merrit has none of this to say:
 * the villagers' siege line opens every talk, the grain waits, and she will
 * not call Midge out while the herd is sheltering in the barn.
 */

import type { NPCMarkerType } from '../../../creatures/QuestNPC';
import type { BlueprintsQuestPhase } from '../../../core/blueprintsQuestPhase';
import { isVillageUnderSiege } from '../../../core/villageQuestPhase';
import type { ConversationHandle } from '../../../dialog/request';
import {
  KEEP_TALKING,
  type OpeningPages,
  type QuestOpening,
  type VillagerContext,
} from '../villagerCircumstances';
import type { BlueprintsQuestContext } from './blueprintsContext';
import {
  MERRIT_CALL_MIDGE_BARK,
  merritAskPages,
  merritFenceDonePages,
  merritFenceWaitingPages,
  merritGrainDeliveredPages,
  merritHarvestWaitingPages,
  merritMidgeArrivedPages,
  speakingCrawler,
} from './blueprintsDialog';
import { takeBlueprintsItem } from './blueprintsProgress';

/** Starts Midge's walk over; `onArrived` runs once, when she reaches the party. */
export type BeginMidgeCall = (onArrived: () => void) => void;

export class MerritBlueprintsLines {
  /**
   * Set from the grain hand-in until the "There she is" conversation closes:
   * Midge is on her way, so Merrit has no quest line and no marker, and a
   * second talk cannot hand the grain in twice. Not saved — a door visit or a
   * rewind drops it with the phase still `deliver_grain`, and the next talk
   * simply calls Midge again.
   */
  private calling = false;
  /** Midge has arrived and Merrit's conversation is waiting for the panel to be free. */
  private arrivalPending = false;
  /** The "There she is" conversation while it is the one on screen. */
  private arrivedHandle: ConversationHandle | null = null;

  constructor(
    protected readonly ctx: BlueprintsQuestContext,
    private readonly beginMidgeCall: BeginMidgeCall,
  ) {}

  private get phase(): BlueprintsQuestPhase {
    return this.ctx.state.blueprints.phase;
  }

  private get underSiege(): boolean {
    return isVillageUnderSiege(this.ctx.pleaPhase());
  }

  /** Whether Merrit is between taking the grain and her "There she is" conversation closing. */
  get isCallingMidge(): boolean {
    return this.calling;
  }

  /** Merrit's opening for this quest in its current step, or null to leave her to the rest of the ladder. */
  lineFor(_villagerCtx: VillagerContext): QuestOpening | null {
    if (this.underSiege || this.calling) return null;
    const active = speakingCrawler(this.ctx.human.isActive);
    switch (this.phase) {
      case 'ask_merrit': {
        const pleaWon = this.ctx.pleaPhase() === 'complete';
        return this.closingOpening(merritAskPages(active, pleaWon), () =>
          this.advanceFrom('ask_merrit', 'build_fence'),
        );
      }
      case 'build_fence':
        return waitingOpening(merritFenceWaitingPages());
      case 'report_fence':
        return this.closingOpening(merritFenceDonePages(active), () =>
          this.advanceFrom('report_fence', 'harvest_grain'),
        );
      case 'harvest_grain':
        return waitingOpening(merritHarvestWaitingPages());
      case 'deliver_grain':
        return this.closingOpening(merritGrainDeliveredPages(), () => this.handInGrain());
      case 'unoffered':
      case 'declined':
      case 'ask_wendell':
      case 'escort_midge':
      case 'midge_delivered':
      case 'build_stations':
      case 'complete':
        return null;
    }
  }

  /** The glyph over Merrit for this quest: `'question'` in the steps the party must see her. */
  markerFor(_villagerCtx: VillagerContext): NPCMarkerType {
    if (this.underSiege || this.calling) return 'none';
    switch (this.phase) {
      case 'ask_merrit':
      case 'report_fence':
      case 'deliver_grain':
        return 'question';
      case 'unoffered':
      case 'declined':
      case 'ask_wendell':
      case 'build_fence':
      case 'harvest_grain':
      case 'escort_midge':
      case 'midge_delivered':
      case 'build_stations':
      case 'complete':
        return 'none';
    }
  }

  /** Once per gameplay frame: opens Merrit's own conversation once Midge has arrived and the panel is free. */
  update(): void {
    if (this.calling && this.phase !== 'deliver_grain') this.forgetCall();
    const handle = this.arrivedHandle;
    if (handle !== null && !this.ctx.conversation.isActive(handle)) {
      // Something else took the panel without the beat closing: say it again
      // once the panel is free, so the step can still move on.
      this.arrivedHandle = null;
      if (this.calling) this.arrivalPending = true;
    }
    if (!this.arrivalPending || this.arrivedHandle !== null) return;
    if (this.ctx.conversation.isOpen || this.ctx.worldHalted() || this.underSiege) return;
    this.arrivalPending = false;
    this.openMidgeArrived();
  }

  /** A death rewind on the same scene: forget any conversation waiting to open. */
  onRewind(): void {
    this.forgetCall();
  }

  private forgetCall(): void {
    this.calling = false;
    this.arrivalPending = false;
    this.arrivedHandle = null;
  }

  private closingOpening(pages: OpeningPages, onClosed: () => void): QuestOpening {
    return { pages, questRelated: true, after: { kind: 'close', onClosed } };
  }

  /** Moves the quest on from `from`, unless something else already has. */
  private advanceFrom(from: BlueprintsQuestPhase, to: BlueprintsQuestPhase): void {
    if (this.phase === from) this.ctx.setPhase(to);
  }

  /**
   * "That'll do." has been read: the grain is spent, the scythe goes back on
   * the barn wall, and Merrit shouts for Midge, who walks over to the party.
   */
  private handInGrain(): void {
    if (this.phase !== 'deliver_grain' || this.calling || this.underSiege) return;
    const { human, cat } = this.ctx;
    this.ctx.state.blueprints.grain = 0;
    takeBlueprintsItem([human, cat], 'quest_scythe');
    this.calling = true;
    this.ctx.cue('merritWhistle');
    this.ctx.villagers.bark('merrit', MERRIT_CALL_MIDGE_BARK, true);
    this.beginMidgeCall(() => {
      if (this.calling) this.arrivalPending = true;
    });
  }

  private openMidgeArrived(): void {
    this.arrivedHandle = this.ctx.conversation.open({
      lines: merritMidgeArrivedPages(),
      reward: null,
      questRelated: true,
      ending: {
        kind: 'close',
        onClosed: () => {
          this.forgetCall();
          this.advanceFrom('deliver_grain', 'escort_midge');
        },
      },
      // The step only moves on when this is read, so it cannot be waved away.
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }
}

/** A line Merrit says while the party is still at the job she set, before her own topics come up. */
function waitingOpening(pages: OpeningPages): QuestOpening {
  return { pages, questRelated: true, after: KEEP_TALKING };
}
