import type { DamageSource, Player } from '../Player';
import { BOSS_BLAST_DAMAGE_SCALE, Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { TacticsTrait } from './tactics/tacticsTraits';
import type { SkeletonShot } from '../systems/SkeletonProjectileSystem';
import type { StructureRef } from '../systems/briarHollow/DefenseStructures';
import { WALL_TIERS } from '../systems/briarHollow/structureRules';
import { trebuchetDirectDamage } from '../systems/briarHollow/TrebuchetSystem';
import type { AssaultLane } from '../map/overworld/briarHollowSite';
import { hasRoomToMove } from '../map/findWalkableTile';
import {
  isInsidePalisade,
  isInsidePalisadeTile,
  isStandingStructure,
  nearestStructurePoint,
  tileUnder,
} from './siege/siegeCapability';
import {
  INSIDE_PALISADE,
  palisadeDistanceFor,
  type PalisadeDistanceField,
} from './siege/palisadeDistance';
import type { SiegeTile } from './siege/siegeTypes';
import { UndeadCueQueue } from './siege/undeadCues';
import { RAISED_RATKIN_LOOKS, type RaisedRatkinLook } from '../sprites/art/raisedRatkinArt';
import { prewarmRaisedRatkin } from '../sprites/raisedRatkinSprite';
import { prewarmSkeletonEscortSprites } from '../sprites/skeletonSprite';
import {
  BLINK_FRAMES,
  CAST_BOLT_FRAMES,
  CAST_PULSE_CHANNEL_FROM,
  CAST_PULSE_FRAMES,
  CAST_RAISE_FRAMES,
  DEATH_FRAMES,
  HURT_FRAMES,
  IDLE_FRAMES,
  NECROMANCER_TICKS_PER_FRAME,
  advanceDriftFrame,
  necromancerRow,
  necromancerTicksToEvent,
  type NecromancerAction,
} from '../sprites/art/necromancerFigure';
import type { NecromancerView } from '../sprites/art/necromancerArt';
import {
  NECROMANCER_BLINK_WARN_TILES,
  NECROMANCER_CAST_PREWARM_LEAD_FRAMES,
  NECROMANCER_HEAD_ABOVE_TILE_TILES,
  drawNecromancerSprite,
  prewarmNecromancerBlink,
  prewarmNecromancerCast,
  prewarmNecromancerDeath,
  prewarmNecromancerDrift,
  prewarmNecromancerStanding,
  NECROMANCER_STANDING_PREWARM_LEAD_FRAMES,
  type NecromancerCast,
} from '../sprites/necromancerSprite';
import {
  NECROMANCER_VOLLEY_BOLTS,
  NECROMANCER_VOLLEY_SPREAD,
  drawBlinkMark,
  drawBoltFan,
  drawPulseTelegraph,
  drawRaiseSigil,
} from '../sprites/necromancerTelegraphs';

// ── Body ─────────────────────────────────────────────────────────────────────

/**
 * Vordrick's HP at level 1, before the boss curve levels it to the wave. Sized
 * by the siege simulation, he stands back from the
 * walls behind his raises, so he is hurt only when he comes within a missile's
 * clear flight of the gate or a breach, and by the trebuchets, which rank him
 * last — at much more than this the siege stalls with him alive and the walls
 * pulsed down.
 */
export const NECRO_HP = 60;
const NECRO_DRIFT_SPEED = 0.7;
const NECRO_XP = 1100;
const COIN_DROP_MIN = 90;
const COIN_DROP_MAX = 160;
/** No one of his blows — bolt, burst or pulse — may take more than this share of a victim's bar. */
const NECRO_BLOW_CAP_SHARE = 0.35;
const NECRO_MASS = 8;
/** The figure stands about four tiles tall; the art reaches this far past its own tile. */
const NECRO_CULL_MARGIN_TILES = 4;

// ── Home ─────────────────────────────────────────────────────────────────────

/** The band outside the palisade he commands from, in tiles from the ring. */
export const NECRO_HOME_MIN_TILES = 4;
export const NECRO_HOME_MAX_TILES = 12;
/** Nothing — a step, a shove, a blink — ever puts him nearer the ring than this. */
export const NECRO_MIN_WALL_DISTANCE_TILES = 3;
/** How far along the wall from the lane he arrived on his home zone reaches. */
const NECRO_HOME_LANE_RADIUS_TILES = 14;
/** Where in the band he settles when there is nobody to watch. */
const NECRO_HOME_PREFERRED_TILES = 7;
/** How often he reconsiders where to stand, and how far he looks. */
const NECRO_REPOSITION_FRAMES = 45;
const NECRO_REPOSITION_RADIUS_TILES = 5;
/** The range he likes to hold from the defender he is watching: inside his bolt's reach. */
const NECRO_PREFERRED_RANGE_TILES = 7;
/** Scoring weights for a place to stand: sight of the defender dominates, then range, then the walk. */
const SCORE_SIGHT = 100;
const SCORE_RANGE_PER_TILE = 4;
const SCORE_WALK_PER_TILE = 1;
/**
 * He stops drifting this close to where he meant to stand, and having
 * stopped, stays stopped until something carries him this far off it. The
 * gap is what keeps a raise shouldering past from setting him drifting in
 * place: separation holds him just outside the tighter figure for as long as
 * it leans on him.
 */
const ARRIVE_TILES = 0.3;
const ARRIVE_RELEASE_TILES = 1;
/** How far the path search for his walk in may reach, in tiles: past his lane's spawn. */
const PROCESSION_PATH_SEARCH_TILES = 64;
/** His walk in is fitted to this much more than the lead, so rounding on the route never brings him in early. */
const PROCESSION_LEAD_SLACK = 1.05;

// ── Raise the Dead ───────────────────────────────────────────────────────────

export const NECRO_RAISE_COOLDOWN_FRAMES = 720;
export const NECRO_RAISE_BATCH = 3;
/** A raise in a siege calls up this many at once. */
export const NECRO_SIEGE_RAISE_BATCH = 4;
/**
 * Of a siege raise, how many sigils open inside the palisade. The village's
 * own dead are buried within it: a wall keeps out what comes up the lanes,
 * not what climbs out of the ground behind it.
 */
export const NECRO_INNER_RAISES = 3;
/** An inner sigil opens no nearer a defender than this, so it is seen and met rather than rising underfoot. */
const NECRO_INNER_RAISE_MIN_DEFENDER_TILES = 3;
/** Inner sigils open within this many tiles of the bell, where the dead inside have their business. */
const NECRO_INNER_RAISE_BELL_TILES = 12;
/**
 * How a siege raise's bodies are drawn, as weights: the village's ratkin
 * most often, then its skeletons. Outside a siege he raises only ratkin.
 */
const SIEGE_RAISE_KIND_WEIGHTS: Readonly<Record<NecromancerRaiseKind, number>> = {
  ratkin: 0.5,
  skeleton_warrior: 0.3,
  skeleton_archer: 0.2,
};
const SIEGE_RAISE_KINDS: readonly NecromancerRaiseKind[] = [
  'ratkin',
  'skeleton_warrior',
  'skeleton_archer',
];
/** Living raises he may field at once. The wave's own spawns are counted separately. */
export const NECRO_ESCORT_CAP = 8;
/** Corpses within this many tiles rise first. */
const NECRO_CORPSE_SEARCH_TILES = 10;
/** Graves are ruins tiles within this many tiles of him. */
const NECRO_GRAVE_SEARCH_TILES = 12;
/** Open ground is sought in this ring around him. */
const OPEN_GROUND_MIN_TILES = 2;
const OPEN_GROUND_MAX_TILES = 5;

// ── Soul Bolt volley ─────────────────────────────────────────────────────────

export const NECRO_BOLT_RANGE_TILES = 9;
export const NECRO_BOLT_COOLDOWN_FRAMES = 150;
/** One bolt's level-1 damage; three fly in each volley. */
export const NECRO_BOLT_DAMAGE = 4;

// ── Grave Pulse ──────────────────────────────────────────────────────────────

export const NECRO_PULSE_RANGE_TILES = 7;
/** The channel, start to payload: the pulse's whole telegraph. */
export const NECRO_PULSE_CHANNEL_FRAMES = 90;
export const NECRO_PULSE_COOLDOWN_FRAMES = 600;
/** A quarter of a stone wall's base health, rounded. */
const NECRO_PULSE_STONE_WALL_SHARE = 0.25;
export const NECRO_PULSE_STRUCTURE_DAMAGE = Math.round(
  WALL_TIERS.stone.baseHp * NECRO_PULSE_STONE_WALL_SHARE,
);
/**
 * The damage during a channel that breaks it, as a share of what a same-level
 * trebuchet's direct hit does to him. Under one, so a direct hit always breaks
 * the channel on its own — the defences' reward for landing one.
 */
const NECRO_PULSE_INTERRUPT_SHARE_OF_DIRECT_HIT = 0.8;
/**
 * Flat, unscaled: the lit band is ground a crawler is standing in by the time
 * it goes off, which P2 of `docs/difficulty-fairness-rules.md` keeps flat.
 */
export const NECRO_PULSE_BAND_DAMAGE = 3;
/** The pulse's name on the death screen. */
export const NECRO_PULSE_ATTACK_TYPE = 'grave_pulse';
/** Half the lit band's width, plus a body's own half-width, in tiles. */
const PULSE_BAND_HIT_HALF_TILES = 0.7;

// ── Blink ────────────────────────────────────────────────────────────────────

export const NECRO_BLINK_TRIGGER_TILES = 2;
/** How long a crawler must stay that close before he goes. */
export const NECRO_BLINK_TRIGGER_FRAMES = 120;
export const NECRO_BLINK_COOLDOWN_FRAMES = 480;
export const NECRO_BLINK_MIN_TILES = 6;
/**
 * How long a walk to where he means to stand may make no headway before he
 * blinks there instead: long enough that a body in his way can step aside,
 * short enough that a stand of trees never holds him out of the fight.
 */
export const NECRO_STUCK_BLINK_FRAMES = 120;
/** How far round his post an unsticking blink may look for open ground, in tiles. */
const NECRO_UNSTICK_SEARCH_TILES = 6;
export const NECRO_BLINK_MAX_TILES = 8;
/** How far either side of the line back to his lane a blink may land, in radians: about sixty degrees. */
const BLINK_ARC_HALF = 1.05;
const BLINK_ARC_SAMPLES = 9;
/** The blink warning is re-armed once every crawler is this much further out. */
const BLINK_REARM_EXTRA_TILES = 4;

// ── Pacing ───────────────────────────────────────────────────────────────────

/** Quiet after any cast before the next may begin. */
const NECRO_CAST_GAP_FRAMES = 45;
/** Cooldowns he arrives with, so no cast opens the fight before its rows are warm. */
const OPENING_BOLT_FRAMES = 120;
const OPENING_RAISE_FRAMES = 240;
const OPENING_PULSE_FRAMES = 360;
/** Updates the figure cache may fall behind by on a slow frame; the cast lead is counted in cache frames. */
const UPDATES_PER_CACHE_FRAME = 2;
const CAST_PREWARM_LEAD_UPDATES = NECROMANCER_CAST_PREWARM_LEAD_FRAMES * UPDATES_PER_CACHE_FRAME;
/** A ready cast still waiting for a reason to fire re-warms this often, inside the cache's idle window. */
const CAST_REWARM_FRAMES = 300;
/** The death is warmed once he is down to this share of his health. */
const NECRO_DEATH_PREWARM_HP_SHARE = 0.3;

// ── Rows ─────────────────────────────────────────────────────────────────────

const RAISE_ROW_TICKS = CAST_RAISE_FRAMES * NECROMANCER_TICKS_PER_FRAME.cast_raise;
const BOLT_ROW_TICKS = CAST_BOLT_FRAMES * NECROMANCER_TICKS_PER_FRAME.cast_bolt;
const BLINK_ROW_TICKS = BLINK_FRAMES * NECROMANCER_TICKS_PER_FRAME.blink_out;
const HURT_ROW_TICKS = HURT_FRAMES * NECROMANCER_TICKS_PER_FRAME.hurt;
const DEATH_ROW_TICKS = DEATH_FRAMES * NECROMANCER_TICKS_PER_FRAME.death;

function releaseTicks(state: string, fallbackFrame: number, ticksPerFrame: number): number {
  const row = necromancerRow(state);
  const ticks = row === undefined ? undefined : necromancerTicksToEvent(row, 'release');
  return ticks ?? fallbackFrame * ticksPerFrame;
}

/** Ticks from the start of the raise to the lantern's flare, when the dead are called. */
export const NECRO_RAISE_TELEGRAPH_FRAMES = releaseTicks(
  'cast_raise',
  CAST_RAISE_FRAMES - 1,
  NECROMANCER_TICKS_PER_FRAME.cast_raise,
);
/** Ticks from the start of the bolt cast to the volley leaving the lantern. */
export const NECRO_BOLT_TELEGRAPH_FRAMES = releaseTicks(
  'cast_bolt',
  CAST_BOLT_FRAMES - 1,
  NECROMANCER_TICKS_PER_FRAME.cast_bolt,
);

/** How long the heap lies before it fades, and the fade. */
const NECRO_CORPSE_HOLD_FRAMES = 3600;
const NECRO_CORPSE_FADE_FRAMES = 120;
/** How long he takes to fade out of a siege wave he was beaten in but not killed in. */
export const NECRO_RETREAT_FADE_FRAMES = 90;

const HALF = 0.5;
const NO_TACTICS: readonly TacticsTrait[] = [];
const NO_SHOTS: readonly SkeletonShot[] = [];
const NO_RAISES: readonly NecromancerRaiseRequest[] = [];

/** What one of his raises climbs out as. */
export type NecromancerRaiseKind = 'ratkin' | 'skeleton_warrior' | 'skeleton_archer';

/** One body he has called up, on the sigil it will climb out of. */
export interface NecromancerRaiseRequest {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: NecromancerRaiseKind;
  /** The ratkin's look; unused for a skeleton. */
  readonly look: RaisedRatkinLook;
}

/** The ground mark of the attack he is telegraphing, with 0→1 progress to its payload. */
export type NecromancerTelegraph =
  | { readonly kind: 'raise'; readonly sites: readonly SiegeTile[]; readonly progress: number }
  | {
      readonly kind: 'bolt';
      readonly fromX: number;
      readonly fromY: number;
      readonly angle: number;
      readonly progress: number;
    }
  | {
      readonly kind: 'pulse';
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
      readonly progress: number;
    }
  | { readonly kind: 'blink'; readonly x: number; readonly y: number; readonly progress: number };

type NecroPhase = 'hold' | NecromancerCast | 'blink_out' | 'blink_in';

/** What a same-level trebuchet's direct hit leaves him short of breaking a channel by — never more than it. */
export function necroPulseInterruptDamage(level: number): number {
  return Math.max(
    1,
    Math.floor(
      NECRO_PULSE_INTERRUPT_SHARE_OF_DIRECT_HIT *
        trebuchetDirectDamage(level) *
        BOSS_BLAST_DAMAGE_SCALE,
    ),
  );
}

function viewForFacing(facingX: number, facingY: number): NecromancerView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY > 0 ? 'front' : 'away';
}

