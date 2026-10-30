/**
 * The sewer parsed from its authored layouts: each section's tile grid and
 * the named points its valves, fights, guide and connections stand on.
 *
 * Everything downstream reads this one parse — `GameMap.generateSewer` for
 * the walkable map, the section's own system for its water, lights and
 * fights — so the tiles a valve floods are the tiles the map was built with.
 */

import {
  SEWER_CHAR,
  SEWER_ENTRY_SECTION,
  SEWER_FIGHT_CHARS,
  SEWER_GUIDE_STOP_CHARS,
  SEWER_SECTION_IDS,
  SEWER_SECTION_LAYOUTS,
  SEWER_VALVE_CHARS,
  type SewerChannelId,
  type SewerConnection,
  type SewerFightDef,
  type SewerGuideStopDef,
  type SewerOutletDef,
  type SewerSectionId,
  type SewerSectionLayout,
  type SewerValveDef,
} from './sewerLayouts';

export interface SewerTile {
  readonly x: number;
  readonly y: number;
}

/** What a sewer tile is, as the grid stores it. */
export const SEWER_TILE = {
  wall: 0,
  walkway: 1,
  mainChannel: 2,
  spillway: 3,
  nestBasin: 4,
} as const;

export type SewerTileCode = (typeof SEWER_TILE)[keyof typeof SEWER_TILE];

export interface SewerGrid {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
}

export interface ParsedSewerValve {
  readonly def: SewerValveDef;
  readonly tile: SewerTile;
}

export interface ParsedSewerOutlet {
  readonly def: SewerOutletDef;
  /** The channel it floods: its nest's. */
  readonly channel: SewerChannelId;
  /** The wall tile the pipe comes out of. */
  readonly tile: SewerTile;
}

export interface ParsedSewerFight {
  readonly def: SewerFightDef;
  readonly spawns: ReadonlyArray<SewerTile>;
}

export interface ParsedSewerGuideStop {
  readonly def: SewerGuideStopDef;
  readonly tile: SewerTile;
}

export interface ParsedSewerConnection {
  readonly connection: SewerConnection;
  /** The walkway tiles the connection is used from. */
  readonly tiles: ReadonlyArray<SewerTile>;
}

export interface ParsedSewerSection {
  readonly layout: SewerSectionLayout;
  readonly grid: SewerGrid;
  /** Where a party arriving down the street grate's ladder is set down. */
  readonly ladder: SewerTile;
  /** Walkway tiles a street grate overhead lights; the ladder's own grate is among them. */
  readonly streetGrates: ReadonlyArray<SewerTile>;
  readonly channels: Readonly<Record<SewerChannelId, ReadonlyArray<SewerTile>>>;
  readonly mainChannel: ReadonlyArray<SewerTile>;
  /** The tiles the rat nest chokes, until the basin under it floods. */
  readonly nest: ReadonlyArray<SewerTile>;
  /**
   * Drain mouths in the nest basin's floor: basin tiles, so they flood and
   * run dry with it, but shut to every body for good.
   */
  readonly drains: ReadonlyArray<SewerTile>;
  readonly valves: ReadonlyArray<ParsedSewerValve>;
  readonly outlets: ReadonlyArray<ParsedSewerOutlet>;
  readonly fights: ReadonlyArray<ParsedSewerFight>;
  /** The guide's stops, in walking order. */
  readonly guideStops: ReadonlyArray<ParsedSewerGuideStop>;
  readonly connections: ReadonlyArray<ParsedSewerConnection>;
}

/** Every problem a layout has, reported together so one run fixes them all. */
export class SewerLayoutError extends Error {
  constructor(
    readonly sectionId: SewerSectionId,
    readonly problems: ReadonlyArray<string>,
  ) {
    super(`sewer section "${sectionId}": ${problems.join('; ')}`);
  }
}

export function sewerTileAt(grid: SewerGrid, x: number, y: number): SewerTileCode {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return SEWER_TILE.wall;
  return tileCodeOf(grid.tiles[y * grid.width + x]);
}

function tileCodeOf(value: number): SewerTileCode {
  switch (value) {
    case SEWER_TILE.walkway:
      return SEWER_TILE.walkway;
    case SEWER_TILE.mainChannel:
      return SEWER_TILE.mainChannel;
    case SEWER_TILE.spillway:
      return SEWER_TILE.spillway;
    case SEWER_TILE.nestBasin:
      return SEWER_TILE.nestBasin;
    default:
      return SEWER_TILE.wall;
  }
}

