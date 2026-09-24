import {
  ASTAR_FAILURE_BACKOFF_FRAMES,
  ASTAR_MAX_DENIED_FRAMES,
  Mob,
  type PlayerDamageType,
} from '../Mob';
import type { Player } from '../../Player';
import type { Difficulty } from '../../core/difficultyProfiles';
import { scaledCooldownFramesForLevel } from '../mobLevelScaling';
import { isMarkedGround } from '../tactics/markedGround';
import { isWorldPointInView } from '../../core/visibleWorldView';
import {
  drawFairySprite,
  fairyChestPoint,
  fairyCrownBelowTileTopTiles,
  type FairySpriteState,
} from '../../sprites/fairySprite';
import {
  type FairyCastRow,
  type FairyKind,
  fairyHoverFps,
  fairyReleaseProgress,
  fairyRowFrames,
} from '../../sprites/art/fairyTiming';
import { collectFairyAllies } from './fairyAllies';
import { fairyPotencyCount } from './fairyPotency';
import { bossOfHealer } from './bossHealerBond';
import {
  chooseFairyRefuge,
  flightPasses,
  isFairyGroundForbidden,
  isTileInRect,
  type FairyRefuge,
  type FairyRefugeQuery,
} from './fairyRefuge';
import {
  FAIRY_ALLY_SEARCH_TILES,
  FAIRY_BASE_HP_FRACTION,
  FAIRY_BASE_SPEED,
  FAIRY_BOUND_HEALER_LEASH_TILES,
  FAIRY_CAST_RECOVER_FRAMES,
  FAIRY_COVER_BONUS_TILES,
  FAIRY_COVER_LINE_TOLERANCE_TILES,
  FAIRY_CROSSING_CLEARANCE_TILES,
  FAIRY_CROSSING_PENALTY_TILES,
  FAIRY_DEFAULT_HOST_FLOOR,
  FAIRY_FLUTTER_RANGE_TILES,
  FAIRY_GOAL_ARRIVAL_TILES,
  FAIRY_GOAL_MIN_REPLAN_FRAMES,
  FAIRY_GOAL_REPLAN_FRAMES,
  FAIRY_GOAL_SAMPLE_DIRECTIONS,
  FAIRY_GOAL_SWITCH_MARGIN_TILES,
  FAIRY_LONE_RANGE_TILES,
  FAIRY_MAX_SPEED,
  FAIRY_MIN_POTENCY,
  FAIRY_NOTICE_RANGE_TILES,
  FAIRY_REFUGE_ARRIVAL_TILES,
  FAIRY_REFUGE_JOIN_TILES,
  FAIRY_REFUGE_RETRY_FRAMES,
  FAIRY_REFUGE_STALL_FRAMES,
  FAIRY_RETREAT_LEASH_STRETCH,
  FAIRY_RETREAT_STEP_TILES,
  FAIRY_SUPPORT_TOO_FAR_WEIGHT,
  FAIRY_THREAT_SHIFT_REPLAN_TILES,
  FAIRY_TOO_CLOSE_WEIGHT,
  FAIRY_TYPICAL_HOST_HP_BY_FLOOR,
} from './fairyTuning';

/**
 * Where a cast is: released on the frame it is chosen, then its row plays out
 * while the fairy flies on.
 */
export type FairyCastPhase = 'release' | 'recover';

/**
 * One spell a fairy can cast. The fairy never stops flying to cast one: every
 * cast resolves on the frame it is chosen. What an offensive cast leaves in the
 * world — a bolt in flight, a lob's landing reticle, a fuse — is its telegraph.
 */
export interface FairyCast {
  /** Stable name; the cooldown table and the art's cast rows key off it. */
  readonly id: string;
  /** The painted row the fairy plays from its release frame on. */
  readonly row: FairyCastRow;
  readonly cooldownFrames: number;
  /** Floor under the level-scaled cooldown. */
  readonly minCooldownFrames: number;
  /** A cooldown the player learns as a rhythm is flat at every level. Default true. */
  readonly cooldownScalesWithLevel?: boolean;
}

/** A subclass's answer to "cast something now": which cast, at whom, aimed where. */
export interface FairyCastIntent {
  readonly cast: FairyCast;
  /** The crawler or ally the cast is for; null for a cast aimed at ground. */
  readonly target: Player | null;
  /** The aim, fixed on the release frame. */
  readonly aimX: number;
  readonly aimY: number;
}

/** The cast being played. */
export interface ActiveFairyCast extends FairyCastIntent {
  readonly phase: FairyCastPhase;
  /** Frames left in the current phase. */
  readonly framesLeft: number;
}

/** How one kind positions itself around its allies and the party. */
export interface FairyPositioning {
  /** Range kept from the nearest living crawler while the fairy has allies. */
  readonly preferredRangeTiles: number;
  /** Farthest a fairy strays from the ally it is supporting. */
  readonly supportLeashTiles: number;
  /**
   * A caster that must see the crawler to cast at all prefers hover goals with
   * a clear line to it, so it does not park behind a pillar at the perfect
   * range and never fire.
   */
  readonly keepsSightOfCrawler?: boolean;
}

