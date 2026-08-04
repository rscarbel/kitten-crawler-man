import { Mob, scaledCooldownFramesForLevel } from './Mob';
import { maybeDropSkillBook } from './skillBookDrop';
import type { Player } from '../Player';
import { TROGLODYTE_BODY_PART_KEY, drawTroglodyteSprite } from '../sprites/troglodyteSprite';
import {
  TROGLODYTE_TONGUE_OVERREACH,
  TROGLODYTE_TONGUE_RANGE_TILES,
} from '../sprites/troglodyteTongue';
import { makePoison } from '../core/StatusEffect';
import { normalize } from '../utils';
import type { LootDrop } from './Mob';

const TROG_HP = 22;
const TROG_SPEED = 0.7;

const AGGRO_RANGE_TILES = 8;
/**
 * Range and overreach come from `troglodyteTongue.ts` rather than living here,
 * because the tongue *art* has to reach exactly this far: the overlay is scaled
 * per view against these values so its tip lands on the hit boundary. Two
 * copies and the thing that visibly reaches the player stops being the thing
 * that damages them.
 */
const TONGUE_RANGE_TILES = TROGLODYTE_TONGUE_RANGE_TILES;
const TONGUE_DAMAGE = 4;
const POISON_CHANCE = 0.25;

/** Slow, menacing windup at level 1. Shortened with level, never past the floor. */
const WINDUP_FRAMES = 50;
/**
 * The shortest the windup ever gets, in frames.
 *
 * Explicit rather than left to the cadence curve, because the curve's own floor
 * (50 × 0.55 ≈ 28) would leave only three frames of aim tracking — at which
 * point the strike is effectively instantaneous and the *whole* attack, not just
 * its tracking half, has stopped being something a player can read.
 */
export const TROGLODYTE_WINDUP_FLOOR_FRAMES = 32;
/**
 * How long before the strike the aim freezes, in frames.
 *
 * Deliberately a constant rather than a fraction of the windup: this is the
 * dodgeable part, so scaling it with level would shrink the telegraph itself
 * instead of the tracking that precedes it. At the windup floor the split is 7
 * frames of tracking to 25 frames locked, comfortably over the fairness rule's
 * 21-frame minimum, so a higher-level troglodyte commits *sooner* rather than
 * warning you less.
 */
export const TROGLODYTE_AIM_LOCK_FRAMES = 25;

/**
 * How long a troglodyte of this level gapes before its tongue fires.
 *
 * A free function as well as the method the creature calls, so
 * `scripts/verify-difficulty.ts` can assert the floor and the locked-telegraph
 * split against the arithmetic the game actually runs.
 */
export function troglodyteWindupFrames(level: number): number {
  return Math.max(
    TROGLODYTE_WINDUP_FLOOR_FRAMES,
    scaledCooldownFramesForLevel(WINDUP_FRAMES, level),
  );
}
const STRIKE_FRAMES = 18; // 9 frames out, 9 frames back
const COOLDOWN_FRAMES = 150;
/** Fraction of tongue range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.85;
const TONGUE_HIT_RANGE_FRACTION = TROGLODYTE_TONGUE_OVERREACH;
/** Minimum dot product for tongue cone (cos(60°) ≈ 0.5). */
const TONGUE_CONE_MIN_DOT = 0.5;
/** Tile center offset fraction. */
const TILE_CENTER = 0.5;
/** Shell XP per blocked tongue strike. */
const TONGUE_BLOCK_XP = 3;

type TrogState = 'idle' | 'stalking' | 'winding_up' | 'striking' | 'cooldown';

export class Troglodyte extends Mob {
  readonly xpValue = 20;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Troglodyte';
  description = 'A cave-dwelling predator with a venomous tongue lash.';
  override readonly audioTag = 'troglodyte';
  override readonly bodyPartKey = TROGLODYTE_BODY_PART_KEY;

  override get requiresEvasion(): boolean {
    return true;
  }

  /** 0–1: how far the tongue is currently extended (for sprite). */
  tongueExtend = 0;
  /** 0–1: how wide the mouth is open (0 = barely open, 1 = full windup). */
  mouthOpenAmt = 0;
  /**
   * 0–1 through the strike, rising monotonically.
   *
   * Separate from {@link tongueExtend}, which rises and then falls back as the
   * tongue is reeled in: the sprite's strike row is a one-shot that has to play
   * forward once, and driven off the tongue it would play forward and then
   * backward through its own recovery frames.
   */
  strikeProgress: number | null = null;

  private state: TrogState = 'idle';
  private windupTimer = 0;
  /**
   * How long the windup currently under way was started at. Held rather than
   * read back off {@link WINDUP_FRAMES}, because the gape animation is driven
   * off elapsed-over-total and a level-scaled windup makes those two different
   * numbers — using the constant would leave a high-level troglodyte's mouth
   * only part-way open at the moment it strikes.
   */
  private windupDuration = WINDUP_FRAMES;
  private strikeTimer = 0;
  private cooldownTimer = 0;

