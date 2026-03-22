import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

export class TowerStairSystem implements GameSystem {
  private onUpStair = false;
  private onDownStair = false;
  private _upMenuOpen = false;
  private _downMenuOpen = false;
  private upDismissed = false;
  private downDismissed = false;

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
    const tx = Math.floor((active.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * 0.5) / TILE_SIZE);

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

  handleClick(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (this._upMenuOpen) {
      const rects = this.menuRects(canvas);
      if (this.hitRect(mx, my, rects.action)) {
        this.onAscend();
        return true;
      }
      if (this.hitRect(mx, my, rects.stay)) {
        this._upMenuOpen = false;
        this.upDismissed = true;
        return true;
      }
    }
    if (this._downMenuOpen) {
      const rects = this.menuRects(canvas);
      if (this.hitRect(mx, my, rects.action)) {
        this.onDescend();
        return true;
      }
      if (this.hitRect(mx, my, rects.stay)) {
        this._downMenuOpen = false;
        this.downDismissed = true;
        return true;
      }
    }
    return false;
  }

  renderStairHints(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const pulse = 0.6 + Math.sin(Date.now() / 500) * 0.3;
    ctx.fillStyle = `rgba(255, 220, 80, ${pulse})`;
    ctx.font = `bold ${Math.floor(TILE_SIZE * 0.45)}px monospace`;
    ctx.textAlign = 'center';

    for (const t of this.map._interiorStairUpTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      ctx.fillText('\u25B2 Up', sx, sy - 4);
    }
    for (const t of this.map._interiorStairDownTiles) {
      const sx = t.x * TILE_SIZE - camX + TILE_SIZE / 2;
      const sy = t.y * TILE_SIZE - camY;
      ctx.fillText('\u25BC Down', sx, sy - 4);
    }
    ctx.textAlign = 'left';
  }

  renderMenu(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._upMenuOpen && !this._downMenuOpen) return;

    const isUp = this._upMenuOpen;
    const targetFloor = isUp ? this.currentFloor + 1 : this.currentFloor - 1;
    const targetLabel = FLOOR_LABELS[targetFloor] ?? `Floor ${targetFloor + 1}`;

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 340;
    const panelH = 190;
    const panelX = cw / 2 - panelW / 2;
    const panelY = ch / 2 - panelH / 2;

    ctx.fillStyle = '#1a1408';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#d4a830';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';

    ctx.fillStyle = '#ffe8a0';
    ctx.font = 'bold 20px monospace';
    const arrow = isUp ? '\u25B2' : '\u25BC';
    ctx.fillText(`${arrow}  Staircase  ${arrow}`, cw / 2, panelY + 38);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(`${isUp ? 'Ascend' : 'Descend'} to: ${targetLabel}?`, cw / 2, panelY + 68);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px monospace';
    ctx.fillText('(Esc or Stay to remain on this floor)', cw / 2, panelY + 88);

    const rects = this.menuRects(canvas);

    ctx.fillStyle = '#5c3d0a';
    ctx.fillRect(rects.action.x, rects.action.y, rects.action.w, rects.action.h);
    ctx.strokeStyle = '#d4a830';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rects.action.x, rects.action.y, rects.action.w, rects.action.h);
    ctx.fillStyle = '#ffe8a0';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(
      isUp ? 'Ascend' : 'Descend',
      rects.action.x + rects.action.w / 2,
      rects.action.y + 27,
    );

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

  private menuRects(canvas: HTMLCanvasElement) {
    const cw = canvas.width;
    const ch = canvas.height;
    const panelH = 190;
    const panelY = ch / 2 - panelH / 2;
    const btnW = 120;
    const btnH = 42;
    const btnY = panelY + 110;
    return {
      action: { x: cw / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
      stay: { x: cw / 2 + 8, y: btnY, w: btnW, h: btnH },
    };
  }

  private hitRect(
    mx: number,
    my: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
  }
}
