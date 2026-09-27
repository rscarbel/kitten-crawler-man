/**
 * The choices under a villager's conversation, and the built-in ones every
 * villager is born with.
 *
 * Choices are assembled per conversation from {@link TopicProvider}s, so a
 * shop, the questline or the militia can add rows for their villager without
 * this module knowing they exist. A topic's `run` plays a `ConversationRequest`
 * straight onto the `ConversationHandle` it is handed — the text is always
 * the villager's own script's, and what happens once it is read is written
 * into that request's `ending`, not inferred afterwards.
 *
 * A {@link VillagerConversationFlow} is how a topic builds that request
 * without hand-rolling `dismiss`/`anchor`/`haltsWorld` itself: `answer` says
 * something and ends the conversation, `answerWithTopics` says something and
 * brings up a new choice row, `answerAndReturnToRoot` says something and
 * brings the villager's own topics back up freshly rebuilt, `openTopics`
 * swaps in a new choice row over the line already on screen, and `closeNow`
 * ends the conversation on the line already on screen. `onEventualClose`
 * registers a callback for whenever this conversation eventually, fully
 * closes — however many more screens it shows first, and whether that is a
 * "Goodbye", a walk-away, or Escape.
 */

import type { DialogLine, NonEmpty } from '../../dialog/line';
import type { ConversationRequest, ConversationTopic } from '../../dialog/request';
import {
  BRAMBLEWICK,
  CRICKET,
  FENNA,
  GARN,
  MERRIT,
  MIDGE,
  NELLA,
  OREN,
  PIPKIN,
  SELLA,
  TIKKA,
  VETCH,
} from '../../dialog/scripts/briarHollow';
import type { VillagerId } from '../../dialog/scripts/briarHollow';
import type { VillagerContext } from './villagerCircumstances';

/**
 * What a topic (or an opening) builds a `ConversationRequest` through,
 * without repeating the anchor/dismiss/`haltsWorld` wiring every villager
 * conversation shares. Built fresh per conversation by `VillagerSystem`.
 */
export interface VillagerConversationFlow {
  /** Shows `lines`; the conversation ends once they've been read. */
  answer(lines: NonEmpty<DialogLine>, questRelated?: boolean): ConversationRequest;
  /** Shows `lines`, then brings up `topics` as the conversation's new choice row once they've been read. */
  answerWithTopics(
    lines: NonEmpty<DialogLine>,
    topics: readonly ConversationTopic[],
    questRelated?: boolean,
  ): ConversationRequest;
  /** Shows `lines`, then brings the villager's own root topics back up, freshly rebuilt, once they've been read. */
  answerAndReturnToRoot(lines: NonEmpty<DialogLine>, questRelated?: boolean): ConversationRequest;
  /**
   * Shows `lines` without disturbing whichever choice row is already up — a
   * submenu a topic opened stays exactly as it was, so a service that answers
   * over a picker or a follow-up prompt can keep offering the same rows once
   * the answer is read.
   */
  sayKeepingMenu(lines: NonEmpty<DialogLine>, questRelated?: boolean): ConversationRequest;
  /** Brings the villager's own root topics back up, freshly rebuilt, over whichever line is already on screen. */
  returnToRoot(): ConversationRequest;
  /** Swaps in `topics` as the new choice row, over whichever line is already on screen. */
  openTopics(topics: readonly ConversationTopic[]): ConversationRequest;
  /** Ends the conversation right now, on whichever line is already on screen. */
  closeNow(): ConversationRequest;
  /** Shows `lines`, then ends the conversation once they're read; `onClosed` also runs if the player instead walks away or presses Escape first. */
  closeAfter(
    lines: NonEmpty<DialogLine>,
    onClosed: () => void,
    questRelated?: boolean,
  ): ConversationRequest;
  /** Runs `fn` once this conversation eventually, fully closes — however many more screens it shows first. */
  onEventualClose(fn: () => void): void;
}

