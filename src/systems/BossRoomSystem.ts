import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { SpatialGrid } from '../core/SpatialGrid';
import { Mob } from '../creatures/Mob';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';

interface BossRoomState {
  bounds: { x: number; y: number; w: number; h: number };
  locked: boolean;
  defeated: boolean;
  defeatTimer: number;
  pulse: number;
}

export const BOSS_META: Record<string, { displayName: string; color: string }> =
  {
    the_hoarder: { displayName: 'THE HOARDER', color: '#c084fc' },
    juicer: { displayName: 'THE JUICER', color: '#fb923c' },
    ball_of_swine: { displayName: 'BALL OF SWINE', color: '#f87171' },
    krakaren_clone: { displayName: 'KRAKAREN CLONE', color: '#e05090' },
  };

export class BossRoomSystem {
  private readonly states: BossRoomState[];
  private readonly bossTypes: string[];
  private readonly enteredRooms = new Set<number>();

  /** Set when a boss room is entered for the first time; cleared by DungeonScene. */
  newlyLockedBossType: string | null = null;

  constructor(
    private readonly gameMap: GameMap,
    private readonly miniMap: MiniMapSystem,
    bossTypes: string[] = [],
  ) {
    this.bossTypes = bossTypes;
    this.states = gameMap.bossRooms.map((br) => ({
      bounds: br.bounds,
      locked: false,
      defeated: false,
      defeatTimer: 0,
      pulse: 0,
    }));
  }

  getBossRoomStates(): BossRoomState[] {
    return this.states;
  }

  isEntityInRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
    return (
      tx >= bounds.x &&
      tx < bounds.x + bounds.w &&
      ty >= bounds.y &&
      ty < bounds.y + bounds.h
    );
  }

  isEntityInAnyBossRoom(entity: { x: number; y: number }): boolean {
    return this.states.some((s) => this.isEntityInRoom(entity, s.bounds));
  }

  /** Returns true if any boss room is currently locked (players clamped inside). */
  get anyLocked(): boolean {
    return this.states.some((s) => s.locked);
  }

  /** Returns true when this mob is inside an active (locked) boss room. */
  isBossInLockedRoom(mob: Mob): boolean {
    return this.states.some(
      (s) => s.locked && this.isEntityInRoom(mob, s.bounds),
    );
  }

  update(
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    // Tick defeat timers and pulse
    for (const state of this.states) {
      if (state.defeatTimer > 0) state.defeatTimer--;
      if (state.locked || state.defeatTimer > 0) state.pulse++;
    }

    for (const state of this.states) {
      if (state.defeated) continue;

      const boss = mobs.find(
        (m) => m.isBoss && this.isEntityInRoom(m, state.bounds),
      );
      const bossAlive = boss !== undefined && boss.isAlive;

      if (
        !state.locked &&
        bossAlive &&
        (this.isEntityInRoom(human, state.bounds) ||
          this.isEntityInRoom(cat, state.bounds))
      ) {
        state.locked = true;
        const idx = this.states.indexOf(state);
        if (!this.enteredRooms.has(idx)) {
          this.enteredRooms.add(idx);
          this.newlyLockedBossType = this.bossTypes[idx] ?? 'the_hoarder';
        }
      }

      if (state.locked && !bossAlive) {
        state.locked = false;
        state.defeated = true;
        state.defeatTimer = 300;
        this.miniMap.revealBossNeighborhood(state.bounds);
        // Kill all cockroaches when boss is defeated
        for (const mob of mobs) {
          if (mob instanceof Cockroach && mob.isAlive) {
            mob.hp = 0;
            mob.justDied = true;
          }
        }
      }

      if (state.locked) {
        this.clampToBossRoom(human, state.bounds);
        this.clampToBossRoom(cat, state.bounds);
      }
    }

    this.spawnHoarderCockroaches(mobs, mobGrid);
    this.tickCockroachTTLs(mobs, mobGrid);
  }

  /** Clamps a boss mob to its own boss room (call after mob AI runs each frame). */
  clampBossToRoom(mob: Mob): void {
    // Only clamp to the room this mob is currently inside.
    // Clamping to every room sequentially would displace bosses to the last room.
    for (const state of this.states) {
      if (this.isEntityInRoom(mob, state.bounds)) {
        this.clampToBossRoom(mob, state.bounds);
        return;
      }
    }
    // Mob outside all rooms (shouldn't normally happen): clamp to nearest by center.
    let bestState: BossRoomState | null = null;
    let bestDist = Infinity;
    const mx = mob.x + TILE_SIZE * 0.5;
    const my = mob.y + TILE_SIZE * 0.5;
    for (const state of this.states) {
      const b = state.bounds;
      const cx = (b.x + b.w * 0.5) * TILE_SIZE;
      const cy = (b.y + b.h * 0.5) * TILE_SIZE;
      const d = Math.hypot(mx - cx, my - cy);
      if (d < bestDist) {
        bestDist = d;
        bestState = state;
      }
    }
    if (bestState) this.clampToBossRoom(mob, bestState.bounds);
  }

  private clampToBossRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): void {
    const minPx = bounds.x * TILE_SIZE;
    const minPy = bounds.y * TILE_SIZE;
    const maxPx = (bounds.x + bounds.w - 1) * TILE_SIZE;
    const maxPy = (bounds.y + bounds.h - 1) * TILE_SIZE;
    entity.x = Math.max(minPx, Math.min(maxPx, entity.x));
    entity.y = Math.max(minPy, Math.min(maxPy, entity.y));
  }

  private spawnHoarderCockroaches(
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const MAX_COCKROACHES = 3;
    for (const mob of mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;
      if (mob.cockroachSpawns.length === 0) continue;
      const liveCount = mobs.filter(
        (m) => m instanceof Cockroach && m.isAlive,
      ).length;
      let spawned = liveCount;
      for (const sp of mob.cockroachSpawns) {
        if (spawned >= MAX_COCKROACHES) break;
        const tileX = Math.floor(sp.x / TILE_SIZE);
        const tileY = Math.floor(sp.y / TILE_SIZE);
        if (this.gameMap.isWalkable(tileX, tileY)) {
          const roach = new Cockroach(tileX, tileY, TILE_SIZE);
          roach.setMap(this.gameMap);
          mobs.push(roach);
          mobGrid.insert(roach);
          spawned++;
        }
      }
      mob.cockroachSpawns = [];
    }
  }

  private tickCockroachTTLs(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    for (const mob of mobs) {
      if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
      mob.ttl--;
      if (mob.ttl <= 0) {
        mob.hp = 0;
        mob.justDied = true;
      }
    }
    if (mobs.length > 200) {
      for (const m of mobs) {
        if (!m.isAlive && m instanceof Cockroach) mobGrid.remove(m);
      }
      // Splice dead cockroaches out in place
      let i = mobs.length;
      while (i--) {
        const m = mobs[i];
        if (!m.isAlive && m instanceof Cockroach) mobs.splice(i, 1);
      }
    }
  }

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ): void {
    for (let i = 0; i < this.states.length; i++) {
      const bossType = this.bossTypes[i] ?? 'the_hoarder';
      this.renderSingleBossRoomObjects(
        ctx,
        camX,
        camY,
        this.states[i].bounds,
        bossType,
      );
    }
  }

  private renderSingleBossRoomObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    b: { x: number; y: number; w: number; h: number },
    bossType: string,
  ): void {
    const ts = TILE_SIZE;
    const cx = (b.x + b.w * 0.5) * ts - camX;
    const cy = (b.y + b.h * 0.5) * ts - camY;

    const meta = BOSS_META[bossType] ?? BOSS_META['the_hoarder'];
    const bannerX = (b.x + Math.floor(b.w / 2)) * ts - camX;
    const bannerY = (b.y - 1) * ts - camY;
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = meta.color;
    ctx.fillText('BOSS ROOM', bannerX, bannerY + ts * 0.65);
    ctx.textAlign = 'left';
    ctx.restore();

    // Juicer's gym room — decoration handled by JuicerRoomSystem
    if (bossType === 'juicer') return;

    // Krakaren Clone lair — water puddles and slime
    if (bossType === 'krakaren_clone') {
      ctx.save();
      const kseed = b.x * 31 + b.y * 17;
      const krng = (n: number) => {
        const sv = Math.sin(kseed + n * 127.1) * 43758.5453;
        return sv - Math.floor(sv);
      };
      // Water puddles
      for (let i = 0; i < 8; i++) {
        const px = cx + (krng(i) - 0.5) * b.w * ts * 0.7;
        const py = cy + (krng(i + 10) - 0.5) * b.h * ts * 0.7;
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#4080a0';
        ctx.beginPath();
        ctx.ellipse(
          px,
          py,
          ts * (0.4 + krng(i + 20) * 0.3),
          ts * (0.2 + krng(i + 30) * 0.15),
          krng(i + 40) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Pink slime trails
      for (let i = 0; i < 6; i++) {
        const slx = cx + (krng(i + 50) - 0.5) * b.w * ts * 0.6;
        const sly = cy + (krng(i + 60) - 0.5) * b.h * ts * 0.6;
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#d06888';
        ctx.beginPath();
        ctx.ellipse(
          slx,
          sly,
          ts * (0.15 + krng(i + 70) * 0.2),
          ts * (0.08 + krng(i + 80) * 0.1),
          krng(i + 90) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    ctx.save();

    const seed = b.x * 31 + b.y * 17;
    const rng = (n: number) => {
      const s = Math.sin(seed + n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };

    // Garbage bags
    for (let i = 0; i < 7; i++) {
      const gx = cx + (rng(i) - 0.5) * b.w * ts * 0.7;
      const gy = cy + (rng(i + 10) - 0.5) * b.h * ts * 0.7;
      const gw = ts * (0.5 + rng(i + 20) * 0.4);
      const gh = ts * (0.35 + rng(i + 30) * 0.25);
      ctx.fillStyle = rng(i + 5) > 0.5 ? '#1a3018' : '#0f1f0e';
      ctx.beginPath();
      ctx.ellipse(
        gx,
        gy,
        gw * 0.5,
        gh * 0.5,
        rng(i + 40) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = '#4a7a40';
      ctx.beginPath();
      ctx.arc(gx, gy - gh * 0.35, gw * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cardboard boxes
    for (let i = 0; i < 4; i++) {
      const bx = cx + (rng(i + 50) - 0.5) * b.w * ts * 0.65;
      const by = cy + (rng(i + 60) - 0.5) * b.h * ts * 0.65;
      const bw = ts * (0.4 + rng(i + 70) * 0.35);
      const bh = ts * (0.3 + rng(i + 80) * 0.25);
      ctx.fillStyle = '#4a3010';
      ctx.fillRect(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      ctx.strokeStyle = '#2a1a06';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      ctx.beginPath();
      ctx.moveTo(bx, by - bh * 0.5);
      ctx.lineTo(bx, by + bh * 0.5);
      ctx.moveTo(bx - bw * 0.5, by);
      ctx.lineTo(bx + bw * 0.5, by);
      ctx.stroke();
    }

    // Crushed cans
    for (let i = 0; i < 8; i++) {
      const canX = cx + (rng(i + 90) - 0.5) * b.w * ts * 0.75;
      const canY = cy + (rng(i + 100) - 0.5) * b.h * ts * 0.75;
      ctx.fillStyle = '#8a8888';
      ctx.beginPath();
      ctx.ellipse(
        canX,
        canY,
        ts * 0.1,
        ts * 0.06,
        rng(i + 110) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Puke stains
    for (let i = 0; i < 5; i++) {
      const px = cx + (rng(i + 120) - 0.5) * b.w * ts * 0.6;
      const py = cy + (rng(i + 130) - 0.5) * b.h * ts * 0.6;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#8fbc14';
      ctx.beginPath();
      ctx.ellipse(
        px,
        py,
        ts * (0.28 + rng(i + 140) * 0.2),
        ts * (0.14 + rng(i + 150) * 0.1),
        rng(i + 160) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Paper scraps
    for (let i = 0; i < 10; i++) {
      const px = cx + (rng(i + 170) - 0.5) * b.w * ts * 0.8;
      const py = cy + (rng(i + 180) - 0.5) * b.h * ts * 0.8;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rng(i + 190) * Math.PI);
      ctx.fillStyle = rng(i + 200) > 0.5 ? '#c8c0a8' : '#d8d0b8';
      ctx.fillRect(-ts * 0.12, -ts * 0.07, ts * 0.24, ts * 0.14);
      ctx.restore();
    }

    ctx.restore();
  }

  renderUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
    mobs: Mob[],
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    if (this.states.length === 0) return;

    // Barrier lines for locked rooms
    for (const state of this.states) {
      if (!state.locked) continue;
      const b = state.bounds;
      const ts = TILE_SIZE;
      ctx.save();
      const pulse = 0.55 + 0.25 * Math.sin(state.pulse * 0.12);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
      ctx.lineWidth = 2;
      for (const [ex, ey] of [
        [b.x, b.y],
        [b.x + b.w - 1, b.y],
        [b.x, b.y + b.h - 1],
        [b.x + b.w - 1, b.y + b.h - 1],
      ] as [number, number][]) {
        const sx = ex * ts - camX;
        const sy = ey * ts - camY;
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy + 4);
        ctx.lineTo(sx + ts - 4, sy + ts - 4);
        ctx.moveTo(sx + ts - 4, sy + 4);
        ctx.lineTo(sx + 4, sy + ts - 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Boss health bar
    const active = human.isActive ? human : cat;
    const relevantState = this.states.find(
      (s) =>
        s.locked ||
        s.defeatTimer > 0 ||
        this.isEntityInRoom(active, s.bounds) ||
        this.isEntityInRoom(human, s.bounds) ||
        this.isEntityInRoom(cat, s.bounds),
    );
    if (!relevantState) return;

    const relevantStateIdx = this.states.indexOf(relevantState);
    const bossType = this.bossTypes[relevantStateIdx] ?? 'the_hoarder';
    const meta = BOSS_META[bossType] ?? BOSS_META['the_hoarder'];

    const boss = mobs.find(
      (m) => m.isBoss && this.isEntityInRoom(m, relevantState.bounds),
    ) as (Mob & { isEnraged?: boolean }) | undefined;
    if (!boss) return;

    const isEnraged = boss.isEnraged ?? false;

    const barW = Math.min(360, canvas.width * 0.5);
    const barH = 18;
    const barX = Math.floor((canvas.width - barW) / 2);
    const barY = 48;
    const hpFrac = Math.max(0, boss.hp / boss.maxHp);

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(barX - 6, barY - 22, barW + 12, barH + 30);
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 6, barY - 22, barW + 12, barH + 30);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = isEnraged ? '#ef4444' : meta.color;
    ctx.textAlign = 'center';
    ctx.fillText(
      isEnraged ? `⚠ ${meta.displayName} [ENRAGED] ⚠` : meta.displayName,
      canvas.width / 2,
      barY - 6,
    );
    ctx.textAlign = 'left';

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = isEnraged ? '#ef4444' : meta.color;
    ctx.fillRect(barX, barY, barW * hpFrac, barH);

    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX + barW * 0.5, barY);
    ctx.lineTo(barX + barW * 0.5, barY + barH);
    ctx.stroke();

    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = '9px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${boss.hp} / ${boss.maxHp}`,
      canvas.width / 2,
      barY + barH - 4,
    );
    ctx.textAlign = 'left';

    if (relevantState.defeated) {
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'center';
      ctx.fillText('DEFEATED', canvas.width / 2, barY + barH + 16);
      ctx.textAlign = 'left';
    }

    ctx.restore();
    void camX;
    void camY;
  }
}
