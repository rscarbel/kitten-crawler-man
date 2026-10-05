#!/usr/bin/env tsx
/**
 * Gate: `paginate` splits any paragraph into pages that actually fit a box,
 * and the real `DialogBox` never draws more lines than it has room for.
 *
 * Part 1 exercises `paginate` directly against a synthetic, character-counting
 * `measure` function — no canvas needed, so the break rules (paragraph
 * boundary, sentence end, word boundary, character) are checked in isolation.
 *
 * Part 2 discovers every `DialogLine` exported from a script module under
 * `src/dialog/scripts/`, renders each through the real `DialogBox` at a short
 * phone viewport and at a desktop one, and asserts that no display page's
 * wrapped line count exceeds the box's own `maxLines`, and no wrapped line is
 * wider than the box's own text width. While no script modules exist yet, a
 * set of built-in long synthetic lines is rendered instead, so this part of
 * the harness is exercised even before any script exists to discover.
 *
 * Part 3 is a self-test, run every time: it proves the fit check in part 2
 * actually catches clipping, by handing it a page one line too tall for the
 * budget it's told to fit and confirming that fails.
 *
 * Run: npm run verify:dialog-pagination
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { computeLineSpans, paginate, type Page } from '../src/dialog/paginate';
import type { DialogLine, NonEmpty, Paragraphs } from '../src/dialog/line';
import { installCanvasGlobals } from './nodeCanvasGlobals';
import { gameContext } from './nodeGameContext';
import { setViewportSize } from '../src/core/Viewport';
import { DialogBox, type DialogLayout, type ResolvedSpeaker } from '../src/ui/DialogBox';
import { SPEECH_REVEAL_INTERVAL_MS } from '../src/dialog/speakers';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// Part 1: paginate() unit tests, against a deterministic character-count
// measure — one width unit per character, so cases below can be sized exactly.
// ---------------------------------------------------------------------------

const measureChars = (s: string): number => s.length;

/**
 * Every page must be a verbatim slice of `paragraphs.join('\n')` starting at
 * its own `startOffset` — the invariant a resize's "find my place" remap
 * depends on.
 */
