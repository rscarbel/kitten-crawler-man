#!/usr/bin/env tsx
/**
 * The Current Goblin's power lab: behaviour gates for his fight, on real
 * generated floors with the doorway on each side.
 *
 *   npm run gates:power-lab
 *   npm run gates:power-lab -- --fault=<name>   # must fail
 *
 * What it holds the fight to:
 *   - every telegraph (a grenade's ring, the puddle's tell, the slam's lane) is
 *     at least the locked-telegraph floor on every difficulty, and a harder
 *     difficulty never tells for longer than an easier one;
 *   - each can be walked out of at walking pace by a crawler who stood still
 *     for the reaction delay the fairness rules assume;
 *   - a charged puddle hurts whoever stands in it, nobody outside it, and never
 *     him;
 *   - he blocks some Magic Missiles while free, and none during a wind-up;
 *   - a lit explosive in reach sends him running clear of its blast;
 *   - in a scripted fight every one of his telegraphed attacks comes round.
 *
 * Faults (each must turn its gate red without touching a source file):
 *   `--fault=frozen`     the escaping crawler never moves off its tile;
 *   `--fault=in-puddle`  the bystander is stood inside the charged puddle;
 *   `--fault=no-flee`    the explosive is lit out of his reach.
 */

import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import {
  ElectricGoblin,
  SHOCK_GRENADE_RADIUS_TILES,
  SLAM_WAVE_HALF_WIDTH_TILES,
} from '../src/creatures/ElectricGoblin.js';
import { setExplosiveSources } from '../src/creatures/explosiveAwareness.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { DIFFICULTY_ORDER, type Difficulty } from '../src/core/difficulty/difficultyProfiles.js';
import { settings } from '../src/core/input/Settings.js';
import { applyMovement } from '../src/systems/GameLoopPhases.js';
import type { GameMap } from '../src/map/GameMap.js';
import type { Player } from '../src/Player.js';
import type { PowerLabRoomSystem } from '../src/systems/bossRooms/PowerLabRoomSystem.js';
import { labTileKey, type LabPuddle } from '../src/systems/bossRooms/powerLabLayout.js';
import type { DoorSide, TilePoint } from '../src/systems/bossRooms/bossRoomLayout.js';
import type { ExplosiveSource } from '../src/systems/ExplosiveSource.js';
import {
  DOOR_SIDES,
  buildEnvironment,
  findFloorWithRoom,
  gameGauntletDressings,
  type RoomEnvironment,
} from './bossRooms/harness.js';
import { powerLabRoom } from './bossRooms/powerLab.js';
import { runElectricGoblinFight } from './bossRooms/electricGoblinFightSim.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const FAULTS = ['frozen', 'in-puddle', 'no-flee'] as const;
type Fault = (typeof FAULTS)[number];
const faultArg = process.argv.find((a) => a.startsWith('--fault='))?.slice('--fault='.length) ?? '';
const fault: Fault | undefined = FAULTS.find((f) => f === faultArg);
if (faultArg !== '' && fault === undefined) throw new Error(`unknown fault ${faultArg}`);

/** The first floor seed the room gates start their search from. */
const GATE_SEED = 1;
/** Longest the gates wait for an attack of his to come round, in frames. */
const ATTACK_WAIT_FRAMES = 4000;
/** Where the watching crawler stands: this far from him, out of swipe reach. */
const WATCHER_DISTANCE_TILES = 4;

let failures = 0;
function check(condition: boolean, scope: string, message: string): void {
  if (condition) return;
  failures++;
  console.log(`FAIL ${scope}: ${message}`);
}
function note(scope: string, message: string): void {
  console.log(`     ${scope}: ${message}`);
}

interface Lab {
  readonly env: RoomEnvironment;
  readonly room: PowerLabRoomSystem;
  readonly boss: ElectricGoblin;
}

/**
 * A lab with him in it and the human standing a few tiles off, the cat out of
 * the fight, so the fight can be stepped frame by frame.
 */
