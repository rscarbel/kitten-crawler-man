/**
 * The in-world "how" for Briar Hollow's questlines: once `VillageQuestSystem`
 * or `BlueprintsQuestSystem` decides a step needs a hands-on action rather
 * than a conversation, this
 * picks the exact tree, rock, station, wall segment or trebuchet the step
 * means and draws the highlight, the tool icon, the down-arrow and the
 * caption over it.
 *
 * Rebuilt every tick from `guidance()`, the same way a tracker entry is: the
 * chosen node is cached and revalidated rather than searched fresh every
 * frame, but nothing here is durable, so a felled tree, a drained quarry or a
 * fence upgraded mid-step is simply picked again next tick.
 *
 * `target()` is the seam back out: `VillageQuestSystem.trackerEntries()`
 * takes it as the step's `TrackerTarget`, so the Journal's chevron and the
 * pinned world arrow point at the same thing this system is highlighting.
 */

import { TILE_SIZE } from '../../core/constants';
import { ITEM_DEF, type ItemId } from '../../core/ItemDefs';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite, PalisadeSegmentDef } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { ROCK_DEPOSIT } from '../../map/tileTypes';
import { drawItemIcon } from '../../ui/icons/drawItemIcon';
import {
  drawAreaHighlightFrame,
  drawAreaHighlightGround,
  type AreaHighlightOptions,
} from '../../ui/AreaHighlight';
import { drawRequirementRow, type Requirement } from '../../ui/RequirementRow';
import { drawBouncingArrowAboveEntity } from '../../ui/WorldArrow';
import { actionPrompt, activeInputMode } from '../../ui/core/inputMode';
import { worldPalette, type WorldTextStyleId } from '../../ui/theme/worldInk';
import { worldText } from '../../ui/world/worldText';
import type { Rect } from '../../ui/core/geom';
import { tileKey } from '../tileKey';
import type { TrackerTarget } from '../questTracker';
import type { DefenseStructures } from './DefenseStructures';
import { HARVEST_REACH_TILES } from './HarvestSystem';
import { harvestKindAt, regrowTree, restoreRock } from './harvestNodes';
import { HOLLOW_BELL_FOOTPRINT_TILES } from './hollowBell';
import {
  processingStationsOf,
  stationArtTopTileY,
  type ProcessingStation,
  type ProcessingStationKind,
} from './processingStations';
import {
  pointedGuidanceTarget,
  type GuidanceProgress,
  type PointedGuidance,
  type ProcessingStationId,
  type QuestGuidance,
  type StationGuidance,
  type TileRect as GuidanceZone,
} from './questGuidance';
import { TREBUCHET_HEIGHT_TILES, TREBUCHET_WIDTH_TILES } from './structureRules';
import { drawEscortTrail } from './blueprints/escortRouteMarkers';

type Crawler = HumanPlayer | CatPlayer;

/** A tile rectangle in the shapes this system reads off the site and off `DefenseStructures`. */
interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface VillageQuestGuideDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly defense: DefenseStructures;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /** Lazy: read fresh every tick, since the questline that owns it is rebuilt with the kit. */
  readonly guidance: () => QuestGuidance | null;
  /**
   * Whether `ConstructionKit`'s own "load with stone" / "open menu" prompt is
   * already on screen for the trebuchet at `at` — the same reach rule that
   * shows it. This guide's own caption yields to it rather than stacking a
   * second one over the same trebuchet.
   */
  readonly isDefaultTrebuchetPromptShowing: (at: TilePoint) => boolean;
  /** The wall's own build/repair prompt, by the same rule, for the fence step. */
  readonly isDefaultWallPromptShowing: () => boolean;
  /**
   * Whether another questline marks the machine making `kind` itself, with
   * its own highlight and caption — the Blueprints quest's stations still to
   * upgrade. This guide then draws no highlight of its own there. Its arrow
   * and "process" caption still show while the guidance is the Plea's, whose
   * need that other caption does not list; see
   * {@link showingSideQuestGuidance}.
   */
  readonly questMarksStation: (kind: ProcessingStationKind) => boolean;
  /**
   * The top edge, in world pixels, of that other questline's caption over
   * the machine making `kind`, or null while none stands there: this guide's
   * arrow and caption stack above it rather than over it.
   */
  readonly questStationCaptionTopWorldY: (kind: ProcessingStationKind) => number | null;
  /**
   * Whether `guidance()` is currently the Blueprints quest's rather than the
   * Plea's. A "process" shortfall of the Blueprints quest's own is already
   * the checklist on its station caption, so this guide says nothing more at
   * a station that quest marks.
   */
  readonly showingSideQuestGuidance: () => boolean;
}

/** How close the active crawler must stand to a chosen tree or rock to count as working it. */
const WORKING_REACH_TILES = HARVEST_REACH_TILES;

/** How long a chop or mine counter stays up after the last gain, before the plain prompt returns. */
const RECENT_HARVEST_GRACE_SECONDS = 4;
const TICKS_PER_SECOND = 60;
const RECENT_HARVEST_GRACE_TICKS = RECENT_HARVEST_GRACE_SECONDS * TICKS_PER_SECOND;

/** How often the nearest fence segment is re-picked, so walking near a second one doesn't flicker the highlight. */
const FENCE_REPICK_INTERVAL_SECONDS = 1;
const FENCE_REPICK_INTERVAL_TICKS = FENCE_REPICK_INTERVAL_SECONDS * TICKS_PER_SECOND;

const TILE_CENTRE = 0.5;

/** How many of the target resource the player must have collected this step before the caption switches to "Keep collecting". */
const KEEP_COLLECTING_THRESHOLD = 2;

/** The chosen tree's highlight is drawn oversized so it reads at a glance among the rest of the grove; the rock keeps the default one-tile size. */
const TREE_HIGHLIGHT_SCALE = 1.5;

