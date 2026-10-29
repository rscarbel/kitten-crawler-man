import type { Player } from '../Player';
import { usefulSkillBook } from './skillBookDrop';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob } from './Mob';
import type { LootDrop, PlayerDamageType } from './Mob';
import { SoundCueQueue, type TrashGremlinSoundCue } from './creatureSoundCues';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';
import {
  TRASH_GREMLIN_BODY_PART_KEY,
  TRASH_GREMLIN_EYES,
  TRASH_GREMLIN_SCURRY_FRAMES,
  TRASH_GREMLIN_SCURRY_GROUND_TILES,
  TRASH_GREMLIN_SUMMON_EVENT_PROGRESS,
  TRASH_GREMLIN_SUMMON_FRAMES,
  TRASH_GREMLIN_VOMIT_RELEASE_PROGRESS,
  drawTrashGremlinSprite,
  prewarmTrashGremlinGore,
  prewarmTrashGremlinLocomotion,
  prewarmTrashGremlinSummon,
  prewarmTrashGremlinVomit,
} from '../sprites/trashGremlinSprite';
import { prewarmGremlinBile } from '../sprites/gremlinBileSprite';
import { prewarmCockroach } from '../sprites/cockroachSprite';
import { IDLE_FRAMES_BEFORE_RELEASE, figureCacheFrame } from '../sprites/figure/figureFrameCache';

const TRASH_GREMLIN_HP = 80;
const TRASH_GREMLIN_MASS = 10;
export const TRASH_GREMLIN_SPEED = 0.45;
const TRASH_GREMLIN_SPEED_ENRAGED = 0.75;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const FLEE_RANGE_TILE_MULTIPLIER = 8;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
const FLEE_RANGE_PX = TILE_SIZE * FLEE_RANGE_TILE_MULTIPLIER;
/** How far past its flee range a crawler must be before it will walk back to its nest. */
const BED_MARGIN_TILES = 1.5;
const BED_RANGE_PX = FLEE_RANGE_PX + TILE_SIZE * BED_MARGIN_TILES;
/** A way to its nest within about sixty degrees of the crawler counts as toward them (a cosine). */
const BED_TOWARD_THREAT_COSINE = 0.5;
const ENRAGE_THRESHOLD = 0.5;
/**
 * The bile and the cockroaches are two attacks on two clocks. Tied to one clock
 * it would only spit when the roach cap was already full, so in a normal clear
 * the acid would never appear and the fight would be three roaches and nothing
 * else.
 */
const VOMIT_INTERVAL = 210;
/**
 * Longer than the unenraged interval, not shorter, because enraged it throws
 * three at a time: the volley is what grows, and the pace has to give way to it
 * or the room silts up. What actually bounds the coverage is the crowding rule
 * at the far end — pools cannot stack, so the floor fills with spread-out
 * hazard and lanes between rather than with one wall.
 */
const VOMIT_INTERVAL_ENRAGED = 240;
const PURGE_INTERVAL = 300;
const PURGE_INTERVAL_ENRAGED = 190;
/** How soon it tries again when the purge found the roach cap already full. */
const PURGE_RETRY_INTERVAL = 90;
/** Game frames each painted frame of the summon row is held for. */
const SUMMON_TICKS_PER_PAINTED_FRAME = 6;
export const SUMMON_WINDUP_FRAMES = TRASH_GREMLIN_SUMMON_FRAMES * SUMMON_TICKS_PER_PAINTED_FRAME;
/**
 * It will not spit at a player standing this close, and `BossRoomSystem` forms
 * no pool this close to it either — one rule, so it is one constant.
 *
 * Pools laid at its own feet would make the fight a wall of acid: every one
 * of them lands on the ground a melee attacker has to stand on, so the room
 * silts up until there is no way in at all. The value is the pool's own radius
 * (two tiles) plus the ring a melee attacker occupies, which is what it takes
 * for a pool landing at the edge of the bubble not to burn back into that ring.
 * Aiming and forming have to agree: with the two apart, it would spend whole
 * attacks on players in the gap, and the pool would be silently discarded on landing.
 */
