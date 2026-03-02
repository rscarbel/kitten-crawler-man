import { Player } from '../Player';

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

  /** Frames remaining to show the health bar (set on each hit). */
  healthBarTimer = 0;

  /** World-pixel position this mob spawned at — used to cap wander radius. */
  protected readonly spawnX: number;
  protected readonly spawnY: number;

  protected wanderTimer: number;
  protected wanderDx = 0;
  protected wanderDy = 0;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp: number, speed: number) {
    super(tileX, tileY, tileSize, maxHp);
    this.speed = speed;
    this.spawnX = tileX * tileSize;
    this.spawnY = tileY * tileSize;
    // Stagger wander timers so mobs don't all change direction together
    this.wanderTimer = Math.floor(Math.random() * 120);
  }

  /**
   * Deal damage and attribute it to an attacker for kill-credit / XP tracking.
   * Also triggers the damage flash and shows the health bar.
   */
  takeDamageFrom(amount: number, attacker: Player | null) {
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
    }
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
  protected doWander() {
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
      this.wanderTimer = 90 + Math.floor(Math.random() * 130);
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
      this.x += this.wanderDx;
      this.y += this.wanderDy;
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
    if (this.healthBarTimer <= 0) return;
    const alpha = this.healthBarTimer < 40 ? this.healthBarTimer / 40 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.renderHealthBar(ctx, sx, sy);
    ctx.restore();
  }

  abstract updateAI(targets: Player[]): void;
}
