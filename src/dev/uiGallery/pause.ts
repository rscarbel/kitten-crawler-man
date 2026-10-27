/**
 * The gallery's pause sheet: the pause screen on every page, with a party,
 * abilities, achievements, a journal and run statistics built as fixtures.
 */

import { MAGIC_MISSILE_DEF } from '../../abilities/magicMissile';
import { MONGO_DEF } from '../../abilities/mongo';
import { PROTECTIVE_SHELL_DEF } from '../../abilities/protectiveShell';
import { SMUSH_DEF } from '../../abilities/smush';
import { AbilityManager } from '../../core/skills/AbilityManager';
import {
  ACHIEVEMENT_DEFS,
  AchievementManager,
  isAchievementId,
} from '../../core/progression/AchievementManager';
import { awardXp } from '../../core/progression/awardXp';
import { TILE_SIZE } from '../../core/constants';
import { EventBus } from '../../core/EventBus';
import {
  clearDifficultyChangeGuard,
  registerDifficultyChangeGuard,
} from '../../core/difficulty/difficultyChangeGuard';
import { MusicLibrary } from '../../core/music/MusicLibrary';
import { settings } from '../../core/input/Settings';
import { GameStats } from '../../core/progression/GameStats';
import { createJournalProgress } from '../../core/quests/JournalProgress';
import {
  getSkillDef,
  isEligible,
  SKILL_IDS,
  type CrawlerKind,
} from '../../core/skills/SkillManager';
import { BRASS_GULLET_SKILL } from '../../core/skills/tattoos';
import { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { Surface } from '../../ui/core/UiRoot';
import {
  PauseScreen,
  type PauseFrame,
  type PauseRestriction,
} from '../../ui/screens/pause/PauseScreen';
import type { PauseAudio, PauseSectionId } from '../../ui/screens/pause/section';
import type { MusicPlayerControls, MusicPlayerMode } from '../../audio/music/MusicDirector';
import type { MusicBusId, MusicTrackId } from '../../audio/sounds';
import type { DialogFixture, FixtureRig } from './dialogs/fixture';

const PLAYER_TILE = 10;
const FIXTURE_XP = 140;
const HUMAN_UNSPENT = 2;
const CAT_UNSPENT = 1;
const SKILLS_PER_CRAWLER = 2;
const ACHIEVEMENTS_PER_CRAWLER = 4;
const ABILITY_XP = 60;
const CRAFT_XP = 700;
const FRAMES_PER_SECOND = 60;
const PLAYED_SECONDS = 1380;
const PLAYED_FRAMES = FRAMES_PER_SECOND * PLAYED_SECONDS;
const MONGO_PETS = 48;
const OTHER_COW_PETS = 25;
const MIDGE_PETS = 12;
/** The key chip the keyboard-focus fixture walks to: well below the first screenful of rows. */
const FOCUS_TARGET = 30;
/** Most PageDown presses a fixture needs to bring a control on a phone page into view. */
const MAX_PAGES = 6;
/** PageDown presses that reach the foot of the whole track list on the shortest phone. */
const MUSIC_LIST_MAX_PAGES = 30;
/** A cap on its Tab presses, past the sidebar and the header. */
const KEYBOARD_FOCUS_MAX_PRESSES = 80;
/** A tier other than the one in play, so the guarded pick needs confirming. */
const GUARDED_PICK = settings.difficulty === 'hard' ? 'easy' : 'hard';
const GOBLIN_KILLS = 14;
const RAT_KILLS = 9;
const CLOWN_KILLS = 4;
const KILLS: ReadonlyArray<readonly [string, number]> = [
  ['Goblin', GOBLIN_KILLS],
  ['Rat', RAT_KILLS],
  ['Clown', CLOWN_KILLS],
  ['Grotesque Spider', 1],
];

/** A party, abilities, achievements and stats for the pause screen to show. */
export interface PauseFixtureData {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly abilities: AbilityManager;
  readonly frame: PauseFrame;
}

function grantSkills(player: HumanPlayer | CatPlayer, crawler: CrawlerKind): void {
  SKILL_IDS.filter((id) => isEligible(getSkillDef(id), crawler))
    .slice(0, SKILLS_PER_CRAWLER)
    .forEach((id) => player.skills.unlockSkill(id));
}

/** Partway up the kill ladder, so its meters read part full. */
const FIXTURE_DUNGEON_KILLS = 143;

function grantAchievements(manager: AchievementManager, crawler: CrawlerKind): void {
  Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const owner = ACHIEVEMENT_DEFS[id].playerType;
      return owner === 'both' || owner === crawler;
    })
    .slice(0, ACHIEVEMENTS_PER_CRAWLER)
    .forEach((id) => manager.recordUnlock(id));
}

