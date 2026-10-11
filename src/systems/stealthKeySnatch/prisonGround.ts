/**
 * What the Goblin High Security Prison is built of, painted at runtime: floor
 * 2's faced dungeon walls and slab floor, a quiet grime wash over the stone,
 * straw in the cells, iron bars, the yard's tall cover, the wall lamps and the
 * spotlight towers.
 *
 * The walls and floor go through the game's own chunked ground painter over a
 * private grid built from the prison's parse — walls as dungeon wall, every
 * open tile as slab — so the prison gets the floor's real wall faces and their
 * fade into shadow without the walkable map having to carry dungeon tile
 * types. The props that stand up out of the floor (bars, cover, cell doors)
 * are sorted figures, so a body north of them is drawn behind them.
 *
 * Grime is a tonal wash at one texel per tile, smoothed by the blit into soft
 * blotches: the floor stays a low-contrast backdrop so the cones read.
 */

import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { InteriorFigure } from '../../core/InteriorFigure';
import type { SpriteKey } from '../../core/SpriteLoader';
import {
  PRISON_TILE,
  prisonTileAt,
  type ParsedPrisonLayout,
  type PrisonGrid,
  type PrisonTile,
} from '../../map/goblinPrisonPlan';
import { setDungeonFloorTheme } from '../../map/dungeon/floorTheme';
import { requestGroundSheets } from '../../map/ground/runtimeGroundSheets';
import { renderCanvas, TileChunkCache } from '../../map/TileRenderer';
import { FloorTypeValue, type TileContent } from '../../map/tileTypes';
import {
  BARS_RISE_SHARE,
  COVER_RISE_SHARE,
  coverKindFor,
  paintCover,
  paintIronBars,
  paintWallLamp,
  type CellDoorRun,
  type CoverKind,
} from '../../sprites/art/prisonPropArt';

/** The floor sheets the prison's walls and slab are painted from: floor 2's. */
const PRISON_GROUND_SHEETS: ReadonlyArray<SpriteKey> = ['ground_floor2'];

/** A lamp hangs on every this-many tiles of lit wall face. */
const LAMP_SPACING_TILES = 7;
/** Offsets a wall run's lamps by its row so neighbouring rows do not line up. */
const LAMP_ROW_STAGGER = 3;
/** The flame sits this far down its wall tile, as a share of a tile. */
const LAMP_FLAME_DROP_SHARE = 0.48;

const HALF = 0.5;
/** Extra tiles of view a prop's art can reach into from beyond the view's edge. */
const PROP_VIEW_MARGIN_TILES = 3;

/** Grime: how dark the wash gets at its darkest, and the blotch scales it mixes. */
const GRIME_MAX_ALPHA = 0.2;
const GRIME_COARSE_TILES = 5;
const GRIME_COARSE_WEIGHT = 0.6;
/** Tiles of grime drawn past each edge of the view. */
const GRIME_CROP_MARGIN_TILES = 1;
const GRIME_FINE_WEIGHT = 0.4;
/** A grime colour, as `r,g,b`: a warm soot rather than black, so the stone reads stained, not shadowed. */
const GRIME_RGB = '28,20,12';
/** Cell straw: a warm tint over the slab inside holding and prisoner cells. */
const STRAW_RGB = '150,118,62';
const STRAW_ALPHA = 0.3;
/** Loose straws stroked over each straw tile, on top of the wash that fills the whole tile. */
const STRAW_SPECKS_PER_TILE = 6;
const STRAW_SPECK_LENGTH_SHARE = 0.28;
const STRAW_SPECK_RGB = '196,164,96';
const STRAW_SPECK_ALPHA = 0.35;
/** Hash salts, one per stream drawn from {@link latticeHash}, so no two streams repeat each other. */
const GRIME_COARSE_SALT = 1;
const GRIME_FINE_SALT = 2;
const STRAW_VARIANT_SALT = 5;
/** Distinct straw tiles the cell floors are drawn from. */
const STRAW_TILE_VARIANTS = 4;
/** What an arrival bake reports when it has nothing left to do. */
const ARRIVAL_BAKE_COMPLETE = 1;
const TOWER_RIM_WIDTH_PX = 2;
const SPECK_X_SALT = 3;
const SPECK_Y_SALT = 4;
const SPECK_ANGLE_SALT = 40;
/** Digits an rgba alpha is written with. */
const ALPHA_DIGITS = 3;

