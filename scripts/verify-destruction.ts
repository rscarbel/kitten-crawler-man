#!/usr/bin/env tsx
/**
 * Headless gate for what breaking things does on floors 1 and 2: behaviour
 * only, never balance.
 *
 * - Every breakable kind, on both floors, breaks under blows and leaves its
 *   wreckage and the spill its kind table names.
 * - Every wall fixture that breaks can be broken.
 * - A sheet-metal piece passes through a dented stage: the first blow that
 *   would break it whole leaves it standing, dented. Anything else breaks.
 * - A blow makes the piece shudder for a few frames, then it is still.
 * - A light goes out when the thing carrying it is broken: a prop's and a
 *   wall fixture's.
 * - A fuse box puts out the tubes wired to it and nothing else.
 * - A gas cylinder's fuse is telegraphed for at least the locked-telegraph floor.
 * - An oil spill catches from a flame (a fireball, a blast, spilled coals),
 *   burns anyone standing in it once its fire has risen, and burns out to char.
 * - Wreckage outlasts a minute, and the cap evicts the oldest piece out of
 *   sight before anything on screen.
 * - A checkpoint round-trip puts back broken props, fixtures, lights, spills,
 *   burning and burnt oil, and glowing coals as they were.
 * - With mobs breaking props turned on, a mob knocked into a prop damages it;
 *   with it off (the default), it does not.
 *
 * Run: npx tsx scripts/verify-destruction.ts
 */

import { createCanvas } from 'canvas';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { GameMap } from '../src/map/GameMap.js';
import {
  BRAZIER,
  BARREL,
  CRATE,
  FloorTypeValue,
  PROP_DAMAGE_STAGE_DENTED,
  type TileContent,
} from '../src/map/tileTypes.js';
import { setDungeonFloorTheme, type DungeonFloorThemeId } from '../src/map/dungeon/floorTheme.js';
import { isOilDrum } from '../src/map/dungeon/propVariants.js';
import {
  WALL_FIXTURE_SPECS,
  freshFixtureState,
  isFixtureLit,
  type WallFixture,
  type WallFixtureKind,
} from '../src/map/dungeon/wallFixtures.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import {
  MULTI_TILE_PROP_FOOTPRINTS,
  multiTileFootprintTiles,
} from '../src/map/serviceLevelProps.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { Rat } from '../src/creatures/Rat.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import {
  ALL_BREAKABLE_PROPS,
  DestructiblePropSystem,
  MOBS_BREAK_PROPS,
  SWARM_HIDING_KINDS,
  TILE_TYPE_FOR_KIND,
  materialsOf,
  startingHpFor,
  type DestructiblePropKind,
} from '../src/systems/DestructiblePropSystem.js';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem.js';
import { dentsBeforeBreaking } from '../src/systems/destruction/breakMaterials.js';
import {
  SERVICE_PROP_KINDS,
  SERVICE_PROP_KIND_LIST,
} from '../src/systems/destruction/serviceLevelPropKinds.js';
import { CELLAR_PROP_KINDS, isCellarPropKind } from '../src/systems/destruction/cellarPropKinds.js';
import {
  REMAINS_PROP_KINDS,
  isRemainsPropKind,
} from '../src/systems/destruction/remainsPropKinds.js';
import { isThemedPropKind } from '../src/sprites/breakablePropSprites.js';
import { themedPropSpill } from '../src/systems/destruction/themedPropMaterials.js';
import {
  COALS_GLOW_FRAMES,
  MAX_WRECKAGE,
  OIL_BURN_FRAMES,
  OIL_FIRE_CATCH_FRAMES,
} from '../src/systems/destruction/wreckageField.js';
import type { SpillKind } from '../src/systems/destruction/spillDecals.js';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling.js';
import type { DynamicLightSource } from '../src/systems/lighting/dynamicLights.js';

installCanvasGlobals();

const GRID = 40;
const FLOOR_NUMBER = 1;
const TILE_CENTRE = 0.5;
/** A blow from a tile away, reaching just past the struck tile's centre. */
const BLOW_REACH = TILE_SIZE * 1.1;
const SWING_DAMAGE = 3;
/** Far more than any piece's health, but still a blow and not a blast. */
const CRUSHING_BLOW = 1000;
const MAX_BLOWS = 40;
/** A minute and a bit, in frames. */
const PAST_A_MINUTE_FRAMES = 3700;
/** A shudder is over within this many frames. */
const WOBBLE_SETTLED_FRAMES = 10;
/** Two oil drums at least this far apart, so neither spill's fire spreads to the other. */
const OIL_DRUM_GAP_TILES = 5;
/** Every gap, in frames, between lighting the first fire and the second. */
const OIL_TWO_FIRE_GAPS = 40;
/** Coals lying by oil set it alight within this many frames. */
const COALS_CATCH_WITHIN_FRAMES = 30;
const THEMES: ReadonlyArray<DungeonFloorThemeId> = ['cellars', 'service_level'];
const REAL_FLOOR_SEEDS = [3, 7];
const VIEW_TILES = 12;
/** A lit fuse that has not gone off in this many times the telegraph floor is a dud. */
const FUSE_GIVE_UP_FACTOR = 10;
/** Tiles kept clear round the bench's edge when looking for an oil drum, so its spill fits. */
const BENCH_EDGE_MARGIN_TILES = 4;
/** Frames an unlit spill is left alone to show it does not catch by itself. */
const UNLIT_SPILL_WATCH_FRAMES = 5;
/**
 * Where the cap-filling crates are laid: rows of them from a corner past the
 * view's far edge, a blank row between rows so no blast reaches its neighbours.
 */
