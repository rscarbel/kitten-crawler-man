/**
 * Freezes the derived tile geometry of every building exterior sprite.
 *
 * The town plan hard-codes plot positions against the *derived* footprint of
 * each building's art — width is `ceil(frameWidth / tileScale)` and nothing in
 * the plan restates it — so a redraw that lands one tile wider silently trips
 * `assertTownPlotsDoNotOverlap` several layers away from the change that caused
 * it. This writes the current numbers to a fixture so replacement art can be
 * diffed against them directly.
 *
 * This runs **once**, before the art it records is replaced. From then on the
 * fixture and the archived PNGs beside it are committed artefacts: the script
 * refuses to run again rather than overwrite them with the replacements.
 *
 * The numbers come from `SpriteLoader`'s own derivation rather than from a
 * reimplementation here: the doorway in particular is the product of two
 * independent derivations (a pixel-space gap between region rectangles, clamped
 * into a tile-space run at a half-coverage threshold), and a second copy of that
 * would freeze the copy's bugs rather than the shipped behaviour.
 *
 *   npx tsx scripts/snapshot-building-footprints.ts
 */

import { createCanvas, loadImage } from 'canvas';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { measureTextureRichness } from './buildinggen/gates.js';

/**
 * `SpriteLoader` builds its footprint and doorway tables at module load and is
 * written against browser globals, so the shims have to be installed before the
 * dynamic import below rather than at the top of the file.
 */
interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
}
const globals: CanvasGlobals = globalThis;
const nodeCanvas = await import('canvas');
globals.Image = nodeCanvas.Image;
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`footprint snapshot cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { getSpriteFootprintByKey, getSpriteDoorwayByKey } = await import('../src/core/SpriteLoader');

const BUILDINGS_DIR = resolve('src/images/environment/buildings');
const BUILDINGS_MANIFEST_PATH = resolve(BUILDINGS_DIR, 'manifest.json');
const FIXTURE_PATH = resolve('scripts/buildinggen/fixtures/footprints.json');
/**
 * Copies of the art being replaced, kept so the review harness can show old and
 * new side by side and so the texture-richness benchmark survives the moment a
 * replacement takes over its predecessor's filename.
 */
const REPLACED_ART_DIR = resolve('scripts/buildinggen/fixtures/replaced');

/** Art that is not a facade and is not being redrawn. */
const NOT_A_FACADE = new Set(['overworld_main_tower', 'hoarders_room']);

export interface FootprintFixtureEntry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly footprint: {
    readonly dx: number;
    readonly dy: number;
    readonly w: number;
    readonly h: number;
  };
  /** `null` for art that declares no blocked regions, which is how interior art reads. */
  readonly doorway: {
    readonly dx: number;
    readonly dy: number;
    readonly dx0: number;
    readonly width: number;
  } | null;
  /**
   * Mean local luminance contrast over the opaque region of the `idle` frame.
   *
   * Recorded rather than measured at bake time because four of the replacements
   * keep their predecessor's filename, so by the time a bake wants to compare
   * itself against what it replaced, the file it would measure is its own
   * output. `null` for art with no `idle` state.
   */
  readonly textureRichness: number | null;
}

export type FootprintFixture = Record<string, FootprintFixtureEntry>;

const GEOMETRY_FIELDS = ['frameWidth', 'frameHeight', 'tileX', 'tileY', 'tileScale'] as const;
type GeometryField = (typeof GEOMETRY_FIELDS)[number];
type ManifestGeometry = Record<GeometryField, number> & { readonly path: string };

function readNumber(source: Record<string, unknown>, key: string, field: GeometryField): number {
  const value = source[field];
  if (typeof value !== 'number') throw new Error(`${key}.${field} is not a number`);
  return value;
}

function readManifestGeometry(): Map<string, ManifestGeometry> {
  const parsed: unknown = JSON.parse(readFileSync(BUILDINGS_MANIFEST_PATH, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('buildings manifest is not an object');
  }
  const result = new Map<string, ManifestGeometry>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`buildings manifest entry '${key}' is not an object`);
    }
    const entry: Record<string, unknown> = { ...value };
    const path = entry.path;
    if (typeof path !== 'string') throw new Error(`${key}.path is not a string`);
    result.set(key, {
      path,
      frameWidth: readNumber(entry, key, 'frameWidth'),
      frameHeight: readNumber(entry, key, 'frameHeight'),
      tileX: readNumber(entry, key, 'tileX'),
      tileY: readNumber(entry, key, 'tileY'),
      tileScale: readNumber(entry, key, 'tileScale'),
    });
  }
  return result;
}

/**
 * Measures frame 0 of the sheet's `idle` state, which is always the top-left
 * cell: every building this script was written to record laid `idle` out that
 * way, whatever else its sheet carried.
 */
async function measureIdleRichness(geometry: ManifestGeometry): Promise<number> {
  const image = await loadImage(resolve('src/images', geometry.path));
  const width = Math.round(geometry.frameWidth);
  const height = Math.round(geometry.frameHeight);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  return measureTextureRichness({ data: pixels.data, width, height });
}

/**
 * Refuses to run once this script's own output already exists.
 *
 * Checked before anything is read or copied. The hazard is specific: four
 * replacements kept their predecessor's filename, so a second run would
 * `copyFileSync` the *new* `barracks.png` over the archived *old* one and
 * re-measure `textureRichness` from the replacement — after which the bake's
 * texture gate compares every building against roughly half its own score and
 * can never fail again. `scripts/buildinggen/` is untracked, so git could not
 * put the originals back.
 *
 * The test is the *presence of the archive*, not which keys the manifest still
 * names. An earlier version keyed on the missing keys and happened to fire, but
 * only as a side effect of nine unrelated entries having been removed — prune
 * the fixture to match the manifest, a natural tidy-up, and that guard would
 * have opened the door it was written to hold shut.
 */
function refuseIfTheRecordAlreadyExists(): void {
  const archived = existsSync(REPLACED_ART_DIR) ? readdirSync(REPLACED_ART_DIR) : [];
  const held: string[] = [];
  if (archived.length > 0) held.push(`${REPLACED_ART_DIR} (${archived.length} sheet(s))`);
  // Both halves, not just the archive. They are written together but can be
  // deleted apart — thirteen PNGs that look like copies of deleted art are an
  // inviting tidy-up — and it is the fixture that the bake's texture gate reads.
  // A guard on the archive alone reopens the moment somebody removes only it.
  if (existsSync(FIXTURE_PATH)) held.push(FIXTURE_PATH);
  if (held.length === 0) return;
  throw new Error(
    `Refusing to run: this script's output already exists — ${held.join(' and ')}. That record is ` +
      'the frozen state of the art this kit replaced and it is not regenerable: four replacements ' +
      "kept their predecessor's filename, so a second run would archive the new sheet over the old " +
      'one and re-measure the texture benchmark from the replacement, halving every floor against ' +
      'itself. Delete it deliberately if you really mean to lose it.',
  );
}

