/**
 * Behaviour gates for the fixtures hung on dungeon wall faces.
 *
 *   npm run verify:wall-fixtures
 *
 * - Placement: every fixture hangs on the lower tile of a face that runs on
 *   to either side, in a dressed room or hallway, never touching another and
 *   never behind a prop tall enough to climb the face; its tile stays a wall;
 *   a seed places the same fixtures twice. The baked dressing leaves a
 *   fixture's face bare and its neighbours without spots. A lit room whose
 *   lighting names a wall-hung light and has a face to hang it on gets one;
 *   every electrical room has its fuse box; a tube is only ever wired to a
 *   fuse box in its own room.
 * - Striking: a swing from the floor in front breaks every breakable kind;
 *   the same swing facing away does nothing, and on a built map a crawler
 *   south of a face but behind a wall cannot reach it until the wall is
 *   opened. Chains swing, a banner tears down to rags and no further, a valve
 *   hisses; none of them breaks, and a missile flies on through them.
 * - Lights: breaking a sconce puts its light out with a gutter flash;
 *   breaking a fuse box puts out every tube wired to it with a power-down
 *   fade and its last flicker, raises its named events, and leaves the
 *   room's other lights alone.
 * - Checkpoints: every fixture's health, broken state and tear come back as
 *   captured, the lights they carry come back on, and a checkpoint taken
 *   after a break keeps them out — all without replaying a death flash.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { FloorTypeValue } from '../src/map/tileTypes.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { setDungeonFloorTheme } from '../src/map/dungeon/floorTheme.js';
import {
  BANNER_TEAR_STAGES,
  WALL_FIXTURE_SPECS,
  coversFaceBehind,
  freshFixtureState,
  isFixtureFace,
  isWallFixtureLight,
  type WallFixture,
  type WallFixtureKind,
} from '../src/map/dungeon/wallFixtures.js';
import { wallDressingAt } from '../src/map/dungeon/wallDressing.js';
import { wallShapeAt } from '../src/map/dungeon/wallShape.js';
import { dungeonFloorTheme } from '../src/map/dungeon/floorTheme.js';
import type { TileContent } from '../src/map/tileTypes.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import { DestructiblePropSystem } from '../src/systems/DestructiblePropSystem.js';
import { DungeonLightingSystem, POWER_DOWN_MS } from '../src/systems/DungeonLightingSystem.js';

const FIRST_SEED = 3;
const SEED_STRIDE = 4;
const SEED_COUNT = 3;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, index) => FIRST_SEED + index * SEED_STRIDE);
const FLOORS = [1, 2] as const;
/** More floor-2 seeds for the electrical rooms alone: one in four or five floors rolls none. */
const ELECTRICAL_SEED_COUNT = 8;
const ELECTRICAL_SEEDS = Array.from(
  { length: ELECTRICAL_SEED_COUNT },
  (_, index) => FIRST_SEED + index * SEED_STRIDE,
);
/** A powering-down tube's last flicker falls inside its fade; a gutter flash is long gone by its end. */
const POWER_DOWN_FLICKER_SAMPLE_MS = 170;
const POWER_DOWN_TAIL_SAMPLE_MS = 300;
/** The most a tube still cuts in its last flicker; a gutter flash at the same age cuts far more. */
const POWER_DOWN_FLICKER_MAX_CUT = 0.15;
/** A melee reach of two tiles, so a crawler a tile back from the face is in range. */
const SWING_RANGE = TILE_SIZE * 2;
const SWING_DAMAGE = 1;
/** Reach that strikes the fixture straight ahead and never its neighbours two tiles along. */
const CLOSE_RANGE_TILES = 1.2;
const CLOSE_RANGE = TILE_SIZE * CLOSE_RANGE_TILES;
/** More blows than any fixture has health. */
const MAX_SWINGS = 50;
const FRAME_MS = 16;

let failures = 0;
const notes: string[] = [];

function fail(check: string, message: string): void {
  failures++;
  console.error(`FAIL [${check}] ${message}`);
}

function buildFloor(level: number, seed: number): GameMap {
  const levelDef = getLevelDef(`level${level}`);
  setDungeonFloorTheme(levelDef.groundTheme ?? 'cellars');
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: seed,
  });
}