/** The spotlight tower housing: an iron drum on the wall the beam comes from. */
const TOWER_RADIUS_SHARE = 0.32;
const TOWER_LENS_SHARE = 0.18;
const TOWER_IRON = '#2c3036';
const TOWER_RIM = '#59606a';
const TOWER_LENS = '#fff2c8';

const HASH_PRIME_X = 374761393;
const HASH_PRIME_Y = 668265263;
const HASH_MIX = 1274126177;
const HASH_SHIFT = 13;
const HASH_FINAL_SHIFT = 16;
const UNIT_HASH_MASK = 0xffff;

/** A deterministic 0..1 value for a lattice point. */
function latticeHash(x: number, y: number, salt: number): number {
  let h = (x * HASH_PRIME_X + y * HASH_PRIME_Y + salt * HASH_MIX) | 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_MIX);
  h ^= h >>> HASH_FINAL_SHIFT;
  return (h & UNIT_HASH_MASK) / UNIT_HASH_MASK;
}

function isOpenTile(grid: PrisonGrid, x: number, y: number): boolean {
  return prisonTileAt(grid, x, y) !== PRISON_TILE.wall;
}

function isCellFloor(grid: PrisonGrid, x: number, y: number): boolean {
  const code = prisonTileAt(grid, x, y);
  return code === PRISON_TILE.holdingFloor || code === PRISON_TILE.prisonerFloor;
}

/** The grid the shared ground painter draws: dungeon wall where the prison is wall, slab everywhere else. */
function buildPaintGrid(grid: PrisonGrid): TileContent[][] {
  return Array.from({ length: grid.height }, (_row, y) =>
    Array.from({ length: grid.width }, (_column, x) => ({
      tileId: `${x}#${y}`,
      type: isOpenTile(grid, x, y) ? FloorTypeValue.concrete : FloorTypeValue.wall,
    })),
  );
}

/** A connected blob of cover tiles: its bounding box and how many tiles it holds. */
interface CoverBlob {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly tiles: number;
}

const NEIGHBOURS: ReadonlyArray<PrisonTile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function findCoverBlobs(grid: PrisonGrid): ReadonlyArray<CoverBlob> {
  const seen = new Uint8Array(grid.width * grid.height);
  const blobs: CoverBlob[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (seen[y * grid.width + x] === 1) continue;
      if (prisonTileAt(grid, x, y) !== PRISON_TILE.cover) continue;
      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
      let tiles = 0;
      const stack: PrisonTile[] = [{ x, y }];
      seen[y * grid.width + x] = 1;
      for (let tile = stack.pop(); tile !== undefined; tile = stack.pop()) {
        tiles++;
        x0 = Math.min(x0, tile.x);
        y0 = Math.min(y0, tile.y);
        x1 = Math.max(x1, tile.x);
        y1 = Math.max(y1, tile.y);
        for (const step of NEIGHBOURS) {
          const nx = tile.x + step.x;
          const ny = tile.y + step.y;
          if (prisonTileAt(grid, nx, ny) !== PRISON_TILE.cover) continue;
          if (seen[ny * grid.width + nx] === 1) continue;
          seen[ny * grid.width + nx] = 1;
          stack.push({ x: nx, y: ny });
        }
      }
      blobs.push({ x0, y0, x1, y1, tiles });
    }
  }
  return blobs;
}

/** Which way the bars on a tile run: along a column when their neighbours are above or below. */
function barsRunAt(grid: PrisonGrid, x: number, y: number): CellDoorRun {
  const isBars = (tx: number, ty: number): boolean =>
    prisonTileAt(grid, tx, ty) === PRISON_TILE.bars;
  const across = isBars(x - 1, y) || isBars(x + 1, y);
  const along = isBars(x, y - 1) || isBars(x, y + 1);
  return along && !across ? 'along' : 'across';
}

