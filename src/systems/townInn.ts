/**
 * The Sleeping Cat's room. The inn's board is its kitchen (see `townPub.ts`)
 * plus one thing no other house in town sells: a bed.
 *
 * A night here mends both crawlers *and* sleeps off everything that ails them,
 * which is strictly more than the temple's blessing — so it costs more, and it
 * can only be taken when the town is calm. The temple will bless you with the
 * tower about to go up; Ossie will not rent you a room while people are
 * screaming in the street, and that trade is the whole reason both exist.
 *
 * What it does *not* do is strip the buffs you paid for. Sleeping off a
 * whetstone edge or a Jugg Juice would make the cheapest bed in town a way to
 * lose money, so the room clears `AILMENT_STATUSES` and nothing else.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the fade, the sounds and the interaction gating.
 */

import { AILMENT_STATUSES } from '../core/StatusEffect';
import type { Player } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import { buildTavernMenu, serveDrinkAt } from './townPub';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

export const INN_ROOM_KEY = 'inn_room';

/** Above the temple's blessing, because a bed does everything a blessing does and then some. */
const ROOM_PRICE = 30;

const REST_LINES: ReadonlyArray<string> = [
  'End room, bolt on the inside. Sleep as long as you like — nobody will knock.',
  'Up you go. I will keep the stew warm and the door shut.',
  'Nine hours and a wash. You look like a different crawler.',
];

function needsRest(party: ReadonlyArray<Player>): boolean {
  return party.some(
    (member) => member.hp < member.maxHp || AILMENT_STATUSES.some((type) => member.hasStatus(type)),
  );
}

/** The inn's board: the kitchen, and the room at the end of it. */
export function buildInnMenu(
  house: string,
  party: ReadonlyArray<Player>,
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
  townInDanger: boolean,
): PricedMenu {
  const menu = buildTavernMenu(house, buyer, turn, host);
  const room: PricedOption = {
    key: INN_ROOM_KEY,
    label: 'Sleep it off',
    price: ROOM_PRICE,
    desc: 'A room for the night: mends you both and sleeps off what ails you',
  };
  if (townInDanger) {
    room.unavailable = 'Not tonight';
  } else if (!needsRest(party)) {
    room.unavailable = 'Rested';
  }
  return { ...menu, options: [...menu.options, room] };
}

/**
 * Serves the inn: the room when that is what was bought, otherwise whatever the
 * kitchen put on the board.
 */
export function serveInn(
  house: string,
  party: ReadonlyArray<Player>,
  turn: number,
): PricedPurchaseHandler {
  const serveFood = serveDrinkAt(house);
  return (option, buyer) => {
    if (option.key !== INN_ROOM_KEY) return serveFood(option, buyer);
    for (const member of party) {
      member.cureStatuses(AILMENT_STATUSES);
      member.reviveToFull();
    }
    return { ok: true, line: rotateLine(REST_LINES, turn) };
  };
}
