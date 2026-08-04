/**
 * Draws one tile of generated ground, from whichever sheet the caller's
 * `GroundPalette` names — `ground_overworld` for the town, `ground_floor1` and
 * `ground_floor2` for the two dungeon floors, `ground_dungeon` for a safe room.
 *
 * Six passes, in this order:
 *
 *  1. **Base** — the material's frame for this tile (see `groundFrameIndex`).
 *  2. **Fringe** — where materials meet, the boundary between them is drawn
 *     through a shared corner mask on the dual grid, so it wanders across the
 *     tile edge instead of running along it.
 *  3. **Kerb** — where a made street meets soft ground, a raised stone lip along
 *     its own edge, so a street reads as a street and not as a strip of a
 *     different material.
 *  4. **Scatter** — a softer neighbour spills tufts or grit a few pixels across
 *     the joint, which is how grass takes back the gutter the fringe just paved.
 *  5. **World noise** — a low-frequency brightness field sampled in *world*
 *     space. Per-tile seamlessness does not fix large-scale repetition: without
 *     this, a field of perfectly-matching tiles still reads as blocks.
 *  6. **Ambient occlusion** — soft shading where ground meets a wall, building
 *     or ruin, so nothing looks pasted onto the lawn. A town building is one
 *     anchor tile on the grid, so this reads the sprite manifest's footprints
 *     rather than tile types alone — see `underSpriteArt`.
 *
 * Every pass runs at chunk-bake time (`TileChunkCache`), never per frame, and
 * every pass draws strictly inside the tile's own rect — which is what lets the
 * chunk-cached and direct render paths be compared pixel for pixel. Four caches
 * keep the bake cheap: masked material quarters, the weight stencils a stack of
 * three or more materials needs, the world-noise field, and the occlusion bands.
 */

import type { TileContent } from '../tileTypes';
import {
  BUILDING_WALL,
  FloorTypeValue,
  INTERIOR_COUNTER,
  INTERIOR_WALL,
  METAL_WALL,
  ARENA_CAGE,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  ROOF_CIRCUS_RED,
  ROOF_GREEN,
  ROOF_RED,
  ROOF_SLATE,
  ROOF_THATCH,
  MAIN_TOWER,
  RUINED_WALL,
  CLIFF,
  SPRITE_BUILDING,
  TOWN_WALL,
} from '../tileTypes';
import {
  getBlockedTileOffsets,
  getBlockedTileOffsetsByKey,
  getSpriteDef,
  type SpriteDef,
  type SpriteStateDef,
  type TileOffset,
} from '../../core/SpriteLoader';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { inferFloorType } from './helpers';
import type { GroundPalette } from '../ground/GroundPalette';
import {
  CORNER_NE,
  CORNER_NW,
  CORNER_SE,
  CORNER_SW,
  GROUND_MASK_SHEET_KEY,
  GROUND_MASK_STATE,
  groundFrameIndex,
  groundVariantCount,
} from '../ground/groundFrames';
import { positiveMod } from '../../utils';

export interface ResolvedMaterial {
  readonly def: SpriteDef;
  readonly state: SpriteStateDef;
  readonly frame: number;
}

/**
 * Materials inferred for tiles that stand on ground, memoised per palette per map.
 *
 * `inferFloorType` walks outward until it finds real floor, which is far too
 * much work to repeat for the sixteen corner lookups every tile's fringe does.
 * The tile type is stored alongside the result so a tile that changes type is
 * re-inferred rather than answered from a stale entry.
 *
 * Keyed by palette first because the same tile answers differently for each: a
 * safe-room floor is `bopca_tile` to the dungeon palette and nothing at all to
 * the overworld's.
 */
const inferredMaterials = new WeakMap<
  GroundPalette,
  WeakMap<TileContent[][], Map<number, InferredMaterial>>
>();

interface InferredMaterial {
  readonly type: number;
  readonly material: string | undefined;
}

function inferenceMemo(
  palette: GroundPalette,
  structure: TileContent[][],
): Map<number, InferredMaterial> {
  let perStructure = inferredMaterials.get(palette);
  if (perStructure === undefined) {
    perStructure = new WeakMap<TileContent[][], Map<number, InferredMaterial>>();
    inferredMaterials.set(palette, perStructure);
  }
  let memo = perStructure.get(structure);
  if (memo === undefined) {
    memo = new Map<number, InferredMaterial>();
    perStructure.set(structure, memo);
  }
  return memo;
}

/** The material at a map position, or undefined off-map or on non-ground tiles. */
function groundMaterialAt(
  palette: GroundPalette,
  structure: TileContent[][],
  tx: number,
  ty: number,
): string | undefined {
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return undefined;
  return palette.materialForTileType(row[tx].type);
}

/**
 * True when a tile can answer for its own ground — its type maps to a material,
 * or it recorded the surface a prop replaced — rather than having to have one
 * inferred from its neighbours.
 *
 * The distinction matters only to the fringe, and only for occluders. See
 * `materialAt` in `drawGroundTile`.
 */
function hasDeclaredGround(
  palette: GroundPalette,
  structure: TileContent[][],
  tx: number,
  ty: number,
): boolean {
  if (groundMaterialAt(palette, structure, tx, ty) !== undefined) return true;
  if (ty < 0 || ty >= structure.length) return false;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return false;
  return row[tx].groundType !== undefined;
}

/**
 * The material the ground at (tx, ty) is made of.
 *
 * Tiles that *are* ground answer directly. A tile that **recorded** the surface
 * it replaced answers from that. Only tiles that did neither — a torch, a well, a
 * fountain, a building anchor — are inferred from their surroundings, the same
 * way the decoration renderers pick the floor to draw beneath themselves. Without
 * that fallback every one of them is a hole: a hole in what gets drawn under the
 * decoration, and a hole in the fringe's field, which the neighbouring tiles then
 * disagree across.
 *
 * Inference is a last resort rather than the rule because it takes the first
 * cardinal neighbour it finds and that probe starts to the south, so anything on
 * the south edge of a region renders as whatever lies outside it.
 */
function groundMaterialUnder(
  palette: GroundPalette,
  structure: TileContent[][],
  tx: number,
  ty: number,
): string | undefined {
  const direct = groundMaterialAt(palette, structure, tx, ty);
  if (direct !== undefined) return direct;
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return undefined;

  const recorded = row[tx].groundType;
  if (recorded !== undefined) return palette.materialForTileType(recorded);

  const type = row[tx].type;
  const memo = inferenceMemo(palette, structure);
  const key = ty * row.length + tx;
  const cached = memo.get(key);
  if (cached?.type === type) return cached.material;

  const material = palette.materialForTileType(inferFloorType(structure, tx, ty));
  memo.set(key, { type, material });
  return material;
}

/**
 * A material as the fringe needs to see it: how hard it is, and how to resolve
 * its frame at a position.
 *
 * The indirection exists so the `?tiles` review route composites boundaries
 * through the same code the game does, over material rows the game does not use
 * (the dungeon sheet) and pairs the map never produces. A preview that
 * reimplemented the geometry would drift from the renderer, which is the one
 * thing a review route must not do.
 */
export interface FringeMaterial {
  /** Distinguishes materials within one sheet. */
  readonly id: string;
  /**
   * Sheet the material's row lives in. Part of every composite cache key: a
   * material name is only unique within its own sheet, so without this an
   * overworld `grass` quarter and a dungeon quarter of the same name would
   * collide in `overlayCache` and each would draw the other's pixels.
   */
  readonly sheetKey: string;
  /** Blend order — higher covers lower. */
  readonly order: number;
  resolve(tx: number, ty: number): ResolvedMaterial | undefined;
}

