/**
 * The circus grounds as an authored template, in tile offsets from the
 * grounds' centre.
 *
 * The grounds are a plan rather than a scatter for the same reason Briar
 * Hollow is (`briarHollowLayout.ts`): the Starlight Tent's door, the pavilions and
 * the open forecourt are authored ground the gates and the travel landing are
 * written against. **Nothing here may depend on the world seed**; the seed
 * only picks paint variants when the art is drawn.
 *
 * What is fixed and what rotates:
 *
 * - The Starlight Tent, its forecourt and the side-show pavilions are fixed. The Starlight
 *   Tent's door faces south because the tent's interior is entered from the
 *   south, so the forecourt in front of it is south too.
 * - The approach road comes in from whichever town gate is nearest, at any
 *   angle. The entry arch stands where that road crosses the grounds' rim, and
 *   the rim dressing (the torches, and later the wagons) is shifted round the
 *   ring off the road and clear of the arch — so those follow the approach.
 *
 * Dressing that could block movement lives on the rim (radius 12 and out),
 * so the field a party crosses stays open; the field gets decals only.
 */

import type { TilePoint, TileRect } from '../town/townPlan';

/** Radius of the grounds' disc, in tiles. Every offset below is measured from its centre. */
export const CIRCUS_RADIUS_TILES = 14;

/**
 * Tiles past the grounds' rim kept clear of forest, boulders and cliff
 * ledges. The wagons and booths stand out to half a tile past the rim and are
 * walked round and played from the tiles beside them, and a tree's canopy
 * climbs two tiles up the screen from its trunk, so anything blocking any
 * closer would bury the south rim's booths in leaves or fence one-tile
 * pockets beside them.
 */
export const CIRCUS_TERRAIN_CLEARANCE_TILES = 3;

/**
 * The tent's building name: the overworld registers its door under it, and the
 * interior scene recognises the maze by it.
 */
export const STARLIGHT_TENT_NAME = 'The Starlight Tent';

// ── Structures ───────────────────────────────────────────────────────────────

/** Every structure the grounds stamp, as the prop id its sheet row is named by. */
export type CircusStructureId =
  | 'starlight_tent'
  | 'pavilion_tightrope'
  | 'pavilion_feats_of_flesh'
  | 'pavilion_fortunes'
  | 'arch_post'
  | 'flame_lamp'
  | CircusRimPropId;

/** The rim's larger dressing: the wagons, the midway booths and the crate stack. */
export type CircusRimPropId =
  | 'cage_wagon'
  | 'clown_caravan'
  | 'ticket_booth'
  | 'prop_wagon'
  | 'high_striker'
  | 'game_booth'
  | 'crate_stack';

/** `tall` blocks sight (`CIRCUS_STRUCTURE_TALL`); `low` is seen past (`CIRCUS_STRUCTURE_LOW`). */
export type CircusStructureKind = 'tall' | 'low';

/** A tile of a footprint, as a step from its north-west corner. */
export interface FootprintStep {
  readonly dx: number;
  readonly dy: number;
}

export interface CircusStructureSpec {
  readonly kind: CircusStructureKind;
  /** Footprint rectangle, in tiles. */
  readonly w: number;
  readonly h: number;
  /**
   * Tiles of the rectangle left walkable: the corners a round tent's base
   * clears, and a doorway. Everything else in the rectangle blocks.
   */
  readonly openTiles: ReadonlyArray<FootprintStep>;
  /**
   * The tile the whole structure is drawn from, and sorts on. Always in the
   * footprint's bottom row, so the structure sorts on its foot, and always a
   * blocked tile, because only a decoration tile is drawn by the Y-sorted pass.
   */
  readonly drawTile: FootprintStep;
  /** The doorway, if the structure can be entered: its west tile and its width. */
  readonly door?: { readonly dx: number; readonly dy: number; readonly width: number };
}

