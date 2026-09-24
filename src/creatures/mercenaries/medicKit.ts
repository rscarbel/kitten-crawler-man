import { TILE_SIZE } from '../../core/constants';
import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import type { Mercenary } from '../Mercenary';
import { Mongo } from '../Mongo';
import { normalize } from '../../utils';
import {
  BUCKET_BOY_FLEE_FRAMES,
  BUCKET_BOY_HURT_DURATION_MS,
  BUCKET_BOY_SLAP_DURATION_MS,
  BUCKET_BOY_TRIAGE_DURATION_MS,
  TRIAGE_SPARKLE_DURATION_MS,
  bucketBoySlapImpactProgress,
  bucketBoyTriageReleaseProgress,
} from '../../sprites/crocodilianTiming';
import {
  BUCKET_BOY_TILES_PER_FLEE_CYCLE,
  drawTriageSparkleSprite,
  prewarmTriageSparkle,
} from '../../sprites/crocodilianSprite';
import {
  DEFAULT_ENGAGE_RADIUS_TILES,
  DEFAULT_LEASH_RADIUS_TILES,
  DEFAULT_STRIKE_RANGE_TILES,
  NO_PROJECTILES,
  locomotionState,
  type FollowBand,
  type HirelingProjectile,
  type MercenaryDrawState,
  type MercenaryKit,
  type MercenaryKitContext,
} from './MercenaryKit';
import { MercenaryStrike, type StrikeTiming } from './mercenaryStrike';

/**
 * Bucket Boy's kit. He is a combat medic who does not look for fights: he
 * never picks a target, trails close behind his owner, runs from anything
 * hostile that gets near him, and patches up whoever on his side is hurt worst
 * with Triage. Only when he is cornered does he hit anything, and then it is a
 * slap.
 */

const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const TILE_CENTER_OFFSET = TILE_SIZE / 2;
const FULL_TURN = Math.PI * 2;

function ticksFor(durationMs: number): number {
  return Math.round((durationMs * TICKS_PER_SECOND) / MS_PER_SECOND);
}

/**
 * He trails about a tile and a half behind the owner, parking where the band
 * starts. That is inside talking range, which is safe because talking is
 * refused while anything hostile is near — the parked medic never steals an
 * attack press.
 */
const MEDIC_FOLLOW_BAND: FollowBand = { startTiles: 1.5, stopTiles: 1.1 };

/** A hostile this close sends him running. */
export const MEDIC_FLEE_ENTER_TILES = 2;
/**
 * He keeps running until the nearest hostile is this far off. The gap is
 * hysteresis: a chasing mob rolls back inside a single radius a frame after he
 * stops on its rim, and flee-one-frame, follow-the-next reads as a zigzag.
 */
export const MEDIC_FLEE_EXIT_TILES = 3.5;
/**
 * Inside this, with the flee over, he will not walk toward a hostile to rejoin
 * his owner — he holds where he is. Without it the follow drive walks him
 * straight back inside the flee radius, and he spends a chase running out and
 * walking back in.
 */
export const MEDIC_WARY_TILES = 4.5;
/**
 * Past this from his owner he has been left behind, and rejoining outweighs
 * his nerves: he no longer holds back from a hostile, and runs only from one
 * that is actually after him. Otherwise an idle mob between him and a
 * departing owner strands him for good — held off by the wary hold, or
 * bounced between fleeing it and walking back at it.
 */
export const MEDIC_LEFT_BEHIND_TILES = 6;
/**
 * A hostile that went for him this recently still counts as after him, left
 * behind or not. Attention flickers — a mob between two targets can look away
 * for a few frames and back — and a medic who believes each glance away walks
 * straight past it and is struck when it looks back.
 */
export const HUNTED_MEMORY_FRAMES = 180;
/** Close enough to be "adjacent": he will not start or keep a channel with one this near. */
export const MEDIC_ADJACENT_TILES = 1.25;

