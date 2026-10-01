/**
 * Static dressing baked onto dungeon wall faces: cracks, damp, moss, roots,
 * chains, rust, conduit and pipe runs, and the things a room's character hangs
 * on its walls — skull niches, banners, shackles, cage fronts, lockers, panels,
 * boards and screens.
 *
 * Everything is painted in face coordinates (see `enterFaceSpace`) and clipped
 * to the tile, so a piece that starts on a face's upper tile runs on unbroken
 * into its lower one; both tiles seed their choice from the face's lower row and
 * so agree on what to draw. Restraint is the rule: the face's structure carries
 * the wall, and dressing is a few readable shapes, never texture.
 */

import { TILE_SIZE } from '../../core/constants';
import type { RGB } from '../../map/tilegen/raster';
import { hashLattice } from '../../map/tilegen/noise';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import type { WallDressingId } from '../../map/dungeon/roomCharacters';
import type { WallFacePart, WallShape } from '../../map/dungeon/wallShape';
import {
  BODY_TOP_TILES,
  FACE_STRIP_ROWS,
  JAMB_CLEARANCE_TILES,
  WALL_TOP_TILES,
  rgba,
  type Side,
} from './dungeonWallGeometry';

type Ctx = CanvasRenderingContext2D;

const TRANSPARENT = 0;

/** A static thing hung on, or worn into, one column of a face. */
export type WallSpotKind =
  | 'crack'
  | 'damp'
  | 'moss'
  | 'roots'
  | 'chain'
  | 'stain'
  | 'conduit'
  | 'skull_niche'
  | 'cask_rack'
  | 'banner'
  | 'shackles'
  | 'breaker_panel'
  | 'binder_shelf'
  | 'notice_board'
  | 'monitor';

/** A dressing that runs along every face tile it is given to, as one continuous fitting. */
export type WallRunKind = 'cage_bars' | 'lockers';

/**
 * What may be baked onto a stretch of face, and how often.
 *
 * Chosen per tile by the caller, so a room can dress its walls differently from
 * the floor's default without this module knowing what a room is.
 */
export interface WallDressingSet {
  /** Kinds a face column may carry one of, weighted. */
  readonly spots: ReadonlyArray<{ readonly kind: WallSpotKind; readonly weight: number }>;
  /** Chance a face column carries a spot at all. */
  readonly spotChance: number;
  /** Chance a stretch of face carries a pipe run along it. */
  readonly pipeRunChance: number;
  /** A fitting along every face tile, or none. */
  readonly run: WallRunKind | null;
  /** Webs strung in the top corners where a face ends. */
  readonly cornerCobwebs: boolean;
}

/** Tiles a pipe run is decided over, so a run is a length of pipe rather than a stub. */
const PIPE_RUN_TILES = 5;

const PLAIN: Omit<WallDressingSet, 'spots' | 'spotChance'> = {
  pipeRunChance: 0,
  run: null,
  cornerCobwebs: false,
};

/** Each character's wall dressing, by the id its table names. */
const WALL_DRESSINGS: Readonly<Record<WallDressingId, WallDressingSet>> = {
  cellar_plain: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 3 },
      { kind: 'damp', weight: 2 },
    ],
    spotChance: 0.12,
  },
  cellar_casks: {
    ...PLAIN,
    spots: [
      { kind: 'cask_rack', weight: 5 },
      { kind: 'damp', weight: 1 },
    ],
    spotChance: 0.45,
  },
  cellar_skull_niches: {
    ...PLAIN,
    spots: [
      { kind: 'skull_niche', weight: 4 },
      { kind: 'crack', weight: 1 },
    ],
    spotChance: 0.4,
  },
  cellar_damp_moss: {
    ...PLAIN,
    spots: [
      { kind: 'damp', weight: 3 },
      { kind: 'moss', weight: 3 },
    ],
    spotChance: 0.35,
  },
  cellar_cracked_roots: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 3 },
      { kind: 'roots', weight: 3 },
      { kind: 'damp', weight: 1 },
    ],
    spotChance: 0.3,
  },
  cellar_banners: {
    ...PLAIN,
    spots: [
      { kind: 'banner', weight: 3 },
      { kind: 'crack', weight: 1 },
    ],
    spotChance: 0.3,
  },
  cellar_shackles: {
    ...PLAIN,
    spots: [
      { kind: 'shackles', weight: 3 },
      { kind: 'chain', weight: 1 },
      { kind: 'damp', weight: 1 },
    ],
    spotChance: 0.35,
  },
  cellar_cage_fronts: {
    ...PLAIN,
    spots: [{ kind: 'damp', weight: 1 }],
    spotChance: 0.1,
    run: 'cage_bars',
  },
  cellar_cobwebs: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 1 },
      { kind: 'roots', weight: 1 },
    ],
    spotChance: 0.1,
    cornerCobwebs: true,
  },
  service_plain: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 2 },
      { kind: 'stain', weight: 2 },
    ],
    spotChance: 0.12,
  },
  service_pipe_runs: {
    ...PLAIN,
    spots: [{ kind: 'stain', weight: 1 }],
    spotChance: 0.15,
    pipeRunChance: 1,
  },
  service_breaker_panels: {
    ...PLAIN,
    spots: [
      { kind: 'breaker_panel', weight: 3 },
      { kind: 'conduit', weight: 2 },
    ],
    spotChance: 0.4,
  },
  service_lockers: {
    ...PLAIN,
    spots: [],
    spotChance: 0,
    run: 'lockers',
  },
  service_water_stains: {
    ...PLAIN,
    spots: [
      { kind: 'stain', weight: 4 },
      { kind: 'crack', weight: 1 },
    ],
    spotChance: 0.4,
  },
  service_filing: {
    ...PLAIN,
    spots: [
      { kind: 'binder_shelf', weight: 3 },
      { kind: 'notice_board', weight: 1 },
    ],
    spotChance: 0.35,
  },
  service_notice_board: {
    ...PLAIN,
    spots: [
      { kind: 'notice_board', weight: 3 },
      { kind: 'stain', weight: 1 },
    ],
    spotChance: 0.3,
  },
  service_monitors: {
    ...PLAIN,
    spots: [
      { kind: 'monitor', weight: 3 },
      { kind: 'conduit', weight: 1 },
    ],
    spotChance: 0.35,
  },
  service_conduit: {
    ...PLAIN,
    spots: [
      { kind: 'conduit', weight: 3 },
      { kind: 'breaker_panel', weight: 1 },
    ],
    spotChance: 0.3,
    pipeRunChance: 0.3,
  },
};

