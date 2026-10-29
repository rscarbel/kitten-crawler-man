import type { HumanPlayer } from '../creatures/HumanPlayer';
import { VIAL_ATTACK_TYPE } from '../creatures/EvilClown';
import { KNIGHT_MISSILE_ATTACK_TYPE } from '../creatures/DarkKnight';
import {
  CLUB_ATTACK_TYPE,
  EXERCISE_BALL_ATTACK_TYPE,
  KETTLEBELL_ATTACK_TYPE,
  PLATE_ROLL_ATTACK_TYPE,
  SLAM_ATTACK_TYPE,
} from '../creatures/BigRooster';
import { ROOSTER_PECK_ATTACK_TYPE, ROOSTER_PUNCH_ATTACK_TYPE } from '../creatures/roosterStrikes';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { DamageSource } from '../Player';
import { FROZEN_STATUS } from '../core/combat/StatusEffect';
import type { DeathCause } from '../ui/DeathExplanations';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';
import { MANTID_FLURRY_ATTACK_TYPE } from '../creatures/Mantid';
import { ROCK_THROW_ATTACK_TYPE, ROLL_ATTACK_TYPE } from '../creatures/rockGolemAttackTypes';
import { ICE_BOLT_ATTACK_TYPE } from '../creatures/fairies/IceFairy';
import {
  FIREBALL_ATTACK_TYPE,
  FIREBALL_BLAST_ATTACK_TYPE,
  DEATH_FLAME_ATTACK_TYPE,
  DEATH_EXPLOSION_ATTACK_TYPE,
} from './FairyFireballSystem';
import { NECRO_PULSE_ATTACK_TYPE } from '../creatures/Necromancer';
import { BLACK_POWDER_ATTACK_TYPE, GOBLIN_DYNAMITE_ATTACK_TYPE } from './goblinBombConstants';
import { SCRIPTED_DEATHS } from './scriptedDeath/scriptedDeaths';
import {
  CHARGED_PUDDLE_ATTACK_TYPE,
  ElectricGoblin,
  ROD_SWIPE_ATTACK_TYPE,
  SHOCK_GRENADE_ATTACK_TYPE,
  SLAM_WAVE_ATTACK_TYPE,
} from '../creatures/ElectricGoblin';

/**
 * Maps a mob's class name (and optional attackType) to a DeathCause key.
 * Entries not listed here fall back to 'unknown'.
 */
const MOB_TYPE_TO_CAUSE: Partial<Record<string, DeathCause>> = {
  Goblin: 'goblin',
  TutorialGoblin: 'goblin',
  Cockroach: 'cockroach',
  TrashGremlin: 'trashGremlin',
  BigRooster: 'bigRooster',
  LittleRooster: 'roosterPeck',
  SlightlyBentRooster: 'roosterPunch',
  Tuskling: 'tuskling',
  Troglodyte: 'troglodyte',
  SmallSpider: 'smallSpider',
  SpiderHatchling: 'spiderHatchling',
  Hawkfolk: 'hawkfolk',
  Llama: 'llama',
  Rat: 'rat',
  Bugaboo: 'bugaboo',
  BrindleGrub: 'brindleGrub',
  CowTailedGrub: 'cowTailedGrub',
  BrindledVespa: 'brindledVespa',
  RuinsGhoul: 'ruinsGhoul',
  Krasue: 'krasue',
  Lemur: 'lemur',
  TallClown: 'tallClown',
  FatClown: 'fatClown',
  MassiveClown: 'massiveClown',
  EvilClown: 'evilClown',
  Mantid: 'mantid',
  MantisCrony: 'mantis',
  DarkKnight: 'darkKnight',
  SkeletonLord: 'skeletonLord',
  RaisedRatkin: 'raisedRatkin',
  GraveBull: 'graveBull',
  Necromancer: 'necromancerBolt',
  SkeletonWarrior: 'skeletonWarrior',
  SkeletonArcher: 'skeletonArcher',
  TheLich: 'theLich',
  RockGolem: 'rockGolem',
  RockGolemBoss: 'rockGolem',
  Lion: 'lion',
  CityElfCultist: 'cityElfCultist',
  DireBear: 'direBear',
  MissQuill: 'missQuill',
  ShieldFairy: 'shieldFairy',
  HealingFairy: 'healingFairy',
  NecroFairy: 'necroFairy',
};

/**
 * The bespoke death this blow was. Exported because an interior raises its own
 * death screen: `resolveDeathCause` reads a *floor's* state — its collapse
 * timer, its revive deadline — and a building has neither, so a room that wants
 * one specific hazard to speak for itself asks about the blow directly.
 */
