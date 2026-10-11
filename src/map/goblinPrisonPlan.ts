/**
 * The Goblin High Security Prison as dealt to one world: which authored
 * layout the seed picked, parsed into the tile grid, the holding cells and the
 * named points the patrols and spotlights are scripted against.
 *
 * Everything downstream reads this one parse — `GameMap.generateGoblinPrison`
 * for the walkable map, the stealth system's patrols and lights, and the
 * headless solver that proves each layout can be crossed unseen — so the grid
 * a guard's cone is cast against is the grid the gate proved.
 */

import type { Difficulty } from '../core/difficultyProfiles';
import {
  PRISON_ANCHOR_CHARS,
  PRISON_CHAR,
  PRISON_LAYOUTS,
  PRISON_WAYPOINT_CHARS,
  type PrisonLayout,
  type PrisonRect,
  type PrisonSectionId,
} from './goblinPrisonLayouts';

/** One grid tile, in tile coordinates. */
export interface PrisonTile {
  readonly x: number;
  readonly y: number;
}

/** What a prison tile is, as the grid stores it. */
export const PRISON_TILE = {
  wall: 0,
  floor: 1,
  cover: 2,
  bars: 3,
  holdingFloor: 4,
  holdingDoor: 5,
  prisonerFloor: 6,
  pedestal: 7,
} as const;

export type PrisonTileCode = (typeof PRISON_TILE)[keyof typeof PRISON_TILE];

/** The prison's tile grid, row-major, one {@link PrisonTileCode} per tile. */
export interface PrisonGrid {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
}

/** One holding cell in the intake: its floor, its flimsy door and the hall tile the door opens onto. */
export interface PrisonHoldingCell {
  readonly tiles: ReadonlyArray<PrisonTile>;
  readonly door: PrisonTile;
  readonly hall: PrisonTile;
}

export interface ParsedPrisonLayout {
  readonly layout: PrisonLayout;
  readonly grid: PrisonGrid;
  readonly entry: PrisonTile;
  readonly exits: ReadonlyArray<PrisonTile>;
  readonly pedestal: PrisonTile;
  /** The floor tile south of the pedestal, where the key is lifted from. */
  readonly pedestalFront: PrisonTile;
  readonly holdingCells: ReadonlyArray<PrisonHoldingCell>;
  readonly waypoints: ReadonlyMap<string, PrisonTile>;
  readonly anchors: ReadonlyMap<string, PrisonTile>;
}

/** Every problem a layout's rows have, reported together so one run fixes them all. */
export class PrisonLayoutError extends Error {
  constructor(
    readonly layoutId: string,
    readonly problems: ReadonlyArray<string>,
  ) {
    super(`prison layout "${layoutId}": ${problems.join('; ')}`);
  }
}

const NEIGHBOUR_STEPS: ReadonlyArray<PrisonTile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function prisonTileIndex(grid: PrisonGrid, x: number, y: number): number {
  return y * grid.width + x;
}

export function prisonTileAt(grid: PrisonGrid, x: number, y: number): PrisonTileCode {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return PRISON_TILE.wall;
  return tileCodeOf(grid.tiles[prisonTileIndex(grid, x, y)]);
}

function tileCodeOf(value: number): PrisonTileCode {
  switch (value) {
    case PRISON_TILE.floor:
      return PRISON_TILE.floor;
    case PRISON_TILE.cover:
      return PRISON_TILE.cover;
    case PRISON_TILE.bars:
      return PRISON_TILE.bars;
    case PRISON_TILE.holdingFloor:
      return PRISON_TILE.holdingFloor;
    case PRISON_TILE.holdingDoor:
      return PRISON_TILE.holdingDoor;
    case PRISON_TILE.prisonerFloor:
      return PRISON_TILE.prisonerFloor;
    case PRISON_TILE.pedestal:
      return PRISON_TILE.pedestal;
    default:
      return PRISON_TILE.wall;
  }
}

/**
 * Whether a crawler can stand on the tile. A holding-cell door counts: any hit
 * breaks it, so it never seals a cell.
 */
export function isPrisonCrawlerWalkable(grid: PrisonGrid, x: number, y: number): boolean {
  const code = prisonTileAt(grid, x, y);
  return (
    code === PRISON_TILE.floor ||
    code === PRISON_TILE.holdingFloor ||
    code === PRISON_TILE.holdingDoor
  );
}

