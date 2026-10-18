/**
 * Where the spider lab's approach hallways are wrecked, and how badly.
 *
 * Everything the approach shows besides its scatter props is painted, not
 * placed: the tape and sign at the mouth, the stains, trails, spills, the
 * overturned cart and the collapsed wall are baked into the floor and wall
 * chunks, and the webs overhead and the cocoons are drawn live over the
 * bodies. This module decides where each piece goes, once per floor, from the
 * approach the generator recorded; the painters read it back through the grid
 * they are handed, as the lab's own floor plan is read.
 *
 * Every choice here is art: it is seeded from the approach's own position and
 * never reaches a tile, a wall or the walking lane. All of it reads one
 * `decay`, 0 across the mouth to 1 at the lab's doorway, and none of it
 * reaches the station between the two hallways.
 */

import type { SpiderLabRoomData } from '../DungeonGenerator';
import { labApproachZoneAt, labHallwayDecayAt, type LabHallwayTile } from '../labApproach';
import type { Point, Rect } from '../roomDoorways';
import { tileCoordKey } from '../tileIndex';
import { FloorTypeValue, positionHash, type TileContent } from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import { mulberry32, type Rng } from '../../sprites/person/rng';
import { wallShapeAt } from './wallShape';
import { isOpenAreaCorner } from './roomDressing';
import type { WallDressingId } from './roomCharacters';

/** A point in tile units: a tile's centre is at +0.5 on both axes. */
export interface DecorPoint {
  readonly x: number;
  readonly y: number;
}

/** A painted piece of the approach's floor, in tile units. */
export type LabHallwayFloorItem =
  | { readonly kind: 'hazard_band'; readonly from: DecorPoint; readonly to: DecorPoint }
  | { readonly kind: 'tape'; readonly points: ReadonlyArray<DecorPoint> }
  | { readonly kind: 'fallen_sign'; readonly at: DecorPoint; readonly angle: number }
  | {
      readonly kind: 'trail';
      readonly style: 'drag' | 'slime';
      readonly points: ReadonlyArray<DecorPoint>;
    }
  | {
      readonly kind: 'stain';
      readonly at: DecorPoint;
      readonly radius: number;
      readonly seed: number;
    }
  | { readonly kind: 'spill'; readonly spill: 'glass' | 'paper' | 'dust'; readonly at: DecorPoint }
  | { readonly kind: 'cart'; readonly at: DecorPoint; readonly angle: number }
  | { readonly kind: 'jars'; readonly at: DecorPoint; readonly seed: number }
  | { readonly kind: 'papers'; readonly at: DecorPoint; readonly seed: number }
  | { readonly kind: 'rubble'; readonly at: DecorPoint; readonly seed: number }
  | { readonly kind: 'egg_cluster'; readonly at: DecorPoint; readonly seed: number }
  | {
      readonly kind: 'moult';
      readonly at: DecorPoint;
      readonly angle: number;
      readonly seed: number;
    }
  | { readonly kind: 'shard_pile'; readonly at: DecorPoint; readonly seed: number }
  | { readonly kind: 'husk'; readonly at: DecorPoint; readonly seed: number }
  | { readonly kind: 'guy_line'; readonly from: DecorPoint; readonly to: DecorPoint };

/** How big a thing wrapped in silk is. */
export type CocoonSize = 'husk' | 'body' | 'human';

/** A wrapped thing standing or hanging at the lane's edge, drawn with the bodies. */
export interface HungCocoon extends Point {
  readonly size: CocoonSize;
}

/** Prey wrapped and hung from the ceiling on a strand, over a tile at the lane's edge. */
export interface HangingPrey {
  /** Where it hangs, in tile units: its foot on the floor below it. */
  readonly at: DecorPoint;
  readonly seed: number;
}

/** A large piece hung on, or broken through, one wall face. */
export type LabHallwayWallPiece = 'collapsed_west' | 'collapsed_east' | 'warning_sign';

/** A sheet of web strung wall to wall across the hallway, overhead. */
export interface OverheadWeb {
  /** Where it is fixed to each wall, in tile units, at the height it hangs. */
  readonly from: DecorPoint;
  readonly to: DecorPoint;
  readonly decay: number;
  readonly seed: number;
}

export interface LabHallwayDecor {
  readonly lab: SpiderLabRoomData;
  /** 0 at the mouth to 1 at the lab's doorway, or null off both hallways. */
  decayAt(tileX: number, tileY: number): number | null;
  /** The painted floor pieces whose bounds touch this tile. */
  floorItemsAt(tileX: number, tileY: number): ReadonlyArray<LabHallwayFloorItem>;
  /** The face dressing a face with its foot on this tile takes, or null where it keeps its own. */
  wallDressingAt(footX: number, footY: number): WallDressingId | null;
  /** The large piece on the face whose foot is this tile, if any. */
  wallPieceAt(footX: number, footY: number): LabHallwayWallPiece | null;
  /** The few piles of eggshell near the lab end, in tile units, each a crunch underfoot. */
  readonly shardPiles: ReadonlyArray<DecorPoint>;
  readonly overheadWebs: ReadonlyArray<OverheadWeb>;
  /** Wrapped bodies at the lane's edges, more and bigger toward the lab. */
  readonly cocoons: ReadonlyArray<HungCocoon>;
  readonly hangingPrey: ReadonlyArray<HangingPrey>;
  /** The tiles the decor spans, padded, for culling the live layer. */
  readonly bounds: Rect;
}

