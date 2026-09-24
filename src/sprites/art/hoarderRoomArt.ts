/**
 * Every painted picture in the Hoarder's lair: the junk piles, the teetering
 * towers and their falls, the garbage bags, the linoleum floor and its filth,
 * the mattress she sleeps on and the junk that slides across the door.
 *
 * All of it is composed from `hoarderJunkKit.ts`, so a heap in the corner, the
 * tower beside it and the barricade in the doorway read as one household's
 * worth of the same boxes, bundles and bags. Painters receive the anchor
 * tile's top-left corner in sheet pixels at {@link JUNK_TILE_PX} per tile.
 */

import { mulberry32, type Rng } from '../person/rng';
import {
  BLACK_BAG,
  BLUE_BAG,
  BROOM_HANDLE,
  BROWN_GLASS,
  BROWN_SACK,
  CLEAR_GLASS,
  CURTAIN_ROD,
  GREEN_GLASS,
  JUNK_OUTLINE,
  JUNK_TILE_PX,
  WHITE_BAG,
  WOOD_LEG,
  bag,
  bottle,
  box,
  bundle,
  can,
  container,
  contactShadow,
  drawJunk,
  dustPuff,
  dustSpecks,
  lampshade,
  lit,
  looseSheet,
  mix,
  mound,
  moundHeightAt,
  moundProfile,
  joinedMoundProfile,
  upturnedChair,
  pictureFrame,
  stick,
  teddy,
  tilted,
  transformed,
  tyre,
  withAlpha,
  type ContainerKind,
  type JunkItem,
} from './hoarderJunkKit';

const T = JUNK_TILE_PX;
const HALF = 0.5;
const QUARTER = 0.25;
const TWO_PI = Math.PI * 2;
const DEGREES_PER_HALF_TURN = 180;
const toRadians = (degrees: number): number => (degrees * Math.PI) / DEGREES_PER_HALF_TURN;

/** Where every standing thing in the lair meets the floor, down from its tile's top. */
const GROUND_Y = 58;
const TILE_MIDDLE_X = T * HALF;
/** Where contact shadows are centred: low enough to pool under a foot, high enough to stay in the tile. */
const SHADOW_Y = GROUND_Y;

/** Fixed seeds, so a pile painted today is the pile reviewed yesterday. */
const PILE_SEED = 0x51e7;
const TOWER_SEED = 0x70e3;
const BAG_SEED = 0xba61;
const FLOOR_SEED = 0xf100;
const NEST_SEED = 0x7e57;
const BARRICADE_SEED = 0xbac1;

// ── Piles ────────────────────────────────────────────────────────────────────

export const HOARD_PILE_VARIANTS = 4;
export const PILE_RUSTLE_FRAMES = 3;

/** Keeps every heap's ink inside the tile it blocks. */
/**
 * The mound runs to its tile's edges, so heaps on neighbouring tiles meet and
 * read as one heap along the wall rather than a row of little ones. The items
 * on it keep further in.
 */
const PILE_SIDE_INSET = 1;
/** Variants with something long sticking up out of them; the rest are all heap. */
const PILE_SPIKED_VARIANTS: ReadonlySet<number> = new Set([0, 2]);
/** Things half sunk into the heap, spread over its surface. */
const PILE_SURFACE_ITEMS = 7;
/** How deep into the heap's surface an item's base is buried, as a share of the surface height. */
const PILE_BURY_MIN = 0.05;
const PILE_BURY_SPAN = 0.45;
/** The most any one thing in a heap is knocked off level. */
const PILE_MAX_TILT_DEGREES = 22;

/** One accent per variant, so four piles in a row are four different piles. */
type PileAccent = 'lampshade' | 'teddy' | 'tyre' | 'broom';
const PILE_ACCENTS: readonly PileAccent[] = ['lampshade', 'teddy', 'tyre', 'broom'];
const FRONT_BAG_PALETTES = [WHITE_BAG, BLUE_BAG, BROWN_SACK, WHITE_BAG] as const;

type SurfaceKind = 'box' | 'bundle' | 'bag' | 'bottle';
/** Mostly bags and paper: boxes are the brightest thing in a heap, and a few go a long way. */
const SURFACE_KINDS: readonly SurfaceKind[] = [
  'bag',
  'bundle',
  'bag',
  'box',
  'bag',
  'bundle',
  'bottle',
];
const SURFACE_BAG_PALETTES = [BLACK_BAG, WHITE_BAG, BLACK_BAG, BLUE_BAG, BROWN_SACK] as const;

/**
 * A heap: a lumpy mound of shredded trash with boxes, bundles, bags and
 * bottles sunk into its surface at every angle, sometimes something long
 * sticking out of the top, one keepsake, and bags slumped at its foot. Items further up the
 * mound are further back, so they are drawn first.
 */
function pileItems(ox: number, oy: number, variant: number, joins: PileJoins): JunkItem[] {
  const rng = mulberry32(PILE_SEED + variant * PILE_SEED_STRIDE);
  const ground = oy + GROUND_Y;
  const cx = ox + TILE_MIDDLE_X;
  // A joined side runs its mound past the tile's edge, where the cell clips it,
  // so the heap meets its neighbour at full height with no outline between.
  const left = joins.left ? ox - PILE_JOIN_OVERRUN : ox + PILE_SIDE_INSET;
  const right = joins.right ? ox + T + PILE_JOIN_OVERRUN : ox + T - PILE_SIDE_INSET;
  const span = right - left;
  const peak = PILE_PEAKS[variant % PILE_PEAKS.length] + rng() * PILE_PEAK_JITTER;
  const profile = joinedMoundProfile(
    moundProfile(peak, rng),
    joins.left,
    joins.right,
    PILE_JOIN_HEIGHT,
  );
  const surfaceY = (x: number): number => ground - moundHeightAt(profile, (x - left) / span);

  // Something long sticking up out of the top: the pile's silhouette spike.
  const stickFromLeft = rng() < HALF;
  const stickRootX = cx + (stickFromLeft ? -1 : 1) * PILE_STICK_ROOT_OFFSET;
  const stickTipX = cx + (stickFromLeft ? 1 : -1) * PILE_STICK_TIP_OFFSET;
  const spike = stick({
    x0: stickRootX,
    y0: surfaceY(stickRootX) + PILE_STICK_ROOT_DROP,
    x1: stickTipX,
    y1: ground - peak - PILE_STICK_RISE,
    width: PILE_STICK_WIDTH,
    palette: rng() < HALF ? WOOD_LEG : CURTAIN_ROD,
  });

  const surface: Array<{ baseY: number; item: JunkItem }> = [];
  for (let i = 0; i < PILE_SURFACE_ITEMS; i++) {
    const kind = SURFACE_KINDS[Math.floor(rng() * SURFACE_KINDS.length)];
    const w = PILE_ITEM_W_MIN + rng() * PILE_ITEM_W_SPAN;
    const itemLeft = ox + PILE_ITEM_SIDE_ROOM;
    const x = itemLeft + rng() * (T - w - PILE_ITEM_SIDE_ROOM * 2);
    const centreX = x + w * HALF;
    const top = surfaceY(centreX);
    const baseY = top + (ground - top) * (PILE_BURY_MIN + rng() * PILE_BURY_SPAN);
    const tilt = toRadians((rng() * 2 - 1) * PILE_MAX_TILT_DEGREES);
    const h = PILE_ITEM_H_MIN + rng() * PILE_ITEM_H_SPAN;
    let item: JunkItem;
    switch (kind) {
      case 'box':
        item = box({ x, baseY, w, h, d: PILE_LID_D, tone: rng() * 2 - 1, rng });
        break;
      case 'bundle':
        item = bundle({ x, baseY, w, h: h * PILE_BUNDLE_FLATTEN, d: PILE_LID_D, age: rng(), rng });
        break;
      case 'bag':
        item = bag({
          cx: centreX,
          baseY,
          rx: w * HALF,
          ry: h * HALF + 2,
          palette: SURFACE_BAG_PALETTES[Math.floor(rng() * SURFACE_BAG_PALETTES.length)],
          knot: rng() < HALF,
          rng,
        });
        break;
      case 'bottle':
        item = bottle({
          x: centreX,
          baseY,
          w: BOTTLE_W,
          h: BOTTLE_H,
          glass: rng() < HALF ? GREEN_GLASS : BROWN_GLASS,
          lean: tilt * 2,
        });
        break;
    }
    surface.push({ baseY, item: tilted(item, centreX, baseY, tilt) });
  }
  surface.sort((a, b) => a.baseY - b.baseY);

  const items: JunkItem[] = [
    mound({ left, right, baseY: ground, profile, rng, footRagged: PILE_FOOT_RAGGED }),
  ];
  if (PILE_SPIKED_VARIANTS.has(variant)) items.push(spike);
  for (const entry of surface) items.push(entry.item);
  addPileAccent(items, PILE_ACCENTS[variant % PILE_ACCENTS.length], cx, ground, peak, rng);

  // Front: the bags everything else was dumped on.
  const frontBagOnLeft = rng() < HALF;
  const blackX = cx + (frontBagOnLeft ? -1 : 1) * PILE_FRONT_BAG_OFFSET;
  const otherX = cx + (frontBagOnLeft ? 1 : -1) * PILE_FRONT_BAG_OFFSET;
  items.push(
    bag({
      cx: blackX,
      baseY: ground + 1,
      rx: PILE_FRONT_BAG_RX,
      ry: PILE_FRONT_BAG_RY,
      palette: BLACK_BAG,
      knot: rng() < HALF,
      rng,
    }),
    bag({
      cx: otherX,
      baseY: ground + 1,
      rx: PILE_SIDE_BAG_RX,
      ry: PILE_SIDE_BAG_RY,
      palette: FRONT_BAG_PALETTES[variant % FRONT_BAG_PALETTES.length],
      knot: true,
      rng,
    }),
    can(
      cx + (rng() - HALF) * PILE_CAN_SPREAD,
      ground - PILE_CAN_LIFT,
      PILE_CAN_LENGTH,
      PILE_CAN_RADIUS,
    ),
  );
  return items;
}

