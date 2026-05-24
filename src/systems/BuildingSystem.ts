import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';

export type BuildingEntry = {
  doorTile: { x: number; y: number };
  name: string;
  type: 'house' | 'tower' | 'restaurant' | 'store';
};

/** Tile center fraction for player position calculation. */
const TILE_CENTER_FRAC = 0.5;
/** Opacity of the dim backdrop behind the entry menu. */
const MENU_BACKDROP_ALPHA = 0.55;
/** Arrow size as fraction of tile size. */
const ARROW_SIZE_FRACTION = 0.55;
/** Alpha base for door hint pulse animation. */
const DOOR_HINT_PULSE_BASE = 0.6;
/** Alpha range for door hint pulse animation. */
const DOOR_HINT_PULSE_RANGE = 0.3;
/** Pulse period for door hints in ms. */
const DOOR_HINT_PULSE_PERIOD = 600;
/** Fraction of tile size used for building name label y offset. */
const BUILDING_NAME_Y_FRACTION = 0.6;
/** Multiplier for name label alpha. */
const BUILDING_NAME_ALPHA_MULT = 0.85;
/** Arrow y offset from door in pixels. */
const ARROW_Y_OFFSET = 4;
/** Menu panel width. */
const MENU_PANEL_W = 340;
/** Menu panel height. */
const MENU_PANEL_H = 190;
/** Icon/title y offset in panel. */
const MENU_TITLE_Y = 36;
/** Title text size. */
const MENU_TITLE_SIZE = 18;
/** Title text adjust. */
const MENU_TITLE_ADJUST = 14;
/** "Enter building?" y offset. */
const MENU_ENTER_Y = 68;
/** "Enter building?" text adjust. */
const MENU_ENTER_ADJUST = 10;
/** "(Esc or Leave...)" y offset. */
const MENU_ESC_Y = 88;
/** "(Esc or Leave...)" text adjust. */
const MENU_ESC_ADJUST = 9;
/** Button y offset within panel (from panel top). */
const MENU_BTN_Y_OFFSET = 110;
/** Button width. */
const MENU_BTN_W = 120;
/** Button height. */
const MENU_BTN_H = 42;
/** Gap between enter and leave buttons. */
const MENU_BTN_GAP = 8;

export class BuildingSystem implements GameSystem {
  private onDoor = false;
  private _menuOpen = false;
  private dismissed = false;
  private activeDoorIdx = -1;

  constructor(
    private readonly gameMap: GameMap,
    private readonly onEnterBuilding: (entry: BuildingEntry) => void,
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

  /** Called each gameplay frame. Detects when the active player is on a door tile. */
  detect(active: { x: number; y: number }): void {
    const entries = this.gameMap.buildingEntries;
    if (entries.length === 0) return;

    const tx = Math.floor((active.x + TILE_SIZE * TILE_CENTER_FRAC) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * TILE_CENTER_FRAC) / TILE_SIZE);

    const idx = entries.findIndex((e) => e.doorTile.x === tx && e.doorTile.y === ty);
    const wasOn = this.onDoor;
    this.onDoor = idx !== -1;

    if (!this.onDoor) {
      this.dismissed = false;
      this._menuOpen = false;
      this.activeDoorIdx = -1;
    } else if (!wasOn && !this.dismissed) {
      this.activeDoorIdx = idx;
      this._menuOpen = true;
    }
  }

