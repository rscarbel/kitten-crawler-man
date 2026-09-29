/**
 * A live Big Top, stood up headless and drawn the way `BuildingInteriorScene`
 * draws it: the map's chunk bake, the maze's ground layer (its furniture, the
 * stage lights, then its warnings), the Y-sorted pass (decoration tiles, the
 * maze's own prop mobs, Carl and Donut), then the maze's effects layer.
 *
 * Shared by the in-situ render and anything that has to measure pixels of the
 * tent as a player would see them, so both look at one picture. The frame is
 * built from ordered layers with named hook points between them, which is
 * where a lighting pass or a live overlay slots in without the callers having
 * to re-implement the scene's draw order.
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import { EventBus } from '../src/core/EventBus.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { createCircusQuestProgress } from '../src/core/CircusQuestProgress.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { MazeBellTarget } from '../src/creatures/MazeBellTarget.js';
import { MazeMirrorTarget } from '../src/creatures/MazeMirrorTarget.js';
import type { Mob } from '../src/creatures/Mob.js';
import { Conversation } from '../src/dialog/Conversation.js';
import { GameMap } from '../src/map/GameMap.js';
import {
  MAZE_BELLS,
  MAZE_CURTAINS,
  MAZE_SECTIONS,
  MAZE_SPOTLIGHTS,
  MAZE_SPOTLIGHT_CELLS,
  MAZE_VENTS,
  MAZE_WIDTH,
  sectionAtRow,
  traceMazeBeam,
  ventFlameProgress,
  ventPhaseAt,
  ventTelegraphProgress,
  type MazeSection,
  type MazeSectionId,
  type MazeTile,
  type MirrorFacing,
  type VentPhase,
  type VentSchedule,
} from '../src/map/bigTopMazeLayout.js';
import { BigTopMazeSystem } from '../src/systems/BigTopMazeSystem.js';
import type { SystemContext } from '../src/systems/GameSystem.js';
import { SpellSystem } from '../src/systems/SpellSystem.js';
import { MobRoster } from '../src/systems/kits/SceneWorld.js';
import { asGameContext } from './nodeGameContext.js';

/** A standing tent, plus the frame counter the maze keeps privately. */
export interface TentHarness {
  readonly maze: BigTopMazeSystem;
  readonly map: GameMap;
  readonly frameCtx: SystemContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly spawned: Mob[];
  /**
   * How many times `maze.update` has run, which is the maze's own hazard clock:
   * `update` increments it unconditionally on entry, so counting calls here
   * reproduces it exactly without reaching into the system.
   */
  frame: number;
  section: MazeSection;
}

export function buildTent(artSeed: number): TentHarness {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [], artSeed });
  map.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');
  const progress = createCircusQuestProgress();
  progress.stage = 'bigtop_ready';
  const roster = new MobRoster(map, new SpellSystem());
  const spawned: Mob[] = [];
  const maze = new BigTopMazeSystem(
    map,
    new EventBus(),
    (mob: Mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    new Conversation(null),
  );
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const frameCtx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  return { maze, map, frameCtx, human, cat, spawned, frame: 0, section: MAZE_SECTIONS[0] };
}

/** A list's entry, or undefined past its end — the index check the compiler does not make. */
export function entryAt<T>(list: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < list.length ? list[index] : undefined;
}

export function placeAt(entity: { x: number; y: number }, tile: MazeTile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
}

/** One frame of the tent, with any act card closed the moment it opens. */
export function tick(tent: TentHarness): void {
  tent.maze.update(tent.frameCtx);
  tent.maze.dismissDialog();
  tent.frame++;
}

/**
 * Walks the party through every curtain up to `act`, the way the game gets
 * there, so the act's hazards are the ones armed.
 */
export function enterAct(tent: TentHarness, act: MazeSectionId): void {
  for (const curtain of MAZE_CURTAINS) {
    if (tent.section.id === act) break;
    placeAt(tent.human, { x: curtain.humanRoom.x0, y: curtain.humanRoom.y0 });
    placeAt(tent.cat, { x: curtain.catRoom.x0, y: curtain.catRoom.y0 });
    tick(tent);
    const opened = MAZE_SECTIONS.find((section) => section.id === curtain.opens);
    if (opened === undefined) throw new Error(`${curtain.id} opens onto no act`);
    tent.section = opened;
  }
  if (tent.section.id !== act) throw new Error(`could not walk the party into ${act}`);
  // The act's lights come up over a second after its curtain rises; a frame
  // taken before they finish shows the house board mid-fade.
  stepUntil(tent, () => tent.maze.lightsSettled);
}

