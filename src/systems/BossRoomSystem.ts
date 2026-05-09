import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

interface VomitProjectile {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ttl: number;
  age: number;
}

interface AcidPuddle {
  x: number;
  y: number;
  ttl: number;
}

interface BossRoomState {
  bounds: { x: number; y: number; w: number; h: number };
  locked: boolean;
  defeated: boolean;
  defeatTimer: number;
  pulse: number;
}

export const BOSS_META: Record<string, { displayName: string; color: string }> = {
  the_hoarder: { displayName: 'THE HOARDER', color: '#c084fc' },
  juicer: { displayName: 'THE JUICER', color: '#fb923c' },
  ball_of_swine: { displayName: 'BALL OF SWINE', color: '#f87171' },
  krakaren_clone: { displayName: 'KRAKAREN CLONE', color: '#e05090' },
};

const MAX_COCKROACHES = 3;
const MAX_ACID_PUDDLES = 5;
const PUDDLE_TTL = 600;
const ACID_DAMAGE_INTERVAL = 30;
const PROJECTILE_TTL = 90;
const ACID_PUDDLE_RADIUS = TILE_SIZE * 1.5;

export class BossRoomSystem implements GameSystem {
  private readonly states: BossRoomState[];
  private readonly bossTypes: string[];
  private readonly enteredRooms = new Set<number>();

