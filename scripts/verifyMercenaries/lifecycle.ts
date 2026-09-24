/**
 * Headless checks on what every hire shares, run from `verify-mercenaries.ts`
 * against all seven templates through the scene's own frame: the mob loop, death
 * interception, kill resolution, the hireling system and both projectile systems.
 *
 * - Spawning: a hire appears on the tile behind its owner, and on walkable
 *   ground even when the owner's sprite overhangs a corridor wall; every spawn
 *   warms the hired figure, so a hire restored from a save is not drawn cold.
 *   With a wall behind her it lands on her side of it, never on a stairwell,
 *   and with nowhere legal at all it waits and arrives once there is room.
 * - A recall warp dismisses the hire and it stands beside the party again.
 * - Following: an owner who walks off is caught up with, to inside the follow
 *   band; an owner who leaves mid-fight is followed home, and the leash alone
 *   holds a hireling near her when a fight is still in sight.
 * - Credit: a kill landed by the hireling pays its owner the top XP share.
 * - Friendly fire: through a fight with crawlers and Mongo pressed against it,
 *   no ally loses HP to the hireling, while the hostiles do.
 * - Tumbledown's boulder lands on a hostile out of fist reach.
 * - The contract: a checkpoint taken on a floor that has since ended never
 *   brings its hire back.
 * - Survivability: in a standard floor-3 fight that knocks her out alone, the
 *   owner lasts a margin longer with any hire than with the same hire spawned
 *   and sent off before the fight — so both arms draw the same randomness —
 *   and Bucket Boy's share of that margin is his heals.
 *
 * Every rule is paired with a run where it must go the other way, so a check
 * that cannot see its effect fails rather than passes.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { Mongo } from '../../src/creatures/Mongo';
import { Mercenary } from '../../src/creatures/Mercenary';
import { PARTY_CONTACT_SLACK_RATIO, PARTY_HUDDLE_TILES, type Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import {
  MERCENARY_TEMPLATE_IDS,
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../../src/core/mercenaryTemplates';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type MercenaryRoster,
  type MercenaryRosterCheckpoint,
} from '../../src/core/MercenaryRoster';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { SEPARATION_RADIUS } from '../../src/systems/mobSeparation';
import { HirelingBoltSystem } from '../../src/systems/HirelingBoltSystem';
import { RockThrowSystem } from '../../src/systems/RockThrowSystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem';
import { EventBus } from '../../src/core/EventBus';
import { AbilityManager } from '../../src/core/AbilityManager';
import { createMob } from '../../src/levels/spawner';
import { applySpawnDifficulty, DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import { referenceStats } from '../../src/core/referenceCrawler';
import { ALL_STATS } from '../../src/Player';
import { mulberry32 } from '../../src/sprites/person/rng';
import { findNearbyWalkableTile } from '../../src/map/findWalkableTile';
import { setViewportSize } from '../../src/core/Viewport';
import {
  figurePrewarmDepth,
  flushFigureFrameCache,
} from '../../src/sprites/figure/figureFrameCache';

/** How a gate reports; the caller owns the failure count. */
export interface LifecycleGateReporter {
  section(name: string): void;
  check(ok: boolean, message: string): void;
  /** A rule run where it must fail; passes only if it did. */
  checkCatches(ruleHolds: boolean, message: string): void;
}

const FLOOR = 'level3';
const NEXT_FLOOR = 'level4';
const TILE_CENTER = 0.5;

// ── Maps ─────────────────────────────────────────────────────────────────────

const ROOM_WIDTH_TILES = 32;
const ROOM_HEIGHT_TILES = 22;

function makeMap(
  widthTiles: number,
  heightTiles: number,
  isOpen: (x: number, y: number) => boolean,
): GameMap {
  const grid: TileContent[][] = Array.from({ length: heightTiles }, (_, y) =>
    Array.from({ length: widthTiles }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: isOpen(x, y) ? FloorTypeValue.tile_floor : FloorTypeValue.wall,
    })),
  );
  // At the real tile height, or every sight test measures against the wrong grid.
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function makeRoom(): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  return makeMap(
    ROOM_WIDTH_TILES,
    ROOM_HEIGHT_TILES,
    (x, y) => x > 0 && y > 0 && x < lastX && y < lastY,
  );
}

const CORRIDOR_COLUMN = 5;
const CORRIDOR_FIRST_ROW = 2;
const CORRIDOR_LAST_ROW = 14;
const CORRIDOR_WIDTH_TILES = 11;
const CORRIDOR_HEIGHT_TILES = 17;
const CORRIDOR_OWNER_ROW = 10;
/**
 * How far the owner's sprite may overhang the corridor's west wall: the
 * player's own collision tests her leading edge at 0.28 of a tile in from her
 * left, so her top-left corner can sit this far over the masonry.
 */
const CORRIDOR_OVERHANG_TILES = 0.25;

function makeCorridor(): GameMap {
  return makeMap(
    CORRIDOR_WIDTH_TILES,
    CORRIDOR_HEIGHT_TILES,
    (x, y) => x === CORRIDOR_COLUMN && y >= CORRIDOR_FIRST_ROW && y <= CORRIDOR_LAST_ROW,
  );
}

// ── The scene ────────────────────────────────────────────────────────────────

interface Scene {
  readonly map: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly mobs: MobRoster;
  readonly roster: MercenaryRoster;
  readonly system: MercenarySystem;
  readonly ctx: SystemContext;
  readonly combat: CombatContext;
  readonly mobLoop: MobUpdateLoop;
  readonly rocks: RockThrowSystem;
  readonly bolts: HirelingBoltSystem;
  /** Everyone on the party's side the scene lists for the hireling, beside it. */
  readonly extras: Player[];
}

interface SceneLayout {
  readonly map: GameMap;
  readonly humanTile: { readonly x: number; readonly y: number };
  readonly catTile: { readonly x: number; readonly y: number };
}

function buildScene(hire: MercenaryTemplateId | null, layout: SceneLayout): Scene {
  const { map } = layout;
  const human = new HumanPlayer(layout.humanTile.x, layout.humanTile.y, TILE_SIZE);
  const cat = new CatPlayer(layout.catTile.x, layout.catTile.y, TILE_SIZE);
  human.isActive = true;
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const roster = createMercenaryRoster();
  roster.active =
    hire === null
      ? null
      : {
          id: hire,
          name: getMercenaryTemplate(hire).name,
          contractLevelId: FLOOR,
          introduced: true,
        };
  const system = new MercenarySystem(roster, FLOOR);
  const extras: Player[] = [];
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
    extraTargets: extras,
  };
  const combat: CombatContext = {
    human,
    cat,
    mobs: mobs.mobs,
    mobGrid: mobs.grid,
    gameMap: map,
    safeRoom: null,
    bus: new EventBus(),
    abilityManager: new AbilityManager(),
    spells,
    hitLanded: false,
  };
  const scene: Scene = {
    map,
    human,
    cat,
    mobs,
    roster,
    system,
    ctx,
    combat,
    mobLoop: new MobUpdateLoop(),
    rocks: new RockThrowSystem(map),
    bolts: new HirelingBoltSystem(map, () => false),
    extras,
  };
  system.update(ctx);
  const merc = system.activeMerc;
  // The scene lists its live hireling among the extra targets, so hostiles can
  // pick it out and the hireling can tell its allies apart from itself.
  if (merc !== null) extras.push(merc);
  return scene;
}

/** One frame of the scene, in `DungeonScene`'s order. */
function step(scene: Scene): void {
  scene.mobLoop.update(scene.ctx);
  scene.system.checkHealth();
  resolveKills(scene.combat);
  scene.system.update(scene.ctx);
  scene.human.tickTimers();
  scene.cat.tickTimers();
  scene.rocks.update(scene.ctx);
  scene.bolts.update(scene.ctx);
}

function placeAtTile(body: { x: number; y: number }, tileX: number, tileY: number): void {
  body.x = tileX * TILE_SIZE;
  body.y = tileY * TILE_SIZE;
}

function tileOf(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
  };
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

/** A goblin that stands where it is put and never swings: a target, not a threat. */
function addDummy(scene: Scene, tileX: number, tileY: number): Mob {
  const mob = createMob('goblin', tileX, tileY, scene.map);
  placeAtTile(mob, tileX, tileY);
  mob.aiHeld = true;
  scene.mobs.add(mob);
  return mob;
}

/** Runs the Mongo constructor the way `MongoSystem` does: at full health for his level. */
function makeMongo(owner: Player, tileX: number, tileY: number): Mongo {
  const probe = new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, 1);
  return new Mongo(tileX, tileY, TILE_SIZE, owner, MONGO_LEVEL, probe.maxHp);
}

const MONGO_LEVEL = 1;

// ── Spawning ─────────────────────────────────────────────────────────────────

const SPAWN_ROOM_TILE_X = 10;
const SPAWN_ROOM_TILE_Y = 10;

/** Which tile a facing puts behind its owner. */
interface Facing {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

const FACINGS: readonly Facing[] = [
  { label: 'east', x: 1, y: 0 },
  { label: 'north', x: 0, y: -1 },
];

function spawnFacing(id: MercenaryTemplateId, facing: Facing): Mercenary | null {
  const map = makeRoom();
  const human = new HumanPlayer(SPAWN_ROOM_TILE_X, SPAWN_ROOM_TILE_Y, TILE_SIZE);
  human.facingX = facing.x;
  human.facingY = facing.y;
  const scene = buildSceneAround(id, map, human);
  return scene.system.activeMerc;
}

/** A scene whose owner has been positioned and faced before the hire spawns. */
function buildSceneAround(id: MercenaryTemplateId, map: GameMap, human: HumanPlayer): Scene {
  const scene = buildSceneDeferred(id, map);
  scene.human.x = human.x;
  scene.human.y = human.y;
  scene.human.facingX = human.facingX;
  scene.human.facingY = human.facingY;
  scene.system.update(scene.ctx);
  const merc = scene.system.activeMerc;
  if (merc !== null) scene.extras.push(merc);
  return scene;
}

/**
 * The same scene as {@link buildScene}, with the hireling not yet spawned:
 * the hire is signed but the system has not had its first frame.
 */
function buildSceneDeferred(id: MercenaryTemplateId, map: GameMap): Scene {
  const scene = buildScene(null, {
    map,
    humanTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y },
    catTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y },
  });
  const system = new MercenarySystem(scene.roster, FLOOR);
  scene.roster.active = {
    id,
    name: getMercenaryTemplate(id).name,
    contractLevelId: FLOOR,
    introduced: true,
  };
  return { ...scene, system };
}

