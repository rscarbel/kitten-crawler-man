import type { ItemId } from '../core/items/defs/ItemDefs';
import { TILE_SIZE } from '../core/constants';
import type { CanvasSurface } from '../core/rendering/canvasSurface';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { LootDrop } from '../creatures/Mob';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { getSpriteDefByKey } from '../core/spriteAssets/SpriteLoader';
import { cloneLootDrop } from '../core/items/loot/lootDrop';
import { bouncingArrowAboveEntityTop, drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import { countsTowardRoomClear } from '../creatures/roomClear';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import { pointInRect } from '../utils';

/** Half a tile, in pixels — how far a mob's top-left position sits from its centre. */
const HALF_TILE_PX = TILE_SIZE / 2;

export type ChestType = 'wooden' | 'silver';

/** What keeps a wooden chest locked until it is beaten. */
export type ChestGuard =
  /** Any live mob that counts toward a room clear and stands inside `bounds`, in tiles. */
  | { readonly kind: 'room'; readonly bounds: { x: number; y: number; w: number; h: number } }
  /**
   * These mobs, wherever they stand, for as long as each is alive and still in
   * the room's roster. Empty until the band is posted: a band that chases the
   * party out of the room still holds the chest, where a room guard would let
   * it go the moment the last of them stepped over the threshold.
   */
  | { readonly kind: 'band'; readonly mobs: ReadonlyArray<Mob> };

/** A wooden chest's lock: it comes off once `guard` has held a live mob and holds none. */
interface GuardLock {
  readonly kind: 'guards';
  guard: ChestGuard;
  /**
   * Whether the guard has held a live mob yet. Until it has, an empty room is
   * guards not yet arrived rather than guards beaten.
   */
  hadMobs: boolean;
}

/** A boss room's silver chest: it unlocks when that room's boss loot lands in it. */
interface BossLock {
  readonly kind: 'boss';
  readonly bossRoomIndex: number;
}

/** A chest nothing locks: one a previous visit already emptied. */
interface NoLock {
  readonly kind: 'none';
}

/** How a chest comes unlocked. */
type ChestLock = GuardLock | BossLock | NoLock;

interface ChestBase {
  readonly tileX: number;
  readonly tileY: number;
  state: 'locked' | 'unlocking' | 'unlocked' | 'opened';
  loot: LootDrop | null;
  unlockFrame: number;
  sparkleFrame: number;
  tryLockedTimer: number;
}

/**
 * A chest on the map. Its art and its lock go together: a guard lock only on a
 * wooden chest, a boss lock only on a silver one, and either kind standing open
 * with no lock at all.
 */
export type TreasureChest = ChestBase &
  (
    | { readonly type: 'wooden'; readonly lock: GuardLock }
    | { readonly type: 'silver'; readonly lock: BossLock }
    | { readonly type: ChestType; readonly lock: NoLock }
  );

/** A wooden chest held by guards, the only kind a band can be posted to. */
export type GuardedChest = Extract<TreasureChest, { readonly lock: GuardLock }>;

/**
 * When a room-guarded chest may unlock: `after_guards_seen` waits for mobs to
 * stand in the room and then all die, so a room whose guards have not come
 * out yet is not taken for a cleared one; `when_room_clear` unlocks it the
 * first frame the room holds none.
 */
export type RoomChestRelease = 'after_guards_seen' | 'when_room_clear';

/** The part of a chest's lock that changes in play; only a guard lock has any. */
export type ChestLockProgress =
  Readonly<Pick<GuardLock, 'kind' | 'hadMobs'>> | Pick<BossLock, 'kind'> | NoLock;

/** What of `lock` a checkpoint keeps. */
export function lockProgressOf(lock: ChestLock): ChestLockProgress {
  switch (lock.kind) {
    case 'guards':
      return { kind: 'guards', hadMobs: lock.hadMobs };
    case 'boss':
      return { kind: 'boss' };
    case 'none':
      return { kind: 'none' };
    default: {
      const unhandled: never = lock;
      return unhandled;
    }
  }
}

/**
 * One chest's progress at capture time. `chest` is a bare reference rather than
 * a copy: `ChestRewardDialog` and the render pass both hold live chest objects,
 * so a restore has to write back into the same instances, not swap in new ones.
 */
export interface TreasureChestProgressSnapshot {
  chest: TreasureChest;
  state: TreasureChest['state'];
  loot: LootDrop | null;
  unlockFrame: number;
  tryLockedTimer: number;
  lock: ChestLockProgress;
}

export interface TreasureChestCheckpoint {
  chests: TreasureChestProgressSnapshot[];
}

/** Gold, the colour of the reward it is pointing the party at. */
const LOOT_ARROW_COLOR = '#facc15';

/**
 * Whether the party may open this chest now.
 *
 * A boss chest opens the moment its loot lands, mid-animation: the party is
 * sealed in the room until they loot it, and making them wait out the lock
 * falling off reads as the game ignoring the key press. A wooden chest keeps
 * its animation as the beat that says the guards are all dead.
 */
export function isChestOpenable(chest: TreasureChest): boolean {
  if (chest.state === 'unlocked') return true;
  return chest.state === 'unlocking' && chest.lock.kind === 'boss';
}

/** Whether `chest` is the silver chest of boss room `bossRoomIndex`. */
function isBossChestOf(chest: TreasureChest, bossRoomIndex: number): boolean {
  return chest.lock.kind === 'boss' && chest.lock.bossRoomIndex === bossRoomIndex;
}

/** How far `player` stands from `chest`, the measure every reach check uses. */
function chestDistance(player: HumanPlayer | CatPlayer, chest: TreasureChest): number {
  return Math.hypot(player.x - chest.tileX * TILE_SIZE, player.y - chest.tileY * TILE_SIZE);
}

/** The mobs of `guard` still holding their chest, out of the room's live `mobs`. */
function guardsHolding(guard: ChestGuard, mobs: readonly Mob[]): Mob[] {
  switch (guard.kind) {
    case 'room': {
      const { bounds } = guard;
      const roomMinX = bounds.x * TILE_SIZE;
      const roomMinY = bounds.y * TILE_SIZE;
      const roomMaxX = (bounds.x + bounds.w) * TILE_SIZE;
      const roomMaxY = (bounds.y + bounds.h) * TILE_SIZE;
      return mobs.filter((mob) => {
        if (!countsTowardRoomClear(mob)) return false;
        const centreX = mob.x + HALF_TILE_PX;
        const centreY = mob.y + HALF_TILE_PX;
        return (
          centreX >= roomMinX && centreX < roomMaxX && centreY >= roomMinY && centreY < roomMaxY
        );
      });
    }
    case 'band':
      return guard.mobs.filter(
        (mob) => mob.isAlive && countsTowardRoomClear(mob) && mobs.includes(mob),
      );
    default: {
      const unhandled: never = guard;
      return unhandled;
    }
  }
}

/** A boss chest holding the loot of a defeated boss that nobody has opened yet. */
function isAwaitingBossLoot(chest: TreasureChest): boolean {
  return chest.lock.kind === 'boss' && isChestOpenable(chest);
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
/** How near a chest, top-left to top-left in world pixels, its "Open Chest" prompt shows. */
export const CHEST_INTERACTION_RANGE = TILE_SIZE * INTERACTION_RANGE_TILE_MULTIPLIER;
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

/**
 * The chest sheet, routed through `SpriteLoader` like every other sprite
 * instead of a standalone `new Image()` — a standalone `Image()` load would
 * race the lazy sprite-group loader and could stray-load the sheet outside
 * its group. Undefined until `core` (or a later group) has loaded it;
 * callers must skip drawing rather than pass this to `drawImage`.
 */
export function getChestImage(): HTMLImageElement | CanvasSurface | undefined {
  return getSpriteDefByKey('treasure_chests')?.img;
}

/**
 * Ratio of the chest sheet's actually-loaded frame width to the 80px
 * full-resolution width every source-rect constant below is authored
 * against. 1 normally; less than 1 when the low-end-device downscale has
 * halved the sheet into a smaller canvas — every constant here is a SOURCE
 * (not destination) rect value, so without this scale they'd read from the
 * wrong region of a downscaled sheet. `frameWidth` (not `img.width`) is the
 * authority: it's the field `SpriteLoader` halves in lockstep with the
 * actual pixels.
 */
export function getChestSourceScale(): number {
  return (
    (getSpriteDefByKey('treasure_chests')?.frameWidth ?? CHEST_SPRITE_SIZE) / CHEST_SPRITE_SIZE
  );
}

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
      lock: { kind: 'boss', bossRoomIndex },
    });
  }

  /** A wooden chest held by whatever counts toward a room clear inside `guardBounds`, in tiles. */
  addWoodenChest(
    tileX: number,
    tileY: number,
    guardBounds: { x: number; y: number; w: number; h: number },
    loot: LootDrop,
    release: RoomChestRelease,
  ): GuardedChest {
    const chest: GuardedChest = {
      tileX,
      tileY,
      type: 'wooden',
      state: 'locked',
      loot,
      unlockFrame: 0,
      sparkleFrame: 0,
      tryLockedTimer: 0,
      lock: {
        kind: 'guards',
        guard: { kind: 'room', bounds: guardBounds },
        hadMobs: release === 'when_room_clear',
      },
    };
    this.chests.push(chest);
    return chest;
  }

  /**
   * A wooden chest held by a band of mobs that has not come out yet: locked,
   * and unlocked once every mob later posted to its `band` guard is dead.
   */
  addBandChest(tileX: number, tileY: number, loot: LootDrop): GuardedChest {
    const chest: GuardedChest = {
      tileX,
      tileY,
      type: 'wooden',
      state: 'locked',
      loot,
      unlockFrame: 0,
      sparkleFrame: 0,
      tryLockedTimer: 0,
      lock: { kind: 'guards', guard: { kind: 'band', mobs: [] }, hadMobs: false },
    };
    this.chests.push(chest);
    return chest;
  }

  /** A chest emptied on an earlier visit: drawn with its lid up and never offered again. */
  addOpenedChest(tileX: number, tileY: number, type: ChestType): TreasureChest {
    const chest: TreasureChest = {
      tileX,
      tileY,
      type,
      state: 'opened',
      loot: null,
      unlockFrame: 0,
      sparkleFrame: 0,
      tryLockedTimer: 0,
      lock: { kind: 'none' },
    };
    this.chests.push(chest);
    return chest;
  }

  /** Whether this boss room still has a chest waiting to be handed its loot. */
  hasLockedBossChest(bossRoomIndex: number): boolean {
    return this.chests.some((c) => isBossChestOf(c, bossRoomIndex) && c.state === 'locked');
  }

  /** Whether this boss room still has a chest nobody has opened, whatever its lock state. */
  hasUnopenedBossChest(bossRoomIndex: number): boolean {
    return this.chests.some((c) => isBossChestOf(c, bossRoomIndex) && c.state !== 'opened');
  }

  /**
   * Whether an unopened chest holds `id` — boss loot parked in a chest still
   * locked or unlocking — so a roll elsewhere does not hand over a second copy.
   */
  holds(id: ItemId): boolean {
    return this.chests.some(
      (chest) =>
        chest.state !== 'opened' && chest.loot?.items.some((item) => item.id === id) === true,
    );
  }

  /**
   * Hands a boss room's silver chest its loot and starts the unlock.
   *
   * @returns whether a locked chest was found. Missing one used to return in
   *   silence, and the failure it hides — a defeated boss, an open door and a
   *   chest that stays shut forever — cost a whole playtest before anyone could
   *   name it. Callers that treat a miss as normal (the defeat-transition
   *   safety net, which runs after the kill has usually already unlocked it)
   *   must ask {@link hasLockedBossChest} first rather than provoke the warning.
   */
  receiveBossLoot(bossRoomIndex: number, loot: LootDrop): boolean {
    const chest = this.chests.find((c) => isBossChestOf(c, bossRoomIndex) && c.state === 'locked');
    if (chest === undefined) {
      console.warn(
        `[TreasureChestSystem] Boss loot for room ${bossRoomIndex} had no locked chest to go into.`,
      );
      return false;
    }
    chest.loot = loot;
    const idx = this.chests.indexOf(chest);
    this.triggerUnlock(idx);
    return true;
  }

  triggerUnlock(chestIndex: number): void {
    if (chestIndex < 0 || chestIndex >= this.chests.length) return;
    const chest = this.chests[chestIndex];
    chest.state = 'unlocking';
    chest.unlockFrame = 0;
  }

  /** The closest unopened chest within reach of `player`, or null. */
  private nearestClosedChest(player: HumanPlayer | CatPlayer): TreasureChest | null {
    let closestChest: TreasureChest | null = null;
    let closestDist = CHEST_INTERACTION_RANGE;
    for (const chest of this.chests) {
      if (chest.state === 'opened') continue;
      const dist = chestDistance(player, chest);
      if (dist < closestDist) {
        closestDist = dist;
        closestChest = chest;
      }
    }
    return closestChest;
  }

  /**
   * Whether {@link tryInteract} would claim a press from `player` right now,
   * without doing anything — for a prompt further down the Space chain to
   * know it would not be reached.
   */
  wouldInteract(player: HumanPlayer | CatPlayer): boolean {
    return this.nearestClosedChest(player) !== null;
  }

  tryInteract(player: HumanPlayer | CatPlayer): boolean {
    const closestChest = this.nearestClosedChest(player);
    if (closestChest === null) return false;

    if (!isChestOpenable(closestChest)) {
      closestChest.tryLockedTimer = TRY_LOCKED_TIMER_FRAMES;
      this.onLockedAttempt?.();
      return true;
    }

    this.open(closestChest);
    return true;
  }

  private open(chest: TreasureChest): void {
    chest.state = 'opened';
    this.onChestOpened?.(chest);
  }

  /**
   * An openable chest under a click or tap at screen point `(x, y)`, opened by
   * `player` when it is within her reach. Returns whether one took the press.
   * The tapped chest is the one opened, never merely the nearest: with two in
   * reach, tapping the far one must not open the near one.
   */
  tryInteractAt(
    x: number,
    y: number,
    camX: number,
    camY: number,
    player: HumanPlayer | CatPlayer,
  ): boolean {
    for (const chest of this.chests) {
      if (!isChestOpenable(chest)) continue;
      const chestRect = {
        x: chest.tileX * TILE_SIZE - camX,
        y: chest.tileY * TILE_SIZE - camY,
        w: TILE_SIZE,
        h: TILE_SIZE,
      };
      if (!pointInRect(x, y, chestRect)) continue;
      if (chestDistance(player, chest) >= CHEST_INTERACTION_RANGE) continue;
      this.open(chest);
      return true;
    }
    return false;
  }

  update(mobs: readonly Mob[]): void {
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

      if (chest.state === 'locked' && chest.lock.kind === 'guards') {
        const lock = chest.lock;
        const liveMobsInRoom = guardsHolding(lock.guard, mobs);

        if (liveMobsInRoom.length > 0) {
          lock.hadMobs = true;
        }

        if (lock.hadMobs && liveMobsInRoom.length === 0) {
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
    const chestImage = getChestImage();
    if (chestImage === undefined) return; // Not loaded yet — skip this frame, same as any other miss.

    const s = getChestSourceScale();
    const srcSize = CHEST_SPRITE_SIZE * s;
    const dx = chest.tileX * TILE_SIZE - camX;
    const dy = chest.tileY * TILE_SIZE - camY;

    if (chest.state === 'opened') {
      const openedSrcX = chest.type === 'wooden' ? WOODEN_CHEST_OPEN_X : SILVER_CHEST_OPEN_X;
      ctx.drawImage(chestImage, openedSrcX * s, 0, srcSize, srcSize, dx, dy, TILE_SIZE, TILE_SIZE);
      return;
    }

    const closedSrcX = chest.type === 'wooden' ? WOODEN_CHEST_CLOSED_X : SILVER_CHEST_CLOSED_X;
    ctx.drawImage(chestImage, closedSrcX * s, 0, srcSize, srcSize, dx, dy, TILE_SIZE, TILE_SIZE);

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
          sparkleSrcX * s,
          srcSize,
          srcSize,
          srcSize,
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
        SILVER_CHEST_CLOSED_X * s,
        SILVER_CHEST_CLOSED_X * s,
        srcSize,
        srcSize,
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
        lockSrcX * s,
        SILVER_CHEST_CLOSED_X * s,
        srcSize,
        srcSize,
        lockX,
        lockY,
        lockSize,
        lockSize,
      );
      ctx.restore();
    }

    if (isChestOpenable(chest)) {
      const playerDist = Math.hypot(
        active.x - chest.tileX * TILE_SIZE,
        active.y - chest.tileY * TILE_SIZE,
      );
      if (playerDist < CHEST_INTERACTION_RANGE) {
        // A boss chest's loot arrow bobs over it until it is opened, so the prompt stacks above that.
        const chestTop = isAwaitingBossLoot(chest)
          ? bouncingArrowAboveEntityTop(chest.tileY * TILE_SIZE, camY)
          : dy;
        drawInteractionPrompt(ctx, dx, chestTop, TILE_SIZE, dy + TILE_SIZE, 'Open Chest');
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    for (const chest of this.chests) {
      this.renderSingle(ctx, camX, camY, active, chest);
    }
  }

  /**
   * Points at every boss chest the party has earned but not opened. Drawn over
   * the Y-sorted entity pass rather than inside it, so a boss's corpse or the
   * party standing south of the chest can never cover the arrow.
   */
  renderLootArrows(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const chest of this.chests) {
      if (!isAwaitingBossLoot(chest)) continue;
      drawBouncingArrowAboveEntity(
        ctx,
        chest.tileX * TILE_SIZE,
        chest.tileY * TILE_SIZE,
        camX,
        camY,
        LOOT_ARROW_COLOR,
      );
    }
  }

  captureCheckpoint(): TreasureChestCheckpoint {
    return {
      chests: this.chests.map((chest) => ({
        chest,
        state: chest.state,
        loot: chest.loot === null ? null : cloneLootDrop(chest.loot),
        unlockFrame: chest.unlockFrame,
        tryLockedTimer: chest.tryLockedTimer,
        lock: lockProgressOf(chest.lock),
      })),
    };
  }

  restoreCheckpoint(snapshot: TreasureChestCheckpoint): void {
    // A chest added after the capture (a boss room reached and then rewound)
    // must go away entirely, so the list is rebuilt from the snapshot rather
    // than walked in parallel with the live one.
    this.chests.length = 0;
    for (const entry of snapshot.chests) {
      const chest = entry.chest;
      chest.state = entry.state;
      chest.loot = entry.loot === null ? null : cloneLootDrop(entry.loot);
      chest.unlockFrame = entry.unlockFrame;
      chest.tryLockedTimer = entry.tryLockedTimer;
      if (chest.lock.kind === 'guards' && entry.lock.kind === 'guards') {
        chest.lock.hadMobs = entry.lock.hadMobs;
      } else if (chest.lock.kind !== entry.lock.kind) {
        console.warn(
          `[TreasureChestSystem] Checkpoint for the chest at ${chest.tileX},${chest.tileY} holds a ${entry.lock.kind} lock; the chest has a ${chest.lock.kind} lock.`,
        );
      }
      this.chests.push(chest);
    }
  }

  /**
   * Every chest as a figure for a scene's own Y-sorted pass, sorted by its
   * tile the way `RenderPipeline` sorts it, so a crawler south of a chest is
   * drawn in front of it and one north of it behind.
   */
  sortedFigures(active: Player): InteriorFigure[] {
    return this.chests.map((chest) => ({
      y: chest.tileY * TILE_SIZE,
      render: (ctx, camX, camY) => this.renderSingle(ctx, camX, camY, active, chest),
    }));
  }

  get allChests(): ReadonlyArray<TreasureChest> {
    return this.chests;
  }
}
