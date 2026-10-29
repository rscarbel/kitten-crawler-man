import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import { Mob, type BlockableProjectile } from './Mob';
import { SoundCueQueue, type ElectricGoblinSoundCue } from './creatureSoundCues';
import { liveExplosives } from './explosiveAwareness';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from './mobLevelScaling';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { makeElectrified } from '../core/combat/StatusEffect';
import { settings } from '../core/input/Settings';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import { worldRandom } from '../core/world/WorldRandom';
import type { GameMap } from '../map/GameMap';
import { escapeFromCircleZones, type CircleHazardZone } from '../systems/circleHazardEscape';
import type { HazardEscape } from '../systems/GroundHazardSource';
import type { TileRect } from '../systems/bossRooms/bossRoomLayout';
import { labTileKey, type LabPuddle } from '../systems/bossRooms/powerLabLayout';
import {
  ELECTRIC_GOBLIN_BODY_PART_KEY,
  ELECTRIC_GOBLIN_EYES,
  ELECTRIC_GOBLIN_ROWS,
  GRENADE_RELEASE_FRAME,
  PLUNGE_IMPACT_FRAME,
  SLAM_IMPACT_FRAME,
  SWIPE_IMPACT_FRAME,
  drawElectricGoblinSprite,
  electricGoblinBallAnchor,
  electricGoblinTellFrame,
  type ElectricGoblinRow,
} from '../sprites/electricGoblinSprite';

// ── Body ─────────────────────────────────────────────────────────────────────

/** Health, speed and rewards before levelling; the owner tunes these by playtest. */
const ELECTRIC_GOBLIN_HP = 260;
const ELECTRIC_GOBLIN_SPEED = 1.1;
/** His pace running from a lit explosive: a lumbering run, still slower than a crawler. */
const ELECTRIC_GOBLIN_FLEE_SPEED = 1.8;
const ELECTRIC_GOBLIN_XP = 700;
const COIN_DROP_MIN = 40;
const COIN_DROP_MAX = 80;
/** A generator on his back and rubber all over: nothing in the room shoves him far. */
const ELECTRIC_GOBLIN_MASS = 12;

const AGGRO_RANGE_TILES = 12;
/** He fights from range, closing only to here before he stops and works. */
const PREFERRED_RANGE_TILES = 3.5;

const FRAMES_PER_SECOND = 60;
const HALF = 0.5;

// ── Difficulty ───────────────────────────────────────────────────────────────

/** How one difficulty paces his fight: every tell's length, every rest between attacks, and how much he throws. */
interface ElectricGoblinPacing {
  /** Multiplies every tell and wind-up; below 1 is harder. Never takes a tell under the fairness floor. */
  readonly tellScale: number;
  /** Multiplies every rest between attacks; below 1 is harder. */
  readonly cooldownScale: number;
  /** Shock grenades lobbed at random ground in each volley, on top of one at each party member. */
  readonly randomGrenades: number;
  /** Lanes added to every slam's fan on top of what his fury stage sends. */
  readonly extraSlamLanes: number;
}

const ELECTRIC_GOBLIN_PACING = {
  easy: { tellScale: 1.3, cooldownScale: 1.35, randomGrenades: 2, extraSlamLanes: 0 },
  normal: { tellScale: 1, cooldownScale: 1, randomGrenades: 3, extraSlamLanes: 0 },
  hard: { tellScale: 0.75, cooldownScale: 0.55, randomGrenades: 5, extraSlamLanes: 1 },
} as const satisfies Readonly<Record<Difficulty, ElectricGoblinPacing>>;

// ── Fury ─────────────────────────────────────────────────────────────────────

/**
 * How hard he is pushing, from the share of his health already lost: the
 * deeper into the fight, the more often he slams and the more lanes each slam
 * sends a wave down.
 */
type FuryStage = 'steady' | 'surging' | 'overloaded';

/** The ranged attacks he takes turns with; the swipe answers whoever comes close. */
type RangedAttack = 'grenade' | 'slam' | 'puddle';

interface FuryPacing {
  /** His turn of ranged attacks at this stage, repeated. */
  readonly rotation: readonly RangedAttack[];
  /** Waves one slam sends, each down its own telegraphed lane. */
  readonly slamLanes: number;
  /**
   * Slams that follow straight on from each one, each re-aimed at the target
   * and told again. A fan narrows to two lanes on a target too close to reach
   * its gaps; the follow-ups are what keep up the pressure there.
   */
  readonly followUpSlams: number;
  /** Multiplies the rest between ranged attacks; below 1 is more often. */
  readonly restScale: number;
}

const FURY_PACING = {
  steady: {
    rotation: ['grenade', 'slam', 'puddle', 'slam'],
    slamLanes: 1,
    followUpSlams: 0,
    restScale: 1,
  },
  surging: {
    rotation: ['slam', 'grenade', 'slam', 'puddle', 'slam'],
    slamLanes: 2,
    followUpSlams: 1,
    restScale: 0.8,
  },
  overloaded: {
    rotation: ['slam', 'grenade', 'slam', 'slam', 'puddle'],
    slamLanes: 3,
    followUpSlams: 2,
    restScale: 0.6,
  },
} as const satisfies Readonly<Record<FuryStage, FuryPacing>>;

/** Health lost, as a share of his maximum, at which he surges and then overloads. */
const FURY_STAGE_SHARE = 1 / Object.keys(FURY_PACING).length;
const SURGING_HP_LOST_SHARE = FURY_STAGE_SHARE;
const OVERLOADED_HP_LOST_SHARE = FURY_STAGE_SHARE * 2;
/** A fan with a flank on one side only: the target's other side stays open. */
const ONE_SIDED_FAN_LANES = 2;
/** No slam ever sends more lanes than this, whatever the stage and difficulty add up to. */
const MAX_SLAM_LANES = 4;
/**
 * Clear floor kept between neighbouring lanes' edges where the target stood
 * when the fan was aimed, in tiles: room for a crawler to stand between two
 * waves, so stepping into the gap is always a dodge.
 */
const SLAM_FAN_GAP_TILES = 1.5;
/**
 * The widest the fan's lanes may splay from one another, about 75 degrees. A
 * target too close for the gap to open at its own distance has it a few steps
 * further out from him instead.
 */
const SLAM_FAN_MAX_SPREAD_SHARE_OF_HALF_TURN = 0.42;
const SLAM_FAN_MAX_SPREAD_RAD = Math.PI * SLAM_FAN_MAX_SPREAD_SHARE_OF_HALF_TURN;

// ── Attacks ──────────────────────────────────────────────────────────────────

/** Recorded on each attack's damage so `DeathCauseSystem` can name the death. */
export const SHOCK_GRENADE_ATTACK_TYPE = 'shock_grenade';
export const CHARGED_PUDDLE_ATTACK_TYPE = 'charged_puddle';
export const ROD_SWIPE_ATTACK_TYPE = 'rod_swipe';
export const SLAM_WAVE_ATTACK_TYPE = 'slam_wave';

/** Rest between one ranged attack ending and the next starting, at level 1 and normal pace. */
const ATTACK_REST_FRAMES = 75;
/** The rest before his first attack once the fight starts, so the room is seen before it hurts. */
const OPENING_REST_FRAMES = 90;

