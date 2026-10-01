/**
 * Headless renderer for a dungeon floor — floors 1 and 2 as pixels, without a
 * browser. The sibling of `scripts/render-town.ts`, for the same reason: these
 * floors are judged on a screenshot, and `?tiles` shows a material by itself
 * rather than a room full of it next to its neighbours, its walls, and the
 * contact shading under them. Every art problem found in this set so far — walls
 * so light they swamped the rooms, brick paving that read as masonry laid flat,
 * a neighbouring room's floor seeping out from under a shared wall — was
 * invisible in a swatch and obvious here.
 *
 *   npx tsx scripts/render-dungeon.ts --level=2 --seed=7 --frame=room --props --scale=2
 *
 * Map:
 * - `--level=N` picks the floor and so the ground theme.
 * - `--seed=N` replays one layout: the same seed and level give the same map,
 *   exactly as a save rebuilds the floor it was written on. Without it every run
 *   is a fresh map.
 * - `--art-seed=N` paints the floor in the Nth verified look rather than the
 *   reviewed one, which is how a floor is judged across the seed space. It never
 *   moves a wall; `--seed` never repaints one.
 *
 * What is drawn:
 * - Always the baked chunk layer: walls, floors, occlusion.
 * - `--props` adds what the game draws over the chunks in its Y-sorted pass —
 *   every decoration tile (torches, barrels, crates, shelves, signs) and every
 *   wall fixture — in the order the game sorts them, and the colosseum's ground
 *   dressing (its caged pigs, banners and flood lamps) as it stands before a fight.
 * - `--lighting` applies the floor's lighting pass at a fixed clock, so two runs
 *   with the same seed light identically: the darkness, every static light on
 *   the map (the nursery's sconces included), a crawler's light at the middle
 *   of the view where the player would stand, and the sharp preset's glows.
 * - `--life` adds the floor's small moving things, run for a few seconds of
 *   game time from a fixed seed: critters sitting at wall feet, flies over
 *   bones, dust motes in the strongest lights, and a drip and a wader's
 *   splashes on the first puddle found in view.
 * - `--smash` breaks every breakable prop and wall fixture in the view first and
 *   draws what they leave — wreckage, spills, glowing coals — setting any oil
 *   alight and letting its fire rise, so a room's mess can be judged lit.
 * - `--character=<id>` frames the first room the generator dressed as that
 *   room character (`wine_cellar`, `boiler_room`, …); with `--frame=doorway`,
 *   that room's first doorway.
 *
 * Framing — with none given it frames the start room and its surroundings:
 * - `--frame=room|hallway|junction|doorway` frames the first ordinary room, the
 *   longest straight corridor run, the corridor junction with the most arms, or
 *   the first doorway of that room, each with padding around it.
 * - `--safe-room`, `--quest-room`, `--spider-lab` frame those rooms.
 * - `--stairwell` frames the floor's first stairwell and draws it as the game
 *   does, its pulsing outline and arrow included.
 * - `--sign=hallway|room` frames the first wayfinding sign of that kind (a map
 *   may have none of the kind; try another seed).
 * - `--quest-exit=barred|smashed` puts the nursery's onward doorway in that state
 *   and frames it.
 * - `--x`, `--y`, `--w`, `--h` (tiles) override whatever the framing chose.
 *
 * The framings that exist to show a prop — a station's counter run, a sign, the
 * nursery's doorway, the lab — turn `--props` on by themselves.
 *
 * `--scale=N` multiplies the output; `--out=path` names it.
 *
 * What it cannot show is anything that needs a player or a system: no entities,
 * no chests, no loot.
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap, type QuestExitDoorState } from '../src/map/GameMap.js';
import { CRAWLER_SIGN } from '../src/map/tileTypes.js';
import { renderCanvas } from '../src/map/TileRenderer.js';
import { stampSafeRoomCounters } from '../src/map/safeRoomCounterLayout.js';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout.js';
import { type Point, type Rect } from '../src/map/roomDoorways.js';
import { type RoomRegion } from '../src/map/regionMap.js';
import { ALL_REGION_CHARACTERS, regionCharacterById } from '../src/map/dungeon/roomCharacters.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  dungeonFloorTheme,
  setDungeonFloorTheme,
} from '../src/map/dungeon/floorTheme.js';
import {
  isFixtureLit,
  collectVisibleWallFixtures,
  wallFixtureSortY,
} from '../src/map/dungeon/wallFixtures.js';
import { drawWallFixture } from '../src/sprites/art/wallFixtureArt.js';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem.js';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { Conversation } from '../src/dialog/Conversation.js';
import { CRAWLER_LIGHT_REACH_TILES } from '../src/systems/lighting/lightKinds.js';
import {
  ALL_BREAKABLE_PROPS,
  DestructiblePropSystem,
  TILE_TYPE_FOR_KIND,
} from '../src/systems/DestructiblePropSystem.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import { OIL_FIRE_CATCH_FRAMES } from '../src/systems/destruction/wreckageField.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { DungeonLifeSystem } from '../src/systems/dungeon/DungeonLifeSystem.js';
import { floorSurfaceOf } from '../src/map/dungeon/floorSurface.js';
import { buildColosseumDressing } from '../src/systems/bossRooms/BossRoomDressings.js';
import { UINT32_SPAN } from '../src/core/WorldRandom.js';
import { StairwellSystem } from '../src/systems/StairwellSystem.js';

const DEFAULT_LEVEL = 1;
const DEFAULT_VIEW_TILES_W = 56;
const DEFAULT_VIEW_TILES_H = 32;
const DEFAULT_SCALE = 1;
const DEFAULT_OUT = `${PREVIEW_DIR}/dungeon.png`;
const QUEST_EXIT_DOOR_STATES: readonly QuestExitDoorState[] = ['clear', 'barred', 'smashed'];
const FRAME_KINDS = ['room', 'hallway', 'junction', 'doorway'] as const;
type FrameKind = (typeof FRAME_KINDS)[number];

/** Tiles of context kept around a framed room or corridor run on every side. */
const FRAME_PADDING_TILES = 4;
/**
 * The smallest view a framing produces. A one-tile doorway or a short corridor
 * padded by four tiles would be a keyhole; this is enough to read the walls
 * around it at game size.
 */
