/**
 * The gallery's shop sheet: the shop screen and its variants with fixture
 * data, one named fixture at a time.
 */

import { TILE_SIZE } from '../../core/constants';
import { createMercenaryRoster } from '../../core/MercenaryRoster';
import { MERCENARY_TEMPLATES } from '../../core/mercenaryTemplates';
import { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { createMarketStock } from '../../systems/market/MarketStock';
import { GENERAL_STORE_PRICING } from '../../systems/market/shopProfiles';
import { ClubVipLoungeSystem } from '../../systems/ClubVipLoungeSystem';
import { MercenaryGuildSystem } from '../../systems/MercenaryGuildSystem';
import { GENERAL_STORE_CONFIG } from '../../systems/ShopSystem';
import { TRAVEL_DESTINATIONS } from '../../systems/travel/travelDestinations';
import type { TownDialogContext } from '../../systems/townDialog';
import type { Surface } from '../../ui/core/UiRoot';
import { drawAnchorStoneIcon } from '../../ui/icons/anchorStoneIcon';
import {
  FortuneTable,
  fortuneScreenSurface,
  PLAZA_SEER,
} from '../../ui/screens/shop/FortuneScreen';
import { mercenaryDeskSurface } from '../../ui/screens/shop/MercenaryDeskScreen';
import { shopScreenSurface } from '../../ui/screens/shop/ShopScreen';
import { openStoreCounter } from '../../ui/screens/shop/storeCounter';
import { ShopSession, type ShopMenu, type ShopParty } from '../../ui/screens/shop/shopSession';
import { vipLoungeSurface } from '../../ui/screens/shop/VipLoungeScreen';
import type { DialogFixture, FixtureRig } from './dialogs/fixture';

const FIXTURE_COINS = 140;
const POOR_COINS = 4;
const SELL_STACKS = [
  { id: 'health_potion', qty: 6 },
  { id: 'wood_board', qty: 12 },
  { id: 'rope', qty: 1 },
] as const;
const QUIET_CONTEXT: TownDialogContext = {
  circus: 'not_started',
  murder: 'not_started',
  doomsday: 'inactive',
  heatherSlain: false,
  quillNamed: false,
};
const CONTRACT_FLOOR = 'level3';

function makeParty(coins: number): ShopParty {
  const active = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(0, 0, TILE_SIZE);
  active.coins = coins;
  for (const stack of SELL_STACKS) active.inventory.addItem(stack.id, stack.qty);
  return { active, companion };
}

/** A market stall: everyday stock, an errand in quest gold, a sold-out line and one too dear. */
function stallMenu(): ShopMenu {
  return {
    title: 'Tinker’s Stall',
    bark: 'Bits, bobs, and the odd thing that explodes. Mind the dynamite.',
    byline: 'Pip the Tinker',
    options: [
      {
        key: 'anchor_shard_tinker',
        label: 'Anchor shard',
        price: 30,
        desc: 'The piece of the Wayfinder’s Anchor the tinker has been keeping for you.',
        isQuestItem: true,
      },
      { key: 'health_potion', label: 'Health Potion', price: 12, desc: 'Restores 50% max HP' },
      { key: 'goblin_dynamite', label: 'Goblin Dynamite', price: 18, desc: 'Throw for AoE damage' },
      {
        key: 'speed_fizz',
        label: 'Speed Fizz',
        price: 45,
        desc: 'Move faster for a short while',
        unavailable: 'Sold out',
      },
      { key: 'rope', label: 'Rope', price: 6, desc: 'Ties things to other things' },
      {
        key: 'magic_missile_tome',
        label: 'Tome of Magic Missile',
        price: 2400,
        desc: 'Teaches the cat to throw raw force',
      },
    ],
  };
}

function stallSession(): ShopSession {
  const session = new ShopSession();
  const held = createMarketStock().held;
  session.open(stallMenu, (option) => ({ ok: true, line: `One ${option.label}, coming up.` }), {
    blockedLine: () => 'Coin first, friend.',
    sell: { pricing: GENERAL_STORE_PRICING, heldStock: held, vendorId: 'tinker' },
  });
  return session;
}

/** Town services: a glyph per row, one already done, one beyond the purse. */
function serviceMenu(): ShopMenu {
  return {
    title: 'Temple of the Ninth Bell',
    bark: 'Kneel, crawler. The bell remembers the names it is paid to.',
    rowGlyph: 'sparkle',
    options: [
      {
        key: 'blessing',
        label: 'Blessing of Vigour',
        price: 25,
        desc: '+10% max HP until you next sleep',
      },
      {
        key: 'cleanse',
        label: 'Cleansing',
        price: 15,
        desc: 'Washes off poison and worse',
        unavailable: 'Already clean',
        icon: { kind: 'glyph', glyph: 'heart' },
      },
      {
        key: 'rite',
        label: 'Rite of the Long Night',
        price: 400,
        desc: 'The bell rings for you once',
      },
    ],
  };
}

function travelMenu(): ShopMenu {
  return {
    title: 'Travel Locations',
    bark: 'The stone hums, waiting for a place it knows.',
    rowGlyph: 'map',
    unpriced: { actionLabel: 'Travel' },
    titleIcon: (ctx, rect) => drawAnchorStoneIcon(ctx, rect),
    options: TRAVEL_DESTINATIONS.map((destination, index) => ({
      key: destination.id,
      label: destination.label,
      price: 0,
      desc: destination.description,
      ...(index === 0 ? { unavailable: 'You are already here.' } : {}),
    })),
  };
}

/** One fixture holding a shop session and the screen over it. */
function shopFixture(
  name: string,
  setup: () => { session: ShopSession; party: ShopParty },
  interact?: (rig: FixtureRig) => void,
): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const { session, party } = setup();
      const surface = shopScreenSurface({ id: `${name}-shop`, session, party: () => party });
      return [gate(surface, shown)];
    },
    interact,
  };
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
      rig.tap(
        rig.need('shop-buy-refused-shop/shop-buy-refused-shop/buy-anchor_shard_tinker/refused'),
      );
      rig.hover(
        rig.need('shop-buy-refused-shop/shop-buy-refused-shop/buy-anchor_shard_tinker/refused'),
      );
      rig.settle();
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
      rig.tap(rig.need('shop-sell-quantity-shop/shop-sell-quantity-shop/sell-wood_board'));
      rig.settle();
    },
  ),
  shopFixture('general-store', () => {
    const session = new ShopSession();
    openStoreCounter(session, {
      config: GENERAL_STORE_CONFIG,
      stock: { stock: createMarketStock(), vendorId: 'general-store' },
      onTraded: () => undefined,
    });
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  shopFixture('town-service', () => {
    const session = new ShopSession();
    session.open(serviceMenu, () => ({ ok: true, line: 'The bell rings.' }));
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  shopFixture('travel', () => {
    const session = new ShopSession();
    session.open(travelMenu, () => ({ ok: true, line: '' }));
    return { session, party: makeParty(FIXTURE_COINS) };
  }),
  {
    name: 'vip',
    surfaces: (shown) => {
      const lounge = new ClubVipLoungeSystem(null, createMercenaryRoster());
      lounge.openPanel(0);
      const party = makeParty(FIXTURE_COINS);
      return [gate(vipLoungeSurface({ id: 'vip-lounge', lounge, party: () => party }), shown)];
    },
  },
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
