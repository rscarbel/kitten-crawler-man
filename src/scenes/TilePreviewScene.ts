/**
 * Localhost-only harness for reviewing the generated ground tilesets, reached
 * via `?tiles` in `devBootScene` (see `game.ts`). Never on a production path.
 *
 * Two views, toggled by clicking:
 *
 *  - **Materials** — every material laid out over a large area with its variants
 *    and patch phases resolved exactly as the game renderer will resolve them.
 *    This is the view that answers "is there a visible grid?", so it deliberately
 *    shows a big field of each material rather than a small swatch.
 *  - **Transitions** — an irregular region of one material meeting another, so
 *    the boundary can be judged at the angles it will actually occur at.
 *
 * The transition view calls the renderer's own `drawFringe`, over materials the
 * game does not currently place and pairs the map never produces. Judging a
 * boundary against a reimplementation of it would be worth nothing.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { getSpriteDef, type SpriteDef, type SpriteStateDef } from '../core/SpriteLoader';
import { TILE_SIZE } from '../core/constants';
import { groundFrameIndex, groundVariantCount } from '../map/ground/groundFrames';
import { drawFringe, type FringeMaterial, type ResolvedMaterial } from '../map/tiles/groundTiles';

const BG_COLOR = '#12161f';
const LABEL_COLOR = '#cbd5e1';
const HINT_COLOR = '#94a3b8';

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
const HEADER_HEIGHT = 54;
const TITLE_Y = 14;
const SUBTITLE_Y = 36;
const TITLE_SIZE = 20;
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

type PreviewMode = 'materials' | 'transitions';

export class TilePreviewScene extends Scene {
  private mode: PreviewMode = 'materials';
  private scrollY = 0;
  private readonly materials: MaterialEntry[] = [];

  constructor() {
    super();
    this.collectMaterials();
  }

  private collectMaterials(): void {
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

  handleClick(): void {
    this.mode = this.mode === 'materials' ? 'transitions' : 'materials';
    this.scrollY = 0;
  }

  handleWheel(deltaY: number): void {
    this.scrollY = Math.max(0, this.scrollY + deltaY);
  }

  update(): void {
    // Static preview — nothing animates.
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
      groundFrameIndex(entry.patchTiles, entry.variants, tx, ty),
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

    if (this.materials.length === 0) {
      drawText(ctx, 'No generated ground sheets found.', { x: MARGIN, y: MARGIN, size: 18 });
      drawText(ctx, 'Run: npx tsx scripts/generate-ground-tileset.ts', {
        x: MARGIN,
        y: MARGIN + EMPTY_STATE_LINE_GAP,
        size: HINT_SIZE,
        color: HINT_COLOR,
      });
      return;
    }

    const title =
      this.mode === 'materials'
        ? 'Generated ground — materials'
        : 'Generated ground — transitions (live composite via corner masks)';
    drawText(ctx, title, {
      x: MARGIN,
      y: TITLE_Y,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    drawText(ctx, 'click to switch view · scroll to pan', {
      x: MARGIN,
      y: SUBTITLE_Y,
      size: HINT_SIZE,
      color: HINT_COLOR,
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, width, height - HEADER_HEIGHT);
    ctx.clip();
    ctx.translate(0, HEADER_HEIGHT - this.scrollY);

    if (this.mode === 'materials') this.renderMaterials(ctx);
    else this.renderTransitions(ctx);

    ctx.restore();
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

      drawText(ctx, entry.label, {
        x: originX,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: HINT_SIZE,
        color: LABEL_COLOR,
      });
      drawText(ctx, `${entry.patchTiles}x${entry.patchTiles} patch · ${entry.variants} variants`, {
        x: originX + panelWidth,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: META_SIZE,
        color: HINT_COLOR,
        align: 'right',
      });
    });
  }

  /** Material pairs worth judging an edge on, base first. */
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
          groundFrameIndex(entry.patchTiles, entry.variants, tx, ty),
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

      drawText(ctx, `${base.label} -> ${over.label}`, {
        x: originX,
        y: originY - PANEL_LABEL_HEIGHT + LABEL_BASELINE_NUDGE,
        size: HINT_SIZE,
        color: LABEL_COLOR,
      });
    });
  }
}
