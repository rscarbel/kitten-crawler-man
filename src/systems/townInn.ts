/**
 * The Sleeping Cat's board: the inn's kitchen (see `townPub.ts`) plus the one
 * thing no other house in town sells — a bed, in three grades (see
 * `townInnRooms.ts`).
 *
 * A night here mends both crawlers *and* sleeps off everything that ails them,
 * which is strictly more than the temple's blessing — so it costs more, and it
 * can only be taken when the town is calm. The temple will bless you with the
 * tower about to go up; Ossie will not rent you a room while people are
 * screaming in the street, and that trade is the whole reason both exist.
 *
 * What a room does *not* do is strip the buffs you paid for. Sleeping off a
 * whetstone edge or a Jugg Juice would make the cheapest bed in town a way to
 * lose money, so a room clears `AILMENT_STATUSES` and — because only one room
 * boon may run at a time — the other two room boons. Nothing else.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the fade, the sounds and the interaction gating.
 */

import type { Player } from '../Player';
import type { PricedMenu, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import { buildInnRoomOptions, isInnRoomKey, rentInnRoom } from './townInnRooms';
import { buildTavernMenu, serveDrinkAt } from './townPub';
import type { ResidentHost } from './townResidents';

/** The inn's board: the kitchen, and the guest wing at the end of it. */
export function buildInnMenu(
  house: string,
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
  townInDanger: boolean,
): PricedMenu {
  const menu = buildTavernMenu(house, buyer, turn, host);
  return { ...menu, options: [...menu.options, ...buildInnRoomOptions(townInDanger)] };
}

/**
 * Serves the inn: a room when that is what was bought, otherwise whatever the
 * kitchen put on the board.
 */
export function serveInn(
  house: string,
  party: ReadonlyArray<Player>,
  turn: number,
): PricedPurchaseHandler {
  const serveFood = serveDrinkAt(house);
  const rentRoom = rentInnRoom(party, turn);
  return (option, buyer) => {
    if (!isInnRoomKey(option.key)) return serveFood(option, buyer);
    return rentRoom(option, buyer);
  };
}
