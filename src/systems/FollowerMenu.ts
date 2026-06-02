import { drawText } from '../ui/TextBox';
import type { MovementMode, CombatStance } from './CompanionSystem';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Menu dimensions
const MENU_PANEL_WIDTH = 360;
const MENU_PANEL_HEIGHT = 380;
const MENU_TITLE_Y_OFFSET = 42;
const MENU_BUTTON_WIDTH = 320;
const MENU_BUTTON_HEIGHT = 48;
const MENU_BUTTON_COUNT = 4;

// Menu layout spacing
const MENU_INITIAL_Y_OFFSET = 62;
const MENU_SECTION_HEADER_SIZE = 10;
const MENU_SECTION_HEADER_Y_OFFSET = 18;
const MENU_SECTION_SPACING = 10;
const MENU_BUTTON_SPACING = 8;

// Menu styling
const MENU_BACKDROP_ALPHA = 0.65;
const MENU_PANEL_BG_COLOR = '#111927';
const MENU_PANEL_BORDER_COLOR = '#5a8fc5';
const MENU_PANEL_BORDER_WIDTH = 2;
const MENU_TITLE_BOLD_FONT = 'bold 22px monospace';

// Button styling
const BUTTON_ACTIVE_BG = 'rgba(90,143,197,0.3)';
const BUTTON_INACTIVE_BG = 'rgba(255,255,255,0.05)';
const BUTTON_ACTIVE_BORDER = '#5a8fc5';
const BUTTON_INACTIVE_BORDER = '#334155';
const BUTTON_ACTIVE_BORDER_WIDTH = 2;
const BUTTON_INACTIVE_BORDER_WIDTH = 1;

// Icon styling
const BUTTON_ICON_FONT_SIZE = 20;
const BUTTON_ICON_X_OFFSET = 28;
const BUTTON_ICON_Y_ADJUST = 7;
const BUTTON_ICON_ACTIVE_COLOR = '#ffffff';
const BUTTON_ICON_INACTIVE_COLOR = '#8ba8c4';

// Label styling
const BUTTON_LABEL_X_OFFSET = 54;
const BUTTON_LABEL_SIZE = 16;
const BUTTON_LABEL_ACTIVE_COLOR = '#ffffff';
const BUTTON_LABEL_INACTIVE_COLOR = '#b8cfe4';

// Radio button styling
const RADIO_X_OFFSET = 22;
const RADIO_OUTER_RADIUS = 7;
const RADIO_INNER_RADIUS = 4;
const RADIO_ACTIVE_COLOR = '#5a8fc5';
const RADIO_INACTIVE_COLOR = '#334155';
const RADIO_OUTER_BORDER_WIDTH = 2;

// Footer
const MENU_FOOTER_Y_OFFSET = 18;
const MENU_FOOTER_SIZE = 11;
const MENU_FOOTER_COLOR = '#4a6680';

// Overlay constants for restricted buttons
const RESTRICTED_DIM_ALPHA = 0.7;

export class FollowerMenu {
  private _isOpen = false;
  private _buttonRects: Rect[] = [];

  onFollowMe: (() => void) | null = null;
  onDoNotMove: (() => void) | null = null;
  onSetAggressive: (() => void) | null = null;
  onSetPassive: (() => void) | null = null;

