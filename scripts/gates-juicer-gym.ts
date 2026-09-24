#!/usr/bin/env tsx
/**
 * The Juicer's gym, fought: headless gates for what the room does to the fight.
 *
 * 1. **Not easier.** The fight sim (`bossRooms/juicerFightSim.ts`) runs the real
 *    boss, the real gym and the real boss-room seal against a scripted melee
 *    crawler on all four doorway sides, and every rate is held against the
 *    baseline measured on the gym as it stood before it had any equipment.
 *    A move of more than ten per cent toward "easier" fails.
 * 2. **Reload loop.** From anywhere in the room, empty-handed, he reaches a
 *    rack and takes a dumbbell inside {@link RELOAD_LOOP_MAX_SECONDS}.
 * 3. **Plate roll.** The lane is fixed when the wind-up starts and the plate
 *    runs exactly along it; the lane is down for at least the locked-telegraph
 *    minimum before the plate moves; a crawler who starts walking square off
 *    the lane at the first chalk mark is never hit, even with a belt shoving
 *    her back the whole way — and one who stands still is.
 * 4. **Bounce.** A dumbbell thrown at gym equipment comes back off it and never
 *    enters the tile.
 * 5. **Interactables.** Punching a console shuts its belt off; three hits
 *    break the boombox and change his taunts; chalk puffs stay under their cap.
 * 6. **Checkpoints.** A snapshot restores exactly, survives JSON and the save
 *    parser, an aborted fight puts the room back as it was before the seal, and
 *    a repeated kill changes nothing.
 *
 * `--fault=<name>` breaks one promise at runtime to watch its gate go red.
 *
 * Run: npm run gates:juicer-gym
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import { isRecord } from '../src/core/guards.js';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants.js';
import {
  Juicer,
  PLATE_ROLL_ATTACK_TYPE,
  PLATE_ROLL_HIT_RADIUS_TILES,
  PLATE_ROLL_SPEED,
} from '../src/creatures/Juicer.js';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import { GYM_CABLE_STACK, GYM_SQUAT_RACK } from '../src/map/tileTypes.js';
import { applyMovement } from '../src/systems/GameLoopPhases.js';
import {
  BOOMBOX_HP,
  CHALK_PUFF_CAP,
  TREADMILL_PUSH_PX_PER_FRAME,
  type JuicerRoomSystem,
} from '../src/systems/JuicerRoomSystem.js';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop.js';
import { parseJuicerRoomCheckpoint } from '../src/systems/bossRooms/juicerRoomCheckpoint.js';
import type { DoorSide } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  buildEnvironment,
  gameGauntletDressings,
  type RoomEnvironment,
} from './bossRooms/harness.js';
import { findJuicerFloor, runJuicerFightSuite } from './bossRooms/juicerFightSim.js';
import { stagePlateRoll } from './bossRooms/juicerScenario.js';

installCanvasGlobals();
// Seeded, so a dodge roll cannot turn a gate green one run and red the next.
const GATE_RANDOM_SEED = 1;
Math.random = mulberry32(GATE_RANDOM_SEED);

// ── Baseline ─────────────────────────────────────────────────────────────────

/**
 * The fight sim's numbers on the gym before its equipment went in: a bare
 * rubber floor with four loose dumbbells, two benches and two treadmill
 * pickups, all walkable. Pooled over six fights on each of the four doorway
 * sides, the scripted crawler's reactions spread from perfect to slow.
 */
/** Mean seconds from the seal to his death. Shorter is easier. */
const BASELINE_TIME_TO_KILL_SECONDS = 24.62;
/** Dumbbells thrown per minute of fight. Fewer is easier. */
const BASELINE_THROWS_PER_MINUTE = 6.3;
/** Throws, punches and plate rolls started per minute. Fewer is easier. */
const BASELINE_ATTACKS_PER_MINUTE = 16.66;
/** Blows that took HP off the crawler, per minute. Fewer is easier. */
const BASELINE_HITS_PER_MINUTE = 8.43;
/** Seconds per minute he wanted to travel and did not get half a tile. More is easier. */
const BASELINE_STUCK_SECONDS_PER_MINUTE = 1.52;
/** The most any rate may move toward "easier". */
const EASIER_TOLERANCE = 0.1;

