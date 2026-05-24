import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LevelDef } from '../levels/types';
import type { GameSystem, SystemContext } from './GameSystem';
import { getLevelDef } from '../levels';
import { drawText } from '../ui/TextBox';
import { drawSpriteKey } from '../core/SpriteRenderer';

const TILE_CENTER_OFFSET = 0.5;
// Stairwell rendering
const STAIRWELL_SCALE = 2;
const STAIRWELL_PULSE_CENTER = 0.7;
const STAIRWELL_PULSE_AMPLITUDE = 0.2;
const STAIRWELL_PULSE_SPEED = 500; // ms
const STAIRWELL_BORDER_WIDTH = 2;
const STAIRWELL_ICON_SIZE_RATIO = 0.42;
const STAIRWELL_ICON_Y_RATIO = 0.67;
const STAIRWELL_ICON_Y_ADJUST = 0.8;
const STAIRWELL_OFFSCREEN_MARGIN = 2; // measured in stairwell-widths

// Menu rendering
const STAIRWELL_MENU_OVERLAY_ALPHA = 0.55;
const STAIRWELL_MENU_PANEL_WIDTH = 340;
const STAIRWELL_MENU_PANEL_HEIGHT = 190;
const STAIRWELL_MENU_TITLE_Y_OFFSET = 38;
const STAIRWELL_MENU_TITLE_Y_ADJUST = 16;
const STAIRWELL_MENU_TITLE_SIZE = 20;
const STAIRWELL_MENU_PROMPT_Y_OFFSET = 68;
const STAIRWELL_MENU_PROMPT_Y_ADJUST = 10;
const STAIRWELL_MENU_PROMPT_SIZE = 13;
const STAIRWELL_MENU_HINT_Y_OFFSET = 88;
const STAIRWELL_MENU_HINT_Y_ADJUST = 9;
const STAIRWELL_MENU_HINT_SIZE = 11;
const STAIRWELL_MENU_BUTTON_WIDTH = 120;
const STAIRWELL_MENU_BUTTON_HEIGHT = 42;
const STAIRWELL_MENU_BUTTON_Y_OFFSET = 110;
const STAIRWELL_MENU_BUTTON_X_SPACING = 8;
const STAIRWELL_MENU_BUTTON_TEXT_Y_OFFSET = 27;
const STAIRWELL_MENU_BUTTON_TEXT_Y_ADJUST = 11;
const STAIRWELL_MENU_BUTTON_TEXT_SIZE = 14;
const STAIRWELL_MENU_BG_COLOR = '#0d0920';
const STAIRWELL_MENU_BORDER_COLOR = '#a855f7';
const STAIRWELL_MENU_BORDER_WIDTH = 2;
const STAIRWELL_MENU_BUTTON_BG_COLOR = '#4c1d95';
const STAIRWELL_MENU_BUTTON_BORDER_WIDTH = 1.5;
const STAIRWELL_MENU_BUTTON_TEXT_COLOR = '#e9d5ff';
const STAIRWELL_MENU_STAY_BG_COLOR = '#1e293b';
const STAIRWELL_MENU_STAY_BORDER_COLOR = '#475569';
const STAIRWELL_MENU_STAY_TEXT_COLOR = '#94a3b8';
const STAIRWELL_MENU_TITLE_TEXT_COLOR = '#e9d5ff';
const STAIRWELL_MENU_PROMPT_TEXT_COLOR = '#94a3b8';
const STAIRWELL_MENU_HINT_TEXT_COLOR = '#64748b';

export class StairwellSystem implements GameSystem {
  private onStairwell = false;
  private _menuOpen = false;
  private dismissed = false;

  constructor(
    private readonly gameMap: GameMap,
    private readonly levelDef: LevelDef,
    private readonly onDescend: () => void,
  ) {}

  get menuOpen(): boolean {
    return this._menuOpen;
  }

  closeMenu(): void {
    this._menuOpen = false;
    this.dismissed = true;
  }

  update(ctx: SystemContext): void {
    this.detect(ctx.active);
  }

  /** Called each gameplay frame. Detects stairwell entry and opens/closes the menu. */
  detect(active: { x: number; y: number }): void {
    if (!this.levelDef.nextLevelId) {
      this.onStairwell = false;
      return;
    }

    const wasOn = this.onStairwell;
    this.onStairwell = this.isEntityOnStairwell(active);

    if (!this.onStairwell) {
      this.dismissed = false;
      this._menuOpen = false;
    } else if (!wasOn && !this.dismissed) {
      this._menuOpen = true;
    }
  }