export function pauseFixtureData(): PauseFixtureData {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const bus = new EventBus();
  awardXp(human, FIXTURE_XP, bus);
  awardXp(cat, FIXTURE_XP, bus);
  human.unspentPoints = HUMAN_UNSPENT;
  cat.unspentPoints = CAT_UNSPENT;
  grantSkills(human, 'human');
  grantSkills(cat, 'cat');
  human.craftSkills.learn('resourcing');
  human.craftSkills.learn('construction');
  human.craftSkills.addXp('construction', CRAFT_XP);
  cat.craftSkills.learn('resourcing');
  cat.inventory.addItem('magic_missile_tome', 1);
  human.tattoo = 'third_eye';
  cat.tattoo = 'quick_serpent';
  cat.skillTattoo = BRASS_GULLET_SKILL;

  const abilities = new AbilityManager();
  for (const def of [MAGIC_MISSILE_DEF, PROTECTIVE_SHELL_DEF, SMUSH_DEF, MONGO_DEF]) {
    abilities.register(def);
  }
  abilities.addXp('magic_missile', ABILITY_XP);

  const humanAchievements = new AchievementManager();
  const catAchievements = new AchievementManager();
  grantAchievements(humanAchievements, 'human');
  grantAchievements(catAchievements, 'cat');
  for (let kill = 0; kill < FIXTURE_DUNGEON_KILLS; kill++) {
    humanAchievements.advanceCounter('dungeonKills');
  }

  const gameStats = new GameStats();
  for (const [name, count] of KILLS) {
    for (let kill = 0; kill < count; kill++) gameStats.recordKill(name);
  }
  for (let frame = 0; frame < PLAYED_FRAMES; frame++) gameStats.recordPlayedFrame();
  for (let pet = 0; pet < MONGO_PETS; pet++) gameStats.recordMongoPetted();
  for (let pet = 0; pet < OTHER_COW_PETS; pet++) gameStats.recordCowPetted(false);
  for (let pet = 0; pet < MIDGE_PETS; pet++) gameStats.recordCowPetted(true);

  return {
    human,
    cat,
    abilities,
    frame: {
      humanAchievements,
      catAchievements,
      gameStats,
    },
  };
}

const FIXTURE_MASTER_VOLUME = 0.8;
const FIXTURE_MUSIC_VOLUME = 0.45;
const FIXTURE_SFX_VOLUME = 0.7;
const FIXTURE_AMBIENCE_VOLUME = 0.6;

/** Songs a mid-run save has found: some in every state the music page draws. */
const FIXTURE_UNLOCKED_SONGS: readonly MusicTrackId[] = [
  'tutorial_island',
  'bg_level_1',
  'town_music_1',
  'town_music_2',
  'forest_path',
  'circus_theme_1',
  'cloak_and_dagger_1',
  'casino_background_jazz_1',
];
/** Found since the music page was last opened, so the menu and the rows show them as new. */
const FIXTURE_NEW_SONGS: readonly MusicTrackId[] = ['forest_path', 'circus_theme_1'];
const FIXTURE_AUDIBLE_SONG: MusicTrackId = 'bg_level_1';