function resolveMaterial(
  palette: GroundPalette,
  material: string,
  tx: number,
  ty: number,
): ResolvedMaterial | undefined {
  const def = getSpriteDef(palette.sheetKey);
  if (def === undefined) return undefined;
  const state = def.states.get(material);
  if (state === undefined) return undefined;
  const patchTiles = state.patchTiles ?? 1;
  const frame = groundFrameIndex(patchTiles, groundVariantCount(state), tx, ty);
  // Every material ships a whole number of patches today, but a row with fewer
  // frames than one patch would send the phase term past the row's last frame
  // and blit a slice of the next material — or of nothing. Clamping keeps a
  // mis-sized row looking repetitive instead of corrupt.
  return { def, state, frame: Math.min(frame, state.frameCount - 1) };
}

function drawResolved(
  ctx: CanvasRenderingContext2D,
  resolved: ResolvedMaterial,
  sx: number,
  sy: number,
  ts: number,
): void {
  const { def, state, frame } = resolved;
  ctx.drawImage(
    def.img,
    frame * def.frameWidth,
    state.row * def.frameHeight,
    def.frameWidth,
    def.frameHeight,
    sx,
    sy,
    ts,
    ts,
  );
}

// ---------------------------------------------------------------------------
// Fringe — material boundaries through the shared corner masks
// ---------------------------------------------------------------------------

/**
 * The fringe is classified on the **dual grid**: its cells are offset half a
 * tile, so a cell's four corners are four whole tiles rather than four vertices
 * shared by twelve.
 *
 * Aligning the mask with the tile grid instead looks obvious and is wrong. A
 * vertex would have to take the hardest material of the four tiles touching it,
 * which sets both of a tile's east corners as soon as its east *neighbour* is
 * paved — putting the mask's half-coverage contour down the middle of that tile.
 * Measured that way: the last unpaved tile before a road rendered 37% paved, the
 * road drew ~0.4 tile wider than it is on both sides, any one-tile-wide softer
 * strip disappeared entirely (all four of its corners resolve to the harder
 * material, which the CORNER_ALL case then paints over it), and the scatter
 * pass — anchored to the tile edge — laid its tufts 15px inside the paving,
 * reading as a dashed lane marking rather than as grass at a kerb.
 *
 * On the dual grid every corner is one tile's own material, so the contour
 * between two differing tiles falls exactly on the edge between them and
 * neither side is dilated. One tile of a material is a corner of four dual
 * cells and survives.
 *
 * A tile is covered by one quadrant of each of the four dual cells around it,
 * so a tile draws four quarter-tile pieces. Two tiles sharing an edge take
 * their two touching quadrants from the *same* dual cell — same bits, same
 * mask, adjacent halves of one continuous field — so the joint cannot tear.
 */
interface DualCellQuadrant {
  /** Dual-cell index, relative to the tile's own coordinates. */
  readonly cellDX: number;
  readonly cellDY: number;
  /**
   * Which quarter of the mask frame this quadrant reads, as 0 = left/top and
   * 1 = right/bottom. It is the corner of the cell the tile itself occupies;
   * the quadrant of the *tile* it covers is the mirror of it.
   */
  readonly maskQuarterX: number;
  readonly maskQuarterY: number;
}

const DUAL_CELL_QUADRANTS: ReadonlyArray<DualCellQuadrant> = [
  { cellDX: 0, cellDY: 0, maskQuarterX: 1, maskQuarterY: 1 },
  { cellDX: 1, cellDY: 0, maskQuarterX: 0, maskQuarterY: 1 },
  { cellDX: 0, cellDY: 1, maskQuarterX: 1, maskQuarterY: 0 },
  { cellDX: 1, cellDY: 1, maskQuarterX: 0, maskQuarterY: 0 },
];

/** The four tiles at a dual cell's corners, relative to the cell's index. */
const DUAL_CELL_CORNERS = [
  { bit: CORNER_NW, dx: -1, dy: -1 },
  { bit: CORNER_NE, dx: 0, dy: -1 },
  { bit: CORNER_SE, dx: 0, dy: 0 },
  { bit: CORNER_SW, dx: -1, dy: 0 },
] as const;

/**
 * Least-recently-used surface cache with a hard entry cap.
 *
 * Both surface caches below are content-addressed, so neither can ever hold a
 * stale entry — but "bounded" is not the same as "small". The bound on masked
 * quarters is `material frames x mask frames x 4 quadrants`, which with the two
 * materials the overworld used before the street plan measured at 3,636 entries
 * (~3.6 MB) and across all seven works out at 176 x 144 x 4 = **101,376** (~97 MB
 * of pixel data, at roughly 1 KB a quarter). That is why this exists: the caches were fine until the town
 * actually started using its materials.
 *
 * Eviction is safe against a bake in flight because every caller draws the
 * surface it just fetched before asking for another one, so a surface dropped
 * from the map is still referenced by the caller that is using it.
 *
 * LRU rather than FIFO. A chunk bake reuses the same few frames for hundreds of
 * tiles, so FIFO on a full cache would evict exactly the entries about to be
 * asked for again. The cost is one `delete` plus one `set` per hit, against a
 * `drawImage` per miss.
 */
