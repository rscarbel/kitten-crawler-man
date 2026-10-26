/**
 * Fenna's side of "The Borrowed Blueprints": her offer (once Construction is
 * unlocked), the topic that re-offers it after a decline, her opening while
 * the quest is under way, and the glyph over her head.
 *
 * `BlueprintsQuestSystem` routes every `lineFor`, `markerFor` and `topics`
 * call for Fenna here. The system is registered with `VillagerSystem` after
 * "Briar Hollow's Plea", so whenever the Plea has something for Fenna its
 * opening and marker win by provider order, and this part only speaks when
 * the Plea is silent. The pages themselves come from `blueprintsDialog.ts`.
 *
 * Everything here stands down while the Plea's siege is on: the village is
 * fighting for its life, and Fenna has no time for work-bench upgrades.
 */

import { isBlueprintsQuestUnderWay } from '../../../core/quests/blueprintsQuestPhase';
import { formatCost } from '../../../core/items/gathering/partyResources';
import { constructionUnlocked, type CraftLearner } from '../../../core/quests/villageUnlocks';
import { isVillageUnderSiege } from '../../../core/quests/villageQuestPhase';
import type { ConversationRequest, ConversationTopic } from '../../../dialog/request';
import type { NPCMarkerType } from '../../../creatures/QuestNPC';
import { KEEP_TALKING, type QuestOpening, type VillagerContext } from '../villagerCircumstances';
import type { VillagerConversationFlow } from '../villagerTopics';
import type { BlueprintsQuestContext } from './blueprintsContext';
import {
  FENNA_OFFER_ACCEPT_LABEL,
  FENNA_OFFER_DECLINE_LABEL,
  FENNA_REOFFER_TOPIC_LABEL,
  fennaAcceptedPages,
  fennaDeclinedPages,
  fennaInProgressPages,
  fennaOfferPages,
  fennaShowBlueprintsPages,
  skyfowlTownWhereabouts,
} from './blueprintsDialog';
import { isHeld, type BlueprintsItemHolder } from './blueprintsProgress';
import { stationUpgradeCost } from './StationUpgrades';

/** The topic on Fenna that replays the offer after a decline. */
export const FENNA_REOFFER_TOPIC_KEY = 'blueprints_reoffer';
const FENNA_REOFFER_ACCEPT_KEY = 'blueprints_reoffer_accept';
const FENNA_REOFFER_DECLINE_KEY = 'blueprints_reoffer_decline';

/**
 * What Fenna's part reads: the village's state and map, the Plea's phase, the
 * phase switch, and the two crawlers only as far as whether either has learned
 * Construction and whether either carries the blueprints — narrow enough to
 * stand up headlessly with stand-in crawlers.
 */
export type FennaBlueprintsContext = Pick<
  BlueprintsQuestContext,
  'state' | 'gameMap' | 'pleaPhase' | 'setPhase'
> & {
  readonly human: CraftLearner & BlueprintsItemHolder;
  readonly cat: CraftLearner & BlueprintsItemHolder;
};

export class FennaBlueprintsLines {
  constructor(protected readonly ctx: FennaBlueprintsContext) {}

  /**
   * Whether Fenna's offer stands: never made or answered yet, Construction
   * open to the party (the same test the build button uses, so the "!" and
   * the button can never disagree), and no siege on.
   */
  get offerStands(): boolean {
    if (this.ctx.state.blueprints.phase !== 'unoffered') return false;
    if (this.underSiege) return false;
    return constructionUnlocked([this.ctx.human, this.ctx.cat], this.ctx.state.unlocks);
  }

  private get underSiege(): boolean {
    return isVillageUnderSiege(this.ctx.pleaPhase());
  }

