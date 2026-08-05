import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawBox, drawOverlay } from '../ui/Box';
import { addButton, beginMenuFocus, endMenuFocus } from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

// Collision detection
const TILE_CENTER_OFFSET = 0.5;

// UI constants
const STAIR_PULSE_CENTER = 0.6;
const STAIR_PULSE_AMPLITUDE = 0.3;
const STAIR_PULSE_SPEED = 500; // ms
const STAIR_HINT_SIZE_RATIO = 0.45;
const STAIR_HINT_Y_OFFSET = 4;
const STAIR_HINT_Y_SCALE = 0.8;

// Menu constants
const MENU_OVERLAY_ALPHA = 0.55;
const MENU_PANEL_WIDTH = 340;
const MENU_PANEL_HEIGHT = 190;
const MENU_TITLE_Y_OFFSET = 38;
const MENU_TITLE_Y_ADJUST = 16;
const MENU_TITLE_SIZE = 20;
const MENU_PROMPT_Y_OFFSET = 68;
const MENU_PROMPT_Y_ADJUST = 10;
const MENU_PROMPT_SIZE = 13;
const MENU_HINT_Y_OFFSET = 88;
const MENU_HINT_Y_ADJUST = 9;
const MENU_HINT_SIZE = 11;
const MENU_ACTION_BG_COLOR = '#5c3d0a';
const MENU_ACTION_BORDER_COLOR = '#d4a830';
const MENU_ACTION_TEXT_COLOR = '#ffe8a0';
const MENU_ACTION_BUTTON_WIDTH = 120;
const MENU_ACTION_BUTTON_HEIGHT = 42;
const MENU_ACTION_BUTTON_Y_OFFSET = 110;
const MENU_ACTION_BUTTON_X_SPACING = 8;
const MENU_ACTION_TEXT_SIZE = 14;
const MENU_STAY_BG_COLOR = '#1e293b';
const MENU_STAY_BORDER_COLOR = '#475569';
const MENU_STAY_TEXT_COLOR = '#94a3b8';
const MENU_BORDER_WIDTH = 1.5;
const MENU_BORDER_WIDTH_THIN = 2;
const MENU_PANEL_BG_COLOR = '#1a1408';
const MENU_PANEL_BORDER_COLOR = '#d4a830';
const MENU_TITLE_TEXT_COLOR = '#ffe8a0';
const MENU_PROMPT_TEXT_COLOR = '#94a3b8';
const MENU_HINT_TEXT_COLOR = '#64748b';

export class TowerStairSystem implements GameSystem {
  private onUpStair = false;
  private onDownStair = false;
  private _upMenuOpen = false;
  private _downMenuOpen = false;
  private upDismissed = false;
  private downDismissed = false;
  /** Rebuilt by `renderMenu`, so a click and the thing it hits can never drift apart. */
  private menuButtons: ButtonRect[] = [];

  constructor(
    private map: GameMap,
    private currentFloor: number,
    private readonly onAscend: () => void,
    private readonly onDescend: () => void,
  ) {}

  get menuOpen(): boolean {
    return this._upMenuOpen || this._downMenuOpen;
  }

  setMap(map: GameMap, floor: number): void {
    this.map = map;
    this.currentFloor = floor;
    this.resetState();
  }

  closeMenu(): void {
    this._upMenuOpen = false;
    this._downMenuOpen = false;
    this.upDismissed = true;
    this.downDismissed = true;
  }

  resetState(): void {
    this.onUpStair = false;
    this.onDownStair = false;
    this._upMenuOpen = false;
    this._downMenuOpen = false;
    this.upDismissed = false;
    this.downDismissed = false;
  }

  update(ctx: SystemContext): void {
    this.detect(ctx.active);
  }

