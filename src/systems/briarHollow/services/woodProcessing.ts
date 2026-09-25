/**
 * Turning wood into boards and rope — the one core both ways of doing it
 * share: by hand at the sawmill's two machines, one wood a press, and in bulk
 * through Fenna for a coin a wood.
 *
 * Wood is spent from the party's combined stock, the crawler doing the work
 * first. What comes out goes to that crawler, or to the companion when their
 * pack is full, and counts toward the session tally the resource strip shows.
 * Working a machine by hand is a little construction practice, worth
 * Construction XP; paying Fenna to run a batch is a purchase like any other
 * shop's, so `processWood` itself never grants XP — the manual path awards it
 * after a successful call, and the paid path does not.
 */

import type { ItemId } from '../../../core/ItemDefs';
import { CONSTRUCTION_XP_PER_WOODEN_WALL } from '../../../core/CraftSkills';
import { partyCount, spend } from '../../../core/partyResources';
import { addToSessionTally } from '../../../core/resourceSessionTally';
import { WALL_TIERS } from '../structureRules';
import type { ProcessingStationKind } from '../processingStations';
import { type Crawler, type ServiceParty, recipientFor } from './serviceContext';

export const BOARDS_PER_WOOD = 2;
export const ROPE_PER_WOOD = 1;
export const FENNA_FEE_PER_WOOD = 1;

/** Seconds one wood takes at a machine by hand. */
export const MANUAL_PROCESS_SECONDS = 1.2;

/**
 * How rewarding processing is, per second of work, next to building: a
 * twentieth. Building a wooden wall is the yardstick — the XP it pays over
 * the seconds it takes.
 */
const PROCESSING_SHARE_OF_BUILD_XP_RATE = 0.05;
const WOODEN_WALL_XP_PER_SECOND = CONSTRUCTION_XP_PER_WOODEN_WALL / WALL_TIERS.wood.buildSeconds;

/** Construction XP for turning one wood into something, whichever way it was done. */
export const PROCESS_CONSTRUCTION_XP_PER_WOOD = Math.round(
  WOODEN_WALL_XP_PER_SECOND * PROCESSING_SHARE_OF_BUILD_XP_RATE * MANUAL_PROCESS_SECONDS,
);

const OUTPUT_ITEM: Readonly<Record<ProcessingStationKind, ItemId>> = {
  boards: 'wood_board',
  rope: 'rope',
};

const OUTPUT_PER_WOOD: Readonly<Record<ProcessingStationKind, number>> = {
  boards: BOARDS_PER_WOOD,
  rope: ROPE_PER_WOOD,
};

export function outputItem(output: ProcessingStationKind): ItemId {
  return OUTPUT_ITEM[output];
}

export function outputFor(output: ProcessingStationKind, wood: number): number {
  return OUTPUT_PER_WOOD[output] * wood;
}

export function partyWood(party: ServiceParty): number {
  return partyCount(party.human, party.cat, 'wood');
}

/**
 * The most wood that can go through at once for `worker`: what the party
 * holds, capped at what somebody has room to take delivery of. Stacks never
 * cap, so the cap is all or nothing — somebody already holding the output, or
 * a free slot, takes any amount.
 */
export function processableWood(
  party: ServiceParty,
  worker: Crawler,
  output: ProcessingStationKind,
): number {
  if (recipientFor(party, worker, outputItem(output)) === null) return 0;
  return partyWood(party);
}

export interface ProcessResult {
  readonly woodSpent: number;
  readonly produced: number;
  readonly recipient: Crawler;
}

/**
 * Spends `wood` from the party (the worker's own first) and hands the output
 * to the worker or the companion, tallying it. Grants no XP: the caller
 * decides whether the work was done by hand (worth Construction XP) or paid
 * for outright (a purchase, worth none). Returns null — and changes nothing —
 * when the party lacks the wood or nobody has room for the output.
 */
export function processWood(
  party: ServiceParty,
  worker: Crawler,
  output: ProcessingStationKind,
  wood: number,
): ProcessResult | null {
  if (wood <= 0 || partyWood(party) < wood) return null;
  const item = outputItem(output);
  const recipient = recipientFor(party, worker, item);
  if (recipient === null) return null;
  if (!spend(party.human, party.cat, { wood }, worker)) return null;
  const produced = outputFor(output, wood);
  recipient.inventory.addItem(item, produced);
  addToSessionTally(item, produced);
  return { woodSpent: wood, produced, recipient };
}

/** Construction XP for a machine worked by hand: `processWood`'s manual caller alone awards it. */
export function grantManualProcessingXp(worker: Crawler, wood: number): void {
  worker.craftSkills.addXp('construction', PROCESS_CONSTRUCTION_XP_PER_WOOD * wood);
}
