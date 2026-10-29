import { Mob } from './Mob';
import type { EyePlacement } from '../sprites/eyePlacement';
import { scaledCooldownFramesForLevel } from './mobLevelScaling';
import type { Player } from '../Player';
import {
  LIZARDMAN_BODY_PART_KEY,
  drawLizardmanSprite,
  prewarmLizardmanGore,
  prewarmLizardmanStrike,
  prewarmLizardmanTongue,
} from '../sprites/lizardmanSprite';
import {
  LIZARDMAN_TONGUE_OVERREACH,
  LIZARDMAN_TONGUE_RANGE_TILES,
} from '../sprites/lizardmanTongue';
import { LASH_IMPACT_PROGRESS } from '../sprites/art/lizardmanFigure';
import { makeNumbed, makePoison } from '../core/combat/StatusEffect';
import { settings } from '../core/input/Settings';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import { normalize } from '../utils';
import type { LootDrop } from './Mob';
import { riposteCooldown } from './tactics/riposte';
import type { TacticsTrait } from './tactics/tacticsTraits';

const LIZARDMAN_HP = 22;
const LIZARDMAN_SPEED = 0.7;

const AGGRO_RANGE_TILES = 8;
/**
 * Range and overreach come from `lizardmanTongue.ts` rather than living here,
 * because the tongue *art* has to reach exactly this far: the overlay is scaled
 * per view against these values so its tip lands on the hit boundary. Two
 * copies and the thing that visibly reaches the player stops being the thing
 * that damages them.
 */
const TONGUE_RANGE_TILES = LIZARDMAN_TONGUE_RANGE_TILES;
/**
 * Light for its size on purpose. The lizardman carries the most HP of any
 * regular mob, and a fight's cost is how long a mob lives times how hard it
 * hits, so a tank that also hit hardest would make a room or den of them the
 * one regular fight that empties the party's bar. It is the tank the party
 * works through, not the damage.
 */
const TONGUE_DAMAGE = 3;
const POISON_CHANCE = 0.25;

/**
 * Whether a tongue that connects also numbs the legs it hits, by difficulty.
 * Only Nightmare: a slowed crawler loses the step that dodges the next lash,
 * which is the harder fight that difficulty promises. Read live, so a
 * difficulty change mid-floor applies to the very next lash.
 */
const LIZARDMAN_VENOM_SLOWS = {
  easy: false,
  normal: false,
  hard: true,
} as const satisfies Record<Difficulty, boolean>;

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
export const LIZARDMAN_WINDUP_FLOOR_FRAMES = 32;
/**
 * How long before the strike the aim freezes, in frames.
 *
 * Deliberately a constant rather than a fraction of the windup: this is the
 * dodgeable part, so scaling it with level would shrink the telegraph itself
 * instead of the tracking that precedes it. At the windup floor the split is 7
 * frames of tracking to 25 frames locked, comfortably over the fairness rule's
 * 21-frame minimum, so a higher-level lizardman commits *sooner* rather than
 * warning you less.
 */
export const LIZARDMAN_AIM_LOCK_FRAMES = 25;

/**
 * How long a lizardman of this level gapes before its tongue fires.
 *
 * A free function as well as the method the creature calls, so
 * `scripts/verify-difficulty.ts` can assert the floor and the locked-telegraph
 * split against the arithmetic the game actually runs.
 */
export function lizardmanWindupFrames(level: number): number {
  return Math.max(
    LIZARDMAN_WINDUP_FLOOR_FRAMES,
    scaledCooldownFramesForLevel(WINDUP_FRAMES, level),
  );
}
const STRIKE_FRAMES = 18;
/** How wide the mouth stays while the tongue is out: open, but past the windup's full gape. */
const STRIKE_MOUTH_OPEN = 0.75;

/**
 * The frame of the strike the tongue is fully out on, counted down the way
 * `strikeTimer` runs.
 *
 * Derived from the art's own peak rather than restated as half the row. The
 * tongue overlay's reach and the damage check have to be the same instant — a
 * tongue that visibly lands a frame away from the frame that hurts reads as a
 * hit the player could not have dodged — and two copies of "halfway" drift the
 * moment the lash choreography is retimed.
 */
const IMPACT_TIMER = Math.round(STRIKE_FRAMES * (1 - LASH_IMPACT_PROGRESS));
const COOLDOWN_FRAMES = 150;
/** Fraction of tongue range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.85;
const TONGUE_HIT_RANGE_FRACTION = LIZARDMAN_TONGUE_OVERREACH;
/** Minimum dot product for tongue cone (cos(60°) ≈ 0.5). */
const TONGUE_CONE_MIN_DOT = 0.5;
/** Tile center offset fraction. */
const TILE_CENTER = 0.5;
/** Energy Shield XP per blocked tongue strike. */
const TONGUE_BLOCK_XP = 3;

type LizardmanState = 'idle' | 'stalking' | 'winding_up' | 'striking' | 'cooldown';

const LIZARDMAN_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];

/** Where its eyes sit, for eye-shine in the dark. A tall stooped body: the head sits ahead of the hips and over the top of the tile. */
const LIZARDMAN_EYES: EyePlacement = {
  sideForward: 0.2,
  sideHeight: -0.08,
  sideSpacing: 0.06,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.05,
  frontSpacing: 0.16,
};

