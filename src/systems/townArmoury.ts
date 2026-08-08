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
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { ItemId } from '../core/ItemDefs';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { giveInventoryItem, rotateLine } from './townServiceUtil';

const HELM_PRICE = 40;
const BRACERS_PRICE = 55;
const GAMBESON_PRICE = 60;
const BOOTS_PRICE = 70;

interface IssuePiece {
  readonly key: string;
  readonly item: ItemId;
  readonly label: string;
  readonly price: number;
  readonly desc: string;
  /** The quartermaster's line as he puts it on the counter. */
  readonly issued: string;
}

/**
 * Cheapest first, which is also weakest first. The order is the offer: a crawler
 * reading down the board sees the price climbing with the protection rather than
 * having to work it out from four stat lines.
 */
const ISSUE_KIT: ReadonlyArray<IssuePiece> = [
  {
    key: 'helm',
    item: 'issue_kettle_helm',
    label: 'Issue Kettle Helm',
    price: HELM_PRICE,
    desc: 'Iron, wide brim, one dent. +1 Constitution',
    issued: 'Strap it under the jaw, not behind it. The dent is not mine and it is not yours yet.',
  },
  {
    key: 'bracers',
    item: 'riveted_bracers',
    label: 'Riveted Bracers',
    price: BRACERS_PRICE,
    desc: 'Boiled leather on the blocking arm. +1 Strength',
    issued: 'Four rivets a side. When one goes you bring them back, you do not keep wearing them.',
  },
  {
    key: 'gambeson',
    item: 'padded_gambeson',
    label: 'Padded Gambeson',
    price: GAMBESON_PRICE,
    desc: 'Twenty layers, quilted through. +2 Constitution',
    issued: 'It smells. It will go on smelling. That is the previous owner and he earned it.',
  },
  {
    key: 'boots',
    item: 'marching_boots',
    label: 'Marching Boots',
    price: BOOTS_PRICE,
    desc: 'Hobnailed and already broken in. +1 Dexterity',
    issued: 'Hobnails bite on wet stone. They also announce you. Decide which of those you want.',
  },
];

const QUARTERMASTER_BARKS: ReadonlyArray<string> = [
  'Protection, not edge. Edge is the smith and she is better at it than I would be.',
  'Everything here has been worn before. Everything here has also come back, which is the point.',
  'Tell me what hit you last and I will tell you what to put on.',
];

/** The armoury's board for this visit. */
export function buildArmouryMenu(turn: number, host: ResidentHost | null): PricedMenu {
  return {
    title: 'The Quartermaster',
    bark: host?.line ?? rotateLine(QUARTERMASTER_BARKS, turn),
    byline: host?.name,
    options: ISSUE_KIT.map((piece): PricedOption => {
      return { key: piece.key, label: piece.label, price: piece.price, desc: piece.desc };
    }),
  };
}

/** Hands over the chosen piece, or refuses when it will not fit in the buyer's bag. */
export const issueArmour: PricedPurchaseHandler = (option, buyer) => {
  const piece = ISSUE_KIT.find((candidate) => candidate.key === option.key);
  if (piece === undefined) return { ok: false, line: 'Dann checks the rack and finds nothing.' };
  if (!giveInventoryItem(buyer, piece.item)) {
    return { ok: false, line: 'Your bag is full. Come back when you are carrying less.' };
  }
  return { ok: true, line: piece.issued };
};
