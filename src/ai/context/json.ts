/**
 * JSON values and RFC 7386 JSON merge patches.
 *
 * Merge patches cannot carry a literal `null` (it means "delete this key"), so
 * every builder that feeds `createMergePatch` leaves a field out instead of
 * setting it to `null`.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values; key order does not matter. */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (isJsonObject(a) && isJsonObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => key in b && jsonEqual(a[key], b[key]));
  }
  return false;
}

/**
 * The merge patch that turns `prev` into `next`, or `null` when they are equal.
 * Arrays are replaced whole, as RFC 7386 requires.
 */
export function createMergePatch(prev: JsonObject, next: JsonObject): JsonObject | null {
  const patch: JsonObject = {};
  let changed = false;
  for (const key of Object.keys(prev)) {
    if (!(key in next)) {
      patch[key] = null;
      changed = true;
    }
  }
  for (const [key, nextValue] of Object.entries(next)) {
    const prevValue = prev[key];
    if (isJsonObject(prevValue) && isJsonObject(nextValue)) {
      const nested = createMergePatch(prevValue, nextValue);
      if (nested !== null) {
        patch[key] = nested;
        changed = true;
      }
    } else if (!(key in prev) || !jsonEqual(prevValue, nextValue)) {
      patch[key] = nextValue;
      changed = true;
    }
  }
  return changed ? patch : null;
}

/** Applies an RFC 7386 merge patch, returning a new value and leaving `target` untouched. */
export function applyMergePatch(target: JsonValue | undefined, patch: JsonValue): JsonValue {
  if (!isJsonObject(patch)) return patch;
  const base: JsonObject = isJsonObject(target) ? target : {};
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(base)) {
    if (!(key in patch)) result[key] = value;
  }
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) continue;
    result[key] = applyMergePatch(key in base ? base[key] : undefined, patchValue);
  }
  return result;
}