/** The longest a reload may take from anywhere in the room. */
const RELOAD_LOOP_MAX_SECONDS = 6;
const FRAMES_PER_SECOND = 60;
/** Reload start points: every this many tiles across the room's open floor. */
const RELOAD_SAMPLE_STRIDE_TILES = 4;
/** Starts nearer the waiting crawler than this are a punch, not a reload, in tiles. */
const RELOAD_MIN_START_DISTANCE_TILES = 3;

/** How much harder the fault's crawler hits, enough to halve the fight. */
const SOFT_CRAWLER_DAMAGE_MULTIPLIER = 3;

const SIDES: readonly DoorSide[] = ['south', 'north', 'east', 'west'];

// ── Faults ───────────────────────────────────────────────────────────────────

const FAULTS = {
  'soft-crawler': 'the sim crawler hits three times as hard (gate 1: time to kill)',
  'lane-drift': 'the plate lane is nudged sideways mid-roll (gate 3: lane lock)',
  'no-escape': 'the escaping crawler stands still (gate 3: escape)',
  'bounce-through': 'the bounce test aims at open floor, not equipment (gate 4)',
  'restore-drops': 'a restore forgets the boombox (gate 6)',
  'abort-keeps-plates': 'an aborted fight leaves the squat racks stripped (gate 6)',
  'plate-outlives-him': 'his plate and lane survive his death (gate 3b)',
} as const;
type Fault = keyof typeof FAULTS;
const isFault = (name: string): name is Fault => Object.keys(FAULTS).includes(name);
const faultArg = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);
if (faultArg !== undefined && !isFault(faultArg)) {
  console.error(`unknown fault ${faultArg}; known: ${Object.keys(FAULTS).join(', ')}`);
  process.exit(1);
}
const fault: Fault | null = faultArg !== undefined && isFault(faultArg) ? faultArg : null;

const failures: string[] = [];
let checks = 0;
function check(condition: boolean, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}
const note = (message: string): void => console.log(`  ${message}`);

function gymOn(side: DoorSide): { env: RoomEnvironment; gym: JuicerRoomSystem } {
  const env = buildEnvironment(findJuicerFloor(1, side));
  const gym = gameGauntletDressings(env).juicer;
  return { env, gym };
}

// ── 1. Not easier ────────────────────────────────────────────────────────────

console.log('1. fight sim against the baseline');
{
  const suite = runJuicerFightSuite(SIDES, {
    crawlerDamageMultiplier: fault === 'soft-crawler' ? SOFT_CRAWLER_DAMAGE_MULTIPLIER : 1,
  });
  note(
    `ttk ${suite.meanTimeToKillSeconds.toFixed(2)}s (base ${BASELINE_TIME_TO_KILL_SECONDS}), ` +
      `throws/min ${suite.throwsPerMinute.toFixed(2)} (base ${BASELINE_THROWS_PER_MINUTE}), ` +
      `attacks/min ${suite.attacksPerMinute.toFixed(2)} (base ${BASELINE_ATTACKS_PER_MINUTE}), ` +
      `hits/min ${suite.hitsPerMinute.toFixed(2)} (base ${BASELINE_HITS_PER_MINUTE}), ` +
      `stuck s/min ${suite.stuckSecondsPerMinute.toFixed(2)} (base ${BASELINE_STUCK_SECONDS_PER_MINUTE}), ` +
      `reload mean ${suite.meanReloadSeconds.toFixed(2)}s max ${suite.maxReloadSeconds.toFixed(2)}s, ` +
      `plate rolls ${suite.plateRolls}, room hazard hits ${suite.roomHazardHits}`,
  );
  check(
    suite.killRate === 1,
    `the crawler failed to kill him in ${suite.fights.filter((f) => !f.killed).length} fights`,
  );
  const floor = 1 - EASIER_TOLERANCE;
  check(
    suite.meanTimeToKillSeconds >= BASELINE_TIME_TO_KILL_SECONDS * floor,
    `he dies ${suite.meanTimeToKillSeconds.toFixed(2)}s in, over 10% faster than ${BASELINE_TIME_TO_KILL_SECONDS}s`,
  );
  check(
    suite.throwsPerMinute >= BASELINE_THROWS_PER_MINUTE * floor,
    `he throws ${suite.throwsPerMinute.toFixed(2)}/min, over 10% under ${BASELINE_THROWS_PER_MINUTE}`,
  );
  check(
    suite.attacksPerMinute >= BASELINE_ATTACKS_PER_MINUTE * floor,
    `he attacks ${suite.attacksPerMinute.toFixed(2)}/min, over 10% under ${BASELINE_ATTACKS_PER_MINUTE}`,
  );
  check(
    suite.hitsPerMinute >= BASELINE_HITS_PER_MINUTE * floor,
    `he lands ${suite.hitsPerMinute.toFixed(2)} hits/min, over 10% under ${BASELINE_HITS_PER_MINUTE}`,
  );
  check(
    suite.stuckSecondsPerMinute <= BASELINE_STUCK_SECONDS_PER_MINUTE * (1 + EASIER_TOLERANCE),
    `he is stuck ${suite.stuckSecondsPerMinute.toFixed(2)} s/min, over ${BASELINE_STUCK_SECONDS_PER_MINUTE}`,
  );
  check(
    suite.maxReloadSeconds <= RELOAD_LOOP_MAX_SECONDS,
    `a reload in the fights took ${suite.maxReloadSeconds.toFixed(2)}s, over ${RELOAD_LOOP_MAX_SECONDS}s`,
  );
  check(
    suite.roomHazardHits === 0,
    'the room itself damaged the crawler; nothing in the gym should',
  );
}

