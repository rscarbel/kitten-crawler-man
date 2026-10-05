/**
 * Localhost-only harness for reviewing the generated ground tilesets, reached
 * via `?tiles` in `devBootScene` (see `game.ts`). Never on a production path.
 *
 * Three views, cycled by tapping the art or the header's view button:
 *
 *  - **Materials** — every material laid out over a large area with its variants
 *    and patch phases resolved exactly as the game renderer will resolve them.
 *    This is the view that answers "is there a visible grid?", so it deliberately
 *    shows a big field of each material rather than a small swatch.
 *  - **Transitions** — an irregular region of one material meeting another, so
 *    the boundary can be judged at the angles it will actually occur at.
 *  - **Walls** — a small hand-laid dungeon holding every dungeon wall shape
 *    (corners, corridor mouths, a pillar, a stub, thin walls, a sign plaque),
 *    drawn through the real tile renderer on both floors side by side.
 *
 * The transition view calls the renderer's own `drawFringe`, over materials the
 * game does not currently place and pairs the map never produces. Judging a
 * boundary against a reimplementation of it would be worth nothing.
 */

import { viewportWidth, viewportHeight } from '../core/Viewport';
import { worldText } from '../ui/world/worldText';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import type { WorldGesture } from '../ui/core/UiRoot';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { getSpriteDef, type SpriteDef, type SpriteStateDef } from '../core/SpriteLoader';
import { TILE_SIZE } from '../core/constants';
import { groundFrameIndex, groundVariantCount } from '../map/ground/groundFrames';
import { drawFringe, type FringeMaterial, type ResolvedMaterial } from '../map/tiles/groundTiles';
import { requestGroundSheets } from '../map/ground/runtimeGroundSheets';
import { renderCanvas, renderDecorationsOverlay } from '../map/TileRenderer';
import { buildWallCaseStructure } from '../map/dungeon/wallCaseFixture';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  setDungeonFloorTheme,
  type DungeonFloorThemeId,
} from '../map/dungeon/floorTheme';
import { flushEnvironmentArtCache } from '../map/environmentArtCache';
import {
  DEFAULT_FLOOR_ART_SEED,
  drawFloorArtSeed,
  floorArtSubSeed,
  GROUND_VARIANT_SALT,
  setFloorArtSeed,
} from '../map/ground/floorArtSeed';
import { previewInk } from '../ui/theme/previewInk';
import { worldPalette } from '../ui/theme/worldInk';

const BG_COLOR = previewInk.bench.backdrop;
const LABEL_COLOR = worldPalette.ink.secondary;
const HINT_COLOR = worldPalette.ink.hint;

/** Sheets reviewed by this scene, in display order. */
const SHEET_KEYS = [
  'ground_overworld',
  'ground_floor1',
  'ground_floor2',
  'ground_interior',
  'ground_dungeon',
] as const;

const PREVIEW_TILE = TILE_SIZE;
const PANEL_COLUMNS = 4;
const PANEL_TILES_ACROSS = 9;
const PANEL_TILES_DOWN = 7;
const PANEL_LABEL_HEIGHT = 20;
const PANEL_GAP = 10;
const MARGIN = 24;
const EMPTY_STATE_TITLE_SIZE = 18;
const HINT_SIZE = 13;
const META_SIZE = 11;
const LABEL_BASELINE_NUDGE = 3;
const EMPTY_STATE_LINE_GAP = 26;

/** Transition preview grid, in tiles. */
const TRANSITION_GRID_ACROSS = 13;
const TRANSITION_GRID_DOWN = 10;
const TRANSITION_COLUMNS = 3;

interface RegionLobe {
  readonly centreX: number;
  readonly centreY: number;
  readonly radiusX: number;
  readonly radiusY: number;
}

// The previewed region is three overlapping ellipses, tested at tile centres —
// the same classification the map gives the renderer, one material per tile.
// Centres and radii are deliberately fractional and off-grid: a region aligned
// to whole tiles would only ever exercise axis-aligned boundaries, which is
// exactly the case the corner masks are least interesting for.
const UPPER_LOBE: RegionLobe = { centreX: 4.2, centreY: 4.0, radiusX: 3.2, radiusY: 2.6 };
const LOWER_LOBE: RegionLobe = { centreX: 8.0, centreY: 6.4, radiusX: 3.4, radiusY: 3.2 };
const TAIL_LOBE: RegionLobe = { centreX: 6.2, centreY: 8.8, radiusX: 1.9, radiusY: 1.6 };
const TRANSITION_REGION_LOBES: ReadonlyArray<RegionLobe> = [UPPER_LOBE, LOWER_LOBE, TAIL_LOBE];

