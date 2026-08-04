import { Mob } from './Mob';
import type { DamageSource, Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  type BallOfSwineDraw,
  type BallOfSwinePose,
  drawBallOfSwineSprite,
  drawBallOfSwineStoppedWarning,
  drawBallOfSwineTrack,
} from '../sprites/ballOfSwineSprite';
import {
  BOS_BODY_RADIUS_TILES,
  BOS_BURST_GAME_FRAMES,
  BOS_SLAM_GAME_FRAMES,
  BOS_SPINUP_GAME_FRAMES,
} from '../sprites/ballOfSwineSheet';
import { STENCH_ATTACK_TYPE, TRAMPLE_ATTACK_TYPE } from './ballOfSwineAttackTypes';
import { ARENA_INTERIOR_RADIUS_TILES } from '../map/arenaGeometry';
import { makePoison } from '../core/StatusEffect';
import type { LootDrop } from './Mob';

/**
 * Base HP. A borough boss spawns in the level-14–16 band, where `applyMobLevel`
 * multiplies this by about five — so a ball met on schedule arrives near a
 * thousand hit points.
 */
const BOS_BASE_HP = 192;

/**
 * Top rolling speed in pixels per frame, before level scaling.
 *
 * "Shockingly quickly": at the top of its band this lands a bit over twice the
 * player's walk, which is about what a Tuskling's charge does — but sustained, and
 * from a body five times the size. Capped absolutely by `MAX_ROLL_SPEED_CAP` so no
 * level can make it unbounded.
 */
const BOS_BASE_ROLL_SPEED = 2.6;
/** Hard ceiling on roll speed however high the level goes. */
const MAX_ROLL_SPEED_CAP = 6.4;
/** Share of top speed the ball still carries at the bottom of its momentum range. */
const MIN_ROLL_FRACTION = 0.3;

/**
 * The ball charges in straight lines and never turns mid-leg.
 *
 * It re-aims at a crawler at each wall carom and then commits: the whole leg is one
 * line, from the wall it left to the wall it is going to hit.
 *
 * This started as a bounded steering rate, and simulation killed it. A wide turning
 * circle inside a *circular* arena — the radius worked out at eight tiles inside
 * eleven — turns every approach into a long arc, and a long arc meets a circle at a
 * shallow angle almost every time. Over five simulated minutes the ball hit the wall
 * squarely once or twice, which means its momentum almost never dropped, which means
 * the fight's only vulnerable window almost never opened. A homing boss also has the
 * player reacting to the boss; a committed one has the player *placing* it, and
 * where the ball hits next is then something they chose.
 *
 * With straight legs the rule is geometric and teachable: a chord that passes near
 * the middle of a circle meets it head-on, and one that clips the edge grazes. So
 * make it charge you across the centre, then step off the line.
 *
 * P2's "avoidance by movement alone" is satisfied outright — the line is fixed at
 * the moment it commits, so stepping off it always works.
 */
// (No constant: there is no turn rate. The absence is the design.)

/**
 * How square an impact has to be to count as a head-on slam, as the cosine of the
 * angle between the ball's heading and the wall's inward normal.
 *
 * Below this the ball caroms off and keeps every scrap of its momentum, which is
 * the source's "it never loses momentum" taken literally. Above it, a fifteen-foot
 * sack of muscle hits iron flat and something has to give.
 */
const HEAD_ON_COSINE = 0.72;
/** Momentum a barely-head-on slam costs. */
const SLAM_MOMENTUM_LOSS_MIN = 0.12;
/**
 * Momentum a perfectly square slam costs.
 *
 * Three dead-on hits to stop it, or five or six indifferent ones. Simulated at
 * nearly twice this the ball spent 36% of the fight lying down, which is not a boss.
 */
const SLAM_MOMENTUM_LOSS_MAX = 0.36;

/**
 * Momentum drained per frame while slowed.
 *
 * The item-based half of the counterplay, and the reason there are gym barriers in
 * the arena at all: a barrier's slow zone is under a tile across, so a pass through
 * one costs the ball a quarter of its momentum rather than stopping it. Reads
 * `isSlowed`, so an electrified shockwave and a melee hit-slow feed it too.
 */
const SLOWED_MOMENTUM_DRAIN = 0.05;

/** Frames the ball lies wallowing after the gentlest possible stop. */
const WALLOW_MIN_FRAMES = 100;
/** Frames it lies wallowing after being stopped by a perfectly square slam. */
const WALLOW_MAX_FRAMES = 210;

/**
 * Share of incoming damage that lands while the ball is rolling.
 *
 * A fraction rather than the flat cap of 1 the previous fight used: capped at 1,
 * every attack outside the vulnerable window is pointless, so a ranged crawler
 * spends the whole fight not playing. A fifth still makes chip damage worth
 * throwing while rewarding the window enormously.
 */
const ROLLING_DAMAGE_FRACTION = 0.2;
/** However small the fraction makes it, a connected hit always does something. */
const MIN_DAMAGE_THROUGH_HIDE = 1;
/** Damage multiplier while it is down. */
const WALLOW_DAMAGE_MULTIPLIER = 2;

/** Share of the victim's own max HP a full-speed trample takes. */
const TRAMPLE_HP_FRACTION = 0.5;
/** Flat damage on top, so a trample still stings a crawler at full health. */
const TRAMPLE_FLAT_DAMAGE = 2;
/**
 * Frames before the same target can be trampled again.
 *
 * A second and a half was too forgiving — a crawler run down by a five-tile boss got
 * most of a second of free standing before it could touch them again.
 */
const TRAMPLE_COOLDOWN = 55;
/**
 * Share of a trample that a *wallowing* ball still deals on contact.
 *
 * The vulnerable window used to be completely safe, so the greedy play — stand inside
 * it and swing — carried no risk at all, and the whole fight collapsed into waiting
 * for a free hit. A thousand pounds of thrashing pig is not safe to stand on, and
 * making the window cost something is what turns it into a decision.
 */
