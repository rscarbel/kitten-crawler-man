import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import { IS_MOBILE } from '../core/MobileDetect';

export class MiniMapSystem {
  private fogOfWar: Uint8Array;
  private _expanded = false;
  private corpseMarkers: Array<{ x: number; y: number; ttl: number }> = [];

  private readonly REVEAL_RADIUS = 10;
  readonly NORMAL_SIZE = 160;
  readonly EXPANDED_SIZE = 240;

  constructor(private readonly gameMap: GameMap) {
    const sz = gameMap.structure.length;
    this.fogOfWar = new Uint8Array(sz * sz);
  }

  get isExpanded(): boolean {
    return this._expanded;
  }

  toggle(): void {
    this._expanded = !this._expanded;
  }

  revealAround(tileX: number, tileY: number): void {
    const mapSize = this.gameMap.structure.length;
    const r = this.REVEAL_RADIUS;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapSize && ty >= 0 && ty < mapSize) {
          this.fogOfWar[ty * mapSize + tx] = 1;
        }
      }
    }
  }

  revealBossNeighborhood(bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): void {
    const mapSize = this.gameMap.structure.length;
    const extra = 15;
    const x1 = Math.max(0, bounds.x - extra);
    const y1 = Math.max(0, bounds.y - extra);
    const x2 = Math.min(mapSize - 1, bounds.x + bounds.w + extra);
    const y2 = Math.min(mapSize - 1, bounds.y + bounds.h + extra);
    for (let ty = y1; ty <= y2; ty++) {
      for (let tx = x1; tx <= x2; tx++) {
        this.fogOfWar[ty * mapSize + tx] = 1;
      }
    }
  }

  addCorpseMarker(x: number, y: number): void {
    this.corpseMarkers.push({ x, y, ttl: 1800 });
  }

  tickCorpseMarkers(): void {
    for (let i = this.corpseMarkers.length - 1; i >= 0; i--) {
      if (--this.corpseMarkers[i].ttl <= 0) this.corpseMarkers.splice(i, 1);
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    active: { x: number; y: number },
    companion: { x: number; y: number },
    mobs: Mob[],
    mordecaiPositions: Array<{ x: number; y: number }>,
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

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Tiles
    for (let dy = -halfTiles; dy <= halfTiles; dy++) {
      for (let dx = -halfTiles; dx <= halfTiles; dx++) {
        const tx = playerTX + dx;
        const ty = playerTY + dy;
        if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;

        const px = mmX + (dx + halfTiles) * pxPerTile;
        const py = mmY + (dy + halfTiles) * pxPerTile;

        const revealed = this.fogOfWar[ty * mapSize + tx] === 1;
        if (!revealed) {
          ctx.fillStyle = '#111';
          ctx.fillRect(px, py, pxPerTile, pxPerTile);
          continue;
        }

        const tile = this.gameMap.structure[ty]?.[tx];
        ctx.fillStyle = tile ? this.tileColor(tile.type) : '#555';
        ctx.fillRect(px, py, pxPerTile, pxPerTile);
      }
    }

    // Stairwells — white squares (always visible if revealed)
    for (const st of this.gameMap.stairwellTiles) {
      if (!this.fogOfWar[st.y * mapSize + st.x]) continue;
      const sx = mmX + (st.x - playerTX + halfTiles) * pxPerTile - 1;
      const sy = mmY + (st.y - playerTY + halfTiles) * pxPerTile - 1;
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
      const cx =
        mmX +
        (ctx2TX - playerTX + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      const cy =
        mmY +
        (ctx2TY - playerTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
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
      if (Math.hypot(mob.x - active.x, mob.y - active.y) > MOB_RADAR_PX)
        continue;
      const mobTX = Math.floor((mob.x + TILE_SIZE * 0.5) / TILE_SIZE);
      const mobTY = Math.floor((mob.y + TILE_SIZE * 0.5) / TILE_SIZE);
      if (!this.fogOfWar[mobTY * mapSize + mobTX]) continue;
      const mx =
        mmX +
        (mobTX - playerTX + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      const my =
        mmY +
        (mobTY - playerTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Companion — blue dot
    const compTX = Math.floor((companion.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const compTY = Math.floor((companion.y + TILE_SIZE * 0.5) / TILE_SIZE);
    const compSX =
      mmX +
      (compTX - playerTX + halfTiles) * pxPerTile +
      Math.floor(pxPerTile / 2);
    const compSY =
      mmY +
      (compTY - playerTY + halfTiles) * pxPerTile +
      Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(compSX, compSY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Mordecai — white dot per safe room if revealed
    ctx.fillStyle = '#ffffff';
    for (const pos of mordecaiPositions) {
      if (!this.fogOfWar[pos.y * mapSize + pos.x]) continue;
      const msx =
        mmX +
        (pos.x - playerTX + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      const msy =
        mmY +
        (pos.y - playerTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(msx, msy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active player — green dot at centre
    const playerSX = mmX + halfTiles * pxPerTile + Math.floor(pxPerTile / 2);
    const playerSY = mmY + halfTiles * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(playerSX, playerSY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Expand hint
    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    const expandHint = IS_MOBILE
      ? expanded
        ? 'Tap: collapse'
        : 'Tap: expand'
      : expanded
        ? 'M: collapse'
        : 'M: expand';
    ctx.fillText(expandHint, mmX + mmSize / 2, mmY + mmSize + 9);
    ctx.textAlign = 'left';
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
}
