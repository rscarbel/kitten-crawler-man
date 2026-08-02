import { Mob } from './Mob';
import type { Player } from '../Player';
import {
  drawStiltClownSprite,
  type StiltClownAnimation,
  IDLE_LOOP_SECONDS,
} from '../sprites/stiltClownSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const CLOWN_HP = 14;
const CLOWN_SPEED = 0.9;
const AGGRO_RANGE_TILES = 8;
/** Long reach — the stilt clown's signature "Slender Man" lunge. */
const ATTACK_RANGE_TILES = 2.2;
const ATTACK_DAMAGE = 7;
/** Frames between lunges (~2.2 s at 60 fps) — slow but telegraphed and punishing. */
const ATTACK_COOLDOWN = 130;
/** Frames of windup before every strike (not just the first) — sells the "telegraphed lunge" read. */
const WINDUP_FRAMES = 32;
/** Frames the lunge/strike animation plays after windup completes. */
const LUNGE_FRAMES = 18;
const COIN_DROP_MAX = 2;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.75;
/**
 * The sheet's tile sits 140px down a 224px frame at a 64px tile scale, so the
 * stilts and head reach well over two tiles above the tile it stands on.
 */
const CULL_MARGIN_TILES = 3;

/**
 * A Stilt Clown — one of Grimaldi's corrupted performers, towering on
 * spindly stilt legs with a long-reaching, telegraphed lunging strike.
 */
export class StiltClown extends Mob {
  readonly xpValue = 14;
  protected coinDropMin = 0;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Stilt Clown';
  description = 'A towering, spindly-limbed circus horror stalking on stilts.';
  override readonly audioTag = 'clown';

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  /** Staggers this clown's idle loop so a pack of them does not move as one. */
  private readonly idlePhaseOffsetSeconds = Math.random() * IDLE_LOOP_SECONDS;

  private attackCooldown = 0;
  private windupTimer = 0;
  private lungeTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CLOWN_HP, CLOWN_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.windupTimer = 0;
    this.lungeTimer = 0;
    this.isAggro = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || dist < aggroScanRange) && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.windupTimer = 0;
      this.lungeTimer = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    // Hold still while winding up or mid-lunge — the strike itself is stationary.
    if (this.windupTimer > 0 || this.lungeTimer > 0) {
      this.isMoving = false;
    } else if (nearestDist > attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    const inRange = nearestDist <= attackRangePx;
    // The windup and the lunge are both stationary, so this is the only thing
    // that points the strike at anything. Held still once it is under way.
    if (inRange && this.windupTimer === 0 && this.lungeTimer === 0) {
      this.faceToward(nearest);
    }

    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.windupTimer === 0 &&
      this.lungeTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.windupTimer = WINDUP_FRAMES;
      this.attackCooldown = ATTACK_COOLDOWN;
    }

    if (this.windupTimer > 0) {
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.lungeTimer = LUNGE_FRAMES;
        if (nearestDist <= attackRangePx) {
          this.dealDamage(nearest, ATTACK_DAMAGE);
        }
      }
    } else if (this.lungeTimer > 0) {
      this.lungeTimer--;
    }
  }

  private animation(): StiltClownAnimation {
    if (this.windupTimer > 0) {
      return { kind: 'windup', progress: 1 - this.windupTimer / WINDUP_FRAMES };
    }
    if (this.lungeTimer > 0) {
      return { kind: 'lunge', progress: 1 - this.lungeTimer / LUNGE_FRAMES };
    }
    if (this.isMoving) return { kind: 'walk', cycle: this.walkFrame };
    return { kind: 'idle', phaseOffsetSeconds: this.idlePhaseOffsetSeconds };
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawStiltClownSprite(ctx, sx, sy, tileSize, this.facingX, this.animation());

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