function isOpen(gameMap: GameMap, x: number, y: number): boolean {
  return gameMap.isWalkable(x, y);
}

// ── Placement ───────────────────────────────────────────────────────────────

function fixtureSignature(gameMap: GameMap): string {
  return gameMap.wallFixtures
    .map((f) => `${f.kind}@${f.tileX},${f.tileY}:${f.seed}:${f.circuit ?? '-'}`)
    .join('|');
}

function checkPlacement(gameMap: GameMap, label: string, level: number, seed: number): void {
  const fixtures = gameMap.wallFixtures;
  if (fixtures.length === 0) fail('placement', `${label}: no fixtures at all`);
  const taken = new Set<string>();
  const counts = new Map<WallFixtureKind, number>();
  for (const fixture of fixtures) {
    counts.set(fixture.kind, (counts.get(fixture.kind) ?? 0) + 1);
    const { tileX: x, tileY: y } = fixture;
    const where = `${label}: ${fixture.kind} at (${x},${y})`;
    if (gameMap.structure[y]?.[x]?.type !== FloorTypeValue.wall)
      fail('placement', `${where} is not on a wall`);
    if (!isFixtureFace(gameMap.structure, x, y))
      fail('placement', `${where} is not on a face's lower tile`);
    if (gameMap.structure[y + 1]?.[x]?.type === FloorTypeValue.wall) {
      fail('placement', `${where} has a wall, not floor, in front`);
    }
    if (coversFaceBehind(gameMap.structure, x, y + 1)) {
      fail('placement', `${where} hangs behind a prop that climbs its face`);
    }
    checkDressingCleared(gameMap, x, y, where);
    if (gameMap.regionAt(x, y + 1) !== fixture.region)
      fail('placement', `${where} faces another region`);
    const assignment = gameMap.regionCharacters.forRegion(fixture.region);
    if (assignment === null || assignment.type === 'special') {
      fail('placement', `${where} hangs in a special or undressed region`);
    }
    for (let dx = -1; dx <= 1; dx++) {
      if (taken.has(`${x + dx},${y}`)) fail('placement', `${where} touches another fixture`);
    }
    taken.add(`${x},${y}`);
    if (fixture.circuit !== null) {
      const box = fixture.circuit < fixtures.length ? fixtures[fixture.circuit] : null;
      if (
        fixture.kind !== 'fluorescent_tube' ||
        box?.kind !== 'fuse_box' ||
        box.region !== fixture.region
      ) {
        fail('placement', `${where} is wired to something that is not its room's fuse box`);
      }
    }
  }

  // Lit rooms that call for a wall-hung light and have a face for it.
  for (const room of gameMap.regionMap.rooms) {
    const assignment = gameMap.regionCharacters.forRegion(room.id);
    if (assignment?.type !== 'room' || assignment.unlit) continue;
    const wanted = assignment.character.lighting.sources.filter((source) =>
      isWallFixtureLight(source.kind),
    );
    if (wanted.length === 0) continue;
    let faces = 0;
    for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
      const y = room.bounds.y;
      if (
        isFixtureFace(gameMap.structure, x, y - 1) &&
        !coversFaceBehind(gameMap.structure, x, y)
      ) {
        faces++;
      }
    }
    // Room for a signature fixture at each end and a light between them.
    if (faces < MIN_FACES_FOR_A_LIGHT) continue;
    const lights = fixtures.filter(
      (f) => f.region === room.id && WALL_FIXTURE_SPECS[f.kind].light !== null,
    );
    if (lights.length === 0) {
      fail(
        'placement',
        `${label}: lit ${assignment.character.id} room ${room.id} has faces but no light`,
      );
    }
  }

  const again = buildFloor(level, seed);
  if (fixtureSignature(again) !== fixtureSignature(gameMap)) {
    fail('placement', `${label}: the same seed placed different fixtures`);
  }
  notes.push(`${label}: ${fixtures.length} fixtures ${JSON.stringify(Object.fromEntries(counts))}`);
}