  handleClick(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this._menuOpen) return false;
    const rects = this.menuRects(canvas);
    if (
      mx >= rects.enter.x &&
      mx <= rects.enter.x + rects.enter.w &&
      my >= rects.enter.y &&
      my <= rects.enter.y + rects.enter.h
    ) {
      const entry = this.gameMap.buildingEntries[this.activeDoorIdx];
      this.onEnterBuilding(entry);
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

  /** Renders a pulsing ▶ door indicator above each building entrance. */
  renderDoorHints(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    canvas: HTMLCanvasElement,
  ): void {
    const ts = TILE_SIZE;
    const pulse =
      DOOR_HINT_PULSE_BASE + Math.sin(Date.now() / DOOR_HINT_PULSE_PERIOD) * DOOR_HINT_PULSE_RANGE;
    for (const entry of this.gameMap.buildingEntries) {
      const sx = entry.doorTile.x * ts - camX + Math.floor(ts / 2);
      const sy = entry.doorTile.y * ts - camY;
      const CULLING_HEIGHT_TILES = 3;
      if (
        sx < -ts ||
        sx > canvas.width + ts ||
        sy < -ts * CULLING_HEIGHT_TILES ||
        sy > canvas.height + ts
      )
        continue;

      // Small glowing marker above the door
      const arrowSize = Math.floor(ts * ARROW_SIZE_FRACTION);
      const ARROW_TEXT_ADJUST_FRACTION = 0.8;
      drawText(ctx, '▶', {
        x: sx,
        y: sy - ARROW_Y_OFFSET - Math.round(arrowSize * ARROW_TEXT_ADJUST_FRACTION),
        size: arrowSize,
        bold: true,
        color: `rgba(250, 220, 80, ${pulse})`,
        align: 'center',
      });

      // Building name label
      const BUILDING_NAME_TEXT_ADJUST = 9;
      const BUILDING_NAME_Y_EXTRA = 2;
      drawText(ctx, entry.name, {
        x: sx,
        y: sy - ts * BUILDING_NAME_Y_FRACTION - BUILDING_NAME_Y_EXTRA - BUILDING_NAME_TEXT_ADJUST,
        size: 11,
        color: `rgba(255,255,220,${pulse * BUILDING_NAME_ALPHA_MULT})`,
        align: 'center',
      });
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._menuOpen) return;
    const entry = this.gameMap.buildingEntries[this.activeDoorIdx];

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = `rgba(0,0,0,${MENU_BACKDROP_ALPHA})`;
    ctx.fillRect(0, 0, cw, ch);

    const panelW = MENU_PANEL_W;
    const panelH = MENU_PANEL_H;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#0d1a09';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    const icon =
      entry.type === 'tower'
        ? '🏰'
        : entry.type === 'restaurant'
          ? '🍽'
          : entry.type === 'store'
            ? '🏪'
            : '🏠';
    drawText(ctx, `${icon}  ${entry.name}  ${icon}`, {
      x: cw / 2,
      y: panelY + MENU_TITLE_Y - MENU_TITLE_ADJUST,
      size: MENU_TITLE_SIZE,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    drawText(ctx, 'Enter this building?', {
      x: cw / 2,
      y: panelY + MENU_ENTER_Y - MENU_ENTER_ADJUST,
      size: 13,
      color: '#94a3b8',
      align: 'center',
    });

    drawText(ctx, '(Esc or Leave to stay outside)', {
      x: cw / 2,
      y: panelY + MENU_ESC_Y - MENU_ESC_ADJUST,
      size: 11,
      color: '#64748b',
      align: 'center',
    });

    const rects = this.menuRects(canvas);

    drawButton(ctx, {
      x: rects.enter.x,
      y: rects.enter.y,
      width: rects.enter.w,
      height: rects.enter.h,
      label: 'Enter',
      fill: '#1a4d0d',
      border: '#6aaa44',
      borderWidth: 1.5,
      radius: 4,
      labelSize: 14,
      labelColor: '#d4edaa',
    });

    drawButton(ctx, {
      x: rects.stay.x,
      y: rects.stay.y,
      width: rects.stay.w,
      height: rects.stay.h,
      label: 'Leave',
      ...BUTTON_PRESETS.primary,
      border: '#475569',
      labelSize: 14,
      labelColor: '#94a3b8',
    });
  }

  private menuRects(canvas: HTMLCanvasElement): {
    enter: { x: number; y: number; w: number; h: number };
    stay: { x: number; y: number; w: number; h: number };
  } {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = MENU_PANEL_H;
    const panelY = ch / 2 - panelH / 2;
    const btnW = MENU_BTN_W;
    const btnH = MENU_BTN_H;
    const btnY = panelY + MENU_BTN_Y_OFFSET;
    return {
      enter: { x: cw / 2 - btnW - MENU_BTN_GAP, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + MENU_BTN_GAP, y: btnY, w: btnW, h: btnH },
    };
  }
}
