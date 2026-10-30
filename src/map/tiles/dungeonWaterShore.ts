/**
 * Where dungeon water meets dry floor: a stone kerb along the floor's edge and
 * a flat waterline on the tile edge beneath it.
 *
 * Every piece is a tile-sized image painted once per floor theme and picked by
 * a neighbour mask, so the shore costs one `drawImage` per tile in the terrain
 * bake and nothing per frame. A flood or a drain repaints only the tiles beside
 * it, each from a piece already painted.
 *
 * **Keep shorelines cheap.** A soft, computed shoreline — a waterline that
 * wanders across tiles, sampled per pixel from a field over the neighbourhood,
 * with soaked floor and laps animated along it — is extremely computationally
 * expensive: every shore tile carries its own painted masks and frames, every
 * water change repaints them pixel by pixel, and every frame composites each
 * visible shore tile through a scratch canvas, enough to make a watery level
 * unplayably slow. Use one very sparingly, if ever; prefer cached rim pieces
 * chosen by neighbour mask over flat water, as here.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { canvasGeneration, onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../dungeon/floorTheme';
import { hashLattice } from '../tilegen/noise';
import { FloorTypeValue, isDungeonWater, VOID_TYPE, type TileContent } from '../tileTypes';
import {
  DUNGEON_WATER_PLANS,
  type DungeonWaterPlan,
  type WaterInk,
} from '../../sprites/sheets/dungeonWaterSheets';
import { drawDungeonWaterColumn, warmDungeonWaterColumn } from './dungeonWaterColumn';

/** How far from a tile whose water changes the shore drawn on another tile can change: its eight neighbours. */
export const DUNGEON_SHORE_REPAINT_REACH_TILES = 1;

/** Painted pixels per world pixel: enough for a crisp lip on a high-density screen. */
const PIECE_DENSITY = 2;
const PIECE_PX = TILE_SIZE * PIECE_DENSITY;

/*
 * The kerb, in world pixels measured in from the edge the water lies on. The
 * camera looks down from the south, so a kerb with water south of it shows its
 * face dropping to the water; on every other side only a dark drop line shows
 * past the kerb's top.
 */
const KERB_FACE_PX = 3;
const KERB_DROP_PX = 1;
const KERB_TOP_PX = 4.5;
/** The worn outer edge of the kerb's top, catching the light. */
const KERB_HIGHLIGHT_PX = 1;
/** The mortar line where the kerb meets the floor behind it. */
const KERB_JOINT_PX = 1;
/** Kerbstone length; a tile holds a whole number of them so joints meet across tiles. */
const KERB_BLOCK_PX = TILE_SIZE / 2;
const KERB_BLOCK_JOINT_PX = 1;
/** Joints between kerbstones are pointed shallower than the one behind the kerb, so the run reads as stone, not a ruler. */
const KERB_BLOCK_JOINT_STRENGTH = 0.55;
/** How far each kerbstone's tone and each grain of it are lifted or dropped, in levels. */
const KERB_BLOCK_TONE_LEVELS = 9;
const KERB_GRAIN_LEVELS = 7;
const SEED_KERB_BLOCK = 307;
const SEED_KERB_GRAIN = 311;

/*
 * The waterline, in world pixels measured in from the water tile's edge: a
 * pale glint where the water touches stone, then the kerb's shadow on the
 * water, longest under a face.
 */
const WATERLINE_GLINT_PX = 1;
const WATERLINE_SHADOW_UNDER_FACE_PX = 4;
const WATERLINE_SHADOW_PX = 2;
/** The shadow falls off with this power of the distance, so it hugs the stone. */
const WATERLINE_SHADOW_FALLOFF = 2;

const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;

/** A side of a tile, as a bit in a neighbour mask. */
const SIDE = { north: 1, east: 2, south: 4, west: 8 } as const;
/** A corner of a tile, as a bit above the sides in a kerb mask. */
const CORNER = { northEast: 16, southEast: 32, southWest: 64, northWest: 128 } as const;

function isSolid(cell: TileContent): boolean {
  return cell.type === FloorTypeValue.wall || cell.type === VOID_TYPE;
}