/** The ring a grenade discharges over, in tiles. */
export const SHOCK_GRENADE_RADIUS_TILES = 1.25;
const SHOCK_GRENADE_DAMAGE = 3;
/** Flight time at normal pace; the landing ring shows for all of it. */
const SHOCK_GRENADE_FLIGHT_FRAMES = 54;
/** How high the lob arcs at its middle, in tiles. */
export const SHOCK_GRENADE_ARC_TILES = 2.2;
/** How long the shock burst of a landing grenade plays, hit or miss. */
export const SHOCK_BURST_FRAMES = 22;
/** Random landings are tried this many times each before the volley goes out a grenade short. */
const RANDOM_LANDING_ATTEMPTS = 24;
/**
 * Random landings keep their rings apart by this many radii, centre to centre,
 * from every other ring in the volley, so no two overlap and there is always
 * dry ground between any ring and the next.
 */
const RING_SEPARATION_RADII = 2.5;

/** The puddle charge: how long the tell holds both rods overhead at normal pace. */
const PUDDLE_TELL_FRAMES = 70;
/** How long a charged puddle stays live. */
const PUDDLE_CHARGE_FRAMES = 180;
/** Frames between bites of a charged puddle on anyone standing in it. */
const CHARGED_PUDDLE_BITE_FRAMES = 15;
/**
 * The share of a victim's own max HP each bite takes: eight bites, two seconds
 * of standing in it, from full health to nothing on every difficulty and at
 * every level. A tell this long and a puddle this big leave no excuse.
 */
const CHARGED_PUDDLE_BITES_TO_KILL = 8;
const CHARGED_PUDDLE_MAX_HP_SHARE_PER_BITE = 1 / CHARGED_PUDDLE_BITES_TO_KILL;
/** He gives up walking to a puddle's middle after this long: he plunges where he stands if he is in it, and drops the charge if not. */
const SEEK_PUDDLE_MAX_FRAMES = 240;
/** How close to the middle of his puddle he must stand before he plunges, in tiles. */
const PUDDLE_SPOT_ARRIVED_TILES = 0.35;

/** The close swipe: how near a crawler must come before he swings, centre to centre. */
const SWIPE_TRIGGER_TILES = 1.4;
/** How far the swing reaches when it lands. */
const SWIPE_REACH_TILES = 2;
const ROD_SWIPE_DAMAGE = 2;
/** "Shocked backwards": how far, and over how long. */
const SWIPE_KNOCKBACK_TILES = 3;
const SWIPE_KNOCKBACK_FRAMES = 14;
/** Rest after a swipe before he may swing again. */
const SWIPE_COOLDOWN_FRAMES = 110;

/** The slam: how long the rods are raised overhead at normal pace. */
const SLAM_TELL_FRAMES = 45;
/**
 * The wave runs at twice a crawler's walk: too fast to outrun, so it is
 * dodged by stepping out of its lane. Written against `PLAYER_SPEED` so it
 * keeps that relation if the crawlers are ever retuned.
 */
const SLAM_WAVE_SPEED_PX = PLAYER_SPEED * 2;
/** Half the wave's width across its lane, and its depth along it, in tiles. */
export const SLAM_WAVE_HALF_WIDTH_TILES = 1;
export const SLAM_WAVE_DEPTH_TILES = 0.7;
/** How far the wave runs before it spends itself, in tiles. */
const SLAM_WAVE_RANGE_TILES = 14;
const SLAM_WAVE_DAMAGE = 4;

/** Missiles he turns aside with crossed rods, when he is free to. */
const MISSILE_BLOCK_CHANCE = 0.5;

/** Extra clearance he keeps from a lit explosive's blast before he stops running. */
const FLEE_MARGIN_TILES = 1.5;
/** How far ahead he aims his run, so the path finder has room to steer round props. */
const FLEE_AIM_TILES = 4;

/** Companions treat this much past a telegraph's real edge as still inside it. */
const HAZARD_MARGIN_TILES = 0.5;
/** How far a body in a charged puddle looks for dry floor, in tiles. */
const PUDDLE_ESCAPE_SEARCH_TILES = 5;

// ── State ────────────────────────────────────────────────────────────────────

/** What the floor around him holds: set each frame by the power lab, absent anywhere else. */
interface ElectricGoblinArena {
  readonly bounds: TileRect;
  readonly puddles: readonly LabPuddle[];
}

/** One attack under way. Movement, blocks and the rest between attacks belong to `ready`. */
type Action =
  | { readonly kind: 'ready' }
  | { readonly kind: 'grenade_toss'; elapsed: number; readonly windup: number; released: boolean }
  | {
      readonly kind: 'seek_puddle';
      readonly puddle: number;
      readonly spot: TilePoint;
      elapsed: number;
    }
  | {
      readonly kind: 'plunge_tell';
      readonly puddle: number;
      elapsed: number;
      readonly tellFrames: number;
    }
  | {
      readonly kind: 'plunge';
      readonly puddle: number;
      elapsed: number;
      readonly windup: number;
      struck: boolean;
    }
  | { readonly kind: 'swipe'; elapsed: number; readonly windup: number; struck: boolean }
  | {
      readonly kind: 'slam_tell';
      elapsed: number;
      readonly tellFrames: number;
      /** Where the waves start, fixed with the lanes so a step he takes mid-tell never slides them. */
      readonly origin: WorldPoint;
      readonly lanes: readonly WorldPoint[];
      /** Slams still to follow this one, each re-aimed and told afresh. */
      readonly followUps: number;
    }
  | {
      readonly kind: 'slam';
      elapsed: number;
      readonly windup: number;
      readonly origin: WorldPoint;
      readonly lanes: readonly WorldPoint[];
      readonly followUps: number;
      struck: boolean;
    };

type ActionKind = Action['kind'];

/** A reaction row played over standing or walking: never over an attack. */
interface Reaction {
  readonly row: 'block' | 'hurt';
  elapsed: number;
}

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** A shock grenade in the air, read by the room to draw its lob and its landing ring. */
export interface ShockGrenade {
  readonly fromX: number;
  readonly fromY: number;
  readonly landX: number;
  readonly landY: number;
  readonly flightFrames: number;
  elapsed: number;
}

/** A grenade going off where it landed, read by the room to draw its blast. */
export interface ShockBurst {
  readonly x: number;
  readonly y: number;
  elapsed: number;
}

/** A wave of current running along the floor from his slam, read by the room to draw it. */
export interface SlamWave {
  readonly originX: number;
  readonly originY: number;
  readonly dirX: number;
  readonly dirY: number;
  /** How far its front has run from the origin, in world pixels. */
  travelled: number;
  readonly rangePx: number;
  readonly struck: Set<Player>;
}

/** The puddle he is charging or has charged, for the room's drawing and the hazard steering. */
type PuddleCharge =
  | { readonly kind: 'none' }
  | { readonly kind: 'tell'; readonly puddle: number; readonly progress: number }
  | { readonly kind: 'charged'; readonly puddle: number; readonly framesLeft: number };

/** A lane a slam about to land will send a wave down, while the rods are raised. */
export interface SlamLane {
  readonly fromX: number;
  readonly fromY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly lengthPx: number;
  /** 0–1 through the tell and wind-up: 1 on the frame the wave leaves. */
  readonly progress: number;
}

/** The actions he may be in while still free to cross his rods over a missile. */
const BLOCKING_ACTIONS: ReadonlySet<ActionKind> = new Set(['ready', 'seek_puddle']);
/** The actions a lit explosive sends him running out of: everything but the slam. */
const FLEE_CANCELS: ReadonlySet<ActionKind> = new Set([
  'grenade_toss',
  'seek_puddle',
  'plunge_tell',
  'plunge',
  'swipe',
]);

