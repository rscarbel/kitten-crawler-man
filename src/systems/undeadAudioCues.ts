/**
 * Plays what the village assault's undead have queued: the raised ratkin's
 * groans and collapse, the Grave Bull's bellow and charge, and the
 * necromancer's casts and death.
 *
 * The ids are preloaded with the village (`briarHollow` in `sfxGroups.ts`), so
 * none of them depends on which other floor-3 groups happen to be loaded.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { Mob } from '../creatures/Mob';
import { RaisedRatkin } from '../creatures/RaisedRatkin';
import { GraveBull } from '../creatures/GraveBull';
import { Necromancer } from '../creatures/Necromancer';

/** Drains and plays one mob's queued undead cues, if it is one of the assault's undead. */
export function playUndeadCues(mob: Mob, audio: AudioManager | null): void {
  if (!(mob instanceof RaisedRatkin || mob instanceof GraveBull || mob instanceof Necromancer)) {
    return;
  }
  for (const cue of mob.cues.drain()) {
    audio?.play(cue.id, cue.playbackRate === undefined ? {} : { playbackRate: cue.playbackRate });
  }
}
