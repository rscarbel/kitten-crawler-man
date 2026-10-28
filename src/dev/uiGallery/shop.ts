/**
 * The gallery's shop sheet: the shop screen and its variants with fixture
 * data, one named fixture at a time.
 */

import { TILE_SIZE } from '../../core/constants';
import { createMercenaryRoster } from '../../core/party/MercenaryRoster';
import { MERCENARY_TEMPLATES } from '../../core/party/mercenaryTemplates';
import { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  TOOL_TIER_HARDENED,
  TOOL_TIER_LONG_HAFT,
  forgeCoinPrice,
  toolTierDef,
} from '../../core/items/gathering/toolTiers';
import { buildForgeMenu } from '../../systems/briarHollow/services/forge';
import type { ServiceParty } from '../../systems/briarHollow/services/serviceContext';
import { buyFromShop, createShopStock, sellToShop, type ShopStock } from '../../economy/shopStock';
import type { ShopId } from '../../economy/shops';
import { buildApothecaryMenu, serveRemedy } from '../../systems/townApothecary';
import { GATE_LOCKED_LABEL } from '../../systems/market/vendorMenu';
import { buildTattooMenu, inkTattoo } from '../../systems/townTattooParlor';
import { MercenaryGuildSystem } from '../../systems/MercenaryGuildSystem';
import {
  TRAVEL_DESTINATIONS,
  type TravelDestinationId,
} from '../../systems/travel/travelDestinations';
import type { TownDialogContext } from '../../systems/townDialog';
import type { HitRegion, Surface } from '../../ui/core/UiRoot';
import { drawAnchorStoneIcon } from '../../ui/icons/anchorStoneIcon';
import {
  FortuneTable,
  fortuneScreenSurface,
  PLAZA_SEER,
} from '../../ui/screens/shop/FortuneScreen';
import { mercenaryDeskSurface } from '../../ui/screens/shop/MercenaryDeskScreen';
import { shopScreenSurface } from '../../ui/screens/shop/ShopScreen';
import { openStoreCounter } from '../../ui/screens/shop/storeCounter';
import {
  ShopSession,
  offerUnless,
  type ShopCost,
  type ShopMenu,
  type ShopOpenOptions,
  type ShopParty,
  type ShopRow,
} from '../../ui/screens/shop/shopSession';
import type { ServiceIconId } from '../../sprites/art/itemIcons/serviceIcons';
import type { ItemId } from '../../core/items/defs/ItemDefs';
import { buildDrillYardMenu, runDrill } from '../../systems/townDrillYard';
import { buildInnMenu } from '../../systems/townInn';
import { buildBlessingMenu } from '../../systems/townTemple';
import type { DialogFixture, FixtureRig } from './dialogs/fixture';

const FIXTURE_COINS = 140;
/** The tinker's fixture prices: one too dear for the fixture purse, the rest within it. */
const STALL_PRICES = {
  shard: 30,
  potion: 12,
  dynamite: 18,
  fizz: 45,
  rope: 6,
  tome: 2400,
} as const;
/** A wounded crawler keeps this share of their health, so heal offers are open. */
const WOUNDED_HP_FRACTION = 0.4;
const INN_HOUSE = 'taloncrest_inn';
const TRAVEL_ART = {
  town: 'travel_town',
  circus: 'travel_circus',
  briar_hollow: 'travel_briar_hollow',
} as const satisfies Record<TravelDestinationId, ServiceIconId>;
const POOR_COINS = 4;
const SELL_STACKS = [
  { id: 'health_potion', qty: 6 },
  { id: 'wood_board', qty: 12 },
  { id: 'rope', qty: 1 },
  { id: 'riot_kneeguards', qty: 1 },
] as const;
const QUIET_CONTEXT: TownDialogContext = {
  murder: 'not_started',
  doomsday: 'inactive',
  quillNamed: false,
};
const CONTRACT_FLOOR = 'level3';
const APOTHECARY_SHOP = 'apothecary' as const satisfies ShopId;
/** Poultices bought off the apothecary's three-unit batch, so its row reads "Low stock". */
const POULTICES_BOUGHT = 2;
/** Tonics and boards the party has already sold her, so those rows read "Overstocked". */
const TONICS_SOLD = 3;
const BOARDS_SOLD = 4;
/** Speed Fizz is a potion she does not stock, so its Sell row is a specialty and nothing else. */
const APOTHECARY_EXTRA_STACK = { id: 'speed_fizz', qty: 2 } as const;
/** The forge party holds this share of the long-haft tier's materials, so its Buy shows a material shortfall. */
const FORGE_MATERIAL_SHARE = 0.5;
/** A fixture counter with no refusal line, rebuy guard, Sell tab or drifting prices. */
const NO_COUNTER_EXTRAS: ShopOpenOptions = {
  onBlocked: null,
  blockedLine: null,
  rebuyGuardTicks: 0,
  sell: null,
  liveRows: false,
};

