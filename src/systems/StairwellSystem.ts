import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LevelDef } from '../levels/types';
import type { GameSystem, SystemContext } from './GameSystem';
import { getLevelDef } from '../levels';

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
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
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
    const bw = ts * 2;
    const bh = ts * 2;
    const pulse = 0.7 + Math.sin(Date.now() / 500) * 0.2;
    for (const { x, y } of this.gameMap.stairwellTiles) {
      const sx = x * ts - camX;
      const sy = y * ts - camY;
      if (sx < -bw || sx > canvas.width || sy < -bh || sy > canvas.height) continue;

      ctx.fillStyle = '#0d0718';
      ctx.fillRect(sx, sy, bw, bh);

      const stepCount = 4;
      const stepH = Math.floor(bh / stepCount);
      for (let i = 0; i < stepCount; i++) {
        const brightness = 180 - i * 35;
        ctx.fillStyle = `rgb(${brightness}, ${Math.floor(brightness * 0.55)}, 0)`;
        ctx.fillRect(sx + i * 6, sy + i * stepH, bw - i * 12, stepH + 1);
      }

      ctx.strokeStyle = `rgba(168, 85, 247, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, bw - 2, bh - 2);

      ctx.fillStyle = `rgba(233, 213, 255, ${pulse})`;
      ctx.font = `bold ${Math.floor(bh * 0.42)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx + bw / 2, sy + bh * 0.67);
      ctx.textAlign = 'left';
    }
  }

  renderMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#0d0920';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';

    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('▼  Stairwell  ▼', cw / 2, panelY + 38);

    const nextId = this.levelDef.nextLevelId;
    const nextName = nextId ? getLevelDef(nextId).name : 'Next Floor';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`Descend to: ${nextName}?`, cw / 2, panelY + 68);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.fillText('(Esc or Stay to remain on this floor)', cw / 2, panelY + 88);

    const rects = this.menuRects(canvas);

    ctx.fillStyle = '#4c1d95';
    ctx.fillRect(rects.descend.x, rects.descend.y, rects.descend.w, rects.descend.h);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.descend.x, rects.descend.y, rects.descend.w, rects.descend.h);
    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Descend', rects.descend.x + rects.descend.w / 2, rects.descend.y + 27);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.stay.x, rects.stay.y, rects.stay.w, rects.stay.h);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('Stay', rects.stay.x + rects.stay.w / 2, rects.stay.y + 27);

    ctx.textAlign = 'left';
  }

  private menuRects(canvas: HTMLCanvasElement): {
    descend: { x: number; y: number; w: number; h: number };
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
      descend: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
    };
  }
}