/** The dressing a character's id names. */
export function wallDressingFor(id: WallDressingId): WallDressingSet {
  return WALL_DRESSINGS[id];
}

/** Where nothing more specific has been chosen: a little of everything the floor has. */
const FLOOR_DEFAULTS: Readonly<Record<DungeonFloorThemeId, WallDressingSet>> = {
  cellars: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 3 },
      { kind: 'damp', weight: 3 },
      { kind: 'moss', weight: 2 },
      { kind: 'roots', weight: 2 },
      { kind: 'chain', weight: 1 },
    ],
    spotChance: 0.2,
  },
  service_level: {
    ...PLAIN,
    spots: [
      { kind: 'crack', weight: 2 },
      { kind: 'stain', weight: 3 },
      { kind: 'conduit', weight: 2 },
    ],
    spotChance: 0.18,
    pipeRunChance: 0.3,
  },
};

/** The dressing a floor's walls carry where nothing more specific has been chosen. */
export function defaultWallDressing(theme: DungeonFloorThemeId): WallDressingSet {
  return FLOOR_DEFAULTS[theme];
}

const DRESSING_SPOT_SALT = 0x3d1;
const DRESSING_KIND_SALT = 0x3d2;
const DRESSING_PIPE_SALT = 0x3d3;
const DRESSING_SHAPE_SALT = 0x3d4;
/** Distinct dressing layouts a face column can be seeded with. */
const DRESSING_SEED_RANGE = 0xffffff;

function tileHash(tx: number, ty: number, salt: number): number {
  return hashLattice(tx, ty, salt);
}

function pickSpot(set: WallDressingSet, roll: number): WallSpotKind | null {
  const total = set.spots.reduce((sum, spot) => sum + spot.weight, 0);
  if (total <= 0) return null;
  let remaining = roll * total;
  for (const spot of set.spots) {
    remaining -= spot.weight;
    if (remaining < 0) return spot.kind;
  }
  return set.spots[set.spots.length - 1]?.kind ?? null;
}

/**
 * Face coordinates: x across the tile 0..1, y down the two-tile face 0..2 with the
 * cap at {@link WALL_TOP_TILES} and the floor at 2. Sets the transform that maps
 * them onto this tile for the given face part.
 */
function enterFaceSpace(
  ctx: Ctx,
  part: Exclude<WallFacePart, 'none'>,
  sx: number,
  sy: number,
  ts: number,
): void {
  if (part === 'upper') {
    ctx.translate(sx, sy);
    ctx.scale(ts, ts);
  } else if (part === 'lower') {
    ctx.translate(sx, sy - ts);
    ctx.scale(ts, ts);
  } else {
    const squeeze = ts / (FACE_STRIP_ROWS - WALL_TOP_TILES);
    ctx.translate(sx, sy - WALL_TOP_TILES * squeeze);
    ctx.scale(ts, squeeze);
  }
}

/** One pixel at the game's tile size, in face units. */
const FACE_PX = 1 / TILE_SIZE;
const FACE_FLOOR = FACE_STRIP_ROWS;
const DRESSING_MARGIN = 0.14;

type Rand = () => number;

function seededRand(seed: number): Rand {
  let step = 0;
  return () => {
    step++;
    return hashLattice(step, seed, DRESSING_SHAPE_SALT);
  };
}

/** A draw in -1..1, for jitter either side of a centre. */
function signedRand(rand: Rand): number {
  return rand() * 2 - 1;
}

/** A position across the tile that keeps `width` clear of both dressing margins. */
function acrossFace(rand: Rand, width = 0): number {
  return DRESSING_MARGIN + rand() * (1 - DRESSING_MARGIN * 2 - width);
}

function clampAcross(x: number, margin: number): number {
  return Math.min(1 - margin, Math.max(margin, x));
}

const CRACK_DARK = 'rgba(8,6,4,0.62)';
const CRACK_LIGHT = 'rgba(255,240,215,0.14)';
const CRACK_SEGMENTS = 5;
/** How far below the cap a crack may start, in face tiles. */
const CRACK_START_SPREAD = 0.3;
const CRACK_MIN_LENGTH = 0.45;
const CRACK_LENGTH_SPREAD = 0.4;
const CRACK_JITTER = 0.09;
const CRACK_WIDTH = 1.2 * FACE_PX;

function drawCrack(ctx: Ctx, rand: Rand): void {
  const startX = acrossFace(rand);
  const startY = BODY_TOP_TILES + rand() * CRACK_START_SPREAD;
  const length = CRACK_MIN_LENGTH + rand() * CRACK_LENGTH_SPREAD;
  const points: Array<[number, number]> = [[startX, startY]];
  for (let i = 1; i <= CRACK_SEGMENTS; i++) {
    const [lastX] = points[points.length - 1];
    const x = clampAcross(lastX + signedRand(rand) * CRACK_JITTER, DRESSING_MARGIN);
    points.push([x, startY + (length * i) / CRACK_SEGMENTS]);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = CRACK_WIDTH;
  for (const [color, offset] of [
    [CRACK_LIGHT, FACE_PX],
    [CRACK_DARK, 0],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x + offset, y + offset);
      else ctx.lineTo(x + offset, y + offset);
    });
    ctx.stroke();
  }
}

const DAMP_COLOR: RGB = [18, 20, 14];
const DAMP_ALPHA = 0.34;
const DAMP_MIN_WIDTH = 0.28;
const DAMP_WIDTH_SPREAD = 0.3;
const DAMP_MIN_REACH = 1.1;
const DAMP_REACH_SPREAD = 0.3;

/** Seep from the cap down, darkest at the top: a tonal wash, never a speckle. */
function drawDamp(ctx: Ctx, rand: Rand): void {
  const width = DAMP_MIN_WIDTH + rand() * DAMP_WIDTH_SPREAD;
  const left = acrossFace(rand, width);
  const top = BODY_TOP_TILES;
  const bottom = Math.min(FACE_FLOOR, top + DAMP_MIN_REACH + rand() * DAMP_REACH_SPREAD);
  const vertical = ctx.createLinearGradient(0, top, 0, bottom);
  vertical.addColorStop(0, rgba(DAMP_COLOR, DAMP_ALPHA));
  vertical.addColorStop(1, rgba(DAMP_COLOR, TRANSPARENT));
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.ellipse(left + width / 2, top, width / 2, bottom - top, 0, 0, Math.PI);
  ctx.fill();
}

