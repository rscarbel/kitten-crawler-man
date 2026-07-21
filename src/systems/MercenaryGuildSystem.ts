import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import {
  MERCENARY_TEMPLATES,
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../core/mercenaryTemplates';
import { drawText } from '../ui/TextBox';
import { drawModal, drawOverlay, drawBox, BOX_PRESETS } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { pointInRect } from '../utils';

// Panel geometry
const PANEL_W = 540;
const PANEL_H = 508;
const PANEL_PADDING = 24;
const OVERLAY_ALPHA = 0.6;

const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 11;
const SUBTITLE_GAP = 22;
const COINS_SIZE = 12;
const COINS_GAP = 22;

// Active-contract banner
const BANNER_TOP = 92;
const BANNER_H = 52;
const BANNER_LABEL_SIZE = 13;
const BANNER_LABEL_Y = 18;
const DISMISS_BTN_W = 150;
const DISMISS_BTN_H = 34;
const DISMISS_BTN_MARGIN = 12;

// Hire cards
const CARDS_TOP = 160;
const CARD_H = 94;
const CARD_GAP = 12;
const CARD_PAD = 14;
const CARD_NAME_SIZE = 15;
const CARD_NAME_Y = 22;
const CARD_BLURB_SIZE = 11;
const CARD_BLURB_Y = 44;
const CARD_STATS_SIZE = 11;
const CARD_STATS_Y = 68;
const HIRE_BTN_W = 128;
const HIRE_BTN_H = 44;
const HIRE_BTN_MARGIN = 14;

const FEEDBACK_SIZE = 12;
const FEEDBACK_Y_FROM_BOTTOM = 40;
const CLOSE_HINT_SIZE = 10;
const CLOSE_HINT_Y_FROM_BOTTOM = 18;

const ACCENT = '#c8a840';
const GOLD_TEXT = '#f0d870';
const MUTED_TEXT = '#a89a70';

type GuildAction =
  | { kind: 'hire'; id: MercenaryTemplateId }
  | { kind: 'dismiss' }
  | { kind: 'close' };

interface GuildButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: GuildAction;
}

/**
 * The Desperado Club's "Meat Shields" mercenary guild hire panel (Rosemarie's
 * desk). Lists the hireable templates; signing one deducts coins and records it
 * on the persisted {@link MercenaryRoster}, which the overworld `MercenarySystem`
 * reads to spawn the ally. Only one contract is active at a time — a new hire is
 * blocked until the current merc is dismissed (or dies in the field).
 */
export class MercenaryGuildSystem {
  open = false;

  /** Transient status line (e.g. "Not enough coins"); cleared on the next valid action. */
  private feedbackMsg = '';
  private buttons: GuildButton[] = [];

  constructor(
    private readonly roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
  ) {}

  openPanel(): void {
    this.open = true;
    this.feedbackMsg = '';
  }

  close(): void {
    this.open = false;
  }

  private hire(id: MercenaryTemplateId, player: Player): void {
    if (this.roster.active !== null) {
      this.feedbackMsg = 'Dismiss your current contract first.';
      this.audio?.play('error');
      return;
    }
    const template = getMercenaryTemplate(id);
    if (player.coins < template.price) {
      this.feedbackMsg = 'Not enough coins for that contract!';
      this.audio?.play('error');
      return;
    }
    player.coins -= template.price;
    this.roster.active = { id: template.id, name: template.name };
    this.feedbackMsg = `${template.name} signs on. Meet them outside.`;
    this.audio?.play('purchase_success');
  }

  private dismiss(): void {
    if (this.roster.active === null) return;
    const name = this.roster.active.name;
    this.roster.active = null;
    this.feedbackMsg = `${name}'s contract is torn up.`;
    this.audio?.play('menu_click');
  }