/** Litter spilled off a heap's foot onto the floor, so its base is not a ruled line. */
function paintPileSpill(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  variant: number,
): void {
  const rng = mulberry32(PILE_SEED + SPILL_SEED_OFFSET + variant);
  for (let i = 0; i < PILE_SPILL_SHEETS; i++) {
    looseSheet(
      ctx,
      ox + PILE_SPILL_INSET + rng() * (T - PILE_SPILL_INSET * 2),
      oy + GROUND_Y - PILE_SPILL_LIFT + PILE_SPILL_DROP * rng(),
      LANDED_SHEET_W,
      LANDED_SHEET_H,
      rng() * TWO_PI,
    );
  }
}
const PILE_SEED_STRIDE = 101;
/** Where a joined heap's ridge meets its neighbour's, above the floor. */
const PILE_JOIN_HEIGHT = 40;
const PILE_JOIN_OVERRUN = 4;
const PILE_FOOT_RAGGED = 3;
/** Each variant's own height, so a row of heaps has a skyline. */
const PILE_PEAKS: readonly number[] = [62, 46, 56, 40];
const PILE_PEAK_JITTER = 6;
const SPILL_SEED_OFFSET = 59;
const PILE_SPILL_SHEETS = 2;
const PILE_SPILL_INSET = 10;
const PILE_SPILL_DROP = 1;
/** Loose sheets lie just above the floor line, where a turned sheet stays inside the tile. */
const PILE_SPILL_LIFT = 3;
const PILE_LID_D = 8;
const PILE_STICK_ROOT_OFFSET = 6;
const PILE_STICK_TIP_OFFSET = 18;
const PILE_STICK_ROOT_DROP = 6;
const PILE_STICK_RISE = 22;
const PILE_STICK_WIDTH = 4;
const PILE_ITEM_W_MIN = 12;
const PILE_ITEM_W_SPAN = 10;
const PILE_ITEM_H_MIN = 8;
const PILE_ITEM_H_SPAN = 8;
/** Room left beside an item so a tilt does not swing it past the tile. */
const PILE_ITEM_SIDE_ROOM = 4;
const PILE_BUNDLE_FLATTEN = 0.8;
const PILE_FRONT_BAG_OFFSET = 12;
const PILE_FRONT_BAG_RX = 14;
const PILE_FRONT_BAG_RY = 10;
const PILE_SIDE_BAG_RX = 11;
const PILE_SIDE_BAG_RY = 9;
const PILE_CAN_SPREAD = 16;
const PILE_CAN_LIFT = 3;
const PILE_CAN_LENGTH = 9;
const PILE_CAN_RADIUS = 3;

function addPileAccent(
  items: JunkItem[],
  accent: PileAccent,
  cx: number,
  ground: number,
  peak: number,
  rng: Rng,
): void {
  const perch = ground - peak * PILE_ACCENT_RIDE;
  switch (accent) {
    case 'lampshade':
      items.push(
        tilted(
          lampshade(
            cx + ACCENT_SIDE_OFFSET,
            perch,
            LAMPSHADE_TOP_W,
            LAMPSHADE_BOTTOM_W,
            LAMPSHADE_H,
          ),
          cx + ACCENT_SIDE_OFFSET,
          perch,
          toRadians(ACCENT_TILT_DEGREES),
        ),
      );
      return;
    case 'teddy':
      items.push(
        upturnedChair(cx + ACCENT_SIDE_OFFSET, perch, CHAIR_SEAT_W, CHAIR_LEG_LENGTH),
        teddy(cx - ACCENT_SIDE_OFFSET, perch + ACCENT_SINK, TEDDY_SIZE),
      );
      return;
    case 'tyre':
      items.push(
        tyre(cx - ACCENT_SIDE_OFFSET, perch, TYRE_RX, TYRE_RY),
        pictureFrame(
          cx + ACCENT_FRAME_OFFSET,
          perch + ACCENT_SINK,
          FRAME_W,
          FRAME_H,
          toRadians(FRAME_LEAN_DEGREES),
        ),
      );
      return;
    case 'broom':
      items.push(
        stick({
          x0: cx - ACCENT_SIDE_OFFSET,
          y0: perch + ACCENT_SINK,
          x1: cx + BROOM_TIP_X,
          y1: perch - BROOM_RISE,
          width: BROOM_WIDTH,
          palette: BROOM_HANDLE,
        }),
        bottle({
          x: cx + ACCENT_SIDE_OFFSET,
          baseY: perch + ACCENT_SINK,
          w: BOTTLE_W,
          h: BOTTLE_H,
          glass: rng() < HALF ? GREEN_GLASS : CLEAR_GLASS,
          lean: toRadians(BOTTLE_LEAN_DEGREES),
        }),
      );
      return;
  }
}
const PILE_ACCENT_RIDE = 0.55;
const ACCENT_SIDE_OFFSET = 9;
const ACCENT_SINK = 4;
const ACCENT_FRAME_OFFSET = 4;
const ACCENT_TILT_DEGREES = -16;
const LAMPSHADE_TOP_W = 10;
const LAMPSHADE_BOTTOM_W = 18;
const LAMPSHADE_H = 12;
const TEDDY_SIZE = 18;
const CHAIR_SEAT_W = 16;
const CHAIR_LEG_LENGTH = 16;
const TYRE_RX = 7;
const TYRE_RY = 9;
const FRAME_W = 14;
const FRAME_H = 16;
const FRAME_LEAN_DEGREES = 14;
const BROOM_TIP_X = 14;
const BROOM_RISE = 30;
const BROOM_WIDTH = 3;
const BOTTLE_W = 6;
const BOTTLE_H = 16;
const BOTTLE_LEAN_DEGREES = -12;

/** A junk pile, one of {@link HOARD_PILE_VARIANTS}, with its shadow on the floor. */
export function paintHoardPile(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  variant: number,
  joins: PileJoins,
): void {
  const joined = joins.left || joins.right;
  contactShadow(
    ctx,
    ox + TILE_MIDDLE_X,
    oy + SHADOW_Y,
    joined ? TILE_MIDDLE_X + PILE_JOIN_SHADOW_REACH : TILE_MIDDLE_X - 1,
    PILE_SHADOW_RY,
    PILE_SHADOW_ALPHA,
  );
  drawJunk(ctx, pileItems(ox, oy, variant, joins));
  paintPileSpill(ctx, ox, oy, variant);
}

/** Which sides of a heap's tile run on into a neighbouring heap or a wall, all four. */
export interface PileFillJoins extends PileJoins {
  readonly above: boolean;
  readonly below: boolean;
}

/** Frames of the fill row: every combination of the four joins. */
export const PILE_FILL_STATES = 16;
const FILL_ABOVE_BIT = 4;
const FILL_BELOW_BIT = 8;
/** Where a fill that only joins below starts, a little up the heap's own foot. */
const FILL_FOOT_TOP = GROUND_Y - 12;

export function pileFillFrame(joins: PileFillJoins): number {
  return (
    (joins.left ? JOIN_LEFT_BIT : 0) +
    (joins.right ? JOIN_RIGHT_BIT : 0) +
    (joins.above ? FILL_ABOVE_BIT : 0) +
    (joins.below ? FILL_BELOW_BIT : 0)
  );
}

export function pileFillJoinsOfFrame(frame: number): PileFillJoins {
  return {
    left: (frame & JOIN_LEFT_BIT) !== 0,
    right: (frame & JOIN_RIGHT_BIT) !== 0,
    above: (frame & FILL_ABOVE_BIT) !== 0,
    below: (frame & FILL_BELOW_BIT) !== 0,
  };
}

/**
 * The junk packed between two heaps in a column: baked under a heap whose
 * tile has a heap or a wall above or below it, so a column of heaps reads as
 * one ridge rather than a stack of clumps with floor between. It fills its own
 * tile up to the top edge only where the tile above is junk or wall, down to
 * the bottom only where the tile below is, and to a side only where that side
 * is joined — it never reaches toward floor, and never past its own tile, so
 * the chunk bake can hold it. Unoutlined: each edge meets more junk.
 */
export function paintPileFill(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  joins: PileFillJoins,
): void {
  if (!joins.above && !joins.below) return;
  const rng = mulberry32(PILE_SEED + FILL_SEED_OFFSET + pileFillFrame(joins));
  const top = joins.above ? oy - PILE_JOIN_OVERRUN : oy + FILL_FOOT_TOP;
  const bottom = joins.below ? oy + T + PILE_JOIN_OVERRUN : oy + GROUND_Y;
  const left = joins.left ? ox - PILE_JOIN_OVERRUN : ox + PILE_FILL_SIDE_INSET;
  const right = joins.right ? ox + T + PILE_JOIN_OVERRUN : ox + T - PILE_FILL_SIDE_INSET;
  const height = bottom - top;
  const profile = Array.from({ length: PILE_FILL_PROFILE_POINTS }, () => height);
  mound({ left, right, baseY: bottom, profile, rng }).paint(ctx);
}
const FILL_SEED_OFFSET = 613;
const PILE_FILL_SIDE_INSET = 6;
const PILE_FILL_PROFILE_POINTS = 5;

/** Which sides of a heap run on into a neighbouring heap or a wall. */
export interface PileJoins {
  readonly left: boolean;
  readonly right: boolean;
}

/** Frames per heap variant: joined on neither side, the left, the right, both. */
export const PILE_JOIN_STATES = 4;
const JOIN_LEFT_BIT = 1;
const JOIN_RIGHT_BIT = 2;

/** The frame of a heap variant with the given joins, in the sheet's idle row. */
export function pileFrame(variant: number, joins: PileJoins): number {
  return (
    variant * PILE_JOIN_STATES +
    (joins.left ? JOIN_LEFT_BIT : 0) +
    (joins.right ? JOIN_RIGHT_BIT : 0)
  );
}