function ticksPerPaintedFrame(fps: number): number {
  return FRAMES_PER_SECOND / fps;
}

/**
 * Where in a strike row a wind-up of `windup` frames has got to: the frames
 * before the row's event are stretched over the wind-up, and the rest play
 * at the row's own pace.
 */
function strikeFrame(
  row: 'grenade_toss' | 'plunge' | 'swipe' | 'slam',
  elapsed: number,
  windup: number,
): number {
  const spec = ELECTRIC_GOBLIN_ROWS[row];
  if (elapsed < windup) return Math.floor((elapsed / windup) * spec.eventFrame);
  const after = Math.floor((elapsed - windup) / ticksPerPaintedFrame(spec.fps));
  return Math.min(spec.frames - 1, spec.eventFrame + after);
}

function strikeLength(row: 'grenade_toss' | 'plunge' | 'swipe' | 'slam', windup: number): number {
  const spec = ELECTRIC_GOBLIN_ROWS[row];
  return windup + (spec.frames - spec.eventFrame) * ticksPerPaintedFrame(spec.fps);
}

function reactionLength(row: 'block' | 'hurt'): number {
  const spec = ELECTRIC_GOBLIN_ROWS[row];
  return spec.frames * ticksPerPaintedFrame(spec.fps);
}

/**
 * The Current Goblin, the boss of floor 2's power lab: a huge goblin in
 * rubber insulating armour, a generator on his back wired to a shock rod in
 * each hand.
 *
 * He fights from range with three attacks in turn — a volley of shock
 * grenades, a slam that sends waves of current down the floor, and a charge
 * of whichever puddle he can stand in — and swipes anyone who comes close.
 * Between attacks he crosses his rods over half the Magic Missiles that reach
 * him, and a lit explosive near him sends him running.
 *
 * As he loses health he pushes harder ({@link FURY_PACING}): he slams more
 * often, each slam fans waves down more lanes, and further slams follow
 * straight on, every one re-aimed and told afresh. He charges a puddle from
 * its middle, so the charge surrounds him.
 *
 * Every telegraph is held for the active difficulty's {@link ELECTRIC_GOBLIN_PACING}.
 * The grenades in flight, the waves and the charged puddle are his own state,
 * advanced in {@link tickTimers} so they finish even while he is seized; the
 * power lab draws them and tells companions how to get clear of them.
 */
export class ElectricGoblin extends Mob {
  readonly xpValue = ELECTRIC_GOBLIN_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'The Current Goblin';
  description = 'A huge goblin in rubber armour, a humming generator strapped to his back.';
  override readonly audioTag = 'electric_goblin';
  mass = ELECTRIC_GOBLIN_MASS;

  /** The lab around him, written by the room each frame. Null leaves him without puddles. */
  arena: ElectricGoblinArena | null = null;

  private action: Action = { kind: 'ready' };
  private reaction: Reaction | null = null;
  private attackRest = OPENING_REST_FRAMES;
  private swipeRest = 0;
  private rotationIndex = 0;
  /** Slams told so far, whose parity picks the flank a fan's second lane takes. */
  private slamsBegun = 0;
  private fleeing = false;
  /** Frames since the idle loop started, for its pace. */
  private idleFrames = 0;
  /** Ground covered by his own feet, for the gait's phase. */
  private gaitPx = 0;
  private lastHp: number;
  /** The party as `updateAI` last saw it, for the attacks that land while he is held. */
  private party: readonly Player[] = [];