// ── 2. Reload loop ───────────────────────────────────────────────────────────

console.log('2. reload loop from anywhere in the room');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const { bounds } = env.room;
  // The crawler waits on the platform, in his sight from anywhere in the room,
  // as she would be once the seal forces him to fight.
  const post = env.room.spawn;
  let worstFrames = 0;
  let samples = 0;
  for (let y = bounds.y + 1; y < bounds.y + bounds.h; y += RELOAD_SAMPLE_STRIDE_TILES) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w; x += RELOAD_SAMPLE_STRIDE_TILES) {
      if (!env.gameMap.isWalkable(x, y)) continue;
      if (Math.hypot(x - post.x, y - post.y) < RELOAD_MIN_START_DISTANCE_TILES) continue;
      const juicer = new Juicer(x, y, TILE_SIZE);
      juicer.setMap(env.gameMap);
      juicer.forceAggro = true;
      env.frame.roster.replaceAll([juicer]);
      env.frame.human.x = post.x * TILE_SIZE;
      env.frame.human.y = post.y * TILE_SIZE;
      // Healed between starts: the last start's throws must not have killed her.
      env.frame.human.hp = env.frame.human.maxHp;
      const loop = new MobUpdateLoop();
      let frames = 0;
      const limit = RELOAD_LOOP_MAX_SECONDS * FRAMES_PER_SECOND * 2;
      while (!juicer.heldDumbbell && frames < limit) {
        gym.update(env.frame);
        loop.update(env.frame);
        frames++;
        env.frame.human.hp = env.frame.human.maxHp;
      }
      samples++;
      worstFrames = Math.max(worstFrames, frames);
      check(
        juicer.heldDumbbell && frames <= RELOAD_LOOP_MAX_SECONDS * FRAMES_PER_SECOND,
        `door ${side}: from ${x},${y} he took ${(frames / FRAMES_PER_SECOND).toFixed(1)}s to reach a rack`,
      );
    }
  }
  note(
    `door ${side}: ${samples} starts, slowest reload ${(worstFrames / FRAMES_PER_SECOND).toFixed(2)}s`,
  );
}

// ── 3. Plate roll ────────────────────────────────────────────────────────────