/** Water, or floor a float stands on in the water: the floor beside either drops to the water over a kerb. */
function isWaterSide(cell: TileContent | undefined): boolean {
  return cell !== undefined && (isDungeonWater(cell) || cell.underFloat === true);
}

/** Dry walkable floor, which takes a kerb wherever it meets water. */
function isKerbable(cell: TileContent | undefined): boolean {
  return cell !== undefined && !isWaterSide(cell) && !isSolid(cell);
}

/** The sides water lies on and the corners it touches alone, or 0 for a tile with no kerb. */
function kerbMask(structure: TileContent[][], tx: number, ty: number): number {
  if (!isKerbable(structure[ty]?.[tx])) return 0;
  const waterAt = (dx: number, dy: number): boolean => isWaterSide(structure[ty + dy]?.[tx + dx]);
  const north = waterAt(0, -1);
  const east = waterAt(1, 0);
  const south = waterAt(0, 1);
  const west = waterAt(-1, 0);
  let mask = 0;
  if (north) mask |= SIDE.north;
  if (east) mask |= SIDE.east;
  if (south) mask |= SIDE.south;
  if (west) mask |= SIDE.west;
  if (!north && !east && waterAt(1, -1)) mask |= CORNER.northEast;
  if (!south && !east && waterAt(1, 1)) mask |= CORNER.southEast;
  if (!south && !west && waterAt(-1, 1)) mask |= CORNER.southWest;
  if (!north && !west && waterAt(-1, -1)) mask |= CORNER.northWest;
  return mask;
}

/** The sides of a water tile that meet a kerb. */
function waterlineMask(structure: TileContent[][], tx: number, ty: number): number {
  if (!isDungeonWater(structure[ty]?.[tx])) return 0;
  const kerbAt = (dx: number, dy: number): boolean => isKerbable(structure[ty + dy]?.[tx + dx]);
  let mask = 0;
  if (kerbAt(0, -1)) mask |= SIDE.north;
  if (kerbAt(1, 0)) mask |= SIDE.east;
  if (kerbAt(0, 1)) mask |= SIDE.south;
  if (kerbAt(-1, 0)) mask |= SIDE.west;
  return mask;
}

/** What a pixel of a kerb piece is, in the order a pixel claimed by two edges resolves. */
const KERB_PART = { none: 0, joint: 1, top: 2, drop: 3, face: 4 } as const;
type KerbPart = (typeof KERB_PART)[keyof typeof KERB_PART];

interface KerbPixel {
  part: KerbPart;
  /** World pixels in from the kerb's outer edge on its top, for the highlight. */
  depthIntoTop: number;
  /** World pixels down the face from its top. */
  depthDownFace: number;
  /** Position along the kerb, for its stone joints. */
  along: number;
  /** Which run of kerb this is, so stones on different sides differ. */
  run: number;
}

/**
 * One run of kerb against a side or a corner. `across` is the distance in
 * from the water's edge on the run's own axis; a corner also has `acrossOther`
 * on the other axis, and covers only where both are within the kerb.
 */
interface KerbRun {
  readonly across: number;
  readonly acrossOther: number | null;
  readonly outer: number;
  readonly outerOther: number;
  readonly isFace: boolean;
  readonly along: number;
  readonly run: number;
}

function claim(pixel: KerbPixel, part: KerbPart, run: KerbRun, intoTop: number): void {
  if (part < pixel.part) return;
  if (part === pixel.part && part === KERB_PART.top && intoTop >= pixel.depthIntoTop) return;
  pixel.part = part;
  pixel.depthIntoTop = intoTop;
  pixel.depthDownFace = run.isFace ? KERB_FACE_PX - run.across : 0;
  pixel.along = run.along;
  pixel.run = run.run;
}

