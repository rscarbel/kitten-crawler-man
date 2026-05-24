import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import {
  drawDumbbellFloor,
  drawBenchPressFloor,
  drawTreadmillFloor,
} from '../sprites/gymEquipmentSprite';
import { drawText } from '../ui/TextBox';

export type BarrierItemId = 'gym_dumbbell' | 'gym_bench_press' | 'gym_treadmill';

const CONSTRUCT_FRAMES = 60; // 1 second at 60 fps
/** Slow zone radius as a fraction of a tile. */
const SLOW_RADIUS_TILE_FRACTION = 0.9;
/** Tiles adjacent to a barrier that count as a slow zone (half-tile radius). */
const SLOW_RADIUS_PX = TILE_SIZE * SLOW_RADIUS_TILE_FRACTION;
/** Fraction of tile size used as center offset for tile-center calculations. */
const TILE_CENTER_FRACTION = 0.5;
/** Progress arc radius multiplier relative to tile size. */
const CONSTRUCT_ARC_RADIUS_MULT = 1.2;
/** Label y offset above the arc radius. */
const CONSTRUCT_LABEL_Y_OFFSET = 14;
/** Label size adjustment for drawText. */
const CONSTRUCT_LABEL_ADJUST = 7;
/** Slow zone pulse ring alpha base and range. */
const SLOW_PULSE_ALPHA_BASE = 0.18;
const SLOW_PULSE_ALPHA_RANGE = 0.08;
/** Pulse speed for slow zone ring animation. */
const SLOW_PULSE_SPEED = 0.004;

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

export class BarrierSystem implements GameSystem {
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
  beginConstruct(player: Player, hotbarIdx: number, itemId: BarrierItemId): void {
    if (this.pending) return; // Already constructing
    this.pending = {
      player,
      hotbarIdx,
      itemId,
      framesLeft: CONSTRUCT_FRAMES,
    };
  }

  /** Cancel any in-progress construction (e.g. player dies or pauses). */
  cancelConstruct(): void {
    this.pending = null;
  }

  // Update

  update(ctx: SystemContext): void {
    const { mobs } = ctx;
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
      const bwcx = barrier.worldX + TILE_SIZE * TILE_CENTER_FRACTION;
      const bwcy = barrier.worldY + TILE_SIZE * TILE_CENTER_FRACTION;
      for (const mob of mobs) {
        if (!mob.isAlive) continue;
        const mcx = mob.x + TILE_SIZE * TILE_CENTER_FRACTION;
        const mcy = mob.y + TILE_SIZE * TILE_CENTER_FRACTION;
        if (Math.hypot(mcx - bwcx, mcy - bwcy) < SLOW_RADIUS_PX) {
          mob.isSlowed = true;
        }
      }
    }
  }

  private finishConstruct(c: PendingConstruct): void {
    // Remove one item from player inventory
    const removed = c.player.inventory.removeOne(c.itemId);
    if (!removed) return; // Player lost the item before construction finished

    const ts = TILE_SIZE;
    const px = c.player.x + ts * TILE_CENTER_FRACTION;
    const py = c.player.y + ts * TILE_CENTER_FRACTION;
    const tileX = Math.floor(px / ts);
    const tileY = Math.floor(py / ts);

    // Don't stack barriers on the same tile
    const occupied = this.barriers.some((b) => b.tileX === tileX && b.tileY === tileY);
    if (occupied) {
      // Refund the item
      c.player.inventory.addItem(c.itemId, 1);
      return;
    }

    if (!this.gameMap.isWalkable(tileX, tileY)) {
      // Refund
      c.player.inventory.addItem(c.itemId, 1);
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
    const ptx = Math.floor((player.x + ts * TILE_CENTER_FRACTION) / ts);
    const pty = Math.floor((player.y + ts * TILE_CENTER_FRACTION) / ts);
    const idx = this.barriers.findIndex((b) => b.tileX === ptx && b.tileY === pty);
    if (idx !== -1) {
      const b = this.barriers[idx];
      player.inventory.addItem(b.itemId, 1);
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
      ctx.globalAlpha =
        SLOW_PULSE_ALPHA_BASE + SLOW_PULSE_ALPHA_RANGE * Math.sin(Date.now() * SLOW_PULSE_SPEED);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        sx + TILE_SIZE * TILE_CENTER_FRACTION,
        sy + TILE_SIZE * TILE_CENTER_FRACTION,
        SLOW_RADIUS_PX,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();

      // Pickup prompt when player is on this tile
      if (activePlayer) {
        const ts = TILE_SIZE;
        const ptx = Math.floor((activePlayer.x + ts * TILE_CENTER_FRACTION) / ts);
        const pty = Math.floor((activePlayer.y + ts * TILE_CENTER_FRACTION) / ts);
        if (ptx === b.tileX && pty === b.tileY) {
          drawInteractionPrompt(ctx, sx, sy, ts, 'Pick up');
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
    const cx = canvas.width * TILE_CENTER_FRACTION;
    const cy = canvas.height * TILE_CENTER_FRACTION;

    // Small progress arc near screen center (represents player's feet area)
    const radius = TILE_SIZE * CONSTRUCT_ARC_RADIUS_MULT;
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

    ctx.restore();

    // Label
    drawText(ctx, 'PLACING...', {
      x: cx,
      y: cy + radius + CONSTRUCT_LABEL_Y_OFFSET - CONSTRUCT_LABEL_ADJUST,
      size: 9,
      bold: true,
      color: '#60a5fa',
      align: 'center',
    });
  }
}
