/**
 * A deterministic per-tile hash for Briar Hollow's painters: which variant of a
 * prop stands somewhere, which wall gets a window. A function of position and
 * a salt only, so the same village looks the same every time it is drawn.
 */

const HASH_X_PRIME = 73856093;
const HASH_Y_PRIME = 19349663;
const HASH_SALT_PRIME = 83492791;
const HASH_MIX = 0x45d9f3b;
const HASH_SHIFT = 16;

/** A non-negative 32-bit hash of a tile and a salt. */
export function tileHash(tx: number, ty: number, salt: number): number {
  let h =
    Math.imul(tx, HASH_X_PRIME) ^ Math.imul(ty, HASH_Y_PRIME) ^ Math.imul(salt, HASH_SALT_PRIME);
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_MIX);
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_MIX);
  return (h ^ (h >>> HASH_SHIFT)) >>> 0;
}

const UNIT_RANGE = 0x100000000;

/** The hash as a number in [0, 1). */
export function tileHash01(tx: number, ty: number, salt: number): number {
  return tileHash(tx, ty, salt) / UNIT_RANGE;
}
