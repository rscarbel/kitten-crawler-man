import type { Player } from '../Player';
import { Mob } from './Mob';
import { TILE_SIZE } from '../core/constants';
import {
  BUGABOO_SWIPE_FRAMES,
  BUGABOO_SWIPE_IMPACT_FRAME,
  drawBugabooSprite,
} from '../sprites/bugabooSprite';

const BUGABOO_HP = 8;
const BUGABOO_SPEED = 0.8;
const AGGRO_RANGE_TILES = 20;
const ATTACK_RANGE_TILES = 1.2;
const ATTACK_COOLDOWN = 60;
export const BUGABOO_ATTACK_FRAMES = 16;
const ATTACK_DAMAGE = 2;
/** Fraction of attack range used as follow stop distance. */
const FOLLOW_STOP_FRACTION = 0.6;

/**
 * The frame of the swing on which the claws are at full reach, counted down the
 * way `attackAnimTimer` runs. Damage lands here rather than on the frame the
 * swing starts, so the hit and the picture of the hit are the same event.
 */
const SWIPE_IMPACT_TIMER = Math.round(
  BUGABOO_ATTACK_FRAMES * (1 - BUGABOO_SWIPE_IMPACT_FRAME / BUGABOO_SWIPE_FRAMES),
);

/** How long it takes to haul itself out of a grate once the boards give. */
export const BUGABOO_EMERGE_FRAMES = 34;

/**
 * How close a player has to stand to a breach before the arm coming out of it
 * can reach them, and how hard it grabs. Kept inside a tile: the hazard is
 * "standing on the hole", not "standing near it".
 */
const BREACH_GRAB_RANGE_TILES = 0.7;
const BREACH_GRAB_DAMAGE = 1;
const BREACH_GRAB_COOLDOWN = 42;
/**
 * How close it has to get to a barricaded grate before it counts as breaching
 * it. The breach is drawn *at the grate*, so the body has to be standing there
 * too — stopped a tile short, as it is for anything it can reach with a claw,
 * the player swings at a hole with nothing behind it and the damageable body
 * sits in empty floor beside it.
 */
const BREACH_STAND_RANGE_TILES = 0.2;

/**
 * How far outside the viewport one still has to be drawn.
 *
 * Measured off the bake, not guessed: the art reaches 1.44 tiles above its own
 * tile — it is seven feet tall and its windup puts a claw over its own head — so
 * at the default one tile of slack it pops in with a third of a tile of skull
 * and claw still owed to the bottom edge of the screen. The same number sizes
 * the hit-flash silhouette box, which at the default only clears the crown
 * because a 1.5-tile floor rescues it by two pixels.
 */
const BUGABOO_CULL_MARGIN_TILES = 1.6;

/** What a Bugaboo is doing with its arms this frame, in priority order. */
type SwingTarget = { readonly player: Player } | { readonly barrier: { x: number; y: number } };

export class Bugaboo extends Mob {
  readonly xpValue = 3;
  protected coinDropMin = 0;
  protected coinDropMax = 1;
  displayName = 'Bugaboo';
  description = 'A hulking, owl-eyed beast that bursts from the floor grates.';

  /** Grate tile this Bugaboo spawned from (used by quest system for barrier targeting). */
  assignedGrate: { x: number; y: number } | null = null;
  /** The defend target (quest NPC) this Bugaboo should prioritize. */
  defendTarget: Player | null = null;
  /** Callback for damaging a wood barrier at the assigned grate. */
  onBarrierAttack: ((grate: { x: number; y: number }, damage: number) => boolean) | null = null;
  /** True while this bugaboo is actively breaking through a wood barrier. */
  isBreakingIn = false;

  private aggroRangePx: number;
  private attackRangePx: number;
  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private isAggro = false;
  /** What the swing currently in the air is aimed at; null when it is not swinging. */
  private swingTarget: SwingTarget | null = null;
  private emergeTimer = 0;
  private breachGrabCooldown = 0;
  /**
   * Desynchronises the clock-driven idle and breach loops, so several of these
   * in one room do not breathe or grope in lockstep.
   */
  private readonly loopOffsetSeconds = Math.random();

