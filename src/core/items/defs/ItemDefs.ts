import { crawlerDisplayName, HUMAN_CRAWLER_AI_NAME } from '../../../characters/characters';
import { ownEntry } from '../../util/guards';
import type { StatId } from '../../party/stats';
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
  type WeaponDelivery,
  type WeaponStats,
} from '../equipment/weapons';

export type ItemId =
  | 'health_potion'
  | 'speed_fizz'
  | 'jugg_juice'
  | 'cooldown_crisp'
  | 'stat_boost_potion'
  | 'catnip_tuna_water'
  | 'scroll_of_entanglement'
  | 'dynamite'
  | 'black_powder_bomb'
  | 'smoke_bomb'
  | 'gym_dumbbell'
  | 'gym_bench_press'
  | 'gym_treadmill'
  | 'quest_wood_board'
  | 'magic_missile_tome'
  | 'seismic_stomp_tome'
  | 'explosives_handling_tome'
  | 'doomsday_scenario'
  | 'quest_scythe'
  | 'quest_blueprints'
  | 'quest_prison_key'
  | 'skill_book_nine_lives'
  | 'skill_book_warp_speed'
  | 'skill_book_pugilism'
  | 'skill_book_iron_stomach'
  | 'skill_book_swordsmanship'
  | 'skill_book_archery'
  | 'skill_book_clawmanship'
  | 'skill_book_magic_eye'
  | 'skill_book_mechanical_fist'
  | 'skill_book_blunt_proficiency'
  | 'skill_book_pyros_touch'
  | 'skill_book_demolitionist'
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
  | 'lineman_boots'
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
  | 'anchor_shard_lori'
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
 * Most resistances only work where the damage is dealt asks for it: hits go
 * through `Player.resistedDamage` (ice fairy bolts as `'ice'`, goblin arrows
 * and skeleton archers' bones as `'piercing'`), and poison status ticks check
 * `'poison'` themselves. A new attack of one of these kinds must ask too, or
 * the resistance silently does nothing against it. `'magic'` is the exception:
 * a spell says so on its `DamageSource` and `Player.incomingDamage` turns it
 * aside for every caller.
 */
export type ResistanceType = 'poison' | 'ice' | 'piercing' | 'magic';

/** Every damage channel gear can resist, for surfaces that summarise all of them. */
export const ALL_RESISTANCE_TYPES = [
  'poison',
  'ice',
  'piercing',
  'magic',
] as const satisfies readonly ResistanceType[];

/**
 * The fairy magics a ring can make its wearer immune to. Separate from
 * {@link ResistanceType} because the immunity is to the fairy, not the
 * element: a fairy ring stops a fire fairy's fireball but not a gravedigger
 * beetle's, and an acid llama's glob is neither ice nor fire, so no ring
 * touches it.
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
  statBonus?: Partial<Record<StatId, number>>;
  /**
   * How a non-weapon item's damage leaves the crawler — a spell scroll, a
   * thrown explosive — which names the stat it grows with. Weapons say so on
   * their stat block and tomes on their ability instead.
   */
  delivery?: Exclude<WeaponDelivery, WeaponStats['delivery']>;
  /** The ability a tome teaches, which its hotbar slot casts. */
  abilityId?: string;
  /** Skill this item teaches when used. Set on skill books. */
  skillId?: SkillId;
  /**
   * Levels of Explosives Handling this item adds to whoever studies it, and
   * is used up doing it.
   */
  explosivesHandlingLevels?: number;
  /**
   * A potion that can be drunk straight from the bag, without first assigning it
   * to a hotbar slot. Drives the context menu's Drink entry.
   */
  drinkable?: boolean;
  /**
   * The one crawler who may drink this, when it is not both. The other is
   * refused at the bottle, whichever way they reach for it.
   */
  drinkableBy?: CrawlerKind;
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
  /** While equipped, momentum-based attacks (a charge or a trample) are cancelled on contact. */
  cancelsMomentum?: boolean;
  /** Effective skill-level bonus granted while equipped; stacks with the trained level, capped at the skill's max. */
  skillLevelBonus?: Partial<Record<SkillId, number>>;
  /** Stat bonus that applies only to melee damage computation, not to the general stat. */
  meleeOnlyStatBonus?: Partial<Record<StatId, number>>;
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
 * slot: slots hold spread copies of a def taken when the item arrived.
 */
export type ItemDef = Omit<InventoryItem, 'quantity' | 'type'> & {
  readonly category: ItemCategory;
  /**
   * The crawler a reward split always hands this item to, whichever of them
   * could use it — a signature drop that belongs to one of them.
   */
  readonly lootRecipient?: CrawlerKind;
  /**
   * The name told to the AI, for an item whose `name` carries the player's
   * typed name: that reaches the AI only where its server fences it as player
   * text, so this one names them by `crawlerAIName` instead.
   */
  readonly aiName?: string;
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
  scroll_of_entanglement: {
    id: 'scroll_of_entanglement',
    category: 'consumable',
    name: 'Scroll of Entanglement',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'Roots tear up out of the ground around you and bind every enemy in reach for five seconds. ' +
      'Bosses are too strong to hold, and anything flying is out of reach.',
  },
  catnip_tuna_water: {
    id: 'catnip_tuna_water',
    category: 'consumable',
    name: 'Catnip Infused Tuna Water',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    drinkable: true,
    drinkableBy: 'cat',
    description:
      'The Cloak & Dagger’s house special, poured for the cat: tuna water steeped with fresh catnip. ' +
      'Restores health and sends her loose and happy. She will be buzzed.',
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
    description: "Permanently raises one randomly chosen stat by 2 to 4 level-up points' worth.",
  },
  dynamite: {
    id: 'dynamite',
    delivery: 'thrownExplosive',
    category: 'consumable',
    name: 'Dynamite',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A hissing stick of dynamite. ' +
      'Hold the hotbar key to charge your throw — release to hurl it. ' +
      'Tap it to drop it at your feet. Warning: holding too long has consequences.',
  },
  black_powder_bomb: {
    id: 'black_powder_bomb',
    delivery: 'thrownExplosive',
    category: 'consumable',
    name: 'Black Powder Bomb',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A round cast-iron bomb packed with goblin black powder. ' +
      'Thrown like dynamite — hold the hotbar key to charge, release to hurl — ' +
      'but it explodes the moment it lands. A tap lobs it a short way clear of you.',
  },
  smoke_bomb: {
    id: 'smoke_bomb',
    category: 'consumable',
    name: 'Smoke Bomb',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    description:
      'A clay shell packed with choking smoke. Throw it like a bomb: it bursts where it lands into a ' +
      'thick cloud for six seconds, and enemies inside it lose all sense of where you are.',
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
      'barriers against Fuzzy Nightmares. Only the Human can build or repair. Costs 4 boards. ' +
      'Old Lori takes the same boards for her broken furniture, at 2 a mend.',
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
  anchor_shard_lori: {
    id: 'anchor_shard_lori',
    category: 'quest',
    name: 'Anchor Shard (Hearth)',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    description:
      'Old Lori kept this one under a chair leg for thirty years. It gave it up gladly. ' +
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
      'Squiggles and triangles in a brown ink you are choosing not to think about. Dave ' +
      'called it necro-script and told you to burn it. It is warm.',
  },
  seismic_stomp_tome: {
    id: 'seismic_stomp_tome',
    category: 'book',
    unsellable: true,
    name: 'Seismic Stomp',
    stackable: false,
    canHotlist: true,
    canDrop: false,
    type: 'consumable',
    abilityId: 'seismic_stomp',
    description:
      'Drive your heel into the floor and send a shockwave through it. Everything close by takes the hit and staggers. ' +
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
      'Adds one level to Explosives Handling.',
  },
  skill_book_nine_lives: {
    id: 'skill_book_nine_lives',
    category: 'book',
    unsellable: true,
    name: 'Skill Book: 9 Lives',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'nine_lives',
    description:
      "Once in a while, a blow that should have killed you doesn't. You're left standing on 1 HP, " +
      "and you can't be hurt for a moment. Takes a while to come back. Faster with practice.",
  },
  skill_book_warp_speed: {
    id: 'skill_book_warp_speed',
    category: 'book',
    name: 'Skill Book: Warp Speed',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'warp_speed',
    description:
      'A slim manual whose every page is slightly blurred, ' +
      'as if it moved while it was being printed. ' +
      'Improves your chance to be somewhere else when the hit lands.',
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
      'Twelve pages of diagrams, all of them a fist. ' +
      'Every level makes your melee hurt more, which is the whole point of the diagrams.',
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
      'Sticky. Do not ask with what. ' +
      'Potions come back round faster, and the room stops spinning sooner.',
  },
  skill_book_swordsmanship: {
    id: 'skill_book_swordsmanship',
    category: 'book',
    name: 'Skill Book: Swordsmanship',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'swordsmanship',
    description:
      'A fencing manual from a school that, judging by the margins, did not take beginners twice.',
  },
  skill_book_archery: {
    id: 'skill_book_archery',
    category: 'book',
    name: 'Skill Book: Archery',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'archery',
    description: 'Diagrams of arms, strings and the distance between them. Every arrow in it hits.',
  },
  skill_book_clawmanship: {
    id: 'skill_book_clawmanship',
    category: 'book',
    name: 'Skill Book: Clawmanship',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'clawmanship',
    description: 'Shredded at the edges, which was probably the first lesson.',
  },
  skill_book_magic_eye: {
    id: 'skill_book_magic_eye',
    category: 'book',
    name: 'Skill Book: Magic Eye',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'magic_eye',
    description:
      'The pages shimmer if you stare long enough. Somebody did, and wrote down what they saw.',
  },
  skill_book_mechanical_fist: {
    id: 'skill_book_mechanical_fist',
    category: 'book',
    name: 'Skill Book: Mechanical Fist',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'mechanical_fist',
    description:
      'Riveted at the spine. The diagrams are of gauntlets, and of what gauntlets are for.',
  },
  skill_book_blunt_proficiency: {
    id: 'skill_book_blunt_proficiency',
    category: 'book',
    name: 'Skill Book: Blunt Proficiency',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'blunt_proficiency',
    description: 'Short, heavy and to the point, though it has no point. That is rather the idea.',
  },
  skill_book_pyros_touch: {
    id: 'skill_book_pyros_touch',
    category: 'book',
    name: "Skill Book: Pyro's Touch",
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'pyros_touch',
    description: 'Warm to hold, and getting warmer. The last chapter is mostly scorch.',
  },
  skill_book_demolitionist: {
    id: 'skill_book_demolitionist',
    category: 'book',
    name: 'Skill Book: Demolitionist',
    stackable: true,
    canHotlist: true,
    type: 'consumable',
    skillId: 'demolitionist',
    description:
      'Half the pages are missing, and the half that remain are very sure of themselves.',
  },
  doomsday_scenario: {
    id: 'doomsday_scenario',
    category: 'quest',
    /** The player's name is theirs to choose, so it is read whenever the item is named. */
    get name(): string {
      return `${crawlerDisplayName('human')}'s Doomsday Scenario`;
    },
    aiName: `${HUMAN_CRAWLER_AI_NAME}'s Doomsday Scenario`,
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
      family: 'sword',
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
      family: 'blunt',
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
      family: 'axe',
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
 * names no sub-slot `kind` has, such as one only the other crawler has.
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
 * current. Undefined for an item no slot takes.
 */
export function wearerOf(id: ItemId): Wearer | undefined {
  return ITEM_DEF[id].wearer;
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

/** Whether `kind` may wear `id` in section `slot`. A null kind is a wearer of any kind. */
export function kindMayWear(kind: CrawlerKind | null, slot: EquipSlot, id: ItemId): boolean {
  if (kind === null) return true;
  const wearer = wearerOf(id);
  if (wearer === undefined || !wearerAllows(wearer, kind)) return false;
  return crawlerHasSection(kind, slot);
}

/**
 * Whether `kind` can wear `id` under the sub-slot `key`: the key names a
 * sub-slot this crawler has, the item fits it, and the crawler may wear the
 * item. A null kind is a wearer of any kind.
 */
export function mayEquipUnder(kind: CrawlerKind | null, key: string, id: ItemId): boolean {
  const address = equipAddressOfKey(kind, key);
  if (address === null) return false;
  const def = ITEM_DEF[id];
  if (def.equipSlot !== address.slot || !itemFitsSubSlot(def, address.subSlot)) return false;
  return kindMayWear(kind, address.slot, id);
}

export function isItemId(s: string): s is ItemId {
  return ownEntry(ITEM_DEF, s) !== undefined;
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
  'anchor_shard_lori',
  'anchor_shard_temple',
] as const satisfies readonly ItemId[];

/**
 * Whether an item is allowed to occupy a hotbar slot.
 *
 * Always ask this rather than reading `canHotlist` off an inventory instance:
 * bag and hotbar entries are spread copies of the def taken when the item was
 * picked up, so the def is the only current answer.
 */
export function itemCanHotlist(id: ItemId): boolean {
  return ITEM_DEF[id].canHotlist;
}

/** Item `id`'s name as told to the AI: never one carrying the player's typed name. */
export function itemAIName(id: ItemId): string {
  const def = ITEM_DEF[id];
  return def.aiName ?? def.name;
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
