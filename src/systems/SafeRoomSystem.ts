import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  drawMordecaiForLevel,
  drawSpeechBubble,
} from '../sprites/mordecaiSprite';

interface SafeRoomEntry {
  bounds: { x: number; y: number; w: number; h: number };
  mordecaiHomeTileX: number;
  mordecaiHomeTileY: number;
  bedTileX: number;
  bedTileY: number;
}

export class SafeRoomSystem {
  private readonly entries: SafeRoomEntry[];

  private _mordecaiDialogOpen = false;
  private _isSleeping = false;
  private sleepTimer = 0;
  private sleepHealed = false;

  private readonly SLEEP_TOTAL = 150;
  private readonly SLEEP_FADEIN = 30;
  private readonly SLEEP_HOLD = 90;

  // Mordecai wander animation (shared timer, different phase per entry)
  private wanderTime = 0;

  constructor(
    private readonly gameMap: GameMap,
    startTileX: number,
    startTileY: number,
    private readonly levelId = 'level1',
  ) {
    this.entries = [];

    if (gameMap.safeRooms.length > 0) {
      for (const sr of gameMap.safeRooms) {
        const halfW = Math.floor(sr.bounds.w / 4);
        this.entries.push({
          bounds: sr.bounds,
          mordecaiHomeTileX: sr.centre.x - halfW,
          mordecaiHomeTileY: sr.centre.y,
          bedTileX: sr.centre.x + halfW,
          bedTileY: sr.centre.y,
        });
      }
    } else {
      // Fallback: no map safe rooms
      this.entries.push({
        bounds: { x: startTileX, y: startTileY, w: 8, h: 7 },
        mordecaiHomeTileX: startTileX,
        mordecaiHomeTileY: startTileY,
        bedTileX: startTileX + 1,
        bedTileY: startTileY,
      });
    }
  }

  // Backward-compat accessors (first entry)

  get bounds(): { x: number; y: number; w: number; h: number } | null {
    return this.entries[0]?.bounds ?? null;
  }

  get mordecaiTileX(): number {
    return this.entries[0]?.mordecaiHomeTileX ?? 0;
  }

  get mordecaiTileY(): number {
    return this.entries[0]?.mordecaiHomeTileY ?? 0;
  }

  /** All Mordecai home tile positions (for minimap). */
  get mordecaiPositions(): Array<{ x: number; y: number }> {
    return this.entries.map((e) => ({
      x: e.mordecaiHomeTileX,
      y: e.mordecaiHomeTileY,
    }));
  }

  get isSleeping(): boolean {
    return this._isSleeping;
  }

  get mordecaiDialogOpen(): boolean {
    return this._mordecaiDialogOpen;
  }

  set mordecaiDialogOpen(v: boolean) {
    this._mordecaiDialogOpen = v;
  }

  // Wander update

  updateWander(): void {
    this.wanderTime++;
  }

  /** Returns pixel offset and facing for entry i's Mordecai. */
  private getWanderState(entryIdx: number): {
    offsetX: number;
    isWalking: boolean;
    facingX: number;
  } {
    // Each entry is out of phase with others so they don't walk in unison
    const t = this.wanderTime + entryIdx * 210;
    // Cycle: 150f walk right, 100f idle, 150f walk left, 100f idle = 500f
    const cycle = t % 500;
    const maxOffset = TILE_SIZE * 1.8;

    if (cycle < 150) {
      return {
        offsetX: (cycle / 150) * maxOffset,
        isWalking: true,
        facingX: 1,
      };
    } else if (cycle < 250) {
      return { offsetX: maxOffset, isWalking: false, facingX: 1 };
    } else if (cycle < 400) {
      return {
        offsetX: maxOffset - ((cycle - 250) / 150) * maxOffset,
        isWalking: true,
        facingX: -1,
      };
    } else {
      return { offsetX: 0, isWalking: false, facingX: -1 };
    }
  }

  // Queries

