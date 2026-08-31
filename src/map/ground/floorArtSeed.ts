/**
 * The one seed every piece of runtime-painted environment art on the current
 * floor derives from.
 *
 * Drawn once when a floor's `GameMap` is generated and stored on the map, so the
 * look of a floor is fixed the moment its layout is: a checkpoint restore rewinds
 * the same live `GameMap` and therefore keeps the same art, while a genuine new
 * descent or a restart builds a new map and so earns new art. Art changes exactly
 * when layout changes, never otherwise.
 *
 * The module-level slot below is what painters read, because they run deep inside
 * cache builders that have no map in hand. It is written from the scene as it
 * enters a floor — before any tile chunk or sheet is baked — and never mutated
 * mid-floor; a chunk baked under one seed and drawn under another would be a
 * silent tear.
 *
 * Consumers must always fork with `floorArtSubSeed(SOME_SALT)` rather than read
 * the raw value, so adding a consumer can never perturb an existing one's stream.
 */

import { subSeed } from '../../sprites/person/rng';
import { FLOOR_ART_SEEDS } from './artSeedAlphabet';

/**
 * The seed a floor gets when nothing has set one — the pre-variation look. Zero
 * is deliberately a legal value that every painter maps to its historical
 * unseeded art, which is what makes the offline review bakes and the shipped
 * game comparable.
 */
export const DEFAULT_FLOOR_ART_SEED = 0;

/** Ground material structure and detail noise. */
export const GROUND_STRUCTURE_SALT = 1;
/** The renderer's world-space brightness fields. */
export const GROUND_TONE_SALT = 2;
/** Which variant of a material lands on which patch. */
export const GROUND_VARIANT_SALT = 3;
/** Tree foliage clumping. */
export const TREE_SALT = 4;
/** Boulder and scree grain. */
export const ROCK_SALT = 6;
/** Goblin camp canvas and fire. */
export const CAMP_SALT = 7;
/** Smashable crates, barrels and club furniture. */
export const PROP_SALT = 8;
/** Building facade texture grain and lighting jitter. */
export const BUILDING_SALT = 9;

let current = DEFAULT_FLOOR_ART_SEED;

/**
 * Points every painter at a floor's art seed. Call before the floor's first
 * cache is built; calling it again with the same value is a no-op, and calling
 * it with a different one is only legal at a floor boundary where every cache
 * keyed on the old seed has already been released.
 */
export function setFloorArtSeed(seed: number): void {
  current = seed >>> 0;
}

export function floorArtSeed(): number {
  return current;
}

/**
 * An independent stream for one consumer.
 *
 * The default seed passes through unmixed so that an unseeded floor reproduces
 * the art every painter was originally reviewed against — `subSeed(0, salt)` is
 * a perfectly good number, just not that one.
 */
export function floorArtSubSeed(salt: number): number {
  if (current === DEFAULT_FLOOR_ART_SEED) return 0;
  return subSeed(current, salt);
}

/**
 * A fresh art seed, for a map generating its layout for the first time.
 *
 * Drawn from a fixed alphabet rather than from the whole 32-bit space, because
 * only the alphabet has been measured. Every seed in it has been painted offline
 * and checked for wrap seams, brightness drift, texture energy and
 * wall-to-floor separation against the reviewed art
 * (`scripts/build-floor-art-seeds.ts`, re-verified by
 * `npm run verify:floor-sweep`) — a seed drawn from anywhere else is a floor
 * nobody has looked at.
 */
export function drawFloorArtSeed(): number {
  const index = Math.min(
    FLOOR_ART_SEEDS.length - 1,
    Math.floor(Math.random() * FLOOR_ART_SEEDS.length),
  );
  return FLOOR_ART_SEEDS[index];
}