/** The baked dressing leaves a fixture's face bare, and its neighbours without spots. */
function checkDressingCleared(gameMap: GameMap, x: number, y: number, where: string): void {
  const { structure } = gameMap;
  const theme = dungeonFloorTheme().id;
  for (const row of [y, y - 1]) {
    const shape = wallShapeAt(structure, x, row);
    if (shape.face === 'none') continue;
    const own = wallDressingAt(structure, theme, shape, x, row);
    if (own.spotChance !== 0 || own.run !== null) {
      fail('dressing', `${where}: its face still carries baked dressing`);
    }
  }
  for (const dx of [-1, 1]) {
    const shape = wallShapeAt(structure, x + dx, y);
    if (shape.face === 'none') continue;
    if (wallDressingAt(structure, theme, shape, x + dx, y).spotChance !== 0) {
      fail('dressing', `${where}: the face beside it still carries a baked spot`);
    }
  }
}

/** Every electrical room has its fuse box, and in a lit one every tube is wired to it. */
function checkElectricalRooms(): void {
  let rooms = 0;
  for (const seed of ELECTRICAL_SEEDS) {
    const gameMap = buildFloor(2, seed);
    for (const room of gameMap.regionMap.rooms) {
      const assignment = gameMap.regionCharacters.forRegion(room.id);
      if (assignment?.type !== 'room' || assignment.character.id !== 'electrical') continue;
      let faces = 0;
      for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
        const y = room.bounds.y;
        if (
          isFixtureFace(gameMap.structure, x, y - 1) &&
          !coversFaceBehind(gameMap.structure, x, y)
        ) {
          faces++;
        }
      }
      if (faces === 0) continue;
      rooms++;
      const where = `floor 2 seed ${seed}: electrical room ${room.id}`;
      const box = gameMap.wallFixtures.find((f) => f.region === room.id && f.kind === 'fuse_box');
      if (box === undefined) {
        fail('fuse-box', `${where} has no fuse box`);
        continue;
      }
      if (assignment.unlit && !box.state.broken) {
        fail('fuse-box', `${where} is unlit but its breaker is live`);
      }
      for (const tube of gameMap.wallFixtures) {
        if (
          tube.region === room.id &&
          tube.kind === 'fluorescent_tube' &&
          tube.circuit !== box.id
        ) {
          fail('fuse-box', `${where}: a tube is not wired to its fuse box`);
        }
      }
    }
  }
  if (rooms === 0) fail('fuse-box', 'no electrical room with a face on any seed');
  notes.push(`electrical rooms checked: ${rooms}`);
}

// ── Striking ────────────────────────────────────────────────────────────────

/** A crawler on the floor `tilesSouth` tiles in front of a fixture, facing it. */
function crawlerBefore(fixture: WallFixture, tilesSouth: number): HumanPlayer {
  const human = new HumanPlayer(fixture.tileX, fixture.tileY + tilesSouth, TILE_SIZE);
  human.facingX = 0;
  human.facingY = -1;
  return human;
}

/** The first fixture of a kind with two open tiles in front of it, so a crawler can back off. */
function strikeable(gameMap: GameMap, kind: WallFixtureKind): WallFixture | undefined {
  return gameMap.wallFixtures.find(
    (f) =>
      f.kind === kind &&
      isOpen(gameMap, f.tileX, f.tileY + 1) &&
      isOpen(gameMap, f.tileX, f.tileY + 2),
  );
}

function swingUntil(
  props: DestructiblePropSystem,
  human: HumanPlayer,
  done: () => boolean,
): number {
  let swings = 0;
  while (!done() && swings < MAX_SWINGS) {
    props.tryMeleeHit(human, CLOSE_RANGE, SWING_DAMAGE);
    props.update();
    swings++;
  }
  return swings;
}

