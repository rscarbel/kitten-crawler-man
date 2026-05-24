import { TILE_SIZE } from '../core/constants';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { LootDrop } from '../creatures/Mob';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';

export type ChestType = 'wooden' | 'silver';

export interface TreasureChest {
  tileX: number;
  tileY: number;
  type: ChestType;
  state: 'locked' | 'unlocking' | 'unlocked' | 'opened';
  loot: LootDrop | null;
  unlockFrame: number;
  sparkleFrame: number;
  tryLockedTimer: number;
  guardBounds: { x: number; y: number; w: number; h: number } | null;
  bossRoomIndex: number | null;
  hadMobs: boolean;
}

// Sparkle animation constants
const SPARKLE_FRAME_START_1 = 120;
const SPARKLE_FRAME_END_1 = 127;
const SPARKLE_COL_1 = 0;
const SPARKLE_FRAME_START_2 = 128;
const SPARKLE_FRAME_END_2 = 135;
const SPARKLE_COL_2 = 1;
const SPARKLE_FRAME_START_3 = 256;
const SPARKLE_FRAME_END_3 = 263;
const SPARKLE_COL_3 = 2;
const SPARKLE_FRAME_START_4 = 264;
const SPARKLE_FRAME_END_4 = 271;
const SPARKLE_COL_4 = 3;
const SPARKLE_FRAME_START_5 = 392;
const SPARKLE_FRAME_END_5 = 399;
const SPARKLE_COL_5 = 4;
const SPARKLE_FRAME_START_6 = 400;
const SPARKLE_FRAME_END_6 = 407;
const SPARKLE_COL_6 = 5;

// Sparkle schedule: [startFrame, endFrame, col] pairs
const SPARKLE_SCHEDULE: ReadonlyArray<readonly [number, number, number]> = [
  [SPARKLE_FRAME_START_1, SPARKLE_FRAME_END_1, SPARKLE_COL_1],
  [SPARKLE_FRAME_START_2, SPARKLE_FRAME_END_2, SPARKLE_COL_2],
  [SPARKLE_FRAME_START_3, SPARKLE_FRAME_END_3, SPARKLE_COL_3],
  [SPARKLE_FRAME_START_4, SPARKLE_FRAME_END_4, SPARKLE_COL_4],
  [SPARKLE_FRAME_START_5, SPARKLE_FRAME_END_5, SPARKLE_COL_5],
  [SPARKLE_FRAME_START_6, SPARKLE_FRAME_END_6, SPARKLE_COL_6],
] as const;
const SPARKLE_CYCLE = 408;

// Chest interaction and rendering constants
const INTERACTION_RANGE_TILE_MULTIPLIER = 2.5;
const CHEST_INTERACTION_RANGE = TILE_SIZE * INTERACTION_RANGE_TILE_MULTIPLIER;
const TRY_LOCKED_TIMER_FRAMES = 60;
const UNLOCK_ANIMATION_COMPLETE_FRAME = 172;
const CHEST_SPRITE_SIZE = 80;
const WOODEN_CHEST_CLOSED_X = 0;
const WOODEN_CHEST_OPEN_X = 80;
const SILVER_CHEST_CLOSED_X = 160;
const SILVER_CHEST_OPEN_X = 240;
const SPARKLE_SIZE = 40;
const LOCK_SIZE = 36;
const LOCK_Y_OFFSET = 6;
const LOCK_FADE_START_FRAME = 142;
const LOCK_FADE_DURATION = 29;
const LOCK_FRAME_PHASE_1 = 20;
const LOCK_FRAME_PHASE_2 = 28;
const LOCK_FRAME_PHASE_3 = 36;
const LOCK_FRAME_PHASE_4 = 44;
const LOCK_FRAME_PHASE_5 = 52;
const LOCK_SRC_X_PHASE_0 = 0;
const LOCK_SRC_X_PHASE_1 = 80;
const LOCK_SRC_X_PHASE_2 = 160;
const LOCK_SRC_X_PHASE_3 = 240;
const LOCK_SRC_X_PHASE_4 = 320;
const LOCK_SRC_X_PHASE_5 = 400;

export const chestImage = new Image();
chestImage.src = 'src/images/environment/treasure_chests.png';

export class TreasureChestSystem {
  private readonly chests: TreasureChest[] = [];
  private onChestOpened: ((chest: TreasureChest) => void) | null = null;
  private onLockedAttempt: (() => void) | null = null;
  private onWoodenChestUnlocked: (() => void) | null = null;

  setOnOpen(cb: (chest: TreasureChest) => void): void {
    this.onChestOpened = cb;
  }

  setOnLockedAttempt(cb: () => void): void {
    this.onLockedAttempt = cb;
  }

