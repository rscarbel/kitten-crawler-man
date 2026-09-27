/**
 * Pure page-breaking: splits a `DialogLine`'s paragraphs into pages that fit
 * a box `maxLines` lines tall at `maxWidth` wide, using only the `measure`
 * function handed in — no canvas, so the algorithm can be unit-tested in
 * node and shared by anything that draws pages (`DialogBox`).
 *
 * Break preference, in order: every paragraph boundary is a forced page
 * break; within a paragraph, lines fill greedily by word and a page cuts at
 * the last sentence end that fits; failing that, at the last word boundary;
 * failing that (a single word wider than the box), by character.
 */

import type { NonEmpty, Paragraphs } from './line';

export interface Page {
  readonly text: string;
  /** Character offset of this page's first character into `paragraphs.join('\n')` — lets a resize re-find the reader's place. */
  readonly startOffset: number;
}

/** Where one wrapped line sits in the paragraph it came from. */
interface LineSpan {
  readonly offset: number;
  readonly length: number;
}

/** Minimum preceding-word length before a period is treated as a sentence boundary — guards against abbreviations like "Dr." or "e.g.". */
const MIN_SENTENCE_WORD_LEN = 3;

/**
 * Splits `text` into sentences, each ending at real punctuation or at the end
 * of `text` itself. Every sentence's characters concatenate back to `text`
 * exactly, so a caller can measure "how much of `text` is complete sentences"
 * as `text.length` minus the last entry's length.
 */
export function splitSentences(text: string): NonEmpty<string> {
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    current += char;
    if ('.!?;'.includes(char)) {
      const nextChar = text.charAt(i + 1);
      const isEndOfText = nextChar === '';
      const isEmphatic = char === '!' || char === '?';
      const wordBefore = current.slice(0, -1).trimEnd().split(/\s+/).pop() ?? '';
      const isLikelySentenceEnd =
        wordBefore.length >= MIN_SENTENCE_WORD_LEN && (nextChar === ' ' || nextChar === '\n');
      if (isEndOfText || isEmphatic || isLikelySentenceEnd) {
        sentences.push(current);
        current = '';
      }
    }
  }
  if (current.trim().length > 0) {
    sentences.push(current);
  }
  return toNonEmpty(sentences.length > 0 ? sentences : [text]);
}

/** Hard-breaks a single word wider than `maxWidth` into character-fitting fragments. Always makes progress, even for a single glyph wider than the width. */
export function hardBreakWord(
  word: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const fragments: string[] = [];
  let start = 0;
  let end = 1;
  while (end <= word.length) {
    const candidate = word.slice(start, end);
    if (measure(candidate) > maxWidth && end - start > 1) {
      fragments.push(word.slice(start, end - 1));
      start = end - 1;
    } else {
      end += 1;
    }
  }
  fragments.push(word.slice(start));
  return fragments;
}

/**
 * Greedily wraps one `\n`-free chunk of `text` into lines that fit
 * `maxWidth`, hard-breaking any single word that doesn't fit even alone.
 * `chunkStart`/`chunkEnd` bound the chunk within the outer `text`, so spans
 * come back as absolute offsets into `text` even though only the chunk is
 * scanned. Each returned span is a contiguous slice of `text` — reassembling
 * one is always `text.slice(offset, offset + length)`, so a page built from a
 * run of spans never needs to guess whether a space belongs between two of
 * them.
 */
function computeChunkLineSpans(
  text: string,
  chunkStart: number,
  chunkEnd: number,
  maxWidth: number,
  measure: (s: string) => number,
): LineSpan[] {
  const spans: LineSpan[] = [];
  let wordCursor = chunkStart;
  let lineStart = chunkStart;
  let lineEnd = chunkStart;
  let lineOpen = false;

  const closeLine = (): void => {
    if (!lineOpen) return;
    spans.push({ offset: lineStart, length: lineEnd - lineStart });
    lineOpen = false;
  };

  for (const word of text.slice(chunkStart, chunkEnd).split(' ')) {
    const wordStart = wordCursor;
    const wordEnd = wordStart + word.length;
    wordCursor = wordEnd + 1;

    if (measure(word) > maxWidth) {
      closeLine();
      let fragmentStart = wordStart;
      for (const fragment of hardBreakWord(word, maxWidth, measure)) {
        spans.push({ offset: fragmentStart, length: fragment.length });
        fragmentStart += fragment.length;
      }
      lineOpen = false;
      continue;
    }

    if (!lineOpen) {
      lineStart = wordStart;
      lineEnd = wordEnd;
      lineOpen = true;
      continue;
    }

    const extended = text.slice(lineStart, wordEnd);
    if (measure(extended) > maxWidth) {
      closeLine();
      lineStart = wordStart;
      lineEnd = wordEnd;
      lineOpen = true;
    } else {
      lineEnd = wordEnd;
    }
  }
  closeLine();
  return spans.length > 0 ? spans : [{ offset: chunkStart, length: 0 }];
}

