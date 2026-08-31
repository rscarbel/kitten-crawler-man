#!/usr/bin/env tsx
/**
 * Builds the alphabet of floor art seeds the game is allowed to draw from.
 *
 * The browser cannot gate anything: it paints a floor's art and draws it, and
 * there is no `process.exit(1)` on the far side. Sampling the seed space offline
 * and hoping the rest of it behaves is the usual answer, and it leaves a hole —
 * the seeds that were not sampled are the ones that ship.
 *
 * So the game does not draw from the whole 32-bit space. It draws from this
 * alphabet, every member of which has been measured against the reviewed art in
 * **every domain that carries a floor seed** — the ground materials, the seeded
 * prop families, and the building facades. `npm run verify:floor-sweep`
 * re-measures all of them. The gate is exhaustive over what can ship rather than
 * a sample of what might.
 *
 * A rejected candidate is not a bug. With only a few Worley cells to a patch,
 * some seeds genuinely lay a mortar line along the patch joint or flatten a
 * floor's stones into one tone; and a facade or two sits close enough to a
 * threshold that a shift in its weathering can cross it. Those seeds simply do
 * not enter the alphabet.
 *
 * The domains are judged cheapest first and the judgement stops at the first
 * failure, because the ground rejects roughly a third of candidates and there is
 * no reason to paint fifteen facades for one of them.
 *
 * Run: npm run gen:floor-art-seeds
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_FLOOR_ART_SEED } from '../src/map/ground/floorArtSeed.js';
import { candidateArtSeed, judgeArtSeed, reviewedProfile } from './groundSeedGates.js';
import { judgePropArtSeed } from './propSeedGates.js';
import { judgeFacadeArtSeed, reviewedFacades } from './facadeSeedGates.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';

/**
 * How many looks a floor can have.
 *
 * Far more than a player will exhaust — a run touches four floors — while small
 * enough that every one of them can be re-verified in a few minutes. Raising it
 * costs sweep time linearly and buys variety nobody will see.
 */
const ALPHABET_SIZE = 128;

/**
 * Candidates tried before the builder gives up.
 *
 * Bounded so a change that makes most seeds unshippable — a painter that stopped
 * wrapping, a limit tightened too far — reports that rather than searching for
 * ever.
 */
const MAX_CANDIDATES = 600;

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/map/ground/artSeedAlphabet.ts',
);

// The prop and facade painters stack the game's own crate and barrel art, so
// those sheets have to be loaded before any candidate is judged.
await loadGameSpritesInNode();

const baseline = reviewedProfile();
const facadeBaseline = reviewedFacades();
for (const note of facadeBaseline.notes) console.log(`  note  ${note}`);

/**
 * Every reason one candidate is unshippable, cheapest domain first.
 *
 * Stops at the first domain that rejects: the ground turns away about a third of
 * candidates on its own, and painting fifteen facades to confirm a seed that has
 * already lost is most of this script's runtime.
 */
function judgeCandidate(seed: number): ReadonlyArray<string> {
  const ground = judgeArtSeed(seed, baseline).failures;
  if (ground.length > 0) return ground;
  const props = judgePropArtSeed(seed).failures;
  if (props.length > 0) return props;
  return judgeFacadeArtSeed(seed, facadeBaseline).failures;
}
const accepted: number[] = [];
const rejections = new Map<string, number>();
let candidatesTried = 0;

// The reviewed look is a member of the alphabet, not a thing outside it: it is
// the art every material was signed off against, and there is no reason a
// playthrough should be unable to draw it.
accepted.push(DEFAULT_FLOOR_ART_SEED);

for (let index = 0; index < MAX_CANDIDATES && accepted.length < ALPHABET_SIZE; index++) {
  const seed = candidateArtSeed(index);
  if (seed === DEFAULT_FLOOR_ART_SEED || accepted.includes(seed)) continue;
  candidatesTried++;
  const failures = judgeCandidate(seed);
  if (failures.length === 0) {
    accepted.push(seed);
    continue;
  }
  for (const failure of failures) {
    const blamed = failure.slice(0, failure.indexOf(':'));
    rejections.set(blamed, (rejections.get(blamed) ?? 0) + 1);
  }
}

console.log(
  `[ground-art-seeds] accepted ${accepted.length} of ${candidatesTried} candidates tried`,
);
const byCount = [...rejections].sort((a, b) => b[1] - a[1]);
for (const [material, count] of byCount) {
  console.log(`  rejected by ${material.padEnd(18)} ${count}`);
}

if (accepted.length < ALPHABET_SIZE) {
  console.error(
    `\n[ground-art-seeds] FAIL: only ${accepted.length} of ${ALPHABET_SIZE} seeds passed within ` +
      `${MAX_CANDIDATES} candidates. Either a painter has stopped wrapping or a limit in ` +
      `scripts/groundSeedGates.ts is tighter than the art can hold.`,
  );
  process.exit(1);
}

const SEEDS_PER_LINE = 6;
const lines: string[] = [];
for (let index = 0; index < accepted.length; index += SEEDS_PER_LINE) {
  lines.push(`  ${accepted.slice(index, index + SEEDS_PER_LINE).join(', ')},`);
}

writeFileSync(
  OUTPUT_PATH,
  `/**
 * Every look a floor is allowed to have.
 *
 * Generated by \`npm run gen:floor-art-seeds\` and re-measured in full by
 * \`npm run verify:floor-sweep\`. Do not edit by hand: a seed in this list has
 * been painted and checked against the reviewed art in every domain that carries
 * a floor seed — the ground materials for wrap seams, brightness drift, texture
 * energy and wall-to-floor separation; the seeded prop families for art clipped
 * by its own cell; and the building facades for their silhouette and every pixel
 * gate the reviewed art passes. A seed added without that measurement is a floor
 * nobody has looked at.
 *
 * The first entry is the reviewed art itself — the sheets exactly as they were
 * baked when they still shipped as PNGs.
 */
export const FLOOR_ART_SEEDS: ReadonlyArray<number> = [
${lines.join('\n')}
];
`,
);
console.log(`[ground-art-seeds] wrote ${OUTPUT_PATH}`);
