import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import { drawDangerCircle } from '../sprites/dangerTelegraph';
import { TILE_SIZE } from '../core/constants';
import {
  GUARD_TENTACLE_EMERGE_FRAMES,
  GUARD_TENTACLE_RETREAT_FRAMES,
  GUARD_TENTACLE_STRIKE_FRAMES,
  TENTACLE_STRIKE_IMPACT_PROGRESS,
} from '../sprites/krakenAttackTiming';
import {
  KRAKEN_TENTACLE_BODY_PART_KEY,
  drawKrakenTentacleSprite,
} from '../sprites/krakenTentacleSprite';
import type { Kraken } from './Kraken';
import { makeStun } from '../core/combat/StatusEffect';
import { KRAKEN_TENTACLE_STUN_FRAMES } from './krakenTentacleTuning';
import type { TilePoint, TileRect } from '../systems/bossRooms/bossRoomLayout';
import {
  RAFT_SLAM_TELEGRAPH_FRAMES,
  chooseSlamFootprint,
  tentacleCentre,
} from '../systems/bossRooms/floodedPumpRoom/raftTentacles';
import { rectContainsTile } from '../systems/bossRooms/floodedPumpRoom/platforms';
import { feetPointPx, tileUnderFeet } from '../map/collisionAnchors';

const GUARD_TENTACLE_HP = 15;
/** It is rooted in the floor it came out of; nothing about it walks. */
const GUARD_TENTACLE_SPEED = 0;
const GUARD_TENTACLE_XP = 25;
const GUARD_TENTACLE_MASS = 4;

/**
 * How long the cracking floor shows before the tentacle is there at all.
 *
 * The spawn point is fixed when the boss requests it and this window never
 * revises it, which is what makes the mark a promise — thirty frames against
 * the 21-frame locked-telegraph floor in `docs/difficulty-fairness-rules.md`.
 */
export const TENTACLE_EMERGE_TELEGRAPH_FRAMES = 30;

const TENTACLE_STRIKE_RANGE_TILES = 1.6;
const TENTACLE_STRIKE_RANGE_PX = TILE_SIZE * TENTACLE_STRIKE_RANGE_TILES;

/**
 * Facing and the point the blow lands on are both frozen for this whole
 * window, so the whip is aimed where the player was when it reared rather than
 * where they are on the frame it connects. Twenty-five frames plus the frames
 * of the row before impact, again over the 21-frame floor.
 */
export const TENTACLE_STRIKE_WINDUP_FRAMES = 25;

/**
 * Flat, and never put through the level multiplier.
 *
 * Two damage from an add whose whole job is to be killed is pressure; the same
 * blow at a boss-room mob level is the fight's third damage source outscaling
 * the boss's own melee.
 */
const TENTACLE_STRIKE_DAMAGE = 2;

const TENTACLE_STRIKE_HIT_RADIUS_TILES = 1.0;
const TENTACLE_STRIKE_HIT_RADIUS_PX = TILE_SIZE * TENTACLE_STRIKE_HIT_RADIUS_TILES;
const TENTACLE_STRIKE_COOLDOWN_FRAMES = 90;

/** Fifteen seconds: an ignored tentacle stops guarding rather than guarding forever. */
export const GUARD_TENTACLE_TTL_FRAMES = 900;

const TENTACLE_DAMAGE_FLASH_FILTER = 'brightness(3)';

/** Game frames each cell of a one-shot row is held for. */
const FRAMES_PER_ANIMATION_CELL = 3;
const EMERGE_ANIMATION_FRAMES = GUARD_TENTACLE_EMERGE_FRAMES * FRAMES_PER_ANIMATION_CELL;
const STRIKE_ANIMATION_FRAMES = GUARD_TENTACLE_STRIKE_FRAMES * FRAMES_PER_ANIMATION_CELL;
const RETREAT_ANIMATION_FRAMES = GUARD_TENTACLE_RETREAT_FRAMES * FRAMES_PER_ANIMATION_CELL;

/** Covers the strike reach and the baked cell's overhang either side of the tile. */
const KRAKEN_TENTACLE_CULL_MARGIN_TILES = 2;

