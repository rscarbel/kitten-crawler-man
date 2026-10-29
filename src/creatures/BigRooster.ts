import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob, type PlayerDamageType } from './Mob';
import { SoundCueQueue, type RoosterSoundCue } from './creatureSoundCues';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import { pickLine } from '../dialog/line';
import { BIG_ROOSTER_LINES } from '../dialog/scripts/bigRooster';
import { drawDangerCircle, drawDangerCone } from '../sprites/dangerTelegraph';
import { drawSpeechBubbleWithText } from '../sprites/speechBubble';
import {
  drawRoosterSprite,
  prewarmRoosterRow,
  ROOSTER_BODY_PART_KEYS,
  ROOSTER_GORE_PARTS,
  RoosterAnimationClock,
  roosterArtMarginTiles,
  roosterEyePlacement,
  type RoosterRowBase,
} from '../sprites/roosterSprite';
import { BIG_ROOSTER_FIGURE } from '../sprites/art/roosterFigure';
import { prewarmFigureState } from '../sprites/figure/figureFrameCache';
import { drawGymPlateSprite } from '../sprites/gymRoomSprites';
import {
  BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
  BIG_ROOSTER_CLUB_SWING_RECOVER_FRAMES,
  BIG_ROOSTER_CLUB_SWING_WINDUP_FRAMES,
  BIG_ROOSTER_CROW_FRAMES,
  BIG_ROOSTER_PICKUP_FRAMES,
  BIG_ROOSTER_PICKUP_GRAB_PROGRESS,
  BIG_ROOSTER_SLAM_IMPACT_PROGRESS,
  BIG_ROOSTER_THROW_RELEASE_FRAME,
  BIG_ROOSTER_SLAM_RECOVER_FRAMES,
  BIG_ROOSTER_SLAM_WINDUP_FRAMES,
  BIG_ROOSTER_THROW_WINDUP_FRAMES,
  bigRoosterThrowProgressAt,
  roosterActionFrames,
  splitAtImpactProgress,
} from '../sprites/bigRoosterAttackTiming';
import { roosterIdleOffsetSeconds } from './roosterIdleOffset';
import {
  ROOSTER_STRIKE_MAX_REACH_TILES,
  RoosterStrikes,
  type RoosterStrikeBody,
  type RoosterStrikeKind,
} from './roosterStrikes';
import { kickExplosive, liveExplosives } from './explosiveAwareness';
import {
  DYNAMITE_KICK_CONTACT_TILES,
  DYNAMITE_KICK_COOLDOWN_FRAMES,
  DYNAMITE_SEEK_GIVE_UP_FRAMES,
  RoosterKickMotion,
  dynamiteKickVelocity,
  stickNow,
  stickToKick,
  type KickableStick,
  type RoosterFlockView,
} from './roosterKicks';
import type { LiveStickId } from '../systems/ExplosiveSource';

const BIG_ROOSTER_HP = 360;
/** His walking speed at level 1, in pixels per frame. */
export const BIG_ROOSTER_SPEED = 1.0;
const BIG_ROOSTER_SPEED_ENRAGED = 1.7;
const AGGRO_RANGE_TILE_MULTIPLIER = 10;
const AGGRO_RANGE_PX = TILE_SIZE * AGGRO_RANGE_TILE_MULTIPLIER;
export const THROW_RANGE_MIN_TILES = 4;
const THROW_RANGE_MIN = TILE_SIZE * THROW_RANGE_MIN_TILES;
export const THROW_RANGE_MAX_TILES = 9;
const THROW_RANGE_MAX = TILE_SIZE * THROW_RANGE_MAX_TILES;
/** How fast a thrown dumbbell flies, in px per frame. */
export const THROW_SPEED = 7;
const THROW_DAMAGE = 3;
const THROW_COOLDOWN_FRAMES = 65;
const PROJECTILE_TTL = 240;
const THROW_BOUNCE_DAMPING = 0.7;
export const ENRAGE_THRESHOLD = 0.4;
const TAUNT_INTERVAL = 300;
/**
 * Frames without attacking after which he stops holding off at range and
 * closes in on a target in the throw band he has no line on.
 */
const FORCE_ATTACK_FRAMES = 300;
const COIN_DROP_MIN = 60;
const COIN_DROP_MAX = 120;
const MASS = 10;
const XP_VALUE = 600;
/** How near a rack front he has to be to bend and take its dumbbell, in tiles. */
export const DUMBBELL_PICKUP_RANGE_TILES = 1.2;
const DUMBBELL_FOLLOW_STOP_RANGE_RATIO = 0.8;
const DUMBBELL_SEEK_PATHFIND_MAX = 40;
const NO_DUMBBELL_SPEED_RATIO = 0.7;
const NO_DUMBBELL_PATHFIND_MAX = 40;
const THROW_RANGE_FORCE_ATTACK_RATIO = 0.85;
const THROW_PATHFIND_MAX = 40;
const CENTER_OFFSET = 0.5;
const HIT_RADIUS_TILES = 1.5;
const BIG_ROOSTER_ART_MARGIN_TILES = roosterArtMarginTiles('big');
const BLOCK_XP = 5;
/** A back-off step that covers less than this share of his stride counts as blocked. */
const BACK_OFF_BLOCKED_SHARE = 0.25;
/** Frames a pinned back-off keeps sliding along the wall before trying straight back again. */
const BACK_OFF_SLIDE_FRAMES = 20;
/** Headings tried when a back-off is pinned: the eight compass points. */
const ESCAPE_HEADINGS = 8;
/** How far ahead of his centre a pinned escape checks for floor, in tiles. */
const ESCAPE_LOOKAHEAD_TILES = 0.8;

/**
 * How much faster than his walk he covers ground on the way to a dumbbell.
 *
 * Derived from {@link Mob.moveSpeed} every frame rather than assigned to
 * `this.speed`: `applyMobLevel` multiplies speed in place, so a stored override
 * would throw the level scaling away the moment it was written back.
 */
export const BIG_ROOSTER_SPRINT_SPEED_MULTIPLIER = 1.8;
/** Inside this he drops back to a walk, so the pickup is not overshot. */
const SPRINT_MIN_DISTANCE_TILES = 2;

/** How close a target has to be before he answers with the floor slam. */
const SLAM_TRIGGER_TILES = 1.7;
/** How far in front of himself his fists come down, in tiles. */
export const SLAM_REACH_TILES = 1.1;
/** Radius of the impact disc, and of the circle painted on the floor. */
export const SLAM_RADIUS_TILES = 1.8;
const SLAM_COOLDOWN_FRAMES = 360;
const SLAM_COOLDOWN_ENRAGED_FRAMES = 240;
const SLAM_DAMAGE = 4;
const SLAM_KNOCKBACK_TILES = 2.2;
const SLAM_KNOCKBACK_FRAMES = 14;
/** Frames the wave takes to travel from his fists out to {@link SLAM_RADIUS_TILES}. */
const SLAM_SHOCKWAVE_FRAMES = 20;
/** Recorded on slam damage so `DeathCauseSystem` can tell it apart from a thrown dumbbell. */
export const SLAM_ATTACK_TYPE = 'ground_slam';

/** Centre to centre, how far the swung dumbbell reaches, in tiles. */
export const CLUB_REACH_TILES = 2;
/** The whole sweep of the swing in front of him, centred on his locked facing. */
const CLUB_ARC_DEGREES = 120;
const DEGREES_PER_HALF_TURN = 180;
export const CLUB_ARC_HALF_ANGLE_RAD = ((CLUB_ARC_DEGREES / 2) * Math.PI) / DEGREES_PER_HALF_TURN;
/** The arc's half-angle as a dot-product floor against the locked aim. */
const CLUB_ARC_MIN_DOT = Math.cos(CLUB_ARC_HALF_ANGLE_RAD);
/**
 * Frames from raising the dumbbell high behind his shoulder to the front of
 * the arc. The aim is fixed on the first of them and the cone is painted on
 * the floor for all of them.
 */
const CLUB_SWING_WINDUP_FRAMES = BIG_ROOSTER_CLUB_SWING_WINDUP_FRAMES;
/** Frames of follow-through after the swing before he can act again. */
const CLUB_SWING_RECOVER_FRAMES = BIG_ROOSTER_CLUB_SWING_RECOVER_FRAMES;
const CLUB_SWING_COOLDOWN_FRAMES = 75;
const CLUB_DAMAGE = SLAM_DAMAGE;
const CLUB_KNOCKBACK_TILES = 1.6;
const CLUB_KNOCKBACK_FRAMES = 12;
/** Recorded on a club hit so `DeathCauseSystem` can name it. */
export const CLUB_ATTACK_TYPE = 'dumbbell_club';
/** Between club reach and the throw band he walks in to this share of club reach. */
const CLUB_APPROACH_STOP_RATIO = 0.8;
const CLUB_APPROACH_PATHFIND_MAX = 40;
/** Without a dumbbell he walks in to this share of his longest unarmed reach. */
const STRIKE_APPROACH_STOP_RATIO = 0.85;
/** Of an unarmed blow he chooses, the share that are pecks rather than punches. */
const PECK_SHARE = 0.5;
/** The one blow that leaves both hands on a held dumbbell. */
const ARMED_STRIKES: readonly RoosterStrikeKind[] = ['peck'];

/**
 * Hit-flash lengths. Every one of his blows is a heavy one and flashes for
 * longer than an ordinary swing would.
 */
const DAMAGE_FLASH_SLAM = 12;
const DAMAGE_FLASH_DUMBBELL = 12;
const DAMAGE_FLASH_CLUB = 12;
/** How far a dumbbell shoves what it hits, and over how many frames. */
const DUMBBELL_KNOCKBACK_TILES = 1.4;
const DUMBBELL_KNOCKBACK_FRAMES = 10;

/** Game frames of bending to the rack, closing his hand on the dumbbell and rising. */
const PICKUP_FRAMES = roosterActionFrames(BIG_ROOSTER_PICKUP_FRAMES);
const PICKUP_GRAB_FRAME = Math.max(1, Math.round(PICKUP_FRAMES * BIG_ROOSTER_PICKUP_GRAB_PROGRESS));
/** Game frames of the crow that opens his fight and marks his enrage. */
const CROW_FRAMES = roosterActionFrames(BIG_ROOSTER_CROW_FRAMES);

/** Recorded on a bowled plate's damage so `DeathCauseSystem` can name it. */
export const PLATE_ROLL_ATTACK_TYPE = 'plate_roll';
/** A bowled plate hurts exactly as much as a thrown dumbbell. */
const PLATE_ROLL_DAMAGE = THROW_DAMAGE;
/**
 * How fast the plate rolls, in px per frame. Slower than a thrown dumbbell and
 * never level-scaled: it is a heavy thing on the floor, and its lane is painted
 * in chalk for the whole wind-up.
 */
export const PLATE_ROLL_SPEED = 4.5;
/** Reach of the plate's edge from its centre, in tiles. */
export const PLATE_ROLL_HIT_RADIUS_TILES = 0.7;
/** The plate roll only comes out when his target stands this far off, in tiles. */
const PLATE_ROLL_MIN_RANGE_TILES = 5;
const PLATE_ROLL_MAX_RANGE_TILES = 10;
/** Centre to centre, how near a loaded squat rack he has to be to rip a plate off it. */
const PLATE_ROLL_RACK_REACH_TILES = 1.5;
export const PLATE_ROLL_COOLDOWN_FRAMES = 480;
/**
 * The shortest his plate cooldown ever gets, whatever his level. A floor of its
 * own because the shared cooldown curve would let a high-level Big Rooster bowl
 * every few seconds, and a plate lane closes off a whole stripe of the room.
 */
