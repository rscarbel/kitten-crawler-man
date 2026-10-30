/**
 * The sewer stood up headless: the real `BuildingInteriorScene` built behind
 * the storm drain, past its arrival screen, with a handle on the section the
 * party stands in. Used by `npm run render:sewer`, so it looks at the sewer
 * the game builds.
 *
 * Import it dynamically after `installBrowserShim`, like every headless scene
 * harness: game modules read the browser at import.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { SceneManager } from '../src/core/Scene.js';
import { InputManager } from '../src/core/input/InputManager.js';
import { snapPlayer } from '../src/core/save/PlayerSnapshot.js';
import { createTownMemory } from '../src/core/state/TownMemory.js';
import { createStarlightTentProgress } from '../src/core/state/StarlightTentProgress.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { level3 } from '../src/levels/level3.js';
import { STORM_DRAIN_ID } from '../src/map/buildingIds.js';
import type { BuildingEntry } from '../src/map/buildingEntry.js';
import type { SewerWorkId } from '../src/map/sewer/sewerLayouts.js';
import type { SewerTile } from '../src/map/sewer/sewerPlan.js';
import { STORM_DRAIN_GRATE_WIDTH_TILES } from '../src/map/tiles/stormDrainGrateTile.js';
import { BuildingInteriorScene } from '../src/scenes/BuildingInteriorScene.js';
import { createShopStock } from '../src/economy/shopStock.js';
import { settleArrival } from './settleArrival.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import { beginEnvironmentArtFrame } from '../src/map/environmentArtCache.js';
import { closeAboveDarkness } from '../src/systems/lighting/aboveDarkness.js';

export interface SewerHarnessOptions {
  /** Valves already turned and fights already won when the party climbs down. */
  readonly settled?: ReadonlyArray<SewerWorkId>;
  readonly guided?: boolean;
}

export interface SewerHarness {
  readonly scene: BuildingInteriorScene;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  step(frames: number): void;
  render(): void;
  placeAt(body: { x: number; y: number }, tile: SewerTile): void;
}

const STORM_DRAIN_ENTRY: BuildingEntry = {
  doorTile: { x: 0, y: 0 },
  id: STORM_DRAIN_ID,
  type: 'house',
  doorway: { x0: 0, width: STORM_DRAIN_GRATE_WIDTH_TILES },
};

/** Climbs down the storm drain and waits out its arrival screen. Every call is a fresh sewer. */
export async function enterSewer(
  ctx: CanvasRenderingContext2D,
  options: SewerHarnessOptions = {},
): Promise<SewerHarness> {
  const memory = createTownMemory();
  for (const work of options.settled ?? []) memory.settledSewerWorks.add(work);
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  const scene = new BuildingInteriorScene(
    { ...STORM_DRAIN_ENTRY, doorTile: { ...STORM_DRAIN_ENTRY.doorTile } },
    snapPlayer(human),
    snapPlayer(cat),
    level3.xpDiminishingTiers,
    level3.arrivalLoadingScreen,
    new InputManager(),
    new SceneManager(),
    () => undefined,
    createShopStock(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      starlightTent: createStarlightTentProgress(),
      worldSeed: 0,
      sewerGuided: options.guided ?? true,
    },
    undefined,
    memory,
  );
  if (!(await settleArrival(scene, ctx))) throw new Error('the sewer never finished arriving');
  return {
    scene,
    human: scene.pm.human,
    cat: scene.pm.cat,
    step: (frames) => {
      for (let frame = 0; frame < frames; frame++) scene.update();
    },
    render: () => {
      beginFigureFrame();
      beginEnvironmentArtFrame();
      closeAboveDarkness();
      scene.render(ctx);
    },
    placeAt: (body, tile) => {
      body.x = tile.x * TILE_SIZE;
      body.y = tile.y * TILE_SIZE;
    },
  };
}
