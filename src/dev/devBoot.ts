import type { SceneManager } from '../core/Scene';
import { useDevPlayerIdentity } from './devPlayerIdentity';
import type { InputManager } from '../core/input/InputManager';
import { DungeonScene, type DungeonSceneOptions } from '../scenes/DungeonScene';
import { PaintBenchScene } from '../scenes/PaintBenchScene';
import { PersonPreviewScene } from '../scenes/PersonPreviewScene';
import { TilePreviewScene } from '../scenes/TilePreviewScene';
import { BopcaPreviewScene } from '../scenes/BopcaPreviewScene';
import { HumanPreviewScene } from '../scenes/HumanPreviewScene';
import { CatPreviewScene } from '../scenes/CatPreviewScene';
import { GoblinPreviewScene } from '../scenes/GoblinPreviewScene';
import { RatPreviewScene } from '../scenes/RatPreviewScene';
import { LlamaPreviewScene } from '../scenes/LlamaPreviewScene';
import { CowPreviewScene } from '../scenes/CowPreviewScene';
import { RockGolemPreviewScene } from '../scenes/RockGolemPreviewScene';
import { SkeletonPreviewScene } from '../scenes/SkeletonPreviewScene';
import { DeinonychusPreviewScene } from '../scenes/DeinonychusPreviewScene';
import { EvilClownPreviewScene } from '../scenes/EvilClownPreviewScene';
import { MantidPreviewScene } from '../scenes/MantidPreviewScene';
import { DarkKnightPreviewScene } from '../scenes/DarkKnightPreviewScene';
import { RatKinPreviewScene } from '../scenes/RatKinPreviewScene';
import { DemonLiaisonPreviewScene } from '../scenes/DemonLiaisonPreviewScene';
import { ShadyPreviewScene } from '../scenes/ShadyPreviewScene';
import { ScientistPreviewScene } from '../scenes/ScientistPreviewScene';
import { NecromancerPreviewScene } from '../scenes/NecromancerPreviewScene';
import { BugabooPreviewScene } from '../scenes/BugabooPreviewScene';
import { TroglodytePreviewScene } from '../scenes/TroglodytePreviewScene';
import { TusklingPreviewScene } from '../scenes/TusklingPreviewScene';
import { KrakarenPreviewScene } from '../scenes/KrakarenPreviewScene';
import { TrashGremlinPreviewScene } from '../scenes/TrashGremlinPreviewScene';
import { BigRoosterPreviewScene } from '../scenes/BigRoosterPreviewScene';
import { StatusPreviewScene } from '../scenes/StatusPreviewScene';
import { FairyPreviewScene } from '../scenes/FairyPreviewScene';
import { CasinoPreviewScene } from '../scenes/CasinoPreviewScene';
import { PokerPreviewScene } from '../scenes/PokerPreviewScene';
import { SlotsPreviewScene } from '../scenes/SlotsPreviewScene';
import { WheelPreviewScene } from '../scenes/WheelPreviewScene';
import { KeyboardHeroPreviewScene } from '../scenes/KeyboardHeroPreviewScene';
import { PipeBoardPreviewScene } from '../scenes/PipeBoardPreviewScene';
import { TownMapScene } from '../scenes/TownMapScene';
import { UiGalleryScene } from '../scenes/UiGalleryScene';
import { TitleScene, type TitleStartState } from '../scenes/title/TitleScene';
import { getLevelDef } from '../levels/index';
import { createPartyCraftsState } from '../core/labour/partyCrafts';
import {
  createMurderQuestProgress,
  type MurderQuestProgress,
  type MurderQuestStage,
} from '../core/quests/MurderQuestProgress';
import { perfMonitor } from '../core/perf/PerfMonitor';
import { setDeviceMemoryOverride } from '../core/perf/deviceMemoryBudget';
import { renderQuality } from '../core/perf/RenderQuality';
import { asVarietyTier } from '../core/perf/varietyTier';
import { setFigureCacheStatsRecording } from '../sprites/figure/figureCacheStats';
import { drawPerfOverlay } from './perfOverlay';
import { installPerfDensity } from './perfDensity';
import { installPerfDuplicateCells } from './perfDuplicateCells';
import { installPerfMemory } from './perfMemory';
import { installPerfRecorder } from './perfRecorder';
import { drawDifficultyOverlay } from './difficultyOverlay';
import { showPriceBreakdowns } from '../ui/screens/shop/priceBreakdowns';
import { getPlaytestPreset } from './playtestPresets';
import {
  beginAssaultForPlaytest,
  fortifyBriarHollow,
  parseTrebuchetCount,
  parseWallTier,
  unlockEverythingForPlaytest,
} from './briarHollowFortify';
import { DOOMSDAY_COUNTDOWN_MS, createDoomsdayProgress } from '../core/quests/DoomsdayProgress';
import { settings } from '../core/input/Settings';
import { getMercenaryTemplate } from '../core/party/mercenaryTemplates';
import { PET_NAME_SUGGESTIONS, PetNameBook, parsePetName } from '../core/party/petNames';
import {
  buildPlaytestBoot,
  playtestStartsPastBathroom,
  playtestStartsPastStealthGate,
  resolvePlaytestSpawn,
  type PlaytestBoot,
} from './playtestBoot';
import { PRISON_LAYOUTS, type PrisonLayout } from '../map/goblinPrisonLayouts';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import { blueprintsPlaytestState } from './blueprintsPlaytest';
import { contractsPlaytestState } from './contractsPlaytest';
import { aiAdapter } from '../ai/AIAdapter';
import { startBrowserReplayRecording } from './aiReplayRecorder';
import { startPerfWalkFromParams } from './perfScenes';
import { DEFAULT_FLOOR_ART_SEED } from '../map/ground/floorArtSeed';
import { createGodModeState } from '../core/state/GodMode';
import { isLevelId, type LevelId } from '../levels/levelIds';
import { TUTORIAL_LEVEL_ID } from '../levels/tutorial';
import { TutorialController } from '../systems/TutorialController';
import { isStoryBeatId } from '../story/storyBeatIds';
import { storyDirectorBefore, storyPreviewLevel } from '../story/storyPreview';

