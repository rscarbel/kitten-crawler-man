import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene, type DungeonSceneOptions } from '../scenes/DungeonScene';
import { PaintBenchScene } from '../scenes/PaintBenchScene';
import { PersonPreviewScene } from '../scenes/PersonPreviewScene';
import { TilePreviewScene } from '../scenes/TilePreviewScene';
import { BopcaPreviewScene } from '../scenes/BopcaPreviewScene';
import { HumanPreviewScene } from '../scenes/HumanPreviewScene';
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
import { NecromancerPreviewScene } from '../scenes/NecromancerPreviewScene';
import { BugabooPreviewScene } from '../scenes/BugabooPreviewScene';
import { TroglodytePreviewScene } from '../scenes/TroglodytePreviewScene';
import { TusklingPreviewScene } from '../scenes/TusklingPreviewScene';
import { KrakarenPreviewScene } from '../scenes/KrakarenPreviewScene';
import { JuicerPreviewScene } from '../scenes/JuicerPreviewScene';
import { StatusPreviewScene } from '../scenes/StatusPreviewScene';
import { FairyPreviewScene } from '../scenes/FairyPreviewScene';
import { CasinoPreviewScene } from '../scenes/CasinoPreviewScene';
import { KeyboardHeroPreviewScene } from '../scenes/KeyboardHeroPreviewScene';
import { TownMapScene } from '../scenes/TownMapScene';
import { getLevelDef } from '../levels/index';
import { createCircusQuestProgress, type CircusQuestStage } from '../core/CircusQuestProgress';
import { createPartyCraftsState } from '../core/partyCrafts';
import {
  createMurderQuestProgress,
  type MurderQuestProgress,
  type MurderQuestStage,
} from '../core/MurderQuestProgress';
import { perfMonitor } from '../core/PerfMonitor';
import { setFigureCacheStatsRecording } from '../sprites/figure/figureCacheStats';
import { drawPerfOverlay } from './perfOverlay';
import { drawDifficultyOverlay } from './difficultyOverlay';
import { getPlaytestPreset } from './playtestPresets';
import { fortifyBriarHollow, parseTrebuchetCount, parseWallTier } from './briarHollowFortify';
import { DOOMSDAY_COUNTDOWN_MS, createDoomsdayProgress } from '../core/DoomsdayProgress';
import { settings } from '../core/Settings';
import { getMercenaryTemplate } from '../core/mercenaryTemplates';
import { buildPlaytestBoot, resolvePlaytestSpawn } from './playtestBoot';

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
 * questline beat.
 */
function devFloorOptions(
  options: DungeonSceneOptions,
  params: URLSearchParams,
): DungeonSceneOptions {
  const persistsSaves = params.get('save') !== null;
  const seededMurderProgress = parseMurderQuestProgress(params.get('murder'));
  return {
    ...options,
    saveProgress: persistsSaves ? options.saveProgress : undefined,
    murderQuestProgress: seededMurderProgress ?? options.murderQuestProgress,
  };
}

