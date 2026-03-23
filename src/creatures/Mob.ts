import { Player } from '../Player';
import { GameMap } from '../map/GameMap';
import type { ItemId } from '../core/ItemDefs';
import { randomInt } from '../utils';

export interface LootDrop {
  coins: number;
  items: Array<{ id: ItemId; quantity: number }>;
}

/**
 * Abstract base for all enemy mobs. Subclasses define their own AI, appearance,
 * and speed. `updateAI` is called every frame by the game loop.
 */
export abstract class Mob extends Player {
  protected speed: number;
  abstract readonly xpValue: number;

  /** The player this mob is currently chasing/attacking. Set each frame in updateAI. */
  currentTarget: Player | null = null;

  /** Tracks how much damage each player has dealt to this mob (for XP split). */
  readonly damageTakenBy: Map<Player, number> = new Map();

  /** Set to true on the frame this mob's HP reaches 0; game loop reads and resets it. */
  justDied = false;

  /** Loot generated when this mob dies; null if nothing dropped. */
  droppedLoot: LootDrop | null = null;

  /** Coin drop range — subclasses override with their own min/max. */
  protected coinDropMin = 0;
  protected coinDropMax = 0;

  /** Frames remaining to show the health bar (set on each hit). */
  healthBarTimer = 0;

  /** World-pixel position this mob spawned at — used to cap wander radius. */
  protected readonly spawnX: number;
  protected readonly spawnY: number;

  /** Last target position this mob had a clear LOS to — used for wall-aware navigation. */
  protected lastKnownTargetX = 0;
  protected lastKnownTargetY = 0;

  /** Cached A* waypoint list (tile coords). Followed by followTargetAStar. */
  private astarPath: Array<{ x: number; y: number }> = [];
  /** Frames until the A* path is recalculated. */
  private astarTimer = 0;

  /** Frames the mob has been fully stuck (both axes blocked) — triggers steering flip. */
  private stuckFrames = 0;
  /** +1 or -1: direction to rotate the movement vector when stuck. */
  private steerSign = 1;

  protected wanderTimer: number;
  protected wanderDx = 0;
  protected wanderDy = 0;

  protected map: GameMap | null = null;

  /** True for boss-tier mobs — used by DungeonScene to identify which mob belongs to which boss room. */
  isBoss = false;
  /** Set each frame by DungeonScene when this mob is inside an active confusing fog. */
  isConfused = false;

  /** Set each frame by BarrierSystem when this mob is adjacent to a placed barrier. */
  isSlowed = false;

  /**
   * When set to a live Mob, this mob will chase and attack it as a priority target.
   * Used so that Brindled Vespa acid hits cause enemy mobs to retaliate.
   * DungeonScene injects this mob into the mob's target list each frame.
   */
  retaliateMob: Mob | null = null;

  /** When true (set by DungeonScene for locked boss rooms), ignores aggro range. */
  forceAggro = false;

  /** Difficulty level of this mob instance (1 = base). Set by applyMobLevel(). */
  mobLevel = 1;

  /** Display name shown in hover tooltip. Subclasses should override. */
  displayName = 'Unknown';

  /** Short description shown in hover tooltip. Subclasses should override. */
  description = '';

  /** Whether this mob is currently hostile toward players. Defaults to true; override for neutral NPCs. */
  get isHostile(): boolean {
    return true;
  }

  /**
   * When true, the AI-controlled companion will flee from this mob instead of attacking it.
   * Override in subclasses for enemies that are temporarily untargetable or instakill on contact.
   */
  get avoidInstead(): boolean {
    return false;
  }

  /** The player who dealt the killing blow; set when hp reaches 0. */
  killedBy: Player | null = null;

