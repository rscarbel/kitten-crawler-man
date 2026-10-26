import { crawlerName } from '../../../characters/characters';
import type { StatName } from '../../../Player';
import type { CrawlerKind, SkillId } from '../../skills/SkillManager';
import type {
  MouthCarryVisualId,
  WorkingToolHeldVisualId,
} from '../../../sprites/held/heldVisualIds';
import type { LookOnEach, WearerLook } from '../../../sprites/garments/garmentIds';
import {
  toolTierDef,
  TOOL_TIER_BASIC,
  TOOL_TIER_HARDENED,
  TOOL_TIER_LONG_HAFT,
  TOOL_TIER_RATKIN_FORGE,
  TOOL_TIER_DEEPWOOD,
  TOOL_TIER_GRAVEYARD,
  type ToolKind,
  type ToolTier,
} from '../gathering/toolTiers';
import type { Rarity } from './rarity';
import type { GearTrait } from '../../../gear/traits';
import type { GearSetId } from '../../../gear/sets';
import { GEAR_CATALOGUE } from '../../../gear/catalogue';
import { defineItemDefs } from './itemNameRules';
import {
  HUMAN_ARM_REACH_TILES,
  PROVING_WEAPON_DAMAGE_MULTIPLIER,
  type ClawWeaponStats,
  type HandWeaponStats,
  type WeaponStats,
} from '../equipment/weapons';

export type ItemId =
  | 'health_potion'
  | 'speed_fizz'
  | 'jugg_juice'
  | 'cooldown_crisp'
  | 'stat_boost_potion'
  | 'dirty_shirley'
  | 'scroll_of_confusing_fog'
  | 'goblin_dynamite'
  | 'black_powder_bomb'
  | 'gym_dumbbell'
  | 'gym_bench_press'
  | 'gym_treadmill'
  | 'quest_wood_board'
  | 'magic_missile_tome'
  | 'smush_tome'
  | 'explosives_handling_tome'
  | 'doomsday_scenario'
  | 'quest_scythe'
  | 'quest_blueprints'
  | 'quest_prison_key'
  | 'skill_book_cockroach'
  | 'skill_book_cat_reflexes'
  | 'skill_book_pugilism'
  | 'skill_book_iron_stomach'
  | 'lucky_hoodie'
  | 'scrappers_wraps'
  | 'hobnail_boots'
  | 'riot_kneeguards'
  | 'iron_knuckle_gauntlet'
  | 'patched_duster'
  | 'hazard_goggles'
  | 'demolition_apron'
  | 'foremans_hardhat'
  | 'silkspinner_gloves'
  | 'hamhock_boots'
  | 'rebar_shiv'
  | 'pipe_wrench'
  | 'rattlestick_sling'
  | 'fire_axe'
  | 'gravediggers_spade'
  | 'stormcaller'
  | 'the_last_word'
  | 'pot_lid_buckler'
  | 'velvet_harness'
  | 'mousehide_booties'
  | 'plumed_coat'
  | 'stargazers_cap'
  | 'moonmoth_pendant'
  | 'kaleidoscope_specs'
  | 'halo_of_the_ninth_life'
  | 'prowler_hood'
  | 'prowler_mantle'
  | 'prowler_booties'
  | 'tin_claw_caps'
  | 'venom_claws'
  | 'frostbite_claws'
  | 'prowler_claws'
  | 'ink_dipped_claws'
  | 'sunsteel_talons'
  | 'hearthguard_cap'
  | 'hearthguard_quilted_vest'
  | 'hearthguard_bracers'
  | 'hearthguard_boots'
  | 'scrapmail_vest'
  | 'cockscomb_crest'
  | 'stoneheart_amulet'
  | 'sun_locket'
  | 'moon_locket'
  | 'showmans_top_hat'
  | 'sequin_tailcoat'
  | 'gilded_monocle'
  | 'grinning_mask'
  | 'nimble_bangle'
  | 'lucky_penny'
  | 'fang_charm'
  | 'frostward_charm'
  | 'emberward_charm'
  | 'fae_iron_charm'
  | 'hourglass_charm'
  | 'ember_wisp'
  | 'ward_stone'
  | 'sproutling_seed'
  | 'dev_plain_sword'
  | 'dev_spiked_club'
  | 'dev_felling_axe'
  | 'wayfinders_anchor'
  | 'anchor_shard_tinker'
  | 'anchor_shard_hilda'
  | 'anchor_shard_temple'
  | 'magistrates_writ'
  | 'unreadable_letter'
  | 'wood'
  | 'stone'
  | 'wood_board'
  | 'rope'
  | 'basic_axe'
  | 'hardened_axe'
  | 'lumberjacks_axe'
  | 'ratkin_forge_axe'
  | 'deepwood_cleaver'
  | 'graveyards_bane'
  | 'basic_pickaxe'
  | 'hardened_pickaxe'
  | 'quarrymans_pick'
  | 'ratkin_forge_pick'
  | 'stonebreaker'
  | 'worldscar_pick'
  | 'hamburger'
  | 'hollow_stew'
  | 'trebuchet_kit'
  | 'snare_kit';

