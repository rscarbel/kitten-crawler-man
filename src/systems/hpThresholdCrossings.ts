import type { EventBus } from '../core/EventBus';
import { CRAWLER_HP_THRESHOLDS, type CrawlerSide } from '../core/combat/hpThresholds';
import type { Player } from '../Player';

/**
 * Runs each HP band's reaction for every band a crawler entered since the
 * last frame. Called once a frame in every scene the party plays in, so a
 * crawler crossing a band indoors reacts exactly as one outside does.
 */
export function drainHpThresholdCrossings(
  party: { readonly human: Player; readonly cat: Player },
  bus: EventBus,
): void {
  const crawlers: ReadonlyArray<readonly [Player, CrawlerSide]> = [
    [party.human, 'Human'],
    [party.cat, 'Cat'],
  ];
  for (const [crawler, side] of crawlers) {
    for (const id of crawler.takeHpThresholdCrossings()) {
      CRAWLER_HP_THRESHOLDS[id].onEnter(
        { crawler, side, hp: crawler.hp, maxHp: crawler.maxHp },
        bus,
      );
    }
  }
}
