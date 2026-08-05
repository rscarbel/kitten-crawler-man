import type { StatName } from '../Player';
import type { SkillId } from './SkillManager';

export type ItemId =
  | 'health_potion'
  | 'speed_fizz'
  | 'jugg_juice'
  | 'cooldown_crisp'
  | 'stat_boost_potion'
  | 'dirty_shirley'
  | 'enchanted_bigboi_boxers'
  | 'trollskin_shirt'
  | 'enchanted_crown_sepsis_whore'
  | 'scroll_of_confusing_fog'
  | 'goblin_dynamite'
  | 'gym_dumbbell'
  | 'gym_bench_press'
  | 'gym_treadmill'
  | 'quest_wood_board'
  | 'magic_missile_tome'
  | 'smush_tome'
  | 'doomsday_scenario'
  | 'skill_book_cockroach'
  | 'skill_book_cat_reflexes'
  | 'skill_book_pugilism'
  | 'skill_book_iron_stomach'
  | 'skill_book_night_vision';

export type EquipSlot = 'Head' | 'Torso' | 'Legs' | 'Feet' | 'Hands';

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion, ability) may be placed in the hotbar. */
  canHotlist: boolean;
  type?: 'consumable' | 'armor';
  equipSlot?: EquipSlot;
  equipSubSlot?: string;
  description?: string;
  statBonus?: Partial<Record<StatName, number>>;
  /** References an active ability this item grants when equipped. */
  abilityId?: string;
  /** Skill this item teaches when used. Set on skill books. */
  skillId?: SkillId;
  /**
   * A potion that can be drunk straight from the bag, without first assigning it
   * to a hotbar slot. Drives the context menu's Drink entry.
   */
  drinkable?: boolean;
  /** When true, hotbar slot renders with a lighter quest-item colour. */
  isQuestItem?: boolean;
  /**
   * When false, the item cannot be dragged out of the hotbar via normal
   * inventory interaction or dropped on the ground. Only the Abilities UI
   * can move it. Defaults to true when omitted.
   */
  canDrop?: boolean;
  /** Multiplier applied to the player's HP regen rate while this item is equipped. Stacks multiplicatively with other sources. */
  regenMultiplier?: number;
}