/**
 * The equipment sections. `Weapon` holds what a crawler fights with (the
 * human's main and off hand, the cat's claws, and either one's relic); the rest
 * are worn.
 */
export const EQUIP_SLOTS = [
  'Weapon',
  'Head',
  'Torso',
  'Legs',
  'Hands',
  'Feet',
  'Trinkets',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Every sub-slot either crawler has, by the id gear fits it by. */
export const SUB_SLOT_IDS = [
  'Main',
  'Off',
  'Claws',
  'Relic',
  'Hat',
  'Face',
  'Neck',
  'Shirt',
  'Jacket',
  'Back',
  'Pants',
  'Knees',
  'Gloves',
  'Shoes',
  'Trinket 1',
  'Trinket 2',
] as const;
export type SubSlotId = (typeof SUB_SLOT_IDS)[number];

/**
 * The sub-slot an item declares: one sub-slot, or the family of
 * interchangeable ones it fits any of (a trinket goes in either trinket slot).
 */
export type ItemSubSlot = Exclude<SubSlotId, 'Trinket 1' | 'Trinket 2'> | 'Trinket';

/** Who may equip an item: one crawler, or either. */
export type Wearer = CrawlerKind | 'both';

/** Whether gear restricted to `wearer` can go on a crawler of `kind`. */
export function wearerAllows(wearer: Wearer, kind: CrawlerKind): boolean {
  return wearer === 'both' || wearer === kind;
}

/**
 * Damage channels an item can protect against.
 *
 * A resistance only works where the damage is dealt asks for it: hits go
 * through `Player.resistedDamage` (ice fairy bolts as `'ice'`, goblin arrows
 * and skeleton projectiles as `'piercing'`), and poison status ticks check
 * `'poison'` themselves. A new attack of one of these kinds must ask too, or
 * the resistance silently does nothing against it.
 */
export type ResistanceType = 'poison' | 'ice' | 'piercing';

/** Every damage channel gear can resist, for surfaces that summarise all of them. */
export const ALL_RESISTANCE_TYPES = [
  'poison',
  'ice',
  'piercing',
] as const satisfies readonly ResistanceType[];

/**
 * The fairy magics a ring can make its wearer immune to. Separate from
 * {@link ResistanceType} because the immunity is to the fairy, not the
 * element: a fairy ring stops a fire fairy's fireball but not a lava llama's.
 */
export type FairyElement = 'ice' | 'fire';

/** Every fairy element, in the order the worn-gear summary lists them. */
export const ALL_FAIRY_ELEMENTS = ['ice', 'fire'] as const satisfies readonly FairyElement[];

export interface InventoryItem {
  id: ItemId;
  name: string;
  quantity: number;
  stackable: boolean;
  /** Only items with an action (e.g. potion, ability) may be placed in the hotbar. */
  canHotlist: boolean;
  type?: 'consumable' | 'armor' | 'weapon' | 'tool';
  equipSlot?: EquipSlot;
  equipSubSlot?: ItemSubSlot;
  /** Flavour only: what the item does is generated from its data. */
  description?: string;
  statBonus?: Partial<Record<StatName, number>>;
  /** The ability a tome teaches, which its hotbar slot casts. */
  abilityId?: string;
  /** Skill this item teaches when used. Set on skill books. */
  skillId?: SkillId;
  /**
   * Levels of the human's Explosives Handling this item adds when studied, and
   * is used up doing it. Only the human can study one.
   */
  explosivesHandlingLevels?: number;
  /**
   * A potion that can be drunk straight from the bag, without first assigning it
   * to a hotbar slot. Drives the context menu's Drink entry.
   */
  drinkable?: boolean;
  /**
   * The context-menu entry that uses this item exactly as a hotbar press of it
   * would, for an item whose use belongs to a scene system rather than to one
   * of the kinds the menu already knows (Drink, Eat, Read, Study). The scene
   * decides what the use does — see `MenusKit.useSceneItem`.
   */
  menuUseLabel?: string;
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
  /** Fairy magics that cannot hurt or afflict the wearer while this is equipped. */
  fairyImmunities?: FairyElement[];
  /** While equipped, momentum-based attacks (e.g. the Ball of Swine's trample) are cancelled on contact. */
  cancelsMomentum?: boolean;
  /** Effective skill-level bonus granted while equipped; stacks with the trained level, capped at the skill's max. */
  skillLevelBonus?: Partial<Record<SkillId, number>>;
  /** Stat bonus that applies only to melee damage computation, not to the general stat. */
  meleeOnlyStatBonus?: Partial<Record<StatName, number>>;
  /** Set on an axe/pickaxe item, naming which tier ladder it belongs to and where on it. */
  tool?: { kind: ToolKind; tier: ToolTier };
  /** Whether this item is eaten (as opposed to drunk) to trigger its effect. */
  edible?: boolean;
  /**
   * When true, no shop will ever buy this item back, whatever its price —
   * for an item whose only value is what it does equipped or
   * consumed (a tome that teaches an ability), not what it's worth as goods.
   */
  unsellable?: boolean;
}

/**
 * Armour or a weapon carrying both halves of an equip address — the only shape
 * of item that can actually be put in an equipment slot.
 */
export type WearableItem = InventoryItem & {
  type: 'armor' | 'weapon';
  equipSlot: EquipSlot;
  equipSubSlot: ItemSubSlot;
};

/** Narrows an item to the wearable shape {@link WearableItem} describes. */
export function isWearable(item: InventoryItem | null | undefined): item is WearableItem {
  if (item === null || item === undefined) return false;
  const equippableType = item.type === 'armor' || item.type === 'weapon';
  return equippableType && item.equipSlot !== undefined && item.equipSubSlot !== undefined;
}

/** Every item category, in the order the bag's tabs and sort present them. */
export const ITEM_CATEGORIES = [
  'weapon',
  'armor',
  'consumable',
  'tool',
  'material',
  'book',
  'quest',
  'kit',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * An item's static definition. `category` is read from here, never from a
 * slot: slots hold spread copies of a def, including ones restored from saves
 * written before a field existed.
 */
export type ItemDef = Omit<InventoryItem, 'quantity' | 'type'> & {
  readonly category: ItemCategory;
  /**
   * The crawler a reward split always hands this item to, whichever of them
   * could use it — a signature drop that belongs to one of them.
   */
  readonly lootRecipient?: CrawlerKind;
} & (WornItemFields | WeaponItemFields | UnwornItemFields);

/**
 * How a worn item looks: on the one crawler who can wear it, or on each of
 * them for an item either can wear. Required, so an invisible piece of gear is
 * a decision with a reason, never an omission.
 */
export type ItemLook<W extends Wearer> = W extends CrawlerKind ? WearerLook<W> : LookOnEach;

/** What every piece of gear carries beside its slot: its rarity, its set and its mechanics. */
interface GearFields {
  /** Every piece is unique to the party, so a copy never stacks with another. */
  readonly stackable: false;
  readonly rarity: Rarity;
  readonly set?: GearSetId;
  /** The mechanics the piece adds while worn, each described and run by its trait handler. */
  readonly traits?: ReadonlyArray<GearTrait>;
}

interface WornBy<W extends Wearer> extends GearFields {
  readonly type: 'armor';
  readonly equipSlot: EquipSlot;
  readonly equipSubSlot: ItemSubSlot;
  readonly wearer: W;
  readonly look: ItemLook<W>;
  readonly weapon?: never;
  readonly heldVisual?: never;
  readonly carriedInJaws?: never;
}

/** Armour: worn in a slot, by the crawler or crawlers `wearer` names, and looking as `look` says. */
type WornItemFields = { readonly [W in Wearer]: WornBy<W> }[Wearer];

/** A weapon: held in a slot, with the stat block that decides how it fights. */
interface WeaponItemFields extends GearFields {
  readonly type: 'weapon';
  readonly equipSlot: 'Weapon';
  readonly equipSubSlot: 'Main' | 'Off' | 'Claws';
  readonly wearer: Wearer;
  readonly weapon: WeaponStats;
  readonly heldVisual?: never;
  readonly carriedInJaws?: never;
  /** A weapon's look is its stat block's held visual. */
  readonly look?: never;
}

/**
 * Everything else, which no slot takes and so no wearer restricts. A working
 * tool — each tier of axe and pick, and Merrit's scythe — names the look it
 * is drawn with in a worker's hands.
 */
interface UnwornItemFields {
  readonly type?: 'consumable' | 'tool';
  readonly rarity?: never;
  readonly set?: never;
  readonly traits?: never;
  readonly wearer?: never;
  readonly weapon?: never;
  readonly heldVisual?: WorkingToolHeldVisualId;
  /**
   * A thing the cat crawler carries in her jaws for as long as it is in her
   * pack, so the party can see she has it.
   */
  readonly carriedInJaws?: MouthCarryVisualId;
  readonly look?: never;
}

/**
 * Every item's definition. Checked with `satisfies` rather than annotated so
 * each entry keeps its own shape, which {@link GearItemId} reads.
 */
const ITEM_DEFS = defineItemDefs({
  scroll_of_confusing_fog: {
    id: 'scroll_of_confusing_fog',
    category: 'consumable',
    name: 'Scroll of Confusing Fog',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'Summons a thick fog cloud around the caster. Any enemy caught inside the fog loses all sense of sight and cannot target any entity. Size and duration grow with INT, tapering off at higher values.',
  },
  dirty_shirley: {
    id: 'dirty_shirley',
    category: 'consumable',
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
    category: 'consumable',
    name: 'Health Potion',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
  },
  speed_fizz: {
    id: 'speed_fizz',
    category: 'consumable',
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
    category: 'consumable',
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
    category: 'consumable',
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
    category: 'consumable',
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
    category: 'consumable',
    name: 'Goblin Dynamite',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A hissing stick of goblin-made dynamite. Only the Human can throw it. ' +
      'Hold the hotbar key to charge your throw — release to hurl it. ' +
      'Tap it to drop it at your feet. Warning: holding too long has consequences.',
  },
  black_powder_bomb: {
    id: 'black_powder_bomb',
    category: 'consumable',
    name: 'Black Powder Bomb',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A round cast-iron bomb packed with goblin black powder. Only the Human can throw it. ' +
      'Thrown like dynamite — hold the hotbar key to charge, release to hurl — ' +
      'but it explodes the moment it lands. A tap lobs it a short way clear of you.',
  },
  gym_dumbbell: {
    id: 'gym_dumbbell',
    category: 'kit',
    name: 'Dumbbell',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A heavy iron dumbbell. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_bench_press: {
    id: 'gym_bench_press',
    category: 'kit',
    name: 'Bench Press',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A full bench press machine. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  gym_treadmill: {
    id: 'gym_treadmill',
    category: 'kit',
    name: 'Treadmill',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A sturdy treadmill. Place it on the ground (hotbar) to create a barrier that slows passing enemies.',
  },
  magic_missile_tome: {
    id: 'magic_missile_tome',
    category: 'book',
    unsellable: true,
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
    category: 'quest',
    name: 'Barricade Boards',
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
    category: 'tool',
    name: "Wayfinder's Anchor",
    stackable: false,
    canHotlist: true,
    canDrop: false,
    type: 'consumable',
    menuUseLabel: 'Travel',
    description:
      'Three shards of a seer’s stone, welded back into one and humming like a struck bell. ' +
      'It carries the whole party to the places it has been bound to: the town square from the ' +
      'start, and the circus and Briar Hollow once you have set things right there. One minute ' +
      'between trips. It stays dead underground, during a boss fight, and with anything hostile ' +
      'close by.',
  },
  // The three shards are ordinary undroppable bag items rather than `isQuestItem`
  // ones: the quest flag routes an item into the single reserved hotbar slot, and
  // a second quest item there overwrites the first. Three of them at once would
  // silently eat each other.
  anchor_shard_tinker: {
    id: 'anchor_shard_tinker',
    category: 'quest',
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
    category: 'quest',
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
    category: 'quest',
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
    category: 'quest',
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
    category: 'quest',
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
    category: 'book',
    unsellable: true,
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
  explosives_handling_tome: {
    id: 'explosives_handling_tome',
    category: 'book',
    name: 'Tome of Explosives Handling',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'consumable',
    explosivesHandlingLevels: 1,
    description:
      'A blast-singed manual with most of its fingers — sorry, pages — still attached. ' +
      'Only the Human can study it. Adds one level to Explosives Handling.',
  },
  skill_book_cockroach: {
    id: 'skill_book_cockroach',
    category: 'book',
    unsellable: true,
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
    category: 'book',
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
    category: 'book',
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
    category: 'book',
    name: 'Skill Book: Iron Stomach',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'iron_stomach',
    description:
      'Sticky. Do not ask with what. Either crawler can learn from it. ' +
      'Potions come back round faster, and the room stops spinning sooner.',
  },
  doomsday_scenario: {
    id: 'doomsday_scenario',
    category: 'quest',
    name: `${crawlerName('human')}'s Doomsday Scenario`,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    description:
      'A soul crystal on the verge of levelling a city, sealed inside an enchanted glass ' +
      'display case and stuffed into your inventory. Not a weapon. Not yet, anyway.',
  },
  quest_scythe: {
    id: 'quest_scythe',
    category: 'quest',
    name: "Merrit's Scythe",
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    heldVisual: 'quest_scythe',
    description:
      "Merrit's scythe, borrowed off the barn wall. Swing it through the grain field south of " +
      'the scarecrow, and press again as the blade comes through for a bigger sheaf.',
  },
  quest_blueprints: {
    id: 'quest_blueprints',
    category: 'quest',
    carriedInJaws: 'carried_blueprints',
    name: "Tikka's Blueprints",
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    description:
      "Tikka's drawings for a proper saw bench and a geared rope walk, borrowed back from Wendell. " +
      "Take them to Fenna's saw and rope walk to build the upgrades.",
  },
  quest_prison_key: {
    id: 'quest_prison_key',
    category: 'quest',
    carriedInJaws: 'carried_prison_key',
    name: 'The Key',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    description:
      'An absurdly large gold key, lifted from the vault of the Goblin High Security Prison. ' +
      'The gate guard outside will want it back. He will be insufferable about it.',
  },
  wood: {
    id: 'wood',
    category: 'material',
    name: 'Wood',
    stackable: true,
    canHotlist: false,
    description: 'Raw timber harvested from trees.',
  },
  stone: {
    id: 'stone',
    category: 'material',
    name: 'Stone',
    stackable: true,
    canHotlist: false,
    description: 'Usable stone harvested from exposed rock deposits.',
  },
  wood_board: {
    id: 'wood_board',
    category: 'material',
    name: 'Boards of Wood',
    stackable: true,
    canHotlist: false,
    description:
      'Processed timber used for walls, repairs, trebuchets, snares, and other construction.',
  },
  rope: {
    id: 'rope',
    category: 'material',
    name: 'Rope',
    stackable: true,
    canHotlist: false,
    description: 'Strong processed rope used for trebuchets and snare traps.',
  },
  basic_axe: {
    id: 'basic_axe',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_BASIC).name,
    description: toolTierDef('axe', TOOL_TIER_BASIC).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_BASIC },
    heldVisual: 'basic_axe',
  },
  hardened_axe: {
    id: 'hardened_axe',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_HARDENED).name,
    description: toolTierDef('axe', TOOL_TIER_HARDENED).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_HARDENED },
    heldVisual: 'hardened_axe',
  },
  lumberjacks_axe: {
    id: 'lumberjacks_axe',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_LONG_HAFT).name,
    description: toolTierDef('axe', TOOL_TIER_LONG_HAFT).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_LONG_HAFT },
    heldVisual: 'lumberjacks_axe',
  },
  ratkin_forge_axe: {
    id: 'ratkin_forge_axe',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_RATKIN_FORGE).name,
    description: toolTierDef('axe', TOOL_TIER_RATKIN_FORGE).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_RATKIN_FORGE },
    heldVisual: 'ratkin_forge_axe',
  },
  deepwood_cleaver: {
    id: 'deepwood_cleaver',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_DEEPWOOD).name,
    description: toolTierDef('axe', TOOL_TIER_DEEPWOOD).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_DEEPWOOD },
    heldVisual: 'deepwood_cleaver',
  },
  graveyards_bane: {
    id: 'graveyards_bane',
    category: 'tool',
    name: toolTierDef('axe', TOOL_TIER_GRAVEYARD).name,
    description: toolTierDef('axe', TOOL_TIER_GRAVEYARD).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'axe', tier: TOOL_TIER_GRAVEYARD },
    heldVisual: 'graveyards_bane',
  },
  basic_pickaxe: {
    id: 'basic_pickaxe',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_BASIC).name,
    description: toolTierDef('pickaxe', TOOL_TIER_BASIC).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_BASIC },
    heldVisual: 'basic_pickaxe',
  },
  hardened_pickaxe: {
    id: 'hardened_pickaxe',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_HARDENED).name,
    description: toolTierDef('pickaxe', TOOL_TIER_HARDENED).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_HARDENED },
    heldVisual: 'hardened_pickaxe',
  },
  quarrymans_pick: {
    id: 'quarrymans_pick',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_LONG_HAFT).name,
    description: toolTierDef('pickaxe', TOOL_TIER_LONG_HAFT).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_LONG_HAFT },
    heldVisual: 'quarrymans_pick',
  },
  ratkin_forge_pick: {
    id: 'ratkin_forge_pick',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_RATKIN_FORGE).name,
    description: toolTierDef('pickaxe', TOOL_TIER_RATKIN_FORGE).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_RATKIN_FORGE },
    heldVisual: 'ratkin_forge_pick',
  },
  stonebreaker: {
    id: 'stonebreaker',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_DEEPWOOD).name,
    description: toolTierDef('pickaxe', TOOL_TIER_DEEPWOOD).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_DEEPWOOD },
    heldVisual: 'stonebreaker',
  },
  worldscar_pick: {
    id: 'worldscar_pick',
    category: 'tool',
    name: toolTierDef('pickaxe', TOOL_TIER_GRAVEYARD).name,
    description: toolTierDef('pickaxe', TOOL_TIER_GRAVEYARD).description,
    stackable: false,
    canHotlist: false,
    canDrop: false,
    type: 'tool',
    tool: { kind: 'pickaxe', tier: TOOL_TIER_GRAVEYARD },
    heldVisual: 'worldscar_pick',
  },
  hamburger: {
    id: 'hamburger',
    category: 'consumable',
    name: 'Hamburger',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    edible: true,
    description:
      "Pipkin's specialty: fresh meat, a hot pan, bread, and enough seasoning to make it worth chewing.",
  },
  hollow_stew: {
    id: 'hollow_stew',
    category: 'consumable',
    name: 'Hollow Stew',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    edible: true,
    description: "Pipkin's filling stew. Heals you the same way a health potion does.",
  },
  trebuchet_kit: {
    id: 'trebuchet_kit',
    category: 'kit',
    name: 'Trebuchet Kit',
    stackable: true,
    canHotlist: false,
    description:
      'A complete trebuchet, folded for carrying. Build it from the Construction menu at no cost.',
  },
  snare_kit: {
    id: 'snare_kit',
    category: 'kit',
    name: 'Snare Kit',
    stackable: true,
    canHotlist: false,
    description:
      'A complete snare, folded for carrying. Build it from the Construction menu at no cost.',
  },
  ...GEAR_CATALOGUE,
  // The proving weapons are dev-only: no loot table, shop stock, quest reward
  // or preview route names them, so only a harness equipping them by id reaches them.
  dev_plain_sword: {
    id: 'dev_plain_sword',
    category: 'weapon',
    unsellable: true,
    name: 'Plain Arming Sword',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Common',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blade',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'plain_arming_sword',
      sound: 'sword',
    },
    description: 'A plain steel sword with an iron crossguard. Development only.',
  },
  dev_spiked_club: {
    id: 'dev_spiked_club',
    category: 'weapon',
    unsellable: true,
    name: 'Spiked Club',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Common',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blunt',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'spiked_club',
      sound: 'woodenClub',
    },
    description: 'A heavy wooden club studded with iron spikes. Development only.',
  },
  dev_felling_axe: {
    id: 'dev_felling_axe',
    category: 'weapon',
    unsellable: true,
    name: 'Felling Axe',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Common',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blade',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'felling_axe',
      sound: 'chopAxe',
    },
    description: 'A long-hafted two-handed axe with a narrow felling bit. Development only.',
  },
}) satisfies Record<ItemId, ItemDef>;

