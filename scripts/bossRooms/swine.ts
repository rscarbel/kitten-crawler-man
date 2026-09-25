/**
 * Ball of Swine's Iron Colosseum on floor 2: its dressing, the arena systems
 * that still draw its pickups, the states it can be driven into, and its own
 * gates.
 */

import {
  ARENA_INTERIOR_RADIUS_TILES,
  ARENA_DOOR_COLUMN_OFFSETS,
} from '../../src/map/arenaGeometry.js';
import { ArenaRoomSystem } from '../../src/systems/ArenaRoomSystem.js';
import { TILE_SIZE } from '../../src/core/constants.js';
import { buildColosseumDressing } from '../../src/systems/bossRooms/BossRoomDressings.js';
import {
  BLOOD_DECAL_MAX,
  COLOSSEUM_MUD_WALLOWS,
  MUD_SPLATTER_MAX,
  type ColosseumDressingSystem,
} from '../../src/systems/bossRooms/ColosseumDressingSystem.js';
import { approachLaneTiles, spawnClearTiles } from '../../src/systems/bossRooms/bossRoomLayout.js';
import {
  FIGHT_SEEDS,
  checkConcourseConnectivity,
  checkPaintAgreement,
  checkRewinds,
  checkRimPaintAgreement,
  measureFights,
  minutesOf,
  reportConcourse,
  reportConcourseConnectivity,
  reportMud,
  reportPaint,
  reportRim,
  reportRimPaintAgreement,
  rollThroughMud,
  simulateConcourseWalks,
  simulateMudEscapes,
  simulateRimSlide,
  simulateTusklingCharges,
  type FightSummary,
} from './swineGates.js';
import {
  DEFAULT_MIN_OPEN_FLOOR_SHARE,
  defaultInvariantTiles,
  dressingUnderTest,
  firstOf,
  rectTiles,
  type BossRoomHarness,
  type BossRoomState,
  type GateReport,
  type RoomEnvironment,
} from './harness.js';

/** The ring's states: before the fight, sealed, mid-fight with cages burst, and won. */
const SWINE_ROOM_STATES: readonly BossRoomState[] = ['pre', 'sealed', 'enraged', 'defeated'];

export const swineRoom: BossRoomHarness = {
  id: 'swine',
  floor: 2,
  assetGroup: 'boss_colosseum',
  states: SWINE_ROOM_STATES,
  heaviestState: 'enraged',
  // The generator always cuts the colosseum's door in its south wall.
  doorSides: ['south'],
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap) => {
    const arena = firstOf(gameMap.arenaExteriors);
    if (arena === undefined) return null;
    const { centre } = arena;
    const radius = ARENA_INTERIOR_RADIUS_TILES;
    const bounds = {
      x: centre.x - radius,
      y: centre.y - radius,
      w: radius * 2 + 1,
      h: radius * 2 + 1,
    };
    // The same test the generator carves the ring floor with.
    const interior = rectTiles(bounds).filter(
      (tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) <= radius,
    );
    // The doorway as the ring's floor meets it: the door's columns on the
    // interior's southmost row, where the disc's edge leaves only the centre
    // column open.
    const doorRow = centre.y + radius;
    const doorTiles = ARENA_DOOR_COLUMN_OFFSETS.map((dx) => ({
      x: centre.x + dx,
      y: doorRow,
    })).filter((tile) => gameMap.isWalkable(tile.x, tile.y));
    return {
      bounds,
      spawn: centre,
      doorways: [{ side: 'south', tile: { x: centre.x, y: doorRow }, tiles: doorTiles }],
      doorSide: 'south',
      interior,
    };
  },
  // A disc narrows to a single tile at the doorway, so a lane as wide as the
  // shared rule asks cannot start on the edge row. It starts one row in, where
  // the ring is wide enough, and the doorway tile itself must stay open too.
  invariantTiles: (room) => {
    const doorway = firstOf(room.doorways);
    if (doorway === undefined) return defaultInvariantTiles(room);
    const inward = doorway.tiles.map((tile) => ({ x: tile.x, y: tile.y - 1 }));
    const innerDoorway = {
      ...doorway,
      tile: { x: doorway.tile.x, y: doorway.tile.y - 1 },
      tiles: inward,
    };
    return {
      approach: [...doorway.tiles, ...approachLaneTiles(innerDoorway, room.bounds)],
      spawnDisc: spawnClearTiles(room.spawn),
    };
  },
  build: (env) => {
    const arena = firstOf(env.gameMap.arenaExteriors);
    if (arena === undefined) throw new Error('the colosseum vanished between locate and build');
    const pickups = new ArenaRoomSystem(arena);
    const colosseum = buildColosseumDressing(env.gameMap);
    if (colosseum === null) throw new Error('the colosseum built no dressing');
    return dressingUnderTest(colosseum, env, {
      renderGround: (ctx, camX, camY) => pickups.render(ctx, camX, camY),
      driveToState: (state) => driveColosseum(colosseum, env, state),
    });
  },
  gates: ({ env, report }) => {
    reportPaint(report, checkPaintAgreement(env.gameMap));
    for (const failure of checkRewinds(env)) report.fail(failure);
    // The simulations are the same on every floor — the ring is one building —
    // so they run once, on the first floor the sweep reaches.
    if (simulationsRun) return;
    simulationsRun = true;
    reportRim(report, simulateRimSlide(env.gameMap), simulateTusklingCharges(env.gameMap));
    reportConcourse(report, simulateConcourseWalks(env.gameMap));
    reportConcourseConnectivity(report, checkConcourseConnectivity(env.gameMap));
    reportRimPaintAgreement(report, checkRimPaintAgreement(env.gameMap));
    reportMud(report, simulateMudEscapes(env.gameMap));
    const roll = rollThroughMud(env.gameMap);
    report.note(
      `the ball rolls ${roll.onMud.toFixed(1)}px through mud, ${roll.onSand.toFixed(1)}px over sand`,
    );
    if (roll.onSand <= 0 || roll.onMud < roll.onSand) {
      report.fail('the ball rolls slower through mud than over sand');
    }
    reportFight(report, measureFights());
  },
};

