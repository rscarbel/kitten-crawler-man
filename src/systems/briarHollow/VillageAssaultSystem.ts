/**
 * VillageAssaultSystem — the siege of Briar Hollow, from the warning bell to
 * the last of the dead: the forty-five-second countdown, four waves each up one
 * side of the village (every side once, in an order drawn when the bell
 * rings, and announced before each wave), and how it ends.
 *
 * A wave's own bodies rise one after another up its lane rather than all at
 * once, spaced out so a single blow never catches the whole roster. From the
 * second wave on, a wave is itself a run of mini-waves: every earlier wave's
 * roster in order, each fought down to a fraction of its own count before the
 * next rises, and the wave's own roster — with Vordrick, its bounty mark and
 * its fairy — only leading the last of them. Vordrick Boneharrow leads every
 * wave this way: in the first three he comes with less than his full health
 * and cannot die, fading away when beaten; in the fourth he fights to the end.
 *
 * - **Won** when the necromancer dies in the last wave. Every undead still
 *   standing crumbles, released rather than killed, so the crumbling pays
 *   nothing.
 * - **Lost** when the Hollow Bell is beaten to nothing, or when the active
 *   crawler stays away from the village too long. The dead walk back up their
 *   lanes and are released out of sight; the walls stay as broken as they
 *   are, for the party to rebuild and try again. Losing to the bell itself
 *   falling leaves the tower broken — no alarm, no save point — until the
 *   party repairs it and the questline can call another siege.
 *
 * There is no death and no reset in a lost siege: it is a setback, not a
 * game over.
 *
 * Nothing here is durable. The phase, the countdown and the bell live in the
 * quest state, and a save or a checkpoint never records a siege in progress
 * (`captureBriarHollowState`), so a rewind or a reload lands before it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { PLACED_MAX_PAN, type AudioManager, type PlayOptions } from '../../audio/AudioManager';
import {
  VILLAGE_CUES,
  VILLAGE_SIEGE_MUSIC,
  VILLAGE_VICTORY_STING,
  type VillageCue,
} from '../../audio/villageSoundCues';
import type { BriarHollowState } from '../../core/quests/briarHollowState';
import type { VillageQuestPhase } from '../../core/quests/villageQuestPhase';
import {
  DIFFICULTY_PROFILES,
  type Difficulty,
  type DifficultyProfile,
  applySpawnDifficulty,
} from '../../core/difficulty/difficultyProfiles';
import type { GameMap } from '../../map/GameMap';
import {
  ASSAULT_LANE_SPAWN_SEARCH_TILES,
  type AssaultLane,
  type AssaultLaneId,
  type BriarHollowSite,
} from '../../map/overworld/briarHollowSite';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { RaisedRatkin } from '../../creatures/RaisedRatkin';
import { RisingSkeleton } from '../../creatures/RisingSkeleton';
import { Necromancer } from '../../creatures/Necromancer';
import { Hawkfolk } from '../../creatures/Hawkfolk';
import type { Fairy } from '../../creatures/fairies/Fairy';
import { BOUNTY_MAX_BLOW_HP_SHARE } from '../../creatures/mobLevelScaling';
import { planEncounterRoster, spawnMob, type SpawnContext } from '../../levels/spawnFunnel';
import { BRIAR_HOLLOW_SIEGE } from '../../levels/encounters';
import { varietyTier, type VarietyTier } from '../../core/perf/varietyTier';
import type { ApproachView } from '../../sprites/figure/approachRows';
import {
  ASSAULT_WAVES,
  HOSTILE_ORDER,
  MIN_UNDEAD_PER_WAVE,
  UNDEAD_ORDER,
  isAssaultSpawnKind,
  type AssaultSpawnKind,
  type AssaultUndeadKind,
  type AssaultWaveSpec,
} from './assaultWaves';
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
  isStandingStructure,
  nearestStructurePoint,
  siegeAdvance,
  siegeCanEngage,
  nearestEngageableDefender,
  tileUnder,
} from '../../creatures/siege/siegeCapability';
import { livingAssaultSpawns } from '../../creatures/siege/assaultCaps';
import { INSIDE_PALISADE, palisadeDistanceFor } from '../../creatures/siege/palisadeDistance';
import type {
  SiegeCapable,
  SiegeDirective,
  SiegeLobber,
  SiegePoint,
  SiegeWorld,
} from '../../creatures/siege/siegeTypes';
import { engageTrebuchet, nearestLiveTrebuchetTo } from '../../creatures/siege/trebuchetThreat';
import { AssaultWavePrewarm, type AssaultLeadIn } from '../../sprites/assaultPrewarm';
import { drawCrumble } from '../../sprites/art/siegeEffectsArt';
import { worldPalette } from '../../ui/theme/worldInk';
import { worldText } from '../../ui/world/worldText';
import { viewportHeight, viewportWidth } from '../../core/rendering/Viewport';
import type { MobRoster } from '../kits/SceneWorld';
import type { MusicClaims } from '../../audio/AudioScope';
import type { DefenseStructures, StructureRef } from './DefenseStructures';
import type { VillageAmbience } from './VillageAmbience';
import { SiegeFlowField } from './SiegeFlowField';
import { siegeHudEntry, type SiegeHudBar, type SiegeHudView } from './siegeHudEntry';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { HOLLOW_BELL_MAX_HP, hollowBellCentre } from './hollowBell';
import { isWorldPointInView } from '../../core/rendering/visibleWorldView';
import { VICTORY_FANFARE_FRAMES, fireworkSchedule, type FireworkRocket } from './victoryFireworks';
import {
  BELL_ALERT_DETAIL,
  BELL_ALERT_HEADLINE,
  SIEGE_LOSS_COPY,
  bellThresholdDetail,
  type SiegeLoss,
} from './siegeAlertCopy';
import { UPDATES_PER_SECOND } from './structureRules';
import { ASSAULT_BOUNTY_KINDS, createBountyMark, type AssaultBountyKind } from './siegeBountyMarks';
import { placeAmong, spawnDue, type OffscreenSpawnRules } from './offscreenSpawns';

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
 * How long a wave's own bodies take to finish rising, one after another, so
 * a blow that lands where they came up catches only the first few rather
 * than the whole roster in one clump.
 */
const SPAWN_STAGGER_SECONDS = 0.6;
const SPAWN_STAGGER_FRAMES = Math.round(SPAWN_STAGGER_SECONDS * UPDATES_PER_SECOND);
/**
 * Wave `index` (from 1) strings together every roster from the first through
 * its own, one mini-wave at a time. The next mini-wave rises once no more
 * than this share of the current one's bodies still stands; the wave itself
 * is cleared only once its own (last) mini-wave is beaten.
 */
export const MINI_WAVE_ADVANCE_REMAINING_SHARE = 0.3;
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
/**
 * Vordrick is the one figure of the retreat the banner names, so a longer
 * hold-up than this reads as the boss stuck on scenery rather than the
 * villain making his escape; a rank-and-file straggler can afford the full
 * {@link WITHDRAW_TIMEOUT_SECONDS} unnoticed.
 */
