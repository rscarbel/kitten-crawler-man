/**
 * Every sound the sewer makes, by what it means rather than by file. The
 * storm drain's preload group is built from this table, so a cue played here
 * is always decoded before the party can hear it.
 */

import type { CueSlot } from './cueSlot';
import { AMBIENT_RAMP_MS, type LoopLevel } from './loopLevels';
import type { SoundId } from './sounds';

/** The sump's pipe pouring, a loop heard from the pipe while it runs. */
export const SEWER_OUTFLOW_LOOP = {
  id: 'pump_outflow_loop',
  volume: 0.75,
  fadeInMs: AMBIENT_RAMP_MS,
  fadeOutMs: AMBIENT_RAMP_MS,
} as const satisfies LoopLevel;

/**
 * Waits on `channel_draining_loop`, the water swirling away down the sump's
 * drain; the Kraken room's drain rush stands in. It runs longer than a sump
 * takes to empty, and the section stops it whenever the world halts, so it
 * starts again from the top on the next tick and never audibly wraps.
 */
const SUMP_DRAIN_SLOT = {
  takes: ['room_drain_rush'],
  standInFor: 'channel_draining_loop',
} as const satisfies CueSlot<'channel_draining_loop'>;

/** A shut-off sump running down its drain, a loop heard from the drain until the basin is dry. */
export const SEWER_SUMP_DRAIN_LOOP = {
  id: SUMP_DRAIN_SLOT.takes[0],
  volume: 0.8,
  fadeInMs: AMBIENT_RAMP_MS,
  /** The last of the water gurgles away rather than cutting off. */
  fadeOutMs: 700,
} as const satisfies LoopLevel;

/** How far the sump's pipe and drain carry, in tiles. */
export const SEWER_WATER_LOOP_HEARING_TILES = 18;

export const SEWER_CUES = {
  /** One haul on a sluice's valve wheel. */
  valveTurn: ['pump_valve_turn_1', 'pump_valve_turn_2', 'pump_valve_turn_3', 'pump_valve_turn_4'],
  /** The last haul: the sluice gate dropping home. */
  sluiceShut: ['pump_shutdown'],
  /** The last haul on a pipe's opening wheel: the valve unseating with a clunk. */
  pipeOpen: ['pipe_bolted_clunk'],
  /** A lowered channel running down. */
  waterRush: ['room_drain_rush'],
  pipeOutflowLoop: [SEWER_OUTFLOW_LOOP.id],
  sumpDrainLoop: [SEWER_SUMP_DRAIN_LOOP.id],
  /** The junction's rats, which floor 3 has no other use for. */
  ratSqueak: ['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3'],
} as const satisfies Record<string, readonly SoundId[]>;

export type SewerCue = keyof typeof SEWER_CUES;
