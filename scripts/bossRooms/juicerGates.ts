/**
 * The gym's own gates, run on every generated floor of the sweep: what its
 * template promises beyond the layout contract every room shares.
 *
 * - two dumbbell racks, on opposite walls, each with open floor in front;
 * - every tall piece against a wall, none in the middle of the room;
 * - three treadmills, each two belt tiles running out of the wall into the room;
 * - the troglodyte guards' spawn offsets land on open floor, off every prop;
 * - a belt never carries a crawler onto a tile it cannot stand on, or out of the room.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { GYM_CABLE_STACK, GYM_RACK, GYM_SQUAT_RACK } from '../../src/map/tileTypes.js';
import type { JuicerRoomSystem } from '../../src/systems/JuicerRoomSystem.js';
import type { TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import { gameGauntletDressings, type RoomGateContext } from './harness.js';

/** The racks must be at least this far apart, in tiles, so a reload means crossing the room. */
const MIN_RACK_SEPARATION_TILES = 12;
/** The middle of the room no tall piece may stand in, as a share of each side. */
const MIDDLE_SHARE = 0.6;
const TREADMILL_COUNT = 3;
const MIN_TREADMILLS = 2;
/** Two squat racks and two cable stacks. */
const TALL_PIECES = 4;
/** The spawn rule the troglodyte guards come from, and the boss-room index it names. */
const GUARD_ROOM_INDEX = 1;
const GUARD_ORIGIN = `bossRoom:${GUARD_ROOM_INDEX}`;
/** Frames a crawler is left on each belt tile, well past the time it takes to ride off. */
const BELT_RIDE_FRAMES = 180;
/** Sub-tile starting offsets on each belt tile, in tiles: centre and the four corners' insides. */
const BELT_START_INSET = 0.3;
const BELT_START_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-BELT_START_INSET, -BELT_START_INSET],
  [BELT_START_INSET, -BELT_START_INSET],
  [-BELT_START_INSET, BELT_START_INSET],
  [BELT_START_INSET, BELT_START_INSET],
];

const key = (t: TilePoint): string => `${t.x},${t.y}`;

function tilesOfType(context: RoomGateContext, type: number): TilePoint[] {
  const { bounds } = context.env.room;
  const found: TilePoint[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (context.env.gameMap.structure[y][x].type === type) found.push({ x, y });
    }
  }
  return found;
}

function onPerimeter(
  tile: TilePoint,
  bounds: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    tile.x === bounds.x ||
    tile.y === bounds.y ||
    tile.x === bounds.x + bounds.w - 1 ||
    tile.y === bounds.y + bounds.h - 1
  );
}

function wallOf(tile: TilePoint, bounds: { x: number; y: number; w: number; h: number }): string {
  if (tile.x === bounds.x) return 'west';
  if (tile.x === bounds.x + bounds.w - 1) return 'east';
  if (tile.y === bounds.y) return 'north';
  return 'south';
}

