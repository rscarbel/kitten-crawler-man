import type { AudioManager } from '../audio/AudioManager';
import type { CueSlot } from '../audio/cueSlot';
import type { HirelingShotKind, HirelingShotSystem } from './HirelingShotSystem';
import type { RockThrowSystem } from './RockThrowSystem';

/** The recordings a shot's landing stands in for until they are sourced. */
type WantedShotSound = 'earth_blast_impact';

/** What each kind of shot sounds like where it strikes a body or a wall. */
const SHOT_IMPACT_CUES: Readonly<Record<HirelingShotKind, CueSlot<WantedShotSound>>> = {
  arrow: { takes: ['arrow_impact'] },
  earth_blast: { takes: ['rock_breaking_1', 'rock_breaking_2'], standInFor: 'earth_blast_impact' },
};

/**
 * Plays and clears the sounds a hireling's shots left behind this frame: the
 * golem's boulder shattering, and an arrow or an earth blast striking.
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
  for (const kind of hirelingShots.landedKinds) {
    const { takes } = SHOT_IMPACT_CUES[kind];
    if (takes.length > 0) audio?.playRandom(takes);
  }
  hirelingShots.landedKinds.clear();
}