function buildLab(side: DoorSide): Lab {
  const found = findFloorWithRoom(powerLabRoom, GATE_SEED, side);
  if (found === null) throw new Error(`no power lab with a ${side} doorway`);
  const env = buildEnvironment(found);
  const { powerLab } = gameGauntletDressings(env);
  if (powerLab === null) throw new Error('the floor built no power lab');
  const boss = new ElectricGoblin(env.room.spawn.x, env.room.spawn.y, TILE_SIZE);
  boss.forceAggro = true;
  env.frame.roster.add(boss);
  env.frame.cat.hp = 0;
  const watcher = standingTileNear(env.gameMap, env.room.spawn, WATCHER_DISTANCE_TILES);
  env.frame.human.x = watcher.x * TILE_SIZE;
  env.frame.human.y = watcher.y * TILE_SIZE;
  powerLab.onSeal();
  return { env, room: powerLab, boss };
}

/** A walkable tile `distance` from `from`, trying the compass round until one is. */
function standingTileNear(gameMap: GameMap, from: TilePoint, distance: number): TilePoint {
  const COMPASS = 8;
  for (let i = 0; i < COMPASS; i++) {
    const angle = (i / COMPASS) * Math.PI * 2;
    const tile = {
      x: Math.round(from.x + Math.cos(angle) * distance),
      y: Math.round(from.y + Math.sin(angle) * distance),
    };
    if (gameMap.isWalkable(tile.x, tile.y, 'walker')) return tile;
  }
  return from;
}

/** One fight frame, as the scene runs it, against `party`. */
function step(lab: Lab, party: Player[]): void {
  lab.room.update(lab.env.frame);
  lab.boss.updateAI(party);
  lab.boss.tickTimers();
}

/** Steps the fight until `until` holds, and returns the frame it first did, or null. */
function stepUntil(lab: Lab, party: Player[], until: () => boolean): number | null {
  for (let frame = 0; frame < ATTACK_WAIT_FRAMES; frame++) {
    step(lab, party);
    if (until()) return frame;
  }
  return null;
}

const HALF_TILE = TILE_SIZE / 2;

function centreOf(body: { x: number; y: number }): TilePoint {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

// ── 1. Telegraph lengths on every difficulty ─────────────────────────────────

interface Tells {
  readonly grenade: number | null;
  readonly slam: number | null;
  readonly puddle: number | null;
}

/** How long each telegraph of his shows before it lands, measured off a real fight. */
function measureTells(): Tells {
  const lab = buildLab('south');
  const party = [lab.env.frame.human];
  let grenade: number | null = null;
  let slam: number | null = null;
  let puddle: number | null = null;
  let laneSince: number | null = null;
  let tellSince: number | null = null;
  let wavesBefore = 0;
  for (let frame = 0; frame < ATTACK_WAIT_FRAMES; frame++) {
    step(lab, party);
    const { shockGrenades } = lab.boss;
    if (grenade === null && shockGrenades.length > 0) grenade = shockGrenades[0].flightFrames;
    if (laneSince === null && lab.boss.slamLanes.length > 0) laneSince = frame;
    const waves = lab.boss.slamWaves.length;
    if (slam === null && laneSince !== null && waves > wavesBefore) slam = frame - laneSince;
    wavesBefore = waves;
    const charge = lab.boss.puddleCharge;
    if (tellSince === null && charge.kind === 'tell') tellSince = frame;
    if (puddle === null && tellSince !== null && charge.kind === 'charged') {
      puddle = frame - tellSince;
    }
    if (grenade !== null && slam !== null && puddle !== null) break;
  }
  return { grenade, slam, puddle };
}

const tellsByDifficulty = new Map<Difficulty, Tells>();
for (const difficulty of DIFFICULTY_ORDER) {
  settings.setDifficulty(difficulty);
  const tells = measureTells();
  tellsByDifficulty.set(difficulty, tells);
  for (const kind of ['grenade', 'slam', 'puddle'] as const) {
    const frames = tells[kind];
    check(frames !== null, `telegraph ${difficulty}`, `no ${kind} came round`);
    if (frames === null) continue;
    check(
      frames >= LOCKED_TELEGRAPH_MIN_FRAMES,
      `telegraph ${difficulty}`,
      `${kind} shows ${frames} frames, under the ${LOCKED_TELEGRAPH_MIN_FRAMES}-frame floor`,
    );
  }
  note(
    `telegraph ${difficulty}`,
    `grenade ${tells.grenade} / slam ${tells.slam} / puddle ${tells.puddle} frames`,
  );
}
for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
  const easier = tellsByDifficulty.get(DIFFICULTY_ORDER[i - 1]);
  const harder = tellsByDifficulty.get(DIFFICULTY_ORDER[i]);
  if (easier === undefined || harder === undefined) continue;
  for (const kind of ['grenade', 'slam', 'puddle'] as const) {
    const a = easier[kind];
    const b = harder[kind];
    if (a === null || b === null) continue;
    check(
      b <= a,
      'telegraph order',
      `${kind} tells longer on ${DIFFICULTY_ORDER[i]} than on ${DIFFICULTY_ORDER[i - 1]}`,
    );
  }
}
settings.setDifficulty('normal');

