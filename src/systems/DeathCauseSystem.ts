import type { HumanPlayer } from '../creatures/HumanPlayer';
import { VIAL_ATTACK_TYPE } from '../creatures/EvilClown';
import { KNIGHT_MISSILE_ATTACK_TYPE } from '../creatures/DarkKnight';
import { GROUND_PUNCH_ATTACK_TYPE, PLATE_ROLL_ATTACK_TYPE } from '../creatures/Juicer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { DamageSource } from '../Player';
import { FROZEN_STATUS } from '../core/StatusEffect';
import type { DeathCause } from '../ui/DeathExplanations';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';
import { MANTID_FLURRY_ATTACK_TYPE } from '../creatures/Mantid';
import { ROCK_THROW_ATTACK_TYPE, ROLL_ATTACK_TYPE } from '../creatures/rockGolemAttackTypes';
import { STENCH_ATTACK_TYPE, TRAMPLE_ATTACK_TYPE } from '../creatures/ballOfSwineAttackTypes';
import { ICE_BOLT_ATTACK_TYPE } from '../creatures/fairies/IceFairy';
import {
  FIREBALL_ATTACK_TYPE,
  FIREBALL_BLAST_ATTACK_TYPE,
  DEATH_FLAME_ATTACK_TYPE,
  DEATH_EXPLOSION_ATTACK_TYPE,
} from './FairyFireballSystem';

/**
 * Maps a mob's class name (and optional attackType) to a DeathCause key.
 * Entries not listed here fall back to 'unknown'.
 */
const MOB_TYPE_TO_CAUSE: Partial<Record<string, DeathCause>> = {
  Goblin: 'goblin',
  TutorialGoblin: 'goblin',
  Cockroach: 'cockroach',
  TheHoarder: 'hoarder',
  Juicer: 'juicer',
  BallOfSwine: 'ballOfSwine',
  Tuskling: 'tuskling',
  Troglodyte: 'troglodyte',
  SmallSpider: 'smallSpider',
  SpiderHatchling: 'spiderHatchling',
  SkyFowl: 'skyFowl',
  Llama: 'llama',
  Rat: 'rat',
  Bugaboo: 'bugaboo',
  BrindleGrub: 'brindleGrub',
  CowTailedGrub: 'cowTailedGrub',
  BrindledVespa: 'brindledVespa',
  RuinsGhoul: 'ruinsGhoul',
  Krasue: 'krasue',
  CircusLemur: 'circusLemur',
  StiltClown: 'stiltClown',
  FatClown: 'fatClown',
  TerrorTheClown: 'terrorTheClown',
  EvilClown: 'evilClown',
  Mantid: 'mantid',
  MantisCrony: 'mantis',
  DarkKnight: 'darkKnight',
  SkeletonLord: 'skeletonLord',
  SkeletonWarrior: 'skeletonWarrior',
  SkeletonArcher: 'skeletonArcher',
  TheLich: 'theLich',
  RockGolem: 'rockGolem',
  RockGolemBoss: 'rockGolem',
  MoldLion: 'moldLion',
  CityElfCultist: 'cityElfCultist',
  HeatherTheBear: 'heatherTheBear',
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
  // Standing hazards. Without this the contact damage — which is what actually
  // kills, well before the eight-second `burn` DoT they also apply gets there —
  // reports an unknown cause on the death screen. An untagged source is a
  // burning tree, which was the only producer before lava flames existed.
  if (source.kind === 'environmental') {
    if (source.hazard === 'lavaFlames') return 'lavaFlames';
    if (source.hazard === 'clownGas') return 'clownGas';
    if (source.hazard === 'lichFirewall') return 'lichFirewall';
    if (source.hazard === 'lichOrb') return 'lichOrb';
    if (source.hazard === 'hoarderAvalanche') return 'hoarderAvalanche';
    if (source.hazard === 'krakarenLiveWire') return 'krakarenLiveWire';
    if (source.hazard === 'krakarenTankBurst') return 'krakarenTankBurst';
    return 'burningTree';
  }

  if (source.kind === 'status') {
    const { effectType } = source;
    if (effectType === 'burn' || effectType === 'magic_burn') return 'burnedStatus';
    if (effectType === 'poison') return 'poisonStatus';
    if (effectType === 'sepsis') return 'sepsisStatus';
    if (effectType === 'electrified') return 'electrifiedStatus';
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

  // The thrown dumbbell is dodged at range; the ground punch is dodged by
  // reading a telegraphed circle up close. Telling both deaths the same way
  // loses the lesson the punch is meant to teach.
  if (mobType === 'Juicer' && attackType === GROUND_PUNCH_ATTACK_TYPE) return 'juicerPunch';
  if (mobType === 'Juicer' && attackType === PLATE_ROLL_ATTACK_TYPE) return 'juicerPlateRoll';

  // The cone is a red shape on the ground the player was given time to leave;
  // the bolts are not. Telling both deaths the same way loses the lesson.
  if (mobType === 'SkeletonLord' && attackType === 'grasping_hands') return 'skeletonLordHands';
  // Same distinction for the Lich: the cone was drawn on the floor and the bolt
  // was not, and one death is a lesson while the other is a fight.
  if (mobType === 'TheLich' && attackType === 'grasping_hands') return 'theLichHands';

  // Being run over and being gassed teach opposite lessons — one is "you were in its
  // line", the other "you were standing where it was about to hit" — and the trample
  // lines would tell a player at the far wall that they had been flattened.
  if (mobType === 'BallOfSwine') {
    if (attackType === STENCH_ATTACK_TYPE) return 'ballOfSwineStench';
    if (attackType === TRAMPLE_ATTACK_TYPE) return 'ballOfSwine';
  }

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

  if (mobType === 'KrakarenTentacle') return 'krakarenTentacleStrike';

  if (mobType === 'KrakarenClone') {
    if (attackType === 'slam') return 'krakarenCloneSlam';
    return 'krakarenCloneRegularMelee';
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
