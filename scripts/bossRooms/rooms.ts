/**
 * Every boss room the harness and the gates know about, one module each.
 */

import type { BossRoomHarness } from './harness.js';
import { trashGremlinRoom } from './trashGremlin.js';
import { gymRoom } from './gym.js';
import { krakarenRoom } from './krakaren.js';
import { spiderRoom } from './spider.js';
import { swineRoom } from './swine.js';

export const BOSS_ROOM_HARNESSES: readonly BossRoomHarness[] = [
  trashGremlinRoom,
  gymRoom,
  krakarenRoom,
  spiderRoom,
  swineRoom,
];
