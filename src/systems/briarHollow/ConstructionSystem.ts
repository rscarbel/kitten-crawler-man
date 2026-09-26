/**
 * ConstructionSystem — every Construction job: raising a wall, placing a
 * trebuchet or a snare, repairing, adding spikes. It turns a menu choice into
 * a timed job at the active crawler's feet, and the finished job into
 * structure state through `DefenseStructures`.
 *
 * A job is priced and timed for the crawler doing it, from their own
 * Construction level: build time, discounts and the spikes unlock never read
 * the other crawler. Nothing is taken when a job starts — the materials are
 * spent in one go when it finishes, so a job cut short costs nothing, and a
 * party that spent its boards elsewhere in the meantime is told so and loses
 * nothing either.
 *
 * A job ends early when its builder walks off, swings, is switched away from
 * or knocked out, or when the structure it was repairing is gone. Being hit
 * does not end it: building under fire is the point of a siege.
 */

import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { PalisadeTier } from '../../map/tileTypes';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import { tileCoordKey } from '../../map/tileIndex';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { CrawlerKind } from '../../core/SkillManager';
import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import type { MobRoster } from '../kits/SceneWorld';
import type { ResourceCost } from '../../core/partyResources';
import { canAfford, spend } from '../../core/partyResources';
import { constructionTimeFactor, spikesUnlocked } from '../../core/craftPerks';
import { TILE_SIZE } from '../../core/constants';
import { drawProgressBar, PROGRESS_PRESETS } from '../../ui/Box';
import {
  BUILD_KNEEL_ROWS,
  BUILD_RISE_ROWS,
  BUILD_ROWS,
  REPAIR_ROWS,
  humanRowOf,
} from '../../sprites/art/humanFigure';
import { viewForFacing } from '../../sprites/humanSprite';
import type { CarlView } from '../../sprites/art/carl/rig';
import {
  type DefenseStructures,
  type StructureRef,
  type TileFootprint,
  footprintTiles,
  structureKey,
  trebuchetFootprint,
} from './DefenseStructures';
import {
  CONSTRUCTION_XP,
  SNARE_BUILD_COST,
  SNARE_BUILD_SECONDS,
  SNARE_REPAIR_SECONDS,
  SPIKES_SECONDS,
  TREBUCHET_BUILD_COST,
  TREBUCHET_BUILD_SECONDS,
  TREBUCHET_MAX_AMMO,
  TREBUCHET_REPAIR_SECONDS,
  UPDATES_PER_SECOND,
  WALL_TIERS,
  discountedCost,
  isFreeCost,
  jobFrames,
  repairXp,
  wallTierXp,
} from './structureRules';
import { HOLLOW_BELL_REPAIR_SECONDS } from './hollowBell';
import {
  NO_SPACE_MESSAGE,
  type PlacementBody,
  type PlacementWorld,
  bodyOverlaps,
  bodyTile,
  footprintTilesValid,
  planTrebuchetPushOut,
  snapFacing,
  snareFootprint,
  trebuchetCandidates,
  villagerAnchorKeys,
  FACING_STEP,
} from './constructionPlacement';
import { unlimitedAmmo } from '../../core/craftPerks';
import type { ConstructionMenuSource } from '../../ui/ConstructionMenu';

type Crawler = HumanPlayer | CatPlayer;

/** The rows of the Construction menu, in order. */
export type BuildOption = 'wood' | 'stone' | 'fortified' | 'trebuchet' | 'snare';
export const BUILD_OPTIONS: readonly BuildOption[] = [
  'wood',
  'stone',
  'fortified',
  'trebuchet',
  'snare',
];

/** Where a new trebuchet or snare will stand. */
export interface PlannedFootprint extends TileFootprint {
  readonly kind: 'trebuchet' | 'snare';
}

export type ConstructionAction = 'build' | 'upgrade' | 'repair' | 'spikes';

export interface ConstructionJob {
  readonly action: ConstructionAction;
  readonly target: StructureRef | PlannedFootprint;
  readonly builder: CrawlerKind;
  readonly totalFrames: number;
  framesLeft: number;
  readonly cost: ResourceCost;
  readonly fromKit: boolean;
  /** What floats up when it finishes: "+Wooden Wall". */
  readonly label: string;
  /** For an upgrade, the tier the wall was going to when the job began. */
  readonly upgradeTo?: PalisadeTier;
  /** Where the builder stood, which "walked off" is measured from. */
  refX: number;
  refY: number;
}

/** A job's move tolerance: a pixel of drift from a shove or a separation push is not walking off. */
const JOB_MOTION_TOLERANCE_PX = 0.5;
/**
 * How far a body sealed inside a just-raised or just-repaired wall may be
 * moved to reach open ground. Generous: the village interior is wide open, so
 * anything tighter would risk leaving nowhere to search.
 */
const WALL_UNSTICK_SEARCH_RADIUS_TILES = 8;
/** A body pushed clear of a trebuchet slides there over this many frames. */
const PUSH_FRAMES = 8;
/** After this long a push that has not arrived (a body wedged on a corner) is finished by placing it. */
const PUSH_SETTLE_GRACE_FRAMES = 4;
const PUSH_SETTLE_FRAMES = PUSH_FRAMES + PUSH_SETTLE_GRACE_FRAMES;
/** Hammer cadence when nobody is drawn hammering: the cat's paws, or Carl mid-flinch. */
const HAMMER_CADENCE_FRAMES = 30;
/** The resource strip stays up for the whole job, renewed this often. */
const HUD_NOTE_INTERVAL_FRAMES = UPDATES_PER_SECOND;
/** How far from a wall its rows reach: the segment the crawler faces within this many tiles. */
export const WALL_REACH_TILES = 1.5;
/** A tile's centre, as a fraction of the tile from its corner. */
const TILE_CENTRE = 0.5;
/** Where along the facing a wall row looks for a segment: half a tile out, a tile, and the full reach. */
const WALL_FACE_SAMPLES = [TILE_CENTRE, 1, WALL_REACH_TILES] as const;

const HAMMER_SOUND = 'hammer_strike';
const REPAIR_LOOP_SOUND: SoundId = 'repairing_loop';
const REPAIR_LOOP_VOLUME = 0.7;
const COMPLETE_SOUND = 'construction_complete';
const STONE_UPGRADE_SOUND = 'wall_upgrade_stone';
const SPIKES_ADDED_SOUND = 'spikes_add';
const ERROR_SOUND = 'error';
const LOAD_SOUND = 'trebuchet_load';