const VORDRICK_WITHDRAW_TIMEOUT_SECONDS = 12;
const VORDRICK_WITHDRAW_TIMEOUT_FRAMES = VORDRICK_WITHDRAW_TIMEOUT_SECONDS * UPDATES_PER_SECOND;
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
/** The bell counts as under attack until this long after its last blow. */
const BELL_UNDER_ATTACK_HOLD_SECONDS = 4;
const BELL_UNDER_ATTACK_HOLD_FRAMES = BELL_UNDER_ATTACK_HOLD_SECONDS * UPDATES_PER_SECOND;
/** How long the clocktower alert's banner holds. */
const BELL_ALERT_BANNER_SECONDS = 4.5;
const BELL_ALERT_BANNER_FRAMES = BELL_ALERT_BANNER_SECONDS * UPDATES_PER_SECOND;
/**
 * The soonest the banner and its alarm come back during one stretch of
 * attacks, so a crowd beating on the bell raises it once rather than on
 * every pause between blows.
 */
const BELL_ALERT_COOLDOWN_SECONDS = 20;
const BELL_ALERT_COOLDOWN_FRAMES = BELL_ALERT_COOLDOWN_SECONDS * UPDATES_PER_SECOND;
const BELL_THREE_QUARTERS = 0.75;
const BELL_HALF = 0.5;
const BELL_QUARTER = 0.25;
/** Health shares whose crossing always raises the alert again, cooldown or not. */
const BELL_ALERT_THRESHOLDS = [BELL_THREE_QUARTERS, BELL_HALF, BELL_QUARTER] as const;
/** How long a lost siege's banner shows before the explainer halts the game. */
const LOSS_EXPLAINER_DELAY_SECONDS = 2;
const LOSS_EXPLAINER_DELAY_FRAMES = LOSS_EXPLAINER_DELAY_SECONDS * UPDATES_PER_SECOND;
/** How fast the music and the world's effects drop away for the victory. */
const VICTORY_MUSIC_FADE_MS = 300;
const VICTORY_SFX_FADE_MS = 300;
/** How long the village's music takes to come back once the fanfare is over. */
const VICTORY_MUSIC_RETURN_MS = 1500;
/** The fireworks sit under the sting rather than over it. */
const FIREWORK_VOLUME = 0.45;

/**
 * The rockets are drawn across the screen rather than placed in the world, so
 * each one is panned by where it goes up instead of through `playAt`; it plays
 * on the `ui` bus, the one the victory hush leaves open.
 */
function fireworkOptions(rocket: FireworkRocket): PlayOptions {
  const screenSide = rocket.xShare * 2 - 1;
  return { bus: 'ui', volume: FIREWORK_VOLUME, pan: screenSide * PLACED_MAX_PAN };
}
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
/** Candidate tiles tried for a spawn out of sight before settling for the furthest. */
const SPAWN_ATTEMPTS = 6;
/**
 * An enlisted mob takes a defender as its fight, instead of marching, when one
 * this close is on its own side of the wall.
 */
export const SIEGE_DEFENDER_NOTICE_TILES = 6;
/** Archers never march into the wall: they hold this far out and shoot over it. */
export const ARCHER_HOLD_TILES = 7;
/** An archer holding off the wall looses at defenders this close; the palisade does not block its sight. */
const ARCHER_SHOOT_TILES = 9;
/** Offset from a body's origin to the ground point under it. */
const HALF_TILE = TILE_SIZE / 2;
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

/**
 * How much harder a bounty mark strikes a wall than a common body of its
 * kind: a mark's swing is sized to fell a crawler, not to batter stone.
 */
const BOUNTY_MARK_STRUCTURE_SCALE = 4;

/** Every wave opens on the first wave's own roster. */
const OPENING_ROSTER_INDEX = 0;

// ── The waves ───────────────────────────────────────────────────────────────

/** The wave at `index` (from 0), or null past the last. */
function waveSpec(index: number): AssaultWaveSpec | null {
  return index >= 0 && index < ASSAULT_WAVES.length ? ASSAULT_WAVES[index] : null;
}

/** A body coming up the north lane walks south, toward the viewer, and so on round. */
const APPROACH_VIEW_BY_SIDE: Readonly<Record<AssaultLaneId, ApproachView>> = {
  north: 'front',
  south: 'away',
  east: 'side',
  west: 'side',
};

/** One kind of a planned mini-wave and how many of it rise. */
export interface AssaultRosterEntry {
  readonly kind: AssaultSpawnKind;
  readonly count: number;
}

export type AssaultRoster = readonly AssaultRosterEntry[];

/**
 * The bodies wave `rosterIndex`'s roster (from 0) raises as one mini-wave on
 * `difficulty`, at `context`'s variety tier: its counts scaled by the
 * difficulty's {@link AssaultTuning.bodyScale}, any shortfall of undead made
 * up in raised ratkin, the army's rank and file, then its kinds resolved
 * through the siege's ladder. Kinds come in the order they go up the lane.
 */
export function planAssaultRoster(
  rosterIndex: number,
  difficulty: Difficulty,
  context: SpawnContext,
): AssaultRoster {
  const spec = waveSpec(rosterIndex);
  if (spec === null) return [];
  const { bodyScale } = ASSAULT_TUNING[difficulty];
  const scaledCount = (base: number | undefined): number =>
    base === undefined || base <= 0 ? 0 : Math.max(1, Math.round(base * bodyScale));
  const undeadCounts = new Map<AssaultUndeadKind, number>();
  for (const kind of UNDEAD_ORDER) undeadCounts.set(kind, scaledCount(spec.undead[kind]));
  const undeadTotal = [...undeadCounts.values()].reduce((sum, count) => sum + count, 0);
  if (undeadTotal < MIN_UNDEAD_PER_WAVE) {
    const shortfall = MIN_UNDEAD_PER_WAVE - undeadTotal;
    undeadCounts.set('raised_ratkin', (undeadCounts.get('raised_ratkin') ?? 0) + shortfall);
  }
  const authored = [
    ...UNDEAD_ORDER.map((kind) => ({ kind, count: undeadCounts.get(kind) ?? 0 })),
    ...HOSTILE_ORDER.map((kind) => ({ kind, count: scaledCount(spec.hostiles[kind]) })),
  ];
  const planned: AssaultRosterEntry[] = [];
  for (const { kind, count } of planEncounterRoster(authored, context).roster) {
    if (isAssaultSpawnKind(kind)) planned.push({ kind, count });
  }
  return planned;
}

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
  /** The mini-wave roster it was raised for, which it keeps if still queued when the next mini-wave begins. */
  readonly rosterIndex: number;
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

/** The siege's spawns, drawing from the assault's own random stream. */
function assaultSpawnContext(random: () => number): SpawnContext {
  return { encounter: BRIAR_HOLLOW_SIEGE, random };
}