const CENTER_OFFSET = 0.5;
const SECONDS_PER_LOOP_OFFSET = 1;

// The cracking floor that stands in for the tentacle until it is there.
const TELEGRAPH_RING_RADIUS_TILES = 0.55;
/** The warning is fixed on this tile from the moment it appears, so it shows at full strength. */
const TELEGRAPH_WARNING_FADE = 1;
const TELEGRAPH_CRACK_LINE_WIDTH = 2;
/** The broken floor's dark seams, drawn over the red warning as the tentacle's own effect. */
const TELEGRAPH_CRACK_COLOR = 'rgba(28, 12, 8, 0.8)';
const TELEGRAPH_CRACK_COUNT = 5;
const TELEGRAPH_CRACK_INNER_SHARE = 0.25;
const FULL_TURN = Math.PI * 2;

/**
 * Frames a raft or pump tentacle waits after a slam or a whip before it marks
 * the next footprint: long enough to walk out from under the last one and
 * line up a blow of one's own.
 */
const PLATFORM_SLAM_COOLDOWN_FRAMES = 90;

/**
 * How much bigger than a guard a raft or pump tentacle is drawn: it rears out
 * of open water over a whole raft, so it is drawn at the size of the danger
 * it brings, rooted on its own tile.
 */
const PLATFORM_TENTACLE_ART_SCALE = 2;

/** A slam and a whip are the same blow, sized as the guard's. */
const PLATFORM_STRIKE_DAMAGE = TENTACLE_STRIKE_DAMAGE;

/**
 * How far past the edge of its platform, in tiles to the crawler's centre, a
 * water whip reaches: the step a crawler takes from the platform into the
 * water, with room for a stroke's worth of drift on the frame it is judged.
 */
const WATER_WHIP_REACH_TILES = 1.5;

type KrakenTentacleState =
  | 'emerging'
  | 'idle'
  | 'strike_windup'
  | 'slam_telegraph'
  | 'striking'
  | 'strike_cooldown'
  | 'retreating';

/**
 * What a tentacle is for, which decides everything it does:
 *
 * - `guard`: one the Kraken drags up beside her prey once the room is
 *   drained, to whip whoever is fighting her; it leaves when she falls or
 *   when ignored too long.
 * - `raft`: the one tentacle a raft owns, risen beside it the first time the
 *   active crawler boards it.
 * - `pump`: the one that rises beside the raft of the second pump shut off.
 *
 * A raft or pump tentacle guards its `platform`: it slams the active crawler
 * standing on it under a red footprint, whips them the moment they step off it
 * into the water while it lives, and sinks back under when killed.
 */
export type KrakenTentacleRole =
  | { readonly kind: 'guard'; readonly owner: Kraken | null }
  | { readonly kind: 'raft'; readonly platform: TileRect }
  | { readonly kind: 'pump'; readonly platform: TileRect };

const UNOWNED_GUARD: KrakenTentacleRole = { kind: 'guard', owner: null };

/** Which blow a strike row is carrying. */
type StrikeKind = 'guard_whip' | 'slam' | 'water_whip';

/** A slam's red footprint while it is shown and until it lands. */
export interface TentacleSlamMark {
  readonly footprint: TileRect;
  /** 0 as the footprint appears, 1 on the frame the slam lands. */
  readonly progress: number;
}

function displayNameFor(role: KrakenTentacleRole): string {
  switch (role.kind) {
    case 'guard':
      return 'Guard Tentacle';
    case 'raft':
      return 'Raft Tentacle';
    case 'pump':
      return 'Pump Tentacle';
    default: {
      const unhandled: never = role;
      throw new Error(`unhandled tentacle role ${JSON.stringify(unhandled)}`);
    }
  }
}

