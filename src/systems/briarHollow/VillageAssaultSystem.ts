/**
 * VillageAssaultSystem — the siege of Briar Hollow, from the warning bell to
 * the last of the dead: the ninety-second countdown, the three waves up the
 * east and south lanes, Vordrick Boneharrow with the third, and how it ends.
 *
 * - **Won** when the necromancer dies. Every undead still standing crumbles,
 *   released rather than killed, so the crumbling pays nothing.
 * - **Lost** when the Hollow Bell is beaten to nothing, or when the active
 *   crawler stays away from the village too long. The dead walk back up their
 *   lanes and are released out of sight; the walls stay as broken as they
 *   are, for the party to rebuild and try again.
 *
 * Either way the villagers mend their bell. There is no death and no reset in
 * a lost siege: it is a setback, not a game over.
 *
 * Nothing here is durable. The phase, the countdown and the bell live in the
 * quest state, and a save or a checkpoint never records a siege in progress
 * (`captureBriarHollowState`), so a rewind or a reload lands before it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { AudioManager } from '../../audio/AudioManager';
import { VILLAGE_CUES, VILLAGE_SIEGE_MUSIC, type VillageCue } from '../../audio/villageSoundCues';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import {
  DIFFICULTY_PROFILES,
  type Difficulty,
  type DifficultyProfile,
  applySpawnDifficulty,
} from '../../core/difficultyProfiles';
import type { GameMap } from '../../map/GameMap';
import type { AssaultLane, BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { RaisedRatkin } from '../../creatures/RaisedRatkin';
import { RisingSkeleton } from '../../creatures/RisingSkeleton';
import { RuinsGhoul } from '../../creatures/RuinsGhoul';
import { SkeletonWarrior } from '../../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../../creatures/SkeletonArcher';
import { GraveBull } from '../../creatures/GraveBull';
import { Necromancer } from '../../creatures/Necromancer';
import {
  enlistInSiege,
  isInsidePalisade,
  siegeAdvance,
  siegeCanEngage,
  tileUnder,
} from '../../creatures/siege/siegeCapability';
import { livingAssaultSpawns } from '../../creatures/siege/assaultCaps';
import { INSIDE_PALISADE, palisadeDistanceFor } from '../../creatures/siege/palisadeDistance';
import type { SiegeDirective, SiegeWorld } from '../../creatures/siege/siegeTypes';
import { engageTrebuchet, nearestLiveTrebuchetTo } from '../../creatures/siege/trebuchetThreat';
import { AssaultWavePrewarm, type AssaultWave } from '../../sprites/assaultPrewarm';
import { drawCrumble } from '../../sprites/art/siegeEffectsArt';
import { BOX_PRESETS, PROGRESS_PRESETS, drawBox, drawProgressBar } from '../../ui/Box';
import { TEXT_PRESETS, drawText } from '../../ui/TextBox';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import { isWorldPointInView, visibleWorldView } from '../../core/visibleWorldView';
import type { MobRoster } from '../kits/SceneWorld';
import type { OverworldMusicSystem } from '../OverworldMusicSystem';

/** What the siege needs of the zone music: to take the track over, and to hand it back. */
export type SiegeMusicClaim = Pick<OverworldMusicSystem, 'battleMusicActive' | 'reset'>;
import type { DefenseStructures } from './DefenseStructures';
import type { VillageAmbience } from './VillageAmbience';
import { SiegeFlowField } from './SiegeFlowField';
import {
  SIEGE_HUD_PANEL_PAD,
  SIEGE_HUD_PANEL_WIDTH,
  SIEGE_HUD_ROW_HEIGHT,
  type SiegeHudSlot,
  siegeHudPanelHeight,
} from './siegeHudLayout';
import { HOLLOW_BELL_MAX_HP } from './hollowBell';
import { UPDATES_PER_SECOND } from './structureRules';

// ── The siege's pacing ──────────────────────────────────────────────────────

/** The warning the village gets once the party says it is ready. */
export const IMMINENT_SECONDS = 90;
export const IMMINENT_FRAMES = IMMINENT_SECONDS * UPDATES_PER_SECOND;
/** Three waves; the necromancer comes with the last. */
export const ASSAULT_WAVE_COUNT = 3;
/**
 * A wave's spawns trickle in over its first this-many seconds, not all at
 * once. Slow enough that a floor-level party meets them a few at a time: the
 * siege simulation (`verify:village-assault`) loses the party, then the bell,
 * when a wave lands inside a quarter of a minute. It is also most of the
 * siege's fighting time, which the simulation holds to two minutes or more.
 */
export const WAVE_TRICKLE_SECONDS = 60;
const WAVE_TRICKLE_FRAMES = WAVE_TRICKLE_SECONDS * UPDATES_PER_SECOND;
/** The next wave comes after this long, whatever is left of the current one. */
export const WAVE_MAX_SECONDS = 120;
const WAVE_MAX_FRAMES = WAVE_MAX_SECONDS * UPDATES_PER_SECOND;
/** Or sooner, once no more than this share of the wave's bodies still stands. */
export const WAVE_ADVANCE_REMAINING_SHARE = 0.2;
/**
 * The breather between waves, under a banner counting down to the one
 * coming: time to mend the bell, reload the engines and drink before the
 * next. The simulation wins as often with thirty seconds, but its won sieges
 * then land on the four-minute floor of their band; this keeps them inside
 * it, and a won siege is still two-thirds fighting.
 */
export const WAVE_LULL_SECONDS = 45;
const WAVE_LULL_FRAMES = WAVE_LULL_SECONDS * UPDATES_PER_SECOND;
/**
 * The most of the waves' own undead alive at once. A real cap on the living,
 * checked before every spawn: anything over it waits its turn in the queue.
 * The necromancer's raises are held to his own cap instead (`assaultCaps.ts`).
 */
export const ASSAULT_LIVE_CAP = 22;
/** How far the active crawler may stray from the palisade before the siege counts them as gone. */
export const ASSAULT_ABANDON_TILES = 45;
/** How long they may stay gone before the siege is lost. */
export const ASSAULT_ABANDON_SECONDS = 10;
const ASSAULT_ABANDON_FRAMES = ASSAULT_ABANDON_SECONDS * UPDATES_PER_SECOND;

// ── Tuning ──────────────────────────────────────────────────────────────────

/** The remaining undead crumble over this long after a victory, not all on one frame. */
const CRUMBLE_STAGGER_SECONDS = 3;
const CRUMBLE_STAGGER_FRAMES = CRUMBLE_STAGGER_SECONDS * UPDATES_PER_SECOND;
/** How long a crumble's dust hangs in the air. */
const CRUMBLE_EFFECT_FRAMES = 40;
/** A withdrawing undead is released once it is this far out from the palisade. */
export const WITHDRAW_RELEASE_TILES = 20;
/** Or after this long, wherever it has got to — a withdrawal must end. */
const WITHDRAW_TIMEOUT_SECONDS = 30;
const WITHDRAW_TIMEOUT_FRAMES = WITHDRAW_TIMEOUT_SECONDS * UPDATES_PER_SECOND;
/** How far a withdrawal's path search may reach: across the village and back out a lane. */
const WITHDRAW_PATH_SEARCH_TILES = 140;
/** Withdrawal paths planned per update, so a whole wave turning round costs no single frame. */
const WITHDRAW_PATHS_PER_UPDATE = 4;
/** A waypoint counts as reached within this share of a tile. */
const WAYPOINT_REACHED_TILES = 0.35;
/** The bell swings after every blow for this long. */
const BELL_HIT_RING_SECONDS = 1.5;
const BELL_HIT_RING_FRAMES = BELL_HIT_RING_SECONDS * UPDATES_PER_SECOND;
/** The bell's toll on a blow sounds no more often than this. */
const BELL_TOLL_GAP_FRAMES = 30;
/** The HUD's bell bar flashes this long when the bell is struck. */
const BELL_FLASH_FRAMES = 18;
/** A cracked bell hangs dead this long before the villagers have it mended and hung again. */
const BELL_CRACK_SHOWN_SECONDS = 6;
const BELL_CRACK_SHOWN_FRAMES = BELL_CRACK_SHOWN_SECONDS * UPDATES_PER_SECOND;
/** How long the "bell has fallen" banner stays up. */
const OUTCOME_BANNER_SECONDS = 6;
const OUTCOME_BANNER_FRAMES = OUTCOME_BANNER_SECONDS * UPDATES_PER_SECOND;
/** How far round a lane's spawn tile a body may appear. */
const SPAWN_SCATTER_TILES = 3;
/** How far a crowded spawn may be nudged to open ground. */
const SPAWN_SEARCH_TILES = 5;
/**
 * With no camera published (a headless run), a spawn counts as out of sight
 * past this many tiles from both crawlers — about half a desktop screen's
 * width, where the camera would show it.
 */
