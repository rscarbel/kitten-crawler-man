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