  setOnWoodenChestUnlocked(cb: () => void): void {
    this.onWoodenChestUnlocked = cb;
  }

  addBossChest(tileX: number, tileY: number, bossRoomIndex: number): void {
    this.chests.push({
      tileX,
      tileY,
      type: 'silver',
      state: 'locked',
      loot: null,
      unlockFrame: 0,
      sparkleFrame: 0,
      tryLockedTimer: 0,
      guardBounds: null,
      bossRoomIndex,
      hadMobs: false,
    });
  }

  addWoodenChest(
    tileX: number,
    tileY: number,
    guardBounds: { x: number; y: number; w: number; h: number },
    loot: LootDrop,
    hasGuards = true,
  ): void {
    this.chests.push({
      tileX,
      tileY,
      type: 'wooden',
      state: 'locked',
      loot,
      unlockFrame: 0,
      sparkleFrame: 0,
      tryLockedTimer: 0,
      guardBounds,
      bossRoomIndex: null,
      hadMobs: !hasGuards,
    });
  }

  receiveBossLoot(bossRoomIndex: number, loot: LootDrop): void {
    const chest = this.chests.find(
      (c) => c.bossRoomIndex === bossRoomIndex && c.state === 'locked',
    );
    if (chest === undefined) return;
    chest.loot = loot;
    const idx = this.chests.indexOf(chest);
    this.triggerUnlock(idx);
  }

  triggerUnlock(chestIndex: number): void {
    if (chestIndex < 0 || chestIndex >= this.chests.length) return;
    const chest = this.chests[chestIndex];
    chest.state = 'unlocking';
    chest.unlockFrame = 0;
  }

  tryInteract(player: HumanPlayer | CatPlayer): boolean {
    const px = player.x;
    const py = player.y;
    const rangeThreshold = CHEST_INTERACTION_RANGE;

    let closestChest: TreasureChest | null = null;
    let closestDist = rangeThreshold;

    for (const chest of this.chests) {
      if (chest.state === 'opened') continue;
      const dist = Math.hypot(px - chest.tileX * TILE_SIZE, py - chest.tileY * TILE_SIZE);
      if (dist < closestDist) {
        closestDist = dist;
        closestChest = chest;
      }
    }

    if (closestChest === null) return false;

    if (closestChest.state === 'locked' || closestChest.state === 'unlocking') {
      closestChest.tryLockedTimer = TRY_LOCKED_TIMER_FRAMES;
      this.onLockedAttempt?.();
      return true;
    }

    if (closestChest.state === 'unlocked') {
      closestChest.state = 'opened';
      if (this.onChestOpened !== null) {
        this.onChestOpened(closestChest);
      }
      return true;
    }

    return false;
  }

  update(mobs: Mob[]): void {
    for (const chest of this.chests) {
      // Tick tryLockedTimer
      if (chest.tryLockedTimer > 0) {
        chest.tryLockedTimer--;
      }

      // Advance unlock animation
      if (chest.state === 'unlocking') {
        chest.unlockFrame++;
        // At frame UNLOCK_ANIMATION_COMPLETE_FRAME+ transition to unlocked
        if (chest.unlockFrame >= UNLOCK_ANIMATION_COMPLETE_FRAME) {
          chest.state = 'unlocked';
          chest.sparkleFrame = 0;
        }
      }

      // Advance sparkle frame
      if (chest.state === 'unlocked') {
        chest.sparkleFrame = (chest.sparkleFrame + 1) % SPARKLE_CYCLE;
      }

      // Check wooden chest room clearing
      if (chest.state === 'locked' && chest.type === 'wooden' && chest.guardBounds !== null) {
        const gb = chest.guardBounds;
        const roomMinX = gb.x * TILE_SIZE;
        const roomMinY = gb.y * TILE_SIZE;
        const roomMaxX = (gb.x + gb.w) * TILE_SIZE;
        const roomMaxY = (gb.y + gb.h) * TILE_SIZE;

        const liveMobsInRoom = mobs.filter(
          (m) =>
            !m.justDied &&
            m.hp > 0 &&
            m.x >= roomMinX &&
            m.x < roomMaxX &&
            m.y >= roomMinY &&
            m.y < roomMaxY,
        );

        if (liveMobsInRoom.length > 0) {
          chest.hadMobs = true;
        }

        if (chest.hadMobs && liveMobsInRoom.length === 0) {
          const idx = this.chests.indexOf(chest);
          this.triggerUnlock(idx);
          this.onWoodenChestUnlocked?.();
        }
      }
    }
  }

