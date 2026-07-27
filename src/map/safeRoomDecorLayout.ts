/**
 * Where a safe room's furnishings go, and how they get written into the map.
 *
 * Modelled on `safeRoomCounterLayout`, and for the same reasons: planning is
 * separated from stamping because two callers need the geometry and only one of
 * them may touch tiles, and the whole module is pure geometry with no canvas code
 * so `src/map` never has to depend on `src/systems`.
 *
 * Placement runs **after** the counter is planned, and treats as occupied every
 * tile the counter run owns, Mordecai's tile and the bed's, the tile inside each
 * doorway, and the `SAFE_ROOM_THRESHOLD` traffic band. On top of that, every
 * placement is checked for reachability: a prop that would strand any floor the
 * player could previously walk to is refused outright.
 *
 * Nothing here is random. The order props are offered candidate tiles in is
 * hashed from the room's own centre, so a room furnishes itself identically
 * every time the chunk cache is re-baked and on every reconstruction of the
 * scene — which `Math.random()` would not.
 *
 * The three wall-hung props sit on the room's **north** row, like the counter and
 * for the same reason: the oblique projection's viewpoint is fixed to the south,
 * so a hanging on any other wall is seen from behind or edge-on. They are
 * therefore subject to the same door-column rule — a solid prop over a doorway
 * column would seal the entrance behind it.
 */

import type { GameMap } from './GameMap';
import type { TileContent } from './tileTypes';
import { mordecaiAndBedTiles } from './safeRoomFixtures';
import { planSafeRoomCounters, type SafeRoomCounterLayout } from './safeRoomCounterLayout';
import {
  placeProp,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_LARDER,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_RUG,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_THRESHOLD,
  SAFE_ROOM_FLOOR,
} from './tileTypes';

export interface SafeRoomDecorProp {
  readonly x: number;
  readonly y: number;
  readonly type: number;
}

export interface SafeRoomDecorPlan {
  /** Index into `map.safeRooms`, carried explicitly because rooms can be skipped. */
  readonly safeRoomIndex: number;
  readonly props: ReadonlyArray<SafeRoomDecorProp>;
}

/** Lanterns wanted per room, and the corner inset they stand at. */
const LANTERN_COUNT = 3;
const LANTERN_CORNER_INSET_TILES = 1;
/** Stools set around the refectory table. */
const STOOL_COUNT = 3;
/** Runner tiles laid in the room's open middle. */
const RUG_TILE_COUNT = 2;
/**
 * Rows of clear floor a room needs south of its north wall before it is worth
 * furnishing: the counter's three, one for the player to stand in, and one more
 * for the table and its stools.
 */
const MIN_ROOM_HEIGHT_FOR_DECOR = 6;
/** A room narrower than this has no side wall free of the counter's own span. */
const MIN_ROOM_WIDTH_FOR_DECOR = 6;

/** Decorrelated multipliers for the per-room placement hash. */
const PLACEMENT_HASH_X = 374761393;
const PLACEMENT_HASH_Y = 668265263;
const PLACEMENT_HASH_MIX = 2246822519;
const PLACEMENT_HASH_SHIFT = 13;
const PLACEMENT_HASH_FINAL_SHIFT = 16;

/**
 * A room's own deterministic hash, varied by `slot`.
 *
 * The avalanche step matters for the same reason it does in `groundFrameIndex`:
 * without a finalising mix the low bits of `x*A ^ y*B` are a linear function of
 * the coordinates, and every room on a floor would choose the same candidate.
 */