/** The tile code each valve-worked channel is stored as. */
const CHANNEL_TILE_CODES = {
  spillway: SEWER_TILE.spillway,
  nest_basin: SEWER_TILE.nestBasin,
} as const satisfies Record<SewerChannelId, SewerTileCode>;

/** Every glyph that stands for walkway, whatever else it marks. */
function isWalkwayMarker(char: string): boolean {
  return (
    char === SEWER_CHAR.walkway ||
    char === SEWER_CHAR.ladder ||
    char === SEWER_CHAR.streetGrate ||
    char === SEWER_CHAR.culvert ||
    SEWER_VALVE_CHARS.some((valveChar) => valveChar === char) ||
    SEWER_FIGHT_CHARS.includes(char) ||
    SEWER_GUIDE_STOP_CHARS.includes(char)
  );
}

function tileCodeForChar(char: string): SewerTileCode | null {
  switch (char) {
    case SEWER_CHAR.wall:
    case SEWER_CHAR.outlet:
      return SEWER_TILE.wall;
    case SEWER_CHAR.mainChannel:
      return SEWER_TILE.mainChannel;
    case SEWER_CHAR.spillway:
      return SEWER_TILE.spillway;
    case SEWER_CHAR.nestBasin:
    case SEWER_CHAR.nest:
    case SEWER_CHAR.drain:
      return SEWER_TILE.nestBasin;
    default:
      return isWalkwayMarker(char) ? SEWER_TILE.walkway : null;
  }
}

/** Every tile in `rows` written as `char`, row-major. */
function tilesMarked(rows: ReadonlyArray<string>, char: string): SewerTile[] {
  const tiles: SewerTile[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === char) tiles.push({ x, y });
  });
  return tiles;
}

/** The first of `items`, or undefined when there are none. */
export function firstOf<T>(items: ReadonlyArray<T>): T | undefined {
  return items.length > 0 ? items[0] : undefined;
}

/** The item at `index`, or undefined past either end. */
export function itemAt<T>(items: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function tilesOfCode(grid: SewerGrid, code: SewerTileCode): SewerTile[] {
  const tiles: SewerTile[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (sewerTileAt(grid, x, y) === code) tiles.push({ x, y });
    }
  }
  return tiles;
}

function connectionChar(connection: SewerConnection): string {
  return connection.char;
}

/**
 * Parses one section's rows into its grid and named points.
 *
 * @throws {SewerLayoutError} listing every ragged row, unknown glyph, open
 *   border tile and missing or duplicated marker.
 */
