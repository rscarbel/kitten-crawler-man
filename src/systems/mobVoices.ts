import type { CueSlot } from '../audio/cueSlot';
import type { CreatureAudioTag } from '../audio/creatureAudioTags';
import type { Mob } from '../creatures/Mob';
import { Deinonychus } from '../creatures/Deinonychus';
import { RockGolemBoss } from '../creatures/RockGolemBoss';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { TheLich } from '../creatures/TheLich';

/** The recordings a mob voice stands in for until they are sourced. */
type WantedMobSound = 'dark_knight_punch';

type MobCueSlot = CueSlot<WantedMobSound>;

/** The moments `Mob` raises a generic sound flag for, by flag. */
export type MobVoiceMoment = 'attack' | 'projectile' | 'damage' | 'special';

/** A slot, or one picked off the mob when a single flag carries more than one cue. */
type MobVoiceSlot = MobCueSlot | ((mob: Mob) => MobCueSlot);

type MobVoice = Readonly<Record<MobVoiceMoment, MobVoiceSlot>>;

const NONE: MobCueSlot = { takes: [] };

const SILENT_VOICE: MobVoice = { attack: NONE, projectile: NONE, damage: NONE, special: NONE };

const SLASH_STRIKES: MobCueSlot = { takes: ['slash_strike_1', 'slash_strike_2', 'slash_strike_3'] };
const BITES: MobCueSlot = { takes: ['bite_1', 'bite_2', 'bite_3'] };
const ARROW_LOOSED: MobCueSlot = { takes: ['shooting_an_arrow'] };
const SOUL_BOLT_LAUNCH: MobCueSlot = { takes: ['magic_ball_launch'] };

/** The lord and the Lich carry a summon and a hand wave on the one special flag. */
function undeadCasterSpecial(mob: Mob): MobCueSlot {
  const summoned =
    (mob instanceof SkeletonLord || mob instanceof TheLich) && mob.lastSpecial === 'summon';
  return { takes: [summoned ? 'skeleton_lord_chant' : 'dead_hand_wave'] };
}

/**
 * What each creature voice plays when its mob raises a generic sound flag.
 * A tag whose row is all silent is voiced, if at all, by a cue drain of its
 * own beside `playMobAudioCues`.
 */