export const ITEM_DEF: Readonly<Record<ItemId, ItemDef>> = ITEM_DEFS;

/** Every item that is armour or a weapon: the ids gear sources and loot pools are keyed on. */
export type GearItemId = {
  [K in ItemId]: (typeof ITEM_DEFS)[K] extends { readonly type: 'armor' | 'weapon' } ? K : never;
}[ItemId];

/** Every weapon the human crawler holds in hand, swung or loosed: the ids weapon sounds are keyed on. */
export type HandWeaponItemId = {
  [K in ItemId]: (typeof ITEM_DEFS)[K] extends {
    readonly weapon: { readonly delivery: 'melee' | 'sling' };
  }
    ? K
    : never;
}[ItemId];

/** Every set of claws the cat crawler wears over her paws. */
export type ClawItemId = {
  [K in ItemId]: (typeof ITEM_DEFS)[K] extends { readonly weapon: { readonly delivery: 'claw' } }
    ? K
    : never;
}[ItemId];

/** Bag slots shown on one page of the bag; the bag grows a page at a time and is never full. */
export const BAG_PAGE_SLOTS = 32;
export const HOTBAR_COUNT = 8;
/** Last hotbar slot index, reserved for quest items. */
export const QUEST_SLOT_IDX = HOTBAR_COUNT - 1; // slot 7

