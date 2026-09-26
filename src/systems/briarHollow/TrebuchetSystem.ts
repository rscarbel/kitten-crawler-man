/**
 * TrebuchetSystem — what the village's trebuchets do once they are built:
 * pick a target, wind up, lob a boulder, and what that boulder does where it
 * lands.
 *
 * A trebuchet fires every {@link TREBUCHET_FIRE_INTERVAL_FRAMES} at the best
 * hostile between {@link TREBUCHET_MIN_GAP_TILES} and
 * {@link TREBUCHET_RANGE_TILES} of its footprint, leading a walking target.
 * The landing point is fixed the moment the boulder leaves the sling, and
 * everything the boulder does is decided there, with the real landing point
 * in hand: a crushing blow to whatever it lands on, a shatter of fragments
 * round it, a single dodgeable point of shrapnel to any friend too close, and
 * a shove outward for everyone it caught.
 *
 * Boulders are owned here, never by the trebuchet that threw them, so a
 * trebuchet smashed while its boulder is in the air still lands its shot.
 *
 * Every hostile it hurts is credited to the crawler recorded as the
 * trebuchet's builder, whose own Construction level also decides the
 * level-15 extras: bottomless ammunition and infernal boulders that burn and
 * leave a slowing miasma behind them.
 *
 * Nothing here is saved. A trebuchet's ammo, HP and broken state are
 * `BriarHollowState`'s; the wind-up, the boulders in flight and the clouds on
 * the ground are moments, and a door visit or a rewind simply starts them
 * afresh.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Player, DamageSource } from '../../Player';
import type { Mob } from '../../creatures/Mob';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { GHOUL_HP } from '../../creatures/RuinsGhoul';
import { SKELETON_HP } from '../../creatures/SkeletonWarrior';
import { ARCHER_HP } from '../../creatures/SkeletonArcher';
import { RAISED_RATKIN_HP } from '../../creatures/RaisedRatkin';
import { LOCKED_TELEGRAPH_MIN_FRAMES, levelledMaxHp } from '../../creatures/mobLevelScaling';
import type { MobRoster } from '../kits/SceneWorld';
import type { EventBus } from '../../core/EventBus';
import type { AudioManager } from '../../audio/AudioManager';
import { VILLAGE_CUES } from '../../audio/villageSoundCues';
import type { CrawlerKind } from '../../core/SkillManager';
import type { TrebuchetStructureRecord } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { infernalTrebuchets, unlimitedAmmo } from '../../core/craftPerks';
import { makeBurn } from '../../core/StatusEffect';
import {
  TREBUCHET_COCKED_ANGLE,
  TREBUCHET_LOOSED_ANGLE,
  trebuchetReleasePoint,
} from '../../sprites/art/trebuchetArt';
import { drawResourceIcon } from '../../ui/icons/resourceIcons';
import {
  BOULDER_SPIN_PER_FRAME,
  BURST_FRAMES,
  EMBER_FRAMES,
  drawBoulder,
  drawBoulderShadow,
  drawBurst,
  drawEmber,
  drawLandingRing,
  drawMiasma,
  drawWrench,
  emberDrift,
} from '../../sprites/art/siegeEffectsArt';
import { BOX_PRESETS, PROGRESS_PRESETS, drawBox, drawProgressBar } from '../../ui/Box';
import { TEXT_PRESETS, drawText } from '../../ui/TextBox';
import {
  type DefenseStructures,
  type TileFootprint,
  structureKey,
  trebuchetFootprint,
} from './DefenseStructures';
import { StructureCallouts } from './structureCallouts';
import { TREBUCHET_MAX_AMMO, TREBUCHET_RANGE_TILES, UPDATES_PER_SECOND } from './structureRules';

// ── Firing ──────────────────────────────────────────────────────────────────

const TREBUCHET_FIRE_INTERVAL_SECONDS = 3;
/** Updates between two releases of one trebuchet. */
export const TREBUCHET_FIRE_INTERVAL_FRAMES = TREBUCHET_FIRE_INTERVAL_SECONDS * UPDATES_PER_SECOND;
/** A trebuchet cannot hit anything closer than this to its own footprint. */
export const TREBUCHET_MIN_GAP_TILES = 1;
/** Updates the arm spends swinging over before the boulder leaves the sling. */
export const TREBUCHET_WINDUP_FRAMES = 24;
/** Chance each throw has of snapping the arm. */
export const TREBUCHET_BREAK_CHANCE = 0.04;
/** Updates the arm takes to settle back to cocked after a throw. Visual only. */
const ARM_RETURN_FRAMES = 50;

/** Hostiles within this of the palisade, on its outer side, are the first to be shot at. */
const PALISADE_THREAT_TILES = 3;
/**
 * How much further away a boss counts as standing when targets are ranked,
 * so a boss beside its minions yields the shot to them rather than soaking
 * every boulder while they breach the wall.
 */
const BOSS_RANK_PENALTY_TILES = 1;

/** A target's velocity is its movement over this many updates. */
const VELOCITY_WINDOW_FRAMES = 6;
/** The lead is held to this far from where the target stands, so a jittering target cannot throw the aim wide. */
const MAX_LEAD_TILES = 1.5;
/**
 * How much of the target's full predicted travel the aim leads by. Short of
 * all of it on purpose: a body that turns mid-flight ends up nearer where it
 * stood than where it was heading, and a full lead lands wider than none at
 * all against anything weaving; three quarters stays tight on a straight
 * walker and still halves the miss on a zig-zagger.
 */
const LEAD_FRACTION = 0.75;
/**
 * A siege mob between two blows on a structure is still attacking it while
 * the structure it is set on stands within this of it.
 */
const STRIKING_REACH_TILES = 1.5;

// ── Flight ──────────────────────────────────────────────────────────────────

/**
 * Flight time per tile of range. Together with the bounds below, a shot
 * crosses one tile in about a third of a second and ten in under three
 * quarters: fast enough to read as a siege engine, never so fast that a
 * friend standing where it lands has no warning.
 */
const FLIGHT_FRAMES_PER_TILE = 4.2;
/**
 * The shortest flight, which is also how long the landing ring warns anyone
 * standing where it will come down: never under the game's locked-telegraph
 * floor.
 */
