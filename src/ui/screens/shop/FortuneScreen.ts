/**
 * The fortune teller's table: a coin per reading, three face-down cards, and
 * the fortune the turned card tells. Then Draw Again for another coin, or
 * Close. The plaza's seer and Old Hilda in her kitchen are the same table
 * with different readers.
 */

import { canAffordCoins, partyCoins, spendPartyCoins } from '../../../core/partyCoins';
import { drawFortune, drawHildaReading } from '../../../dialog/scripts/fortuneTeller';
import type { TownDialogContext } from '../../../systems/townDialog';
import { centerIn, inset, splitH, splitV } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import { card } from '../../widgets/card';
import { panel, panelBodyWidth } from '../../widgets/panel';
import { skinsFor } from '../../theme/skins';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { coinPurse, measureCoinPurse } from './shopParts';
import type { ShopParty } from './shopSession';

/** Who is doing the reading: the panel's title, the price, and the deck they read from. */
export interface FortuneReader {
  readonly name: string;
  /** Coins per reading. */
  readonly cost: number;
  /** The line under the title, before a card is turned. */
  readonly invitation: string;
  readonly draw: (context: TownDialogContext) => string;
}

const PLAZA_SEER_COST = 3;
const HEDGE_WITCH_COST = 2;

/** The plaza pays for the theatre. */
export const PLAZA_SEER: FortuneReader = {
  name: 'Madame Voss, Seer',
  cost: PLAZA_SEER_COST,
  invitation: `Cross my palm with silver — ${PLAZA_SEER_COST} coins a reading.`,
  draw: drawFortune,
};

/** Hilda reads at her own table for less, and does not own a deck. */
export const HEDGE_WITCH: FortuneReader = {
  name: 'Old Hilda',
  cost: HEDGE_WITCH_COST,
  invitation: `${HEDGE_WITCH_COST} coins, and I will tell you what I actually see.`,
  draw: drawHildaReading,
};

/** The table's state: who reads, for whom, and the fortune on the turned card. */
export class FortuneTable {
  private openNow = false;
  private reader: FortuneReader = PLAZA_SEER;
  private context: TownDialogContext | null = null;
  private fortuneText: string | null = null;

  get isOpen(): boolean {
    return this.openNow;
  }

  get currentReader(): FortuneReader {
    return this.reader;
  }

  /** The turned card's fortune, or null while the cards are face down. */
  get fortune(): string | null {
    return this.fortuneText;
  }

  openWith(context: TownDialogContext, reader: FortuneReader = PLAZA_SEER): void {
    this.openNow = true;
    this.reader = reader;
    this.context = context;
    this.fortuneText = null;
  }

  close(): void {
    this.openNow = false;
    this.context = null;
    this.fortuneText = null;
  }

  canAfford(party: ShopParty): boolean {
    return canAffordCoins(party.active, party.companion, this.reader.cost);
  }

  /** Takes the reader's fee and turns a card. Does nothing the party cannot pay for. */
  payAndReveal(party: ShopParty): void {
    if (!this.canAfford(party) || this.context === null) return;
    spendPartyCoins(party.active, party.companion, this.reader.cost, party.active);
    this.fortuneText = this.reader.draw(this.context);
  }
}

const CARD_COUNT = 3;
/** A face-down card is this much taller than it is wide. */
const CARD_ASPECT = 1.4;
/** The tallest a face-down card is drawn, so a tall screen does not stretch the deck. */
const CARD_MAX_HEIGHT = 140;
/** The face-down cards' glyph fills this fraction of the card's width. */
const CARD_GLYPH_SCALE = 0.4;
/** The fortune's card is at least this many lines tall, so a one-liner still reads as a card. */
const FORTUNE_MIN_LINES = 3;

export interface FortuneScreenOptions {
  readonly id: string;
  readonly table: FortuneTable;
  readonly party: () => ShopParty;
}

