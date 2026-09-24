import { BOSS_BLAST_DAMAGE_SCALE, Mob } from './Mob';
import type { LootDrop, PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import {
  drawGrotesqueSpiderPoseSprite,
  grotesqueSpiderFacingRotation,
  grotesqueSpiderRoarAttackFrame,
  prewarmGrotesqueSpiderAttack,
  releaseGrotesqueSpiderDeath,
  type GrotesqueSpiderSpritePose,
  type GrotesqueSpiderState,
} from '../sprites/grotesqueSpiderSprite';
import { prewarmSpiderEgg } from '../sprites/spiderEggSprite';
import {
  drawSpitProjectile,
  drawSpitTrapSplat,
  drawSpitTrapIdle,
  drawSpitTrapEvaporate,
  prewarmSpitEffects,
} from '../sprites/grotesqueSpiderSpitSprite';
import {
  drawSpiderGroundTelegraphs,
  drawSpiderTelegraphOutlines,
} from './grotesqueSpiderTelegraphs';
import { makeStuck, makeSpitVenom } from '../core/StatusEffect';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import { PLAYER_HIT_FLASH_MARGIN_TILES } from '../Player';
import { hasRoomToMove } from '../map/findWalkableTile';
import type { GameMap } from '../map/GameMap';
import { pushPlayerWithCollision } from '../systems/playerDisplacement';
import { SEPARATION_RADIUS } from '../systems/mobSeparation';
import { FLOATING_LABEL_FRAMES } from '../systems/FloatingCombatTextSystem';
import { clamp } from '../utils';
import {
  attackStageAt,
  audioSeekSeconds,
  audioStartFrame,
  isInsideScreech,
  isInsideSlamCone,
  LAY_EGG_FRAMES,
  MAX_EGG_CLUTCH_SIZE,
  PHASE_ROAR_BUILD_FRAMES,
  PHASE_ROAR_TOTAL_FRAMES,
  recoveryStartFrame,
  SCREECH_RADIUS_PX,
  SLAM_CONE_HALF_ANGLE_RAD,
  SLAM_CONE_RADIUS_PX,
  SPIDER_ATTACK_TIMELINES,
  SPIDER_DAMAGING_ATTACKS,
  strikeFrame,
  totalFrames,
} from './grotesqueSpiderTimeline';
import type {
  SlamImpact,
  SpiderAttack,
  SpiderAttackStage,
  SpiderImpactEvent,
} from './grotesqueSpiderTimeline';

const SPIDER_HP = 2400;
const SPIDER_SPEED = 2.5;
const DASH_SPEED_MULTIPLIER = 2.5;
/** Her sprint toward a rooted player: pressure, never a hit on its own. */
const DASH_SPEED = SPIDER_SPEED * DASH_SPEED_MULTIPLIER;

/** How close a target must be for her to start a slam; inside the cone's reach so the cone always covers them. */
const SLAM_START_RANGE_TILES = 2;
export const SLAM_START_RANGE_PX = TILE_SIZE * SLAM_START_RANGE_TILES;
const TOUCHING_RANGE_TILE_MULTIPLIER = 1.5;
const TOUCHING_RANGE_PX = TILE_SIZE * TOUCHING_RANGE_TILE_MULTIPLIER;

/**
 * Spit glob speed as a multiple of `PLAYER_SPEED`: the fairness cap on a scaled
 * projectile is written against how fast the player can step out of its way.
 */
const SPIT_SPEED_PLAYER_SPEED_RATIO = 3.2;
export const SPIT_SPEED_PX = PLAYER_SPEED * SPIT_SPEED_PLAYER_SPEED_RATIO;
export const SPIT_ANIM_CYCLE_FRAMES = 8;
/** Keeps the glob's reach at roughly the lab's width. */
const SPIT_TTL = 110;
/**
 * Frames of glob flight the spit aim line covers. Past that stretch the glob has
 * flown long enough that stepping aside is easy, so a longer line would only
 * clutter the floor.
 */
const SPIT_AIM_LINE_FLIGHT_FRAMES = 40;
const SPIT_AIM_LINE_PX = SPIT_SPEED_PX * SPIT_AIM_LINE_FLIGHT_FRAMES;
/** She may creep forward while gathering a spit, at this share of her speed, until the aim locks. */
const SPIT_TELL_WALK_SPEED_FRACTION = 0.5;

/** Seek into the slam impact sound; non-zero only if its lead-in outgrows the run-up. */
export const SLAM_AUDIO_SEEK_SECONDS = audioSeekSeconds('slam');
/** Seek into the screech impact sound; non-zero only if its lead-in outgrows the run-up. */
export const SCREECH_AUDIO_SEEK_SECONDS = audioSeekSeconds('screech');

const SPIDER_LAB_ROOM_TILES_WIDE = 40;
const SPIDER_LAB_ROOM_TILES_TALL = 32;
const SPIDER_LAB_ROOM_DIAGONAL_PX =
  TILE_SIZE * Math.ceil(Math.hypot(SPIDER_LAB_ROOM_TILES_WIDE, SPIDER_LAB_ROOM_TILES_TALL));
const CHASE_ABANDON_PX = SPIDER_LAB_ROOM_DIAGONAL_PX;
const VISION_RANGE_PX = SPIDER_LAB_ROOM_DIAGONAL_PX;
/** Within this many tiles of a last sighting she gives up the chase. */
const LAST_KNOWN_ARRIVAL_TILES = 2;

/** A puddle persists this long: 60 s. */
const TRAP_TTL = 3600;
const TRAP_SPLAT_TICKS_PER_FRAME = 6;
const TRAP_IDLE_TICKS_PER_FRAME = 8;

/** How long a spit hit or a puddle roots a player. */
export const SPIDER_ROOT_FRAMES = 90;
/**
 * After a root ends, the freed player cannot be re-rooted for this long, so a
 * player released in the middle of a puddle can always walk out of it.
 */
export const ROOT_IMMUNITY_FRAMES = 60;
/** Puddles standing at once; laying another dries up the oldest. */
export const MAX_SPIT_PUDDLES = 5;
/** Frames an overflowing puddle takes to dry up; it catches nobody while it does. */
export const PUDDLE_EVAPORATE_FRAMES = 30;
/**
 * Slack between "the root runs out" and "the lock begins" when deciding whether
 * an area attack may start. A status ticks down in the player's own update,
 * which can land either side of hers in a frame.
 */
const ROOT_CLEAR_MARGIN_FRAMES = 2;

/**
 * Compass directions the escape probe walks a crawler along. Keyboard movement
 * only has these eight, so an escape that needs any angle in between is one a
 * keyboard player cannot make.
 */
const ESCAPE_PROBE_DIRECTIONS = 8;
/**
 * How far past an area attack's outline the probe's walk must end, within the
 * lock, before the attack may start. The hit test reads the crawler's centre,
 * so a walk that only just grazes the outline is a coin-flip on rounding and on
 * whether the player's first step lands on the first lock tick or the next.
 */
const ESCAPE_CLEARANCE_MARGIN_PX = 6;

/**
 * Frames every attack may be refused, with the target in reach and her gap
 * over, before she backs off to somewhere an attack is fair.
 */
const STALEMATE_REPOSITION_FRAMES = 45;
/** How far from the target, in tiles, the spot she backs off to may be. */
const REPOSITION_MIN_TILES = 2;
const REPOSITION_MAX_TILES = 3;
/** Within this of the spot she has arrived. */
const REPOSITION_ARRIVAL_TILE_FRACTION = 0.0625;
export const REPOSITION_ARRIVAL_PX = TILE_SIZE * REPOSITION_ARRIVAL_TILE_FRACTION;
/** A walk to the spot that has not arrived by now is given up (a blocked path, a moved target). */
export const REPOSITION_TIMEOUT_FRAMES = 180;

/*
 * The screech circle and the slam cone both paint the floor for well over a
 * second before they land, so both are priced as a share of the victim's own
 * max HP: flat across levels, heavy enough that ignoring the warning hurts, and
 * short of a one-shot so reading the fight can be learnt by trying.
 */
const SCREECH_BLOCK_XP = 10;
export const SCREECH_HP_FRACTION = 0.8;
const SCREECH_BONUS_DAMAGE = 4;

const SLAM_BLOCK_XP = 8;
export const SLAM_HP_FRACTION = 0.6;
const SLAM_BONUS_DAMAGE = 6;

const SHELL_BLOCK_XP = 8;
const SPIT_DAMAGE_MIN = 8;
const SPIT_DAMAGE_MAX = 12;
export const SPIT_HIT_RADIUS_FRACTION = 0.75;
/**
 * How far from a puddle's centre it still grabs a player, in tiles.
 *
 * Exported so the art gate that checks the puddle is visible out to here reads
 * the radius from the rule rather than restating it: widening the grab without
 * widening the art is a hazard with no tell.
 */
export const TRAP_HIT_RADIUS_FRACTION = 0.9;

/** Player damage taken during a recovery window is multiplied by this. */
export const EXPOSED_DAMAGE_MULTIPLIER = 1.5;
const EXPOSED_TEXT = 'EXPOSED';
/**
 * One "EXPOSED" label on screen at a time: a repeat held off for as long as a
 * label lives, so a second never rises alongside the first.
 */
const EXPOSED_TEXT_THROTTLE_FRAMES = FLOATING_LABEL_FRAMES;
/** Frames the exposed-hit tint shows after a bonus-damage blow. */
const EXPOSED_HIT_FLASH_FRAMES = 10;
/** Gold rather than white, so a bonus-damage blow reads differently from an ordinary one. */
const EXPOSED_HIT_FILTER = 'sepia(1) saturate(5) brightness(1.8)';
/**
 * Her ordinary hit flash. The whole party hits her at once, so the standard
 * flash would cover her art on most frames; hers is shorter, fainter, and
 * cannot fire again until a quiet window has passed.
 */
const SPIDER_HIT_FLASH_FRAMES = 6;
const SPIDER_HIT_FLASH_RETRIGGER_FRAMES = 24;
/** Peak strength of her flash as a share of the standard one; low enough that it never reaches its white core. */
const SPIDER_HIT_FLASH_STRENGTH = 0.45;
/** Opacity of a crawler redrawn over her body when her art hides it. */
const OCCLUDED_PLAYER_ALPHA = 0.55;

let occludedPlayerSurface: CanvasSurface | null = null;
let occludedPlayerCtx: CanvasRenderingContext2D | null = null;
let occludedPlayerSurfaceSize = 0;

/**
 * Reused, grow-only scratch canvas that an occluded crawler is painted into at
 * full opacity before being dimmed in one blit; see `renderOneOccludedPlayer`.
 * A fight can have several crawlers behind her at once, every frame she is on
 * screen, so this is never allocated per player per frame.
 */
function occludedPlayerScratch(size: number): {
  surface: CanvasSurface;
  ctx: CanvasRenderingContext2D;
} {
  if (
    occludedPlayerSurface === null ||
    occludedPlayerCtx === null ||
    occludedPlayerSurfaceSize < size
  ) {
    occludedPlayerSurfaceSize = Math.max(occludedPlayerSurfaceSize, size);
    occludedPlayerSurface = allocCanvas(occludedPlayerSurfaceSize, occludedPlayerSurfaceSize);
    occludedPlayerCtx = surfaceContext(occludedPlayerSurface);
  }
  return { surface: occludedPlayerSurface, ctx: occludedPlayerCtx };
}

/** HP phases: 1 above two thirds of her HP, 2 above one third, 3 below. */
export type SpiderHpPhase = 1 | 2 | 3;
const FINAL_HP_PHASE = 3;
const PHASE_TWO_HP_FRACTION = 0.66;
const PHASE_THREE_HP_FRACTION = 0.33;

/**
 * One entry of a phase's attack cycle. `area` resolves to a slam or a screech
 * by range; `spitChain` is a spit that, once it resolves, commits her to a
 * slam as the next attack.
 */
type CycleStep = 'area' | 'spit' | 'lay' | 'spitChain';

interface HpPhaseConfig {
  readonly cycle: readonly CycleStep[];
  /** The middle of the gap between attacks; the jitter spreads it either side. */
  readonly gapCentreFrames: number;
  /** Eggs per lay; 0 means she does not lay in this phase. */
  readonly clutchSize: number;
}

/** Eggs per clutch in each HP phase. */
export const EGG_CLUTCH_SIZE: Readonly<Record<SpiderHpPhase, number>> = {
  1: 0,
  2: 2,
  3: MAX_EGG_CLUTCH_SIZE,
};

const HP_PHASES: Readonly<Record<SpiderHpPhase, HpPhaseConfig>> = {
  1: { cycle: ['area', 'spit'], gapCentreFrames: 78, clutchSize: EGG_CLUTCH_SIZE[1] },
  2: {
    cycle: ['area', 'spit', 'area', 'lay'],
    gapCentreFrames: 62,
    clutchSize: EGG_CLUTCH_SIZE[2],
  },
  3: {
    cycle: ['area', 'spitChain', 'area', 'lay', 'spit'],
    gapCentreFrames: 50,
    clutchSize: EGG_CLUTCH_SIZE[FINAL_HP_PHASE],
  },
};

/** The random spread either side of a phase's gap centre; the only randomness in her rhythm. */
export const ATTACK_GAP_JITTER_FRAMES = 5;
/** No gap between attacks is ever shorter than this, whatever the phase or the jitter. */
export const ATTACK_GAP_FLOOR_FRAMES = 45;
/** The pause before her first attack of an engagement, so the fight opens on a chase rather than a hit. */
export const FIRST_ATTACK_GAP_FRAMES = 60;
/**
 * After a blow lands, her next strike must arrive within this share of the
 * victim's own potion cooldown, so a crawler who drinks straight after the hit
 * is still recharging when the follow-up lands. Under 1 by more than Iron
 * Stomach's per-level shave, so a well-trained stomach does not undo it.
 */
const FOLLOW_UP_POTION_WINDOW_FRACTION = 0.75;
/**
 * The shortest gap a follow-up may be squeezed to. Her tells and locks are
 * fixed by the locked-telegraph rule, so a very fast potion cooldown cannot be
 * beaten outright; this keeps some breath between recovery and the next tell.
 */
const FOLLOW_UP_GAP_FLOOR_FRAMES = 15;
/** The same attack may run at most this many times back to back. */
const MAX_SAME_ATTACK_IN_A_ROW = 2;
/** How long a spit chain waits for its slam to become legal before she drops it. */
const CHAIN_SLAM_PATIENCE_FRAMES = 150;

/** The longest tell-plus-lock of any attack that can hit, the worst case a follow-up gap must budget for. */
const LONGEST_DAMAGING_WINDUP_FRAMES = Math.max(
  ...SPIDER_DAMAGING_ATTACKS.map((attack) => strikeFrame(attack)),
);

/** Eggs plus hatchlings alive at once; a lay that would exceed it does not start. */
export const MAX_LIVE_EGGS_AND_HATCHLINGS = 10;
/** Minimum frames between two lays, since the live cap limits how many, not how often. */
export const LAY_COOLDOWN_FRAMES = 400;
/** How deep, in tiles, the band behind her that eggs land in is. */
const EGG_BAND_DEPTH_TILES = 1.5;
/** How squarely behind her an egg must land: the cosine of the widest allowed angle off straight back. */
const EGG_BEHIND_MIN_ALIGNMENT = 0.5;
/** Chebyshev distance between eggs; 2 leaves a clear tile between any two. */
const MIN_EGG_SPACING_TILES = 2;

/** A tile an egg sits or should drop on. */
export interface SpiderEggTile {
  readonly tileX: number;
  readonly tileY: number;
}

/** A rectangle of tiles, in tile coordinates. */
export interface SpiderBroodBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What the spider needs to know from whatever owns her brood before she can
 * lay. She does not spawn eggs herself; she only decides where they drop and
 * queues the tiles in {@link GrotesqueSpider.drainEggLayRequests}. Without a
 * context she never lays.
 */
export interface SpiderBroodContext {
  /** The room eggs must land inside, in tiles. */
  readonly bounds: SpiderBroodBounds;
  /** Eggs plus hatchlings currently alive, counted against {@link MAX_LIVE_EGGS_AND_HATCHLINGS}. */
  liveBroodCount(): number;
  /** Tiles of every egg currently on the floor, so a new one keeps its distance. */
  eggTiles(): ReadonlyArray<SpiderEggTile>;
}

/** Undrained events kept at most; a headless run with no system draining them must not grow without bound. */
const MAX_PENDING_EVENTS = 16;

const COIN_DROP_MIN = 50;
const COIN_DROP_MAX = 100;
const MASS = 6;

/** Tile center offset (0.5 of tile size). */
const TILE_CENTER = 0.5;
/** How far past her own tile her legs reach in any facing, in tiles. */
const SPIDER_ART_REACH_TILES = 2.5;
/**
 * The nearest an egg lands to her centre, in tiles: just past where her
 * abdomen is drawn, so a fresh egg is never half hidden under her body.
 */
export const EGG_MIN_DISTANCE_TILES = SPIDER_ART_REACH_TILES;
/** The farthest an egg lands from her centre, in tiles. */
export const EGG_MAX_DISTANCE_TILES = EGG_MIN_DISTANCE_TILES + EGG_BAND_DEPTH_TILES;
const OWN_TILE_SPAN_TILES = 1;

/** The row each attack plays, read by both the pose lookup and the prewarm. */
const ATTACK_SPRITE_STATES: Readonly<Record<SpiderAttack, GrotesqueSpiderState>> = {
  spit: 'attack_spit',
  screech: 'attack_screech',
  slam: 'attack_slam',
  lay: 'attack_lay',
};

/**
 * Frames the death row takes to play: legs curling, sac tearing, spill
 * spreading. Counted on the corpse clock, which only runs while the world does.
 */
export const DEATH_ANIM_FRAMES = 90;
/** How long her body lies where she fell, then how long it takes to fade. */
const CORPSE_LINGER_FRAMES = 1800;
const CORPSE_FADE_FRAMES = 180;
/**
 * The most ground one tick may add to the walk clock. The mob separation pass
 * can shove her several times her own step in one tick, and a gait driven by
 * that raw distance skips frames and strobes.
 */
const MAX_WALK_PX_PER_TICK = PLAYER_SPEED * 2;
/** Moving less than this in a tick is standing still, not walking. */
const WALK_MIN_PX_PER_TICK = 0.05;

const ROAM_TIMER_MIN = 300;
const ROAM_TIMER_MAX = 600;
const ROAM_SPEED_FRACTION = 0.5;
const ROAM_PICK_ATTEMPTS = 30;
const ROAM_BORDER_MARGIN = 3;
const ROAM_MIN_TILE = 2;
const ROAM_ARRIVAL_TILES = 2;

const MS_PER_SECOND = 1000;

interface SpitProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  animFrame: number;
  ttl: number;
}