const MIN_FLIGHT_FRAMES = LOCKED_TELEGRAPH_MIN_FRAMES;
const MAX_FLIGHT_FRAMES = 42;
/** Peak of the lob above the straight line from sling to ground, in tiles. */
const ARC_HEIGHT_TILES = 2.4;
/** Scales `t(1 − t)`, whose own peak is a quarter, so the apex is exactly {@link ARC_HEIGHT_TILES}. */
const PARABOLA_PEAK_NORMALISER = 4;

// ── Impact ──────────────────────────────────────────────────────────────────

/** The one hostile the boulder lands on is the nearest whose centre is within this of the landing point. */
export const DIRECT_HIT_RADIUS_TILES = 0.6;
/** Fragments hurt every other body within this of the landing point. */
export const SHATTER_RADIUS_TILES = 1.75;
/** The direct hit, as a multiple of a same-level Ruins Ghoul's health: it always kills one. */
export const TREBUCHET_DIRECT_HP_MULTIPLE = 2.5;
/** The shatter, as a multiple of the weakest wave creature's health: it always kills one. */
export const TREBUCHET_SPLASH_HP_MULTIPLE = 1.1;
/** What the shrapnel does to a friend: one point, whatever the level. */
export const TREBUCHET_FRIENDLY_FIRE_DAMAGE = 1;
/** How far a boulder throws a hostile it catches. */
export const TREBUCHET_KNOCKBACK_TILES = 1.0;
/** How far it throws a friend: enough to feel, never enough to carry them into trouble. */
export const TREBUCHET_FRIENDLY_KNOCKBACK_TILES = 0.6;
const KNOCKBACK_FRAMES = 10;

/** A crawler's shrapnel can be dodged like any thrown blow. */
const CRAWLER_SHRAPNEL: DamageSource = { kind: 'siege', dodgeable: true };
/** An ally mob has no dodge to roll; it simply takes the point. */
const MOB_SHRAPNEL: DamageSource = { kind: 'siege', dodgeable: false };

// ── Infernal boulders ───────────────────────────────────────────────────────

export const MIASMA_RADIUS_TILES = 1.5;
const MIASMA_SECONDS = 6;
export const MIASMA_FRAMES = MIASMA_SECONDS * UPDATES_PER_SECOND;
export const MIASMA_TICK_FRAMES = 30;
/** Flat per tick: it is a lingering nuisance on top of the boulder, not a second boulder. */
export const MIASMA_DAMAGE = 2;
/** Refreshed every update a hostile stands in the cloud, so the slow lifts just after it walks out. */
const MIASMA_SLOW_FRAMES = 2;
const MIASMA_RISE_FRAMES = 20;
const MIASMA_FADE_FRAMES = 70;
const MAX_MIASMA_CLOUDS = 10;

// ── Feedback ────────────────────────────────────────────────────────────────

/** The ammo pill shows while any crawler is this close to the trebuchet. */
export const AMMO_PILL_VISIBLE_TILES = 12;
/** An impact this close to the active crawler shakes the screen. */
const SHAKE_RADIUS_TILES = 9;
const SHAKE_PEAK_PX = 4;
const SHAKE_FRAMES = 14;
/** Two unrelated rates, so the shake wanders rather than tracing a line. */
const SHAKE_WOBBLE_X = 1.9;
const SHAKE_WOBBLE_Y = 2.3;

const TREBUCHET_FIRE_SOUNDS = ['trebuchet_fire_1', 'trebuchet_fire_2'] as const;
const BOULDER_IMPACT_SOUNDS = [
  'boulder_impact_1',
  'boulder_impact_2',
  'boulder_impact_3',
  'boulder_impact_4',
] as const;

const HALF_TILE = TILE_SIZE / 2;
const FULL_TURN = Math.PI * 2;
/**
 * Extra reach on the search round a trebuchet, past its range and its
 * footprint's half-diagonal, so a body whose corner sits just outside the
 * circle while its centre is in range is still found.
 */
const HOSTILE_SEARCH_SLACK_TILES = 1;

// ── Types ───────────────────────────────────────────────────────────────────

interface EngineState {
  /** Updates since the last release. Starts full, so a new trebuchet fires as soon as it sees a target. */
  sinceRelease: number;
  /** Updates left in the wind-up, or 0 when not winding up. */
  windupLeft: number;
  /** Updates left of the arm settling back after a throw. */
  returnLeft: number;
}

interface Boulder {
  readonly fromX: number;
  readonly fromY: number;
  readonly releaseHeightPx: number;
  readonly toX: number;
  readonly toY: number;
  readonly flightFrames: number;
  /** The crawler whose trebuchet threw it, credited with everything it kills. */
  readonly builtBy: CrawlerKind;
  /** The level its damage was sized for, fixed at the throw. */
  readonly level: number;
  readonly infernal: boolean;
  readonly spinSeed: number;
  age: number;
}

/** A lingering cloud an infernal boulder leaves: it slows and chokes hostiles, and nothing else. */
interface SiegeMiasmaCloud {
  readonly x: number;
  readonly y: number;
  readonly builtBy: CrawlerKind;
  readonly seed: number;
  age: number;
}

interface ImpactBurst {
  readonly x: number;
  readonly y: number;
  readonly infernal: boolean;
  readonly seed: number;
  age: number;
}

interface Ember {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  age: number;
}

/** Where a boulder is on its way, for gates and anything that draws it. */
export interface BoulderView {
  readonly groundX: number;
  readonly groundY: number;
  readonly heightPx: number;
  readonly toX: number;
  readonly toY: number;
  readonly progress: number;
}

/** A release, as a gate reads it: who was aimed at and where the boulder will land. */
export interface TrebuchetShot {
  readonly key: string;
  readonly target: Mob;
  readonly toX: number;
  readonly toY: number;
  readonly flightFrames: number;
}

export interface TrebuchetSystemDeps {
  readonly defense: DefenseStructures;
  readonly site: BriarHollowSite;
  readonly roster: MobRoster;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly active: () => HumanPlayer | CatPlayer;
  /** The crawler's own Construction level (0 when unlearned). */
  readonly constructionLevel: (crawler: CrawlerKind) => number;
  /** The level boulders are sized for; see `resolveSiegeLevel`. */
  readonly siegeLevel: () => number;
  readonly questPhase: () => VillageQuestPhase;
  /** Whether a body stands in a safe room, where nothing the party throws may land. */
  readonly isInSafeRoom: (point: { readonly x: number; readonly y: number }) => boolean;
  /** Uniform [0, 1) for the break roll; injectable so a gate can seed it. */
  readonly random?: () => number;
}

