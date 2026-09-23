import { Mob, TACTICAL_RETREAT_MAX_SPEED } from './Mob';
import type { Player } from '../Player';
import { drawKrasueSprite } from '../sprites/krasueSprite';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { riposteCooldown } from './tactics/riposte';
import type { TacticalMove } from './tactics/tacticalFrame';

const KRASUE_HP = 9;
const KRASUE_SPEED = 2.0;

/** Also the ceiling the night-attack swarm's spawn ring must stay well under — see `MurderMysteryQuestSystem`. */
export const AGGRO_RANGE_TILES = 8;
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
const KRASUE_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];

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
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private floatPhase = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, KRASUE_HP, KRASUE_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
  }

  /**
   * A krasue is a melee brawler that happens to fly: it can learn to come at
   * the player from several sides, to turn a blow aside and answer it, and to
   * fall back on another head when hurt. Never `kite` — it is a swarm of
   * contact strikers with nothing to gain by drawing the player anywhere.
   *
   * It steers by its own straight-line drift rather than by pathfinding, which
   * suits the movement tactics: a flank slot and a regroup friend are only
   * ever offered when a straight walk to them is open. A guard's shove refuses
   * its drift like any walk, and it has no committed charge to misread that.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return KRASUE_TACTICS;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    this.floatPhase += FLOAT_PHASE_SPEED;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    // Krasue won't pursue targets sheltering inside the town safe zone.
    const nearest = this.acquireTarget(
      targets,
      aggroRangePx,
      (t) => this.ignoresTownSafeZone || this.map?.isInTownSafeZone(t.x, t.y) !== true,
    );

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.tactics.disengage();
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (this.tactics.claimRiposte()) {
      this.attackCooldown = riposteCooldown(this.attackCooldown, this.attackAnimTimer);
    }
    const tacticalMove = this.chooseTacticalStep(
      nearest,
      attackRangePx,
      this.attackAnimTimer === 0,
    );
    if (tacticalMove?.breaksOff === true) {
      this.fallBackToward(tacticalMove);
      return;
    }

    if (tacticalMove !== null) {
      this.driftToward(tacticalMove.x, tacticalMove.y);
    } else if (nearestDist > attackRangePx) {
      this.driftToward(this.lastKnownTargetX, this.lastKnownTargetY);
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
      this.attackCooldown = this.scaledCooldownFrames(ATTACK_COOLDOWN);
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  /** The erratic pursuit: straight at the point, wobbling either side of the line. */
  private driftToward(pointX: number, pointY: number): void {
    const dx = pointX - this.x;
    const dy = pointY - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const dirX = dx / d;
    const dirY = dy / d;
    const wobble = Math.sin(this.floatPhase / WOBBLE_FREQUENCY) * WOBBLE_AMOUNT;
    const moveX = dirX - dirY * wobble;
    const moveY = dirY + dirX * wobble;
    const moveLen = Math.hypot(moveX, moveY) || 1;
    this.moveWithCollision((moveX / moveLen) * this.speed, (moveY / moveLen) * this.speed);
    this.isMoving = true;
    this.facingX = dirX >= 0 ? 1 : -1;
    this.facingY = dirY;
  }

  /**
   * A regroup's walk: straight, with no wobble, stopping short of the friend,
   * and no faster than any mob falls back. The wobble is how a krasue closes
   * on prey; a head drifting sideways while it falls back would spend the
   * regroup's short frame cap going nowhere.
   */
  private fallBackToward(move: TacticalMove): void {
    const dx = move.x - this.x;
    const dy = move.y - this.y;
    const distance = Math.hypot(dx, dy);
    const remaining = distance - move.stopPx;
    if (remaining <= 0) {
      this.isMoving = false;
      this.facingX = this.lastKnownTargetX >= this.x ? 1 : -1;
      return;
    }
    const step = Math.min(this.speed, TACTICAL_RETREAT_MAX_SPEED, remaining);
    this.moveWithCollision((dx / distance) * step, (dy / distance) * step);
    this.isMoving = true;
    this.facingX = dx >= 0 ? 1 : -1;
    this.facingY = dy / distance;
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

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
