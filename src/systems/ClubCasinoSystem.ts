import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import { drawText } from '../ui/TextBox';
import { drawModal, drawOverlay, drawBox, BOX_PRESETS } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { pointInRect } from '../utils';

// High-low rules
const WAGER_SMALL = 10;
const WAGER_MEDIUM = 50;
const WAGER_LARGE = 100;
const WAGER_TIERS = [WAGER_SMALL, WAGER_MEDIUM, WAGER_LARGE] as const;
const CARD_MIN = 1;
const CARD_COUNT = 13;
/** A win returns the stake plus equal winnings (1:1 payout). */
const WIN_PAYOUT_MULTIPLIER = 2;
/** Ties go to the house — a guess only wins on a strict higher/lower. */
const CARD_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

// Panel geometry
const PANEL_W = 460;
const PANEL_H = 456;
const PANEL_PADDING = 24;
const OVERLAY_ALPHA = 0.68;
/** Minimum horizontal breathing room kept between the panel and the canvas edges on narrow (mobile) viewports. */
const PANEL_CANVAS_SIDE_MARGIN = 40;

const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 11;
const SUBTITLE_GAP = 22;
const COINS_SIZE = 12;
const COINS_GAP = 24;

// Card display
const CARD_W = 76;
const CARD_H = 102;
const CARD_ROW_GAP = 44;
const CARD_AREA_TOP = 96;
const CARD_RANK_SIZE = 40;
const CARD_RANK_Y_FROM_TOP = 40;
const CARD_CAPTION_SIZE = 11;
const CARD_CAPTION_GAP = 10;
const CARD_ARROW_SIZE = 26;

// Button rows — spaced so the wager label clears the card captions and the rows never collide.
const WAGER_LABEL_Y = 232;
const WAGER_ROW_Y = 250;
const WAGER_BTN_W = 118;
const WAGER_BTN_H = 40;
const WAGER_BTN_GAP = 10;
const WAGER_LABEL_SIZE = 12;

const GUESS_ROW_Y = 308;
const GUESS_BTN_W = 182;
const GUESS_BTN_H = 48;
const GUESS_BTN_GAP = 16;

const RESULT_MSG_SIZE = 17;
const RESULT_MSG_Y = 258;
const DEAL_BTN_W = 200;
const DEAL_BTN_H = 46;
const DEAL_ROW_Y = 300;

const FEEDBACK_SIZE = 12;
const FEEDBACK_Y_FROM_BOTTOM = 60;
const CLOSE_HINT_SIZE = 11;
const CLOSE_HINT_Y_FROM_BOTTOM = 26;

// Higher-contrast text than the previous muted browns.
const SECONDARY_TEXT = '#cbbf98';
const HINT_TEXT = '#8a7648';

const WIN_MSG = 'Winner!';
const LOSE_MSG = 'House wins.';
const WIN_COLOR = '#6ee87a';
const LOSE_COLOR = '#e87a7a';

type GuessDirection = 'higher' | 'lower';
type CasinoPhase = 'guess' | 'result';

type CasinoAction =
  | { kind: 'wager'; amount: number }
  | { kind: 'guess'; direction: GuessDirection }
  | { kind: 'deal' }
  | { kind: 'close' };

interface CasinoButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: CasinoAction;
}

function drawRandomCard(): number {
  return CARD_MIN + Math.floor(Math.random() * CARD_COUNT);
}

function cardLabel(card: number): string {
  return CARD_LABELS[card - CARD_MIN];
}

/**
 * The Desperado Club casino: a single high-low coin-wager game. The player
 * picks a wager tier, sees a card, and bets whether the next card is higher or
 * lower. Ties lose. Lifetime wagers this visit accumulate toward the Phase 5
 * free-bodyguard perk via {@link coinsWageredThisVisit}.
 */
export class ClubCasinoSystem {
  open = false;
  /** Total coins staked since entering the club — the free-security perk hook. */
  coinsWageredThisVisit = 0;
  /** Set when a top-tier wager wins; the host clears it after firing the jackpot achievement. */
  jackpotPending = false;

  private currentCard = drawRandomCard();
  private nextCard: number | null = null;
  private wager: number = WAGER_TIERS[0];
  private phase: CasinoPhase = 'guess';
  private lastWin = false;

  /** Transient error line (e.g. "Not enough coins"); cleared on the next valid action. */
  private feedbackMsg = '';
  private buttons: CasinoButton[] = [];

  constructor(private readonly audio: AudioManager | null) {}

  openTable(player: Player): void {
    this.open = true;
    this.phase = 'guess';
    this.currentCard = drawRandomCard();
    this.nextCard = null;
    this.feedbackMsg = '';
    this.wager = this.defaultWager(player);
  }

  close(): void {
    this.open = false;
  }