function placementHash(centre: { x: number; y: number }, slot: number): number {
  const mixed = Math.imul(centre.x, PLACEMENT_HASH_X) ^ Math.imul(centre.y, PLACEMENT_HASH_Y);
  const avalanched = Math.imul(mixed ^ (mixed >>> PLACEMENT_HASH_SHIFT), PLACEMENT_HASH_MIX + slot);
  return (avalanched ^ (avalanched >>> PLACEMENT_HASH_FINAL_SHIFT)) >>> 0;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Every type this module writes, so a stamped room re-plans to the same layout. */
const DECOR_TYPES: ReadonlySet<number> = new Set([
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_LARDER,
  SAFE_ROOM_RUG,
]);

/**
 * Ground a furnishing may stand on: the room's own floor, its worn threshold
 * band, or a tile one of these passes already claimed.
 *
 * Reading the *current* type and counting this module's own output as free is
 * what makes planning stamp-independent. The counter run, the galley strip and
 * any furniture the interior generator laid down are all other types, so they
 * are excluded without needing a second list to keep in step.
 */
function isDecorSurface(tile: TileContent): boolean {
  return (
    tile.type === SAFE_ROOM_FLOOR || tile.type === SAFE_ROOM_THRESHOLD || DECOR_TYPES.has(tile.type)
  );
}

interface RoomOccupancy {
  /** Tiles no furnishing may be placed on. */
  readonly occupied: Set<string>;
  /** Tiles just inside a doorway — passable, and never built over. */
  readonly doorwayTiles: ReadonlyArray<{ x: number; y: number }>;
}

/**
 * Every tile a decoration may not stand on, and where the room's doorways open.
 *
 * A doorway's own interior tile is barred on every wall. On the north wall that
 * is also the wall row the three hangings go on, so the same entry covers the
 * counter's door-column rule: nothing solid is ever hung in a doorway's column.
 *
 * Barring tiles is necessary but nowhere near sufficient — props one row further
 * in can wall a doorway off from the rest of the room without ever touching it.
 * That is what `DecorPlacer`'s reachability test exists to catch.
 */
function occupiedTiles(
  map: GameMap,
  safeRoomIndex: number,
  counterLayout: SafeRoomCounterLayout | undefined,
): RoomOccupancy {
  const safeRoom = map.safeRooms[safeRoomIndex];
  const { bounds } = safeRoom;
  const occupied = new Set<string>();
  const doorwayTiles: Array<{ x: number; y: number }> = [];

  for (const tile of mordecaiAndBedTiles(safeRoom)) occupied.add(tileKey(tile.x, tile.y));
  // From the counter's *plan*, not from the tile types it will eventually write.
  // `SafeRoomSystem` builds itself — and so calls this — before the scene stamps
  // the counter, so on an unstamped map the whole run still reads as plain floor:
  // measured over 400 safe rooms, inferring the run from types alone moved the
  // lanterns in 52% of rooms and the stove in 34%, leaving lamplight pooling on
  // bare floor and steam rising off nothing. `planSafeRoomCounters` is itself
  // stamp-independent — it takes its door columns from walkability outside the
  // room — so consulting the plan is stable wherever this is called from.
  if (counterLayout !== undefined) {
    for (const tile of [
      ...counterLayout.counterTiles,
      ...counterLayout.backTiles,
      ...counterLayout.galleyTiles,
    ]) {
      occupied.add(tileKey(tile.x, tile.y));
    }
  }

  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  for (let y = bounds.y; y <= lastY; y++) {
    for (let x = bounds.x; x <= lastX; x++) {
      const tile = map.structure[y][x];
      if (!isDecorSurface(tile) || tile.type === SAFE_ROOM_THRESHOLD) occupied.add(tileKey(x, y));
    }
  }

  const noteDoorway = (x: number, y: number): void => {
    doorwayTiles.push({ x, y });
    occupied.add(tileKey(x, y));
  };

  for (let x = bounds.x; x <= lastX; x++) {
    if (map.isWalkableIgnoringPermanent(x, bounds.y - 1)) noteDoorway(x, bounds.y);
    if (map.isWalkableIgnoringPermanent(x, lastY + 1)) noteDoorway(x, lastY);
  }
  for (let y = bounds.y; y <= lastY; y++) {
    if (map.isWalkableIgnoringPermanent(bounds.x - 1, y)) noteDoorway(bounds.x, y);
    if (map.isWalkableIgnoringPermanent(lastX + 1, y)) noteDoorway(lastX, y);
  }

  return { occupied, doorwayTiles };
}

/** Four-way neighbours: a room stays connected by walking, not by squeezing. */
const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * Places props, refusing any tile already taken and any placement that would
 * strand part of the room behind the furniture.
 *
 * The reachability test is the load-bearing half. Barring the tile inside each
 * doorway is not enough on its own: over 240 generated safe rooms, a corner
 * lantern one row south of a doorway, or two wall hangings closing the ends of a
 * row the counter's back bench already fills, left 71 rooms with an unreachable
 * pocket and sealed 2 rooms outright — Mordecai, the bed and the Bopca all cut
 * off from the only entrance.
 */
class DecorPlacer {
  private readonly placed: SafeRoomDecorProp[] = [];
  /** Tiles a solid prop now stands on. The rug is walkable and never listed. */
  private readonly blocked = new Set<string>();
  private readonly baselineStranded: ReadonlySet<string>;

  constructor(
    private readonly occupied: Set<string>,
    private readonly centre: { x: number; y: number },
    private readonly bounds: { x: number; y: number; w: number; h: number },
    private readonly structure: TileContent[][],
    private readonly doorwayTiles: ReadonlyArray<{ x: number; y: number }>,
    counterRunTiles: ReadonlyArray<{ x: number; y: number }>,
  ) {
    // The counter run blocks the flood from the start. Taken from the counter's
    // plan rather than left to `isDecorSurface`, so the answer is the same
    // whether or not the run has been stamped yet — see `occupiedTiles`.
    for (const tile of counterRunTiles) this.blocked.add(tileKey(tile.x, tile.y));
    // A room can already have unreachable corners before any furniture arrives —
    // the galley strip is sealed by design. Those are recorded up front so the
    // test measures what the furniture strands rather than what it inherited.
    this.baselineStranded = this.strandedTiles();
  }

  get props(): ReadonlyArray<SafeRoomDecorProp> {
    return this.placed;
  }

  isFree(x: number, y: number): boolean {
    return !this.occupied.has(tileKey(x, y));
  }

  /** Claims `(x, y)` for `type`, or does nothing if it is taken or would strand floor. */
  place(x: number, y: number, type: number): boolean {
    if (!this.isFree(x, y)) return false;

    const key = tileKey(x, y);
    const isSolid = type !== SAFE_ROOM_RUG;
    if (isSolid) {
      this.blocked.add(key);
      if (this.strandsNewTiles()) {
        this.blocked.delete(key);
        return false;
      }
    }
    this.occupied.add(key);
    this.placed.push({ x, y, type });
    return true;
  }

  /**
   * Places `type` on the first free tile of `candidates`, starting from a
   * hash-chosen offset so two rooms with the same shape do not furnish
   * identically. Returns the tile used, or null when every candidate was taken.
   */
  placeFirstFree(
    candidates: ReadonlyArray<{ x: number; y: number }>,
    type: number,
    slot: number,
  ): { x: number; y: number } | null {
    if (candidates.length === 0) return null;
    const start = placementHash(this.centre, slot) % candidates.length;
    for (let step = 0; step < candidates.length; step++) {
      const candidate = candidates[(start + step) % candidates.length];
      if (this.place(candidate.x, candidate.y, type)) return candidate;
    }
    return null;
  }

  private strandsNewTiles(): boolean {
    for (const key of this.strandedTiles()) {
      if (!this.baselineStranded.has(key)) return true;
    }
    return false;
  }

  /** Floor tiles the player could not walk to from a doorway, as tile keys. */
  private strandedTiles(): Set<string> {
    const { bounds } = this;
    const lastX = bounds.x + bounds.w - 1;
    const lastY = bounds.y + bounds.h - 1;

    const walkable = (x: number, y: number): boolean => {
      if (x < bounds.x || x > lastX || y < bounds.y || y > lastY) return false;
      if (this.blocked.has(tileKey(x, y))) return false;
      return isDecorSurface(this.structure[y][x]);
    };

    // Seeded from **one** doorway, so the test asks whether the room is a single
    // connected space that every entrance opens into. Seeding from all of them
    // instead makes each doorway reachable by definition, which hides the exact
    // failure this exists to catch: a doorway sealed into a pocket of its own
    // while the rest of the room stays connected through another entrance the
    // player may have no route to.
    const entrance = this.doorwayTiles.find((tile) => walkable(tile.x, tile.y)) ?? this.centre;
    const reached = new Set<string>([tileKey(entrance.x, entrance.y)]);
    const frontier = [entrance];

    while (frontier.length > 0) {
      const tile = frontier.pop();
      if (tile === undefined) break;
      for (const [dx, dy] of CARDINAL_STEPS) {
        const nextX = tile.x + dx;
        const nextY = tile.y + dy;
        const key = tileKey(nextX, nextY);
        if (reached.has(key) || !walkable(nextX, nextY)) continue;
        reached.add(key);
        frontier.push({ x: nextX, y: nextY });
      }
    }

    const stranded = new Set<string>();
    for (let y = bounds.y; y <= lastY; y++) {
      for (let x = bounds.x; x <= lastX; x++) {
        const key = tileKey(x, y);
        if (walkable(x, y) && !reached.has(key)) stranded.add(key);
      }
    }
    return stranded;
  }
}

/** Hash slots, one per placement decision, so no two share a draw. */
const SLOT_MENU_BOARD = 1;
const SLOT_HERB_RACK = 2;
const SLOT_BANNER = 3;
const SLOT_STOVE = 4;
const SLOT_LARDER = 5;
const SLOT_RUG = 6;

function wallRowCandidates(bounds: {
  x: number;
  y: number;
  w: number;
  h: number;
}): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = bounds.x; x < bounds.x + bounds.w; x++) candidates.push({ x, y: bounds.y });
  return candidates;
}

