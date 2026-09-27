/**
 * The in-world "how" for "Briar Hollow's Plea": once `VillageQuestSystem`
 * decides a step needs a hand's-on action rather than a conversation, this
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
import { keybindings } from '../../core/Keybindings';
import { platform } from '../../core/Platform';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite, PalisadeSegmentDef } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { ROCK_DEPOSIT } from '../../map/tileTypes';
import { drawItemIcon } from '../../ui/InventoryPanel';
import { BEAM_HEIGHT_TILES, drawObjectiveBeacon } from '../../ui/ObjectiveBeacon';
import { drawBouncingArrowAboveEntity } from '../../ui/WorldArrow';
import { drawText, TEXT_PRESETS, type TextOptions } from '../../ui/TextBox';
import { buildButtonRect } from '../DungeonUIRenderer';
import type { MiniMapSystem } from '../MiniMapSystem';
import { tileKey } from '../tileKey';
import type { TrackerTarget } from '../questTracker';
import type { DefenseStructures } from './DefenseStructures';
import { HARVEST_REACH_TILES } from './HarvestSystem';
import { harvestKindAt, regrowTree, restoreRock } from './harvestNodes';
import { HOLLOW_BELL_FOOTPRINT_TILES } from './hollowBell';
import {
  processingStationsOf,
  type ProcessingStation,
  type ProcessingStationKind,
} from './processingStations';
import type {
  GuidanceProgress,
  ProcessingStationId,
  QuestGuidance,
  StationGuidance,
  TileRect as GuidanceZone,
} from './questGuidance';
import { TREBUCHET_HEIGHT_TILES, TREBUCHET_WIDTH_TILES } from './structureRules';

type Crawler = HumanPlayer | CatPlayer;

/** A `TEXT_PRESETS` entry: every `drawText` option except the position, which the caller supplies. */
type CaptionStyle = Omit<TextOptions, 'x' | 'y'>;

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

/** The trebuchet's highlight stands taller than the default beam, so it reads over the engine's own frame. */
const TREBUCHET_HIGHLIGHT_HEIGHT_SCALE = 1.5;

/** Matches the gold `WorldArrow`/`ObjectiveBeacon` colour everywhere else in the game points at something. */
const GUIDE_COLOR = '#facc15';

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

/** A very light wash — the zones are suggestions, not something that should read as blocked ground. */
const BUILD_ZONE_WASH_COLOR = 'rgba(74, 222, 128, 0.12)';

/** The wood-processing count needs to read as clearly as its title line, which the grey `hint` preset does not. */
const PROCESS_COUNT_PRESET: CaptionStyle = { size: TEXT_PRESETS.hint.size, color: '#ffffff' };

const HUD_ARROW_BOUNCE_FREQUENCY = 0.005;
const HUD_ARROW_BOUNCE_AMPLITUDE_PX = 4;
const HUD_ARROW_LENGTH_PX = 14;
const HUD_ARROW_HALF_WIDTH_PX = 8;
const HUD_ARROW_GAP_ABOVE_BUTTON_PX = 8;
const HUD_CAPTION_GAP_PX = 4;