// ── Tuning ──────────────────────────────────────────────────────────────────

/** Faces this far down the approach take the wrecked dressing, and further on the nest's. */
const WRECKED_WALL_DECAY = 0.25;
const NEST_WALL_DECAY = 0.55;
/** A face this many tiles or fewer from the mouth may carry the warning sign. */
const SIGN_REACH_TILES = 2;
/** The sign's tilt when it has fallen, in radians. */
const FALLEN_SIGN_ANGLE = 0.45;
/** Where the collapsed section is sought, nearest first. */
const COLLAPSE_NEAR_LAB_DECAY = 0.7;
const COLLAPSE_FALLBACK_DECAY = 0.4;
const COLLAPSE_DECAY_TARGETS = [COLLAPSE_NEAR_LAB_DECAY, COLLAPSE_FALLBACK_DECAY] as const;
/** The share of the opening's width the tape still spans from its first jamb. */
const TAPE_SPAN_SHARE = 0.7;
/** How far the long piece of tape sags into the hallway, in tiles. */
const TAPE_SAG_TILES = 0.55;
/** How far the short piece hangs into the hallway from its jamb, in tiles. */
const TAPE_STUB_REACH_TILES = 0.6;
const TAPE_STUB_SHARE = 0.3;
/** Points along each tape piece. */
const TAPE_SEGMENTS = 8;
/** How far in from the mouth's edge with the host room the hazard band is painted, in tiles. */
const HAZARD_BAND_INSET_TILES = 0.2;
/** How far in from the mouth's edge the tape lies. */
const TAPE_INSET_TILES = 0.12;
/** The overhead webs: none nearer the mouth than this, then spaced closer as the lab nears. */
const WEB_START_DECAY = 0.08;
const WEB_SPACING_AT_MOUTH = 5;
const WEB_SPACING_AT_LAB = 3;
/** Extra steps a web may hang past its spacing, so the sheets never fall in a regular row. */
const WEB_SPACING_JITTER = 2;
/** How far the drag mark wanders off its line, in tiles, and how quickly along it. */
const DRAG_WANDER_TILES = 0.12;
const DRAG_WANDER_RATE = 0.7;
/** How high a web hangs, in tiles above the floor it spans: about the top of the faces. */
const WEB_HANG_TILES = 1.35;
/** The widest hallway a web spans: a standard one, three tiles, and a little over at a doorway. */
const MAX_WEB_SPAN_TILES = 4;
/** A web needs two tiles of floor under it to be strung across anything. */
const MIN_WEB_SPAN_TILES = 2;
/** Steps in from the mouth no placed piece takes, so the tape and sign read alone. */
const MOUTH_KEEP_CLEAR_STEPS = 1;
/** The breach's two face columns, west first, and the same with a face either side. */
const BREACH_COLUMNS = [0, 1] as const;
const BREACH_AND_FLANK_COLUMNS = [-1, 0, 1, 2] as const;
/** Rows of floor in front of the breach its rubble covers. */
const RUBBLE_CLEAR_ROWS = 1;
/** Webs keep this many steps clear of the station's doors and the lab's. */
const WEB_DOOR_CLEARANCE_STEPS = 2;
/** Cocoons hang only this far down the approach or further. */
/** Where along the approach each wrapped body stands, and how big it is, lab end first. */
const COCOON_PLAN: ReadonlyArray<{ readonly decay: number; readonly size: CocoonSize }> = [
  { decay: 0.92, size: 'human' },
  { decay: 0.84, size: 'body' },
  { decay: 0.74, size: 'husk' },
  { decay: 0.66, size: 'body' },
  { decay: 0.58, size: 'husk' },
  { decay: 0.4, size: 'husk' },
];
/** Where prey hangs on its strand. */
const PREY_DECAYS = [{ decay: 0.36 }, { decay: 0.62 }, { decay: 0.78 }, { decay: 0.9 }] as const;
/** The nest's floor pieces and where along the approach each is sought. */
const EGG_CLUSTER_DECAYS = [
  { decay: 0.34 },
  { decay: 0.6 },
  { decay: 0.72 },
  { decay: 0.86 },
  { decay: 0.96 },
] as const;
const MOULT_DECAYS = [{ decay: 0.44 }, { decay: 0.68 }, { decay: 0.88 }] as const;
const SHARD_PILE_DECAYS = [{ decay: 0.8 }, { decay: 0.94 }] as const;
const HUSK_DECAYS = [{ decay: 0.55 }, { decay: 0.7 }, { decay: 0.82 }, { decay: 0.97 }] as const;
const GUY_LINE_DECAYS = [
  { decay: 0.22 },
  { decay: 0.38 },
  { decay: 0.52 },
  { decay: 0.64 },
  { decay: 0.76 },
  { decay: 0.9 },
] as const;
/** How far out from the wall a guy line is pegged to the floor, and how far along it slants, in tiles. */
const GUY_LINE_REACH_TILES = 0.42;
const GUY_LINE_SLANT_TILES = 0.6;
/** A moult lies at about this angle off the wall, plus a jitter, in radians. */
const MOULT_ANGLE_JITTER = 0.8;
/** How far, in decay, a nest piece may be set from where it was sought. */
const PLACEMENT_DRIFT = 0.15;
/** A bend's corner is taken for a cocoon only this near, in decay, to where it was sought. */
const COCOON_CORNER_REACH = 0.15;
/** Slime starts this far down the outer hallway. */
const SLIME_START_DECAY = 0.2;
/** How far either side of the centre line the slime and the drag wander, in tiles. */
const SLIME_OFFSET_TILES = 0.45;
const DRAG_OFFSET_TILES = -0.2;
/** Centre-line points averaged either side when smoothing. */
const PATH_SMOOTH_RADIUS = 1;
/** How far from the wall a piece against it sits, as a share of the step to the wall. */
const AGAINST_WALL_SHARE = 0.3;
/** Padding round the decor's tiles for the live layer's cull, in tiles. */
const BOUNDS_PADDING_TILES = 3;

