import { TILE_SIZE } from '../core/constants';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawBenchPressFloor, drawTreadmillFloor } from '../sprites/gymEquipmentSprite';
import type { ArenaExterior } from '../map/DungeonGenerator';

type ArenaGymItemId = 'gym_bench_press' | 'gym_treadmill';

const RESPAWN_FRAMES = 300;

const TILE_CENTER_OFFSET = 0.5;
const PICKUP_COLLECT_RADIUS_RATIO = 1.2;

/**
 * Relative tile offsets from arena centre for each gym pickup.
 * Symmetric left/right so the layout feels intentional.
 * All positions are well within the ~13-tile interior radius.
 */
const BENCH_OFFSETS = [
  { dx: -5, dy: -5 },
  { dx: 5, dy: -5 },
];

const TREADMILL_OFFSETS = [
  { dx: -5, dy: 5 },
  { dx: 5, dy: 5 },
];

interface ArenaGymPickup {
  itemId: ArenaGymItemId;
  active: boolean;
  respawnTimer: number;
  worldX: number;
  worldY: number;
}

export class ArenaRoomSystem implements GameSystem {
  private readonly pickups: ArenaGymPickup[];
  private readonly hasArena: boolean;

  constructor(arena: ArenaExterior | undefined) {
    if (!arena) {
      this.pickups = [];
      this.hasArena = false;
      return;
    }

    this.hasArena = true;
    this.pickups = [];

    for (const { dx, dy } of BENCH_OFFSETS) {
      this.pickups.push(
        this.makePickup(arena.centre.x + dx, arena.centre.y + dy, 'gym_bench_press'),
      );
    }
    for (const { dx, dy } of TREADMILL_OFFSETS) {
      this.pickups.push(this.makePickup(arena.centre.x + dx, arena.centre.y + dy, 'gym_treadmill'));
    }
  }

  private makePickup(absTileX: number, absTileY: number, itemId: ArenaGymItemId): ArenaGymPickup {
    return {
      itemId,
      active: true,
      respawnTimer: 0,
      worldX: absTileX * TILE_SIZE,
      worldY: absTileY * TILE_SIZE,
    };
  }

  tryPickupNear(player: HumanPlayer | CatPlayer): boolean {
    if (!this.hasArena) return false;
    const ts = TILE_SIZE;
    const collectRadius = ts * PICKUP_COLLECT_RADIUS_RATIO;
    const pcx = player.x + ts * TILE_CENTER_OFFSET;
    const pcy = player.y + ts * TILE_CENTER_OFFSET;
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const wcx = pickup.worldX + ts * TILE_CENTER_OFFSET;
      const wcy = pickup.worldY + ts * TILE_CENTER_OFFSET;
      if (Math.hypot(pcx - wcx, pcy - wcy) < collectRadius) {
        player.inventory.addItem(pickup.itemId, 1);
        pickup.active = false;
        pickup.respawnTimer = RESPAWN_FRAMES;
        return true;
      }
    }
    return false;
  }

  update(_ctx: SystemContext): void {
    for (const pickup of this.pickups) {
      if (!pickup.active) {
        pickup.respawnTimer--;
        if (pickup.respawnTimer <= 0) {
          pickup.active = true;
        }
      }
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayer?: HumanPlayer | CatPlayer,
  ): void {
    if (!this.hasArena) return;

    const ts = TILE_SIZE;
    const collectRadius = ts * PICKUP_COLLECT_RADIUS_RATIO;

    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const sx = pickup.worldX - camX;
      const sy = pickup.worldY - camY;

      if (pickup.itemId === 'gym_bench_press') {
        drawBenchPressFloor(ctx, sx, sy, ts);
      } else {
        drawTreadmillFloor(ctx, sx, sy, ts);
      }

      if (activePlayer) {
        const pcx = activePlayer.x + ts * TILE_CENTER_OFFSET;
        const pcy = activePlayer.y + ts * TILE_CENTER_OFFSET;
        const wcx = pickup.worldX + ts * TILE_CENTER_OFFSET;
        const wcy = pickup.worldY + ts * TILE_CENTER_OFFSET;
        if (Math.hypot(pcx - wcx, pcy - wcy) < collectRadius) {
          drawInteractionPrompt(ctx, sx, sy, ts, 'Pick up');
        }
      }
    }
  }
}
