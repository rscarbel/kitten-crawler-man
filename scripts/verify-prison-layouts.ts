/**
 * The Goblin High Security Prison's authored layouts, checked as built.
 *
 * For each layout in `PRISON_LAYOUTS`: it parses, at a size well beyond any
 * town interior; the entry, every holding cell, the pedestal and the exits are
 * one connected floor; every holding cell's flimsy door opens onto the hall;
 * no light reaches the intake at any moment of any loop at any difficulty, so
 * breaking out of a cell is never itself a catch; every patrol walks open
 * floor and closes its loop; every spotlight's disc stays on the floor and
 * never crosses a wall; and each section carries the stealth problem it is
 * named for.
 *
 *   npx tsx scripts/verify-prison-layouts.ts [--fault=<name>]
 *
 * Every `--fault=` injects one authoring mistake the gate exists to catch and
 * must turn it red.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { CRATE } from '../src/map/tileTypes.js';
import { TILE_TYPE_FOR_KIND } from '../src/systems/DestructiblePropSystem.js';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles.js';
import {
  PRISON_LAYOUTS,
  PRISON_SECTION_ORDER,
  PRISON_WAYPOINT_CHARS,
  type PrisonLayout,
  type PrisonSectionId,
} from '../src/map/goblinPrisonLayouts.js';
import {
  isPrisonCrawlerWalkable,
  isPrisonGuardWalkable,
  parsePrisonLayout,
  PRISON_TILE,
  prisonSectionAt,
  prisonTileAt,
  rectContainsTile,
  type ParsedPrisonLayout,
  type PrisonTile,
} from '../src/map/goblinPrisonPlan.js';
import { lightHasLineOfSight } from '../src/systems/stealthKeySnatch/detection.js';
import {
  compilePrison,
  guardRouteIsWalkable,
  type CompiledGuard,
  type CompiledPrison,
} from '../src/systems/stealthKeySnatch/prisonPatrols.js';
import { PRISON_TUNING } from '../src/systems/stealthKeySnatch/prisonTuning.js';
import { buildLitTables, buildTimeline, SOLVER_QUANTUM_FRAMES } from './prisonStealthSolver.js';

const FAULTS = [
  /** A holding cell's door opens onto a wall instead of the hall. */
  'door-faces-wall',
  /** A holding cell is walled up with no door at all. */
  'cell-without-door',
  /** A spotlight swings over the intake hall. */
  'intake-lit',
  /** A crate stack is dropped on a patrol's route. */
  'route-through-wall',
  /** A patrol's script stops short of walking back to its start. */
  'route-open',
  /** A wall is built across the middle of a spotlight's track. */
  'spot-through-wall',
  /** The pedestal's room is sealed off from the rest of the prison. */
  'pedestal-sealed',
  /** A bar between a corridor and an occupied cell is left out. */
  'cell-open-to-floor',
  /** The built map lets crawlers walk into the occupied cells. */
  'prisoners-walkable',
  /** The built map's cover is a crate that prop destruction can smash. */
  'cover-breakable',
] as const;
type Fault = (typeof FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

function parseArgs(): Fault | null {
  let fault: Fault | null = null;
  for (const arg of process.argv.slice(2)) {
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? '' : arg.slice(separator + 1);
    if (name === '--fault' && isFault(value)) fault = value;
    else {
      console.error(`unknown argument ${arg}; faults: ${FAULTS.join(', ')}`);
      process.exit(2);
    }
  }
  return fault;
}

const fault = parseArgs();

const MIN_WIDTH = 56;
const MAX_WIDTH = 70;
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 50;
const MIN_HOLDING_CELLS = 4;
const MAX_HOLDING_CELLS = 6;
const MIN_YARD_SPOTLIGHTS = 2;
const MAX_YARD_SPOTLIGHTS = 3;
const MIN_YARD_GUARDS = 1;
const MAX_YARD_GUARDS = 2;
const MIN_CELL_BLOCK_GUARDS = 2;
const MAX_GUARDS = 12;
const MAX_SPOTLIGHTS = 5;
const DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];
const AUTHORED_LAYOUT_COUNT = 3;
/** How far into its period the 'spot-through-wall' fault looks for a tile to wall over. */
const FAULT_TRACK_FRACTION = 0.25;
/** Spotlight centres are sampled this often along their period, in frames. */
const TRACK_SAMPLE_FRAMES = 2;

