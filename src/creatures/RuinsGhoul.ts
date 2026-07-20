import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawRuinsGhoulSprite } from '../sprites/ruinsGhoulSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const GHOUL_HP = 16;
const GHOUL_SPEED = 1.1;
const AGGRO_RANGE_TILES = 7;
const ATTACK_RANGE_TILES = 1.2;
/** Frames between bite attacks (~1.7 s at 60 fps). */
const ATTACK_COOLDOWN = 100;
/** Frames the bite/claw animation plays. */
const ATTACK_ANIM_FRAMES = 26;
const ATTACK_DAMAGE = 5;
const COIN_DROP_MAX = 2;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Frames of windup before the first strike of an engagement. */
const FIRST_HIT_WINDUP_FRAMES = 18;

/**
 * A former Over City citizen twisted by Scolopendra's poison catastrophe into
 * a shambling ruins ghoul — the bread-and-butter hostile of the ruined city
 * outside the safety of town.
 */
export class RuinsGhoul extends Mob {
  readonly xpValue = 12;
  protected coinDropMin = 0;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Ruins Ghoul';
  description = 'A former citizen of the Over City, twisted into a shambling horror.';

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;
  private firstHitPending = true;
  private attackWindupTimer = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GHOUL_HP, GHOUL_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      // Ghouls won't pursue targets sheltering inside the town safe zone.
      if (this.map?.isInTownSafeZone(t.x, t.y)) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < aggroScanRange && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
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

    const inRange = nearestDist <= attackRangePx;
    if (inRange && this.firstHitPending && this.attackWindupTimer === 0) {
      this.attackWindupTimer = FIRST_HIT_WINDUP_FRAMES;
      this.firstHitPending = false;
    }
    if (this.attackWindupTimer > 0) this.attackWindupTimer--;

    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.attackWindupTimer === 0 &&
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

    drawRuinsGhoulSprite(
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