  override get cullMarginTiles(): number {
    return BUGABOO_CULL_MARGIN_TILES;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BUGABOO_HP, BUGABOO_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.attackRangePx = tileSize * ATTACK_RANGE_TILES;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.swingTarget = null;
    this.emergeTimer = 0;
    this.breachGrabCooldown = 0;
    this.isBreakingIn = false;
    this.isAggro = false;
    // The quest system rebuilds its barrier list and its wave roster on a
    // checkpoint restore, so a grate assignment, its barrier callback and a
    // defend target held across the rewind all point at the old encounter.
    this.releaseGrate();
    this.defendTarget = null;
  }

  /**
   * Plays the haul-out animation before this Bugaboo can act.
   *
   * Called when one spawns straight onto an unbarricaded grate, and again the
   * moment a barricade it was breaking through finally gives — in both cases
   * the creature is coming up through the floor and has to be seen to do it.
   */
  beginEmerge(): void {
    this.emergeTimer = BUGABOO_EMERGE_FRAMES;
    this.isMoving = false;
    // Whatever it was swinging at is behind it now. Left running, the swing
    // lands during the climb and its cooldown burns down out of sight, so it
    // stands next to the player for half a second after arriving unable to act.
    this.attackAnimTimer = 0;
    this.attackCooldown = 0;
    this.swingTarget = null;
    this.releaseGrate();
  }

  /**
   * Forgets the grate this one came up. Boarding grates is the player's whole
   * job in this quest, so a creature that keeps its assignment walks back across
   * the room and dives through the floor again the moment that grate is
   * re-boarded — rendering as an arm out of a hole while standing on top of
   * intact planks, with its health bar snapped off its body onto the grate.
   */
  private releaseGrate(): void {
    this.assignedGrate = null;
    this.onBarrierAttack = null;
  }

  updateAI(targets: Player[]) {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.breachGrabCooldown > 0) this.breachGrabCooldown--;
    this.tickSwing();

    const wasBreakingIn = this.isBreakingIn;
    this.isBreakingIn = false;

    if (this.emergeTimer > 0) {
      this.emergeTimer--;
      this.isMoving = false;
      this.isAggro = true;
      return;
    }

    // Priority 1: If assigned grate has a barrier, attack the barrier
    if (this.assignedGrate && this.onBarrierAttack) {
      const barrierX = this.assignedGrate.x * TILE_SIZE;
      const barrierY = this.assignedGrate.y * TILE_SIZE;
      const distToBarrier = Math.hypot(barrierX - this.x, barrierY - this.y);

      // Check if barrier still exists
      const barrierExists = this.onBarrierAttack(this.assignedGrate, 0);
      if (barrierExists) {
        this.isAggro = true;
        const standRange = TILE_SIZE * BREACH_STAND_RANGE_TILES;
        if (distToBarrier > standRange) {
          // Still walking to it, so it is a creature crossing the floor and is
          // drawn as one; the hole only appears once it is standing on it.
          this.followTargetCollide(barrierX, barrierY, this.speed, standRange);
        } else {
          this.isBreakingIn = true;
          this.isMoving = false;
          if (this.attackCooldown === 0) this.beginSwing({ barrier: this.assignedGrate });
          this.clawAtAnyoneOnTheBreach(targets);
        }
        return;
      }
      // The boards are gone. Released here rather than only on the emerge
      // path, because a swing lands on whatever it was aimed at without
      // re-checking range: shoved off its grate mid-swing — by the separation
      // push, or by a second Bugaboo spawning on the same grate — this one
      // still breaks the boards, and `wasBreakingIn` is false when it does.
      this.releaseGrate();
      // It climbs out before it does anything else, but only if it was actually
      // still in the hole. The grate is where the player's eye already is.
      if (wasBreakingIn) {
        this.beginEmerge();
        return;
      }
    }

    // Priority 2: Attack defend target (NPC) if alive
    if (this.defendTarget?.isAlive) {
      const dist = Math.hypot(this.defendTarget.x - this.x, this.defendTarget.y - this.y);
      this.isAggro = true;
      this.currentTarget = this.defendTarget;

      if (dist > this.attackRangePx) {
        this.followTargetCollide(
          this.defendTarget.x,
          this.defendTarget.y,
          this.speed,
          this.attackRangePx * FOLLOW_STOP_FRACTION,
        );
      } else {
        this.isMoving = false;
        // Nothing else writes facing once it holds position to fight; held still
        // mid-swing so the swipe cannot flip halfway through.
        if (this.attackAnimTimer === 0) this.faceToward(this.defendTarget);
        if (this.attackCooldown === 0) this.beginSwing({ player: this.defendTarget });
      }
      return;
    }

