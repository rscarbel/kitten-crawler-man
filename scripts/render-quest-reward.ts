#!/usr/bin/env tsx
/**
 * Review renders of the shared quest-complete screen, settled, for each shape
 * of reward it is asked to show, at a desktop window and two phone windows,
 * into `preview/quest-reward/`.
 *
 * Drawn through the same `QuestRewardScreen` the scenes hold, at a device
 * pixel ratio of 2, so what is judged here is the screen as shipped. Every
 * image must show nothing overflowing the panel and nothing overlapping.
 *
 *   npm run render:quest-reward
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

installCanvasGlobals();

const { setViewportSize } = await import('../src/core/Viewport.js');
const { QuestRewardScreen } = await import('../src/ui/questReward/QuestRewardScreen.js');
const { bagItemRewardLine, itemIconPainter, partyXpSections } =
  await import('../src/ui/questReward/rewardLines.js');
const { drawLootBoxRewardIcon } = await import('../src/ui/icons/rewardIcons.js');
const { travelUnlocksSection, unlockedDestinationIds } =
  await import('../src/systems/travel/travelDestinations.js');
const { ANCHOR_QUEST_NAME, createAnchorQuestProgress } =
  await import('../src/core/AnchorQuestProgress.js');
const { createCircusQuestProgress } = await import('../src/core/CircusQuestProgress.js');
const { createBriarHollowState } = await import('../src/core/briarHollowState.js');
const { blueprintsRewardSpec } =
  await import('../src/systems/briarHollow/blueprints/blueprintsRewardSpec.js');
type QuestRewardSpec = import('../src/ui/questReward/types.js').QuestRewardSpec;

const DEVICE_PIXEL_RATIO = 2;
const OUT_DIR = `${PREVIEW_DIR}/quest-reward`;
/** Render frames given to the reveal; far past any screen's settle time. */
const SETTLE_FRAMES = 240;
/** A mid-green stand-in for the world under the screen, so the backdrop's dim reads. */
const WORLD_STAND_IN = '#4d6b3c';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

/**
 * What each crawler lands from the assembly, so the sample screen reads like
 * the real one; the cat's is lower as if she were further along her XP curve.
 */
const SAMPLE_ANCHOR_XP = { human: 600, cat: 540 } as const;
const SAMPLE_MURDER_XP = { human: 800, cat: 800 } as const;
const SAMPLE_DEFEND_XP = { human: 500, cat: 450 } as const;
const SAMPLE_PLEA_XP = { human: 2000, cat: 1934 } as const;

/** The anchor's own screen once both other questlines are done: every destination at once. */
function anchorEveryDestinationSpec(): QuestRewardSpec {
  const circus = createCircusQuestProgress();
  circus.stage = 'complete';
  const briarHollow = createBriarHollowState();
  briarHollow.quest.phase = 'complete';
  const anchor = createAnchorQuestProgress();
  anchor.status = 'completed';
  const state = { circus, briarHollow, anchor };
  return {
    questTitle: ANCHOR_QUEST_NAME,
    renderQuestIcon: itemIconPainter('wayfinders_anchor'),
    sections: [
      ...partyXpSections(SAMPLE_ANCHOR_XP),
      {
        kind: 'items',
        items: [bagItemRewardLine('wayfinders_anchor', 1, { describe: true })],
      },
      travelUnlocksSection(unlockedDestinationIds(state), state),
    ],
  };
}

const CASES: ReadonlyArray<{ readonly name: string; readonly spec: QuestRewardSpec }> = [
  {
    name: 'a-xp-only',
    spec: { questTitle: 'The Krasue Murders', sections: partyXpSections(SAMPLE_MURDER_XP) },
  },
  {
    name: 'b-xp-coins-items',
    spec: {
      questTitle: 'Defend the Goblin Mother',
      sections: [
        ...partyXpSections(SAMPLE_DEFEND_XP),
        { kind: 'coins', amount: 50 },
        {
          kind: 'items',
          items: [
            {
              name: 'Silver Loot Box',
              count: 1,
              renderIcon: (ctx, x, y, size) => drawLootBoxRewardIcon(ctx, x, y, size, 'Silver'),
              note: 'Open it in a Safe Room.',
            },
            bagItemRewardLine('health_potion', 3),
          ],
        },
      ],
    },
  },
  { name: 'c-blueprints-unlocks', spec: blueprintsRewardSpec(() => undefined) },
  {
    name: 'd-plea-conditional-unlock',
    spec: {
      questTitle: "Briar Hollow's Plea",
      sections: [
        ...partyXpSections(SAMPLE_PLEA_XP),
        { kind: 'coins', amount: 500 },
        {
          kind: 'items',
          items: [bagItemRewardLine('hamburger', 5), bagItemRewardLine('hollow_stew', 3)],
        },
        travelUnlocksSection(['briar_hollow'], { anchor: createAnchorQuestProgress() }),
      ],
    },
  },
  {
    name: 'f-anchor-every-destination',
    spec: anchorEveryDestinationSpec(),
  },
  {
    name: 'e-long-title',
    spec: {
      questTitle: 'The Extraordinarily Long-Winded Affair of the Seventeen Borrowed Wheelbarrows',
      renderQuestIcon: itemIconPainter('skill_book_night_vision'),
      sections: [
        { kind: 'xp', amount: 1934, recipient: 'Carl' },
        { kind: 'xp', amount: 2000, recipient: 'Donut' },
        {
          kind: 'items',
          items: [
            bagItemRewardLine('skill_book_night_vision', 1, {
              describe: true,
              note: "In Donut's bag.",
            }),
          ],
        },
      ],
    },
  },
];

for (const viewport of VIEWPORTS) {
  setViewportSize(viewport.width, viewport.height);
  for (const testCase of CASES) {
    const canvas = createCanvas(
      viewport.width * DEVICE_PIXEL_RATIO,
      viewport.height * DEVICE_PIXEL_RATIO,
    );
    const nodeCtx = canvas.getContext('2d');
    nodeCtx.scale(DEVICE_PIXEL_RATIO, DEVICE_PIXEL_RATIO);
    const ctx = asGameContext(nodeCtx);
    const screen = new QuestRewardScreen(null);
    screen.open(testCase.spec);
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
      ctx.fillStyle = WORLD_STAND_IN;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      screen.render(ctx);
    }
    const out = writePreviewPng(
      `${OUT_DIR}/${viewport.name}-${testCase.name}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(`wrote ${out}`);
  }
}
