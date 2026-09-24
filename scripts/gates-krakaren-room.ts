#!/usr/bin/env tsx
/**
 * Krakaren Clone's flooded clone lab: the fairness and "not easier" gates for
 * the room itself, on real generated floors with the doorway on each side.
 *
 *   npm run gates:krakaren-room
 *   npm run gates:krakaren-room -- --fault=<name>   # must fail
 *
 * What it holds the room to:
 *   - the slam can be walked out of from every tile that is ever flood water,
 *     at wading pace, starting at the reaction delay the fairness rules assume;
 *   - a bursting vat can be walked out of the same way, and both telegraphs,
 *     and the live wire's, are at least the locked-telegraph floor;
 *   - an arc never goes off while a slam is diving onto its water;
 *   - no more than two vats burst within any one second;
 *   - a live puddle's charge never spreads past its cap, and does spread;
 *   - a death and an aborted fight both put every flipped tile back;
 *   - the room's kill is idempotent, and a junction box dies to its swings;
 *   - the scripted fight is no more than ten percent easier than the same
 *     fight in the bare stone room (`--no-lab`).
 *
 * `--no-lab` re-measures the baseline instead: the same fights in the bare
 * room with no lab built, printed beside the recorded constants.
 *
 * Faults (each must turn its gate red without touching a source file):
 *   `--fault=frozen`       the escaping crawler never moves off its tile;
 *   `--fault=easier`       inflates the baseline, so the fight reads as easier;
 *   `--fault=no-restore`   skips the abort restore;
 *   `--fault=arc-in-dive`  reports every arcing frame as overlapping a dive.
 */

import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import {
  SLAM_KILL_RADIUS_PX,
  SLAM_SHADOW_FRAMES,
  KrakarenClone,
} from '../src/creatures/KrakarenClone.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { KrakarenTentacle } from '../src/creatures/KrakarenTentacle.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { KRAKAREN_WADE } from '../src/map/tileTypes.js';
import { applyMovement } from '../src/systems/GameLoopPhases.js';
import { KRAKAREN_WADE_SPEED_FACTOR } from '../src/map/tileSpeed.js';
import type { GameMap } from '../src/map/GameMap.js';
import {
  BURST_WINDOW_FRAMES,
  JUNCTION_BOX_HITS,
  LIVE_WIRE_SPARK_FRAMES,
  LIVE_WIRE_SPREAD_MAX_TILES,
  MAX_BURSTS_PER_WINDOW,
  TANK_BURST_RADIUS_TILES,
  TANK_CRACK_FRAMES,
  burstZoneTiles,
  isInBurstZone,
  type KrakarenRoomSystem,
} from '../src/systems/bossRooms/KrakarenRoomSystem.js';
import { parseKrakarenRoomCheckpoint } from '../src/systems/bossRooms/krakarenRoomCheckpoint.js';
import { labTileKey } from '../src/systems/bossRooms/krakarenLabLayout.js';
import type { DoorSide, TilePoint } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  DOOR_SIDES,
  buildEnvironment,
  findFloorWithRoom,
  firstOf,
  gameGauntletDressings,
  roomView,
  useFloorTheme,
  type RoomEnvironment,
} from './bossRooms/harness.js';
import { krakarenRoom } from './bossRooms/krakaren.js';
import { runKrakarenFight, summarise, type FightMetrics } from './bossRooms/krakarenFightSim.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { createCanvas } from 'canvas';
import { setViewportSize } from '../src/core/Viewport.js';
import { CHUNK_TILES } from '../src/map/TileRenderer.js';
import { BED_PAINT_REACH } from '../src/map/tiles/bossRooms/krakarenTiles.js';

installCanvasGlobals();

const FAULTS = ['frozen', 'easier', 'no-restore', 'arc-in-dive'] as const;
type Fault = (typeof FAULTS)[number];
const faultArg = process.argv.find((a) => a.startsWith('--fault='))?.slice('--fault='.length) ?? '';
const fault: Fault | undefined = FAULTS.find((f) => f === faultArg);
if (faultArg !== '' && fault === undefined) throw new Error(`unknown fault ${faultArg}`);

