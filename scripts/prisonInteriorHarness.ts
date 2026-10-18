/**
 * The Goblin High Security Prison stood up headless: the real
 * `BuildingInteriorScene` built for the `goblin_prison` variant, past its
 * arrival screen and its first-visit explainer, with a handle on the
 * `GoblinPrisonSystem` it runs. Shared by `npm run verify:prison-capture` and
 * `npm run render:goblin-prison`, so both look at the prison the game builds.
 *
 * Import it dynamically after `installBrowserShim`, like every headless scene
 * harness: game modules read the browser at import.
 */

import type { Difficulty } from '../src/core/difficultyProfiles.js';
import type { PrisonLayout } from '../src/map/goblinPrisonLayouts.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { SceneManager } from '../src/core/Scene.js';
import { InputManager } from '../src/core/InputManager.js';
import { snapPlayer } from '../src/core/PlayerSnapshot.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { level2 } from '../src/levels/level2.js';
import {
  pickPrisonLayout,
  planGoblinPrison,
  type PrisonTile,
} from '../src/map/goblinPrisonPlan.js';
import { PRISON_LAYOUTS } from '../src/map/goblinPrisonLayouts.js';
import { BuildingInteriorScene } from '../src/scenes/BuildingInteriorScene.js';
import type { InteriorFloorContext } from '../src/scenes/interiorFloorContext.js';
import { createShopStock } from '../src/economy/shopStock.js';
import { detachedPrisonVisit } from '../src/systems/stealthKeySnatch/prisonVisit.js';
import type { GoblinPrisonSystem } from '../src/systems/stealthKeySnatch/GoblinPrisonSystem.js';
import type { SystemContext } from '../src/systems/GameSystem.js';
import { settleArrival } from './settleArrival.js';
import { beginFigureFrame } from '../src/sprites/figure/figureFrameCache.js';
import { beginEnvironmentArtFrame } from '../src/map/environmentArtCache.js';
import { closeAboveDarkness } from '../src/systems/lighting/aboveDarkness.js';

/** How far any search for a world seed that deals a layout looks. */
const SEED_SEARCH_LIMIT = 10_000;

/** A world seed whose prison is `layout`. */
export function worldSeedFor(layout: PrisonLayout): number {
  for (let seed = 0; seed < SEED_SEARCH_LIMIT; seed++) {
    if (pickPrisonLayout(seed).id === layout.id) return seed;
  }
  throw new Error(`no world seed under ${SEED_SEARCH_LIMIT} deals the ${layout.id} prison`);
}

export interface PrisonHarnessOptions {
  readonly layoutId?: string;
  readonly difficulty?: Difficulty;
}

/** A prison the party is standing in, ready to be driven a frame at a time. */
export interface PrisonHarness {
  readonly scene: BuildingInteriorScene;
  readonly prison: GoblinPrisonSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly ctx: CanvasRenderingContext2D;
  /** Runs the scene's own update `frames` times. */
  step(frames: number): void;
  /** Draws one frame of the scene, opening the frame the way the game loop does. */
  render(): void;
  /** The frame context the prison's own update and Space handler read. */
  systemContext(): SystemContext;
  /** Stands a body on a tile. */
  placeAt(body: { x: number; y: number }, tile: PrisonTile): void;
}

const PRISON_ENTRY = {
  doorTile: { x: 0, y: 0 },
  name: 'Goblin High Security Prison',
  type: 'prison',
  doorwayX0: 0,
  doorwayWidth: 2,
} as const;

/**
 * Builds the prison, waits out its arrival screen and marks its explainer
 * read. Every call is a fresh prison.
 */
export async function enterPrison(
  ctx: CanvasRenderingContext2D,
  options: PrisonHarnessOptions = {},
): Promise<PrisonHarness> {
  const layout =
    PRISON_LAYOUTS.find((candidate) => candidate.id === options.layoutId) ?? PRISON_LAYOUTS[0];
  const difficulty = options.difficulty ?? 'normal';
  const plan = planGoblinPrison(worldSeedFor(layout), difficulty);
  const visit = detachedPrisonVisit();
  visit.markExplainerSeen();
  const floor: InteriorFloorContext = {
    floorNumber: level2.floorNumber,
    groundSheets: ['ground_floor2'],
    spriteGroups: level2.spriteGroups,
    sightRadiusPx: Number.POSITIVE_INFINITY,
    ownsMusic: false,
    heldLevelTimerFrames: null,
    variant: { kind: 'goblin_prison', plan },
    stealthKeySnatch: visit,
  };
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.isActive = true;
  const scene = new BuildingInteriorScene(
    { ...PRISON_ENTRY, doorTile: { ...PRISON_ENTRY.doorTile } },
    snapPlayer(human),
    snapPlayer(cat),
    level2.xpDiminishingTiers,
    level2.arrivalLoadingScreen,
    new InputManager(),
    new SceneManager(),
    () => undefined,
    createShopStock(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    floor,
  );
  if (!(await settleArrival(scene, ctx))) throw new Error('the prison never finished arriving');
  const prison = scene['prison'];
  if (prison === null) throw new Error('the prison scene built no GoblinPrisonSystem');
  const sceneHuman = scene.pm.human;
  const sceneCat = scene.pm.cat;
  return {
    scene,
    prison,
    human: sceneHuman,
    cat: sceneCat,
    ctx,
    step: (frames) => {
      for (let frame = 0; frame < frames; frame++) scene.update();
    },
    render: () => {
      beginFigureFrame();
      beginEnvironmentArtFrame();
      closeAboveDarkness();
      scene.render(ctx);
    },
    systemContext: () => scene['buildSystemContext'](),
    placeAt: (body, tile) => {
      body.x = tile.x * TILE_SIZE;
      body.y = tile.y * TILE_SIZE;
    },
  };
}