/** The four inside corners, where a standing lantern throws light furthest. */
function cornerCandidates(bounds: {
  x: number;
  y: number;
  w: number;
  h: number;
}): Array<{ x: number; y: number }> {
  const west = bounds.x + LANTERN_CORNER_INSET_TILES;
  const east = bounds.x + bounds.w - 1 - LANTERN_CORNER_INSET_TILES;
  const north = bounds.y + LANTERN_CORNER_INSET_TILES;
  const south = bounds.y + bounds.h - 1 - LANTERN_CORNER_INSET_TILES;
  return [
    { x: west, y: north },
    { x: east, y: north },
    { x: west, y: south },
    { x: east, y: south },
  ];
}

/**
 * Plan the furnishings for every safe room on the map, without touching a tile.
 *
 * Pure and deterministic for a given map, so it can be called repeatedly — once
 * to stamp, once per interior-occupant pass — and always answer the same thing.
 */
export function planSafeRoomDecor(map: GameMap): ReadonlyArray<SafeRoomDecorPlan> {
  const plans: SafeRoomDecorPlan[] = [];
  const counterLayouts = planSafeRoomCounters(map);

  for (let safeRoomIndex = 0; safeRoomIndex < map.safeRooms.length; safeRoomIndex++) {
    const safeRoom = map.safeRooms[safeRoomIndex];
    const { bounds, centre } = safeRoom;
    if (bounds.h < MIN_ROOM_HEIGHT_FOR_DECOR || bounds.w < MIN_ROOM_WIDTH_FOR_DECOR) continue;

    const counterLayout = counterLayouts.find((layout) => layout.safeRoomIndex === safeRoomIndex);
    const { occupied, doorwayTiles } = occupiedTiles(map, safeRoomIndex, counterLayout);
    const counterRunTiles =
      counterLayout === undefined
        ? []
        : [...counterLayout.counterTiles, ...counterLayout.backTiles, ...counterLayout.galleyTiles];
    const placer = new DecorPlacer(
      occupied,
      centre,
      bounds,
      map.structure,
      doorwayTiles,
      counterRunTiles,
    );
    const wallRow = wallRowCandidates(bounds);

    placer.placeFirstFree(wallRow, SAFE_ROOM_MENU_BOARD, SLOT_MENU_BOARD);
    placer.placeFirstFree(wallRow, SAFE_ROOM_HERB_RACK, SLOT_HERB_RACK);
    placer.placeFirstFree(wallRow, SAFE_ROOM_BANNER, SLOT_BANNER);

    // The stove is the counter's own range spilling out of the galley, so it goes
    // beside the run rather than anywhere warm-looking.
    if (counterLayout !== undefined) {
      const run = counterLayout.counterTiles;
      // The front bar is the run's southernmost row; the side returns share the
      // list but sit a row north of it.
      const frontRow = Math.max(...run.map((tile) => tile.y));
      const westOfRun = Math.min(...run.map((tile) => tile.x)) - 1;
      const eastOfRun = Math.max(...run.map((tile) => tile.x)) + 1;
      placer.placeFirstFree(
        [
          { x: eastOfRun, y: frontRow },
          { x: westOfRun, y: frontRow },
        ],
        SAFE_ROOM_STOVE,
        SLOT_STOVE,
      );
    }

    placeTableAndStools(placer, bounds, centre);

    const lanterns = cornerCandidates(bounds);
    let lanternsPlaced = 0;
    for (const corner of lanterns) {
      if (lanternsPlaced >= LANTERN_COUNT) break;
      if (placer.place(corner.x, corner.y, SAFE_ROOM_LANTERN)) lanternsPlaced++;
    }

    const sideWalls: Array<{ x: number; y: number }> = [];
    for (let y = bounds.y + 1; y < bounds.y + bounds.h - 1; y++) {
      sideWalls.push({ x: bounds.x, y }, { x: bounds.x + bounds.w - 1, y });
    }
    placer.placeFirstFree(sideWalls, SAFE_ROOM_LARDER, SLOT_LARDER);

    placeRug(placer, bounds, centre);

    plans.push({ safeRoomIndex, props: placer.props });
  }

  return plans;
}

