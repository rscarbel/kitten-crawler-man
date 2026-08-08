import type { Player } from '../Player';
import { RisingSkeleton } from './RisingSkeleton';
import { SKELETON_SWORD_BODY_PART_KEY, drawSkeletonWarriorSprite } from '../sprites/skeletonSprite';
import { SWORD_SLASH_FRAMES, swordSlashImpactFrame } from '../sprites/skeletonTiming';
import { PLAYER_SPEED } from '../core/constants';

/**
 * A sword-and-shield skeleton.
 *
 * Written as a standalone mob rather than as a piece of the Skeleton Lord's
 * encounter: it is registered under its own spawner id so a future floor can put
 * a few in a crypt without dragging a bounty boss along with them. Nothing here
 * reads the lord.
 */

const SKELETON_HP = 14;
const SKELETON_SPEED = 0.95;
/** A levelled warrior's walk is capped at this fraction of the player's. */
const SKELETON_MAX_SPEED_RATIO = 0.8;
export const SKELETON_MAX_SPEED = PLAYER_SPEED * SKELETON_MAX_SPEED_RATIO;
const AGGRO_RANGE_TILES = 9;
/** How close it closes before it swings. */
const ATTACK_RANGE_TILES = 1.15;
/** Frames between swings. */
const ATTACK_COOLDOWN_FRAMES = 78;
const SLASH_DAMAGE = 3;
const COIN_DROP_MIN = 3;
const COIN_DROP_MAX = 6;

/**
 * XP for an escort of the Skeleton Lord.
 *
 * Deliberately meagre. The lord summons replacements on a cadence, so a party
 * that finds killing warriors more profitable than killing him has been handed
 * an infinite XP tap and a reason never to finish the bounty.
 */
export const SKELETON_ESCORT_XP = 4;

/** The value `slashTimer` holds on the frame the edge connects. */
const SLASH_IMPACT_TIMER = SWORD_SLASH_FRAMES - swordSlashImpactFrame();

const SKELETON_WARRIOR_CULL_MARGIN_TILES = 2;

export class SkeletonWarrior extends RisingSkeleton {
  readonly xpValue = SKELETON_ESCORT_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'skeleton';
  override readonly bodyPartKey = SKELETON_SWORD_BODY_PART_KEY;
  displayName = 'Skeleton Warrior';
  description = 'A rattling swordsman held together by somebody else’s will.';

  private attackCooldown = 0;
  private slashTimer = 0;
  private isAggro = false;

  private readonly aggroRangePx: number;
  private readonly attackRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SKELETON_HP, SKELETON_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
  }

  /**
   * How far its art reaches above its tile, measured off the baked sheet:
   * `tileY` 104 at `tileScale` 64. Left at the default of one tile it pops in
   * with its skull already on screen, and the hit flash — which is floored by
   * this — clips the same skull off mid-fight.
   */
  override get cullMarginTiles(): number {
    return SKELETON_WARRIOR_CULL_MARGIN_TILES;
  }

  protected override get levelledSpeedCap(): number {
    return SKELETON_MAX_SPEED;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.slashTimer = 0;
    this.isAggro = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.tickRise()) return;
    if (this.attackCooldown > 0) this.attackCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;

    // The swing runs to completion whatever happens to the target: it is the
    // player's window to step back, and a warrior that abandons it mid-stroke
    // because they moved has told them a lie.
    if (this.slashTimer > 0) {
      this.slashTimer--;
      this.isMoving = false;
      if (this.slashTimer === SLASH_IMPACT_TIMER) this.landSlash();
      return;
    }

    if (!nearest) {
      this.isAggro = false;
      this.clearAStarPath();
      // Not `doWander`: an un-aggroed bounty escort is leashed to its site, and
      // only this path consults the leash.
      this.returnHomeOrWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);
    const distance = this.distanceTo(nearest);
    if (distance > this.attackRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.attackRangePx,
      );
      return;
    }

    this.isMoving = false;
    // Nothing else points a stopped mob at anything: the follow helpers return
    // before writing facing once it is at range, so a warrior that only ever
    // closed and stopped keeps whatever direction it last walked.
    this.faceToward(nearest);
    if (this.attackCooldown === 0) {
      this.attackCooldown = ATTACK_COOLDOWN_FRAMES;
      this.slashTimer = SWORD_SLASH_FRAMES;
    }
  }

  /**
   * The moment the edge arrives. Re-checked against the live target rather than
   * the one the swing started on: a player who stepped out of reach during the
   * wind-up has dodged it, which is the whole point of telegraphing it.
   */
  private landSlash(): void {
    const target = this.currentTarget;
    if (target?.isAlive !== true) return;
    if (this.distanceTo(target) > this.attackRangePx) return;
    this.dealDamage(target, SLASH_DAMAGE);
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
    const rise = this.riseProgress;

    if (this.isAggro && rise === null) this.renderAggroIndicator(ctx, sx, sy, tileSize);

    drawSkeletonWarriorSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      attackProgress: this.slashTimer > 0 ? 1 - this.slashTimer / SWORD_SLASH_FRAMES : null,
      riseProgress: rise,
    });

    // No health bar while it is still in the ground: there is nothing to damage
    // yet, and a bar floating over a mound of soil gives the wrong read.
    if (rise === null) this.renderMobHealthBar(ctx, sx, sy);
  }
}