  detect(active: { x: number; y: number }): void {
    const tx = Math.floor((active.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);

    // Up stairs
    const wasOnUp = this.onUpStair;
    this.onUpStair = this.map._interiorStairUpTiles.some((s) => s.x === tx && s.y === ty);
    if (!this.onUpStair) {
      this.upDismissed = false;
      this._upMenuOpen = false;
    } else if (!wasOnUp && !this.upDismissed) {
      this._upMenuOpen = true;
    }

    // Down stairs
    const wasOnDown = this.onDownStair;
    this.onDownStair = this.map._interiorStairDownTiles.some((s) => s.x === tx && s.y === ty);
    if (!this.onDownStair) {
      this.downDismissed = false;
      this._downMenuOpen = false;
    } else if (!wasOnDown && !this.downDismissed) {
      this._downMenuOpen = true;
    }
  }

  handleClick(mx: number, my: number): boolean {
    if (!this.menuOpen) return false;
    for (const button of this.menuButtons) {
      if (
        mx >= button.x &&
        mx <= button.x + button.w &&
        my >= button.y &&
        my <= button.y + button.h
      ) {
        button.action?.();
        return true;
      }
    }
    return false;
  }

  renderStairHints(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const pulse =
      STAIR_PULSE_CENTER + Math.sin(Date.now() / STAIR_PULSE_SPEED) * STAIR_PULSE_AMPLITUDE;
    const hintSize = Math.floor(TILE_SIZE * STAIR_HINT_SIZE_RATIO);

    for (const t of this.map._interiorStairUpTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      drawText(ctx, '▲ Up', {
        x: sx,
        y: sy - STAIR_HINT_Y_OFFSET - Math.round(hintSize * STAIR_HINT_Y_SCALE),
        size: hintSize,
        bold: true,
        color: `rgba(255, 220, 80, ${pulse})`,
        align: 'center',
      });
    }
    for (const t of this.map._interiorStairDownTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      drawText(ctx, '▼ Down', {
        x: sx,
        y: sy - STAIR_HINT_Y_OFFSET - Math.round(hintSize * STAIR_HINT_Y_SCALE),
        size: hintSize,
        bold: true,
        color: `rgba(255, 220, 80, ${pulse})`,
        align: 'center',
      });
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D): void {
    if (!this._upMenuOpen && !this._downMenuOpen) return;

    const isUp = this._upMenuOpen;
    const targetFloor = isUp ? this.currentFloor + 1 : this.currentFloor - 1;
    const targetLabel = FLOOR_LABELS[targetFloor] ?? `Floor ${targetFloor + 1}`;

    const cw = viewportWidth();
    const ch = viewportHeight();

    this.menuButtons = [];
    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: MENU_OVERLAY_ALPHA });

    const panelW = MENU_PANEL_WIDTH;
    const panelH = MENU_PANEL_HEIGHT;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    drawBox(ctx, {
      x: panelX,
      y: panelY,
      width: panelW,
      height: panelH,
      fill: MENU_PANEL_BG_COLOR,
      border: MENU_PANEL_BORDER_COLOR,
      borderWidth: MENU_BORDER_WIDTH_THIN,
      radius: 0,
    });

    const arrow = isUp ? '▲' : '▼';
    drawText(ctx, `${arrow}  Staircase  ${arrow}`, {
      x: cw / 2,
      y: panelY + MENU_TITLE_Y_OFFSET - MENU_TITLE_Y_ADJUST,
      size: MENU_TITLE_SIZE,
      bold: true,
      color: MENU_TITLE_TEXT_COLOR,
      align: 'center',
    });

    drawText(ctx, `${isUp ? 'Ascend' : 'Descend'} to: ${targetLabel}?`, {
      x: cw / 2,
      y: panelY + MENU_PROMPT_Y_OFFSET - MENU_PROMPT_Y_ADJUST,
      size: MENU_PROMPT_SIZE,
      color: MENU_PROMPT_TEXT_COLOR,
      align: 'center',
    });

    drawText(ctx, '(Esc or Stay to remain on this floor)', {
      x: cw / 2,
      y: panelY + MENU_HINT_Y_OFFSET - MENU_HINT_Y_ADJUST,
      size: MENU_HINT_SIZE,
      color: MENU_HINT_TEXT_COLOR,
      align: 'center',
    });

    const rects = this.menuRects();

    // The travel button leads the ring so one Tab reaches it, but Stay is the
    // primary: standing on a step is not consent to change floors.
    beginMenuFocus('tower-stairs');
    addButton(ctx, this.menuButtons, {
      x: rects.action.x,
      y: rects.action.y,
      width: rects.action.w,
      height: rects.action.h,
      label: isUp ? 'Ascend' : 'Descend',
      fill: MENU_ACTION_BG_COLOR,
      border: MENU_ACTION_BORDER_COLOR,
      borderWidth: MENU_BORDER_WIDTH,
      radius: 0,
      labelSize: MENU_ACTION_TEXT_SIZE,
      labelColor: MENU_ACTION_TEXT_COLOR,
      action: isUp ? () => this.onAscend() : () => this.onDescend(),
    });
    addButton(ctx, this.menuButtons, {
      x: rects.stay.x,
      y: rects.stay.y,
      width: rects.stay.w,
      height: rects.stay.h,
      label: 'Stay',
      fill: MENU_STAY_BG_COLOR,
      border: MENU_STAY_BORDER_COLOR,
      borderWidth: MENU_BORDER_WIDTH,
      radius: 0,
      labelSize: MENU_ACTION_TEXT_SIZE,
      labelColor: MENU_STAY_TEXT_COLOR,
      primaryAction: true,
      action: () => this.closeMenu(),
    });
    endMenuFocus();
  }

  private menuRects() {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const panelH = MENU_PANEL_HEIGHT;
    const panelY = ch / 2 - panelH / 2;
    const btnW = MENU_ACTION_BUTTON_WIDTH;
    const btnH = MENU_ACTION_BUTTON_HEIGHT;
    const btnY = panelY + MENU_ACTION_BUTTON_Y_OFFSET;
    return {
      action: { x: cw / 2 - btnW - MENU_ACTION_BUTTON_X_SPACING, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + MENU_ACTION_BUTTON_X_SPACING, y: btnY, w: btnW, h: btnH },
    };
  }
}
