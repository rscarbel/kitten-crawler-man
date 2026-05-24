/**
 * ArenaSystem — owns all Ball of Swine arena state: door locking,
 * phase transitions, Tuskling spawning, and arena UI rendering.
 *
 * Subscribes to EventBus events instead of being manually orchestrated.
 */

import { TILE_SIZE } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { Tuskling } from '../creatures/Tuskling';
import type { BossRoomSystem } from './BossRoomSystem';
import { createMob } from '../levels/spawner';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';

/** 30 seconds at 60 fps — mirrors BossRoomSystem.ENTRY_WINDOW_FRAMES. */
const ENTRY_WINDOW_FRAMES = 1800;
/** Number of Tusklings to spawn when Ball of Swine is defeated. */
const TUSKLING_SPAWN_COUNT = 8;
/** Spawn radius in tiles for Tusklings around the arena center. */
const TUSKLING_SPAWN_RADIUS_TILES = 3;
/** Frames Tusklings remain dazed after spawning (10 seconds at 60 fps). */
const TUSKLING_DAZE_FRAMES = 600;
/** Display-bar width cap in pixels. */
const HEALTH_BAR_MAX_W = 360;
/** Display-bar height in pixels. */
const HEALTH_BAR_H = 18;
/** Vertical position of health bar from top of canvas. */
const HEALTH_BAR_Y = 48;
/** Padding around the health bar container box. */
const HEALTH_BAR_PADDING = 6;
/** Extra vertical space at the bottom of the container. */
const HEALTH_BAR_BOTTOM_EXTRA = 30;
/** Tile distance beyond arena radius at which the health bar is hidden. */
const HEALTH_BAR_HIDE_DISTANCE_EXTRA_TILES = 5;
/** Frames per second used for countdown display. */
const DISPLAY_FPS = 60;
/** Pixel inset for boss name label from bar top. */
const LABEL_Y_INSET = 6;
/** Pixel inset for HP text from bar bottom. */
const HP_TEXT_INSET = 4;
/** Y offset for Tuskling counter text below bar area. */
const TUSKLINGS_LABEL_Y_OFFSET = 6;
/** Phase-2 Tusklings label y relative to the bar y anchor. */
const PHASE2_LABEL_Y = 78;
/** Text y anchor adjustment for label rendering. */
const LABEL_TEXT_ADJUST = 9;
/** HP text adjust. */
const HP_TEXT_ADJUST = 7;

export class ArenaSystem implements GameSystem {
  private arenaLocked = false;
  private arenaPhase2Active = false;
  private arenaStairwellUnlocked = false;
  private arenaLiveTusklings: Tuskling[] = [];

  /** Frames remaining in the 30-second window after the fight starts. */
  private entryWindowTimer = 0;
  /**
   * Which players are "insiders" (entered before or during the entry window).
   * Insiders are pushed back if they reach the door during the window.
   */
  private humanIsInsider = false;
  private catIsInsider = false;

  constructor(
    private readonly gameMap: GameMap,
    private readonly bus: EventBus,
    private readonly getMobs: () => Mob[],
    private readonly addMob: (mob: Mob) => void,
    private readonly bossRoom: BossRoomSystem,
  ) {
    this.wireEvents();
  }

  /** Whether the arena has any exteriors on this level. */
  get hasArena(): boolean {
    return this.gameMap.arenaExteriors.length > 0;
  }

  get phase2Active(): boolean {
    return this.arenaPhase2Active;
  }

  get stairwellUnlocked(): boolean {
    return this.arenaStairwellUnlocked;
  }

  private wireEvents(): void {
    // Ball of Swine defeated → spawn 8 dazed Tusklings (phase 2)
    this.bus.on('bossDefeated', (e) => {
      if (e.bossType !== 'ball_of_swine' || this.arenaPhase2Active) return;

      this.arenaPhase2Active = true;
      this.arenaLiveTusklings = [];

      const arena = this.gameMap.arenaExteriors[0];
      const acx = arena.centre.x;
      const acy = arena.centre.y;

      for (let i = 0; i < TUSKLING_SPAWN_COUNT; i++) {
        const angle = (i / TUSKLING_SPAWN_COUNT) * Math.PI * 2;
        const r = TUSKLING_SPAWN_RADIUS_TILES;
        const tx = acx + Math.round(Math.cos(angle) * r);
        const ty = acy + Math.round(Math.sin(angle) * r);
        const mob = createMob('tuskling', tx, ty, this.gameMap);
        if (mob instanceof Tuskling) {
          mob.dazeTimer = TUSKLING_DAZE_FRAMES;
          this.addMob(mob);
          this.arenaLiveTusklings.push(mob);
        }
      }
    });
  }

