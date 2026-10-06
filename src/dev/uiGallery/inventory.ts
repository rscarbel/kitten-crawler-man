/**
 * The gallery's inventory sheet: the real inventory screen over fixture
 * packs, one named fixture at a time.
 */

import { Inventory } from '../../core/Inventory';
import { ITEM_DEF, SLOT_COUNT, isItemId, type ItemId } from '../../core/ItemDefs';
import type { CrawlerKind } from '../../core/SkillManager';
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
const FIXTURE_COIN_SPLIT = 'Carl 900 · Donut 340';
/** Potions share a cooldown; the fixture shows it part-way through. */
const POTION_COOLDOWN = { current: 180, max: 480 } as const;

const BASE_STATS = { strength: 12, intelligence: 9, constitution: 11, dexterity: 10 } as const;
const CAT_STATS = { strength: 6, intelligence: 14, constitution: 8, dexterity: 13 } as const;

const CARL_BAG: readonly { readonly id: ItemId; readonly quantity: number }[] = [
  { id: 'speed_fizz', quantity: 3 },
  { id: 'jugg_juice', quantity: 2 },
  { id: 'dirty_shirley', quantity: 4 },
  { id: 'goblin_dynamite', quantity: 9 },
  { id: 'scroll_of_confusing_fog', quantity: 2 },
  { id: 'issue_kettle_helm', quantity: 1 },
  { id: 'enchanted_crown_sepsis_whore', quantity: 1 },
  { id: 'padded_gambeson', quantity: 1 },
  { id: 'marching_boots', quantity: 1 },
  { id: 'trollskin_shirt', quantity: 1 },
  { id: 'basic_pickaxe', quantity: 1 },
  { id: 'wood', quantity: 46 },
  { id: 'stone', quantity: 18 },
  { id: 'wood_board', quantity: 12 },
  { id: 'rope', quantity: 15 },
  { id: 'skill_book_pugilism', quantity: 1 },
  { id: 'trebuchet_kit', quantity: 2 },
];

const DONUT_BAG: readonly { readonly id: ItemId; readonly quantity: number }[] = [
  { id: 'speed_fizz', quantity: 1 },
  { id: 'cooldown_crisp', quantity: 2 },
  { id: 'splatter_skunk_toe_ring', quantity: 1 },
];

function fixtureOwner(
  kind: CrawlerKind,
  stats: typeof BASE_STATS | typeof CAT_STATS,
): InventoryOwner {
  return {
    inventory: new Inventory(kind),
    ...stats,
    onEquipmentChanged: () => undefined,
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
  readonly arrange?: (screen: InventoryScreen, carl: InventoryOwner) => void;
  readonly member?: CrawlerKind;
  readonly fullBag?: boolean;
}

function selectBag(screen: InventoryScreen, owner: InventoryOwner, id: ItemId): void {
  const slotIdx = owner.inventory.bag.slots.findIndex((item) => item?.id === id);
  if (slotIdx !== -1) screen.selection = { source: 'inv', slotIdx, id };
}

function fillBag(owner: InventoryOwner): void {
  const bag = owner.inventory.bag;
  const spare = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const def = ITEM_DEF[id];
      return def.isQuestItem !== true && owner.inventory.countOf(id) === 0;
    });
  for (const id of spare) {
    if (bag.slots.filter((item) => item !== null).length >= SLOT_COUNT - 1) return;
    owner.inventory.addItem(id, 1);
  }
}

export function buildFixture(spec: FixtureSpec): DialogFixture {
  return {
    name: spec.name,
    surfaces: (shown) => {
      const carl = fixtureOwner('human', BASE_STATS);
      const donut = fixtureOwner('cat', CAT_STATS);
      stock(carl, CARL_BAG);
      stock(donut, DONUT_BAG);
      carl.inventory.placeOnHotbar('goblin_dynamite', 2);
      carl.inventory.placeOnHotbar('speed_fizz', 1);
      carl.inventory.equipByItemId('issue_kettle_helm');
      carl.inventory.equipByItemId('padded_gambeson');
      carl.inventory.unseenUpgrades.add('enchanted_crown_sepsis_whore');
      if (spec.fullBag === true) fillBag(carl);
      const party: readonly InventoryMember[] = [
        { id: 'human', name: 'Carl', owner: carl },
        { id: 'cat', name: 'Donut', owner: donut },
      ];
      const screen = new InventoryScreen({
        actions: new InventoryActions(),
        party: () => party,
        coins: () => FIXTURE_COINS,
        coinSplit: () => FIXTURE_COIN_SPLIT,
        cooldownFor: (item) => (item.id === 'health_potion' ? POTION_COOLDOWN : null),
      });
      screen.open({ tab: spec.tab, member: spec.member });
      spec.arrange?.(screen, carl);
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
    arrange: (screen, carl) => selectBag(screen, carl, 'dirty_shirley'),
  }),
  buildFixture({
    name: 'bag-armor',
    tab: 'bag',
    arrange: (screen, carl) => {
      screen.filter = 'armor';
      selectBag(screen, carl, 'enchanted_crown_sepsis_whore');
      screen.sheetOpen = true;
    },
  }),
  buildFixture({
    name: 'bag-hotbar-picker',
    tab: 'bag',
    arrange: (screen, carl) => {
      selectBag(screen, carl, 'jugg_juice');
      screen.sheetOpen = true;
      screen.hotbarPickerOpen = true;
    },
  }),
  buildFixture({
    name: 'bag-menu',
    tab: 'bag',
    arrange: (screen, carl) => {
      const slotIdx = carl.inventory.bag.slots.findIndex((item) => item?.id === 'dirty_shirley');
      const item = carl.inventory.bag.slots[slotIdx];
      if (item !== null) screen.openItemMenu({ source: 'inv', slotIdx, item }, MENU_AT);
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
  buildFixture({ name: 'bag-full', tab: 'bag', fullBag: true }),
  buildFixture({
    name: 'character',
    tab: 'character',
    arrange: (screen) => {
      screen.dollKey = 'Feet:Shoes';
    },
  }),
  buildFixture({ name: 'companion', tab: 'bag', member: 'cat' }),
];
