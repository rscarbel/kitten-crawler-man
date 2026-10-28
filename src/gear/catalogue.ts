/**
 * Every piece of gear a crawler can find, buy or earn: worn pieces, the
 * human's weapons, the cat's claws, trinkets and relics. Spread into
 * `ITEM_DEFS`, so each entry is an ordinary item definition; kept apart only
 * because the catalogue is long and is all one kind of thing.
 *
 * Every number a piece's mechanics read is a named constant here, so tuning a
 * piece never means hunting through its definition. Stat bonuses stay inline:
 * the stat's name already says what the number is.
 */

import type { ItemDef, ItemId } from '../core/items/defs/ItemDefs';
import { defineItemDefs } from '../core/items/defs/itemNameRules';
import {
  HUMAN_ARM_REACH_TILES,
  STORMCALLER_DAMAGE_MULTIPLIER,
} from '../core/items/equipment/weapons';
import type {
  CatCharmGarmentId,
  GarmentLook,
  HumanTrinketGarmentId,
  NoLook,
  OffHandLook,
} from '../sprites/garments/garmentIds';

/** A relic is a world sprite at the shoulder, so neither crawler's figure shows it. */
const RELIC_LOOK: NoLook = {
  kind: 'none',
  reason: 'A relic floats beside the shoulder as a world sprite, never on the figure.',
  heardAs: 'jewelry',
};

/** A trinket is a ring on his hand (the bangle at his wrist) and a charm on her collar. */
function onHisHand(garment: HumanTrinketGarmentId): GarmentLook<'human'> {
  return { kind: 'garment', garment };
}

function onHerCollar(garment: CatCharmGarmentId): GarmentLook<'cat'> {
  return { kind: 'garment', garment };
}

/** The buckler rides in his off hand, held by its knob; a pot lid goes on with a clank. */
const BUCKLER_LOOK: OffHandLook = {
  kind: 'offHand',
  heldVisual: 'pot_lid_buckler',
  heardAs: 'metal',
};

// Human pieces.
const RIOT_KNEEGUARDS_THORNS_SHARE = 0.1;
const RIOT_KNEEGUARDS_RIPOSTE_WINDOW_FRAMES = 90;
const RIOT_KNEEGUARDS_RIPOSTE_MULTIPLIER = 1.5;
const IRON_KNUCKLE_STUN_CHANCE = 0.03;
const IRON_KNUCKLE_MECHANICAL_FIST_LEVELS = 2;
const HAZARD_GOGGLES_BLAST_TILES = 1;
const DEMOLITION_APRON_REFUND_CHANCE = 0.2;
const FOREMANS_HARDHAT_HARVEST_BONUS = 1;
const SILKSPINNER_WEB_CHANCE = 0.2;
const POT_LID_BUCKLER_BLOCK_CHANCE = 0.3;
/** Shots from anywhere in front of him: within sixty degrees either side of where he faces. */
const POT_LID_BUCKLER_ARC_DEGREES = 120;

// Human weapons.
const REBAR_SHIV_DAMAGE_MULTIPLIER = 1.1;
const PIPE_WRENCH_DAMAGE_MULTIPLIER = 1.3;
const PIPE_WRENCH_STUN_CHANCE = 0.05;
const RATTLESTICK_RICOCHET_BOUNCES = 1;
const FIRE_AXE_DAMAGE_MULTIPLIER = 1.6;
const FIRE_AXE_BURN_CHANCE = 0.25;
const GRAVEDIGGERS_SPADE_DAMAGE_MULTIPLIER = 1.8;
const GRAVEDIGGERS_SPADE_KILL_HEAL_SHARE = 0.03;
const LAST_WORD_DAMAGE_MULTIPLIER = 2.2;
const LAST_WORD_AWAKENING_KILLS = 300;
const LAST_WORD_CHAIN_TARGETS = 2;
const LAST_WORD_CHAIN_RANGE_TILES = 3;
const LAST_WORD_CHAIN_DAMAGE_SHARE = 0.5;

// Cat pieces.
const PLUMED_COAT_DODGE_CHANCE = 0.05;
const STARGAZERS_CAP_MISSILE_SPEED = 1.3;
const KALEIDOSCOPE_MISSILE_COPIES = 3;
const HALO_NINTH_LIFE_HP_SHARE = 0.5;

// Cat claws.
/** What claw caps with no stronger edge of their own add to a bare swipe. */
const CLAW_CAP_DAMAGE_MULTIPLIER = 1.15;
const PROWLER_CLAWS_DAMAGE_MULTIPLIER = 1.3;
const SUNSTEEL_TALONS_DAMAGE_MULTIPLIER = 1.6;
/** Claws reach no further than her paw; a longer reach would be a different weapon. */
const CLAW_REACH_BONUS_TILES = 0;
const VENOM_CLAWS_POISON_CHANCE = 0.2;
const FROSTBITE_CLAWS_CHILL_CHANCE = 0.25;
const INK_DIPPED_CLAWS_INK_CHANCE = 0.3;
const SUNSTEEL_SLASH_EVERY_NTH_SWIPE = 4;
const SUNSTEEL_SLASH_RANGE_TILES = 3;

