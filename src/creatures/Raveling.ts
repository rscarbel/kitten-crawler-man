import { Mob, TACTICAL_RETREAT_MAX_SPEED } from './Mob';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { Player } from '../Player';
import { drawRavelingSprite, RAVELING_FLOAT_RADIANS_PER_FRAME } from '../sprites/ravelingSprite';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { riposteCooldown } from './tactics/riposte';
import type { TacticalMove } from './tactics/tacticalFrame';

const RAVELING_HP = 9;
const RAVELING_SPEED = 2.0;

const AGGRO_RANGE_TILES = 8;
const ATTACK_RANGE_TILES = 0.9;
const ATTACK_DAMAGE = 6;
/** Frames between contact strikes (~1.3 s at 60 fps) — fast but no longer punishing. */
const ATTACK_COOLDOWN = 78;
const ATTACK_ANIM_FRAMES = 22;
/** Fraction of attack range within which the strike is attempted. */
const ATTACK_ENGAGE_FRACTION = 1.15;

/**
 * Erratic drift added to the direct pursuit path — perpendicular wobble. It
 * weaves once every two bobs: any faster and the sideways push flips sign
 * every couple of frames, which reads as a shiver rather than a weave.
 */
const WOBBLE_TURNS_PER_BOB = 0.5;
const WOBBLE_AMOUNT = 0.65;
/**
 * How far off straight up or down a raveling must be heading, as a share of its
 * step, before it turns to face that side; and how far to one side its target
 * must be, in tiles, while it holds still to strike. Without them a head
 * rising or sinking straight at its prey mirrors itself every frame.
 */
const FACING_TURN_SHARE = 0.25;
export const RAVELING_FACING_TURN_TILES = 0.25;
const RAVELING_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];

/** Drawn only face-on, so in profile it still shows that face. */
const RAVELING_EYES: EyePlacement = {
  sideForward: 0,
  sideHeight: 0.49,
  sideSpacing: 0.1,
  frontMirrors: true,
  frontAcross: 0,
  frontHeight: 0.49,
  frontSpacing: 0.1,
};

/**
 * A raveling — a disembodied flying head trailing entrails, one of the old
 * city's people made by the Fraying, named for the loose thread that comes off
 * a fraying cloth. Fast, erratic, and low-HP but dangerous in a straight fight;
 * the Taloncrest ruins' aerial threat.
 */
export class Raveling extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return RAVELING_EYES;
  }

  readonly xpValue = 10;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  displayName = 'Raveling';
  description = 'A disembodied head trailing entrails, drifting erratically through the ruins.';
  override isFlying = true;
  override readonly audioTag = 'raveling';
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private floatPhase = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, RAVELING_HP, RAVELING_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
  }

  /**
   * A raveling is a melee brawler that happens to fly: it can learn to come at
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
    return RAVELING_TACTICS;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    this.floatPhase += RAVELING_FLOAT_RADIANS_PER_FRAME;

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    // A raveling won't pursue targets sheltering inside the town safe zone.
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
      this.glideToward(tacticalMove.x, tacticalMove.y);
    } else if (nearestDist > attackRangePx) {
      this.driftToward(this.lastKnownTargetX, this.lastKnownTargetY);
    } else {
      this.isMoving = false;
      this.faceTowardX(this.lastKnownTargetX - this.x);
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
    const wobble = Math.sin(this.floatPhase * WOBBLE_TURNS_PER_BOB) * WOBBLE_AMOUNT;
    const moveX = dirX - dirY * wobble;
    const moveY = dirY + dirX * wobble;
    const moveLen = Math.hypot(moveX, moveY) || 1;
    this.moveWithCollision((moveX / moveLen) * this.speed, (moveY / moveLen) * this.speed);
    this.isMoving = true;
    if (Math.abs(dirX) > FACING_TURN_SHARE) this.facingX = dirX > 0 ? 1 : -1;
    this.facingY = dirY;
  }

  /**
   * A flank's walk to its staging point: straight, with no wobble. The flank
   * picks a slot only when the straight line to it is open and short, and the
   * weave lasts longer than the whole walk, so every raveling of a pack — all
   * bobbing in step — would be pushed the same way off its line, and the one
   * whose slot lies against the push would come in beside its neighbour.
   */
  private glideToward(pointX: number, pointY: number): void {
    const dx = pointX - this.x;
    const dy = pointY - this.y;
    const distance = Math.hypot(dx, dy) || 1;
    const dirX = dx / distance;
    const dirY = dy / distance;
    this.moveWithCollision(dirX * this.speed, dirY * this.speed);
    this.isMoving = true;
    if (Math.abs(dirX) > FACING_TURN_SHARE) this.facingX = dirX > 0 ? 1 : -1;
    this.facingY = dirY;
  }

  /** Turns to face a target `dx` pixels to one side, once it is clearly to that side. */
  private faceTowardX(dx: number): void {
    if (Math.abs(dx) <= this.tileSize * RAVELING_FACING_TURN_TILES) return;
    this.facingX = dx > 0 ? 1 : -1;
  }

  /**
   * A regroup's walk: straight, with no wobble, stopping short of the friend,
   * and no faster than any mob falls back. The wobble is how a raveling closes
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
      this.faceTowardX(this.lastKnownTargetX - this.x);
      return;
    }
    const step = Math.min(this.speed, TACTICAL_RETREAT_MAX_SPEED, remaining);
    this.moveWithCollision((dx / distance) * step, (dy / distance) * step);
    this.isMoving = true;
    if (Math.abs(dx / distance) > FACING_TURN_SHARE) this.facingX = dx > 0 ? 1 : -1;
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

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const attackAnim = this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES : 0;
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawRavelingSprite(
        ctx,
        sx,
        sy,
        tileSize,
        this.floatPhase,
        this.isAggro,
        this.facingX,
        attackAnim,
      );
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, artTopY, sy, tileSize);
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
