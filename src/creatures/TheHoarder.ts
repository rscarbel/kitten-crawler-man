import type { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop, PlayerDamageType } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';
import {
  HOARDER_BODY_PART_KEY,
  HOARDER_VOMIT_RELEASE_PROGRESS,
  drawHoarderSprite,
} from '../sprites/hoarderSprite';

const HOARDER_HP = 80;
const HOARDER_MASS = 10;
const HOARDER_SPEED = 0.45;
const HOARDER_SPEED_ENRAGED = 0.75;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const FLEE_RANGE_TILE_MULTIPLIER = 8;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const FLEE_RANGE_PX = TILE_SIZE * FLEE_RANGE_TILE_MULTIPLIER;
const ENRAGE_THRESHOLD = 0.5;
/**
 * The bile and the cockroaches are two attacks on two clocks. They used to be
 * one: she only ever spat when the roach cap was already full, so in a normal
 * clear the acid never appeared at all and the fight was three roaches and
 * nothing else.
 */
const VOMIT_INTERVAL = 210;
/**
 * Longer than the unenraged interval, not shorter, because enraged she throws
 * three at a time: the volley is what grows, and the pace has to give way to it
 * or the room silts up. What actually bounds the coverage is the crowding rule
 * at the far end — pools cannot stack, so the floor fills with spread-out
 * hazard and lanes between rather than with one wall.
 */
const VOMIT_INTERVAL_ENRAGED = 240;
const PURGE_INTERVAL = 300;
const PURGE_INTERVAL_ENRAGED = 190;
/** How soon she tries again when the purge found the roach cap already full. */
const PURGE_RETRY_INTERVAL = 90;
/**
 * She will not spit at a player standing this close, and `BossRoomSystem` forms
 * no pool this close to her either — one rule, so it is one constant.
 *
 * Pools laid at her own feet are what made the fight a wall of acid: every one
 * of them landed on the ground a melee attacker has to stand on, so the room
 * silted up until there was no way in at all. The value is the pool's own radius
 * (two tiles) plus the ring a melee attacker occupies, which is what it takes
 * for a pool landing at the edge of the bubble not to burn back into that ring.
 * Aiming and forming have to agree: at two against three she spent whole
 * attacks on players in the gap, and the pool was silently discarded on landing.
 */
export const POINT_BLANK_TILES = 3.5;
const POINT_BLANK_RANGE_PX = TILE_SIZE * POINT_BLANK_TILES;
/** Thirty seconds: how often she is allowed one spit at someone at her feet. */
const POINT_BLANK_ALLOWANCE_FRAMES = 1800;
/**
 * How soon she tries again when every candidate was at her feet or already
 * standing in her acid. Short, because the shot is deferred rather than spent
 * and a player who steps back should be spat at promptly.
 */
const VOMIT_RETRY_INTERVAL = 45;
const VOMIT_WINDUP_FRAMES = 80;
const VOMIT_SPEED = 3.5;
/**
 * Enraged she brings up three at once. A spread rather than a faster single
 * shot, because what makes the acid interesting is the ground it takes away,
 * and one bolus lands in one place however often it is thrown.
 */