function pickLook(): RaisedRatkinLook {
  return RAISED_RATKIN_LOOKS[Math.floor(Math.random() * RAISED_RATKIN_LOOKS.length)] ?? 'smock';
}

function pickSiegeRaiseKind(): NecromancerRaiseKind {
  let roll = Math.random();
  for (const kind of SIEGE_RAISE_KINDS) {
    roll -= SIEGE_RAISE_KIND_WEIGHTS[kind];
    if (roll < 0) return kind;
  }
  return 'ratkin';
}

/**
 * Vordrick Boneharrow, the necromancer who brings Briar Hollow's own dead
 * back against it.
 *
 * He fights from outside the palisade and never comes in: a home zone four to
 * twelve tiles out along the lane he arrived by, never nearer the ring than
 * three tiles whatever is breached, drifting to keep sight of the nearest
 * defender. The party has to go out through the gate to finish him, under the
 * trebuchets' cover.
 *
 * Four things he does, each telegraphed on the ground:
 *
 * - **Raise the Dead** — sigils where corpses, graves or open ground will give
 *   up raised ratkin, up to his own cap of living raises.
 * - **Soul Bolt volley** — three slow blue bolts along a fan locked at the
 *   start of the cast, flown by `SkeletonProjectileSystem` so they outlive him.
 * - **Grave Pulse** — a channel into the weakest wall or trebuchet in reach;
 *   enough damage during it, a trebuchet's direct hit always among it, breaks
 *   it.
 * - **Blink** — back toward his lane when a crawler has crowded him too long.
 *
 * His death plays out as a corpse (`rendersWhenDead`), so `isAlive` falls with
 * his health and `justDied` latches exactly once.
 */