/** A normalised ellipse test is inside when the sum of squared ratios is below 1. */
const UNIT_ELLIPSE = 1;

/** Tiles are classified at their centres. */
const TILE_CENTRE = 0.5;

/** Blend order for a previewed pair: the second material is always the harder. */
const BASE_BLEND_ORDER = 0;
const OVER_BLEND_ORDER = 1;

interface MaterialEntry {
  readonly def: SpriteDef;
  readonly state: SpriteStateDef;
  readonly sheetKey: string;
  readonly id: string;
  readonly label: string;
  readonly patchTiles: number;
  readonly variants: number;
}

type PreviewMode = 'materials' | 'transitions' | 'walls';

const MODE_LABELS: Readonly<Record<PreviewMode, string>> = {
  materials: 'materials',
  transitions: 'transitions',
  walls: 'walls',
};

const NEXT_MODE: Readonly<Record<PreviewMode, PreviewMode>> = {
  materials: 'transitions',
  transitions: 'walls',
  walls: 'materials',
};

/** Floors drawn side by side in the Walls view. */
const WALL_VIEW_THEMES: ReadonlyArray<{
  readonly id: DungeonFloorThemeId;
  readonly label: string;
}> = [
  { id: 'cellars', label: 'Floor 1 — cellars' },
  { id: 'service_level', label: 'Floor 2 — service level' },
];
const WALL_VIEW_GAP_TILES = 1;

export class TilePreviewScene extends PreviewScene {
  private mode: PreviewMode = 'materials';
  private scrollY = 0;
  private readonly materials: MaterialEntry[] = [];
  /**
   * Starts at the reviewed, unvaried look so the route opens on the art every
   * material was signed off against; `R` moves off it.
   */
  private artSeed = DEFAULT_FLOOR_ART_SEED;

  constructor() {
    super();
    this.repaint();
  }

  /**
   * Draws a fresh art seed and repaints every sheet under it.
   *
   * The point of the review route is judging the *envelope* the seed moves
   * inside, not one draw from it, so rerolling here is what a reviewer is
   * actually looking at: the same materials, a different grain, and the
   * question of whether any of them stopped reading.
   */
  private repaint(): void {
    flushEnvironmentArtCache();
    setFloorArtSeed(this.artSeed);
    requestGroundSheets(SHEET_KEYS, () => this.collectMaterials());
    this.collectMaterials();
  }

  private collectMaterials(): void {
    this.materials.length = 0;
    for (const key of SHEET_KEYS) {
      const def = getSpriteDef(key);
      if (!def) continue;
      for (const [stateName, state] of def.states) {
        this.materials.push({
          def,
          state,
          sheetKey: key,
          id: stateName,
          label: state.label ?? stateName,
          patchTiles: state.patchTiles ?? 1,
          variants: groundVariantCount(state),
        });
      }
    }
  }

  private nextMode(): void {
    this.mode = NEXT_MODE[this.mode];
    this.scrollY = 0;
  }

  private reseed(): void {
    this.artSeed = drawFloorArtSeed();
    this.repaint();
  }

  protected previewTitle(): string {
    return this.mode === 'materials'
      ? 'generated ground — materials — ?tiles'
      : this.mode === 'transitions'
        ? 'generated ground — transitions (live composite via corner masks) — ?tiles'
        : 'dungeon walls — every wall shape, both floors — ?tiles';
  }

