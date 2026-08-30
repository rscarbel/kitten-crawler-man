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

function manifestEntries(): Map<string, string> {
  const paths = new Map<string, string>();
  for (const full of manifestFiles(resolve(IMAGE_ROOT))) {
    const parsed: unknown = JSON.parse(readFileSync(full, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) continue;
    const entries: Record<string, unknown> = { ...parsed };
    for (const [key, entry] of Object.entries(entries)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const fields: Record<string, unknown> = { ...entry };
      const path = fields.path;
      if (typeof path === 'string') paths.set(key, path);
    }
  }
  return paths;
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

const paths = manifestEntries();
const missing: string[] = [];
let totalDisk = 0;
let totalDecoded = 0;

const groupNames: AssetGroup[] = Object.keys(ASSET_GROUPS).filter(
  (name): name is AssetGroup => name in ASSET_GROUPS,
);

console.log('group                    sheets      disk     decoded');
for (const group of groupNames) {
  let disk = 0;
  let decoded = 0;
  let sheets = 0;
  for (const key of ASSET_GROUPS[group]) {
    const path = paths.get(key);
    if (path === undefined) {
      missing.push(`${group}: "${key}" is in no manifest`);
      continue;
    }
    const size = sizeOf(path);
    if (size === null) {
      missing.push(`${group}: "${key}" points at a missing file (${path})`);
      continue;
    }
    disk += size.disk;
    decoded += size.decoded;
    sheets++;
  }
  totalDisk += disk;
  totalDecoded += decoded;
  console.log(
    `${group.padEnd(GROUP_COLUMN)} ${String(sheets).padStart(SHEETS_COLUMN)}  ` +
      `${megabytes(disk).padStart(DISK_COLUMN)}  ${megabytes(decoded).padStart(DECODED_COLUMN)}`,
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
