import { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { ItemId } from '../core/ItemDefs';
import { randomInt } from '../utils';
import { drawText } from '../ui/TextBox';

/** Stagger range for initial wander timer so mobs don't change direction together. */
const WANDER_TIMER_STAGGER_MAX = 119;

/** Per-level HP scaling multiplier increment (+30% per level above 1). */
const MOB_LEVEL_HP_SCALE = 0.3;
/** Per-level speed scaling multiplier increment (+8% per level above 1). */
const MOB_LEVEL_SPEED_SCALE = 0.08;
/** Per-level coin scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_COIN_SCALE = 0.25;
/** Per-level XP scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_XP_SCALE = 0.25;
/** Per-level damage scaling multiplier increment (+20% per level). */
const MOB_LEVEL_DAMAGE_SCALE = 0.2;

/** Fraction of tile for center offset used in same-tile and LOS checks. */
const MOB_TILE_CENTER = 0.5;

/** Waypoint proximity threshold: pop when within this fraction of a tile. */
const ASTAR_WAYPOINT_CLOSE_FRACTION = 0.55;

/** Default A* path refresh interval in frames. */
const ASTAR_DEFAULT_REFRESH = 30;

/** How many stuck frames before flipping the perpendicular steer direction. */
const STUCK_FLIP_FRAMES = 50;

/** Speed multiplier while mob is slowed. */
const MOB_SLOWED_SPEED_FRACTION = 0.35;

/** Tile edge fractions for wall collision (leading edge ahead/behind). */
const MOB_COLLISION_FRONT_FRACTION = 0.72;
const MOB_COLLISION_BACK_FRACTION = 0.28;

/** Frames to show the health bar after taking damage (~3 seconds at 60 fps). */
const HEALTH_BAR_VISIBLE_FRAMES = 180;
/** Frame count for damage flash. */
const MOB_DAMAGE_FLASH_FRAMES = 8;
/** Frames at which health bar starts fading out. */
const HEALTH_BAR_FADE_FRAMES = 40;

/** Wander: probability of pausing instead of walking. */
const WANDER_PAUSE_CHANCE = 0.3;
/** Wander: speed fraction for random direction walks. */
const WANDER_SPEED_FRACTION = 0.35;
/** Wander: timer range between direction changes (frames). */
const WANDER_TIMER_MIN = 90;
const WANDER_TIMER_MAX = 219;
/** Wander: max radius from spawn before pulling back. */
const WANDER_MAX_RADIUS_TILES = 4;
/** Wander: speed fraction for pull-back-to-spawn movement. */
const WANDER_PULLBACK_SPEED_FRACTION = 0.4;

/** Default health potion drop chance. */
const DEFAULT_POTION_DROP_CHANCE = 0.25;
/** Default scroll of confusing fog drop chance. */
const DEFAULT_FOG_SCROLL_DROP_CHANCE = 0.05;
/** Speed Fizz drop chance from mobs (very rare — primary source is chests). */
const SPEED_FIZZ_DROP_CHANCE = 0.005;
/** Jugg Juice drop chance from mobs (very rare — primary source is chests). */
const JUGG_JUICE_DROP_CHANCE = 0.005;
/** Cooldown Crisp drop chance from mobs (very rare — primary source is chests). */
const COOLDOWN_CRISP_DROP_CHANCE = 0.003;
/** Stat Boost Potion drop chance from mobs (extremely rare — primary source is chests). */
const STAT_BOOST_DROP_CHANCE = 0.001;

/** Aggro indicator font size. */
const AGGRO_INDICATOR_FONT_SIZE = 18;
/** Aggro indicator stroke line width. */
const AGGRO_INDICATOR_LINE_WIDTH = 3;
/** Aggro indicator Y offset above mob. */
const AGGRO_INDICATOR_Y_OFFSET = 3;

/** Septic label Y offset above health bar. */
const SEPTIC_LABEL_Y_OFFSET = 12;
/** Septic label secondary Y offset. */
const SEPTIC_LABEL_Y2_OFFSET = 7;
/** Septic label font size. */
const SEPTIC_LABEL_SIZE = 9;
/** Septic pulse amplitude (fraction added to base brightness). */
const SEPTIC_PULSE_AMP = 0.3;
/** Septic pulse base brightness. */
const SEPTIC_PULSE_BASE = 0.7;
/** Septic pulse oscillation speed. */
const SEPTIC_PULSE_SPEED = 0.006;

/** Minimal shell API exposed to mobs — avoids a circular import with SpellSystem. */
export interface ShellContext {
  isPointInsideShell(cx: number, cy: number): boolean;
  addBlockXp(amount: number): void;
}

export interface LootDrop {
  coins: number;
  items: Array<{ id: ItemId; quantity: number }>;
  goldDoubled?: boolean;
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
  readonly damageTakenBy = new Map<Player, number>();

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

  /** Shell context injected by DungeonScene — used by subclasses to check shell state. */
  protected spells: ShellContext | null = null;

  /** True for boss-tier mobs — used by DungeonScene to identify which mob belongs to which boss room. */
  isBoss = false;
  /** Set each frame by DungeonScene when this mob is inside an active confusing fog. */
  isConfused = false;

  /** Set each frame by BarrierSystem when this mob is adjacent to a placed barrier. */
  isSlowed = false;

  /** True for airborne mobs that pass over ground mobs without physical collision. */
  isFlying = false;

  /**
   * Physical mass used for separation weighting. Heavier mobs move less when bumped.
   * Cockroaches (0.3) barely disturb anything; bosses (10) are nearly immovable.
   */
  mass = 1;

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

  /** Key into BodyPartGoreSystem's registry; null means no body-part gore for this mob. */
  readonly bodyPartKey: string | null = null;

  /** Short description shown in hover tooltip. Subclasses should override. */
  description = '';

  /** Sound category key for attack audio (e.g. 'goblin', 'rat', 'llama'). Empty string = no sound. */
  readonly audioTag: string = '';

  /** Set to true when this mob deals damage; polled and cleared by the scene each frame. */
  attackSoundPending = false;

  /** Set to true when this mob fires a projectile; polled and cleared by the scene each frame. */
  projectileSoundPending = false;

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

  /**
   * When true, the AI-controlled companion uses evasive movement (orbiting/circling)
   * instead of standing still while fighting this mob. Set this on enemies whose attacks
   * are telegraphed and dodgeable so the companion automatically sidesteps.
   */
  get requiresEvasion(): boolean {
    return false;
  }

  /** Whether this mob is currently in an enraged state. Subclasses (e.g. Juicer) set this. */
  isEnraged?: boolean;

  /** The player who dealt the killing blow; set when hp reaches 0. */
  killedBy: Player | null = null;

  /** The type of attack that landed the killing blow. */
  killType: 'melee' | 'missile' | 'shell' | 'smush' | null = null;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp: number, speed: number) {
    super(tileX, tileY, tileSize, maxHp);
    this.speed = speed;
    this.spawnX = tileX * tileSize;
    this.spawnY = tileY * tileSize;
    this.lastKnownTargetX = this.spawnX;
    this.lastKnownTargetY = this.spawnY;
    // Stagger wander timers so mobs don't all change direction together
    this.wanderTimer = randomInt(0, WANDER_TIMER_STAGGER_MAX);
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
    const hpMult = 1 + extra * MOB_LEVEL_HP_SCALE;
    this.maxHp = Math.ceil(this.maxHp * hpMult);
    this.hp = this.maxHp;

    // Speed
    this.speed = this.speed * (1 + extra * MOB_LEVEL_SPEED_SCALE);

    // Coins
    this.coinDropMin = Math.ceil(this.coinDropMin * (1 + extra * MOB_LEVEL_COIN_SCALE));
    this.coinDropMax = Math.ceil(this.coinDropMax * (1 + extra * MOB_LEVEL_COIN_SCALE));
  }

  /** Returns XP value scaled by mob level. */
  get scaledXpValue(): number {
    if (this.mobLevel <= 1) return this.xpValue;
    return Math.ceil(this.xpValue * (1 + (this.mobLevel - 1) * MOB_LEVEL_XP_SCALE));
  }

  /**
   * Deal level-scaled damage to a target. Mobs should call this instead of
   * target.takeDamage() directly so damage scales with mob level.
   */
  protected dealDamage(target: Player, baseDamage: number) {
    const mult = 1 + (this.mobLevel - 1) * MOB_LEVEL_DAMAGE_SCALE;
    target.takeDamage(Math.ceil(baseDamage * mult));
    this.attackSoundPending = true;
  }

  setMap(map: GameMap) {
    this.map = map;
  }

  setSpells(s: ShellContext): void {
    this.spells = s;
  }

  /** Returns true if this mob and `target` occupy the same map tile. */
  protected onSameTile(target: Player): boolean {
    const ts = this.tileSize;
    return (
      Math.floor((this.x + ts * MOB_TILE_CENTER) / ts) ===
        Math.floor((target.x + ts * MOB_TILE_CENTER) / ts) &&
      Math.floor((this.y + ts * MOB_TILE_CENTER) / ts) ===
        Math.floor((target.y + ts * MOB_TILE_CENTER) / ts)
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
    refreshInterval = ASTAR_DEFAULT_REFRESH,
  ) {
    if (!this.map) {
      this.followTargetCollide(targetPixelX, targetPixelY, speed, minDist);
      return;
    }
    const ts = this.tileSize;
    const goalTileX = Math.floor((targetPixelX + ts * MOB_TILE_CENTER) / ts);
    const goalTileY = Math.floor((targetPixelY + ts * MOB_TILE_CENTER) / ts);

    // Refresh path on a timer
    if (this.astarTimer <= 0) {
      const myTileX = Math.floor((this.x + ts * MOB_TILE_CENTER) / ts);
      const myTileY = Math.floor((this.y + ts * MOB_TILE_CENTER) / ts);
      this.astarPath = this.map.findPath(myTileX, myTileY, goalTileX, goalTileY);
      // Drop the first waypoint — that's the tile we're already on
      if (this.astarPath.length > 0) this.astarPath.shift();
      this.astarTimer = refreshInterval;
    } else {
      this.astarTimer--;
    }

    // Pop waypoints that are already close enough
    while (this.astarPath.length > 0) {
      const wp = this.astarPath[0];
      if (Math.hypot(wp.x * ts - this.x, wp.y * ts - this.y) < ts * ASTAR_WAYPOINT_CLOSE_FRACTION) {
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
      this.x + ts * MOB_TILE_CENTER,
      this.y + ts * MOB_TILE_CENTER,
      target.x + ts * MOB_TILE_CENTER,
      target.y + ts * MOB_TILE_CENTER,
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
        dx >= 0
          ? Math.floor((nextX + ts * MOB_COLLISION_FRONT_FRACTION) / ts)
          : Math.floor((nextX + ts * MOB_COLLISION_BACK_FRACTION) / ts);
      const tileYcur = Math.floor((this.y + ts / 2) / ts);
      if (
        this.map.isWalkable(tileXnext, tileYcur) &&
        !this.map.isStairwellTile(tileXnext, tileYcur)
      )
        this.x = nextX;
    }
    if (dy !== 0) {
      const nextY = this.y + dy;
      const tileXcur = Math.floor((this.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY + ts / 2) / ts);
      if (
        this.map.isWalkable(tileXcur, tileYnext) &&
        !this.map.isStairwellTile(tileXcur, tileYnext)
      )
        this.y = nextY;
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
    const effectiveSpeed = this.isSlowed ? speed * MOB_SLOWED_SPEED_FRACTION : speed;
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
        if (this.stuckFrames > STUCK_FLIP_FRAMES) {
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
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ) {
    const prev = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    const actual = prev - this.hp;
    if (actual > 0) {
      this.damageFlash = MOB_DAMAGE_FLASH_FRAMES;
      this.healthBarTimer = HEALTH_BAR_VISIBLE_FRAMES;
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
    if (Math.random() < DEFAULT_POTION_DROP_CHANCE)
      items.push({ id: 'health_potion', quantity: 1 });
    if (Math.random() < DEFAULT_FOG_SCROLL_DROP_CHANCE)
      items.push({ id: 'scroll_of_confusing_fog', quantity: 1 });
    if (Math.random() < SPEED_FIZZ_DROP_CHANCE) items.push({ id: 'speed_fizz', quantity: 1 });
    if (Math.random() < JUGG_JUICE_DROP_CHANCE) items.push({ id: 'jugg_juice', quantity: 1 });
    if (Math.random() < COOLDOWN_CRISP_DROP_CHANCE)
      items.push({ id: 'cooldown_crisp', quantity: 1 });
    if (Math.random() < STAT_BOOST_DROP_CHANCE)
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    return items;
  }

  /** Extends Player.tickTimers to also decrement the health bar visibility timer. */
  tickTimers() {
    super.tickTimers();
    if (this.healthBarTimer > 0) this.healthBarTimer--;
    if (this.hasStatus('electrified')) this.isSlowed = true;
  }

  /**
   * Idle wandering: picks a random direction every ~2 s, slowly moves within
   * a 4-tile radius of the spawn point.
   */
  doWander() {
    if (this.wanderTimer > 0) {
      this.wanderTimer--;
    } else {
      if (Math.random() < WANDER_PAUSE_CHANCE) {
        // Pause for a moment
        this.wanderDx = 0;
        this.wanderDy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.wanderDx = Math.cos(angle) * this.speed * WANDER_SPEED_FRACTION;
        this.wanderDy = Math.sin(angle) * this.speed * WANDER_SPEED_FRACTION;
      }
      this.wanderTimer = randomInt(WANDER_TIMER_MIN, WANDER_TIMER_MAX);
    }

    if (this.wanderDx !== 0 || this.wanderDy !== 0) {
      // Pull back toward spawn if too far
      const dx = this.spawnX - this.x;
      const dy = this.spawnY - this.y;
      const distToSpawn = Math.hypot(dx, dy);
      const MAX_WANDER_PX = this.tileSize * WANDER_MAX_RADIUS_TILES;
      if (distToSpawn > MAX_WANDER_PX) {
        const nx = dx / distToSpawn;
        const ny = dy / distToSpawn;
        this.wanderDx = nx * this.speed * WANDER_PULLBACK_SPEED_FRACTION;
        this.wanderDy = ny * this.speed * WANDER_PULLBACK_SPEED_FRACTION;
      }
      this.moveWithCollision(this.wanderDx, this.wanderDy);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  protected renderAggroIndicator(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ) {
    ctx.save();
    ctx.font = `bold ${AGGRO_INDICATOR_FONT_SIZE}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = AGGRO_INDICATOR_LINE_WIDTH;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText('!', sx + tileSize / 2, sy - AGGRO_INDICATOR_Y_OFFSET);
    ctx.fillStyle = 'rgba(239, 68, 68, 1)';
    ctx.fillText('!', sx + tileSize / 2, sy - AGGRO_INDICATOR_Y_OFFSET);
    ctx.restore();
  }

  /**
   * Renders the health bar only while it is visible (after taking damage).
   * Fades out over the last 40 frames.
   */
  protected renderMobHealthBar(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.healthBarTimer <= 0 && !this.hasStatus('sepsis')) return;
    if (this.healthBarTimer > 0) {
      const alpha =
        this.healthBarTimer < HEALTH_BAR_FADE_FRAMES
          ? this.healthBarTimer / HEALTH_BAR_FADE_FRAMES
          : 1;
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
    const pulse = SEPTIC_PULSE_BASE + SEPTIC_PULSE_AMP * Math.sin(t * SEPTIC_PULSE_SPEED);
    drawText(ctx, 'Septic', {
      x: sx + this.tileSize * MOB_TILE_CENTER,
      y: sy - SEPTIC_LABEL_Y_OFFSET - SEPTIC_LABEL_Y2_OFFSET,
      size: SEPTIC_LABEL_SIZE,
      bold: true,
      color: '#bef264',
      align: 'center',
      alpha: pulse,
      outline: '#65a30d',
      outlineWidth: 2,
    });
    // Render sepsis bubbles above mob
    this.renderStatusEffects(ctx, sx, sy);
  }

  applySeparation(dx: number, dy: number): void {
    this.moveWithCollision(dx, dy);
  }

  abstract updateAI(targets: Player[]): void;
}