function standsOn(merc: Mercenary, tileX: number, tileY: number): boolean {
  const tile = tileOf(merc);
  return tile.x === tileX && tile.y === tileY;
}

function standsOnFloor(map: GameMap, merc: Mercenary): boolean {
  const tile = tileOf(merc);
  return map.isWalkable(tile.x, tile.y) && !map.isStairwellTile(tile.x, tile.y);
}

/**
 * Whether a hire spawned beside an owner whose sprite overhangs a corridor's
 * west wall stands on floor. `misplace`, if given, moves it after it spawns.
 */
function spawnsOnFloorFromCorridor(
  id: MercenaryTemplateId,
  misplace?: (merc: Mercenary) => void,
): boolean {
  const map = makeCorridor();
  const human = new HumanPlayer(CORRIDOR_COLUMN, CORRIDOR_OWNER_ROW, TILE_SIZE);
  human.x = (CORRIDOR_COLUMN - CORRIDOR_OVERHANG_TILES) * TILE_SIZE;
  human.facingX = 0;
  human.facingY = -1;
  const scene = buildSceneAround(id, map, human);
  const merc = scene.system.activeMerc;
  if (merc === null) return false;
  misplace?.(merc);
  return standsOnFloor(map, merc);
}

/**
 * Whether bringing the hire into a scene queued any figure warming. The scene
 * — Carl, who warms his own rows, included — is built first and the cache
 * emptied after, so only what the arrival itself asked for is counted.
 */
function arrivalWarms(
  id: MercenaryTemplateId,
  arrive: (scene: Scene) => Mercenary | null,
): boolean {
  const scene = buildSceneDeferred(id, makeRoom());
  flushFigureFrameCache();
  const merc = arrive(scene);
  const warmed = merc !== null && figurePrewarmDepth() > 0;
  flushFigureFrameCache();
  return warmed;
}

function arriveThroughTheSystem(scene: Scene): Mercenary | null {
  scene.system.update(scene.ctx);
  return scene.system.activeMerc;
}

/** A hireling put straight into the scene, the way no spawn path should. */
function arriveBuiltByHand(scene: Scene): Mercenary {
  const hired = scene.roster.active;
  const id = hired?.id ?? 'sledge';
  return new Mercenary(
    SPAWN_ROOM_TILE_X,
    SPAWN_ROOM_TILE_Y,
    TILE_SIZE,
    scene.human,
    id,
    getMercenaryTemplate(id).name,
  );
}

function checkSpawning(report: LifecycleGateReporter): void {
  report.section('Every hire spawns behind its owner, on floor, warmed');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const behind = FACINGS.every((facing) => {
      const merc = spawnFacing(id, facing);
      return (
        merc !== null && standsOn(merc, SPAWN_ROOM_TILE_X - facing.x, SPAWN_ROOM_TILE_Y - facing.y)
      );
    });
    report.check(behind, `${id} spawns on the tile behind its owner, facing east or north`);
    report.check(
      spawnsOnFloorFromCorridor(id),
      `${id} spawns on walkable ground when the owner's sprite overhangs a corridor wall`,
    );
    report.check(
      arrivalWarms(id, arriveThroughTheSystem),
      `${id}: a spawn from a restored contract warms the hired figure`,
    );
  }
  const east = FACINGS[0];
  const eastMerc = spawnFacing('sledge', east);
  report.checkCatches(
    eastMerc !== null && standsOn(eastMerc, SPAWN_ROOM_TILE_X + east.x, SPAWN_ROOM_TILE_Y + east.y),
    'the behind-the-owner measure tells the tile behind her from the one in front',
  );
  report.checkCatches(
    spawnsOnFloorFromCorridor('sledge', (merc) => {
      // The tile under the owner's top-left corner: the masonry she overhangs.
      placeAtTile(merc, CORRIDOR_COLUMN - 1, CORRIDOR_OWNER_ROW);
    }),
    "a hire put on the tile under the owner's top-left corner is caught standing in the wall",
  );
  report.checkCatches(
    arrivalWarms('sledge', arriveBuiltByHand),
    'a hireling built outside the spawn path is caught arriving cold',
  );
}

// ── Where a hire goes when behind her is no good ─────────────────────────────

/** A wall runs down this column; the owner stands just east of it, facing east. */
const PARTITION_COLUMN = 5;
const PARTITION_WIDTH_TILES = 16;
const PARTITION_HEIGHT_TILES = 12;
const PARTITION_ROW = 6;
/** How far the owner's side of the wall is open: a one-tile passage running east. */
const PARTITION_PASSAGE_END_COLUMN = 12;

/**
 * An open room west of a full-height wall, and a one-tile passage east of it
 * where the owner stands with her back to the wall. The roomy tiles nearest the
 * tile behind her are all across the wall.
 */
function makePartition(): GameMap {
  const lastX = PARTITION_WIDTH_TILES - 1;
  const lastY = PARTITION_HEIGHT_TILES - 1;
  return makeMap(PARTITION_WIDTH_TILES, PARTITION_HEIGHT_TILES, (x, y) => {
    if (x === 0 || y === 0 || x === lastX || y === lastY) return false;
    if (x < PARTITION_COLUMN) return true;
    return y === PARTITION_ROW && x > PARTITION_COLUMN && x <= PARTITION_PASSAGE_END_COLUMN;
  });
}

function ownerFacingEast(tileX: number, tileY: number): HumanPlayer {
  const human = new HumanPlayer(tileX, tileY, TILE_SIZE);
  human.facingX = 1;
  human.facingY = 0;
  return human;
}

/** How far the ring search may look, as `MercenarySystem` searches. */
const SPAWN_SEARCH_RADIUS_TILES = 3;

/** The tile the ring search starts from: behind an owner at `tileX, tileY` facing east. */
function behindEastFacing(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX - 1, y: tileY };
}

function spawnsOnOwnersSide(): boolean {
  const map = makePartition();
  const ownerTileX = PARTITION_COLUMN + 1;
  const scene = buildSceneAround('bomo', map, ownerFacingEast(ownerTileX, PARTITION_ROW));
  const merc = scene.system.activeMerc;
  return merc !== null && tileOf(merc).x > PARTITION_COLUMN && standsOnFloor(map, merc);
}

/** Where a search with no sight test would put the hire in the same spot. */
function sightBlindSpawnIsAcrossTheWall(): boolean {
  const map = makePartition();
  const behind = behindEastFacing(PARTITION_COLUMN + 1, PARTITION_ROW);
  const tile = findNearbyWalkableTile(
    map,
    behind.x,
    behind.y,
    SPAWN_SEARCH_RADIUS_TILES,
    (x, y) => !map.isStairwellTile(x, y),
  );
  return tile !== null && tile.x < PARTITION_COLUMN;
}

function spawnsOffTheStairwell(): { avoided: boolean; blindLandsOnIt: boolean } {
  const map = makeRoom();
  const behind = behindEastFacing(SPAWN_ROOM_TILE_X, SPAWN_ROOM_TILE_Y);
  map.setStairwellTiles([behind]);
  const blind = findNearbyWalkableTile(map, behind.x, behind.y, SPAWN_SEARCH_RADIUS_TILES);
  const blindLandsOnIt = blind !== null && map.isStairwellTile(blind.x, blind.y);
  const scene = buildSceneAround(
    'splash_zone',
    map,
    ownerFacingEast(SPAWN_ROOM_TILE_X, SPAWN_ROOM_TILE_Y),
  );
  const merc = scene.system.activeMerc;
  const avoided = merc !== null && standsOnFloor(map, merc);
  return { avoided, blindLandsOnIt };
}

/** A solid block of rock, deeper than the ring search, with a room beyond it. */
const SEALED_WIDTH_TILES = 24;
const SEALED_HEIGHT_TILES = 14;
const SEALED_ROCK_END_COLUMN = 12;
/** Buried this deep, no tile within the search is open. */
const SEALED_OWNER_TILE_X = 5;
const SEALED_OWNER_TILE_Y = 7;
const SEALED_ROOM_TILE_X = 18;

function makeSealed(): GameMap {
  const lastX = SEALED_WIDTH_TILES - 1;
  const lastY = SEALED_HEIGHT_TILES - 1;
  return makeMap(
    SEALED_WIDTH_TILES,
    SEALED_HEIGHT_TILES,
    (x, y) => x > SEALED_ROCK_END_COLUMN && x < lastX && y > 0 && y < lastY,
  );
}

interface SealedOutcome {
  readonly spawnedWhileSealed: boolean;
  readonly contractKept: boolean;
  readonly spawnedAfterward: boolean;
}

/**
 * An owner scripted into solid rock, where no tile will hold a hire, and then
 * — if `walksOut` — set down in open floor. The contract must wait rather than
 * be spent, and the hire arrive once there is somewhere to put it.
 */
function sealedSpawn(walksOut: boolean): SealedOutcome {
  const map = makeSealed();
  const scene = buildSceneAround(
    'dong_quixote',
    map,
    ownerFacingEast(SEALED_OWNER_TILE_X, SEALED_OWNER_TILE_Y),
  );
  const spawnedWhileSealed = scene.system.activeMerc !== null;
  const contractKept = scene.roster.active !== null;
  if (walksOut) placeAtTile(scene.human, SEALED_ROOM_TILE_X, SEALED_OWNER_TILE_Y);
  scene.system.update(scene.ctx);
  const merc = scene.system.activeMerc;
  return {
    spawnedWhileSealed,
    contractKept,
    spawnedAfterward: merc !== null && standsOnFloor(map, merc),
  };
}

function checkSpawnFallbacks(report: LifecycleGateReporter): void {
  report.section('Where a hire goes when the tile behind its owner is no good');
  report.check(
    spawnsOnOwnersSide(),
    'with a wall behind her and open room beyond it, the hire lands on her side of the wall',
  );
  report.checkCatches(
    !sightBlindSpawnIsAcrossTheWall(),
    'a search with no sight test is caught putting the hire across the wall',
  );
  const stairs = spawnsOffTheStairwell();
  report.check(stairs.avoided, 'with a stairwell behind her, the hire lands off it');
  report.checkCatches(
    !stairs.blindLandsOnIt,
    'a search that admits stairwells is caught putting the hire on one',
  );
  const sealed = sealedSpawn(true);
  report.check(
    !sealed.spawnedWhileSealed && sealed.contractKept,
    'with nowhere to put the hire, none appears and the contract waits',
  );
  report.check(
    sealed.spawnedAfterward,
    'once the owner stands somewhere with room, the hire arrives on the next frame',
  );
  report.checkCatches(
    sealedSpawn(false).spawnedAfterward,
    'an owner still sealed in is caught with no hire, so the arrival is the move',
  );
}