const STEPS: ReadonlyArray<PrisonTile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

function withRow(
  rows: ReadonlyArray<string>,
  tile: PrisonTile,
  glyph: string,
): ReadonlyArray<string> {
  return rows.map((row, y) =>
    y === tile.y ? `${row.slice(0, tile.x)}${glyph}${row.slice(tile.x + 1)}` : row,
  );
}

function unusedWaypoint(layout: PrisonLayout): string {
  const used = layout.rows.join('');
  for (let index = 0; index < PRISON_WAYPOINT_CHARS.length; index++) {
    const char = PRISON_WAYPOINT_CHARS.charAt(index);
    if (!used.includes(char)) return char;
  }
  throw new Error(`${layout.id} uses every waypoint glyph`);
}

/** The layout with this run's fault injected, or the layout itself. */
function faulted(layout: PrisonLayout): PrisonLayout {
  if (fault === null) return layout;
  const clean = parsePrisonLayout(layout);
  const firstCell = clean.holdingCells.length > 0 ? clean.holdingCells[0] : null;
  switch (fault) {
    case 'door-faces-wall':
      return firstCell === null
        ? layout
        : { ...layout, rows: withRow(layout.rows, firstCell.hall, '#') };
    case 'cell-without-door':
      return firstCell === null
        ? layout
        : { ...layout, rows: withRow(layout.rows, firstCell.door, '#') };
    case 'intake-lit': {
      if (firstCell === null) return layout;
      const pivot = unusedWaypoint(layout);
      const anchor = layout.spotlights[0]?.anchor ?? '1';
      return {
        ...layout,
        rows: withRow(layout.rows, firstCell.hall, pivot),
        spotlights: [
          ...layout.spotlights,
          {
            id: 'fault-intake',
            section: 'intake',
            anchor,
            tier: 0,
            track: { kind: 'pivot', pivot, radiusTiles: 1, fromDeg: 0, toDeg: 90 },
          },
        ],
      };
    }
    case 'route-through-wall': {
      const { guards } = compilePrison(clean, 'normal');
      if (guards.length === 0 || guards[0].routeTiles.length < 2) return layout;
      return { ...layout, rows: withRow(layout.rows, guards[0].routeTiles[1].tile, '%') };
    }
    case 'route-open': {
      if (layout.guards.length === 0) return layout;
      const [first, ...rest] = layout.guards;
      const tokens = first.script.trim().split(/\s+/);
      const lastWalk = tokens.map((token) => token.startsWith('>')).lastIndexOf(true);
      const shortened = tokens.filter((_token, index) => index !== lastWalk).join(' ');
      return { ...layout, guards: [{ ...first, script: shortened }, ...rest] };
    }
    case 'spot-through-wall': {
      const spot = compilePrison(clean, 'normal').spotlights.find(
        (entry) => entry.def.track.kind === 'path',
      );
      if (spot === undefined) return layout;
      const middle = spot.centreAt(Math.floor(spot.periodFrames * FAULT_TRACK_FRACTION));
      const tile = { x: Math.floor(middle.x / TILE_SIZE), y: Math.floor(middle.y / TILE_SIZE) };
      return { ...layout, rows: withRow(layout.rows, tile, '#') };
    }
    case 'cell-open-to-floor': {
      for (let y = 0; y < clean.grid.height; y++) {
        for (let x = 0; x < clean.grid.width; x++) {
          if (prisonTileAt(clean.grid, x, y) !== PRISON_TILE.bars) continue;
          const besideCell = STEPS.some(
            (step) =>
              prisonTileAt(clean.grid, x + step.x, y + step.y) === PRISON_TILE.prisonerFloor,
          );
          const besideFloor = STEPS.some((step) =>
            isPrisonCrawlerWalkable(clean.grid, x + step.x, y + step.y),
          );
          if (besideCell && besideFloor)
            return { ...layout, rows: withRow(layout.rows, { x, y }, '.') };
        }
      }
      return layout;
    }
    case 'prisoners-walkable':
    case 'cover-breakable':
      return layout;
    case 'pedestal-sealed': {
      const front = clean.pedestalFront;
      const sealed = STEPS.map((step) => ({ x: front.x + step.x, y: front.y + step.y })).filter(
        (tile) => isPrisonCrawlerWalkable(clean.grid, tile.x, tile.y),
      );
      return {
        ...layout,
        rows: sealed.reduce((rows, tile) => withRow(rows, tile, '#'), layout.rows),
      };
    }
  }
}