const OFF_SCREEN_WRECKAGE = { firstTile: 16, perRow: 20, rowStep: 2 } as const;

const failures: string[] = [];
const notes: string[] = [];
function fail(area: string, message: string): void {
  failures.push(`[${area}] ${message}`);
}

function flatFloor(): TileContent[][] {
  return Array.from({ length: GRID }, (_, y) =>
    Array.from({ length: GRID }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}

interface Bench {
  readonly gameMap: GameMap;
  readonly props: DestructiblePropSystem;
  readonly human: HumanPlayer;
}

function bench(floorNumber = FLOOR_NUMBER): Bench {
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: flatFloor() });
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), floorNumber);
  return { gameMap, props, human: new HumanPlayer(1, 1, TILE_SIZE) };
}

function centre(tile: number): number {
  return (tile + TILE_CENTRE) * TILE_SIZE;
}

/** One blow on the piece at a tile, from the tile south of it. */
function blow(b: Bench, tileX: number, tileY: number, damage: number): boolean {
  return b.props.tryProjectileHit(centre(tileX), centre(tileY + 1), BLOW_REACH, damage, b.human);
}

/** A blast beside the piece at a tile, from whichever open neighbour can see it. */
function blast(b: Bench, tileX: number, tileY: number): boolean {
  const before = b.gameMap.structure[tileY][tileX].type;
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const row = b.gameMap.structure[tileY + dy];
    const tile = row?.[tileX + dx];
    if (tile === undefined || !isWalkableTileType(tile)) continue;
    b.props.destroyInRadius(centre(tileX + dx), centre(tileY + dy), BLOW_REACH, b.human);
    if (b.gameMap.structure[tileY][tileX].type !== before) return true;
  }
  return false;
}

function expectedSpill(kind: DestructiblePropKind, tileX: number, tileY: number): SpillKind | null {
  const service = SERVICE_PROP_KIND_LIST.find((candidate) => candidate === kind);
  if (service !== undefined) return SERVICE_PROP_KINDS[service].spill;
  if (isCellarPropKind(kind)) return CELLAR_PROP_KINDS[kind].spill;
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].spill;
  if (isThemedPropKind(kind)) return themedPropSpill(kind, tileX, tileY);
  return null;
}

const PROP_TILE = { x: 20, y: 20 } as const;

/**
 * Stands a piece of `kind` at {@link PROP_TILE} the way placement does: its
 * anchor, and for a multi-tile piece its part tiles too. Returns every tile
 * it covers, anchor first.
 */
function stampPiece(gameMap: GameMap, kind: DestructiblePropKind): Array<{ x: number; y: number }> {
  const anchorType = TILE_TYPE_FOR_KIND[kind];
  gameMap.structure[PROP_TILE.y][PROP_TILE.x].type = anchorType;
  const footprint = MULTI_TILE_PROP_FOOTPRINTS.get(anchorType);
  if (footprint === undefined) return [{ ...PROP_TILE }];
  const tiles = multiTileFootprintTiles(PROP_TILE.x, PROP_TILE.y, footprint);
  for (const at of tiles) {
    if (at.x === PROP_TILE.x && at.y === PROP_TILE.y) continue;
    gameMap.structure[at.y][at.x].type = footprint.partType;
  }
  return tiles.map((at) => ({ x: at.x, y: at.y }));
}

// ── Every kind breaks, dents if it is sheet metal, and spills what it should ──

