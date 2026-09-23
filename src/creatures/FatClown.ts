import { Mob } from './Mob';
import type { Player } from '../Player';
import {
  FAT_CLOWN_ATTACK_STATES,
  FAT_CLOWN_LOCOMOTION_STATES,
  drawFatClownSprite,
  prewarmFatClownStates,
  type FatClownAnimation,
  IDLE_LOOP_SECONDS,
} from '../sprites/fatClownSprite';
import { SLAM_WINDUP_END } from '../sprites/art/clownFigure';
import { PLAYER_SPEED } from '../core/constants';
import { riposteCooldown } from './tactics/riposte';
import type { TacticsTrait } from './tactics/tacticsTraits';

const CLOWN_HP = 30;
const CLOWN_SPEED = 0.7;
/** A levelled clown's walk is capped at this fraction of the player's. */
const CLOWN_MAX_SPEED_RATIO = 0.8;
export const CLOWN_MAX_SPEED = PLAYER_SPEED * CLOWN_MAX_SPEED_RATIO;
/** How far a fat clown notices from. Exported for the bounty troupe's regression gate. */
export const FAT_CLOWN_AGGRO_RANGE_TILES = 6;
const ATTACK_RANGE_TILES = 1.2;
/**
 * Sized for the Evil Clown's troupe, where this clown fights at the party's own
 * level: a slam there must leave an on-schedule crawler a quarter of her bar
 * (`BOUNTY_MAX_BLOW_HP_SHARE`). The circus waves meet it lower, and feel it less.
 */
const ATTACK_DAMAGE = 4;
/** Frames between slams (~1.8 s at 60 fps). */
const ATTACK_COOLDOWN = 110;
/** Frames the slam animation plays. */
const ATTACK_ANIM_FRAMES = 30;
/**
 * Point in the slam row where the shoulder drives through, taken from the
 * choreography that paints it rather than copied beside it.
 */
const IMPACT_ANIM_PROGRESS = SLAM_WINDUP_END;
/** The countdown value {@link ATTACK_ANIM_FRAMES} reaches at that moment. */
const IMPACT_TIMER_FRAME = Math.round(ATTACK_ANIM_FRAMES * (1 - IMPACT_ANIM_PROGRESS));
const COIN_DROP_MIN = 1;
const COIN_DROP_MAX = 3;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.8;
/**
 * The sheet's tile sits 76px down a 160px frame at a 64px tile scale, so the
 * art reaches a little over one tile above the tile it stands on.
 */
const CULL_MARGIN_TILES = 2;
const FAT_CLOWN_TACTICS: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];

/**
 * Grimaldi's performers fight as one troupe: a stilt clown and a fat clown
 * after the same player fan out around each other and fall back on each
 * other, where two classes left to their own kinds would each see half a pack.
 */
export const CIRCUS_CLOWN_PACK_KIND = 'circus_clown';

/**
 * A Fat Clown — one of Grimaldi's corrupted performers, tanky and slow with
 * a heavy shoulder-slam attack. The circus questline's bread-and-butter bruiser.
 */
export class FatClown extends Mob {
  readonly xpValue = 20;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Fat Clown';
  description = 'A bloated, corrupted circus performer that slams into prey.';
  override readonly audioTag = 'clown';

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  protected override get levelledSpeedCap(): number {
    return CLOWN_MAX_SPEED;
  }

  override get packKind(): string {
    return CIRCUS_CLOWN_PACK_KIND;
  }

  /** A flank can be walking it while its swing still plays, and turning then would flip the arc. */
  protected override get isSwingAnimating(): boolean {
    return this.attackAnimTimer > 0;
  }

  /**
   * The troupe's bruiser: it can learn to come at its quarry from an angle,
   * turn a blow aside and answer it, and fall back on the troupe when hurt.
   * Never `kite` — its job is to stand between the player and whatever it
   * escorts, and a clown that backs away opens the very path it is there to
   * close. A regroup is one short walk per life, so the wall comes back.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return FAT_CLOWN_TACTICS;
  }

  /** Staggers this clown's idle loop so a pack of them does not move as one. */
  private readonly idlePhaseOffsetSeconds = Math.random() * IDLE_LOOP_SECONDS;

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CLOWN_HP, CLOWN_SPEED);
    // Warmed at construction, which is the moment a spawn is scheduled: these
    // two arrive in pairs and start walking on the frame they appear.
    prewarmFatClownStates(FAT_CLOWN_LOCOMOTION_STATES);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.isAggro = false;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    const aggroRangePx = this.tileSize * FAT_CLOWN_AGGRO_RANGE_TILES;
    const attackRangePx = this.tileSize * ATTACK_RANGE_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.tactics.disengage();
      this.clearAStarPath();
      // `returnHomeOrWander`, not `doWander`: this class is reused as a bounty
      // encounter's escort, and only the former honours the `homePoint` the
      // BountySystem anchors the encounter to its site with. With no home set it
      // is exactly `doWander`, so the circus spawns are unchanged.
      this.returnHomeOrWander();
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

    // The slam plays out while stopped and nothing else writes facing then.
    // Held still mid-slam so the swing cannot flip halfway through.
    if (nearestDist <= attackRangePx && this.attackAnimTimer === 0) {
      this.faceToward(nearest);
    }

    if (
      nearestDist <= attackRangePx &&
      this.attackCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
      prewarmFatClownStates(FAT_CLOWN_ATTACK_STATES);
    }

    // The slam only connects once the shoulder has actually swung through, so
    // the hit lands mid-animation rather than on the frame the windup starts.
    if (this.attackAnimTimer === IMPACT_TIMER_FRAME && nearestDist <= attackRangePx) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
    }
  }

  private animation(): FatClownAnimation {
    if (this.attackAnimTimer > 0) {
      return { kind: 'slam', progress: 1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES };
    }
    if (this.isMoving) return { kind: 'walk', cycle: this.walkFrame };
    return { kind: 'idle', phaseOffsetSeconds: this.idlePhaseOffsetSeconds };
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

    drawFatClownSprite(ctx, sx, sy, tileSize, this.facingX, this.animation());

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