/**
 * Dev-only entry points, reachable by query parameter.
 *
 * **This module never reaches a player.** A release build resolves the whole
 * file away to `devBoot.stub.ts` — see the `devBootStub` plugin in
 * `scripts/build.js` — so the preview scenes, the playtest presets and the
 * parameter names below are not merely unreachable in the shipped bundle, they
 * are absent from it. Only `npm run serve` / `dev` / `playtest` compile the real
 * thing in, and even that build refuses to act off localhost.
 *
 * Anything added here inherits that treatment; anything that a player is
 * *meant* to reach must not live in this file.
 */

const MURDER_STAGES: ReadonlyArray<MurderQuestStage> = [
  'not_started',
  'body_waiting',
  'investigation',
  'night_attack',
  'cult_hideout',
  'confrontation',
  'quill_slain',
  'lich_slain',
  'complete',
];

/**
 * Builds seeded Krasue Murders progress from a `?murder=<stage>` value, or null
 * when the parameter is absent or names no stage.
 */
function parseMurderQuestProgress(stageParam: string | null): MurderQuestProgress | null {
  if (stageParam === null) return null;
  const stage = MURDER_STAGES.find((s) => s === stageParam);
  if (stage === undefined) return null;

  const progress = createMurderQuestProgress();
  progress.stage = stage;

  const stageIndex = MURDER_STAGES.indexOf(stage);
  // No stage from the night attack on is reachable without all three clues, so a
  // seeded drop-in has to carry them or the investigation dialogs contradict the
  // stage they were seeded into.
  if (stageIndex >= MURDER_STAGES.indexOf('night_attack')) {
    progress.wellClueFound = true;
    progress.homeClueFound = true;
    progress.roostClueFound = true;
  }
  if (stageIndex >= MURDER_STAGES.indexOf('confrontation')) progress.quillNamed = true;

  return progress;
}

/**
 * Frames the loop is allowed to run per second once it is driven off timers.
 * Fast enough that a fight plays out in real time, slow enough that a tab
 * nobody is watching does not spin a core.
 */
const UNTHROTTLED_FRAME_INTERVAL_MS = 16;
const WHOLE_NUMBER = /^\d+$/;

