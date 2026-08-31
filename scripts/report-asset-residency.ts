/**
 * What a floor's sprite sheets cost in memory, group by group.
 *
 * Disk size is what a build report shows and it is the wrong number: a PNG is
 * compressed on disk and four bytes per pixel once the browser has decoded it,
 * and decoded residency is what kills a phone tab. This reads each sheet's IHDR
 * for its true dimensions and reports both, per asset group and per floor.
 *
 *   npx tsx scripts/report-asset-residency.ts
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { ASSET_GROUPS, type AssetGroup } from '../src/core/assetGroups.js';

/** Bytes of PNG header before the IHDR width/height pair. */
const IHDR_DIMENSION_OFFSET = 16;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const IMAGE_ROOT = 'src/images';

/** Bytes between the IHDR width field and the height field beside it. */
const IHDR_HEIGHT_OFFSET = 4;

/** Column widths the group table lines up on. */
const GROUP_COLUMN = 24;
const SHEETS_COLUMN = 4;
const DISK_COLUMN = 9;
const PAINTED_COLUMN = 7;
const DECODED_COLUMN = 10;

interface SheetSize {
  readonly disk: number;
  readonly decoded: number;
}

/**
 * Every `manifest.json` under `src/images`, found by walking the tree rather
 * than listed: a hard-coded list silently under-reports the day somebody adds a
 * directory, and silently names a deleted one forever.
 */
function manifestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...manifestFiles(full));
    else if (entry.name === 'manifest.json') found.push(full);
  }
  return found;
}

/**
 * A manifest entry with no `path` is painted at runtime rather than fetched (the
 * generated ground tilesets). It costs nothing on disk and it is only resident
 * while the floor that painted it is, but the pixels are as real as any sheet's
 * — so its decoded size is computed from the geometry the manifest declares
 * rather than read out of a PNG header.
 */
interface ManifestSheet {
  readonly path: string | null;
  readonly decoded: number;
}

function numberField(fields: Record<string, unknown>, name: string): number {
  const value = fields[name];
  return typeof value === 'number' ? value : 0;
}

function paintedDecodedBytes(fields: Record<string, unknown>): number {
  const states = fields.states;
  if (typeof states !== 'object' || states === null) return 0;
  let columns = 0;
  let rows = 0;
  // Read the way `sheetSizePx` reads a sheet rather than by counting states: a
  // layout that puts an idle frame beside the animation row it underlies
  // occupies one row, not two, and reporting it as two would overstate the
  // biggest number in this table by nearly half. Restated here rather than
  // imported because this walks raw JSON off disk, which is the point — it
  // reports what shipped, not what the loader believes.
  for (const state of Object.values({ ...states })) {
    if (typeof state !== 'object' || state === null) continue;
    const declared = { ...state };
    columns = Math.max(
      columns,
      numberField(declared, 'colOffset') + numberField(declared, 'frameCount'),
    );
    rows = Math.max(rows, numberField(declared, 'row') + 1);
  }
  return (
    columns *
    numberField(fields, 'frameWidth') *
    rows *
    numberField(fields, 'frameHeight') *
    BYTES_PER_PIXEL
  );
}

function manifestEntries(): Map<string, ManifestSheet> {
  const sheets = new Map<string, ManifestSheet>();
  for (const full of manifestFiles(resolve(IMAGE_ROOT))) {
    const parsed: unknown = JSON.parse(readFileSync(full, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) continue;
    const entries: Record<string, unknown> = { ...parsed };
    for (const [key, entry] of Object.entries(entries)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const fields: Record<string, unknown> = { ...entry };
      const path = fields.path;
      sheets.set(
        key,
        typeof path === 'string'
          ? { path, decoded: 0 }
          : { path: null, decoded: paintedDecodedBytes(fields) },
      );
    }
  }
  return sheets;
}

function sizeOf(relativePath: string): SheetSize | null {
  const full = resolve(IMAGE_ROOT, relativePath);
  if (!existsSync(full)) return null;
  const bytes = readFileSync(full);
  const width = bytes.readUInt32BE(IHDR_DIMENSION_OFFSET);
  const height = bytes.readUInt32BE(IHDR_DIMENSION_OFFSET + IHDR_HEIGHT_OFFSET);
  return { disk: bytes.length, decoded: width * height * BYTES_PER_PIXEL };
}

function megabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
}

const sheets = manifestEntries();
const missing: string[] = [];
let totalDisk = 0;
let totalDecoded = 0;

const groupNames: AssetGroup[] = Object.keys(ASSET_GROUPS).filter(
  (name): name is AssetGroup => name in ASSET_GROUPS,
);

console.log('group                    sheets      disk     decoded   painted');
for (const group of groupNames) {
  let disk = 0;
  let decoded = 0;
  let sheetCount = 0;
  let paintedCount = 0;
  for (const key of ASSET_GROUPS[group]) {
    const sheet = sheets.get(key);
    if (sheet === undefined) {
      missing.push(`${group}: "${key}" is in no manifest`);
      continue;
    }
    if (sheet.path === null) {
      decoded += sheet.decoded;
      paintedCount++;
      continue;
    }
    const size = sizeOf(sheet.path);
    if (size === null) {
      missing.push(`${group}: "${key}" points at a missing file (${sheet.path})`);
      continue;
    }
    disk += size.disk;
    decoded += size.decoded;
    sheetCount++;
  }
  totalDisk += disk;
  totalDecoded += decoded;
  console.log(
    `${group.padEnd(GROUP_COLUMN)} ${String(sheetCount).padStart(SHEETS_COLUMN)}  ` +
      `${megabytes(disk).padStart(DISK_COLUMN)}  ${megabytes(decoded).padStart(DECODED_COLUMN)}` +
      `  ${String(paintedCount).padStart(PAINTED_COLUMN)}`,
  );
}

console.log(
  `${'TOTAL (groups)'.padEnd(GROUP_COLUMN)}       ` +
    `${megabytes(totalDisk).padStart(DISK_COLUMN)}  ${megabytes(totalDecoded).padStart(DECODED_COLUMN)}`,
);

if (missing.length > 0) {
  console.error('\nUnresolved group members:');
  for (const problem of missing) console.error(`  ${problem}`);
  process.exitCode = 1;
}
