/**
 * Big Rooster's gym on floor 2: its dressing system, the states it can be driven
 * into, and its own gates.
 */

import { CONSOLE_BEEP_FRAMES, type GymRoomSystem } from '../../src/systems/GymRoomSystem.js';
import { BIG_ROOSTER_BOSS_TYPE } from '../../src/core/mobs/bossTypes.js';
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
import { gymRoomGates } from './gymGates.js';
import { stagePlateRoll } from './gymScenario.js';

/** Frames the review lets a plate wind-up run, so its chalk lane is down and the plate is in hand. */
const REVIEW_WINDUP_FRAMES = 20;
/** Frames the review lets a kettlebell rain and a kicked ball run, so bells are mid-fall and the ball is out. */
const REVIEW_RAIN_FRAMES = 90;
/** How far into its beep the review's shut-off console is. */
const REVIEW_BEEP_FRAMES_INTO = 10;
const REVIEW_BEEP_FRAMES_LEFT = CONSOLE_BEEP_FRAMES - REVIEW_BEEP_FRAMES_INTO;

/**
 * The fight at its busiest, without a fight: shutter down, belts running, the
 * mirror cracked by his enrage, a plate lane chalked across the floor with
 * chalk still hanging over the rack it came off, kettlebells raining onto
 * their shadows, one exercise ball kicked loose, one console beeping back to
 * life and the boombox smashed.
 */
function driveEnraged(room: GymRoomSystem, env: RoomEnvironment): boolean {
  const staged = stagePlateRoll(room, env.frame);
  if (staged === null) return false;
  for (let frame = 0; frame < REVIEW_WINDUP_FRAMES; frame++) {
    room.update(env.frame);
    staged.bigRooster.updateAI([env.frame.human]);
  }
  staged.bigRooster.heaveRequest = { x: staged.bigRooster.x, y: staged.bigRooster.y };
  staged.bigRooster.ballKickRequest = { index: 0, dx: 1, dy: 1 };
  for (let frame = 0; frame < REVIEW_RAIN_FRAMES; frame++) room.update(env.frame);
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

const BIG_ROOSTER_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'enraged', 'defeated'];

export const gymRoom: BossRoomHarness = {
  id: 'gym',
  floor: 2,
  assetGroup: 'boss_big_rooster',
  states: BIG_ROOSTER_STATES,
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, BIG_ROOSTER_BOSS_TYPE),
  build: (env) => {
    const { gym } = gameGauntletDressings(env);
    return dressingUnderTest(gym, env, {
      driveToState: (state) => (state === 'enraged' ? driveEnraged(gym, env) : undefined),
    });
  },
  gates: gymRoomGates,
};
