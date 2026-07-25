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
 *  - **Transitions** — an irregular region of one material composited over
 *    another using the shared corner masks, so the boundary can be judged at the
 *    angles it will actually occur at.
 *
 * The transition view composites at runtime from `ground_masks`, which is how the
 * real renderer will do it too: masks are generic, so any material can meet any
 * other without pre-baking a sheet per pair.
 */

import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import { drawText } from '../ui/TextBox';
import { getSpriteDef, type SpriteDef, type SpriteStateDef } from '../core/SpriteLoader';
import { TILE_SIZE } from '../core/constants';

const BG_COLOR = '#12161f';
const LABEL_COLOR = '#cbd5e1';
const HINT_COLOR = '#94a3b8';

/** Sheets reviewed by this scene, in display order. */
const SHEET_KEYS = ['ground_overworld', 'ground_dungeon'] as const;
const MASK_SHEET_KEY = 'ground_masks';
const MASK_STATE = 'corner';

/** Corner bits, matching scripts/tilegen/masks.ts. */
const CORNER_NW = 1;
const CORNER_NE = 2;
const CORNER_SE = 4;
const CORNER_SW = 8;
const CORNER_ALL = CORNER_NW | CORNER_NE | CORNER_SE | CORNER_SW;

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

// The previewed region is three overlapping ellipses on the corner lattice.
// Centres and radii are deliberately fractional and off-grid: a region aligned
// to whole tiles would only ever exercise axis-aligned boundaries, which is
// exactly the case the corner masks are least interesting for.
const UPPER_LOBE: RegionLobe = { centreX: 4.2, centreY: 4.0, radiusX: 3.2, radiusY: 2.6 };
const LOWER_LOBE: RegionLobe = { centreX: 8.0, centreY: 6.4, radiusX: 3.4, radiusY: 3.2 };
const TAIL_LOBE: RegionLobe = { centreX: 6.2, centreY: 8.8, radiusX: 1.9, radiusY: 1.6 };
const TRANSITION_REGION_LOBES: ReadonlyArray<RegionLobe> = [UPPER_LOBE, LOWER_LOBE, TAIL_LOBE];

/** A normalised ellipse test is inside when the sum of squared ratios is below 1. */
const UNIT_ELLIPSE = 1;

/** Decorrelated multipliers for the per-patch variant hash. */
const VARIANT_HASH_X = 73856093;
const VARIANT_HASH_Y = 19349663;

interface MaterialEntry {
  readonly def: SpriteDef;
  readonly state: SpriteStateDef;
  readonly id: string;
  readonly label: string;
  readonly patchTiles: number;
  readonly variants: number;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

type PreviewMode = 'materials' | 'transitions';

export class TilePreviewScene extends Scene {
  private mode: PreviewMode = 'materials';
  private scrollY = 0;
  private readonly materials: MaterialEntry[] = [];
  private maskCanvas: HTMLCanvasElement | null = null;
  private readonly compositeCache = new Map<string, HTMLCanvasElement>();