// ── Damage ──────────────────────────────────────────────────────────────────

/**
 * The authored health of the sturdy, common floor-3 creature a direct hit is
 * sized to kill. Read as a constant rather than off a constructed creature:
 * a constructor may draw from the world's random stream, and a boulder's
 * first impact at a new level would shift every draw after it.
 */
const DIRECT_REFERENCE_BASE_HP = GHOUL_HP;

/**
 * The assault's wave creatures' authored health. The weakest of them at a
 * level sets the shatter damage, which must kill it outright.
 */
export const SPLASH_REFERENCE_BASE_HP: readonly number[] = [
  RAISED_RATKIN_HP,
  SKELETON_HP,
  ARCHER_HP,
  GHOUL_HP,
];

/** A same-level Ruins Ghoul's max HP. */
export function referenceMobMaxHp(level: number): number {
  return levelledMaxHp(DIRECT_REFERENCE_BASE_HP, level);
}

/** The weakest wave creature's max HP at `level`. */
export function weakestWaveMobMaxHp(level: number): number {
  return Math.min(...SPLASH_REFERENCE_BASE_HP.map((baseHp) => levelledMaxHp(baseHp, level)));
}

/** What a boulder does to the one hostile it lands on, before a boss's blast scale. */
export function trebuchetDirectDamage(level: number): number {
  return Math.ceil(TREBUCHET_DIRECT_HP_MULTIPLE * referenceMobMaxHp(level));
}

/** What its fragments do to every other hostile nearby, before a boss's blast scale. */
export function trebuchetSplashDamage(level: number): number {
  return Math.ceil(TREBUCHET_SPLASH_HP_MULTIPLE * weakestWaveMobMaxHp(level));
}

/** Flight time for a throw of `distanceTiles`. */
export function flightFramesFor(distanceTiles: number): number {
  return Math.round(
    Math.min(
      MAX_FLIGHT_FRAMES,
      Math.max(MIN_FLIGHT_FRAMES, distanceTiles * FLIGHT_FRAMES_PER_TILE),
    ),
  );
}

// ── Geometry ────────────────────────────────────────────────────────────────

function centreOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

/** Distance from a point to the nearest point of a tile rectangle, in pixels. */
export function distanceToFootprintPx(px: number, py: number, footprint: TileFootprint): number {
  const left = footprint.x * TILE_SIZE;
  const top = footprint.y * TILE_SIZE;
  const right = left + footprint.w * TILE_SIZE;
  const bottom = top + footprint.h * TILE_SIZE;
  const dx = Math.max(left - px, 0, px - right);
  const dy = Math.max(top - py, 0, py - bottom);
  return Math.hypot(dx, dy);
}

/** Whether a point is somewhere a trebuchet on `footprint` may land a boulder. */
export function isInFiringBand(px: number, py: number, footprint: TileFootprint): boolean {
  const distance = distanceToFootprintPx(px, py, footprint);
  return (
    distance >= TREBUCHET_MIN_GAP_TILES * TILE_SIZE && distance <= TREBUCHET_RANGE_TILES * TILE_SIZE
  );
}

/** Smooth start and stop over 0–1: the smoothstep curve. */
function easeInOut(t: number): number {
  const eased = t * t * (SMOOTHSTEP_CUBIC - SMOOTHSTEP_SQUARE * t);
  return eased;
}
const SMOOTHSTEP_CUBIC = 3;
const SMOOTHSTEP_SQUARE = 2;

/** Recent centre positions of one mob, oldest first, for its velocity. */
interface PositionTrack {
  readonly xs: number[];
  readonly ys: number[];
  lastFrame: number;
}

export class TrebuchetSystem {
  private readonly deps: TrebuchetSystemDeps;
  private readonly engines = new Map<string, EngineState>();
  private readonly boulders: Boulder[] = [];
  private readonly clouds: SiegeMiasmaCloud[] = [];
  private readonly bursts: ImpactBurst[] = [];
  private readonly embers: Ember[] = [];
  /** Keyed weakly, so a mob that leaves the roster is not pinned by its track. */
  private readonly tracks = new WeakMap<Mob, PositionTrack>();
  readonly callouts = new StructureCallouts();
  /** Palisade tile centres, for the "pressed up against the wall" test. */
  private readonly palisadeCentres: ReadonlyArray<{ x: number; y: number }>;
  private readonly bellCentre: { x: number; y: number };
  private frame = 0;
  private shakeFramesLeft = 0;
  private timeSeconds = 0;
  /** Every release since the system was built, newest last; a gate drains it. */
  readonly shotLog: TrebuchetShot[] = [];
  /** Kept short: it exists for gates, and a live game never reads it. */
  private static readonly SHOT_LOG_LIMIT = 256;

  constructor(deps: TrebuchetSystemDeps) {
    this.deps = deps;
    this.palisadeCentres = deps.site.palisadePath.map((tile) => ({
      x: tile.x * TILE_SIZE + HALF_TILE,
      y: tile.y * TILE_SIZE + HALF_TILE,
    }));
    const bell = deps.site.square.bellTile;
    // The bell tower is two tiles square; its centre is the shared corner.
    this.bellCentre = { x: (bell.x + 1) * TILE_SIZE, y: (bell.y + 1) * TILE_SIZE };
  }

