#!/usr/bin/env tsx
/**
 * Headless gate on the clogged bathroom's pipe boards: the win check and the
 * solver against brute force, every tier's generator sweep and fallback
 * against the acceptance contract, determinism, the turn API, and the worst
 * generation time at hard.
 *
 * Run: npm run verify:pipe-board
 *      npm run verify:pipe-board -- --fault=<name>    (must fail)
 *      npm run verify:pipe-board -- --attempts=<n>    (world seeds per tier)
 *      npm run verify:pipe-board -- --write-fallbacks (rewrite the frozen fallbacks)
 */

import { PIPE_BOARD_FAULTS, type PipeBoardFault } from '../src/systems/cloggedBathroom/pipeBoard';
import { runPipeBoardChecks, SWEEP_WORLDS, writeFallbacks } from './pipeBoardChecks';

const FAULT_FLAG = '--fault=';
const ATTEMPTS_FLAG = '--attempts=';
const WRITE_FALLBACKS_FLAG = '--write-fallbacks';
const FALLBACK_PATH = 'src/systems/cloggedBathroom/pipeBoardFallback.ts';
const MS_PER_SECOND = 1000;

function parseFault(): PipeBoardFault | null {
  const flag = process.argv.find((arg) => arg.startsWith(FAULT_FLAG));
  if (flag === undefined) return null;
  const name = flag.slice(FAULT_FLAG.length);
  const fault = PIPE_BOARD_FAULTS.find((candidate) => candidate === name);
  if (fault === undefined) {
    console.error(`unknown fault "${name}"; known: ${PIPE_BOARD_FAULTS.join(', ')}`);
    process.exit(2);
  }
  return fault;
}

function parseWorlds(): number {
  const flag = process.argv.find((arg) => arg.startsWith(ATTEMPTS_FLAG));
  if (flag === undefined) return SWEEP_WORLDS;
  const worlds = Number(flag.slice(ATTEMPTS_FLAG.length));
  return Number.isInteger(worlds) && worlds > 0 ? worlds : SWEEP_WORLDS;
}

if (process.argv.includes(WRITE_FALLBACKS_FLAG)) {
  writeFallbacks(FALLBACK_PATH);
  console.log(`wrote ${FALLBACK_PATH}; run npm run format, then the gate`);
  process.exit(0);
}

const fault = parseFault();
const started = performance.now();
const { failures } = runPipeBoardChecks({ fault, worldsPerTier: parseWorlds() });
const seconds = ((performance.now() - started) / MS_PER_SECOND).toFixed(1);

console.log('');
if (fault !== null) console.log(`fault injected: ${fault}`);
if (failures.length === 0) {
  console.log(`verify:pipe-board — all checks passed in ${seconds}s`);
} else {
  console.log(`verify:pipe-board — ${failures.length} failed in ${seconds}s:`);
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
