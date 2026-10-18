#!/usr/bin/env tsx
/**
 * Bakes `src/systems/keyboardHeroChart.ts` from the keyboard-hero music track:
 * one chart per difficulty tier, all three from the same analysis.
 *
 * Every charted note is placed on a real attack in the audio, so a note struck
 * dead-centre in the green zone lands exactly on the melody. The chart is baked
 * rather than analysed at runtime because the analysis needs the whole decoded
 * waveform and several seconds of FFT work.
 *
 * - **Crawler** is pinned to `TARGET_NOTES_PER_SECOND`, so re-baking does not
 *   quietly change how hard the mini-game is.
 * - **Kitten** re-runs the same strongest-first selection for fewer notes at its
 *   own wider spacing, so the notes it keeps are still the strongest beats rather
 *   than whatever survived a random cull of Crawler's chart.
 * - **Nightmare** is Crawler's chart with a few double notes added on its
 *   heaviest accents.
 *
 * Each tier's invariants are checked here, where the chart is made, and a
 * break throws rather than warns: nothing downstream re-checks them.
 *
 * Requires `ffmpeg` on PATH.
 *
 * Run: npm run gen:keyboard-hero-chart
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { analyseOnsets, decodeMonoPcm, type OnsetAnalysis } from './audioOnsets.js';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  type Difficulty,
} from '../src/core/difficultyProfiles.js';
import {
  HIT_WINDOW_MS,
  KEYBOARD_HERO_GEOMETRY,
  type KeyboardHeroGeometry,
} from '../src/systems/keyboardHeroGeometry.js';

const TRACK_PATH = resolve('src/audio/music/keyboard_hero_music_track_1.mp3');
const OUT_PATH = resolve('src/systems/keyboardHeroChart.ts');

const MS_PER_SECOND = 1_000;

/**
 * Crawler's notes per second across the charted stretch: 59 notes over ~34 s
 * of play, the density Crawler difficulty is tuned to.
 */
const TARGET_NOTES_PER_SECOND = 1.73;

/** Kitten keeps this share of Crawler's note count. */
const KITTEN_NOTE_SHARE = 0.8;
/** How far Kitten's count may drift from its share before the bake is refused. */
const KITTEN_SHARE_TOLERANCE = 0.05;

/** How many double notes Nightmare aims for, and the band it must land in. */
const NIGHTMARE_CHORD_TARGET = 5;
const NIGHTMARE_CHORD_MIN = 4;
const NIGHTMARE_CHORD_MAX = 6;

/**
 * No double note lands this soon after the first note: the opening bars are
 * where a player finds the beat, and asking for two keys there is a miss before
 * the run has started.
 */
const CHORD_FREE_OPENING_MS = 2_000;

/** Notes in one double note. */
const CHORD_SIZE = 2;

/**
 * Rounding each hit to a whole millisecond can shave one off a gap the
 * selection measured in fractional seconds.
 */
const ROUNDING_TOLERANCE_MS = 1;

/**
 * Where the melody comes in, found by ear. Before it the track plays a low
 * two-note ostinato whose onsets are as strong as the melody's, so the analysis
 * alone would chart the accompaniment.
 */
const MELODY_ENTRY_MS = 2_758;

/** How far ahead of the ear-found entry the analysed onset of that note may land. */
const MELODY_ENTRY_TOLERANCE_MS = 20;

/** Number of columns the notes are dealt into. */
const COLUMN_COUNT = 4;

/**
 * Longest allowed stack of consecutive notes in one column. Pitch-derived columns
 * otherwise sit still through a passage that stays in one register, which reads as
 * a stuck chart rather than as the melody.
 */
const MAX_SAME_COLUMN_RUN = 3;

/**
 * Two notes in one column must not have overlapping hit windows, or a press inside
 * both windows is ambiguous and one of the pair is guaranteed to go unhit. Disjoint
 * windows means more than the full window width either side of the perfect moment.
 */