const SPAWN_UNSEEN_TILES = 20;
/** A spawn must be this far past the camera's edge, so no part of the body shows as it appears. */
const SPAWN_OFFSCREEN_MARGIN_TILES = 2;
/**
 * No spawn ever appears this close to a crawler, whatever the camera shows —
 * a crawler standing at a lane's head sends its dead up the other lane, or
 * holds them back until they can come.
 */
export const SPAWN_MIN_CRAWLER_TILES = 8;
/**
 * How long a spawn waits for somewhere off screen before it settles for the
 * furthest spot in view that still keeps clear of both crawlers.
 */
const SPAWN_DEFER_SECONDS = 3;
const SPAWN_DEFER_FRAMES = SPAWN_DEFER_SECONDS * UPDATES_PER_SECOND;
/** From a tile's corner to its centre, in tiles. */
const TILE_CENTRE_OFFSET = 0.5;
/** Candidate tiles tried for a spawn out of sight before settling for the furthest. */
const SPAWN_ATTEMPTS = 6;
/** Tiles of scatter each side of the lane's own spawn tile. */
const SPAWN_JITTER_SPAN = SPAWN_SCATTER_TILES * 2 + 1;
/**
 * An enlisted mob takes a defender as its fight, instead of marching, when one
 * this close is on its own side of the wall.
 */
export const SIEGE_DEFENDER_NOTICE_TILES = 6;
/** Archers never march into the wall: they hold this far out and shoot over it. */
export const ARCHER_HOLD_TILES = 7;
/** An archer holding off the wall looses at defenders this close; the palisade does not block its sight. */
const ARCHER_SHOOT_TILES = 9;
/** Seconds per minute, for the countdown's m:ss. */
const SECONDS_PER_MINUTE = 60;
const TWO_DIGITS = 2;
/** The spread seeds handed to each spawn are drawn from this many values. */
const SPREAD_SEED_RANGE = 0x7fffffff;

/** The waves' bodies scale with the difficulty: fewer on easy, more on hard. */
const ASSAULT_COUNT_SCALE: Readonly<Record<Difficulty, number>> = {
  easy: 0.75,
  normal: 1,
  hard: 1.25,
};

/** What a difficulty profile does to the size of each wave. */
export function assaultCountScale(profile: DifficultyProfile): number {
  const difficulties: readonly Difficulty[] = ['easy', 'normal', 'hard'];
  const match = difficulties.find((difficulty) => DIFFICULTY_PROFILES[difficulty] === profile);
  return ASSAULT_COUNT_SCALE[match ?? 'normal'];
}

// ── The waves ───────────────────────────────────────────────────────────────

/** Which kind of undead a wave spawns. */
export type AssaultSpawnKind =
  'raised_ratkin' | 'ruins_ghoul' | 'skeleton_warrior' | 'skeleton_archer' | 'grave_bull';

export interface AssaultWaveSpec {
  readonly lanes: readonly AssaultLane['id'][];
  readonly spawns: Readonly<Partial<Record<AssaultSpawnKind, number>>>;
  /** Whether Vordrick Boneharrow comes with this wave, by the east lane. */
  readonly necromancer: boolean;
}

/**
 * Each wave's base counts, before the difficulty's scale. Sized against the
 * floor's reference party, whose crawlers carry a couple of dozen hit points
 * or fewer: at twice these counts the siege simulation loses more runs than it
 * wins, the party falling to the raised before the bell does.
 */
export const ASSAULT_WAVES: readonly AssaultWaveSpec[] = [
  { lanes: ['east'], spawns: { raised_ratkin: 4, ruins_ghoul: 1 }, necromancer: false },
  {
    lanes: ['east', 'south'],
    spawns: { raised_ratkin: 4, skeleton_warrior: 2, skeleton_archer: 1, grave_bull: 1 },
    necromancer: false,
  },
  {
    lanes: ['east', 'south'],
    spawns: { raised_ratkin: 3, skeleton_warrior: 2, skeleton_archer: 1, grave_bull: 1 },
    necromancer: true,
  },
];

/** The wave at `index` (from 0), or null past the last. */
function waveSpec(index: number): AssaultWaveSpec | null {
  return index >= 0 && index < ASSAULT_WAVES.length ? ASSAULT_WAVES[index] : null;
}

/** The lane the necromancer walks in by. */
const NECROMANCER_LANE: AssaultLane['id'] = 'east';

const SPAWN_ORDER: readonly AssaultSpawnKind[] = [
  'raised_ratkin',
  'ruins_ghoul',
  'skeleton_warrior',
  'skeleton_archer',
  'grave_bull',
];

/** One body still to come, and when. */
interface PendingSpawn {
  readonly kind: AssaultSpawnKind;
  readonly lane: AssaultLane;
  readonly dueFrame: number;
  /** The wave it belongs to, which it keeps if it is still queued when the next wave begins. */
  readonly wave: number;
}

function createSpawn(kind: AssaultSpawnKind, tileX: number, tileY: number): Mob {
  switch (kind) {
    case 'raised_ratkin':
      return new RaisedRatkin(tileX, tileY, TILE_SIZE);
    case 'ruins_ghoul':
      return new RuinsGhoul(tileX, tileY, TILE_SIZE);
    case 'skeleton_warrior':
      return new SkeletonWarrior(tileX, tileY, TILE_SIZE);
    case 'skeleton_archer':
      return new SkeletonArcher(tileX, tileY, TILE_SIZE);
    case 'grave_bull':
      return new GraveBull(tileX, tileY, TILE_SIZE);
  }
}

/** The countdown as a clock face: 1:30, 0:07. */
export function countdownLabel(frames: number): string {
  const seconds = Math.max(0, Math.ceil(frames / UPDATES_PER_SECOND));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(TWO_DIGITS, '0');
  return `${minutes}:${rest}`;
}

/** Tile distance from a tile to the nearest tile of the palisade's bounding rect; 0 inside it. */
function tilesOutsidePalisade(site: BriarHollowSite, tileX: number, tileY: number): number {
  const bounds = site.palisadeBounds;
  const dx = Math.max(bounds.x - tileX, 0, tileX - (bounds.x + bounds.w - 1));
  const dy = Math.max(bounds.y - tileY, 0, tileY - (bounds.y + bounds.h - 1));
  return Math.hypot(dx, dy);
}

// ── Directives ──────────────────────────────────────────────────────────────

