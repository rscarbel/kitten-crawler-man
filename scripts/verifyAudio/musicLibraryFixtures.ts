/**
 * Saves written before the music library existed, as the device stored them:
 * raw JSON with no `musicLibrary`, for the backfill to read. Each one is the
 * shape a real save of that moment has — a tutorial save and a stairs save
 * carry no `world`, a town save carries the floor's persisted state — with the
 * evidence a player at that point would have left.
 */

import type { MusicTrackId } from '../../src/audio/sounds.js';
import type { PlayerSnapshot } from '../../src/core/save/PlayerSnapshot.js';
import { JACKPOT_FLOOR } from '../../src/systems/casino/slots/slotBets.js';

/** Any seed: the backfill reads what the floor recorded, never the map it describes. */
const FIXTURE_WORLD_SEED = 424242;
const FIXTURE_ART_SEED = 99;
/** The format every save before the library carried. */
const PRE_LIBRARY_SAVE_VERSION = '1.1.0';
const FIXTURE_SAVED_AT = '2026-10-01T12:00:00.000Z';
/** What a session of paid spins adds to the slots jackpot pool. */
const PAID_SPINS_POOL_CONTRIBUTION = 12.5;
const PLAYED_SLOTS_JACKPOT_POOL = JACKPOT_FLOOR + PAID_SPINS_POOL_CONTRIBUTION;
const TOWN_SQUARE_TILE = { x: 120, y: 96 } as const;
const GOBLIN_KILLS = 23;
const RAT_KILLS = 9;
const BOSS_KILLS = 1;

/** A party between them, as `snapPlayer` writes them. */
export interface FixtureParty {
  readonly humanSnap: PlayerSnapshot;
  readonly catSnap: PlayerSnapshot;
}

/** One save and the songs the backfill must unlock from it, exactly. */
export interface BackfillFixture {
  readonly name: string;
  readonly save: Record<string, unknown>;
  readonly expected: readonly MusicTrackId[];
}

const NO_ACHIEVEMENTS = {
  unlocked: [],
  presentations: [],
  recentEvents: [],
  menuUnseen: 0,
} as const;

