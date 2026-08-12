import type { StatName } from '../Player';
import type { CrawlerKind, SkillId } from './SkillManager';

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
  | 'issue_kettle_helm'
  | 'padded_gambeson'
  | 'riveted_bracers'
  | 'marching_boots'
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
  | 'skill_book_night_vision'
  | 'nightgaunt_cloak'
  | 'slate_butterfly_talisman'
  | 'fae_scale_crupper'
  | 'bracelet_of_dex'
  | 'splatter_skunk_toe_ring'
  | 'shade_gnoll_kneepads'
  | 'grull_war_gauntlet'
  | 'slingshot'
  | 'wayfinders_anchor'
  | 'anchor_shard_tinker'
  | 'anchor_shard_hilda'
  | 'anchor_shard_temple'
  | 'magistrates_writ'
  | 'unreadable_letter';

export type EquipSlot = 'Head' | 'Torso' | 'Legs' | 'Feet' | 'Hands';

/**
 * Damage channels an item can protect against.
 *
 * `'ice'` has no damage source in the game yet: any future ice attack must
 * consult `Player.resists('ice')` at the point it damages a crawler, or the
 * resistance silently does nothing.
 */
export type ResistanceType = 'poison' | 'ice' | 'piercing';

/** Every damage channel gear can resist, for surfaces that summarise all of them. */
export const ALL_RESISTANCE_TYPES = [
  'poison',
  'ice',
  'piercing',
] as const satisfies readonly ResistanceType[];

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion, ability) may be placed in the hotbar. */
  canHotlist: boolean;
  type?: 'consumable' | 'armor' | 'weapon';
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
  /** Damage channels this item resists while equipped. */
  resistances?: ResistanceType[];
  /** Fraction of incoming mob melee damage reflected back at the attacker while equipped. */
  damageReflectPct?: number;
  /** While equipped, momentum-based attacks (e.g. the Ball of Swine's trample) are cancelled on contact. */
  cancelsMomentum?: boolean;
  /** Effective skill-level bonus granted while equipped; stacks with the trained level, capped at the skill's max. */
  skillLevelBonus?: Partial<Record<SkillId, number>>;
  /** Stat bonus that applies only to melee damage computation, not to the general stat. */
  meleeOnlyStatBonus?: Partial<Record<StatName, number>>;
  /** Chance per successful melee hit to stun the target while equipped. */
  stunOnHitChance?: number;
  /** Which crawler can equip this item; omitted means either. */
  wearer?: CrawlerKind;
}

/**
 * Armour carrying both halves of an equip address — the only shape of item that
 * can actually be worn.
 */
export type WearableItem = InventoryItem & {
  type: 'armor';
  equipSlot: EquipSlot;
  equipSubSlot: string;
};

/** Narrows an item to the wearable shape {@link WearableItem} describes. */
export function isWearable(item: InventoryItem | null | undefined): item is WearableItem {
  return item?.type === 'armor' && item.equipSlot !== undefined && item.equipSubSlot !== undefined;
}