const PLATE_ROLL_MIN_COOLDOWN_FRAMES = 360;
/** Longest a lane is ever planned, in tiles, so a rolling plate always ends. */
const PLATE_ROLL_MAX_TILES = 30;
/** Walls a plate bounces off before it topples. */
const PLATE_ROLL_BOUNCES = 1;
/** Frames of recovery after the plate leaves his hands. */
const PLATE_ROLL_RECOVER_FRAMES = THROW_COOLDOWN_FRAMES;
const PLATE_KNOCKBACK_TILES = 1.4;
const PLATE_KNOCKBACK_FRAMES = 10;
/** How high above his tile the plate is held while he winds up, in tiles. */
const PLATE_HELD_LIFT_TILES = 0.9;

/**
 * Which stretch of his fight he is in. Each only ever gives way to the next,
 * in {@link BigRooster.advancePhase}:
 * - `normal`: the fight he opens with.
 * - `kettlebell_unlocked`: a third of his health gone or a bird of his flock
 *   down; the kettlebell rain comes round every {@link KETTLEBELL_RAIN_COOLDOWN_FRAMES}.
 * - `fury`: two thirds gone or the whole flock down; he is untouchable, rains
 *   kettlebells and kicks every exercise ball loose.
 * - `post_fury`: every ball rolling; he can be hurt again and has everything.
 */
export type RoosterPhase = 'normal' | 'kettlebell_unlocked' | 'fury' | 'post_fury';

/** His health is split into this many equal stretches, each ending in a phase change. */
const HEALTH_STRETCHES = 3;
/** His health share at or under which the kettlebell rain unlocks: a third gone. */
const KETTLEBELL_UNLOCK_HP_SHARE = 2 / HEALTH_STRETCHES;
/** His health share at or under which he goes into his fury: two thirds gone. */
export const FURY_HP_SHARE = 1 / HEALTH_STRETCHES;
/** Frames between one kettlebell heave and the next he may start. */
const KETTLEBELL_RAIN_COOLDOWN_FRAMES = 1200;
/** What a kettlebell does to the crawler it lands on. Level-scaled like his other blows. */
const KETTLEBELL_DAMAGE = 5;
/** The share of a kettlebell's blow the AI-driven companion takes. */
export const COMPANION_KETTLEBELL_DAMAGE_SHARE = 0.25;
/** Recorded on a kettlebell's damage so `DeathCauseSystem` can name it. */
export const KETTLEBELL_ATTACK_TYPE = 'kettlebell_rain';
/** What a rolling exercise ball does to the crawler it hits: a heavy blow. */
const EXERCISE_BALL_DAMAGE = 8;
/** Recorded on an exercise ball's damage so `DeathCauseSystem` can name it. */
export const EXERCISE_BALL_ATTACK_TYPE = 'exercise_ball';
const EXERCISE_BALL_KNOCKBACK_TILES = 2;
const EXERCISE_BALL_KNOCKBACK_FRAMES = 12;
/** How near him a crawler may come during his fury before he sweeps the party back, in tiles. */
const FURY_SHOVE_RADIUS_TILES = 2.2;
const FURY_SHOVE_KNOCKBACK_TILES = 3;
const FURY_SHOVE_KNOCKBACK_FRAMES = 16;
/** Frames after a sweep before he sweeps again. */
const FURY_SHOVE_COOLDOWN_FRAMES = 40;
/** Centre to centre, how near an exercise ball he has to stand to kick it, in tiles. */
const BALL_KICK_REACH_TILES = 1.3;
/** Each ball leaves his foot this far either side of the line to his target, at most, in radians. */
const BALL_KICK_SPREAD_RAD = 0.35;
/** Frames he walks to a rack or a ball he cannot reach before he gives up and does it where he stands. */
const FURY_SEEK_GIVE_UP_FRAMES = 300;
/** Centres `Math.random()` on zero so a kick's spread swings both ways. */
const RANDOM_MIDPOINT = 0.5;

/** A straight lane with at most one bounce, as world-pixel points from his hands to where it stops. */
export type PlateLane = ReadonlyArray<{ readonly x: number; readonly y: number }>;

interface RollingPlate {
  /** Index of the lane segment it is on. */
  segment: number;
  /** Pixels along that segment. */
  along: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export type BigRoosterState =
  | 'idle'
  | 'crow'
  | 'seeking_dumbbell'
  | 'pickup'
  | 'pursuing'
  | 'winding_up'
  | 'cooldown'
  | 'slam_windup'
  | 'slam_recover'
  | 'club_windup'
  | 'club_recover'
  | 'strike'
  | 'plate_windup'
  | 'heave_seek'
  | 'heave_lift'
  | 'heave_toss'
  | 'ball_seek'
  | 'ball_kick'
  | 'dynamite_seek'
  | 'dynamite_kick';

/** States he can be pulled out of to crow, slam or bowl: none of them has committed to a blow. */
const INTERRUPTIBLE_STATES: ReadonlySet<BigRoosterState> = new Set<BigRoosterState>([
  'idle',
  'seeking_dumbbell',
  'pursuing',
  'cooldown',
]);

/** Where the slam landed and how far its wave has travelled. */
interface SlamShockwaveMarker {
  readonly x: number;
  readonly y: number;
  /** 0 on the frame the fists land, 1 when the front reaches the slam radius. */
  readonly progress: number;
  /** Where the front stops — the same radius the blow damaged. */
  readonly radiusPx: number;
  /** Stable per-wave noise seed, so the chalk does not crawl frame to frame. */
  readonly seed: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  /** Frames in flight. Drives the spin, which a wall clock cannot do honestly. */
  age: number;
}

/**
 * Rows warmed as each becomes imminent rather than all at once. His cells
 * take milliseconds each to paint, and every row he has, in every view, is
 * several times the cache's ceiling for one figure: warming them together
 * would evict the rows warmed first before any of them was drawn. So each
 * phase of the fight warms the rows the next phase opens with, and each blow
 * warms its own row in every view as its wind-up starts, since a wind-up is
 * long enough for the player to walk round him.
 */
function prewarmBigRoosterRows(bases: readonly RoosterRowBase[]): void {
  for (const base of bases) prewarmRoosterRow('big', base);
}

/** The rows he stands and walks in, warmed when his spawn is scheduled. */
export function prewarmBigRoosterArrival(): void {
  prewarmBigRoosterRows(['idle', 'walk']);
}

/**
 * The crow, the run to a rack that follows it, and the empty-handed blows he
 * can open with straight after: he starts every fight without a dumbbell.
 */
const CROW_ROWS: readonly RoosterRowBase[] = ['crow', 'sprint', 'pickup', 'slam', 'peck', 'punch'];
/** His empty-handed blows, warmed the moment the weight leaves his fist. */
const EMPTY_HANDED_ROWS: readonly RoosterRowBase[] = ['slam', 'peck', 'punch'];
/** The walk to a kettlebell rack, the bend to it and the heave overhead. */
const HEAVE_ROWS: readonly RoosterRowBase[] = ['sprint', 'pickup', 'throw'];
/** The bend to a rack, and what he does with the dumbbell once it is in his fist. */
const PICKUP_ROWS: readonly RoosterRowBase[] = ['pickup', 'carry_walk', 'club_swing', 'throw'];

const BIG_ROOSTER_EYES: EyePlacement = roosterEyePlacement('big');

/** What a blow on him during his fury says over his head. */
const IMMUNE_LABEL = 'IMMUNE';
/** Frames one "IMMUNE" stays up before another is shown, so a flurry does not stack a column. */
const IMMUNE_LABEL_THROTTLE_FRAMES = 30;

function assertNeverState(state: never): never {
  throw new Error(`unhandled Big Rooster state ${JSON.stringify(state)}`);
}

function assertNeverPhase(phase: never): never {
  throw new Error(`unhandled rooster phase ${JSON.stringify(phase)}`);
}

/** His taunt, over the top of his art: `artTopY` is the highest pixel he painted. */
function drawBigRoosterTaunt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTopY: number,
  tileSize: number,
  text: string,
): void {
  const anchorX = sx + tileSize * CENTER_OFFSET;
  drawSpeechBubbleWithText(ctx, anchorX, artTopY, tileSize, text);
}

export class BigRooster extends Mob {
  protected override get eyePlacement(): EyePlacement {
    return BIG_ROOSTER_EYES;
  }

  override readonly audioTag = 'big_rooster';
  override get bodyPartKey(): string {
    return ROOSTER_BODY_PART_KEYS.big;
  }
  readonly xpValue = XP_VALUE;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Big Rooster';
  description = 'Cock of the walk. Clubs you with a dumbbell up close and throws it from afar.';
  mass = MASS;

  isEnraged = false;

  private state: BigRoosterState = 'idle';
  private windupTimer = 0;
  private cooldownTimer = 0;
  private framesSinceLastAttack = 0;
  /** True once the dumbbell has left his hands but the row is still playing. */
  private throwReleased = false;

  /** Sprinting to a dumbbell, at {@link sprintSpeed}. */
  private isSprinting = false;

  private slamTimer = 0;
  private slamCooldownTimer = 0;
  /**
   * Where the fists will land, in world pixels, chosen when the wind-up begins
   * and never revised. Null outside a slam.
   */
  private slamPoint: { x: number; y: number } | null = null;
  /** Frames left of the shockwave's travel; zero when no wave is running. */
  private shockwaveTimer = 0;
  /** Keeps the wave's chalk and debris from crawling between frames. */
  private shockwaveSeed = 0;

  /** Raised on the frame his fists land; the scene plays the cue. */
  slamImpactSoundPending = false;

  private clubTimer = 0;
  private clubCooldownTimer = 0;
  /** The swing's aim as a unit vector, fixed when the dumbbell goes up. Null outside a swing. */
  private clubAim: { x: number; y: number } | null = null;

  /** Peck and punch, shared with the whole flock. */
  private readonly strikes = new RoosterStrikes();
  private readonly soundCues = new SoundCueQueue<RoosterSoundCue>();

  private pickupTimer = 0;
  /** The rack spot he bent down to, fixed when the pickup starts. */
  private pickupAt: { x: number; y: number } | null = null;

  private crowTimer = 0;
  /** Whether this fight has had its opening crow. */
  private hasCrowed = false;
  /** Set on the frame he enrages; the crow plays the moment he is free to. */
  private enrageCrowPending = false;

  heldDumbbell = false;

  private phase: RoosterPhase = 'normal';
  /** Frames until he may heave another kettlebell rain; zero once one is due. */
  private kettlebellCooldownTimer = 0;
  /** Whether his fury's own rain has gone up yet. */
  private furyRainThrown = false;
  private furyShoveCooldown = 0;
  /** Frames spent walking to the rack or ball he is after, so a blocked walk gives up. */
  private seekFrames = 0;
  /** The ball he is walking to or kicking, by the gym's index. */
  private ballTarget: number | null = null;
  /** The stick he is walking to or kicking. */
  private stickTarget: LiveStickId | null = null;
  private dynamiteKickCooldown = 0;
  private readonly kick = new RoosterKickMotion();
  /** Frames through a heave's lift or toss. */
  private heaveTimer = 0;
  private heaveReleased = false;

  /** Where each kettlebell rack is lifted from, as a mob's top-left; set each frame by the gym. */
  kettlebellRackStands: ReadonlyArray<{ readonly x: number; readonly y: number }> = [];
  /** The exercise balls still resting, with their centres; set each frame by the gym. */
  restingExerciseBalls: ReadonlyArray<{
    readonly index: number;
    readonly x: number;
    readonly y: number;
  }> = [];
  /** How many of his flock the gym has seen, and how many of those are down; set each frame by the gym. */
  flockLosses: { readonly known: number; readonly lost: number } = { known: 0, lost: 0 };
  /** The gym as every rooster sees it, or null outside the gym; set each frame by the gym. */
  flockView: RoosterFlockView | null = null;
  /** Set when a heave lets go: where, for the gym to start the rain from that rack. Cleared by the gym. */
  heaveRequest: { readonly x: number; readonly y: number } | null = null;
  /** Set when his boot meets a ball: which, and which way it goes. Cleared by the gym. */
  ballKickRequest: { readonly index: number; readonly dx: number; readonly dy: number } | null =
    null;