/** The persisted state of the Over City on the party's arrival, before they have done anything. */
function townArrivalState(): Record<string, unknown> {
  return {
    bossRoom: {
      rooms: [],
      enteredRoomIndices: [],
      humanIsInsider: [],
      catIsInsider: [],
      unenteredRegenDelay: [],
      regenNoticeGiven: [],
    },
    arena: {
      arenaLocked: false,
      arenaPhase2Active: false,
      arenaStairwellUnlocked: false,
      entryWindowTimer: 0,
      humanIsInsider: false,
      catIsInsider: false,
    },
    treasureChests: { chests: [] },
    defendQuest: {
      questStatuses: [],
      phase: 'inactive',
      approachTimer: 0,
      defenseTimer: 0,
      spawnTimer: 0,
      woodRespawnTimer: 0,
      woodPileAvailable: false,
      barriers: [],
      pendingBuild: null,
      audienceAbsenceFrames: 0,
      encounterAborted: false,
      npcHp: 40,
      npcMarkerType: 'exclamation',
    },
    cloggedBathroom: { phase: 'unmet', explainerSeen: false },
    stealthKeySnatch: { phase: 'unmet', explainerSeen: false },
    spiderQuest: {
      phase: 'inactive',
      spiderEggOpened: false,
      scientistDead: false,
      hackingDone: false,
      machineryForcedOff: false,
      playerLocked: false,
      roomLocked: false,
      fightAborted: false,
      entryWindowTimer: 0,
      humanIsInsider: false,
      catIsInsider: false,
      lifeMachines: [],
      keyboardHero: {
        hitCount: 0,
        missCount: 0,
        failed: false,
        completed: false,
        nextChartIndex: 0,
      },
    },
    circusQuest: {
      questStatuses: [['the_show_must_go_on', 'available']],
      phase: 'awaiting_intro',
      waveIndex: 0,
    },
    murderQuest: {
      questStatuses: [['krasue_murders', 'available']],
      phase: 'gumgum_waiting',
      swarmCleared: false,
      swarmStarted: false,
      swarmDefeatedBaseline: 0,
      swarmSpawnQueue: [],
    },
    bounty: null,
    circusQuestProgress: {
      stage: 'not_started',
      heatherSlain: false,
      mongoKidnapped: false,
      bigTopPotionGiven: false,
      bigTopEncorePaid: false,
    },
    anchorQuestProgress: {
      status: 'available',
      tinker: 'offered',
      hilda: 'offered',
      temple: 'offered',
      hildaRepairedTypes: [],
      templeVerminRemaining: 0,
    },
    murderQuestProgress: {
      stage: 'not_started',
      wellClueFound: false,
      homeClueFound: false,
      roostClueFound: false,
      quillNamed: false,
      officeSceneSeen: false,
      evidenceOwed: [],
      swarmKrasueDefeated: 0,
    },
    journal: { pinnedTrackerId: null, pinSource: null },
    bountyProgress: {
      phase: 'available',
      typeOrder: ['skeleton_lord', 'evil_clown', 'dark_knight', 'rock_golem', 'mantid'],
      cycleIndex: 0,
      namesByType: {
        evil_clown: ['Giggles', 'Jangles', 'Bubbles', 'Grinner'],
        mantid: ['Snips', 'Mandible', 'Thresher', 'Sickle'],
        skeleton_lord: ['Knuckles', 'Gravelow', 'Phalanx', 'Hollowcrown'],
        dark_knight: ['Ironwake', 'Sir Malloch', 'Sir Craven', 'Blackgard'],
        rock_golem: ['Basalt', 'Knapper', 'Crag', 'Shale'],
      },
      nameCursorByType: {
        evil_clown: 0,
        mantid: 0,
        skeleton_lord: 0,
        dark_knight: 0,
        rock_golem: 0,
      },
      currentTypeId: null,
      currentName: null,
      currentSiteIndex: null,
      lastSiteIndex: null,
      bountiesCompleted: 0,
      pendingPayoutCoins: 0,
    },
    clubMembership: {
      hasDesperadoPass: false,
      casinoShoe: null,
      casinoHintsEnabled: null,
      pokerReads: {},
      pokerNotes: {},
      pokerFast: false,
      pokerShowCards: false,
      escortLevelId: null,
      slotsJackpotPool: JACKPOT_FLOOR,
      slotsTurbo: false,
    },
    shopStock: { offsets: {}, ticksSinceRestock: 0 },
    townMemory: {
      residentTalks: [],
      clearedRooms: [],
      clearedCamps: [],
      paidOutInteriorProps: [],
    },
    mercenaryRoster: { active: null, lastDeceased: null },
    mongoPetState: {
      hp: 35,
      regenFrames: 0,
      scaledAgainstMaxHp: 35,
      summonLocked: false,
      restingUntilFull: false,
    },
    mordecaiDebrief: {},
    tacticsNoticesSeen: [],
    doomsday: { stage: 'inactive', remainingMs: null, crystalTile: null },
    krakarenKilled: false,
    bigRoosterKilled: false,
    bigRoosterBossRoomIdx: -1,
  };
}

function townSave(
  party: FixtureParty,
  generatorVersion: number,
  persisted: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: PRE_LIBRARY_SAVE_VERSION,
    savedAt: FIXTURE_SAVED_AT,
    levelId: 'level3',
    ...party,
    mongoUnlocked: true,
    humanAchievements: NO_ACHIEVEMENTS,
    catAchievements: NO_ACHIEVEMENTS,
    world: {
      generatorVersion,
      worldSeed: FIXTURE_WORLD_SEED,
      artSeed: FIXTURE_ART_SEED,
      safeRoomTile: TOWN_SQUARE_TILE,
      levelTimerFrames: null,
      persisted,
    },
    ...extra,
  };
}

/**
 * Floors 1 and 2 as the stairs down to floor 3 prove them, before any side
 * content, with the tutorial a floor-3 party can never go back to.
 */