/** The fortune teller's table as a surface: halts the world, keeps the keyboard, closes on Escape or a tap outside. */
export function fortuneScreenSurface(opts: FortuneScreenOptions): Surface {
  const { table } = opts;
  const close = (): void => table.close();
  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => table.isOpen,
    close,
    render: (ui) => renderFortune(ui, opts.id, table, opts.party(), close),
  };
}

function renderFortune(
  ui: Ui,
  id: string,
  table: FortuneTable,
  party: ShopParty,
  close: () => void,
): void {
  const { space } = ui.theme;
  const reader = table.currentReader;
  const affordable = table.canAfford(party);
  const refusal = affordable ? undefined : `A reading costs ${reader.cost} coins.`;
  const fortune = table.fortune;
  const lineH = lineHeightOf(ui, 'body');
  const deckH = CARD_MAX_HEIGHT;
  const cardPad = skinsFor(ui.theme).panel.inset.padding;
  const quote = fortune === null ? '' : `“${fortune}”`;
  const quoteW = panelBodyWidth(ui, 'sm') - cardPad * 2;
  const quoteH = Math.max(
    lineH * FORTUNE_MIN_LINES,
    measureTextHeight(ui, quoteW, { text: quote, role: 'body' }),
  );
  const fortuneH = quoteH + cardPad * 2;
  const contentHeight = lineH + space.md + (fortune === null ? deckH : fortuneH);

  const p = panel(ui, {
    id,
    title: reader.name,
    width: 'sm',
    height: 'content',
    contentHeight,
    onClose: close,
    onScrimTap: close,
    footer:
      fortune === null
        ? [{ id: 'leave', label: 'Close', primary: true, onTap: close }]
        : [
            {
              id: 'again',
              label: `Draw again · ${reader.cost}`,
              icon: 'coin',
              variant: 'primary',
              disabled: refusal,
              onTap: () => table.payAndReveal(party),
            },
            { id: 'leave', label: 'Close', primary: true, onTap: close },
          ],
  });

  const [lineRow, stage] = splitV(p.body, [lineH, 'fill'], space.md);
  const coins = partyCoins(party.active, party.companion);
  const purseW = measureCoinPurse(ui, coins);
  coinPurse(ui, { ...lineRow, x: lineRow.x + lineRow.w - purseW, w: purseW }, coins);
  text(ui, inset(lineRow, { r: purseW + space.sm }), {
    text: fortune === null ? reader.invitation : '',
    role: affordable || fortune !== null ? 'secondary' : 'muted',
  });

  if (fortune === null) {
    const cellW = (stage.w - space.md * (CARD_COUNT - 1)) / CARD_COUNT;
    const cardH = Math.min(stage.h, CARD_MAX_HEIGHT, cellW * CARD_ASPECT);
    const cardW = cardH / CARD_ASPECT;
    const row = centerIn(stage, cardW * CARD_COUNT + space.md * (CARD_COUNT - 1), cardH);
    const cells = splitH(
      row,
      Array.from({ length: CARD_COUNT }, () => cardW),
      space.md,
    );
    cells.forEach((cell, index) => {
      card(ui, cell, {
        id: `${id}/card-${index}`,
        accent: ui.theme.palette.category.book,
        disabled: refusal,
        onTap: () => table.payAndReveal(party),
        content: () => {
          const side = cell.w * CARD_GLYPH_SCALE;
          drawGlyph(ui.ctx, 'sparkle', centerIn(cell, side, side), {
            color: ui.theme.palette.category.book,
          });
        },
      });
    });
    return;
  }

  const result = card(ui, stage, { id: `${id}/fortune`, kind: 'inset' });
  const textH = Math.min(
    result.body.h,
    measureTextHeight(ui, result.body.w, { text: quote, role: 'body' }),
  );
  text(ui, centerIn(result.body, result.body.w, textH), {
    text: quote,
    role: 'body',
    align: 'center',
    wrap: true,
  });
}
