/**
 * VillageAssaultSystem — the siege of Briar Hollow, from the warning bell to
 * the last of the dead: the forty-five-second countdown, four waves each up one
 * side of the village (every side once, in an order drawn when the bell
 * rings, and announced before each wave), and how it ends.
 *
 * Every wave raises its undead all at once, and brings along a handful of the
 * crawl's other hostiles, one of Shady's bounty marks fielded weaker than a
 * real bounty, and a fairy — a different one each wave, the healer never, and
 * every earlier wave's fairy with it. Vordrick Boneharrow leads every wave:
 * in the first three he comes with less than his full health and cannot die,
 * fading away when beaten; in the fourth he fights to the end.
 *
 * - **Won** when the necromancer dies in the last wave. Every undead still
 *   standing crumbles, released rather than killed, so the crumbling pays
 *   nothing.
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
import {
  VILLAGE_CUES,
  VILLAGE_SIEGE_MUSIC,
  VILLAGE_VICTORY_MUSIC,
  type VillageCue,
} from '../../audio/villageSoundCues';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import {
  DIFFICULTY_PROFILES,
  type Difficulty,
  type DifficultyProfile,
  applySpawnDifficulty,
} from '../../core/difficultyProfiles';
import type { GameMap } from '../../map/GameMap';
import {
  ASSAULT_LANE_SPAWN_SEARCH_TILES,
  type AssaultLane,
  type AssaultLaneId,
  type BriarHollowSite,
} from '../../map/overworld/briarHollowSite';
import { findNearbyWalkableTile, hasRoomToMove } from '../../map/findWalkableTile';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { RaisedRatkin } from '../../creatures/RaisedRatkin';
import { RisingSkeleton } from '../../creatures/RisingSkeleton';
import { RuinsGhoul } from '../../creatures/RuinsGhoul';
import { SkeletonWarrior } from '../../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../../creatures/SkeletonArcher';
import { GraveBull } from '../../creatures/GraveBull';
import { Necromancer } from '../../creatures/Necromancer';
import { SkyFowl } from '../../creatures/SkyFowl';
import type { Fairy } from '../../creatures/fairies/Fairy';
import { BOUNTY_MAX_BLOW_HP_SHARE } from '../../creatures/mobLevelScaling';
import { createMob } from '../../levels/spawner';
import {
  REGULAR_FAIRY_KINDS,
  createFairy,
  finishFairySpawn,
  type RegularFairyKind,
} from '../../levels/fairySpawner';
import { level3 } from '../../levels/level3';
import {
  enlistInSiege,
  isInsidePalisade,
  isInsidePalisadeTile,
  siegeAdvance,
  siegeCanEngage,
  tileUnder,
} from '../../creatures/siege/siegeCapability';
import { livingAssaultSpawns } from '../../creatures/siege/assaultCaps';
import { INSIDE_PALISADE, palisadeDistanceFor } from '../../creatures/siege/palisadeDistance';
import type { SiegeDirective, SiegeWorld } from '../../creatures/siege/siegeTypes';
import { engageTrebuchet, nearestLiveTrebuchetTo } from '../../creatures/siege/trebuchetThreat';
import {
  ASSAULT_WAVE_NUMBERS,
  AssaultWavePrewarm,
  type AssaultWave,
} from '../../sprites/assaultPrewarm';
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
import { ASSAULT_BOUNTY_KINDS, createBountyMark, type AssaultBountyKind } from './siegeBountyMarks';

// ── The siege's pacing ──────────────────────────────────────────────────────

/** The warning the village gets once the party says it is ready. */
export const IMMINENT_SECONDS = 45;
export const IMMINENT_FRAMES = IMMINENT_SECONDS * UPDATES_PER_SECOND;
/** Four waves, one up each side of the village. */
export const ASSAULT_WAVE_COUNT = 4;
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
 * The most of the waves' own bodies alive at once. A real cap on the living,
 * checked before every spawn: anything over it waits its turn in the queue.
 * Sized over a nightmare wave raised all at once, with a straggler or two left
 * from the wave before. The necromancer's raises are held to his own cap
 * instead (`assaultCaps.ts`).
 */
export const ASSAULT_LIVE_CAP = 40;
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
/** How far round a lane's spawn tile a body may appear: room for a whole wave raised at once. */
const SPAWN_SCATTER_TILES = 5;
/** How far a crowded spawn may be nudged to open ground. */
const SPAWN_SEARCH_TILES = ASSAULT_LANE_SPAWN_SEARCH_TILES;
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

/** What a difficulty does to the siege, on top of the waves as authored. */
export interface AssaultTuning {
  /** Multiplies every wave's undead and other hostiles. */
  readonly bodyScale: number;
  /** The share of a bounty mark's own levelled health it brings. */
  readonly bountyHealthShare: number;
  /** Multiplies every blow a bounty mark lands. */
  readonly bountyDamageScale: number;
  /** Multiplies the necromancer's health share in every wave. */
  readonly necromancerHealthScale: number;
  /**
   * Multiplies every attacker's blow on a structure. A creature's own blow
   * is sized for the open floor, where nothing it hits has a wall's health.
   */
  readonly wallDamageScale: number;
}

/**
 * The waves as authored are normal's; nightmare turns everything up from
 * there, and easy eases it off. A bounty mark is never as hard as its bounty.
 */
