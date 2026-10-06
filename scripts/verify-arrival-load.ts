#!/usr/bin/env tsx
/**
 * Every environment arrives behind its loading screen, and is in its steady
 * state on the very first frame of play.
 *
 * Runs the game's real `SceneManager` and the real scene for each environment —
 * the tutorial, floors 1 and 2, floor 3's town and a shop interior — headless
 * behind the browser shim, ticking the real frame loop by hand, one environment
 * per child process so no cache warmed by one can flatter the next. For each:
 *
 *  - the loading screen is up as the scene is entered, and closes;
 *  - for the first frames of play afterwards, no figure cell is baked on the
 *    render path, painted directly or drawn as a stand-in, no ground chunk is
 *    baked, no environment step is painted or still owed, and no sprite the
 *    scene drew was still missing;
 *  - the first frame of play costs no more than twice the steady median;
 *  - nothing that announces the arrival — the floor's sting, a room's music —
 *    starts while the screen is still up, and a floor's sting does play.
 *
 * Node's canvas costs are not a browser's, so timings are only compared with
 * themselves.
 *
 *   npm run verify:arrival-load
 *   npx tsx scripts/verify-arrival-load.ts --env=level1          # one environment
 *   npx tsx scripts/verify-arrival-load.ts --fault=skip-loader   # must fail
 */

import { spawnSync } from 'node:child_process';