/**
 * Runs the game loop off `setTimeout` instead of `requestAnimationFrame`.
 *
 * Chrome stops servicing `requestAnimationFrame` entirely in a tab it considers
 * hidden, which is correct for a game — a background tab should not burn a core
 * — and fatal for browser automation, which frequently cannot bring a tab to
 * the front. Without this the loop never runs a single frame, so nothing can be
 * driven or measured in the real game.
 *
 * Reached only via `?unthrottled` on localhost, and only from this file, which a
 * release build resolves away entirely. It has to be installed before the
 * `SceneManager` constructor arms the first frame, which is why `game.ts` calls
 * it rather than `devBootScene`.
 */
export function installDevLoopFallback(): void {
  const isLocalDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalDev) return;
  if (new URLSearchParams(window.location.search).get('unthrottled') === null) return;

  const scheduleOnAnimationFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    if (document.visibilityState !== 'hidden') return scheduleOnAnimationFrame(callback);
    return window.setTimeout(() => {
      callback(performance.now());
    }, UNTHROTTLED_FRAME_INTERVAL_MS);
  };
}

/**
 * The options a dev-booted floor starts from: a copy, because the caller hands
 * the same object to the normal boot, whose saves must stay persisted and whose
 * quest state must not pick up a dev seed; without the persist step unless the
 * URL opts in with `save`; and with any `murder` stage seeded, so
 * `?playtest=<id>&murder=<stage>` drops a kitted party straight into a
 * questline beat; with the music of everything the party skipped past
 * already unlocked, as a save made there would have it; and, given `seed=<n>`,
 * the floor generated from that world seed and painted with the reviewed
 * art seed, so two visits to the same URL walk the same map; and, given
 * `tough`, the `!tough` cheat already on, so a scripted walk neither dies nor
 * thins out the floor it is measuring.
 */
function devFloorOptions(
  options: DungeonSceneOptions,
  params: URLSearchParams,
): DungeonSceneOptions {
  const persistsSaves = params.get('save') !== null;
  const seededMurderProgress = parseMurderQuestProgress(params.get('murder'));
  const worldSeed = Number.parseInt(params.get('seed') ?? '', 10);
  const pinnedMap = Number.isInteger(worldSeed)
    ? { worldSeed, artSeed: DEFAULT_FLOOR_ART_SEED }
    : {};
  const cheats =
    params.get('tough') === null
      ? {}
      : { godModeState: { ...createGodModeState(), toughActive: true } };
  return {
    ...options,
    ...pinnedMap,
    ...cheats,
    saveProgress: persistsSaves ? options.saveProgress : undefined,
    progressWipe: persistsSaves ? options.progressWipe : undefined,
    murderQuestProgress: seededMurderProgress ?? options.murderQuestProgress,
    backfillMusicLibrary: true,
  };
}

/**
 * The run's pet names with the deinonychus a preset hands the party already
 * named: a pet is named the moment it joins, so a drop-in past that moment
 * would otherwise open on the name prompt. A fresh book, so the name never
 * reaches the start menu's own run.
 */
function playtestPetNames(options: DungeonSceneOptions): PetNameBook {
  const book = new PetNameBook(options.petNames?.saved());
  if (book.nameOf('deinonychus') !== null) return book;
  const name = parsePetName(PET_NAME_SUGGESTIONS.deinonychus[0]);
  if (name === null)
    throw new Error('the first suggested deinonychus name is not a legal pet name');
  book.give('deinonychus', name);
  return book;
}

/**
 * A copy of `options` with what every preset boot shares: the party, its spawn
 * and the puzzle chokes behind it. Never written into `options` itself, which
 * the caller goes on handing to the start menu: a preset's kit left there
 * would start the next real run and be saved over the player's own.
 */
