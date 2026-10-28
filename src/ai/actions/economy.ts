/** Economy actions: items in and out of bags, coins in and out of purses, shop prices. */
import {
  ITEM_DEF,
  isItemId,
  wearerAllows,
  wearerOf,
  type ItemId,
} from '../../core/items/defs/ItemDefs';
import { ITEM_PRICES } from '../../economy/itemPrices';
import { activePriceAdjustment, setPriceAdjustment } from '../../economy/pricing';
import {
  AI_CHARACTER_DAVE,
  AI_CHARACTER_CAROLINE,
  MS_PER_SECOND,
  TARGET_PARAM,
  crawlerName,
  formatSeconds,
  notifyPlayer,
  resolveTarget,
  type Crawler,
} from './helpers';
import { enumParam, intParam, optionalIntParam, textParam } from './schema';
import { ok, refused, type AIActionCall, type AIActionDef } from './types';

const GIFT_COOLDOWN_MS = 30_000;
const TAKE_COOLDOWN_MS = 90_000;
const COIN_COOLDOWN_MS = 60_000;
const PRICE_COOLDOWN_MS = 180_000;

/** No single item the AI hands out or names is worth more than this, at any depth. */
const AI_ITEM_VALUE_MAX = 600;
/** Dave's gifts are a potion or a snack, not loot. */
const DAVE_GIFT_VALUE_MAX = 40;
const GIFT_QUANTITY_MAX = 5;
const TAKE_QUANTITY_MAX = 3;
const TAKES_PER_FLOOR = 3;

/** Per-floor coin gifts and fines scale with depth through the governor's budgets. */
const COIN_GIFT_MAX = 200;
const COIN_FINE_MAX = 100;
/** A fine never takes more than this share of what the crawler holds. */
const FINE_MAX_SHARE_OF_PURSE = 0.25;
const REASON_MAX_CHARS = 120;

const PRICE_CHANGES_PER_FLOOR = 2;
const PRICE_PERCENT_MIN = 5;
const PRICE_PERCENT_MAX = 50;
const PRICE_MIN_SECONDS = 30;
const PRICE_MAX_SECONDS = 300;
const PRICE_DEFAULT_SECONDS = 120;
const PERCENT = 100;

function isGiftable(id: ItemId): boolean {
  const def = ITEM_DEF[id];
  if (def.isQuestItem === true || def.category === 'quest') return false;
  return ITEM_PRICES[id].base <= AI_ITEM_VALUE_MAX;
}

/**
 * Items the AI may give or take: everything that is not a quest item and is
 * worth no more than {@link AI_ITEM_VALUE_MAX}, read from the item table.
 */
export function aiGiftableItemIds(): ItemId[] {
  return Object.keys(ITEM_DEF).filter(isItemId).filter(isGiftable).sort();
}

const ITEM = enumParam(
  'item_id',
  aiGiftableItemIds(),
  'Which item. Gifts draw on a per-floor value allowance.',
);
const GIFT_QUANTITY = optionalIntParam('quantity', {
  min: 1,
  max: GIFT_QUANTITY_MAX,
  fallback: 1,
  description: 'How many.',
});

function giftValue(call: AIActionCall): number {
  const { params } = call;
  return ITEM_PRICES[params.get(ITEM)].base * params.get(GIFT_QUANTITY);
}

function addToBag(crawler: Crawler, item: ItemId, quantity: number): void {
  if (ITEM_DEF[item].stackable) {
    crawler.inventory.addItem(item, quantity);
  } else {
    crawler.inventory.addCopies(item, quantity);
  }
  crawler.onInventoryChanged();
}