const MOB_VOICES: Readonly<Record<CreatureAudioTag, MobVoice>> = {
  silent: SILENT_VOICE,
  ball_of_swine: { ...SILENT_VOICE, special: { takes: ['ball_of_swine_rolling'] } },
  bear: {
    attack: { takes: ['bear_big_attack'] },
    projectile: NONE,
    damage: { takes: ['bear_growl_1'] },
    special: NONE,
  },
  big_rooster: { ...SILENT_VOICE, special: { takes: ['dumbbell_throw'] } },
  clown: {
    attack: { takes: ['clown_laughing_1', 'clown_laughing_2', 'clown_horn', 'clown_burp'] },
    projectile: NONE,
    damage: NONE,
    special: NONE,
  },
  cow: SILENT_VOICE,
  dark_knight: {
    attack: { takes: ['hammer_strike'], standInFor: 'dark_knight_punch' },
    projectile: NONE,
    damage: NONE,
    special: NONE,
  },
  // Stand-ins until the Evil Clown's own audio is sourced: the horn is the
  // closest thing to the whoomph of a backhand this troupe already owns, and
  // the laugh that tells the party the vials are coming wants to be slower and
  // distorted.
  evil_clown: {
    attack: { takes: ['clown_horn'] },
    projectile: { takes: ['dumbbell_throw'] },
    damage: NONE,
    special: { takes: ['clown_laughing_1', 'clown_laughing_2'] },
  },
  fairy: SILENT_VOICE,
  // Only the archer among the goblins ever raises the projectile flag; the
  // melee archetypes have nothing to throw.
  goblin: {
    attack: { takes: ['goblin_1', 'goblin_2'] },
    projectile: ARROW_LOOSED,
    damage: NONE,
    special: NONE,
  },
  goblin_bombardier: SILENT_VOICE,
  goblin_dynamiter: SILENT_VOICE,
  grave_bull: SILENT_VOICE,
  grotesque_spider: SILENT_VOICE,
  hawkfolk: { ...SILENT_VOICE, attack: { takes: ['hawkfolk_1', 'hawkfolk_2'] } },
  krakaren: {
    attack: { takes: ['krakaren_ground_slam'] },
    projectile: NONE,
    damage: NONE,
    special: { takes: ['krakaren_yell'] },
  },
  krakaren_tentacle: SILENT_VOICE,
  krasue: { ...SILENT_VOICE, attack: { takes: ['krasue_attack'] } },
  lemur: {
    attack: { takes: ['lemur_attack'] },
    projectile: { takes: ['lemur_sound'] },
    damage: NONE,
    special: NONE,
  },
  // Its special flag is the full territorial roar, raised as it turns on the party.
  lion: {
    attack: { takes: ['lion_attack_roar_1', 'lion_attack_roar_2', 'lion_attack_roar_3'] },
    projectile: NONE,
    damage: { takes: ['lion_hurt_1', 'lion_hurt_2', 'lion_hurt_3', 'lion_hurt_4'] },
    special: { takes: ['lion_aggro_roar'] },
  },
  llama: { ...SILENT_VOICE, projectile: { takes: ['llama_fireball'] } },
  mantid: {
    attack: SLASH_STRIKES,
    projectile: NONE,
    damage: NONE,
    special: { takes: ['mantid_furious'] },
  },
  mantis: { ...SILENT_VOICE, attack: SLASH_STRIKES },
  // Raised on the frame the string is loosed.
  merc_archer: { ...SILENT_VOICE, attack: ARROW_LOOSED },
  merc_earth_elemental: {
    ...SILENT_VOICE,
    attack: { takes: ['rock_thud_1', 'rock_thud_2', 'rock_thud_3', 'rock_thud_4'] },
  },
  merc_medic: { ...SILENT_VOICE, attack: { takes: ['human_punch_weak'] } },
  // The same soul-fire as the Lich's bolts: the room's second half is meant to
  // sound like a continuation of its first.
  miss_quill: { ...SILENT_VOICE, projectile: SOUL_BOLT_LAUNCH },
  // The pounce lands on the claw cue: a dedicated pounce screech is unsourced,
  // and the pounce ends in a raking swipe anyway.
  deinonychus: {
    ...SILENT_VOICE,
    attack: (mob) =>
      mob instanceof Deinonychus && mob.lastAttack === 'bite'
        ? BITES
        : { takes: ['deinonychus_slash'] },
  },
  necromancer: SILENT_VOICE,
  raised_ratkin: SILENT_VOICE,
  rat: { ...SILENT_VOICE, attack: { takes: ['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3'] } },
  ratkin_soldier: {
    ...SILENT_VOICE,
    attack: {
      takes: ['ratkin_soldier_strike_1', 'ratkin_soldier_strike_2', 'ratkin_soldier_strike_3'],
    },
  },
  rock_golem: {
    // One cue for both the double-fist slam and the stomp.
    attack: { takes: ['massive_strike_with_dirt_impact'] },
    projectile: { takes: ['rock_golem_grunt'] },
    // The golem raises this flag for the dazed groan after a barrier
    // interrupts its roll, not for taking a hit.
    damage: { takes: ['rock_golem_frustrated'] },
    // The boulder grinding across the arena, versus the golem hauling itself
    // into and out of that shape.
    special: (mob) => ({
      takes: [
        mob instanceof RockGolemBoss && mob.lastSpecial === 'roll'
          ? 'rolling_earth_ball'
          : 'rock_golem_grunt',
      ],
    }),
  },
  skeleton: {
    attack: SLASH_STRIKES,
    projectile: ARROW_LOOSED,
    // Stand-in for a dry bone rattle, which is not yet sourced: snapping wood
    // is the nearest dry clatter the library has.
    damage: { takes: ['wood_breaking_1', 'wood_breaking_2'] },
    special: NONE,
  },
  skeleton_lord: {
    attack: NONE,
    projectile: SOUL_BOLT_LAUNCH,
    damage: { takes: ['wood_breaking_1', 'wood_breaking_2'] },
    special: undeadCasterSpecial,
  },
  // The lab's hatchlings and the small spiders share this pounce bite.
  small_spider: { ...SILENT_VOICE, attack: BITES },
  the_lich: {
    attack: NONE,
    projectile: SOUL_BOLT_LAUNCH,
    // Robes over a skeleton, so a hit is bones knocking together rather than
    // the skeletons' dry snap.
    damage: { takes: ['bones_rattling'] },
    special: undeadCasterSpecial,
  },
  trash_gremlin: { ...SILENT_VOICE, special: { takes: ['trash_gremlin_vomit'] } },
  troglodyte: { ...SILENT_VOICE, attack: { takes: ['troglodyte_tongue'] } },
  tuskling: {
    ...SILENT_VOICE,
    attack: {
      takes: ['tuskling_grunt_1', 'tuskling_grunt_2', 'tuskling_grunt_3', 'tuskling_grunt_4'],
    },
  },
};

/** The takes `mob` plays when it raises the flag for `moment`; empty when it has none. */
export function mobVoiceTakes(mob: Mob, moment: MobVoiceMoment): MobCueSlot['takes'] {
  const slot = MOB_VOICES[mob.audioTag][moment];
  return typeof slot === 'function' ? slot(mob).takes : slot.takes;
}