/**
 * Longer than the slowest hazard cycle in the tent, so a search for any phase
 * of any cell always finds one.
 */
const PHASE_SEARCH_FRAMES = 2000;

/**
 * Steps the tent until `wanted(frame)` holds, with the party parked on the
 * act's own marks — ground proven never to light — so no burnout resets the
 * act while the clock runs.
 */
export function stepUntil(tent: TentHarness, wanted: (frame: number) => boolean): void {
  for (let step = 0; step < PHASE_SEARCH_FRAMES; step++) {
    if (wanted(tent.frame)) return;
    placeAt(tent.human, tent.section.humanSpawn);
    placeAt(tent.cat, tent.section.catSpawn);
    tick(tent);
  }
  throw new Error(`no frame within ${PHASE_SEARCH_FRAMES} reached the wanted hazard phase`);
}

// ── Forced hazard states ─────────────────────────────────────────────────────

/** Every hazard state the in-situ render forces, and the lighting gate re-checks. */
export const HAZARD_STATES = [
  'vent-telegraph',
  'vent-flame',
  'spotlight-warm',
  'spotlight-beam',
  'held-row',
  'beam-hot',
  'beam-cold',
] as const;
export type HazardState = (typeof HAZARD_STATES)[number];

/**
 * How far into a warning or a burn a forced frame lands. Mid-cycle rather than
 * at either end, where a telegraph is still fading in or a flame is guttering.
 */
const TELEGRAPH_SAMPLE_PROGRESS = 0.6;
const FLAME_SAMPLE_PROGRESS = 0.5;

function cellsInAct(
  cells: ReadonlyArray<VentSchedule>,
  act: MazeSectionId,
): ReadonlyArray<VentSchedule> {
  return cells.filter((cell) => sectionAtRow(cell.tileY).id === act);
}

function tileOfCell(cell: VentSchedule): MazeTile {
  return { x: cell.tileX, y: cell.tileY };
}

/**
 * Steps until `anchor` is `phase` and at least `progress` of the way through
 * it, then returns every cell in the list sharing that phase on that frame.
 */
function forceCellPhase(
  tent: TentHarness,
  cells: ReadonlyArray<VentSchedule>,
  anchor: VentSchedule,
  phase: Exclude<VentPhase, 'idle'>,
): MazeTile[] {
  const progressOf = phase === 'flame' ? ventFlameProgress : ventTelegraphProgress;
  const threshold = phase === 'flame' ? FLAME_SAMPLE_PROGRESS : TELEGRAPH_SAMPLE_PROGRESS;
  stepUntil(tent, (frame) => progressOf(anchor, frame) >= threshold);
  return cells.filter((cell) => ventPhaseAt(cell, tent.frame) === phase).map(tileOfCell);
}

/** The bell the held-row shot rings: the first the cat reaches. */
const HELD_ROW_BELL = MAZE_BELLS[0];
/**
 * The middle of the tent on the row the bell holds. The bell's own stand sits
 * at the act's east edge, so a frame centred on it shows mostly canvas.
 */
const HELD_ROW_FOCUS: MazeTile = {
  x: Math.floor(MAZE_WIDTH / 2),
  y: MAZE_SPOTLIGHTS.find((track) => track.bellId === HELD_ROW_BELL.id)?.cells[0]?.tileY ?? 0,
};
/** Enough to ring any bell in one shot. */
const BELL_RING_DAMAGE = 1000;

function ringBell(tent: TentHarness, bellId: string): MazeTile[] {
  const bell = tent.spawned.find(
    (mob): mob is MazeBellTarget => mob instanceof MazeBellTarget && mob.bellId === bellId,
  );
  if (bell === undefined) throw new Error(`${bellId}: no bell stands in the tent`);
  bell.takeDamageFrom(BELL_RING_DAMAGE, null, 'missile');
  tick(tent);
  if (!bell.isHolding) throw new Error(`${bellId}: ringing it did not hold its lanterns`);
  const held = MAZE_SPOTLIGHTS.filter((track) => track.bellId === bellId);
  return held.flatMap((track) => track.cells.map(tileOfCell));
}

