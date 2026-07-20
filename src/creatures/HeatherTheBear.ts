import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawHeatherBearSprite } from '../sprites/heatherBearSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

// Base stats are tuned to land at boss weight after applyMobLevel(HEATHER_LEVEL)
// (×6.4 HP, ×4.6 damage, ×2.4 speed at level 19).
const HEATHER_HP = 65;
const HEATHER_SPEED = 0.55;
const HEATHER_DAMAGE = 3;
/** The book's Neighborhood Boss level — applied by the quest system on spawn. */
export const HEATHER_LEVEL = 19;

const AGGRO_RANGE_TILES = 9;
const ATTACK_RANGE_TILES = 1.4;
/** Frames between swipes (~2 s at 60 fps) — slow, heavy, telegraphed. */
const ATTACK_COOLDOWN = 120;
/** Frames Heather visibly rears up before the swipe lands — the dodge window. */
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
 * Heather the Bear — the circus's beloved performing bear, now a
 * Neighborhood Boss with an exposed skull and parasite worms in her paws.
 * Signet needs her blood to fuel the Ink Marauder ritual. Somewhere in
 * there, deep deep down, there is a spark of the old Heather.
 */
export class HeatherTheBear extends Mob {
  readonly xpValue = 120;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Heather the Bear';
  description =
    'The crowds adored her once. What shuffles in her skin now is not her — though somewhere in there, deep deep down, there is a spark of the old Heather.';
  override readonly audioTag = 'bear';

  private attackCooldown = 0;
  private windupTimer = 0;
  private swipeTimer = 0;
  private painGrowlCooldown = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HEATHER_HP, HEATHER_SPEED);
    this.isBoss = true;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.painGrowlCooldown === 0) {
      this.damageSoundPending = true;
      this.painGrowlCooldown = PAIN_GROWL_COOLDOWN;
    }
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.swipeTimer > 0) this.swipeTimer--;
    if (this.painGrowlCooldown > 0) this.painGrowlCooldown--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange =
      this.isAggro || this.forceAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < aggroScanRange && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    // A raised paw comes down regardless of where the target went.
    if (this.windupTimer > 0) {
      this.isMoving = false;
      this.windupTimer--;
      if (this.windupTimer === 0) {
        this.swipeTimer = ATTACK_SWIPE_FRAMES;
        this.attackCooldown = ATTACK_COOLDOWN;
        if (nearest && nearestDist <= attackRangePx && this.hasLOS(nearest)) {
          this.dealDamage(nearest, HEATHER_DAMAGE, 'paw swipe');
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

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
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

    let attackAnim = 0;
    if (this.windupTimer > 0) {
      attackAnim = (1 - this.windupTimer / ATTACK_WINDUP_FRAMES) * ATTACK_ANIM_WINDUP_PEAK;
    } else if (this.swipeTimer > 0) {
      attackAnim =
        ATTACK_ANIM_WINDUP_PEAK +
        (1 - this.swipeTimer / ATTACK_SWIPE_FRAMES) * (1 - ATTACK_ANIM_WINDUP_PEAK);
    }

    drawHeatherBearSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      attackAnim,
      this.facingX,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