  handleClick(mx: number, my: number, player: Player): void {
    for (const btn of this.buttons) {
      if (!pointInRect(mx, my, btn)) continue;
      const action = btn.action;
      switch (action.kind) {
        case 'hire':
          this.hire(action.id, player);
          return;
        case 'dismiss':
          this.dismiss();
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
    const panel = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: PANEL_W,
      height: PANEL_H,
      padding: PANEL_PADDING,
      ...BOX_PRESETS.modal,
      border: ACCENT,
    });

    const centerX = panel.x + PANEL_W / 2;

    drawText(ctx, '🗡  Meat Shields — Mercenaries Guild', {
      x: centerX,
      y: panel.inner.y,
      size: TITLE_SIZE,
      bold: true,
      color: GOLD_TEXT,
      align: 'center',
    });

    drawText(ctx, 'Rosemarie signs the contracts. One fighter walks with you at a time.', {
      x: centerX,
      y: panel.inner.y + SUBTITLE_GAP,
      size: SUBTITLE_SIZE,
      color: MUTED_TEXT,
      align: 'center',
    });

    drawText(ctx, `Coins: ${player.coins}`, {
      x: centerX,
      y: panel.inner.y + SUBTITLE_GAP + COINS_GAP,
      size: COINS_SIZE,
      color: '#d4c070',
      align: 'center',
    });

    const hasContract = this.roster.active !== null;
    if (hasContract) this.renderActiveBanner(ctx, panel.x, panel.y);
    this.renderHireCards(ctx, panel.x, panel.y, player, hasContract);

    if (this.feedbackMsg !== '') {
      drawText(ctx, this.feedbackMsg, {
        x: centerX,
        y: panel.y + PANEL_H - FEEDBACK_Y_FROM_BOTTOM,
        size: FEEDBACK_SIZE,
        color: '#f0b040',
        align: 'center',
      });
    }

    drawText(ctx, '[Space / Esc]  Leave the desk', {
      x: centerX,
      y: panel.y + PANEL_H - CLOSE_HINT_Y_FROM_BOTTOM,
      size: CLOSE_HINT_SIZE,
      color: '#5a4a30',
      align: 'center',
    });
  }

  private renderActiveBanner(ctx: CanvasRenderingContext2D, panelX: number, panelY: number): void {
    const active = this.roster.active;
    if (active === null) return;
    const template = getMercenaryTemplate(active.id);

    const x = panelX + PANEL_PADDING;
    const y = panelY + BANNER_TOP;
    const w = PANEL_W - PANEL_PADDING * 2;
    drawBox(ctx, {
      x,
      y,
      width: w,
      height: BANNER_H,
      fill: 'rgba(80,40,40,0.5)',
      border: '#a05050',
      borderWidth: 1.5,
      radius: 8,
    });

    drawText(ctx, `Contracted: ${active.name} the ${template.title}`, {
      x: x + CARD_PAD,
      y: y + BANNER_LABEL_Y,
      size: BANNER_LABEL_SIZE,
      bold: true,
      color: '#f0c0c0',
      align: 'left',
    });

    const btnX = x + w - DISMISS_BTN_W - DISMISS_BTN_MARGIN;
    const btnY = y + (BANNER_H - DISMISS_BTN_H) / 2;
    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: DISMISS_BTN_W,
      height: DISMISS_BTN_H,
      label: 'Dismiss Contract',
      ...BUTTON_PRESETS.danger,
    });
    this.buttons.push({
      x: btnX,
      y: btnY,
      w: DISMISS_BTN_W,
      h: DISMISS_BTN_H,
      action: { kind: 'dismiss' },
    });
  }

  private renderHireCards(
    ctx: CanvasRenderingContext2D,
    panelX: number,
    panelY: number,
    player: Player,
    hasContract: boolean,
  ): void {
    const x = panelX + PANEL_PADDING;
    const w = PANEL_W - PANEL_PADDING * 2;
    let y = panelY + CARDS_TOP;

    for (const template of MERCENARY_TEMPLATES) {
      drawBox(ctx, {
        x,
        y,
        width: w,
        height: CARD_H,
        fill: 'rgba(30,26,18,0.7)',
        border: '#5a4a30',
        borderWidth: 1.5,
        radius: 8,
      });

      drawText(ctx, `${template.name} — ${template.title}`, {
        x: x + CARD_PAD,
        y: y + CARD_NAME_Y,
        size: CARD_NAME_SIZE,
        bold: true,
        color: GOLD_TEXT,
        align: 'left',
      });
      drawText(ctx, template.blurb, {
        x: x + CARD_PAD,
        y: y + CARD_BLURB_Y,
        size: CARD_BLURB_SIZE,
        color: '#c8bc98',
        align: 'left',
      });
      drawText(ctx, `HP ${template.hp}    Speed ${template.speed}    Damage ${template.damage}`, {
        x: x + CARD_PAD,
        y: y + CARD_STATS_Y,
        size: CARD_STATS_SIZE,
        color: MUTED_TEXT,
        align: 'left',
      });

      const affordable = player.coins >= template.price;
      const disabled = hasContract || !affordable;
      const btnX = x + w - HIRE_BTN_W - HIRE_BTN_MARGIN;
      const btnY = y + (CARD_H - HIRE_BTN_H) / 2;
      drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: HIRE_BTN_W,
        height: HIRE_BTN_H,
        label: `Hire — ${template.price}`,
        ...BUTTON_PRESETS.gold,
        disabled,
      });
      this.buttons.push({
        x: btnX,
        y: btnY,
        w: HIRE_BTN_W,
        h: HIRE_BTN_H,
        action: { kind: 'hire', id: template.id },
      });

      y += CARD_H + CARD_GAP;
    }
  }
}
