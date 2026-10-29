/**
 * Behaviour checks for the rules of Big Rooster's later fight, run on the real
 * gym of every floor the sweep generates:
 *
 * - the gym is planned with its kettlebell racks and exercise balls;
 * - a kettlebell never hurts Big Rooster or his flock, and does hurt the
 *   crawler it lands on;
 * - however thick the rain, the crawler always has a tile near them that no
 *   shadow covers;
 * - his fury makes him untouchable until every exercise ball is rolling, and
 *   no longer;
 * - after his death neither a rolling ball nor a falling kettlebell hurts anyone;
 * - a stick of dynamite a rooster kicks keeps burning on the same fuse.
 *
 * Balance is not checked: how hard a bell or a ball hits is the owner's to tune.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { BigRooster } from '../../src/creatures/BigRooster.js';
import { LittleRooster } from '../../src/creatures/LittleRooster.js';
import type { Player } from '../../src/Player.js';
import { setExplosiveSources, liveExplosives } from '../../src/creatures/explosiveAwareness.js';
import {
  EXERCISE_BALL_COUNT,
  GYM_KETTLEBELL_RACK_MIN,
} from '../../src/map/tiles/bossRooms/gymLayout.js';
import { GYM_KETTLEBELL_RACK } from '../../src/map/tileTypes.js';
import { DynamiteSystem } from '../../src/systems/DynamiteSystem.js';
import type { GymRoomSystem } from '../../src/systems/GymRoomSystem.js';
import {
  safeTileNear,
  type KettlebellRainRoom,
} from '../../src/systems/bossRooms/gymKettlebellRain.js';
import type { RoomGateContext } from './harness.js';

const HALF = 0.5;
/** Frames run for one whole rain: its length plus the last bell's fall, with room to spare. */
const RAIN_RUN_FRAMES = 900;
/** Frames his fury is given to kick every ball loose before the gate calls it stuck. */
const FURY_MAX_FRAMES = 3600;
/** A share of his health well inside his fury. */
const FURY_HP_SHARE_UNDER_TEST = 0.2;
/** A blow small enough never to kill him, to see whether it lands. */
const PROBE_BLOW = 1;
/** Frames a ball is given to roll before he dies, and after, to come to rest. */
const BALL_ROLL_FRAMES = 30;
const AFTER_DEATH_FRAMES = 240;
/** How far from the minion the crawler throws the stick, in tiles, so it lands in his reach. */
const STICK_THROW_OFFSET_TILES = 2;
/** Frames a thrown stick is followed: well inside its fuse. */
const STICK_FOLLOW_FRAMES = 200;

/** Puts `body`'s centre on the world point (x, y). */
function centreOn(body: Player, x: number, y: number): void {
  body.x = x - TILE_SIZE * HALF;
  body.y = y - TILE_SIZE * HALF;
}

function freshRooster(context: RoomGateContext, gym: GymRoomSystem): BigRooster | null {
  const layout = gym.layout;
  if (layout === null) return null;
  const { frame } = context.env;
  const existing = frame.roster.mobs.find((mob): mob is BigRooster => mob instanceof BigRooster);
  const bigRooster = existing ?? new BigRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
  if (existing === undefined) {
    bigRooster.setMap(frame.gameMap);
    frame.roster.add(bigRooster);
  }
  bigRooster.resetToSpawn();
  return bigRooster;
}

export function gymFightRuleGates(context: RoomGateContext, gym: GymRoomSystem): void {
  const { report } = context;
  const layout = gym.layout;
  if (layout === null) return;
  if (layout.kettlebellRacks.length < GYM_KETTLEBELL_RACK_MIN) {
    report.fail(
      `${layout.kettlebellRacks.length} kettlebell racks, want ${GYM_KETTLEBELL_RACK_MIN}+`,
    );
  }
  for (const rack of layout.kettlebellRacks) {
    if (context.env.gameMap.structure[rack.y][rack.x].type !== GYM_KETTLEBELL_RACK) {
      report.fail(`the kettlebell rack at ${rack.x},${rack.y} was not stamped`);
    }
  }
  if (layout.exerciseBalls.length !== EXERCISE_BALL_COUNT) {
    report.fail(
      `${layout.exerciseBalls.length} exercise balls rest in the gym, want ${EXERCISE_BALL_COUNT}`,
    );
  }
  for (const spot of layout.exerciseBalls) {
    if (!context.env.gameMap.isWalkable(spot.x, spot.y)) {
      report.fail(`an exercise ball rests on ${spot.x},${spot.y}, which is not open floor`);
    }
  }

  gateKettlebellsSpareTheFlock(context, gym);
  gateFuryImmunity(context, gym);
  gateHarmlessAfterDeath(context, gym);
  gateKickedStickKeepsFuse(context, gym);
  gym.onFightAborted();
}