// ── A recall warp ────────────────────────────────────────────────────────────

const WARP_TILE_X = 24;
const WARP_TILE_Y = 14;
/** The hire must be back and standing near her within this many frames of the warp. */
const WARP_RETURN_FRAMES = 2;
/** How near the landing a returned hire must stand. */
const WARP_ARRIVAL_TILES = 2;

type Warp = (scene: Scene) => void;

/** `DungeonScene.warpPartyForRecall`'s order: the hire is dismissed, the party moved. */
const sceneWarp: Warp = (scene) => {
  scene.system.dismiss(scene.mobs.mobs, scene.mobs.grid);
  placeAtTile(scene.human, WARP_TILE_X, WARP_TILE_Y);
  placeAtTile(scene.cat, WARP_TILE_X, WARP_TILE_Y + 1);
};

/** A warp that pulls the hire's body out of the world behind the system's back. */
const bodySnatchingWarp: Warp = (scene) => {
  const merc = scene.system.activeMerc;
  if (merc !== null) {
    scene.mobs.grid.remove(merc);
    scene.mobs.mobs.splice(scene.mobs.mobs.indexOf(merc), 1);
  }
  placeAtTile(scene.human, WARP_TILE_X, WARP_TILE_Y);
  placeAtTile(scene.cat, WARP_TILE_X, WARP_TILE_Y + 1);
};

/** Whether a live hire stands in the world beside the owner a moment after the warp. */
function hireSurvivesWarp(warp: Warp): boolean {
  const scene = buildScene('tumbledown', {
    map: makeRoom(),
    humanTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y },
    catTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y + 1 },
  });
  step(scene);
  warp(scene);
  for (let f = 0; f < WARP_RETURN_FRAMES; f++) step(scene);
  return scene.mobs.mobs.some(
    (mob) =>
      mob instanceof Mercenary &&
      mob.isAlive &&
      tilesBetween(mob, scene.human) <= WARP_ARRIVAL_TILES,
  );
}

function checkWarp(report: LifecycleGateReporter): void {
  report.section('A recall warp keeps the hire');
  report.check(
    hireSurvivesWarp(sceneWarp),
    "after the Wayfinder's Anchor warp, the hire is standing beside the party again",
  );
  report.checkCatches(
    hireSurvivesWarp(bodySnatchingWarp),
    'a hire taken out of the world without the system knowing is caught gone',
  );
}

// ── Allies never move the party ──────────────────────────────────────────────

const SHOVE_OWNER_TILE_X = 8;
const SHOVE_TILE_Y = 10;
/** Straight ahead of her, so the hire's way to it runs through both crawlers. */
const SHOVE_FOE_OFFSET_TILES = 8;
const SHOVE_FRAMES = 600;
/** How far a crawler may drift while standing still beside her hire: rounding, not a shove. */
const PARTY_DISPLACEMENT_TOLERANCE_TILES = 0.05;

const LANE_WIDTH_TILES = 30;
const LANE_HEIGHT_TILES = 5;
const LANE_ROW = 2;

/** A one-tile corridor running east, where nobody can step aside for anybody. */
function makeLane(): GameMap {
  const lastX = LANE_WIDTH_TILES - 1;
  return makeMap(
    LANE_WIDTH_TILES,
    LANE_HEIGHT_TILES,
    (x, y) => y === LANE_ROW && x > 0 && x < lastX,
  );
}

interface ShoveOutcome {
  /** The furthest either crawler was moved from where she stood. */
  readonly worstPartyDriftTiles: number;
  readonly foeHit: boolean;
}

/**
 * The owner stands still, facing a hostile down the line, with the cat just in
 * front of her and the hire behind: every step the hire takes toward the fight
 * runs into both crawlers. `asEnemyWould`, if set, gives the hire the collision
 * every other mob has, which shoves a crawler out of its way.
 */
