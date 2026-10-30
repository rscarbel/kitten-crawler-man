/**
 * Pure page-breaking: splits a `DialogLine`'s paragraphs into pages that fit
 * a box `maxLines` lines tall at `maxWidth` wide, using only the `measure`
 * function handed in — no canvas, so the algorithm can be unit-tested in
 * node and shared by anything that draws pages (`DialogBox`).
 *
 * Break preference, in order: every paragraph boundary is a forced page
 * break; within a paragraph, lines fill greedily by word and a page holds
 * every line the box has room for, cutting at the last word boundary that
 * fits; failing that (a single word wider than the box), by grapheme cluster.
 * A page never cuts back to an earlier sentence end: that would leave lines
 * of the box empty and page text that was never going to overflow.
 */

import type { NonEmpty, Paragraphs } from './line';
import { graphemes } from '../core/text/graphemes';

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
 * exactly, so a sentence-by-sentence reveal joins back to the page it came from.
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

/** Hard-breaks a single word wider than `maxWidth` into fragments that fit, never splitting a grapheme cluster. Always makes progress, even for a single cluster wider than the width. */
export function hardBreakWord(
  word: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const fragments: string[] = [];
  let piece = '';
  for (const cluster of graphemes(word)) {
    const extended = piece + cluster;
    if (piece !== '' && measure(extended) > maxWidth) {
      fragments.push(piece);
      piece = cluster;
    } else {
      piece = extended;
    }
  }
  fragments.push(piece);
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

/** A grapheme that forces a line break; `\r\n` is one cluster, not two. */
const LINE_BREAK_CLUSTERS: ReadonlySet<string> = new Set(['\n', '\r\n']);

/**
 * Wraps `text` into display-line spans, honoring explicit `\n` as a forced
 * line break — each `\n`-delimited chunk is wrapped independently. The dialog
 * box and the world-text painter both draw from these spans, which is what keeps
 * a page's line count and its drawn line count in agreement.
 */
export function computeLineSpans(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): LineSpan[] {
  const spans: LineSpan[] = [];
  let chunkStart = 0;
  let cursor = 0;
  for (const cluster of graphemes(text)) {
    if (LINE_BREAK_CLUSTERS.has(cluster)) {
      spans.push(...computeChunkLineSpans(text, chunkStart, cursor, maxWidth, measure));
      chunkStart = cursor + cluster.length;
    }
    cursor += cluster.length;
  }
  spans.push(...computeChunkLineSpans(text, chunkStart, text.length, maxWidth, measure));
  return spans;
}

function requireSpan(spans: readonly LineSpan[], index: number): LineSpan {
  if (index < 0 || index >= spans.length) {
    throw new Error('paginate: line index out of range');
  }
  return spans[index];
}

/**
 * The separators a page cut consumes rather than carrying to the top of the
 * next page. `\r\n` is consumed whole: leaving its `\n` behind would open
 * the next page on a blank line.
 */
const PAGE_CUT_SEPARATORS: readonly string[] = [' ', '\r\n', '\n'];

function separatorLengthAt(text: string, index: number): number {
  const separator = PAGE_CUT_SEPARATORS.find((candidate) => text.startsWith(candidate, index));
  return separator?.length ?? 0;
}

/**
 * Where a page holding `windowLast` as its last line ends in `remaining`.
 * Never zero, so every page moves the cut forward: a window whose last line is
 * empty and is followed by no separator would otherwise cut nothing, forever.
 */
function pageCutLength(remaining: string, windowLast: LineSpan): number {
  const windowEnd = windowLast.offset + windowLast.length;
  if (windowEnd > 0 || separatorLengthAt(remaining, 0) > 0) return windowEnd;
  const [firstCluster = remaining] = graphemes(remaining);
  return firstCluster.length;
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
    // Every span ends on a word end (or inside a word too wide for any
    // line, already hard-broken), so the full window is itself the cut.
    const cutLength = pageCutLength(remaining, requireSpan(spans, maxLines - 1));
    pages.push({
      text: remaining.slice(0, cutLength),
      startOffset: paragraphSourceOffset + consumed,
    });
    consumed += cutLength + separatorLengthAt(remaining, cutLength);
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
