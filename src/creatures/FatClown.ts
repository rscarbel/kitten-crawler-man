import { Mob } from './Mob';
import type { Player } from '../Player';
import {
  drawFatClownSprite,
  type FatClownAnimation,
  IDLE_LOOP_SECONDS,
} from '../sprites/fatClownSprite';
import { PLAYER_SPEED } from '../core/constants';

const CLOWN_HP = 30;
const CLOWN_SPEED = 0.7;
/** A levelled clown's walk is capped at this fraction of the player's. */
const CLOWN_MAX_SPEED_RATIO = 0.8;
export const CLOWN_MAX_SPEED = PLAYER_SPEED * CLOWN_MAX_SPEED_RATIO;
const AGGRO_RANGE_TILES = 6;
const ATTACK_RANGE_TILES = 1.2;
const ATTACK_DAMAGE = 10;
/** Frames between slams (~1.8 s at 60 fps). */
const ATTACK_COOLDOWN = 110;
/** Frames the slam animation plays. */
const ATTACK_ANIM_FRAMES = 30;
/**
 * Point in the slam row where the shoulder drives through — matches
 * `SLAM_WINDUP_END` in scripts/generate-clown-sprites.ts.
 */
const IMPACT_ANIM_PROGRESS = 0.35;
/** The countdown value {@link ATTACK_ANIM_FRAMES} reaches at that moment. */
const IMPACT_TIMER_FRAME = Math.round(ATTACK_ANIM_FRAMES * (1 - IMPACT_ANIM_PROGRESS));
const COIN_DROP_MIN = 1;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/**
 * The sheet's tile sits 76px down a 160px frame at a 64px tile scale, so the
 * art reaches a little over one tile above the tile it stands on.
 */
const CULL_MARGIN_TILES = 2;

/**
 * A Fat Clown — one of Grimaldi's corrupted performers, tanky and slow with
 * a heavy shoulder-slam attack. The circus questline's bread-and-butter bruiser.
 */
export class FatClown extends Mob {
  readonly xpValue = 20;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Fat Clown';
  description = 'A bloated, corrupted circus performer that slams into prey.';
  override readonly audioTag = 'clown';

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  protected override get levelledSpeedCap(): number {
    return CLOWN_MAX_SPEED;
  }

  /** Staggers this clown's idle loop so a pack of them does not move as one. */
  private readonly idlePhaseOffsetSeconds = Math.random() * IDLE_LOOP_SECONDS;

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CLOWN_HP, CLOWN_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.clearAStarPath();
      // `returnHomeOrWander`, not `doWander`: this class is reused as a bounty
      // encounter's escort, and only the former honours the `homePoint` the
      // BountySystem anchors the encounter to its site with. With no home set it
      // is exactly `doWander`, so the circus spawns are unchanged.
      this.returnHomeOrWander();
      return;
    }

    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (nearestDist > attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    // The slam plays out while stopped and nothing else writes facing then.
    // Held still mid-slam so the swing cannot flip halfway through.
    if (nearestDist <= attackRangePx && this.attackAnimTimer === 0) {
      this.faceToward(nearest);
    }

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }

    // The slam only connects once the shoulder has actually swung through, so
    // the hit lands mid-animation rather than on the frame the windup starts.
    if (this.attackAnimTimer === IMPACT_TIMER_FRAME && nearestDist <= attackRangePx) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
    }
  }

  private animation(): FatClownAnimation {
    if (this.attackAnimTimer > 0) {
      return { kind: 'slam', progress: 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES };
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

    drawFatClownSprite(ctx, sx, sy, tileSize, this.facingX, this.animation());

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
