/**
 * The Barracks' drill yard — Corporal Pell's counter, sold in sweat rather than
 * across a shelf.
 *
 * The town's third permanent-stat sink, and deliberately a different shape from
 * the other two. The parlour's ink is one point, one design, one per skin. The
 * inn's rooms are a bigger boon that expires. This is four points at most, one
 * at a time, each dearer than the last — so a crawler who wants all four feels
 * the yard closing before it shuts.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { Player, StatName } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

/** Stat points one bought session is worth. */
const DRILL_STAT_POINTS = 1;

/**
 * What the *n*th point costs, indexed by how many the crawler already has. Each
 * one dearer than the last: the cap is meant to be felt as diminishing returns
 * on the way up rather than hit as a wall at the top, and a flat price would
 * make the fourth point the same purchase as the first.
 */
const FIRST_POINT_PRICE = 35;
const SECOND_POINT_PRICE = 75;
const THIRD_POINT_PRICE = 150;
const FOURTH_POINT_PRICE = 275;
const DRILL_PRICES: ReadonlyArray<number> = [
  FIRST_POINT_PRICE,
  SECOND_POINT_PRICE,
  THIRD_POINT_PRICE,
  FOURTH_POINT_PRICE,
];

/**
 * Points a crawler may buy here in total, across every stat. Taken from the
 * price ladder's own length rather than stated twice: a cap higher than the
 * ladder would quote a point that has no price.
 */
export const DRILL_TRAINING_CAP = DRILL_PRICES.length;

const DRILL_ROWS: ReadonlyArray<{
  readonly key: string;
  readonly stat: StatName;
  readonly label: string;
  readonly desc: string;
  readonly taught: string;
}> = [
  {
    key: 'pell_work',
    stat: 'strength',
    label: 'Pell Work',
    desc: `Hours on the straw man until the swing comes off the hip. +${DRILL_STAT_POINTS} Strength`,
    taught: 'Again. Again. There — that one came off the hip. Keep it.',
  },
  {
    key: 'shield_hours',
    stat: 'constitution',
    label: 'Shield Hours',
    desc: `Stand in the ring and be hit until standing stops being a decision. +${DRILL_STAT_POINTS} Constitution`,
    taught:
      'You stopped flinching about an hour ago and did not notice. That is what you paid for.',
  },
  {
    key: 'footwork',
    stat: 'dexterity',
    label: 'Footwork',
    desc: `Sand, rope and a stick across the ankles. +${DRILL_STAT_POINTS} Dexterity`,
    taught: 'You are off the line now instead of backing down it. Do not go proud about it.',
  },
  {
    key: 'stairwells',
    stat: 'intelligence',
    label: 'Reading a Stairwell',
    desc: `Where they wait, which way they come, what a floor's shape is telling you. +${DRILL_STAT_POINTS} Intelligence`,
    taught: 'You will see the room before you are in it now. That is worth more than the swing.',
  },
];

const SERGEANT_BARKS: ReadonlyArray<string> = [
  'The sand is free. What I know is not, and I have not got much of it left to sell.',
  'Pick one. Do not pick all four and expect me to still be interested by the fourth.',
  'I cannot make you good. I can make you late to die, which is the whole trade.',
];

/** The line the yard shows on every row once a crawler has bought all it teaches. */
const DRILL_EXHAUSTED = 'Nothing left I can teach you';

/** What the next point costs this crawler, or `null` when they are at the cap. */
function nextPrice(player: Player): number | null {
  return DRILL_PRICES[player.drillTraining] ?? null;
}

/** The drill yard's board for this crawler. */
export function buildDrillYardMenu(
  player: Player,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const price = nextPrice(player);
  return {
    title: 'The Drill Yard',
    bark: host?.line ?? rotateLine(SERGEANT_BARKS, turn),
    byline: host?.name,
    options: DRILL_ROWS.map((row): PricedOption => {
      const option: PricedOption = {
        key: row.key,
        label: row.label,
        // A capped row carries the last rung's price only because the field is
        // required; the panel draws `unavailable` in the price's place, so this
        // number is never shown once the yard is spent.
        price: price ?? FOURTH_POINT_PRICE,
        desc: row.desc,
      };
      if (price === null) option.unavailable = DRILL_EXHAUSTED;
      return option;
    }),
  };
}

/** Runs the chosen drill, banking one permanent point against the crawler's cap. */
export const runDrill: PricedPurchaseHandler = (option, buyer) => {
  if (nextPrice(buyer) === null) {
    return { ok: false, line: `${DRILL_EXHAUSTED}. Go and use it.` };
  }
  const row = DRILL_ROWS.find((candidate) => candidate.key === option.key);
  if (row === undefined) return { ok: false, line: 'Pell looks at the sand and says nothing.' };
  buyer.applyPermanentStat(row.stat, DRILL_STAT_POINTS);
  buyer.drillTraining++;
  return { ok: true, line: row.taught };
};