function fixtureMusicLibrary(): MusicLibrary {
  const library = new MusicLibrary();
  library.markRequested(FIXTURE_UNLOCKED_SONGS.filter((id) => !FIXTURE_NEW_SONGS.includes(id)));
  library.clearMenuUnseen();
  library.markRequested(FIXTURE_NEW_SONGS);
  library.markAudible(FIXTURE_AUDIBLE_SONG);
  library.drainNotices();
  return library;
}

/** A player that remembers its mode and claims the chosen song is the one sounding. */
function fixtureMusicPlayer(): MusicPlayerControls {
  let mode: MusicPlayerMode = { kind: 'area' };
  let audible: MusicBusId = FIXTURE_AUDIBLE_SONG;
  const choose = (next: MusicPlayerMode): void => {
    mode = next;
    if (next.kind === 'repeat' || next.kind === 'once') audible = next.id;
  };
  return {
    get playerMode() {
      return mode;
    },
    get audibleTrack() {
      return audible;
    },
    playOnce: (id) => choose({ kind: 'once', id }),
    repeat: (id) => choose({ kind: 'repeat', id }),
    shuffleUnlocked: () => choose({ kind: 'shuffle' }),
    areaMusic: () => choose({ kind: 'area' }),
    onTrackAudible: () => () => undefined,
  };
}

/** Volumes the sliders can move, with every playback call a no-op. */
function fixtureAudio(): PauseAudio {
  const volumes = {
    master: FIXTURE_MASTER_VOLUME,
    music: FIXTURE_MUSIC_VOLUME,
    sfx: FIXTURE_SFX_VOLUME,
    ambience: FIXTURE_AMBIENCE_VOLUME,
  };
  const toggles = { muted: false, mono: false, background: false };
  return {
    music: fixtureMusicPlayer(),
    play: () => undefined,
    pauseMusic: () => undefined,
    pauseAmbience: () => undefined,
    resumeMusic: () => undefined,
    resumeAmbience: () => undefined,
    get masterVolume() {
      return volumes.master;
    },
    get musicVolume() {
      return volumes.music;
    },
    get sfxVolume() {
      return volumes.sfx;
    },
    get ambienceVolume() {
      return volumes.ambience;
    },
    setMasterVolumePreference: (v: number) => {
      volumes.master = v;
    },
    setMusicVolumePreference: (v: number) => {
      volumes.music = v;
    },
    setSfxVolumePreference: (v: number) => {
      volumes.sfx = v;
    },
    setAmbienceVolumePreference: (v: number) => {
      volumes.ambience = v;
    },
    get muted() {
      return toggles.muted;
    },
    setMuted: (muted: boolean) => {
      toggles.muted = muted;
    },
    get monoAudio() {
      return toggles.mono;
    },
    setMonoAudio: (mono: boolean) => {
      toggles.mono = mono;
    },
    get playsInBackground() {
      return toggles.background;
    },
    setPlaysInBackground: (enabled: boolean) => {
      toggles.background = enabled;
    },
  };
}