function reachableFrom(parsed: ParsedPrisonLayout, start: PrisonTile): Set<string> {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: PrisonTile[] = [start];
  for (const tile of queue) {
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !isPrisonCrawlerWalkable(parsed.grid, next.x, next.y)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

function sectionRect(
  layout: PrisonLayout,
  id: PrisonSectionId,
): PrisonLayout['sections'][number]['rect'] | null {
  return layout.sections.find((section) => section.id === id)?.rect ?? null;
}

function checkShape(parsed: ParsedPrisonLayout): void {
  const { layout, grid } = parsed;
  const label = layout.id;
  check(
    grid.width >= MIN_WIDTH &&
      grid.width <= MAX_WIDTH &&
      grid.height >= MIN_HEIGHT &&
      grid.height <= MAX_HEIGHT,
    `${label}: ${grid.width}×${grid.height} is outside ${MIN_WIDTH}–${MAX_WIDTH} × ${MIN_HEIGHT}–${MAX_HEIGHT}`,
  );
  check(
    layout.sections.map((section) => section.id).join() === PRISON_SECTION_ORDER.join(),
    `${label}: sections are not intake, yard, cell block, vault in order`,
  );
  check(
    layout.cycleFrames % SOLVER_QUANTUM_FRAMES === 0,
    `${label}: cycle ${layout.cycleFrames} is not a whole number of solver quanta`,
  );
  const intake = sectionRect(layout, 'intake');
  const vault = sectionRect(layout, 'vault');
  const inIntake = (tile: PrisonTile): boolean =>
    intake !== null && rectContainsTile(intake, tile.x, tile.y);
  check(inIntake(parsed.entry), `${label}: the entry is outside the intake`);
  check(parsed.exits.every(inIntake), `${label}: an exit is outside the intake`);
  check(
    vault !== null && rectContainsTile(vault, parsed.pedestal.x, parsed.pedestal.y),
    `${label}: the pedestal is outside the vault`,
  );
  const cellCount = parsed.holdingCells.length;
  check(
    cellCount >= MIN_HOLDING_CELLS && cellCount <= MAX_HOLDING_CELLS,
    `${label}: ${cellCount} holding cells, wants ${MIN_HOLDING_CELLS}–${MAX_HOLDING_CELLS}`,
  );
  for (const cell of parsed.holdingCells) {
    const where = `${label}: holding cell door (${cell.door.x},${cell.door.y})`;
    check(cell.tiles.every(inIntake) && inIntake(cell.door), `${where} is outside the intake`);
    check(
      prisonTileAt(grid, cell.hall.x, cell.hall.y) === PRISON_TILE.floor,
      `${where} does not open onto a hall tile`,
    );
    const across = { x: cell.hall.y - cell.door.y, y: cell.hall.x - cell.door.x };
    const sides = [
      { x: cell.door.x + across.x, y: cell.door.y + across.y },
      { x: cell.door.x - across.x, y: cell.door.y - across.y },
    ];
    check(
      sides.every((side) => !isPrisonCrawlerWalkable(grid, side.x, side.y)),
      `${where} has open floor beside it, so the cell is not sealed by it`,
    );
  }
  let prisonerTiles = 0;
  const cellBlock = sectionRect(layout, 'cellBlock');
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (
        prisonTileAt(grid, x, y) === PRISON_TILE.prisonerFloor &&
        cellBlock !== null &&
        rectContainsTile(cellBlock, x, y)
      ) {
        prisonerTiles++;
      }
    }
  }
  check(prisonerTiles > 0, `${label}: the cell block has no occupied cells`);
  let openCell: PrisonTile | null = null;
  for (let y = 0; y < grid.height && openCell === null; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (prisonTileAt(grid, x, y) !== PRISON_TILE.prisonerFloor) continue;
      if (STEPS.some((step) => isPrisonCrawlerWalkable(grid, x + step.x, y + step.y))) {
        openCell = { x, y };
        break;
      }
    }
  }
  check(
    openCell === null,
    `${label}: occupied cell floor (${openCell?.x},${openCell?.y}) touches open floor with no bars between`,
  );

  const reach = reachableFrom(parsed, parsed.entry);
  const reached = (tile: PrisonTile): boolean => reach.has(`${tile.x},${tile.y}`);
  check(reached(parsed.pedestalFront), `${label}: the pedestal cannot be reached from the entry`);
  check(parsed.exits.every(reached), `${label}: an exit cannot be reached from the entry`);
  check(
    parsed.holdingCells.every((cell) => cell.tiles.every(reached)),
    `${label}: a holding cell cannot be reached from the entry`,
  );
  check(
    layout.guards.length <= MAX_GUARDS,
    `${label}: ${layout.guards.length} guards, at most ${MAX_GUARDS}`,
  );
  check(
    layout.spotlights.length <= MAX_SPOTLIGHTS,
    `${label}: ${layout.spotlights.length} spotlights, at most ${MAX_SPOTLIGHTS}`,
  );
}