function classifyAgainst(pixel: KerbPixel, run: KerbRun): void {
  const reach = KERB_TOP_PX + KERB_JOINT_PX;
  if (run.across >= run.outer + reach) return;
  if (run.acrossOther !== null) {
    if (run.acrossOther >= run.outerOther + reach) return;
    if (run.acrossOther < run.outerOther) {
      claim(pixel, KERB_PART.drop, run, 0);
      return;
    }
  }
  if (run.across < run.outer) {
    claim(pixel, run.isFace ? KERB_PART.face : KERB_PART.drop, run, 0);
    return;
  }
  const intoTop = Math.max(
    run.across - run.outer,
    run.acrossOther === null ? 0 : run.acrossOther - run.outerOther,
  );
  claim(pixel, intoTop < KERB_TOP_PX ? KERB_PART.top : KERB_PART.joint, run, intoTop);
}

/** The runs of kerb a mask lays, as seen from the world pixel (u, v) of the tile. */
function kerbRunsAt(mask: number, u: number, v: number): KerbRun[] {
  const fromNorth = v;
  const fromSouth = TILE_SIZE - v;
  const fromWest = u;
  const fromEast = TILE_SIZE - u;
  const runs: KerbRun[] = [];
  const side = (bit: number, across: number, isFace: boolean, along: number, run: number): void => {
    if ((mask & bit) === 0) return;
    const outer = isFace ? KERB_FACE_PX : KERB_DROP_PX;
    runs.push({ across, acrossOther: null, outer, outerOther: 0, isFace, along, run });
  };
  side(SIDE.north, fromNorth, false, u, SIDE.north);
  side(SIDE.south, fromSouth, true, u, SIDE.south);
  side(SIDE.west, fromWest, false, v, SIDE.west);
  side(SIDE.east, fromEast, false, v, SIDE.east);
  const corner = (bit: number, fromNorthOrSouth: number, fromEastOrWest: number): void => {
    if ((mask & bit) === 0) return;
    const isFace = bit === CORNER.southEast || bit === CORNER.southWest;
    runs.push({
      across: fromNorthOrSouth,
      acrossOther: fromEastOrWest,
      outer: isFace ? KERB_FACE_PX : KERB_DROP_PX,
      outerOther: KERB_DROP_PX,
      isFace,
      along: u,
      run: bit,
    });
  };
  corner(CORNER.northEast, fromNorth, fromEast);
  corner(CORNER.southEast, fromSouth, fromEast);
  corner(CORNER.southWest, fromSouth, fromWest);
  corner(CORNER.northWest, fromNorth, fromWest);
  return runs;
}

/** Fills `pixel` for the world pixel (u, v) of a tile kerbed by `mask`, and says which part of the kerb it is. */
function classifyKerbPixel(pixel: KerbPixel, mask: number, u: number, v: number): KerbPart {
  pixel.part = KERB_PART.none;
  for (const run of kerbRunsAt(mask, u, v)) classifyAgainst(pixel, run);
  return pixel.part;
}

