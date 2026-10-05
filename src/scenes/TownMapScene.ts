/**
 * Localhost-only harness for reviewing the whole overworld layout at once,
 * reached via `?townmap` in `devBootScene` (see `game.ts`). Never on a
 * production path.
 *
 * The town is several screens wide in-game, so no in-game screenshot can show
 * whether a layout change worked. This scene draws the entire generated grid as
 * a flat schematic — one filled cell per tile — with building footprints, names,
 * the safe radius and the circus overlaid, plus the layout metrics from
 * townMetrics.ts (see docs/town.md).
 *
 * Two views, toggled by clicking:
 *
 *  - **Town** — framed on the built-up area, close enough to read every
 *    building name and every street.
 *  - **World** — the full map, for checking the ruins band, the forests and the
 *    circus placement relative to the safe radius.
 *
 * Building footprints are re-derived from the grid (sprite anchors plus the
 * manifest footprint) rather than read off `OverworldData`, so the scene keeps
 * working across the layout refactor without the generator having to export a
 * dev-only field.
 */

import { viewportWidth, viewportHeight } from '../core/Viewport';
import { worldText } from '../ui/world/worldText';
import { inset, splitH, splitV, type Rect } from '../ui/core/geom';
import type { Surface, Ui, WorldGesture } from '../ui/core/UiRoot';
import { card } from '../ui/widgets/card';
import { lineHeightOf, measureText, text } from '../ui/widgets/text';
import { skinsFor } from '../ui/theme/skins';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { generateOverworld, type OverworldData } from '../map/OverworldGenerator';
import {
  collectBuildingPlots,
  measureTown,
  metricRows,
  type BuildingPlot,
  type TownMetrics,
} from '../map/town/townMetrics';
import type { TilePoint, TileRect } from '../map/town/townPlan';
import { level3 } from '../levels/index';
import type { TileContent } from '../map/tileTypes';
import { TOWN_MAP_INK } from '../ui/theme/townMapInk';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  GRASSY_WEED,
  DIRT_PATCH,
  TREE,
  MAIN_TOWER,
  SPRITE_BUILDING,
  RUINED_WALL,
  RUBBLE,
  TOWN_WALL,
  VERGE_GRASS,
  YARD_GRAVEL,
  LANE_STREET,
  COBBLE_STREET,
  PLAZA_STONE,
  FENCE,
  GARDEN_PLANTING,
  HIGHLAND_GRASS,
  SCREE,
  WILDFLOWER_TUFT,
  PEBBLE_SCATTER,
  BRIDGE,
  RIVER_ROCK,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CLIFF,
  CAMPFIRE,
  GOBLIN_TENT,
  DEN_HOLLOW,
  HOLLOW_WALL,
  HOLLOW_PLANK_FLOOR,
  HOLLOW_THRESHOLD,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_DECAL,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  PASTURE_GRASS,
  CIRCUS_LOT,
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  CROP_FIELD,
} from '../map/tileTypes';

const BG_COLOR = TOWN_MAP_INK.bgColor;
const LABEL_COLOR = TOWN_MAP_INK.labelColor;
const FOOTPRINT_STROKE = TOWN_MAP_INK.footprintStroke;
/** A sprite's art beyond the ground it occupies — today only the tower's spire. */
const OVERHANG_STROKE = TOWN_MAP_INK.overhangStroke;
const DOOR_MARKER_COLOR = TOWN_MAP_INK.doorMarkerColor;
const SAFE_RADIUS_STROKE = TOWN_MAP_INK.safeRadiusStroke;
const CIRCUS_STROKE = TOWN_MAP_INK.circusStroke;
/** Briar Hollow's footprints and ruins: warm, to read against the town's cool strokes. */
const VILLAGE_STROKE = TOWN_MAP_INK.villageStroke;
const VILLAGE_DISTRICT_LABEL_COLOR = TOWN_MAP_INK.villageDistrictLabelColor;
const START_TILE_COLOR = TOWN_MAP_INK.startTileColor;
const ESCAPE_TILE_COLOR = TOWN_MAP_INK.escapeTileColor;
const UNKNOWN_TILE_COLOR = TOWN_MAP_INK.unknownTileColor;