    // Priority 3: Attack nearest player (fallback / NPC dead)
    const nearest = this.acquireTarget(targets, this.aggroRangePx, (t) => !t.isDefendTarget);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.doWander();
      return;
    }

    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (nearestDist > this.attackRangePx) {
      this.followTargetCollide(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.attackRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    if (nearestDist <= this.attackRangePx && this.attackAnimTimer === 0) {
      this.faceToward(nearest);
    }

    if (nearestDist <= this.attackRangePx && this.attackCooldown === 0) {
      this.beginSwing({ player: nearest });
    }
  }

  private beginSwing(target: SwingTarget): void {
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackAnimTimer = BUGABOO_ATTACK_FRAMES;
    this.swingTarget = target;
  }

  /**
   * Advances the swing and lands it on the frame the claws are actually out.
   *
   * The target is re-checked at that moment rather than at the windup: a swing
   * whose damage is committed on the frame it starts hits whatever has since
   * walked out of range, half a second before the picture of the blow.
   */
  private tickSwing(): void {
    if (this.attackAnimTimer === 0) return;
    this.attackAnimTimer--;
    const target = this.swingTarget;
    if (target === null || this.attackAnimTimer !== SWIPE_IMPACT_TIMER) return;
    this.swingTarget = null;
    if ('barrier' in target) {
      this.onBarrierAttack?.(target.barrier, ATTACK_DAMAGE);
      return;
    }
    if (!target.player.isAlive) return;
    if (this.distanceTo(target.player) > this.attackRangePx) return;
    this.dealDamage(target.player, ATTACK_DAMAGE);
  }

  /**
   * The arm out of a breach mauls whatever is standing over the hole.
   *
   * The barricade is a place the player has to stand to build and repair, so
   * the thing clawing up through it has to make standing there cost something —
   * otherwise a boarded grate is a free safe square with a monster under it.
   */
  private clawAtAnyoneOnTheBreach(targets: readonly Player[]): void {
    const grate = this.assignedGrate;
    if (grate === null || this.breachGrabCooldown > 0) return;
    // Both sides of this comparison are tile *corners*, which is the coordinate
    // every entity in this game carries. Centring one of them and not the other
    // slides the hazard half a tile down and to the right of the grate, so it
    // reaches the three tiles south-east of the hole and not the hole itself.
    const grateX = grate.x * TILE_SIZE;
    const grateY = grate.y * TILE_SIZE;
    const reach = TILE_SIZE * BREACH_GRAB_RANGE_TILES;
    for (const target of targets) {
      if (!target.isAlive || target.isDefendTarget) continue;
      if (Math.hypot(target.x - grateX, target.y - grateY) > reach) continue;
      this.dealDamage(target, BREACH_GRAB_DAMAGE);
      this.breachGrabCooldown = BREACH_GRAB_COOLDOWN;
      return;
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    // Breaking in, the creature itself is under the floor: what is drawn is the
    // hole in the grate it is coming up through, at that grate rather than at
    // the body's own position, which is stopped short of it.
    if (this.isBreakingIn && this.assignedGrate) {
      const holeX = this.assignedGrate.x * TILE_SIZE - camX;
      const holeY = this.assignedGrate.y * TILE_SIZE - camY;
      this.renderAggroIndicator(ctx, holeX, holeY, tileSize);
      drawBugabooSprite(ctx, holeX, holeY, tileSize, {
        breaching: true,
        loopOffsetSeconds: this.loopOffsetSeconds,
      });
      // Anchored to the hole rather than to the body, so the bar a player is
      // whittling down sits over the thing they are hitting.
      this.renderMobHealthBar(ctx, holeX, holeY);
      return;
    }

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    drawBugabooSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      swipeProgress:
        this.attackAnimTimer > 0 ? 1 - this.attackAnimTimer / BUGABOO_ATTACK_FRAMES : null,
      emergeProgress: this.emergeTimer > 0 ? 1 - this.emergeTimer / BUGABOO_EMERGE_FRAMES : null,
      loopOffsetSeconds: this.loopOffsetSeconds,
    });

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
