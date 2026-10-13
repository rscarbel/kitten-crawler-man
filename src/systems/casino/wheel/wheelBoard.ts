import type { CrawlerKind } from '../../../core/SkillManager';

export const WHEEL_MIN_BET = 1000;
export const WHEEL_MAX_BET = 6000;
export const WHEEL_BET_STEP = 1000;

/** Every legal bet, smallest first. */
export const WHEEL_BETS: readonly number[] = Array.from(
  { length: (WHEEL_MAX_BET - WHEEL_MIN_BET) / WHEEL_BET_STEP + 1 },
  (_, step) => WHEEL_MIN_BET + step * WHEEL_BET_STEP,
);

export const FURY_OF_TARANIS_ITEM_ID = 'fury_of_taranis';
export const EYES_OF_SPLATTER_ITEM_ID = 'eyes_of_splatter';
export const FAIRY_REPELLENT_SIGNET_ITEM_ID = 'fairy_repellent_signet';
export const RING_OF_THE_COLD_SHOULDER_ITEM_ID = 'ring_of_the_cold_shoulder';
export const RING_OF_THE_ASBESTOS_KNUCKLE_ITEM_ID = 'ring_of_the_asbestos_knuckle';

export type PlatinumRing = 'frost' | 'ember';

/** The ring a Platinum wedge pays. */
export function platinumRingItemId(ring: PlatinumRing) {
  return ring === 'frost'
    ? RING_OF_THE_COLD_SHOULDER_ITEM_ID
    : RING_OF_THE_ASBESTOS_KNUCKLE_ITEM_ID;
}

/** The Legendary Weapon wedge's weapon, fixed by whichever crawler spun when it was won. */
export function legendaryWeaponItemId(crawler: CrawlerKind) {
  return crawler === 'human' ? FURY_OF_TARANIS_ITEM_ID : EYES_OF_SPLATTER_ITEM_ID;
}

/**
 * Every once-only prize. A prize id lands in the save's won set when it is won
 * and is never picked again until the Nothing or a reset clears that set. The
 * Legendary Weapon is one id for the whole party, so only one of the two
 * crawler weapons can ever be won.
 */
export const WHEEL_PRIZE_IDS = [
  'pet',
  'gold_50k',
  'legendary_weapon_box',
  'free_handies',
  'platinum_box_frost',
  'platinum_box_ember',
  'legendary_box',
  'gold_500k',
  'gold_10k',
  'gold_box',
  'gold_25k',
  'silver_box',
  'heal_and_gold',
] as const;

export type WheelPrizeId = (typeof WHEEL_PRIZE_IDS)[number];

const PRIZE_ID_SET: ReadonlySet<string> = new Set(WHEEL_PRIZE_IDS);

/** Narrows an unknown value (for example a parsed save field) to a prize id. */
export function isWheelPrizeId(value: unknown): value is WheelPrizeId {
  return typeof value === 'string' && PRIZE_ID_SET.has(value);
}

/** What a wedge does when it lands; the host switches on `kind`. */
export type WheelPrize =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'stab' }
  | { readonly kind: 'poison' }
  | { readonly kind: 'blood_vomit' }
  | { readonly kind: 'burn' }
  | { readonly kind: 'freeze' }
  | { readonly kind: 'robbed' }
  | { readonly kind: 'spin_again' }
  | { readonly kind: 'pet' }
  | { readonly kind: 'gold'; readonly amount: number }
  | { readonly kind: 'legendary_weapon_box' }
  | { readonly kind: 'free_handies' }
  | { readonly kind: 'platinum_box'; readonly ring: PlatinumRing }
  | { readonly kind: 'legendary_box' }
  | { readonly kind: 'gold_box' }
  | { readonly kind: 'silver_box' }
  | { readonly kind: 'heal_and_gold'; readonly amount: number };

export type WheelPrizeKind = WheelPrize['kind'];

export type WheelTone = 'red' | 'green' | 'gold' | 'purple' | 'neutral';

