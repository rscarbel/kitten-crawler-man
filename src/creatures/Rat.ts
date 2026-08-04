import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import {
  RAT_BITE_FRAMES,
  RAT_BITE_IMPACT_PROGRESS,
  RAT_BODY_PART_KEY,
  drawRatSprite,
} from '../sprites/ratSprite';

const RAT_HP = 3;
const RAT_SPEED = 1.1;
const AGGRO_RANGE_TILES = 3;
const BITE_RANGE_TILES = 1.1;
/** Frames between bites (~2 s at 60 fps) */
const ATTACK_COOLDOWN = 120;
/**
 * Frames from the moment a bite is committed to until the jaws close on the
 * target. The art gathers, lunges and only then snaps, so damage landing on
 * commit would play the animation as a reaction to a hit already taken.
 */
const BITE_IMPACT_DELAY = Math.round(RAT_BITE_FRAMES * RAT_BITE_IMPACT_PROGRESS);
const BITE_DAMAGE = 1;
/** Fraction of bite range to use as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/** Fraction of bite range to check engagement for first-bite windup. */
const ENGAGE_RANGE_FRACTION = 1.15;

export class Rat extends Mob {
  /** Vermin survive everything; the rarest of them leave the manual behind. */
  protected override rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    maybeDropSkillBook(items, 'skill_book_cockroach');
    return items;
  }
  readonly xpValue = 2;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  override readonly audioTag = 'rat';
  override readonly bodyPartKey = RAT_BODY_PART_KEY;
  displayName = 'Rat';
  description = 'A nimble rodent that bites when cornered.';

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  /** Counts down to the frame the jaws close; 0 when no bite is in flight. */
  private biteImpactTimer = 0;
  private biteTarget: Player | null = null;
  private isAggro = false;
  private firstBitePending = true;
  private firstBiteWindup = 0;

  private readonly aggroRangePx: number;
  private readonly biteRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, RAT_HP, RAT_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.biteRangePx = tileSize * BITE_RANGE_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.biteImpactTimer = 0;
    this.biteTarget = null;
    this.isAggro = false;
    this.firstBitePending = true;
    this.firstBiteWindup = 0;
  }

  /**
   * Lands a bite committed to `BITE_IMPACT_DELAY` frames ago. The target is
   * re-checked rather than trusted: it can die, or walk out of reach, between
   * the lunge starting and the jaws closing.
   */
  private resolvePendingBite(): void {
    if (this.biteImpactTimer === 0) return;
    this.biteImpactTimer--;
    if (this.biteImpactTimer > 0) return;

    const target = this.biteTarget;
    this.biteTarget = null;
    if (target?.isAlive !== true) return;
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist > this.biteRangePx * ENGAGE_RANGE_FRACTION) return;
    this.dealDamage(target, BITE_DAMAGE);
  }

  /**
   * The bite plays out here rather than in `updateAI` because a confused rat
   * never reaches `updateAI` at all (`MobUpdateLoop` sends it straight to
   * `doWander`). Left there, a rat confused mid-lunge would freeze on one frame
   * of the animation and hold its pending bite until the confusion wore off.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;
    this.resolvePendingBite();
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;

    const nearest = this.acquireTarget(targets, this.aggroRangePx);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.firstBitePending = true;
      this.firstBiteWindup = 0;
      this.clearAStarPath();
      this.doWander();
      return;
    }

    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);

    // Track last known position while we have LOS
    this.updateLastKnown(nearest);

    // Skitter toward last known position (= current when LOS clear)
    if (nearestDist > this.biteRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.biteRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    // Short windup before the first bite of each engagement
    const inRange = nearestDist <= this.biteRangePx * ENGAGE_RANGE_FRACTION;

    // Once it stops walking nothing else writes `facing`, and the sheet has a
    // pose per viewpoint — a rat that overshot its target would otherwise chew
    // on someone standing in front of it while playing the walking-away art.
    // Held still mid-bite: facing picks the viewpoint, so re-facing during a
    // lunge would cut from the profile pose to the head-on one mid-bite.
    if (inRange && this.attackAnimTimer === 0) this.faceToward(nearest);
    if (inRange && this.firstBitePending && this.firstBiteWindup === 0) {
      this.firstBiteWindup = 10;
      this.firstBitePending = false;
    }
    if (this.firstBiteWindup > 0) this.firstBiteWindup--;

    // Same-tile contact always bites — can't dodge point-blank.
    if (
      inRange &&
      this.attackCooldown === 0 &&
      this.firstBiteWindup === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.biteTarget = nearest;
      this.biteImpactTimer = BITE_IMPACT_DELAY;
      this.attackCooldown = this.scaledCooldownFrames(ATTACK_COOLDOWN);
      this.attackAnimTimer = RAT_BITE_FRAMES;
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    const biteProgress =
      this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / RAT_BITE_FRAMES : null;

    drawRatSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      biteProgress,
    });

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
