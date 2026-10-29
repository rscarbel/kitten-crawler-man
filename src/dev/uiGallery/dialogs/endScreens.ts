/**
 * Fixtures for the end screens: death, level complete, run complete, quest
 * reward and the treasure chest, each over its real model with data shaped
 * like a real run, plus the mid-timeline states worth judging.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { createAnchorQuestProgress } from '../../../core/quests/AnchorQuestProgress';
import { blueprintsRewardSpec } from '../../../systems/briarHollow/blueprints/blueprintsRewardSpec';
import type { TreasureChest } from '../../../systems/TreasureChestSystem';
import { travelUnlocksSection } from '../../../systems/travel/travelDestinations';
import { ChestRewardDialog, type ChestLootSplit } from '../../../ui/ChestRewardDialog';
import type { Surface } from '../../../ui/core/UiRoot';
import { DeathScreen, type RespawnMode } from '../../../ui/DeathScreen';
import {
  pickDeathMessage,
  plainDeathMessage,
  type DeathMessage,
} from '../../../ui/DeathExplanations';
import { drawRewardChestIcon } from '../../../ui/icons/rewardIcons';
import { QuestRewardScreen } from '../../../ui/questReward/QuestRewardScreen';
import {
  bagItemRewardLine,
  rewardIconPainter,
  partyXpSections,
} from '../../../ui/questReward/rewardLines';
import type { QuestRewardSpec } from '../../../ui/questReward/types';
import { chestRewardSurface } from '../../../ui/screens/dialogs/chestRewardScreen';
import { deathScreenSurface } from '../../../ui/screens/dialogs/deathScreen';
import { LevelCompleteScreen } from '../../../ui/screens/dialogs/LevelCompleteScreen';
import { questRewardSurface } from '../../../ui/screens/dialogs/questRewardScreen';
import { RunCompleteScreen, type RunSummary } from '../../../ui/screens/dialogs/RunCompleteScreen';
import { screenFadeSurface } from '../../../ui/ScreenFade';
import type { DialogFixture, FixtureRig } from './fixture';
import {
  PET_NAME_SUGGESTIONS,
  PetNameBook,
  parsePetName,
  petWords,
} from '../../../core/party/petNames';

/** Render frames that carry the death fade to full and the button live. */
const DEATH_SETTLED_FRAMES = 60;
/** Past the level-complete button's appearance and fade. */
const LEVEL_COMPLETE_SETTLED_FRAMES = 120;
/** Midway through the run-complete count-up. */
const RUN_COMPLETE_COUNTING_FRAMES = 95;
/** Past the run-complete buttons' fade, with confetti still falling. */
const RUN_COMPLETE_SETTLED_FRAMES = 320;
/** A couple of reward lines in, the rest still to come. */
const QUEST_REWARD_REVEALING_FRAMES = 34;
const QUEST_REWARD_SETTLED_FRAMES = 160;
/** Chest update ticks: still rattling shut, and just burst open. */
const CHEST_OPENING_TICKS = 12;
const CHEST_OPENED_TICKS = 42;
const FRAMES_PER_SECOND = 60;
/** The full-screen fade halfway down, and fully black. */
const FADE_HALF_ALPHA = 0.5;
const FADE_BLACK_ALPHA = 1;
const PLAYED_MINUTES = 197;
const SECONDS_PER_MINUTE = 60;

function frames(count: number): (rig: FixtureRig) => void {
  return (rig) => {
    for (let i = 0; i < count; i++) rig.frame();
  };
}

function gated(shown: () => boolean, surface: Surface): Surface {
  return { ...surface, isOpen: () => shown() && surface.isOpen() };
}

/** Pinned rather than picked, so the gallery renders the same card every run. */
const SHARK_DEATH_SAMPLE_EXPLANATION =
  'Open water belongs to the shark. You were in it for one swim too many.';

function deathFixture(name: string, message: DeathMessage, mode: RespawnMode): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new DeathScreen();
      model.activate(message, mode);
      return [
        deathScreenSurface(model, { id: name, isOpen: shown, onRespawn: () => model.reset() }),
      ];
    },
    interact: frames(DEATH_SETTLED_FRAMES),
  };
}

const SAMPLE_KILLS: Readonly<Record<string, number>> = {
  Goblin: 412,
  Rat: 288,
  Cockroach: 176,
  'Skeleton Warrior': 94,
  'Gravedigger Beetle': 61,
};

const POTIONS_GIVEN = 3;
const BURGERS_GIVEN = 5;

/** A run whose Deinonychus was given a name. */
function namedRun(): PetNameBook {
  const book = new PetNameBook();
  const name = parsePetName(PET_NAME_SUGGESTIONS.deinonychus[0]);
  if (name !== null) book.give('deinonychus', name);
  return book;
}

const SAMPLE_SUMMARY: RunSummary = {
  framesPlayed: PLAYED_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND,
  deaths: 7,
  damageDealt: 184_230,
  damageTaken: 41_877,
  potionsUsed: 63,
  goldEarned: 12_480,
  achievementsUnlocked: 41,
  achievementsTotal: 58,
  humanLevel: 24,
  catLevel: 26,
  deinonychusLevel: 19,
  deinonychusWords: petWords(namedRun(), 'deinonychus'),
  totalKills: 1_342,
  bossesDefeated: 9,
  mercenariesHired: 5,
  mercenariesLost: 2,
  deinonychusPets: 48,
  cowPets: 37,
  midgePets: 12,
  topKills: Object.entries(SAMPLE_KILLS),
};