function withPlaytestBoot(options: DungeonSceneOptions, boot: PlaytestBoot): DungeonSceneOptions {
  return {
    ...options,
    humanSnap: boot.humanSnap,
    catSnap: boot.catSnap,
    abilityManager: boot.abilityManager,
    // The pet is unlocked from a treasure chest most presets start well past,
    // and a playtest drop-in that cannot summon him cannot test him.
    deinonychusUnlocked: true,
    petNames: playtestPetNames(options),
    resolveSpawnTile: (gameMap) => resolvePlaytestSpawn(boot.spawn, gameMap),
    bathroomSolvedAtStart: (gameMap) => playtestStartsPastBathroom(boot.spawn, gameMap),
    stealthGateOpenAtStart: (gameMap) => playtestStartsPastStealthGate(boot.spawn, gameMap),
    preDefeatedBossTypes: boot.preDefeatedBossTypes,
    spiderQuestAwaitingHackingAtStart: boot.spiderQuestAwaitingHacking,
  };
}

const DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];

const TITLE_START_STATES: ReadonlyArray<TitleStartState> = ['dormant', 'ignition', 'alive'];

/** The state a `?title=` value names; a bare `?title` follows the audio context as the game does. */
function titleStartStateNamed(value: string): TitleStartState | undefined {
  return TITLE_START_STATES.find((state) => state === value);
}

/**
 * `?title` opens the title screen; `?title=dormant|ignition|alive` jumps to a
 * state, and `&save` adds the Continue choice, whose fake continue opens the
 * title again (the in-run Main Menu's way back). It never writes the real
 * save: a run started from it is a dev run.
 */
function openDevTitle(
  sceneManager: SceneManager,
  input: InputManager,
  options: DungeonSceneOptions,
  params: URLSearchParams,
): void {
  const unsavedOptions: DungeonSceneOptions = {
    ...options,
    saveProgress: undefined,
    progressWipe: undefined,
  };
  const startState = titleStartStateNamed(params.get('title') ?? '');
  const open = (): void => {
    const onContinue = params.get('save') === null ? undefined : open;
    sceneManager.replace(
      new TitleScene(input, sceneManager, unsavedOptions, onContinue, { startState }),
    );
  };
  open();
}

/** The preset `?prison` boots, whose spawn is the gate room the prison door opens from. */
const PRISON_ROUTE_PRESET_ID = 'prison';

/**
 * The layout a `?prison=` value names: its 1-based place in the authored list
 * or its id (`?prison=2`, `?prison=pit`). Anything else, a bare `?prison`
 * included, is null and the world's own layout is built.
 */
function prisonLayoutNamed(value: string): PrisonLayout | null {
  const byId = PRISON_LAYOUTS.find((layout) => layout.id === value);
  if (byId !== undefined) return byId;
  const position = Number(value);
  if (!Number.isInteger(position)) return null;
  return PRISON_LAYOUTS[position - 1] ?? null;
}

/**
 * Replaces the opening scene when a dev-only parameter asks for one.
 *
 * `?playtest=spider` opens a named preset — a floor, a spawn landmark and a
 * fully kitted party. `?level=level3` opens a bare floor (`&spawn=circus` puts
 * the party on the circus grounds); `?level=level3&murder=cult_hideout` also
 * seeds the Krasue Murders questline. `?prison=1&difficulty=hard`
 * walks the `prison` preset's party straight into the Goblin High Security
 * Prison, built from that layout on that difficulty; leaving it comes out in
 * floor 2's gate room. `?story=floor2_dave_chosen` boots the floor a story beat
 * is heard on, with every beat before it already heard, and plays the beat at
 * once. The rest are art preview harnesses.
 *
 * A booted floor never writes the real saved game unless `&save` is added (e.g.
 * `?playtest=spider&save`): a kitted preset or a seeded quest stage written over
 * the developer's own run would be waiting for them on the next normal load.
 * Saving still happens in memory either way, so a death in a dev boot returns
 * to the last save point just as it does in a real run.
 *
 * Returns true when it took over, meaning the caller must not boot normally.
 */