  private crawler(kind: CrawlerKind): HumanPlayer | CatPlayer {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  /** Whether a trebuchet never runs dry, because its builder reached the top of Construction. */
  hasUnlimitedAmmo(record: TrebuchetStructureRecord): boolean {
    return unlimitedAmmo(this.deps.constructionLevel(record.builtBy));
  }

  private engine(key: string): EngineState {
    let state = this.engines.get(key);
    if (state === undefined) {
      state = { sinceRelease: TREBUCHET_FIRE_INTERVAL_FRAMES, windupLeft: 0, returnLeft: 0 };
      this.engines.set(key, state);
    }
    return state;
  }

  // ── Per frame ───────────────────────────────────────────────────────────

  update(): void {
    this.frame++;
    this.timeSeconds += 1 / UPDATES_PER_SECOND;
    this.trackHostiles();
    const live = new Set<string>();
    for (const record of this.deps.defense.trebuchets) {
      const key = structureKey(record.x, record.y);
      live.add(key);
      this.updateEngine(record, key);
    }
    for (const key of [...this.engines.keys()]) {
      if (!live.has(key)) this.engines.delete(key);
    }
    this.advanceBoulders();
    this.advanceClouds();
    this.advanceEffects();
    this.callouts.update();
    if (this.shakeFramesLeft > 0) this.shakeFramesLeft--;
  }

  private updateEngine(record: TrebuchetStructureRecord, key: string): void {
    const state = this.engine(key);
    state.sinceRelease++;
    if (state.returnLeft > 0) state.returnLeft--;
    if (record.broken) {
      state.windupLeft = 0;
      return;
    }
    if (state.windupLeft > 0) {
      state.windupLeft--;
      if (state.windupLeft === 0) this.release(record, key, state);
      return;
    }
    const due = state.sinceRelease >= TREBUCHET_FIRE_INTERVAL_FRAMES - TREBUCHET_WINDUP_FRAMES;
    if (!due || state.returnLeft > 0 || !this.hasAmmo(record)) return;
    if (this.chooseTarget(record) === null) return;
    state.windupLeft = TREBUCHET_WINDUP_FRAMES;
  }

  private hasAmmo(record: TrebuchetStructureRecord): boolean {
    return record.ammo > 0 || this.hasUnlimitedAmmo(record);
  }

  /** The boulder leaves the sling: aim, pay, and roll for the arm. */
  private release(record: TrebuchetStructureRecord, key: string, state: EngineState): void {
    // Re-checked on the release frame: the target may have died or walked off
    // during the wind-up, and a boulder already paid for must go somewhere true.
    const target = this.hasAmmo(record) ? this.chooseTarget(record) : null;
    if (target === null) {
      state.returnLeft = ARM_RETURN_FRAMES;
      return;
    }
    const footprint = trebuchetFootprint(record.x, record.y);
    const releaseTiles = trebuchetReleasePoint(TREBUCHET_LOOSED_ANGLE, 1);
    const fromX = (footprint.x + releaseTiles.x) * TILE_SIZE;
    const fromY = (footprint.y + releaseTiles.groundY) * TILE_SIZE;
    const aim = this.aimAt(target, footprint, fromX, fromY);
    const distanceTiles = Math.hypot(aim.x - fromX, aim.y - fromY) / TILE_SIZE;
    const flightFrames = flightFramesFor(distanceTiles);
    const builderLevel = this.deps.constructionLevel(record.builtBy);
    const infernal = infernalTrebuchets(builderLevel);
    this.boulders.push({
      fromX,
      fromY,
      releaseHeightPx: releaseTiles.height * TILE_SIZE,
      toX: aim.x,
      toY: aim.y,
      flightFrames,
      builtBy: record.builtBy,
      level: this.deps.siegeLevel(),
      infernal,
      spinSeed: this.frame,
      age: 0,
    });
    this.shotLog.push({ key, target, toX: aim.x, toY: aim.y, flightFrames });
    if (this.shotLog.length > TrebuchetSystem.SHOT_LOG_LIMIT) this.shotLog.shift();
    if (!unlimitedAmmo(builderLevel)) record.ammo = Math.max(0, record.ammo - 1);
    state.sinceRelease = 0;
    state.returnLeft = ARM_RETURN_FRAMES;
    this.deps.audio?.playRandom(TREBUCHET_FIRE_SOUNDS);
    if (infernal) this.deps.audio?.playRandom(VILLAGE_CUES.infernalBoulderWhoosh);
    const random = this.deps.random ?? Math.random;
    if (random() < TREBUCHET_BREAK_CHANCE && this.deps.defense.breakTrebuchet(key)) {
      this.callouts.add(
        'Broken!',
        (footprint.x + footprint.w / 2) * TILE_SIZE,
        footprint.y * TILE_SIZE,
      );
    }
  }

  // ── Targeting ───────────────────────────────────────────────────────────

  /**
   * Samples the hostiles round every trebuchet that is about to throw, so a
   * target's velocity is known when it is aimed at. Only those close to
   * firing: a trebuchet that will not throw for two seconds has no use for
   * where anything was a moment ago.
   */
  private trackHostiles(): void {
    const soonest =
      TREBUCHET_FIRE_INTERVAL_FRAMES - TREBUCHET_WINDUP_FRAMES - VELOCITY_WINDOW_FRAMES - 1;
    for (const record of this.deps.defense.trebuchets) {
      if (record.broken) continue;
      const state = this.engine(structureKey(record.x, record.y));
      // Counted as of this frame's tick, which the engine update below applies.
      const aboutToThrow = state.windupLeft > 0 || state.sinceRelease + 1 >= soonest;
      if (!aboutToThrow) continue;
      for (const mob of this.hostilesNear(record)) this.sample(mob);
    }
  }

  private sample(mob: Mob): void {
    let track = this.tracks.get(mob);
    if (track?.lastFrame === this.frame) return;
    // A gap in the samples means the mob was out of reach; its old positions
    // would read as a leap.
    if (track?.lastFrame !== this.frame - 1) {
      track = { xs: [], ys: [], lastFrame: this.frame };
      this.tracks.set(mob, track);
    }
    const centre = centreOf(mob);
    track.xs.push(centre.x);
    track.ys.push(centre.y);
    if (track.xs.length > VELOCITY_WINDOW_FRAMES + 1) {
      track.xs.shift();
      track.ys.shift();
    }
    track.lastFrame = this.frame;
  }

  /** Every hostile a trebuchet could consider, before the range and priority rules. */
  private hostilesNear(record: TrebuchetStructureRecord): Mob[] {
    const footprint = trebuchetFootprint(record.x, record.y);
    const centreX = (footprint.x + footprint.w / 2) * TILE_SIZE;
    const centreY = (footprint.y + footprint.h / 2) * TILE_SIZE;
    const reach =
      (TREBUCHET_RANGE_TILES +
        Math.hypot(footprint.w, footprint.h) / 2 +
        HOSTILE_SEARCH_SLACK_TILES) *
      TILE_SIZE;
    const found: Mob[] = [];
    // The grid holds top-left corners; searching from half a tile up and left
    // of the centre finds every body whose centre is within reach.
    for (const mob of this.deps.roster.grid.queryCircle(
      centreX - HALF_TILE,
      centreY - HALF_TILE,
      reach,
    )) {
      if (this.isFairGame(mob)) found.push(mob);
    }
    return found;
  }

  /** A hostile the party's engines may shoot at. Filtered explicitly: the roster holds allies too. */
  private isFairGame(mob: Mob): boolean {
    return (
      mob.isAlive && mob.isHostile && mob.isDefendTarget !== true && !this.deps.isInSafeRoom(mob)
    );
  }

  /**
   * The hostile a trebuchet should throw at now, or null. Ranked by the first
   * rule that tells two apart: striking the defences or pressed against the
   * palisade from outside; then inside the palisade; then nearest the bell
   * while it is under assault, otherwise nearest the trebuchet — with a boss
   * counted a little further off than it stands.
   */
  chooseTarget(record: TrebuchetStructureRecord): Mob | null {
    const footprint = trebuchetFootprint(record.x, record.y);
    const underAssault = this.deps.questPhase() === 'assault';
    let best: Mob | null = null;
    let bestTier = Infinity;
    let bestDistance = Infinity;
    for (const mob of this.hostilesNear(record)) {
      const centre = centreOf(mob);
      if (!isInFiringBand(centre.x, centre.y, footprint)) continue;
      const tier = this.threatTier(mob, centre);
      const measuredFrom = underAssault
        ? Math.hypot(centre.x - this.bellCentre.x, centre.y - this.bellCentre.y)
        : distanceToFootprintPx(centre.x, centre.y, footprint);
      const distance = measuredFrom + (mob.isBoss ? BOSS_RANK_PENALTY_TILES * TILE_SIZE : 0);
      if (tier < bestTier || (tier === bestTier && distance < bestDistance)) {
        best = mob;
        bestTier = tier;
        bestDistance = distance;
      }
    }
    return best;
  }

  private threatTier(mob: Mob, centre: { x: number; y: number }): number {
    const inside = this.isInsidePalisade(centre.x, centre.y);
    const striking = this.isAttackingStructure(mob, centre);
    if (striking || (!inside && this.isPressingPalisade(centre.x, centre.y))) return 0;
    if (inside) return 1;
    return 2;
  }

  /**
   * Whether a hostile is attacking one of the village's structures: in the
   * middle of a blow on one, or enlisted in the siege with a structure it is
   * set on still standing within reach. The reach test is what keeps a siege
   * target left over from an earlier wall from counting once the mob has
   * turned to chase a defender instead.
   */
  private isAttackingStructure(mob: Mob, centre: { x: number; y: number }): boolean {
    if (mob.isStrikingStructure) return true;
    const target = mob.siegeCapable?.siegeTarget ?? null;
    if (target === null || !this.deps.defense.exists(target)) return false;
    const reachPx = STRIKING_REACH_TILES * TILE_SIZE;
    return this.deps.defense
      .footprintOf(target)
      .some(
        (tile) =>
          distanceToFootprintPx(centre.x, centre.y, { x: tile.x, y: tile.y, w: 1, h: 1 }) <=
          reachPx,
      );
  }

  private isInsidePalisade(px: number, py: number): boolean {
    const interior = this.deps.site.interior;
    const tileX = Math.floor(px / TILE_SIZE);
    const tileY = Math.floor(py / TILE_SIZE);
    return (
      tileX >= interior.x &&
      tileY >= interior.y &&
      tileX < interior.x + interior.w &&
      tileY < interior.y + interior.h
    );
  }

  private isPressingPalisade(px: number, py: number): boolean {
    const reach = PALISADE_THREAT_TILES * TILE_SIZE;
    return this.palisadeCentres.some((tile) => Math.hypot(tile.x - px, tile.y - py) <= reach);
  }

  /** The target's centre `frames` updates from now, held to a short lead. */
  private predictedCentre(mob: Mob, frames: number): { x: number; y: number } {
    const centre = centreOf(mob);
    const track = this.tracks.get(mob);
    if (track === undefined || track.xs.length < VELOCITY_WINDOW_FRAMES + 1) return centre;
    const vx = (track.xs[track.xs.length - 1] - track.xs[0]) / VELOCITY_WINDOW_FRAMES;
    const vy = (track.ys[track.ys.length - 1] - track.ys[0]) / VELOCITY_WINDOW_FRAMES;
    let leadX = vx * frames * LEAD_FRACTION;
    let leadY = vy * frames * LEAD_FRACTION;
    const lead = Math.hypot(leadX, leadY);
    const maxLead = MAX_LEAD_TILES * TILE_SIZE;
    if (lead > maxLead) {
      leadX *= maxLead / lead;
      leadY *= maxLead / lead;
    }
    return { x: centre.x + leadX, y: centre.y + leadY };
  }

  /**
   * Where to land the boulder to meet the target: its centre led by its
   * velocity over the flight — the flight worked out once from where it
   * stands, then again from where it will be. A lead that would fall inside
   * the minimum gap, or past the range, aims at where it stands instead.
   */
  private aimAt(
    target: Mob,
    footprint: TileFootprint,
    fromX: number,
    fromY: number,
  ): { x: number; y: number } {
    const now = centreOf(target);
    const firstFlight = flightFramesFor(Math.hypot(now.x - fromX, now.y - fromY) / TILE_SIZE);
    const firstGuess = this.predictedCentre(target, firstFlight);
    const flight = flightFramesFor(
      Math.hypot(firstGuess.x - fromX, firstGuess.y - fromY) / TILE_SIZE,
    );
    const led = this.predictedCentre(target, flight);
    return isInFiringBand(led.x, led.y, footprint) ? led : now;
  }

  // ── Boulders ────────────────────────────────────────────────────────────

  private advanceBoulders(): void {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const boulder = this.boulders[i];
      boulder.age++;
      if (boulder.infernal) this.trailEmbers(boulder);
      if (boulder.age < boulder.flightFrames) continue;
      this.boulders.splice(i, 1);
      this.impact(boulder);
    }
  }