  update(ctx: SystemContext): void {
    const { human, cat } = ctx;
    if (!this.hasArena) return;

    const arena = this.gameMap.arenaExteriors[0];
    const mobs = this.getMobs();
    const bos = mobs.find((m) => m instanceof BallOfSwine);

    if (bos) {
      const cx = arena.centre.x * TILE_SIZE;
      const cy = arena.centre.y * TILE_SIZE;
      const innerRadius = (arena.radius - 2) * TILE_SIZE;
      const humanInside = Math.hypot(human.x - cx, human.y - cy) < innerRadius;
      const catInside = Math.hypot(cat.x - cx, cat.y - cy) < innerRadius;

      // Use hp > 0 (not isAlive) because BallOfSwine overrides isAlive to return
      // true during its burst animation even after hp hits 0, which would
      // re-trigger the fight-start logic after the Tuskling phase unlocks it.
      if (
        !this.arenaLocked &&
        this.entryWindowTimer === 0 &&
        bos.hp > 0 &&
        !this.arenaStairwellUnlocked &&
        (humanInside || catInside)
      ) {
        this.entryWindowTimer = ENTRY_WINDOW_FRAMES;
        this.humanIsInsider = humanInside;
        this.catIsInsider = catInside;
        this.bossRoom.newlyLockedBossType = 'ball_of_swine';
      }

      // Tick the entry window: keep the door open so the second player can enter,
      // but clamp insiders so they cannot leave through the door.
      if (this.entryWindowTimer > 0 && !this.arenaLocked) {
        this.entryWindowTimer--;

        // Any player who enters during the window becomes a locked-in insider.
        if (humanInside) this.humanIsInsider = true;
        if (catInside) this.catIsInsider = true;

        // Prevent insiders from slipping back out through the door gap.
        if (this.humanIsInsider) this.pushInsiderBackFromDoor(human, arena.doorTile);
        if (this.catIsInsider) this.pushInsiderBackFromDoor(cat, arena.doorTile);

        if (this.entryWindowTimer === 0) {
          this.arenaLocked = true;
          this.gameMap.lockArenaDoor();
        }
      }

      // BoS defeated (hp check, not isAlive — see comment above).
      if (
        bos.hp === 0 &&
        (this.arenaLocked || this.entryWindowTimer > 0) &&
        !this.arenaPhase2Active
      ) {
        this.entryWindowTimer = 0;
        this.humanIsInsider = false;
        this.catIsInsider = false;
        if (this.arenaLocked) {
          this.arenaLocked = false;
          this.gameMap.unlockArenaDoor();
        }
      }
    }

    // Phase 2: unlock stairwell when all spawned Tusklings are dead
    if (
      this.arenaPhase2Active &&
      !this.arenaStairwellUnlocked &&
      this.arenaLiveTusklings.length > 0 &&
      this.arenaLiveTusklings.every((t) => !t.isAlive)
    ) {
      this.arenaStairwellUnlocked = true;
      this.gameMap.unlockArenaStairwell();
      if (this.arenaLocked) {
        this.arenaLocked = false;
        this.gameMap.unlockArenaDoor();
      }
    }
  }