function checkEveryKindBreaks(): void {
  let kinds = 0;
  let dented = 0;
  for (const theme of THEMES) {
    setDungeonFloorTheme(theme);
    for (const kind of ALL_BREAKABLE_PROPS) {
      kinds++;
      const label = `${theme}/${kind}`;
      const b = bench();
      const tile = b.gameMap.structure[PROP_TILE.y][PROP_TILE.x];
      const pieceTiles = stampPiece(b.gameMap, kind);
      // A multi-tile piece is struck through its far part, which must reach its anchor.
      const struck = pieceTiles[pieceTiles.length - 1] ?? PROP_TILE;

      let surprises = 0;
      b.props.setSurpriseSink(() => {
        surprises++;
        return true;
      });
      // Every roll comes up lowest, so a piece that can hide a swarm always does.
      const realRandom = Math.random;
      const dents = dentsBeforeBreaking(materialsOf(kind)[0], startingHpFor(kind));
      Math.random = () => 0;
      blow(b, struck.x, struck.y, CRUSHING_BLOW);
      Math.random = realRandom;
      const standing = tile.type === TILE_TYPE_FOR_KIND[kind];
      if (dents) {
        dented++;
        if (!standing) fail('dent', `${label}: sheet metal broke on its first blow`);
        else if (tile.damageStage !== PROP_DAMAGE_STAGE_DENTED) {
          fail('dent', `${label}: survived its first blow but is not dented`);
        }
      } else if (standing) {
        fail('dent', `${label}: not sheet metal, yet a crushing blow left it standing`);
      }
      if (standing && b.props.wobbleAt(PROP_TILE.x, PROP_TILE.y).x === 0) {
        fail('wobble', `${label}: a blow it survived did not make it shudder`);
      }
      for (let frame = 0; frame < WOBBLE_SETTLED_FRAMES; frame++) b.props.update();
      if (b.props.wobbleAt(PROP_TILE.x, PROP_TILE.y).x !== 0) {
        fail('wobble', `${label}: still shuddering ${WOBBLE_SETTLED_FRAMES} frames after a blow`);
      }

      let blows = 0;
      Math.random = () => 0;
      try {
        while (tile.type === TILE_TYPE_FOR_KIND[kind] && blows < MAX_BLOWS) {
          blow(b, struck.x, struck.y, SWING_DAMAGE);
          blows++;
        }
      } finally {
        Math.random = realRandom;
      }
      if (tile.type === TILE_TYPE_FOR_KIND[kind]) {
        fail('break', `${label}: still standing after ${MAX_BLOWS} blows`);
        continue;
      }
      const hides = SWARM_HIDING_KINDS.has(kind);
      if (hides && surprises === 0) fail('swarm', `${label}: can hide a swarm but none burst out`);
      if (!hides && surprises > 0)
        fail('swarm', `${label}: a swarm burst out of a piece that hides none`);
      const scuttles = b.props.drainPropAudioEvents().filter((e) => e.name === 'scuttled').length;
      if (scuttles !== surprises)
        fail('swarm', `${label}: ${scuttles} scuttle cue(s) for ${surprises} burst(s)`);
      for (const at of pieceTiles) {
        if (!isWalkableTileType(b.gameMap.structure[at.y][at.x])) {
          fail('break', `${label}: its tile at ${at.x},${at.y} did not open to floor`);
        }
      }
      const wreckage = b.props.captureCheckpoint().wreckage;
      const own = wreckage.find((entry) => entry.kind === kind);
      if (own === undefined) {
        fail('break', `${label}: left no wreckage`);
        continue;
      }
      const spill = expectedSpill(kind, PROP_TILE.x, PROP_TILE.y);
      if (own.spill !== spill) {
        fail(
          'spill',
          `${label}: spilled ${own.spill ?? 'nothing'}, its table says ${spill ?? 'nothing'}`,
        );
      }
    }
  }
  notes.push(`${kinds} kind×floor pieces broke; ${dented} of them dented first`);
  if (dented === 0) fail('dent', 'no kind dents at all');
}

// ── Wall fixtures ──

const FACE = { x: 20, y: 1 } as const;

function fixtureBench(kind: WallFixtureKind): { b: Bench; fixture: WallFixture } {
  const grid = flatFloor();
  for (let x = 0; x < GRID; x++) {
    grid[0][x].type = FloorTypeValue.wall;
    grid[1][x].type = FloorTypeValue.wall;
  }
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  const fixture: WallFixture = {
    id: 0,
    tileX: FACE.x,
    tileY: FACE.y,
    kind,
    seed: 0,
    region: 0,
    circuit: null,
    state: freshFixtureState(kind),
  };
  gameMap.wallFixtures = [fixture];
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), FLOOR_NUMBER);
  return { b: { gameMap, props, human: new HumanPlayer(FACE.x, FACE.y + 2, TILE_SIZE) }, fixture };
}

function isFixtureKind(kind: string): kind is WallFixtureKind {
  return kind in WALL_FIXTURE_SPECS;
}

