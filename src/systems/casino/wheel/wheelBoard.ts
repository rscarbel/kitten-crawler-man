import type { CrawlerKind } from '../../../core/skills/SkillManager';

export const WHEEL_MIN_BET = 1000;
export const WHEEL_MAX_BET = 6000;
export const WHEEL_BET_STEP = 1000;

/** Every legal bet, smallest first. */
export const WHEEL_BETS: readonly number[] = Array.from(
  { length: (WHEEL_MAX_BET - WHEEL_MIN_BET) / WHEEL_BET_STEP + 1 },
  (_, step) => WHEEL_MIN_BET + step * WHEEL_BET_STEP,
);

export const STORMCALLER_ITEM_ID = 'stormcaller';
export const KALEIDOSCOPE_SPECS_ITEM_ID = 'kaleidoscope_specs';
export const FAE_IRON_CHARM_ITEM_ID = 'fae_iron_charm';
export const FROSTWARD_CHARM_ITEM_ID = 'frostward_charm';
export const EMBERWARD_CHARM_ITEM_ID = 'emberward_charm';

export type EpicCharm = 'frost' | 'ember';

/** The charm an Epic wedge pays. */
export function epicCharmItemId(charm: EpicCharm) {
  return charm === 'frost' ? FROSTWARD_CHARM_ITEM_ID : EMBERWARD_CHARM_ITEM_ID;
}

/** Each crawler's own Legendary Weapon: the human's sword, the cat's specs. */
export function legendaryWeaponItemId(crawler: CrawlerKind) {
  return crawler === 'human' ? STORMCALLER_ITEM_ID : KALEIDOSCOPE_SPECS_ITEM_ID;
}

/**
 * The won-set entry recording one crawler's Legendary Weapon as issued. These
 * sit beside the wedge ids in the save's won set but name no wedge, so the
 * board never retires on one alone.
 */
export const LEGENDARY_WEAPON_CLAIM_IDS = {
  human: 'legendary_weapon_human',
  cat: 'legendary_weapon_cat',
} as const satisfies Record<CrawlerKind, string>;

export function otherCrawler(crawler: CrawlerKind): CrawlerKind {
  return crawler === 'human' ? 'cat' : 'human';
}

/**
 * Whose Legendary Weapon a landing on its wedge issues: the spinner's own,
 * or once that is claimed, the other crawler's, which goes to the other
 * crawler since it is theirs to wear.
 */
export function legendaryWeaponRecipient(
  spinner: CrawlerKind,
  won: ReadonlyArray<string>,
): CrawlerKind {
  return won.includes(LEGENDARY_WEAPON_CLAIM_IDS[spinner]) ? otherCrawler(spinner) : spinner;
}

/**
 * Every once-only prize. A prize id lands in the save's won set when it is won
 * and is never picked again until the Nothing or a reset clears that set. The
 * Legendary Weapon wedge pays twice, one crawler's weapon each time (see
 * {@link LEGENDARY_WEAPON_CLAIM_IDS}), and its id joins the won set only once
 * both have been issued.
 */
export const WHEEL_PRIZE_IDS = [
  'pet',
  'gold_50k',
  'legendary_weapon',
  'free_handies',
  'epic_charm_frost',
  'epic_charm_ember',
  'legendary_charm',
  'gold_500k',
  'gold_10k',
  'rare_chest',
  'gold_25k',
  'uncommon_chest',
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
  | { readonly kind: 'legendary_weapon' }
  | { readonly kind: 'free_handies' }
  | { readonly kind: 'epic_charm'; readonly charm: EpicCharm }
  | { readonly kind: 'legendary_charm' }
  | { readonly kind: 'rare_chest' }
  | { readonly kind: 'uncommon_chest' }
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
  /**
   * The face still showing under strips of tape: the wedge plays as this one,
   * but the wheel paints the old face, taped over and relabelled by hand.
   */
  readonly tapedOver?: WheelWedge;
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

/**
 * The Nothing as a quest's free spin shows it: taped over with "Spin Again"
 * written on the tape, and paying exactly what Spin Again pays.
 */
export const TAPED_NOTHING: WheelWedge = {
  ...spinAgain('nothing_taped'),
  units: NOTHING.units,
  tapedOver: NOTHING,
};

/**
 * `board` with every Nothing taped over. No wedge on the result wipes the
 * save, so a draw from it cannot reach the Nothing whatever the weights.
 */
export function tapedBoard(board: WheelBoard): WheelBoard {
  return board.map((wedge) => (wedge.prize.kind === 'nothing' ? TAPED_NOTHING : wedge));
}

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
  good('epic_charm_frost', 'An Epic charm (frost)', 'EPIC CHARM', 'purple', {
    kind: 'epic_charm',
    charm: 'frost',
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
  good('legendary_charm', 'A Legendary charm', 'LEGENDARY CHARM', 'purple', {
    kind: 'legendary_charm',
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
  good('epic_charm_ember', 'An Epic charm (ember)', 'EPIC CHARM', 'purple', {
    kind: 'epic_charm',
    charm: 'ember',
  }),
  red('poisoned_2', POISON_LABEL, 'POISONED', { kind: 'poison' }),
  good('legendary_weapon', 'A Legendary weapon', 'LEGENDARY WEAPON', 'purple', {
    kind: 'legendary_weapon',
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
    good('rare_chest', 'A Rare prize', 'RARE PRIZE', 'gold', { kind: 'rare_chest' }),
  ),
  upgrade(
    'robbed',
    good('gold_25k', '25,000 gold', '25,000 GOLD', 'gold', { kind: 'gold', amount: GOLD_25K }),
  ),
  upgrade(
    'poisoned_2',
    good('uncommon_chest', 'An Uncommon prize', 'UNCOMMON PRIZE', 'green', {
      kind: 'uncommon_chest',
    }),
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