/** A spit puddle on the floor, as the renderer and the brood placement read it. */
export interface SpitPuddle {
  x: number;
  y: number;
  phase: 'splat' | 'idle';
  frameTimer: number;
  animFrame: number;
  ttl: number;
  /** Frames of drying left, or null while the puddle is live. */
  evaporateFramesLeft: number | null;
}

/** 0 while a puddle is live, rising to 1 as an overflowing one dries up. */
export function puddleEvaporateProgress(puddle: Readonly<SpitPuddle>): number {
  if (puddle.evaporateFramesLeft === null) return 0;
  return 1 - puddle.evaporateFramesLeft / PUDDLE_EVAPORATE_FRAMES;
}

interface RootWatch {
  wasRooted: boolean;
  immunityFrames: number;
}

type SpiderMode = 'idle' | 'pursuing' | 'attacking' | 'roaring';

/** Frames left on a player's root, 0 if they are free. */
export function spiderRootFramesRemaining(player: Player): number {
  let remaining = 0;
  for (const effect of player.statusEffects) {
    if (effect.type === 'stuck') remaining = Math.max(remaining, effect.ticksRemaining);
  }
  return remaining;
}

function hpPhaseForFraction(hpFraction: number): SpiderHpPhase {
  if (hpFraction > PHASE_TWO_HP_FRACTION) return 1;
  if (hpFraction > PHASE_THREE_HP_FRACTION) return 2;
  return FINAL_HP_PHASE;
}

export class GrotesqueSpider extends Mob {
  /** Not every system that runs this boss sets `isBoss`, so the blast share is claimed here rather than read from it. */
  override get blastDamageScale(): number {
    return BOSS_BLAST_DAMAGE_SCALE;
  }

  /**
   * Her splayed legs reach well past her tile on every side, since she is
   * rotated to any facing. Left at the mob default the composite would clip
   * them square for the whole of a burn or a hit flash.
   */
  protected override get silhouetteMarginTiles(): number {
    return Math.max(super.silhouetteMarginTiles, SPIDER_ART_REACH_TILES);
  }

  /**
   * The pipeline culls on her top-left corner, so legs reaching out of her
   * far side sit a whole tile further from that corner than her reach alone.
   */
  override get cullMarginTiles(): number {
    return SPIDER_ART_REACH_TILES + OWN_TILE_SPAN_TILES;
  }

  /**
   * A punish blow is tinted gold by `drawSelf`; the standard red silhouette
   * flash painted over it would hide that tint for most of its life.
   */
  protected override hitFlashProgress(): number {
    if (this.exposedHitFlash > 0) return 0;
    // The strike and its impact hold are the frames a player reads contact
    // on, so no tint may cover them.
    if (this.attackStage === 'strike') return 0;
    if (this.shownHitFlash <= 0) return 0;
    return (this.shownHitFlash / SPIDER_HIT_FLASH_FRAMES) * SPIDER_HIT_FLASH_STRENGTH;
  }

  /** Frames left on her visible hit flash; see {@link SPIDER_HIT_FLASH_FRAMES}. */
  private shownHitFlash = 0;
  /** Frames until a fresh hit may flash her again. */
  private hitFlashQuiet = 0;
  /** `damageFlash` as the last tick left it, so a fresh hit shows as a rise. */
  private damageFlashLastTick = 0;

  /**
   * Every source of harm sets `damageFlash` directly, so a fresh hit is read
   * off it rising since the last tick rather than hooked at each source.
   */
  override tickTimers(): void {
    const freshHit = this.damageFlash > this.damageFlashLastTick;
    super.tickTimers();
    this.damageFlashLastTick = this.damageFlash;
    if (this.shownHitFlash > 0) this.shownHitFlash--;
    if (this.hitFlashQuiet > 0) this.hitFlashQuiet--;
    if (freshHit && this.hitFlashQuiet === 0) {
      this.shownHitFlash = SPIDER_HIT_FLASH_FRAMES;
      this.hitFlashQuiet = SPIDER_HIT_FLASH_RETRIGGER_FRAMES;
    }
  }

  readonly xpValue = 2000;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Grotesque Spider';
  description = 'An enormous arachnid horror that roams the dungeon. Run.';
  mass = MASS;
  override readonly audioTag = 'grotesque_spider';

  slamSoundPending = false;
  screechSoundPending = false;
  /** An impact sound already started for a blow that will now never land; see {@link drainCancelledAttackAudio}. */
  private cancelledAttackAudio: 'slam' | 'screech' | null = null;
  spitFireSoundPending = false;
  spitLandSoundPending = false;

  /**
   * Every roll her fight makes — gap jitter, spit damage, egg tiles, roaming —
   * goes through this, so a headless gate can seed the whole fight.
   */
  rng: () => number = Math.random;

  override get requiresEvasion(): boolean {
    return true;
  }

  private mode: SpiderMode = 'idle';
  private _currentAttack: SpiderAttack | null = null;
  private _attackFrame = 0;
  private _lockedAimX = 1;
  private _lockedAimY = 0;
  /** Set by the lab cutscene: the scene fires its own glob, so the strike must not fire another. */
  private cutsceneDriven = false;