/** Matches the gold `WorldArrow`/`ObjectiveBeacon` colour everywhere else in the game points at something. */
const GUIDE_COLOR = worldPalette.objective.ready;

/** A `drawAreaHighlight*` call's look, without its clock. */
type HighlightStyle = Pick<AreaHighlightOptions, 'color' | 'mood'>;
const GUIDE_HIGHLIGHT_STYLE: HighlightStyle = { color: GUIDE_COLOR, mood: 'ready' };
/** The waypoints past the one in hand on Midge's road, and the pasture at its end: there, but not yet. */
const ESCORT_AHEAD_HIGHLIGHT_STYLE: HighlightStyle = { color: GUIDE_COLOR, mood: 'pending' };
/** The waypoint in hand is framed wider than its one tile, so it reads as a place on a wide road. */
const ESCORT_WAYPOINT_HIGHLIGHT_TILES = 2;

const ICON_LIFT_TILES = 2.4;
const ICON_SIZE_TILES = 0.8;
const CAPTION_LIFT_TILES = 3.1;
const CAPTION_LIFT_NO_ICON_TILES = 2.4;
/**
 * High enough that even a two-line footprint caption clears the bouncing
 * arrow's own highest bounce, with headroom to spare — the arrow occupies
 * roughly one to two tiles above the footprint's top row, and a caption
 * hugging that band reads as overlapping it.
 */
const FOOTPRINT_CAPTION_LIFT_TILES = 3.0;
const CAPTION_LINE_GAP_PX = 13;
/** Roughly half the label preset's line height, so a one-line zone caption sits centred rather than hanging below the zone's middle. */
const ZONE_LABEL_VERTICAL_OFFSET_PX = 6;

/**
 * Green, and drawn `pending` — a dashed outline — because the zones are
 * suggestions for where to build, not a thing already there to act on.
 */
const BUILD_ZONE_COLOR = worldPalette.village.buildZone;

const HUD_ARROW_BOUNCE_FREQUENCY = 0.005;
const HUD_ARROW_BOUNCE_AMPLITUDE_PX = 4;
const HUD_ARROW_LENGTH_PX = 14;
const HUD_ARROW_HALF_WIDTH_PX = 8;
const HUD_ARROW_OUTLINE_WIDTH_PX = 1.5;
const HUD_ARROW_GAP_ABOVE_BUTTON_PX = 8;
const HUD_CAPTION_GAP_PX = 4;

const STATION_ID_TO_KIND: Readonly<Record<ProcessingStationId, ProcessingStationKind>> = {
  saw: 'boards',
  rope_walk: 'rope',
};

/** What each station makes, as its count is labelled under the caption. */
const STATION_OUTPUT_LABEL: Readonly<Record<ProcessingStationId, string>> = {
  saw: 'Boards',
  rope_walk: 'Rope',
};

const STATION_CAPTION_TITLE: Readonly<Record<ProcessingStationId, string>> = {
  saw: 'Process wood at the saw',
  rope_walk: 'Process wood at the rope walk',
};

interface HarvestGuideCache {
  readonly kind: 'chop' | 'mine';
  readonly insideYard: boolean;
  readonly tile: TilePoint | null;
  readonly progress: GuidanceProgress;
  readonly showCounter: boolean;
}

interface MatchedStation {
  readonly id: ProcessingStationId;
  readonly station: ProcessingStation;
  readonly progress: GuidanceProgress;
}

type GuideCache =
  | HarvestGuideCache
  | { readonly kind: 'process'; readonly stations: readonly MatchedStation[] }
  | { readonly kind: 'build_trebuchet'; readonly zones: readonly GuidanceZone[] }
  | { readonly kind: 'load_trebuchet'; readonly at: TilePoint }
  | { readonly kind: 'upgrade_wall'; readonly tile: TilePoint | null }
  | { readonly kind: 'repair_bell' }
  | { readonly kind: 'pointed'; readonly guidance: PointedGuidance };

const POINTED_STATION_CAPTION: Readonly<Record<ProcessingStationId, string>> = {
  saw: 'Upgrade the saw',
  rope_walk: 'Upgrade the rope walk',
};

export class VillageQuestGuide {
  private readonly centreGroveTile: TilePoint | null;
  private readonly quarryRockTiles: readonly TilePoint[];
  private readonly upperLeftQuarryTile: TilePoint | null;

  private cache: GuideCache | null = null;
  private lastGuidanceKind: QuestGuidance['kind'] | null = null;
  private lastHarvestHave: number | null = null;
  private harvestGraceTicksLeft = 0;
  private fenceRepickTicksLeft = 0;
  private chosenFenceTile: TilePoint | null = null;

  constructor(private readonly deps: VillageQuestGuideDeps) {
    const yard = deps.site.lumberYard;
    this.centreGroveTile = nearestTileTo(yard.groveTiles, rectCentre(yard.rect));
    this.quarryRockTiles = [...deps.site.quarry.depositTiles, ...deps.site.quarry.stubTiles];
    this.upperLeftQuarryTile = upperLeftMost(this.quarryRockTiles);
  }

  /** Advances the picked target and its timers by one fixed-timestep update. */
  update(): void {
    const guidance = this.deps.guidance();
    const kind = guidance?.kind ?? null;
    if (kind !== this.lastGuidanceKind) {
      this.lastHarvestHave = null;
      this.harvestGraceTicksLeft = 0;
      this.lastGuidanceKind = kind;
    }
    this.cache = guidance === null ? null : this.buildCache(guidance);
  }