function assertOffsetsMatchSource(
  paragraphs: Paragraphs,
  pages: NonEmpty<Page>,
  label: string,
): void {
  const source = paragraphs.join('\n');
  let previousEnd = -1;
  for (const page of pages) {
    const slice = source.slice(page.startOffset, page.startOffset + page.text.length);
    check(
      slice === page.text,
      `${label}: page at offset ${page.startOffset} matches its source slice`,
    );
    check(
      page.startOffset >= previousEnd,
      `${label}: startOffset ${page.startOffset} is non-decreasing`,
    );
    previousEnd = page.startOffset;
  }
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

const ONE_PAGE_MAX_WIDTH = 40;
const ONE_PAGE_MAX_LINES = 3;

{
  const label = 'one page';
  const paragraphs: Paragraphs = ['Hello world, this fits.'];
  const pages = paginate(paragraphs, measureChars, ONE_PAGE_MAX_WIDTH, ONE_PAGE_MAX_LINES);
  check(pages.length === 1, `${label}: produces exactly one page`);
  check(pages[0].text === paragraphs[0], `${label}: page text is the whole paragraph`);
  check(pages[0].startOffset === 0, `${label}: startOffset is 0`);
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const EXACT_FIT_MAX_LINES = 3;
const EXACT_FIT_WORD_WIDTH = 10;

{
  const label = 'exact fit';
  const maxLines = EXACT_FIT_MAX_LINES;
  const wordWidth = EXACT_FIT_WORD_WIDTH;
  const paragraphWords = Array.from({ length: maxLines }, (_, i) => `${'w'.repeat(wordWidth)}${i}`);
  const paragraphs: Paragraphs = [paragraphWords.join(' ')];
  const pages = paginate(paragraphs, measureChars, wordWidth + 1, maxLines);
  check(pages.length === 1, `${label}: a paragraph that exactly fills maxLines stays on one page`);
  check(pages[0].text === paragraphs[0], `${label}: nothing is truncated`);
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const LONG_PARAGRAPH_MAX_LINES = 3;
const LONG_PARAGRAPH_MAX_WIDTH = 12;
const LONG_PARAGRAPH_WORD_COUNT = 40;

{
  const label = 'long paragraph';
  const maxLines = LONG_PARAGRAPH_MAX_LINES;
  const maxWidth = LONG_PARAGRAPH_MAX_WIDTH;
  const paragraphWords = Array.from({ length: LONG_PARAGRAPH_WORD_COUNT }, (_, i) => `word${i}`);
  const paragraphs: Paragraphs = [paragraphWords.join(' ')];
  const pages = paginate(paragraphs, measureChars, maxWidth, maxLines);
  check(pages.length > 1, `${label}: splits into more than one page`);
  assertOffsetsMatchSource(paragraphs, pages, label);
  const reconstructed = pages.flatMap((page) => words(page.text));
  check(
    reconstructed.join(' ') === paragraphWords.join(' '),
    `${label}: the pages together contain every word, in order`,
  );
}

const LONG_SENTENCE_MAX_LINES = 2;
const LONG_SENTENCE_MAX_WIDTH = 15;
const LONG_SENTENCE_WORD_COUNT = 20;

{
  const label = 'sentence longer than a page';
  const maxLines = LONG_SENTENCE_MAX_LINES;
  const maxWidth = LONG_SENTENCE_MAX_WIDTH;
  // One sentence with no punctuation until the very end — no sentence
  // boundary can possibly fit inside the first page's window, so the cut
  // must fall back to the last word boundary instead.
  const longSentence = `${Array.from({ length: LONG_SENTENCE_WORD_COUNT }, (_, i) => `word${i}`).join(' ')}.`;
  const paragraphs: Paragraphs = [longSentence];
  const pages = paginate(paragraphs, measureChars, maxWidth, maxLines);
  check(pages.length > 1, `${label}: still splits into pages`);
  const firstPage = pages[0];
  const charAfterCut = longSentence.charAt(firstPage.text.length);
  check(
    firstPage.text.length === 0 || charAfterCut === ' ' || charAfterCut === '',
    `${label}: the cut lands on a word boundary, not mid-word`,
  );
  check(
    !firstPage.text.trim().endsWith('.'),
    `${label}: the cut page does not include the sentence's own terminator`,
  );
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const HUGE_WORD_MAX_WIDTH = 8;
const HUGE_WORD_LENGTH = 37;
const HUGE_WORD_MAX_LINES = 1;

{
  const label = 'word longer than the width';
  const maxWidth = HUGE_WORD_MAX_WIDTH;
  const hugeWord = 'x'.repeat(HUGE_WORD_LENGTH);
  const paragraphs: Paragraphs = [hugeWord];
  const pages = paginate(paragraphs, measureChars, maxWidth, HUGE_WORD_MAX_LINES);
  check(pages.length > 1, `${label}: a single overlong word forces more than one page`);
  for (const page of pages) {
    check(page.text.length <= maxWidth, `${label}: page fragment "${page.text}" fits maxWidth`);
  }
  const reassembled = pages.map((page) => page.text).join('');
  check(reassembled === hugeWord, `${label}: the fragments reassemble to the original word`);
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const FORCED_BREAK_MAX_WIDTH = 200;
const FORCED_BREAK_MAX_LINES = 10;

{
  const label = 'forced paragraph breaks';
  const paragraphs: Paragraphs = ['Short one.', 'Short two.'];
  const pages = paginate(paragraphs, measureChars, FORCED_BREAK_MAX_WIDTH, FORCED_BREAK_MAX_LINES);
  check(
    pages.length === 2,
    `${label}: two paragraphs that would both fit on one page still get one page each`,
  );
  check(pages[0].text === 'Short one.', `${label}: first page is exactly the first paragraph`);
  check(pages[1].text === 'Short two.', `${label}: second page is exactly the second paragraph`);
  check(
    pages[1].startOffset === paragraphs[0].length + 1,
    `${label}: second page's startOffset skips the joining newline`,
  );
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const MANY_PARAGRAPHS_WORD_COUNT = 15;
const MANY_PARAGRAPHS_MAX_WIDTH = 20;
const MANY_PARAGRAPHS_MAX_LINES = 2;

{
  const label = 'startOffset monotonicity across many paragraphs';
  const paragraphs: Paragraphs = [
    Array.from({ length: MANY_PARAGRAPHS_WORD_COUNT }, (_, i) => `alpha${i}`).join(' '),
    Array.from({ length: MANY_PARAGRAPHS_WORD_COUNT }, (_, i) => `beta${i}`).join(' '),
    Array.from({ length: MANY_PARAGRAPHS_WORD_COUNT }, (_, i) => `gamma${i}`).join(' '),
  ];
  const pages = paginate(
    paragraphs,
    measureChars,
    MANY_PARAGRAPHS_MAX_WIDTH,
    MANY_PARAGRAPHS_MAX_LINES,
  );
  check(
    pages.length > paragraphs.length,
    `${label}: each paragraph itself splits into several pages`,
  );
  for (let i = 1; i < pages.length; i++) {
    check(
      pages[i].startOffset > pages[i - 1].startOffset,
      `${label}: page ${i} startOffset strictly follows page ${i - 1}`,
    );
  }
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const EMBEDDED_NEWLINE_MAX_WIDTH = 200;
const EMBEDDED_NEWLINE_MAX_LINES = 1;

{
  // Both halves fit on one wrapped line if '\n' is measured as an ordinary,
  // zero-width character — the bug this line-count model must not repeat.
  // Honouring '\n' as a forced line break makes it two lines, one over the
  // one-line budget, so it must paginate.
  const label = 'embedded newline forces a page split';
  const paragraphs: Paragraphs = ['AAAA\nBBBB'];
  const pages = paginate(
    paragraphs,
    measureChars,
    EMBEDDED_NEWLINE_MAX_WIDTH,
    EMBEDDED_NEWLINE_MAX_LINES,
  );
  check(pages.length === 2, `${label}: paginates onto two pages`);
  check(pages[0].text === 'AAAA', `${label}: first page is the text before the newline`);
  check(pages[1].text === 'BBBB', `${label}: second page is the text after the newline`);
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const NEWLINE_AT_BOUNDARY_MAX_WIDTH = 200;
const NEWLINE_AT_BOUNDARY_MAX_LINES = 2;

{
  // The page cut and a forced '\n' break land on the same character: the
  // first page fills its two-line budget with the text on either side of the
  // first newline, and the second newline — the one the cut falls on — must
  // be consumed rather than reappearing as a blank line at the top of the
  // next page.
  const label = 'newline at a page boundary';
  const paragraphs: Paragraphs = ['AAAA\nBBBB\nCCCC'];
  const pages = paginate(
    paragraphs,
    measureChars,
    NEWLINE_AT_BOUNDARY_MAX_WIDTH,
    NEWLINE_AT_BOUNDARY_MAX_LINES,
  );
  check(pages.length === 2, `${label}: paginates onto two pages`);
  check(pages[0].text === 'AAAA\nBBBB', `${label}: first page keeps its own forced break`);
  check(pages[1].text === 'CCCC', `${label}: second page starts clean, with no leading blank line`);
  assertOffsetsMatchSource(paragraphs, pages, label);
}

const NEWLINE_PRESERVATION_MAX_WIDTH = 14;
const NEWLINE_PRESERVATION_MAX_LINES = 2;

{
  // A paragraph combining ordinary word-wrapping with embedded newlines: every
  // word must still show up across the pages, in order, the same guarantee
  // the plain long-paragraph case above checks.
  const label = 'text preservation across embedded newlines';
  const wrapped = Array.from({ length: 10 }, (_, i) => `word${i}`).join(' ');
  const paragraphs: Paragraphs = [`${wrapped}\nSecond part.\nThird part.`];
  const pages = paginate(
    paragraphs,
    measureChars,
    NEWLINE_PRESERVATION_MAX_WIDTH,
    NEWLINE_PRESERVATION_MAX_LINES,
  );
  check(pages.length > 1, `${label}: splits into more than one page`);
  assertOffsetsMatchSource(paragraphs, pages, label);
  const reconstructed = pages.flatMap((page) => words(page.text));
  check(
    reconstructed.join(' ') === words(paragraphs[0]).join(' '),
    `${label}: the pages together contain every word, in order`,
  );
}

// ---------------------------------------------------------------------------
// Part 2: render every discoverable DialogLine through the real DialogBox.
// ---------------------------------------------------------------------------

interface DiscoveryStats {
  files: number;
  lines: number;
  functionsSkipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDialogLine(value: unknown): value is DialogLine {
  if (!isRecord(value)) return false;
  return (
    'speaker' in value &&
    'paragraphs' in value &&
    'advance' in value &&
    Array.isArray(value.paragraphs) &&
    value.paragraphs.every((paragraph) => typeof paragraph === 'string')
  );
}

/**
 * Walks an exported value looking for `DialogLine`s — plain objects, and
 * pools/tuples of them. A `say.fn` templated-line builder is a function that
 * can't be called generically (its argument shape is unknown here), so it is
 * skipped rather than invoked, but still counted in the printed summary.
 */
function collectDialogLines(value: unknown, into: DialogLine[], stats: DiscoveryStats): void {
  if (isDialogLine(value)) {
    into.push(value);
    stats.lines++;
    return;
  }
  if (typeof value === 'function') {
    stats.functionsSkipped++;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDialogLines(item, into, stats);
    return;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      collectDialogLines(value[key], into, stats);
    }
  }
}

function listScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listScriptFiles(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

async function discoverScriptLines(): Promise<{ lines: DialogLine[]; stats: DiscoveryStats }> {
  const scriptsDir = resolve(__dirname, '../src/dialog/scripts');
  const files = listScriptFiles(scriptsDir);
  const stats: DiscoveryStats = { files: files.length, lines: 0, functionsSkipped: 0 };
  const lines: DialogLine[] = [];
  for (const file of files) {
    const module: unknown = await import(pathToFileURL(file).href);
    collectDialogLines(module, lines, stats);
  }
  return { lines, stats };
}

/** Long enough to need several display pages at both harness viewports. */
const SYNTHETIC_LONG_LINE_WORD_COUNT = 220;
/** Long enough to still need several pages once split by the forced breaks around it. */
const SYNTHETIC_FORCED_BREAK_WORD_COUNT = 150;
/** How many times "unbreakable" repeats to build a single word wider than the box. */
const SYNTHETIC_UNBREAKABLE_WORD_REPEATS = 20;
const SYNTHETIC_TRAILING_WORD_COUNT = 30;

/** Long enough, in every shape paginate.ts breaks on, to actually exercise the harness while no real script exists to discover. */
function builtInSyntheticLines(): DialogLine[] {
  const speaker = { kind: 'transient' as const, name: 'Harness Speaker', style: 'system' as const };
  const manyWords = (count: number): string =>
    Array.from({ length: count }, (_, i) => `synthetic-word-${i}`).join(' ');
  return [
    {
      speaker,
      paragraphs: [manyWords(SYNTHETIC_LONG_LINE_WORD_COUNT)],
      advance: { kind: 'continue' },
    },
    {
      speaker,
      paragraphs: [
        'A short opening line to force a forced page break before the long one.',
        manyWords(SYNTHETIC_FORCED_BREAK_WORD_COUNT),
        'And a short closer, on its own forced page.',
      ],
      advance: { kind: 'continue' },
    },
    {
      speaker,
      paragraphs: [
        `${'unbreakable'.repeat(SYNTHETIC_UNBREAKABLE_WORD_REPEATS)} ${manyWords(SYNTHETIC_TRAILING_WORD_COUNT)}`,
      ],
      advance: { kind: 'custom', label: "Let's do this!" },
    },
  ];
}

/** A `DialogLine` never carries a resolved speaker itself; the harness only cares about the text geometry, so any fixed voice/reveal/case works. */
function harnessResolvedSpeaker(line: DialogLine): ResolvedSpeaker {
  const name = line.speaker.kind === 'cast' ? line.speaker.id : line.speaker.name;
  return {
    name,
    portrait: null,
    voice: { kind: 'silent' },
    reveal: 'all',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  };
}

/** `text` wrapped at `maxWidth` in `font`, by the line rule the box draws its body with. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  ctx.save();
  ctx.font = font;
  const spans = computeLineSpans(text, maxWidth, (line) => ctx.measureText(line).width);
  ctx.restore();
  return spans.map((span) => text.slice(span.offset, span.offset + span.length));
}

interface PageFitResult {
  ok: boolean;
  issues: string[];
}

const WRAPPED_LINE_WIDTH_TOLERANCE_PX = 0.5;

/**
 * Independently re-wraps `layout.pageText` at `layout.textWidth`/`layout.font`
 * and compares against `layout.maxLines` — a check with no dependency on
 * whatever line count `DialogBox` itself believes it drew, so a regression in
 * its own bookkeeping can't hide from it.
 */
function checkPageFits(ctx: CanvasRenderingContext2D, layout: DialogLayout): PageFitResult {
  const issues: string[] = [];
  const lines = wrapLines(ctx, layout.pageText, layout.textWidth, layout.font);
  if (lines.length > layout.maxLines) {
    issues.push(`page wraps to ${lines.length} drawn lines, exceeding maxLines ${layout.maxLines}`);
  }
  ctx.save();
  ctx.font = layout.font;
  for (const line of lines) {
    const width = ctx.measureText(line).width;
    if (width > layout.textWidth + WRAPPED_LINE_WIDTH_TOLERANCE_PX) {
      issues.push(
        `drawn line "${line}" measures ${width.toFixed(1)}px, exceeding text width ${layout.textWidth}px`,
      );
    }
  }
  ctx.restore();
  return { ok: issues.length === 0, issues };
}

/** A small phone held landscape — the harness's short viewport. */
const SHORT_PHONE_WIDTH = 568;
const SHORT_PHONE_HEIGHT = 320;
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 720;

const HARNESS_VIEWPORTS: ReadonlyArray<{ width: number; height: number; label: string }> = [
  { width: SHORT_PHONE_WIDTH, height: SHORT_PHONE_HEIGHT, label: 'short phone' },
  { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT, label: 'desktop' },
];

function renderLineThroughDialogBox(
  line: DialogLine,
  ctx: CanvasRenderingContext2D,
  lineLabel: string,
): number {
  const box = new DialogBox(null, { showFooterHint: true });
  const speaker = harnessResolvedSpeaker(line);
  box.show(line.paragraphs, speaker, {
    questRelated: false,
    pageIndicator: () =>
      box.pageCount() > 1 ? `${box.currentPageNumber()} / ${box.pageCount()}` : null,
  });

  let pagesChecked = 0;
  for (;;) {
    box.render(ctx);
    const layout = box.layout();
    const result = checkPageFits(ctx, layout);
    check(
      result.ok,
      `${lineLabel}: page ${box.currentPageNumber()}/${box.pageCount()} fits (${result.issues.join('; ') || 'ok'})`,
    );
    pagesChecked++;
    if (box.isLastPageOfLine()) break;
    const advanced = box.advancePage();
    if (!advanced) break;
  }
  return pagesChecked;
}

async function runRenderHarness(): Promise<void> {
  installCanvasGlobals();

  const { lines: discoveredLines, stats } = await discoverScriptLines();
  const usingBuiltIns = discoveredLines.length === 0;
  const lines = usingBuiltIns ? builtInSyntheticLines() : discoveredLines;

  if (usingBuiltIns) {
    console.log(
      `\nno DialogLine found under src/dialog/scripts/ (${stats.files} file(s), ${stats.functionsSkipped} say.fn builder(s) skipped) — exercising the harness with ${lines.length} built-in synthetic line(s) instead`,
    );
  } else {
    console.log(
      `\ndiscovered ${discoveredLines.length} DialogLine(s) across ${stats.files} file(s) under src/dialog/scripts/ (${stats.functionsSkipped} say.fn builder(s) skipped, counted but not called)`,
    );
  }

  let totalPagesChecked = 0;
  for (const viewport of HARNESS_VIEWPORTS) {
    setViewportSize(viewport.width, viewport.height);
    const ctx = gameContext(viewport.width, viewport.height);
    console.log(`\nviewport ${viewport.label} (${viewport.width}x${viewport.height})`);
    lines.forEach((line, index) => {
      const lineLabel = `line ${index + 1}/${lines.length} @ ${viewport.label}`;
      totalPagesChecked += renderLineThroughDialogBox(line, ctx, lineLabel);
    });
  }

  console.log(
    `\nchecked ${totalPagesChecked} display page(s) across ${lines.length} line(s) and ${HARNESS_VIEWPORTS.length} viewport(s)`,
  );
  check(totalPagesChecked > 0, 'the render harness checked at least one display page');
}

// ---------------------------------------------------------------------------
// Part 3: self-test — the fit check must actually detect clipping, not just
// report the box's own numbers back to it.
// ---------------------------------------------------------------------------

const SELF_TEST_TEXT_WIDTH = 300;
const SELF_TEST_TARGET_LINE_COUNT = 3;

function runClippingDetectionSelfTest(): void {
  installCanvasGlobals();
  setViewportSize(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
  const ctx = gameContext(SHORT_PHONE_WIDTH, SHORT_PHONE_HEIGHT);
  const font = '12px monospace';
  const textWidth = SELF_TEST_TEXT_WIDTH;

  // Grow a paragraph, one word at a time, until it wraps to exactly three
  // lines at textWidth — a page a box with a three-line budget draws in full.
  const targetLineCount = SELF_TEST_TARGET_LINE_COUNT;
  let text = 'word0';
  let wordIndex = 1;
  let wrapped = wrapLines(ctx, text, textWidth, font);
  while (wrapped.length < targetLineCount) {
    text += ` word${wordIndex}`;
    wordIndex++;
    wrapped = wrapLines(ctx, text, textWidth, font);
  }
  check(
    wrapped.length === targetLineCount,
    `self-test: constructed a page that wraps to exactly ${targetLineCount} lines`,
  );

  const trueFit = checkPageFits(ctx, {
    textWidth,
    maxLines: targetLineCount,
    pageText: text,
    font,
  });
  check(trueFit.ok, 'self-test: the check passes when maxLines matches the true line count');

  // Simulate a box that overestimates its own capacity by one line: the true
  // budget is one line short of what the page needs, which is exactly what a
  // clipped page looks like.
  const clippedBudget = targetLineCount - 1;
  const clippedFit = checkPageFits(ctx, {
    textWidth,
    maxLines: clippedBudget,
    pageText: text,
    font,
  });
  check(
    !clippedFit.ok,
    'self-test: the check fails when the budget is one line short of the true fit',
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  runClippingDetectionSelfTest();
  await runRenderHarness();

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
