/**
 * The spider lab's own gates, run on every generated floor of the boss-room
 * sweep:
 *
 * - the hack path: the scientist can walk to the terminal, and the doorway to him;
 * - webbing: never within six tiles of the doorway, never on the egg's nest,
 *   and every tile the room data lists really is web on the map;
 * - furniture: benches in the entrance half, shelving against the side walls,
 *   four to six cocoons in the far half;
 * - the darkness masks fit their memory budget;
 * - cocoons never push the brood past its cap;
 * - a death's checkpoint, an abort and a repeated win all put the webs, the
 *   cocoons, the lights and the broken benches back exactly, and the checkpoint
 *   survives a save.
 *
 * `--spider-fault=cocoon-cap|abort|hack-path` breaks one guarded thing so its
 * gate can be seen to fail.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { GrotesqueSpider } from '../../src/creatures/GrotesqueSpider.js';
import { EGG_HATCH_FRAMES } from '../../src/creatures/SpiderEgg.js';
import { GameMap } from '../../src/map/GameMap.js';
import { doorFrame } from '../../src/map/spiderLabLayout.js';
import { LAB_SHELF, LAB_WEB } from '../../src/map/tileTypes.js';
import {
  MAX_LAB_PARTICLES,
  SpiderLabDressing,
  type SpiderLabQuestView,
} from '../../src/systems/bossRooms/SpiderLabDressing.js';
import { parseSpiderLabDressingCheckpoint } from '../../src/systems/bossRooms/spiderLabCheckpoint.js';
import { darknessMaskBytes } from '../../src/systems/bossRooms/spiderLabLighting.js';
import type { DressingRenderable } from '../../src/systems/bossRooms/BossRoomDressing.js';
import type { RoomGateContext } from './harness.js';

const FAULTS = ['cocoon-cap', 'abort', 'hack-path'] as const;
type SpiderFault = (typeof FAULTS)[number];
const FAULT_PREFIX = '--spider-fault=';
const faultArg = process.argv
  .find((arg) => arg.startsWith(FAULT_PREFIX))
  ?.slice(FAULT_PREFIX.length);
const fault: SpiderFault | undefined = FAULTS.find((name) => name === faultArg);
if (faultArg !== undefined && fault === undefined) {
  throw new Error(`--spider-fault must be one of ${FAULTS.join(', ')}`);
}

/** The brood cap, and how full the gate starts it, so a single loose hatchling would overflow it. */
const TEST_BROOD_CAP = 10;
const TEST_BROOD_ALREADY_LIVE = TEST_BROOD_CAP - 1;
const MIN_COCOONS = 4;
const MAX_COCOONS = 6;
const WEB_DOORWAY_CLEARANCE_TILES = 6;
const BYTES_PER_KILOBYTE = 1024;
const MASK_BUDGET_BYTES = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** Both darkened phases are held at once, so both count against the budget. */
const MASKS_HELD = 2;
/** The terminal can be worked from any open tile touching its bench. */
const TERMINAL_REACH_TILES = 1;
const PHASE_THREE_HP_SHARE = 0.2;
const LAST_PHASE = 3;
const HALF = 0.5;

const tileKey = (x: number, y: number): string => `${x},${y}`;
const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** A fresh copy of the floor with the lab on it, so these gates never see a state another left. */
function freshLab(context: RoomGateContext): SpiderLabDressing {
  const source = context.env.gameMap;
  const room = source.spiderLabRoom;
  if (room === null) throw new Error('the floor has no spider lab');
  const map = new GameMap({
    tileHeight: TILE_SIZE,
    prebuiltStructure: source.structure.map((row) => row.map((tile) => ({ ...tile }))),
  });
  map.spiderLabRoom = room;
  return new SpiderLabDressing(map, room);
}

/** A stand-in quest for the lab: a brood of fixed size that counts what the lab lets loose. */
function testQuest(released: { count: number }): SpiderLabQuestView {
  const people: DressingRenderable[] = [];
  return {
    eggSacLook: () => ({ state: 'opened', frame: 0 }),
    liveBroodCount: () => TEST_BROOD_ALREADY_LIVE + released.count,
    broodCap: () => (fault === 'cocoon-cap' ? Number.POSITIVE_INFINITY : TEST_BROOD_CAP),
    spawnHatchling: () => {
      released.count++;
    },
    hatchlingsAllowed: () => true,
    people: () => people,
  };
}

