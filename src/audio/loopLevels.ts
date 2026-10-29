import type { SoundId } from './sounds';
import { MIN_STOP_FADE_MS } from './voiceFades';

/** A continuous loop a scene starts and stops by its own state, with the level it plays at. */
export interface LoopLevel {
  readonly id: SoundId;
  readonly volume: number;
  /** How long it takes to come in. Footsteps start with the step, not a beat after it. */
  readonly fadeInMs: number;
  /** How long it takes to stop. */
  readonly fadeOutMs: number;
}

/**
 * Fade applied when an ambient bed starts, stops or changes level: short
 * enough to track the player, long enough that a bed already at full gain on
 * entry doesn't click.
 */
export const AMBIENT_RAMP_MS = 100;

/** The rain's wind swells and dies over a second, so it reads as weather rather than a switch. */
const KETTLEBELL_RAIN_WIND_FADE_MS = 1000;

export const WALKING_LOOP = {
  id: 'player_walking',
  volume: 0.25,
  fadeInMs: MIN_STOP_FADE_MS,
  fadeOutMs: MIN_STOP_FADE_MS,
} as const satisfies LoopLevel;

/**
 * The wading loop has to beat the river bed, not merely the footsteps it
 * replaces, and that is a much higher bar: both are broadband water noise, so
 * they mask each other almost perfectly and a few dB of difference is
 * inaudible rather than quiet.
 *
 * Both play on their loudness trims, and at this gain the wading loop sits
 * about 3 dB under the river bed. Under rather than over — sitting above the
 * bed would read as the loop replacing the river rather than as a sound
 * distinguishable from it, since both are the same broadband water noise.
 *
 * Its stop is far shorter than {@link AMBIENT_RAMP_MS}: it tracks the
 * player's own footfalls, so it has to stop when they stop.
 */
export const WADING_LOOP = {
  id: 'player_wading',
  volume: 0.16,
  fadeInMs: MIN_STOP_FADE_MS,
  fadeOutMs: 40,
} as const satisfies LoopLevel;

export const SPIDER_WALKING_LOOP = {
  id: 'spider_walking',
  volume: 0.4,
  fadeInMs: MIN_STOP_FADE_MS,
  fadeOutMs: AMBIENT_RAMP_MS,
} as const satisfies LoopLevel;

/** The spider lab's machines, running from the hack's start until the power goes. */
export const MACHINERY_LOOP = {
  id: 'tech_machinery_running',
  volume: 0.35,
  fadeInMs: AMBIENT_RAMP_MS,
  fadeOutMs: AMBIENT_RAMP_MS,
} as const satisfies LoopLevel;

/** The wind of Big Rooster's kettlebell rain at its floor level: one bell in the air. */
export const KETTLEBELL_RAIN_WIND_LOOP = {
  id: 'kettlebell_rain_wind_loop',
  volume: 0.5,
  fadeInMs: KETTLEBELL_RAIN_WIND_FADE_MS,
  fadeOutMs: KETTLEBELL_RAIN_WIND_FADE_MS,
} as const satisfies LoopLevel;

/** The generator on the Current Goblin's back, heard from wherever he stands while he lives. */
export const GENERATOR_RIG_HUM_LOOP = {
  id: 'generator_rig_hum_loop',
  volume: 0.4,
  fadeInMs: AMBIENT_RAMP_MS,
  fadeOutMs: AMBIENT_RAMP_MS,
} as const satisfies LoopLevel;