/**
 * An assault mob's frame while it has a wall to reach. The undead with a
 * siege of their own (the Grave Bull's charge, the necromancer) are left to
 * it; any mob with a defender close on its own side of the wall fights them
 * with its own AI; archers hold off the wall and shoot; everyone else strikes
 * the structure in their way, or takes the next step toward the bell.
 */
class MarchDirective implements SiegeDirective {
  constructor(private readonly site: BriarHollowSite) {}

  steer(mob: Mob, targets: readonly Player[]): boolean {
    const siege = mob.siegeCapable;
    // A snare that turned it, or a siege that has ended: its own AI again.
    if (siege === null || !mob.isHostile || mob.ownsSiegeMovement) return false;
    // Still climbing out of the ground: its own AI plays the rise and holds it there.
    if (mob instanceof RisingSkeleton && mob.isRising) return false;
    const defenderDistance = this.nearestDefenderDistance(
      mob,
      targets,
      SIEGE_DEFENDER_NOTICE_TILES,
    );
    // A trebuchet is weighed as a peer of the defenders above, at the same
    // notice range, so a mob does not detour to one across the yard while a
    // defender stands right beside it — and never for an archer, which never
    // batters anything (`structureDamageMultiplier` of 0).
    if (siege.structureDamageMultiplier > 0) {
      const trebuchet = nearestLiveTrebuchetTo(
        mob,
        siege.world.defense,
        SIEGE_DEFENDER_NOTICE_TILES * TILE_SIZE,
      );
      if (
        trebuchet !== null &&
        trebuchet.distance < defenderDistance &&
        mob.hasSightOfPoint(trebuchet.x, trebuchet.y)
      ) {
        mob.currentTarget = null;
        engageTrebuchet(mob, siege.world.defense, trebuchet);
        return true;
      }
    }
    if (defenderDistance < Infinity) return false;
    if (siege.structureDamageMultiplier <= 0) return this.holdOffTheWall(mob, targets);
    return siegeAdvance(mob);
  }

  /** The nearest defender within `tiles` this mob may fight, or Infinity when none qualify. */
  private nearestDefenderDistance(mob: Mob, targets: readonly Player[], tiles: number): number {
    const reach = tiles * TILE_SIZE;
    let best = Infinity;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const distance = Math.hypot(target.x - mob.x, target.y - mob.y);
      if (distance > reach || distance >= best) continue;
      if (!siegeCanEngage(mob, target)) continue;
      best = distance;
    }
    return best;
  }

  /** An archer's frame: march until in bow range of the wall, then shoot defenders it can see. */
  private holdOffTheWall(mob: Mob, targets: readonly Player[]): boolean {
    if (isInsidePalisade(this.site, mob)) return false;
    const tile = tileUnder(mob);
    const distance = palisadeDistanceFor(this.site).distanceAt(tile.x, tile.y);
    const shootReach = ARCHER_SHOOT_TILES * TILE_SIZE;
    const someoneInRange = targets.some(
      (target) => target.isAlive && Math.hypot(target.x - mob.x, target.y - mob.y) <= shootReach,
    );
    if (distance !== INSIDE_PALISADE && distance <= ARCHER_HOLD_TILES) {
      if (someoneInRange) return false;
      mob.isMoving = false;
      return true;
    }
    const siege = mob.siegeCapable;
    if (siege === null) return false;
    const next = siege.world.flow.nextStep(tile, siege.spreadSeed);
    if (next === null) return false;
    mob.marchStep(next.x * TILE_SIZE - mob.x, next.y * TILE_SIZE - mob.y);
    return true;
  }
}

/** An undead whose master has fallen: it stands where it is, and does nothing more. */
/** A body that stands where it is and takes no part: the withdrawn dead waiting to be released. */
export const HOLD_STILL: SiegeDirective = {
  steer(mob) {
    mob.currentTarget = null;
    mob.isMoving = false;
    return true;
  },
};

/** One mob's walk back out after a lost siege. */
interface Withdrawal {
  readonly lane: AssaultLane;
  path: Array<{ x: number; y: number }> | null;
  step: number;
  frames: number;
}

/**
 * The dead's frame after the bell falls: no more fighting, just the walk back
 * up the lane they came by, released once they are out of sight.
 */
class WithdrawDirective implements SiegeDirective {
  readonly walks = new Map<Mob, Withdrawal>();
  private pathsThisUpdate = 0;

  constructor(
    private readonly gameMap: GameMap,
    private readonly site: BriarHollowSite,
  ) {}

  /** Called once per update, before the mob loop plans any paths. */
  beginUpdate(): void {
    this.pathsThisUpdate = 0;
  }

  steer(mob: Mob): boolean {
    const walk = this.walks.get(mob);
    if (walk === undefined) return false;
    mob.currentTarget = null;
    walk.frames++;
    if (walk.path === null) {
      if (this.pathsThisUpdate >= WITHDRAW_PATHS_PER_UPDATE) {
        mob.isMoving = false;
        return true;
      }
      this.pathsThisUpdate++;
      const from = tileUnder(mob);
      walk.path = this.gameMap.findPath(
        from.x,
        from.y,
        walk.lane.spawn.x,
        walk.lane.spawn.y,
        WITHDRAW_PATH_SEARCH_TILES,
        true,
      );
      walk.step = 0;
    }
    if (walk.step >= walk.path.length) {
      mob.isMoving = false;
      return true;
    }
    const waypoint = walk.path[walk.step];
    const toX = waypoint.x * TILE_SIZE - mob.x;
    const toY = waypoint.y * TILE_SIZE - mob.y;
    if (Math.hypot(toX, toY) <= WAYPOINT_REACHED_TILES * TILE_SIZE) {
      walk.step++;
      return true;
    }
    mob.marchStep(toX, toY);
    return true;
  }

  /** Whether a withdrawing mob is out far enough, or has walked long enough, to be let go. */
  isDone(mob: Mob): boolean {
    const walk = this.walks.get(mob);
    if (walk === undefined) return true;
    if (walk.frames >= WITHDRAW_TIMEOUT_FRAMES) return true;
    if (walk.path !== null && walk.step >= walk.path.length) return true;
    const tile = tileUnder(mob);
    return tilesOutsidePalisade(this.site, tile.x, tile.y) >= WITHDRAW_RELEASE_TILES;
  }
}

// ── The system ──────────────────────────────────────────────────────────────

/** A dust cloud where something crumbled, or a wisp where it vanished. */
interface CrumbleEffect {
  readonly x: number;
  readonly y: number;
  readonly dust: boolean;
  age: number;
}

/**
 * How a released body leaves: `crumble` falls where it stands (its own death
 * art where it has one, dust otherwise); `vanish` is simply gone, in a wisp
 * or unseen.
 */
type ReleaseStyle =
  { readonly kind: 'crumble' } | { readonly kind: 'vanish'; readonly effect: 'wisp' | 'none' };

const CRUMBLE: ReleaseStyle = { kind: 'crumble' };
const VANISH_IN_A_WISP: ReleaseStyle = { kind: 'vanish', effect: 'wisp' };
const VANISH_UNSEEN: ReleaseStyle = { kind: 'vanish', effect: 'none' };

/** A mob waiting its turn to crumble after the victory. */
interface ScheduledCrumble {
  readonly mob: Mob;
  framesLeft: number;
}

export interface VillageAssaultFrame {
  readonly active: { readonly x: number; readonly y: number };
}

