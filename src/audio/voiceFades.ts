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

/** One step {@link glideParam} laid on a param: an instant level, or a curve. */
type LaidGlide =
  | { readonly kind: 'set'; readonly atS: number; readonly level: number }
  | {
      readonly kind: 'curve';
      readonly atS: number;
      readonly durationS: number;
      readonly curve: Float32Array;
    };

/** What {@link glideParam} has laid on a param since its last present-time glide. */
interface LaidSchedule {
  /** The level the param stood at before the first glide. */
  readonly baseLevel: number;
  /** In clock order; each one ends where the next begins. */
  readonly glides: readonly LaidGlide[];
}

/**
 * The browser cannot be asked what a param will stand at in the future, so
 * the schedule each param was given is kept here to answer that.
 */
const laidSchedules = new WeakMap<AudioParam, LaidSchedule>();

/** A value curve's level a `progress` fraction of the way through, interpolated as the Web Audio API does. */
function curveLevelAt(curve: Float32Array, progress: number): number {
  const lastIndex = curve.length - 1;
  const position = Math.max(0, Math.min(lastIndex, progress * lastIndex));
  const index = Math.min(Math.floor(position), lastIndex - 1);
  const lower = curve[index] ?? 0;
  const upper = curve[index + 1] ?? lower;
  return lerp(lower, upper, position - index);
}

function laidLevelAt(schedule: LaidSchedule, atS: number): number {
  let level = schedule.baseLevel;
  for (const glide of schedule.glides) {
    if (glide.atS > atS) break;
    switch (glide.kind) {
      case 'set':
        level = glide.level;
        break;
      case 'curve': {
        const endS = glide.atS + glide.durationS;
        const lastLevel = glide.curve[glide.curve.length - 1] ?? level;
        level =
          atS < endS ? curveLevelAt(glide.curve, (atS - glide.atS) / glide.durationS) : lastLevel;
        break;
      }
      default: {
        const unhandled: never = glide;
        return unhandled;
      }
    }
  }
  return level;
}

/**
 * Moves `param` to `to` over `durationS` from `nowS`, replacing anything
 * already scheduled on it from then on. The fade begins at the level the
 * param stands at when it starts, so a fade interrupted mid-way carries on
 * from where it had got to rather than jumping back to where it began.
 *
 * `nowS` may lie ahead on the clock (a fade laid to meet another voice's
 * start), inside a curve laid earlier that has not finished. Clearing only
 * from `nowS` would leave that curve overlapping the new one, which the Web
 * Audio API refuses with a `NotSupportedError`, so the earlier curve is cut
 * at `nowS` instead, and the new fade starts from the level that curve
 * reaches there rather than the level it stands at now.
 */
export function glideParam(
  param: AudioParam,
  clock: AudioClock,
  nowS: number,
  to: number,
  durationS: number,
  shape: FadeShape,
): void {
  const prior = laidSchedules.get(param);
  const laidAheadOnAHeldSchedule = canHoldSchedule(param) && nowS > clock.currentTime;
  const earlierSchedule = laidAheadOnAHeldSchedule ? prior : undefined;
  const from = earlierSchedule === undefined ? param.value : laidLevelAt(earlierSchedule, nowS);
  clearScheduleFrom(param, nowS);
  const glide = layGlide(param, nowS, from, to, durationS, shape);
  const keptGlides = earlierSchedule?.glides.filter((earlier) => earlier.atS < nowS) ?? [];
  laidSchedules.set(param, {
    baseLevel: earlierSchedule?.baseLevel ?? from,
    glides: [...keptGlides, glide],
  });
}

function layGlide(
  param: AudioParam,
  atS: number,
  from: number,
  to: number,
  durationS: number,
  shape: FadeShape,
): LaidGlide {
  if (durationS <= 0 || from === to) {
    param.setValueAtTime(to, atS);
    return { kind: 'set', atS, level: to };
  }
  const curve = fadeCurve(shape, from, to);
  param.setValueCurveAtTime(curve, atS, durationS);
  return { kind: 'curve', atS, durationS, curve };
}

function canHoldSchedule(param: AudioParam): boolean {
  return Reflect.has(param, 'cancelAndHoldAtTime');
}

/**
 * Drops everything scheduled on `param` from `atS` on, cutting short a curve
 * still running at `atS`. A browser without `cancelAndHoldAtTime` cannot cut
 * a curve, so there the whole schedule goes and the level is set where it
 * stands, which is also where a fade laid ahead then starts.
 */
function clearScheduleFrom(param: AudioParam, atS: number): void {
  if (canHoldSchedule(param)) {
    param.cancelAndHoldAtTime(atS);
    return;
  }
  const level = param.value;
  param.cancelScheduledValues(0);
  param.setValueAtTime(level, 0);
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
  /**
   * When on the audio clock a decoded voice's fade begins, for a stop laid to
   * meet another voice's start. Default, and never earlier than: now.
   */
  readonly fromS?: number;
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
  const fadeFromS =
    voice.kind === 'buffer'
      ? Math.max(clock.currentTime, opts.fromS ?? clock.currentTime)
      : clock.currentTime;
  const endS = fadeFromS + rampMs / MS_PER_SECOND;
  glideParam(voice.gain.gain, clock, fadeFromS, 0, rampMs / MS_PER_SECOND, shape);
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
    if (fadeUnfinished) glideParam(gain.gain, clock, clock.currentTime, 0, 0, shape);
    el.pause();
    onStopped?.();
  }, rampMs + STREAM_PAUSE_SLACK_MS);
}