/** The joins a frame of the heap row was painted with. */
export function pileJoinsOfFrame(frame: number): PileJoins {
  const state = frame % PILE_JOIN_STATES;
  return { left: (state & JOIN_LEFT_BIT) !== 0, right: (state & JOIN_RIGHT_BIT) !== 0 };
}
const PILE_JOIN_SHADOW_REACH = 8;
const PILE_SHADOW_RY = 5;
const PILE_SHADOW_ALPHA = 0.6;

const ROACH = '#5a2f14';
const ROACH_SHELL = '#8c4a22';
const ROACH_LEG = '#2a150a';

/**
 * Cockroaches stirring at a pile's foot, drawn over the pile while it
 * rustles: more of them, and further out, frame by frame.
 */
export function paintPileRustle(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  frame: number,
): void {
  const rng = mulberry32(PILE_SEED ^ ((frame + 1) * RUSTLE_SEED_STRIDE));
  const count = RUSTLE_ROACHES_MIN + frame;
  const reach = RUSTLE_REACH_MIN + frame * RUSTLE_REACH_STEP;
  for (let i = 0; i < count; i++) {
    const x = ox + RUSTLE_EDGE_INSET + rng() * (T - RUSTLE_EDGE_INSET * 2);
    const y = oy + GROUND_Y - RUSTLE_ROACH_LENGTH - rng() * reach;
    const heading = rng() * TWO_PI;
    paintRoach(ctx, x, y, heading, RUSTLE_ROACH_LENGTH);
  }
  // Scraps shaken loose off the heap.
  for (let i = 0; i <= frame; i++) {
    looseSheet(
      ctx,
      ox + RUSTLE_EDGE_INSET + rng() * (T - RUSTLE_EDGE_INSET * 2),
      oy + GROUND_Y - rng() * reach * 2,
      RUSTLE_SCRAP_W,
      RUSTLE_SCRAP_H,
      rng() * TWO_PI,
    );
  }
}
const RUSTLE_SEED_STRIDE = 977;
const RUSTLE_ROACHES_MIN = 2;
const RUSTLE_REACH_MIN = 10;
const RUSTLE_REACH_STEP = 8;
const RUSTLE_EDGE_INSET = 8;
const RUSTLE_ROACH_LENGTH = 9;
const RUSTLE_SCRAP_W = 6;
const RUSTLE_SCRAP_H = 4;

/** A cockroach seen from above: a glossy oval, six legs, two long feelers. */
function paintRoach(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  length: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = ROACH_LEG;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    for (let leg = 0; leg < ROACH_LEG_PAIRS; leg++) {
      const along = (leg - 1) * length * ROACH_LEG_SPACING;
      ctx.moveTo(along, 0);
      ctx.lineTo(along - length * ROACH_LEG_SWEEP, side * length * ROACH_LEG_REACH);
    }
    ctx.moveTo(length * HALF, 0);
    ctx.lineTo(length * ROACH_FEELER_REACH, side * length * ROACH_FEELER_SPREAD);
  }
  ctx.stroke();
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.beginPath();
  ctx.ellipse(0, 0, length * HALF + 1, length * ROACH_WIDTH_SHARE + 1, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = ROACH;
  ctx.beginPath();
  ctx.ellipse(0, 0, length * HALF, length * ROACH_WIDTH_SHARE, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = ROACH_SHELL;
  ctx.fillRect(-length * QUARTER, -1, length * HALF, 1);
  ctx.restore();
}
const ROACH_LEG_PAIRS = 3;
const ROACH_LEG_SPACING = 0.28;
const ROACH_LEG_SWEEP = 0.15;
const ROACH_LEG_REACH = 0.55;
const ROACH_FEELER_REACH = 1.2;
const ROACH_FEELER_SPREAD = 0.4;
const ROACH_WIDTH_SHARE = 0.28;

// ── Towers ───────────────────────────────────────────────────────────────────

export const TOWER_WOBBLE_ART_FRAMES = 4;
export const TOWER_FALL_FRAMES = 4;
export const TOWER_RUBBLE_VARIANTS = 2;

/** One layer of a tower, stacked on the one below it. */
interface TowerLayer {
  readonly kind: 'box' | 'bundle' | ContainerKind;
  readonly w: number;
  readonly h: number;
  /** Sideways drift from the tower's axis: the lean that makes it teeter. */
  readonly drift: number;
}

/**
 * Bottom to top. Heavy things low, paper high, and a drift that wanders right
 * then back, so the stack reads as a lifetime of putting one more thing on
 * top — and as about to go.
 */
const TOWER_LAYERS: readonly TowerLayer[] = [
  { kind: 'suitcase', w: 40, h: 14, drift: 0 },
  { kind: 'bundle', w: 36, h: 12, drift: 1 },
  { kind: 'tv', w: 30, h: 20, drift: 2 },
  { kind: 'bundle', w: 32, h: 10, drift: 4 },
  { kind: 'bin', w: 30, h: 16, drift: 3 },
  { kind: 'bundle', w: 30, h: 12, drift: 6 },
  { kind: 'box', w: 26, h: 16, drift: 5 },
  { kind: 'bundle', w: 28, h: 10, drift: 7 },
  { kind: 'box', w: 22, h: 12, drift: 6 },
];
const TOWER_LID_D = 8;
const TOWER_CAGE_W = 14;
const TOWER_CAGE_H = 16;

/** A tower's items laid out upright, with each one's height above the floor. */
interface TowerPiece {
  readonly item: JunkItem;
  /** Height of the piece's base above the floor. */
  readonly lift: number;
  /** Horizontal centre offset from the tower's axis. */
  readonly offsetX: number;
}

/** The tower as pieces standing on the floor at the origin, axis at x = 0. */
function towerPieces(): TowerPiece[] {
  const rng = mulberry32(TOWER_SEED);
  const pieces: TowerPiece[] = [];
  let lift = 0;
  for (const layer of TOWER_LAYERS) {
    const x = layer.drift - layer.w * HALF;
    const baseY = -lift;
    const { kind, w, h } = layer;
    const item =
      kind === 'box'
        ? box({ x, baseY, w, h, d: TOWER_LID_D, tone: rng() * 2 - 1, rng })
        : kind === 'bundle'
          ? bundle({ x, baseY, w, h, d: TOWER_LID_D, age: rng(), rng })
          : container({ kind, x, baseY, w, h, d: TOWER_LID_D, rng });
    pieces.push({ item, lift, offsetX: layer.drift });
    lift += layer.h;
  }
  const topDrift = TOWER_LAYERS[TOWER_LAYERS.length - 1].drift;
  pieces.push({ item: birdcage(topDrift, -lift - TOWER_LID_D * HALF), lift, offsetX: topDrift });
  return pieces;
}

const CAGE_WIRE = '#8b7a4a';

/** An empty birdcage on top of the tower: the last thing anyone put there. */
function birdcage(cx: number, baseY: number): JunkItem {
  const w = TOWER_CAGE_W;
  const h = TOWER_CAGE_H;
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(cx - w * HALF, baseY);
    ctx.lineTo(cx - w * HALF, baseY - h * CAGE_SHOULDER);
    ctx.quadraticCurveTo(cx, baseY - h * CAGE_DOME, cx + w * HALF, baseY - h * CAGE_SHOULDER);
    ctx.lineTo(cx + w * HALF, baseY);
    ctx.closePath();
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.fillStyle = withAlpha(JUNK_OUTLINE, CAGE_INTERIOR_ALPHA);
      ctx.beginPath();
      trace(ctx);
      ctx.fill();
      ctx.strokeStyle = lit(CAGE_WIRE, CAGE_WIRE_LIGHT);
      ctx.lineWidth = 1;
      for (let x = cx - w * HALF + 1; x < cx + w * HALF; x += CAGE_BAR_SPACING) {
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, baseY - h * CAGE_SHOULDER);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - w * HALF, baseY - h * CAGE_SHOULDER);
      ctx.quadraticCurveTo(cx, baseY - h * CAGE_DOME, cx + w * HALF, baseY - h * CAGE_SHOULDER);
      ctx.stroke();
      ctx.fillStyle = CAGE_WIRE;
      ctx.fillRect(cx - w * HALF, baseY - CAGE_BASE_PX, w, CAGE_BASE_PX);
    },
  };
}
const CAGE_SHOULDER = 0.7;
const CAGE_DOME = 1.25;
const CAGE_INTERIOR_ALPHA = 0.35;
const CAGE_WIRE_LIGHT = 0.3;
const CAGE_BAR_SPACING = 3;
const CAGE_BASE_PX = 3;

/** The tower standing, rocked `tiltDegrees` about its foot (positive tips it right). */
function towerStanding(ox: number, oy: number, tiltDegrees: number): JunkItem[] {
  const pivotX = ox + TILE_MIDDLE_X;
  const pivotY = oy + GROUND_Y;
  const tilt = toRadians(tiltDegrees);
  return towerPieces().map(({ item }) =>
    transformed(item, (ctx) => {
      ctx.translate(pivotX, pivotY);
      ctx.rotate(tilt);
    }),
  );
}

export function paintTowerIdle(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  contactShadow(
    ctx,
    ox + TILE_MIDDLE_X,
    oy + SHADOW_Y,
    TOWER_SHADOW_RX,
    TOWER_SHADOW_RY,
    TOWER_SHADOW_ALPHA,
  );
  drawJunk(ctx, towerStanding(ox, oy, 0));
  drawJunk(ctx, towerFootClutter(ox, oy));
}
const TOWER_SHADOW_RX = 26;
const TOWER_SHADOW_RY = 5;
const TOWER_SHADOW_ALPHA = 0.6;

