/**
 * On-screen readout for `difficultyStats`, reached via `?difficulty`.
 *
 * Lives here rather than beside the counters so a release build has no import
 * edge to it at all — see the module comment on `devBoot.ts`. Its whole job is
 * to end a playtest with target-feel numbers instead of an impression: HP left
 * after a room fight, potions per segment, deaths per floor, seconds per fight.
 */

import {
  DIFFICULTY_SEGMENTS,
  difficultyStats,
  type DifficultySegment,
} from '../core/DifficultyStats';
import { DIFFICULTY_LABELS } from '../core/difficultyProfiles';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

const PANEL_WIDTH = 420;
const PANEL_MARGIN = 8;
const PANEL_PADDING = 8;
const PANEL_RADIUS = 4;
const ROW_HEIGHT = 13;
const HEADER_ROWS = 1;

/** Column x-offsets inside the panel, in pixels from its inner left edge. */
const COLUMN_SEGMENT = 0;
const COLUMN_HP = 116;
const COLUMN_POTIONS = 162;
const COLUMN_DAMAGE = 196;
const COLUMN_DODGES = 234;
const COLUMN_DEATHS = 268;
const COLUMN_SECONDS = 296;
const COLUMN_DESCENTS = 332;
const COLUMN_UNDERLEVELED = 370;

/** A blank row's height between the segment table and the hunt-time footer. */
const FOOTER_GAP_ROWS = 1;
const FOOTER_HEADER_ROWS = 1;

const FRAMES_PER_SECOND = 60;

const HUNT_FLOOR_1 = 1;
const HUNT_FLOOR_2 = 2;
const HUNT_FLOOR_3 = 3;
const HUNT_FLOOR_NUMBERS: readonly number[] = [HUNT_FLOOR_1, HUNT_FLOOR_2, HUNT_FLOOR_3];
const HUNT_FLOOR_LABELS: Record<number, string> = {
  [HUNT_FLOOR_1]: 'floor 1',
  [HUNT_FLOOR_2]: 'floor 2',
  [HUNT_FLOOR_3]: 'floor 3',
};

/** Short segment labels — the full ids do not fit the column. */
const SEGMENT_LABELS: Record<DifficultySegment, string> = {
  'floor1-pre-hoarder': 'f1 pre-hoard',
  'floor1-post-hoarder': 'f1 post-hoard',
  'floor1-post-juicer': 'f1 post-juice',
  floor2: 'floor 2',
  floor3: 'floor 3',
};

const PERCENT_SCALE = 100;
const SECONDS_DECIMALS = 1;
const LEVEL_DELTA_DECIMALS = 1;

/** Target "HP remaining after a regular room fight" band; see docs/difficulty-fairness-rules.md. */
const HP_TARGET_MIN_FRACTION = 0.4;
const HP_TARGET_MAX_FRACTION = 0.7;

/** Shown wherever a segment has no fights to average yet. */
const NO_DATA = '—';

interface DifficultyRow {
  readonly label: string;
  readonly hp: string;
  readonly hpColor: string;
  readonly potions: string;
  readonly damage: string;
  readonly dodges: string;
  readonly deaths: string;
  readonly seconds: string;
  readonly descents: string;
  readonly underleveled: string;
}

function buildRow(segment: DifficultySegment): DifficultyRow | null {
  const tally = difficultyStats.tallyFor(segment);
  if (tally === null) return null;
  const hasFights = tally.roomFights > 0;
  const meanHpFraction = hasFights ? tally.hpRemainingSum / tally.roomFights : 0;
  const isOnTarget =
    meanHpFraction >= HP_TARGET_MIN_FRACTION && meanHpFraction <= HP_TARGET_MAX_FRACTION;
  // The tag names the tier this segment's numbers were actually measured
  // under — stamped on the tally when it opened, not read live, so it stays
  // correct even if the player flips difficulty mid-run.
  const tag = DIFFICULTY_LABELS[tally.difficulty][0];
  return {
    label: `${SEGMENT_LABELS[segment]} [${tag}]`,
    hp: hasFights ? `${Math.round(meanHpFraction * PERCENT_SCALE)}%` : NO_DATA,
    hpColor: !hasFights
      ? TEXT_PRESETS.label.color
      : isOnTarget
        ? TEXT_PRESETS.value.color
        : TEXT_PRESETS.danger.color,
    potions: `${tally.potionsUsed}`,
    damage: `${Math.round(tally.damageTaken)}`,
    dodges: `${tally.dodges}`,
    deaths: `${tally.deaths}`,
    seconds: hasFights
      ? (tally.fightSecondsSum / tally.roomFights).toFixed(SECONDS_DECIMALS)
      : NO_DATA,
    descents: `${tally.descents}`,
    underleveled:
      tally.descendedUnderleveled > 0
        ? `${tally.descendedUnderleveled} (+${(tally.descendedLevelDeltaSum / tally.descendedUnderleveled).toFixed(LEVEL_DELTA_DECIMALS)})`
        : NO_DATA,
  };
}

