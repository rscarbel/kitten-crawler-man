import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay } from '../ui/Box';
import { addButton, beginMenuFocus, endMenuFocus } from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import type { MovementMode, CombatStance } from './CompanionSystem';
import { viewportWidth, viewportHeight } from '../core/Viewport';

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
const MENU_TITLE_SIZE = 22;

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

/**
 * Extra dimming painted over a tutorial-restricted row. The row is drawn
 * `disabled`, which already fades the button box, so this only has to reach the
 * icon, label and radio dot drawn on top of it — hence far lighter than the
 * blackout this used to be when the box carried no dimming of its own.
 */
const RESTRICTED_DIM_ALPHA = 0.35;

export class FollowerMenu {
  private _isOpen = false;
  private _buttonRects: ButtonRect[] = [];

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
    for (const r of this._buttonRects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        r.action?.();
        return true;
      }
    }
    // Anywhere else, including the panel's own margins: clicking away closes.
    this._isOpen = false;
    return true;
  }

  /** The order the four orders are drawn in, which is also their callback order. */
  private orderCallback(idx: number): (() => void) | null {
    const callbacks = [this.onFollowMe, this.onDoNotMove, this.onSetAggressive, this.onSetPassive];
    return callbacks[idx] ?? null;
  }

  /**
   * @param companionIsCat - true when the human is the active player (cat is the companion)
   */
  render(
    ctx: CanvasRenderingContext2D,
    movementMode: MovementMode,
    combatStance: CombatStance,
    companionIsCat: boolean,
  ): void {
    if (!this._isOpen) return;

    const cw = viewportWidth();
    const ch = viewportHeight();

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: MENU_BACKDROP_ALPHA });

    const panelW = MENU_PANEL_WIDTH;
    const panelH = MENU_PANEL_HEIGHT;
    const panelX = Math.round(cw / 2 - panelW / 2);
    const panelY = Math.round(ch / 2 - panelH / 2);

    drawBox(ctx, {
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      fill: MENU_PANEL_BG_COLOR,
      border: MENU_PANEL_BORDER_COLOR,
      borderWidth: MENU_PANEL_BORDER_WIDTH,
      radius: 0,
    });

    const companionEmoji = companionIsCat ? '🐱' : '🧍';
    const companionName = companionIsCat ? 'Cat Companion' : 'Human Companion';
    drawText(ctx, `${companionEmoji}  ${companionName}`, {
      x: cw / 2,
      y: panelY + MENU_TITLE_Y_OFFSET - MENU_TITLE_SIZE,
      size: MENU_TITLE_SIZE,
      bold: true,
      color: '#ffffff',
      align: 'center',
    });

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

    this._buttonRects = [];
    beginMenuFocus('follower-menu');
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
        // A tutorial-restricted row is drawn `disabled`, which both dims it and
        // keeps it out of the focus ring — the keyboard skips it for free.
        const isRestricted =
          this.restrictedToButtonIndex !== null && item.idx !== this.restrictedToButtonIndex;
        const callback = this.orderCallback(item.idx);
        addButton(ctx, this._buttonRects, {
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          // The row paints its own icon, left-aligned label and radio dot on top.
          label: '',
          fill: item.active ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG,
          border: item.active ? BUTTON_ACTIVE_BORDER : BUTTON_INACTIVE_BORDER,
          borderWidth: item.active ? BUTTON_ACTIVE_BORDER_WIDTH : BUTTON_INACTIVE_BORDER_WIDTH,
          radius: 0,
          disabled: isRestricted,
          action: isRestricted
            ? () => {
                // Swallow: the tutorial is pointing at another row, and closing
                // the menu here would strand the step it is waiting on.
              }
            : () => {
                this._isOpen = false;
                callback?.();
              },
        });

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
    endMenuFocus();

    drawText(ctx, 'Esc or click outside to close', {
      x: cw / 2,
      y: panelY + panelH - MENU_FOOTER_Y_OFFSET,
      size: MENU_FOOTER_SIZE,
      color: MENU_FOOTER_COLOR,
      align: 'center',
    });
  }
}