function checkStriking(gameMap: GameMap, label: string): void {
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), 1);
  const kinds = new Set(gameMap.wallFixtures.map((f) => f.kind));
  for (const kind of kinds) {
    const fixture = strikeable(gameMap, kind);
    if (fixture === undefined) continue;
    const where = `${label}: ${kind} at (${fixture.tileX},${fixture.tileY})`;
    const spec = WALL_FIXTURE_SPECS[kind];
    const wallType = gameMap.structure[fixture.tileY][fixture.tileX].type;

    // Negative: facing away, from two tiles back, nothing lands.
    const away = crawlerBefore(fixture, 2);
    away.facingY = 1;
    const before = { ...fixture.state };
    props.tryMeleeHit(away, SWING_RANGE, SWING_DAMAGE);
    if (
      fixture.state.hp !== before.hp ||
      fixture.state.tearStage !== before.tearStage ||
      fixture.state.swingFrames !== before.swingFrames ||
      fixture.state.hissFrames !== before.hissFrames
    ) {
      fail('striking', `${where} was struck by a swing facing away from it`);
    }

    const human = crawlerBefore(fixture, 1);
    switch (spec.onHit) {
      case 'break': {
        swingUntil(props, human, () => fixture.state.broken);
        if (!fixture.state.broken) fail('striking', `${where} never broke`);
        swingUntil(props, human, () => false);
        if (fixture.state.hp !== 0 || !fixture.state.broken) {
          fail('striking', `${where} changed after it broke`);
        }
        break;
      }
      case 'swing':
        checkMissilePasses(gameMap, props, human, fixture, where);
        props.tryMeleeHit(human, CLOSE_RANGE, SWING_DAMAGE);
        if (fixture.state.swingFrames <= 0) fail('striking', `${where} did not swing`);
        swingUntil(props, human, () => false);
        if (fixture.state.broken) fail('striking', `${where} broke`);
        break;
      case 'tear':
        swingUntil(props, human, () => false);
        if (fixture.state.tearStage !== BANNER_TEAR_STAGES) {
          fail(
            'striking',
            `${where} tore to stage ${fixture.state.tearStage}, not ${BANNER_TEAR_STAGES}`,
          );
        }
        if (fixture.state.broken) fail('striking', `${where} broke`);
        break;
      case 'hiss':
        checkMissilePasses(gameMap, props, human, fixture, where);
        props.tryMeleeHit(human, CLOSE_RANGE, SWING_DAMAGE);
        if (fixture.state.hissFrames <= 0) fail('striking', `${where} did not hiss`);
        swingUntil(props, human, () => false);
        if (fixture.state.broken) fail('striking', `${where} broke`);
        break;
    }
    if (gameMap.structure[fixture.tileY][fixture.tileX].type !== wallType) {
      fail('striking', `${where} changed its wall tile`);
    }
  }
}

/** A missile meeting chains or a valve flies on: the blow lands, but nothing stops it. */
function checkMissilePasses(
  gameMap: GameMap,
  props: DestructiblePropSystem,
  owner: HumanPlayer,
  fixture: WallFixture,
  where: string,
): void {
  const x = (fixture.tileX + HALF) * TILE_SIZE;
  const y = (fixture.tileY + 1 + HALF) * TILE_SIZE;
  // Props beside the face may stop the same missile; only the fixture's own
  // part is in question, so the hit is compared with the fixture taken away.
  const fixtures = gameMap.wallFixtures;
  gameMap.wallFixtures = [];
  const withoutIt = props.tryProjectileHit(x, y, CLOSE_RANGE, SWING_DAMAGE, owner);
  gameMap.wallFixtures = fixtures;
  const withIt = props.tryProjectileHit(x, y, CLOSE_RANGE, SWING_DAMAGE, owner);
  if (withIt && !withoutIt) fail('striking', `${where} stopped a missile`);
}

const HALF = 0.5;
/**
 * Usable faces a lit room needs before a light is owed: a signature fixture
 * at each end, a free face beside each, and one for the light between.
 */
const MIN_FACES_FOR_A_LIGHT = 5;

// A built map: a face with a fixture, the room in front of it, a wall, and a
// corridor south of that wall. The crawler stands in the corridor, south of
// the face, so only line of sight can keep the blow off.
const LOS_MAP_W = 11;
const LOS_MAP_H = 7;
const LOS_FIXTURE = { x: 5, y: 1 } as const;
const LOS_ROOM_ROW = 2;
const LOS_WALL_ROW = 3;
const LOS_CORRIDOR_ROW = 4;
/** Long enough to reach the face from the corridor, three tiles south of it. */
const LOS_REACH_TILES = 3.4;
const LOS_REACH = TILE_SIZE * LOS_REACH_TILES;

