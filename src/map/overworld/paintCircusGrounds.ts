/**
 * Stamps the circus grounds' authored template (`circusGroundsLayout.ts`)
 * into the tile grid. Nothing is decided here: every footprint, door, lamp
 * bearing, rim anchor and keep-clear band is the layout's, and this only
 * writes it down at one centre and bends the rim round the one road.
 */

import { CIRCUS_LOT, CIRCUS_STRUCTURE_LOW, CIRCUS_STRUCTURE_TALL } from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import {
  approachCentreLine,
  nearestGate,
  paveApproach,
  type ApproachCentreTile,
} from '../town/paintStreets';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import {
  CIRCUS_ARCH_CLEARANCE_TILES,
  CIRCUS_KEEP_CLEAR_BANDS,
  CIRCUS_RADIUS_TILES,
  CIRCUS_RIM_BEARING_NUDGES_DEG,
  CIRCUS_RIM_INNER_RADIUS_TILES,
  CIRCUS_RIM_OUTER_RADIUS_TILES,
  CIRCUS_RIM_PROPS,
  CIRCUS_RIM_PROP_RADII_TILES,
  CIRCUS_ROAD_FLANK_COLUMNS,
  CIRCUS_ROAD_START_ROW,
  CIRCUS_STRUCTURES,
  CIRCUS_STRUCTURE_PLACEMENTS,
  CIRCUS_TERROR_SPAWN_CLEARANCE_TILES,
  CIRCUS_TERROR_SPAWN_OFFSET,
  CIRCUS_TORCH_BEARINGS_DEG,
  CIRCUS_TORCH_RING_RADIUS_TILES,
  bearingOf,
  blockedSteps,
  circusStructurePartSpriteKey,
  circusStructureSpriteKey,
  entryArchFor,
  keepClearBandTiles,
  resolveRimTile,
  rimFootprintOrigin,
  type CircusEntryArch,
  type CircusGroundsSite,
  type CircusStructureId,
  type PlacedCircusStructure,
  type RimPropAnchor,
} from './circusGroundsLayout';

/** A Big Top door: where it is and how wide, for the building-entry list. */
export interface CircusDoor {
  readonly doorTile: TilePoint;
  readonly doorwayWidth: number;
}

export interface PaintedCircusGrounds {
  readonly site: CircusGroundsSite;
  readonly bigTopDoor: CircusDoor;
}

const STRUCTURE_TILE_TYPE = {
  tall: CIRCUS_STRUCTURE_TALL,
  low: CIRCUS_STRUCTURE_LOW,
} as const;

function tileKey(tile: TilePoint): string {
  return `${tile.x},${tile.y}`;
}

function isCircusStructureType(type: number | undefined): boolean {
  return type === CIRCUS_STRUCTURE_TALL || type === CIRCUS_STRUCTURE_LOW;
}

/**
 * The centre line of the circus's approach road, from the Big Top's doorstep
 * out to the nearest town gate.
 *
 * The road begins on the forecourt rather than at the grounds' centre, because
 * the Big Top stands on the centre and its door faces south. A road that must
 * leave northward first runs along the forecourt to one of the flank columns
 * between the Big Top and a side-show pavilion, and only then turns north —
 * so whichever way the party arrives, the road delivers them to the door.
 */
export function circusApproachCentreLine(plan: TownPlan, centre: TilePoint): ApproachCentreTile[] {
  const doorstep: ApproachCentreTile = { x: centre.x, y: centre.y + 1, alongX: false };
  const forecourt: TilePoint = { x: centre.x, y: centre.y + CIRCUS_ROAD_START_ROW };
  const gate = nearestGate(plan, centre);
  const leavesNorthward = gate.outward.dx === 0 && gate.exit.y < forecourt.y;
  if (!leavesNorthward) {
    return [doorstep, ...approachCentreLine(plan, centre, forecourt)];
  }
  const flankDx =
    gate.exit.x >= centre.x ? CIRCUS_ROAD_FLANK_COLUMNS.east : CIRCUS_ROAD_FLANK_COLUMNS.west;
  const flank: TilePoint = { x: centre.x + flankDx, y: forecourt.y };
  const step = Math.sign(flankDx);
  const leadIn: ApproachCentreTile[] = [];
  for (let x = forecourt.x; x !== flank.x; x += step) {
    leadIn.push({ x, y: forecourt.y, alongX: true });
  }
  return [doorstep, ...leadIn, ...approachCentreLine(plan, centre, flank)];
}

