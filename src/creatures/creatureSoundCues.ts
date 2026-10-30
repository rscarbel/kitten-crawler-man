/**
 * The moments a rooster of Big Rooster's flock makes a sound, by what happened
 * rather than by file; `src/audio/bossSoundCues.ts` says which takes each
 * build plays for each.
 */
export type RoosterSoundCue =
  | 'crow'
  | 'effort'
  | 'hurt'
  | 'notice'
  | 'peck'
  | 'swing'
  | 'clubImpact'
  | 'ruffle'
  | 'step'
  | 'kick';

/** The moments the Trash Gremlin makes a sound of its own, beside its vomit's retch. */
export type TrashGremlinSoundCue = 'hurt' | 'gurgle' | 'shriek' | 'cackle';

/** The moments the Current Goblin makes a sound of his own, by what happened. */
export type ElectricGoblinSoundCue =
  | 'grenadeBurst'
  | 'chargeWindup'
  | 'chargeSparks'
  | 'puddleCharged'
  | 'puddleArc'
  | 'swipe'
  | 'block'
  | 'slam'
  | 'laugh'
  | 'hurt';

/**
 * Sounds a creature asked for since the scene last looked, each at most once
 * a frame: two of the same cue raised together are one sound.
 */
export class SoundCueQueue<Cue extends string> {
  private readonly pending = new Set<Cue>();

  raise(cue: Cue): void {
    this.pending.add(cue);
  }

  /** The sounds asked for since the last call, emptied by the call. */
  take(): readonly Cue[] {
    if (this.pending.size === 0) return [];
    const cues = [...this.pending];
    this.pending.clear();
    return cues;
  }

  clear(): void {
    this.pending.clear();
  }
}
