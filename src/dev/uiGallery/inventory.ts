/**
 * The gallery's inventory sheet: the real inventory screen over fixture
 * packs, one named fixture at a time.
 */

import { GearState } from '../../gear/gearState';
import { crawlerName } from '../../characters/characters';
import { Inventory } from '../../core/items/inventory/Inventory';
import { BAG_PAGE_SLOTS, ITEM_DEF, isItemId, type ItemId } from '../../core/items/defs/ItemDefs';
import type { CrawlerKind } from '../../core/skills/SkillManager';
import type { Surface } from '../../ui/core/UiRoot';
import { InventoryActions } from '../../ui/screens/inventory/InventoryActions';
import { InventoryScreen } from '../../ui/screens/inventory/InventoryScreen';
import type {
  InventoryMember,
  InventoryOwner,
  InventoryTab,
} from '../../ui/screens/inventory/inventoryTypes';
import type { DialogFixture } from './dialogs/fixture';

const FIXTURE_COINS = 1240;
/** Where the fixture's right-click lands, in UI units. */
const MENU_AT = { x: 200, y: 120 } as const;
const FIXTURE_COIN_SPLIT = `${crawlerName('human')} 900 · ${crawlerName('cat')} 340`;
/** Potions share a cooldown; the fixture shows it part-way through. */
const POTION_COOLDOWN = { current: 180, max: 480 } as const;

const BASE_STATS = { strength: 12, intelligence: 9, constitution: 11, dexterity: 10 } as const;
const CAT_STATS = { strength: 6, intelligence: 14, constitution: 8, dexterity: 13 } as const;
/** A packed fixture bag runs this many pages deep, the last one part-filled. */
const PACKED_BAG_PAGES = 2.5;

const HUMAN_BAG: readonly { readonly id: ItemId; readonly quantity: number }[] = [
  { id: 'speed_fizz', quantity: 3 },
  { id: 'jugg_juice', quantity: 2 },
  { id: 'dirty_shirley', quantity: 4 },
  { id: 'goblin_dynamite', quantity: 9 },
  { id: 'scroll_of_confusing_fog', quantity: 2 },
  { id: 'hearthguard_cap', quantity: 1 },
  { id: 'cockscomb_crest', quantity: 1 },
  { id: 'hearthguard_quilted_vest', quantity: 1 },
  { id: 'hearthguard_boots', quantity: 1 },
  { id: 'scrapmail_vest', quantity: 1 },
  { id: 'basic_pickaxe', quantity: 1 },
  { id: 'basic_axe', quantity: 1 },
  { id: 'stormcaller', quantity: 1 },
  { id: 'wood', quantity: 46 },
  { id: 'stone', quantity: 18 },
  { id: 'wood_board', quantity: 12 },
  { id: 'rope', quantity: 15 },
  { id: 'skill_book_pugilism', quantity: 1 },
  { id: 'trebuchet_kit', quantity: 2 },
];

const CAT_BAG: readonly { readonly id: ItemId; readonly quantity: number }[] = [
  { id: 'speed_fizz', quantity: 1 },
  { id: 'cooldown_crisp', quantity: 2 },
];

function fixtureOwner(
  kind: CrawlerKind,
  stats: typeof BASE_STATS | typeof CAT_STATS,
): InventoryOwner {
  return {
    inventory: new Inventory(kind),
    gear: new GearState(),
    ...stats,
  };
}

function stock(
  owner: InventoryOwner,
  items: readonly { readonly id: ItemId; readonly quantity: number }[],
): void {
  for (const { id, quantity } of items) owner.inventory.addItem(id, quantity);
}

interface FixtureSpec {
  readonly name: string;
  readonly tab: InventoryTab;
  /** Arranges the screen and packs before the first frame. */
  readonly arrange?: (screen: InventoryScreen, human: InventoryOwner) => void;
  readonly member?: CrawlerKind;
  readonly packedBag?: boolean;
}

function selectBag(screen: InventoryScreen, owner: InventoryOwner, id: ItemId): void {
  const slotIdx = owner.inventory.bag.slots.findIndex((item) => item?.id === id);
  if (slotIdx !== -1) screen.selection = { source: 'inv', slotIdx, id };
}

/** Packs the bag with one of each item it lacks until it runs several pages deep. */
function packBag(owner: InventoryOwner): void {
  const bag = owner.inventory.bag;
  const stacksWanted = Math.floor(BAG_PAGE_SLOTS * PACKED_BAG_PAGES);
  const spare = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const def = ITEM_DEF[id];
      return def.isQuestItem !== true && owner.inventory.countOf(id) === 0;
    });
  for (const id of spare) {
    if (bag.slots.filter((item) => item !== null).length >= stacksWanted) return;
    owner.inventory.addItem(id, 1);
  }
}

