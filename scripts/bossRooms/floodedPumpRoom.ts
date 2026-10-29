/**
 * The Kraken's flooded pump room on floor 1: its dressing system and the
 * states it can be driven into. The harness's fight states map onto the
 * room's own: `pre` is the approach (barrels on their seat, pumps pouring),
 * `sealed` the flooded room after the intro, `enraged` the crossing under way
 * (barrels afloat in the entrance, two pumps shut, raft and pump tentacles
 * up and slamming), `phase2` the drain half run, `phase3` the drained floor
 * and `defeated` the won room with its barrels being broken.
 *
 * Each state is reached through the room's own checkpoint restore, the path a
 * death's rewind and a load take, so a review also shows that the restore
 * rebuilds the water, the barrels and the tentacles.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { KRAKEN_BOSS_TYPE } from '../../src/core/mobs/bossTypes.js';
import {
  floodedPumpRoomExitTiles,
  PUMP_SHUTOFF_PRESSES,
  ROOM_DRAIN_FRAMES,
  type FloodedPumpRoomSystem,
} from '../../src/systems/bossRooms/FloodedPumpRoomSystem.js';
import type { FloodedPumpRoomCheckpoint } from '../../src/systems/bossRooms/floodedPumpRoom/floodedPumpRoomState.js';
import {
  defaultInvariantTiles,
  DOOR_SIDES,
  dressingUnderTest,
  gameGauntletDressings,
  gauntletBossRoom,
  type BossRoomHarness,
  type BossRoomState,
  type RoomEnvironment,
} from './harness.js';

/** A half-hauled pump shows its progress bar. */
const HALF_HAULED_PRESSES = Math.floor(PUMP_SHUTOFF_PRESSES / 2);
/** Frames the crossing review runs, past the tentacles' rise and into a slam's footprint. */
const CROSSING_REVIEW_FRAMES = 140;
/** How far through the drain its review is drawn. */
const DRAIN_REVIEW_SHARE = 0.6;
/** Blows on each barrel in the won room's review: whole, cracked, breaking, broken. */
const DEFEATED_BARREL_HITS = [0, 1, 2, 2];
const BROKEN_BARREL_FRAMES = 30;

function floodedRoomOf(env: RoomEnvironment): FloodedPumpRoomSystem {
  const { floodedPumpRoom } = gameGauntletDressings(env);
  if (floodedPumpRoom === null)
    throw new Error('the flooded pump room vanished between locate and build');
  return floodedPumpRoom;
}

/** Stands the active crawler in the middle of a tile. */
function standOn(env: RoomEnvironment, tile: { x: number; y: number }): void {
  env.frame.human.x = tile.x * TILE_SIZE;
  env.frame.human.y = tile.y * TILE_SIZE;
}

/** Runs the room, the map's drain and every mob it raised, as the scene would. */
function run(env: RoomEnvironment, room: FloodedPumpRoomSystem, frames: number): void {
  const party = [env.frame.human, env.frame.cat];
  for (let frame = 0; frame < frames; frame++) {
    env.gameMap.advanceWaterDrains();
    room.update(env.frame);
    for (const mob of env.frame.roster.mobs) {
      mob.updateAI(party);
      mob.tickTimers();
    }
  }
}

/** The tile of `rect` nearest `to`, where a slam from a tentacle at `to` certainly reaches. */
function nearestTileOf(
  rect: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(to.x, rect.x), rect.x + rect.w - 1),
    y: Math.min(Math.max(to.y, rect.y), rect.y + rect.h - 1),
  };
}

function restore(room: FloodedPumpRoomSystem, changes: Partial<FloodedPumpRoomCheckpoint>): void {
  room.restoreCheckpoint({ ...room.captureCheckpoint(), ...changes });
}

function driveFloodedRoom(
  env: RoomEnvironment,
  room: FloodedPumpRoomSystem,
  state: BossRoomState,
): boolean {
  const { layout } = room;
  const allShut = {
    left: PUMP_SHUTOFF_PRESSES,
    far: PUMP_SHUTOFF_PRESSES,
    right: PUMP_SHUTOFF_PRESSES,
  };
  switch (state) {
    case 'pre':
      run(env, room, 1);
      return true;
    case 'sealed':
      restore(room, { state: { kind: 'flooded' }, barrels: 'corridor' });
      run(env, room, 1);
      return true;
    case 'enraged': {
      if (layout.rafts.length === 0) return false;
      const firstRaft = layout.rafts[0];
      restore(room, {
        state: { kind: 'flooded' },
        barrels: 'entrance',
        pumpPresses: {
          left: PUMP_SHUTOFF_PRESSES,
          far: PUMP_SHUTOFF_PRESSES,
          right: HALF_HAULED_PRESSES,
        },
        raftTentacles: layout.rafts.map((_, index) => (index === 0 ? 'risen' : 'dormant')),
        pumpTentacle: { kind: 'risen', wall: 'far' },
      });
      standOn(env, nearestTileOf(firstRaft.rect, firstRaft.tentacle));
      run(env, room, CROSSING_REVIEW_FRAMES);
      return true;
    }
    case 'phase2':
      restore(room, {
        state: { kind: 'draining', framesLeft: ROOM_DRAIN_FRAMES },
        barrels: 'entrance',
        pumpPresses: allShut,
      });
      run(env, room, Math.round(ROOM_DRAIN_FRAMES * DRAIN_REVIEW_SHARE));
      return true;
    case 'phase3':
      restore(room, { state: { kind: 'drained' }, barrels: 'entrance', pumpPresses: allShut });
      run(env, room, 1);
      return true;
    case 'defeated':
      restore(room, {
        state: { kind: 'defeated' },
        barrels: 'entrance',
        pumpPresses: allShut,
        barrelHits: DEFEATED_BARREL_HITS,
      });
      // Twice, as the scene's replay after a build or a load delivers it.
      room.onBossDefeated();
      room.onBossDefeated();
      run(env, room, BROKEN_BARREL_FRAMES);
      return true;
  }
}

const FLOODED_ROOM_STATES: readonly BossRoomState[] = [
  'pre',
  'sealed',
  'enraged',
  'phase2',
  'phase3',
  'defeated',
];

/** Rafts, pumps and water fill the room; its open floor is everything a crawler wades or walks. */
const FLOODED_ROOM_MIN_OPEN_FLOOR_SHARE = 0.9;

export const floodedPumpRoom: BossRoomHarness = {
  id: 'floodedPumpRoom',
  floor: 1,
  assetGroup: 'boss_flooded_pump_room',
  states: FLOODED_ROOM_STATES,
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: FLOODED_ROOM_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, KRAKEN_BOSS_TYPE),
  // The ways on are held shut by a barrel until the Kraken dies, so only the
  // lanes in front of them must be open, not the doorway tiles the barrels stand on.
  invariantTiles: (room, gameMap) => {
    const shared = defaultInvariantTiles(room);
    const barrelKeys = new Set(
      floodedPumpRoomExitTiles(gameMap, room.bounds).map((tile) => `${tile.x},${tile.y}`),
    );
    return {
      ...shared,
      approach: shared.approach.filter((tile) => !barrelKeys.has(`${tile.x},${tile.y}`)),
    };
  },
  build: (env) => {
    const room = floodedRoomOf(env);
    return dressingUnderTest(room, env, {
      update: () => env.gameMap.advanceWaterDrains(),
      driveToState: (state) => driveFloodedRoom(env, room, state),
    });
  },
};
