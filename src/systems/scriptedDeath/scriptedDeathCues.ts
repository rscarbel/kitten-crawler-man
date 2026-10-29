/**
 * The sound each scripted death plays as it starts, by what it means rather
 * than by file. A recording that lands is its registration in
 * `src/audio/sounds.ts` plus its slot here, and the slot stops compiling until
 * it is switched over.
 *
 * Every take must sit in a preload group of each floor a death can play on:
 * the shark's bite is in `level1`, the only floor with a shark.
 */

import type { CueSlot } from '../../audio/cueSlot';

/** The recordings the slots are waiting for; none, while every death has its own. */
type WantedScriptedDeathSound = never;

export const SCRIPTED_DEATH_CUES = {
  /**
   * A great white bursting out of the water and its jaws slamming shut. It
   * starts with the breach, with no offset: the recording's bite sits at
   * 0.4 s, on `SHARK_ATTACK_TAKEN_FRAME`.
   */
  sharkBreachBite: { takes: ['shark_breach_bite'] },
} as const satisfies Record<string, CueSlot<WantedScriptedDeathSound>>;
