import type { Player } from '../Player';
import { RisingSkeleton } from './RisingSkeleton';
import { SKELETON_ARCHER_BODY_PART_KEY, drawSkeletonArcherSprite } from '../sprites/skeletonSprite';
import { BONE_ARROW_DRAW_FRAMES, boneArrowReleaseFrame } from '../sprites/skeletonTiming';
import { SKELETON_ESCORT_XP } from './SkeletonWarrior';
import type { SkeletonShot } from '../systems/SkeletonProjectileSystem';

/**
 * A bow skeleton.
 *
 * It kites: it will not stand and trade, and it will not chase into melee
 * either. Inside its band it holds still and shoots, outside it closes, and too
 * close it backs off — which is what makes a mixed skeleton wave feel like a
 * formation rather than a queue.
 */

const ARCHER_HP = 10;
const ARCHER_SPEED = 1.05;
const AGGRO_RANGE_TILES = 11;
/**
 * The kiting band. Nearer than the minimum it retreats, further than the
 * maximum it advances, and only inside it does it shoot.
 */
const KITE_MIN_TILES = 4;
const KITE_MAX_TILES = 7;
/** Frames between shots. */
const SHOT_COOLDOWN_FRAMES = 140;
const ARROW_DAMAGE = 2;
const COIN_DROP_MIN = 3;
const COIN_DROP_MAX = 6;
const CENTER_OFFSET = 0.5;
/** Where the arrow leaves the archer, as a fraction of a tile from its centre. */
const BOW_OFFSET_X = 0.2;
const BOW_OFFSET_Y = -0.05;

/** The value `drawTimer` holds on the frame the string is released. */
const RELEASE_TIMER = BONE_ARROW_DRAW_FRAMES - boneArrowReleaseFrame();

/** Shared empty result so the common no-shots-this-frame path allocates nothing. */
const NO_SHOTS: readonly SkeletonShot[] = [];

const SKELETON_ARCHER_CULL_MARGIN_TILES = 1.5;

export class SkeletonArcher extends RisingSkeleton {
  readonly xpValue = SKELETON_ESCORT_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'skeleton';
  override readonly bodyPartKey = SKELETON_ARCHER_BODY_PART_KEY;
  displayName = 'Skeleton Archer';
  description = 'Looses bone-shafted arrows from behind its own front line.';

  private shotCooldown = 0;
  private drawTimer = 0;
  private isAggro = false;
  /**
   * Arrows loosed but not yet handed to `SkeletonProjectileSystem`, which drains
   * this every frame. The archer never owns an arrow in flight: it stops being
   * updated and drawn the instant it dies, and a shot stored here would be
   * deleted in mid-air along with it.
   */
  private pendingShots: SkeletonShot[] = [];

  override clearAirborneAttacks(): void {
    this.pendingShots = [];
  }