  constructor(private readonly sceneManager: SceneManager) {
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
          id: stateName,
          label: state.label ?? stateName,
          patchTiles: state.patchTiles ?? 1,
          variants: Math.max(1, state.frameCount / (state.patchTiles ?? 1) ** 2),
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

  /**
   * Resolves which frame a map tile draws: the variant is hashed per *patch* so
   * a whole patch keeps one variant, and the phase within the patch is fixed by
   * position so neighbouring tiles stay aligned. Kept identical to the offline
   * generator's ordering and to what the renderer will do in Phase 2.
   */
  private frameIndex(entry: MaterialEntry, tx: number, ty: number): number {
    const n = entry.patchTiles;
    const patchX = Math.floor(tx / n);
    const patchY = Math.floor(ty / n);
    const hash = (Math.imul(patchX, VARIANT_HASH_X) ^ Math.imul(patchY, VARIANT_HASH_Y)) >>> 0;
    const variant = hash % entry.variants;
    const phase = positiveMod(ty, n) * n + positiveMod(tx, n);
    return variant * n * n + phase;
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    entry: MaterialEntry,
    tx: number,
    ty: number,
    x: number,
    y: number,
  ): void {
    const frame = this.frameIndex(entry, tx, ty);
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

  /** Lazily builds the mask sheet into an offscreen canvas for compositing. */
  private getMaskCanvas(): HTMLCanvasElement | null {
    if (this.maskCanvas !== null) return this.maskCanvas;
    const def = getSpriteDef(MASK_SHEET_KEY);
    if (!def) return null;
    const canvas = document.createElement('canvas');
    canvas.width = def.img.width;
    canvas.height = def.img.height;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(def.img, 0, 0);
    this.maskCanvas = canvas;
    return canvas;
  }

  /**
   * Builds one transition tile: the overlay material clipped to a corner mask,
   * drawn over the base material. `destination-in` keeps only the pixels the
   * mask's alpha covers, which is why the generator stores masks in alpha.
   */
  private compositeTransition(
    base: MaterialEntry,
    over: MaterialEntry,
    bits: number,
    tx: number,
    ty: number,
  ): HTMLCanvasElement | null {
    const cacheKey = `${base.id}|${over.id}|${bits}|${positiveMod(tx, over.patchTiles)}|${positiveMod(ty, over.patchTiles)}|${positiveMod(tx, base.patchTiles)}|${positiveMod(ty, base.patchTiles)}`;
    const cached = this.compositeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const maskDef = getSpriteDef(MASK_SHEET_KEY);
    const maskCanvas = this.getMaskCanvas();
    if (!maskDef || maskCanvas === null) return null;
    const maskState = maskDef.states.get(MASK_STATE);
    if (maskState === undefined) return null;

    const size = PREVIEW_TILE;
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const context = tile.getContext('2d');
    if (context === null) return null;

    this.drawTile(context, base, tx, ty, 0, 0);

    if (bits !== 0) {
      const layer = document.createElement('canvas');
      layer.width = size;
      layer.height = size;
      const layerCtx = layer.getContext('2d');
      if (layerCtx === null) return null;
      this.drawTile(layerCtx, over, tx, ty, 0, 0);
      if (bits !== CORNER_ALL) {
        layerCtx.globalCompositeOperation = 'destination-in';
        layerCtx.drawImage(
          maskCanvas,
          bits * maskDef.frameWidth,
          maskState.row * maskDef.frameHeight,
          maskDef.frameWidth,
          maskDef.frameHeight,
          0,
          0,
          size,
          size,
        );
      }
      context.drawImage(layer, 0, 0);
    }

    this.compositeCache.set(cacheKey, tile);
    return tile;
  }

  private byId(id: string): MaterialEntry | undefined {
    return this.materials.find((m) => m.id === id);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.sceneManager.canvas;
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
  private static readonly TRANSITION_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['grass', 'lane'],
    ['grass', 'dirt'],
    ['lane', 'cobble'],
    ['dirt', 'gravel'],
    ['dungeon_plain', 'dungeon_mossy'],
    ['dungeon_plain', 'dungeon_rubble'],
  ];

  private renderTransitions(ctx: CanvasRenderingContext2D): void {
    const blockWidth = TRANSITION_GRID_ACROSS * PREVIEW_TILE;
    const blockHeight = TRANSITION_GRID_DOWN * PREVIEW_TILE;

    const inside = (cx: number, cy: number): boolean =>
      TRANSITION_REGION_LOBES.some(
        (lobe) =>
          ((cx - lobe.centreX) / lobe.radiusX) ** 2 + ((cy - lobe.centreY) / lobe.radiusY) ** 2 <
          UNIT_ELLIPSE,
      );

    TilePreviewScene.TRANSITION_PAIRS.forEach(([baseId, overId], index) => {
      const base = this.byId(baseId);
      const over = this.byId(overId);
      if (base === undefined || over === undefined) return;

      const originX = MARGIN + (index % TRANSITION_COLUMNS) * (blockWidth + PANEL_GAP);
      const originY =
        Math.floor(index / TRANSITION_COLUMNS) * (blockHeight + PANEL_LABEL_HEIGHT + PANEL_GAP) +
        PANEL_LABEL_HEIGHT;

      for (let ty = 0; ty < TRANSITION_GRID_DOWN; ty++) {
        for (let tx = 0; tx < TRANSITION_GRID_ACROSS; tx++) {
          const bits =
            (inside(tx, ty) ? CORNER_NW : 0) |
            (inside(tx + 1, ty) ? CORNER_NE : 0) |
            (inside(tx + 1, ty + 1) ? CORNER_SE : 0) |
            (inside(tx, ty + 1) ? CORNER_SW : 0);
          const tile = this.compositeTransition(base, over, bits, tx, ty);
          if (tile === null) {
            this.drawTile(
              ctx,
              base,
              tx,
              ty,
              originX + tx * PREVIEW_TILE,
              originY + ty * PREVIEW_TILE,
            );
            continue;
          }
          ctx.drawImage(tile, originX + tx * PREVIEW_TILE, originY + ty * PREVIEW_TILE);
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