function runCompleteFixture(name: string, frameCount: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new RunCompleteScreen();
      model.activate(SAMPLE_SUMMARY, {
        onKeepExploring: () => undefined,
        onMainMenu: () => undefined,
      });
      return [gated(shown, model.surface({ id: name }))];
    },
    interact: frames(frameCount),
  };
}

function defendSpec(): QuestRewardSpec {
  return {
    questTitle: 'Defend the Goblin Mother',
    renderQuestIcon: rewardIconPainter('dynamite'),
    quote: {
      text: 'You kept my babies breathing. That is worth more than coin. Take the coin anyway.',
      speaker: 'The Goblin Mother',
    },
    sections: [
      ...partyXpSections({ human: 500, cat: 450 }),
      { kind: 'coins', amount: 50 },
      {
        kind: 'items',
        items: [
          {
            name: 'Uncommon reward chest',
            count: 1,
            renderIcon: (ctx, rect) => drawRewardChestIcon(ctx, rect, 'Uncommon'),
            note: 'One for each crawler.',
          },
          bagItemRewardLine('health_potion', POTIONS_GIVEN),
          bagItemRewardLine('skill_book_warp_speed', 1, {
            describe: true,
            note: `In ${crawlerDisplayName('cat')}'s bag.`,
          }),
        ],
      },
    ],
    footnote: 'The nursery stays open to you for the rest of the floor.',
  };
}

function pleaSpec(): QuestRewardSpec {
  return {
    questTitle: "Briar Hollow's Plea",
    sections: [
      ...partyXpSections({ human: 2000, cat: 1934 }),
      { kind: 'coins', amount: 500 },
      { kind: 'items', items: [bagItemRewardLine('hamburger', BURGERS_GIVEN)] },
      travelUnlocksSection(['briar_hollow'], { anchor: createAnchorQuestProgress() }),
    ],
  };
}

function questRewardFixture(
  name: string,
  spec: () => QuestRewardSpec,
  frameCount: number,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new QuestRewardScreen(null);
      model.open(spec());
      return [gated(shown, questRewardSurface(model, { id: name }))];
    },
    interact: frames(frameCount),
  };
}

function sampleChest(type: TreasureChest['type']): TreasureChest {
  return {
    tileX: 0,
    tileY: 0,
    type,
    state: 'opened',
    loot: null,
    unlockFrame: 0,
    sparkleFrame: 0,
    tryLockedTimer: 0,
    lock: { kind: 'none' },
  };
}

const SAMPLE_SPLIT: ChestLootSplit = {
  humanLoot: {
    coins: 140,
    items: [
      { id: 'health_potion', quantity: 2 },
      { id: 'hearthguard_bracers', quantity: 1 },
    ],
  },
  catLoot: {
    coins: 135,
    items: [{ id: 'speed_fizz', quantity: 1 }],
  },
};

function chestFixture(
  name: string,
  type: TreasureChest['type'],
  split: ChestLootSplit | null,
  ticks: number,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new ChestRewardDialog();
      model.open(sampleChest(type), split);
      for (let i = 0; i < ticks; i++) model.tick();
      return [gated(shown, chestRewardSurface(model, { id: name }))];
    },
  };
}

function fadeFixture(name: string, alpha: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => [gated(shown, screenFadeSurface(name, { alpha: () => alpha }))],
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  fadeFixture('screen-fade-half', FADE_HALF_ALPHA),
  fadeFixture('screen-fade-black', FADE_BLACK_ALPHA),
  deathFixture(
    'death',
    plainDeathMessage('A goblin got you. Repeatedly. With enthusiasm.'),
    'checkpoint',
  ),
  deathFixture(
    'death-with-hint',
    { ...pickDeathMessage('sharkAttack'), explanation: SHARK_DEATH_SAMPLE_EXPLANATION },
    'checkpoint',
  ),
  deathFixture(
    'death-long-explanation',
    plainDeathMessage(
      'The Grotesque Spider slammed down on you from the ceiling, which is a sentence nobody should ever have to read about themselves. Your body has been filed under "abstract art". Somewhere a sad trombone is playing, and it is playing for you.',
    ),
    'floorRestart',
  ),
  {
    name: 'level-complete',
    surfaces: (shown) => {
      const model = new LevelCompleteScreen();
      model.activate('The Dungeon', 'The Dungeon, Level 2', () => undefined);
      return [gated(shown, model.surface({ id: 'level-complete' }))];
    },
    interact: frames(LEVEL_COMPLETE_SETTLED_FRAMES),
  },
  runCompleteFixture('run-complete-counting', RUN_COMPLETE_COUNTING_FRAMES),
  runCompleteFixture('run-complete', RUN_COMPLETE_SETTLED_FRAMES),
  questRewardFixture('quest-reward-revealing', defendSpec, QUEST_REWARD_REVEALING_FRAMES),
  questRewardFixture('quest-reward', defendSpec, QUEST_REWARD_SETTLED_FRAMES),
  questRewardFixture('quest-reward-unlocks', pleaSpec, QUEST_REWARD_SETTLED_FRAMES),
  questRewardFixture(
    'quest-reward-blueprints',
    () => blueprintsRewardSpec(null, () => undefined),
    QUEST_REWARD_SETTLED_FRAMES,
  ),
  chestFixture('chest-opening', 'wooden', SAMPLE_SPLIT, CHEST_OPENING_TICKS),
  chestFixture('chest-reward', 'silver', SAMPLE_SPLIT, CHEST_OPENED_TICKS),
  chestFixture('chest-empty', 'wooden', null, CHEST_OPENED_TICKS),
];