/** Schematic fill per tile type. Anything unmapped renders magenta so it is obvious. */
const TILE_COLORS = new Map<number, string>([
  [VOID_TYPE, TOWN_MAP_INK.tiles.voidType],
  [FloorTypeValue.grass, TOWN_MAP_INK.tiles.grass],
  [GRASSY_WEED, TOWN_MAP_INK.tiles.grassyWeed],
  [FloorTypeValue.road, TOWN_MAP_INK.tiles.road],
  [DIRT_PATCH, TOWN_MAP_INK.tiles.dirtPatch],
  [TREE, TOWN_MAP_INK.tiles.tree],
  [RUBBLE, TOWN_MAP_INK.tiles.rubble],
  [RUINED_WALL, TOWN_MAP_INK.tiles.ruinedWall],
  [BUILDING_WALL, TOWN_MAP_INK.tiles.buildingWall],
  [ROOF_THATCH, TOWN_MAP_INK.tiles.roofThatch],
  [ROOF_SLATE, TOWN_MAP_INK.tiles.roofSlate],
  [ROOF_RED, TOWN_MAP_INK.tiles.roofRed],
  [ROOF_GREEN, TOWN_MAP_INK.tiles.roofGreen],
  [FOUNTAIN, TOWN_MAP_INK.tiles.fountain],
  [TORCH, TOWN_MAP_INK.tiles.torch],
  [WELL, TOWN_MAP_INK.tiles.well],
  [MAIN_TOWER, TOWN_MAP_INK.tiles.mainTower],
  [SPRITE_BUILDING, TOWN_MAP_INK.tiles.spriteBuilding],
  // Darker than any street so the ring reads at a glance, which is the one thing
  // this view exists to show. The wall's in-game stone is much lighter.
  [TOWN_WALL, TOWN_MAP_INK.tiles.townWall],
  [VERGE_GRASS, TOWN_MAP_INK.tiles.vergeGrass],
  [YARD_GRAVEL, TOWN_MAP_INK.tiles.yardGravel],
  [LANE_STREET, TOWN_MAP_INK.tiles.laneStreet],
  [COBBLE_STREET, TOWN_MAP_INK.tiles.cobbleStreet],
  [PLAZA_STONE, TOWN_MAP_INK.tiles.plazaStone],
  [GARDEN_PLANTING, TOWN_MAP_INK.tiles.gardenPlanting],
  [FENCE, TOWN_MAP_INK.tiles.fence],
  // The floor-3 wilderness, in this view's own brighter schematic palette. A
  // type missing here draws in `UNKNOWN_TILE_COLOR` magenta rather than grey,
  // which at least fails loudly — but the whole point of the view is reading the
  // generator's output at a glance, so every generated type belongs here.
  [FloorTypeValue.water, TOWN_MAP_INK.tiles.water],
  [HIGHLAND_GRASS, TOWN_MAP_INK.tiles.highlandGrass],
  [SCREE, TOWN_MAP_INK.tiles.scree],
  [WILDFLOWER_TUFT, TOWN_MAP_INK.tiles.wildflowerTuft],
  [PEBBLE_SCATTER, TOWN_MAP_INK.tiles.pebbleScatter],
  [BRIDGE, TOWN_MAP_INK.tiles.bridge],
  [RIVER_ROCK, TOWN_MAP_INK.tiles.riverRock],
  [BOULDER_SMALL, TOWN_MAP_INK.tiles.boulderSmall],
  [BOULDER_LARGE, TOWN_MAP_INK.tiles.boulderLarge],
  [CLIFF, TOWN_MAP_INK.tiles.cliff],
  [CAMPFIRE, TOWN_MAP_INK.tiles.campfire],
  [GOBLIN_TENT, TOWN_MAP_INK.tiles.goblinTent],
  [DEN_HOLLOW, TOWN_MAP_INK.tiles.denHollow],
  // Briar Hollow, in the same schematic palette.
  [HOLLOW_WALL, TOWN_MAP_INK.tiles.hollowWall],
  [HOLLOW_PLANK_FLOOR, TOWN_MAP_INK.tiles.hollowPlankFloor],
  [HOLLOW_THRESHOLD, TOWN_MAP_INK.tiles.hollowThreshold],
  [HOLLOW_PROP_LOW, TOWN_MAP_INK.tiles.hollowPropLow],
  [HOLLOW_PROP_TALL, TOWN_MAP_INK.tiles.hollowPropTall],
  [HOLLOW_DECAL, TOWN_MAP_INK.tiles.hollowDecal],
  [HOLLOW_PALISADE, TOWN_MAP_INK.tiles.hollowPalisade],
  [HOLLOW_PALISADE_GAP, TOWN_MAP_INK.tiles.hollowPalisadeGap],
  [HOLLOW_GATE, TOWN_MAP_INK.tiles.hollowGate],
  [ROCK_DEPOSIT, TOWN_MAP_INK.tiles.rockDeposit],
  [PASTURE_GRASS, TOWN_MAP_INK.tiles.pastureGrass],
  [CROP_FIELD, TOWN_MAP_INK.tiles.cropField],
  // The circus grounds, in the same schematic palette.
  [CIRCUS_LOT, TOWN_MAP_INK.tiles.circusLot],
  [CIRCUS_STRUCTURE_TALL, TOWN_MAP_INK.tiles.circusStructureTall],
  [CIRCUS_STRUCTURE_LOW, TOWN_MAP_INK.tiles.circusStructureLow],
]);