/**
 * Writes one structure with its footprint's north-west corner at `origin`:
 * the drawing tile keyed with the structure, every other blocked tile with
 * the step back to it. Each records the ground it stands on, so the chunk
 * bake draws the lot under the structure's transparent margins.
 */
function stampStructure(
  grid: TileGrid,
  structure: CircusStructureId,
  origin: TilePoint,
): PlacedCircusStructure {
  const spec = CIRCUS_STRUCTURES[structure];
  const type = STRUCTURE_TILE_TYPE[spec.kind];
  const drawX = origin.x + spec.drawTile.dx;
  const drawY = origin.y + spec.drawTile.dy;
  for (const step of blockedSteps(spec)) {
    const x = origin.x + step.dx;
    const y = origin.y + step.dy;
    const key =
      x === drawX && y === drawY
        ? circusStructureSpriteKey(structure)
        : circusStructurePartSpriteKey(drawX - x, drawY - y);
    grid.setStandingSprite(x, y, type, key);
  }
  return { structure, rect: { x: origin.x, y: origin.y, w: spec.w, h: spec.h } };
}

/** How far round a rim footprint the walk-around check looks for a way past it. */
const RIM_DETOUR_MARGIN_TILES = 3;

const CARDINAL_STEPS: ReadonlyArray<TilePoint> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Whether standing a rim prop on `footprint` still lets a body walk from any
 * open tile beside it to any other, round the prop, without leaving a small
 * box about it — the local form of `TownDecorSystem`'s `leavesTownConnected`.
 * A prop that fails would seal a pocket against the rim, or cut the rim path
 * between two neighbours so the only way round is back through the field.
 */
