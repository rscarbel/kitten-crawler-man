import type { Player } from '../Player';
import { PLAYER_SPEED } from '../core/constants';
import { Mob } from './Mob';
import {
  MANTIS_BODY_PART_KEY,
  drawMantidSprite,
  mantidCullMarginTiles,
  mantidOverheadLiftTiles,
} from '../sprites/mantidSprite';

/**
 * A crony mantis — the escort that spawns alongside the Mantid on a bounty.
 *
 * Built as a first-class regular mob rather than as a boss appendage, and
 * registered under its own `'mantis'` spawner key, because it is meant to be
 * reused as an ambient floor-3 enemy later. Nothing in this class knows the
 * Mantid exists.
 */

const MANTIS_HP = 22;
const MANTIS_SPEED = 1.35;
/**
 * Ceiling on the walk, for the same reason the Mantid has one: `applyMobLevel`
 * adds 8% a level with nothing above it, so an escort spawned at a bounty
 * mark's level outran the player outright and a pair of them could not be
 * broken away from at all. A shade slower than the boss's own ceiling — the
 * cronies flank, they do not lead.
 */
const MANTIS_WALK_ADVANTAGE = 1.04;
const MANTIS_MAX_SPEED = PLAYER_SPEED * MANTIS_WALK_ADVANTAGE;
const AGGRO_RANGE_TILES = 7;
/** Reach of the raptorial strike, in tiles from the mantis's own tile origin. */
const SLASH_RANGE_TILES = 1.15;
const SLASH_DAMAGE = 4;
/**
 * Frames of wind-up before the strike lands.
 *
 * Short, but not zero: the arms visibly cock in this window, and it is the only
 * warning a player gets from an animal this fast.
 */
const SLASH_WINDUP_FRAMES = 20;
/** Frames of follow-through after the hit, during which the mantis is committed. */
const SLASH_RECOVER_FRAMES = 16;
/** Length of one complete strike. Exported so the `?mantid` harness plays it at her tempo. */
export const MANTIS_SLASH_TOTAL_FRAMES = SLASH_WINDUP_FRAMES + SLASH_RECOVER_FRAMES;
/** Frames between the end of one strike and the earliest start of the next. */
const SLASH_COOLDOWN_FRAMES = 42;

const COIN_DROP_MIN = 6;
const COIN_DROP_MAX = 11;
const XP_VALUE = 22;
/** Heavier than a rat, lighter than anything armoured — it is a big insect. */
const MASS = 1.2;
/**
 * Lift and cull margin used before the sheet has loaded; the live values are
 * measured from the manifest, so a rebake that resizes the cell cannot silently
 * clip the art at the screen edge or detach the aggro tell from its head.
 */
const FALLBACK_ART_HEIGHT_TILES = 0.6;
const FALLBACK_CULL_MARGIN_TILES = 1;

/** How close the pursuit stops, as a fraction of the strike's own reach. */
const PURSUIT_STOP_RATIO = 0.85;

export class MantisCrony extends Mob {
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'mantis';
  override readonly bodyPartKey = MANTIS_BODY_PART_KEY;
  displayName = 'Mantis';
  description = 'A man-sized praying mantis. It watches you with its whole head.';
  mass = MASS;

  /** Nothing rides above her art, so the margin is the art's own overhang. */
  override get cullMarginTiles(): number {
    return mantidCullMarginTiles('mantis', 0, FALLBACK_CULL_MARGIN_TILES);
  }

  /** Counts down through the wind-up and then the recovery; 0 when not striking. */
  private slashTimer = 0;
  private slashLanded = false;
  private slashCooldown = 0;
  private aggroRangePx: number;
  private slashRangePx: number;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, MANTIS_HP, MANTIS_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.slashRangePx = tileSize * SLASH_RANGE_TILES;
  }

  /** Levels up, then puts the ceiling back on the walk. See {@link MANTIS_MAX_SPEED}. */
  override applyMobLevel(level: number): void {
    super.applyMobLevel(level);
    this.speed = Math.min(this.speed, MANTIS_MAX_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.slashTimer = 0;
    this.slashLanded = false;
    this.slashCooldown = 0;
    this.isAggro = false;
  }

  /**
   * Drops a strike that confusion has frozen.
   *
   * `MobUpdateLoop` skips `updateAI` for a confused mob and `slashTimer` only
   * advances inside it, so a fogged mantis would wander the map holding a
   * half-finished swing and then land it the instant the fog lifted. `tickTimers`
   * is the one per-frame hook the loop runs for confused mobs too.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (!this.isConfused || this.slashTimer <= 0) return;
    this.slashTimer = 0;
    this.slashLanded = false;
    this.slashCooldown = SLASH_COOLDOWN_FRAMES;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.slashCooldown > 0) this.slashCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;

    if (this.slashTimer > 0) {
      this.advanceSlash(nearest);
      return;
    }

    if (nearest === null) {
      this.isAggro = false;
      this.clearAStarPath();
      // Not `doWander`: BountySystem anchors an un-aggroed escort to its bounty
      // site with `homePoint`, and only this path consults it.
      this.returnHomeOrWander();
      return;
    }

    this.isAggro = true;
    this.updateLastKnown(nearest);
    const distance = this.distanceTo(nearest);

    if (distance <= this.slashRangePx && this.slashCooldown === 0) {
      this.slashTimer = MANTIS_SLASH_TOTAL_FRAMES;
      this.slashLanded = false;
      this.isMoving = false;
      this.faceToward(nearest);
      return;
    }

    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      this.slashRangePx * PURSUIT_STOP_RATIO,
    );
    // `followTargetCollide` returns before writing facing once it is inside its
    // stop range, so a mantis holding position would keep whatever heading it
    // last walked and strike sideways.
    if (!this.isMoving) this.faceToward(nearest);
  }

  /**
   * Runs the committed strike. The wind-up tracks the target so a player who
   * steps around the mantis is still swung at; the damage frame itself does not,
   * so stepping *out of reach* still beats it.
   */
  private advanceSlash(target: Player | null): void {
    this.slashTimer--;
    this.isMoving = false;
    this.isAggro = target !== null;
    if (this.slashTimer > SLASH_RECOVER_FRAMES && target !== null) this.faceToward(target);

    if (!this.slashLanded && this.slashTimer <= SLASH_RECOVER_FRAMES) {
      this.slashLanded = true;
      if (target !== null && this.distanceTo(target) <= this.slashRangePx) {
        this.dealDamage(target, SLASH_DAMAGE, 'raptorial_slash');
      }
    }
    if (this.slashTimer <= 0) this.slashCooldown = SLASH_COOLDOWN_FRAMES;
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

    drawMantidSprite(ctx, 'mantis', sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      slashProgress: this.slashTimer > 0 ? 1 - this.slashTimer / MANTIS_SLASH_TOTAL_FRAMES : null,
    });

    // Both the aggro tell and the health bar clear the art for the same reason:
    // `renderHealthBar` paints a few pixels above the *tile*, which on art that
    // overhangs it lands across the animal's own thorax.
    const overheadY = sy - tileSize * mantidOverheadLiftTiles('mantis', FALLBACK_ART_HEIGHT_TILES);
    if (this.isAggro) this.renderAggroIndicator(ctx, sx, overheadY, tileSize);
    this.renderMobHealthBar(ctx, sx, overheadY);
  }
}