function lerpInk(from: WaterInk, to: WaterInk, t: number): WaterInk {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

function shifted(ink: WaterInk, levels: number): WaterInk {
  return { r: ink.r + levels, g: ink.g + levels, b: ink.b + levels };
}

function writePixel(rgba: Uint8ClampedArray, at: number, ink: WaterInk, alpha: number): void {
  rgba[at + RED] = ink.r;
  rgba[at + GREEN] = ink.g;
  rgba[at + BLUE] = ink.b;
  rgba[at + ALPHA] = alpha * BYTE_MAX;
}

function paintKerb(plan: DungeonWaterPlan, mask: number): Uint8ClampedArray {
  const ink = plan.kerb;
  const rgba = new Uint8ClampedArray(PIECE_PX * PIECE_PX * RGBA_CHANNELS);
  const pixel: KerbPixel = {
    part: KERB_PART.none,
    depthIntoTop: 0,
    depthDownFace: 0,
    along: 0,
    run: 0,
  };
  for (let py = 0; py < PIECE_PX; py++) {
    const v = (py + 0.5) / PIECE_DENSITY;
    for (let px = 0; px < PIECE_PX; px++) {
      const u = (px + 0.5) / PIECE_DENSITY;
      const part = classifyKerbPixel(pixel, mask, u, v);
      const at = (py * PIECE_PX + px) * RGBA_CHANNELS;
      const block = Math.floor(pixel.along / KERB_BLOCK_PX);
      const blockTone =
        (hashLattice(block, pixel.run, SEED_KERB_BLOCK) * 2 - 1) * KERB_BLOCK_TONE_LEVELS;
      const grain = (hashLattice(px, py, SEED_KERB_GRAIN + mask) * 2 - 1) * KERB_GRAIN_LEVELS;
      const isBlockJoint = pixel.along - block * KERB_BLOCK_PX < KERB_BLOCK_JOINT_PX;
      switch (part) {
        case KERB_PART.none:
          break;
        case KERB_PART.joint:
          writePixel(rgba, at, ink.joint, ink.jointAlpha);
          break;
        case KERB_PART.top: {
          const stone = pixel.depthIntoTop < KERB_HIGHLIGHT_PX ? ink.highlight : ink.top;
          const grained = shifted(stone, blockTone + grain);
          const jointDepth = isBlockJoint ? KERB_BLOCK_JOINT_STRENGTH : 0;
          writePixel(rgba, at, lerpInk(grained, ink.joint, jointDepth), 1);
          break;
        }
        case KERB_PART.face: {
          const down = Math.min(1, pixel.depthDownFace / KERB_FACE_PX);
          const face = shifted(lerpInk(ink.face, ink.faceFoot, down), blockTone + grain);
          const jointDepth = isBlockJoint ? KERB_BLOCK_JOINT_STRENGTH : 0;
          writePixel(rgba, at, lerpInk(face, ink.faceFoot, jointDepth), 1);
          break;
        }
        case KERB_PART.drop:
          writePixel(rgba, at, ink.faceFoot, 1);
          break;
        default: {
          const unhandled: never = part;
          throw new Error(`Unhandled kerb part: ${String(unhandled)}`);
        }
      }
    }
  }
  return rgba;
}

/** Straight-alpha `over` laid on what is already at `at`. */
function layOver(rgba: Uint8ClampedArray, at: number, ink: WaterInk, alpha: number): void {
  if (alpha <= 0) return;
  const below = rgba[at + ALPHA] / BYTE_MAX;
  const combined = alpha + below * (1 - alpha);
  const keep = (below * (1 - alpha)) / combined;
  const take = alpha / combined;
  rgba[at + RED] = ink.r * take + rgba[at + RED] * keep;
  rgba[at + GREEN] = ink.g * take + rgba[at + GREEN] * keep;
  rgba[at + BLUE] = ink.b * take + rgba[at + BLUE] * keep;
  rgba[at + ALPHA] = combined * BYTE_MAX;
}

function paintWaterline(plan: DungeonWaterPlan, mask: number): Uint8ClampedArray {
  const ink = plan.kerb;
  const rgba = new Uint8ClampedArray(PIECE_PX * PIECE_PX * RGBA_CHANNELS);
  for (let py = 0; py < PIECE_PX; py++) {
    const v = (py + 0.5) / PIECE_DENSITY;
    for (let px = 0; px < PIECE_PX; px++) {
      const u = (px + 0.5) / PIECE_DENSITY;
      const at = (py * PIECE_PX + px) * RGBA_CHANNELS;
      const edge = (bit: number, inFrom: number, shadowReach: number): void => {
        if ((mask & bit) === 0) return;
        const fade = Math.max(0, 1 - inFrom / shadowReach) ** WATERLINE_SHADOW_FALLOFF;
        layOver(rgba, at, ink.waterShadow, fade * ink.waterShadowAlpha);
        if (inFrom < WATERLINE_GLINT_PX) layOver(rgba, at, plan.surface.foam, ink.waterGlintAlpha);
      };
      edge(SIDE.north, v, WATERLINE_SHADOW_UNDER_FACE_PX);
      edge(SIDE.south, TILE_SIZE - v, WATERLINE_SHADOW_PX);
      edge(SIDE.west, u, WATERLINE_SHADOW_PX);
      edge(SIDE.east, TILE_SIZE - u, WATERLINE_SHADOW_PX);
    }
  }
  return rgba;
}

const PIECE_KIND = { kerb: 'kerb', waterline: 'waterline' } as const;
type PieceKind = (typeof PIECE_KIND)[keyof typeof PIECE_KIND];

const PIECE_PAINTERS = {
  kerb: paintKerb,
  waterline: paintWaterline,
} as const satisfies Record<PieceKind, (plan: DungeonWaterPlan, mask: number) => Uint8ClampedArray>;

interface PieceSet {
  readonly theme: DungeonFloorThemeId;
  readonly generation: number;
  readonly pieces: Map<`${PieceKind}:${number}`, CanvasSurface>;
}

let pieceSet: PieceSet | null = null;

function releasePieces(): void {
  if (pieceSet === null) return;
  for (const piece of pieceSet.pieces.values()) releaseSurface(piece);
  pieceSet = null;
}

function currentPieces(): PieceSet {
  const theme = dungeonFloorTheme().id;
  const generation = canvasGeneration();
  if (pieceSet?.theme === theme && pieceSet.generation === generation) return pieceSet;
  releasePieces();
  const fresh: PieceSet = { theme, generation, pieces: new Map() };
  pieceSet = fresh;
  return fresh;
}

function pieceFor(kind: PieceKind, mask: number): CanvasSurface {
  const set = currentPieces();
  const key = `${kind}:${mask}` as const;
  const existing = set.pieces.get(key);
  if (existing !== undefined) return existing;
  const piece = allocCanvas('groundTileParts', PIECE_PX, PIECE_PX);
  const pieceCtx = surfaceContext(piece);
  const image = pieceCtx.createImageData(PIECE_PX, PIECE_PX);
  image.data.set(PIECE_PAINTERS[kind](DUNGEON_WATER_PLANS[set.theme], mask));
  pieceCtx.putImageData(image, 0, 0);
  set.pieces.set(key, piece);
  return piece;
}

/**
 * Paints every kerb and waterline piece the map's water calls for ahead of
 * its first bake. A map with no dungeon water gives the pieces back.
 */
function warmDungeonShore(structure: TileContent[][]): void {
  if (!structure.some((row) => row.some((cell) => isDungeonWater(cell)))) {
    releasePieces();
    return;
  }
  for (let ty = 0; ty < structure.length; ty++) {
    for (let tx = 0; tx < structure[ty].length; tx++) {
      const kerb = kerbMask(structure, tx, ty);
      if (kerb !== 0) pieceFor(PIECE_KIND.kerb, kerb);
      const waterline = waterlineMask(structure, tx, ty);
      if (waterline !== 0) pieceFor(PIECE_KIND.waterline, waterline);
    }
  }
}

let lastWarmed: TileContent[][] | null = null;

/**
 * A recovery leaves the pieces and the column's samples painted into dead
 * surfaces, and repainting them lazily would land on the render path all at
 * once, so the floor's water is painted again straight away.
 */
onCanvasRecovery(() => {
  releasePieces();
  if (lastWarmed !== null) warmDungeonWater(lastWarmed);
});

/**
 * Paints everything the map's dungeon water draws from ahead of its first
 * frame: the column's samples, the moving surface and the shore's pieces.
 * Call again after water is poured or a float set down, so a piece the change
 * needs is not painted on the render path.
 */
export function warmDungeonWater(structure: TileContent[][]): void {
  lastWarmed = structure;
  warmDungeonWaterColumn(structure);
  warmDungeonShore(structure);
}

/**
 * Draws the water's part of a ground tile into the terrain bake: for water
 * the column and its waterline, for dry floor beside water its kerb, and
 * nothing anywhere else.
 */
export function drawDungeonShoreBake(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const isWater = isDungeonWater(structure[ty][tx]);
  if (isWater) drawDungeonWaterColumn(ctx, structure, sx, sy, ts, tx, ty);
  const kind = isWater ? PIECE_KIND.waterline : PIECE_KIND.kerb;
  const mask = isWater ? waterlineMask(structure, tx, ty) : kerbMask(structure, tx, ty);
  if (mask === 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pieceFor(kind, mask), sx, sy, ts, ts);
  ctx.restore();
}