interface MutableActiveCast extends FairyCastIntent {
  phase: FairyCastPhase;
  framesLeft: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const NO_CASTS: readonly FairyCast[] = [];

/** Cull and hit-flash reach: the body hovers above its tile and the wings spread past it. */
const FAIRY_CULL_MARGIN_TILES = 1;

/**
 * How far inside the screen edge a fairy's chest must be to count as on
 * screen, in tiles: half a tile keeps most of the body in frame, so a fairy
 * that is only a wingtip at the border does not count as seen.
 */
const FAIRY_ON_SCREEN_INSET_TILES = 0.5;

/** Radii, as shares of the leash, at which hover goals are sampled around the anchor. */
const INNER_GOAL_RING_FRACTION = 0.5;
const GOAL_RING_FRACTIONS: readonly number[] = [INNER_GOAL_RING_FRACTION, 1];

/**
 * How much a hover goal's distance from where the fairy already hovers counts
 * against it, per pixel of range error. Keeps a fairy from crossing the room
 * for a spot barely better than the one it has.
 */
const GOAL_TRAVEL_COST = 0.25;

/**
 * Ticks the painted flinch plays over after a hit. Long enough for the row's
 * four frames to each be seen, short enough that a fairy under steady fire
 * still reads as hovering between blows.
 */
const FAIRY_HURT_ROW_TICKS = 12;

/**
 * Ticks the painted death row plays over before the body is gone. The row ends
 * dissolved, so the fairy vanishes on its last frame rather than lying there.
 */
const FAIRY_DEATH_ROW_TICKS = 40;

/**
 * A nudge past the release share. `progressFrameIndex` floors, and a release
 * share such as 7/10 times 10 can land a hair under 7 in floating point,
 * which would draw the release tick one frame early.
 */
const RELEASE_FRAME_NUDGE = 1e-6;

/** Spatial-hash multipliers that scatter neighbouring spawn tiles' wing clocks. */
const WING_CLOCK_HASH_X = 73856093;
const WING_CLOCK_HASH_Y = 19349663;
/** Distinct wing-clock offsets a fairy can be given. */
const WING_CLOCK_OFFSET_STEPS = 64;

/** One pass of a kind's hover row, in seconds: each kind beats at its own tempo. */
function wingbeatSeconds(kind: FairyKind): number {
  return fairyRowFrames('hover') / fairyHoverFps(kind);
}

/**
 * A stable share of a wingbeat for a fairy spawned on (tileX, tileY), so a
 * room of fairies does not flap in lockstep and a fairy's wings do not jump
 * when it is redrawn. A share rather than seconds, because the kind — and
 * with it the wingbeat's length — is not known while the base constructor runs.
 */
function wingClockShare(tileX: number, tileY: number): number {
  const hashed = Math.imul(tileX, WING_CLOCK_HASH_X) ^ Math.imul(tileY, WING_CLOCK_HASH_Y);
  const step = (hashed >>> 0) % WING_CLOCK_OFFSET_STEPS;
  return step / WING_CLOCK_OFFSET_STEPS;
}

/**
 * Frames a fleeing fairy's route search may keep failing before it gives the
 * refuge up: longer than one failed search can hold the failure latch, so
 * giving up always means a retry failed too.
 */
const REFUGE_SEARCH_FAILURE_FRAMES = ASTAR_FAILURE_BACKOFF_FRAMES + ASTAR_MAX_DENIED_FRAMES;

/**
 * How much a hover goal with no line of sight to the crawler counts against a
 * fairy that {@link FairyPositioning.keepsSightOfCrawler}, in tiles of range
 * error. Large enough to beat any in-sight goal the leash allows, so a blind
 * goal is taken only when nothing in reach can see the crawler.
 */
const NO_SIGHTLINE_PENALTY_TILES = 12;

/**
 * A fragile flying caster that changes the fight around it, and keeps its
 * distance while it does.
 *
 * Flies over mobs but not over masonry: `isFlying` takes it out of the ground
 * separation pass and the crawler-collision pass, while its own movement still
 * runs through `followTargetAStar` and `moveWithCollision`.
 *
 * The base owns everything the five kinds share — the hover, the positioning
 * (backing off from the party behind its allies, and running for another room
 * once it has none), one casting cycle that never stops it flying, and the
 * potency stamped at spawn. A kind supplies its casts, chooses when to cast
 * them, and resolves them on release.
 */
export abstract class Fairy extends Mob {
  abstract readonly kind: FairyKind;
  protected abstract readonly positioning: FairyPositioning;

  override isFlying = true;
  override readonly audioTag = 'fairy';

  /**
   * The body plays its death row where it fell, so kill resolution keeps it in
   * the world until the row has run. Everything a death sets off still hangs
   * off `justDied` and `mobKilled` on the frame of the kill.
   */
  override readonly rendersWhenDead = true;

