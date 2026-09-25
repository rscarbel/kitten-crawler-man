/**
 * The choices under a villager's conversation, and the built-in ones every
 * villager is born with.
 *
 * Choices are assembled per conversation from {@link TopicProvider}s, so a
 * shop, the questline or the militia can add rows for their villager without
 * this module knowing they exist. A topic's `run` does whatever the row means
 * — says a line, opens a submenu, opens a shop — through the
 * {@link ConversationController}, which only ever speaks circumstances: the
 * text is always the verbatim table's.
 */

import type { Circumstance, VillagerId } from './ratkinDialogue';
import type { VillagerContext } from './villagerCircumstances';

/** What a topic can do to the conversation it was picked from. */
export interface ConversationController {
  readonly villager: VillagerId;
  /**
   * Shows the villager's line for each circumstance as consecutive pages,
   * then the current choices again. Returns false, and shows nothing, when
   * this villager has no line for one of them.
   */
  say(...circumstances: readonly Circumstance[]): boolean;
  /** Replaces the choice row with a submenu; a "Back" row returning to the top is added for you. */
  showTopics(topics: readonly ConversationTopic[]): void;
  /** Returns to the conversation's top-level choices. */
  showRootTopics(): void;
  close(): void;
  /** Runs once the conversation has closed, however it closed — the place to open a shop panel. */
  afterClose(run: () => void): void;
}

export interface ConversationTopic {
  /** Stable per villager; the gate and focus ring identify rows by it. */
  readonly key: string;
  readonly label: string;
  run(ctl: ConversationController): void;
  /**
   * Most rows are a thing to say or a menu to open once; picking one drops
   * it from the conversation so it is never offered twice. A row that is
   * really a standing control — an order a soldier can be given again and
   * again, "Back" itself — sets this so it keeps coming back.
   */
  readonly repeatable?: boolean;
}

export interface TopicProvider {
  topics(villager: VillagerId, ctx: VillagerContext): readonly ConversationTopic[];
}

/** A topic that answers with one or more lines and returns to the choices. */
function answer(key: string, label: string, ...lines: readonly Circumstance[]): ConversationTopic {
  return { key, label, run: (ctl) => void ctl.say(...lines) };
}

/** Tikka's "What can I build?" submenu, one row per kind of structure. */
function tikkaBuildTopics(): readonly ConversationTopic[] {
  return [
    answer(
      'walls',
      'Walls',
      'wooden_wall_explanation',
      'stone_wall_explanation',
      'fortified_stone_explanation',
      'wall_repair_explanation',
    ),
    answer(
      'trebuchets',
      'Trebuchets',
      'trebuchet_explanation',
      'trebuchet_ammo_explanation',
      'trebuchet_repair_explanation',
    ),
    answer('snares', 'Snares', 'snare_explanation'),
  ];
}

function partyOwnsTools(ctx: VillagerContext): boolean {
  return ctx.party.axeTier !== null || ctx.party.pickaxeTier !== null;
}

/**
 * The questions any villager can be asked, from the `ask_*` lines they have,
 * plus the few answers that only make sense once the party has what they are
 * about (Oren's tools, Tikka's Construction).
 */
export const BUILT_IN_TOPICS: TopicProvider = {
  topics(villager, ctx) {
    switch (villager) {
      case 'bramblewick':
        return [
          answer('ask_about_village', 'About the village', 'ask_about_village'),
          answer('ask_about_necromancer', 'About the necromancer', 'ask_about_necromancer'),
        ];
      case 'merrit':
        return [
          answer('ask_about_farm', 'About the farm', 'ask_about_farm'),
          answer('ask_about_cows', 'About the cows', 'ask_about_cows'),
        ];
      case 'pipkin':
        return [
          answer('ask_about_burgers', 'About the burgers', 'ask_about_burgers'),
          answer('ask_about_stew', 'About the stew', 'ask_about_stew'),
        ];
      case 'sella':
        return [answer('ask_about_healing', 'About treatment', 'ask_about_healing')];
      case 'vetch':
      case 'nella':
        return [answer('ask_about_town', "How's the town?", 'ask_about_town')];
      case 'oren':
        if (!partyOwnsTools(ctx)) return [];
        return [
          answer('ask_about_axe', 'About the axe', 'ask_about_axe'),
          answer('ask_about_pickaxe', 'About the pickaxe', 'ask_about_pickaxe'),
          answer(
            'where_to_use_tools',
            'Where do I use these?',
            'directions_to_lumber_yard',
            'directions_to_quarry',
          ),
          answer('why_one_upgrade', 'Why only one upgrade?', 'shared_upgrade_explanation'),
        ];
      case 'fenna':
        return [
          answer(
            'ask_how_lumber_yard_works',
            'How does the mill work?',
            'ask_how_lumber_yard_works',
            'manual_processing_instructions',
          ),
        ];
      case 'garn':
        return [
          answer('ask_how_to_gather', 'How do I gather stone?', 'ask_how_to_gather'),
          answer('collection_speed', 'How fast?', 'collection_speed'),
          answer(
            'ask_about_trebuchet_ammunition',
            'Trebuchet ammo?',
            'ask_about_trebuchet_ammunition',
          ),
        ];
      case 'tikka':
        if (!ctx.party.constructionLearned) return [];
        return [
          {
            key: 'what_can_i_build',
            label: 'What can I build?',
            run: (ctl) => ctl.showTopics(tikkaBuildTopics()),
          },
        ];
      case 'cricket':
        return [answer('ask_about_village', "How's the village?", 'ask_about_village')];
      case 'midge':
        return [answer('ask_about_necromancer', 'About the necromancer', 'ask_about_necromancer')];
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
export const BACK_TOPIC_KEY = 'back';
export const BACK_LABEL = 'Back';
