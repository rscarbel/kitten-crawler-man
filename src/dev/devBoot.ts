import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene, type DungeonSceneOptions } from '../scenes/DungeonScene';
import { PaintBenchScene } from '../scenes/PaintBenchScene';
import { PersonPreviewScene } from '../scenes/PersonPreviewScene';
import { TilePreviewScene } from '../scenes/TilePreviewScene';
import { BopcaPreviewScene } from '../scenes/BopcaPreviewScene';
import { HumanPreviewScene } from '../scenes/HumanPreviewScene';
import { DonutPreviewScene } from '../scenes/DonutPreviewScene';
import { GoblinPreviewScene } from '../scenes/GoblinPreviewScene';
import { RatPreviewScene } from '../scenes/RatPreviewScene';
import { LlamaPreviewScene } from '../scenes/LlamaPreviewScene';
import { CowPreviewScene } from '../scenes/CowPreviewScene';
import { RockGolemPreviewScene } from '../scenes/RockGolemPreviewScene';
import { SkeletonPreviewScene } from '../scenes/SkeletonPreviewScene';
import { MongoPreviewScene } from '../scenes/MongoPreviewScene';
import { EvilClownPreviewScene } from '../scenes/EvilClownPreviewScene';
import { MantidPreviewScene } from '../scenes/MantidPreviewScene';
import { DarkKnightPreviewScene } from '../scenes/DarkKnightPreviewScene';
import { RatKinPreviewScene } from '../scenes/RatKinPreviewScene';
import { ShadyPreviewScene } from '../scenes/ShadyPreviewScene';
import { ScientistPreviewScene } from '../scenes/ScientistPreviewScene';
import { NecromancerPreviewScene } from '../scenes/NecromancerPreviewScene';
import { BugabooPreviewScene } from '../scenes/BugabooPreviewScene';
import { TroglodytePreviewScene } from '../scenes/TroglodytePreviewScene';
import { TusklingPreviewScene } from '../scenes/TusklingPreviewScene';
import { KrakarenPreviewScene } from '../scenes/KrakarenPreviewScene';
import { JuicerPreviewScene } from '../scenes/JuicerPreviewScene';
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
import { createCircusQuestProgress, type CircusQuestStage } from '../core/CircusQuestProgress';
import { createPartyCraftsState } from '../core/partyCrafts';
import {
  createMurderQuestProgress,
  type MurderQuestProgress,
  type MurderQuestStage,
} from '../core/MurderQuestProgress';
import { perfMonitor } from '../core/PerfMonitor';
import { setDeviceMemoryOverride } from '../core/deviceMemoryBudget';
import { renderQuality } from '../core/RenderQuality';
import { asVarietyTier } from '../core/varietyTier';
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
import { DOOMSDAY_COUNTDOWN_MS, createDoomsdayProgress } from '../core/DoomsdayProgress';
import { settings } from '../core/Settings';
import { getMercenaryTemplate } from '../core/mercenaryTemplates';
import {
  buildPlaytestBoot,
  playtestStartsPastBathroom,
  playtestStartsPastStealthGate,
  resolvePlaytestSpawn,
  type PlaytestBoot,
} from './playtestBoot';
import { PRISON_LAYOUTS, type PrisonLayout } from '../map/goblinPrisonLayouts';
import type { Difficulty } from '../core/difficultyProfiles';
import { blueprintsPlaytestState } from './blueprintsPlaytest';
import { contractsPlaytestState } from './contractsPlaytest';
import { aiAdapter } from '../ai/AIAdapter';
import { startBrowserReplayRecording } from './aiReplayRecorder';
import { startPerfWalkFromParams } from './perfScenes';
import { DEFAULT_FLOOR_ART_SEED } from '../map/ground/floorArtSeed';
import { createGodModeState } from '../core/GodMode';
import { createClubMembership } from '../core/ClubMembership';

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