  private readonly grenades: ShockGrenade[] = [];
  private readonly bursts: ShockBurst[] = [];
  private readonly waves: SlamWave[] = [];
  /** Each puddle's plunge spot, worked out the first time he heads for it. */
  private readonly plungeSpots = new Map<LabPuddle, TilePoint>();
  private charge: { puddle: number; framesLeft: number; biteIn: number } | null = null;
  private readonly soundCues = new SoundCueQueue<ElectricGoblinSoundCue>();

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, ELECTRIC_GOBLIN_HP, ELECTRIC_GOBLIN_SPEED);
    this.isBoss = true;
    this.lastHp = this.hp;
  }

  protected override get eyePlacement(): EyePlacement {
    return ELECTRIC_GOBLIN_EYES;
  }

  override get bodyPartKey(): string {
    return ELECTRIC_GOBLIN_BODY_PART_KEY;
  }

  /** The sounds raised since the scene last looked, emptied by the call. */
  takeSoundCues(): readonly ElectricGoblinSoundCue[] {
    return this.soundCues.take();
  }

  // ── Read-outs for the room ─────────────────────────────────────────────────

  get shockGrenades(): readonly ShockGrenade[] {
    return this.grenades;
  }

  get shockBursts(): readonly ShockBurst[] {
    return this.bursts;
  }

  get slamWaves(): readonly SlamWave[] {
    return this.waves;
  }

  get puddleCharge(): PuddleCharge {
    if (this.charge !== null) {
      return { kind: 'charged', puddle: this.charge.puddle, framesLeft: this.charge.framesLeft };
    }
    if (this.action.kind === 'plunge_tell' || this.action.kind === 'plunge') {
      const tell =
        this.action.kind === 'plunge_tell'
          ? Math.min(1, this.action.elapsed / this.action.tellFrames)
          : 1;
      return { kind: 'tell', puddle: this.action.puddle, progress: tell };
    }
    return { kind: 'none' };
  }

  /** The lanes the waves will run down, while his rods are up for a slam; empty otherwise. */
  get slamLanes(): readonly SlamLane[] {
    const action = this.action;
    if (action.kind !== 'slam_tell' && action.kind !== 'slam') return [];
    if (action.kind === 'slam' && action.struck) return [];
    const progress =
      action.kind === 'slam_tell' ? Math.min(1, action.elapsed / action.tellFrames) : 1;
    return action.lanes.map((dir) => ({
      fromX: action.origin.x,
      fromY: action.origin.y,
      dirX: dir.x,
      dirY: dir.y,
      lengthPx: SLAM_WAVE_RANGE_TILES * this.tileSize,
      progress,
    }));
  }

  // ── AI ─────────────────────────────────────────────────────────────────────

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.party = targets.filter((t) => t.isAlive && t.isDefendTarget !== true);
    this.isMoving = false;
    if (this.attackRest > 0) this.attackRest--;
    if (this.swipeRest > 0) this.swipeRest--;

    this.updateFlight();
    const target = this.acquireTarget(targets, AGGRO_RANGE_TILES * this.tileSize);
    // Companions join a fight by who a mob is targeting, and `acquireTarget`
    // keeps an engaged target at the longer persist range only through this.
    this.currentTarget = target;
    if (target !== null) this.updateLastKnown(target);

    switch (this.action.kind) {
      case 'ready':
        this.chooseAttack(target);
        break;
      case 'grenade_toss':
        this.advanceGrenadeToss(this.action);
        break;
      case 'seek_puddle':
        this.advanceSeek(this.action);
        break;
      case 'plunge_tell':
        this.advancePlungeTell(this.action);
        break;
      case 'plunge':
        this.advancePlunge(this.action);
        break;
      case 'swipe':
        this.advanceSwipe(this.action);
        break;
      case 'slam_tell':
        this.advanceSlamTell(this.action);
        break;
      case 'slam':
        this.advanceSlam(this.action);
        break;
      default:
        assertNever(this.action);
    }

    if (this.action.kind === 'ready' && !this.fleeing && target !== null) {
      this.keepRange(target);
    }
  }

  /**
   * Runs clear of any lit explosive whose blast would reach him, keeping
   * whatever slam he has started. Anything else he was doing is dropped.
   */
  private updateFlight(): void {
    const centre = this.centre();
    let awayX = 0;
    let awayY = 0;
    for (const explosive of liveExplosives()) {
      if (explosive.fuseFramesLeft <= 0) continue;
      const dx = centre.x - explosive.x;
      const dy = centre.y - explosive.y;
      const distance = Math.hypot(dx, dy);
      const reach = explosive.blastRadiusPx + FLEE_MARGIN_TILES * this.tileSize;
      if (distance >= reach) continue;
      const depth = reach - distance;
      const length = distance === 0 ? 1 : distance;
      awayX += ((distance === 0 ? 1 : dx) / length) * depth;
      awayY += ((distance === 0 ? 0 : dy) / length) * depth;
    }
    const length = Math.hypot(awayX, awayY);
    this.fleeing = length > 0;
    if (!this.fleeing) return;
    if (FLEE_CANCELS.has(this.action.kind)) this.endAction();
    const aimPx = FLEE_AIM_TILES * this.tileSize;
    this.followTargetCollide(
      this.x + (awayX / length) * aimPx,
      this.y + (awayY / length) * aimPx,
      ELECTRIC_GOBLIN_FLEE_SPEED,
      0,
    );
  }

  private keepRange(target: Player): void {
    const preferredPx = PREFERRED_RANGE_TILES * this.tileSize;
    if (this.distanceTo(target) > preferredPx) {
      this.followTargetAStar(target.x, target.y, this.moveSpeed, preferredPx);
    } else {
      this.faceToward(target);
    }
  }

  private chooseAttack(target: Player | null): void {
    if (target === null) return;
    const pace = this.pacing();
    const swipeReach = SWIPE_TRIGGER_TILES * this.tileSize;
    if (!this.fleeing && this.swipeRest <= 0 && this.distanceTo(target) <= swipeReach) {
      this.faceToward(target);
      this.reaction = null;
      this.action = {
        kind: 'swipe',
        elapsed: 0,
        windup: this.windupFor('swipe', SWIPE_IMPACT_FRAME, pace),
        struck: false,
      };
      return;
    }
    if (this.attackRest > 0) return;
    const next = this.nextRangedAttack();
    if (next === null) return;
    this.reaction = null;
    this.faceToward(target);
    switch (next) {
      case 'grenade':
        this.action = {
          kind: 'grenade_toss',
          elapsed: 0,
          windup: this.windupFor('grenade_toss', GRENADE_RELEASE_FRAME, pace),
          released: false,
        };
        return;
      case 'slam':
        this.beginSlamTell(target, pace, FURY_PACING[this.furyStage()].followUpSlams);
        return;
      case 'puddle': {
        const puddle = this.choosePuddle();
        const spot = puddle === null ? undefined : this.plungeSpotOf(puddle);
        if (puddle === null || spot === undefined) {
          this.beginSlamTell(target, pace, FURY_PACING[this.furyStage()].followUpSlams);
          return;
        }
        this.action = { kind: 'seek_puddle', puddle, spot, elapsed: 0 };
        return;
      }
      default:
        assertNever(next);
    }
  }

  /**
   * The next ranged attack in his turn, skipping any he cannot make here:
   * no grenade or puddle on the run, and no puddle in a room without one.
   */
  private nextRangedAttack(): RangedAttack | null {
    const rotation = FURY_PACING[this.furyStage()].rotation;
    for (const _turn of rotation) {
      const attack = rotation[this.rotationIndex % rotation.length];
      this.rotationIndex++;
      if (attack === 'slam') return attack;
      if (this.fleeing) continue;
      if (attack === 'puddle' && (this.arena === null || this.arena.puddles.length === 0)) continue;
      return attack;
    }
    return null;
  }

  private beginSlamTell(target: Player, pace: ElectricGoblinPacing, followUps: number): void {
    this.faceToward(target);
    this.slamsBegun++;
    const tellFrames = this.tellFor(SLAM_TELL_FRAMES, pace);
    // Each lane is drawn for the whole tell and must be where its wave runs,
    // so the start and every aim are fixed the moment the lanes appear.
    const origin = this.waveOrigin();
    this.action = {
      kind: 'slam_tell',
      followUps,
      elapsed: 0,
      tellFrames,
      origin,
      lanes: this.fanLanes(origin, centreOf(target), pace, tellFrames),
    };
  }

  /**
   * The directions one slam sends waves down: one at the target, then flanks
   * alternating either side.
   *
   * A single flank leaves the other side of the target's lane open, so two
   * lanes only need to sit edge to edge where the target stood. Lanes on both
   * sides leave no open side, so from three on they splay far enough apart
   * that there is a crawler's width of clear floor between neighbouring
   * edges: at the target's distance when that fits within
   * {@link SLAM_FAN_MAX_SPREAD_RAD}, and otherwise at the widest splay, where
   * the gap opens further out from him. A target that could not walk into
   * that gap before the tell ends gets a two-lane fan instead.
   */
  private fanLanes(
    origin: WorldPoint,
    aim: WorldPoint,
    pace: ElectricGoblinPacing,
    tellFrames: number,
  ): readonly WorldPoint[] {
    const centre = unitToward(origin, aim) ?? { x: this.facingX, y: this.facingY };
    const wanted = Math.min(
      MAX_SLAM_LANES,
      FURY_PACING[this.furyStage()].slamLanes + pace.extraSlamLanes,
    );
    if (wanted === 1) return [centre];
    const aimDistance = Math.hypot(aim.x - origin.x, aim.y - origin.y);
    const laneHalfWidthPx = SLAM_WAVE_HALF_WIDTH_TILES * this.tileSize;
    const laneWidthPx = laneHalfWidthPx * 2;
    const gapPx = SLAM_FAN_GAP_TILES * this.tileSize;
    const oneSided = (lanes: number): boolean => lanes <= ONE_SIDED_FAN_LANES;
    const spreadFor = (lanes: number): number => {
      const spacingPx = oneSided(lanes) ? laneWidthPx : laneWidthPx + gapPx;
      return Math.min(SLAM_FAN_MAX_SPREAD_RAD, spreadKeeping(spacingPx, aimDistance));
    };
    const gappedSpread = spreadFor(wanted);
    const gapMiddle = rotateUnit(centre, gappedSpread * HALF);
    const gapMiddleReach = (laneHalfWidthPx + gapPx * HALF) / Math.sin(gappedSpread * HALF);
    const stepToGapPx = Math.hypot(
      origin.x + gapMiddle.x * gapMiddleReach - aim.x,
      origin.y + gapMiddle.y * gapMiddleReach - aim.y,
    );
    const gapReachable = stepToGapPx <= PLAYER_SPEED * tellFrames;
    const lanes = oneSided(wanted) || gapReachable ? wanted : ONE_SIDED_FAN_LANES;
    const spread = spreadFor(lanes);
    // Alternates which flank the second lane takes from one slam to the next,
    // so stepping the same way every time is not a dodge.
    const firstFlank = this.slamsBegun % 2 === 0 ? 1 : -1;
    const directions: WorldPoint[] = [centre];
    for (let i = 1; i < lanes; i++) {
      const step = Math.ceil(i / 2);
      const side = i % 2 === 1 ? firstFlank : -firstFlank;
      directions.push(rotateUnit(centre, step * side * spread));
    }
    return directions;
  }

  /** How far into the fight he is, from the share of his health lost. */
  private furyStage(): FuryStage {
    const lost = 1 - this.hp / this.maxHp;
    if (lost >= OVERLOADED_HP_LOST_SHARE) return 'overloaded';
    if (lost >= SURGING_HP_LOST_SHARE) return 'surging';
    return 'steady';
  }

  private advanceGrenadeToss(action: Extract<Action, { kind: 'grenade_toss' }>): void {
    action.elapsed++;
    if (!action.released && action.elapsed >= action.windup) {
      action.released = true;
      this.releaseGrenades();
    }
    if (action.elapsed >= strikeLength('grenade_toss', action.windup)) this.endAction();
  }

  /**
   * One grenade at every party member where they stand now, then the random
   * ones. Every landing is fixed the moment the grenades leave his rod, and
   * its ring shows for the whole flight.
   */
  private releaseGrenades(): void {
    const anchor = electricGoblinBallAnchor(
      'grenade_toss',
      GRENADE_RELEASE_FRAME,
      'near',
      this.facingX,
    );
    const fromX = this.x + anchor.x * this.tileSize;
    const fromY = this.y + anchor.y * this.tileSize;
    const flightFrames = this.tellFor(SHOCK_GRENADE_FLIGHT_FRAMES, this.pacing());
    const landings: WorldPoint[] = this.party.map(centreOf);
    const ringPx = SHOCK_GRENADE_RADIUS_TILES * this.tileSize;
    const separationPx = ringPx * RING_SEPARATION_RADII;
    for (let i = 0; i < this.pacing().randomGrenades; i++) {
      const landing = this.randomLanding(landings, separationPx);
      if (landing !== null) landings.push(landing);
    }
    for (const landing of landings) {
      this.grenades.push({
        fromX,
        fromY,
        landX: landing.x,
        landY: landing.y,
        flightFrames,
        elapsed: 0,
      });
    }
    this.projectileSoundPending = true;
  }

  /** A walkable floor tile's centre in the room, clear of every ring already chosen. */
  private randomLanding(taken: readonly WorldPoint[], separationPx: number): WorldPoint | null {
    const bounds = this.arena?.bounds ?? this.fallbackBounds();
    for (let attempt = 0; attempt < RANDOM_LANDING_ATTEMPTS; attempt++) {
      const tx = bounds.x + Math.floor(worldRandom() * bounds.w);
      const ty = bounds.y + Math.floor(worldRandom() * bounds.h);
      if (this.map !== null && !this.map.isWalkable(tx, ty)) continue;
      const point = { x: (tx + HALF) * this.tileSize, y: (ty + HALF) * this.tileSize };
      if (taken.some((t) => Math.hypot(t.x - point.x, t.y - point.y) < separationPx)) continue;
      return point;
    }
    return null;
  }

  /** Away from the lab, the ground his random grenades may land on: a square about him. */
  private fallbackBounds(): TileRect {
    const reach = Math.ceil(AGGRO_RANGE_TILES * HALF);
    const tx = Math.floor(this.centre().x / this.tileSize);
    const ty = Math.floor(this.centre().y / this.tileSize);
    return { x: tx - reach, y: ty - reach, w: reach * 2 + 1, h: reach * 2 + 1 };
  }

  /**
   * The puddle worth charging: the one with the most of the party in it, and
   * of those the nearest to him.
   */
  private choosePuddle(): number | null {
    const puddles = this.arena?.puddles ?? [];
    let best: number | null = null;
    let bestOccupants = -1;
    let bestDistance = Infinity;
    const centre = this.centre();
    for (const [index, puddle] of puddles.entries()) {
      const occupants = this.party.filter((p) => this.isIn(puddle, centreOf(p))).length;
      const middle = {
        x: (puddle.centre.x + HALF) * this.tileSize,
        y: (puddle.centre.y + HALF) * this.tileSize,
      };
      const distance = Math.hypot(middle.x - centre.x, middle.y - centre.y);
      const better =
        occupants > bestOccupants || (occupants === bestOccupants && distance < bestDistance);
      if (!better) continue;
      best = index;
      bestOccupants = occupants;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Walks to the middle of the puddle and plunges there, so the charge he
   * stands in is one the party has to be in the thick of to be caught by,
   * and his own body is the warning of where it is.
   */
  private advanceSeek(action: Extract<Action, { kind: 'seek_puddle' }>): void {
    const puddle = this.arena?.puddles[action.puddle];
    action.elapsed++;
    if (puddle === undefined) {
      this.endAction();
      return;
    }
    const goalX = action.spot.x * this.tileSize;
    const goalY = action.spot.y * this.tileSize;
    const arrived =
      Math.hypot(goalX - this.x, goalY - this.y) <= PUDDLE_SPOT_ARRIVED_TILES * this.tileSize;
    const outOfTime = action.elapsed > SEEK_PUDDLE_MAX_FRAMES;
    if (arrived || (outOfTime && this.isIn(puddle, this.centre()))) {
      this.beginPlungeTell(action.puddle);
      return;
    }
    if (outOfTime) {
      this.endAction();
      return;
    }
    this.followTargetAStar(goalX, goalY, this.moveSpeed, 0);
  }

  private beginPlungeTell(puddle: number): void {
    this.action = {
      kind: 'plunge_tell',
      puddle,
      elapsed: 0,
      tellFrames: this.tellFor(PUDDLE_TELL_FRAMES, this.pacing()),
    };
    this.soundCues.raise('chargeWindup');
    this.soundCues.raise('chargeSparks');
  }

  private advancePlungeTell(action: Extract<Action, { kind: 'plunge_tell' }>): void {
    action.elapsed++;
    if (action.elapsed < action.tellFrames) return;
    this.action = {
      kind: 'plunge',
      puddle: action.puddle,
      elapsed: 0,
      windup: this.minimumWindup('plunge', PLUNGE_IMPACT_FRAME),
      struck: false,
    };
  }

  private advancePlunge(action: Extract<Action, { kind: 'plunge' }>): void {
    action.elapsed++;
    if (!action.struck && action.elapsed >= action.windup) {
      action.struck = true;
      this.charge = { puddle: action.puddle, framesLeft: PUDDLE_CHARGE_FRAMES, biteIn: 0 };
      this.soundCues.raise('puddleCharged');
      this.soundCues.raise('puddleArc');
      this.soundCues.raise('laugh');
    }
    if (action.elapsed >= strikeLength('plunge', action.windup)) this.endAction();
  }

  private advanceSwipe(action: Extract<Action, { kind: 'swipe' }>): void {
    action.elapsed++;
    if (!action.struck && action.elapsed >= action.windup) {
      action.struck = true;
      this.landSwipe();
    }
    if (action.elapsed >= strikeLength('swipe', action.windup)) {
      this.swipeRest = this.restFor(SWIPE_COOLDOWN_FRAMES);
      this.action = { kind: 'ready' };
    }
  }

  /** Everyone in reach on the side he swings at: a small blow and a long shove backwards. */
  private landSwipe(): void {
    this.soundCues.raise('swipe');
    const centre = this.centre();
    const reach = SWIPE_REACH_TILES * this.tileSize;
    for (const target of this.party) {
      const at = centreOf(target);
      const dx = at.x - centre.x;
      const dy = at.y - centre.y;
      const distance = Math.hypot(dx, dy);
      if (distance > reach) continue;
      const inFront = dx * this.facingX >= 0 || distance < this.tileSize * HALF;
      if (!inFront) continue;
      if (!this.dealDamage(target, ROD_SWIPE_DAMAGE, ROD_SWIPE_ATTACK_TYPE)) continue;
      const pushX = distance === 0 ? this.facingX : dx;
      const pushY = distance === 0 ? this.facingY : dy;
      target.applyKnockback(
        pushX,
        pushY,
        SWIPE_KNOCKBACK_TILES * this.tileSize,
        SWIPE_KNOCKBACK_FRAMES,
      );
    }
  }

  private advanceSlamTell(action: Extract<Action, { kind: 'slam_tell' }>): void {
    action.elapsed++;
    if (action.elapsed < action.tellFrames) return;
    this.action = {
      kind: 'slam',
      elapsed: 0,
      windup: this.minimumWindup('slam', SLAM_IMPACT_FRAME),
      origin: action.origin,
      lanes: action.lanes,
      followUps: action.followUps,
      struck: false,
    };
  }

  private advanceSlam(action: Extract<Action, { kind: 'slam' }>): void {
    action.elapsed++;
    if (!action.struck && action.elapsed >= action.windup) {
      action.struck = true;
      this.launchWaves(action.origin, action.lanes);
    }
    if (action.elapsed < strikeLength('slam', action.windup)) return;
    const target = this.currentTarget;
    if (action.followUps > 0 && target !== null && target.isAlive && !this.fleeing) {
      this.beginSlamTell(target, this.pacing(), action.followUps - 1);
      return;
    }
    this.endAction();
  }

  private launchWaves(origin: WorldPoint, lanes: readonly WorldPoint[]): void {
    for (const dir of lanes) {
      this.waves.push({
        originX: origin.x,
        originY: origin.y,
        dirX: dir.x,
        dirY: dir.y,
        travelled: 0,
        rangePx: SLAM_WAVE_RANGE_TILES * this.tileSize,
        struck: new Set(),
      });
    }
    this.soundCues.raise('slam');
  }

  /** Where the rods meet the floor on the slam's impact frame. */
  private waveOrigin(): WorldPoint {
    const near = electricGoblinBallAnchor('slam', SLAM_IMPACT_FRAME, 'near', this.facingX);
    const far = electricGoblinBallAnchor('slam', SLAM_IMPACT_FRAME, 'far', this.facingX);
    return {
      x: this.x + ((near.x + far.x) / 2) * this.tileSize,
      y: this.y + ((near.y + far.y) / 2) * this.tileSize,
    };
  }

  /** Back to standing, and the rest before the next ranged attack begins. */
  private endAction(): void {
    const wasRanged = this.action.kind !== 'ready' && this.action.kind !== 'swipe';
    this.action = { kind: 'ready' };
    if (!wasRanged) return;
    const furyRest = ATTACK_REST_FRAMES * FURY_PACING[this.furyStage()].restScale;
    this.attackRest = this.restFor(furyRest);
  }

  // ── Pacing ─────────────────────────────────────────────────────────────────

  private pacing(): ElectricGoblinPacing {
    return ELECTRIC_GOBLIN_PACING[settings.difficulty];
  }

  /** A tell of `baseFrames` on this difficulty, never under the fairness floor. */
  private tellFor(baseFrames: number, pace: ElectricGoblinPacing): number {
    return Math.max(LOCKED_TELEGRAPH_MIN_FRAMES, Math.round(baseFrames * pace.tellScale));
  }

  /** A strike row's wind-up, its frames before the event at the row's pace, scaled like a tell. */
  private windupFor(
    row: 'grenade_toss' | 'swipe',
    eventFrame: number,
    pace: ElectricGoblinPacing,
  ): number {
    const authored = eventFrame * ticksPerPaintedFrame(ELECTRIC_GOBLIN_ROWS[row].fps);
    return this.tellFor(authored, pace);
  }

  /**
   * The plunge and the slam come straight out of a tell that already warned
   * for the difficulty's length, so their own wind-up runs at the row's pace.
   */
  private minimumWindup(row: 'plunge' | 'slam', eventFrame: number): number {
    return eventFrame * ticksPerPaintedFrame(ELECTRIC_GOBLIN_ROWS[row].fps);
  }

  private restFor(baseFrames: number): number {
    return Math.round(this.scaledCooldownFrames(baseFrames) * this.pacing().cooldownScale);
  }

  // ── Missiles ───────────────────────────────────────────────────────────────

  /**
   * Half the missiles that reach him while he is free: standing, walking or
   * running. Never in an attack's wind-up or recovery, which is the opening the
   * fight teaches.
   */
  protected override blocksProjectile(_kind: BlockableProjectile): boolean {
    if (!this.isAlive) return false;
    if (!BLOCKING_ACTIONS.has(this.action.kind)) return false;
    return worldRandom() < MISSILE_BLOCK_CHANCE;
  }

  protected override playProjectileBlock(_kind: BlockableProjectile): void {
    this.reaction = { row: 'block', elapsed: 0 };
    this.soundCues.raise('block');
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  /**
   * His grenades, waves and charged puddle keep going here rather than in
   * `updateAI`, which a seized or held boss skips: a grenade already in the air
   * still lands.
   */
  override tickTimers(): void {
    super.tickTimers();
    this.gaitPx += this.ownStridePx;
    this.idleFrames++;
    this.noticeHurt();
    if (this.reaction !== null) {
      this.reaction.elapsed++;
      if (this.reaction.elapsed >= reactionLength(this.reaction.row)) this.reaction = null;
    }
    if (!this.isAlive) {
      this.grenades.length = 0;
      this.bursts.length = 0;
      this.waves.length = 0;
      this.charge = null;
      return;
    }
    this.advanceBursts();
    this.advanceGrenades();
    this.advanceWaves();
    this.advanceCharge();
  }

  private noticeHurt(): void {
    const hurt = this.hp < this.lastHp;
    this.lastHp = this.hp;
    if (!hurt || !this.isAlive) return;
    this.soundCues.raise('hurt');
    if (this.action.kind === 'ready' && this.reaction === null) {
      this.reaction = { row: 'hurt', elapsed: 0 };
    }
  }

  private advanceGrenades(): void {
    const ringPx = SHOCK_GRENADE_RADIUS_TILES * this.tileSize;
    let burst = false;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const grenade = this.grenades[i];
      grenade.elapsed++;
      if (grenade.elapsed < grenade.flightFrames) continue;
      this.grenades.splice(i, 1);
      this.bursts.push({ x: grenade.landX, y: grenade.landY, elapsed: 0 });
      burst = true;
      for (const target of this.party) {
        if (!target.isAlive) continue;
        const at = centreOf(target);
        if (Math.hypot(at.x - grenade.landX, at.y - grenade.landY) > ringPx) continue;
        if (this.dealRangedDamage(target, SHOCK_GRENADE_DAMAGE, SHOCK_GRENADE_ATTACK_TYPE)) {
          target.applyStatus(makeElectrified(this));
        }
      }
    }
    if (burst) this.soundCues.raise('grenadeBurst');
  }

  private advanceBursts(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.elapsed++;
      if (burst.elapsed >= SHOCK_BURST_FRAMES) this.bursts.splice(i, 1);
    }
  }

  private advanceWaves(): void {
    const halfWidthPx = SLAM_WAVE_HALF_WIDTH_TILES * this.tileSize;
    const halfDepthPx = SLAM_WAVE_DEPTH_TILES * this.tileSize * HALF;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i];
      wave.travelled += SLAM_WAVE_SPEED_PX;
      const frontX = wave.originX + wave.dirX * wave.travelled;
      const frontY = wave.originY + wave.dirY * wave.travelled;
      const blocked =
        this.map !== null &&
        !this.map.isWalkable(
          Math.floor(frontX / this.tileSize),
          Math.floor(frontY / this.tileSize),
        );
      if (blocked || wave.travelled >= wave.rangePx) {
        this.waves.splice(i, 1);
        continue;
      }
      for (const target of this.party) {
        if (!target.isAlive || wave.struck.has(target)) continue;
        const at = centreOf(target);
        const offsetX = at.x - wave.originX;
        const offsetY = at.y - wave.originY;
        const along = offsetX * wave.dirX + offsetY * wave.dirY;
        const across = Math.abs(offsetX * wave.dirY - offsetY * wave.dirX);
        if (Math.abs(along - wave.travelled) > halfDepthPx || across > halfWidthPx) continue;
        wave.struck.add(target);
        this.dealRangedDamage(target, SLAM_WAVE_DAMAGE, SLAM_WAVE_ATTACK_TYPE);
      }
    }
  }

  /** The charged puddle bites everyone standing in it, on its own beat; his boots keep him out of it. */
  private advanceCharge(): void {
    const charge = this.charge;
    if (charge === null) return;
    const puddle = this.arena?.puddles[charge.puddle];
    charge.framesLeft--;
    if (puddle === undefined || charge.framesLeft <= 0) {
      this.charge = null;
      return;
    }
    if (charge.biteIn > 0) {
      charge.biteIn--;
      return;
    }
    charge.biteIn = CHARGED_PUDDLE_BITE_FRAMES;
    for (const target of this.party) {
      if (!target.isAlive || !this.isIn(puddle, centreOf(target))) continue;
      const bite = Math.ceil(target.maxHp * CHARGED_PUDDLE_MAX_HP_SHARE_PER_BITE);
      if (this.harmless) continue;
      target.takeDamage(bite, {
        kind: 'mob',
        mobType: this.mobType,
        attackType: CHARGED_PUDDLE_ATTACK_TYPE,
        undodgeable: true,
        from: this.centre(),
      });
    }
  }

  // ── Hazards for companions ─────────────────────────────────────────────────

  /**
   * Which way a party body whose top-left is (x, y) should step to get clear
   * of anything he is about to land: a grenade's ring, a puddle charging or
   * charged, a wave or the lane of a slam about to send one. Null when clear.
   */
  hazardEscape(gameMap: Pick<GameMap, 'isWalkable'>, x: number, y: number): HazardEscape | null {
    if (!this.isAlive) return null;
    const marginPx = HAZARD_MARGIN_TILES * this.tileSize;
    const zones: CircleHazardZone[] = this.grenades.map((g) => ({
      x: g.landX,
      y: g.landY,
      radiusPx: SHOCK_GRENADE_RADIUS_TILES * this.tileSize + marginPx,
    }));
    const fromRings = escapeFromCircleZones(gameMap, zones, x, y);
    if (fromRings !== null) return fromRings;

    const body = { x: x + this.tileSize * HALF, y: y + this.tileSize * HALF };
    const charge = this.puddleCharge;
    const puddle = charge.kind === 'none' ? undefined : this.arena?.puddles[charge.puddle];
    if (puddle !== undefined && this.isIn(puddle, body)) {
      return this.escapeFromPuddle(gameMap, puddle, body);
    }

    const halfWidthPx = SLAM_WAVE_HALF_WIDTH_TILES * this.tileSize + marginPx;
    const strips: Strip[] = [
      ...this.waves.map((wave) => ({
        ox: wave.originX,
        oy: wave.originY,
        dirX: wave.dirX,
        dirY: wave.dirY,
        fromAlong: wave.travelled - marginPx,
        toAlong: wave.rangePx,
      })),
      ...this.slamLanes.map((lane) => ({
        ox: lane.fromX,
        oy: lane.fromY,
        dirX: lane.dirX,
        dirY: lane.dirY,
        fromAlong: 0,
        toAlong: lane.lengthPx,
      })),
    ];
    return escapeFromStrips(strips, halfWidthPx, body);
  }

  private escapeFromPuddle(
    gameMap: Pick<GameMap, 'isWalkable'>,
    puddle: LabPuddle,
    body: WorldPoint,
  ): HazardEscape {
    const tx = Math.floor(body.x / this.tileSize);
    const ty = Math.floor(body.y / this.tileSize);
    let best: HazardEscape | null = null;
    let bestDistance = Infinity;
    for (let dy = -PUDDLE_ESCAPE_SEARCH_TILES; dy <= PUDDLE_ESCAPE_SEARCH_TILES; dy++) {
      for (let dx = -PUDDLE_ESCAPE_SEARCH_TILES; dx <= PUDDLE_ESCAPE_SEARCH_TILES; dx++) {
        const cx = tx + dx;
        const cy = ty + dy;
        const dry = { x: (cx + HALF) * this.tileSize, y: (cy + HALF) * this.tileSize };
        if (this.isIn(puddle, dry) || !gameMap.isWalkable(cx, cy)) continue;
        const distance = Math.hypot(dry.x - body.x, dry.y - body.y);
        if (distance >= bestDistance || distance === 0) continue;
        best = { dx: (dry.x - body.x) / distance, dy: (dry.y - body.y) / distance };
        bestDistance = distance;
      }
    }
    return best ?? { dx: 0, dy: -1 };
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  private centre(): WorldPoint {
    return centreOf(this);
  }

  private isIn(puddle: LabPuddle, point: WorldPoint): boolean {
    const tx = Math.floor(point.x / this.tileSize);
    const ty = Math.floor(point.y / this.tileSize);
    return puddle.tiles.some((t) => t.x === tx && t.y === ty);
  }

  /**
   * Where in a puddle he plunges: the tile deepest inside it (farthest from
   * dry floor), and of those the nearest to the puddle's middle, so the
   * charge he stands in surrounds him on every side.
   */
  private plungeSpotOf(index: number): TilePoint | undefined {
    const puddle = this.arena?.puddles[index];
    if (puddle === undefined) return undefined;
    const known = this.plungeSpots.get(puddle);
    if (known !== undefined) return known;
    const depth = puddleDepths(puddle);
    const middle = puddleCentroid(puddle);
    let best: TilePoint | undefined;
    let bestDepth = -1;
    let bestDistance = Infinity;
    for (const tile of puddle.tiles) {
      if (this.map !== null && !this.map.isWalkable(tile.x, tile.y)) continue;
      const tileDepth = depth.get(labTileKey(tile.x, tile.y)) ?? 0;
      const distance = Math.hypot(tile.x - middle.x, tile.y - middle.y);
      const deeper = tileDepth > bestDepth;
      const asDeepButNearer = tileDepth === bestDepth && distance < bestDistance;
      if (!deeper && !asDeepButNearer) continue;
      best = tile;
      bestDepth = tileDepth;
      bestDistance = distance;
    }
    if (best !== undefined) this.plungeSpots.set(puddle, best);
    return best;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  /** The row and frame he is drawn in this frame. */
  private get spriteRow(): { readonly row: ElectricGoblinRow; readonly frame: number } {
    const action = this.action;
    switch (action.kind) {
      case 'grenade_toss':
        return {
          row: 'grenade_toss',
          frame: strikeFrame('grenade_toss', action.elapsed, action.windup),
        };
      case 'plunge_tell':
        return { row: 'plunge_tell', frame: this.tellFrame('plunge_tell', action.elapsed) };
      case 'plunge':
        return { row: 'plunge', frame: strikeFrame('plunge', action.elapsed, action.windup) };
      case 'swipe':
        return { row: 'swipe', frame: strikeFrame('swipe', action.elapsed, action.windup) };
      case 'slam_tell':
        return { row: 'slam_tell', frame: this.tellFrame('slam_tell', action.elapsed) };
      case 'slam':
        return { row: 'slam', frame: strikeFrame('slam', action.elapsed, action.windup) };
      case 'ready':
      case 'seek_puddle':
        return this.standingRow();
      default:
        return assertNever(action);
    }
  }

  private standingRow(): { readonly row: ElectricGoblinRow; readonly frame: number } {
    if (this.reaction !== null) {
      const spec = ELECTRIC_GOBLIN_ROWS[this.reaction.row];
      const frame = Math.floor(this.reaction.elapsed / ticksPerPaintedFrame(spec.fps));
      return { row: this.reaction.row, frame: Math.min(spec.frames - 1, frame) };
    }
    if (this.isMoving) {
      const row = this.fleeing ? 'run' : 'walk';
      const spec = ELECTRIC_GOBLIN_ROWS[row];
      const cyclePx = spec.groundPerCycleTiles * this.tileSize;
      const phase = (this.gaitPx % cyclePx) / cyclePx;
      return { row, frame: Math.floor(phase * spec.frames) % spec.frames };
    }
    const idle = ELECTRIC_GOBLIN_ROWS.idle;
    const frame = Math.floor((this.idleFrames * idle.fps) / FRAMES_PER_SECOND) % idle.frames;
    return { row: 'idle', frame };
  }

  private tellFrame(row: 'plunge_tell' | 'slam_tell', elapsed: number): number {
    const painted = Math.floor((elapsed * ELECTRIC_GOBLIN_ROWS[row].fps) / FRAMES_PER_SECOND);
    return electricGoblinTellFrame(row, painted);
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
    const { row, frame } = this.spriteRow;
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawElectricGoblinSprite(ctx, { x: sx, y: sy, tileSize, facingX: this.facingX, row, frame });
    });
    this.renderMobHealthBar(ctx, sx, sy, artTopY);
  }
}