  /** The type of attack that landed the killing blow. */
  killType: 'melee' | 'missile' | null = null;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp: number, speed: number) {
    super(tileX, tileY, tileSize, maxHp);
    this.speed = speed;
    this.spawnX = tileX * tileSize;
    this.spawnY = tileY * tileSize;
    this.lastKnownTargetX = this.spawnX;
    this.lastKnownTargetY = this.spawnY;
    // Stagger wander timers so mobs don't all change direction together
    this.wanderTimer = randomInt(0, 119);
  }

  /**
   * Scale this mob's stats for the given difficulty level.
   * Level 1 = base stats. Each level above 1 increases:
   *   HP:     +30% per level
   *   Speed:  +8% per level
   *   XP:     +25% per level
   *   Coins:  +25% per level
   * Damage is scaled via dealDamage() at +20% per level.
   */
  applyMobLevel(level: number) {
    if (level <= 1) return;
    this.mobLevel = level;
    const extra = level - 1;

    // HP
    const hpMult = 1 + extra * 0.3;
    this.maxHp = Math.ceil(this.maxHp * hpMult);
    this.hp = this.maxHp;

    // Speed
    this.speed = this.speed * (1 + extra * 0.08);

    // Coins
    this.coinDropMin = Math.ceil(this.coinDropMin * (1 + extra * 0.25));
    this.coinDropMax = Math.ceil(this.coinDropMax * (1 + extra * 0.25));
  }

  /** Returns XP value scaled by mob level. */
  get scaledXpValue(): number {
    if (this.mobLevel <= 1) return this.xpValue;
    return Math.ceil(this.xpValue * (1 + (this.mobLevel - 1) * 0.25));
  }

  /**
   * Deal level-scaled damage to a target. Mobs should call this instead of
   * target.takeDamage() directly so damage scales with mob level.
   */
  protected dealDamage(target: Player, baseDamage: number) {
    const mult = 1 + (this.mobLevel - 1) * 0.2;
    target.takeDamage(Math.ceil(baseDamage * mult));
  }

  setMap(map: GameMap) {
    this.map = map;
  }

  /** Returns true if this mob and `target` occupy the same map tile. */
  protected onSameTile(target: Player): boolean {
    const ts = this.tileSize;
    return (
      Math.floor((this.x + ts * 0.5) / ts) === Math.floor((target.x + ts * 0.5) / ts) &&
      Math.floor((this.y + ts * 0.5) / ts) === Math.floor((target.y + ts * 0.5) / ts)
    );
  }

  /** Clears the cached A* path so it is recomputed on the next followTargetAStar call. */
  protected clearAStarPath() {
    this.astarPath = [];
    this.astarTimer = 0;
  }

  /**
   * Wall-aware navigation using A* pathfinding. Recalculates the path to the
   * goal every `refreshInterval` frames, then steers toward each waypoint in
   * turn using moveWithCollision. Falls back to direct followTargetCollide
   * if no path can be found (e.g. goal is unreachable or cap exceeded).
   */
  protected followTargetAStar(
    targetPixelX: number,
    targetPixelY: number,
    speed: number,
    minDist: number,
    refreshInterval = 30,
  ) {
    if (!this.map) {
      this.followTargetCollide(targetPixelX, targetPixelY, speed, minDist);
      return;
    }
    const ts = this.tileSize;
    const goalTileX = Math.floor((targetPixelX + ts * 0.5) / ts);
    const goalTileY = Math.floor((targetPixelY + ts * 0.5) / ts);

    // Refresh path on a timer
    if (this.astarTimer <= 0) {
      const myTileX = Math.floor((this.x + ts * 0.5) / ts);
      const myTileY = Math.floor((this.y + ts * 0.5) / ts);
      this.astarPath = this.map.findPath(myTileX, myTileY, goalTileX, goalTileY);
      // Drop the first waypoint — that's the tile we're already on
      if (this.astarPath.length > 0) this.astarPath.shift();
      this.astarTimer = refreshInterval;
    } else {
      this.astarTimer--;
    }

    // Pop waypoints that are already close enough (within 0.55 tiles)
    while (this.astarPath.length > 0) {
      const wp = this.astarPath[0];
      if (Math.hypot(wp.x * ts - this.x, wp.y * ts - this.y) < ts * 0.55) {
        this.astarPath.shift();
      } else {
        break;
      }
    }

    if (this.astarPath.length > 0) {
      // Navigate toward the next waypoint; stop distance 0 for intermediate hops
      const wp = this.astarPath[0];
      this.followTargetCollide(wp.x * ts, wp.y * ts, speed, 0);
    } else {
      // End of path — close in with the real stop distance
      this.followTargetCollide(targetPixelX, targetPixelY, speed, minDist);
    }
  }

  /** True if there is a clear line of sight from this mob's centre to the target's centre. */
  protected hasLOS(target: Player): boolean {
    if (!this.map) return true;
    const ts = this.tileSize;
    return this.map.hasLineOfSight(
      this.x + ts * 0.5,
      this.y + ts * 0.5,
      target.x + ts * 0.5,
      target.y + ts * 0.5,
    );
  }

  /**
   * Records the target's current position as the last known location when LOS
   * is clear. Call each frame while a target is being chased.
   */
  protected updateLastKnown(target: Player) {
    if (this.hasLOS(target)) {
      this.lastKnownTargetX = target.x;
      this.lastKnownTargetY = target.y;
    }
  }

  /**
   * Moves by (dx, dy) with per-axis wall collision, mirroring the player's
   * movement so mobs can slide along walls instead of passing through them.
   */
  protected moveWithCollision(dx: number, dy: number) {
    if (!this.map) {
      this.x += dx;
      this.y += dy;
      return;
    }
    const ts = this.tileSize;
    if (dx !== 0) {
      const nextX = this.x + dx;
      const tileXnext =
        dx >= 0 ? Math.floor((nextX + ts * 0.72) / ts) : Math.floor((nextX + ts * 0.28) / ts);
      const tileYcur = Math.floor((this.y + ts / 2) / ts);
      if (this.map.isWalkable(tileXnext, tileYcur)) this.x = nextX;
    }
    if (dy !== 0) {
      const nextY = this.y + dy;
      const tileXcur = Math.floor((this.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY + ts / 2) / ts);
      if (this.map.isWalkable(tileXcur, tileYnext)) this.y = nextY;
    }
  }

  /**
   * Wall-aware equivalent of Player.followTarget. Updates facing direction and
   * uses moveWithCollision so the mob slides along walls while chasing.
   * When fully stuck (both axes blocked), rotates the movement vector ±90° to
   * steer around corners. Flips steering direction after 50 stuck frames.
   */
  protected followTargetCollide(targetX: number, targetY: number, speed: number, minDist: number) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      this.isMoving = false;
      return;
    }
    const effectiveSpeed = this.isSlowed ? speed * 0.35 : speed;
    const step = Math.min(effectiveSpeed, dist - minDist);
    const nx = dx / dist;
    const ny = dy / dist;
    this.facingX = nx;
    this.facingY = ny;

    const preX = this.x;
    const preY = this.y;
    this.moveWithCollision(nx * step, ny * step);

    if (this.x === preX && this.y === preY) {
      // Fully stuck — try perpendicular steering direction
      const perpX = -ny * this.steerSign;
      const perpY = nx * this.steerSign;
      this.moveWithCollision(perpX * step, perpY * step);
      if (this.x === preX && this.y === preY) {
        this.stuckFrames++;
        if (this.stuckFrames > 50) {
          this.steerSign *= -1;
          this.stuckFrames = 0;
        }
      } else {
        this.stuckFrames = 0;
      }
    } else {
      this.stuckFrames = 0;
    }

    this.isMoving = true;
  }

  /**
   * Deal damage and attribute it to an attacker for kill-credit / XP tracking.
   * Also triggers the damage flash and shows the health bar.
   */
  takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' = 'melee',
  ) {
    const prev = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    const actual = prev - this.hp;
    if (actual > 0) {
      this.damageFlash = 8;
      this.healthBarTimer = 180; // show health bar for ~3 seconds
      if (attacker) {
        this.damageTakenBy.set(attacker, (this.damageTakenBy.get(attacker) ?? 0) + actual);
      }
    }
    if (this.hp === 0 && prev > 0) {
      this.justDied = true;
      this.killedBy = attacker;
      this.killType = damageType;
      // Roll loot
      const coins = randomInt(this.coinDropMin, this.coinDropMax);
      const items = this.rollLootItems(attacker);
      if (coins > 0 || items.length > 0) {
        this.droppedLoot = { coins, items };
      }
    }
  }

  /**
   * Generates the item portion of this mob's loot drop.
   * Subclasses may override to add extra drops based on who killed them.
   */
  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    void killer; // available for subclasses
    const items: LootDrop['items'] = [];
    if (Math.random() < 0.25) items.push({ id: 'health_potion', quantity: 1 });
    if (Math.random() < 0.05) items.push({ id: 'scroll_of_confusing_fog', quantity: 1 });
    return items;
  }

  /** Extends Player.tickTimers to also decrement the health bar visibility timer. */
  tickTimers() {
    super.tickTimers();
    if (this.healthBarTimer > 0) this.healthBarTimer--;
  }

  /**
   * Idle wandering: picks a random direction every ~2 s, slowly moves within
   * a 4-tile radius of the spawn point.
   */
  doWander() {
    if (this.wanderTimer > 0) {
      this.wanderTimer--;
    } else {
      if (Math.random() < 0.3) {
        // Pause for a moment
        this.wanderDx = 0;
        this.wanderDy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.wanderDx = Math.cos(angle) * this.speed * 0.35;
        this.wanderDy = Math.sin(angle) * this.speed * 0.35;
      }
      this.wanderTimer = randomInt(90, 219);
    }

    if (this.wanderDx !== 0 || this.wanderDy !== 0) {
      // Pull back toward spawn if too far
      const dx = this.spawnX - this.x;
      const dy = this.spawnY - this.y;
      const distToSpawn = Math.hypot(dx, dy);
      const MAX_WANDER_PX = this.tileSize * 4;
      if (distToSpawn > MAX_WANDER_PX) {
        const nx = dx / distToSpawn;
        const ny = dy / distToSpawn;
        this.wanderDx = nx * this.speed * 0.4;
        this.wanderDy = ny * this.speed * 0.4;
      }
      this.moveWithCollision(this.wanderDx, this.wanderDy);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  /**
   * Renders the health bar only while it is visible (after taking damage).
   * Fades out over the last 40 frames.
   */
  protected renderMobHealthBar(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.healthBarTimer <= 0 && !this.hasStatus('sepsis')) return;
    if (this.healthBarTimer > 0) {
      const alpha = this.healthBarTimer < 40 ? this.healthBarTimer / 40 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.renderHealthBar(ctx, sx, sy);
      ctx.restore();
    }
    this.renderMobStatusLabels(ctx, sx, sy);
  }

  /** Renders status labels (e.g. "Septic") above the mob. */
  private renderMobStatusLabels(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (!this.hasStatus('sepsis')) return;
    const t = Date.now();
    const pulse = 0.7 + 0.3 * Math.sin(t * 0.006);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#bef264';
    ctx.shadowColor = '#65a30d';
    ctx.shadowBlur = 4;
    ctx.fillText('Septic', sx + this.tileSize * 0.5, sy - 12);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.restore();
    // Render sepsis bubbles above mob
    this.renderStatusEffects(ctx, sx, sy);
  }

  abstract updateAI(targets: Player[]): void;
}
