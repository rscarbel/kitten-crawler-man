/**
 * Text written by a model or read back from a save, made safe to show on one
 * line: control and format characters (newlines, zero-width spaces,
 * bidirectional overrides) become spaces, every run of whitespace becomes one
 * space, and the ends are trimmed. Without it a "title" can carry thirty lines
 * or invisible characters that defeat matching one title against another.
 */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/gu;

export function plainLine(raw: string): string {
  return raw.replace(CONTROL_OR_FORMAT, ' ').replace(WHITESPACE_RUN, ' ').trim();
}
