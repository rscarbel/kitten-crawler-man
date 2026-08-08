import { TILE_SIZE } from '../core/constants';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { Juicer } from '../creatures/Juicer';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawJuicerShockwave } from '../sprites/juicerShockwave';
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

// Pickup detection
const TILE_CENTER_OFFSET = 0.5;
const PICKUP_COLLECT_RADIUS_RATIO = 1.2;
const PICKUP_JUICER_DETECT_RADIUS = 1; // tiles

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

// Room positioning
const ROOM_NOT_FOUND_POS = -9999;

/** Peak camera shake in px, on the frame his fists land. */
const SHAKE_PEAK_PX = 6;
/** Frames the shake takes to die away. */
const SHAKE_FRAMES = 16;
/** Centres `Math.random()` on zero so the shake swings both ways. */
const RANDOM_MIDPOINT = 0.5;

/**
 * The mutable half of a `GymPickup`. Item id and position are fixed at
 * construction from the boss room's bounds, so a checkpoint ignores them.
 */
interface GymPickupProgress {
  active: boolean;
  respawnTimer: number;
}

/** Point-in-time gym-pickup progress, restorable any number of times. */
export interface JuicerRoomCheckpoint {
  pickups: GymPickupProgress[];
}

export class JuicerRoomSystem implements GameSystem {
  private pickups: GymPickup[] = [];
  private readonly roomOriginX: number; // tile coords
  private readonly roomOriginY: number;
  /**
   * The live boss, cached each update. `render` is handed a camera and nothing
   * else, and his shockwave is floor paint that belongs in the ground pass.
   */
  private juicer: Juicer | null = null;
  /** True while a wave is running, so the shake is armed once and not per frame. */
  private shockwaveRunning = false;
  private shakeFrames = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(bossRoomBounds: { x: number; y: number; w: number; h: number } | undefined) {
    // If no second boss room was generated, system is a no-op
    if (!bossRoomBounds) {
      this.roomOriginX = ROOM_NOT_FOUND_POS;
      this.roomOriginY = ROOM_NOT_FOUND_POS;
      return;
    }

    this.roomOriginX = bossRoomBounds.x;
    this.roomOriginY = bossRoomBounds.y;

    // Build pickup list
    for (const pos of DUMBBELL_POSITIONS) {
      this.pickups.push(this.makePickup(pos.relTileX, pos.relTileY, 'gym_dumbbell'));
    }
    for (const pos of BENCH_POSITIONS) {
      this.pickups.push(this.makePickup(pos.relTileX, pos.relTileY, 'gym_bench_press'));
    }
    for (const pos of TREADMILL_POSITIONS) {
      this.pickups.push(this.makePickup(pos.relTileX, pos.relTileY, 'gym_treadmill'));
    }
  }

  private makePickup(relTileX: number, relTileY: number, itemId: GymItemId): GymPickup {
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
   * Snapshots which gym items are on the floor, so a run of deaths cannot farm
   * the same dumbbells forever.
   *
   * Each pickup's mutable half is copied out, and copied again on the way back
   * in, because the player can die many times against one snapshot.
   */
  captureCheckpoint(): JuicerRoomCheckpoint {
    return {
      pickups: this.pickups.map((pickup) => ({
        active: pickup.active,
        respawnTimer: pickup.respawnTimer,
      })),
    };
  }

  restoreCheckpoint(snapshot: JuicerRoomCheckpoint): void {
    const restoreCount = Math.min(this.pickups.length, snapshot.pickups.length);
    for (let index = 0; index < restoreCount; index++) {
      const pickup = this.pickups[index];
      const saved = snapshot.pickups[index];
      pickup.active = saved.active;
      pickup.respawnTimer = saved.respawnTimer;
    }
    // A punch from the run that died must not go on shaking the camera of the
    // one that replaces it.
    this.shockwaveRunning = false;
    this.shakeFrames = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /** Camera displacement for this frame; the scene adds it after clamping. */
  get cameraOffset(): { x: number; y: number } {
    return { x: this.shakeX, y: this.shakeY };
  }

  /**
   * Attempt to pick up a gym item near `player` (called on Space press).
   * Returns true if an item was collected.
   */
  tryPickupNear(player: HumanPlayer | CatPlayer): boolean {
    if (this.roomOriginX === ROOM_NOT_FOUND_POS) return false;
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
        x: p.worldX + TILE_SIZE * TILE_CENTER_OFFSET,
        y: p.worldY + TILE_SIZE * TILE_CENTER_OFFSET,
      }));
  }

  update(ctx: SystemContext): void {
    if (this.roomOriginX === ROOM_NOT_FOUND_POS) return;
    const { mobs } = ctx.roster;
    const juicer = mobs.find((m) => m instanceof Juicer) ?? null;
    this.juicer = juicer;
    this.updateShake(juicer);

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
      if (juicer?.requestDumbbellAt && pickup.itemId === 'gym_dumbbell') {
        const req = juicer.requestDumbbellAt;
        const wcx = pickup.worldX + ts * TILE_CENTER_OFFSET;
        const wcy = pickup.worldY + ts * TILE_CENTER_OFFSET;
        if (Math.hypot(req.x - wcx, req.y - wcy) < ts * PICKUP_JUICER_DETECT_RADIUS) {
          pickup.active = false;
          pickup.respawnTimer = RESPAWN.gym_dumbbell;
          juicer.onDumbbellPickedUp();
        }
      }
    }

    // Update Juicer's nearestDumbbell pointer
    if (juicer?.isAlive) {
      const positions = this.getActiveDumbbellPositions();
      if (positions.length > 0) {
        const jcx = juicer.x + ts * TILE_CENTER_OFFSET;
        const jcy = juicer.y + ts * TILE_CENTER_OFFSET;
        let nearest = positions[0];
        let nearestDist = Math.hypot(positions[0].x - jcx, positions[0].y - jcy);
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

  /**
   * Kicks the camera on the frame a wave appears and lets it fall away after.
   *
   * Armed off the marker becoming live rather than off a flag the boss sets,
   * so the shake cannot be re-armed every frame of the wave it belongs to.
   */
  private updateShake(juicer: Juicer | null): void {
    const wave = juicer?.punchShockwave ?? null;
    if (wave !== null && !this.shockwaveRunning) this.shakeFrames = SHAKE_FRAMES;
    this.shockwaveRunning = wave !== null;

    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      const falloff = this.shakeFrames / SHAKE_FRAMES;
      const amplitude = SHAKE_PEAK_PX * falloff * falloff;
      this.shakeX = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
      this.shakeY = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayer?: HumanPlayer | CatPlayer,
  ): void {
    if (this.roomOriginX === ROOM_NOT_FOUND_POS) return;

    const wave = this.juicer?.punchShockwave ?? null;
    if (wave !== null) {
      drawJuicerShockwave(ctx, {
        cx: wave.x - camX,
        cy: wave.y - camY,
        radius: wave.radiusPx,
        progress: wave.progress,
        seed: wave.seed,
      });
    }

    const ts = TILE_SIZE;
    const collectRadius = ts * PICKUP_COLLECT_RADIUS_RATIO;

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

      // Show interaction prompt when player is nearby
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
