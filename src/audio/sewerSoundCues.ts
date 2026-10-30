/**
 * Every sound the sewer makes, by what it means rather than by file. The
 * storm drain's preload group is built from this table, so a cue played here
 * is always decoded before the party can hear it.
 */

import type { SoundId } from './sounds';

export const SEWER_CUES = {
  /** One haul on a sluice's valve wheel. */
  valveTurn: ['pump_valve_turn_1', 'pump_valve_turn_2', 'pump_valve_turn_3', 'pump_valve_turn_4'],
  /** The last haul: the sluice gate dropping home. */
  sluiceShut: ['pump_shutdown'],
  /** A channel running down, or a sump flooding. */
  waterRush: ['room_drain_rush'],
  /** The junction's rats, which floor 3 has no other use for. */
  ratSqueak: ['rat_squeak_1', 'rat_squeak_2', 'rat_squeak_3'],
} as const satisfies Record<string, readonly SoundId[]>;

export type SewerCue = keyof typeof SEWER_CUES;