function shoveOutcome(
  id: MercenaryTemplateId,
  map: GameMap,
  row: number,
  asEnemyWould = false,
): ShoveOutcome | null {
  const scene = buildScene(id, {
    map,
    humanTile: { x: SHOVE_OWNER_TILE_X, y: row },
    catTile: { x: SHOVE_OWNER_TILE_X + 1, y: row },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  if (asEnemyWould) Object.defineProperty(merc, 'yieldsToParty', { value: false });
  const foe = addDummy(scene, SHOVE_OWNER_TILE_X + SHOVE_FOE_OFFSET_TILES, row);
  const starts = [scene.human, scene.cat].map((crawler) => ({
    crawler,
    x: crawler.x,
    y: crawler.y,
  }));
  let worst = 0;
  let foeHit = false;
  for (let f = 0; f < SHOVE_FRAMES; f++) {
    // Kept alive, so the fight lasts the whole run and so does the pressure on the party.
    foe.hp = foe.maxHp;
    step(scene);
    if (foe.hp < foe.maxHp) foeHit = true;
    for (const start of starts) {
      worst = Math.max(worst, tilesBetween(start.crawler, start));
    }
  }
  return { worstPartyDriftTiles: worst, foeHit };
}

function partyStayedPut(outcome: ShoveOutcome | null): boolean {
  return outcome !== null && outcome.worstPartyDriftTiles <= PARTY_DISPLACEMENT_TOLERANCE_TILES;
}

function describeShove(outcome: ShoveOutcome | null): string {
  if (outcome === null) return 'no hireling';
  return `party moved ${outcome.worstPartyDriftTiles.toFixed(2)} tiles, foe ${outcome.foeHit ? 'hit' : 'untouched'}`;
}

function checkPartyNotShoved(report: LifecycleGateReporter): void {
  report.section('A hire never moves the party, and gets past it to the fight');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    // A medic never picks a fight, so for him only the standing still is asked.
    const fights = id !== 'bucket_boy';
    const open = shoveOutcome(id, makeRoom(), SHOVE_TILE_Y);
    report.check(
      partyStayedPut(open) && (!fights || open?.foeHit === true),
      `${id}, in the open with both crawlers between it and the fight: ${describeShove(open)}`,
    );
    const lane = shoveOutcome(id, makeLane(), LANE_ROW);
    report.check(
      partyStayedPut(lane) && (!fights || lane?.foeHit === true),
      `${id}, in a one-tile corridor behind both crawlers: ${describeShove(lane)}`,
    );
  }
  const shoved = shoveOutcome('gluteus_maxx', makeRoom(), SHOVE_TILE_Y, true);
  report.checkCatches(
    partyStayedPut(shoved),
    `a hire that does not yield to the party is caught carrying it (${describeShove(shoved)})`,
  );
}

// ── Coming home to a party with a crawler in the way ─────────────────────────

const HOMECOMING_OWNER_TILE_X = 16;
const HOMECOMING_OWNER_TILE_Y = 11;
/** The other crawler stands this far toward the returning hire in the one-tile-gap cases. */
const HOMECOMING_CAT_OFFSET_TILES = 1;
/** The hire starts this far beyond the crawler in its way, so it walks up to her. */
const HOMECOMING_RUN_UP_TILES = 4;
const HOMECOMING_START_OFFSET_TILES = HOMECOMING_CAT_OFFSET_TILES + HOMECOMING_RUN_UP_TILES;
const HOMECOMING_FRAMES = 480;
/** The second half of the run, by when every hire has arrived and must stay settled. */
const HOMECOMING_SETTLED_FRAME = HOMECOMING_FRAMES / 2;
/**
 * How far inside a crawler's separation radius a resting hire may sit: a
 * whisker of rounding, not a body standing half inside her.
 */
const CRAWLER_OVERLAP_TOLERANCE_TILES = 0.1;
const SEPARATION_RADIUS_TILES = SEPARATION_RADIUS / TILE_SIZE;
/**
 * How far the crawler in the way stands from the owner: from right beside her
 * out to where a following crawler trails.
 */
const HOMECOMING_NEAREST_GAP_TILES = 1;
const HOMECOMING_FARTHEST_GAP_TILES = 2.5;
const HOMECOMING_GAP_STEP_TILES = 0.5;
const HOMECOMING_GAPS_TILES: readonly number[] = Array.from(
  {
    length:
      Math.round(
        (HOMECOMING_FARTHEST_GAP_TILES - HOMECOMING_NEAREST_GAP_TILES) / HOMECOMING_GAP_STEP_TILES,
      ) + 1,
  },
  (_, i) => HOMECOMING_NEAREST_GAP_TILES + i * HOMECOMING_GAP_STEP_TILES,
);
/** How far off the line from the hire to the owner she stands: square in its path, then grazing it. */
const HOMECOMING_GRAZE_TILES = 0.5;
const HOMECOMING_LATERAL_TILES: readonly number[] = [0, HOMECOMING_GRAZE_TILES];

interface Heading {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** Which side of the owner the hire comes home from. */
const APPROACHES: readonly Heading[] = [
  { label: 'west', x: -1, y: 0 },
  { label: 'east', x: 1, y: 0 },
  { label: 'north', x: 0, y: -1 },
  { label: 'south', x: 0, y: 1 },
];

interface Homecoming {
  readonly gapTiles: number;
  readonly lateralTiles: number;
  readonly from: Heading;
}

interface HomecomingOutcome {
  /** The closest the hire came to either crawler once settled, in tiles. */
  readonly nearestCrawlerTiles: number;
  /** How many times it switched between walking and standing once settled. */
  readonly gaitToggles: number;
  /** How far from the owner it came to rest, in tiles. */
  readonly restTiles: number;
  /** As near the owner as it could have got: its band, or against the crawler in its way. */
  readonly reachableTiles: number;
}

type RestRule = (merc: Mercenary) => boolean;

/**
 * The owner stands still with the cat between her and the hire, which comes
 * home from further out on that side. `rule`, if given, replaces the hire's
 * own rest rule.
 */
function homecoming(
  id: MercenaryTemplateId,
  map: GameMap,
  ownerTile: { readonly x: number; readonly y: number },
  shape: Homecoming,
  rule?: RestRule,
): HomecomingOutcome | null {
  const scene = buildScene(id, {
    map,
    humanTile: ownerTile,
    catTile: ownerTile,
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  withoutStuckRescue(merc);
  if (rule !== undefined)
    Object.defineProperty(merc, 'restsAgainstParty', { value: () => rule(merc) });
  const { from } = shape;
  const sideways = { x: -from.y, y: from.x };
  scene.cat.x =
    scene.human.x + TILE_SIZE * (from.x * shape.gapTiles + sideways.x * shape.lateralTiles);
  scene.cat.y =
    scene.human.y + TILE_SIZE * (from.y * shape.gapTiles + sideways.y * shape.lateralTiles);
  const startTiles = shape.gapTiles + HOMECOMING_RUN_UP_TILES;
  merc.x = scene.human.x + TILE_SIZE * from.x * startTiles;
  merc.y = scene.human.y + TILE_SIZE * from.y * startTiles;
  let nearest = Number.POSITIVE_INFINITY;
  let toggles = 0;
  let wasMoving: boolean | null = null;
  for (let f = 0; f < HOMECOMING_FRAMES; f++) {
    step(scene);
    if (f < HOMECOMING_SETTLED_FRAME) continue;
    for (const crawler of [scene.human, scene.cat]) {
      nearest = Math.min(nearest, tilesBetween(merc, crawler));
    }
    if (wasMoving !== null && merc.isMoving !== wasMoving) toggles++;
    wasMoving = merc.isMoving;
  }
  const againstHer = shape.gapTiles + SEPARATION_RADIUS_TILES * PARTY_CONTACT_SLACK_RATIO;
  return {
    nearestCrawlerTiles: nearest,
    gaitToggles: toggles,
    restTiles: tilesBetween(merc, scene.human),
    reachableTiles: Math.max(merc.kit.followBand.startTiles, againstHer),
  };
}

function settledClear(outcome: HomecomingOutcome | null): boolean {
  return (
    outcome !== null &&
    outcome.nearestCrawlerTiles >= SEPARATION_RADIUS_TILES - CRAWLER_OVERLAP_TOLERANCE_TILES &&
    outcome.gaitToggles === 0 &&
    outcome.restTiles <= outcome.reachableTiles + FOLLOW_SLACK_TILES
  );
}

function describeShape(shape: Homecoming): string {
  return `from the ${shape.from.label}, crawler ${shape.gapTiles} tiles out and ${shape.lateralTiles} off the line`;
}

function describeHomecoming(outcome: HomecomingOutcome | null): string {
  if (outcome === null) return 'no hireling';
  return `nearest crawler ${outcome.nearestCrawlerTiles.toFixed(2)} tiles, ${outcome.gaitToggles} walk/stand switches, resting ${outcome.restTiles.toFixed(2)} tiles from the owner`;
}

/** Every shape in the open room, and the on-the-line ones along a one-tile corridor. */
function homecomingSweep(): {
  map: () => GameMap;
  ownerTile: { x: number; y: number };
  shape: Homecoming;
}[] {
  const shapes: { map: () => GameMap; ownerTile: { x: number; y: number }; shape: Homecoming }[] =
    [];
  const roomOwner = { x: HOMECOMING_OWNER_TILE_X, y: HOMECOMING_OWNER_TILE_Y };
  const laneOwner = { x: HOMECOMING_OWNER_TILE_X, y: LANE_ROW };
  for (const gapTiles of HOMECOMING_GAPS_TILES) {
    for (const from of APPROACHES) {
      for (const lateralTiles of HOMECOMING_LATERAL_TILES) {
        shapes.push({
          map: makeRoom,
          ownerTile: roomOwner,
          shape: { gapTiles, lateralTiles, from },
        });
      }
      if (from.y === 0) {
        shapes.push({
          map: makeLane,
          ownerTile: laneOwner,
          shape: { gapTiles, lateralTiles: 0, from },
        });
      }
    }
  }
  return shapes;
}

/**
 * A rest rule gated on the hire's own distance from the owner: touching a
 * nearer crawler counts as arrived only while the hire itself is within its
 * band plus one body. Separation moves the hire across that line and back.
 */
const restsWhileItselfNear: RestRule = (merc) => {
  const toOwner = tilesBetween(merc, merc.owner);
  const contactTiles = SEPARATION_RADIUS_TILES * PARTY_CONTACT_SLACK_RATIO;
  if (toOwner > merc.kit.followBand.startTiles + contactTiles) return false;
  return merc.allies.some(
    (member) =>
      member !== merc.owner &&
      member.isCrawler &&
      tilesBetween(member, merc) <= contactTiles &&
      tilesBetween(member, merc.owner) < toOwner,
  );
};

const neverRests: RestRule = () => false;

function checkHomecoming(report: LifecycleGateReporter): void {
  report.section('A hire coming home stops at the crawler in its way, and stays stopped');
  const sweep = homecomingSweep();
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const failed: string[] = [];
    for (const { map, ownerTile, shape } of sweep) {
      const outcome = homecoming(id, map(), ownerTile, shape);
      if (!settledClear(outcome)) {
        const where = map === makeLane ? 'corridor' : 'open';
        failed.push(`${where}, ${describeShape(shape)}: ${describeHomecoming(outcome)}`);
      }
    }
    report.check(
      failed.length === 0,
      `${id}: clear of both crawlers, settled and as near as it can get in all ${sweep.length} arrangements${failed.length > 0 ? `; not in: ${failed.join('; ')}` : ''}`,
    );
  }
  const trailing: Homecoming = { gapTiles: 2, lateralTiles: 0, from: APPROACHES[0] };
  const roomOwner = { x: HOMECOMING_OWNER_TILE_X, y: HOMECOMING_OWNER_TILE_Y };
  const selfGated = homecoming('bucket_boy', makeRoom(), roomOwner, trailing, restsWhileItselfNear);
  report.checkCatches(
    settledClear(selfGated),
    `a rest gated on the hire's own distance is caught flickering against a crawler trailing 2 tiles back (${describeHomecoming(selfGated)})`,
  );
  const touching: Homecoming = { gapTiles: 1, lateralTiles: 0, from: APPROACHES[0] };
  const blind = homecoming('bucket_boy', makeRoom(), roomOwner, touching, neverRests);
  report.checkCatches(
    settledClear(blind),
    `a hire that walks on into the crawler in its way is caught inside her (${describeHomecoming(blind)})`,
  );
}

// ── Coming home with Mongo in the way ────────────────────────────────────────

/** The human waits this far off, out of the huddle, so only Mongo is in the way. */
const MONGO_HOMECOMING_HUMAN_OFFSET_TILES = 8;
/** Mongo is summoned a tile toward the hire from the cat, before he is moved to its spot. */
const MONGO_HOMECOMING_OFFSET_TILES = 1;

/**
 * A broken rest rule that counts only a crawler as a body in the way, so
 * Mongo parked on the hire's line home gets walked into.
 */
const restsAgainstCrawlersOnly: RestRule = (merc) => {
  const toOwner = tilesBetween(merc, merc.owner);
  const contactTiles = SEPARATION_RADIUS_TILES * PARTY_CONTACT_SLACK_RATIO;
  return merc.allies.some(
    (member) =>
      member !== merc.owner &&
      member.isCrawler &&
      member.isAlive &&
      tilesBetween(member, merc) <= contactTiles &&
      tilesBetween(member, merc.owner) < toOwner &&
      tilesBetween(member, merc.owner) <= PARTY_HUDDLE_TILES,
  );
};

/**
 * The cat is the active crawler and the hire's owner; Mongo stands between her
 * and the hire, which comes home from further out on that side.
 *
 * He is held on the spot the hire's own walk home would end on — its follow
 * band's stop distance from the cat — so that spot is taken and walking on to it
 * means walking into him. His AI is held and he is put back after every frame:
 * he passes through the crawlers, so the hire's separation shove would
 * otherwise slide him out of its way and into the cat, and a rule that ignores
 * him would never be caught. The stop distance, not the start one, because a
 * body further than {@link PARTY_HUDDLE_TILES} from the owner is not one the
 * hire rests against at all.
 */
function homecomingPastMongo(
  id: MercenaryTemplateId,
  map: GameMap,
  ownerTile: { readonly x: number; readonly y: number },
  from: Heading,
  rule?: RestRule,
): HomecomingOutcome | null {
  const built = buildScene(id, { map, humanTile: ownerTile, catTile: ownerTile });
  built.human.isActive = false;
  built.cat.isActive = true;
  const scene: Scene = {
    ...built,
    ctx: { ...built.ctx, active: built.cat, inactive: built.human },
  };
  scene.human.x = scene.cat.x - TILE_SIZE * from.x * MONGO_HOMECOMING_HUMAN_OFFSET_TILES;
  scene.human.y = scene.cat.y - TILE_SIZE * from.y * MONGO_HOMECOMING_HUMAN_OFFSET_TILES;
  const mongo = makeMongo(
    scene.cat,
    ownerTile.x + from.x * MONGO_HOMECOMING_OFFSET_TILES,
    ownerTile.y + from.y * MONGO_HOMECOMING_OFFSET_TILES,
  );
  scene.mobs.add(mongo);
  scene.extras.push(mongo);
  scene.system.update(scene.ctx);
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  withoutStuckRescue(merc);
  if (rule !== undefined)
    Object.defineProperty(merc, 'restsAgainstParty', { value: () => rule(merc) });
  const mongoTiles = merc.kit.followBand.stopTiles;
  const mongoX = scene.cat.x + TILE_SIZE * from.x * mongoTiles;
  const mongoY = scene.cat.y + TILE_SIZE * from.y * mongoTiles;
  const holdMongo = (): void => {
    const oldX = mongo.x;
    const oldY = mongo.y;
    mongo.x = mongoX;
    mongo.y = mongoY;
    scene.mobs.grid.move(mongo, oldX, oldY);
  };
  mongo.aiHeld = true;
  holdMongo();
  const startTiles = mongoTiles + HOMECOMING_RUN_UP_TILES;
  merc.x = scene.cat.x + TILE_SIZE * from.x * startTiles;
  merc.y = scene.cat.y + TILE_SIZE * from.y * startTiles;
  let nearest = Number.POSITIVE_INFINITY;
  let toggles = 0;
  let wasMoving: boolean | null = null;
  for (let f = 0; f < HOMECOMING_FRAMES; f++) {
    // What `MongoSystem.update` hands him every frame.
    mongo.allMobs = scene.mobs.mobs;
    step(scene);
    holdMongo();
    if (f < HOMECOMING_SETTLED_FRAME) continue;
    for (const body of [scene.cat, mongo]) nearest = Math.min(nearest, tilesBetween(merc, body));
    if (wasMoving !== null && merc.isMoving !== wasMoving) toggles++;
    wasMoving = merc.isMoving;
  }
  const againstMongo =
    tilesBetween(mongo, scene.cat) + SEPARATION_RADIUS_TILES * PARTY_CONTACT_SLACK_RATIO;
  return {
    nearestCrawlerTiles: nearest,
    gaitToggles: toggles,
    restTiles: tilesBetween(merc, scene.cat),
    reachableTiles: Math.max(merc.kit.followBand.startTiles, againstMongo),
  };
}

function checkHomecomingPastMongo(report: LifecycleGateReporter): void {
  report.section('A hire coming home stops at Mongo in its way, and stays stopped');
  const roomOwner = { x: HOMECOMING_OWNER_TILE_X, y: HOMECOMING_OWNER_TILE_Y };
  const laneOwner = { x: HOMECOMING_OWNER_TILE_X, y: LANE_ROW };
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const failed: string[] = [];
    let runs = 0;
    for (const from of APPROACHES) {
      const arrangements =
        from.y === 0
          ? [
              { map: makeRoom, owner: roomOwner },
              { map: makeLane, owner: laneOwner },
            ]
          : [{ map: makeRoom, owner: roomOwner }];
      for (const { map, owner } of arrangements) {
        runs++;
        const outcome = homecomingPastMongo(id, map(), owner, from);
        if (!settledClear(outcome)) {
          const where = map === makeLane ? 'corridor' : 'open';
          failed.push(`${where}, from the ${from.label}: ${describeHomecoming(outcome)}`);
        }
      }
    }
    report.check(
      failed.length === 0,
      `${id}: clear of the cat and Mongo, settled and as near as it can get in all ${runs} arrangements${failed.length > 0 ? `; not in: ${failed.join('; ')}` : ''}`,
    );
  }
  const crawlersOnly = homecomingPastMongo(
    'bucket_boy',
    makeRoom(),
    { x: HOMECOMING_OWNER_TILE_X, y: HOMECOMING_OWNER_TILE_Y },
    APPROACHES[0],
    restsAgainstCrawlersOnly,
  );
  report.checkCatches(
    settledClear(crawlersOnly),
    `a rest that counts only crawlers is caught walking into Mongo (${describeHomecoming(crawlersOnly)})`,
  );
}

// ── Leaving a crawler behind ─────────────────────────────────────────────────

const ANCHOR_OWNER_TILE_X = 16;
const ANCHOR_OWNER_TILE_Y = 11;
/** Where the owner walks to, from standing beside her anchored crawler. */
const ANCHOR_WALK_TILES = 8;
const ANCHOR_SETTLE_FRAMES = 300;
const ANCHOR_BUDGET_FRAMES = 900;

interface Walkaway {
  readonly label: string;
  readonly dx: number;
  readonly dy: number;
}

/** East is straight past the anchored cat from the hire's side; the others go round her. */
const WALKAWAYS: readonly Walkaway[] = [
  { label: 'east', dx: 1, dy: 0 },
  { label: 'west', dx: -1, dy: 0 },
  { label: 'north', dx: 0, dy: -1 },
  { label: 'south', dx: 0, dy: 1 },
];

/**
 * A broken rest rule under which touching a crawler nearer the owner counts as
 * arrived however far off the owner has gone.
 */
function restsAgainstPartyAnywhere(merc: Mercenary): boolean {
  const toOwner = tilesBetween(merc, merc.owner);
  return merc.allies.some(
    (member) =>
      member !== merc.owner &&
      member.isCrawler &&
      tilesBetween(member, merc) <= SEPARATION_RADIUS_TILES * PARTY_CONTACT_SLACK_RATIO &&
      tilesBetween(member, merc.owner) < toOwner,
  );
}

/**
 * The hire has come home to its owner and stopped against the cat between
 * them; then the owner walks off `walk` and the cat is left anchored where she
 * stood. The hire's distance from the owner, in tiles, once it has had time to
 * catch up — past the cat, not parked beside her.
 */
interface WalkawayOutcome {
  readonly gapTiles: number;
  readonly bandStartTiles: number;
}

function afterWalkaway(
  map: GameMap,
  row: number,
  walk: Walkaway,
  anywhere = false,
): WalkawayOutcome | null {
  const scene = buildScene('bucket_boy', {
    map,
    humanTile: { x: ANCHOR_OWNER_TILE_X, y: row },
    catTile: { x: ANCHOR_OWNER_TILE_X - HOMECOMING_CAT_OFFSET_TILES, y: row },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  if (anywhere) {
    Object.defineProperty(merc, 'restsAgainstParty', {
      value: () => restsAgainstPartyAnywhere(merc),
    });
  }
  placeAtTile(merc, ANCHOR_OWNER_TILE_X - HOMECOMING_START_OFFSET_TILES, row);
  for (let f = 0; f < ANCHOR_SETTLE_FRAMES; f++) step(scene);
  placeAtTile(
    scene.human,
    ANCHOR_OWNER_TILE_X + walk.dx * ANCHOR_WALK_TILES,
    row + walk.dy * ANCHOR_WALK_TILES,
  );
  for (let f = 0; f < ANCHOR_BUDGET_FRAMES; f++) step(scene);
  return {
    gapTiles: tilesBetween(merc, scene.human),
    bandStartTiles: merc.kit.followBand.startTiles,
  };
}

function backInBand(outcome: WalkawayOutcome | null): boolean {
  return outcome !== null && outcome.gapTiles <= outcome.bandStartTiles + FOLLOW_SLACK_TILES;
}

function gapOf(outcome: WalkawayOutcome | null): string {
  return outcome?.gapTiles.toFixed(2) ?? '?';
}

function checkLeavingACrawlerBehind(report: LifecycleGateReporter): void {
  report.section('An owner who walks off from an anchored crawler is followed, not abandoned');
  for (const walk of WALKAWAYS) {
    const gap = afterWalkaway(makeRoom(), ANCHOR_OWNER_TILE_Y, walk);
    report.check(
      backInBand(gap),
      `she walks ${ANCHOR_WALK_TILES} tiles ${walk.label}: Bucket Boy ends ${gapOf(gap)} tiles from her`,
    );
  }
  const lane = afterWalkaway(makeLane(), LANE_ROW, WALKAWAYS[0]);
  report.check(
    backInBand(lane),
    `in a one-tile corridor with the cat between them, he gets past her to his owner (${gapOf(lane)} tiles)`,
  );
  const stranded = afterWalkaway(makeRoom(), ANCHOR_OWNER_TILE_Y, WALKAWAYS[0], true);
  report.checkCatches(
    backInBand(stranded),
    `resting against the cat however far off the owner is, he is caught stranded (${gapOf(stranded)} tiles)`,
  );
}

// ── Following an owner who drifts away slowly ────────────────────────────────

const DRIFT_OWNER_START_TILE_X = 6;
const DRIFT_TILE_Y = 11;
/** Wading, slowed: a hundredth of a tile a frame, far under any hire's walk. */
const DRIFT_TILES_PER_FRAME = 0.01;
const DRIFT_FRAMES = 900;
const DRIFT_TILES = DRIFT_TILES_PER_FRAME * DRIFT_FRAMES;
/** Frames after the owner stops for the hire to finish its last walk up. */
const DRIFT_SETTLE_FRAMES = 240;
/** The cat waits in a far corner, out of the huddle, so nobody is in the hire's way. */
const DRIFT_CAT_TILE = 2;
/**
 * A latched band switches the hire from standing to walking and back once per
 * band-width the owner covers; this many more is start-up and rounding.
 */
const DRIFT_TOGGLE_ALLOWANCE = 2;
/** How far past its stop a hire may be when it ends a stride. */
const DRIFT_PARK_SLACK_TILES = 0.25;

interface DriftOutcome {
  readonly toggles: number;
  readonly toggleLimit: number;
  /** The furthest from the owner any stride ended, in tiles. */
  readonly worstStrideEndTiles: number;
  readonly stopTiles: number;
}

/**
 * The owner drifts east a hundredth of a tile a frame, then stops. `unlatched`,
 * if set, makes the hire re-decide its follow from the raw distance every frame.
 */
function slowDrift(id: MercenaryTemplateId, unlatched = false): DriftOutcome | null {
  const scene = buildScene(id, {
    map: makeRoom(),
    humanTile: { x: DRIFT_OWNER_START_TILE_X, y: DRIFT_TILE_Y },
    catTile: { x: DRIFT_CAT_TILE, y: DRIFT_CAT_TILE },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  const band = merc.kit.followBand;
  if (unlatched) {
    Object.defineProperty(merc, 'followingOwner', {
      get: () => tilesBetween(merc, merc.owner) > band.startTiles,
      set: () => {
        // Re-read from the distance on every use, never held.
      },
    });
  }
  let toggles = 0;
  let worstStrideEnd = 0;
  let wasMoving = merc.isMoving;
  for (let f = 0; f < DRIFT_FRAMES + DRIFT_SETTLE_FRAMES; f++) {
    if (f < DRIFT_FRAMES) scene.human.x += TILE_SIZE * DRIFT_TILES_PER_FRAME;
    step(scene);
    if (merc.isMoving !== wasMoving) toggles++;
    if (wasMoving && !merc.isMoving) {
      worstStrideEnd = Math.max(worstStrideEnd, tilesBetween(merc, scene.human));
    }
    wasMoving = merc.isMoving;
  }
  const bandWidth = band.startTiles - band.stopTiles;
  return {
    toggles,
    toggleLimit: 2 * Math.ceil(DRIFT_TILES / bandWidth) + DRIFT_TOGGLE_ALLOWANCE,
    worstStrideEndTiles: worstStrideEnd,
    stopTiles: band.stopTiles,
  };
}

function driftsWell(outcome: DriftOutcome | null): boolean {
  return (
    outcome !== null &&
    outcome.toggles <= outcome.toggleLimit &&
    outcome.worstStrideEndTiles <= outcome.stopTiles + DRIFT_PARK_SLACK_TILES
  );
}

function describeDrift(outcome: DriftOutcome | null): string {
  if (outcome === null) return 'no hireling';
  return `${outcome.toggles} walk/stand switches (at most ${outcome.toggleLimit}), every stride ending within ${outcome.worstStrideEndTiles.toFixed(2)} tiles (stop ${outcome.stopTiles})`;
}

function checkSlowDrift(report: LifecycleGateReporter): void {
  report.section('An owner drifting slowly away is followed in strides, not a flicker');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const outcome = slowDrift(id);
    report.check(
      driftsWell(outcome),
      `${id}, over ${DRIFT_TILES} tiles at ${DRIFT_TILES_PER_FRAME} a frame: ${describeDrift(outcome)}`,
    );
  }
  const unlatched = slowDrift('sledge', true);
  report.checkCatches(
    driftsWell(unlatched),
    `a follow re-decided from the raw distance every frame is caught flickering (${describeDrift(unlatched)})`,
  );
}

// ── Following and the leash ──────────────────────────────────────────────────

const FOLLOW_START_TILE = 4;
const FOLLOW_WALK_TILES = 12;
/** Far more frames than the slowest hire needs to cross the room. */
const FOLLOW_BUDGET_FRAMES = 900;
/** How far past the band's far edge still counts as having caught up. */
const FOLLOW_SLACK_TILES = 0.5;

const LEASH_FIGHT_TILE_X = 24;
const LEASH_FIGHT_TILE_Y = 11;
/** Where the owner walks to: well outside every engage radius and leash. */
const LEASH_OWNER_TILE_X = 3;
const LEASH_OWNER_TILE_Y = 11;
/** Frames to let the fight start before the owner leaves it. */
const LEASH_FIGHT_FRAMES = 60;
const LEASH_BUDGET_FRAMES = 900;
/** Frames after leaving before the hireling must be home and stay there. */
const LEASH_RETURN_FRAMES = 450;
/**
 * How far past its leash a hireling may overshoot before it turns: it only
 * re-reads the leash between steps along a path it has already committed to.
 */
const LEASH_SLACK_TILES = 1;
/** A hostile that could be anywhere on the map and still be worth fighting. */
const EVERYWHERE = Number.POSITIVE_INFINITY;

function frozen(merc: Mercenary): void {
  Object.defineProperty(merc, 'speed', { value: 0, writable: true });
}

/**
 * Holds the stuck-hire catch-up off, for a check that measures walking: a hire
 * put back beside its owner by the rescue has not got there on its own feet.
 */
function withoutStuckRescue(merc: Mercenary): void {
  Object.defineProperty(merc, 'followStallFrames', {
    get: () => 0,
    set: () => undefined,
  });
}

/**
 * Whether a hireling catches up with an owner who walks off with nothing
 * hostile about: inside the far edge of its follow band by the end.
 */
function catchesUp(id: MercenaryTemplateId, tamper?: (merc: Mercenary) => void): boolean {
  const scene = buildScene(id, {
    map: makeRoom(),
    humanTile: { x: FOLLOW_START_TILE, y: SPAWN_ROOM_TILE_Y },
    catTile: { x: FOLLOW_START_TILE, y: SPAWN_ROOM_TILE_Y + 1 },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return false;
  withoutStuckRescue(merc);
  tamper?.(merc);
  placeAtTile(scene.human, FOLLOW_START_TILE + FOLLOW_WALK_TILES, SPAWN_ROOM_TILE_Y);
  placeAtTile(scene.cat, FOLLOW_START_TILE + FOLLOW_WALK_TILES, SPAWN_ROOM_TILE_Y + 1);
  for (let f = 0; f < FOLLOW_BUDGET_FRAMES; f++) step(scene);
  return tilesBetween(merc, scene.human) <= merc.kit.followBand.startTiles + FOLLOW_SLACK_TILES;
}

/**
 * Starts a fight at the far end of the room, walks the owner away from it, and
 * reports the hireling's furthest distance from her once it has had time to
 * come home — and whether the fight it left went on being fought.
 */
interface LeashOutcome {
  readonly worstTilesAfterReturn: number;
  readonly leashTiles: number;
  readonly hitAfterLeaving: boolean;
}

function leftTheFight(
  id: MercenaryTemplateId,
  tamper?: (merc: Mercenary) => void,
): LeashOutcome | null {
  const scene = buildScene(id, {
    map: makeRoom(),
    humanTile: { x: LEASH_FIGHT_TILE_X - 1, y: LEASH_FIGHT_TILE_Y },
    catTile: { x: LEASH_FIGHT_TILE_X - 1, y: LEASH_FIGHT_TILE_Y + 1 },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  tamper?.(merc);
  const foe = addDummy(scene, LEASH_FIGHT_TILE_X + 1, LEASH_FIGHT_TILE_Y);
  for (let f = 0; f < LEASH_FIGHT_FRAMES; f++) {
    // Kept alive, so no kit has finished the fight before the owner leaves it.
    foe.hp = foe.maxHp;
    step(scene);
  }
  placeAtTile(scene.human, LEASH_OWNER_TILE_X, LEASH_OWNER_TILE_Y);
  placeAtTile(scene.cat, LEASH_OWNER_TILE_X, LEASH_OWNER_TILE_Y + 1);
  let worst = 0;
  let hitAfterLeaving = false;
  for (let f = 0; f < LEASH_BUDGET_FRAMES; f++) {
    // Kept alive, so a hireling that stays behind always has something to hit.
    foe.hp = foe.maxHp;
    step(scene);
    if (foe.hp < foe.maxHp && f >= LEASH_RETURN_FRAMES) hitAfterLeaving = true;
    if (f >= LEASH_RETURN_FRAMES) worst = Math.max(worst, tilesBetween(merc, scene.human));
  }
  return {
    worstTilesAfterReturn: worst,
    leashTiles: merc.kit.leashRadiusTiles,
    hitAfterLeaving,
  };
}

function engagesEverywhere(merc: Mercenary): void {
  Object.defineProperty(merc, 'aggroRangePx', { value: EVERYWHERE, writable: true });
}

function unleashed(merc: Mercenary): void {
  engagesEverywhere(merc);
  Object.defineProperty(merc, 'leashPx', { value: EVERYWHERE, writable: true });
}

function describeLeash(outcome: LeashOutcome | null): string {
  if (outcome === null) return 'no hireling';
  return `${outcome.worstTilesAfterReturn.toFixed(1)} tiles at worst, leash ${outcome.leashTiles}`;
}

function checkFollowing(report: LifecycleGateReporter): void {
  report.section('Every hire follows, and comes home when its owner leaves a fight');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    report.check(
      catchesUp(id),
      `${id} catches up with an owner who walked ${FOLLOW_WALK_TILES} tiles off`,
    );
    const home = leftTheFight(id);
    report.check(
      home !== null && home.worstTilesAfterReturn <= home.leashTiles && !home.hitAfterLeaving,
      `${id} drops the fight its owner walked away from and comes home (${describeLeash(home)})`,
    );
    const leashed = leftTheFight(id, engagesEverywhere);
    report.check(
      leashed !== null && leashed.worstTilesAfterReturn <= leashed.leashTiles + LEASH_SLACK_TILES,
      `${id}: with the fight still worth having, the leash alone keeps it by her (${describeLeash(leashed)})`,
    );
  }
  report.checkCatches(
    catchesUp('bomo', frozen),
    'a hireling that cannot move is caught left behind',
  );
  const loose = leftTheFight('gluteus_maxx', unleashed);
  report.checkCatches(
    loose !== null && loose.worstTilesAfterReturn <= loose.leashTiles + LEASH_SLACK_TILES,
    `a hireling with no leash is caught staying at the fight (${describeLeash(loose)})`,
  );
}

// ── Credit ───────────────────────────────────────────────────────────────────

const CORNER_TILE = 1;
/** Where a pinned body stands off the hireling: inside every kit's reach, off its tile. */
const PIN_OFFSET_TILES = 0.6;
const PIN_OFFSET_PX = TILE_SIZE * PIN_OFFSET_TILES;
/** Splash Zone looses from range, so his pinned target stands where a bolt has room to fly. */
const RANGED_PIN_TILES = 4;
const CREDIT_BUDGET_FRAMES = 900;
const ONE_HIT_POINT = 1;

/** Where a hire's target is held while it is measured, off the hireling. */
function pinOffsetPx(id: MercenaryTemplateId): { x: number; y: number } {
  if (id === 'splash_zone') return { x: TILE_SIZE * RANGED_PIN_TILES, y: 0 };
  return { x: PIN_OFFSET_PX, y: PIN_OFFSET_PX };
}

/**
 * A scene with the hireling backed into a corner and a hostile held on it —
 * the one arrangement every kit fights in, including a medic who only swings
 * once he has nowhere left to run.
 */
function cornerScene(id: MercenaryTemplateId): { scene: Scene; merc: Mercenary } | null {
  const scene = buildScene(id, {
    map: makeRoom(),
    humanTile: { x: CORNER_TILE + 1, y: CORNER_TILE },
    catTile: { x: CORNER_TILE, y: CORNER_TILE + 1 },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  placeAtTile(merc, CORNER_TILE, CORNER_TILE);
  return { scene, merc };
}

function pin(body: { x: number; y: number }, merc: Mercenary, offset: { x: number; y: number }) {
  body.x = merc.x + offset.x;
  body.y = merc.y + offset.y;
}

interface CreditOutcome {
  readonly ownerGain: number;
  readonly otherGain: number;
  readonly killed: boolean;
}

function xpOf(player: Player): number {
  return player.level * XP_LEVEL_WEIGHT + player.xp;
}

/** Large enough that a level-up always reads as more XP than any single kill pays. */
const XP_LEVEL_WEIGHT = 1_000_000;

/**
 * The hireling kills a one-hit-point hostile held on it; how much XP each
 * crawler got. `finish`, if given, kills it instead, on the frame before the
 * hireling's first blow would have.
 */
function creditForKill(
  id: MercenaryTemplateId,
  finish?: (foe: Mob, merc: Mercenary) => void,
): CreditOutcome {
  const setup = cornerScene(id);
  if (setup === null) return { ownerGain: 0, otherGain: 0, killed: false };
  const { scene, merc } = setup;
  const offset = pinOffsetPx(id);
  const foe = addDummy(scene, CORNER_TILE, CORNER_TILE);
  foe.hp = ONE_HIT_POINT;
  const ownerStart = xpOf(scene.human);
  const otherStart = xpOf(scene.cat);
  if (finish !== undefined) {
    pin(foe, merc, offset);
    finish(foe, merc);
  }
  for (let f = 0; f < CREDIT_BUDGET_FRAMES && foe.isAlive; f++) {
    pin(foe, merc, offset);
    step(scene);
  }
  // One more frame, so kill resolution has paid out the killing blow.
  step(scene);
  return {
    ownerGain: xpOf(scene.human) - ownerStart,
    otherGain: xpOf(scene.cat) - otherStart,
    killed: !foe.isAlive,
  };
}

function ownerTookTopShare(outcome: CreditOutcome): boolean {
  return outcome.killed && outcome.ownerGain > outcome.otherGain && outcome.otherGain > 0;
}

function checkCredit(report: LifecycleGateReporter): void {
  report.section("Every hire's kills pay its owner");
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const outcome = creditForKill(id);
    report.check(
      ownerTookTopShare(outcome),
      `${id}'s kill pays the owner the top share (${outcome.ownerGain} XP to her, ${outcome.otherGain} to the other crawler)`,
    );
  }
  const uncredited = creditForKill('sledge', (foe, merc) => {
    foe.takeDamageFrom(ONE_HIT_POINT, merc, 'melee');
  });
  report.checkCatches(
    ownerTookTopShare(uncredited),
    `a blow landed in the hireling's own name is caught paying the owner only the lesser share (${uncredited.ownerGain} XP)`,
  );
}

// ── Friendly fire ────────────────────────────────────────────────────────────

const BRAWL_FRAMES = 900;
/** The pack the hireling works through once its pinned foe is down, in tiles. */
const PACK_NEAR_TILE_X = 5;
const PACK_FAR_TILE_X = PACK_NEAR_TILE_X + 1;
const PACK_TILES: readonly (readonly [number, number])[] = [
  [PACK_NEAR_TILE_X, CORNER_TILE],
  [PACK_NEAR_TILE_X, CORNER_TILE + 2],
  [PACK_FAR_TILE_X, CORNER_TILE + 1],
];
/** Mongo stands in the pack, where a wave, charge or boulder aimed at it would find him. */
const MONGO_TILE_X = PACK_FAR_TILE_X;
const MONGO_TILE_Y = CORNER_TILE;
const STRAY_BLOW_FRAME = 300;
const STRAY_BLOW = 3;

interface BrawlOutcome {
  readonly alliesLost: number;
  readonly hostilesLost: number;
}

/**
 * A fight in a corner with both crawlers pressed against the hireling and
 * Mongo standing in the pack: every swing, stomp, bolt, wave, charge and
 * boulder the kit has goes off with an ally in reach of it.
 */
function brawl(id: MercenaryTemplateId, strayBlow = false): BrawlOutcome | null {
  const setup = cornerScene(id);
  if (setup === null) return null;
  const { scene, merc } = setup;
  const mongo = makeMongo(scene.human, MONGO_TILE_X, MONGO_TILE_Y);
  mongo.aiHeld = true;
  scene.mobs.add(mongo);
  scene.extras.push(mongo);
  const offset = pinOffsetPx(id);
  const pinned = addDummy(scene, CORNER_TILE, CORNER_TILE);
  const pack = PACK_TILES.map(([x, y]) => addDummy(scene, x, y));
  const hostiles = [pinned, ...pack];
  const hostileStart = hostiles.map((mob) => mob.hp);
  const allies: Player[] = [scene.human, scene.cat, mongo];
  const allyStart = allies.map((ally) => ally.hp);

  for (let f = 0; f < BRAWL_FRAMES; f++) {
    if (pinned.isAlive) pin(pinned, merc, offset);
    pin(scene.human, merc, { x: 0, y: PIN_OFFSET_PX });
    pin(scene.cat, merc, { x: PIN_OFFSET_PX, y: 0 });
    placeAtTile(mongo, MONGO_TILE_X, MONGO_TILE_Y);
    if (strayBlow && f === STRAY_BLOW_FRAME) {
      scene.cat.takeDamage(STRAY_BLOW, { kind: 'mob', mobType: 'goblin', undodgeable: true });
    }
    step(scene);
  }
  const lost = (bodies: readonly Player[], start: readonly number[]): number =>
    bodies.reduce((sum, body, i) => sum + Math.max(0, start[i] - body.hp), 0);
  return { alliesLost: lost(allies, allyStart), hostilesLost: lost(hostiles, hostileStart) };
}

function spareAllies(outcome: BrawlOutcome | null): boolean {
  return outcome !== null && outcome.alliesLost === 0 && outcome.hostilesLost > 0;
}

function describeBrawl(outcome: BrawlOutcome | null): string {
  if (outcome === null) return 'no hireling';
  return `allies lost ${outcome.alliesLost} HP, hostiles ${outcome.hostilesLost}`;
}

function checkFriendlyFire(report: LifecycleGateReporter): void {
  report.section('No hire ever hurts an ally');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const outcome = brawl(id);
    report.check(
      spareAllies(outcome),
      `${id} fights a pack with the crawlers and Mongo in reach, and hurts only the pack (${describeBrawl(outcome)})`,
    );
  }
  const stray = brawl('tumbledown', true);
  report.checkCatches(
    spareAllies(stray),
    `the ally measure sees a blow on the cat mid-fight (${describeBrawl(stray)})`,
  );
}

// ── Tumbledown's boulder ─────────────────────────────────────────────────────

const BOULDER_OWNER_TILE_X = 4;
const BOULDER_TILE_Y = 10;
/** Inside the golem's throwing band, well outside his fists. */
const BOULDER_RANGE_TILES = 6;
const BOULDER_BUDGET_FRAMES = 600;
/** Closer than this and the blow could have been a fist. */
const FIST_REACH_TILES = 2;

/** HP the target lost while the golem stood out of fist reach of it. */
function boulderDamageAtRange(flyRocks: boolean): number {
  const scene = buildScene('tumbledown', {
    map: makeRoom(),
    humanTile: { x: BOULDER_OWNER_TILE_X, y: BOULDER_TILE_Y },
    catTile: { x: BOULDER_OWNER_TILE_X, y: BOULDER_TILE_Y + 1 },
  });
  const merc = scene.system.activeMerc;
  if (merc === null) return 0;
  const golemTileX = BOULDER_OWNER_TILE_X + 1;
  const foe = addDummy(scene, golemTileX + BOULDER_RANGE_TILES, BOULDER_TILE_Y);
  const foeTile = { x: foe.x, y: foe.y };
  let lostAtRange = 0;
  for (let f = 0; f < BOULDER_BUDGET_FRAMES; f++) {
    // The golem is held where it stands so the only way to the target is through the air.
    placeAtTile(merc, golemTileX, BOULDER_TILE_Y);
    foe.x = foeTile.x;
    foe.y = foeTile.y;
    const before = foe.hp;
    if (flyRocks) {
      step(scene);
    } else {
      scene.mobLoop.update(scene.ctx);
      scene.system.update(scene.ctx);
      merc.takePendingThrows();
    }
    if (foe.hp < before && tilesBetween(merc, foe) > FIST_REACH_TILES) {
      lostAtRange += before - foe.hp;
    }
  }
  return lostAtRange;
}

function checkBoulder(report: LifecycleGateReporter): void {
  report.section("Tumbledown's boulder");
  const landed = boulderDamageAtRange(true);
  report.check(
    landed > 0,
    `a hostile ${BOULDER_RANGE_TILES} tiles off, out of his fists' reach, is hit by a boulder (${landed} HP)`,
  );
  const grounded = boulderDamageAtRange(false);
  report.checkCatches(
    grounded > 0,
    `with no boulder ever flown, the same hostile is caught untouched (${grounded} HP)`,
  );
}

// ── The contract across a floor's end ───────────────────────────────────────

type Restorer = (roster: MercenaryRoster, snapshot: MercenaryRosterCheckpoint) => void;

/** A restore that ignores which floor the party is on. */
const floorBlindRestore: Restorer = (roster, snapshot) => {
  roster.active = snapshot.active === null ? null : { ...snapshot.active };
  roster.lastDeceased = snapshot.lastDeceased;
};

/**
 * Signs a hire, takes a safe-room checkpoint mid-floor, wins the floor, and
 * restores that checkpoint on the next floor: true if no hire came back.
 */
function floorEndStaysEnded(restore: Restorer): boolean {
  const scene = buildScene('dong_quixote', {
    map: makeRoom(),
    humanTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y },
    catTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y + 1 },
  });
  if (scene.system.activeMerc === null) return false;
  const checkpoint = captureMercenaryRoster(scene.roster);
  scene.system.endContractForFloor();
  if (holdsHire(scene.roster)) return false;
  scene.system.dismiss(scene.mobs.mobs, scene.mobs.grid);

  const nextSystem = new MercenarySystem(scene.roster, NEXT_FLOOR);
  restore(scene.roster, checkpoint);
  // Checked before the next floor's first frame, whose own spawn test would
  // quietly clear a revived contract and hide that the restore handed it back.
  if (holdsHire(scene.roster)) return false;
  const nextScene = buildScene(null, {
    map: makeRoom(),
    humanTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y },
    catTile: { x: SPAWN_ROOM_TILE_X, y: SPAWN_ROOM_TILE_Y + 1 },
  });
  nextSystem.update(nextScene.ctx);
  return !holdsHire(scene.roster) && nextSystem.activeMerc === null;
}

function holdsHire(roster: MercenaryRoster): boolean {
  return roster.active !== null;
}

function checkFloorEnd(report: LifecycleGateReporter): void {
  report.section('A checkpoint from a won floor brings no hire back');
  report.check(
    floorEndStaysEnded(restoreMercenaryRoster),
    'a mid-floor checkpoint restored on the next floor leaves no hire and spawns nothing',
  );
  report.checkCatches(
    floorEndStaysEnded(floorBlindRestore),
    'a restore that ignores the floor is caught reviving the contract',
  );
}

// ── Survivability ────────────────────────────────────────────────────────────

/** Where a floor-3 party stands when goblin camps (levels 5–7) are the fight. */
const PARTY_LEVEL = 9;
const GOBLIN_LEVEL = 6;
const FIGHT_SEED = 0x3e7c_0de5;
const FIGHT_OWNER_TILE_X = 8;
const FIGHT_TILE_Y = 10;
/**
 * A camp goblin that has spotted her closes from the north: off the line
 * through her from the hire behind her, so a melee hire has a way to it that
 * does not run through its owner. One goblin, because the fight has to last
 * long enough for a medic's cooldown to come round more than once — a heal is
 * pressure relieved over time, and a fight over in seconds has no time.
 */
const FIGHT_GOBLIN_OFFSET_TILES = 6;
const FIGHT_GOBLIN_TILES: readonly (readonly [number, number])[] = [
  [FIGHT_OWNER_TILE_X, FIGHT_TILE_Y - FIGHT_GOBLIN_OFFSET_TILES],
];
/** The cat waits out the fight sealed in a far pocket, so the owner takes it alone. */
const CAT_POCKET_TILE_X = 28;
const CAT_POCKET_TILE_Y = 3;
const FRAMES_PER_SECOND = 60;
const FIGHT_WINDOW_SECONDS = 90;
const FIGHT_WINDOW_FRAMES = FIGHT_WINDOW_SECONDS * FRAMES_PER_SECOND;

interface FightOutcome {
  /** The frame the owner went down, or null if she lasted the window. */
  readonly knockoutFrame: number | null;
  readonly hpLost: number;
}

/** A room with a one-tile pocket walled off in the far corner. */
function makeFightRoom(): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  return makeMap(ROOM_WIDTH_TILES, ROOM_HEIGHT_TILES, (x, y) => {
    const inPocket = x === CAT_POCKET_TILE_X && y === CAT_POCKET_TILE_Y;
    const aroundPocket =
      Math.abs(x - CAT_POCKET_TILE_X) <= 1 && Math.abs(y - CAT_POCKET_TILE_Y) <= 1;
    if (aroundPocket) return inPocket;
    return x > 0 && y > 0 && x < lastX && y < lastY;
  });
}

function levelOwner(human: HumanPlayer): void {
  const reference = referenceStats('human', 'balanced', PARTY_LEVEL);
  for (const stat of ALL_STATS) human.setBaseStat(stat, reference.stats[stat]);
  human.level = PARTY_LEVEL;
  human.hp = human.maxHp;
}

/** Runs `build` with `Math.random` replaying one seed, restoring it afterwards. */
function seeded<T>(seed: number, build: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return build();
  } finally {
    Math.random = original;
  }
}

/**
 * How the hire stands in the fight: `fighting`; `inert` — spawned exactly as
 * the fighting arm is, then sent off before the first goblin appears; or
 * `healless` — fighting, but with any Triage it channels landing nothing.
 */
type HireStance = 'fighting' | 'inert' | 'healless';

/**
 * The owner, who never swings, against a goblin camp's melee line.
 *
 * `Math.random` is reseeded once the party is built and before the camp is,
 * so every arm — no hire, an inert hire, a fighting one — starts the fight on
 * the same stream: whatever building the hire drew does not reach the goblins.
 */
function standardFight(hire: MercenaryTemplateId | null, stance: HireStance): FightOutcome {
  return seeded(FIGHT_SEED, () => {
    const scene = buildScene(hire, {
      map: makeFightRoom(),
      humanTile: { x: FIGHT_OWNER_TILE_X, y: FIGHT_TILE_Y },
      catTile: { x: CAT_POCKET_TILE_X, y: CAT_POCKET_TILE_Y },
    });
    if (stance === 'inert') sendHireOff(scene);
    const merc = scene.system.activeMerc;
    if (stance === 'healless' && merc !== null) {
      Object.defineProperty(merc.kit, 'release', { value: NO_HEAL });
    }
    levelOwner(scene.human);
    Math.random = mulberry32(FIGHT_SEED);
    for (const [tileX, tileY] of FIGHT_GOBLIN_TILES) {
      const goblin = createMob('goblin', tileX, tileY, scene.map);
      placeAtTile(goblin, tileX, tileY);
      goblin.applyMobLevel(GOBLIN_LEVEL);
      applySpawnDifficulty(goblin, DIFFICULTY_PROFILES.normal);
      scene.mobs.add(goblin);
    }
    const start = scene.human.hp;
    for (let f = 0; f < FIGHT_WINDOW_FRAMES; f++) {
      step(scene);
      if (scene.human.hp <= 0 || scene.human.isKnockedOut) {
        return { knockoutFrame: f, hpLost: start };
      }
    }
    return { knockoutFrame: null, hpLost: start - scene.human.hp };
  });
}

const NO_HEAL = (): void => {
  // The channel plays out and the cooldown is spent, but nobody gains HP.
};

/** Ends the contract and takes the hire out of the scene, leaving everything else as it was. */
function sendHireOff(scene: Scene): void {
  scene.roster.active = null;
  scene.system.dismiss(scene.mobs.mobs, scene.mobs.grid);
  scene.extras.length = 0;
}

/**
 * How much longer than the inert arm a hire must keep its owner up to count:
 * enough that it is the hire's doing, not one goblin's swing landing a beat
 * later.
 */
const SURVIVABILITY_MARGIN_SECONDS = 2;
const SURVIVABILITY_MARGIN_FRAMES = SURVIVABILITY_MARGIN_SECONDS * FRAMES_PER_SECOND;

/** Frames the owner stayed up, counting a whole window for one who never went down. */
function framesStanding(outcome: FightOutcome): number {
  return outcome.knockoutFrame ?? FIGHT_WINDOW_FRAMES;
}

/** Whether `hired` kept the owner up at least `marginFrames` longer than `baseline`. */
function keptAliveLonger(
  hired: FightOutcome,
  baseline: FightOutcome,
  marginFrames = SURVIVABILITY_MARGIN_FRAMES,
): boolean {
  if (baseline.knockoutFrame === null) return false;
  return framesStanding(hired) - framesStanding(baseline) >= marginFrames;
}

/**
 * How much of a medic's margin must be his heals, found by emptying them: about
 * one Triage's worth of a goblin's damage, so a hire that only soaks attention
 * cannot pass for a healer.
 */
const HEAL_MARGIN_SECONDS = 1.5;
const HEAL_MARGIN_FRAMES = HEAL_MARGIN_SECONDS * FRAMES_PER_SECOND;

function sameFight(a: FightOutcome, b: FightOutcome): boolean {
  return a.knockoutFrame === b.knockoutFrame && a.hpLost === b.hpLost;
}

function describeFight(outcome: FightOutcome): string {
  const seconds = (frames: number): string => (frames / FRAMES_PER_SECOND).toFixed(1);
  return outcome.knockoutFrame === null
    ? `standing after ${seconds(FIGHT_WINDOW_FRAMES)} s, ${outcome.hpLost} HP lost`
    : `down at ${seconds(outcome.knockoutFrame)} s`;
}

function marginSeconds(hired: FightOutcome, baseline: FightOutcome): string {
  const frames = framesStanding(hired) - framesStanding(baseline);
  return `${frames >= 0 ? '+' : ''}${(frames / FRAMES_PER_SECOND).toFixed(1)} s`;
}

function checkSurvivability(report: LifecycleGateReporter): void {
  report.section('Every hire keeps its owner up longer in a floor-3 fight');
  const alone = standardFight(null, 'fighting');
  report.check(
    alone.knockoutFrame !== null,
    `alone, the owner is knocked out by the camp (${describeFight(alone)}), so the fight is one a hire can matter in`,
  );
  report.check(
    sameFight(alone, standardFight(null, 'fighting')),
    'the fight replays identically from its seed',
  );
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const inert = standardFight(id, 'inert');
    const hired = standardFight(id, 'fighting');
    report.check(
      sameFight(inert, alone),
      `${id}: spawned and sent off before the fight, the fight is the one she has alone`,
    );
    report.check(
      keptAliveLonger(hired, inert),
      `${id}: ${describeFight(hired)}, against ${describeFight(inert)} with it inert (${marginSeconds(hired, inert)}, at least +${SURVIVABILITY_MARGIN_SECONDS} s)`,
    );
  }
  report.checkCatches(
    keptAliveLonger(standardFight('sledge', 'inert'), alone),
    `an inert hire is not counted as keeping her up`,
  );

  const medic = standardFight('bucket_boy', 'fighting');
  const medicHealless = standardFight('bucket_boy', 'healless');
  report.check(
    keptAliveLonger(medic, medicHealless, HEAL_MARGIN_FRAMES),
    `Bucket Boy's heals are part of it: with his Triage landing nothing she is ${describeFight(medicHealless)} (his heals are worth ${marginSeconds(medic, medicHealless)}, at least +${HEAL_MARGIN_SECONDS} s)`,
  );
  const brawler = standardFight('gluteus_maxx', 'fighting');
  const brawlerHealless = standardFight('gluteus_maxx', 'healless');
  report.checkCatches(
    keptAliveLonger(brawler, brawlerHealless, HEAL_MARGIN_FRAMES),
    `the heal measure credits no heals to a hire that has none (Gluteus Maxx: ${marginSeconds(brawler, brawlerHealless)})`,
  );
}

/** Every random draw the lifecycle checks make replays from this, so two runs print the same. */
const LIFECYCLE_SEED = 0x11fe_c7c1;

/**
 * A desktop screen, wide enough that every room these checks build is on it at
 * once. The follow and leash checks measure a hire walking home, and a hire the
 * player cannot see is put back beside its owner instead — which would pass
 * them without a step taken.
 */
const DESKTOP_SCREEN_W = 1920;
const DESKTOP_SCREEN_H = 1080;

export function verifyMercenaryLifecycle(report: LifecycleGateReporter): void {
  setViewportSize(DESKTOP_SCREEN_W, DESKTOP_SCREEN_H);
  seeded(LIFECYCLE_SEED, () => {
    runLifecycleChecks(report);
  });
}

function runLifecycleChecks(report: LifecycleGateReporter): void {
  checkSpawning(report);
  checkSpawnFallbacks(report);
  checkWarp(report);
  checkPartyNotShoved(report);
  checkHomecoming(report);
  checkHomecomingPastMongo(report);
  checkLeavingACrawlerBehind(report);
  checkSlowDrift(report);
  checkFollowing(report);
  checkCredit(report);
  checkFriendlyFire(report);
  checkBoulder(report);
  checkFloorEnd(report);
  checkSurvivability(report);
}