/** One row of the stairwell-hunt footer: last gauntlet boss death to first stairwell found. */
function buildHuntRow(floorNumber: number): { label: string; seconds: string } {
  const frames = difficultyStats.stairwellHuntFramesFor(floorNumber);
  return {
    label: HUNT_FLOOR_LABELS[floorNumber] ?? `floor ${floorNumber}`,
    seconds: frames === null ? NO_DATA : (frames / FRAMES_PER_SECOND).toFixed(SECONDS_DECIMALS),
  };
}

export function drawDifficultyOverlay(ctx: CanvasRenderingContext2D): void {
  const rows: DifficultyRow[] = [];
  for (const segment of DIFFICULTY_SEGMENTS) {
    const row = buildRow(segment);
    if (row !== null) rows.push(row);
  }
  const huntRows = HUNT_FLOOR_NUMBERS.map(buildHuntRow);

  const totalRows =
    rows.length + HEADER_ROWS + FOOTER_GAP_ROWS + FOOTER_HEADER_ROWS + huntRows.length;
  const { inner } = drawBox(ctx, {
    x: PANEL_MARGIN,
    y: PANEL_MARGIN,
    width: PANEL_WIDTH,
    height: totalRows * ROW_HEIGHT + PANEL_PADDING * 2,
    radius: PANEL_RADIUS,
    padding: PANEL_PADDING,
    ...BOX_PRESETS.panel,
  });

  const columns: ReadonlyArray<readonly [number, string]> = [
    [COLUMN_SEGMENT, 'segment'],
    [COLUMN_HP, 'hp%'],
    [COLUMN_POTIONS, 'pot'],
    [COLUMN_DAMAGE, 'dmg'],
    [COLUMN_DODGES, 'dodge'],
    [COLUMN_DEATHS, 'die'],
    [COLUMN_SECONDS, 'sec'],
    [COLUMN_DESCENTS, 'desc'],
    [COLUMN_UNDERLEVELED, 'under'],
  ];
  for (const [offset, label] of columns) {
    drawText(ctx, label, { x: inner.x + offset, y: inner.y, ...TEXT_PRESETS.hint });
  }

  rows.forEach((row, index) => {
    const y = inner.y + (index + HEADER_ROWS) * ROW_HEIGHT;
    const cells: ReadonlyArray<readonly [number, string, string]> = [
      [COLUMN_SEGMENT, row.label, TEXT_PRESETS.label.color],
      [COLUMN_HP, row.hp, row.hpColor],
      [COLUMN_POTIONS, row.potions, TEXT_PRESETS.value.color],
      [COLUMN_DAMAGE, row.damage, TEXT_PRESETS.value.color],
      [COLUMN_DODGES, row.dodges, TEXT_PRESETS.value.color],
      [COLUMN_DEATHS, row.deaths, TEXT_PRESETS.value.color],
      [COLUMN_SECONDS, row.seconds, TEXT_PRESETS.value.color],
      [COLUMN_DESCENTS, row.descents, TEXT_PRESETS.value.color],
      [COLUMN_UNDERLEVELED, row.underleveled, TEXT_PRESETS.value.color],
    ];
    for (const [offset, text, color] of cells) {
      drawText(ctx, text, { x: inner.x + offset, y, ...TEXT_PRESETS.hint, color });
    }
  });

  // Hunt time is keyed by floor, not segment — a floor's whole "last boss dead
  // to stairwell found" stretch spans what may be several segments on floor 1
  // — so it gets its own footer table below the per-segment one.
  const footerHeaderY = inner.y + (rows.length + HEADER_ROWS + FOOTER_GAP_ROWS) * ROW_HEIGHT;
  drawText(ctx, 'stairwell hunt (last gauntlet boss → found)', {
    x: inner.x + COLUMN_SEGMENT,
    y: footerHeaderY,
    ...TEXT_PRESETS.hint,
  });
  huntRows.forEach((row, index) => {
    const y = footerHeaderY + (index + FOOTER_HEADER_ROWS) * ROW_HEIGHT;
    drawText(ctx, row.label, { x: inner.x + COLUMN_SEGMENT, y, ...TEXT_PRESETS.hint });
    drawText(ctx, row.seconds === NO_DATA ? NO_DATA : `${row.seconds}s`, {
      x: inner.x + COLUMN_HP,
      y,
      ...TEXT_PRESETS.hint,
      color: TEXT_PRESETS.value.color,
    });
  });
}