export interface WheelWedge {
  /** Unique per wedge face; a flipped wedge shows a different face with its own id. */
  readonly id: string;
  /** The full prize name, shown when the wheel lands. */
  readonly label: string;
  /** The legible form painted on the wedge, and the landing banner's title. */
  readonly shortLabel: string;
  /**
   * A compact name for a wedge too narrow to letter: the wheel flies it on a
   * flag outside the rim instead. Null on a wedge wide enough for its label.
   */
  readonly flagLabel: string | null;
  /** Size on the rim; a normal wedge is 1 unit. */
  readonly units: number;
  readonly tone: WheelTone;
  readonly prize: WheelPrize;
  /** Set on once-only good prizes; null on red and Spin Again, which never retire. */
  readonly prizeId: WheelPrizeId | null;
}

export type WheelBoard = readonly WheelWedge[];

const NORMAL_UNITS = 1;
const NOTHING_UNITS = 2;
const SLIVER_UNITS = 0.25;

const GOLD_50K = 50_000;
const GOLD_500K = 500_000;
const GOLD_10K = 10_000;
const GOLD_25K = 25_000;
const HEAL_BONUS_GOLD = 5_000;

function red(id: string, label: string, shortLabel: string, prize: WheelPrize): WheelWedge {
  return {
    id,
    label,
    shortLabel,
    flagLabel: null,
    units: NORMAL_UNITS,
    tone: 'red',
    prize,
    prizeId: null,
  };
}

function good(
  prizeId: WheelPrizeId,
  label: string,
  shortLabel: string,
  tone: WheelTone,
  prize: WheelPrize,
  sizing: { readonly units: number; readonly flagLabel: string } | null = null,
): WheelWedge {
  return {
    id: prizeId,
    label,
    shortLabel,
    flagLabel: sizing?.flagLabel ?? null,
    units: sizing?.units ?? NORMAL_UNITS,
    tone,
    prize,
    prizeId,
  };
}

function spinAgain(id: string): WheelWedge {
  return {
    id,
    label: 'Spin Again',
    shortLabel: 'SPIN AGAIN',
    flagLabel: null,
    units: NORMAL_UNITS,
    tone: 'neutral',
    prize: { kind: 'spin_again' },
    prizeId: null,
  };
}

const NOTHING: WheelWedge = {
  id: 'nothing',
  label: 'Nothing!',
  shortLabel: 'NOTHING!',
  flagLabel: null,
  units: NOTHING_UNITS,
  tone: 'red',
  prize: { kind: 'nothing' },
  prizeId: null,
};

const STAB_LABEL = 'Get stabbed in the stomach by the croupier';
const POISON_LABEL = 'Get poisoned';
const VOMIT_LABEL = 'Vomit blood for ten minutes straight';

/**
 * Ring order at the minimum bet, clockwise. No two good wedges touch, and the
 * Nothing! sits between the Legendary Weapon and 50,000 gold so a near miss
 * on either side of the biggest prizes costs everything.
 */
export const BASE_WHEEL_BOARD: WheelBoard = [
  NOTHING,
  good('gold_50k', '50,000 gold', '50,000 GOLD', 'gold', { kind: 'gold', amount: GOLD_50K }),
  red('stabbed_1', STAB_LABEL, 'STABBED', { kind: 'stab' }),
  good('pet', 'A new pet', 'A NEW PET', 'green', { kind: 'pet' }),
  red('poisoned_1', POISON_LABEL, 'POISONED', { kind: 'poison' }),
  red('set_on_fire', 'Get set on fire', 'ON FIRE', { kind: 'burn' }),
  good('platinum_box_frost', 'A Platinum ring (frost)', 'PLATINUM RING', 'purple', {
    kind: 'platinum_box',
    ring: 'frost',
  }),
  red('vomit_blood_1', VOMIT_LABEL, 'VOMIT BLOOD', { kind: 'blood_vomit' }),
  spinAgain('spin_again_1'),
  good(
    'gold_500k',
    '500,000 gold',
    '500,000 GOLD',
    'gold',
    { kind: 'gold', amount: GOLD_500K },
    { units: SLIVER_UNITS, flagLabel: '500K' },
  ),
  spinAgain('spin_again_2'),
  red('stabbed_2', STAB_LABEL, 'STABBED', { kind: 'stab' }),
  good('legendary_box', 'A Legendary ring', 'LEGENDARY RING', 'purple', {
    kind: 'legendary_box',
  }),
  red('frozen_solid', 'Get frozen solid', 'FROZEN', { kind: 'freeze' }),
  good(
    'free_handies',
    'Unlimited Free Handies over at Bitches or Penis Parade',
    'FREE HANDIES',
    'green',
    { kind: 'free_handies' },
  ),
  red('vomit_blood_2', VOMIT_LABEL, 'VOMIT BLOOD', { kind: 'blood_vomit' }),
  red('robbed', "Robbed: lose half the gold you're carrying", 'ROBBED', { kind: 'robbed' }),
  good('platinum_box_ember', 'A Platinum ring (ember)', 'PLATINUM RING', 'purple', {
    kind: 'platinum_box',
    ring: 'ember',
  }),
  red('poisoned_2', POISON_LABEL, 'POISONED', { kind: 'poison' }),
  good('legendary_weapon_box', 'A Legendary weapon', 'LEGENDARY WEAPON', 'purple', {
    kind: 'legendary_weapon_box',
  }),
];