export interface TopicProvider {
  topics(
    villager: VillagerId,
    ctx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[];
}

/** A topic that answers with one or more lines and closes the conversation once they're read. */
function answer(
  key: string,
  label: string,
  flow: VillagerConversationFlow,
  first: DialogLine,
  ...rest: readonly DialogLine[]
): ConversationTopic {
  return {
    key,
    label,
    tone: 'normal',
    repeatable: false,
    grouping: 'root',
    run: (convo) => convo.play(flow.answer([first, ...rest])),
  };
}

/** Lore or how-it-works small talk: an `answer` the root menu tucks under "I have a question". */
function question(
  key: string,
  label: string,
  flow: VillagerConversationFlow,
  first: DialogLine,
  ...rest: readonly DialogLine[]
): ConversationTopic {
  return { ...answer(key, label, flow, first, ...rest), grouping: 'question' };
}

/** Tikka's "What can I build?" submenu, one row per kind of structure. */
function tikkaBuildTopics(flow: VillagerConversationFlow): readonly ConversationTopic[] {
  return [
    answer('walls', 'Walls', flow, TIKKA.wallsTopic),
    answer('trebuchets', 'Trebuchets', flow, TIKKA.trebuchetsTopic),
    answer('snares', 'Snares', flow, TIKKA.snareExplanation),
  ];
}

function partyOwnsTools(ctx: VillagerContext): boolean {
  return ctx.party.axeTier !== null || ctx.party.pickaxeTier !== null;
}

/**
 * The questions any villager can be asked, from the ask-lines they have,
 * plus the few answers that only make sense once the party has what they are
 * about (Oren's tools, Tikka's Construction).
 */
export const BUILT_IN_TOPICS: TopicProvider = {
  topics(villager, ctx, flow) {
    switch (villager) {
      case 'bramblewick':
        return [
          question('ask_about_village', 'About the village', flow, BRAMBLEWICK.askAboutVillage),
          question(
            'ask_about_necromancer',
            'About the necromancer',
            flow,
            BRAMBLEWICK.askAboutNecromancer,
          ),
        ];
      case 'merrit':
        return [
          question('ask_about_farm', 'About the farm', flow, MERRIT.askAboutFarm),
          question('ask_about_cows', 'About the cows', flow, MERRIT.askAboutCows),
        ];
      case 'pipkin':
        return [
          question('ask_about_burgers', 'About the burgers', flow, PIPKIN.askAboutBurgers),
          question('ask_about_stew', 'About the stew', flow, PIPKIN.askAboutStew),
        ];
      case 'sella':
        return [question('ask_about_healing', 'About treatment', flow, SELLA.askAboutHealing)];
      case 'vetch':
        return [question('ask_about_town', "How's the town?", flow, VETCH.askAboutTown)];
      case 'nella':
        return [question('ask_about_town', "How's the town?", flow, NELLA.askAboutTown)];
      case 'oren':
        if (!partyOwnsTools(ctx)) return [];
        return [
          question('ask_about_axe', 'About the axe', flow, OREN.askAboutAxe),
          question('ask_about_pickaxe', 'About the pickaxe', flow, OREN.askAboutPickaxe),
          question('where_to_use_tools', 'Where do I use these?', flow, OREN.whereToUseTools),
          question('why_one_upgrade', 'Why only one upgrade?', flow, OREN.sharedUpgradeExplanation),
        ];
      case 'fenna':
        return [
          question(
            'ask_how_lumber_yard_works',
            'How does the mill work?',
            flow,
            FENNA.lumberYardWorksTopic,
          ),
        ];
      case 'garn':
        return [
          question('ask_how_to_gather', 'How do I gather stone?', flow, GARN.askHowToGather),
          question('collection_speed', 'How fast?', flow, GARN.collectionSpeed),
          question(
            'ask_about_trebuchet_ammunition',
            'Trebuchet ammo?',
            flow,
            GARN.askAboutTrebuchetAmmunition,
          ),
        ];
      case 'tikka':
        if (!ctx.party.constructionLearned) return [];
        return [
          {
            key: 'what_can_i_build',
            label: 'What can I build?',
            tone: 'normal',
            repeatable: false,
            grouping: 'question',
            run: (convo) => convo.play(flow.openTopics(tikkaBuildTopics(flow))),
          },
        ];
      case 'cricket':
        return [question('ask_about_village', "How's the village?", flow, CRICKET.askAboutVillage)];
      case 'midge':
        return [
          question(
            'ask_about_necromancer',
            'About the necromancer',
            flow,
            MIDGE.askAboutNecromancer,
          ),
        ];
      // The militia's rows come from their own orders; Wicker has no questions to answer.
      case 'sedge':
      case 'hobb':
      case 'marta':
      case 'pru':
      case 'wicker':
        return [];
    }
  },
};

/** The last row of every conversation. */
export const GOODBYE_LABEL = 'Goodbye';
/** The last row of every submenu. */
export const BACK_LABEL = 'Back';
/** The root menu's row for every question-grouped topic, collected under one submenu. */
export const ASK_QUESTION_LABEL = 'I have a question';