const STARLIGHT_TENT_W = 12;
const STARLIGHT_TENT_H = 5;
const STARLIGHT_TENT_LAST_COL = STARLIGHT_TENT_W - 1;
const STARLIGHT_TENT_LAST_ROW = STARLIGHT_TENT_H - 1;
/** The door's west tile: the middle two columns of the south row. */
const STARLIGHT_TENT_DOOR_DX = STARLIGHT_TENT_W / 2 - 1;
const STARLIGHT_TENT_DOOR_WIDTH = 2;
const PAVILION_W = 3;
const PAVILION_H = 2;
const WAGON_W = 3;
const BOOTH_W = 2;

/** A one-row rim footprint, drawn from its west tile. */
function rimFootprint(kind: CircusStructureKind, w: number): CircusStructureSpec {
  return { kind, w, h: 1, openTiles: [], drawTile: { dx: 0, dy: 0 } };
}

/**
 * The Starlight Tent's plan is an ellipse inscribed in its 12 x 5 rectangle, and an
 * ellipse that flat clears all four corner tiles of the rectangle outright:
 * at a corner column's inner edge the base is already more than a tile in
 * from the long side. So those four tiles stay walkable ground rather than
 * blocked tiles drawn as empty grass.
 */
export const CIRCUS_STRUCTURES: Readonly<Record<CircusStructureId, CircusStructureSpec>> = {
  starlight_tent: {
    kind: 'tall',
    w: STARLIGHT_TENT_W,
    h: STARLIGHT_TENT_H,
    openTiles: [
      { dx: 0, dy: 0 },
      { dx: STARLIGHT_TENT_LAST_COL, dy: 0 },
      { dx: 0, dy: STARLIGHT_TENT_LAST_ROW },
      { dx: STARLIGHT_TENT_LAST_COL, dy: STARLIGHT_TENT_LAST_ROW },
      { dx: STARLIGHT_TENT_DOOR_DX, dy: STARLIGHT_TENT_LAST_ROW },
      { dx: STARLIGHT_TENT_DOOR_DX + 1, dy: STARLIGHT_TENT_LAST_ROW },
    ],
    drawTile: { dx: 1, dy: STARLIGHT_TENT_LAST_ROW },
    door: {
      dx: STARLIGHT_TENT_DOOR_DX,
      dy: STARLIGHT_TENT_LAST_ROW,
      width: STARLIGHT_TENT_DOOR_WIDTH,
    },
  },
  pavilion_tightrope: {
    kind: 'tall',
    w: PAVILION_W,
    h: PAVILION_H,
    openTiles: [],
    drawTile: { dx: 0, dy: PAVILION_H - 1 },
  },
  pavilion_feats_of_flesh: {
    kind: 'tall',
    w: PAVILION_W,
    h: PAVILION_H,
    openTiles: [],
    drawTile: { dx: 0, dy: PAVILION_H - 1 },
  },
  pavilion_fortunes: {
    kind: 'tall',
    w: PAVILION_W,
    h: PAVILION_H,
    openTiles: [],
    drawTile: { dx: 0, dy: PAVILION_H - 1 },
  },
  arch_post: rimFootprint('low', 1),
  flame_lamp: rimFootprint('low', 1),
  cage_wagon: rimFootprint('low', WAGON_W),
  clown_caravan: rimFootprint('low', WAGON_W),
  prop_wagon: rimFootprint('low', WAGON_W),
  ticket_booth: rimFootprint('low', BOOTH_W),
  game_booth: rimFootprint('low', BOOTH_W),
  high_striker: rimFootprint('low', 1),
  // A stack of crates and trunks is head-high and solid: it hides what is behind it.
  crate_stack: rimFootprint('tall', BOOTH_W),
};

/** Whether a footprint step is one of the structure's blocked tiles. */
export function isBlockedStep(spec: CircusStructureSpec, dx: number, dy: number): boolean {
  if (dx < 0 || dy < 0 || dx >= spec.w || dy >= spec.h) return false;
  return !spec.openTiles.some((open) => open.dx === dx && open.dy === dy);
}