const FRAME_MIN_TILES_W = 24;
const FRAME_MIN_TILES_H = 16;
/**
 * How far a corridor has to run out of a tile, through corridor floor, for that
 * direction to count as an arm of a junction. Longer than the widest corridor is
 * wide, so the inside of a wide straight corridor — open on all four sides a
 * tile away — never reads as a crossing.
 */
const JUNCTION_ARM_TILES = 4;
/**
 * The most of a corridor run a hallway framing shows. The spine can run most of
 * the map's height; its middle stretch at this length is what a player sees of
 * it at once, and still frames the corridor rather than the map.
 */
const HALLWAY_FRAME_MAX_RUN_TILES = 32;
/** Arms a corridor tile needs to be a junction rather than a bend or a run. */
const JUNCTION_MIN_ARMS = 3;
/**
 * The clock the lighting pass is evaluated at. Fixed so a flicker or a pulse
 * lands on the same phase every run, and two renders of one seed can be diffed.
 */
const LIGHTING_CLOCK_MS = 0;

const ORTHOGONAL_STEPS: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

/** Length of the `--name=` prefix an argument's value starts after. */
const ARG_PREFIX_LENGTH = '--='.length;

function rawArg(name: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw?.slice(name.length + ARG_PREFIX_LENGTH);
}