/** Fraction of a melee blow the shade gnoll kneepads throw back at whoever landed it. */
export const KNEEPADS_DAMAGE_REFLECT_PCT = 0.1;
/** Chance per landed melee hit that the Grull war gauntlet stuns its target. */
export const GAUNTLET_STUN_CHANCE = 0.02;

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
    canHotlist: false,
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
    canHotlist: false,
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
  // The garrison's issue kit. Mundane on purpose: no enchantment, no ability, a
  // single stat point each. It is what the quartermaster can hand across a
  // counter in a town whose supply requisition has been deferred eleven times,
  // and it is the only armour in the game a crawler can simply buy.
  issue_kettle_helm: {
    id: 'issue_kettle_helm',
    name: 'Issue Kettle Helm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { constitution: 1 },
    description:
      'A wide-brimmed iron pot with a chin strap and somebody else’s dent in the crown. ' +
      'The garrison issues these by the dozen because the things falling on you down there ' +
      'mostly fall from above.',
  },
  padded_gambeson: {
    id: 'padded_gambeson',
    name: 'Padded Gambeson',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { constitution: 2 },
    description:
      'Twenty layers of linen quilted flat and stitched through. Stops a tooth, spreads a club, ' +
      'and stinks. The quartermaster does not wash the insides and will explain why at length.',
  },
  riveted_bracers: {
    id: 'riveted_bracers',
    name: 'Riveted Bracers',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    statBonus: { strength: 1 },
    description:
      'Boiled leather over the forearm, riveted at four points. Meant for the arm you block with, ' +
      'which the drill sergeant insists is also the arm you swing with.',
  },
  marching_boots: {
    id: 'marching_boots',
    name: 'Marching Boots',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { dexterity: 1 },
    description:
      'Hobnailed, hard-soled, and broken in by a man who is not coming back for them. ' +
      'Everything on this floor is faster than you. These make it less true.',
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
      'barriers against Bugaboos. Only the Human can build or repair. Costs 4 boards. ' +
      'Old Hilda takes the same boards for her broken furniture, at 2 a mend.',
  },
  wayfinders_anchor: {
    id: 'wayfinders_anchor',
    name: "Wayfinder's Anchor",
    stackable: false,
    canHotlist: true,
    canDrop: false,
    type: 'consumable',
    description:
      'Three shards of a seer’s stone, welded back into one and humming like a struck bell. ' +
      'Out in the Over City it pulls the whole party back to the town square, and remembers where ' +
      'it took you from. Used in the square, it puts you back on that spot. One minute between ' +
      'trips. It stays dead underground, during a boss fight, and with anything hostile close by.',
  },
  // The three shards are ordinary undroppable bag items rather than `isQuestItem`
  // ones: the quest flag routes an item into the single reserved hotbar slot, and
  // a second quest item there overwrites the first. Three of them at once would
  // silently eat each other.
  anchor_shard_tinker: {
    id: 'anchor_shard_tinker',
    name: 'Anchor Shard (Scrap)',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      'A wedge of grey stone the tinker had priced as scrap, still warm to the touch. ' +
      'Madame Voss can weld it to its brothers.',
  },
  anchor_shard_hilda: {
    id: 'anchor_shard_hilda',
    name: 'Anchor Shard (Hearth)',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      'Old Hilda kept this one under a chair leg for thirty years. It gave it up gladly. ' +
      'Madame Voss can weld it to its brothers.',
  },
  anchor_shard_temple: {
    id: 'anchor_shard_temple',
    name: 'Anchor Shard (Altar)',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      'Chipped from the Temple of the Sky’s altar stone, and cold no matter how long you hold it. ' +
      'Madame Voss can weld it to its brothers.',
  },
  // Same reasoning as the anchor shards above: two `isQuestItem` items would
  // fight over the single reserved quest slot, and the Krasue murder mystery
  // hands the party both the writ and the letter at once.
  magistrates_writ: {
    id: 'magistrates_writ',
    name: "Magistrate's Writ",
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      "'The bearer acts on my authority and is not to be detained.' Signed, Magistrate " +
      'Featherfall. The ink is barely dry. The magistrate has not been seen in weeks.',
  },
  unreadable_letter: {
    id: 'unreadable_letter',
    name: 'The Unreadable Letter',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      'Squiggles and triangles in a brown ink you are choosing not to think about. Mordecai ' +
      'called it necro-script and told you to burn it. It is warm.',
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
  nightgaunt_cloak: {
    id: 'nightgaunt_cloak',
    name: 'Enchanted Nightgaunt Cloak of Stoutness',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Back',
    wearer: 'human',
    statBonus: { constitution: 4 },
    resistances: ['poison', 'ice', 'piercing'],
    description:
      'The wearer of this cloak gains +4 to Constitution and becomes resistant to poison and ' +
      'ice-based attacks. In addition, the cloak adds Anti-Piercing resistance to all worn armor. ' +
      'It also makes you look like a dollar store Batman.',
  },
  slate_butterfly_talisman: {
    id: 'slate_butterfly_talisman',
    name: 'Talisman of the Slate Butterfly',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    wearer: 'cat',
    statBonus: { dexterity: 4, intelligence: 1 },
    // The fairy-pacification clause is fiction with no consumer: nothing winged
    // and fae exists to be pacified yet. Any fairy creature added later owes it
    // an implementation — its `Mob.acquireTarget` `accept` predicate must refuse
    // a wearer of this talisman, and its `noticeTarget` / `forceAggro` paths must
    // guard on the same thing, or an aggro channel that bypasses targeting will
    // make the charm silently a lie.
    description:
      'The Talisman of the Slate Butterfly is a small silver butterfly charm on a small silver ' +
      'ring, so it can be attached to collars or other jewelry. It jingles when it moves. Adds +4 ' +
      'to the Dexterity Skill. Adds +1 to Intelligence. Winged fairies will no longer be ' +
      'automatically hostile toward you.',
  },
  fae_scale_crupper: {
    id: 'fae_scale_crupper',
    name: 'Enchanted Fae Scale Quadruped Crupper of the Fleet',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Jacket',
    wearer: 'cat',
    statBonus: { dexterity: 2 },
    description:
      'Light and flexible, this scale armor is made from Fae Steel. While not as strong as Elven ' +
      "mail or even good Orcish steel, it's the strongest alloy that fairy folk can wear. It's " +
      "not the best protection, but it'll make your ass look oh so pretty.",
  },
  bracelet_of_dex: {
    id: 'bracelet_of_dex',
    name: 'Bracelet of +2 DEX',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    wearer: 'cat',
    statBonus: { dexterity: 2 },
    description: 'An agility boosting accessory equipped on the front leg.',
  },
  splatter_skunk_toe_ring: {
    id: 'splatter_skunk_toe_ring',
    name: 'Enchanted Toe Ring of the Splatter Skunk',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Feet',
    equipSubSlot: 'Toe Ring',
    wearer: 'human',
    statBonus: { strength: 3 },
    skillLevelBonus: { pugilism: 3 },
    description:
      "Imbues wearer with +3 Strength and gives +3 to the Pugilism Skill. Also, it's a toe ring. " +
      "It's probably uncomfortable and it makes you look like one of those hippie assholes who " +
      'sit around in a field juggling and hula-hooping all day.',
  },
  shade_gnoll_kneepads: {
    id: 'shade_gnoll_kneepads',
    name: 'Enchanted Spiked Kneepads of the Shade Gnoll Riot Forces',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Legs',
    equipSubSlot: 'Knee Pads',
    wearer: 'human',
    damageReflectPct: KNEEPADS_DAMAGE_REFLECT_PCT,
    cancelsMomentum: true,
    description:
      'Adds 10% Damage Reflect to all equipped armor. Cancels all Momentum-based attacks. Made of ' +
      'skin and fur and the spiky things from the back of Thorn Cadavers, these kneepads are both ' +
      "good protection and they're stylish. Stylish, that is, if your knees are cosplaying as " +
      'hedgehogs.',
  },
  grull_war_gauntlet: {
    id: 'grull_war_gauntlet',
    name: 'Enchanted War Gauntlet of the Exalted Grull',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    wearer: 'human',
    statBonus: { dexterity: 1 },
    meleeOnlyStatBonus: { strength: 3 },
    skillLevelBonus: { iron_punch: 2, powerful_strike: 1 },
    stunOnHitChance: GAUNTLET_STUN_CHANCE,
    description:
      'A wrist bracer that transforms into a spiked war gauntlet made of orcish steel when the ' +
      'hand is shaped into a fist. Grants +3 Strength (in fist mode only), +1 Dexterity, +2 skill ' +
      'levels to the Iron Punch skill, +1 skill level to the Powerful Strike skill, and a 2% ' +
      'chance to Stun an enemy on a successful hit.',
  },
  slingshot: {
    id: 'slingshot',
    name: 'Slingshot & Rocks',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    wearer: 'human',
    description:
      'Slingshots are small, handheld, hand-powered projectile weapons typically made with a ' +
      'Y-shaped frame with an elastic strip tied to the ends of each prong. On Earth, slingshots ' +
      'are common toys but have also been used as military weapons by guerilla forces. During the ' +
      "Siege of Marawi in 2017, the Philippine Army's elite Scout Rangers used slingshots to hurl " +
      'grenades at opposing forces.',
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

const SUBSLOT_INDEX_SUFFIX = / \d+$/;

/** Strips a trailing slot index so 'Ring 3' and 'Ring' share the family 'Ring'. */
export function subSlotFamily(subSlot: string): string {
  return subSlot.replace(SUBSLOT_INDEX_SUFFIX, '');
}

/**
 * True when an item declaring `equipSubSlot` belongs in the named sub-slot.
 *
 * Items that fit several interchangeable slots declare the family name
 * ('Ring'), so the comparison is family-to-family; single-slot items are
 * unaffected because a name without an index is its own family.
 */
export function itemFitsSubSlot(
  item: Pick<InventoryItem, 'equipSubSlot'>,
  subSlot: string,
): boolean {
  if (!item.equipSubSlot) return false;
  return subSlotFamily(item.equipSubSlot) === subSlotFamily(subSlot);
}

export function isItemId(s: string): s is ItemId {
  return s in ITEM_DEF;
}

/**
 * The three pieces the Wayfinder's Anchor is welded from, in the order the
 * questline hands them out.
 *
 * One list rather than three literals repeated per caller: the icon switch, the
 * assembly transaction and the Journal all have to agree on what "all three"
 * means, and a fourth shard would otherwise have to be remembered in each.
 */
export const ANCHOR_SHARD_IDS = [
  'anchor_shard_tinker',
  'anchor_shard_hilda',
  'anchor_shard_temple',
] as const satisfies readonly ItemId[];

export type AnchorShardId = (typeof ANCHOR_SHARD_IDS)[number];

/** Whether an item is one of the Anchor's shards — they share a single icon. */
export function isAnchorShardId(id: ItemId): id is AnchorShardId {
  const shardIds: readonly ItemId[] = ANCHOR_SHARD_IDS;
  return shardIds.includes(id);
}

/**
 * Whether an item is allowed to occupy a hotbar slot.
 *
 * Always ask this rather than reading `canHotlist` off an inventory instance:
 * bag and hotbar entries are spread copies of the def taken when the item was
 * picked up, so an item sitting in an old save still carries whatever the flag
 * was that day. The def is the only current answer.
 */
export function itemCanHotlist(id: ItemId): boolean {
  return ITEM_DEF[id].canHotlist;
}
