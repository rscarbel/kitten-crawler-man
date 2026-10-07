#!/usr/bin/env tsx
/**
 * Headless gate for Wendell's construction contracts. Checks behaviour, not
 * balance: the catalogue against the built layouts, the generator over long
 * seeded runs, the save, whole contracts worked and paid in both towns, and
 * Wendell's marker and menu. Each section lives in
 * `scripts/construction-contracts/` and is listed in `SECTIONS` below.
 *
 * Run: npm run verify:construction-contracts
 *
 * `--break-layout` knocks one layout id (and one doorway) out of the built
 * layouts in memory before the target pass, so the gate can be watched going
 * red and naming the building and spot. The negative section proves the
 * same on every run without the flag.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { contactPinSections } from './construction-contracts/contactPin';
import { flowSections } from './construction-contracts/flow';
import { generatorSections } from './construction-contracts/generator';
import { reachabilitySections } from './construction-contracts/reachability';
import { saveSections } from './construction-contracts/save';
import { sawmillPressSections } from './construction-contracts/sawmillPress';
import type { Check } from './construction-contracts/shared';
import { targetSections } from './construction-contracts/targets';
import { wendellSections } from './construction-contracts/wendell';

const BREAK_LAYOUT_FLAG = '--break-layout';

await loadGameSpritesInNode();

let passes = 0;
let failures = 0;

const check: Check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (ok) passes++;
  else failures++;
};

const SECTIONS = [
  ...targetSections({ breakLayouts: process.argv.includes(BREAK_LAYOUT_FLAG) }),
  ...reachabilitySections,
  ...generatorSections,
  ...saveSections,
  ...flowSections,
  ...wendellSections,
  ...sawmillPressSections,
  ...contactPinSections,
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