console.log('3. plate roll: locked lane, telegraph, escape at walk speed from a belt');
const PLATE_MAX_FRAMES = 400;
/** A crawler stepping off a lane counts as clear this far outside the plate's reach, in px. */
const LANE_TOLERANCE_PX = 1;
for (const side of SIDES) {
  for (const escaping of [true, false]) {
    const { env, gym } = gymOn(side);
    const staged = stagePlateRoll(gym, env.frame);
    check(staged !== null, `door ${side}: could not stage a plate roll`);
    if (staged === null) continue;
    const { juicer } = staged;
    const crawler = env.frame.human;
    const lockedLane = juicer.plateRollLane?.map((point) => ({ x: point.x, y: point.y })) ?? [];
    check(lockedLane.length >= 2, `door ${side}: the plate roll drew no lane`);
    // The crawler starts where the lane is aimed: the worst place to be when
    // the chalk goes down.
    crawler.hp = crawler.maxHp;
    let hit = false;
    let lastPlate: { x: number; y: number } | null = null;
    let framesBeforeRoll = 0;
    let rolled = false;
    let laneHeld = true;
    let offLane = false;
    for (let frame = 0; frame < PLATE_MAX_FRAMES; frame++) {
      gym.update(env.frame);
      // Kept empty-handed, so the only blow he can land is the plate.
      juicer.heldDumbbell = false;
      juicer.nearestDumbbellPos = null;
      juicer.updateAI([crawler]);
      if (fault === 'lane-drift' && juicer.bowledPlate !== null) {
        const lane = juicer.plateRollLane;
        if (lane !== null)
          Reflect.set(
            juicer,
            'plateLane',
            lane.map((p) => ({ x: p.x + 1, y: p.y })),
          );
      }
      const plate = juicer.bowledPlate;
      if (plate === null && !rolled) framesBeforeRoll++;
      if (plate !== null) {
        rolled = true;
        offLane = offLane || distanceToPolyline(plate, lockedLane) > LANE_TOLERANCE_PX;
      }
      const lane = juicer.plateRollLane;
      if (lane !== null && !samePolyline(lane, lockedLane)) laneHeld = false;
      if (escaping && fault !== 'no-escape') {
        // Off the lane the way a companion steps off it, at the worst pace the
        // room allows: walking straight into a belt's push.
        const escape = gym.getHazardEscapeVector(
          crawler.x + TILE_SIZE / 2,
          crawler.y + TILE_SIZE / 2,
        );
        if (escape !== null) {
          applyMovement(crawler, { dx: escape.dx, dy: escape.dy, isMobile: true }, env.gameMap);
          crawler.x -= escape.dx * TREADMILL_PUSH_PX_PER_FRAME;
          crawler.y -= escape.dy * TREADMILL_PUSH_PX_PER_FRAME;
        }
      }
      const plateHit =
        crawler.hp < crawler.maxHp &&
        crawler.lastDamageSource?.kind === 'mob' &&
        crawler.lastDamageSource.attackType === PLATE_ROLL_ATTACK_TYPE;
      if (plateHit) hit = true;
      // Measured as the plate's nearest pass as well as by HP, so a lucky dodge
      // roll cannot pass for a clean escape, nor hide a plate that ran her over.
      // A plate that stops right beside her stopped on her, dodged or not.
      const lastSeen = plate ?? lastPlate;
      if (lastSeen !== null) {
        const pass = Math.hypot(
          lastSeen.x - (crawler.x + TILE_SIZE / 2),
          lastSeen.y - (crawler.y + TILE_SIZE / 2),
        );
        const reach =
          TILE_SIZE * PLATE_ROLL_HIT_RADIUS_TILES + (plate === null ? PLATE_ROLL_SPEED : 0);
        if (pass < reach) hit = true;
      }
      lastPlate = plate === null ? null : { x: plate.x, y: plate.y };
      crawler.hp = crawler.maxHp;
      if (rolled && juicer.bowledPlate === null) break;
    }
    if (escaping) {
      check(laneHeld, `door ${side}: the plate lane changed after the wind-up began`);
      check(!offLane, `door ${side}: the plate left its chalk lane`);
      check(
        staged.framesToStart >= 0 && framesBeforeRoll >= LOCKED_TELEGRAPH_MIN_FRAMES,
        `door ${side}: the lane was down only ${framesBeforeRoll} frames before the plate moved`,
      );
      check(!hit, `door ${side}: a crawler walking off the lane at the first chalk was still hit`);
      note(`door ${side}: lane down ${framesBeforeRoll} frames before the roll; walked clear`);
    } else {
      check(
        hit,
        `door ${side}: a crawler standing in the lane was not hit — the escape gate proves nothing`,
      );
    }
  }
}

function distanceToPolyline(
  point: { x: number; y: number },
  line: ReadonlyArray<{ x: number; y: number }>,
): number {
  let best = Infinity;
  for (let index = 0; index + 1 < line.length; index++) {
    const a = line[index];
    const b = line[index + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq));
    best = Math.min(best, Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t)));
  }
  return best;
}

function samePolyline(
  a: ReadonlyArray<{ x: number; y: number }>,
  b: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
  );
}