export function devBootScene(
  sceneManager: SceneManager,
  input: InputManager,
  options: DungeonSceneOptions,
): boolean {
  const isLocalDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalDev) return false;
  const params = new URLSearchParams(window.location.search);

  // Deliberately falls through instead of returning: these decorate whatever
  // scene boots next — the normal game, a playtest preset or a preview harness —
  // rather than being destinations of their own. Composed into one overlay
  // because `setFrameOverlay` holds a single function, so `?perf&?difficulty`
  // would otherwise silently show only the second one.
  const overlays: Array<(ctx: CanvasRenderingContext2D) => void> = [];
  const deviceMemoryGigabytes = Number.parseFloat(params.get('deviceMemory') ?? '');
  if (Number.isFinite(deviceMemoryGigabytes) && deviceMemoryGigabytes > 0) {
    setDeviceMemoryOverride(deviceMemoryGigabytes);
  }
  const varietyFlag = params.get('variety');
  if (varietyFlag !== null) {
    const forcedTier = WHOLE_NUMBER.test(varietyFlag) ? asVarietyTier(Number(varietyFlag)) : null;
    if (forcedTier === null) console.error(`Unknown variety "${varietyFlag}"; expected 0 to 4`);
    else renderQuality.pinVarietyTier(forcedTier);
  }
  if (params.get('perf') !== null) {
    perfMonitor.enable();
    setFigureCacheStatsRecording(true);
    installPerfMemory(sceneManager.canvas, options.audio ?? null);
    installPerfDensity(sceneManager.canvas);
    installPerfDuplicateCells();
    installPerfRecorder(sceneManager.canvas);
    overlays.push(drawPerfOverlay);
  }
  if (params.get('difficulty') !== null) {
    overlays.push(drawDifficultyOverlay);
  }
  if (params.get('prices') !== null) {
    showPriceBreakdowns();
  }
  const aiRecordName = params.get('ai-record');
  if (aiRecordName !== null) startBrowserReplayRecording(aiAdapter, aiRecordName);
  startPerfWalkFromParams(params, sceneManager);
  if (overlays.length > 0) {
    sceneManager.setFrameOverlay((ctx) => {
      for (const overlay of overlays) overlay(ctx);
    });
  }

  if (params.get('title') !== null) {
    // A bare `?title` leaves the identity unset, so the title runs as it does for a fresh player.
    if (params.get('save') !== null) useDevPlayerIdentity();
    openDevTitle(sceneManager, input, options, params);
    return true;
  }

  const route = devRouteNamed(sceneManager, input, options, params);
  if (route === null) return false;
  useDevPlayerIdentity();
  route();
  return true;
}

/**
 * The scene a dev-only parameter names, as the boot that builds it, or null
 * when none does. Building is deferred so the dev identity is set only when a
 * route takes over, and before anything that names or paints the human.
 */
