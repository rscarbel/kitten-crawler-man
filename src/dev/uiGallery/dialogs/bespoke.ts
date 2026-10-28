import { CAROLINE_CHARACTER_NAME } from '../../../ai/characters';
import { ACHIEVEMENT_DEFS, type AwardDef } from '../../../core/progression/AchievementManager';
import { ITEM_DEF, isItemId, type ItemId } from '../../../core/items/defs/ItemDefs';
import { RARITIES, type Rarity } from '../../../core/items/defs/rarity';
import {
  CHEST_SOURCE_TITLES,
  type GrantedLine,
  type RewardPresentation,
} from '../../../loot/rewardChest';
import type { Surface, Ui } from '../../../ui/core/UiRoot';
import { drawLoadingScreen } from '../../../ui/LoadingScreen';
import { COLLECT_GUARD_FRAMES, chestTimeline } from '../../../ui/screens/rewardChest/chestTimeline';
import { RewardChestScreen } from '../../../ui/screens/rewardChest/RewardChestScreen';
import { galleryGated, syncViewport } from './conversation';
import type { DialogFixture } from './fixture';

/** A full-screen fixture surface that paints with `paint` while shown. */
function paintedFixture(name: string, paint: (ui: Ui) => void): DialogFixture {
  return {
    name,
    surfaces: (shown): readonly Surface[] => [
      {
        id: `bespoke-${name}`,
        band: 'modal',
        haltsWorld: true,
        isOpen: shown,
        render: (ui) => {
          syncViewport(ui);
          paint(ui);
        },
      },
    ],
  };
}

const LOADING_ELAPSED_MS = 2400;
/** Partway through a load, with the bar past half. */
const LOADING_PROGRESS_MID = 0.56;

function loadingFixture(name: string, progress: number, tip: string | undefined): DialogFixture {
  return paintedFixture(name, (ui) => {
    drawLoadingScreen(
      ui.ctx,
      {
        title: 'Taloncrest',
        kicker: 'Floor 3',
        progress,
        status: progress < 1 ? 'Painting the streets' : 'Ready',
        tip,
        timeMs: LOADING_ELAPSED_MS,
      },
      ui.screen.w,
      ui.screen.h,
    );
  });
}

/** One piece of gear of `rarity` from the catalogue, or null when it has none. */
function gearOf(rarity: Rarity): ItemId | null {
  for (const id of Object.keys(ITEM_DEF)) {
    if (isItemId(id) && ITEM_DEF[id].rarity === rarity) return id;
  }
  return null;
}

const GALLERY_COINS: Readonly<Record<Rarity, number>> = {
  Common: 12,
  Uncommon: 26,
  Rare: 44,
  Epic: 75,
  Legendary: 120,
  Divine: 215,
};

const GALLERY_POTIONS: Readonly<Record<Rarity, number>> = {
  Common: 2,
  Uncommon: 3,
  Rare: 4,
  Epic: 5,
  Legendary: 6,
  Divine: 8,
};

/** What a chest of `rarity` might hold: coins, potions, and gear of its rarity from Rare up. */
function galleryLines(rarity: Rarity): GrantedLine[] {
  const lines: GrantedLine[] = [
    { kind: 'coins', amount: GALLERY_COINS[rarity] },
    { kind: 'item', id: 'health_potion', quantity: GALLERY_POTIONS[rarity] },
  ];
  const index = RARITIES.indexOf(rarity);
  const tiers = index > 0 ? [RARITIES[index - 1], rarity] : [rarity];
  for (const tier of tiers) {
    if (tier === 'Common') continue;
    const gear = gearOf(tier);
    if (gear !== null) lines.push({ kind: 'item', id: gear, quantity: 1 });
  }
  return lines;
}

const GALLERY_AWARD: Readonly<Record<Rarity, AwardDef>> = {
  Common: ACHIEVEMENT_DEFS.first_kill,
  Uncommon: ACHIEVEMENT_DEFS.dungeon_kills_50,
  Rare: ACHIEVEMENT_DEFS.night_shift,
  Epic: ACHIEVEMENT_DEFS.dungeon_kills_200,
  Legendary: ACHIEVEMENT_DEFS.dungeon_kills_1000,
  Divine: ACHIEVEMENT_DEFS.boss_slayer,
};

function awardPresentation(
  rarity: Rarity,
  award: AwardDef = GALLERY_AWARD[rarity],
): RewardPresentation {
  const rewards = galleryLines(rarity);
  if (award.id === 'dungeon_kills_200') rewards.push({ kind: 'companion', id: 'deinonychus' });
  return {
    origin: { kind: 'award', award },
    title: award.name,
    subtitle: award.description,
    crawler: rarity === 'Epic' || rarity === 'Divine' ? 'cat' : 'human',
    rarity,
    rewards,
  };
}