  private gapTimer = FIRST_ATTACK_GAP_FRAMES;
  /** The tightest follow-up window earned by blows landed this attack, or null if none landed. */
  private followUpWindowFrames: number | null = null;
  private cycleIndex = 0;
  private lastAttack: SpiderAttack | null = null;
  private sameAttackRun = 0;
  private chainArmed = false;
  private chainSlamPatience = 0;
  private reachedPhase: SpiderHpPhase = 1;
  private _roarFrame = 0;

  private layCooldown = 0;
  private layClutch = 0;
  private layDroppedTiles: SpiderEggTile[] = [];
  private broodContext: SpiderBroodContext | null = null;

  private eggLayRequests: SpiderEggTile[] = [];
  private slamImpacts: SlamImpact[] = [];
  private impactEvents: SpiderImpactEvent[] = [];

  private rootWatch = new WeakMap<Player, RootWatch>();
  private exposedHitFlash = 0;

  private dashTarget: Player | null = null;

  // Locks onto active player; grace window after character switch before retargeting
  private preferredTarget: Player | null = null;
  private retargetCooldown = 0;
  private static readonly RETARGET_DELAY = 360;

  private activeProjectile: SpitProjectile | null = null;
  /** The crawler the current (or last) spit was aimed at; only meaningful while one is pending. */
  private spitTarget: Player | null = null;
  /** The crawler the current attack was started on, the only one its aim may follow. */
  private attackTarget: Player | null = null;
  /** Her distance from the target when the current spit was chosen. */
  private spitStartDistancePx = 0;
  /** Frames in a row every attack has been refused with the target in reach. */
  private stalemateFrames = 0;
  /** The open floor she is walking to after a stalemate, top-left in world pixels. */
  private repositionSpot: { x: number; y: number } | null = null;
  private repositionFramesLeft = 0;
  /** The last spot she timed out walking to; the next search passes it over. */
  private unreachedRepositionSpot: { x: number; y: number } | null = null;
  /** The spot she just arrived at, until her first attack decision there. */
  private arrivedRepositionSpot: { x: number; y: number } | null = null;
  /** The last spot whose arrival found no fair attack; the next search passes it over. */
  private refusedRepositionSpot: { x: number; y: number } | null = null;
  private groundTraps: SpitPuddle[] = [];

  override clearAirborneAttacks(): void {
    this.groundTraps = [];
    this.activeProjectile = null;
  }

  private roamTarget: { tx: number; ty: number } | null = null;
  private roamTimer = 0;

  // True while the spider is chasing to a last-known player position after losing LOS.
  private chasingToLastKnown = false;