const MIN_SAME_COLUMN_SPACING_MS = 2 * HIT_WINDOW_MS;

/** The trailing edge of the last note's hit window plus a beat of quiet, so the song can breathe out. */
const SONG_OUTRO_MS = 700;

const TIER_CONSTANTS: Readonly<Record<Difficulty, string>> = {
  easy: 'KITTEN_NOTES',
  normal: 'CRAWLER_NOTES',
  hard: 'NIGHTMARE_NOTES',
};

type ColumnIndex = 0 | 1 | 2 | 3;

const COLUMNS: readonly ColumnIndex[] = [0, 1, 2, 3];

function isColumnIndex(n: number): n is ColumnIndex {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

interface BakedNote {
  readonly timeMs: number;
  readonly column: ColumnIndex;
  readonly chordId?: number;
}

/** The track's playable onsets, with the strength each was detected at. */
interface Candidates {
  readonly timesSec: readonly number[];
  readonly strengths: readonly number[];
  readonly lowBandStrengths: readonly number[];
  readonly midiNotes: readonly number[];
  readonly playableSpanSec: number;
}

function candidatesFor(analysis: OnsetAnalysis, geometry: KeyboardHeroGeometry): Candidates {
  const firstChartableMs = Math.max(
    geometry.chartEarliestHitMs,
    MELODY_ENTRY_MS - MELODY_ENTRY_TOLERANCE_MS,
  );
  const indices = analysis.timesSec
    .map((_, i) => i)
    .filter((i) => analysis.timesSec[i] * MS_PER_SECOND >= firstChartableMs);
  if (indices.length === 0) throw new Error('no playable onsets found in the track');

  const timesSec = indices.map((i) => analysis.timesSec[i]);
  return {
    timesSec,
    strengths: indices.map((i) => analysis.strengths[i]),
    lowBandStrengths: indices.map((i) => analysis.lowBandStrengths[i]),
    midiNotes: indices.map((i) => analysis.midiNotes[i]),
    playableSpanSec: timesSec[timesSec.length - 1] - timesSec[0],
  };
}

/**
 * Greedy strongest-first selection under a minimum-spacing rule. Taking the
 * loudest attacks first means the chart lands on the accented notes of the
 * melody and leaves the ornaments between them alone.
 */
function selectNotes(
  timesSec: readonly number[],
  strengths: readonly number[],
  targetCount: number,
  minSpacingSec: number,
): number[] {
  const byStrength = timesSec.map((_, i) => i).sort((a, b) => strengths[b] - strengths[a]);
  const chosen: number[] = [];
  for (const candidate of byStrength) {
    if (chosen.length >= targetCount) break;
    const tooClose = chosen.some(
      (picked) => Math.abs(timesSec[candidate] - timesSec[picked]) < minSpacingSec,
    );
    if (!tooClose) chosen.push(candidate);
  }
  return chosen.sort((a, b) => a - b);
}

/** Split the chart's pitches into four equal-population bands so every column gets used. */
function pitchBandEdges(midiNotes: readonly number[]): number[] {
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let band = 1; band < COLUMN_COUNT; band++) {
    const position = (sorted.length * band) / COLUMN_COUNT;
    const lower = sorted[Math.max(0, Math.floor(position) - 1)];
    const upper = sorted[Math.min(sorted.length - 1, Math.floor(position))];
    edges.push((lower + upper) / 2);
  }
  return edges;
}

/**
 * Low pitches go left, high pitches go right, so the columns trace the melody's
 * contour. Where the pitch-derived column would stall on one lane or crowd two notes
 * into overlapping hit windows, the nearest lane that stays legal is used instead —
 * a slight break in the contour is far cheaper than an unplayable pair.
 */