  isEntityOnStairwell(entity: { x: number; y: number }): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    return this.gameMap.stairwellTiles.some(
      (s) => (tx === s.x || tx === s.x + 1) && (ty === s.y || ty === s.y + 1),
    );
  }

  handleClick(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this._menuOpen) return false;
    const rects = this.menuRects(canvas);
    if (
      mx >= rects.descend.x &&
      mx <= rects.descend.x + rects.descend.w &&
      my >= rects.descend.y &&
      my <= rects.descend.y + rects.descend.h
    ) {
      this.onDescend();
      return true;
    }
    if (
      mx >= rects.stay.x &&
      mx <= rects.stay.x + rects.stay.w &&
      my >= rects.stay.y &&
      my <= rects.stay.y + rects.stay.h
    ) {
      this._menuOpen = false;
      this.dismissed = true;
      return true;
    }
    return false;
  }

  renderStairwells(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    canvas: HTMLCanvasElement,
  ): void {
    if (!this.levelDef.nextLevelId) return;
    const ts = TILE_SIZE;
    const bw = ts * STAIRWELL_SCALE;
    const bh = ts * STAIRWELL_SCALE;
    const pulse =
      STAIRWELL_PULSE_CENTER +
      Math.sin(Date.now() / STAIRWELL_PULSE_SPEED) * STAIRWELL_PULSE_AMPLITUDE;
    for (const { x, y } of this.gameMap.stairwellTiles) {
      const sx = x * ts - camX;
      const sy = y * ts - camY;
      if (
        sx < -bw * STAIRWELL_OFFSCREEN_MARGIN ||
        sx > canvas.width ||
        sy < -bh * STAIRWELL_OFFSCREEN_MARGIN ||
        sy > canvas.height
      )
        continue;

      drawSpriteKey(ctx, 'stairwell', 'idle', 0, sx, sy, bw);

      ctx.strokeStyle = `rgba(168, 85, 247, ${pulse})`;
      ctx.lineWidth = STAIRWELL_BORDER_WIDTH;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);

      const arrowSize = Math.floor(bh * STAIRWELL_ICON_SIZE_RATIO);
      drawText(ctx, '▼', {
        x: sx + bw / 2,
        y: sy + bh * STAIRWELL_ICON_Y_RATIO - Math.round(arrowSize * STAIRWELL_ICON_Y_ADJUST),
        size: arrowSize,
        bold: true,
        color: `rgba(233, 213, 255, ${pulse})`,
        align: 'center',
      });
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = `rgba(0,0,0,${STAIRWELL_MENU_OVERLAY_ALPHA})`;
    ctx.fillRect(0, 0, cw, ch);

    const panelW = STAIRWELL_MENU_PANEL_WIDTH;
    const panelH = STAIRWELL_MENU_PANEL_HEIGHT;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = STAIRWELL_MENU_BG_COLOR;
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = STAIRWELL_MENU_BORDER_COLOR;
    ctx.lineWidth = STAIRWELL_MENU_BORDER_WIDTH;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    drawText(ctx, '▼  Stairwell  ▼', {
      x: cw / 2,
      y: panelY + STAIRWELL_MENU_TITLE_Y_OFFSET - STAIRWELL_MENU_TITLE_Y_ADJUST,
      size: STAIRWELL_MENU_TITLE_SIZE,
      bold: true,
      color: STAIRWELL_MENU_TITLE_TEXT_COLOR,
      align: 'center',
    });

    const nextId = this.levelDef.nextLevelId;
    const nextName = nextId ? getLevelDef(nextId).name : 'Next Floor';
    drawText(ctx, `Descend to: ${nextName}?`, {
      x: cw / 2,
      y: panelY + STAIRWELL_MENU_PROMPT_Y_OFFSET - STAIRWELL_MENU_PROMPT_Y_ADJUST,
      size: STAIRWELL_MENU_PROMPT_SIZE,
      color: STAIRWELL_MENU_PROMPT_TEXT_COLOR,
      align: 'center',
    });

    drawText(ctx, '(Esc or Stay to remain on this floor)', {
      x: cw / 2,
      y: panelY + STAIRWELL_MENU_HINT_Y_OFFSET - STAIRWELL_MENU_HINT_Y_ADJUST,
      size: STAIRWELL_MENU_HINT_SIZE,
      color: STAIRWELL_MENU_HINT_TEXT_COLOR,
      align: 'center',
    });

    const rects = this.menuRects(canvas);

    ctx.fillStyle = STAIRWELL_MENU_BUTTON_BG_COLOR;
    ctx.fillRect(rects.descend.x, rects.descend.y, rects.descend.w, rects.descend.h);
    ctx.strokeStyle = STAIRWELL_MENU_BORDER_COLOR;
    ctx.lineWidth = STAIRWELL_MENU_BUTTON_BORDER_WIDTH;
    ctx.strokeRect(rects.descend.x, rects.descend.y, rects.descend.w, rects.descend.h);
    drawText(ctx, 'Descend', {
      x: rects.descend.x + rects.descend.w / 2,
      y:
        rects.descend.y + STAIRWELL_MENU_BUTTON_TEXT_Y_OFFSET - STAIRWELL_MENU_BUTTON_TEXT_Y_ADJUST,
      size: STAIRWELL_MENU_BUTTON_TEXT_SIZE,
      bold: true,
      color: STAIRWELL_MENU_BUTTON_TEXT_COLOR,
      align: 'center',
    });

    ctx.fillStyle = STAIRWELL_MENU_STAY_BG_COLOR;
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = STAIRWELL_MENU_STAY_BORDER_COLOR;
    ctx.lineWidth = STAIRWELL_MENU_BUTTON_BORDER_WIDTH;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    drawText(ctx, 'Stay', {
      x: rects.stay.x + rects.stay.w / 2,
      y: rects.stay.y + STAIRWELL_MENU_BUTTON_TEXT_Y_OFFSET - STAIRWELL_MENU_BUTTON_TEXT_Y_ADJUST,
      size: STAIRWELL_MENU_BUTTON_TEXT_SIZE,
      bold: true,
      color: STAIRWELL_MENU_STAY_TEXT_COLOR,
      align: 'center',
    });
  }

  private menuRects(canvas: HTMLCanvasElement): {
    descend: { x: number; y: number; w: number; h: number };
    stay: { x: number; y: number; w: number; h: number };
  } {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = STAIRWELL_MENU_PANEL_HEIGHT;
    const panelY = ch / 2 - panelH / 2;
    const btnW = STAIRWELL_MENU_BUTTON_WIDTH;
    const btnH = STAIRWELL_MENU_BUTTON_HEIGHT;
    const btnY = panelY + STAIRWELL_MENU_BUTTON_Y_OFFSET;
    return {
      descend: { x: cw / 2 - btnW - STAIRWELL_MENU_BUTTON_X_SPACING, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + STAIRWELL_MENU_BUTTON_X_SPACING, y: btnY, w: btnW, h: btnH },
    };
  }
}