const MATERIALS_GONE_MESSAGE = 'You no longer have the materials.';
const TARGET_CHANGED_MESSAGE = 'The structure changed while you worked on it.';
const NOTHING_TO_REPAIR_MESSAGE = 'There is nothing left to repair.';

const PROGRESS_BAR_WIDTH = 36;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT = 10;

/** One row's state, as the Construction menu shows it. */
export interface OptionStatus {
  readonly option: BuildOption;
  readonly label: string;
  /** Whether choosing it now would start a job. */
  readonly enabled: boolean;
  /** The status line: why it cannot be built, or that it can. */
  readonly status: string;
  /** What this crawler would pay. Empty when free or built from a kit. */
  readonly cost: ResourceCost;
  /** The undiscounted price, shown struck through when a discount applies. */
  readonly baseCost: ResourceCost;
  readonly affordable: boolean;
  readonly seconds: number;
  /** Kits of this kind the party owns. */
  readonly kits: number;
  readonly usesKit: boolean;
}

/** What the world ghost shows while a menu row is hovered or focused. */
export interface PlacementPreview {
  readonly tiles: ReadonlyArray<{ x: number; y: number }>;
  readonly valid: boolean;
  /** Set for wall rows, which outline the faced segment rather than lay a footprint. */
  readonly segmentId: string | null;
}

interface PendingPush {
  readonly body: PlacementBody;
  readonly toX: number;
  readonly toY: number;
  framesLeft: number;
  readonly place: (x: number, y: number) => void;
}

/** A body that may stand where a trebuchet is about to, and how to move it there. */
export interface PushableBody extends PlacementBody {
  /** Slides the body toward a world pixel over a few frames (a crawler or a mob's knockback). */
  readonly slide?: (dirX: number, dirY: number, distancePx: number, frames: number) => void;
  /** Puts the body at a world pixel outright, fixing up whatever index it lives in. */
  readonly place: (x: number, y: number) => void;
}

export interface ConstructionSystemDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly defense: DefenseStructures;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly audio: AudioManager | null;
  readonly announce: (message: string) => void;
  /** Keeps the resource strip up while a job runs. */
  readonly noteResourceActivity: () => void;
  /** Every body a trebuchet may have to push clear, crawlers included. */
  readonly bodies: () => ReadonlyArray<PushableBody>;
  /** Whether this scene is indoors, where nothing can be built. */
  readonly indoors: boolean;
}

interface Hammering {
  readonly human: HumanPlayer;
  readonly view: CarlView;
  readonly faceX: number;
  readonly faceY: number;
  readonly repair: boolean;
}

const OPTION_LABELS: Readonly<Record<BuildOption, string>> = {
  wood: 'Wooden Wall',
  stone: 'Stone Wall',
  fortified: 'Fortified Stone Wall',
  trebuchet: 'Trebuchet',
  snare: 'Snare Trap',
};

const WALL_OPTION_TIER: Readonly<Record<'wood' | 'stone' | 'fortified', PalisadeTier>> = {
  wood: 'wood',
  stone: 'stone',
  fortified: 'fortified',
};

/** The rows the menu only makes sense to offer while facing a wall at all. */
const WALL_BUILD_OPTIONS: ReadonlySet<BuildOption> = new Set<BuildOption>([
  'wood',
  'stone',
  'fortified',
]);

/** Whether `option` is one of the wall tiers, as opposed to a trebuchet or a snare. */
export function isWallOption(option: BuildOption): boolean {
  return WALL_BUILD_OPTIONS.has(option);
}

/** The tier a wall row needs the faced segment to be at. */
const WALL_OPTION_NEEDS: Readonly<Record<'wood' | 'stone' | 'fortified', string>> = {
  wood: 'Face a fence section',
  stone: 'Face a wooden wall',
  fortified: 'Face a stone wall',
};

export function isPlannedFootprint(
  target: StructureRef | PlannedFootprint,
): target is PlannedFootprint {
  return 'w' in target;
}

export class ConstructionSystem {
  private readonly deps: ConstructionSystemDeps;
  private readonly placementWorld: PlacementWorld;
  private _job: ConstructionJob | null = null;
  private jobFrameCount = 0;
  private hammering: Hammering | null = null;
  private readonly pushes: PendingPush[] = [];

  /** Set by gates to prove the corridor check is what stops a sealing build. */
  skipCorridorCheck = false;

  constructor(deps: ConstructionSystemDeps) {
    this.deps = deps;
    this.placementWorld = {
      gameMap: deps.gameMap,
      site: deps.site,
      defense: deps.defense,
      anchorTiles: villagerAnchorKeys(deps.site),
    };
  }

  get job(): Readonly<ConstructionJob> | null {
    return this._job;
  }

