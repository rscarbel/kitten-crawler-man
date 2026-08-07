import type { Player } from '../Player';
import { Mob } from './Mob';
import { LLAMA_BODY_PART_KEY, drawLlamaSprite } from '../sprites/llamaSprite';
import { LLAMA_SPIT_FRAMES, llamaSpitReleaseFrame } from '../sprites/llamaSpitTiming';
import type { LavaSpit } from '../systems/LavaBallSystem';

const LLAMA_HP = 10;
const LLAMA_SPEED = 1.0;
const AGGRO_RANGE_TILES = 8;
/** Llamas keep their distance and spit from afar */
const SPIT_RANGE_TILES = 5.5;
/** Frames between spits (~2.5 s at 60 fps) */
const SPIT_COOLDOWN = 150;
const LAVA_BALL_DAMAGE = 2;
const COIN_DROP_MIN = 4;
const COIN_DROP_MAX = 5;
const CENTER_OFFSET = 0.5;
/** An even coin flip, for picking which side to sidestep to. */
const HALF = 0.5;
const MOUTH_OFFSET_X = 0.22;
const MOUTH_OFFSET_Y = 0.22;
const FOLLOW_STOP_RANGE_TILES = 1.5;
const FOLLOW_CLOSE_RANGE_RATIO = 0.85;

/**
 * The level at which a llama starts working the ground between shots.
 *
 * Gated rather than universal so floor 1's opening llamas — the first ranged
 * enemy a crawler meets — stay the stationary target they are today, and the
 * behaviour arrives as something the player notices the animal *learning*.
 */
const EVASIVE_MIN_LEVEL = 4;

/** Tiles a llama sidesteps perpendicular to its shot after taking it. */
const STRAFE_MIN_TILES = 1;
const STRAFE_MAX_TILES = 2;

/** Closer than this and the llama gives ground rather than firing point-blank. */
const RETREAT_TRIGGER_TILES = 2.5;
/** How far it tries to open the gap back up to. */
const RETREAT_TARGET_TILES = 4;
/**
 * Ceiling on a single retreat, in frames, and the wait before another may start.
 *
 * Both exist for the same reason: a llama that can always open the gap is a
 * llama that can never be caught, which is the frustrating version of this
 * behaviour rather than the pressuring one. Backing off is something it gets to
 * do once per exchange, not a permanent state.
 */
const RETREAT_MAX_FRAMES = 60;
const RETREAT_COOLDOWN_FRAMES = 180;

/**
 * The value `spitAnimTimer` holds on the release frame.
 *
 * The timer counts *down*, so it is the animation's length minus the elapsed
 * frame the shared timing module names.
 */
const SPIT_RELEASE_TIMER = LLAMA_SPIT_FRAMES - llamaSpitReleaseFrame();

export class Llama extends Mob {
  readonly xpValue = 8;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'llama';
  override readonly bodyPartKey = LLAMA_BODY_PART_KEY;
  displayName = 'Lava Llama';
  description = 'Spits balls of molten rock from a distance.';
  private spitCooldown = 0;
  private spitAnimTimer = 0;
  /**
   * Shots fired but not yet handed to `LavaBallSystem`, which drains this every
   * frame. The llama never owns a ball in flight: it stops being updated and
   * drawn the instant it dies, and a projectile stored here would be deleted
   * in mid-air along with it.
   */
  private pendingSpits: LavaSpit[] = [];

