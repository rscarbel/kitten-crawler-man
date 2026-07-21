import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import { drawText } from '../ui/TextBox';
import { drawModal, drawOverlay, drawBox, BOX_PRESETS } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { pointInRect } from '../utils';

// Panel geometry
const PANEL_W = 540;
const PANEL_H = 468;
const PANEL_PADDING = 24;
const OVERLAY_ALPHA = 0.6;
/** Minimum horizontal breathing room kept between the panel and the canvas edges on narrow (mobile) viewports. */
const PANEL_CANVAS_SIDE_MARGIN = 40;

const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 11;
const SUBTITLE_GAP = 22;
const COINS_SIZE = 12;
const COINS_GAP = 22;

// Service cards
const CARDS_TOP = 96;
const CARD_H = 94;
const CARD_GAP = 12;
const CARD_PAD = 14;
const CARD_NAME_SIZE = 15;
const CARD_NAME_Y = 22;
const CARD_DESC_SIZE = 11;
const CARD_DESC_Y = 44;
const CARD_STATUS_SIZE = 11;
const CARD_STATUS_Y = 68;
const ACTION_BTN_W = 128;
const ACTION_BTN_H = 44;
const ACTION_BTN_MARGIN = 14;

const FEEDBACK_SIZE = 12;
const FEEDBACK_Y_FROM_BOTTOM = 40;
const CLOSE_HINT_SIZE = 10;
const CLOSE_HINT_Y_FROM_BOTTOM = 18;

const ACCENT = '#e6c65a';
const GOLD_TEXT = '#f6e08a';
const MUTED_TEXT = '#cbb98a';
// Velvet VIP dressing — a wine-dark panel and card fills instead of the default blue-grey modal.
const VELVET_PANEL = '#1c0f16';
const VELVET_CARD = 'rgba(74,26,44,0.55)';
const VELVET_CARD_BORDER = '#7a3a52';
const BODY_TEXT = '#e8dcbe';

/** Prices for the VIP back-room services (canon-flavoured coin sinks). */
const VIP_HEAL_PRICE = 40;
const VIP_COCKTAIL_PRICE = 60;
/** The Sledge + Bomo escort pair (canon: 300/crawler, 500/pair). Free when casino wagers exceed it. */
export const BODYGUARD_PAIR_PRICE = 500;

type VipAction = { kind: 'heal' } | { kind: 'buff' } | { kind: 'escort' } | { kind: 'close' };

interface VipButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: VipAction;
}

interface VipService {
  name: string;
  desc: string;
  action: VipAction;
}

const VIP_SERVICES: ReadonlyArray<VipService> = [
  {
    name: 'Full Recovery',
    desc: 'A back-room medic patches you up completely.',
    action: { kind: 'heal' },
  },
  {
    name: 'VIP Cocktail',
    desc: 'Speed Fizz + Cooldown Crisp on the house pour.',
    action: { kind: 'buff' },
  },
  {
    name: 'Private Escort',
    desc: 'The Sledge & Bomo shadow you through the club.',
    action: { kind: 'escort' },
  },
];

/**
 * The Desperado Club's VIP Lounge — the tasteful adaptation of the book's
 * members-only back room (see plan §3.7). Sells three premium coin sinks: a
 * full heal, a short buff cocktail, and the Sledge/Bomo bodyguard escort. The
 * escort is free when the player's casino wagers this visit clear
 * {@link BODYGUARD_PAIR_PRICE} — the canon "spend enough at the tables and
 * security is free" perk. The escort is cosmetic (the club is a safe zone); the
 * host {@link DesperadoClubSystem} renders the two Cretins trailing the player.
 */
export class ClubVipLoungeSystem {
  open = false;

  /** Set when the escort is hired; the host clears it after firing the bodyguard achievement. */
  escortPending = false;

  /** True once the escort has been hired this visit; the host renders the two Cretins. */
  private escortHired = false;

  /** Casino coins wagered this visit, captured when the panel opens (the free-escort gate). */
  private wageredAtOpen = 0;

