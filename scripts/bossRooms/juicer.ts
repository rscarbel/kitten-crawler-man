/**
 * The Juicer's gym on floor 1: its dressing system, the states it can be driven
 * into, and its own gates.
 */

import { CONSOLE_BEEP_FRAMES, type JuicerRoomSystem } from '../../src/systems/JuicerRoomSystem.js';
import { JUICER_BOSS_TYPE } from '../../src/systems/bossRooms/BossRoomDressings.js';
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
import { juicerRoomGates } from './juicerGates.js';
import { stagePlateRoll } from './juicerScenario.js';

/** Frames the review lets a plate wind-up run, so its chalk lane is down and the plate is in hand. */
const REVIEW_WINDUP_FRAMES = 20;
/** How far into its beep the review's shut-off console is. */
const REVIEW_BEEP_FRAMES_INTO = 10;
const REVIEW_BEEP_FRAMES_LEFT = CONSOLE_BEEP_FRAMES - REVIEW_BEEP_FRAMES_INTO;

/**
 * The fight at its busiest, without a fight: shutter down, belts running, the
 * mirror cracked by his enrage, a plate lane chalked across the floor with
 * chalk still hanging over the rack it came off, one console beeping back to
 * life and the boombox smashed.
 */
function driveEnraged(room: JuicerRoomSystem, env: RoomEnvironment): boolean {
  const staged = stagePlateRoll(room, env.frame);
  if (staged === null) return false;
  for (let frame = 0; frame < REVIEW_WINDUP_FRAMES; frame++) {
    room.update(env.frame);
    staged.juicer.updateAI([env.frame.human]);
  }
  const snapshot = room.captureCheckpoint();
  room.restoreCheckpoint({
    ...snapshot,
    consoleShutoffFrames: snapshot.consoleShutoffFrames.map((frames, index) =>
      index === 0 ? REVIEW_BEEP_FRAMES_LEFT : frames,
    ),
    boomboxHp: 0,
  });
  return true;
}

const JUICER_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'enraged', 'defeated'];

export const juicerRoom: BossRoomHarness = {
  id: 'juicer',
  floor: 1,
  assetGroup: 'boss_juicer',
  states: JUICER_STATES,
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, JUICER_BOSS_TYPE),
  build: (env) => {
    const { juicer } = gameGauntletDressings(env);
    return dressingUnderTest(juicer, env, {
      driveToState: (state) => (state === 'enraged' ? driveEnraged(juicer, env) : undefined),
    });
  },
  gates: juicerRoomGates,
};