// ── Baseline ─────────────────────────────────────────────────────────────────

/**
 * The scripted fight measured in the plain stone room, before the lab existed:
 * twelve fights (three seeds on each doorway side), one balanced crawler at
 * party level 8 against a level-8 boss. Means over the twelve.
 *
 * Time-to-kill counts from the seal to her death. Attacks per minute counts
 * each lash wound up and each slam started. Hits count every blow of hers or her
 * tentacles that landed on the crawler. The crawler dodged every slam.
 */
const BASELINE_TIME_TO_KILL_SECONDS = 73.26;
const BASELINE_ATTACKS_PER_MINUTE = 42.11;
const BASELINE_HITS_ON_CRAWLER = 39.83;
/** A metric may move this far toward "easier" before the gate fails. */
const EASIER_TOLERANCE = 0.1;
/** What `--fault=easier` multiplies the baseline by, to make the room read as easier. */
const EASIER_FAULT_SCALE = 1.5;
const SIM_SEED_COUNT = 3;
const SIM_SEEDS: readonly number[] = Array.from({ length: SIM_SEED_COUNT }, (_, i) => i + 1);
/** The first floor seed the room gates start their search from. */
const GATE_SEED = 1;

if (process.argv.includes('--no-lab')) {
  const bare: FightMetrics[] = [];
  for (const side of DOOR_SIDES) {
    for (const seed of SIM_SEEDS) bare.push(runKrakarenFight({ seed, side, withLab: false }));
  }
  const measured = summarise(bare);
  console.log(
    `bare room: ttk ${measured.timeToKillSeconds.toFixed(2)} s (recorded ${BASELINE_TIME_TO_KILL_SECONDS}), ` +
      `${measured.attacksPerMinute.toFixed(2)} attacks/min (recorded ${BASELINE_ATTACKS_PER_MINUTE}), ` +
      `${measured.hitsOnCrawler.toFixed(2)} hits (recorded ${BASELINE_HITS_ON_CRAWLER})`,
  );
  process.exit(0);
}

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
  readonly room: KrakarenRoomSystem;
}

function buildLab(side: DoorSide): Lab {
  const found = findFloorWithRoom(krakarenRoom, GATE_SEED, side);
  if (found === null) throw new Error(`no krakaren room with a ${side} doorway`);
  const env = buildEnvironment(found);
  const { krakaren } = gameGauntletDressings(env);
  if (krakaren === null) throw new Error('the floor built no krakaren room');
  return { env, room: krakaren };
}

const HALF_TILE = TILE_SIZE / 2;
const PERCENT = 100;

function centreOfTile(t: TilePoint): TilePoint {
  return { x: t.x * TILE_SIZE + HALF_TILE, y: t.y * TILE_SIZE + HALF_TILE };
}

// ── 1. Telegraph lengths ─────────────────────────────────────────────────────

/** A function rather than an inline comparison so a retune of either constant is judged at run time. */
function isAtLeast(value: number, floor: number): boolean {
  return value >= floor;
}

check(
  isAtLeast(TANK_CRACK_FRAMES, LOCKED_TELEGRAPH_MIN_FRAMES),
  'telegraph',
  `vat crack ${TANK_CRACK_FRAMES} frames is under the ${LOCKED_TELEGRAPH_MIN_FRAMES}-frame floor`,
);
check(
  isAtLeast(LIVE_WIRE_SPARK_FRAMES, LOCKED_TELEGRAPH_MIN_FRAMES),
  'telegraph',
  `live-wire sparks ${LIVE_WIRE_SPARK_FRAMES} frames is under the ${LOCKED_TELEGRAPH_MIN_FRAMES}-frame floor`,
);

// ── 2. Escapes at wading pace ────────────────────────────────────────────────

