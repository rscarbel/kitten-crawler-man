import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import { platform } from '../core/Platform';
import type { GameSystem } from './GameSystem';
import { frameTime } from '../utils';
import { drawText } from '../ui/TextBox';

export class MiniMapSystem implements GameSystem {
  private fogOfWar: Uint8Array;
  private _expanded = false;
  private _scrollTX = 0;
  private _scrollTY = 0;
  private corpseMarkers: Array<{ x: number; y: number; ttl: number }> = [];

  private readonly REVEAL_RADIUS = 10;
  readonly NORMAL_SIZE = 160;
  readonly EXPANDED_SIZE = 240;

  /** Offscreen canvas caching revealed tile colors (1px per tile). */
  private _tileCache: OffscreenCanvas | HTMLCanvasElement;
  private _tileCacheCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(private readonly gameMap: GameMap) {
    const sz = gameMap.structure.length;
    this.fogOfWar = new Uint8Array(sz * sz);

    // Create offscreen tile cache (1px per tile, pre-filled with fog color)
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(sz, sz);
      const tctx = c.getContext('2d');
      if (!tctx) throw new Error('Failed to get 2D context for minimap');
      this._tileCache = c;
      this._tileCacheCtx = tctx;
    } else {
      const c = document.createElement('canvas');
      c.width = sz;
      c.height = sz;
      const tctx = c.getContext('2d');
      if (!tctx) throw new Error('Failed to get 2D context for minimap');
      this._tileCache = c;
      this._tileCacheCtx = tctx;
    }
    this._tileCacheCtx.fillStyle = '#111';
    this._tileCacheCtx.fillRect(0, 0, sz, sz);
  }

  get isExpanded(): boolean {
    return this._expanded;
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this._scrollTX = 0;
    this._scrollTY = 0;
  }

  /**
   * Pan the expanded minimap by a screen-pixel delta.
   * Only has effect when expanded (1 px = 1 tile at that scale).
   */
  pan(deltaX: number, deltaY: number): void {
    if (!this._expanded) return;
    const mapSize = this.gameMap.structure.length;
    // Dragging right moves the view left (standard map-pan convention)
    this._scrollTX -= deltaX;
    this._scrollTY -= deltaY;
    this._scrollTX = Math.max(-mapSize, Math.min(mapSize, this._scrollTX));
    this._scrollTY = Math.max(-mapSize, Math.min(mapSize, this._scrollTY));
  }

  revealAround(tileX: number, tileY: number): void {
    const mapSize = this.gameMap.structure.length;
    const r = this.REVEAL_RADIUS;
    const r2 = r * r;
    const cctx = this._tileCacheCtx;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapSize && ty >= 0 && ty < mapSize) {
          const idx = ty * mapSize + tx;
          if (this.fogOfWar[idx] === 0) {
            this.fogOfWar[idx] = 1;
            const tile = this.gameMap.structure[ty][tx];
            cctx.fillStyle = this.tileColor(tile.type);
            cctx.fillRect(tx, ty, 1, 1);
          }
        }
      }
    }
  }

  revealBossNeighborhood(bounds: { x: number; y: number; w: number; h: number }): void {
    const mapSize = this.gameMap.structure.length;
    const extra = 15;
    const x1 = Math.max(0, bounds.x - extra);
    const y1 = Math.max(0, bounds.y - extra);
    const x2 = Math.min(mapSize - 1, bounds.x + bounds.w + extra);
    const y2 = Math.min(mapSize - 1, bounds.y + bounds.h + extra);
    const cctx = this._tileCacheCtx;
    for (let ty = y1; ty <= y2; ty++) {
      for (let tx = x1; tx <= x2; tx++) {
        const idx = ty * mapSize + tx;
        if (this.fogOfWar[idx] === 0) {
          this.fogOfWar[idx] = 1;
          const tile = this.gameMap.structure[ty][tx];
          cctx.fillStyle = this.tileColor(tile.type);
          cctx.fillRect(tx, ty, 1, 1);
        }
      }
    }
  }

  addCorpseMarker(x: number, y: number): void {
    this.corpseMarkers.push({ x, y, ttl: 1800 });
  }

  tickCorpseMarkers(): void {
    for (let i = this.corpseMarkers.length - 1; i >= 0; i--) {
      if (--this.corpseMarkers[i].ttl <= 0) {
        this.corpseMarkers[i] = this.corpseMarkers[this.corpseMarkers.length - 1];
        this.corpseMarkers.pop();
      }
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    active: { x: number; y: number },
    companion: { x: number; y: number },
    mobs: Mob[],
    mordecaiPositions: Array<{ x: number; y: number }>,
    questMarkers: Array<{ x: number; y: number; type: 'exclamation' | 'question' | 'red_x' }> = [],
  ): void {
    const mapSize = this.gameMap.structure.length;
    const expanded = this._expanded;
    const mmSize = expanded ? this.EXPANDED_SIZE : this.NORMAL_SIZE;
    const pxPerTile = expanded ? 1 : 2;
    const tilesInView = Math.floor(mmSize / pxPerTile);
    const halfTiles = Math.floor(tilesInView / 2);

    const mmX = canvas.width - mmSize - 8;
    const mmY = 8;

    const playerTX = Math.floor((active.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const playerTY = Math.floor((active.y + TILE_SIZE * 0.5) / TILE_SIZE);

    // When expanded, honour scroll offset so the user can pan to explored areas.
    const viewCenterTX = expanded ? playerTX + this._scrollTX : playerTX;
    const viewCenterTY = expanded ? playerTY + this._scrollTY : playerTY;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Tiles — blit from offscreen cache (1px per tile → scaled by pxPerTile)
    const srcX = Math.max(0, Math.floor(viewCenterTX - halfTiles));
    const srcY = Math.max(0, Math.floor(viewCenterTY - halfTiles));
    const srcW = Math.min(mapSize - srcX, tilesInView);
    const srcH = Math.min(mapSize - srcY, tilesInView);
    const destOffX = (srcX - (viewCenterTX - halfTiles)) * pxPerTile;
    const destOffY = (srcY - (viewCenterTY - halfTiles)) * pxPerTile;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this._tileCache,
      srcX,
      srcY,
      srcW,
      srcH,
      mmX + destOffX,
      mmY + destOffY,
      srcW * pxPerTile,
      srcH * pxPerTile,
    );
    ctx.imageSmoothingEnabled = true;

    // Stairwells — white squares (always visible if revealed)
    for (const st of this.gameMap.stairwellTiles) {
      if (!this.fogOfWar[st.y * mapSize + st.x]) continue;
      const sx = mmX + (st.x - viewCenterTX + halfTiles) * pxPerTile - 1;
      const sy = mmY + (st.y - viewCenterTY + halfTiles) * pxPerTile - 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, pxPerTile + 2, pxPerTile + 2);
    }

    // Corpse markers — X
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    for (const corpse of this.corpseMarkers) {
      const ctx2TX = Math.floor(corpse.x / TILE_SIZE);
      const ctx2TY = Math.floor(corpse.y / TILE_SIZE);
      if (!this.fogOfWar[ctx2TY * mapSize + ctx2TX]) continue;
      const cx = mmX + (ctx2TX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const cy = mmY + (ctx2TY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 2);
      ctx.lineTo(cx + 2, cy + 2);
      ctx.moveTo(cx + 2, cy - 2);
      ctx.lineTo(cx - 2, cy + 2);
      ctx.stroke();
    }

    // Mobs — red dots (only within 20-tile radar range)
    const MOB_RADAR_PX = TILE_SIZE * 20;
    ctx.fillStyle = '#ef4444';
    for (const mob of mobs) {
      if (!mob.isAlive) continue;
      if (Math.hypot(mob.x - active.x, mob.y - active.y) > MOB_RADAR_PX) continue;
      const mobTX = Math.floor((mob.x + TILE_SIZE * 0.5) / TILE_SIZE);
      const mobTY = Math.floor((mob.y + TILE_SIZE * 0.5) / TILE_SIZE);
      if (!this.fogOfWar[mobTY * mapSize + mobTX]) continue;
      const mmDotX =
        mmX + (mobTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const mmDotY =
        mmY + (mobTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(mmDotX, mmDotY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Companion — blue dot
    const compTX = Math.floor((companion.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const compTY = Math.floor((companion.y + TILE_SIZE * 0.5) / TILE_SIZE);
    const compSX =
      mmX + (compTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const compSY =
      mmY + (compTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(compSX, compSY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Mordecai — white dot per safe room if revealed
    ctx.fillStyle = '#ffffff';
    for (const pos of mordecaiPositions) {
      if (!this.fogOfWar[pos.y * mapSize + pos.x]) continue;
      const msx = mmX + (pos.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const msy = mmY + (pos.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(msx, msy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Quest markers — yellow !, green ?, or red X
    // size=8 bold; old baseline was qsy+3; top = (qsy+3) - round(8*0.8) = (qsy+3) - 6 = qsy-3
    for (const qm of questMarkers) {
      if (!this.fogOfWar[qm.y * mapSize + qm.x]) continue;
      const qsx = mmX + (qm.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const qsy = mmY + (qm.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const pulse = 0.7 + 0.3 * Math.sin(frameTime * 5);
      if (qm.type === 'exclamation') {
        drawText(ctx, '!', {
          x: qsx,
          y: qsy - 3,
          size: 8,
          bold: true,
          color: '#fbbf24',
          alpha: pulse,
          align: 'center',
        });
      } else if (qm.type === 'question') {
        drawText(ctx, '?', {
          x: qsx,
          y: qsy - 3,
          size: 8,
          bold: true,
          color: '#4ade80',
          alpha: pulse,
          align: 'center',
        });
      } else {
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(qsx - 3, qsy - 3);
        ctx.lineTo(qsx + 3, qsy + 3);
        ctx.moveTo(qsx + 3, qsy - 3);
        ctx.lineTo(qsx - 3, qsy + 3);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Active player — green dot (at centre when unscrolled; offset when panned)
    const playerSX =
      mmX + (playerTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const playerSY =
      mmY + (playerTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(playerSX, playerSY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    const expandHint = platform.miniMapHint(expanded);
    drawText(ctx, expandHint, {
      x: mmX + mmSize / 2,
      y: mmY + mmSize + 3,
      size: 10,
      color: '#ffffff',
      outline: true,
      align: 'center',
    });
  }

  private tileColor(type: number): string {
    switch (type) {
      case 9:
        return '#000000'; // void border
      case 2:
        return '#3a3028'; // wall
      case 0:
        return '#3a7040'; // grass
      case 1:
        return '#6a5040'; // road
      case 4:
        return '#1a6880'; // water
      case 5:
        return '#606060'; // concrete (hallway)
      case 6:
        return '#707070'; // tile floor
      case 7:
        return '#503030'; // carpet
      case 8:
        return '#704030'; // wood
      case 10:
        return '#8a7040'; // safe room floor
      case 11:
        return '#2a1808'; // boss room floor
      default:
        return '#555555';
    }
  }

  dispose(): void {
    /* no-op — satisfies GameSystem interface */
  }
}