function devRouteNamed(
  sceneManager: SceneManager,
  input: InputManager,
  options: DungeonSceneOptions,
  params: URLSearchParams,
): (() => void) | null {
  if (params.get('paintbench') !== null) {
    return () => sceneManager.replace(new PaintBenchScene());
  }

  if (params.get('people') !== null) {
    return () => sceneManager.replace(new PersonPreviewScene());
  }

  if (params.get('human') !== null) {
    return () => sceneManager.replace(new HumanPreviewScene());
  }

  if (params.get('cat') !== null) {
    return () => sceneManager.replace(new CatPreviewScene());
  }

  if (params.get('bopca') !== null) {
    return () => sceneManager.replace(new BopcaPreviewScene());
  }

  if (params.get('goblins') !== null) {
    return () => sceneManager.replace(new GoblinPreviewScene());
  }

  if (params.get('rat') !== null) {
    return () => sceneManager.replace(new RatPreviewScene());
  }

  if (params.get('llama') !== null) {
    return () => sceneManager.replace(new LlamaPreviewScene());
  }

  if (params.get('cows') !== null) {
    return () => sceneManager.replace(new CowPreviewScene());
  }

  if (params.get('golem') !== null) {
    return () => sceneManager.replace(new RockGolemPreviewScene());
  }

  if (params.get('darkknight') !== null) {
    return () => sceneManager.replace(new DarkKnightPreviewScene());
  }

  if (params.get('deinonychus') !== null) {
    return () => sceneManager.replace(new DeinonychusPreviewScene());
  }

  if (params.get('bugaboo') !== null) {
    return () => sceneManager.replace(new BugabooPreviewScene());
  }

  if (params.get('tuskling') !== null) {
    return () => sceneManager.replace(new TusklingPreviewScene());
  }

  if (params.get('krakaren') !== null) {
    return () => sceneManager.replace(new KrakarenPreviewScene());
  }

  if (params.get('gremlin') !== null) {
    return () => sceneManager.replace(new TrashGremlinPreviewScene());
  }

  if (params.get('rooster') !== null) {
    return () => sceneManager.replace(new BigRoosterPreviewScene());
  }

  if (params.get('trog') !== null) {
    return () => sceneManager.replace(new TroglodytePreviewScene());
  }

  if (params.get('mantid') !== null) {
    return () => sceneManager.replace(new MantidPreviewScene());
  }

  if (params.get('evilclown') !== null) {
    return () => sceneManager.replace(new EvilClownPreviewScene());
  }

  if (params.get('skeletons') !== null) {
    return () => sceneManager.replace(new SkeletonPreviewScene());
  }

  if (params.get('lich') !== null) {
    return () => sceneManager.replace(new SkeletonPreviewScene('lich'));
  }

  if (params.get('status') !== null) {
    return () => sceneManager.replace(new StatusPreviewScene());
  }

  if (params.get('fairies') !== null) {
    return () => sceneManager.replace(new FairyPreviewScene());
  }

  if (params.get('ratkin') !== null) {
    return () => sceneManager.replace(new RatKinPreviewScene());
  }

  if (params.get('demonliaison') !== null) {
    return () => sceneManager.replace(new DemonLiaisonPreviewScene());
  }

  if (params.get('shady') !== null) {
    return () => sceneManager.replace(new ShadyPreviewScene());
  }

  const scientist = params.get('scientist');
  if (scientist !== null) {
    return () => sceneManager.replace(new ScientistPreviewScene(scientist));
  }

  if (params.get('necromancer') !== null) {
    return () => sceneManager.replace(new NecromancerPreviewScene());
  }

  if (params.get('casino') !== null) {
    return () => sceneManager.replace(new CasinoPreviewScene());
  }

  if (params.get('poker') !== null) {
    return () => sceneManager.replace(new PokerPreviewScene());
  }

  if (params.get('slots') !== null) {
    return () => sceneManager.replace(new SlotsPreviewScene());
  }

  if (params.get('wheel') !== null) {
    return () => sceneManager.replace(new WheelPreviewScene());
  }

  if (params.get('keyboardhero') !== null) {
    return () => sceneManager.replace(new KeyboardHeroPreviewScene());
  }

  if (params.get('pipeboard') !== null) {
    return () => sceneManager.replace(new PipeBoardPreviewScene());
  }

  if (params.get('ui') !== null) {
    return () => sceneManager.replace(new UiGalleryScene());
  }

  if (params.get('tiles') !== null) {
    return () => sceneManager.replace(new TilePreviewScene());
  }

  if (params.get('townmap') !== null) {
    return () => sceneManager.replace(new TownMapScene());
  }

  const prisonParam = params.get('prison');
  const prisonPreset = getPlaytestPreset(PRISON_ROUTE_PRESET_ID);
  if (prisonParam !== null && prisonPreset !== null) {
    return () => {
      const difficultyParam = params.get('difficulty');
      const difficulty = DIFFICULTIES.find((candidate) => candidate === difficultyParam);
      if (difficulty !== undefined) settings.setDifficultyForSession(difficulty);
      const layout = prisonLayoutNamed(prisonParam);
      if (layout === null && prisonParam !== '') {
        console.error(`Unknown prison layout "${prisonParam}"; building the world's own`);
      }
      const boot = buildPlaytestBoot(prisonPreset);
      sceneManager.replace(
        new DungeonScene(boot.levelDef, input, sceneManager, {
          ...devFloorOptions(withPlaytestBoot(options, boot), params),
          devEnterPrisonAtStart: true,
          devPrisonLayout: layout ?? undefined,
        }),
      );
    };
  }

  const playtestId = params.get('playtest');
  if (playtestId !== null) {
    const preset = getPlaytestPreset(playtestId);
    if (preset !== null) {
      return () => {
        if (preset.difficulty !== undefined) settings.setDifficultyForSession(preset.difficulty);
        const boot = buildPlaytestBoot(preset);
        const floorOptions = withPlaytestBoot(options, boot);
        if (preset.hire !== undefined) {
          floorOptions.mercenaryRoster = {
            active: {
              id: preset.hire,
              name: getMercenaryTemplate(preset.hire).name,
              contractLevelId: preset.levelId,
              introduced: false,
            },
            lastDeceased: null,
            floorLevelId: null,
          };
        }
        if (preset.deinonychusOut === true) floorOptions.deinonychusWasOut = true;
        const defences = preset.briarHollowDefences;
        if (defences !== undefined) {
          const wallsFlag = params.get('walls');
          const trebuchetsFlag = params.get('trebuchets');
          const wallTier = parseWallTier(wallsFlag) ?? defences.wallTier;
          const trebuchets = parseTrebuchetCount(trebuchetsFlag) ?? defences.trebuchets;
          if (wallsFlag !== null && parseWallTier(wallsFlag) === null) {
            console.error(
              `Unknown walls "${wallsFlag}"; standing the ring at ${defences.wallTier}`,
            );
          }
          const assaultNow = params.get('assaultNow') !== null;
          floorOptions.prepareBriarHollow = (kit, gameMap) => {
            fortifyBriarHollow(kit, gameMap, { wallTier, trebuchets });
            if (assaultNow) beginAssaultForPlaytest(kit);
          };
        } else if (preset.constructionContracts !== undefined) {
          floorOptions.briarHollowState = contractsPlaytestState(preset.constructionContracts);
        } else if (preset.briarHollowBlueprints !== undefined) {
          floorOptions.briarHollowState = blueprintsPlaytestState(preset.briarHollowBlueprints);
        } else if (preset.briarHollowUnlockAll === true) {
          floorOptions.prepareBriarHollow = (kit) => unlockEverythingForPlaytest(kit.state.unlocks);
        }
        if (preset.toolTiers !== undefined) {
          floorOptions.partyCrafts = {
            ...createPartyCraftsState(),
            tools: { ...preset.toolTiers },
          };
        }
        if (preset.spawnAtCircus === true) floorOptions.spawnAtCircus = true;
        if (boot.doomsdayStage !== undefined) {
          const doomsday = createDoomsdayProgress();
          doomsday.stage = boot.doomsdayStage;
          doomsday.deadlineAt = Date.now() + DOOMSDAY_COUNTDOWN_MS;
          floorOptions.doomsdayQuestProgress = doomsday;
          // The countdown starts at the Lich's death, so the questline it ends is
          // already at that beat; the crystal's spot is filled in by the tower's
          // top floor the first time the party climbs to it.
          floorOptions.murderQuestProgress =
            parseMurderQuestProgress('lich_slain') ?? floorOptions.murderQuestProgress;
        }
        sceneManager.replace(
          new DungeonScene(
            boot.levelDef,
            input,
            sceneManager,
            devFloorOptions(floorOptions, params),
          ),
        );
      };
    }
    console.error(`Unknown playtest preset: "${playtestId}"`);
  }

  const storyParam = params.get('story');
  if (storyParam !== null) {
    if (isStoryBeatId(storyParam)) {
      return () => {
        const levelId = storyPreviewLevel(storyParam);
        bootDevFloor(sceneManager, input, params, levelId, {
          ...options,
          storyDirector: storyDirectorBefore(storyParam),
          storyPreview: storyParam,
          tutorialController:
            levelId === TUTORIAL_LEVEL_ID ? TutorialController.createForTutorial() : undefined,
        });
      };
    }
    console.error(`Unknown story beat: "${storyParam}"`);
  }

  const levelId = params.get('level');
  if (levelId === null || !isLevelId(levelId)) return null;
  return () => bootDevFloor(sceneManager, input, params, levelId, options);
}

/**
 * Opens a bare floor: the `?level=` route, and the floor a `?story=` preview
 * plays its beat on. `&spawn=circus` puts the party on the circus grounds.
 */
function bootDevFloor(
  sceneManager: SceneManager,
  input: InputManager,
  params: URLSearchParams,
  levelId: LevelId,
  options: DungeonSceneOptions,
): void {
  const floorOptions: DungeonSceneOptions = { ...options };
  if (params.get('spawn') === 'circus') floorOptions.spawnAtCircus = true;
  sceneManager.replace(
    new DungeonScene(
      getLevelDef(levelId),
      input,
      sceneManager,
      devFloorOptions(floorOptions, params),
    ),
  );
}