/** Both limelights' paths as the tent is set now, split into burning and cold spans. */
export function beamTiles(tent: TentHarness): { hot: MazeTile[]; cold: MazeTile[] } {
  const facingOf = (mirrorId: string): MirrorFacing | null => {
    const mirror = tent.spawned.find(
      (mob): mob is MazeMirrorTarget =>
        mob instanceof MazeMirrorTarget && mob.mirrorId === mirrorId,
    );
    return mirror?.facing ?? null;
  };
  const isOpen = (x: number, y: number): boolean => tent.map.isWalkable(x, y);
  const hot: MazeTile[] = [];
  const cold: MazeTile[] = [];
  for (const half of ['human', 'cat'] as const) {
    for (const step of traceMazeBeam(half, facingOf, isOpen).steps) {
      (step.hot ? hot : cold).push(step.tile);
    }
  }
  return { hot, cold };
}

/** One forced state: the tiles now showing it, and every tile of that hazard family. */
export interface ForcedHazard {
  readonly state: HazardState;
  readonly tiles: ReadonlyArray<MazeTile>;
  /**
   * Tiles that belong to the same family of hazard in any phase. The ring of
   * floor a telegraph is compared against excludes these, so a warning is never
   * scored against its own neighbour lighting up beside it.
   */
  readonly family: ReadonlyArray<MazeTile>;
}

const FIREWALK_VENTS = cellsInAct(MAZE_VENTS, 'firewalk');
const MENAGERIE_CELLS = cellsInAct(MAZE_SPOTLIGHT_CELLS, 'menagerie');

function firstOrThrow<T>(list: ReadonlyArray<T>, what: string): T {
  const first = list[0];
  if (first === undefined) throw new Error(`the tent has no ${what}`);
  return first;
}

/**
 * The vent and lantern cell each hazard shot is framed on. A middle cell of
 * each list, so the frame shows the corridor around it rather than an edge.
 */
const ANCHOR_VENT = firstOrThrow(
  FIREWALK_VENTS.slice(Math.floor(FIREWALK_VENTS.length / 2)),
  'fire-walk vents',
);
const ANCHOR_SPOT_CELL = firstOrThrow(
  MENAGERIE_CELLS.slice(Math.floor(MENAGERIE_CELLS.length / 2)),
  'menagerie lantern cells',
);

/**
 * Drives the tent into `state` and says which tiles show it. The tent must
 * already be in the act that state belongs to.
 */
export function forceHazard(tent: TentHarness, state: HazardState): ForcedHazard {
  switch (state) {
    case 'vent-telegraph':
    case 'vent-flame': {
      const phase = state === 'vent-flame' ? 'flame' : 'telegraph';
      const tiles = forceCellPhase(tent, FIREWALK_VENTS, ANCHOR_VENT, phase);
      return { state, tiles, family: FIREWALK_VENTS.map(tileOfCell) };
    }
    case 'spotlight-warm':
    case 'spotlight-beam': {
      const phase = state === 'spotlight-beam' ? 'flame' : 'telegraph';
      const tiles = forceCellPhase(tent, MENAGERIE_CELLS, ANCHOR_SPOT_CELL, phase);
      return { state, tiles, family: MENAGERIE_CELLS.map(tileOfCell) };
    }
    case 'held-row': {
      const tiles = ringBell(tent, HELD_ROW_BELL.id);
      return { state, tiles, family: MENAGERIE_CELLS.map(tileOfCell) };
    }
    case 'beam-hot':
    case 'beam-cold': {
      const { hot, cold } = beamTiles(tent);
      return { state, tiles: state === 'beam-hot' ? hot : cold, family: [...hot, ...cold] };
    }
  }
}

export const HAZARD_ACT: Record<HazardState, MazeSectionId> = {
  'vent-telegraph': 'firewalk',
  'vent-flame': 'firewalk',
  'spotlight-warm': 'menagerie',
  'spotlight-beam': 'menagerie',
  'held-row': 'menagerie',
  'beam-hot': 'mirrors',
  'beam-cold': 'mirrors',
};