/** A bag and a bottle slumped against the tower's foot. */
function towerFootClutter(ox: number, oy: number): JunkItem[] {
  const rng = mulberry32(TOWER_SEED + 1);
  const ground = oy + GROUND_Y;
  return [
    bag({
      cx: ox + TOWER_FOOT_BAG_X,
      baseY: ground + 1,
      rx: TOWER_FOOT_BAG_RX,
      ry: TOWER_FOOT_BAG_RY,
      palette: BROWN_SACK,
      knot: false,
      rng,
    }),
    bottle({
      x: ox + TOWER_FOOT_BOTTLE_X,
      baseY: ground + 1,
      w: BOTTLE_W,
      h: BOTTLE_H,
      glass: CLEAR_GLASS,
      lean: toRadians(TOWER_FOOT_BOTTLE_LEAN),
    }),
  ];
}
const TOWER_FOOT_BAG_X = 17;
const TOWER_FOOT_BAG_RX = 9;
const TOWER_FOOT_BAG_RY = 8;
const TOWER_FOOT_BOTTLE_X = 46;
const TOWER_FOOT_BOTTLE_LEAN = 18;

/** Degrees the tower rocks through, one per wobble frame: a sway that grows. */
const WOBBLE_TILTS_DEGREES: readonly number[] = [-2, 2.5, -3, 3.5];
const WOBBLE_DUST_SPECKS = 14;

/** A wobble frame: the tower rocking, dust sifting off it. */
export function paintTowerWobble(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  frame: number,
): void {
  contactShadow(
    ctx,
    ox + TILE_MIDDLE_X,
    oy + SHADOW_Y,
    TOWER_SHADOW_RX,
    TOWER_SHADOW_RY,
    TOWER_SHADOW_ALPHA,
  );
  drawJunk(ctx, towerStanding(ox, oy, WOBBLE_TILTS_DEGREES[frame % WOBBLE_TILTS_DEGREES.length]));
  drawJunk(ctx, towerFootClutter(ox, oy));
  const rng = mulberry32(TOWER_SEED + WOBBLE_SEED_OFFSET + frame);
  dustSpecks(
    ctx,
    rng,
    ox + WOBBLE_DUST_INSET,
    oy - WOBBLE_DUST_TOP,
    T - WOBBLE_DUST_INSET * 2,
    GROUND_Y + WOBBLE_DUST_TOP,
    WOBBLE_DUST_SPECKS,
  );
}
const WOBBLE_SEED_OFFSET = 17;
const WOBBLE_DUST_INSET = 6;
const WOBBLE_DUST_TOP = 80;

/** Which way a tower falls, as its fall sheets are painted. */
export type FallSheet = 'east' | 'south' | 'north';

/** The tip angles of the three in-flight frames; the fourth is the landing. */
const FALL_ANGLES_DEGREES: readonly number[] = [22, 52, 78];
const LANDED_ANGLE_DEGREES = 90;
/** The least a squashed piece may be scaled to while it tips toward or away from the camera. */
const FALL_MIN_FORESHORTEN = 0.35;
/** How far a landed tower's debris spreads along its line, in tiles. */
const FALL_LINE_TILES = 3;

/** How a landed piece has bounced off its place in the stack. */
interface Scatter {
  readonly along: number;
  readonly across: number;
  readonly tilt: number;
}

/**
 * The tower's pieces tipped `angle` toward `sheet`, each optionally knocked
 * off its place by a scatter.
 *
 * East is a rotation in the picture plane. North and south tip toward and
 * away from the camera, which in this view moves each piece up or down the
 * screen by its height times the difference of the angle's sine and cosine,
 * and flattens it as it goes over.
 */
function towerTipped(
  ox: number,
  oy: number,
  sheet: FallSheet,
  angle: number,
  scatter: readonly Scatter[] | null,
  stretch: number,
): JunkItem[] {
  const pivotX = ox + TILE_MIDDLE_X;
  const pivotY = oy + GROUND_Y;
  const pieces = towerPieces();
  const knock = (index: number): Scatter => scatter?.[index] ?? { along: 0, across: 0, tilt: 0 };
  if (sheet === 'east') {
    return pieces.map(({ item, lift }, index) => {
      const bounce = knock(index);
      return transformed(item, (ctx2) => {
        ctx2.translate(pivotX, pivotY);
        ctx2.rotate(angle);
        // In the tower's own frame, up the stack is -y and across it is x.
        ctx2.translate(bounce.across, -lift * (stretch - 1) - bounce.along);
        ctx2.rotate(bounce.tilt);
      });
    });
  }
  const towardCamera = sheet === 'south';
  const screenPerLift = towardCamera
    ? Math.sin(angle) - Math.cos(angle)
    : -(Math.sin(angle) + Math.cos(angle));
  const squash = Math.max(FALL_MIN_FORESHORTEN, Math.abs(Math.cos(angle)));
  const placed = pieces.map((piece, index) => {
    const bounce = knock(index);
    const alongScreen = (towardCamera ? 1 : -1) * bounce.along;
    return {
      piece,
      bounce,
      screenY: pivotY + piece.lift * stretch * screenPerLift + alongScreen,
    };
  });
  // Painter's order: whatever sits lower on the screen is nearer the camera.
  placed.sort((a, b) => a.screenY - b.screenY);
  return placed.map(({ piece, bounce, screenY }) =>
    transformed(piece.item, (ctx2) => {
      ctx2.translate(pivotX + bounce.across, screenY);
      ctx2.rotate(bounce.tilt);
      ctx2.scale(1, squash);
      ctx2.translate(0, piece.lift);
    }),
  );
}

/** One frame of a tower falling toward `sheet`, drawn about its own tile; the last is the landing. */
export function paintTowerFall(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  sheet: FallSheet,
  frame: number,
): void {
  const pivotX = ox + TILE_MIDDLE_X;
  const pivotY = oy + GROUND_Y;
  if (frame >= FALL_ANGLES_DEGREES.length) {
    paintTowerLanded(ctx, ox, oy, sheet);
    return;
  }
  contactShadow(ctx, pivotX, pivotY, TOWER_SHADOW_RX, TOWER_SHADOW_RY, TOWER_SHADOW_ALPHA);
  drawJunk(ctx, towerTipped(ox, oy, sheet, toRadians(FALL_ANGLES_DEGREES[frame]), null, 1));
  const rng = mulberry32(TOWER_SEED + FALL_SEED_OFFSET + frame);
  dustSpecks(
    ctx,
    rng,
    pivotX - T * FALL_DUST_HALF_SPAN,
    pivotY - T * 2,
    T * FALL_DUST_HALF_SPAN * 2,
    T * 2,
    WOBBLE_DUST_SPECKS,
  );
}
const FALL_SEED_OFFSET = 31;
/** Dust sifts from the width of the falling stack, not the whole frame. */
const FALL_DUST_HALF_SPAN = 0.7;

/**
 * The tower flat on the floor: its pieces burst apart and bounced along the
 * whole line it fell down, papers everywhere, dust rising off it.
 */
function paintTowerLanded(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  sheet: FallSheet,
): void {
  const rng = mulberry32(TOWER_SEED + LANDED_SEED_OFFSET);
  const along =
    sheet === 'east' ? { x: 1, y: 0 } : sheet === 'south' ? { x: 0, y: 1 } : { x: 0, y: -1 };
  const startX = ox + TILE_MIDDLE_X;
  const startY = oy + GROUND_Y - T * QUARTER;
  const lineLength = FALL_LINE_TILES * T;
  // Dust under the debris first, so the pieces sit in it.
  for (let i = 0; i < LANDED_PUFFS; i++) {
    const t = (i + HALF) / LANDED_PUFFS;
    dustPuff(
      ctx,
      startX + along.x * t * lineLength,
      startY + along.y * t * lineLength,
      T * LANDED_PUFF_RX,
      T * LANDED_PUFF_RY,
      LANDED_PUFF_ALPHA,
    );
  }
  const scatter = TOWER_LAYERS.map(() => ({
    along: (rng() - HALF) * LANDED_SCATTER_PX,
    across: (rng() - HALF) * LANDED_SCATTER_PX,
    tilt: (rng() - HALF) * toRadians(LANDED_MAX_TILT_DEGREES),
  }));
  // The stack spreads out as it hits: the pieces cover the whole line, not just the tower's height.
  drawJunk(
    ctx,
    towerTipped(ox, oy, sheet, toRadians(LANDED_ANGLE_DEGREES), scatter, LANDED_STRETCH),
  );
  for (let i = 0; i < LANDED_SHEETS; i++) {
    const t = rng();
    looseSheet(
      ctx,
      startX + along.x * t * lineLength + (rng() - HALF) * T * HALF,
      startY + along.y * t * lineLength + (rng() - HALF) * T * HALF,
      LANDED_SHEET_W,
      LANDED_SHEET_H,
      rng() * TWO_PI,
    );
  }
}
const LANDED_SEED_OFFSET = 53;
const LANDED_SCATTER_PX = 12;
const LANDED_MAX_TILT_DEGREES = 50;
const LANDED_STRETCH = 1.25;
const LANDED_SHEET_W = 8;
const LANDED_SHEET_H = 6;
const LANDED_SHEETS = 14;
const LANDED_PUFFS = 4;
const LANDED_PUFF_RX = 0.6;
const LANDED_PUFF_RY = 0.4;
const LANDED_PUFF_ALPHA = 0.55;

/**
 * Flattened junk where a tower stood or fell, baked into the floor. Variant 0
 * is the stump of the tower itself; the rest are the spill along its line.
 * Kept inside the tile: a floor decal is baked, and neighbours paint over
 * anything that strays.
 */
