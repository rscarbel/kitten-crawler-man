import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { DamageSource } from '../Player';
import type { DeathCause } from '../ui/DeathExplanations';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';

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
};

function causeFromDamageSource(source: DamageSource): DeathCause {
  if (source.kind === 'dynamite') return 'explosiveFriendlyFire';
  if (source.kind === 'doomsday') return 'doomsdayExplosion';

  if (source.kind === 'status') {
    const { effectType } = source;
    if (effectType === 'burn' || effectType === 'magic_burn') return 'burnedStatus';
    if (effectType === 'poison') return 'poisonStatus';
    if (effectType === 'sepsis') return 'sepsisStatus';
    if (effectType === 'electrified') return 'electrifiedStatus';
    if (effectType === 'spit_venom') return 'spitVenomStatus';
    return 'unknown';
  }

  if (source.kind === 'mob') {
    const { mobType, attackType } = source;

    if (mobType === 'GrotesqueSpider') {
      if (attackType === 'screech') return 'grotesqueSpiderScreech';
      if (attackType === 'spit') return 'grotesqueSpiderSpit';
      return 'grotesqueSpiderSlam';
    }

    if (mobType === 'KrakarenClone') {
      if (attackType === 'slam') return 'krakarenCloneSlam';
      return 'krakarenCloneRegularMelee';
    }

    return MOB_TYPE_TO_CAUSE[mobType] ?? 'unknown';
  }

  return 'unknown';
}

/**
 * Inspect current game state at the moment of death and return the cause.
 * Mirrors the priority ordering of `checkDeath` in GameLoopPhases.
 */
export function resolveDeathCause(
  human: HumanPlayer,
  cat: CatPlayer,
  isSafeLevel: boolean,
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

  if (!isSafeLevel && levelTimerFrames <= 0) return 'levelTimerRanOut';

  return 'unknown';
}