/**
 * The sub-slots each crawler has, section by section; a section a crawler
 * lacks is absent. Gear shared by both fits by sub-slot id, so an amulet the
 * human wears at `Head:Neck` sits on the cat's collar under the same key.
 */
export const EQUIP_SUBSLOTS: Readonly<
  Record<CrawlerKind, Readonly<Partial<Record<EquipSlot, readonly SubSlotId[]>>>>
> = {
  human: {
    Weapon: ['Main', 'Off', 'Relic'],
    Head: ['Hat', 'Face', 'Neck'],
    Torso: ['Shirt', 'Jacket', 'Back'],
    Legs: ['Pants', 'Knees'],
    Hands: ['Gloves'],
    Feet: ['Shoes'],
    Trinkets: ['Trinket 1', 'Trinket 2'],
  },
  cat: {
    Weapon: ['Claws', 'Relic'],
    Head: ['Hat', 'Face', 'Neck'],
    Torso: ['Shirt', 'Jacket', 'Back'],
    Feet: ['Shoes'],
    Trinkets: ['Trinket 1', 'Trinket 2'],
  },
};

/** What the cat's doll calls the sub-slots she wears differently; the rest read as their id. */
const CAT_SUB_SLOT_LABELS: Readonly<Partial<Record<SubSlotId, string>>> = {
  Neck: 'Collar',
  Shirt: 'Vest',
  Jacket: 'Coat',
  Back: 'Cloak',
  Shoes: 'Booties',
};

