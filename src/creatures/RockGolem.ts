import type { Player } from '../Player';
import { Mob } from './Mob';
import {
  ROCK_GOLEM_BODY_PART_KEY,
  drawRockGolemSprite,
  type GolemAttack,
  type RockGolemSheet,
  type RockGolemSpriteState,
} from '../sprites/rockGolemSprite';
import {
  GOLEM_SLAM_FRAMES,
  GOLEM_STOMP_FRAMES,
  GOLEM_THROW_FRAMES,
  golemSlamImpactFrame,
  golemStompImpactFrame,
  golemThrowReleaseFrame,
} from '../sprites/rockGolemTiming';
import type { GolemRockThrow } from '../systems/RockThrowSystem';

const GOLEM_HP = 26;
const GOLEM_XP_VALUE = 22;
/** Ponderous. A golem never catches a running player; it corners one. */
const GOLEM_SPEED = 0.62;
const AGGRO_RANGE_TILES = 9;
/** Both melee attacks land inside this. */
const MELEE_RANGE_TILES = 1.5;
/**
 * Beyond this, with line of sight, it picks up a rock instead of closing.
 *
 * Only just past the stomp's own reach. At 5 tiles the throw had a four-tile
 * window against a nine-tile aggro range, and a golem closes — so it spent
 * almost the whole fight inside the band where throwing was illegal, and a
 * player who simply kept their distance was never actually threatened. The
 * rock is the answer to being kited, so it has to be legal everywhere the
 * melee is not.
 */
const THROW_MIN_RANGE_TILES = 2.6;
/** Matched to the aggro range: anything it can see, it can throw at. */
const THROW_MAX_RANGE_TILES = AGGRO_RANGE_TILES;

const SLAM_DAMAGE = 5;
/** The stomp trades reach for a little less damage than the double-fist slam. */
const STOMP_DAMAGE = 4;
/** The stomp's shock reaches further than the fists do. */
const STOMP_RANGE_TILES = 2.1;
const THROW_DAMAGE = 4;

/** Frames between attacks of any kind. */
const ATTACK_COOLDOWN = 84;
/**
 * Frames between thrown rocks, on top of the shared cooldown.
 *
 * Was 210 — three and a half seconds, which on top of the narrow range band
 * meant a rock almost never arrived. Subclasses override
 * {@link RockGolem.throwCooldownFrames} rather than this being tuned per golem.
 */
const THROW_COOLDOWN = 110;

const COIN_DROP_MIN = 6;
const COIN_DROP_MAX = 10;
const CENTER_OFFSET = 0.5;
/** Height up the body a thrown rock leaves from, as a fraction of a tile. */
const HAND_OFFSET_Y = 0.25;
const HAND_OFFSET_X = 0.3;
const FOLLOW_STOP_RANGE_RATIO = 0.8;

/** A golem is two tiles of stone: it barely moves when something shoves it. */
const GOLEM_MASS = 6;
/** The sheet is two tiles tall, so a one-tile cull margin clips its head off. */
const GOLEM_CULL_MARGIN_TILES = 2;

const EMPTY_THROWS: readonly GolemRockThrow[] = [];

export interface AttackTiming {
  readonly frames: number;
  /** Frame index, counting up from the first frame, on which the attack lands. */
  readonly impactFrame: number;
}

/**
 * When each shared attack lands, in sheet frames. Exported because the hired
 * bruiser drives the same rows off the same table — the whole point of the
 * shared kit is that there is one timing source, not two that drift.
 */
export const GOLEM_ATTACK_TIMING: Record<GolemAttack, AttackTiming> = {
  slam: { frames: GOLEM_SLAM_FRAMES, impactFrame: golemSlamImpactFrame() },
  stomp: { frames: GOLEM_STOMP_FRAMES, impactFrame: golemStompImpactFrame() },
  throw: { frames: GOLEM_THROW_FRAMES, impactFrame: golemThrowReleaseFrame() },
};

/** How long a frame of the sheet is held on screen, in game frames. */
const FRAMES_PER_SHEET_FRAME = 4;

/**
 * A rock golem — the Sledge's kind.
 *
 * One shared attack kit: it alternates a double-fist slam and a ground stomp in
 * melee, and hauls a boulder up off the ground to throw when the target is too
 * far to reach. The bounty boss (`RockGolemBoss`) and the hired bruiser
 * mercenary both extend or reuse this class rather than reimplementing it —
 * Ryan's requirement is that every golem in the game shares its animations and
 * its attacks.
 */
export class RockGolem extends Mob {
  readonly xpValue: number = GOLEM_XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'rock_golem';
  override readonly bodyPartKey: string | null = ROCK_GOLEM_BODY_PART_KEY;
  override mass = GOLEM_MASS;
  displayName = 'Rock Golem';
  description = 'A walking quarry. Slow, brutally heavy, and happy to throw the scenery at you.';