/** Below this share of max HP an ally is a patient. */
export const TRIAGE_TRIGGER_HP_FRACTION = 0.5;
/** How close to its victim a melee hostile stands while it swings. */
const MELEE_CONTACT_TILES = 1.5;
/**
 * How far from him a patient may be. A hostile swinging at the patient stands
 * beside them, and his nerves hold him up to {@link MEDIC_WARY_TILES} from
 * that hostile, so his reach must cover both or a crawler under a melee
 * attack is always just out of it — the one crawler who most needs him.
 */
export const TRIAGE_RANGE_TILES = MEDIC_WARY_TILES + MELEE_CONTACT_TILES;
/** A patient who walked a little way off during the channel still gets the heal. */
const TRIAGE_RANGE_SLACK_RATIO = 1.5;
/** Share of the patient's own max HP one Triage restores. */
export const TRIAGE_HEAL_FRACTION = 0.15;
/** About nine seconds between casts, counted from the channel's start. */
export const TRIAGE_COOLDOWN_FRAMES = 540;
/** A channel broken off — a hostile closing in, the patient gone — may be tried again after this. */
const TRIAGE_INTERRUPTED_RETRY_FRAMES = 60;
export const TRIAGE_CHANNEL_FRAMES = ticksFor(BUCKET_BOY_TRIAGE_DURATION_MS);
/** The first tick the glow peaks on screen, which is when the heal lands. */
export const TRIAGE_RELEASE_FRAME = Math.ceil(
  TRIAGE_CHANNEL_FRAMES * bucketBoyTriageReleaseProgress(),
);
const TRIAGE_SPARKLE_FRAMES = ticksFor(TRIAGE_SPARKLE_DURATION_MS);

/** One shriek-and-shiver when he wanted to heal and something was in his face. */
const COWER_FRAMES = 36;
/** Frames before he will cower for a missed heal again, so it cannot lock him in place. */
const COWER_REARM_FRAMES = 150;

/** Flee this long without getting anywhere and he is cornered. */
export const CORNERED_FRAMES = 60;
/**
 * A flee step that covers less than this share of his speed made no real
 * progress. Low, because wading or a slow still counts as getting away.
 */
const FLEE_PROGRESS_RATIO = 0.2;
/** Headings tried when choosing an escape. */
const FLEE_HEADINGS = 16;
/** How far ahead an escape heading must be clear of walls. */
const FLEE_PROBE_TILES = 0.9;
/** Preference for the heading already being run, so the choice does not flicker between near ties. */
const FLEE_HEADING_STICKINESS = 0.25;
/** Pull toward the owner once he has run this far from them. */
const FLEE_OWNER_PULL_START_TILES = 4;
const FLEE_OWNER_PULL_WEIGHT = 0.5;
/**
 * A heading must carry him at least this much away from the nearest hostile.
 * A cardinal toward the threat alternated with one away from it is the same
 * zigzag as flee-and-follow, only in a corner.
 */
const FLEE_MIN_AWAY_COMPONENT = 0.05;

/** A slap is thrown at arm's length; one that steps a little out of it is still caught. */
const SLAP_REACH_RATIO = 1.3;

const SLAP_TIMING: StrikeTiming = {
  row: 'slap',
  frames: ticksFor(BUCKET_BOY_SLAP_DURATION_MS),
  impactFrame: Math.ceil(ticksFor(BUCKET_BOY_SLAP_DURATION_MS) * bucketBoySlapImpactProgress()),
  reachRatio: SLAP_REACH_RATIO,
};
/** Frames between slaps while he stays cornered. */
export const SLAP_COOLDOWN_FRAMES = 50;

const HURT_FRAMES = ticksFor(BUCKET_BOY_HURT_DURATION_MS);

/**
 * The flee cycle is paced by ground he actually covered, capped at one sprite
 * frame per tick: his legs are short and his run is quick, and past that the
 * flee row is undersampled into a strobe.
 */
const MAX_FLEE_CYCLE_PER_TICK = 1 / BUCKET_BOY_FLEE_FRAMES;

interface Channel {
  readonly patient: Player;
  frame: number;
  released: boolean;
}

interface Sparkle {
  readonly patient: Player;
  frame: number;
}