const ESCAPE_HEADINGS = 16;
/** A crawler stands still for this long after a telegraph begins before reacting. */
const REACTION_FRAMES = LOCKED_TELEGRAPH_MIN_FRAMES;

/**
 * Walks a crawler from `start` along each heading with the game's own movement
 * (wading slows it, walls stop it) for `frames` after standing still for the
 * reaction delay, and reports the best clearance any heading reached.
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
    best = Math.max(best, clearance({ x: crawler.x + HALF_TILE, y: crawler.y + HALF_TILE }));
  }
  return best;
}

/** Floods every tile a burst could ever flood, so the escapes are judged in the wettest room. */
function floodEverything(lab: Lab): void {
  lab.room.onSeal();
  lab.room.beginRupture();
  const boss = new KrakarenClone(lab.env.room.spawn.x, lab.env.room.spawn.y, TILE_SIZE);
  boss.isEnraged = true;
  lab.env.frame.roster.add(boss);
  for (let f = 0; f < RUPTURE_SETTLE_FRAMES; f++) lab.room.update(lab.env.frame);
}
/** Frames for the room's floor-load prewarm to finish, at its per-frame budget. */
const PREWARM_SETTLE_FRAMES = 400;
/** Long enough for all eight vats to crack and burst in turn. */
const RUPTURE_SETTLE_FRAMES = 600;

for (const side of DOOR_SIDES) {
  const lab = buildLab(side);
  floodEverything(lab);
  const { gameMap } = lab.env;
  const scope = `slam escape (${side} door)`;
  let tiles = 0;
  let worst = Infinity;
  for (let y = lab.env.room.bounds.y; y < lab.env.room.bounds.y + lab.env.room.bounds.h; y++) {
    for (let x = lab.env.room.bounds.x; x < lab.env.room.bounds.x + lab.env.room.bounds.w; x++) {
      if (gameMap.structure[y][x].type !== KRAKAREN_WADE) continue;
      tiles++;
      const start = centreOfTile({ x, y });
      const margin = bestEscape(
        gameMap,
        start,
        SLAM_SHADOW_FRAMES,
        (c) => Math.hypot(c.x - start.x, c.y - start.y) - SLAM_KILL_RADIUS_PX,
      );
      worst = Math.min(worst, margin);
      check(
        margin > 0,
        scope,
        `from wade tile ${x},${y} the best escape ends ${(-margin).toFixed(1)} px inside the kill radius`,
      );
    }
  }
  check(tiles > 0, scope, 'no wade tiles found — the gate measured nothing');
  note(
    scope,
    `${tiles} wade tiles, worst margin ${worst.toFixed(1)} px at ${KRAKAREN_WADE_SPEED_FACTOR}x pace`,
  );

  const burstScope = `burst escape (${side} door)`;
  let worstBurst = Infinity;
  let burstTiles = 0;
  for (const vat of lab.room.layout.vats) {
    for (const t of burstZoneTiles(vat)) {
      if (!gameMap.isWalkable(t.x, t.y)) continue;
      burstTiles++;
      const margin = bestEscape(gameMap, centreOfTile(t), TANK_CRACK_FRAMES, (c) =>
        isInBurstZone(vat, c.x, c.y, 0) ? -1 : 1,
      );
      worstBurst = Math.min(worstBurst, margin);
      check(
        margin > 0,
        burstScope,
        `from ${t.x},${t.y} no heading clears vat ${vat.tile.x},${vat.tile.y}'s burst in time`,
      );
    }
  }
  check(burstTiles > 0, burstScope, 'no burst-zone tiles found — the gate measured nothing');
  note(
    burstScope,
    `${burstTiles} tiles in front of vats, ${TANK_BURST_RADIUS_TILES}-tile half-disc`,
  );
}

// ── 3. Burst stagger, spread cap ─────────────────────────────────────────────