const METRICS_SURFACE_ID = 'town-metrics';

/** Tiles of empty ground kept around the town when framing the town view. */
const TOWN_VIEW_MARGIN_TILES = 8;
/** Margin round the village's bounds in the village view — wide enough to take in the quarry and ruins. */
const VILLAGE_VIEW_MARGIN_TILES = 26;

/** Zoom limits and the multiplier one wheel notch applies. */
const MIN_PX_PER_TILE = 0.5;
const MAX_PX_PER_TILE = 24;
const ZOOM_STEP = 1.12;

/** Building names are only legible above this zoom, and only fit above the second. */
const NAME_LABEL_MIN_PX_PER_TILE = 3.2;
const NAME_LABEL_SIZE = 11;

/** Marker sizes in tiles, so they stay meaningful at any zoom. */
const DOOR_MARKER_TILES = 1.6;
const START_MARKER_TILES = 2.4;

/** Offset from a tile's top-left corner to its centre, in tiles. */
const TILE_CENTRE = 0.5;

/**
 * Pointer travel past which a press counts as a pan rather than a view toggle.
 * Summed along the path, so a pan that wanders back to where it began still
 * pans rather than switching views.
 */
const DRAG_THRESHOLD_PX = 4;

/** Tiles of the map kept on screen when panning, so it can never be lost off-view. */
const MIN_VISIBLE_TILES = 4;

const FOOTPRINT_LINE_WIDTH = 1;
const OVERLAY_LINE_WIDTH = 1.5;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

type MapView = 'town' | 'world' | 'village';

/** Click order through the views. */
const NEXT_VIEW: Readonly<Record<MapView, MapView>> = {
  town: 'world',
  world: 'village',
  village: 'town',
};

const VIEW_TITLES: Readonly<Record<MapView, string>> = {
  town: 'town',
  world: 'whole world',
  village: 'Briar Hollow',
};

export class TownMapScene extends PreviewScene {
  private readonly data: OverworldData;
  private readonly size: number;
  private readonly plots: BuildingPlot[];
  private readonly metrics: TownMetrics;

  private view: MapView = 'town';
  private pxPerTile = MIN_PX_PER_TILE;
  private originTileX = 0;
  private originTileY = 0;
  private dragAnchor: { readonly mx: number; readonly my: number } | null = null;
  private dragDistancePx = 0;
  /** The view was framed before the header's height was known, and is framed again once it is. */
  private framedUnderHeader = false;

  constructor() {
    super();
    this.size = level3.mapSize;
    this.data = generateOverworld(this.size);
    this.plots = collectBuildingPlots(this.data);
    this.metrics = measureTown(this.plots, this.data);
    this.frameView();
    logMetrics(this.metrics, this.data);
    this.ui.mount(this.metricsSurface());
  }

  protected previewTitle(): string {
    return `town map — ${VIEW_TITLES[this.view]} — ?townmap`;
  }