  /** Transient status line (e.g. "Not enough coins"); cleared on the next valid action. */
  private feedbackMsg = '';
  private buttons: VipButton[] = [];

  constructor(private readonly audio: AudioManager | null) {}

  get escortActive(): boolean {
    return this.escortHired;
  }

  openPanel(coinsWageredThisVisit: number): void {
    this.open = true;
    this.wageredAtOpen = coinsWageredThisVisit;
    this.feedbackMsg = '';
  }

  close(): void {
    this.open = false;
  }

  private get escortIsFree(): boolean {
    return this.wageredAtOpen > BODYGUARD_PAIR_PRICE;
  }

  private escortCost(): number {
    return this.escortIsFree ? 0 : BODYGUARD_PAIR_PRICE;
  }

  private heal(player: Player): void {
    if (player.hp >= player.maxHp) {
      this.feedbackMsg = "You're already at full health.";
      this.audio?.play('error');
      return;
    }
    if (player.coins < VIP_HEAL_PRICE) {
      this.feedbackMsg = 'Not enough coins for the medic.';
      this.audio?.play('error');
      return;
    }
    player.coins -= VIP_HEAL_PRICE;
    player.hp = player.maxHp;
    this.feedbackMsg = 'Patched up. Good as new.';
    this.audio?.play('potion_drink');
  }

  private buff(player: Player): void {
    const speedActive = player.hasStatus('speed_fizz');
    const cooldownActive = player.hasStatus('cooldown_crisp');
    if (speedActive && cooldownActive) {
      this.feedbackMsg = 'That cocktail is already coursing through you.';
      this.audio?.play('error');
      return;
    }
    if (player.coins < VIP_COCKTAIL_PRICE) {
      this.feedbackMsg = 'Not enough coins for the cocktail.';
      this.audio?.play('error');
      return;
    }
    player.coins -= VIP_COCKTAIL_PRICE;
    if (!speedActive) player.activateSpeedFizz();
    if (!cooldownActive) player.activateCooldownCrisp();
    this.feedbackMsg = 'The VIP Cocktail hits. You feel unstoppable.';
    this.audio?.play('potion_drink');
  }

  private hireEscort(player: Player): void {
    if (this.escortHired) return;
    const cost = this.escortCost();
    if (player.coins < cost) {
      this.feedbackMsg = 'The escort costs more coins than you carry.';
      this.audio?.play('error');
      return;
    }
    player.coins -= cost;
    this.escortHired = true;
    this.escortPending = true;
    this.feedbackMsg = this.escortIsFree
      ? 'On the house — the tables have been kind. Enjoy the muscle.'
      : 'The Sledge & Bomo fall in behind you.';
    this.audio?.play('purchase_success');
  }