/** A pause screen over `data`, with a journal and every optional hook filled. */
export function pauseFixtureScreen(data: PauseFixtureData): PauseScreen {
  const library = fixtureMusicLibrary();
  const screen = new PauseScreen({
    party: () => ({ human: data.human, cat: data.cat }),
    abilities: data.abilities,
    audio: fixtureAudio(),
    guides: {
      mongo: () => undefined,
      craft: () => undefined,
      processing: () => undefined,
      dualHarvest: () => undefined,
    },
    musicLibrary: () => library,
  });
  screen.onResetGame = () => undefined;
  screen.journalContext = {
    playerTileX: PLAYER_TILE,
    playerTileY: PLAYER_TILE,
    progress: createJournalProgress(),
    entries: [
      {
        id: 'bounty',
        name: 'Shady’s Bounty',
        status: 'active',
        objective: 'Kill the goblin chieftain (2 of 3 marks)',
        hint: 'He loiters outside the Quiet Needle, in the Low Quarter.',
        target: { x: 34, y: 2 },
      },
      {
        id: 'anchor',
        name: 'The Anchor is Broken',
        status: 'active',
        objective: 'Find the three shards',
        target: { x: 4, y: 30 },
      },
      {
        id: 'anchor/shard-1',
        parentId: 'anchor',
        name: 'Shard in the Starlight Tent',
        status: 'active',
        objective: 'Somewhere past the hall of mirrors',
        target: { x: 2, y: 12 },
      },
      {
        id: 'blueprints',
        name: 'Borrowed Blueprints',
        status: 'available',
        objective: 'Talk to the foreman at the lumber yard',
        target: { x: 18, y: 14 },
      },
      {
        id: 'murders',
        name: 'The Krasue Murders',
        status: 'failed',
        objective: 'The trail went cold',
      },
      { id: 'rats', name: 'Rat Problem', status: 'completed', objective: 'Cellar cleared' },
    ],
  };
  return screen;
}

/** Taps the audible song's row, paging down to it where the now-playing header pushes it off a short screen. */
function tapSong(rig: FixtureRig, surfaceId: string): void {
  const row = `${surfaceId}/song/${FIXTURE_AUDIBLE_SONG}`;
  for (let page = 0; page < MAX_PAGES && rig.region(row) === null; page++) {
    rig.key('PageDown');
    rig.frame();
    rig.frame();
  }
  rig.tap(rig.need(row));
}

interface PauseFixtureSpec {
  readonly name: string;
  readonly section: PauseSectionId | null;
  readonly restriction?: PauseRestriction;
  readonly interact?: (rig: FixtureRig, surfaceId: string, screen: PauseScreen) => void;
}

function pauseFixture(spec: PauseFixtureSpec): DialogFixture {
  const surfaceId = `pause-${spec.name}`;
  const built: { screen: PauseScreen | null } = { screen: null };
  return {
    name: spec.name,
    surfaces: (shown) => {
      const data = pauseFixtureData();
      const screen = pauseFixtureScreen(data);
      built.screen = screen;
      screen.open(spec.section);
      const restriction = spec.restriction ?? null;
      const main = screen.surface({
        frame: () => data.frame,
        onEscape: () => screen.close(),
        openInventory: () => undefined,
        restriction: () => restriction,
      });
      const renamed = (surface: Surface, id: string): Surface => ({
        ...surface,
        id,
        isOpen: () => shown() && surface.isOpen(),
      });
      return [
        renamed(main, surfaceId),
        ...screen
          .confirmSurfaces()
          .map((surface) => renamed(surface, `${surfaceId}-${surface.id}`)),
      ];
    },
    interact:
      spec.interact === undefined
        ? undefined
        : (rig) => {
            if (built.screen !== null) spec.interact?.(rig, surfaceId, built.screen);
          },
  };
}

