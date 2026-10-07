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
