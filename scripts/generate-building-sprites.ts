/**
 * Bakes every building exterior in the Over City.
 *
 *   npm run gen:buildings            bake all fifteen
 *   npm run gen:buildings -- --only=sleeping_cat_inn
 *
 * ## The order of operations is the whole safety story
 *
 * Two things here can take the game down at boot rather than merely look wrong.
 * `SpriteLoader` builds its footprint and doorway tables from the manifest at
 * module load and **throws** when a building's painted door falls outside the
 * walkable opening its blocked regions leave; `placeSpriteBuilding` throws when
 * a building derives no doorway at all. Neither failure is visible in a picture.
 *
 * So: every sheet is painted and every pixel-level gate runs before anything
 * reaches disk. The doorway is the one gate that cannot run first, because the
 * only honest way to check it is to ask `SpriteLoader` — and `SpriteLoader`
 * reads the manifest at module load, so the manifest has to exist. That gate
 * therefore runs *after* the write, against a snapshot of everything the write
 * touched, and restores the snapshot before exiting non-zero. The tree is never
 * left describing art that would not boot.
 *
 * ## What this generator owns
 *
 * Only the keys in `BUILDING_SPECS`. `overworld_main_tower` and `hoarders_room`
 * are read from the existing manifest and written back unchanged — the tower is
 * the only entry with a `tileTypeId` and a non-zero `tileY`, and it is not a
 * facade. The village-house and old-tavern keys are left in place too: they are
 * still referenced until the town plan is repointed, and a manifest entry
 * pointing at a file `loadSprites` cannot find fails silently.
 */

import { createCanvas } from 'canvas';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILDING_SPECS } from './buildinggen/buildings.js';
import {
  bake,
  readFixture,
  runPixelGates,
  type BakedBuilding,
  type ManifestEntry,
} from './buildinggen/bake.js';
import { GateResults, gateDoorway, gateWrittenSheetGeometry } from './buildinggen/gates.js';

const BUILDINGS_DIR = resolve('src/images/environment/buildings');
const MANIFEST_PATH = resolve(BUILDINGS_DIR, 'manifest.json');

/** Art in this directory that is not a facade and that this generator must not touch. */
const PRESERVED_KEYS = ['overworld_main_tower', 'hoarders_room'] as const;

const FLAG_SYNTAX_LENGTH = 3;

function parseFlag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match === undefined ? undefined : match.slice(name.length + FLAG_SYNTAX_LENGTH);
}

// ── writing, and undoing the write ─────────────────────────────────────────

interface WriteSnapshot {
  readonly manifestText: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly before: Buffer | null }>;
}

function mergeManifest(entries: ReadonlyMap<string, ManifestEntry>): string {
  const existing: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (typeof existing !== 'object' || existing === null) {
    throw new Error('buildings manifest is not an object');
  }
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, entry] of entries) merged[key] = entry;
  for (const key of PRESERVED_KEYS) {
    if (merged[key] === undefined) {
      throw new Error(
        `'${key}' has vanished from the buildings manifest; this generator preserves it and must ` +
          'never be the thing that removed it',
      );
    }
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Snapshots everything the write is about to touch, then writes.
 *
 * The snapshot is taken — and the merged manifest text is built — *before* the
 * first byte lands, so there is no window in which files have changed and no
 * record exists of what they were. `mergeManifest` can throw (a malformed
 * manifest, a preserved key gone missing), and doing that after fifteen PNGs
 * were already overwritten would leave a directory nothing could put back.
 */
function writeAll(baked: ReadonlyArray<BakedBuilding>): WriteSnapshot {
  const manifestText = readFileSync(MANIFEST_PATH, 'utf8');
  const files = baked.map((building) => {
    const path = resolve(BUILDINGS_DIR, building.spec.file);
    return { path, before: existsSync(path) ? readFileSync(path) : null };
  });
  const entries = new Map(baked.map((building) => [building.spec.key, building.entry]));
  const mergedManifest = mergeManifest(entries);
  const snapshot: WriteSnapshot = { manifestText, files };

  // Past this point a throw must not escape without unwinding: a half-written
  // directory describes art that does not exist.
  try {
    for (const building of baked) {
      writeFileSync(
        resolve(BUILDINGS_DIR, building.spec.file),
        building.sheet.toBuffer('image/png'),
      );
    }
    writeFileSync(MANIFEST_PATH, mergedManifest);
  } catch (error) {
    undoWrite(snapshot);
    throw error;
  }
  return snapshot;
}

/**
 * Puts back everything `writeAll` touched.
 *
 * Every step is individually guarded, because this runs on the path where
 * something has *already* gone wrong and a second failure here would strand the
 * directory half-restored. The specific trap: a write that failed part-way
 * leaves the not-yet-written buildings with no file on disk at all, and an
 * unguarded `unlinkSync` on one of those throws `ENOENT` — which would abandon
 * every remaining file, skip the manifest restore entirely, and replace the
 * original error with a misleading one.
 */
function undoWrite(snapshot: WriteSnapshot): void {
  const unrestored: string[] = [];
  for (const file of snapshot.files) {
    try {
      if (file.before === null) {
        if (existsSync(file.path)) unlinkSync(file.path);
      } else {
        writeFileSync(file.path, file.before);
      }
    } catch {
      unrestored.push(file.path);
    }
  }
  try {
    writeFileSync(MANIFEST_PATH, snapshot.manifestText);
  } catch {
    unrestored.push(MANIFEST_PATH);
  }
  if (unrestored.length > 0) {
    console.error(
      `Rollback could not restore: ${unrestored.join(', ')}. Re-run the bake once the underlying ` +
        'write problem is fixed.',
    );
  }
}

// ── the doorway gate, which needs the manifest on disk ─────────────────────

const GATE_DEVICE_PIXEL_RATIO = 2;

/**
 * Asks the game's own loader where each door ended up.
 *
 * Runs last and against real files because `SpriteLoader` reads the manifest at
 * module load and there is no seam to inject one through. A reimplementation of
 * its derivation here would freeze the reimplementation's bugs, and this is the
 * one contract whose failure mode is the game refusing to boot.
 */
async function runDoorwayGate(
  results: GateResults,
  baked: ReadonlyArray<BakedBuilding>,
): Promise<void> {
  const nodeCanvas = await import('canvas');
  const globals: { Image?: unknown; document?: unknown; window?: unknown } = globalThis;
  globals.Image = nodeCanvas.Image;
  // Retina, so `shouldDownscaleForLowEndDevice` leaves the sheets at the size
  // they were baked. Shimmed even though nothing reads it on the current path:
  // `render-town.ts` was missing this exact global and died on it the first time
  // a sheet grew large enough to reach that check.
  globals.window = { devicePixelRatio: GATE_DEVICE_PIXEL_RATIO };
  globals.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`building generator cannot create <${tag}>`);
      return createCanvas(1, 1);
    },
  };
  const { getSpriteDoorwayByKey } = await import('../src/core/SpriteLoader');
  for (const building of baked) {
    gateDoorway(results, building.spec, getSpriteDoorwayByKey(building.spec.key));
  }
  await gateWrittenGeometry(results, baked);
}

