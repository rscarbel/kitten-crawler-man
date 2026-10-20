import type { EventBus } from '../core/EventBus';
import { isItemId, ITEM_DEF } from '../core/ItemDefs';
import type { Conversation } from '../dialog/Conversation';
import { onShopTrade } from '../ui/screens/shop/shopSession';
import type { AchievementUISystem } from './AchievementUISystem';

/**
 * The scene-owned objects that report through callbacks rather than a bus
 * (they are built before, or without, one), forwarded onto the scene's bus
 * as `conversation` and `boxOpened`.
 */
export interface HookedSceneObjects {
  conversation: Conversation;
  achievementUI: AchievementUISystem;
}

/**
 * Wires the objects' callbacks onto `bus`, and every shop counter's trades
 * while the scene is up. Returns the function that stops the trade
 * forwarding; call it on scene exit.
 */
export function forwardSceneHooksToBus(bus: EventBus, objects: HookedSceneObjects): () => void {
  objects.conversation.onTalk = (change) => bus.emit('conversation', change);
  objects.achievementUI.onBoxOpened = ({ owner, box, contents }) => {
    const items: string[] = (contents.itemRewards ?? []).map((reward) => ITEM_DEF[reward.id].name);
    const bonusId = contents.bonus?.id;
    if (bonusId !== undefined) items.push(isItemId(bonusId) ? ITEM_DEF[bonusId].name : bonusId);
    bus.emit('boxOpened', {
      owner,
      tier: box.tier,
      category: box.category,
      coins: contents.coins,
      potions: contents.potions ?? 0,
      items,
    });
  };
  return onShopTrade((trade) => {
    if (trade.kind === 'buy') {
      bus.emit('shopPurchase', {
        buyer: trade.crawler,
        item: trade.item,
        coins: trade.coins,
        shop: trade.shop,
      });
    } else {
      bus.emit('shopSold', {
        seller: trade.crawler,
        item: trade.item,
        quantity: trade.quantity,
        coins: trade.coins,
        shop: trade.shop,
      });
    }
  });
}