export class Necromancer extends Mob {
  readonly xpValue = NECRO_XP;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  override readonly audioTag = 'necromancer';
  override readonly rendersWhenDead = true;
  displayName = 'Vordrick Boneharrow';
  description =
    'A stooped figure in grave-cloth and a rat-skull mask, a blue lantern on his staff.';

  /** Sounds waiting for the audio pass. */
  readonly cues = new UndeadCueQueue();

  /**
   * Written by `SkeletonSummonSystem` each frame: how many of his raises
   * stand, and whether that is his cap — so he stops casting at the cap
   * rather than casting into nothing.
   */
  escortLiving = 0;
  escortAtCap = false;

  private phase: NecroPhase = 'hold';
  private phaseTicks = 0;
  private raiseCooldown = OPENING_RAISE_FRAMES;
  private boltCooldown = OPENING_BOLT_FRAMES;
  private pulseCooldown = OPENING_PULSE_FRAMES;
  private blinkCooldown = 0;
  private castGap = 0;
  private readonly castWarmedAt: Record<NecromancerCast, number | null> = {
    cast_raise: null,
    cast_bolt: null,
    cast_pulse: null,
  };
  private crowdedFrames = 0;
  /** Updates his walk to his goal has made no headway. */
  private walkStalledFrames = 0;
  private blinkWarned = false;
  private standingWarmed = false;
  /** His own tick count when his standing set was warmed, or null before. */
  standingWarmedAt: number | null = null;
  private arrivedAtGoal = false;
  private processionPace = NECRO_DRIFT_SPEED;
  private deathWarmed = false;

  private raiseSites: SiegeTile[] = [];
  private raiseKinds: NecromancerRaiseKind[] = [];
  private raiseLooks: RaisedRatkinLook[] = [];
  private boltAngle = 0;
  private boltTarget: Player | null = null;
  private pulseTarget: StructureRef | null = null;
  private pulsePoint: { x: number; y: number } | null = null;
  private channelDamage = 0;
  private blinkDestination: SiegeTile | null = null;

  private pendingShots: SkeletonShot[] = [];
  private pendingRaises: NecromancerRaiseRequest[] = [];
  private readonly usedCorpses = new WeakSet<Mob>();

  private lane: AssaultLane | null = null;
  private anchor: SiegeTile | null = null;
  private goal: SiegeTile | null = null;
  private repositionTimer = 0;
  private latestTargets: readonly Player[] = [];

  private driftFrame = 0;
  private idleTicks = 0;
  private hurtTimer = 0;
  private corpseFrames = 0;
  /** Frames into his fade-out after a beating he survives, or null while he fights. */
  private retreatFadeFrames: number | null = null;
  private lastX: number;
  private lastY: number;