function checkFixturesBreak(): void {
  let broken = 0;
  for (const fixtureKind of Object.keys(WALL_FIXTURE_SPECS).filter(isFixtureKind)) {
    if (WALL_FIXTURE_SPECS[fixtureKind].onHit !== 'break') continue;
    const { b, fixture } = fixtureBench(fixtureKind);
    let blows = 0;
    while (!fixture.state.broken && blows < MAX_BLOWS) {
      b.props.tryProjectileHit(
        centre(FACE.x),
        centre(FACE.y + 1),
        BLOW_REACH,
        SWING_DAMAGE,
        b.human,
      );
      blows++;
    }
    if (!fixture.state.broken)
      fail('fixture', `${fixtureKind}: still whole after ${MAX_BLOWS} blows`);
    else broken++;
    const spill = b.props.captureCheckpoint().wreckage.find((entry) => entry.kind === null);
    if (fixtureKind === 'sconce' && spill?.spill !== 'coals') {
      fail('fixture', 'a broken sconce dropped no coals below it');
    }
  }
  notes.push(`${broken} breakable fixture kinds broke`);
}

// ── Gas cylinder telegraph ──

function checkGasTelegraph(): void {
  setDungeonFloorTheme('service_level');
  const b = bench();
  b.gameMap.structure[PROP_TILE.y][PROP_TILE.x].type = TILE_TYPE_FOR_KIND.gas_cylinder;
  if (!blast(b, PROP_TILE.x, PROP_TILE.y)) {
    fail('gas', 'a blast did not break the gas cylinder');
    return;
  }
  let frames = 0;
  while (
    b.props.drainDetonations().length === 0 &&
    frames < LOCKED_TELEGRAPH_MIN_FRAMES * FUSE_GIVE_UP_FACTOR
  ) {
    b.props.update();
    frames++;
  }
  if (frames < LOCKED_TELEGRAPH_MIN_FRAMES) {
    fail(
      'gas',
      `fuse went off after ${frames} frames, under the ${LOCKED_TELEGRAPH_MIN_FRAMES}-frame floor`,
    );
  }
  notes.push(`gas fuse telegraphed for ${frames} frames (floor ${LOCKED_TELEGRAPH_MIN_FRAMES})`);
}

// ── Oil ──

/** A tile on the service level whose barrel is an oil drum, near the bench's middle. */
function oilDrumTile(fromX = BENCH_EDGE_MARGIN_TILES): { x: number; y: number } {
  for (let y = BENCH_EDGE_MARGIN_TILES; y < GRID - BENCH_EDGE_MARGIN_TILES; y++) {
    for (let x = fromX; x < GRID - BENCH_EDGE_MARGIN_TILES; x++) {
      if (isOilDrum(x, y)) return { x, y };
    }
  }
  throw new Error('no oil drum tile on the bench');
}

function spillState(props: DestructiblePropSystem, x: number, y: number) {
  return props
    .captureCheckpoint()
    .wreckage.find((e) => e.tileX === x && e.tileY === y && e.spill === 'oil');
}

/** A source carrying one fireball at a point, as a fairy's or a spell's would. */
function fireballAt(x: number, y: number): DynamicLightSource {
  return { collectLights: (sink) => sink.add(x, y, 'fireball') };
}

/**
 * Breaks the piece at a tile with blows rather than a blast: a blast is fire
 * and would light the spill it makes.
 */
function splitByBlows(b: Bench, tileX: number, tileY: number): void {
  const type = b.gameMap.structure[tileY][tileX].type;
  for (let i = 0; i < MAX_BLOWS && b.gameMap.structure[tileY][tileX].type === type; i++) {
    blow(b, tileX, tileY, CRUSHING_BLOW);
  }
}

