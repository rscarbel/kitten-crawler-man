#!/usr/bin/env tsx
/**
 * Headless gate for the floors' keys: the key ring, the key system that
 * awards fragments and queues their ceremonies, and the ring's save. Checks
 * behaviour, never balance, and reads every expectation from `FLOOR_KEYS`.
 * Each section lives in `scripts/floor-keys/` and is listed in `SECTIONS`.
 *
 * Run: npm run verify:floor-keys
 */

import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';
import { ringSections } from './floor-keys/ring';
import { stairwellSections } from './floor-keys/stairwellGating';
import { newGameSections } from './floor-keys/newGame';
import { interiorReturnSections } from './floor-keys/interiorReturn';
import type { Check, FloorKeysSection } from './floor-keys/shared';

useDevPlayerIdentity();

let passes = 0;
let failures = 0;

const check: Check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (ok) passes++;
  else failures++;
};

const SECTIONS: readonly FloorKeysSection[] = [
  ...ringSections,
  ...stairwellSections,
  ...newGameSections,
  ...interiorReturnSections,
];

for (const section of SECTIONS) {
  console.log(`\n── ${section.name}`);
  try {
    section.run(check);
  } catch (error) {
    check(
      false,
      `${section.name} threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
