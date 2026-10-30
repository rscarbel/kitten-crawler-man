/**
 * The Goblin High Security Prison, solved headlessly at every difficulty.
 *
 * Patrols and spotlights are periodic, so `prisonStealthSolver.ts` can search
 * every (tile, moment of the cycle) with the game's own detection functions
 * and the crawlers' real walking speed, the party's line in single file on
 * the leader's trail, each follower one tile behind the body ahead. For every
 * layout × difficulty this proves:
 *
 * - **Solvable**: a route to the key and a route from the key back to the exit
 *   on which no light sees either crawler on any frame — zero suspicion grace,
 *   so the route is clean rather than lucky.
 * - **Not walkable straight**: the shortest walk to the key, at full speed and
 *   ignoring every light, ends in a capture whatever moment it sets off at,
 *   with the game's real suspicion fill. That is what makes it a puzzle.
 * - **No blind-spot shortcut**: no route to the key avoids the yard, and none
 *   avoids the cell block.
 * - **Noise**: dynamite going off in a guard's light is an alarm; going off
 *   where the guard only hears it sends the guard to the spot and back onto its
 *   loop.
 * - **The tower's gatehouse**, which reuses the prison's guards on its own
 *   floor: from the cellar stair's landing to the stair up unseen at every
 *   difficulty, the shortest walk caught from normal up, and the same noise
 *   answers. The search is shown able to say no: with the landing's guard
 *   posted for good over the stair up's landing, it must find no route. Its
 *   guards catch at a glance: the human in full view within
 *   `CAUGHT_AFTER_SEEN_SECONDS`, a companion in a look raising only an orange
 *   alert, and on orange any sight of the human being the catch. The route
 *   found, replayed frame by frame with his hire and his cow in single file
 *   on his trail, keeps both out of every look.
 *
 *   npx tsx scripts/verify-prison-stealth.ts [--fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../src/core/constants.js';
import { PARTY_TRAIL_SPACING_TILES, type PartyLinePlace } from '../src/systems/partyTrail.js';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles.js';
import {
  PRISON_LAYOUTS,
  type PrisonLayout,
  type PrisonSectionId,
} from '../src/map/goblinPrisonLayouts.js';
import {
  isPrisonGuardWalkable,
  parsePrisonLayout,
  PRISON_TILE,
  type PrisonGrid,
  type PrisonTile,
  type StealthFloor,
} from '../src/map/goblinPrisonPlan.js';
import {
  guardCone,
  compilePrisonWithTuning,
  compileStealthFloor,
  guardPoseAt,
  tileCentrePx,
  type CompiledGuard,
  type CompiledPrison,
  type CompiledStealth,
} from '../src/systems/stealthKeySnatch/prisonPatrols.js';
import {
  compileGatehouseWatch,
  gatehouseCellarLanding,
  gatehouseStairUpLanding,
  gatehouseStealthFloor,
  GATEHOUSE_TUNING,
  type GatehouseGuardId,
} from '../src/systems/tower/gatehouseWatch.js';
import type { TowerConditions } from '../src/map/town/interiors/townCenterTower.js';
import {
  everyTowerConditions,
  towerConditionsKey,
  towerStoreyPlan,
  towerStoreyStateKey,
} from '../src/map/town/interiors/townCenterTower.js';
import { MISSING_CATS_PHASES } from '../src/core/quests/missingCatsProgress.js';
import {
  bodyTouchesGuard,
  CAUGHT_AFTER_SEEN_FRAMES,
  CAUGHT_AFTER_SEEN_SECONDS,
  lightCoversPoint,
  stepSuspicion,
  SUSPICION_CAPTURE,
  SUSPICION_ORANGE_ALERT,
  type PrisonPoint,
  type Sighting,
} from '../src/systems/stealthKeySnatch/detection.js';
import {
  investigationPoseAt,
  loopShiftAfter,
  respondToNoise,
  type GuardNoiseResponse,
  type PrisonNoise,
} from '../src/systems/stealthKeySnatch/prisonNoise.js';
import {
  PRISON_NOISE_RADIUS_TILES,
  PRISON_TUNING,
  type PrisonDifficultyTuning,
} from '../src/systems/stealthKeySnatch/prisonTuning.js';
import {
  buildLitTables,
  buildTimeline,
  sectionBlocker,
  shortestWalk,
  solve,
  solverLine,
  startState,
  walkPathWithSuspicion,
  walkRouteWithSuspicion,
} from './prisonStealthSolver.js';

const FAULTS = [
  /** Every guard is sent home and the spotlights shrink to nothing, so walking straight in works. */
  'empty-prison',
  /** Every spotlight floods the whole prison, so no clean route exists. */
  'floodlit',
  /** The yard's section is drawn as a single tile, so the prison can be crossed around it. */
  'yard-skirted',
  /** Guards ignore every noise. */
  'deaf-guards',
  /** A guard that sees a blast investigates instead of raising the alarm. */
  'blast-unseen',
  /** The tile-in-front catch ignores walls, so a guard catches round a corner. */
  'touch-round-corners',
  /** The gatehouse's guards fill their suspicion slowly, as the prison's do, instead of catching at a glance. */
  'slow-glance',
  /** The companions crossing the gatehouse straggle far behind the human instead of keeping to his trail. */
  'companion-straggles',
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

const DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];

/** The prison admits the crawlers alone: the one not steered walks the leader's trail. */
const PRISON_LINE = solverLine(1);
/**
 * The human's line across the gatehouse in his chapter of the split: his
 * hire, and his attack cow, who follows him wherever he is. Belle and her
 * pet are on her side of the tower.
 */
const GATEHOUSE_LINE_PLACES = [
  'hire',
  'attack_cow',
] as const satisfies ReadonlyArray<PartyLinePlace>;
const GATEHOUSE_LINE = solverLine(GATEHOUSE_LINE_PLACES.length);
/** How many escaping start frames a failure lists. */
const REPORTED_ESCAPES = 8;
/** The straight walk is set off at every frame of the cycle, so no escape window is narrow enough to slip between tries. */
const NAIVE_START_STEP_FRAMES = 1;
/** How far down a guard's facing the in-view blast is set off: well inside every difficulty's cone. */
const IN_VIEW_BLAST_DISTANCE_PX = TILE_SIZE * 2;
/** How finely the straight line to the in-view blast is checked for anything in the way. */
const IN_VIEW_SAMPLE_PX = 2;
/** How far either side of the line to the in-view blast must also be open floor. */
const IN_VIEW_CLEARANCE_PX = 2;
/** A blast closer than this is beside the guard rather than somewhere it must walk to. */
const MIN_HEARD_BLAST_DISTANCE_PX = TILE_SIZE * 2;
/** How far ahead in the cycle the noise checks look for a moment the guard's light is on open floor. */
const NOISE_PROBE_STEP_FRAMES = 30;
/** An investigation counts as having reached its spot within this distance of it. */
const ARRIVAL_TOLERANCE_PX = TILE_SIZE;
/** Pose agreement when the investigating guard steps back onto its loop. */
const REJOIN_POSITION_TOLERANCE_PX = 1;
const REJOIN_FACING_TOLERANCE_RAD = 0.01;
const FAULT_TINY_TILES = 0.01;
const FAULT_FLOOD_TILES = 200;
/** A cone that sees all the way round. */
const FAULT_FLOOD_HALF_ANGLE_DEG = 180;
const ANY_COVERAGE_WEIGHT = 1;
/**
 * Where the corner check stands its crawler, in tiles from the guard's tile
 * centre: past the north-east corner, inside the front reach, and on a line
 * that crosses the east tile.
 */
const CORNER_BODY_OFFSET = { x: 0.9, y: -0.7 } as const;
const SECTIONS_ON_THE_WAY: ReadonlyArray<PrisonSectionId> = ['yard', 'cellBlock'];

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

function tuningFor(difficulty: Difficulty): PrisonDifficultyTuning {
  const tuning = PRISON_TUNING[difficulty];
  if (fault === 'empty-prison') {
    return { ...tuning, spotlight: { ...tuning.spotlight, radiusTiles: FAULT_TINY_TILES } };
  }
  if (fault === 'floodlit') {
    return { ...tuning, spotlight: { ...tuning.spotlight, radiusTiles: FAULT_FLOOD_TILES } };
  }
  return tuning;
}