function checkOil(): void {
  setDungeonFloorTheme('service_level');
  const drum = oilDrumTile();

  // Ignition by a fireball passing over it, then burning, hurting, and burning out.
  {
    const b = bench();
    b.gameMap.structure[drum.y][drum.x].type = BARREL;
    splitByBlows(b, drum.x, drum.y);
    const spill = spillState(b.props, drum.x, drum.y);
    if (spill === undefined) {
      fail('oil', 'an oil drum left no oil spill');
      return;
    }
    if (spill.burnFrames !== 0) fail('oil', 'the spill was burning before any flame reached it');
    for (let f = 0; f < UNLIT_SPILL_WATCH_FRAMES; f++) b.props.update();
    if (b.props.hasFire) fail('oil', 'the spill caught with no flame near it');
    b.props.setFlameSources([fireballAt(centre(drum.x), centre(drum.y))]);
    b.props.update();
    b.props.setFlameSources([]);
    if (!b.props.hasFire) fail('oil', 'a fireball over the spill did not set it alight');

    const victim = new HumanPlayer(drum.x, drum.y, TILE_SIZE);
    const startHp = victim.hp;
    let hurtAt = -1;
    for (let f = 0; f < OIL_BURN_FRAMES + 2; f++) {
      b.props.update();
      b.props.burnOccupants([victim]);
      // Counted from the frame the fireball lit it, which was the update before this loop.
      if (hurtAt < 0 && victim.hp < startHp) hurtAt = f + 1;
    }
    if (hurtAt < 0) fail('oil', 'standing in burning oil did no damage');
    else if (hurtAt < LOCKED_TELEGRAPH_MIN_FRAMES) {
      fail('oil', `burning oil hurt ${hurtAt} frames after catching, under the telegraph floor`);
    }
    const after = spillState(b.props, drum.x, drum.y);
    if (b.props.hasFire || after?.burnt !== true) fail('oil', 'the spill did not burn out to char');
    b.props.setFlameSources([fireballAt(centre(drum.x), centre(drum.y))]);
    b.props.update();
    if (b.props.hasFire) fail('oil', 'a charred spill caught fire a second time');
    notes.push(`oil caught from a fireball, first hurt at frame ${hurtAt}, burnt out`);
  }

  // A second fire lit while the first burns waits out its own rise, whatever
  // the gap between them: each spill bites on its own phase.
  {
    const second = oilDrumTile(drum.x + OIL_DRUM_GAP_TILES);
    let earliest = Number.POSITIVE_INFINITY;
    for (let gap = 0; gap < OIL_TWO_FIRE_GAPS; gap++) {
      const b = bench();
      for (const at of [drum, second]) {
        b.gameMap.structure[at.y][at.x].type = BARREL;
        splitByBlows(b, at.x, at.y);
      }
      b.props.igniteSpillsInRadius(centre(drum.x), centre(drum.y), 1);
      for (let f = 0; f < gap; f++) b.props.update();
      b.props.igniteSpillsInRadius(centre(second.x), centre(second.y), 1);
      const victim = new HumanPlayer(second.x, second.y, TILE_SIZE);
      const startHp = victim.hp;
      for (let f = 1; f < OIL_BURN_FRAMES; f++) {
        b.props.update();
        b.props.burnOccupants([victim]);
        if (victim.hp < startHp) {
          earliest = Math.min(earliest, f);
          break;
        }
      }
    }
    if (earliest < LOCKED_TELEGRAPH_MIN_FRAMES) {
      fail(
        'oil',
        `a second fire hurt ${earliest} frames after catching, under the telegraph floor`,
      );
    }
    notes.push(`two fires: the second first hurt ${earliest} frames after catching`);
  }

  // A blast lights it.
  {
    const b = bench();
    b.gameMap.structure[drum.y][drum.x].type = BARREL;
    splitByBlows(b, drum.x, drum.y);
    b.props.update();
    b.props.destroyInRadius(centre(drum.x), centre(drum.y + 1), BLOW_REACH, b.human);
    if (!b.props.hasFire) fail('oil', 'a blast over the spill did not set it alight');
  }

  // A blast that splits the drum lights the oil it lets out.
  {
    const b = bench();
    b.gameMap.structure[drum.y][drum.x].type = BARREL;
    blast(b, drum.x, drum.y);
    if (!b.props.hasFire) fail('oil', 'a blast that split an oil drum left its spill unlit');
  }

  // Coals from a brazier broken beside it light it.
  {
    const b = bench();
    b.gameMap.structure[drum.y][drum.x].type = BARREL;
    splitByBlows(b, drum.x, drum.y);
    b.gameMap.structure[drum.y][drum.x + 1].type = BRAZIER;
    blast(b, drum.x + 1, drum.y);
    const coals = b.props.captureCheckpoint().wreckage.find((e) => e.spill === 'coals');
    if (coals === undefined) fail('coals', 'a broken brazier spilled no coals');
    for (let f = 0; f < COALS_CATCH_WITHIN_FRAMES && !b.props.hasFire; f++) b.props.update();
    if (!b.props.hasFire) fail('oil', 'glowing coals beside the spill did not set it alight');
    for (let f = 0; f < COALS_GLOW_FRAMES + 1; f++) b.props.update();
    const dead = b.props.captureCheckpoint().wreckage.find((e) => e.spill === 'coals');
    if (dead === undefined || dead.glowFrames !== 0)
      fail('coals', 'coals were still glowing after their glow time');
  }

  // The cellars' barrels hold no oil.
  setDungeonFloorTheme('cellars');
  {
    const b = bench();
    b.gameMap.structure[drum.y][drum.x].type = BARREL;
    splitByBlows(b, drum.x, drum.y);
    if (spillState(b.props, drum.x, drum.y) !== undefined)
      fail('oil', 'a cellar barrel spilled oil');
  }
}

// ── Wreckage persists; eviction prefers what is out of sight ──