  /**
   * Renders a single chest. Called from the Y-sorted entity pass in RenderPipeline
   * so depth (north = behind, south = in front) is respected against players and mobs.
   */
  renderSingle(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player,
    chest: TreasureChest,
  ): void {
    const dx = chest.tileX * TILE_SIZE - camX;
    const dy = chest.tileY * TILE_SIZE - camY;

    if (chest.state === 'opened') {
      const openedSrcX = chest.type === 'wooden' ? WOODEN_CHEST_OPEN_X : SILVER_CHEST_OPEN_X;
      ctx.drawImage(
        chestImage,
        openedSrcX,
        0,
        CHEST_SPRITE_SIZE,
        CHEST_SPRITE_SIZE,
        dx,
        dy,
        TILE_SIZE,
        TILE_SIZE,
      );
      return;
    }

    const closedSrcX = chest.type === 'wooden' ? WOODEN_CHEST_CLOSED_X : SILVER_CHEST_CLOSED_X;
    ctx.drawImage(
      chestImage,
      closedSrcX,
      0,
      CHEST_SPRITE_SIZE,
      CHEST_SPRITE_SIZE,
      dx,
      dy,
      TILE_SIZE,
      TILE_SIZE,
    );

    if (chest.state === 'unlocked') {
      const sf = chest.sparkleFrame;
      let sparkleSrcX = -1;
      for (const [start, end, col] of SPARKLE_SCHEDULE) {
        if (sf >= start && sf <= end) {
          sparkleSrcX = col * CHEST_SPRITE_SIZE;
          break;
        }
      }
      if (sparkleSrcX >= 0) {
        const sparkleOffX = dx + (TILE_SIZE - SPARKLE_SIZE) / 2;
        const sparkleOffY = dy + (TILE_SIZE - SPARKLE_SIZE) / 2;
        ctx.drawImage(
          chestImage,
          sparkleSrcX,
          CHEST_SPRITE_SIZE,
          CHEST_SPRITE_SIZE,
          CHEST_SPRITE_SIZE,
          sparkleOffX,
          sparkleOffY,
          SPARKLE_SIZE,
          SPARKLE_SIZE,
        );
      }
    }

    const lockSize = LOCK_SIZE;
    const lockX = dx + (TILE_SIZE - lockSize) / 2;
    const lockY = dy - lockSize - LOCK_Y_OFFSET;

    if (chest.state === 'locked' && chest.tryLockedTimer > 0) {
      ctx.drawImage(
        chestImage,
        SILVER_CHEST_CLOSED_X,
        SILVER_CHEST_CLOSED_X,
        CHEST_SPRITE_SIZE,
        CHEST_SPRITE_SIZE,
        lockX,
        lockY,
        lockSize,
        lockSize,
      );
    } else if (chest.state === 'unlocking') {
      const uf = chest.unlockFrame;
      ctx.save();

      if (uf >= LOCK_FADE_START_FRAME) {
        const fadeProgress = (uf - LOCK_FADE_START_FRAME) / LOCK_FADE_DURATION;
        ctx.globalAlpha = Math.max(0, 1 - fadeProgress);
      }

      let lockSrcX: number;
      if (uf < LOCK_FRAME_PHASE_1) {
        lockSrcX = LOCK_SRC_X_PHASE_0;
      } else if (uf < LOCK_FRAME_PHASE_2) {
        lockSrcX = LOCK_SRC_X_PHASE_1;
      } else if (uf < LOCK_FRAME_PHASE_3) {
        lockSrcX = LOCK_SRC_X_PHASE_2;
      } else if (uf < LOCK_FRAME_PHASE_4) {
        lockSrcX = LOCK_SRC_X_PHASE_3;
      } else if (uf < LOCK_FRAME_PHASE_5) {
        lockSrcX = LOCK_SRC_X_PHASE_4;
      } else {
        lockSrcX = LOCK_SRC_X_PHASE_5;
      }

      ctx.drawImage(
        chestImage,
        lockSrcX,
        SILVER_CHEST_CLOSED_X,
        CHEST_SPRITE_SIZE,
        CHEST_SPRITE_SIZE,
        lockX,
        lockY,
        lockSize,
        lockSize,
      );
      ctx.restore();
    }

    if (chest.state === 'unlocked') {
      const playerDist = Math.hypot(
        active.x - chest.tileX * TILE_SIZE,
        active.y - chest.tileY * TILE_SIZE,
      );
      if (playerDist < CHEST_INTERACTION_RANGE) {
        drawInteractionPrompt(ctx, dx, dy, TILE_SIZE, 'Open Chest');
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    for (const chest of this.chests) {
      this.renderSingle(ctx, camX, camY, active, chest);
    }
  }

  get allChests(): ReadonlyArray<TreasureChest> {
    return this.chests;
  }
}