/** Every blocked tile of a structure's footprint, as steps from its north-west corner. */
export function blockedSteps(spec: CircusStructureSpec): FootprintStep[] {
  const steps: FootprintStep[] = [];
  for (let dy = 0; dy < spec.h; dy++) {
    for (let dx = 0; dx < spec.w; dx++) {
      if (isBlockedStep(spec, dx, dy)) steps.push({ dx, dy });
    }
  }
  return steps;
}

/** Where a fixed structure stands: its footprint's north-west corner, from the centre. */
export interface CircusStructurePlacement {
  readonly structure:
    'starlight_tent' | 'pavilion_tightrope' | 'pavilion_feats_of_flesh' | 'pavilion_fortunes';
  readonly dx: number;
  readonly dy: number;
}

/**
 * The fixed structures. The Starlight Tent stands north of the centre so its door
 * row is the centre row and the forecourt south of it stays open. The
 * pavilions flank it to the north-west and north-east, behind the line of
 * its door, and the fortune teller sits north of it — so the whole south
 * field is open ground.
 */
export const CIRCUS_STRUCTURE_PLACEMENTS: ReadonlyArray<CircusStructurePlacement> = [
  { structure: 'starlight_tent', dx: -STARLIGHT_TENT_W / 2, dy: -STARLIGHT_TENT_LAST_ROW },
  { structure: 'pavilion_tightrope', dx: -11, dy: -5 },
  { structure: 'pavilion_feats_of_flesh', dx: 8, dy: -5 },
  { structure: 'pavilion_fortunes', dx: 3, dy: -9 },
];

/**
 * The Starlight Tent's two king poles, in tiles: `x` across the footprint from its
 * west edge, `heightTiles` from the ground to the pole's cap. Shared by the
 * painter, which raises the canvas to them, and by whatever draws a live
 * pennant on each cap, so the two can never disagree about where a cap is.
 */
export const STARLIGHT_TENT_KING_POLES: ReadonlyArray<{
  readonly x: number;
  readonly heightTiles: number;
}> = [
  { x: 4, heightTiles: 4.6 },
  { x: 8, heightTiles: 4.6 },
];

/** Depth into the Starlight Tent's footprint, in tiles from its south edge, at which both king poles stand. */
export const STARLIGHT_TENT_KING_POLE_DEPTH_TILES = STARLIGHT_TENT_H / 2;

// ── The approach road ────────────────────────────────────────────────────────

/** Rows south of the centre the approach road starts on: the middle of the forecourt. */
export const CIRCUS_ROAD_START_ROW = 2;
/**
 * The columns, from the centre, a road that must leave northward turns up:
 * the two-tile gaps between the Starlight Tent's flanks and the side-show pavilions,
 * so the road runs past the tent to the forecourt instead of into its back.
 */
export const CIRCUS_ROAD_FLANK_COLUMNS = { east: 7, west: -8 } as const;

// ── Keep-clear bands ─────────────────────────────────────────────────────────

/** A named band of the field that must stay open ground, in offsets from the centre, inclusive. */
export interface KeepClearBand {
  readonly dxFrom: number;
  readonly dxTo: number;
  readonly dyFrom: number;
  readonly dyTo: number;
}

export type CircusKeepClearBandName = 'forecourt' | 'door';

/**
 * Ground the grounds keep open. The forecourt is the open field in front of
 * the tent; the door band is the Starlight Tent's doorway and the two rows in front
 * of it. The approach road is kept clear too, but it depends on the site's
 * heading, so it is measured from the road itself.
 */
export const CIRCUS_KEEP_CLEAR_BANDS: Readonly<Record<CircusKeepClearBandName, KeepClearBand>> = {
  forecourt: { dxFrom: -12, dxTo: 12, dyFrom: 1, dyTo: 3 },
  door: {
    dxFrom: STARLIGHT_TENT_DOOR_DX - STARLIGHT_TENT_W / 2,
    dxTo: STARLIGHT_TENT_DOOR_DX - STARLIGHT_TENT_W / 2 + STARLIGHT_TENT_DOOR_WIDTH - 1,
    dyFrom: 0,
    dyTo: 2,
  },
};

