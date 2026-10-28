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
 * Pure data + effect application; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { Player } from '../Player';
import { ALL_STATS, STAT_DEFS, type StatId } from '../core/party/stats';
import type {
  ShopMenu,
  ShopOffer,
  ShopRow,
  ShopPurchaseHandler,
} from '../ui/screens/shop/shopSession';
import type { ServiceIconId } from '../sprites/art/itemIcons/serviceIcons';
import { hostByline, type ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';
import { SERVICE_PRICES } from '../economy/servicePrices';
import type { PlannedBuildingId } from '../map/buildingIds';

/** The garrison whose guard runs the drill yard. */
export const DRILL_YARD_BUILDING = 'taloncrest_barracks' as const satisfies PlannedBuildingId;

/** Stat points one bought session is worth. */
const DRILL_STAT_POINTS = 1;

/** What the *n*th point costs, indexed by how many the crawler already has. */
const DRILL_PRICES: ReadonlyArray<number> = [
  SERVICE_PRICES.drill_yard.first_point,
  SERVICE_PRICES.drill_yard.second_point,
  SERVICE_PRICES.drill_yard.third_point,
  SERVICE_PRICES.drill_yard.fourth_point,
];

/**
 * Points a crawler may buy here in total, across every stat. Taken from the
 * price ladder's own length rather than stated twice: a cap higher than the
 * ladder would quote a point that has no price.
 */
export const DRILL_TRAINING_CAP = DRILL_PRICES.length;

interface DrillRow {
  readonly key: string;
  readonly art: ServiceIconId;
  readonly label: string;
  /** What the drill is, before the stat it raises is named. */
  readonly pitch: string;
  readonly taught: string;
}

/** One drill per stat, listed in the stat sheet's order. */
const DRILLS = {
  health: {
    key: 'shield_hours',
    art: 'drill_health',
    label: 'Shield Hours',
    pitch: 'Stand in the ring and be hit until standing stops being a decision.',
    taught:
      'You stopped flinching about an hour ago and did not notice. That is what you paid for.',
  },
  melee: {
    key: 'pell_work',
    art: 'drill_melee',
    label: 'Pell Work',
    pitch: 'Hours on the straw man until the swing comes off the hip.',
    taught: 'Again. Again. There — that one came off the hip. Keep it.',
  },
  magic: {
    key: 'stairwells',
    art: 'drill_magic',
    label: 'Reading a Stairwell',
    pitch: "Where they wait, which way they come, what a floor's shape is telling you.",
    taught: 'You will see the room before you are in it now. That is worth more than the swing.',
  },
  evasiveness: {
    key: 'footwork',
    art: 'drill_evasiveness',
    label: 'Footwork',
    pitch: 'Sand, rope and a stick across the ankles.',
    taught: 'You are off the line now instead of backing down it. Do not go proud about it.',
  },
  ranged: {
    key: 'butts',
    art: 'drill_ranged',
    label: 'The Butts',
    pitch: 'Stones at a straw target until you stop watching your own hand.',
    taught: 'You looked at the mark and not the sling. That is the whole of it.',
  },
  explosivesHandling: {
    key: 'powder_shed',
    art: 'drill_explosives',
    label: 'The Powder Shed',
    pitch: 'Short fuses, long throws, and a sandbag wall you will learn to love.',
    taught: 'All ten fingers. You would be amazed how few leave this shed with all ten.',
  },
} as const satisfies Record<StatId, DrillRow>;

/** What a drill of `stat` raises `player`'s stat by. */
function drillGain(player: Player, stat: StatId): number {
  return DRILL_STAT_POINTS * player.boughtStatGainPerPoint(stat);
}

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

/** Whether the yard still has a point to teach this crawler; once every crawler is capped it never trades again. */
export function drillYardHasTraining(player: Player): boolean {
  return nextPrice(player) !== null;
}

/** The drill yard's board for this crawler. */
export function buildDrillYardMenu(
  player: Player,
  turn: number,
  host: ResidentHost | null,
): ShopMenu {
  const price = nextPrice(player);
  const offer: ShopOffer =
    price === null
      ? { status: 'spent', reason: DRILL_EXHAUSTED }
      : { status: 'open', cost: { kind: 'coins', coins: price } };
  return {
    title: 'The Drill Yard',
    bark: host?.line ?? rotateLine(SERGEANT_BARKS, turn),
    byline: hostByline(host),
    emblem: null,
    options: ALL_STATS.map((stat): ShopRow => ({
      key: DRILLS[stat].key,
      label: DRILLS[stat].label,
      desc: `${DRILLS[stat].pitch} +${drillGain(player, stat)} ${STAT_DEFS[stat].label}`,
      art: { kind: 'service', service: DRILLS[stat].art },
      offer,
      questErrand: false,
    })),
  };
}

/** Runs the chosen drill, banking one permanent point against the crawler's cap. */
export const runDrill: ShopPurchaseHandler = (option, buyer) => {
  if (nextPrice(buyer) === null) {
    return { ok: false, line: `${DRILL_EXHAUSTED}. Go and use it.` };
  }
  const stat = ALL_STATS.find((candidate) => DRILLS[candidate].key === option.key);
  if (stat === undefined) return { ok: false, line: 'Pell looks at the sand and says nothing.' };
  buyer.applyPermanentStat(stat, DRILL_STAT_POINTS);
  buyer.drillTraining++;
  return { ok: true, line: DRILLS[stat].taught };
};
