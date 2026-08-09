import { generateDungeon, type DungeonData } from '../src/map/DungeonGenerator';
import {
  distanceToRect,
  validateProgression,
  STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT,
  STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
  type InvariantFailure,
  type ProgressionExpectations,
} from '../src/map/progressionValidation';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { level2 } from '../src/levels/level2';
import type { LevelDef } from '../src/levels/types';

/** Maps generated per floor. Enough for a rare failure mode to show up at least once. */
const VERIFY_RUN_COUNT = 50;
/** Failures printed per floor before the rest are summarised. */
const MAX_REPORTED_FAILURES = 20;
const MILLISECONDS_PER_SECOND = 1000;
const PERCENT = 100;
/** Decimal places for a counted quantity, which is always whole. */
const WHOLE_NUMBER_DIGITS = 0;
/** Decimal places every summarised mean is printed to. */
const MEAN_DIGITS = 1;
/** Decimal places a tile distance is printed to; sub-tile precision is noise. */
const DISTANCE_DIGITS = 1;
/**
 * The share of a band-governed floor's stairwells that must sit strictly between
 * the band's two edges.
 *
 * "At least one map manages it" is too weak to catch the regression this exists
 * for: seating ten stairwells by isolation alone still drops a few into the ring
 * by accident, so a floor that had lost the band entirely still cleared that bar
 * on 41 of 50 maps when it was measured. The *share* is what actually separates
 * them — the banded pool puts about two fifths of floor 1's stairwells inside
 * the ring against about a tenth without it, so a threshold between the two
 * catches the loss and leaves generous room for generation luck.
 */
const MIN_BAND_INTERIOR_STAIRWELL_RATE = 0.25;
/**
 * The share of a band-governed floor's stairwells that must have been seated
 * from the banded pool rather than from the widened fallback.
 *
 * I4 only applies its distance ceiling to a stairwell the generator recorded as
 * banded, so this share *is* that check's coverage: were it to reach zero, the
 * ceiling would be enforced on nothing while the run still printed a pass.
 */
const MIN_BAND_SEATED_STAIRWELL_RATE = 0.2;

/** One placed stairwell, as the band rule sees it. */
interface StairwellRecord {
  /** Distance from the last gateway boss room's bounds, in tiles. */
  distanceFromExit: number;
  /** Whether the generator seated it from the banded pool rather than the fallback. */
  fromBand: boolean;
}

interface RunResult {
  failures: InvariantFailure[];
  roomCount: number;
  stairwellCount: number;
  stairwells: StairwellRecord[];
  spacingWaived: boolean;
  attempts: number;
  durationMs: number;
  error: string | null;
}

function summarise(values: number[], fractionDigits = WHOLE_NUMBER_DIGITS): string {
  if (values.length === 0) return 'n/a';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    `min ${min.toFixed(fractionDigits)} / mean ${mean.toFixed(MEAN_DIGITS)} ` +
    `/ max ${max.toFixed(fractionDigits)}`
  );
}

function roomCountOf(data: DungeonData): number {
  return data.mobSpawnPoints.length + data.safeRooms.length + data.bossRooms.length;
}

/**
 * How far each stairwell sits from the last gateway boss room — the quantity the
 * placement band is expressed in — and which pool it was seated from.
 *
 * Measured against the same room `validateProgression` measures I4 against, so a
 * floor whose boss rooms are short of its gauntlet count reports no distances at
 * all rather than measuring against the wrong room; that shortfall is already an
 * I8 failure, so it can never pass unnoticed.
 */
function stairwellRecords(data: DungeonData, gauntletCount: number): StairwellRecord[] {
  if (gauntletCount === 0) return [];
  const lastBossRoom = data.bossRooms[gauntletCount - 1];
  if (lastBossRoom === undefined) return [];
  const banded = data.progressionLayout?.bandedStairwellTiles ?? [];
  return data.stairwellTiles.map((tile) => ({
    distanceFromExit: distanceToRect(tile, lastBossRoom.bounds),
    fromBand: banded.some((bandedTile) => bandedTile.x === tile.x && bandedTile.y === tile.y),
  }));
}

