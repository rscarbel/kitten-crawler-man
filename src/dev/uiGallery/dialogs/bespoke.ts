import {
  ACHIEVEMENT_DEFS,
  getBoxContents,
  type BoxContents,
  type LootBox,
} from '../../../core/AchievementManager';
import { AchievementNotification } from '../../../ui/AchievementNotification';
import type { Surface, Ui } from '../../../ui/core/UiRoot';
import { drawLoadingScreen } from '../../../ui/LoadingScreen';
import { LootBoxOpener } from '../../../ui/LootBoxOpener';
import { syncViewport } from './conversation';
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
        title: 'The Over City',
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

/** Frames into a box's shake at which the lid has just blown off. */
const MID_OPEN_TICKS = 48;
/** Frames into a box at which its reward lines are popping in. */
const REVEALING_TICKS = 84;

const GALLERY_BOXES: LootBox[] = [
  { id: 1, tier: 'Bronze', category: 'Adventurer', fromAchievement: 'first_blood' },
  { id: 2, tier: 'Gold', category: 'Spicy', fromAchievement: 'boss_slayer' },
];

function galleryContents(box: LootBox): BoxContents {
  const shared = getBoxContents(box.tier, box.category);
  if (box.tier !== 'Gold') return shared;
  return { ...shared, itemRewards: [{ id: 'goblin_dynamite', quantity: 2 }] };
}

/** A loot-box opener on the queue's last box, run `ticks` frames in, or skipped to its reveal. */
function lootBoxFixture(name: string, ticks: number | 'revealed'): DialogFixture {
  const noop = (): void => undefined;
  let opener: LootBoxOpener | null = null;
  const prepared = (): LootBoxOpener => {
    if (opener !== null) return opener;
    const created = new LootBoxOpener();
    created.startQueue(GALLERY_BOXES, 'Cat', galleryContents, noop, noop);
    created.skip();
    created.skip();
    if (ticks === 'revealed') created.skip();
    else for (let tick = 0; tick < ticks; tick++) created.tick();
    opener = created;
    return created;
  };
  return paintedFixture(name, (ui) => {
    prepared().paint(ui, ui.screen.w, ui.screen.h);
  });
}

/** Past the card's fade-in, so the OK button is live. */
const ACHIEVEMENT_SHOWN_TICKS = 24;

function achievementFixture(name: string): DialogFixture {
  let notification: AchievementNotification | null = null;
  const prepared = (): AchievementNotification => {
    if (notification !== null) return notification;
    const created = new AchievementNotification();
    created.reset();
    for (let tick = 0; tick < ACHIEVEMENT_SHOWN_TICKS; tick++) created.tick();
    notification = created;
    return created;
  };
  return paintedFixture(name, (ui) => {
    prepared().paint(ui, ACHIEVEMENT_DEFS.boss_slayer, 'Human', () => undefined);
  });
}

export const FIXTURES: readonly DialogFixture[] = [
  loadingFixture(
    'loading-screen',
    LOADING_PROGRESS_MID,
    'Some shopkeepers buy as well as sell. Look for the Sell tab at the counter.',
  ),
  loadingFixture('loading-screen-done', 1, undefined),
  lootBoxFixture('loot-box-opening', MID_OPEN_TICKS),
  lootBoxFixture('loot-box-revealing', REVEALING_TICKS),
  lootBoxFixture('loot-box-revealed', 'revealed'),
  achievementFixture('achievement-notification'),
];
