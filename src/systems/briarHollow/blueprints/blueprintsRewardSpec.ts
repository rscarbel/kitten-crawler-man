/**
 * What "The Borrowed Blueprints"' quest-complete screen says: the saw and the
 * rope walk, upgraded for good, with what each now does in numbers read from
 * the constants the sawmill itself works by, so the promise on screen is the
 * machine's behaviour. Beside them, the construction contracts Wendell now
 * hands out.
 */

import type { BlueprintsStationId } from '../../../core/blueprintsQuestPhase';
import type { Rect } from '../../../ui/core/geom';
import { drawBlueprintsQuestIcon } from '../../../ui/icons/blueprintsQuestIcons';
import { drawConstructionIcon } from '../../../ui/icons/constructionIcon';
import { iconSquare } from '../../../ui/icons/iconSquare';
import { drawRopeCoilGlyph, drawSawBladeGlyph } from '../../../ui/icons/stationGlyphs';
import type { QuestRewardSpec, RewardUnlockCard } from '../../../ui/questReward/types';
import { PLAIN_WOOD_PER_PRESS } from '../processingStations';
import { BOARDS_PER_WOOD, MANUAL_PROCESS_SECONDS, ROPE_PER_WOOD } from '../services/woodProcessing';
import { BLUEPRINTS_QUEST_NAME } from './blueprintsProgress';
import { UPGRADED_WOOD_PER_PRESS } from './StationUpgrades';

/** The heading over the upgraded stations' cards. */
export const BLUEPRINTS_REWARDS_HEADING = 'PERMANENT UPGRADES';

/** Fenna's word on the finished machines, in her own voice. */
const FENNA_QUOTE =
  "A saw that eats logs like butter, and a rope walk that don't need three of us on the crank.";
const FENNA = 'Fenna';

/** One upgraded station as the screen lists it. */
export interface StationReward {
  readonly station: BlueprintsStationId;
  readonly name: string;
  /** What one press now takes in, against a plain station's. */
  readonly intake: string;
  /** What one press now puts out, against a plain station's. */
  readonly output: string;
}

/** A press's length as the screen says it: "1.2s". */
const PRESS_SECONDS_TEXT = `${MANUAL_PROCESS_SECONDS}s`;
const OUTPUT_MULTIPLIER = UPGRADED_WOOD_PER_PRESS / PLAIN_WOOD_PER_PRESS;

/** The line under the reward cards: the press is no slower, only fuller. */
export const BLUEPRINTS_REWARDS_FOOTNOTE = `Same ${PRESS_SECONDS_TEXT} press, ${OUTPUT_MULTIPLIER}x the output. Yours for good.`;

/** What each upgraded station now does, worded from the constants the sawmill works by. */
export function blueprintsStationRewards(): readonly StationReward[] {
  const intake = `${UPGRADED_WOOD_PER_PRESS} wood per press (was ${PLAIN_WOOD_PER_PRESS})`;
  return [
    {
      station: 'saw',
      name: 'Upgraded Saw',
      intake,
      output: `${UPGRADED_WOOD_PER_PRESS * BOARDS_PER_WOOD} boards a press (was ${PLAIN_WOOD_PER_PRESS * BOARDS_PER_WOOD})`,
    },
    {
      station: 'ropeWalk',
      name: 'Upgraded Rope Walk',
      intake,
      output: `${UPGRADED_WOOD_PER_PRESS * ROPE_PER_WOOD} rope a press (was ${PLAIN_WOOD_PER_PRESS * ROPE_PER_WOOD})`,
    },
  ];
}

const FULL_TURN = Math.PI * 2;
const MS_PER_SECOND = 1000;
const SAW_SPIN_TURNS_PER_SECOND = 0.25;

/** The saw blade turning, as the upgraded bench's blade does. */
function drawSpinningSawIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const turns = (performance.now() / MS_PER_SECOND) * SAW_SPIN_TURNS_PER_SECOND;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(turns * FULL_TURN);
  drawSawBladeGlyph(ctx, 0, 0, size / 2);
  ctx.restore();
}

function drawRopeIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  drawRopeCoilGlyph(ctx, x + size / 2, y + size / 2, size / 2);
}

/** Wendell's repeatable jobs, opened by finishing the quest; the rate is the contracts' own constant. */
export function constructionContractsCard(): RewardUnlockCard {
  return {
    renderIcon: drawConstructionIcon,
    title: 'Construction contracts from Wendell',
    body: [
      { text: 'Paid repair jobs', emphasis: true },
      { text: 'In Skyfowl Town and Briar Hollow' },
    ],
    condition: 'Ask Wendell at Plumbline Farm',
  };
}

function stationCard(reward: StationReward): RewardUnlockCard {
  return {
    renderIcon: reward.station === 'saw' ? drawSpinningSawIcon : drawRopeIcon,
    title: reward.name,
    body: [{ text: reward.intake, emphasis: true }, { text: reward.output }],
  };
}

/**
 * The finished quest's screen. `onDismissed` records that it has been read,
 * so a door visit, a reload or a rewind never raises it again.
 */
export function blueprintsRewardSpec(onDismissed: () => void): QuestRewardSpec {
  return {
    questTitle: BLUEPRINTS_QUEST_NAME,
    renderQuestIcon: (ctx, rect) => drawBlueprintsQuestIcon(ctx, rect, 'quest_blueprints'),
    quote: { text: FENNA_QUOTE, speaker: FENNA },
    sections: [
      {
        kind: 'unlocks',
        heading: BLUEPRINTS_REWARDS_HEADING,
        cards: [...blueprintsStationRewards().map(stationCard), constructionContractsCard()],
      },
    ],
    footnote: BLUEPRINTS_REWARDS_FOOTNOTE,
    onDismissed,
  };
}