class SurfaceCache {
  private readonly entries = new Map<string, CanvasSurface>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): CanvasSurface | undefined {
    const surface = this.entries.get(key);
    if (surface === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, surface);
    return surface;
  }

  set(key: string, surface: CanvasSurface): void {
    this.entries.set(key, surface);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

/**
 * Caps chosen so a single chunk bake never evicts anything it still needs — a
 * 16x16 chunk touches at most 256 tiles x 4 quadrants x a handful of layers —
 * while holding the whole working set of a screenful of mixed materials.
 */
const OVERLAY_CACHE_MAX_ENTRIES = 12000;
const STENCIL_CACHE_MAX_ENTRIES = 4000;

/**
 * Masked material quarters, keyed by material, material frame, mask frame,
 * quadrant and tile size. The mask frame carries both the corner combination and
 * the position within the warp patch, so the key is the whole of what the surface
 * depends on.
 */
const overlayCache = new SurfaceCache(OVERLAY_CACHE_MAX_ENTRIES);

interface MaskSheet {
  readonly def: SpriteDef;
  readonly state: SpriteStateDef;
  /** Tiles across the patch the warp field wraps over. */
  readonly patchTiles: number;
}

function maskSheet(): MaskSheet | undefined {
  const def = getSpriteDef(GROUND_MASK_SHEET_KEY);
  if (def === undefined) return undefined;
  const state = def.states.get(GROUND_MASK_STATE);
  if (state === undefined) return undefined;
  return { def, state, patchTiles: state.patchTiles ?? 1 };
}

/**
 * The mask sheet's alpha, read once.
 *
 * Needed because a stack of three or more materials cannot be composited with
 * alpha blending alone — see `layerCoverage`. Undefined if the pixels cannot be
 * read at all, which leaves the two-material path, and therefore every map that
 * exists today, working exactly as before.
 */
let maskAlphaChannel: Uint8ClampedArray | undefined;
let maskAlphaChannelRead = false;

function maskAlpha(mask: MaskSheet): Uint8ClampedArray | undefined {
  if (maskAlphaChannelRead) return maskAlphaChannel;
  maskAlphaChannelRead = true;
  const surface = allocCanvas(mask.def.img.width, mask.def.img.height);
  const ctx = surfaceContext(surface);
  ctx.drawImage(mask.def.img, 0, 0);
  try {
    maskAlphaChannel = ctx.getImageData(0, 0, surface.width, surface.height).data;
  } catch {
    maskAlphaChannel = undefined;
  }
  return maskAlphaChannel;
}

/** Box-filtered coverage of one mask frame's quarter, at the drawn size, in 0..1. */
function sampleMaskQuarter(
  channel: Uint8ClampedArray,
  mask: MaskSheet,
  frame: number,
  quadrant: DualCellQuadrant,
  width: number,
  height: number,
): Float32Array {
  const sheetWidth = mask.def.img.width;
  const halfWidth = mask.def.frameWidth / 2;
  const halfHeight = mask.def.frameHeight / 2;
  const originX = frame * mask.def.frameWidth + quadrant.maskQuarterX * halfWidth;
  const originY = mask.state.row * mask.def.frameHeight + quadrant.maskQuarterY * halfHeight;

  const coverage = new Float32Array(width * height);
  const ALPHA_MAX = 255;
  // Block bounds are computed *within* the quarter and offset to the sheet once;
  // folding the origin into them makes the block run to the far side of the sheet.
  for (let y = 0; y < height; y++) {
    const blockY0 = Math.floor((y * halfHeight) / height);
    const blockY1 = Math.max(blockY0 + 1, Math.floor(((y + 1) * halfHeight) / height));
    for (let x = 0; x < width; x++) {
      const blockX0 = Math.floor((x * halfWidth) / width);
      const blockX1 = Math.max(blockX0 + 1, Math.floor(((x + 1) * halfWidth) / width));
      let total = 0;
      let samples = 0;
      for (let blockY = blockY0; blockY < blockY1; blockY++) {
        const rowStart = (originY + blockY) * sheetWidth + originX;
        for (let blockX = blockX0; blockX < blockX1; blockX++) {
          total += channel[(rowStart + blockX) * RGBA_CHANNELS + ALPHA_CHANNEL];
          samples++;
        }
      }
      coverage[y * width + x] = total / (samples * ALPHA_MAX);
    }
  }
  return coverage;
}

/**
 * How much of a quadrant one layer of a cell's stack actually shows.
 *
 * Painting each layer at its own mask coverage and letting the next one cover it
 * leaves layer `k` weighing `m_k * (1 - m_k+1)` where it should weigh
 * `m_k - m_k+1`. The two agree only where the masks are hard. They differ most at
 * half coverage — which is the middle of the blend, on the tile's own centre
 * line — and the difference is a *discontinuity*: two cells either side of that
 * line agree on `m_k == m_k+1` for a layer only one of them holds, so the
 * differenced weight vanishes there and the product weight does not. Measured at
 * 28 of 255 for lane meeting cobble meeting plaza.
 *
 * Returned as the alpha to paint the layer with, given everything above it has
 * yet to be painted: `(m_k - m_k+1) / (1 - m_k+1)`, which telescopes so that
 * painting the stack in order lands on the differenced weights exactly.
 *
 * `frames` is this layer's mask frame followed by every frame above it. The
 * running maximum is what makes the differences non-negative: the masks nest by
 * construction *except* across the diagonal combinations, whose separation bias
 * lifts a sub-mask above its superset by as much as 104 of 255.
 */
function layerCoverage(
  channel: Uint8ClampedArray,
  mask: MaskSheet,
  frames: ReadonlyArray<number>,
  quadrant: DualCellQuadrant,
  width: number,
  height: number,
): Float32Array {
  const sampled = frames.map((frame) =>
    sampleMaskQuarter(channel, mask, frame, quadrant, width, height),
  );
  for (let index = sampled.length - 2; index >= 0; index--) {
    for (let pixel = 0; pixel < sampled[index].length; pixel++) {
      sampled[index][pixel] = Math.max(sampled[index][pixel], sampled[index + 1][pixel]);
    }
  }

  const own = sampled[0];
  const alpha = new Float32Array(own.length);
  for (let pixel = 0; pixel < own.length; pixel++) {
    const above = sampled.length > 1 ? sampled[1][pixel] : 0;
    const remaining = 1 - above;
    alpha[pixel] = remaining <= 0 ? 0 : (own[pixel] - above) / remaining;
  }
  return alpha;
}

/**
 * The mask frame a dual cell reads: its corner combination, then its position
 * within the warp patch.
 *
 * Two tiles sharing an edge resolve the same cell, and so the same frame — for
 * every corner whose material both of them agree on. That is every corner except
 * one: an occluder with no ground of its own reports the material of *the tile
 * asking*, so where two floor tiles of different materials both touch such a
 * corner they compute different bits for it and read different frames.
 *
 * The mismatch is bounded rather than absent. The mask field is bilinear in the
 * four corner values (`scripts/tilegen/masks.ts`), so along the shared edge the
 * two fields differ by at most a quarter at the tile corner and decay to nothing
 * half a tile out — about half a cell's coverage of the harder material on one
 * side where the other draws none. Two places produce it: a dungeon doorway,
 * where a corridor of one material meets a room of another between two wall
 * jambs, and a safe room's threshold band, where `bopca_scuff` sits between
 * jambs with `bopca_tile` at its other corners. It was accepted because the
 * alternative — a wall reporting an inferred material — put a wedge of a floor
 * from an entirely different room along *every* wall on the level. See
 * `materialAt` in `drawGroundTile`.
 */
function maskFrameIndex(mask: MaskSheet, bits: number, cellX: number, cellY: number): number {
  const phases = mask.patchTiles * mask.patchTiles;
  const phase =
    positiveMod(cellY, mask.patchTiles) * mask.patchTiles + positiveMod(cellX, mask.patchTiles);
  return Math.min(bits * phases + phase, mask.state.frameCount - 1);
}

/**
 * One quarter-tile piece of overlay material, clipped to a quarter of a corner
 * mask and ready to blit.
 *
 * `destination-in` keeps only the pixels the mask's alpha covers, which is why
 * the generator stores the masks in alpha. The mask depends on the corner bits
 * and on the cell's position within the warp patch — never on anything private
 * to one tile — so two tiles either side of a joint read the same cell, perturb
 * it identically, and the edge cannot tear.
 */
function maskedOverlayQuarter(
  mask: MaskSheet,
  layer: FringeMaterial,
  resolved: ResolvedMaterial,
  maskFrame: number,
  quadrant: DualCellQuadrant,
  ts: number,
): CanvasSurface {
  const cacheKey = `${layer.sheetKey}|${layer.id}|${resolved.frame}|${maskFrame}|${quadrant.maskQuarterX}${quadrant.maskQuarterY}|${ts}`;
  const cached = overlayCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tileQuarterX = 1 - quadrant.maskQuarterX;
  const tileQuarterY = 1 - quadrant.maskQuarterY;
  const width = quarterExtent(ts, tileQuarterX);
  const height = quarterExtent(ts, tileQuarterY);

  const surface = allocCanvas(width, height);
  const surfaceCtx = surfaceContext(surface);

  const { def, state, frame } = resolved;
  const sourceHalfWidth = def.frameWidth / 2;
  const sourceHalfHeight = def.frameHeight / 2;
  surfaceCtx.drawImage(
    def.img,
    frame * def.frameWidth + tileQuarterX * sourceHalfWidth,
    state.row * def.frameHeight + tileQuarterY * sourceHalfHeight,
    sourceHalfWidth,
    sourceHalfHeight,
    0,
    0,
    width,
    height,
  );

  surfaceCtx.globalCompositeOperation = 'destination-in';
  const maskHalfWidth = mask.def.frameWidth / 2;
  const maskHalfHeight = mask.def.frameHeight / 2;
  surfaceCtx.drawImage(
    mask.def.img,
    maskFrame * mask.def.frameWidth + quadrant.maskQuarterX * maskHalfWidth,
    mask.state.row * mask.def.frameHeight + quadrant.maskQuarterY * maskHalfHeight,
    maskHalfWidth,
    maskHalfHeight,
    0,
    0,
    width,
    height,
  );

  overlayCache.set(cacheKey, surface);
  return surface;
}

/** Weight stencils, keyed by the mask stack, quadrant and tile size. */
const stencilCache = new SurfaceCache(STENCIL_CACHE_MAX_ENTRIES);

/**
 * The stencil a layer with others above it is painted through.
 *
 * Cached apart from the material, and keyed only by the masks: the weights depend
 * on the stack of coverages, never on which materials happen to be stacked. That
 * keeps this off the per-material-frame axis, which is the difference between a
 * few thousand of these and a few hundred thousand.
 */
function weightStencil(
  channel: Uint8ClampedArray,
  mask: MaskSheet,
  maskFrames: ReadonlyArray<number>,
  quadrant: DualCellQuadrant,
  width: number,
  height: number,
  ts: number,
): CanvasSurface {
  const cacheKey = `${maskFrames.join('.')}|${quadrant.maskQuarterX}${quadrant.maskQuarterY}|${ts}`;
  const cached = stencilCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const alpha = layerCoverage(channel, mask, maskFrames, quadrant, width, height);
  const stencil = allocCanvas(width, height);
  const stencilCtx = surfaceContext(stencil);
  const image = stencilCtx.createImageData(width, height);
  const ALPHA_MAX = 255;
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    image.data[pixel * RGBA_CHANNELS + ALPHA_CHANNEL] = Math.round(alpha[pixel] * ALPHA_MAX);
  }
  stencilCtx.putImageData(image, 0, 0);

  stencilCache.set(cacheKey, stencil);
  return stencil;
}

