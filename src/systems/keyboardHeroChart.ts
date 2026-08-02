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
  { timeMs: 1787, column: 0 },
  { timeMs: 2477, column: 0 },
  { timeMs: 2851, column: 1 },
  { timeMs: 3540, column: 3 },
  { timeMs: 3886, column: 2 },
  { timeMs: 4231, column: 3 },
  { timeMs: 4920, column: 3 },
  { timeMs: 5266, column: 2 },
  { timeMs: 5611, column: 0 },
  { timeMs: 6300, column: 3 },
  { timeMs: 6989, column: 2 },
  { timeMs: 7335, column: 1 },
  { timeMs: 8369, column: 0 },
  { timeMs: 9403, column: 3 },
  { timeMs: 9748, column: 2 },
  { timeMs: 10093, column: 1 },
  { timeMs: 10783, column: 2 },
  { timeMs: 11473, column: 1 },
  { timeMs: 12162, column: 1 },
  { timeMs: 12852, column: 0 },
  { timeMs: 13541, column: 1 },
  { timeMs: 13886, column: 3 },
  { timeMs: 14232, column: 2 },
  { timeMs: 14920, column: 3 },
  { timeMs: 15266, column: 2 },
  { timeMs: 15956, column: 3 },
  { timeMs: 16989, column: 3 },
  { timeMs: 17679, column: 1 },
  { timeMs: 18714, column: 1 },
  { timeMs: 19059, column: 0 },
  { timeMs: 19748, column: 3 },
  { timeMs: 20438, column: 3 },
  { timeMs: 21128, column: 2 },
  { timeMs: 21817, column: 2 },
  { timeMs: 22163, column: 1 },
  { timeMs: 22851, column: 2 },
  { timeMs: 23197, column: 1 },
  { timeMs: 23716, column: 0 },
  { timeMs: 24231, column: 0 },
  { timeMs: 24576, column: 1 },
  { timeMs: 24922, column: 0 },
  { timeMs: 25610, column: 3 },
  { timeMs: 25956, column: 2 },
  { timeMs: 26645, column: 2 },
  { timeMs: 27334, column: 1 },
  { timeMs: 27680, column: 2 },
  { timeMs: 28025, column: 0 },
  { timeMs: 29058, column: 0 },
  { timeMs: 29404, column: 1 },
  { timeMs: 30094, column: 0 },
  { timeMs: 30783, column: 3 },
  { timeMs: 31472, column: 3 },
  { timeMs: 31817, column: 2 },
  { timeMs: 32163, column: 1 },
  { timeMs: 32852, column: 1 },
  { timeMs: 33541, column: 2 },
  { timeMs: 34231, column: 1 },
  { timeMs: 34577, column: 0 },
  { timeMs: 35610, column: 0 },
];

/** When the mini-game ends: the last note plus a short tail. */
export const KEYBOARD_HERO_CHART_END_MS = 36310;