export function paintTowerRubble(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  variant: number,
): void {
  const rng = mulberry32(TOWER_SEED + RUBBLE_SEED_OFFSET + variant);
  const cx = ox + TILE_MIDDLE_X;
  const cy = oy + T * HALF;
  contactShadow(
    ctx,
    cx,
    cy + RUBBLE_SHADOW_DROP,
    T * RUBBLE_SHADOW_RX,
    T * RUBBLE_SHADOW_RY,
    RUBBLE_SHADOW_ALPHA,
  );
  const items: JunkItem[] = [];
  const pieces = variant === 0 ? RUBBLE_STUMP_PIECES : RUBBLE_SPILL_PIECES;
  for (let i = 0; i < pieces; i++) {
    const w = RUBBLE_W_MIN + rng() * RUBBLE_W_SPAN;
    const x = ox + RUBBLE_INSET + rng() * (T - RUBBLE_INSET * 2 - w);
    const y = oy + RUBBLE_TOP + rng() * (T - RUBBLE_TOP - RUBBLE_BOTTOM_INSET);
    items.push(
      rng() < HALF
        ? bundle({ x, baseY: y, w, h: RUBBLE_H, d: RUBBLE_D, age: rng(), rng })
        : box({ x, baseY: y, w, h: RUBBLE_H, d: RUBBLE_D, tone: rng() * 2 - 1, rng }),
    );
  }
  items.push(
    can(
      cx + (rng() - HALF) * RUBBLE_CAN_SPREAD,
      oy + T - RUBBLE_BOTTOM_INSET,
      PILE_CAN_LENGTH,
      PILE_CAN_RADIUS,
    ),
  );
  drawJunk(ctx, items);
  for (let i = 0; i < RUBBLE_SHEETS; i++) {
    looseSheet(
      ctx,
      ox + RUBBLE_INSET * 2 + rng() * (T - RUBBLE_INSET * 4),
      oy + RUBBLE_INSET * 2 + rng() * (T - RUBBLE_INSET * 4),
      LANDED_SHEET_W,
      LANDED_SHEET_H,
      rng() * TWO_PI,
    );
  }
}
const RUBBLE_SEED_OFFSET = 71;
const RUBBLE_SHADOW_DROP = 6;
const RUBBLE_SHADOW_RX = 0.42;
const RUBBLE_SHADOW_RY = 0.3;
const RUBBLE_SHADOW_ALPHA = 0.35;
const RUBBLE_STUMP_PIECES = 4;
const RUBBLE_SPILL_PIECES = 3;
const RUBBLE_W_MIN = 14;
const RUBBLE_W_SPAN = 10;
const RUBBLE_INSET = 4;
const RUBBLE_TOP = 22;
const RUBBLE_BOTTOM_INSET = 6;
const RUBBLE_H = 4;
const RUBBLE_D = 7;
const RUBBLE_CAN_SPREAD = 30;
const RUBBLE_SHEETS = 4;

// ── Garbage bags ─────────────────────────────────────────────────────────────

export const BAG_SHATTER_FRAMES = 6;

const BAG_CX = TILE_MIDDLE_X;
const BAG_RX = 21;
const BAG_RY = 18;

function garbageBag(ox: number, oy: number, rng: Rng): JunkItem {
  return bag({
    cx: ox + BAG_CX,
    baseY: oy + GROUND_Y + 1,
    rx: BAG_RX,
    ry: BAG_RY,
    palette: BLACK_BAG,
    knot: true,
    rng,
  });
}

export function paintBagIdle(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  contactShadow(ctx, ox + BAG_CX, oy + SHADOW_Y, BAG_RX + 2, BAG_SHADOW_RY, PILE_SHADOW_ALPHA);
  const rng = mulberry32(BAG_SEED);
  drawJunk(ctx, [
    garbageBag(ox, oy, rng),
    bag({
      cx: ox + BAG_CX + BAG_SIDE_OFFSET,
      baseY: oy + GROUND_Y + 2,
      rx: BAG_SIDE_RX,
      ry: BAG_SIDE_RY,
      palette: WHITE_BAG,
      knot: true,
      rng,
    }),
  ]);
}
const BAG_SHADOW_RY = 5;
const BAG_SIDE_OFFSET = 14;
const BAG_SIDE_RX = 9;
const BAG_SIDE_RY = 8;

const PEEL = '#d9a23a';
const LEAK = '#4b3a1c';