  isEntityInSafeRoom(entity: { x: number; y: number }): boolean {
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * 0.5) / ts);
    const ty = Math.floor((entity.y + ts * 0.5) / ts);
    return this.entries.some(
      (e) =>
        tx >= e.bounds.x &&
        tx < e.bounds.x + e.bounds.w &&
        ty >= e.bounds.y &&
        ty < e.bounds.y + e.bounds.h,
    );
  }

  isNearMordecai(entity: { x: number; y: number }): boolean {
    return this.entries.some((e, i) => {
      const { offsetX } = this.getWanderState(i);
      const mx = e.mordecaiHomeTileX * TILE_SIZE + offsetX;
      const my = e.mordecaiHomeTileY * TILE_SIZE;
      return Math.hypot(entity.x - mx, entity.y - my) < TILE_SIZE * 2.5;
    });
  }

  isNearBed(entity: { x: number; y: number }): boolean {
    return this.entries.some((e) => {
      const bx = e.bedTileX * TILE_SIZE;
      const by = e.bedTileY * TILE_SIZE;
      return Math.hypot(entity.x - bx, entity.y - by) < TILE_SIZE * 1.8;
    });
  }

  evictMobs(_mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const fallback =
      this.gameMap.mobSpawnPoints.length > 0
        ? this.gameMap.mobSpawnPoints
        : this.gameMap.hallwaySpawnPoints;
    if (fallback.length === 0) return;

    const ts = TILE_SIZE;
    for (const e of this.entries) {
      const b = e.bounds;
      const candidates = mobGrid.queryRect(
        b.x * ts - ts,
        b.y * ts - ts,
        b.w * ts + ts * 2,
        b.h * ts + ts * 2,
      );
      for (const mob of candidates) {
        if (!mob.isAlive) continue;
        if (this.isEntityInSafeRoom(mob)) {
          const ox = mob.x,
            oy = mob.y;
          const pt = fallback[Math.floor(Math.random() * fallback.length)];
          mob.x = pt.x * ts;
          mob.y = pt.y * ts;
          mobGrid.move(mob, ox, oy);
        }
      }
    }
  }

  startSleep(): void {
    this._isSleeping = true;
    this.sleepTimer = this.SLEEP_TOTAL;
    this.sleepHealed = false;
  }

  /** Returns frames to deduct from the level timer when sleep ends (10800), else 0. */
  updateSleep(human: HumanPlayer, cat: CatPlayer): number {
    this.sleepTimer--;

    if (
      !this.sleepHealed &&
      this.sleepTimer <= this.SLEEP_HOLD + this.SLEEP_FADEIN - 5
    ) {
      human.hp = human.maxHp;
      cat.hp = cat.maxHp;
      this.sleepHealed = true;
    }

    if (this.sleepTimer <= 0) {
      this._isSleeping = false;
      return 10800; // 3 minutes at 60 fps
    }
    return 0;
  }

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    speechBubblePulse: number,
  ): void {
    const ts = TILE_SIZE;

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const b = e.bounds;
      const { offsetX, isWalking, facingX } = this.getWanderState(i);

      // "SAFE ROOM" banner
      const bannerTileY = b.y - 1;
      const bannerTileX = b.x + Math.floor(b.w / 2);
      const bsx = bannerTileX * ts - camX;
      const bsy = bannerTileY * ts - camY;
      ctx.save();
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f0e4c8';
      ctx.fillText('SAFE ROOM', bsx, bsy + ts * 0.65);
      ctx.textAlign = 'left';
      ctx.restore();

      // Bed
      const bedSx = e.bedTileX * ts - camX;
      const bedSy = e.bedTileY * ts - camY;
      this.renderBed(ctx, bedSx, bedSy, ts);

      // Mordecai (wandered position)
      const msx = e.mordecaiHomeTileX * ts + offsetX - camX;
      const msy = e.mordecaiHomeTileY * ts - camY;
      drawMordecaiForLevel(
        ctx,
        msx,
        msy,
        ts,
        this.wanderTime,
        isWalking,
        facingX,
        this.levelId,
      );

      if (this.isNearMordecai(active) && !this._mordecaiDialogOpen) {
        drawSpeechBubble(ctx, msx, msy, ts, speechBubblePulse);
      }
    }
  }

  renderUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
    active: { x: number; y: number },
  ): void {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const { offsetX } = this.getWanderState(i);

      // Sleep prompt near bed
      if (
        this.isEntityInSafeRoom(active) &&
        this.isNearBed(active) &&
        !this._isSleeping
      ) {
        const bsx = e.bedTileX * TILE_SIZE - camX;
        const bsy = e.bedTileY * TILE_SIZE - camY;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        const tw = 210;
        const th = 28;
        ctx.fillRect(bsx + TILE_SIZE * 0.5 - tw / 2, bsy - 38, tw, th);
        ctx.fillStyle = '#f0e8d0';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          '[Space] Sleep (restores HP)',
          bsx + TILE_SIZE * 0.5,
          bsy - 18,
        );
        ctx.textAlign = 'left';
        ctx.restore();
        break; // only prompt for the first nearby bed
      }

      // Talk prompt near Mordecai
      const mx = e.mordecaiHomeTileX * TILE_SIZE + offsetX - camX;
      const my = e.mordecaiHomeTileY * TILE_SIZE - camY;
      const nearThis =
        this.isEntityInSafeRoom(active) &&
        Math.hypot(
          active.x - (e.mordecaiHomeTileX * TILE_SIZE + offsetX),
          active.y - e.mordecaiHomeTileY * TILE_SIZE,
        ) <
          TILE_SIZE * 2.5 &&
        !this._mordecaiDialogOpen;
      if (nearThis) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.68)';
        const tw = 110;
        const th = 24;
        ctx.fillRect(mx + TILE_SIZE * 0.5 - tw / 2, my - 34, tw, th);
        ctx.fillStyle = '#f0e8d0';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[Space] Talk', mx + TILE_SIZE * 0.5, my - 17);
        ctx.textAlign = 'left';
        ctx.restore();
        break; // only prompt once
      }
    }

    // "SAFE ROOM" HUD label when player is inside
    if (this.isEntityInSafeRoom(active)) {
      ctx.save();
      ctx.fillStyle = 'rgba(240,228,200,0.85)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('~ Safe Room ~', canvas.width / 2, canvas.height - 18);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  renderMordecaiDialog(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const dh = 120;
    const dw = Math.min(560, canvas.width - 40);
    const dx = (canvas.width - dw) / 2;
    const dy = canvas.height - dh - 20;

    ctx.save();
    ctx.fillStyle = 'rgba(10,8,6,0.92)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#c8a860';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    ctx.fillStyle = '#c8a860';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('Mordecai', dx + 14, dy + 20);

    ctx.fillStyle = '#e8dfc8';
    ctx.font = '12px monospace';
    const lines = [
      'Welcome to the dungeon. Here you must kill enemies to',
      'level up and you must find the stairwell on each level',
      'to get to the next level.',
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, dx + 14, dy + 44 + i * 18);
    });

    ctx.fillStyle = '#7a6e5a';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('[Space / Esc] Close', dx + dw - 12, dy + dh - 10);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  renderSleepOverlay(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): void {
    const t = this.sleepTimer;
    const fadeIn = this.SLEEP_FADEIN;
    const hold = this.SLEEP_HOLD;

    let alpha: number;
    if (t > hold + fadeIn) {
      alpha = 1 - (t - hold - fadeIn) / fadeIn;
    } else if (t > fadeIn) {
      alpha = 1;
    } else {
      alpha = t / fadeIn;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (t > fadeIn && t <= hold + fadeIn) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Sleeping...', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('zZz', canvas.width / 2, canvas.height / 2 + 18);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  private renderBed(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    s: number,
  ): void {
    ctx.fillStyle = '#7a4e2c';
    ctx.fillRect(sx + s * 0.05, sy + s * 0.12, s * 0.9, s * 0.8);

    ctx.fillStyle = '#f0e8d8';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.18, s * 0.8, s * 0.65);

    ctx.fillStyle = '#fafaf8';
    ctx.fillRect(sx + s * 0.14, sy + s * 0.21, s * 0.72, s * 0.2);
    ctx.strokeStyle = '#d8d0c0';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + s * 0.14, sy + s * 0.21, s * 0.72, s * 0.2);

    ctx.fillStyle = '#3a6e8a';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.41, s * 0.8, s * 0.42);

    ctx.fillStyle = '#2e5a74';
    ctx.fillRect(sx + s * 0.1, sy + s * 0.41, s * 0.8, s * 0.05);

    ctx.fillStyle = '#5c3820';
    ctx.fillRect(sx + s * 0.05, sy + s * 0.12, s * 0.9, s * 0.1);
    ctx.fillRect(sx + s * 0.05, sy + s * 0.82, s * 0.9, s * 0.1);
  }
}