const CIRCUS_STAGES: ReadonlyArray<CircusQuestStage> = [
  'not_started',
  'ritual_defense',
  'heather_hunt',
  'assault',
  'bigtop_ready',
  'grimaldi_redeemed',
  'complete',
];

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
    mongoUnlocked: true,
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
 * fully kitted party. `?level=level3&quest=bigtop_ready` opens a bare floor,
 * optionally seeding circus-quest state; `?level=level3&murder=cult_hideout`
 * does the same for the Krasue Murders questline. `?prison=1&difficulty=hard`
 * walks the `prison` preset's party straight into the Goblin High Security
 * Prison, built from that layout on that difficulty; leaving it comes out in
 * floor 2's gate room. The rest are art preview harnesses.
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
    openDevTitle(sceneManager, input, options, params);
    return true;
  }

  if (params.get('paintbench') !== null) {
    sceneManager.replace(new PaintBenchScene());
    return true;
  }

  if (params.get('people') !== null) {
    sceneManager.replace(new PersonPreviewScene());
    return true;
  }

  if (params.get('human') !== null) {
    sceneManager.replace(new HumanPreviewScene());
    return true;
  }

  if (params.get('donut') !== null) {
    sceneManager.replace(new DonutPreviewScene());
    return true;
  }

  if (params.get('bopca') !== null) {
    sceneManager.replace(new BopcaPreviewScene());
    return true;
  }

  if (params.get('goblins') !== null) {
    sceneManager.replace(new GoblinPreviewScene());
    return true;
  }

  if (params.get('rat') !== null) {
    sceneManager.replace(new RatPreviewScene());
    return true;
  }

  if (params.get('llama') !== null) {
    sceneManager.replace(new LlamaPreviewScene());
    return true;
  }

  if (params.get('cows') !== null) {
    sceneManager.replace(new CowPreviewScene());
    return true;
  }

  if (params.get('golem') !== null) {
    sceneManager.replace(new RockGolemPreviewScene());
    return true;
  }

  if (params.get('darkknight') !== null) {
    sceneManager.replace(new DarkKnightPreviewScene());
    return true;
  }

  if (params.get('mongo') !== null) {
    sceneManager.replace(new MongoPreviewScene());
    return true;
  }

  if (params.get('bugaboo') !== null) {
    sceneManager.replace(new BugabooPreviewScene());
    return true;
  }

  if (params.get('tuskling') !== null) {
    sceneManager.replace(new TusklingPreviewScene());
    return true;
  }

  if (params.get('krakaren') !== null) {
    sceneManager.replace(new KrakarenPreviewScene());
    return true;
  }

  if (params.get('juicer') !== null) {
    sceneManager.replace(new JuicerPreviewScene());
    return true;
  }

  if (params.get('trog') !== null) {
    sceneManager.replace(new TroglodytePreviewScene());
    return true;
  }

  if (params.get('mantid') !== null) {
    sceneManager.replace(new MantidPreviewScene());
    return true;
  }

  if (params.get('evilclown') !== null) {
    sceneManager.replace(new EvilClownPreviewScene());
    return true;
  }

  if (params.get('skeletons') !== null) {
    sceneManager.replace(new SkeletonPreviewScene());
    return true;
  }

  if (params.get('lich') !== null) {
    sceneManager.replace(new SkeletonPreviewScene('lich'));
    return true;
  }

  if (params.get('status') !== null) {
    sceneManager.replace(new StatusPreviewScene());
    return true;
  }

  if (params.get('fairies') !== null) {
    sceneManager.replace(new FairyPreviewScene());
    return true;
  }

  if (params.get('ratkin') !== null) {
    sceneManager.replace(new RatKinPreviewScene());
    return true;
  }

  if (params.get('shady') !== null) {
    sceneManager.replace(new ShadyPreviewScene());
    return true;
  }

  const scientist = params.get('scientist');
  if (scientist !== null) {
    sceneManager.replace(new ScientistPreviewScene(scientist));
    return true;
  }

  if (params.get('necromancer') !== null) {
    sceneManager.replace(new NecromancerPreviewScene());
    return true;
  }

  if (params.get('casino') !== null) {
    sceneManager.replace(new CasinoPreviewScene());
    return true;
  }

  if (params.get('poker') !== null) {
    sceneManager.replace(new PokerPreviewScene());
    return true;
  }

  if (params.get('slots') !== null) {
    sceneManager.replace(new SlotsPreviewScene());
    return true;
  }

  if (params.get('wheel') !== null) {
    sceneManager.replace(new WheelPreviewScene());
    return true;
  }

  if (params.get('keyboardhero') !== null) {
    sceneManager.replace(new KeyboardHeroPreviewScene());
    return true;
  }

  if (params.get('pipeboard') !== null) {
    sceneManager.replace(new PipeBoardPreviewScene());
    return true;
  }

  if (params.get('ui') !== null) {
    sceneManager.replace(new UiGalleryScene());
    return true;
  }

  if (params.get('tiles') !== null) {
    sceneManager.replace(new TilePreviewScene());
    return true;
  }

  if (params.get('townmap') !== null) {
    sceneManager.replace(new TownMapScene());
    return true;
  }

  const prisonParam = params.get('prison');
  const prisonPreset = getPlaytestPreset(PRISON_ROUTE_PRESET_ID);
  if (prisonParam !== null && prisonPreset !== null) {
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
    return true;
  }

  const playtestId = params.get('playtest');
  if (playtestId !== null) {
    const preset = getPlaytestPreset(playtestId);
    if (preset !== null) {
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
      if (preset.mongoOut === true) floorOptions.mongoWasOut = true;
      if (preset.clubMember === true) {
        floorOptions.clubMembership = { ...createClubMembership(), hasDesperadoPass: true };
      }
      const defences = preset.briarHollowDefences;
      if (defences !== undefined) {
        const wallsFlag = params.get('walls');
        const trebuchetsFlag = params.get('trebuchets');
        const wallTier = parseWallTier(wallsFlag) ?? defences.wallTier;
        const trebuchets = parseTrebuchetCount(trebuchetsFlag) ?? defences.trebuchets;
        if (wallsFlag !== null && parseWallTier(wallsFlag) === null) {
          console.error(`Unknown walls "${wallsFlag}"; standing the ring at ${defences.wallTier}`);
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
        floorOptions.partyCrafts = { ...createPartyCraftsState(), tools: { ...preset.toolTiers } };
      }
      if (preset.circusQuest !== undefined) {
        const circus = createCircusQuestProgress();
        circus.stage = preset.circusQuest.stage;
        circus.heatherSlain = preset.circusQuest.heatherSlain;
        floorOptions.circusQuestProgress = circus;
        floorOptions.spawnAtCircus = true;
      }
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
        new DungeonScene(boot.levelDef, input, sceneManager, devFloorOptions(floorOptions, params)),
      );
      return true;
    }
    console.error(`Unknown playtest preset: "${playtestId}"`);
  }

  const levelId = params.get('level');
  if (levelId === null) return false;

  const floorOptions: DungeonSceneOptions = { ...options };
  const questStage = params.get('quest');
  if (questStage !== null && CIRCUS_STAGES.some((s) => s === questStage)) {
    const progress = createCircusQuestProgress();
    // The check above proves membership; find() re-derives the narrow type.
    const stage = CIRCUS_STAGES.find((s) => s === questStage);
    if (stage !== undefined) progress.stage = stage;
    if (stage === 'heather_hunt' && params.get('heatherSlain') === '1') {
      progress.heatherSlain = true;
    }
    floorOptions.circusQuestProgress = progress;
  }

  if (params.get('spawn') === 'circus') floorOptions.spawnAtCircus = true;

  try {
    const levelDef = getLevelDef(levelId);
    sceneManager.replace(
      new DungeonScene(levelDef, input, sceneManager, devFloorOptions(floorOptions, params)),
    );
    return true;
  } catch {
    return false;
  }
}