function assignColumns(midiNotes: readonly number[], hitTimesMs: readonly number[]): ColumnIndex[] {
  const edges = pitchBandEdges(midiNotes);
  const columns: ColumnIndex[] = [];
  const lastTimeInColumnMs = new Map<number, number>();
  let runLength = 0;

  midiNotes.forEach((midi, i) => {
    let pitchBand = 0;
    while (pitchBand < edges.length && midi >= edges[pitchBand]) pitchBand++;

    const previousBand = columns[columns.length - 1];
    const bandsByPitchDistance = [0, 1, 2, 3].sort(
      (a, b) => Math.abs(a - pitchBand) - Math.abs(b - pitchBand),
    );

    const chosen = bandsByPitchDistance.find((band) => {
      const previousTimeMs = lastTimeInColumnMs.get(band);
      const crowded =
        previousTimeMs !== undefined &&
        hitTimesMs[i] - previousTimeMs <= MIN_SAME_COLUMN_SPACING_MS;
      const stalled = band === previousBand && runLength >= MAX_SAME_COLUMN_RUN;
      return !crowded && !stalled;
    });

    if (chosen === undefined || !isColumnIndex(chosen)) {
      throw new Error(`no legal column for the note at ${hitTimesMs[i]} ms`);
    }

    runLength = chosen === previousBand ? runLength + 1 : 1;
    lastTimeInColumnMs.set(chosen, hitTimesMs[i]);
    columns.push(chosen);
  });
  return columns;
}

interface SelectedChart {
  readonly notes: readonly BakedNote[];
  /** Each note's accent score, by chart index: melody attack plus how hard the low end lands with it. */
  readonly accents: readonly number[];
}

function bakeSelection(
  candidates: Candidates,
  targetCount: number,
  geometry: KeyboardHeroGeometry,
): SelectedChart {
  const selected = selectNotes(
    candidates.timesSec,
    candidates.strengths,
    targetCount,
    geometry.minNoteSpacingMs / MS_PER_SECOND,
  );
  const hitTimesMs = selected.map((i) => Math.round(candidates.timesSec[i] * MS_PER_SECOND));
  const columns = assignColumns(
    selected.map((i) => candidates.midiNotes[i]),
    hitTimesMs,
  );
  return {
    notes: hitTimesMs.map((timeMs, i) => ({ timeMs, column: columns[i] })),
    accents: selected.map((i) => candidates.strengths[i] + candidates.lowBandStrengths[i]),
  };
}

// ── Double notes ────────────────────────────────────────────────────────────

/** Distinct hit times in chart order; a double note is one moment holding two notes. */
function momentsOf(notes: readonly BakedNote[]): BakedNote[][] {
  const moments: BakedNote[][] = [];
  for (const note of notes) {
    const current = moments[moments.length - 1];
    if (current !== undefined && current[0].timeMs === note.timeMs) current.push(note);
    else moments.push([note]);
  }
  return moments;
}

