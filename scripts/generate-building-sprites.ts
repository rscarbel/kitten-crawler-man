#!/usr/bin/env tsx
/**
 * Bakes the Over City's building exteriors for review, at a chosen art seed.
 *
 *   npm run gen:buildings                     every facade, unseeded
 *   npm run gen:buildings -- 3                every facade under art seed 3
 *   npm run gen:buildings -- --only=sleeping_cat_inn
 *
 * The shipped game paints these sheets for itself when it enters the town, from
 * the plans in `src/sprites/buildinggen/runtimeBuildingSheets.ts`, with the
 * floor's own art seed folded into each spec's. Nothing written here is loaded
 * by anything: this is the eye's copy, and it goes under `preview/props/`
 * alongside the other families rather than into `src/images/`.
 *
 * ## Nothing here can take the game down, and that is new
 *
 * This used to write the facades and their manifest, which made ordering the
 * whole safety story: `SpriteLoader` builds its footprint and doorway tables
 * from the manifest at module load and **throws** when a building's painted door
 * falls outside the walkable opening its blocked regions leave, so a bad bake
 * left a tree that would not boot, and the doorway gate could only run after the
 * write with a snapshot standing by to undo it.
 *
 * The manifest is checked-in data now and this writes only preview art, so that
 * gate simply runs first, against the entry the game itself reads. Two checks
 * carry what the ordering used to: `manifestEntryProblems` reports a spec that
 * has drifted from its entry, and the doorway gate asks `SpriteLoader` for the
 * opening it derives from that entry and requires the spec's door to sit in it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUILDING_SPECS } from '../src/sprites/buildinggen/buildings.js';
import { buildingWeatherSeed } from '../src/sprites/buildinggen/runtimeBuildingSheets.js';
import { getSpriteDoorwayByKey } from '../src/core/SpriteLoader.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { BUILDING_SALT, floorArtSubSeed, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';
import { bake, readFixture, runPixelGates } from './buildinggen/bake.js';
import { GateResults, gateDoorway } from './buildinggen/gates.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PROP_PREVIEW_ROOT } from './propSheetBake.js';

// The painters allocate their own scratch surfaces through `allocCanvas`, which
// has no browser to allocate from here.
installCanvasGlobals();

const OUT_DIR = resolve(PROP_PREVIEW_ROOT, 'buildings');

/** Length of the `--` prefix plus the `=` separator around a flag name. */
const FLAG_SYNTAX_LENGTH = 3;

function parseFlag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match === undefined ? undefined : match.slice(name.length + FLAG_SYNTAX_LENGTH);
}

const SEED_ARGUMENT_INDEX = 2;
const SEED_RADIX = 10;
const seedArgument = process.argv[SEED_ARGUMENT_INDEX];
const seedIndex =
  seedArgument === undefined || seedArgument.startsWith('--')
    ? 0
    : Number.parseInt(seedArgument, SEED_RADIX);
if (!Number.isFinite(seedIndex)) {
  throw new Error(`art seed index must be a number, got "${seedArgument ?? ''}"`);
}
setFloorArtSeed(FLOOR_ART_SEEDS[Math.abs(seedIndex) % FLOOR_ART_SEEDS.length]);

// Seeded per building through the same fork the runtime uses, so a reviewer is
// looking at the art a floor drawing this seed would actually paint. The seed is
// a *weathering* term rather than a replacement spec: it reaches a facade's
// grain and staining and nothing its footprint or its animation is measured on.
const seedTerm = floorArtSubSeed(BUILDING_SALT);
const only = parseFlag('only');
const facades = BUILDING_SPECS.map((spec, index) => ({
  spec,
  weatherSeed: buildingWeatherSeed(index, seedTerm),
})).filter(({ spec }) => only === undefined || spec.key === only);
if (facades.length === 0) throw new Error(`--only=${only ?? ''} matched no building`);

const fixture = readFixture();
const results = new GateResults();
const baked = facades.map(({ spec, weatherSeed }) => bake(spec, weatherSeed));
for (const building of baked) {
  runPixelGates(results, building, fixture);
  gateDoorway(results, building.spec, getSpriteDoorwayByKey(building.spec.key));
}

// Written before the failures are reported, and unconditionally: a red gate is
// exactly when a reviewer wants the picture most, and nothing on disk here is
// loaded by the game.
mkdirSync(OUT_DIR, { recursive: true });
for (const building of baked) {
  writeFileSync(resolve(OUT_DIR, building.spec.file), building.sheet.toBuffer('image/png'));
}

const KEY_COLUMN = 22;
const GATE_COLUMN = 18;
for (const line of results.reports) {
  console.log(`  ${line.key.padEnd(KEY_COLUMN)} ${line.gate.padEnd(GATE_COLUMN)} ${line.detail}`);
}
console.log(`\nwrote ${baked.length} sheet(s) to ${OUT_DIR}`);

if (results.failures.length > 0) {
  console.error('\nGATE FAILURES:');
  for (const failure of results.failures) {
    console.error(`  ✗ ${failure.key} / ${failure.gate}: ${failure.detail}`);
  }
  process.exit(1);
}
console.log('Every building gate passed.');