const ENVIRONMENTS = ['tutorial', 'level1', 'level2', 'level3', 'interior'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

function isEnvironment(value: string): value is Environment {
  return ENVIRONMENTS.some((environment) => environment === value);
}

const envArg = process.argv.find((arg) => arg.startsWith('--env='))?.slice('--env='.length);
const faultArg = process.argv.find((arg) => arg.startsWith('--fault='));

if (envArg === undefined) {
  let failed = 0;
  for (const environment of ENVIRONMENTS) {
    const child = spawnSync(
      process.execPath,
      [
        ...process.execArgv,
        'scripts/verify-arrival-load.ts',
        `--env=${environment}`,
        ...(faultArg === undefined ? [] : [faultArg]),
      ],
      { stdio: 'inherit' },
    );
    if (child.status !== 0) failed++;
  }
  console.log(
    failed === 0
      ? 'PASS verify:arrival-load'
      : `FAIL verify:arrival-load — ${failed} environment(s) failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
if (!isEnvironment(envArg)) throw new Error(`unknown --env=${envArg}`);
const environment: Environment = envArg;
const skipLoader = faultArg === '--fault=skip-loader';

const { installBrowserShim } = await import('./browserShim.js');
const { MAX_ARRIVAL_FRAMES } = await import('./settleArrival.js');

/** A Retina display, as the game is played on; see `verify-town-soak.ts`. */
const RETINA_DEVICE_PIXEL_RATIO = 2;
const shim = installBrowserShim({
  width: 1280,
  height: 720,
  devicePixelRatio: RETINA_DEVICE_PIXEL_RATIO,
});

/**
 * Just enough Web Audio for a real `AudioManager`, already running as a
 * browser's is after the first gesture, so the scene starts its sounds when it
 * means to rather than waiting on an unlock. Nothing loads, so nothing sounds.
 */
function installRunningSilentAudio(): void {
  const ignore = (): void => undefined;
  const silentParam = {
    value: 0,
    setValueAtTime: ignore,
    linearRampToValueAtTime: ignore,
    exponentialRampToValueAtTime: ignore,
    setTargetAtTime: ignore,
    cancelScheduledValues: ignore,
  };
  const silentNode = { connect: ignore, disconnect: ignore, gain: silentParam, pan: silentParam };
  class RunningSilentAudioContext {
    readonly state = 'running';
    readonly currentTime = 0;
    readonly destination = silentNode;
    addEventListener = ignore;
    removeEventListener = ignore;
    createGain() {
      return silentNode;
    }
    createStereoPanner() {
      return silentNode;
    }
    createMediaElementSource() {
      return silentNode;
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
  }
  class SilentAudio {
    src = '';
    loop = false;
    volume = 1;
    currentTime = 0;
    paused = true;
    pause = ignore;
    addEventListener = ignore;
    removeEventListener = ignore;
    play(): Promise<void> {
      return Promise.resolve();
    }
  }
  Reflect.set(globalThis, 'AudioContext', RunningSilentAudioContext);
  Reflect.set(globalThis, 'Audio', SilentAudio);
}
installRunningSilentAudio();
/** Every sound fails to fetch headless, by design; one warning per sound would bury the report. */
const SILENT_AUDIO_WARNING = '[AudioManager] Failed to load';
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith(SILENT_AUDIO_WARNING)) return;
  warn(...args);
};

const WORLD_SEED = 1;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites, getSpriteMissCounts } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { AudioManager } = await import('../src/audio/AudioManager.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { getLevelDef } = await import('../src/levels/index.js');
const { level3 } = await import('../src/levels/level3.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { TutorialController } = await import('../src/systems/TutorialController.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { snapPlayer } = await import('../src/core/PlayerSnapshot.js');
const { createMarketStock } = await import('../src/systems/market/MarketStock.js');
const { environmentPaintDepth, environmentPaintedStepCount } =
  await import('../src/map/environmentArtCache.js');
const { tileChunkBakeCount } = await import('../src/map/TileRenderer.js');
const { setFigureCacheStatsRecording, getFigureCacheStats } =
  await import('../src/sprites/figure/figureCacheStats.js');

const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const FRAME_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
/** Frames of play measured after the loading screen closes. */
const PLAY_FRAMES = 120;
/**
 * How much slower than the steady state the first frame of play may be. Loose,
 * because it is a timing: it exists to catch a screenful of baking left for
 * frame 0, which is several times the steady cost, not a few cold branches.
 */
const MAX_FIRST_FRAME_RATIO = 2;
const MS_PLACES = 1;

await loadSprites('src/images/');
const input = new InputManager();
const sceneManager = new SceneManager();

/**
 * What the scene asked the audio to start, and whether its loading screen was
 * up at the time: the floor's sting and a room's music announce what the
 * player is about to see, so neither may start under the screen.
 */
const ANNOUNCING_SOUND = 'level_begins';
const audio = new AudioManager();
const announcements: Array<{ readonly what: string; readonly underScreen: boolean }> = [];
let screenUp = (): boolean => false;
const playWhenReady = audio.playWhenReady.bind(audio);
audio.playWhenReady = (id, opts) => {
  if (id === ANNOUNCING_SOUND) announcements.push({ what: id, underScreen: screenUp() });
  playWhenReady(id, opts);
};
const playMusic = audio.playMusic.bind(audio);
audio.playMusic = (id, opts) => {
  announcements.push({ what: `music ${id}`, underScreen: screenUp() });
  playMusic(id, opts);
};
const playMusicPlaylist = audio.playMusicPlaylist.bind(audio);
audio.playMusicPlaylist = (ids, opts) => {
  announcements.push({ what: `music ${ids.join(', ')}`, underScreen: screenUp() });
  playMusicPlaylist(ids, opts);
};

type Scene = InstanceType<typeof DungeonScene> | InstanceType<typeof BuildingInteriorScene>;

function buildScene(): Scene {
  switch (environment) {
    case 'tutorial':
      return new DungeonScene(getLevelDef('tutorial'), input, sceneManager, {
        tutorialController: TutorialController.createForTutorial(),
        audio,
      });
    case 'level1':
    case 'level2':
    case 'level3':
      return new DungeonScene(getLevelDef(environment), input, sceneManager, {
        worldSeed: WORLD_SEED,
        audio,
      });
    case 'interior': {
      const town = new GameMap({
        mapSize: level3.mapSize,
        tileHeight: TILE_SIZE,
        mapType: 'overworld',
        worldSeed: WORLD_SEED,
      });
      const store = town.buildingEntries.find((entry) => entry.type === 'store');
      if (store === undefined) throw new Error('the town has no General Store');
      const human = new HumanPlayer(0, 0, TILE_SIZE);
      const cat = new CatPlayer(1, 0, TILE_SIZE);
      human.isActive = true;
      return new BuildingInteriorScene(
        store,
        snapPlayer(human),
        snapPlayer(cat),
        level3.xpDiminishingTiers,
        level3.arrivalLoadingScreen,
        input,
        sceneManager,
        () => undefined,
        createMarketStock(),
        undefined,
        undefined,
        audio,
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
        town.artSeed,
      );
    }
  }
}

let clockMs = 0;
const thrown: string[] = [];
let renderMs = 0;

/** One frame of the real loop, after letting promise callbacks run as a browser does. */
async function runFrame(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  clockMs += FRAME_MS;
  try {
    shim.runAnimationFrame(clockMs);
  } catch (error) {
    thrown.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
}

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

const scene = buildScene();
screenUp = () => scene.arrivalLoadingOpen;
/**
 * The loading screen's own fade over the first frames of play is not the
 * world's cost, and a fade drawn on node's canvas costs more than the world
 * does; it is taken out of the frame time so the comparison is the world's.
 * The fade, and the fault that skips the screen, reach the loader itself,
 * which only the scene holds.
 */
const loader = scene['arrivalLoading'];
let fadeMs = 0;
const renderFadeOut = loader.renderFadeOut.bind(loader);
loader.renderFadeOut = (ctx) => {
  const startedAt = performance.now();
  renderFadeOut(ctx);
  fadeMs = performance.now() - startedAt;
};
const render = scene.render.bind(scene);
scene.render = (ctx) => {
  const startedAt = performance.now();
  fadeMs = 0;
  try {
    render(ctx);
  } finally {
    renderMs = performance.now() - startedAt - fadeMs;
  }
};
sceneManager.replace(scene);

check(scene.arrivalLoadingOpen, 'no loading screen went up on arrival');
if (skipLoader) loader.dispose();

let arrivalFrames = 0;
for (; arrivalFrames < MAX_ARRIVAL_FRAMES && scene.arrivalLoadingOpen; arrivalFrames++) {
  await runFrame();
}
check(
  !scene.arrivalLoadingOpen,
  `the loading screen was still up after ${MAX_ARRIVAL_FRAMES} frames`,
);

const missesBefore = new Map(getSpriteMissCounts());
setFigureCacheStatsRecording(true);

interface PlayFrame {
  readonly lazyBakes: number;
  readonly approxDraws: number;
  readonly directDraws: number;
  readonly chunkBakes: number;
  readonly environmentSteps: number;
  readonly renderMs: number;
}

const played: PlayFrame[] = [];
for (let frame = 0; frame < PLAY_FRAMES; frame++) {
  const chunksBefore = tileChunkBakeCount();
  const stepsBefore = environmentPaintedStepCount();
  await runFrame();
  const stats = getFigureCacheStats();
  played.push({
    lazyBakes: stats.bakes,
    approxDraws: stats.approxDraws,
    directDraws: stats.directDraws,
    chunkBakes: tileChunkBakeCount() - chunksBefore,
    environmentSteps: environmentPaintedStepCount() - stepsBefore,
    renderMs,
  });
}

const sum = (pick: (frame: PlayFrame) => number): number =>
  played.reduce((total, frame) => total + pick(frame), 0);
const firstFrame = played[0];
check(
  sum((f) => f.lazyBakes) === 0,
  `${sum((f) => f.lazyBakes)} figure cell(s) baked on the render path (frame 0: ${firstFrame.lazyBakes})`,
);
check(
  sum((f) => f.approxDraws) === 0,
  `${sum((f) => f.approxDraws)} figure draw(s) served by a stand-in pose`,
);
check(sum((f) => f.directDraws) === 0, `${sum((f) => f.directDraws)} figure(s) painted directly`);
check(
  sum((f) => f.chunkBakes) === 0,
  `${sum((f) => f.chunkBakes)} ground chunk(s) baked during play (frame 0: ${firstFrame.chunkBakes})`,
);
check(
  sum((f) => f.environmentSteps) === 0 && environmentPaintDepth() === 0,
  `${sum((f) => f.environmentSteps)} environment step(s) painted during play, ${environmentPaintDepth()} still owed`,
);
const newMisses = [...getSpriteMissCounts()].filter(
  ([key, count]) => count > (missesBefore.get(key) ?? 0),
);
check(
  newMisses.length === 0,
  `sprite(s) drawn while still missing: ${newMisses.map(([key]) => key).join(', ')}`,
);
const steadyRenderMs = played
  .slice(1)
  .map((f) => f.renderMs)
  .sort((a, b) => a - b);
const medianSteadyRenderMs = steadyRenderMs[Math.floor(steadyRenderMs.length / 2)] ?? 0;
check(
  firstFrame.renderMs <= medianSteadyRenderMs * MAX_FIRST_FRAME_RATIO,
  `frame 0 took ${firstFrame.renderMs.toFixed(MS_PLACES)} ms against a steady median of ` +
    `${medianSteadyRenderMs.toFixed(MS_PLACES)} ms`,
);
const heardUnderScreen = announcements.filter((announcement) => announcement.underScreen);
check(
  heardUnderScreen.length === 0,
  `started under the loading screen: ${heardUnderScreen.map((a) => a.what).join(', ')}`,
);
const floorAnnouncesItself =
  environment === 'level1' || environment === 'level2' || environment === 'level3';
check(
  !floorAnnouncesItself || announcements.some((a) => a.what === ANNOUNCING_SOUND),
  `the floor's ${ANNOUNCING_SOUND} sting never played once the screen closed`,
);
check(thrown.length === 0, `${thrown.length} frame(s) threw:\n${thrown.slice(0, 1).join('\n')}`);

console.log(
  `${environment}: loader ${arrivalFrames} frames; first ${PLAY_FRAMES} frames of play: ` +
    `${sum((f) => f.lazyBakes)} lazy bakes, ${sum((f) => f.approxDraws)} stand-ins, ` +
    `${sum((f) => f.directDraws)} direct paints, ${sum((f) => f.chunkBakes)} chunk bakes, ` +
    `${sum((f) => f.environmentSteps)} env steps; frame 0 ${firstFrame.renderMs.toFixed(MS_PLACES)} ms, ` +
    `steady median ${medianSteadyRenderMs.toFixed(MS_PLACES)} ms`,
);
if (failures.length > 0) {
  console.error(`FAIL ${environment}${skipLoader ? ' (fault=skip-loader)' : ''}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS ${environment}`);
process.exit(0);