/**
 * Stands Big Rooster and a minion on the active crawler, then rains: every
 * fourth bell is aimed at the crawler, so the birds are under bells all rain,
 * and the crawler must keep a tile no shadow covers within a step or two.
 */
function gateKettlebellsSpareTheFlock(context: RoomGateContext, gym: GymRoomSystem): void {
  const { env, report } = context;
  const { frame } = env;
  const bigRooster = freshRooster(context, gym);
  const layout = gym.layout;
  if (bigRooster === null || layout === null) return;
  const minion = new LittleRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
  minion.setMap(frame.gameMap);
  frame.roster.add(minion);
  gym.onSeal();
  const crawler = frame.human;
  const standX = (layout.spawn.x + HALF) * TILE_SIZE;
  const standY = (layout.spawn.y + HALF) * TILE_SIZE;
  const rainRoom: KettlebellRainRoom = {
    ...layout.bounds,
    isWalkable: (tileX, tileY) => frame.gameMap.isWalkable(tileX, tileY),
  };
  bigRooster.heaveRequest = { x: bigRooster.x, y: bigRooster.y };
  let crawlerHits = 0;
  let birdsUnderBells = 0;
  for (let tick = 0; tick < RAIN_RUN_FRAMES; tick++) {
    for (const body of [crawler, bigRooster, minion]) centreOn(body, standX, standY);
    const roosterHp = bigRooster.hp;
    const minionHp = minion.hp;
    const crawlerHp = crawler.hp;
    const landingOnThem = gym.fallingKettlebells.some(
      (bell) => bell.framesLeft === 1 && Math.hypot(bell.x - standX, bell.y - standY) < TILE_SIZE,
    );
    gym.update(frame);
    if (landingOnThem) birdsUnderBells++;
    if (safeTileNear(rainRoom, layout.spawn, gym.fallingKettlebells) === null) {
      report.fail(`at frame ${tick} of the rain every tile near the crawler was under a shadow`);
      break;
    }
    if (crawler.hp < crawlerHp) crawlerHits++;
    crawler.hp = crawler.maxHp;
    if (bigRooster.hp !== roosterHp || minion.hp !== minionHp) {
      report.fail('a kettlebell hurt Big Rooster or a rooster of his flock');
      break;
    }
  }
  if (birdsUnderBells === 0)
    report.fail('no kettlebell landed on the birds, so the check proved nothing');
  if (crawlerHits === 0) report.fail('no kettlebell hurt the crawler it landed on');
  minion.takeDamageFrom(minion.hp, null, null);
  gym.onFightAborted();
}

/** Drops him into his fury and runs it: blows bounce until the last ball rolls, then land. */
function gateFuryImmunity(context: RoomGateContext, gym: GymRoomSystem): void {
  const { env, report } = context;
  const { frame } = env;
  const bigRooster = freshRooster(context, gym);
  const layout = gym.layout;
  if (bigRooster === null || layout === null) return;
  gym.onSeal();
  const crawler = frame.human;
  bigRooster.forceAggro = true;
  bigRooster.hp = Math.floor(bigRooster.maxHp * FURY_HP_SHARE_UNDER_TEST);
  let sawFury = false;
  let ended = false;
  for (let tick = 0; tick < FURY_MAX_FRAMES; tick++) {
    crawler.hp = crawler.maxHp;
    gym.update(frame);
    bigRooster.updateAI([crawler]);
    if (bigRooster.roosterPhase === 'fury') {
      sawFury = true;
      const before = bigRooster.hp;
      bigRooster.takeDamageFrom(PROBE_BLOW, crawler, 'melee');
      if (bigRooster.hp !== before) {
        report.fail('a blow landed on him during his fury');
        break;
      }
    } else if (sawFury) {
      ended = true;
      break;
    }
  }
  if (!sawFury) {
    report.fail('he never went into his fury');
    gym.onFightAborted();
    return;
  }
  if (!ended) report.fail(`his fury was still running after ${FURY_MAX_FRAMES} frames`);
  const resting = gym.exerciseBalls.filter((ball) => ball.phase === 'resting').length;
  if (ended && resting > 0) report.fail(`his fury ended with ${resting} balls still resting`);
  const before = bigRooster.hp;
  bigRooster.takeDamageFrom(PROBE_BLOW, crawler, 'melee');
  if (ended && bigRooster.hp === before) report.fail('blows still bounce off him after his fury');
  gym.onFightAborted();
}