  private readonly vomitProjectiles: VomitProjectile[] = [];
  private readonly acidPuddles: AcidPuddle[] = [];
  private puddleClock = 0;
  private humanAcidTick = 0;
  private catAcidTick = 0;

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
    return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
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
    return this.states.some((s) => s.locked && this.isEntityInRoom(mob, s.bounds));
  }

  update(ctx: SystemContext): void {
    const { mobs, mobGrid, human, cat } = ctx;
    // Tick defeat timers and pulse
    for (const state of this.states) {
      if (state.defeatTimer > 0) state.defeatTimer--;
      if (state.locked || state.defeatTimer > 0) state.pulse++;
    }

    for (const state of this.states) {
      if (state.defeated) continue;

      const boss = mobs.find((m) => m.isBoss && this.isEntityInRoom(m, state.bounds));
      const bossAlive = boss?.isAlive;

      if (
        !state.locked &&
        bossAlive &&
        (this.isEntityInRoom(human, state.bounds) || this.isEntityInRoom(cat, state.bounds))
      ) {
        state.locked = true;
        const idx = this.states.indexOf(state);
        if (!this.enteredRooms.has(idx)) {
          this.enteredRooms.add(idx);
          this.newlyLockedBossType = this.bossTypes[idx] ?? 'the_hoarder';
        }
        // Teleport the other player in if they're within 5 tiles of the room
        const b = state.bounds;
        const roomCenterX = (b.x + b.w * 0.5) * TILE_SIZE;
        const roomCenterY = (b.y + b.h * 0.5) * TILE_SIZE;
        for (const player of [human, cat]) {
          if (!this.isEntityInRoom(player, b)) {
            const px = player.x + TILE_SIZE * 0.5;
            const py = player.y + TILE_SIZE * 0.5;
            // Distance from player center to nearest edge of room bounds (in tiles)
            const roomMinX = b.x * TILE_SIZE;
            const roomMinY = b.y * TILE_SIZE;
            const roomMaxX = (b.x + b.w) * TILE_SIZE;
            const roomMaxY = (b.y + b.h) * TILE_SIZE;
            const dx = Math.max(roomMinX - px, 0, px - roomMaxX);
            const dy = Math.max(roomMinY - py, 0, py - roomMaxY);
            const distTiles = Math.hypot(dx, dy) / TILE_SIZE;
            if (distTiles <= 5) {
              // Teleport to room center
              player.x = roomCenterX - TILE_SIZE * 0.5;
              player.y = roomCenterY - TILE_SIZE * 0.5;
            }
          }
        }
      }

      if (state.locked && !bossAlive) {
        state.locked = false;
        state.defeated = true;
        state.defeatTimer = 300;
        this.miniMap.revealBossNeighborhood(state.bounds);
        // Kill all cockroaches and clear acid hazards when boss is defeated
        for (const mob of mobs) {
          if (mob instanceof Cockroach && mob.isAlive) {
            mob.hp = 0;
            mob.justDied = true;
          }
        }
        this.vomitProjectiles.length = 0;
        this.acidPuddles.length = 0;
      }

      if (state.locked) {
        this.clampToBossRoom(human, state.bounds);
        this.clampToBossRoom(cat, state.bounds);
      }
    }

    this.spawnHoarderCockroaches(mobs, mobGrid);
    this.tickCockroachTTLs(mobs, mobGrid);
    this.processVomitProjectiles();
    this.tickAcidPuddles(human, cat);
    this.puddleClock++;
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
    entity.x = clamp(entity.x, minPx, maxPx);
    entity.y = clamp(entity.y, minPy, maxPy);
  }

  private spawnHoarderCockroaches(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const liveCount = mobs.filter((m) => m instanceof Cockroach && m.isAlive).length;
    for (const mob of mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;

      // Tell the hoarder whether the cap is full so it can decide to vomit instead
      mob.cockroachAtCap = liveCount >= MAX_COCKROACHES;

      // Drain any pending vomit projectile
      if (mob.pendingVomitProjectile !== null) {
        const p = mob.pendingVomitProjectile;
        mob.pendingVomitProjectile = null;
        this.vomitProjectiles.push({
          x: p.x,
          y: p.y,
          dx: p.dx,
          dy: p.dy,
          ttl: PROJECTILE_TTL,
          age: 0,
        });
      }

      if (mob.cockroachSpawns.length === 0) continue;
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

  private processVomitProjectiles(): void {
    for (let i = this.vomitProjectiles.length - 1; i >= 0; i--) {
      const proj = this.vomitProjectiles[i];
      const newX = proj.x + proj.dx;
      const newY = proj.y + proj.dy;
      const tileX = Math.floor(newX / TILE_SIZE);
      const tileY = Math.floor(newY / TILE_SIZE);
      const hitWall = !this.gameMap.isWalkable(tileX, tileY);
      if (hitWall || proj.ttl <= 0) {
        this.vomitProjectiles.splice(i, 1);
        if (this.acidPuddles.length < MAX_ACID_PUDDLES) {
          this.acidPuddles.push({ x: proj.x, y: proj.y, ttl: PUDDLE_TTL });
        }
      } else {
        proj.x = newX;
        proj.y = newY;
        proj.ttl--;
        proj.age++;
      }
    }
  }

  private tickAcidPuddles(human: HumanPlayer, cat: CatPlayer): void {
    for (let i = this.acidPuddles.length - 1; i >= 0; i--) {
      const puddle = this.acidPuddles[i];
      puddle.ttl--;
      if (puddle.ttl <= 0) this.acidPuddles.splice(i, 1);
    }

    // Apply acid damage per player
    const humanInAcid = this.acidPuddles.some(
      (p) =>
        Math.hypot(human.x + TILE_SIZE * 0.5 - p.x, human.y + TILE_SIZE * 0.5 - p.y) <
        ACID_PUDDLE_RADIUS,
    );
    if (humanInAcid) {
      this.humanAcidTick++;
      if (this.humanAcidTick % ACID_DAMAGE_INTERVAL === 0) {
        human.takeDamage(1);
        human.damageFlash = 8;
      }
    } else {
      this.humanAcidTick = 0;
    }

    const catInAcid = this.acidPuddles.some(
      (p) =>
        Math.hypot(cat.x + TILE_SIZE * 0.5 - p.x, cat.y + TILE_SIZE * 0.5 - p.y) <
        ACID_PUDDLE_RADIUS,
    );
    if (catInAcid) {
      this.catAcidTick++;
      if (this.catAcidTick % ACID_DAMAGE_INTERVAL === 0) {
        cat.takeDamage(1);
        cat.damageFlash = 8;
      }
    } else {
      this.catAcidTick = 0;
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

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (let i = 0; i < this.states.length; i++) {
      const bossType = this.bossTypes[i] ?? 'the_hoarder';
      this.renderSingleBossRoomObjects(ctx, camX, camY, this.states[i].bounds, bossType);
    }
    this.renderAcidPuddles(ctx, camX, camY);
  }

  renderProjectiles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.vomitProjectiles.length === 0) return;
    ctx.save();
    for (const proj of this.vomitProjectiles) {
      const screenX = proj.x - camX;
      const screenY = proj.y - camY;
      const angle = Math.atan2(proj.dy, proj.dx);
      const progress = proj.age / PROJECTILE_TTL;

      // Procedural bile orb: bright green blob with inner glow
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.rotate(angle);
      const r = TILE_SIZE * 0.35;
      const len = r * (0.6 + progress * 1.4);
      const grad = ctx.createLinearGradient(-len, 0, len, 0);
      grad.addColorStop(0, 'rgba(80,200,20,0.9)');
      grad.addColorStop(0.5, 'rgba(180,255,60,0.95)');
      grad.addColorStop(1, 'rgba(40,140,10,0.4)');
      ctx.shadowColor = '#a0ff40';
      ctx.shadowBlur = 10;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Overlay sprite if loaded
      const frame = progressFrameIndex(progress, 7);
      drawSpriteKey(ctx, 'hoarder_vomit_arc', 'arc', frame, screenX, screenY, TILE_SIZE, {
        rotation: angle,
      });
    }
    ctx.restore();
  }

  private renderAcidPuddles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.acidPuddles.length === 0) return;
    const frame = timeFrameIndex(this.puddleClock / 60, 6, 4);
    const pulse = 0.7 + 0.3 * Math.sin(this.puddleClock * 0.12);
    ctx.save();
    for (const puddle of this.acidPuddles) {
      const fadeAlpha = puddle.ttl < 120 ? puddle.ttl / 120 : 1;
      const screenX = puddle.x - camX;
      const screenY = puddle.y - camY;

      // Procedural acid puddle: glowing green ellipse on the floor
      ctx.save();
      ctx.globalAlpha = fadeAlpha * 0.75 * pulse;
      ctx.shadowColor = '#80ff20';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#4aad10';
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, TILE_SIZE * 1.2, TILE_SIZE * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fadeAlpha * 0.45;
      ctx.fillStyle = '#a0ff40';
      ctx.beginPath();
      ctx.ellipse(screenX, screenY, TILE_SIZE * 0.7, TILE_SIZE * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Overlay sprite if loaded
      drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'puddle', frame, screenX, screenY, TILE_SIZE, {
        alpha: fadeAlpha,
      });
    }
    ctx.restore();
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

    const meta = BOSS_META[bossType] ?? BOSS_META.the_hoarder;
    const bannerX = (b.x + Math.floor(b.w / 2)) * ts - camX;
    const bannerY = (b.y - 1) * ts - camY;
    // "BOSS ROOM" world-space label
    // size=10, old baseline = bannerY + ts*0.65; top = baseline - round(10*0.8) = baseline - 8
    drawText(ctx, 'BOSS ROOM', {
      ...TEXT_PRESETS.label,
      x: bannerX,
      y: bannerY + ts * 0.65 - 8,
      size: 10,
      bold: true,
      color: meta.color,
      align: 'center',
    });

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
      ctx.ellipse(gx, gy, gw * 0.5, gh * 0.5, rng(i + 40) * Math.PI, 0, Math.PI * 2);
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
      ctx.ellipse(canX, canY, ts * 0.1, ts * 0.06, rng(i + 110) * Math.PI, 0, Math.PI * 2);
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
      const corners: [number, number][] = [
        [b.x, b.y],
        [b.x + b.w - 1, b.y],
        [b.x, b.y + b.h - 1],
        [b.x + b.w - 1, b.y + b.h - 1],
      ];
      for (const [ex, ey] of corners) {
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
    const meta = BOSS_META[bossType] ?? BOSS_META.the_hoarder;

    const boss = mobs.find((m) => m.isBoss && this.isEntityInRoom(m, relevantState.bounds));
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

    // Boss name label: size=11, old baseline = barY - 6; top = (barY-6) - round(11*0.8) = barY-6-9 = barY-15
    const nameText = isEnraged ? `⚠ ${meta.displayName} [ENRAGED] ⚠` : meta.displayName;
    drawText(ctx, nameText, {
      x: canvas.width / 2,
      y: barY - 15,
      size: 11,
      bold: true,
      color: isEnraged ? '#ef4444' : meta.color,
      align: 'center',
    });

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

    ctx.restore();

    // HP values inside bar: size=9, old baseline = barY + barH - 4
    // top = (barY + barH - 4) - round(9*0.8) = (barY + barH - 4) - 7 = barY + barH - 11
    drawText(ctx, `${boss.hp} / ${boss.maxHp}`, {
      x: canvas.width / 2,
      y: barY + barH - 11,
      size: 9,
      color: '#e2e8f0',
      align: 'center',
    });

    if (relevantState.defeated) {
      // "DEFEATED" text: size=12, old baseline = barY + barH + 16
      // top = (barY + barH + 16) - round(12*0.8) = (barY + barH + 16) - 10 = barY + barH + 6
      drawText(ctx, 'DEFEATED', {
        x: canvas.width / 2,
        y: barY + barH + 6,
        size: 12,
        bold: true,
        color: '#4ade80',
        align: 'center',
      });
    }

    void camX;
    void camY;
  }
}
