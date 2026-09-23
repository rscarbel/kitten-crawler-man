import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay, drawScrollbar } from '../ui/Box';
import { addButton, beginMenuFocus, endMenuFocus, BUTTON_PRESETS } from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import { MENU_TAP_MAX_DISTANCE } from '../ui/PauseMenu';
import type { MovementMode, CombatStance } from './CompanionSystem';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { platform } from '../core/Platform';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether a row shows a radio dot (one of a group) or a checkbox (on its own). */
type RowControl = 'radio' | 'checkbox';

interface MenuRow {
  icon: string;
  label: string;
  control: RowControl;
  checked: boolean;
  idx: number;
  callback: (() => void) | null;
}

interface MenuSection {
  header: string;
  rows: MenuRow[];
}

/** What a finished touch on the menu turned out to be. */
export type FollowerMenuTouchResult = 'tap' | 'drag';

interface MenuTouch {
  id: number;
  startX: number;
  startY: number;
  lastY: number;
  isDrag: boolean;
}

const MENU_PANEL_WIDTH = 440;
const MENU_BUTTON_WIDTH = 400;
const MENU_BUTTON_HEIGHT = 60;

/** Breathing room kept between the panel and the screen edge on small viewports. */
const MENU_SCREEN_MARGIN = 8;

/** Title strip above the scrolling rows; holds the title and the X button. */
const MENU_HEADER_HEIGHT = 64;
const MENU_TITLE_SIZE = 26;
const MENU_TITLE_TOP = 18;

const CLOSE_X_SIZE = 40;
const CLOSE_X_INSET = 12;
const CLOSE_X_LABEL_SIZE = 22;
const CLOSE_X_GLYPH = '✕';

/** Strip below the scrolling rows; holds the Close button. */
const MENU_FOOTER_HEIGHT = 80;
const CLOSE_BUTTON_HEIGHT = 48;
const CLOSE_BUTTON_LABEL_SIZE = 18;

const MENU_CONTENT_TOP_PAD = 6;
const MENU_CONTENT_BOTTOM_PAD = 12;
const MENU_SECTION_HEADER_SIZE = 12;
const MENU_SECTION_HEADER_HEIGHT = 18;
const MENU_SECTION_HEADER_COLOR = '#7a9ec0';
const MENU_SECTION_SPACING = 10;
const MENU_BUTTON_SPACING = 8;

const MENU_BACKDROP_ALPHA = 0.65;
const MENU_PANEL_BG_COLOR = '#111927';
const MENU_PANEL_BORDER_COLOR = '#5a8fc5';
const MENU_PANEL_BORDER_WIDTH = 2;
const MENU_TITLE_COLOR = '#ffffff';
const MENU_DIVIDER_COLOR = '#23344a';
const MENU_DIVIDER_WIDTH = 1;

const BUTTON_ACTIVE_BG = 'rgba(90,143,197,0.3)';
const BUTTON_INACTIVE_BG = 'rgba(255,255,255,0.05)';
const BUTTON_ACTIVE_BORDER = '#5a8fc5';
const BUTTON_INACTIVE_BORDER = '#334155';
const BUTTON_ACTIVE_BORDER_WIDTH = 2;
const BUTTON_INACTIVE_BORDER_WIDTH = 1;

const BUTTON_ICON_FONT_SIZE = 24;
const BUTTON_ICON_X_OFFSET = 34;
const BUTTON_ICON_Y_ADJUST = 8;
const BUTTON_ICON_ACTIVE_COLOR = '#ffffff';
const BUTTON_ICON_INACTIVE_COLOR = '#8ba8c4';

const BUTTON_LABEL_X_OFFSET = 66;
const BUTTON_LABEL_SIZE = 20;
const BUTTON_LABEL_ACTIVE_COLOR = '#ffffff';
const BUTTON_LABEL_INACTIVE_COLOR = '#b8cfe4';

/** Distance from a row's right edge to the centre of its radio dot or checkbox. */
const CONTROL_X_OFFSET = 26;
const CONTROL_ACTIVE_COLOR = '#5a8fc5';
const CONTROL_INACTIVE_COLOR = '#334155';
const CONTROL_BORDER_WIDTH = 2;