  private buildCache(guidance: QuestGuidance): GuideCache {
    switch (guidance.kind) {
      case 'chop':
        return this.updateHarvestGuide('chop', guidance.progress);
      case 'mine':
        return this.updateHarvestGuide('mine', guidance.progress);
      case 'process':
        return { kind: 'process', stations: this.matchStations(guidance.stations) };
      case 'build_trebuchet':
        return { kind: 'build_trebuchet', zones: guidance.zones };
      case 'load_trebuchet':
        return { kind: 'load_trebuchet', at: guidance.at };
      case 'upgrade_wall':
        return { kind: 'upgrade_wall', tile: this.pickFenceTile() };
      case 'repair_bell':
        return { kind: 'repair_bell' };
      case 'fence_section':
      case 'scythe':
      case 'grain_field':
      case 'lead_midge':
      case 'escort_waypoint':
      case 'pasture':
      case 'station_upgrade':
      case 'town_building':
        return { kind: 'pointed', guidance };
    }
  }

  // ── Chop / mine ──────────────────────────────────────────────────────────

  private updateHarvestGuide(
    which: 'chop' | 'mine',
    progress: GuidanceProgress,
  ): HarvestGuideCache {
    const site = this.deps.site;
    const yardRect = which === 'chop' ? site.lumberYard.rect : site.quarry.rect;
    const insideYard = this.insideRect(yardRect);

    // The rock is picked even before the player reaches the quarry, so the
    // world arrow already points at it rather than at the quarry entrance —
    // pointing at the entrance instead swings the arrow around when the
    // player approaches from off to one side. The tree stays yard-gated: it
    // isn't picked (and so isn't the target) until the player is inside.
    let tile: TilePoint | null = which === 'mine' ? this.pickRockTile() : null;
    if (insideYard) {
      if (which === 'chop') tile = this.pickTreeTile();
      if (tile === null) {
        if (which === 'chop') this.tryForceRegrowTree();
        else this.tryForceRegrowRock();
        // Regrowth is instant when it succeeds, so a fresh pick can find it the same tick.
        tile = which === 'chop' ? this.pickTreeTile() : this.pickRockTile();
      }
    }

    const have = progress.have;
    if (this.lastHarvestHave !== null && have > this.lastHarvestHave) {
      this.harvestGraceTicksLeft = RECENT_HARVEST_GRACE_TICKS;
    }
    this.lastHarvestHave = have;
    const withinReach = tile !== null && this.tileDistanceFromActive(tile) <= WORKING_REACH_TILES;
    const showCounter = withinReach && this.harvestGraceTicksLeft > 0;
    if (this.harvestGraceTicksLeft > 0) this.harvestGraceTicksLeft -= 1;

    return { kind: which, insideYard, tile, progress, showCounter };
  }

  private pickTreeTile(): TilePoint | null {
    const preferred = this.centreGroveTile;
    if (preferred === null) return null;
    if (harvestKindAt(this.deps.gameMap, preferred.x, preferred.y) === 'wood') return preferred;
    return this.nearestStanding(this.deps.site.lumberYard.groveTiles, preferred, 'wood');
  }

  private pickRockTile(): TilePoint | null {
    const preferred = this.upperLeftQuarryTile;
    if (preferred === null) return null;
    if (harvestKindAt(this.deps.gameMap, preferred.x, preferred.y) === 'stone') return preferred;
    return this.nearestStanding(this.quarryRockTiles, preferred, 'stone');
  }