function optionalIntArg(name: string): number | undefined {
  const raw = rawArg(name);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function intArg(name: string, fallback: number): number {
  return optionalIntArg(name) ?? fallback;
}

function stringArg(name: string, fallback: string): string {
  return rawArg(name) ?? fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Which of the verified looks to paint the floor in. The default is the reviewed
 * art; any other index picks a different member of the alphabet the game itself
 * draws from, which is how the same floor is compared at several seeds.
 */
const artSeedIndex = intArg('art-seed', 0);
const artSeed = FLOOR_ART_SEEDS[Math.abs(artSeedIndex) % FLOOR_ART_SEEDS.length];

const floorNumber = intArg('level', DEFAULT_LEVEL);
const levelDef = getLevelDef(`level${floorNumber}`);
if (levelDef.isOverworld) throw new Error(`level${floorNumber} is an overworld — use render-town`);

const worldSeed = optionalIntArg('seed');
const scale = intArg('scale', DEFAULT_SCALE);
const outPath = stringArg('out', DEFAULT_OUT);
const characterId = rawArg('character');
if (characterId !== undefined && regionCharacterById(characterId)?.kind !== 'room') {
  const known = ALL_REGION_CHARACTERS.filter((character) => character.kind === 'room')
    .map((character) => character.id)
    .join(', ');
  throw new Error(`--character must be a room character: ${known}`);
}
const lightingRequested = flag('lighting');
const smashRequested = flag('smash');
const lifeRequested = flag('life');

const frameArg = rawArg('frame');
const requestedFrame = FRAME_KINDS.find((kind) => kind === frameArg);
if (frameArg !== undefined && requestedFrame === undefined) {
  throw new Error(`--frame must be one of ${FRAME_KINDS.join(', ')}`);
}
// A room character is judged on the room wearing it, so asking for one without
// a framing frames that room.
const frameKind: FrameKind | undefined =
  requestedFrame ?? (characterId === undefined ? undefined : 'room');

await loadGameSpritesInNode(artSeed);

// Written exactly as `DungeonScene` writes it on entering a floor, fallback
// included: the tile painters read the active theme rather than being handed
// one, so a harness that resolved it differently would not be showing the game.
setDungeonFloorTheme(levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);

const gameMap = new GameMap({
  mapSize: levelDef.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'dungeon',
  dungeon: dungeonOptionsForLevel(levelDef),
  artSeed,
  worldSeed,
});

// The other framings are the rooms whose contents are decided by the generator
// rather than by a tile painter — a station's counter run, the nursery's
// doorways and its grates, the lab's scientist standing in his own doorway — and
// every one of them is a question only a framed screenshot answers.
const safeRoom = flag('safe-room') ? gameMap.safeRooms[0] : undefined;
const questRoom = flag('quest-room') ? gameMap.questRooms[0] : undefined;
const spiderLab = flag('spider-lab') ? gameMap.spiderLabRoom : null;
const signKind = stringArg('sign', '');
const questExitArg = stringArg('quest-exit', '');
const questExitState = QUEST_EXIT_DOOR_STATES.find((state) => state === questExitArg);
if (questExitArg !== '' && questExitState === undefined) {
  throw new Error(`--quest-exit must be one of ${QUEST_EXIT_DOOR_STATES.join(', ')}`);
}
const questExitTile =
  questExitState === undefined ? undefined : gameMap.questRooms[0]?.exitDoorTiles[0];
if (questExitState !== undefined) {
  if (questExitTile === undefined) throw new Error('this map has no quest exit doorway');
  gameMap.setQuestExitDoorState(questExitState);
}
const roomBounds = gameMap.roomBounds;
const stairwellRequested = flag('stairwell');
const framedStairwell = stairwellRequested ? gameMap.stairwellTiles[0] : undefined;
if (stairwellRequested && framedStairwell === undefined) {
  throw new Error('this floor has no stairwell');
}

function rectContains(rect: Rect, tile: Point): boolean {
  return (
    tile.x >= rect.x && tile.x < rect.x + rect.w && tile.y >= rect.y && tile.y < rect.y + rect.h
  );
}

const insideAny = (rooms: ReadonlyArray<Rect>, tile: Point): boolean =>
  rooms.some((room) => rectContains(room, tile));

const framedSign =
  signKind === ''
    ? undefined
    : gameMap.tilesOfType(CRAWLER_SIGN).find((tile) => {
        const inRoom = insideAny(roomBounds, tile);
        return signKind === 'room' ? inRoom : !inRoom;
      });
if (signKind !== '' && framedSign === undefined) {
  throw new Error(`this map has no ${signKind} sign; try another --seed`);
}

// The generator lays the room; `DungeonScene` stamps the counter run and the
// furnishings on entering the floor. A harness that skipped them framed an empty
// station, which is the one thing a station screenshot is not for.
if (safeRoom !== undefined) {
  stampSafeRoomCounters(gameMap);
  stampSafeRoomDecor(gameMap);
}

const propsRequested =
  flag('props') ||
  safeRoom !== undefined ||
  questRoom !== undefined ||
  spiderLab !== null ||
  framedSign !== undefined ||
  questExitTile !== undefined;

// ── Framing targets ─────────────────────────────────────────────────────────

/**
 * The first plain room — not the start room, a station, a boss arena, the
 * nursery or the lab, and not a treasure room — which is what "a room" means
 * when judging a floor's ordinary look.
 */
function firstOrdinaryRoom(): RoomRegion {
  const ordinary = gameMap.regionMap.rooms.find(
    (room) => room.role === 'regular' && !room.treasure,
  );
  if (ordinary === undefined) throw new Error('this map has no ordinary room to frame');
  return ordinary;
}

function tileKey(tile: Point): string {
  return `${tile.x},${tile.y}`;
}

/**
 * Every hallway floor tile, keyed by {@link tileKey}. An arena's drum is
 * recorded as a hallway because no room rectangle covers it, but it is a round
 * floor, not a corridor, so it is left out.
 */
function corridorTiles(): Map<string, Point> {
  const tiles = new Map<string, Point>();
  for (const hallway of gameMap.regionMap.hallways) {
    if (hallway.arena) continue;
    for (const tile of hallway.tiles) tiles.set(tileKey(tile), tile);
  }
  return tiles;
}

/** The longest straight run of corridor floor, as the rect it covers. */
function longestHallwayRun(corridor: ReadonlyMap<string, Point>): Rect {
  const runs: Rect[] = [];
  for (const { x, y } of corridor.values()) {
    // Measured only from a run's first tile, so each run is walked once.
    if (!corridor.has(tileKey({ x: x - 1, y }))) {
      let length = 1;
      while (corridor.has(tileKey({ x: x + length, y }))) length++;
      runs.push({ x, y, w: length, h: 1 });
    }
    if (!corridor.has(tileKey({ x, y: y - 1 }))) {
      let length = 1;
      while (corridor.has(tileKey({ x, y: y + length }))) length++;
      runs.push({ x, y, w: 1, h: length });
    }
  }
  const runLength = (run: Rect): number => Math.max(run.w, run.h);
  const best = runs.reduce<Rect | undefined>(
    (longest, run) =>
      longest === undefined || runLength(run) > runLength(longest) ? run : longest,
    undefined,
  );
  if (best === undefined) throw new Error('this map has no corridor to frame');
  return best;
}

/** The middle `maxTiles` of a one-tile-thick run, or the whole run when it is shorter. */
function middleStretch(run: Rect, maxTiles: number): Rect {
  const horizontal = run.w >= run.h;
  const length = horizontal ? run.w : run.h;
  if (length <= maxTiles) return run;
  const offset = Math.floor((length - maxTiles) / 2);
  return horizontal
    ? { x: run.x + offset, y: run.y, w: maxTiles, h: run.h }
    : { x: run.x, y: run.y + offset, w: run.w, h: maxTiles };
}

/** The corridor tile with the most arms, first in scan order among equals. */
function busiestJunction(corridor: ReadonlyMap<string, Point>): Point {
  let best: Point | undefined;
  let bestArms = JUNCTION_MIN_ARMS - 1;
  for (const { x, y } of corridor.values()) {
    let arms = 0;
    for (const step of ORTHOGONAL_STEPS) {
      let reach = 1;
      while (
        reach <= JUNCTION_ARM_TILES &&
        corridor.has(tileKey({ x: x + step.x * reach, y: y + step.y * reach }))
      ) {
        reach++;
      }
      if (reach > JUNCTION_ARM_TILES) arms++;
    }
    if (arms > bestArms) {
      bestArms = arms;
      best = { x, y };
    }
  }
  if (best === undefined) throw new Error('this map has no corridor junction; try another --seed');
  return best;
}

/**
 * The first room the generator dressed as `id`. A floor dresses its rooms from
 * its own table only, so asking floor 1 for a floor 2 character finds nothing.
 */
function firstRoomWithCharacter(id: string): RoomRegion {
  const room = gameMap.regionMap.rooms.find((candidate) => {
    const assignment = gameMap.regionCharacters.forRegion(candidate.id);
    return assignment?.type === 'room' && assignment.character.id === id;
  });
  if (room === undefined) {
    throw new Error(`no room on this map was dressed as ${id}; try another --seed or --level`);
  }
  return room;
}

/** The room a room or doorway framing shows: the requested character's, or the first ordinary one. */
function framedRoom(): RoomRegion {
  return characterId === undefined ? firstOrdinaryRoom() : firstRoomWithCharacter(characterId);
}

function framedDoorway(): Point {
  const doorways = framedRoom().doorways;
  if (doorways.length === 0) throw new Error('the framed room has no doorway');
  return doorways[0].tile;
}

/** The rect a framing wants in view, before padding. */
function frameTarget(kind: FrameKind): Rect {
  switch (kind) {
    case 'room':
      return framedRoom().bounds;
    case 'hallway':
      return middleStretch(longestHallwayRun(corridorTiles()), HALLWAY_FRAME_MAX_RUN_TILES);
    case 'junction': {
      const tile = busiestJunction(corridorTiles());
      return { x: tile.x, y: tile.y, w: 1, h: 1 };
    }
    case 'doorway': {
      const tile = framedDoorway();
      return { x: tile.x, y: tile.y, w: 1, h: 1 };
    }
  }
}

/** A view around `target` with padding on every side and at least the minimum size. */
function paddedView(target: Rect): Rect {
  const w = Math.max(target.w + FRAME_PADDING_TILES * 2, FRAME_MIN_TILES_W);
  const h = Math.max(target.h + FRAME_PADDING_TILES * 2, FRAME_MIN_TILES_H);
  const centreX = target.x + target.w / 2;
  const centreY = target.y + target.h / 2;
  return { x: Math.round(centreX - w / 2), y: Math.round(centreY - h / 2), w, h };
}

function focusedView(focus: Point): Rect {
  return {
    x: focus.x - Math.floor(DEFAULT_VIEW_TILES_W / 2),
    y: focus.y - Math.floor(DEFAULT_VIEW_TILES_H / 2),
    w: DEFAULT_VIEW_TILES_W,
    h: DEFAULT_VIEW_TILES_H,
  };
}

const focus =
  framedStairwell ??
  questExitTile ??
  framedSign ??
  safeRoom?.centre ??
  questRoom?.centre ??
  spiderLab?.centre ??
  gameMap.startTile;
const chosenView =
  frameKind === undefined ? focusedView(focus) : paddedView(frameTarget(frameKind));

const viewTilesW = intArg('w', chosenView.w);
const viewTilesH = intArg('h', chosenView.h);
const chosenCentreX = chosenView.x + chosenView.w / 2;
const chosenCentreY = chosenView.y + chosenView.h / 2;
const viewTileX = intArg('x', Math.round(chosenCentreX - viewTilesW / 2));
const viewTileY = intArg('y', Math.round(chosenCentreY - viewTilesH / 2));

const camX = viewTileX * TILE_SIZE;
const camY = viewTileY * TILE_SIZE;
const viewW = viewTilesW * TILE_SIZE;
const viewH = viewTilesH * TILE_SIZE;

// ── Passes the game draws after the chunk layer ─────────────────────────────

/** One thing drawn in the Y-sorted pass, keyed the way `RenderPipeline` keys it. */
interface SortedDraw {
  readonly sortY: number;
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
}

/** The map's decoration tiles, anchored on their sprite's foot as the game sorts them. */
function decorationDraws(): SortedDraw[] {
  return gameMap.getVisibleDecorationTiles(camX, camY, viewW, viewH).map((deco) => ({
    sortY: deco.ty * TILE_SIZE + deco.sortYAnchorPx,
    draw: (ctx) => gameMap.drawDecorationAt(ctx, deco.tx, deco.ty, camX, camY),
  }));
}

/**
 * Fixtures hung on wall faces — sconces, tubes, panels, chains — each sorted
 * on its face's foot exactly as the game sorts it, at the fixed clock, with a
 * camera watching the middle of the view where the player would stand.
 */
function wallFixtureDraws(): SortedDraw[] {
  const floor = dungeonFloorTheme().id;
  const watchX = camX + viewW / 2;
  const watchY = camY + viewH / 2;
  return collectVisibleWallFixtures(gameMap.wallFixtures, camX, camY, viewW, viewH, []).map(
    (fixture) => {
      const faceX = fixture.tileX * TILE_SIZE;
      const faceY = fixture.tileY * TILE_SIZE;
      return {
        sortY: wallFixtureSortY(fixture),
        draw: (ctx) =>
          drawWallFixture(ctx, fixture, faceX - camX, faceY - camY, TILE_SIZE, {
            nowMs: LIGHTING_CLOCK_MS,
            floor,
            lit: isFixtureLit(fixture, gameMap.wallFixtures),
            watch: { dx: watchX - faceX, dy: watchY - faceY },
          }),
      };
    },
  );
}

/**
 * The floor's lighting pass, evaluated at `clockMs` over the view, built the
 * way `DungeonScene` builds it. Returns whether the map has a lighting pass.
 */
function applyLighting(ctx: CanvasRenderingContext2D, clockMs: number): boolean {
  if (gameMap.regionCharacters.roomAssignments().length === 0) return false;
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => clockMs,
    additiveGlows: () => true,
  });
  if (gameMap.questRooms.length > 0) {
    const nursery = new DefendQuestSystem(
      gameMap,
      new EventBus(),
      () => undefined,
      new Conversation(null),
      () => 1,
      undefined,
    );
    for (const sconce of nursery.sconceLights()) {
      lighting.registerStaticLight({
        tileX: sconce.tileX,
        tileY: sconce.tileY,
        kind: 'wall_sconce',
        centre: { x: sconce.centreX, y: sconce.centreY },
      });
    }
  }
  lighting.addDynamicLightSource({
    collectLights: (sink) =>
      sink.add(camX + viewW / 2, camY + viewH / 2, 'crawler', 1, CRAWLER_LIGHT_REACH_TILES),
  });
  if (smashed !== null) lighting.addDynamicLightSource(smashed);
  lighting.render(ctx, camX, camY, viewW, viewH);
  // Burning oil is a floor warning, drawn back over the dark as the game draws it.
  if (smashed?.hasGroundArt === true) {
    lighting.renderOverDarkness(ctx, scale, {
      paintOverDarkness: (target) => smashed.renderGroundWarnings(target, camX, camY),
    });
  }
  return true;
}

