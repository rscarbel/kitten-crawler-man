/**
 * The crawlers remarking that another quest's item has pushed Merrit's scythe
 * or Tikka's blueprints out of a quest slot.
 *
 * The remark is all the quest does about it. Neither item is recorded in the
 * quest's state — guidance and the props read the crawlers' inventories — so
 * the moment neither crawler holds the scythe it is back on the barn wall, and
 * the blueprints back in Wendell's plan chest, with every fence section, grain
 * and upgraded station still counted.
 *
 * Only an eviction reaches here: the quest taking its own items away (the
 * scythe going back at the grain hand-in, the blueprints retired on
 * completion) removes them without one, so those stay quiet on their own.
 */

import type { EventBus } from '../../../core/EventBus';
import { QUEST_SLOT_IDX, type ItemId } from '../../../core/ItemDefs';
import type { CrawlerKind } from '../../../core/SkillManager';
import type { BarkLine } from '../../../dialog/line';
import { CRAWLER_BARKS } from '../../../dialog/scripts/crawlerBarks';
import type { Player } from '../../../Player';
import type { CrawlerBarkSystem } from '../../CrawlerBarkSystem';
import { isBlueprintsQuestItem, type BlueprintsQuestItemId } from './blueprintsProgress';

/** The remark for `item`, in `speaker`'s voice. */
function leftBehindLine(item: BlueprintsQuestItemId, speaker: CrawlerKind): BarkLine {
  const isCarl = speaker === 'human';
  if (item === 'quest_scythe') {
    return isCarl ? CRAWLER_BARKS.scytheLeftBehind.carl : CRAWLER_BARKS.scytheLeftBehind.donut;
  }
  return isCarl
    ? CRAWLER_BARKS.blueprintsLeftBehind.carl
    : CRAWLER_BARKS.blueprintsLeftBehind.donut;
}

/** Who says what about one eviction. */
export interface BlueprintsEvictionBark {
  readonly speaker: Player;
  readonly line: string;
}

/**
 * The remark an eviction of `itemId` from `crawler`'s quest slot calls for,
 * or null when it calls for none: the item was another quest's, or what
 * replaced it is this quest's own other item, which is the quest moving on
 * rather than the party losing track of anything.
 *
 * Said by the crawler whose slot it was, who just set the thing down —
 * unless they are knocked out, when their partner notices instead.
 */
export function blueprintsEvictionBark(
  itemId: ItemId,
  crawler: CrawlerKind,
  crawlers: Readonly<Record<CrawlerKind, Player>>,
): BlueprintsEvictionBark | null {
  if (!isBlueprintsQuestItem(itemId)) return null;
  const evicted = crawlers[crawler];
  const replacement = evicted.inventory.actionBar.slots[QUEST_SLOT_IDX]?.id;
  if (replacement !== undefined && isBlueprintsQuestItem(replacement)) return null;
  const partner: CrawlerKind = crawler === 'human' ? 'cat' : 'human';
  const speakerKind = evicted.isKnockedOut ? partner : crawler;
  const line = leftBehindLine(itemId, speakerKind);
  return { speaker: crawlers[speakerKind], line: line.paragraphs[0] };
}

/**
 * Has the running scene's crawlers remark on this quest's items being
 * evicted. Wired by every scene that forwards evictions onto its bus, as the
 * eviction can come from a quest anywhere — the doomsday crystal is contained
 * in the tower, well away from Briar Hollow. Returns the unsubscribe.
 */
export function barkWhenBlueprintsItemEvicted(
  bus: EventBus,
  crawlers: Readonly<Record<CrawlerKind, Player>>,
  barks: Pick<CrawlerBarkSystem, 'say'>,
): () => void {
  return bus.on('questItemEvicted', ({ itemId, crawler }) => {
    const bark = blueprintsEvictionBark(itemId, crawler, crawlers);
    if (bark !== null) barks.say(bark.speaker, [bark.line]);
  });
}