/** The prison as `GameMap` builds it must be walkable exactly where the stealth grid says, and its cover unbreakable. */
function checkBuiltMap(parsed: ParsedPrisonLayout): void {
  const label = parsed.layout.id;
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  const plan = { worldSeed: 0, difficulty: 'normal' as const, parsed };
  map.generateInterior('prison', 0, 'level2_goblin_prison', false, { kind: 'goblin_prison', plan });
  const { grid } = parsed;
  const breakableTypes = new Set<number>(Object.values(TILE_TYPE_FOR_KIND));
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const code = prisonTileAt(grid, x, y);
      if (fault === 'prisoners-walkable' && code === PRISON_TILE.prisonerFloor) {
        map.unblockTilePermanently(x, y);
      }
      if (fault === 'cover-breakable' && code === PRISON_TILE.cover)
        map.structure[y][x].type = CRATE;
    }
  }
  let mismatch: PrisonTile | null = null;
  let breakable: PrisonTile | null = null;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (mismatch === null && map.isWalkable(x, y) !== isPrisonCrawlerWalkable(grid, x, y)) {
        mismatch = { x, y };
      }
      const code = prisonTileAt(grid, x, y);
      if (
        breakable === null &&
        code === PRISON_TILE.cover &&
        breakableTypes.has(map.structure[y][x].type)
      ) {
        breakable = { x, y };
      }
    }
  }
  check(
    mismatch === null,
    `${label}: the built map's walkability disagrees with the stealth grid at (${mismatch?.x},${mismatch?.y})`,
  );
  check(
    breakable === null,
    `${label}: cover at (${breakable?.x},${breakable?.y}) is built as a prop that can be smashed`,
  );
}

function guardSections(
  compiled: CompiledPrison,
  guard: CompiledGuard,
): Set<PrisonSectionId | null> {
  return new Set(
    guard.routeTiles.map(({ tile }) => prisonSectionAt(compiled.parsed.layout, tile.x, tile.y)),
  );
}

