import { generateDungeon, type DungeonData } from '../src/map/DungeonGenerator';
import {
  validateProgression,
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

interface RunResult {
  failures: InvariantFailure[];
  roomCount: number;
  stairwellCount: number;
  attempts: number;
  durationMs: number;
  error: string | null;
}

function summarise(values: number[]): string {
  if (values.length === 0) return 'n/a';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `min ${min} / mean ${mean.toFixed(1)} / max ${max}`;
}

function roomCountOf(data: DungeonData): number {
  return data.mobSpawnPoints.length + data.safeRooms.length + data.bossRooms.length;
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
        attempts: data.progressionLayout?.attempts ?? 1,
        durationMs: Date.now() - startedAt,
        error: null,
      });
    } catch (error) {
      results.push({
        failures: [],
        roomCount: 0,
        stairwellCount: 0,
        attempts: 0,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
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

  if (expectedStairwells !== undefined) {
    const short = results.filter((r) => r.error === null && r.stairwellCount < expectedStairwells);
    if (short.length > 0) {
      const rate = ((short.length / results.length) * PERCENT).toFixed(0);
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

  return thrown.length === 0 && failed.length === 0;
}

const startedAt = Date.now();
let allGreen = true;
for (const levelDef of [level1, level2]) {
  allGreen = reportFloor(levelDef, runFloor(levelDef)) && allGreen;
}
const elapsedSeconds = ((Date.now() - startedAt) / MILLISECONDS_PER_SECOND).toFixed(1);
console.log(`\n${allGreen ? 'PASS' : 'FAIL'} — ${elapsedSeconds}s total\n`);
process.exit(allGreen ? 0 : 1);