export class MedicKit implements MercenaryKit {
  readonly engageRadiusTiles = DEFAULT_ENGAGE_RADIUS_TILES;
  readonly leashRadiusTiles = DEFAULT_LEASH_RADIUS_TILES;
  readonly strikeRangeTiles = DEFAULT_STRIKE_RANGE_TILES;
  readonly followBand = MEDIC_FOLLOW_BAND;

  private readonly strike = new MercenaryStrike();
  private channel: Channel | null = null;
  private readonly sparkles: Sparkle[] = [];
  private triageCooldown = 0;
  private cowerFrames = 0;
  private cowerRearm = 0;
  private hurtFrames = 0;
  private lastHp: number | null = null;

  private fleeing = false;
  private fleeHeading: { x: number; y: number } | null = null;
  private fleeMovedLastFrame = false;
  private fleeCycle = 0;
  private stuckFrames = 0;
  /** His own tick count, for {@link HUNTED_MEMORY_FRAMES}. */
  private clock = 0;
  /** When each hostile last had him as its target. Weak, so a mob gone from the world is not kept. */
  private readonly lastHuntedAt = new WeakMap<Mob, number>();

  constructor(private readonly slapDamage: number) {}

  /** Frames of fruitless fleeing so far; he is cornered at {@link CORNERED_FRAMES}. */
  get framesStuck(): number {
    return this.stuckFrames;
  }

  get isFleeing(): boolean {
    return this.fleeing;
  }

  get isChanneling(): boolean {
    return this.channel !== null;
  }

  get triageCooldownFrames(): number {
    return this.triageCooldown;
  }

