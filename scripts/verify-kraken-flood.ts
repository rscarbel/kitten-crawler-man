#!/usr/bin/env tsx
/**
 * The Kraken's flooded pump room keeps its shark and tentacle rules.
 *
 * Headless, over seeded layouts of a room the Kraken's size entered from every
 * side, at several points along the entrance wall, with and without a second
 * doorway, using the real crawler, shark and stun timing (`SHARK_TIMING`) and
 * the runtime's own shark (`stepShark`):
 *
 *   - every pump is mounted on a wall with its raft touching it, close enough
 *     to haul its valve from
 *   - the shark never leaves open water: every loop point is clear of every
 *     raft, pump and wall, and every step of its chases and its swims between
 *     loops runs through open water
 *   - every hop off every float has a departure window on every difficulty
 *   - leaving at the window's centre arrives safely; leaving when the fin is
 *     nearest is caught
 *   - from a float whose tentacle lives, the stun inequality: a crawler whipped
 *     at the window's centre who climbs straight back is safe, and one who
 *     swims on is caught
 *   - a crawler with any of their footing on a float is never taken, though
 *     the shark is right beside them in the water
 *   - one shark, moving between loops: from every hop's landing, the crawler
 *     who waits for the shark to arrive on the new float's loop and leaves at
 *     a window's centre always makes the next hop
 *   - every raft is at least `RAFT_MIN_SIZE_TILES` square and its slam is
 *     dodgeable from anywhere on it, whatever footprint the tentacle picks
 *   - at least one raft's tentacle (and every pump's) rises out of every swing
 *     but inside the weakest Magic Missile's flight, and its slam still reaches
 *     its float
 *   - a killed raft tentacle never rises again
 *   - a pump's valve is hauled from its raft, which touches the pump
 *
 * Window lengths and damage are the owner's to tune and are not checked; the
 * sweep's shares, hop lengths and raft counts are printed for them.
 *
 *   npm run verify:kraken-flood
 *   npm run verify:kraken-flood -- --seeds=3
 *   npm run verify:kraken-flood -- --fault=no-stun            # must fail
 *   npm run verify:kraken-flood -- --fault=crosses-rafts      # must fail
 *   npm run verify:kraken-flood -- --fault=no-transit-wait    # must fail
 *
 * Faults:
 *   - `no-stun` checks the rooms against a whip that holds for no time, so a
 *     whipped crawler can swim straight on: the whip check goes red.
 *   - `crosses-rafts` swims the shark through a room with nothing in it, as if
 *     floats were no obstacle: the open-water check goes red.
 *   - `no-transit-wait` leaves each new float at a window reckoned as if the
 *     shark were already on that float's loop when the crawler landed, rather
 *     than once it has arrived: the one-shark check goes red.
 */

import { BOSS_ROOM_SIZE } from '../src/map/bossRoomSizes.js';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles.js';
import type {
  BossRoomDoorway,
  DoorSide,
  TileRect,
} from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  allPlatforms,
  planFloodedPumpRoom,
  platformShark,
  RAFT_MIN_SIZE_TILES,
  type FloodedPumpRoomLayout,
} from '../src/systems/bossRooms/floodedPumpRoomLayout.js';
import {
  PUMP_WALLS,
  distanceToRect,
  type PlatformId,
  type TileVec,
} from '../src/systems/bossRooms/floodedPumpRoom/platforms.js';
import {
  chooseSlamFootprint,
  isRangedOnlyFromAll,
  nextRaftTentacleState,
  slamSafetyViolation,
  tentacleCentre,
  type RaftTentacleState,
} from '../src/systems/bossRooms/floodedPumpRoom/raftTentacles.js';
import {
  SHARK_TIMING,
  simulateSwim,
  stepShark,
  windowLapShare,
  type SharkDeparture,
  type SharkSea,
  type SharkState,
  type SharkTiming,
} from '../src/systems/bossRooms/floodedPumpRoom/sharkModel.js';
import { WaterMap } from '../src/systems/bossRooms/floodedPumpRoom/waterMap.js';
import { PUMP_REACH_TILES } from '../src/systems/bossRooms/FloodedPumpRoomSystem.js';

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const satisfies readonly Difficulty[];
const SIDES = ['north', 'south', 'east', 'west'] as const satisfies readonly DoorSide[];
/** How far either side of its wall's middle the entrance is also tried, in tiles. */
const ENTRANCE_SHIFT_TILES = 9;
const ENTRANCE_OFFSETS = [-ENTRANCE_SHIFT_TILES, 0, ENTRANCE_SHIFT_TILES] as const;
/** Tiles from the middle of the far wall a second doorway breaks through, when there is one. */
const EXIT_OFFSET = 5;
const DOORWAY_WIDTH_TILES = 3;
const DEFAULT_SEEDS = 2;
/** Spreads each run's seed far from its neighbours'. */
const SEED_STRIDE = 7919;
/** Kills and arrivals the tentacle check plays after the first kill. */
const ARRIVALS_AFTER_KILL = 3;
/** Where the room sits on its floor; any offset will do, so long as it is not the origin. */
const ROOM_ORIGIN = 7;
/** The longest a shark may take to swim to a new float's loop before the check gives up on it. */
const MAX_TRANSIT_FRAMES = 1200;
/** Rounding slack on the open-water test, far under any real crossing. */
const WATER_TOLERANCE_TILES = 1e-6;
const HALF = 0.5;
/** Failure lines printed before the rest are counted. */
const MAX_FAILURE_LINES = 100;
const SHARE_DIGITS = 3;