  protected previewCaptions(): readonly string[] {
    return ['tap the map to switch view', 'scroll to zoom · drag to pan'];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'view',
        label: `view: ${VIEW_TITLES[this.view]}`,
        onTap: () => {
          this.nextView();
        },
      },
    ];
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    switch (gesture.kind) {
      case 'down':
        this.dragAnchor = { mx: gesture.cssX, my: gesture.cssY };
        this.dragDistancePx = 0;
        return;
      case 'move':
        this.pan(gesture.cssX, gesture.cssY);
        return;
      case 'up':
        this.dragAnchor = null;
        if (gesture.tap && this.dragDistancePx <= DRAG_THRESHOLD_PX) this.nextView();
        return;
      case 'cancel':
        this.dragAnchor = null;
        return;
      case 'wheel':
        this.zoom(gesture.deltaY);
        return;
    }
  }

  private nextView(): void {
    this.view = NEXT_VIEW[this.view];
    this.frameView();
  }

  private pan(mx: number, my: number): void {
    const anchor = this.dragAnchor;
    if (anchor === null) return;
    this.dragDistancePx += Math.hypot(mx - anchor.mx, my - anchor.my);
    this.originTileX -= (mx - anchor.mx) / this.pxPerTile;
    this.originTileY -= (my - anchor.my) / this.pxPerTile;
    this.dragAnchor = { mx, my };
    this.clampOrigin();
  }

  /** Zooms about the viewport centre, keeping the tile there fixed. */
  private zoom(deltaY: number): void {
    const factor = deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const next = clamp(this.pxPerTile * factor, MIN_PX_PER_TILE, MAX_PX_PER_TILE);
    const viewport = this.viewportSize();
    const centreTileX = this.originTileX + viewport.width / this.pxPerTile / 2;
    const centreTileY = this.originTileY + viewport.height / this.pxPerTile / 2;
    this.pxPerTile = next;
    this.originTileX = centreTileX - viewport.width / next / 2;
    this.originTileY = centreTileY - viewport.height / next / 2;
    this.clampOrigin();
  }

  update(): void {
    // Nothing animates; the clamp is here because the canvas resizes with the
    // window and a shrunk viewport can leave the origin outside its bounds.
    this.clampOrigin();
  }

  /** Keeps at least a sliver of the map on screen however far the user drags. */
  private clampOrigin(): void {
    const viewport = this.viewportSize();
    const tilesAcross = viewport.width / this.pxPerTile;
    const tilesDown = viewport.height / this.pxPerTile;
    this.originTileX = clamp(
      this.originTileX,
      MIN_VISIBLE_TILES - tilesAcross,
      this.size - MIN_VISIBLE_TILES,
    );
    this.originTileY = clamp(
      this.originTileY,
      MIN_VISIBLE_TILES - tilesDown,
      this.size - MIN_VISIBLE_TILES,
    );
  }

  private viewportSize(): { readonly width: number; readonly height: number } {
    const width = viewportWidth();
    const height = viewportHeight();
    return { width, height: height - this.headerBottom };
  }

  /** Fits the current view's tile region into the viewport and centres it. */
  private frameView(): void {
    const region =
      this.view === 'world'
        ? { x: 0, y: 0, w: this.size, h: this.size }
        : this.view === 'village'
          ? expandRect(this.data.briarHollow.palisadeBounds, VILLAGE_VIEW_MARGIN_TILES)
          : expandRect(this.metrics.bounds, TOWN_VIEW_MARGIN_TILES);
    const viewport = this.viewportSize();
    const fit = Math.min(viewport.width / region.w, viewport.height / region.h);
    this.pxPerTile = clamp(fit, MIN_PX_PER_TILE, MAX_PX_PER_TILE);
    this.originTileX = region.x + region.w / 2 - viewport.width / this.pxPerTile / 2;
    this.originTileY = region.y + region.h / 2 - viewport.height / this.pxPerTile / 2;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    if (!this.framedUnderHeader && this.headerBottom > 0) {
      this.framedUnderHeader = true;
      this.frameView();
    }
    const headerBottom = this.headerBottom;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerBottom, width, height - headerBottom);
    ctx.clip();
    ctx.translate(
      -this.originTileX * this.pxPerTile,
      headerBottom - this.originTileY * this.pxPerTile,
    );

    this.renderTiles(ctx);
    this.renderOverlays(ctx);

    ctx.restore();

    this.renderChrome(ctx);
  }

  /** Draws only the tiles inside the viewport — the full grid is 78k cells. */
  private renderTiles(ctx: CanvasRenderingContext2D): void {
    const viewport = this.viewportSize();
    const px = this.pxPerTile;
    const x0 = Math.max(0, Math.floor(this.originTileX));
    const y0 = Math.max(0, Math.floor(this.originTileY));
    const x1 = Math.min(this.size - 1, Math.ceil(this.originTileX + viewport.width / px));
    const y1 = Math.min(this.size - 1, Math.ceil(this.originTileY + viewport.height / px));

    // Cells are drawn one pixel oversized so neighbouring fills always butt
    // together — at fractional zoom the rounded edges would otherwise show the
    // background through hairline gaps.
    const cell = px + 1;
    for (let ty = y0; ty <= y1; ty++) {
      const row: TileContent[] = this.data.grid[ty];
      for (let tx = x0; tx <= x1; tx++) {
        ctx.fillStyle = TILE_COLORS.get(row[tx].type) ?? UNKNOWN_TILE_COLOR;
        ctx.fillRect(tx * px, ty * px, cell, cell);
      }
    }
  }

  private renderOverlays(ctx: CanvasRenderingContext2D): void {
    const px = this.pxPerTile;
    const { townSquareCentre, circusCentre, circusRadiusTiles, townSafeRadiusTiles } = this.data;

    ctx.lineWidth = OVERLAY_LINE_WIDTH;
    ctx.strokeStyle = SAFE_RADIUS_STROKE;
    ctx.beginPath();
    ctx.arc(
      (townSquareCentre.x + TILE_CENTRE) * px,
      (townSquareCentre.y + TILE_CENTRE) * px,
      townSafeRadiusTiles * px,
      0,
      FULL_CIRCLE_RADIANS,
    );
    ctx.stroke();

    ctx.strokeStyle = CIRCUS_STROKE;
    ctx.beginPath();
    ctx.arc(
      (circusCentre.x + TILE_CENTRE) * px,
      (circusCentre.y + TILE_CENTRE) * px,
      circusRadiusTiles * px,
      0,
      FULL_CIRCLE_RADIANS,
    );
    ctx.stroke();
    // Each circus structure's footprint rectangle, so a tent that moved or a
    // post that landed on the road shows against the disc at a glance.
    ctx.lineWidth = FOOTPRINT_LINE_WIDTH;
    for (const placed of this.data.circusGrounds.structures) {
      const { rect } = placed;
      ctx.strokeRect(rect.x * px, rect.y * px, rect.w * px, rect.h * px);
    }

    for (const plot of this.plots) {
      // The tower's art is 23 tiles tall over a 2-row base, so its overhang is
      // outlined separately: the solid box is the ground it occupies (what the
      // metrics measure), the faint one is what the sprite covers.
      const hasOverhang =
        plot.artRect.x !== plot.rect.x ||
        plot.artRect.y !== plot.rect.y ||
        plot.artRect.w !== plot.rect.w ||
        plot.artRect.h !== plot.rect.h;
      if (hasOverhang) {
        ctx.strokeStyle = OVERHANG_STROKE;
        ctx.strokeRect(
          plot.artRect.x * px,
          plot.artRect.y * px,
          plot.artRect.w * px,
          plot.artRect.h * px,
        );
      }
      ctx.strokeStyle = FOOTPRINT_STROKE;
      ctx.strokeRect(plot.rect.x * px, plot.rect.y * px, plot.rect.w * px, plot.rect.h * px);
      ctx.fillStyle = DOOR_MARKER_COLOR;
      const doorSize = DOOR_MARKER_TILES * px;
      ctx.fillRect(
        (plot.doorTile.x + TILE_CENTRE) * px - doorSize / 2,
        (plot.doorTile.y + TILE_CENTRE) * px - doorSize / 2,
        doorSize,
        doorSize,
      );
    }

    this.markTile(ctx, this.data.startTile, START_TILE_COLOR);
    this.markTile(ctx, this.data.doomsdayEscapeTile, ESCAPE_TILE_COLOR);
    this.renderVillageOverlay(ctx);

    if (px < NAME_LABEL_MIN_PX_PER_TILE) return;
    for (const plot of this.plots) {
      worldText(ctx, plot.name, {
        x: (plot.rect.x + plot.rect.w / 2) * px,
        y: (plot.rect.y + plot.rect.h / 2) * px,
        size: NAME_LABEL_SIZE,
        color: LABEL_COLOR,
        align: 'center',
        outline: true,
      });
    }
  }

  /** Briar Hollow: its building footprints, its ruins disc, and its district and building names. */
  private renderVillageOverlay(ctx: CanvasRenderingContext2D): void {
    const px = this.pxPerTile;
    const village = this.data.briarHollow;
    ctx.lineWidth = FOOTPRINT_LINE_WIDTH;
    ctx.strokeStyle = VILLAGE_STROKE;
    for (const building of village.buildings) {
      const { rect } = building;
      ctx.strokeRect(rect.x * px, rect.y * px, rect.w * px, rect.h * px);
    }
    ctx.lineWidth = OVERLAY_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(
      (village.ruins.centre.x + TILE_CENTRE) * px,
      (village.ruins.centre.y + TILE_CENTRE) * px,
      village.ruins.radiusTiles * px,
      0,
      FULL_CIRCLE_RADIANS,
    );
    ctx.stroke();

    if (px < NAME_LABEL_MIN_PX_PER_TILE) return;
    for (const district of village.districts) {
      if (district.label === null) continue;
      worldText(ctx, district.label, {
        x: (district.labelTile.x + TILE_CENTRE) * px,
        y: (district.labelTile.y + TILE_CENTRE) * px,
        size: NAME_LABEL_SIZE,
        bold: true,
        color: VILLAGE_DISTRICT_LABEL_COLOR,
        align: 'center',
        outline: true,
      });
    }
    for (const building of village.buildings) {
      worldText(ctx, building.name, {
        x: (building.rect.x + building.rect.w / 2) * px,
        y: (building.rect.y + building.rect.h / 2) * px,
        size: NAME_LABEL_SIZE,
        color: LABEL_COLOR,
        align: 'center',
        outline: true,
      });
    }
  }

  private markTile(ctx: CanvasRenderingContext2D, tile: TilePoint, color: string): void {
    const px = this.pxPerTile;
    const size = START_MARKER_TILES * px;
    ctx.strokeStyle = color;
    ctx.lineWidth = OVERLAY_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(
      (tile.x + TILE_CENTRE) * px,
      (tile.y + TILE_CENTRE) * px,
      size / 2,
      0,
      FULL_CIRCLE_RADIANS,
    );
    ctx.stroke();
  }

  /** The layout metrics, in a card over the map's bottom-left corner. */
  private metricsSurface(): Surface {
    return {
      id: METRICS_SURFACE_ID,
      band: 'hud',
      haltsWorld: false,
      isOpen: () => true,
      render: (ui) => {
        this.renderMetrics(ui);
      },
    };
  }

  private renderMetrics(ui: Ui): void {
    const rows = metricRows(this.metrics, this.data);
    const { space } = ui.theme;
    const padding = skinsFor(ui.theme).panel.hud.padding;
    const rowHeight = lineHeightOf(ui, 'caption');
    const labelWidth = Math.max(
      ...rows.map(([label]) => measureText(ui, label, { role: 'caption' })),
    );
    const valueWidth = Math.max(
      ...rows.map(([, value]) => measureText(ui, value, { role: 'label' })),
    );
    const outer = inset(ui.viewport, space.sm);
    const cardWidth = Math.min(outer.w, labelWidth + space.lg + valueWidth + padding * 2);
    const cardHeight = rows.length * rowHeight + padding * 2;
    const frame: Rect = {
      x: outer.x,
      y: outer.y + outer.h - cardHeight,
      w: cardWidth,
      h: cardHeight,
    };
    card(ui, frame, { id: 'metrics', kind: 'hud' });
    const lines = splitV(
      inset(frame, padding),
      rows.map(() => rowHeight),
      0,
    );
    rows.forEach(([label, value], index) => {
      const [labelCell, valueCell] = splitH(lines[index], [labelWidth, 'fill'], space.lg);
      text(ui, labelCell, { text: label, role: 'caption' });
      text(ui, valueCell, { text: value, role: 'label' });
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function expandRect(rect: TileRect, tiles: number): TileRect {
  return {
    x: rect.x - tiles,
    y: rect.y - tiles,
    w: rect.w + tiles * 2,
    h: rect.h + tiles * 2,
  };
}

function logMetrics(metrics: TownMetrics, data: OverworldData): void {
  console.info('[townmap] layout metrics', Object.fromEntries(metricRows(metrics, data)));
}