function reachableFrom(
  map: GameMap,
  start: { x: number; y: number },
  inside: (x: number, y: number) => boolean,
): Set<string> {
  const reached = new Set([tileKey(start.x, start.y)]);
  const frontier = [start];
  const STEPS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
    for (const [dx, dy] of STEPS) {
      const x = next.x + dx;
      const y = next.y + dy;
      if (reached.has(tileKey(x, y)) || !inside(x, y) || !map.isWalkable(x, y)) continue;
      reached.add(tileKey(x, y));
      frontier.push({ x, y });
    }
  }
  return reached;
}

function gateHackPath(context: RoomGateContext): void {
  const { gameMap, room } = context.env;
  const lab = gameMap.spiderLabRoom;
  if (lab === null) return;
  const { bounds } = lab;
  const inside = (x: number, y: number): boolean =>
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h;
  const table = fault === 'hack-path' ? [] : lab.computerTableTiles;
  const fromLabPost = reachableFrom(gameMap, lab.labPostTile, inside);
  const workable = [...fromLabPost].some((key) => {
    const [x, y] = key.split(',').map(Number);
    return table.some((t) => chebyshev(t, { x, y }) <= TERMINAL_REACH_TILES);
  });
  if (!workable) context.report.fail('the scientist cannot walk to the terminal');
  const door = room.doorways[0]?.tile;
  if (
    door !== undefined &&
    !reachableFrom(gameMap, door, inside).has(tileKey(lab.labPostTile.x, lab.labPostTile.y))
  ) {
    context.report.fail('the doorway cannot reach the scientist');
  }
}

function gateLayout(context: RoomGateContext): void {
  const { gameMap, room } = context.env;
  const lab = gameMap.spiderLabRoom;
  if (lab === null) return;
  const doorTiles = room.doorways.flatMap((doorway) => doorway.tiles);
  for (const web of lab.webTiles) {
    if (doorTiles.some((door) => chebyshev(door, web) <= WEB_DOORWAY_CLEARANCE_TILES)) {
      context.report.fail(`web at ${tileKey(web.x, web.y)} is within six tiles of the doorway`);
      break;
    }
  }
  if (lab.webTiles.some((web) => web.x === lab.spiderEggTile.x && web.y === lab.spiderEggTile.y)) {
    context.report.fail('web is laid on the egg sac');
  }
  if (lab.webTiles.length === 0) context.report.fail('the lab has no webbing at all');
  const frame = doorFrame(lab.bounds, lab.entranceWall);
  const halfway = frame.depthMax * HALF;
  if (lab.benchTiles.some((bench) => frame.toFrame(bench).depth >= halfway)) {
    context.report.fail('a bench stands in the far half, away from the scientist and the terminal');
  }
  for (const shelf of lab.shelfTiles) {
    const { along } = frame.toFrame(shelf);
    if (along !== frame.alongMin && along !== frame.alongMax) {
      context.report.fail(`shelving at ${tileKey(shelf.x, shelf.y)} is off the side walls`);
      break;
    }
    if (gameMap.structure[shelf.y]?.[shelf.x]?.type !== LAB_SHELF) {
      context.report.fail(`shelving at ${tileKey(shelf.x, shelf.y)} is not on the map`);
      break;
    }
  }
  const cocoons = lab.cocoonTiles.length;
  if (cocoons < MIN_COCOONS || cocoons > MAX_COCOONS) {
    context.report.fail(`${cocoons} cocoons; the lab hangs ${MIN_COCOONS} to ${MAX_COCOONS}`);
  }
  if (lab.cocoonTiles.some((cocoon) => frame.toFrame(cocoon).depth < halfway)) {
    context.report.fail('a cocoon hangs in the entrance half');
  }
}