/** The longest run of consecutive moments that each hold a note in `column`. */
function longestColumnRun(moments: readonly (readonly BakedNote[])[], column: ColumnIndex): number {
  let longest = 0;
  let run = 0;
  for (const moment of moments) {
    run = moment.some((note) => note.column === column) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Nearest gap between `timeMs` and any other note in `column`, or Infinity if the column is otherwise empty. */
function sameColumnClearanceMs(
  notes: readonly BakedNote[],
  column: ColumnIndex,
  timeMs: number,
): number {
  let clearance = Infinity;
  for (const note of notes) {
    if (note.column !== column || note.timeMs === timeMs) continue;
    clearance = Math.min(clearance, Math.abs(note.timeMs - timeMs));
  }
  return clearance;
}

function withNote(notes: readonly BakedNote[], added: BakedNote): BakedNote[] {
  return [...notes, added].sort((a, b) => a.timeMs - b.timeMs || a.column - b.column);
}

/**
 * The partner lane for a double note on `anchor`, or null when no lane can take
 * one. A lane is legal when the partner keeps its hit window clear of that lane's
 * neighbours and does not stack the lane past its run limit. Of the legal lanes
 * the one nearest the anchor wins, since two keys side by side read as one
 * gesture, and the one with more room to its neighbours breaks a tie.
 */
function partnerColumn(notes: readonly BakedNote[], anchor: BakedNote): ColumnIndex | null {
  let best: { column: ColumnIndex; clearance: number; distance: number } | null = null;
  for (const column of COLUMNS) {
    if (column === anchor.column) continue;
    const clearance = sameColumnClearanceMs(notes, column, anchor.timeMs);
    if (clearance <= MIN_SAME_COLUMN_SPACING_MS) continue;
    const trial = withNote(notes, { timeMs: anchor.timeMs, column });
    if (longestColumnRun(momentsOf(trial), column) > MAX_SAME_COLUMN_RUN) continue;
    const distance = Math.abs(column - anchor.column);
    const better =
      best === null ||
      distance < best.distance ||
      (distance === best.distance && clearance > best.clearance);
    if (better) best = { column, clearance, distance };
  }
  return best?.column ?? null;
}

/**
 * Nightmare's chart: Crawler's, with double notes on the heaviest accents. The
 * playable stretch is cut into one slice per wanted double note and each slice
 * takes its own strongest accent, which spreads them across the song instead of
 * piling them onto its loudest bar.
 */
function addChords(crawler: SelectedChart): BakedNote[] {
  const firstNoteMs = crawler.notes[0].timeMs;
  const lastNoteMs = crawler.notes[crawler.notes.length - 1].timeMs;
  const openingEndsMs = firstNoteMs + CHORD_FREE_OPENING_MS;
  const sliceMs = (lastNoteMs - openingEndsMs) / NIGHTMARE_CHORD_TARGET;

  let notes: BakedNote[] = [...crawler.notes];
  const chordIndices: number[] = [];

  for (let slice = 0; slice < NIGHTMARE_CHORD_TARGET; slice++) {
    const fromMs = openingEndsMs + slice * sliceMs;
    const toMs = fromMs + sliceMs;
    const isLastSlice = slice === NIGHTMARE_CHORD_TARGET - 1;

    const ranked = crawler.notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.timeMs >= fromMs && (note.timeMs < toMs || isLastSlice))
      .filter(({ index }) => chordIndices.every((taken) => Math.abs(taken - index) > 1))
      .sort((a, b) => crawler.accents[b.index] - crawler.accents[a.index]);

    for (const { note, index } of ranked) {
      const column = partnerColumn(notes, note);
      if (column === null) continue;
      const chordId = chordIndices.length;
      chordIndices.push(index);
      notes = notes.map((existing) => (existing === note ? { ...note, chordId } : existing));
      notes = withNote(notes, { timeMs: note.timeMs, column, chordId });
      break;
    }
  }
  return notes;
}

// ── Invariants ──────────────────────────────────────────────────────────────

interface TierRules {
  readonly minNotes: number;
  readonly maxNotes: number;
  readonly minChords: number;
  readonly maxChords: number;
}

function chartError(tier: Difficulty, detail: string): Error {
  return new Error(`${DIFFICULTY_LABELS[tier]} chart: ${detail}`);
}

function assertChartInvariants(
  tier: Difficulty,
  notes: readonly BakedNote[],
  geometry: KeyboardHeroGeometry,
  rules: TierRules,
): void {
  if (notes.length < rules.minNotes || notes.length > rules.maxNotes) {
    throw chartError(tier, `${notes.length} notes, outside ${rules.minNotes}–${rules.maxNotes}`);
  }

  const moments = momentsOf(notes);
  const firstNoteMs = notes[0].timeMs;
  let chordCount = 0;
  let previousWasChord = false;
  const seenChordIds = new Set<number>();

  moments.forEach((moment, index) => {
    const timeMs = moment[0].timeMs;
    if (timeMs < geometry.chartEarliestHitMs) {
      throw chartError(tier, `note at ${timeMs} ms is before the earliest playable hit`);
    }

    const previous = moments[index - 1];
    if (previous !== undefined) {
      const gapMs = timeMs - previous[0].timeMs;
      if (gapMs < geometry.minNoteSpacingMs - ROUNDING_TOLERANCE_MS) {
        throw chartError(
          tier,
          `${gapMs} ms between the notes at ${previous[0].timeMs} and ${timeMs} ms`,
        );
      }
    }

    const isChord = moment.length > 1;
    if (!isChord) {
      if (moment[0].chordId !== undefined) {
        throw chartError(tier, `single note at ${timeMs} ms carries a chord id`);
      }
      previousWasChord = false;
      return;
    }

    if (moment.length !== CHORD_SIZE) {
      throw chartError(tier, `${moment.length} notes at ${timeMs} ms`);
    }
    const chordId = moment[0].chordId;
    if (chordId === undefined || moment.some((note) => note.chordId !== chordId)) {
      throw chartError(tier, `the notes at ${timeMs} ms do not share one chord id`);
    }
    if (seenChordIds.has(chordId)) throw chartError(tier, `chord id ${chordId} is used twice`);
    seenChordIds.add(chordId);
    if (new Set(moment.map((note) => note.column)).size !== moment.length) {
      throw chartError(tier, `double note at ${timeMs} ms sits in one column`);
    }
    if (timeMs < firstNoteMs + CHORD_FREE_OPENING_MS) {
      throw chartError(tier, `double note at ${timeMs} ms is inside the opening`);
    }
    if (previousWasChord) throw chartError(tier, `two double notes in a row at ${timeMs} ms`);
    previousWasChord = true;
    chordCount++;
  });

  if (chordCount < rules.minChords || chordCount > rules.maxChords) {
    throw chartError(
      tier,
      `${chordCount} double notes, outside ${rules.minChords}–${rules.maxChords}`,
    );
  }

  for (const column of COLUMNS) {
    const inColumn = notes.filter((note) => note.column === column);
    inColumn.forEach((note, i) => {
      const previous = inColumn[i - 1];
      if (previous !== undefined && note.timeMs - previous.timeMs <= MIN_SAME_COLUMN_SPACING_MS) {
        throw chartError(
          tier,
          `column ${column} notes at ${previous.timeMs} and ${note.timeMs} ms share a hit window`,
        );
      }
    });
    if (longestColumnRun(moments, column) > MAX_SAME_COLUMN_RUN) {
      throw chartError(tier, `column ${column} runs longer than ${MAX_SAME_COLUMN_RUN}`);
    }
  }
}

// ── Output ──────────────────────────────────────────────────────────────────

function formatRow(note: BakedNote): string {
  const chord = note.chordId === undefined ? '' : `, chordId: ${note.chordId}`;
  return `  { timeMs: ${note.timeMs}, column: ${note.column}${chord} },`;
}

function endMsOf(notes: readonly BakedNote[]): number {
  return notes[notes.length - 1].timeMs + SONG_OUTRO_MS;
}

function formatChart(charts: Readonly<Record<Difficulty, readonly BakedNote[]>>): string {
  const lists = DIFFICULTY_ORDER.map(
    (tier) => `const ${TIER_CONSTANTS[tier]}: readonly KeyboardHeroChartNote[] = [
${charts[tier].map(formatRow).join('\n')}
];`,
  ).join('\n\n');

  const entries = DIFFICULTY_ORDER.map(
    (tier) => `  ${tier}: { notes: ${TIER_CONSTANTS[tier]}, endMs: ${endMsOf(charts[tier])} },`,
  ).join('\n');

  return `/**
 * GENERATED FILE — do not edit by hand. Run \`npm run gen:keyboard-hero-chart\`.
 *
 * One chart per difficulty tier for the keyboard-hero song. \`timeMs\` is the
 * moment the note sounds in the music, which is the moment the falling tile is
 * centred in the green hit zone. Columns follow the melody's pitch contour: low
 * notes left, high notes right.
 */

import type { Difficulty } from '../core/difficultyProfiles';

/** Which of the four columns a note falls down. */
export type KeyboardHeroColumn = 0 | 1 | 2 | 3;

export interface KeyboardHeroChartNote {
  /** Milliseconds from the start of the track to the note's attack. */
  readonly timeMs: number;
  readonly column: KeyboardHeroColumn;
  /** Shared by the notes of one double note, which land together in two columns. */
  readonly chordId?: number;
}

export interface KeyboardHeroChart {
  readonly notes: readonly KeyboardHeroChartNote[];
  /** When the mini-game ends: the last note plus a short tail. */
  readonly endMs: number;
}

${lists}

export const KEYBOARD_HERO_CHARTS: Readonly<Record<Difficulty, KeyboardHeroChart>> = {
${entries}
};
`;
}

function report(tier: Difficulty, notes: readonly BakedNote[]): void {
  const chordTimes = momentsOf(notes)
    .filter((moment) => moment.length > 1)
    .map((moment) => `${moment[0].timeMs} (${moment.map((n) => n.column).join('+')})`);
  const columnCounts = COLUMNS.map((c) => notes.filter((note) => note.column === c).length);
  console.log(
    `${DIFFICULTY_LABELS[tier].padEnd(9)} ${notes.length} notes, ` +
      `${notes[0].timeMs}–${notes[notes.length - 1].timeMs} ms, ` +
      `columns ${columnCounts.join('/')}` +
      (chordTimes.length > 0 ? `, double notes at ${chordTimes.join(', ')}` : ''),
  );
}

function main(): void {
  const analysis = analyseOnsets(decodeMonoPcm(TRACK_PATH));

  const crawlerGeometry = KEYBOARD_HERO_GEOMETRY.normal;
  const crawlerCandidates = candidatesFor(analysis, crawlerGeometry);
  const crawlerTarget = Math.round(crawlerCandidates.playableSpanSec * TARGET_NOTES_PER_SECOND);
  const crawler = bakeSelection(crawlerCandidates, crawlerTarget, crawlerGeometry);

  const kittenGeometry = KEYBOARD_HERO_GEOMETRY.easy;
  const kittenTarget = Math.round(crawler.notes.length * KITTEN_NOTE_SHARE);
  const kitten = bakeSelection(
    candidatesFor(analysis, kittenGeometry),
    kittenTarget,
    kittenGeometry,
  );

  const nightmare = addChords(crawler);

  const charts: Record<Difficulty, readonly BakedNote[]> = {
    easy: kitten.notes,
    normal: crawler.notes,
    hard: nightmare,
  };

  const crawlerCount = crawler.notes.length;
  assertChartInvariants('normal', charts.normal, crawlerGeometry, {
    minNotes: crawlerTarget,
    maxNotes: crawlerTarget,
    minChords: 0,
    maxChords: 0,
  });
  assertChartInvariants('easy', charts.easy, kittenGeometry, {
    minNotes: Math.ceil(crawlerCount * (KITTEN_NOTE_SHARE - KITTEN_SHARE_TOLERANCE)),
    maxNotes: Math.floor(crawlerCount * (KITTEN_NOTE_SHARE + KITTEN_SHARE_TOLERANCE)),
    minChords: 0,
    maxChords: 0,
  });
  assertChartInvariants('hard', charts.hard, KEYBOARD_HERO_GEOMETRY.hard, {
    minNotes: crawlerCount + NIGHTMARE_CHORD_MIN * (CHORD_SIZE - 1),
    maxNotes: crawlerCount + NIGHTMARE_CHORD_MAX * (CHORD_SIZE - 1),
    minChords: NIGHTMARE_CHORD_MIN,
    maxChords: NIGHTMARE_CHORD_MAX,
  });

  writeFileSync(OUT_PATH, formatChart(charts));

  console.log(`onsets detected:  ${analysis.timesSec.length}`);
  console.log(`music body ends:  ${analysis.musicEndSec.toFixed(3)} s`);
  for (const tier of DIFFICULTY_ORDER) report(tier, charts[tier]);
  console.log(`wrote ${OUT_PATH}`);
}

main();
