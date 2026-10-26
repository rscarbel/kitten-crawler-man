import type { EventBus } from '../core/EventBus';
import type { Conversation } from '../dialog/Conversation';
import { onShopTrade } from '../ui/screens/shop/shopSession';

/**
 * The scene-owned objects that report through callbacks rather than a bus
 * (they are built before, or without, one), forwarded onto the scene's bus
 * as `conversation`.
 */
export interface HookedSceneObjects {
  conversation: Conversation;
}

/**
 * Wires the objects' callbacks onto `bus`, and every shop counter's trades
 * while the scene is up. Returns the function that stops the trade
 * forwarding; call it on scene exit.
 */
export function forwardSceneHooksToBus(bus: EventBus, objects: HookedSceneObjects): () => void {
  objects.conversation.onTalk = (change) => bus.emit('conversation', change);
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
