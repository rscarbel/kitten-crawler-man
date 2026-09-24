#!/usr/bin/env tsx
/**
 * Prints the Hoarder fight sim's numbers for every doorway side: a whole fight
 * against a scripted crawler, and a two-minute chase that measures her flight.
 * These are the numbers `gates:boss-rooms` holds the lair to.
 *
 *   npm run sim:hoarder
 *   HOARDER_SIM_BARE=1 npm run sim:hoarder   # the empty room, for comparison
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { DOOR_SIDES } from './bossRooms/harness.js';
import { measureHoarderSide } from './bossRooms/hoarderFightSim.js';

installCanvasGlobals();

const DECIMALS = 2;

for (const side of DOOR_SIDES) {
  const { fight, chase, unfinishedFights } = measureHoarderSide(side);
  console.log(
    `${side.padEnd('south'.length)}  ` +
      `ttk ${fight.timeToKillSeconds.toFixed(DECIMALS)}s (${unfinishedFights} unfinished)  ` +
      `attacks/min ${fight.attacksPerMinute.toFixed(DECIMALS)}  ` +
      `hits ${fight.hitsOnCrawler.toFixed(DECIMALS)} (room ${fight.roomHazardHits.toFixed(DECIMALS)})  ` +
      `fight pinned ${fight.pinnedSeconds.toFixed(DECIMALS)}s  ` +
      `chase pinned ${chase.pinnedSeconds.toFixed(DECIMALS)}s  ` +
      `re-engage ${chase.reengageSeconds.toFixed(DECIMALS)}s`,
  );
  const breakdown = [...fight.hitsBySource]
    .map(([label, count]) => `${label} ${count.toFixed(DECIMALS)}`)
    .join(', ');
  console.log(
    `       hits by source: ${breakdown}; towers toppled ${fight.towersToppled.toFixed(DECIMALS)}`,
  );
}
