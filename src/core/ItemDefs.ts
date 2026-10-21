import type { StatName } from '../Player';
import type { CrawlerKind, SkillId } from './SkillManager';
import type { WorkingToolHeldVisualId } from '../sprites/held/heldVisualIds';
import type { LookOnEach, NoLook, WearerLook } from '../sprites/garments/garmentIds';
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
} from './toolTiers';
import {
  HUMAN_ARM_REACH_TILES,
  PROVING_WEAPON_DAMAGE_MULTIPLIER,
  TARANIS_DAMAGE_MULTIPLIER,
  type WeaponStats,
} from './weapons';

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
  | 'skill_book_night_vision'
  | 'nightgaunt_cloak'
  | 'slate_butterfly_talisman'
  | 'fae_scale_crupper'
  | 'bracelet_of_dex'
  | 'eyes_of_splatter'
  | 'splatter_skunk_toe_ring'
  | 'fairy_repellent_signet'
  | 'ring_of_the_cold_shoulder'
  | 'ring_of_the_asbestos_knuckle'
  | 'shade_gnoll_kneepads'
  | 'grull_war_gauntlet'
  | 'slingshot'
  | 'fury_of_taranis'
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
 * The equipment sections. `Hand` (Carl's main and off hand) and `Mouth`
 * (what Donut carries in her teeth) are the held slots; the rest are worn.
 */
export type EquipSlot = 'Head' | 'Mouth' | 'Torso' | 'Legs' | 'Hands' | 'Hand' | 'Feet';

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
  equipSubSlot?: string;
  description?: string;
  statBonus?: Partial<Record<StatName, number>>;
  /** References an active ability this item grants when equipped. */
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
  equipSubSlot: string;
};

/** Narrows an item to the wearable shape {@link WearableItem} describes. */
export function isWearable(item: InventoryItem | null | undefined): item is WearableItem {
  if (item === null || item === undefined) return false;
  const equippableType = item.type === 'armor' || item.type === 'weapon';
  return equippableType && item.equipSlot !== undefined && item.equipSubSlot !== undefined;
}

/** Fraction of a melee blow the shade gnoll kneepads throw back at whoever landed it. */
export const KNEEPADS_DAMAGE_REFLECT_PCT = 0.1;
/** Chance per landed melee hit that the Grull war gauntlet stuns its target. */
export const GAUNTLET_STUN_CHANCE = 0.02;

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

interface WornBy<W extends Wearer> {
  readonly type: 'armor';
  readonly equipSlot: EquipSlot;
  readonly equipSubSlot: string;
  readonly wearer: W;
  readonly look: ItemLook<W>;
  readonly weapon?: never;
  readonly heldVisual?: never;
}

/** Armour: worn in a slot, by the crawler or crawlers `wearer` names, and looking as `look` says. */
type WornItemFields = { readonly [W in Wearer]: WornBy<W> }[Wearer];

/** A weapon: held in a slot, with the stat block that decides how it fights. */
interface WeaponItemFields {
  readonly type: 'weapon';
  readonly equipSlot: EquipSlot;
  readonly equipSubSlot: string;
  readonly wearer: Wearer;
  readonly weapon: WeaponStats;
  readonly heldVisual?: never;
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
  readonly wearer?: never;
  readonly weapon?: never;
  readonly heldVisual?: WorkingToolHeldVisualId;
  readonly look?: never;
}

/** Gear nobody has painted on Donut: she is drawn without it. */
const UNDRAWN_ON_DONUT: NoLook = {
  kind: 'none',
  reason: 'No picture of it on Donut exists, so she is drawn without it.',
};

/** Every ring, on either crawler. */
const RING_LOOK: NoLook = {
  kind: 'none',
  reason:
    'A ring is a band round one finger or toe, under one pixel at the 32 px tile: it reads as nothing.',
  heardAs: 'jewelry',
};