/** Whether a patrol guard may walk the tile. Guards keep to the open floor, never into a cell. */
export function isPrisonGuardWalkable(grid: PrisonGrid, x: number, y: number): boolean {
  return prisonTileAt(grid, x, y) === PRISON_TILE.floor;
}

export function rectContainsTile(rect: PrisonRect, x: number, y: number): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

/** The section a tile falls in, or null for the walls between them. */
export function prisonSectionAt(
  layout: PrisonLayout,
  x: number,
  y: number,
): PrisonSectionId | null {
  for (const section of layout.sections) {
    if (rectContainsTile(section.rect, x, y)) return section.id;
  }
  return null;
}

function tileCodeForChar(char: string): PrisonTileCode | null {
  switch (char) {
    case PRISON_CHAR.wall:
      return PRISON_TILE.wall;
    case PRISON_CHAR.floor:
    case PRISON_CHAR.entry:
    case PRISON_CHAR.exit:
      return PRISON_TILE.floor;
    case PRISON_CHAR.cover:
      return PRISON_TILE.cover;
    case PRISON_CHAR.bars:
      return PRISON_TILE.bars;
    case PRISON_CHAR.holdingFloor:
      return PRISON_TILE.holdingFloor;
    case PRISON_CHAR.holdingDoor:
      return PRISON_TILE.holdingDoor;
    case PRISON_CHAR.prisonerFloor:
      return PRISON_TILE.prisonerFloor;
    case PRISON_CHAR.pedestal:
      return PRISON_TILE.pedestal;
    default:
      if (PRISON_ANCHOR_CHARS.includes(char)) return PRISON_TILE.wall;
      if (PRISON_WAYPOINT_CHARS.includes(char)) return PRISON_TILE.floor;
      return null;
  }
}

function tileKey(tile: PrisonTile): string {
  return `${tile.x},${tile.y}`;
}

function findHoldingCells(grid: PrisonGrid, problems: string[]): ReadonlyArray<PrisonHoldingCell> {
  const seen = new Set<string>();
  const cells: PrisonHoldingCell[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (prisonTileAt(grid, x, y) !== PRISON_TILE.holdingFloor) continue;
      const startKey = tileKey({ x, y });
      if (seen.has(startKey)) continue;
      const tiles: PrisonTile[] = [];
      const doors = new Map<string, PrisonTile>();
      const stack: PrisonTile[] = [{ x, y }];
      seen.add(startKey);
      while (stack.length > 0) {
        const tile = stack.pop();
        if (tile === undefined) break;
        tiles.push(tile);
        for (const step of NEIGHBOUR_STEPS) {
          const next = { x: tile.x + step.x, y: tile.y + step.y };
          const code = prisonTileAt(grid, next.x, next.y);
          if (code === PRISON_TILE.holdingDoor) doors.set(tileKey(next), next);
          if (code !== PRISON_TILE.holdingFloor) continue;
          const key = tileKey(next);
          if (seen.has(key)) continue;
          seen.add(key);
          stack.push(next);
        }
      }
      const doorList = [...doors.values()];
      if (doorList.length !== 1) {
        problems.push(`holding cell at ${startKey} has ${doorList.length} doors, wants exactly 1`);
        continue;
      }
      const door = doorList[0];
      const inward = NEIGHBOUR_STEPS.find(
        (step) => prisonTileAt(grid, door.x + step.x, door.y + step.y) === PRISON_TILE.holdingFloor,
      );
      if (inward === undefined) continue;
      const hall = { x: door.x - inward.x, y: door.y - inward.y };
      cells.push({ tiles, door, hall });
    }
  }
  return cells;
}

/**
 * Parses an authored layout's rows into a grid and its named points.
 *
 * @throws {PrisonLayoutError} listing every malformed row, unknown glyph,
 *   duplicate or missing marker, and holding cell without exactly one door.
 */