// ── 2. Escapes at walking pace ───────────────────────────────────────────────

const ESCAPE_HEADINGS = 16;
/** A crawler stands still for this long after a telegraph begins before reacting. */
const REACTION_FRAMES = LOCKED_TELEGRAPH_MIN_FRAMES;

/**
 * Walks a crawler from `start` along each heading with the game's own movement
 * (walls stop it) for `frames` after standing still for the reaction delay,
 * and reports the best clearance any heading reached.
 */
function bestEscape(
  gameMap: GameMap,
  start: TilePoint,
  frames: number,
  clearance: (centre: TilePoint) => number,
): number {
  let best = -Infinity;
  for (let h = 0; h < ESCAPE_HEADINGS; h++) {
    const angle = (h / ESCAPE_HEADINGS) * Math.PI * 2;
    const crawler = new HumanPlayer(0, 0, TILE_SIZE);
    crawler.x = start.x - HALF_TILE;
    crawler.y = start.y - HALF_TILE;
    const walkFrames = fault === 'frozen' ? REACTION_FRAMES : frames;
    for (let f = REACTION_FRAMES; f < walkFrames; f++) {
      applyMovement(
        crawler,
        { dx: Math.cos(angle), dy: Math.sin(angle), isMobile: true },
        gameMap,
        'sole',
      );
    }
    best = Math.max(best, clearance(centreOf(crawler)));
  }
  return best;
}

function isIn(puddle: LabPuddle, point: TilePoint): boolean {
  return puddle.keys.has(
    labTileKey(Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE)),
  );
}

const ringPx = SHOCK_GRENADE_RADIUS_TILES * TILE_SIZE;
const laneHalfWidthPx = SLAM_WAVE_HALF_WIDTH_TILES * TILE_SIZE;