function descriptionFor(role: KrakenTentacleRole): string {
  switch (role.kind) {
    case 'guard':
      return "A thick tentacle rooted through the floor. While it lives, the Kraken's hide holds.";
    case 'raft':
    case 'pump':
      return 'A tentacle risen from the flood. While it lives, stepping off into the water is a mistake.';
    default: {
      const unhandled: never = role;
      throw new Error(`unhandled tentacle role ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * A Kraken tentacle: a small, killable add rooted where it came up, whose
 * behaviour is its {@link KrakenTentacleRole}.

 */
export class KrakenTentacle extends Mob {
  /** A tentacle has no head; its eyes belong to the body. */
  protected override get eyePlacement(): EyePlacement | null {
    return null;
  }

  readonly xpValue = GUARD_TENTACLE_XP;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  /** A guard bursts apart when cut down; a raft or pump tentacle sinks back into the flood whole. */
  override get bodyPartKey(): string | null {
    return this.role.kind === 'guard' ? KRAKEN_TENTACLE_BODY_PART_KEY : null;
  }

  /** Kept in the world after a kill so a raft or pump tentacle can be seen sinking. */
  override readonly rendersWhenDead = true;
  /**
   * Its own tag rather than the boss's `'kraken'`: `dealPreScaledDamage`
   * raises `attackSoundPending` on every connecting strike, and sharing the
   * boss's tag would route that through her `kraken_ground_slam` case in
   * `playMobAudioCues` — the tentacle's strike sound is a dedicated flag
   * instead (see {@link strikeSoundPending}).
   */
  override readonly audioTag = 'kraken_tentacle';
  mass = GUARD_TENTACLE_MASS;

  /** A boss's own conjured guard is not a kill the party earned, so it seeds no swarm. */
  override get seedsOnKillSpawns(): boolean {
    return false;
  }

  /** Frames until it gives up and pulls itself back under. Ticked by BossRoomSystem. */
  ttl = GUARD_TENTACLE_TTL_FRAMES;

  readonly role: KrakenTentacleRole;

  /**
   * The one crawler a raft or pump tentacle may hit: the active one, handed it
   * each frame by the room. Its slams and whips are judged against nobody
   * else, so the companion walking the leader's trail is never struck.
   */
  quarry: Player | null = null;

  private state: KrakenTentacleState = 'emerging';
  private telegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
  private phaseTimer = EMERGE_ANIMATION_FRAMES;
  private strikeCooldownTimer = 0;
  private strikeDamagePending = false;
  private strikePointX = 0;
  private strikePointY = 0;
  private strikeKind: StrikeKind = 'guard_whip';
  private slamFootprint: TileRect | null = null;
  private facingLocked = false;
  /** Frames a killed raft or pump tentacle has been sinking. */
  private sinkFrames = 0;

  /** Raised the frame the telegraph ends and the emerge row itself begins. */
  emergeSoundPending = false;
  /** Raised on the strike's damage frame, whether or not it connects. */
  strikeSoundPending = false;
  /** Raised the frame a raft or pump tentacle's slam lands on its platform. */
  slamSoundPending = false;

  /**
   * True once the retreat row has played out. A despawn is not a death, so the
   * HP hitting zero here must not be mistaken for one — this is the terminal
   * phase that stops the retreat from restarting and stops anything reading
   * `isAlive` from re-latching a kill that never happened.
   */
  private retreatComplete = false;

  /** Keeps two tentacles from swaying in lockstep. */
  private readonly loopOffsetSeconds = Math.random() * SECONDS_PER_LOOP_OFFSET;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    role: KrakenTentacleRole = UNOWNED_GUARD,
  ) {
    super(tileX, tileY, tileSize, GUARD_TENTACLE_HP, GUARD_TENTACLE_SPEED);
    this.role = role;
    this.displayName = displayNameFor(role);
    this.description = descriptionFor(role);
  }

  /**
   * The boss that pulled a guard up, or null for any other tentacle and for a
   * guard staged outside a fight.
   *
   * Read only to ask whether she is still standing: her guard tentacles leave
   * with her, and the reference points from the short-lived mob at the
   * long-lived one rather than the other way round, so nothing here can pin a
   * corpse the roster would otherwise drop.
   */
  get owner(): Kraken | null {
    return this.role.kind === 'guard' ? this.role.owner : null;
  }

  /** The red footprint of a slam on its way, or null when none is. */
  get slamMark(): TentacleSlamMark | null {
    const footprint = this.slamFootprint;
    if (footprint === null) return null;
    switch (this.state) {
      case 'slam_telegraph':
        return { footprint, progress: 1 - this.phaseTimer / RAFT_SLAM_TELEGRAPH_FRAMES };
      case 'striking':
        return this.strikeDamagePending ? { footprint, progress: 1 } : null;
      case 'emerging':
      case 'idle':
      case 'strike_windup':
      case 'strike_cooldown':
      case 'retreating':
        return null;
      default: {
        const unhandled: never = this.state;
        throw new Error(`unhandled tentacle state ${String(unhandled)}`);
      }
    }
  }

  /**
   * A raft or pump tentacle lashing at the crawler who has just stepped off
   * its platform into the water: the stun lands at once, before they can take
   * another stroke, whatever else it was doing. One still rising under the
   * floor bursts out to do it, so stepping straight back off a raft whose
   * tentacle has only just woken is no way past it. False when it cannot
   * strike: leaving, dead, a guard, or the crawler out of reach of its platform.
   */
  whip(target: Player): boolean {
    const role = this.role;
    if (role.kind === 'guard') return false;
    if (!this.isAlive || this.isLeaving) return false;
    if (!this.reachesFromPlatform(role.platform, target)) return false;
    this.telegraphTimer = 0;
    this.facingLocked = false;
    this.faceToward(target);
    this.facingLocked = true;
    this.slamFootprint = null;
    this.state = 'striking';
    this.strikeKind = 'water_whip';
    this.phaseTimer = STRIKE_ANIMATION_FRAMES;
    this.strikeDamagePending = false;
    this.strikeSoundPending = true;
    // Stunned whether or not the blow itself is dodged: the stun is the
    // tentacle holding them in the water, which is what keeps a crawler from
    // swimming on past a tentacle they never killed.
    target.applyStatus(makeStun(KRAKEN_TENTACLE_STUN_FRAMES));
    this.dealPreScaledRangedDamage(target, PLATFORM_STRIKE_DAMAGE, 'tentacle_strike');
    return true;
  }

  private reachesFromPlatform(platform: TileRect, target: Player): boolean {
    const feet = feetPointPx(target, this.tileSize);
    const feetX = feet.x / this.tileSize;
    const feetY = feet.y / this.tileSize;
    const nearestX = Math.min(Math.max(feetX, platform.x), platform.x + platform.w);
    const nearestY = Math.min(Math.max(feetY, platform.y), platform.y + platform.h);
    return Math.hypot(feetX - nearestX, feetY - nearestY) <= WATER_WHIP_REACH_TILES;
  }

  /** Rooted in the floor: the separation shove must not slide it off its crack. */
  protected override moveWithCollision(_dx: number, _dy: number): void {
    // No-op: immobile add.
  }

  override get cullMarginTiles(): number {
    return KRAKEN_TENTACLE_CULL_MARGIN_TILES * this.artScale;
  }

  /** How much bigger than its tile this tentacle is drawn. */
  private get artScale(): number {
    return this.role.kind === 'guard' ? 1 : PLATFORM_TENTACLE_ART_SCALE;
  }

  /** True while it is still underground and only the floor telegraph is showing. */
  get isUnderground(): boolean {
    return this.state === 'emerging' && this.telegraphTimer > 0;
  }

  /**
   * Nothing to hit yet. It is not in the room during the telegraph — it is a
   * crack in the floor — and a blow that landed on it would be a hit on a mob
   * the player cannot see.
   */
  protected override get isDamageImmune(): boolean {
    return this.isUnderground;
  }

  /** True once it has been counted out and is only playing its exit. */
  get isLeaving(): boolean {
    return this.state === 'retreating';
  }

  /** Whether this tentacle still counts towards the boss's guard. */
  get isGuarding(): boolean {
    return this.isAlive && !this.isLeaving;
  }

  /**
   * Takes it out of the world at once, with nothing to watch and nothing
   * earned: a room standing its tentacles up again after a rewind.
   */
  despawn(): void {
    this.retreatComplete = true;
    this.slamFootprint = null;
    this.hp = 0;
  }

  /**
   * Sends it back under: TTL expiry, or its owner falling. Killed tentacles do
   * not come through here — they burst into gore, which is the whole read of
   * having cut one down.
   */
  beginRetreat(): void {
    if (!this.isAlive || this.state === 'retreating') return;
    this.state = 'retreating';
    this.phaseTimer = RETREAT_ANIMATION_FRAMES;
    this.strikeDamagePending = false;
    this.slamFootprint = null;
    this.facingLocked = false;
  }

  protected override clearEncounterPhase(): void {
    this.state = 'emerging';
    this.telegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
    this.phaseTimer = EMERGE_ANIMATION_FRAMES;
    this.strikeCooldownTimer = 0;
    this.strikeDamagePending = false;
    this.facingLocked = false;
    this.retreatComplete = false;
    this.ttl = GUARD_TENTACLE_TTL_FRAMES;
    this.emergeSoundPending = false;
    this.strikeSoundPending = false;
    this.slamSoundPending = false;
    this.slamFootprint = null;
    this.sinkFrames = 0;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    switch (this.state) {
      case 'emerging':
        this.doEmerging();
        break;
      case 'idle':
        this.doIdleForRole(targets);
        break;
      case 'strike_windup':
        this.doStrikeWindup();
        break;
      case 'slam_telegraph':
        this.doSlamTelegraph();
        break;
      case 'striking':
        this.doStriking(targets);
        break;
      case 'strike_cooldown':
        this.doStrikeCooldown();
        break;
      case 'retreating':
        this.doRetreating();
        break;
    }
  }

  private doEmerging(): void {
    if (this.telegraphTimer > 0) {
      this.telegraphTimer--;
      if (this.telegraphTimer === 0) this.emergeSoundPending = true;
      return;
    }
    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      this.state = 'idle';
    }
  }

  private doIdleForRole(targets: Player[]): void {
    switch (this.role.kind) {
      case 'guard':
        this.doIdle(targets);
        return;
      case 'raft':
      case 'pump':
        this.doGuardPlatform(this.role.platform);
        return;
      default: {
        const unhandled: never = this.role;
        throw new Error(`unhandled tentacle role ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Waits out its cooldown, then marks a footprint on its platform under the
   * active crawler standing there, if they stand within its slam's reach.
   * The footprint is fixed from that frame on, so stepping out of it is the
   * counterplay.
   */
  private doGuardPlatform(platform: TileRect): void {
    if (this.strikeCooldownTimer > 0) this.strikeCooldownTimer--;
    const quarry = this.quarry;
    this.currentTarget = quarry;
    if (quarry === null || !quarry.isAlive || this.strikeCooldownTimer > 0) return;
    const tile = tileUnderFeet(quarry, this.tileSize);
    if (!rectContainsTile(platform, tile.x, tile.y)) return;
    const footprint = chooseSlamFootprint(platform, tentacleCentre(this.ownTile()), tile);
    if (footprint === null) return;
    this.slamFootprint = footprint;
    this.state = 'slam_telegraph';
    this.phaseTimer = RAFT_SLAM_TELEGRAPH_FRAMES;
    this.faceToward(quarry);
    this.facingLocked = true;
  }

  private doSlamTelegraph(): void {
    this.phaseTimer--;
    if (this.phaseTimer > 0) return;
    this.state = 'striking';
    this.strikeKind = 'slam';
    this.phaseTimer = STRIKE_ANIMATION_FRAMES;
    this.strikeDamagePending = true;
  }

  /** Lands a slam on whoever of the active crawler stands in its footprint, and nobody else. */
  private resolveSlam(): void {
    const footprint = this.slamFootprint;
    this.slamFootprint = null;
    this.slamSoundPending = true;
    const quarry = this.quarry;
    if (footprint === null || quarry?.isAlive !== true) return;
    const tile = tileUnderFeet(quarry, this.tileSize);
    if (!rectContainsTile(footprint, tile.x, tile.y)) return;
    const connected = this.dealPreScaledRangedDamage(
      quarry,
      PLATFORM_STRIKE_DAMAGE,
      'tentacle_strike',
    );
    if (connected) quarry.applyStatus(makeStun(KRAKEN_TENTACLE_STUN_FRAMES));
  }

  /** The tile under the tentacle's own centre, where it rises from. */
  private ownTile(): TilePoint {
    return {
      x: Math.floor((this.x + this.tileSize * CENTER_OFFSET) / this.tileSize),
      y: Math.floor((this.y + this.tileSize * CENTER_OFFSET) / this.tileSize),
    };
  }

  private doIdle(targets: Player[]): void {
    if (this.strikeCooldownTimer > 0) this.strikeCooldownTimer--;

    const nearest = this.acquireTarget(targets, TENTACLE_STRIKE_RANGE_PX);
    this.currentTarget = nearest;
    if (nearest === null) return;

    this.faceToward(nearest);
    if (this.strikeCooldownTimer > 0) return;
    this.startStrikeWindup(nearest);
  }

  /**
   * The blow commits here. Both the facing the row is picked from and the point
   * the damage is measured against are taken now and never revised, so the
   * reared tentacle is a statement about the tile it is going to hit.
   */
  private startStrikeWindup(target: Player): void {
    this.state = 'strike_windup';
    this.phaseTimer = TENTACLE_STRIKE_WINDUP_FRAMES;
    const feet = feetPointPx(target, this.tileSize);
    this.strikePointX = feet.x;
    this.strikePointY = feet.y;
    this.faceToward(target);
    this.facingLocked = true;
  }

  private doStrikeWindup(): void {
    this.phaseTimer--;
    if (this.phaseTimer <= 0) {
      this.state = 'striking';
      this.strikeKind = 'guard_whip';
      this.phaseTimer = STRIKE_ANIMATION_FRAMES;
      this.strikeDamagePending = true;
    }
  }

  private doStriking(targets: Player[]): void {
    this.phaseTimer--;
    const progress = 1 - this.phaseTimer / STRIKE_ANIMATION_FRAMES;
    if (this.strikeDamagePending && progress >= TENTACLE_STRIKE_IMPACT_PROGRESS) {
      this.strikeDamagePending = false;
      this.resolveStrikeKind(targets);
    }
    if (this.phaseTimer <= 0) {
      this.state = 'strike_cooldown';
      this.strikeCooldownTimer =
        this.role.kind === 'guard'
          ? TENTACLE_STRIKE_COOLDOWN_FRAMES
          : PLATFORM_SLAM_COOLDOWN_FRAMES;
      this.facingLocked = false;
    }
  }

  private resolveStrikeKind(targets: Player[]): void {
    switch (this.strikeKind) {
      case 'guard_whip':
        this.strikeSoundPending = true;
        this.resolveStrike(targets);
        return;
      case 'slam':
        this.resolveSlam();
        return;
      case 'water_whip':
        // Its blow and its stun landed the frame it was asked for.
        return;
      default: {
        const unhandled: never = this.strikeKind;
        throw new Error(`unhandled strike kind ${String(unhandled)}`);
      }
    }
  }

  /**
   * Whoever is standing on the marked ground when the whip lands, rather than
   * whoever it was aimed at: the point is fixed, so stepping off it is the
   * counterplay and stepping onto it is the mistake.
   */
  private resolveStrike(targets: Player[]): void {
    for (const target of targets) {
      if (!target.isAlive) continue;
      const feet = feetPointPx(target, this.tileSize);
      const dx = feet.x - this.strikePointX;
      const dy = feet.y - this.strikePointY;
      if (Math.hypot(dx, dy) > TENTACLE_STRIKE_HIT_RADIUS_PX) continue;
      const connected = this.dealPreScaledRangedDamage(
        target,
        TENTACLE_STRIKE_DAMAGE,
        'tentacle_strike',
      );
      if (connected) target.applyStatus(makeStun(KRAKEN_TENTACLE_STUN_FRAMES));
    }
  }

  private doStrikeCooldown(): void {
    this.strikeCooldownTimer--;
    if (this.strikeCooldownTimer <= 0) this.state = 'idle';
  }

  private doRetreating(): void {
    this.phaseTimer--;
    if (this.phaseTimer > 0 || this.retreatComplete) return;
    // Zeroed without `justDied`, the same way a spent cockroach leaves: nothing
    // killed it, so there is no gore, no XP and no kill credit — the boss-room
    // compaction pass drops it from the roster on the next frame.
    this.retreatComplete = true;
    this.hp = 0;
  }

  /** A killed raft or pump tentacle plays its retreat row as it sinks. */
  override tickCorpse(): void {
    if (this.sinkFrames < RETREAT_ANIMATION_FRAMES) this.sinkFrames++;
  }

  /**
   * A guard leaves nothing to watch: it bursts into gore, or slid under on
   * its own. A raft or pump tentacle is done once it has sunk.
   */
  override get corpseExpired(): boolean {
    if (this.role.kind === 'guard' || this.retreatComplete) return true;
    return this.sinkFrames >= RETREAT_ANIMATION_FRAMES;
  }

  /**
   * The strike row is chosen off facing, so a tentacle that kept turning
   * through its wind-up would whip in a direction it only settled on at the
   * moment of impact. Committed at the wind-up and held to it.
   */
  protected override faceToward(target: { readonly x: number; readonly y: number }): void {
    if (this.facingLocked) return;
    super.faceToward(target);
  }

  /** 0–1 through the emerge row, or null when it is not hauling itself out. */
  private get emergeProgress(): number | null {
    if (this.state !== 'emerging' || this.telegraphTimer > 0) return null;
    return 1 - this.phaseTimer / EMERGE_ANIMATION_FRAMES;
  }

  private get strikeProgress(): number | null {
    if (this.state !== 'striking') return null;
    return 1 - this.phaseTimer / STRIKE_ANIMATION_FRAMES;
  }

  private get retreatProgress(): number | null {
    if (!this.isAlive) return this.sinkFrames / RETREAT_ANIMATION_FRAMES;
    if (this.state !== 'retreating') return null;
    return 1 - this.phaseTimer / RETREAT_ANIMATION_FRAMES;
  }

  /** Whether a killed raft or pump tentacle is still to be seen sinking. */
  private get isSinking(): boolean {
    return !this.isAlive && !this.corpseExpired;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive && !this.isSinking) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isUnderground) {
      this.drawEmergeTelegraph(ctx, sx, sy, tileSize);
      return;
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = TENTACLE_DAMAGE_FLASH_FILTER;
    }

    const artTile = tileSize * this.artScale;
    const artX = sx + (tileSize - artTile) * CENTER_OFFSET;
    const artY = sy + tileSize - artTile;
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawKrakenTentacleSprite(ctx, artX, artY, artTile, {
        facingX: this.facingX,
        facingY: this.facingY,
        emergeProgress: this.emergeProgress,
        strikeProgress: this.strikeProgress,
        retreatProgress: this.retreatProgress,
        loopOffsetSeconds: this.loopOffsetSeconds,
      });
    });

    ctx.restore();

    if (this.isAlive) this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }

  /**
   * The floor breaking open where it is about to come up. Drawn from this mob
   * rather than by a system because it marks this mob's own tile — unlike the
   * boss's slam, whose mark can be twelve tiles from her.
   */
  private drawEmergeTelegraph(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const progress = 1 - this.telegraphTimer / TENTACLE_EMERGE_TELEGRAPH_FRAMES;
    const centreX = sx + tileSize * CENTER_OFFSET;
    const centreY = sy + tileSize * CENTER_OFFSET;
    const radius = tileSize * TELEGRAPH_RING_RADIUS_TILES;

    drawDangerCircle(ctx, centreX, centreY, radius, TELEGRAPH_WARNING_FADE, {
      fillProgress: progress,
      locked: true,
    });

    ctx.save();
    ctx.strokeStyle = TELEGRAPH_CRACK_COLOR;
    ctx.lineWidth = TELEGRAPH_CRACK_LINE_WIDTH;
    ctx.globalAlpha = progress;
    ctx.beginPath();
    for (let i = 0; i < TELEGRAPH_CRACK_COUNT; i++) {
      const angle = (i / TELEGRAPH_CRACK_COUNT) * FULL_TURN;
      const inner = radius * TELEGRAPH_CRACK_INNER_SHARE;
      ctx.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
      ctx.lineTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
    }
    ctx.stroke();
    ctx.restore();
  }
}
