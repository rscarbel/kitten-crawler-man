#!/usr/bin/env tsx
/**
 * Headless gate on the five fairies, driven through the real spawner, the
 * real creatures, the real fairy systems and the real crawler movement.
 *
 * - Spawn tables: the room roll Monte-Carlo'd over every region, difficulty
 *   and upgrade state, the healer an independent roll outside the count.
 * - Spawn rules: every chance is its design rate plus the flat bonus, held to
 *   certainty, with rates designed off still off, and the scatter roll's
 *   guaranteed shield on every difficulty.
 * - The Ball of Swine upgrade on a real built floor 2: untouched rooms gain,
 *   an occupied or engaged room does not, a second run adds nothing, and the
 *   reload path gives the upgraded rates. Fairies that fled into a room count
 *   as its own when it is topped up.
 * - Boss healers on the hardest difficulty through every boss's own spawn
 *   path, and none on the others or for a boss already beaten.
 * - Floor 3's scatter across a seed sweep: never inside the town or circus;
 *   and no fairy casts at a crawler sheltering in the town's safe zone.
 * - Flight, and each kind's in-life casts and death effects.
 * - The telegraphs every offensive cast carries in the world — the ice bolt's
 *   capped speed, the lob's reticle — and the freeze that must never guarantee
 *   a fireball blast.
 * - Every fairy and raised-skeleton sound preloaded wherever one can be heard.
 * - The Smush sparing fairies.
 * - Positioning: HP share, backing off, cover, running for the next room, and
 *   the speed cap a determined chase always beats.
 *
 * Every rule is also run against a deliberately broken version of what it
 * guards, and must go red there: a check that cannot fail is not a check. The
 * run exits non-zero if any rule fails, any broken version passes, or any
 * precondition a rule's staging leans on is false.
 *
 * Run: npm run verify:fairies
 */

import { mulberry32 } from '../src/sprites/person/rng';
import { createFairyGateTally } from './verifyFairies/report';
import { verifySpawnTables } from './verifyFairies/spawnTables';
import { verifySpawnRules } from './verifyFairies/spawnRules';
import { verifyRateUpgrade, verifyUpgradeCountsFledInFairies } from './verifyFairies/upgrade';
import { verifyBossHealers } from './verifyFairies/bossHealers';
import {
  verifyFairiesRespectTownSafeZone,
  verifyOverworldFairies,
} from './verifyFairies/overworld';
import { verifyFlight } from './verifyFairies/flight';
import { verifyShieldFairy } from './verifyFairies/shield';
import { verifyHealingFairy } from './verifyFairies/heal';
import { verifyIceFairy } from './verifyFairies/ice';
import { verifyFireFairy } from './verifyFairies/fire';
import { verifyNecroFairy } from './verifyFairies/necro';
import { verifyFairySounds } from './verifyFairies/sounds';
import { verifySmushSparesFairies } from './verifyFairies/smush';
import { verifyFairyPositioning } from './verifyFairies/positioning';

/**
 * Every random draw the game makes — a dodge, a room roll, a placement —
 * replays from this, so two runs print the same report.
 */
const VERIFY_SEED = 0xfa1_7e5;
Math.random = mulberry32(VERIFY_SEED);

const report = createFairyGateTally();
verifySpawnTables(report);
verifySpawnRules(report);
verifyRateUpgrade(report);
verifyUpgradeCountsFledInFairies(report);
verifyBossHealers(report);
verifyOverworldFairies(report);
verifyFairiesRespectTownSafeZone(report);
verifyFlight(report);
verifyShieldFairy(report);
verifyHealingFairy(report);
verifyIceFairy(report);
verifyFireFairy(report);
verifyNecroFairy(report);
verifyFairySounds(report);
verifySmushSparesFairies(report);
verifyFairyPositioning(report);

const passedPositives = report.positiveCount - report.positiveFailures;
const redNegatives = report.negativeCount - report.negativesThatPassed;
console.log(
  `\nrules: ${passedPositives}/${report.positiveCount} held; ` +
    `broken versions: ${redNegatives}/${report.negativeCount} caught; ` +
    `preconditions failed: ${report.preconditionFailures}`,
);
const clean =
  report.positiveFailures === 0 &&
  report.negativesThatPassed === 0 &&
  report.preconditionFailures === 0;
console.log(clean ? 'verify:fairies passed' : 'verify:fairies FAILED');
process.exit(clean ? 0 : 1);