for (const side of DOOR_SIDES) {
  const scope = `escape ${side}`;
  const lab = buildLab(side);
  const { gameMap } = lab.env;
  const party = [lab.env.frame.human];

  // A grenade's ring, from its centre, in the time it is in the air.
  if (stepUntil(lab, party, () => lab.boss.shockGrenades.length > 0) === null) {
    check(false, scope, 'no grenade came round');
  } else {
    for (const grenade of lab.boss.shockGrenades) {
      const clear = bestEscape(
        gameMap,
        { x: grenade.landX, y: grenade.landY },
        grenade.flightFrames,
        (c) => Math.hypot(c.x - grenade.landX, c.y - grenade.landY) - ringPx,
      );
      check(clear > 0, scope, `a grenade ring cannot be walked out of (${clear.toFixed(1)} px)`);
    }
  }

  // Each of a slam's lanes, from the middle of it, between the lanes showing and its wave arriving.
  const laneShown = stepUntil(lab, party, () => lab.boss.slamLanes.length > 0);
  const shownLanes = lab.boss.slamLanes;
  if (laneShown === null || shownLanes.length === 0) {
    check(false, scope, 'no slam came round');
  } else {
    const arrivals = shownLanes.map(() => ATTACK_WAIT_FRAMES);
    for (let frame = 0; frame < ATTACK_WAIT_FRAMES; frame++) {
      step(lab, party);
      for (const [index, lane] of shownLanes.entries()) {
        const alongPx = lane.lengthPx / 2;
        const arrived = lab.boss.slamWaves.some(
          (w) => w.dirX === lane.dirX && w.dirY === lane.dirY && w.travelled >= alongPx,
        );
        if (arrived) arrivals[index] = Math.min(arrivals[index], frame);
      }
      if (arrivals.every((a) => a < ATTACK_WAIT_FRAMES)) break;
    }
    for (const [index, lane] of shownLanes.entries()) {
      const alongPx = lane.lengthPx / 2;
      const point = { x: lane.fromX + lane.dirX * alongPx, y: lane.fromY + lane.dirY * alongPx };
      const clear = bestEscape(gameMap, point, arrivals[index], (c) => {
        const offsetX = c.x - lane.fromX;
        const offsetY = c.y - lane.fromY;
        const across = Math.abs(offsetX * lane.dirY - offsetY * lane.dirX);
        return across - laneHalfWidthPx;
      });
      check(clear > 0, scope, `a slam's lane cannot be stepped out of (${clear.toFixed(1)} px)`);
    }
  }

  // The puddle, from its middle, between the tell starting and the charge.
  const tellAt = stepUntil(lab, party, () => lab.boss.puddleCharge.kind === 'tell');
  const told = lab.boss.puddleCharge;
  const puddle = told.kind === 'tell' ? lab.room.layout.puddles[told.puddle] : undefined;
  if (tellAt === null || puddle === undefined) {
    check(false, scope, 'no puddle charge came round');
    continue;
  }
  const chargedAfter = stepUntil(lab, party, () => lab.boss.puddleCharge.kind === 'charged');
  if (chargedAfter === null) {
    check(false, scope, 'a puddle tell never charged');
    continue;
  }
  const middle = {
    x: puddle.centre.x * TILE_SIZE + HALF_TILE,
    y: puddle.centre.y * TILE_SIZE + HALF_TILE,
  };
  const clear = bestEscape(gameMap, middle, chargedAfter + 1, (c) => (isIn(puddle, c) ? -1 : 1));
  check(clear > 0, scope, 'the middle of a puddle cannot be walked out of before it charges');
}

// ── 3. A charged puddle hurts who is in it, and nobody else ──────────────────

for (const side of DOOR_SIDES) {
  const scope = `charge ${side}`;
  const lab = buildLab(side);
  const inside = lab.env.frame.human;
  const outside = new HumanPlayer(0, 0, TILE_SIZE);
  const party: Player[] = [inside, outside];
  if (stepUntil(lab, party, () => lab.boss.puddleCharge.kind === 'charged') === null) {
    check(false, scope, 'no puddle was ever charged');
    continue;
  }
  const charge = lab.boss.puddleCharge;
  const puddle = charge.kind === 'charged' ? lab.room.layout.puddles[charge.puddle] : undefined;
  if (puddle === undefined) continue;
  const wet = puddle.tiles[Math.floor(puddle.tiles.length / 2)];
  const dry = standingTileNear(lab.env.gameMap, lab.env.room.spawn, WATCHER_DISTANCE_TILES);
  const dryIsWet = puddle.keys.has(labTileKey(dry.x, dry.y));
  const bystander = fault === 'in-puddle' || dryIsWet ? wet : dry;
  inside.x = wet.x * TILE_SIZE;
  inside.y = wet.y * TILE_SIZE;
  outside.x = bystander.x * TILE_SIZE;
  outside.y = bystander.y * TILE_SIZE;
  inside.hp = inside.maxHp;
  outside.hp = outside.maxHp;
  const bossHp = lab.boss.hp;
  for (let frame = 0; frame < LOCKED_TELEGRAPH_MIN_FRAMES; frame++) {
    // Held in place: the charge is measured on bodies that stay where they were put.
    inside.x = wet.x * TILE_SIZE;
    inside.y = wet.y * TILE_SIZE;
    lab.room.update(lab.env.frame);
    lab.boss.tickTimers();
  }
  check(inside.hp < inside.maxHp, scope, 'a crawler standing in the charged puddle took nothing');
  check(outside.hp === outside.maxHp, scope, 'a crawler off the puddle was hurt by its charge');
  check(lab.boss.hp === bossHp, scope, 'his own charge hurt him');
}