/** Game time the small moving things run for before the picture is taken. */
const LIFE_WARMUP_FRAMES = 150;
/** The drip is caught this many frames into its fall. */
const LIFE_DRIP_FRAMES_BEFORE_SHOT = 8;
/** A fixed stream, so two runs draw the same critters in the same places. */
const LIFE_RANDOM_SEED = 0x5eed;
const LIFE_RANDOM_MULTIPLIER = 1664525;
const LIFE_RANDOM_INCREMENT = 1013904223;

function lifeRandom(): () => number {
  let state = LIFE_RANDOM_SEED;
  return () => {
    state = (Math.imul(state, LIFE_RANDOM_MULTIPLIER) + LIFE_RANDOM_INCREMENT) >>> 0;
    return state / UINT32_SPAN;
  };
}

function buildLife(): DungeonLifeSystem | null {
  if (!lifeRequested || gameMap.regionCharacters.roomAssignments().length === 0) return null;
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => LIGHTING_CLOCK_MS,
    additiveGlows: () => true,
  });
  const life = new DungeonLifeSystem({
    gameMap,
    floor: dungeonFloorTheme().id,
    puddles: floorSurfaceOf(gameMap.structure) ?? null,
    lights: lighting,
    fullDetail: () => true,
    raiseCue: () => undefined,
    random: lifeRandom(),
  });
  const puddle = life.puddles.find(
    (tile) =>
      tile.x * TILE_SIZE >= camX &&
      tile.y * TILE_SIZE >= camY &&
      tile.x * TILE_SIZE < camX + viewW &&
      tile.y * TILE_SIZE < camY + viewH,
  );
  // A walker wading west to east along the puddle's row at walking pace,
  // a stride or two into the water as the shot is taken.
  const wader = { x: -TILE_SIZE * viewW, y: 0 };
  for (let frame = 0; frame < LIFE_WARMUP_FRAMES; frame++) {
    const shotIn = LIFE_WARMUP_FRAMES - frame;
    if (puddle !== undefined) {
      const feetX = (puddle.x + WADER_END_TILES) * TILE_SIZE - shotIn * WADER_SPEED_PX;
      wader.x = feetX - TILE_SIZE * HALF_TILE_SHARE;
      wader.y =
        (puddle.y + HALF_TILE_SHARE) * TILE_SIZE -
        WADER_FEET_BELOW_CENTRE_PX -
        TILE_SIZE * HALF_TILE_SHARE;
    }
    if (puddle !== undefined && shotIn === LIFE_DRIP_FRAMES_BEFORE_SHOT) {
      life.spawnDrip(puddle.x, puddle.y);
    }
    life.update({ party: [], others: [wader], camX, camY, viewW, viewH });
  }
  return life;
}

