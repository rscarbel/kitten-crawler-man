/**
 * Lines that no conversation opens with: they are spoken in the middle of a
 * flow — a purchase, an order to a soldier, a lesson, a bark in the heat of
 * the siege — by the system that owns the flow, through
 * `ConversationController.say` or a bark.
 *
 * This is the register of who owns which, in two lists. `VILLAGER_FLOW_LINES`
 * holds the lines an owner actually speaks today. `PENDING_FLOW_LINES` holds
 * lines an owner is meant to speak but does not yet — the shops, the
 * questline and the militia before their systems exist. When an owner starts
 * speaking a line, it moves the line from pending to wired; the dialogue gate
 * reports every pending line by name, so what is still silent stays visible.
 *
 * A line in the verbatim table that neither the opening resolver, the
 * built-in topics, the village's own barks, nor either list accounts for is
 * a line nobody has taken on, and fails the gate.
 */

import type { Circumstance, VillagerId } from './ratkinDialogue';

export interface FlowLine {
  readonly villager: VillagerId;
  readonly circumstance: Circumstance;
}

/** Who speaks a flow line: the shops and services, the questline, or the militia. */
export type FlowOwner = 'services' | 'quest' | 'soldiers';

function lines(villager: VillagerId, ...circumstances: readonly Circumstance[]): FlowLine[] {
  return circumstances.map((circumstance) => ({ villager, circumstance }));
}

/** Flow lines an owner speaks today. */
export const VILLAGER_FLOW_LINES: Readonly<Record<FlowOwner, readonly FlowLine[]>> = {
  services: [
    ...lines('pipkin', 'shop_open', 'buy_burger', 'buy_stew', 'cannot_afford'),
    ...lines(
      'sella',
      'service_menu',
      'buy_healing',
      'healing_complete',
      'cannot_afford',
      'fully_healthy',
    ),
    ...lines('vetch', 'shop_open'),
    ...lines(
      'oren',
      'shop_open',
      'axe_upgrade_available',
      'pickaxe_upgrade_available',
      'already_max_axe',
      'already_max_pickaxe',
      'cannot_afford_upgrade',
      'upgrade_purchased',
    ),
    ...lines(
      'fenna',
      'bulk_processing_service',
      'bulk_processing_boards_selected',
      'bulk_processing_rope_selected',
      'bulk_processing_fee_explanation',
      'bulk_processing_complete',
      'bulk_processing_insufficient_fee',
      'no_logs',
      'construction_experience',
    ),
    ...lines(
      'oren',
      'grant_basic_tools',
      'basic_tools_already_owned',
      'explain_resource_gathering',
      'resourcing_skill_granted',
      'resourcing_skill_already_granted',
    ),
  ],
  quest: [
    ...lines(
      'bramblewick',
      'quest_offer',
      'quest_accepted',
      'quest_declined',
      'before_tools',
      'tools_obtained',
      'resourcing_unlocked',
      'construction_unlocked',
      'fortifications_started',
      'fortifications_advanced',
      'after_village_damage',
      'quest_complete',
    ),
    ...lines(
      'tikka',
      'quest_explanation',
      'tools_required',
      'axe_task',
      'pickaxe_task',
      'wood_processing_task',
      'construction_explanation',
      'construction_skill_granted',
      'construction_skill_already_granted',
      'construction_tutorial_trigger',
    ),
  ],
  soldiers: [
    ...lines('sedge', 'command_follow', 'command_stay', 'command_patrol', 'patrol_return'),
    ...lines('sedge', 'enemy_spotted'),
    ...lines('hobb', 'command_follow', 'command_stay', 'command_patrol', 'patrol_return'),
    ...lines('hobb', 'gate_under_attack'),
    ...lines('marta', 'command_follow', 'command_stay', 'command_patrol', 'patrol_return'),
    ...lines('pru', 'command_follow', 'command_stay', 'command_patrol', 'patrol_return'),
  ],
};

/** Flow lines an owner is meant to speak but does not yet. Move each to `VILLAGER_FLOW_LINES` as it is wired. */
export const PENDING_FLOW_LINES: Readonly<Record<FlowOwner, readonly FlowLine[]>> = {
  services: [],
  quest: [],
  soldiers: [],
};
