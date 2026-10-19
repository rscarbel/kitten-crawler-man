/**
 * GENERATED FILE — do not edit by hand. Run `npm run gen:keyboard-hero-chart`.
 *
 * One chart per difficulty tier for the keyboard-hero song. `timeMs` is the
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

const KITTEN_NOTES: readonly KeyboardHeroChartNote[] = [
  { timeMs: 2755, column: 2 },
  { timeMs: 3790, column: 3 },
  { timeMs: 4480, column: 3 },
  { timeMs: 5169, column: 2 },
  { timeMs: 5858, column: 0 },
  { timeMs: 6892, column: 1 },
  { timeMs: 7583, column: 1 },
  { timeMs: 8272, column: 2 },
  { timeMs: 9305, column: 3 },
  { timeMs: 9997, column: 3 },
  { timeMs: 10685, column: 2 },
  { timeMs: 11374, column: 3 },
  { timeMs: 12066, column: 2 },
  { timeMs: 12755, column: 3 },
  { timeMs: 13444, column: 0 },
  { timeMs: 14480, column: 3 },
  { timeMs: 15171, column: 3 },
  { timeMs: 15860, column: 2 },
  { timeMs: 16550, column: 3 },
  { timeMs: 17241, column: 0 },
  { timeMs: 17930, column: 1 },
  { timeMs: 18620, column: 1 },
  { timeMs: 19310, column: 1 },
  { timeMs: 20000, column: 3 },
  { timeMs: 20690, column: 3 },
  { timeMs: 21380, column: 2 },
  { timeMs: 22070, column: 3 },
  { timeMs: 22758, column: 1 },
  { timeMs: 23448, column: 1 },
  { timeMs: 24483, column: 0 },
];

const CRAWLER_NOTES: readonly KeyboardHeroChartNote[] = [
  { timeMs: 2755, column: 2 },
  { timeMs: 3273, column: 3 },
  { timeMs: 3790, column: 3 },
  { timeMs: 4480, column: 3 },
  { timeMs: 4825, column: 2 },
  { timeMs: 5341, column: 3 },
  { timeMs: 5858, column: 0 },
  { timeMs: 6203, column: 1 },
  { timeMs: 6892, column: 1 },
  { timeMs: 7583, column: 1 },
  { timeMs: 8272, column: 2, chordId: 0 },
  { timeMs: 8272, column: 3, chordId: 0 },
  { timeMs: 9305, column: 3 },
  { timeMs: 9997, column: 3 },
  { timeMs: 10685, column: 2 },
  { timeMs: 11374, column: 3 },
  { timeMs: 11720, column: 1 },
  { timeMs: 12066, column: 2, chordId: 1 },
  { timeMs: 12066, column: 3, chordId: 1 },
  { timeMs: 12755, column: 3 },
  { timeMs: 13444, column: 0, chordId: 2 },
  { timeMs: 13444, column: 1, chordId: 2 },
  { timeMs: 14480, column: 3 },
  { timeMs: 14825, column: 2 },
  { timeMs: 15171, column: 3 },
  { timeMs: 15860, column: 2 },
  { timeMs: 16550, column: 3 },
  { timeMs: 16895, column: 0 },
  { timeMs: 17585, column: 0 },
  { timeMs: 17930, column: 1 },
  { timeMs: 18620, column: 1 },
  { timeMs: 19310, column: 0, chordId: 3 },
  { timeMs: 19310, column: 1, chordId: 3 },
  { timeMs: 19655, column: 3 },
  { timeMs: 20000, column: 2 },
  { timeMs: 20690, column: 3 },
  { timeMs: 21380, column: 2 },
  { timeMs: 22070, column: 3 },
  { timeMs: 22758, column: 1 },
  { timeMs: 23448, column: 1 },
  { timeMs: 23795, column: 3 },
  { timeMs: 24483, column: 0, chordId: 4 },
  { timeMs: 24483, column: 1, chordId: 4 },
];

const NIGHTMARE_NOTES: readonly KeyboardHeroChartNote[] = [
  { timeMs: 2755, column: 2 },
  { timeMs: 3100, column: 3 },
  { timeMs: 3445, column: 3 },
  { timeMs: 3790, column: 3 },
  { timeMs: 4135, column: 2 },
  { timeMs: 4480, column: 3 },
  { timeMs: 4825, column: 1, chordId: 0 },
  { timeMs: 4825, column: 2, chordId: 0 },
  { timeMs: 5169, column: 2 },
  { timeMs: 5514, column: 3 },
  { timeMs: 5858, column: 0 },
  { timeMs: 6203, column: 0 },
  { timeMs: 6547, column: 0 },
  { timeMs: 6892, column: 1 },
  { timeMs: 7238, column: 0, chordId: 1 },
  { timeMs: 7238, column: 2, chordId: 1 },
  { timeMs: 7583, column: 1 },
  { timeMs: 7927, column: 1 },
  { timeMs: 8272, column: 2 },
  { timeMs: 8616, column: 3 },
  { timeMs: 8961, column: 3 },
  { timeMs: 9305, column: 2, chordId: 2 },
  { timeMs: 9305, column: 3, chordId: 2 },
  { timeMs: 9822, column: 2 },
  { timeMs: 9997, column: 3 },
  { timeMs: 10341, column: 2 },
  { timeMs: 10685, column: 2 },
  { timeMs: 11029, column: 3 },
  { timeMs: 11374, column: 3 },
  { timeMs: 12066, column: 1, chordId: 3 },
  { timeMs: 12066, column: 2, chordId: 3 },
  { timeMs: 12410, column: 2 },
  { timeMs: 12582, column: 3 },
  { timeMs: 12755, column: 2 },
  { timeMs: 13100, column: 2 },
  { timeMs: 13444, column: 0, chordId: 4 },
  { timeMs: 13444, column: 1, chordId: 4 },
  { timeMs: 13789, column: 2 },
  { timeMs: 14480, column: 3 },
  { timeMs: 15171, column: 2, chordId: 5 },
  { timeMs: 15171, column: 3, chordId: 5 },
  { timeMs: 16550, column: 3 },
  { timeMs: 16895, column: 0 },
  { timeMs: 17585, column: 0 },
  { timeMs: 17930, column: 1 },
  { timeMs: 18276, column: 0, chordId: 6 },
  { timeMs: 18276, column: 2, chordId: 6 },
  { timeMs: 18620, column: 1 },
  { timeMs: 18966, column: 1 },
  { timeMs: 19310, column: 0, chordId: 7 },
  { timeMs: 19310, column: 1, chordId: 7 },
  { timeMs: 20000, column: 3 },
  { timeMs: 20346, column: 3 },
  { timeMs: 20690, column: 3 },
  { timeMs: 21036, column: 1, chordId: 8 },
  { timeMs: 21036, column: 2, chordId: 8 },
  { timeMs: 21380, column: 2 },
  { timeMs: 21724, column: 2 },
  { timeMs: 22070, column: 3 },
  { timeMs: 22414, column: 3 },
  { timeMs: 22758, column: 1 },
  { timeMs: 23105, column: 2 },
  { timeMs: 23448, column: 1 },
  { timeMs: 24138, column: 2 },
  { timeMs: 24483, column: 0, chordId: 9 },
  { timeMs: 24483, column: 1, chordId: 9 },
];

export const KEYBOARD_HERO_CHARTS: Readonly<Record<Difficulty, KeyboardHeroChart>> = {
  easy: { notes: KITTEN_NOTES, endMs: 25183 },
  normal: { notes: CRAWLER_NOTES, endMs: 25183 },
  hard: { notes: NIGHTMARE_NOTES, endMs: 25183 },
};