const HALF_TILE_SHARE = 0.5;
/** A crawler's walking pace, in pixels a frame. */
const WADER_SPEED_PX = 2;
/** Where the wader's feet are when the shot is taken, in tiles east of the puddle's west edge. */
const WADER_END_TILES = 2;
/** Where a walker's feet sit below its centre, as the splash test reads them. */
const WADER_FEET_BELOW_CENTRE_PX = 12;

const canvas = createCanvas(viewW * scale, viewH * scale);
const ctx = asGameContext(canvas.getContext('2d'));
ctx.scale(scale, scale);

renderCanvas(ctx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);

/** A blast reaching from a neighbouring tile to just past the struck tile's centre, in tiles. */
const SMASH_REACH_TILES = 1.1;
const SMASH_REACH_PX = TILE_SIZE * SMASH_REACH_TILES;
const SMASH_ORIGINS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;
const SMASH_TYPES = new Set(Array.from(ALL_BREAKABLE_PROPS, (kind) => TILE_TYPE_FOR_KIND[kind]));
const TILE_MIDDLE = 0.5;
const tileMiddle = (tile: number): number => (tile + TILE_MIDDLE) * TILE_SIZE;

/** Breaks everything breakable in the view, as a crawler working round the room would. */
function smashView(): DestructiblePropSystem {
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), levelDef.floorNumber);
  const crawler = new HumanPlayer(viewTileX, viewTileY, TILE_SIZE);
  for (let ty = viewTileY; ty < viewTileY + viewTilesH; ty++) {
    for (let tx = viewTileX; tx < viewTileX + viewTilesW; tx++) {
      if (!SMASH_TYPES.has(gameMap.structure[ty]?.[tx]?.type ?? -1)) continue;
      for (const [dx, dy] of SMASH_ORIGINS) {
        const besideY = ty + dy;
        const besideX = tx + dx;
        const row =
          besideY >= 0 && besideY < gameMap.structure.length ? gameMap.structure[besideY] : null;
        if (row === null || besideX < 0 || besideX >= row.length) continue;
        if (!isWalkableTileType(row[besideX])) continue;
        props.destroyInRadius(tileMiddle(tx + dx), tileMiddle(ty + dy), SMASH_REACH_PX, crawler);
        break;
      }
    }
  }
  for (const fixture of gameMap.wallFixtures) {
    const inView =
      fixture.tileX >= viewTileX &&
      fixture.tileX < viewTileX + viewTilesW &&
      fixture.tileY >= viewTileY &&
      fixture.tileY < viewTileY + viewTilesH;
    if (!inView) continue;
    const below = tileMiddle(fixture.tileY + 1);
    props.destroyInRadius(tileMiddle(fixture.tileX), below, SMASH_REACH_PX, crawler);
  }
  for (let frame = 0; frame < OIL_FIRE_CATCH_FRAMES; frame++) props.update();
  return props;
}