let simulationsRun = false;

// ── Baseline ────────────────────────────────────────────────────────────────

/**
 * The fight as measured on the room before its dressing did anything — no
 * mud, no cages, no curved wall — by `measureFights` over `FIGHT_SEEDS`, on
 * normal difficulty, against the level-12 reference crawler. Averages per run.
 *
 * A change may move any of these toward harder freely. Toward easier by more
 * than `EASIER_TOLERANCE` fails, and the numbers are re-measured, never simply
 * relaxed, when one does.
 */
/** Frames from the crawler stepping in to the ball's death. Shorter is easier. */
const BASELINE_KILL_FRAMES = 18337;
/** Blows that landed on the crawler over the fight. Fewer is easier. */
const BASELINE_HITS_ON_CRAWLER = 99.9;
/** Health the crawler lost over the fight, in multiples of its maximum. Less is easier. */
const BASELINE_DAMAGE_SHARE = 27.84;
/** Tusklings loosed while the ball lived. Fewer is easier. */
const BASELINE_TUSKLINGS = 13.1;
/**
 * Wall slams in five minutes of a crawler who only dodges. Slams are the only
 * way the ball loses momentum, so fewer would be harder, not easier; this is a
 * check that the wall still works, and it allows the run-to-run spread of a
 * crawler whose path the mud changes.
 */
const BASELINE_SLAMS_PER_FIVE_MINUTES = 39.8;
const SLAM_RATE_SPREAD = 0.05;
/** Frames the ball spent rolling and not moving, over every run. More is easier. */
const BASELINE_BALL_STUCK_FRAMES = 0;
/** The furthest any fight metric may move toward easier. */
const EASIER_TOLERANCE = 0.1;
/** Every fight must still end in a kill: a run that times out measured nothing. */
const REQUIRED_KILLS = FIGHT_SEEDS.length;

function reportFight(report: GateReport, fight: FightSummary): void {
  report.note(
    `fight: kill ${minutesOf(fight.killFrames)} min (baseline ${minutesOf(BASELINE_KILL_FRAMES)}), ` +
      `${fight.hitsOnCrawler.toFixed(1)} hits (${BASELINE_HITS_ON_CRAWLER}), ` +
      `${fight.damageShare.toFixed(2)}× health lost (${BASELINE_DAMAGE_SHARE}), ` +
      `${fight.tusklingsSpawned.toFixed(1)} Tusklings (${BASELINE_TUSKLINGS}), ` +
      `${fight.slamsPerFiveMinutes.toFixed(1)} slams / 5 min (${BASELINE_SLAMS_PER_FIVE_MINUTES}), ` +
      `${fight.ballStuckFrames} stuck frames, ${fight.cagesReleased} cages burst`,
  );
  const atLeast = (value: number, baseline: number, what: string): void => {
    if (value < baseline * (1 - EASIER_TOLERANCE)) {
      report.fail(`${what} fell to ${value.toFixed(2)} from a baseline of ${baseline}`);
    }
  };
  atLeast(fight.killFrames, BASELINE_KILL_FRAMES, 'time to kill');
  atLeast(fight.hitsOnCrawler, BASELINE_HITS_ON_CRAWLER, 'hits on the crawler');
  atLeast(fight.damageShare, BASELINE_DAMAGE_SHARE, 'health the crawler lost');
  atLeast(fight.tusklingsSpawned, BASELINE_TUSKLINGS, 'Tusklings loosed');
  if (fight.slamsPerFiveMinutes < BASELINE_SLAMS_PER_FIVE_MINUTES * (1 - SLAM_RATE_SPREAD)) {
    report.fail(
      `the ball slams ${fight.slamsPerFiveMinutes.toFixed(1)} times in five minutes, ` +
        `baseline ${BASELINE_SLAMS_PER_FIVE_MINUTES}`,
    );
  }
  if (fight.ballStuckFrames > BASELINE_BALL_STUCK_FRAMES) {
    report.fail(
      `the ball spent ${fight.ballStuckFrames} frames stuck (baseline ${BASELINE_BALL_STUCK_FRAMES})`,
    );
  }
  if (fight.killed < REQUIRED_KILLS) {
    report.fail(`only ${fight.killed} of ${fight.runs} fights ended in a kill`);
  }
  if (fight.cagesReleased === 0) report.fail('no slam ever burst a cage');
  for (const fault of fight.cageFaults) report.fail(fault);
}

