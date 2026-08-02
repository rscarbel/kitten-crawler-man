#!/usr/bin/env tsx
/**
 * Bakes `src/systems/keyboardHeroChart.ts` from the keyboard-hero music track.
 *
 * Every charted note is placed on a real attack in the audio, so a note struck
 * dead-centre in the green zone lands exactly on the melody. The chart is baked
 * rather than analysed at runtime because the analysis needs the whole decoded
 * waveform and several seconds of FFT work.
 *
 * Note density is matched to what the old random spawner produced
 * (TARGET_NOTES_PER_SECOND), so re-baking the chart does not quietly change how
 * hard the mini-game is.
 *
 * Requires `ffmpeg` on PATH.
 *
 * Run: npm run gen:keyboard-hero-chart
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { analyseOnsets, decodeMonoPcm } from './audioOnsets.js';
import { CHART_EARLIEST_HIT_MS, HIT_WINDOW_MS } from '../src/systems/keyboardHeroGeometry.js';

const TRACK_PATH = resolve('src/audio/bosses/grotesque_spider/keyboard_hero_music_track_1.mp3');
const OUT_PATH = resolve('src/systems/keyboardHeroChart.ts');

const MS_PER_SECOND = 1_000;

/**
 * Notes per second across the charted stretch. Measured from the spawner this
 * chart replaces (59 notes over its ~34 s of play) so the difficulty is unchanged.
 */
const TARGET_NOTES_PER_SECOND = 1.73;

/**
 * Closest two charted notes may sit. The track's sixteenth-note grid is ~173 ms;
 * two grid steps is the tightest pair a player can reasonably alternate on, and
 * is still slightly looser than the old spawner's 300 ms floor.
 */
const MIN_NOTE_SPACING_SEC = 0.345;

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

type ColumnIndex = 0 | 1 | 2 | 3;

function isColumnIndex(n: number): n is ColumnIndex {
  return n === 0 || n === 1 || n === 2 || n === 3;
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
): number[] {
  const byStrength = timesSec.map((_, i) => i).sort((a, b) => strengths[b] - strengths[a]);
  const chosen: number[] = [];
  for (const candidate of byStrength) {
    if (chosen.length >= targetCount) break;
    const tooClose = chosen.some(
      (picked) => Math.abs(timesSec[candidate] - timesSec[picked]) < MIN_NOTE_SPACING_SEC,
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

function formatChart(hitTimesMs: readonly number[], columns: readonly ColumnIndex[]): string {
  const rows = hitTimesMs.map((ms, i) => `  { timeMs: ${ms}, column: ${columns[i]} },`).join('\n');

  const lastHitMs = hitTimesMs[hitTimesMs.length - 1];

  return `/**
 * GENERATED FILE — do not edit by hand. Run \`npm run gen:keyboard-hero-chart\`.
 *
 * One entry per note of the keyboard-hero song. \`timeMs\` is the moment the note
 * sounds in the music, which is the moment the falling tile is centred in the
 * green hit zone. Columns follow the melody's pitch contour: low notes left,
 * high notes right.
 */

/** Which of the four columns a note falls down. */
export type KeyboardHeroColumn = 0 | 1 | 2 | 3;

export interface KeyboardHeroChartNote {
  /** Milliseconds from the start of the track to the note's attack. */
  timeMs: number;
  column: KeyboardHeroColumn;
}

export const KEYBOARD_HERO_CHART: readonly KeyboardHeroChartNote[] = [
${rows}
];

/** When the mini-game ends: the last note plus a short tail. */
export const KEYBOARD_HERO_CHART_END_MS = ${lastHitMs + SONG_OUTRO_MS};
`;
}

function main(): void {
  const pcm = decodeMonoPcm(TRACK_PATH);
  const analysis = analyseOnsets(pcm);

  const candidateIndices = analysis.timesSec
    .map((_, i) => i)
    .filter((i) => analysis.timesSec[i] * MS_PER_SECOND >= CHART_EARLIEST_HIT_MS);
  if (candidateIndices.length === 0) throw new Error('no playable onsets found in the track');

  const candidateTimes = candidateIndices.map((i) => analysis.timesSec[i]);
  const candidateStrengths = candidateIndices.map((i) => analysis.strengths[i]);
  const candidateMidi = candidateIndices.map((i) => analysis.midiNotes[i]);

  const playableSpanSec = candidateTimes[candidateTimes.length - 1] - candidateTimes[0];
  const targetCount = Math.round(playableSpanSec * TARGET_NOTES_PER_SECOND);

  const selected = selectNotes(candidateTimes, candidateStrengths, targetCount);
  const hitTimesMs = selected.map((i) => Math.round(candidateTimes[i] * MS_PER_SECOND));
  const columns = assignColumns(
    selected.map((i) => candidateMidi[i]),
    hitTimesMs,
  );

  writeFileSync(OUT_PATH, formatChart(hitTimesMs, columns));

  const columnCounts = [0, 1, 2, 3].map((c) => columns.filter((col) => col === c).length);
  console.log(`onsets detected:   ${analysis.timesSec.length}`);
  console.log(`music body ends:   ${analysis.musicEndSec.toFixed(3)} s`);
  console.log(`notes charted:     ${hitTimesMs.length} (target ${targetCount})`);
  console.log(`first / last note: ${hitTimesMs[0]} ms / ${hitTimesMs[hitTimesMs.length - 1]} ms`);
  console.log(`density:           ${(hitTimesMs.length / playableSpanSec).toFixed(2)} notes/sec`);
  console.log(`per-column counts: ${columnCounts.join(' / ')}`);
  console.log(`wrote ${OUT_PATH}`);
}

main();