const ENRAGED_SPREAD_COUNT = 3;
const HALF_TURN_DEGREES = 180;
/** Twenty degrees between boluses: three of them fan across sixty. */
const ENRAGED_SPREAD_DEGREES = 20;
const ENRAGED_SPREAD_ANGLE = (ENRAGED_SPREAD_DEGREES * Math.PI) / HALF_TURN_DEGREES;
const CENTER_OFFSET = 0.5;
const RETURN_TO_SPAWN_THRESHOLD_TILES = 2;
const RETURN_TO_SPAWN_SPEED_MULTIPLIER = 0.6;
const FLEE_DISTANCE_TILES = 4;
const FLEE_STUCK_THRESHOLD = 8;
const FLEE_ANGLE_CHANGE_DIVISOR = 4;
const FLEE_ANGLE_CHANGE = Math.PI / FLEE_ANGLE_CHANGE_DIVISOR;
const FLEE_BIAS_DECAY = 0.85;
const WANDER_STATIONERY_THRESHOLD = 300;
const WANDER_DISTANCE_TILES_MIN = 3;
const WANDER_DISTANCE_TILES_RANGE = 3;
const WANDER_SPEED_MULTIPLIER = 0.6;
const VOMIT_SPAWN_RANGE_TILES_MIN = 0.5;
const VOMIT_SPAWN_RANGE_TILES_RANGE = 1.5;
const VOMIT_COUNT_MIN = 3;
const VOMIT_COUNT_MAX = 5;
/** Covers the sheet: she stands 3.6 tiles and the frame is wider still. */
const HOARDER_CULL_MARGIN_TILES = 4;
const COIN_DROP_MIN = 50;
const COIN_DROP_MAX = 100;

type HoarderState = 'fleeing' | 'vomit_windup';

export class TheHoarder extends Mob {
  override readonly audioTag = 'hoarder';
  readonly xpValue = 500;
  override readonly bodyPartKey = HOARDER_BODY_PART_KEY;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Hoarder';
  description = 'A hulking boss that flees while vomiting cockroaches and acid bile.';
  mass = HOARDER_MASS;

  isEnraged = false;

  private hoarderState: HoarderState = 'fleeing';
  private vomitTimer = VOMIT_INTERVAL;
  private purgeTimer = PURGE_INTERVAL;
  private vomitWindupTimer = 0;
  private vomitFired = false;
  private vomitTargetX = 0;
  private vomitTargetY = 0;
  private pointBlankTimer = 0;
  /**
   * Who this wind-up was aimed at, tracked so the bolus still lands on a player
   * who kept walking. Only ever the player chosen when the attack started: the
   * choice is what keeps the acid off her own doorstep and away from pools she
   * has already laid, so re-picking the nearest mid-animation would undo it.
   */
  private vomitTarget: Player | null = null;

  private fleeStuckFrames = 0;
  private fleeBias = 0;
  private fleeBiasSign = 1;

  private stationaryFrames = 0;
  private wanderTargetX = 0;
  private wanderTargetY = 0;
  private wanderActive = false;

  /** Set by BossRoomSystem each frame: true when cockroach cap is full. */
  cockroachAtCap = false;

  /**
   * Set by BossRoomSystem: answers whether a point is inside acid right now. The
   * Hoarder cannot see the system's puddle list, and a player the floor is
   * already burning is not worth a spit.
   */
  isAcidCovered: ((x: number, y: number) => boolean) | null = null;

  /** Pending cockroach spawn positions. BossRoomSystem drains this each frame. */
  cockroachSpawns: Array<{ x: number; y: number }> = [];

  /**
   * Bile released this frame. BossRoomSystem drains it; enraged there is more
   * than one, which is why this is a list rather than the single slot it was.
   */
  pendingVomitProjectiles: Array<{ x: number; y: number; dx: number; dy: number }> = [];

  override clearAirborneAttacks(): void {
    this.pendingVomitProjectiles = [];
    // Her roach spawns are the same shape: a request handed to a system that has
    // not picked it up yet, and one left queued would hatch on a floor the party
    // has already left or a world the checkpoint has already rewound.
    this.cockroachSpawns = [];
  }

  /** How far through the vomit animation she is, or null when not vomiting. */
  get vomitProgress(): number | null {
    if (this.hoarderState !== 'vomit_windup') return null;
    return 1 - this.vomitWindupTimer / VOMIT_WINDUP_FRAMES;
  }