export const PAUSE_FIXTURES: readonly DialogFixture[] = [
  pauseFixture({ name: 'menu', section: null }),
  pauseFixture({ name: 'journal', section: 'journal' }),
  pauseFixture({ name: 'character', section: 'character' }),
  pauseFixture({
    name: 'character-skills',
    section: 'character',
    interact: (rig, id) => rig.tap(rig.need(`${id}/character-tab/skills`)),
  }),
  pauseFixture({
    name: 'character-run',
    section: 'character',
    interact: (rig, id) => rig.tap(rig.need(`${id}/character-tab/run`)),
  }),
  pauseFixture({ name: 'abilities', section: 'abilities' }),
  pauseFixture({
    name: 'abilities-detail',
    section: 'abilities',
    interact: (rig, id) => rig.tap(rig.need(`${id}/ability/magic_missile`)),
  }),
  pauseFixture({
    name: 'abilities-hotbar',
    section: 'abilities',
    interact: (rig, id) => rig.tap(rig.need(`${id}/equipped-abilities`)),
  }),
  pauseFixture({ name: 'crafts', section: 'crafts' }),
  pauseFixture({ name: 'achievements', section: 'achievements' }),
  pauseFixture({ name: 'music', section: 'music' }),
  pauseFixture({
    name: 'music-row',
    section: 'music',
    interact: (rig, id) => tapSong(rig, id),
  }),
  pauseFixture({
    name: 'music-detail',
    section: 'music',
    interact: (rig, id) => {
      tapSong(rig, id);
      rig.frame();
      // A phone drills straight into the song; a card shows its actions on the row.
      const credits = rig.region(`${id}/song/${FIXTURE_AUDIBLE_SONG}/credits`);
      if (credits !== null) rig.tap(credits);
    },
  }),
  pauseFixture({
    name: 'music-credits',
    section: 'music',
    interact: (rig, id) => {
      const footer = `${id}/all-credits`;
      for (let page = 0; page < MUSIC_LIST_MAX_PAGES && rig.region(footer) === null; page++) {
        rig.key('PageDown');
        rig.frame();
        rig.frame();
      }
      rig.tap(rig.need(footer));
    },
  }),
  pauseFixture({ name: 'settings', section: 'settings' }),
  pauseFixture({ name: 'controls', section: 'controls' }),
  pauseFixture({
    name: 'controls-keyboard',
    section: 'controls',
    interact: (rig, id) => {
      rig.tap(rig.need(`${id}/controls-view/keyboard`));
      rig.frame();
      rig.tap(rig.need(`${id}/chip/moveUp/1`));
    },
  }),
  pauseFixture({
    name: 'confirm-reset',
    section: null,
    interact: (rig, id, screen) => {
      const quit = rig.region(`${id}/menu/quit`);
      // A short screen scrolls Reset Game out of the menu; ask the screen directly then.
      if (quit === null) screen.requestReset();
      else rig.tap(quit);
    },
  }),
  pauseFixture({
    name: 'confirm-difficulty',
    section: 'settings',
    interact: (rig, id) => {
      // A guard stands in for the Starlight Tent, so the pick asks before restarting.
      const handle = registerDifficultyChangeGuard({ restartWithDifficulty: () => undefined });
      const pick = `${id}/difficulty/${GUARDED_PICK}`;
      // A phone has the difficulty row below the fold; page down to it.
      for (let page = 0; page < MAX_PAGES && rig.region(pick) === null; page++) {
        rig.key('PageDown');
        rig.frame();
        rig.frame();
      }
      rig.tap(rig.need(pick));
      clearDifficultyChangeGuard(handle);
    },
  }),
  pauseFixture({
    name: 'confirm-restore-keys',
    section: 'controls',
    interact: (rig, id) => {
      rig.tap(rig.need(`${id}/controls-view/keyboard`));
      rig.frame();
      rig.tap(rig.need(`${id}/restore-keys`));
    },
  }),
  pauseFixture({
    name: 'tutorial',
    section: null,
    restriction: { kind: 'inventory', crawler: 'human' },
  }),
  pauseFixture({
    name: 'tutorial-character',
    section: null,
    restriction: { kind: 'section', section: 'character' },
  }),
  pauseFixture({
    name: 'keyboard-focus',
    section: 'controls',
    interact: (rig, id, screen) => {
      rig.tap(rig.need(`${id}/controls-view/keyboard`));
      rig.frame();
      // Tab until focus is far enough down the key list that the page has had to scroll.
      for (let press = 0; press < KEYBOARD_FOCUS_MAX_PRESSES; press++) {
        const focus = screen.keyboardFocus();
        if (focus !== null && focus.areaId.includes('controls') && focus.index >= FOCUS_TARGET) {
          return;
        }
        rig.key('Tab');
        rig.frame();
        rig.frame();
      }
    },
  }),
];
