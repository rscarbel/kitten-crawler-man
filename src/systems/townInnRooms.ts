/**
 * The Sleeping Cat's guest wing: three private rooms, three prices, three
 * different mornings.
 *
 * Every room does the same two things — mends both crawlers and sleeps off
 * everything that ails them — and then grants one timed boon that the price is
 * actually buying. The boon is a `StatusEffect` rather than a temporary stat
 * modifier, because a status rides the player snapshot in and out of every
 * building: a bonus built on anything else would evaporate at the inn's own
 * front door, which is the last place a player would think to look for it.
 *
 * Only one room boon runs at a time. Renting the second room clears the first,
 * or the ladder collapses into "rent all three, take +2 to everything" and the
 * choice between the rooms stops being a choice.
 *
 * Pure data + effect application; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import {
  AILMENT_STATUSES,
  makeDeepSlumber,
  makeHearthWarmed,
  makeWellRested,
  ROOM_BOON_DURATION_MINUTES,
  ROOM_BOON_STATUSES,
  STATUS_DEFS,
  type StatusEffect,
  type StatusId,
} from '../core/combat/StatusEffect';
import type { Player } from '../Player';
import { ALL_STATS, STAT_DEFS } from '../core/party/stats';
import {
  offerUnless,
  type ShopRow,
  type ShopPurchaseHandler,
} from '../ui/screens/shop/shopSession';
import type { ServiceIconId } from '../sprites/art/itemIcons/serviceIcons';
import { rotateLine } from './townServiceUtil';
import { SERVICE_PRICES } from '../economy/servicePrices';

interface InnRoom {
  readonly key: string;
  readonly label: string;
  readonly price: number;
  readonly art: ServiceIconId;
  /** The boon's own status type, so a re-rent can be recognised as a refresh. */
  readonly status: StatusId;
  readonly makeBoon: () => StatusEffect;
  /** Ossie's line on the way up the stairs. */
  readonly lines: ReadonlyArray<string>;
}

const ROOMS: ReadonlyArray<InnRoom> = [
  {
    key: 'room_attic',
    label: 'The Attic Cot',
    price: SERVICE_PRICES.inn.attic_room,
    art: 'room_attic',
    status: 'well_rested',
    makeBoon: makeWellRested,
    lines: [
      'Mind the beam. Everyone forgets the beam, and everyone only forgets it once.',
      'Straw tick, clean blanket, one window that shuts. You will sleep like the dead and get up as the opposite.',
      'Nine hours under the roof slates. You came in grey and you are leaving pink.',
    ],
  },
  {
    key: 'room_hearth',
    label: 'The Hearthside Room',
    price: SERVICE_PRICES.inn.hearth_room,
    art: 'room_hearth',
    status: 'hearth_warmed',
    makeBoon: makeHearthWarmed,
    lines: [
      'Fire stays banked till dawn. You will wake up warm right through, which is not a thing that happens on a dungeon floor.',
      'That is a real fire, not a System one. It does not want anything from you.',
      'Sleep by the coals and something in your arms remembers what it is for.',
    ],
  },
  {
    key: 'room_cats_own',
    label: "The Cat's Own Room",
    price: SERVICE_PRICES.inn.cats_own_room,
    art: 'room_cats_own',
    status: 'deep_slumber',
    makeBoon: makeDeepSlumber,
    lines: [
      'Best room in the house. Feather bed, bolt on the door, and the cat gets the pillow — house rule, not negotiable.',
      'Nobody knocks on that door. Not the guard, not Caroline, not me.',
      'You will not dream in there. You will just stop, and then it will be morning, and you will be quick again.',
    ],
  },
];

const ROOM_KEYS: ReadonlySet<string> = new Set(ROOMS.map((room) => room.key));

/** What a room's boon is worth, stated on the row — the player is paying for this, not for the bed. */
function boonSummary(status: StatusId): string {
  const boon = STATUS_DEFS[status].statBoon;
  return ALL_STATS.flatMap((stat) => {
    const amount = boon?.[stat] ?? 0;
    return amount === 0 ? [] : [`+${amount} ${STAT_DEFS[stat].code}`];
  }).join(' and ');
}

/** Whether a menu row bought at the inn is a room rather than something off the kitchen board. */
export function isInnRoomKey(key: string): boolean {
  return ROOM_KEYS.has(key);
}

/**
 * The guest wing's three rows.
 *
 * Deliberately never disabled for a crawler who is already at full health: the
 * boon is the product, and a healthy player refused a purchase they came in for
 * reads as a bug rather than as a rule.
 */
export function buildInnRoomOptions(townInDanger: boolean): ReadonlyArray<ShopRow> {
  return ROOMS.map((room): ShopRow => ({
    key: room.key,
    label: room.label,
    desc: `Mends you both, sleeps off what ails you, ${boonSummary(room.status)} for ${ROOM_BOON_DURATION_MINUTES} minutes`,
    art: { kind: 'service', service: room.art },
    offer: offerUnless(townInDanger ? 'Not tonight' : null, { kind: 'coins', coins: room.price }),
    questErrand: false,
  }));
}

/**
 * Rents the chosen room to the whole party.
 *
 * Renting the room whose boon is already running is allowed and refreshes it —
 * a player topping up before the stairs is doing the intended thing, and
 * refusing the sale would only send them down a floor on four remaining minutes.
 */
export function rentInnRoom(party: ReadonlyArray<Player>, turn: number): ShopPurchaseHandler {
  return (option) => {
    const room = ROOMS.find((candidate) => candidate.key === option.key);
    if (room === undefined) {
      return { ok: false, line: 'Ossie checks the register and shakes his head. No such room.' };
    }

    const refreshing = party.some((member) => member.hasStatus(room.status));
    for (const member of party) {
      member.cureStatuses(AILMENT_STATUSES);
      // The other two boons only. A whetstone edge or a Jugg Juice survives the
      // night — sleeping off something the player paid for would make the
      // cheapest bed in town a way to lose money.
      member.cureStatuses(ROOM_BOON_STATUSES);
      member.applyStatus(room.makeBoon());
      // Last, so a health boon's freshly-raised maximum is the one the
      // mend fills to.
      member.reviveToFull();
    }

    if (refreshing) {
      return { ok: true, line: 'Same room, same bed. Clock starts again, and so do you.' };
    }
    return { ok: true, line: rotateLine(room.lines, turn) };
  };
}