/** A prop baked once into its own canvas and blitted as a sorted figure. */
class BakedFigure implements InteriorFigure {
  private canvas: CanvasSurface | null = null;

  /**
   * @param y the sort row's top in world pixels: the figure sorts as standing on that row.
   * @param left world pixels of the canvas's left edge.
   * @param top world pixels of the canvas's top edge.
   */
  constructor(
    readonly y: number,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    private readonly paint: (ctx: CanvasRenderingContext2D) => void,
  ) {}

  private surface(): CanvasSurface {
    if (this.canvas !== null) return this.canvas;
    const canvas = allocCanvas(Math.ceil(this.width), Math.ceil(this.height));
    this.paint(surfaceContext(canvas));
    this.canvas = canvas;
    return canvas;
  }

  prewarm(): void {
    this.surface();
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    ctx.drawImage(this.surface(), Math.round(this.left - camX), Math.round(this.top - camY));
  }

  overlaps(minX: number, minY: number, maxX: number, maxY: number): boolean {
    return (
      this.left + this.width >= minX &&
      this.left <= maxX &&
      this.top + this.height >= minY &&
      this.top <= maxY
    );
  }
}

/** A wall lamp's flame, in world pixels. */
export interface PrisonWallLamp {
  readonly x: number;
  readonly y: number;
}

/** Everything about the prison's look that does not move. */
export class PrisonGround {
  private readonly paintGrid: TileContent[][];
  private chunks: TileChunkCache;
  private grime: CanvasSurface | null = null;
  private readonly strawTiles = new Map<number, CanvasSurface>();
  private readonly figures: ReadonlyArray<BakedFigure>;
  /** Every wall lamp's flame. The lighting cuts a small pool under each. */
  readonly lamps: ReadonlyArray<PrisonWallLamp>;
  private readonly lampTiles: ReadonlyArray<PrisonTile>;
  /** Kinds of cover, for the review render. */
  readonly coverKinds: ReadonlyArray<CoverKind>;

  constructor(private readonly parsed: ParsedPrisonLayout) {
    setDungeonFloorTheme('service_level');
    const { grid } = parsed;
    this.paintGrid = buildPaintGrid(grid);
    this.chunks = new TileChunkCache(this.paintGrid, TILE_SIZE);
    requestGroundSheets(PRISON_GROUND_SHEETS, () => this.invalidateArt());
    const blobs = findCoverBlobs(grid);
    this.coverKinds = blobs.map((blob) =>
      coverKindFor(blob.x1 - blob.x0 + 1, blob.y1 - blob.y0 + 1, blob.tiles),
    );
    this.figures = [...this.barFigures(), ...blobs.map((blob) => this.coverFigure(blob))];
    this.lampTiles = this.placeLamps();
    this.lamps = this.lampTiles.map((tile) => ({
      x: (tile.x + HALF) * TILE_SIZE,
      y: (tile.y + LAMP_FLAME_DROP_SHARE) * TILE_SIZE,
    }));
  }

  /** Drops the baked wall and floor chunks, for when a ground sheet finishes painting. */
  invalidateArt(): void {
    this.chunks = new TileChunkCache(this.paintGrid, TILE_SIZE);
  }