const giveItem: AIActionDef = {
  name: 'give_item',
  description:
    'Put an item into a crawler’s bag. Each floor has a value allowance; Dave may only give small things.',
  params: [TARGET_PARAM, ITEM, GIFT_QUANTITY],
  policy: { cost: 2, cooldownMs: GIFT_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_CAROLINE, AI_CHARACTER_DAVE],
  budget: (call) => ({ pool: 'itemValue', amount: giftValue(call) }),
  refusal: (call) => {
    const item = call.params.get(ITEM);
    const isDave = call.characterName === AI_CHARACTER_DAVE;
    if (isDave && giftValue(call) > DAVE_GIFT_VALUE_MAX) {
      return 'Dave can only spare small things';
    }
    const crawler = resolveTarget(call.scene, call.params.get(TARGET_PARAM));
    const wearer = wearerOf(item);
    const kind = crawler === call.scene.getHuman() ? 'human' : 'cat';
    if (wearer !== undefined && !wearerAllows(wearer, kind)) {
      return `${crawlerName(call.scene, crawler)} cannot use ${ITEM_DEF[item].name}`;
    }
    return null;
  },
  execute({ params, scene }) {
    const item = params.get(ITEM);
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const quantity = params.get(GIFT_QUANTITY);
    addToBag(crawler, item, quantity);
    return ok(`gave ${ITEM_DEF[item].name} x${quantity} to ${crawlerName(scene, crawler)}`);
  },
};

const TAKE_QUANTITY = optionalIntParam('quantity', {
  min: 1,
  max: TAKE_QUANTITY_MAX,
  fallback: 1,
  description: 'How many to take. Only from the bag, never what is being worn.',
});

const removeItem: AIActionDef = {
  name: 'remove_item',
  description: 'Confiscate items from a crawler’s bag (never worn gear or quest items).',
  params: [TARGET_PARAM, ITEM, TAKE_QUANTITY],
  policy: {
    cost: 3,
    cooldownMs: TAKE_COOLDOWN_MS,
    severity: 'harmful',
    forbidsContext: ['isPaused'],
  },
  characters: [AI_CHARACTER_CAROLINE],
  maxPerFloor: TAKES_PER_FLOOR,
  refusal: ({ params, scene }) => {
    const item = params.get(ITEM);
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    // Equipped gear sits in the bag too; taking it would strip what they are wearing.
    if (crawler.inventory.equipment.isEquipped(item)) {
      return `${crawlerName(scene, crawler)} is wearing their ${ITEM_DEF[item].name}`;
    }
    return crawler.inventory.countOf(item) > 0
      ? null
      : `${crawlerName(scene, crawler)} has no ${ITEM_DEF[item].name}`;
  },
  execute({ params, scene }) {
    const item = params.get(ITEM);
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    if (crawler.inventory.equipment.isEquipped(item)) return refused('that item is being worn');
    const taken = Math.min(params.get(TAKE_QUANTITY), crawler.inventory.countOf(item));
    if (taken === 0) return refused(`${crawlerName(scene, crawler)} has none to take`);
    crawler.inventory.removeItems(item, taken);
    crawler.onInventoryChanged();
    return ok(`took ${ITEM_DEF[item].name} x${taken} from ${crawlerName(scene, crawler)}`);
  },
};

const COIN_GIFT = intParam('amount', {
  min: 1,
  max: COIN_GIFT_MAX,
  description: 'Coins to give. Each floor has a coin allowance that grows with depth.',
});
const COIN_FINE = intParam('amount', {
  min: 1,
  max: COIN_FINE_MAX,
  description: `Coins to take; never more than ${FINE_MAX_SHARE_OF_PURSE * PERCENT}% of what they hold.`,
});
const COIN_REASON = textParam('reason', {
  minLength: 1,
  maxLength: REASON_MAX_CHARS,
  description: 'Why, shown to the player.',
});

const giveCoins: AIActionDef = {
  name: 'give_coins',
  description: 'Pay a crawler coins, with a reason they see.',
  params: [TARGET_PARAM, COIN_GIFT, COIN_REASON],
  policy: { cost: 2, cooldownMs: COIN_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_CAROLINE],
  budget: ({ params }) => ({ pool: 'coinsGiven', amount: params.get(COIN_GIFT) }),
  execute({ params, scene }) {
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const amount = params.get(COIN_GIFT);
    crawler.earnCoins(amount);
    notifyPlayer(scene, `+${amount} coins: ${params.get(COIN_REASON)}`, {
      tone: 'success',
      icon: 'coin',
    });
    return ok(`paid ${crawlerName(scene, crawler)} ${amount} coins`);
  },
};