// ── 4. Missile blocks: some while free, none in a wind-up ────────────────────

const BLOCK_TRIES = 200;
{
  const lab = buildLab('south');
  const party = [lab.env.frame.human];
  let freeBlocks = 0;
  for (let i = 0; i < BLOCK_TRIES; i++) if (lab.boss.tryBlockProjectile('missile')) freeBlocks++;
  check(freeBlocks > 0, 'block', 'he never blocked a missile while free');
  check(freeBlocks < BLOCK_TRIES, 'block', 'he blocked every missile while free');
  if (stepUntil(lab, party, () => lab.boss.slamLanes.length > 0) === null) {
    check(false, 'block', 'no slam wind-up came round');
  } else {
    let windupBlocks = 0;
    for (let i = 0; i < BLOCK_TRIES; i++) {
      if (lab.boss.tryBlockProjectile('missile')) windupBlocks++;
    }
    check(windupBlocks === 0, 'block', `he blocked ${windupBlocks} missiles mid wind-up`);
  }
  note('block', `${freeBlocks} of ${BLOCK_TRIES} blocked while free`);
}

// ── 5. A lit explosive sends him running ─────────────────────────────────────

const BLAST_RADIUS_TILES = 2;
const FUSE_FRAMES = 120;
const OUT_OF_REACH_TILES = 30;
{
  const lab = buildLab('south');
  const party = [lab.env.frame.human];
  const start = centreOf(lab.boss);
  const offset = fault === 'no-flee' ? OUT_OF_REACH_TILES * TILE_SIZE : 0;
  const stick = {
    kind: 'stick',
    id: 'stick_1',
    grounded: true,
    x: start.x + offset,
    y: start.y,
    fuseFramesLeft: FUSE_FRAMES,
    blastRadiusPx: BLAST_RADIUS_TILES * TILE_SIZE,
    owner: 'party',
  } as const;
  const source: ExplosiveSource = { liveExplosives: () => [stick], kick: () => false };
  setExplosiveSources([source]);
  for (let frame = 0; frame < FUSE_FRAMES; frame++) step(lab, party);
  setExplosiveSources([]);
  const end = centreOf(lab.boss);
  const fromStick = Math.hypot(end.x - stick.x, end.y - stick.y);
  check(
    fromStick > stick.blastRadiusPx,
    'flee',
    `he was still ${(fromStick / TILE_SIZE).toFixed(1)} tiles from a stick whose blast reaches ${BLAST_RADIUS_TILES}`,
  );
}

// ── 6. Every attack comes round in a scripted fight ──────────────────────────

const SIM_SEED = 1;
for (const side of DOOR_SIDES) {
  const fight = runElectricGoblinFight({ seed: SIM_SEED, side });
  const scope = `fight ${side}`;
  for (const kind of ['grenade', 'slam', 'puddle'] as const) {
    check(fight.started[kind] > 0, scope, `he never started a ${kind}`);
  }
  note(
    scope,
    `${fight.killed ? 'killed' : 'survived'} in ${fight.timeToKillSeconds.toFixed(1)} s; ` +
      `started ${fight.started.grenade} grenade / ${fight.started.slam} slam / ${fight.started.puddle} puddle; ` +
      `hits ${Object.entries(fight.hits)
        .map(([kind, count]) => `${kind} ${count}`)
        .join(', ')}`,
  );
}

if (fault !== undefined) console.log(`fault '${fault}' injected`);
if (failures > 0) {
  console.log(`\n${failures} power lab gate(s) failed`);
  process.exit(1);
}
console.log('\npower lab gates: all green');