console.log('3b. killing him mid-roll clears the plate, the lane and its hazard ground');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const staged = stagePlateRoll(gym, env.frame);
  if (staged === null) continue;
  const { juicer } = staged;
  const crawler = env.frame.human;
  for (let frame = 0; frame < PLATE_MAX_FRAMES && juicer.bowledPlate === null; frame++) {
    gym.update(env.frame);
    juicer.heldDumbbell = false;
    juicer.updateAI([crawler]);
  }
  const lane = juicer.plateRollLane;
  check(
    juicer.bowledPlate !== null && lane !== null,
    `door ${side}: no plate in flight to kill him under`,
  );
  if (lane === null) continue;
  if (fault === 'plate-outlives-him') {
    Reflect.defineProperty(juicer, 'plateRollLane', { get: () => lane });
  }
  juicer.takeDamageFrom(juicer.hp, crawler, 'melee');
  gym.update(env.frame);
  gym.onBossDefeated();
  gym.update(env.frame);
  const probe = lane[Math.floor(lane.length / 2)];
  check(!juicer.isAlive, `door ${side}: the lethal blow did not kill him`);
  check(
    juicer.bowledPlate === null,
    `door ${side}: his plate is still on the floor after his death`,
  );
  check(juicer.plateRollLane === null, `door ${side}: his chalk lane outlives him`);
  check(
    gym.getHazardEscapeVector(probe.x, probe.y) === null,
    `door ${side}: his dead lane is still published as hazard ground`,
  );
}

// ── 4. Bounce ────────────────────────────────────────────────────────────────

console.log('4. dumbbells bounce off equipment');
/** A thrown dumbbell's speed, px per frame, for the bounce probe. */
const PROBE_SPEED = 7;
const PROBE_FRAMES = 60;
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const layout = gym.layout;
  if (layout === null) continue;
  for (const tile of [...layout.squatRacks, ...layout.cableStacks, ...layout.racks]) {
    const juicer = new Juicer(layout.spawn.x, layout.spawn.y, TILE_SIZE);
    juicer.setMap(env.gameMap);
    const target = fault === 'bounce-through' ? layout.spawn : tile;
    const tx = (target.x + 1 / 2) * TILE_SIZE;
    const ty = (target.y + 1 / 2) * TILE_SIZE;
    const sx = (layout.spawn.x + 1 / 2) * TILE_SIZE;
    const sy = (layout.spawn.y + 1 / 2) * TILE_SIZE;
    const length = Math.hypot(tx - sx, ty - sy) || 1;
    Reflect.set(juicer, 'activeThrow', {
      x: sx,
      y: sy,
      vx: ((tx - sx) / length) * PROBE_SPEED,
      vy: ((ty - sy) / length) * PROBE_SPEED,
      ttl: PROBE_FRAMES,
      age: 0,
    });
    let entered = false;
    let bounced = false;
    for (let frame = 0; frame < PROBE_FRAMES; frame++) {
      const flying = juicer.thrownDumbbell;
      const before = flying === null ? null : { vx: flying.vx, vy: flying.vy };
      juicer.updateAI([]);
      const after = juicer.thrownDumbbell;
      if (after === null) break;
      if (before !== null && Math.sign(before.vx * after.vx + before.vy * after.vy) < 0)
        bounced = true;
      if (
        !env.gameMap.isWalkable(Math.floor(after.x / TILE_SIZE), Math.floor(after.y / TILE_SIZE))
      ) {
        entered = true;
      }
    }
    const type = env.gameMap.structure[tile.y][tile.x].type;
    const tall = type === GYM_SQUAT_RACK || type === GYM_CABLE_STACK;
    check(!entered, `door ${side}: a dumbbell flew into the equipment at ${tile.x},${tile.y}`);
    check(
      bounced,
      `door ${side}: a dumbbell thrown at ${tall ? 'tall ' : ''}kit at ${tile.x},${tile.y} did not bounce`,
    );
  }
}

// ── 5. Interactables ─────────────────────────────────────────────────────────