  /** Where a boulder is now: its point on the ground and its height above it. */
  private static viewOf(boulder: Boulder): BoulderView {
    const t = Math.min(1, boulder.age / boulder.flightFrames);
    const arc = TILE_SIZE * ARC_HEIGHT_TILES * PARABOLA_PEAK_NORMALISER * t * (1 - t);
    return {
      groundX: boulder.fromX + (boulder.toX - boulder.fromX) * t,
      groundY: boulder.fromY + (boulder.toY - boulder.fromY) * t,
      heightPx: boulder.releaseHeightPx * (1 - t) + arc,
      toX: boulder.toX,
      toY: boulder.toY,
      progress: t,
    };
  }

  /** Every boulder in the air. */
  get boulderViews(): BoulderView[] {
    return this.boulders.map((boulder) => TrebuchetSystem.viewOf(boulder));
  }

  /**
   * Everything a boulder does, decided where it lands. The direct hit, the
   * shatter and the shrapnel are all measured from the landing point, never
   * from where the throw was aimed at when it left.
   */
  private impact(boulder: Boulder): void {
    const { toX, toY } = boulder;
    const builder = this.crawler(boulder.builtBy);
    const shatterPx = SHATTER_RADIUS_TILES * TILE_SIZE;
    const nearby = this.deps.roster.grid.queryCircle(
      toX - HALF_TILE,
      toY - HALF_TILE,
      shatterPx + TILE_SIZE,
    );
    const hostiles: Array<{ mob: Mob; distance: number }> = [];
    const friends: Mob[] = [];
    for (const mob of nearby) {
      if (!mob.isAlive) continue;
      const centre = centreOf(mob);
      const distance = Math.hypot(centre.x - toX, centre.y - toY);
      if (distance > shatterPx) continue;
      if (mob.isHostile) {
        if (mob.isDefendTarget !== true && !this.deps.isInSafeRoom(mob)) {
          hostiles.push({ mob, distance });
        }
      } else if (!this.deps.isInSafeRoom(mob)) {
        friends.push(mob);
      }
    }
    let direct: Mob | null = null;
    let directDistance = DIRECT_HIT_RADIUS_TILES * TILE_SIZE;
    for (const { mob, distance } of hostiles) {
      if (distance <= directDistance) {
        direct = mob;
        directDistance = distance;
      }
    }
    const directDamage = trebuchetDirectDamage(boulder.level);
    const splashDamage = trebuchetSplashDamage(boulder.level);
    for (const { mob } of hostiles) {
      const base = mob === direct ? directDamage : splashDamage;
      const damage = Math.max(1, Math.round(base * mob.blastDamageScale));
      // Credited to the builder so the kill, its XP and its loot follow them.
      // No weapon type: the builder swung nothing, so the kill trains no
      // weapon skill — and, unlike `explosion`, no type still passes the
      // friendly-fire gate, so a boulder can never reach an ally that way.
      mob.takeCreditedDamage(damage, builder, null, null);
      if (boulder.infernal && mob.isAlive) mob.applyStatus(makeBurn(builder));
      if (mob.isAlive) this.shove(mob, toX, toY, TREBUCHET_KNOCKBACK_TILES);
    }
    for (const crawler of [this.deps.human, this.deps.cat]) {
      if (!crawler.isAlive || this.deps.isInSafeRoom(crawler)) continue;
      const centre = centreOf(crawler);
      if (Math.hypot(centre.x - toX, centre.y - toY) > shatterPx) continue;
      const struck = crawler.takeDamage(TREBUCHET_FRIENDLY_FIRE_DAMAGE, CRAWLER_SHRAPNEL);
      if (struck) this.shove(crawler, toX, toY, TREBUCHET_FRIENDLY_KNOCKBACK_TILES);
    }
    for (const friend of friends) {
      const struck = friend.takeDamage(TREBUCHET_FRIENDLY_FIRE_DAMAGE, MOB_SHRAPNEL);
      if (struck && friend.isAlive) {
        this.shove(friend, toX, toY, TREBUCHET_FRIENDLY_KNOCKBACK_TILES);
      }
    }
    this.deps.bus.emit('blastLanded', { x: toX, y: toY, radiusPx: shatterPx });
    this.deps.audio?.playRandom(BOULDER_IMPACT_SOUNDS);
    this.addBurst(toX, toY, boulder.infernal);
    if (boulder.infernal) this.addCloud(toX, toY, boulder.builtBy);
    const active = centreOf(this.deps.active());
    if (Math.hypot(active.x - toX, active.y - toY) <= SHAKE_RADIUS_TILES * TILE_SIZE) {
      this.shakeFramesLeft = SHAKE_FRAMES;
    }
  }