/** Whether two patrols cross: one walks through a tile along a row while the other walks it along a column. */
function patrolsCross(a: CompiledGuard, b: CompiledGuard): boolean {
  const axes = (guard: CompiledGuard): Map<string, Set<'row' | 'column'>> => {
    const byTile = new Map<string, Set<'row' | 'column'>>();
    for (const segment of guard.segments) {
      if (segment.kind !== 'move') continue;
      const axis = segment.from.y === segment.to.y ? 'row' : 'column';
      const steps = Math.round(
        Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) / TILE_SIZE,
      );
      for (let step = 0; step <= steps; step++) {
        const fraction = steps === 0 ? 0 : step / steps;
        const x = Math.floor(
          (segment.from.x + (segment.to.x - segment.from.x) * fraction) / TILE_SIZE,
        );
        const y = Math.floor(
          (segment.from.y + (segment.to.y - segment.from.y) * fraction) / TILE_SIZE,
        );
        const set = byTile.get(`${x},${y}`) ?? new Set<'row' | 'column'>();
        set.add(axis);
        byTile.set(`${x},${y}`, set);
      }
    }
    return byTile;
  };
  const axesA = axes(a);
  for (const [key, axisB] of axes(b)) {
    const axisA = axesA.get(key);
    if (axisA === undefined) continue;
    if ((axisA.has('row') && axisB.has('column')) || (axisA.has('column') && axisB.has('row')))
      return true;
  }
  return false;
}