function centreOf(body: { readonly x: number; readonly y: number }): WorldPoint {
  return { x: body.x + TILE_CENTRE_PX, y: body.y + TILE_CENTRE_PX };
}

/** Where a body's centre sits from its top-left, in world pixels. */
const TILE_CENTRE_PX = TILE_SIZE * HALF;

/**
 * The angle two lanes from one origin must splay so their centre lines are
 * `spacingPx` apart at `distancePx` out; a right angle when they cannot be.
 */
function spreadKeeping(spacingPx: number, distancePx: number): number {
  if (distancePx <= spacingPx) return Math.PI * HALF;
  return Math.asin(spacingPx / distancePx);
}

/** A unit vector turned by `angle` radians. */
function rotateUnit(v: WorldPoint, angle: number): WorldPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** The mean of a puddle's tiles, in tiles: its middle whatever its shape. */
function puddleCentroid(puddle: LabPuddle): WorldPoint {
  let x = 0;
  let y = 0;
  for (const tile of puddle.tiles) {
    x += tile.x;
    y += tile.y;
  }
  return { x: x / puddle.tiles.length, y: y / puddle.tiles.length };
}

/**
 * Each puddle tile's depth: how many 4-connected steps it lies from the
 * nearest tile that is not puddle, keyed by `labTileKey`. An edge tile is 1.
 */