/** What a crawler's doll calls one of its sub-slots. */
export function subSlotLabel(kind: CrawlerKind, subSlot: SubSlotId): string {
  return kind === 'cat' ? (CAT_SUB_SLOT_LABELS[subSlot] ?? subSlot) : subSlot;
}

/**
 * The sub-slots `kind` has in `slot`, empty when it lacks the section. A
 * wearer of no particular kind has every sub-slot either crawler has.
 */
export function subSlotsOf(kind: CrawlerKind | null, slot: EquipSlot): readonly SubSlotId[] {
  if (kind !== null) return EQUIP_SUBSLOTS[kind][slot] ?? [];
  const either = [...(EQUIP_SUBSLOTS.human[slot] ?? []), ...(EQUIP_SUBSLOTS.cat[slot] ?? [])];
  return SUB_SLOT_IDS.filter((subSlot) => either.includes(subSlot));
}

/** Whether a crawler of `kind` has the section `slot` at all. */
export function crawlerHasSection(kind: CrawlerKind, slot: EquipSlot): boolean {
  return EQUIP_SUBSLOTS[kind][slot] !== undefined;
}

/** The key of the human crawler's main hand, where the weapon he draws from the hotbar is held. */
export const MAIN_HAND_KEY = 'Weapon:Main';
/** The key of the human crawler's off hand, where a shield is carried. */
export const OFF_HAND_KEY = 'Weapon:Off';
/** The key of the cat crawler's claws, worn over her forepaws. */
export const CLAWS_KEY = 'Weapon:Claws';