  /**
   * Fenna's opening for this quest, or null to leave her to the rest of the
   * ladder. The offer is a `confirm` opening ("We'll help" / "Not right
   * now") that can repeat until answered.
   */
  lineFor(_villagerCtx: VillagerContext): QuestOpening | null {
    if (this.offerStands) {
      return {
        pages: fennaOfferPages(),
        questRelated: true,
        after: {
          kind: 'confirm',
          accept: { label: FENNA_OFFER_ACCEPT_LABEL, run: (flow) => this.accept(flow) },
          decline: { label: FENNA_OFFER_DECLINE_LABEL, run: (flow) => this.decline(flow) },
        },
      };
    }
    if (this.underSiege) return null;
    if (this.awaitingBlueprints) {
      return {
        pages: fennaShowBlueprintsPages(
          formatCost(stationUpgradeCost('saw')),
          formatCost(stationUpgradeCost('ropeWalk')),
        ),
        questRelated: true,
        after: { kind: 'close', onClosed: () => this.ctx.setPhase('build_stations') },
      };
    }
    if (isBlueprintsQuestUnderWay(this.ctx.state.blueprints.phase)) {
      return { pages: fennaInProgressPages(), questRelated: true, after: KEEP_TALKING };
    }
    return null;
  }

  /**
   * Whether a crawler has the blueprints from Wendell in hand and Fenna has
   * yet to see them, outside the siege. A displaced quest slot sends them back
   * to his plan chest, and the briefing waits until they are fetched again.
   */
  private get awaitingBlueprints(): boolean {
    if (this.ctx.state.blueprints.phase !== 'show_fenna' || this.underSiege) return false;
    return isHeld([this.ctx.human, this.ctx.cat], 'quest_blueprints');
  }

  /** The glyph over Fenna for this quest: `'exclamation'` while the offer stands, `'question'` while she waits to see the blueprints. */
  markerFor(_villagerCtx: VillagerContext): NPCMarkerType {
    if (this.offerStands) return 'exclamation';
    return this.awaitingBlueprints ? 'question' : 'none';
  }

  /** Fenna's rows for this quest: the re-offer topic after a decline. */
  topics(
    _villagerCtx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[] {
    if (this.ctx.state.blueprints.phase !== 'declined' || this.underSiege) return [];
    return [
      {
        key: FENNA_REOFFER_TOPIC_KEY,
        label: FENNA_REOFFER_TOPIC_LABEL,
        tone: 'quest',
        repeatable: true,
        grouping: 'root',
        run: (convo) =>
          convo.play(flow.answerWithTopics(fennaOfferPages(), this.reofferChoices(flow), true)),
      },
    ];
  }

  /** The re-offer's own accept/decline row, matching the opening's confirm: accept is what Space picks. */
  private reofferChoices(flow: VillagerConversationFlow): readonly ConversationTopic[] {
    return [
      {
        key: FENNA_REOFFER_ACCEPT_KEY,
        label: FENNA_OFFER_ACCEPT_LABEL,
        tone: 'quest',
        keyboard: 'default',
        repeatable: false,
        grouping: 'root',
        run: (convo) => convo.play(this.accept(flow)),
      },
      {
        key: FENNA_REOFFER_DECLINE_KEY,
        label: FENNA_OFFER_DECLINE_LABEL,
        tone: 'exit',
        repeatable: false,
        grouping: 'root',
        run: (convo) => convo.play(this.decline(flow)),
      },
    ];
  }

  private accept(flow: VillagerConversationFlow): ConversationRequest {
    this.ctx.setPhase('ask_wendell');
    return flow.answer(fennaAcceptedPages(this.townWhereabouts()), true);
  }

  private decline(flow: VillagerConversationFlow): ConversationRequest {
    this.ctx.setPhase('declined');
    return flow.answer(fennaDeclinedPages());
  }

  /** Which way the skyfowl town lies from the village, as Fenna says it. */
  private townWhereabouts(): string {
    const villageCentre = this.ctx.gameMap.briarHollow?.centre ?? null;
    const townCentre = this.ctx.gameMap.townPlan?.centre ?? null;
    return skyfowlTownWhereabouts(villageCentre, townCentre);
  }
}