/** The outer hallway's pieces and the decay each is sought at. */
const OUTER_STAINS = [{ decay: 0.3 }, { decay: 0.45 }] as const;
const INNER_STAINS = [{ decay: 0.55 }, { decay: 0.68 }, { decay: 0.8 }, { decay: 0.92 }] as const;
const OUTER_STAIN_RADIUS = 0.35;
const INNER_STAIN_RADIUS = 0.55;
const PAPERS_DECAY = 0.28;
const CART_DECAY = 0.42;
const OUTER_JARS_DECAY = 0.38;
const INNER_JARS_DECAY = 0.86;
/** The cart lies across its tile at about this angle, in radians, plus a jitter. */
const CART_BASE_ANGLE = 0.25;
const CART_ANGLE_JITTER = 0.3;

const SEED_SALT_X = 0x9e37;
const SEED_SALT_Y = 0x79b9;
const STEPS: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const HALF = 0.5;

// ── Registry ────────────────────────────────────────────────────────────────

const decors = new WeakMap<TileContent[][], LabHallwayDecor>();

/** The approach's decor on a grid, or undefined on a floor with no lab. */
export function labHallwayDecorOf(grid: TileContent[][]): LabHallwayDecor | undefined {
  return decors.get(grid);
}

/**
 * Works out the approach's decor and records it against its grid. Faces a
 * fixture hangs on (`fixtureFaces`, by face tile) are kept clear of the large
 * pieces, which would be drawn through it.
 */
export function registerLabHallwayDecor(
  grid: TileContent[][],
  lab: SpiderLabRoomData,
  fixtureFaces: ReadonlyArray<Point>,
): LabHallwayDecor {
  const decor = planLabHallwayDecor(grid, lab, fixtureFaces);
  decors.set(grid, decor);
  return decor;
}

// ── Planning ────────────────────────────────────────────────────────────────

function isOpenAt(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return false;
  return isWalkableTileType(grid[y][x]);
}

function isWallAt(grid: TileContent[][], x: number, y: number): boolean {
  return grid[y]?.[x]?.type === FloorTypeValue.wall;
}

function wallSides(grid: TileContent[][], tile: Point): Point[] {
  return STEPS.filter((step) => isWallAt(grid, tile.x + step.x, tile.y + step.y));
}

/** The centre of each step along a hallway, from its mouth end on, smoothed. */
function centreLine(
  tiles: ReadonlyArray<LabHallwayTile>,
): Array<DecorPoint & { decayStep: number }> {
  const byStep = new Map<number, { x: number; y: number; count: number }>();
  for (const tile of tiles) {
    const sum = byStep.get(tile.distanceFromMouth) ?? { x: 0, y: 0, count: 0 };
    sum.x += tile.x + HALF;
    sum.y += tile.y + HALF;
    sum.count++;
    byStep.set(tile.distanceFromMouth, sum);
  }
  const raw = [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, sum]) => ({ x: sum.x / sum.count, y: sum.y / sum.count, decayStep: step }));
  return raw.map((point, index) => {
    let x = 0;
    let y = 0;
    let count = 0;
    for (let near = index - PATH_SMOOTH_RADIUS; near <= index + PATH_SMOOTH_RADIUS; near++) {
      if (near < 0 || near >= raw.length) continue;
      const other = raw[near];
      x += other.x;
      y += other.y;
      count++;
    }
    return { x: x / count, y: y / count, decayStep: point.decayStep };
  });
}