  tick(ctx: MercenaryKitContext): void {
    this.clock++;
    for (const mob of ctx.allMobs) {
      if (mob.currentTarget === ctx.merc) this.lastHuntedAt.set(mob, this.clock);
    }
    if (this.triageCooldown > 0) this.triageCooldown--;
    if (this.cowerRearm > 0) this.cowerRearm--;
    if (this.hurtFrames > 0) this.hurtFrames--;
    const hp = ctx.merc.hp;
    if (this.lastHp !== null && hp < this.lastHp) this.hurtFrames = HURT_FRAMES;
    this.lastHp = hp;
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sparkle = this.sparkles[i];
      sparkle.frame++;
      if (sparkle.frame >= TRIAGE_SPARKLE_FRAMES) this.sparkles.splice(i, 1);
    }
  }

  update(ctx: MercenaryKitContext): boolean {
    this.fleeMovedLastFrame = false;
    if (this.strike.advance(ctx)) return true;

    const merc = ctx.merc;
    const leftBehind =
      Math.hypot(ctx.owner.x - merc.x, ctx.owner.y - merc.y) > TILE_SIZE * MEDIC_LEFT_BEHIND_TILES;
    const closest = this.nearestHostile(ctx, false);
    const adjacent = (closest?.distancePx ?? Infinity) <= TILE_SIZE * MEDIC_ADJACENT_TILES;
    const closestPx = closest?.distancePx ?? Infinity;
    // What may start a flee or a wary hold. Left behind, only a hostile that is
    // after him counts; ending a flee is still judged against every hostile.
    const nearest = leftBehind ? this.nearestHostile(ctx, true) : closest;
    const nearestPx = nearest?.distancePx ?? Infinity;

    const channel = this.channel;
    // Once the heal is out, the rest of the row is only him picking the bucket
    // back up; he drops that and runs the moment a hostile gets close.
    const channelSpent =
      channel?.released === true && closestPx <= TILE_SIZE * MEDIC_FLEE_ENTER_TILES;
    if (channelSpent) this.channel = null;
    if (channel !== null && !channelSpent) {
      if (!adjacent) {
        this.advanceChannel(ctx, channel);
        return true;
      }
      this.cancelChannel();
      if (this.cowerRearm === 0) {
        this.startCower(ctx);
        return true;
      }
    }

    if (this.cowerFrames > 0) {
      this.cowerFrames--;
      ctx.merc.isMoving = false;
      return true;
    }

    this.updateFleeLatch(ctx, nearestPx, closestPx);

    if (this.triageCooldown === 0) {
      const patient = this.findPatient(ctx);
      // Never from a flee, nor with a hostile inside the flee trigger: a channel
      // started there is cut short by the hostile arriving, and he spends the
      // fight starting heals that never land instead of getting clear first.
      const safeToChannel = !this.fleeing && closestPx > TILE_SIZE * MEDIC_FLEE_ENTER_TILES;
      if (patient !== null) {
        if (!adjacent && safeToChannel) {
          this.beginChannel(ctx, patient);
          return true;
        }
        // Caught standing, he freezes and shrieks. Already running, he keeps running.
        if (adjacent && !this.fleeing && this.cowerRearm === 0) {
          this.startCower(ctx);
          return true;
        }
      }
    }

    if (this.fleeing && closest !== null) {
      this.flee(ctx, closest.mob);
      return true;
    }
    if (nearest === null) return false;
    if (
      !leftBehind &&
      nearestPx <= TILE_SIZE * MEDIC_WARY_TILES &&
      this.rejoiningMeansApproaching(ctx, nearest.mob)
    ) {
      ctx.merc.isMoving = false;
      ctx.merc.faceToward(nearest.mob);
      return true;
    }
    return false;
  }

  /** Whether the shell's follow would set off now, and toward `hostile`. */
  private rejoiningMeansApproaching(ctx: MercenaryKitContext, hostile: Mob): boolean {
    const merc = ctx.merc;
    const toOwnerX = ctx.owner.x - merc.x;
    const toOwnerY = ctx.owner.y - merc.y;
    const setsOff =
      merc.isFollowingOwner ||
      Math.hypot(toOwnerX, toOwnerY) > TILE_SIZE * this.followBand.startTiles;
    if (!setsOff) return false;
    const toHostileX = hostile.x - merc.x;
    const toHostileY = hostile.y - merc.y;
    return toOwnerX * toHostileX + toOwnerY * toHostileY > 0;
  }

  chooseTarget(_ctx: MercenaryKitContext, _nearest: Mob | null): Mob | null {
    return null;
  }

  canStartAttack(_ctx: MercenaryKitContext, _target: Mob, _distancePx: number): boolean {
    return false;
  }

  startAttack(_ctx: MercenaryKitContext, _target: Mob, _distancePx: number): void {
    // Never reached: he never chooses a target. His one blow is the cornered slap in `flee`.
  }

  drawState(merc: Mercenary): MercenaryDrawState {
    const swing = this.strike.drawState();
    if (swing !== null) return swing;
    const channel = this.channel;
    if (channel !== null) {
      return { row: 'cast_triage', progress: channel.frame / TRIAGE_CHANNEL_FRAMES };
    }
    if (this.cowerFrames > 0 || this.stuckFrames > 0) {
      return { row: 'cower', progress: 0 };
    }
    if (this.hurtFrames > 0) return { row: 'hurt', progress: 1 - this.hurtFrames / HURT_FRAMES };
    // A looping row ignores `progress` in general; the flee row reads it as its
    // cycle phase, because the kit is what moved him and knows how far.
    if (this.fleeing && this.fleeMovedLastFrame) return { row: 'flee', progress: this.fleeCycle };
    return locomotionState(merc);
  }

  drainProjectiles(): readonly HirelingProjectile[] {
    return NO_PROJECTILES;
  }

  clearAirborne(): void {
    this.strike.cancel();
    this.channel = null;
    // Whatever HP it had before is no baseline for what it has now: a hire
    // stood up by a revive would otherwise flinch at its own fall.
    this.lastHp = null;
    this.sparkles.length = 0;
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const sparkle of this.sparkles) {
      const progress = sparkle.frame / TRIAGE_SPARKLE_FRAMES;
      drawTriageSparkleSprite(
        ctx,
        sparkle.patient.x - camX,
        sparkle.patient.y - camY,
        TILE_SIZE,
        progress,
      );
    }
  }

  // ── Triage ────────────────────────────────────────────────────────────────

  /**
   * The ally worst off by share of health, below the trigger, in range and in
   * sight — himself included. A pet already on its way home, or a crawler
   * knocked out and waiting to be revived, is not his to treat: Mongo's HP is
   * written off when he leaves, and revival is its own rule.
   */
  private findPatient(ctx: MercenaryKitContext): Player | null {
    const merc = ctx.merc;
    const rangePx = TILE_SIZE * TRIAGE_RANGE_TILES;
    let best: Player | null = null;
    let bestFraction = TRIAGE_TRIGGER_HP_FRACTION;
    const candidates: readonly Player[] = [...ctx.allies, merc];
    for (const friend of candidates) {
      if (!this.isTreatable(ctx, friend, rangePx)) continue;
      const fraction = friend.hp / friend.maxHp;
      if (fraction >= bestFraction) continue;
      best = friend;
      bestFraction = fraction;
    }
    return best;
  }

  /**
   * Whether `friend` is his to treat from where he stands: on his side this
   * frame (or himself), alive and awake, not a pet on its way home, and within
   * `rangePx` and in sight. Asked when a channel starts and again when it
   * releases, because a second is long enough for any of it to change.
   */
  private isTreatable(ctx: MercenaryKitContext, friend: Player, rangePx: number): boolean {
    const merc = ctx.merc;
    if (!friend.isAlive || friend.isKnockedOut || friend.maxHp <= 0) return false;
    if (friend instanceof Mongo && friend.exhausted) return false;
    if (friend === merc) return true;
    if (!ctx.allies.includes(friend)) return false;
    if (Math.hypot(friend.x - merc.x, friend.y - merc.y) > rangePx) return false;
    return this.canSeeFrom(merc, friend);
  }

  private canSeeFrom(merc: Mercenary, other: Player): boolean {
    return merc.hasClearLine(
      merc.x + TILE_CENTER_OFFSET,
      merc.y + TILE_CENTER_OFFSET,
      other.x + TILE_CENTER_OFFSET,
      other.y + TILE_CENTER_OFFSET,
    );
  }

  private beginChannel(ctx: MercenaryKitContext, patient: Player): void {
    this.channel = { patient, frame: 0, released: false };
    this.triageCooldown = TRIAGE_COOLDOWN_FRAMES;
    this.fleeing = false;
    this.stuckFrames = 0;
    ctx.merc.isMoving = false;
    if (patient !== ctx.merc) ctx.merc.faceToward(patient);
    prewarmTriageSparkle();
  }

  /** Drops a channel that cannot finish; he may try again soon, not a full cooldown later. */
  private cancelChannel(): void {
    this.channel = null;
    this.triageCooldown = TRIAGE_INTERRUPTED_RETRY_FRAMES;
  }

  private advanceChannel(ctx: MercenaryKitContext, channel: Channel): void {
    const merc = ctx.merc;
    merc.isMoving = false;
    if (channel.patient !== merc) merc.faceToward(channel.patient);
    // Advanced before the release test, so the heal lands on the tick whose
    // drawn progress first shows the release frame.
    channel.frame++;
    if (!channel.released && channel.frame >= TRIAGE_RELEASE_FRAME) {
      channel.released = true;
      const reachPx = TILE_SIZE * TRIAGE_RANGE_TILES * TRIAGE_RANGE_SLACK_RATIO;
      if (!this.isTreatable(ctx, channel.patient, reachPx)) {
        this.cancelChannel();
        return;
      }
      this.release(ctx, channel.patient);
    }
    if (channel.frame >= TRIAGE_CHANNEL_FRAMES) this.channel = null;
  }

  /**
   * The heal goes on the patient's own HP, clamped to their max, so it shows on
   * their bar and outlives him if he falls a second later.
   */
  private release(ctx: MercenaryKitContext, patient: Player): void {
    const merc = ctx.merc;
    const amount = Math.max(1, Math.round(patient.maxHp * TRIAGE_HEAL_FRACTION));
    const before = patient.hp;
    patient.hp = Math.min(patient.maxHp, patient.hp + amount);
    const restored = patient.hp - before;
    if (restored > 0) patient.queueFloatingText(`+${restored}`, 'buff');
    this.sparkles.push({ patient, frame: 0 });
    merc.specialSoundPending = true;
    ctx.bark('special');
  }

  // ── Fear ──────────────────────────────────────────────────────────────────

  private startCower(ctx: MercenaryKitContext): void {
    this.cowerFrames = COWER_FRAMES;
    this.cowerRearm = COWER_REARM_FRAMES;
    ctx.merc.isMoving = false;
    ctx.bark('engage');
  }

  /**
   * `startPx` is the nearest hostile that may send him running; `endPx` the
   * nearest of any. They differ once he is left behind: a mob whose attention
   * flickers between him and someone else must not end the flee on every
   * frame it looks away, or the follow drive walks him straight back into it.
   */
  private updateFleeLatch(ctx: MercenaryKitContext, startPx: number, endPx: number): void {
    if (!this.fleeing && startPx <= TILE_SIZE * MEDIC_FLEE_ENTER_TILES) {
      this.fleeing = true;
      this.fleeHeading = null;
      this.stuckFrames = 0;
      ctx.bark('engage');
    } else if (this.fleeing && endPx > TILE_SIZE * MEDIC_FLEE_EXIT_TILES) {
      this.fleeing = false;
      this.fleeHeading = null;
      this.stuckFrames = 0;
    }
  }

  /**
   * One frame of running away from `nearest`, or — when running has got him
   * nowhere for long enough — a slap at it.
   */
  private flee(ctx: MercenaryKitContext, nearest: Mob): void {
    const merc = ctx.merc;
    const moved = this.stepAway(ctx);
    if (moved >= merc.moveSpeed * FLEE_PROGRESS_RATIO) {
      this.stuckFrames = 0;
      this.fleeMovedLastFrame = true;
      this.fleeCycle = (this.fleeCycle + this.cycleShareFor(moved)) % 1;
      return;
    }
    this.stuckFrames++;
    merc.isMoving = false;
    merc.faceToward(nearest);
    if (this.stuckFrames < CORNERED_FRAMES) return;
    if (merc.attackCooldown > 0 || ctx.isInSafeRoom(merc)) return;
    const distancePx = Math.hypot(nearest.x - merc.x, nearest.y - merc.y);
    if (distancePx > merc.strikeRangePx * SLAP_TIMING.reachRatio) return;
    this.strike.begin(nearest, SLAP_TIMING, this.slapDamage, merc);
    merc.attackCooldown = SLAP_COOLDOWN_FRAMES;
  }

  private cycleShareFor(movedPx: number): number {
    return Math.min(
      movedPx / (BUCKET_BOY_TILES_PER_FLEE_CYCLE * TILE_SIZE),
      MAX_FLEE_CYCLE_PER_TICK,
    );
  }

  /**
   * Steps along the best open heading away from every hostile nearby and
   * returns the pixels actually covered. The heading is tested against walls
   * before it is taken, and if the step still goes nowhere — a body wedged
   * against masonry refuses the same step forever — the four cardinals are
   * tried in order of how close they are to it.
   */
  private stepAway(ctx: MercenaryKitContext): number {
    const merc = ctx.merc;
    const threat = this.threatVector(ctx);
    const heading = this.chooseHeading(ctx, threat);
    const startX = merc.x;
    const startY = merc.y;
    if (heading === null) return 0;
    this.fleeHeading = heading;
    merc.stepBy(heading.x * merc.moveSpeed, heading.y * merc.moveSpeed);
    let moved = Math.hypot(merc.x - startX, merc.y - startY);
    if (moved < merc.moveSpeed * FLEE_PROGRESS_RATIO) {
      moved = this.unwedge(merc, heading, threat);
    }
    if (moved > 0) {
      const facing = normalize(merc.x - startX, merc.y - startY);
      merc.facingX = facing.x;
      merc.facingY = facing.y;
      merc.isMoving = true;
    }
    return moved;
  }

  /** The direction away from the hostiles within flee range, nearer ones weighing more. */
  private threatVector(ctx: MercenaryKitContext): { x: number; y: number } {
    const merc = ctx.merc;
    const rangePx = TILE_SIZE * MEDIC_FLEE_EXIT_TILES;
    let ax = 0;
    let ay = 0;
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile) continue;
      const dx = merc.x - mob.x;
      const dy = merc.y - mob.y;
      const d = Math.hypot(dx, dy);
      if (d > rangePx) continue;
      // Standing exactly on him gives no direction; any direction will do.
      const safeD = Math.max(d, 1);
      ax += dx / (safeD * safeD);
      ay += dy / (safeD * safeD);
    }
    if (ax === 0 && ay === 0) return { x: 1, y: 0 };
    return normalize(ax, ay);
  }

  private chooseHeading(
    ctx: MercenaryKitContext,
    away: { x: number; y: number },
  ): { x: number; y: number } | null {
    const merc = ctx.merc;
    const ownerDx = ctx.owner.x - merc.x;
    const ownerDy = ctx.owner.y - merc.y;
    const ownerDist = Math.hypot(ownerDx, ownerDy);
    const ownerPull = ownerDist > TILE_SIZE * FLEE_OWNER_PULL_START_TILES;
    const toOwner = ownerPull ? normalize(ownerDx, ownerDy) : { x: 0, y: 0 };
    const probePx = TILE_SIZE * FLEE_PROBE_TILES;
    const cx = merc.x + TILE_CENTER_OFFSET;
    const cy = merc.y + TILE_CENTER_OFFSET;

    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < FLEE_HEADINGS; i++) {
      const angle = (FULL_TURN * i) / FLEE_HEADINGS;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const awayComponent = x * away.x + y * away.y;
      if (awayComponent < FLEE_MIN_AWAY_COMPONENT) continue;
      const probeX = cx + x * probePx;
      const probeY = cy + y * probePx;
      if (!merc.canStandAt(probeX, probeY) || !merc.hasWalkableLine(cx, cy, probeX, probeY)) {
        continue;
      }
      let score = awayComponent + FLEE_OWNER_PULL_WEIGHT * (x * toOwner.x + y * toOwner.y);
      const previous = this.fleeHeading;
      if (previous !== null) score += FLEE_HEADING_STICKINESS * (x * previous.x + y * previous.y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  private unwedge(
    merc: Mercenary,
    heading: { x: number; y: number },
    away: { x: number; y: number },
  ): number {
    const cardinals = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]
      .filter((dir) => dir.x * away.x + dir.y * away.y >= FLEE_MIN_AWAY_COMPONENT)
      .sort((a, b) => b.x * heading.x + b.y * heading.y - (a.x * heading.x + a.y * heading.y));
    for (const dir of cardinals) {
      const startX = merc.x;
      const startY = merc.y;
      merc.stepBy(dir.x * merc.moveSpeed, dir.y * merc.moveSpeed);
      const moved = Math.hypot(merc.x - startX, merc.y - startY);
      if (moved >= merc.moveSpeed * FLEE_PROGRESS_RATIO) {
        this.fleeHeading = dir;
        return moved;
      }
    }
    return 0;
  }

  private isHunting(mob: Mob): boolean {
    const lastHunted = this.lastHuntedAt.get(mob);
    return lastHunted !== undefined && this.clock - lastHunted <= HUNTED_MEMORY_FRAMES;
  }

  /** The nearest living hostile; with `huntingOnly`, the nearest one that has been after him lately. */
  private nearestHostile(
    ctx: MercenaryKitContext,
    huntingOnly: boolean,
  ): { mob: Mob; distancePx: number } | null {
    const merc = ctx.merc;
    let best: Mob | null = null;
    let bestPx = Infinity;
    for (const mob of ctx.allMobs) {
      if (mob === merc || !mob.isAlive || !mob.isHostile) continue;
      if (huntingOnly && !this.isHunting(mob)) continue;
      const d = Math.hypot(mob.x - merc.x, mob.y - merc.y);
      if (d < bestPx) {
        bestPx = d;
        best = mob;
      }
    }
    return best === null ? null : { mob: best, distancePx: bestPx };
  }
}