const STATION_ID_TO_KIND: Readonly<Record<ProcessingStationId, ProcessingStationKind>> = {
  saw: 'boards',
  rope_walk: 'rope',
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
  | { readonly kind: 'repair_bell' };

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
   * The build-trebuchet zones' green wash and the processing stations'
   * footprint beacons, under every body — the same "behind, not over" order a
   * quest NPC draws its own column in.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const guidance = this.deps.guidance();
    if (guidance?.kind === 'build_trebuchet') {
      ctx.save();
      ctx.fillStyle = BUILD_ZONE_WASH_COLOR;
      for (const zone of guidance.zones) {
        ctx.fillRect(
          zone.x * TILE_SIZE - camX,
          zone.y * TILE_SIZE - camY,
          zone.width * TILE_SIZE,
          zone.height * TILE_SIZE,
        );
      }
      ctx.restore();
    }
    if (this.cache?.kind === 'process') {
      for (const entry of this.cache.stations) {
        this.renderFootprintBeacon(ctx, camX, camY, entry.station.footprint);
      }
    }
    if (
      (this.cache?.kind === 'chop' || this.cache?.kind === 'mine') &&
      this.cache.insideYard &&
      this.cache.tile !== null
    ) {
      const scale = this.cache.kind === 'chop' ? TREE_HIGHLIGHT_SCALE : 1;
      this.renderPointBeacon(ctx, camX, camY, this.cache.tile, {
        widthTiles: scale,
        heightTiles: BEAM_HEIGHT_TILES * scale,
      });
    }
  }

  /** Every beacon, arrow, icon and caption, drawn over every body. */
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
        // The zone wash is drawn under every body in `renderGround`; the HUD
        // arrow over the Construction button is drawn from `renderConstructionHint`.
        this.renderTrebuchetZoneLabels(ctx, camX, camY, cache.zones);
        break;
    }
  }

  /**
   * "Build trebuchet here", centred in each zone. This guidance's own
   * `target()` marks itself `wearsOwnMarker` so the pinned objective beacon
   * never stands in the zone too — a whole patch of buildable ground has no
   * single tile for that beacon to stand on, so the label takes its place.
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
      drawText(ctx, 'Build trebuchet here', {
        x: centreX,
        y: centreY - ZONE_LABEL_VERTICAL_OFFSET_PX,
        align: 'center',
        ...TEXT_PRESETS.label,
      });
    }
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
    if (!cache.insideYard || cache.tile === null) return;
    if (cache.showCounter) {
      const countLine = `${cache.progress.have}/${cache.progress.target} ${countedNoun}`;
      const keepCollecting = cache.progress.have >= KEEP_COLLECTING_THRESHOLD;
      const lines = keepCollecting ? ['Keep collecting', countLine] : [countLine];
      const firstLinePreset = keepCollecting ? TEXT_PRESETS.label : TEXT_PRESETS.value;
      this.renderPointArrowAndCaption(ctx, camX, camY, cache.tile, null, lines, firstLinePreset);
      return;
    }
    const line = platform.isMobile
      ? `Tap to ${collectVerb}`
      : `Press ${keybindings.labelFor('attack')} to ${collectVerb}`;
    this.renderPointArrowAndCaption(ctx, camX, camY, cache.tile, icon, [line]);
  }

  /**
   * The arrow and caption over a station, from `renderAbove`. The footprint
   * beacon itself is drawn earlier, from `renderGround`, so the machine's own
   * sprite — drawn in the Y-sorted pass between the two — sits in front of the
   * light rather than under a wash of it, the same order an NPC's own quest
   * column keeps with its body.
   */
  private renderStation(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    entry: MatchedStation,
  ): void {
    const footprint = entry.station.footprint;
    const title = STATION_CAPTION_TITLE[entry.id];
    const progressLine = `${entry.progress.have}/${entry.progress.target}`;
    this.renderFootprintArrowAndCaption(
      ctx,
      camX,
      camY,
      footprint,
      [title, progressLine],
      PROCESS_COUNT_PRESET,
    );
  }

  /**
   * The beacon always marks the trebuchet, but the arrow and "load with
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
    const footprint: Footprint = {
      x: at.x,
      y: at.y,
      w: TREBUCHET_WIDTH_TILES,
      h: TREBUCHET_HEIGHT_TILES,
    };
    this.renderFootprintBeacon(ctx, camX, camY, footprint, TREBUCHET_HIGHLIGHT_HEIGHT_SCALE);
    if (this.deps.isDefaultTrebuchetPromptShowing(at)) return;
    const line = platform.isMobile
      ? 'Double tap to load with stone'
      : `Press ${keybindings.labelFor('quickLoad')} to load with stone`;
    this.renderFootprintArrowAndCaption(ctx, camX, camY, footprint, [line]);
  }

  /**
   * The beacon always marks the faced fence, but the arrow and upgrade
   * caption stand down once `ConstructionKit`'s own wall prompt is on screen
   * for it, the same way the trebuchet's load caption yields to its prompt.
   */
  private renderUpgradeWall(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tile: TilePoint,
  ): void {
    this.renderPointBeacon(ctx, camX, camY, tile);
    if (this.deps.isDefaultWallPromptShowing()) return;
    const line = platform.isMobile
      ? 'Double tap to upgrade'
      : `Press ${keybindings.labelFor('attack')} to upgrade`;
    this.renderPointArrowAndCaption(ctx, camX, camY, tile, null, [
      'Upgrade this fence to a wooden wall',
      line,
    ]);
  }

  private renderBell(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const bell = this.deps.site.square.bellTile;
    const footprint: Footprint = {
      x: bell.x,
      y: bell.y,
      w: HOLLOW_BELL_FOOTPRINT_TILES,
      h: HOLLOW_BELL_FOOTPRINT_TILES,
    };
    this.renderFootprintGuide(ctx, camX, camY, footprint, ['Repair the bell tower']);
  }

  /**
   * The beacon column alone, over `tile`. Drawn on its own so a caller can put
   * it in the ground pass, under whatever stands on that tile — the chosen
   * tree or rock, and the crawler working it.
   *
   * The beam widens east from its anchor tile, so a caller asking for one
   * wider than one tile has its anchor pulled back by half the extra width —
   * otherwise the highlight drifts off the tile it is meant to centre on.
   */
  private renderPointBeacon(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tile: TilePoint,
    footprint?: { readonly widthTiles: number; readonly heightTiles: number },
  ): void {
    const widthTiles = footprint?.widthTiles ?? 1;
    const sx = (tile.x - (widthTiles - 1) / 2) * TILE_SIZE - camX;
    const sy = tile.y * TILE_SIZE - camY;
    drawObjectiveBeacon(ctx, sx, sy, TILE_SIZE, GUIDE_COLOR, performance.now(), footprint);
  }

  /** The bouncing arrow, optional tool icon and caption over `tile`, without the beacon column. */
  private renderPointArrowAndCaption(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tile: TilePoint,
    icon: ItemId | null,
    lines: readonly string[],
    firstLinePreset: CaptionStyle = TEXT_PRESETS.label,
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
      drawItemIcon(
        ctx,
        { ...ITEM_DEF[icon], quantity: 1 },
        centreX - size / 2,
        iconY - size / 2,
        size,
      );
    }
    const captionLift = icon !== null ? CAPTION_LIFT_TILES : CAPTION_LIFT_NO_ICON_TILES;
    this.renderCaption(ctx, centreX, sy - captionLift * TILE_SIZE, lines, firstLinePreset);
  }

  /** A beacon and arrow sized to a whole footprint (a building, a trebuchet, the bell tower), and a caption above it. */
  private renderFootprintGuide(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    footprint: Footprint,
    lines: readonly string[],
    heightScale = 1,
  ): void {
    this.renderFootprintBeacon(ctx, camX, camY, footprint, heightScale);
    this.renderFootprintArrowAndCaption(ctx, camX, camY, footprint, lines);
  }

  /**
   * The footprint's own beacon column, sized like a building or a market
   * cart's. Drawn on its own so a caller can put it in the ground pass, under
   * whatever sprite stands on that footprint.
   */
  private renderFootprintBeacon(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    footprint: Footprint,
    heightScale = 1,
  ): void {
    const bottomRowY = footprint.y + footprint.h - 1;
    const sx = footprint.x * TILE_SIZE - camX;
    const sy = bottomRowY * TILE_SIZE - camY;
    drawObjectiveBeacon(ctx, sx, sy, TILE_SIZE, GUIDE_COLOR, performance.now(), {
      widthTiles: footprint.w,
      heightTiles: BEAM_HEIGHT_TILES * heightScale,
    });
  }

  private renderFootprintArrowAndCaption(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    footprint: Footprint,
    lines: readonly string[],
    restLinePreset: CaptionStyle = TEXT_PRESETS.hint,
  ): void {
    const centreWorldX = (footprint.x + footprint.w / 2) * TILE_SIZE - TILE_SIZE / 2;
    drawBouncingArrowAboveEntity(
      ctx,
      centreWorldX,
      footprint.y * TILE_SIZE,
      camX,
      camY,
      GUIDE_COLOR,
    );
    const centreScreenX = centreWorldX - camX + TILE_SIZE * TILE_CENTRE;
    const topY = footprint.y * TILE_SIZE - camY - FOOTPRINT_CAPTION_LIFT_TILES * TILE_SIZE;
    this.renderCaption(ctx, centreScreenX, topY, lines, TEXT_PRESETS.label, restLinePreset);
  }

  private renderCaption(
    ctx: CanvasRenderingContext2D,
    x: number,
    topY: number,
    lines: readonly string[],
    firstLinePreset: CaptionStyle,
    restLinePreset: CaptionStyle = TEXT_PRESETS.hint,
  ): void {
    lines.forEach((line, index) => {
      drawText(ctx, line, {
        x,
        y: topY + index * CAPTION_LINE_GAP_PX,
        align: 'center',
        outline: true,
        ...(index === 0 ? firstLinePreset : restLinePreset),
      });
    });
  }

  /**
   * The bouncing arrow and caption over the HUD's Construction button, shown
   * while a `build_trebuchet` zone has the active crawler standing in it.
   * Drawn from `renderHud`, which is the one call already handed the
   * `MiniMapSystem` the button's own layout is read off.
   */
  renderConstructionHint(ctx: CanvasRenderingContext2D, miniMap: MiniMapSystem): void {
    const guidance = this.deps.guidance();
    if (guidance?.kind !== 'build_trebuchet') return;
    if (!this.insideAnyZone(guidance.zones)) return;
    const rect = buildButtonRect(miniMap);
    const centreX = rect.x + rect.w / 2;
    const bounce =
      Math.sin(Date.now() * HUD_ARROW_BOUNCE_FREQUENCY) * HUD_ARROW_BOUNCE_AMPLITUDE_PX;
    const tipY = rect.y - HUD_ARROW_GAP_ABOVE_BUTTON_PX + bounce;
    ctx.save();
    ctx.fillStyle = GUIDE_COLOR;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centreX, tipY);
    ctx.lineTo(centreX - HUD_ARROW_HALF_WIDTH_PX, tipY - HUD_ARROW_LENGTH_PX);
    ctx.lineTo(centreX + HUD_ARROW_HALF_WIDTH_PX, tipY - HUD_ARROW_LENGTH_PX);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    drawText(ctx, 'Build a trebuchet', {
      x: centreX,
      y: tipY - HUD_ARROW_LENGTH_PX - HUD_CAPTION_GAP_PX,
      align: 'center',
      ...TEXT_PRESETS.label,
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
   * guide's beacon was drawn behind.
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