function losMap(openWall: boolean): { gameMap: GameMap; fixture: WallFixture } {
  const grid: TileContent[][] = Array.from({ length: LOS_MAP_H }, (_, y) =>
    Array.from({ length: LOS_MAP_W }, (_, x) => {
      const inner = x > 0 && x < LOS_MAP_W - 1;
      const room = y === LOS_ROOM_ROW || y === LOS_CORRIDOR_ROW;
      const gap = openWall && y === LOS_WALL_ROW && x === LOS_FIXTURE.x;
      const open = inner && (room || gap);
      return {
        tileId: `${x}#${y}`,
        type: open ? FloorTypeValue.concrete : FloorTypeValue.wall,
      };
    }),
  );
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  const fixture: WallFixture = {
    id: 0,
    tileX: LOS_FIXTURE.x,
    tileY: LOS_FIXTURE.y,
    kind: 'sconce',
    seed: 0,
    region: 0,
    circuit: null,
    state: freshFixtureState('sconce'),
  };
  gameMap.wallFixtures = [fixture];
  return { gameMap, fixture };
}

/** A crawler south of a face but behind a wall cannot strike it; open the wall and it can. */
function checkLineOfSight(): void {
  for (const openWall of [false, true]) {
    const { gameMap, fixture } = losMap(openWall);
    if (!isFixtureFace(gameMap.structure, fixture.tileX, fixture.tileY)) {
      fail('line-of-sight', "the built map's fixture is not on a face");
    }
    const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), 1);
    const human = new HumanPlayer(LOS_FIXTURE.x, LOS_CORRIDOR_ROW, TILE_SIZE);
    human.facingX = 0;
    human.facingY = -1;
    props.tryMeleeHit(human, LOS_REACH, SWING_DAMAGE);
    const struck = fixture.state.hp !== WALL_FIXTURE_SPECS.sconce.maxHp;
    if (!openWall && struck) fail('line-of-sight', 'a sconce was struck through a wall');
    if (openWall && !struck) {
      fail('line-of-sight', 'negative test: with the wall open the sconce was not struck');
    }
  }
}

// ── Lights and checkpoints ──────────────────────────────────────────────────