function leavesRimConnected(grid: TileGrid, footprint: ReadonlyArray<TilePoint>): boolean {
  const blocked = new Set(footprint.map(tileKey));
  const xs = footprint.map((tile) => tile.x);
  const ys = footprint.map((tile) => tile.y);
  const box = {
    minX: Math.min(...xs) - RIM_DETOUR_MARGIN_TILES,
    maxX: Math.max(...xs) + RIM_DETOUR_MARGIN_TILES,
    minY: Math.min(...ys) - RIM_DETOUR_MARGIN_TILES,
    maxY: Math.max(...ys) + RIM_DETOUR_MARGIN_TILES,
  };
  const walkable = (tile: TilePoint): boolean => {
    if (tile.x < box.minX || tile.x > box.maxX || tile.y < box.minY || tile.y > box.maxY) {
      return false;
    }
    if (blocked.has(tileKey(tile)) || grid.isSolid(tile.x, tile.y)) return false;
    const type = grid.typeAt(tile.x, tile.y);
    return type !== undefined && isWalkableTileType({ tileId: '', type });
  };
  const beside: TilePoint[] = [];
  for (const tile of footprint) {
    for (const step of CARDINAL_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (walkable(next)) beside.push(next);
    }
  }
  if (beside.length === 0) return false;
  const seen = new Set<string>([tileKey(beside[0])]);
  const queue: TilePoint[] = [beside[0]];
  // A for-of over an array visits what is pushed onto it mid-loop, which is the queue.
  for (const here of queue) {
    for (const step of CARDINAL_STEPS) {
      const next = { x: here.x + step.x, y: here.y + step.y };
      const key = tileKey(next);
      if (seen.has(key) || !walkable(next)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return beside.every((tile) => seen.has(tileKey(tile)));
}

/** The bearings a rim prop is tried at, in order: its own, then the nudges round it. */
function rimBearings(anchor: RimPropAnchor, archBearing: number | null): number[] {
  if (anchor.bearing.kind === 'fixed') {
    const base = anchor.bearing.deg;
    return CIRCUS_RIM_BEARING_NUDGES_DEG.map((nudge) => base + nudge);
  }
  if (archBearing === null) return [];
  const { offsetDeg } = anchor.bearing;
  // Each side of the arch is walked only away from it: a nudge back toward
  // the road lands inside the arch's own clearance.
  const awayFromArch = (side: 1 | -1): number[] =>
    CIRCUS_RIM_BEARING_NUDGES_DEG.filter((nudge) => nudge * side >= 0).map(
      (nudge) => archBearing + side * offsetDeg + nudge,
    );
  return [...awayFromArch(1), ...awayFromArch(-1)];
}

/**
 * Lays the lot, stands the tents, paves the approach road, raises the entry
 * arch where that road crosses the rim, rings the grounds with flame lamps and
 * parks the wagons and booths round the rim.
 *
 * The lot leaves any town highway crossing the disc paved. The road goes
 * down after the tents so it stops at their walls rather than running under
 * them, and the arch and the rim after the road so they can keep off it and
 * the highway alike.
 */
export function paintCircusGrounds(
  grid: TileGrid,
  plan: TownPlan,
  centre: TilePoint,
  borderTiles: number,
): PaintedCircusGrounds {
  const insideBorder = (x: number, y: number): boolean =>
    x > borderTiles &&
    y > borderTiles &&
    x < grid.size - borderTiles - 1 &&
    y < grid.size - borderTiles - 1;

  for (let dy = -CIRCUS_RADIUS_TILES; dy <= CIRCUS_RADIUS_TILES; dy++) {
    for (let dx = -CIRCUS_RADIUS_TILES; dx <= CIRCUS_RADIUS_TILES; dx++) {
      if (Math.hypot(dx, dy) > CIRCUS_RADIUS_TILES) continue;
      const x = centre.x + dx;
      const y = centre.y + dy;
      // A gate highway already across the disc stays paved: it runs on
      // through the lot to the tents, and every later placement test keeps
      // off paving, so no lamp, wagon or arch post is stood on it.
      if (!insideBorder(x, y) || grid.isSolid(x, y) || grid.isPaved(x, y)) continue;
      grid.set(x, y, CIRCUS_LOT);
    }
  }

  const structures: PlacedCircusStructure[] = [];
  let bigTopDoor: CircusDoor | null = null;
  for (const placement of CIRCUS_STRUCTURE_PLACEMENTS) {
    const origin = { x: centre.x + placement.dx, y: centre.y + placement.dy };
    const spec = CIRCUS_STRUCTURES[placement.structure];
    // A structure is the grounds' own: it clears whatever the lot pass left
    // standing under it rather than stamping round it.
    for (const step of blockedSteps(spec))
      grid.set(origin.x + step.dx, origin.y + step.dy, CIRCUS_LOT);
    structures.push(stampStructure(grid, placement.structure, origin));
    if (placement.structure === 'big_top' && spec.door !== undefined) {
      bigTopDoor = {
        doorTile: { x: origin.x + spec.door.dx, y: origin.y + spec.door.dy },
        doorwayWidth: spec.door.width,
      };
    }
  }
  if (bigTopDoor === null) throw new Error('The circus layout places no Big Top with a door');

  const road = circusApproachCentreLine(plan, centre);
  paveApproach(grid, road, plan.wall);

  const arch = entryArchFor(
    centre,
    road,
    (post) =>
      insideBorder(post.x, post.y) &&
      !grid.isSolid(post.x, post.y) &&
      !grid.isPaved(post.x, post.y),
  );
  const archPosts = arch?.posts ?? [];
  for (const post of archPosts) structures.push(stampStructure(grid, 'arch_post', post));

  const isFreeRimTile = rimTileTest(grid, centre, arch, insideBorder);
  const torches = CIRCUS_TORCH_BEARINGS_DEG.map((bearing) => {
    const tile = resolveRimTile(centre, bearing, CIRCUS_TORCH_RING_RADIUS_TILES, isFreeRimTile);
    if (tile !== null) structures.push(stampStructure(grid, 'flame_lamp', tile));
    return tile;
  });

  const archBearing = arch === null ? null : bearingOf(centre, arch.crossing);
  for (const anchor of CIRCUS_RIM_PROPS) {
    const placed = placeRimProp(grid, centre, anchor, archBearing, isFreeRimTile);
    if (placed !== null) structures.push(placed);
  }

  return {
    site: { centre, radiusTiles: CIRCUS_RADIUS_TILES, structures, arch, torches },
    bigTopDoor,
  };
}

/**
 * The test every rim tile must pass: on the map, on open unpaved ground, out
 * of every keep-clear band, clear of the arch, of Terror's spawn and of every
 * structure already standing (a prop pressed against a lamp or another wagon
 * reads as a jumble and walls the rim path shut between them).
 */
function rimTileTest(
  grid: TileGrid,
  centre: TilePoint,
  arch: CircusEntryArch | null,
  insideBorder: (x: number, y: number) => boolean,
): (tile: TilePoint) => boolean {
  const bandTiles = new Set<string>();
  for (const band of Object.values(CIRCUS_KEEP_CLEAR_BANDS)) {
    for (const tile of keepClearBandTiles(band, centre)) bandTiles.add(tileKey(tile));
  }
  const archPosts = arch?.posts ?? [];
  const terror = {
    x: centre.x + CIRCUS_TERROR_SPAWN_OFFSET.x,
    y: centre.y + CIRCUS_TERROR_SPAWN_OFFSET.y,
  };
  const chebyshev = (a: TilePoint, b: TilePoint): number =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const touchesStructure = (tile: TilePoint): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (isCircusStructureType(grid.typeAt(tile.x + dx, tile.y + dy))) return true;
      }
    }
    return false;
  };
  return (tile) =>
    insideBorder(tile.x, tile.y) &&
    !grid.isSolid(tile.x, tile.y) &&
    !grid.isPaved(tile.x, tile.y) &&
    !bandTiles.has(tileKey(tile)) &&
    !touchesStructure(tile) &&
    chebyshev(tile, terror) > CIRCUS_TERROR_SPAWN_CLEARANCE_TILES &&
    archPosts.every((post) => chebyshev(post, tile) > CIRCUS_ARCH_CLEARANCE_TILES);
}

