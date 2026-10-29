/**
 * The Current Goblin's power lab on floor 2: its dressing system, the states
 * it can be driven into, and its own layout gates.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { ELECTRIC_GOBLIN_BOSS_TYPE } from '../../src/core/mobs/bossTypes.js';
import { ElectricGoblin } from '../../src/creatures/ElectricGoblin.js';
import type { PowerLabRoomSystem } from '../../src/systems/bossRooms/PowerLabRoomSystem.js';
import {
  MIN_LAB_PUDDLES,
  MIN_LAB_VATS,
  powerLabAt,
  labTileKey,
  type LabPuddle,
} from '../../src/systems/bossRooms/powerLabLayout.js';
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
 * Frames the review harness runs the fight for before drawing it: past his
 * opening rest and into his first grenade volley, with every ring on the floor.
 */
const FIGHT_REVIEW_FRAMES = 150;

const MAX_LAB_VATS = 8;
const MIN_LAB_CONSOLES = 2;
const MAX_LAB_CONSOLES = 3;
const MAX_LAB_PUDDLES = 3;
/** The smallest puddle the fight is built for, in tiles each way; either way round. */
const PUDDLE_MIN_LONG_TILES = 5;
const PUDDLE_MIN_SHORT_TILES = 4;

/**
 * Adds him to the floor's roster with the party in the room, and runs the
 * fight as the scene would for `frames`, so the room draws what he is landing.
 */
function stageFight(env: RoomEnvironment, room: PowerLabRoomSystem, frames: number): void {
  const boss = new ElectricGoblin(env.room.spawn.x, env.room.spawn.y, TILE_SIZE);
  boss.forceAggro = true;
  env.frame.roster.add(boss);
  const party = [env.frame.human, env.frame.cat];
  for (let frame = 0; frame < frames; frame++) {
    room.update(env.frame);
    boss.updateAI(party);
    boss.tickTimers();
  }
}

function powerLabOf(env: RoomEnvironment): PowerLabRoomSystem {
  const { powerLab } = gameGauntletDressings(env);
  if (powerLab === null) throw new Error('the power lab vanished between locate and build');
  return powerLab;
}

export const powerLabRoom: BossRoomHarness = {
  id: 'powerLab',
  floor: 2,
  assetGroup: 'boss_power_lab',
  // Vats and consoles stand on the floor of their tile.
  sheetGroundedEdges: new Set<FrameEdge>(['bottom']),
  states: ['pre', 'sealed', 'enraged', 'defeated'],
  heaviestState: 'enraged',
  doorSides: DOOR_SIDES,
  minOpenFloorShare: DEFAULT_MIN_OPEN_FLOOR_SHARE,
  locate: (gameMap, levelDef) => gauntletBossRoom(gameMap, levelDef, ELECTRIC_GOBLIN_BOSS_TYPE),
  build: (env) => {
    const room = powerLabOf(env);
    return dressingUnderTest(room, env, {
      driveToState: (state) => {
        if (state !== 'enraged') return undefined;
        room.onSeal();
        stageFight(env, room, FIGHT_REVIEW_FRAMES);
        return true;
      },
    });
  },
  gates: (context) => gateLabLayout(context),
};

/** The lab's own layout rules, on every generated floor of the sweep. */
function gateLabLayout({ env, report }: RoomGateContext): void {
  const lab = powerLabAt(env.gameMap.structure, env.room.spawn.x, env.room.spawn.y);
  if (lab === null) {
    report.fail('no power lab laid out over the room');
    return;
  }
  const { room, gameMap } = env;
  if (lab.centre.x !== room.spawn.x || lab.centre.y !== room.spawn.y) {
    report.fail(
      `vat bed centred on ${lab.centre.x},${lab.centre.y}, he spawns on ${room.spawn.x},${room.spawn.y}`,
    );
  }
  if (lab.vats.length < MIN_LAB_VATS || lab.vats.length > MAX_LAB_VATS) {
    report.fail(`${lab.vats.length} vats (want ${MIN_LAB_VATS}–${MAX_LAB_VATS})`);
  }
  if (lab.consoles.length < MIN_LAB_CONSOLES || lab.consoles.length > MAX_LAB_CONSOLES) {
    report.fail(`${lab.consoles.length} consoles (want ${MIN_LAB_CONSOLES}–${MAX_LAB_CONSOLES})`);
  }
  if (lab.puddles.length < MIN_LAB_PUDDLES || lab.puddles.length > MAX_LAB_PUDDLES) {
    report.fail(`${lab.puddles.length} puddles (want ${MIN_LAB_PUDDLES}–${MAX_LAB_PUDDLES})`);
  }
  report.note(
    `${lab.vats.length} vats, ${lab.consoles.length} consoles, ${lab.puddles.length} puddles of ` +
      lab.puddles.map((p) => p.tiles.length).join('/') +
      ' tiles',
  );

  const spawnKey = labTileKey(room.spawn.x, room.spawn.y);
  for (const [index, puddle] of lab.puddles.entries()) {
    if (!holdsCore(puddle)) {
      report.fail(
        `puddle ${index} holds no ${PUDDLE_MIN_LONG_TILES}×${PUDDLE_MIN_SHORT_TILES} block of water`,
      );
    }
    // A puddle is ground a crawler crosses: every tile walkable and off the doorway approaches.
    const blocked = puddle.tiles.filter((t) => !gameMap.isWalkable(t.x, t.y));
    if (blocked.length > 0) report.fail(`puddle ${index} has ${blocked.length} unwalkable tiles`);
    const onApproach = puddle.tiles.filter((t) => lab.approach.has(labTileKey(t.x, t.y)));
    if (onApproach.length > 0) {
      report.fail(
        `puddle ${index} on a doorway approach at ${onApproach.map((t) => `${t.x},${t.y}`).join(' ')}`,
      );
    }
    if (puddle.keys.has(spawnKey)) report.fail(`puddle ${index} covers his spawn tile`);
  }
  // Two puddles that touch are one patch of water to a player, charged half at a time.
  for (const [index, puddle] of lab.puddles.entries()) {
    for (const other of lab.puddles.slice(index + 1)) {
      const touching = puddle.tiles.some((t) =>
        other.tiles.some((o) => Math.abs(o.x - t.x) <= 1 && Math.abs(o.y - t.y) <= 1),
      );
      if (touching) report.fail('two puddles touch');
    }
  }
}

/** Whether a puddle holds a solid block of water of the smallest size the fight is built for. */
function holdsCore(puddle: LabPuddle): boolean {
  for (const [w, h] of [
    [PUDDLE_MIN_LONG_TILES, PUDDLE_MIN_SHORT_TILES],
    [PUDDLE_MIN_SHORT_TILES, PUDDLE_MIN_LONG_TILES],
  ]) {
    for (const corner of puddle.tiles) {
      let solid = true;
      for (let dy = 0; dy < h && solid; dy++) {
        for (let dx = 0; dx < w && solid; dx++) {
          solid = puddle.keys.has(labTileKey(corner.x + dx, corner.y + dy));
        }
      }
      if (solid) return true;
    }
  }
  return false;
}