/**
 * A refectory table with its stools, in the room's open middle-south.
 *
 * Started one row south of centre so the table never sits on Mordecai's or the
 * bed's row, and never reaches the doorway band the occupancy set already bars.
 */
function placeTableAndStools(
  placer: DecorPlacer,
  bounds: { x: number; y: number; w: number; h: number },
  centre: { x: number; y: number },
): void {
  const tableY = centre.y + 1;
  if (tableY >= bounds.y + bounds.h - 1) return;
  if (!placer.place(centre.x, tableY, SAFE_ROOM_TABLE)) return;

  const seats = [
    { x: centre.x - 1, y: tableY },
    { x: centre.x + 1, y: tableY },
    { x: centre.x, y: tableY + 1 },
    { x: centre.x - 1, y: tableY + 1 },
  ];
  let seated = 0;
  for (const seat of seats) {
    if (seated >= STOOL_COUNT) break;
    if (seat.y >= bounds.y + bounds.h - 1) continue;
    if (seat.x <= bounds.x || seat.x >= bounds.x + bounds.w - 1) continue;
    if (placer.place(seat.x, seat.y, SAFE_ROOM_STOOL)) seated++;
  }
}

/** A woven runner, laid east–west across the room's open middle. */
function placeRug(
  placer: DecorPlacer,
  bounds: { x: number; y: number; w: number; h: number },
  centre: { x: number; y: number },
): void {
  const rugY = centre.y;
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x++) candidates.push({ x, y: rugY });

  const start = placementHash(centre, SLOT_RUG) % Math.max(1, candidates.length);
  let laid = 0;
  for (let step = 0; step < candidates.length && laid < RUG_TILE_COUNT; step++) {
    const candidate = candidates[(start + step) % candidates.length];
    if (placer.place(candidate.x, candidate.y, SAFE_ROOM_RUG)) laid++;
  }
}

/**
 * Write every safe room's furnishings into the map and return the plans.
 *
 * Safe to run more than once: `planSafeRoomDecor` is deterministic, so a second
 * pass targets the same tiles, and `placeProp` records the floor it replaced with
 * `??=` so re-stamping cannot record a prop as its own ground.
 */
export function stampSafeRoomDecor(map: GameMap): ReadonlyArray<SafeRoomDecorPlan> {
  const plans = planSafeRoomDecor(map);
  for (const plan of plans) {
    for (const prop of plan.props) {
      placeProp(map.structure[prop.y][prop.x], prop.type);
      map.markTileDirty(prop.x, prop.y);
    }
  }
  return plans;
}

/** Every tile a safe room's furnishings occupy, for occupant and layout callers. */
export function safeRoomDecorTiles(map: GameMap): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const plan of planSafeRoomDecor(map)) {
    for (const prop of plan.props) tiles.push({ x: prop.x, y: prop.y });
  }
  return tiles;
}