export interface VillageAssaultSystemDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly defense: DefenseStructures;
  readonly ambience: VillageAmbience;
  readonly audio: AudioManager | null;
  /** Moves the questline to a new phase; the quest system owns the phase and its event. */
  readonly setPhase: (phase: VillageQuestPhase) => void;
  /** The level each wave spawn comes at: the band the militia is levelled to meet. */
  readonly waveLevel: () => number;
  /** The difficulty profile the waves are sized and levelled for. */
  readonly difficulty: () => DifficultyProfile;
  /** The soldiers on the ground right now, for the damage the siege did. */
  readonly downedSoldiers: () => ReadonlyArray<object>;
  /** The Mayor's alarm when the outer wall first gives. */
  readonly mayorBark: () => void;
  /** Plays the boss intro for the necromancer's arrival. */
  readonly bossIntro: (name: string, color: string) => void;
  /** Both crawlers, whose sight a spawn keeps out of. */
  readonly crawlers: () => ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** The overworld's zone music, which the siege track takes over from. Null in a gate. */
  readonly music: () => SiegeMusicClaim | null;
  /** Keeps each wave's arrival rows warm; injectable so a gate can count its calls. */
  readonly prewarm?: AssaultWavePrewarm;
  /** Uniform [0, 1); a gate passes a seeded stream. */
  readonly random?: () => number;
}

/** The necromancer's boss-intro colour: his lantern's soul-blue. */
const NECROMANCER_INTRO_COLOR = '#7dd3fc';

export class VillageAssaultSystem {
  private readonly random: () => number;
  private readonly prewarm: AssaultWavePrewarm;
  private readonly march: MarchDirective;
  private readonly withdraw: WithdrawDirective;
  private flow: SiegeFlowField | null = null;
  private world: SiegeWorld | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  private pending: PendingSpawn[] = [];
  private readonly waveOf = new Map<Mob, number>();
  private readonly laneOf = new Map<Mob, AssaultLane>();
  private wavePlanned = 0;
  private waveFrames = 0;
  private lullFrames = 0;
  /** Lanes the current wave has put at least one body out on. */
  private readonly lanesOut = new Set<AssaultLane['id']>();
  private necromancer: Necromancer | null = null;
  private necromancerOut = false;
  /** Set from the start of his wave until he has somewhere to appear. */
  private necromancerDue = false;
  /** How long the necromancer, and the spawn at the head of the queue, have waited for a place. */
  private necromancerWaitFrames = 0;
  private headSpawnWaitFrames = 0;
  private abandonFrames = 0;
  private bellRingFrames = 0;
  private bellTollGap = 0;
  private bellFlashFrames = 0;
  private bellCrackFrames = 0;
  private outcomeBanner: { text: string; framesLeft: number } | null = null;
  private breachCalled = false;
  private readonly downedSeen = new Set<object>();
  private segmentsBreached = 0;
  private structuresDestroyed = 0;
  private readonly crumbles: ScheduledCrumble[] = [];
  private readonly effects: CrumbleEffect[] = [];

  /** Every body the waves have spawned, for the gates. */
  spawnedTotal = 0;
  /** The most assault bodies ever alive at once this siege, for the live-cap gate. */
  peakLiving = 0;

  constructor(private readonly deps: VillageAssaultSystemDeps) {
    this.random = deps.random ?? Math.random;
    this.prewarm = deps.prewarm ?? new AssaultWavePrewarm();
    this.march = new MarchDirective(deps.site);
    this.withdraw = new WithdrawDirective(deps.gameMap, deps.site);
    this.unsubscribers.push(
      deps.bus.on('structureDestroyed', ({ kind }) => this.noteDestroyed(kind)),
      deps.bus.on('structureDamaged', ({ kind }) => {
        if (kind === 'bell') this.noteBellStruck();
      }),
    );
    this.adoptPhaseOnBuild();
  }

  // ── State reads ───────────────────────────────────────────────────────────

  private get phase(): VillageQuestPhase {
    return this.deps.state.quest.phase;
  }

  /** Whether the countdown or the waves are running. */
  get inSiege(): boolean {
    return this.phase === 'imminent' || this.phase === 'assault';
  }

  /** Frames left on the countdown. */
  get countdownFrames(): number {
    return this.deps.state.quest.imminentCountdownFrames;
  }

  /** The wave under way (or, in a lull, the one coming), counted from 1. */
  get waveNumber(): number {
    const index = this.deps.state.quest.assaultWaveIndex ?? 0;
    return index + 1;
  }

  /** Whether the breather before the next wave is on. */
  get inLull(): boolean {
    return this.lullFrames > 0;
  }

  /** The bell's health as a share of its whole. */
  get bellFraction(): number {
    return Math.max(0, this.deps.state.quest.bellHp) / HOLLOW_BELL_MAX_HP;
  }

  /** The necromancer while he is in the fight. */
  get activeNecromancer(): Necromancer | null {
    const necro = this.necromancer;
    return necro?.isAlive === true ? necro : null;
  }

  /** The siege's navigation, while it runs. */
  get flowField(): SiegeFlowField | null {
    return this.flow;
  }

  /** The seconds the abandon warning has left, or null while nobody has strayed. */
  get abandonSecondsLeft(): number | null {
    if (this.abandonFrames <= 0) return null;
    return Math.max(
      0,
      Math.ceil((ASSAULT_ABANDON_FRAMES - this.abandonFrames) / UPDATES_PER_SECOND),
    );
  }

  /** Undead still marching out after a lost siege. */
  get withdrawingCount(): number {
    return this.withdraw.walks.size;
  }

  /** Undead still waiting to crumble after a victory. */
  get crumblingCount(): number {
    return this.crumbles.length;
  }

  /** Whether a planned spawn is due and still waiting: held by the live cap, or for a place to appear. */
  get spawnWaiting(): boolean {
    return this.pending.length > 0 && this.pending[0].dueFrame <= this.waveFrames;
  }

  /** Whether a mob was spawned by this siege's waves. */
  isAssaultSpawn(mob: Mob): boolean {
    return this.waveOf.has(mob);
  }

  // ── Beginning ─────────────────────────────────────────────────────────────

  /**
   * A scene built while a siege is under way picks it up where the state
   * says. The countdown resumes from what is left of it; a wave cannot —
   * its undead were not carried through the door — so a siege found
   * mid-wave is lost, the same as walking away from it.
   */
  private adoptPhaseOnBuild(): void {
    if (this.phase === 'imminent') {
      this.enterSiegeDressing();
      return;
    }
    if (this.phase === 'assault') {
      this.enterSiegeDressing();
      this.lose(ABANDONED_BANNER);
    }
  }

  /** "We're ready": the bell rings and the ninety seconds start. */
  begin(): void {
    if (this.phase !== 'fortifying') return;
    this.resetSiegeCounters();
    this.deps.state.quest.imminentCountdownFrames = IMMINENT_FRAMES;
    this.deps.state.quest.assaultWaveIndex = null;
    this.deps.defense.restoreBell();
    this.deps.setPhase('imminent');
    this.enterSiegeDressing();
    this.playCue('bellAlarm');
  }

  private resetSiegeCounters(): void {
    this.pending = [];
    this.waveOf.clear();
    this.laneOf.clear();
    this.lanesOut.clear();
    this.necromancer = null;
    this.necromancerOut = false;
    this.necromancerDue = false;
    this.necromancerWaitFrames = 0;
    this.headSpawnWaitFrames = 0;
    this.abandonFrames = 0;
    this.breachCalled = false;
    this.downedSeen.clear();
    this.segmentsBreached = 0;
    this.structuresDestroyed = 0;
    this.spawnedTotal = 0;
    this.peakLiving = 0;
    this.lullFrames = 0;
    this.waveFrames = 0;
  }