/** One reusable surface for layers that are weighed rather than plainly masked. */
let weighedQuarter: CanvasSurface | undefined;

function weighedQuarterSurface(width: number, height: number): CanvasSurface {
  const existing = weighedQuarter;
  if (existing?.width === width && existing.height === height) return existing;
  const surface = allocCanvas(width, height);
  weighedQuarter = surface;
  return surface;
}

/**
 * A layer that has others above it, painted at the weight that makes the stack
 * add up — see `layerCoverage`. Composed into a shared surface rather than a
 * cached one, because caching it would multiply the stencils by every material
 * frame that can sit under them.
 */
function weighedOverlayQuarter(
  channel: Uint8ClampedArray,
  mask: MaskSheet,
  resolved: ResolvedMaterial,
  maskFrames: ReadonlyArray<number>,
  quadrant: DualCellQuadrant,
  ts: number,
): CanvasSurface {
  const tileQuarterX = 1 - quadrant.maskQuarterX;
  const tileQuarterY = 1 - quadrant.maskQuarterY;
  const width = quarterExtent(ts, tileQuarterX);
  const height = quarterExtent(ts, tileQuarterY);

  const surface = weighedQuarterSurface(width, height);
  const surfaceCtx = surfaceContext(surface);
  const { def, state, frame } = resolved;
  surfaceCtx.globalCompositeOperation = 'copy';
  surfaceCtx.drawImage(
    def.img,
    frame * def.frameWidth + tileQuarterX * (def.frameWidth / 2),
    state.row * def.frameHeight + tileQuarterY * (def.frameHeight / 2),
    def.frameWidth / 2,
    def.frameHeight / 2,
    0,
    0,
    width,
    height,
  );
  surfaceCtx.globalCompositeOperation = 'destination-in';
  surfaceCtx.drawImage(weightStencil(channel, mask, maskFrames, quadrant, width, height, ts), 0, 0);
  surfaceCtx.globalCompositeOperation = 'source-over';
  return surface;
}

/** Splits a tile in two without losing a pixel to rounding at an odd tile size. */
function quarterExtent(ts: number, quarterIndex: number): number {
  const first = Math.round(ts / 2);
  return quarterIndex === 0 ? first : ts - first;
}

function quarterOrigin(ts: number, quarterIndex: number): number {
  return quarterIndex === 0 ? 0 : Math.round(ts / 2);
}

/** Draws one quarter of a material's frame, unmasked, into a tile quadrant. */
function drawMaterialQuarter(
  ctx: CanvasRenderingContext2D,
  resolved: ResolvedMaterial,
  quadrant: DualCellQuadrant,
  sx: number,
  sy: number,
  ts: number,
): void {
  const tileQuarterX = 1 - quadrant.maskQuarterX;
  const tileQuarterY = 1 - quadrant.maskQuarterY;
  const { def, state, frame } = resolved;
  ctx.drawImage(
    def.img,
    frame * def.frameWidth + tileQuarterX * (def.frameWidth / 2),
    state.row * def.frameHeight + tileQuarterY * (def.frameHeight / 2),
    def.frameWidth / 2,
    def.frameHeight / 2,
    sx + quarterOrigin(ts, tileQuarterX),
    sy + quarterOrigin(ts, tileQuarterY),
    quarterExtent(ts, tileQuarterX),
    quarterExtent(ts, tileQuarterY),
  );
}

/**
 * Paints one quadrant of the tile with the whole material stack of the dual cell
 * around it: the softest material the cell touches, then every harder one
 * composited through its own mask, in blend order.
 *
 * Painting the *stack* rather than only the materials harder than this tile's own
 * is what makes the boundary two-sided. The harder material bulging into the
 * softer tile and the softer one holding its ground in the harder tile are the
 * same contour seen from either side, so both tiles have to be able to draw
 * either material. It is also exact when three materials meet at one cell, which
 * an "overlay the harder ones" rule is not.
 *
 * The softest layer is skipped when it is already the tile's own material, since
 * the base pass has drawn it.
 */
function drawFringeQuadrant(
  ctx: CanvasRenderingContext2D,
  mask: MaskSheet,
  own: FringeMaterial,
  materialAt: (tx: number, ty: number) => FringeMaterial,
  quadrant: DualCellQuadrant,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const cellX = tx + quadrant.cellDX;
  const cellY = ty + quadrant.cellDY;

  const cornerMaterials: FringeMaterial[] = [];
  let differs = false;
  for (const corner of DUAL_CELL_CORNERS) {
    const cornerMaterial = materialAt(cellX + corner.dx, cellY + corner.dy);
    cornerMaterials.push(cornerMaterial);
    if (cornerMaterial.id !== own.id) differs = true;
  }
  if (!differs) return;

  const layers = [...new Set(cornerMaterials)].sort((a, b) => a.order - b.order);

  // Every masked layer's frame up front, so each can be weighed against the ones
  // above it. A layer's bits are never empty — it is at a corner of this cell by
  // definition, and that corner qualifies for it — and never all four either,
  // since the softest layer is at some corner too and is strictly softer. So no
  // layer ever covers a whole quadrant, which is what leaves a lone tile of a
  // softer material its middle however hard its surroundings are.
  const maskFrames = layers.slice(1).map((layer) => {
    let bits = 0;
    DUAL_CELL_CORNERS.forEach((corner, cornerIndex) => {
      if (cornerMaterials[cornerIndex].order >= layer.order) bits |= corner.bit;
    });
    return maskFrameIndex(mask, bits, cellX, cellY);
  });

  layers.forEach((layer, index) => {
    const resolved = layer.resolve(tx, ty);
    if (resolved === undefined) return;

    if (index === 0) {
      if (layer.id !== own.id) drawMaterialQuarter(ctx, resolved, quadrant, sx, sy, ts);
      return;
    }

    const stack = maskFrames.slice(index - 1);
    // Only a layer with something above it needs weighing; the topmost one's own
    // coverage is its weight, which the sheet can mask directly and cache.
    const channel = stack.length > 1 ? maskAlpha(mask) : undefined;
    const surface =
      channel === undefined
        ? maskedOverlayQuarter(mask, layer, resolved, stack[0], quadrant, ts)
        : weighedOverlayQuarter(channel, mask, resolved, stack, quadrant, ts);
    ctx.drawImage(
      surface,
      sx + quarterOrigin(ts, 1 - quadrant.maskQuarterX),
      sy + quarterOrigin(ts, 1 - quadrant.maskQuarterY),
    );
  });
}

/**
 * Draws the material boundaries running through one tile, over its already-drawn
 * base.
 *
 * `materialAt` must answer for **every** position, including ones that are not
 * ground at all. The tear-free argument runs through the material *orders* at the
 * two corners an edge is interpolated from: a layer only one of two cells holds
 * is always covered, along their shared edge, by a harder layer both hold. A
 * corner with no order at all breaks that, and every way of faking one after the
 * fact — softest, hardest, belongs-to-everything, skip the cell — lets one cell
 * draw something its neighbour cannot match, which is a full-alpha cut down the
 * middle of a tile. So the stand-in has to be chosen per position, by the caller.
 *
 * Choosing it the *same* for both askers is the stronger property, and it buys a
 * boundary that cannot differ at all. `drawGroundTile` gives one class of
 * position up — an occluder that would otherwise have its material inferred —
 * because the guess it replaces was worse; see `maskFrameIndex` for exactly how
 * much that costs and where. A caller that can answer position-independently
 * everywhere should.
 */