function makeParty(coins: number): ShopParty {
  const active = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(0, 0, TILE_SIZE);
  active.coins = coins;
  for (const stack of SELL_STACKS) active.inventory.addItem(stack.id, stack.qty);
  return { active, companion };
}

/** A market stall: everyday stock, an errand in quest gold, a sold-out line, a gated line and one too dear. */
function stallMenu(): ShopMenu {
  const item = (
    key: ItemId,
    label: string,
    coins: number,
    desc: string,
    closedReason: string | null,
  ): ShopRow => ({
    key,
    label,
    desc,
    art: { kind: 'item', item: key },
    offer: offerUnless(closedReason, { kind: 'coins', coins }),
    questErrand: false,
  });
  return {
    title: 'Tinker’s Stall',
    bark: 'Bits, bobs, and the odd thing that explodes. Mind the dynamite.',
    byline: 'Pip the Tinker',
    emblem: null,
    options: [
      {
        ...item(
          'anchor_shard_tinker',
          'Anchor shard',
          STALL_PRICES.shard,
          'The piece of the Wayfinder’s Anchor the tinker has been keeping for you.',
          null,
        ),
        questErrand: true,
      },
      item('health_potion', 'Health Potion', STALL_PRICES.potion, 'Restores 50% max HP', null),
      item(
        'goblin_dynamite',
        'Goblin Dynamite',
        STALL_PRICES.dynamite,
        'Throw for AoE damage',
        GATE_LOCKED_LABEL,
      ),
      item(
        'speed_fizz',
        'Speed Fizz',
        STALL_PRICES.fizz,
        'Move faster for a short while',
        'Sold out',
      ),
      item('rope', 'Rope', STALL_PRICES.rope, 'Ties things to other things', null),
      item(
        'magic_missile_tome',
        'Tome of Magic Missile',
        STALL_PRICES.tome,
        'Teaches the cat to throw raw force',
        null,
      ),
    ],
  };
}

function stallSession(): ShopSession {
  const session = new ShopSession();
  session.open(stallMenu, (option) => ({ ok: true, line: `One ${option.label}, coming up.` }), {
    onBlocked: null,
    blockedLine: () => 'Coin first, friend.',
    rebuyGuardTicks: 0,
    sell: { shop: 'tinker', stock: createShopStock(), onSold: null },
    liveRows: false,
  });
  return session;
}

/** The Barracks drill yard: one stat point per row, priced at the crawler's next rung. */
function drillYardSession(): { session: ShopSession; party: ShopParty } {
  const party = makeParty(FIXTURE_COINS);
  const session = new ShopSession();
  session.open(() => buildDrillYardMenu(party.active, 0, null), runDrill, NO_COUNTER_EXTRAS);
  return { session, party };
}

/** The Sleeping Cat: its kitchen board and the guest wing, with the party wounded so the food is on. */
function innSession(): { session: ShopSession; party: ShopParty } {
  const party = makeParty(FIXTURE_COINS);
  party.active.hp = Math.ceil(party.active.maxHp * WOUNDED_HP_FRACTION);
  const stock = createShopStock();
  const session = new ShopSession();
  session.open(
    () => buildInnMenu(INN_HOUSE, party.active, 0, null, false, stock),
    () => ({ ok: true, line: '' }),
    NO_COUNTER_EXTRAS,
  );
  return { session, party };
}

/** The temple's one blessing, for a wounded party: the narrow single-offer counter. */
function templeSession(): { session: ShopSession; party: ShopParty } {
  const party = makeParty(FIXTURE_COINS);
  party.active.hp = Math.ceil(party.active.maxHp * WOUNDED_HP_FRACTION);
  const session = new ShopSession();
  session.open(
    () => buildBlessingMenu([party.active, party.companion], 0, null),
    () => ({ ok: true, line: 'The bell rings.' }),
    NO_COUNTER_EXTRAS,
  );
  return { session, party };
}