  /**
   * Pushes a body radially away from the impact. A mob's own wall test is
   * hostile-aware, so a hostile thrown at the gate stops against it.
   */
  private shove(body: Player, fromX: number, fromY: number, tiles: number): void {
    const centre = centreOf(body);
    const dx = centre.x - fromX;
    const dy = centre.y - fromY;
    // A body dead on the landing point has no "away"; it is thrown the way it faces from.
    const awayX = dx === 0 && dy === 0 ? -body.facingX : dx;
    const awayY = dx === 0 && dy === 0 ? -body.facingY : dy;
    if (awayX === 0 && awayY === 0) return;
    body.applyKnockback(awayX, awayY, tiles * TILE_SIZE, KNOCKBACK_FRAMES);
  }

  // ── Miasma ──────────────────────────────────────────────────────────────

  private addCloud(x: number, y: number, builtBy: CrawlerKind): void {
    if (this.clouds.length >= MAX_MIASMA_CLOUDS) this.clouds.shift();
    this.deps.audio?.playRandom(VILLAGE_CUES.miasmaHiss);
    this.clouds.push({ x, y, builtBy, seed: this.frame, age: 0 });
  }

  private advanceClouds(): void {
    const radiusPx = MIASMA_RADIUS_TILES * TILE_SIZE;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i];
      cloud.age++;
      if (cloud.age > MIASMA_FRAMES) {
        this.clouds.splice(i, 1);
        continue;
      }
      const ticks = cloud.age % MIASMA_TICK_FRAMES === 0;
      const builder = this.crawler(cloud.builtBy);
      for (const mob of this.deps.roster.grid.queryCircle(
        cloud.x - HALF_TILE,
        cloud.y - HALF_TILE,
        radiusPx + TILE_SIZE,
      )) {
        if (!this.isFairGame(mob)) continue;
        const centre = centreOf(mob);
        if (Math.hypot(centre.x - cloud.x, centre.y - cloud.y) > radiusPx) continue;
        mob.applyHazardSlow(MIASMA_SLOW_FRAMES);
        // A tick of a cloud the builder laid: credited, but no weapon swung.
        if (ticks) mob.takeCreditedDamage(MIASMA_DAMAGE, builder, null, null);
      }
    }
  }

  /** Clouds on the ground, for gates. */
  get miasmaClouds(): ReadonlyArray<{ readonly x: number; readonly y: number }> {
    return this.clouds;
  }

  // ── Effects ─────────────────────────────────────────────────────────────

  private addBurst(x: number, y: number, infernal: boolean): void {
    this.bursts.push({ x, y, infernal, seed: this.frame, age: 0 });
  }

  private trailEmbers(boulder: Boulder): void {
    const view = TrebuchetSystem.viewOf(boulder);
    const { vx, vy } = emberDrift(boulder.age);
    this.embers.push({ x: view.groundX, y: view.groundY - view.heightPx, vx, vy, age: 0 });
  }

  private advanceEffects(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age++;
      if (this.bursts[i].age > BURST_FRAMES) this.bursts.splice(i, 1);
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const ember = this.embers[i];
      ember.age++;
      ember.x += ember.vx;
      ember.y += ember.vy;
      if (ember.age > EMBER_FRAMES) this.embers.splice(i, 1);
    }
  }

  /** The screen shake an impact near the active crawler raises, for the camera. */
  get cameraOffset(): { x: number; y: number } {
    if (this.shakeFramesLeft <= 0) return { x: 0, y: 0 };
    const strength = (this.shakeFramesLeft / SHAKE_FRAMES) * SHAKE_PEAK_PX;
    return {
      x: Math.sin(this.frame * SHAKE_WOBBLE_X) * strength,
      y: Math.cos(this.frame * SHAKE_WOBBLE_Y) * strength,
    };
  }

  // ── The arm ─────────────────────────────────────────────────────────────

  /**
   * The arm's angle and sling phase for a trebuchet this frame: swinging
   * over through the wind-up, released at the top, then settling back.
   */
  armPose(key: string): { armAngle: number; slingPhase: number } {
    const state = this.engines.get(key);
    if (state === undefined) return { armAngle: TREBUCHET_COCKED_ANGLE, slingPhase: 0 };
    if (state.windupLeft > 0) {
      const t = 1 - state.windupLeft / TREBUCHET_WINDUP_FRAMES;
      // The counterweight drops slowly and then all at once.
      const swing = t * t;
      return {
        armAngle:
          TREBUCHET_COCKED_ANGLE + (TREBUCHET_LOOSED_ANGLE - TREBUCHET_COCKED_ANGLE) * swing,
        slingPhase: swing,
      };
    }
    if (state.returnLeft > 0) {
      const t = 1 - state.returnLeft / ARM_RETURN_FRAMES;
      const settle = easeInOut(t);
      return {
        armAngle:
          TREBUCHET_LOOSED_ANGLE + (TREBUCHET_COCKED_ANGLE - TREBUCHET_LOOSED_ANGLE) * settle,
        slingPhase: 0,
      };
    }
    return { armAngle: TREBUCHET_COCKED_ANGLE, slingPhase: 0 };
  }

  /** Whether a trebuchet is mid wind-up, for gates. */
  isWindingUp(key: string): boolean {
    return (this.engines.get(key)?.windupLeft ?? 0) > 0;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** Under every body: the miasma, each boulder's shadow and the ring where it will land. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const miasmaRadius = MIASMA_RADIUS_TILES * TILE_SIZE;
    for (const cloud of this.clouds) {
      const rise = Math.min(1, cloud.age / MIASMA_RISE_FRAMES);
      const fade = Math.min(1, (MIASMA_FRAMES - cloud.age) / MIASMA_FADE_FRAMES);
      const strength = Math.max(0, Math.min(rise, fade));
      drawMiasma(
        ctx,
        cloud.x - camX,
        cloud.y - camY,
        miasmaRadius,
        strength,
        this.timeSeconds,
        cloud.seed,
      );
    }
    const shatterRadius = SHATTER_RADIUS_TILES * TILE_SIZE;
    for (const boulder of this.boulders) {
      const view = TrebuchetSystem.viewOf(boulder);
      drawLandingRing(
        ctx,
        view.toX - camX,
        view.toY - camY,
        shatterRadius,
        view.progress,
        boulder.infernal,
      );
      drawBoulderShadow(ctx, view.groundX - camX, view.groundY - camY, view.heightPx, TILE_SIZE);
    }
  }

  /** Over every body: boulders in the air, the burst where they land, the ammo pills and the callouts. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const ember of this.embers) {
      drawEmber(ctx, ember.x - camX, ember.y - camY, ember.age / EMBER_FRAMES);
    }
    for (const boulder of this.boulders) {
      const view = TrebuchetSystem.viewOf(boulder);
      drawBoulder(
        ctx,
        view.groundX - camX,
        view.groundY - view.heightPx - camY,
        TILE_SIZE,
        boulder.age * BOULDER_SPIN_PER_FRAME + boulder.spinSeed,
        boulder.infernal,
      );
    }
    const shatterRadius = SHATTER_RADIUS_TILES * TILE_SIZE;
    for (const burst of this.bursts) {
      drawBurst(
        ctx,
        burst.x - camX,
        burst.y - camY,
        shatterRadius,
        burst.age,
        burst.seed,
        burst.infernal,
        TILE_SIZE,
      );
    }
    this.renderAmmoPills(ctx, camX, camY);
    this.callouts.render(ctx, camX, camY);
  }

  private renderAmmoPills(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const crawlers = [this.deps.human, this.deps.cat];
    const pills: AmmoPillState[] = [];
    for (const record of this.deps.defense.trebuchets) {
      const footprint = trebuchetFootprint(record.x, record.y);
      const seen = crawlers.some((crawler) => {
        const centre = centreOf(crawler);
        return (
          distanceToFootprintPx(centre.x, centre.y, footprint) <=
          AMMO_PILL_VISIBLE_TILES * TILE_SIZE
        );
      });
      if (!seen) continue;
      const key = structureKey(record.x, record.y);
      const maxHp = this.deps.defense.maxHp({ kind: 'trebuchet', key });
      pills.push({
        x: (footprint.x + footprint.w / 2) * TILE_SIZE - camX,
        y: (footprint.y - AMMO_PILL_LIFT_TILES) * TILE_SIZE - camY,
        ammo: record.ammo,
        unlimited: this.hasUnlimitedAmmo(record),
        broken: record.broken,
        hpFraction: maxHp > 0 ? record.hp / maxHp : 1,
        timeSeconds: this.timeSeconds,
      });
    }
    for (const pill of stackAmmoPills(pills)) drawAmmoPill(ctx, pill);
  }

  /** A door visit or a rewind: nothing in the air survives it. */
  reset(): void {
    this.engines.clear();
    this.boulders.length = 0;
    this.clouds.length = 0;
    this.bursts.length = 0;
    this.embers.length = 0;
    this.shakeFramesLeft = 0;
  }
}