function layoutFor(layout: PrisonLayout): PrisonLayout {
  if (fault === 'empty-prison') return { ...layout, guards: [] };
  if (fault !== 'yard-skirted') return layout;
  return {
    ...layout,
    sections: layout.sections.map((section) =>
      section.id === 'yard'
        ? {
            ...section,
            rect: {
              x0: section.rect.x0,
              y0: section.rect.y0,
              x1: section.rect.x0,
              y1: section.rect.y0,
            },
          }
        : section,
    ),
  };
}

function responseFor(
  compiled: CompiledStealth,
  guard: CompiledGuard,
  frame: number,
  noise: PrisonNoise,
): GuardNoiseResponse {
  if (fault === 'deaf-guards') return { kind: 'ignore' };
  const response = respondToNoise(compiled, guard, guardPoseAt(guard, frame), frame, noise);
  if (fault === 'blast-unseen' && response.kind === 'alarm') return { kind: 'ignore' };
  return response;
}

function checkStealth(compiled: CompiledPrison, label: string): void {
  const { parsed } = compiled;
  const timeline = buildTimeline(compiled);
  const lit = buildLitTables(timeline);

  const toKey = solve(
    compiled,
    lit,
    [startState(compiled, lit, parsed.entry, PRISON_LINE)],
    [parsed.pedestalFront],
    PRISON_LINE,
  );
  check(toKey.found, `${label}: no unseen route from the entry to the key`);
  if (toKey.found) {
    const back = solve(compiled, lit, toKey.goalStates, parsed.exits, PRISON_LINE);
    check(back.found, `${label}: no unseen route from the key back to the exit`);
    console.log(
      `    ${label}: unseen to the key in ${toKey.frames} frames, back out in ${back.frames} frames`,
    );
  }

  const straight = shortestWalk(compiled, parsed.entry, parsed.pedestalFront);
  check(straight !== null, `${label}: the key cannot be walked to at all`);
  if (straight !== null) {
    const escapes: number[] = [];
    for (let start = 0; start < compiled.cycleFrames; start += NAIVE_START_STEP_FRAMES) {
      if (!walkPathWithSuspicion(timeline, straight, start).caught) escapes.push(start);
    }
    check(
      escapes.length === 0,
      `${label}: walking straight to the key escapes capture when setting off at frame(s) ${escapes.slice(0, REPORTED_ESCAPES).join(', ')}`,
    );
  }

  for (const section of SECTIONS_ON_THE_WAY) {
    const around = shortestWalk(
      compiled,
      parsed.entry,
      parsed.pedestalFront,
      sectionBlocker(compiled, section),
    );
    check(around === null, `${label}: the key can be reached without crossing the ${section}`);
  }
}