const DUNGEON_SONGS_TO_FLOOR_3 = [
  'tutorial_island',
  'bg_level_1',
  'bg_level_2',
  'boss_music_1',
  'boss_music_2',
  'boss_music_3',
  'fix_the_plumbing_music',
  'stealth_music',
] as const satisfies readonly MusicTrackId[];

const CLUB_SONGS = [
  'desperado_club_1',
  'desperado_club_2',
  'desperado_club_3',
  'desperado_club_4',
] as const satisfies readonly MusicTrackId[];

const CASINO_SONGS = [
  'casino_background_jazz_1',
  'casino_background_jazz_2',
  'casino_background_jazz_3',
  'casino_background_jazz_4',
] as const satisfies readonly MusicTrackId[];

/**
 * The four saves the backfill is held to. `staleGeneratorVersion` is a world
 * generator older than this build's, the case `parseSavedWorld` drops the
 * whole world for.
 */
export function backfillFixtures(
  party: FixtureParty,
  currentGeneratorVersion: number,
  staleGeneratorVersion: number,
): readonly BackfillFixture[] {
  const bigRoosterSlainParty = {
    humanSnap: { ...party.humanSnap, desperadoPassTattoo: true },
    catSnap: { ...party.catSnap, desperadoPassTattoo: true },
  };

  const clubNight = townArrivalState();
  clubNight.clubMembership = {
    hasDesperadoPass: true,
    casinoShoe: null,
    casinoHintsEnabled: true,
    pokerReads: {},
    pokerNotes: {},
    pokerFast: false,
    pokerShowCards: false,
    escortLevelId: null,
    slotsJackpotPool: PLAYED_SLOTS_JACKPOT_POOL,
    slotsTurbo: false,
  };

  return [
    {
      name: 'a save from the tutorial',
      save: {
        version: PRE_LIBRARY_SAVE_VERSION,
        savedAt: FIXTURE_SAVED_AT,
        levelId: 'tutorial',
        ...party,
        humanAchievements: {
          ...NO_ACHIEVEMENTS,
          unlocked: ['first_kill'],
        },
        catAchievements: NO_ACHIEVEMENTS,
      },
      expected: ['tutorial_island'],
    },
    {
      name: 'the stairs save down to floor 2, written before it carried achievements',
      save: {
        version: PRE_LIBRARY_SAVE_VERSION,
        savedAt: FIXTURE_SAVED_AT,
        levelId: 'level2',
        ...bigRoosterSlainParty,
        mongoUnlocked: false,
        gameStats: {
          killsByType: [
            ['Goblin', GOBLIN_KILLS],
            ['Rat', RAT_KILLS],
            ['The Trash Gremlin', BOSS_KILLS],
            ['Big Rooster', BOSS_KILLS],
          ],
          potionsUsed: 4,
          bossesDefeated: 2,
          damageDealt: 3100,
          damageTaken: 870,
          goldEarned: 410,
          hirelingsHired: 0,
          hirelingsLost: 0,
          deaths: 1,
          framesPlayed: 162000,
        },
      },
      expected: ['tutorial_island', 'bg_level_1', 'bg_level_2', 'boss_music_1', 'boss_music_2'],
    },
    {
      name: 'a floor-3 save from a night at the Desperado Club, on an older generator',
      save: townSave(bigRoosterSlainParty, staleGeneratorVersion, clubNight, {
        humanAchievements: { ...NO_ACHIEVEMENTS, unlocked: ['members_only'] },
      }),
      expected: [
        ...DUNGEON_SONGS_TO_FLOOR_3,
        'town_music_1',
        'town_music_2',
        'riverside_welcome',
        ...CLUB_SONGS,
        ...CASINO_SONGS,
      ],
    },
    {
      name: 'a floor-3 save from the town square, with nothing done off the forced route',
      save: townSave(bigRoosterSlainParty, currentGeneratorVersion, townArrivalState(), {}),
      expected: [...DUNGEON_SONGS_TO_FLOOR_3, 'town_music_1', 'town_music_2', 'riverside_welcome'],
    },
  ];
}