  /** The poster, the bell, the siege track and the navigation. */
  private enterSiegeDressing(): void {
    const { ambience } = this.deps;
    ambience.noticeBoard.callToArms = true;
    ambience.bell.cracked = false;
    this.ensureFlow();
    const music = this.deps.music();
    if (music !== null) music.battleMusicActive = true;
    this.deps.audio?.playMusic(VILLAGE_SIEGE_MUSIC, { fadeInMs: SIEGE_MUSIC_FADE_MS });
  }

  private ensureFlow(): SiegeWorld {
    if (this.world !== null) return this.world;
    const { gameMap, site, defense, bus, roster } = this.deps;
    const flow = new SiegeFlowField({ gameMap, site, defense, bus });
    this.flow = flow;
    this.world = { defense, flow, site, mobs: roster.mobs };
    return this.world;
  }

  // ── The frame ─────────────────────────────────────────────────────────────

  /** One gameplay update. Not called while the world is halted. */
  update(frame: VillageAssaultFrame): void {
    if (this.inSiege) this.holdSiegeMusic();
    this.withdraw.beginUpdate();
    this.flow?.update(1 / UPDATES_PER_SECOND);
    this.tickBell();
    this.tickEffects();
    if (this.outcomeBanner !== null) {
      this.outcomeBanner.framesLeft--;
      if (this.outcomeBanner.framesLeft <= 0) this.outcomeBanner = null;
    }
    this.tickWithdrawals();
    this.tickCrumbles();

    if (this.phase === 'imminent') this.updateImminent(frame);
    else if (this.phase === 'assault') this.updateAssault(frame);
    else this.prewarm.update(null);
  }

  private updateImminent(frame: VillageAssaultFrame): void {
    this.prewarm.update(1);
    const quest = this.deps.state.quest;
    quest.imminentCountdownFrames = Math.max(0, quest.imminentCountdownFrames - 1);
    if (this.checkAbandon(frame)) return;
    if (quest.imminentCountdownFrames === 0) this.startAssault();
  }

  private startAssault(): void {
    const quest = this.deps.state.quest;
    quest.assaultWaveIndex = 0;
    this.deps.setPhase('assault');
    this.startWave(0);
  }

  private startWave(index: number): void {
    const spec = waveSpec(index);
    if (spec === null) return;
    this.deps.state.quest.assaultWaveIndex = index;
    this.waveFrames = 0;
    this.lullFrames = 0;
    this.lanesOut.clear();
    // Anything the live cap held back from the wave before still comes, first.
    const leftovers = this.pending.map((spawn) => ({ ...spawn, dueFrame: 0 }));
    const planned = this.planWave(spec, index);
    this.pending = [...leftovers, ...planned];
    this.wavePlanned = planned.length;
    this.deps.bus.emit('villageAssaultWave', { index });
    this.playCue('necroWarHorn');
    if (spec.necromancer) {
      this.necromancerDue = true;
      this.necromancerWaitFrames = 0;
      this.spawnNecromancer();
    }
  }