  /**
   * When non-null, only the button at this index is clickable.
   * All other buttons are dimmed to indicate they are unavailable.
   */
  restrictedToButtonIndex: number | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Screen-space rect of the "Follow me" button, or null if not yet rendered. */
  get followMeButtonRect(): Rect | null {
    return this._buttonRects[0] ?? null;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    const callbacks = [this.onFollowMe, this.onDoNotMove, this.onSetAggressive, this.onSetPassive];
    for (let i = 0; i < this._buttonRects.length; i++) {
      const r = this._buttonRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        if (this.restrictedToButtonIndex !== null && i !== this.restrictedToButtonIndex) {
          return true; // Consume click but do nothing — button is restricted
        }
        this._isOpen = false;
        callbacks[i]?.();
        return true;
      }
    }
    this._isOpen = false;
    return true;
  }

  /**
   * @param companionIsCat - true when the human is the active player (cat is the companion)
   */
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    movementMode: MovementMode,
    combatStance: CombatStance,
    companionIsCat: boolean,
  ): void {
    if (!this._isOpen) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // Dim backdrop
    ctx.fillStyle = `rgba(0,0,0,${MENU_BACKDROP_ALPHA})`;
    ctx.fillRect(0, 0, cw, ch);

    const panelW = MENU_PANEL_WIDTH;
    const panelH = MENU_PANEL_HEIGHT;
    const panelX = Math.round(cw / 2 - panelW / 2);
    const panelY = Math.round(ch / 2 - panelH / 2);

    // Panel background + border
    ctx.fillStyle = MENU_PANEL_BG_COLOR;
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = MENU_PANEL_BORDER_COLOR;
    ctx.lineWidth = MENU_PANEL_BORDER_WIDTH;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Title row
    const companionEmoji = companionIsCat ? '🐱' : '🧍';
    const companionName = companionIsCat ? 'Cat Companion' : 'Human Companion';
    ctx.font = MENU_TITLE_BOLD_FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${companionEmoji}  ${companionName}`, cw / 2, panelY + MENU_TITLE_Y_OFFSET);
    ctx.textAlign = 'left';

    const btnW = MENU_BUTTON_WIDTH;
    const btnH = MENU_BUTTON_HEIGHT;
    const btnX = panelX + Math.round((panelW - btnW) / 2);

    const sections: Array<{
      header: string;
      items: Array<{ icon: string; label: string; active: boolean; idx: number }>;
    }> = [
      {
        header: 'MOVEMENT',
        items: [
          { icon: '↩', label: 'Follow me', active: movementMode === 'follow', idx: 0 },
          { icon: '⚓', label: 'Do not move', active: movementMode === 'anchored', idx: 1 },
        ],
      },
      {
        header: 'COMBAT STANCE',
        items: [
          { icon: '⚔', label: 'Aggressive', active: combatStance === 'aggressive', idx: 2 },
          { icon: '🛡', label: 'Passive', active: combatStance === 'passive', idx: 3 },
        ],
      },
    ];

    this._buttonRects = new Array<Rect>(MENU_BUTTON_COUNT);
    let currentY = panelY + MENU_INITIAL_Y_OFFSET;

    for (const section of sections) {
      // Section header
      drawText(ctx, section.header, {
        x: btnX,
        y: currentY,
        size: MENU_SECTION_HEADER_SIZE,
        bold: true,
        color: '#7a9ec0',
      });
      currentY += MENU_SECTION_HEADER_Y_OFFSET;

      for (const item of section.items) {
        const r: Rect = { x: btnX, y: currentY, w: btnW, h: btnH };
        this._buttonRects[item.idx] = r;

        // Button fill + border
        const isRestricted =
          this.restrictedToButtonIndex !== null && item.idx !== this.restrictedToButtonIndex;
        ctx.fillStyle = item.active ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = item.active ? BUTTON_ACTIVE_BORDER : BUTTON_INACTIVE_BORDER;
        ctx.lineWidth = item.active ? BUTTON_ACTIVE_BORDER_WIDTH : BUTTON_INACTIVE_BORDER_WIDTH;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        if (isRestricted) {
          ctx.fillStyle = `rgba(0, 0, 0, ${RESTRICTED_DIM_ALPHA})`;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }

        // Icon (large, left side)
        ctx.font = `bold ${BUTTON_ICON_FONT_SIZE}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = item.active ? BUTTON_ICON_ACTIVE_COLOR : BUTTON_ICON_INACTIVE_COLOR;
        ctx.fillText(
          item.icon,
          r.x + BUTTON_ICON_X_OFFSET,
          r.y + Math.round(r.h / 2) + BUTTON_ICON_Y_ADJUST,
        );
        ctx.textAlign = 'left';

        // Label text — large and readable
        drawText(ctx, item.label, {
          x: r.x + BUTTON_LABEL_X_OFFSET,
          y: r.y + Math.round((r.h - BUTTON_LABEL_SIZE) / 2),
          size: BUTTON_LABEL_SIZE,
          bold: item.active,
          color: item.active ? BUTTON_LABEL_ACTIVE_COLOR : BUTTON_LABEL_INACTIVE_COLOR,
        });

        // Radio button indicator on the right (always rendered; filled when active)
        const radioCx = r.x + r.w - RADIO_X_OFFSET;
        const radioCy = r.y + Math.round(r.h / 2);
        ctx.beginPath();
        ctx.arc(radioCx, radioCy, RADIO_OUTER_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = item.active ? RADIO_ACTIVE_COLOR : RADIO_INACTIVE_COLOR;
        ctx.lineWidth = RADIO_OUTER_BORDER_WIDTH;
        ctx.stroke();
        if (item.active) {
          ctx.beginPath();
          ctx.arc(radioCx, radioCy, RADIO_INNER_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = RADIO_ACTIVE_COLOR;
          ctx.fill();
        }

        currentY += btnH + MENU_BUTTON_SPACING;
      }

      currentY += MENU_SECTION_SPACING;
    }

    drawText(ctx, 'Esc or click outside to close', {
      x: cw / 2,
      y: panelY + panelH - MENU_FOOTER_Y_OFFSET,
      size: MENU_FOOTER_SIZE,
      color: MENU_FOOTER_COLOR,
      align: 'center',
    });
  }
}
