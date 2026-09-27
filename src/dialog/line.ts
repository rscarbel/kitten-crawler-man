/**
 * A line of dialog is a value, not a string looked up by key: authors write
 * `say.line('...')` once per property, in one file per speaker or scene under
 * `src/dialog/scripts/`, and every reader of that property is a compile-time
 * reference to it. What a kind of speaker is required to say is an interface
 * in `roles.ts`, checked through a registry (`villagerRegistry.ts`) rather
 * than a runtime lookup, so a missing line fails to compile where it's
 * missing. Authors write paragraphs; `paginate.ts` decides how they split
 * into pages, and a `ConversationRequest`'s `ending` (`request.ts`) — data,
 * not a callback — decides what happens once the last one is read.
 */

import type { SpeakerId, SpeakerRef, TransientStyleId } from './speakers';

/** Paragraphs of one line. Each element starts a new page; a long element is split onto further pages at render time. */
export type Paragraphs = readonly [string, ...string[]];

/** What an author may hand to a line-building helper: a bare string, or an explicit paragraph breakdown. */
export type LineText = string | Paragraphs;

/**
 * What the player presses to move past a line's last display page.
 * `'continue'` renders the standard footer hint; `'custom'` renders a
 * labelled button in its place — for a line whose advance is itself a
 * choice of tone, like "Let's do this!".
 */
export type AdvanceLabel =
  { readonly kind: 'continue' } | { readonly kind: 'custom'; readonly label: string };

export interface DialogLine {
  readonly speaker: SpeakerRef;
  readonly paragraphs: Paragraphs;
  readonly advance: AdvanceLabel;
}

/** A `DialogLine` short enough to read as a speech bubble or a bark — always exactly one paragraph. */
export interface BarkLine extends DialogLine {
  readonly paragraphs: readonly [string];
}

/** A tuple guaranteed to have at least one element — a pool that can never be empty, or a request that can never have zero lines. */
export type NonEmpty<T> = readonly [T, ...T[]];

/** The line-building helpers `speakerLines` and `transientSpeaker` both return, closed over one speaker. */
export interface LineBuilder {
  /** A line with the standard "Continue" advance. The common case. */
  line(text: LineText): DialogLine;
  /** A line whose advance control wears `label` instead of "Continue". */
  button(label: string, text: LineText): DialogLine;
  /**
   * A templated line: `build` takes the line's arguments and returns its
   * text, so a missing or misspelled argument is a compile error at every
   * call site, not a runtime string substitution.
   */
  fn<A>(build: (args: A) => LineText): (args: A) => DialogLine;
  /**
   * A templated line whose advance control wears `label` instead of
   * "Continue" — `fn` with `button`'s custom label, for a line that pairs
   * templated text with a label of its own.
   */
  fnButton<A>(label: string, build: (args: A) => LineText): (args: A) => DialogLine;
  /** A single-paragraph line for a speech bubble or an ambient bark. */
  bark(text: string): BarkLine;
}

function toParagraphs(text: LineText): Paragraphs {
  return typeof text === 'string' ? [text] : text;
}

function buildLine(speaker: SpeakerRef, text: LineText, advance: AdvanceLabel): DialogLine {
  return { speaker, paragraphs: toParagraphs(text), advance };
}

function lineBuilderFor(speaker: SpeakerRef): LineBuilder {
  return {
    line: (text) => buildLine(speaker, text, { kind: 'continue' }),
    button: (label, text) => buildLine(speaker, text, { kind: 'custom', label }),
    fn:
      <A>(build: (args: A) => LineText) =>
      (args: A): DialogLine =>
        buildLine(speaker, build(args), { kind: 'continue' }),
    fnButton:
      <A>(label: string, build: (args: A) => LineText) =>
      (args: A): DialogLine =>
        buildLine(speaker, build(args), { kind: 'custom', label }),
    bark: (text: string): BarkLine => ({
      speaker,
      paragraphs: [text],
      advance: { kind: 'continue' },
    }),
  };
}

/** Line-building helpers for a fixed cast member, keyed by their {@link SpeakerId}. */
export function speakerLines(id: SpeakerId): LineBuilder {
  return lineBuilderFor({ kind: 'cast', id });
}

/** Line-building helpers for a speaker named at runtime — a townsperson, a resident, a sign — styled by a {@link TransientStyleId} preset. */
export function transientSpeaker(name: string, style: TransientStyleId): LineBuilder {
  return lineBuilderFor({ kind: 'transient', name, style });
}

/**
 * Deterministically picks one entry of a pool from `seed` — never `undefined`,
 * unlike `pool[Math.floor(Math.random() * pool.length)]`.
 */
export function pickLine<T>(pool: NonEmpty<T>, seed: number): T {
  const index = Math.abs(Math.trunc(seed)) % pool.length;
  const picked: T | undefined = pool[index];
  if (picked === undefined) {
    throw new Error('pickLine: index out of range');
  }
  return picked;
}