/**
 * Wraps `text` into display-line spans, honoring explicit `\n` as a forced
 * line break — each `\n`-delimited chunk is wrapped independently, the same
 * way `wrapWithMeasure` (the draw-time wrapper in `TextBox.ts`) processes
 * `text.split('\n')`. Sharing this one function is what keeps a page's line
 * count and its drawn line count in agreement.
 */
export function computeLineSpans(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): LineSpan[] {
  const spans: LineSpan[] = [];
  let chunkStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charAt(i) !== '\n') continue;
    spans.push(...computeChunkLineSpans(text, chunkStart, i, maxWidth, measure));
    chunkStart = i + 1;
  }
  return spans;
}

function requireSpan(spans: readonly LineSpan[], index: number): LineSpan {
  if (index < 0 || index >= spans.length) {
    throw new Error('paginate: line index out of range');
  }
  return spans[index];
}

/** How many characters of `windowText` (already known to fit within the line budget) belong on this page. */
function bestCutLength(windowText: string): number {
  const sentences = splitSentences(windowText);
  if (sentences.length > 1) {
    const lastSentence = sentences[sentences.length - 1];
    const completeLength = windowText.length - lastSentence.length;
    if (completeLength > 0) return completeLength;
  }
  const lastSpace = windowText.lastIndexOf(' ');
  if (lastSpace > 0) return lastSpace;
  // No sentence end and no word boundary: `windowText` is entirely the
  // character-fragments of one word `computeLineSpans` already hard-broke,
  // so taking the whole window is itself the character-level break.
  return windowText.length;
}

function paginateParagraph(
  paragraph: string,
  paragraphSourceOffset: number,
  maxWidth: number,
  maxLines: number,
  measure: (s: string) => number,
  pages: Page[],
): void {
  if (paragraph.length === 0) {
    pages.push({ text: '', startOffset: paragraphSourceOffset });
    return;
  }
  let consumed = 0;
  while (consumed < paragraph.length) {
    const remaining = paragraph.slice(consumed);
    const spans = computeLineSpans(remaining, maxWidth, measure);
    if (spans.length <= maxLines) {
      pages.push({ text: remaining, startOffset: paragraphSourceOffset + consumed });
      return;
    }
    const windowLast = requireSpan(spans, maxLines - 1);
    const windowText = remaining.slice(0, windowLast.offset + windowLast.length);
    const cutLength = bestCutLength(windowText);
    pages.push({
      text: remaining.slice(0, cutLength),
      startOffset: paragraphSourceOffset + consumed,
    });
    // A cut that lands exactly on a chunk boundary an embedded '\n' forced
    // leaves that '\n' sitting unread at the front of `remaining` — it would
    // reappear as an empty line at the top of the next page. Skip over it
    // here, the same way the paragraph-to-paragraph join already does.
    consumed += remaining.charAt(cutLength) === '\n' ? cutLength + 1 : cutLength;
  }
}

function toNonEmpty<T>(items: readonly T[]): NonEmpty<T> {
  const first: T | undefined = items[0];
  if (first === undefined) {
    throw new Error('paginate: produced no elements');
  }
  return [first, ...items.slice(1)];
}

export function paginate(
  paragraphs: Paragraphs,
  measure: (s: string) => number,
  maxWidth: number,
  maxLines: number,
): NonEmpty<Page> {
  if (maxLines < 1) {
    throw new Error('paginate: maxLines must be at least 1');
  }
  const pages: Page[] = [];
  let sourceOffset = 0;
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) sourceOffset += 1; // the '\n' joining paragraphs in the source
    paginateParagraph(paragraph, sourceOffset, maxWidth, maxLines, measure, pages);
    sourceOffset += paragraph.length;
  });
  return toNonEmpty(pages);
}
