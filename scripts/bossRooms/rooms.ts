/**
 * Every boss room the harness and the gates know about, one module each.
 */

import type { BossRoomHarness } from './harness.js';
import { hoarderRoom } from './hoarder.js';
import { juicerRoom } from './juicer.js';
import { krakarenRoom } from './krakaren.js';
import { spiderRoom } from './spider.js';
import { swineRoom } from './swine.js';

export const BOSS_ROOM_HARNESSES: readonly BossRoomHarness[] = [
  hoarderRoom,
  juicerRoom,
  krakarenRoom,
  spiderRoom,
  swineRoom,
];
