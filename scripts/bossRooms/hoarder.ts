/**
 * The Hoarder's lair on floor 1: its dressing system, the states it can be
 * driven into, and its own gates.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { TheHoarder } from '../../src/creatures/TheHoarder.js';
import { HOARDER_BOSS_TYPE } from '../../src/systems/bossRooms/BossRoomDressings.js';
import {
  TOWER_WOBBLE_FRAMES,
  type HoarderRoomSystem,
} from '../../src/systems/bossRooms/HoarderRoomSystem.js';
import {
  DEFAULT_MIN_OPEN_FLOOR_SHARE,
  DOOR_SIDES,
  dressingUnderTest,
  gameGauntletDressings,
  gauntletBossRoom,
  type BossRoomHarness,
  type BossRoomState,
  type RoomEnvironment,
} from './harness.js';
import { hoarderRoomGates } from './hoarderGates.js';

/** How far into its fall the review's toppling tower is caught: past the wobble, mid-air. */
const REVIEW_FRAMES_INTO_FALL = 8;
const REVIEW_FALL_FRAMES = TOWER_WOBBLE_FRAMES + REVIEW_FRAMES_INTO_FALL;
/** Roaches the review's heaps are rustling with. */
const REVIEW_RUSTLES = 2;
const REVIEW_SEAL_FRAMES = 24;

/**
 * The fight at its busiest, without a fight: the door barricaded, a tower
 * mid-fall, two heaps rustling with roaches beside the party. She is put in
 * the room for it, since the lair only acts while she is alive in it.
 */
function driveEnraged(room: HoarderRoomSystem, env: RoomEnvironment): boolean {
  const { spawn } = room.layout;
  if (!env.frame.roster.mobs.some((mob) => mob instanceof TheHoarder)) {
    env.frame.roster.add(new TheHoarder(spawn.x, spawn.y, TILE_SIZE));
  }
  room.onSeal();
  room.update(env.frame);
  const nearestTower = room.towers.findIndex((_, index) => room.isTowerStanding(index));
  if (nearestTower < 0) return false;
  room.startTopple(nearestTower, {
    x: (spawn.x + 1 / 2) * TILE_SIZE,
    y: (spawn.y + 1 / 2) * TILE_SIZE,
  });
  for (let heap = 0; heap < REVIEW_RUSTLES; heap++) room.hatchInJunk(env.frame.active);
  for (let frame = 0; frame < REVIEW_FALL_FRAMES; frame++) room.update(env.frame);
  return true;
}

const HOARDER_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'enraged', 'defeated'];

export const hoarderRoom: BossRoomHarness = {
  id: 'hoarder',
  floor: 1,
  assetGroup: 'boss_hoarder',
  states: HOARDER_STATES,
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, HOARDER_BOSS_TYPE),
  build: (env) => {
    const { hoarder } = gameGauntletDressings(env);
    if (hoarder === null) throw new Error('the hoarder room vanished between locate and build');
    return dressingUnderTest(hoarder, env, {
      driveToState: (state) => {
        if (state === 'enraged') return driveEnraged(hoarder, env);
        if (state !== 'sealed') return undefined;
        // Long enough for the junk to finish sliding across the doors.
        hoarder.onSeal();
        for (let frame = 0; frame < REVIEW_SEAL_FRAMES; frame++) hoarder.update(env.frame);
        return true;
      },
    });
  },
  gates: hoarderRoomGates,
};
