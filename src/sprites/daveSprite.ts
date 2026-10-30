/**
 * Dave in the world: his look in his own clothes on the human rig, standing,
 * walking and talking with the rig's bare-handed rows, and the world
 * re-rendering him as he teleports in and out.
 *
 * The teleport itself is `teleportEffect.ts`. The figure-shaped pictures it
 * needs of him — his standing cell, that cell in the light's colour, and the
 * ring round its edge — are cells of the shared figure cache, so drawing him
 * mid-teleport allocates nothing and stores no frames of its own.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { allocCanvas, releaseSurface, surfaceContext } from '../core/rendering/canvasSurface';
import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { humanFigureFor } from './art/human/appearance';
import { WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { HUMAN_ROW_TABLE, type HumanRowName, ORIGIN_Y, type ViewRows } from './art/humanFigure';
import type { CardinalView } from './facingView';
import { selectCardinalFacing } from './facingView';
import {
  type DrawnFigureRow,
  drawnFigureRow,
  type FigureDef,
  figureStates,
} from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { ResidentRows, type ResidentSpan } from './figure/residentRows';
import { defaultOutfitOf } from './garments/human/humanDressing';
import {
  drawHumanFigureSelection,
  rowFrameAtTicks,
  rowLengthInTicks,
  viewRow,
} from './humanSprite';
import { DAVE_LOOK } from './looks/humans/dave';
import {
  drawTeleport,
  paintTeleportEdgeRing,
  type TeleportDraw,
  type TeleportFigure,
  type TeleportLayer,
  washInTeleportLight,
} from './teleportEffect';

// ── His figure and rows ──────────────────────────────────────────────────────

/** His figure: the rig in his look and his own clothes, holding nothing. */
const DAVE_FIGURE = humanFigureFor(DAVE_LOOK, defaultOutfitOf(DAVE_LOOK), null);

type DaveRow = 'idle' | 'walk' | 'talk';

/** The rig's bare-handed rows he plays, per view. */
export const DAVE_ROWS: Readonly<Record<DaveRow, ViewRows>> = {
  idle: { front: 'idle', side: 'idle_side', back: 'idle_away' },
  walk: { front: 'walk', side: 'walk_side', back: 'walk_away' },
  talk: { front: 'talk', side: 'talk_side', back: 'talk_away' },
};

export const DRAWN_ROWS: readonly DaveRow[] = ['idle', 'walk', 'talk'];
const DRAWN_VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];

/**
 * Every row he can be drawn in, held warm for as long as he is drawn: he
 * turns a quarter or a half turn in a tick when he sets off or is spoken to
 * from behind, and a view he had not faced for the release window would
 * otherwise bake on the render path.
 */
const RESIDENT_SPANS: readonly ResidentSpan[] = [
  ...new Set(DRAWN_ROWS.flatMap((row) => DRAWN_VIEWS.map((view) => DAVE_ROWS[row][view]))),
].map((row) => ({ row, frames: HUMAN_ROW_TABLE[row].frameCount }));
const RESIDENT_ROWS = new ResidentRows(RESIDENT_SPANS);

/**
 * Ground one walk cycle covers, in tiles. His figure is the rig drawn at his
 * height, and its stride runs across the profile at the rig's own depth
 * whatever his height, so the cycle covers the rig's own ground.
 */
export const DAVE_TILES_PER_WALK_CYCLE = WALK_GROUND_PER_CYCLE_PX / TILE_SIZE;

// ── Overhead clearance ───────────────────────────────────────────────────────

/**
 * How far the top of his hair stands above his tile's top edge, in tiles:
 * his look's own measure, which gate G21 re-measures off his standing cells.
 */
const DAVE_HEAD_LIFT_TILES = DAVE_LOOK.figureExtent.spriteTopAboveTilePx / TILE_SIZE;

/** The top of his art over the tile whose top edge is at `sy`, before a drawn row has been measured. */
export function daveHeadTop(sy: number, tileSize: number): number {
  return sy - DAVE_HEAD_LIFT_TILES * tileSize;
}

/** Everything his sprite needs to pick a picture. */
export interface DaveSpriteState {
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  readonly isTalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /** The last left or right he faced, never 0: which way the profile is mirrored when he stands still. */
  readonly lastHorizontalFacing: number;
  /** Offset into the clock-driven loops, so his breathing is not in step with anyone else's. */
  readonly idleOffsetSeconds: number;
  /** The teleport under way, or null when he is drawn solid. */
  readonly teleport: TeleportDraw | null;
}