const FAULTS = ['no-stun', 'crosses-rafts', 'no-transit-wait'] as const;
type Fault = (typeof FAULTS)[number];

function parseFault(): Fault | undefined {
  const flag = process.argv.find((arg) => arg.startsWith('--fault='));
  if (flag === undefined) return undefined;
  const name = flag.slice('--fault='.length);
  const fault = FAULTS.find((candidate) => candidate === name);
  if (fault === undefined) throw new Error(`unknown fault ${name}; known: ${FAULTS.join(', ')}`);
  return fault;
}

function parseSeeds(): number {
  const flag = process.argv.find((arg) => arg.startsWith('--seeds='));
  return flag === undefined ? DEFAULT_SEEDS : Number(flag.slice('--seeds='.length));
}

const FAULT = parseFault();
const SEEDS = parseSeeds();
/** The timing the swims are checked with: the real one, or the fault's. */
const CHECK_TIMING: SharkTiming =
  FAULT === 'no-stun' ? { ...SHARK_TIMING, stunFrames: 0 } : SHARK_TIMING;

let failures = 0;
const failureLines: string[] = [];
const counts = new Map<string, number>();

function check(ok: boolean, rule: string, detail: string): void {
  counts.set(rule, (counts.get(rule) ?? 0) + 1);
  if (ok) return;
  failures++;
  failureLines.push(`  FAIL ${rule}: ${detail}`);
}

const size = BOSS_ROOM_SIZE.kraken;
const bounds: TileRect = { x: ROOM_ORIGIN, y: ROOM_ORIGIN, w: size.w, h: size.h };

/** A doorway `DOORWAY_WIDTH_TILES` wide in the middle of `side`, moved `offset` tiles along it. */
function doorwayOn(side: DoorSide, offset: number): BossRoomDoorway {
  const midX = bounds.x + Math.floor(bounds.w / 2) + offset;
  const midY = bounds.y + Math.floor(bounds.h / 2) + offset;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const half = Math.floor(DOORWAY_WIDTH_TILES / 2);
  const tiles = [];
  for (let step = -half; step <= half; step++) {
    switch (side) {
      case 'north':
        tiles.push({ x: midX + step, y: bounds.y });
        break;
      case 'south':
        tiles.push({ x: midX + step, y: lastY });
        break;
      case 'west':
        tiles.push({ x: bounds.x, y: midY + step });
        break;
      case 'east':
        tiles.push({ x: lastX, y: midY + step });
        break;
    }
  }
  return { side, tile: tiles[half] ?? tiles[0], tiles };
}

function oppositeOf(side: DoorSide): DoorSide {
  switch (side) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}

// ── Sweep numbers ────────────────────────────────────────────────────────────

const sharesByDifficulty: Record<Difficulty, number[]> = { easy: [], normal: [], hard: [] };
const hopLengths = new Map<number, number>();
const raftCounts: number[] = [];
const raftSizes = new Map<string, number>();
const transitFrames: number[] = [];
const layoutMs: number[] = [];

