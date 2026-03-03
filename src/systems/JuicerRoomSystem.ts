import { TILE_SIZE } from '../core/constants';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Juicer } from '../creatures/Juicer';
import {
  drawDumbbellFloor,
  drawBenchPressFloor,
  drawTreadmillFloor,
} from '../sprites/gymEquipmentSprite';

export type GymItemId = 'gym_dumbbell' | 'gym_bench_press' | 'gym_treadmill';

/** Respawn timers in frames */
const RESPAWN: Record<GymItemId, number> = {
  gym_dumbbell: 60, // 1 second
  gym_bench_press: 300, // 5 seconds
  gym_treadmill: 300, // 5 seconds
};

interface GymPickup {
  relTileX: number; // relative to room origin (tile coords)
  relTileY: number;
  itemId: GymItemId;
  active: boolean;
  respawnTimer: number;
  worldX: number; // cached world pixel position (top-left of tile)
  worldY: number;
}

/**
 * Relative tile positions (within the 22×18 boss room) for each gym pickup.
 * Origin = top-left tile of the room.
 */
const DUMBBELL_POSITIONS = [
  { relTileX: 4, relTileY: 4 },
  { relTileX: 17, relTileY: 4 },
  { relTileX: 4, relTileY: 13 },
  { relTileX: 17, relTileY: 13 },
];

const BENCH_POSITIONS = [
  { relTileX: 4, relTileY: 9 },
  { relTileX: 17, relTileY: 9 },
];

const TREADMILL_POSITIONS = [
  { relTileX: 9, relTileY: 3 },
  { relTileX: 12, relTileY: 3 },
];

export class JuicerRoomSystem {
  private pickups: GymPickup[] = [];
  private readonly roomOriginX: number; // tile coords
  private readonly roomOriginY: number;

  constructor(
    bossRoomBounds: { x: number; y: number; w: number; h: number } | undefined,
  ) {
    // If no second boss room was generated, system is a no-op
    if (!bossRoomBounds) {
      this.roomOriginX = -9999;
      this.roomOriginY = -9999;
      return;
    }

    this.roomOriginX = bossRoomBounds.x;
    this.roomOriginY = bossRoomBounds.y;

    // Build pickup list
    for (const pos of DUMBBELL_POSITIONS) {
      this.pickups.push(
        this.makePickup(pos.relTileX, pos.relTileY, 'gym_dumbbell'),
      );
    }
    for (const pos of BENCH_POSITIONS) {
      this.pickups.push(
        this.makePickup(pos.relTileX, pos.relTileY, 'gym_bench_press'),
      );
    }
    for (const pos of TREADMILL_POSITIONS) {
      this.pickups.push(
        this.makePickup(pos.relTileX, pos.relTileY, 'gym_treadmill'),
      );
    }
  }

  private makePickup(
    relTileX: number,
    relTileY: number,
    itemId: GymItemId,
  ): GymPickup {
    const absTileX = this.roomOriginX + relTileX;
    const absTileY = this.roomOriginY + relTileY;
    return {
      relTileX,
      relTileY,
      itemId,
      active: true,
      respawnTimer: 0,
      worldX: absTileX * TILE_SIZE,
      worldY: absTileY * TILE_SIZE,
    };
  }

  /**
   * Attempt to pick up a gym item near `player` (called on Space press).
   * Returns true if an item was collected.
   */
  tryPickupNear(player: HumanPlayer | CatPlayer): boolean {
    if (this.roomOriginX === -9999) return false;
    const ts = TILE_SIZE;
    const collectRadius = ts * 1.2;
    const pcx = player.x + ts * 0.5;
    const pcy = player.y + ts * 0.5;
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const wcx = pickup.worldX + ts * 0.5;
      const wcy = pickup.worldY + ts * 0.5;
      if (Math.hypot(pcx - wcx, pcy - wcy) < collectRadius) {
        player.inventory.addItem(pickup.itemId, 1);
        pickup.active = false;
        pickup.respawnTimer = RESPAWN[pickup.itemId];
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the world-space positions of all currently active dumbbells.
   * Juicer calls this each frame to find the nearest one.
   */
  getActiveDumbbellPositions(): Array<{ x: number; y: number }> {
    return this.pickups
      .filter((p) => p.active && p.itemId === 'gym_dumbbell')
      .map((p) => ({
        x: p.worldX + TILE_SIZE * 0.5,
        y: p.worldY + TILE_SIZE * 0.5,
      }));
  }

  update(
    _human: HumanPlayer,
    _cat: CatPlayer,
    juicer: Juicer | null,
    _mobs: unknown,
  ): void {
    if (this.roomOriginX === -9999) return;

    const ts = TILE_SIZE;

    for (const pickup of this.pickups) {
      // Tick respawn timer
      if (!pickup.active) {
        pickup.respawnTimer--;
        if (pickup.respawnTimer <= 0) {
          pickup.active = true;
        }
        continue;
      }

      // Check Juicer pickup request
      if (
        juicer &&
        juicer.requestDumbbellAt &&
        pickup.itemId === 'gym_dumbbell'
      ) {
        const req = juicer.requestDumbbellAt;
        const wcx = pickup.worldX + ts * 0.5;
        const wcy = pickup.worldY + ts * 0.5;
        if (Math.hypot(req.x - wcx, req.y - wcy) < ts) {
          pickup.active = false;
          pickup.respawnTimer = RESPAWN['gym_dumbbell'];
          juicer.onDumbbellPickedUp();
        }
      }
    }

    // Update Juicer's nearestDumbbell pointer
    if (juicer && juicer.isAlive) {
      const positions = this.getActiveDumbbellPositions();
      if (positions.length > 0) {
        const jcx = juicer.x + ts * 0.5;
        const jcy = juicer.y + ts * 0.5;
        let nearest = positions[0];
        let nearestDist = Math.hypot(
          positions[0].x - jcx,
          positions[0].y - jcy,
        );
        for (const pos of positions) {
          const d = Math.hypot(pos.x - jcx, pos.y - jcy);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = pos;
          }
        }
        juicer.nearestDumbbellPos = nearest;
      } else {
        juicer.nearestDumbbellPos = null;
      }
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayer?: HumanPlayer | CatPlayer,
  ): void {
    if (this.roomOriginX === -9999) return;

    const ts = TILE_SIZE;
    const collectRadius = ts * 1.2;

    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const sx = pickup.worldX - camX;
      const sy = pickup.worldY - camY;

      switch (pickup.itemId) {
        case 'gym_dumbbell':
          drawDumbbellFloor(ctx, sx, sy, ts);
          break;
        case 'gym_bench_press':
          drawBenchPressFloor(ctx, sx, sy, ts);
          break;
        case 'gym_treadmill':
          drawTreadmillFloor(ctx, sx, sy, ts);
          break;
      }

      // Show "Space to pick up" prompt when player is nearby
      if (activePlayer) {
        const pcx = activePlayer.x + ts * 0.5;
        const pcy = activePlayer.y + ts * 0.5;
        const wcx = pickup.worldX + ts * 0.5;
        const wcy = pickup.worldY + ts * 0.5;
        if (Math.hypot(pcx - wcx, pcy - wcy) < collectRadius) {
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
}