/** A line nudged sideways off a centre line, by `offset` tiles to its left. */
function offsetLine(line: ReadonlyArray<DecorPoint>, offset: number): DecorPoint[] {
  return line.map((point, index) => {
    const before = line[Math.max(0, index - 1)];
    const after = line[Math.min(line.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
  });
}

function planLabHallwayDecor(
  grid: TileContent[][],
  lab: SpiderLabRoomData,
  fixtureFaces: ReadonlyArray<Point>,
): LabHallwayDecor {
  const rng: Rng = mulberry32(
    positionHash(lab.hallwayMouthTile.x + SEED_SALT_X, lab.hallwayMouthTile.y + SEED_SALT_Y),
  );
  const span = Math.max(1, lab.labDoorwayDistance);
  const decayAt = (x: number, y: number): number | null => labHallwayDecayAt(lab, x, y);
  const allTiles: ReadonlyArray<LabHallwayTile> = [
    ...lab.outerHallwayTiles,
    ...lab.innerHallwayTiles,
  ];
  const fixtureKeys = new Set(fixtureFaces.map((face) => tileCoordKey(face.x, face.y)));
  const nearFixture = (faceX: number, faceY: number): boolean =>
    [-1, 0, 1].some((dx) => fixtureKeys.has(tileCoordKey(faceX + dx, faceY)));

  const floorItems: LabHallwayFloorItem[] = [];
  const wallPieces = new Map<number, LabHallwayWallPiece>();

  /** The hallway tile whose decay is nearest `target`, among those `accept` lets through. */
  const tileNearestDecay = (
    tiles: ReadonlyArray<LabHallwayTile>,
    target: number,
    accept: (tile: LabHallwayTile) => boolean,
  ): LabHallwayTile | null => {
    let best: LabHallwayTile | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const tile of tiles) {
      if (!accept(tile)) continue;
      const gap = Math.abs(tile.distanceFromMouth / span - target) + (rng() * HALF) / span;
      if (gap < bestGap) {
        best = tile;
        bestGap = gap;
      }
    }
    return best;
  };
  const againstWall = (tile: LabHallwayTile): boolean => wallSides(grid, tile).length > 0;
  const besideWall = (tile: Point): DecorPoint => {
    const side = wallSides(grid, tile)[0] ?? { x: 0, y: 0 };
    return {
      x: tile.x + HALF + side.x * AGAINST_WALL_SHARE,
      y: tile.y + HALF + side.y * AGAINST_WALL_SHARE,
    };
  };

  // ── The mouth ──
  const mouthTiles = lab.outerHallwayTiles
    .filter((tile) => tile.distanceFromMouth === 0)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const firstMouth = mouthTiles.length > 0 ? mouthTiles[0] : undefined;
  const lastMouth = mouthTiles.length > 0 ? mouthTiles[mouthTiles.length - 1] : undefined;
  if (firstMouth !== undefined && lastMouth !== undefined) {
    const host = lab.hostBounds;
    const inHost = (x: number, y: number): boolean =>
      x >= host.x && x < host.x + host.w && y >= host.y && y < host.y + host.h;
    const towardHost =
      STEPS.find((step) => inHost(firstMouth.x + step.x, firstMouth.y + step.y)) ?? STEPS[0];
    const inward = { x: -towardHost.x, y: -towardHost.y };
    const along = towardHost.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    // The edge the mouth shares with the host room, from one jamb to the other.
    const edgeAt = (tile: Point, end: -1 | 1, inset: number): DecorPoint => ({
      x: tile.x + HALF + towardHost.x * HALF + along.x * end * HALF + inward.x * inset,
      y: tile.y + HALF + towardHost.y * HALF + along.y * end * HALF + inward.y * inset,
    });
    floorItems.push({
      kind: 'hazard_band',
      from: edgeAt(firstMouth, -1, HAZARD_BAND_INSET_TILES),
      to: edgeAt(lastMouth, 1, HAZARD_BAND_INSET_TILES),
    });
    const jambA = edgeAt(firstMouth, -1, TAPE_INSET_TILES);
    const jambB = edgeAt(lastMouth, 1, TAPE_INSET_TILES);
    const sagged = (from: DecorPoint, to: DecorPoint, sag: number): DecorPoint[] =>
      Array.from({ length: TAPE_SEGMENTS + 1 }, (_, index) => {
        const t = index / TAPE_SEGMENTS;
        const droop = Math.sin(t * Math.PI) * sag;
        return {
          x: from.x + (to.x - from.x) * t + inward.x * droop,
          y: from.y + (to.y - from.y) * t + inward.y * droop,
        };
      });
    const longEnd = {
      x: jambA.x + (jambB.x - jambA.x) * TAPE_SPAN_SHARE + inward.x * TAPE_SAG_TILES,
      y: jambA.y + (jambB.y - jambA.y) * TAPE_SPAN_SHARE + inward.y * TAPE_SAG_TILES,
    };
    floorItems.push({ kind: 'tape', points: sagged(jambA, longEnd, TAPE_SAG_TILES) });
    const stubEnd = {
      x: jambB.x + (jambA.x - jambB.x) * TAPE_STUB_SHARE + inward.x * TAPE_STUB_REACH_TILES,
      y: jambB.y + (jambA.y - jambB.y) * TAPE_STUB_SHARE + inward.y * TAPE_STUB_REACH_TILES,
    };
    floorItems.push({ kind: 'tape', points: sagged(jambB, stubEnd, HALF * TAPE_SAG_TILES) });

    // The sign: on a face beside the mouth, where the host room can see it, or
    // fallen against the wall if no face is near.
    let signFace: Point | null = null;
    let signGap = Number.POSITIVE_INFINITY;
    for (const mouth of mouthTiles) {
      for (let dy = -SIGN_REACH_TILES; dy <= SIGN_REACH_TILES; dy++) {
        for (let dx = -SIGN_REACH_TILES; dx <= SIGN_REACH_TILES; dx++) {
          const footX = mouth.x + dx;
          const footY = mouth.y + dy;
          if (!isOpenAt(grid, footX, footY) || !isWallAt(grid, footX, footY - 1)) continue;
          if (wallShapeAt(grid, footX, footY - 1).face !== 'lower') continue;
          if (labApproachZoneAt(lab, footX, footY) === 'station') continue;
          if (nearFixture(footX, footY - 1)) continue;
          const gap = Math.hypot(dx, dy);
          if (gap < signGap) {
            signGap = gap;
            signFace = { x: footX, y: footY };
          }
        }
      }
    }
    if (signFace !== null) {
      wallPieces.set(tileCoordKey(signFace.x, signFace.y), 'warning_sign');
    } else {
      const propped = mouthTiles.find((tile) => wallSides(grid, tile).length > 0) ?? firstMouth;
      floorItems.push({ kind: 'fallen_sign', at: besideWall(propped), angle: FALLEN_SIGN_ANGLE });
    }
  }

  // ── Trails ──
  const outerLine = centreLine(lab.outerHallwayTiles);
  const innerLine = centreLine(lab.innerHallwayTiles);
  const slimeOuter = outerLine.filter((point) => point.decayStep / span >= SLIME_START_DECAY);
  if (slimeOuter.length > 1) {
    floorItems.push({
      kind: 'trail',
      style: 'slime',
      points: offsetLine(slimeOuter, SLIME_OFFSET_TILES),
    });
  }
  if (innerLine.length > 1) {
    floorItems.push({
      kind: 'trail',
      style: 'slime',
      points: offsetLine(innerLine, SLIME_OFFSET_TILES),
    });
    floorItems.push({
      kind: 'trail',
      style: 'drag',
      // Wandering as a body dragged by something walking would, not ruled straight.
      points: offsetLine(innerLine, DRAG_OFFSET_TILES).map((point, index) => ({
        x: point.x + Math.sin(index * DRAG_WANDER_RATE) * DRAG_WANDER_TILES * (rng() + HALF),
        y: point.y + Math.cos(index * DRAG_WANDER_RATE) * DRAG_WANDER_TILES * (rng() + HALF),
      })),
    });
  }

  // ── Stains, spills and the lab's debris ──
  const used = new Set<number>();
  const shardPiles: DecorPoint[] = [];
  // A piece beside the station's door or the lab's would be cut off by the
  // clip where the hallway's floor ends.
  const awayFromDoors = (tile: Point): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (isOpenAt(grid, x, y) && decayAt(x, y) === null) return false;
      }
    }
    return true;
  };
  const fresh = (tile: LabHallwayTile): boolean =>
    !used.has(tileCoordKey(tile.x, tile.y)) &&
    tile.distanceFromMouth > MOUTH_KEEP_CLEAR_STEPS &&
    awayFromDoors(tile);
  const take = (tile: LabHallwayTile | null): LabHallwayTile | null => {
    if (tile !== null) used.add(tileCoordKey(tile.x, tile.y));
    return tile;
  };
  const stainAt = (tiles: ReadonlyArray<LabHallwayTile>, decay: number, radius: number): void => {
    const tile = take(tileNearestDecay(tiles, decay, fresh));
    if (tile === null) return;
    floorItems.push({
      kind: 'stain',
      at: { x: tile.x + rng(), y: tile.y + rng() },
      radius,
      seed: positionHash(tile.x, tile.y),
    });
  };
  for (const { decay } of OUTER_STAINS) stainAt(lab.outerHallwayTiles, decay, OUTER_STAIN_RADIUS);
  for (const { decay } of INNER_STAINS) stainAt(lab.innerHallwayTiles, decay, INNER_STAIN_RADIUS);

  const wallTileNear = (
    tiles: ReadonlyArray<LabHallwayTile>,
    decay: number,
  ): LabHallwayTile | null =>
    take(tileNearestDecay(tiles, decay, (tile) => fresh(tile) && againstWall(tile)));
  // Planned before the smaller pieces, which then keep clear of its rubble.
  // ── The collapsed section, and its rubble ──
  let collapse: Point | null = null;
  for (const target of COLLAPSE_DECAY_TARGETS) {
    let bestGap = Number.POSITIVE_INFINITY;
    for (const tile of allTiles) {
      // The breach takes this column and the one east of it, with whole face
      // either side so it has wall round it, and both columns over this hallway.
      const ownColumns = BREACH_COLUMNS.every((dx) => {
        const footX = tile.x + dx;
        return (
          decayAt(footX, tile.y) !== null &&
          !used.has(tileCoordKey(footX, tile.y)) &&
          !wallPieces.has(tileCoordKey(footX, tile.y)) &&
          !nearFixture(footX, tile.y - 1)
        );
      });
      if (!ownColumns) continue;
      const runs = BREACH_AND_FLANK_COLUMNS.every(
        (dx) =>
          isWallAt(grid, tile.x + dx, tile.y - 1) &&
          wallShapeAt(grid, tile.x + dx, tile.y - 1).face === 'lower',
      );
      if (!runs) continue;
      const gap = Math.abs(tile.distanceFromMouth / span - target);
      if (gap < bestGap) {
        bestGap = gap;
        collapse = tile;
      }
    }
    if (collapse !== null) break;
  }
  if (collapse !== null) {
    wallPieces.set(tileCoordKey(collapse.x, collapse.y), 'collapsed_west');
    wallPieces.set(tileCoordKey(collapse.x + 1, collapse.y), 'collapsed_east');
    // The rubble heaps a tile out either side, so nothing else is set down beside it.
    for (const dx of BREACH_AND_FLANK_COLUMNS) {
      for (let dy = 0; dy <= RUBBLE_CLEAR_ROWS; dy++) {
        used.add(tileCoordKey(collapse.x + dx, collapse.y + dy));
      }
    }
    floorItems.push({
      kind: 'spill',
      spill: 'dust',
      at: { x: collapse.x + 1, y: collapse.y + HALF },
    });
    floorItems.push({
      kind: 'rubble',
      at: { x: collapse.x + 1, y: collapse.y + AGAINST_WALL_SHARE },
      seed: positionHash(collapse.x, collapse.y),
    });
  } else {
    const heap = wallTileNear(lab.innerHallwayTiles, COLLAPSE_DECAY_TARGETS[0]);
    if (heap !== null) {
      floorItems.push({ kind: 'spill', spill: 'dust', at: besideWall(heap) });
      floorItems.push({ kind: 'rubble', at: besideWall(heap), seed: positionHash(heap.x, heap.y) });
    }
  }

  const papers = wallTileNear(lab.outerHallwayTiles, PAPERS_DECAY);
  if (papers !== null) {
    floorItems.push({ kind: 'spill', spill: 'paper', at: besideWall(papers) });
    floorItems.push({
      kind: 'papers',
      at: besideWall(papers),
      seed: positionHash(papers.x, papers.y),
    });
  }
  const cart = wallTileNear(lab.outerHallwayTiles, CART_DECAY);
  if (cart !== null) {
    floorItems.push({
      kind: 'cart',
      at: besideWall(cart),
      angle: CART_BASE_ANGLE + (rng() - HALF) * CART_ANGLE_JITTER,
    });
  }
  for (const [tiles, decay] of [
    [lab.outerHallwayTiles, OUTER_JARS_DECAY],
    [lab.innerHallwayTiles, INNER_JARS_DECAY],
  ] as const) {
    const jars = wallTileNear(tiles, decay);
    if (jars === null) continue;
    floorItems.push({ kind: 'spill', spill: 'glass', at: besideWall(jars) });
    floorItems.push({ kind: 'jars', at: besideWall(jars), seed: positionHash(jars.x, jars.y) });
  }

  // ── The nest ──
  // Against the walls and in the corners, never across the middle of the lane.
  const innerStartDecay = Math.min(
    ...lab.innerHallwayTiles.map((tile) => tile.distanceFromMouth / span),
  );
  /**
   * The free wall tile nearest `decay`, in the hallway that decay falls in (or
   * the one given), and no further from it than {@link PLACEMENT_DRIFT}: a
   * piece meant for the lab end that cannot find room there is left out
   * rather than set down near the mouth.
   */
  const atWallFor = (
    decay: number,
    place: (tile: LabHallwayTile, side: Point) => void,
    hallway?: ReadonlyArray<LabHallwayTile>,
  ): void => {
    const tiles =
      hallway ?? (decay >= innerStartDecay ? lab.innerHallwayTiles : lab.outerHallwayTiles);
    const tile = take(
      tileNearestDecay(
        tiles,
        decay,
        (candidate) =>
          fresh(candidate) &&
          againstWall(candidate) &&
          Math.abs(candidate.distanceFromMouth / span - decay) <= PLACEMENT_DRIFT,
      ),
    );
    if (tile === null) return;
    place(tile, wallSides(grid, tile)[0] ?? { x: 0, y: 0 });
  };
  for (const { decay } of EGG_CLUSTER_DECAYS) {
    atWallFor(decay, (tile) =>
      floorItems.push({
        kind: 'egg_cluster',
        at: besideWall(tile),
        seed: positionHash(tile.x, tile.y),
      }),
    );
  }
  for (const { decay } of MOULT_DECAYS) {
    atWallFor(decay, (tile, side) =>
      // At the tile's middle: a carapace this wide set against the wall would be
      // cut off by the wall where the floor ends.
      floorItems.push({
        kind: 'moult',
        at: { x: tile.x + HALF, y: tile.y + HALF },
        angle: Math.atan2(side.y, side.x) + (rng() - HALF) * MOULT_ANGLE_JITTER,
        seed: positionHash(tile.x, tile.y),
      }),
    );
  }
  for (const { decay } of SHARD_PILE_DECAYS) {
    atWallFor(
      decay,
      (tile) => {
        const at = besideWall(tile);
        floorItems.push({ kind: 'shard_pile', at, seed: positionHash(tile.x, tile.y) });
        shardPiles.push(at);
      },
      lab.innerHallwayTiles,
    );
  }
  for (const { decay } of HUSK_DECAYS) {
    atWallFor(decay, (tile) =>
      floorItems.push({ kind: 'husk', at: besideWall(tile), seed: positionHash(tile.x, tile.y) }),
    );
  }
  for (const { decay } of GUY_LINE_DECAYS) {
    atWallFor(decay, (tile, side) => {
      const along = rng() < HALF ? -1 : 1;
      const wall = { x: tile.x + HALF + side.x * HALF, y: tile.y + HALF + side.y * HALF };
      floorItems.push({
        kind: 'guy_line',
        from: wall,
        to: {
          x: wall.x - side.x * GUY_LINE_REACH_TILES + side.y * along * GUY_LINE_SLANT_TILES,
          y: wall.y - side.y * GUY_LINE_REACH_TILES + side.x * along * GUY_LINE_SLANT_TILES,
        },
      });
    });
  }
  const hangingPrey: HangingPrey[] = [];
  for (const { decay } of PREY_DECAYS) {
    atWallFor(decay, (tile) =>
      hangingPrey.push({ at: besideWall(tile), seed: positionHash(tile.x, tile.y) }),
    );
  }

  // ── Overhead webs ──
  // Strung square across the run at points along its centre line: the
  // cross-section is read off the grid rather than off the walk's distances,
  // whose wavefront runs slantwise where it spills out of a doorway.
  const overheadWebs: OverheadWeb[] = [];
  const onApproach = (x: number, y: number): boolean => decayAt(x, y) !== null;
  for (const line of [outerLine, innerLine]) {
    const firstStep = line[0]?.decayStep ?? 0;
    const lastStep = line[line.length - 1]?.decayStep ?? 0;
    let nextStep = Number.NEGATIVE_INFINITY;
    line.forEach((point, index) => {
      const decay = point.decayStep / span;
      if (decay < WEB_START_DECAY || point.decayStep < nextStep) return;
      if (point.decayStep - firstStep < WEB_DOOR_CLEARANCE_STEPS && line === innerLine) return;
      if (lastStep - point.decayStep < WEB_DOOR_CLEARANCE_STEPS) return;
      const before = line[Math.max(0, index - 1)];
      const after = line[Math.min(line.length - 1, index + 1)];
      const runsEastWest = Math.abs(after.x - before.x) >= Math.abs(after.y - before.y);
      const tileX = Math.floor(point.x);
      const tileY = Math.floor(point.y);
      if (!onApproach(tileX, tileY)) return;
      const stepX = runsEastWest ? 0 : 1;
      const stepY = runsEastWest ? 1 : 0;
      let low = 0;
      while (onApproach(tileX - stepX * (low + 1), tileY - stepY * (low + 1))) low++;
      let high = 0;
      while (onApproach(tileX + stepX * (high + 1), tileY + stepY * (high + 1))) high++;
      // A web measured along the run rather than across it, at a bend, is no web.
      const spanTiles = low + high + 1;
      if (spanTiles < MIN_WEB_SPAN_TILES || spanTiles > MAX_WEB_SPAN_TILES) return;
      // Across a run going east-west the web spans north to south: from high
      // on the north face, which the camera sees standing, to the south wall's
      // cap line, the edge of that wall's top seen from above. Across a run
      // going north-south it spans between the two side walls at one height.
      const from = runsEastWest
        ? { x: tileX + HALF, y: tileY - low - WEB_HANG_TILES }
        : { x: tileX - low, y: tileY + HALF - WEB_HANG_TILES };
      const to = runsEastWest
        ? { x: tileX + HALF, y: tileY + high + 1 }
        : { x: tileX + high + 1, y: tileY + HALF - WEB_HANG_TILES };
      overheadWebs.push({ from, to, decay, seed: positionHash(tileX + point.decayStep, tileY) });
      nextStep =
        point.decayStep +
        Math.round(WEB_SPACING_AT_MOUTH + (WEB_SPACING_AT_LAB - WEB_SPACING_AT_MOUTH) * decay) +
        Math.floor(rng() * (WEB_SPACING_JITTER + 1));
    });
  }

  // ── Cocoons ──
  // The inside corners of a bend first, which are off every walking line;
  // then the lane's edge against a wall, as any prop there stands.
  const cocoons: HungCocoon[] = [];
  for (const { decay, size } of COCOON_PLAN) {
    const tiles = decay >= innerStartDecay ? lab.innerHallwayTiles : lab.outerHallwayTiles;
    const corner = take(
      tileNearestDecay(
        tiles,
        decay,
        (tile) =>
          fresh(tile) &&
          isOpenAreaCorner(grid, tile.x, tile.y) &&
          Math.abs(tile.distanceFromMouth / span - decay) < COCOON_CORNER_REACH,
      ),
    );
    const tile = corner ?? wallTileNear(tiles, decay);
    if (tile !== null) cocoons.push({ x: tile.x, y: tile.y, size });
  }

  // ── Indexing ──
  const itemsByTile = new Map<number, LabHallwayFloorItem[]>();
  for (const item of floorItems) {
    const box = floorItemBounds(item);
    for (let y = Math.floor(box.y0); y <= Math.floor(box.y1); y++) {
      for (let x = Math.floor(box.x0); x <= Math.floor(box.x1); x++) {
        const key = tileCoordKey(x, y);
        const list = itemsByTile.get(key) ?? [];
        list.push(item);
        itemsByTile.set(key, list);
      }
    }
  }
  const xs = allTiles.map((tile) => tile.x);
  const ys = allTiles.map((tile) => tile.y);
  const minX = Math.min(...xs) - BOUNDS_PADDING_TILES;
  const minY = Math.min(...ys) - BOUNDS_PADDING_TILES;
  const bounds = {
    x: minX,
    y: minY,
    w: Math.max(...xs) + BOUNDS_PADDING_TILES - minX + 1,
    h: Math.max(...ys) + BOUNDS_PADDING_TILES - minY + 1,
  };
  const none: ReadonlyArray<LabHallwayFloorItem> = [];
  return {
    lab,
    decayAt,
    floorItemsAt: (x, y) => itemsByTile.get(tileCoordKey(x, y)) ?? none,
    wallDressingAt: (footX, footY) => {
      const decay = decayAt(footX, footY);
      if (decay === null) return null;
      if (decay >= NEST_WALL_DECAY) return 'lab_hallway_nest';
      return decay >= WRECKED_WALL_DECAY ? 'lab_hallway_wrecked' : 'lab_hallway_scarred';
    },
    wallPieceAt: (footX, footY) => wallPieces.get(tileCoordKey(footX, footY)) ?? null,
    shardPiles,
    overheadWebs,
    cocoons,
    hangingPrey,
    bounds,
  };
}