const MOSS_COLOR: RGB = [44, 58, 30];
const MOSS_ALPHA = 0.5;
const MOSS_CLUMPS = 4;
const MOSS_SPREAD = 0.25;
const MOSS_MIN_RADIUS_X = 0.08;
const MOSS_RADIUS_X_SPREAD = 0.1;
/** Clumps keep clear of a jamb at either end of the face, however wide they grow. */
const MOSS_EDGE_MARGIN = MOSS_MIN_RADIUS_X + MOSS_RADIUS_X_SPREAD + JAMB_CLEARANCE_TILES;
const MOSS_MIN_RADIUS_Y = 0.05;
const MOSS_RADIUS_Y_SPREAD = 0.08;
/** How much of a clump sits above the floor line; the rest is hidden behind the floor edge. */
const MOSS_SHOWING = 0.6;

function drawMoss(ctx: Ctx, rand: Rand): void {
  ctx.fillStyle = rgba(MOSS_COLOR, MOSS_ALPHA);
  const centre = acrossFace(rand);
  for (let i = 0; i < MOSS_CLUMPS; i++) {
    const x = clampAcross(centre + signedRand(rand) * MOSS_SPREAD, MOSS_EDGE_MARGIN);
    const radiusX = MOSS_MIN_RADIUS_X + rand() * MOSS_RADIUS_X_SPREAD;
    const radiusY = MOSS_MIN_RADIUS_Y + rand() * MOSS_RADIUS_Y_SPREAD;
    ctx.beginPath();
    ctx.ellipse(x, FACE_FLOOR - radiusY * MOSS_SHOWING, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ROOT_COLOR = 'rgba(28,20,12,0.9)';
const ROOT_MIN_COUNT = 2;
const ROOT_COUNT_SPREAD = 3;
const ROOT_CLUSTER_SPREAD = 0.15;
const ROOT_EDGE_MARGIN = 0.1;
const ROOT_MIN_LENGTH = 0.25;
const ROOT_LENGTH_SPREAD = 0.4;
const ROOT_STEPS = 4;
const ROOT_SWAY = 0.06;
const ROOT_SWAY_MARGIN = 0.05;
/** The first root is the thickest; each one after is thinner by this much. */
const ROOT_THICKEST_PX = 1.6;
const ROOT_TAPER_PX = 0.2;

/** Roots that have found their way through the joints under the cap and hang down the face. */
function drawRoots(ctx: Ctx, rand: Rand): void {
  const count = ROOT_MIN_COUNT + Math.floor(rand() * ROOT_COUNT_SPREAD);
  const clusterX = acrossFace(rand);
  ctx.strokeStyle = ROOT_COLOR;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = clampAcross(clusterX + signedRand(rand) * ROOT_CLUSTER_SPREAD, ROOT_EDGE_MARGIN);
    let y = BODY_TOP_TILES;
    const length = ROOT_MIN_LENGTH + rand() * ROOT_LENGTH_SPREAD;
    ctx.lineWidth = FACE_PX * (ROOT_THICKEST_PX - i * ROOT_TAPER_PX);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < ROOT_STEPS; step++) {
      x = clampAcross(x + signedRand(rand) * ROOT_SWAY, ROOT_SWAY_MARGIN);
      y += length / ROOT_STEPS;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const CHAIN_IRON = 'rgba(30,28,27,1)';
const CHAIN_HIGHLIGHT = 'rgba(120,112,100,0.8)';
const CHAIN_LINKS = 5;
const CHAIN_LINK_LENGTH = 0.09;
const CHAIN_LINK_WIDTH = 0.045;
/** Links overlap, so each hangs this share of a link's length below the last. */
const CHAIN_LINK_PITCH = 0.85;
/** A link seen edge-on shows this share of its width. */
const CHAIN_EDGE_ON_WIDTH = 0.4;
const CHAIN_BOLT_Y = BODY_TOP_TILES + 0.3;
const CHAIN_BOLT_RADIUS = 0.05;
const CHAIN_BOLT_TO_FIRST_LINK = 0.06;
const CHAIN_MIN_X = 0.3;
const CHAIN_X_SPREAD = 0.4;
const CHAIN_WIDTH = 1.2 * FACE_PX;
/** The glint on a link: its left side, over the link's middle stretch. */
const CHAIN_GLINT_TOP = 0.3;
const CHAIN_GLINT_BOTTOM = 0.5;

/** A ring bolt and a short length of chain: an old restraint, left on the wall. */
function drawChain(ctx: Ctx, rand: Rand): void {
  drawChainLength(ctx, CHAIN_MIN_X + rand() * CHAIN_X_SPREAD, CHAIN_BOLT_Y, CHAIN_LINKS);
}

/** A wall bolt and `links` links of chain hanging from it; returns where the chain ends. */
function drawChainLength(ctx: Ctx, x: number, boltY: number, links: number): number {
  ctx.fillStyle = CHAIN_IRON;
  ctx.beginPath();
  ctx.arc(x, boltY, CHAIN_BOLT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = CHAIN_WIDTH;
  const linkStep = CHAIN_LINK_LENGTH * CHAIN_LINK_PITCH;
  for (let link = 0; link < links; link++) {
    const y = boltY + CHAIN_BOLT_TO_FIRST_LINK + link * linkStep;
    const faceOn = link % 2 === 0;
    const halfWidth = (CHAIN_LINK_WIDTH / 2) * (faceOn ? 1 : CHAIN_EDGE_ON_WIDTH);
    ctx.strokeStyle = CHAIN_IRON;
    ctx.beginPath();
    ctx.ellipse(x, y + CHAIN_LINK_LENGTH / 2, halfWidth, CHAIN_LINK_LENGTH / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = CHAIN_HIGHLIGHT;
    ctx.beginPath();
    ctx.moveTo(x - halfWidth / 2, y + CHAIN_LINK_LENGTH * CHAIN_GLINT_TOP);
    ctx.lineTo(x - halfWidth / 2, y + CHAIN_LINK_LENGTH * CHAIN_GLINT_BOTTOM);
    ctx.stroke();
  }
  return boltY + CHAIN_BOLT_TO_FIRST_LINK + (links - 1) * linkStep + CHAIN_LINK_LENGTH;
}

const STAIN_COLOR: RGB = [92, 58, 28];
const STAIN_ALPHA = 0.3;
const STAIN_MIN_WIDTH = 0.08;
const STAIN_WIDTH_SPREAD = 0.1;
const STAIN_MIN_REACH = 0.6;
const STAIN_REACH_SPREAD = 0.6;

/** A rust run from something leaking behind the cap. */
function drawStain(ctx: Ctx, rand: Rand): void {
  const width = STAIN_MIN_WIDTH + rand() * STAIN_WIDTH_SPREAD;
  const left = acrossFace(rand, width);
  const top = BODY_TOP_TILES;
  const bottom = top + STAIN_MIN_REACH + rand() * STAIN_REACH_SPREAD;
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, rgba(STAIN_COLOR, STAIN_ALPHA));
  gradient.addColorStop(1, rgba(STAIN_COLOR, TRANSPARENT));
  ctx.fillStyle = gradient;
  ctx.fillRect(left, top, width, bottom - top);
}

const CONDUIT_METAL = 'rgba(92,98,100,1)';
const CONDUIT_HIGHLIGHT = 'rgba(150,158,160,1)';
const CONDUIT_SHADOW = 'rgba(0,0,0,0.45)';
const CONDUIT_WIDTH = 2 * FACE_PX;
const CONDUIT_MIN_X = 0.25;
const CONDUIT_X_SPREAD = 0.5;
const JUNCTION_BOX_WIDTH = 0.26;
const JUNCTION_BOX_HEIGHT = 0.22;
const JUNCTION_BOX_Y = BODY_TOP_TILES + 0.55;
const JUNCTION_BOX_METAL = 'rgba(78,84,86,1)';

/** Conduit dropping from the ceiling to a junction box. */
function drawConduit(ctx: Ctx, rand: Rand): void {
  const x = CONDUIT_MIN_X + rand() * CONDUIT_X_SPREAD;
  const drop = JUNCTION_BOX_Y - BODY_TOP_TILES;
  ctx.fillStyle = CONDUIT_SHADOW;
  ctx.fillRect(x + CONDUIT_WIDTH, BODY_TOP_TILES, FACE_PX, drop);
  ctx.fillStyle = CONDUIT_METAL;
  ctx.fillRect(x, BODY_TOP_TILES, CONDUIT_WIDTH, drop);
  ctx.fillStyle = CONDUIT_HIGHLIGHT;
  ctx.fillRect(x, BODY_TOP_TILES, FACE_PX, drop);
  const boxLeft = x + CONDUIT_WIDTH / 2 - JUNCTION_BOX_WIDTH / 2;
  ctx.fillStyle = CONDUIT_SHADOW;
  ctx.fillRect(
    boxLeft + FACE_PX,
    JUNCTION_BOX_Y + FACE_PX,
    JUNCTION_BOX_WIDTH,
    JUNCTION_BOX_HEIGHT,
  );
  ctx.fillStyle = JUNCTION_BOX_METAL;
  ctx.fillRect(boxLeft, JUNCTION_BOX_Y, JUNCTION_BOX_WIDTH, JUNCTION_BOX_HEIGHT);
  ctx.fillStyle = CONDUIT_HIGHLIGHT;
  ctx.fillRect(boxLeft, JUNCTION_BOX_Y, JUNCTION_BOX_WIDTH, FACE_PX);
}

/**
 * How far below the cap a pipe run hangs. Well down the face, on brackets: a pipe
 * just under the cap reads as a handrail along the top of the wall.
 */
const PIPE_DROP_TILES = 0.42;
const PIPE_Y = BODY_TOP_TILES + PIPE_DROP_TILES;
const PIPE_THICKNESS = 4 * FACE_PX;
const PIPE_METAL = 'rgba(70,76,80,1)';
const PIPE_HIGHLIGHT = 'rgba(132,140,144,1)';
const PIPE_SHADOW = 'rgba(0,0,0,0.45)';
const PIPE_SHADOW_DEPTH = 2 * FACE_PX;
const PIPE_BRACKET = 'rgba(30,32,34,1)';
const PIPE_BRACKET_WIDTH = 2 * FACE_PX;
const PIPE_BRACKET_X = 0.5;
/** Where a run stops short of a jamb or turns up into the ceiling, in tiles from the tile edge. */
const PIPE_RISER_X = 0.3;

/** How a pipe run ends at one side of a tile. */
type PipeEnd = 'continues' | 'jamb' | 'riser';

/**
 * A length of pipe across the face. Where a run ends mid-face it turns up and
 * disappears over the cap, rather than stopping in the air.
 */
function drawPipe(ctx: Ctx, west: PipeEnd, east: PipeEnd): void {
  const left = west === 'continues' ? 0 : west === 'jamb' ? JAMB_CLEARANCE_TILES : PIPE_RISER_X;
  const right =
    east === 'continues' ? 1 : east === 'jamb' ? 1 - JAMB_CLEARANCE_TILES : 1 - PIPE_RISER_X;
  ctx.fillStyle = PIPE_SHADOW;
  ctx.fillRect(left, PIPE_Y + PIPE_THICKNESS, right - left, PIPE_SHADOW_DEPTH);
  ctx.fillStyle = PIPE_METAL;
  ctx.fillRect(left, PIPE_Y, right - left, PIPE_THICKNESS);
  for (const [end, x] of [
    [west, left],
    [east, right - PIPE_THICKNESS],
  ] as const) {
    if (end !== 'riser') continue;
    ctx.fillStyle = PIPE_SHADOW;
    ctx.fillRect(x + PIPE_THICKNESS, WALL_TOP_TILES, PIPE_SHADOW_DEPTH, PIPE_Y - WALL_TOP_TILES);
    ctx.fillStyle = PIPE_METAL;
    ctx.fillRect(x, WALL_TOP_TILES, PIPE_THICKNESS, PIPE_Y - WALL_TOP_TILES);
    ctx.fillStyle = PIPE_HIGHLIGHT;
    ctx.fillRect(x, WALL_TOP_TILES, FACE_PX, PIPE_Y - WALL_TOP_TILES);
  }
  ctx.fillStyle = PIPE_HIGHLIGHT;
  ctx.fillRect(left, PIPE_Y, right - left, FACE_PX);
  ctx.fillStyle = PIPE_BRACKET;
  ctx.fillRect(
    PIPE_BRACKET_X,
    PIPE_Y - FACE_PX,
    PIPE_BRACKET_WIDTH,
    PIPE_THICKNESS + PIPE_SHADOW_DEPTH,
  );
}

function hasPipeRun(dressing: WallDressingSet, tx: number, row: number): boolean {
  const runIndex = Math.floor(tx / PIPE_RUN_TILES);
  return tileHash(runIndex, row, DRESSING_PIPE_SALT) < dressing.pipeRunChance;
}

/**
 * How a run ends at one side of a tile: at a jamb where the face turns away, on
 * into the next tile only if that tile is face carrying the same run, and
 * otherwise — the end of the run, or a back corner — up over the cap.
 */
function pipeEnd(
  open: boolean,
  neighbour: NeighbourFace | null,
  shape: WallShape,
  neighbourX: number,
  faceRow: number,
): PipeEnd {
  if (open) return 'jamb';
  if (neighbour === null || !continuesInto(shape, neighbour)) return 'riser';
  return hasPipeRun(neighbour.dressing, neighbourX, faceRow) ? 'continues' : 'riser';
}

/** The wall tile beside a face tile: which part of a face it carries, and its own dressing. */
export interface NeighbourFace {
  readonly face: WallFacePart;
  readonly dressing: WallDressingSet;
}

/**
 * Whether the face runs on into the tile beside: that tile carries the same part
 * of a face at the same height. A squeezed face beside a full one does not count —
 * anything running along the full one would have to step.
 */
function continuesInto(shape: WallShape, neighbour: NeighbourFace | null): boolean {
  return neighbour !== null && neighbour.face === shape.face;
}

// ── what a room hangs on its walls ─────────────────────────────────────────

/** The shadow a fitting throws on the face just below and right of it. */
const CAST_SHADOW = 'rgba(0,0,0,0.42)';

const NICHE_WIDTH = 0.5;
const NICHE_TOP = BODY_TOP_TILES + 0.34;
const NICHE_HEIGHT = 0.6;
const NICHE_DARK = 'rgba(6,5,4,0.85)';
const NICHE_SILL = 'rgba(140,124,100,0.9)';
const NICHE_SILL_TILES = 0.05;
const NICHE_X_JITTER = 0.08;
const SKULL_BONE: RGB = [190, 180, 154];
const SKULL_SHADOW: RGB = [96, 88, 72];
const SKULL_RADIUS = 0.12;
const SKULL_EYE_RADIUS = 0.028;
const SKULL_EYE_SPREAD = 0.04;
const SKULL_JAW_WIDTH = 0.1;
const SKULL_JAW_HEIGHT = 0.05;
/** The jaw shows from this share of the skull's radius below its centre. */
const SKULL_JAW_START = 0.6;
/** Recesses are centred on the tile, give or take this much. */
const TILE_CENTRE = 0.5;
const EYE_DARK = 'rgba(10,8,6,1)';

/** An arched recess cut into the face, with a skull set on its sill. */
function drawSkullNiche(ctx: Ctx, rand: Rand): void {
  const centre = TILE_CENTRE + signedRand(rand) * NICHE_X_JITTER;
  const left = centre - NICHE_WIDTH / 2;
  const archRadius = NICHE_WIDTH / 2;
  const sillY = NICHE_TOP + NICHE_HEIGHT;
  ctx.fillStyle = NICHE_DARK;
  ctx.beginPath();
  ctx.moveTo(left, sillY);
  ctx.lineTo(left, NICHE_TOP + archRadius);
  ctx.arc(centre, NICHE_TOP + archRadius, archRadius, Math.PI, 0);
  ctx.lineTo(left + NICHE_WIDTH, sillY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = NICHE_SILL;
  ctx.fillRect(left, sillY, NICHE_WIDTH, NICHE_SILL_TILES);

  const skullY = sillY - SKULL_RADIUS - SKULL_JAW_HEIGHT;
  ctx.fillStyle = rgba(SKULL_SHADOW, 1);
  const jawTop = skullY + SKULL_RADIUS * SKULL_JAW_START;
  ctx.fillRect(
    centre - SKULL_JAW_WIDTH / 2,
    jawTop,
    SKULL_JAW_WIDTH,
    skullY + SKULL_RADIUS + SKULL_JAW_HEIGHT - jawTop,
  );
  ctx.fillStyle = rgba(SKULL_BONE, 1);
  ctx.beginPath();
  ctx.arc(centre, skullY, SKULL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = EYE_DARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(centre + side * SKULL_EYE_SPREAD, skullY + FACE_PX, SKULL_EYE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

const CASK_WOOD: RGB = [92, 62, 36];
const CASK_END: RGB = [118, 84, 50];
const CASK_HOOP = 'rgba(28,24,22,0.9)';
const CASK_RADIUS = 0.17;
const CASK_CENTRES: ReadonlyArray<number> = [0.28, 0.72];
const CASK_RAIL_TILES = 0.06;
/** The inner hoop, as a share of the cask's radius. */
const CASK_INNER_HOOP = 0.55;
const CASK_HOOP_PX = 2;

/** Two cask ends racked at the foot of the wall, on a timber rail. */
function drawCaskRack(ctx: Ctx): void {
  const caskY = FACE_FLOOR - CASK_RADIUS - CASK_RAIL_TILES;
  ctx.fillStyle = rgba(CASK_WOOD, 1);
  ctx.fillRect(0, FACE_FLOOR - CASK_RAIL_TILES, 1, CASK_RAIL_TILES);
  for (const x of CASK_CENTRES) {
    ctx.fillStyle = rgba(CASK_END, 1);
    ctx.beginPath();
    ctx.arc(x, caskY, CASK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CASK_HOOP;
    ctx.lineWidth = CASK_HOOP_PX * FACE_PX;
    ctx.stroke();
    ctx.lineWidth = FACE_PX;
    ctx.beginPath();
    ctx.arc(x, caskY, CASK_RADIUS * CASK_INNER_HOOP, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const BANNER_CLOTH: RGB = [104, 30, 26];
const BANNER_FOLD = 'rgba(0,0,0,0.3)';
const BANNER_ROD = 'rgba(34,28,22,1)';
const BANNER_WIDTH = 0.5;
const BANNER_MIN_LENGTH = 0.8;
const BANNER_LENGTH_SPREAD = 0.3;
const BANNER_TEARS = 4;
const BANNER_TEAR_DEPTH = 0.16;
const BANNER_FOLDS: ReadonlyArray<number> = [0.33, 0.66];

/** A cloth banner hung from a rod under the cap, its hem torn ragged. */
function drawBanner(ctx: Ctx, rand: Rand): void {
  const left = TILE_CENTRE - BANNER_WIDTH / 2;
  const top = BODY_TOP_TILES + FACE_PX * 2;
  const length = BANNER_MIN_LENGTH + rand() * BANNER_LENGTH_SPREAD;
  ctx.fillStyle = rgba(BANNER_CLOTH, 1);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + BANNER_WIDTH, top);
  for (let tear = BANNER_TEARS; tear >= 0; tear--) {
    const x = left + (BANNER_WIDTH * tear) / BANNER_TEARS;
    ctx.lineTo(x, top + length - rand() * BANNER_TEAR_DEPTH);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BANNER_FOLD;
  for (const fold of BANNER_FOLDS) {
    ctx.fillRect(left + BANNER_WIDTH * fold, top, FACE_PX, length * fold + BANNER_TEAR_DEPTH);
  }
  ctx.fillStyle = BANNER_ROD;
  ctx.fillRect(left - FACE_PX * 2, top - FACE_PX, BANNER_WIDTH + FACE_PX * 4, FACE_PX * 2);
}

const SHACKLE_BOLT_XS: ReadonlyArray<number> = [0.3, 0.7];
const SHACKLE_LINKS = 4;
const SHACKLE_CUFF_RADIUS = 0.075;

/** A pair of short chains from wall bolts, each ending in an open cuff. */
function drawShackles(ctx: Ctx): void {
  for (const x of SHACKLE_BOLT_XS) {
    const chainEnd = drawChainLength(ctx, x, CHAIN_BOLT_Y, SHACKLE_LINKS);
    ctx.strokeStyle = CHAIN_IRON;
    ctx.lineWidth = 2 * FACE_PX;
    ctx.beginPath();
    ctx.arc(x, chainEnd + SHACKLE_CUFF_RADIUS, SHACKLE_CUFF_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const PANEL_WIDTH = 0.5;
const PANEL_HEIGHT = 0.55;
const PANEL_TOP = BODY_TOP_TILES + 0.3;
const PANEL_METAL: RGB = [88, 94, 96];
const PANEL_SEAM = 'rgba(20,22,24,0.9)';
const PANEL_HIGHLIGHT: RGB = [140, 146, 148];
const PANEL_LABEL: RGB = [168, 140, 40];
const PANEL_LABEL_TILES = 0.06;
const PANEL_INSET = 0.05;

/** A grey breaker panel: door seam, handle and a yellow warning label. */
function drawBreakerPanel(ctx: Ctx, rand: Rand): void {
  const left = acrossFace(rand, PANEL_WIDTH);
  ctx.fillStyle = CAST_SHADOW;
  ctx.fillRect(left + FACE_PX, PANEL_TOP + FACE_PX * 2, PANEL_WIDTH, PANEL_HEIGHT);
  ctx.fillStyle = rgba(PANEL_METAL, 1);
  ctx.fillRect(left, PANEL_TOP, PANEL_WIDTH, PANEL_HEIGHT);
  ctx.fillStyle = rgba(PANEL_HIGHLIGHT, 1);
  ctx.fillRect(left, PANEL_TOP, PANEL_WIDTH, FACE_PX);
  ctx.strokeStyle = PANEL_SEAM;
  ctx.lineWidth = FACE_PX;
  ctx.strokeRect(
    left + PANEL_INSET,
    PANEL_TOP + PANEL_INSET,
    PANEL_WIDTH - PANEL_INSET * 2,
    PANEL_HEIGHT - PANEL_INSET * 2,
  );
  ctx.fillStyle = rgba(PANEL_LABEL, 1);
  ctx.fillRect(
    left + PANEL_INSET * 2,
    PANEL_TOP + PANEL_INSET * 2,
    PANEL_WIDTH / 2,
    PANEL_LABEL_TILES,
  );
  ctx.fillStyle = PANEL_SEAM;
  ctx.fillRect(
    left + PANEL_WIDTH - PANEL_INSET * 2,
    PANEL_TOP + PANEL_HEIGHT / 2,
    FACE_PX * 2,
    PANEL_INSET,
  );
}

const SHELF_Y = BODY_TOP_TILES + 0.6;
const SHELF_WOOD: RGB = [70, 64, 58];
const BINDER_HEIGHT = 0.24;
const BINDER_WIDTH = 0.08;
const BINDER_COLOURS: ReadonlyArray<RGB> = [
  [70, 82, 104],
  [104, 74, 58],
  [92, 92, 70],
  [64, 84, 72],
];
const BINDER_MIN_COUNT = 4;
const BINDER_COUNT_SPREAD = 3;
const BINDER_START = 0.14;
/** Binders are not all one height; the shortest is this much shorter. */
const BINDER_HEIGHT_SPREAD = 0.08;

/** A wall shelf of box files and binders. */
function drawBinderShelf(ctx: Ctx, rand: Rand): void {
  const count = BINDER_MIN_COUNT + Math.floor(rand() * BINDER_COUNT_SPREAD);
  for (let i = 0; i < count; i++) {
    const colour = BINDER_COLOURS[Math.floor(rand() * BINDER_COLOURS.length)] ?? BINDER_COLOURS[0];
    const height = BINDER_HEIGHT * (1 - rand() * BINDER_HEIGHT_SPREAD);
    ctx.fillStyle = rgba(colour, 1);
    ctx.fillRect(
      BINDER_START + i * (BINDER_WIDTH + FACE_PX),
      SHELF_Y - height,
      BINDER_WIDTH,
      height,
    );
  }
  ctx.fillStyle = rgba(SHELF_WOOD, 1);
  ctx.fillRect(DRESSING_MARGIN / 2, SHELF_Y, 1 - DRESSING_MARGIN, FACE_PX * 2);
  ctx.fillStyle = CAST_SHADOW;
  ctx.fillRect(DRESSING_MARGIN / 2, SHELF_Y + FACE_PX * 2, 1 - DRESSING_MARGIN, FACE_PX * 2);
}

const BOARD_WIDTH = 0.72;
const BOARD_HEIGHT = 0.46;
const BOARD_TOP = BODY_TOP_TILES + 0.28;
const BOARD_CORK: RGB = [116, 86, 54];
const BOARD_FRAME: RGB = [58, 46, 34];
const PAPER: RGB = [184, 180, 164];
const PAPER_WIDTH = 0.16;
const PAPER_HEIGHT = 0.2;
const PAPER_COUNT = 3;
const PIN = 'rgba(160,40,30,1)';

/** A cork notice board with a few curling notices pinned to it. */
function drawNoticeBoard(ctx: Ctx, rand: Rand): void {
  const left = TILE_CENTRE - BOARD_WIDTH / 2;
  ctx.fillStyle = rgba(BOARD_FRAME, 1);
  ctx.fillRect(
    left - FACE_PX,
    BOARD_TOP - FACE_PX,
    BOARD_WIDTH + FACE_PX * 2,
    BOARD_HEIGHT + FACE_PX * 2,
  );
  ctx.fillStyle = rgba(BOARD_CORK, 1);
  ctx.fillRect(left, BOARD_TOP, BOARD_WIDTH, BOARD_HEIGHT);
  for (let i = 0; i < PAPER_COUNT; i++) {
    const x = left + FACE_PX * 2 + rand() * (BOARD_WIDTH - PAPER_WIDTH - FACE_PX * 4);
    const y = BOARD_TOP + FACE_PX * 2 + rand() * (BOARD_HEIGHT - PAPER_HEIGHT - FACE_PX * 4);
    ctx.fillStyle = rgba(PAPER, 1);
    ctx.fillRect(x, y, PAPER_WIDTH, PAPER_HEIGHT);
    ctx.fillStyle = PIN;
    ctx.fillRect(x + PAPER_WIDTH / 2, y, FACE_PX * 1.5, FACE_PX * 1.5);
  }
}

const MONITOR_WIDTH = 0.62;
const MONITOR_HEIGHT = 0.42;
const MONITOR_TOP = BODY_TOP_TILES + 0.22;
const MONITOR_BEZEL: RGB = [30, 32, 34];
const MONITOR_SCREEN: RGB = [24, 44, 40];
const MONITOR_GLOW = 'rgba(96,170,140,0.18)';
const MONITOR_BEZEL_TILES = 0.035;
const MONITOR_BRACKET_HEIGHT = 0.08;

/** A dead wall monitor on a bracket, its screen holding a faint green cast. */
function drawMonitor(ctx: Ctx, rand: Rand): void {
  const left = acrossFace(rand, MONITOR_WIDTH);
  ctx.fillStyle = rgba(MONITOR_BEZEL, 1);
  ctx.fillRect(
    left + MONITOR_WIDTH / 2 - FACE_PX,
    MONITOR_TOP + MONITOR_HEIGHT,
    FACE_PX * 2,
    MONITOR_BRACKET_HEIGHT,
  );
  ctx.fillRect(left, MONITOR_TOP, MONITOR_WIDTH, MONITOR_HEIGHT);
  ctx.fillStyle = rgba(MONITOR_SCREEN, 1);
  ctx.fillRect(
    left + MONITOR_BEZEL_TILES,
    MONITOR_TOP + MONITOR_BEZEL_TILES,
    MONITOR_WIDTH - MONITOR_BEZEL_TILES * 2,
    MONITOR_HEIGHT - MONITOR_BEZEL_TILES * 2,
  );
  ctx.fillStyle = MONITOR_GLOW;
  ctx.fillRect(
    left + MONITOR_BEZEL_TILES,
    MONITOR_TOP + MONITOR_BEZEL_TILES,
    MONITOR_WIDTH - MONITOR_BEZEL_TILES * 2,
    (MONITOR_HEIGHT - MONITOR_BEZEL_TILES * 2) / 2,
  );
}

// ── runs ───────────────────────────────────────────────────────────────────

const CAGE_TOP = BODY_TOP_TILES + 0.12;
const CAGE_BOTTOM = FACE_FLOOR - 0.04;
const CAGE_INTERIOR = 'rgba(0,0,0,0.5)';
const CAGE_IRON: RGB = [36, 34, 32];
const CAGE_IRON_LIGHT: RGB = [92, 86, 80];
const CAGE_BARS_PER_TILE = 3;
const CAGE_BAR_WIDTH = 2 * FACE_PX;
const CAGE_BAND_HEIGHT = 3 * FACE_PX;

/** Iron bars set into the face, the dark of a cell behind them. */
function drawCageBars(ctx: Ctx, left: number, right: number): void {
  ctx.fillStyle = CAGE_INTERIOR;
  ctx.fillRect(left, CAGE_TOP, right - left, CAGE_BOTTOM - CAGE_TOP);
  for (let bar = 0; bar < CAGE_BARS_PER_TILE; bar++) {
    const x = (bar + TILE_CENTRE) / CAGE_BARS_PER_TILE - CAGE_BAR_WIDTH / 2;
    if (x < left || x + CAGE_BAR_WIDTH > right) continue;
    ctx.fillStyle = rgba(CAGE_IRON, 1);
    ctx.fillRect(x, CAGE_TOP, CAGE_BAR_WIDTH, CAGE_BOTTOM - CAGE_TOP);
    ctx.fillStyle = rgba(CAGE_IRON_LIGHT, 1);
    ctx.fillRect(x, CAGE_TOP, FACE_PX, CAGE_BOTTOM - CAGE_TOP);
  }
  ctx.fillStyle = rgba(CAGE_IRON, 1);
  ctx.fillRect(left, CAGE_TOP, right - left, CAGE_BAND_HEIGHT);
  ctx.fillRect(left, CAGE_BOTTOM - CAGE_BAND_HEIGHT, right - left, CAGE_BAND_HEIGHT);
}

const LOCKER_TOP = BODY_TOP_TILES + 0.1;
/** Lockers stand on the floor, over the skirting. */
const LOCKER_BOTTOM = FACE_FLOOR;
const LOCKERS_PER_TILE = 2;
const LOCKER_METAL: RGB = [74, 88, 98];
const LOCKER_SEAM = 'rgba(16,20,24,0.95)';
const LOCKER_TOP_LIGHT: RGB = [120, 134, 142];
const LOCKER_VENTS = 3;
const LOCKER_VENT_TOP = 0.08;
const LOCKER_VENT_PITCH = 0.05;
/** Vents span this share of a door's width. */
const LOCKER_VENT_WIDTH = 0.6;
const LOCKER_HANDLE_Y = 0.55;
/** The handle sits toward the door's opening edge. */
const LOCKER_HANDLE_X = 0.25;

/** A bank of steel lockers along the wall, two to a tile. */
function drawLockers(ctx: Ctx, left: number, right: number): void {
  const height = LOCKER_BOTTOM - LOCKER_TOP;
  ctx.fillStyle = rgba(LOCKER_METAL, 1);
  ctx.fillRect(left, LOCKER_TOP, right - left, height);
  ctx.fillStyle = rgba(LOCKER_TOP_LIGHT, 1);
  ctx.fillRect(left, LOCKER_TOP, right - left, FACE_PX);
  const doorWidth = 1 / LOCKERS_PER_TILE;
  ctx.fillStyle = LOCKER_SEAM;
  for (let door = 0; door < LOCKERS_PER_TILE; door++) {
    const doorLeft = door * doorWidth;
    if (doorLeft >= left && doorLeft < right) ctx.fillRect(doorLeft, LOCKER_TOP, FACE_PX, height);
    const centre = doorLeft + doorWidth / 2;
    if (centre < left || centre > right) continue;
    for (let vent = 0; vent < LOCKER_VENTS; vent++) {
      const y = LOCKER_TOP + LOCKER_VENT_TOP + vent * LOCKER_VENT_PITCH;
      const ventWidth = doorWidth * LOCKER_VENT_WIDTH;
      ctx.fillRect(centre - ventWidth / 2, y, ventWidth, FACE_PX);
    }
    ctx.fillRect(
      centre + doorWidth * LOCKER_HANDLE_X,
      LOCKER_TOP + height * LOCKER_HANDLE_Y,
      FACE_PX * 2,
      FACE_PX * 3,
    );
  }
}

// ── cobwebs ────────────────────────────────────────────────────────────────

const WEB = 'rgba(214,214,206,0.32)';
const WEB_RADIUS = 0.38;
const WEB_SPOKES = 4;
const WEB_RINGS: ReadonlyArray<number> = [0.4, 0.7, 1];

/** A web strung across the top corner where a face meets whatever ends it. */
function drawCornerCobweb(ctx: Ctx, side: Side): void {
  const cornerX = side === 'west' ? 0 : 1;
  const inward = side === 'west' ? 1 : -1;
  const cornerY = BODY_TOP_TILES;
  ctx.strokeStyle = WEB;
  ctx.lineWidth = FACE_PX;
  const spokeEnd = (spoke: number, reach: number): [number, number] => {
    const angle = (spoke / (WEB_SPOKES - 1)) * (Math.PI / 2);
    return [cornerX + inward * Math.cos(angle) * reach, cornerY + Math.sin(angle) * reach];
  };
  ctx.beginPath();
  for (let spoke = 0; spoke < WEB_SPOKES; spoke++) {
    const [x, y] = spokeEnd(spoke, WEB_RADIUS);
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(x, y);
  }
  for (const ring of WEB_RINGS) {
    for (let spoke = 0; spoke < WEB_SPOKES; spoke++) {
      const [x, y] = spokeEnd(spoke, WEB_RADIUS * ring);
      if (spoke === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

// ── the dressing pass ──────────────────────────────────────────────────────

/** How much of the tile a run fitting covers: clear of a jamb on either open side. */
function runExtent(shape: WallShape): { readonly left: number; readonly right: number } {
  return {
    left: shape.openW ? JAMB_CLEARANCE_TILES : 0,
    right: shape.openE ? 1 - JAMB_CLEARANCE_TILES : 1,
  };
}

/**
 * Draws a face tile's dressing. `faceRow` is the row of the face's lower tile,
 * which both halves of a face seed from.
 */
export function drawDressing(
  ctx: Ctx,
  shape: WallShape,
  faceRow: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  dressing: WallDressingSet,
  west: NeighbourFace | null,
  east: NeighbourFace | null,
): void {
  const part = shape.face;
  if (part === 'none') return;
  const hasSpot = tileHash(tx, faceRow, DRESSING_SPOT_SALT) < dressing.spotChance;
  const spot = hasSpot ? pickSpot(dressing, tileHash(tx, faceRow, DRESSING_KIND_SALT)) : null;
  const hasPipe = hasPipeRun(dressing, tx, faceRow);
  const westEnds = !continuesInto(shape, west);
  const eastEnds = !continuesInto(shape, east);
  const hasWeb = dressing.cornerCobwebs && (westEnds || eastEnds);
  if (spot === null && !hasPipe && dressing.run === null && !hasWeb) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  enterFaceSpace(ctx, part, sx, sy, ts);
  const extent = runExtent(shape);
  if (dressing.run === 'cage_bars') drawCageBars(ctx, extent.left, extent.right);
  if (dressing.run === 'lockers') drawLockers(ctx, extent.left, extent.right);
  if (hasPipe) {
    drawPipe(
      ctx,
      pipeEnd(shape.openW, west, shape, tx - 1, faceRow),
      pipeEnd(shape.openE, east, shape, tx + 1, faceRow),
    );
  }
  const rand = seededRand(
    Math.floor(tileHash(tx, faceRow, DRESSING_SHAPE_SALT) * DRESSING_SEED_RANGE),
  );
  switch (spot) {
    case 'crack':
      drawCrack(ctx, rand);
      break;
    case 'damp':
      drawDamp(ctx, rand);
      break;
    case 'moss':
      drawMoss(ctx, rand);
      break;
    case 'roots':
      drawRoots(ctx, rand);
      break;
    case 'chain':
      drawChain(ctx, rand);
      break;
    case 'stain':
      drawStain(ctx, rand);
      break;
    case 'conduit':
      drawConduit(ctx, rand);
      break;
    case 'skull_niche':
      drawSkullNiche(ctx, rand);
      break;
    case 'cask_rack':
      drawCaskRack(ctx);
      break;
    case 'banner':
      drawBanner(ctx, rand);
      break;
    case 'shackles':
      drawShackles(ctx);
      break;
    case 'breaker_panel':
      drawBreakerPanel(ctx, rand);
      break;
    case 'binder_shelf':
      drawBinderShelf(ctx, rand);
      break;
    case 'notice_board':
      drawNoticeBoard(ctx, rand);
      break;
    case 'monitor':
      drawMonitor(ctx, rand);
      break;
    case null:
      break;
  }
  if (hasWeb && westEnds) drawCornerCobweb(ctx, 'west');
  if (hasWeb && eastEnds) drawCornerCobweb(ctx, 'east');
  ctx.restore();
}