  protected previewCaptions(): readonly string[] {
    return [
      `art seed ${this.artSeed}`,
      'tap to switch view · scroll to pan · right-click to reseed',
    ];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      {
        id: 'view',
        label: `view: ${MODE_LABELS[this.mode]}`,
        onTap: () => {
          this.nextMode();
        },
      },
      {
        label: 'new art seed',
        onTap: () => {
          this.reseed();
        },
      },
    ];
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.kind === 'wheel') {
      this.scrollY = Math.max(0, this.scrollY + gesture.deltaY);
      return;
    }
    if (gesture.kind !== 'up' || !gesture.tap) return;
    if (gesture.button === PRIMARY_BUTTON) this.nextMode();
    else this.reseed();
  }

  update(): void {
    // The preview is repainted only on input, so there is nothing to advance per frame.
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    entry: MaterialEntry,
    tx: number,
    ty: number,
    x: number,
    y: number,
  ): void {
    const frame = Math.min(
      groundFrameIndex(
        entry.patchTiles,
        entry.variants,
        tx,
        ty,
        floorArtSubSeed(GROUND_VARIANT_SALT),
      ),
      entry.state.frameCount - 1,
    );
    const { frameWidth, frameHeight } = entry.def;
    ctx.drawImage(
      entry.def.img,
      frame * frameWidth,
      entry.state.row * frameHeight,
      frameWidth,
      frameHeight,
      x,
      y,
      PREVIEW_TILE,
      PREVIEW_TILE,
    );
  }

  private byId(id: string): MaterialEntry | undefined {
    return this.materials.find((m) => m.id === id);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const headerBottom = this.headerBottom;

    if (this.materials.length === 0) {
      worldText(ctx, 'No generated ground sheets found.', {
        x: MARGIN,
        y: headerBottom + MARGIN,
        size: EMPTY_STATE_TITLE_SIZE,
      });
      worldText(ctx, 'Painting — the sheets arrive a few materials a frame.', {
        x: MARGIN,
        y: headerBottom + MARGIN + EMPTY_STATE_LINE_GAP,
        size: HINT_SIZE,
        color: HINT_COLOR,
      });
      this.renderChrome(ctx);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerBottom, width, height - headerBottom);
    ctx.clip();
    ctx.translate(0, headerBottom - this.scrollY);

    if (this.mode === 'materials') this.renderMaterials(ctx);
    else if (this.mode === 'transitions') this.renderTransitions(ctx);
    else this.renderWalls(ctx);

    ctx.restore();
    this.renderChrome(ctx);
  }

  private readonly wallCases = buildWallCaseStructure();

  /**
   * The wall-case fixture drawn by the game's own tile renderer under each
   * floor's theme. The theme is module state the painters read, so it is set
   * around each panel and put back to the default after.
   */
  private renderWalls(ctx: CanvasRenderingContext2D): void {
    const structure = this.wallCases;
    const panelW = (structure[0]?.length ?? 0) * PREVIEW_TILE;
    const panelH = structure.length * PREVIEW_TILE;
    WALL_VIEW_THEMES.forEach((theme, index) => {
      const originX = MARGIN + index * (panelW + WALL_VIEW_GAP_TILES * PREVIEW_TILE);
      const originY = PANEL_LABEL_HEIGHT;
      worldText(ctx, theme.label, {
        x: originX,
        y: LABEL_BASELINE_NUDGE,
        size: HINT_SIZE,
        color: LABEL_COLOR,
      });
      setDungeonFloorTheme(theme.id);
      ctx.save();
      ctx.translate(originX, originY);
      renderCanvas(ctx, structure, PREVIEW_TILE, 0, 0, panelW, panelH);
      renderDecorationsOverlay(ctx, structure, PREVIEW_TILE, 0, 0, panelW, panelH);
      ctx.restore();
    });
    setDungeonFloorTheme(DEFAULT_DUNGEON_FLOOR_THEME);
  }

  private renderMaterials(ctx: CanvasRenderingContext2D): void {
    const panelWidth = PANEL_TILES_ACROSS * PREVIEW_TILE;
    const panelHeight = PANEL_TILES_DOWN * PREVIEW_TILE;

    this.materials.forEach((entry, index) => {
      const originX = MARGIN + (index % PANEL_COLUMNS) * (panelWidth + PANEL_GAP);
      const originY =
        Math.floor(index / PANEL_COLUMNS) * (panelHeight + PANEL_LABEL_HEIGHT + PANEL_GAP) +
        PANEL_LABEL_HEIGHT;

      // Offset each panel's tile coordinates so panels don't all show the same
      // corner of the variant hash.
      const originTile = index * PANEL_TILES_ACROSS;
      for (let ty = 0; ty < PANEL_TILES_DOWN; ty++) {
        for (let tx = 0; tx < PANEL_TILES_ACROSS; tx++) {
          this.drawTile(
            ctx,
            entry,
            originTile + tx,
            ty,
            originX + tx * PREVIEW_TILE,
            originY + ty * PREVIEW_TILE,
          );
        }
      }

      worldText(ctx, entry.label, {
        x: originX,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: HINT_SIZE,
        color: LABEL_COLOR,
      });
      worldText(ctx, `${entry.patchTiles}x${entry.patchTiles} patch · ${entry.variants} variants`, {
        x: originX + panelWidth,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: META_SIZE,
        color: HINT_COLOR,
        align: 'right',
      });
    });
  }

  /**
   * Pairs previewed as blended boundaries, softer material first.
   *
   * These should be the boundaries the maps actually draw, or the route stops
   * being a useful check on them. The four town joints below are the ones the
   * town's street plan produces most of: `verge` against `lane` runs along every
   * frontage and every wall base, `verge` against `plaza` rings the market square,
   * `lane` against `plaza` is every lane mouth opening onto it, and `gravel`
   * against `lane` is every workyard's edge.
   */
  private static readonly TRANSITION_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['verge', 'lane'],
    ['verge', 'plaza'],
    ['lane', 'plaza'],
    ['gravel', 'lane'],
    ['grass', 'verge'],
    ['grass', 'lane'],
    ['grass', 'dirt'],
    ['lane', 'cobble'],
    ['dirt', 'gravel'],
    // The floor-3 wilderness joints. The first is the most load-bearing edge on
    // the whole map: nothing draws a riverbank except grass bleeding over water
    // through the corner masks, so this pair *is* the bank, and this route is
    // the only place it can be judged on its own.
    ['water', 'grass'],
    ['water', 'highland'],
    ['grass', 'highland'],
    ['highland', 'scree'],
    // Briar Hollow's soft joints: the pasture's fence line against the
    // meadow, and a field's ploughed edge. Its plank floor is absent because
    // it is hard-edged and never blends.
    ['pasture_grass', 'grass'],
    ['grass', 'crop_rows'],
    // The joints each dungeon floor actually draws: its calm bulk material
    // against each of the three surfaces `ZONE_FLOORS` lays beside it.
    ['f1_flagstone', 'f1_flags'],
    ['f1_flagstone', 'f1_timber'],
    ['f1_cinder', 'f1_flagstone'],
    ['f2_concrete', 'f2_terrazzo'],
    ['f2_concrete', 'f2_plate'],
    ['f2_concrete', 'f2_vinyl'],
    // A town interior lays one floor end to end, so these two never actually
    // meet on a map — previewed anyway because the pair is the only way to see
    // both interior floors at the same scale.
    ['interior_boards', 'interior_stone'],
    // The two joints a safe room actually draws: the hearth paving under the
    // counter run meeting the room tile, and the scuffed threshold band worn
    // through it inside each doorway.
    ['bopca_hearth', 'bopca_tile'],
    ['bopca_scuff', 'bopca_tile'],
  ];

  /** A previewed material, in the shape the renderer's fringe consumes. */
  private fringeMaterial(entry: MaterialEntry, order: number): FringeMaterial {
    return {
      id: entry.id,
      sheetKey: entry.sheetKey,
      order,
      resolve: (tx: number, ty: number): ResolvedMaterial => ({
        def: entry.def,
        state: entry.state,
        // Clamped as the renderer clamps, so a mis-sized row previews the way it
        // would draw rather than reading off the end of its own row.
        frame: Math.min(
          groundFrameIndex(
            entry.patchTiles,
            entry.variants,
            tx,
            ty,
            floorArtSubSeed(GROUND_VARIANT_SALT),
          ),
          entry.state.frameCount - 1,
        ),
      }),
    };
  }

  private renderTransitions(ctx: CanvasRenderingContext2D): void {
    const blockWidth = TRANSITION_GRID_ACROSS * PREVIEW_TILE;
    const blockHeight = TRANSITION_GRID_DOWN * PREVIEW_TILE;

    const inside = (tx: number, ty: number): boolean =>
      TRANSITION_REGION_LOBES.some(
        (lobe) =>
          ((tx + TILE_CENTRE - lobe.centreX) / lobe.radiusX) ** 2 +
            ((ty + TILE_CENTRE - lobe.centreY) / lobe.radiusY) ** 2 <
          UNIT_ELLIPSE,
      );

    TilePreviewScene.TRANSITION_PAIRS.forEach(([baseId, overId], index) => {
      const base = this.byId(baseId);
      const over = this.byId(overId);
      if (base === undefined || over === undefined) return;

      const baseLayer = this.fringeMaterial(base, BASE_BLEND_ORDER);
      const overLayer = this.fringeMaterial(over, OVER_BLEND_ORDER);
      const materialAt = (tx: number, ty: number): FringeMaterial =>
        inside(tx, ty) ? overLayer : baseLayer;

      const originX = MARGIN + (index % TRANSITION_COLUMNS) * (blockWidth + PANEL_GAP);
      const originY =
        Math.floor(index / TRANSITION_COLUMNS) * (blockHeight + PANEL_LABEL_HEIGHT + PANEL_GAP) +
        PANEL_LABEL_HEIGHT;

      for (let ty = 0; ty < TRANSITION_GRID_DOWN; ty++) {
        for (let tx = 0; tx < TRANSITION_GRID_ACROSS; tx++) {
          const own = materialAt(tx, ty);
          const x = originX + tx * PREVIEW_TILE;
          const y = originY + ty * PREVIEW_TILE;
          this.drawTile(ctx, own === overLayer ? over : base, tx, ty, x, y);
          drawFringe(ctx, own, materialAt, x, y, PREVIEW_TILE, tx, ty);
        }
      }

      worldText(ctx, `${base.label} -> ${over.label}`, {
        x: originX,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: HINT_SIZE,
        color: LABEL_COLOR,
      });
    });
  }
}
