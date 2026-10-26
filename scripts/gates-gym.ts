#!/usr/bin/env tsx
/**
 * Big Rooster's gym, fought: headless gates for what the room does to the fight.
 *
 * 1. **The room in a fight.** The fight sim (`bossRooms/gymFightSim.ts`) runs
 *    the real boss, the real gym and the real boss-room seal against a
 *    scripted melee crawler on all four doorway sides. Every fight ends, in
 *    his death, before the sim's time cap; his equipment never leaves him stuck
 *    for more than {@link MAX_STUCK_SECONDS_PER_MINUTE} a minute; no reload
 *    takes longer than {@link RELOAD_LOOP_MAX_SECONDS}; and nothing in the room
 *    ever hurts the crawler.
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
 * 7. **Close crawler.** A crawler inside club reach is swung at with the
 *    dumbbell and never thrown at.
 * 8. **Far crawler.** A crawler in the throw band is thrown at, and he still
 *    reaches a rack to reload afterwards.
 * 9. **Minions.** Little Rooster and Slightly Bent Rooster, posted clear of
 *    the loaded racks with a crawler beside them, never come within pickup
 *    range of a rack and never slam: every blow they land is a peck or a punch.
 *
 * `--fault=<name>` breaks one promise at runtime to watch its gate go red.
 *
 * Run: npm run gates:gym
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import { isRecord } from '../src/core/util/guards.js';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants.js';
import {
  BigRooster,
  CLUB_ATTACK_TYPE,
  CLUB_REACH_TILES,
  DUMBBELL_PICKUP_RANGE_TILES,
  PLATE_ROLL_ATTACK_TYPE,
  PLATE_ROLL_HIT_RADIUS_TILES,
  PLATE_ROLL_SPEED,
  THROW_RANGE_MAX_TILES,
  THROW_RANGE_MIN_TILES,
  THROW_SPEED,
} from '../src/creatures/BigRooster.js';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import { BIG_ROOSTER_THROW_RELEASE_FRAME } from '../src/sprites/bigRoosterAttackTiming.js';
import type { Player } from '../src/Player.js';
import { LittleRooster } from '../src/creatures/LittleRooster.js';
import { SlightlyBentRooster } from '../src/creatures/SlightlyBentRooster.js';
import {
  ROOSTER_PECK_ATTACK_TYPE,
  ROOSTER_PUNCH_ATTACK_TYPE,
} from '../src/creatures/roosterStrikes.js';
import { BIG_ROOSTER_LINES } from '../src/dialog/scripts/bigRooster.js';
import { GYM_CABLE_STACK, GYM_SQUAT_RACK } from '../src/map/tileTypes.js';
import { applyMovement } from '../src/systems/GameLoopPhases.js';
import {
  BOOMBOX_HP,
  CHALK_PUFF_CAP,
  TREADMILL_PUSH_PX_PER_FRAME,
  type GymRoomSystem,
} from '../src/systems/GymRoomSystem.js';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop.js';
import { parseGymRoomCheckpoint } from '../src/systems/bossRooms/gymRoomCheckpoint.js';
import type { DoorSide } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  buildEnvironment,
  gameGauntletDressings,
  type RoomEnvironment,
} from './bossRooms/harness.js';
import { findGymFloor, runGymFightSuite } from './bossRooms/gymFightSim.js';
import { stagePlateRoll } from './bossRooms/gymScenario.js';

installCanvasGlobals();
// Seeded, so a dodge roll cannot turn a gate green one run and red the next.
const GATE_RANDOM_SEED = 1;
Math.random = mulberry32(GATE_RANDOM_SEED);

// ── Limits ───────────────────────────────────────────────────────────────────

/**
 * The most seconds per minute of fight he may spend wanting to travel and not
 * getting half a tile: past it, the room's equipment is trapping him rather
 * than giving the crawler cover.
 */
const MAX_STUCK_SECONDS_PER_MINUTE = 1.6;