refuseIfTheRecordAlreadyExists();

const manifest = readManifestGeometry();
const fixture: FootprintFixture = {};
mkdirSync(REPLACED_ART_DIR, { recursive: true });

for (const key of [...manifest.keys()].sort()) {
  const geometry = manifest.get(key);
  if (geometry === undefined) throw new Error(`manifest key '${key}' vanished between reads`);
  const footprint = getSpriteFootprintByKey(key);
  if (footprint === undefined) {
    throw new Error(`Sprite '${key}' is in the buildings manifest but derives no footprint`);
  }
  const doorway = getSpriteDoorwayByKey(key);
  const isFacade = !NOT_A_FACADE.has(key);
  if (isFacade) {
    const source = resolve('src/images', geometry.path);
    copyFileSync(source, resolve(REPLACED_ART_DIR, basename(source)));
  }
  fixture[key] = {
    ...geometry,
    footprint: { dx: footprint.dx, dy: footprint.dy, w: footprint.w, h: footprint.h },
    doorway:
      doorway === undefined
        ? null
        : { dx: doorway.dx, dy: doorway.dy, dx0: doorway.dx0, width: doorway.width },
    textureRichness: isFacade ? await measureIdleRichness(geometry) : null,
  };
}

mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);

for (const [key, entry] of Object.entries(fixture)) {
  const door =
    entry.doorway === null
      ? 'no doorway'
      : `door dx=${entry.doorway.dx} dx0=${entry.doorway.dx0} w=${entry.doorway.width} dy=${entry.doorway.dy}`;
  console.log(
    `${key.padEnd(22)} ${entry.footprint.w}x${entry.footprint.h} tiles  ` +
      `${entry.frameWidth}x${entry.frameHeight}px @${entry.tileScale}  ${door}`,
  );
}
console.log(`\nwrote ${FIXTURE_PATH}`);