  private nearestStanding(
    tiles: readonly TilePoint[],
    from: TilePoint,
    kind: 'wood' | 'stone',
  ): TilePoint | null {
    let best: TilePoint | null = null;
    let bestDistSq = Infinity;
    for (const tile of tiles) {
      if (harvestKindAt(this.deps.gameMap, tile.x, tile.y) !== kind) continue;
      const dx = tile.x - from.x;
      const dy = tile.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = tile;
      }
    }
    return best;
  }

  /** A bare grove: stands the centre tree back up outright rather than waiting on the slow, natural regrowth. */
  private tryForceRegrowTree(): void {
    const tile = this.centreGroveTile;
    if (tile === null || !this.tileIsClear(tile)) return;
    regrowTree(this.deps.gameMap, tile.x, tile.y, this.deps.onTileChanged);
    this.deps.state.nodes.delete(tileKey(tile.x, tile.y));
  }

  /** A bare quarry: symmetrical with {@link tryForceRegrowTree}, since the same instant stand-up applies. */
  private tryForceRegrowRock(): void {
    const tile = this.upperLeftQuarryTile;
    if (tile === null || !this.tileIsClear(tile)) return;
    restoreRock(this.deps.gameMap, tile.x, tile.y, ROCK_DEPOSIT, this.deps.onTileChanged);
    this.deps.state.nodes.delete(tileKey(tile.x, tile.y));
  }

  /** Walkable and not stood on by either crawler — the only bodies likely to be on a bare work-yard tile. */
  private tileIsClear(tile: TilePoint): boolean {
    if (!this.deps.gameMap.isWalkable(tile.x, tile.y)) return false;
    return !this.crawlerOnTile(this.deps.human, tile) && !this.crawlerOnTile(this.deps.cat, tile);
  }

  private crawlerOnTile(crawler: Crawler, tile: TilePoint): boolean {
    const centreTile = tileOf(crawler);
    return centreTile.x === tile.x && centreTile.y === tile.y;
  }

  // ── Processing stations ──────────────────────────────────────────────────

  /**
   * The processing stations this step is asking for, if any — so a caller like
   * the sawmill's far indicator can keep a station's badge lit through the
   * step even once the player is standing right on top of it.
   */
  activeProcessStationKinds(): readonly ProcessingStationKind[] {
    return this.cache?.kind === 'process'
      ? this.cache.stations.map((entry) => entry.station.kind)
      : [];
  }

  private matchStations(stations: readonly StationGuidance[]): MatchedStation[] {
    const all = processingStationsOf(this.deps.site);
    const out: MatchedStation[] = [];
    for (const entry of stations) {
      const kind = STATION_ID_TO_KIND[entry.station];
      const station = all.find((candidate) => candidate.kind === kind);
      if (station !== undefined) out.push({ id: entry.station, station, progress: entry.progress });
    }
    return out;
  }

  // ── Fences ───────────────────────────────────────────────────────────────

  private pickFenceTile(): TilePoint | null {
    if (this.fenceRepickTicksLeft > 0) {
      this.fenceRepickTicksLeft -= 1;
      return this.chosenFenceTile;
    }
    this.fenceRepickTicksLeft = FENCE_REPICK_INTERVAL_TICKS;
    const activeTile = this.activeTile();
    let best: PalisadeSegmentDef | null = null;
    let bestDistSq = Infinity;
    for (const segment of this.deps.defense.segments) {
      if (this.deps.defense.segmentTier(segment.id) !== 'fence') continue;
      const mid = segmentMidTile(segment);
      if (mid === null) continue;
      const dx = mid.x - activeTile.x;
      const dy = mid.y - activeTile.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = segment;
      }
    }
    this.chosenFenceTile = best === null ? null : segmentMidTile(best);
    return this.chosenFenceTile;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /**
   * The ground half of every highlight — the edge wash, outline, sparks and
   * motes of `drawAreaHighlightGround` — under every body, the same "behind,
   * not over" order a quest NPC draws its own column in, so the tree, rock or
   * machine being marked stands in front of its own light.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cache = this.cache;
    if (cache === null) return;
    switch (cache.kind) {
      case 'chop':
      case 'mine': {
        const area = this.harvestHighlightArea(cache);
        if (area !== null) this.renderGroundHighlight(ctx, camX, camY, area);
        return;
      }
      case 'process':
        for (const entry of this.unmarkedStations(cache.stations)) {
          this.renderGroundHighlight(ctx, camX, camY, entry.station.footprint);
        }
        return;
      case 'build_trebuchet':
        for (const zone of cache.zones) {
          this.renderGroundHighlight(ctx, camX, camY, zoneToFootprint(zone), {
            color: BUILD_ZONE_COLOR,
            mood: 'pending',
          });
        }
        return;
      case 'load_trebuchet':
        this.renderGroundHighlight(ctx, camX, camY, trebuchetFootprint(cache.at));
        return;
      case 'upgrade_wall':
        if (cache.tile !== null) this.renderGroundHighlight(ctx, camX, camY, tileArea(cache.tile));
        return;
      case 'repair_bell':
        this.renderGroundHighlight(ctx, camX, camY, this.bellFootprint());
        return;
      case 'pointed': {
        if (cache.guidance.kind === 'escort_waypoint') {
          this.renderEscortRouteGround(ctx, camX, camY, cache.guidance);
        }
        const area = this.pointedHighlightArea(cache.guidance);
        if (area !== null) this.renderGroundHighlight(ctx, camX, camY, area);
        return;
      }
    }
  }

  /** The frame half of every highlight, then every arrow, icon and caption, drawn over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cache = this.cache;
    if (cache === null) return;
    switch (cache.kind) {
      case 'chop':
        this.renderHarvestGuide(
          ctx,
          camX,
          camY,
          cache,
          'basic_axe',
          'collect wood',
          'wood collected',
        );
        break;
      case 'mine':
        this.renderHarvestGuide(ctx, camX, camY, cache, 'basic_pickaxe', 'mine', 'stone mined');
        break;
      case 'process':
        for (const entry of cache.stations) this.renderStation(ctx, camX, camY, entry);
        break;
      case 'load_trebuchet':
        this.renderTrebuchetLoad(ctx, camX, camY, cache.at);
        break;
      case 'upgrade_wall':
        if (cache.tile !== null) this.renderUpgradeWall(ctx, camX, camY, cache.tile);
        break;
      case 'repair_bell':
        this.renderBell(ctx, camX, camY);
        break;
      case 'build_trebuchet':
        // The HUD arrow over the Construction button is drawn from `renderConstructionHint`.
        this.renderTrebuchetZoneLabels(ctx, camX, camY, cache.zones);
        break;
      case 'pointed':
        this.renderPointedGuide(ctx, camX, camY, cache.guidance);
        break;
    }
  }

  /**
   * The tile area a place a questline pointed at directly is highlighted
   * over: the whole field, the whole pasture, the fence run's full length.
   * Midge and a town door get none: she wears her own marker, and the scene's
   * objective beacon stands on the doorway. A station the quest marks itself
   * gets none either.
   */
  private pointedHighlightArea(guidance: PointedGuidance): Footprint | null {
    switch (guidance.kind) {
      case 'fence_section':
        return tilesBoundingArea(guidance.tiles);
      case 'scythe':
        return tileArea(guidance.at);
      case 'grain_field':
        return zoneToFootprint(guidance.field);
      case 'pasture':
        return zoneToFootprint(guidance.yard);
      case 'station_upgrade':
        return this.stationMarkedByQuest(guidance.station)
          ? null
          : zoneToFootprint(guidance.footprint);
      case 'escort_waypoint':
        return centredArea(guidance.at, ESCORT_WAYPOINT_HIGHLIGHT_TILES);
      case 'lead_midge':
      case 'town_building':
        return null;
    }
  }

  /** The frame, arrow and caption over a place a questline pointed at directly. */
  private renderPointedGuide(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    guidance: PointedGuidance,
  ): void {
    const area = this.pointedHighlightArea(guidance);
    if (area !== null) this.renderFrameHighlight(ctx, camX, camY, area);
    switch (guidance.kind) {
      case 'fence_section': {
        const target = pointedGuidanceTarget(guidance);
        if (target === null) return;
        const progress = `${guidance.progress.have}/${guidance.progress.target} sections`;
        this.renderPointArrowAndCaption(ctx, camX, camY, target, null, [
          'Rebuild this fence section',
          progress,
        ]);
        return;
      }
      case 'scythe':
        this.renderPointArrowAndCaption(ctx, camX, camY, guidance.at, null, [
          "Take Merrit's scythe",
        ]);
        return;
      case 'grain_field': {
        const progress = `${guidance.progress.have}/${guidance.progress.target} grain`;
        this.renderFootprintArrowAndCaption(ctx, camX, camY, zoneToFootprint(guidance.field), [
          'Harvest grain',
          progress,
        ]);
        return;
      }
      case 'pasture':
        this.renderFootprintArrowAndCaption(ctx, camX, camY, zoneToFootprint(guidance.yard), [
          "Lead Midge into Wendell's pasture",
        ]);
        return;
      case 'station_upgrade': {
        // The quest's own frame and caption over the machine already say
        // "Upgrade", with its checklist; an arrow here would land on that caption.
        if (this.stationMarkedByQuest(guidance.station)) return;
        const footprint = zoneToFootprint(guidance.footprint);
        this.renderFootprintArrowAndCaption(ctx, camX, camY, footprint, [
          POINTED_STATION_CAPTION[guidance.station],
        ]);
        return;
      }
      case 'escort_waypoint':
        this.renderPointArrowAndCaption(ctx, camX, camY, guidance.at, null, [
          guidance.ahead.length === 0
            ? "Lead Midge into Wendell's pasture"
            : 'Lead Midge along the road',
        ]);
        return;
      case 'lead_midge':
      case 'town_building':
        return;
    }
  }

  /**
   * Under the waypoint in hand: the dotted road leading to it and on past it,
   * the next waypoints in the quieter pending voice, and the pasture itself,
   * so the destination is framed as soon as it comes into view.
   */
  private renderEscortRouteGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    guidance: Extract<PointedGuidance, { readonly kind: 'escort_waypoint' }>,
  ): void {
    drawEscortTrail(ctx, guidance.trail, camX, camY, performance.now());
    for (const tile of guidance.ahead) {
      this.renderGroundHighlight(ctx, camX, camY, tileArea(tile), ESCORT_AHEAD_HIGHLIGHT_STYLE);
    }
    this.renderGroundHighlight(
      ctx,
      camX,
      camY,
      zoneToFootprint(guidance.yard),
      ESCORT_AHEAD_HIGHLIGHT_STYLE,
    );
  }

  /**
   * "Build trebuchet here", centred in each zone. This guidance's own
   * `target()` marks itself `wearsOwnMarker` so the pinned objective beacon
   * never stands in the zone too — a whole patch of buildable ground has no
   * single tile for that beacon to stand on, so the dashed outline and this
   * label take its place.
   */
  private renderTrebuchetZoneLabels(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    zones: readonly GuidanceZone[],
  ): void {
    for (const zone of zones) {
      const centreX = (zone.x + zone.width / 2) * TILE_SIZE - camX;
      const centreY = (zone.y + zone.height / 2) * TILE_SIZE - camY;
      worldText(ctx, 'Build trebuchet here', {
        x: centreX,
        y: centreY - ZONE_LABEL_VERTICAL_OFFSET_PX,
        align: 'center',
        style: 'label',
      });
    }
  }

  /**
   * The chosen tree or rock's highlight: the tree's drawn oversized, so it
   * reads at a glance among the rest of the grove, and centred on its tile.
   */
  private harvestHighlightArea(cache: HarvestGuideCache): Footprint | null {
    if (!cache.insideYard || cache.tile === null) return null;
    return cache.kind === 'chop'
      ? centredArea(cache.tile, TREE_HIGHLIGHT_SCALE)
      : tileArea(cache.tile);
  }

  private renderHarvestGuide(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cache: HarvestGuideCache,
    icon: ItemId,
    collectVerb: string,
    countedNoun: string,
  ): void {
    const area = this.harvestHighlightArea(cache);
    if (area === null || cache.tile === null) return;
    // The frame stays at the tree's foot rather than rising round its canopy,
    // where the arrow bouncing over the tree would land on its top brackets.
    this.renderFrameHighlight(ctx, camX, camY, area);
    if (cache.showCounter) {
      const countLine = `${cache.progress.have}/${cache.progress.target} ${countedNoun}`;
      const keepCollecting = cache.progress.have >= KEEP_COLLECTING_THRESHOLD;
      const lines = keepCollecting ? ['Keep collecting', countLine] : [countLine];
      const firstLineStyle = keepCollecting ? 'label' : 'value';
      this.renderPointArrowAndCaption(ctx, camX, camY, cache.tile, null, lines, firstLineStyle);
      return;
    }
    const line = actionPrompt(activeInputMode(), { deed: collectVerb, action: 'attack' });
    this.renderPointArrowAndCaption(ctx, camX, camY, cache.tile, icon, [line]);
  }

  /**
   * The frame, arrow and caption over a station, from `renderAbove`. The
   * ground half of its highlight is drawn earlier, from `renderGround`, so
   * the machine's own sprite — drawn in the Y-sorted pass between the two —
   * sits in front of the light rather than under a wash of it. The count
   * under the title turns green with a tick once the party holds enough.
   *
   * A station the Blueprints quest is marking itself keeps that quest's
   * highlight alone. When the shortfall is that quest's own, its caption
   * already lists it and this guide says nothing there; when it is the
   * Plea's, the arrow and caption stack above that quest's caption.
   */
  private renderStation(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    entry: MatchedStation,
  ): void {
    const markedByQuest = this.stationMarkedByQuest(entry.id);
    if (markedByQuest && this.deps.showingSideQuestGuidance()) return;
    const footprint = entry.station.footprint;
    if (!markedByQuest) {
      this.renderFrameHighlight(
        ctx,
        camX,
        camY,
        footprint,
        this.stationFrameRiseTiles(entry.station),
      );
    }
    const pointedAt = this.stationGuideAnchor(entry.id, footprint);
    this.renderFootprintArrow(ctx, camX, camY, pointedAt);
    const { centreScreenX, topY } = footprintCaptionAnchor(pointedAt, camX, camY);
    worldText(ctx, STATION_CAPTION_TITLE[entry.id], {
      x: centreScreenX,
      y: topY,
      align: 'center',
      style: 'label',
    });
    const requirement: Requirement = {
      label: STATION_OUTPUT_LABEL[entry.id],
      have: entry.progress.have,
      need: entry.progress.target,
    };
    drawRequirementRow(ctx, [requirement], centreScreenX, topY + CAPTION_LINE_GAP_PX);
  }

  /**
   * The highlight always marks the trebuchet, but the arrow and "load with
   * stone" caption stand down once `ConstructionKit`'s own prompt is on
   * screen for it — the two would otherwise say the same thing on top of
   * each other.
   */
  private renderTrebuchetLoad(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    at: TilePoint,
  ): void {
    const footprint = trebuchetFootprint(at);
    this.renderFrameHighlight(ctx, camX, camY, footprint);
    if (this.deps.isDefaultTrebuchetPromptShowing(at)) return;
    const line = actionPrompt(activeInputMode(), {
      deed: 'load with stone',
      action: 'quickLoad',
      gesture: 'doubleTap',
    });
    this.renderFootprintArrowAndCaption(ctx, camX, camY, footprint, [line]);
  }

  /**
   * The highlight always marks the faced fence, but the arrow and upgrade
   * caption stand down once `ConstructionKit`'s own wall prompt is on screen
   * for it, the same way the trebuchet's load caption yields to its prompt.
   */
  private renderUpgradeWall(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tile: TilePoint,
  ): void {
    this.renderFrameHighlight(ctx, camX, camY, tileArea(tile));
    if (this.deps.isDefaultWallPromptShowing()) return;
    const line = actionPrompt(activeInputMode(), {
      deed: 'upgrade',
      action: 'attack',
      gesture: 'doubleTap',
    });
    this.renderPointArrowAndCaption(ctx, camX, camY, tile, null, [
      'Upgrade this fence to a wooden wall',
      line,
    ]);
  }

  private bellFootprint(): Footprint {
    const bell = this.deps.site.square.bellTile;
    return {
      x: bell.x,
      y: bell.y,
      w: HOLLOW_BELL_FOOTPRINT_TILES,
      h: HOLLOW_BELL_FOOTPRINT_TILES,
    };
  }

  private renderBell(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const footprint = this.bellFootprint();
    this.renderFrameHighlight(ctx, camX, camY, footprint);
    this.renderFootprintArrowAndCaption(ctx, camX, camY, footprint, ['Repair the bell tower']);
  }

  /** Whether the Blueprints quest is marking the machine `id` names itself, with its own highlight. */
  private stationMarkedByQuest(id: ProcessingStationId): boolean {
    return this.deps.questMarksStation(STATION_ID_TO_KIND[id]);
  }

  /**
   * What the arrow and caption over the station `id` stand on: its footprint,
   * or — while another questline's caption stands over the machine — that
   * caption's top edge, so they stack clear above it.
   */
  private stationGuideAnchor(id: ProcessingStationId, footprint: Footprint): Footprint {
    const otherCaptionTop = this.deps.questStationCaptionTopWorldY(STATION_ID_TO_KIND[id]);
    if (otherCaptionTop === null) return footprint;
    return { ...footprint, y: otherCaptionTop / TILE_SIZE };
  }

  /** How far a station's art stands above its footprint, in its current look, for the frame to hold all of it. */
  private stationFrameRiseTiles(station: ProcessingStation): number {
    const { x, y } = station.footprint;
    const upgraded = this.deps.gameMap.structure[y]?.[x]?.stationUpgraded === true;
    return y - stationArtTopTileY(station, upgraded);
  }

  private unmarkedStations(stations: readonly MatchedStation[]): MatchedStation[] {
    return stations.filter((entry) => !this.stationMarkedByQuest(entry.id));
  }

  /** The ground half of `area`'s highlight; see `drawAreaHighlightGround`. */
  private renderGroundHighlight(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    area: Footprint,
    style: HighlightStyle = GUIDE_HIGHLIGHT_STYLE,
  ): void {
    drawAreaHighlightGround(ctx, areaToScreen(area, camX, camY), {
      ...style,
      nowMs: performance.now(),
    });
  }

  /**
   * The frame half of `area`'s highlight, over every body, stretched
   * `riseTiles` up past the area's top so a tree's canopy or a machine's
   * whole art sits inside the brackets rather than only its footing.
   */
  private renderFrameHighlight(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    area: Footprint,
    riseTiles = 0,
  ): void {
    const raised: Footprint = {
      x: area.x,
      y: area.y - riseTiles,
      w: area.w,
      h: area.h + riseTiles,
    };
    drawAreaHighlightFrame(ctx, areaToScreen(raised, camX, camY), {
      ...GUIDE_HIGHLIGHT_STYLE,
      nowMs: performance.now(),
    });
  }

  /** The bouncing arrow, optional tool icon and caption over `tile`, without the highlight. */
  private renderPointArrowAndCaption(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tile: TilePoint,
    icon: ItemId | null,
    lines: readonly string[],
    firstLineStyle: WorldTextStyleId = 'label',
  ): void {
    const sx = tile.x * TILE_SIZE - camX;
    const sy = tile.y * TILE_SIZE - camY;
    drawBouncingArrowAboveEntity(
      ctx,
      tile.x * TILE_SIZE,
      tile.y * TILE_SIZE,
      camX,
      camY,
      GUIDE_COLOR,
    );
    const centreX = sx + TILE_SIZE * TILE_CENTRE;
    if (icon !== null) {
      const size = ICON_SIZE_TILES * TILE_SIZE;
      const iconY = sy - ICON_LIFT_TILES * TILE_SIZE;
      const half = size / 2;
      drawItemIcon(
        ctx,
        { x: centreX - half, y: iconY - half, w: size, h: size },
        { ...ITEM_DEF[icon], quantity: 1 },
      );
    }
    const captionLift = icon !== null ? CAPTION_LIFT_TILES : CAPTION_LIFT_NO_ICON_TILES;
    this.renderCaption(ctx, centreX, sy - captionLift * TILE_SIZE, lines, firstLineStyle);
  }

  private renderFootprintArrow(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    footprint: Footprint,
  ): void {
    drawBouncingArrowAboveEntity(
      ctx,
      footprintArrowWorldX(footprint),
      footprint.y * TILE_SIZE,
      camX,
      camY,
      GUIDE_COLOR,
    );
  }

  private renderFootprintArrowAndCaption(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    footprint: Footprint,
    lines: readonly string[],
    restLineStyle: WorldTextStyleId = 'hint',
  ): void {
    this.renderFootprintArrow(ctx, camX, camY, footprint);
    const { centreScreenX, topY } = footprintCaptionAnchor(footprint, camX, camY);
    this.renderCaption(ctx, centreScreenX, topY, lines, 'label', restLineStyle);
  }

  private renderCaption(
    ctx: CanvasRenderingContext2D,
    x: number,
    topY: number,
    lines: readonly string[],
    firstLineStyle: WorldTextStyleId,
    restLineStyle: WorldTextStyleId = 'hint',
  ): void {
    lines.forEach((line, index) => {
      worldText(ctx, line, {
        x,
        y: topY + index * CAPTION_LINE_GAP_PX,
        align: 'center',
        style: index === 0 ? firstLineStyle : restLineStyle,
        outline: true,
      });
    });
  }

  /**
   * The bouncing arrow and caption over the HUD's Construction button, shown
   * while a `build_trebuchet` zone has the active crawler standing in it.
   * `buildButton` is the button's rect in CSS pixels, or null while the HUD
   * shows none.
   */
  renderConstructionHint(ctx: CanvasRenderingContext2D, buildButton: Rect | null): void {
    if (buildButton === null) return;
    const guidance = this.deps.guidance();
    if (guidance?.kind !== 'build_trebuchet') return;
    if (!this.insideAnyZone(guidance.zones)) return;
    const centreX = buildButton.x + buildButton.w / 2;
    const bounce =
      Math.sin(Date.now() * HUD_ARROW_BOUNCE_FREQUENCY) * HUD_ARROW_BOUNCE_AMPLITUDE_PX;
    const tipY = buildButton.y - HUD_ARROW_GAP_ABOVE_BUTTON_PX + bounce;
    ctx.save();
    ctx.fillStyle = GUIDE_COLOR;
    ctx.strokeStyle = worldPalette.shade;
    ctx.lineWidth = HUD_ARROW_OUTLINE_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(centreX, tipY);
    ctx.lineTo(centreX - HUD_ARROW_HALF_WIDTH_PX, tipY - HUD_ARROW_LENGTH_PX);
    ctx.lineTo(centreX + HUD_ARROW_HALF_WIDTH_PX, tipY - HUD_ARROW_LENGTH_PX);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    worldText(ctx, 'Build a trebuchet', {
      x: centreX,
      y: tipY - HUD_ARROW_LENGTH_PX - HUD_CAPTION_GAP_PX,
      align: 'center',
      style: 'label',
    });
  }

  // ── Tracker target ───────────────────────────────────────────────────────

  /** Where the Journal's chevron and the pinned world arrow should point, for whichever step is live. */
  target(): TrackerTarget | null {
    const cache = this.cache;
    if (cache === null) return null;
    switch (cache.kind) {
      case 'chop':
        return this.harvestTarget(cache, this.deps.site.lumberYard.rect);
      case 'mine':
        return this.harvestTarget(cache, this.deps.site.quarry.rect);
      case 'process':
        return this.nearestStationTarget(cache.stations);
      case 'build_trebuchet':
        // wearsOwnMarker: the zone draws its own "Build trebuchet here" label
        // in `renderTrebuchetZoneLabels` rather than standing the pinned
        // beacon in a patch of ground with no single tile of its own.
        return cache.zones.length === 0
          ? null
          : { ...this.footprintTarget(zoneToFootprint(cache.zones[0])), wearsOwnMarker: true };
      case 'load_trebuchet':
        return this.selfMarkedFootprintTarget({
          x: cache.at.x,
          y: cache.at.y,
          w: TREBUCHET_WIDTH_TILES,
          h: TREBUCHET_HEIGHT_TILES,
        });
      case 'upgrade_wall':
        return cache.tile === null ? null : selfMarkedTileTarget(cache.tile);
      case 'repair_bell': {
        const bell = this.deps.site.square.bellTile;
        return this.selfMarkedFootprintTarget({
          x: bell.x,
          y: bell.y,
          w: HOLLOW_BELL_FOOTPRINT_TILES,
          h: HOLLOW_BELL_FOOTPRINT_TILES,
        });
      }
      case 'pointed':
        return pointedGuidanceTarget(cache.guidance);
    }
  }

  private harvestTarget(cache: HarvestGuideCache, yardRect: Footprint): TrackerTarget {
    if (cache.tile !== null) return selfMarkedTileTarget(cache.tile);
    if (cache.kind === 'chop') {
      const anchors = this.deps.site.villagerAnchors.lumber_yard;
      if (anchors.length > 0) {
        const anchor = anchors[0];
        return { x: anchor.x, y: anchor.y };
      }
    }
    return this.footprintTarget(yardRect);
  }

  private nearestStationTarget(stations: readonly MatchedStation[]): TrackerTarget | null {
    if (stations.length === 0) return null;
    const activeTile = this.activeTile();
    let best = stations[0];
    let bestDistSq = Infinity;
    for (const entry of stations) {
      const centre = footprintCentre(entry.station.footprint);
      const dx = centre.x - activeTile.x;
      const dy = centre.y - activeTile.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = entry;
      }
    }
    return this.selfMarkedFootprintTarget(best.station.footprint);
  }

  private footprintTarget(footprint: Footprint): TrackerTarget {
    return { x: footprint.x, y: footprint.y + footprint.h - 1, widthTiles: footprint.w };
  }

  /**
   * A footprint this guide highlights itself, beneath the thing standing on
   * it. The scene's own beacon is painted after every world entity, so letting
   * it stand here too would wash out the very tree, rock or machine the
   * guide's highlight was drawn behind.
   */
  private selfMarkedFootprintTarget(footprint: Footprint): TrackerTarget {
    return { ...this.footprintTarget(footprint), wearsOwnMarker: true };
  }

  // ── Geometry helpers ─────────────────────────────────────────────────────

  private active(): Crawler {
    return this.deps.human.isActive ? this.deps.human : this.deps.cat;
  }

  private activeTile(): TilePoint {
    return tileOf(this.active());
  }

  private insideRect(rect: Footprint): boolean {
    const tile = this.activeTile();
    return (
      tile.x >= rect.x && tile.x < rect.x + rect.w && tile.y >= rect.y && tile.y < rect.y + rect.h
    );
  }

  private insideAnyZone(zones: readonly GuidanceZone[]): boolean {
    const tile = this.activeTile();
    return zones.some(
      (zone) =>
        tile.x >= zone.x &&
        tile.x < zone.x + zone.width &&
        tile.y >= zone.y &&
        tile.y < zone.y + zone.height,
    );
  }

  private tileDistanceFromActive(tile: TilePoint): number {
    const active = this.active();
    const activeCentreX = active.x + TILE_SIZE * TILE_CENTRE;
    const activeCentreY = active.y + TILE_SIZE * TILE_CENTRE;
    const tileCentreX = (tile.x + TILE_CENTRE) * TILE_SIZE;
    const tileCentreY = (tile.y + TILE_CENTRE) * TILE_SIZE;
    return Math.hypot(activeCentreX - tileCentreX, activeCentreY - tileCentreY) / TILE_SIZE;
  }
}