for (const side of DOOR_SIDES) {
  const lab = buildLab(side);
  const boss = new KrakarenClone(lab.env.room.spawn.x, lab.env.room.spawn.y, TILE_SIZE);
  boss.isEnraged = true;
  lab.env.frame.roster.add(boss);
  lab.room.onSeal();
  const burstFrames: number[] = [];
  let previous = lab.room.vatPhases.slice();
  for (let f = 0; f < RUPTURE_SETTLE_FRAMES; f++) {
    lab.room.update(lab.env.frame);
    const now = lab.room.vatPhases;
    now.forEach((phase, i) => {
      if (phase === 'bursting' && previous[i] !== 'bursting') burstFrames.push(f);
    });
    previous = now.slice();
  }
  const scope = `rupture (${side} door)`;
  check(
    burstFrames.length === lab.room.layout.vats.length,
    scope,
    `${burstFrames.length} of ${lab.room.layout.vats.length} vats burst`,
  );
  for (const start of burstFrames) {
    const inWindow = burstFrames.filter(
      (f) => f >= start && f < start + BURST_WINDOW_FRAMES,
    ).length;
    check(
      inWindow <= MAX_BURSTS_PER_WINDOW,
      scope,
      `${inWindow} bursts within a second from frame ${start}`,
    );
  }
  let spreadTotal = 0;
  lab.room.layout.livePuddles.forEach((puddle, i) => {
    const spread = lab.room.chargedTiles(i).length - puddle.tiles.length;
    spreadTotal += spread;
    check(
      spread <= LIVE_WIRE_SPREAD_MAX_TILES,
      scope,
      `puddle ${i} charge spread to ${spread} tiles`,
    );
  });
  check(
    spreadTotal > 0,
    scope,
    'no burst flooded into a live puddle — the spread was never exercised',
  );
  note(scope, `bursts at frames ${burstFrames.join(' ')}; charge spread ${spreadTotal} tiles`);
}

// ── 4. Arcs never overlap a slam dive ────────────────────────────────────────

/** Frames a crawler stands in a live puddle while she slams it, enraged. */
const ARC_WATCH_FRAMES = 6000;

for (const side of DOOR_SIDES) {
  const lab = buildLab(side);
  const { env, room } = lab;
  const boss = new KrakarenClone(env.room.spawn.x, env.room.spawn.y, TILE_SIZE);
  boss.isEnraged = true;
  env.frame.roster.add(boss);
  const puddle = room.layout.livePuddles[0];
  const human = env.frame.human;
  env.frame.cat.hp = 0;
  human.x = puddle.tiles[0].x * TILE_SIZE;
  human.y = puddle.tiles[0].y * TILE_SIZE;
  const keepAlive = human.takeDamage.bind(human);
  let arcHits = 0;
  human.takeDamage = (amount, source) => {
    if (source?.kind === 'environmental' && source.hazard === 'krakarenLiveWire') arcHits++;
    const landed = keepAlive(amount, source);
    human.hp = human.maxHp;
    return landed;
  };
  room.onSeal();
  let overlaps = 0;
  let divesOnPuddle = 0;
  let arcFrames = 0;
  for (let f = 0; f < ARC_WATCH_FRAMES; f++) {
    // Pinned to the water, as a crawler who never moves would be.
    human.x = puddle.tiles[0].x * TILE_SIZE;
    human.y = puddle.tiles[0].y * TILE_SIZE;
    boss.updateAI([human]);
    boss.tickTimers();
    room.update(env.frame);
    const slam = boss.slamTentacle;
    const diving = slam !== null && slam.phase === 'dive';
    const charged = room.chargedTiles(0);
    const onWater =
      slam !== null &&
      charged.some((t) => {
        const c = centreOfTile(t);
        return (
          Math.hypot(c.x - slam.targetX, c.y - slam.targetY) <= SLAM_KILL_RADIUS_PX + TILE_SIZE
        );
      });
    const arcing = room.wirePhases[0] === 'arcing';
    if (arcing) arcFrames++;
    if (diving && onWater) divesOnPuddle++;
    if ((arcing && diving && onWater) || (fault === 'arc-in-dive' && arcing)) overlaps++;
  }
  const scope = `arc vs slam (${side} door)`;
  check(
    overlaps === 0,
    scope,
    `${overlaps} frames with an arc going off while a slam dives onto its water`,
  );
  check(
    divesOnPuddle > 0,
    scope,
    'no slam ever dived onto the live puddle — the gate measured nothing',
  );
  note(
    scope,
    `${arcFrames} arc frames, ${divesOnPuddle} dive frames onto the water, ${arcHits} arc hits`,
  );
}