  /** Facing direction locked in at the moment strike commits (partway through windup). */
  private lockedFacingX = 0;
  private lockedFacingY = 0;
  private facingLocked = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TROG_HP, TROG_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.tongueExtend = 0;
    this.mouthOpenAmt = 0;
    this.state = 'idle';
    this.windupTimer = 0;
    this.windupDuration = WINDUP_FRAMES;
    this.strikeTimer = 0;
    this.cooldownTimer = 0;
    this.strikeProgress = null;
    this.facingLocked = false;
  }

  /** No coins, no gear — only, very rarely, a lifetime in the dark written down. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    maybeDropSkillBook(items, 'skill_book_night_vision');
    return items;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const ts = this.tileSize;
    const aggroRangePx = ts * AGGRO_RANGE_TILES;
    const tongueRangePx = ts * TONGUE_RANGE_TILES;

    const nearest = this.acquireTarget(targets, aggroRangePx);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;
    this.currentTarget = nearest;

    switch (this.state) {
      case 'idle': {
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        this.strikeProgress = null;
        if (nearest) {
          this.state = 'stalking';
        } else {
          this.returnHomeOrWander();
        }
        break;
      }

      case 'stalking': {
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        this.strikeProgress = null;
        if (!nearest) {
          this.state = 'idle';
          this.clearAStarPath();
          break;
        }
        this.updateLastKnown(nearest);

        if (nearestDist <= tongueRangePx && this.hasLOS(nearest)) {
          // In tongue range — start the slow windup
          this.state = 'winding_up';
          this.windupDuration = troglodyteWindupFrames(this.mobLevel);
          this.windupTimer = this.windupDuration;
          this.isMoving = false;
          this._faceToward(nearest);
        } else if (this.isBeyondLeash(this.x, this.y)) {
          // A den's resident that has strayed past its own leash stops
          // *travelling* and heads home — but it keeps its target, so anything
          // that follows it still gets stalked and struck. No-op for an
          // unleashed troglodyte: every one on floors 1 and 2. See
          // `Mob.isBeyondLeash`.
          this.returnHomeOrWander();
        } else {
          // Slowly lumber toward the player
          this.followTargetAStar(
            this.lastKnownTargetX,
            this.lastKnownTargetY,
            this.speed,
            tongueRangePx * FOLLOW_STOP_FRACTION,
          );
        }
        break;
      }

      case 'winding_up': {
        this.windupTimer--;
        this.mouthOpenAmt = 1 - this.windupTimer / this.windupDuration;
        this.tongueExtend = 0;
        this.strikeProgress = null;
        this.isMoving = false;

        // Track the target until the aim-lock point, then freeze. The locked
        // stretch is a fixed number of frames at every level, so what levelling
        // buys a troglodyte is committing sooner — never a shorter warning.
        const lockThreshold = TROGLODYTE_AIM_LOCK_FRAMES;
        if (this.windupTimer > lockThreshold) {
          if (nearest) this._faceToward(nearest);
          this.lockedFacingX = this.facingX;
          this.lockedFacingY = this.facingY;
          this.facingLocked = false;
        } else if (!this.facingLocked) {
          // Snap to locked direction so the sprite telegraphs where the hit will go
          this.facingX = this.lockedFacingX;
          this.facingY = this.lockedFacingY;
          this.facingLocked = true;
        }

        if (this.windupTimer <= 0) {
          this.state = 'striking';
          this.strikeTimer = STRIKE_FRAMES;
          this.facingLocked = false;
        }
        break;
      }

      case 'striking': {
        this.strikeTimer--;
        this.isMoving = false;
        this.mouthOpenAmt = 0.75;
        this.strikeProgress = (STRIKE_FRAMES - this.strikeTimer) / STRIKE_FRAMES;

        // First half: tongue shoots out; second half: tongue retracts
        const half = STRIKE_FRAMES / 2;
        if (this.strikeTimer > half) {
          this.tongueExtend = (STRIKE_FRAMES - this.strikeTimer) / half;
        } else {
          this.tongueExtend = this.strikeTimer / half;
        }

        // Hit check at peak extension (frame == half), based on position NOW
        // so the player can dodge during the windup telegraph.
        if (this.strikeTimer === half) {
          for (const t of targets) {
            if (!t.isAlive) continue;
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > tongueRangePx * TONGUE_HIT_RANGE_FRACTION) continue;

            const dot = (dx / dist) * this.facingX + (dy / dist) * this.facingY;
            if (dot < TONGUE_CONE_MIN_DOT) continue;

            if (this.spells?.isPointInsideShell(t.x + ts * TILE_CENTER, t.y + ts * TILE_CENTER)) {
              this.spells.addBlockXp(TONGUE_BLOCK_XP);
              continue;
            }

            const connected = this.dealDamage(t, TONGUE_DAMAGE);
            if (connected && Math.random() < POISON_CHANCE) {
              t.applyStatus(makePoison());
            }
          }
        }

        if (this.strikeTimer <= 0) {
          this.tongueExtend = 0;
          this.mouthOpenAmt = 0;
          this.strikeProgress = null;
          this.state = 'cooldown';
          this.cooldownTimer = this.scaledCooldownFrames(COOLDOWN_FRAMES);
        }
        break;
      }

      case 'cooldown': {
        this.cooldownTimer--;
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        this.strikeProgress = null;
        this.isMoving = false;

        if (this.cooldownTimer <= 0) {
          this.state = nearest ? 'stalking' : 'idle';
        }
        break;
      }
    }
  }

  private _faceToward(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx !== 0 || dy !== 0) {
      const n = normalize(dx, dy);
      this.facingX = n.x;
      this.facingY = n.y;
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

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawTroglodyteSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      gapeProgress: this.mouthOpenAmt,
      strikeProgress: this.strikeProgress,
      tongueExtend: this.tongueExtend,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