export function buildFixture(spec: FixtureSpec): DialogFixture {
  return {
    name: spec.name,
    surfaces: (shown) => {
      const human = fixtureOwner('human', BASE_STATS);
      const cat = fixtureOwner('cat', CAT_STATS);
      stock(human, HUMAN_BAG);
      stock(cat, CAT_BAG);
      human.inventory.placeOnHotbar('goblin_dynamite', 2);
      human.inventory.placeOnHotbar('speed_fizz', 1);
      human.inventory.equipByItemId('hearthguard_cap');
      human.inventory.equipByItemId('hearthguard_quilted_vest');
      human.inventory.equipByItemId('stormcaller');
      human.inventory.unseenUpgrades.add('cockscomb_crest');
      if (spec.packedBag === true) packBag(human);
      const party: readonly InventoryMember[] = [
        { id: 'human', name: crawlerName('human'), owner: human },
        { id: 'cat', name: crawlerName('cat'), owner: cat },
      ];
      const screen = new InventoryScreen({
        actions: new InventoryActions(),
        party: () => party,
        coins: () => FIXTURE_COINS,
        coinSplit: () => FIXTURE_COIN_SPLIT,
        cooldownFor: (item) => (item.id === 'health_potion' ? POTION_COOLDOWN : null),
      });
      screen.open({ tab: spec.tab, member: spec.member });
      spec.arrange?.(screen, human);
      const surface: Surface = {
        ...screen.surface,
        id: `inventory-${spec.name}`,
        isOpen: () => shown() && screen.surface.isOpen(),
      };
      return [surface];
    },
  };
}

export const INVENTORY_FIXTURES: readonly DialogFixture[] = [
  buildFixture({
    name: 'bag',
    tab: 'bag',
    arrange: (screen, human) => selectBag(screen, human, 'dirty_shirley'),
  }),
  buildFixture({
    name: 'bag-armor',
    tab: 'bag',
    arrange: (screen, human) => {
      screen.filter = 'armor';
      selectBag(screen, human, 'cockscomb_crest');
      screen.sheetOpen = true;
    },
  }),
  buildFixture({
    name: 'bag-hotbar-picker',
    tab: 'bag',
    arrange: (screen, human) => {
      selectBag(screen, human, 'jugg_juice');
      screen.sheetOpen = true;
      screen.hotbarPickerOpen = true;
    },
  }),
  buildFixture({
    name: 'bag-menu',
    tab: 'bag',
    arrange: (screen, human) => {
      const slotIdx = human.inventory.bag.slots.findIndex((item) => item?.id === 'dirty_shirley');
      const item = human.inventory.bag.slots[slotIdx];
      if (item !== null) screen.openItemMenu({ source: 'inv', slotIdx, item }, MENU_AT);
    },
  }),
  buildFixture({
    name: 'bag-tool-menu',
    tab: 'bag',
    arrange: (screen, human) => {
      const slotIdx = human.inventory.bag.slots.findIndex((item) => item?.id === 'basic_axe');
      const item = human.inventory.bag.slots[slotIdx];
      if (item !== null) screen.openItemMenu({ source: 'inv', slotIdx, item }, MENU_AT);
    },
  }),
  buildFixture({
    name: 'bag-tool-detail',
    tab: 'bag',
    arrange: (screen, human) => {
      selectBag(screen, human, 'basic_axe');
      screen.sheetOpen = true;
    },
  }),
  buildFixture({
    name: 'bag-search',
    tab: 'bag',
    arrange: (screen) => {
      screen.search.value = 'wood';
      screen.sort = 'value';
    },
  }),
  buildFixture({ name: 'bag-pages', tab: 'bag', packedBag: true }),
  buildFixture({
    name: 'bag-last-page',
    tab: 'bag',
    packedBag: true,
    arrange: (screen, human) => screen.showPage(human.inventory.bag.pageCount - 1),
  }),
  buildFixture({
    name: 'bag-weapon',
    tab: 'bag',
    arrange: (screen, human) => {
      screen.filter = 'weapon';
      selectBag(screen, human, 'stormcaller');
      screen.sheetOpen = true;
    },
  }),
  buildFixture({
    name: 'character-weapon',
    tab: 'character',
    arrange: (screen, human) => {
      screen.dollKey = 'Weapon:Main';
      selectBag(screen, human, 'stormcaller');
    },
  }),
  buildFixture({
    name: 'character',
    tab: 'character',
    arrange: (screen) => {
      screen.dollKey = 'Feet:Shoes';
    },
  }),
  buildFixture({ name: 'companion', tab: 'bag', member: 'cat' }),
  buildFixture({ name: 'companion-character', tab: 'character', member: 'cat' }),
];