  private readonly animationClock: RoosterAnimationClock;
  /**
   * How far his drawn art stands over his tile, in tiles, read off the row he
   * was last drawn in. Zero until his first draw, which comes before any label
   * is hung over him.
   */
  private artClearanceTiles = 0;
  /** Set to signal GymRoomSystem to consume a nearby dumbbell pickup. */
  requestDumbbellAt: { x: number; y: number } | null = null;
  /** Target position for the nearest dumbbell (set each frame by GymRoomSystem). */
  nearestDumbbellPos: { x: number; y: number } | null = null;

  /** Active thrown projectile (null if not in flight). */
  private activeThrow: Projectile | null = null;
  /** Where the throw under way will fly, in world pixels, fixed when it begins. Null outside a throw. */
  private throwAimPoint: { x: number; y: number } | null = null;

  override clearAirborneAttacks(): void {
    this.activeThrow = null;
    this.rollingPlate = null;
    this.plateLane = null;
  }

  /**
   * World centres of the squat racks with plates on them, set each frame by the
   * gym. Empty everywhere but the gym, so the plate roll never happens anywhere else.
   */
  loadedSquatRacks: ReadonlyArray<{ readonly x: number; readonly y: number }> = [];
  /** The rack he just ripped a plate off, for the gym to strip; the gym clears it. */
  plateTakenFrom: { x: number; y: number } | null = null;
  /**
   * The room he is held in, in tiles, set by the gym. His escape from a pin
   * never picks a heading out through a doorway the room's clamp would undo.
   */
  confinedTo: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null = null;
  /** False once the gym's boombox is smashed; his taunts change to suit. */
  musicPlaying = true;
  private plateCooldownTimer = 0;
  /** Counts `updateAI` calls, so a back-off can tell whether it also backed off last frame. */
  private aiTick = 0;
  private lastBackOff: { x: number; y: number; tick: number } | null = null;
  /** The way out he chose when last pinned: kept for a stretch so he does not dither. */
  private backOffHeading: { x: number; y: number } | null = null;
  private backOffSlideFrames = 0;
  private plateWindupTimer = 0;
  private plateReleased = false;
  private plateLane: PlateLane | null = null;
  private rollingPlate: RollingPlate | null = null;

  /** 0–1 through the throw row, for the sprite; 0 outside a throw. */
  throwAnim = 0;