export function parsePrisonLayout(layout: PrisonLayout): ParsedPrisonLayout {
  const problems: string[] = [];
  const height = layout.rows.length;
  const width = layout.rows[0]?.length ?? 0;
  const tiles = new Uint8Array(width * height);
  const grid: PrisonGrid = { width, height, tiles };
  const waypoints = new Map<string, PrisonTile>();
  const anchors = new Map<string, PrisonTile>();
  let entry: PrisonTile | null = null;
  let pedestal: PrisonTile | null = null;
  const exits: PrisonTile[] = [];

  for (let y = 0; y < layout.rows.length; y++) {
    const row = layout.rows[y] ?? '';
    if (row.length !== width) problems.push(`row ${y} is ${row.length} wide, wants ${width}`);
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      const code = tileCodeForChar(char);
      if (code === null) {
        problems.push(`unknown glyph "${char}" at ${x},${y}`);
        continue;
      }
      tiles[y * width + x] = code;
      const tile = { x, y };
      if (char === PRISON_CHAR.entry) {
        if (entry !== null) problems.push(`second entry at ${x},${y}`);
        entry = tile;
      } else if (char === PRISON_CHAR.exit) {
        exits.push(tile);
      } else if (char === PRISON_CHAR.pedestal) {
        if (pedestal !== null) problems.push(`second pedestal at ${x},${y}`);
        pedestal = tile;
      } else if (PRISON_ANCHOR_CHARS.includes(char)) {
        if (anchors.has(char)) problems.push(`anchor "${char}" appears twice`);
        anchors.set(char, tile);
      } else if (PRISON_WAYPOINT_CHARS.includes(char)) {
        if (waypoints.has(char)) problems.push(`waypoint "${char}" appears twice`);
        waypoints.set(char, tile);
      }
    }
  }

  const isBorder = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isBorder(x, y) && prisonTileAt(grid, x, y) !== PRISON_TILE.wall) {
        problems.push(`border tile ${x},${y} is open`);
      }
    }
  }

  const holdingCells = findHoldingCells(grid, problems);
  const pedestalFront: PrisonTile | null =
    pedestal === null ? null : { x: pedestal.x, y: pedestal.y + 1 };
  if (entry === null) problems.push('no entry');
  if (exits.length === 0) problems.push('no exit');
  if (pedestal === null || pedestalFront === null) problems.push('no pedestal');
  else if (prisonTileAt(grid, pedestalFront.x, pedestalFront.y) !== PRISON_TILE.floor) {
    problems.push('the tile south of the pedestal is not floor');
  }

  if (problems.length > 0 || entry === null || pedestal === null || pedestalFront === null) {
    throw new PrisonLayoutError(layout.id, problems);
  }
  return {
    layout,
    grid,
    entry,
    exits,
    pedestal,
    pedestalFront,
    holdingCells,
    waypoints,
    anchors,
  };
}

const SEED_MIX_SHIFT = 16;
const SEED_MIX_MULTIPLIER = 0x45d9f3b;

/** A small integer mix, so neighbouring world seeds do not walk the layouts in order. */
function scrambleSeed(seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> SEED_MIX_SHIFT), SEED_MIX_MULTIPLIER);
  h = Math.imul(h ^ (h >>> SEED_MIX_SHIFT), SEED_MIX_MULTIPLIER);
  return (h ^ (h >>> SEED_MIX_SHIFT)) >>> 0;
}

/**
 * Which authored layout a world gets. Read from the world seed alone, so
 * every visit to the same world's prison is the same prison.
 */
export function pickPrisonLayout(worldSeed: number): PrisonLayout {
  if (PRISON_LAYOUTS.length === 0) throw new Error('no prison layouts are authored');
  return PRISON_LAYOUTS[scrambleSeed(worldSeed) % PRISON_LAYOUTS.length];
}

/** The prison for one world and difficulty. */
export interface PrisonPlan {
  readonly worldSeed: number;
  readonly difficulty: Difficulty;
  readonly parsed: ParsedPrisonLayout;
}

/**
 * The prison for one world and difficulty, built from the world's own layout
 * unless `layout` names another, as a dev route choosing one does.
 */
export function planGoblinPrison(
  worldSeed: number,
  difficulty: Difficulty,
  layout: PrisonLayout = pickPrisonLayout(worldSeed),
): PrisonPlan {
  return { worldSeed, difficulty, parsed: parsePrisonLayout(layout) };
}
