import { Mob } from './Mob';
import type { Player } from '../Player';
import { drawRuinsGhoulSprite } from '../sprites/ruinsGhoulSprite';

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

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
    this.firstHitPending = true;
    this.attackWindupTimer = 0;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    // Ghouls won't pursue targets sheltering inside the town safe zone.
    const nearest = this.acquireTarget(
      targets,
      aggroRangePx,
      (t) => this.ignoresTownSafeZone || this.map?.isInTownSafeZone(t.x, t.y) !== true,
    );

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

    const inRange = nearestDist <= attackRangePx;
    // Its windup and swing both play while stopped, and nothing else writes
    // facing once it is. Held still mid-swing so the arc cannot flip.
    if (inRange && this.attackAnimTimer === 0) this.faceToward(nearest);
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
      this.attackCooldown = this.scaledCooldownFrames(ATTACK_COOLDOWN);
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
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

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