/** The longest a reload may take from anywhere in the room. */
const RELOAD_LOOP_MAX_SECONDS = 6;
const FRAMES_PER_SECOND = 60;
/** How many reload limits a reload sample is run for before it is called a failure. */
const RELOAD_RUN_HEADROOM = 2;
/** Reload start points: every this many tiles across the room's open floor. */
const RELOAD_SAMPLE_STRIDE_TILES = 4;
/** Starts nearer the waiting crawler than this are a punch, not a reload, in tiles. */
const RELOAD_MIN_START_DISTANCE_TILES = 3;

const SIDES: readonly DoorSide[] = ['south', 'north', 'east', 'west'];

// ── Faults ───────────────────────────────────────────────────────────────────

const FAULTS = {
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

function gymOn(side: DoorSide): { env: RoomEnvironment; gym: GymRoomSystem } {
  const env = buildEnvironment(findGymFloor(1, side));
  const gym = gameGauntletDressings(env).gym;
  return { env, gym };
}

// ── 1. The room in a fight ───────────────────────────────────────────────────

console.log('1. fight sim: kills, stuck time, reloads, room hazards');
{
  const suite = runGymFightSuite(SIDES);
  note(
    `stuck s/min ${suite.stuckSecondsPerMinute.toFixed(2)} (cap ${MAX_STUCK_SECONDS_PER_MINUTE}), ` +
      `longest reload ${suite.maxReloadSeconds.toFixed(2)}s, ` +
      `room hazard hits ${suite.roomHazardHits}`,
  );
  // Every fight ends: a fight still running at the sim's time cap is one the
  // room has broken, with him stuck somewhere the crawler cannot reach.
  check(
    suite.unfinishedFights === 0,
    `${suite.unfinishedFights} fights never ended: he was still standing at the time cap`,
  );
  check(
    suite.stuckSecondsPerMinute <= MAX_STUCK_SECONDS_PER_MINUTE,
    `he is stuck ${suite.stuckSecondsPerMinute.toFixed(2)} s/min, over ${MAX_STUCK_SECONDS_PER_MINUTE}`,
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
  // The cat stays at the door, and nothing heals her. A start beside her opens
  // with a slam and a brawl that lasts until she is down: a fight, not a reload.
  const catTileX = env.frame.cat.x / TILE_SIZE;
  const catTileY = env.frame.cat.y / TILE_SIZE;
  let worstFrames = 0;
  let samples = 0;
  for (let y = bounds.y + 1; y < bounds.y + bounds.h; y += RELOAD_SAMPLE_STRIDE_TILES) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w; x += RELOAD_SAMPLE_STRIDE_TILES) {
      if (!env.gameMap.isWalkable(x, y)) continue;
      if (Math.hypot(x - post.x, y - post.y) < RELOAD_MIN_START_DISTANCE_TILES) continue;
      if (Math.hypot(x - catTileX, y - catTileY) < RELOAD_MIN_START_DISTANCE_TILES) continue;
      const bigRooster = new BigRooster(x, y, TILE_SIZE);
      bigRooster.setMap(env.gameMap);
      bigRooster.forceAggro = true;
      env.frame.roster.replaceAll([bigRooster]);
      env.frame.human.x = post.x * TILE_SIZE;
      env.frame.human.y = post.y * TILE_SIZE;
      // Healed between starts: the last start's throws must not have killed her.
      env.frame.human.hp = env.frame.human.maxHp;
      const loop = new MobUpdateLoop();
      // Counted from the first frame he goes for a rack: the crow he opens a
      // fight with comes before the reload and is no part of it.
      let frames = 0;
      let seeking = false;
      let elapsed = 0;
      const limit = RELOAD_LOOP_MAX_SECONDS * FRAMES_PER_SECOND * RELOAD_RUN_HEADROOM;
      while (!bigRooster.heldDumbbell && elapsed < limit) {
        elapsed++;
        gym.update(env.frame);
        loop.update(env.frame);
        if (bigRooster.behaviour === 'seeking_dumbbell') seeking = true;
        if (seeking) frames++;
        env.frame.human.hp = env.frame.human.maxHp;
      }
      samples++;
      worstFrames = Math.max(worstFrames, frames);
      check(
        bigRooster.heldDumbbell && frames <= RELOAD_LOOP_MAX_SECONDS * FRAMES_PER_SECOND,
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
    const { bigRooster } = staged;
    const crawler = env.frame.human;
    const lockedLane = bigRooster.plateRollLane?.map((point) => ({ x: point.x, y: point.y })) ?? [];
    check(lockedLane.length >= 2, `door ${side}: the plate roll drew no lane`);
    // The crawler starts where the lane is aimed: the worst place to be when
    // the chalk goes down.
    crawler.hp = crawler.maxHp;
    let hit = false;
    let lastPlate: { x: number; y: number } | null = null;
    // Counted from the staging frame, which already put the lane down.
    let framesBeforeRoll = 1;
    let rolled = false;
    let laneHeld = true;
    let offLane = false;
    for (let frame = 0; frame < PLATE_MAX_FRAMES; frame++) {
      gym.update(env.frame);
      // Kept empty-handed, so the only blow he can land is the plate.
      bigRooster.heldDumbbell = false;
      bigRooster.nearestDumbbellPos = null;
      bigRooster.updateAI([crawler]);
      if (fault === 'lane-drift' && bigRooster.bowledPlate !== null) {
        const lane = bigRooster.plateRollLane;
        if (lane !== null)
          Reflect.set(
            bigRooster,
            'plateLane',
            lane.map((p) => ({ x: p.x + 1, y: p.y })),
          );
      }
      const plate = bigRooster.bowledPlate;
      if (plate === null && !rolled) framesBeforeRoll++;
      if (plate !== null) {
        rolled = true;
        offLane = offLane || distanceToPolyline(plate, lockedLane) > LANE_TOLERANCE_PX;
      }
      const lane = bigRooster.plateRollLane;
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
      if (rolled && bigRooster.bowledPlate === null) break;
    }
    if (escaping) {
      check(laneHeld, `door ${side}: the plate lane changed after the wind-up began`);
      check(!offLane, `door ${side}: the plate left its chalk lane`);
      check(
        framesBeforeRoll >= LOCKED_TELEGRAPH_MIN_FRAMES &&
          framesBeforeRoll === BIG_ROOSTER_THROW_RELEASE_FRAME,
        `door ${side}: the lane was down ${framesBeforeRoll} frames before the plate moved, not its release frame's ${BIG_ROOSTER_THROW_RELEASE_FRAME} (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
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
  check(staged !== null, `door ${side}: could not stage a plate roll to kill him under`);
  if (staged === null) continue;
  const { bigRooster } = staged;
  const crawler = env.frame.human;
  for (let frame = 0; frame < PLATE_MAX_FRAMES && bigRooster.bowledPlate === null; frame++) {
    gym.update(env.frame);
    bigRooster.heldDumbbell = false;
    bigRooster.updateAI([crawler]);
  }
  const lane = bigRooster.plateRollLane;
  check(
    bigRooster.bowledPlate !== null && lane !== null,
    `door ${side}: no plate in flight to kill him under`,
  );
  if (lane === null) continue;
  if (fault === 'plate-outlives-him') {
    Reflect.defineProperty(bigRooster, 'plateRollLane', { get: () => lane });
  }
  bigRooster.takeDamageFrom(bigRooster.hp, crawler, 'melee');
  gym.update(env.frame);
  gym.onBossDefeated();
  gym.update(env.frame);
  const probe = lane[Math.floor(lane.length / 2)];
  check(!bigRooster.isAlive, `door ${side}: the lethal blow did not kill him`);
  check(
    bigRooster.bowledPlate === null,
    `door ${side}: his plate is still on the floor after his death`,
  );
  check(bigRooster.plateRollLane === null, `door ${side}: his chalk lane outlives him`);
  check(
    gym.getHazardEscapeVector(probe.x, probe.y) === null,
    `door ${side}: his dead lane is still published as hazard ground`,
  );
}

// ── 4. Bounce ────────────────────────────────────────────────────────────────

console.log('4. dumbbells bounce off equipment');
/**
 * Frames past the aim point a probe keeps flying. A dumbbell thrown at kit
 * bounces on the frame it reaches the kit's edge, before the kit's centre, so
 * a probe that is still unbounced once it has flown that far went through.
 */
const PROBE_MARGIN_FRAMES = 1;
/** The bounce-through fault aims at open floor this many tiles from his spawn. */
const PROBE_FAULT_MIN_TILES = 3;
const PROBE_FAULT_MAX_TILES = 5;
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const layout = gym.layout;
  check(layout !== null, `door ${side}: the gym has no layout`);
  if (layout === null) continue;
  const openFloor = gymTileAtDistance(
    env,
    layout.spawn,
    PROBE_FAULT_MIN_TILES,
    PROBE_FAULT_MAX_TILES,
  );
  for (const tile of [...layout.squatRacks, ...layout.cableStacks, ...layout.racks]) {
    const bigRooster = new BigRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
    bigRooster.setMap(env.gameMap);
    const target = fault === 'bounce-through' && openFloor !== null ? openFloor : tile;
    const tx = (target.x + 1 / 2) * TILE_SIZE;
    const ty = (target.y + 1 / 2) * TILE_SIZE;
    const sx = (layout.spawn.x + 1 / 2) * TILE_SIZE;
    const sy = (layout.spawn.y + 1 / 2) * TILE_SIZE;
    const probeFrames = Math.ceil(Math.hypot(tx - sx, ty - sy) / THROW_SPEED) + PROBE_MARGIN_FRAMES;
    bigRooster.launchDumbbellAt({ x: tx, y: ty });
    let entered = false;
    let bounced = false;
    for (let frame = 0; frame < probeFrames; frame++) {
      const flying = bigRooster.thrownDumbbell;
      const before = flying === null ? null : { vx: flying.vx, vy: flying.vy };
      bigRooster.updateAI([]);
      const after = bigRooster.thrownDumbbell;
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

console.log('5. console, boombox, chalk, benches');
{
  const { env, gym } = gymOn('south');
  const layout = gym.layout;
  const human = env.frame.human;
  check(layout !== null, 'door south: the gym has no layout');
  if (layout !== null) {
    gym.onSeal();
    const bigRooster = new BigRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
    bigRooster.setMap(env.gameMap);
    env.frame.roster.add(bigRooster);
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
      bigRooster.x = human.x + TILE_SIZE * 2;
      bigRooster.y = human.y;
      bigRooster.updateAI([human]);
      check(!bigRooster.musicPlaying, 'the boombox broke but he still hears his music');
      const noMusicTaunts = BIG_ROOSTER_LINES.noMusicTaunts.map((line) => line.paragraphs[0]);
      check(
        noMusicTaunts.some((taunt) => taunt === bigRooster.currentTaunt),
        `his taunt did not change when the music stopped (got "${bigRooster.currentTaunt ?? ''}")`,
      );
    }
    // Every squat rack stripped on consecutive frames asks for more puffs
    // than the cap allows at once.
    for (const squat of layout.squatRacks) {
      bigRooster.plateTakenFrom = {
        x: (squat.x + 1 / 2) * TILE_SIZE,
        y: (squat.y + 1 / 2) * TILE_SIZE,
      };
      gym.update(env.frame);
    }
    check(
      gym.livePuffCount > 0 && gym.livePuffCount <= CHALK_PUFF_CAP,
      `${gym.livePuffCount} chalk puffs alive after stripping every squat rack, cap ${CHALK_PUFF_CAP}`,
    );
    const bench = layout.benches.length > 0 ? layout.benches[0] : undefined;
    check(bench !== undefined, 'the gym has no floor bench');
    if (bench !== undefined) {
      human.x = bench.x * TILE_SIZE;
      human.y = bench.y * TILE_SIZE;
      check(gym.wouldInteract(human), 'standing on a floor bench, a press is not claimed');
      const held = human.inventory.countOf('gym_bench_press');
      const besideBench = (bench.x + 1 + 1 / 2) * TILE_SIZE;
      check(
        !gym.tryPickupBenchAt(besideBench, (bench.y + 1 / 2) * TILE_SIZE, human),
        'a tap beside the floor bench took it',
      );
      check(
        gym.tryPickupBenchAt((bench.x + 1 / 2) * TILE_SIZE, (bench.y + 1 / 2) * TILE_SIZE, human) &&
          human.inventory.countOf('gym_bench_press') === held + 1,
        'a tap on the floor bench in reach did not put it in the bag',
      );
    }
  }
}

// ── 6. Checkpoints ───────────────────────────────────────────────────────────

console.log('6. checkpoint round trip, abort, repeated kill');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const preSeal = JSON.stringify(gym.captureCheckpoint());
  if (fault === 'abort-keeps-plates') {
    const reset = gym.onFightAborted.bind(gym);
    gym.onFightAborted = () => {
      const stripped = gym.captureCheckpoint().squatRackStrippedFrames;
      reset();
      gym.restoreCheckpoint({ ...gym.captureCheckpoint(), squatRackStrippedFrames: stripped });
    };
  }
  gym.onSeal();
  const staged = stagePlateRoll(gym, env.frame);
  if (staged !== null) staged.bigRooster.hp = 1;
  gym.update(env.frame);
  const human = env.frame.human;
  gym.tryInteract(human);
  const midFight = gym.captureCheckpoint();
  const midJson = JSON.stringify(midFight);
  const parsed = parseGymRoomCheckpoint(JSON.parse(midJson));
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

// ── 7. Close crawler ─────────────────────────────────────────────────────────

/** How long each close and far crawler is watched, in seconds. */
const MATCHUP_SECONDS = 10;
const MATCHUP_FRAMES = MATCHUP_SECONDS * FRAMES_PER_SECOND;
/**
 * The close crawler's distance from him, in tiles: inside club reach, and just
 * outside where the slam answers, so the club is the blow that reach invites.
 */
const CLOSE_CRAWLER_SHARE_OF_CLUB_REACH = 0.95;
/** The far crawler stands this many tiles off, inside the throw band. */
const FAR_CRAWLER_MIN_TILES = 5;
const FAR_CRAWLER_MAX_TILES = 8;
/** The most a throw and the walk to a rack after it may take together. */
const THROW_THEN_RELOAD_MAX_SECONDS = MATCHUP_SECONDS;

type TileOffset = { readonly x: number; readonly y: number };

/** A tile in the gym, from `from`, whose distance lies in [min, max] tiles with open floor between. */
function gymTileAtDistance(
  env: RoomEnvironment,
  from: TileOffset,
  minTiles: number,
  maxTiles: number,
): TileOffset | null {
  const { bounds } = env.room;
  const centre = (tileCoord: number): number => (tileCoord + 1 / 2) * TILE_SIZE;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const distance = Math.hypot(x - from.x, y - from.y);
      if (distance < minTiles || distance > maxTiles) continue;
      if (!env.gameMap.isWalkable(x, y)) continue;
      const clear = env.gameMap.hasWalkableLine(
        centre(from.x),
        centre(from.y),
        centre(x),
        centre(y),
      );
      if (clear) return { x, y };
    }
  }
  return null;
}

console.log('7. a crawler inside club reach is swung at, never thrown at');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const layout = gym.layout;
  check(layout !== null, `door ${side}: the gym has no layout`);
  if (layout === null) continue;
  gym.onSeal();
  const bigRooster = new BigRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
  bigRooster.setMap(env.gameMap);
  bigRooster.forceAggro = true;
  bigRooster.heldDumbbell = true;
  env.frame.roster.replaceAll([bigRooster]);
  const crawler = env.frame.human;
  const neighbour = gymTileAtDistance(env, layout.spawn, CLUB_REACH_TILES, CLUB_REACH_TILES);
  check(neighbour !== null, `door ${side}: no open floor at club reach from his spawn`);
  if (neighbour === null) continue;
  const closeShare = CLOSE_CRAWLER_SHARE_OF_CLUB_REACH;
  crawler.x = bigRooster.x + (neighbour.x - layout.spawn.x) * TILE_SIZE * closeShare;
  crawler.y = bigRooster.y + (neighbour.y - layout.spawn.y) * TILE_SIZE * closeShare;
  let swung = false;
  let clubbed = false;
  let thrown = false;
  for (let frame = 0; frame < MATCHUP_FRAMES; frame++) {
    gym.update(env.frame);
    crawler.hp = crawler.maxHp;
    bigRooster.updateAI([crawler]);
    if (bigRooster.behaviour === 'club_windup') swung = true;
    if (bigRooster.behaviour === 'winding_up' || bigRooster.thrownDumbbell !== null) thrown = true;
    const source = crawler.lastDamageSource;
    if (source?.kind === 'mob' && source.attackType === CLUB_ATTACK_TYPE) clubbed = true;
  }
  check(swung && clubbed, `door ${side}: a crawler inside club reach was never clubbed`);
  check(!thrown, `door ${side}: a crawler inside club reach had a dumbbell thrown at her`);
}

// ── 8. Far crawler ───────────────────────────────────────────────────────────

/** Read through a call, so a dumbbell set in his hands by the setup is not taken as fixed. */
function isHolding(bigRooster: BigRooster): boolean {
  return bigRooster.heldDumbbell;
}

console.log('8. a crawler in the throw band is thrown at, and he reloads after');
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const layout = gym.layout;
  check(layout !== null, `door ${side}: the gym has no layout`);
  if (layout === null) continue;
  gym.onSeal();
  const bigRooster = new BigRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
  bigRooster.setMap(env.gameMap);
  bigRooster.forceAggro = true;
  bigRooster.heldDumbbell = true;
  env.frame.roster.replaceAll([bigRooster]);
  const crawler = env.frame.human;
  const post = gymTileAtDistance(env, layout.spawn, FAR_CRAWLER_MIN_TILES, FAR_CRAWLER_MAX_TILES);
  check(post !== null, `door ${side}: no open floor in the throw band with a line to his spawn`);
  if (post === null) continue;
  crawler.x = post.x * TILE_SIZE;
  crawler.y = post.y * TILE_SIZE;
  let threwAt: number | null = null;
  let reloadedAt: number | null = null;
  let threwFromBand = false;
  const limit = THROW_THEN_RELOAD_MAX_SECONDS * FRAMES_PER_SECOND;
  for (let frame = 0; frame < limit && reloadedAt === null; frame++) {
    gym.update(env.frame);
    bigRooster.updateAI([crawler]);
    crawler.hp = crawler.maxHp;
    crawler.x = post.x * TILE_SIZE;
    crawler.y = post.y * TILE_SIZE;
    if (threwAt === null && bigRooster.thrownDumbbell !== null) {
      threwAt = frame;
      const tilesApart = Math.hypot(bigRooster.x - crawler.x, bigRooster.y - crawler.y) / TILE_SIZE;
      threwFromBand = tilesApart >= THROW_RANGE_MIN_TILES && tilesApart <= THROW_RANGE_MAX_TILES;
    }
    if (threwAt !== null && isHolding(bigRooster)) reloadedAt = frame;
  }
  check(
    threwAt !== null && threwFromBand,
    `door ${side}: a crawler in the throw band was never thrown at from the band`,
  );
  check(
    reloadedAt !== null,
    `door ${side}: after throwing he did not reach a rack inside ${THROW_THEN_RELOAD_MAX_SECONDS}s`,
  );
  if (threwAt !== null && reloadedAt !== null) {
    note(
      `door ${side}: threw at ${(threwAt / FRAMES_PER_SECOND).toFixed(2)}s, ` +
        `reloaded at ${(reloadedAt / FRAMES_PER_SECOND).toFixed(2)}s`,
    );
  }
}

// ── 9. Minions ───────────────────────────────────────────────────────────────

console.log('9. the minions never go for a dumbbell and never slam');
/**
 * How far from every loaded rack front the minions are posted, in tiles: far
 * enough that a rooster who walked to a rack would have to leave the crawler
 * standing beside him to do it.
 */
const MINION_RACK_CLEARANCE_TILES = 4;
const UNARMED_ATTACK_TYPES: ReadonlySet<string> = new Set([
  ROOSTER_PECK_ATTACK_TYPE,
  ROOSTER_PUNCH_ATTACK_TYPE,
]);
/** The named attack behind the crawler's last hurt, read fresh so nothing narrows it stale. */
function lastBlowName(crawler: Player): string {
  const source = crawler.lastDamageSource;
  if (source === null) return 'nothing';
  if (source.kind !== 'mob') return source.kind;
  return source.attackType ?? 'an unnamed blow';
}
/** An open gym tile at least {@link MINION_RACK_CLEARANCE_TILES} from every rack front, or null. */
function tileClearOfRacks(
  env: RoomEnvironment,
  rackFronts: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): TileOffset | null {
  const { bounds } = env.room;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!env.gameMap.isWalkable(x, y)) continue;
      const clear = rackFronts.every(
        (front) =>
          Math.hypot(front.x / TILE_SIZE - x, front.y / TILE_SIZE - y) >=
          MINION_RACK_CLEARANCE_TILES,
      );
      if (clear) return { x, y };
    }
  }
  return null;
}
for (const side of SIDES) {
  const { env, gym } = gymOn(side);
  const layout = gym.layout;
  check(layout !== null, `door ${side}: the gym has no layout`);
  if (layout === null) continue;
  gym.onSeal();
  const rackFronts = gym.getActiveDumbbellPositions();
  check(rackFronts.length > 0, `door ${side}: no loaded rack for the minions to ignore`);
  if (rackFronts.length === 0) continue;
  const minionPost = tileClearOfRacks(env, rackFronts);
  check(minionPost !== null, `door ${side}: no open floor clear of the racks for the minions`);
  if (minionPost === null) continue;
  const crawlerPost = gymTileAtDistance(env, minionPost, 1, 1);
  check(crawlerPost !== null, `door ${side}: no open floor beside the minions for the crawler`);
  if (crawlerPost === null) continue;
  const minions = [
    new LittleRooster(minionPost.x, minionPost.y, TILE_SIZE),
    new SlightlyBentRooster(minionPost.x, minionPost.y, TILE_SIZE),
  ];
  for (const minion of minions) {
    minion.setMap(env.gameMap);
    minion.forceAggro = true;
  }
  env.frame.roster.replaceAll(minions);
  const crawler = env.frame.human;
  const pickupRangePx = TILE_SIZE * DUMBBELL_PICKUP_RANGE_TILES;
  let blows = 0;
  let nearestRackApproachPx = Infinity;
  const wrongBlows = new Set<string>();
  for (let frame = 0; frame < MATCHUP_FRAMES; frame++) {
    crawler.x = crawlerPost.x * TILE_SIZE;
    crawler.y = crawlerPost.y * TILE_SIZE;
    crawler.lastDamageSource = null;
    const hpBefore = crawler.hp;
    gym.update(env.frame);
    for (const minion of minions) {
      minion.updateAI([crawler]);
      for (const front of rackFronts) {
        const apart = Math.hypot(front.x - minion.x, front.y - minion.y);
        nearestRackApproachPx = Math.min(nearestRackApproachPx, apart);
      }
    }
    if (crawler.hp < hpBefore) {
      blows++;
      const attackType = lastBlowName(crawler);
      if (!UNARMED_ATTACK_TYPES.has(attackType)) wrongBlows.add(attackType);
    }
    crawler.hp = crawler.maxHp;
  }
  check(blows > 0, `door ${side}: the minions never landed a blow, so the check proves nothing`);
  check(
    wrongBlows.size === 0,
    `door ${side}: a minion landed a blow that is not a peck or a punch: ${[...wrongBlows].join(', ')}`,
  );
  check(
    nearestRackApproachPx >= pickupRangePx,
    `door ${side}: a minion came within ${(nearestRackApproachPx / TILE_SIZE).toFixed(2)} tiles ` +
      `of a rack front, inside the ${DUMBBELL_PICKUP_RANGE_TILES}-tile pickup range`,
  );
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