export const ASSAULT_TUNING: Readonly<Record<Difficulty, AssaultTuning>> = {
  easy: {
    bodyScale: 0.75,
    bountyHealthShare: 0.35,
    bountyDamageScale: 0.5,
    necromancerHealthScale: 0.8,
    wallDamageScale: 2,
  },
  normal: {
    bodyScale: 1,
    bountyHealthShare: 0.5,
    bountyDamageScale: 0.6,
    necromancerHealthScale: 1,
    wallDamageScale: 3,
  },
  hard: {
    bodyScale: 1.5,
    bountyHealthShare: 0.75,
    bountyDamageScale: 0.8,
    necromancerHealthScale: 1.25,
    wallDamageScale: 4.5,
  },
};

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Which difficulty a profile is; normal for one that is none of them. */
export function assaultDifficulty(profile: DifficultyProfile): Difficulty {
  return DIFFICULTIES.find((difficulty) => DIFFICULTY_PROFILES[difficulty] === profile) ?? 'normal';
}

/**
 * How long one attacker keeps the siege's voice before the one nearest the
 * party may take it over: long enough that its swing, cry and death are
 * heard whole, short enough that the fight in front of the player is the
 * one they hear.
 */
const SIEGE_VOICE_HOLD_SECONDS = 2;
const SIEGE_VOICE_HOLD_FRAMES = SIEGE_VOICE_HOLD_SECONDS * UPDATES_PER_SECOND;

/** The fewest undead any wave raises, whatever the difficulty takes off it. */
export const MIN_UNDEAD_PER_WAVE = 10;
/**
 * How much harder a bounty mark strikes a wall than a common body of its
 * kind: a mark's swing is sized to fell a crawler, not to batter stone.
 */
const BOUNTY_MARK_STRUCTURE_SCALE = 4;

// ── The waves ───────────────────────────────────────────────────────────────

/** The necromancer's own army: the undead every wave raises. */
export type AssaultUndeadKind =
  'raised_ratkin' | 'ruins_ghoul' | 'skeleton_warrior' | 'skeleton_archer' | 'grave_bull';

/**
 * The crawl's other hostiles he drives before him, by spawn-registry key:
 * across the four waves, every regular enemy there is but the spiders and the
 * grubs. The rock golems come with the last.
 */
export type AssaultHostileKind =
  | 'goblin'
  | 'goblin_archer'
  | 'rat'
  | 'cockroach'
  | 'sky_fowl'
  | 'troglodyte'
  | 'llama'
  | 'circus_lemur'
  | 'fat_clown'
  | 'stilt_clown'
  | 'tuskling'
  | 'mold_lion'
  | 'krasue'
  | 'city_elf_cultist'
  | 'mantis'
  | 'bugaboo'
  | 'rock_golem';

/** Which kind of body a wave spawns. */
export type AssaultSpawnKind = AssaultUndeadKind | AssaultHostileKind;

export interface AssaultWaveSpec {
  /** Raised all at once as the wave begins; never fewer than {@link MIN_UNDEAD_PER_WAVE}. */
  readonly undead: Readonly<Partial<Record<AssaultUndeadKind, number>>>;
  readonly hostiles: Readonly<Partial<Record<AssaultHostileKind, number>>>;
  /**
   * The share of his full health Vordrick comes with. Below 1 he cannot be
   * killed, and fades away when beaten; at 1 his death wins the siege.
   */
  readonly necromancerHealthShare: number;
}