function checkWreckagePersistsAndEvicts(): void {
  setDungeonFloorTheme('cellars');
  const b = bench();
  b.gameMap.structure[PROP_TILE.y][PROP_TILE.x].type = CRATE;
  blast(b, PROP_TILE.x, PROP_TILE.y);
  for (let f = 0; f < PAST_A_MINUTE_FRAMES; f++) b.props.update();
  if (b.props.captureCheckpoint().wreckage.length !== 1) {
    fail('persist', 'wreckage was gone after a minute');
  }

  // Fill the cap: the first crate lies on screen, every later one off it.
  const fresh = bench();
  const onScreen = { x: 2, y: 2 };
  const laid: Array<{ x: number; y: number }> = [onScreen];
  for (let i = 0; laid.length < MAX_WRECKAGE + 1; i++) {
    const column = i % OFF_SCREEN_WRECKAGE.perRow;
    const row = Math.floor(i / OFF_SCREEN_WRECKAGE.perRow);
    const x = OFF_SCREEN_WRECKAGE.firstTile + column;
    const y = OFF_SCREEN_WRECKAGE.firstTile + row * OFF_SCREEN_WRECKAGE.rowStep;
    laid.push({ x, y });
  }
  setViewportSize(VIEW_TILES * TILE_SIZE, VIEW_TILES * TILE_SIZE);
  const ctx = asGameContext(
    createCanvas(VIEW_TILES * TILE_SIZE, VIEW_TILES * TILE_SIZE).getContext('2d'),
  );
  fresh.props.renderWreckage(ctx, 0, 0);
  for (const at of laid) {
    fresh.gameMap.structure[at.y][at.x].type = CRATE;
    blast(fresh, at.x, at.y);
  }
  const left = fresh.props.captureCheckpoint().wreckage;
  if (left.length !== MAX_WRECKAGE) fail('evict', `cap held ${left.length}, not ${MAX_WRECKAGE}`);
  if (!left.some((e) => e.tileX === onScreen.x && e.tileY === onScreen.y)) {
    fail('evict', 'the oldest wreckage was evicted although it was on screen');
  }
  const firstOffScreen = laid[1];
  if (left.some((e) => e.tileX === firstOffScreen.x && e.tileY === firstOffScreen.y)) {
    fail('evict', 'the oldest off-screen wreckage survived the cap');
  }
}

// ── Real floors: lights, fuse boxes, checkpoints ──

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

function floorBench(level: number, seed: number) {
  const gameMap = buildFloor(level, seed);
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), level);
  const clock = { ms: 0 };
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => clock.ms,
    additiveGlows: () => true,
  });
  const b: Bench = { gameMap, props, human: new HumanPlayer(1, 1, TILE_SIZE) };
  return { b, lighting, clock };
}

function lightsOn(lighting: DungeonLightingSystem): string {
  return lighting
    .staticLightTiles()
    .filter((light) => light.on)
    .map((light) => `${light.x},${light.y}`)
    .join(' ');
}

/** Strikes a wall fixture from the floor in front of it until it breaks. */
function breakFixture(b: Bench, fixture: WallFixture): void {
  for (let i = 0; i < MAX_BLOWS && !fixture.state.broken; i++) {
    b.props.tryProjectileHit(
      centre(fixture.tileX),
      centre(fixture.tileY + 1),
      BLOW_REACH,
      SWING_DAMAGE,
      b.human,
    );
  }
}

function checkLightsAndFuses(level: number, seed: number): void {
  const label = `floor ${level} seed ${seed}`;
  const { b, lighting } = floorBench(level, seed);
  const structure = b.gameMap.structure;

  // A prop carrying a light.
  const carried = lighting
    .staticLightTiles()
    .find(
      (light) =>
        light.on &&
        ALL_BREAKABLE_PROPS.has(kindAt(structure[light.y][light.x].type) ?? 'barrel') &&
        kindAt(structure[light.y][light.x].type) !== null,
    );
  if (carried === undefined) fail('lights', `${label}: no lit prop to break`);
  else {
    // A piece with no open floor beside it cannot be struck at all, which is
    // a placement fault, not a light that failed to go out.
    if (!blast(b, carried.x, carried.y)) {
      fail(
        'placement',
        `${label}: ${carried.kind} at ${carried.x},${carried.y} cannot be reached to break it`,
      );
    } else {
      lighting.update();
      if (lighting.isLightOnAt(carried.x, carried.y)) {
        fail(
          'lights',
          `${label}: ${carried.kind} at ${carried.x},${carried.y} broken and still lit`,
        );
      }
    }
  }

  // A wall fixture carrying a light, on no breaker.
  const fixtures = b.gameMap.wallFixtures;
  const hung = fixtures.find(
    (f) =>
      WALL_FIXTURE_SPECS[f.kind].light !== null &&
      f.circuit === null &&
      isFixtureLit(f, fixtures) &&
      lighting.isLightOnAt(f.tileX, f.tileY),
  );
  if (hung === undefined) fail('lights', `${label}: no lit fixture to break`);
  else {
    breakFixture(b, hung);
    lighting.update();
    if (!hung.state.broken) fail('lights', `${label}: ${hung.kind} could not be broken`);
    if (lighting.isLightOnAt(hung.tileX, hung.tileY)) {
      fail('lights', `${label}: broken ${hung.kind} still lit`);
    }
  }

  // A fuse box puts out its own tubes and nothing else.
  const box = fixtures.find(
    (f) => f.kind === 'fuse_box' && fixtures.some((t) => t.circuit === f.id),
  );
  if (level === 2 && box === undefined) notes.push(`${label}: no wired fuse box on this seed`);
  if (box !== undefined) {
    const before = lighting.staticLightTiles().filter((light) => light.on);
    breakFixture(b, box);
    lighting.update();
    const wired = new Set(
      fixtures.filter((t) => t.circuit === box.id).map((t) => `${t.tileX},${t.tileY}`),
    );
    for (const light of before) {
      const key = `${light.x},${light.y}`;
      const on = lighting.isLightOnAt(light.x, light.y);
      if (wired.has(key) && on) fail('fuse', `${label}: a tube on the blown box stayed lit`);
      if (!wired.has(key) && !on)
        fail('fuse', `${label}: ${light.kind} at ${key} went out with a box it is not wired to`);
    }
    notes.push(`${label}: fuse box put out ${wired.size} tube(s), nothing else`);
  }
}