// ── The ammo pill ───────────────────────────────────────────────────────────

/** The pill floats this far above the trebuchet's footprint, clear of its cocked arm. */
const AMMO_PILL_LIFT_TILES = 1.55;
const PILL_W = 84;
const PILL_H = 22;
const PILL_ICON = 16;
/** The icon sits on a pale disc, so a grey stone and a white spanner both read on navy and on red. */
const PILL_ICON_DISC = 'rgba(226,232,240,0.9)';
const PILL_ICON_DISC_PAD = 1;
/** The infinity sign is a small glyph at label size; this size reads as clearly as the digits. */
const PILL_INFINITY_SIZE = 16;
const PILL_PAD = 4;
const PILL_HP_H = 3;
const PILL_HP_GAP = 2;
const PILL_PULSE_HZ = 2;
/** An empty pill pulses between this opacity and full. */
const PILL_PULSE_MIN_ALPHA = 0.6;

/** A stacked pill moves up by its own height, its health bar and this gap. */
const PILL_STACK_GAP = 2;
const PILL_STACK_STEP = PILL_H + PILL_HP_GAP + PILL_HP_H + PILL_STACK_GAP;

/**
 * The pills lifted clear of one another. A pill is wider than a trebuchet
 * and trebuchets may stand side by side, so two neighbours' pills would
 * overprint; working west to east, each pill that would overlap one already
 * placed is raised a step until it does not, which staggers a row of them.
 */
