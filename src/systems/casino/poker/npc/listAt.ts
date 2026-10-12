/**
 * Indexed reads that admit the index may be out of range. The project's
 * compiler settings type `list[i]` as always present, so code that genuinely
 * may miss reads through this instead; a negative index counts from the end.
 */
export function listAt<T>(list: ReadonlyArray<T>, index: number): T | undefined {
  const resolved = index < 0 ? list.length + index : index;
  return resolved >= 0 && resolved < list.length ? list[resolved] : undefined;
}