  handleClick(mx: number, my: number, player: Player): void {
    for (const btn of this.buttons) {
      if (!pointInRect(mx, my, btn)) continue;
      const action = btn.action;
      switch (action.kind) {
        case 'heal':
          this.heal(player);
          return;
        case 'buff':
          this.buff(player);
          return;
        case 'escort':
          this.hireEscort(player);
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
      fill: VELVET_PANEL,
      border: ACCENT,
      borderWidth: 3,
      glow: ACCENT,
      glowBlur: 22,
    });

    const centerX = panel.x + panelW / 2;

    drawText(ctx, '✦  VIP  LOUNGE  ✦', {
      x: centerX,
      y: panel.inner.y,
      size: TITLE_SIZE,
      bold: true,
      color: GOLD_TEXT,
      align: 'center',
      glow: ACCENT,
    });

    drawText(ctx, 'A hush-quiet back room — velvet, privacy, and comped luxury.', {
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

    this.renderServiceCards(ctx, panel.x, panel.y, panelW, player);

    if (this.feedbackMsg !== '') {
      drawText(ctx, this.feedbackMsg, {
        x: centerX,
        y: panel.y + PANEL_H - FEEDBACK_Y_FROM_BOTTOM,
        size: FEEDBACK_SIZE,
        color: '#f0b040',
        align: 'center',
      });
    }

    drawText(ctx, '[Space / Esc]  Leave the lounge', {
      x: centerX,
      y: panel.y + PANEL_H - CLOSE_HINT_Y_FROM_BOTTOM,
      size: CLOSE_HINT_SIZE,
      color: '#9a8452',
      align: 'center',
    });
  }

  private renderServiceCards(
    ctx: CanvasRenderingContext2D,
    panelX: number,
    panelY: number,
    panelW: number,
    player: Player,
  ): void {
    const x = panelX + PANEL_PADDING;
    const w = panelW - PANEL_PADDING * 2;
    let y = panelY + CARDS_TOP;

    for (const service of VIP_SERVICES) {
      drawBox(ctx, {
        x,
        y,
        width: w,
        height: CARD_H,
        fill: VELVET_CARD,
        border: VELVET_CARD_BORDER,
        borderWidth: 1.5,
        radius: 8,
      });
      // Gold accent bar down the left edge of each service card.
      drawBox(ctx, { x, y, width: 4, height: CARD_H, fill: ACCENT, radius: 2 });

      drawText(ctx, service.name, {
        x: x + CARD_PAD,
        y: y + CARD_NAME_Y,
        size: CARD_NAME_SIZE,
        bold: true,
        color: GOLD_TEXT,
        align: 'left',
      });
      drawText(ctx, service.desc, {
        x: x + CARD_PAD,
        y: y + CARD_DESC_Y,
        size: CARD_DESC_SIZE,
        color: BODY_TEXT,
        align: 'left',
      });

      const { label, disabled, statusLine } = this.buttonStateFor(service.action, player);
      if (statusLine !== '') {
        drawText(ctx, statusLine, {
          x: x + CARD_PAD,
          y: y + CARD_STATUS_Y,
          size: CARD_STATUS_SIZE,
          color: MUTED_TEXT,
          align: 'left',
        });
      }

      const btnX = x + w - ACTION_BTN_W - ACTION_BTN_MARGIN;
      const btnY = y + (CARD_H - ACTION_BTN_H) / 2;
      drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: ACTION_BTN_W,
        height: ACTION_BTN_H,
        label,
        ...BUTTON_PRESETS.gold,
        disabled,
      });
      if (!disabled) {
        this.buttons.push({
          x: btnX,
          y: btnY,
          w: ACTION_BTN_W,
          h: ACTION_BTN_H,
          action: service.action,
        });
      }

      y += CARD_H + CARD_GAP;
    }
  }

  private buttonStateFor(
    action: VipAction,
    player: Player,
  ): { label: string; disabled: boolean; statusLine: string } {
    switch (action.kind) {
      case 'heal': {
        const atFull = player.hp >= player.maxHp;
        return {
          label: `Buy — ${VIP_HEAL_PRICE}`,
          disabled: atFull || player.coins < VIP_HEAL_PRICE,
          statusLine: atFull ? 'Already at full health.' : `${player.hp} / ${player.maxHp} HP`,
        };
      }
      case 'buff': {
        const bothActive = player.hasStatus('speed_fizz') && player.hasStatus('cooldown_crisp');
        return {
          label: `Buy — ${VIP_COCKTAIL_PRICE}`,
          disabled: bothActive || player.coins < VIP_COCKTAIL_PRICE,
          statusLine: bothActive ? 'Cocktail already active.' : '',
        };
      }
      case 'escort': {
        if (this.escortHired) {
          return {
            label: 'Hired',
            disabled: true,
            statusLine: 'The Sledge & Bomo have your back.',
          };
        }
        const free = this.escortIsFree;
        const cost = this.escortCost();
        return {
          label: free ? 'Hire — FREE' : `Hire — ${cost}`,
          disabled: player.coins < cost,
          statusLine: free ? 'Comped: your table play covers it.' : '',
        };
      }
      case 'close':
        return { label: '', disabled: true, statusLine: '' };
    }
  }
}