// Shared pieces.
const SCRAPMAIL_REGEN_MULTIPLIER = 1.5;
const SCRAPMAIL_STILLNESS_FRAMES = 120;
const SCRAPMAIL_STILLNESS_REGEN = 2;
const COCKSCOMB_FLINCH_CHANCE = 0.08;
const COCKSCOMB_FLINCH_RANGE_TILES = 2;
const COCKSCOMB_FLINCH_FRAMES = 20;
const LOCKET_LINK_RANGE_TILES = 6;
const LOCKET_LINK_REGEN_MULTIPLIER = 1.5;
const LOCKET_LINK_STAT_BONUS = 1;
const LOCKET_LINK_SHIELD_FRAMES = 120;
const GRINNING_MASK_MAX_HP_PENALTY = 0.25;
const LUCKY_PENNY_COIN_SHARE = 0.1;
const FANG_CHARM_LIFESTEAL_SHARE = 0.04;
const HOURGLASS_HP_SHARE = 0.25;
const HOURGLASS_SLOW_FRAMES = 180;
const HOURGLASS_COOLDOWN_FRAMES = 3600;

// Relics.
const EMBER_WISP_COOLDOWN_FRAMES = 180;
const EMBER_WISP_RANGE_TILES = 5;
const WARD_STONE_COOLDOWN_FRAMES = 360;
const WARD_STONE_RANGE_TILES = 3;
const SPROUTLING_COOLDOWN_FRAMES = 1200;
const SPROUTLING_RANGE_TILES = 4;

