/**
 * The Hoarder fight's numbers in the room as it stood before the lair had any
 * junk in it — an empty 22×18 rectangle with a picture for a floor — measured
 * by `measureHoarderSide` over all of `SIM_RANDOM_SEEDS`. That room is staged
 * again by `HOARDER_SIM_BARE=1 npm run sim:hoarder`, which reproduces the
 * recorded numbers exactly, so these can be re-measured with more streams.
 *
 * The lair's gates hold the dressed room to these: any metric may move toward
 * a harder fight freely, but none may move more than
 * {@link EASIER_TOLERANCE_SHARE} toward an easier one. Junk that gives cover,
 * pins her in a corner or lets a crawler catch her sooner shows up here first.
 * Re-measure before relaxing any of them.
 */

import type { DoorSide } from '../../src/systems/bossRooms/bossRoomLayout.js';

export interface HoarderBaseline {
  /** Mean seconds from the door to her death against the scripted crawler. Lower is easier. */
  readonly timeToKillSeconds: number;
  /** Spits and purges she begins per minute of that fight, each counted once. Lower is easier. */
  readonly attacksPerMinute: number;
  /** Mean blows that land on the crawler over the fight. Lower is easier. */
  readonly hitsOnCrawler: number;
  /** Seconds of a two-minute chase she spends fleeing without getting anywhere. Higher is easier. */
  readonly chasePinnedSeconds: number;
  /** Mean seconds to run her down again after breaking off and walking back to the door. Lower is easier. */
  readonly reengageSeconds: number;
}

/** How far toward an easier fight any one metric may drift before the gate fails. */
export const EASIER_TOLERANCE_SHARE = 0.1;

export const HOARDER_BASELINES: Readonly<Record<DoorSide, HoarderBaseline>> = {
  south: {
    timeToKillSeconds: 23.53,
    attacksPerMinute: 15.03,
    hitsOnCrawler: 2.58,
    chasePinnedSeconds: 12.73,
    reengageSeconds: 4.55,
  },
  north: {
    timeToKillSeconds: 24.68,
    attacksPerMinute: 15.18,
    hitsOnCrawler: 3.92,
    chasePinnedSeconds: 13.71,
    reengageSeconds: 4.36,
  },
  east: {
    timeToKillSeconds: 24.39,
    attacksPerMinute: 14.27,
    hitsOnCrawler: 3.75,
    chasePinnedSeconds: 11.57,
    reengageSeconds: 5.2,
  },
  west: {
    timeToKillSeconds: 23.78,
    attacksPerMinute: 14.23,
    hitsOnCrawler: 2.92,
    chasePinnedSeconds: 11.04,
    reengageSeconds: 4.98,
  },
};