export function juicerRoomGates(context: RoomGateContext): void {
  const { env, report } = context;
  const { room, gameMap } = env;
  const { bounds } = room;
  const gym: JuicerRoomSystem = gameGauntletDressings(env).juicer;
  const layout = gym.layout;
  if (layout === null) {
    report.fail('the gym found no layout on its own floor');
    return;
  }
  if (
    layout.bounds.x !== bounds.x ||
    layout.bounds.y !== bounds.y ||
    layout.bounds.w !== bounds.w ||
    layout.bounds.h !== bounds.h
  ) {
    report.fail('the gym read its bounds off the floor tiles differently from the room list');
  }

  const racks = tilesOfType(context, GYM_RACK);
  if (racks.length !== 2) report.fail(`${racks.length} dumbbell racks stamped, want 2`);
  if (racks.length === 2) {
    const [a, b] = racks;
    if (wallOf(a, bounds) === wallOf(b, bounds)) report.fail('both dumbbell racks are on one wall');
    const apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (apart < MIN_RACK_SEPARATION_TILES) {
      report.fail(
        `the racks are ${apart.toFixed(1)} tiles apart, want ${MIN_RACK_SEPARATION_TILES}+`,
      );
    }
  }
  const fronts = gym.getActiveDumbbellPositions();
  if (fronts.length !== racks.length)
    report.fail('a rack has no floor in front of it to lift from');
  for (const front of fronts) {
    if (!gameMap.isWalkable(Math.floor(front.x / TILE_SIZE), Math.floor(front.y / TILE_SIZE))) {
      report.fail('a rack front tile is not walkable');
    }
  }

  const tall = [...tilesOfType(context, GYM_SQUAT_RACK), ...tilesOfType(context, GYM_CABLE_STACK)];
  if (tall.length !== TALL_PIECES) {
    report.fail(`${tall.length} tall pieces placed (2 squat + 2 cable wanted)`);
  }
  const marginX = (bounds.w * (1 - MIDDLE_SHARE)) / 2;
  const marginY = (bounds.h * (1 - MIDDLE_SHARE)) / 2;
  for (const tile of [...tall, ...racks]) {
    if (!onPerimeter(tile, bounds)) report.fail(`a wall piece stands off the wall at ${key(tile)}`);
    const inMiddle =
      tile.x >= bounds.x + marginX &&
      tile.x < bounds.x + bounds.w - marginX &&
      tile.y >= bounds.y + marginY &&
      tile.y < bounds.y + bounds.h - marginY;
    if (inMiddle) report.fail(`a tall piece stands in the middle of the room at ${key(tile)}`);
  }

  const treadmills = gym.treadmillLayouts;
  // A doorway's approach lane can take one treadmill's spot; the row may lose
  // one to it and no more.
  if (treadmills.length < MIN_TREADMILLS) {
    report.fail(`${treadmills.length} treadmills placed (${MIN_TREADMILLS} at least)`);
  } else if (treadmills.length < TREADMILL_COUNT) {
    report.note(`${treadmills.length} treadmills placed (${TREADMILL_COUNT} wanted)`);
  }
  for (const treadmill of treadmills) {
    const [wallEnd, roomEnd] = treadmill.belt;
    const runsInward =
      roomEnd.x - wallEnd.x === treadmill.push.dx && roomEnd.y - wallEnd.y === treadmill.push.dy;
    if (!runsInward) report.fail(`the belt at ${key(wallEnd)} does not run out of the wall`);
    if (!onPerimeter(wallEnd, bounds)) report.fail(`the belt at ${key(wallEnd)} is off the wall`);
  }

  const guards = env.levelDef.extraSpawns?.find((rule) => rule.origin === GUARD_ORIGIN);
  if (guards === undefined) {
    report.fail(`no ${GUARD_ORIGIN} guard rule to check`);
  } else {
    const centre = gameMap.bossRooms[GUARD_ROOM_INDEX]?.centre ?? room.spawn;
    for (const [dx, dy] of guards.offsets) {
      const tile = { x: centre.x + dx, y: centre.y + dy };
      const type = gameMap.structure[tile.y]?.[tile.x]?.type;
      const onProp = type === GYM_RACK || type === GYM_SQUAT_RACK || type === GYM_CABLE_STACK;
      if (!gameMap.isWalkable(tile.x, tile.y) || onProp) {
        report.fail(`a troglodyte guard spawns on ${key(tile)}, which is not open floor`);
      }
      if (gym.poweredBeltAt((tile.x + 1 / 2) * TILE_SIZE, (tile.y + 1 / 2) * TILE_SIZE) !== null) {
        report.fail(`a troglodyte guard spawns on a belt at ${key(tile)}`);
      }
    }
  }

  gateBeltRides(context, gym);
}

/**
 * Stands the crawler on every belt tile, from the centre and from each corner,
 * and lets the running belt carry her while she stands still: she must never
 * be on a tile she cannot stand on, nor outside the room.
 */
function gateBeltRides(context: RoomGateContext, gym: JuicerRoomSystem): void {
  const { env, report } = context;
  const { frame, room } = env;
  const { bounds } = room;
  const crawler = frame.human;
  const savedX = crawler.x;
  const savedY = crawler.y;
  gym.onSeal();
  let rides = 0;
  for (const treadmill of gym.treadmillLayouts) {
    for (const tile of treadmill.belt) {
      for (const [ox, oy] of BELT_START_OFFSETS) {
        crawler.x = (tile.x + ox) * TILE_SIZE;
        crawler.y = (tile.y + oy) * TILE_SIZE;
        rides++;
        for (let tick = 0; tick < BELT_RIDE_FRAMES; tick++) {
          gym.update(frame);
          const tx = Math.floor((crawler.x + TILE_SIZE / 2) / TILE_SIZE);
          const ty = Math.floor((crawler.y + TILE_SIZE / 2) / TILE_SIZE);
          const inside =
            tx >= bounds.x &&
            ty >= bounds.y &&
            tx < bounds.x + bounds.w &&
            ty < bounds.y + bounds.h;
          if (!inside || !frame.gameMap.isWalkable(tx, ty)) {
            report.fail(`a belt carried a crawler from ${key(tile)} onto ${tx},${ty}`);
            break;
          }
        }
      }
    }
  }
  if (rides === 0) report.fail('no belt ride was measured');
  crawler.x = savedX;
  crawler.y = savedY;
  gym.onFightAborted();
}
