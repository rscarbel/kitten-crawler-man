/**
 * Every sound the Kraken's flooded pump room makes, by what it means rather
 * than by file. All of them are in floor 1's preload group.
 */

import { WOOD_SMASHING_SOUNDS, type SoundId } from '../../../audio/sounds';

export const FLOODED_PUMP_ROOM_CUES = {
  /** Something enormous beyond the corridor, as the intro begins. */
  krakenGrowl: ['kraken_growl'],
  /** The corridor's barrel stack coming down across the way back. */
  barrelTopple: ['barrel_stack_topple'],
  /** Two barrels afloat in the entrance knocking together. */
  barrelKnock: ['barrel_float_knock_1', 'barrel_float_knock_2'],
  /** A pump pouring into the room; a loop, played while any pump runs. */
  pumpOutflowLoop: ['pump_outflow_loop'],
  /** One haul on a pump's valve wheel. */
  valveTurn: ['pump_valve_turn_1', 'pump_valve_turn_2', 'pump_valve_turn_3', 'pump_valve_turn_4'],
  /** The last haul: the pump winding down and its outflow cut. */
  pumpShutdown: ['pump_shutdown'],
  /** The whole room emptying through its drains. */
  drainRush: ['room_drain_rush'],
  /** A fin slicing the surface; a loop, played while the shark chases. */
  sharkChaseLoop: ['shark_fin_chase_loop'],
  /** A raft or pump tentacle's slam landing on the planks. */
  raftSlam: ['raft_slam_wood_1', 'raft_slam_wood_2', 'raft_slam_wood_3', 'raft_slam_wood_4'],
  /** A settled barrel at the entrance taking a blow, and breaking. */
  barrelSmash: WOOD_SMASHING_SOUNDS,
} as const satisfies Record<string, readonly SoundId[]>;

/** The two loops the room keeps running, each at a level the room sets every frame. */
export type FloodedPumpRoomLoop = 'pumpOutflowLoop' | 'sharkChaseLoop';