function tileOf(crawler: Crawler): TilePoint {
  return {
    x: Math.floor((crawler.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    y: Math.floor((crawler.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
  };
}

function rectCentre(rect: Footprint): TilePoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function footprintCentre(footprint: Footprint): TilePoint {
  return { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
}

function zoneToFootprint(zone: GuidanceZone): Footprint {
  return { x: zone.x, y: zone.y, w: zone.width, h: zone.height };
}

function tileArea(tile: TilePoint): Footprint {
  return { x: tile.x, y: tile.y, w: 1, h: 1 };
}

/** A square `sizeTiles` across, centred on `tile`. */
function centredArea(tile: TilePoint, sizeTiles: number): Footprint {
  const inset = (sizeTiles - 1) / 2;
  return { x: tile.x - inset, y: tile.y - inset, w: sizeTiles, h: sizeTiles };
}

/** The smallest tile rectangle holding every tile in `tiles`; null for none. */
function tilesBoundingArea(tiles: readonly TilePoint[]): Footprint | null {
  if (tiles.length === 0) return null;
  const xs = tiles.map((tile) => tile.x);
  const ys = tiles.map((tile) => tile.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left + 1, h: Math.max(...ys) - top + 1 };
}

function trebuchetFootprint(at: TilePoint): Footprint {
  return { x: at.x, y: at.y, w: TREBUCHET_WIDTH_TILES, h: TREBUCHET_HEIGHT_TILES };
}

function areaToScreen(area: Footprint, camX: number, camY: number): Rect {
  return {
    x: area.x * TILE_SIZE - camX,
    y: area.y * TILE_SIZE - camY,
    w: area.w * TILE_SIZE,
    h: area.h * TILE_SIZE,
  };
}

/**
 * The world-x `drawBouncingArrowAboveEntity` wants for an arrow centred over
 * `footprint`: it centres on a one-tile entity, so it is handed the tile-left
 * edge half a tile short of the footprint's middle.
 */
function footprintArrowWorldX(footprint: Footprint): number {
  return (footprint.x + footprint.w / 2) * TILE_SIZE - TILE_SIZE * TILE_CENTRE;
}

/** Where a caption over `footprint` is centred, and its first line's top, in screen pixels. */
function footprintCaptionAnchor(
  footprint: Footprint,
  camX: number,
  camY: number,
): { readonly centreScreenX: number; readonly topY: number } {
  return {
    centreScreenX: (footprint.x + footprint.w / 2) * TILE_SIZE - camX,
    topY: footprint.y * TILE_SIZE - camY - FOOTPRINT_CAPTION_LIFT_TILES * TILE_SIZE,
  };
}

/** The tile in `tiles` nearest a fractional point, or null when the list is empty. */
function nearestTileTo(tiles: readonly TilePoint[], point: TilePoint): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDistSq = Infinity;
  for (const tile of tiles) {
    const dx = tile.x - point.x;
    const dy = tile.y - point.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = tile;
    }
  }
  return best;
}

/** Smallest `y` first, then smallest `x` — "upper-left" read off the tile grid. */
function upperLeftMost(tiles: readonly TilePoint[]): TilePoint | null {
  let best: TilePoint | null = null;
  for (const tile of tiles) {
    if (best === null || tile.y < best.y || (tile.y === best.y && tile.x < best.x)) best = tile;
  }
  return best;
}

/** The tile nearest a fence segment's own middle, the stable point the highlight and target sit on. */
function segmentMidTile(segment: PalisadeSegmentDef): TilePoint | null {
  if (segment.tiles.length === 0) return null;
  return segment.tiles[Math.floor(segment.tiles.length / 2)];
}

/** A single tile this guide highlights itself; see `selfMarkedFootprintTarget`. */
function selfMarkedTileTarget(tile: TilePoint): TrackerTarget {
  return { x: tile.x, y: tile.y, wearsOwnMarker: true };
}
