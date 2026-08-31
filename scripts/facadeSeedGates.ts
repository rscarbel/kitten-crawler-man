/**
 * What a floor art seed must not do to a building facade.
 *
 * A floor's seed reaches a facade's weathering — its tonal wash, its grain, its
 * grime and moss — and nothing else. The projection, the footprint, the doorway
 * and every component's position are computed from the spec's tile counts, so a
 * seed that moved them would not produce a wrong-looking building but a town
 * whose collision and whose art disagree.
 *
 * Two claims, checked two ways. The *silhouette* is checked exactly, by
 * comparing each seeded frame's opaque mask against the reviewed one's: the
 * footprint and the doorway are read off the frame the art occupies, so a
 * weathering pass that added or removed a pixel would move them. That the art
 * still holds up is measured, by running the same pixel gates the reviewed art
 * passes — and reporting only what the reviewed art does not already fail, since
 * the question is whether variation breaks anything rather than whether the art
 * was ever perfect.
 */

import type { Canvas } from 'canvas';

import {
  bake,
  readFixture,
  runPixelGates,
  type FootprintFixtureEntry,
} from './buildinggen/bake.js';
import { GateResults } from './buildinggen/gates.js';
import { BUILDING_SPECS } from '../src/sprites/buildinggen/buildings.js';
import { ALPHA, CHANNELS } from '../src/sprites/buildinggen/pixels.js';
import { buildingWeatherSeed } from '../src/sprites/buildinggen/runtimeBuildingSheets.js';
import { BUILDING_SALT, floorArtSubSeed, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';

/**
 * Gates whose bytes a floor seed cannot reach, and which a sweep therefore need
 * not read twice.
 *
 * A facade's life row is painted by `paintLifeFrame`, which takes no weather
 * seed — correctly, since the runtime does not give it one — so every gate that
 * measures only life frames re-measures identical bytes at every seed and can
 * never contribute a failure. Skipping them is not a relaxation: they run in
 * full in `npm run verify:buildings`, over the art they can actually speak for.
 */
const SEED_BLIND_GATES: ReadonlySet<string> = new Set([
  'life-transparency',
  'life-loop',
  'life-frame-count',
  'cell-bleed',
]);

/** Alpha at or above which a pixel counts as part of the building's shape. */
const OPAQUE_ENOUGH = 128;

function idlePixels(baked: { readonly idle: Canvas }): Uint8ClampedArray {
  return baked.idle.getContext('2d').getImageData(0, 0, baked.idle.width, baked.idle.height).data;
}

/**
 * A frame's opaque mask, one byte a pixel.
 *
 * Compared rather than the colours, because the colours are exactly what a floor
 * seed is allowed to move.
 */
function silhouette(pixels: Uint8ClampedArray): Uint8Array {
  const count = pixels.length / CHANNELS;
  const mask = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel++) {
    mask[pixel] = pixels[pixel * CHANNELS + ALPHA] >= OPAQUE_ENOUGH ? 1 : 0;
  }
  return mask;
}

function sameShape(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export interface FacadeBaseline {
  /** Gates the reviewed art already fails, keyed `<building>/<gate>`. */
  readonly knownFailures: ReadonlySet<string>;
  readonly silhouettes: ReadonlyMap<string, Uint8Array>;
  readonly fixture: ReadonlyMap<string, FootprintFixtureEntry>;
  /** What the reviewed art already fails, for a sweep to print rather than hide. */
  readonly notes: ReadonlyArray<string>;
}

/** Paints every facade at the reviewed seed and records what to measure against. */
export function reviewedFacades(): FacadeBaseline {
  const fixture = readFixture();
  const knownFailures = new Set<string>();
  const silhouettes = new Map<string, Uint8Array>();
  const notes: string[] = [];
  for (const spec of BUILDING_SPECS) {
    const reviewed = bake(spec);
    silhouettes.set(spec.key, silhouette(idlePixels(reviewed)));
    const results = new GateResults();
    runPixelGates(results, reviewed, fixture);
    for (const failure of results.failures) {
      knownFailures.add(`${failure.key}/${failure.gate}`);
      notes.push(`the reviewed ${failure.key} already fails '${failure.gate}': ${failure.detail}`);
    }
  }
  return { knownFailures, silhouettes, fixture, notes };
}

/**
 * Proves the silhouette comparison can go red.
 *
 * The comparison guards a property that holds by construction — a floor seed
 * never reaches a facade's geometry — so it would never trip on its own, and a
 * check nobody has seen fail is a check nobody knows is wired up. This moves one
 * pixel of a real facade's mask and requires that to be caught.
 */
export function silhouetteSelfTestFailures(baseline: FacadeBaseline): string[] {
  const [spec] = BUILDING_SPECS;
  if (spec === undefined) return ['self test: there are no facades to compare'];
  const reviewed = baseline.silhouettes.get(spec.key);
  if (reviewed === undefined) return [`self test: no reviewed silhouette for '${spec.key}'`];
  if (reviewed.length === 0) return [`self test: '${spec.key}' has an empty silhouette`];

  const nudged = Uint8Array.from(reviewed);
  const middle = Math.floor(nudged.length / 2);
  nudged[middle] = nudged[middle] === 0 ? 1 : 0;
  if (sameShape(reviewed, nudged)) {
    return [
      `self test: a ${spec.key} silhouette with one pixel moved was not caught, so the ` +
        `silhouette comparison below proves nothing`,
    ];
  }
  if (!sameShape(reviewed, Uint8Array.from(reviewed))) {
    return ['self test: a silhouette does not compare equal to a copy of itself'];
  }
  return [];
}

export interface FacadeSeedVerdict {
  readonly failures: ReadonlyArray<string>;
  /** Facades actually baked, so a verdict that measured nothing can be caught. */
  readonly facadesChecked: number;
}

/** Repaints every facade at one art seed and reports what variation broke. */
export function judgeFacadeArtSeed(artSeed: number, baseline: FacadeBaseline): FacadeSeedVerdict {
  setFloorArtSeed(artSeed);
  const seedTerm = floorArtSubSeed(BUILDING_SALT);
  const failures: string[] = [];
  let facadesChecked = 0;

  BUILDING_SPECS.forEach((spec, index) => {
    const seeded = bake(spec, buildingWeatherSeed(index, seedTerm));
    facadesChecked++;

    const reviewed = baseline.silhouettes.get(spec.key);
    if (reviewed === undefined) {
      failures.push(`${spec.key}: no reviewed silhouette to compare against`);
    } else if (!sameShape(reviewed, silhouette(idlePixels(seeded)))) {
      failures.push(
        `${spec.key}: its silhouette changed — the weathering is adding or removing pixels ` +
          `rather than tinting them`,
      );
    }

    const results = new GateResults();
    runPixelGates(results, seeded, baseline.fixture);
    for (const failure of results.failures) {
      if (SEED_BLIND_GATES.has(failure.gate)) continue;
      if (baseline.knownFailures.has(`${failure.key}/${failure.gate}`)) continue;
      failures.push(`${failure.key} [${failure.gate}]: ${failure.detail}`);
    }
  });

  return { failures, facadesChecked };
}