  /**
   * Prevents a locked-in player from leaving through the door gap while the
   * entry window is still open. Snaps them two tiles north of the door, which
   * is safely inside the arena.
   */
  private pushInsiderBackFromDoor(
    player: { x: number; y: number },
    doorTile: { x: number; y: number },
  ): void {
    const tileCenter = 0.5;
    const tx = Math.floor((player.x + TILE_SIZE * tileCenter) / TILE_SIZE);
    const ty = Math.floor((player.y + TILE_SIZE * tileCenter) / TILE_SIZE);
    // Door tiles span x: [doorTile.x-1, doorTile.x], y: [doorTile.y-1, doorTile.y+1]
    // (matches the set built in GameMap.loadFromData)
    const onDoor =
      tx >= doorTile.x - 1 && tx <= doorTile.x && ty >= doorTile.y - 1 && ty <= doorTile.y + 1;
    if (!onDoor) return;
    player.y = (doorTile.y - 2) * TILE_SIZE;
  }

  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    activePlayer: { x: number; y: number },
  ): void {
    if (!this.hasArena) return;

    const mobs = this.getMobs();
    const bos = mobs.find((m) => m instanceof BallOfSwine);

    if (bos?.isAlive) {
      const arena = this.gameMap.arenaExteriors[0];
      const distToArena = Math.hypot(
        activePlayer.x - arena.centre.x * TILE_SIZE,
        activePlayer.y - arena.centre.y * TILE_SIZE,
      );
      if (distToArena > (arena.radius + HEALTH_BAR_HIDE_DISTANCE_EXTRA_TILES) * TILE_SIZE) return;

      const meta = { displayName: 'BALL OF SWINE', color: '#f87171' };
      const BAR_WIDTH_FRACTION = 0.5;
      const barW = Math.min(HEALTH_BAR_MAX_W, canvas.width * BAR_WIDTH_FRACTION);
      const barH = HEALTH_BAR_H;
      const barX = Math.floor((canvas.width - barW) / 2);
      const barY = HEALTH_BAR_Y;
      const hpFrac = Math.max(0, bos.hp / bos.maxHp);

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(
        barX - HEALTH_BAR_PADDING,
        barY - HEALTH_BAR_BOTTOM_EXTRA - HEALTH_BAR_PADDING + HEALTH_BAR_PADDING,
        barW + HEALTH_BAR_PADDING * 2,
        barH + HEALTH_BAR_BOTTOM_EXTRA,
      );
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        barX - HEALTH_BAR_PADDING,
        barY - HEALTH_BAR_BOTTOM_EXTRA - HEALTH_BAR_PADDING + HEALTH_BAR_PADDING,
        barW + HEALTH_BAR_PADDING * 2,
        barH + HEALTH_BAR_BOTTOM_EXTRA,
      );

      drawText(ctx, bos.isStopped ? `★ ${meta.displayName} [STUNNED] ★` : meta.displayName, {
        x: canvas.width / 2,
        y: barY - LABEL_Y_INSET - LABEL_TEXT_ADJUST,
        size: 11,
        bold: true,
        color: bos.isStopped ? '#fde68a' : meta.color,
        align: 'center',
      });

      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = bos.isStopped ? '#fde68a' : meta.color;
      ctx.fillRect(barX, barY, barW * hpFrac, barH);

      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      drawText(ctx, `${bos.hp} / ${bos.maxHp}`, {
        x: canvas.width / 2,
        y: barY + barH - HP_TEXT_INSET - HP_TEXT_ADJUST,
        size: 9,
        color: '#e2e8f0',
        align: 'center',
      });

      if (this.entryWindowTimer > 0) {
        const seconds = Math.ceil(this.entryWindowTimer / DISPLAY_FPS);
        drawText(ctx, `Entry closes in ${seconds}s`, {
          x: canvas.width / 2,
          y: barY + barH + TUSKLINGS_LABEL_Y_OFFSET,
          size: 11,
          bold: true,
          color: '#fbbf24',
          align: 'center',
        });
      }

      ctx.restore();
    }

    // Phase 2: show how many Tusklings remain
    if (this.arenaPhase2Active && !this.arenaStairwellUnlocked) {
      const alive = this.arenaLiveTusklings.filter((t) => t.isAlive).length;
      drawText(
        ctx,
        alive > 0 ? `Tusklings remaining: ${alive}` : 'All Tusklings defeated! Stairwell unlocked.',
        {
          x: canvas.width / 2,
          y: PHASE2_LABEL_Y - LABEL_TEXT_ADJUST,
          size: 11,
          bold: true,
          color: alive > 0 ? '#f87171' : '#4ade80',
          align: 'center',
        },
      );
    }
  }
}
