/**
 * The seat-info card a tap on a regular's plate opens: their name and stack,
 * and the player's own read on them — only what the player has watched them
 * do. The regular's archetype, profile and tells are never on it; working
 * those out is the player's job.
 */

import { splitV, type Rect, type Track } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import { listRow } from '../widgets/listRow';
import { panel, panelBodyWidth } from '../widgets/panel';
import { measureTextHeight, text } from '../widgets/text';
import { listAt } from '../../systems/casino/poker/npc/listAt';
import {
  observedAggressionFactor,
  summarizeRead,
  type PlayerRead,
  type RaiseTendency,
} from '../../systems/casino/poker/npc/playerRead';

/**
 * Hands together before the card says how someone plays: fewer than this and
 * the figures are mostly the table average, which would read as a read the
 * player never made.
 */
export const SEAT_INFO_MIN_HANDS = 8;

/**
 * Hands together before the card describes a regular's habits in words:
 * enough that the description matches what the player could have noticed
 * themselves, so the card confirms a read rather than handing one out.
 */
export const SEAT_INFO_BIO_HANDS = 20;

/** Bets and raises per call above which a regular reads as pushing the action. */
const BETS_MORE_FACTOR = 2;
/** Below this they read as calling far more than they bet. */
const CALLS_MORE_FACTOR = 1;

/** What the card shows for one regular. */
export interface SeatInfoModel {
  readonly name: string;
  readonly stack: number;
  /** Hands dealt with the player at the table this run. */
  readonly handsTogether: number;
  /** What the player has seen of their play, or `null` before the first hand together. */
  readonly note: PlayerRead | null;
  /** The player's settled read on them, once they have played enough together; else `null`. */
  readonly bio: string | null;
}

export interface SeatInfoOptions {
  readonly id: string;
  /** The regular the card is open on, or `null` while it is closed. */
  readonly model: () => SeatInfoModel | null;
  readonly close: () => void;
}

interface SeatInfoRow {
  readonly id: string;
  readonly title: string;
  readonly value: string;
}

const RAISE_WORDS: Readonly<Record<RaiseTendency, string>> = {
  often: 'Often',
  sometimes: 'Sometimes',
  rarely: 'Rarely',
};

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

function handsLabel(count: number): string {
  return count === 1 ? '1 hand' : `${coins(count)} hands`;
}

function betsOrCalls(note: PlayerRead): string {
  const factor = observedAggressionFactor(note);
  if (factor >= BETS_MORE_FACTOR) return 'Bets and raises';
  if (factor < CALLS_MORE_FACTOR) return 'Mostly calls';
  return 'A bit of both';
}

/** The figures the card lists, or none while the player has not watched enough hands. */
export function seatInfoRows(model: SeatInfoModel): readonly SeatInfoRow[] {
  const together: SeatInfoRow = {
    id: 'hands',
    title: 'Hands together',
    value: coins(model.handsTogether),
  };
  const note = model.note;
  if (note === null || note.handsSeen < SEAT_INFO_MIN_HANDS) return [together];
  const summary = summarizeRead(note);
  return [
    together,
    { id: 'plays', title: 'Plays', value: `${summary.playsPercent}% of hands` },
    { id: 'raises', title: 'Raises going in', value: RAISE_WORDS[summary.raises] },
    { id: 'action', title: 'When they play', value: betsOrCalls(note) },
    { id: 'bluffs', title: 'Bluffs you have seen', value: coins(summary.bluffsSeen) },
  ];
}

/** The line under the figures: the player's read, or how far they are from having one. */
export function seatInfoFootnote(model: SeatInfoModel): string {
  if (model.bio !== null) return `Your read: ${model.bio}`;
  const watched = model.note?.handsSeen ?? 0;
  if (watched < SEAT_INFO_MIN_HANDS) {
    const more = SEAT_INFO_MIN_HANDS - watched;
    return `Play ${handsLabel(more)} more together to see how they play.`;
  }
  return 'Keep watching. A clearer read takes a while longer.';
}

function rowHeight(ui: Ui): number {
  return ui.theme.size.row;
}

function contentHeight(ui: Ui, model: SeatInfoModel, width: number): number {
  const rows = seatInfoRows(model).length;
  const { space } = ui.theme;
  const footnote = measureTextHeight(ui, width, {
    text: seatInfoFootnote(model),
    role: 'secondary',
  });
  return rows * rowHeight(ui) + space.md + footnote + space.sm;
}

function paintBody(ui: Ui, body: Rect, model: SeatInfoModel): void {
  const rows = seatInfoRows(model);
  const { space } = ui.theme;
  const tracks: Track[] = [...rows.map(() => rowHeight(ui)), 'fill'];
  const cells = splitV(body, tracks, 0);
  rows.forEach((row, index) => {
    const cell = listAt(cells, index);
    if (cell === undefined) return;
    listRow(ui, cell, {
      id: `row-${row.id}`,
      title: row.title,
      trailing: row.value,
      trailingRole: 'value',
    });
  });
  const rest = listAt(cells, rows.length);
  if (rest === undefined) return;
  text(
    ui,
    { ...rest, y: rest.y + space.md, h: rest.h - space.md },
    {
      text: seatInfoFootnote(model),
      role: 'secondary',
      wrap: true,
    },
  );
}

/** Modal over the table; Escape, ✕ and Done close it. */
export function pokerSeatInfoSurface(opts: SeatInfoOptions): Surface {
  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => opts.model() !== null,
    close: opts.close,
    render: (ui) => {
      const model = opts.model();
      if (model === null) return;
      panel(ui, {
        id: opts.id,
        title: model.name,
        subtitle: `Stack ${coins(model.stack)}`,
        width: 'sm',
        height: 'content',
        contentHeight: contentHeight(ui, model, panelBodyWidth(ui, 'sm')),
        scrollBody: true,
        onClose: opts.close,
        onScrimTap: opts.close,
        // A phone keeps its height for the content; ✕ is the way out there.
        footer:
          ui.size === 'compact'
            ? undefined
            : [
                {
                  id: 'done',
                  label: 'Done',
                  variant: 'secondary',
                  primary: true,
                  onTap: opts.close,
                },
              ],
        content: (body) => paintBody(ui, body, model),
      });
    },
  };
}
