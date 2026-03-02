import { Player } from '../Player';
import { Mob } from './Mob';
import { drawGoblinSprite, GoblinWeapon } from '../sprites/goblinSprite';

export { GoblinWeapon };

const GOBLIN_HP = 6;
const GOBLIN_SPEED = 1.4;
const AGGRO_RANGE_TILES = 6;
const ATTACK_RANGE_TILES = 1.2;
/** Frames between attacks (~1.5 s at 60 fps) */
const ATTACK_COOLDOWN = 90;
/** Frames the attack swing animation plays */
const ATTACK_ANIM_FRAMES = 18;

export class Goblin extends Mob {
  readonly xpValue = 5;
  readonly weapon: GoblinWeapon;
  readonly skinColor: string;
  readonly eyeColor: string;

  protected aggroRangePx: number;
  protected attackRangePx: number;
  protected attackDamage: number;

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;
  /** True when the goblin has not yet landed its first hit on the current target. */
  private firstHitPending = true;
  /** Windup frames remaining before the first strike connects. */
  private attackWindupTimer = 0;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    weapon: GoblinWeapon,
    skinColor: string,
    eyeColor: string,
  ) {
    super(tileX, tileY, tileSize, GOBLIN_HP, GOBLIN_SPEED);
    this.weapon = weapon;
    this.skinColor = skinColor;
    this.eyeColor = eyeColor;
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
    // Hammers hit harder than clubs
    this.attackDamage = weapon === 'hammer' ? 2 : 1;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    // Find nearest living target within aggro range
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.aggroRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      this.doWander();
      return;
    }

    this.isAggro = true;

    // Track last known position while we have LOS (enables navigation around corners)
    this.updateLastKnown(nearest);

    // Chase toward last known position (= current position when LOS is clear)
    if (nearestDist > this.attackRangePx) {
      this.followTargetCollide(this.lastKnownTargetX, this.lastKnownTargetY, this.speed, this.attackRangePx * 0.8);
    } else {
      this.isMoving = false;
    }

    // Brief windup before the very first strike of each engagement
    const inRange = nearestDist <= this.attackRangePx;
    if (inRange && this.firstHitPending && this.attackWindupTimer === 0) {
      this.attackWindupTimer = 15;
      this.firstHitPending = false;
    }
    if (this.attackWindupTimer > 0) this.attackWindupTimer--;

    // Attack on cooldown (windup must have elapsed for the first hit, wall must be clear)
    if (inRange && this.attackCooldown === 0 && this.attackWindupTimer === 0 && this.hasLOS(nearest)) {
      nearest.takeDamage(this.attackDamage);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    // Red outline when aggro'd
    if (this.isAggro) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tileSize, tileSize);
    }

    // Normalise attack animation to 0–1 peak-at-midpoint curve
    const attackAnim = this.attackAnimTimer > 0
      ? Math.sin((1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES) * Math.PI)
      : 0;

    drawGoblinSprite(
      ctx, sx, sy, tileSize,
      this.weapon, this.skinColor, this.eyeColor,
      this.walkFrame, this.isMoving, attackAnim,
    );

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