function isEquipSlot(name: string): name is EquipSlot {
  return EQUIP_SLOTS.some((slot) => slot === name);
}

function isSubSlotId(name: string): name is SubSlotId {
  return SUB_SLOT_IDS.some((subSlot) => subSlot === name);
}

/** The section and sub-slot a `"Slot:SubSlot"` key names. */
export interface EquipAddress {
  readonly slot: EquipSlot;
  readonly subSlot: SubSlotId;
}

/**
 * The section and sub-slot a `"Slot:SubSlot"` key names, or null when the key
 * names no sub-slot `kind` has — a key written under a since-renamed slot, or
 * one only the other crawler has.
 */
export function equipAddressOfKey(kind: CrawlerKind | null, key: string): EquipAddress | null {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const slot = key.slice(0, separator);
  const subSlot = key.slice(separator + 1);
  if (!isEquipSlot(slot) || !isSubSlotId(subSlot)) return null;
  return subSlotsOf(kind, slot).includes(subSlot) ? { slot, subSlot } : null;
}

/**
 * Who may equip `id`, read off its definition: bag and hotbar slots hold
 * copies of a def taken when the item was picked up, so only the def is
 * current. Undefined for an item no slot takes, and for an id retired since a
 * save was written.
 */
export function wearerOf(id: ItemId): Wearer | undefined {
  return isItemId(id) ? ITEM_DEF[id].wearer : undefined;
}