function runFloor(levelDef: LevelDef): RunResult[] {
  const options = { ...dungeonOptionsForLevel(levelDef), size: levelDef.mapSize };
  const expectations: ProgressionExpectations = {
    mapSize: levelDef.mapSize,
    gauntletCount: levelDef.progression?.gauntlets.length ?? 0,
    hasArena: levelDef.hasArena ?? false,
  };

  const results: RunResult[] = [];
  for (let run = 0; run < VERIFY_RUN_COUNT; run++) {
    const startedAt = Date.now();
    try {
      const data = generateDungeon(options);
      results.push({
        failures: validateProgression(data, expectations),
        roomCount: roomCountOf(data),
        stairwellCount: data.stairwellTiles.length,
        stairwells: stairwellRecords(data, expectations.gauntletCount),
        spacingWaived: data.progressionLayout?.stairwellSpacingWaived ?? false,
        attempts: data.progressionLayout?.attempts ?? 1,
        durationMs: Date.now() - startedAt,
        error: null,
      });
    } catch (error) {
      results.push({
        failures: [],
        roomCount: 0,
        stairwellCount: 0,
        stairwells: [],
        spacingWaived: false,
        attempts: 0,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * Whether the placement band governs a floor's stairwells at all.
 *
 * An arena floor seats every stairwell in the pocket behind the drum, whose
 * distance from the last boss's exit is the arena's own geometry rather than a
 * choice, so the generator never applies the ceiling there — and a check that
 * demanded it would be measuring a rule that floor does not live under.
 */
function bandGovernsFloor(levelDef: LevelDef): boolean {
  const gauntletCount = levelDef.progression?.gauntlets.length ?? 0;
  return gauntletCount > 0 && !(levelDef.hasArena ?? false);
}

function isInsideBandInterior(stairwell: StairwellRecord): boolean {
  return (
    stairwell.distanceFromExit > STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT &&
    stairwell.distanceFromExit < STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT
  );
}

/**
 * The coverage half of the band rule: that the band is not merely legal but
 * actually pulling stairwells into the ring a player sweeps first.
 *
 * `validateProgression` only ever rejects a stairwell placed outside the band,
 * and only one it was told came from the banded pool — which says nothing at all
 * on a floor whose stairwells all came from the widened fallback, and the gate
 * would report all-green having measured nothing. Measured as a share of
 * stairwells rather than of maps, because seating ten of them by isolation alone
 * drops a few into the ring by luck: it is the share that separates a banded
 * floor from an unbanded one, not whether any single map managed it.
 */
function reportStairwellBand(levelDef: LevelDef, results: RunResult[]): boolean {
  if (!bandGovernsFloor(levelDef)) {
    console.log('  stairwell band : n/a — this floor seats its stairs behind the arena');
    return true;
  }

  const generated = results.filter((result) => result.error === null);
  const stairwells = generated.flatMap((result) => result.stairwells);
  const distances = stairwells.map((stairwell) => stairwell.distanceFromExit);
  console.log(`  exit distance  : ${summarise(distances, DISTANCE_DIGITS)} tiles`);

  const unwaived = generated
    .filter((result) => !result.spacingWaived)
    .flatMap((result) => result.stairwells);
  const bandSeated = unwaived.filter((stairwell) => stairwell.fromBand).length;
  const bandSeatedRate = bandSeated / Math.max(unwaived.length, 1);
  console.log(
    `  band-seated    : ${bandSeated}/${unwaived.length} stairwells ` +
      `(${(bandSeatedRate * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}%) — the ones I4's ceiling governs`,
  );

  const interiorMaps = generated.filter((result) => result.stairwells.some(isInsideBandInterior));
  const interiorStairwells = stairwells.filter(isInsideBandInterior).length;
  const interiorRate = interiorStairwells / Math.max(stairwells.length, 1);
  console.log(
    `  band interior  : ${interiorStairwells}/${stairwells.length} stairwells ` +
      `(${(interiorRate * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}%), on ${interiorMaps.length}/${generated.length} maps`,
  );

  let bandIsGreen = true;
  if (distances.length === 0) {
    console.log('  FAIL: no stairwell distances were measured, so nothing here was checked');
    bandIsGreen = false;
  }
  if (bandSeatedRate < MIN_BAND_SEATED_STAIRWELL_RATE) {
    console.log(
      `  FAIL: only ${(bandSeatedRate * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}% of stairwells were seated from the ` +
        `banded pool, under the ${(MIN_BAND_SEATED_STAIRWELL_RATE * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}% this ` +
        "floor produces — I4's distance ceiling is enforcing next to nothing",
    );
    bandIsGreen = false;
  }
  if (interiorMaps.length === 0) {
    console.log(
      `  FAIL: no map put a stairwell strictly between ${STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT} ` +
        `and ${STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT} tiles from the exit — placement has ` +
        'collapsed back onto the band edges',
    );
    bandIsGreen = false;
  }
  if (interiorRate < MIN_BAND_INTERIOR_STAIRWELL_RATE) {
    console.log(
      `  FAIL: only ${(interiorRate * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}% of stairwells sit inside the band, ` +
        `under the ${(MIN_BAND_INTERIOR_STAIRWELL_RATE * PERCENT).toFixed(WHOLE_NUMBER_DIGITS)}% a banded pool ` +
        'produces — the placement is choosing by isolation again',
    );
    bandIsGreen = false;
  }
  return bandIsGreen;
}

function reportFloor(levelDef: LevelDef, results: RunResult[]): boolean {
  const expectedStairwells = levelDef.numStairwells;
  const thrown = results.filter((r) => r.error !== null);
  const failed = results.filter((r) => r.error === null && r.failures.length > 0);
  const passed = results.length - thrown.length - failed.length;

  console.log(`\n── ${levelDef.id} (${levelDef.name}) ──`);
  console.log(`  maps generated : ${results.length}`);
  console.log(`  passed         : ${passed}`);
  console.log(`  failed         : ${failed.length}`);
  console.log(`  threw          : ${thrown.length}`);
  console.log(`  rooms          : ${summarise(results.map((r) => r.roomCount))}`);
  console.log(`  stairwells     : ${summarise(results.map((r) => r.stairwellCount))}`);
  console.log(`  map attempts   : ${summarise(results.map((r) => r.attempts))}`);
  console.log(`  generation ms  : ${summarise(results.map((r) => r.durationMs))}`);
  const bandIsGreen = reportStairwellBand(levelDef, results);

  if (expectedStairwells !== undefined) {
    const short = results.filter((r) => r.error === null && r.stairwellCount < expectedStairwells);
    if (short.length > 0) {
      const rate = ((short.length / results.length) * PERCENT).toFixed(WHOLE_NUMBER_DIGITS);
      console.log(
        `  NOTE: ${short.length} map(s) (${rate}%) placed fewer than the requested ${expectedStairwells} stairwells`,
      );
    }
  }

  const failureCounts = new Map<string, number>();
  const examples: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.error !== null) {
      examples.push(`  [map ${index}] THREW: ${result.error}`);
      failureCounts.set('THROW', (failureCounts.get('THROW') ?? 0) + 1);
      continue;
    }
    for (const failure of result.failures) {
      failureCounts.set(failure.id, (failureCounts.get(failure.id) ?? 0) + 1);
      examples.push(`  [map ${index}] ${failure.id}: ${failure.message}`);
    }
  }

  if (failureCounts.size > 0) {
    console.log('  failures by invariant:');
    for (const [id, count] of [...failureCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${id}: ${count}`);
    }
    for (const line of examples.slice(0, MAX_REPORTED_FAILURES)) console.log(line);
    if (examples.length > MAX_REPORTED_FAILURES) {
      console.log(`  … and ${examples.length - MAX_REPORTED_FAILURES} more`);
    }
  }

  return thrown.length === 0 && failed.length === 0 && bandIsGreen;
}

const startedAt = Date.now();
const VERIFIED_FLOORS: readonly LevelDef[] = [level1, level2];
let allGreen = true;
for (const levelDef of VERIFIED_FLOORS) {
  allGreen = reportFloor(levelDef, runFloor(levelDef)) && allGreen;
}
// Every floor waiving itself out of the band would leave the band assertions
// above with nothing to say while still printing a pass.
if (!VERIFIED_FLOORS.some(bandGovernsFloor)) {
  console.log('\nFAIL: no verified floor is governed by the stairwell band');
  allGreen = false;
}
const elapsedSeconds = ((Date.now() - startedAt) / MILLISECONDS_PER_SECOND).toFixed(1);
console.log(`\n${allGreen ? 'PASS' : 'FAIL'} — ${elapsedSeconds}s total\n`);
process.exit(allGreen ? 0 : 1);
