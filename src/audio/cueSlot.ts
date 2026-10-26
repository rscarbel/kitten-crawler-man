/**
 * One sound a feature makes, for a cue whose own recording may not exist yet.
 *
 * A file is never registered before it exists (see the `add-sound` skill), so
 * a slot waiting on one plays registered stand-in takes and names the
 * recording it waits for in `standInFor`. That name is checked against the
 * registry: once `<name>` or `<name>_1` is a {@link SoundId}, the slot no
 * longer compiles until its `takes` are switched to the new recording and its
 * `standInFor` is dropped. Registering the file is what forces the switch.
 */

import type { SoundId } from './sounds';

/**
 * `Name` while nothing is registered under it, as a single file or as the
 * first take of a numbered set; never once something is.
 */
export type UnrecordedSoundName<Name extends string> = Name extends SoundId
  ? never
  : `${Name}_1` extends SoundId
    ? never
    : Name;

/** The takes a cue plays, one at random per play; empty stays silent. */
export interface CueSlot<Wanted extends string> {
  readonly takes: readonly SoundId[];
  /** The recording `takes` stand in for, while it is still unrecorded. */
  readonly standInFor?: UnrecordedSoundName<Wanted>;
}
