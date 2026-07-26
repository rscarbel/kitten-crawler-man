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

import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import { drawText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
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
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
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
} from '../map/tileTypes';

const BG_COLOR = '#0b0e14';
const LABEL_COLOR = '#e2e8f0';
const HINT_COLOR = '#94a3b8';
const METRIC_LABEL_COLOR = '#9aa7bd';
const FOOTPRINT_STROKE = 'rgba(255, 214, 102, 0.85)';
/** A sprite's art beyond the ground it occupies — today only the tower's spire. */
const OVERHANG_STROKE = 'rgba(255, 214, 102, 0.28)';
const DOOR_MARKER_COLOR = '#ff5d8f';
const SAFE_RADIUS_STROKE = 'rgba(94, 234, 212, 0.7)';
const CIRCUS_STROKE = 'rgba(196, 132, 252, 0.8)';
const START_TILE_COLOR = '#38bdf8';
const ESCAPE_TILE_COLOR = '#f97316';
const UNKNOWN_TILE_COLOR = '#ff00ff';

/** Schematic fill per tile type. Anything unmapped renders magenta so it is obvious. */
const TILE_COLORS = new Map<number, string>([
  [VOID_TYPE, '#05070b'],
  [FloorTypeValue.grass, '#3f6b46'],
  [GRASSY_WEED, '#4a7a50'],
  [FloorTypeValue.road, '#9a8163'],
  [DIRT_PATCH, '#8a7154'],
  [TREE, '#1f3d2b'],
  [RUBBLE, '#5a5348'],
  [RUINED_WALL, '#6b6459'],
  [BUILDING_WALL, '#cbb89a'],
  [ROOF_THATCH, '#c9a25e'],
  [ROOF_SLATE, '#7b8794'],
  [ROOF_RED, '#a4553e'],
  [ROOF_GREEN, '#4f7a56'],
  [ROOF_CIRCUS_RED, '#c0453f'],
  [ROOF_CIRCUS_BLUE, '#3f6fc0'],
  [ROOF_CIRCUS_PURPLE, '#7b4fc0'],
  [FOUNTAIN, '#3fa9c0'],
  [TORCH, '#e8a33d'],
  [WELL, '#6f6250'],
  [MAIN_TOWER, '#d8c9a8'],
  [SPRITE_BUILDING, '#d8c9a8'],
  // Darker than any street so the ring reads at a glance, which is the one thing
  // this view exists to show. The wall's in-game stone is much lighter.
  [TOWN_WALL, '#4b4640'],
  [VERGE_GRASS, '#5e7345'],
  [YARD_GRAVEL, '#7d7568'],
  [LANE_STREET, '#9c8768'],
  [COBBLE_STREET, '#a89880'],
  [PLAZA_STONE, '#c0b49c'],
  [GARDEN_PLANTING, '#4f6a2c'],
  [FENCE, '#8a6a3c'],
]);

/** Header band above the map viewport. */
const HEADER_HEIGHT = 58;
const TITLE_Y = 12;
const SUBTITLE_Y = 34;
const TITLE_SIZE = 19;
const HINT_SIZE = 12;
const MARGIN = 20;

/** Metrics panel, drawn over the map in the bottom-left corner. */
const METRICS_PANEL_WIDTH = 320;
const METRICS_PANEL_PADDING = 12;
const METRICS_ROW_HEIGHT = 17;
const METRICS_SIZE = 12;
const METRICS_VALUE_COLUMN = 196;
const METRICS_BOTTOM_GAP = 18;

/** Tiles of empty ground kept around the town when framing the town view. */
const TOWN_VIEW_MARGIN_TILES = 8;

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
 * The browser fires `click` after every press/release pair regardless of
 * movement, so without this every pan would end by switching views.
 */
const DRAG_THRESHOLD_PX = 4;

/** Tiles of the map kept on screen when panning, so it can never be lost off-view. */
const MIN_VISIBLE_TILES = 4;

const FOOTPRINT_LINE_WIDTH = 1;
const OVERLAY_LINE_WIDTH = 1.5;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

type MapView = 'town' | 'world';

export class TownMapScene extends Scene {
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

  constructor(private readonly sceneManager: SceneManager) {
    super();
    this.size = level3.mapSize;
    this.data = generateOverworld(this.size);
    this.plots = collectBuildingPlots(this.data);
    this.metrics = measureTown(this.plots, this.data);
    this.frameView();
    logMetrics(this.metrics, this.data);
  }

