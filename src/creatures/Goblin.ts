import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { HumanPlayer } from './HumanPlayer';
import { CatPlayer } from './CatPlayer';
import { drawGoblinSprite, GoblinWeapon } from '../sprites/goblinSprite';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

export { GoblinWeapon };

const GOBLIN_HP = 6;
const GOBLIN_SPEED = 1.4;
const AGGRO_RANGE_TILES = 6;
const ATTACK_RANGE_TILES = 1.2;
/** Frames between attacks (~1.5 s at 60 fps) */
const ATTACK_COOLDOWN = 90;
/** Frames the attack swing animation plays (~0.6 s at 60 fps) */
const ATTACK_ANIM_FRAMES = 36;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Drop chance for dynamite when killed by human. */
const DYNAMITE_DROP_CHANCE_HUMAN = 0.2;
/** Drop chance for dynamite when killed by cat. */
const DYNAMITE_DROP_CHANCE_CAT = 0.05;

export class Goblin extends Mob {
  readonly xpValue = 5;
  protected coinDropMin = 1;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Goblin';
  description = 'A scrappy little troublemaker armed with crude weapons.';
  readonly bodyPartKey = 'goblin';
  override readonly audioTag = 'goblin';
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

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    const chance =
      killer instanceof HumanPlayer
        ? DYNAMITE_DROP_CHANCE_HUMAN
        : killer instanceof CatPlayer
          ? DYNAMITE_DROP_CHANCE_CAT
          : 0;
    if (chance > 0 && Math.random() < chance) {
      items.push({ id: 'goblin_dynamite', quantity: 1 });
    }
    return items;
  }

  /**
   * AI update that keeps the goblin stationary but still attacks targets in melee range.
   * Intended for use by subclasses (e.g. TutorialGoblin defense-only mode).
   */
  protected updateAIStandAndFight(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < this.attackRangePx && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (nearest === null) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      this.isMoving = false;
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);
    this.isMoving = false;

    const inRange = nearestDist <= this.attackRangePx;
    if (inRange && this.firstHitPending && this.attackWindupTimer === 0) {
      this.attackWindupTimer = 15;
      this.firstHitPending = false;
    }
    if (this.attackWindupTimer > 0) this.attackWindupTimer--;

    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.attackWindupTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, this.attackDamage);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    // Find nearest living target within aggro range
    const aggroScanRange = this.isAggro
      ? this.aggroRangePx * AGGRO_PERSIST_MULTIPLIER
      : this.aggroRangePx;
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
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;

    // Track last known position while we have LOS (enables navigation around corners)
    this.updateLastKnown(nearest);

    // Chase toward last known position (= current position when LOS is clear)
    if (nearestDist > this.attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.attackRangePx * FOLLOW_STOP_FRACTION,
      );
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

    // Attack on cooldown (windup must have elapsed for the first hit).
    // Same-tile contact always lands regardless of LOS — can't dodge point-blank.
    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.attackWindupTimer === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.dealDamage(nearest, this.attackDamage);
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    // Linear 0→1 progress so weaponAngleCurve sees a single clean sweep
    const attackAnim = this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES : 0;

    drawGoblinSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.weapon,
      this.walkFrame,
      this.isMoving,
      attackAnim,
      this.facingX,
    );

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
