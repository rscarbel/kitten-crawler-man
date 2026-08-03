import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene, type DungeonSceneOptions } from '../scenes/DungeonScene';
import { PersonPreviewScene } from '../scenes/PersonPreviewScene';
import { TilePreviewScene } from '../scenes/TilePreviewScene';
import { BopcaPreviewScene } from '../scenes/BopcaPreviewScene';
import { GoblinPreviewScene } from '../scenes/GoblinPreviewScene';
import { RatPreviewScene } from '../scenes/RatPreviewScene';
import { LlamaPreviewScene } from '../scenes/LlamaPreviewScene';
import { RatKinPreviewScene } from '../scenes/RatKinPreviewScene';
import { CasinoPreviewScene } from '../scenes/CasinoPreviewScene';
import { TownMapScene } from '../scenes/TownMapScene';
import { getLevelDef } from '../levels/index';
import { createCircusQuestProgress, type CircusQuestStage } from '../core/CircusQuestProgress';
import { getPlaytestPreset } from './playtestPresets';
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
  'grimaldi_slain',
  'complete',
];

/**
 * Replaces the opening scene when a dev-only parameter asks for one.
 *
 * `?playtest=spider` opens a named preset — a floor, a spawn landmark and a
 * fully kitted party. `?level=level3&quest=bigtop_ready` opens a bare floor,
 * optionally seeding circus-quest state. The rest are art preview harnesses.
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

  if (params.get('people') !== null) {
    sceneManager.replace(new PersonPreviewScene());
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

  if (params.get('ratkin') !== null) {
    sceneManager.replace(new RatKinPreviewScene());
    return true;
  }

  if (params.get('casino') !== null) {
    sceneManager.replace(new CasinoPreviewScene());
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
      const boot = buildPlaytestBoot(preset);
      options.humanSnap = boot.humanSnap;
      options.catSnap = boot.catSnap;
      options.abilityManager = boot.abilityManager;
      options.resolveSpawnTile = (gameMap) => resolvePlaytestSpawn(boot.spawn, gameMap);
      sceneManager.replace(new DungeonScene(boot.levelDef, input, sceneManager, options));
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
    sceneManager.replace(new DungeonScene(levelDef, input, sceneManager, options));
    return true;
  } catch {
    return false;
  }
}