function tally<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * HALF)] ?? 0;
}

// ── Open water ───────────────────────────────────────────────────────────────

/**
 * Whether a fin moving from `from` to `to` in one frame stays in the room's
 * open water: it ends clear of everything by the fin's margin, and its step
 * crosses no raft or pump.
 */
function swimsInWater(water: WaterMap, from: TileVec, to: TileVec): boolean {
  return water.isFree(to, -WATER_TOLERANCE_TILES) && !water.crossesSolid(from, to);
}

function checkNothingDry(layout: FloodedPumpRoomLayout, label: string): void {
  for (const wall of PUMP_WALLS) {
    const mooring = layout.pumps[wall];
    const pumpCentre = tentacleCentre(mooring.pump);
    check(
      distanceToRect(pumpCentre, mooring.rect) <= PUMP_REACH_TILES - HALF,
      "a pump's raft touches the pump",
      `${label} ${mooring.id}`,
    );
    const { x, y } = mooring.pump;
    const atWall =
      x === bounds.x ||
      y === bounds.y ||
      x === bounds.x + bounds.w - 1 ||
      y === bounds.y + bounds.h - 1;
    check(atWall, 'every pump is mounted on a wall', `${label} ${mooring.id} at ${x},${y}`);
  }
}

function checkLoopsInWater(layout: FloodedPumpRoomLayout, label: string): void {
  const { water } = layout.sea;
  for (const platform of allPlatforms(layout)) {
    const { loop } = platformShark(layout, platform.id);
    const count = loop.points.length;
    const strays = loop.points.filter(
      (point, index) => !swimsInWater(water, loop.points[(index + count - 1) % count], point),
    );
    check(
      strays.length === 0,
      'a loop stays in open water',
      `${label} ${platform.id}: ${strays.length} points`,
    );
  }
}

// ── Windows and whips ────────────────────────────────────────────────────────

function checkWindows(layout: FloodedPumpRoomLayout, label: string): void {
  const { sea } = layout;
  for (const departure of layout.departures) {
    const where = `${label} ${departure.from} -> ${departure.to}`;
    tally(hopLengths, departure.swimTiles);
    const shark = platformShark(layout, departure.from);
    const window = shark.windows.find(
      (candidate) =>
        candidate.departure.from === departure.from && candidate.departure.to === departure.to,
    );
    check(window !== undefined, 'every hop has a departure window', where);
    if (window === undefined) continue;
    for (const difficulty of DIFFICULTIES) {
      const share = windowLapShare(shark.patrols[difficulty], window);
      sharesByDifficulty[difficulty].push(share);
      check(
        share > 0,
        'every hop has a departure window on every difficulty',
        `${where} ${difficulty}`,
      );
    }
    const atCentre = shark.loop.points[window.centre];
    const atNearest = shark.loop.points[window.nearest];
    check(
      simulateSwim(sea, departure, atCentre, 'cross', CHECK_TIMING).kind === 'safe',
      'leaving at the window centre arrives',
      where,
    );
    check(
      simulateSwim(sea, departure, atNearest, 'cross', CHECK_TIMING).kind === 'caught',
      'leaving with the fin nearest is caught',
      where,
    );
    if (!departure.fromHoldsTentacle) continue;
    const swimsOn = simulateSwim(sea, departure, atCentre, 'stunned_then_cross', CHECK_TIMING);
    const climbsBack = simulateSwim(
      sea,
      departure,
      atCentre,
      'stunned_then_climb_back',
      CHECK_TIMING,
    );
    check(
      climbsBack.kind === 'safe' && swimsOn.kind === 'caught',
      'stun + step back < shark arrival < stun + swim on',
      `${where}: climbing back ${climbsBack.kind}, swimming on ${swimsOn.kind}`,
    );
  }
}

// ── One shark ────────────────────────────────────────────────────────────────

type SwimEnd =
  | { readonly kind: 'arrived'; readonly shark: SharkState }
  | { readonly kind: 'caught' }
  | { readonly kind: 'left_the_water'; readonly at: TileVec };

/**
 * Plays a straight crossing with the runtime's shark: the crawler wades
 * `departure` from its start, and the shark is stepped exactly as the room
 * steps it, hunting them while they are wet.
 */