  /**
   * She is drawn nearly four tiles tall over a one-tile mob, so the cull margin
   * has to cover the art rather than the footprint or she pops out of existence
   * while most of her is still on screen.
   */
  override get cullMarginTiles(): number {
    return HOARDER_CULL_MARGIN_TILES;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HOARDER_HP, HOARDER_SPEED);
    this.isBoss = true;
  }

  /**
   * A wind-up caught by a fog is dropped rather than frozen. `updateAI` is
   * skipped entirely for a confused mob, so the twelve-frame vomit row would
   * hold one cell for as long as the fog lasted and then resume from the middle
   * — and if the fog landed after the release frame she would keep the pose
   * without ever having thrown anything.
   */
  override tickTimers(): void {
    super.tickTimers();
    if (!this.isConfused || this.hoarderState !== 'vomit_windup') return;
    this.hoarderState = 'fleeing';
    this.vomitWindupTimer = 0;
    this.vomitFired = false;
    this.vomitTarget = null;
    // The attack is cancelled, not refunded.
    this.vomitTimer = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
  }

  protected override clearEncounterPhase(): void {
    this.isEnraged = false;
    this.setBaseSpeed(HOARDER_SPEED);
    this.hoarderState = 'fleeing';
    this.vomitTimer = VOMIT_INTERVAL;
    this.purgeTimer = PURGE_INTERVAL;
    this.vomitWindupTimer = 0;
    this.vomitFired = false;
    this.vomitTarget = null;
    this.pointBlankTimer = 0;
    this.fleeStuckFrames = 0;
    this.fleeBias = 0;
    this.fleeBiasSign = 1;
    this.stationaryFrames = 0;
    this.wanderActive = false;
    this.cockroachAtCap = false;
    this.cockroachSpawns = [];
    this.pendingVomitProjectiles = [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.setBaseSpeed(HOARDER_SPEED_ENRAGED);
    }

    // Unguarded by a target, unlike the two attack clocks: this is a cooldown on
    // a permission rather than a wind-up, and letting it run while she waits
    // only means she is willing the moment somebody walks in.
    if (this.pointBlankTimer > 0) this.pointBlankTimer--;

    if (this.hoarderState === 'vomit_windup') {
      // Tracked only while the target still satisfies the rule that picked it.
      // Followed unconditionally, an 0.8-second telegraph is long enough for a
      // player to walk into a pool or into her face and have the fresh one land
      // there anyway — which is the whole failure this selection exists to stop,
      // and it would let a point-blank hit through without spending the
      // allowance that is supposed to cap them.
      const tracked = this.vomitTarget;
      if (tracked !== null && this.isDistantVomitTarget(tracked)) {
        this.vomitTargetX = tracked.x + TILE_SIZE * CENTER_OFFSET;
        this.vomitTargetY = tracked.y + TILE_SIZE * CENTER_OFFSET;
      }

      this.vomitWindupTimer--;
      this.isMoving = false;
      const cx = this.x + TILE_SIZE * CENTER_OFFSET;
      const cy = this.y + TILE_SIZE * CENTER_OFFSET;
      const dx = this.vomitTargetX - cx;
      const dy = this.vomitTargetY - cy;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        this.facingX = dx / len;
        this.facingY = dy / len;
      }
      // Released partway through the row rather than at the end of it, on the
      // exact frame her jaw comes off its hinge — fired at the end, the bile
      // appeared after she had already started to sag.
      const progress = 1 - this.vomitWindupTimer / VOMIT_WINDUP_FRAMES;
      if (!this.vomitFired && progress >= HOARDER_VOMIT_RELEASE_PROGRESS) {
        this.releaseBile(cx, cy, len > 0 ? dx / len : 1, len > 0 ? dy / len : 0);
        this.vomitFired = true;
        this.specialSoundPending = true;
      }
      if (this.vomitWindupTimer <= 0) this.hoarderState = 'fleeing';
      return;
    }

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;

    // Both clocks only run while there is someone to attack. Ticking with no
    // target they run tens of thousands of frames into the negative, and the
    // wind-up then fires on the exact frame a player first crosses the aggro
    // ring — before there is any telegraph left to react to.
    if (nearest !== null) this.vomitTimer--;
    if (this.vomitTimer <= 0 && nearest !== null) {
      const victim = this.pickVomitTarget(targets);
      if (victim === null) {
        this.vomitTimer = VOMIT_RETRY_INTERVAL;
      } else {
        this.vomitTimer = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
        if (this.distanceTo(victim) < POINT_BLANK_RANGE_PX) {
          this.pointBlankTimer = POINT_BLANK_ALLOWANCE_FRAMES;
        }
        this.vomitTarget = victim;
        this.vomitTargetX = victim.x + TILE_SIZE * CENTER_OFFSET;
        this.vomitTargetY = victim.y + TILE_SIZE * CENTER_OFFSET;
        this.hoarderState = 'vomit_windup';
        this.vomitWindupTimer = VOMIT_WINDUP_FRAMES;
        this.vomitFired = false;
      }
    }

    if (nearest !== null) this.purgeTimer--;
    if (this.purgeTimer <= 0 && nearest !== null) {
      // A purge that finds the cap full is not spent, only deferred: she is
      // meant to be topping the swarm back up the moment there is room.
      this.purgeTimer = this.cockroachAtCap
        ? PURGE_RETRY_INTERVAL
        : this.isEnraged
          ? PURGE_INTERVAL_ENRAGED
          : PURGE_INTERVAL;
      if (!this.cockroachAtCap) this.triggerPurge();
    }

    if (!nearest) {
      this.stationaryFrames = 0;
      this.wanderActive = false;
      const toHome = Math.hypot(this.x - this.spawnX, this.y - this.spawnY);
      if (toHome > TILE_SIZE * RETURN_TO_SPAWN_THRESHOLD_TILES) {
        this.followTargetCollide(
          this.spawnX,
          this.spawnY,
          this.speed * RETURN_TO_SPAWN_SPEED_MULTIPLIER,
          TILE_SIZE,
        );
      } else {
        this.isMoving = false;
      }
      return;
    }

    this.updateLastKnown(nearest);

    if (nearestDist < FLEE_RANGE_PX) {
      this.stationaryFrames = 0;
      this.wanderActive = false;
      const dx = this.x - nearest.x;
      const dy = this.y - nearest.y;
      const len = Math.hypot(dx, dy);
      const baseAngle = len > 0 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
      const fleeAngle = baseAngle + this.fleeBias;
      const fleeTargetX = this.x + Math.cos(fleeAngle) * TILE_SIZE * FLEE_DISTANCE_TILES;
      const fleeTargetY = this.y + Math.sin(fleeAngle) * TILE_SIZE * FLEE_DISTANCE_TILES;
      const preX = this.x;
      const preY = this.y;
      this.followTargetCollide(fleeTargetX, fleeTargetY, this.speed, 0);
      if (this.x === preX && this.y === preY) {
        this.fleeStuckFrames++;
        if (this.fleeStuckFrames >= FLEE_STUCK_THRESHOLD) {
          this.fleeBias += FLEE_ANGLE_CHANGE * this.fleeBiasSign;
          this.fleeStuckFrames = 0;
          if (Math.abs(this.fleeBias) > Math.PI) {
            this.fleeBiasSign *= -1;
            this.fleeBias = 0;
          }
        }
      } else {
        this.fleeStuckFrames = 0;
        this.fleeBias *= FLEE_BIAS_DECAY;
      }
    } else {
      // Player is in aggro range but outside flee range — wander if stationary too long
      this.stationaryFrames++;
      if (this.wanderActive) {
        const preX = this.x;
        const preY = this.y;
        this.followTargetCollide(
          this.wanderTargetX,
          this.wanderTargetY,
          this.speed * WANDER_SPEED_MULTIPLIER,
          TILE_SIZE,
        );
        if (this.x !== preX || this.y !== preY) {
          this.stationaryFrames = 0;
        }
        if (this.x === preX && this.y === preY) {
          // Blocked — give up and pick a new target next cycle
          this.wanderActive = false;
        } else if (
          Math.hypot(this.x - this.wanderTargetX, this.y - this.wanderTargetY) < TILE_SIZE
        ) {
          this.wanderActive = false;
        }
      } else if (this.stationaryFrames >= WANDER_STATIONERY_THRESHOLD) {
        const angle = Math.random() * Math.PI * 2;
        const dist =
          TILE_SIZE * (WANDER_DISTANCE_TILES_MIN + Math.random() * WANDER_DISTANCE_TILES_RANGE);
        this.wanderTargetX = this.spawnX + Math.cos(angle) * dist;
        this.wanderTargetY = this.spawnY + Math.sin(angle) * dist;
        this.wanderActive = true;
        this.stationaryFrames = 0;
      } else {
        this.isMoving = false;
      }
    }
  }

  /** True when a player is standing on ground her acid already covers. */
  private isStandingInHerAcid(target: Player): boolean {
    const probe = this.isAcidCovered;
    if (probe === null) return false;
    return probe(target.x + TILE_SIZE * CENTER_OFFSET, target.y + TILE_SIZE * CENTER_OFFSET);
  }

  private readonly isDistantVomitTarget = (target: Player): boolean =>
    target.isAlive &&
    this.distanceTo(target) >= POINT_BLANK_RANGE_PX &&
    !this.isStandingInHerAcid(target);

  private readonly isReachableVomitTarget = (target: Player): boolean =>
    target.isAlive && !this.isStandingInHerAcid(target);

  /**
   * Who this spit is worth aiming at: someone standing on clean ground, and
   * standing off her, unless the point-blank allowance has come back around.
   * Null means nobody qualifies and the shot should be held.
   */
  private pickVomitTarget(targets: Player[]): Player | null {
    const distant = this.acquireTarget(targets, AGGRO_RANGE_PX, this.isDistantVomitTarget);
    if (distant !== null) return distant;
    if (this.pointBlankTimer > 0) return null;
    return this.acquireTarget(targets, AGGRO_RANGE_PX, this.isReachableVomitTarget);
  }

  /**
   * Queues the bile the sprite is about to show leaving her mouth.
   *
   * Every bolus flies. Whether the pool it leaves is worth having is decided
   * where it lands, by the system that owns the pools — a bolus travels until a
   * wall, a player or its own lifetime stops it, so nothing here can say where
   * it will come down, and the spread's flanks miss the target by construction
   * and travel the full distance.
   */
  private releaseBile(cx: number, cy: number, ndx: number, ndy: number): void {
    const count = this.isEnraged ? ENRAGED_SPREAD_COUNT : 1;
    const base = Math.atan2(ndy, ndx);
    const centreOffset = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const angle = base + (i - centreOffset) * ENRAGED_SPREAD_ANGLE;
      this.pendingVomitProjectiles.push({
        x: cx,
        y: cy,
        dx: Math.cos(angle) * VOMIT_SPEED,
        dy: Math.sin(angle) * VOMIT_SPEED,
      });
    }
  }

  private triggerPurge(): void {
    const count = randomInt(VOMIT_COUNT_MIN, VOMIT_COUNT_MAX);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist =
        TILE_SIZE * (VOMIT_SPAWN_RANGE_TILES_MIN + Math.random() * VOMIT_SPAWN_RANGE_TILES_RANGE);
      this.cockroachSpawns.push({
        x: this.x + TILE_SIZE * CENTER_OFFSET + Math.cos(angle) * dist,
        y: this.y + TILE_SIZE * CENTER_OFFSET + Math.sin(angle) * dist,
      });
    }
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const prevHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < prevHp) this.damageSoundPending = true;
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    items.push({ id: 'trollskin_shirt', quantity: 1 });
    // Guaranteed, not rolled: Cockroach is the safety net for the cat's locked
    // constitution, and a 0.5% vermin drop is no way to hand out a safety net.
    items.push({ id: 'skill_book_cockroach', quantity: 1 });
    return items;
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

    drawHoarderSprite(ctx, sx, sy, tileSize, {
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      vomitProgress: this.vomitProgress,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
