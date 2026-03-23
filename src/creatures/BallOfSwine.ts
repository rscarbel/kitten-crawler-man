import { Mob } from './Mob';
import { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';
import { drawBallOfSwineSprite, drawBallOfSwineStoppedWarning } from '../sprites/ballOfSwineSprite';
import type { LootDrop } from './Mob';

const BOS_HP = 280;
const BOS_SPEED_BASE = 0; // movement is orbit-based, not collision-based

// Orbit parameters
const ORBIT_RADIUS_PX = TILE_SIZE * 5;
/** Angular velocity (radians per frame) while zooming. */
const ANGULAR_SPEED_ZOOM = 0.037;
/** Angular velocity while idle (slow spin). */
const ANGULAR_SPEED_IDLE = 0.012;
/** How fast the orbit centre lerps toward the aim target (0–1 per frame). */
const ORBIT_AIM_LERP = 0.012;
/** Radius of the arena interior floor in tiles (ARENA_RADIUS - WALL_THICKNESS = 15 - 2 = 13). */
const ARENA_INTERIOR_TILES = 13;

// Stopped phase
const STOPPED_FRAMES_MIN = 1200; // 20 s
const STOPPED_FRAMES_MAX = 2400; // 40 s
const STOPPING_FRAMES = 50; // deceleration before fully stopped

// Burst phase (visual death animation)
const BURST_FRAMES = 70;

// Contact kill distance (pixels from ball centre to player centre)
const KILL_RADIUS = TILE_SIZE * 0.9;
/** Cooldown between consecutive instant-kill contacts (prevent multi-kill on same player). */
const KILL_COOLDOWN = 90;

type BosState = 'idle' | 'zooming' | 'stopping' | 'stopped' | 'bursting';

export class BallOfSwine extends Mob {
  readonly xpValue = 1200;
  protected coinDropMin = 100;
  protected coinDropMax = 200;
  displayName = 'Ball of Swine';
  description =
    'A wheel-like mass of fused body parts that zooms around in arcing circles. Contact is instantly lethal.';

  // Arena info (set after construction via setArena)
  private arenaCenterPx = { x: 0, y: 0 };
  private arenaInteriorPx = 0;

  // Orbit state
  orbitAngle = Math.random() * Math.PI * 2;
  private orbitCenterX = 0;
  private orbitCenterY = 0;
  private currentAngularSpeed = ANGULAR_SPEED_IDLE;
  /** Direction of orbit rotation: +1 or -1. */
  private orbitSign = Math.random() < 0.5 ? 1 : -1;

  // State machine
  private state: BosState = 'idle';
  private stoppedTimer = 0;
  private stoppingTimer = 0;
  burstTimer = 0;
  /** Set when hp hits 0; DungeonScene reads this to spawn Tusklings. */
  pendingBurst = false;

  // Contact kill cooldowns per player
  private killCooldowns = new Map<Player, number>();

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BOS_HP, BOS_SPEED_BASE);
    this.isBoss = false; // managed by ArenaSystem, not BossRoomSystem
    // Initialise orbit centre at spawn position
    this.orbitCenterX = tileX * tileSize;
    this.orbitCenterY = tileY * tileSize;
  }

  /** Must be called once after construction so the ball knows its arena bounds. */
  setArena(centerTileX: number, centerTileY: number): void {
    this.arenaCenterPx = {
      x: centerTileX * TILE_SIZE,
      y: centerTileY * TILE_SIZE,
    };
    this.arenaInteriorPx = ARENA_INTERIOR_TILES * TILE_SIZE;
    // Start orbit centre at arena centre
    this.orbitCenterX = this.arenaCenterPx.x;
    this.orbitCenterY = this.arenaCenterPx.y;
  }

  get isStopped(): boolean {
    return this.state === 'stopped';
  }

  get isZooming(): boolean {
    return this.state === 'zooming';
  }

  get isStopping(): boolean {
    return this.state === 'stopping';
  }

  /** True while the ball is orbiting — companion AI should flee rather than engage. */
  get avoidInstead(): boolean {
    return this.state === 'zooming' || this.state === 'stopping';
  }

  // --- Damage override ---

  takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' = 'melee',
  ): void {
    if (this.pendingBurst || this.state === 'bursting') return;

    // Cap damage to 1 unless stopped
    const capped = this.isStopped ? amount : Math.min(amount, 1);

    const prevHp = this.hp;
    this.hp = Math.max(0, this.hp - capped);
    const actual = prevHp - this.hp;

    if (actual > 0) {
      this.damageFlash = 8;
      this.healthBarTimer = 180;
      if (attacker) {
        this.damageTakenBy.set(attacker, (this.damageTakenBy.get(attacker) ?? 0) + actual);
      }
    }

    if (this.hp === 0 && prevHp > 0) {
      this.killedBy = attacker;
      this.killType = damageType;
      this.pendingBurst = true;
      this.state = 'bursting';
      this.burstTimer = BURST_FRAMES;
      // Roll loot
      const coins = randomInt(this.coinDropMin, this.coinDropMax);
      const items = this.rollLootItems(attacker);
      if (coins > 0 || items.length > 0) {
        this.droppedLoot = { coins, items };
      }
    }
  }

  // Keep isAlive = true during burst so BossRoomSystem doesn't interfere
  get isAlive(): boolean {
    if (this.pendingBurst || this.state === 'bursting') return true;
    return this.hp > 0;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [{ id: 'health_potion', quantity: 3 }];
  }

  // --- AI ---

  updateAI(targets: Player[]): void {
    // Tick kill cooldowns
    for (const [p, cd] of this.killCooldowns) {
      if (cd <= 1) this.killCooldowns.delete(p);
      else this.killCooldowns.set(p, cd - 1);
    }

    switch (this.state) {
      case 'idle':
        this.updateIdle(targets);
        break;
      case 'zooming':
        this.updateZooming(targets);
        break;
      case 'stopping':
        this.updateStopping();
        break;
      case 'stopped':
        this.updateStopped(targets);
        break;
      case 'bursting':
        this.updateBursting();
        break;
    }

    this.isMoving = this.state === 'zooming';
  }

  private updateIdle(targets: Player[]): void {
    const nearest = this.nearestLiving(targets);
    this.currentTarget = nearest;
    this.currentAngularSpeed = ANGULAR_SPEED_IDLE;

    // When idle (no target nearby), keep orbit centred on the arena
    this.orbitCenterX += (this.arenaCenterPx.x - this.orbitCenterX) * 0.02;
    this.orbitCenterY += (this.arenaCenterPx.y - this.orbitCenterY) * 0.02;
    this.advanceOrbit();

    if (nearest) {
      this.updateLastKnown(nearest);
      this.state = 'zooming';
    }
  }

  private updateZooming(targets: Player[]): void {
    // Stop if slowed by barriers
    if (this.isSlowed) {
      this.state = 'stopping';
      this.stoppingTimer = STOPPING_FRAMES;
      return;
    }

    const nearest = this.nearestLiving(targets);
    this.currentTarget = nearest;
    // If all targets left the arena, return to idle
    if (!nearest) {
      this.state = 'idle';
      return;
    }
    this.updateLastKnown(nearest);

    this.currentAngularSpeed = ANGULAR_SPEED_ZOOM;

    // Aim orbit centre so its ring passes through the player's last position
    this.aimOrbit();
    this.advanceOrbit();

    // Contact = instant kill
    for (const t of targets) {
      if (!t.isAlive) continue;
      if (this.killCooldowns.has(t)) continue;
      const dx = t.x + TILE_SIZE * 0.5 - this.x;
      const dy = t.y + TILE_SIZE * 0.5 - this.y;
      if (Math.hypot(dx, dy) < KILL_RADIUS) {
        this.dealDamage(t, 9999);
        this.killCooldowns.set(t, KILL_COOLDOWN);
      }
    }
  }

  private updateStopping(): void {
    this.stoppingTimer--;
    const decel = this.stoppingTimer / STOPPING_FRAMES;
    this.currentAngularSpeed = ANGULAR_SPEED_ZOOM * decel;
    this.advanceOrbit();

    if (this.stoppingTimer <= 0) {
      this.state = 'stopped';
      this.stoppedTimer = randomInt(STOPPED_FRAMES_MIN, STOPPED_FRAMES_MAX);
      this.currentAngularSpeed = 0;
    }
  }

  private updateStopped(targets: Player[]): void {
    this.currentTarget = this.nearestLiving(targets);
    this.stoppedTimer--;
    if (this.stoppedTimer <= 0) {
      this.state = 'zooming';
      // Reverse direction each time it resumes for variety
      this.orbitSign *= -1;
    }
  }

  private updateBursting(): void {
    this.burstTimer--;
    if (this.burstTimer <= 0) {
      // Signal DungeonScene that burst is complete → spawns Tusklings + justDied
      this.justDied = true;
      this.pendingBurst = false;
    }
  }

  // --- Orbit helpers ---

  /** Move the ball to its current orbit position. */
  private advanceOrbit(): void {
    this.orbitAngle += this.currentAngularSpeed * this.orbitSign;
    this.x = this.orbitCenterX + Math.cos(this.orbitAngle) * ORBIT_RADIUS_PX;
    this.y = this.orbitCenterY + Math.sin(this.orbitAngle) * ORBIT_RADIUS_PX;
  }

  /**
   * Lerp the orbit centre toward the point where the orbit ring would pass
   * through the player's last known position.
   */
  private aimOrbit(): void {
    const tx = this.lastKnownTargetX;
    const ty = this.lastKnownTargetY;
    const dx = this.orbitCenterX - tx;
    const dy = this.orbitCenterY - ty;
    const dist = Math.hypot(dx, dy);

    let targetCX: number;
    let targetCY: number;
    if (dist < 1) {
      // Player is exactly at orbit centre — place target slightly offset
      targetCX = tx + ORBIT_RADIUS_PX;
      targetCY = ty;
    } else {
      // Target centre is at distance ORBIT_RADIUS from player in the current direction
      targetCX = tx + (dx / dist) * ORBIT_RADIUS_PX;
      targetCY = ty + (dy / dist) * ORBIT_RADIUS_PX;
    }

    // Lerp toward target
    this.orbitCenterX += (targetCX - this.orbitCenterX) * ORBIT_AIM_LERP;
    this.orbitCenterY += (targetCY - this.orbitCenterY) * ORBIT_AIM_LERP;

    // Clamp orbit centre so the entire orbit stays inside the arena interior
    if (this.arenaInteriorPx > 0) {
      const maxOffset = Math.max(0, this.arenaInteriorPx - ORBIT_RADIUS_PX - TILE_SIZE);
      const cdx = this.orbitCenterX - this.arenaCenterPx.x;
      const cdy = this.orbitCenterY - this.arenaCenterPx.y;
      const centerDist = Math.hypot(cdx, cdy);
      if (centerDist > maxOffset) {
        this.orbitCenterX = this.arenaCenterPx.x + (cdx / centerDist) * maxOffset;
        this.orbitCenterY = this.arenaCenterPx.y + (cdy / centerDist) * maxOffset;
      }
    }
  }

  // --- Utilities ---

  /** Only target players that are inside (or very near) the arena. */
  private nearestLiving(targets: Player[]): Player | null {
    const aggroRange = this.arenaInteriorPx + TILE_SIZE * 3;
    let best: Player | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      // Ignore players far from the arena centre
      const distFromArena = Math.hypot(t.x - this.arenaCenterPx.x, t.y - this.arenaCenterPx.y);
      if (distFromArena > aggroRange) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  /** Fraction of the stopped phase elapsed (0 = just stopped, 1 = resuming soon). */
  get stoppedFraction(): number {
    const total =
      STOPPED_FRAMES_MIN +
      (this.stoppedTimer > STOPPED_FRAMES_MIN ? STOPPED_FRAMES_MAX - STOPPED_FRAMES_MIN : 0);
    return 1 - this.stoppedTimer / total;
  }

  get burstFraction(): number {
    return 1 - this.burstTimer / BURST_FRAMES;
  }

  // --- Render ---

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive && !this.pendingBurst && this.state !== 'bursting') return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawBallOfSwineSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.orbitAngle,
      this.isStopped,
      this.state === 'bursting',
      this.burstFraction,
    );

    ctx.filter = 'none';
    ctx.restore();

    if (this.isStopped) {
      drawBallOfSwineStoppedWarning(ctx, sx, sy, tileSize, this.stoppedFraction);
    }

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