/** A chest holding more lines than a phone's tray shows, so the last cell folds the rest. */
function crowdedPresentation(): RewardPresentation {
  const gear = RARITIES.map(gearOf).filter((id) => id !== null);
  const rewards: GrantedLine[] = [
    ...galleryLines('Divine'),
    ...gear.map((id): GrantedLine => ({ kind: 'item', id, quantity: 1 })),
    { kind: 'duplicate', id: gear[0] ?? 'health_potion', coins: GALLERY_COINS.Rare },
  ];
  return {
    ...awardPresentation('Divine'),
    origin: { kind: 'chest', source: 'challenge' },
    title: 'Rat Race',
    subtitle: 'Kill five rats in ninety seconds without taking a hit.',
    rewards,
  };
}

const AI_AWARD: AwardDef = {
  id: 'ai:retreated-from-a-rat',
  name: 'Retreated From A Rat',
  description: 'You retreated from the weakest creature on this floor. Distance covered: 41 tiles.',
  rarity: 'Rare',
  awardedBy: CAROLINE_CHARACTER_NAME,
  awardedAt: 0,
};

/** Where in its reveal a chest fixture is captured. */
type ChestMoment = 'closed' | 'burst' | 'revealed';

/** Frames past landing at which the closed chest idles with its seams lit. */
const CLOSED_AFTER_LANDING = 24;
/** Frames past the lid's burst at which the fountain and rays are at their fullest. */
const BURST_AFTER_LID = 22;

function chestFixture(
  name: string,
  presentations: readonly RewardPresentation[],
  moment: ChestMoment,
): DialogFixture {
  let screen: RewardChestScreen | null = null;
  const prepared = (): RewardChestScreen => {
    if (screen !== null) return screen;
    const created = new RewardChestScreen(null);
    const queue = [...presentations];
    created.bindSource({
      take: () => queue.shift() ?? null,
      waiting: () => queue.length,
      closed: () => undefined,
    });
    const first = presentations.length > 0 ? presentations[0] : null;
    if (first !== null) {
      const timeline = chestTimeline(first.rarity, first.rewards);
      const frames =
        moment === 'closed'
          ? timeline.dropEnd + CLOSED_AFTER_LANDING
          : moment === 'burst'
            ? timeline.anticipationEnd + BURST_AFTER_LID
            : 0;
      created.open();
      for (let frame = 0; frame < frames; frame++) created.tick();
      if (moment === 'revealed') {
        created.skip();
        for (let frame = 0; frame < COLLECT_GUARD_FRAMES; frame++) created.tick();
      }
    }
    screen = created;
    return created;
  };
  return {
    name,
    surfaces: (shown): readonly Surface[] => {
      const live = prepared();
      return [galleryGated(live.surface(`bespoke-${name}`), shown)];
    },
  };
}

const RARITY_FIXTURES: readonly DialogFixture[] = RARITIES.flatMap((rarity) => [
  chestFixture(
    `reward-chest-${rarity.toLowerCase()}-closed`,
    [awardPresentation(rarity)],
    'closed',
  ),
  chestFixture(
    `reward-chest-${rarity.toLowerCase()}-revealed`,
    [awardPresentation(rarity)],
    'revealed',
  ),
]);

export const FIXTURES: readonly DialogFixture[] = [
  loadingFixture(
    'loading-screen',
    LOADING_PROGRESS_MID,
    'Some shopkeepers buy as well as sell. Look for the Sell tab at the counter.',
  ),
  loadingFixture('loading-screen-done', 1, undefined),
  ...RARITY_FIXTURES,
  chestFixture('reward-chest-epic-burst', [awardPresentation('Epic')], 'burst'),
  chestFixture('reward-chest-divine-burst', [awardPresentation('Divine')], 'burst'),
  chestFixture(
    'reward-chest-ai-award',
    [awardPresentation('Rare', AI_AWARD), awardPresentation('Common')],
    'revealed',
  ),
  chestFixture('reward-chest-crowded', [crowdedPresentation()], 'revealed'),
  chestFixture(
    'reward-chest-wheel-prize',
    [
      {
        origin: { kind: 'chest', source: 'wheel' },
        title: CHEST_SOURCE_TITLES.wheel,
        subtitle: '',
        crawler: 'human',
        rarity: 'Legendary',
        rewards: galleryLines('Legendary'),
      },
    ],
    'revealed',
  ),
];