function travelMenu(): ShopMenu {
  const travelCost = { kind: 'free', actionLabel: 'Travel' } as const satisfies ShopCost;
  return {
    title: 'Travel Locations',
    bark: 'The stone hums, waiting for a place it knows.',
    byline: null,
    emblem: (ctx, rect) => drawAnchorStoneIcon(ctx, rect),
    options: TRAVEL_DESTINATIONS.map((destination, index): ShopRow => ({
      key: destination.id,
      label: destination.label,
      desc: destination.description,
      art: { kind: 'service', service: TRAVEL_ART[destination.id] },
      offer: offerUnless(index === 0 ? 'You are already here.' : null, travelCost),
      questErrand: false,
    })),
  };
}

/**
 * Oren's forge with an axe and a pickaxe whose next tiers take wood and stone:
 * coins enough for the axe, but only part of its materials.
 */
function forgeSession(): { session: ShopSession; party: ShopParty } {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const axeNext = toolTierDef('axe', TOOL_TIER_LONG_HAFT);
  human.coins = forgeCoinPrice('axe', TOOL_TIER_LONG_HAFT);
  const { wood = 0, stone = 0 } = axeNext.costMaterials;
  human.inventory.addItem('wood', Math.floor(wood * FORGE_MATERIAL_SHARE));
  human.inventory.addItem('stone', stone);
  const party: ServiceParty = { human, cat, active: () => human };
  const tools = { axeTier: TOOL_TIER_HARDENED, pickaxeTier: TOOL_TIER_LONG_HAFT };
  const session = new ShopSession();
  session.open(
    () => buildForgeMenu(tools, party),
    () => ({ ok: true, line: '' }),
    NO_COUNTER_EXTRAS,
  );
  return { session, party: { active: human, companion: cat } };
}

/**
 * The apothecary's counter partway through a visit: poultices bought down,
 * tonics and boards sold in, so both stock tags show, and a bag holding a
 * potion she does not stock, so a Sell row shows only her specialty.
 */
function apothecarySession(): { session: ShopSession; party: ShopParty } {
  const stock: ShopStock = createShopStock();
  buyFromShop(stock, APOTHECARY_SHOP, 'health_potion', POULTICES_BOUGHT);
  for (let sold = 0; sold < TONICS_SOLD; sold++) sellToShop(stock, APOTHECARY_SHOP, 'jugg_juice');
  for (let sold = 0; sold < BOARDS_SOLD; sold++) sellToShop(stock, APOTHECARY_SHOP, 'wood_board');
  const party = makeParty(FIXTURE_COINS);
  party.active.inventory.addItem(APOTHECARY_EXTRA_STACK.id, APOTHECARY_EXTRA_STACK.qty);
  const crawlers = [party.active, party.companion];
  const session = new ShopSession();
  session.open(() => buildApothecaryMenu(crawlers, stock, 0, null), serveRemedy(crawlers, stock), {
    ...NO_COUNTER_EXTRAS,
    sell: { shop: APOTHECARY_SHOP, stock, onSold: null },
  });
  return { session, party };
}

function apothecarySellSession(): { session: ShopSession; party: ShopParty } {
  const setup = apothecarySession();
  setup.session.setMode('sell');
  return setup;
}

/** One fixture holding a shop session and the screen over it. */
function shopFixture(
  name: string,
  setup: () => { session: ShopSession; party: ShopParty },
  interact?: (rig: FixtureRig) => void,
  showPriceBreakdowns = false,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const { session, party } = setup();
      const surface = shopScreenSurface({
        id: `${name}-shop`,
        session,
        party: () => party,
        showPriceBreakdowns: () => showPriceBreakdowns,
      });
      return [gate(surface, shown)];
    },
    interact,
  };
}

/**
 * Applies `act` to a card's control when it is on screen. On the shortest
 * landscape phones a shop's header leaves room for little more than the top
 * of the first card, so the control can be scrolled below the fold; the
 * fixture then captures the shop as it opens.
 */
function whenShown(rig: FixtureRig, id: string, act: (region: HitRegion) => void): void {
  const region = rig.region(id);
  if (region === null) return;
  act(region);
  rig.settle();
}

function gate(surface: Surface, shown: () => boolean): Surface {
  return { ...surface, isOpen: () => shown() && surface.isOpen() };
}