export const POINT_BLANK_TILES = 3.5;
const POINT_BLANK_RANGE_PX = TILE_SIZE * POINT_BLANK_TILES;
/** Thirty seconds: how often it is allowed one spit at someone at its feet. */
const POINT_BLANK_ALLOWANCE_FRAMES = 1800;
/**
 * How soon it tries again when every candidate was at its feet or already
 * standing in its acid. Short, because the shot is deferred rather than spent
 * and a player who steps back should be spat at promptly.
 */
const VOMIT_RETRY_INTERVAL = 45;
export const VOMIT_WINDUP_FRAMES = 80;
const VOMIT_SPEED = 3.5;
/**
 * Enraged it brings up three at once. A spread rather than a faster single
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
const PURGE_ROACHES_MIN = 3;
const PURGE_ROACHES_MAX = 5;
/** Covers the sheet: the art stands several tiles tall and the frame is wider still. */
const TRASH_GREMLIN_CULL_MARGIN_TILES = 4;
const COIN_DROP_MIN = 50;
const MAX_COCKROACHES = 5;
/** How often it asks whether it is cornered, and how little ground counts as cornered. */
const CORNERED_CHECK_FRAMES = 45;
const CORNERED_TRAVEL_TILES = 0.5;
const CORNERED_TRAVEL_PX = TILE_SIZE * CORNERED_TRAVEL_TILES;
/** How long it commits to running for a gap before fleeing straight again. */
const ORBIT_COMMIT_FRAMES = 150;
/** A gap whose way lies no more than this far toward the threat counts as clear of it (a cosine). */
const ORBIT_MIN_ALIGNMENT = -0.2;
/** How much a clear way out outweighs sheer distance from the threat. */
const ORBIT_CLEAR_BONUS_TILES = 6;
const ORBIT_CLEAR_BONUS_PX = TILE_SIZE * ORBIT_CLEAR_BONUS_TILES;
const ENRAGED_MAX_COCKROACHES = 7;
const COIN_DROP_MAX = 100;
const FULL_TURN_RADIANS = Math.PI * 2;
/**
 * The scurry is advanced by the ground it actually covers, so a planted foot
 * stays put on the floor. Capped at one painted frame per tick: past that the
 * row is undersampled and a separation shove would strobe its legs.
 */
const MAX_GAIT_RADIANS_PER_FRAME = FULL_TURN_RADIANS / TRASH_GREMLIN_SCURRY_FRAMES;
/**
 * How often, in the figure cache's own frames, a row still wanted is asked for
 * again. The cache frees a row nobody has drawn or asked for in
 * `IDLE_FRAMES_BEFORE_RELEASE` of its frames; asking at half that keeps it
 * resident, and a request for a row that is still warm bakes nothing.
 */
const ROW_REWARM_FRAMES = Math.floor(IDLE_FRAMES_BEFORE_RELEASE / 2);
const NEVER_WARMED = -Infinity;

type TrashGremlinState = 'fleeing' | 'vomit_windup' | 'summon';

function warmAttacks(): void {
  prewarmTrashGremlinSummon();
  prewarmTrashGremlinVomit();
  prewarmGremlinBile();
  prewarmCockroach();
}

