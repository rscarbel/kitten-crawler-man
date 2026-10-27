/**
 * The music library's save behaviour, for `verify-audio.ts`: what a save
 * keeps of it, what a stored library this build cannot account for does to
 * the save, and what a run starts with. Imported after the browser shim is
 * installed, since the descent check plays a real floor.
 */

import type { MusicTrackId } from '../../src/audio/sounds.js';
import {
  ALWAYS_UNLOCKED_TRACK_IDS,
  MusicLibrary,
  activeMusicLibrary,
} from '../../src/core/music/MusicLibrary.js';
import { parseGameProgress } from '../../src/core/save/saveFormat.js';
import { settleArrival } from '../settleArrival.js';

type Check = (ok: boolean, message: string) => void;

/** The world seed the walk-away and inventory scene harnesses play on. */
const HARNESS_WORLD_SEED = 7;
/** An id no catalogue entry has, as a stored library might name one. */
const UNKNOWN_TRACK_ID = 'a_song_this_build_never_had';

/** Songs the run has unlocked; the first two of them heard, the last still new to the music page. */
const UNLOCKED_ON_THE_RUN = [
  'bg_level_1',
  'boss_music_1',
  'keyboard_hero_music_track_1',
] as const satisfies readonly MusicTrackId[];
const HEARD_ON_THE_RUN = ['bg_level_1', 'boss_music_1'] as const satisfies readonly MusicTrackId[];

/** `ids` plus the songs every library starts with. */
function withAlwaysUnlocked(ids: readonly MusicTrackId[]): MusicTrackId[] {
  return [...new Set<MusicTrackId>([...ids, ...ALWAYS_UNLOCKED_TRACK_IDS])];
}

function isAlwaysUnlocked(id: MusicTrackId): boolean {
  return ALWAYS_UNLOCKED_TRACK_IDS.some((alwaysId) => alwaysId === id);
}

function sameIds(actual: readonly MusicTrackId[], expected: readonly MusicTrackId[]): boolean {
  const expectedIds = new Set(expected);
  return actual.length === expectedIds.size && actual.every((id) => expectedIds.has(id));
}

function describe(ids: readonly MusicTrackId[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

/** A library the run has played: unlocked songs, some heard, one still unseen on the music page. */
function playedLibrary(): MusicLibrary {
  const library = new MusicLibrary();
  library.markRequested(UNLOCKED_ON_THE_RUN.slice(0, -1));
  library.clearMenuUnseen();
  library.markRequested(UNLOCKED_ON_THE_RUN.slice(-1));
  for (const id of HEARD_ON_THE_RUN) library.markAudible(id);
  library.drainNotices();
  return library;
}

function expectLibraryKept(check: Check, label: string, kept: MusicLibrary): void {
  const expectedUnlocked = withAlwaysUnlocked(UNLOCKED_ON_THE_RUN);
  check(
    sameIds(kept.unlocked, expectedUnlocked),
    `${label}: unlocked ${describe(kept.unlocked)}, expected ${describe(expectedUnlocked)}`,
  );
  const heard = kept.unlocked.filter((id) => kept.isHeard(id));
  const expectedHeard = withAlwaysUnlocked(HEARD_ON_THE_RUN);
  check(
    sameIds(heard, expectedHeard),
    `${label}: heard ${describe(heard)}, expected ${describe(expectedHeard)}`,
  );
  check(kept.menuUnseenCount === 1, `${label}: ${kept.menuUnseenCount} songs unseen, expected 1`);
  const notices = kept.drainNotices();
  check(notices.length === 0, `${label}: loading it raised ${notices.length} notices, expected 0`);
}

/**
 * Check 11: the save the stairs write — which carries no `world` — keeps the
 * library through storage, and the same save naming a song this build does not
 * have fails validation whole.
 */
export async function checkSaveRoundTrip(check: Check): Promise<void> {
  const { SceneManager } = await import('../../src/core/Scene.js');
  const { InputManager } = await import('../../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../../src/scenes/DungeonScene.js');
  const { level2 } = await import('../../src/levels/level2.js');
  const { readLocalProgress, writeLocalProgress } =
    await import('../../src/core/save/LocalProgress.js');

  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level2, new InputManager(), sceneManager, {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
    musicLibrary: playedLibrary(),
    saveProgress: (progress) => {
      writeLocalProgress(progress);
      return Promise.resolve('saved');
    },
  });
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(scene, ctx), "the descent floor's arrival screen finishes");
  scene['stairwell'].descend();
  const descended = readLocalProgress();
  if (descended === null) {
    check(false, 'the descent wrote no save the device can read back');
    return;
  }
  check(descended.world === undefined, 'the descent save carries no world, as the stairs write it');
  expectLibraryKept(check, 'the descent save', MusicLibrary.fromSerialized(descended.musicLibrary));

  const withUnknownSong = {
    ...descended,
    musicLibrary: {
      ...descended.musicLibrary,
      unlocked: [...descended.musicLibrary.unlocked, UNKNOWN_TRACK_ID],
    },
  };
  check(
    parseGameProgress(JSON.parse(JSON.stringify(withUnknownSong))) === null,
    'a save whose library names a song this build does not have fails validation',
  );
  const { musicLibrary: _dropped, ...withoutLibrary } = descended;
  check(
    parseGameProgress(JSON.parse(JSON.stringify(withoutLibrary))) === null,
    'a save with no music library fails validation',
  );
}

/**
 * Check 12: what a run's library starts with. The songs every library starts
 * with are unlocked and heard in any library, new or loaded, without a notice;
 * a new game skipping the tutorial unlocks it; and a dev drop-in onto a later
 * floor unlocks the songs it skipped, silently.
 */
