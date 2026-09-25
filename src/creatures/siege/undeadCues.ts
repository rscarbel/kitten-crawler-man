/**
 * The sounds the assault's undead ask for. Each creature queues cues as they
 * happen and the scene's mob-audio pass drains them (`undeadAudioCues.ts`),
 * so a groan and a death on the same frame both play, which one shared
 * pending flag could not carry.
 */

import type { SoundId } from '../../audio/sounds';

/** One sound to play, at an optional playback rate (below 1 lowers the pitch). */
export interface UndeadCue {
  readonly id: SoundId;
  readonly playbackRate?: number;
}

/** A queue of cues a creature fills and the audio pass empties. */
export class UndeadCueQueue {
  private cues: UndeadCue[] = [];

  push(cue: UndeadCue): void {
    this.cues.push(cue);
  }

  /** Every queued cue, oldest first, leaving the queue empty. */
  drain(): readonly UndeadCue[] {
    if (this.cues.length === 0) return NO_CUES;
    const drained = this.cues;
    this.cues = [];
    return drained;
  }

  clear(): void {
    this.cues = [];
  }
}

const NO_CUES: readonly UndeadCue[] = [];