function playCrossing(
  sea: SharkSea,
  realWater: WaterMap,
  departure: SharkDeparture,
  start: SharkState,
  difficulty: Difficulty,
): SwimEnd {
  let shark = start;
  let progress = 0;
  const lastFrame = Math.ceil(departure.swimTiles / SHARK_TIMING.wadeTilesPerFrame) + 1;
  for (let frame = 0; frame <= lastFrame; frame++) {
    if (frame > 0) progress += SHARK_TIMING.wadeTilesPerFrame;
    if (progress >= departure.swimTiles) return { kind: 'arrived', shark };
    const prey = {
      x: departure.start.x + departure.heading.x * progress,
      y: departure.start.y + departure.heading.y * progress,
    };
    const next = stepShark(sea, shark, { kind: 'hunt', prey }, difficulty, SHARK_TIMING);
    if (!swimsInWater(realWater, shark.at, next.at)) return { kind: 'left_the_water', at: next.at };
    shark = next;
    if (shark.mode.kind === 'feeding') return { kind: 'caught' };
  }
  return { kind: 'arrived', shark };
}

/** Steps the shark guarding `platform` for `frames` frames, failing if it leaves open water. */
function guardFor(
  sea: SharkSea,
  realWater: WaterMap,
  start: SharkState,
  platform: PlatformId,
  frames: number,
  difficulty: Difficulty,
): SharkState | TileVec {
  let shark = start;
  for (let frame = 0; frame < frames; frame++) {
    const next = stepShark(sea, shark, { kind: 'guard', platform }, difficulty, SHARK_TIMING);
    if (!swimsInWater(realWater, shark.at, next.at)) return next.at;
    shark = next;
  }
  return shark;
}

function isState(value: SharkState | TileVec): value is SharkState {
  return 'mode' in value;
}

/**
 * From every hop's landing: the shark swims to the new float's loop through
 * open water in bounded time, and a crawler who waits until it is patrolling
 * there and leaves at the next window's centre makes every hop off it.
 */
function checkOneShark(layout: FloodedPumpRoomLayout, label: string, difficulty: Difficulty): void {
  const realWater = layout.sea.water;
  const sea: SharkSea =
    FAULT === 'crosses-rafts' ? { ...layout.sea, water: new WaterMap(bounds, []) } : layout.sea;
  for (const departure of layout.departures) {
    const where = `${label} ${difficulty} ${departure.from} -> ${departure.to}`;
    const from = platformShark(layout, departure.from);
    const window = from.windows.find((w) => w.departure.to === departure.to);
    if (window === undefined) continue;
    const patrol = from.patrols[difficulty];
    const start: SharkState = {
      at: from.loop.points[window.centre],
      heading: { x: 1, y: 0 },
      mode: {
        kind: 'patrol',
        platform: departure.from,
        lapFrame: patrol.startFrames[window.centre],
      },
    };
    const crossing = playCrossing(sea, realWater, departure, start, difficulty);
    if (crossing.kind === 'left_the_water') {
      check(
        false,
        'the shark chases through open water',
        `${where} at ${crossing.at.x},${crossing.at.y}`,
      );
      continue;
    }
    check(crossing.kind === 'arrived', 'a window departure arrives against the one shark', where);
    if (crossing.kind !== 'arrived') continue;

    const onward = platformShark(layout, departure.to);
    const onwardPatrol = onward.patrols[difficulty];
    let shark = crossing.shark;
    let transit = 0;
    while (!(shark.mode.kind === 'patrol' && shark.mode.platform === departure.to)) {
      if (transit >= MAX_TRANSIT_FRAMES) break;
      const next = guardFor(sea, realWater, shark, departure.to, 1, difficulty);
      if (!isState(next)) {
        check(
          false,
          'the shark swims between loops through open water',
          `${where} at ${next.x},${next.y}`,
        );
        return;
      }
      shark = next;
      transit++;
    }
    check(
      transit < MAX_TRANSIT_FRAMES,
      'the shark reaches the new float’s loop',
      `${where}: ${transit} frames`,
    );
    transitFrames.push(transit);
    const joinFrame = shark.mode.kind === 'patrol' ? shark.mode.lapFrame : 0;

    for (const next of onward.windows) {
      const leg = `${where} then -> ${next.departure.to}`;
      const centreFrame = onwardPatrol.startFrames[next.centre];
      const lap = onwardPatrol.lapFrames;
      const untilCentre = (((centreFrame - joinFrame) % lap) + lap) % lap;
      const sinceLanding = FAULT === 'no-transit-wait' ? untilCentre : transit + untilCentre;
      const waited = guardFor(
        sea,
        realWater,
        crossing.shark,
        departure.to,
        Math.round(sinceLanding),
        difficulty,
      );
      if (!isState(waited)) {
        check(false, 'the shark patrols through open water', `${leg} at ${waited.x},${waited.y}`);
        continue;
      }
      const onwardCrossing = playCrossing(sea, realWater, next.departure, waited, difficulty);
      check(
        onwardCrossing.kind === 'arrived',
        'after the shark arrives on the new float’s loop, its next window is safe',
        `${leg}: ${onwardCrossing.kind}`,
      );
    }
  }
}