/** The tile a hazard shot is centred on. */
export function hazardFocus(state: HazardState): MazeTile {
  switch (state) {
    case 'vent-telegraph':
    case 'vent-flame':
      return tileOfCell(ANCHOR_VENT);
    case 'spotlight-warm':
    case 'spotlight-beam':
      return tileOfCell(ANCHOR_SPOT_CELL);
    case 'held-row':
      return HELD_ROW_FOCUS;
    case 'beam-hot':
    case 'beam-cold':
      return MIRROR_HALL_FOCUS;
  }
}

/** The middle of the limelight row, where both beams and all three stars are in frame. */
const MIRROR_HALL_FOCUS: MazeTile = { x: 21, y: 26 };

// ── Drawing ──────────────────────────────────────────────────────────────────

/** A camera window over the tent, in world pixels at one pixel per game pixel. */
export interface TentView {
  readonly camX: number;
  readonly camY: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Roughly a 1280×704 game window: what a player on a laptop sees of the tent at once. */
export const VIEW_TILES_WIDE = 40;
export const VIEW_TILES_HIGH = 22;

const TILE_CENTRE = 0.5;
/** What shows past the edge of the tent's grid, as the scene clears to it. */
const OFF_MAP_FILL = '#000';

export function viewCentredOn(tile: MazeTile): TentView {
  const widthPx = VIEW_TILES_WIDE * TILE_SIZE;
  const heightPx = VIEW_TILES_HIGH * TILE_SIZE;
  return {
    camX: Math.round((tile.x + TILE_CENTRE) * TILE_SIZE - widthPx / 2),
    camY: Math.round((tile.y + TILE_CENTRE) * TILE_SIZE - heightPx / 2),
    widthPx,
    heightPx,
  };
}

/** The whole tent in one view, for per-tile measurements across every act. */
export function wholeTentView(map: GameMap): TentView {
  const widthTiles = map.structure[0]?.length ?? 0;
  return {
    camX: 0,
    camY: 0,
    widthPx: widthTiles * TILE_SIZE,
    heightPx: map.structure.length * TILE_SIZE,
  };
}

type LayerHook = (ctx: CanvasRenderingContext2D, view: TentView) => void;

/**
 * Where extra passes join the frame.
 *
 * `overGround` runs after the floor bake, the maze's ground props, the stage
 * lights and the warnings over them, and before anyone stands on them;
 * `overFigures` after the Y-sorted pass and before the maze's effects;
 * `overEffects` last of all.
 */
export interface TentLayerHooks {
  /** After the map's chunk bake and before anything the maze draws. */
  readonly overMap?: LayerHook;
  readonly overGround?: LayerHook;
  readonly overFigures?: LayerHook;
  readonly overEffects?: LayerHook;
}

/**
 * How the stage lights join the frame.
 *
 * `lit` is the game's own frame: the maze's `renderWorld`, exactly as the
 * scene calls it, so a reorder inside it shows up here. `fullBright` leaves the
 * lights out, the reference a lit frame is compared against. `darkTelegraph`
 * is the fault the lighting gate must catch: the lights laid over everything,
 * warnings and flames included.
 */
export type TentLighting = 'lit' | 'fullBright' | 'darkTelegraph';

export interface TentFrameOptions {
  readonly scale: number;
  /** Carl and Donut, where the harness last placed them. */
  readonly withParty: boolean;
  /**
   * The maze's own mobs — targets, bells, mirrors, Grimaldi. On by default; a
   * floor measurement turns them off so a body standing on a tile is not
   * scored as that tile's floor.
   */
  readonly withMobs?: boolean;
  /**
   * Leaves out every layer the maze draws a hazard in — its warnings and its
   * effects — and keeps the rest of the frame, lights included, where they
   * would be. The difference between a frame and its bare stage is exactly the
   * hazard's own pixels as the player receives them.
   */
  readonly bareStage?: boolean;
  readonly hooks?: TentLayerHooks;
  /** Defaults to `lit`. */
  readonly lighting?: TentLighting;
  /**
   * Handed the frame's context before anything is drawn, so a gate can wrap
   * its calls (counters, the strict-canvas watch) in place.
   */
  readonly wrapContext?: (ctx: CanvasRenderingContext2D) => void;
}

export function renderTentFrame(
  tent: TentHarness,
  view: TentView,
  options: TentFrameOptions,
): Canvas {
  setViewportSize(view.widthPx, view.heightPx);
  const canvas = createCanvas(view.widthPx * options.scale, view.heightPx * options.scale);
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(options.scale, options.scale);
  const ctx = asGameContext(nodeCtx);
  options.wrapContext?.(ctx);
  const { camX, camY, widthPx, heightPx } = view;

  ctx.fillStyle = OFF_MAP_FILL;
  ctx.fillRect(0, 0, widthPx, heightPx);
  const lighting = options.lighting ?? 'lit';
  tent.map.renderCanvas(ctx, camX, camY, widthPx, heightPx);
  options.hooks?.overMap?.(ctx, view);
  const bareStage = options.bareStage === true;
  if (lighting === 'lit' && !bareStage) {
    tent.maze.renderWorld(ctx, camX, camY);
  } else {
    // Only a frame the game never draws orders the maze's layers by hand.
    tent.maze.renderProps(ctx, camX, camY);
    if (lighting === 'lit') tent.maze.renderLighting(ctx, camX, camY);
    if (!bareStage) tent.maze.renderTelegraphs(ctx, camX, camY);
  }
  options.hooks?.overGround?.(ctx, view);

  const sorted: Array<{ sortY: number; draw: () => void }> = [];
  for (const { tx, ty, sortYAnchorPx } of tent.map.getVisibleDecorationTiles(
    camX,
    camY,
    widthPx,
    heightPx,
  )) {
    sorted.push({
      sortY: ty * TILE_SIZE + sortYAnchorPx,
      draw: () => tent.map.drawDecorationAt(ctx, tx, ty, camX, camY),
    });
  }
  const mobs = options.withMobs === false ? [] : tent.spawned;
  const figures: Array<{ y: number; render: () => void }> = mobs
    .filter((mob) => mob.belongsInMobGrid)
    .map((mob) => ({ y: mob.y, render: () => mob.render(ctx, camX, camY, TILE_SIZE) }));
  if (options.withParty) {
    for (const crawler of [tent.human, tent.cat]) {
      figures.push({ y: crawler.y, render: () => crawler.render(ctx, camX, camY, TILE_SIZE) });
    }
  }
  for (const figure of figures) {
    // The scene sorts every figure by its foot, one tile below its top-left.
    sorted.push({ sortY: figure.y + TILE_SIZE, draw: figure.render });
  }
  sorted.sort((a, b) => a.sortY - b.sortY);
  for (const entry of sorted) entry.draw();
  options.hooks?.overFigures?.(ctx, view);

  if (!bareStage) tent.maze.renderEffects(ctx, camX, camY);
  if (lighting === 'darkTelegraph') tent.maze.renderLighting(ctx, camX, camY);
  options.hooks?.overEffects?.(ctx, view);
  return canvas;
}

/**
 * The nearest walkable tiles to `from` that no hazard family claims, nearest
 * first, so a crawler stood there for scale is beside the hazard rather than
 * standing in it and hiding it.
 */
export function safeTilesNear(
  map: GameMap,
  from: MazeTile,
  count: number,
  avoid: ReadonlyArray<MazeTile>,
): MazeTile[] {
  const avoided = new Set(avoid.map((tile) => `${tile.x},${tile.y}`));
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: MazeTile[] = [from];
  const found: MazeTile[] = [];
  const mapWidth = map.structure[0]?.length ?? 0;
  for (const tile of queue) {
    if (found.length >= count) break;
    if (map.isWalkable(tile.x, tile.y) && !avoided.has(`${tile.x},${tile.y}`)) found.push(tile);
    for (const [dx, dy] of NEIGHBOUR_STEPS) {
      const next = { x: tile.x + dx, y: tile.y + dy };
      const key = `${next.x},${next.y}`;
      const outOfBounds =
        next.x < 0 || next.y < 0 || next.y >= map.structure.length || next.x >= mapWidth;
      if (seen.has(key) || outOfBounds) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return found;
}

const NEIGHBOUR_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
