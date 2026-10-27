/** A plain JSON object: not `null`, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Proves at compile time that the rest of a destructure is empty, so a field
 * added to a type fails the typecheck until the destructure names it.
 */
export function assertNoFieldsLeft(_rest: Record<string, never>): void {
  // The parameter type is the whole check; there is nothing to do at runtime.
}

/**
 * A string-keyed record's own entry, or undefined when the key is absent. The
 * index type of a `Record<string, T>` claims every key holds a `T`; this is the
 * honest lookup for a key that came from data.
 */
export function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/**
 * Every entry of `value` parsed by `parseEntry`, or undefined when `value` is
 * not an array or any one entry fails: a stored list is valid whole or not at all.
 */
export function parseEvery<T>(
  value: unknown,
  parseEntry: (entry: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const entry of value) {
    const result = parseEntry(entry);
    if (result === undefined) return undefined;
    parsed.push(result);
  }
  return parsed;
}