// ── 5. Checkpoints, aborts, the kill, the junction box ───────────────────────

interface TileSnapshot {
  type: number;
  stage: number | undefined;
}

function snapshotRoom(lab: Lab): Map<number, TileSnapshot> {
  const snap = new Map<number, TileSnapshot>();
  const b = lab.env.room.bounds;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const tile = lab.env.gameMap.structure[y][x];
      snap.set(labTileKey(x, y), { type: tile.type, stage: tile.damageStage });
    }
  }
  return snap;
}

function differences(a: Map<number, TileSnapshot>, b: Map<number, TileSnapshot>): number {
  let diff = 0;
  for (const [key, before] of a) {
    const after = b.get(key);
    const stageBefore = before.stage ?? 0;
    if (after === undefined) {
      diff++;
      continue;
    }
    const stageAfter = after.stage ?? 0;
    if (after.type !== before.type || stageAfter !== stageBefore) diff++;
  }
  return diff;
}

function swingAtJunction(lab: Lab, index: number): void {
  const human = lab.env.frame.human;
  const box = lab.room.junctionPoints()[index];
  human.x = box.x - HALF_TILE;
  human.y = box.y - HALF_TILE;
  // A swing's peak frame, as the attack timer reports it.
  const peak = human.isAttackPeak.bind(human);
  human.isAttackPeak = () => true;
  lab.room.update(lab.env.frame);
  human.isAttackPeak = peak;
}

for (const side of DOOR_SIDES) {
  const scope = `restore (${side} door)`;
  const lab = buildLab(side);
  const pristine = snapshotRoom(lab);
  const saved = lab.room.captureCheckpoint();
  floodEverything(lab);
  for (let hit = 0; hit < JUNCTION_BOX_HITS; hit++) swingAtJunction(lab, 0);
  check(
    lab.room.junctionDead(0),
    scope,
    `${JUNCTION_BOX_HITS} swings did not kill the junction box`,
  );
  const flooded = snapshotRoom(lab);
  const changed = differences(pristine, flooded);
  check(changed > 0, scope, 'the rupture changed no tiles — the restore gate measured nothing');

  // A fight abandoned with her alive.
  if (fault !== 'no-restore') lab.room.onFightAborted();
  const afterAbort = differences(pristine, snapshotRoom(lab));
  check(afterAbort === 0, scope, `${afterAbort} of ${changed} flipped tiles survived the abort`);
  check(!lab.room.junctionDead(0), scope, 'the smashed junction box survived the abort');

  // A death: the scene resets the room, then restores the save.
  floodEverything(lab);
  const midFight = lab.room.captureCheckpoint();
  lab.room.resetForCheckpoint();
  lab.room.restoreCheckpoint(saved);
  const afterDeath = differences(pristine, snapshotRoom(lab));
  check(afterDeath === 0, scope, `${afterDeath} flipped tiles survived a death's rewind`);

  // A save taken mid-flood comes back flooded, through the JSON a save file carries.
  const parsed = parseKrakarenRoomCheckpoint(JSON.parse(JSON.stringify(midFight)));
  if (parsed === null || parsed === undefined) {
    check(false, scope, 'a mid-flood checkpoint did not survive a JSON round trip');
  } else {
    lab.room.restoreCheckpoint(parsed);
    const afterLoad = differences(flooded, snapshotRoom(lab));
    // The junction box is the one thing the flooded snapshot has that this save did not.
    check(afterLoad === 0, scope, `${afterLoad} tiles differ after loading a mid-flood save`);
  }

  // The kill, twice, as the scene replays it after a load.
  lab.room.onBossDefeated();
  const once = JSON.stringify(lab.room.captureCheckpoint());
  const tilesOnce = snapshotRoom(lab);
  lab.room.onBossDefeated();
  check(
    once === JSON.stringify(lab.room.captureCheckpoint()),
    scope,
    'a second onBossDefeated changed the room state',
  );
  check(
    differences(tilesOnce, snapshotRoom(lab)) === 0,
    scope,
    'a second onBossDefeated changed the tiles',
  );
}