/**
 * With the shark in the water right beside them, a crawler whose footing has
 * just reached the far float, or is still on the near one, is not taken.
 */
function checkFootingIsSafe(layout: FloodedPumpRoomLayout, label: string): void {
  const { water } = layout.sea;
  const footing = SHARK_TIMING.footingHalfTiles;
  const nudge = SHARK_TIMING.wadeTilesPerFrame * HALF;
  for (const departure of layout.departures) {
    const where = `${label} ${departure.from} -> ${departure.to}`;
    for (const progress of [footing - nudge, departure.swimTiles - footing + nudge]) {
      const prey = {
        x: departure.start.x + departure.heading.x * progress,
        y: departure.start.y + departure.heading.y * progress,
      };
      const beside = water.nearestFree(prey);
      const shark: SharkState = { at: beside, heading: { x: 1, y: 0 }, mode: { kind: 'chasing' } };
      const after = stepShark(layout.sea, shark, { kind: 'hunt', prey }, 'normal', SHARK_TIMING);
      check(
        after.mode.kind !== 'feeding',
        'a crawler with footing on a float is never taken',
        `${where} at ${progress.toFixed(2)} tiles`,
      );
    }
  }
}

// ── Floats and tentacles ─────────────────────────────────────────────────────

function checkPlatforms(layout: FloodedPumpRoomLayout, label: string): void {
  raftCounts.push(layout.rafts.length);
  for (const raft of layout.rafts) {
    const where = `${label} ${raft.id}`;
    tally(raftSizes, `${raft.rect.w}x${raft.rect.h}`);
    check(
      raft.rect.w >= RAFT_MIN_SIZE_TILES && raft.rect.h >= RAFT_MIN_SIZE_TILES,
      'every raft is at least the minimum size',
      `${where} is ${raft.rect.w} x ${raft.rect.h}`,
    );
    const violation = slamSafetyViolation(raft.rect, []);
    check(violation === null, 'every slam on a raft is dodgeable', `${where}: ${violation ?? ''}`);
  }
  for (const wall of PUMP_WALLS) {
    const mooring = layout.pumps[wall];
    const violation = slamSafetyViolation(mooring.rect, []);
    check(
      violation === null,
      "every slam on a pump's raft is dodgeable",
      `${label} ${mooring.id}: ${violation ?? ''}`,
    );
  }

  const rects = allPlatforms(layout).map((platform) => platform.rect);
  const rangedRafts = layout.rafts.filter((raft) => raft.tentacleReach === 'ranged_only');
  check(rangedRafts.length > 0, 'a raft has a ranged-only tentacle', label);
  const rangedSpots = [
    ...rangedRafts.map((raft) => ({ id: raft.id, rect: raft.rect, tile: raft.tentacle })),
    ...PUMP_WALLS.map((wall) => ({
      id: layout.pumps[wall].id,
      rect: layout.pumps[wall].rect,
      tile: layout.pumps[wall].pumpTentacle,
    })),
  ];
  for (const spot of rangedSpots) {
    const where = `${label} ${spot.id} at ${spot.tile.x},${spot.tile.y}`;
    check(
      isRangedOnlyFromAll(spot.tile, rects),
      'a ranged-only tentacle is out of every swing and inside the first missile',
      where,
    );
    const centre = tentacleCentre(spot.tile);
    const nearestTile = {
      x: Math.min(spot.rect.x + spot.rect.w - 1, Math.max(spot.rect.x, Math.floor(centre.x))),
      y: Math.min(spot.rect.y + spot.rect.h - 1, Math.max(spot.rect.y, Math.floor(centre.y))),
    };
    check(
      chooseSlamFootprint(spot.rect, centre, nearestTile) !== null,
      "a ranged-only tentacle's slam reaches its float",
      where,
    );
  }
}