// ── The teleport's figure-shaped layers ──────────────────────────────────────

/** He stands still, head-on, while the world builds him or takes him apart. */
const STILL_ROW: HumanRowName = DAVE_ROWS.idle.front;
/** The light-coloured slices and the edge ring are cut from one standing frame: they flicker for a few frames each, and a breath under them is invisible. */
const STILL_FRAME = 0;

/** The edge ring's width, in cell pixels: one screen pixel at the 32 px tile on the rig's 64 px tile scale. */
const EDGE_RING_CELL_PX = 2;

type LightLayer = Exclude<TeleportLayer, 'solid'>;
const ONE_FRAME = 1;
const LIGHT_LAYER_FRAMES: Readonly<Record<LightLayer, number>> = {
  glitch: ONE_FRAME,
  edge: ONE_FRAME,
};

/** Paints his still frame onto a fresh surface at `density`, for one of the light layers to be cut from. */
function paintStillFrame(density: number, width: number, height: number) {
  const surface = allocCanvas('figureScratch', width, height);
  const ctx = surfaceContext(surface);
  ctx.setTransform(density, 0, 0, density, 0, 0);
  DAVE_FIGURE.def.paintFrame(ctx, STILL_ROW, STILL_FRAME);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return surface;
}

function paintGlitchLayer(ctx: CanvasRenderingContext2D, density: number): void {
  const width = Math.ceil(DAVE_FIGURE.def.frameWidth * density);
  const height = Math.ceil(DAVE_FIGURE.def.frameHeight * density);
  const body = paintStillFrame(density, width, height);
  try {
    washInTeleportLight(body);
    ctx.drawImage(body, 0, 0, width, height, 0, 0, width / density, height / density);
  } finally {
    releaseSurface(body);
  }
}

function paintEdgeLayer(ctx: CanvasRenderingContext2D, density: number): void {
  const width = Math.ceil(DAVE_FIGURE.def.frameWidth * density);
  const height = Math.ceil(DAVE_FIGURE.def.frameHeight * density);
  const body = paintStillFrame(density, width, height);
  const ring = allocCanvas('figureScratch', width, height);
  try {
    const reach = EDGE_RING_CELL_PX * density;
    paintTeleportEdgeRing(ring, body, reach);
    ctx.drawImage(ring, 0, 0, width, height, 0, 0, width / density, height / density);
  } finally {
    releaseSurface(ring);
    releaseSurface(body);
  }
}

function isLightLayer(state: string): state is LightLayer {
  return state === 'glitch' || state === 'edge';
}

/**
 * The teleport's two light pictures of him, cut from his still frame: that
 * frame washed in the light's colour, and a ring of the light round its edge.
 * Each is painted at the density the cache bakes at, onto surfaces of that
 * density, so the ring stays one screen pixel wide at any bake.
 */
const DAVE_LIGHT_FIGURE: FigureDef = {
  id: `${DAVE_FIGURE.def.id}:teleport`,
  frameWidth: DAVE_FIGURE.def.frameWidth,
  frameHeight: DAVE_FIGURE.def.frameHeight,
  tileX: DAVE_FIGURE.def.tileX,
  tileY: DAVE_FIGURE.def.tileY,
  tileScale: DAVE_FIGURE.def.tileScale,
  states: figureStates(LIGHT_LAYER_FRAMES),
  skipSupersample: true,
  paintFrame: (ctx, state) => {
    if (!isLightLayer(state)) return;
    const { a, b, c, d } = ctx.getTransform();
    const density = Math.sqrt(Math.abs(a * d - b * c));
    if (state === 'glitch') paintGlitchLayer(ctx, density);
    else paintEdgeLayer(ctx, density);
  },
};

const LIGHT_SPANS: readonly ResidentSpan[] = (['glitch', 'edge'] as const).map((row) => ({
  row,
  frames: ONE_FRAME,
}));
const LIGHT_RESIDENT = new ResidentRows(LIGHT_SPANS);

// ── Him as a figure the world builds ─────────────────────────────────────────

const CELL = DAVE_FIGURE.def;

/** A measure in his cell's pixels down from its top, as tiles down from his tile's top. */
function cellYInTiles(cellY: number): number {
  return (cellY - CELL.tileY) / CELL.tileScale;
}