/**
 * Stands one rim prop at the first bearing that takes its whole footprint:
 * every tile free, inside the rim band, and the ground round it still
 * walkable. Of the footprints near that bearing, the one standing furthest
 * out of the grounds' disc wins — the fewer of its tiles inside the disc, the
 * less of the field it takes — then the one nearest the bearing's own point.
 * Null when nothing on its arc of the rim will take it, and then the prop is
 * simply not stood up.
 */
function placeRimProp(
  grid: TileGrid,
  centre: TilePoint,
  anchor: RimPropAnchor,
  archBearing: number | null,
  isFreeRimTile: (tile: TilePoint) => boolean,
): PlacedCircusStructure | null {
  const spec = CIRCUS_STRUCTURES[anchor.prop];
  for (const bearing of rimBearings(anchor, archBearing)) {
    let best: { origin: TilePoint; insideDisc: number; drift: number } | null = null;
    for (const radius of CIRCUS_RIM_PROP_RADII_TILES) {
      const ideal = rimFootprintOrigin(centre, bearing, radius, spec.w);
      for (const shift of RIM_FOOTPRINT_SHIFTS) {
        const origin = { x: ideal.x + shift.x, y: ideal.y + shift.y };
        const footprint = blockedSteps(spec).map((step) => ({
          x: origin.x + step.dx,
          y: origin.y + step.dy,
        }));
        const radii = footprint.map((tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y));
        const inBand = radii.every(
          (out) => out >= CIRCUS_RIM_INNER_RADIUS_TILES && out <= CIRCUS_RIM_OUTER_RADIUS_TILES,
        );
        if (!inBand || !footprint.every(isFreeRimTile)) continue;
        const insideDisc = radii.filter((out) => out <= CIRCUS_RADIUS_TILES).length;
        const drift = Math.hypot(shift.x, shift.y);
        const better =
          best === null ||
          insideDisc < best.insideDisc ||
          (insideDisc === best.insideDisc && drift < best.drift);
        if (!better || !leavesRimConnected(grid, footprint)) continue;
        best = { origin, insideDisc, drift };
      }
    }
    if (best !== null) return stampStructure(grid, anchor.prop, best.origin);
  }
  return null;
}

/**
 * Steps a rim footprint may be moved off the tile its bearing rounds to. The
 * rim is a ring of whole tiles, so the few footprints standing just outside
 * the disc are often a tile off the rounded point rather than on it.
 */
const RIM_FOOTPRINT_SHIFTS: ReadonlyArray<TilePoint> = [
  { x: 0, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];