// ── 6. Companions see the room's hazards ─────────────────────────────────────

{
  const lab = buildLab('south');
  const boss = new KrakarenClone(lab.env.room.spawn.x, lab.env.room.spawn.y, TILE_SIZE);
  boss.isEnraged = true;
  lab.env.frame.roster.add(boss);
  lab.room.onSeal();
  lab.room.beginRupture();
  lab.room.update(lab.env.frame);
  const vat = lab.room.layout.vats[0];
  const front = vat.floods[0] ?? { x: vat.tile.x + vat.inward.x, y: vat.tile.y + vat.inward.y };
  check(
    lab.room.getHazardEscapeVector(front.x * TILE_SIZE, front.y * TILE_SIZE) !== null,
    'hazard publish',
    'a cracking vat publishes no ground to escape',
  );
  let sparked = false;
  for (let f = 0; f < RUPTURE_SETTLE_FRAMES && !sparked; f++) {
    lab.room.update(lab.env.frame);
    if (lab.room.wirePhases[0] === 'sparking') {
      sparked = true;
      const t = lab.room.layout.livePuddles[0].tiles[0];
      check(
        lab.room.getHazardEscapeVector(t.x * TILE_SIZE, t.y * TILE_SIZE) !== null,
        'hazard publish',
        'a sparking live puddle publishes no ground to escape',
      );
    }
  }
  check(sparked, 'hazard publish', 'the live puddle never sparked');
}

// ── 7. Guard tentacles come up through the grates ────────────────────────────

/** Tiles between a drain and the crawler in the snap probe: past the clearance the grate keeps. */
const SNAP_PROBE_CRAWLER_TILES = 4;

for (const side of DOOR_SIDES) {
  const scope = `drain snap (${side} door)`;
  const lab = buildLab(side);
  const { env, room } = lab;
  const boss = new KrakarenClone(env.room.spawn.x, env.room.spawn.y, TILE_SIZE);
  env.frame.roster.add(boss);
  const drain = room.layout.drains[0];
  // A crawler well clear of the grate, and a tentacle surfacing one tile off it.
  env.frame.human.x = (drain.x + SNAP_PROBE_CRAWLER_TILES) * TILE_SIZE;
  env.frame.human.y = drain.y * TILE_SIZE;
  env.frame.cat.hp = 0;
  const beside = [
    { x: drain.x + 1, y: drain.y },
    { x: drain.x - 1, y: drain.y },
    { x: drain.x, y: drain.y + 1 },
    { x: drain.x, y: drain.y - 1 },
  ].find((t) => env.gameMap.isWalkable(t.x, t.y));
  if (beside === undefined) {
    check(false, scope, `drain ${drain.x},${drain.y} has no walkable neighbour to test from`);
    continue;
  }
  const near = new KrakarenTentacle(beside.x, beside.y, TILE_SIZE, boss);
  env.frame.roster.add(near);
  room.update(env.frame);
  const snapped = near.x === drain.x * TILE_SIZE && near.y === drain.y * TILE_SIZE;
  check(
    snapped && near.emergesThroughDrain,
    scope,
    'a tentacle surfacing beside a grate did not come up through it',
  );
  const found = env.frame.roster.grid.queryCircle(near.x, near.y, HALF_TILE);
  check(found.has(near), scope, 'the snapped tentacle was not re-bucketed in the mob grid');

  // The same, with a crawler standing on the grate: it must stay where she put it.
  const lab2 = buildLab(side);
  const boss2 = new KrakarenClone(lab2.env.room.spawn.x, lab2.env.room.spawn.y, TILE_SIZE);
  lab2.env.frame.roster.add(boss2);
  lab2.env.frame.human.x = drain.x * TILE_SIZE;
  lab2.env.frame.human.y = drain.y * TILE_SIZE;
  lab2.env.frame.cat.hp = 0;
  const crowded = new KrakarenTentacle(beside.x, beside.y, TILE_SIZE, boss2);
  lab2.env.frame.roster.add(crowded);
  lab2.room.update(lab2.env.frame);
  check(
    !crowded.emergesThroughDrain && crowded.x === beside.x * TILE_SIZE,
    scope,
    'a grate under a crawler still pulled a tentacle onto them',
  );
}