function puddleDepths(puddle: LabPuddle): Map<number, number> {
  const depth = new Map<number, number>();
  const frontier: TilePoint[] = [];
  for (const tile of puddle.tiles) {
    const onEdge = NEIGHBOUR_STEPS.some(
      (step) => !puddle.keys.has(labTileKey(tile.x + step.x, tile.y + step.y)),
    );
    if (!onEdge) continue;
    depth.set(labTileKey(tile.x, tile.y), 1);
    frontier.push(tile);
  }
  // The loop reads tiles pushed onto the frontier as it runs: a breadth-first walk inward.
  for (const tile of frontier) {
    const next = (depth.get(labTileKey(tile.x, tile.y)) ?? 0) + 1;
    for (const step of NEIGHBOUR_STEPS) {
      const key = labTileKey(tile.x + step.x, tile.y + step.y);
      if (!puddle.keys.has(key) || depth.has(key)) continue;
      depth.set(key, next);
      frontier.push({ x: tile.x + step.x, y: tile.y + step.y });
    }
  }
  return depth;
}

const NEIGHBOUR_STEPS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function unitToward(from: WorldPoint, to: WorldPoint): WorldPoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? null : { x: dx / length, y: dy / length };
}

/** A lane of ground: from (ox, oy) along (dirX, dirY), between `fromAlong` and `toAlong`. */
interface Strip {
  readonly ox: number;
  readonly oy: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly fromAlong: number;
  readonly toAlong: number;
}