  /** Pulses broken by damage during the channel, for a gate that watches them. */
  pulsesInterrupted = 0;
  /** Pulses that reached their payload, and what they struck. */
  pulsesLanded = 0;
  lastPulseTarget: StructureRef | null = null;
  /** Blinks taken, and where the last one landed. */
  blinks = 0;
  lastBlinkLanding: SiegeTile | null = null;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, NECRO_HP, NECRO_DRIFT_SPEED);
    this.mass = NECRO_MASS;
    this.ignoresTownSafeZone = true;
    this.immuneToConfusion = true;
    this.blowCapShareOfTargetHp = NECRO_BLOW_CAP_SHARE;
    this.lastX = this.x;
    this.lastY = this.y;
  }

  override get blastDamageScale(): number {
    return BOSS_BLAST_DAMAGE_SCALE;
  }

  /**
   * A boss to the player without being a boss-room boss: `isBoss` would hand
   * him to `BossRoomSystem`'s room clamp, and his fight has no room.
   */
  override get countsAsBossKill(): boolean {
    return true;
  }

  override get cullMarginTiles(): number {
    return NECRO_CULL_MARGIN_TILES;
  }

  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return NO_TACTICS;
  }

  /** He never swings at a wall: the Grave Pulse is his siege attack, at its own value. */
  override get siegeStructureMultiplier(): number {
    return 0;
  }

  override get ownsSiegeMovement(): boolean {
    return true;
  }

  /**
   * A companion sidesteps him while he is casting, or while someone stands
   * inside his bolt's reach — never merely because a target is alive somewhere
   * on the map, which would keep him ticking map-wide and every companion
   * dodging him from anywhere.
   */
  override get requiresEvasion(): boolean {
    if (!this.isAlive || this.isFadingAway) return false;
    if (this.phase === 'cast_bolt' || this.phase === 'cast_pulse' || this.phase === 'cast_raise') {
      return true;
    }
    const target = this.currentTarget;
    return target !== null && this.distanceTo(target) <= this.tileSize * NECRO_BOLT_RANGE_TILES;
  }

  /** His loot is the boss chest's, granted by the fight's owner, not a floor drop. */
  protected override rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  // ── Beaten, not killed ─────────────────────────────────────────────────────

  /** Whether he has been beaten down in a fight he is not allowed to die in (`cannotBeKilled`). */
  get isBeaten(): boolean {
    return this.isAlive && this.cannotBeKilled && this.hp <= 1;
  }

  /** Whether he is fading out of the fight: no casting, no moving, and nothing lands on him. */
  get isFadingAway(): boolean {
    return this.retreatFadeFrames !== null;
  }

  /** Whether his fade has run its course, and he can be taken off the field. */
  get hasFadedAway(): boolean {
    return this.retreatFadeFrames !== null && this.retreatFadeFrames >= NECRO_RETREAT_FADE_FRAMES;
  }

  /** Stops him where he stands and starts him fading out; whatever he had in the air is dropped. */
  beginFadingAway(): void {
    if (this.retreatFadeFrames !== null) return;
    this.retreatFadeFrames = 0;
    // A blink half done would leave him drawn mid-vanish for the whole fade.
    this.endCast();
    this.clearAirborneAttacks();
    this.currentTarget = null;
    this.isMoving = false;
  }

  override get refusesDamage(): boolean {
    return super.refusesDamage || this.isFadingAway;
  }

  private get retreatAlpha(): number {
    if (this.retreatFadeFrames === null) return 1;
    return Math.max(0, 1 - this.retreatFadeFrames / NECRO_RETREAT_FADE_FRAMES);
  }

  // ── Queues drained by systems ──────────────────────────────────────────────

  takePendingShots(): readonly SkeletonShot[] {
    if (this.pendingShots.length === 0) return NO_SHOTS;
    const shots = this.pendingShots;
    this.pendingShots = [];
    return shots;
  }

  takePendingRaises(): readonly NecromancerRaiseRequest[] {
    if (this.pendingRaises.length === 0) return NO_RAISES;
    const raises = this.pendingRaises;
    this.pendingRaises = [];
    return raises;
  }

  override clearAirborneAttacks(): void {
    this.pendingShots = [];
    this.pendingRaises = [];
  }

  // ── State reads for the renderer and the gates ─────────────────────────────

  get currentPhase(): NecroPhase {
    return this.phase;
  }

  /** Whether his death has played through to the heap it holds. */
  get isDeathSettled(): boolean {
    return !this.isAlive && this.corpseFrames >= DEATH_ROW_TICKS;
  }

  /** The distance field his home is measured on, or null outside the siege. */
  private get field(): PalisadeDistanceField | null {
    const siege = this.siegeCapable;
    return siege === null ? null : palisadeDistanceFor(siege.world.site);
  }

  /** The ground mark being telegraphed right now, or null. */
  get groundTelegraph(): NecromancerTelegraph | null {
    if (!this.isAlive) return null;
    const half = this.tileSize * HALF;
    switch (this.phase) {
      case 'cast_raise':
        return {
          kind: 'raise',
          sites: this.raiseSites,
          progress: Math.min(1, this.phaseTicks / NECRO_RAISE_TELEGRAPH_FRAMES),
        };
      case 'cast_bolt':
        if (this.phaseTicks >= NECRO_BOLT_TELEGRAPH_FRAMES) return null;
        return {
          kind: 'bolt',
          fromX: this.x + half,
          fromY: this.y + half,
          angle: this.boltAngle,
          progress: this.phaseTicks / NECRO_BOLT_TELEGRAPH_FRAMES,
        };
      case 'cast_pulse': {
        const point = this.pulsePoint;
        if (point === null) return null;
        return {
          kind: 'pulse',
          fromX: this.x + half,
          fromY: this.y + half,
          toX: point.x,
          toY: point.y,
          progress: Math.min(1, this.phaseTicks / NECRO_PULSE_CHANNEL_FRAMES),
        };
      }
      case 'blink_out': {
        const destination = this.blinkDestination;
        if (destination === null) return null;
        return {
          kind: 'blink',
          x: destination.x * this.tileSize + half,
          y: destination.y * this.tileSize + half,
          progress: Math.min(1, this.phaseTicks / BLINK_ROW_TICKS),
        };
      }
      case 'hold':
      case 'blink_in':
        return null;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  protected override clearEncounterPhase(): void {
    this.enterPhase('hold');
    this.raiseCooldown = OPENING_RAISE_FRAMES;
    this.boltCooldown = OPENING_BOLT_FRAMES;
    this.pulseCooldown = OPENING_PULSE_FRAMES;
    this.blinkCooldown = 0;
    this.castGap = 0;
    this.castWarmedAt.cast_raise = null;
    this.castWarmedAt.cast_bolt = null;
    this.castWarmedAt.cast_pulse = null;
    this.crowdedFrames = 0;
    this.walkStalledFrames = 0;
    this.raiseSites = [];
    this.raiseKinds = [];
    this.raiseLooks = [];
    this.pulseTarget = null;
    this.pulsePoint = null;
    this.channelDamage = 0;
    this.blinkDestination = null;
    this.boltTarget = null;
    this.pendingShots = [];
    this.pendingRaises = [];
    this.goal = null;
    this.hurtTimer = 0;
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.corpseFrames = 0;
    this.cues.clear();
    this.lastX = this.x;
    this.lastY = this.y;
  }

  private enterPhase(phase: NecroPhase): void {
    this.phase = phase;
    this.phaseTicks = 0;
  }

  override tickTimers(): void {
    super.tickTimers();
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    if (this.phase === 'hold' && this.isMoving) {
      this.driftFrame = advanceDriftFrame(this.driftFrame, moved, this.tileSize);
    }
    if (this.hurtTimer > 0) this.hurtTimer--;
    this.idleTicks++;
  }

  // ── Damage ─────────────────────────────────────────────────────────────────

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    const before = this.hp;
    super.takeDamageFrom(amount, attacker, damageType);
    this.noteHurt(before - this.hp);
  }

  override takeDamage(amount: number, source?: DamageSource): boolean {
    const before = this.hp;
    const connected = super.takeDamage(amount, source);
    this.noteHurt(before - this.hp);
    return connected;
  }

  private noteHurt(dealt: number): void {
    if (dealt <= 0 || !this.isAlive) return;
    if (this.phase === 'hold' && !this.inProcession) this.hurtTimer = HURT_ROW_TICKS;
    if (!this.deathWarmed && this.hp <= this.maxHp * NECRO_DEATH_PREWARM_HP_SHARE) {
      this.deathWarmed = true;
      prewarmNecromancerDeath();
    }
    if (this.phase !== 'cast_pulse') return;
    this.channelDamage += dealt;
    if (this.channelDamage >= necroPulseInterruptDamage(this.mobLevel)) {
      this.pulsesInterrupted++;
      this.endCast();
      this.hurtTimer = HURT_ROW_TICKS;
    }
  }

  // ── AI ─────────────────────────────────────────────────────────────────────

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;
    if (this.retreatFadeFrames !== null) {
      this.retreatFadeFrames++;
      this.isMoving = false;
      return;
    }
    this.warmStandingOnSetOut();
    this.latestTargets = targets;
    this.phaseTicks++;
    this.tickCooldowns();

    const watched = this.nearestTarget(targets, Infinity);
    this.currentTarget = watched;
    this.watchForCrowding(targets);

    switch (this.phase) {
      case 'cast_raise':
        this.updateRaise();
        return;
      case 'cast_bolt':
        this.updateBolt();
        return;
      case 'cast_pulse':
        this.updatePulse();
        return;
      case 'blink_out':
        this.updateBlinkOut();
        return;
      case 'blink_in':
        this.isMoving = false;
        if (this.phaseTicks >= BLINK_ROW_TICKS) this.enterPhase('hold');
        return;
      case 'hold':
        break;
    }

    // In procession he neither casts nor blinks: each ends on a frame of him
    // standing, and his standing rows are not warm until the procession ends.
    if (this.inProcession) {
      this.drift(watched);
      return;
    }
    if (this.shouldBlink() && this.beginBlink()) return;
    this.warmUpcomingCasts();
    if (this.castGap === 0 && this.beginACast(targets)) return;
    this.drift(watched);
  }

  private tickCooldowns(): void {
    if (this.raiseCooldown > 0) this.raiseCooldown--;
    if (this.boltCooldown > 0) this.boltCooldown--;
    if (this.pulseCooldown > 0) this.pulseCooldown--;
    if (this.blinkCooldown > 0) this.blinkCooldown--;
    if (this.castGap > 0 && this.phase === 'hold') this.castGap--;
  }

  private nearestTarget(targets: readonly Player[], rangePx: number): Player | null {
    let nearest: Player | null = null;
    let nearestDistance = rangePx;
    for (const target of targets) {
      if (!target.isAlive || target.isDefendTarget === true) continue;
      const distance = this.distanceTo(target);
      if (distance <= nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private watchForCrowding(targets: readonly Player[]): void {
    let crowded = false;
    let nearestCrawler = Infinity;
    for (const target of targets) {
      if (!target.isAlive || !target.isCrawler) continue;
      const distance = this.distanceTo(target);
      nearestCrawler = Math.min(nearestCrawler, distance);
      if (distance <= this.tileSize * NECRO_BLINK_TRIGGER_TILES) crowded = true;
    }
    this.crowdedFrames = crowded ? this.crowdedFrames + 1 : 0;
    const warnPx = this.tileSize * NECROMANCER_BLINK_WARN_TILES;
    if (!this.blinkWarned && nearestCrawler <= warnPx) {
      this.blinkWarned = true;
      prewarmNecromancerBlink();
    } else if (
      this.blinkWarned &&
      nearestCrawler > this.tileSize * (NECROMANCER_BLINK_WARN_TILES + BLINK_REARM_EXTRA_TILES)
    ) {
      this.blinkWarned = false;
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  /**
   * Every step he takes, and every shove and knockback that moves him, is
   * refused if it would carry him nearer the ring than the wall minimum — or
   * into it — unless it is carrying him further out.
   */
  protected override moveWithCollision(dx: number, dy: number): void {
    const beforeX = this.x;
    const beforeY = this.y;
    super.moveWithCollision(dx, dy);
    if (!this.mayStandAt(this.x, this.y, beforeX, beforeY)) {
      this.x = beforeX;
      this.y = beforeY;
    }
  }

  protected override acceptsShove(x: number, y: number): boolean {
    return this.mayStandAt(x, y, this.x, this.y);
  }

  private mayStandAt(x: number, y: number, fromX: number, fromY: number): boolean {
    const field = this.field;
    if (field === null) return true;
    const to = tileUnder({ x, y });
    const distance = field.distanceAt(to.x, to.y);
    if (distance === INSIDE_PALISADE) return false;
    if (distance >= NECRO_MIN_WALL_DISTANCE_TILES) return true;
    const from = tileUnder({ x: fromX, y: fromY });
    const fromDistance = field.distanceAt(from.x, from.y);
    return fromDistance !== INSIDE_PALISADE && distance > fromDistance;
  }

  private homeLane(): AssaultLane | null {
    if (this.lane !== null) return this.lane;
    const siege = this.siegeCapable;
    if (siege === null) return null;
    const here = tileUnder(this);
    let best: AssaultLane | null = null;
    let bestDistance = Infinity;
    for (const lane of siege.world.site.assaultLanes) {
      const distance = Math.min(
        Math.hypot(lane.spawn.x - here.x, lane.spawn.y - here.y),
        Math.hypot(lane.approach.x - here.x, lane.approach.y - here.y),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = lane;
      }
    }
    this.lane = best;
    return best;
  }

  /** Whether a tile is somewhere he may settle: in the band, near his lane, and walkable. */
  isInHomeZone(tileX: number, tileY: number): boolean {
    const field = this.field;
    const lane = this.homeLane();
    if (field === null || lane === null) return false;
    const distance = field.distanceAt(tileX, tileY);
    if (distance < NECRO_HOME_MIN_TILES || distance > NECRO_HOME_MAX_TILES) return false;
    if (
      Math.hypot(tileX - lane.approach.x, tileY - lane.approach.y) > NECRO_HOME_LANE_RADIUS_TILES
    ) {
      return false;
    }
    const map = this.map;
    if (map === null) return true;
    // Room to move as well as walkable: a single-tile gap between trunks is
    // walkable ground he could be sent to and never leave.
    return map.isWalkableForHostile(tileX, tileY) && hasRoomToMove(map, tileX, tileY);
  }

  /**
   * The spot in his home zone he settles on with nobody to watch: the zone
   * tile nearest his preferred distance from the wall, then nearest the lane's
   * approach. Scored rather than filtered, because a lane squeezed between the
   * wall and rock may have no tile at the preferred distance at all — only the
   * zone's inner edge.
   */
  private homeAnchor(): SiegeTile | null {
    if (this.anchor !== null) return this.anchor;
    const lane = this.homeLane();
    const field = this.field;
    if (lane === null || field === null) return null;
    let best: SiegeTile | null = null;
    let bestWallMiss = Infinity;
    let bestLaneDistance = Infinity;
    for (let dy = -NECRO_HOME_LANE_RADIUS_TILES; dy <= NECRO_HOME_LANE_RADIUS_TILES; dy++) {
      for (let dx = -NECRO_HOME_LANE_RADIUS_TILES; dx <= NECRO_HOME_LANE_RADIUS_TILES; dx++) {
        const tileX = lane.approach.x + dx;
        const tileY = lane.approach.y + dy;
        if (!this.isInHomeZone(tileX, tileY)) continue;
        const wallMiss = Math.abs(field.distanceAt(tileX, tileY) - NECRO_HOME_PREFERRED_TILES);
        const laneDistance = Math.hypot(dx, dy);
        const better =
          wallMiss < bestWallMiss || (wallMiss === bestWallMiss && laneDistance < bestLaneDistance);
        if (!better) continue;
        best = { x: tileX, y: tileY };
        bestWallMiss = wallMiss;
        bestLaneDistance = laneDistance;
      }
    }
    this.anchor = best;
    return best;
  }

  /** Updates until his standing set's bake is covered, counted from when it was asked for. */
  private get standingLeadRemaining(): number {
    if (this.standingWarmedAt === null) return NECROMANCER_STANDING_PREWARM_LEAD_FRAMES;
    return Math.max(
      0,
      NECROMANCER_STANDING_PREWARM_LEAD_FRAMES - (this.idleTicks - this.standingWarmedAt),
    );
  }

  /** Whether he is still on his way in, before his standing rows are warm; see {@link drift}. */
  private get inProcession(): boolean {
    return this.siegeCapable !== null && this.standingLeadRemaining > 0;
  }

  /**
   * Warms his standing set the first time he acts — as he sets out, which is
   * the earliest this body exists. The set is too large for any trigger on
   * the way in to warm in the walk that is left, so the walk is fitted to it
   * instead (see {@link drift}).
   */
  private warmStandingOnSetOut(): void {
    if (this.standingWarmed) return;
    this.standingWarmed = true;
    this.standingWarmedAt = this.idleTicks;
    prewarmNecromancerStanding();
    this.processionPace = this.paceForProcession();
  }

  /**
   * One steady pace for the whole walk in, fitted so the route to his anchor
   * takes at least the standing set's lead: measured along the path he will
   * walk, since a straight line under-reads a route that doubles back round
   * rock, and a pace refitted every step to the straight line crawls at the
   * end.
   */
  private paceForProcession(): number {
    const anchor = this.homeAnchor();
    if (anchor === null) return this.speed;
    const here = tileUnder(this);
    const path =
      this.map?.findPath(here.x, here.y, anchor.x, anchor.y, PROCESSION_PATH_SEARCH_TILES, true) ??
      [];
    let routeTiles = Math.hypot(anchor.x - here.x, anchor.y - here.y);
    if (path.length > 1) {
      routeTiles = 0;
      for (let i = 1; i < path.length; i++) {
        routeTiles += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      }
    }
    const routePx = routeTiles * this.tileSize - this.tileSize * ARRIVE_TILES;
    const leadUpdates = NECROMANCER_STANDING_PREWARM_LEAD_FRAMES * PROCESSION_LEAD_SLACK;
    return Math.min(this.speed, Math.max(0, routePx) / leadUpdates);
  }

  /**
   * Walks to where he means to stand. Until his standing set's lead has run,
   * he is in procession: bound for his anchor, never stopping short of it,
   * paced so he reaches it no sooner than the lead ends — his first stop
   * draws the standing rows, and they must be warm by then.
   */
  private drift(watched: Player | null): void {
    const here = tileUnder(this);
    const inProcession = this.inProcession;
    if (this.repositionTimer > 0) this.repositionTimer--;
    if (inProcession) {
      this.goal = this.homeAnchor();
    } else if (this.goal === null || this.repositionTimer === 0) {
      this.goal = this.chooseStandingTile(here, watched);
      this.repositionTimer = NECRO_REPOSITION_FRAMES;
      if (this.goal !== null) {
        const heading = viewForFacing(
          this.goal.x * this.tileSize - this.x,
          this.goal.y * this.tileSize - this.y,
        );
        const driftNotWarm =
          heading === 'away' || (heading === 'front' && this.standingLeadRemaining > 0);
        if (driftNotWarm) prewarmNecromancerDrift(heading);
      }
    }
    const goal = this.goal;
    if (goal === null) {
      this.isMoving = false;
      if (watched !== null) this.faceToward(watched);
      return;
    }
    const goalX = goal.x * this.tileSize;
    const goalY = goal.y * this.tileSize;
    const toGoal = Math.hypot(goalX - this.x, goalY - this.y);
    const arriveTiles = this.arrivedAtGoal ? ARRIVE_RELEASE_TILES : ARRIVE_TILES;
    // A step that went nowhere this close in is arrival too: a wall edge or a
    // body can hold him just short of the tile, and walking on the spot there
    // would play the drift with nothing moving.
    const stalledClose =
      this.x === this.lastX &&
      this.y === this.lastY &&
      toGoal <= this.tileSize * ARRIVE_RELEASE_TILES;
    if (toGoal <= this.tileSize * arriveTiles || stalledClose) {
      this.walkStalledFrames = 0;
      this.arrivedAtGoal = true;
      this.isMoving = false;
      if (watched !== null) this.faceToward(watched);
      return;
    }
    this.arrivedAtGoal = false;
    if (this.walkStalledFrames >= NECRO_STUCK_BLINK_FRAMES && this.beginUnstickBlink()) return;
    const pace = inProcession ? this.processionPace : this.speed;
    const fromX = this.x;
    const fromY = this.y;
    this.followTargetAStar(goalX, goalY, pace, this.tileSize * ARRIVE_TILES);
    const heldInPlace = this.x === fromX && this.y === fromY;
    this.walkStalledFrames = heldInPlace ? this.walkStalledFrames + 1 : 0;
    if (this.walkStalledFrames === Math.floor(NECRO_STUCK_BLINK_FRAMES / 2))
      prewarmNecromancerBlink();
  }

  /**
   * Blinks him to open ground at his post, once his walk there has gone
   * nowhere for {@link NECRO_STUCK_BLINK_FRAMES}. Returns whether the blink
   * began. Allowed in procession too: arriving with his standing rows still
   * baking beats never arriving at all.
   */
  private beginUnstickBlink(): boolean {
    this.walkStalledFrames = 0;
    const destination = this.unstickDestination();
    if (destination === null) return false;
    this.blinkDestination = destination;
    this.isMoving = false;
    this.faceFront();
    this.cues.push({ id: 'teleport' });
    this.enterPhase('blink_out');
    return true;
  }

  /** The open tile nearest his post that a blink may land on, or null outside the siege. */
  private unstickDestination(): SiegeTile | null {
    const anchor = this.homeAnchor();
    if (anchor === null) return null;
    for (let radius = 0; radius <= NECRO_UNSTICK_SEARCH_TILES; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const tileX = anchor.x + dx;
          const tileY = anchor.y + dy;
          if (this.isInHomeZone(tileX, tileY)) return { x: tileX, y: tileY };
        }
      }
    }
    return null;
  }

  /**
   * Where to stand next. Outside the siege, wherever he is. Inside it: until
   * he reaches his home zone, its anchor; then the tile near him in the zone
   * that best keeps sight of the defender he is watching at bolt range.
   */
  private chooseStandingTile(here: SiegeTile, watched: Player | null): SiegeTile | null {
    if (this.siegeCapable === null) return null;
    if (!this.isInHomeZone(here.x, here.y)) return this.homeAnchor();
    if (watched === null) return this.homeAnchor() ?? here;
    const map = this.map;
    const watchedTile = tileUnder(watched);
    let best: SiegeTile = here;
    let bestScore = -Infinity;
    for (let dy = -NECRO_REPOSITION_RADIUS_TILES; dy <= NECRO_REPOSITION_RADIUS_TILES; dy++) {
      for (let dx = -NECRO_REPOSITION_RADIUS_TILES; dx <= NECRO_REPOSITION_RADIUS_TILES; dx++) {
        const tileX = here.x + dx;
        const tileY = here.y + dy;
        if (!this.isInHomeZone(tileX, tileY)) continue;
        const centreX = tileX * this.tileSize + this.tileSize * HALF;
        const centreY = tileY * this.tileSize + this.tileSize * HALF;
        const sees =
          map === null ||
          map.hasLineOfSight(
            centreX,
            centreY,
            watched.x + this.tileSize * HALF,
            watched.y + this.tileSize * HALF,
          );
        const range = Math.hypot(tileX - watchedTile.x, tileY - watchedTile.y);
        const score =
          (sees ? SCORE_SIGHT : 0) -
          Math.abs(range - NECRO_PREFERRED_RANGE_TILES) * SCORE_RANGE_PER_TILE -
          Math.hypot(dx, dy) * SCORE_WALK_PER_TILE;
        if (score > bestScore) {
          bestScore = score;
          best = { x: tileX, y: tileY };
        }
      }
    }
    return best;
  }

  // ── Casting ────────────────────────────────────────────────────────────────

  /**
   * Warms each cast's row, in the view he faces, as its cooldown runs down —
   * far enough ahead for the bake to finish before its first frame — and
   * again periodically while a ready cast waits for a reason to fire.
   */
  private warmUpcomingCasts(): void {
    const view = viewForFacing(this.facingX, this.facingY);
    this.warmCast('cast_raise', this.raiseCooldown, view);
    this.warmCast('cast_bolt', this.boltCooldown, view);
    if (this.siegeCapable !== null) this.warmCast('cast_pulse', this.pulseCooldown, view);
  }

  private warmCast(cast: NecromancerCast, cooldown: number, view: NecromancerView): void {
    if (cooldown > CAST_PREWARM_LEAD_UPDATES) return;
    const warmedAt = this.castWarmedAt[cast];
    if (warmedAt !== null && this.idleTicks - warmedAt < CAST_REWARM_FRAMES) return;
    this.castWarmedAt[cast] = this.idleTicks;
    prewarmNecromancerCast(cast, view);
  }

  private beginACast(targets: readonly Player[]): boolean {
    if (this.pulseCooldown === 0 && this.beginPulse()) return true;
    if (this.raiseCooldown === 0 && !this.escortAtCap && this.beginRaise()) return true;
    if (this.boltCooldown === 0 && this.beginBolt(targets)) return true;
    return false;
  }

  private endCast(): void {
    const phase = this.phase;
    if (phase === 'cast_raise' || phase === 'cast_bolt' || phase === 'cast_pulse') {
      this.castWarmedAt[phase] = null;
    }
    this.enterPhase('hold');
    this.castGap = NECRO_CAST_GAP_FRAMES;
    this.pulseTarget = null;
    this.pulsePoint = null;
    this.channelDamage = 0;
    this.raiseSites = [];
    this.raiseKinds = [];
    this.raiseLooks = [];
    this.boltTarget = null;
  }

  // Raise the Dead

  private beginRaise(): boolean {
    const room = Math.max(0, NECRO_ESCORT_CAP - this.escortLiving);
    const inSiege = this.siegeCapable !== null;
    const count = Math.min(inSiege ? NECRO_SIEGE_RAISE_BATCH : NECRO_RAISE_BATCH, room);
    if (count === 0) return false;
    const inner = this.chooseInnerRaiseSites(Math.min(NECRO_INNER_RAISES, count));
    const sites = [...inner, ...this.chooseRaiseSites(count - inner.length)];
    if (sites.length === 0) return false;
    this.raiseSites = sites;
    this.raiseKinds = sites.map(() => (inSiege ? pickSiegeRaiseKind() : 'ratkin'));
    this.raiseLooks = sites.map(() => pickLook());
    this.raiseKinds.forEach((kind, index) => {
      if (kind === 'ratkin') prewarmRaisedRatkin(this.raiseLooks[index] ?? pickLook());
    });
    if (this.raiseKinds.some((kind) => kind !== 'ratkin')) prewarmSkeletonEscortSprites();
    this.isMoving = false;
    this.faceFront();
    this.cues.push({ id: 'necromancer_raise' });
    this.enterPhase('cast_raise');
    return true;
  }

  private updateRaise(): void {
    this.isMoving = false;
    if (this.phaseTicks === NECRO_RAISE_TELEGRAPH_FRAMES) {
      this.raiseSites.forEach((site, index) => {
        this.pendingRaises.push({
          tileX: site.x,
          tileY: site.y,
          kind: this.raiseKinds[index] ?? 'ratkin',
          look: this.raiseLooks[index] ?? pickLook(),
        });
      });
      this.raiseCooldown = this.scaledCooldownFrames(NECRO_RAISE_COOLDOWN_FRAMES);
    }
    if (this.phaseTicks >= RAISE_ROW_TICKS) this.endCast();
  }

  /**
   * Where the dead will rise, in order of preference: corpses near him, then
   * graves in the ruins, then open ground around him. Only ground outside the
   * palisade: the raises inside it are {@link chooseInnerRaiseSites}'.
   */
  private chooseRaiseSites(count: number): SiegeTile[] {
    const sites: SiegeTile[] = [];
    const taken = new Set<string>();
    const accept = (tileX: number, tileY: number): boolean => {
      const key = `${tileX},${tileY}`;
      if (taken.has(key) || !this.isRaiseGround(tileX, tileY)) return false;
      taken.add(key);
      sites.push({ x: tileX, y: tileY });
      return true;
    };

    const siege = this.siegeCapable;
    if (siege !== null) {
      const corpses = siege.world.mobs
        .filter(
          (mob) =>
            !mob.isAlive &&
            mob !== this &&
            !mob.isConverted &&
            !this.usedCorpses.has(mob) &&
            this.distanceTo(mob) <= this.tileSize * NECRO_CORPSE_SEARCH_TILES,
        )
        .sort((a, b) => this.distanceTo(a) - this.distanceTo(b));
      for (const corpse of corpses) {
        if (sites.length >= count) break;
        const tile = tileUnder(corpse);
        if (accept(tile.x, tile.y)) this.usedCorpses.add(corpse);
      }
      const ruins = siege.world.site.ruins;
      const here = tileUnder(this);
      const graves: SiegeTile[] = [];
      const reach = Math.ceil(ruins.radiusTiles);
      for (let dy = -reach; dy <= reach && sites.length < count; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (Math.hypot(dx, dy) > ruins.radiusTiles) continue;
          const tileX = ruins.centre.x + dx;
          const tileY = ruins.centre.y + dy;
          if (Math.hypot(tileX - here.x, tileY - here.y) > NECRO_GRAVE_SEARCH_TILES) continue;
          graves.push({ x: tileX, y: tileY });
        }
      }
      graves.sort(
        (a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y),
      );
      for (const grave of graves) {
        if (sites.length >= count) break;
        accept(grave.x, grave.y);
      }
    }

    const here = tileUnder(this);
    for (let radius = OPEN_GROUND_MIN_TILES; radius <= OPEN_GROUND_MAX_TILES; radius++) {
      if (sites.length >= count) break;
      const ring: SiegeTile[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          ring.push({ x: here.x + dx, y: here.y + dy });
        }
      }
      while (ring.length > 0 && sites.length < count) {
        const index = Math.floor(Math.random() * ring.length);
        const [tile] = ring.splice(index, 1);
        accept(tile.x, tile.y);
      }
    }
    return sites;
  }

  /**
   * Up to `count` sigils inside the palisade, in a siege: open ground near
   * the bell, clear of every defender by
   * {@link NECRO_INNER_RAISE_MIN_DEFENDER_TILES}. Drawn at random, so the
   * dead come up somewhere new each time.
   */
  private chooseInnerRaiseSites(count: number): SiegeTile[] {
    const siege = this.siegeCapable;
    const map = this.map;
    if (siege === null || map === null || count <= 0) return [];
    const { site } = siege.world;
    const bell = site.square.bellTile;
    const defenders = this.latestTargets.filter((target) => target.isAlive);
    const clearOfDefenders = (tileX: number, tileY: number): boolean =>
      defenders.every((defender) => {
        const tile = tileUnder(defender);
        return Math.hypot(tile.x - tileX, tile.y - tileY) >= NECRO_INNER_RAISE_MIN_DEFENDER_TILES;
      });
    const reach = NECRO_INNER_RAISE_BELL_TILES;
    const candidates: SiegeTile[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) > reach) continue;
        const tileX = bell.x + dx;
        const tileY = bell.y + dy;
        if (!isInsidePalisadeTile(site, tileX, tileY)) continue;
        if (!map.isWalkableForHostile(tileX, tileY) || !hasRoomToMove(map, tileX, tileY)) continue;
        if (!clearOfDefenders(tileX, tileY)) continue;
        candidates.push({ x: tileX, y: tileY });
      }
    }
    const sites: SiegeTile[] = [];
    while (candidates.length > 0 && sites.length < count) {
      const index = Math.floor(Math.random() * candidates.length);
      const [tile] = candidates.splice(index, 1);
      sites.push(tile);
    }
    return sites;
  }

  private isRaiseGround(tileX: number, tileY: number): boolean {
    const map = this.map;
    if (map !== null && !map.isWalkableForHostile(tileX, tileY)) return false;
    if (map !== null && !hasRoomToMove(map, tileX, tileY)) return false;
    const field = this.field;
    if (field !== null && !field.isOutsideBy(tileX, tileY, 1)) return false;
    return true;
  }

  // Soul Bolt volley

  private beginBolt(targets: readonly Player[]): boolean {
    const rangePx = this.tileSize * NECRO_BOLT_RANGE_TILES;
    let chosen: Player | null = null;
    let chosenDistance = rangePx;
    for (const target of targets) {
      if (!target.isAlive || target.isDefendTarget === true) continue;
      const distance = this.distanceTo(target);
      if (distance > chosenDistance || !this.hasLOS(target)) continue;
      chosen = target;
      chosenDistance = distance;
    }
    if (chosen === null) return false;
    // Locked here, on the first frame of the telegraph: the fan on the ground
    // is the volley's real path, however the target moves during the cast.
    this.boltAngle = Math.atan2(chosen.y - this.y, chosen.x - this.x);
    this.boltTarget = chosen;
    this.faceToward(chosen);
    this.isMoving = false;
    this.enterPhase('cast_bolt');
    return true;
  }

  private updateBolt(): void {
    this.isMoving = false;
    if (this.phaseTicks === NECRO_BOLT_TELEGRAPH_FRAMES) this.releaseVolley();
    if (this.phaseTicks >= BOLT_ROW_TICKS) this.endCast();
  }

  private releaseVolley(): void {
    const originX = this.x + this.tileSize * HALF;
    const originY = this.y + this.tileSize * HALF;
    const damage = this.scaledDamage(NECRO_BOLT_DAMAGE);
    const target = this.boltTarget;
    const aimedAt = target !== null && !target.isCrawler ? target : null;
    for (let i = 0; i < NECROMANCER_VOLLEY_BOLTS; i++) {
      const angle =
        this.boltAngle + (i - (NECROMANCER_VOLLEY_BOLTS - 1) / 2) * NECROMANCER_VOLLEY_SPREAD;
      this.pendingShots.push({
        kind: 'hollow_soul_bolt',
        x: originX,
        y: originY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        damage,
        mobType: this.mobType,
        aimedAt,
      });
    }
    this.boltCooldown = this.scaledCooldownFrames(NECRO_BOLT_COOLDOWN_FRAMES);
    this.projectileSoundPending = true;
    this.cues.push({ id: 'necromancer_bolt' });
  }

  // Grave Pulse

  /** The palisade segment or trebuchet in reach with the lowest share of its health left. */
  chooseGravePulseTarget(): { ref: StructureRef; point: { x: number; y: number } } | null {
    const siege = this.siegeCapable;
    if (siege === null) return null;
    const { defense } = siege.world;
    const reachPx = this.tileSize * NECRO_PULSE_RANGE_TILES;
    const candidates: StructureRef[] = [
      ...defense.segments.map((segment): StructureRef => ({ kind: 'segment', id: segment.id })),
      ...defense.trebuchets.map((record): StructureRef => ({
        kind: 'trebuchet',
        key: `${record.x},${record.y}`,
      })),
    ];
    let best: { ref: StructureRef; point: { x: number; y: number } } | null = null;
    let bestFraction = Infinity;
    let bestDistance = Infinity;
    for (const ref of candidates) {
      if (!isStandingStructure(defense, ref)) continue;
      const maxHp = defense.maxHp(ref);
      if (maxHp <= 0) continue;
      const point = nearestStructurePoint(defense, ref, this);
      if (point === null) continue;
      const distance = Math.hypot(
        point.x - (this.x + this.tileSize * HALF),
        point.y - (this.y + this.tileSize * HALF),
      );
      if (distance > reachPx) continue;
      const fraction = defense.hp(ref) / maxHp;
      if (fraction < bestFraction || (fraction === bestFraction && distance < bestDistance)) {
        best = { ref, point };
        bestFraction = fraction;
        bestDistance = distance;
      }
    }
    return best;
  }

  private beginPulse(): boolean {
    const chosen = this.chooseGravePulseTarget();
    if (chosen === null) return false;
    this.pulseTarget = chosen.ref;
    this.pulsePoint = chosen.point;
    this.channelDamage = 0;
    const half = this.tileSize * HALF;
    this.faceToward({ x: chosen.point.x - half, y: chosen.point.y - half });
    this.isMoving = false;
    this.cues.push({ id: 'necromancer_pulse_charge' });
    this.pulseCooldown = this.scaledCooldownFrames(NECRO_PULSE_COOLDOWN_FRAMES);
    this.enterPhase('cast_pulse');
    return true;
  }

  private updatePulse(): void {
    this.isMoving = false;
    const siege = this.siegeCapable;
    const target = this.pulseTarget;
    // The channel re-checks what it is aimed at every frame: a wall that fell
    // to something else mid-channel leaves nothing for the pulse to strike.
    if (siege === null || target === null || !isStandingStructure(siege.world.defense, target)) {
      this.endCast();
      return;
    }
    if (this.phaseTicks < NECRO_PULSE_CHANNEL_FRAMES) return;
    siege.world.defense.damage(target, NECRO_PULSE_STRUCTURE_DAMAGE, this, 'ranged');
    this.strikeBand();
    this.pulsesLanded++;
    this.lastPulseTarget = target;
    this.cues.push({ id: 'necromancer_pulse_release' });
    this.endCast();
  }

  /** Everyone standing in the lit band between the staff and the target when it goes off. */
  private strikeBand(): void {
    const point = this.pulsePoint;
    if (point === null) return;
    const half = this.tileSize * HALF;
    const fromX = this.x + half;
    const fromY = this.y + half;
    const segX = point.x - fromX;
    const segY = point.y - fromY;
    const lengthSq = segX * segX + segY * segY || 1;
    const source = this.stampHarmLimits({
      kind: 'mob',
      mobType: this.mobType,
      attackType: NECRO_PULSE_ATTACK_TYPE,
      undodgeable: true,
    });
    for (const target of this.latestTargets) {
      if (!target.isAlive || target.isDefendTarget === true) continue;
      const cx = target.x + half;
      const cy = target.y + half;
      const along = Math.max(
        0,
        Math.min(1, ((cx - fromX) * segX + (cy - fromY) * segY) / lengthSq),
      );
      const nearX = fromX + segX * along;
      const nearY = fromY + segY * along;
      if (Math.hypot(cx - nearX, cy - nearY) > this.tileSize * PULSE_BAND_HIT_HALF_TILES) continue;
      if (target.takeDamage(NECRO_PULSE_BAND_DAMAGE, source)) this.noteStruckPlayer(target);
    }
  }

  // Blink

  private shouldBlink(): boolean {
    return this.blinkCooldown === 0 && this.crowdedFrames > NECRO_BLINK_TRIGGER_FRAMES;
  }

  private beginBlink(): boolean {
    const destination = this.chooseBlinkDestination();
    if (destination === null) {
      this.blinkCooldown = NECRO_CAST_GAP_FRAMES;
      return false;
    }
    this.blinkDestination = destination;
    this.isMoving = false;
    this.faceFront();
    this.cues.push({ id: 'teleport' });
    this.enterPhase('blink_out');
    return true;
  }

  private updateBlinkOut(): void {
    this.isMoving = false;
    if (this.phaseTicks < BLINK_ROW_TICKS) return;
    const destination = this.blinkDestination;
    if (destination !== null) {
      // Set directly: the mob loop re-buckets him in the grid from where this
      // update began, whatever moved him in it.
      this.x = destination.x * this.tileSize;
      this.y = destination.y * this.tileSize;
      this.lastX = this.x;
      this.lastY = this.y;
      this.blinks++;
      this.lastBlinkLanding = destination;
    }
    this.blinkDestination = null;
    this.goal = null;
    this.crowdedFrames = 0;
    this.blinkCooldown = NECRO_BLINK_COOLDOWN_FRAMES;
    this.enterPhase('blink_in');
  }

  /**
   * Six to eight tiles away, back toward where his lane's dead rise (the
   * ruins, for the east lane): walkable, with room around it, outside the
   * palisade by the wall minimum, and inside his home zone where the arc
   * reaches it.
   */
  chooseBlinkDestination(): SiegeTile | null {
    const here = tileUnder(this);
    const siege = this.siegeCapable;
    const retreat = this.homeLane()?.spawn ?? siege?.world.site.ruins.centre ?? null;
    const baseAngle =
      retreat === null
        ? Math.atan2(this.facingY, this.facingX)
        : Math.atan2(retreat.y - here.y, retreat.x - here.x);
    const field = this.field;
    const map = this.map;
    let fallback: SiegeTile | null = null;
    for (let sample = 0; sample < BLINK_ARC_SAMPLES; sample++) {
      // Straight back first, then fanning out either side.
      const side = sample % 2 === 0 ? 1 : -1;
      const offset = Math.ceil(sample / 2) / Math.ceil(BLINK_ARC_SAMPLES / 2);
      const angle = baseAngle + side * offset * BLINK_ARC_HALF;
      for (let distance = NECRO_BLINK_MAX_TILES; distance >= NECRO_BLINK_MIN_TILES; distance--) {
        const tileX = Math.round(here.x + Math.cos(angle) * distance);
        const tileY = Math.round(here.y + Math.sin(angle) * distance);
        if (map !== null && !map.isWalkableForHostile(tileX, tileY)) continue;
        if (map !== null && !hasRoomToMove(map, tileX, tileY)) continue;
        if (field !== null && !field.isOutsideBy(tileX, tileY, NECRO_MIN_WALL_DISTANCE_TILES)) {
          continue;
        }
        if (
          siege !== null &&
          isInsidePalisade(siege.world.site, { x: tileX * this.tileSize, y: tileY * this.tileSize })
        ) {
          continue;
        }
        if (siege === null || this.isInHomeZone(tileX, tileY)) return { x: tileX, y: tileY };
        fallback ??= { x: tileX, y: tileY };
      }
    }
    return fallback;
  }

  private faceFront(): void {
    this.facingX = 0;
    this.facingY = 1;
  }

  // ── Death ──────────────────────────────────────────────────────────────────

  override tickCorpse(): void {
    if (this.corpseFrames === 0) this.cues.push({ id: 'necromancer_death' });
    this.corpseFrames++;
  }

  override get corpseExpired(): boolean {
    return (
      !this.isAlive &&
      this.corpseFrames >= DEATH_ROW_TICKS + NECRO_CORPSE_HOLD_FRAMES + NECRO_CORPSE_FADE_FRAMES
    );
  }

  private get corpseAlpha(): number {
    const fadeStart = DEATH_ROW_TICKS + NECRO_CORPSE_HOLD_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / NECRO_CORPSE_FADE_FRAMES);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  /** The row and frame being drawn. */
  get currentRow(): { action: NecromancerAction; frame: number } {
    if (!this.isAlive) {
      return {
        action: 'death',
        frame: Math.min(
          DEATH_FRAMES - 1,
          Math.floor(this.corpseFrames / NECROMANCER_TICKS_PER_FRAME.death),
        ),
      };
    }
    switch (this.phase) {
      case 'cast_raise':
      case 'cast_bolt':
      case 'blink_out':
      case 'blink_in':
        return { action: this.phase, frame: this.oneShotFrame(this.phase) };
      case 'cast_pulse': {
        const frame = Math.floor(this.phaseTicks / NECROMANCER_TICKS_PER_FRAME.cast_pulse);
        if (frame < CAST_PULSE_FRAMES) return { action: 'cast_pulse', frame };
        const loopLength = CAST_PULSE_FRAMES - CAST_PULSE_CHANNEL_FROM;
        return {
          action: 'cast_pulse',
          frame: CAST_PULSE_CHANNEL_FROM + ((frame - CAST_PULSE_FRAMES) % loopLength),
        };
      }
      case 'hold':
        break;
    }
    if (this.hurtTimer > 0) {
      const progress = 1 - this.hurtTimer / HURT_ROW_TICKS;
      return {
        action: 'hurt',
        frame: Math.min(HURT_FRAMES - 1, Math.floor(progress * HURT_FRAMES)),
      };
    }
    if (this.isMoving) return { action: 'drift', frame: Math.floor(this.driftFrame) };
    return {
      action: 'idle',
      frame: Math.floor(this.idleTicks / NECROMANCER_TICKS_PER_FRAME.idle) % IDLE_FRAMES,
    };
  }

  private oneShotFrame(action: 'cast_raise' | 'cast_bolt' | 'blink_out' | 'blink_in'): number {
    const frames =
      action === 'cast_raise'
        ? CAST_RAISE_FRAMES
        : action === 'cast_bolt'
          ? CAST_BOLT_FRAMES
          : BLINK_FRAMES;
    return Math.min(frames - 1, Math.floor(this.phaseTicks / NECROMANCER_TICKS_PER_FRAME[action]));
  }

  /**
   * His ground marks, drawn in the ground pass under every body: sigils,
   * the bolt fan, the pulse's band and cracks, and the blink's landing.
   */
  renderGroundTelegraph(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const telegraph = this.groundTelegraph;
    if (telegraph === null) return;
    const tile = this.tileSize;
    switch (telegraph.kind) {
      case 'raise':
        for (const site of telegraph.sites) {
          drawRaiseSigil(
            ctx,
            site.x * tile + tile * HALF - camX,
            site.y * tile + tile * HALF - camY,
            tile,
            telegraph.progress,
          );
        }
        return;
      case 'bolt':
        drawBoltFan(
          ctx,
          telegraph.fromX - camX,
          telegraph.fromY - camY,
          telegraph.angle,
          tile,
          telegraph.progress,
        );
        return;
      case 'pulse':
        drawPulseTelegraph(
          ctx,
          telegraph.fromX - camX,
          telegraph.fromY - camY,
          telegraph.toX - camX,
          telegraph.toY - camY,
          tile,
          telegraph.progress,
        );
        return;
      case 'blink':
        drawBlinkMark(ctx, telegraph.x - camX, telegraph.y - camY, tile, telegraph.progress);
        return;
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const row = this.currentRow;
    drawNecromancerSprite(
      ctx,
      row.action,
      viewForFacing(this.facingX, this.facingY),
      row.frame,
      sx,
      sy,
      tileSize,
      this.facingX < 0,
      this.isAlive ? this.retreatAlpha : this.corpseAlpha,
    );
    if (this.isAlive && !this.isFadingAway) {
      this.renderMobHealthBar(ctx, sx, sy - tileSize * NECROMANCER_HEAD_ABOVE_TILE_TILES);
    }
  }
}

/** Draws every living necromancer's ground marks. For a scene's ground pass. */
export function renderNecromancerTelegraphs(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  mobs: readonly Mob[],
): void {
  for (const mob of mobs) {
    if (mob instanceof Necromancer && mob.isAlive) mob.renderGroundTelegraph(ctx, camX, camY);
  }
}