function floorTilesNear(parsed: StealthFloor, centre: PrisonTile, radius: number): PrisonTile[] {
  const tiles: PrisonTile[] = [];
  for (let y = centre.y - radius; y <= centre.y + radius; y++) {
    for (let x = centre.x - radius; x <= centre.x + radius; x++) {
      if (isPrisonGuardWalkable(parsed.grid, x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * Whether every point on the segment stands well inside open floor: nothing a
 * flashlight could be stopped by, not even a corner the line grazes.
 */
function straightLineIsOpenFloor(
  parsed: StealthFloor,
  from: PrisonPoint,
  to: PrisonPoint,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.ceil(length / IN_VIEW_SAMPLE_PX);
  for (let index = 0; index <= samples; index++) {
    const fraction = index / samples;
    const px = from.x + (to.x - from.x) * fraction;
    const py = from.y + (to.y - from.y) * fraction;
    for (const dx of [-IN_VIEW_CLEARANCE_PX, IN_VIEW_CLEARANCE_PX]) {
      for (const dy of [-IN_VIEW_CLEARANCE_PX, IN_VIEW_CLEARANCE_PX]) {
        const tileX = Math.floor((px + dx) / TILE_SIZE);
        const tileY = Math.floor((py + dy) / TILE_SIZE);
        if (!isPrisonGuardWalkable(parsed.grid, tileX, tileY)) return false;
      }
    }
  }
  return true;
}

/**
 * A corner a guard stands at: the guard's tile, open floor on its north-east
 * diagonal, walls north and east of it. In {@link CORNER_OPEN_GRID_ROWS} the
 * east tile is open instead.
 */
const CORNER_GRID_ROWS: ReadonlyArray<string> = ['#####', '##..#', '#.###', '#####'];
const CORNER_OPEN_GRID_ROWS: ReadonlyArray<string> = ['#####', '##..#', '#..##', '#####'];
const CORNER_GUARD_TILE = { x: 1, y: 2 } as const;

function gridOf(rows: ReadonlyArray<string>): PrisonGrid {
  const width = rows[0].length;
  const tiles = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = row.charAt(x) === '.' ? PRISON_TILE.floor : PRISON_TILE.wall;
    }
  });
  return { width, height: rows.length, tiles };
}

/**
 * The tile-in-front catch never reaches round a corner: a crawler just past
 * the corner, inside the front reach and straight along the guard's facing,
 * is not caught; with the tile ahead open, the same crawler is.
 */
function checkTouchCorners(): void {
  const centre = tileCentrePx(CORNER_GUARD_TILE);
  const body = {
    x: centre.x + CORNER_BODY_OFFSET.x * TILE_SIZE,
    y: centre.y + CORNER_BODY_OFFSET.y * TILE_SIZE,
  };
  const guard = { ...centre, facing: Math.atan2(CORNER_BODY_OFFSET.y, CORNER_BODY_OFFSET.x) };
  const corner = gridOf(fault === 'touch-round-corners' ? CORNER_OPEN_GRID_ROWS : CORNER_GRID_ROWS);
  check(!bodyTouchesGuard(corner, guard, body), 'a guard catches a crawler round a wall corner');
  check(
    bodyTouchesGuard(gridOf(CORNER_OPEN_GRID_ROWS), guard, body),
    'a guard misses a crawler on the open tile right in front of it',
  );
}

function checkNoise(compiled: CompiledStealth, label: string): void {
  const { parsed } = compiled;
  const blastRadiusTiles = PRISON_NOISE_RADIUS_TILES.explosion;
  for (const guard of compiled.guards) {
    const who = `${label} ${guard.def.id}`;
    let sawInView = false;
    let sawOutOfView = false;
    for (
      let frame = 0;
      frame < guard.periodFrames && !(sawInView && sawOutOfView);
      frame += NOISE_PROBE_STEP_FRAMES
    ) {
      const pose = guardPoseAt(guard, frame);
      const cone = guardCone(compiled, pose, frame);
      const standing = { x: Math.floor(pose.x / TILE_SIZE), y: Math.floor(pose.y / TILE_SIZE) };
      const nearby = floorTilesNear(parsed, standing, blastRadiusTiles);
      const blast = {
        x: pose.x + Math.cos(pose.facing) * IN_VIEW_BLAST_DISTANCE_PX,
        y: pose.y + Math.sin(pose.facing) * IN_VIEW_BLAST_DISTANCE_PX,
      };
      if (!sawInView && straightLineIsOpenFloor(parsed, pose, blast)) {
        sawInView = true;
        const response = responseFor(compiled, guard, frame, { kind: 'explosion', at: blast });
        check(
          response.kind === 'alarm',
          `${who}: a blast two tiles straight ahead over open floor at frame ${frame} did not raise the alarm`,
        );
      }
      if (sawOutOfView) continue;
      const unseen = nearby.filter((tile) => {
        const centre = tileCentrePx(tile);
        const distance = Math.hypot(centre.x - pose.x, centre.y - pose.y);
        return (
          distance >= MIN_HEARD_BLAST_DISTANCE_PX &&
          distance <= blastRadiusTiles * TILE_SIZE &&
          lightCoversPoint(parsed.grid, cone, centre, ANY_COVERAGE_WEIGHT) === 0
        );
      });
      for (const tile of unseen) {
        const noise: PrisonNoise = { kind: 'explosion', at: tileCentrePx(tile) };
        const response = responseFor(compiled, guard, frame, noise);
        if (fault !== 'deaf-guards' && response.kind !== 'investigate') continue;
        sawOutOfView = true;
        if (response.kind !== 'investigate') {
          check(false, `${who}: a blast it could only hear at frame ${frame} was ignored`);
          break;
        }
        const { plan } = response;
        let closest = Infinity;
        for (let t = 0; t <= plan.totalFrames; t++) {
          const { pose: walking } = investigationPoseAt(plan, pose, t);
          closest = Math.min(closest, Math.hypot(walking.x - noise.at.x, walking.y - noise.at.y));
        }
        check(
          closest <= ARRIVAL_TOLERANCE_PX,
          `${who}: the investigation never reached the blast (closest ${Math.round(closest)} px)`,
        );
        const finished = investigationPoseAt(plan, pose, plan.totalFrames);
        check(finished.done, `${who}: the investigation never finished`);
        const shift = loopShiftAfter(plan, frame);
        const resumed = guardPoseAt(guard, frame + plan.totalFrames - shift);
        const facingGap = Math.abs(
          Math.atan2(
            Math.sin(resumed.facing - finished.pose.facing),
            Math.cos(resumed.facing - finished.pose.facing),
          ),
        );
        check(
          Math.hypot(resumed.x - finished.pose.x, resumed.y - finished.pose.y) <=
            REJOIN_POSITION_TOLERANCE_PX && facingGap <= REJOIN_FACING_TOLERANCE_RAD,
          `${who}: the guard does not step back onto its loop where the investigation leaves it`,
        );
        break;
      }
    }
    check(
      sawInView,
      `${who}: never found a moment its light was on open floor to test a blast in view`,
    );
    check(sawOutOfView, `${who}: no blast it could only hear sent it to look`);
  }
}

console.log(`── prison stealth${fault === null ? '' : `, fault ${fault}`} ──`);
checkTouchCorners();
for (const layout of PRISON_LAYOUTS) {
  const parsed = parsePrisonLayout(layoutFor(layout));
  for (const difficulty of DIFFICULTIES) {
    const label = `${layout.id} ${difficulty}`;
    const compiled = compilePrisonWithTuning(parsed, difficulty, tuningFor(difficulty));
    checkStealth(compiled, label);
    checkNoise(compiled, label);
  }
}

/** Difficulties on which walking straight across the gatehouse must be caught; easy forgives it. */
const GATEHOUSE_STRAIGHT_CAUGHT_FROM: ReadonlyArray<Difficulty> = ['normal', 'hard'];

function gatehouseTuningFor(difficulty: Difficulty): PrisonDifficultyTuning {
  const tuning = GATEHOUSE_TUNING[difficulty];
  if (fault === 'slow-glance') return { ...tuning, suspicion: PRISON_TUNING[difficulty].suspicion };
  if (fault !== 'floodlit') return tuning;
  return {
    ...tuning,
    cone: {
      ...tuning.cone,
      rangeTiles: FAULT_FLOOD_TILES,
      halfAngleDeg: FAULT_FLOOD_HALF_ANGLE_DEG,
    },
  };
}

/** How far each straggling companion of the `companion-straggles` fault walks behind the one ahead, in tiles of the human's trail. */
const STRAGGLING_COMPANION_TILES = 4;

/**
 * How far behind the human, along his trail, each body of his line crosses
 * the gatehouse: each one link behind the body ahead of it.
 */
function gatehouseLineTrailTiles(): number[] {
  const link =
    fault === 'companion-straggles' ? STRAGGLING_COMPANION_TILES : PARTY_TRAIL_SPACING_TILES;
  return GATEHOUSE_LINE_PLACES.map((_, index) => (index + 1) * link);
}

function checkGatehouse(
  compiled: CompiledStealth,
  start: PrisonTile,
  goals: ReadonlyArray<PrisonTile>,
  label: string,
): void {
  const timeline = buildTimeline(compiled);
  const lit = buildLitTables(timeline);
  const across = solve(
    compiled,
    lit,
    [startState(compiled, lit, start, GATEHOUSE_LINE)],
    goals,
    GATEHOUSE_LINE,
  );
  check(across.found, `${label}: no unseen route from the cellar stair to the stair up`);
  if (across.found) console.log(`    ${label}: unseen across in ${across.frames} frames`);
  if (across.found) {
    const withCompanions = walkRouteWithSuspicion(
      timeline,
      across.route,
      gatehouseLineTrailTiles(),
    );
    check(
      !withCompanions.caught && withCompanions.companionSeenFrame === null,
      `${label}: the unseen route, walked with his line in single file on his trail, keeps it out of every look (${withCompanions.caught ? `caught by ${withCompanions.by ?? 'a guard'} on frame ${withCompanions.frame}` : 'uncaught'}, a companion first seen on frame ${withCompanions.companionSeenFrame ?? 'none'})`,
    );
  }
  if (!GATEHOUSE_STRAIGHT_CAUGHT_FROM.includes(compiled.difficulty)) return;
  const straight = goals.length === 0 ? null : shortestWalk(compiled, start, goals[0]);
  check(straight !== null, `${label}: the stair up cannot be walked to at all`);
  if (straight === null) return;
  const escapes: number[] = [];
  for (let frame = 0; frame < compiled.cycleFrames; frame += NAIVE_START_STEP_FRAMES) {
    if (!walkPathWithSuspicion(timeline, straight, frame).caught) escapes.push(frame);
  }
  check(
    escapes.length === 0,
    `${label}: walking straight across escapes capture when setting off at frame(s) ${escapes.slice(0, REPORTED_ESCAPES).join(', ')}`,
  );
}

/** The guard the blocked-gatehouse control posts over the stair up for good. */
const GATEHOUSE_BLOCKING_GUARD: GatehouseGuardId = 'gatehouse-landing';
/** Where it is posted: the tile north of the stair up, looking south over the stair and its landing. */
const GATEHOUSE_BLOCKING_POINT = 'blocking_post';
const ONE_ROW_NORTH = 1;
const GATEHOUSE_BLOCKING_TILE = gatehouseBlockingTile();
/** Its hold, which with the loop's padding keeps it facing south for the whole cycle. */
const GATEHOUSE_BLOCKING_HOLD_FRAMES = 60;

/** The tile row just north of the stair up's north-west tile, read from the gatehouse's own plan. */
function gatehouseBlockingTile(): PrisonTile {
  const { stairUp } = towerStoreyPlan('gatehouse');
  if (stairUp === null) throw new Error('the gatehouse has no stair up to post a guard over');
  return { x: stairUp.x, y: stairUp.y - ONE_ROW_NORTH };
}

/**
 * The gatehouse with its landing guard posted for good where it sees the
 * whole stair-up landing. No route may survive that: a search that still
 * finds one is not reading the guards at all.
 */
function checkGatehouseBlockable(
  conditions: TowerConditions,
  difficulty: Difficulty,
  start: PrisonTile,
  goals: ReadonlyArray<PrisonTile>,
  label: string,
): void {
  const floor = gatehouseStealthFloor(conditions);
  const posted = floor.layout.guards.map((guard) =>
    guard.id === GATEHOUSE_BLOCKING_GUARD
      ? { ...guard, script: `${GATEHOUSE_BLOCKING_POINT} fS p${GATEHOUSE_BLOCKING_HOLD_FRAMES}` }
      : guard,
  );
  check(
    posted.some((guard) => guard.id === GATEHOUSE_BLOCKING_GUARD),
    `${label}: the gatehouse has no ${GATEHOUSE_BLOCKING_GUARD} guard to post`,
  );
  const waypoints = new Map(floor.waypoints);
  waypoints.set(GATEHOUSE_BLOCKING_POINT, GATEHOUSE_BLOCKING_TILE);
  const blocked = compileStealthFloor(
    { ...floor, layout: { ...floor.layout, guards: posted }, waypoints },
    difficulty,
    gatehouseTuningFor(difficulty),
    'eyes',
  );
  const lit = buildLitTables(buildTimeline(blocked));
  const across = solve(
    blocked,
    lit,
    [startState(blocked, lit, start, GATEHOUSE_LINE)],
    goals,
    GATEHOUSE_LINE,
  );
  check(
    !across.found,
    `${label}: with ${GATEHOUSE_BLOCKING_GUARD} posted over the stair up for good, a route was still found`,
  );
}

/** How long a watcher is kept looking: long past any catch the edge of a look builds to. */
const NOTICE_WATCH_SECONDS = 10;
const NOTICE_WATCH_FRAMES = NOTICE_WATCH_SECONDS * WORLD_TICKS_PER_SECOND;
/** A sighting at a look's full weight. */
const FULL_VIEW = 1;

/** Frames of `sighting` held on a guard from no suspicion until it catches, or null within the watch. */
function framesToCatch(tuning: PrisonDifficultyTuning, sighting: Sighting): number | null {
  let value = 0;
  for (let frame = 1; frame <= NOTICE_WATCH_FRAMES; frame++) {
    value = stepSuspicion(value, 'cone', sighting, tuning.suspicion);
    if (value >= SUSPICION_CAPTURE) return frame;
  }
  return null;
}

/**
 * The gatehouse's guards catch at a glance, at every difficulty: the human in
 * full view within {@link CAUGHT_AFTER_SEEN_SECONDS}, never sooner than its
 * last frame; at the edge of a look only an alert builds; a companion in the
 * look puts a guard on orange alert and never further; and on orange, the
 * human seen at all is caught that frame.
 */
function checkGatehouseNotice(difficulty: Difficulty): void {
  const label = `gatehouse ${difficulty}`;
  const tuning = gatehouseTuningFor(difficulty);
  const edge = tuning.suspicion.coneEdgeWeight;
  const inFullView = framesToCatch(tuning, { crawler: FULL_VIEW, companion: 0 });
  check(
    inFullView === CAUGHT_AFTER_SEEN_FRAMES,
    `${label}: the human in a guard's full view is caught on frame ${CAUGHT_AFTER_SEEN_FRAMES} (${CAUGHT_AFTER_SEEN_SECONDS} s), not ${inFullView ?? 'never'}`,
  );
  const atTheEdge = framesToCatch(tuning, { crawler: edge, companion: 0 });
  check(
    atTheEdge !== null && atTheEdge > CAUGHT_AFTER_SEEN_FRAMES,
    `${label}: the human at the edge of a look builds an alert before the catch (${atTheEdge ?? 'never'} frames)`,
  );
  let alert = 0;
  for (let frame = 0; frame < NOTICE_WATCH_FRAMES; frame++) {
    alert = stepSuspicion(alert, 'cone', { crawler: 0, companion: FULL_VIEW }, tuning.suspicion);
  }
  check(
    alert === SUSPICION_ORANGE_ALERT,
    `${label}: a companion in a guard's look raises it to orange alert and no further (${alert})`,
  );
  const glimpsed = stepSuspicion(alert, 'cone', { crawler: edge, companion: 0 }, tuning.suspicion);
  check(
    glimpsed >= SUSPICION_CAPTURE,
    `${label}: on orange alert, the human seen at the very edge of a look is caught that frame`,
  );
}

for (const difficulty of DIFFICULTIES) checkGatehouseNotice(difficulty);

const gatehouseStates = new Map(
  everyTowerConditions(MISSING_CATS_PHASES).map((conditions) => [
    towerStoreyStateKey('gatehouse', conditions),
    conditions,
  ]),
);
for (const conditions of gatehouseStates.values()) {
  const start = gatehouseCellarLanding(conditions);
  const goals = gatehouseStairUpLanding(conditions);
  for (const difficulty of DIFFICULTIES) {
    const label = `gatehouse ${towerConditionsKey(conditions)} ${difficulty}`;
    const watch = compileGatehouseWatch(conditions, difficulty, gatehouseTuningFor(difficulty));
    const compiled = fault === 'empty-prison' ? { ...watch, guards: [] } : watch;
    checkGatehouse(compiled, start, goals, label);
    checkGatehouseBlockable(conditions, difficulty, start, goals, label);
    checkNoise(compiled, label);
  }
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
