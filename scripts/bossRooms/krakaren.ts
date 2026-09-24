/**
 * Krakaren Clone's lair on floor 2: its dressing system, the states it can be
 * driven into, and its own gates.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { KrakarenClone } from '../../src/creatures/KrakarenClone.js';
import { KRAKAREN_WADE } from '../../src/map/tileTypes.js';
import { KRAKAREN_BOSS_TYPE } from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { KrakarenRoomSystem } from '../../src/systems/bossRooms/KrakarenRoomSystem.js';
import {
  CAUSEWAY_HALF_WIDTH_TILES,
  MIN_LAB_VATS,
  krakarenLabAt,
  labNeighbours,
  labTileKey,
  type KrakarenLabLayout,
} from '../../src/systems/bossRooms/krakarenLabLayout.js';
import type { TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import type { FrameEdge } from '../../src/sprites/sheets/propSheetPlan.js';
import {
  DEFAULT_MIN_OPEN_FLOOR_SHARE,
  DOOR_SIDES,
  dressingUnderTest,
  gameGauntletDressings,
  gauntletBossRoom,
  type BossRoomHarness,
  type RoomEnvironment,
  type RoomGateContext,
} from './harness.js';

/**
 * Frames the review harness runs the enraged room for before drawing it: long
 * enough that the first vats have burst and the next are cracking, and that the
 * first live puddle is mid-arc.
 */
const ENRAGED_REVIEW_FRAMES = 250;

const MAX_LAB_VATS = 8;
const MIN_LAB_CONSOLES = 2;
const MAX_LAB_CONSOLES = 3;
const LIVE_PUDDLES = 2;
/** Her lash reaches three tiles; a causeway must deliver a crawler inside that. */
const MELEE_RING_TILES = 3;
/** Live puddles sit in the room's outer third: at least this share of the way from her to the far corner. */
const OUTER_THIRD_SHARE = 0.67;
/** The causeways a crawler can choose between. */
const CAUSEWAYS_REQUIRED = 3;

/** Adds her to the floor's roster, enraged, so the room runs its fight as it would with her in it. */
function stageEnragedBoss(env: RoomEnvironment): KrakarenClone {
  const boss = new KrakarenClone(env.room.spawn.x, env.room.spawn.y, TILE_SIZE);
  boss.isEnraged = true;
  env.frame.roster.add(boss);
  return boss;
}

function krakarenRoomOf(env: RoomEnvironment): KrakarenRoomSystem {
  const { krakaren } = gameGauntletDressings(env);
  if (krakaren === null) throw new Error('the krakaren room vanished between locate and build');
  return krakaren;
}

export const krakarenRoom: BossRoomHarness = {
  id: 'krakaren',
  floor: 2,
  assetGroup: 'boss_krakaren',
  // Vats, consoles and junction boxes stand on the floor of their tile.
  sheetGroundedEdges: new Set<FrameEdge>(['bottom']),
  states: ['pre', 'sealed', 'enraged', 'defeated'],
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, KRAKAREN_BOSS_TYPE),
  build: (env) => {
    const room = krakarenRoomOf(env);
    return dressingUnderTest(room, env, {
      driveToState: (state) => {
        if (state !== 'enraged') return undefined;
        stageEnragedBoss(env);
        room.onSeal();
        room.beginRupture();
        for (let frame = 0; frame < ENRAGED_REVIEW_FRAMES; frame++) room.update(env.frame);
        return true;
      },
    });
  },
  gates: (context) => gateLabLayout(context),
};

/** The lab's own layout rules, on every generated floor of the sweep. */
function gateLabLayout({ env, report }: RoomGateContext): void {
  const lab = krakarenLabAt(env.gameMap.structure, env.room.spawn.x, env.room.spawn.y);
  if (lab === null) {
    report.fail('no clone lab laid out over the room');
    return;
  }
  const { room } = env;
  if (lab.centre.x !== room.spawn.x || lab.centre.y !== room.spawn.y) {
    report.fail(
      `vat bed centred on ${lab.centre.x},${lab.centre.y}, she spawns on ${room.spawn.x},${room.spawn.y}`,
    );
  }
  if (lab.vats.length < MIN_LAB_VATS || lab.vats.length > MAX_LAB_VATS) {
    report.fail(`${lab.vats.length} vats (want ${MIN_LAB_VATS}–${MAX_LAB_VATS})`);
  }
  if (lab.consoles.length < MIN_LAB_CONSOLES || lab.consoles.length > MAX_LAB_CONSOLES) {
    report.fail(`${lab.consoles.length} consoles (want ${MIN_LAB_CONSOLES}–${MAX_LAB_CONSOLES})`);
  }
  if (lab.livePuddles.length !== LIVE_PUDDLES) {
    report.fail(`${lab.livePuddles.length} live puddles (want ${LIVE_PUDDLES})`);
  }
  report.note(
    `${lab.vats.length} vats, ${lab.consoles.length} consoles, ${lab.drains.length} drains`,
  );

  // Outer third of the room: two thirds or more of the way from her to a wall,
  // on either axis, since a room is wider than it is deep.
  const halfW = room.bounds.w / 2;
  const halfH = room.bounds.h / 2;
  for (const puddle of lab.livePuddles) {
    const reach = Math.max(
      ...puddle.tiles.map((t) =>
        Math.max(Math.abs(t.x - lab.centre.x) / halfW, Math.abs(t.y - lab.centre.y) / halfH),
      ),
    );
    if (reach < OUTER_THIRD_SHARE) {
      report.fail(`live puddle only ${(reach * PERCENT).toFixed(0)}% of the way to the wall`);
    }
  }

  // Standing water and every tile a burst can flood stay off the doorway approaches.
  const flooding = [...lab.wade, ...lab.vats.flatMap((v) => v.floods)];
  const wetApproach = flooding.filter((t) => lab.approach.has(labTileKey(t.x, t.y)));
  if (wetApproach.length > 0) {
    report.fail(
      `flood water on a doorway approach at ${wetApproach.map((t) => `${t.x},${t.y}`).join(' ')}`,
    );
  }
  // A stamped wade tile that did not take is a band the player never sees.
  const unstamped = lab.wade.filter((t) => env.gameMap.structure[t.y][t.x].type !== KRAKAREN_WADE);
  if (unstamped.length > 0) report.fail(`${unstamped.length} wade tiles were never stamped`);

  gateCauseways(lab, env, report);
}