/** The tiles a band covers on a site with centre `centre`. */
export function keepClearBandTiles(band: KeepClearBand, centre: TilePoint): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let dy = band.dyFrom; dy <= band.dyTo; dy++) {
    for (let dx = band.dxFrom; dx <= band.dxTo; dx++) {
      tiles.push({ x: centre.x + dx, y: centre.y + dy });
    }
  }
  return tiles;
}

// ── The rim ──────────────────────────────────────────────────────────────────

/** Where the rim band starts: a blocking prop stands at least this far from the centre. */
export const CIRCUS_RIM_INNER_RADIUS_TILES = 12;
/** Radius of the torch ring. */
export const CIRCUS_TORCH_RING_RADIUS_TILES = CIRCUS_RADIUS_TILES - 1;
const DEGREES_PER_TURN = 360;
const DEGREES_PER_HALF_TURN = DEGREES_PER_TURN / 2;
const TORCH_COUNT = 6;
/**
 * The torches' bearings, in degrees clockwise from east: evenly round the
 * ring from due east, as the grounds have always had them.
 */
export const CIRCUS_TORCH_BEARINGS_DEG: ReadonlyArray<number> = Array.from(
  { length: TORCH_COUNT },
  (_unused, index) => (index * DEGREES_PER_TURN) / TORCH_COUNT,
);
const RIM_NUDGE_STEP_DEG = 12;
const RIM_NUDGE_STEPS_EACH_WAY = 3;
/**
 * How far round the ring a rim prop is walked, in turn, when its own bearing
 * lands on the road or beside the arch: its own bearing first, then a step
 * either way, then two, nearest first. The list is fixed, so a site's rim
 * depends only on its road.
 */
export const CIRCUS_RIM_BEARING_NUDGES_DEG: ReadonlyArray<number> = [
  0,
  ...Array.from({ length: RIM_NUDGE_STEPS_EACH_WAY }, (_unused, index) => {
    const step = (index + 1) * RIM_NUDGE_STEP_DEG;
    return [step, -step];
  }).flat(),
];
/** No rim prop may stand this close to an arch post, so the arch reads on its own. */
export const CIRCUS_ARCH_CLEARANCE_TILES = 2;

/** The tile a bearing and radius fall on, from the centre. */
export function ringTile(centre: TilePoint, bearingDeg: number, radiusTiles: number): TilePoint {
  const radians = (bearingDeg * Math.PI) / DEGREES_PER_HALF_TURN;
  return {
    x: Math.round(centre.x + Math.cos(radians) * radiusTiles),
    y: Math.round(centre.y + Math.sin(radians) * radiusTiles),
  };
}

/**
 * The first tile, walking `CIRCUS_RIM_BEARING_NUDGES_DEG` out from a rim
 * prop's own bearing, that `isFree` accepts — or null when none does, in which
 * case the prop is simply not stood up.
 */
export function resolveRimTile(
  centre: TilePoint,
  bearingDeg: number,
  radiusTiles: number,
  isFree: (tile: TilePoint) => boolean,
): TilePoint | null {
  for (const nudge of CIRCUS_RIM_BEARING_NUDGES_DEG) {
    const tile = ringTile(centre, bearingDeg + nudge, radiusTiles);
    if (isFree(tile)) return tile;
  }
  return null;
}

/** Where the rim band ends: no tile of a rim prop stands further out than this. */
export const CIRCUS_RIM_OUTER_RADIUS_TILES = 14.5;
/**
 * The radii a rim prop's footprint centre is tried at, outermost first: a
 * prop pushed out to the grounds' edge leaves the most of the field open.
 */
const RIM_PROP_RADIUS_STEP_TILES = 0.25;
export const CIRCUS_RIM_PROP_RADII_TILES: ReadonlyArray<number> = Array.from(
  {
    length:
      Math.floor(
        (CIRCUS_RIM_OUTER_RADIUS_TILES - CIRCUS_TORCH_RING_RADIUS_TILES) /
          RIM_PROP_RADIUS_STEP_TILES,
      ) + 1,
  },
  (_unused, index) => CIRCUS_RIM_OUTER_RADIUS_TILES - index * RIM_PROP_RADIUS_STEP_TILES,
);

