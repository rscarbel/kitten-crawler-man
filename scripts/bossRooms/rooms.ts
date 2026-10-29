/**
 * Every boss room the harness and the gates know about, one module each.
 */

import type { BossRoomHarness } from './harness.js';
import { trashGremlinRoom } from './trashGremlin.js';
import { gymRoom } from './gym.js';
import { powerLabRoom } from './powerLab.js';
import { floodedPumpRoom } from './floodedPumpRoom.js';
import { spiderRoom } from './spider.js';

export const BOSS_ROOM_HARNESSES: readonly BossRoomHarness[] = [
  trashGremlinRoom,
  gymRoom,
  powerLabRoom,
  floodedPumpRoom,
  spiderRoom,
];
