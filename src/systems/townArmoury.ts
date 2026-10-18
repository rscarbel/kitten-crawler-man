/**
 * The Barracks' quartermaster counter — the town's only armour.
 *
 * Deliberately not a weapon rack. The smith's whole position is that the town's
 * edge comes up off the floor rather than out of a forge, so a garrison selling
 * swords would take her counter's reason to exist; what a garrison has that
 * nobody else does is *protection*, issued by the crate and signed for.
 *
 * Priced above the General Store's consumables and below the parlour's ink: a
 * crawler should be able to walk out of here kitted after two or three floors'
 * worth of coin, and should still have to choose which piece they want first.
 * The pieces and their order live on `SHOPS.armoury`; each price is the item's
 * base in `ITEM_PRICES` times that shop's markup.
 *
 * Pure data + effect application; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { ItemId } from '../core/ItemDefs';
import type { ShopMenu, ShopPurchaseHandler } from '../ui/screens/shop/shopSession';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';
import { SHOPS, type ShopId } from '../economy/shops';
import type { ShopStock } from '../economy/shopStock';
import { catalogLineRow, findCatalogLine, handOverCatalogLine } from './market/vendorMenu';

const ARMOURY_SHOP = 'armoury' as const satisfies ShopId;

type ArmouryItem = (typeof SHOPS.armoury.catalog)[number]['item'];

/** The quartermaster's line as he puts each piece on the counter. */
const ISSUED_LINES: Readonly<Record<ArmouryItem, string>> = {
  issue_kettle_helm:
    'Strap it under the jaw, not behind it. The dent is not mine and it is not yours yet.',
  riveted_bracers:
    'Four rivets a side. When one goes you bring them back, you do not keep wearing them.',
  padded_gambeson:
    'It smells. It will go on smelling. That is the previous owner and he earned it.',
  marching_boots:
    'Hobnails bite on wet stone. They also announce you. Decide which of those you want.',
  bracelet_of_dex: "Not sized for a human wrist. I don't ask who it's for, I just sell it.",
};

function issuedLine(item: ItemId): string {
  const lines: Partial<Record<ItemId, string>> = ISSUED_LINES;
  return lines[item] ?? 'Signed for. Bring it back in one piece.';
}

const QUARTERMASTER_BARKS: ReadonlyArray<string> = [
  'Protection, not edge. Edge is the smith and she is better at it than I would be.',
  'Everything here has been worn before. Everything here has also come back, which is the point.',
  'Tell me what hit you last and I will tell you what to put on.',
];

/** The armoury's board for this visit. */
export function buildArmouryMenu(
  turn: number,
  host: ResidentHost | null,
  stock: ShopStock,
): ShopMenu {
  return {
    title: 'The Quartermaster',
    bark: host?.line ?? rotateLine(QUARTERMASTER_BARKS, turn),
    byline: host?.name,
    options: SHOPS.armoury.catalog.map((line) => catalogLineRow(ARMOURY_SHOP, line, stock)),
  };
}

/** Hands over the chosen piece, booked against the armoury's stock. */
export function issueArmour(stock: ShopStock): ShopPurchaseHandler {
  return (option, buyer) => {
    const line = findCatalogLine(ARMOURY_SHOP, option.key);
    if (line === undefined || !handOverCatalogLine(ARMOURY_SHOP, line, stock, buyer)) {
      return { ok: false, line: 'Dann checks the rack and finds nothing.' };
    }
    return { ok: true, line: issuedLine(line.item) };
  };
}
