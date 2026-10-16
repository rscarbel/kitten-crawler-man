/**
 * When each of the siege victory's fireworks goes up and bursts, as a pure
 * function of the fanfare's age. The siege plays their sounds and the
 * celebration surface draws them from this one schedule, so a whistle and the
 * rocket it belongs to always leave together.
 */

import { UPDATES_PER_SECOND } from './structureRules';

/**
 * How long the victory fanfare holds the stage: the 12.0 s victory sting
 * (`briar_hollow_victory`) plus a short tail, so the village's music returns
 * only once the sting has rung out. Re-time it with the sting.
 */
export const VICTORY_FANFARE_SECONDS = 12.5;
export const VICTORY_FANFARE_FRAMES = Math.round(VICTORY_FANFARE_SECONDS * UPDATES_PER_SECOND);

const ROCKET_INTERVAL_SECONDS = 0.35;
/** Rockets keep going up this long; the finale volley lands inside it. */
const ROCKET_PHASE_SECONDS = 8;
const FINALE_SECONDS = 6.5;
const FINALE_ROCKETS = 6;
/** The finale's rockets leave a beat apart rather than all on one frame. */
const FINALE_STAGGER_SECONDS = 0.08;
/** How long a rocket climbs before it bursts. */
const ROCKET_RISE_SECONDS = 0.9;
/** Rockets go up across the middle of the screen, never hard against an edge. */
const LAUNCH_SPAN_START = 0.1;
const LAUNCH_SPAN = 0.8;
/** Where on the screen, from the top, a burst may sit. */
const APEX_START = 0.12;
const APEX_SPAN = 0.28;
/** Irrational steps spread the rockets out evenly without a random stream. */
const LAUNCH_STEP = 0.618034;
const APEX_STEP = 0.414214;

/** One rocket of the victory fireworks. */
export interface FireworkRocket {
  /** Its place in the launch order, from 0. */
  readonly index: number;
  readonly launchFrame: number;
  readonly burstFrame: number;
  /** Across the screen where it goes up and bursts: 0 the left edge, 1 the right. */
  readonly xShare: number;
  /** Down the screen where it bursts: 0 the top edge, 1 the bottom. */
  readonly apexShare: number;
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

function rocketAt(index: number, launchSeconds: number): FireworkRocket {
  const launchFrame = Math.round(launchSeconds * UPDATES_PER_SECOND);
  return {
    index,
    launchFrame,
    burstFrame: launchFrame + Math.round(ROCKET_RISE_SECONDS * UPDATES_PER_SECOND),
    xShare: LAUNCH_SPAN_START + LAUNCH_SPAN * fraction(index * LAUNCH_STEP),
    apexShare: APEX_START + APEX_SPAN * fraction(index * APEX_STEP),
  };
}

function planRockets(): FireworkRocket[] {
  const launches: number[] = [];
  for (let at = 0; at < ROCKET_PHASE_SECONDS; at += ROCKET_INTERVAL_SECONDS) launches.push(at);
  for (let rocket = 0; rocket < FINALE_ROCKETS; rocket++) {
    launches.push(FINALE_SECONDS + rocket * FINALE_STAGGER_SECONDS);
  }
  launches.sort((a, b) => a - b);
  return launches.map((at, index) => rocketAt(index, at));
}

/** Every rocket of the victory fireworks, in launch order. */
export const VICTORY_ROCKETS: readonly FireworkRocket[] = planRockets();

/** The rockets that go up, and the ones that burst, on the fanfare's frame `ageFrames`. */
export function fireworkSchedule(ageFrames: number): {
  readonly launches: readonly FireworkRocket[];
  readonly bursts: readonly FireworkRocket[];
} {
  return {
    launches: VICTORY_ROCKETS.filter((rocket) => rocket.launchFrame === ageFrames),
    bursts: VICTORY_ROCKETS.filter((rocket) => rocket.burstFrame === ageFrames),
  };
}
