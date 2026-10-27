/**
 * Angel's tempo: slower and sultrier than the dance floor's house beat.
 *
 * A beat is eight frames, so the slowest thing a routine does — a hip roll, a
 * step — spans enough frames to read as continuous, and the quickest — the
 * whip of a hair flip — still gets a few. A phrase is two beats, sixteen
 * frames, the loop length every routine is built from.
 */

const ANGEL_BEATS_PER_MINUTE = 96;
export const ANGEL_FRAMES_PER_BEAT = 8;
const ANGEL_BEATS_PER_PHRASE = 2;
export const ANGEL_PHRASE_FRAMES = ANGEL_FRAMES_PER_BEAT * ANGEL_BEATS_PER_PHRASE;
const SECONDS_PER_MINUTE = 60;
/** Frames a second her rows play at, so a beat lands on the tempo above. */
export const ANGEL_FRAMES_PER_SECOND =
  (ANGEL_BEATS_PER_MINUTE / SECONDS_PER_MINUTE) * ANGEL_FRAMES_PER_BEAT;