// ── 8. The bed's chunk re-bakes as cheaply as any other ─────────────────────

/**
 * How much dearer the chunk under her vat bed may be to re-bake than an
 * ordinary chunk of the lab. Every burst floods tiles in that chunk, and the
 * cache re-bakes an invalidated chunk inside the next frame, so a dear bed is a
 * hitch on every burst. A ratio rather than milliseconds, so the gate means the
 * same thing on any machine.
 */
const MAX_BED_CHUNK_REBAKE_RATIO = 2.5;
const REBAKE_SAMPLES = 15;

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const side of DOOR_SIDES) {
  const scope = `bed re-bake (${side} door)`;
  const lab = buildLab(side);
  const { env, room } = lab;
  // Everything the floor load paints ahead of need, as the game would have by the fight.
  for (let f = 0; f < PREWARM_SETTLE_FRAMES; f++) room.update(env.frame);
  const view = roomView(env.room);
  setViewportSize(view.widthPx, view.heightPx);
  useFloorTheme(env.levelDef);
  const ctx = asGameContext(createCanvas(view.widthPx, view.heightPx).getContext('2d'));
  const bake = (): void =>
    env.gameMap.renderCanvas(ctx, view.camX, view.camY, view.widthPx, view.heightPx);
  bake();
  const chunkOf = (t: TilePoint): string =>
    `${Math.floor(t.x / CHUNK_TILES)},${Math.floor(t.y / CHUNK_TILES)}`;
  const centre = room.layout.centre;
  const bedChunks = new Set<string>();
  for (let dy = -BED_PAINT_REACH; dy <= BED_PAINT_REACH; dy++) {
    for (let dx = -BED_PAINT_REACH; dx <= BED_PAINT_REACH; dx++) {
      bedChunks.add(chunkOf({ x: centre.x + dx, y: centre.y + dy }));
    }
  }
  // An ordinary chunk: one holding lab floor but none of the bed, or failing
  // that — a lab whose every chunk holds part of the bed — the nearest chunk
  // beyond the bed's.
  const b = env.room.bounds;
  const margin = CHUNK_TILES;
  const candidates: TilePoint[] = [];
  for (let y = b.y - margin; y < b.y + b.h + margin; y++) {
    for (let x = b.x - margin; x < b.x + b.w + margin; x++) candidates.push({ x, y });
  }
  const inLab = (t: TilePoint): boolean =>
    t.x >= b.x && t.y >= b.y && t.x < b.x + b.w && t.y < b.y + b.h;
  const outsideBed = candidates.filter((t) => !bedChunks.has(chunkOf(t)));
  const ordinary = outsideBed.find(inLab) ?? firstOf(outsideBed);
  if (ordinary === undefined) {
    check(false, scope, 'no chunk near the lab is free of the bed — nothing to compare');
    continue;
  }
  // Each timing looks at the one chunk under test, so the chunk is on screen
  // and nothing else is re-baked beside it.
  const chunkPx = CHUNK_TILES * TILE_SIZE;
  const timeRebake = (t: TilePoint): number => {
    const camX = Math.floor(t.x / CHUNK_TILES) * chunkPx;
    const camY = Math.floor(t.y / CHUNK_TILES) * chunkPx;
    setViewportSize(chunkPx, chunkPx);
    const bakeChunk = (): void => env.gameMap.renderCanvas(ctx, camX, camY, chunkPx, chunkPx);
    bakeChunk();
    const samples: number[] = [];
    for (let i = 0; i < REBAKE_SAMPLES; i++) {
      env.gameMap.markTileDirty(t.x, t.y);
      const start = performance.now();
      bakeChunk();
      samples.push(performance.now() - start);
    }
    return medianOf(samples);
  };
  const bedMs = timeRebake(centre);
  const ordinaryMs = timeRebake(ordinary);
  const ratio = bedMs / ordinaryMs;
  check(
    ratio <= MAX_BED_CHUNK_REBAKE_RATIO,
    scope,
    `the bed's chunk re-bakes in ${bedMs.toFixed(2)} ms, ${ratio.toFixed(1)}x an ordinary chunk's ${ordinaryMs.toFixed(2)} ms`,
  );
  note(
    scope,
    `bed chunk ${bedMs.toFixed(2)} ms vs ordinary ${ordinaryMs.toFixed(2)} ms (${ratio.toFixed(2)}x)`,
  );
}

