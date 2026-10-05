/**
 * Fixtures for the end screens: death, level complete, run complete, quest
 * reward and the treasure chest, each over its real model with data shaped
 * like a real run, plus the mid-timeline states worth judging.
 */

import { createAnchorQuestProgress } from '../../../core/AnchorQuestProgress';
import { blueprintsRewardSpec } from '../../../systems/briarHollow/blueprints/blueprintsRewardSpec';
import type { TreasureChest } from '../../../systems/TreasureChestSystem';
import { travelUnlocksSection } from '../../../systems/travel/travelDestinations';
import { ChestRewardDialog, type ChestLootSplit } from '../../../ui/ChestRewardDialog';
import type { Surface } from '../../../ui/core/UiRoot';
import { DeathScreen, type RespawnMode } from '../../../ui/DeathScreen';
import { drawLootBoxRewardIcon } from '../../../ui/icons/rewardIcons';
import { QuestRewardScreen } from '../../../ui/questReward/QuestRewardScreen';
import {
  bagItemRewardLine,
  itemIconPainter,
  partyXpSections,
} from '../../../ui/questReward/rewardLines';
import type { QuestRewardSpec } from '../../../ui/questReward/types';
import { chestRewardSurface } from '../../../ui/screens/dialogs/chestRewardScreen';
import { deathScreenSurface } from '../../../ui/screens/dialogs/deathScreen';
import { LevelCompleteScreen } from '../../../ui/screens/dialogs/LevelCompleteScreen';
import { questRewardSurface } from '../../../ui/screens/dialogs/questRewardScreen';
import { RunCompleteScreen, type RunSummary } from '../../../ui/screens/dialogs/RunCompleteScreen';
import type { DialogFixture, FixtureRig } from './fixture';

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

function deathFixture(name: string, explanation: string, mode: RespawnMode): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new DeathScreen();
      model.activate(explanation, mode);
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
  'Brindled Vespa': 61,
};

const POTIONS_GIVEN = 3;
const BURGERS_GIVEN = 5;

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
  mongoLevel: 19,
  totalKills: 1_342,
  bossesDefeated: 9,
  hirelingsHired: 5,
  hirelingsLost: 2,
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

const DEFEND_SPEC: QuestRewardSpec = {
  questTitle: 'Defend the Goblin Mother',
  renderQuestIcon: itemIconPainter('goblin_dynamite'),
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
          name: 'Silver Loot Box',
          count: 1,
          renderIcon: (ctx, rect) => drawLootBoxRewardIcon(ctx, rect, 'Silver'),
          note: 'Open it in a Safe Room.',
        },
        bagItemRewardLine('health_potion', POTIONS_GIVEN),
        bagItemRewardLine('skill_book_night_vision', 1, {
          describe: true,
          note: "In Donut's bag.",
        }),
      ],
    },
  ],
  footnote: 'The nursery stays open to you for the rest of the floor.',
};

const PLEA_SPEC: QuestRewardSpec = {
  questTitle: "Briar Hollow's Plea",
  sections: [
    ...partyXpSections({ human: 2000, cat: 1934 }),
    { kind: 'coins', amount: 500 },
    { kind: 'items', items: [bagItemRewardLine('hamburger', BURGERS_GIVEN)] },
    travelUnlocksSection(['briar_hollow'], { anchor: createAnchorQuestProgress() }),
  ],
};

function questRewardFixture(
  name: string,
  spec: QuestRewardSpec,
  frameCount: number,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const model = new QuestRewardScreen(null);
      model.open(spec);
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
    guardBounds: null,
    bossRoomIndex: null,
    hadMobs: false,
  };
}

const SAMPLE_SPLIT: ChestLootSplit = {
  humanLoot: {
    coins: 140,
    items: [
      { id: 'health_potion', quantity: 2 },
      { id: 'riveted_bracers', quantity: 1 },
    ],
  },
  catLoot: {
    coins: 135,
    items: [{ id: 'speed_fizz', quantity: 1 }],
  },
  customCatEntries: ['Mongo joins the party'],
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

export const FIXTURES: readonly DialogFixture[] = [
  deathFixture('death', 'A goblin stabbed you. Repeatedly. With enthusiasm.', 'checkpoint'),
  deathFixture(
    'death-long-explanation',
    'The Grotesque Spider slammed down on you from the ceiling, which is a sentence nobody should ever have to read about themselves. Your body has been filed under "abstract art". The viewers at home are already making it into a looping clip with a sad trombone.',
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
  questRewardFixture('quest-reward-revealing', DEFEND_SPEC, QUEST_REWARD_REVEALING_FRAMES),
  questRewardFixture('quest-reward', DEFEND_SPEC, QUEST_REWARD_SETTLED_FRAMES),
  questRewardFixture('quest-reward-unlocks', PLEA_SPEC, QUEST_REWARD_SETTLED_FRAMES),
  questRewardFixture(
    'quest-reward-blueprints',
    blueprintsRewardSpec(() => undefined),
    QUEST_REWARD_SETTLED_FRAMES,
  ),
  chestFixture('chest-opening', 'wooden', SAMPLE_SPLIT, CHEST_OPENING_TICKS),
  chestFixture('chest-reward', 'silver', SAMPLE_SPLIT, CHEST_OPENED_TICKS),
  chestFixture('chest-empty', 'wooden', null, CHEST_OPENED_TICKS),
];
