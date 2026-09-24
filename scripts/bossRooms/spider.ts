/**
 * The Grotesque Spider's lab on floor 2: its dressing, the quest system that
 * owns the lab's fight and draws its people and its dark, the states it can be
 * driven into, and its own gates (`spiderGates.ts`).
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { GrotesqueSpider } from '../../src/creatures/GrotesqueSpider.js';
import type { Mob } from '../../src/creatures/Mob.js';
import {
  SLAM_CONE_HALF_ANGLE_RAD,
  SLAM_CONE_RADIUS_PX,
} from '../../src/creatures/grotesqueSpiderTimeline.js';
import type { SpiderLabDressing } from '../../src/systems/bossRooms/SpiderLabDressing.js';
import { SpiderQuestSystem } from '../../src/systems/SpiderQuestSystem.js';
import {
  DEFAULT_MIN_OPEN_FLOOR_SHARE,
  DOOR_SIDES,
  dressingUnderTest,
  locateRectRoom,
  type BossRoomHarness,
  type BossRoomState,
  type RoomEnvironment,
} from './harness.js';
import { spiderLabGates } from './spiderGates.js';

/** Ticks a driven state runs before it is drawn: the dark has come down and the sparks are falling. */
const SETTLE_FRAMES = 36;
/** Her hit points as a share of her maximum, deep in her last phase. */
const PHASE_THREE_HP_SHARE = 0.2;
const LAST_PHASE = 3;

/** Reaches a private method on a live object, as the harness may and the game never does. */
export function callPrivate(owner: object, key: string, args: unknown[]): unknown {
  const method: unknown = Reflect.get(owner, key);
  if (typeof method !== 'function') throw new Error(`lookup failed: no method "${key}"`);
  const result: unknown = Reflect.apply(method, owner, args);
  return result;
}

/** Puts the quest into the fight, the egg burst and the scientist dead, as the cutscene leaves it. */
function stageFight(quest: SpiderQuestSystem): void {
  const base = quest.captureCheckpoint();
  quest.restoreCheckpoint({
    ...base,
    phase: 'boss_fight',
    spiderEggOpened: true,
    scientistDead: true,
    hackingDone: true,
  });
}

/** A slam landing across the first bench row, for a state that shows smashed glassware. */
function slamAcrossBenches(lab: SpiderLabDressing): void {
  const first = lab.room.benchTiles[0];
  if (first === undefined) return;
  const second = lab.room.benchTiles[1] ?? first;
  lab.shatterGlassUnder({
    originX: (first.x - (second.x - first.x)) * TILE_SIZE,
    originY: (first.y - (second.y - first.y)) * TILE_SIZE,
    dirX: Math.sign(second.x - first.x),
    dirY: Math.sign(second.y - first.y),
    radiusPx: SLAM_CONE_RADIUS_PX,
    halfAngleRad: SLAM_CONE_HALF_ANGLE_RAD,
  });
}

/**
 * Webbing cut before her last roar, so the regrowth shows: a spot every few
 * tiles, about as much as a party swinging through the far half would clear.
 */
const CUT_WEB_STRIDE = 7;
const WEB_CUTS = 8;
const HALF = 0.5;

/** Cuts some of the webbing and lets her lay among the cocoons, ahead of her last roar. */
function prepareLastRoar(lab: SpiderLabDressing): void {
  const cuts = lab.room.webTiles.filter((_t, i) => i % CUT_WEB_STRIDE === 0).slice(0, WEB_CUTS);
  for (const tile of cuts) {
    callPrivate(lab, 'clearWebAround', [
      (tile.x + HALF) * TILE_SIZE,
      (tile.y + HALF) * TILE_SIZE,
      1,
    ]);
  }
  const cocoon = lab.room.cocoonTiles[0];
  if (cocoon === undefined) return;
  const spider = new GrotesqueSpider(cocoon.x, cocoon.y + 1, TILE_SIZE);
  spider.hp = Math.max(1, Math.floor(spider.maxHp * PHASE_THREE_HP_SHARE));
  // Her phase is latched as she fights; a spider built for a gate has to be told.
  Reflect.set(spider, 'reachedPhase', LAST_PHASE);
  lab.observeFight(spider, [], 1);
}

function driveLab(
  quest: SpiderQuestSystem,
  lab: SpiderLabDressing,
  env: RoomEnvironment,
  state: BossRoomState,
): boolean | undefined {
  const settle = (): void => {
    for (let i = 0; i < SETTLE_FRAMES; i++) lab.update(env.frame);
  };
  switch (state) {
    case 'sealed':
      stageFight(quest);
      lab.onSeal();
      return true;
    case 'phase2':
      stageFight(quest);
      lab.onSeal();
      lab.enterLightPhase(2);
      slamAcrossBenches(lab);
      settle();
      return true;
    case 'phase3':
      stageFight(quest);
      lab.onSeal();
      lab.enterLightPhase(2);
      prepareLastRoar(lab);
      lab.enterLightPhase(3);
      settle();
      return true;
    case 'pre':
    case 'enraged':
    case 'defeated':
      return undefined;
  }
}

export const spiderRoom: BossRoomHarness = {
  id: 'spider',
  floor: 2,
  assetGroup: 'boss_grotesque_spider',
  states: ['pre', 'sealed', 'phase2', 'phase3', 'defeated'],
  heaviestState: 'phase3',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap) => {
    const lab = gameMap.spiderLabRoom;
    return lab === null ? null : locateRectRoom(gameMap, lab.bounds, lab.centre);
  },
  build: (env) => {
    const quest = new SpiderQuestSystem(env.gameMap, env.bus, (mob: Mob) => {
      env.frame.roster.add(mob);
    });
    const lab = quest.labDressing;
    if (lab === null) throw new Error('the spider quest built no lab dressing');
    return dressingUnderTest(lab, env, {
      renderGround: (ctx, camX, camY) => quest.render(ctx, camX, camY),
      renderAbove: (ctx, camX, camY) => {
        quest.renderLifeMachinesForeground(ctx, camX, camY);
        quest.renderLabDarkness(ctx, camX, camY);
      },
      driveToState: (state) => driveLab(quest, lab, env, state),
    });
  },
  gates: spiderLabGates,
};