/** Every piece of gear's definition, keyed by id. */
export const GEAR_CATALOGUE = defineItemDefs({
  // Human only.
  lucky_hoodie: {
    id: 'lucky_hoodie',
    category: 'armor',
    name: 'Lucky Hoodie',
    stackable: false,
    canHotlist: true,
    type: 'armor',
    rarity: 'Common',
    wearer: 'human',
    look: { kind: 'garment', garment: 'human_lucky_hoodie' },
    equipSlot: 'Torso',
    equipSubSlot: 'Jacket',
    statBonus: { health: 2 },
    traits: [{ kind: 'grantsAbility', ability: 'energy_shield' }],
    description:
      'A faded red pullover with one drawstring chewed flat. He has never once washed it ' +
      'before a big day, and he is not about to start now.',
  },
  scrappers_wraps: {
    id: 'scrappers_wraps',
    category: 'armor',
    name: "Scrapper's Wraps",
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'human',
    look: { kind: 'garment', garment: 'human_scrappers_wraps' },
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    statBonus: { melee: 1 },
    skillLevelBonus: { pugilism: 1 },
    description:
      'Cloth hand-wraps taped at the wrist, grey where the last owner bled into them and ' +
      'greyer where he did not.',
  },
  hobnail_boots: {
    id: 'hobnail_boots',
    category: 'armor',
    name: 'Hobnail Boots',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Uncommon',
    wearer: 'human',
    set: 'bareknuckle',
    look: { kind: 'garment', garment: 'human_hobnail_boots' },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { evasiveness: 1 },
    cancelsMomentum: true,
    description:
      'Heavy brown boots with iron studs hammered through the soles. They announce you on ' +
      'stone floors and hold you there when something tries to move you.',
  },
  riot_kneeguards: {
    id: 'riot_kneeguards',
    category: 'armor',
    name: 'Riot Kneeguards',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'human',
    set: 'bareknuckle',
    look: { kind: 'garment', garment: 'human_riot_kneeguards' },
    equipSlot: 'Legs',
    equipSubSlot: 'Knees',
    traits: [
      { kind: 'thorns', share: RIOT_KNEEGUARDS_THORNS_SHARE },
      {
        kind: 'riposte',
        windowFrames: RIOT_KNEEGUARDS_RIPOSTE_WINDOW_FRAMES,
        multiplier: RIOT_KNEEGUARDS_RIPOSTE_MULTIPLIER,
      },
    ],
    description:
      'Black hard-shell guards scuffed white at the caps. Someone stencilled a number on ' +
      'each one, and the numbers do not match.',
  },
  iron_knuckle_gauntlet: {
    id: 'iron_knuckle_gauntlet',
    category: 'armor',
    name: 'Iron Knuckle Gauntlet',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'human',
    set: 'bareknuckle',
    look: { kind: 'garment', garment: 'human_iron_knuckle_gauntlet' },
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    meleeOnlyStatBonus: { melee: 3 },
    skillLevelBonus: { mechanical_fist: IRON_KNUCKLE_MECHANICAL_FIST_LEVELS },
    traits: [
      { kind: 'fistFamily', family: 'gauntlet' },
      { kind: 'onHitStatus', status: 'stun', chance: IRON_KNUCKLE_STUN_CHANCE, on: 'melee' },
    ],
    description:
      'One riveted iron gauntlet for the right hand. The left was never found, and nobody ' +
      'who has worn this one has gone looking.',
  },
  patched_duster: {
    id: 'patched_duster',
    category: 'armor',
    name: 'Patched Duster',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'human',
    look: { kind: 'garment', garment: 'human_patched_duster' },
    equipSlot: 'Torso',
    equipSubSlot: 'Back',
    statBonus: { health: 4 },
    resistances: ['poison', 'piercing'],
    description:
      'A long leather coat flared at the hem, more patch than coat by now. Every patch is a ' +
      'different leather, and every one comes with a story its last owner told unasked.',
  },
  hazard_goggles: {
    id: 'hazard_goggles',
    category: 'armor',
    name: 'Hazard Goggles',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Uncommon',
    wearer: 'human',
    set: 'demolition_crew',
    look: { kind: 'garment', garment: 'human_hazard_goggles' },
    equipSlot: 'Head',
    equipSubSlot: 'Face',
    traits: [{ kind: 'explosiveCraft', radiusTiles: HAZARD_GOGGLES_BLAST_TILES, refundChance: 0 }],
    description:
      'Amber-lensed welding goggles on a cracked rubber strap. The world through them is the ' +
      'colour of a fuse just before it is too late.',
  },
  demolition_apron: {
    id: 'demolition_apron',
    category: 'armor',
    name: 'Demolition Apron',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'human',
    set: 'demolition_crew',
    look: { kind: 'garment', garment: 'human_demolition_apron' },
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { melee: 2 },
    traits: [
      { kind: 'explosiveCraft', radiusTiles: 0, refundChance: DEMOLITION_APRON_REFUND_CHANCE },
    ],
    description:
      'A scorched leather apron with a row of stick loops across the chest. It smells of ' +
      'powder and confidence, in that order.',
  },
  foremans_hardhat: {
    id: 'foremans_hardhat',
    category: 'armor',
    name: "Foreman's Hardhat",
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Uncommon',
    wearer: 'human',
    set: 'demolition_crew',
    look: { kind: 'garment', garment: 'human_foremans_hardhat' },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    traits: [{ kind: 'harvestYield', bonus: FOREMANS_HARDHAT_HARVEST_BONUS }],
    description:
      'A yellow hardhat scuffed down to the plastic, with a tally of finished jobs scratched ' +
      'into the brim by somebody who stopped counting at ten.',
  },
  silkspinner_gloves: {
    id: 'silkspinner_gloves',
    category: 'armor',
    name: 'Silkspinner Gloves',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'human',
    look: { kind: 'garment', garment: 'human_silkspinner_gloves' },
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    traits: [{ kind: 'onHitStatus', status: 'web', chance: SILKSPINNER_WEB_CHANCE, on: 'melee' }],
    description:
      'Pale gloves that trail fine threads from every fingertip. The threads are still ' +
      'sticky, and still, faintly, being spun.',
  },
  hamhock_boots: {
    id: 'hamhock_boots',
    category: 'armor',
    name: 'Hamhock Boots',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'human',
    look: { kind: 'garment', garment: 'human_hamhock_boots' },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { health: 2 },
    cancelsMomentum: true,
    description:
      'Pig-leather boots with trotter toe caps. They squeak when wet, which they always are.',
  },

  // Human weapons.
  rebar_shiv: {
    id: 'rebar_shiv',
    category: 'weapon',
    name: 'Rebar Shiv',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Common',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'smallBlade',
      damageMultiplier: REBAR_SHIV_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'rebar_shiv',
      sound: 'smallBlade',
    },
    description:
      'A length of rebar ground to a point on somebody’s doorstep, with tape wound round the ' +
      'end you hold. Crude, sharp and entirely his.',
  },
  pipe_wrench: {
    id: 'pipe_wrench',
    category: 'weapon',
    name: 'Pipe Wrench',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Uncommon',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'blunt',
      damageMultiplier: PIPE_WRENCH_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'pipe_wrench',
      sound: 'ironBlunt',
    },
    traits: [{ kind: 'onHitStatus', status: 'stun', chance: PIPE_WRENCH_STUN_CHANCE, on: 'melee' }],
    description:
      'Eighteen inches of red-painted cast iron with a jaw that no longer adjusts. It was ' +
      'built to loosen things, and it still does.',
  },
  rattlestick_sling: {
    id: 'rattlestick_sling',
    category: 'weapon',
    name: 'Rattlestick Sling',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Uncommon',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: { delivery: 'sling', family: 'sling', heldVisual: 'rattlestick_sling', sound: 'sling' },
    traits: [{ kind: 'ricochet', bounces: RATTLESTICK_RICOCHET_BOUNCES }],
    description:
      'A forked stick with a band cut from an inner tube and a pocket of stones that rattle ' +
      'whenever he moves. Subtlety was never on the table.',
  },
  fire_axe: {
    id: 'fire_axe',
    category: 'weapon',
    name: 'Fire Axe',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Rare',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'axe',
      damageMultiplier: FIRE_AXE_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'fire_axe',
      sound: 'chopAxe',
    },
    traits: [{ kind: 'onHitStatus', status: 'burn', chance: FIRE_AXE_BURN_CHANCE, on: 'melee' }],
    description:
      'A red-headed axe pulled out of a broken glass case marked IN EMERGENCY. The head is ' +
      'still warm, and the case is still somewhere in the garbage.',
  },
  gravediggers_spade: {
    id: 'gravediggers_spade',
    category: 'weapon',
    name: "Gravedigger's Spade",
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Epic',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'blunt',
      damageMultiplier: GRAVEDIGGERS_SPADE_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'gravediggers_spade',
      sound: 'flatShovel',
    },
    traits: [{ kind: 'onKillHeal', maxHpShare: GRAVEDIGGERS_SPADE_KILL_HEAL_SHARE }],
    description:
      'A long-handled spade with a blade worn thin by a lifetime of other people’s endings. ' +
      'It does not mind adding a few more.',
  },
  stormcaller: {
    id: 'stormcaller',
    category: 'weapon',
    // A one-off prize with no other source: sold, it could never be had again.
    unsellable: true,
    name: 'Stormcaller',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Legendary',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'sword',
      damageMultiplier: STORMCALLER_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      onStrike: 'stormcallerStorm',
      heldVisual: 'stormcaller',
      sound: 'sword',
    },
    description:
      'A bronze-hilted silver sword with a storm trapped in its edge. On a quiet day you can ' +
      'hear it grumbling in the scabbard.',
  },
  the_last_word: {
    id: 'the_last_word',
    category: 'weapon',
    // One of a kind, earned once: sold, it could never be had again.
    unsellable: true,
    name: 'The Last Word',
    stackable: false,
    canHotlist: true,
    type: 'weapon',
    rarity: 'Divine',
    equipSlot: 'Weapon',
    equipSubSlot: 'Main',
    wearer: 'human',
    weapon: {
      delivery: 'melee',
      family: 'sword',
      damageMultiplier: LAST_WORD_DAMAGE_MULTIPLIER,
      reachTiles: HUMAN_ARM_REACH_TILES,
      heldVisual: 'the_last_word',
      sound: 'sword',
      awakenedHeldVisual: 'the_last_word_awakened',
    },
    traits: [
      {
        kind: 'awakening',
        kills: LAST_WORD_AWAKENING_KILLS,
        awakensTo: [
          {
            kind: 'chainSpark',
            targets: LAST_WORD_CHAIN_TARGETS,
            rangeTiles: LAST_WORD_CHAIN_RANGE_TILES,
            damageShare: LAST_WORD_CHAIN_DAMAGE_SHARE,
          },
        ],
      },
    ],
    description:
      'A plain, narrow blade that takes no notice of anything until it has settled a great ' +
      'many arguments. After that, it always gets the final say.',
  },
  pot_lid_buckler: {
    id: 'pot_lid_buckler',
    category: 'armor',
    name: 'Pot-Lid Buckler',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'human',
    look: BUCKLER_LOOK,
    equipSlot: 'Weapon',
    equipSubSlot: 'Off',
    traits: [
      {
        kind: 'frontalBlock',
        chance: POT_LID_BUCKLER_BLOCK_CHANCE,
        arcDegrees: POT_LID_BUCKLER_ARC_DEGREES,
      },
    ],
    description:
      'A dented stockpot lid with a leather strap riveted across the back. It has stopped ' +
      'soup, arrows and one very determined goose.',
  },

  // Cat only.
  velvet_harness: {
    id: 'velvet_harness',
    category: 'armor',
    name: 'Velvet Harness',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_velvet_harness' },
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { health: 2, evasiveness: 1 },
    description:
      'A plum velvet harness with little brass rings. It is the least practical thing she ' +
      'owns and she would fight anyone who said so.',
  },
  mousehide_booties: {
    id: 'mousehide_booties',
    category: 'armor',
    name: 'Mousehide Booties',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Uncommon',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_mousehide_booties' },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { evasiveness: 2 },
    description:
      'Four soft grey booties that make no sound at all. She considers the irony of the ' +
      'material a perk.',
  },
  plumed_coat: {
    id: 'plumed_coat',
    category: 'armor',
    name: 'Plumed Coat',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_plumed_coat' },
    equipSlot: 'Torso',
    equipSubSlot: 'Jacket',
    statBonus: { evasiveness: 2 },
    traits: [{ kind: 'dodgeChance', chance: PLUMED_COAT_DODGE_CHANCE }],
    description:
      'A light leather coat trimmed down the spine with copper rooster feathers. Its ' +
      'previous owner did not give them up willingly.',
  },
  stargazers_cap: {
    id: 'stargazers_cap',
    category: 'armor',
    name: "Stargazer's Cap",
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_stargazers_cap' },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { magic: 3 },
    resistances: ['magic'],
    traits: [{ kind: 'missileSpeed', multiplier: STARGAZERS_CAP_MISSILE_SPEED }],
    description:
      'A little indigo pointed cap stitched with silver stars, cut with holes for the ears. ' +
      'It slides over one eye at exactly the wrong moments.',
  },
  moonmoth_pendant: {
    id: 'moonmoth_pendant',
    category: 'armor',
    name: 'Moonmoth Pendant',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_moonmoth_pendant' },
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    statBonus: { evasiveness: 3, magic: 1 },
    resistances: ['magic'],
    traits: [{ kind: 'fairyTruce' }],
    description:
      'A pair of pale moth wings set in silver on a fine chain. Fairies tilt their heads at ' +
      'it as if they half recognise someone.',
  },
  kaleidoscope_specs: {
    id: 'kaleidoscope_specs',
    category: 'armor',
    // A one-off prize with no other source: sold, it could never be had again.
    unsellable: true,
    name: 'Kaleidoscope Specs',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Legendary',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_kaleidoscope_specs' },
    equipSlot: 'Head',
    equipSubSlot: 'Face',
    traits: [{ kind: 'missileSplit', copies: KALEIDOSCOPE_MISSILE_COPIES }],
    description:
      'Round prismatic glasses that throw coloured glints across every wall. She sees three ' +
      'of everything through them, and she likes all three.',
  },
  halo_of_the_ninth_life: {
    id: 'halo_of_the_ninth_life',
    category: 'armor',
    // One of a kind, earned once: sold, it could never be had again.
    unsellable: true,
    name: 'Halo of the Ninth Life',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Divine',
    wearer: 'cat',
    look: { kind: 'garment', garment: 'cat_halo_of_the_ninth_life' },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    traits: [{ kind: 'ninthLife', hpShare: HALO_NINTH_LIFE_HP_SHARE }],
    description:
      'A thin gold ring that floats a whisker above her ears and hums when she is reckless. ' +
      'It hums a great deal.',
  },
  prowler_hood: {
    id: 'prowler_hood',
    category: 'armor',
    name: 'Prowler Hood',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    set: 'prowler',
    look: { kind: 'garment', garment: 'cat_prowler_hood' },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { evasiveness: 1 },
    description:
      'A charcoal felt hood with silver stitching round the ear holes. It makes her face ' +
      'very hard to read, which was already true.',
  },
  prowler_mantle: {
    id: 'prowler_mantle',
    category: 'armor',
    name: 'Prowler Mantle',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    set: 'prowler',
    look: { kind: 'garment', garment: 'cat_prowler_mantle' },
    equipSlot: 'Torso',
    equipSubSlot: 'Back',
    statBonus: { evasiveness: 2 },
    description:
      'A short charcoal mantle with silver stitching at the hem, cut to lie flat when she ' +
      'crouches and to swirl when she wants it to.',
  },
  prowler_booties: {
    id: 'prowler_booties',
    category: 'armor',
    name: 'Prowler Booties',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'cat',
    set: 'prowler',
    look: { kind: 'garment', garment: 'cat_prowler_booties' },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { evasiveness: 1 },
    description: 'Charcoal felt booties stitched in silver, with soles thinner than a whisper.',
  },
  tin_claw_caps: {
    id: 'tin_claw_caps',
    category: 'weapon',
    name: 'Tin Claw Caps',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Common',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: CLAW_CAP_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: null,
      garment: 'cat_tin_claw_caps',
      sound: 'tinCaps',
    },
    description: 'Dull tin caps that click over each claw. They clatter on tile floors.',
  },
  venom_claws: {
    id: 'venom_claws',
    category: 'weapon',
    name: 'Venom Claws',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Uncommon',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: CLAW_CAP_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: 'venom',
      garment: 'cat_venom_claws',
      sound: 'talons',
    },
    traits: [
      { kind: 'onHitStatus', status: 'poison', chance: VENOM_CLAWS_POISON_CHANCE, on: 'melee' },
    ],
    description: 'Claw caps lacquered a glossy green that never quite dries.',
  },
  frostbite_claws: {
    id: 'frostbite_claws',
    category: 'weapon',
    name: 'Frostbite Claws',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Rare',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: CLAW_CAP_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: 'frost',
      garment: 'cat_frostbite_claws',
      sound: 'talons',
    },
    traits: [
      { kind: 'onHitStatus', status: 'chill', chance: FROSTBITE_CLAWS_CHILL_CHANCE, on: 'melee' },
    ],
    description:
      'Ice-blue caps cold enough to fog in warm air. Whoever handed them over swore they were ' +
      'a gift and not a bribe.',
  },
  prowler_claws: {
    id: 'prowler_claws',
    category: 'weapon',
    name: 'Prowler Claws',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Rare',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    set: 'prowler',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: PROWLER_CLAWS_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: null,
      garment: 'cat_prowler_claws',
      sound: 'talons',
    },
    description: 'Black hooked claws, blackened so they never catch the light.',
  },
  ink_dipped_claws: {
    id: 'ink_dipped_claws',
    category: 'weapon',
    name: 'Ink-Dipped Claws',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Epic',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: CLAW_CAP_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: 'ink',
      garment: 'cat_ink_dipped_claws',
      sound: 'talons',
    },
    traits: [
      { kind: 'onHitStatus', status: 'ink', chance: INK_DIPPED_CLAWS_INK_CHANCE, on: 'melee' },
    ],
    description:
      'Claws dipped to the quick in something black that came out of a very large squid. ' +
      'They leave fingerprints, which cats are not supposed to have.',
  },
  sunsteel_talons: {
    id: 'sunsteel_talons',
    category: 'weapon',
    // One of a kind, earned once: sold, it could never be had again.
    unsellable: true,
    name: 'Sunsteel Talons',
    stackable: false,
    canHotlist: false,
    type: 'weapon',
    rarity: 'Legendary',
    equipSlot: 'Weapon',
    equipSubSlot: 'Claws',
    wearer: 'cat',
    weapon: {
      delivery: 'claw',
      family: 'claw',
      damageMultiplier: SUNSTEEL_TALONS_DAMAGE_MULTIPLIER,
      reachBonusTiles: CLAW_REACH_BONUS_TILES,
      trail: 'sunsteel',
      garment: 'cat_sunsteel_talons',
      sound: 'talons',
    },
    traits: [
      {
        kind: 'slashWave',
        everyNth: SUNSTEEL_SLASH_EVERY_NTH_SWIPE,
        rangeTiles: SUNSTEEL_SLASH_RANGE_TILES,
      },
    ],
    description:
      'Gold talons that run warm to the touch and flare like a struck match when she swipes. ' +
      'She has stopped pretending they are not her favourite thing.',
  },

  // Shared.
  hearthguard_cap: {
    id: 'hearthguard_cap',
    category: 'armor',
    name: 'Hearthguard Cap',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'both',
    set: 'hearthguard',
    look: {
      human: { kind: 'garment', garment: 'human_hearthguard_cap' },
      cat: { kind: 'garment', garment: 'cat_hearthguard_cap' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { health: 2 },
    description:
      'A padded wool cap in garrison brown. It keeps the ears warm and the skull mostly ' +
      'where it belongs.',
  },
  hearthguard_quilted_vest: {
    id: 'hearthguard_quilted_vest',
    category: 'armor',
    name: 'Hearthguard Quilted Vest',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'both',
    set: 'hearthguard',
    look: {
      human: { kind: 'garment', garment: 'human_hearthguard_quilted_vest' },
      cat: { kind: 'garment', garment: 'cat_hearthguard_quilted_vest' },
    },
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { health: 4 },
    description:
      'Layers of linen quilted flat and stitched through. Stops a tooth, spreads a club, and ' +
      'is cut in every size the garrison has ever needed, including small and furry.',
  },
  hearthguard_bracers: {
    id: 'hearthguard_bracers',
    category: 'armor',
    name: 'Hearthguard Bracers',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'human',
    set: 'hearthguard',
    look: { kind: 'garment', garment: 'human_hearthguard_bracers' },
    equipSlot: 'Hands',
    equipSubSlot: 'Gloves',
    statBonus: { melee: 1 },
    description:
      'Boiled leather over the forearm, riveted at four points, stamped with the garrison ' +
      'hearth on the inside of each cuff.',
  },
  hearthguard_boots: {
    id: 'hearthguard_boots',
    category: 'armor',
    name: 'Hearthguard Boots',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'both',
    set: 'hearthguard',
    look: {
      human: { kind: 'garment', garment: 'human_hearthguard_boots' },
      cat: { kind: 'garment', garment: 'cat_hearthguard_boots' },
    },
    equipSlot: 'Feet',
    equipSubSlot: 'Shoes',
    statBonus: { evasiveness: 1 },
    description:
      'Hard-soled garrison boots, broken in by somebody who walked a long way in them and ' +
      'handed them in clean.',
  },
  scrapmail_vest: {
    id: 'scrapmail_vest',
    category: 'armor',
    name: 'Scrapmail Vest',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    lootRecipient: 'human',
    look: {
      human: { kind: 'garment', garment: 'human_scrapmail_vest' },
      cat: { kind: 'garment', garment: 'cat_scrapmail_vest' },
    },
    equipSlot: 'Torso',
    equipSubSlot: 'Shirt',
    statBonus: { health: 6 },
    regenMultiplier: SCRAPMAIL_REGEN_MULTIPLIER,
    traits: [
      {
        kind: 'stillnessRegen',
        afterFrames: SCRAPMAIL_STILLNESS_FRAMES,
        multiplier: SCRAPMAIL_STILLNESS_REGEN,
      },
    ],
    description:
      'Bottle caps, can lids and washers wired into a vest, all of it pulled out of one ' +
      'enormous heap. It jingles like loose change and wears like a promise.',
  },
  cockscomb_crest: {
    id: 'cockscomb_crest',
    category: 'armor',
    name: 'Cockscomb Crest',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'human_cockscomb_crest' },
      cat: { kind: 'garment', garment: 'cat_cockscomb_crest' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { melee: 3 },
    traits: [
      {
        kind: 'flinchNova',
        chance: COCKSCOMB_FLINCH_CHANCE,
        rangeTiles: COCKSCOMB_FLINCH_RANGE_TILES,
        stunFrames: COCKSCOMB_FLINCH_FRAMES,
      },
    ],
    description:
      'A red-enamelled helm crest shaped like a rooster’s comb. Wearing it makes you stand ' +
      'taller, and makes everything nearby want to be somewhere else.',
  },
  stoneheart_amulet: {
    id: 'stoneheart_amulet',
    category: 'armor',
    name: 'Stoneheart Amulet',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'human_stoneheart_amulet' },
      cat: { kind: 'garment', garment: 'cat_stoneheart_amulet' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    statBonus: { health: 6 },
    cancelsMomentum: true,
    description:
      'A fist-sized lump of grey stone on a leather thong, warm and faintly beating. It is ' +
      'much heavier than it looks, and so is whoever wears it.',
  },
  sun_locket: {
    id: 'sun_locket',
    category: 'armor',
    name: 'Sun Locket',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'human_sun_locket' },
      cat: { kind: 'garment', garment: 'cat_sun_locket' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    traits: [
      {
        kind: 'partnerLink',
        partner: 'moon_locket',
        rangeTiles: LOCKET_LINK_RANGE_TILES,
        regenMultiplier: LOCKET_LINK_REGEN_MULTIPLIER,
        statBonus: LOCKET_LINK_STAT_BONUS,
        shieldFrames: LOCKET_LINK_SHIELD_FRAMES,
      },
    ],
    description:
      'A gold locket with a sunburst on the lid. Inside is half a picture; the other half is ' +
      'in the Moon Locket.',
  },
  moon_locket: {
    id: 'moon_locket',
    category: 'armor',
    name: 'Moon Locket',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'human_moon_locket' },
      cat: { kind: 'garment', garment: 'cat_moon_locket' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Neck',
    traits: [
      {
        kind: 'partnerLink',
        partner: 'sun_locket',
        rangeTiles: LOCKET_LINK_RANGE_TILES,
        regenMultiplier: LOCKET_LINK_REGEN_MULTIPLIER,
        statBonus: LOCKET_LINK_STAT_BONUS,
        shieldFrames: LOCKET_LINK_SHIELD_FRAMES,
      },
    ],
    description:
      'A silver locket with a crescent on the lid. Inside is half a picture; the other half ' +
      'is in the Sun Locket.',
  },
  showmans_top_hat: {
    id: 'showmans_top_hat',
    category: 'armor',
    name: "Showman's Top Hat",
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    set: 'gilded_showman',
    look: {
      human: { kind: 'garment', garment: 'human_showmans_top_hat' },
      cat: { kind: 'garment', garment: 'cat_showmans_top_hat' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Hat',
    statBonus: { magic: 2 },
    description:
      'A tall red top hat with a gold band and a dent where a lion once sat on it. The ' +
      'lining still smells of greasepaint.',
  },
  sequin_tailcoat: {
    id: 'sequin_tailcoat',
    category: 'armor',
    name: 'Sequin Tailcoat',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    set: 'gilded_showman',
    look: {
      human: { kind: 'garment', garment: 'human_sequin_tailcoat' },
      cat: { kind: 'garment', garment: 'cat_sequin_tailcoat' },
    },
    equipSlot: 'Torso',
    equipSubSlot: 'Jacket',
    statBonus: { health: 4 },
    description:
      'A ringmaster’s tailcoat sewn so thick with sequins that it rattles. Under a spotlight ' +
      'it is impossible to look at anything else.',
  },
  gilded_monocle: {
    id: 'gilded_monocle',
    category: 'armor',
    name: 'Gilded Monocle',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    set: 'gilded_showman',
    look: {
      human: { kind: 'garment', garment: 'human_gilded_monocle' },
      cat: { kind: 'garment', garment: 'cat_gilded_monocle' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Face',
    statBonus: { evasiveness: 2 },
    description:
      'A gold-rimmed monocle on a fine chain, handed over by a dealer who did not enjoy ' +
      'doing it. It makes everyone you look at feel slightly poorer.',
  },
  grinning_mask: {
    id: 'grinning_mask',
    category: 'armor',
    name: 'Grinning Mask',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: {
      human: { kind: 'garment', garment: 'human_grinning_mask' },
      cat: { kind: 'garment', garment: 'cat_grinning_mask' },
    },
    equipSlot: 'Head',
    equipSubSlot: 'Face',
    statBonus: { melee: 4, magic: 4 },
    traits: [{ kind: 'cursed', maxHpPenaltyShare: GRINNING_MASK_MAX_HP_PENALTY }],
    description:
      'A white porcelain mask with a smile that is a little too wide. It fits perfectly the ' +
      'first time, and every time after it fits a little tighter.',
  },
  nimble_bangle: {
    id: 'nimble_bangle',
    category: 'armor',
    name: 'Nimble Bangle',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'both',
    look: { human: onHisHand('human_nimble_bangle'), cat: onHerCollar('cat_nimble_bangle_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    statBonus: { evasiveness: 1 },
    description: 'A thin copper band that never quite stops sliding round.',
  },
  lucky_penny: {
    id: 'lucky_penny',
    category: 'armor',
    name: 'Lucky Penny',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Common',
    wearer: 'both',
    look: { human: onHisHand('human_lucky_penny_ring'), cat: onHerCollar('cat_lucky_penny_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    traits: [{ kind: 'coinBonus', share: LUCKY_PENNY_COIN_SHARE }],
    description:
      'A copper penny with a hole punched through it, worn smooth by a thumb that never ' +
      'stopped rubbing it. Heads, every time.',
  },
  fang_charm: {
    id: 'fang_charm',
    category: 'armor',
    name: 'Fang Charm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    look: { human: onHisHand('human_fang_ring'), cat: onHerCollar('cat_fang_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    traits: [{ kind: 'lifesteal', share: FANG_CHARM_LIFESTEAL_SHARE }],
    description: 'One long yellow fang bound in wire. Whatever it came out of is still hungry.',
  },
  frostward_charm: {
    id: 'frostward_charm',
    category: 'armor',
    name: 'Frostward Charm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: { human: onHisHand('human_frostward_ring'), cat: onHerCollar('cat_frostward_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    fairyImmunities: ['ice'],
    description:
      'A frosted glass bead that is always cold. Ice fairies find it personally offensive; ' +
      'every other kind of ice takes no notice.',
  },
  emberward_charm: {
    id: 'emberward_charm',
    category: 'armor',
    name: 'Emberward Charm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: { human: onHisHand('human_emberward_ring'), cat: onHerCollar('cat_emberward_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    fairyImmunities: ['fire'],
    description:
      'A smouldering cinder caged in brass that is pleasantly warm and almost certainly a ' +
      'health hazard. Fire fairies hate it; other fire does not care.',
  },
  fae_iron_charm: {
    id: 'fae_iron_charm',
    category: 'armor',
    // A one-off prize with no other source: sold, it could never be had again.
    unsellable: true,
    name: 'Fae-Iron Charm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Legendary',
    wearer: 'both',
    look: { human: onHisHand('human_fae_iron_ring'), cat: onHerCollar('cat_fae_iron_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    fairyImmunities: ['ice', 'fire'],
    description:
      'A black horseshoe nail bent into a ring, half rimed and half glowing. Every fairy in ' +
      'the room knows it is there.',
  },
  hourglass_charm: {
    id: 'hourglass_charm',
    category: 'armor',
    name: 'Hourglass Charm',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: { human: onHisHand('human_hourglass_ring'), cat: onHerCollar('cat_hourglass_charm') },
    equipSlot: 'Trinkets',
    equipSubSlot: 'Trinket',
    traits: [
      {
        kind: 'lastStand',
        hpShare: HOURGLASS_HP_SHARE,
        durationFrames: HOURGLASS_SLOW_FRAMES,
        cooldownFrames: HOURGLASS_COOLDOWN_FRAMES,
      },
    ],
    description:
      'A tiny hourglass on a jump ring whose sand runs upward when nobody is watching it.',
  },
  ember_wisp: {
    id: 'ember_wisp',
    category: 'armor',
    name: 'Ember Wisp',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Uncommon',
    wearer: 'both',
    look: { human: RELIC_LOOK, cat: RELIC_LOOK },
    equipSlot: 'Weapon',
    equipSubSlot: 'Relic',
    traits: [
      {
        kind: 'relic',
        behaviour: 'bolt',
        rechargeScalesWithMagic: false,
        status: 'burn',
        cooldownFrames: EMBER_WISP_COOLDOWN_FRAMES,
        rangeTiles: EMBER_WISP_RANGE_TILES,
      },
    ],
    description:
      'A mote of live flame that has decided it likes you. It sulks when you walk through ' +
      'water.',
  },
  ward_stone: {
    id: 'ward_stone',
    category: 'armor',
    name: 'Ward Stone',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Rare',
    wearer: 'both',
    look: { human: RELIC_LOOK, cat: RELIC_LOOK },
    equipSlot: 'Weapon',
    equipSubSlot: 'Relic',
    resistances: ['magic'],
    traits: [
      {
        kind: 'relic',
        behaviour: 'ward',
        rechargeScalesWithMagic: true,
        cooldownFrames: WARD_STONE_COOLDOWN_FRAMES,
        rangeTiles: WARD_STONE_RANGE_TILES,
      },
    ],
    description:
      'A smooth river stone carved with a ring of marks, turning slowly in the air. Arrows ' +
      'seem to lose interest near it.',
  },
  sproutling_seed: {
    id: 'sproutling_seed',
    category: 'armor',
    name: 'Sproutling Seed',
    stackable: false,
    canHotlist: false,
    type: 'armor',
    rarity: 'Epic',
    wearer: 'both',
    look: { human: RELIC_LOOK, cat: RELIC_LOOK },
    equipSlot: 'Weapon',
    equipSubSlot: 'Relic',
    traits: [
      {
        kind: 'relic',
        behaviour: 'bramble',
        rechargeScalesWithMagic: false,
        cooldownFrames: SPROUTLING_COOLDOWN_FRAMES,
        rangeTiles: SPROUTLING_RANGE_TILES,
      },
    ],
    description:
      'A seed the size of a walnut with one green shoot that never stops reaching. Briar ' +
      'Hollow gave it with both hands and would not take it back.',
  },
}) satisfies Partial<Record<ItemId, ItemDef>>;