function kindAt(type: number): DestructiblePropKind | null {
  for (const kind of ALL_BREAKABLE_PROPS) if (TILE_TYPE_FOR_KIND[kind] === type) return kind;
  return null;
}

interface RoomState {
  readonly wreckage: string;
  readonly lights: string;
  readonly fixtures: string;
  readonly fuses: string;
  readonly tiles: string;
}

function roomState(
  b: Bench,
  lighting: DungeonLightingSystem,
  watched: ReadonlyArray<{ x: number; y: number }>,
): RoomState {
  return {
    wreckage: JSON.stringify(b.props.captureCheckpoint().wreckage),
    lights: lightsOn(lighting),
    fixtures: JSON.stringify(
      b.gameMap.wallFixtures.map((f) => [f.state.hp, f.state.broken, f.state.tearStage]),
    ),
    fuses: JSON.stringify(b.props.captureCheckpoint().fuses),
    tiles: watched
      .map(
        (t) =>
          `${b.gameMap.structure[t.y][t.x].type}:${b.gameMap.structure[t.y][t.x].damageStage ?? '-'}`,
      )
      .join(' '),
  };
}

function compare(label: string, want: RoomState, got: RoomState): void {
  for (const key of ['wreckage', 'lights', 'fixtures', 'fuses', 'tiles'] as const) {
    if (want[key] !== got[key]) fail('checkpoint', `${label}: ${key} did not come back as saved`);
  }
}

/**
 * Stands a gas cylinder on the first open room tile with open floor round it,
 * so every floor's round-trip has a fuse to put back mid-hiss.
 */
function standGasCylinder(gameMap: GameMap): { x: number; y: number } {
  const structure = gameMap.structure;
  const open = (x: number, y: number): boolean => {
    const tile = structure[y]?.[x];
    return tile !== undefined && isWalkableTileType(tile);
  };
  for (const room of gameMap.roomBounds) {
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        if (!open(x, y) || !open(x, y + 1) || !open(x, y - 1)) continue;
        structure[y][x].type = TILE_TYPE_FOR_KIND.gas_cylinder;
        return { x, y };
      }
    }
  }
  throw new Error('no open room tile for a gas cylinder');
}