export const ITEM_DEF: Record<ItemId, ItemDef> = {
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
  trollskin_shirt: {
    id: 'trollskin_shirt',
    category: 'armor',
    name: 'Enchanted Trollskin Shirt of Pummeling',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: { kind: 'garment', garment: 'carl_trollskin_shirt' }, cat: UNDRAWN_ON_DONUT },
    lootRecipient: 'human',
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
    category: 'armor',
    name: 'Enchanted Crown of the Sepsis Whore',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'carl_crown' },
      cat: { kind: 'garment', garment: 'cat_crown' },
    },
    lootRecipient: 'cat',
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
    category: 'armor',
    name: 'Issue Kettle Helm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'carl_kettle_helm' },
      cat: { kind: 'garment', garment: 'cat_kettle_helm' },
    },
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
    category: 'armor',
    name: 'Padded Gambeson',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: { kind: 'garment', garment: 'carl_gambeson' }, cat: UNDRAWN_ON_DONUT },
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { constitution: 2 },
    description:
      'Twenty layers of linen quilted flat and stitched through. Stops a tooth, spreads a club, ' +
      'and stinks. The quartermaster does not wash the insides and will explain why at length.',
  },
  riveted_bracers: {
    id: 'riveted_bracers',
    category: 'armor',
    name: 'Riveted Bracers',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: { kind: 'garment', garment: 'carl_bracers' }, cat: UNDRAWN_ON_DONUT },
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    statBonus: { strength: 1 },
    description:
      'Boiled leather over the forearm, riveted at four points. Meant for the arm you block with, ' +
      'which the drill sergeant insists is also the arm you swing with.',
  },
  marching_boots: {
    id: 'marching_boots',
    category: 'armor',
    name: 'Marching Boots',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: { kind: 'garment', garment: 'carl_boots' }, cat: UNDRAWN_ON_DONUT },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { dexterity: 1 },
    description:
      'Hobnailed, hard-soled, and broken in by a man who is not coming back for them. ' +
      'Everything on this floor is faster than you. These make it less true.',
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
  skill_book_night_vision: {
    id: 'skill_book_night_vision',
    category: 'book',
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
    category: 'armor',
    name: 'Enchanted BigBoi Boxers',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    wearer: 'both',
    look: { human: { kind: 'garment', garment: 'carl_boxers' }, cat: UNDRAWN_ON_DONUT },
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
    category: 'quest',
    name: "Carl's Doomsday Scenario",
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
    name: 'The Key',
    stackable: false,
    canHotlist: false,
    canDrop: false,
    isQuestItem: true,
    description:
      'An absurdly large gold key, lifted from the vault of the Goblin High Security Prison. ' +
      'The gate guard outside will want it back. He will be insufferable about it.',
  },
  nightgaunt_cloak: {
    id: 'nightgaunt_cloak',
    category: 'armor',
    name: 'Enchanted Nightgaunt Cloak of Stoutness',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Back',
    wearer: 'human',
    look: { kind: 'garment', garment: 'carl_cloak' },
    statBonus: { constitution: 4 },
    resistances: ['poison', 'ice', 'piercing'],
    description:
      'The wearer of this cloak gains +4 to Constitution and becomes resistant to poison and ' +
      'ice-based attacks. In addition, the cloak adds Anti-Piercing resistance to all worn armor. ' +
      'It also makes you look like a dollar store Batman.',
  },
  slate_butterfly_talisman: {
    id: 'slate_butterfly_talisman',
    category: 'armor',
    name: 'Talisman of the Slate Butterfly',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_butterfly_talisman' },
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
    category: 'armor',
    name: 'Enchanted Fae Scale Quadruped Crupper of the Fleet',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Torso',
    equipSubSlot: 'Jacket',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_scale_crupper' },
    statBonus: { dexterity: 2 },
    description:
      'Light and flexible, this scale armor is made from Fae Steel. While not as strong as Elven ' +
      "mail or even good Orcish steel, it's the strongest alloy that fairy folk can wear. It's " +
      "not the best protection, but it'll make your ass look oh so pretty.",
  },
  bracelet_of_dex: {
    id: 'bracelet_of_dex',
    category: 'armor',
    name: 'Bracelet of +2 DEX',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_dex_bracelet' },
    statBonus: { dexterity: 2 },
    description: 'An agility boosting accessory equipped on the front leg.',
  },
  eyes_of_splatter: {
    id: 'eyes_of_splatter',
    category: 'armor',
    name: 'Eyes of Splatter',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Head',
    equipSubSlot: 'Face',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_shades' },
    description:
      'Legendary. Round pink sunglasses with something red dried across one lens. Every Magic ' +
      'Missile that hits an enemy splits into three copies that hunt down anything hostile ' +
      'nearby. With nothing to hunt, the copies circle the wearer until something shows up, or ' +
      'until they get bored. They look fabulous. The wearer is aware of this.',
  },
  splatter_skunk_toe_ring: {
    id: 'splatter_skunk_toe_ring',
    category: 'armor',
    name: 'Enchanted Toe Ring of the Splatter Skunk',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Feet',
    equipSubSlot: 'Toe Ring',
    wearer: 'human',
    look: { kind: 'garment', garment: 'carl_toe_ring' },
    statBonus: { strength: 3 },
    skillLevelBonus: { pugilism: 3 },
    description:
      "Imbues wearer with +3 Strength and gives +3 to the Pugilism Skill. Also, it's a toe ring. " +
      "It's probably uncomfortable and it makes you look like one of those hippie assholes who " +
      'sit around in a field juggling and hula-hooping all day.',
  },
  fairy_repellent_signet: {
    id: 'fairy_repellent_signet',
    category: 'armor',
    name: 'Fairy Repellent Signet',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: RING_LOOK, cat: RING_LOOK },
    equipSlot: 'Hands',
    equipSubSlot: 'Ring',
    fairyImmunities: ['ice', 'fire'],
    description:
      'Legendary. A fat signet with an opal face, half frost and half ember, that fairies find ' +
      'personally offensive. Ice fairy bolts and death blasts cannot hurt, chill or freeze you, ' +
      'and fire fairy fireballs, blasts, death flames and death explosions cannot hurt or burn ' +
      'you. Every other kind of ice and fire still works on you just fine.',
  },
  ring_of_the_cold_shoulder: {
    id: 'ring_of_the_cold_shoulder',
    category: 'armor',
    name: 'Ring of the Cold Shoulder',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: RING_LOOK, cat: RING_LOOK },
    equipSlot: 'Hands',
    equipSubSlot: 'Ring',
    fairyImmunities: ['ice'],
    description:
      'Platinum. A frosted band for people who have been ignored at better parties than this. ' +
      'Ice fairy bolts and death blasts cannot hurt, chill or freeze you. It does nothing ' +
      'about fire fairies, or about any ice that does not come from a fairy.',
  },
  ring_of_the_asbestos_knuckle: {
    id: 'ring_of_the_asbestos_knuckle',
    category: 'armor',
    name: 'Ring of the Asbestos Knuckle',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    wearer: 'both',
    look: { human: RING_LOOK, cat: RING_LOOK },
    equipSlot: 'Hands',
    equipSubSlot: 'Ring',
    fairyImmunities: ['fire'],
    description:
      'Platinum. Smoulders pleasantly and is almost certainly a health hazard. Fire fairy ' +
      'fireballs, blasts, death flames and death explosions cannot hurt or burn you. It does ' +
      'nothing about ice fairies, or about any fire that does not come from a fairy.',
  },
  shade_gnoll_kneepads: {
    id: 'shade_gnoll_kneepads',
    category: 'armor',
    name: 'Enchanted Spiked Kneepads of the Shade Gnoll Riot Forces',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Legs',
    equipSubSlot: 'Knee Pads',
    wearer: 'human',
    look: { kind: 'garment', garment: 'carl_kneepads' },
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
    category: 'armor',
    name: 'Enchanted War Gauntlet of the Exalted Grull',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    wearer: 'human',
    look: { kind: 'garment', garment: 'carl_gauntlet' },
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
  slingshot: {
    id: 'slingshot',
    category: 'weapon',
    // The human's only ranged weapon and no shop ever sells another — selling
    // it away would strand them with no way to get it back.
    unsellable: true,
    name: 'Slingshot & Rocks',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    equipSlot: 'Hand',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: { delivery: 'sling', heldVisual: 'slingshot' },
    description:
      'Slingshots are small, handheld, hand-powered projectile weapons typically made with a ' +
      'Y-shaped frame with an elastic strip tied to the ends of each prong. On Earth, slingshots ' +
      'are common toys but have also been used as military weapons by guerilla forces. During the ' +
      "Siege of Marawi in 2017, the Philippine Army's elite Scout Rangers used slingshots to hurl " +
      'grenades at opposing forces.',
  },
  fury_of_taranis: {
    id: 'fury_of_taranis',
    category: 'weapon',
    // A one-off prize with no other source: sold, it could never be had again.
    unsellable: true,
    name: 'The Fury of Taranis',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    equipSlot: 'Hand',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blade',
      damageMultiplier: TARANIS_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      onStrike: 'taranisStorm',
      heldVisual: 'fury_of_taranis',
    },
    description:
      'Legendary. A bronze-hilted silver sword with a storm trapped in its edge. Every blow lands ' +
      'twice as hard as a fist, every swing throws a slicing wave of lightning four tiles ahead ' +
      'that cuts through everything in its path, ' +
      'and anything it cuts throws chain lightning to up to four more enemies nearby. ' +
      'Taranis was the Gaulish god of thunder. He did not ask for it back.',
  },
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
    equipSlot: 'Hand',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blade',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'plain_arming_sword',
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
    equipSlot: 'Hand',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blunt',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'spiked_club',
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
    equipSlot: 'Hand',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      strike: 'blade',
      damageMultiplier: PROVING_WEAPON_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'felling_axe',
    },
    description: 'A long-hafted two-handed axe with a narrow felling bit. Development only.',
  },
};

