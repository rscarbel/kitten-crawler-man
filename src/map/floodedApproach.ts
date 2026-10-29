import type { GauntletBossType } from './bossRoomSizes';
import { MAX_WATER_DEPTH } from './tileTypes';
import { PARTY_TRAIL_SPACING_TILES } from '../systems/partyTrail';
import { tileCoordKey } from './tileIndex';

type Point = { x: number; y: number };

/**
 * Width of every corridor the generator can carve wide: its centre line plus
 * one tile either side. A flooded approach is carved at exactly this width, so
 * the spec names it as a literal rather than a number the planner would have
 * to honour some other way.
 */
export const WIDE_CORRIDOR_WIDTH_TILES = 3;

/** The default walk from the gateway safe room to the boss room door. */
export const FLOODED_APPROACH_DEFAULT_MIN_LENGTH_TILES = 24;

/**
 * A gauntlet whose corridor from the gateway safe room to the boss room door is
 * flooded: a straight-sided wide corridor, its far half under water deepening
 * toward the door, with a barrel stack seated on one side wall.
 */
export interface FloodedApproachSpec {
  readonly kind: 'flooded';
  /** Shortest the corridor may be, measured along its centre line outside both rooms. */
  readonly minLengthTiles: number;
  readonly widthTiles: typeof WIDE_CORRIDOR_WIDTH_TILES;
}

/**
 * Where along the wet half the barrel seat sits, as a share of the wet half's
 * length from where the water starts.
 */
const BARREL_SEAT_WET_FRACTION = 0.25;

/** Cross-sections of clear margin past the follower's trail, so a companion has room to get through too. */
const TRIGGER_MARGIN_SECTIONS = 3;

/**
 * Cross-sections from the barrel seat to the trigger line. A follower trails
 * the leader by the party trail spacing, so the line sits that far plus a
 * margin past the seat: both crawlers are beyond the barrels when they fall.
 */
export const TRIGGER_SECTIONS_PAST_SEAT = PARTY_TRAIL_SPACING_TILES + TRIGGER_MARGIN_SECTIONS;

/** One step across the corridor at a centre-line tile: the tiles of its width, side to side. */
export interface CorridorCrossSection {
  /** The centre-line tile. */
  readonly centre: Point;
  /** Unit step along the corridor toward the boss room door. */
  readonly along: Point;
  /** Every tile of the corridor's width here, in order from one wall to the other. */
  readonly tiles: readonly Point[];
}

/**
 * The flooded corridor as planned: its geometry, water and barrel seat.
 *
 * Every list runs from the gateway safe room toward the boss room door, so a
 * reader walking it walks the way the party does.
 */
export interface FloodedApproachLayout {
  /** The corridor's centre line outside both rooms, one cross-section per step. */
  readonly crossSections: readonly CorridorCrossSection[];
  /** Index into {@link crossSections} where the water starts: the corridor's midpoint. */
  readonly wetFromIndex: number;
  /** Depth of each cross-section, 0 where it is dry; reaches `MAX_WATER_DEPTH` at the door. */
  readonly depths: readonly number[];
  /**
   * Carved tiles outside both rooms that no cross-section spans: the outer
   * corner of a bend, which the first leg's width carves past the bend's centre
   * line. Each floods with the deepest cross-section beside it, so a bend in the
   * wet half leaves no dry tile in the water.
   */
  readonly bendCorners: readonly { readonly tile: Point; readonly crossSectionIndex: number }[];
  /**
   * The alcove cut into one side wall that the barrel stack stands in, so the
   * corridor keeps its full width beside it.
   */
  readonly barrelSeat: {
    readonly tile: Point;
    readonly crossSectionIndex: number;
    readonly wall: BarrelSeatWall;
  };
  /**
   * Tiles spanning the corridor's full width {@link TRIGGER_SECTIONS_PAST_SEAT}
   * steps past the barrel seat, toward the door: crossing any of them is
   * crossing the line.
   */
  readonly triggerLine: readonly Point[];
}

/** A flooded corridor as built, for the systems that stage the approach to its boss. */
export interface FloodedApproachData extends FloodedApproachLayout {
  readonly bossType: GauntletBossType;
}

/**
 * Depth of each cross-section: dry up to the midpoint, then rising from 1 to
 * `MAX_WATER_DEPTH`, which the last cross-section (the door) always reaches.
 */
export function floodedApproachDepths(sectionCount: number, wetFromIndex: number): number[] {
  const wetLength = sectionCount - wetFromIndex;
  return Array.from({ length: sectionCount }, (_, index) => {
    if (index < wetFromIndex) return 0;
    const progress = wetLength <= 1 ? 1 : (index - wetFromIndex) / (wetLength - 1);
    return 1 + Math.round(progress * (MAX_WATER_DEPTH - 1));
  });
}

/** A side wall of a corridor, named by the compass side of the centre line it stands on. */
export type CorridorWall = 'north' | 'south' | 'east' | 'west';

/**
 * The walls a barrel stack may stand against. The view is three-quarter
 * top-down, so a stack's art rises up the screen from its seat: against a south
 * wall the column would be painted over the corridor's own floor and read as
 * blocking the way, while against the north wall it rises over the wall and
 * against an east or west wall it rises over the wall beside its alcove.
 */
export type BarrelSeatWall = Exclude<CorridorWall, 'south'>;

/** The wall a tile beside a centre-line tile stands against, or null when it is not straight off one axis. */
export function corridorWallOf(centre: Point, beside: Point): CorridorWall | null {
  const dx = beside.x - centre.x;
  const dy = beside.y - centre.y;
  if (dx === 0 && dy < 0) return 'north';
  if (dx === 0 && dy > 0) return 'south';
  if (dy === 0 && dx > 0) return 'east';
  if (dy === 0 && dx < 0) return 'west';
  return null;
}

export function isBarrelSeatWall(wall: CorridorWall | null): wall is BarrelSeatWall {
  return wall !== null && wall !== 'south';
}

/** The cross-section the barrel seat sits beside: a quarter of the way into the wet half. */
export function barrelSeatSectionIndex(sectionCount: number, wetFromIndex: number): number {
  const wetLength = sectionCount - wetFromIndex;
  return wetFromIndex + Math.floor(wetLength * BARREL_SEAT_WET_FRACTION);
}

/**
 * The depth every tile of a flooded corridor carries, its bend corners and
 * barrel seat included, keyed by `tileCoordKey`. Cross-sections overlap where the corridor bends, and
 * a tile shared by two takes the deeper, so the water never steps shallower
 * toward the door.
 */
export function floodedTileDepths(
  layout: FloodedApproachLayout,
): ReadonlyMap<number, { readonly tile: Point; readonly depth: number }> {
  const depths = new Map<number, { tile: Point; depth: number }>();
  const record = (tile: Point, depth: number): void => {
    const key = tileCoordKey(tile.x, tile.y);
    const deepest = Math.max(depth, depths.get(key)?.depth ?? 0);
    depths.set(key, { tile, depth: deepest });
  };
  for (const [index, section] of layout.crossSections.entries()) {
    for (const tile of section.tiles) record(tile, layout.depths[index] ?? 0);
  }
  for (const corner of layout.bendCorners) {
    record(corner.tile, layout.depths[corner.crossSectionIndex] ?? 0);
  }
  const seat = layout.barrelSeat;
  record(seat.tile, layout.depths[seat.crossSectionIndex] ?? 0);
  return depths;
}