// ── 9. Not easier than the stone room ────────────────────────────────────────

const runs: FightMetrics[] = [];
for (const side of DOOR_SIDES) {
  for (const seed of SIM_SEEDS) runs.push(runKrakarenFight({ seed, side }));
}
const after = summarise(runs);
const baselineScale = fault === 'easier' ? EASIER_FAULT_SCALE : 1;
const floor = (baseline: number): number => baseline * baselineScale * (1 - EASIER_TOLERANCE);
check(after.killed === after.fights, 'fight sim', `${after.fights - after.killed} fights stalled`);
check(
  after.timeToKillSeconds >= floor(BASELINE_TIME_TO_KILL_SECONDS),
  'fight sim',
  `time-to-kill ${after.timeToKillSeconds.toFixed(1)} s vs baseline ${BASELINE_TIME_TO_KILL_SECONDS} s`,
);
check(
  after.attacksPerMinute >= floor(BASELINE_ATTACKS_PER_MINUTE),
  'fight sim',
  `${after.attacksPerMinute.toFixed(1)} attacks/min vs baseline ${BASELINE_ATTACKS_PER_MINUTE}`,
);
check(
  after.hitsOnCrawler >= floor(BASELINE_HITS_ON_CRAWLER),
  'fight sim',
  `${after.hitsOnCrawler.toFixed(1)} hits on the crawler vs baseline ${BASELINE_HITS_ON_CRAWLER}`,
);
note(
  'fight sim',
  `ttk ${after.timeToKillSeconds.toFixed(1)} s (base ${BASELINE_TIME_TO_KILL_SECONDS}), ` +
    `${after.attacksPerMinute.toFixed(1)} attacks/min (base ${BASELINE_ATTACKS_PER_MINUTE}), ` +
    `${after.hitsOnCrawler.toFixed(1)} hits (base ${BASELINE_HITS_ON_CRAWLER}), ` +
    `${after.hazardHits.toFixed(1)} room hazard hits, ${after.slamKills.toFixed(2)} slam kills, ` +
    `${(after.wadeShare * PERCENT).toFixed(0)}% of the fight wading`,
);

if (fault !== undefined) console.log(`fault '${fault}' injected`);
if (failures > 0) {
  console.log(`\n${failures} krakaren room gate(s) failed`);
  process.exit(1);
}
console.log('\nkrakaren room gates: all green');