export const ITEM_DEF: Record<ItemId, Omit<InventoryItem, 'quantity'>> = {
  scroll_of_confusing_fog: {
    id: 'scroll_of_confusing_fog',
    name: 'Scroll of Confusing Fog',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'Summons a thick fog cloud around the caster. Any enemy caught inside the fog loses all sense of sight and cannot target any entity. Lasts INT × 5 seconds.',
  },
  dirty_shirley: {
    id: 'dirty_shirley',
    name: 'The Dirty Shirley',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    description:
      'The Desperado Club’s signature: grenadine, ginger ale, a cherry, and far too much vodka. ' +
      'Restores health and grants liquid courage. You will be drunk.',
  },
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
  },
  speed_fizz: {
    id: 'speed_fizz',
    name: 'Speed Fizz',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    description:
      'Doubles your movement speed for 25 seconds. Cannot be stacked while a previous Speed Fizz is active.',
  },
  jugg_juice: {
    id: 'jugg_juice',
    name: 'Jugg Juice',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    description:
      'Temporarily boosts your max HP by 50% + 5 and heals you to full for 30 seconds. ' +
      'When the effect expires, max HP returns to normal.',
  },
  cooldown_crisp: {
    id: 'cooldown_crisp',
    name: 'Cooldown Crisp',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    description:
      'Halves all ability cooldown timers for 25 seconds. Cannot be stacked while a previous Cooldown Crisp is active.',
  },
  stat_boost_potion: {
    id: 'stat_boost_potion',
    name: 'Stat Boost',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    description:
      'Permanently increases one randomly chosen stat (STR, INT, CON, or DEX) by 2 to 4 points.',
  },
  goblin_dynamite: {
    id: 'goblin_dynamite',
    name: 'Goblin Dynamite',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A hissing stick of goblin-made dynamite. Only the Human can throw it. ' +
      'Hold the hotbar key to charge your throw — release to hurl it. ' +
      'Tap it to drop it at your feet. Warning: holding too long has consequences.',
  },
  gym_dumbbell: {
    id: 'gym_dumbbell',
    name: 'Dumbbell',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A heavy iron dumbbell. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_bench_press: {
    id: 'gym_bench_press',
    name: 'Bench Press',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A full bench press machine. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_treadmill: {
    id: 'gym_treadmill',
    name: 'Treadmill',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A sturdy treadmill. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  trollskin_shirt: {
    id: 'trollskin_shirt',
    name: 'Enchanted Trollskin Shirt of Pummeling',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { constitution: 3 },
    regenMultiplier: 2.5,
    description:
      'The wearer of this shirt gains +7 to the Regeneration skill. In addition, ' +
      'all melee-based damage debuffs such as Stun, Knockback, Disarm, and ' +
      'Out-of-Breath are negated.',
  },
  enchanted_crown_sepsis_whore: {
    id: 'enchanted_crown_sepsis_whore',
    name: 'Enchanted Crown of the Sepsis Whore',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { intelligence: 5 },
    description:
      'Imbues the wearer with +5 Intelligence. All attacks, including ' +
      'magical attacks, now have a 15% chance to inflict the Sepsis debuff. ' +
      'Sepsis is a health-sapping curse that slowly drains the life of its ' +
      'victim until they perish.',
  },
  magic_missile_tome: {
    id: 'magic_missile_tome',
    name: 'Magic Missile',
    stackable: false,
    canHotlist: true,
    canDrop: false,
    type: 'consumable',
    abilityId: 'magic_missile',
    description:
      'Channels arcane energy into a bolt of pure magic. Only the Cat can fire it. ' +
      'Place on the hotbar and press the assigned key to fire.',
  },
  quest_wood_board: {
    id: 'quest_wood_board',
    name: 'Boards of Wood',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    isQuestItem: true,
    description:
      'Wooden boards scavenged from the wood pile. Place near floor grates to build ' +
      'barriers against Bugaboos. Only the Human can build or repair. Costs 4 boards.',
  },
  smush_tome: {
    id: 'smush_tome',
    name: 'Smush',
    stackable: false,
    canHotlist: true,
    canDrop: false,
    type: 'consumable',
    abilityId: 'smush',
    description:
      'Use the crushing power of your bare feet to pound enemies into the ground with explosive force. ' +
      'Only the Human can use it. Place on the hotbar and press the assigned key to activate.',
  },
  skill_book_cockroach: {
    id: 'skill_book_cockroach',
    name: 'Skill Book: Cockroach',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'cockroach',
    description:
      'Smells faintly of insecticide and spite. Only the Cat can learn from it. ' +
      'Teaches you to survive the blow that was supposed to end the episode. ' +
      'A second copy makes you better at it, which says something unkind about your prospects.',
  },
  skill_book_cat_reflexes: {
    id: 'skill_book_cat_reflexes',
    name: 'Skill Book: Cat-like Reflexes',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'cat_reflexes',
    description:
      'Written by something that was very fast right up until it was not. ' +
      'Only the Cat can learn from it. Improves your chance to be somewhere else when the hit lands.',
  },
  skill_book_pugilism: {
    id: 'skill_book_pugilism',
    name: 'Skill Book: Pugilism',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'pugilism',
    description:
      'Twelve pages of diagrams, all of them a fist. Only the Human can learn from it. ' +
      'Every level makes your melee hurt more, which the sponsors describe as "content".',
  },
  skill_book_iron_stomach: {
    id: 'skill_book_iron_stomach',
    name: 'Skill Book: Iron Stomach',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'iron_stomach',
    description:
      'Sticky. Do not ask with what. Either crawler can learn from it. ' +
      'Potions come back round faster, and the room stops spinning sooner.',
  },
  skill_book_night_vision: {
    id: 'skill_book_night_vision',
    name: 'Skill Book: Night Vision',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'night_vision',
    description:
      'The ink is only legible in the dark, which the author found hilarious. ' +
      'Only the Cat can learn from it. Widens how far she sees when she is the one leading.',
  },
  enchanted_bigboi_boxers: {
    id: 'enchanted_bigboi_boxers',
    name: 'Enchanted BigBoi Boxers',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    equipSlot: 'Legs',
    equipSubSlot: 'Pants',
    statBonus: { constitution: 2 },
    abilityId: 'protective_shell',
    description:
      'Have you ever read an Incredible Hulk comic and thought to yourself, ' +
      'everything rips off of his body except his pants? No way. Well, spoiler alert. ' +
      "You're not wrong. Size-altering and were-creatures, such as the BigBoi are " +
      'required to wear enchanted, self-sizing items lest they wish to turn the dungeon ' +
      'into a nudist colony when they transform. That means everything they wear requires ' +
      'an enchantment. Everything, including their naughty little undies.',
  },
  doomsday_scenario: {
    id: 'doomsday_scenario',
    name: "Carl's Doomsday Scenario",
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    description:
      'A soul crystal on the verge of levelling a city, sealed inside an enchanted glass ' +
      'display case and stuffed into your inventory. Not a weapon. Not yet, anyway.',
  },
};

export const SLOT_COUNT = 32;
export const HOTBAR_COUNT = 8;
export const SLOTS_PER_PAGE = 16; // 4 × 4 grid
/** Last hotbar slot index, reserved for quest items. */
export const QUEST_SLOT_IDX = HOTBAR_COUNT - 1; // slot 7

/** Sub-slots available in each equipment slot. */
export const EQUIP_SUBSLOTS: Record<EquipSlot, string[]> = {
  Head: ['Hat', 'Face', 'Neck'],
  Torso: ['Shirt', 'Jacket', 'Back'],
  Legs: ['Pants', 'Knee Pads'],
  Hands: ['Gloves', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4'],
  Feet: ['Shoes', 'Toe Ring 1', 'Toe Ring 2', 'Toe Ring 3', 'Toe Ring 4'],
};

export function isItemId(s: string): s is ItemId {
  return s in ITEM_DEF;
}