function checkTentacleLife(): void {
  let state: RaftTentacleState = 'dormant';
  state = nextRaftTentacleState(state, 'crawler_arrived');
  check(state === 'risen', 'a raft tentacle rises when the crawler first arrives', state);
  state = nextRaftTentacleState(state, 'killed');
  for (let arrival = 0; arrival < ARRIVALS_AFTER_KILL; arrival++) {
    state = nextRaftTentacleState(state, 'crawler_arrived');
    check(state === 'killed', 'a killed raft tentacle never rises again', state);
  }
}

// ── The sweep ────────────────────────────────────────────────────────────────

console.log(`verify:kraken-flood${FAULT === undefined ? '' : ` --fault=${FAULT}`}`);
let rooms = 0;
let retried = 0;
for (const side of SIDES) {
  for (const offset of ENTRANCE_OFFSETS) {
    for (const withExit of [false, true]) {
      for (let seedIndex = 1; seedIndex <= SEEDS; seedIndex++) {
        const entrance = doorwayOn(side, offset);
        const doorways = withExit
          ? [entrance, doorwayOn(oppositeOf(side), EXIT_OFFSET)]
          : [entrance];
        const seed = seedIndex * SEED_STRIDE + offset;
        const label = `${side}${offset >= 0 ? '+' : ''}${offset}${withExit ? ' with exit' : ''} seed ${seed}`;
        let layout: FloodedPumpRoomLayout;
        const started = performance.now();
        try {
          layout = planFloodedPumpRoom(bounds, entrance, doorways, seed);
        } catch (error) {
          check(false, 'every room lays out', `${label}: ${String(error)}`);
          continue;
        }
        layoutMs.push(performance.now() - started);
        const difficulty = DIFFICULTIES[rooms % DIFFICULTIES.length];
        rooms++;
        if (layout.layoutSeed !== seed) retried++;
        checkNothingDry(layout, label);
        checkLoopsInWater(layout, label);
        checkWindows(layout, label);
        checkOneShark(layout, label, difficulty);
        checkFootingIsSafe(layout, label);
        checkPlatforms(layout, label);
      }
    }
  }
}
checkTentacleLife();

const shareLine = DIFFICULTIES.map((difficulty) => {
  const shares = sharesByDifficulty[difficulty];
  return `${difficulty} min ${Math.min(...shares).toFixed(SHARE_DIGITS)} median ${median(shares).toFixed(SHARE_DIGITS)}`;
}).join(', ');
const lengths = [...hopLengths].sort((a, b) => a[0] - b[0]).map(([tiles, n]) => `${tiles}:${n}`);
const sizes = [...raftSizes].map(([dims, n]) => `${dims}:${n}`);
console.log(`  window shares of a lap: ${shareLine}`);
console.log(`  hop lengths (tiles:count): ${lengths.join(' ')}`);
console.log(
  `  rafts per room: min ${Math.min(...raftCounts)} median ${median(raftCounts)} max ${Math.max(...raftCounts)}; sizes ${sizes.join(' ')}`,
);
console.log(
  `  transit to a new loop: median ${median(transitFrames)} max ${Math.max(...transitFrames)} frames; layout median ${median(layoutMs).toFixed(0)} max ${Math.max(...layoutMs).toFixed(0)} ms`,
);
for (const [rule, count] of counts) console.log(`  ${count} x ${rule}`);
const shown = failureLines.slice(0, MAX_FAILURE_LINES);
for (const line of shown) console.log(line);
if (failureLines.length > shown.length)
  console.log(`  … ${failureLines.length - shown.length} more`);
console.log(`${rooms} rooms (${retried} laid out from a later seed)`);
console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