export function drawFringe(
  ctx: CanvasRenderingContext2D,
  own: FringeMaterial,
  materialAt: (tx: number, ty: number) => FringeMaterial,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // Checked once, before anything is drawn. A quadrant paints its softest layer
  // unmasked and composites the harder ones back on top, so bailing out part way
  // through would leave the softest material covering ground that should be
  // paved — half a tile of lawn over every road edge, baked into the chunk cache.
  const mask = maskSheet();
  if (mask === undefined) return;

  for (const quadrant of DUAL_CELL_QUADRANTS) {
    drawFringeQuadrant(ctx, mask, own, materialAt, quadrant, sx, sy, ts, tx, ty);
  }
}

// ---------------------------------------------------------------------------
// Scatter — softer material spilling across the joint
// ---------------------------------------------------------------------------

/** Cardinal neighbours, in the order their scatter is hashed. */
const CARDINAL_OFFSETS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const SCATTER_MARKS_PER_EDGE = 3;
/** How far from the shared edge a spill mark may land. */
const SCATTER_EDGE_DEPTH_PX = 7;
const SCATTER_BLADE_WIDTH_PX = 2;
const SCATTER_BLADE_HEIGHT_PX = 5;
const SCATTER_GRIT_RADIUS_PX = 1.2;
const SCATTER_HASH_X = 374761393;
const SCATTER_HASH_Y = 668265263;
const SCATTER_HASH_SLOT = 1274126177;
const SCATTER_HASH_SHIFT = 13;