/** A measure in his cell's pixels across from its left, as tiles across from his tile's left. */
function cellXInTiles(cellX: number): number {
  return (cellX - CELL.tileX) / CELL.tileScale;
}

const reusedFade: { alpha: number } = { alpha: 1 };

/**
 * Him as the teleport sees him: his soles on the rig's ground line, his hair's
 * top above his tile, his cell as the box, and his pictures out of the figure
 * cache. The pose is the frame of his breathing loop his solid slices show.
 */
const DAVE_TELEPORT_FIGURE: TeleportFigure<number> = {
  soleY: cellYInTiles(ORIGIN_Y),
  headY: -DAVE_HEAD_LIFT_TILES,
  centreX: cellXInTiles(CELL.tileX + CELL.tileScale / 2),
  boxLeft: cellXInTiles(0),
  boxTop: cellYInTiles(0),
  boxWidth: CELL.frameWidth / CELL.tileScale,
  boxBottom: cellYInTiles(CELL.frameHeight),
  drawLayer: (ctx, layer, idleFrame, sx, sy, tileSize, alpha) => {
    reusedFade.alpha = alpha;
    if (layer === 'solid') {
      drawFigureCached(ctx, CELL, STILL_ROW, idleFrame, sx, sy, tileSize, reusedFade);
    } else {
      drawFigureCached(ctx, DAVE_LIGHT_FIGURE, layer, 0, sx, sy, tileSize, reusedFade);
    }
  },
};

// ── The draw ─────────────────────────────────────────────────────────────────

function idleTicks(state: DaveSpriteState): number {
  return Math.floor(
    (performance.now() / MS_PER_SECOND + state.idleOffsetSeconds) * WORLD_TICKS_PER_SECOND,
  );
}
const MS_PER_SECOND = 1000;

function clockFrame(row: HumanRowName, ticks: number): number {
  const meta = HUMAN_ROW_TABLE[row];
  return rowFrameAtTicks(meta, ticks % rowLengthInTicks(meta));
}

function rowOf(state: DaveSpriteState): DaveRow {
  if (state.isWalking) return 'walk';
  return state.isTalking ? 'talk' : 'idle';
}

/**
 * Draws Dave standing on the tile whose top-left is `(sx, sy)` and returns the
 * row drawn, for `figureRowInkTop`; undefined while a teleport shows none of
 * him yet. Only the profile is mirrored, so his jacket never swaps sides.
 */
export function drawDaveSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: DaveSpriteState,
): DrawnFigureRow | undefined {
  RESIDENT_ROWS.hold(DAVE_FIGURE.def);
  const ticks = idleTicks(state);
  const teleport = state.teleport;
  if (teleport !== null) {
    LIGHT_RESIDENT.hold(DAVE_LIGHT_FIGURE);
    const idleFrame = clockFrame(STILL_ROW, ticks);
    const drawn = drawTeleport(ctx, DAVE_TELEPORT_FIGURE, idleFrame, sx, sy, tileSize, teleport);
    return drawn ? drawnFigureRow(DAVE_FIGURE.def, STILL_ROW) : undefined;
  }

  const facing = selectCardinalFacing(state.facingX, state.facingY);
  const painted = rowOf(state);
  const row = viewRow(DAVE_ROWS[painted], facing.view);
  const meta = HUMAN_ROW_TABLE[row];
  const frame =
    painted === 'walk' ? walkFrameIndex(state.walkPhase, meta.frameCount) : clockFrame(row, ticks);
  const horizontal = state.facingX !== 0 ? state.facingX : state.lastHorizontalFacing;
  drawHumanFigureSelection(
    ctx,
    DAVE_FIGURE,
    sx,
    sy,
    tileSize,
    { row, frame, flipX: meta.mirrorable && facing.view === 'side' && horizontal < 0 },
    null,
  );
  return drawnFigureRow(DAVE_FIGURE.def, row);
}

/**
 * Queues every row he is drawn in and the teleport's two pictures of him for
 * baking. Call when his scene loads, and again when a teleport is scheduled:
 * a picture not drawn within the cache's release window is let go.
 */
export function prewarmDaveSprite(): void {
  for (const span of RESIDENT_SPANS) prewarmFigureState(DAVE_FIGURE.def, span.row);
  for (const span of LIGHT_SPANS) prewarmFigureState(DAVE_LIGHT_FIGURE, span.row);
}
