/**
 * The run's numbers as rows: the Character screen's Stats tab lists them, and
 * floor 3's run end screen counts them up. One list, so the two never
 * disagree about what a run records or what each row is called.
 */

import { formatPlayTime, type GameStats } from '../../core/progression/GameStats';
import type { TextRole } from '../theme/skins';

/** How a row's number reads: a plain count, a clock, or a count out of a fixed total. */
export type RunStatFormat =
  | { readonly kind: 'count' }
  | { readonly kind: 'clock' }
  | { readonly kind: 'outOf'; readonly total: number };

export interface RunStatLine {
  readonly label: string;
  readonly value: number;
  readonly format: RunStatFormat;
  /** The text role whose colour the value is set in. */
  readonly role: TextRole;
}

/** The tallies the rows read. */
export type RunStatsReading = Pick<
  GameStats,
  | 'framesPlayed'
  | 'floorFramesPlayed'
  | 'totalKills'
  | 'bossesDefeated'
  | 'deaths'
  | 'damageDealt'
  | 'damageTaken'
  | 'potionsUsed'
  | 'goldEarned'
  | 'mercenariesHired'
  | 'mercenariesLost'
  | 'cowPets'
  | 'townCatPets'
>;

const COUNT: RunStatFormat = { kind: 'count' };
const CLOCK: RunStatFormat = { kind: 'clock' };

/** The first floor on which time played splits into the run's and the floor's. */
const FIRST_FLOOR_WITH_FLOOR_TIME = 2;

/**
 * Time played: one clock on the first floor, where the floor's time is the
 * run's, and the run's and the floor's side by side from the second on.
 */
function timeLines(stats: RunStatsReading, floorNumber: number): RunStatLine[] {
  if (floorNumber < FIRST_FLOOR_WITH_FLOOR_TIME) {
    return [{ label: 'Time Played', value: stats.framesPlayed, format: CLOCK, role: 'value' }];
  }
  return [
    { label: 'Total Time', value: stats.framesPlayed, format: CLOCK, role: 'value' },
    { label: 'Floor Time', value: stats.floorFramesPlayed, format: CLOCK, role: 'value' },
  ];
}

/** Left out until a mercenary is hired, since a run without one would show only zeros. */
function mercenaryLines(stats: RunStatsReading): RunStatLine[] {
  if (stats.mercenariesHired === 0) return [];
  return [
    { label: 'Mercenaries Hired', value: stats.mercenariesHired, format: COUNT, role: 'value' },
    { label: 'Mercenaries Lost', value: stats.mercenariesLost, format: COUNT, role: 'muted' },
  ];
}

/** A pet tally gets its row once the party has given one, as the mercenaries' rows wait on a hire. */
function petLines(stats: RunStatsReading): RunStatLine[] {
  const tallies = [
    { label: 'Cows Petted', count: stats.cowPets },
    { label: 'Cats Petted', count: stats.townCatPets },
  ];
  return tallies
    .filter((tally) => tally.count > 0)
    .map((tally) => ({ label: tally.label, value: tally.count, format: COUNT, role: 'success' }));
}

/** Every row of the run's numbers, read from the tallies as they stand on `floorNumber`. */
export function runStatLines(stats: RunStatsReading, floorNumber: number): RunStatLine[] {
  return [
    ...timeLines(stats, floorNumber),
    { label: 'Total Kills', value: stats.totalKills, format: COUNT, role: 'accent' },
    { label: 'Bosses Slain', value: stats.bossesDefeated, format: COUNT, role: 'accent' },
    { label: 'Deaths', value: stats.deaths, format: COUNT, role: 'danger' },
    { label: 'Damage Dealt', value: stats.damageDealt, format: COUNT, role: 'value' },
    { label: 'Damage Taken', value: stats.damageTaken, format: COUNT, role: 'danger' },
    { label: 'Potions Used', value: stats.potionsUsed, format: COUNT, role: 'success' },
    { label: 'Gold Earned', value: stats.goldEarned, format: COUNT, role: 'accent' },
    ...mercenaryLines(stats),
    ...petLines(stats),
  ];
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** A row's number as it reads, at `shown` (its full value unless a count-up is part way). */
export function formatRunStat(line: RunStatLine, shown: number = line.value): string {
  const { format } = line;
  switch (format.kind) {
    case 'count':
      return formatCount(shown);
    case 'clock':
      return formatPlayTime(shown);
    case 'outOf':
      return `${formatCount(shown)} / ${formatCount(format.total)}`;
    default: {
      const unhandled: never = format;
      return unhandled;
    }
  }
}
