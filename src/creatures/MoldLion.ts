import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawMoldLionSprite } from '../sprites/moldLionSprite';
import { makePoison } from '../core/StatusEffect';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const LION_HP = 24;
const LION_SPEED = 1.3;
const AGGRO_RANGE_TILES = 7;
const ATTACK_RANGE_TILES = 1.3;
const ATTACK_DAMAGE = 8;
/** Frames between bites (~1.5 s at 60 fps). */
const ATTACK_COOLDOWN = 90;
/** Frames the bite animation plays. */
const ATTACK_ANIM_FRAMES = 22;
const COIN_DROP_MIN = 1;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;

/** Poison aura — a passive fungal cloud independent of the bite attack. */
const AURA_RANGE_TILES = 2.5;
/** Frames between aura poison re-applications (~3 s at 60 fps). */
const AURA_TICK_COOLDOWN = 180;

/**
 * A Mold Lion — one of Grimaldi's corrupted performers, a mid-tier bruiser
 * whose fungal mane emits a passive poison aura in addition to its bite.
 */
export class MoldLion extends Mob {
  readonly xpValue = 22;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Mold Lion';
  description = 'A mutated lion whose mane has become a mass of toxic fungal growths.';
  override readonly audioTag = 'troglodyte';

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private auraCooldown = 0;
  private auraPhase = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LION_HP, LION_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    if (this.auraCooldown > 0) this.auraCooldown--;
    this.auraPhase++;

    const auraRangePx = this.tileSize * AURA_RANGE_TILES;
    if (this.auraCooldown === 0) {
      let poisoned = false;
      for (const t of targets) {
        if (!t.isAlive) continue;
        if (Math.hypot(t.x - this.x, t.y - this.y) <= auraRangePx) {
          t.applyStatus(makePoison());
          poisoned = true;
        }
      }
      if (poisoned) this.auraCooldown = AURA_TICK_COOLDOWN;
    }

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

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

    if (!nearest) {
      this.isAggro = false;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
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

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
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

    const attackAnim = this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES : 0;
    const auraRadiusPx = tileSize * AURA_RANGE_TILES;

    drawMoldLionSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      attackAnim,
      this.facingX,
      auraRadiusPx,
      this.auraPhase,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