function fineAmount(call: AIActionCall): number {
  const crawler = resolveTarget(call.scene, call.params.get(TARGET_PARAM));
  const ceiling = Math.floor(crawler.coins * FINE_MAX_SHARE_OF_PURSE);
  return Math.min(call.params.get(COIN_FINE), ceiling);
}

const fineCoins: AIActionDef = {
  name: 'fine_coins',
  description: `Fine a crawler coins, with a reason they see. Never more than ${FINE_MAX_SHARE_OF_PURSE * PERCENT}% of their purse.`,
  params: [TARGET_PARAM, COIN_FINE, COIN_REASON],
  policy: {
    cost: 2,
    cooldownMs: COIN_COOLDOWN_MS,
    severity: 'disruptive',
    forbidsContext: ['isPaused'],
  },
  characters: [AI_CHARACTER_CAROLINE],
  budget: (call) => ({ pool: 'coinsFined', amount: fineAmount(call) }),
  refusal: (call) => (fineAmount(call) <= 0 ? 'their purse is too light to fine' : null),
  execute(call) {
    const { params, scene } = call;
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const amount = fineAmount(call);
    if (amount <= 0) return refused('their purse is too light to fine');
    crawler.coins -= amount;
    notifyPlayer(scene, `-${amount} coins: ${params.get(COIN_REASON)}`, {
      tone: 'warning',
      icon: 'coin',
    });
    return ok(`fined ${crawlerName(scene, crawler)} ${amount} coins`);
  },
};

const PRICE_PERCENT = intParam('percent', {
  min: PRICE_PERCENT_MIN,
  max: PRICE_PERCENT_MAX,
  description: 'How far prices move, in percent.',
});
const PRICE_SECONDS = optionalIntParam('duration_seconds', {
  min: PRICE_MIN_SECONDS,
  max: PRICE_MAX_SECONDS,
  fallback: PRICE_DEFAULT_SECONDS,
  description: 'How long it lasts.',
});

function priceRefusal(): string | null {
  return activePriceAdjustment() === null ? null : 'a price change is already running';
}

function priceAction(
  name: 'shop_discount' | 'price_surge',
  direction: 1 | -1,
  description: string,
): AIActionDef {
  const isSale = direction === -1;
  return {
    name,
    description,
    params: [PRICE_PERCENT, PRICE_SECONDS],
    policy: {
      cost: 2,
      cooldownMs: PRICE_COOLDOWN_MS,
      severity: isSale ? 'benign' : 'disruptive',
    },
    characters: [AI_CHARACTER_CAROLINE],
    maxPerFloor: PRICE_CHANGES_PER_FLOOR,
    refusal: priceRefusal,
    execute({ params, scene }) {
      const percent = params.get(PRICE_PERCENT);
      const seconds = params.get(PRICE_SECONDS);
      const label = isSale
        ? `Caroline's sale (${percent}% off)`
        : `Caroline's surge (+${percent}%)`;
      setPriceAdjustment(
        { label, multiplier: 1 + (direction * percent) / PERCENT },
        seconds * MS_PER_SECOND,
      );
      notifyPlayer(scene, `${label} for ${formatSeconds(seconds)} in every shop`, {
        tone: isSale ? 'success' : 'warning',
        icon: 'coin',
      });
      return ok(`${label} for ${formatSeconds(seconds)}`);
    },
  };
}

const shopDiscount = priceAction(
  'shop_discount',
  -1,
  'Cut every shop’s prices for a while, never below what shops pay back. One price change at a time.',
);
const priceSurge = priceAction(
  'price_surge',
  1,
  'Raise every shop’s prices for a while (what shops pay is unchanged). One price change at a time.',
);

export const ECONOMY_ACTIONS: readonly AIActionDef[] = [
  giveItem,
  removeItem,
  giveCoins,
  fineCoins,
  shopDiscount,
  priceSurge,
];