  private tauntIndex = 0;
  private tauntsHadMusic = true;
  private tauntTimer = 0;
  currentTaunt: string | null = null;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, BIG_ROOSTER_HP, BIG_ROOSTER_SPEED);
    this.isBoss = true;
    this.animationClock = new RoosterAnimationClock(
      'big',
      this.x,
      this.y,
      roosterIdleOffsetSeconds(tileX, tileY),
    );
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
    this.setBaseSpeed(BIG_ROOSTER_SPEED);
    this.state = 'idle';
    this.windupTimer = 0;
    this.cooldownTimer = 0;
    this.framesSinceLastAttack = 0;
    this.heldDumbbell = false;
    this.requestDumbbellAt = null;
    this.nearestDumbbellPos = null;
    this.activeThrow = null;
    this.throwAimPoint = null;
    this.throwAnim = 0;
    this.throwReleased = false;
    this.isSprinting = false;
    this.slamTimer = 0;
    this.slamCooldownTimer = 0;
    this.slamPoint = null;
    this.shockwaveTimer = 0;
    this.slamImpactSoundPending = false;
    this.clubTimer = 0;
    this.clubCooldownTimer = 0;
    this.clubAim = null;
    this.strikes.reset();
    this.pickupTimer = 0;
    this.pickupAt = null;
    this.crowTimer = 0;
    this.hasCrowed = false;
    this.enrageCrowPending = false;
    this.soundCues.clear();
    this.tauntTimer = 0;
    this.currentTaunt = null;
    this.plateCooldownTimer = 0;
    this.plateWindupTimer = 0;
    this.lastBackOff = null;
    this.backOffHeading = null;
    this.backOffSlideFrames = 0;
    this.plateReleased = false;
    this.plateLane = null;
    this.rollingPlate = null;
    this.plateTakenFrom = null;
    this.phase = 'normal';
    this.kettlebellCooldownTimer = 0;
    this.furyRainThrown = false;
    this.furyShoveCooldown = 0;
    this.seekFrames = 0;
    this.ballTarget = null;
    this.stickTarget = null;
    this.dynamiteKickCooldown = 0;
    this.kick.reset();
    this.heaveTimer = 0;
    this.heaveReleased = false;
    this.heaveRequest = null;
    this.ballKickRequest = null;
  }

  /** Which stretch of his fight he is in. */
  get roosterPhase(): RoosterPhase {
    return this.phase;
  }

  /** Untouchable for the whole of his fury, until every exercise ball is rolling. */
  protected override get isDamageImmune(): boolean {
    return this.phase === 'fury';
  }

  protected override onDamageBlocked(): void {
    this.queueFloatingText(IMMUNE_LABEL, 'immune', {
      throttleFrames: IMMUNE_LABEL_THROTTLE_FRAMES,
    });
  }

  /**
   * Every phase change in the fight, and the only place one happens: each
   * stretch gives way to the next as his health falls or his flock goes down,
   * and a big enough blow can carry him through two at once.
   */
  private advancePhase(): void {
    const hpShare = this.hp / this.maxHp;
    const { known, lost } = this.flockLosses;
    for (;;) {
      const next = this.nextPhase(hpShare, known > 0 && lost >= 1, known > 0 && lost >= known);
      if (next === this.phase) return;
      this.enterPhase(next);
    }
  }

  private nextPhase(hpShare: number, flockHit: boolean, flockGone: boolean): RoosterPhase {
    switch (this.phase) {
      case 'normal':
        return hpShare <= KETTLEBELL_UNLOCK_HP_SHARE || flockHit ? 'kettlebell_unlocked' : 'normal';
      case 'kettlebell_unlocked':
        return hpShare <= FURY_HP_SHARE || flockGone ? 'fury' : 'kettlebell_unlocked';
      case 'fury':
        return this.furyRainThrown && this.restingExerciseBalls.length === 0 ? 'post_fury' : 'fury';
      case 'post_fury':
        return 'post_fury';
      default:
        return assertNeverPhase(this.phase);
    }
  }

  private enterPhase(next: RoosterPhase): void {
    this.phase = next;
    switch (next) {
      case 'normal':
        return;
      case 'kettlebell_unlocked':
        this.kettlebellCooldownTimer = 0;
        return;
      case 'fury':
        this.furyRainThrown = false;
        this.enrageCrowPending = true;
        this.soundCues.raise('ruffle');
        return;
      case 'post_fury':
        this.kettlebellCooldownTimer = this.scaledCooldownFrames(KETTLEBELL_RAIN_COOLDOWN_FRAMES);
        return;
      default:
        assertNeverPhase(next);
    }
  }

  /**
   * The chalk lane of a plate roll, from the first frame of the wind-up until
   * the plate stops. Fixed when the wind-up starts and never revised, so the
   * line on the floor is exactly where the plate will run.
   */
  get plateRollLane(): PlateLane | null {
    // His AI stops running when he dies, so a plate in flight would never
    // finish: its lane must not outlive him as ground nobody may cross.
    return this.isAlive ? this.plateLane : null;
  }

  /** The plate on the floor, centre and velocity in world pixels, or null. */
  get bowledPlate(): {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly age: number;
  } | null {
    return this.isAlive ? this.rollingPlate : null;
  }

  /**
   * Where his last slam landed and how far its wave has run, or null when no
   * wave is travelling. Read by `GymRoomSystem`, which paints it into the
   * ground pass: drawn from `drawSelf` the wave would be clipped to his own
   * silhouette composite, and it is nearly four tiles across.
   */
  get slamShockwave(): SlamShockwaveMarker | null {
    if (this.shockwaveTimer <= 0 || !this.isAlive) return null;
    const point = this.slamPoint;
    if (point === null) return null;
    return {
      x: point.x,
      y: point.y,
      // `shockwaveTimer - 1` over `SLAM_SHOCKWAVE_FRAMES - 1` so the wave
      // actually reaches progress 1 on its last visible frame, rather than
      // decrementing past it and disappearing while still short of the
      // radius it is meant to sweep to.
      progress: 1 - (this.shockwaveTimer - 1) / (SLAM_SHOCKWAVE_FRAMES - 1),
      radiusPx: this.tileSize * SLAM_RADIUS_TILES,
      seed: this.shockwaveSeed,
    };
  }

  /** Which step of his fight he is on — read by the room and by headless fight sims. */
  get behaviour(): BigRoosterState {
    return this.state;
  }

  /** Which unarmed blow he is winding up and the aim it locked, or null outside one. */
  get strikeWindupAim(): {
    readonly kind: RoosterStrikeKind;
    readonly x: number;
    readonly y: number;
  } | null {
    return this.strikes.windupAim;
  }

  /**
   * The slam disc while he is rearing back, or null outside a wind-up.
   * The point is the one the fists will land on, fixed when the wind-up began.
   */
  get slamTelegraph(): {
    readonly x: number;
    readonly y: number;
    readonly radiusPx: number;
    readonly framesLeft: number;
  } | null {
    if (!this.isAlive || this.state !== 'slam_windup') return null;
    const point = this.slamPoint;
    if (point === null) return null;
    return {
      x: point.x,
      y: point.y,
      radiusPx: this.tileSize * SLAM_RADIUS_TILES,
      framesLeft: this.slamTimer,
    };
  }

  /**
   * The club swing's cone while the dumbbell is raised, or null outside a
   * wind-up: his centre, the reach, the locked aim and the arc's half-angle.
   */
  get clubTelegraph(): {
    readonly x: number;
    readonly y: number;
    readonly radiusPx: number;
    readonly aimX: number;
    readonly aimY: number;
    readonly halfAngleRad: number;
    readonly framesLeft: number;
  } | null {
    if (!this.isAlive || this.state !== 'club_windup') return null;
    const aim = this.clubAim;
    if (aim === null) return null;
    return {
      x: this.x + this.tileSize * CENTER_OFFSET,
      y: this.y + this.tileSize * CENTER_OFFSET,
      radiusPx: this.tileSize * CLUB_REACH_TILES,
      aimX: aim.x,
      aimY: aim.y,
      halfAngleRad: CLUB_ARC_HALF_ANGLE_RAD,
      framesLeft: this.clubTimer,
    };
  }

  /** The sounds he asked for since the last call, emptied by the call. */
  takeSoundCues(): readonly RoosterSoundCue[] {
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

  /** The dumbbell in flight — centre and velocity in world pixels, frames flown — or null. */
  get thrownDumbbell(): {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly age: number;
  } | null {
    // A dead boss stops updating, so a throw still in the air would hang frozen
    // while a healer keeps the fight open.
    return this.isAlive ? this.activeThrow : null;
  }

  /** How fast he covers ground sprinting to a dumbbell, at his level. */
  get sprintSpeed(): number {
    return this.moveSpeed * BIG_ROOSTER_SPRINT_SPEED_MULTIPLIER;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.aiTick++;
    this.animationClock.tick(this.x, this.y, this.tileSize, this.isEnraged);
    this.walkFrameSpeed = this.animationClock.walkRadians;
    if (this.animationClock.footfall) this.soundCues.raise('step');

    this.framesSinceLastAttack++;
    // A cooldown, unlike an attack clock, runs whether or not anyone is in
    // range — otherwise a player who backs out of the room freezes it.
    if (this.slamCooldownTimer > 0) this.slamCooldownTimer--;
    if (this.clubCooldownTimer > 0) this.clubCooldownTimer--;
    if (this.shockwaveTimer > 0) this.shockwaveTimer--;
    if (this.kettlebellCooldownTimer > 0) this.kettlebellCooldownTimer--;
    if (this.furyShoveCooldown > 0) this.furyShoveCooldown--;
    if (this.dynamiteKickCooldown > 0) this.dynamiteKickCooldown--;
    this.strikes.update(this.strikeBody(), targets);

    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      // The pieces he comes apart into are drawn all on the one frame he dies,
      // and enraging is the surest warning that frame is coming.
      for (const part of ROOSTER_GORE_PARTS) prewarmFigureState(BIG_ROOSTER_FIGURE, part);
      this.isEnraged = true;
      this.enrageCrowPending = true;
      this.soundCues.raise('ruffle');
      this.setBaseSpeed(BIG_ROOSTER_SPEED_ENRAGED);
    }
    this.advancePhase();
    this.updateFuryShove(targets);

    this.updateProjectile(targets);
    this.updateRollingPlate(targets);
    if (this.plateCooldownTimer > 0) this.plateCooldownTimer--;

    const nearest = this.acquireTarget(targets, AGGRO_RANGE_PX);
    const nearestDist = nearest ? this.distanceTo(nearest) : Infinity;

    this.currentTarget = nearest;
    this.updateTaunt(nearest);

    // Checked ahead of the state machine, so a target that walks into arm's
    // reach is answered with the fists whatever he was doing about the throw.
    const beganAhead = nearest !== null && this.beginAheadOfState(nearest, nearestDist);

    // Decided once, ahead of the state that acts on it, so the speed the follow
    // is given, the row the sprite draws and the phase that row is sampled at
    // are all reading the same answer.
    this.isSprinting = this.shouldSprintToDumbbell();

    // A crow, slam or plate roll begun above has spent this frame starting.
    // Its first tick is next frame, as for a blow begun inside its state, so
    // its wind-up runs exactly the frames its constant says.
    if (!beganAhead) this.runState(targets, nearest, nearestDist);
  }

  /**
   * Starts a crow, a dynamite kick, a slam, a plate roll or a kettlebell heave
   * if one is due this frame; returns whether one began. His fury allows only
   * its crow: the rest of it is a script of its own.
   */
  private beginAheadOfState(nearest: Player, nearestDist: number): boolean {
    if (this.canStartCrow()) {
      this.beginCrow(nearest);
      return true;
    }
    if (this.phase === 'fury') return false;
    const stick = this.stickWorthKicking();
    if (stick !== null) {
      this.beginDynamiteSeek(stick);
      return true;
    }
    if (this.canStartSlam(nearestDist)) {
      this.beginSlam(nearest);
      return true;
    }
    if (this.canStartPlateRoll(nearest, nearestDist)) {
      this.beginPlateRoll(nearest);
      return true;
    }
    if (this.canStartHeave()) {
      this.beginHeaveSeek();
      return true;
    }
    return false;
  }

  private runState(targets: Player[], nearest: Player | null, nearestDist: number): void {
    if (this.phase === 'fury' && INTERRUPTIBLE_STATES.has(this.state)) {
      this.state = this.nextFuryState(nearest);
    }
    switch (this.state) {
      case 'idle':
        this.doIdleState(nearest);
        break;
      case 'crow':
        this.doCrowState(nearest);
        break;
      case 'seeking_dumbbell':
        this.doSeekDumbbellState(nearest, nearestDist);
        break;
      case 'pickup':
        this.doPickupState();
        break;
      case 'pursuing':
        this.doPursuingState(nearest, nearestDist);
        break;
      case 'winding_up':
        this.doWindupState(nearest);
        break;
      case 'cooldown':
        this.doCooldownState(nearest);
        break;
      case 'slam_windup':
        this.doSlamWindupState(targets);
        break;
      case 'slam_recover':
        this.doSlamRecoverState(nearest);
        break;
      case 'club_windup':
        this.doClubWindupState(targets);
        break;
      case 'club_recover':
        this.doClubRecoverState(nearest);
        break;
      case 'strike':
        this.doStrikeState();
        break;
      case 'plate_windup':
        this.doPlateWindupState(nearest);
        break;
      case 'heave_seek':
        this.doHeaveSeekState();
        break;
      case 'heave_lift':
        this.doHeaveLiftState();
        break;
      case 'heave_toss':
        this.doHeaveTossState(nearest);
        break;
      case 'ball_seek':
        this.doBallSeekState(nearest);
        break;
      case 'ball_kick':
        this.doBallKickState(nearest);
        break;
      case 'dynamite_seek':
        this.doDynamiteSeekState(nearest);
        break;
      case 'dynamite_kick':
        this.doDynamiteKickState(nearest);
        break;
      default:
        assertNeverState(this.state);
    }
  }

  // ── Fury ──────────────────────────────────────────────────────────────────

  /**
   * The next step of his fury's script: the crow that announces it, his own
   * rain, then each resting ball in turn. The crow is a step of the script
   * because the script never passes through a state a crow may interrupt.
   */
  private nextFuryState(nearest: Player | null): BigRoosterState {
    this.seekFrames = 0;
    this.ballTarget = null;
    if (this.enrageCrowPending) {
      this.beginCrow(nearest);
      return 'crow';
    }
    if (!this.furyRainThrown) return 'heave_seek';
    if (this.restingExerciseBalls.length > 0) return 'ball_seek';
    return 'idle';
  }

  /**
   * While he is untouchable, any crawler who comes within
   * {@link FURY_SHOVE_RADIUS_TILES} gets the whole party swept back from him.
   */
  private updateFuryShove(targets: Player[]): void {
    if (this.phase !== 'fury' || this.furyShoveCooldown > 0) return;
    const half = this.tileSize * CENTER_OFFSET;
    const cx = this.x + half;
    const cy = this.y + half;
    const reach = this.tileSize * FURY_SHOVE_RADIUS_TILES;
    const crowded = targets.some(
      (target) => target.isAlive && Math.hypot(target.x + half - cx, target.y + half - cy) <= reach,
    );
    if (!crowded) return;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const dx = target.x + half - cx;
      const dy = target.y + half - cy;
      const awayX = dx === 0 && dy === 0 ? this.facingX : dx;
      const awayY = dx === 0 && dy === 0 ? this.facingY : dy;
      target.applyKnockback(
        awayX,
        awayY,
        this.tileSize * FURY_SHOVE_KNOCKBACK_TILES,
        FURY_SHOVE_KNOCKBACK_FRAMES,
      );
    }
    this.furyShoveCooldown = FURY_SHOVE_COOLDOWN_FRAMES;
    this.soundCues.raise('swing');
  }

  // ── Kettlebell rain ───────────────────────────────────────────────────────

  /** Whether a heave is due: unlocked, off cooldown, and free to walk to a rack. */
  private canStartHeave(): boolean {
    if (this.phase !== 'kettlebell_unlocked' && this.phase !== 'post_fury') return false;
    if (this.kettlebellCooldownTimer > 0) return false;
    return INTERRUPTIBLE_STATES.has(this.state);
  }

  private beginHeaveSeek(): void {
    prewarmBigRoosterRows(HEAVE_ROWS);
    this.state = 'heave_seek';
    this.seekFrames = 0;
  }

  /** The nearest rack stand to him, or null in a gym with none. */
  private nearestKettlebellStand(): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (const stand of this.kettlebellRackStands) {
      const distance = Math.hypot(stand.x - this.x, stand.y - this.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { x: stand.x, y: stand.y };
    }
    return best;
  }

  private doHeaveSeekState(): void {
    this.seekFrames++;
    const stand = this.nearestKettlebellStand();
    const arrived =
      stand !== null &&
      Math.hypot(stand.x - this.x, stand.y - this.y) < this.tileSize * DUMBBELL_PICKUP_RANGE_TILES;
    if (stand === null || arrived || this.seekFrames > FURY_SEEK_GIVE_UP_FRAMES) {
      this.state = 'heave_lift';
      this.heaveTimer = 0;
      this.isMoving = false;
      this.clearAStarPath();
      return;
    }
    this.followTargetAStar(
      stand.x,
      stand.y,
      this.sprintSpeed,
      this.tileSize * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
      DUMBBELL_SEEK_PATHFIND_MAX,
    );
  }

  /** Bends to the rack on the pickup's row and timing. */
  private doHeaveLiftState(): void {
    this.isMoving = false;
    this.heaveTimer++;
    if (this.heaveTimer < PICKUP_FRAMES) return;
    this.state = 'heave_toss';
    this.heaveTimer = 0;
    this.heaveReleased = false;
  }

  /**
   * Flings the rack's worth overhead on the throw's row; the rain starts on
   * the throw's release frame, when the drawn arms let go.
   */
  private doHeaveTossState(nearest: Player | null): void {
    this.isMoving = false;
    this.heaveTimer++;
    this.throwAnim = bigRoosterThrowProgressAt(this.heaveTimer);
    if (!this.heaveReleased && this.heaveTimer >= BIG_ROOSTER_THROW_RELEASE_FRAME) {
      this.heaveReleased = true;
      this.heaveRequest = { x: this.x, y: this.y };
      this.soundCues.raise('effort');
      this.framesSinceLastAttack = 0;
      this.kettlebellCooldownTimer = this.scaledCooldownFrames(KETTLEBELL_RAIN_COOLDOWN_FRAMES);
      if (this.phase === 'fury') this.furyRainThrown = true;
    }
    if (this.heaveTimer < BIG_ROOSTER_THROW_WINDUP_FRAMES) return;
    this.throwAnim = 0;
    this.state = this.stateAfterBlow(nearest);
  }

  // ── Exercise balls ────────────────────────────────────────────────────────

  private targetBall(): { index: number; x: number; y: number } | null {
    const current = this.restingExerciseBalls.find((ball) => ball.index === this.ballTarget);
    if (current !== undefined) return current;
    const half = this.tileSize * CENTER_OFFSET;
    let best: { index: number; x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (const ball of this.restingExerciseBalls) {
      const distance = Math.hypot(ball.x - (this.x + half), ball.y - (this.y + half));
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = ball;
    }
    this.ballTarget = best?.index ?? null;
    this.seekFrames = 0;
    return best;
  }

  /** Runs to the nearest resting ball and squares up to kick it. */
  private doBallSeekState(nearest: Player | null): void {
    const ball = this.targetBall();
    if (ball === null) {
      this.state = this.stateAfterBlow(nearest);
      return;
    }
    this.seekFrames++;
    const half = this.tileSize * CENTER_OFFSET;
    const distance = Math.hypot(ball.x - (this.x + half), ball.y - (this.y + half));
    if (
      distance <= this.tileSize * BALL_KICK_REACH_TILES ||
      this.seekFrames > FURY_SEEK_GIVE_UP_FRAMES
    ) {
      this.isMoving = false;
      this.clearAStarPath();
      this.faceToward({ x: ball.x - half, y: ball.y - half });
      this.state = 'ball_kick';
      this.kick.begin();
      this.soundCues.raise('effort');
      return;
    }
    this.followTargetAStar(
      ball.x - half,
      ball.y - half,
      this.sprintSpeed,
      this.tileSize * BALL_KICK_REACH_TILES * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
      DUMBBELL_SEEK_PATHFIND_MAX,
    );
  }

  /** Boots the ball on the kick's impact frame: at his target, give or take a little. */
  private doBallKickState(nearest: Player | null): void {
    this.isMoving = false;
    const step = this.kick.tick();
    if (step === 'impact') {
      const ball = this.restingExerciseBalls.find((resting) => resting.index === this.ballTarget);
      if (ball !== undefined) {
        const aimAt = nearest ?? this;
        const half = this.tileSize * CENTER_OFFSET;
        const baseAngle = Math.atan2(aimAt.y + half - ball.y, aimAt.x + half - ball.x);
        const angle = baseAngle + (Math.random() - RANDOM_MIDPOINT) * 2 * BALL_KICK_SPREAD_RAD;
        this.ballKickRequest = { index: ball.index, dx: Math.cos(angle), dy: Math.sin(angle) };
        this.soundCues.raise('swing');
      }
      this.ballTarget = null;
    }
    if (step === 'done' || step === 'idle') this.state = this.stateAfterBlow(nearest);
  }

  // ── Dynamite ──────────────────────────────────────────────────────────────

  /** A landed stick near him worth walking to, when he is free to and inside the gym. */
  private stickWorthKicking(): KickableStick | null {
    if (this.flockView === null || this.dynamiteKickCooldown > 0) return null;
    if (!INTERRUPTIBLE_STATES.has(this.state)) return null;
    const half = this.tileSize * CENTER_OFFSET;
    return stickToKick(this.x + half, this.y + half, liveExplosives());
  }

  private beginDynamiteSeek(stick: KickableStick): void {
    this.state = 'dynamite_seek';
    this.stickTarget = stick.id;
    this.seekFrames = 0;
  }

  private doDynamiteSeekState(nearest: Player | null): void {
    const id = this.stickTarget;
    const stick = id === null ? null : stickNow(id, liveExplosives());
    this.seekFrames++;
    if (stick === null || this.seekFrames > DYNAMITE_SEEK_GIVE_UP_FRAMES) {
      this.stickTarget = null;
      this.dynamiteKickCooldown = DYNAMITE_KICK_COOLDOWN_FRAMES;
      this.state = this.stateAfterBlow(nearest);
      return;
    }
    const half = this.tileSize * CENTER_OFFSET;
    const distance = Math.hypot(stick.x - (this.x + half), stick.y - (this.y + half));
    if (distance <= this.tileSize * DYNAMITE_KICK_CONTACT_TILES) {
      this.isMoving = false;
      this.clearAStarPath();
      this.faceToward({ x: stick.x - half, y: stick.y - half });
      this.state = 'dynamite_kick';
      this.kick.begin();
      return;
    }
    this.followTargetAStar(
      stick.x - half,
      stick.y - half,
      this.sprintSpeed,
      this.tileSize * DYNAMITE_KICK_CONTACT_TILES * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
      DUMBBELL_SEEK_PATHFIND_MAX,
    );
  }

  private doDynamiteKickState(nearest: Player | null): void {
    this.isMoving = false;
    const step = this.kick.tick();
    if (step === 'impact') {
      const id = this.stickTarget;
      const stick = id === null ? null : stickNow(id, liveExplosives());
      const view = this.flockView;
      if (stick !== null && view !== null) {
        kickExplosive(stick.id, dynamiteKickVelocity(stick, view));
        this.soundCues.raise('kick');
      }
      this.stickTarget = null;
      this.dynamiteKickCooldown = DYNAMITE_KICK_COOLDOWN_FRAMES;
    }
    if (step === 'done' || step === 'idle') this.state = this.stateAfterBlow(nearest);
  }

  // ── Damage the gym resolves on his behalf ─────────────────────────────────

  /**
   * A kettlebell from his rain landing on `target`, at `share` of its full
   * weight. Resolved by the gym, which owns the rain; never once he is dead.
   */
  landKettlebell(target: Player, share: number): boolean {
    if (!this.isAlive || !target.isAlive) return false;
    if (this.shieldTurnsAside(target)) return false;
    const damage = this.scaledDamage(KETTLEBELL_DAMAGE) * share;
    const connected = this.dealPreScaledRangedDamage(target, damage, KETTLEBELL_ATTACK_TYPE);
    if (connected) target.damageFlash = DAMAGE_FLASH_DUMBBELL;
    return connected;
  }

  /** A rolling exercise ball running into `target` along (vx, vy). Resolved by the gym. */
  landExerciseBall(target: Player, vx: number, vy: number): boolean {
    if (!this.isAlive || !target.isAlive) return false;
    if (this.shieldTurnsAside(target)) return false;
    const connected = this.dealRangedDamage(
      target,
      EXERCISE_BALL_DAMAGE,
      EXERCISE_BALL_ATTACK_TYPE,
    );
    if (!connected) return false;
    target.damageFlash = DAMAGE_FLASH_DUMBBELL;
    target.applyKnockback(
      vx,
      vy,
      this.tileSize * EXERCISE_BALL_KNOCKBACK_TILES,
      EXERCISE_BALL_KNOCKBACK_FRAMES,
    );
    return true;
  }

  private shieldTurnsAside(target: Player): boolean {
    const half = this.tileSize * CENTER_OFFSET;
    if (this.spells?.isPointInsideEnergyShield(target.x + half, target.y + half) !== true) {
      return false;
    }
    this.spells.addBlockXp(BLOCK_XP);
    return true;
  }

  private updateTaunt(nearest: Player | null): void {
    if (nearest === null) {
      this.currentTaunt = null;
      this.tauntTimer = 0;
      return;
    }
    this.tauntTimer++;
    // The music stopping is answered at once rather than at the next taunt.
    const musicChanged = this.musicPlaying !== this.tauntsHadMusic;
    if (musicChanged) {
      this.tauntsHadMusic = this.musicPlaying;
      this.tauntIndex = 0;
    }
    if (this.tauntTimer >= TAUNT_INTERVAL || this.currentTaunt === null || musicChanged) {
      const pool = this.musicPlaying ? BIG_ROOSTER_LINES.taunts : BIG_ROOSTER_LINES.noMusicTaunts;
      this.currentTaunt = pickLine(pool, this.tauntIndex).paragraphs[0];
      this.tauntIndex++;
      this.tauntTimer = 0;
    }
  }

  /** What his peck and punch need from him, built fresh so it reads his position this frame. */
  private strikeBody(): RoosterStrikeBody {
    return {
      x: this.x,
      y: this.y,
      tileSize: this.tileSize,
      land: (target, spec) => {
        const tcx = target.x + this.tileSize * CENTER_OFFSET;
        const tcy = target.y + this.tileSize * CENTER_OFFSET;
        if (this.spells?.isPointInsideEnergyShield(tcx, tcy) === true) {
          this.spells.addBlockXp(BLOCK_XP);
          return;
        }
        this.dealDamage(target, spec.damage, spec.attackType);
        this.framesSinceLastAttack = 0;
      },
      scaledCooldown: (baseFrames) => this.scaledCooldownFrames(baseFrames),
      impact: (kind) => {
        this.soundCues.raise(kind === 'peck' ? 'peck' : 'swing');
      },
    };
  }

  /**
   * Whether he runs for the weight this frame.
   *
   * He wants it badly enough to sprint, but only while there is ground to
   * cover: inside {@link SPRINT_MIN_DISTANCE_TILES} he walks the last stretch
   * in so the pickup is not overshot.
   */
  private shouldSprintToDumbbell(): boolean {
    if (this.state !== 'seeking_dumbbell' || this.heldDumbbell) return false;
    const target = this.nearestDumbbellPos;
    if (target === null) return false;
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    return distance > TILE_SIZE * SPRINT_MIN_DISTANCE_TILES;
  }

  /** The opening crow once per fight, and again the first chance he gets after enraging. */
  private canStartCrow(): boolean {
    if (!INTERRUPTIBLE_STATES.has(this.state)) return false;
    return !this.hasCrowed || this.enrageCrowPending;
  }

  private beginCrow(target: Player | null): void {
    prewarmBigRoosterRows(CROW_ROWS);
    this.state = 'crow';
    this.crowTimer = CROW_FRAMES;
    this.soundCues.raise('crow');
    this.hasCrowed = true;
    this.enrageCrowPending = false;
    this.isMoving = false;
    this.clearAStarPath();
    if (target !== null) this.faceToward(target);
  }

  private doCrowState(nearest: Player | null): void {
    this.isMoving = false;
    if (nearest !== null) this.faceToward(nearest);
    this.crowTimer--;
    if (this.crowTimer > 0) return;
    this.state = this.stateAfterBlow(nearest);
  }

  /**
   * Whether the fists are available this frame.
   *
   * A wind-up already under way keeps its commitment: interrupting a throw he
   * has been visibly loading for half a second to start a second attack reads
   * as the boss changing its mind, and it would cancel the one telegraph the
   * player had already begun reacting to.
   */
  private canStartSlam(nearestDist: number): boolean {
    if (this.heldDumbbell || this.slamCooldownTimer > 0) return false;
    if (!INTERRUPTIBLE_STATES.has(this.state)) return false;
    return nearestDist <= this.tileSize * SLAM_TRIGGER_TILES;
  }

  /**
   * Whether he bowls a plate this frame: enraged, empty-handed, a loaded squat
   * rack at his elbow, a target at mid range with open floor between them.
   */
  private canStartPlateRoll(target: Player, targetDist: number): boolean {
    if (!this.isEnraged || this.plateCooldownTimer > 0 || this.heldDumbbell) return false;
    if (this.state !== 'seeking_dumbbell' && this.state !== 'pursuing') return false;
    if (this.rollingPlate !== null) return false;
    const minRange = this.tileSize * PLATE_ROLL_MIN_RANGE_TILES;
    const maxRange = this.tileSize * PLATE_ROLL_MAX_RANGE_TILES;
    if (targetDist < minRange || targetDist > maxRange) return false;
    if (this.nearestLoadedSquatRack() === null) return false;
    const map = this.map;
    if (map === null) return false;
    const half = this.tileSize * CENTER_OFFSET;
    return map.hasWalkableLine(this.x + half, this.y + half, target.x + half, target.y + half);
  }

  private nearestLoadedSquatRack(): { x: number; y: number } | null {
    const reach = this.tileSize * PLATE_ROLL_RACK_REACH_TILES;
    const cx = this.x + this.tileSize * CENTER_OFFSET;
    const cy = this.y + this.tileSize * CENTER_OFFSET;
    let best: { x: number; y: number } | null = null;
    let bestDist = reach;
    for (const rack of this.loadedSquatRacks) {
      const dist = Math.hypot(rack.x - cx, rack.y - cy);
      if (dist > bestDist) continue;
      bestDist = dist;
      best = { x: rack.x, y: rack.y };
    }
    return best;
  }

  private beginPlateRoll(target: Player): void {
    const rack = this.nearestLoadedSquatRack();
    if (rack === null) return;
    prewarmRoosterRow('big', 'throw');
    this.state = 'plate_windup';
    // Bowled on the throw's own wind-up, row and release frame: a crawler who
    // has learned the throw's tell has learned this one, and the drawn throw
    // lets go on the frame the plate leaves his hands.
    this.plateWindupTimer = BIG_ROOSTER_THROW_WINDUP_FRAMES;
    this.plateReleased = false;
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    const half = this.tileSize * CENTER_OFFSET;
    const origin = { x: this.x + half, y: this.y + half };
    // Locked now: the lane is aimed at where the target stands as the wind-up
    // begins, and the chalk drawn along it is the whole telegraph.
    this.plateLane = this.planPlateLane(origin, { x: target.x + half, y: target.y + half });
    this.plateTakenFrom = rack;
    this.throwAnim = 0;
  }

  /**
   * The plate's whole run, decided before it moves: straight at the aim point,
   * off the first wall it meets, and on until the next.
   *
   * Marched in the plate's own speed so the planned bounce is the one it takes,
   * reflecting per axis the way a thrown dumbbell does.
   */
  private planPlateLane(
    origin: { x: number; y: number },
    aim: { x: number; y: number },
  ): PlateLane {
    const map = this.map;
    const length = Math.hypot(aim.x - origin.x, aim.y - origin.y);
    if (map === null || length === 0) return [origin];
    let vx = ((aim.x - origin.x) / length) * PLATE_ROLL_SPEED;
    let vy = ((aim.y - origin.y) / length) * PLATE_ROLL_SPEED;
    const ts = this.tileSize;
    // The room's edge stops a plate as a wall does: an open doorway is still
    // the edge of the fight, and a plate rolling off down a corridor is a lane
    // that paints danger where nobody is fighting.
    const room = this.confinedTo;
    const walkable = (px: number, py: number): boolean => {
      const tileX = Math.floor(px / ts);
      const tileY = Math.floor(py / ts);
      const insideRoom =
        room === null ||
        (tileX >= room.x && tileY >= room.y && tileX < room.x + room.w && tileY < room.y + room.h);
      return insideRoom && map.isWalkable(tileX, tileY);
    };
    const points = [{ x: origin.x, y: origin.y }];
    let x = origin.x;
    let y = origin.y;
    let bounces = 0;
    const maxSteps = Math.ceil((PLATE_ROLL_MAX_TILES * ts) / PLATE_ROLL_SPEED);
    for (let step = 0; step < maxSteps; step++) {
      const nx = x + vx;
      const ny = y + vy;
      if (walkable(nx, ny)) {
        x = nx;
        y = ny;
        continue;
      }
      if (bounces >= PLATE_ROLL_BOUNCES) break;
      const blockedX = !walkable(x + vx, y);
      const blockedY = !walkable(x, y + vy);
      if (blockedX) vx = -vx;
      if (blockedY) vy = -vy;
      if (!blockedX && !blockedY) {
        vx = -vx;
        vy = -vy;
      }
      bounces++;
      points.push({ x, y });
    }
    points.push({ x, y });
    return points;
  }

  private doPlateWindupState(nearest: Player | null): void {
    this.isMoving = false;
    this.plateWindupTimer--;
    const elapsed = BIG_ROOSTER_THROW_WINDUP_FRAMES - this.plateWindupTimer;
    this.throwAnim = bigRoosterThrowProgressAt(elapsed);
    if (!this.plateReleased && elapsed >= BIG_ROOSTER_THROW_RELEASE_FRAME) this.releasePlate();
    if (this.plateWindupTimer > 0) return;
    this.throwAnim = 0;
    this.state = 'cooldown';
    this.cooldownTimer = PLATE_ROLL_RECOVER_FRAMES;
    if (nearest === null) this.state = 'idle';
  }

  private releasePlate(): void {
    this.plateReleased = true;
    this.specialSoundPending = true;
    this.framesSinceLastAttack = 0;
    this.plateCooldownTimer = Math.max(
      PLATE_ROLL_MIN_COOLDOWN_FRAMES,
      this.scaledCooldownFrames(PLATE_ROLL_COOLDOWN_FRAMES),
    );
    const lane = this.plateLane;
    if (lane === null || lane.length < 2) {
      this.plateLane = null;
      return;
    }
    this.rollingPlate = { segment: 0, along: 0, x: lane[0].x, y: lane[0].y, vx: 0, vy: 0, age: 0 };
  }

  /** Walks the plate along its planned lane and lands it on whoever it meets. */
  private updateRollingPlate(targets: Player[]): void {
    const plate = this.rollingPlate;
    const lane = this.plateLane;
    if (plate === null || lane === null) return;
    plate.age++;
    let travel = PLATE_ROLL_SPEED;
    while (travel > 0) {
      if (plate.segment + 1 >= lane.length) {
        this.endPlateRoll();
        return;
      }
      const from = lane[plate.segment];
      const to = lane[plate.segment + 1];
      const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
      const left = segmentLength - plate.along;
      if (segmentLength === 0 || left <= travel) {
        travel -= Math.max(0, left);
        plate.segment++;
        plate.along = 0;
        plate.x = to.x;
        plate.y = to.y;
        continue;
      }
      plate.along += travel;
      plate.vx = ((to.x - from.x) / segmentLength) * PLATE_ROLL_SPEED;
      plate.vy = ((to.y - from.y) / segmentLength) * PLATE_ROLL_SPEED;
      plate.x = from.x + (plate.vx / PLATE_ROLL_SPEED) * plate.along;
      plate.y = from.y + (plate.vy / PLATE_ROLL_SPEED) * plate.along;
      travel = 0;
    }
    const hitRadius = this.tileSize * PLATE_ROLL_HIT_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const tcx = target.x + this.tileSize * CENTER_OFFSET;
      const tcy = target.y + this.tileSize * CENTER_OFFSET;
      if (Math.hypot(plate.x - tcx, plate.y - tcy) >= hitRadius) continue;
      if (this.spells?.isPointInsideEnergyShield(tcx, tcy) === true) {
        this.spells.addBlockXp(BLOCK_XP);
      } else if (this.dealRangedDamage(target, PLATE_ROLL_DAMAGE, PLATE_ROLL_ATTACK_TYPE)) {
        target.damageFlash = DAMAGE_FLASH_DUMBBELL;
        target.applyKnockback(
          plate.vx,
          plate.vy,
          this.tileSize * PLATE_KNOCKBACK_TILES,
          PLATE_KNOCKBACK_FRAMES,
        );
      }
      this.endPlateRoll();
      return;
    }
  }

  private endPlateRoll(): void {
    this.rollingPlate = null;
    this.plateLane = null;
  }

  private beginSlam(target: Player): void {
    prewarmRoosterRow('big', 'slam');
    this.state = 'slam_windup';
    this.soundCues.raise('effort');
    this.slamTimer = BIG_ROOSTER_SLAM_WINDUP_FRAMES;
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    // Locked here and never revised. `faceToward` above already points him at
    // the target, so the fists come down a step in front of him along that
    // facing rather than wherever the player has moved to by the time they
    // land — that fixed point is the whole dodge.
    const facingLength = Math.hypot(this.facingX, this.facingY);
    const reach = this.tileSize * SLAM_REACH_TILES;
    const stepX = facingLength === 0 ? 0 : (this.facingX / facingLength) * reach;
    const stepY = facingLength === 0 ? 0 : (this.facingY / facingLength) * reach;
    this.slamPoint = {
      x: this.x + this.tileSize * CENTER_OFFSET + stepX,
      y: this.y + this.tileSize * CENTER_OFFSET + stepY,
    };
  }

  private doSlamWindupState(targets: Player[]): void {
    this.isMoving = false;
    // Deliberately not re-facing the target: his facing is what chose the
    // impact point, and turning with the player would leave him swinging at
    // one spot while pointing at another.
    this.slamTimer--;
    if (this.slamTimer > 0) return;
    this.resolveSlam(targets);
    this.state = 'slam_recover';
    this.slamTimer = BIG_ROOSTER_SLAM_RECOVER_FRAMES;
  }

  private doSlamRecoverState(nearest: Player | null): void {
    this.isMoving = false;
    if (nearest !== null) this.faceToward(nearest);
    this.slamTimer--;
    if (this.slamTimer > 0) return;
    this.state = this.stateAfterBlow(nearest);
  }

  /**
   * Where a finished blow hands him back to: his fury's next step, the fight
   * with the weight, the walk to a rack, or rest.
   */
  private stateAfterBlow(nearest: Player | null): BigRoosterState {
    if (this.phase === 'fury') return this.nextFuryState(nearest);
    if (nearest === null) return 'idle';
    return this.heldDumbbell ? 'pursuing' : 'seeking_dumbbell';
  }

  private resolveSlam(targets: Player[]): void {
    const point = this.slamPoint;
    if (point === null) return;
    const radius = this.tileSize * SLAM_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + this.tileSize * CENTER_OFFSET;
      const cy = target.y + this.tileSize * CENTER_OFFSET;
      const dx = cx - point.x;
      const dy = cy - point.y;
      if (Math.hypot(dx, dy) > radius) continue;
      if (this.spells?.isPointInsideEnergyShield(cx, cy) === true) {
        this.spells.addBlockXp(BLOCK_XP);
        continue;
      }
      // A blow the crawler dodged neither flashes nor shoves her.
      const connected = this.dealRangedDamage(target, SLAM_DAMAGE, SLAM_ATTACK_TYPE);
      if (!connected) continue;
      target.damageFlash = DAMAGE_FLASH_SLAM;
      // Radially away from the crater. `applyKnockback` normalises, so a target
      // standing exactly on the point is simply not shoved anywhere.
      target.applyKnockback(dx, dy, this.tileSize * SLAM_KNOCKBACK_TILES, SLAM_KNOCKBACK_FRAMES);
    }
    this.shockwaveTimer = SLAM_SHOCKWAVE_FRAMES;
    // Math.random is fine here: the seed only has to be stable for one wave,
    // and nothing about the effect is replayed or persisted.
    this.shockwaveSeed = Math.random();
    this.slamImpactSoundPending = true;
    this.framesSinceLastAttack = 0;
    this.slamCooldownTimer = this.scaledCooldownFrames(
      this.isEnraged ? SLAM_COOLDOWN_ENRAGED_FRAMES : SLAM_COOLDOWN_FRAMES,
    );
  }

  private beginClubSwing(target: Player): void {
    prewarmRoosterRow('big', 'club_swing');
    this.state = 'club_windup';
    this.soundCues.raise('effort');
    this.clubTimer = CLUB_SWING_WINDUP_FRAMES;
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    // Fixed now, like the slam's point: the cone on the floor is where the
    // weight will pass, whatever the target does during the wind-up.
    const aim = normalize(this.facingX, this.facingY);
    this.clubAim = { x: aim.x, y: aim.y };
  }

  private doClubWindupState(targets: Player[]): void {
    this.isMoving = false;
    this.clubTimer--;
    if (this.clubTimer > 0) return;
    this.resolveClubSwing(targets);
    this.state = 'club_recover';
    this.clubTimer = CLUB_SWING_RECOVER_FRAMES;
  }

  private doClubRecoverState(nearest: Player | null): void {
    this.isMoving = false;
    this.clubTimer--;
    if (this.clubTimer > 0) return;
    this.clubAim = null;
    this.state = this.stateAfterBlow(nearest);
  }

  /** The arc in front of him at the swing's front: inside the reach and within the half-angle of the locked aim. */
  private resolveClubSwing(targets: Player[]): void {
    const aim = this.clubAim;
    if (aim === null) return;
    this.soundCues.raise('swing');
    const reach = this.tileSize * CLUB_REACH_TILES;
    const ox = this.x + this.tileSize * CENTER_OFFSET;
    const oy = this.y + this.tileSize * CENTER_OFFSET;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + this.tileSize * CENTER_OFFSET;
      const cy = target.y + this.tileSize * CENTER_OFFSET;
      const dx = cx - ox;
      const dy = cy - oy;
      const distance = Math.hypot(dx, dy);
      if (distance > reach) continue;
      const inArc = distance === 0 || (dx * aim.x + dy * aim.y) / distance >= CLUB_ARC_MIN_DOT;
      if (!inArc) continue;
      if (this.spells?.isPointInsideEnergyShield(cx, cy) === true) {
        this.spells.addBlockXp(BLOCK_XP);
        continue;
      }
      // A blow the crawler dodged neither flashes nor shoves her.
      const connected = this.dealDamage(target, CLUB_DAMAGE, CLUB_ATTACK_TYPE);
      if (!connected) continue;
      target.damageFlash = DAMAGE_FLASH_CLUB;
      this.soundCues.raise('clubImpact');
      // Along the swing when the target stands on top of him, so a blow from
      // the arc never shoves nowhere.
      const pushX = distance === 0 ? aim.x : dx;
      const pushY = distance === 0 ? aim.y : dy;
      target.applyKnockback(
        pushX,
        pushY,
        this.tileSize * CLUB_KNOCKBACK_TILES,
        CLUB_KNOCKBACK_FRAMES,
      );
    }
    this.framesSinceLastAttack = 0;
    this.clubCooldownTimer = this.scaledCooldownFrames(CLUB_SWING_COOLDOWN_FRAMES);
  }

  /**
   * A peck or a punch on `target` if one is ready and in reach, chosen at
   * random between the two when both are. Returns whether one began. With the
   * dumbbell in his fist he only pecks: his hands stay on the weight.
   */
  private tryBeginStrike(target: Player, targetDist: number): boolean {
    const kind = this.strikeCandidates().find((candidate) =>
      this.strikes.canReach(candidate, targetDist, this.tileSize),
    );
    if (kind === undefined) return false;
    prewarmRoosterRow('big', kind);
    this.state = 'strike';
    this.isMoving = false;
    this.clearAStarPath();
    this.faceToward(target);
    this.strikes.begin(kind, this.facingX, this.facingY);
    this.soundCues.raise('effort');
    return true;
  }

  private strikeCandidates(): readonly RoosterStrikeKind[] {
    if (this.heldDumbbell) return ARMED_STRIKES;
    const preferred: RoosterStrikeKind = Math.random() < PECK_SHARE ? 'peck' : 'punch';
    const other: RoosterStrikeKind = preferred === 'peck' ? 'punch' : 'peck';
    return [preferred, other];
  }

  private doStrikeState(): void {
    this.isMoving = false;
    if (this.strikes.current !== null) return;
    this.state = this.heldDumbbell ? 'pursuing' : 'seeking_dumbbell';
  }

  private doIdleState(nearest: Player | null): void {
    if (nearest) {
      this.state = 'seeking_dumbbell';
    } else {
      this.doWander();
    }
  }

  private doSeekDumbbellState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }

    if (this.heldDumbbell) {
      this.state = 'pursuing';
      return;
    }

    if (this.tryBeginStrike(nearest, nearestDist)) return;

    const dumbbell = this.nearestDumbbellPos;
    if (dumbbell !== null) {
      const dist = Math.hypot(dumbbell.x - this.x, dumbbell.y - this.y);
      if (dist < TILE_SIZE * DUMBBELL_PICKUP_RANGE_TILES) {
        this.beginPickup(dumbbell);
      } else {
        // Derived from `moveSpeed` every frame rather than written back to
        // `speed`, which `applyMobLevel` has already multiplied in place.
        const speed = this.isSprinting ? this.sprintSpeed : this.moveSpeed;
        this.followTargetAStar(
          dumbbell.x,
          dumbbell.y,
          speed,
          TILE_SIZE * DUMBBELL_FOLLOW_STOP_RANGE_RATIO,
          DUMBBELL_SEEK_PATHFIND_MAX,
        );
      }
    } else {
      // No dumbbell anywhere: he comes for the crawler with his beak and fists.
      this.updateLastKnown(nearest);
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed * NO_DUMBBELL_SPEED_RATIO,
        this.tileSize * ROOSTER_STRIKE_MAX_REACH_TILES * STRIKE_APPROACH_STOP_RATIO,
        NO_DUMBBELL_PATHFIND_MAX,
      );
      if (!this.isMoving) this.faceToward(nearest);
    }
  }

  private beginPickup(at: { x: number; y: number }): void {
    prewarmBigRoosterRows(PICKUP_ROWS);
    this.state = 'pickup';
    this.pickupTimer = PICKUP_FRAMES;
    this.pickupAt = { x: at.x, y: at.y };
    this.isMoving = false;
    this.clearAStarPath();
  }

  /** Bends to the rack; the request goes to the gym on the frame his hand closes. */
  private doPickupState(): void {
    this.isMoving = false;
    this.pickupTimer--;
    const elapsed = PICKUP_FRAMES - this.pickupTimer;
    const at = this.pickupAt;
    if (elapsed === PICKUP_GRAB_FRAME && at !== null) this.requestDumbbellAt = { x: at.x, y: at.y };
    if (this.pickupTimer > 0) return;
    this.pickupAt = null;
    this.requestDumbbellAt = null;
    this.state = this.heldDumbbell ? 'pursuing' : 'seeking_dumbbell';
  }

  /**
   * The fight with a dumbbell in hand, by how far the target stands: inside
   * club reach he swings, or strikes bare-handed while the club cools; between
   * club reach and the throw band he walks in; inside the throw band, with a
   * line on the target, he throws; past it he chases.
   */
  private doPursuingState(nearest: Player | null, nearestDist: number): void {
    if (!nearest) {
      this.state = 'idle';
      return;
    }
    if (!this.heldDumbbell) {
      this.state = 'seeking_dumbbell';
      return;
    }

    this.updateLastKnown(nearest);

    const clubReach = this.tileSize * CLUB_REACH_TILES;
    if (nearestDist <= clubReach) {
      if (this.clubCooldownTimer <= 0) {
        this.beginClubSwing(nearest);
        return;
      }
      if (this.tryBeginStrike(nearest, nearestDist)) return;
      // Crowded with nothing ready to answer: he gives ground until the club is back.
      this.backOff(nearest);
      this.isMoving = true;
      this.faceToward(nearest);
      return;
    }

    const inThrowBand = nearestDist >= THROW_RANGE_MIN && nearestDist <= THROW_RANGE_MAX;
    if (inThrowBand && this.hasLOS(nearest)) {
      this.beginThrow(nearest);
      return;
    }

    if (nearestDist < THROW_RANGE_MIN) {
      if (this.clubCooldownTimer > 0) {
        this.isMoving = false;
        this.faceToward(nearest);
        return;
      }
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        clubReach * CLUB_APPROACH_STOP_RATIO,
        CLUB_APPROACH_PATHFIND_MAX,
      );
      if (!this.isMoving) this.faceToward(nearest);
      return;
    }

    // In the band with no line on the target, or past it. Once he has gone
    // long enough without attacking, a target in the band he cannot see is
    // closed on rather than held off from.
    const forced = inThrowBand && this.framesSinceLastAttack >= FORCE_ATTACK_FRAMES;
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      forced ? TILE_SIZE : THROW_RANGE_MAX * THROW_RANGE_FORCE_ATTACK_RATIO,
      THROW_PATHFIND_MAX,
    );

    // A follow already inside its stop range returns without writing facing, so
    // without this he stands with his back to a player he is squaring up to
    // throw at.
    if (!this.isMoving) this.faceToward(nearest);
  }

  /**
   * Commits to a throw at where `target` stands now. The point is fixed for
   * the whole wind-up and the weight flies at it on the release frame, so the
   * wind-up is a locked telegraph: a crawler who moves as he draws back is
   * not where the dumbbell goes.
   */
  private beginThrow(target: Player): void {
    prewarmRoosterRow('big', 'throw');
    this.throwAimPoint = {
      x: target.x + this.tileSize * CENTER_OFFSET,
      y: target.y + this.tileSize * CENTER_OFFSET,
    };
    this.state = 'winding_up';
    this.windupTimer = BIG_ROOSTER_THROW_WINDUP_FRAMES;
    this.throwAnim = 0;
    this.throwReleased = false;
  }

  /**
   * One step away from `threat`, finding another way out once straight back
   * has stopped getting him anywhere.
   *
   * Straight back is blocked whenever he has retreated to the edge of his room
   * — and the gym racks his dumbbells against its walls — so a crawler who
   * followed him there would otherwise pin him in place, backing into the
   * masonry. "Blocked" is judged by where the last frame's step left him
   * rather than by the step itself, because the room's clamp undoes a step
   * after the AI has taken it. Once pinned he tries all eight headings and
   * takes whichever leaves him furthest from the threat, and keeps it for a
   * stretch: alternating a slide with a step straight back into the wall
   * cancels out to standing still.
   */
  private backOff(threat: Player): void {
    const step = this.speed;
    const last = this.lastBackOff;
    const pinned =
      last !== null &&
      last.tick === this.aiTick - 1 &&
      Math.hypot(this.x - last.x, this.y - last.y) < step * BACK_OFF_BLOCKED_SHARE;
    this.lastBackOff = { x: this.x, y: this.y, tick: this.aiTick };
    if (pinned) {
      this.backOffHeading = this.bestEscapeHeading(threat, step);
      this.backOffSlideFrames = BACK_OFF_SLIDE_FRAMES;
    }
    const heading = this.backOffHeading;
    if (this.backOffSlideFrames > 0 && heading !== null) {
      this.backOffSlideFrames--;
      this.moveWithCollision(heading.x * step, heading.y * step);
      return;
    }
    const away = normalize(this.x - threat.x, this.y - threat.y);
    this.moveWithCollision(away.x * step, away.y * step);
  }

  /** Of the eight compass headings, the step that ends furthest from `threat`, or null if none moves him. */
  private bestEscapeHeading(threat: Player, step: number): { x: number; y: number } | null {
    const startX = this.x;
    const startY = this.y;
    let best: { x: number; y: number } | null = null;
    let bestDistance = -Infinity;
    for (let index = 0; index < ESCAPE_HEADINGS; index++) {
      const angle = (index / ESCAPE_HEADINGS) * Math.PI * 2;
      const hx = Math.cos(angle);
      const hy = Math.sin(angle);
      // Judged by the ground ahead as well as by the step: a step can slide a
      // few pixels toward a wall that the room's clamp then takes back.
      const aheadX = startX + this.tileSize * (CENTER_OFFSET + hx * ESCAPE_LOOKAHEAD_TILES);
      const aheadY = startY + this.tileSize * (CENTER_OFFSET + hy * ESCAPE_LOOKAHEAD_TILES);
      const aheadTileX = Math.floor(aheadX / this.tileSize);
      const aheadTileY = Math.floor(aheadY / this.tileSize);
      const room = this.confinedTo;
      const insideRoom =
        room === null ||
        (aheadTileX >= room.x &&
          aheadTileY >= room.y &&
          aheadTileX < room.x + room.w &&
          aheadTileY < room.y + room.h);
      const groundAhead = insideRoom && (this.map?.isWalkable(aheadTileX, aheadTileY) ?? true);
      this.moveWithCollision(hx * step, hy * step);
      const moved =
        groundAhead &&
        Math.hypot(this.x - startX, this.y - startY) >= step * BACK_OFF_BLOCKED_SHARE;
      const distance = Math.hypot(this.x - threat.x, this.y - threat.y);
      this.x = startX;
      this.y = startY;
      if (moved && distance > bestDistance) {
        bestDistance = distance;
        best = { x: hx, y: hy };
      }
    }
    return best;
  }

  /**
   * The throw, from the first crouch to the end of the follow-through.
   *
   * The dumbbell leaves on {@link BIG_ROOSTER_THROW_RELEASE_FRAME}, not on the last frame:
   * the sprite layer stops drawing the held overlay at
   * `BIG_ROOSTER_THROW_RELEASE_PROGRESS`, so releasing at the end of the
   * row would leave the weight existing nowhere on screen for the whole
   * follow-through. The remaining frames are the arm finishing its drive, and
   * only then does he cool down.
   */
  private doWindupState(nearest: Player | null): void {
    // A release already spent survives losing the target — the arm has to
    // finish the motion. Losing it before the release cancels the whole throw.
    if (!this.throwReleased && (!nearest || !this.heldDumbbell)) {
      this.state = 'idle';
      this.throwAnim = 0;
      this.throwAimPoint = null;
      return;
    }

    this.isMoving = false;
    this.windupTimer--;
    const elapsed = BIG_ROOSTER_THROW_WINDUP_FRAMES - this.windupTimer;
    this.throwAnim = bigRoosterThrowProgressAt(elapsed);

    const aim = this.throwAimPoint;
    if (aim !== null) {
      const dx = aim.x - (this.x + this.tileSize * CENTER_OFFSET);
      const dy = aim.y - (this.y + this.tileSize * CENTER_OFFSET);
      if (dx !== 0 || dy !== 0) {
        const n = normalize(dx, dy);
        this.facingX = n.x;
        this.facingY = n.y;
      }
    }

    if (!this.throwReleased && elapsed >= BIG_ROOSTER_THROW_RELEASE_FRAME && aim !== null) {
      this.throwDumbbell(aim);
    }

    if (this.windupTimer <= 0) this.enterThrowCooldown();
  }

  private doCooldownState(nearest: Player | null): void {
    this.isMoving = false;
    this.throwAnim = 0;
    this.cooldownTimer--;

    if (this.cooldownTimer <= 0) {
      this.state = nearest ? 'seeking_dumbbell' : 'idle';
    }
  }

  private throwDumbbell(aim: { readonly x: number; readonly y: number }): void {
    this.specialSoundPending = true;
    this.launchDumbbellAt(aim);
    this.heldDumbbell = false;
    this.throwAimPoint = null;
    prewarmBigRoosterRows(EMPTY_HANDED_ROWS);
    this.throwReleased = true;
    this.framesSinceLastAttack = 0;
  }

  /**
   * Puts a dumbbell in flight from his centre toward `aim`, in world pixels,
   * exactly as a released throw does. Public only for the gym gate's bounce
   * probe, which needs a throw at equipment no crawler can stand on; the fight
   * itself only ever launches through a throw's release.
   */
  launchDumbbellAt(aim: { readonly x: number; readonly y: number }): void {
    const ox = this.x + this.tileSize * CENTER_OFFSET;
    const oy = this.y + this.tileSize * CENTER_OFFSET;
    const d = Math.hypot(aim.x - ox, aim.y - oy);
    if (d === 0) return;
    this.activeThrow = {
      x: ox,
      y: oy,
      vx: ((aim.x - ox) / d) * THROW_SPEED,
      vy: ((aim.y - oy) / d) * THROW_SPEED,
      ttl: PROJECTILE_TTL,
      age: 0,
    };
  }

  private enterThrowCooldown(): void {
    this.throwAnim = 0;
    this.throwReleased = false;
    this.state = 'cooldown';
    this.cooldownTimer = THROW_COOLDOWN_FRAMES;
  }

  private updateProjectile(targets: Player[]): void {
    if (!this.activeThrow) return;
    const proj = this.activeThrow;

    proj.ttl--;
    proj.age++;
    if (proj.ttl <= 0) {
      this.activeThrow = null;
      return;
    }

    proj.x += proj.vx;
    proj.y += proj.vy;

    if (this.map) {
      const ts = this.tileSize;
      const tileX = Math.floor(proj.x / ts);
      const tileY = Math.floor(proj.y / ts);

      if (!this.map.isWalkable(tileX, tileY)) {
        const prevX = proj.x - proj.vx;
        const prevY = proj.y - proj.vy;
        const prevTX = Math.floor(prevX / ts);
        const prevTY = Math.floor(prevY / ts);

        // Test each axis from the previous (walkable) position so wall-tile
        // coordinates don't corrupt the other axis's check.
        const hitsWallOnX = !this.map.isWalkable(Math.floor((prevX + proj.vx) / ts), prevTY);
        const hitsWallOnY = !this.map.isWalkable(prevTX, Math.floor((prevY + proj.vy) / ts));

        if (hitsWallOnX) proj.vx *= -THROW_BOUNCE_DAMPING;
        if (hitsWallOnY) proj.vy *= -THROW_BOUNCE_DAMPING;
        // Corner hit: neither axis test caught it individually — reflect both.
        if (!hitsWallOnX && !hitsWallOnY) {
          proj.vx *= -THROW_BOUNCE_DAMPING;
          proj.vy *= -THROW_BOUNCE_DAMPING;
        }

        proj.x = prevX + proj.vx;
        proj.y = prevY + proj.vy;

        if (!this.map.isWalkable(Math.floor(proj.x / ts), Math.floor(proj.y / ts))) {
          this.activeThrow = null;
          return;
        }
      }
    }

    const ts = this.tileSize;
    const hitRadius = ts * HIT_RADIUS_TILES;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const tcx = t.x + ts * CENTER_OFFSET;
      const tcy = t.y + ts * CENTER_OFFSET;
      const dx = proj.x - tcx;
      const dy = proj.y - tcy;
      if (Math.hypot(dx, dy) < hitRadius) {
        if (this.spells?.isPointInsideEnergyShield(tcx, tcy)) {
          this.spells.addBlockXp(BLOCK_XP);
          this.activeThrow = null;
          return;
        }
        const connected = this.dealRangedDamage(t, THROW_DAMAGE);
        if (connected) {
          t.damageFlash = DAMAGE_FLASH_DUMBBELL;
          // Shoved along the weight's own flight rather than away from him: it
          // has bounced off walls by now, and being knocked back towards the
          // thrower would read as the wrong object having hit you.
          t.applyKnockback(
            proj.vx,
            proj.vy,
            this.tileSize * DUMBBELL_KNOCKBACK_TILES,
            DUMBBELL_KNOCKBACK_FRAMES,
          );
        }
        this.activeThrow = null;
        return;
      }
    }
  }

  /** Called by GymRoomSystem when it confirms a dumbbell was picked up. */
  onDumbbellPickedUp(): void {
    this.heldDumbbell = true;
    this.requestDumbbellAt = null;
  }

  /** How far through the slam row he is, or null when he is not slamming. */
  private get slamProgress(): number | null {
    const inWindup = this.state === 'slam_windup';
    if (!inWindup && this.state !== 'slam_recover') return null;
    return splitAtImpactProgress(
      inWindup,
      this.slamTimer,
      BIG_ROOSTER_SLAM_WINDUP_FRAMES,
      BIG_ROOSTER_SLAM_RECOVER_FRAMES,
      BIG_ROOSTER_SLAM_IMPACT_PROGRESS,
    );
  }

  /** How far through the club swing row he is, or null when he is not swinging. */
  private get clubProgress(): number | null {
    const inWindup = this.state === 'club_windup';
    if (!inWindup && this.state !== 'club_recover') return null;
    return splitAtImpactProgress(
      inWindup,
      this.clubTimer,
      CLUB_SWING_WINDUP_FRAMES,
      CLUB_SWING_RECOVER_FRAMES,
      BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
    );
  }

  /** How far through the crow he is, or null when he is not crowing. */
  private get crowProgress(): number | null {
    if (this.state !== 'crow') return null;
    return (CROW_FRAMES - this.crowTimer) / CROW_FRAMES;
  }

  /** How far through bending to a rack he is, or null outside a pickup or a heave's lift. */
  private get pickupProgress(): number | null {
    if (this.state === 'heave_lift') return this.heaveTimer / PICKUP_FRAMES;
    if (this.state !== 'pickup') return null;
    return (PICKUP_FRAMES - this.pickupTimer) / PICKUP_FRAMES;
  }

  /** How far through the punch row he is: a peck's or punch's own, or a kick's, which borrows it. */
  private get punchRowProgress(): number | null {
    if (this.strikes.current === 'punch') return this.strikes.progress;
    return this.kick.progress;
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

    // The hit flash and the enrage tint are both `ctx.filter` values and only
    // one of them can be set, so the sprite module owns the choice between them
    // rather than each caller half-applying one.
    const bodyTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawRoosterSprite(ctx, 'big', sx, sy, tileSize, {
        walkFrame: this.walkFrame,
        sprintFrame: this.animationClock.runPhase,
        isMoving: this.isMoving,
        // Faster than his walk can show (enraged, levelled, or both) he runs
        // in the sprint row whatever he is running for.
        isSprinting: this.isSprinting || (this.isMoving && this.animationClock.running),
        crowProgress: this.crowProgress,
        slamProgress: this.slamProgress,
        clubProgress: this.clubProgress,
        throwProgress: this.throwAnim > 0 ? this.throwAnim : null,
        peckProgress: this.strikes.current === 'peck' ? this.strikes.progress : null,
        punchProgress: this.punchRowProgress,
        pickupProgress: this.pickupProgress,
        facingX: this.facingX,
        facingY: this.facingY,
        isEnraged: this.isEnraged,
        isDamageFlashing: this.damageFlash > 0,
        heldDumbbell: this.heldDumbbell && this.state !== 'heave_toss',
        idleSeconds: this.animationClock.idleSeconds,
      });
    });

    let artTopY = bodyTopY;
    if (this.state === 'plate_windup' && !this.plateReleased) {
      const heldPlateTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
        drawGymPlateSprite(ctx, sx, sy - tileSize * PLATE_HELD_LIFT_TILES, tileSize, 0);
      });
      artTopY = Math.min(bodyTopY, heldPlateTopY);
    }

    this.artClearanceTiles = (sy - artTopY) / tileSize;
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }

  /**
   * His comb reaches well over two tiles above the tile he occupies, so the
   * default one-tile margin would cull him — and cut his head off the hit-flash
   * composite — while he was still on screen.
   */
  override get cullMarginTiles(): number {
    return BIG_ROOSTER_ART_MARGIN_TILES;
  }

  /**
   * The slam's disc, the club's cone and his taunt, drawn **outside** the
   * silhouette composite.
   *
   * All three reach well past his own tile, so none can live in `drawSelf`:
   * `Player.render` composites `drawSelf` into a box sized by
   * `silhouetteMarginTiles` whenever the character is hit-flashing or carrying
   * a status, and a shape past that box is simply cropped away. He spends most
   * of his fight flashing, so the one warning the player has to read would
   * strobe in and out. Inside the composite it would also be repainted by his
   * own status coat, and the hit flash would bleach the taunt's words. The
   * taunt hangs off the art top measured on his last draw.
   */
  protected override drawWorldFeedback(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
  ): void {
    super.drawWorldFeedback(ctx, sx, sy);
    if (!this.isAlive) return;
    // `sx` is `this.x - camX`, so the camera offset is recovered from it rather
    // than passed in — `drawWorldFeedback` is given screen coordinates only.
    const toScreenX = (worldX: number): number => sx + (worldX - this.x);
    const toScreenY = (worldY: number): number => sy + (worldY - this.y);

    const slam = this.slamTelegraph;
    if (slam !== null) {
      const fade =
        (BIG_ROOSTER_SLAM_WINDUP_FRAMES - slam.framesLeft) / BIG_ROOSTER_SLAM_WINDUP_FRAMES;
      drawDangerCircle(ctx, toScreenX(slam.x), toScreenY(slam.y), slam.radiusPx, fade);
    }

    const club = this.clubTelegraph;
    if (club !== null) {
      const fade = (CLUB_SWING_WINDUP_FRAMES - club.framesLeft) / CLUB_SWING_WINDUP_FRAMES;
      drawDangerCone(
        ctx,
        toScreenX(club.x),
        toScreenY(club.y),
        club.radiusPx,
        Math.atan2(club.aimY, club.aimX),
        club.halfAngleRad,
        fade,
      );
    }

    if (this.currentTaunt !== null) {
      const artTopY = sy - this.artClearanceTiles * this.tileSize;
      drawBigRoosterTaunt(ctx, sx, artTopY, this.tileSize, this.currentTaunt);
    }
  }
}
