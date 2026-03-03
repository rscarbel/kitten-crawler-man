import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { LootDrop } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { ItemId } from '../core/Inventory';

interface PendingLoot {
  x: number;
  y: number;
  loot: LootDrop;
  owner: HumanPlayer | CatPlayer;
  collected: boolean;
  ttl: number;
  pickupDelay: number;
  droppedByPlayer?: boolean;
}

export interface FloorItem {
  x: number;
  y: number;
  id: ItemId;
  quantity: number;
}

export class LootSystem {
  private pendingLoots: PendingLoot[] = [];
  readonly floorItems: FloorItem[] = [];

  constructor(private readonly gameMap: GameMap) {}

  addLoot(
    x: number,
    y: number,
    loot: LootDrop,
    owner: HumanPlayer | CatPlayer,
  ): void {
    this.pendingLoots.push({
      x,
      y,
      loot,
      owner,
      collected: false,
      ttl: 600,
      pickupDelay: 0,
    });
  }

  addPlayerDrop(
    x: number,
    y: number,
    id: ItemId,
    quantity: number,
    dropper: HumanPlayer | CatPlayer,
  ): void {
    const dropPos = this.findDropPosition(x, y);
    this.pendingLoots.push({
      x: dropPos.x,
      y: dropPos.y,
      loot: { coins: 0, items: [{ id, quantity }] },
      owner: dropper,
      collected: false,
      ttl: 600,
      pickupDelay: 0,
      droppedByPlayer: true,
    });
  }

  update(
    active: HumanPlayer | CatPlayer,
    companion: HumanPlayer | CatPlayer,
  ): void {
    for (const loot of this.pendingLoots) {
      if (loot.collected) continue;
      loot.ttl--;
      if (loot.pickupDelay > 0) {
        loot.pickupDelay--;
        continue;
      }

      if (loot.droppedByPlayer) {
        for (const player of [active, companion] as (
          | HumanPlayer
          | CatPlayer
        )[]) {
          if (loot.collected) break;
          const dist = Math.hypot(
            player.x + TILE_SIZE * 0.5 - loot.x,
            player.y + TILE_SIZE * 0.5 - loot.y,
          );
          if (dist <= TILE_SIZE * 1.5) {
            player.coins += loot.loot.coins;
            for (const it of loot.loot.items) {
              player.inventory.addItem(it.id, it.quantity);
            }
            loot.collected = true;
          }
        }
        continue;
      }

      // Mob-dropped loot — attributed owner auto-collects on proximity
      if (loot.owner === active) {
        const dist = Math.hypot(
          active.x + TILE_SIZE * 0.5 - loot.x,
          active.y + TILE_SIZE * 0.5 - loot.y,
        );
        if (dist <= TILE_SIZE * 1.5) {
          active.coins += loot.loot.coins;
          for (const it of loot.loot.items) {
            active.inventory.addItem(it.id, it.quantity);
          }
          loot.collected = true;
        }
      }
      if (!loot.collected && loot.owner === companion) {
        const outOfCombat =
          companion.autoTarget === null || !companion.autoTarget.isAlive;
        if (outOfCombat) {
          const dist = Math.hypot(
            companion.x + TILE_SIZE * 0.5 - loot.x,
            companion.y + TILE_SIZE * 0.5 - loot.y,
          );
          if (dist <= TILE_SIZE * 1.5) {
            companion.coins += loot.loot.coins;
            for (const it of loot.loot.items) {
              companion.inventory.addItem(it.id, it.quantity);
            }
            loot.collected = true;
          }
        }
      }
    }
    this.pendingLoots = this.pendingLoots.filter(
      (l) => !l.collected && l.ttl > 0,
    );
  }

  tryCollectLootAt(
    mx: number,
    my: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    for (const loot of this.pendingLoots) {
      if (loot.owner !== active) continue;
      const dist = Math.hypot(
        active.x + TILE_SIZE * 0.5 - loot.x,
        active.y + TILE_SIZE * 0.5 - loot.y,
      );
      if (dist > TILE_SIZE * 3) continue;

      const sx = loot.x - camX;
      const sy = loot.y - camY;
      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0)
        parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');
      const bw = Math.max(54, label.length * 7 + 16);
      const bh = 20;
      const bx = sx - bw / 2;
      const by = sy - 26;

      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        active.coins += loot.loot.coins;
        for (const it of loot.loot.items) {
          active.inventory.addItem(it.id, it.quantity);
        }
        loot.collected = true;
        return true;
      }
    }
    return false;
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    for (const loot of this.pendingLoots) {
      const sx = loot.x - camX;
      const sy = loot.y - camY;

      const parts: string[] = [];
      if (loot.loot.coins > 0) parts.push(`\u{1FA99}${loot.loot.coins}`);
      if (loot.loot.items.length > 0)
        parts.push(`+${loot.loot.items.length} item`);
      const label = parts.join(' ');

      const alpha = Math.min(1, loot.ttl / 120);
      ctx.save();
      ctx.globalAlpha = alpha;

      const bw = Math.max(54, label.length * 7 + 16);
      const bh = 20;
      const bx = sx - bw / 2;
      const by = sy - 26;
      ctx.fillStyle =
        loot.owner === active ? 'rgba(15,23,42,0.85)' : 'rgba(15,23,42,0.45)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = loot.owner === active ? '#fbbf24' : '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(bx + 10, by + bh / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = loot.owner === active ? '#fde68a' : '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 18, by + bh / 2 + 4);

      if (loot.owner === active) {
        const dist = Math.hypot(
          active.x + TILE_SIZE * 0.5 - loot.x,
          active.y + TILE_SIZE * 0.5 - loot.y,
        );
        if (dist <= TILE_SIZE * 3) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('[click]', sx, by - 3);
        }
      }

      ctx.restore();
    }
  }

  findDropPosition(
    dropperX: number,
    dropperY: number,
  ): { x: number; y: number } {
    const ts = TILE_SIZE;
    const cx = Math.floor((dropperX + ts * 0.5) / ts);
    const cy = Math.floor((dropperY + ts * 0.5) / ts);
    for (let r = 2; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) < r && Math.abs(dy) < r) continue;
          if (this.gameMap.isWalkable(cx + dx, cy + dy)) {
            return {
              x: (cx + dx) * ts + ts * 0.5,
              y: (cy + dy) * ts + ts * 0.5,
            };
          }
        }
      }
    }
    return { x: dropperX + ts * 0.5, y: dropperY + ts * 0.5 };
  }
}