function createSpawn(
  kind: AssaultSpawnKind,
  tileX: number,
  tileY: number,
  map: GameMap,
  random: () => number,
): Mob {
  const mob = spawnMob(kind, { x: tileX, y: tileY }, map, assaultSpawnContext(random));
  // A town bird is calm until struck; one the necromancer drives is not.
  if (mob instanceof Hawkfolk) mob.provoke();
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
 * with its own AI; archers hold off the wall and shoot; lobbers stand off at
 * their throwing distance and lob over it; everyone else strikes the
 * structure in their way, or takes the next step toward the bell.
 */
class MarchDirective implements SiegeDirective {
  constructor(private readonly site: BriarHollowSite) {}

  steer(mob: Mob, targets: readonly Player[]): boolean {
    const siege = mob.siegeCapable;
    // A snare that turned it, or a siege that has ended: its own AI again.
    if (siege === null || !mob.isHostile || mob.ownsSiegeMovement) return false;
    // Still climbing out of the ground: its own AI plays the rise and holds it there.
    if (mob instanceof RisingSkeleton && mob.isRising) return false;
    const lobber = mob.siegeLobber;
    if (lobber !== null) return this.steerLobber(mob, lobber, siege, targets);
    const defenderDistance =
      nearestEngageableDefender(mob, targets, SIEGE_DEFENDER_NOTICE_TILES * TILE_SIZE)?.distance ??
      Infinity;
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

  /**
   * A lobber's frame. It throws, in order, at a live trebuchet in throwing
   * range, then at a crawler or defender in throwing range, then at the
   * structure the flow says is in its way, from as far off as a lob reaches.
   * A lob clears the palisade, so none of the three has to be on its own side
   * of the ring. With none of them to throw at it walks the flow in, and it
   * never strikes a wall: one too close to lob at safely is backed away from.
   * Only the bell, which a blast cannot reach, is struck like anyone strikes it.
   */
  private steerLobber(
    mob: Mob,
    lobber: SiegeLobber,
    siege: SiegeCapable,
    targets: readonly Player[],
  ): boolean {
    const { defense, flow } = siege.world;
    const reachPx = lobber.lobBandMaxPx;

    const trebuchet = nearestLiveTrebuchetTo(mob, defense, reachPx);
    if (trebuchet !== null && lobber.lobAt(trebuchet)) {
      siege.siegeTarget = trebuchet.ref;
      return true;
    }

    const defender = nearestLobTarget(mob, targets, reachPx);
    if (defender !== null) {
      // Too close to throw at without catching itself: its own AI backs off,
      // where it can reach this one at all.
      const crowded = defender.distance < lobber.lobBandMinPx;
      if (crowded && siegeCanEngage(mob, defender.target)) return false;
      if (lobber.lobAt(groundUnder(defender.target))) {
        siege.siegeTarget = null;
        return true;
      }
    }

    const ahead = structureAhead(mob, siege, Math.ceil(reachPx / TILE_SIZE));
    if (ahead !== null && ahead.kind === 'bell') return siegeAdvance(mob);
    const aim = ahead === null ? null : nearestStructurePoint(defense, ahead, mob);
    if (ahead !== null && aim !== null) {
      if (lobber.lobAt(aim)) {
        siege.siegeTarget = ahead;
        return true;
      }
      const fromX = mob.x + HALF_TILE - aim.x;
      const fromY = mob.y + HALF_TILE - aim.y;
      if (Math.hypot(fromX, fromY) < lobber.lobBandMinPx) {
        siege.siegeTarget = null;
        mob.marchStep(fromX, fromY);
        return true;
      }
    }

    if (lobber.lobAt(null)) return true;
    siege.siegeTarget = null;
    const next = flow.nextStep(tileUnder(mob), siege.spreadSeed);
    if (next === null) return false;
    mob.marchStep(next.x * TILE_SIZE - mob.x, next.y * TILE_SIZE - mob.y);
    return true;
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

/** The ground point under a body. */
function groundUnder(body: { readonly x: number; readonly y: number }): SiegePoint {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

/**
 * The nearest live target within `reachPx` of `mob`, on either side of the
 * ring — a lob clears the palisade — and how far it stands, mob position to
 * target position; null when none qualify.
 */
function nearestLobTarget(
  mob: Mob,
  targets: readonly Player[],
  reachPx: number,
): { readonly target: Player; readonly distance: number } | null {
  let best: { readonly target: Player; readonly distance: number } | null = null;
  for (const target of targets) {
    if (!target.isAlive || target.isDefendTarget === true) continue;
    const distance = Math.hypot(target.x - mob.x, target.y - mob.y);
    if (distance > reachPx || (best !== null && distance >= best.distance)) continue;
    best = { target, distance };
  }
  return best;
}

/**
 * The first standing structure on `mob`'s way in, looking up to `steps` tiles
 * down the flow from where it stands; null when the way is open that far. The
 * flow is a cost field over the structures, so its path runs through the wall
 * the wave is breaking and names it a step before it.
 */
function structureAhead(mob: Mob, siege: SiegeCapable, steps: number): StructureRef | null {
  const { defense, flow } = siege.world;
  let tile = tileUnder(mob);
  for (let step = 0; step <= steps; step++) {
    const ref = flow.blockingStructure(tile, siege.spreadSeed);
    if (ref !== null && isStandingStructure(defense, ref)) return ref;
    const next = flow.nextStep(tile, siege.spreadSeed);
    if (next === null) return null;
    tile = next;
  }
  return null;
}

/** A body that stands where it is and takes no part: the withdrawn dead waiting to be released. */
export const HOLD_STILL: SiegeDirective = {
  leavingTheField: true,
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
  /** How long this mob gets before it counts as stuck rather than still walking. */
  readonly timeoutFrames: number;
}

/** How a withdrawal has gone so far. */
type WithdrawalStatus = 'walking' | 'left' | 'stuck';

/**
 * The dead's frame after the bell falls: no more fighting, just the walk back
 * up the lane they came by, released once they are out of sight.
 */
class WithdrawDirective implements SiegeDirective {
  readonly leavingTheField = true;
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
        'walker',
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

  /**
   * How a withdrawal has gone: `left` once it has actually reached the lane's
   * spawn point or is far enough outside the palisade to let go of quietly;
   * `stuck` once no route out was ever found, or it has been walking this
   * long without reaching either — release it with the warp the same way a
   * blocked one is; `walking` otherwise.
   */
  status(mob: Mob): WithdrawalStatus {
    const walk = this.walks.get(mob);
    if (walk === undefined) return 'left';
    const blocked = walk.path !== null && walk.path.length === 0;
    const reachedLaneExit =
      walk.path !== null && walk.path.length > 0 && walk.step >= walk.path.length;
    const tile = tileUnder(mob);
    const farEnough = tilesOutsidePalisade(this.site, tile.x, tile.y) >= WITHDRAW_RELEASE_TILES;
    if (reachedLaneExit || farEnough) return 'left';
    if (blocked || walk.frames >= walk.timeoutFrames) return 'stuck';
    return 'walking';
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

/** The clocktower alert's big banner while it holds. */
export interface BellAlertBanner {
  readonly headline: string;
  readonly detail: string;
  /** Frames since it was raised. */
  readonly age: number;
  readonly framesLeft: number;
}

/** What the clocktower alert shows this frame. */
export interface BellAlertView {
  /** Whether the bell was struck within the last few seconds. */
  readonly underAttack: boolean;
  /** Whether the bell is on screen and clear of the fog. */
  readonly bellInView: boolean;
  readonly banner: BellAlertBanner | null;
  readonly bellFraction: number;
  /** The middle of the bell tower, in world pixels. */
  readonly bellWorld: { readonly x: number; readonly y: number };
}

/** The big banner a siege's ending shows while it holds. */
export interface SiegeOutcomeView {
  readonly headline: string;
  readonly detail: string;
  /** Frames since the siege ended. */
  readonly age: number;
  readonly framesLeft: number;
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
  /** The scene's music claims, which the siege track is claimed through. Null in a gate. */
  readonly music: () => MusicClaims | null;
  /** Keeps each wave's arrival rows warm; injectable so a gate can count its calls. */
  readonly prewarm?: AssaultWavePrewarm;
  /** Uniform [0, 1); a gate passes a seeded stream. */
  readonly random?: () => number;
  /** Told once the victory fanfare has played out and the village's music is back. */
  readonly onVictoryFanfareEnded?: () => void;
}

/** The necromancer's boss-intro colour: his lantern's soul-blue. */
const NECROMANCER_INTRO_COLOR = worldPalette.village.necromancerIntro;

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
  /**
   * Which of the wave's rosters is on the field right now: wave `index`
   * plays every roster from 0 through `index` in turn, reinforcements first
   * and its own roster last. Tagged separately from {@link waveOf}'s real
   * wave index, since several mini-waves share one real wave.
   */
  private readonly miniWaveOf = new Map<Mob, number>();
  private miniWaveRoster = 0;
  /** Bodies planned for the mini-wave now in the field, for the mini-wave-advance gate. */
  private miniWavePlanned = 0;
  /** What the mini-wave now in the field was planned as, and at which tier: what its lead-in warms. */
  private plannedMiniWave: { readonly roster: AssaultRoster; readonly tier: VarietyTier } | null =
    null;
  /** The first wave's roster as it would be planned now, kept while nothing it hangs on changes. */
  private openingForecast: {
    readonly difficulty: Difficulty;
    readonly tier: VarietyTier;
    readonly roster: AssaultRoster;
  } | null = null;
  /** Every mini-wave's planned bodies summed, for the real wave's own clear gate. */
  private waveTotalPlanned = 0;
  /**
   * Frames since the current real wave began — reset once per real wave, not
   * per mini-wave. Every mini-wave gets a fair share of {@link WAVE_MAX_FRAMES}
   * to force its own advance, so a wave stuck with nowhere to spawn still
   * reaches its own roster within the same ceiling a single-roster wave would.
   */
  private waveFrames = 0;
  private lullFrames = 0;
  /** Whether the current mini-wave has put its first body out yet. */
  private waveBodiesOut = false;
  private necromancer: Necromancer | null = null;
  private necromancerOut = false;
  /** The bounty mark of the current or an earlier wave, while one still stands. */
  private bountyMark: Mob | null = null;
  /** How long the spawn at the head of the queue has waited for a place. */
  /** How long the body at the head of the queue has waited for somewhere to come up. */
  private readonly headSpawnWait = { frames: 0 };
  /** Where the dead may come up, round a lane's spawn tile. */
  private readonly spawnRules: OffscreenSpawnRules;
  /** The "Attack coming from…" banner across the middle of the screen, while it shows. */
  private sideBanner: { text: string; framesLeft: number } | null = null;
  private abandonFrames = 0;
  private bellRingFrames = 0;
  private bellTollGap = 0;
  private bellFlashFrames = 0;
  private bellCrackFrames = 0;
  private framesSinceBellStruck = BELL_UNDER_ATTACK_HOLD_FRAMES;
  private bellAlertCooldownFrames = 0;
  private readonly announcedBellThresholds = new Set<number>();
  private bellAlert: { detail: string; age: number; framesLeft: number } | null = null;
  private readonly bellWorld: { readonly x: number; readonly y: number };
  private outcome: { loss: SiegeLoss; age: number; framesLeft: number } | null = null;
  private lossExplainerDelayFrames = 0;
  private lossExplainer: SiegeLoss | null = null;
  private victoryFanfareFrames = 0;
  private breachCalled = false;
  private readonly downedSeen = new Set<object>();
  private segmentsBreached = 0;
  private structuresDestroyed = 0;
  private readonly crumbles: ScheduledCrumble[] = [];
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
    this.spawnRules = {
      gameMap: deps.gameMap,
      crawlers: deps.crawlers,
      random: this.random,
      scatterTiles: SPAWN_SCATTER_TILES,
      searchTiles: SPAWN_SEARCH_TILES,
      attempts: SPAWN_ATTEMPTS,
      minCrawlerTiles: SPAWN_MIN_CRAWLER_TILES,
      unseenTiles: SPAWN_UNSEEN_TILES,
      offscreenMarginTiles: SPAWN_OFFSCREEN_MARGIN_TILES,
      deferFrames: SPAWN_DEFER_FRAMES,
      accepts: (x, y) => this.hasWayIn(x, y),
    };
    this.campaign = campaignFor(deps.state, this.random);
    this.bellWorld = hollowBellCentre(deps.site.square.bellTile);
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

  /** Whether any of the siege's own dead still stands, withdrawing or not. */
  get hasLivingSiegeMobs(): boolean {
    for (const mob of this.waveOf.keys()) if (mob.isAlive) return true;
    return false;
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
      this.lose('abandoned');
    }
  }

  /** "We're ready": the bell rings and the countdown starts. */
  begin(): void {
    if (this.phase !== 'fortifying') return;
    // A broken tower has no bell left to sound the alarm on, and nothing to
    // fall a second time before it is even mended from the first.
    if (this.deps.state.quest.bellTowerBroken) return;
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
    this.miniWaveOf.clear();
    this.miniWaveRoster = 0;
    this.miniWavePlanned = 0;
    this.plannedMiniWave = null;
    this.waveTotalPlanned = 0;
    this.fairies.clear();
    this.waveBodiesOut = false;
    this.necromancer = null;
    this.necromancerOut = false;
    this.bountyMark = null;
    this.headSpawnWait.frames = 0;
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
    this.clearBellAlert();
  }

  /** The poster, the bell, the siege track and the navigation. */
  private enterSiegeDressing(): void {
    const { ambience } = this.deps;
    ambience.noticeBoard.callToArms = true;
    ambience.bell.cracked = false;
    this.ensureFlow();
    this.holdSiegeMusic();
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
    this.tickOutcome();
    this.tickVictoryFanfare();
    if (this.sideBanner !== null) {
      this.sideBanner.framesLeft--;
      if (this.sideBanner.framesLeft <= 0) this.sideBanner = null;
    }
    this.tickWithdrawals();
    this.tickCrumbles();

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
    for (const fairy of this.fairies.values()) if (fairy === mob) return true;
    return false;
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
    this.prewarm.update(this.openingLeadIn());
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
    if (waveSpec(index) === null) return;
    this.deps.state.quest.assaultWaveIndex = index;
    this.lullFrames = 0;
    this.waveFrames = 0;
    this.waveTotalPlanned = 0;
    this.deps.bus.emit('villageAssaultWave', { index });
    this.launchMiniWave(index, 0);
  }

  /**
   * Wave `realWaveIndex` plays as a run of mini-waves, one for every wave's
   * roster from the first through its own, in order: reinforcements arrive
   * first, and the wave's own force — with Vordrick, its bounty mark and its
   * fairy — leads only the last. That keeps a wave from ever landing as one
   * clump: an early AoE only ever meets one roster's worth at a time.
   */
  private launchMiniWave(realWaveIndex: number, rosterIndex: number): void {
    const spec = waveSpec(rosterIndex);
    const lane = this.laneFor(this.sideOfWave(realWaveIndex));
    if (spec === null || lane === null) return;
    this.miniWaveRoster = rosterIndex;
    this.waveBodiesOut = false;
    // Anything the live cap held back from the mini-wave before still comes, first.
    const leftovers = this.pending.map((spawn) => ({ ...spawn, dueFrame: this.waveFrames }));
    const planned = this.planWave(rosterIndex, realWaveIndex, lane, this.waveFrames);
    this.pending = [...leftovers, ...planned];
    this.miniWavePlanned = planned.length;
    this.waveTotalPlanned += planned.length;
    if (rosterIndex === realWaveIndex) this.arrivals = this.planArrivals(realWaveIndex, lane);
    this.playCue('necroWarHorn');
    this.spawnArrivals();
  }

  /** The assault lane on `side`, or null on a site that has none there. */
  private laneFor(side: AssaultLaneId): AssaultLane | null {
    return this.deps.site.assaultLanes.find((lane) => lane.id === side) ?? null;
  }

  /**
   * A mini-wave's bodies as {@link planAssaultRoster} plans them at the tier
   * in force now, raised one after another up its lane, each
   * {@link SPAWN_STAGGER_FRAMES} behind the last. The plan is kept for the
   * lead-in to warm, so a tier change while it rises reaches only the next.
   */
  private planWave(
    rosterIndex: number,
    wave: number,
    lane: AssaultLane,
    baseFrame: number,
  ): PendingSpawn[] {
    const tier = varietyTier();
    const roster = planAssaultRoster(rosterIndex, assaultDifficulty(this.deps.difficulty()), {
      ...assaultSpawnContext(this.random),
      tier,
    });
    this.plannedMiniWave = { roster, tier };
    const counts = new Map(roster.map(({ kind, count }) => [kind, count]));
    // Round-robin through the kinds, so if the live cap holds some back it
    // holds back a mix rather than every one of the last kind.
    const order: AssaultSpawnKind[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const { kind } of roster) {
        const left = counts.get(kind) ?? 0;
        if (left <= 0) continue;
        order.push(kind);
        counts.set(kind, left - 1);
        added = true;
      }
    }
    return order.map((kind, i) => ({
      kind,
      lane,
      dueFrame: baseFrame + i * SPAWN_STAGGER_FRAMES,
      wave,
      rosterIndex,
    }));
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
      this.lose('bell_fell');
      return;
    }
    if (this.checkAbandon(frame)) return;
    this.tickNecromancerRetreat();

    if (this.lullFrames > 0) {
      this.prewarm.update(this.openingLeadIn());
      this.lullFrames--;
      if (this.lullFrames === 0) this.startWave(index + 1);
      return;
    }

    this.waveFrames++;
    this.spawnArrivals();
    const living = this.spawnDue();
    this.peakLiving = Math.max(this.peakLiving, living);
    this.prewarm.update(this.waveStillArriving() ? this.plannedLeadIn() : null);

    // Every mini-wave through this real wave shares one WAVE_MAX_FRAMES clock:
    // a wave with nowhere to spawn still reaches its own roster and advances
    // in the same worst-case time a single-roster wave always has.
    const miniWaveCount = index + 1;
    const stageDeadline = Math.floor(((this.miniWaveRoster + 1) * WAVE_MAX_FRAMES) / miniWaveCount);
    const onWavesOwnRoster = this.miniWaveRoster === index;
    if (!onWavesOwnRoster) {
      const remainingInMini = this.remainingInMiniWave(this.miniWaveRoster);
      const miniWaveDone =
        remainingInMini <= Math.floor(this.miniWavePlanned * MINI_WAVE_ADVANCE_REMAINING_SHARE);
      if (miniWaveDone || this.waveFrames >= stageDeadline) {
        this.launchMiniWave(index, this.miniWaveRoster + 1);
      }
      return;
    }

    if (isLastWave) return;
    const remaining = this.remainingInWave(index);
    const fewLeft = remaining <= Math.floor(this.waveTotalPlanned * WAVE_ADVANCE_REMAINING_SHARE);
    if (fewLeft || this.waveFrames >= stageDeadline) this.beginLull(index + 1);
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

  /** Which way the coming or current wave's bodies face as they walk up their lane. */
  private approachView(): ApproachView {
    const side = this.attackSide;
    return side === null ? 'side' : APPROACH_VIEW_BY_SIDE[side];
  }

  /**
   * The lead-in of the mini-wave every wave opens on, the first wave's own
   * roster, as it would be planned at the tier in force now: the countdown
   * and every lull warm what will rise.
   */
  private openingLeadIn(): AssaultLeadIn {
    const difficulty = assaultDifficulty(this.deps.difficulty());
    const tier = varietyTier();
    const kept = this.openingForecast;
    const forecast =
      kept !== null && kept.difficulty === difficulty && kept.tier === tier
        ? kept
        : {
            difficulty,
            tier,
            roster: planAssaultRoster(OPENING_ROSTER_INDEX, difficulty, {
              ...assaultSpawnContext(this.random),
              tier,
            }),
          };
    this.openingForecast = forecast;
    return { roster: forecast.roster, tier, view: this.approachView() };
  }

  /** The lead-in of the mini-wave now rising, as it was planned; null before any is. */
  private plannedLeadIn(): AssaultLeadIn | null {
    const planned = this.plannedMiniWave;
    return planned === null
      ? null
      : { roster: planned.roster, tier: planned.tier, view: this.approachView() };
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
    let remaining = 0;
    for (const spawn of this.pending) if (spawn.wave === index) remaining++;
    for (const [mob, wave] of this.waveOf) {
      if (mob instanceof Necromancer) continue;
      // A converted ally no longer counts: it fights for the village now.
      if (wave === index && mob.isAlive && mob.isHostile) remaining++;
    }
    return remaining;
  }

  /** The current mini-wave's own bodies not yet beaten: still to come, or alive and hostile. */
  private remainingInMiniWave(rosterIndex: number): number {
    let remaining = 0;
    for (const spawn of this.pending) if (spawn.rosterIndex === rosterIndex) remaining++;
    for (const [mob, roster] of this.miniWaveOf) {
      if (roster === rosterIndex && mob.isAlive && mob.isHostile) remaining++;
    }
    return remaining;
  }

  /**
   * Puts out every body that is due and has room under the live cap, and
   * returns how many of the wave's spawns are alive afterwards. Counted once
   * and carried through the spawns, each of which adds exactly one, rather
   * than recounted over the whole roster before every one.
   */
  private spawnDue(): number {
    let living = livingAssaultSpawns(this.deps.roster.mobs);
    spawnDue(this.pending, this.headSpawnWait, {
      isDue: (next) => next.dueFrame <= this.waveFrames,
      isHeldBack: () => living >= ASSAULT_LIVE_CAP,
      place: (next, waitedFrames) => this.placeFor(this.lanesFor(next.lane), waitedFrames),
      spawn: (next, place) => {
        this.spawn(next.kind, place.lane, place.tile, next.wave, next.rosterIndex);
        living++;
      },
    });
    return living;
  }

  /** Puts out every leader of the wave that has somewhere to appear; the rest wait. */
  private spawnArrivals(): void {
    const wave = this.deps.state.quest.assaultWaveIndex ?? 0;
    const arrivals = this.arrivals;
    let kept = 0;
    for (const pending of arrivals) {
      const place = this.placeFor([pending.lane], pending.waitedFrames);
      if (place === null) {
        pending.waitedFrames++;
        arrivals[kept++] = pending;
        continue;
      }
      this.bringOut(pending.arrival, place.lane, place.tile, wave);
    }
    arrivals.length = kept;
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
   * first, then the wave's others), on open ground a hostile may stand on
   * with a way in to the bell, and never within {@link SPAWN_MIN_CRAWLER_TILES}
   * of a crawler — off screen where one can be found, since the dead come up
   * the lane rather than appearing in view. Null: nowhere yet, so it waits.
   */
  private placeFor(
    lanes: readonly AssaultLane[],
    waitedFrames: number,
  ): { lane: AssaultLane; tile: { x: number; y: number } } | null {
    const place = placeAmong(this.spawnRules, lanes, (lane) => lane.spawn, waitedFrames);
    return place === null ? null : { lane: place.anchor, tile: place.tile };
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

  /**
   * Levels, stages and enlists one assault body, and joins it to the scene.
   * `maxHpShare` fields a weaker (or tougher) copy of the creature; it is
   * applied after levelling, which would otherwise level the scaled figure.
   */
  private enlist(
    mob: Mob,
    lane: AssaultLane,
    wave: number,
    options: { readonly maxHpShare?: number; readonly structureScale?: number } = {},
  ): void {
    const world = this.ensureFlow();
    mob.applyMobLevel(this.deps.waveLevel());
    if (options.maxHpShare !== undefined) mob.scaleMaxHp(options.maxHpShare);
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
    rosterIndex: number,
  ): void {
    const mob = createSpawn(kind, tile.x, tile.y, this.deps.gameMap, this.random);
    // They claw their way up out of the ground at the lane's head: the row
    // each wave's rows are warmed for.
    if (mob instanceof RaisedRatkin) mob.beginRising();
    this.enlist(mob, lane, wave);
    this.miniWaveOf.set(mob, rosterIndex);
    this.waveBodiesOut = true;
  }

  private spawnNecromancer(lane: AssaultLane, tile: { x: number; y: number }, wave: number): void {
    const spec = waveSpec(wave);
    const tuning = ASSAULT_TUNING[assaultDifficulty(this.deps.difficulty())];
    const healthShare = (spec?.necromancerHealthShare ?? 1) * tuning.necromancerHealthScale;
    const necro = spawnMob(
      'necromancer',
      tile,
      this.deps.gameMap,
      assaultSpawnContext(this.random),
    );
    necro.cannotBeKilled = wave < ASSAULT_WAVE_COUNT - 1;
    this.enlist(necro, lane, wave, { maxHpShare: healthShare });
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
    const mark = createBountyMark(kind, tile, this.deps.gameMap, assaultSpawnContext(this.random));
    mark.outgoingDamageScale = tuning.bountyDamageScale;
    mark.blowCapShareOfTargetHp = BOUNTY_MAX_BLOW_HP_SHARE;
    mark.isBoss = true;
    mark.immuneToConfusion = true;
    this.enlist(mark, lane, wave, {
      maxHpShare: tuning.bountyHealthShare,
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
    const fairy = createFairy(kind, tile, gameMap, assaultSpawnContext(this.random));
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
    this.lose('abandoned');
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
    const living = this.deps.roster.mobs.filter(
      (mob) => mob.isAlive && mob.isHostile && (mob.siegeCapable !== null || mob.raisedForSiege),
    );
    for (const mob of living) {
      // Beaten: it stands where it is until it falls, and fights no more —
      // nor is fought, so nothing it is still in reach of can be paid for it.
      mob.abandonStructureStrike();
      mob.siegeDirective = HOLD_STILL;
      mob.currentTarget = null;
      mob.awaitingRelease = true;
      mob.offLimitsToAllies = true;
      this.crumbles.push({
        mob,
        framesLeft: Math.floor(this.random() * CRUMBLE_STAGGER_FRAMES),
      });
    }
    this.deps.setPhase('victory');
    this.endSiege();
    this.beginVictoryFanfare();
  }

  /**
   * The victory gets the stage to itself: the siege's music claim becomes
   * silence, so the village's song starts fresh after the fanfare instead of
   * fading in under it, and the music, the ambience and the world's effects
   * all drop away. The sting and the peal play on the `ui` bus, the one the
   * hush leaves open.
   */
  private beginVictoryFanfare(): void {
    this.deps.music()?.claimMusic({
      owner: 'siege',
      layer: 'battle',
      selection: { kind: 'silence' },
    });
    const audio = this.deps.audio;
    audio?.pauseMusic('siege_victory', VICTORY_MUSIC_FADE_MS);
    audio?.pauseAmbience('siege_victory');
    audio?.hushEffects('siege_victory', VICTORY_SFX_FADE_MS);
    this.playCue('bellVictoryPeal', { bus: 'ui' });
    audio?.play(VILLAGE_VICTORY_STING, { bus: 'ui' });
    this.victoryFanfareFrames = VICTORY_FANFARE_FRAMES;
  }

  /** Counts the fanfare down with gameplay, so a pause holds the silence until it is over. */
  private tickVictoryFanfare(): void {
    if (this.victoryFanfareFrames <= 0) return;
    const ageFrames = VICTORY_FANFARE_FRAMES - this.victoryFanfareFrames;
    const { launches, bursts } = fireworkSchedule(ageFrames);
    for (const rocket of launches) this.playCue('fireworkLaunch', fireworkOptions(rocket));
    for (const rocket of bursts) this.playCue('fireworkBurst', fireworkOptions(rocket));
    this.victoryFanfareFrames--;
    if (this.victoryFanfareFrames > 0) return;
    this.endVictoryFanfare();
    this.deps.onVictoryFanfareEnded?.();
  }

  /**
   * Lets go of everything the fanfare silenced. The audio manager outlives
   * the scene, so a reason left held here would mute the music or the
   * effects for the rest of the session; every way out of the fanfare comes
   * through this.
   */
  private endVictoryFanfare(): void {
    this.victoryFanfareFrames = 0;
    const audio = this.deps.audio;
    audio?.unhushEffects('siege_victory', VICTORY_SFX_FADE_MS);
    audio?.resumeAmbience('siege_victory');
    audio?.resumeMusic('siege_victory', VICTORY_MUSIC_RETURN_MS);
    this.releaseMusic();
  }

  /** The celebration's clock while the victory fanfare plays, or null outside it. */
  get victoryCelebration(): { readonly ageFrames: number } | null {
    if (this.victoryFanfareFrames <= 0) return null;
    return { ageFrames: VICTORY_FANFARE_FRAMES - this.victoryFanfareFrames };
  }

  /** The bell fell, or the party left: the dead walk back out, and the walls stay as they are. */
  private lose(loss: SiegeLoss): void {
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
      const lane = this.laneOf.get(mob) ?? this.nearestLane(mob);
      if (lane === null) {
        this.release(mob, VANISH_IN_A_WISP);
        continue;
      }
      const timeoutFrames =
        mob instanceof Necromancer ? VORDRICK_WITHDRAW_TIMEOUT_FRAMES : WITHDRAW_TIMEOUT_FRAMES;
      this.withdraw.walks.set(mob, { lane, path: null, step: 0, frames: 0, timeoutFrames });
      mob.siegeDirective = this.withdraw;
      mob.currentTarget = null;
    }
    this.outcome = { loss, age: 0, framesLeft: OUTCOME_BANNER_FRAMES };
    this.lossExplainer = null;
    this.lossExplainerDelayFrames = LOSS_EXPLAINER_DELAY_FRAMES;
    if (fell) {
      this.deps.ambience.bell.cracked = true;
      this.bellCrackFrames = BELL_CRACK_SHOWN_FRAMES;
      this.playCue('bellCrack');
      this.deps.state.quest.bellTowerBroken = true;
      this.deps.defense.syncMap();
    }
    this.deps.setPhase('repelled_failed');
    this.endSiege();
    this.releaseMusic();
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

  /**
   * Whatever the ending: the bell is mended and the poster comes down. The
   * siege's music claim is the ending's own to let go of: a loss releases it
   * at once, a victory only once its fanfare is over.
   */
  private endSiege(): void {
    this.deps.defense.restoreBell();
    this.deps.state.quest.imminentCountdownFrames = 0;
    this.abandonFrames = 0;
    this.prewarm.update(null);
    const { ambience } = this.deps;
    ambience.noticeBoard.callToArms = false;
    ambience.bell.ringing = false;
    this.bellRingFrames = 0;
    this.clearBellAlert();
  }

  /**
   * Keeps the siege track through the whole siege. A scene rebuilt round a
   * door visit mid-countdown starts with no claim on it, so the claim is made
   * again every update; a claim already held changes nothing.
   */
  private holdSiegeMusic(): void {
    this.deps.music()?.claimMusic({
      owner: 'siege',
      layer: 'battle',
      selection: { kind: 'loop', id: VILLAGE_SIEGE_MUSIC },
    });
  }

  private releaseMusic(): void {
    this.deps.music()?.releaseMusic('siege');
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
    this.miniWaveOf.delete(mob);
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
    // Walked directly: a Map tolerates deleting the entry being visited.
    for (const mob of this.withdraw.walks.keys()) {
      if (!mob.isAlive) {
        this.withdraw.walks.delete(mob);
        continue;
      }
      const status = this.withdraw.status(mob);
      if (status === 'left') this.release(mob, VANISH_UNSEEN);
      else if (status === 'stuck') this.releaseStuck(mob);
    }
  }

  /** A withdrawal that never found a way out, or took too long: gone with the warp it never had to make. */
  private releaseStuck(mob: Mob): void {
    this.release(mob, VANISH_IN_A_WISP);
    this.playCue('withdrawalWarp');
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
    if (this.phase === 'assault') this.noteBellUnderAttack();
  }

  /**
   * Raises the clocktower alert when an attack on the bell starts after a
   * quiet stretch, or whenever its health crosses a threshold not yet called
   * out this siege. The blow that cracks it raises nothing: the siege is
   * lost on the next update, and the loss says so itself.
   */
  private noteBellUnderAttack(): void {
    const wasUnderAttack = this.bellUnderAttack;
    this.framesSinceBellStruck = 0;
    const fraction = this.bellFraction;
    if (fraction <= 0) return;
    const crossed = BELL_ALERT_THRESHOLDS.filter(
      (threshold) => fraction <= threshold && !this.announcedBellThresholds.has(threshold),
    );
    for (const threshold of crossed) this.announcedBellThresholds.add(threshold);
    if (crossed.length > 0) {
      this.raiseBellAlert(bellThresholdDetail(Math.min(...crossed)));
      return;
    }
    if (!wasUnderAttack && this.bellAlertCooldownFrames === 0) {
      this.raiseBellAlert(BELL_ALERT_DETAIL);
    }
  }

  private raiseBellAlert(detail: string): void {
    this.bellAlert = { detail, age: 0, framesLeft: BELL_ALERT_BANNER_FRAMES };
    this.bellAlertCooldownFrames = BELL_ALERT_COOLDOWN_FRAMES;
    this.playCue('bellUnderAttack');
  }

  private clearBellAlert(): void {
    this.framesSinceBellStruck = BELL_UNDER_ATTACK_HOLD_FRAMES;
    this.bellAlertCooldownFrames = 0;
    this.announcedBellThresholds.clear();
    this.bellAlert = null;
  }

  private tickBellAlert(): void {
    if (this.framesSinceBellStruck < BELL_UNDER_ATTACK_HOLD_FRAMES) this.framesSinceBellStruck++;
    if (this.bellAlertCooldownFrames > 0) this.bellAlertCooldownFrames--;
    const alert = this.bellAlert;
    if (alert === null) return;
    alert.age++;
    alert.framesLeft--;
    if (alert.framesLeft <= 0) this.bellAlert = null;
  }

  /** Whether the dead have struck the bell within the last few seconds of the waves. */
  get bellUnderAttack(): boolean {
    return this.phase === 'assault' && this.framesSinceBellStruck < BELL_UNDER_ATTACK_HOLD_FRAMES;
  }

  /** What the clocktower alert shows, or null outside the waves. */
  bellAlertView(): BellAlertView | null {
    if (this.phase !== 'assault') return null;
    const alert = this.bellAlert;
    const { bellWorld } = this;
    return {
      underAttack: this.bellUnderAttack,
      bellInView: isWorldPointInView(bellWorld.x, bellWorld.y, TILE_SIZE),
      banner:
        alert === null
          ? null
          : {
              headline: BELL_ALERT_HEADLINE,
              detail: alert.detail,
              age: alert.age,
              framesLeft: alert.framesLeft,
            },
      bellFraction: this.bellFraction,
      bellWorld,
    };
  }

  // ── The ending's banner and explainer ─────────────────────────────────────

  private tickOutcome(): void {
    const outcome = this.outcome;
    if (outcome !== null) {
      outcome.age++;
      outcome.framesLeft--;
      if (outcome.framesLeft <= 0) this.outcome = null;
    }
    if (this.lossExplainerDelayFrames <= 0) return;
    this.lossExplainerDelayFrames--;
    // Only the bell's fall needs telling why: walking away is its own answer.
    if (this.lossExplainerDelayFrames === 0 && outcome?.loss === 'bell_fell') {
      this.lossExplainer = 'bell_fell';
    }
  }

  /**
   * The big banner a lost siege shows while it holds, or null. It stands down
   * under the explainer, which it would otherwise draw over.
   */
  outcomeView(): SiegeOutcomeView | null {
    const outcome = this.outcome;
    if (outcome === null || this.lossExplainer !== null) return null;
    const copy = SIEGE_LOSS_COPY[outcome.loss];
    return {
      headline: copy.headline,
      detail: copy.detail,
      age: outcome.age,
      framesLeft: outcome.framesLeft,
    };
  }

  /** Whether the halting explainer for a lost siege is up. */
  get lossExplainerOpen(): boolean {
    return this.lossExplainer !== null;
  }

  /** The player read the explainer, which said everything the banner under it did. */
  dismissLossExplainer(): void {
    this.lossExplainer = null;
    this.outcome = null;
  }

  private tickBell(): void {
    this.tickBellAlert();
    if (this.bellRingFrames > 0) this.bellRingFrames--;
    if (this.bellTollGap > 0) this.bellTollGap--;
    if (this.bellFlashFrames > 0) this.bellFlashFrames--;
    if (this.bellCrackFrames > 0) {
      this.bellCrackFrames--;
      if (this.bellCrackFrames === 0) {
        // A bell struck to nothing mid-siege swings dead a few seconds, then
        // (unless it stays broken for the questline to find) rings again the
        // next time the alarm calls it. A broken tower has no bell left to
        // swing at all — the wreck the prop now paints replaces it outright.
        if (this.deps.state.quest.bellTowerBroken) {
          this.deps.ambience.invalidate();
        } else {
          this.deps.ambience.bell.cracked = false;
        }
      }
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

  private playCue(cue: VillageCue, opts?: PlayOptions): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    audio.playRandom(VILLAGE_CUES[cue], opts);
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

  /** What the siege's card in the top band shows, or null outside the siege. */
  hudView(): SiegeHudView | null {
    if (!this.inSiege) return null;
    const side = this.attackSide;
    const sideName = side === null ? '' : SIDE_NAMES[side];
    const headline =
      this.phase === 'imminent'
        ? `The army is coming from the ${sideName} — ${countdownLabel(this.countdownFrames)}`
        : this.inLull
          ? `Wave ${this.waveNumber + 1} from the ${sideName} — ${countdownLabel(this.lullFrames)}`
          : `Defend Briar Hollow — Wave ${this.waveNumber}/${ASSAULT_WAVE_COUNT} (${sideName})`;
    const bars: SiegeHudBar[] = [];
    if (this.phase === 'assault') {
      bars.push({
        id: 'bell',
        label: 'Clocktower',
        fraction: this.bellFraction,
        kind: 'hp',
        flash: this.bellFlashFrames / BELL_FLASH_FRAMES,
      });
    }
    const necro = this.activeNecromancer;
    if (necro !== null) {
      bars.push({
        id: 'necromancer',
        label: necro.displayName,
        fraction: necro.hp / necro.maxHp,
        kind: 'boss',
        flash: 0,
      });
    }
    const mark = this.activeBountyMark;
    if (mark !== null) {
      bars.push({
        id: 'bounty',
        label: mark.displayName,
        fraction: mark.hp / mark.maxHp,
        kind: 'boss',
        flash: 0,
      });
    }
    return { headline, bars };
  }

  /** The siege's card for the HUD's top band, while the countdown or the waves run. */
  topBandEntry(): TopBandEntry | null {
    const view = this.hudView();
    return view === null ? null : siegeHudEntry(view);
  }

  /**
   * The banners across the middle of the screen through the siege: the
   * abandon warning or the side the next attack comes from.
   */
  renderCentreBanners(ctx: CanvasRenderingContext2D): void {
    if (!this.inSiege) return;
    this.renderAbandonWarning(ctx);
    this.renderSideBanner(ctx);
  }

  private renderSideBanner(ctx: CanvasRenderingContext2D): void {
    const banner = this.sideBanner;
    // The abandon warning holds the same place on screen, and matters more.
    if (banner === null || this.abandonSecondsLeft !== null) return;
    worldText(ctx, banner.text, {
      style: 'title',
      color: worldPalette.ink.danger,
      ...centreBannerColumn(),
      y: viewportHeight() * CENTRE_BANNER_HEIGHT_SHARE,
      align: 'center',
      outline: true,
      alpha: Math.min(1, banner.framesLeft / BANNER_FADE_FRAMES),
    });
  }

  private renderAbandonWarning(ctx: CanvasRenderingContext2D): void {
    const seconds = this.abandonSecondsLeft;
    if (seconds === null) return;
    worldText(ctx, `Return to Briar Hollow! ${seconds}`, {
      style: 'title',
      color: worldPalette.ink.danger,
      x: viewportWidth() / 2,
      y: viewportHeight() * CENTRE_BANNER_HEIGHT_SHARE,
      align: 'center',
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
    this.effects.length = 0;
    this.withdraw.walks.clear();
    this.outcome = null;
    this.lossExplainer = null;
    this.lossExplainerDelayFrames = 0;
    if (this.victoryFanfareFrames > 0) this.endVictoryFanfare();
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
    if (this.victoryFanfareFrames > 0) this.endVictoryFanfare();
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

/** The abandon warning and the side banner sit this far down the screen. */
const CENTRE_BANNER_HEIGHT_SHARE = 0.45;
const OUTCOME_BANNER_MAX_WIDTH = 520;
const BANNER_SIDE_MARGIN = 16;

/** The wrapping column a centre banner is set in, centred on the screen. */
function centreBannerColumn(): { x: number; width: number } {
  const width = Math.min(OUTCOME_BANNER_MAX_WIDTH, viewportWidth() - BANNER_SIDE_MARGIN * 2);
  return { x: (viewportWidth() - width) / 2, width };
}

/** A centre banner fades out over its last this-many frames. */
const BANNER_FADE_FRAMES = 60;
