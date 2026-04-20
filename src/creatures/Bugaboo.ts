import { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { drawBugabooSprite } from '../sprites/bugabooSprite';

const BUGABOO_HP = 8;
const BUGABOO_SPEED = 0.8;
const AGGRO_RANGE_TILES = 20;
const ATTACK_RANGE_TILES = 1.2;
const ATTACK_COOLDOWN = 60;
const ATTACK_ANIM_FRAMES = 14;
const ATTACK_DAMAGE = 2;

export class Bugaboo extends Mob {
  readonly xpValue = 3;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  displayName = 'Bugaboo';
  description = 'A hulking, owl-eyed beast that bursts from the floor grates.';

  /** Grate tile this Bugaboo spawned from (used by quest system for barrier targeting). */
  assignedGrate: { x: number; y: number } | null = null;
  /** The defend target (quest NPC) this Bugaboo should prioritize. */
  defendTarget: Player | null = null;
  /** Callback for damaging a wood barrier at the assigned grate. */
  onBarrierAttack: ((grate: { x: number; y: number }, damage: number) => boolean) | null = null;
  /** True while this bugaboo is actively breaking through a wood barrier (hidden beneath boards). */
  isBreakingIn = false;

  private aggroRangePx: number;
  private attackRangePx: number;
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BUGABOO_HP, BUGABOO_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    this.isBreakingIn = false;

    // Priority 1: If assigned grate has a barrier, attack the barrier
    if (this.assignedGrate && this.onBarrierAttack) {
      const barrierX = this.assignedGrate.x * TILE_SIZE;
      const barrierY = this.assignedGrate.y * TILE_SIZE;
      const distToBarrier = Math.hypot(barrierX - this.x, barrierY - this.y);

      // Check if barrier still exists
      const barrierExists = this.onBarrierAttack(this.assignedGrate, 0);
      if (barrierExists) {
        this.isBreakingIn = true;
        this.isAggro = true;
        if (distToBarrier > this.attackRangePx) {
          this.followTargetCollide(barrierX, barrierY, this.speed, this.attackRangePx * 0.6);
        } else {
          this.isMoving = false;
          if (this.attackCooldown === 0) {
            this.onBarrierAttack(this.assignedGrate, ATTACK_DAMAGE);
            this.attackCooldown = ATTACK_COOLDOWN;
            this.attackAnimTimer = ATTACK_ANIM_FRAMES;
          }
        }
        return;
      }
    }

    // Priority 2: Attack defend target (NPC) if alive
    if (this.defendTarget && this.defendTarget.isAlive) {
      const dist = Math.hypot(this.defendTarget.x - this.x, this.defendTarget.y - this.y);
      this.isAggro = true;
      this.currentTarget = this.defendTarget;

      if (dist > this.attackRangePx) {
        this.followTargetCollide(
          this.defendTarget.x,
          this.defendTarget.y,
          this.speed,
          this.attackRangePx * 0.6,
        );
      } else {
        this.isMoving = false;
        if (this.attackCooldown === 0) {
          this.dealDamage(this.defendTarget, ATTACK_DAMAGE);
          this.attackCooldown = ATTACK_COOLDOWN;
          this.attackAnimTimer = ATTACK_ANIM_FRAMES;
        }
      }
      return;
    }

    // Priority 3: Attack nearest player (fallback / NPC dead)
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      if ((t as { isDefendTarget?: boolean }).isDefendTarget) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.aggroRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.doWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);

    if (nearestDist > this.attackRangePx) {
      this.followTargetCollide(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.attackRangePx * 0.6,
      );
    } else {
      this.isMoving = false;
    }

    if (nearestDist <= this.attackRangePx && this.attackCooldown === 0) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    if (!this.isAlive) return;
    if (this.isBreakingIn) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tileSize, tileSize);
    }

    drawBugabooSprite(ctx, sx, sy, tileSize, this.walkFrame, this.isMoving, this.facingX);

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