function gateMaskMemory(context: RoomGateContext): void {
  const lab = context.env.gameMap.spiderLabRoom;
  if (lab === null) return;
  const bytes = darknessMaskBytes(lab) * MASKS_HELD;
  if (bytes > MASK_BUDGET_BYTES) {
    context.report.fail(`darkness masks hold ${bytes} bytes (budget ${MASK_BUDGET_BYTES})`);
  }
}

function gateCocoonCap(context: RoomGateContext): void {
  const lab = freshLab(context);
  const released = { count: 0 };
  lab.attachQuest(testQuest(released));
  // Her, laying in her last phase beside each cocoon in turn, wakes all of them.
  for (const cocoon of lab.room.cocoonTiles) {
    const spider = new GrotesqueSpider(cocoon.x, cocoon.y, TILE_SIZE);
    spider.hp = Math.max(1, Math.floor(spider.maxHp * PHASE_THREE_HP_SHARE));
    // Her phase is latched as she fights; a spider built for a gate has to be told.
    Reflect.set(spider, 'reachedPhase', LAST_PHASE);
    lab.observeFight(spider, [], 1);
  }
  for (let i = 0; i <= EGG_HATCH_FRAMES; i++) lab.update(context.env.frame);
  const live = TEST_BROOD_ALREADY_LIVE + released.count;
  if (live > TEST_BROOD_CAP) {
    context.report.fail(`cocoons pushed the brood to ${live}, past its cap of ${TEST_BROOD_CAP}`);
  }
  if (lab.liveParticleCount > MAX_LAB_PARTICLES) {
    context.report.fail(
      `${lab.liveParticleCount} ambient particles, over the ${MAX_LAB_PARTICLES} cap`,
    );
  }
}

/** Everything a lab's fight can change, as one comparable string. */
function fingerprint(lab: SpiderLabDressing): string {
  const webs = lab.room.webTiles
    .map((t) => (lab.gameMap.structure[t.y]?.[t.x]?.type === LAB_WEB ? '1' : '0'))
    .join('');
  return `${JSON.stringify(lab.captureCheckpoint())}|${webs}`;
}

/** Cuts webs, breaks glass, wakes cocoons and brings the dark down, as a fight would. */
function wreck(lab: SpiderLabDressing): void {
  const web = lab.room.webTiles[0];
  if (web !== undefined) {
    const clear: unknown = Reflect.get(lab, 'clearWebAround');
    if (typeof clear === 'function') {
      Reflect.apply(clear, lab, [(web.x + HALF) * TILE_SIZE, (web.y + HALF) * TILE_SIZE, 2]);
    }
  }
  const bench = lab.room.benchTiles[0];
  if (bench !== undefined) {
    lab.shatterGlassUnder({
      originX: (bench.x + HALF) * TILE_SIZE,
      originY: (bench.y + HALF) * TILE_SIZE,
      dirX: 1,
      dirY: 0,
      radiusPx: TILE_SIZE,
      halfAngleRad: Math.PI,
    });
  }
  const cocoon = lab.room.cocoonTiles[0];
  if (cocoon !== undefined) {
    const spider = new GrotesqueSpider(cocoon.x, cocoon.y, TILE_SIZE);
    spider.hp = Math.max(1, Math.floor(spider.maxHp * PHASE_THREE_HP_SHARE));
    // Her phase is latched as she fights; a spider built for a gate has to be told.
    Reflect.set(spider, 'reachedPhase', LAST_PHASE);
    lab.observeFight(spider, [], 1);
  }
  lab.enterLightPhase(2);
  lab.enterLightPhase(3);
}