  private crawlerOf(kind: CrawlerKind): Crawler {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  private kindOf(crawler: Crawler): CrawlerKind {
    return crawler === this.deps.human ? 'human' : 'cat';
  }

  private active(): Crawler {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  /** A crawler's own Construction level, 0 until learned. */
  levelOf(crawler: Crawler): number {
    return crawler.craftSkills.isLearned('construction')
      ? crawler.craftSkills.getLevel('construction')
      : 0;
  }

  // ── Targets ─────────────────────────────────────────────────────────────

  private crawlerTile(crawler: Crawler): { x: number; y: number } {
    return bodyTile(crawler);
  }

  /**
   * The palisade segment the crawler faces within reach, or failing that the
   * nearest one in reach. Wall rows act on this.
   */
  facedSegment(crawler: Crawler): string | null {
    const defense = this.deps.defense;
    const facing = FACING_STEP[snapFacing(crawler.facingX, crawler.facingY)];
    const centreX = crawler.x + TILE_SIZE / 2;
    const centreY = crawler.y + TILE_SIZE / 2;
    for (const reach of WALL_FACE_SAMPLES) {
      const tileX = Math.floor((centreX + facing.dx * reach * TILE_SIZE) / TILE_SIZE);
      const tileY = Math.floor((centreY + facing.dy * reach * TILE_SIZE) / TILE_SIZE);
      const segment = defense.segmentAtTile(tileX, tileY);
      if (segment !== null) return segment.id;
    }
    const nearest = defense.nearestInReach(crawler, WALL_REACH_TILES);
    return nearest?.kind === 'segment' ? nearest.id : null;
  }

  /** Whether the crawler stands where a wall build/upgrade prompt applies at all. */
  isNearWall(crawler: Crawler = this.active()): boolean {
    return this.facedSegment(crawler) !== null;
  }

  /**
   * What the build key would do to the faced wall, and what it would cost,
   * for the contextual world prompt: repair it when it is hurt or breached
   * (a breach stands back up at the tier it fell from), otherwise raise it a
   * tier. Null when there is no segment in reach, or a whole fortified one.
   */
  wallBuildPrompt(crawler: Crawler = this.active()): {
    readonly tier: PalisadeTier;
    readonly cost: ResourceCost;
    readonly repair: boolean;
  } | null {
    const segment = this.facedSegment(crawler);
    if (segment === null) return null;
    const ref: StructureRef = { kind: 'segment', id: segment };
    const repairCost = this.repairCostFor(ref, crawler);
    const current = this.deps.defense.segmentTier(segment);
    const standingTier =
      this.deps.defense.breachedTier(segment) ??
      (current === 'gap' || current === 'breach' ? null : current);
    if (repairCost !== null && standingTier !== null) {
      return { tier: standingTier, cost: repairCost, repair: true };
    }
    const tier = this.deps.defense.upgradeTarget(ref);
    if (tier === null) return null;
    const cost = this.upgradeCostFor(ref, crawler);
    if (cost === null) return null;
    return { tier, cost, repair: false };
  }

  /** The wall tile a build prompt anchors to: the faced segment's tile nearest the crawler. */
  wallPromptTile(crawler: Crawler = this.active()): { x: number; y: number } | null {
    const segment = this.facedSegment(crawler);
    if (segment === null) return null;
    const tiles = this.deps.defense.footprintOf({ kind: 'segment', id: segment });
    return nearestTile(crawler.x + TILE_SIZE / 2, crawler.y + TILE_SIZE / 2, tiles);
  }

  /**
   * The build key over a faced wall: repairs it when it is hurt or breached,
   * and otherwise raises it the same way choosing the row in the Construction
   * menu would. Returns whether a job started.
   */
  tryBuildFacedWall(): boolean {
    const segment = this.facedSegment(this.active());
    if (segment === null) return false;
    return this.repairOrUpgrade({ kind: 'segment', id: segment });
  }

  /**
   * Repairs a structure with anything to mend — a breach stands back up at
   * the tier it fell from — or raises a whole wall a tier. Returns whether a
   * job started.
   */
  repairOrUpgrade(ref: StructureRef): boolean {
    if (this.repairCostFor(ref) !== null) return this.startRepair(ref);
    return this.startUpgrade(ref);
  }

  private kitCount(kind: 'trebuchet' | 'snare'): number {
    const id = kind === 'trebuchet' ? 'trebuchet_kit' : 'snare_kit';
    return this.deps.human.inventory.countOf(id) + this.deps.cat.inventory.countOf(id);
  }

  /** Where a new trebuchet or snare would go for this crawler, and whether every tile is fit for it. */
  plannedFootprint(
    crawler: Crawler,
    kind: 'trebuchet' | 'snare',
  ): { footprint: PlannedFootprint; valid: boolean } {
    const tile = this.crawlerTile(crawler);
    const facing = snapFacing(crawler.facingX, crawler.facingY);
    if (kind === 'snare') {
      const footprint = { kind, ...snareFootprint(tile.x, tile.y, facing) };
      return { footprint, valid: footprintTilesValid(this.placementWorld, footprint, false) };
    }
    const candidates = trebuchetCandidates(tile.x, tile.y, facing);
    for (const candidate of candidates) {
      if (footprintTilesValid(this.placementWorld, candidate, true)) {
        return { footprint: { kind, ...candidate }, valid: true };
      }
    }
    const fallback = candidates[0];
    return { footprint: { kind, ...fallback }, valid: false };
  }

  // ── The menu's rows ─────────────────────────────────────────────────────

  optionStatus(option: BuildOption, crawler: Crawler = this.active()): OptionStatus {
    const level = this.levelOf(crawler);
    const label = OPTION_LABELS[option];
    const busy = this._job !== null;
    if (option === 'trebuchet' || option === 'snare') {
      const baseCost = option === 'trebuchet' ? TREBUCHET_BUILD_COST : SNARE_BUILD_COST;
      const kits = this.kitCount(option);
      const usesKit = kits > 0;
      const cost = usesKit ? {} : discountedCost(baseCost, level);
      const affordable = usesKit || canAfford(this.deps.human, this.deps.cat, cost);
      const seconds =
        (option === 'trebuchet' ? TREBUCHET_BUILD_SECONDS : SNARE_BUILD_SECONDS) *
        timeFactor(level);
      let status = 'Ready — builds in front of you';
      let enabled = true;
      if (this.deps.indoors) {
        status = 'Build outdoors';
        enabled = false;
      } else if (busy) {
        status = 'Already building';
        enabled = false;
      } else if (!this.plannedFootprint(crawler, option).valid) {
        status = 'No room in front of you';
        enabled = false;
      } else if (!affordable) {
        status = 'Not enough materials';
        enabled = false;
      }
      return { option, label, enabled, status, cost, baseCost, affordable, seconds, kits, usesKit };
    }
    const tier = WALL_OPTION_TIER[option];
    const baseCost = WALL_TIERS[tier].upgradeCost ?? {};
    const cost = discountedCost(baseCost, level);
    const affordable = canAfford(this.deps.human, this.deps.cat, cost);
    const seconds = WALL_TIERS[tier].buildSeconds * timeFactor(level);
    const base = { option, label, cost, baseCost, affordable, seconds, kits: 0, usesKit: false };
    if (this.deps.indoors) return { ...base, enabled: false, status: 'Build outdoors' };
    const segment = this.facedSegment(crawler);
    if (segment === null) return { ...base, enabled: false, status: WALL_OPTION_NEEDS[option] };
    const current = this.deps.defense.segmentTier(segment);
    const fallenFrom = this.deps.defense.breachedTier(segment);
    if (fallenFrom !== null) {
      if (fallenFrom !== tier) {
        return { ...base, enabled: false, status: `Repair it as ${tierPhrase(fallenFrom)} first` };
      }
      const breach: StructureRef = { kind: 'segment', id: segment };
      const repairCost = this.repairCostFor(breach, crawler) ?? cost;
      const canRepair = canAfford(this.deps.human, this.deps.cat, repairCost);
      const repair = {
        ...base,
        cost: repairCost,
        baseCost: this.deps.defense.repairCost(breach) ?? baseCost,
        affordable: canRepair,
        seconds: this.repairSeconds(breach, crawler),
      };
      if (busy) return { ...repair, enabled: false, status: 'Already building' };
      if (!canRepair) return { ...repair, enabled: false, status: 'Not enough materials' };
      return { ...repair, enabled: true, status: 'Ready — repairs the breach' };
    }
    const target = this.deps.defense.upgradeTarget({ kind: 'segment', id: segment });
    if (target !== tier) {
      const alreadyThere = tierRank(current) >= tierRank(tier);
      return {
        ...base,
        enabled: false,
        status: alreadyThere
          ? `This section is already ${tierPhrase(current)}`
          : WALL_OPTION_NEEDS[option],
      };
    }
    if (busy) return { ...base, enabled: false, status: 'Already building' };
    if (!affordable) return { ...base, enabled: false, status: 'Not enough materials' };
    return { ...base, enabled: true, status: 'Ready' };
  }

  /** The ghost a hovered or focused row draws in the world. */
  previewFor(option: BuildOption, crawler: Crawler = this.active()): PlacementPreview | null {
    if (this.deps.indoors) return null;
    if (option === 'trebuchet' || option === 'snare') {
      const { footprint, valid } = this.plannedFootprint(crawler, option);
      return { tiles: footprintTiles(footprint), valid, segmentId: null };
    }
    const segment = this.facedSegment(crawler);
    if (segment === null) return null;
    const tiles = this.deps.defense.footprintOf({ kind: 'segment', id: segment });
    return { tiles, valid: this.optionStatus(option, crawler).enabled, segmentId: segment };
  }

  /** Starts the row's job for the active crawler. Returns whether it started. */
  startOption(option: BuildOption): boolean {
    const crawler = this.active();
    const status = this.optionStatus(option, crawler);
    if (!status.enabled) {
      this.refuse(option === 'trebuchet' || option === 'snare' ? NO_SPACE_MESSAGE : status.status);
      return false;
    }
    if (option === 'trebuchet' || option === 'snare')
      return this.startPlacement(crawler, option, status);
    const segment = this.facedSegment(crawler);
    if (segment === null) return false;
    if (this.deps.defense.breachedTier(segment) !== null) {
      return this.startRepair({ kind: 'segment', id: segment });
    }
    const tier = WALL_OPTION_TIER[option];
    return this.beginJob(crawler, {
      action: 'upgrade',
      target: { kind: 'segment', id: segment },
      seconds: WALL_TIERS[tier].buildSeconds,
      cost: status.cost,
      fromKit: false,
      label: `+${WALL_TIERS[tier].label}`,
    });
  }

  private startPlacement(
    crawler: Crawler,
    kind: 'trebuchet' | 'snare',
    status: OptionStatus,
  ): boolean {
    const { footprint, valid } = this.plannedFootprint(crawler, kind);
    if (!valid) {
      this.refuse(NO_SPACE_MESSAGE);
      return false;
    }
    const bodies = this.deps.bodies();
    const key = structureKey(footprint.x, footprint.y);
    if (kind === 'snare') {
      // A snare needs a free tile: anybody standing on it makes it not free.
      if (bodies.some((body) => bodyOverlaps(body, footprint))) {
        this.refuse(NO_SPACE_MESSAGE);
        return false;
      }
    } else {
      const plan = planTrebuchetPushOut(
        this.deps.gameMap,
        footprint,
        this.crawlerTile(crawler),
        bodies,
        {
          skipCorridorCheck: this.skipCorridorCheck,
        },
      );
      if (plan === null) {
        this.refuse(NO_SPACE_MESSAGE);
        return false;
      }
      this.deps.defense.reserve(key, footprint);
      for (const push of plan) this.pushBody(push.body, push.to);
    }
    return this.beginJob(crawler, {
      action: 'build',
      target: footprint,
      seconds: kind === 'trebuchet' ? TREBUCHET_BUILD_SECONDS : SNARE_BUILD_SECONDS,
      cost: status.cost,
      fromKit: status.usesKit,
      label: `+${OPTION_LABELS[kind]}`,
    });
  }

  private pushBody(body: PushableBody, to: { x: number; y: number }): void {
    const toX = to.x * TILE_SIZE;
    const toY = to.y * TILE_SIZE;
    const dx = toX - body.x;
    const dy = toY - body.y;
    const distance = Math.hypot(dx, dy);
    if (body.slide !== undefined && distance > 0) body.slide(dx, dy, distance, PUSH_FRAMES);
    else body.place(toX, toY);
    this.pushes.push({ body, toX, toY, framesLeft: PUSH_SETTLE_FRAMES, place: body.place });
  }

  // ── Structure-menu actions ──────────────────────────────────────────────

  /** What a repair would cost this crawler, or null when there is nothing to repair. */
  repairCostFor(ref: StructureRef, crawler: Crawler = this.active()): ResourceCost | null {
    const base = this.deps.defense.repairCost(ref);
    return base === null ? null : discountedCost(base, this.levelOf(crawler));
  }

  upgradeCostFor(ref: StructureRef, crawler: Crawler = this.active()): ResourceCost | null {
    const base = this.deps.defense.upgradeCost(ref);
    return base === null ? null : discountedCost(base, this.levelOf(crawler));
  }

  spikesCostFor(crawler: Crawler = this.active()): ResourceCost {
    return discountedCost(this.deps.defense.spikesCost(), this.levelOf(crawler));
  }

  spikesAvailable(crawler: Crawler = this.active()): boolean {
    return spikesUnlocked(this.levelOf(crawler));
  }

  /** Seconds a repair of `ref` takes this crawler. */
  repairSeconds(ref: StructureRef, crawler: Crawler = this.active()): number {
    return repairBaseSeconds(this.deps.defense, ref) * timeFactor(this.levelOf(crawler));
  }

  startRepair(ref: StructureRef): boolean {
    const crawler = this.active();
    const cost = this.repairCostFor(ref, crawler);
    if (cost === null) return false;
    if (!this.affordOrRefuse(cost)) return false;
    return this.beginJob(crawler, {
      action: 'repair',
      target: ref,
      seconds: repairBaseSeconds(this.deps.defense, ref),
      cost,
      fromKit: false,
      label: 'Repaired',
    });
  }

  startUpgrade(ref: StructureRef): boolean {
    const crawler = this.active();
    const target = this.deps.defense.upgradeTarget(ref);
    const cost = this.upgradeCostFor(ref, crawler);
    if (target === null || cost === null) return false;
    if (!this.affordOrRefuse(cost)) return false;
    return this.beginJob(crawler, {
      action: 'upgrade',
      target: ref,
      seconds: WALL_TIERS[target].buildSeconds,
      cost,
      fromKit: false,
      label: `+${WALL_TIERS[target].label}`,
    });
  }

  startSpikes(ref: StructureRef): boolean {
    const crawler = this.active();
    if (!this.spikesAvailable(crawler) || !this.deps.defense.canTakeSpikes(ref)) return false;
    const cost = this.spikesCostFor(crawler);
    if (!this.affordOrRefuse(cost)) return false;
    return this.beginJob(crawler, {
      action: 'spikes',
      target: ref,
      seconds: SPIKES_SECONDS,
      cost,
      fromKit: false,
      label: '+Spikes',
    });
  }

  /** Whether a trebuchet's ammo is bottomless, because its builder reached the top of Construction. */
  hasUnlimitedAmmo(key: string): boolean {
    const record = this.deps.defense.trebuchet(key);
    if (record === null) return false;
    return unlimitedAmmo(this.levelOf(this.crawlerOf(record.builtBy)));
  }

  /** Room left in a trebuchet's bucket. */
  ammoRoom(key: string): number {
    const record = this.deps.defense.trebuchet(key);
    return record === null ? 0 : Math.max(0, TREBUCHET_MAX_AMMO - record.ammo);
  }

  partyStone(): number {
    return this.deps.human.inventory.countOf('stone') + this.deps.cat.inventory.countOf('stone');
  }

  /**
   * Puts up to `amount` stone into a trebuchet, taken from the active crawler
   * first. Ammunition is a deposit, not a cost: no discount and no XP.
   * Returns how much went in.
   */
  depositAmmo(key: string, amount: number): number {
    const record = this.deps.defense.trebuchet(key);
    if (record === null) return 0;
    const moved = Math.min(Math.floor(amount), this.ammoRoom(key), this.partyStone());
    if (moved <= 0) return 0;
    if (!spend(this.deps.human, this.deps.cat, { stone: moved }, this.active())) return 0;
    record.ammo += moved;
    this.deps.audio?.play(LOAD_SOUND);
    this.deps.noteResourceActivity();
    return moved;
  }

  /**
   * The repair key: mends the nearest structure in reach that needs it — a
   * hurt or breached wall, a hurt or broken trebuchet or snare, the bell —
   * and with nothing in reach to mend, Quick Loads the nearest trebuchet.
   */
  repairOrLoad(reachTiles: number): void {
    const hurt = this.nearestNeedingRepair(reachTiles);
    if (hurt !== null) {
      this.startRepair(hurt);
      return;
    }
    this.quickLoad(reachTiles);
  }

  /** The nearest structure in reach with something to repair, or null. */
  nearestNeedingRepair(reachTiles: number, crawler: Crawler = this.active()): StructureRef | null {
    const defense = this.deps.defense;
    return defense.nearestInReach(crawler, reachTiles, (ref) => defense.repairCost(ref) !== null);
  }

  /** Quick Load: as much stone as fits into the nearest trebuchet in reach. */
  quickLoad(reachTiles: number): void {
    const nearest = this.deps.defense.nearestInReach(this.active(), reachTiles);
    const ref = nearest?.kind === 'trebuchet' ? nearest : this.nearestTrebuchet(reachTiles);
    if (ref === null) return;
    if (this.hasUnlimitedAmmo(ref.key)) {
      this.deps.announce('It never runs dry.');
      return;
    }
    if (this.ammoRoom(ref.key) <= 0) {
      this.deps.announce('The trebuchet is full.');
      return;
    }
    if (this.partyStone() <= 0) {
      this.deps.announce('You have no stone.');
      return;
    }
    const moved = this.depositAmmo(ref.key, this.ammoRoom(ref.key));
    if (moved > 0) this.deps.announce(`Loaded ${moved} stone.`);
  }

  private nearestTrebuchet(reachTiles: number): { kind: 'trebuchet'; key: string } | null {
    const crawler = this.active();
    let best: { kind: 'trebuchet'; key: string } | null = null;
    let bestDistance = reachTiles * TILE_SIZE;
    for (const record of this.deps.defense.trebuchets) {
      for (const tile of footprintTiles(trebuchetFootprint(record.x, record.y))) {
        const distance = Math.hypot(tile.x * TILE_SIZE - crawler.x, tile.y * TILE_SIZE - crawler.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { kind: 'trebuchet', key: structureKey(record.x, record.y) };
        }
      }
    }
    return best;
  }

  private affordOrRefuse(cost: ResourceCost): boolean {
    if (canAfford(this.deps.human, this.deps.cat, cost)) return true;
    this.refuse('Not enough materials.');
    return false;
  }

  private refuse(message: string): void {
    this.deps.announce(message);
    this.deps.audio?.play(ERROR_SOUND);
  }

  // ── The job ─────────────────────────────────────────────────────────────

  private beginJob(
    crawler: Crawler,
    spec: {
      action: ConstructionAction;
      target: StructureRef | PlannedFootprint;
      seconds: number;
      cost: ResourceCost;
      fromKit: boolean;
      label: string;
    },
  ): boolean {
    if (this._job !== null) return false;
    // Nobody who has not been taught the craft reaches a job; a caller that
    // somehow does must not hand out XP or a structure for it.
    if (!crawler.craftSkills.isLearned('construction')) return false;
    const frames = jobFrames(spec.seconds, this.levelOf(crawler));
    this._job = {
      action: spec.action,
      target: spec.target,
      builder: this.kindOf(crawler),
      totalFrames: frames,
      framesLeft: frames,
      cost: spec.cost,
      fromKit: spec.fromKit,
      label: spec.label,
      upgradeTo:
        spec.action === 'upgrade' && !isPlannedFootprint(spec.target)
          ? (this.deps.defense.upgradeTarget(spec.target) ?? undefined)
          : undefined,
      refX: crawler.x,
      refY: crawler.y,
    };
    this.jobFrameCount = 0;
    this.deps.noteResourceActivity();
    if (crawler === this.deps.human) this.startHammering(this.deps.human, spec.action === 'repair');
    return true;
  }

  /** Ends the job without spending anything, releasing any reserved footprint. */
  cancelJob(): void {
    const job = this._job;
    if (job === null) return;
    this._job = null;
    if (isPlannedFootprint(job.target)) {
      this.deps.defense.releaseReservation(structureKey(job.target.x, job.target.y));
    }
  }

  private jobShouldEnd(job: ConstructionJob): boolean {
    const builder = this.crawlerOf(job.builder);
    if (!builder.isActive || builder.isKnockedOut || !builder.isAlive) return true;
    if (builder.isSwinging) return true;
    const moved = Math.hypot(builder.x - job.refX, builder.y - job.refY);
    if (moved > JOB_MOTION_TOLERANCE_PX) {
      // A shove or a separation push moves him without his say: that is not walking off.
      if (builder.isMoving) return true;
      job.refX = builder.x;
      job.refY = builder.y;
    }
    if (!isPlannedFootprint(job.target) && !this.deps.defense.exists(job.target)) return true;
    return false;
  }

  update(): void {
    this.updatePushes();
    if (this.hammering !== null && this._job === null) this.endHammering();
    this.advanceJob();
    this.syncRepairLoop();
  }

  /**
   * Keyed off the live job rather than started and stopped at each call site,
   * because a repair ends in several ways (finished, walked off, target gone,
   * dispose) and every one of them must silence the loop.
   */
  private syncRepairLoop(): void {
    const audio = this.deps.audio;
    if (audio === null) return;
    const repairing = this._job?.action === 'repair';
    if (repairing) audio.startAmbientLoop(REPAIR_LOOP_SOUND, REPAIR_LOOP_VOLUME);
    else audio.stopAmbientLoop(REPAIR_LOOP_SOUND);
  }

  private advanceJob(): void {
    const job = this._job;
    if (job === null) return;
    if (this.jobShouldEnd(job)) {
      this.cancelJob();
      return;
    }
    this.jobFrameCount++;
    if (this.jobFrameCount % HUD_NOTE_INTERVAL_FRAMES === 0) this.deps.noteResourceActivity();
    if (this.hammering === null && this.jobFrameCount % HAMMER_CADENCE_FRAMES === 0) {
      this.deps.audio?.play(HAMMER_SOUND);
    }
    job.framesLeft--;
    if (job.framesLeft <= 0) this.finishJob(job);
  }

  private updatePushes(): void {
    for (let index = this.pushes.length - 1; index >= 0; index--) {
      const push = this.pushes[index];
      push.framesLeft--;
      if (push.framesLeft > 0) continue;
      const arrived =
        Math.abs(push.body.x - push.toX) < TILE_SIZE / 2 &&
        Math.abs(push.body.y - push.toY) < TILE_SIZE / 2;
      if (!arrived) push.place(push.toX, push.toY);
      this.pushes.splice(index, 1);
    }
  }

  private finishJob(job: ConstructionJob): void {
    this._job = null;
    const builder = this.crawlerOf(job.builder);
    const defense = this.deps.defense;
    // A siege does not wait for the hammer: the wall may have been breached,
    // or further damaged, while the job ran. Whatever the job does now has to
    // match what it is paid for now.
    const settled = this.settleAtCompletion(job, builder);
    if (settled === null) return;
    if (!this.payFor(job, builder, settled)) {
      if (isPlannedFootprint(job.target))
        defense.releaseReservation(structureKey(job.target.x, job.target.y));
      this.refuse(MATERIALS_GONE_MESSAGE);
      return;
    }
    let xp = 0;
    const target = job.target;
    let completionSound: SoundId = COMPLETE_SOUND;
    if (isPlannedFootprint(target)) {
      if (target.kind === 'trebuchet') {
        defense.placeTrebuchet(target.x, target.y, job.builder);
        xp = CONSTRUCTION_XP.trebuchet;
      } else {
        defense.placeSnare(target.x, target.y, job.builder);
        xp = CONSTRUCTION_XP.snare;
      }
    } else if (job.action === 'upgrade') {
      const tier = defense.upgradeTarget(target);
      defense.applyUpgrade(target, job.builder);
      if (tier === 'stone') completionSound = STONE_UPGRADE_SOUND;
      xp = tier === null ? 0 : wallTierXp(tier);
      this.freeTrappedOccupants(target);
    } else if (job.action === 'repair') {
      const max = defense.maxHp(target);
      const before = defense.hp(target);
      xp = repairXp(buildXpOf(defense, target), max <= 0 ? 1 : (max - before) / max);
      defense.applyRepair(target);
      this.freeTrappedOccupants(target);
    } else {
      defense.applySpikes(target, job.builder);
      completionSound = SPIKES_ADDED_SOUND;
      xp = CONSTRUCTION_XP.spikes;
    }
    if (xp > 0) builder.craftSkills.addXp('construction', xp);
    this.deps.audio?.play(completionSound);
    builder.queueFloatingText(job.label, 'buff');
    this.deps.noteResourceActivity();
  }

  /**
   * What the job costs at the moment it finishes, or null — having told the
   * player why — when it can no longer do what it was started for. An
   * upgrade whose wall has since fallen, or spikes whose wall has, cancel with
   * nothing spent; a repair is re-priced for the damage there is now.
   */
  private settleAtCompletion(job: ConstructionJob, builder: Crawler): ResourceCost | null {
    const defense = this.deps.defense;
    const target = job.target;
    if (isPlannedFootprint(target)) return job.cost;
    const changed = (): null => {
      this.refuse(TARGET_CHANGED_MESSAGE);
      return null;
    };
    if (job.action === 'upgrade') {
      return defense.upgradeTarget(target) === job.upgradeTo ? job.cost : changed();
    }
    if (job.action === 'spikes') return defense.canTakeSpikes(target) ? job.cost : changed();
    if (job.action === 'repair') {
      const now = this.repairCostFor(target, builder);
      if (now === null) {
        this.refuse(NOTHING_TO_REPAIR_MESSAGE);
        return null;
      }
      return now;
    }
    return job.cost;
  }

  /** Takes the materials — or the kit — at the moment the work is done. */
  private payFor(job: ConstructionJob, builder: Crawler, cost: ResourceCost): boolean {
    if (job.fromKit && isPlannedFootprint(job.target)) {
      const id = job.target.kind === 'trebuchet' ? 'trebuchet_kit' : 'snare_kit';
      const holder = builder.inventory.countOf(id) > 0 ? builder : this.otherCrawler(builder);
      if (holder.inventory.countOf(id) <= 0) return false;
      holder.inventory.removeItems(id, 1);
      return true;
    }
    if (isFreeCost(cost)) return true;
    return spend(this.deps.human, this.deps.cat, cost, builder);
  }

  private otherCrawler(crawler: Crawler): Crawler {
    return crawler === this.deps.human ? this.deps.cat : this.deps.human;
  }

  /**
   * A wall segment can turn what was walkable — a fallen fence's gap, or a
   * breach — back into solid palisade. Raising or repairing one can only ever
   * be started facing it in reach, so a body standing in the opening when the
   * job finishes is trapped by the very wall that just went up, unless
   * whoever is caught there is moved out first. Checked against every body
   * the village knows about, not only the builder: an ally, a companion or a
   * sieging hostile can be standing in the gap too — which is why the fix can
   * never default to "put them inside the village": that is exactly backwards
   * for a hostile caught on the outside.
   *
   * "Trapped" means the body's own standing tile — the tile its centre is
   * on, the same test movement collision uses — is one of the segment's
   * tiles and that tile is no longer walkable. A body merely hugging a solid
   * wall from its legal neighbouring tile is not trapped and is left exactly
   * where it is: collision already tests movement against the body's centre
   * (`applyMovement`'s north–south check uses the centre, not the leading
   * edge), so a body walked flush against any standing wall has always had
   * its sprite box read half a tile into the wall's own row — that overlap
   * is normal wall-hugging, not entrapment, and re-happens at every tier.
   *
   * A body that is truly trapped is put back on the side of the wall its own
   * centre was already leaning toward — compared against the wall tile's
   * centre along whichever axis the offset is larger on, which is the wall's
   * short axis for a body standing anywhere but dead centre of the tile.
   * Dead centre (no lean either way) falls back to the village's interior,
   * and a search that finds nothing on the preferred side falls back to any
   * walkable tile at all, so this can only ever return a body somewhere, never
   * strand it forever.
   */
  private freeTrappedOccupants(ref: StructureRef): void {
    if (ref.kind !== 'segment') return;
    const gameMap = this.deps.gameMap;
    const blockedTiles = new Map<number, { x: number; y: number }>();
    for (const tile of this.deps.defense.footprintOf(ref)) {
      if (!gameMap.isWalkable(tile.x, tile.y)) blockedTiles.set(tileCoordKey(tile.x, tile.y), tile);
    }
    if (blockedTiles.size === 0) return;
    const interior = this.deps.site.interior;
    const isInterior = (x: number, y: number): boolean =>
      x >= interior.x &&
      y >= interior.y &&
      x < interior.x + interior.w &&
      y < interior.y + interior.h;
    for (const body of this.deps.bodies()) {
      const standingTile = bodyTile(body);
      const wallTile = blockedTiles.get(tileCoordKey(standingTile.x, standingTile.y));
      if (wallTile === undefined) continue;
      const leansToward = leanFromTileCentre(body, wallTile);
      const safe =
        (leansToward === null
          ? null
          : findNearbyWalkableTile(
              gameMap,
              wallTile.x,
              wallTile.y,
              WALL_UNSTICK_SEARCH_RADIUS_TILES,
              leansToward,
            )) ??
        findNearbyWalkableTile(
          gameMap,
          wallTile.x,
          wallTile.y,
          WALL_UNSTICK_SEARCH_RADIUS_TILES,
          isInterior,
        ) ??
        findNearbyWalkableTile(gameMap, wallTile.x, wallTile.y, WALL_UNSTICK_SEARCH_RADIUS_TILES);
      if (safe !== null) body.place(safe.x * TILE_SIZE, safe.y * TILE_SIZE);
    }
  }

  // ── Carl's hammering ────────────────────────────────────────────────────

  private targetCentre(target: StructureRef | PlannedFootprint): { x: number; y: number } | null {
    const tiles = isPlannedFootprint(target)
      ? footprintTiles(target)
      : this.deps.defense.footprintOf(target);
    if (tiles.length === 0) return null;
    const human = this.deps.human;
    const standingX = human.x + TILE_SIZE / 2;
    const standingY = human.y + TILE_SIZE / 2;
    let best = tiles[0];
    let bestDistance = Infinity;
    for (const tile of tiles) {
      const distance = Math.hypot(
        (tile.x + TILE_CENTRE) * TILE_SIZE - standingX,
        (tile.y + TILE_CENTRE) * TILE_SIZE - standingY,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tile;
      }
    }
    return { x: (best.x + TILE_CENTRE) * TILE_SIZE, y: (best.y + TILE_CENTRE) * TILE_SIZE };
  }

  /**
   * Down on one knee, then the hammering loop whose landing frames strike the
   * hammer; a repair plays the repair loop instead. Refused mid-blow, in which
   * case the job is heard on the fixed cadence.
   */
  private startHammering(human: HumanPlayer, repair: boolean): void {
    const job = this._job;
    if (job === null) return;
    const centre = this.targetCentre(job.target);
    const toX = centre === null ? human.facingX : centre.x - (human.x + TILE_SIZE / 2);
    const toY = centre === null ? human.facingY : centre.y - (human.y + TILE_SIZE / 2);
    const distance = Math.hypot(toX, toY);
    const faceX = distance > 0 ? toX / distance : human.facingX;
    const faceY = distance > 0 ? toY / distance : human.facingY;
    const hammering: Hammering = { human, view: viewForFacing(faceX, faceY), faceX, faceY, repair };
    if (repair) {
      this.hammering = hammering;
      this.loopHammering(hammering);
      return;
    }
    const kneeling = human.playAction(BUILD_KNEEL_ROWS[hammering.view], {
      faceX,
      faceY,
      onEnd: (reason) => {
        if (this.hammering !== hammering) return;
        if (reason === 'finished' && this._job !== null) this.loopHammering(hammering);
        else this.hammering = null;
      },
    });
    this.hammering = kneeling ? hammering : null;
  }

  private loopHammering(hammering: Hammering): void {
    const row = hammering.repair ? REPAIR_ROWS[hammering.view] : BUILD_ROWS[hammering.view];
    const strikes = humanRowOf(row)?.eventFrames?.strike ?? [];
    const looping = hammering.human.playAction(row, {
      faceX: hammering.faceX,
      faceY: hammering.faceY,
      loop: true,
      onFrame: strikes.map((frame) => ({
        frame,
        run: (): void => {
          this.deps.audio?.play(HAMMER_SOUND);
        },
      })),
      onEnd: () => {
        if (this.hammering === hammering) this.hammering = null;
      },
    });
    if (!looping) this.hammering = null;
  }

  private endHammering(): void {
    const hammering = this.hammering;
    if (hammering === null) return;
    this.hammering = null;
    hammering.human.stopAction();
    if (hammering.repair) return;
    hammering.human.playAction(BUILD_RISE_ROWS[hammering.view], {
      faceX: hammering.faceX,
      faceY: hammering.faceY,
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** The progress bar over the job's target, in world space. */
  renderJob(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const job = this._job;
    if (job === null) return;
    const tiles = isPlannedFootprint(job.target)
      ? footprintTiles(job.target)
      : this.deps.defense.footprintOf(job.target);
    if (tiles.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const tile of tiles) {
      minX = Math.min(minX, tile.x);
      maxX = Math.max(maxX, tile.x + 1);
      minY = Math.min(minY, tile.y);
    }
    const centreX = ((minX + maxX) / 2) * TILE_SIZE - camX;
    const top = minY * TILE_SIZE - camY - PROGRESS_BAR_LIFT;
    drawProgressBar(ctx, {
      x: centreX - PROGRESS_BAR_WIDTH / 2,
      y: top,
      width: PROGRESS_BAR_WIDTH,
      height: PROGRESS_BAR_HEIGHT,
      value: 1 - job.framesLeft / job.totalFrames,
      ...PROGRESS_PRESETS.build,
    });
  }

  /** How far a trebuchet under construction has risen, for its scaffold art; null when it is not being built. */
  scaffoldProgress(): { footprint: PlannedFootprint; progress: number } | null {
    const job = this._job;
    if (job === null || !isPlannedFootprint(job.target) || job.target.kind !== 'trebuchet')
      return null;
    return { footprint: job.target, progress: 1 - job.framesLeft / job.totalFrames };
  }

  dispose(): void {
    this.cancelJob();
    this.endHammering();
    this.syncRepairLoop();
  }
}

function timeFactor(level: number): number {
  return constructionTimeFactor(level);
}

/**
 * Which side of `wallTile` a body's centre already leans toward, as an
 * acceptance test for {@link findNearbyWalkableTile} — true for a candidate
 * tile that sits further out along that lean than `wallTile` itself. Compares
 * whichever axis the body's off-centre offset is larger on, since that is the
 * wall's short axis wherever the body is not standing dead centre of the
 * tile; ties (dead centre) return null so the caller can fall back to another
 * tiebreak instead of guessing an axis.
 */
function leanFromTileCentre(
  body: { x: number; y: number },
  wallTile: { x: number; y: number },
): ((x: number, y: number) => boolean) | null {
  const dx = body.x + TILE_SIZE / 2 - (wallTile.x + TILE_CENTRE) * TILE_SIZE;
  const dy = body.y + TILE_SIZE / 2 - (wallTile.y + TILE_CENTRE) * TILE_SIZE;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = Math.sign(dx);
    return (x: number): boolean => Math.sign(x - wallTile.x) === sign;
  }
  const sign = Math.sign(dy);
  return (_x: number, y: number): boolean => Math.sign(y - wallTile.y) === sign;
}

/** The tile of `tiles` nearest to the world pixel (`originX`, `originY`), or null when the list is empty. */
function nearestTile(
  originX: number,
  originY: number,
  tiles: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const tile of tiles) {
    const distance = Math.hypot(
      (tile.x + TILE_CENTRE) * TILE_SIZE - originX,
      (tile.y + TILE_CENTRE) * TILE_SIZE - originY,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  }
  return best;
}

/** How far up the ladder each standing tier is; anything else is below a wooden wall. */
const TIER_RANK: Readonly<Record<string, number>> = { wood: 1, stone: 2, fortified: 3 };

function tierRank(tier: string): number {
  return TIER_RANK[tier] ?? 0;
}

function tierPhrase(tier: string): string {
  switch (tier) {
    case 'wood':
      return 'a wooden wall';
    case 'stone':
      return 'a stone wall';
    case 'fortified':
      return 'fortified';
    default:
      return 'a wall';
  }
}

/** Build XP a structure is worth, which a repair earns a share of. */
function buildXpOf(defense: DefenseStructures, ref: StructureRef): number {
  switch (ref.kind) {
    case 'segment': {
      const tier = defense.segmentTier(ref.id);
      if (tier === 'breach') {
        const record = defense.record(ref);
        return record?.kind === 'segment' ? wallTierXp(record.formerTier ?? 'wood') : 0;
      }
      if (tier === 'gap') return 0;
      return wallTierXp(tier);
    }
    case 'trebuchet':
      return CONSTRUCTION_XP.trebuchet;
    case 'snare':
      return CONSTRUCTION_XP.snare;
    // Mended with boards, like a wooden wall, and worth what mending one is.
    case 'bell':
      return wallTierXp('wood');
    case 'gate':
      return 0;
  }
}

/** Seconds a repair of `ref` takes at level 1. */
function repairBaseSeconds(defense: DefenseStructures, ref: StructureRef): number {
  switch (ref.kind) {
    case 'segment': {
      const tier = defense.segmentTier(ref.id);
      const record = defense.record(ref);
      const standing =
        tier === 'breach' && record?.kind === 'segment' ? (record.formerTier ?? 'wood') : tier;
      if (standing === 'gap' || standing === 'breach') return 0;
      return WALL_TIERS[standing].repairSeconds;
    }
    case 'trebuchet':
      return TREBUCHET_REPAIR_SECONDS;
    case 'snare':
      return SNARE_REPAIR_SECONDS;
    case 'bell':
      return HOLLOW_BELL_REPAIR_SECONDS;
    case 'gate':
      return 0;
  }
}

/**
 * The Construction menu's rows indoors, where nothing can be built: every row
 * priced and timed for the active crawler, as outdoors, and every one
 * disabled with "Build outdoors" — the menu still teaches what is on offer.
 */
export function indoorsConstructionSource(
  human: HumanPlayer,
  cat: CatPlayer,
): ConstructionMenuSource {
  const rows = (): OptionStatus[] => {
    const active = human.isActive ? human : cat;
    const skills = active.craftSkills;
    const level = skills.isLearned('construction') ? skills.getLevel('construction') : 0;
    // Indoors there is never a wall to face, so the wall rows never apply —
    // only the trebuchet and the snare are worth listing, both disabled the
    // same "Build outdoors" way.
    return BUILD_OPTIONS.filter((option) => !isWallOption(option)).map((option) => {
      const { cost: baseCost, seconds: baseSeconds } = optionBase(option);
      const cost = discountedCost(baseCost, level);
      return {
        option,
        label: OPTION_LABELS[option],
        enabled: false,
        status: 'Build outdoors',
        cost,
        baseCost,
        affordable: canAfford(human, cat, cost),
        seconds: baseSeconds * timeFactor(level),
        kits: 0,
        usesKit: false,
      };
    });
  };
  return { rows, start: () => false, setPreview: () => undefined };
}

/** A row's undiscounted price and its level-1 build time. */
function optionBase(option: BuildOption): { cost: ResourceCost; seconds: number } {
  switch (option) {
    case 'trebuchet':
      return { cost: TREBUCHET_BUILD_COST, seconds: TREBUCHET_BUILD_SECONDS };
    case 'snare':
      return { cost: SNARE_BUILD_COST, seconds: SNARE_BUILD_SECONDS };
    case 'wood':
    case 'stone':
    case 'fortified': {
      const tier = WALL_TIERS[WALL_OPTION_TIER[option]];
      return { cost: tier.upgradeCost ?? {}, seconds: tier.buildSeconds };
    }
  }
}