/**
 * Replaces the opening scene when a dev-only parameter asks for one.
 *
 * `?playtest=spider` opens a named preset — a floor, a spawn landmark and a
 * fully kitted party. `?level=level3&quest=bigtop_ready` opens a bare floor,
 * optionally seeding circus-quest state; `?level=level3&murder=cult_hideout`
 * does the same for the Krasue Murders questline. The rest are art preview
 * harnesses.
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
  if (params.get('perf') !== null) {
    perfMonitor.enable();
    setFigureCacheStatsRecording(true);
    overlays.push(drawPerfOverlay);
  }
  if (params.get('difficulty') !== null) {
    overlays.push(drawDifficultyOverlay);
  }
  if (overlays.length > 0) {
    sceneManager.setFrameOverlay((ctx) => {
      for (const overlay of overlays) overlay(ctx);
    });
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

  if (params.get('necromancer') !== null) {
    sceneManager.replace(new NecromancerPreviewScene());
    return true;
  }

  if (params.get('casino') !== null) {
    sceneManager.replace(new CasinoPreviewScene());
    return true;
  }

  if (params.get('keyboardhero') !== null) {
    sceneManager.replace(new KeyboardHeroPreviewScene());
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

  const playtestId = params.get('playtest');
  if (playtestId !== null) {
    const preset = getPlaytestPreset(playtestId);
    if (preset !== null) {
      if (preset.difficulty !== undefined) settings.setDifficultyForSession(preset.difficulty);
      const boot = buildPlaytestBoot(preset);
      options.humanSnap = boot.humanSnap;
      options.catSnap = boot.catSnap;
      options.abilityManager = boot.abilityManager;
      // The pet is unlocked from a treasure chest most presets start well past,
      // and a playtest drop-in that cannot summon him cannot test him.
      options.mongoUnlocked = true;
      options.resolveSpawnTile = (gameMap) => resolvePlaytestSpawn(boot.spawn, gameMap);
      options.preDefeatedBossTypes = boot.preDefeatedBossTypes;
      if (preset.hire !== undefined) {
        options.mercenaryRoster = {
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
      if (preset.mongoOut === true) options.mongoWasOut = true;
      const defences = preset.briarHollowDefences;
      if (defences !== undefined) {
        const wallsFlag = params.get('walls');
        const trebuchetsFlag = params.get('trebuchets');
        const wallTier = parseWallTier(wallsFlag) ?? defences.wallTier;
        const trebuchets = parseTrebuchetCount(trebuchetsFlag) ?? defences.trebuchets;
        if (wallsFlag !== null && parseWallTier(wallsFlag) === null) {
          console.error(`Unknown walls "${wallsFlag}"; standing the ring at ${defences.wallTier}`);
        }
        options.prepareBriarHollow = (kit, gameMap) =>
          fortifyBriarHollow(kit, gameMap, { wallTier, trebuchets });
      }
      if (preset.toolTiers !== undefined) {
        options.partyCrafts = { ...createPartyCraftsState(), tools: { ...preset.toolTiers } };
      }
      if (preset.circusQuest !== undefined) {
        const circus = createCircusQuestProgress();
        circus.stage = preset.circusQuest.stage;
        circus.heatherSlain = preset.circusQuest.heatherSlain;
        options.circusQuestProgress = circus;
        options.spawnAtCircus = true;
      }
      if (boot.doomsdayStage !== undefined) {
        const doomsday = createDoomsdayProgress();
        doomsday.stage = boot.doomsdayStage;
        doomsday.deadlineAt = Date.now() + DOOMSDAY_COUNTDOWN_MS;
        options.doomsdayQuestProgress = doomsday;
        // The countdown starts at the Lich's death, so the questline it ends is
        // already at that beat; the crystal's spot is filled in by the tower's
        // top floor the first time the party climbs to it.
        options.murderQuestProgress =
          parseMurderQuestProgress('lich_slain') ?? options.murderQuestProgress;
      }
      sceneManager.replace(
        new DungeonScene(boot.levelDef, input, sceneManager, devFloorOptions(options, params)),
      );
      return true;
    }
    console.error(`Unknown playtest preset: "${playtestId}"`);
  }

  const levelId = params.get('level');
  if (levelId === null) return false;

  const questStage = params.get('quest');
  if (questStage !== null && CIRCUS_STAGES.some((s) => s === questStage)) {
    const progress = createCircusQuestProgress();
    // The check above proves membership; find() re-derives the narrow type.
    const stage = CIRCUS_STAGES.find((s) => s === questStage);
    if (stage !== undefined) progress.stage = stage;
    if (stage === 'heather_hunt' && params.get('heatherSlain') === '1') {
      progress.heatherSlain = true;
    }
    options.circusQuestProgress = progress;
  }

  if (params.get('spawn') === 'circus') options.spawnAtCircus = true;

  try {
    const levelDef = getLevelDef(levelId);
    sceneManager.replace(
      new DungeonScene(levelDef, input, sceneManager, devFloorOptions(options, params)),
    );
    return true;
  } catch {
    return false;
  }
}
