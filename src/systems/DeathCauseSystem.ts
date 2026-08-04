import type { HumanPlayer } from '../creatures/HumanPlayer';
import { VIAL_ATTACK_TYPE } from '../creatures/EvilClown';
import { KNIGHT_MISSILE_ATTACK_TYPE } from '../creatures/DarkKnight';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { DamageSource } from '../Player';
import type { DeathCause } from '../ui/DeathExplanations';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';
import { MANTID_FLURRY_ATTACK_TYPE } from '../creatures/Mantid';
import { ROCK_THROW_ATTACK_TYPE, ROLL_ATTACK_TYPE } from '../creatures/rockGolemAttackTypes';
import { STENCH_ATTACK_TYPE, TRAMPLE_ATTACK_TYPE } from '../creatures/ballOfSwineAttackTypes';

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
  RockGolem: 'rockGolem',
  RockGolemBoss: 'rockGolem',
  RingmasterGrimaldi: 'ringmasterGrimaldi',
  MoldLion: 'moldLion',
  CityElfCultist: 'cityElfCultist',
  HeatherTheBear: 'heatherTheBear',
  MissQuill: 'missQuill',
};

function causeFromDamageSource(source: DamageSource): DeathCause {
  if (source.kind === 'dynamite') return 'explosiveFriendlyFire';
  if (source.kind === 'doomsday') return 'doomsdayExplosion';
  // Standing hazards. Without this the contact damage — which is what actually
  // kills, well before the eight-second `burn` DoT they also apply gets there —
  // reports an unknown cause on the death screen. An untagged source is a
  // burning tree, which was the only producer before lava flames existed.
  if (source.kind === 'environmental') {
    if (source.hazard === 'lavaFlames') return 'lavaFlames';
    if (source.hazard === 'clownGas') return 'clownGas';
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

  if (mobType === 'GrotesqueSpider') {
    if (attackType === 'screech') return 'grotesqueSpiderScreech';
    if (attackType === 'spit') return 'grotesqueSpiderSpit';
    return 'grotesqueSpiderSlam';
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

  // The cone is a red shape on the ground the player was given time to leave;
  // the bolts are not. Telling both deaths the same way loses the lesson.
  if (mobType === 'SkeletonLord' && attackType === 'grasping_hands') return 'skeletonLordHands';

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
  // closing — and it can be attributed to a hired bruiser as well as to a golem.
  if (attackType === ROCK_THROW_ATTACK_TYPE) return 'rockGolemRock';

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
