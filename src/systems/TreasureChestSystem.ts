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

// Sparkle schedule: [startFrame, endFrame, col] pairs
const SPARKLE_SCHEDULE: ReadonlyArray<readonly [number, number, number]> = [
  [120, 127, 0],
  [128, 135, 1],
  [256, 263, 2],
  [264, 271, 3],
  [392, 399, 4],
  [400, 407, 5],
] as const;
const SPARKLE_CYCLE = 408;

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
    const rangeThreshold = TILE_SIZE * 2.5;

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
      closestChest.tryLockedTimer = 60;
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
        // At frame 172+ transition to unlocked
        if (chest.unlockFrame >= 172) {
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

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    for (const chest of this.chests) {
      const dx = chest.tileX * TILE_SIZE - camX;
      const dy = chest.tileY * TILE_SIZE - camY;

      // Opened chests render the opened sprite and nothing else
      if (chest.state === 'opened') {
        const openedSrcX = chest.type === 'wooden' ? 80 : 240;
        ctx.drawImage(chestImage, openedSrcX, 0, 80, 80, dx, dy, TILE_SIZE, TILE_SIZE);
        continue;
      }

      // All other states show the closed chest sprite — the dialog handles the opening animation
      const closedSrcX = chest.type === 'wooden' ? 0 : 160;
      ctx.drawImage(chestImage, closedSrcX, 0, 80, 80, dx, dy, TILE_SIZE, TILE_SIZE);

      // Draw sparkle overlay when unlocked
      if (chest.state === 'unlocked') {
        const sf = chest.sparkleFrame;
        let sparkleSrcX = -1;
        for (const [start, end, col] of SPARKLE_SCHEDULE) {
          if (sf >= start && sf <= end) {
            sparkleSrcX = col * 80;
            break;
          }
        }
        if (sparkleSrcX >= 0) {
          const sparkleSize = 40;
          const sparkleOffX = dx + (TILE_SIZE - sparkleSize) / 2;
          const sparkleOffY = dy + (TILE_SIZE - sparkleSize) / 2;
          ctx.drawImage(
            chestImage,
            sparkleSrcX,
            80,
            80,
            80,
            sparkleOffX,
            sparkleOffY,
            sparkleSize,
            sparkleSize,
          );
        }
      }

      // Draw lock overlay — centered horizontally, floating above the chest
      const lockSize = 36;
      const lockX = dx + (TILE_SIZE - lockSize) / 2;
      const lockY = dy - lockSize - 6;

      if (chest.state === 'locked' && chest.tryLockedTimer > 0) {
        // Red lock idle
        ctx.drawImage(chestImage, 0, 160, 80, 80, lockX, lockY, lockSize, lockSize);
      } else if (chest.state === 'unlocking') {
        const uf = chest.unlockFrame;
        ctx.save();

        if (uf >= 142) {
          // Fading out — frames 142-171 → alpha 1 to 0
          const fadeProgress = (uf - 142) / 29;
          ctx.globalAlpha = Math.max(0, 1 - fadeProgress);
        }

        let lockSrcX: number;
        if (uf < 20) {
          lockSrcX = 0; // red idle
        } else if (uf < 28) {
          lockSrcX = 80; // red shake 1
        } else if (uf < 36) {
          lockSrcX = 160; // red shake 2
        } else if (uf < 44) {
          lockSrcX = 240; // yellow shake 1
        } else if (uf < 52) {
          lockSrcX = 320; // yellow shake 2
        } else {
          lockSrcX = 400; // green unlocked (frames 52-171)
        }

        ctx.drawImage(chestImage, lockSrcX, 160, 80, 80, lockX, lockY, lockSize, lockSize);
        ctx.restore();
      }

      // Draw interaction prompt for unlocked chests near the active player
      if (chest.state === 'unlocked') {
        const playerDist = Math.hypot(
          active.x - chest.tileX * TILE_SIZE,
          active.y - chest.tileY * TILE_SIZE,
        );
        if (playerDist < TILE_SIZE * 2.5) {
          drawInteractionPrompt(ctx, dx, dy, TILE_SIZE, 'Open Chest');
        }
      }
    }
  }

  get allChests(): ReadonlyArray<TreasureChest> {
    return this.chests;
  }
}