export function causeFromDamageSource(source: DamageSource): DeathCause {
  if (source.kind === 'dynamite') return 'explosiveFriendlyFire';
  if (source.kind === 'doomsday') return 'doomsdayExplosion';
  if (source.kind === 'siege') return 'siegeFriendlyFire';
  if (source.kind === 'scripted') return SCRIPTED_DEATHS[source.death].cause;
  // A wheel penalty stops at 1 HP, so it is never the blow that killed.
  if (source.kind === 'wheelPenalty') return 'unknown';
  // Standing hazards. Without this the contact damage — which is what actually
  // kills, well before the eight-second `burn` DoT they also apply gets there —
  // reports an unknown cause on the death screen. An untagged source is a
  // burning tree, which was the only producer before lava flames existed.
  if (source.kind === 'environmental') {
    if (source.hazard === 'lavaFlames') return 'lavaFlames';
    if (source.hazard === 'burningOil') return 'burningOil';
    if (source.hazard === 'clownGas') return 'clownGas';
    if (source.hazard === 'lichFirewall') return 'lichFirewall';
    if (source.hazard === 'lichOrb') return 'lichOrb';
    if (source.hazard === 'trashAvalanche') return 'trashAvalanche';
    return 'burningTree';
  }

  if (source.kind === 'status') {
    const { effectType } = source;
    if (effectType === 'burn' || effectType === 'magic_burn') return 'burnedStatus';
    if (effectType === 'poison') return 'poisonStatus';
    if (effectType === 'electrified') {
      // His grenades are the one source of the status in his room, and the
      // lesson is the ring they land in, not the status in general.
      return source.applier instanceof ElectricGoblin
        ? 'electricGoblinElectrified'
        : 'electrifiedStatus';
    }
    if (effectType === 'spit_venom') return 'spitVenomStatus';
    return 'unknown';
  }

  // Every other variant is handled above, so this is a mob — narrowed by
  // elimination rather than by a `kind` test, which the compiler can now prove
  // is always true.
  const { mobType, attackType } = source;

  // Each of her attacks has its own tell to teach, so a blow nobody named is
  // reported as unknown rather than dressed up as one of them.
  if (mobType === 'GrotesqueSpider') {
    if (attackType === 'slam') return 'grotesqueSpiderSlam';
    if (attackType === 'screech') return 'grotesqueSpiderScreech';
    if (attackType === 'spit') return 'grotesqueSpiderSpit';
    return 'unknown';
  }

  // The glass and the backhand are the same mob but not the same death, and the
  // melee lines would tell a player they were beaten to death by a bottle.
  if (mobType === 'EvilClown' && attackType === VIAL_ATTACK_TYPE) return 'evilClownVial';

  // Fifteen ticks of a three-second blender is not the same death as one strike.
  if (mobType === 'Mantid' && attackType === MANTID_FLURRY_ATTACK_TYPE) return 'mantidFlurry';

  // Four different deaths from one boss: the two telegraphed ground attacks read
  // as "you ignored a red circle", the gauntlet as "you stood too close", and the
  // bolt as "distance was not the answer you thought it was".
  if (mobType === 'DarkKnight') {
    if (attackType === 'slam') return 'darkKnightSlam';
    if (attackType === 'sweep') return 'darkKnightSweep';
    if (attackType === KNIGHT_MISSILE_ATTACK_TYPE) return 'darkKnightBolt';
    return 'darkKnight';
  }

  // The thrown dumbbell is dodged at range; the slam and the club are dodged by
  // reading a telegraph on the floor up close. Telling the deaths the same way
  // loses the lesson each telegraph is meant to teach.
  if (mobType === 'BigRooster' && attackType === SLAM_ATTACK_TYPE) return 'bigRoosterSlam';
  if (mobType === 'BigRooster' && attackType === CLUB_ATTACK_TYPE) return 'bigRoosterClub';
  if (mobType === 'BigRooster' && attackType === PLATE_ROLL_ATTACK_TYPE)
    return 'bigRoosterPlateRoll';
  if (mobType === 'BigRooster' && attackType === KETTLEBELL_ATTACK_TYPE)
    return 'bigRoosterKettlebell';
  if (mobType === 'BigRooster' && attackType === EXERCISE_BALL_ATTACK_TYPE)
    return 'bigRoosterExerciseBall';
  // Every rooster pecks and punches through the same strikes, so the blow names the death.
  if (attackType === ROOSTER_PECK_ATTACK_TYPE) return 'roosterPeck';
  if (attackType === ROOSTER_PUNCH_ATTACK_TYPE) return 'roosterPunch';

  // The cone is a red shape on the ground the player was given time to leave;
  // the bolts are not. Telling both deaths the same way loses the lesson.
  if (mobType === 'SkeletonLord' && attackType === 'grasping_hands') return 'skeletonLordHands';
  if (mobType === 'Necromancer' && attackType === NECRO_PULSE_ATTACK_TYPE)
    return 'necromancerPulse';
  // Same distinction for the Lich: the cone was drawn on the floor and the bolt
  // was not, and one death is a lesson while the other is a fight.
  if (mobType === 'TheLich' && attackType === 'grasping_hands') return 'theLichHands';

  // Rolling and standing are two different fights against the same golem, and
  // the roll is the one with a counterplay worth naming.
  if ((mobType === 'RockGolemBoss' || mobType === 'RockGolem') && attackType === ROLL_ATTACK_TYPE) {
    return 'rockGolemRoll';
  }
  // The thrown boulder is a third fight again — one you dodge by moving, not by
  // closing — and it can be attributed to a hired golem as well as to a wild one.
  if (attackType === ROCK_THROW_ATTACK_TYPE) return 'rockGolemRock';

  // The fairy is absent from `MOB_TYPE_TO_CAUSE`, so a bolt kill needs this
  // line to be named at all. Only a crawler killed while still unfrozen gets
  // here: `resolveDeathCause` calls any death inside the ice `frozenSolid`
  // before it asks what landed the blow.
  if (mobType === 'IceFairy' && attackType === ICE_BOLT_ATTACK_TYPE) return 'iceFairyBolt';

  // Four different fires from one fairy: the direct hit is dodged by moving
  // off the landing mark during the flight, the ground charge by leaving before the fuse ends, and
  // the two death effects punish lingering by her corpse instead of retreating.
  if (mobType === 'FireFairy') {
    if (attackType === FIREBALL_ATTACK_TYPE) return 'fireFairyFireball';
    if (attackType === FIREBALL_BLAST_ATTACK_TYPE) return 'fireFairyBlast';
    if (attackType === DEATH_FLAME_ATTACK_TYPE) return 'fireFairyDeathFlame';
    if (attackType === DEATH_EXPLOSION_ATTACK_TYPE) return 'fireFairyDeathExplosion';
  }

  if (attackType === GOBLIN_DYNAMITE_ATTACK_TYPE) return 'goblinDynamite';
  if (attackType === BLACK_POWDER_ATTACK_TYPE) return 'goblinBlackPowder';

  // Four telegraphs, four lessons: a ring to step out of, a puddle to leave,
  // a lane to step aside from, and a man not to stand next to.
  if (mobType === 'ElectricGoblin') {
    if (attackType === SHOCK_GRENADE_ATTACK_TYPE) return 'electricGoblinGrenade';
    if (attackType === CHARGED_PUDDLE_ATTACK_TYPE) return 'electricGoblinPuddle';
    if (attackType === ROD_SWIPE_ATTACK_TYPE) return 'electricGoblinSwipe';
    if (attackType === SLAM_WAVE_ATTACK_TYPE) return 'electricGoblinWave';
    return 'unknown';
  }

  if (mobType === 'KrakenTentacle') return 'krakenTentacleStrike';

  if (mobType === 'Kraken') {
    if (attackType === 'slam') return 'krakenSlam';
    return 'krakenRegularMelee';
  }

  return MOB_TYPE_TO_CAUSE[mobType] ?? 'unknown';
}

