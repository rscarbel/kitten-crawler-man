/**
 * Gain shapes and the one way a voice stops.
 *
 * Every voice owns a gain node, so any voice can be faded, and every stop
 * ramps that gain to silence before the source is stopped or the element
 * paused: cutting a waveform mid-cycle clicks.
 */

export const MS_PER_SECOND = 1000;

/** The shortest stop ever allowed: long enough to hide the cut, short enough to read as instant. */
export const MIN_STOP_FADE_MS = 10;

/**
 * How much later than its audio-clock fade a media element is paused. The
 * pause runs on a wall-clock timer, which must never beat the fade it waits on.
 */
export const STREAM_PAUSE_SLACK_MS = 20;

/** Samples in a scheduled fade curve; the param interpolates linearly between them. */
const FADE_CURVE_POINTS = 64;

/** Where a fade in dB starts or ends when one side is silence; inaudible under any mix. */
const DB_FADE_FLOOR = -60;

/** Decibels are tenths of a power of ten; amplitude gain spans 20 dB per decade. */
const DECIBEL_BASE = 10;
const DB_PER_GAIN_DECADE = 20;

const HALF_PI = Math.PI / 2;

/**
 * How a gain moves between two levels.
 *
 * - `db` — linear in decibels, which the ear hears as an even fade.
 * - `equalPowerIn` / `equalPowerOut` — the two halves of a crossfade: their
 *   squares sum to one, so the overlap keeps a constant loudness.
 * - `linear` — a plain line, for short level changes (a slider, a duck).
 */
export type FadeShape = 'db' | 'equalPowerIn' | 'equalPowerOut' | 'linear';

export function dbToGain(db: number): number {
  return Math.pow(DECIBEL_BASE, db / DB_PER_GAIN_DECADE);
}

export function gainToDb(gain: number): number {
  return DB_PER_GAIN_DECADE * Math.log10(gain);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** A fade curve from `from` to `to`; its first and last points are exactly the two levels. */
export function fadeCurve(shape: FadeShape, from: number, to: number): Float32Array {
  const curve = new Float32Array(FADE_CURVE_POINTS);
  const lastIndex = FADE_CURVE_POINTS - 1;
  const floorGain = dbToGain(DB_FADE_FLOOR);
  const fromDb = gainToDb(Math.max(from, floorGain));
  const toDb = gainToDb(Math.max(to, floorGain));
  for (let i = 0; i <= lastIndex; i++) {
    const t = i / lastIndex;
    switch (shape) {
      case 'db':
        curve[i] = dbToGain(lerp(fromDb, toDb, t));
        break;
      case 'equalPowerIn':
        curve[i] = lerp(from, to, Math.sin(t * HALF_PI));
        break;
      case 'equalPowerOut':
        curve[i] = lerp(to, from, Math.cos(t * HALF_PI));
        break;
      case 'linear':
        curve[i] = lerp(from, to, t);
        break;
    }
  }
  curve[0] = from;
  curve[lastIndex] = to;
  return curve;
}

/**
 * Moves `param` from wherever it is now to `to` over `durationS`, replacing
 * anything already scheduled on it. The current level is read before the
 * schedule is cleared, so a fade interrupted mid-way carries on from where it
 * had got to rather than jumping back to where it began.
 */
export function glideParam(
  param: AudioParam,
  nowS: number,
  to: number,
  durationS: number,
  shape: FadeShape,
): void {
  const from = param.value;
  param.cancelScheduledValues(nowS);
  if (durationS <= 0 || from === to) {
    param.setValueAtTime(to, nowS);
    return;
  }
  param.setValueCurveAtTime(fadeCurve(shape, from, to), nowS, durationS);
}

/** A playing decoded sound, with the gain node only it feeds. */
export interface BufferVoice {
  readonly kind: 'buffer';
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

/** A playing streamed sound: a media element wired, through its own gain node, into a bus. */
export interface StreamVoice {
  readonly kind: 'stream';
  readonly el: HTMLAudioElement;
  readonly gain: GainNode;
}

export type Voice = BufferVoice | StreamVoice;

/** What {@link stopVoice} needs of the audio context: its clock. */
export interface AudioClock {
  readonly currentTime: number;
}

/** Options for {@link stopVoice}. */
export interface StopVoiceOptions {
  /** Runs once the voice is silent and released. */
  readonly onStopped?: () => void;
  /** The fade's curve. Default `db`. */
  readonly shape?: FadeShape;
  /**
   * Asked before a streamed voice's element is paused. A reused element may
   * have been handed a newer sound during the fade, which a pause would cut.
   */
  readonly stillOwnsElement?: () => boolean;
}

/**
 * Stops `voice` the only way any voice stops: its gain ramps to silence over
 * at least {@link MIN_STOP_FADE_MS}, and only then is the source stopped or
 * the element paused.
 */
export function stopVoice(
  clock: AudioClock,
  voice: Voice,
  fadeMs: number,
  opts: StopVoiceOptions = {},
): void {
  const { onStopped, shape = 'db', stillOwnsElement } = opts;
  const rampMs = Math.max(MIN_STOP_FADE_MS, fadeMs);
  const now = clock.currentTime;
  const endS = now + rampMs / MS_PER_SECOND;
  glideParam(voice.gain.gain, now, 0, rampMs / MS_PER_SECOND, shape);
  if (voice.kind === 'buffer') {
    const { source, gain } = voice;
    source.onended = () => {
      gain.disconnect();
      onStopped?.();
    };
    try {
      source.stop(endS);
    } catch {
      // A source that already ended cannot be stopped again; it is already silent.
      gain.disconnect();
      onStopped?.();
    }
    return;
  }
  const { el, gain } = voice;
  el.onended = null;
  window.setTimeout(() => {
    if (stillOwnsElement !== undefined && !stillOwnsElement()) return;
    // A suspended context's clock stands still, so a fade scheduled on it
    // may not have run when the wall-clock timer fires; nothing is rendered
    // while it stands still, so the gain can drop the rest of the way at once.
    const fadeUnfinished = clock.currentTime < endS;
    if (fadeUnfinished) glideParam(gain.gain, clock.currentTime, 0, 0, shape);
    el.pause();
    onStopped?.();
  }, rampMs + STREAM_PAUSE_SLACK_MS);
}