/**
 * Where a rim prop is stood: at a fixed bearing, or a fixed turn either side
 * of wherever the entry arch stands, so the ticket booth greets whoever comes
 * up the road whichever way it arrives.
 */
export type RimPropBearing =
  | { readonly kind: 'fixed'; readonly deg: number }
  | { readonly kind: 'beside_arch'; readonly offsetDeg: number };

export interface RimPropAnchor {
  readonly prop: CircusRimPropId;
  readonly bearing: RimPropBearing;
}

/**
 * The rim, in placement order. Every footprint is one row, so the long side
 * lies along the rim where the rim runs east-west: the wagons are parked round
 * the back (north), the midway booths face the open south field, and the
 * crate stack sits behind the Starlight Tent, well clear of the Massive Clown's spawn. Bearings
 * are degrees clockwise from east, between the flame lamps.
 */
export const CIRCUS_RIM_PROPS: ReadonlyArray<RimPropAnchor> = [
  { prop: 'ticket_booth', bearing: { kind: 'beside_arch', offsetDeg: 24 } },
  { prop: 'cage_wagon', bearing: { kind: 'fixed', deg: 260 } },
  { prop: 'crate_stack', bearing: { kind: 'fixed', deg: 282 } },
  { prop: 'clown_caravan', bearing: { kind: 'fixed', deg: 212 } },
  { prop: 'prop_wagon', bearing: { kind: 'fixed', deg: 150 } },
  { prop: 'game_booth', bearing: { kind: 'fixed', deg: 76 } },
  { prop: 'high_striker', bearing: { kind: 'fixed', deg: 102 } },
];

/**
 * A one-row footprint of width `w` centred as nearly as tiles allow on the
 * point at `bearingDeg`, `radiusTiles` out: its north-west corner.
 */
export function rimFootprintOrigin(
  centre: TilePoint,
  bearingDeg: number,
  radiusTiles: number,
  w: number,
): TilePoint {
  const radians = (bearingDeg * Math.PI) / DEGREES_PER_HALF_TURN;
  const pointX = centre.x + Math.cos(radians) * radiusTiles;
  const pointY = centre.y + Math.sin(radians) * radiusTiles;
  return { x: Math.round(pointX - (w - 1) / 2), y: Math.round(pointY) };
}

/** The bearing, in degrees clockwise from east, of a tile from the centre. */
export function bearingOf(centre: TilePoint, tile: TilePoint): number {
  return (Math.atan2(tile.y - centre.y, tile.x - centre.x) * DEGREES_PER_HALF_TURN) / Math.PI;
}

// ── Overhead and ground dressing ─────────────────────────────────────────────

/**
 * A named point a bunting string can be tied to. King poles and pavilion
 * peaks are fixed; a torch is named by its index in `CIRCUS_TORCH_BEARINGS_DEG`
 * and resolved to wherever that torch was stood.
 */
export type CircusAnchorName =
  | 'king_pole_west'
  | 'king_pole_east'
  | 'pavilion_tightrope'
  | 'pavilion_feats_of_flesh'
  | 'pavilion_fortunes'
  | `torch_${number}`;

/** A string of bunting between two anchors. A dropped span hangs limp from its first anchor. */
export interface BuntingSpan {
  readonly from: CircusAnchorName;
  readonly to: CircusAnchorName;
  readonly dropped: boolean;
}

export const CIRCUS_BUNTING_SPANS: ReadonlyArray<BuntingSpan> = [
  { from: 'king_pole_west', to: 'torch_3', dropped: false },
  { from: 'king_pole_west', to: 'torch_4', dropped: false },
  { from: 'king_pole_east', to: 'torch_0', dropped: false },
  { from: 'king_pole_east', to: 'torch_5', dropped: true },
  { from: 'king_pole_west', to: 'pavilion_tightrope', dropped: false },
  { from: 'king_pole_east', to: 'pavilion_feats_of_flesh', dropped: false },
  { from: 'king_pole_east', to: 'pavilion_fortunes', dropped: true },
];

