/**
 * Floor 3's routes for `report:residency`, driven through the game's real
 * `SceneManager`, `DungeonScene` and `BuildingInteriorScene` behind the browser
 * shim: the party walks onto a door, accepts the door menu with Space, walks
 * about inside, walks out over the exit mat, and walks across the overworld by
 * being moved a fastest-walk step per frame, so the camera streams the ground
 * exactly as a crawler's walk would.
 *
 * - `tour`: the plaza and main streets, the Cloak & Dagger and eleven more
 *   interiors (the inn with the safe room and a shop among them), then Briar
 *   Hollow, stood in for longer than either cache's idle window.
 * - `direct`: arrival, then straight to Briar Hollow, the same wait.
 *
 * Import only after the browser shim is installed.
 */

import type { Scene } from '../src/core/Scene.js';
import type { BuildingEntry } from '../src/map/buildingEntry.js';
import type { BrowserShim } from './browserShim.js';
import { ShimEvent } from './browserShim.js';
import {
  FASTEST_WALK_PX_PER_UPDATE,
  ReachabilityTracker,
  SheetCatalogue,
  searchRetainers,
  takeSnapshot,
} from './residencyProbe.js';
import { INTERIOR_MILESTONE_PREFIX } from './residencyRoutes.js';
import type {
  RESIDENCY_FLOORS,
  ResidencySnapshot,
  RetainerPath,
  RouteResult,
} from './residencyRoutes.js';
import { installFakeAudio } from './audioHarness.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { loadSprites } from '../src/core/spriteAssets/SpriteLoader.js';
import { SceneManager } from '../src/core/Scene.js';
import { InputManager } from '../src/core/input/InputManager.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { settings } from '../src/core/input/Settings.js';
import { forceVarietyTier, FULL_VARIETY_TIER } from '../src/core/perf/varietyTier.js';
import { DungeonScene } from '../src/scenes/DungeonScene.js';
import { BuildingInteriorScene } from '../src/scenes/BuildingInteriorScene.js';
import { GameplayScene } from '../src/scenes/GameplayScene.js';
import { GameMap } from '../src/map/GameMap.js';
import { level3 } from '../src/levels/level3.js';
import { renderQuality } from '../src/core/perf/RenderQuality.js';
import { environmentPaintDepth, RECENTLY_DRAWN_FRAMES } from '../src/map/environmentArtCache.js';
import {
  figurePrewarmDepth,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache.js';
import { TownLifeSystem } from '../src/systems/TownLifeSystem.js';
import { MarketSystem } from '../src/systems/market/MarketSystem.js';
import { citizenFigureRows, type CitizenFigure } from '../src/creatures/citizenFigure.js';
import { RATKIN_CAST_PREWARM_ORDER } from '../src/sprites/ratkinCastSprite.js';
import { ratkinCastFigure } from '../src/sprites/art/ratkinCastFigure.js';
import type { BuildingId } from '../src/map/buildingIds.js';

export type Floor3Route = (typeof RESIDENCY_FLOORS)['3']['routes'][number];

/** The seed every floor-3 harness that walks to Briar Hollow uses; its village sites cleanly. */
const WORLD_SEED = 1;
const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const FRAME_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
/** Frames an arrival's loading screen may take before the route calls it hung. */
const MAX_ARRIVAL_FRAMES = 6000;
/** Frames a walk onto a door or an exit mat may take. */
const MAX_DOOR_WALK_FRAMES = 90;
/** Frames walked each way inside a room, so the room's art is drawn from more than one spot. */
const WANDER_FRAMES_EACH_WAY = 30;
/** Frames the party stands still after a scene change before it is driven. */
const ARRIVAL_PAUSE_FRAMES = 5;
/** Interiors the tour visits: the club and eleven more. */
const TOUR_INTERIOR_COUNT = 12;
/** Visited first, in this order: the casino, the inn with the safe room, and a shop. */
const TOUR_FIRST_BUILDINGS: readonly BuildingId[] = [
  'taloncrest_nightclub',
  'taloncrest_inn',
  'taloncrest_general_store',
];
/** Never entered: the Starlight Tent is the circus's maze, which parks both crawlers, and the tower is a fight. */
const TOUR_SKIPPED_BUILDINGS: ReadonlySet<BuildingId> = new Set([
  'taloncrest_circus_tent',
  'taloncrest_tower',
]);
const DOOR_MENU_SURFACE = 'building-entry';
const EXIT_MENU_SURFACE = 'exit-building';
const CONVERSATION_SURFACE = 'conversation';
/** Escapes tried on one conversation before the route gives up on it. */
const MAX_CONVERSATION_DISMISSALS = 8;
/** Frames past both caches' idle windows the party stands at the destination. */
const DESTINATION_MARGIN_FRAMES = 300;
const DESTINATION_WAIT_FRAMES =
  Math.max(IDLE_FRAMES_BEFORE_RELEASE, RECENTLY_DRAWN_FRAMES) + DESTINATION_MARGIN_FRAMES;
/** Where the cat trails the walking human, so both crawlers stay on screen. */
const CAT_TRAIL_PX = TILE_SIZE;
/** Every sound fails to fetch headless, by design; one warning per sound would bury the report. */
const SILENT_AUDIO_WARNING = '[AudioManager] Failed to load';

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** Narrows an unknown field to the maps a scene plays on. */
function mapsOf(scene: object): GameMap[] {
  const maps: GameMap[] = [];
  for (const field of ['gameMap', 'map']) {
    const value: unknown = Reflect.get(scene, field);
    if (value instanceof GameMap) maps.push(value);
  }
  const storeys: unknown = Reflect.get(scene, 'towerFloors');
  if (Array.isArray(storeys)) {
    for (const storey of storeys) if (storey instanceof GameMap) maps.push(storey);
  }
  return [...new Set(maps)];
}

/** Every figure row the overworld's street crowd and market vendors can be drawn as. */
function crowdFigureIdsOf(scene: object): string[] {
  const figures: CitizenFigure[] = [];
  const townLife: unknown = Reflect.get(scene, 'townLife');
  const castLooks = (people: ReadonlyArray<{ citizenFigure: CitizenFigure | null }>) =>
    people.flatMap((person) => (person.citizenFigure === null ? [] : [person.citizenFigure]));
  if (townLife instanceof TownLifeSystem) figures.push(...castLooks(townLife.people));
  const market: unknown = Reflect.get(scene, 'market');
  if (market instanceof MarketSystem) figures.push(...castLooks(market.vendors));
  const ids = new Set<string>();
  for (const figure of figures) for (const row of citizenFigureRows(figure)) ids.add(row.def.id);
  return [...ids];
}

function silenceAudioLoadWarnings(): void {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith(SILENT_AUDIO_WARNING)) return;
    warn(...args);
  };
}