/** Bag slots shown on one page of the bag; the bag grows a page at a time and is never full. */
export const BAG_PAGE_SLOTS = 32;
export const HOTBAR_COUNT = 8;
/** Last hotbar slot index, reserved for quest items. */
export const QUEST_SLOT_IDX = HOTBAR_COUNT - 1; // slot 7

/** Sub-slots available in each equipment slot. */
export const EQUIP_SUBSLOTS: Readonly<Record<EquipSlot, readonly string[]>> = {
  Head: ['Hat', 'Face', 'Neck'],
  Mouth: ['Held'],
  Torso: ['Shirt', 'Jacket', 'Back'],
  Legs: ['Pants', 'Knee Pads'],
  Hands: ['Gloves', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4'],
  Hand: ['Main', 'Off'],
  Feet: ['Shoes', 'Toe Ring 1', 'Toe Ring 2', 'Toe Ring 3', 'Toe Ring 4'],
};

/**
 * Which crawler has each section at all. Carl's hands hold and Donut's mouth
 * carries; neither can use the other's.
 */
export const EQUIP_SLOT_WEARER: Readonly<Record<EquipSlot, Wearer>> = {
  Head: 'both',
  Mouth: 'cat',
  Torso: 'both',
  Legs: 'both',
  Hands: 'both',
  Hand: 'human',
  Feet: 'both',
};

/** The key of Carl's main hand, where the weapon he draws from the hotbar is held. */
export const MAIN_HAND_KEY = 'Hand:Main';
/** The equipment key of what Donut carries in her jaws. */
export const MOUTH_HELD_KEY = 'Mouth:Held';

const EQUIP_SLOT_NAMES: ReadonlySet<string> = new Set(Object.keys(EQUIP_SUBSLOTS));

function isEquipSlot(name: string): name is EquipSlot {
  return EQUIP_SLOT_NAMES.has(name);
}

/**
 * The section a `"Slot:SubSlot"` key names, or null when the key names no
 * sub-slot that exists — a key written under a since-renamed slot.
 */
export function equipSlotOfKey(key: string): EquipSlot | null {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const slot = key.slice(0, separator);
  const subSlot = key.slice(separator + 1);
  if (!isEquipSlot(slot)) return null;
  return EQUIP_SUBSLOTS[slot].includes(subSlot) ? slot : null;
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

/** How `def` looks on Donut, or null for anything she cannot wear. */
export function catLookOf(def: ItemDef): WearerLook<'cat'> | null {
  if (def.type !== 'armor') return null;
  if (def.wearer === 'both') return def.look.cat;
  return def.wearer === 'cat' ? def.look : null;
}

/** How `def` looks on Carl, or null for anything he cannot wear. */
export function humanLookOf(def: ItemDef): WearerLook<'human'> | null {
  if (def.type !== 'armor') return null;
  if (def.wearer === 'both') return def.look.human;
  return def.wearer === 'human' ? def.look : null;
}

/** The weapon stat block of `id`, or null for anything that is not a weapon. */
export function weaponStatsOf(id: ItemId): WeaponStats | null {
  return isItemId(id) ? (ITEM_DEF[id].weapon ?? null) : null;
}

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