/** The bag split along its front, a banana peel and a sheet of paper hanging out. */
export function paintBagDamaged(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  paintBagIdle(ctx, ox, oy);
  const cx = ox + BAG_CX;
  const cy = oy + GROUND_Y - BAG_RY;
  ctx.save();
  ctx.fillStyle = withAlpha(LEAK, LEAK_ALPHA);
  ctx.beginPath();
  ctx.ellipse(cx - LEAK_OFFSET_X, oy + GROUND_Y + 2, LEAK_RX, LEAK_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.beginPath();
  ctx.moveTo(cx - SPLIT_HALF_W, cy);
  ctx.lineTo(cx - SPLIT_HALF_W * HALF, cy - SPLIT_H);
  ctx.lineTo(cx, cy + 1);
  ctx.lineTo(cx + SPLIT_HALF_W * HALF, cy - SPLIT_H * HALF);
  ctx.lineTo(cx + SPLIT_HALF_W, cy + SPLIT_H);
  ctx.lineTo(cx, cy + SPLIT_H * 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PEEL;
  ctx.fillRect(cx - PEEL_OFFSET, cy, PEEL_W, PEEL_H);
  ctx.restore();
  looseSheet(
    ctx,
    cx + PAPER_OFFSET,
    cy + PAPER_OFFSET,
    PAPER_W,
    PAPER_H,
    toRadians(PAPER_ANGLE_DEGREES),
  );
}
const LEAK_ALPHA = 0.65;
const LEAK_OFFSET_X = 8;
const LEAK_RX = 12;
const LEAK_RY = 4;
const SPLIT_HALF_W = 9;
const SPLIT_H = 4;
const PEEL_OFFSET = 4;
const PEEL_W = 7;
const PEEL_H = 3;
const PAPER_OFFSET = 3;
const PAPER_W = 9;
const PAPER_H = 7;
const PAPER_ANGLE_DEGREES = 20;

const SHRED_COUNT = 11;
const SHRED_REACH_PX = 30;
const SHRED_SIZE_PX = 6;
const TRASH_COLOURS: readonly string[] = [
  '#d9a23a',
  '#b3322b',
  '#d3cbb2',
  '#3f6e3a',
  '#c9c9c4',
  '#8a5a34',
];

/** The bag bursting: its body collapsing while plastic shreds and trash fly out. */
export function paintBagShatter(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  frame: number,
): void {
  const t = frame / (BAG_SHATTER_FRAMES - 1);
  const rng = mulberry32(BAG_SEED + SHATTER_SEED_OFFSET);
  const cx = ox + BAG_CX;
  const cy = oy + GROUND_Y - BAG_RY * HALF;
  const collapse = 1 - t * SHATTER_COLLAPSE;
  contactShadow(ctx, cx, oy + SHADOW_Y, BAG_RX + 2, BAG_SHADOW_RY, PILE_SHADOW_ALPHA * collapse);
  drawJunk(ctx, [
    bag({
      cx,
      baseY: oy + GROUND_Y + 1,
      rx: BAG_RX * (1 + t * SHATTER_SPREAD),
      ry: BAG_RY * collapse,
      palette: BLACK_BAG,
      knot: false,
      rng: mulberry32(BAG_SEED),
    }),
  ]);
  const fade = 1 - t * SHATTER_FADE;
  ctx.save();
  for (let i = 0; i < SHRED_COUNT; i++) {
    const heading = (i / SHRED_COUNT) * TWO_PI + rng() * HALF;
    const reach = (SHATTER_REACH_MIN + t * SHRED_REACH_PX) * (HALF + rng() * HALF);
    // Flung up and out, then falling back as the burst ends.
    const rise = Math.sin(t * Math.PI) * SHATTER_RISE_PX;
    const x = cx + Math.cos(heading) * reach;
    const y = cy + Math.sin(heading) * reach * SHATTER_GROUND_SQUASH - rise;
    ctx.globalAlpha = fade;
    if (i % 2 === 0) {
      ctx.fillStyle = BLACK_BAG.body;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + SHRED_SIZE_PX, y + rng() * SHRED_SIZE_PX);
      ctx.lineTo(x + rng() * SHRED_SIZE_PX, y + SHRED_SIZE_PX);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = TRASH_COLOURS[i % TRASH_COLOURS.length];
      ctx.fillRect(x, y, SHRED_SIZE_PX * HALF + 1, SHRED_SIZE_PX * HALF);
    }
  }
  ctx.restore();
}
const SHATTER_SEED_OFFSET = 7;
const SHATTER_COLLAPSE = 0.8;
const SHATTER_SPREAD = 0.3;
const SHATTER_FADE = 0.55;
const SHATTER_REACH_MIN = 6;
const SHATTER_RISE_PX = 10;
const SHATTER_GROUND_SQUASH = 0.6;

/** What a burst bag leaves: flat torn plastic and its spilled guts. */
export function paintBagRemains(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const rng = mulberry32(BAG_SEED + REMAINS_SEED_OFFSET);
  const cx = ox + BAG_CX;
  const cy = oy + GROUND_Y - REMAINS_LIFT;
  ctx.save();
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.beginPath();
  for (let i = 0; i < REMAINS_POINTS; i++) {
    const angle = (i / REMAINS_POINTS) * TWO_PI;
    const r = REMAINS_R_MIN + rng() * REMAINS_R_SPAN;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * REMAINS_SQUASH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BLACK_BAG.body;
  ctx.fill();
  ctx.strokeStyle = withAlpha(BLACK_BAG.sheen, REMAINS_SHEEN_ALPHA);
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let i = 0; i < REMAINS_TRASH; i++) {
    ctx.fillStyle = TRASH_COLOURS[i % TRASH_COLOURS.length];
    ctx.fillRect(
      cx + (rng() - HALF) * REMAINS_TRASH_SPREAD,
      cy + (rng() - HALF) * REMAINS_TRASH_SPREAD * REMAINS_SQUASH,
      REMAINS_TRASH_W,
      REMAINS_TRASH_H,
    );
  }
  ctx.restore();
  looseSheet(ctx, cx + REMAINS_PAPER_X, cy - 1, PAPER_W, PAPER_H, toRadians(-PAPER_ANGLE_DEGREES));
}
const REMAINS_SEED_OFFSET = 11;
const REMAINS_LIFT = 6;
const REMAINS_POINTS = 11;
const REMAINS_R_MIN = 12;
const REMAINS_R_SPAN = 9;
const REMAINS_SQUASH = 0.45;
const REMAINS_SHEEN_ALPHA = 0.4;
const REMAINS_TRASH = 7;
const REMAINS_TRASH_SPREAD = 30;
const REMAINS_TRASH_W = 4;
const REMAINS_TRASH_H = 3;
const REMAINS_PAPER_X = 9;

// ── Floor ────────────────────────────────────────────────────────────────────

export const LINOLEUM_VARIANTS = 8;
export const GRIME_EDGES = 4;
export const FLOOR_DECALS = 10;

/**
 * The floor is the backdrop the crawlers, the boss and her junk are read
 * against, so everything on it is kept to a narrow band of brightness: one
 * dull yellowed linoleum, one square to a tile, joints barely darker than the
 * squares, and dirt as a shift in tone rather than as speckle. A checker, a
 * fine crack pattern or scattered dark flecks at 32 px is dizzying, and it
 * hides a cockroach.
 */
const LINOLEUM = '#7d7458';
const GRIME = '#3b2a17';
/** How far each square's own tone may drift toward grime, and how little. */
const SQUARE_GRIME_MIN = 0.04;
const SQUARE_GRIME_SPAN = 0.08;
const SEAM_ALPHA = 0.16;
const SEAM_BEVEL_ALPHA = 0.05;
const MOTTLE_BLOTCHES = 6;
const MOTTLE_ALPHA = 0.05;
const MOTTLE_R_MIN = 6;
const MOTTLE_R_SPAN = 10;
const WORN_PATH_ALPHA = 0.06;

/** Per variant, the one thing wrong with that square beyond dirt. */
type SquareDefect = 'none' | 'crack' | 'peeled' | 'stain' | 'burn' | 'worn';
const LINOLEUM_DEFECTS: readonly SquareDefect[] = [
  'none',
  'crack',
  'peeled',
  'worn',
  'stain',
  'burn',
  'none',
  'worn',
];

/**
 * One tile of linoleum: a single dull square, faintly mottled, with a soft
 * joint on its edges so neighbouring tiles meet on the same line whatever
 * their variants, and perhaps one quiet defect inside it.
 */
export function paintLinoleum(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  variant: number,
): void {
  const rng = mulberry32(FLOOR_SEED + variant * FLOOR_SEED_STRIDE);
  const base = mix(LINOLEUM, GRIME, SQUARE_GRIME_MIN + rng() * SQUARE_GRIME_SPAN);
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, T, T);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, T, T);
  ctx.clip();
  for (let i = 0; i < MOTTLE_BLOTCHES; i++) {
    ctx.fillStyle = withAlpha(rng() < HALF ? '#fff4dc' : GRIME, MOTTLE_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      ox + rng() * T,
      oy + rng() * T,
      MOTTLE_R_MIN + rng() * MOTTLE_R_SPAN,
      MOTTLE_R_MIN + rng() * MOTTLE_R_SPAN * HALF,
      rng() * Math.PI,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  paintDefect(ctx, ox, oy, base, LINOLEUM_DEFECTS[variant % LINOLEUM_DEFECTS.length], rng);
  ctx.restore();
  ctx.fillStyle = withAlpha(GRIME, SEAM_ALPHA);
  ctx.fillRect(ox, oy, T, 1);
  ctx.fillRect(ox, oy, 1, T);
  ctx.fillStyle = withAlpha('#fff4dc', SEAM_BEVEL_ALPHA);
  ctx.fillRect(ox + 1, oy + 1, T - 2, 1);
}
const FLOOR_SEED_STRIDE = 131;

function paintDefect(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  base: string,
  defect: SquareDefect,
  rng: Rng,
): void {
  switch (defect) {
    case 'crack': {
      ctx.strokeStyle = withAlpha(GRIME, CRACK_ALPHA);
      ctx.lineWidth = CRACK_WIDTH;
      ctx.beginPath();
      let cx = ox + T * (QUARTER + rng() * HALF);
      let cy = oy + T * QUARTER;
      ctx.moveTo(cx, cy);
      for (let i = 0; i < CRACK_SEGMENTS; i++) {
        cx += (rng() - HALF) * CRACK_JITTER;
        cy += (T * HALF) / CRACK_SEGMENTS;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      return;
    }
    case 'peeled': {
      // A corner lifted off the glue: a slightly lighter curl and a soft shadow under it.
      const size = T * PEEL_SHARE;
      const cornerX = ox + T;
      const cornerY = oy + T;
      ctx.fillStyle = mix(base, GRIME, PEEL_SHADOW_MIX);
      ctx.beginPath();
      ctx.moveTo(cornerX, cornerY - size);
      ctx.lineTo(cornerX, cornerY);
      ctx.lineTo(cornerX - size, cornerY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lit(base, PEEL_CURL_LIGHT);
      ctx.beginPath();
      ctx.moveTo(cornerX, cornerY - size);
      ctx.quadraticCurveTo(
        cornerX - size * PEEL_CURL,
        cornerY - size * PEEL_CURL,
        cornerX - size,
        cornerY,
      );
      ctx.lineTo(cornerX - size * PEEL_LIP, cornerY - size * PEEL_LIP);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'stain':
      ctx.fillStyle = withAlpha(SPILL, STAIN_ALPHA);
      ctx.beginPath();
      ctx.ellipse(
        ox + T * HALF,
        oy + T * HALF,
        T * STAIN_RX,
        T * STAIN_RY,
        rng() * Math.PI,
        0,
        TWO_PI,
      );
      ctx.fill();
      return;
    case 'burn': {
      const cx = ox + T * (QUARTER + rng() * HALF);
      const cy = oy + T * (QUARTER + rng() * HALF);
      ctx.fillStyle = withAlpha(SPILL, BURN_ALPHA);
      ctx.beginPath();
      ctx.ellipse(cx, cy, BURN_RX, BURN_RY, 0, 0, TWO_PI);
      ctx.fill();
      return;
    }
    case 'worn': {
      // Where the path to the fridge has worn the pattern off: a paler smear.
      ctx.fillStyle = withAlpha('#fff4dc', WORN_PATH_ALPHA);
      ctx.beginPath();
      ctx.ellipse(
        ox + T * HALF,
        oy + T * HALF,
        T * WORN_RX,
        T * WORN_RY,
        rng() * Math.PI,
        0,
        TWO_PI,
      );
      ctx.fill();
      return;
    }
    case 'none':
      return;
  }
}
const CRACK_ALPHA = 0.22;
const CRACK_WIDTH = 1.5;
const CRACK_SEGMENTS = 4;
const CRACK_JITTER = 8;
const PEEL_SHARE = 0.3;
const PEEL_CURL = 0.2;
const PEEL_LIP = 0.62;
const PEEL_CURL_LIGHT = 0.08;
const PEEL_SHADOW_MIX = 0.15;
const SPILL = '#5a3517';
const STAIN_ALPHA = 0.1;
const STAIN_RX = 0.34;
const STAIN_RY = 0.24;
const BURN_ALPHA = 0.18;
const BURN_RX = 5;
const BURN_RY = 3;
const WORN_RX = 0.4;
const WORN_RY = 0.22;

/** Edge order of the grime row: which neighbour's side each frame darkens. */
export const GRIME_EDGE_ORDER = ['north', 'east', 'south', 'west'] as const;
export type GrimeEdge = (typeof GRIME_EDGE_ORDER)[number];
const GRIME_DEPTH_SHARE = 0.45;
const GRIME_DEPTH = T * GRIME_DEPTH_SHARE;
const GRIME_EDGE_ALPHA = 0.28;

/**
 * Filth banked against one side of a tile — a wall or a junk heap on that
 * side — as a soft darkening across the band and nothing else, so neighbours
 * along the same wall continue each other exactly.
 */
export function paintGrimeEdge(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  edge: GrimeEdge,
): void {
  ctx.save();
  ctx.translate(ox + T * HALF, oy + T * HALF);
  ctx.rotate(GRIME_EDGE_ORDER.indexOf(edge) * (Math.PI * HALF));
  ctx.translate(-T * HALF, -T * HALF);
  const band = ctx.createLinearGradient(0, 0, 0, GRIME_DEPTH);
  band.addColorStop(0, withAlpha(GRIME, GRIME_EDGE_ALPHA));
  band.addColorStop(1, withAlpha(GRIME, 0));
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, T, GRIME_DEPTH);
  ctx.restore();
}

/** The floor's litter, one per decal frame. */
type FloorDecal =
  | 'coffee_ring'
  | 'soda_puddle'
  | 'drag_smear'
  | 'wrapper'
  | 'bottle_caps'
  | 'cigarette_butts'
  | 'pizza_crust'
  | 'receipt'
  | 'pill_bottle'
  | 'footprints';
export const FLOOR_DECAL_ORDER: readonly FloorDecal[] = [
  'coffee_ring',
  'soda_puddle',
  'drag_smear',
  'wrapper',
  'bottle_caps',
  'cigarette_butts',
  'pizza_crust',
  'receipt',
  'pill_bottle',
  'footprints',
];

/** Litter colours: all muted toward the floor, so a crumb never outshouts a cockroach. */
const LITTER_PAPER = '#a39a7e';
const LITTER_WARM = '#8f6a3e';
const LITTER_RED = '#7e4a38';
const LITTER_TIN = '#8d8b80';
const DECAL_ALPHA = 0.55;

/**
 * One piece of floor litter, centred in its tile and kept well inside it. Flat
 * and unoutlined, and close to the floor's own tone: from a step back it is
 * texture, and only up close is it a crust or a receipt.
 */
export function paintFloorDecal(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  index: number,
): void {
  const decal = FLOOR_DECAL_ORDER[index % FLOOR_DECAL_ORDER.length];
  const rng = mulberry32(FLOOR_SEED + DECAL_SEED_OFFSET + index);
  const cx = ox + T * HALF;
  const cy = oy + T * HALF;
  ctx.save();
  ctx.globalAlpha = DECAL_ALPHA;
  switch (decal) {
    case 'coffee_ring':
      ctx.strokeStyle = withAlpha(SPILL, DECAL_RING_ALPHA);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, DECAL_RING_R, DECAL_RING_R * DECAL_FLOOR_SQUASH, 0, 0, TWO_PI);
      ctx.stroke();
      break;
    case 'soda_puddle':
      ctx.fillStyle = withAlpha(SPILL, DECAL_PUDDLE_ALPHA);
      ctx.beginPath();
      ctx.ellipse(cx, cy, DECAL_PUDDLE_RX, DECAL_PUDDLE_RY, rng() * HALF, 0, TWO_PI);
      ctx.fill();
      break;
    case 'drag_smear':
      ctx.strokeStyle = withAlpha(GRIME, DECAL_SMEAR_ALPHA);
      ctx.lineWidth = DECAL_SMEAR_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + DECAL_INSET, cy + DECAL_SMEAR_RISE);
      ctx.quadraticCurveTo(cx, cy - DECAL_SMEAR_RISE, ox + T - DECAL_INSET, cy);
      ctx.stroke();
      break;
    case 'wrapper':
      ctx.translate(cx, cy);
      ctx.rotate(rng() * Math.PI);
      ctx.fillStyle = LITTER_RED;
      ctx.fillRect(
        -DECAL_WRAPPER_W * HALF,
        -DECAL_WRAPPER_H * HALF,
        DECAL_WRAPPER_W,
        DECAL_WRAPPER_H,
      );
      break;
    case 'bottle_caps':
      ctx.fillStyle = LITTER_TIN;
      for (let i = 0; i < DECAL_CAPS; i++) {
        ctx.beginPath();
        ctx.arc(
          cx + (rng() - HALF) * DECAL_SCATTER,
          cy + (rng() - HALF) * DECAL_SCATTER,
          DECAL_CAP_R,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
      break;
    case 'cigarette_butts':
      ctx.fillStyle = LITTER_PAPER;
      for (let i = 0; i < DECAL_BUTTS; i++) {
        ctx.save();
        ctx.translate(cx + (rng() - HALF) * DECAL_SCATTER, cy + (rng() - HALF) * DECAL_SCATTER);
        ctx.rotate(rng() * TWO_PI);
        ctx.fillRect(0, 0, DECAL_BUTT_LENGTH, 2);
        ctx.restore();
      }
      break;
    case 'pizza_crust':
      ctx.strokeStyle = LITTER_WARM;
      ctx.lineWidth = DECAL_CRUST_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(
        cx,
        cy + DECAL_CRUST_R,
        DECAL_CRUST_R,
        Math.PI * DECAL_CRUST_START,
        Math.PI * DECAL_CRUST_END,
      );
      ctx.stroke();
      break;
    case 'receipt':
      ctx.translate(cx, cy);
      ctx.rotate(rng() * Math.PI);
      ctx.fillStyle = LITTER_PAPER;
      ctx.fillRect(
        -DECAL_RECEIPT_W * HALF,
        -DECAL_RECEIPT_H * HALF,
        DECAL_RECEIPT_W,
        DECAL_RECEIPT_H,
      );
      break;
    case 'pill_bottle':
      ctx.translate(cx, cy);
      ctx.rotate(rng() * Math.PI);
      ctx.fillStyle = LITTER_WARM;
      ctx.fillRect(-DECAL_PILL_L * HALF, -DECAL_PILL_R, DECAL_PILL_L, DECAL_PILL_R * 2);
      break;
    case 'footprints':
      ctx.fillStyle = withAlpha(GRIME, DECAL_PRINT_ALPHA);
      for (let i = 0; i < DECAL_PRINTS; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        ctx.beginPath();
        ctx.ellipse(
          cx + side * DECAL_PRINT_GAIT,
          oy + DECAL_INSET + i * DECAL_PRINT_STRIDE,
          DECAL_PRINT_RX,
          DECAL_PRINT_RY,
          0,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
      break;
  }
  ctx.restore();
}
const DECAL_SEED_OFFSET = 809;
const DECAL_RING_ALPHA = 0.35;
const DECAL_RING_R = 7;
const DECAL_FLOOR_SQUASH = 0.7;
const DECAL_PUDDLE_ALPHA = 0.25;
const DECAL_PUDDLE_RX = 13;
const DECAL_PUDDLE_RY = 7;
const DECAL_SMEAR_ALPHA = 0.14;
const DECAL_SMEAR_WIDTH = 6;
const DECAL_SMEAR_RISE = 8;
const DECAL_INSET = 8;
const DECAL_WRAPPER_W = 9;
const DECAL_WRAPPER_H = 5;
const DECAL_CAPS = 3;
const DECAL_SCATTER = 18;
const DECAL_CAP_R = 2;
const DECAL_BUTTS = 3;
const DECAL_BUTT_LENGTH = 5;
const DECAL_CRUST_WIDTH = 3;
const DECAL_CRUST_R = 8;
const DECAL_CRUST_START = 1.15;
const DECAL_CRUST_END = 1.85;
const DECAL_RECEIPT_W = 6;
const DECAL_RECEIPT_H = 12;
const DECAL_PILL_L = 9;
const DECAL_PILL_R = 3;
const DECAL_PRINT_ALPHA = 0.14;
const DECAL_PRINTS = 4;
const DECAL_PRINT_GAIT = 5;
const DECAL_PRINT_STRIDE = 13;
const DECAL_PRINT_RX = 3;
const DECAL_PRINT_RY = 5;

// ── The nest ─────────────────────────────────────────────────────────────────

/** The mattress covers this many tiles across and deep. */
export const NEST_TILES_WIDE = 3;
export const NEST_TILES_DEEP = 2;

const WRAPPER_COLOURS: readonly string[] = ['#c7332b', '#e0b52c', '#3c7fbf'];
const TICKING = '#b0a684';
const TICKING_STRIPE = '#7d8aa0';
const MATTRESS_SIDE = '#8f8a74';
const PEE_STAIN = '#b99a3c';
const BLANKET = '#b07a82';
const PILLOW = '#d2c79c';

/**
 * Her bed: a stained, sagging mattress on the floor, a blanket dragged half
 * off it, two flattened pillows and the wrappers of everything she ate on it.
 * Flat: nothing on it stands higher than a pillow, and anyone may walk across.
 */
export function paintNest(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const rng = mulberry32(NEST_SEED);
  const w = NEST_TILES_WIDE * T;
  const d = NEST_TILES_DEEP * T;
  const x = ox + NEST_INSET;
  const y = oy + NEST_INSET;
  const mw = w - NEST_INSET * 2;
  const md = d - NEST_INSET * 2 - NEST_SIDE_H;
  contactShadow(
    ctx,
    ox + w * HALF,
    oy + d * HALF + NEST_SHADOW_DROP,
    w * NEST_SHADOW_RX,
    d * NEST_SHADOW_RY,
    NEST_SHADOW_ALPHA,
  );
  ctx.save();
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, mw + 4, md + NEST_SIDE_H + 4, NEST_CORNER_R + 2);
  ctx.fill();
  ctx.fillStyle = MATTRESS_SIDE;
  ctx.beginPath();
  ctx.roundRect(x, y + NEST_CORNER_R, mw, md + NEST_SIDE_H - NEST_CORNER_R, NEST_CORNER_R);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, mw, md, NEST_CORNER_R);
  ctx.fillStyle = TICKING;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = withAlpha(TICKING_STRIPE, NEST_STRIPE_ALPHA);
  for (let sx = x + NEST_STRIPE_SPACING; sx < x + mw; sx += NEST_STRIPE_SPACING) {
    ctx.fillRect(sx, y, NEST_STRIPE_W, md);
  }
  // Where she lies: the springs gave out years ago.
  const sag = ctx.createRadialGradient(
    x + mw * NEST_SAG_X,
    y + md * HALF,
    0,
    x + mw * NEST_SAG_X,
    y + md * HALF,
    mw * NEST_SAG_R,
  );
  sag.addColorStop(0, withAlpha(GRIME, NEST_SAG_ALPHA));
  sag.addColorStop(1, withAlpha(GRIME, 0));
  ctx.fillStyle = sag;
  ctx.fillRect(x, y, mw, md);
  for (let i = 0; i < NEST_STAINS; i++) {
    ctx.fillStyle = withAlpha(PEE_STAIN, NEST_STAIN_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      x + rng() * mw,
      y + rng() * md,
      NEST_STAIN_R_MIN + rng() * NEST_STAIN_R_SPAN,
      NEST_STAIN_R_MIN + rng() * NEST_STAIN_R_SPAN * HALF,
      rng() * Math.PI,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = withAlpha(SPILL, NEST_STAIN_ALPHA);
    ctx.stroke();
  }
  // Buttons in the ticking.
  ctx.fillStyle = withAlpha(JUNK_OUTLINE, NEST_BUTTON_ALPHA);
  for (let bx = x + NEST_BUTTON_SPACING; bx < x + mw; bx += NEST_BUTTON_SPACING) {
    for (let by = y + NEST_BUTTON_SPACING * HALF; by < y + md; by += NEST_BUTTON_SPACING * HALF) {
      ctx.fillRect(bx, by, 2, 2);
    }
  }
  ctx.restore();

  // Pillows at the head, flattened grey-yellow.
  for (let i = 0; i < NEST_PILLOWS; i++) {
    const px = x + NEST_PILLOW_INSET + i * (NEST_PILLOW_W + NEST_PILLOW_GAP);
    const py = y + NEST_PILLOW_INSET;
    ctx.fillStyle = JUNK_OUTLINE;
    ctx.beginPath();
    ctx.ellipse(
      px + NEST_PILLOW_W * HALF,
      py + NEST_PILLOW_H * HALF,
      NEST_PILLOW_W * HALF + 1,
      NEST_PILLOW_H * HALF + 1,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = mix(PILLOW, GRIME, rng() * NEST_PILLOW_DIRT);
    ctx.beginPath();
    ctx.ellipse(
      px + NEST_PILLOW_W * HALF,
      py + NEST_PILLOW_H * HALF,
      NEST_PILLOW_W * HALF,
      NEST_PILLOW_H * HALF,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = withAlpha('#fff4dc', NEST_PILLOW_SHEEN);
    ctx.fillRect(px + NEST_PILLOW_W * QUARTER, py + 2, NEST_PILLOW_W * HALF, 2);
  }

  // A blanket dragged off the foot of the bed and over the edge.
  ctx.fillStyle = JUNK_OUTLINE;
  const bx = x + mw * NEST_BLANKET_X;
  const by = y + md * NEST_BLANKET_Y;
  const blanket = (inflate: number): void => {
    ctx.beginPath();
    ctx.moveTo(bx - inflate, by - inflate);
    ctx.quadraticCurveTo(
      bx + mw * NEST_BLANKET_REACH * HALF,
      by - NEST_BLANKET_RUCK - inflate,
      bx + mw * NEST_BLANKET_REACH + inflate,
      by + NEST_BLANKET_RUCK,
    );
    ctx.lineTo(
      bx + mw * NEST_BLANKET_REACH + inflate,
      y + md + NEST_SIDE_H + NEST_BLANKET_HANG + inflate,
    );
    ctx.quadraticCurveTo(
      bx + mw * NEST_BLANKET_REACH * HALF,
      y + md + NEST_SIDE_H + inflate,
      bx - inflate,
      y + md + NEST_BLANKET_HANG + inflate,
    );
    ctx.closePath();
  };
  blanket(2);
  ctx.fill();
  blanket(0);
  const fold = ctx.createLinearGradient(bx, by, bx, y + md + NEST_SIDE_H);
  fold.addColorStop(0, lit(BLANKET, NEST_BLANKET_LIGHT));
  fold.addColorStop(1, lit(BLANKET, -NEST_BLANKET_LIGHT * 2));
  ctx.fillStyle = fold;
  ctx.fill();
  ctx.strokeStyle = withAlpha(JUNK_OUTLINE, NEST_FOLD_ALPHA);
  ctx.lineWidth = 1;
  for (let i = 1; i <= NEST_BLANKET_FOLDS; i++) {
    const fx = bx + (mw * NEST_BLANKET_REACH * i) / (NEST_BLANKET_FOLDS + 1);
    ctx.beginPath();
    ctx.moveTo(fx, by + NEST_BLANKET_RUCK);
    ctx.quadraticCurveTo(fx - NEST_FOLD_BEND, y + md, fx + NEST_FOLD_BEND, y + md + NEST_SIDE_H);
    ctx.stroke();
  }

  // Everything she ate in bed.
  for (let i = 0; i < NEST_LITTER; i++) {
    const lx = x + rng() * mw;
    const ly = y + rng() * (md + NEST_SIDE_H);
    ctx.fillStyle = JUNK_OUTLINE;
    ctx.fillRect(lx - 1, ly - 1, NEST_LITTER_W + 2, NEST_LITTER_H + 2);
    ctx.fillStyle = WRAPPER_COLOURS[i % WRAPPER_COLOURS.length];
    ctx.fillRect(lx, ly, NEST_LITTER_W, NEST_LITTER_H);
  }
  drawJunk(ctx, [can(x + mw * NEST_CAN_X, y + md * NEST_CAN_Y, PILE_CAN_LENGTH, PILE_CAN_RADIUS)]);
}
const NEST_INSET = 6;
const NEST_CORNER_R = 7;
const NEST_SIDE_H = 10;
const NEST_SHADOW_DROP = 8;
const NEST_SHADOW_RX = 0.52;
const NEST_SHADOW_RY = 0.5;
const NEST_SHADOW_ALPHA = 0.5;
const NEST_STRIPE_ALPHA = 0.5;
const NEST_STRIPE_SPACING = 7;
const NEST_STRIPE_W = 2;
const NEST_SAG_X = 0.45;
const NEST_SAG_R = 0.35;
const NEST_SAG_ALPHA = 0.6;
const NEST_STAINS = 7;
const NEST_STAIN_ALPHA = 0.5;
const NEST_STAIN_R_MIN = 6;
const NEST_STAIN_R_SPAN = 12;
const NEST_BUTTON_ALPHA = 0.35;
const NEST_BUTTON_SPACING = 30;
const NEST_PILLOWS = 2;
const NEST_PILLOW_INSET = 6;
const NEST_PILLOW_W = 34;
const NEST_PILLOW_H = 18;
const NEST_PILLOW_GAP = 8;
const NEST_PILLOW_DIRT = 0.35;
const NEST_PILLOW_SHEEN = 0.3;
const NEST_BLANKET_X = 0.55;
const NEST_BLANKET_Y = 0.35;
const NEST_BLANKET_REACH = 0.36;
const NEST_BLANKET_RUCK = 6;
const NEST_BLANKET_HANG = 12;
const NEST_BLANKET_LIGHT = 0.18;
const NEST_BLANKET_FOLDS = 4;
const NEST_FOLD_ALPHA = 0.35;
const NEST_FOLD_BEND = 4;
const NEST_LITTER = 9;
const NEST_LITTER_W = 5;
const NEST_LITTER_H = 3;
const NEST_CAN_X = 0.2;
const NEST_CAN_Y = 0.8;

// ── Barricade ────────────────────────────────────────────────────────────────

export const BARRICADE_FRAMES = 3;

/**
 * Junk shoved across a doorway as the room locks: a heap that slides in from
 * the left, a third of the doorway more each frame, until the last frame fills
 * it wall to wall — joined at both edges like a heap against its neighbours,
 * so a doorway two tiles wide is one continuous barricade.
 */
export function paintBarricade(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  frame: number,
): void {
  const rng = mulberry32(BARRICADE_SEED);
  const ground = oy + GROUND_Y;
  const reach = (frame + 1) / BARRICADE_FRAMES;
  const full = frame === BARRICADE_FRAMES - 1;
  const left = ox - PILE_JOIN_OVERRUN;
  const right = full ? ox + T + PILE_JOIN_OVERRUN : ox + T * reach;
  const profile = joinedMoundProfile(
    moundProfile(BARRICADE_PEAK * reach + BARRICADE_PEAK_FLOOR, rng),
    true,
    full,
    PILE_JOIN_HEIGHT,
  );
  contactShadow(
    ctx,
    ox + T * reach * HALF,
    oy + SHADOW_Y,
    T * reach * HALF + PILE_JOIN_SHADOW_REACH,
    PILE_SHADOW_RY,
    PILE_SHADOW_ALPHA,
  );
  const items: JunkItem[] = [
    mound({ left, right, baseY: ground, profile, rng, footRagged: PILE_FOOT_RAGGED }),
    box({
      x: ox + BARRICADE_INSET,
      baseY: ground - BARRICADE_RIDE,
      w: BARRICADE_BOX_W,
      h: BARRICADE_BOX_H,
      d: PILE_LID_D,
      tone: rng() * 2 - 1,
      rng,
    }),
    bag({
      cx: ox + BARRICADE_BAG_X,
      baseY: ground + 1,
      rx: BARRICADE_BAG_RX,
      ry: BARRICADE_BAG_RY,
      palette: BLACK_BAG,
      knot: true,
      rng,
    }),
  ];
  if (frame >= 1) {
    items.push(
      tilted(
        bundle({
          x: ox + T * HALF - BARRICADE_BOX_W * HALF,
          baseY: ground - BARRICADE_RIDE,
          w: BARRICADE_BOX_W,
          h: BARRICADE_BUNDLE_H,
          d: PILE_LID_D,
          age: rng(),
          rng,
        }),
        ox + T * HALF,
        ground - BARRICADE_RIDE,
        toRadians(BARRICADE_TILT_DEGREES),
      ),
      upturnedChair(
        ox + BARRICADE_CHAIR_X,
        ground - BARRICADE_CHAIR_RIDE,
        CHAIR_SEAT_W,
        CHAIR_LEG_LENGTH,
      ),
    );
  }
  if (full) {
    items.push(
      // A door plank wedged across the whole opening.
      stick({
        x0: ox + BARRICADE_INSET,
        y0: ground - BARRICADE_PLANK_LOW,
        x1: ox + T - BARRICADE_INSET,
        y1: ground - BARRICADE_PLANK_HIGH,
        width: BARRICADE_PLANK_WIDTH,
        palette: WOOD_LEG,
      }),
      box({
        x: ox + T - BARRICADE_BOX_W - BARRICADE_INSET,
        baseY: ground,
        w: BARRICADE_BOX_W,
        h: BARRICADE_BOX_H,
        d: PILE_LID_D,
        tone: rng() * 2 - 1,
        rng,
      }),
      bag({
        cx: ox + T * HALF,
        baseY: ground + 1,
        rx: BARRICADE_BAG_RX,
        ry: BARRICADE_BAG_RY,
        palette: WHITE_BAG,
        knot: true,
        rng,
      }),
    );
  }
  drawJunk(ctx, items);
}
const BARRICADE_PEAK = 40;
const BARRICADE_PEAK_FLOOR = 16;
const BARRICADE_INSET = 4;
const BARRICADE_RIDE = 22;
const BARRICADE_BOX_W = 22;
const BARRICADE_BOX_H = 16;
const BARRICADE_BUNDLE_H = 12;
const BARRICADE_TILT_DEGREES = 12;
const BARRICADE_CHAIR_X = 42;
const BARRICADE_CHAIR_RIDE = 34;
const BARRICADE_PLANK_LOW = 14;
const BARRICADE_PLANK_HIGH = 30;
const BARRICADE_PLANK_WIDTH = 6;
const BARRICADE_BAG_X = 16;
const BARRICADE_BAG_RX = 11;
const BARRICADE_BAG_RY = 10;