function checkCheckpoint(level: number, seed: number): void {
  const label = `floor ${level} seed ${seed}`;
  const { b, lighting } = floorBench(level, seed);
  const structure = b.gameMap.structure;
  const breakables: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < structure.length; y++) {
    for (let x = 0; x < structure[y].length; x++) {
      if (kindAt(structure[y][x].type) !== null) breakables.push({ x, y });
    }
  }
  const lit = lighting
    .staticLightTiles()
    .filter((light) => light.on && kindAt(structure[light.y][light.x].type) !== null);
  const oil = breakables.find((t) => structure[t.y][t.x].type === BARREL && isOilDrum(t.x, t.y));
  const brazier = breakables.find((t) => structure[t.y][t.x].type === BRAZIER);
  const gas = standGasCylinder(b.gameMap);
  const firstWave = [
    gas,
    ...lit.slice(0, 2).map((l) => ({ x: l.x, y: l.y })),
    ...(oil === undefined ? [] : [oil]),
    ...(brazier === undefined ? [] : [brazier]),
    ...breakables.slice(0, 4),
  ];
  const secondWave = breakables.slice(4, 12);
  const watched = [...firstWave, ...secondWave];
  const fixtures = b.gameMap.wallFixtures;
  const lightFixtures = fixtures.filter((f) => WALL_FIXTURE_SPECS[f.kind].onHit === 'break');

  const clean = roomState(b, lighting, watched);
  const cleanSave = b.props.captureCheckpoint();

  for (const t of firstWave) blast(b, t.x, t.y);
  if (lightFixtures[0] !== undefined) breakFixture(b, lightFixtures[0]);
  if (oil !== undefined) b.props.igniteSpillsInRadius(centre(oil.x), centre(oil.y), TILE_SIZE);
  // A dented or cracked piece too, so damage stages ride along.
  if (secondWave[0] !== undefined) blow(b, secondWave[0].x, secondWave[0].y, SWING_DAMAGE);
  for (let f = 0; f < OIL_FIRE_CATCH_FRAMES * 2; f++) b.props.update();
  lighting.update();
  const midway = roomState(b, lighting, watched);
  const midSave = b.props.captureCheckpoint();
  if (oil !== undefined && !midSave.wreckage.some((e) => e.spill === 'oil' && e.burnFrames > 0)) {
    fail('checkpoint', `${label}: the oil drum's spill was not burning at the save`);
  }
  if (midSave.fuses.length !== 1) {
    fail('checkpoint', `${label}: ${midSave.fuses.length} gas fuse(s) hissing at the save, not 1`);
  }
  b.props.drainFusesLit();

  for (const t of secondWave) blast(b, t.x, t.y);
  for (const f of lightFixtures.slice(1, 3)) breakFixture(b, f);
  for (let f = 0; f < COALS_GLOW_FRAMES + OIL_BURN_FRAMES; f++) b.props.update();
  lighting.update();
  if (JSON.stringify(roomState(b, lighting, watched)) === JSON.stringify(midway)) {
    fail(
      'checkpoint',
      `${label}: nothing changed after the save, so the round-trip proves nothing`,
    );
  }

  b.props.restoreCheckpoint(midSave);
  lighting.settleCarriedLights();
  compare(`${label} (mid-floor save)`, midway, roomState(b, lighting, watched));
  if (b.props.drainFusesLit() === 0) {
    fail('checkpoint', `${label}: a fuse put back hissing raised no hiss`);
  }
  const fuseLeft = midSave.fuses[0]?.framesLeft ?? 0;
  let toBlast = 0;
  while (b.props.drainDetonations().length === 0 && toBlast <= fuseLeft) {
    b.props.update();
    toBlast++;
  }
  if (toBlast !== fuseLeft) {
    fail(
      'checkpoint',
      `${label}: a restored fuse went off after ${toBlast} frames, not ${fuseLeft}`,
    );
  }
  b.props.restoreCheckpoint(midSave);
  lighting.settleCarriedLights();

  b.props.restoreCheckpoint(cleanSave);
  lighting.settleCarriedLights();
  compare(`${label} (clean save)`, clean, roomState(b, lighting, watched));
  notes.push(
    `${label}: checkpoint round-trip over ${watched.length} props, ${lightFixtures.length} breakable fixtures` +
      (oil === undefined ? ', no oil drum' : ', oil drum burning') +
      ', a gas fuse mid-hiss' +
      (brazier === undefined ? '' : ', coals'),
  );
}

// ── Mobs knocked into props ──

function checkMobsBreakProps(): void {
  if (MOBS_BREAK_PROPS) fail('mobs', 'MOBS_BREAK_PROPS ships on; it waits on playtest');
  setDungeonFloorTheme('cellars');
  for (const enabled of [false, true]) {
    const b = bench();
    b.props.mobsBreakProps = enabled;
    const crate = b.gameMap.structure[PROP_TILE.y][PROP_TILE.x];
    crate.type = CRATE;
    const rat = new Rat(PROP_TILE.x - 1, PROP_TILE.y, TILE_SIZE);
    rat.knockbackDirX = 1;
    rat.knockbackDirY = 0;
    rat.knockbackFramesRemaining = 4;
    b.props.knockMobsIntoProps([rat], b.human);
    const damaged = crate.damageStage !== undefined || crate.type !== CRATE;
    if (enabled && !damaged)
      fail('mobs', 'with mobs breaking props on, a shoved rat left the crate untouched');
    if (!enabled && damaged)
      fail('mobs', 'with mobs breaking props off, a shoved rat damaged a crate');
  }
}

// ── Run ──

checkEveryKindBreaks();
checkFixturesBreak();
checkGasTelegraph();
checkOil();
checkWreckagePersistsAndEvicts();
checkMobsBreakProps();
for (const seed of REAL_FLOOR_SEEDS) {
  checkLightsAndFuses(1, seed);
  checkLightsAndFuses(2, seed);
  checkCheckpoint(1, seed);
  checkCheckpoint(2, seed);
}

for (const note of notes) console.log(note);
if (failures.length > 0) {
  console.error(`verify-destruction: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('verify-destruction: all checks passed');