  private barFigures(): BakedFigure[] {
    const { grid } = this.parsed;
    const figures: BakedFigure[] = [];
    const rise = TILE_SIZE * BARS_RISE_SHARE;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (prisonTileAt(grid, x, y) !== PRISON_TILE.bars) continue;
        const run = barsRunAt(grid, x, y);
        figures.push(
          new BakedFigure(
            y * TILE_SIZE,
            x * TILE_SIZE,
            y * TILE_SIZE - rise,
            TILE_SIZE,
            TILE_SIZE + rise,
            (ctx) => paintIronBars(ctx, 0, rise, TILE_SIZE, run),
          ),
        );
      }
    }
    return figures;
  }

  private coverFigure(blob: CoverBlob): BakedFigure {
    const w = blob.x1 - blob.x0 + 1;
    const h = blob.y1 - blob.y0 + 1;
    const kind = coverKindFor(w, h, blob.tiles);
    const margin = TILE_SIZE;
    const rise = TILE_SIZE * COVER_RISE_SHARE + margin;
    return new BakedFigure(
      blob.y1 * TILE_SIZE,
      blob.x0 * TILE_SIZE - margin,
      blob.y0 * TILE_SIZE - rise,
      w * TILE_SIZE + margin * 2,
      h * TILE_SIZE + rise + margin,
      (ctx) => paintCover(ctx, margin, rise, w, h, TILE_SIZE, kind),
    );
  }

  /** Lamps on wall faces looking south onto open floor, spaced along each run. */
  private placeLamps(): ReadonlyArray<PrisonTile> {
    const { grid, anchors } = this.parsed;
    const anchorKeys = new Set([...anchors.values()].map((tile) => `${tile.x},${tile.y}`));
    const lamps: PrisonTile[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if ((x + y * LAMP_ROW_STAGGER) % LAMP_SPACING_TILES !== 0) continue;
        if (prisonTileAt(grid, x, y) !== PRISON_TILE.wall) continue;
        if (anchorKeys.has(`${x},${y}`)) continue;
        const below = prisonTileAt(grid, x, y + 1);
        if (below !== PRISON_TILE.floor) continue;
        lamps.push({ x, y });
      }
    }
    return lamps;
  }

  /** Bakes what a view at this camera would show now rather than on its first frame. */
  prewarm(camX: number, camY: number, viewW: number, viewH: number): void {
    this.grimeSurface();
    for (const figure of this.figures) {
      if (figure.overlaps(camX, camY, camX + viewW, camY + viewH)) figure.prewarm();
    }
  }

  private grimeSurface(): CanvasSurface {
    if (this.grime !== null) return this.grime;
    const { grid } = this.parsed;
    const canvas = allocCanvas(grid.width, grid.height);
    const ctx = surfaceContext(canvas);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (!isOpenTile(grid, x, y)) continue;
        const coarse = latticeHash(
          Math.floor(x / GRIME_COARSE_TILES),
          Math.floor(y / GRIME_COARSE_TILES),
          GRIME_COARSE_SALT,
        );
        const fine = latticeHash(x, y, GRIME_FINE_SALT);
        const amount = coarse * GRIME_COARSE_WEIGHT + fine * GRIME_FINE_WEIGHT;
        ctx.fillStyle = `rgba(${GRIME_RGB},${(amount * GRIME_MAX_ALPHA).toFixed(ALPHA_DIGITS)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    this.grime = canvas;
    return canvas;
  }

  /** One of the few straw tiles every cell floor is drawn from, baked on first use. */
  private strawTile(variant: number): CanvasSurface {
    const cached = this.strawTiles.get(variant);
    if (cached !== undefined) return cached;
    const canvas = allocCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = surfaceContext(canvas);
    const speck = TILE_SIZE * STRAW_SPECK_LENGTH_SHARE;
    ctx.fillStyle = `rgba(${STRAW_RGB},${STRAW_ALPHA})`;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = `rgba(${STRAW_SPECK_RGB},${STRAW_SPECK_ALPHA})`;
    ctx.lineWidth = 1;
    for (let index = 0; index < STRAW_SPECKS_PER_TILE; index++) {
      const sx = latticeHash(variant, index, SPECK_X_SALT) * TILE_SIZE;
      const sy = latticeHash(variant, index, SPECK_Y_SALT) * TILE_SIZE;
      const angle = latticeHash(variant, index, SPECK_ANGLE_SALT) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * speck, sy + Math.sin(angle) * speck);
      ctx.stroke();
    }
    this.strawTiles.set(variant, canvas);
    return canvas;
  }

  private renderStraw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    const { grid } = this.parsed;
    const x0 = Math.max(0, Math.floor(camX / TILE_SIZE));
    const y0 = Math.max(0, Math.floor(camY / TILE_SIZE));
    const x1 = Math.min(grid.width - 1, Math.floor((camX + viewW) / TILE_SIZE));
    const y1 = Math.min(grid.height - 1, Math.floor((camY + viewH) / TILE_SIZE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!isCellFloor(grid, x, y)) continue;
        const variant = Math.floor(latticeHash(x, y, STRAW_VARIANT_SALT) * STRAW_TILE_VARIANTS);
        ctx.drawImage(this.strawTile(variant), x * TILE_SIZE - camX, y * TILE_SIZE - camY);
      }
    }
  }

  /** The arrival screen's bake of the walls and floor a view will show; the fraction done. */
  bakeTileArtForView(
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    budgetMs: number,
    mustProgress: boolean,
  ): number {
    return this.chunks.bakeView(camX, camY, viewW, viewH, budgetMs, mustProgress);
  }

  /** The arrival screen's bake of the props a view will show: bars and cover, all at once. */
  bakeDecorationArtForView(camX: number, camY: number, viewW: number, viewH: number): number {
    this.prewarm(camX, camY, viewW, viewH);
    return ARRIVAL_BAKE_COMPLETE;
  }

  /** The walls, the slab, the grime, the straw, the lamps and the towers: everything under the bodies. */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): void {
    renderCanvas(ctx, this.paintGrid, TILE_SIZE, camX, camY, viewW, viewH, this.chunks);
    const { grid } = this.parsed;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // Only the tiles in view, plus a tile's margin so the smoothing at the
    // crop's edge samples real neighbours rather than the canvas border.
    const x0 = Math.max(0, Math.floor(camX / TILE_SIZE) - GRIME_CROP_MARGIN_TILES);
    const y0 = Math.max(0, Math.floor(camY / TILE_SIZE) - GRIME_CROP_MARGIN_TILES);
    const x1 = Math.min(
      grid.width,
      Math.ceil((camX + viewW) / TILE_SIZE) + GRIME_CROP_MARGIN_TILES,
    );
    const y1 = Math.min(
      grid.height,
      Math.ceil((camY + viewH) / TILE_SIZE) + GRIME_CROP_MARGIN_TILES,
    );
    if (x1 > x0 && y1 > y0) {
      ctx.drawImage(
        this.grimeSurface(),
        x0,
        y0,
        x1 - x0,
        y1 - y0,
        x0 * TILE_SIZE - camX,
        y0 * TILE_SIZE - camY,
        (x1 - x0) * TILE_SIZE,
        (y1 - y0) * TILE_SIZE,
      );
    }
    ctx.restore();
    this.renderStraw(ctx, camX, camY, viewW, viewH);
    const margin = TILE_SIZE;
    for (const tile of this.lampTiles) {
      const sx = tile.x * TILE_SIZE - camX;
      const sy = tile.y * TILE_SIZE - camY;
      if (sx < -margin || sy < -margin || sx > viewW || sy > viewH) continue;
      paintWallLamp(ctx, sx, sy, TILE_SIZE);
    }
    for (const anchor of this.parsed.anchors.values()) {
      const cx = (anchor.x + HALF) * TILE_SIZE - camX;
      const cy = (anchor.y + HALF) * TILE_SIZE - camY;
      if (cx < -margin || cy < -margin || cx > viewW + margin || cy > viewH + margin) continue;
      paintSpotlightTower(ctx, cx, cy);
    }
  }

  /** Bars and cover near the view, for the scene's sorted pass. */
  sortedFigures(camX: number, camY: number, viewW: number, viewH: number): InteriorFigure[] {
    const margin = PROP_VIEW_MARGIN_TILES * TILE_SIZE;
    return this.figures.filter((figure) =>
      figure.overlaps(camX - margin, camY - margin, camX + viewW + margin, camY + viewH + margin),
    );
  }
}

function paintSpotlightTower(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const radius = TILE_SIZE * TOWER_RADIUS_SHARE;
  ctx.save();
  ctx.fillStyle = TOWER_IRON;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TOWER_RIM;
  ctx.lineWidth = TOWER_RIM_WIDTH_PX;
  ctx.stroke();
  ctx.fillStyle = TOWER_LENS;
  ctx.beginPath();
  ctx.arc(cx, cy, TILE_SIZE * TOWER_LENS_SHARE, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