export class TrashGremlin extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return TRASH_GREMLIN_EYES;
  }

  override readonly audioTag = 'trash_gremlin';
  readonly xpValue = 500;
  override get bodyPartKey(): string {
    return TRASH_GREMLIN_BODY_PART_KEY;
  }
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Trash Gremlin';
  description =
    'King of the floor-one dump. It scurries out of reach, spits acid from a swollen throat, and shrieks its cockroach subjects out of the trash piles.';
  mass = TRASH_GREMLIN_MASS;

  isEnraged = false;

  private readonly soundCues = new SoundCueQueue<TrashGremlinSoundCue>();
  private trashGremlinState: TrashGremlinState = 'fleeing';
  private vomitTimer = VOMIT_INTERVAL;
  private purgeTimer = PURGE_INTERVAL;
  private vomitWindupTimer = 0;
  private summonTimer = 0;
  private summonFired = false;
  /** Who the summon was started against: the piles nearest them hatch first. */
  private summonTarget: Player | null = null;
  private vomitFired = false;
  private vomitTargetX = 0;
  private vomitTargetY = 0;
  private pointBlankTimer = 0;
  /**
   * Who this wind-up was aimed at, tracked so the bolus still lands on a player
   * who kept walking. Only ever the player chosen when the attack started: the
   * choice is what keeps the acid off its own doorstep and away from pools it
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
   * gremlin cannot see the system's puddle list, and a player the floor is
   * already burning is not worth a spit.
   */
  isAcidCovered: ((x: number, y: number) => boolean) | null = null;

  /**
   * How many purges have reached the summon's peak, whatever they yielded. A
   * purge's roaches come out of the piles over several frames after it, so
   * counting roaches is not counting purges.
   */
  purgesBegun = 0;

  /**
   * Set by its lair: at the summon's peak, sets `count` roaches rustling in the
   * trash piles nearest `target`. Every roach in the fight comes out of the
   * junk; none ever comes out of the gremlin. Returns how many were queued.
   */
  roachNest: ((target: { x: number; y: number }, count: number) => number) | null = null;

  /**
   * Set by its lair: where it lies when nobody is there to run from — the top
   * left of the tile at the middle of its nest. Null sends it back to where it
   * spawned.
   */
  restingPlace: { x: number; y: number } | null = null;

  /**
   * Set by its lair: open ground in the gaps between its islands, as mob
   * positions, in order round the loop. Null in a room with nothing to run round.
   */
  fleeWaypoints: ReadonlyArray<{ x: number; y: number }> | null = null;
  private orbitTarget: { x: number; y: number } | null = null;
  private orbitFrames = 0;
  private corneredCheckFrames = 0;
  private corneredAnchorX = 0;
  private corneredAnchorY = 0;

  /**
   * How many of its roaches may be alive at once. Enraged it calls up more
   * than the room can clear at its calm pace: it is the easiest boss, and the
   * second half of its fight is where it stops being easy.
   */
  get cockroachCap(): number {
    return this.isEnraged ? ENRAGED_MAX_COCKROACHES : MAX_COCKROACHES;
  }

  /** Bile released this frame. BossRoomSystem drains it; enraged there is more than one. */
  pendingVomitProjectiles: Array<{ x: number; y: number; dx: number; dy: number }> = [];

  override clearAirborneAttacks(): void {
    this.pendingVomitProjectiles = [];
  }

  /** How far through the vomit animation it is, or null when not vomiting. */
  get vomitProgress(): number | null {
    if (this.trashGremlinState !== 'vomit_windup') return null;
    return 1 - this.vomitWindupTimer / VOMIT_WINDUP_FRAMES;
  }

  /** How far through the summon animation it is, or null when not summoning. */
  get summonProgress(): number | null {
    if (this.trashGremlinState !== 'summon') return null;
    return 1 - this.summonTimer / SUMMON_WINDUP_FRAMES;
  }

  /**
   * It is drawn several tiles tall over a one-tile mob, so the cull margin has
   * to cover the art rather than the footprint or it pops out of existence
   * while most of it is still on screen.
   */
  override get cullMarginTiles(): number {
    return TRASH_GREMLIN_CULL_MARGIN_TILES;
  }

  private gaitSampleX: number;
  private gaitSampleY: number;

  /** The cache frame each group of rows was last asked for on; see {@link ROW_REWARM_FRAMES}. */
  private locomotionWarmedAt = NEVER_WARMED;
  private attacksWarmedAt = NEVER_WARMED;
  /** Whether its AI was last handed anyone to fight, which happens only once its room is sealed. */
  private engaged = false;
  private goreWarmedAt = NEVER_WARMED;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TRASH_GREMLIN_HP, TRASH_GREMLIN_SPEED);
    this.isBoss = true;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  /**
   * Measured over the previous frame so it also picks up the ground lost to
   * collision slides and separation pushes, not just the intended step.
   */
  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    const radiansPerPixel = FULL_TURN_RADIANS / (TRASH_GREMLIN_SCURRY_GROUND_TILES * this.tileSize);
    this.walkFrameSpeed = Math.min(coveredPx * radiansPerPixel, MAX_GAIT_RADIANS_PER_FRAME);
  }

  /**
   * A wind-up caught by a smoke cloud is dropped rather than frozen. `updateAI` is
   * skipped entirely for a confused mob, so a twelve-frame row would hold one
   * cell for as long as the smoke lasted and then resume from the middle — and
   * if the smoke landed after the event frame it would keep the pose without the
   * attack ever having happened. The attack is cancelled, not refunded: a
   * cancelled spit restarts its interval, and a cancelled summon keeps the
   * interval it set when it began.
   */
  override tickTimers(): void {
    // Here rather than in `updateAI`, which a smoke-blinded, held or reviving mob
    // skips: its wander still moves it and its legs have to keep pace, and a
    // fight beaten down past the enrage line inside a smoke cloud still has to enrage
    // and still owes its rows their warmth.
    this.syncGaitToDistanceCovered();
    if (this.isAlive) {
      this.latchEnrage();
      this.keepRowsWarm();
    }
    super.tickTimers();
    if (!this.isConfused) return;
    if (this.trashGremlinState === 'vomit_windup') {
      this.trashGremlinState = 'fleeing';
      this.vomitWindupTimer = 0;
      this.vomitFired = false;
      this.vomitTarget = null;
      this.vomitTimer = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
    } else if (this.trashGremlinState === 'summon') {
      this.trashGremlinState = 'fleeing';
      this.summonTimer = 0;
      this.summonFired = false;
      this.summonTarget = null;
    }
  }

  /**
   * Once enraged, never healed back out of it: the enrage is latched, and a
   * boss that was enraged at full health would read as the fight restarting
   * harder than it began.
   */
  override get fairyHealCeiling(): number {
    const pastEnrageLine = this.isEnraged || this.hp / this.maxHp <= ENRAGE_THRESHOLD;
    return pastEnrageLine ? Math.floor(this.maxHp * ENRAGE_THRESHOLD) : this.maxHp;
  }

  protected override clearEncounterPhase(): void {
    this.isEnraged = false;
    this.setBaseSpeed(TRASH_GREMLIN_SPEED);
    this.trashGremlinState = 'fleeing';
    this.vomitTimer = VOMIT_INTERVAL;
    this.purgeTimer = PURGE_INTERVAL;
    this.vomitWindupTimer = 0;
    this.vomitFired = false;
    this.vomitTarget = null;
    this.summonTimer = 0;
    this.summonFired = false;
    this.summonTarget = null;
    this.pointBlankTimer = 0;
    this.fleeStuckFrames = 0;
    this.fleeBias = 0;
    this.fleeBiasSign = 1;
    this.orbitTarget = null;
    this.orbitFrames = 0;
    this.corneredCheckFrames = 0;
    this.stationaryFrames = 0;
    this.wanderActive = false;
    this.cockroachAtCap = false;
    this.pendingVomitProjectiles = [];
    this.soundCues.clear();
    this.attacksWarmedAt = NEVER_WARMED;
    this.goreWarmedAt = NEVER_WARMED;
    this.engaged = false;
  }

  /** Asks for a group of rows again once its last request is half a release window old. */
  private rewarm(lastWarmedAt: number, warm: () => void): number {
    const now = figureCacheFrame();
    if (now - lastWarmedAt < ROW_REWARM_FRAMES) return lastWarmedAt;
    warm();
    return now;
  }

  /**
   * Asks for the rows it stands and scurries in. Called by its lair every frame
   * a crawler is near enough for it to be on screen, which reaches further than
   * its own AI does.
   */
  warmForSighting(): void {
    this.locomotionWarmedAt = this.rewarm(this.locomotionWarmedAt, prewarmTrashGremlinLocomotion);
  }

  /**
   * Keeps every row its fight may draw next resident for as long as that can
   * happen, rather than warming each once: the cache sweeps a row left idle
   * for ten seconds, and the gaps here run longer than that.
   *
   * It is handed targets only once its room is sealed, and from then on its two
   * attacks and what they put on the floor are kept warm through the fight: a
   * summon held off while the swarm is at its cap, or a spit held while every
   * crawler stands in acid, can wait longer than the sweep does. Its severed
   * pieces are all drawn on the one frame it dies, with no telegraph of their
   * own, so they are kept warm from the enrage, the last warning that the
   * fight is ending, to the death.
   */
  private keepRowsWarm(): void {
    if (this.engaged) this.attacksWarmedAt = this.rewarm(this.attacksWarmedAt, warmAttacks);
    if (this.isEnraged) this.goreWarmedAt = this.rewarm(this.goreWarmedAt, prewarmTrashGremlinGore);
  }

  private latchEnrage(): void {
    if (this.isEnraged || this.hp / this.maxHp >= ENRAGE_THRESHOLD) return;
    this.isEnraged = true;
    this.setBaseSpeed(TRASH_GREMLIN_SPEED_ENRAGED);
    this.soundCues.raise('cackle');
  }

  /** The sounds it asked for since the last call, emptied by the call. */
  takeSoundCues(): readonly TrashGremlinSoundCue[] {
    return this.soundCues.take();
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const previousHp = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < previousHp && this.hp > 0) this.soundCues.raise('hurt');
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.engaged = targets.length > 0;

    // Unguarded by a target, unlike the two attack clocks: this is a cooldown on
    // a permission rather than a wind-up, and letting it run while it waits
    // only means it is willing the moment somebody walks in.
    if (this.pointBlankTimer > 0) this.pointBlankTimer--;

    if (this.trashGremlinState === 'vomit_windup') {
      // Tracked only while the target still satisfies the rule that picked it.
      // Followed unconditionally, an 0.8-second telegraph is long enough for a
      // player to walk into a pool or into its face and have the fresh one land
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
      // frame the lunge peaks — fired at the end, the bile would appear after
      // the body had already started to recover.
      const progress = 1 - this.vomitWindupTimer / VOMIT_WINDUP_FRAMES;
      if (!this.vomitFired && progress >= TRASH_GREMLIN_VOMIT_RELEASE_PROGRESS) {
        this.releaseBile(cx, cy, len > 0 ? dx / len : 1, len > 0 ? dy / len : 0);
        this.vomitFired = true;
        this.specialSoundPending = true;
      }
      if (this.vomitWindupTimer <= 0) this.trashGremlinState = 'fleeing';
      return;
    }

    if (this.trashGremlinState === 'summon') {
      // Both attack clocks keep running through the shriek, so the next purge
      // is counted from this one's start. A spit that comes due mid-shriek
      // waits for the first frame back, and the frames it waited are taken
      // off the interval after it, so the spit's cadence loses no time.
      if (this.acquireTarget(targets, AGGRO_RANGE_PX) !== null) {
        this.vomitTimer--;
        this.purgeTimer--;
      }
      this.updateSummon();
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
        const overdueFrames = Math.min(0, this.vomitTimer);
        const interval = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
        this.vomitTimer = Math.max(1, interval + overdueFrames);
        if (this.distanceTo(victim) < POINT_BLANK_RANGE_PX) {
          this.pointBlankTimer = POINT_BLANK_ALLOWANCE_FRAMES;
        }
        this.vomitTarget = victim;
        this.vomitTargetX = victim.x + TILE_SIZE * CENTER_OFFSET;
        this.vomitTargetY = victim.y + TILE_SIZE * CENTER_OFFSET;
        // At the telegraph, not at the frame the bolus spawns: the wind-up is
        // the whole warning the player gets, and a row baking during it is a
        // row baking while the bile is already on its way.
        prewarmTrashGremlinVomit();
        prewarmGremlinBile();
        // The swarm has no entry point but this boss's piles, and the purge
        // that builds it runs on its own clock: warming the roach here buys the
        // wind-up's worth of lead for whichever of the two attacks comes next.
        prewarmCockroach();
        this.trashGremlinState = 'vomit_windup';
        this.vomitWindupTimer = VOMIT_WINDUP_FRAMES;
        this.vomitFired = false;
        this.soundCues.raise('gurgle');
      }
    }

    if (nearest !== null) this.purgeTimer--;
    if (this.purgeTimer <= 0 && nearest !== null) {
      // A purge that finds the cap full is not spent, only deferred: the
      // gremlin is meant to be topping the swarm back up the moment there is
      // room. One that lands on the spit's first frame waits only for the spit:
      // the purge clock is paused through the spit wind-up, so it stays due and
      // fires the summon on the first frame back, and the frames it was overdue
      // come off the interval after it so the cadence does not drift.
      const spitStarting = this.trashGremlinState === 'vomit_windup';
      const canSummon = !this.cockroachAtCap && !spitStarting;
      const interval = this.isEnraged ? PURGE_INTERVAL_ENRAGED : PURGE_INTERVAL;
      const overdueFrames = Math.min(0, this.purgeTimer);
      this.purgeTimer = canSummon
        ? Math.max(1, interval + overdueFrames)
        : this.cockroachAtCap
          ? PURGE_RETRY_INTERVAL
          : 0;
      if (canSummon) {
        this.beginSummon(nearest);
        return;
      }
    }

    if (!nearest) {
      this.stationaryFrames = 0;
      this.wanderActive = false;
      const homeX = this.restingPlace?.x ?? this.spawnX;
      const homeY = this.restingPlace?.y ?? this.spawnY;
      const toHome = Math.hypot(this.x - homeX, this.y - homeY);
      if (toHome > TILE_SIZE * RETURN_TO_SPAWN_THRESHOLD_TILES) {
        this.followTargetCollide(
          homeX,
          homeY,
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
      if (this.fleeAlongOrbit(nearest)) return;
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
      // Given room, it backs off to its nest in the far corner of its lair
      // rather than waiting where the last chase left it. Only with a margin
      // past its flee range, and never toward the crawler: a crawler standing
      // at the edge of that range between it and the nest would otherwise have
      // it walk at them, turn and run, and walk at them again.
      const bed = this.restingPlace;
      if (
        bed !== null &&
        nearestDist > BED_RANGE_PX &&
        Math.hypot(this.x - bed.x, this.y - bed.y) > TILE_SIZE * RETURN_TO_SPAWN_THRESHOLD_TILES &&
        !this.isTowardThreat(bed, nearest)
      ) {
        this.stationaryFrames = 0;
        this.wanderActive = false;
        this.followTargetAStar(bed.x, bed.y, this.speed, 0);
        return;
      }
      // Outside flee range with nowhere better to be: wander if stationary too long.
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

  /**
   * Runs for a gap between its lair's islands instead of straight away, once
   * it has been cornered: straight away from a crawler is into a wall, and
   * without somewhere to go round it backs into the nearest corner and stays
   * there. Returns whether it moved this way this frame.
   */
  private fleeAlongOrbit(threat: Player): boolean {
    const waypoints = this.fleeWaypoints;
    if (waypoints === null || waypoints.length === 0) return false;
    this.corneredCheckFrames++;
    if (this.corneredCheckFrames >= CORNERED_CHECK_FRAMES) {
      const travelled = Math.hypot(this.x - this.corneredAnchorX, this.y - this.corneredAnchorY);
      if (travelled < CORNERED_TRAVEL_PX && this.orbitFrames === 0) {
        this.orbitTarget = this.pickOrbitWaypoint(waypoints, threat);
        this.orbitFrames = this.orbitTarget === null ? 0 : ORBIT_COMMIT_FRAMES;
      }
      this.corneredCheckFrames = 0;
      this.corneredAnchorX = this.x;
      this.corneredAnchorY = this.y;
    }
    const target = this.orbitTarget;
    if (target === null || this.orbitFrames <= 0) return false;
    this.orbitFrames--;
    this.followTargetAStar(target.x, target.y, this.speed, 0);
    if (Math.hypot(this.x - target.x, this.y - target.y) < TILE_SIZE) this.orbitFrames = 0;
    if (this.orbitFrames === 0) this.orbitTarget = null;
    return true;
  }

  /**
   * The gap to run for: one whose way lies away from the threat rather than
   * through it, and of those the one furthest from the threat. Any gap at all
   * when every way out passes the threat — a gap past a crawler is still out
   * of the corner.
   */
  private pickOrbitWaypoint(
    waypoints: ReadonlyArray<{ x: number; y: number }>,
    threat: Player,
  ): { x: number; y: number } | null {
    const awayX = this.x - threat.x;
    const awayY = this.y - threat.y;
    const awayLength = Math.hypot(awayX, awayY);
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const waypoint of waypoints) {
      const toX = waypoint.x - this.x;
      const toY = waypoint.y - this.y;
      const toLength = Math.hypot(toX, toY);
      if (toLength < TILE_SIZE) continue;
      const alignment = awayLength > 0 ? (toX * awayX + toY * awayY) / (toLength * awayLength) : 0;
      const clearOfThreat = alignment > ORBIT_MIN_ALIGNMENT;
      const score =
        Math.hypot(waypoint.x - threat.x, waypoint.y - threat.y) +
        (clearOfThreat ? ORBIT_CLEAR_BONUS_PX : 0);
      if (score > bestScore) {
        best = waypoint;
        bestScore = score;
      }
    }
    return best;
  }

  /** Whether heading for `point` would take it toward `threat` rather than away or across. */
  private isTowardThreat(point: { x: number; y: number }, threat: Player): boolean {
    const toPointX = point.x - this.x;
    const toPointY = point.y - this.y;
    const toThreatX = threat.x - this.x;
    const toThreatY = threat.y - this.y;
    const lengths = Math.hypot(toPointX, toPointY) * Math.hypot(toThreatX, toThreatY);
    if (lengths === 0) return false;
    return (toPointX * toThreatX + toPointY * toThreatY) / lengths > BED_TOWARD_THREAT_COSINE;
  }

  /** True when a player is standing on ground its acid already covers. */
  private isStandingInItsAcid(target: Player): boolean {
    const probe = this.isAcidCovered;
    if (probe === null) return false;
    return probe(target.x + TILE_SIZE * CENTER_OFFSET, target.y + TILE_SIZE * CENTER_OFFSET);
  }

  private readonly isDistantVomitTarget = (target: Player): boolean =>
    target.isAlive &&
    this.distanceTo(target) >= POINT_BLANK_RANGE_PX &&
    !this.isStandingInItsAcid(target);

  private readonly isReachableVomitTarget = (target: Player): boolean =>
    target.isAlive && !this.isStandingInItsAcid(target);

  /**
   * Who this spit is worth aiming at: someone standing on clean ground, and
   * standing off it, unless the point-blank allowance has come back around.
   * Null means nobody qualifies and the shot should be held.
   */
  private pickVomitTarget(targets: Player[]): Player | null {
    const distant = this.acquireTarget(targets, AGGRO_RANGE_PX, this.isDistantVomitTarget);
    if (distant !== null) return distant;
    if (this.pointBlankTimer > 0) return null;
    return this.acquireTarget(targets, AGGRO_RANGE_PX, this.isReachableVomitTarget);
  }

  /**
   * Queues the bile the sprite is about to show leaving its mouth.
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

  /**
   * Rears up and shrieks at its piles. The roaches come at the shriek's peak,
   * not at its start, so the telegraph is the whole warning a crawler gets.
   */
  private beginSummon(target: Player): void {
    // Warmed at the telegraph rather than at the hatch: the roaches arrive a
    // rustle after the peak, and a row baking then is a row baking mid-fight.
    prewarmCockroach();
    prewarmTrashGremlinSummon();
    this.trashGremlinState = 'summon';
    this.summonTimer = SUMMON_WINDUP_FRAMES;
    this.soundCues.raise('shriek');
    this.summonFired = false;
    this.summonTarget = target;
    this.isMoving = false;
  }

  private updateSummon(): void {
    this.summonTimer--;
    this.isMoving = false;
    const target = this.summonTarget;
    if (target !== null) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        this.facingX = dx / len;
        this.facingY = dy / len;
      }
    }
    const progress = 1 - this.summonTimer / SUMMON_WINDUP_FRAMES;
    if (!this.summonFired && progress >= TRASH_GREMLIN_SUMMON_EVENT_PROGRESS) {
      this.summonFired = true;
      this.hatchFromPiles(target);
    }
    if (this.summonTimer <= 0) {
      this.trashGremlinState = 'fleeing';
      this.summonTarget = null;
    }
  }

  /**
   * Hands the purge's roll to the lair. A crawler who died during the shriek
   * still has a place they stood, and with nobody at all the piles nearest the
   * gremlin stand in.
   */
  private hatchFromPiles(target: Player | null): void {
    this.purgesBegun++;
    const roll = randomInt(PURGE_ROACHES_MIN, PURGE_ROACHES_MAX);
    const around = target ?? this;
    this.roachNest?.({ x: around.x, y: around.y }, roll);
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // Guaranteed, not rolled: 9 Lives is the cat's only way to walk away from a
    // killing blow, and a 0.5% vermin drop is no way to hand out a safety net.
    const book = usefulSkillBook('skill_book_nine_lives');
    if (book !== null) items.push({ id: book, quantity: 1 });
    return items;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    // Asked here as well as on its timers because the world can be halted
    // behind a menu, which stops its timers but not the cache's sweep. Its own
    // rows and the bile are pinned through a sealed fight; the roach is shared
    // with every other cockroach and is not, so this is what keeps it.
    this.keepRowsWarm();
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawTrashGremlinSprite(ctx, sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        isMoving: this.isMoving,
        facingX: this.facingX,
        facingY: this.facingY,
        vomitProgress: this.vomitProgress,
        summonProgress: this.summonProgress,
      });
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}
