/**
 * The Trash Gremlin's lair on floor 1: its dressing system, the states it can be
 * driven into, and its own gates.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { TrashGremlin } from '../../src/creatures/TrashGremlin.js';
import { TRASH_GREMLIN_BOSS_TYPE } from '../../src/core/mobs/bossTypes.js';
import {
  TOWER_WOBBLE_FRAMES,
  type TrashGremlinRoomSystem,
} from '../../src/systems/bossRooms/TrashGremlinRoomSystem.js';
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
import { TRASH_GREMLIN_SWEEP_GATES, trashGremlinRoomGates } from './trashGremlinGates.js';

/** How far into its fall the review's toppling tower is caught: past the wobble, mid-air. */
const REVIEW_FRAMES_INTO_FALL = 8;
const REVIEW_FALL_FRAMES = TOWER_WOBBLE_FRAMES + REVIEW_FRAMES_INTO_FALL;
/** Roaches the review's piles are rustling with. */
const REVIEW_RUSTLES = 2;
const REVIEW_SEAL_FRAMES = 24;

/**
 * The fight at its busiest, without a fight: the door barricaded, a tower
 * mid-fall, two heaps rustling with roaches beside the party. It is put in
 * the room for it, since the lair only acts while it is alive in it.
 */
function driveEnraged(room: TrashGremlinRoomSystem, env: RoomEnvironment): boolean {
  const { spawn } = room.layout;
  if (!env.frame.roster.mobs.some((mob) => mob instanceof TrashGremlin)) {
    env.frame.roster.add(new TrashGremlin(spawn.x, spawn.y, TILE_SIZE));
  }
  room.onSeal();
  room.update(env.frame);
  const nearestTower = room.towers.findIndex((_, index) => room.isTowerStanding(index));
  if (nearestTower < 0) return false;
  room.startTopple(nearestTower, {
    x: (spawn.x + 1 / 2) * TILE_SIZE,
    y: (spawn.y + 1 / 2) * TILE_SIZE,
  });
  room.hatchInJunk(env.frame.active, REVIEW_RUSTLES);
  for (let frame = 0; frame < REVIEW_FALL_FRAMES; frame++) room.update(env.frame);
  return true;
}

const TRASH_GREMLIN_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'enraged', 'defeated'];

export const trashGremlinRoom: BossRoomHarness = {
  id: 'trashGremlin',
  floor: 1,
  assetGroup: 'boss_trash_gremlin',
  states: TRASH_GREMLIN_STATES,
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, TRASH_GREMLIN_BOSS_TYPE),
  build: (env) => {
    const { trashGremlin } = gameGauntletDressings(env);
    if (trashGremlin === null)
      throw new Error('the trashGremlin room vanished between locate and build');
    return dressingUnderTest(trashGremlin, env, {
      driveToState: (state) => {
        if (state === 'enraged') return driveEnraged(trashGremlin, env);
        if (state !== 'sealed') return undefined;
        // Long enough for the junk to finish sliding across the doors.
        trashGremlin.onSeal();
        for (let frame = 0; frame < REVIEW_SEAL_FRAMES; frame++) trashGremlin.update(env.frame);
        return true;
      },
    });
  },
  gates: trashGremlinRoomGates,
  sweepGates: TRASH_GREMLIN_SWEEP_GATES,
};