const WALLOW_CONTACT_FRACTION = 0.28;
/**
 * How close the ball's centre must come to a target's before it trundles over them,
 * as a share of the painted radius.
 *
 * Under one, so the hitbox sits inside the picture: a crawler clipped by a body
 * they can see is not standing next to reads as the boss having reach it does not.
 */
const TRAMPLE_RANGE_FRACTION_OF_BODY = 0.9;
const TRAMPLE_RANGE_TILES = BOS_BODY_RADIUS_TILES * TRAMPLE_RANGE_FRACTION_OF_BODY;

/** HP fraction below which the ball starts shedding live Tusklings as it rolls. */
const SHED_HP_FRACTION = 0.6;
/** HP fraction below which it is frenzied: faster, shorter wallows, stench bursts. */
const FRENZY_HP_FRACTION = 0.3;
/** Frames between shed Tusklings. */
const SHED_INTERVAL_FRAMES = 165;
/** Speed multiplier while frenzied. */
const FRENZY_SPEED_MULTIPLIER = 1.32;
/** Multiplier on the wallow window while frenzied. */
const FRENZY_WALLOW_MULTIPLIER = 0.6;

/**
 * Radius of the stench shockwave a frenzied ball vents on impact, in tiles.
 *
 * Undodgeable once you are inside it, so per P2 its damage is flat and never
 * scaled — the avoidance is spatial: do not be standing at the wall the ball is
 * about to hit.
 */
const STENCH_RADIUS_TILES = 4;
const STENCH_DAMAGE = 3;

const COIN_DROP_MIN = 60;
const COIN_DROP_MAX = 110;
/**
 * XP, priced so that the *scaled* award at the top of the boss's band stays near
 * what the fight paid before the level band moved up. `applyMobLevel` adds a
 * quarter per level, so raising the level without lowering this would have handed
 * a floor-2 party several levels for one optional fight.
 */
const BOS_XP_VALUE = 600;

/** Frames the stench ring is drawn for after a burst. */
const STENCH_FLASH_FRAMES = 26;
const STENCH_RING_COLOR = '#5c6b2a';
const STENCH_RING_ALPHA = 0.45;
const STENCH_RING_WIDTH_RATIO = 0.5;
/**
 * Heaves the wallowing body makes across one window.
 *
 * Driven off how far through the window it is rather than off a clock, so the
 * heave and the draining timer bar are the same fact and a paused game does not
 * animate.
 */
const WALLOW_HEAVE_CYCLES = 5;

/**
 * Smears of wet track kept behind the ball, and how far apart they are laid.
 *
 * The only cue in the fight that says which way a five-tile sphere came from —
 * a sphere has no front, so its own picture cannot tell you. A ring buffer rather
 * than a growing list: it is written every few frames for as long as the fight
 * lasts, and the oldest smear has already faded to nothing.
 */
const TRACK_SMEARS = 14;
const TRACK_SPACING_FRAMES = 5;

const MASS = 10;
const TILE_CENTER_OFFSET = 0.5;
/** Tiles of sprite overhang the render pipeline has to keep in view. */
const CULL_MARGIN_TILES = 3;
/** Tiles past the arena's own ground the ball will still notice a crawler on. */
const ARENA_AGGRO_EXTEND_TILES = 3;
/** Below this a heading vector is degenerate rather than something to normalise. */
const MIN_HEADING_LENGTH = 1e-4;

/**
 * How close the ball gets before it makes its one correction of the charge, in tiles.
 *
 * A committed straight line is honest and readable, and on its own it is also *free*
 * to dodge: one early sidestep beats it and then beats it forever, which is the "no
 * pressure" a playtest found. So the charge closes with a single locked re-aim — step
 * off the line early and it follows you once; step off late, after the lunge, and it
 * cannot.
 *
 * At six tiles that leaves about 35 frames between the correction and contact, above
 * the 21-frame floor `docs/difficulty-plan.md` P2 puts on a locked telegraph, so the
 * dodge stays possible by movement alone — it just has to be *timed* rather than
 * merely remembered.
 */
const LUNGE_RANGE_TILES = 6;
/** Frames the lunge tell is drawn for. */
const LUNGE_FLASH_FRAMES = 14;
const LUNGE_TELL_COLOR = '#f87171';
const LUNGE_TELL_ALPHA = 0.5;
const LUNGE_TELL_WIDTH_RATIO = 0.4;

/**
 * Shallowest angle, in radians, at which the ball may leave the arena wall.
 *
 * Roughly 26°, which is enough that a carom always carries it clear of the rim and
 * out across the floor. See `caromHeading` for why a pure reflection is not enough.
 */
const MIN_CAROM_DEPARTURE = 0.45;
const MIN_CAROM_SINE = Math.sin(MIN_CAROM_DEPARTURE);
const MIN_CAROM_COSINE = Math.cos(MIN_CAROM_DEPARTURE);

/**
 * `spent` is the terminal phase, and it is load-bearing.
 *
 * `isAlive` reports true for the whole of `bursting` so the fight cannot end while
 * the body is still coming apart on screen. Without somewhere to go afterwards the
 * ball stays in that phase forever: `isAlive` never falls through to `hp > 0`,
 * `updateAI` keeps running, and `justDied` is re-latched every frame — which
 * re-resolves the kill sixty times a second, re-awards the whole XP split each time,
 * re-emits `bossDefeated` into another eight Tusklings, and leaves a 0-HP carcass
 * standing that a checkpoint rewind can never revive because it never reads as dead.
 */
type BosPhase = 'rolling' | 'slamming' | 'wallowing' | 'spinning_up' | 'bursting' | 'spent';

/**
 * The heading a ball leaves a wall on, given the wall's inward normal.
 *
 * A mirror reflection, except that a shallow one is opened out until it is at least
 * `MIN_CAROM_DEPARTURE` off the wall. Pure reflection has a degenerate case that
 * measurement found and no amount of reading would have: a ball that arrives at a
 * grazing angle leaves at a grazing angle, and then arrives at a grazing angle
 * again — it orbits the rim forever, glancing, never hitting anything flat. Since a
 * glancing carom is free by design, the fight's only lever would never come back up.
 *
 * A soft, lumpy, fifteen-foot sack of meat does not skim along ironwork anyway. It
 * bounces off and crosses the floor, which is also the shape that gives the crawler
 * a ball to line up.
 */