/** Each wave's base counts, before the difficulty's {@link AssaultTuning.bodyScale}. */
export const ASSAULT_WAVES: readonly AssaultWaveSpec[] = [
  {
    undead: { raised_ratkin: 5, ruins_ghoul: 2, skeleton_warrior: 2, skeleton_archer: 1 },
    hostiles: { goblin: 2, goblin_archer: 1, rat: 2, cockroach: 2, sky_fowl: 1 },
    necromancerHealthShare: 0.4,
  },
  {
    undead: {
      raised_ratkin: 4,
      ruins_ghoul: 2,
      skeleton_warrior: 2,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: {
      troglodyte: 1,
      llama: 1,
      circus_lemur: 1,
      fat_clown: 1,
      stilt_clown: 1,
      tuskling: 2,
    },
    necromancerHealthShare: 0.55,
  },
  {
    undead: {
      raised_ratkin: 4,
      ruins_ghoul: 3,
      skeleton_warrior: 2,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: { mold_lion: 1, krasue: 2, city_elf_cultist: 1, mantis: 2, bugaboo: 1 },
    necromancerHealthShare: 0.7,
  },
  {
    undead: {
      raised_ratkin: 5,
      ruins_ghoul: 3,
      skeleton_warrior: 3,
      skeleton_archer: 2,
      grave_bull: 1,
    },
    hostiles: { rock_golem: 2, goblin: 2, krasue: 1, troglodyte: 1, stilt_clown: 1 },
    necromancerHealthShare: 1,
  },
];

/** The wave at `index` (from 0), or null past the last. */
function waveSpec(index: number): AssaultWaveSpec | null {
  return index >= 0 && index < ASSAULT_WAVES.length ? ASSAULT_WAVES[index] : null;
}

const UNDEAD_ORDER: readonly AssaultUndeadKind[] = [
  'raised_ratkin',
  'ruins_ghoul',
  'skeleton_warrior',
  'skeleton_archer',
  'grave_bull',
];

const HOSTILE_ORDER: readonly AssaultHostileKind[] = [
  'goblin',
  'goblin_archer',
  'rat',
  'cockroach',
  'sky_fowl',
  'troglodyte',
  'llama',
  'circus_lemur',
  'fat_clown',
  'stilt_clown',
  'tuskling',
  'mold_lion',
  'krasue',
  'city_elf_cultist',
  'mantis',
  'bugaboo',
  'rock_golem',
];

/** The four sides, in the order the HUD names them. */
export const ASSAULT_SIDES: readonly AssaultLaneId[] = ['north', 'south', 'east', 'west'];

const SIDE_NAMES: Readonly<Record<AssaultLaneId, string>> = {
  north: 'North',
  south: 'South',
  east: 'East',
  west: 'West',
};

/** The banner that names the side a wave is coming from. */
export function attackSideBanner(side: AssaultLaneId): string {
  return `Attack coming from the ${SIDE_NAMES[side]}`;
}

/**
 * What one siege draws when the bell rings: which side each wave comes from,
 * which bounty mark it brings, and the order its fairies join. Every side and
 * every regular fairy kind once each; four of the five marks.
 */
export interface SiegeCampaign {
  readonly sides: readonly AssaultLaneId[];
  readonly bounties: readonly AssaultBountyKind[];
  readonly fairies: readonly RegularFairyKind[];
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Draws a fresh {@link SiegeCampaign}. */
export function planSiegeCampaign(random: () => number): SiegeCampaign {
  return {
    sides: shuffled(ASSAULT_SIDES, random),
    bounties: shuffled(ASSAULT_BOUNTY_KINDS, random).slice(0, ASSAULT_WAVE_COUNT),
    fairies: shuffled(REGULAR_FAIRY_KINDS, random),
  };
}

/**
 * Each village's current draw, keyed by its state, which is threaded by
 * reference through every scene rebuild: the system is built afresh on every
 * door visit, and a countdown resumed after one must still come from the side
 * it announced. Never saved — no save or checkpoint records a siege in
 * progress, and the bell rung again draws anew.
 */
const campaigns = new WeakMap<BriarHollowState, SiegeCampaign>();

function campaignFor(state: BriarHollowState, random: () => number): SiegeCampaign {
  const existing = campaigns.get(state);
  if (existing !== undefined) return existing;
  const drawn = planSiegeCampaign(random);
  campaigns.set(state, drawn);
  return drawn;
}

/** One body still to come, and when. */
interface PendingSpawn {
  readonly kind: AssaultSpawnKind;
  readonly lane: AssaultLane;
  readonly dueFrame: number;
  /** The wave it belongs to, which it keeps if it is still queued when the next wave begins. */
  readonly wave: number;
}

/**
 * One of a wave's leaders still to appear: Vordrick, the wave's bounty mark,
 * or a fairy. Not held by the live cap, and not counted in the wave's bodies.
 */
type Arrival =
  | { readonly kind: 'necromancer' }
  | { readonly kind: 'bounty'; readonly mark: AssaultBountyKind }
  | { readonly kind: 'fairy'; readonly fairy: RegularFairyKind };

interface PendingArrival {
  readonly arrival: Arrival;
  readonly lane: AssaultLane;
  waitedFrames: number;
}

function isUndeadKind(kind: AssaultSpawnKind): kind is AssaultUndeadKind {
  return UNDEAD_ORDER.some((undead) => undead === kind);
}

function createUndead(kind: AssaultUndeadKind, tileX: number, tileY: number): Mob {
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

function createSpawn(kind: AssaultSpawnKind, tileX: number, tileY: number, map: GameMap): Mob {
  if (isUndeadKind(kind)) return createUndead(kind, tileX, tileY);
  const mob = createMob(kind, tileX, tileY, map);
  // A town bird is calm until struck; one the necromancer drives is not.
  if (mob instanceof SkyFowl) mob.provoke();
  return mob;
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
    // batters anything (`structureDamageMultiplier` of 0). Only one on the
    // mob's own side of the ring counts: the palisade does not block sight,
    // so an engine just inside the wall would otherwise hold every attacker
    // outside it pressed against the stone, walking at an engine it cannot
    // reach instead of battering the wall between them.
    if (siege.structureDamageMultiplier > 0) {
      const trebuchet = nearestLiveTrebuchetTo(
        mob,
        siege.world.defense,
        SIEGE_DEFENDER_NOTICE_TILES * TILE_SIZE,
      );
      if (
        trebuchet !== null &&
        trebuchet.distance < defenderDistance &&
        this.onSameSide(mob, trebuchet) &&
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

  /** Whether a point in the world stands on the same side of the ring as the mob. */
  private onSameSide(mob: Mob, point: { readonly x: number; readonly y: number }): boolean {
    const pointInside = isInsidePalisadeTile(
      this.site,
      Math.floor(point.x / TILE_SIZE),
      Math.floor(point.y / TILE_SIZE),
    );
    return isInsidePalisade(this.site, mob) === pointInside;
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

  private campaign: SiegeCampaign;
  private pending: PendingSpawn[] = [];
  private arrivals: PendingArrival[] = [];
  private readonly waveOf = new Map<Mob, number>();
  private readonly laneOf = new Map<Mob, AssaultLane>();
  /** Every fairy the siege has put out, alive or not, by kind: the next wave calls back the fallen. */
  private readonly fairies = new Map<RegularFairyKind, Fairy>();
  private wavePlanned = 0;
  private waveFrames = 0;
  private lullFrames = 0;
  /** Whether the current wave has put its first body out yet. */
  private waveBodiesOut = false;
  private necromancer: Necromancer | null = null;
  private necromancerOut = false;
  /** The bounty mark of the current or an earlier wave, while one still stands. */
  private bountyMark: Mob | null = null;
  /** How long the spawn at the head of the queue has waited for a place. */
  private headSpawnWaitFrames = 0;
  /** The "Attack coming from…" banner across the middle of the screen, while it shows. */
  private sideBanner: { text: string; framesLeft: number } | null = null;
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
  /** Frames the victory track still owns the music; the track loops, so the village music must cut in as it ends. */
  private victoryMusicFrames = 0;
  private readonly effects: CrumbleEffect[] = [];
  /** The one attacker whose sounds play; every other attacker is silent. */
  private voice: Mob | null = null;
  private voiceHeldFrames = 0;
  /**
   * The audio manager's hearing rule while the waves are in: anything that
   * is not the siege's own is heard as ever, the siege's attackers only
   * through their voice. The voice is asked first, so the one that just died
   * is still heard dying.
   */
  private readonly hearing = (mob: Mob): boolean =>
    mob === this.voice || !this.isSiegeAttacker(mob);

  /** Every body the waves have spawned, for the gates. */
  spawnedTotal = 0;
  /** The most assault bodies ever alive at once this siege, for the live-cap gate. */
  peakLiving = 0;

  constructor(private readonly deps: VillageAssaultSystemDeps) {
    this.random = deps.random ?? Math.random;
    this.campaign = campaignFor(deps.state, this.random);
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

  /** The side the wave `index` (from 0) attacks from. */
  sideOfWave(index: number): AssaultLaneId {
    const sides = this.campaign.sides;
    return sides[Math.max(0, Math.min(sides.length - 1, index))];
  }

  /**
   * The side the coming wave will attack from, through the countdown and each
   * lull, and the side the wave under way is attacking from; null outside the
   * siege.
   */
  get attackSide(): AssaultLaneId | null {
    if (this.phase === 'imminent') return this.sideOfWave(0);
    if (this.phase !== 'assault') return null;
    const index = this.deps.state.quest.assaultWaveIndex ?? 0;
    return this.sideOfWave(this.inLull ? index + 1 : index);
  }

  /** The siege's draw: each wave's side, bounty mark and fairy. */
  get siegeCampaign(): SiegeCampaign {
    return this.campaign;
  }

  /** The bounty mark in the field, while one stands. */
  get activeBountyMark(): Mob | null {
    const mark = this.bountyMark;
    return mark?.isAlive === true && mark.isHostile ? mark : null;
  }

  /** The siege's fairies still in the air. */
  get livingFairies(): Fairy[] {
    return [...this.fairies.values()].filter((fairy) => fairy.isAlive);
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

  /** Whether one of the wave's leaders is still waiting for somewhere to appear. */
  get arrivalWaiting(): boolean {
    return this.arrivals.length > 0;
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

  /** "We're ready": the bell rings and the countdown starts. */
  begin(): void {
    if (this.phase !== 'fortifying') return;
    this.resetSiegeCounters();
    this.campaign = planSiegeCampaign(this.random);
    campaigns.set(this.deps.state, this.campaign);
    this.announceSide(0);
    this.deps.state.quest.imminentCountdownFrames = IMMINENT_FRAMES;
    this.deps.state.quest.assaultWaveIndex = null;
    this.deps.defense.restoreBell();
    this.deps.setPhase('imminent');
    this.enterSiegeDressing();
    this.playCue('bellAlarm');
  }

  private resetSiegeCounters(): void {
    this.pending = [];
    this.arrivals = [];
    this.waveOf.clear();
    this.laneOf.clear();
    this.fairies.clear();
    this.waveBodiesOut = false;
    this.necromancer = null;
    this.necromancerOut = false;
    this.bountyMark = null;
    this.headSpawnWaitFrames = 0;
    this.sideBanner = null;
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
    this.victoryMusicFrames = 0;
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
    if (this.sideBanner !== null) {
      this.sideBanner.framesLeft--;
      if (this.sideBanner.framesLeft <= 0) this.sideBanner = null;
    }
    this.tickWithdrawals();
    this.tickCrumbles();
    this.tickVictoryMusic();

    if (this.phase === 'imminent') this.updateImminent(frame);
    else if (this.phase === 'assault') this.updateAssault(frame);
    else this.prewarm.update(null);
    this.updateVoice(frame);
  }

  /**
   * Hands the siege's voice to the attacker nearest the active crawler
   * whenever the last holder falls silent, dies, or has had its turn.
   */
  private updateVoice(frame: VillageAssaultFrame): void {
    const underAssault = this.phase === 'assault';
    this.deps.audio?.setCreatureHearing(underAssault ? this.hearing : null);
    if (!underAssault) {
      this.voice = null;
      return;
    }
    if (this.voiceHeldFrames > 0) this.voiceHeldFrames--;
    const current = this.voice;
    const holding =
      current !== null &&
      current.isAlive &&
      this.isSiegeAttacker(current) &&
      this.voiceHeldFrames > 0;
    if (holding) return;
    this.voice = this.nearestAttackerTo(frame.active);
    this.voiceHeldFrames = SIEGE_VOICE_HOLD_FRAMES;
  }

  /** Whether a mob is one of the siege's own: a wave's body, a raise of the necromancer's, or a fairy. */
  private isSiegeAttacker(mob: Mob): boolean {
    if (!mob.isHostile) return false;
    if (mob.siegeCapable !== null || this.waveOf.has(mob)) return true;
    return [...this.fairies.values()].some((fairy) => fairy === mob);
  }

  private nearestAttackerTo(point: { readonly x: number; readonly y: number }): Mob | null {
    let nearest: Mob | null = null;
    let nearestDistance = Infinity;
    for (const mob of this.deps.roster.mobs) {
      if (!mob.isAlive || !this.isSiegeAttacker(mob)) continue;
      const distance = Math.hypot(mob.x - point.x, mob.y - point.y);
      if (distance >= nearestDistance) continue;
      nearest = mob;
      nearestDistance = distance;
    }
    return nearest;
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
    this.waveBodiesOut = false;
    const lane = this.laneFor(this.sideOfWave(index));
    if (lane === null) return;
    // Anything the live cap held back from the wave before still comes, first.
    const leftovers = this.pending.map((spawn) => ({ ...spawn, dueFrame: 0 }));
    const planned = this.planWave(spec, index, lane);
    this.pending = [...leftovers, ...planned];
    this.wavePlanned = planned.length;
    this.arrivals = this.planArrivals(index, lane);
    this.deps.bus.emit('villageAssaultWave', { index });
    this.playCue('necroWarHorn');
    this.spawnArrivals();
  }

  /** The assault lane on `side`, or null on a site that has none there. */
  private laneFor(side: AssaultLaneId): AssaultLane | null {
    return this.deps.site.assaultLanes.find((lane) => lane.id === side) ?? null;
  }

  /** The wave's bodies, scaled for the difficulty and raised all at once up its lane. */
  private planWave(spec: AssaultWaveSpec, wave: number, lane: AssaultLane): PendingSpawn[] {
    const tuning = ASSAULT_TUNING[assaultDifficulty(this.deps.difficulty())];
    const scaledCount = (base: number | undefined): number =>
      base === undefined || base <= 0 ? 0 : Math.max(1, Math.round(base * tuning.bodyScale));
    const undeadCounts = new Map<AssaultUndeadKind, number>();
    for (const kind of UNDEAD_ORDER) undeadCounts.set(kind, scaledCount(spec.undead[kind]));
    let undeadTotal = [...undeadCounts.values()].reduce((sum, count) => sum + count, 0);
    // The shortfall is made up in raised ratkin, the army's rank and file.
    if (undeadTotal < MIN_UNDEAD_PER_WAVE) {
      const shortfall = MIN_UNDEAD_PER_WAVE - undeadTotal;
      undeadCounts.set('raised_ratkin', (undeadCounts.get('raised_ratkin') ?? 0) + shortfall);
      undeadTotal = MIN_UNDEAD_PER_WAVE;
    }
    const counts = new Map<AssaultSpawnKind, number>(undeadCounts);
    for (const kind of HOSTILE_ORDER) {
      const count = scaledCount(spec.hostiles[kind]);
      if (count > 0) counts.set(kind, count);
    }
    // Round-robin through the kinds, so if the live cap holds some back it
    // holds back a mix rather than every one of the last kind.
    const kinds: readonly AssaultSpawnKind[] = [...UNDEAD_ORDER, ...HOSTILE_ORDER];
    const order: AssaultSpawnKind[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const kind of kinds) {
        const left = counts.get(kind) ?? 0;
        if (left <= 0) continue;
        order.push(kind);
        counts.set(kind, left - 1);
        added = true;
      }
    }
    return order.map((kind) => ({ kind, lane, dueFrame: 0, wave }));
  }

  /**
   * The wave's leaders: Vordrick, its bounty mark, its new fairy, and every
   * earlier wave's fairy that has fallen since — so from the last wave on,
   * one of every kind is out.
   */
  private planArrivals(index: number, lane: AssaultLane): PendingArrival[] {
    const arrivals: Arrival[] = [{ kind: 'necromancer' }];
    const { bounties } = this.campaign;
    if (index < bounties.length) arrivals.push({ kind: 'bounty', mark: bounties[index] });
    for (const fairy of this.campaign.fairies.slice(0, index + 1)) {
      if (this.fairies.get(fairy)?.isAlive === true) continue;
      arrivals.push({ kind: 'fairy', fairy });
    }
    return arrivals.map((arrival) => ({ arrival, lane, waitedFrames: 0 }));
  }

  private updateAssault(frame: VillageAssaultFrame): void {
    const quest = this.deps.state.quest;
    const index = quest.assaultWaveIndex ?? 0;
    const isLastWave = index >= ASSAULT_WAVE_COUNT - 1;
    this.noteDownedSoldiers();

    const necro = this.necromancer;
    if (necro !== null && !necro.isAlive && this.necromancerOut) {
      this.win();
      return;
    }
    if (this.deps.defense.bellCracked) {
      this.lose(BELL_FALLEN_BANNER);
      return;
    }
    if (this.checkAbandon(frame)) return;
    this.tickNecromancerRetreat();

    if (this.lullFrames > 0) {
      this.prewarm.update(this.prewarmWaveFor(index + 1));
      this.lullFrames--;
      if (this.lullFrames === 0) this.startWave(index + 1);
      return;
    }

    this.waveFrames++;
    this.spawnArrivals();
    this.spawnDue();
    this.peakLiving = Math.max(this.peakLiving, livingAssaultSpawns(this.deps.roster.mobs));
    this.prewarm.update(this.waveStillArriving() ? this.prewarmWaveFor(index) : null);

    if (isLastWave) return;
    const remaining = this.remainingInWave(index);
    const fewLeft = remaining <= Math.floor(this.wavePlanned * WAVE_ADVANCE_REMAINING_SHARE);
    if (fewLeft || this.waveFrames >= WAVE_MAX_FRAMES) this.beginLull(index + 1);
  }

  /**
   * The breather before wave `next` (from 0): its side is announced, and a
   * Vordrick still in the field fades away — he leads every wave, and
   * returns with the next.
   */
  private beginLull(next: number): void {
    // The next wave's lead-in starts here; its rows are warmed through the lull from the next update.
    this.lullFrames = WAVE_LULL_FRAMES;
    this.announceSide(next);
    this.necromancer?.beginFadingAway();
  }

  private announceSide(wave: number): void {
    this.sideBanner = {
      text: attackSideBanner(this.sideOfWave(wave)),
      framesLeft: SIDE_BANNER_FRAMES,
    };
  }

  /**
   * A Vordrick who may not die fades away once he is beaten, and is taken off
   * the field when the fade has run: no death, no kill paid, no win.
   */
  private tickNecromancerRetreat(): void {
    const necro = this.necromancer;
    if (!necro?.isAlive) return;
    if (necro.isBeaten) necro.beginFadingAway();
    if (!necro.hasFadedAway) return;
    this.release(necro, VANISH_IN_A_WISP);
    this.necromancer = null;
    this.necromancerOut = false;
  }

  private prewarmWaveFor(index: number): AssaultWave | null {
    const wave = index + 1;
    return ASSAULT_WAVE_NUMBERS.find((number) => number === wave) ?? null;
  }

  /**
   * Whether the wave's lead-in is still running: its bodies or its leaders
   * have not all appeared. After that the arrivals draw their own rows, and
   * warming them only competes with the fight.
   */
  private waveStillArriving(): boolean {
    return !this.waveBodiesOut || this.arrivals.length > 0;
  }

  /**
   * The wave's bodies not yet beaten: still to come, or alive and on the
   * enemy's side. Vordrick is not one of them: he fades when the lull begins.
   */
  private remainingInWave(index: number): number {
    let remaining = this.pending.filter((spawn) => spawn.wave === index).length;
    for (const [mob, wave] of this.waveOf) {
      if (mob instanceof Necromancer) continue;
      // A converted ally no longer counts: it fights for the village now.
      if (wave === index && mob.isAlive && mob.isHostile) remaining++;
    }
    return remaining;
  }

  private spawnDue(): void {
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

  /** Puts out every leader of the wave that has somewhere to appear; the rest wait. */
  private spawnArrivals(): void {
    const wave = this.deps.state.quest.assaultWaveIndex ?? 0;
    this.arrivals = this.arrivals.filter((pending) => {
      const place = this.placeFor([pending.lane], pending.waitedFrames);
      if (place === null) {
        pending.waitedFrames++;
        return true;
      }
      this.bringOut(pending.arrival, place.lane, place.tile, wave);
      return false;
    });
  }

  private bringOut(
    arrival: Arrival,
    lane: AssaultLane,
    tile: { x: number; y: number },
    wave: number,
  ): void {
    switch (arrival.kind) {
      case 'necromancer':
        this.spawnNecromancer(lane, tile, wave);
        return;
      case 'bounty':
        this.spawnBountyMark(arrival.mark, lane, tile, wave);
        return;
      case 'fairy':
        this.spawnFairy(arrival.fairy, tile);
        return;
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
        // Room to move, not just walkable: a gap between trunks is walkable
        // ground a body comes up in and never leaves.
        (x, y) =>
          gameMap.isWalkableForHostile(x, y) && hasRoomToMove(gameMap, x, y) && this.hasWayIn(x, y),
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
   * `own` first, then the lane the wave now under way comes by — for a spawn
   * held over from an earlier wave, which may take the new wave's lane.
   */
  private lanesFor(own: AssaultLane): AssaultLane[] {
    const current = this.laneFor(this.sideOfWave(this.deps.state.quest.assaultWaveIndex ?? 0));
    return current === null || current.id === own.id ? [own] : [own, current];
  }

  /**
   * Whether the flow field has a way from the tile to the bell: the flank
   * lanes' spawns stand out in the wilderness, where a pocket of open ground
   * can be closed in by trees.
   */
  private hasWayIn(tileX: number, tileY: number): boolean {
    const flow = this.flow;
    return flow === null || Number.isFinite(flow.costAt({ x: tileX, y: tileY }));
  }

  private isUnseen(tile: { x: number; y: number }, tilesFromParty: number): boolean {
    if (visibleWorldView() === null) return tilesFromParty > SPAWN_UNSEEN_TILES;
    const outsideByPx = -SPAWN_OFFSCREEN_MARGIN_TILES * TILE_SIZE;
    const centreX = (tile.x + TILE_CENTRE_OFFSET) * TILE_SIZE;
    const centreY = (tile.y + TILE_CENTRE_OFFSET) * TILE_SIZE;
    return !isWorldPointInView(centreX, centreY, outsideByPx);
  }

  /**
   * Levels, stages and enlists one assault body, and joins it to the scene.
   * `levelled` is false for a body the caller has levelled and scaled itself.
   */
  private enlist(
    mob: Mob,
    lane: AssaultLane,
    wave: number,
    options: { readonly levelled?: boolean; readonly structureScale?: number } = {},
  ): void {
    const world = this.ensureFlow();
    if (options.levelled !== true) mob.applyMobLevel(this.deps.waveLevel());
    applySpawnDifficulty(mob, this.deps.difficulty());
    const tuning = ASSAULT_TUNING[assaultDifficulty(this.deps.difficulty())];
    enlistInSiege(
      mob,
      world,
      Math.floor(this.random() * SPREAD_SEED_RANGE),
      (options.structureScale ?? 1) * tuning.wallDamageScale,
    );
    mob.ignoresTownSafeZone = true;
    mob.siegeDirective = this.march;
    this.deps.roster.add(mob);
    this.waveOf.set(mob, wave);
    this.laneOf.set(mob, lane);
    this.spawnedTotal++;
  }

  private spawn(
    kind: AssaultSpawnKind,
    lane: AssaultLane,
    tile: { x: number; y: number },
    wave: number,
  ): void {
    const mob = createSpawn(kind, tile.x, tile.y, this.deps.gameMap);
    // They claw their way up out of the ground at the lane's head: the row
    // each wave's rows are warmed for.
    if (mob instanceof RaisedRatkin) mob.beginRising();
    this.enlist(mob, lane, wave);
    this.waveBodiesOut = true;
  }

  private spawnNecromancer(lane: AssaultLane, tile: { x: number; y: number }, wave: number): void {
    const spec = waveSpec(wave);
    const tuning = ASSAULT_TUNING[assaultDifficulty(this.deps.difficulty())];
    const healthShare = (spec?.necromancerHealthShare ?? 1) * tuning.necromancerHealthScale;
    const necro = new Necromancer(tile.x, tile.y, TILE_SIZE);
    necro.applyMobLevel(this.deps.waveLevel());
    necro.scaleMaxHp(healthShare);
    necro.cannotBeKilled = wave < ASSAULT_WAVE_COUNT - 1;
    this.enlist(necro, lane, wave, { levelled: true });
    this.necromancer = necro;
    this.necromancerOut = true;
    // His name card once, when he first comes; after that he is expected.
    if (wave === 0) this.deps.bossIntro(necro.displayName, NECROMANCER_INTRO_COLOR);
    this.playCue('necromancerArrival');
  }

  /** The wave's bounty mark: its own fight, on weaker terms than its bounty. */
  private spawnBountyMark(
    kind: AssaultBountyKind,
    lane: AssaultLane,
    tile: { x: number; y: number },
    wave: number,
  ): void {
    const tuning = ASSAULT_TUNING[assaultDifficulty(this.deps.difficulty())];
    const mark = createBountyMark(kind, tile.x, tile.y, this.deps.gameMap);
    mark.applyMobLevel(this.deps.waveLevel());
    mark.scaleMaxHp(tuning.bountyHealthShare);
    mark.outgoingDamageScale = tuning.bountyDamageScale;
    mark.blowCapShareOfTargetHp = BOUNTY_MAX_BLOW_HP_SHARE;
    mark.isBoss = true;
    mark.immuneToConfusion = true;
    this.enlist(mark, lane, wave, {
      levelled: true,
      structureScale: BOUNTY_MARK_STRUCTURE_SCALE,
    });
    this.bountyMark = mark;
  }

  /**
   * A fairy for the siege: not enlisted — it marches nowhere and strikes no
   * wall — but flies with the wave it came up with, and stays out until the
   * siege ends.
   */
  private spawnFairy(kind: RegularFairyKind, tile: { x: number; y: number }): void {
    const { gameMap } = this.deps;
    const fairy = createFairy(kind, tile.x, tile.y, gameMap);
    if (fairy === null) return;
    const profile = this.deps.difficulty();
    finishFairySpawn(
      fairy,
      this.deps.waveLevel(),
      level3.levelledCurve,
      profile,
      assaultDifficulty(profile),
      level3.floorNumber,
    );
    fairy.ignoresTownSafeZone = true;
    this.deps.roster.add(fairy);
    this.fairies.set(kind, fairy);
    this.spawnedTotal++;
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

  /** The siege's fairies still flying, which leave with the dead however it ends. */
  private releaseFairies(): void {
    for (const fairy of this.livingFairies) this.release(fairy, VANISH_IN_A_WISP);
  }

  /** Vordrick Boneharrow is dead: the rest of the dead crumble, and the village is saved. */
  private win(): void {
    this.recordSummary();
    this.deps.state.quest.assaultWaveIndex = null;
    this.pending = [];
    this.arrivals = [];
    this.lullFrames = 0;
    this.sideBanner = null;
    this.releaseFairies();
    const living = this.livingSiegeMobs();
    for (const mob of living) {
      // Beaten: it stands where it is until it falls, and fights no more.
      mob.abandonStructureStrike();
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
    this.startVictoryMusic();
  }

  private startVictoryMusic(): void {
    const music = this.deps.music();
    if (music === null) return;
    music.battleMusicActive = true;
    this.victoryMusicFrames = VICTORY_MUSIC_FRAMES;
    this.deps.audio?.playMusic(VILLAGE_VICTORY_MUSIC, { fadeInMs: SIEGE_MUSIC_FADE_MS });
  }

  private tickVictoryMusic(): void {
    if (this.victoryMusicFrames <= 0) return;
    this.victoryMusicFrames--;
    if (this.victoryMusicFrames === 0) this.releaseMusic();
  }

  /** The bell fell, or the party left: the dead walk back out, and the walls stay as they are. */
  private lose(banner: string): void {
    this.recordSummary();
    this.deps.state.quest.assaultWaveIndex = null;
    this.pending = [];
    this.arrivals = [];
    this.lullFrames = 0;
    this.sideBanner = null;
    this.releaseFairies();
    const fell = this.deps.defense.bellCracked;
    for (const mob of this.livingSiegeMobs()) {
      // A swing already under way would land on the bell the siege's end
      // just mended.
      mob.abandonStructureStrike();
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
    const mark = this.activeBountyMark;
    const inAssault = this.phase === 'assault';
    const barRows = (inAssault ? 1 : 0) + (necro !== null ? 1 : 0) + (mark !== null ? 1 : 0);
    // Compact: every bar shares the one row under the headline.
    const rows = 1 + (slot.compact ? Math.min(1, barRows) : barRows);
    const height = siegeHudPanelHeight(rows) * scale;
    drawBox(ctx, { x, y, width, height, ...BOX_PRESETS.hudTranslucent });
    const innerX = x + SIEGE_HUD_PANEL_PAD * scale;
    const innerW = width - SIEGE_HUD_PANEL_PAD * 2 * scale;
    let rowY = y + SIEGE_HUD_PANEL_PAD * scale;
    const side = this.attackSide;
    const sideName = side === null ? '' : SIDE_NAMES[side];
    const headline =
      this.phase === 'imminent'
        ? `The dead are coming from the ${sideName} — ${countdownLabel(this.countdownFrames)}`
        : this.inLull
          ? `Wave ${this.waveNumber + 1} from the ${sideName} — ${countdownLabel(this.lullFrames)}`
          : `Defend Briar Hollow — Wave ${this.waveNumber}/${ASSAULT_WAVE_COUNT} (${sideName})`;
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
    if (mark !== null) {
      bars.push({
        label: mark.displayName,
        value: mark.hp / mark.maxHp,
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
    this.renderSideBanner(ctx);
  }

  private renderSideBanner(ctx: CanvasRenderingContext2D): void {
    const banner = this.sideBanner;
    // The abandon warning holds the same place on screen, and matters more.
    if (banner === null || this.abandonSecondsLeft !== null) return;
    drawText(ctx, banner.text, {
      ...TEXT_PRESETS.title,
      color: TEXT_PRESETS.danger.color,
      x: viewportWidth() / 2,
      y: viewportHeight() * CENTRE_BANNER_HEIGHT_SHARE,
      width: Math.min(OUTCOME_BANNER_MAX_WIDTH, viewportWidth() - BANNER_SIDE_MARGIN * 2),
      align: 'center',
      outline: true,
      alpha: Math.min(1, banner.framesLeft / BANNER_FADE_FRAMES),
    });
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
      for (const fairy of this.livingFairies) this.release(fairy, VANISH_UNSEEN);
    }
    this.resetSiegeCounters();
    this.crumbles.length = 0;
    if (this.victoryMusicFrames > 0) {
      this.victoryMusicFrames = 0;
      this.releaseMusic();
    }
    this.effects.length = 0;
    this.withdraw.walks.clear();
    this.outcomeBanner = null;
    this.sideBanner = null;
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
    this.deps.audio?.setCreatureHearing(null);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.prewarm.update(null);
    this.disposeFlow();
  }
}

/** A tile's centre, as a share of the tile from its corner. */
const TILE_CENTRE = 0.5;
/** How long the "Attack coming from…" banner stays up at the start of a countdown or a lull. */
const SIDE_BANNER_SECONDS = 6;
const SIDE_BANNER_FRAMES = SIDE_BANNER_SECONDS * UPDATES_PER_SECOND;
const SIEGE_MUSIC_FADE_MS = 1000;
/** The victory track is 12 s long and plays once through before the village's own music returns. */
const VICTORY_MUSIC_SECONDS = 12;
const VICTORY_MUSIC_FRAMES = VICTORY_MUSIC_SECONDS * UPDATES_PER_SECOND;
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
