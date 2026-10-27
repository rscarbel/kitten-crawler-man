import { Mob } from './Mob';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import { drawDireBearSprite, prewarmDireBear } from '../sprites/direBearSprite';
import {
  DIRE_BEAR_TILES_PER_WALK_CYCLE,
  DIRE_BEAR_WALK_FRAMES,
} from '../sprites/art/direBearFigure';

const DIRE_BEAR_HP = 65;
const DIRE_BEAR_SPEED = 0.55;
const DIRE_BEAR_DAMAGE = 3;

const AGGRO_RANGE_TILES = 9;
const ATTACK_RANGE_TILES = 1.4;
/** Frames between swipes (~2 s at 60 fps) — slow, heavy, telegraphed. */
const ATTACK_COOLDOWN = 120;
/** Frames the bear visibly rears up before the swipe lands — the dodge window. */
const ATTACK_WINDUP_FRAMES = 32;
const ATTACK_SWIPE_FRAMES = 14;
/** attackAnim value at the top of the rear-up; the swipe crosses the second half. */
const ATTACK_ANIM_WINDUP_PEAK = 0.5;
const FOLLOW_STOP_FRACTION = 0.75;
/** Frames between pain growls so every hit doesn't stack cries. */
const PAIN_GROWL_COOLDOWN = 90;
const COIN_DROP_MIN = 10;
const COIN_DROP_MAX = 18;
/**
 * The walk is advanced by the ground it actually covers, so its planted feet
 * stay put on the floor. Capped at one sprite frame per tick: past that the
 * row is undersampled and a separation shove would strobe its legs.
 */
const MAX_GAIT_RADIANS_PER_FRAME = (Math.PI * 2) / DIRE_BEAR_WALK_FRAMES;

/** Drawn only in profile, so facing the camera it still shows that profile. */
const DIRE_BEAR_EYES: EyePlacement = {
  sideForward: 0.9,
  sideHeight: 0.21,
  sideSpacing: 0.05,
  frontMirrors: true,
  frontAcross: 0.9,
  frontHeight: 0.21,
  frontSpacing: 0.05,
};

/**
 * A Dire Bear — a huge brown bear that keeps to the forest edges of floor 3.
 * Slow and heavy: it rears up, telegraphing a paw swipe that hits hard.
 */
export class DireBear extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return DIRE_BEAR_EYES;
  }

  readonly xpValue = 120;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Dire Bear';
  description =
    'A brown bear the size of a cart, at home where the trees thin out. It rears up before it swings — that is your moment to step back.';
  override readonly audioTag = 'bear';

  private attackCooldown = 0;
  private windupTimer = 0;
  private swipeTimer = 0;
  private painGrowlCooldown = 0;
  private isAggro = false;
  /** Drives its breathing at rest; never reset, so the idle loops seamlessly. */
  private idleTicks = 0;
  private gaitSampleX: number;
  private gaitSampleY: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, DIRE_BEAR_HP, DIRE_BEAR_SPEED);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    prewarmDireBear();
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.windupTimer = 0;
    this.swipeTimer = 0;
    this.painGrowlCooldown = 0;
    this.isAggro = false;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.painGrowlCooldown === 0) {
      this.damageSoundPending = true;
      this.painGrowlCooldown = PAIN_GROWL_COOLDOWN;
    }
  }

  /**
   * Measured over the previous frame so it also picks up the ground it lost
   * to collision slides and separation pushes, not just its intended step.
   */
  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    const radiansPerPixel = (Math.PI * 2) / (DIRE_BEAR_TILES_PER_WALK_CYCLE * this.tileSize);
    this.walkFrameSpeed = Math.min(coveredPx * radiansPerPixel, MAX_GAIT_RADIANS_PER_FRAME);
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    this.idleTicks++;
    this.syncGaitToDistanceCovered();

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.swipeTimer > 0) this.swipeTimer--;
    if (this.painGrowlCooldown > 0) this.painGrowlCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;

    // A raised paw comes down regardless of where the target went.
    if (this.windupTimer > 0) {
      this.isMoving = false;
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.swipeTimer = ATTACK_SWIPE_FRAMES;
        this.attackCooldown = ATTACK_COOLDOWN;
        if (nearest && nearestDist <= attackRangePx && this.hasLOS(nearest)) {
          this.dealDamage(nearest, DIRE_BEAR_DAMAGE, 'paw swipe');
        }
      }
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);
    this.facingX = nearest.x >= this.x ? 1 : -1;

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

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.windupTimer = ATTACK_WINDUP_FRAMES;
    }
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

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    let attackAnim = 0;
    if (this.windupTimer > 0) {
      attackAnim = (1 - this.windupTimer / ATTACK_WINDUP_FRAMES) * ATTACK_ANIM_WINDUP_PEAK;
    } else if (this.swipeTimer > 0) {
      attackAnim =
        ATTACK_ANIM_WINDUP_PEAK +
        (1 - this.swipeTimer / ATTACK_SWIPE_FRAMES) * (1 - ATTACK_ANIM_WINDUP_PEAK);
    }

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawDireBearSprite(
        ctx,
        sx,
        sy,
        tileSize,
        this.walkFrame,
        this.isMoving,
        attackAnim,
        this.facingX,
        this.idleTicks,
      );
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, artTopY, sy, tileSize);
    }
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
