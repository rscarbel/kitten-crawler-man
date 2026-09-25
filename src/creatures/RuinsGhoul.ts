import { Mob, type StructureStrikeTiming } from './Mob';
import type { Player } from '../Player';
import { drawRuinsGhoulSprite } from '../sprites/ruinsGhoulSprite';
import { riposteCooldown } from './tactics/riposte';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { siegeAdvance, siegeCanEngage } from './siege/siegeCapability';

export const GHOUL_HP = 16;
export const GHOUL_SPEED = 1.1;
const AGGRO_RANGE_TILES = 7;
const ATTACK_RANGE_TILES = 1.2;
/** Frames between bite attacks (~1.7 s at 60 fps). */
export const GHOUL_ATTACK_COOLDOWN_FRAMES = 100;
/** Frames the bite/claw animation plays. */
const ATTACK_ANIM_FRAMES = 26;
/**
 * The overworld's commonest mob, met in pairs on every road; its bite is set
 * so that a badly built party can still walk away from the pair it cannot
 * avoid, which `verify:difficulty-curve` holds.
 */
export const GHOUL_ATTACK_DAMAGE = 4;
const COIN_DROP_MAX = 2;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Frames of windup before the first strike of an engagement. */
const FIRST_HIT_WINDUP_FRAMES = 18;
const GHOUL_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];
/** A ghoul's claws tear at a palisade harder than a skeleton's sword hacks it. */
const GHOUL_SIEGE_STRUCTURE_MULTIPLIER = 1.2;
/** A blow on a structure is the bite's own swing, landing where the bite's windup ends. */
const GHOUL_STRUCTURE_STRIKE_TIMING: StructureStrikeTiming = {
  swingFrames: ATTACK_ANIM_FRAMES,
  impactFrame: FIRST_HIT_WINDUP_FRAMES,
  cooldownFrames: GHOUL_ATTACK_COOLDOWN_FRAMES,
};

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

  /** A flank can be walking it while its swing still plays, and turning then would flip the arc. */
  protected override get isSwingAnimating(): boolean {
    return this.attackAnimTimer > 0;
  }

  /**
   * A shambling brawler with claws and teeth: it can learn to come at its prey
   * from an angle, turn a blow aside and answer it, and fall back on another
   * ghoul when hurt. It has no reason to back off from anything it can reach.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return GHOUL_TACTICS;
  }

  override get siegeStructureMultiplier(): number {
    return GHOUL_SIEGE_STRUCTURE_MULTIPLIER;
  }

  protected override get structureStrikeTiming(): StructureStrikeTiming {
    return GHOUL_STRUCTURE_STRIKE_TIMING;
  }

  protected override get structureStrikeBaseDamage(): number {
    return GHOUL_ATTACK_DAMAGE;
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
    if (this.isStrikingStructure) {
      this.isMoving = false;
      return;
    }

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    // Ghouls won't pursue targets sheltering inside the town safe zone.
    const nearest = this.acquireTarget(
      targets,
      aggroRangePx,
      (t) =>
        siegeCanEngage(this, t) &&
        (this.ignoresTownSafeZone || this.map?.isInTownSafeZone(t.x, t.y) !== true),
    );

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.firstHitPending = true;
      this.attackWindupTimer = 0;
      this.tactics.disengage();
      this.clearAStarPath();
      if (siegeAdvance(this)) return;
      this.doWander();
      return;
    }

    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (this.tactics.claimRiposte()) {
      this.attackCooldown = riposteCooldown(this.attackCooldown, this.attackAnimTimer);
    }
    const isCommitted = this.attackAnimTimer > 0 || this.attackWindupTimer > 0;
    const tacticalMove = this.chooseTacticalStep(nearest, attackRangePx, !isCommitted);
    if (tacticalMove?.breaksOff === true) {
      this.walkTacticalStep(tacticalMove, nearest);
      return;
    }

    if (nearestDist > attackRangePx) {
      if (tacticalMove !== null) {
        this.walkTacticalStep(tacticalMove, nearest);
      } else {
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          attackRangePx * FOLLOW_STOP_FRACTION,
        );
      }
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
      this.dealDamage(nearest, GHOUL_ATTACK_DAMAGE);
      this.attackCooldown = this.scaledCooldownFrames(GHOUL_ATTACK_COOLDOWN_FRAMES);
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

    const structureStrike = this.structureStrikeProgress;
    const attackAnim =
      this.attackAnimTimer > 0
        ? 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES
        : (structureStrike ?? 0);

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