function checkLightsAndCheckpoints(gameMap: GameMap, label: string): void {
  const clock = { ms: 0 };
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => clock.ms,
    additiveGlows: () => true,
  });
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), 1);
  const lightOn = (f: WallFixture): boolean => lighting.isLightOnAt(f.tileX, f.tileY);
  const tick = (ms: number): void => {
    clock.ms += ms;
    lighting.update();
    props.update();
  };

  const lit = gameMap.wallFixtures.filter((f) => WALL_FIXTURE_SPECS[f.kind].light !== null);
  for (const fixture of lit) {
    if (!lighting.hasStaticLightAt(fixture.tileX, fixture.tileY)) {
      fail(
        'lights',
        `${label}: ${fixture.kind} at (${fixture.tileX},${fixture.tileY}) registered no light`,
      );
    }
  }

  const whole = props.captureCheckpoint();
  const light =
    lit.find((f) => f.circuit === null && lightOn(f) && strikeable(gameMap, f.kind) === f) ??
    lit.find((f) => f.circuit === null && lightOn(f));
  if (light === undefined) {
    fail('lights', `${label}: no lit fixture on its own circuit to break`);
    return;
  }
  swingUntil(props, crawlerBefore(light, 1), () => light.state.broken);
  tick(FRAME_MS);
  if (lightOn(light)) fail('lights', `${label}: a broken ${light.kind} is still lit`);
  const smashedAt = clock.ms;
  clock.ms = smashedAt + POWER_DOWN_TAIL_SAMPLE_MS;
  if (lighting.dyingCutAt(light.tileX, light.tileY) > 0) {
    fail('lights', `${label}: a smashed ${light.kind} faded like a power-down, not a gutter flash`);
  }
  props.drainWallFixtureEvents();

  // A fuse box takes its room's tubes with it, and only them.
  const box = gameMap.wallFixtures.find(
    (f) => f.kind === 'fuse_box' && gameMap.wallFixtures.some((t) => t.circuit === f.id),
  );
  let tubes: WallFixture[] = [];
  let bystanders: WallFixture[] = [];
  if (box !== undefined) {
    tubes = gameMap.wallFixtures.filter((t) => t.circuit === box.id);
    bystanders = lit.filter((f) => f.circuit !== box.id && f !== light && lightOn(f));
    swingUntil(props, crawlerBefore(box, 1), () => box.state.broken);
    tick(FRAME_MS);
    const blownAt = clock.ms;
    for (const tube of tubes) {
      if (lightOn(tube))
        fail('fuse-box', `${label}: tube at (${tube.tileX},${tube.tileY}) stayed on`);
    }
    const events = props.drainWallFixtureEvents();
    for (const name of ['broken', 'power_down'] as const) {
      if (!events.some((event) => event.kind === 'fuse_box' && event.name === name)) {
        fail('fuse-box', `${label}: blowing the box raised no ${name} event`);
      }
    }
    const tube = tubes[0];
    clock.ms = blownAt + POWER_DOWN_FLICKER_SAMPLE_MS;
    if (lighting.dyingCutAt(tube.tileX, tube.tileY) > POWER_DOWN_FLICKER_MAX_CUT) {
      fail('fuse-box', `${label}: the tubes had no last flicker as they powered down`);
    }
    clock.ms = blownAt + POWER_DOWN_TAIL_SAMPLE_MS;
    if (lighting.dyingCutAt(tube.tileX, tube.tileY) <= 0) {
      fail('fuse-box', `${label}: the tubes guttered out instead of powering down`);
    }
    for (const other of bystanders) {
      if (!lightOn(other) && !other.state.broken) {
        fail(
          'fuse-box',
          `${label}: ${other.kind} at (${other.tileX},${other.tileY}) went out with the box`,
        );
      }
    }
    tick(POWER_DOWN_MS);
    notes.push(`${label}: fuse box ${box.id} put out ${tubes.length} tubes`);
  } else if (label.startsWith('floor 2')) {
    notes.push(`${label}: no fuse box wired to tubes on this seed`);
  }

  const broken = props.captureCheckpoint();
  props.restoreCheckpoint(whole);
  lighting.settleCarriedLights();
  tick(FRAME_MS);
  if (light.state.broken || light.state.hp !== WALL_FIXTURE_SPECS[light.kind].maxHp) {
    fail('checkpoint', `${label}: the ${light.kind} did not come back whole`);
  }
  if (!lightOn(light)) fail('checkpoint', `${label}: the restored ${light.kind} stayed dark`);
  if (box?.state.broken === true) fail('checkpoint', `${label}: the fuse box stayed blown`);
  for (const tube of tubes) {
    if (!lightOn(tube)) fail('checkpoint', `${label}: a tube on the restored box stayed dark`);
  }

  props.restoreCheckpoint(broken);
  lighting.settleCarriedLights();
  tick(FRAME_MS);
  if (lighting.dyingCutAt(light.tileX, light.tileY) > 0) {
    fail('checkpoint', `${label}: restoring a broken ${light.kind} replayed its death flash`);
  }
  if (!light.state.broken || lightOn(light)) {
    fail(
      'checkpoint',
      `${label}: a checkpoint taken after the break did not keep the ${light.kind} out`,
    );
  }
  for (const tube of tubes) {
    if (lightOn(tube)) fail('checkpoint', `${label}: a tube came back on under a blown box`);
  }

  const banner = gameMap.wallFixtures.find((f) => f.kind === 'torn_banner');
  if (banner !== undefined) {
    props.restoreCheckpoint(whole);
    banner.state.tearStage = 2;
    const torn = props.captureCheckpoint();
    props.restoreCheckpoint(whole);
    props.restoreCheckpoint(torn);
    if (banner.state.tearStage !== 2)
      fail('checkpoint', `${label}: a banner's tear did not round-trip`);
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

installCanvasGlobals();
checkLineOfSight();
checkElectricalRooms();

for (const level of FLOORS) {
  for (const seed of SEEDS) {
    const label = `floor ${level} seed ${seed}`;
    checkPlacement(buildFloor(level, seed), label, level, seed);
    checkStriking(buildFloor(level, seed), label);
    checkLightsAndCheckpoints(buildFloor(level, seed), label);
  }
}

for (const note of notes) console.log(note);
if (failures > 0) {
  console.error(`verify-wall-fixtures: ${failures} failure(s)`);
  process.exit(1);
}
console.log('verify-wall-fixtures: all checks passed');