const RADIO_OUTER_RADIUS = 7;
const RADIO_INNER_RADIUS = 4;

const CHECKBOX_HALF_SIZE = 8;
const CHECKBOX_RADIUS = 2;
const CHECKMARK_COLOR = '#ffffff';
const CHECKMARK_WIDTH = 2.5;
/** Checkmark stroke points, as fractions of the checkbox half-size from its centre. */
const CHECKMARK_POINTS = [
  { x: -0.55, y: 0.05 },
  { x: -0.15, y: 0.45 },
  { x: 0.6, y: -0.4 },
] as const;

const SWITCH_BUTTON_ICON = '⇄';

/**
 * Row index of the pet toggle. Past the four orders so a tutorial restriction,
 * which names a row by index, never lands on it by accident.
 */
const PET_TOGGLE_ROW_INDEX = 4;

/**
 * Extra dimming painted over a tutorial-restricted row. The row is drawn
 * `disabled`, which already fades the button box, so this only has to reach the
 * icon, label and control drawn on top of it.
 */
const RESTRICTED_DIM_ALPHA = 0.35;

const WHEEL_SCROLL_SCALE = 0.5;
const SCROLLBAR_WIDTH = 6;
/** Gap between the scrollbar and the panel's right border. */
const SCROLLBAR_RIGHT_INSET = 7;

export class FollowerMenu {
  private _isOpen = false;
  /** Hit-rects for the scrolling rows; only answer clicks inside {@link _contentBand}. */
  private _rowRects: ButtonRect[] = [];
  /** Hit-rects for the fixed header and footer buttons. */
  private _chromeRects: ButtonRect[] = [];
  private _panelRect: Rect | null = null;
  private _contentBand: Rect | null = null;
  private _followMeRect: Rect | null = null;

  private scrollY = 0;
  private maxScrollY = 0;
  private touch: MenuTouch | null = null;

  onFollowMe: (() => void) | null = null;
  onDoNotMove: (() => void) | null = null;
  onSetAggressive: (() => void) | null = null;
  onSetPassive: (() => void) | null = null;
  onSwitchCharacter: (() => void) | null = null;
  onToggleMongoAutoSummon: (() => void) | null = null;

  /**
   * When non-null, only the row at this index is clickable.
   * All other rows are dimmed to indicate they are unavailable; Close stays live.
   */
  restrictedToButtonIndex: number | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Screen-space rect of the "Follow me" row, or null while it is scrolled out of view. */
  get followMeButtonRect(): Rect | null {
    const row = this._followMeRect;
    const band = this._contentBand;
    if (row === null || band === null) return null;
    const rowIsVisible = row.y < band.y + band.h && row.y + row.h > band.y;
    return rowIsVisible ? row : null;
  }

  open(): void {
    this._isOpen = true;
    this.scrollY = 0;
    this.touch = null;
  }

  close(): void {
    this._isOpen = false;
    this.touch = null;
  }