/** A rolling ball and a rain in the air when he dies: the crawler stands in both and is untouched. */
function gateHarmlessAfterDeath(context: RoomGateContext, gym: GymRoomSystem): void {
  const { env, report } = context;
  const { frame } = env;
  const bigRooster = freshRooster(context, gym);
  if (bigRooster === null) return;
  gym.onSeal();
  const crawler = frame.human;
  gym.update(frame);
  bigRooster.heaveRequest = { x: bigRooster.x, y: bigRooster.y };
  bigRooster.ballKickRequest = { index: 0, dx: 1, dy: 1 };
  for (let tick = 0; tick < BALL_ROLL_FRAMES; tick++) gym.update(frame);
  if (gym.exerciseBalls[0]?.phase !== 'rolling') report.fail('a kicked ball did not roll');
  bigRooster.takeDamageFrom(bigRooster.hp, crawler, 'melee');
  gym.onBossDefeated();
  let bellsUnderfoot = 0;
  for (let tick = 0; tick < AFTER_DEATH_FRAMES; tick++) {
    const ball = gym.exerciseBalls.find((_, index) => index === 0);
    const bell = gym.fallingKettlebells.find((falling) => falling.framesLeft === 1);
    if (bell !== undefined) {
      centreOn(crawler, bell.x, bell.y);
      bellsUnderfoot++;
    } else if (ball !== undefined && ball.phase !== 'resting') {
      centreOn(crawler, ball.x, ball.y);
    }
    const before = crawler.hp;
    gym.update(frame);
    if (crawler.hp < before) {
      report.fail('a ball or a kettlebell hurt a crawler after his death');
      break;
    }
  }
  if (bellsUnderfoot === 0) report.fail('no kettlebell was left falling at his death to check');
  if (gym.exerciseBalls[0]?.phase !== 'stopped')
    report.fail('the ball did not roll to a stop after his death');
  if (gym.kettlebellsRaining) report.fail('kettlebells kept going up after his death');
  gym.onFightAborted();
}

/**
 * A crawler throws a stick beside a minion; he walks to it and kicks it. The
 * stick's fuse must run down one frame at a time straight through the kick.
 */
function gateKickedStickKeepsFuse(context: RoomGateContext, gym: GymRoomSystem): void {
  const { env, report } = context;
  const { frame } = env;
  const layout = gym.layout;
  if (layout === null) return;
  const minion = new LittleRooster(layout.spawn.x, layout.spawn.y, TILE_SIZE);
  minion.setMap(frame.gameMap);
  frame.roster.add(minion);
  const crawler = frame.human;
  crawler.x = (layout.spawn.x + STICK_THROW_OFFSET_TILES) * TILE_SIZE;
  crawler.y = layout.spawn.y * TILE_SIZE;
  const dynamite = new DynamiteSystem(frame.gameMap);
  setExplosiveSources([dynamite]);
  crawler.inventory.addItem('dynamite', 1);
  dynamite.ready(crawler, 'dynamite');
  dynamite.throwReadiedAt(minion.x + TILE_SIZE * HALF, minion.y + TILE_SIZE * HALF);
  let lastFuse: number | null = null;
  let kicked = false;
  let wasGrounded = false;
  for (let tick = 0; tick < STICK_FOLLOW_FRAMES; tick++) {
    gym.update(frame);
    dynamite.update(frame);
    minion.updateAI([crawler]);
    const stick = liveExplosives().find((explosive) => explosive.kind === 'stick');
    if (stick === undefined) break;
    if (lastFuse !== null && stick.fuseFramesLeft !== lastFuse - 1) {
      report.fail(`the stick's fuse went from ${lastFuse} to ${stick.fuseFramesLeft} in one frame`);
      break;
    }
    lastFuse = stick.fuseFramesLeft;
    if (wasGrounded && !stick.grounded) kicked = true;
    wasGrounded = stick.grounded;
  }
  if (!kicked) report.fail('the minion never kicked the stick that landed beside him');
  setExplosiveSources([]);
  minion.takeDamageFrom(minion.hp, null, null);
}