export function parseSewerSection(layout: SewerSectionLayout): ParsedSewerSection {
  const problems: string[] = [];
  const { rows } = layout;
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles = new Uint8Array(width * height);
  const grid: SewerGrid = { width, height, tiles };

  rows.forEach((row, y) => {
    if (row.length !== width) problems.push(`row ${y} is ${row.length} wide, wants ${width}`);
    for (let x = 0; x < row.length; x++) {
      const code = tileCodeForChar(row[x]);
      if (code === null) {
        problems.push(`unknown glyph "${row[x]}" at ${x},${y}`);
        continue;
      }
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (onBorder && code !== SEWER_TILE.wall) problems.push(`border tile ${x},${y} is open`);
      tiles[y * width + x] = code;
    }
  });

  const ladders = tilesMarked(rows, SEWER_CHAR.ladder);
  if (ladders.length !== 1) problems.push(`${ladders.length} ladders, wants exactly 1`);

  const valves: ParsedSewerValve[] = [];
  for (const def of layout.valves) {
    const marked = tilesMarked(rows, def.char);
    const tile = firstOf(marked);
    if (marked.length !== 1 || tile === undefined) {
      problems.push(`valve "${def.char}" is marked ${marked.length} times, wants exactly 1`);
      continue;
    }
    valves.push({ def, tile });
  }

  const outlets: ParsedSewerOutlet[] = [];
  const nestDef = layout.nest;
  const outletDefs =
    nestDef === null ? [] : nestDef.outlets.map((def) => ({ def, channel: nestDef.channel }));
  for (const { def, channel } of outletDefs) {
    const marked = tilesMarked(rows, def.char);
    const tile = firstOf(marked);
    if (marked.length !== 1 || tile === undefined) {
      problems.push(`outlet "${def.id}" is marked ${marked.length} times, wants exactly 1`);
      continue;
    }
    const below = sewerTileAt(grid, tile.x, tile.y + 1);
    if (below !== CHANNEL_TILE_CODES[channel]) {
      problems.push(`outlet "${def.id}" at ${tile.x},${tile.y} is not over its channel`);
    }
    outlets.push({ def, channel, tile });
  }

  const fights: ParsedSewerFight[] = layout.fights.map((def) => {
    const spawns = tilesMarked(rows, def.char);
    if (spawns.length === 0) problems.push(`fight "${def.id}" has no spawns`);
    return { def, spawns };
  });

  const guideStops: ParsedSewerGuideStop[] = [];
  layout.guideStops.forEach((def, index) => {
    const char =
      index < SEWER_GUIDE_STOP_CHARS.length ? SEWER_GUIDE_STOP_CHARS.charAt(index) : null;
    const marked = char === null ? [] : tilesMarked(rows, char);
    const tile = firstOf(marked);
    if (marked.length !== 1 || tile === undefined) {
      problems.push(`guide stop "${def.id}" is marked ${marked.length} times, wants exactly 1`);
      return;
    }
    guideStops.push({ def, tile });
  });
  if (guideStops.length === 0) problems.push('no guide stops');

  const connections: ParsedSewerConnection[] = layout.connections.map((connection) => {
    const marked = tilesMarked(rows, connectionChar(connection));
    if (marked.length === 0) problems.push(`connection "${connection.kind}" is never marked`);
    return { connection, tiles: marked };
  });

  const nest = tilesMarked(rows, SEWER_CHAR.nest);
  if (nest.length > 0 !== (layout.nest !== null)) {
    problems.push(
      `${nest.length} nest tiles marked, but the layout's nest is ${layout.nest?.id ?? 'null'}`,
    );
  }

  const drains = tilesMarked(rows, SEWER_CHAR.drain);
  for (const drain of drains) {
    const openNeighbours = CARDINAL_STEPS.filter(
      (step) => sewerTileAt(grid, drain.x + step.dx, drain.y + step.dy) !== SEWER_TILE.wall,
    );
    if (openNeighbours.length < CARDINAL_STEPS.length) {
      problems.push(`drain at ${drain.x},${drain.y} touches a wall, so it could close the way`);
    }
  }

  const ladder = firstOf(ladders);
  if (problems.length > 0 || ladder === undefined) {
    throw new SewerLayoutError(layout.id, problems);
  }
  return {
    layout,
    grid,
    ladder,
    streetGrates: [ladder, ...tilesMarked(rows, SEWER_CHAR.streetGrate)],
    channels: {
      spillway: tilesOfCode(grid, SEWER_TILE.spillway),
      nest_basin: tilesOfCode(grid, SEWER_TILE.nestBasin),
    },
    mainChannel: tilesOfCode(grid, SEWER_TILE.mainChannel),
    nest,
    drains,
    valves,
    outlets,
    fights,
    guideStops,
    connections,
  };
}

/** The whole sewer as one world builds it. */
export interface SewerPlan {
  /** Every section, in `SEWER_SECTION_IDS` order: the scene builds one map per entry. */
  readonly sections: ReadonlyArray<ParsedSewerSection>;
  readonly entrySection: SewerSectionId;
}

/** Index of a section in {@link SewerPlan.sections}, which is also its map's index in the scene. */
export function sewerSectionIndex(plan: SewerPlan, id: SewerSectionId): number {
  const index = SEWER_SECTION_IDS.indexOf(id);
  if (index < 0 || index >= plan.sections.length) {
    throw new Error(`the sewer plan has no section "${id}"`);
  }
  return index;
}

/** Parses every authored section. The sewer is the same in every world, so it takes no seed. */
export function planSewer(): SewerPlan {
  return {
    sections: SEWER_SECTION_IDS.map((id) => parseSewerSection(SEWER_SECTION_LAYOUTS[id])),
    entrySection: SEWER_ENTRY_SECTION,
  };
}

/**
 * Where a party coming back down the tower cistern's culvert is set down:
 * the section the culvert's mouth is in, and the open walkway tile beside the
 * mouth.
 */
export function towerCisternCulvertLanding(plan: SewerPlan): {
  readonly section: number;
  readonly tile: SewerTile;
} {
  for (let section = 0; section < plan.sections.length; section++) {
    const parsed = plan.sections[section];
    const culvert = parsed.connections.find((each) => each.connection.kind === 'tower_cistern');
    if (culvert === undefined) continue;
    for (const mouth of culvert.tiles) {
      for (const step of CARDINAL_STEPS) {
        const tile = { x: mouth.x + step.dx, y: mouth.y + step.dy };
        const char = parsed.layout.rows[tile.y]?.charAt(tile.x) ?? SEWER_CHAR.wall;
        if (char === SEWER_CHAR.walkway) return { section, tile };
      }
    }
  }
  throw new Error('no sewer section has the tower cistern culvert');
}

const CARDINAL_STEPS = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
] as const;