  override clearAirborneAttacks(): void {
    this.pendingSpits = [];
  }
  private aggroRangePx: number;
  private spitRangePx: number;
  private isAggro = false;
  /** Frames left in the current sidestep, and the direction it runs in. */
  private strafeFrames = 0;
  private strafeDirX = 0;
  private strafeDirY = 0;
  /** Set on the release frame; the sidestep itself waits for the animation to finish. */
  private strafeQueued = false;
  /** Frames left in the current backpedal, and the wait before another may start. */
  private retreatFrames = 0;
  private retreatCooldown = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LLAMA_HP, LLAMA_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.spitRangePx = tileSize * SPIT_RANGE_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.spitCooldown = 0;
    this.spitAnimTimer = 0;
    this.pendingSpits = [];
    this.isAggro = false;
    this.strafeFrames = 0;
    this.strafeQueued = false;
    this.retreatFrames = 0;
    this.retreatCooldown = 0;
  }

  /** Whether this llama is experienced enough to move between shots. */
  private get isEvasive(): boolean {
    return this.mobLevel >= EVASIVE_MIN_LEVEL;
  }

  /**
   * Hands over every shot fired since the last call and clears the queue.
   *
   * Returning the array wholesale rather than one at a time is deliberate: the
   * caller must be able to drain a llama that has since died, and a
   * pull-one-per-frame interface would strand the rest.
   */
  takePendingSpits(): readonly LavaSpit[] {
    if (this.pendingSpits.length === 0) return EMPTY_SPITS;
    const spits = this.pendingSpits;
    this.pendingSpits = [];
    return spits;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.spitCooldown > 0) this.spitCooldown--;
    if (this.retreatCooldown > 0) this.retreatCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;

    // The wind-up runs to completion whatever happens to the target: it is the
    // player's warning that a shot is coming, and a llama that abandons it
    // mid-charge because the player stepped behind a pillar has told them a lie.
    //
    // It does keep tracking until the moment it commits, though. Facing locked
    // from the first frame of a 26-frame charge, a llama that a player simply
    // walks around fires at where they used to be — and worse, plays a
    // forward-facing spit while the ball leaves in the opposite direction.
    if (this.spitAnimTimer > 0) {
      this.spitAnimTimer--;
      this.isMoving = false;
      this.isAggro = nearest !== null;
      if (this.spitAnimTimer > SPIT_RELEASE_TIMER && nearest) this.faceToward(nearest);
      if (this.spitAnimTimer === SPIT_RELEASE_TIMER) this.releaseSpit();
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.strafeFrames = 0;
      this.strafeQueued = false;
      this.retreatFrames = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }
    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);

    // The sidestep is queued on the release frame and started here, once the
    // spit animation has played out — begun any earlier it would run underneath
    // the animation's own hold and be over before the llama finished spitting.
    if (this.strafeQueued) {
      this.strafeQueued = false;
      this.beginStrafe(nearest);
    }
    const isCrowded = nearestDist < this.tileSize * RETREAT_TRIGGER_TILES;
    if (this.isEvasive && isCrowded && this.retreatFrames === 0 && this.retreatCooldown === 0) {
      this.retreatFrames = RETREAT_MAX_FRAMES;
      this.retreatCooldown = RETREAT_COOLDOWN_FRAMES;
      this.strafeFrames = 0;
    }

    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;
    const mouth = this.mouthPosition();

    // Check line of sight from mouth to target centre
    const hasLOS = this.map ? this.map.hasLineOfSight(mouth.x, mouth.y, targetCX, targetCY) : true;

    // Track last known position while we have LOS
    if (hasLOS) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    // Movement: give ground first, then finish any sidestep, then the standing
    // behaviour — navigate toward last known pos when no LOS, hold when in range.
    if (this.retreatFrames > 0) {
      this.retreatFrames--;
      if (nearestDist >= this.tileSize * RETREAT_TARGET_TILES) {
        this.retreatFrames = 0;
        this.isMoving = false;
      } else {
        this.stepAwayFrom(nearest);
      }
    } else if (this.strafeFrames > 0) {
      this.strafeFrames--;
      this.stepInDirection(this.strafeDirX, this.strafeDirY);
    } else if (!hasLOS) {
      // No line of sight — navigate toward last known position to find a clear angle
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * FOLLOW_STOP_RANGE_TILES,
      );
    } else if (nearestDist > this.spitRangePx) {
      // Has LOS but too far — move closer
      this.followTargetAStar(
        nearest.x,
        nearest.y,
        this.speed,
        this.spitRangePx * FOLLOW_CLOSE_RANGE_RATIO,
      );
    } else {
      // In range with LOS — hold position
      this.isMoving = false;
    }

    // Nothing else points a stopped llama at anything, and spitting is the whole
    // of its combat: unfaced, it fires backwards for the entire engagement. Only
    // while stopped, though — a llama pathing round a corner has to face its
    // path, or it moonwalks the whole detour.
    if (!this.isMoving) this.faceToward(nearest);

    // Begin the wind-up. The ball itself is not created here — it leaves the
    // mouth partway through the animation, on the frame the neck whips forward.
    // Never mid-retreat: giving ground is a commitment, and a llama that fired
    // while backing away would make the retreat pure profit.
    const isGivingGround = this.retreatFrames > 0;
    if (!isGivingGround && hasLOS && nearestDist <= this.spitRangePx && this.spitCooldown === 0) {
      this.spitCooldown = this.scaledCooldownFrames(SPIT_COOLDOWN);
      this.spitAnimTimer = LLAMA_SPIT_FRAMES;
      this.strafeFrames = 0;
      this.isMoving = false;
    }
  }

  /**
   * Starts a sidestep across the shot the llama has just taken.
   *
   * Perpendicular to the target line rather than in a free direction, because
   * the point is to leave the spot the player has just been given the range of.
   * The side is a coin flip, so two llamas covering the same doorway do not
   * drift into each other's line.
   */
  private beginStrafe(target: Player): void {
    if (!this.isEvasive) return;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const side = Math.random() < HALF ? 1 : -1;
    this.strafeDirX = (-dy / distance) * side;
    this.strafeDirY = (dx / distance) * side;
    const tiles = STRAFE_MIN_TILES + Math.random() * (STRAFE_MAX_TILES - STRAFE_MIN_TILES);
    this.strafeFrames = Math.max(1, Math.round((tiles * this.tileSize) / this.speed));
  }

  /** One frame of walking directly away from `target`. */
  private stepAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.stepInDirection(dx / distance, dy / distance);
  }

  /**
   * One frame of walking along a unit direction, facing the way it walks.
   *
   * Facing matters as much as the movement: the sprite mirrors on `facingX`, so
   * a llama that kept aiming at the player while sidestepping would moonwalk the
   * whole way across.
   */
  private stepInDirection(dirX: number, dirY: number): void {
    this.facingX = dirX;
    this.facingY = dirY;
    this.moveWithCollision(dirX * this.speed, dirY * this.speed);
    this.isMoving = true;
  }

  /** Where the ball leaves the animal, offset toward whichever way it faces. */
  private mouthPosition(): { readonly x: number; readonly y: number } {
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + MOUTH_OFFSET_X * Math.sign(this.facingX || 1)),
      y: this.y + this.tileSize * MOUTH_OFFSET_Y,
    };
  }

  /**
   * Queues one shot, aimed at wherever the target is on the release frame
   * rather than where it was when the wind-up began — otherwise the telegraph
   * is free to dodge and the attack never lands on a moving player.
   */
  private releaseSpit(): void {
    const target = this.currentTarget;
    const mouth = this.mouthPosition();
    const aimX = target ? target.x + this.tileSize * CENTER_OFFSET : mouth.x + this.facingX;
    const aimY = target ? target.y + this.tileSize * CENTER_OFFSET : mouth.y + this.facingY;
    const dirX = aimX - mouth.x;
    const dirY = aimY - mouth.y;
    // A target standing exactly on the mouth would give a zero direction, which
    // normalises to NaN and produces a ball that never moves and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingSpits.push({
      x: mouth.x,
      y: mouth.y,
      dirX: degenerate ? this.facingX || 1 : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(LAVA_BALL_DAMAGE),
      mobType: this.mobType,
      // Carried unconditionally and deduplicated by the system: the interesting
      // case is a target that is neither player — a mob made hostile by Vespa
      // acid — which nothing else would tell the projectile about.
      mobLevel: this.mobLevel,
      aimedAt: target,
    });
    this.projectileSoundPending = true;
    this.strafeQueued = true;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    const spitProgress = this.spitAnimTimer > 0 ? 1 - this.spitAnimTimer / LLAMA_SPIT_FRAMES : null;

    drawLlamaSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      spitProgress,
    });

    this.renderMobHealthBar(ctx, sx, sy);
  }
}

/** Shared empty result so the common no-shots-this-frame path allocates nothing. */
const EMPTY_SPITS: readonly LavaSpit[] = [];