/** How far each kind of floor piece reaches round the points that place it, in tiles. */
const ITEM_REACH_TILES = {
  hazard_band: 0.3,
  tape: 0.2,
  fallen_sign: 0.6,
  trail: 0.4,
  stain: 0,
  spill: 1,
  cart: 0.8,
  jars: 0.5,
  papers: 0.7,
  rubble: 1.1,
  egg_cluster: 0.6,
  moult: 0.9,
  shard_pile: 0.6,
  husk: 0.4,
  guy_line: 0.15,
} as const satisfies Record<LabHallwayFloorItem['kind'], number>;

interface ItemBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function boxAround(points: ReadonlyArray<DecorPoint>, reach: number): ItemBox {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x0: Math.min(...xs) - reach,
    y0: Math.min(...ys) - reach,
    x1: Math.max(...xs) + reach,
    y1: Math.max(...ys) + reach,
  };
}

/** The tile-unit box a floor piece may paint inside. */
export function floorItemBounds(item: LabHallwayFloorItem): ItemBox {
  const reach = ITEM_REACH_TILES[item.kind];
  switch (item.kind) {
    case 'hazard_band':
      return boxAround([item.from, item.to], reach);
    case 'tape':
    case 'trail':
      return boxAround(item.points, reach);
    case 'guy_line':
      return boxAround([item.from, item.to], reach);
    case 'stain':
      return boxAround([item.at], item.radius);
    case 'fallen_sign':
    case 'spill':
    case 'cart':
    case 'jars':
    case 'papers':
    case 'rubble':
    case 'egg_cluster':
    case 'moult':
    case 'shard_pile':
    case 'husk':
      return boxAround([item.at], reach);
  }
}
