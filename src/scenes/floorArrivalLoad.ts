/**
 * The up-front work a floor's arrival puts behind a loading screen.
 *
 * Every cache the renderer leans on fills lazily and is paced to a few
 * milliseconds a frame so that play never stalls on it — which, on a floor as
 * heavy as the town, means the first seconds of play are spent watching it fill:
 * buildings arriving one at a time, a crowd drawn as stand-ins while its poses
 * bake, a screenful of ground chunks baked on the first frame. Behind a loading
 * screen none of that pacing is needed, so these tasks drain the same queues as
 * fast as a frame's budget allows and hand play a floor with nothing left owed.
 *
 * The tasks are ordinary {@link LoadTask}s and name no particular floor: every
 * gameplay scene runs them through its `ArrivalLoader`, so a new environment
 * that queues its art and figures the usual way is covered without a line here.
 */
import { steppedWork, promiseWork, type LoadTask } from '../core/LoadRunner';
import type { GameMap } from '../map/GameMap';
import {
  environmentPaintDepth,
  environmentPaintedStepCount,
  paintEnvironmentArtFor,
} from '../map/environmentArtCache';
import { buildingSheetsNotYetQueued } from '../sprites/buildinggen/runtimeBuildingSheets';
import {
  bakeFigurePrewarmFor,
  figurePrewarmDepth,
  figurePrewarmOwed,
} from '../sprites/figure/figureFrameCache';

/**
 * Steps one facade is expected to take once its chain queues it: its paint
 * stages, the compose step and its life frames. Only used to size the bar for
 * facades the chain has not planned yet, so a wrong guess moves the bar
 * unevenly rather than wrongly — the runner never lets it go backwards.
 */
const ESTIMATED_STEPS_PER_FACADE = 40;

/**
 * What a figure cell nobody has baked yet is guessed to cost, for deciding
 * whether a wait is worth a loading screen. A townsperson's cell measures
 * around four milliseconds headless and more in a browser.
 */
const UNMEASURED_FIGURE_CELL_MS = 5;

/**
 * Work below this is left to the caches' own paced queues rather than put
 * behind a loading screen: a few frames of stand-ins is a better trade than a
 * screen that flashes up for a moment on every door out of a shop.
 */
const LOADING_SCREEN_WORTH_MS = 250;

/**
 * Relative shares of the bar, by how long each task takes: the facades are
 * most of a town's arrival, the crowd most of the rest, and the ground chunks
 * and the decorations on them a fraction of a second each.
 */
const ENVIRONMENT_WEIGHT = 5;
const FIGURE_WEIGHT = 4;
const SPRITE_GROUP_WEIGHT = 1;
const GROUND_CHUNK_WEIGHT = 1;
const DECORATION_WEIGHT = 1;

const COMPLETE = 1;

export interface FloorArrivalLoadDeps {
  readonly gameMap: GameMap;
  /** Top-left of the camera the first frame of play will draw from, in world px. */
  readonly camera: () => { readonly x: number; readonly y: number };
  /** The viewport the first frame of play will draw, in CSS px. */
  readonly viewport: () => { readonly width: number; readonly height: number };
  /** The floor's fetched sprite groups, already loading. */
  readonly spriteGroupsReady: Promise<unknown>;
}

function environmentOwedSteps(): number {
  return environmentPaintDepth() + buildingSheetsNotYetQueued() * ESTIMATED_STEPS_PER_FACADE;
}

/**
 * Whether the work a floor's arrival still owes is enough to be worth a
 * loading screen. True on a first arrival, where the whole floor's art is
 * queued; false on a walk out of a building unless some art is still owed.
 *
 * @param returningFromBuilding The scene is being rebuilt around the map the
 *   party just stepped out onto. Its crowd is the same people (seeded from the
 *   world), still pinned and warm, and the party's rows were drawn a moment
 *   ago; what its figure queue owes is the rows its freshly respawned wild mobs
 *   warm on speculation, which the town idles out of the cache long before the
 *   next exit asks for them again. That is work for the paced queue, not a
 *   loading screen at every door.
 */
export function floorArrivalOwesWork(returningFromBuilding: boolean): boolean {
  if (environmentOwedSteps() > 0) return true;
  if (returningFromBuilding) return false;
  return figurePrewarmOwed(UNMEASURED_FIGURE_CELL_MS).ms >= LOADING_SCREEN_WORTH_MS;
}

/**
 * The arrival tasks, in the order they must run: the painted art first,
 * because each sheet that lands invalidates the ground chunks; the crowd; the
 * fetched sheets, which invalidate the chunks too when they resolve; and the
 * chunks the first frame will show, last, once nothing can invalidate them.
 */
export function floorArrivalLoadTasks(deps: FloorArrivalLoadDeps): LoadTask[] {
  const paintedAtStart = environmentPaintedStepCount();
  const environmentTask: LoadTask = {
    label: 'Painting the scenery',
    weight: ENVIRONMENT_WEIGHT,
    work: steppedWork((budgetMs, mustProgress) => {
      paintEnvironmentArtFor(budgetMs, mustProgress);
      const owed = environmentOwedSteps();
      if (owed === 0) return COMPLETE;
      const painted = environmentPaintedStepCount() - paintedAtStart;
      return painted / (painted + owed);
    }),
  };

  let mostCellsOwed = 0;
  const figureTask: LoadTask = {
    label: 'Waking the inhabitants',
    weight: FIGURE_WEIGHT,
    work: steppedWork((budgetMs, mustProgress) => {
      bakeFigurePrewarmFor(budgetMs, mustProgress);
      if (figurePrewarmDepth() === 0) return COMPLETE;
      const owedCells = figurePrewarmOwed(UNMEASURED_FIGURE_CELL_MS).cells;
      mostCellsOwed = Math.max(mostCellsOwed, owedCells);
      return mostCellsOwed === 0 ? COMPLETE : 1 - owedCells / mostCellsOwed;
    }),
  };

  const spriteTask: LoadTask = {
    label: 'Unpacking sprites',
    weight: SPRITE_GROUP_WEIGHT,
    work: promiseWork(deps.spriteGroupsReady),
  };

  // Last, once nothing can invalidate what they bake: the ground chunks and
  // the decorations standing on them, for the view the first frame of play draws.
  const groundTask: LoadTask = {
    label: 'Laying the ground',
    weight: GROUND_CHUNK_WEIGHT,
    work: steppedWork((budgetMs, mustProgress) => {
      const { x, y } = deps.camera();
      const { width, height } = deps.viewport();
      return deps.gameMap.bakeTileArtForView(x, y, width, height, budgetMs, mustProgress);
    }),
  };
  const decorationTask: LoadTask = {
    label: 'Placing the props',
    weight: DECORATION_WEIGHT,
    work: steppedWork((budgetMs, mustProgress) => {
      const { x, y } = deps.camera();
      const { width, height } = deps.viewport();
      return deps.gameMap.bakeDecorationArtForView(x, y, width, height, budgetMs, mustProgress);
    }),
  };

  return [environmentTask, figureTask, spriteTask, groundTask, decorationTask];
}
