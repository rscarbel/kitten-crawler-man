/**
 * Builders for the pieces quests put on their reward screen, so every quest
 * names, draws and describes the same reward the same way.
 */

import type { PartyXpApplied } from '../../core/progression/awardXp';
import { ITEM_DEF, type ItemId } from '../../core/items/defs/ItemDefs';
import { crawlerName } from '../../characters/characters';
import { cachedWheelFace, paintWheelFace } from '../../sprites/art/wheelFaceArt';
import { BASE_WHEEL_BOARD, tapedBoard } from '../../systems/casino/wheel/wheelBoard';
import { drawItemIcon } from '../icons/drawItemIcon';
import type { IconPainter, QuestRewardSection, RewardItemLine } from './types';

/** How a bag item's line reads beyond its name and count. */
export interface BagItemLineOptions {
  /** Draw the item's own description under its name. */
  readonly describe?: boolean;
  readonly note?: string;
  /** Fly the item to the bag when the screen closes; false for items that did not go in. */
  readonly flyToBag?: boolean;
}

/** The icon a bag item wears in the inventory. */
export function rewardIconPainter(id: ItemId): IconPainter {
  const item = { ...ITEM_DEF[id], quantity: 1 };
  return (ctx, rect) => drawItemIcon(ctx, rect, item);
}

/** A line for `count` of a bag item, drawn with its inventory icon and name. */
export function bagItemRewardLine(
  id: ItemId,
  count: number,
  options: BagItemLineOptions = {},
): RewardItemLine {
  const def = ITEM_DEF[id];
  return {
    name: def.name,
    count,
    itemId: options.flyToBag === false ? undefined : id,
    renderIcon: rewardIconPainter(id),
    description: options.describe === true ? def.description : undefined,
    note: options.note,
  };
}

/** One `xp` section per crawler, each naming who it went to, for an award from `awardPartyXp`. */
export function partyXpSections(applied: PartyXpApplied): QuestRewardSection[] {
  return [
    { kind: 'xp', amount: applied.human, recipient: crawlerName('human') },
    { kind: 'xp', amount: applied.cat, recipient: crawlerName('cat') },
  ];
}

/** The wheel face is painted at this multiple of the icon's size, so it stays crisp on a dense screen. */
const WHEEL_ICON_OVERSAMPLE = 2;
const HALF = 0.5;

/** The Wheel of Fortune with its Nothing taped over, as the free spin's icon. */
const paintFreeSpinIcon: IconPainter = (ctx, rect) => {
  const size = Math.min(rect.w, rect.h);
  const radius = size * HALF;
  const board = tapedBoard(BASE_WHEEL_BOARD);
  const face = cachedWheelFace(board, size * WHEEL_ICON_OVERSAMPLE);
  ctx.save();
  ctx.translate(rect.x + rect.w * HALF, rect.y + rect.h * HALF);
  if (face !== null) ctx.drawImage(face, -radius, -radius, size, size);
  else paintWheelFace(ctx, board, radius);
  ctx.restore();
};

/** A quest's free spin at the Wheel of Fortune, for an `items` section. */
export function wheelFreeSpinRewardLine(): RewardItemLine {
  return {
    name: 'Free Spin',
    count: 1,
    renderIcon: paintFreeSpinIcon,
    description: 'One spin on the house at the Wheel of Fortune, with the Nothing taped over.',
    note: 'Take it from the game picker at the Desperado Club casino.',
  };
}