export class Lizardman extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return LIZARDMAN_EYES;
  }

  readonly xpValue = 20;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Lizardman';
  description = 'A scaled ambush hunter that lashes a barbed, venomous tongue from range.';
  override readonly audioTag = 'lizardman';
  override get bodyPartKey(): string {
    return LIZARDMAN_BODY_PART_KEY;
  }

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

  private state: LizardmanState = 'idle';
  private windupTimer = 0;
  /**
   * How long the windup currently under way was started at. Held rather than
   * read back off {@link WINDUP_FRAMES}, because the gape animation is driven
   * off elapsed-over-total and a level-scaled windup makes those two different
   * numbers — using the constant would leave a high-level lizardman's mouth
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
    super(tileX, tileY, tileSize, LIZARDMAN_HP, LIZARDMAN_SPEED);
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

  /**
   * A slow brawler that fights at tongue's length: it can learn to come at its
   * quarry from an angle, turn a blow aside and answer it, and fall back on a
   * denmate when hurt. Never `kite` — at its pace a retreat is just a free
   * stretch of hits on its back.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return LIZARDMAN_TACTICS;
  }

  /** No coins, no gear. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    const ts = this.tileSize;
    const aggroRangePx = ts * AGGRO_RANGE_TILES;
    const tongueRangePx = ts * TONGUE_RANGE_TILES;

    const nearest = this.acquireTarget(targets, aggroRangePx);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;
    this.currentTarget = nearest;
    if (!nearest) this.tactics.disengage();
    this.answerGuard();

    switch (this.state) {
      case 'idle': {
        this.mouthOpenAmt = 0;
        this.tongueExtend = 0;
        this.strikeProgress = null;
        if (nearest) {
          this.state = 'stalking';
          // The windup's own first frame is already a gape cell, and the nine
          // severed pieces are all drawn on the single frame the creature comes
          // apart. Noticing a crawler is the only warning either of those gets.
          prewarmLizardmanStrike();
          prewarmLizardmanGore();
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

        // Nothing is committed while stalking, so a tactic may always steer it.
        const tacticalMove = this.chooseTacticalStep(nearest, tongueRangePx, true);
        if (tacticalMove?.breaksOff === true) {
          this.walkTacticalStep(tacticalMove, nearest);
        } else if (nearestDist <= tongueRangePx && this.hasLOS(nearest)) {
          // In tongue range — start the slow windup
          this.state = 'winding_up';
          // The tongue is drawn on no frame of the windup, so the telegraph is
          // a whole row's worth of lead on the one overlay a strike needs.
          prewarmLizardmanTongue();
          this.windupDuration = lizardmanWindupFrames(this.mobLevel);
          this.windupTimer = this.windupDuration;
          this.isMoving = false;
          this._faceToward(nearest);
        } else if (this.isBeyondLeash(this.x, this.y)) {
          // A den's resident that has strayed past its own leash stops
          // *travelling* and heads home — but it keeps its target, so anything
          // that follows it still gets stalked and struck. No-op for an
          // unleashed lizardman: every one on floors 1 and 2. See
          // `Mob.isBeyondLeash`.
          this.returnHomeOrWander();
        } else if (tacticalMove !== null) {
          this.walkTacticalStep(tacticalMove, nearest);
        } else {
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
        // buys a lizardman is committing sooner — never a shorter warning.
        const lockThreshold = LIZARDMAN_AIM_LOCK_FRAMES;
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
        this.mouthOpenAmt = STRIKE_MOUTH_OPEN;
        this.strikeProgress = (STRIKE_FRAMES - this.strikeTimer) / STRIKE_FRAMES;

        if (this.strikeTimer > IMPACT_TIMER) {
          this.tongueExtend = (STRIKE_FRAMES - this.strikeTimer) / (STRIKE_FRAMES - IMPACT_TIMER);
        } else {
          this.tongueExtend = this.strikeTimer / IMPACT_TIMER;
        }

        // Read at the moment of impact rather than at the windup, so the player
        // can dodge while the telegraph is still playing.
        if (this.strikeTimer === IMPACT_TIMER) {
          for (const t of targets) {
            if (!t.isAlive) continue;
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > tongueRangePx * TONGUE_HIT_RANGE_FRACTION) continue;

            const dot = (dx / dist) * this.facingX + (dy / dist) * this.facingY;
            if (dot < TONGUE_CONE_MIN_DOT) continue;

            // The party's energy shield turns aside an enemy's tongue, never a turned ally's.
            const shielded =
              !this.isConverted &&
              this.spells?.isPointInsideEnergyShield(
                t.x + ts * TILE_CENTER,
                t.y + ts * TILE_CENTER,
              ) === true;
            if (shielded && this.spells !== null) {
              this.spells.addBlockXp(TONGUE_BLOCK_XP);
              continue;
            }

            const connected = this.dealRangedDamage(t, TONGUE_DAMAGE);
            if (!connected) continue;
            if (Math.random() < POISON_CHANCE) {
              // A turned ally's poison is its own blow, so a kill it finishes is credited.
              t.applyStatus(makePoison(this.isConverted ? this : null));
            }
            if (LIZARDMAN_VENOM_SLOWS[settings.difficulty]) {
              t.applyStatus(makeNumbed());
              this.specialSoundPending = true;
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

  /**
   * Spend a riposte a guard earned. A guard met while the tongue is winding up
   * or out is answered after that strike, by cutting the wait that follows it;
   * one met while stalking needs no answer, since a stalking lizardman gapes
   * the moment it is in reach. The windup itself is never shortened.
   */
  private answerGuard(): void {
    if (this.state === 'winding_up' || this.state === 'striking') return;
    if (!this.tactics.claimRiposte() || this.state !== 'cooldown') return;
    this.cooldownTimer = riposteCooldown(this.cooldownTimer, 0);
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

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawLizardmanSprite(ctx, sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        isMoving: this.isMoving,
        facingX: this.facingX,
        facingY: this.facingY,
        gapeProgress: this.mouthOpenAmt,
        strikeProgress: this.strikeProgress,
        tongueExtend: this.tongueExtend,
      });
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