/** Frames run after a state is set, so the portcullis finishes its drop and the crowd is mid-wave. */
const SETTLE_FRAMES = 36;
/** The cages a mid-fight picture shows burst, by index in bearing order. */
const REVIEW_OPEN_CAGE_COUNT = 3;
const REVIEW_OPEN_CAGE_STRIDE = 4;
const REVIEW_OPEN_CAGES: readonly number[] = Array.from(
  { length: REVIEW_OPEN_CAGE_COUNT },
  (_, index) => index * REVIEW_OPEN_CAGE_STRIDE + 1,
);
/**
 * Mud thrown and blood shed in a mid-fight picture, as many as the room ever
 * keeps, so the heaviest state is measured at its heaviest: mud in a ring
 * round each wallow, blood strewn across the middle of the sand.
 */
const REVIEW_SPLATTER_RING_TILES = 2.2;
const REVIEW_BLOOD_RING_TILES = 6;
const REVIEW_SPLATTER: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: MUD_SPLATTER_MAX },
  (_, index) => {
    const patch = COLOSSEUM_MUD_WALLOWS[index % COLOSSEUM_MUD_WALLOWS.length];
    const middleX = patch.reduce((sum, tile) => sum + tile.x, 0) / patch.length;
    const middleY = patch.reduce((sum, tile) => sum + tile.y, 0) / patch.length;
    const turn = (index / MUD_SPLATTER_MAX) * Math.PI * 2 * COLOSSEUM_MUD_WALLOWS.length;
    return [
      middleX + Math.cos(turn) * REVIEW_SPLATTER_RING_TILES,
      middleY + Math.sin(turn) * REVIEW_SPLATTER_RING_TILES,
    ] as const;
  },
);
const REVIEW_BLOOD: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: BLOOD_DECAL_MAX },
  (_, index) => {
    const turn = (index / BLOOD_DECAL_MAX) * Math.PI * 2;
    return [
      Math.cos(turn) * REVIEW_BLOOD_RING_TILES,
      Math.sin(turn) * REVIEW_BLOOD_RING_TILES,
    ] as const;
  },
);
const REVIEW_DECAL_LIFE = 2000;

function driveColosseum(
  colosseum: ColosseumDressingSystem,
  env: RoomEnvironment,
  state: BossRoomState,
): boolean | undefined {
  const centre = env.room.spawn;
  const toWorld = ([x, y]: readonly [number, number], variant: number) => ({
    x: (centre.x + x) * TILE_SIZE + TILE_SIZE / 2,
    y: (centre.y + y) * TILE_SIZE + TILE_SIZE / 2,
    variant,
    life: REVIEW_DECAL_LIFE,
  });
  const settle = (): void => {
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) colosseum.update(env.frame);
  };
  switch (state) {
    case 'pre':
      return true;
    case 'sealed':
      env.gameMap.lockArenaDoor();
      colosseum.onSeal();
      settle();
      return true;
    case 'enraged':
      colosseum.restoreCheckpoint({
        openCages: REVIEW_OPEN_CAGES,
        portcullisDown: true,
        mudSplatter: REVIEW_SPLATTER.map((at, index) => toWorld(at, index)),
        bloodDecals: REVIEW_BLOOD.map((at, index) => toWorld(at, index)),
      });
      env.gameMap.lockArenaDoor();
      colosseum.onSeal();
      settle();
      return true;
    case 'defeated':
      env.gameMap.lockArenaDoor();
      colosseum.onSeal();
      settle();
      env.gameMap.unlockArenaDoor();
      colosseum.onBossDefeated();
      // Twice, as the scene's replay after a build or a load delivers it.
      colosseum.onBossDefeated();
      settle();
      return true;
    case 'phase2':
    case 'phase3':
      return false;
  }
}