setViewportSize(viewW, viewH);
const smashed = smashRequested ? smashView() : null;
smashed?.renderWreckage(ctx, camX, camY);
const life = buildLife();
life?.renderGround(ctx, camX, camY, viewW, viewH);
// The colosseum's caged pigs, banners and flood lamps are its dressing system's
// ground layer, not tiles: without it the rim shows only the empty cage sockets
// the tile painter leaves for them, as black squares.
if (propsRequested) buildColosseumDressing(gameMap)?.renderGround(ctx, camX, camY);

if (propsRequested || smashRequested) {
  // Fixtures go in ahead of props so the stable sort keeps a fixture behind a
  // prop on the same foot line: the fixture is on the wall the prop stands at.
  const sorted = [...wallFixtureDraws(), ...decorationDraws()].sort((a, b) => a.sortY - b.sortY);
  for (const entry of sorted) entry.draw(ctx);
}
if (stairwellRequested) {
  new StairwellSystem(
    gameMap,
    levelDef,
    () => undefined,
    () => 1,
  ).renderStairwells(ctx, camX, camY);
}
life?.renderAir(ctx, camX, camY, viewW, viewH);

if (lightingRequested && !applyLighting(ctx, LIGHTING_CLOCK_MS)) {
  console.warn('--lighting: this map has no room characters to light it by; rendered unlit');
}

writePreviewPng(outPath, canvas.toBuffer('image/png'));
const drawn = [
  propsRequested ? 'props' : 'no props',
  ...(lightingRequested ? ['lighting'] : []),
  ...(life !== null ? ['life'] : []),
  frameKind ? `frame=${frameKind}` : 'focus',
];
console.log(
  `${outPath}: ${levelDef.name} (${levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME}), ` +
    `seed ${gameMap.worldSeed}, ${drawn.join(', ')}, ` +
    `${viewTilesW}x${viewTilesH} tiles at ${scale}x from (${viewTileX}, ${viewTileY})`,
);