/** A string of festoon bulbs between two anchors. */
export interface FestoonSpan {
  readonly from: CircusAnchorName;
  readonly to: CircusAnchorName;
}

/**
 * The festoons: two strings of bulbs from the king poles down to the flame
 * lamps either side of the forecourt, so they frame the door the party is
 * walking to. Most of their bulbs are dead.
 */
export const CIRCUS_FESTOON_SPANS: ReadonlyArray<FestoonSpan> = [
  { from: 'king_pole_west', to: 'torch_2' },
  { from: 'king_pole_east', to: 'torch_1' },
];

/**
 * A point on the grounds in tiles, measured from the centre tile's north-west
 * corner rather than its middle, so a decal can sit on a tile edge — the Starlight
 * Tent's doorway is two tiles wide, and its middle is the edge between them.
 */
export interface GroundsPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Flat dressing baked into the ground, placed by the layout. The wagon ruts
 * and the stain by the cage wagon are placed off wherever those wagons stood,
 * so they are not listed here.
 */
export type CircusDecal =
  /** A practice ring's chalk curb, long since scuffed half away. */
  | { readonly kind: 'chalk_ring'; readonly at: GroundsPoint; readonly radiusTiles: number }
  /** Sawdust trodden out of a tent door onto the lot. */
  | {
      readonly kind: 'sawdust_path';
      readonly from: GroundsPoint;
      readonly to: GroundsPoint;
      readonly widthTiles: number;
    }
  /** Popcorn, trampled tickets and confetti. */
  | { readonly kind: 'litter'; readonly at: GroundsPoint; readonly radiusTiles: number }
  /** A clown's oversized shoe prints, walking from `from` to `to`. */
  | { readonly kind: 'shoe_prints'; readonly from: GroundsPoint; readonly to: GroundsPoint };

/** The middle of the Starlight Tent's doorway, on its sill. */
const STARLIGHT_TENT_DOORWAY: GroundsPoint = { x: 0, y: 1 };

/**
 * Low contrast and sparse by rule: every one of these lies under the bodies
 * that walk the lot. The chalk ring stands off the road's axes
 * (the forecourt row and the door's column), so the road never cuts it.
 */
export const CIRCUS_DECALS: ReadonlyArray<CircusDecal> = [
  { kind: 'chalk_ring', at: { x: 5.5, y: 7 }, radiusTiles: 2.2 },
  {
    kind: 'sawdust_path',
    from: STARLIGHT_TENT_DOORWAY,
    to: { x: 0.3, y: 4.2 },
    widthTiles: 1.7,
  },
  { kind: 'sawdust_path', from: { x: -9.5, y: -3 }, to: { x: -8.6, y: -0.6 }, widthTiles: 0.9 },
  { kind: 'sawdust_path', from: { x: 9.5, y: -3 }, to: { x: 8.4, y: -0.8 }, widthTiles: 0.9 },
  { kind: 'sawdust_path', from: { x: 4.5, y: -7 }, to: { x: 6.6, y: -5.4 }, widthTiles: 0.8 },
  { kind: 'shoe_prints', from: { x: 3.6, y: 8.2 }, to: { x: 0.3, y: 1.5 } },
  { kind: 'litter', at: { x: -4.5, y: 8.5 }, radiusTiles: 2.4 },
  { kind: 'litter', at: { x: 2.5, y: 11 }, radiusTiles: 1.8 },
  { kind: 'litter', at: { x: -2.2, y: 3.6 }, radiusTiles: 1.4 },
];

// ── The entry arch ───────────────────────────────────────────────────────────

/**
 * Where the approach road crosses the rim, and the arch that stands over it:
 * one post on the first tile off the road to either side.
 */
export interface CircusEntryArch {
  /** The road's centre-line tile at the rim. */
  readonly crossing: TilePoint;
  /** Which way the road runs where it crosses. */
  readonly axis: 'east-west' | 'north-south';
  /** The posts actually stood, west or north first; fewer than two where the ground refused one. */
  readonly posts: ReadonlyArray<TilePoint>;
}

