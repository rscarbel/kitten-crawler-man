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
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import {
  AILMENT_STATUSES,
  makeDeepSlumber,
  makeHearthWarmed,
  makeWellRested,
  ROOM_BOON_DURATION_MINUTES,
  ROOM_BOON_STATUSES,
  type StatusEffect,
} from '../core/StatusEffect';
import type { Player } from '../Player';
import type { PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import { rotateLine } from './townServiceUtil';

interface InnRoom {
  readonly key: string;
  readonly label: string;
  readonly price: number;
  /** The boon's own status type, so a re-rent can be recognised as a refresh. */
  readonly status: string;
  /** What the boon is worth, stated on the row — the player is paying for this, not for the bed. */
  readonly boonSummary: string;
  readonly makeBoon: () => StatusEffect;
  /** Ossie's line on the way up the stairs. */
  readonly lines: ReadonlyArray<string>;
}

const ATTIC_ROOM_PRICE = 25;
const HEARTH_ROOM_PRICE = 55;
const CATS_OWN_ROOM_PRICE = 90;

const ROOMS: ReadonlyArray<InnRoom> = [
  {
    key: 'room_attic',
    label: 'The Attic Cot',
    price: ATTIC_ROOM_PRICE,
    status: 'well_rested',
    boonSummary: '+2 CON',
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
    price: HEARTH_ROOM_PRICE,
    status: 'hearth_warmed',
    boonSummary: '+2 STR',
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
    price: CATS_OWN_ROOM_PRICE,
    status: 'deep_slumber',
    boonSummary: '+2 DEX and +2 INT',
    makeBoon: makeDeepSlumber,
    lines: [
      'Best room in the house. Feather bed, bolt on the door, and the cat gets the pillow — house rule, not negotiable.',
      'Nobody knocks on that door. Not the guard, not the System, not me.',
      'You will not dream in there. You will just stop, and then it will be morning, and you will be quick again.',
    ],
  },
];

const ROOM_KEYS: ReadonlySet<string> = new Set(ROOMS.map((room) => room.key));

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
export function buildInnRoomOptions(townInDanger: boolean): ReadonlyArray<PricedOption> {
  return ROOMS.map((room) => {
    const option: PricedOption = {
      key: room.key,
      label: room.label,
      price: room.price,
      desc: `Mends you both, sleeps off what ails you, ${room.boonSummary} for ${ROOM_BOON_DURATION_MINUTES} minutes`,
    };
    if (townInDanger) option.unavailable = 'Not tonight';
    return option;
  });
}

/**
 * Rents the chosen room to the whole party.
 *
 * Renting the room whose boon is already running is allowed and refreshes it —
 * a player topping up before the stairs is doing the intended thing, and
 * refusing the sale would only send them down a floor on four remaining minutes.
 */
export function rentInnRoom(party: ReadonlyArray<Player>, turn: number): PricedPurchaseHandler {
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
      // Last, so a constitution boon's freshly-raised maximum is the one the
      // mend fills to.
      member.reviveToFull();
    }

    if (refreshing) {
      return { ok: true, line: 'Same room, same bed. Clock starts again, and so do you.' };
    }
    return { ok: true, line: rotateLine(room.lines, turn) };
  };
}
