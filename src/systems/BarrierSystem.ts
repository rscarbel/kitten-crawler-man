import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { ItemId } from '../core/Inventory';
import {
  drawDumbbellFloor,
  drawBenchPressFloor,
  drawTreadmillFloor,
} from '../sprites/gymEquipmentSprite';

export type BarrierItemId = 'gym_dumbbell' | 'gym_bench_press' | 'gym_treadmill';

const CONSTRUCT_FRAMES = 60; // 1 second at 60 fps
/** Tiles adjacent to a barrier that count as a slow zone (half-tile radius). */
const SLOW_RADIUS_PX = TILE_SIZE * 0.9;

interface PlacedBarrier {
  tileX: number;
  tileY: number;
  worldX: number; // = tileX * TILE_SIZE
  worldY: number;
  itemId: BarrierItemId;
  placer: Player; // who placed it (used for pickup-back logic)
}

interface PendingConstruct {
  player: Player;
  hotbarIdx: number;
  itemId: BarrierItemId;
  framesLeft: number;
}

export class BarrierSystem {
  private barriers: PlacedBarrier[] = [];
  private pending: PendingConstruct | null = null;

  constructor(private readonly gameMap: GameMap) {}

  // Queries

  get isConstructing(): boolean {
    return this.pending !== null;
  }

  get pendingConstructHotbarIdx(): number {
    return this.pending?.hotbarIdx ?? -1;
  }

  // Actions

  /** Start the 1-second construct animation for the given hotbar slot. */
  beginConstruct(player: Player, hotbarIdx: number, itemId: ItemId): void {
    if (this.pending) return; // Already constructing
    const barrierItemId = itemId as BarrierItemId;
    this.pending = {
      player,
      hotbarIdx,
      itemId: barrierItemId,
      framesLeft: CONSTRUCT_FRAMES,
    };
  }

  /** Cancel any in-progress construction (e.g. player dies or pauses). */
  cancelConstruct(): void {
    this.pending = null;
  }

  // Update

  update(mobs: Mob[], _mobGrid: unknown, _gameMap: unknown): void {
    // Reset all mobs' slow state — BarrierSystem re-applies it each frame
    for (const mob of mobs) {
      mob.isSlowed = false;
    }

    // Tick pending construction
    if (this.pending) {
      this.pending.framesLeft--;
      if (this.pending.framesLeft <= 0) {
        this.finishConstruct(this.pending);
        this.pending = null;
      }
    }

    // Apply slow effect to mobs near active barriers
    for (const barrier of this.barriers) {
      const bwcx = barrier.worldX + TILE_SIZE * 0.5;
      const bwcy = barrier.worldY + TILE_SIZE * 0.5;
      for (const mob of mobs) {
        if (!mob.isAlive) continue;
        const mcx = mob.x + TILE_SIZE * 0.5;
        const mcy = mob.y + TILE_SIZE * 0.5;
        if (Math.hypot(mcx - bwcx, mcy - bwcy) < SLOW_RADIUS_PX) {
          mob.isSlowed = true;
        }
      }
    }
  }

  private finishConstruct(c: PendingConstruct): void {
    // Remove one item from player inventory
    const removed = c.player.inventory.removeOne(c.itemId as ItemId);
    if (!removed) return; // Player lost the item before construction finished

    const ts = TILE_SIZE;
    const px = c.player.x + ts * 0.5;
    const py = c.player.y + ts * 0.5;
    const tileX = Math.floor(px / ts);
    const tileY = Math.floor(py / ts);

    // Don't stack barriers on the same tile
    const occupied = this.barriers.some((b) => b.tileX === tileX && b.tileY === tileY);
    if (occupied) {
      // Refund the item
      c.player.inventory.addItem(c.itemId as ItemId, 1);
      return;
    }

    if (!this.gameMap.isWalkable(tileX, tileY)) {
      // Refund
      c.player.inventory.addItem(c.itemId as ItemId, 1);
      return;
    }

    this.barriers.push({
      tileX,
      tileY,
      worldX: tileX * ts,
      worldY: tileY * ts,
      itemId: c.itemId,
      placer: c.player,
    });
  }

  /**
   * Attempt to pick up a placed barrier that `player` is standing on.
   * Called on explicit Space press — returns true if an item was reclaimed.
   */
  tryPickupNear(player: Player): boolean {
    if (!player.isAlive) return false;
    const ts = TILE_SIZE;
    const ptx = Math.floor((player.x + ts * 0.5) / ts);
    const pty = Math.floor((player.y + ts * 0.5) / ts);
    const idx = this.barriers.findIndex((b) => b.tileX === ptx && b.tileY === pty);
    if (idx !== -1) {
      const b = this.barriers[idx];
      player.inventory.addItem(b.itemId as ItemId, 1);
      this.barriers.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Render

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, activePlayer?: Player): void {
    for (const b of this.barriers) {
      const sx = b.worldX - camX;
      const sy = b.worldY - camY;

      switch (b.itemId) {
        case 'gym_dumbbell':
          drawDumbbellFloor(ctx, sx, sy, TILE_SIZE);
          break;
        case 'gym_bench_press':
          drawBenchPressFloor(ctx, sx, sy, TILE_SIZE);
          break;
        case 'gym_treadmill':
          drawTreadmillFloor(ctx, sx, sy, TILE_SIZE);
          break;
      }

      // Slow zone pulse ring
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(Date.now() * 0.004);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE * 0.5, sy + TILE_SIZE * 0.5, SLOW_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Pickup prompt when player is on this tile
      if (activePlayer) {
        const ts = TILE_SIZE;
        const ptx = Math.floor((activePlayer.x + ts * 0.5) / ts);
        const pty = Math.floor((activePlayer.y + ts * 0.5) / ts);
        if (ptx === b.tileX && pty === b.tileY) {
          ctx.save();
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fbbf24';
          ctx.fillText('[Space] Pick up', sx + ts * 0.5, sy - 4);
          ctx.restore();
        }
      }
    }
  }

  /**
   * Render the construct progress indicator around the player's feet.
   * Draw this on top of the HUD layer.
   */
  renderConstructUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.pending) return;

    const ratio = 1 - this.pending.framesLeft / CONSTRUCT_FRAMES;
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.5;

    // Small progress arc near screen center (represents player's feet area)
    const radius = TILE_SIZE * 1.2;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * ratio;

    ctx.save();
    // Outer ring (track)
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Progress fill
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Label
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PLACING...', cx, cy + radius + 14);
    ctx.textAlign = 'left';

    ctx.restore();
  }
}
