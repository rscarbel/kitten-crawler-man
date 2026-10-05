/**
 * Wendell's side of "The Borrowed Blueprints", indoors at Plumbline Farm: the
 * first visit that names his price, his waiting line, handing over the
 * blueprints once Midge is in his pasture, handing them back if they were
 * lost, and the glyph over his head in the steps that need him.
 *
 * One of `BuildingInteriorScene`'s resident quest hooks, asked after the
 * Anchor's. The quest's state is `BriarHollowState.blueprints`, threaded into
 * the interior by reference like everything else in Briar Hollow's state, so
 * a step this room advances is the step the village sees on the way out. It
 * moves the phase with `moveBlueprintsPhase` so the same events fire indoors
 * as out, and hands items over with `grantBlueprintsItem`.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import type { EventBus } from '../../../core/EventBus';
import type { BriarHollowState } from '../../../core/briarHollowState';
import { isWendellWaitingForCow } from '../../../core/blueprintsQuestPhase';
import type { ItemId } from '../../../core/ItemDefs';
import type { NPCMarkerType } from '../../../creatures/QuestNPC';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { Conversation } from '../../../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../../../dialog/line';
import type { ConversationHandle } from '../../../dialog/request';
import type { Player } from '../../../Player';
import type { ResidentQuestHook } from '../../residentQuestHooks';
import type { ResidentId } from '../../townResidents';
import {
  grantBlueprintsItem,
  isHeld,
  moveBlueprintsPhase,
  PLUMBLINE_FARM_NAME,
} from './blueprintsProgress';
import {
  speakingCrawler,
  wendellBlueprintsReturnedPages,
  wendellFirstVisitPages,
  wendellMidgeDeliveredPages,
  wendellWaitingPages,
} from './blueprintsDialog';
import { playBlueprintsCue, type BlueprintsCue } from './blueprintsSoundCues';

export interface WendellBlueprintsHookDeps {
  readonly state: BriarHollowState;
  /** The interior scene's own bus. */
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly conversation: Conversation;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** A one-line toast over the hotbar. */
  readonly toast: (message: string) => void;
  /** An item was just handed over, for the fly-to-bag effect. */
  readonly onItemGranted: (id: ItemId, quantity: number, worldX: number, worldY: number) => void;
}

/** The only floor of Plumbline Farm, where Wendell stands. */
const WENDELL_FLOOR = 0;

const WENDELL_RESIDENT_ID: ResidentId = 'wendell';

export class WendellBlueprintsHook implements ResidentQuestHook {
  /** The handle this room's beat opened with; ownership is asked of the shared box, never tracked by hand. */
  protected conversationHandle: ConversationHandle | null = null;

  /**
   * Whether he has had his quest say this visit. The waiting line is said
   * once per visit and then he is his usual self again, because he also
   * offers a bed to rest in: a line that took every press would lock the
   * party out of it for the six steps the quest spends away from him.
   */
  private spokeForQuestThisVisit = false;

  private readonly cueTakesPlayed = new Map<BlueprintsCue, number>();

  protected constructor(protected readonly deps: WendellBlueprintsHookDeps) {}

  /** The hook for this room, or null anywhere but Plumbline Farm's ground floor. */
  static forBuilding(
    buildingName: string,
    floor: number,
    deps: WendellBlueprintsHookDeps,
  ): WendellBlueprintsHook | null {
    if (buildingName !== PLUMBLINE_FARM_NAME || floor !== WENDELL_FLOOR) return null;
    return new WendellBlueprintsHook(deps);
  }

  get isDialogOpen(): boolean {
    return (
      this.conversationHandle !== null && this.deps.conversation.isActive(this.conversationHandle)
    );
  }

  private get quest(): BriarHollowState['blueprints'] {
    return this.deps.state.blueprints;
  }

  private get activeCrawler(): HumanPlayer | CatPlayer {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  private get inactiveCrawler(): HumanPlayer | CatPlayer {
    return this.deps.human.isActive ? this.deps.cat : this.deps.human;
  }

  private get blueprintsCarried(): boolean {
    return isHeld([this.deps.human, this.deps.cat], 'quest_blueprints');
  }

  /** In `build_stations` with neither crawler holding the blueprints: they are back in his plan chest. */
  private get blueprintsOwedBack(): boolean {
    return this.quest.phase === 'build_stations' && !this.blueprintsCarried;
  }

  /**
   * Wendell's quest beat for this step, ahead of his usual resident flow.
   * Returns whether a beat opened; false for any other resident, and in any
   * step where he has nothing for the quest.
   *
   * Every beat waits while the other crawler lies knocked out in the room:
   * the first visit is a conversation both of them take part in, and the
   * hand-overs would move the quest on with half the party on the floor.
   * He falls back to his usual lines and the step stays where it is.
   */
  tryOpenDialog(residentId: ResidentId, _talker: Player): boolean {
    if (residentId !== WENDELL_RESIDENT_ID) return false;
    if (this.isDialogOpen) return false;
    if (this.inactiveCrawler.isKnockedOut) return false;
    const phase = this.quest.phase;
    if (phase === 'ask_wendell') {
      const active = speakingCrawler(this.deps.human.isActive);
      this.openBeat(wendellFirstVisitPages(active), () => {
        moveBlueprintsPhase(this.quest, 'ask_merrit', this.deps.bus);
      });
      return true;
    }
    if (phase === 'midge_delivered') {
      this.openBeat(wendellMidgeDeliveredPages(), () => {
        this.handOverBlueprints();
        moveBlueprintsPhase(this.quest, 'build_stations', this.deps.bus);
      });
      return true;
    }
    if (this.blueprintsOwedBack) {
      this.openBeat(wendellBlueprintsReturnedPages(), () => this.handOverBlueprints());
      return true;
    }
    if (isWendellWaitingForCow(phase) && !this.spokeForQuestThisVisit) {
      this.openBeat(wendellWaitingPages(), () => undefined);
      return true;
    }
    return false;
  }

  /**
   * `'question'` over Wendell in the steps that need him; `'none'` over him
   * in every other step, so a glyph cleared by the quest moving on is
   * actually taken down; null for anyone else.
   */
  markerFor(residentId: ResidentId): NPCMarkerType | null {
    if (residentId !== WENDELL_RESIDENT_ID) return null;
    const phase = this.quest.phase;
    const needsHim =
      phase === 'ask_wendell' || phase === 'midge_delivered' || this.blueprintsOwedBack;
    return needsHim ? 'question' : 'none';
  }

  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    return this.deps.conversation.dismiss();
  }

  update(): void {
    return;
  }

  /**
   * Opens one of his beats. `onRead` runs only when the last page is read
   * through: Esc leaves the step where it was, so the player hears the
   * whole beat again next time rather than skipping past what it hands over.
   */
  private openBeat(lines: NonEmpty<DialogLine>, onRead: () => void): void {
    this.spokeForQuestThisVisit = true;
    this.conversationHandle = this.deps.conversation.open({
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed: onRead },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** Into the quest slot of whoever the player is controlling, evicting whatever was there. */
  private handOverBlueprints(): void {
    const taker = this.activeCrawler;
    grantBlueprintsItem(taker, 'quest_blueprints');
    this.deps.onItemGranted('quest_blueprints', 1, taker.x, taker.y);
    playBlueprintsCue(this.deps.audio, 'blueprintHandover', this.cueTakesPlayed);
  }
}