  protected attackCooldown = 0;
  private throwCooldown = 0;
  /** Null when not attacking; otherwise the row playing and how far into it. */
  protected currentAttack: GolemAttack | null = null;
  protected attackFrame = 0;
  /** Set once the attack's impact frame has fired, so it lands exactly once. */
  private attackResolved = false;
  /**
   * Alternates the two melee attacks. Remembering the last one is the whole of
   * the "kit alternates between 1 and 2" rule — a random pick reads as a golem
   * that sometimes forgets it has legs.
   */
  private lastMelee: GolemAttack = 'stomp';
  /**
   * Rocks thrown but not yet handed to `RockThrowSystem`, which drains this
   * every frame. The golem never owns a boulder in flight: it stops being
   * updated and drawn the instant it dies, and a projectile stored here would
   * be deleted in mid-air along with it.
   */
  private pendingThrows: GolemRockThrow[] = [];
  private isAggro = false;

  protected readonly aggroRangePx: number;
  protected readonly meleeRangePx: number;
  private readonly stompRangePx: number;
  private readonly throwMinRangePx: number;
  private readonly throwMaxRangePx: number;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp = GOLEM_HP) {
    super(tileX, tileY, tileSize, maxHp, GOLEM_SPEED);
    this.aggroRangePx = tileSize * AGGRO_RANGE_TILES;
    this.meleeRangePx = tileSize * MELEE_RANGE_TILES;
    this.stompRangePx = tileSize * STOMP_RANGE_TILES;
    this.throwMinRangePx = tileSize * THROW_MIN_RANGE_TILES;
    this.throwMaxRangePx = tileSize * THROW_MAX_RANGE_TILES;
  }

  override get cullMarginTiles(): number {
    return GOLEM_CULL_MARGIN_TILES;
  }

  /** Which of the two baked sheets this golem draws from. */
  protected get sheet(): RockGolemSheet {
    return 'rock_golem';
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.attackCooldown = 0;
    this.throwCooldown = 0;
    this.currentAttack = null;
    this.attackFrame = 0;
    this.attackResolved = false;
    this.pendingThrows = [];
    this.isAggro = false;
  }

  /**
   * Hands over every rock thrown since the last call and clears the queue.
   *
   * Returning the array wholesale rather than one at a time is deliberate: the
   * caller must be able to drain a golem that has since died, and a
   * pull-one-per-frame interface would strand the rest.
   */
  takePendingThrows(): readonly GolemRockThrow[] {
    if (this.pendingThrows.length === 0) return EMPTY_THROWS;
    const throws = this.pendingThrows;
    this.pendingThrows = [];
    return throws;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.tickCooldowns();

    const nearest = this.acquireTarget(targets, this.aggroRangePx);
    this.currentTarget = nearest;
    this.isAggro = nearest !== null;

    if (this.advanceAttack(nearest)) return;
    if (nearest === null) {
      this.clearAStarPath();
      // Not `doWander`: a bounty encounter is anchored to its site by a
      // homePoint and a leash, and only this path consults them. A golem that
      // wandered freely would drift off the site the player was pointed at.
      this.returnHomeOrWander();
      return;
    }
    this.pursue(nearest);
  }

  protected tickCooldowns(): void {
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.throwCooldown > 0) this.throwCooldown--;
  }

  /**
   * Plays one frame of an attack in progress. Returns true when an attack owns
   * the frame, so the caller does no movement or targeting of its own.
   *
   * The wind-up always runs to completion: it is the player's warning that a
   * hit is coming, and a golem that abandons it because the target stepped
   * aside has told them a lie. It keeps tracking until it commits, though — a
   * facing locked from frame zero throws the rock at where the player used to
   * be.
   */
  protected advanceAttack(nearest: Player | null): boolean {
    const attack = this.currentAttack;
    if (attack === null) return false;

    const timing = GOLEM_ATTACK_TIMING[attack];
    const sheetFrame = Math.floor(this.attackFrame / FRAMES_PER_SHEET_FRAME);
    this.isMoving = false;

    if (!this.attackResolved && sheetFrame < timing.impactFrame && nearest !== null) {
      this.faceToward(nearest);
    }
    if (!this.attackResolved && sheetFrame >= timing.impactFrame) {
      this.attackResolved = true;
      this.resolveAttack(attack, nearest);
    }

    this.attackFrame++;
    if (this.attackFrame >= timing.frames * FRAMES_PER_SHEET_FRAME) {
      this.currentAttack = null;
      this.attackFrame = 0;
      this.attackResolved = false;
    }
    return true;
  }

  private resolveAttack(attack: GolemAttack, nearest: Player | null): void {
    if (attack === 'throw') {
      this.releaseRock(nearest);
      return;
    }
    if (nearest === null) return;
    const reach = attack === 'stomp' ? this.stompRangePx : this.meleeRangePx;
    if (this.distanceTo(nearest) > reach) return;
    this.dealDamage(nearest, attack === 'stomp' ? STOMP_DAMAGE : SLAM_DAMAGE);
  }

  private pursue(nearest: Player): void {
    const distance = this.distanceTo(nearest);
    this.updateLastKnown(nearest);

    if (this.attackCooldown === 0 && this.canThrowAt(nearest, distance)) {
      this.beginAttack('throw');
      this.throwCooldown = this.throwCooldownFrames;
      return;
    }
    if (this.attackCooldown === 0 && distance <= this.meleeRangePx) {
      this.beginAttack(this.lastMelee === 'slam' ? 'stomp' : 'slam');
      return;
    }

    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      this.meleeRangePx * FOLLOW_STOP_RANGE_RATIO,
    );
    if (!this.isMoving) this.faceToward(nearest);
  }

  /**
   * Frames this golem waits between rocks. Overridable so the boss can throw at
   * its own tempo without a second copy of the throw logic.
   */
  protected get throwCooldownFrames(): number {
    return THROW_COOLDOWN;
  }

  private canThrowAt(nearest: Player, distance: number): boolean {
    if (this.throwCooldown > 0) return false;
    if (distance < this.throwMinRangePx || distance > this.throwMaxRangePx) return false;
    return this.hasLOS(nearest);
  }

  protected beginAttack(attack: GolemAttack): void {
    this.currentAttack = attack;
    this.attackFrame = 0;
    this.attackResolved = false;
    this.attackCooldown = ATTACK_COOLDOWN;
    this.isMoving = false;
    if (attack !== 'throw') this.lastMelee = attack;
    // The throw's noise belongs to the release frame, not the wind-up.
    if (attack !== 'throw') this.attackSoundPending = true;
  }

  /** Where the boulder leaves the golem, offset toward whichever way it faces. */
  private handPosition(): { readonly x: number; readonly y: number } {
    const facing = Math.sign(this.facingX) === 0 ? 1 : Math.sign(this.facingX);
    return {
      x: this.x + this.tileSize * (CENTER_OFFSET + HAND_OFFSET_X * facing),
      y: this.y + this.tileSize * HAND_OFFSET_Y,
    };
  }

  /**
   * Queues one boulder, aimed at wherever the target is on the release frame
   * rather than where it was when the haul began — otherwise the telegraph is
   * free to dodge and the attack never lands on a moving player.
   */
  private releaseRock(target: Player | null): void {
    const hand = this.handPosition();
    const aimX = target ? target.x + this.tileSize * CENTER_OFFSET : hand.x + this.facingX;
    const aimY = target ? target.y + this.tileSize * CENTER_OFFSET : hand.y + this.facingY;
    const dirX = aimX - hand.x;
    const dirY = aimY - hand.y;
    // A target standing exactly on the hand would give a zero direction, which
    // normalises to NaN and produces a rock that never moves and never expires.
    const degenerate = dirX === 0 && dirY === 0;
    this.pendingThrows.push({
      x: hand.x,
      y: hand.y,
      dirX: degenerate ? (this.facingX === 0 ? 1 : this.facingX) : dirX,
      dirY: degenerate ? this.facingY : dirY,
      damage: this.scaledDamage(THROW_DAMAGE),
      mobType: this.mobType,
      // Carried unconditionally and deduplicated by the system: the interesting
      // case is a target that is neither player — a mob made hostile by Vespa
      // acid — which nothing else would tell the projectile about.
      aimedAt: target,
      thrower: this,
      // A wild golem is nobody's ally, so the shot stays hostile to everything.
      owner: null,
    });
    this.projectileSoundPending = true;
  }

  /** The animation state the sprite wrapper needs; the boss extends this. */
  protected spriteState(): RockGolemSpriteState {
    const attack = this.currentAttack;
    const timing = attack === null ? null : GOLEM_ATTACK_TIMING[attack];
    return {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      attack,
      attackProgress:
        timing === null ? 0 : this.attackFrame / (timing.frames * FRAMES_PER_SHEET_FRAME),
    };
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

    if (this.isAggro) this.renderAggroIndicator(ctx, sx, sy, tileSize);

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';
    drawRockGolemSprite(ctx, this.sheet, sx, sy, tileSize, this.spriteState());
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}

/** Shared with the boss subclass, which times its own rows against the same clock. */
export { FRAMES_PER_SHEET_FRAME };
