import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawKrasueSprite } from '../sprites/krasueSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const KRASUE_HP = 9;
const KRASUE_SPEED = 2.0;

const AGGRO_RANGE_TILES = 8;
const ATTACK_RANGE_TILES = 0.9;
const ATTACK_DAMAGE = 6;
/** Frames between contact strikes (~1.3 s at 60 fps) — fast but no longer punishing. */
const ATTACK_COOLDOWN = 78;
const ATTACK_ANIM_FRAMES = 22;
/** Fraction of attack range within which the strike is attempted. */
const ATTACK_ENGAGE_FRACTION = 1.15;

/** Erratic drift added to the direct pursuit path — perpendicular wobble. */
const WOBBLE_FREQUENCY = 0.09;
const WOBBLE_AMOUNT = 0.65;
const FLOAT_PHASE_SPEED = 0.12;

/**
 * A krasue — a disembodied flying head trailing entrails, born from
 * Scolopendra's poison catastrophe. Fast, erratic, and low-HP but
 * dangerous in a straight fight; the Over City ruins' aerial threat.
 */
export class Krasue extends Mob {
  readonly xpValue = 10;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  displayName = 'Krasue';
  description = 'A disembodied head trailing entrails, drifting erratically through the ruins.';
  override isFlying = true;
  override readonly audioTag = 'krasue';
  /**
   * Ambient krasue respect the town safe zone; quest systems set this true on
   * scripted spawns (the night-attack swarm, Quill's summons) so those hunt
   * players inside town streets and interiors.
   */
  ignoresTownSafeZone = false;

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private floatPhase = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KRASUE_HP, KRASUE_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    this.floatPhase += FLOAT_PHASE_SPEED;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      // Krasue won't pursue targets sheltering inside the town safe zone.
      if (!this.ignoresTownSafeZone && this.map?.isInTownSafeZone(t.x, t.y)) continue;
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
      const dx = this.lastKnownTargetX - this.x;
      const dy = this.lastKnownTargetY - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const dirX = dx / d;
      const dirY = dy / d;
      // Erratic drift: wobble perpendicular to the direct pursuit line.
      const wobble = Math.sin(this.floatPhase / WOBBLE_FREQUENCY) * WOBBLE_AMOUNT;
      const moveX = dirX - dirY * wobble;
      const moveY = dirY + dirX * wobble;
      const moveLen = Math.hypot(moveX, moveY) || 1;
      this.moveWithCollision((moveX / moveLen) * this.speed, (moveY / moveLen) * this.speed);
      this.isMoving = true;
      this.facingX = dirX >= 0 ? 1 : -1;
      this.facingY = dirY;
    } else {
      this.isMoving = false;
      this.facingX = this.lastKnownTargetX >= this.x ? 1 : -1;
    }

    if (
      nearestDist <= attackRangePx * ATTACK_ENGAGE_FRACTION &&
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
    drawKrasueSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.floatPhase,
      this.isAggro,
      this.facingX,
      attackAnim,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