export function stackAmmoPills(pills: readonly AmmoPillState[]): AmmoPillState[] {
  const placed: AmmoPillState[] = [];
  const overlaps = (a: AmmoPillState, b: AmmoPillState): boolean =>
    Math.abs(a.x - b.x) < PILL_W && Math.abs(a.y - b.y) < PILL_STACK_STEP;
  for (const pill of [...pills].sort((a, b) => a.x - b.x)) {
    let lifted = pill;
    while (placed.some((other) => overlaps(lifted, other))) {
      lifted = { ...lifted, y: lifted.y - PILL_STACK_STEP };
    }
    placed.push(lifted);
  }
  return placed;
}

export interface AmmoPillState {
  readonly x: number;
  readonly y: number;
  readonly ammo: number;
  readonly unlimited: boolean;
  readonly broken: boolean;
  readonly hpFraction: number;
  readonly timeSeconds: number;
}

/**
 * The pill over a trebuchet: a stone and `ammo/25`, `∞` when it never runs
 * dry, pulsing red when empty, a wrench and "Broken" when it needs repair,
 * and a health bar under it only once it has been hurt.
 */
export function drawAmmoPill(ctx: CanvasRenderingContext2D, state: AmmoPillState): void {
  const empty = !state.unlimited && state.ammo <= 0;
  const pulse = (Math.sin(state.timeSeconds * FULL_TURN * PILL_PULSE_HZ) + 1) / 2;
  const alarmed = state.broken || empty;
  const box = drawBox(ctx, {
    x: state.x,
    y: state.y,
    width: PILL_W,
    height: PILL_H,
    alignX: 'center',
    alignY: 'bottom',
    radius: PILL_H / 2,
    ...(alarmed ? BOX_PRESETS.danger : BOX_PRESETS.panel),
    alpha: empty && !state.broken ? PILL_PULSE_MIN_ALPHA + (1 - PILL_PULSE_MIN_ALPHA) * pulse : 1,
  });
  const iconX = box.x + PILL_PAD;
  const iconY = box.y + (PILL_H - PILL_ICON) / 2;
  ctx.save();
  ctx.fillStyle = PILL_ICON_DISC;
  ctx.beginPath();
  ctx.arc(
    iconX + PILL_ICON / 2,
    iconY + PILL_ICON / 2,
    PILL_ICON / 2 + PILL_ICON_DISC_PAD,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.restore();
  if (state.broken) {
    drawWrench(ctx, iconX, iconY, PILL_ICON);
  } else {
    drawResourceIcon(ctx, 'stone', iconX, iconY, PILL_ICON);
  }
  const label = state.broken
    ? 'Broken'
    : state.unlimited
      ? '∞'
      : `${state.ammo}/${TREBUCHET_MAX_AMMO}`;
  // Pale text on either box: the red box itself is the alarm, and red on red would not read.
  const size = state.unlimited && !state.broken ? PILL_INFINITY_SIZE : TEXT_PRESETS.label.size;
  drawText(ctx, label, {
    x: box.x + PILL_PAD + PILL_ICON + (PILL_W - PILL_ICON - PILL_PAD) / 2,
    y: box.y + (PILL_H - size) / 2,
    align: 'center',
    ...TEXT_PRESETS.label,
    bold: alarmed,
    size,
  });
  if (state.hpFraction < 1) {
    drawProgressBar(ctx, {
      x: box.x + PILL_PAD,
      y: box.y + PILL_H + PILL_HP_GAP,
      width: PILL_W - PILL_PAD * 2,
      height: PILL_HP_H,
      value: state.hpFraction,
      ...PROGRESS_PRESETS.hp,
    });
  }
}