  /** Smallest tier the player can afford, or the smallest tier if they can afford none. */
  private defaultWager(player: Player): number {
    for (const tier of WAGER_TIERS) {
      if (player.coins >= tier) return tier;
    }
    return WAGER_TIERS[0];
  }

  private selectWager(amount: number, player: Player): void {
    if (player.coins < amount) {
      this.feedbackMsg = 'Not enough coins for that wager!';
      return;
    }
    this.wager = amount;
    this.feedbackMsg = '';
  }

  private placeGuess(direction: GuessDirection, player: Player): void {
    if (this.phase !== 'guess') return;
    if (player.coins < this.wager) {
      this.feedbackMsg = 'Not enough coins!';
      return;
    }
    this.feedbackMsg = '';

    player.coins -= this.wager;
    this.coinsWageredThisVisit += this.wager;

    const drawn = drawRandomCard();
    this.nextCard = drawn;
    const won = direction === 'higher' ? drawn > this.currentCard : drawn < this.currentCard;
    this.lastWin = won;
    this.phase = 'result';

    if (won) {
      player.coins += this.wager * WIN_PAYOUT_MULTIPLIER;
      if (this.wager === WAGER_LARGE) this.jackpotPending = true;
      this.audio?.play('treasure_chest_reward');
    } else {
      this.audio?.play('powering_off');
    }
  }

  private dealAgain(player: Player): void {
    if (this.nextCard !== null) this.currentCard = this.nextCard;
    this.nextCard = null;
    this.phase = 'guess';
    this.feedbackMsg = '';
    // Keep the player's chosen wager across rounds, only stepping down if they can no longer afford it.
    if (player.coins < this.wager) this.wager = this.defaultWager(player);
  }

  handleClick(mx: number, my: number, player: Player): void {
    for (const btn of this.buttons) {
      if (!pointInRect(mx, my, btn)) continue;
      const action = btn.action;
      switch (action.kind) {
        case 'wager':
          this.selectWager(action.amount, player);
          return;
        case 'guess':
          this.placeGuess(action.direction, player);
          return;
        case 'deal':
          this.dealAgain(player);
          return;
        case 'close':
          this.close();
          return;
      }
    }
  }

