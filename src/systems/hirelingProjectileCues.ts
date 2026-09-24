import type { AudioManager } from '../audio/AudioManager';
import type { HirelingBoltSystem } from './HirelingBoltSystem';
import type { RockThrowSystem } from './RockThrowSystem';

/**
 * Plays and clears the sounds a hireling's shots left behind this frame: the
 * golem's boulder shattering, and a water bolt striking or a wave rolling out.
 *
 * Drained from the projectile systems rather than from the mob's own audio
 * cues because a shot outlives the hireling that loosed it — one that lands
 * after its thrower fell has no mob left to carry the flag. Shared by every
 * scene a hireling fights in, so the same shot sounds the same indoors and out.
 */
export function playHirelingProjectileCues(
  rockThrows: RockThrowSystem,
  hirelingShots: HirelingBoltSystem,
  audio: AudioManager | null,
): void {
  if (rockThrows.burstSoundPending) {
    rockThrows.burstSoundPending = false;
    audio?.playRandom(['rock_thud_1', 'rock_thud_2', 'rock_thud_3', 'rock_thud_4']);
  }
  if (hirelingShots.impactSoundPending) {
    hirelingShots.impactSoundPending = false;
    audio?.play('arrow_impact');
  }
  if (hirelingShots.waveSoundPending) {
    hirelingShots.waveSoundPending = false;
    audio?.play('mob_splash');
  }
}