  /** The wave's bodies, scaled for the difficulty, dealt round its lanes and trickled over its opening seconds. */
  private planWave(spec: AssaultWaveSpec, wave: number): PendingSpawn[] {
    const scale = assaultCountScale(this.deps.difficulty());
    const counts = new Map<AssaultSpawnKind, number>();
    for (const kind of SPAWN_ORDER) {
      const base = spec.spawns[kind] ?? 0;
      if (base > 0) counts.set(kind, Math.max(1, Math.round(base * scale)));
    }
    // Round-robin through the kinds, so the trickle mixes them rather than
    // sending every raised ratkin before the first skeleton.
    const order: AssaultSpawnKind[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const kind of SPAWN_ORDER) {
        const left = counts.get(kind) ?? 0;
        if (left <= 0) continue;
        order.push(kind);
        counts.set(kind, left - 1);
        added = true;
      }
    }
    const lanes = spec.lanes
      .map((id) => this.deps.site.assaultLanes.find((lane) => lane.id === id))
      .filter((lane): lane is AssaultLane => lane !== undefined);
    if (lanes.length === 0) return [];
    return order.map((kind, index) => ({
      kind,
      lane: lanes[index % lanes.length],
      dueFrame: Math.floor((index * WAVE_TRICKLE_FRAMES) / order.length),
      wave,
    }));
  }

  private updateAssault(frame: VillageAssaultFrame): void {
    const quest = this.deps.state.quest;
    const index = quest.assaultWaveIndex ?? 0;
    this.noteDownedSoldiers();

    if (this.necromancer !== null && !this.necromancer.isAlive && this.necromancerOut) {
      this.win();
      return;
    }
    if (this.deps.defense.bellCracked) {
      this.lose(BELL_FALLEN_BANNER);
      return;
    }
    if (this.checkAbandon(frame)) return;

    if (this.lullFrames > 0) {
      this.prewarm.update(this.prewarmWaveFor(index + 1));
      this.lullFrames--;
      if (this.lullFrames === 0) this.startWave(index + 1);
      return;
    }

    this.waveFrames++;
    this.spawnDue();
    this.peakLiving = Math.max(this.peakLiving, livingAssaultSpawns(this.deps.roster.mobs));
    this.prewarm.update(this.waveStillArriving(index) ? this.prewarmWaveFor(index) : null);

    const isLastWave = index >= ASSAULT_WAVE_COUNT - 1;
    if (isLastWave) return;
    const remaining = this.remainingInWave(index);
    const fewLeft = remaining <= Math.floor(this.wavePlanned * WAVE_ADVANCE_REMAINING_SHARE);
    // The next wave's lead-in starts here; its rows are warmed through the lull from the next update.
    if (fewLeft || this.waveFrames >= WAVE_MAX_FRAMES) this.lullFrames = WAVE_LULL_FRAMES;
  }

  private prewarmWaveFor(index: number): AssaultWave | null {
    const wave = index + 1;
    return wave === 1 || wave === 2 || wave === THIRD_WAVE ? wave : null;
  }

  /**
   * Whether the wave's lead-in is still running: some lane it uses has not
   * put a body out yet, or its necromancer has not appeared. After that the
   * arrivals draw their own rows, and warming them only competes with the fight.
   */
  private waveStillArriving(index: number): boolean {
    const spec = waveSpec(index);
    if (spec === null) return false;
    if (spec.necromancer && !this.necromancerOut) return true;
    return spec.lanes.some((lane) => !this.lanesOut.has(lane));
  }

  /** The wave's bodies not yet beaten: still to come, or alive and on the enemy's side. */
  private remainingInWave(index: number): number {
    let remaining = this.pending.filter((spawn) => spawn.wave === index).length;
    for (const [mob, wave] of this.waveOf) {
      // A converted ally no longer counts: it fights for the village now.
      if (wave === index && mob.isAlive && mob.isHostile) remaining++;
    }
    return remaining;
  }

  private spawnDue(): void {
    if (this.necromancerDue) this.spawnNecromancer();
    while (this.pending.length > 0) {
      const next = this.pending[0];
      if (next.dueFrame > this.waveFrames) return;
      if (livingAssaultSpawns(this.deps.roster.mobs) >= ASSAULT_LIVE_CAP) return;
      const place = this.placeFor(this.lanesFor(next.lane), this.headSpawnWaitFrames);
      if (place === null) {
        // Held at the head of the queue, not dropped: it still belongs to its wave.
        this.headSpawnWaitFrames++;
        return;
      }
      this.pending.shift();
      this.headSpawnWaitFrames = 0;
      this.spawn(next.kind, place.lane, place.tile, next.wave);
    }
  }

  /**
   * Where a spawn comes up: near one of `lanes`' spawn tiles (its own lane
   * first, then the wave's others), on open ground a hostile may stand on and
   * never within {@link SPAWN_MIN_CRAWLER_TILES} of a crawler. Off screen
   * where one can be found — the dead come up the lane, they do not appear in
   * view; off screen is the camera the scene last drew with
   * (`isWorldPointInView`), or with none published, far enough from both
   * crawlers. Once it has waited {@link SPAWN_DEFER_FRAMES} for that, the
   * furthest clear spot in view will do. Null: nowhere yet, so it waits.
   */
  private placeFor(
    lanes: readonly AssaultLane[],
    waitedFrames: number,
  ): { lane: AssaultLane; tile: { x: number; y: number } } | null {
    let furthest: { lane: AssaultLane; tile: { x: number; y: number }; away: number } | null = null;
    for (const lane of lanes) {
      const candidate = this.laneCandidate(lane);
      if (candidate === null) continue;
      if (candidate.unseen) return { lane, tile: candidate.tile };
      if (furthest === null || candidate.away > furthest.away) {
        furthest = { lane, tile: candidate.tile, away: candidate.away };
      }
    }
    const waitedLongEnough = waitedFrames >= SPAWN_DEFER_FRAMES;
    return waitedLongEnough && furthest !== null
      ? { lane: furthest.lane, tile: furthest.tile }
      : null;
  }

  /** The best spot round one lane's spawn tile: the first off screen, else the furthest clear of the party. */
  private laneCandidate(
    lane: AssaultLane,
  ): { tile: { x: number; y: number }; unseen: boolean; away: number } | null {
    const { gameMap } = this.deps;
    const crawlers = this.deps.crawlers();
    const nearestCrawlerTiles = (tile: { x: number; y: number }): number =>
      Math.min(
        ...crawlers.map((crawler) =>
          Math.hypot(tile.x - crawler.x / TILE_SIZE, tile.y - crawler.y / TILE_SIZE),
        ),
      );
    let furthest: { tile: { x: number; y: number }; unseen: boolean; away: number } | null = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const jitterX = Math.floor(this.random() * SPAWN_JITTER_SPAN) - SPAWN_SCATTER_TILES;
      const jitterY = Math.floor(this.random() * SPAWN_JITTER_SPAN) - SPAWN_SCATTER_TILES;
      const tile = findNearbyWalkableTile(
        gameMap,
        lane.spawn.x + jitterX,
        lane.spawn.y + jitterY,
        SPAWN_SEARCH_TILES,
        (x, y) => gameMap.isWalkableForHostile(x, y),
      );
      if (tile === null) continue;
      const away = nearestCrawlerTiles(tile);
      if (away < SPAWN_MIN_CRAWLER_TILES) continue;
      if (this.isUnseen(tile, away)) return { tile, unseen: true, away };
      if (furthest === null || away > furthest.away) furthest = { tile, unseen: false, away };
    }
    return furthest;
  }

  /**
   * `own` first, then the other lanes the wave now under way comes by — for
   * a spawn held over from an earlier wave too, which may take a lane its own
   * wave never had.
   */
  private lanesFor(own: AssaultLane): AssaultLane[] {
    const current = this.deps.state.quest.assaultWaveIndex ?? 0;
    const others = (waveSpec(current)?.lanes ?? [])
      .filter((id) => id !== own.id)
      .map((id) => this.deps.site.assaultLanes.find((lane) => lane.id === id))
      .filter((lane): lane is AssaultLane => lane !== undefined);
    return [own, ...others];
  }

  private isUnseen(tile: { x: number; y: number }, tilesFromParty: number): boolean {
    if (visibleWorldView() === null) return tilesFromParty > SPAWN_UNSEEN_TILES;
    const outsideByPx = -SPAWN_OFFSCREEN_MARGIN_TILES * TILE_SIZE;
    const centreX = (tile.x + TILE_CENTRE_OFFSET) * TILE_SIZE;
    const centreY = (tile.y + TILE_CENTRE_OFFSET) * TILE_SIZE;
    return !isWorldPointInView(centreX, centreY, outsideByPx);
  }

  /** Levels, stages and enlists one assault body, and joins it to the scene. */
  private enlist(mob: Mob, lane: AssaultLane, wave: number): void {
    const world = this.ensureFlow();
    mob.applyMobLevel(this.deps.waveLevel());
    applySpawnDifficulty(mob, this.deps.difficulty());
    enlistInSiege(mob, world, Math.floor(this.random() * SPREAD_SEED_RANGE));
    mob.ignoresTownSafeZone = true;
    mob.siegeDirective = this.march;
    this.deps.roster.add(mob);
    this.waveOf.set(mob, wave);
    this.laneOf.set(mob, lane);
    this.lanesOut.add(lane.id);
    this.spawnedTotal++;
  }

  private spawn(
    kind: AssaultSpawnKind,
    lane: AssaultLane,
    tile: { x: number; y: number },
    wave: number,
  ): void {
    const mob = createSpawn(kind, tile.x, tile.y);
    // They claw their way up out of the ground at the lane's head: the row
    // each wave's rows are warmed for.
    if (mob instanceof RaisedRatkin) mob.beginRising();
    this.enlist(mob, lane, wave);
  }

  private spawnNecromancer(): void {
    const lane = this.deps.site.assaultLanes.find((candidate) => candidate.id === NECROMANCER_LANE);
    if (lane === undefined) return;
    // He always comes up his own lane: his arrival is staged there.
    const place = this.placeFor([lane], this.necromancerWaitFrames);
    if (place === null) {
      this.necromancerWaitFrames++;
      return;
    }
    this.necromancerDue = false;
    const { tile } = place;
    const necro = new Necromancer(tile.x, tile.y, TILE_SIZE);
    this.enlist(necro, lane, this.deps.state.quest.assaultWaveIndex ?? 0);
    this.necromancer = necro;
    this.necromancerOut = true;
    this.deps.bossIntro(necro.displayName, NECROMANCER_INTRO_COLOR);
    this.playCue('necromancerArrival');
  }

  // ── Abandoning ────────────────────────────────────────────────────────────

  /** Counts time the active crawler spends far from the palisade. Returns whether that lost the siege. */
  private checkAbandon(frame: VillageAssaultFrame): boolean {
    const tileX = Math.floor(frame.active.x / TILE_SIZE + TILE_CENTRE);
    const tileY = Math.floor(frame.active.y / TILE_SIZE + TILE_CENTRE);
    const away = tilesOutsidePalisade(this.deps.site, tileX, tileY) > ASSAULT_ABANDON_TILES;
    if (!away) {
      this.abandonFrames = 0;
      return false;
    }
    this.abandonFrames++;
    if (this.abandonFrames < ASSAULT_ABANDON_FRAMES) return false;
    this.lose(ABANDONED_BANNER);
    return true;
  }

  // ── Endings ───────────────────────────────────────────────────────────────

  /** The undead the siege still has in the field, the necromancer's raises included. */
  private livingSiegeMobs(): Mob[] {
    return this.deps.roster.mobs.filter(
      (mob) => mob.isAlive && mob.isHostile && mob.siegeCapable !== null,
    );
  }

  private recordSummary(): void {
    this.noteDownedSoldiers();
    this.deps.state.quest.lastSiege = {
      segmentsBreached: this.segmentsBreached,
      structuresDestroyed: this.structuresDestroyed,
      soldiersDowned: this.downedSeen.size,
    };
  }

  /** Vordrick Boneharrow is dead: the rest of the dead crumble, and the village is saved. */
  private win(): void {
    this.recordSummary();
    this.deps.state.quest.assaultWaveIndex = null;
    this.pending = [];
    this.lullFrames = 0;
    const living = this.livingSiegeMobs();
    for (const mob of living) {
      // Beaten: it stands where it is until it falls, and fights no more.
      mob.siegeDirective = HOLD_STILL;
      mob.currentTarget = null;
      this.crumbles.push({
        mob,
        framesLeft: Math.floor(this.random() * CRUMBLE_STAGGER_FRAMES),
      });
    }
    this.deps.setPhase('victory');
    this.endSiege();
    this.playCue('bellVictoryPeal');
  }

  /** The bell fell, or the party left: the dead walk back out, and the walls stay as they are. */
  private lose(banner: string): void {
    this.recordSummary();
    this.deps.state.quest.assaultWaveIndex = null;
    this.pending = [];
    this.lullFrames = 0;
    const fell = this.deps.defense.bellCracked;
    for (const mob of this.livingSiegeMobs()) {
      if (mob instanceof Necromancer) {
        // He does not walk anywhere: he is simply gone, the way he blinks.
        this.release(mob, VANISH_IN_A_WISP);
        continue;
      }
      const lane = this.laneOf.get(mob) ?? this.nearestLane(mob);
      if (lane === null) {
        this.release(mob, VANISH_IN_A_WISP);
        continue;
      }
      this.withdraw.walks.set(mob, { lane, path: null, step: 0, frames: 0 });
      mob.siegeDirective = this.withdraw;
      mob.currentTarget = null;
    }
    this.outcomeBanner = { text: banner, framesLeft: OUTCOME_BANNER_FRAMES };
    if (fell) {
      this.deps.ambience.bell.cracked = true;
      this.bellCrackFrames = BELL_CRACK_SHOWN_FRAMES;
      this.playCue('bellCrack');
    }
    this.deps.setPhase('repelled_failed');
    this.endSiege();
  }

  private nearestLane(mob: Mob): AssaultLane | null {
    let best: AssaultLane | null = null;
    let bestDistance = Infinity;
    const tile = tileUnder(mob);
    for (const lane of this.deps.site.assaultLanes) {
      const distance = Math.hypot(lane.spawn.x - tile.x, lane.spawn.y - tile.y);
      if (distance < bestDistance) {
        best = lane;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Whatever the ending: the bell is mended, the poster comes down, the village's music returns. */
  private endSiege(): void {
    this.deps.defense.restoreBell();
    this.deps.state.quest.imminentCountdownFrames = 0;
    this.abandonFrames = 0;
    this.prewarm.update(null);
    const { ambience } = this.deps;
    ambience.noticeBoard.callToArms = false;
    ambience.bell.ringing = false;
    this.bellRingFrames = 0;
    this.releaseMusic();
  }

  /**
   * Keeps the siege track through the whole siege. A music system built after
   * the siege's dressing went up — the scene rebuilt round a door visit
   * mid-countdown — starts with no claim on it and would put the zone's
   * playlist on at its first update, so the claim is made again every update.
   */
  private holdSiegeMusic(): void {
    const music = this.deps.music();
    if (music === null || music.battleMusicActive) return;
    music.battleMusicActive = true;
    if (this.deps.audio?.currentMusicId !== VILLAGE_SIEGE_MUSIC) {
      this.deps.audio?.playMusic(VILLAGE_SIEGE_MUSIC, { fadeInMs: SIEGE_MUSIC_FADE_MS });
    }
  }

  private releaseMusic(): void {
    const music = this.deps.music();
    if (music === null) return;
    music.battleMusicActive = false;
    music.reset();
  }

  /**
   * Takes an assault body out of the world with nothing paid: no XP, no loot,
   * no kill event — its health is zeroed outside the damage path, so no
   * death is ever latched for kill resolution to pay out. A crumbling body
   * that plays its own death (`rendersWhenDead`) collapses where it stands;
   * everything else leaves the grid at once, which is what stops it being
   * drawn. Its body stays in the roster, as a corpse's does.
   */
  private release(mob: Mob, style: ReleaseStyle): void {
    mob.siegeDirective = null;
    mob.currentTarget = null;
    mob.clearAirborneAttacks();
    const showsEffect = style.kind === 'crumble' || style.effect === 'wisp';
    if (showsEffect) {
      this.effects.push({
        x: mob.x + TILE_SIZE * TILE_CENTRE,
        y: mob.y + TILE_SIZE * TILE_CENTRE,
        dust: style.kind === 'crumble',
        age: 0,
      });
    }
    mob.hp = 0;
    const playsOwnDeath = style.kind === 'crumble' && mob.rendersWhenDead;
    if (!playsOwnDeath) {
      mob.vanish();
      this.deps.roster.grid.remove(mob);
    }
    this.waveOf.delete(mob);
    this.laneOf.delete(mob);
    this.withdraw.walks.delete(mob);
  }

  private tickCrumbles(): void {
    for (let i = this.crumbles.length - 1; i >= 0; i--) {
      const crumble = this.crumbles[i];
      if (!crumble.mob.isAlive) {
        this.crumbles.splice(i, 1);
        continue;
      }
      // It stands still while it waits: the fight is over.
      crumble.mob.currentTarget = null;
      crumble.framesLeft--;
      if (crumble.framesLeft > 0) continue;
      this.crumbles.splice(i, 1);
      this.release(crumble.mob, CRUMBLE);
    }
  }

  private tickWithdrawals(): void {
    for (const mob of [...this.withdraw.walks.keys()]) {
      if (!mob.isAlive) {
        this.withdraw.walks.delete(mob);
        continue;
      }
      if (this.withdraw.isDone(mob)) this.release(mob, VANISH_UNSEEN);
    }
  }

  private tickEffects(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age++;
      if (effect.age > CRUMBLE_EFFECT_FRAMES) this.effects.splice(i, 1);
    }
  }

  // ── The bell ──────────────────────────────────────────────────────────────

  private noteBellStruck(): void {
    if (!this.inSiege) return;
    this.bellRingFrames = BELL_HIT_RING_FRAMES;
    this.bellFlashFrames = BELL_FLASH_FRAMES;
    if (this.bellTollGap === 0) {
      this.playCue('bellTollHit');
      this.bellTollGap = BELL_TOLL_GAP_FRAMES;
    }
  }

  private tickBell(): void {
    if (this.bellRingFrames > 0) this.bellRingFrames--;
    if (this.bellTollGap > 0) this.bellTollGap--;
    if (this.bellFlashFrames > 0) this.bellFlashFrames--;
    if (this.bellCrackFrames > 0) {
      this.bellCrackFrames--;
      if (this.bellCrackFrames === 0) this.deps.ambience.bell.cracked = false;
    }
    // Rung the whole countdown, then in bursts whenever it is struck.
    this.deps.ambience.bell.ringing =
      !this.deps.ambience.bell.cracked && (this.phase === 'imminent' || this.bellRingFrames > 0);
  }

  // ── The damage ledger ─────────────────────────────────────────────────────

  private noteDestroyed(kind: string): void {
    if (this.phase !== 'assault') return;
    if (kind === 'segment') {
      this.segmentsBreached++;
      if (!this.breachCalled) {
        this.breachCalled = true;
        this.deps.mayorBark();
      }
    } else if (kind === 'trebuchet' || kind === 'snare') {
      this.structuresDestroyed++;
    }
  }

  private noteDownedSoldiers(): void {
    for (const soldier of this.deps.downedSoldiers()) this.downedSeen.add(soldier);
  }

  private playCue(cue: VillageCue): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    for (const id of VILLAGE_CUES[cue]) audio.play(id);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** Dust where the dead crumbled or were released, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const effect of this.effects) {
      drawCrumble(
        ctx,
        effect.x - camX,
        effect.y - camY,
        TILE_SIZE,
        effect.age / CRUMBLE_EFFECT_FRAMES,
        effect.dust,
      );
    }
  }

  /**
   * The siege's HUD: the countdown or the wave, the bell's health and the
   * necromancer's, stacked at the top centre under the resource strip; the
   * abandon warning and the outcome banner across the middle of the screen.
   */
  renderHud(ctx: CanvasRenderingContext2D, slot: SiegeHudSlot): void {
    this.renderOutcomeBanner(ctx);
    if (!this.inSiege) return;
    const scale = slot.scale;
    const width = SIEGE_HUD_PANEL_WIDTH * scale;
    const { x, y } = slot;
    const necro = this.activeNecromancer;
    const inAssault = this.phase === 'assault';
    const barRows = (inAssault ? 1 : 0) + (necro !== null ? 1 : 0);
    // Compact: every bar shares the one row under the headline.
    const rows = 1 + (slot.compact ? Math.min(1, barRows) : barRows);
    const height = siegeHudPanelHeight(rows) * scale;
    drawBox(ctx, { x, y, width, height, ...BOX_PRESETS.hudTranslucent });
    const innerX = x + SIEGE_HUD_PANEL_PAD * scale;
    const innerW = width - SIEGE_HUD_PANEL_PAD * 2 * scale;
    let rowY = y + SIEGE_HUD_PANEL_PAD * scale;
    const headline =
      this.phase === 'imminent'
        ? `The dead are coming — ${countdownLabel(this.countdownFrames)}`
        : this.inLull
          ? `Wave ${this.waveNumber + 1} approaches — ${countdownLabel(this.lullFrames)}`
          : `Defend Briar Hollow — Wave ${this.waveNumber}/${ASSAULT_WAVE_COUNT}`;
    drawText(ctx, headline, {
      ...TEXT_PRESETS.danger,
      x: x + width / 2,
      y: rowY,
      size: TEXT_PRESETS.danger.size * scale,
      align: 'center',
      outline: true,
    });
    rowY += SIEGE_HUD_ROW_HEIGHT * scale;
    const bars: Array<{ label: string; value: number; preset: 'hp' | 'boss'; flash: boolean }> = [];
    if (inAssault) {
      bars.push({
        label: 'Hollow Bell',
        value: this.bellFraction,
        preset: 'hp',
        flash: this.bellFlashFrames > 0,
      });
    }
    if (necro !== null) {
      bars.push({
        label: necro.displayName,
        value: necro.hp / necro.maxHp,
        preset: 'boss',
        flash: false,
      });
    }
    const perRow = slot.compact ? Math.max(1, bars.length) : 1;
    const barGap = SIEGE_HUD_PANEL_PAD * scale;
    const barWidth = (innerW - barGap * (perRow - 1)) / perRow;
    bars.forEach((bar, index) => {
      const column = index % perRow;
      const barX = innerX + column * (barWidth + barGap);
      this.renderBar(ctx, bar.label, barX, rowY, barWidth, bar.value, scale, bar.preset);
      if (bar.flash) {
        drawProgressBar(ctx, {
          x: barX,
          y: rowY + HUD_LABEL_HEIGHT * scale,
          width: barWidth,
          height: HUD_BAR_HEIGHT * scale,
          value: 1,
          ...PROGRESS_PRESETS.hp,
          fill: BELL_FLASH_FILL,
          alpha: this.bellFlashFrames / BELL_FLASH_FRAMES,
        });
      }
      if (column === perRow - 1) rowY += SIEGE_HUD_ROW_HEIGHT * scale;
    });
    this.renderAbandonWarning(ctx);
  }

  private renderBar(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    width: number,
    value: number,
    scale: number,
    preset: 'hp' | 'boss',
  ): void {
    drawText(ctx, label, {
      ...TEXT_PRESETS.label,
      x,
      y,
      size: HUD_LABEL_SIZE * scale,
    });
    drawProgressBar(ctx, {
      x,
      y: y + HUD_LABEL_HEIGHT * scale,
      width,
      height: HUD_BAR_HEIGHT * scale,
      value,
      ...PROGRESS_PRESETS[preset],
    });
  }

  private renderAbandonWarning(ctx: CanvasRenderingContext2D): void {
    const seconds = this.abandonSecondsLeft;
    if (seconds === null) return;
    drawText(ctx, `Return to Briar Hollow! ${seconds}`, {
      ...TEXT_PRESETS.title,
      color: TEXT_PRESETS.danger.color,
      x: viewportWidth() / 2,
      y: viewportHeight() * CENTRE_BANNER_HEIGHT_SHARE,
      align: 'center',
    });
  }

  private renderOutcomeBanner(ctx: CanvasRenderingContext2D): void {
    const banner = this.outcomeBanner;
    if (banner === null) return;
    drawText(ctx, banner.text, {
      ...TEXT_PRESETS.title,
      color: TEXT_PRESETS.danger.color,
      x: viewportWidth() / 2,
      y: viewportHeight() * CENTRE_BANNER_HEIGHT_SHARE,
      width: Math.min(OUTCOME_BANNER_MAX_WIDTH, viewportWidth() - BANNER_SIDE_MARGIN * 2),
      align: 'center',
      alpha: Math.min(1, banner.framesLeft / BANNER_FADE_FRAMES),
    });
  }

  // ── Rewind and teardown ───────────────────────────────────────────────────

  /**
   * A death rewind on this same scene. The restored state is never mid-siege,
   * and every body the siege spawned was not there at the checkpoint, so the
   * scene drops them itself; what is left here is the dressing.
   */
  onRewind(): void {
    for (const mob of this.waveOf.keys()) mob.siegeDirective = null;
    // Whatever the rewind kept of a siege it rewound to before is let go:
    // an undead the checkpoint knew of would otherwise stand on, counted
    // against the next siege's cap, a necromancer among them.
    if (!this.inSiege) {
      for (const mob of this.deps.roster.mobs) {
        if (mob.isAlive && mob.siegeCapable !== null) this.release(mob, VANISH_UNSEEN);
      }
    }
    this.resetSiegeCounters();
    this.crumbles.length = 0;
    this.effects.length = 0;
    this.withdraw.walks.clear();
    this.outcomeBanner = null;
    this.bellRingFrames = 0;
    this.bellFlashFrames = 0;
    this.bellCrackFrames = 0;
    this.prewarm.update(null);
    const { ambience } = this.deps;
    ambience.noticeBoard.callToArms = false;
    ambience.bell.ringing = false;
    ambience.bell.cracked = false;
    this.releaseMusic();
    this.disposeFlow();
    if (this.inSiege) this.enterSiegeDressing();
  }

  private disposeFlow(): void {
    this.flow?.dispose();
    this.flow = null;
    this.world = null;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.prewarm.update(null);
    this.disposeFlow();
  }
}

/** A tile's centre, as a share of the tile from its corner. */
const TILE_CENTRE = 0.5;
/** The last wave, as the wave prewarm numbers them. */
const THIRD_WAVE = 3;
const SIEGE_MUSIC_FADE_MS = 1000;
const BELL_FALLEN_BANNER = 'The bell has fallen. The dead withdraw…';
const ABANDONED_BANNER = 'You left Briar Hollow to the dead. They withdraw…';

const HUD_LABEL_SIZE = 10;
const HUD_LABEL_HEIGHT = 12;
const HUD_BAR_HEIGHT = 8;
const BELL_FLASH_FILL = '#ffffff';
/** The abandon warning and the outcome banner sit this far down the screen. */
const CENTRE_BANNER_HEIGHT_SHARE = 0.45;
const OUTCOME_BANNER_MAX_WIDTH = 520;
const BANNER_SIDE_MARGIN = 16;
/** The outcome banner fades out over its last this-many frames. */
const BANNER_FADE_FRAMES = 60;