function scatterHash(tx: number, ty: number, slot: number): number {
  let h = Math.imul(tx, SCATTER_HASH_X) ^ Math.imul(ty, SCATTER_HASH_Y);
  h = Math.imul(h ^ (h >>> SCATTER_HASH_SHIFT), SCATTER_HASH_SLOT + slot);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Keeps a mark's whole extent inside its own tile.
 *
 * A mark that overhangs its tile is drawn twice over: the chunk cache clips it at
 * the chunk's edge, and within a chunk the next tile's base pass paints over the
 * part that crossed into it — so the same tuft appears, is cut in half, or
 * vanishes depending on where the tile falls in the bake order.
 */
function clampMarkCentre(centre: number, origin: number, ts: number, extent: number): number {
  const half = extent / 2;
  return Math.min(Math.max(centre, origin + half), origin + ts - half);
}

function drawScatter(
  ctx: CanvasRenderingContext2D,
  palette: GroundPalette,
  structure: TileContent[][],
  material: string,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const ownOrder = palette.blendOrder[material];
  const depth = Math.min(SCATTER_EDGE_DEPTH_PX, ts);

  CARDINAL_OFFSETS.forEach(([dx, dy], side) => {
    const neighbour = groundMaterialUnder(palette, structure, tx + dx, ty + dy);
    if (neighbour === undefined) return;
    if (palette.blendOrder[neighbour] >= ownOrder) return;
    const spill = palette.spill[neighbour];
    if (spill === null) return;

    const isBlade = spill.kind === 'blades';
    const markWidth = isBlade ? SCATTER_BLADE_WIDTH_PX : SCATTER_GRIT_RADIUS_PX * 2;
    const markHeight = isBlade ? SCATTER_BLADE_HEIGHT_PX : SCATTER_GRIT_RADIUS_PX * 2;

    ctx.fillStyle = spill.color;
    for (let mark = 0; mark < SCATTER_MARKS_PER_EDGE; mark++) {
      const hash = scatterHash(tx, ty, side * SCATTER_MARKS_PER_EDGE + mark);
      const along = hash % ts;
      const into = (hash >>> 8) % depth;
      // The edge the neighbour lies across runs either horizontally (dy) or
      // vertically (dx); `into` measures inward from that edge.
      const rawX = dx === 0 ? sx + along : dx < 0 ? sx + into : sx + ts - into;
      const rawY = dy === 0 ? sy + along : dy < 0 ? sy + into : sy + ts - into;
      const markX = clampMarkCentre(rawX, sx, ts, markWidth);
      const markY = clampMarkCentre(rawY, sy, ts, markHeight);

      if (isBlade) {
        ctx.fillRect(
          markX - markWidth / 2,
          markY - markHeight / 2,
          SCATTER_BLADE_WIDTH_PX,
          SCATTER_BLADE_HEIGHT_PX,
        );
      } else {
        ctx.beginPath();
        ctx.arc(markX, markY, SCATTER_GRIT_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Kerbs — the lip that makes a street a street
// ---------------------------------------------------------------------------

/**
 * Depth of the kerbstone lip and of the joint line behind it.
 *
 * Both are drawn *inside* the street tile, against its own edge. That is a few
 * pixels off the fringe's wandering contour — which bleeds the harder material a
 * little way across the joint, so the visible boundary sits just outside this
 * edge and the lip lands on paving rather than in the gutter. Anchoring it to the
 * contour instead would mean sampling the mask per pixel; the scatter pass makes
 * the same trade for the same reason.
 */
const KERB_LIP_PX = 3;
const KERB_JOINT_PX = 2;
/**
 * Translucent rather than a stone colour, so one pair of values works on setts,
 * cobble and flagstone instead of three sampled colours that go stale the next
 * time the tileset is regenerated.
 */
const KERB_LIP_COLOR = 'rgba(232,226,210,0.26)';
const KERB_JOINT_COLOR = 'rgba(0,0,0,0.20)';

/**
 * A raised stone lip along every edge where a made street meets planted ground.
 *
 * A tile standing under a building's art is never kerbed against, and that has
 * to be asked of the sprite footprints rather than of the tile type: the ground
 * under a facade keeps whatever surface the plan painted there, which is usually
 * verge, so classifying by type alone laid **167 of the map's 388 kerb edges
 * along a building's base row** — a pale lip drawn against a wall, inside the
 * contact-shadow band the occlusion pass adds two passes later. The occluder test
 * already knows those tiles are solid; this asks the same question.
 */
function drawKerb(
  ctx: CanvasRenderingContext2D,
  palette: GroundPalette,
  structure: TileContent[][],
  material: string,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  if (!palette.kerbedMaterials.has(material)) return;
  const lip = Math.min(KERB_LIP_PX, ts);
  const joint = Math.min(KERB_JOINT_PX, ts - lip);

  const kerbs = (dx: number, dy: number) => {
    const neighbour = groundMaterialUnder(palette, structure, tx + dx, ty + dy);
    if (neighbour === undefined || !palette.kerbSoftMaterials.has(neighbour)) return false;
    return !occluderAt(structure, tx + dx, ty + dy);
  };
  const north = kerbs(0, -1);
  const south = kerbs(0, 1);
  const west = kerbs(-1, 0);
  const east = kerbs(1, 0);
  if (!north && !south && !west && !east) return;

  // Both layers are translucent, so a tile that kerbs two sides must not paint
  // their shared corner twice — it composites to a bright dot exactly where the
  // lip turns. The horizontal strips take the full width and the vertical ones
  // give way to them, which draws the union with no overlap and keeps every
  // stroke a plain `fillRect` that an instrumented render can count.
  const drawLayer = (color: string, depth: number, inset: number) => {
    ctx.fillStyle = color;
    if (north) ctx.fillRect(sx, sy + inset, ts, depth);
    if (south) ctx.fillRect(sx, sy + ts - inset - depth, ts, depth);
    const top = sy + (north ? inset + depth : 0);
    const bottom = sy + ts - (south ? inset + depth : 0);
    if (west) ctx.fillRect(sx + inset, top, depth, bottom - top);
    if (east) ctx.fillRect(sx + ts - inset - depth, top, depth, bottom - top);
  };

  drawLayer(KERB_LIP_COLOR, lip, 0);
  drawLayer(KERB_JOINT_COLOR, joint, lip);
}

// ---------------------------------------------------------------------------
// World-space brightness noise
// ---------------------------------------------------------------------------

/**
 * The tone is the sum of two fields whose periods share no factor, so the pattern
 * only repeats after their least common multiple — 864 tiles, which at 32px a tile
 * is fourteen screens across a 1920px window.
 *
 * One field cannot do that affordably. It is stored at one pixel per screen
 * pixel, because drawing a *sub-rectangle* of a smaller field scaled up would
 * clamp its filtering at the rectangle's edge and put a seam on every tile
 * boundary — so a longer period means a proportionally larger canvas, and a
 * single field long enough to clear a screen would cost more memory than the
 * whole tileset. Two fields buy a multiplied period for an added one.
 *
 * Each carries its own seed: at the same octave counts they would otherwise be
 * the same pattern at two scales, which correlates rather than decorrelates.
 */
interface ToneField {
  readonly periodTiles: number;
  readonly seed: number;
}

const TONE_FIELDS: ReadonlyArray<ToneField> = [
  { periodTiles: 32, seed: 0x2f6e2b1 },
  { periodTiles: 27, seed: 0x9c1b3a7 },
];

/** One sample per tile, plus a one-sample margin so the period wraps smoothly. */
const NOISE_MARGIN_SAMPLES = 1;
/**
 * Peak-to-peak darkening. The field is stored as black at a varying alpha and
 * blended with the default operator, which lands on `dest * (1 - alpha)` — the
 * same result a `multiply` by a grey would give, without leaving the compositor's
 * fast path. It measured as two thirds of the whole ground pass when it was a
 * `multiply`. Darkening-only is why the plan's ±6% is written here as 0–12%.
 */
const NOISE_DEPTH = 0.12;

/**
 * Depth of each field, so that the two darkening in series land on `NOISE_DEPTH`:
 * `(1 - d)^2 = 1 - NOISE_DEPTH`.
 */
const TONE_FIELD_DEPTH = 1 - Math.sqrt(1 - NOISE_DEPTH);

interface NoiseOctave {
  /** Lattice cells across a field's period, whatever that period is. */
  readonly cells: number;
  readonly weight: number;
}

const NOISE_OCTAVES: ReadonlyArray<NoiseOctave> = [
  { cells: 2, weight: 0.62 },
  { cells: 4, weight: 0.26 },
  { cells: 8, weight: 0.12 },
];

const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;

const LATTICE_HASH_X = 2654435761;
const LATTICE_HASH_Y = 1597334677;
const LATTICE_HASH_MIX = 2246822519;
/** Breaks the hash's fixed point at the origin — see `latticeValue`. */
const LATTICE_HASH_OFFSET = 0x9e3779b9;
const UINT32_SCALE = 4294967296;

/**
 * Hashed lattice value in 0..1.
 *
 * The offset is load-bearing. Without it the hash maps (0, 0) to 0 and stays
 * there through every mix, and index 0 is a node of *every* octave — so the
 * field's minimum was pinned to tile (0, 0) and to each 32-tile multiple of it
 * rather than falling wherever the noise put it.
 */
function latticeValue(ix: number, iy: number, cells: number, seed: number): number {
  const x = positiveMod(ix, cells);
  const y = positiveMod(iy, cells);
  let h =
    (Math.imul(x, LATTICE_HASH_X) ^ Math.imul(y, LATTICE_HASH_Y)) + LATTICE_HASH_OFFSET + seed;
  h = Math.imul(h ^ (h >>> 15), LATTICE_HASH_MIX);
  return ((h ^ (h >>> 16)) >>> 0) / UINT32_SCALE;
}

function smoothFade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Wrapped value noise at a tile position, in 0..1. */
function noiseAtTile(field: ToneField, tileX: number, tileY: number): number {
  let total = 0;
  for (const octave of NOISE_OCTAVES) {
    const u = (tileX * octave.cells) / field.periodTiles;
    const v = (tileY * octave.cells) / field.periodTiles;
    const cellX = Math.floor(u);
    const cellY = Math.floor(v);
    const fx = smoothFade(u - cellX);
    const fy = smoothFade(v - cellY);
    const top =
      latticeValue(cellX, cellY, octave.cells, field.seed) * (1 - fx) +
      latticeValue(cellX + 1, cellY, octave.cells, field.seed) * fx;
    const bottom =
      latticeValue(cellX, cellY + 1, octave.cells, field.seed) * (1 - fx) +
      latticeValue(cellX + 1, cellY + 1, octave.cells, field.seed) * fx;
    total += octave.weight * (top * (1 - fy) + bottom * fy);
  }
  return total;
}

const noiseFields = new Map<string, CanvasSurface>();

/**
 * Builds the world-space brightness field at one tile size.
 *
 * The samples are one per tile and are upscaled by the canvas rather than
 * evaluated per pixel, which is why the margin matters: a scaled `drawImage`
 * puts texel *centres* half a texel inside the destination, so the field is
 * drawn one texel oversized and offset until sample k lands exactly on tile
 * corner k. Sample −1 wraps to period−1, so the field is continuous where it
 * repeats as well as within itself.
 */
function buildNoiseField(field: ToneField, cell: number): CanvasSurface {
  const span = field.periodTiles + NOISE_MARGIN_SAMPLES * 2;
  const samples = allocCanvas(span, span);
  const samplesCtx = surfaceContext(samples);
  const image = samplesCtx.createImageData(span, span);
  const ALPHA_MAX = 255;

  // Sampled first, then stretched to the range the depth is quoted against.
  // A weighted sum of hashed octaves does not reach 0 and 1 on its own — the
  // coarsest one has four lattice nodes for the whole period and can only span
  // whatever those four happen to be — so the field measured 0.00..0.51, which
  // is half the intended contrast plus a flat darkening of everything outdoors.
  // Normalising makes the stated amplitude true by construction rather than by
  // luck, in the way the mask warp's centring does for its boundary.
  const levels = new Float32Array(span * span);
  let lowest = Infinity;
  let highest = -Infinity;
  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const level = noiseAtTile(field, i - NOISE_MARGIN_SAMPLES, j - NOISE_MARGIN_SAMPLES);
      levels[j * span + i] = level;
      lowest = Math.min(lowest, level);
      highest = Math.max(highest, level);
    }
  }
  const spread = highest - lowest;

  for (let j = 0; j < span; j++) {
    for (let i = 0; i < span; i++) {
      const index = j * span + i;
      const level = spread <= 0 ? 1 : (levels[index] - lowest) / spread;
      image.data[index * RGBA_CHANNELS + ALPHA_CHANNEL] = Math.round(
        ALPHA_MAX * TONE_FIELD_DEPTH * (1 - level),
      );
    }
  }
  samplesCtx.putImageData(image, 0, 0);

  const surface = allocCanvas(field.periodTiles * cell, field.periodTiles * cell);
  const surfaceCtx = surfaceContext(surface);
  surfaceCtx.imageSmoothingEnabled = true;
  surfaceCtx.imageSmoothingQuality = 'high';
  const originOffset = -(NOISE_MARGIN_SAMPLES + 0.5) * cell;
  surfaceCtx.drawImage(samples, originOffset, originOffset, span * cell, span * cell);
  return surface;
}

function noiseField(field: ToneField, cell: number): CanvasSurface {
  // Seeded as well as sized: two fields of the same period differing only by seed
  // would otherwise share one surface.
  const cacheKey = `${field.periodTiles}|${field.seed}|${cell}`;
  const existing = noiseFields.get(cacheKey);
  if (existing !== undefined) return existing;
  const built = buildNoiseField(field, cell);
  noiseFields.set(cacheKey, built);
  return built;
}

function applyWorldNoise(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const cell = Math.max(1, Math.round(ts));
  for (const field of TONE_FIELDS) {
    const surface = noiseField(field, cell);
    const period = field.periodTiles * cell;
    const srcX = positiveMod(tx * cell, period);
    const srcY = positiveMod(ty * cell, period);
    ctx.drawImage(surface, srcX, srcY, cell, cell, sx, sy, ts, ts);
  }
}

// ---------------------------------------------------------------------------
// Ambient occlusion
// ---------------------------------------------------------------------------

/**
 * What shades the ground beside it.
 *
 * Architectural solids only. `TREE` casts the dungeon's wall shadow but is
 * deliberately absent here: a tree is one tile standing on its own, so it gets a
 * band with two ends and nothing to continue them, and at forest densities the
 * result is a field of hard-edged dark rectangles — the exact artifact
 * `SHADOW_TYPES` already excludes round furniture to avoid. Trees carry their
 * shade in their own art.
 */
const GROUND_OCCLUDER_TYPES = new Set<number>([
  FloorTypeValue.wall,
  INTERIOR_WALL,
  INTERIOR_COUNTER,
  BUILDING_WALL,
  METAL_WALL,
  ARENA_CAGE,
  RUINED_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  TOWN_WALL,
  // A ledge shades the ground at its foot. It is the one wilderness solid that
  // belongs here: the boulders are rounded and carry their own contact shadow in
  // their art, and a rectangular occlusion band under one would show as a grey
  // strip poking out from beneath it.
  CLIFF,
]);

/**
 * Shading depth and strength per side. The north strip is the deepest because a
 * facade stands between the ground below it and the sky; the south strip is
 * barely there, since ground below a structure is only clipped by its base.
 */
const OCCLUSION_NORTH_DEPTH_PX = 11;
const OCCLUSION_SIDE_DEPTH_PX = 7;
const OCCLUSION_SOUTH_DEPTH_PX = 4;
const OCCLUSION_NORTH_ALPHA = 0.38;
const OCCLUSION_SIDE_ALPHA = 0.22;
const OCCLUSION_SOUTH_ALPHA = 0.14;

/** How far a band fades in at an end that no neighbouring band continues. */
const OCCLUSION_TAPER_PX = 11;

interface OcclusionSide {
  /** Direction from the shaded tile to the occluder. */
  readonly dx: number;
  readonly dy: number;
  readonly depthPx: number;
  readonly alpha: number;
}

const OCCLUSION_SIDES: ReadonlyArray<OcclusionSide> = [
  { dx: 0, dy: -1, depthPx: OCCLUSION_NORTH_DEPTH_PX, alpha: OCCLUSION_NORTH_ALPHA },
  { dx: -1, dy: 0, depthPx: OCCLUSION_SIDE_DEPTH_PX, alpha: OCCLUSION_SIDE_ALPHA },
  { dx: 1, dy: 0, depthPx: OCCLUSION_SIDE_DEPTH_PX, alpha: OCCLUSION_SIDE_ALPHA },
  { dx: 0, dy: 1, depthPx: OCCLUSION_SOUTH_DEPTH_PX, alpha: OCCLUSION_SOUTH_ALPHA },
];

/**
 * Tiles standing under a map sprite's art, memoised per map.
 *
 * **The tile types are not enough to find a town building.** A sprite building is
 * one anchor tile carrying a manifest key, and every other tile under its facade
 * keeps whatever surface the plan painted there — so every one of the town's
 * fifteen buildings and its tower was invisible to the occluder test, and the
 * ground in front of a facade was shaded by nothing at all. That is what made the
 * buildings read as stickers on the lawn: a wall casts a contact shadow and these
 * cast none.
 *
 * The doorway is deliberately left out (`getBlockedTileOffsetsByKey` is the
 * footprint *minus* the opening), so a threshold takes the north band from the
 * facade above it rather than being treated as facade itself.
 *
 * Built once per map and not revalidated. That is a real assumption, stated
 * rather than hidden: a map's building anchors are written by the generator and
 * never afterwards, and the only honest alternative — rescanning to check — costs
 * a whole-map sweep on a function the occlusion pass calls five times a tile.
 * `GameMap` makes the same assumption for `extraBlockedTiles`, which it rebuilds
 * only when the structure is replaced.
 */
const spriteFootprintTiles = new WeakMap<TileContent[][], ReadonlySet<number>>();

/**
 * Positions are packed as `y * width + x`, which only distinguishes them while
 * `x` stays inside the row. An offset that reaches past either end would wrap
 * onto the neighbouring row and mark a tile somewhere else on the map as being
 * under a building — a phantom contact shadow with nothing casting it. Not
 * reachable on today's maps (the index spans x 113…167 on a 280-wide grid), but
 * the offsets come from sprite manifests and this is a shared renderer.
 */
function buildFootprintIndex(structure: TileContent[][]): ReadonlySet<number> {
  const covered = new Set<number>();
  const height = structure.length;
  const width = structure[0]?.length ?? 0;
  for (let ty = 0; ty < height; ty++) {
    const row = structure[ty];
    for (let tx = 0; tx < row.length; tx++) {
      const tile = row[tx];
      let offsets: ReadonlyArray<TileOffset> | undefined;
      if (tile.type === SPRITE_BUILDING && tile.spriteKey !== undefined) {
        offsets = getBlockedTileOffsetsByKey(tile.spriteKey);
      } else if (tile.type === MAIN_TOWER) {
        offsets = getBlockedTileOffsets(MAIN_TOWER);
      }
      if (offsets === undefined) continue;
      for (const offset of offsets) {
        const coveredX = tx + offset.dx;
        const coveredY = ty + offset.dy;
        if (coveredX < 0 || coveredX >= width || coveredY < 0 || coveredY >= height) continue;
        covered.add(coveredY * width + coveredX);
      }
    }
  }
  return covered;
}

/**
 * True when (tx, ty) lies inside a building's declared footprint.
 *
 * Built from `getBlockedTileOffsets*`, which is the manifest footprint minus the
 * doorway — and the footprint is the sprite's whole *frame*, so this includes
 * the transparent sky above a roof and any transparent columns beside it. Good
 * enough for the occlusion pass, which only needs to know that the ground here
 * is under a structure rather than beside one; **not** an opacity test — reusing
 * it as one for the fence renderer anchored three rails into pixels under 2%
 * opaque.
 */
function underSpriteArt(structure: TileContent[][], tx: number, ty: number): boolean {
  let covered = spriteFootprintTiles.get(structure);
  if (covered === undefined) {
    covered = buildFootprintIndex(structure);
    spriteFootprintTiles.set(structure, covered);
  }
  return covered.has(ty * (structure[0]?.length ?? 0) + tx);
}

function occluderAt(structure: TileContent[][], tx: number, ty: number): boolean {
  if (ty < 0 || ty >= structure.length) return false;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return false;
  if (GROUND_OCCLUDER_TYPES.has(row[tx].type)) return true;
  return underSpriteArt(structure, tx, ty);
}

/** Pre-rendered occlusion bands, keyed by side, which ends taper, and tile size. */
const occlusionBands = new Map<string, CanvasSurface>();

/**
 * One occlusion band: dark against the occluder, fading away from it, and fading
 * out along its length at either end that no neighbouring tile continues.
 *
 * The taper is why this is a cached image rather than a `fillRect` with a
 * gradient. A band needs to fade on two axes at once, which one gradient cannot
 * do — but on its own surface the second axis is just a `destination-out` pass,
 * and there are only sixteen distinct bands per tile size.
 */
function occlusionBand(
  side: OcclusionSide,
  taperLow: boolean,
  taperHigh: boolean,
  ts: number,
): CanvasSurface {
  const cacheKey = `${side.dx},${side.dy}|${taperLow ? 1 : 0}${taperHigh ? 1 : 0}|${ts}`;
  const cached = occlusionBands.get(cacheKey);
  if (cached !== undefined) return cached;

  const runsHorizontally = side.dy !== 0;
  const depth = Math.min(side.depthPx, ts);
  const width = runsHorizontally ? ts : depth;
  const height = runsHorizontally ? depth : ts;

  const surface = allocCanvas(width, height);
  const bandCtx = surfaceContext(surface);

  // Dark at the occluder's edge, transparent at the far edge of the band.
  const towardsOccluder = side.dx + side.dy < 0;
  const shade = bandCtx.createLinearGradient(
    runsHorizontally ? 0 : towardsOccluder ? 0 : width,
    runsHorizontally ? (towardsOccluder ? 0 : height) : 0,
    runsHorizontally ? 0 : towardsOccluder ? width : 0,
    runsHorizontally ? (towardsOccluder ? height : 0) : 0,
  );
  shade.addColorStop(0, `rgba(0,0,0,${side.alpha})`);
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  bandCtx.fillStyle = shade;
  bandCtx.fillRect(0, 0, width, height);

  const along = runsHorizontally ? width : height;
  const taper = Math.min(OCCLUSION_TAPER_PX, along);
  bandCtx.globalCompositeOperation = 'destination-out';
  for (const atLow of [true, false]) {
    if (atLow ? !taperLow : !taperHigh) continue;
    const from = atLow ? 0 : along;
    const to = atLow ? taper : along - taper;
    const erase = bandCtx.createLinearGradient(
      runsHorizontally ? from : 0,
      runsHorizontally ? 0 : from,
      runsHorizontally ? to : 0,
      runsHorizontally ? 0 : to,
    );
    erase.addColorStop(0, 'rgba(0,0,0,1)');
    erase.addColorStop(1, 'rgba(0,0,0,0)');
    bandCtx.fillStyle = erase;
    bandCtx.fillRect(
      runsHorizontally ? Math.min(from, to) : 0,
      runsHorizontally ? 0 : Math.min(from, to),
      runsHorizontally ? taper : width,
      runsHorizontally ? height : taper,
    );
  }

  occlusionBands.set(cacheKey, surface);
  return surface;
}

/** Soft shading where ground meets a wall, building or ruin. */
function drawOcclusion(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // A solid's own ground is *under* the structure, not beside it. Shading it
  // from its neighbours draws a lattice of bands across a building's footprint,
  // one per tile, which is only invisible for as long as its art is opaque.
  if (occluderAt(structure, tx, ty)) return;

  for (const side of OCCLUSION_SIDES) {
    if (!occluderAt(structure, tx + side.dx, ty + side.dy)) continue;

    // The band runs along the axis the occluder is not on; it needs a taper at
    // either end where the next tile along has no occluder to continue it.
    const alongDX = side.dy === 0 ? 0 : 1;
    const alongDY = side.dy === 0 ? 1 : 0;
    const continuesLow = occluderAt(structure, tx + side.dx - alongDX, ty + side.dy - alongDY);
    const continuesHigh = occluderAt(structure, tx + side.dx + alongDX, ty + side.dy + alongDY);

    const band = occlusionBand(side, !continuesLow, !continuesHigh, ts);
    const depth = Math.min(side.depthPx, ts);
    ctx.drawImage(band, sx + (side.dx > 0 ? ts - depth : 0), sy + (side.dy > 0 ? ts - depth : 0));
  }
}

// ---------------------------------------------------------------------------

/**
 * The `FringeMaterial` view of each of a palette's materials, built once per
 * palette. Identity matters — the fringe de-duplicates a cell's corner materials
 * by reference — so these are shared, not rebuilt per tile.
 */
const fringeMaterials = new WeakMap<GroundPalette, Map<string, FringeMaterial>>();

function fringeMaterial(palette: GroundPalette, material: string): FringeMaterial {
  let byMaterial = fringeMaterials.get(palette);
  if (byMaterial === undefined) {
    byMaterial = new Map<string, FringeMaterial>();
    fringeMaterials.set(palette, byMaterial);
  }
  const existing = byMaterial.get(material);
  if (existing !== undefined) return existing;

  const built: FringeMaterial = {
    id: material,
    sheetKey: palette.sheetKey,
    order: palette.blendOrder[material],
    resolve: (tx, ty) => resolveMaterial(palette, material, tx, ty),
  };
  byMaterial.set(material, built);
  return built;
}

/**
 * Draws one named material at (tx, ty) and nothing else — the base pass and the
 * world-space tone layer, with no fringe, kerb, scatter or occlusion.
 *
 * For surfaces that are *not* ground and so have no neighbours to blend into: a
 * dungeon wall is the only one today. The tone layer still applies, or a wall
 * would sit at a flat brightness in a room whose floor is being modulated around
 * it and would read as pasted on.
 */
export function drawGroundMaterialTile(
  ctx: CanvasRenderingContext2D,
  palette: GroundPalette,
  material: string,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const resolved = resolveMaterial(palette, material, tx, ty);
  if (resolved === undefined) {
    ctx.fillStyle = palette.fallbackColor[material];
    ctx.fillRect(sx, sy, ts, ts);
  } else {
    drawResolved(ctx, resolved, sx, sy, ts);
  }
  applyWorldNoise(ctx, sx, sy, ts, tx, ty);
}

/**
 * Draws the ground at (tx, ty), blended into its neighbours.
 *
 * The material comes from the tile itself rather than from the caller: it is the
 * same lookup the fringe uses for every neighbouring tile, and a caller that
 * disagreed with it would silently break the "softest layer is already drawn"
 * shortcut. Callers that paint their own detail on top (weed tufts, dirt
 * blotches, ruin stones) call this first for the surface underneath them.
 */
export function drawGroundTile(
  ctx: CanvasRenderingContext2D,
  palette: GroundPalette,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const material = groundMaterialUnder(palette, structure, tx, ty);
  if (material === undefined) return;

  const resolved = resolveMaterial(palette, material, tx, ty);
  if (resolved === undefined) {
    // The fallback colours are each material's mean *in the sheet*, and the tone
    // layer darkens what is drawn from that sheet — so it applies here too, or
    // the stand-in sits brighter than the thing it stands in for.
    ctx.fillStyle = palette.fallbackColor[material];
    ctx.fillRect(sx, sy, ts, ts);
    applyWorldNoise(ctx, sx, sy, ts, tx, ty);
    return;
  }

  // A tile that has no ground of its own and has to have one *inferred* must not
  // impose that guess on its neighbours' fringes.
  //
  // `inferFloorType` takes the first cardinal neighbour it finds and probes
  // **south first**, so a dungeon wall reports whatever is on its south side.
  // Where that differs from the tile being drawn — which on a dungeon floor is
  // the normal case, since `ZONE_FLOORS` gives neighbouring rooms different
  // surfaces — the corner masks composite the south room's floor into the north
  // room's wall corners, and oak boarding appears to seep out from under a stone
  // wall into a room with no boards in it. Rendered with two rooms either side of
  // a one-tile wall, it is unmistakable.
  //
  // So such a tile reports the material of the tile being drawn: the floor runs
  // under the wall rather than meeting something else there.
  //
  // **Only when the material would be inferred.** The first cut keyed this on
  // `occluderAt` alone, which also covers every tile inside a town building
  // sprite's frame — 735 of them on the real map, 716 of which carry a perfectly
  // good material of their own and 321 of which abut a different one. Those were
  // blending correctly, and substituting removed a material that appears at no
  // other corner, so the neighbour drew a hard tile-aligned edge where the
  // footprint tile drew a full blend. A tile that knows its own ground keeps it.
  //
  // This makes the answer depend on the asker, which the fringe otherwise avoids:
  // see the note on `maskFrameIndex` for the invariant it relaxes and where the
  // residual mismatch shows up.
  const materialAt = (atX: number, atY: number): FringeMaterial => {
    if (occluderAt(structure, atX, atY) && !hasDeclaredGround(palette, structure, atX, atY)) {
      return fringeMaterial(palette, material);
    }
    return fringeMaterial(
      palette,
      groundMaterialUnder(palette, structure, atX, atY) ?? palette.fringeStandIn,
    );
  };

  drawResolved(ctx, resolved, sx, sy, ts);
  drawFringe(ctx, fringeMaterial(palette, material), materialAt, sx, sy, ts, tx, ty);
  // Before the scatter, so tufts from the soft side spill over the kerb rather
  // than being buried by it — which is what grass at a kerb actually does.
  drawKerb(ctx, palette, structure, material, sx, sy, ts, tx, ty);
  drawScatter(ctx, palette, structure, material, sx, sy, ts, tx, ty);
  applyWorldNoise(ctx, sx, sy, ts, tx, ty);
  drawOcclusion(ctx, structure, sx, sy, ts, tx, ty);
}