/**
 * How `def` looks on the cat crawler — claws as the garment over her paws —
 * or null for anything she cannot wear.
 */
export function catLookOf(def: ItemDef): WearerLook<'cat'> | null {
  if (def.type === 'weapon') {
    return def.weapon.delivery === 'claw' ? { kind: 'garment', garment: def.weapon.garment } : null;
  }
  if (def.type !== 'armor') return null;
  if (def.wearer === 'both') return def.look.cat;
  return def.wearer === 'cat' ? def.look : null;
}

/** How `def` looks on the human crawler, or null for anything he cannot wear. */
export function humanLookOf(def: ItemDef): WearerLook<'human'> | null {
  if (def.type !== 'armor') return null;
  if (def.wearer === 'both') return def.look.human;
  return def.wearer === 'human' ? def.look : null;
}

/** The stat block of a weapon the human holds in hand, or null for anything else, claws included. */
export function weaponStatsOf(id: ItemId): HandWeaponStats | null {
  const weapon = isItemId(id) ? ITEM_DEF[id].weapon : undefined;
  return weapon === undefined || weapon.delivery === 'claw' ? null : weapon;
}

/** The stat block of claws worn over the cat's paws, or null for anything else. */
export function clawStatsOf(id: ItemId): ClawWeaponStats | null {
  const weapon = isItemId(id) ? ITEM_DEF[id].weapon : undefined;
  return weapon?.delivery === 'claw' ? weapon : null;
}

