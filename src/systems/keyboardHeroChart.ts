/**
 * GENERATED FILE — do not edit by hand. Run `npm run gen:keyboard-hero-chart`.
 *
 * One entry per note of the keyboard-hero song. `timeMs` is the moment the note
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
  { timeMs: 8272, column: 2 },
  { timeMs: 9305, column: 3 },
  { timeMs: 9997, column: 3 },
  { timeMs: 10685, column: 2 },
  { timeMs: 11374, column: 3 },
  { timeMs: 11720, column: 1 },
  { timeMs: 12066, column: 2 },
  { timeMs: 12755, column: 3 },
  { timeMs: 13444, column: 0 },
  { timeMs: 14480, column: 3 },
  { timeMs: 14825, column: 2 },
  { timeMs: 15171, column: 3 },
  { timeMs: 15860, column: 2 },
  { timeMs: 16550, column: 3 },
  { timeMs: 16895, column: 0 },
  { timeMs: 17585, column: 0 },
  { timeMs: 17930, column: 1 },
  { timeMs: 18620, column: 1 },
  { timeMs: 19310, column: 1 },
  { timeMs: 19655, column: 3 },
  { timeMs: 20000, column: 2 },
  { timeMs: 20690, column: 3 },
  { timeMs: 21380, column: 2 },
  { timeMs: 22070, column: 3 },
  { timeMs: 22758, column: 1 },
  { timeMs: 23448, column: 1 },
  { timeMs: 23795, column: 3 },
  { timeMs: 24483, column: 0 },
];

/** When the mini-game ends: the last note plus a short tail. */
export const KEYBOARD_HERO_CHART_END_MS = 25183;