const PERCENT = 100;

/**
 * Three dry routes cross the flood band, each at least two tiles wide, and at
 * least one joins a doorway to her melee ring without a single wet step.
 */
function gateCauseways(
  lab: KrakarenLabLayout,
  env: RoomEnvironment,
  report: RoomGateContext['report'],
): void {
  const { gameMap } = env;
  const inRoom = (t: TilePoint): boolean =>
    t.x >= lab.bounds.x &&
    t.y >= lab.bounds.y &&
    t.x < lab.bounds.x + lab.bounds.w &&
    t.y < lab.bounds.y + lab.bounds.h;
  const dryWalkable = (t: TilePoint): boolean =>
    inRoom(t) && gameMap.isWalkable(t.x, t.y) && gameMap.structure[t.y][t.x].type !== KRAKAREN_WADE;
  const inMeleeRing = (t: TilePoint): boolean =>
    Math.hypot(t.x - lab.centre.x, t.y - lab.centre.y) <= MELEE_RING_TILES;

  // Dry reach from every doorway.
  const reached = new Set<number>();
  const queue: TilePoint[] = [];
  for (const doorway of lab.doorways) {
    for (const t of doorway.tiles) {
      if (!dryWalkable(t)) continue;
      reached.add(labTileKey(t.x, t.y));
      queue.push(t);
    }
  }
  // A queue that grows while it is walked: `for...of` over an array visits
  // entries pushed during the walk, which is exactly a breadth-first search.
  for (const next of queue) {
    for (const n of labNeighbours(next)) {
      const key = labTileKey(n.x, n.y);
      if (reached.has(key) || !dryWalkable(n)) continue;
      reached.add(key);
      queue.push(n);
    }
  }
  let ringReached = false;
  for (let y = lab.bounds.y; y < lab.bounds.y + lab.bounds.h; y++) {
    for (let x = lab.bounds.x; x < lab.bounds.x + lab.bounds.w; x++) {
      if (inMeleeRing({ x, y }) && reached.has(labTileKey(x, y))) ringReached = true;
    }
  }
  if (!ringReached) report.fail('no dry causeway joins a doorway to her melee ring');

  // Count the dry gaps round the band: walk a ring through the band's middle
  // and count runs of dry tiles at least two wide.
  const radius = WADE_MID_RADIUS_TILES;
  const samples = CAUSEWAY_RING_SAMPLES;
  const dryAt: boolean[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const t = {
      x: Math.round(lab.centre.x + Math.cos(a) * radius),
      y: Math.round(lab.centre.y + Math.sin(a) * radius),
    };
    dryAt.push(dryWalkable(t));
  }
  const runs = dryRuns(dryAt, radius);
  const wide = runs.filter(
    (lengthTiles) => lengthTiles >= CAUSEWAY_HALF_WIDTH_TILES * 2 - CAUSEWAY_WIDTH_SLACK,
  );
  if (wide.length < CAUSEWAYS_REQUIRED) {
    report.fail(`${wide.length} dry causeways across the band (want ${CAUSEWAYS_REQUIRED})`);
  }
}

/** The middle of the flood band, where the causeways are counted. */
const WADE_MID_RADIUS_TILES = 4.75;
const CAUSEWAY_RING_SAMPLES = 180;
/** Sampling a lattice on a circle loses up to half a tile at each end of a run. */
const CAUSEWAY_WIDTH_SLACK = 0.5;

/** Lengths, in tiles of arc, of every run of dry samples round the ring. */
function dryRuns(dryAt: readonly boolean[], radius: number): number[] {
  const n = dryAt.length;
  const firstWet = dryAt.indexOf(false);
  if (firstWet < 0) return [2 * Math.PI * radius];
  const runs: number[] = [];
  let run = 0;
  for (let step = 1; step <= n; step++) {
    const i = (firstWet + step) % n;
    if (dryAt[i]) {
      run++;
      continue;
    }
    if (run > 0) runs.push((run / n) * 2 * Math.PI * radius);
    run = 0;
  }
  return runs;
}