/**
 * Kept in the harness on purpose, never by the game: the one way to show that
 * a survivor is found and its retainer named, since a clean route has none.
 */
export const RETAIN_INTERIORS_FAULT = 'retain-interiors';

export interface Floor3RouteOptions {
  readonly shim: BrowserShim;
  /** Where a heap snapshot for the retainer search is written. */
  readonly scratchDirectory: string;
  readonly findRetainers: boolean;
  /** Interiors the tour visits; fewer than the full tour for a quick look. */
  readonly interiors?: number;
  /** The buildings the tour visits first, in order, in place of its usual first three. */
  readonly firstBuildings?: readonly string[];
  /** {@link RETAIN_INTERIORS_FAULT} holds every interior left behind, which must surface as survivors. */
  readonly fault?: string;
}

const faultRetained: object[] = [];

/** Drives one floor-3 route and returns everything it measured. */
export async function runFloor3Route(
  route: Floor3Route,
  options: Floor3RouteOptions,
): Promise<RouteResult> {
  const { shim, scratchDirectory, findRetainers } = options;
  const interiorCount = options.interiors ?? TOUR_INTERIOR_COUNT;
  const startedAt = performance.now();
  installFakeAudio({ initialState: 'running' });
  silenceAudioLoadWarnings();
  settings.setDifficultyForSession('normal');
  // Sharp pins the render scale and the variety tier: node frames are slow
  // enough that the lag ladder would otherwise trim the crowd's looks mid-run.
  settings.setQuality('sharp');
  forceVarietyTier(FULL_VARIETY_TIER);
  await loadSprites('src/images/');

  const notes: string[] = [];
  const snapshots: ResidencySnapshot[] = [];
  const tracker = new ReachabilityTracker();
  const catalogue = new SheetCatalogue(level3);
  const input = new InputManager();
  const sceneManager = new SceneManager();
  const audio = new AudioManager();

  let current: Scene | null = null;
  let outdoors: DungeonScene | null = null;
  let sceneCount = 0;
  const replace = sceneManager.replace.bind(sceneManager);
  sceneManager.replace = (next: Scene) => {
    const label = `${next.constructor.name}#${sceneCount++}`;
    tracker.track(label, next);
    mapsOf(next).forEach((map, index) => tracker.track(`GameMap ${index} of ${label}`, map));
    if (options.fault === RETAIN_INTERIORS_FAULT && current instanceof BuildingInteriorScene) {
      faultRetained.push(current);
    }
    current = next;
    if (next instanceof DungeonScene) outdoors = next;
    replace(next);
  };

  /**
   * The running scene and its maps, and the floor outside with its map while
   * a building is visited: the exit is built from that scene and walks back
   * onto that map. Alive because they are played, not survivors.
   */
  function inUse(): ReadonlySet<object> {
    const played: object[] = [];
    for (const scene of [current, outdoors]) {
      if (scene !== null) played.push(scene, ...mapsOf(scene));
    }
    return new Set(played);
  }

  function currentScene(): GameplayScene {
    if (!(current instanceof GameplayScene)) throw new Error('no gameplay scene is running');
    return current;
  }

  let clockMs = 0;
  let frames = 0;
  const thrown: string[] = [];
  /** Hit points the crawlers are held at outdoors: the wilderness' creatures are not the subject. */
  let hpFloor: { human: number; cat: number } | null = null;

  async function runFrame(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    const scene = current;
    if (scene instanceof DungeonScene && hpFloor !== null) {
      scene.pm.human.hp = Math.max(scene.pm.human.hp, hpFloor.human);
      scene.pm.cat.hp = Math.max(scene.pm.cat.hp, hpFloor.cat);
    }
    clockMs += FRAME_MS;
    frames++;
    try {
      shim.runAnimationFrame(clockMs);
    } catch (error) {
      thrown.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }

  async function runFrames(count: number): Promise<void> {
    for (let frame = 0; frame < count; frame++) await runFrame();
  }

  function key(type: 'keydown' | 'keyup', name: string): void {
    shim.window.dispatch(new ShimEvent(type, name, clockMs));
  }

  async function press(name: string): Promise<void> {
    key('keydown', name);
    await runFrame();
    key('keyup', name);
    await runFrame();
  }

  async function holdUntil(name: string, maxFrames: number, done: () => boolean): Promise<boolean> {
    key('keydown', name);
    let reached = false;
    for (let frame = 0; frame < maxFrames; frame++) {
      await runFrame();
      if (done()) {
        reached = true;
        break;
      }
    }
    key('keyup', name);
    await runFrame();
    return reached;
  }

  async function settleLoader(): Promise<void> {
    let waited = 0;
    while (
      waited < MAX_ARRIVAL_FRAMES &&
      (currentScene().arrivalLoadingOpen || renderQuality.isLoadingCovered)
    ) {
      await runFrame();
      waited++;
    }
    if (waited >= MAX_ARRIVAL_FRAMES) notes.push(`a loading screen stayed up ${waited} frames`);
  }

  async function dismissConversations(): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONVERSATION_DISMISSALS; attempt++) {
      const ui = currentScene().ui;
      const haltingConversationUp = ui.isOpen(CONVERSATION_SURFACE) && ui.worldHalted();
      if (!haltingConversationUp) return;
      await press('Escape');
    }
  }

  function placeParty(x: number, y: number): void {
    const { human, cat } = currentScene().pm;
    human.x = x;
    human.y = y;
    cat.x = x;
    cat.y = y + CAT_TRAIL_PX;
  }

  /** Moves the party to `target` (world pixels) a fastest-walk step per frame. */
  async function walkTo(target: TilePoint): Promise<void> {
    for (;;) {
      const { human } = currentScene().pm;
      const dx = target.x - human.x;
      const dy = target.y - human.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining <= FASTEST_WALK_PX_PER_UPDATE) {
        placeParty(target.x, target.y);
        await runFrame();
        return;
      }
      const step = FASTEST_WALK_PX_PER_UPDATE / remaining;
      placeParty(human.x + dx * step, human.y + dy * step);
      await runFrame();
    }
  }

  function tilePx(tile: TilePoint): TilePoint {
    return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
  }

  async function snapshot(label: string): Promise<void> {
    snapshots.push(await takeSnapshot(label, frames, catalogue, tracker, inUse()));
  }

  /**
   * Walks to the tile below `door`, onto the door, through it, about the room
   * and back out. In a function of its own so nothing of the visit's scene is
   * left in the caller's frame when the visit is measured.
   */
  async function visit(door: BuildingEntry): Promise<'visited' | 'doorShut'> {
    await walkTo(tilePx({ x: door.doorTile.x, y: door.doorTile.y + 1 }));
    await runFrames(ARRIVAL_PAUSE_FRAMES);
    const opened = await holdUntil(
      'w',
      MAX_DOOR_WALK_FRAMES,
      () => currentScene().ui.focusSurfaceId() === DOOR_MENU_SURFACE,
    );
    if (!opened) return 'doorShut';
    await press(' ');
    if (!(current instanceof BuildingInteriorScene)) return 'doorShut';
    await settleLoader();
    await runFrames(ARRIVAL_PAUSE_FRAMES);
    await dismissConversations();
    const doorstep = { x: currentScene().pm.human.x, y: currentScene().pm.human.y };
    await holdUntil('a', WANDER_FRAMES_EACH_WAY, () => false);
    await holdUntil('d', WANDER_FRAMES_EACH_WAY, () => false);
    await snapshot(`${INTERIOR_MILESTONE_PREFIX}${door.id}`);
    currentScene().pm.human.x = doorstep.x;
    currentScene().pm.human.y = doorstep.y;
    await dismissConversations();
    const onMat = await holdUntil(
      's',
      MAX_DOOR_WALK_FRAMES,
      () => currentScene().ui.focusSurfaceId() === EXIT_MENU_SURFACE,
    );
    if (onMat) await press(' ');
    // Every later milestone would be measured indoors under a street label.
    if (!(current instanceof DungeonScene)) throw new Error(`could not walk out of ${door.id}`);
    await settleLoader();
    await runFrames(ARRIVAL_PAUSE_FRAMES);
    return 'visited';
  }

  /** The tour's doors: the three it must see first, then the nearest unvisited each time. */
  function tourDoors(entries: readonly BuildingEntry[]): BuildingEntry[] {
    const candidates = entries.filter((entry) => !TOUR_SKIPPED_BUILDINGS.has(entry.id));
    const ordered: BuildingEntry[] = [];
    for (const name of options.firstBuildings ?? TOUR_FIRST_BUILDINGS) {
      const entry = candidates.find((candidate) => candidate.id === name);
      if (entry === undefined) throw new Error(`the town has no ${name}`);
      ordered.push(entry);
    }
    const rest = candidates.filter((entry) => !ordered.includes(entry));
    while (rest.length > 0) {
      const from = ordered[ordered.length - 1].doorTile;
      rest.sort(
        (a, b) =>
          Math.hypot(a.doorTile.x - from.x, a.doorTile.y - from.y) -
          Math.hypot(b.doorTile.x - from.x, b.doorTile.y - from.y),
      );
      const nearest = rest.shift();
      if (nearest !== undefined) ordered.push(nearest);
    }
    return ordered;
  }

  sceneManager.replace(
    new DungeonScene(level3, input, sceneManager, {
      worldSeed: WORLD_SEED,
      skipIntro: true,
      audio,
    }),
  );
  let arrivalFrames = 0;
  while (
    arrivalFrames < MAX_ARRIVAL_FRAMES &&
    (currentScene().arrivalLoadingOpen ||
      environmentPaintDepth() > 0 ||
      figurePrewarmDepth() > 0 ||
      renderQuality.isLoadingCovered)
  ) {
    await runFrame();
    arrivalFrames++;
  }
  await dismissConversations();
  hpFloor = { human: currentScene().pm.human.hp, cat: currentScene().pm.cat.hp };
  // Read from the running scene's own map: a second overworld map held by the
  // harness would add itself to every heap reading.
  const overworld = mapsOf(currentScene())[0];
  const plan = overworld.townPlan;
  const village = overworld.briarHollow;
  if (plan === undefined || village === null) {
    throw new Error(`seed ${WORLD_SEED} has no town or no Briar Hollow`);
  }
  const plazaCentre = tilePx(plan.centre);
  const villageCentre = tilePx(village.centre);
  const doors = tourDoors(overworld.buildingEntries);
  const crowdFigureIds = crowdFigureIdsOf(currentScene());
  await snapshot('arrival');

  if (route === 'tour') {
    let visited = 0;
    for (const door of doors) {
      if (visited >= interiorCount) break;
      if ((await visit(door)) === 'visited') {
        visited++;
        await snapshot(`after ${door.id}`);
      } else {
        notes.push(`skipped ${door.id}: the door would not open`);
      }
    }
    if (visited < interiorCount) notes.push(`visited ${visited} of ${interiorCount} interiors`);
  }

  placeParty(plazaCentre.x, plazaCentre.y);
  await runFrames(ARRIVAL_PAUSE_FRAMES);
  await walkTo(villageCentre);
  await dismissConversations();
  await snapshot('Briar Hollow, arrived');
  for (let frame = 0; frame < DESTINATION_WAIT_FRAMES; frame++) {
    placeParty(villageCentre.x, villageCentre.y);
    await runFrame();
    if (frame % FRAMES_PER_SECOND === 0) await dismissConversations();
  }
  await snapshot('Briar Hollow, after the wait');

  const lastSnapshot = snapshots[snapshots.length - 1];
  const retainers: RetainerPath[] =
    findRetainers && lastSnapshot.survivors.length > 0
      ? await searchRetainers(scratchDirectory, tracker, inUse())
      : [];
  if (thrown.length > 0) notes.push(`${thrown.length} frame(s) threw; first: ${thrown[0]}`);

  return {
    floor: '3',
    route,
    frames,
    seconds: (performance.now() - startedAt) / MS_PER_SECOND,
    tracked: tracker.trackedCount,
    snapshots,
    retainers,
    measures: [],
    notes,
    crowdFigureIds,
    standByFigureIds: RATKIN_CAST_PREWARM_ORDER.map((id) => ratkinCastFigure(id).id),
  };
}