  private readonly wingClockShare: number;
  private hurtTicksLeft = 0;
  private corpseTicks = 0;

  /**
   * Living hostile non-fairy mobs within {@link FAIRY_ALLY_SEARCH_TILES},
   * refreshed at the start of every AI tick. Read, never mutated, by a kind.
   */
  protected readonly allies: Mob[] = [];

  /** Living party members this fairy is keeping away from, refreshed every AI tick. */
  private readonly threats: Player[] = [];

  private _potencyCount = FAIRY_MIN_POTENCY;
  private potencyStamped = false;

  private active: MutableActiveCast | null = null;
  private readonly cooldowns = new Map<string, number>();

  private hoverGoal: Point | null = null;
  private framesSinceGoal = FAIRY_GOAL_REPLAN_FRAMES;
  /** The nearest threat's distance to the hover goal when it was chosen. */
  private goalThreatDistancePx = Infinity;

  /**
   * Where the fairy settles when nothing is going on: its spawn, until it runs
   * to another room and makes that its home. A checkpoint rewind puts it back.
   */
  private homeX: number;
  private homeY: number;

  private refuge: FairyRefuge | null = null;
  private refugePassedOver = new WeakSet();
  private refugeBestTilesLeft = Infinity;
  private refugeStallFrames = 0;
  private refugeSearchFailedFrames = 0;
  private refugeRetryFrames = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, fairyBaseHpForFloor(FAIRY_DEFAULT_HOST_FLOOR), FAIRY_BASE_SPEED);
    this.wingClockShare = wingClockShare(tileX, tileY);
    this.homeX = this.spawnX;
    this.homeY = this.spawnY;
  }

  override get cullMarginTiles(): number {
    return FAIRY_CULL_MARGIN_TILES;
  }

  /** A crawler that chases a fairy down always catches it, at any level. */
  protected override get levelledSpeedCap(): number {
    return FAIRY_MAX_SPEED;
  }

  /** Flyers are outside the crawler-collision pass already; said here as well so it cannot drift. */
  override get displacesPlayers(): boolean {
    return false;
  }

  /** This fairy's potency, stamped once at spawn: see `fairyPotencyCount` for what each kind reads from it. */
  get potencyCount(): number {
    return this._potencyCount;
  }

  /**
   * Fixes {@link potencyCount} from this fairy's level and the difficulty it
   * was spawned under. Call once, after `applyMobLevel`.
   */
  stampPotency(difficulty: Difficulty): void {
    if (this.potencyStamped) {
      console.warn(`[Fairy] ${this.mobType} already has its potency stamped; ignoring`);
      return;
    }
    this.potencyStamped = true;
    this._potencyCount = fairyPotencyCount(this.mobLevel, difficulty);
  }

  /**
   * Re-authors this fairy's HP against the typical host of the floor it is
   * spawned on. Safe before or after `applyMobLevel`: the level is kept.
   */
  setHostFloor(floorNumber: number): void {
    this.setBaseMaxHp(fairyBaseHpForFloor(floorNumber));
  }

  /** Centre of the fairy's ground point in world pixels: where it stands, dies and is hit. */
  get groundCentre(): { x: number; y: number } {
    return { x: this.x + this.tileSize / 2, y: this.y + this.tileSize / 2 };
  }

  /** The cast being played, or null while idle. */
  get activeCast(): ActiveFairyCast | null {
    return this.active;
  }

  /** The place this fairy is running to, or null while it is not running. */
  get fleeingTo(): FairyRefuge | null {
    return this.refuge;
  }

  // ── What a kind supplies ──────────────────────────────────────────────────

  /** Every cast this kind knows. */
  protected get casts(): readonly FairyCast[] {
    return NO_CASTS;
  }

  /**
   * Called while idle with the crawler the fairy is aware of. Return a cast
   * that {@link isCastReady} to start it, or null to keep positioning.
   */
  protected chooseCast(_crawler: Player | null): FairyCastIntent | null {
    return null;
  }

  /** Resolves a cast on its release frame. */
  protected onCastReleased(_cast: ActiveFairyCast): void {
    // Kinds resolve their own casts.
  }

  /**
   * The ally this fairy is keeping close to, when a kind has a particular one
   * in mind (the mob it is warding, the one it is healing). Null falls back to
   * the nearest ally.
   */
  protected get supportTarget(): Mob | null {
    return null;
  }

  /**
   * Draws this fairy's cast effects that lie on the floor — a landing reticle,
   * wisps over a corpse — under every creature. Called by
   * `FairySystem` each frame the fairy is alive, in world coordinates less the
   * camera. `frame` is the system's frame counter, for animation.
   */
  drawGroundEffects(
    _ctx: CanvasRenderingContext2D,
    _camX: number,
    _camY: number,
    _frame: number,
  ): void {
    // Kinds with ground effects draw them.
  }

  /**
   * Draws this fairy's cast effects that travel through the air — a heal
   * stream, a ward glyph, a tether — over every creature, so an effect
   * crossing the fight never disappears behind the mob it passes. Called
   * by `FairySystem` each frame the fairy is alive.
   */
  drawAirEffects(
    _ctx: CanvasRenderingContext2D,
    _camX: number,
    _camY: number,
    _frame: number,
  ): void {
    // Kinds with air effects draw them.
  }

  // ── Casting ───────────────────────────────────────────────────────────────

  /** Whether `cast` is off cooldown and nothing else is being cast. */
  protected isCastReady(cast: FairyCast): boolean {
    return this.active === null && (this.cooldowns.get(cast.id) ?? 0) === 0;
  }

  /** The cooldown `cast` gets at this fairy's level, never under its floor. */
  protected cooldownFramesFor(cast: FairyCast): number {
    if (cast.cooldownScalesWithLevel === false) return cast.cooldownFrames;
    const scaled = scaledCooldownFramesForLevel(cast.cooldownFrames, this.mobLevel);
    return Math.max(scaled, cast.minCooldownFrames);
  }

  private tickCooldowns(): void {
    for (const [id, frames] of this.cooldowns) {
      if (frames > 0) this.cooldowns.set(id, frames - 1);
    }
  }

  /** Advances the cast by one frame, releasing a new one the frame it is chosen. Never holds the fairy still. */
  private advanceCast(crawler: Player | null): void {
    const cast = this.active;
    if (cast === null) {
      const intent = this.chooseCast(crawler);
      if (intent === null || !this.isCastReady(intent.cast)) return;
      const released: MutableActiveCast = { ...intent, phase: 'release', framesLeft: 1 };
      this.active = released;
      this.cooldowns.set(intent.cast.id, this.cooldownFramesFor(intent.cast));
      this.onCastReleased(released);
      return;
    }
    switch (cast.phase) {
      case 'release':
        cast.phase = 'recover';
        cast.framesLeft = FAIRY_CAST_RECOVER_FRAMES;
        return;
      case 'recover':
        cast.framesLeft--;
        if (cast.framesLeft <= 0) this.active = null;
        return;
    }
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const hpBefore = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    if (this.hp < hpBefore && this.isAlive) this.hurtTicksLeft = FAIRY_HURT_ROW_TICKS;
  }

  override tickCorpse(): void {
    this.corpseTicks++;
  }

  override get corpseExpired(): boolean {
    return !this.isAlive && this.corpseTicks >= FAIRY_DEATH_ROW_TICKS;
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.hurtTicksLeft = 0;
    this.corpseTicks = 0;
    this.active = null;
    this.cooldowns.clear();
    this.hoverGoal = null;
    this.framesSinceGoal = FAIRY_GOAL_REPLAN_FRAMES;
    this.goalThreatDistancePx = Infinity;
    this.threats.length = 0;
    this.refuge = null;
    this.refugePassedOver = new WeakSet();
    this.refugeBestTilesLeft = Infinity;
    this.refugeStallFrames = 0;
    this.refugeSearchFailedFrames = 0;
    this.refugeRetryFrames = 0;
  }

  /** A rewind returns the fairy to its spawn, and with it the room it calls home. */
  override resetToSpawn(): void {
    super.resetToSpawn();
    this.homeX = this.spawnX;
    this.homeY = this.spawnY;
  }

  // ── AI ────────────────────────────────────────────────────────────────────

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.hurtTicksLeft > 0) this.hurtTicksLeft--;
    this.tickCooldowns();

    const crawler = this.acquireTarget(
      targets,
      this.tileSize * FAIRY_NOTICE_RANGE_TILES,
      (target) => this.mayFight(target),
    );
    this.currentTarget = crawler;
    if (crawler !== null) this.updateLastKnown(crawler);
    collectFairyAllies(this, this.tileSize * FAIRY_ALLY_SEARCH_TILES, this.allies, {
      excludeFairies: true,
    });
    this.collectThreats(targets, crawler);

    this.advanceCast(crawler);
    this.updatePosition(crawler);

    const cast = this.active;
    if (cast?.phase === 'release') this.faceToward({ x: cast.aimX, y: cast.aimY });
  }

  /**
   * Whether this fairy may turn a cast on `target` at all. A crawler inside the
   * town's safe zone is off limits, as it is to every ambient mob of floor 3,
   * unless this fairy was set loose to ignore the zone.
   */
  protected mayFight(target: Player): boolean {
    return this.ignoresTownSafeZone || this.map?.isInTownSafeZone(target.x, target.y) !== true;
  }

  /**
   * Every living party member within notice range, once the fairy is aware of
   * the party at all: both crawlers, and the pet and hirelings fighting beside
   * them. A fairy that minded only the crawler it noticed would back away from
   * the human straight into the cat.
   */
  private collectThreats(targets: readonly Player[], crawler: Player | null): void {
    this.threats.length = 0;
    if (crawler === null) return;
    const reachPx = this.tileSize * FAIRY_NOTICE_RANGE_TILES;
    for (const target of targets) {
      if (!target.isAlive || target.isDefendTarget === true) continue;
      if (target instanceof Mob && target.isHostile) continue;
      const withinReach = Math.hypot(target.x - this.x, target.y - this.y) <= reachPx;
      if (target === crawler || withinReach) this.threats.push(target);
    }
  }

  /** The nearest living ally, or null when there is none within the search radius. */
  protected nearestAlly(): Mob | null {
    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const ally of this.allies) {
      const dist = this.distanceTo(ally);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = ally;
      }
    }
    return nearest;
  }

  /** Distance from `point` to the nearest threat; infinite when there are none. */
  private nearestThreatDistance(point: Point): number {
    let nearest = Infinity;
    for (const threat of this.threats) {
      nearest = Math.min(nearest, Math.hypot(threat.x - point.x, threat.y - point.y));
    }
    return nearest;
  }

  /**
   * Flutters at its top speed with a threat close by, cruises otherwise. Top
   * speed is {@link FAIRY_MAX_SPEED}, under the crawler's, so a crawler who
   * commits to the chase still catches it.
   */
  private movementSpeed(): number {
    const flutterPx = this.tileSize * FAIRY_FLUTTER_RANGE_TILES;
    const threatClose = this.nearestThreatDistance(this) <= flutterPx;
    const running = this.refuge !== null && this.threats.length > 0;
    return threatClose || running ? FAIRY_MAX_SPEED : this.speed;
  }

  /**
   * The one positioning routine every kind shares: keep away from the party,
   * behind an ally where one stands, inside `supportLeashTiles` of the ally
   * being supported; run for another room when no ally is left; and never onto
   * marked ground.
   */
  private updatePosition(crawler: Player | null): void {
    const ts = this.tileSize;
    const boundBoss = bossOfHealer(this);
    // A boss's healer is sealed into its boss's fight and never runs from it.
    if (boundBoss === null && this.updateRefugeFlight(crawler)) return;

    const anchorMob = this.supportTarget ?? this.nearestAlly();
    let anchor: Point;
    let leashPx: number;
    let desiredRangePx: number;
    if (anchorMob !== null) {
      anchor = anchorMob;
      leashPx = ts * this.positioning.supportLeashTiles;
      desiredRangePx = ts * this.positioning.preferredRangeTiles;
    } else if (boundBoss !== null) {
      anchor = boundBoss;
      leashPx = ts * FAIRY_BOUND_HEALER_LEASH_TILES;
      desiredRangePx = ts * FAIRY_LONE_RANGE_TILES;
    } else {
      anchor = { x: this.homeX, y: this.homeY };
      leashPx = ts * FAIRY_ALLY_SEARCH_TILES;
      desiredRangePx = ts * FAIRY_LONE_RANGE_TILES;
    }

    if (crawler === null) {
      this.hoverGoal = null;
      if (this.distanceTo(anchor) > leashPx) {
        this.followTargetAStar(anchor.x, anchor.y, this.speed, leashPx / 2);
      } else {
        this.isMoving = false;
      }
      return;
    }

    this.framesSinceGoal++;
    const standingOnHazard = isMarkedGround(this.x, this.y);
    const currentGoal = this.hoverGoal;
    const threatClosedIn =
      currentGoal !== null &&
      this.framesSinceGoal >= FAIRY_GOAL_MIN_REPLAN_FRAMES &&
      this.nearestThreatDistance(currentGoal) <
        this.goalThreatDistancePx - ts * FAIRY_THREAT_SHIFT_REPLAN_TILES;
    if (
      currentGoal === null ||
      this.framesSinceGoal >= FAIRY_GOAL_REPLAN_FRAMES ||
      standingOnHazard ||
      threatClosedIn
    ) {
      const chosen = this.chooseHoverGoal(anchor, leashPx, desiredRangePx, crawler);
      this.hoverGoal = chosen;
      this.framesSinceGoal = 0;
      this.goalThreatDistancePx = chosen === null ? Infinity : this.nearestThreatDistance(chosen);
    }

    const goal = this.hoverGoal;
    const arrivalPx = ts * FAIRY_GOAL_ARRIVAL_TILES;
    if (goal === null || this.distanceTo(goal) <= arrivalPx) {
      this.isMoving = false;
      this.faceToward(crawler);
      return;
    }
    this.followTargetAStar(goal.x, goal.y, this.movementSpeed(), arrivalPx);
  }

  // ── Running for the next room ─────────────────────────────────────────────

  /** Whether the fairy has nobody left near it to support. Other fairies do not count. */
  private get isAlone(): boolean {
    return this.allies.length === 0 && this.supportTarget === null;
  }

  /**
   * Starts, continues or ends a run for another room. True when it moved the
   * fairy this frame, false when ordinary positioning should run instead.
   *
   * A run starts only once the fairy knows the party is there and has no ally
   * left, and ends on arrival or as soon as an ally is close — well inside the
   * ally search, so an ally at its edge cannot flip the fairy between running
   * and staying.
   *
   * A refuge is given up when the run stops getting anywhere along its route,
   * or when the route search keeps failing for longer than one failed search
   * can hold `astarSearchFailed` up: a single failure may only have been the
   * path budget, and the retry after the backoff can still find the way.
   */
  private updateRefugeFlight(crawler: Player | null): boolean {
    if (this.refuge === null) {
      if (this.refugeRetryFrames > 0) this.refugeRetryFrames--;
      if (!this.isAlone || crawler === null || this.refugeRetryFrames > 0) return false;
      const query = this.refugeQuery();
      const chosen = query === null ? null : this.chooseRefuge(query);
      if (chosen === null) {
        this.refugeRetryFrames = FAIRY_REFUGE_RETRY_FRAMES;
        return false;
      }
      this.refuge = chosen;
      this.refugeBestTilesLeft = Infinity;
      this.refugeStallFrames = 0;
      this.refugeSearchFailedFrames = 0;
      this.hoverGoal = null;
      this.clearAStarPath();
    }
    const refuge = this.refuge;
    if (this.hasJoinedAllies() || this.hasReached(refuge)) {
      if (this.hasReached(refuge)) {
        this.homeX = this.x;
        this.homeY = this.y;
      }
      this.refuge = null;
      this.clearAStarPath();
      return false;
    }

    this.followTargetAStar(refuge.x, refuge.y, this.movementSpeed(), 0);
    if (this.astarSearchFailed) {
      this.refugeSearchFailedFrames++;
      if (this.refugeSearchFailedFrames > REFUGE_SEARCH_FAILURE_FRAMES) {
        this.passOverRefuge(refuge);
      }
      return true;
    }
    this.refugeSearchFailedFrames = 0;

    const tilesLeft = this.refugeRouteTilesLeft(refuge);
    const gainedATile = tilesLeft !== null && tilesLeft <= this.refugeBestTilesLeft - 1;
    if (gainedATile) {
      this.refugeBestTilesLeft = tilesLeft;
      this.refugeStallFrames = 0;
    } else {
      this.refugeStallFrames++;
    }
    if (this.refugeStallFrames > FAIRY_REFUGE_STALL_FRAMES) this.passOverRefuge(refuge);
    return true;
  }

  /**
   * How many tiles of its route to `refuge` the fairy still has to fly, or
   * null while it holds no route. Measured along the route rather than
   * straight at the room, so a way round that first leads away from the room
   * still counts as getting nearer.
   */
  protected refugeRouteTilesLeft(_refuge: FairyRefuge): number | null {
    const waypoints = this.astarWaypointsLeft;
    return waypoints > 0 ? waypoints : null;
  }

  /** What the refuge choice reads about the world and this fairy; null off a map. */
  protected refugeQuery(): FairyRefugeQuery | null {
    const map = this.map;
    if (map === null) return null;
    return {
      map,
      tileSize: this.tileSize,
      fromX: this.x,
      fromY: this.y,
      threats: this.threats,
      passedOver: this.refugePassedOver,
      isSupportable: (mob) => mob.isAlive && mob.isHostile && !(mob instanceof Fairy),
    };
  }

  /** Where to run, or null when nowhere is worth it. */
  protected chooseRefuge(query: FairyRefugeQuery): FairyRefuge | null {
    return chooseFairyRefuge(query);
  }

  private passOverRefuge(refuge: FairyRefuge): void {
    this.refugePassedOver.add(refuge.source);
    this.refuge = null;
    this.clearAStarPath();
  }

  private hasJoinedAllies(): boolean {
    const joinPx = this.tileSize * FAIRY_REFUGE_JOIN_TILES;
    return this.allies.some((ally) => this.distanceTo(ally) <= joinPx);
  }

  private hasReached(refuge: FairyRefuge): boolean {
    const ts = this.tileSize;
    if (refuge.room !== null) {
      const tileX = Math.floor((this.x + ts / 2) / ts);
      const tileY = Math.floor((this.y + ts / 2) / ts);
      return isTileInRect(tileX, tileY, refuge.room);
    }
    return this.distanceTo(refuge) <= ts * FAIRY_REFUGE_ARRIVAL_TILES;
  }

  // ── Hover goals ───────────────────────────────────────────────────────────

  /**
   * Scores sampled points and keeps the best: how far inside `desiredRangePx`
   * of the nearest threat it would sit (heavily) or past it (lightly), less a
   * bonus for allies standing in the way, plus a little for the distance to
   * get there and a lot for a flight line that passes the party. The goal the
   * fairy already has is kept unless a new one beats it by a margin. Null when
   * every sample is refused.
   */
  private chooseHoverGoal(
    anchor: Point,
    leashPx: number,
    desiredRangePx: number,
    crawler: Player,
  ): Point | null {
    const ts = this.tileSize;
    const stretchedLeashPx = leashPx * FAIRY_RETREAT_LEASH_STRETCH;
    const withinLeash = (point: Point): boolean =>
      Math.hypot(point.x - anchor.x, point.y - anchor.y) <= stretchedLeashPx;

    const candidates: Point[] = [];
    if (withinLeash(this)) candidates.push({ x: this.x, y: this.y });
    const previous = this.hoverGoal;
    if (previous !== null && withinLeash(previous)) candidates.push(previous);
    for (const fraction of GOAL_RING_FRACTIONS) {
      this.pushRing(candidates, anchor, leashPx * fraction);
    }
    const retreatStart = candidates.length;
    this.pushRing(candidates, this, ts * FAIRY_RETREAT_STEP_TILES);
    for (let i = candidates.length - 1; i >= retreatStart; i--) {
      if (!withinLeash(candidates[i])) candidates.splice(i, 1);
    }

    let best: Point | null = null;
    let bestScore = Infinity;
    let previousScore: number | null = null;
    for (const candidate of candidates) {
      if (!this.isHoverGoalAllowed(candidate.x, candidate.y)) continue;
      const score = this.hoverGoalScore(candidate, desiredRangePx, crawler);
      if (candidate === previous) previousScore = score;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const switchMargin = ts * FAIRY_GOAL_SWITCH_MARGIN_TILES;
    if (previous !== null && previousScore !== null && previousScore - bestScore < switchMargin) {
      return previous;
    }
    return best;
  }

  private pushRing(out: Point[], centre: Point, radius: number): void {
    for (let step = 0; step < FAIRY_GOAL_SAMPLE_DIRECTIONS; step++) {
      const angle = (step / FAIRY_GOAL_SAMPLE_DIRECTIONS) * Math.PI * 2;
      out.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
    }
  }

  private hoverGoalScore(candidate: Point, desiredRangePx: number, crawler: Player): number {
    const ts = this.tileSize;
    const threatDistance = this.nearestThreatDistance(candidate);
    const tooFarWeight =
      this.positioning.keepsSightOfCrawler === true ? 1 : FAIRY_SUPPORT_TOO_FAR_WEIGHT;
    const rangeCost =
      threatDistance < desiredRangePx
        ? (desiredRangePx - threatDistance) * FAIRY_TOO_CLOSE_WEIGHT
        : (threatDistance - desiredRangePx) * tooFarWeight;
    const cover = ts * FAIRY_COVER_BONUS_TILES * this.coveredShare(candidate);
    const travel = Math.hypot(candidate.x - this.x, candidate.y - this.y) * GOAL_TRAVEL_COST;
    const blind =
      this.positioning.keepsSightOfCrawler === true && !this.seesFrom(candidate, crawler);
    const blindPenalty = blind ? ts * NO_SIGHTLINE_PENALTY_TILES : 0;
    const crossingPenalty = this.flightPassesThreat(candidate)
      ? ts * FAIRY_CROSSING_PENALTY_TILES
      : 0;
    return rangeCost - cover + travel + blindPenalty + crossingPenalty;
  }

  /** Whether flying straight from here to `candidate` passes close by a threat. */
  private flightPassesThreat(candidate: Point): boolean {
    const clearancePx = this.tileSize * FAIRY_CROSSING_CLEARANCE_TILES;
    return this.threats.some((threat) => flightPasses(threat, this, candidate, clearancePx));
  }

  /** The share of threats with an ally standing between them and a fairy at `point`. */
  private coveredShare(point: Point): number {
    if (this.threats.length === 0) return 0;
    let covered = 0;
    for (const threat of this.threats) {
      if (this.hasCoverBetween(point.x, point.y, threat)) covered++;
    }
    return covered / this.threats.length;
  }

  /** Whether a fairy hovering at (x, y) would have a clear line to `crawler`, centre to centre. */
  private seesFrom(point: Point, crawler: Player): boolean {
    const map = this.map;
    if (map === null) return true;
    const half = this.tileSize / 2;
    return map.hasLineOfSight(point.x + half, point.y + half, crawler.x + half, crawler.y + half);
  }

  /**
   * A hover goal must be open floor, must not be marked ground, and must not
   * be ground a fairy is never placed on: hazards outrank positioning for the
   * same reason they outrank a tactic, and a fairy that parked in the acid to
   * keep its range would be a free kill.
   *
   * A boss's healer is exempt from the forbidden ground alone: it is spawned
   * inside its boss's arena, which on floor 3 is the circus, and refusing that
   * ground would refuse every goal it has and leave it hanging in place.
   */
  protected isHoverGoalAllowed(x: number, y: number): boolean {
    if (isMarkedGround(x, y)) return false;
    const map = this.map;
    if (map === null) return true;
    const ts = this.tileSize;
    const tileX = Math.floor((x + ts / 2) / ts);
    const tileY = Math.floor((y + ts / 2) / ts);
    if (!map.isWalkable(tileX, tileY)) return false;
    const boundToBoss = bossOfHealer(this) !== null;
    return boundToBoss || !isFairyGroundForbidden(map, tileX, tileY);
  }

  /** Whether an ally stands on the line from (x, y) to `threat`, between the two. */
  private hasCoverBetween(x: number, y: number, threat: Player): boolean {
    const lineX = threat.x - x;
    const lineY = threat.y - y;
    const lineLengthSq = lineX * lineX + lineY * lineY;
    if (lineLengthSq === 0) return false;
    const tolerancePx = this.tileSize * FAIRY_COVER_LINE_TOLERANCE_TILES;
    for (const ally of this.allies) {
      const along = ((ally.x - x) * lineX + (ally.y - y) * lineY) / lineLengthSq;
      if (along <= 0 || along >= 1) continue;
      const offLineX = ally.x - (x + lineX * along);
      const offLineY = ally.y - (y + lineY * along);
      if (Math.hypot(offLineX, offLineY) <= tolerancePx) return true;
    }
    return false;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /**
   * The painted row and its progress for this frame.
   *
   * A cast starts its row on the release frame, so the frame that draws the
   * spell leaving the fairy is drawn on exactly the tick `onCastReleased`
   * resolves it, and the recovery plays the rest of the row out while the
   * fairy flies on. Death outranks a cast, and a cast outranks a flinch, so a
   * throw is never hidden behind the flinch of the blow that met it.
   */
  private spriteState(): FairySpriteState {
    const facing = {
      facingX: this.facingX,
      facingY: this.facingY,
      clockOffsetSeconds: this.wingClockShare * wingbeatSeconds(this.kind),
    };
    if (!this.isAlive) {
      return { ...facing, row: 'death', progress: this.corpseTicks / FAIRY_DEATH_ROW_TICKS };
    }
    const cast = this.active;
    if (cast !== null) {
      const row = cast.cast.row;
      const releaseShare = fairyReleaseProgress(row);
      const recoverTicksPlayed =
        cast.phase === 'recover' ? FAIRY_CAST_RECOVER_FRAMES - cast.framesLeft + 1 : 0;
      const recoverShare = Math.min(1, recoverTicksPlayed / FAIRY_CAST_RECOVER_FRAMES);
      const afterRelease = releaseShare + (1 - releaseShare) * recoverShare;
      return { ...facing, row, progress: Math.min(1, afterRelease + RELEASE_FRAME_NUDGE) };
    }
    if (this.hurtTicksLeft > 0) {
      const flinchTicksPlayed = FAIRY_HURT_ROW_TICKS - this.hurtTicksLeft;
      return { ...facing, row: 'hurt', progress: flinchTicksPlayed / FAIRY_HURT_ROW_TICKS };
    }
    return facing;
  }

  /**
   * Where this fairy's chest is drawn this frame, in world pixels. Anything
   * that leaves the fairy — a tether, a heal stream, a thrown ball, a
   * death burst — starts here, so it comes from the body the player sees and
   * follows it through a cast's lunge or the death row's fall.
   */
  get castOrigin(): { x: number; y: number } {
    return fairyChestPoint(this.kind, this.x, this.y, this.tileSize, this.spriteState());
  }

  /**
   * Whether the player can see this fairy right now: its body inside the
   * camera view the scene last published, and inside the fog's clear disc
   * where the scene draws one. Walls are not consulted — the view is top-down,
   * so a fairy beyond a wall but on screen is in plain sight.
   */
  get isOnScreen(): boolean {
    const chest = this.castOrigin;
    return isWorldPointInView(chest.x, chest.y, this.tileSize * FAIRY_ON_SCREEN_INSET_TILES);
  }

  /** How far {@link castOrigin} hangs above {@link groundCentre}, in pixels. */
  get hoverLiftPx(): number {
    return this.groundCentre.y - this.castOrigin.y;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawFairySprite(ctx, this.kind, sx, sy, tileSize, this.spriteState());
    if (!this.isAlive) return;
    // Off the painted crown, not the body's height: the crest, hood, flames
    // and wingtips all stand above the head, and a bar hung off the head
    // would cut through them.
    const crownY = sy + tileSize * fairyCrownBelowTileTopTiles(this.kind);
    if (this.currentTarget !== null) this.renderAggroIndicator(ctx, sx, crownY, tileSize);
    this.renderMobHealthBar(ctx, sx, crownY);
  }
}

/** A fairy's level-1 HP on `floorNumber`: a fixed share of that floor's typical host. */
export function fairyBaseHpForFloor(floorNumber: number): number {
  const hostHp =
    FAIRY_TYPICAL_HOST_HP_BY_FLOOR.get(floorNumber) ??
    FAIRY_TYPICAL_HOST_HP_BY_FLOOR.get(FAIRY_DEFAULT_HOST_FLOOR) ??
    1;
  return Math.max(1, Math.round(hostHp * FAIRY_BASE_HP_FRACTION));
}