/** Tiles from the road's centre line to the nearest place an arch post may stand: its half-width plus one. */
export const ARCH_POST_OFFSET_TILES = 2;
/**
 * The furthest from the centre line a post is walked looking for ground that
 * is not road: where the approach meets a town highway the paving is wider.
 */
export const ARCH_POST_MAX_OFFSET_TILES = 4;
/**
 * Height of an arch post's cap above the ground, in tiles: where the arch's
 * crossbar is hung, shared by the post painter and whatever draws the bar.
 */
export const CIRCUS_ARCH_POST_HEIGHT_TILES = 2.6;

/**
 * The arch for a road whose centre line runs along `centreLine` from the
 * centre outward. Null when the road never leaves the grounds, which a
 * generated map does not do.
 */
export function entryArchFor(
  centre: TilePoint,
  centreLine: ReadonlyArray<TilePoint>,
  canStandPost: (tile: TilePoint) => boolean,
): CircusEntryArch | null {
  for (let index = 1; index < centreLine.length; index++) {
    const tile = centreLine[index];
    if (Math.hypot(tile.x - centre.x, tile.y - centre.y) < CIRCUS_RADIUS_TILES) continue;
    const previous = centreLine[index - 1];
    const axis = previous.y === tile.y ? 'east-west' : 'north-south';
    const posts: TilePoint[] = [];
    for (const side of [-1, 1] as const) {
      for (let offset = ARCH_POST_OFFSET_TILES; offset <= ARCH_POST_MAX_OFFSET_TILES; offset++) {
        const post =
          axis === 'east-west'
            ? { x: tile.x, y: tile.y + side * offset }
            : { x: tile.x + side * offset, y: tile.y };
        if (!canStandPost(post)) continue;
        posts.push(post);
        break;
      }
    }
    return { crossing: tile, axis, posts };
  }
  return null;
}

// ── Sprite keys ──────────────────────────────────────────────────────────────

const STRUCTURE_KEY_PREFIX = 'circus:';
const PART_KEY_PREFIX = 'circus_part:';

const STRUCTURE_IDS: ReadonlyArray<CircusStructureId> = Object.keys(CIRCUS_STRUCTURES).filter(
  (id): id is CircusStructureId => id in CIRCUS_STRUCTURES,
);

/** The key a structure's drawing tile carries. */
export function circusStructureSpriteKey(structure: CircusStructureId): string {
  return `${STRUCTURE_KEY_PREFIX}${structure}`;
}

/** The key every other blocked tile carries: the step from it to the drawing tile. */
export function circusStructurePartSpriteKey(dx: number, dy: number): string {
  return `${PART_KEY_PREFIX}${dx},${dy}`;
}

/** The structure a drawing tile's key names, or null for any other key. */
export function circusStructureFromSpriteKey(key: string | undefined): CircusStructureId | null {
  if (!key?.startsWith(STRUCTURE_KEY_PREFIX)) return null;
  const id = key.slice(STRUCTURE_KEY_PREFIX.length);
  return STRUCTURE_IDS.find((known) => known === id) ?? null;
}

// ── A generated site ─────────────────────────────────────────────────────────

/** One structure as stamped on a map: which, and its footprint rectangle in map tiles. */
export interface PlacedCircusStructure {
  readonly structure: CircusStructureId;
  readonly rect: TileRect;
}

/**
 * The grounds as generated on one map: what was stamped and where. Carried out
 * of the generator on `OverworldData` so the gates, the minimap and the live
 * dressing read the grounds off the map rather than re-deriving them.
 */
export interface CircusGroundsSite {
  readonly centre: TilePoint;
  readonly radiusTiles: number;
  readonly structures: ReadonlyArray<PlacedCircusStructure>;
  readonly arch: CircusEntryArch | null;
  /** Each torch's tile, by its index in `CIRCUS_TORCH_BEARINGS_DEG`; null where none could stand. */
  readonly torches: ReadonlyArray<TilePoint | null>;
}
