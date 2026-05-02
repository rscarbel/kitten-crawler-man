import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';

export type BuildingEntry = {
  doorTile: { x: number; y: number };
  name: string;
  type: 'house' | 'tower' | 'restaurant' | 'store';
};

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

    const tx = Math.floor((active.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * 0.5) / TILE_SIZE);

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
    const pulse = 0.6 + Math.sin(Date.now() / 600) * 0.3;
    for (const entry of this.gameMap.buildingEntries) {
      const sx = entry.doorTile.x * ts - camX + Math.floor(ts / 2);
      const sy = entry.doorTile.y * ts - camY;
      if (sx < -ts || sx > canvas.width + ts || sy < -ts * 3 || sy > canvas.height + ts) continue;

      // Small glowing marker above the door
      const arrowSize = Math.floor(ts * 0.55);
      drawText(ctx, '▶', {
        x: sx,
        y: sy - 4 - Math.round(arrowSize * 0.8),
        size: arrowSize,
        bold: true,
        color: `rgba(250, 220, 80, ${pulse})`,
        align: 'center',
      });

      // Building name label
      drawText(ctx, entry.name, {
        x: sx,
        y: sy - ts * 0.6 - 2 - 9,
        size: 11,
        color: `rgba(255,255,220,${pulse * 0.85})`,
        align: 'center',
      });
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._menuOpen) return;
    const entry = this.gameMap.buildingEntries[this.activeDoorIdx];

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
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
      y: panelY + 36 - 14,
      size: 18,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    drawText(ctx, 'Enter this building?', {
      x: cw / 2,
      y: panelY + 68 - 10,
      size: 13,
      color: '#94a3b8',
      align: 'center',
    });

    drawText(ctx, '(Esc or Leave to stay outside)', {
      x: cw / 2,
      y: panelY + 88 - 9,
      size: 11,
      color: '#64748b',
      align: 'center',
    });

    const rects = this.menuRects(canvas);

    ctx.fillStyle = '#1a4d0d';
    ctx.fillRect(rects.enter.x, rects.enter.y, rects.enter.w, rects.enter.h);
    ctx.strokeStyle = '#6aaa44';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.enter.x, rects.enter.y, rects.enter.w, rects.enter.h);
    drawText(ctx, 'Enter', {
      x: rects.enter.x + rects.enter.w / 2,
      y: rects.enter.y + 27 - 11,
      size: 14,
      bold: true,
      color: '#d4edaa',
      align: 'center',
    });

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    drawText(ctx, 'Leave', {
      x: rects.stay.x + rects.stay.w / 2,
      y: rects.stay.y + 27 - 11,
      size: 14,
      bold: true,
      color: '#94a3b8',
      align: 'center',
    });
  }

  private menuRects(canvas: HTMLCanvasElement): {
    enter: { x: number; y: number; w: number; h: number };
    stay: { x: number; y: number; w: number; h: number };
  } {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
    const btnY = panelY + 110;
    return {
      enter: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
    };
  }
}