  handleClick(): void {
    if (this.dragDistancePx > DRAG_THRESHOLD_PX) return;
    this.view = this.view === 'town' ? 'world' : 'town';
    this.frameView();
  }

  handleMouseDown(mx: number, my: number): void {
    this.dragAnchor = { mx, my };
    this.dragDistancePx = 0;
  }

  handleMouseMove(mx: number, my: number): void {
    const anchor = this.dragAnchor;
    if (anchor === null) return;
    this.dragDistancePx += Math.hypot(mx - anchor.mx, my - anchor.my);
    this.originTileX -= (mx - anchor.mx) / this.pxPerTile;
    this.originTileY -= (my - anchor.my) / this.pxPerTile;
    this.dragAnchor = { mx, my };
    this.clampOrigin();
  }

  handleMouseUp(): void {
    this.dragAnchor = null;
  }

  handleMouseLeave(): void {
    this.dragAnchor = null;
  }

  /**
   * Zooms about the viewport centre, keeping the tile there fixed. Not
   * cursor-anchored: `Scene.handleWheel` receives only a delta, so zooming to
   * the pointer would need a signature change across every scene.
   */
  handleWheel(deltaY: number): void {
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
    const { width, height } = this.sceneManager.canvas;
    return { width, height: height - HEADER_HEIGHT };
  }

  /** Fits the current view's tile region into the viewport and centres it. */
  private frameView(): void {
    const region =
      this.view === 'world'
        ? { x: 0, y: 0, w: this.size, h: this.size }
        : expandRect(this.metrics.bounds, TOWN_VIEW_MARGIN_TILES);
    const viewport = this.viewportSize();
    const fit = Math.min(viewport.width / region.w, viewport.height / region.h);
    this.pxPerTile = clamp(fit, MIN_PX_PER_TILE, MAX_PX_PER_TILE);
    this.originTileX = region.x + region.w / 2 - viewport.width / this.pxPerTile / 2;
    this.originTileY = region.y + region.h / 2 - viewport.height / this.pxPerTile / 2;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.sceneManager.canvas;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    drawText(ctx, `Town map — ${this.view === 'town' ? 'town' : 'whole world'}`, {
      x: MARGIN,
      y: TITLE_Y,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    drawText(ctx, 'click to switch view · scroll to zoom · drag to pan', {
      x: MARGIN,
      y: SUBTITLE_Y,
      size: HINT_SIZE,
      color: HINT_COLOR,
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, width, height - HEADER_HEIGHT);
    ctx.clip();
    ctx.translate(
      -this.originTileX * this.pxPerTile,
      HEADER_HEIGHT - this.originTileY * this.pxPerTile,
    );

    this.renderTiles(ctx);
    this.renderOverlays(ctx);

    ctx.restore();

    this.renderMetricsPanel(ctx, height);
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

    ctx.lineWidth = FOOTPRINT_LINE_WIDTH;
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

    if (px < NAME_LABEL_MIN_PX_PER_TILE) return;
    for (const plot of this.plots) {
      drawText(ctx, plot.name, {
        x: (plot.rect.x + plot.rect.w / 2) * px,
        y: (plot.rect.y + plot.rect.h / 2) * px,
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

  private renderMetricsPanel(ctx: CanvasRenderingContext2D, canvasHeight: number): void {
    const rows = metricRows(this.metrics, this.data);
    const panelHeight = rows.length * METRICS_ROW_HEIGHT + METRICS_PANEL_PADDING * 2;
    const panelY = canvasHeight - panelHeight - METRICS_BOTTOM_GAP;

    drawBox(ctx, {
      x: MARGIN,
      y: panelY,
      width: METRICS_PANEL_WIDTH,
      height: panelHeight,
      fill: 'rgba(8, 11, 18, 0.9)',
      border: '#334155',
    });

    rows.forEach(([label, value], index) => {
      const rowY = panelY + METRICS_PANEL_PADDING + index * METRICS_ROW_HEIGHT;
      drawText(ctx, label, {
        x: MARGIN + METRICS_PANEL_PADDING,
        y: rowY,
        size: METRICS_SIZE,
        color: METRIC_LABEL_COLOR,
      });
      drawText(ctx, value, {
        x: MARGIN + METRICS_PANEL_PADDING + METRICS_VALUE_COLUMN,
        y: rowY,
        size: METRICS_SIZE,
        color: LABEL_COLOR,
        bold: true,
      });
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
