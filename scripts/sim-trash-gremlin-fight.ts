#!/usr/bin/env tsx
/**
 * Prints the Trash Gremlin fight sim's numbers for every doorway side: a whole fight
 * against a scripted crawler, and a two-minute chase that measures its flight.
 * The numbers are for playtest tuning; no gate holds the fight to them.
 *
 *   npm run sim:trash-gremlin
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { DOOR_SIDES } from './bossRooms/harness.js';
import { measureTrashGremlinSide } from './bossRooms/trashGremlinFightSim.js';

installCanvasGlobals();

const DECIMALS = 2;

for (const side of DOOR_SIDES) {
  const { fight, chase, unfinishedFights } = measureTrashGremlinSide(side);
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