/**
 * Re-reads the manifest and the PNGs from disk and checks they agree.
 *
 * Deliberately reads the files rather than the objects that produced them. Every
 * check that runs before the write derives the sheet's size and the manifest's
 * numbers from one expression, so none of them can see a frame-size drift; this
 * loads the JSON text and decodes the image, which is what the game will do.
 */
async function gateWrittenGeometry(
  results: GateResults,
  baked: ReadonlyArray<BakedBuilding>,
): Promise<void> {
  const { loadImage } = await import('canvas');
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    results.fail('manifest', 'written-geometry', 'the written manifest is not an object');
    return;
  }
  const manifest: Record<string, unknown> = { ...parsed };
  for (const building of baked) {
    const entry = manifest[building.spec.key];
    if (typeof entry !== 'object' || entry === null) {
      results.fail(
        building.spec.key,
        'written-geometry',
        'the written manifest has no entry for this building, so nothing can be checked against it',
      );
      continue;
    }
    const fields: Record<string, unknown> = { ...entry };
    const states: Record<string, unknown> =
      typeof fields.states === 'object' && fields.states !== null ? { ...fields.states } : {};
    const life: Record<string, unknown> =
      typeof states.life === 'object' && states.life !== null ? { ...states.life } : {};
    if (
      typeof fields.frameWidth !== 'number' ||
      typeof fields.frameHeight !== 'number' ||
      typeof fields.path !== 'string' ||
      typeof life.frameCount !== 'number'
    ) {
      results.fail(
        building.spec.key,
        'written-geometry',
        'the written manifest entry is missing a frame size or a life frame count',
      );
      continue;
    }
    const image = await loadImage(resolve('src/images', fields.path));
    gateWrittenSheetGeometry(
      results,
      building.spec,
      {
        frameWidth: fields.frameWidth,
        frameHeight: fields.frameHeight,
        lifeFrameCount: life.frameCount,
      },
      image.width,
      image.height,
    );
  }
}

// ── driver ─────────────────────────────────────────────────────────────────

const only = parseFlag('only');
const specs =
  only === undefined ? BUILDING_SPECS : BUILDING_SPECS.filter((spec) => spec.key === only);
if (specs.length === 0) throw new Error(`--only=${only ?? ''} matched no building`);

const fixture = readFixture();
const results = new GateResults();
const baked = specs.map(bake);
for (const building of baked) runPixelGates(results, building, fixture);

function reportAndExit(): never {
  for (const line of results.reports) {
    console.log(`  ${line.key.padEnd(22)} ${line.gate.padEnd(18)} ${line.detail}`);
  }
  if (results.failures.length > 0) {
    console.error('\nGATE FAILURES:');
    for (const failure of results.failures) {
      console.error(`  ✗ ${failure.key} / ${failure.gate}: ${failure.detail}`);
    }
    process.exit(1);
  }
  console.log(`\nBaked ${baked.length} building(s) into ${BUILDINGS_DIR}`);
  process.exit(0);
}

if (results.failures.length > 0) {
  console.error('Nothing was written: the bake failed its pixel gates.');
  reportAndExit();
}

const snapshot = writeAll(baked);

// `SpriteLoader` asserts on the doorway at *module load*, so a genuinely
// mismatched building does not come back as a recorded failure — it throws out
// of the dynamic import. Both paths have to unwind, or the tree is left holding
// exactly the sheets and manifest that make the game refuse to boot, which is
// the one outcome this whole ordering exists to prevent.
try {
  await runDoorwayGate(results, baked);
} catch (error) {
  undoWrite(snapshot);
  console.error(
    'The write was rolled back: loading the new manifest through SpriteLoader threw.\n' +
      'That is the assertion a building whose painted door falls outside its own walkable\n' +
      'opening trips at module load, and it would have taken the game down at boot.',
  );
  throw error;
}

if (results.failures.length > 0) {
  undoWrite(snapshot);
  const gates = [...new Set(results.failures.map((failure) => failure.gate))].join(', ');
  console.error(
    `The write was rolled back: the sheets on disk failed ${gates}. These are the checks that ` +
      'can only run against written files, so the art is gone again and the directory is as it was.',
  );
}
reportAndExit();
