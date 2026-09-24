#!/usr/bin/env tsx
/**
 * Renders the five boss rooms, each on a real generated floor, in each state
 * its fight can put it in.
 *
 *   npm run render:boss-rooms -- --room=hoarder --state=sealed --door=east --scale=2
 *
 * Flags:
 *   --room=hoarder|juicer|krakaren|spider|swine|all   (default all)
 *   --seed=N    world seed the floor is generated from (default 1); with
 *               `--door`, the search for a matching floor starts here
 *   --state=pre|sealed|enraged|phase2|phase3|defeated|all   (default all
 *               states the room supports)
 *   --scale=N   pixel scale (default 1, the size the game draws at)
 *   --door=south|north|east|west   renders the first floor from `--seed` on
 *               whose room has its doorway on that side
 *
 * Writes `preview/boss-rooms/<room>-<state>-<door>.png`. What it draws is the
 * baked floor, the room's dressing layers and its Y-sorted props — no boss, no
 * party, no lighting.
 */

import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import type { DoorSide } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  BOSS_ROOM_STATES,
  buildEnvironment,
  findFloorWithRoom,
  generateFloor,
  isBossRoomId,
  isBossRoomState,
  isDoorSide,
  magentaPixelCount,
  renderRoom,
  roomRenderPath,
  type BossRoomHarness,
  type BossRoomState,
  type FoundRoom,
} from './bossRooms/harness.js';
import { BOSS_ROOM_HARNESSES } from './bossRooms/rooms.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { writePreviewPng } from './previewOut.js';

const DEFAULT_SEED = 1;
const DEFAULT_SCALE = 1;
const ALL = 'all';

/** Length of the `--=` around a flag's name. */
const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name, '');
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

const roomArg = stringArg('room', ALL);
if (roomArg !== ALL && !isBossRoomId(roomArg)) {
  throw new Error(`--room must be one of ${BOSS_ROOM_HARNESSES.map((h) => h.id).join(', ')}, all`);
}
const stateArg = stringArg('state', ALL);
if (stateArg !== ALL && !isBossRoomState(stateArg)) {
  throw new Error(`--state must be one of ${BOSS_ROOM_STATES.join(', ')}, all`);
}
const doorArg = stringArg('door', '');
if (doorArg !== '' && !isDoorSide(doorArg)) {
  throw new Error('--door must be one of south, north, east, west');
}
const door: DoorSide | undefined = isDoorSide(doorArg) ? doorArg : undefined;
const seed = intArg('seed', DEFAULT_SEED);
const scale = intArg('scale', DEFAULT_SCALE);

await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

const harnesses = BOSS_ROOM_HARNESSES.filter((h) => roomArg === ALL || h.id === roomArg);

/** A fresh copy of the floor, so one state's changes never leak into the next render. */
function regenerate(harness: BossRoomHarness, found: FoundRoom): FoundRoom {
  const { gameMap, levelDef } = generateFloor(harness.floor, found.seed);
  const room = harness.locate(gameMap, levelDef);
  if (room === null) throw new Error(`${harness.id}: seed ${found.seed} no longer has the room`);
  return { seed: found.seed, gameMap, levelDef, room };
}

let failures = 0;
for (const harness of harnesses) {
  if (door !== undefined && !harness.doorSides.includes(door)) {
    console.log(`${harness.id}: skipped — its doorway is never on the ${door} side`);
    continue;
  }
  const found = findFloorWithRoom(harness, seed, door);
  if (found === null) {
    console.log(`${harness.id}: no floor from seed ${seed} has this room with that doorway`);
    failures++;
    continue;
  }
  const states: readonly BossRoomState[] = isBossRoomState(stateArg) ? [stateArg] : harness.states;
  for (const state of states) {
    const fresh = regenerate(harness, found);
    const env = buildEnvironment(fresh);
    const roomUnderTest = harness.build(env);
    if (!roomUnderTest.driveToState(state)) {
      console.log(`${harness.id}: no '${state}' state yet — skipped`);
      continue;
    }
    roomUnderTest.update();
    const rendered = renderRoom(env, roomUnderTest, scale);
    const outPath = roomRenderPath(harness.id, state, fresh.room.doorSide);
    writePreviewPng(outPath, rendered.canvas.toBuffer('image/png'));
    const magenta = magentaPixelCount(rendered.canvas);
    const calls = rendered.dressingDrawCalls;
    console.log(
      `${outPath}: seed ${fresh.seed}, door ${fresh.room.doorSide}, ` +
        `dressing drawImage ${calls.drawImage} fill ${calls.fill} stroke ${calls.stroke}` +
        (magenta > 0 ? `, ${magenta} MAGENTA placeholder px` : ''),
    );
  }
}
if (failures > 0) process.exit(1);