  /** The spider lab's boss, run by its quest rather than a boss room. */
  override get countsAsBossKill(): boolean {
    return true;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SPIDER_HP, SPIDER_SPEED);
  }

  /** The attack she is committed to, or null between attacks and during a roar. */
  get currentAttack(): SpiderAttack | null {
    return this._currentAttack;
  }

  /** Frames since the current attack's first tell tick; meaningful only while {@link currentAttack} is set. */
  get attackFrame(): number {
    return this._attackFrame;
  }

  /** The stage of the current attack, or null when none is running. */
  get attackStage(): SpiderAttackStage | null {
    if (this._currentAttack === null) return null;
    return attackStageAt(this._currentAttack, this._attackFrame).stage;
  }

  /**
   * Unit vector of her aim: it tracks the target through the tell and is frozen
   * from the first lock tick on. The spit's glob and the slam's cone both use it.
   */
  get lockedAimX(): number {
    return this._lockedAimX;
  }

  get lockedAimY(): number {
    return this._lockedAimY;
  }

  /** True during a recovery window (an attack's or a roar's), when she takes {@link EXPOSED_DAMAGE_MULTIPLIER}. */
  get isExposed(): boolean {
    // The cutscene's spit is staged, not a fight: its recovery is no window
    // anyone could have earned, and there is no fight yet to punish her in.
    if (this.cutsceneDriven) return false;
    if (this.mode === 'roaring') return this._roarFrame >= PHASE_ROAR_BUILD_FRAMES;
    if (this._currentAttack === null) return false;
    return this._attackFrame >= recoveryStartFrame(this._currentAttack);
  }

  /** The highest HP phase this fight has reached. */
  get hpPhase(): SpiderHpPhase {
    return this.reachedPhase;
  }

  /**
   * Frames into the phase-change roar, or null when she is not roaring. The
   * roar bursts harmlessly at `PHASE_ROAR_BUILD_FRAMES` and she stands exposed
   * until `PHASE_ROAR_TOTAL_FRAMES`.
   */
  get roarFrame(): number | null {
    return this.mode === 'roaring' ? this._roarFrame : null;
  }

  /** Frames left on the bonus-damage hit tint; the renderer's cue that the last blow landed exposed. */
  get exposedHitFlashFrames(): number {
    return this.exposedHitFlash;
  }

  /** Every puddle on the floor, including ones drying up (see {@link puddleEvaporateProgress}). */
  get spitPuddles(): ReadonlyArray<Readonly<SpitPuddle>> {
    return this.groundTraps;
  }

  /**
   * Tells her where she may lay and how many of her brood are alive. Pass null
   * to stop her laying.
   */
  setBroodContext(context: SpiderBroodContext | null): void {
    this.broodContext = context;
  }

  /** One tile per egg that dropped since the last drain; the caller spawns the eggs. */
  drainEggLayRequests(): Array<{ tileX: number; tileY: number }> {
    const requests = this.eggLayRequests;
    this.eggLayRequests = [];
    return requests;
  }

  /** The cone of every slam that struck since the last drain, so its owner can crush eggs inside it. */
  drainSlamImpacts(): Array<SlamImpact> {
    const impacts = this.slamImpacts;
    this.slamImpacts = [];
    return impacts;
  }

  /** Every strike tick since the last drain, for camera shake, decals and flashes. */
  drainImpactFeedback(): Array<SpiderImpactEvent> {
    const events = this.impactEvents;
    this.impactEvents = [];
    return events;
  }

  /**
   * Drops whatever attack, roar, chain or cycle position she is in and starts
   * the sequencer over from phase 1. Puddles and an in-flight glob are cleared
   * separately by `clearAirborneAttacks`.
   */
  resetAttackState(): void {
    this.cancelAttackAudioInFlight();
    this.mode = 'idle';
    this._currentAttack = null;
    this._attackFrame = 0;
    this.cutsceneDriven = false;
    this.gapTimer = FIRST_ATTACK_GAP_FRAMES;
    this.followUpWindowFrames = null;
    this.cycleIndex = 0;
    this.lastAttack = null;
    this.sameAttackRun = 0;
    this.chainArmed = false;
    this.chainSlamPatience = 0;
    this.reachedPhase = 1;
    this._roarFrame = 0;
    this.layCooldown = 0;
    this.layClutch = 0;
    this.layDroppedTiles = [];
    this.eggLayRequests = [];
    this.slamImpacts = [];
    this.impactEvents = [];
    this.exposedHitFlash = 0;
    this.dashTarget = null;
    this.spitTarget = null;
    this.attackTarget = null;
    this.clearReposition();
    this.unreachedRepositionSpot = null;
    this.arrivedRepositionSpot = null;
    this.refusedRepositionSpot = null;
    this.slamSoundPending = false;
    this.screechSoundPending = false;
  }

  /**
   * She plants her legs while a slam or screech builds. The attack's start
   * checks judged the fight from where she stood, so a shove during the tell or
   * lock would carry her reach onto a crawler those checks cleared: one still
   * rooted, or one too cornered to walk out in time. Only for the build: she is
   * a wall for at most a tell and a lock, never for good, and a crawler pressed
   * into her is still pushed out, since the crawler takes its own share of the
   * shove regardless.
   */
  override applySeparation(dx: number, dy: number): void {
    if (this.isBuildingAreaAttack) return;
    super.applySeparation(dx, dy);
  }

  /** A hireling's charge would carry her just as far as a shove, so a build shrugs it off too. */
  override advanceKnockback(): void {
    if (this.isBuildingAreaAttack) {
      this.clearKnockback();
      return;
    }
    super.advanceKnockback();
  }

  private get isBuildingAreaAttack(): boolean {
    const attack = this._currentAttack;
    if (attack !== 'slam' && attack !== 'screech') return false;
    return this._attackFrame < strikeFrame(attack);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    releaseGrotesqueSpiderDeath();
    this.corpseFrames = 0;
    this.walkDistancePx = 0;
    this.walkedThisTick = false;
    this.lastWalkX = Number.NaN;
    this.lastWalkY = Number.NaN;
    this.resetAttackState();
    this.preferredTarget = null;
    this.retargetCooldown = 0;
    // Standing ground traps and an in-flight spit are damage fields left over
    // from the encounter that killed the player — leaving them would chip a
    // freshly-respawned crawler who hasn't gone anywhere near the spider yet.
    this.activeProjectile = null;
    this.groundTraps = [];
    this.roamTarget = null;
    this.roamTimer = 0;
    this.chasingToLastKnown = false;
  }

  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * A blow that lands during a recovery window hits harder, and says so. Only
   * blows with an attacker count: a status tick is not a punish.
   */
  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const punishes = this.isExposed && attacker !== null && amount > 0;
    if (!punishes) {
      super.takeDamageFrom(amount, attacker, damageType);
      this.prewarmDeathIfNear();
      return;
    }
    const hpBefore = this.hp;
    super.takeDamageFrom(Math.ceil(amount * EXPOSED_DAMAGE_MULTIPLIER), attacker, damageType);
    this.prewarmDeathIfNear();
    if (this.hp < hpBefore) {
      this.exposedHitFlash = EXPOSED_HIT_FLASH_FRAMES;
      this.queueFloatingText(EXPOSED_TEXT, 'exposed', {
        throttleFrames: EXPOSED_TEXT_THROTTLE_FRAMES,
      });
    }
  }

  /**
   * Warms the death row once she is in her last HP phase, on every hit taken
   * there. Re-requested per hit rather than once, because a row nothing draws
   * is released after the cache's idle window, and a long final phase outlasts
   * it; a request for a row already warm costs nothing.
   */
  private prewarmDeathIfNear(): void {
    if (!this.isAlive || this.maxHp <= 0) return;
    if (this.hp / this.maxHp > PHASE_THREE_HP_FRACTION) return;
    prewarmGrotesqueSpiderAttack('death');
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    this.trackWalkDistance();

    this.tickRootWatch(targets);
    if (this.exposedHitFlash > 0) this.exposedHitFlash--;
    if (this.layCooldown > 0) this.layCooldown--;
    this.updateProjectile(targets);
    this.updateGroundTraps(targets);

    const activePlayer = targets.find((t) => t.isActive && t.isAlive) ?? null;

    if (this.retargetCooldown > 0) {
      this.retargetCooldown--;
      if (!this.preferredTarget?.isAlive) {
        this.preferredTarget = activePlayer;
        this.retargetCooldown = 0;
      }
    } else {
      if (activePlayer && activePlayer !== this.preferredTarget) {
        if (this.hasLOS(activePlayer)) {
          this.preferredTarget = activePlayer;
        }
      } else if (!this.preferredTarget?.isAlive) {
        this.preferredTarget = activePlayer;
      }
    }

    if (
      activePlayer !== null &&
      this.preferredTarget !== null &&
      activePlayer !== this.preferredTarget &&
      this.retargetCooldown === 0
    ) {
      this.retargetCooldown = GrotesqueSpider.RETARGET_DELAY;
    }

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (this.hasLOS(t) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    if (this.preferredTarget?.isAlive && this.hasLOS(this.preferredTarget)) {
      nearest = this.preferredTarget;
      nearestDist = Math.hypot(this.preferredTarget.x - this.x, this.preferredTarget.y - this.y);
    }

    this.currentTarget = nearest;

    // Chase persistence: keep heading toward the last known player position after losing LOS,
    // unless the last known spot is already further than the abandon threshold.
    if (targets.every((t) => !t.isAlive)) {
      this.chasingToLastKnown = false;
    } else if (nearest !== null) {
      this.chasingToLastKnown = true;
    } else if (this.chasingToLastKnown) {
      // Measured to where players actually are, not where they were last seen,
      // so she reacts to a player truly escaping.
      let closestPlayerDist = Infinity;
      for (const t of targets) {
        if (!t.isAlive) continue;
        closestPlayerDist = Math.min(closestPlayerDist, Math.hypot(t.x - this.x, t.y - this.y));
      }
      if (closestPlayerDist > CHASE_ABANDON_PX) {
        this.chasingToLastKnown = false;
      }
    }

    if (this.dashTarget) {
      if (!this.dashTarget.isAlive || !this.dashTarget.hasStatus('stuck')) {
        this.dashTarget = null;
      }
    }

    switch (this.mode) {
      case 'idle':
      case 'pursuing':
        this.doPursuingState(nearest, nearestDist, targets);
        break;
      case 'attacking':
        this.advanceAttack(targets);
        break;
      case 'roaring':
        this.advanceRoar();
        break;
    }
  }

  /** Notes every player whose root just ended and counts their re-root immunity down. */
  private tickRootWatch(targets: Player[]): void {
    for (const t of targets) {
      let watch = this.rootWatch.get(t);
      if (watch === undefined) {
        watch = { wasRooted: false, immunityFrames: 0 };
        this.rootWatch.set(t, watch);
      }
      const rooted = t.hasStatus('stuck');
      if (watch.wasRooted && !rooted) {
        watch.immunityFrames = ROOT_IMMUNITY_FRAMES;
      } else if (watch.immunityFrames > 0) {
        watch.immunityFrames--;
      }
      watch.wasRooted = rooted;
    }
  }

  /** Roots a player unless they already are, or were freed too recently. Returns whether it took. */
  private tryRoot(target: Player): boolean {
    if (target.hasStatus('stuck')) return false;
    if ((this.rootWatch.get(target)?.immunityFrames ?? 0) > 0) return false;
    if (this.wouldTrapInPendingAreaStrike(target)) return false;
    if (this.wouldTrapUnderPendingSpit(target)) return false;
    target.applyStatus(makeStuck(SPIDER_ROOT_FRAMES));
    return true;
  }

  /**
   * A spit only starts on a crawler who is free to move, and its glob is dodged
   * by walking off the locked line. A puddle that rooted that crawler while the
   * spit still builds, or while its glob is in the air, would take the dodge
   * away after the fact. Protects only the crawler the spit is aimed at: anyone
   * else the glob meets was never the one being asked to read it.
   */
  private wouldTrapUnderPendingSpit(target: Player): boolean {
    if (target !== this.spitTarget) return false;
    const spitBuilding = this._currentAttack === 'spit' && this._attackFrame < strikeFrame('spit');
    const globInFlight = this.activeProjectile !== null;
    return spitBuilding || globInFlight;
  }

  /**
   * A puddle or a stray spit glob roots on contact, same as a fresh hit; that
   * root outlasts a slam or screech's remaining run-up, so if it landed while
   * one of those is still building it would deliver the very thing the area
   * attack's own start check exists to prevent: a player caught with no window
   * to move before the strike. Checked against the attack's own reach, not the
   * puddle's, since the rule is about the strike catching a rooted player, not
   * about where the root itself was applied.
   */
  private wouldTrapInPendingAreaStrike(target: Player): boolean {
    const attack = this._currentAttack;
    if (attack !== 'slam' && attack !== 'screech') return false;
    if (this._attackFrame >= strikeFrame(attack)) return false;
    const reach = attack === 'slam' ? SLAM_CONE_RADIUS_PX : SCREECH_RADIUS_PX;
    const ts = this.tileSize;
    const targetCentreX = target.x + ts * TILE_CENTER;
    const targetCentreY = target.y + ts * TILE_CENTER;
    return Math.hypot(targetCentreX - this.centreX, targetCentreY - this.centreY) <= reach;
  }

  private doPursuingState(nearest: Player | null, nearestDist: number, targets: Player[]): void {
    const phase = hpPhaseForFraction(this.maxHp > 0 ? this.hp / this.maxHp : 1);
    if (phase > this.reachedPhase) {
      this.reachedPhase = phase;
      this.startRoar();
      return;
    }

    // Backing off a stalemate often breaks sight of the target for a moment;
    // the walk is already bounded by its timeout, and dropping it here would
    // restart the stalemate from scratch every time.
    if (this.repositionSpot !== null) {
      if (nearest !== null) this.updateLastKnown(nearest);
      this.continueRepositioning(this.repositionSpot);
      return;
    }

    if (!nearest) {
      this.gapTimer = Math.max(this.gapTimer, FIRST_ATTACK_GAP_FRAMES);
      if (this.chasingToLastKnown) {
        this.mode = 'pursuing';
        const ts = this.tileSize;
        const dx = this.lastKnownTargetX - this.x;
        const dy = this.lastKnownTargetY - this.y;
        const distToKnown = Math.hypot(dx, dy);
        if (distToKnown < ts * LAST_KNOWN_ARRIVAL_TILES) {
          this.chasingToLastKnown = false;
          this.mode = 'idle';
          this.doRoam();
          return;
        }
        this.facingX = dx / distToKnown;
        this.facingY = dy / distToKnown;
        this.followTargetAStar(
          this.lastKnownTargetX,
          this.lastKnownTargetY,
          this.speed,
          ts * LAST_KNOWN_ARRIVAL_TILES,
        );
        return;
      }
      this.mode = 'idle';
      this.doRoam();
      return;
    }

    this.mode = 'pursuing';
    this.updateLastKnown(nearest);
    if (this.gapTimer > 0) this.gapTimer--;
    if (this.chainSlamPatience > 0) this.chainSlamPatience--;

    if (this.gapTimer <= 0) {
      const attack = this.chooseNextAttack(nearest, nearestDist, targets);
      const arrivedAt = this.arrivedRepositionSpot;
      this.arrivedRepositionSpot = null;
      if (attack !== null) {
        this.startAttack(attack, nearest, targets);
        return;
      }
      if (arrivedAt !== null) this.refusedRepositionSpot = arrivedAt;
    }

    const stalled = this.gapTimer <= 0 && nearestDist <= SCREECH_RADIUS_PX;
    this.stalemateFrames = stalled ? this.stalemateFrames + 1 : 0;
    if (this.stalemateFrames >= STALEMATE_REPOSITION_FRAMES) {
      this.stalemateFrames = 0;
      const spot = this.tryBeginReposition(nearest, targets);
      if (spot !== null) {
        this.continueRepositioning(spot);
        return;
      }
    }

    const chaseTarget = this.dashTarget ?? nearest;
    const speed = this.dashTarget ? DASH_SPEED : this.speed;
    this.faceToward(chaseTarget);
    this.followTargetAStar(
      this.dashTarget ? this.dashTarget.x : this.lastKnownTargetX,
      this.dashTarget ? this.dashTarget.y : this.lastKnownTargetY,
      speed,
      TOUCHING_RANGE_PX,
    );
  }

  /**
   * Picks open floor a short way off the target from which some attack would
   * pass every fairness check, and commits her to walking there.
   *
   * Those checks can refuse everything she has, for as long as a crawler
   * stays put: one tucked up a dead end with her in its mouth can be neither
   * slammed, screeched nor spat at fairly, and would get to hit her for free.
   * Backing off to a spot the checks accept breaks that without bending them.
   *
   * A crawler she has been pressing on is usually shoved a little off its
   * tile, and from where it truly stands every spot may fail by a pixel or
   * two. So a spot is judged twice: from the target's true position and from
   * the target standing square on its tile. A spot that passes both is
   * preferred; failing that, one that passes only the squared-up judgement is
   * an optimistic guess that the crawler will be standing on its tile when
   * she arrives. Nothing makes it so: the real decision on arrival reads
   * where everyone truly stands, and a spot whose arrival found nothing fair
   * is passed over next time, as is the last spot she failed to reach.
   *
   * A spot must also see the target, or she would lose it on arrival and the
   * stalemate would start over. Within each tier the nearest spot wins,
   * scanned in a fixed order, so the choice is deterministic. Returns the
   * spot, or null when none within reach qualifies; she then keeps pursuing
   * and asks again after another stalemate.
   */
  private tryBeginReposition(target: Player, targets: Player[]): { x: number; y: number } | null {
    const map = this.map;
    if (map === null) return null;
    const ts = this.tileSize;
    const bounds = this.escapeProbeBounds();
    const targetTileX = Math.floor((target.x + ts * TILE_CENTER) / ts);
    const targetTileY = Math.floor((target.y + ts * TILE_CENTER) / ts);
    const homeX = this.x;
    const homeY = this.y;
    const targetX = target.x;
    const targetY = target.y;
    const squaredX = targetTileX * ts;
    const squaredY = targetTileY * ts;
    const isPassedOver = (spotX: number, spotY: number): boolean =>
      [this.unreachedRepositionSpot, this.refusedRepositionSpot].some(
        (skipped) => skipped?.x === spotX && skipped.y === spotY,
      );
    const fairWithTargetAt = (standX: number, standY: number): boolean => {
      target.x = standX;
      target.y = standY;
      const reach = Math.hypot(standX - this.x, standY - this.y);
      return (
        this.resolveAreaAttack(target, reach, targets) !== null || this.canStartSpit(target, reach)
      );
    };
    let bestBoth: { x: number; y: number } | null = null;
    let bestBothWalk = Infinity;
    let bestSquaredOnly: { x: number; y: number } | null = null;
    let bestSquaredOnlyWalk = Infinity;
    try {
      for (let dy = -REPOSITION_MAX_TILES; dy <= REPOSITION_MAX_TILES; dy++) {
        for (let dx = -REPOSITION_MAX_TILES; dx <= REPOSITION_MAX_TILES; dx++) {
          const offTarget = Math.hypot(dx, dy);
          if (offTarget < REPOSITION_MIN_TILES || offTarget > REPOSITION_MAX_TILES) continue;
          const tileX = targetTileX + dx;
          const tileY = targetTileY + dy;
          const insideRoom =
            bounds === null ||
            (tileX >= bounds.x &&
              tileX < bounds.x + bounds.w &&
              tileY >= bounds.y &&
              tileY < bounds.y + bounds.h);
          if (!insideRoom || !hasRoomToMove(map, tileX, tileY)) continue;
          const spotX = tileX * ts;
          const spotY = tileY * ts;
          if (isPassedOver(spotX, spotY)) continue;
          const walk = Math.hypot(spotX - homeX, spotY - homeY);
          if (walk >= bestBothWalk) continue;
          target.x = squaredX;
          target.y = squaredY;
          if (!this.spotSeesTarget(map, spotX, spotY, target)) continue;
          this.x = spotX;
          this.y = spotY;
          if (!fairWithTargetAt(squaredX, squaredY)) continue;
          if (fairWithTargetAt(targetX, targetY)) {
            bestBoth = { x: spotX, y: spotY };
            bestBothWalk = walk;
          } else if (walk < bestSquaredOnlyWalk) {
            bestSquaredOnly = { x: spotX, y: spotY };
            bestSquaredOnlyWalk = walk;
          }
        }
      }
    } finally {
      this.x = homeX;
      this.y = homeY;
      target.x = targetX;
      target.y = targetY;
    }
    const best = bestBoth ?? bestSquaredOnly;
    if (best === null) return null;
    this.repositionSpot = best;
    this.repositionFramesLeft = REPOSITION_TIMEOUT_FRAMES;
    return best;
  }

  /** Whether a top-left spot has line of sight from its centre to the target's. */
  private spotSeesTarget(map: GameMap, spotX: number, spotY: number, target: Player): boolean {
    const ts = this.tileSize;
    return map.hasLineOfSight(
      spotX + ts * TILE_CENTER,
      spotY + ts * TILE_CENTER,
      target.x + ts * TILE_CENTER,
      target.y + ts * TILE_CENTER,
    );
  }

  /**
   * One step toward the committed spot. She takes no attack decision until
   * she arrives or the walk times out, so a target shuffling about cannot
   * flip her between backing off and closing in.
   */
  private continueRepositioning(spot: { x: number; y: number }): void {
    this.repositionFramesLeft--;
    const arrived = Math.hypot(this.x - spot.x, this.y - spot.y) <= REPOSITION_ARRIVAL_PX;
    if (arrived || this.repositionFramesLeft <= 0) {
      this.unreachedRepositionSpot = arrived ? null : spot;
      this.arrivedRepositionSpot = arrived ? spot : null;
      this.clearReposition();
      this.isMoving = false;
      return;
    }
    this.followTargetAStar(spot.x, spot.y, this.speed, this.repositionWalkStopPx);
  }

  /**
   * How close the walk to a spot stops. Below the arrival slack on purpose:
   * a walk that stops exactly at the slack lands a hair outside it on a
   * diagonal, where rounding never agrees it has arrived, and she would stand
   * there idle until the walk timed out.
   */
  private get repositionWalkStopPx(): number {
    return 0;
  }

  private clearReposition(): void {
    this.repositionSpot = null;
    this.repositionFramesLeft = 0;
    this.stalemateFrames = 0;
  }

  /**
   * The next eligible attack in this phase's cycle, or null to keep pursuing
   * and ask again next frame. A pending spit chain overrides the cycle: only
   * its slam is considered until it lands or her patience runs out.
   */
  private chooseNextAttack(
    target: Player,
    distance: number,
    targets: Player[],
  ): SpiderAttack | null {
    if (this.chainSlamPatience > 0) {
      return this.canStartAreaAttack('slam', target, distance, targets) ? 'slam' : null;
    }
    const { cycle } = HP_PHASES[this.reachedPhase];
    for (let offset = 0; offset < cycle.length; offset++) {
      const index = (this.cycleIndex + offset) % cycle.length;
      const step = cycle[index];
      const attack = this.resolveStep(step, target, distance, targets);
      if (attack === null) continue;
      this.cycleIndex = (index + 1) % cycle.length;
      this.chainArmed = step === 'spitChain';
      return attack;
    }
    return null;
  }

  private resolveStep(
    step: CycleStep,
    target: Player,
    distance: number,
    targets: Player[],
  ): SpiderAttack | null {
    switch (step) {
      case 'area':
        return this.resolveAreaAttack(target, distance, targets);
      case 'spit':
      case 'spitChain':
        return this.canStartSpit(target, distance) ? 'spit' : null;
      case 'lay':
        return this.canStartLay(target, targets) ? 'lay' : null;
    }
  }

  /**
   * Slam when the target is close enough for the cone, screech otherwise; each
   * falls back to the other when it is the one that has run too often, so a
   * player hugging her can never stall the rotation.
   */
  private resolveAreaAttack(
    target: Player,
    distance: number,
    targets: Player[],
  ): SpiderAttack | null {
    const preferred: readonly ('slam' | 'screech')[] =
      distance <= SLAM_START_RANGE_PX ? ['slam', 'screech'] : ['screech'];
    for (const attack of preferred) {
      if (this.canStartAreaAttack(attack, target, distance, targets)) return attack;
    }
    return this.slamRepeatsInPlaceOfUnfairScreech(target, distance, targets) ? 'slam' : null;
  }

  /**
   * A crawler backed into a wall at her feet can leave the screech no way out
   * within its lock, and at that range the slam is her only other area attack.
   * Held to its run limit as well, she would have nothing left she may do there
   * after two slams, and a player could stand against a wall and hit her for
   * free. So the slam may repeat past its limit in exactly that case; every
   * fairness check still applies to it.
   */
  private slamRepeatsInPlaceOfUnfairScreech(
    target: Player,
    distance: number,
    targets: Player[],
  ): boolean {
    if (distance > SLAM_START_RANGE_PX || !this.hasRunTooOften('slam')) return false;
    if (this.everyoneCaughtCanWalkClear('screech', target, targets)) return false;
    if (this.rootedTargetWouldBeCaught('slam', targets)) return false;
    return this.everyoneCaughtCanWalkClear('slam', target, targets);
  }

  private canStartAreaAttack(
    attack: 'slam' | 'screech',
    target: Player,
    distance: number,
    targets: Player[],
  ): boolean {
    const startRange = attack === 'slam' ? SLAM_START_RANGE_PX : SCREECH_RADIUS_PX;
    if (distance > startRange) return false;
    if (this.hasRunTooOften(attack)) return false;
    if (this.rootedTargetWouldBeCaught(attack, targets)) return false;
    return this.everyoneCaughtCanWalkClear(attack, target, targets);
  }

  /**
   * Whether a player inside this attack's reach would still be rooted when its
   * lock begins. An area attack never starts then, so every player it can reach
   * has at least the whole lock of free movement to get out. Asked again on the
   * first lock tick with no slack, where the answer should always be no.
   */
  private rootedTargetWouldBeCaught(
    attack: 'slam' | 'screech',
    targets: Player[],
    framesUntilLock = SPIDER_ATTACK_TIMELINES[attack].tellFrames,
    slackFrames = ROOT_CLEAR_MARGIN_FRAMES,
  ): boolean {
    const reach = attack === 'slam' ? SLAM_CONE_RADIUS_PX : SCREECH_RADIUS_PX;
    for (const t of targets) {
      if (!t.isAlive) continue;
      if (Math.hypot(t.x - this.x, t.y - this.y) > reach) continue;
      if (spiderRootFramesRemaining(t) + slackFrames > framesUntilLock) return true;
    }
    return false;
  }

  /**
   * Whether an area attack about to lock would catch a rooted crawler, which
   * the start check should already have made impossible. Should anything have
   * rooted one or carried her reach onto one during the tell anyway, she gives
   * the attack up rather than lock on a crawler who cannot move.
   */
  private abandonsLockOnRootedCrawler(attack: 'slam' | 'screech', targets: Player[]): boolean {
    const lockingNow = 0;
    const noSlack = 0;
    return this.rootedTargetWouldBeCaught(attack, targets, lockingNow, noSlack);
  }

  /**
   * Whether every crawler this attack would catch where they stand can walk out
   * of it, over open floor at `PLAYER_SPEED`, within its lock: the one window a
   * crawler is promised to get clear in. Out in the open that is always true;
   * backed against a wall, into a corner or up a dead end, the only way out may
   * run along the edge of the shape and take longer than the lock lasts. Then
   * the attack does not start and she moves on through her cycle, rather than
   * commit to a blow no amount of skill could avoid.
   *
   * Judged as the tell would leave things if nobody moved: the slam cone and the
   * spit's line aimed where `aimAt` would point them at the target, the screech
   * disk on her centre. The walk is held to what a crawler can really do: it
   * stops at walls, at the room's bounds (the fight's room lock clamps a
   * crawler inside them, so its open doorway is no way out), and at her own
   * body, which she keeps planted and which the push between bodies will not
   * let a crawler walk through.
   */
  private everyoneCaughtCanWalkClear(
    attack: Exclude<SpiderAttack, 'lay'>,
    target: Player,
    targets: Player[],
  ): boolean {
    const map = this.map;
    if (map === null) return true;
    const aimDx = target.x - this.x;
    const aimDy = target.y - this.y;
    const aimLength = Math.hypot(aimDx, aimDy);
    const aimX = aimLength === 0 ? this._lockedAimX : aimDx / aimLength;
    const aimY = aimLength === 0 ? this._lockedAimY : aimDy / aimLength;
    const isClear = (centreX: number, centreY: number, marginPx: number): boolean => {
      switch (attack) {
        case 'screech':
          return (
            Math.hypot(centreX - this.centreX, centreY - this.centreY) >
            SCREECH_RADIUS_PX + marginPx
          );
        case 'slam':
          return this.isClearOfSlamCone(aimX, aimY, centreX, centreY, marginPx);
        case 'spit':
          return this.isClearOfSpitLine(aimX, aimY, centreX, centreY, marginPx);
      }
    };
    const bounds = this.escapeProbeBounds();
    const lockFrames = SPIDER_ATTACK_TIMELINES[attack].lockFrames;
    const ts = this.tileSize;
    const centreOffset = ts * TILE_CENTER;
    const alreadyClearMarginPx = 0;
    for (const t of targets) {
      if (!t.isAlive) continue;
      if (isClear(t.x + centreOffset, t.y + centreOffset, alreadyClearMarginPx)) continue;
      let escapes = false;
      for (let direction = 0; direction < ESCAPE_PROBE_DIRECTIONS && !escapes; direction++) {
        const angle = (direction / ESCAPE_PROBE_DIRECTIONS) * Math.PI * 2;
        const stepX = Math.cos(angle) * PLAYER_SPEED;
        const stepY = Math.sin(angle) * PLAYER_SPEED;
        const body = { x: t.x, y: t.y };
        for (let frame = 0; frame < lockFrames && !escapes; frame++) {
          const fromX = body.x;
          const fromY = body.y;
          pushPlayerWithCollision(body, stepX, stepY, map);
          if (bounds !== null) {
            body.x = clamp(body.x, bounds.x * ts, (bounds.x + bounds.w - 1) * ts);
            body.y = clamp(body.y, bounds.y * ts, (bounds.y + bounds.h - 1) * ts);
          }
          if (this.stepRunsIntoHerBody(fromX, fromY, body.x, body.y)) break;
          escapes = isClear(
            body.x + centreOffset,
            body.y + centreOffset,
            ESCAPE_CLEARANCE_MARGIN_PX,
          );
        }
      }
      if (!escapes) return false;
    }
    return true;
  }

  /** Whether a crawler's step from one top-left to another presses into her body. */
  private stepRunsIntoHerBody(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const gapBefore = Math.hypot(fromX - this.x, fromY - this.y);
    const gapAfter = Math.hypot(toX - this.x, toY - this.y);
    return gapAfter < SEPARATION_RADIUS && gapAfter < gapBefore;
  }

  /**
   * The room a crawler is held inside during her fight, in tiles: the quest's
   * room when it has handed her one, else the map's lab, else none.
   */
  private escapeProbeBounds(): SpiderBroodBounds | null {
    return this.broodContext?.bounds ?? this.map?.spiderLabRoom?.bounds ?? null;
  }

  /**
   * Whether a point is more than `marginPx` beyond the spit's hit radius from
   * the line her glob flies along, from her centre toward (aimX, aimY).
   */
  private isClearOfSpitLine(
    aimX: number,
    aimY: number,
    pointX: number,
    pointY: number,
    marginPx: number,
  ): boolean {
    const offsetX = pointX - this.centreX;
    const offsetY = pointY - this.centreY;
    const along = Math.max(0, offsetX * aimX + offsetY * aimY);
    const fromLine = Math.hypot(offsetX - aimX * along, offsetY - aimY * along);
    return fromLine > this.tileSize * SPIT_HIT_RADIUS_FRACTION + marginPx;
  }

  /**
   * Whether a point is more than `marginPx` outside a slam cone from her centre
   * along (aimX, aimY): past the arc, or beside the nearer straight edge.
   */
  private isClearOfSlamCone(
    aimX: number,
    aimY: number,
    pointX: number,
    pointY: number,
    marginPx: number,
  ): boolean {
    const offsetX = pointX - this.centreX;
    const offsetY = pointY - this.centreY;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > SLAM_CONE_RADIUS_PX + marginPx) return true;
    if (distance <= marginPx) return false;
    const alignment = (offsetX * aimX + offsetY * aimY) / distance;
    if (alignment >= Math.cos(SLAM_CONE_HALF_ANGLE_RAD)) return false;
    const side = aimX * offsetY - aimY * offsetX >= 0 ? 1 : -1;
    const edgeAngle = side * SLAM_CONE_HALF_ANGLE_RAD;
    const edgeX = aimX * Math.cos(edgeAngle) - aimY * Math.sin(edgeAngle);
    const edgeY = aimX * Math.sin(edgeAngle) + aimY * Math.cos(edgeAngle);
    const alongEdge = Math.min(SLAM_CONE_RADIUS_PX, Math.max(0, offsetX * edgeX + offsetY * edgeY));
    const fromEdge = Math.hypot(offsetX - edgeX * alongEdge, offsetY - edgeY * alongEdge);
    return fromEdge > marginPx;
  }

  private canStartSpit(target: Player, distance: number): boolean {
    if (distance <= TOUCHING_RANGE_PX) return false;
    if (spiderRootFramesRemaining(target) > 0) return false;
    if (this.hasRunTooOften('spit')) return false;
    return this.everyoneCaughtCanWalkClear('spit', target, [target]);
  }

  private canStartLay(target: Player, targets: Player[]): boolean {
    const clutch = HP_PHASES[this.reachedPhase].clutchSize;
    if (clutch <= 0 || this.layCooldown > 0 || this.hasRunTooOften('lay')) return false;
    const context = this.broodContext;
    if (context === null) return false;
    if (context.liveBroodCount() + clutch > MAX_LIVE_EGGS_AND_HATCHLINGS) return false;
    const away = this.directionAwayFrom(target);
    return this.findEggTile(away.x, away.y, targets, []) !== null;
  }

  private hasRunTooOften(attack: SpiderAttack): boolean {
    return this.lastAttack === attack && this.sameAttackRun >= MAX_SAME_ATTACK_IN_A_ROW;
  }

  private rollInt(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /**
   * The gap after `attack`, squeezed if it landed a blow. The window runs from
   * the blow to the follow-up's strike, so what is left for the gap is the
   * window minus the rest of this attack and the follow-up's own windup.
   */
  private rollFollowUpGap(attack: SpiderAttack): number {
    const window = this.followUpWindowFrames;
    this.followUpWindowFrames = null;
    const normalGap = this.rollGap();
    if (window === null) return normalGap;
    const framesAfterStrike = totalFrames(attack) - strikeFrame(attack);
    const affordableGap = window - framesAfterStrike - LONGEST_DAMAGING_WINDUP_FRAMES;
    return Math.min(normalGap, Math.max(FOLLOW_UP_GAP_FLOOR_FRAMES, affordableGap));
  }

  /** Records that a blow connected, tightening the follow-up window to the victim's potion cooldown. */
  private noteBlowLanded(victim: Player): void {
    const window = Math.floor(victim.computePotionCooldown() * FOLLOW_UP_POTION_WINDOW_FRACTION);
    this.followUpWindowFrames = Math.min(this.followUpWindowFrames ?? window, window);
  }

  private rollGap(): number {
    const centre = HP_PHASES[this.reachedPhase].gapCentreFrames;
    const jitter = this.rollInt(-ATTACK_GAP_JITTER_FRAMES, ATTACK_GAP_JITTER_FRAMES);
    return Math.max(ATTACK_GAP_FLOOR_FRAMES, centre + jitter);
  }

  /**
   * Warms the rows this attack is about to play, at the moment it telegraphs.
   *
   * Her cells are the largest in the game, so a row baked on the frame it is
   * first drawn on is a row baked while the player is being lunged at. The
   * tell is a second or more of warning, which is the room the cache needs.
   */
  private prewarmAttackArt(attack: SpiderAttack): void {
    prewarmGrotesqueSpiderAttack(ATTACK_SPRITE_STATES[attack]);
    if (attack === 'spit') prewarmSpitEffects();
    if (attack === 'lay') prewarmSpiderEgg();
  }

  private startAttack(attack: SpiderAttack, target: Player, targets: Player[]): void {
    this.clearReposition();
    this.attackTarget = target;
    if (attack === 'spit') {
      this.spitTarget = target;
      this.spitStartDistancePx = Math.hypot(target.x - this.x, target.y - this.y);
    }
    this.mode = 'attacking';
    this._currentAttack = attack;
    this._attackFrame = 0;
    this.cutsceneDriven = false;
    this.prewarmAttackArt(attack);
    this.sameAttackRun = this.lastAttack === attack ? this.sameAttackRun + 1 : 1;
    this.lastAttack = attack;
    if (attack === 'slam') this.chainSlamPatience = 0;
    if (attack === 'lay') {
      this.layClutch = HP_PHASES[this.reachedPhase].clutchSize;
      this.layDroppedTiles = [];
      this.layCooldown = LAY_COOLDOWN_FRAMES;
    }
    this.aimAt(target);
    this.runAttackFrame(attack, target, targets);
  }

  private advanceAttack(targets: Player[]): void {
    const attack = this._currentAttack;
    if (attack === null) {
      this.mode = 'pursuing';
      return;
    }
    this._attackFrame++;
    if (this._attackFrame >= totalFrames(attack)) {
      this.finishAttack(attack);
      return;
    }
    this.runAttackFrame(attack, this.trackedAttackTarget(), targets);
  }

  /**
   * The crawler the current attack is still following, or null to hold the
   * last aim. Only the crawler the attack was started on ever passed its root
   * and escape checks, so the aim never moves to anyone else: a target that
   * dies, is knocked out or ducks out of sight leaves the telegraph where it
   * last pointed rather than swinging it onto a crawler never judged fair game.
   */
  private trackedAttackTarget(): Player | null {
    const target = this.attackTarget;
    if (target === null || !target.isAlive || target.isKnockedOut) return null;
    return this.hasLOS(target) ? target : null;
  }

  /** Everything that happens on the current attack frame, keyed off the timeline. */
  private runAttackFrame(attack: SpiderAttack, target: Player | null, targets: Player[]): void {
    const frame = this._attackFrame;
    const timeline = SPIDER_ATTACK_TIMELINES[attack];
    const isTell = frame < timeline.tellFrames;
    const isFirstLockTick = frame === timeline.tellFrames;

    const isAreaAttack = attack === 'slam' || attack === 'screech';
    if (isAreaAttack && isFirstLockTick && this.abandonsLockOnRootedCrawler(attack, targets)) {
      this.cancelAttackAudioInFlight();
      this.finishAttack(attack);
      return;
    }

    // Aim resolves one last time on the first lock tick and is frozen after,
    // so the glob and the cone go where the lock showed rather than where the
    // target walked to since.
    if ((isTell || isFirstLockTick) && target !== null) this.aimAt(target);
    this.facingX = this._lockedAimX;
    this.facingY = this._lockedAimY;

    // The spit started because the target could step off its line from the
    // distance she chose it at; creeping any closer during the tell could
    // close that sidestep off (her body in the mouth of a dead end), so she
    // only creeps to keep up with a target that backs away.
    const keepsUpWithTarget =
      target !== null &&
      Math.hypot(target.x - this.x, target.y - this.y) > this.spitStartDistancePx;
    if (attack === 'spit' && isTell && keepsUpWithTarget) {
      this.followTargetAStar(
        target.x,
        target.y,
        this.speed * SPIT_TELL_WALK_SPEED_FRACTION,
        TOUCHING_RANGE_PX,
      );
    } else {
      this.isMoving = false;
    }

    if (frame === audioStartFrame(attack)) {
      if (attack === 'slam') this.slamSoundPending = true;
      if (attack === 'screech') this.screechSoundPending = true;
    }

    if (frame === strikeFrame(attack)) this.strike(attack, targets);

    if (attack === 'lay') {
      const eggIndex = LAY_EGG_FRAMES.indexOf(frame);
      if (eggIndex >= 0 && eggIndex < this.layClutch) this.dropEgg(targets);
    }
  }

  private finishAttack(attack: SpiderAttack): void {
    this.mode = 'pursuing';
    this._currentAttack = null;
    this._attackFrame = 0;
    this.cutsceneDriven = false;
    this.gapTimer = this.rollFollowUpGap(attack);
    if (attack === 'spit' && this.chainArmed) {
      this.chainSlamPatience = CHAIN_SLAM_PATIENCE_FRAMES;
    }
    this.chainArmed = false;
  }

  /** Points her aim, and her body, from her centre at the target's centre. */
  private aimAt(target: Player): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this._lockedAimX = dx / distance;
    this._lockedAimY = dy / distance;
    this.facingX = this._lockedAimX;
    this.facingY = this._lockedAimY;
  }

  private get centreX(): number {
    return this.x + this.tileSize * TILE_CENTER;
  }

  private get centreY(): number {
    return this.y + this.tileSize * TILE_CENTER;
  }

  private strike(attack: SpiderAttack, targets: Player[]): void {
    if (attack === 'lay') return;
    this.pushBounded(this.impactEvents, {
      attack,
      originX: this.centreX,
      originY: this.centreY,
      dirX: this._lockedAimX,
      dirY: this._lockedAimY,
    });
    switch (attack) {
      case 'slam':
        this.dealSlamDamage(targets);
        break;
      case 'screech':
        this.dealScreechDamage(targets);
        break;
      case 'spit':
        if (!this.cutsceneDriven) this.fireSpitProjectile();
        break;
    }
  }

  private pushBounded<T>(queue: T[], item: T): void {
    queue.push(item);
    if (queue.length > MAX_PENDING_EVENTS) queue.shift();
  }

  private dealScreechDamage(targets: Player[]): void {
    const ts = TILE_SIZE;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const targetCentreX = t.x + ts * TILE_CENTER;
      const targetCentreY = t.y + ts * TILE_CENTER;
      if (!isInsideScreech(this.centreX, this.centreY, targetCentreX, targetCentreY)) continue;
      if (this.spells?.isPointInsideShell(targetCentreX, targetCentreY)) {
        this.spells.addBlockXp(SCREECH_BLOCK_XP);
        continue;
      }
      // Priced as a share of the victim's own health, which already scales
      // with the party; level-scaling it again would multiply it in twice.
      const connected = this.dealPreScaledRangedDamage(
        t,
        Math.ceil(t.maxHp * SCREECH_HP_FRACTION) + SCREECH_BONUS_DAMAGE,
        'screech',
      );
      if (connected) this.noteBlowLanded(t);
    }
  }

  private dealSlamDamage(targets: Player[]): void {
    const impact: SlamImpact = {
      originX: this.centreX,
      originY: this.centreY,
      dirX: this._lockedAimX,
      dirY: this._lockedAimY,
      radiusPx: SLAM_CONE_RADIUS_PX,
      halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
    };
    this.pushBounded(this.slamImpacts, impact);
    const ts = TILE_SIZE;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const targetCentreX = t.x + ts * TILE_CENTER;
      const targetCentreY = t.y + ts * TILE_CENTER;
      if (!isInsideSlamCone(impact, targetCentreX, targetCentreY)) continue;
      if (this.spells?.isPointInsideShell(targetCentreX, targetCentreY)) {
        this.spells.addBlockXp(SLAM_BLOCK_XP);
        continue;
      }
      const connected = this.dealPreScaledRangedDamage(
        t,
        Math.ceil(t.maxHp * SLAM_HP_FRACTION) + SLAM_BONUS_DAMAGE,
        'slam',
      );
      if (connected) this.noteBlowLanded(t);
    }
  }

  private fireSpitProjectile(): void {
    this.activeProjectile = {
      x: this.centreX,
      y: this.centreY,
      vx: this._lockedAimX * SPIT_SPEED_PX,
      vy: this._lockedAimY * SPIT_SPEED_PX,
      angle: Math.atan2(this._lockedAimY, this._lockedAimX),
      animFrame: 0,
      ttl: SPIT_TTL,
    };
    this.spitFireSoundPending = true;
  }

  /**
   * The slam and screech sounds start well before the strike, so their audible
   * hit lands on it. An attack that ends before its strike (given up at the
   * lock, called off, or cut short by her death) would otherwise still play
   * that hit over nothing. Notes the sound so the scene can stop it, and drops
   * a cue raised this same tick that the scene has not played yet.
   */
  private cancelAttackAudioInFlight(): void {
    this.slamSoundPending = false;
    this.screechSoundPending = false;
    const roarStillBuilding = this.mode === 'roaring' && this._roarFrame < PHASE_ROAR_BUILD_FRAMES;
    if (roarStillBuilding) {
      this.cancelledAttackAudio = 'screech';
      return;
    }
    const attack = this._currentAttack;
    if (attack !== 'slam' && attack !== 'screech') return;
    const cueFrame = audioStartFrame(attack);
    const cueStarted = cueFrame !== null && this._attackFrame >= cueFrame;
    if (cueStarted && this._attackFrame < strikeFrame(attack)) this.cancelledAttackAudio = attack;
  }

  /**
   * The attack whose already-started impact sound should be stopped, once; null
   * when none. The scene owns the audio, so it drains this each frame.
   */
  drainCancelledAttackAudio(): 'slam' | 'screech' | null {
    const cancelled = this.cancelledAttackAudio;
    this.cancelledAttackAudio = null;
    return cancelled;
  }

  private startRoar(): void {
    this.clearReposition();
    this.mode = 'roaring';
    this._roarFrame = 0;
    this.isMoving = false;
    this.chainArmed = false;
    this.chainSlamPatience = 0;
    this.screechSoundPending = true;
    prewarmGrotesqueSpiderAttack(ATTACK_SPRITE_STATES.screech);
  }

  private advanceRoar(): void {
    this.isMoving = false;
    this._roarFrame++;
    if (this._roarFrame >= PHASE_ROAR_TOTAL_FRAMES) {
      this.mode = 'pursuing';
      this._roarFrame = 0;
      this.gapTimer = this.rollGap();
    }
  }

  private directionAwayFrom(target: Player): { x: number; y: number } {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return { x: -this.facingX, y: -this.facingY };
    return { x: dx / distance, y: dy / distance };
  }

  private dropEgg(targets: Player[]): void {
    const tile = this.findEggTile(
      -this._lockedAimX,
      -this._lockedAimY,
      targets,
      this.layDroppedTiles,
    );
    if (tile === null) return;
    this.layDroppedTiles.push(tile);
    this.pushBounded(this.eggLayRequests, tile);
  }

  /** The band of distances from her centre, in tiles, that an egg may land in. */
  private eggBandTiles(): { nearestTiles: number; farthestTiles: number } {
    return { nearestTiles: EGG_MIN_DISTANCE_TILES, farthestTiles: EGG_MAX_DISTANCE_TILES };
  }

  /**
   * A random tile `EGG_MIN_DISTANCE_TILES`–`EGG_MAX_DISTANCE_TILES` behind her
   * (along `awayX/awayY`) that is inside the brood bounds, roomy enough to
   * spawn on, not under a player or a puddle, and clear of every other egg;
   * null when none qualifies.
   */
  private findEggTile(
    awayX: number,
    awayY: number,
    targets: Player[],
    alsoAvoid: ReadonlyArray<SpiderEggTile>,
  ): SpiderEggTile | null {
    const context = this.broodContext;
    const map = this.map;
    if (context === null || map === null) return null;
    const ts = this.tileSize;
    const originTileX = Math.floor(this.centreX / ts);
    const originTileY = Math.floor(this.centreY / ts);
    const { bounds } = context;
    const blocked = new Set<string>();
    const tileKey = (tileX: number, tileY: number): string => `${tileX},${tileY}`;
    for (const t of targets) {
      if (!t.isAlive) continue;
      blocked.add(
        tileKey(
          Math.floor((t.x + ts * TILE_CENTER) / ts),
          Math.floor((t.y + ts * TILE_CENTER) / ts),
        ),
      );
    }
    for (const puddle of this.groundTraps) {
      blocked.add(tileKey(Math.floor(puddle.x / ts), Math.floor(puddle.y / ts)));
    }
    const eggs = [...context.eggTiles(), ...alsoAvoid];

    const candidates: SpiderEggTile[] = [];
    const { nearestTiles, farthestTiles } = this.eggBandTiles();
    const scanTiles = Math.ceil(farthestTiles);
    for (let dy = -scanTiles; dy <= scanTiles; dy++) {
      for (let dx = -scanTiles; dx <= scanTiles; dx++) {
        const distance = Math.hypot(dx, dy);
        if (distance < nearestTiles || distance > farthestTiles) continue;
        if ((dx * awayX + dy * awayY) / distance < EGG_BEHIND_MIN_ALIGNMENT) continue;
        const tileX = originTileX + dx;
        const tileY = originTileY + dy;
        const insideBounds =
          tileX >= bounds.x &&
          tileX < bounds.x + bounds.w &&
          tileY >= bounds.y &&
          tileY < bounds.y + bounds.h;
        if (!insideBounds) continue;
        if (blocked.has(tileKey(tileX, tileY))) continue;
        const crowdsAnEgg = eggs.some(
          (egg) =>
            Math.max(Math.abs(egg.tileX - tileX), Math.abs(egg.tileY - tileY)) <
            MIN_EGG_SPACING_TILES,
        );
        if (crowdsAnEgg) continue;
        if (!hasRoomToMove(map, tileX, tileY)) continue;
        candidates.push({ tileX, tileY });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(this.rng() * candidates.length)] ?? null;
  }

  private landSpitOn(target: Player): void {
    if (this.dealRangedDamage(target, this.rollInt(SPIT_DAMAGE_MIN, SPIT_DAMAGE_MAX), 'spit')) {
      target.applyStatus(makeSpitVenom());
      if (this.tryRoot(target)) this.dashTarget = target;
    }
  }

  private updateProjectile(targets: Player[]): void {
    if (!this.activeProjectile) return;
    const proj = this.activeProjectile;

    proj.ttl--;
    if (proj.ttl <= 0) {
      this.spawnGroundTrap(proj.x, proj.y);
      this.activeProjectile = null;
      return;
    }

    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.animFrame = (proj.animFrame + 1) % SPIT_ANIM_CYCLE_FRAMES;

    const ts = this.tileSize;
    if (this.map) {
      if (!this.map.isWalkable(Math.floor(proj.x / ts), Math.floor(proj.y / ts))) {
        // Lands on its last position that was still open floor.
        this.spawnGroundTrap(proj.x - proj.vx, proj.y - proj.vy);
        this.activeProjectile = null;
        return;
      }
    }

    const hitRadius = ts * SPIT_HIT_RADIUS_FRACTION;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const tcx = t.x + ts * TILE_CENTER;
      const tcy = t.y + ts * TILE_CENTER;
      if (Math.hypot(proj.x - tcx, proj.y - tcy) < hitRadius) {
        this.spawnGroundTrap(proj.x, proj.y);
        this.activeProjectile = null;
        if (this.spells?.isPointInsideShell(tcx, tcy)) {
          this.spells.addBlockXp(SHELL_BLOCK_XP);
          return;
        }
        this.landSpitOn(t);
        return;
      }
    }
  }

  private spawnGroundTrap(x: number, y: number): void {
    // Snapped to the tile centre so a puddle never bleeds into wall sprites.
    const ts = this.tileSize;
    const snappedX = (Math.floor(x / ts) + TILE_CENTER) * ts;
    const snappedY = (Math.floor(y / ts) + TILE_CENTER) * ts;
    this.groundTraps.push({
      x: snappedX,
      y: snappedY,
      phase: 'splat',
      frameTimer: TRAP_SPLAT_TICKS_PER_FRAME,
      animFrame: 0,
      ttl: TRAP_TTL,
      evaporateFramesLeft: null,
    });
    this.spitLandSoundPending = true;

    let livePuddles = this.groundTraps.filter((p) => p.evaporateFramesLeft === null).length;
    for (const puddle of this.groundTraps) {
      if (livePuddles <= MAX_SPIT_PUDDLES) break;
      if (puddle.evaporateFramesLeft !== null) continue;
      puddle.evaporateFramesLeft = PUDDLE_EVAPORATE_FRAMES;
      livePuddles--;
    }
  }

  private updateGroundTraps(targets: Player[]): void {
    const ts = this.tileSize;
    const hitRadius = ts * TRAP_HIT_RADIUS_FRACTION;

    this.groundTraps = this.groundTraps.filter((trap) => {
      trap.ttl--;
      if (trap.ttl <= 0) return false;
      this.beginDryingAtEndOfLife(trap);
      if (trap.evaporateFramesLeft !== null) {
        trap.evaporateFramesLeft--;
        return trap.evaporateFramesLeft > 0;
      }

      trap.frameTimer--;
      if (trap.frameTimer <= 0) {
        trap.animFrame++;
        if (trap.phase === 'splat' && trap.animFrame >= SPIT_ANIM_CYCLE_FRAMES) {
          trap.phase = 'idle';
          trap.animFrame = 0;
          trap.frameTimer = TRAP_IDLE_TICKS_PER_FRAME;
        } else if (trap.phase === 'idle') {
          trap.animFrame = trap.animFrame % SPIT_ANIM_CYCLE_FRAMES;
          trap.frameTimer = TRAP_IDLE_TICKS_PER_FRAME;
        } else {
          trap.frameTimer = TRAP_SPLAT_TICKS_PER_FRAME;
        }
      }

      // The splash is still landing; only a settled puddle catches anyone.
      if (trap.phase !== 'idle') return true;

      for (const t of targets) {
        if (!t.isAlive) continue;
        const distance = Math.hypot(
          t.x + ts * TILE_CENTER - trap.x,
          t.y + ts * TILE_CENTER - trap.y,
        );
        if (distance >= hitRadius) continue;
        if (!this.tryRoot(t)) continue;
        t.applyStatus(makeSpitVenom());
        // A web that roots and poisons is this spider fighting the party even
        // though no blow landed; without this the companion reads the fight as
        // nobody's and can be banned off the spider mid-web. Not through a
        // safe room, which nothing reaches through.
        if (t.canBeHarmed) this.noteStruckPlayer(t);
      }

      // A puddle outlives a catch so it can take the other crawler too.
      return true;
    });
  }

  private doRoam(): void {
    this.roamTimer--;
    const ts = this.tileSize;
    if (this.map && (this.roamTimer <= 0 || !this.roamTarget || this.isNearRoamTarget())) {
      this.roamTarget = this.pickRoamTarget();
      this.roamTimer = this.rollInt(ROAM_TIMER_MIN, ROAM_TIMER_MAX);
    }
    if (this.roamTarget && this.map) {
      this.followTargetAStar(
        this.roamTarget.tx * ts,
        this.roamTarget.ty * ts,
        this.speed * ROAM_SPEED_FRACTION,
        ts,
      );
    } else {
      this.isMoving = false;
    }
  }

  private isNearRoamTarget(): boolean {
    if (!this.roamTarget) return true;
    const ts = this.tileSize;
    return (
      Math.hypot(this.roamTarget.tx * ts - this.x, this.roamTarget.ty * ts - this.y) <
      ts * ROAM_ARRIVAL_TILES
    );
  }

  private pickRoamTarget(): { tx: number; ty: number } | null {
    if (!this.map) return null;
    const rows = this.map.structure.length;
    const cols = this.map.structure[0]?.length ?? rows;
    for (let attempt = 0; attempt < ROAM_PICK_ATTEMPTS; attempt++) {
      const tx = this.rollInt(ROAM_MIN_TILE, cols - ROAM_BORDER_MARGIN);
      const ty = this.rollInt(ROAM_MIN_TILE, rows - ROAM_BORDER_MARGIN);
      if (this.map.isWalkable(tx, ty)) return { tx, ty };
    }
    return null;
  }

  protected override hasLOS(target: Player): boolean {
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    if (dist > VISION_RANGE_PX) return false;
    return super.hasLOS(target);
  }

  /**
   * Aims the spider toward the given world-space direction and starts a spit
   * with its aim already locked. Called from SpiderQuestSystem to drive the
   * cutscene spit visual; the scene fires its own glob.
   */
  prepareCutsceneSpit(facingX: number, facingY: number): void {
    this.mode = 'attacking';
    this._currentAttack = 'spit';
    this._attackFrame = 0;
    this.cutsceneDriven = true;
    this.prewarmAttackArt('spit');
    this._lockedAimX = facingX;
    this._lockedAimY = facingY;
    this.facingX = facingX;
    this.facingY = facingY;
  }

  /**
   * Advances the cutscene spit by one frame. Returns true on the strike tick,
   * the frame the scene should launch its glob.
   * Called from SpiderQuestSystem._updateCutscene() instead of the normal AI path.
   */
  tickCutsceneSpit(): boolean {
    if (this.mode !== 'attacking' || this._currentAttack !== 'spit') return false;
    this._attackFrame++;
    if (this._attackFrame >= totalFrames('spit')) {
      this.finishAttack('spit');
      return false;
    }
    return this._attackFrame === strikeFrame('spit');
  }

  /**
   * Renders only the ground spit traps (puddles).
   * Must be called BEFORE entity rendering so players/mobs appear on top.
   */
  renderSpitGroundTraps(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    for (const trap of this.groundTraps) {
      const tx = trap.x - camX;
      const ty = trap.y - camY;
      if (trap.phase === 'splat') {
        drawSpitTrapSplat(ctx, tx, ty, tileSize, trap.animFrame);
        continue;
      }
      const evaporation = puddleEvaporateProgress(trap);
      if (evaporation <= 0) {
        drawSpitTrapIdle(ctx, tx, ty, tileSize, trap.animFrame);
        continue;
      }
      drawSpitTrapEvaporate(ctx, tx, ty, tileSize, evaporation);
    }
  }

  /**
   * Renders only the active in-flight spit projectile.
   * Must be called AFTER entity rendering so the projectile flies over mobs/players.
   */
  renderSpitProjectile(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.activeProjectile) return;
    const proj = this.activeProjectile;
    ctx.save();
    ctx.translate(proj.x - camX, proj.y - camY);
    ctx.rotate(proj.angle);
    drawSpitProjectile(ctx, 0, 0, tileSize, proj.animFrame);
    ctx.restore();
  }

  /** Her body stays where she fell once she dies, so kill resolution keeps her in the world. */
  override readonly rendersWhenDead = true;
  private corpseFrames = 0;
  /** World pixels she has actually moved, which paces her walk. */
  private walkDistancePx = 0;
  private walkedThisTick = false;
  private lastWalkX = Number.NaN;
  private lastWalkY = Number.NaN;

  /**
   * The dead get no AI updates, so the death row runs off its own frame count,
   * advanced by kill resolution only while the world is running.
   */
  override tickCorpse(): void {
    this.corpseFrames++;
    this.advancePuddlesDryingOnHerDeath();
  }

  /**
   * Her glob and puddles are only ever advanced by her own AI, which stops
   * when she dies: a glob would hang in the air and the puddles would stay on
   * the floor for the rest of the level. The glob goes at once; the puddles
   * dry up over the same fade an overflowing puddle uses, rather than pop.
   */
  override dispose(): void {
    super.dispose();
    this.cancelAttackAudioInFlight();
    this.activeProjectile = null;
    this.settleSplashingPuddles();
    for (const puddle of this.groundTraps) {
      puddle.evaporateFramesLeft ??= PUDDLE_EVAPORATE_FRAMES;
    }
  }

  /**
   * A puddle still splashing down is drawn by its splash, which only her AI
   * advances; left as it is when she dies it would hold its splash frame
   * through the whole fade and then vanish. Settled, it dries like any other.
   */
  private settleSplashingPuddles(): void {
    for (const puddle of this.groundTraps) {
      if (puddle.phase !== 'splat') continue;
      puddle.phase = 'idle';
      puddle.animFrame = 0;
      puddle.frameTimer = TRAP_IDLE_TICKS_PER_FRAME;
    }
  }

  /** A puddle whose life is nearly out dries up over its last frames rather than popping. */
  private beginDryingAtEndOfLife(puddle: SpitPuddle): void {
    if (puddle.evaporateFramesLeft !== null) return;
    if (puddle.ttl <= PUDDLE_EVAPORATE_FRAMES) puddle.evaporateFramesLeft = puddle.ttl;
  }

  private advancePuddlesDryingOnHerDeath(): void {
    this.groundTraps = this.groundTraps.filter((puddle) => {
      if (puddle.evaporateFramesLeft === null) return true;
      puddle.evaporateFramesLeft--;
      return puddle.evaporateFramesLeft > 0;
    });
  }

  override get corpseExpired(): boolean {
    return (
      !this.isAlive &&
      this.corpseFrames >= DEATH_ANIM_FRAMES + CORPSE_LINGER_FRAMES + CORPSE_FADE_FRAMES
    );
  }

  /** The corpse holds full strength through its linger, then fades out. */
  private get corpseAlpha(): number {
    const fadeStart = DEATH_ANIM_FRAMES + CORPSE_LINGER_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / CORPSE_FADE_FRAMES);
  }

  /**
   * Adds the ground she covered since last tick to the walk clock. Measured
   * from her position rather than read off `isMoving`, which means "tried to
   * walk", and capped so a separation shove cannot strobe the gait.
   */
  private trackWalkDistance(): void {
    const moved = Number.isNaN(this.lastWalkX)
      ? 0
      : Math.hypot(this.x - this.lastWalkX, this.y - this.lastWalkY);
    this.lastWalkX = this.x;
    this.lastWalkY = this.y;
    this.walkedThisTick = moved > WALK_MIN_PX_PER_TICK;
    this.walkDistancePx += Math.min(moved, MAX_WALK_PX_PER_TICK);
  }

  /**
   * What her sprite shows this frame. Attacks are handed over as their attack
   * frame, so the sprite reads the same timeline the damage does; the walk as
   * distance actually covered, so her feet stay planted at any speed.
   */
  private get spritePose(): GrotesqueSpiderSpritePose {
    if (this.mode === 'roaring') {
      return {
        kind: 'attack',
        attack: 'screech',
        attackFrame: grotesqueSpiderRoarAttackFrame(
          this._roarFrame,
          PHASE_ROAR_BUILD_FRAMES,
          PHASE_ROAR_TOTAL_FRAMES - PHASE_ROAR_BUILD_FRAMES,
        ),
      };
    }
    const attack = this._currentAttack;
    if (attack !== null) {
      return {
        kind: 'attack',
        attack,
        attackFrame: this._attackFrame,
        eggsInClutch: this.layClutch,
      };
    }
    if (this.walkedThisTick) return { kind: 'walk', distancePx: this.walkDistancePx };
    return { kind: 'idle', time: performance.now() / MS_PER_SECOND };
  }

  /**
   * Her floor telegraphs: the slam cone, screech disk, spit aim line, roar ring
   * and punish-window halo. Called in the ground pass, before entities, because
   * they are floor paint: drawn with her body they would sort over anyone north
   * of her, be cut by her silhouette composite, and vanish when her tile is
   * culled while the shape itself is still on screen.
   */
  renderGroundTelegraphs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.isAlive) return;
    const cx = this.x - camX + this.tileSize * TILE_CENTER;
    const cy = this.y - camY + this.tileSize * TILE_CENTER;
    drawSpiderGroundTelegraphs(ctx, this, cx, cy, SPIT_AIM_LINE_PX);
  }

  /**
   * Everything of hers that belongs above the entities: the edge of her area
   * telegraph, which her body would otherwise cover, and any crawler her body
   * hides. Called once after the entity pass.
   */
  renderAboveEntities(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    players: readonly Player[],
  ): void {
    if (!this.isAlive) return;
    this.renderTelegraphOutlines(ctx, camX, camY);
    this.renderOccludedPlayers(ctx, camX, camY, players);
  }

  /** The strokes-only half of her area telegraph; see `drawSpiderTelegraphOutlines`. */
  renderTelegraphOutlines(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.isAlive) return;
    const cx = this.x - camX + this.tileSize * TILE_CENTER;
    const cy = this.y - camY + this.tileSize * TILE_CENTER;
    drawSpiderTelegraphOutlines(ctx, this, cx, cy);
  }

  /**
   * Redraws, translucent, any crawler standing inside her art that the Y-sort
   * drew before her: at her size a crawler a tile north of her is otherwise
   * gone except for its health bar.
   */
  private renderOccludedPlayers(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    players: readonly Player[],
  ): void {
    const reachPx = TILE_SIZE * SPIDER_ART_REACH_TILES;
    for (const player of players) {
      const drawnBeforeHer = player.y <= this.y;
      if (!drawnBeforeHer) continue;
      const underHerArt = Math.hypot(player.x - this.x, player.y - this.y) <= reachPx;
      if (!underHerArt) continue;
      this.renderOneOccludedPlayer(ctx, camX, camY, player);
    }
  }

  /**
   * Draws one occluded crawler at full opacity into a reused scratch canvas,
   * then blits that canvas at `OCCLUDED_PLAYER_ALPHA`.
   *
   * Several of `Player.render`'s own paths set an absolute `globalAlpha`
   * rather than scaling the one they inherit — the silhouette composite's
   * body blit, its status overlays, the knocked-out ring — so drawing the
   * crawler straight into `ctx` under a reduced alpha lets a hit-flashing or
   * KO'd crawler snap back to full opacity mid-draw. Rendering fully opaque
   * off-screen first and dimming the finished result in a single blit avoids
   * every one of those paths without changing any of them.
   */
  private renderOneOccludedPlayer(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    player: Player,
  ): void {
    // The margin the composite itself uses for an ordinary player, so the
    // scratch canvas covers exactly as much of her art as `Player.render`
    // does: hit-flash bleed, status coats, and the knocked-out ring.
    const margin = PLAYER_HIT_FLASH_MARGIN_TILES * TILE_SIZE;
    const cssSize = TILE_SIZE + margin * 2;

    const transform = ctx.getTransform();
    const scaleX = transform.a;
    const scaleY = transform.d;
    const isPlainScale = transform.b === 0 && transform.c === 0 && scaleX > 0 && scaleY > 0;
    if (!isPlainScale) {
      // A sheared or mirrored transform can't be replicated on the scratch
      // canvas without reading it apart further than this needs to; falling
      // back to the direct draw only reintroduces the alpha bug in a
      // situation the game never actually renders in.
      ctx.save();
      ctx.globalAlpha *= OCCLUDED_PLAYER_ALPHA;
      player.render(ctx, camX, camY, TILE_SIZE);
      ctx.restore();
      return;
    }

    const deviceSize = Math.ceil(cssSize * Math.max(scaleX, scaleY));
    const { surface, ctx: scratchCtx } = occludedPlayerScratch(deviceSize);

    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalAlpha = 1;
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, deviceSize, deviceSize);
    scratchCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    player.render(scratchCtx, player.x - margin, player.y - margin, TILE_SIZE);

    ctx.save();
    ctx.globalAlpha *= OCCLUDED_PLAYER_ALPHA;
    ctx.drawImage(
      surface,
      0,
      0,
      deviceSize,
      deviceSize,
      player.x - camX - margin,
      player.y - camY - margin,
      cssSize,
      cssSize,
    );
    ctx.restore();
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const cx = sx + tileSize * TILE_CENTER;
    const cy = sy + tileSize * TILE_CENTER;

    ctx.save();
    if (this.isAlive) {
      if (this.exposedHitFlash > 0) ctx.filter = EXPOSED_HIT_FILTER;
    }
    ctx.translate(cx, cy);
    ctx.rotate(grotesqueSpiderFacingRotation(this.facingX, this.facingY));
    ctx.translate(-cx, -cy);
    if (this.isAlive) {
      drawGrotesqueSpiderPoseSprite(ctx, sx, sy, tileSize, this.spritePose);
    } else {
      // The corpse plays the death row once, then holds its last frame.
      drawGrotesqueSpiderPoseSprite(
        ctx,
        sx,
        sy,
        tileSize,
        { kind: 'death', progress: Math.min(1, this.corpseFrames / DEATH_ANIM_FRAMES) },
        this.corpseAlpha,
      );
    }
    ctx.restore();

    if (this.isAlive) this.renderMobHealthBar(ctx, sx, sy);
  }
}