/**
 * Inspect current game state at the moment of death and return the cause.
 * Mirrors the priority ordering of `checkDeath` in GameLoopPhases.
 */
export function resolveDeathCause(
  human: HumanPlayer,
  cat: CatPlayer,
  hasCollapseTimer: boolean,
  levelTimerFrames: number,
): DeathCause {
  // Direct kill: an active player's HP dropped to 0 — check this first so a
  // simultaneous knockout-timeout does not shadow the real killing blow.
  const deadPlayer =
    human.isActive && !human.isAlive ? human : cat.isActive && !cat.isAlive ? cat : null;

  if (deadPlayer !== null && deadPlayer.lastDamageSource !== null) {
    // Encased and unable to act, whatever landed the blow — the lesson is the
    // ice, not the thing that walked up to a target that could not move.
    if (deadPlayer.hasStatus(FROZEN_STATUS)) return 'frozenSolid';
    return causeFromDamageSource(deadPlayer.lastDamageSource);
  }

  // Companion was not revived before the 90-second timer expired.
  if (
    (human.isKnockedOut && human.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) ||
    (cat.isKnockedOut && cat.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES)
  ) {
    return 'failureToRevive';
  }

  if (hasCollapseTimer && levelTimerFrames <= 0) return 'levelTimerRanOut';

  return 'unknown';
}