export async function checkBackfill(check: Check): Promise<void> {
  checkAlwaysUnlocked(check);
  await checkSkipToLevel1(check);
  await checkPlaytestDropIn(check);
}

/**
 * The title music is every player's from the start: a new game and a loaded
 * save both have it unlocked and heard, without a notice or a badge.
 */
function checkAlwaysUnlocked(check: Check): void {
  const fresh = new MusicLibrary();
  const loaded = MusicLibrary.fromSerialized({ unlocked: [], heard: [], menuUnseen: [] });
  for (const [label, library] of [
    ['a new game', fresh],
    ['a save that never had it', loaded],
  ] as const) {
    const missing = ALWAYS_UNLOCKED_TRACK_IDS.filter(
      (id) => !library.isUnlocked(id) || !library.isHeard(id),
    );
    check(missing.length === 0, `${label}: ${describe(missing)} not unlocked and heard`);
    check(
      library.menuUnseenCount === 0,
      `${label}: the always-unlocked songs badge the music page`,
    );
    const notices = library.drainNotices().length;
    check(notices === 0, `${label}: the always-unlocked songs raised ${notices} notices`);
  }
}

/**
 * A new game that skips the tutorial can never go back to it, so its library
 * starts with Tutorial Island unlocked and announced like any other unlock.
 */
async function checkSkipToLevel1(check: Check): Promise<void> {
  const { SceneManager } = await import('../../src/core/Scene.js');
  const { InputManager } = await import('../../src/core/input/InputManager.js');
  const { TitleScene } = await import('../../src/scenes/title/TitleScene.js');
  const { TITLE_MENU_SURFACE_ID } = await import('../../src/scenes/title/titleMenu.js');
  const { DIVE_DURATION_MS } = await import('../../src/scenes/title/titleTimeline.js');
  const { TITLE_STEP_MS } = await import('../../src/scenes/title/titleClock.js');
  const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../../src/ui/core/pointer.js');

  const sceneManager = new SceneManager();
  const menu = new TitleScene(new InputManager(), sceneManager, {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
  });
  sceneManager.replace(menu);
  menu.render(sceneManager.ctx);
  const skipRegionId = `${TITLE_MENU_SURFACE_ID}/level1`;
  const skipButton = menu.ui.regions().find((region) => region.id === skipRegionId);
  if (skipButton === undefined) {
    check(false, 'the title menu offers no "Skip to Level 1"');
    return;
  }
  const { rect } = skipButton;
  const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const scale = menu.ui.uiScale;
  for (const kind of ['down', 'up'] as const) {
    menu.ui.pointer({
      kind,
      pointerId: MOUSE_POINTER_ID,
      source: 'mouse',
      x: centre.x,
      y: centre.y,
      cssX: centre.x * scale,
      cssY: centre.y * scale,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  }
  const stepsThroughTheDive = Math.ceil(DIVE_DURATION_MS / TITLE_STEP_MS) + 1;
  for (let step = 0; step < stepsThroughTheDive; step++) menu.update();
  const library = activeMusicLibrary();
  check(
    library?.isUnlocked('tutorial_island') === true,
    'a new game skipping to level 1 starts with Tutorial Island unlocked',
  );
  const announced = (library?.drainNotices() ?? []).some(
    (notice) => notice.kind === 'unlocked' && notice.id === 'tutorial_island',
  );
  check(announced, "the skip's Tutorial Island unlock waits for the HUD to announce it");
}

/** What a floor-3 drop-in skipped past: the tutorial, floors 1 and 2 and their forced bosses. */
const SKIPPED_ON_THE_WAY_TO_FLOOR_3 = [
  'tutorial_island',
  'bg_level_1',
  'bg_level_2',
  'boss_music_1',
  'boss_music_2',
  'boss_music_3',
] as const satisfies readonly MusicTrackId[];
const FLOOR_3_PLAYTEST_PRESET_ID = 'level3';

/**
 * A playtest preset dropped onto floor 3 starts with the music of the floors
 * it skipped already unlocked, silently.
 */
async function checkPlaytestDropIn(check: Check): Promise<void> {
  const { SceneManager } = await import('../../src/core/Scene.js');
  const { InputManager } = await import('../../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../../src/scenes/DungeonScene.js');
  const { getPlaytestPreset } = await import('../../src/dev/playtestPresets.js');
  const { buildPlaytestBoot } = await import('../../src/dev/playtestBoot.js');

  const preset = getPlaytestPreset(FLOOR_3_PLAYTEST_PRESET_ID);
  if (preset === null) {
    check(false, `no "${FLOOR_3_PLAYTEST_PRESET_ID}" playtest preset`);
    return;
  }
  const boot = buildPlaytestBoot(preset);
  const library = new MusicLibrary();
  const sceneManager = new SceneManager();
  sceneManager.replace(
    new DungeonScene(boot.levelDef, new InputManager(), sceneManager, {
      worldSeed: HARNESS_WORLD_SEED,
      skipIntro: true,
      humanSnap: boot.humanSnap,
      catSnap: boot.catSnap,
      abilityManager: boot.abilityManager,
      musicLibrary: library,
      backfillMusicLibrary: true,
    }),
  );
  const missing = SKIPPED_ON_THE_WAY_TO_FLOOR_3.filter((id) => !library.isUnlocked(id));
  check(missing.length === 0, `the floor-3 drop-in starts with ${describe(missing)} still locked`);
  const heard = library.unlocked.filter((id) => library.isHeard(id) && !isAlwaysUnlocked(id));
  check(heard.length === 0, `the drop-in's backfilled songs count as heard: ${describe(heard)}`);
  const notices = library.drainNotices();
  const unlockToasts = notices.filter((notice) => notice.kind === 'unlocked').length;
  check(unlockToasts === 0, `the drop-in toasts ${unlockToasts} unlocks, expected one summary`);
}