const SUBSLOT_INDEX_SUFFIX = / \d+$/;

/** Strips a trailing slot index so 'Trinket 2' and 'Trinket' share the family 'Trinket'. */
function subSlotFamily(subSlot: string): string {
  return subSlot.replace(SUBSLOT_INDEX_SUFFIX, '');
}

/**
 * True when an item declaring `equipSubSlot` belongs in the named sub-slot.
 *
 * Items that fit several interchangeable slots declare the family name
 * ('Trinket'), so the comparison is family-to-family; single-slot items are
 * unaffected because a name without an index is its own family.
 */
export function itemFitsSubSlot(
  item: Pick<InventoryItem, 'equipSubSlot'>,
  subSlot: SubSlotId,
): boolean {
  if (item.equipSubSlot === undefined) return false;
  return subSlotFamily(item.equipSubSlot) === subSlotFamily(subSlot);
}

export function isItemId(s: string): s is ItemId {
  return s in ITEM_DEF;
}

/**
 * The three pieces the Wayfinder's Anchor is welded from, in the order the
 * questline hands them out.
 *
 * One list rather than three literals repeated per caller: the assembly
 * transaction and the Journal have to agree on what "all three" means, and a
 * fourth shard would otherwise have to be remembered in each.
 */
export const ANCHOR_SHARD_IDS = [
  'anchor_shard_tinker',
  'anchor_shard_hilda',
  'anchor_shard_temple',
] as const satisfies readonly ItemId[];

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

/**
 * Whether any shop could ever buy this item back — before a specific shop's
 * pricing profile decides whether *it* deals in the item at all. Excludes
 * items marked `unsellable`, quest items, and anything `canDrop: false`
 * (tools, the Anchor and its shards, the magistrate's writ): none of those are
 * goods a shop counter trades in.
 */
export function canSellItemId(id: ItemId): boolean {
  const def = ITEM_DEF[id];
  if (def.unsellable === true) return false;
  if (def.isQuestItem === true) return false;
  if (def.canDrop === false) return false;
  return true;
}