function caromHeading(heading: number, normalX: number, normalY: number): number {
  const dirX = Math.cos(heading);
  const dirY = Math.sin(heading);
  const dot = dirX * normalX + dirY * normalY;
  let outX = dirX - 2 * dot * normalX;
  let outY = dirY - 2 * dot * normalY;
  const length = Math.hypot(outX, outY);
  if (length < MIN_HEADING_LENGTH) return heading;
  outX /= length;
  outY /= length;

  // For a unit heading, its component along the inward normal *is* the sine of its
  // angle to the wall.
  const awayFromWall = outX * normalX + outY * normalY;
  if (awayFromWall >= MIN_CAROM_SINE) return Math.atan2(outY, outX);
  return openedFromWall(Math.atan2(outY, outX), normalX, normalY);
}

/**
 * A heading tilted away from a wall until it is `MIN_CAROM_DEPARTURE` clear of it,
 * keeping whichever way along the wall it was already going.
 *
 * Rebuilt from the wall's own frame rather than rotated by a delta: reconstructing
 * lands on the departure angle exactly, where rotating has to decide a direction and
 * can only approach it.
 */
function openedFromWall(heading: number, normalX: number, normalY: number): number {
  const dirX = Math.cos(heading);
  const dirY = Math.sin(heading);
  const alongSign = dirX * -normalY + dirY * normalX >= 0 ? 1 : -1;
  const tangentX = -normalY * alongSign;
  const tangentY = normalX * alongSign;
  return Math.atan2(
    tangentY * MIN_CAROM_COSINE + normalY * MIN_CAROM_SINE,
    tangentX * MIN_CAROM_COSINE + normalX * MIN_CAROM_SINE,
  );
}

/**
 * Attributed to the ball so the death screen can name what flattened you.
 * Dodgeable: getting out of its line is the whole counterplay, and marking it
 * undodgeable would take that away from a dexterous crawler.
 */
function trampleDamageSource(mobType: string): DamageSource {
  return { kind: 'mob', mobType, attackType: TRAMPLE_ATTACK_TYPE };
}

/**
 * The stench wave, marked undodgeable: it is a volume of air, not a swing, and
 * there is nothing in it to sidestep once you are standing in it.
 */
function stenchDamageSource(mobType: string): DamageSource {
  return { kind: 'mob', mobType, attackType: STENCH_ATTACK_TYPE, undodgeable: true };
}

/** A stench burst the arena system has to resolve, in world pixels. */
export interface StenchBurst {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The Ball of Swine — floor 2's optional borough boss.
 *
 * The whole fight is one idea: **momentum**. It never loses any on its own, which
 * is what the source insists on, and it never loses any to a glancing carom off the
 * arena wall either. What takes momentum away is the crawler making it hit
 * something flat — a square wall slam, or a gym barrier's slow field — and momentum
 * is what its speed, its trample damage and its invulnerability are all made of.
 * Take enough and it collapses into a wallow, which is the only window in which it
 * can be hurt properly.
 *
 * Nothing here is on a timer the player cannot see or influence, which is the
 * fight the previous version was not: that one rolled on a fixed orbit, killed
 * instantly on contact, and stopped for twenty to forty seconds at random.
 */
export class BallOfSwine extends Mob {
  override readonly audioTag = 'ball_of_swine';
  readonly xpValue = BOS_XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Ball of Swine';
  mass = MASS;
  description =
    'A rolling mass of fused swine in shredded evening wear. It never slows down on its own — ' +
    'make it hit something.';

  // Arena geometry, filled in by `setArena` after construction.
  private arenaCentrePx = { x: 0, y: 0 };
  private arenaInteriorPx = 0;

  /** 0 to 1. Drives speed, trample damage, and how hard it is to hurt. */
  private momentum = 1;
  /** Travel direction in radians. */
  private heading = Math.random() * Math.PI * 2;
  /** Accumulated surface rotation in radians, driven by distance rolled. */
  private rollPhase = 0;

  private phase: BosPhase = 'rolling';
  private slamTimer = 0;
  /**
   * The direction the ball was travelling when it hit, kept for the slam pose.
   *
   * `heading` has already been turned around by then — a slam is followed by a
   * departure — and the slam art is authored with its flattened face and its spray
   * cone at +X. Drawn to the live heading, a dead-on bait (where the turn is exactly
   * 180°) shows the ball compressed on its *inward* side, spraying at the middle of
   * the arena, for the whole animation.
   */
  private slamHeading = 0;
  /** How flat the last impact was, 0 to 1. Sets the wallow window if that impact stopped it. */
  private slamSquareness = 0;
  /** Whether this charge has already spent its one correction. */
  private hasLunged = false;
  private lungeFlash = 0;
  private spinupTimer = 0;
  private wallowTimer = 0;
  private wallowTotal = WALLOW_MIN_FRAMES;
  private burstTimer = 0;
  private shedTimer = SHED_INTERVAL_FRAMES;

  /** Set when hp hits 0, and held until the burst has played out. */
  private pendingBurst = false;

  /**
   * Tusklings torn loose that the arena system still has to spawn, and stench
   * bursts it still has to resolve.
   *
   * Queued on the boss and drained by the system rather than acted on here, for the
   * reason this codebase repeats at every projectile site: anything a mob owns is
   * deleted mid-flight the moment the mob dies.
   */
  pendingSheds = 0;
  pendingStench: StenchBurst | null = null;

  private trampleCooldowns = new Map<Player, number>();