console.log('5. console, boombox, chalk');
{
  const { env, gym } = gymOn('south');
  const layout = gym.layout;
  const human = env.frame.human;
  if (layout !== null) {
    gym.onSeal();
    const juicer = new Juicer(layout.spawn.x, layout.spawn.y, TILE_SIZE);
    juicer.setMap(env.gameMap);
    env.frame.roster.add(juicer);
    const swingAt = (tile: { x: number; y: number }, towardX: number, towardY: number): void => {
      human.x = (tile.x + towardX) * TILE_SIZE;
      human.y = (tile.y + towardY) * TILE_SIZE;
      human.facingX = -towardX;
      human.facingY = -towardY;
      human.triggerAttack();
      for (let frame = 0; frame < FRAMES_PER_SECOND; frame++) {
        human.updateAttack();
        gym.update(env.frame);
      }
    };
    check(layout.treadmills.length > 0, 'no treadmill to test a console on');
    if (layout.treadmills.length > 0) {
      const { console: consoleTile, push } = layout.treadmills[0];
      swingAt(consoleTile, push.dx, push.dy);
      check(gym.isConsoleOff(0), 'a punch at a treadmill console did not shut its belt off');
      check(
        gym.poweredBeltAt(
          (consoleTile.x + 1 / 2) * TILE_SIZE,
          (consoleTile.y + 1 / 2) * TILE_SIZE,
        ) === null,
        'a shut-off belt still counts as powered',
      );
    }
    const boombox = layout.boombox;
    check(boombox !== null, 'the gym has no boombox');
    if (boombox !== null) {
      for (let blow = 0; blow < BOOMBOX_HP; blow++) swingAt(boombox, 1, 0);
      check(gym.boomboxBroken, `${BOOMBOX_HP} blows did not break the boombox`);
      juicer.x = human.x + TILE_SIZE * 2;
      juicer.y = human.y;
      juicer.updateAI([human]);
      check(!juicer.musicPlaying, 'the boombox broke but he still hears his music');
      check(
        juicer.currentTaunt?.includes("CAN'T HEAR") === true,
        `his taunt did not change when the music stopped (got "${juicer.currentTaunt ?? ''}")`,
      );
    }
    check(
      gym.livePuffCount <= CHALK_PUFF_CAP,
      `${gym.livePuffCount} chalk puffs alive, cap ${CHALK_PUFF_CAP}`,
    );
  }
}

// ── 6. Checkpoints ───────────────────────────────────────────────────────────

console.log('6. checkpoint round trip, abort, repeated kill');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const preSeal = JSON.stringify(gym.captureCheckpoint());
  if (fault === 'abort-keeps-plates') {
    const reset = gym.onFightAborted.bind(gym);
    Reflect.set(gym, 'onFightAborted', () => {
      const stripped = gym.captureCheckpoint().squatRackStrippedFrames;
      reset();
      gym.restoreCheckpoint({ ...gym.captureCheckpoint(), squatRackStrippedFrames: stripped });
    });
  }
  gym.onSeal();
  const staged = stagePlateRoll(gym, env.frame);
  if (staged !== null) staged.juicer.hp = 1;
  gym.update(env.frame);
  const human = env.frame.human;
  gym.tryInteract(human);
  const midFight = gym.captureCheckpoint();
  const midJson = JSON.stringify(midFight);
  const parsed = parseJuicerRoomCheckpoint(JSON.parse(midJson));
  check(
    parsed !== undefined && JSON.stringify(parsed) === midJson,
    `door ${side}: the save parser mangles the gym`,
  );
  gym.onFightAborted();
  const aborted = gym.captureCheckpoint();
  // Benches aside: a bench a crawler carried off stays carried off.
  const preSealState: unknown = JSON.parse(preSeal);
  check(
    JSON.stringify({ ...aborted, benches: [] }) ===
      JSON.stringify({ ...(isRecord(preSealState) ? preSealState : {}), benches: [] }),
    `door ${side}: an aborted fight left the room changed`,
  );
  check(
    !aborted.sealed && !aborted.mirrorCracked && aborted.boomboxHp === BOOMBOX_HP,
    `door ${side}: abort did not reset the fight state`,
  );
  gym.restoreCheckpoint(midFight);
  if (fault === 'restore-drops')
    gym.restoreCheckpoint({ ...gym.captureCheckpoint(), boomboxHp: BOOMBOX_HP - 1 });
  check(
    JSON.stringify(gym.captureCheckpoint()) === midJson,
    `door ${side}: a restore does not give back the snapshot`,
  );
  gym.onBossDefeated();
  const once = JSON.stringify(gym.captureCheckpoint());
  gym.onBossDefeated();
  check(
    JSON.stringify(gym.captureCheckpoint()) === once,
    `door ${side}: a repeated kill changed the room`,
  );
  check(!gym.beltsLive, `door ${side}: the belts still run after the kill`);
}

// ── Verdict ──────────────────────────────────────────────────────────────────

console.log(
  `\n${checks} checks, walk speed ${PLAYER_SPEED}, plate reach ${PLATE_ROLL_HIT_RADIUS_TILES} tiles`,
);
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}
if (fault !== null) {
  console.log(
    `FAIL: --fault=${fault} (${FAULTS[fault]}) broke what it guards and every gate passed`,
  );
  process.exit(1);
}
console.log('PASS');