/** Where `body` sits against a strip: how far along it and how far to one side of its line. */
function stripOffset(strip: Strip, body: WorldPoint): { along: number; across: number } {
  const offsetX = body.x - strip.ox;
  const offsetY = body.y - strip.oy;
  return {
    along: offsetX * strip.dirX + offsetY * strip.dirY,
    across: offsetX * -strip.dirY + offsetY * strip.dirX,
  };
}

function inStrip(strip: Strip, halfWidth: number, body: WorldPoint): boolean {
  const { along, across } = stripOffset(strip, body);
  return along >= strip.fromAlong && along <= strip.toAlong && Math.abs(across) <= halfWidth;
}

/**
 * Square out of whichever strip `body` stands in, `halfWidth` either side of
 * its line: towards the side it already leans, unless a step that way lands
 * in another strip (a slam's flanking lane) and the other side does not.
 */
function escapeFromStrips(
  strips: readonly Strip[],
  halfWidth: number,
  body: WorldPoint,
): HazardEscape | null {
  const holding = strips.find((strip) => inStrip(strip, halfWidth, body));
  if (holding === undefined) return null;
  const lean = stripOffset(holding, body).across >= 0 ? 1 : -1;
  const clearOf = (side: number): boolean => {
    const stepPx = halfWidth * 2;
    const landing = {
      x: body.x - holding.dirY * side * stepPx,
      y: body.y + holding.dirX * side * stepPx,
    };
    return !strips.some((strip) => inStrip(strip, halfWidth, landing));
  };
  const side = clearOf(lean) || !clearOf(-lean) ? lean : -lean;
  return { dx: -holding.dirY * side, dy: holding.dirX * side };
}

function assertNever(value: never): never {
  throw new Error(`unhandled Current Goblin state ${JSON.stringify(value)}`);
}