  renderPanel(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, player: Player): void {
    if (!this.open) return;
    this.buttons = [];

    drawOverlay(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      alpha: OVERLAY_ALPHA,
    });
    const panelW = Math.min(PANEL_W, canvas.width - PANEL_CANVAS_SIDE_MARGIN);
    const panel = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: panelW,
      height: PANEL_H,
      padding: PANEL_PADDING,
      ...BOX_PRESETS.modal,
      border: '#c8a840',
    });

    const centerX = panel.x + panelW / 2;

    drawText(ctx, '🎲  The Casino — High or Low', {
      x: centerX,
      y: panel.inner.y,
      size: TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
    });

    drawText(ctx, 'Beat the next card. Ties pay the house.', {
      x: centerX,
      y: panel.inner.y + SUBTITLE_GAP,
      size: SUBTITLE_SIZE,
      color: SECONDARY_TEXT,
      align: 'center',
    });

    drawText(ctx, `Coins: ${player.coins}     Wagered tonight: ${this.coinsWageredThisVisit}`, {
      x: centerX,
      y: panel.inner.y + SUBTITLE_GAP + COINS_GAP,
      size: COINS_SIZE,
      color: '#d4c070',
      align: 'center',
    });

    this.renderCards(ctx, panel.y, centerX);

    if (this.phase === 'guess') {
      this.renderWagerRow(ctx, panel.y, centerX, player);
      this.renderGuessRow(ctx, panel.y, centerX);
    } else {
      this.renderResultRow(ctx, panel.y, centerX);
    }

    if (this.feedbackMsg !== '') {
      drawText(ctx, this.feedbackMsg, {
        x: centerX,
        y: panel.y + PANEL_H - FEEDBACK_Y_FROM_BOTTOM,
        size: FEEDBACK_SIZE,
        color: '#f0b040',
        align: 'center',
      });
    }

    drawText(ctx, '[Space / Esc]  Leave the table', {
      x: centerX,
      y: panel.y + PANEL_H - CLOSE_HINT_Y_FROM_BOTTOM,
      size: CLOSE_HINT_SIZE,
      color: HINT_TEXT,
      align: 'center',
    });
  }

  private renderCards(ctx: CanvasRenderingContext2D, panelY: number, centerX: number): void {
    const showingBoth = this.phase === 'result' && this.nextCard !== null;
    const cardsWidth = showingBoth ? CARD_W * 2 + CARD_ROW_GAP : CARD_W;
    const firstCardX = centerX - cardsWidth / 2;
    const cardY = panelY + CARD_AREA_TOP;

    this.renderCard(ctx, firstCardX, cardY, this.currentCard, 'Current');

    if (showingBoth && this.nextCard !== null) {
      drawText(ctx, '→', {
        x: firstCardX + CARD_W + CARD_ROW_GAP / 2,
        y: cardY + CARD_H / 2 - CARD_ARROW_SIZE / 2,
        size: CARD_ARROW_SIZE,
        color: '#c8a840',
        align: 'center',
      });
      this.renderCard(ctx, firstCardX + CARD_W + CARD_ROW_GAP, cardY, this.nextCard, 'Next');
    }
  }

  private renderCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    card: number,
    caption: string,
  ): void {
    drawBox(ctx, {
      x,
      y,
      width: CARD_W,
      height: CARD_H,
      fill: '#f4ecd8',
      border: '#c8a840',
      borderWidth: 2,
      radius: 8,
    });
    drawText(ctx, cardLabel(card), {
      x: x + CARD_W / 2,
      y: y + CARD_RANK_Y_FROM_TOP,
      size: CARD_RANK_SIZE,
      bold: true,
      color: '#2a1f10',
      align: 'center',
    });
    drawText(ctx, caption, {
      x: x + CARD_W / 2,
      y: y + CARD_H + CARD_CAPTION_GAP,
      size: CARD_CAPTION_SIZE,
      color: SECONDARY_TEXT,
      align: 'center',
    });
  }

  private renderWagerRow(
    ctx: CanvasRenderingContext2D,
    panelY: number,
    centerX: number,
    player: Player,
  ): void {
    drawText(ctx, 'Wager', {
      x: centerX,
      y: panelY + WAGER_LABEL_Y,
      size: WAGER_LABEL_SIZE,
      color: SECONDARY_TEXT,
      align: 'center',
    });

    const rowWidth = WAGER_TIERS.length * WAGER_BTN_W + (WAGER_TIERS.length - 1) * WAGER_BTN_GAP;
    let btnX = centerX - rowWidth / 2;
    const btnY = panelY + WAGER_ROW_Y;
    for (const tier of WAGER_TIERS) {
      const affordable = player.coins >= tier;
      const selected = this.wager === tier;
      drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: WAGER_BTN_W,
        height: WAGER_BTN_H,
        label: `${tier}`,
        ...(selected ? BUTTON_PRESETS.gold : BUTTON_PRESETS.primary),
        disabled: !affordable,
      });
      this.buttons.push({
        x: btnX,
        y: btnY,
        w: WAGER_BTN_W,
        h: WAGER_BTN_H,
        action: { kind: 'wager', amount: tier },
      });
      btnX += WAGER_BTN_W + WAGER_BTN_GAP;
    }
  }

  private renderGuessRow(ctx: CanvasRenderingContext2D, panelY: number, centerX: number): void {
    const rowWidth = GUESS_BTN_W * 2 + GUESS_BTN_GAP;
    const lowerX = centerX - rowWidth / 2;
    const higherX = lowerX + GUESS_BTN_W + GUESS_BTN_GAP;
    const btnY = panelY + GUESS_ROW_Y;

    drawButton(ctx, {
      x: lowerX,
      y: btnY,
      width: GUESS_BTN_W,
      height: GUESS_BTN_H,
      label: '▼ Lower',
      ...BUTTON_PRESETS.blue,
    });
    this.buttons.push({
      x: lowerX,
      y: btnY,
      w: GUESS_BTN_W,
      h: GUESS_BTN_H,
      action: { kind: 'guess', direction: 'lower' },
    });

    drawButton(ctx, {
      x: higherX,
      y: btnY,
      width: GUESS_BTN_W,
      height: GUESS_BTN_H,
      label: '▲ Higher',
      ...BUTTON_PRESETS.success,
    });
    this.buttons.push({
      x: higherX,
      y: btnY,
      w: GUESS_BTN_W,
      h: GUESS_BTN_H,
      action: { kind: 'guess', direction: 'higher' },
    });
  }

  private renderResultRow(ctx: CanvasRenderingContext2D, panelY: number, centerX: number): void {
    const won = this.lastWin;
    const detail = won
      ? `+${this.wager * WIN_PAYOUT_MULTIPLIER - this.wager} coins`
      : `-${this.wager} coins`;
    drawText(ctx, `${won ? WIN_MSG : LOSE_MSG}  ${detail}`, {
      x: centerX,
      y: panelY + RESULT_MSG_Y,
      size: RESULT_MSG_SIZE,
      bold: true,
      color: won ? WIN_COLOR : LOSE_COLOR,
      align: 'center',
    });

    const btnX = centerX - DEAL_BTN_W / 2;
    const btnY = panelY + DEAL_ROW_Y;
    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: DEAL_BTN_W,
      height: DEAL_BTN_H,
      label: 'Deal Again',
      ...BUTTON_PRESETS.gold,
    });
    this.buttons.push({
      x: btnX,
      y: btnY,
      w: DEAL_BTN_W,
      h: DEAL_BTN_H,
      action: { kind: 'deal' },
    });
  }
}
