import type { AudioManager } from '../audio/AudioManager';
import type { HirelingShotSystem } from './HirelingShotSystem';
import type { RockThrowSystem } from './RockThrowSystem';

/**
 * Plays and clears the sounds a hireling's shots left behind this frame: the
 * golem's boulder shattering, and an arrow striking.
 *
 * Drained from the projectile systems rather than from the mob's own audio
 * cues because a shot outlives the hireling that loosed it — one that lands
 * after its thrower fell has no mob left to carry the flag. Shared by every
 * scene a hireling fights in, so the same shot sounds the same indoors and out.
 */
export function playHirelingProjectileCues(
  rockThrows: RockThrowSystem,
  hirelingShots: HirelingShotSystem,
  audio: AudioManager | null,
): void {
  const throwers = rockThrows.landedThrowers;
  if (throwers.length > 0) {
    const heard = throwers.some((thrower) => audio?.hearsCreature(thrower) === true);
    throwers.length = 0;
    if (heard) audio?.playRandom(['rock_thud_1', 'rock_thud_2', 'rock_thud_3', 'rock_thud_4']);
  }
  if (hirelingShots.impactSoundPending) {
    hirelingShots.impactSoundPending = false;
    audio?.play('arrow_impact');
  }
}