export const SHOP_FIXTURES: readonly DialogFixture[] = [
  shopFixture('shop-buy', () => ({ session: stallSession(), party: makeParty(FIXTURE_COINS) })),
  shopFixture(
    'shop-buy-refused',
    () => ({ session: stallSession(), party: makeParty(POOR_COINS) }),
    (rig) => {
      whenShown(
        rig,
        'shop-buy-refused-shop/shop-buy-refused-shop/buy-anchor_shard_tinker/refused',
        (region) => {
          rig.tap(region);
          rig.hover(region);
        },
      );
    },
  ),
  shopFixture('shop-sell', () => {
    const session = stallSession();
    session.setMode('sell');
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  shopFixture(
    'shop-sell-quantity',
    () => {
      const session = stallSession();
      session.setMode('sell');
      return { session, party: makeParty(FIXTURE_COINS) };
    },
    (rig) => {
      whenShown(rig, 'shop-sell-quantity-shop/shop-sell-quantity-shop/sell-wood_board', (region) =>
        rig.tap(region),
      );
    },
  ),
  shopFixture('general-store', () => {
    const session = new ShopSession();
    openStoreCounter(session, {
      shop: 'general_store',
      stock: createShopStock(),
      onTraded: () => undefined,
      owns: () => false,
    });
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  shopFixture('stock-tags', apothecarySession),
  shopFixture('stock-tags-sell', apothecarySellSession),
  shopFixture('prices-breakdown', apothecarySession, undefined, true),
  shopFixture(
    'prices-breakdown-sell',
    apothecarySellSession,
    (rig) => {
      whenShown(
        rig,
        'prices-breakdown-sell-shop/prices-breakdown-sell-shop/sell-row-wood_board',
        (region) => rig.tap(region),
      );
    },
    true,
  ),
  shopFixture('town-service', templeSession),
  shopFixture('drill-yard', drillYardSession),
  shopFixture('inn', innSession),
  shopFixture('tattoo-parlour', () => {
    const party = makeParty(FIXTURE_COINS);
    const session = new ShopSession();
    session.open(() => buildTattooMenu(party.active, 0, null), inkTattoo, NO_COUNTER_EXTRAS);
    return { session, party };
  }),
  shopFixture('forge', forgeSession),
  shopFixture('forge-refused', forgeSession, (rig) => {
    whenShown(rig, 'forge-refused-shop/forge-refused-shop/buy-axe/refused', (region) =>
      rig.hover(region),
    );
  }),
  shopFixture('travel', () => {
    const session = new ShopSession();
    session.open(travelMenu, () => ({ ok: true, line: '' }), NO_COUNTER_EXTRAS);
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  {
    name: 'mercenary',
    surfaces: (shown) => {
      const roster = createMercenaryRoster();
      roster.floorLevelId = CONTRACT_FLOOR;
      const desk = new MercenaryGuildSystem(roster, null);
      desk.openPanel();
      const party = makeParty(FIXTURE_COINS);
      return [
        gate(mercenaryDeskSurface({ id: 'mercenary-desk', desk, party: () => party }), shown),
      ];
    },
  },
  {
    name: 'mercenary-dismiss',
    surfaces: (shown) => {
      const roster = createMercenaryRoster();
      roster.floorLevelId = CONTRACT_FLOOR;
      const hire = MERCENARY_TEMPLATES[0];
      roster.active = {
        id: hire.id,
        name: hire.name,
        contractLevelId: CONTRACT_FLOOR,
        introduced: true,
      };
      const desk = new MercenaryGuildSystem(roster, null);
      desk.openPanel();
      desk.askDismiss();
      const party = makeParty(FIXTURE_COINS);
      return [
        gate(
          mercenaryDeskSurface({ id: 'mercenary-desk-dismiss', desk, party: () => party }),
          shown,
        ),
        gate(desk.dismissConfirm.surface('mercenary-dismiss'), shown),
      ];
    },
  },
  {
    name: 'fortune',
    surfaces: (shown) => {
      const table = new FortuneTable();
      table.openWith(QUIET_CONTEXT, PLAZA_SEER);
      const party = makeParty(FIXTURE_COINS);
      return [
        gate(fortuneScreenSurface({ id: 'fortune-cards', table, party: () => party }), shown),
      ];
    },
  },
  {
    name: 'fortune-read',
    surfaces: (shown) => {
      const table = new FortuneTable();
      table.openWith(QUIET_CONTEXT, PLAZA_SEER);
      const party = makeParty(FIXTURE_COINS);
      table.payAndReveal(party);
      return [gate(fortuneScreenSurface({ id: 'fortune-read', table, party: () => party }), shown)];
    },
  },
];
