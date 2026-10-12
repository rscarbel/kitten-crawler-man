/**
 * The hand history: the table's last hands, newest first, each with who won
 * what, the winning hand, the player's two cards beside the board, and what
 * the hand did to the player's stack. Opened from the table's footer and kept
 * off the felt, which has no room for it.
 */

import type { Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import type { TextRole } from '../theme/skins';
import { listRow, listRowHeight } from '../widgets/listRow';
import { panel } from '../widgets/panel';
import { measureText, text } from '../widgets/text';
import { CARD_ASPECT, drawCardFace } from './PlayingCard';
import type { Card } from '../../systems/casino/Deck';
import {
  HAND_HISTORY_LIMIT,
  type HandHistoryEntry,
  type HandHistoryPot,
} from '../../systems/casino/poker/handHistory';

export interface PokerHistoryOptions {
  readonly id: string;
  readonly isOpen: () => boolean;
  /** Newest first. */
  readonly entries: () => ReadonlyArray<HandHistoryEntry>;
  readonly close: () => void;
}

const TITLE = 'Hand history';
const SUBTITLE = `The last ${HAND_HISTORY_LIMIT} hands at this table.`;
const EMPTY_LINE = 'No hands finished yet. Each one is listed here once its pot is pushed.';
const UNCONTESTED_LINE = 'Everyone else folded';
const YOUR_CARDS_LABEL = 'You';
const BOARD_LABEL = 'Board';
const NO_BOARD_LINE = 'No flop';
const MINUS_SIGN = '−';

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

function signedCoins(amount: number): string {
  if (amount === 0) return '±0';
  return amount < 0 ? `${MINUS_SIGN}${coins(-amount)}` : `+${coins(amount)}`;
}

function netRole(amount: number): TextRole {
  if (amount > 0) return 'success';
  if (amount < 0) return 'danger';
  return 'muted';
}

function potWords(pot: HandHistoryPot): string {
  const shared = pot.winners.length > 1;
  const who = pot.winners.length === 0 ? 'Nobody' : pot.winners.join(' and ');
  const which = pot.side ? ' side pot' : '';
  return `${who} ${shared ? 'split' : 'won'} ${coins(pot.amount)}${which}`;
}

/**
 * "Hand 12 · Wren won 240", "Hand 12 · Wren and You split 240", or one
 * clause per pot when there were side pots: "Hand 12 · Wren won 200 · Bo won
 * 40 side pot". A pot is only ever called split when that pot was shared.
 */
export function historyTitle(entry: HandHistoryEntry): string {
  const pots = entry.pots.map(potWords);
  const told = pots.length === 0 ? [`Nobody won ${coins(entry.pot)}`] : pots;
  return [`Hand ${entry.handNumber}`, ...told].join(' · ');
}

/** As tall as an item slot: the cards' corner indices stay readable at every UI size. */
function stripHeight(ui: Ui): number {
  return ui.theme.size.slot;
}

function blockHeight(ui: Ui): number {
  return listRowHeight(ui, true) + stripHeight(ui);
}

/** The most cards a row shows: the player's two and a full board. */
const STRIP_CARDS = 7;

function paintCards(
  ui: Ui,
  cards: ReadonlyArray<Card>,
  x: number,
  y: number,
  cardW: number,
): number {
  let cursor = x;
  for (const card of cards) {
    drawCardFace(ui.ctx, card, { x: cursor, y, width: cardW });
    cursor += cardW + ui.theme.space.xxs;
  }
  return cursor;
}

function paintStrip(ui: Ui, rect: Rect, entry: HandHistoryEntry): void {
  const { space } = ui.theme;
  const yourW = measureText(ui, YOUR_CARDS_LABEL, { role: 'muted' });
  const boardW = measureText(ui, BOARD_LABEL, { role: 'muted' });
  const fixed = space.md * 2 + yourW + boardW + space.xs * 2 + space.md;
  const gaps = space.xxs * STRIP_CARDS;
  // Cards fill the strip's height unless a narrow sheet needs them smaller to fit seven.
  const byHeight = (rect.h - space.xs * 2) / CARD_ASPECT;
  const byWidth = (rect.w - fixed - gaps) / STRIP_CARDS;
  const cardW = Math.max(0, Math.min(byHeight, byWidth));
  const cardY = rect.y + (rect.h - cardW * CARD_ASPECT) / 2;
  let x = rect.x + space.md;
  const label = (words: string, w: number): void => {
    text(ui, { x, y: rect.y, w, h: rect.h }, { text: words, role: 'muted' });
    x += w + space.xs;
  };
  label(YOUR_CARDS_LABEL, yourW);
  x = paintCards(ui, entry.playerCards, x, cardY, cardW) + space.md;
  label(BOARD_LABEL, boardW);
  if (entry.board.length === 0) {
    text(
      ui,
      { x, y: rect.y, w: Math.max(0, rect.x + rect.w - x), h: rect.h },
      {
        text: NO_BOARD_LINE,
        role: 'muted',
      },
    );
    return;
  }
  paintCards(ui, entry.board, x, cardY, cardW);
}

function paintEntry(ui: Ui, rect: Rect, entry: HandHistoryEntry): void {
  const rowH = listRowHeight(ui, true);
  listRow(
    ui,
    { ...rect, h: rowH },
    {
      id: `hand-${entry.handNumber}`,
      title: historyTitle(entry),
      subtitle: entry.winningHand ?? UNCONTESTED_LINE,
      trailing: signedCoins(entry.playerNet),
      trailingRole: netRole(entry.playerNet),
    },
  );
  paintStrip(ui, { x: rect.x, y: rect.y + rowH, w: rect.w, h: stripHeight(ui) }, entry);
}

/** Modal over the table; Escape, ✕ and Done close it. */
export function pokerHistorySurface(opts: PokerHistoryOptions): Surface {
  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: opts.isOpen,
    close: opts.close,
    render: (ui) => {
      const entries = opts.entries();
      const { space } = ui.theme;
      const block = blockHeight(ui);
      const contentHeight =
        entries.length === 0
          ? ui.theme.size.row
          : entries.length * block + (entries.length - 1) * space.sm;
      panel(ui, {
        id: opts.id,
        title: TITLE,
        subtitle: SUBTITLE,
        width: 'md',
        height: 'content',
        contentHeight,
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
        content: (body) => {
          if (entries.length === 0) {
            text(ui, body, { text: EMPTY_LINE, role: 'secondary', wrap: true });
            return;
          }
          entries.forEach((entry, index) => {
            paintEntry(
              ui,
              { x: body.x, y: body.y + index * (block + space.sm), w: body.w, h: block },
              entry,
            );
          });
        },
      });
    },
  };
}
