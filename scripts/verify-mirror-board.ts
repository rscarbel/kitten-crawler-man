#!/usr/bin/env tsx
/**
 * Headless gate on the hall of mirrors' boards: every tier's generator sweep
 * and fallback meet the acceptance contract, the tiers stay in order, and a
 * world and difficulty always give the same board.
 *
 * Run: npm run verify:mirror-board
 *      npm run verify:mirror-board -- --fault=<name>   (must fail)
 *      npm run verify:mirror-board -- --attempts=<n>   (sweep size per tier)
 *
 * Faults: drop-solution-mirror, current-hall, decorative-window,
 * hot-span-blocks-glass, misplaced-limelight, star-over-teaching-glass,
 * kitten-twin.
 */

import {
  MIRROR_BOARD_FAULTS,
  runMirrorBoardChecks,
  SWEEP_ATTEMPTS,
  type MirrorBoardFault,
} from './bigTopMirrorBoardChecks';

const FAULT_FLAG = '--fault=';
const ATTEMPTS_FLAG = '--attempts=';
const MS_PER_SECOND = 1000;

function parseFault(): MirrorBoardFault | null {
  const flag = process.argv.find((arg) => arg.startsWith(FAULT_FLAG));
  if (flag === undefined) return null;
  const name = flag.slice(FAULT_FLAG.length);
  const fault = MIRROR_BOARD_FAULTS.find((candidate) => candidate === name);
  if (fault === undefined) {
    console.error(`unknown fault "${name}"; known: ${MIRROR_BOARD_FAULTS.join(', ')}`);
    process.exit(2);
  }
  return fault;
}

function parseAttempts(): number {
  const flag = process.argv.find((arg) => arg.startsWith(ATTEMPTS_FLAG));
  if (flag === undefined) return SWEEP_ATTEMPTS;
  const attempts = Number(flag.slice(ATTEMPTS_FLAG.length));
  return Number.isInteger(attempts) && attempts > 0 ? attempts : SWEEP_ATTEMPTS;
}

const fault = parseFault();
const started = performance.now();
const failures = runMirrorBoardChecks({ fault, attemptsPerTier: parseAttempts() });
const seconds = ((performance.now() - started) / MS_PER_SECOND).toFixed(1);

console.log('');
if (fault !== null) console.log(`fault injected: ${fault}`);
if (failures.length === 0) {
  console.log(`verify:mirror-board — all checks passed in ${seconds}s`);
} else {
  console.log(`verify:mirror-board — ${failures.length} failed in ${seconds}s:`);
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