function gateRestore(context: RoomGateContext): void {
  const lab = freshLab(context);
  lab.attachQuest(testQuest({ count: 0 }));
  const pristine = fingerprint(lab);

  const saved = lab.captureCheckpoint();
  wreck(lab);
  if (fingerprint(lab) === pristine)
    context.report.fail('wrecking the lab changed nothing — the gate cannot see a restore');
  lab.resetForCheckpoint();
  lab.restoreCheckpoint(saved);
  if (fingerprint(lab) !== pristine)
    context.report.fail('a death does not put the lab back as it was saved');

  lab.onSeal();
  wreck(lab);
  if (fault !== 'abort') lab.onFightAborted();
  if (fingerprint(lab) !== pristine) context.report.fail('an aborted fight leaves the lab wrecked');

  lab.onSeal();
  wreck(lab);
  lab.onBossDefeated();
  const won = fingerprint(lab);
  lab.onBossDefeated();
  if (fingerprint(lab) !== won) context.report.fail('a second defeat changes the won lab');

  const parsed = parseSpiderLabDressingCheckpoint(
    JSON.parse(JSON.stringify(lab.captureCheckpoint())),
  );
  if (parsed === undefined) {
    context.report.fail('the lab checkpoint does not survive a save');
  } else if (JSON.stringify(parsed) !== JSON.stringify(lab.captureCheckpoint())) {
    context.report.fail('the lab checkpoint comes back from a save changed');
  }
}

/** The lab's web tiles that are web on its map right now. */
function webbedTiles(lab: SpiderLabDressing): Set<string> {
  const webbed = new Set<string>();
  const { structure } = lab.gameMap;
  const { bounds } = lab.room;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (structure[y]?.[x]?.type === LAB_WEB) webbed.add(tileKey(x, y));
    }
  }
  return webbed;
}

/**
 * A crawler's swing clears the web it lands on and a detonation clears more,
 * and her last roar grows back only the far half's cut web, never past where
 * the web first was.
 */
function gateWebClearing(context: RoomGateContext): void {
  const lab = freshLab(context);
  lab.attachQuest(testQuest({ count: 0 }));
  const web = lab.room.webTiles[Math.floor(lab.room.webTiles.length / 2)];
  if (web === undefined) return;
  const before = webbedTiles(lab).size;
  const human = context.env.frame.human;
  human.x = web.x * TILE_SIZE;
  human.y = (web.y + 1) * TILE_SIZE;
  human.facingX = 0;
  human.facingY = -1;
  const swing: unknown = Reflect.get(lab, 'resolveSwing');
  if (typeof swing !== 'function') throw new Error('lookup failed: resolveSwing');
  Reflect.apply(swing, lab, [human]);
  const afterSwing = webbedTiles(lab).size;
  if (afterSwing >= before) context.report.fail('a swing into the web cleared none of it');
  const clear: unknown = Reflect.get(lab, 'clearWebAround');
  if (typeof clear !== 'function') throw new Error('lookup failed: clearWebAround');
  for (const tile of lab.room.webTiles) {
    Reflect.apply(clear, lab, [(tile.x + HALF) * TILE_SIZE, (tile.y + HALF) * TILE_SIZE, 1]);
  }
  if (webbedTiles(lab).size !== 0) context.report.fail('clearing every web tile left web behind');
  lab.onSeal();
  lab.enterLightPhase(2);
  lab.enterLightPhase(3);
  for (let i = 0; i < REGROW_WAIT_FRAMES; i++) lab.update(context.env.frame);
  const frame = doorFrame(lab.room.bounds, lab.room.entranceWall);
  const original = new Set(lab.room.webTiles.map((t) => tileKey(t.x, t.y)));
  const regrown = webbedTiles(lab);
  for (const key of regrown) {
    const [x, y] = key.split(',').map(Number);
    if (!original.has(key)) {
      context.report.fail(`web grew back at ${key}, where there was none`);
      return;
    }
    if (frame.toFrame({ x, y }).depth <= frame.depthMax * HALF) {
      context.report.fail(`web grew back at ${key}, in the entrance half`);
      return;
    }
  }
  const farOriginal = lab.room.webTiles.filter(
    (t) => frame.toFrame(t).depth > frame.depthMax * HALF,
  );
  if (regrown.size !== farOriginal.length) {
    context.report.fail(`${regrown.size} of ${farOriginal.length} far web tiles grew back`);
  }
}
/** Long enough for every capped batch of regrowth to finish. */
const REGROW_WAIT_FRAMES = 1200;

export function spiderLabGates(context: RoomGateContext): void {
  gateWebClearing(context);
  gateHackPath(context);
  gateLayout(context);
  gateMaskMemory(context);
  gateCocoonCap(context);
  gateRestore(context);
}