  /** Ring buffer of recent positions, oldest-first once it has wrapped. */
  private readonly trackX = new Float64Array(TRACK_SMEARS);
  private readonly trackY = new Float64Array(TRACK_SMEARS);
  private readonly trackHeading = new Float64Array(TRACK_SMEARS);
  /** How many smears have ever been laid; the buffer index is this modulo its length. */
  private trackCount = 0;
  private trackTimer = 0;
  /** Frames left of the stench ring. Purely cosmetic; the damage is the system's. */
  private stenchFlash = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BOS_BASE_HP, BOS_BASE_ROLL_SPEED);
    this.isBoss = false; // managed by ArenaSystem, not BossRoomSystem
  }

  /** Must be called once after construction so the ball knows its arena bounds. */
  setArena(centreTileX: number, centreTileY: number): void {
    // The *centre* of the centre tile, not its corner. Everything measured against
    // this compares tile centres — the ball's own position is a tile top-left and has
    // half a tile added back — so a corner here would put the containment circle,
    // the aggro radius and the carom normals all half a tile off the real arena.
    this.arenaCentrePx = {
      x: (centreTileX + TILE_CENTER_OFFSET) * TILE_SIZE,
      y: (centreTileY + TILE_CENTER_OFFSET) * TILE_SIZE,
    };
    this.arenaInteriorPx = ARENA_INTERIOR_RADIUS_TILES * TILE_SIZE;
  }

  /** Whether the death is already under way, or over. Nothing may restart it. */
  private get isDying(): boolean {
    return this.pendingBurst || this.phase === 'bursting' || this.phase === 'spent';
  }

  /** True while the ball is down and can be hurt properly. */
  get isStopped(): boolean {
    return this.phase === 'wallowing';
  }

  /** How much momentum it is carrying, 0 to 1 — the fight's read-out. */
  get momentumFraction(): number {
    return this.momentum;
  }

  get isShedding(): boolean {
    return this.hp <= this.maxHp * SHED_HP_FRACTION;
  }

  get isFrenzied(): boolean {
    return this.hp <= this.maxHp * FRENZY_HP_FRACTION;
  }

  /** Fraction of the wallow window already spent, 0 just down and 1 getting up. */
  get wallowElapsedFraction(): number {
    if (this.wallowTotal <= 0) return 1;
    return 1 - this.wallowTimer / this.wallowTotal;
  }

  /** True while it is moving fast enough to run a companion down. */
  override get avoidInstead(): boolean {
    return this.phase === 'rolling' || this.phase === 'slamming';
  }

  /**
   * Its line is dodgeable, so the companion should be sidestepping rather than
   * trading — but only once it has someone to charge.
   *
   * `MobUpdateLoop` force-activates anything that returns true here *regardless of
   * distance*, so an unconditional yes had a level-15 ball ticking from the moment
   * the floor loaded, rattling round an empty chamber on the far side of the map.
   */
  override get requiresEvasion(): boolean {
    return this.currentTarget !== null && this.phase !== 'wallowing';
  }

  override get cullMarginTiles(): number {
    return CULL_MARGIN_TILES;
  }

  /**
   * The ball is drawn nearly three tiles across, centred on a one-tile footprint, so
   * anything anchored to its tile lands inside the body. Everything written above it
   * — the septic label here, the health bar and the vulnerability banner below — is
   * lifted clear by its own radius.
   */
  protected override get statusLabelClearanceTiles(): number {
    return BOS_BODY_RADIUS_TILES;
  }

  /**
   * The ball's motion is its own.
   *
   * Separation exists to stop mobs stacking on one tile, and shoving a body that
   * is following a heading and a wall-carom rewrites the trajectory the crawler is
   * reading — a nudge from a shed Tuskling would bend the charge they had already
   * committed to dodging.
   */
  override applySeparation(): void {
    // Deliberately empty; see above.
  }

  /** Keeps `isAlive` true through the burst so the fight does not end mid-animation. */
  override get isAlive(): boolean {
    if (this.pendingBurst || this.phase === 'bursting') return true;
    return this.hp > 0;
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' = 'melee',
  ): void {
    if (this.isDying) return;
    super.takeDamageFrom(this.throughHide(amount), attacker, damageType);
    this.holdDeathForTheBurst();
  }

  /**
   * Converts a death `super` has just resolved into the burst latch.
   *
   * `super` credits the kill and rolls the loot, which is all wanted; what it must
   * not do is let the scene resolve the death *this frame*, because the body has to
   * come apart on screen first and release its Tusklings when it does.
   */
  private holdDeathForTheBurst(): void {
    if (this.hp !== 0 || !this.justDied) return;
    this.justDied = false;
    this.pendingBurst = true;
    this.phase = 'bursting';
    this.burstTimer = BOS_BURST_GAME_FRAMES;
  }

  /**
   * A killing blow that does not have to get past the hide.
   *
   * Credited to the crawler it was charging — the best available guess for a status
   * effect nobody is holding, while the XP split itself comes off the damage-share
   * ledger regardless. Routed through the ordinary mob damage path rather than
   * hand-rolled, so that ledger, the loot roll, the kill credit and the hit flash all
   * behave exactly as they do for a sword: a boss that dropped nothing and awarded
   * nothing because of *how* it died would read as a bug.
   */
  private takeUnreducedDamage(amount: number): void {
    if (amount <= 0) return;
    super.takeDamageFrom(amount, this.currentTarget, 'melee');
    this.holdDeathForTheBurst();
  }

  /**
   * A status effect's damage tick.
   *
   * `Player.takeDamage` is where burn, poison and sepsis land, and it does none of a
   * mob's death bookkeeping — no `justDied`, no loot, no kill credit. For an ordinary
   * mob that is a reward quietly lost; for this one it is also the burst skipped, so
   * no Tusklings and no stairwell, and the Sepsis Crown the cat can be wearing
   * applies a *permanent* tick. So a lethal tick is converted into a real mob death
   * here rather than being allowed to drop the hit points on the floor.
   *
   * Taking the lethal blow off `super` skips its guards, and each one is checked
   * rather than assumed: `isProtected` is written only by `PlayerManager`, for the two
   * crawlers; `invulnerableFrames` only by Cockroach, a player skill; `godMode` and
   * `isKnockedOut` are player-only; and its dodge roll needs a `'mob'` source, which a
   * status tick is not and a mob attacker never uses against another mob. None of them
   * can be true here. A non-lethal tick goes through `super` untouched regardless.
   */
  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (this.isDying) return false;
    // `this.hp > 0` as well as `amount >= this.hp`, so the branch cannot be entered
    // for an already-dead ball and then return `true` having done nothing.
    if (amount > 0 && this.hp > 0 && amount >= this.hp) {
      this.takeUnreducedDamage(this.hp);
      return true;
    }
    return super.takeDamage(amount, source);
  }

  private throughHide(amount: number): number {
    if (this.phase === 'wallowing') return Math.ceil(amount * WALLOW_DAMAGE_MULTIPLIER);
    return Math.max(MIN_DAMAGE_THROUGH_HIDE, Math.floor(amount * ROLLING_DAMAGE_FRACTION));
  }

  /**
   * Mid-fight only: a checkpoint respawn during the burst animation must not
   * resurrect a boss that has already been defeated — `isAlive` reads true through
   * that whole window on purpose, so it cannot gate this.
   */
  override resetToSpawn(): void {
    if (this.isDying || this.hp === 0) return;
    super.resetToSpawn();
    this.phase = 'rolling';
    this.momentum = 1;
    this.heading = Math.random() * Math.PI * 2;
    this.rollPhase = 0;
    this.slamTimer = 0;
    this.slamHeading = 0;
    this.slamSquareness = 0;
    this.hasLunged = false;
    this.lungeFlash = 0;
    this.spinupTimer = 0;
    this.wallowTimer = 0;
    this.wallowTotal = WALLOW_MIN_FRAMES;
    this.shedTimer = SHED_INTERVAL_FRAMES;
    this.trampleCooldowns.clear();
    this.trackCount = 0;
    this.trackTimer = 0;
    this.stenchFlash = 0;
    // Anything the arena system has not drained yet belongs to a fight that no
    // longer happened.
    this.pendingSheds = 0;
    this.pendingStench = null;
  }

  /**
   * The burst latch has to be cleared before the base revive runs: it is what
   * `resetToSpawn()` bails on, so a ball brought back with the latch still set
   * would keep its full HP and none of its position or phase reset.
   */
  override reviveForCheckpoint(): void {
    this.pendingBurst = false;
    this.burstTimer = 0;
    this.phase = 'rolling';
    super.reviveForCheckpoint();
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [{ id: 'health_potion', quantity: 3 }];
  }

  updateAI(targets: Player[]): void {
    if (this.stenchFlash > 0) this.stenchFlash--;
    if (this.lungeFlash > 0) this.lungeFlash--;

    for (const [player, cooldown] of this.trampleCooldowns) {
      if (cooldown <= 1) this.trampleCooldowns.delete(player);
      else this.trampleCooldowns.set(player, cooldown - 1);
    }

    switch (this.phase) {
      case 'rolling':
        this.updateRolling(targets);
        break;
      case 'slamming':
        this.updateSlamming();
        break;
      case 'wallowing':
        this.updateWallowing(targets);
        break;
      case 'spinning_up':
        this.updateSpinningUp();
        break;
      case 'bursting':
        this.updateBursting();
        break;
      case 'spent':
        break;
    }

    if (this.phase === 'wallowing') this.trampleContacts(targets, WALLOW_CONTACT_FRACTION);

    this.isMoving = this.phase === 'rolling';
  }

  private updateRolling(targets: Player[]): void {
    const target = this.nearestInArena(targets);
    this.currentTarget = target;

    if (this.isSlowed) this.spendMomentum(SLOWED_MOMENTUM_DRAIN);
    if (this.momentum <= 0) {
      // Ground to a halt in a slow field rather than put down by an impact, so the
      // shortest window there is.
      this.collapse(0);
      return;
    }

    if (target !== null) {
      this.updateLastKnown(target);
      this.tryLunge(target);
    }

    const speed = this.currentSpeed();
    const travelled = this.advance(Math.cos(this.heading) * speed, Math.sin(this.heading) * speed);
    this.rollPhase += travelled / (BOS_BODY_RADIUS_TILES * TILE_SIZE);
    this.faceHeading();

    // `advance` resolves the wall, and a square hit can slam, wallow, or kill it
    // outright. Everything below belongs to a ball that is still rolling: without
    // this, a crawler standing where it kills itself eats a full-momentum trample
    // from a boss that is already dead, and it can shed a Tuskling post-mortem.
    if (this.phase !== 'rolling') return;

    this.trampleContacts(targets);
    this.tickShedding(target !== null);
    this.layTrack();
  }

  private layTrack(): void {
    this.trackTimer--;
    if (this.trackTimer > 0) return;
    this.trackTimer = TRACK_SPACING_FRAMES;
    const slot = this.trackCount % TRACK_SMEARS;
    this.trackX[slot] = this.x;
    this.trackY[slot] = this.y;
    this.trackHeading[slot] = this.heading;
    this.trackCount++;
  }

  /**
   * The tell for the charge's one correction: a bar of ground marking the line it has
   * just committed to, thrown forward from the body.
   *
   * Without it the lunge is a boss that swerves onto you for no visible reason, which
   * is the difference between pressure and unfairness — P2 wants the dodge possible by
   * movement alone, and that means the crawler has to be able to see what to move off.
   */
  private drawLungeTell(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    if (this.lungeFlash <= 0) return;
    const fade = this.lungeFlash / LUNGE_FLASH_FRAMES;
    const centreX = sx + tileSize * TILE_CENTER_OFFSET;
    const centreY = sy + tileSize * TILE_CENTER_OFFSET;
    ctx.save();
    ctx.globalAlpha = LUNGE_TELL_ALPHA * fade;
    ctx.strokeStyle = LUNGE_TELL_COLOR;
    ctx.lineWidth = tileSize * LUNGE_TELL_WIDTH_RATIO;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(
      centreX + Math.cos(this.heading) * BOS_BODY_RADIUS_TILES * tileSize,
      centreY + Math.sin(this.heading) * BOS_BODY_RADIUS_TILES * tileSize,
    );
    ctx.lineTo(
      centreX + Math.cos(this.heading) * LUNGE_RANGE_TILES * tileSize,
      centreY + Math.sin(this.heading) * LUNGE_RANGE_TILES * tileSize,
    );
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The expanding ring of sewage a frenzied slam vents.
   *
   * Grows to the radius the burst actually covered rather than to a decorative one,
   * so what the crawler saw is what hit them.
   */
  private drawStenchRing(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    if (this.stenchFlash <= 0) return;
    const spread = 1 - this.stenchFlash / STENCH_FLASH_FRAMES;
    const radius = STENCH_RADIUS_TILES * tileSize * spread;
    ctx.save();
    ctx.globalAlpha = STENCH_RING_ALPHA * (1 - spread);
    ctx.strokeStyle = STENCH_RING_COLOR;
    ctx.lineWidth = tileSize * STENCH_RING_WIDTH_RATIO;
    ctx.beginPath();
    ctx.arc(
      sx + tileSize * TILE_CENTER_OFFSET,
      sy + tileSize * TILE_CENTER_OFFSET,
      Math.max(1, radius),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }

  private drawTrack(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const laid = Math.min(this.trackCount, TRACK_SMEARS);
    for (let back = 0; back < laid; back++) {
      const slot = (this.trackCount - 1 - back + TRACK_SMEARS * 2) % TRACK_SMEARS;
      drawBallOfSwineTrack(
        ctx,
        this.trackX[slot] - camX,
        this.trackY[slot] - camY,
        tileSize,
        this.trackHeading[slot],
        (back + 1) / TRACK_SMEARS,
      );
    }
  }

  /**
   * The charge's one correction, taken once it is close enough for the crawler to be
   * committed to a dodge.
   *
   * Fired on closing range rather than on a timer, so it always lands at the same
   * *distance* whatever the ball's speed — which is what makes the reaction window a
   * fixed thing a player can learn.
   */
  private tryLunge(target: Player): void {
    if (this.hasLunged) return;
    const centreX = this.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const centreY = this.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const targetX = target.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const targetY = target.y + TILE_SIZE * TILE_CENTER_OFFSET;
    if (Math.hypot(targetX - centreX, targetY - centreY) > LUNGE_RANGE_TILES * TILE_SIZE) return;
    const wanted = this.headingToward(target);
    if (wanted === null) return;
    this.hasLunged = true;
    this.heading = wanted;
    this.lungeFlash = LUNGE_FLASH_FRAMES;
    this.specialSoundPending = true;
  }

  /**
   * The heading straight at a target, or null when there is nothing to charge or the
   * target is already underneath the ball.
   */
  private headingToward(target: Player | null): number | null {
    if (target === null) return null;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (Math.hypot(dx, dy) < MIN_HEADING_LENGTH) return null;
    return Math.atan2(dy, dx);
  }

  private currentSpeed(): number {
    const base = this.moveSpeed * (MIN_ROLL_FRACTION + this.momentum * (1 - MIN_ROLL_FRACTION));
    const frenzied = this.isFrenzied ? base * FRENZY_SPEED_MULTIPLIER : base;
    return Math.min(frenzied, MAX_ROLL_SPEED_CAP);
  }

  /**
   * Moves the ball and resolves the arena wall, returning how far it actually went.
   *
   * The wall is handled analytically against the arena's own circle rather than by
   * reading tiles, for two reasons: it gives a real surface normal, which is what
   * the whole head-on-versus-glancing distinction is made of, and it turns the ball
   * around at its own *painted* radius, so a body five times the width of its
   * collision box never appears to be halfway inside the ironwork.
   *
   * `moveWithCollision` still does the actual moving underneath, so anything else
   * the arena grows later can stop it.
   */
  private advance(dx: number, dy: number): number {
    const beforeX = this.x;
    const beforeY = this.y;
    this.moveWithCollision(dx, dy);
    const movedX = this.x - beforeX;
    const movedY = this.y - beforeY;

    // Both axes refused: something not on the arena circle is in the way, and a
    // ball that cannot move is a ball that has hit something flat.
    if (movedX === 0 && movedY === 0 && (dx !== 0 || dy !== 0)) {
      // Something not on the arena circle is straight ahead — nothing is, today, but
      // the first prop anyone puts in the arena will be. Treated as a dead-on
      // impact, with the same two rules the wall gets: no momentum comes off it
      // while there is nobody to fight, and it leaves along a new line rather than
      // grinding against whatever stopped it.
      this.slamHeading = this.heading;
      const facingNormalX = -Math.cos(this.heading);
      const facingNormalY = -Math.sin(this.heading);
      if (this.currentTarget === null) {
        this.heading = caromHeading(this.heading, facingNormalX, facingNormalY);
        return 0;
      }
      this.heading = this.chargeHeadingFrom(facingNormalX, facingNormalY);
      this.hasLunged = false;
      this.slamInto(1);
      return 0;
    }

    this.resolveArenaWall();
    return Math.hypot(movedX, movedY);
  }

  private resolveArenaWall(): void {
    if (this.arenaInteriorPx <= 0) return;
    const centreX = this.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const centreY = this.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const offsetX = centreX - this.arenaCentrePx.x;
    const offsetY = centreY - this.arenaCentrePx.y;
    const distance = Math.hypot(offsetX, offsetY);
    const limit = this.arenaInteriorPx - BOS_BODY_RADIUS_TILES * TILE_SIZE;
    if (distance <= limit || distance < MIN_HEADING_LENGTH) return;

    // Inward normal at the point of contact.
    const normalX = -offsetX / distance;
    const normalY = -offsetY / distance;
    const incidence = -(Math.cos(this.heading) * normalX + Math.sin(this.heading) * normalY);

    // Sat back onto the wall before anything else, so a ball that has overshot
    // cannot be re-detected next frame and slam twice for one impact.
    this.x += normalX * (distance - limit);
    this.y += normalY * (distance - limit);

    // Only a fight can cost it momentum. With nobody in the chamber every contact is
    // a free carom however square it is: the source is explicit that it never loses
    // momentum, and a ball that had been grinding itself down on the ironwork since
    // the floor loaded would greet the party already collapsed, with an empty
    // momentum bar and VULNERABLE over its head — the opening beat and Mordecai's
    // hint about baiting the wall both spent before anyone arrived.
    if (incidence >= HEAD_ON_COSINE && this.currentTarget !== null) {
      this.slamHeading = this.heading;
      this.heading = caromHeading(this.heading, normalX, normalY);
      this.slamInto((incidence - HEAD_ON_COSINE) / (1 - HEAD_ON_COSINE));
      return;
    }

    // A glancing carom costs it nothing at all. This is the source's "it never loses
    // momentum", and it is what makes the crawler's job *aiming* the thing rather
    // than waiting for it to tire.
    //
    // The carom is also where it picks its next line, because a wall is the only
    // place a committed charge can end. It turns on the spot like a bull — it has
    // just bounced off a wall, and nothing about that has to look smooth.
    this.heading = this.chargeHeadingFrom(normalX, normalY);
    this.hasLunged = false;
    this.specialSoundPending = true;
  }

  /**
   * The line to charge along after leaving a wall whose inward normal is given.
   *
   * Straight at a crawler when there is one, clamped so it cannot aim back into the
   * wall it is standing against — and a plain physical carom when the arena is
   * empty, so an unattended ball keeps rattling round its chamber instead of
   * stopping, which is the one thing the source says it never does.
   */
  private chargeHeadingFrom(normalX: number, normalY: number): number {
    const wanted = this.headingToward(this.currentTarget);
    const carom = caromHeading(this.heading, normalX, normalY);
    if (wanted === null) return carom;
    // Below the departure floor the crawler is standing along the wall from it, and
    // charging them directly would drive the ball into the ironwork at a grazing
    // angle for the whole leg. Opened out to the same floor a carom uses.
    const awayFromWall = Math.cos(wanted) * normalX + Math.sin(wanted) * normalY;
    if (awayFromWall >= MIN_CAROM_SINE) return wanted;
    return openedFromWall(wanted, normalX, normalY);
  }

  /**
   * Resolves a flat impact. `squareness` runs 0 for the shallowest angle that still
   * counts as one to 1 for dead-on.
   */
  private slamInto(squareness: number): void {
    const clamped = Math.max(0, Math.min(1, squareness));
    this.slamSquareness = clamped;
    const loss =
      SLAM_MOMENTUM_LOSS_MIN + clamped * (SLAM_MOMENTUM_LOSS_MAX - SLAM_MOMENTUM_LOSS_MIN);
    this.spendMomentum(loss);

    // The wall takes its momentum and nothing else. It does *not* wound itself: a
    // boss that whittles its own health bar down on the scenery reads as the arena
    // fighting for you, and left alone long enough it finishes the job — which makes
    // the crawler a spectator to their own boss fight. Every point of damage on this
    // creature has to be dealt by somebody.
    if (this.isFrenzied) {
      this.pendingStench = {
        x: this.x + TILE_SIZE * TILE_CENTER_OFFSET,
        y: this.y + TILE_SIZE * TILE_CENTER_OFFSET,
        radius: STENCH_RADIUS_TILES * TILE_SIZE,
      };
      this.stenchFlash = STENCH_FLASH_FRAMES;
    }

    this.specialSoundPending = true;
    this.phase = 'slamming';
    this.slamTimer = BOS_SLAM_GAME_FRAMES;
  }

  private spendMomentum(amount: number): void {
    this.momentum = Math.max(0, this.momentum - amount);
  }

  private updateSlamming(): void {
    this.slamTimer--;
    if (this.slamTimer > 0) return;
    if (this.momentum <= 0) {
      this.collapse(this.slamSquareness);
      return;
    }
    this.phase = 'rolling';
  }

  /**
   * Drops into the wallow.
   *
   * `squareness` is how flat the blow that finished it was, 0 to 1, and it scales the
   * window between `WALLOW_MIN_FRAMES` and `WALLOW_MAX_FRAMES` — so a ball put down
   * by a dead-on bait stays down measurably longer than one ground to a halt on
   * barriers. The reward is proportional to the play rather than one of two lengths.
   */
  private collapse(squareness: number): void {
    const clamped = Math.max(0, Math.min(1, squareness));
    const window = WALLOW_MIN_FRAMES + clamped * (WALLOW_MAX_FRAMES - WALLOW_MIN_FRAMES);
    this.phase = 'wallowing';
    this.wallowTotal = Math.max(
      1,
      Math.round(this.isFrenzied ? window * FRENZY_WALLOW_MULTIPLIER : window),
    );
    this.wallowTimer = this.wallowTotal;
    this.momentum = 0;
    this.specialSoundPending = true;
  }

  private updateWallowing(targets: Player[]): void {
    this.currentTarget = this.nearestInArena(targets);
    this.wallowTimer--;
    if (this.wallowTimer > 0) return;
    this.phase = 'spinning_up';
    this.spinupTimer = BOS_SPINUP_GAME_FRAMES;
    // Aim locked at the top of the telegraph and never touched again until it is
    // moving, which is what P2's "locked telegraph" means: what the crawler reads
    // during the wind-up is where it is actually going.
    this.lockChargeAtTarget();
    this.specialSoundPending = true;
  }

  private updateSpinningUp(): void {
    this.spinupTimer--;
    if (this.spinupTimer > 0) return;
    this.momentum = 1;
    this.phase = 'rolling';
    this.specialSoundPending = true;
  }

  /** Locks the line for the leg that follows a wallow, aimed where the telegraph was. */
  private lockChargeAtTarget(): void {
    const wanted = this.headingToward(this.currentTarget);
    if (wanted !== null) this.heading = wanted;
    this.hasLunged = false;
  }

  private updateBursting(): void {
    this.burstTimer--;
    if (this.burstTimer > 0) return;
    // Only now does the scene get to see it die — and spawn what was inside it. The
    // phase moves on in the same breath, so this happens exactly once.
    this.justDied = true;
    this.pendingBurst = false;
    this.phase = 'spent';
  }

  private trampleContacts(targets: Player[], severity = 1): void {
    const centreX = this.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const centreY = this.y + TILE_SIZE * TILE_CENTER_OFFSET;
    const range = TRAMPLE_RANGE_TILES * TILE_SIZE;
    for (const target of targets) {
      if (!target.isAlive || this.trampleCooldowns.has(target)) continue;
      const targetX = target.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const targetY = target.y + TILE_SIZE * TILE_CENTER_OFFSET;
      if (Math.hypot(targetX - centreX, targetY - centreY) > range) continue;

      // Half the victim's own maximum health at a full roll, scaled down by how
      // much momentum it is actually carrying. Brutal, but survivable from full —
      // the previous fight dealt 9999 here, which is a coin flip rather than a hit.
      //
      // Dealt directly rather than through `dealDamage`, which would put it through
      // the mob-level multiplier as well. It is already relative to the victim, and
      // stacking level scaling on that makes one pass an outright kill.
      // Momentum sets it while rolling; a wallowing ball has none left, so its thrash
      // is priced off `severity` instead.
      const weight = this.phase === 'wallowing' ? severity : this.momentum * severity;
      const damage = Math.ceil(target.maxHp * TRAMPLE_HP_FRACTION * weight) + TRAMPLE_FLAT_DAMAGE;
      // `targets` is not only the two crawlers: `MobUpdateLoop` folds in the scene's
      // extra targets and anything this boss is retaliating against, so a shed
      // Tuskling can end up under its own parent. A `Mob` flattened by plain
      // `takeDamage` drops to zero HP without `justDied`, and the kill resolver then
      // skips it — no XP, no loot, no gore, and it never leaves the mob grid.
      if (target instanceof Mob) target.takeDamageFrom(damage, this, 'melee');
      else target.takeDamage(damage, trampleDamageSource(this.mobType));
      this.attackSoundPending = true;
      this.trampleCooldowns.set(target, TRAMPLE_COOLDOWN);
    }
  }

  private tickShedding(hasTarget: boolean): void {
    if (!this.isShedding || !hasTarget) return;
    this.shedTimer--;
    if (this.shedTimer > 0) return;
    this.shedTimer = SHED_INTERVAL_FRAMES;
    this.pendingSheds++;
  }

  /**
   * Applies a stench burst to one target. Called by the arena system, which owns
   * the burst once the ball has queued it.
   */
  applyStenchTo(target: Player): void {
    target.takeDamage(STENCH_DAMAGE, stenchDamageSource(this.mobType));
    target.applyStatus(makePoison());
  }

  /** Only notices crawlers who are inside, or right outside, the arena. */
  private nearestInArena(targets: Player[]): Player | null {
    const aggroRange = this.arenaInteriorPx + TILE_SIZE * ARENA_AGGRO_EXTEND_TILES;
    let best: Player | null = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const fromArena = Math.hypot(
        target.x + TILE_SIZE * TILE_CENTER_OFFSET - this.arenaCentrePx.x,
        target.y + TILE_SIZE * TILE_CENTER_OFFSET - this.arenaCentrePx.y,
      );
      if (fromArena > aggroRange) continue;
      const distance = Math.hypot(target.x - this.x, target.y - this.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = target;
      }
    }
    return best;
  }

  private faceHeading(): void {
    this.facingX = Math.cos(this.heading);
    this.facingY = Math.sin(this.heading);
  }

  private poseFor(): BallOfSwinePose {
    switch (this.phase) {
      case 'rolling':
        return 'roll';
      case 'slamming':
        return 'slam';
      case 'wallowing':
        return 'wallow';
      case 'spinning_up':
        return 'spinup';
      case 'bursting':
      case 'spent':
        return 'burst';
    }
  }

  private drawStateFor(): BallOfSwineDraw {
    return {
      pose: this.poseFor(),
      rollPhase: this.rollPhase,
      heading: this.phase === 'slamming' ? this.slamHeading : this.heading,
      progress: this.oneShotProgress(),
      wallowPhase: this.wallowElapsedFraction * WALLOW_HEAVE_CYCLES,
    };
  }

  /**
   * How far through a one-shot pose the ball is.
   *
   * Zero for the two looping phases, which read their own frame off the roll
   * distance and the wallow window instead. Written out rather than defaulted so
   * that adding a phase is a compile error here, not a pose frozen on frame zero.
   */
  private oneShotProgress(): number {
    switch (this.phase) {
      case 'slamming':
        return 1 - this.slamTimer / BOS_SLAM_GAME_FRAMES;
      case 'spinning_up':
        return 1 - this.spinupTimer / BOS_SPINUP_GAME_FRAMES;
      case 'bursting':
        return 1 - this.burstTimer / BOS_BURST_GAME_FRAMES;
      case 'rolling':
      case 'wallowing':
      case 'spent':
        return 0;
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

    this.drawTrack(ctx, camX, camY, tileSize);
    this.drawStenchRing(ctx, sx, sy, tileSize);
    this.drawLungeTell(ctx, sx, sy, tileSize);

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';
    drawBallOfSwineSprite(ctx, sx, sy, tileSize, this.drawStateFor());
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    // Lifted by the body's own radius: both of these are anchored to the tile, and
    // the tile is buried in the middle of a sprite nearly three tiles wide.
    const aboveBody = sy - BOS_BODY_RADIUS_TILES * tileSize;
    if (this.phase === 'wallowing') {
      drawBallOfSwineStoppedWarning(ctx, sx, aboveBody, tileSize, this.wallowElapsedFraction);
    }

    this.renderMobHealthBar(ctx, sx, aboveBody);
  }
}