  /**
   * Routes a click. Choosing an option keeps the menu open; only the X, Close,
   * a click outside the panel, Esc and switching character dismiss it.
   */
  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    const panel = this._panelRect;
    if (panel !== null && !pointIn(mx, my, panel)) {
      this.close();
      return true;
    }
    const chromeHit = this._chromeRects.find((r) => pointIn(mx, my, r));
    if (chromeHit !== undefined) {
      chromeHit.action?.();
      return true;
    }
    const band = this._contentBand;
    if (band !== null && pointIn(mx, my, band)) {
      this._rowRects.find((r) => pointIn(mx, my, r))?.action?.();
    }
    return true;
  }

  handleWheel(deltaY: number): void {
    if (this._isOpen) this.scrollBy(deltaY * WHEEL_SCROLL_SCALE);
  }

  /**
   * Starts tracking a finger. Returns false when another finger already owns
   * the menu, so the caller can ignore the extra touch.
   *
   * The press cannot be a click yet: the release decides whether the finger
   * tapped a row or dragged the list.
   */
  touchStart(id: number, x: number, y: number): boolean {
    if (!this._isOpen || this.touch !== null) return false;
    this.touch = { id, startX: x, startY: y, lastY: y, isDrag: false };
    return true;
  }

  /** Returns true when this touch belongs to the menu. */
  touchMove(id: number, x: number, y: number): boolean {
    const touch = this.touch;
    if (touch?.id !== id) return false;
    const travelled = Math.hypot(x - touch.startX, y - touch.startY);
    if (travelled > MENU_TAP_MAX_DISTANCE) touch.isDrag = true;
    if (touch.isDrag) this.scrollBy(touch.lastY - y);
    touch.lastY = y;
    return true;
  }

  /**
   * Ends a tracked touch. A `'tap'` should be routed as a click at the release
   * point; a `'drag'` has already done its work. Null when the touch was not the
   * menu's.
   */
  touchEnd(id: number): FollowerMenuTouchResult | null {
    const touch = this.touch;
    if (touch?.id !== id) return null;
    this.touch = null;
    return touch.isDrag ? 'drag' : 'tap';
  }

  private scrollBy(delta: number): void {
    this.scrollY = clamp(this.scrollY + delta, 0, this.maxScrollY);
  }

  /**
   * @param companionIsCat - true when the human is the active player (cat is the companion)
   * @param mongoAutoSummon - whether the cat sends Mongo in on her own, or null
   *   to leave the row out — no pet yet, or a scene he cannot be summoned in
   */
  render(
    ctx: CanvasRenderingContext2D,
    movementMode: MovementMode,
    combatStance: CombatStance,
    companionIsCat: boolean,
    mongoAutoSummon: boolean | null = null,
  ): void {
    if (!this._isOpen) return;

    const cw = viewportWidth();
    const ch = viewportHeight();
    // Only width scales the menu: a short screen scrolls the rows instead, so
    // the rows never shrink below a comfortable tap size.
    const fit = Math.min(1, (cw - MENU_SCREEN_MARGIN * 2) / MENU_PANEL_WIDTH);
    const u = (designPx: number): number => Math.round(designPx * fit);

    const sections = this.buildSections(
      movementMode,
      combatStance,
      companionIsCat,
      mongoAutoSummon,
    );

    const btnH = u(MENU_BUTTON_HEIGHT);
    const rowStride = btnH + u(MENU_BUTTON_SPACING);
    const sectionHeaderH = u(MENU_SECTION_HEADER_HEIGHT);
    const sectionsHeight = sections.reduce(
      (total, section) =>
        total + sectionHeaderH + section.rows.length * rowStride + u(MENU_SECTION_SPACING),
      0,
    );
    const contentHeight =
      u(MENU_CONTENT_TOP_PAD) + sectionsHeight + btnH + u(MENU_CONTENT_BOTTOM_PAD);

    const headerH = u(MENU_HEADER_HEIGHT);
    const footerH = u(MENU_FOOTER_HEIGHT);
    const naturalPanelH = headerH + contentHeight + footerH;
    const availablePanelH = ch - MENU_SCREEN_MARGIN * 2;
    const panelH = Math.min(naturalPanelH, availablePanelH);
    const panelW = u(MENU_PANEL_WIDTH);
    const panelX = Math.round(cw / 2 - panelW / 2);
    const panelY = Math.round(ch / 2 - panelH / 2);

    const band: Rect = {
      x: panelX,
      y: panelY + headerH,
      w: panelW,
      h: Math.max(0, panelH - headerH - footerH),
    };
    this._panelRect = { x: panelX, y: panelY, w: panelW, h: panelH };
    this._contentBand = band;
    this.maxScrollY = Math.max(0, contentHeight - band.h);
    this.scrollY = clamp(this.scrollY, 0, this.maxScrollY);

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: MENU_BACKDROP_ALPHA });
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

    this._rowRects = [];
    this._chromeRects = [];
    this._followMeRect = null;
    beginMenuFocus('follower-menu');

    const btnW = u(MENU_BUTTON_WIDTH);
    const btnX = panelX + Math.round((panelW - btnW) / 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(band.x, band.y, band.w, band.h);
    ctx.clip();

    let rowY = band.y - this.scrollY + u(MENU_CONTENT_TOP_PAD);
    let focusedRowSpan: { top: number; bottom: number } | null = null;
    for (const section of sections) {
      drawText(ctx, section.header, {
        x: btnX,
        y: rowY,
        size: u(MENU_SECTION_HEADER_SIZE),
        bold: true,
        color: MENU_SECTION_HEADER_COLOR,
      });
      rowY += sectionHeaderH;

      for (const row of section.rows) {
        const rect: Rect = { x: btnX, y: rowY, w: btnW, h: btnH };
        const focused = this.renderRow(ctx, rect, row, u);
        if (focused) focusedRowSpan = { top: rect.y, bottom: rect.y + rect.h };
        if (row.idx === 0) this._followMeRect = rect;
        rowY += rowStride;
      }
      rowY += u(MENU_SECTION_SPACING);
    }

    const switchRect: Rect = { x: btnX, y: rowY, w: btnW, h: btnH };
    if (this.renderSwitchRow(ctx, switchRect, companionIsCat, u)) {
      focusedRowSpan = { top: switchRect.y, bottom: switchRect.y + switchRect.h };
    }
    ctx.restore();

    drawScrollbar(ctx, {
      x: panelX + panelW - u(SCROLLBAR_RIGHT_INSET) - SCROLLBAR_WIDTH,
      trackY: band.y,
      trackH: band.h,
      contentH: contentHeight,
      scrollY: this.scrollY,
      width: SCROLLBAR_WIDTH,
    });

    if (this.maxScrollY > 0) {
      this.renderDivider(ctx, panelX, band.y, panelW);
      this.renderDivider(ctx, panelX, band.y + band.h, panelW);
    }

    this.renderHeader(ctx, panelX, panelY, panelW, companionIsCat, u);
    this.renderFooter(ctx, btnX, btnW, panelY + panelH - footerH, u);
    endMenuFocus();

    // Keyboard focus can walk onto a row scrolled out of view; bring it back
    // into the band so the ring the player is steering is always visible.
    if (focusedRowSpan !== null) {
      if (focusedRowSpan.top < band.y) this.scrollBy(focusedRowSpan.top - band.y);
      else if (focusedRowSpan.bottom > band.y + band.h) {
        this.scrollBy(focusedRowSpan.bottom - (band.y + band.h));
      }
    }
  }

  private buildSections(
    movementMode: MovementMode,
    combatStance: CombatStance,
    companionIsCat: boolean,
    mongoAutoSummon: boolean | null,
  ): MenuSection[] {
    const sections: MenuSection[] = [
      {
        header: 'MOVEMENT',
        rows: [
          {
            icon: '↩',
            label: 'Follow me',
            control: 'radio',
            checked: movementMode === 'follow',
            idx: 0,
            callback: this.onFollowMe,
          },
          {
            icon: '⚓',
            label: 'Do not move',
            control: 'radio',
            checked: movementMode === 'anchored',
            idx: 1,
            callback: this.onDoNotMove,
          },
        ],
      },
      {
        header: 'COMBAT STANCE',
        rows: [
          {
            icon: '⚔',
            label: 'Aggressive',
            control: 'radio',
            checked: combatStance === 'aggressive',
            idx: 2,
            callback: this.onSetAggressive,
          },
          {
            icon: '🛡',
            label: 'Passive',
            control: 'radio',
            checked: combatStance === 'passive',
            idx: 3,
            callback: this.onSetPassive,
          },
        ],
      },
    ];
    if (companionIsCat && mongoAutoSummon !== null) {
      sections.push({
        header: 'PET',
        rows: [
          {
            icon: '🦖',
            label: 'Summon Mongo in fights',
            control: 'checkbox',
            checked: mongoAutoSummon,
            idx: PET_TOGGLE_ROW_INDEX,
            callback: this.onToggleMongoAutoSummon,
          },
        ],
      });
    }
    return sections;
  }

  /** Draws one option row and registers its hit-rect. Returns whether it holds keyboard focus. */
  private renderRow(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    row: MenuRow,
    u: (designPx: number) => number,
  ): boolean {
    // A tutorial-restricted row is drawn `disabled`, which both dims it and
    // keeps it out of the focus ring — the keyboard skips it for free.
    const isRestricted =
      this.restrictedToButtonIndex !== null && row.idx !== this.restrictedToButtonIndex;
    const callback = row.callback;
    const result = addButton(ctx, this._rowRects, {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      // The row paints its own icon, left-aligned label and control on top.
      label: '',
      fill: row.checked ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG,
      border: row.checked ? BUTTON_ACTIVE_BORDER : BUTTON_INACTIVE_BORDER,
      borderWidth: row.checked ? BUTTON_ACTIVE_BORDER_WIDTH : BUTTON_INACTIVE_BORDER_WIDTH,
      radius: 0,
      disabled: isRestricted,
      action: isRestricted
        ? () => {
            // Swallow: the tutorial is pointing at another row.
          }
        : () => callback?.(),
    });

    if (isRestricted) this.renderRestrictedDim(ctx, rect);
    this.renderRowIcon(ctx, rect, row.icon, row.checked, u);
    drawText(ctx, row.label, {
      x: rect.x + u(BUTTON_LABEL_X_OFFSET),
      y: rect.y + Math.round((rect.h - u(BUTTON_LABEL_SIZE)) / 2),
      size: u(BUTTON_LABEL_SIZE),
      bold: row.checked,
      color: row.checked ? BUTTON_LABEL_ACTIVE_COLOR : BUTTON_LABEL_INACTIVE_COLOR,
    });

    const controlCx = rect.x + rect.w - u(CONTROL_X_OFFSET);
    const controlCy = rect.y + Math.round(rect.h / 2);
    if (row.control === 'radio') this.renderRadio(ctx, controlCx, controlCy, row.checked, u);
    else this.renderCheckbox(ctx, controlCx, controlCy, row.checked, u);

    return result.focused;
  }

  /** The one row that closes the menu, since the view it configures is about to change hands. */
  private renderSwitchRow(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    companionIsCat: boolean,
    u: (designPx: number) => number,
  ): boolean {
    const switchRestricted = this.restrictedToButtonIndex !== null;
    const result = addButton(ctx, this._rowRects, {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      label: '',
      fill: BUTTON_INACTIVE_BG,
      border: BUTTON_ACTIVE_BORDER,
      borderWidth: BUTTON_INACTIVE_BORDER_WIDTH,
      radius: 0,
      disabled: switchRestricted,
      action: switchRestricted
        ? () => {
            // Swallow: the tutorial is pointing at another row.
          }
        : () => {
            this.close();
            this.onSwitchCharacter?.();
          },
    });
    if (switchRestricted) this.renderRestrictedDim(ctx, rect);
    this.renderRowIcon(ctx, rect, SWITCH_BUTTON_ICON, true, u);
    const otherPlayableCharacter = companionIsCat ? 'Cat' : 'Human';
    drawText(ctx, `Switch to ${otherPlayableCharacter}`, {
      x: rect.x + u(BUTTON_LABEL_X_OFFSET),
      y: rect.y + Math.round((rect.h - u(BUTTON_LABEL_SIZE)) / 2),
      size: u(BUTTON_LABEL_SIZE),
      bold: true,
      color: BUTTON_LABEL_ACTIVE_COLOR,
    });
    return result.focused;
  }

  private renderHeader(
    ctx: CanvasRenderingContext2D,
    panelX: number,
    panelY: number,
    panelW: number,
    companionIsCat: boolean,
    u: (designPx: number) => number,
  ): void {
    const companionEmoji = companionIsCat ? '🐱' : '🧍';
    const companionName = companionIsCat ? 'Cat Companion' : 'Human Companion';
    drawText(ctx, `${companionEmoji}  ${companionName}`, {
      x: panelX + panelW / 2,
      y: panelY + u(MENU_TITLE_TOP),
      size: u(MENU_TITLE_SIZE),
      bold: true,
      color: MENU_TITLE_COLOR,
      align: 'center',
    });

    const closeXSize = u(CLOSE_X_SIZE);
    addButton(ctx, this._chromeRects, {
      x: panelX + panelW - u(CLOSE_X_INSET) - closeXSize,
      y: panelY + u(CLOSE_X_INSET),
      width: closeXSize,
      height: closeXSize,
      label: CLOSE_X_GLYPH,
      labelSize: u(CLOSE_X_LABEL_SIZE),
      ...BUTTON_PRESETS.primary,
      // The footer's Close already answers the keyboard; a second ring stop
      // for the same action is only a longer walk.
      focusable: false,
      action: () => this.close(),
    });
  }

  private renderFooter(
    ctx: CanvasRenderingContext2D,
    btnX: number,
    btnW: number,
    footerY: number,
    u: (designPx: number) => number,
  ): void {
    const closeH = u(CLOSE_BUTTON_HEIGHT);
    const closeY = footerY + Math.round((u(MENU_FOOTER_HEIGHT) - closeH) / 2);
    addButton(ctx, this._chromeRects, {
      x: btnX,
      y: closeY,
      width: btnW,
      height: closeH,
      label: platform.isMobile ? 'Close' : 'Close  [Esc]',
      labelSize: u(CLOSE_BUTTON_LABEL_SIZE),
      ...BUTTON_PRESETS.primary,
      primaryAction: true,
      action: () => this.close(),
    });
  }

  private renderDivider(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    ctx.fillStyle = MENU_DIVIDER_COLOR;
    ctx.fillRect(x, y, w, MENU_DIVIDER_WIDTH);
  }

  private renderRestrictedDim(ctx: CanvasRenderingContext2D, rect: Rect): void {
    ctx.fillStyle = `rgba(0, 0, 0, ${RESTRICTED_DIM_ALPHA})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  private renderRowIcon(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    icon: string,
    active: boolean,
    u: (designPx: number) => number,
  ): void {
    ctx.font = `bold ${u(BUTTON_ICON_FONT_SIZE)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = active ? BUTTON_ICON_ACTIVE_COLOR : BUTTON_ICON_INACTIVE_COLOR;
    ctx.fillText(
      icon,
      rect.x + u(BUTTON_ICON_X_OFFSET),
      rect.y + Math.round(rect.h / 2) + u(BUTTON_ICON_Y_ADJUST),
    );
    ctx.textAlign = 'left';
  }

  private renderRadio(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    checked: boolean,
    u: (designPx: number) => number,
  ): void {
    ctx.beginPath();
    ctx.arc(cx, cy, u(RADIO_OUTER_RADIUS), 0, Math.PI * 2);
    ctx.strokeStyle = checked ? CONTROL_ACTIVE_COLOR : CONTROL_INACTIVE_COLOR;
    ctx.lineWidth = CONTROL_BORDER_WIDTH;
    ctx.stroke();
    if (checked) {
      ctx.beginPath();
      ctx.arc(cx, cy, u(RADIO_INNER_RADIUS), 0, Math.PI * 2);
      ctx.fillStyle = CONTROL_ACTIVE_COLOR;
      ctx.fill();
    }
  }

  private renderCheckbox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    checked: boolean,
    u: (designPx: number) => number,
  ): void {
    const half = u(CHECKBOX_HALF_SIZE);
    drawBox(ctx, {
      x: cx - half,
      y: cy - half,
      width: half * 2,
      height: half * 2,
      fill: checked ? CONTROL_ACTIVE_COLOR : 'rgba(0,0,0,0)',
      border: checked ? CONTROL_ACTIVE_COLOR : CONTROL_INACTIVE_COLOR,
      borderWidth: CONTROL_BORDER_WIDTH,
      radius: CHECKBOX_RADIUS,
    });
    if (!checked) return;
    ctx.beginPath();
    CHECKMARK_POINTS.forEach((point, i) => {
      const px = cx + point.x * half;
      const py = cy + point.y * half;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = CHECKMARK_COLOR;
    ctx.lineWidth = CHECKMARK_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }
}

function pointIn(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