  private readonly aggroRangePx: number;
  private readonly kiteMinPx: number;
  private readonly kiteMaxPx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, ARCHER_HP, ARCHER_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.kiteMinPx = tileSize * KITE_MIN_TILES;
    this.kiteMaxPx = tileSize * KITE_MAX_TILES;
  }

  /**
   * How far its art reaches above its tile, measured off the baked sheet:
   * `tileY` 73 at `tileScale` 64. Left at the default of one tile it pops in
   * with its skull already on screen, and the hit flash — which is floored by
   * this — clips the same skull off mid-fight.
   */
  override get cullMarginTiles(): number {
    return SKELETON_ARCHER_CULL_MARGIN_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.shotCooldown = 0;
    this.drawTimer = 0;
    this.isAggro = false;
    this.pendingShots = [];
  }

  /**
   * Hands over every arrow loosed since the last call and clears the queue.
   *
   * Returning the array wholesale rather than one at a time is deliberate: the
   * caller must be able to drain an archer that has since died, and a
   * pull-one-per-frame interface would strand the rest.
   */
  takePendingShots(): readonly SkeletonShot[] {
    if (this.pendingShots.length === 0) return NO_SHOTS;
    const shots = this.pendingShots;
    this.pendingShots = [];
    return shots;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.tickRise()) return;
    if (this.shotCooldown > 0) this.shotCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;

    // The draw runs to completion whatever happens to the target — it is the
    // warning — but it keeps tracking until the string goes. Facing locked from
    // the first frame, an archer that a player simply walks around looses at
    // where they used to be, playing a forward-facing draw while the arrow
    // leaves in the opposite direction.
    if (this.drawTimer > 0) {
      this.drawTimer--;
      this.isMoving = false;
      this.isAggro = nearest !== null;
      if (this.drawTimer > RELEASE_TIMER && nearest) this.faceToward(nearest);
      if (this.drawTimer === RELEASE_TIMER) this.loose();
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
    const bow = this.bowPosition();
    const targetCx = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCy = nearest.y + this.tileSize * CENTER_OFFSET;
    const hasLineOfSight = this.map
      ? this.map.hasLineOfSight(bow.x, bow.y, targetCx, targetCy)
      : true;
    if (hasLineOfSight) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    const distance = this.distanceTo(nearest);
    if (!hasLineOfSight) {
      // Blocked: move onto the last place it could see them, looking for an
      // angle. Standing still and drawing at a wall is what a turret does.
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.kiteMinPx,
      );
    } else if (distance > this.kiteMaxPx) {
      this.followTargetAStar(nearest.x, nearest.y, this.speed, this.kiteMaxPx);
    } else if (distance < this.kiteMinPx) {
      this.backAwayFrom(nearest);
    } else {
      this.isMoving = false;
    }

    if (!this.isMoving) this.faceToward(nearest);

    if (hasLineOfSight && distance <= this.kiteMaxPx && this.shotCooldown === 0) {
      this.shotCooldown = SHOT_COOLDOWN_FRAMES;
      this.drawTimer = BONE_ARROW_DRAW_FRAMES;
      this.isMoving = false;
    }
  }

  /**
   * Retreats directly away from a target that has closed inside the band.
   *
   * Straight-line rather than pathfound on purpose: an archer that A*s its way
   * backwards around a corner spends the whole retreat facing its own path and
   * never shoots. Backed into a wall it simply stops, which is the correct
   * outcome — cornering the archer is how the player beats it.
   */
  private backAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.moveWithCollision((dx / distance) * this.speed, (dy / distance) * this.speed);
    this.isMoving = true;
    this.faceToward(target);
  }

  /** Where the arrow leaves the archer, offset toward whichever way it faces. */
  private bowPosition(): { readonly x: number; readonly y: number } {
    const facing = Math.sign(this.facingX) || 1;
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + BOW_OFFSET_X * facing),
      y: this.y + this.tileSize * (CENTER_OFFSET + BOW_OFFSET_Y),
    };
  }

  /**
   * Queues one arrow, aimed at wherever the target is on the release frame
   * rather than where it was when the draw began — otherwise the telegraph is
   * free to dodge and the shot never lands on a moving player.
   */
  private loose(): void {
    const target = this.currentTarget;
    const bow = this.bowPosition();
    const aimX = target ? target.x + this.tileSize * CENTER_OFFSET : bow.x + this.facingX;
    const aimY = target ? target.y + this.tileSize * CENTER_OFFSET : bow.y + this.facingY;
    const dirX = aimX - bow.x;
    const dirY = aimY - bow.y;
    // A target standing exactly on the bow would give a zero direction, which
    // normalises to NaN and produces an arrow that never moves and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingShots.push({
      kind: 'bone_arrow',
      x: bow.x,
      y: bow.y,
      dirX: degenerate ? this.facingX || 1 : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(ARROW_DAMAGE),
      mobType: this.mobType,
      aimedAt: target,
    });
    this.projectileSoundPending = true;
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

    drawSkeletonArcherSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      attackProgress: this.drawTimer > 0 ? 1 - this.drawTimer / BONE_ARROW_DRAW_FRAMES : null,
      riseProgress: rise,
    });

    if (rise === null) this.renderMobHealthBar(ctx, sx, sy);
  }
}