function checkDifficulty(parsed: ParsedPrisonLayout, difficulty: Difficulty): void {
  const label = `${parsed.layout.id} ${difficulty}`;
  let compiled: CompiledPrison;
  try {
    compiled = compilePrison(parsed, difficulty);
  } catch (error) {
    check(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const { layout, grid } = parsed;

  for (const guard of compiled.guards) {
    const offFloor = guard.routeTiles.find(
      ({ tile }) => !isPrisonGuardWalkable(grid, tile.x, tile.y),
    );
    check(
      guardRouteIsWalkable(parsed, guard),
      `${label}: ${guard.def.id} walks off the open floor at (${offFloor?.tile.x},${offFloor?.tile.y})`,
    );
    const sections = guardSections(compiled, guard);
    check(
      sections.size === 1 && sections.has(guard.def.section),
      `${label}: ${guard.def.id} leaves its ${guard.def.section} section`,
    );
  }

  for (const spot of compiled.spotlights) {
    let previous = spot.centreAt(0);
    let onFloor = true;
    let throughWall = false;
    for (let frame = 0; frame <= spot.periodFrames; frame += TRACK_SAMPLE_FRAMES) {
      const centre = spot.centreAt(frame);
      const code = prisonTileAt(
        grid,
        Math.floor(centre.x / TILE_SIZE),
        Math.floor(centre.y / TILE_SIZE),
      );
      if (code !== PRISON_TILE.floor && code !== PRISON_TILE.cover) onFloor = false;
      if (!lightHasLineOfSight(grid, previous, centre, 'disc')) throughWall = true;
      previous = centre;
    }
    check(onFloor, `${label}: ${spot.def.id}'s disc leaves the floor`);
    check(!throughWall, `${label}: ${spot.def.id}'s track crosses a wall`);
    const centreSection = prisonSectionAt(
      layout,
      Math.floor(spot.centreAt(0).x / TILE_SIZE),
      Math.floor(spot.centreAt(0).y / TILE_SIZE),
    );
    check(
      centreSection === spot.def.section,
      `${label}: ${spot.def.id} shines outside its ${spot.def.section} section`,
    );
  }

  const guardsIn = (section: PrisonSectionId): CompiledGuard[] =>
    compiled.guards.filter((guard) => guard.def.section === section);
  const spotsIn = (section: PrisonSectionId): CompiledPrison['spotlights'] =>
    compiled.spotlights.filter((spot) => spot.def.section === section);
  check(
    guardsIn('intake').length === 0 && spotsIn('intake').length === 0,
    `${label}: the intake has a light of its own`,
  );
  const yardSpots = spotsIn('yard').length;
  check(
    yardSpots >= MIN_YARD_SPOTLIGHTS && yardSpots <= MAX_YARD_SPOTLIGHTS,
    `${label}: ${yardSpots} yard spotlights, wants ${MIN_YARD_SPOTLIGHTS}–${MAX_YARD_SPOTLIGHTS}`,
  );
  const yardGuards = guardsIn('yard').length;
  check(
    yardGuards >= MIN_YARD_GUARDS && yardGuards <= MAX_YARD_GUARDS,
    `${label}: ${yardGuards} yard guards, wants ${MIN_YARD_GUARDS}–${MAX_YARD_GUARDS}`,
  );
  const cellGuards = guardsIn('cellBlock');
  check(
    cellGuards.length >= MIN_CELL_BLOCK_GUARDS,
    `${label}: ${cellGuards.length} cell block guards, wants at least ${MIN_CELL_BLOCK_GUARDS}`,
  );
  check(
    cellGuards.some((a, index) => cellGuards.slice(index + 1).some((b) => patrolsCross(a, b))),
    `${label}: no junction in the cell block where two patrols cross`,
  );
  const vaultPivots = spotsIn('vault').filter((spot) => spot.def.track.kind === 'pivot');
  check(
    vaultPivots.length === 1,
    `${label}: the vault has ${vaultPivots.length} rotating spotlights, wants 1`,
  );
  const turners = guardsIn('vault').filter(
    (guard) =>
      guard.routeTiles.length === 1 && guard.segments.some((segment) => segment.kind === 'turn'),
  );
  check(turners.length >= 1, `${label}: the vault has no guard who turns on the spot`);

  const timeline = buildTimeline(compiled);
  const lit = buildLitTables(timeline);
  const intake = sectionRect(layout, 'intake');
  let litIntakeTile: PrisonTile | null = null;
  for (let quantum = 0; quantum < lit.quanta && litIntakeTile === null; quantum++) {
    for (let index = 0; index < lit.tileCount; index++) {
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      if (intake === null || !rectContainsTile(intake, x, y)) continue;
      const at = quantum * lit.tileCount + index;
      if (lit.centre[at] === 1 || lit.edgeEast[at] === 1 || lit.edgeSouth[at] === 1) {
        litIntakeTile = { x, y };
        break;
      }
    }
  }
  check(
    litIntakeTile === null,
    `${label}: a light reaches the intake at (${litIntakeTile?.x},${litIntakeTile?.y})`,
  );
}

console.log(`── prison layouts${fault === null ? '' : `, fault ${fault}`} ──`);
check(
  PRISON_LAYOUTS.length === AUTHORED_LAYOUT_COUNT,
  `${PRISON_LAYOUTS.length} layouts are authored, wants ${AUTHORED_LAYOUT_COUNT}`,
);
for (const layout of PRISON_LAYOUTS) {
  let parsed: ParsedPrisonLayout;
  try {
    parsed = parsePrisonLayout(faulted(layout));
  } catch (error) {
    check(false, error instanceof Error ? error.message : String(error));
    continue;
  }
  checkShape(parsed);
  checkBuiltMap(parsed);
  for (const difficulty of DIFFICULTIES) checkDifficulty(parsed, difficulty);
  console.log(`  ${layout.id}: checked at ${DIFFICULTIES.join(', ')}`);
}
check(
  DIFFICULTIES.every(
    (difficulty, index) =>
      index === 0 ||
      PRISON_TUNING[difficulty].guardTier >=
        PRISON_TUNING[DIFFICULTIES[index - 1] ?? 'easy'].guardTier,
  ),
  'a harder difficulty stands fewer guard tiers than an easier one',
);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