/** Wedge ids that no bet ever flips. */
export const PERMANENT_RED_WEDGE_IDS = [
  'nothing',
  'vomit_blood_1',
  'vomit_blood_2',
  'stabbed_1',
  'poisoned_1',
] as const;

export interface WheelUpgrade {
  /** Ring position that flips in place. */
  readonly wedgeIndex: number;
  /** The red face it replaces, for flipping back when the bet drops. */
  readonly from: WheelWedge;
  readonly to: WheelWedge;
}

function baseIndexOf(id: string): number {
  const index = BASE_WHEEL_BOARD.findIndex((wedge) => wedge.id === id);
  if (index < 0) throw new Error(`wheel board has no wedge ${id}`);
  return index;
}

function upgrade(fromId: string, to: WheelWedge): WheelUpgrade {
  const wedgeIndex = baseIndexOf(fromId);
  return { wedgeIndex, from: BASE_WHEEL_BOARD[wedgeIndex], to };
}

/** One upgrade per bet step above the minimum, applied in this order. */
export const WHEEL_UPGRADES: readonly WheelUpgrade[] = [
  upgrade(
    'set_on_fire',
    good('gold_10k', '10,000 gold', '10,000 GOLD', 'gold', { kind: 'gold', amount: GOLD_10K }),
  ),
  upgrade(
    'frozen_solid',
    good('gold_box', 'A Gold prize', 'GOLD PRIZE', 'gold', { kind: 'gold_box' }),
  ),
  upgrade(
    'robbed',
    good('gold_25k', '25,000 gold', '25,000 GOLD', 'gold', { kind: 'gold', amount: GOLD_25K }),
  ),
  upgrade(
    'poisoned_2',
    good('silver_box', 'A Silver prize', 'SILVER PRIZE', 'green', { kind: 'silver_box' }),
  ),
  upgrade(
    'stabbed_2',
    good('heal_and_gold', 'A full heal and 5,000 gold', 'HEAL + 5,000', 'green', {
      kind: 'heal_and_gold',
      amount: HEAL_BONUS_GOLD,
    }),
  ),
];

/** Snaps any number onto the bet ladder. */
export function clampWheelBet(bet: number): number {
  const steps = Math.round((bet - WHEEL_MIN_BET) / WHEEL_BET_STEP);
  const clampedSteps = Math.max(0, Math.min(WHEEL_UPGRADES.length, steps));
  return WHEEL_MIN_BET + clampedSteps * WHEEL_BET_STEP;
}

/** How many upgrades a bet buys. */
export function upgradeCountForBet(bet: number): number {
  return (clampWheelBet(bet) - WHEEL_MIN_BET) / WHEEL_BET_STEP;
}

/** The upgrade the step from `bet` to `bet + WHEEL_BET_STEP` flips, or null at the maximum. */
export function upgradeForStepAbove(bet: number): WheelUpgrade | null {
  const count = upgradeCountForBet(bet);
  return count < WHEEL_UPGRADES.length ? WHEEL_UPGRADES[count] : null;
}

/** The board for a bet: the base ring with each bought upgrade flipped in place. */
export function boardForBet(bet: number): WheelBoard {
  const board = [...BASE_WHEEL_BOARD];
  for (const applied of WHEEL_UPGRADES.slice(0, upgradeCountForBet(bet))) {
    board[applied.wedgeIndex] = applied.to;
  }
  return board;
}

/** Total units around the rim. */
export function boardUnits(board: WheelBoard): number {
  return board.reduce((sum, wedge) => sum + wedge.units, 0);
}

export function isRedWedge(wedge: WheelWedge): boolean {
  return wedge.tone === 'red';
}
