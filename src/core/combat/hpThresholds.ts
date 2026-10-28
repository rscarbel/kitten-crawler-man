import type { EventBus, GameEvents } from '../EventBus';
import type { Player } from '../../Player';

/**
 * HP bands a crawler reacts to on the way down. A crawler is inside a band
 * when `0 < hp <= ceil(maxHp × share)`; a reaction fires once on entry and
 * re-arms only once HP climbs back above the band, so a crawler hovering at
 * the line or taking several hits inside it reacts once.
 *
 * To add one: name it in {@link HP_THRESHOLD_IDS}, then give it an entry in
 * {@link CRAWLER_HP_THRESHOLDS} (the table fails to compile until it has one).
 * Detection is `Player`'s own, run on every write to `hp`, so every way HP
 * goes down (a blow, a status tick, a scripted drop) is seen; the reaction
 * runs where the scene drains the crossing (`drainHpThresholdCrossings`), so
 * both gameplay scenes answer it the same way.
 */
export const HP_THRESHOLD_IDS = ['low_health', 'retch'] as const;

export type HpThresholdId = (typeof HP_THRESHOLD_IDS)[number];

/** Which crawler crossed, in the naming the event payloads use. */
export type CrawlerSide = GameEvents['healthLow']['player'];

/** One crawler's entry into a band, as handed to that band's reaction. */
export interface HpThresholdCrossing {
  readonly crawler: Player;
  readonly side: CrawlerSide;
  readonly hp: number;
  readonly maxHp: number;
}

/** A band and what entering it does. */
export interface HpThreshold {
  /** The band's top, as a share of max HP. */
  readonly share: number;
  /** Runs once per entry, in whichever scene the party is playing. */
  readonly onEnter: (crossing: HpThresholdCrossing, bus: EventBus) => void;
}

/** Below this share of max HP a crawler counts as on low health. */
const LOW_HEALTH_SHARE = 0.25;

/**
 * Below this share of max HP a crawler retches blood: a cue, costing nothing,
 * that the next blow may be the last.
 */
const RETCH_SHARE = 0.05;

export const CRAWLER_HP_THRESHOLDS = {
  low_health: {
    share: LOW_HEALTH_SHARE,
    onEnter: ({ side, hp, maxHp }, bus) => bus.emit('healthLow', { player: side, hp, maxHp }),
  },
  retch: {
    share: RETCH_SHARE,
    onEnter: ({ crawler }) => crawler.retch(),
  },
} as const satisfies Record<HpThresholdId, HpThreshold>;

/**
 * The top of `threshold`'s band for a body with `maxHp`: `ceil(maxHp × share)`,
 * never rounded down, so a small max HP still has a band at least one point
 * deep and a blow landing exactly on the line counts as inside it.
 */
export function hpThresholdTop(threshold: HpThreshold, maxHp: number): number {
  return Math.ceil(maxHp * threshold.share);
}

/**
 * Whether `hp` puts a crawler in the low-health band or under it, a downed body
 * included. The AI's fairness shield is this line, so the AI never treats as
 * fair game a crawler the game already calls low, nor spares one it does not.
 */
export function isAtOrUnderLowHealth(hp: number, maxHp: number): boolean {
  return hp <= hpThresholdTop(CRAWLER_HP_THRESHOLDS.low_health, maxHp);
}

/** Whether `hp` sits inside `threshold`'s band. A downed body (0 HP) is in no band. */
export function isInsideHpThreshold(threshold: HpThreshold, hp: number, maxHp: number): boolean {
  return hp > 0 && hp <= hpThresholdTop(threshold, maxHp);
}
