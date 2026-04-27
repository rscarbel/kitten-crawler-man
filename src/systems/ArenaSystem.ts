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

export class ArenaSystem implements GameSystem {
  private arenaLocked = false;
  private arenaPhase2Active = false;
  private arenaStairwellUnlocked = false;
  private arenaLiveTusklings: Tuskling[] = [];

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

      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = 3;
        const tx = acx + Math.round(Math.cos(angle) * r);
        const ty = acy + Math.round(Math.sin(angle) * r);
        const mob = createMob('tuskling', tx, ty, this.gameMap);
        if (mob instanceof Tuskling) {
          mob.dazeTimer = 600;
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

      if (!this.arenaLocked && bos.isAlive && (humanInside || catInside)) {
        this.arenaLocked = true;
        this.gameMap.lockArenaDoor();
        this.bossRoom.newlyLockedBossType = 'ball_of_swine';
      }

      if (this.arenaLocked && !bos.isAlive && !this.arenaPhase2Active) {
        this.arenaLocked = false;
        this.gameMap.unlockArenaDoor();
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
      if (distToArena > (arena.radius + 5) * TILE_SIZE) return;

      const meta = { displayName: 'BALL OF SWINE', color: '#f87171' };
      const barW = Math.min(360, canvas.width * 0.5);
      const barH = 18;
      const barX = Math.floor((canvas.width - barW) / 2);
      const barY = 48;
      const hpFrac = Math.max(0, bos.hp / bos.maxHp);

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(barX - 6, barY - 22, barW + 12, barH + 30);
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - 6, barY - 22, barW + 12, barH + 30);

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = bos.isStopped ? '#fde68a' : meta.color;
      ctx.textAlign = 'center';
      ctx.fillText(
        bos.isStopped ? `★ ${meta.displayName} [STUNNED] ★` : meta.displayName,
        canvas.width / 2,
        barY - 6,
      );
      ctx.textAlign = 'left';

      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = bos.isStopped ? '#fde68a' : meta.color;
      ctx.fillRect(barX, barY, barW * hpFrac, barH);

      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      ctx.font = '9px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.fillText(`${bos.hp} / ${bos.maxHp}`, canvas.width / 2, barY + barH - 4);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // Phase 2: show how many Tusklings remain
    if (this.arenaPhase2Active && !this.arenaStairwellUnlocked) {
      const alive = this.arenaLiveTusklings.filter((t) => t.isAlive).length;
      ctx.save();
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = alive > 0 ? '#f87171' : '#4ade80';
      ctx.fillText(
        alive > 0 ? `Tusklings remaining: ${alive}` : 'All Tusklings defeated! Stairwell unlocked.',
        canvas.width / 2,
        78,
      );
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }
}
