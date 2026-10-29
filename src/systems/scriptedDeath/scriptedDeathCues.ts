/**
 * The sound each scripted death plays as it starts, by what it means rather
 * than by file. A recording that lands is its registration in
 * `src/audio/sounds.ts` plus its slot here, and the slot stops compiling until
 * it is switched over.
 *
 * Every take must sit in a preload group of each floor a death can play on:
 * the shark's bite is in `level1`, the only floor with a shark, and the time
 * limit's splats are `universal`, since any timed floor can end in one.
 */

import type { CueSlot } from '../../audio/cueSlot';

/** The recordings the slots are waiting for. */
type WantedScriptedDeathSound = 'caroline_detonation_burst';

export const SCRIPTED_DEATH_CUES = {
  /**
   * A great white bursting out of the water and its jaws slamming shut. It
   * starts with the breach, with no offset: the recording's bite sits at
   * 0.4 s, on `SHARK_ATTACK_TAKEN_FRAME`.
   */
  sharkBreachBite: { takes: ['shark_breach_bite'] },
  /** Both crawlers bursting at once as Caroline ends them for running out of time. */
  timeLimitDetonationBurst: {
    takes: ['splat_1', 'splat_2', 'splat_3'],
    standInFor: 'caroline_detonation_burst',
  },
} as const satisfies Record<string, CueSlot<WantedScriptedDeathSound>>;
