/**
 * What one quest-complete screen shows. A quest builds a {@link QuestRewardSpec}
 * from the rewards it has just paid and emits it as `questRewardShown`; the
 * scene's one `QuestRewardScreen` queues it and raises it when nothing else
 * holds the screen.
 */

import type { GrantedReward } from '../../core/GrantedReward';
import type { ItemId } from '../../core/ItemDefs';

/** Paints an icon into the largest square centred in `rect`. */
export type IconPainter = GrantedReward['renderIcon'];

/** One line in an `items` section: an icon, a name and how many were given. */
export interface RewardItemLine extends Pick<GrantedReward, 'name' | 'renderIcon'> {
  readonly count: number;
  /** What the item does, drawn under its name. */
  readonly description?: string;
  /** A muted aside, such as where the thing can be used. */
  readonly note?: string;
  /**
   * The bag item this line stands for, so the scene can fly it to the bag once
   * the screen is dismissed. Absent for a reward that never enters a bag (a
   * loot box goes to the achievements stack).
   */
  readonly itemId?: ItemId;
}

/** One line of an unlock card's body. */
export interface RewardCardLine {
  readonly text: string;
  /** Drawn bold in the accent colour, for the line that carries the headline number. */
  readonly emphasis?: boolean;
}

/**
 * A card in an `unlocks` section: something the quest opened up for good
 * rather than handed over, such as a station upgrade or a new destination.
 */
export interface RewardUnlockCard {
  readonly renderIcon: IconPainter;
  readonly title: string;
  readonly body: readonly RewardCardLine[];
  /** A muted line under the body naming what still stands between the player and the unlock. */
  readonly condition?: string;
}

/** One block of the screen. The screen fixes their order, whatever order they are listed in. */
export type QuestRewardSection =
  | {
      readonly kind: 'xp';
      /** What `awardXp` returned, not the flat award. */
      readonly amount: number;
      /** Who it went to, when the quest pays more than one crawler or wants to say which. */
      readonly recipient?: string;
    }
  | { readonly kind: 'coins'; readonly amount: number }
  | { readonly kind: 'items'; readonly items: readonly RewardItemLine[] }
  | {
      readonly kind: 'unlocks';
      readonly heading: string;
      readonly cards: readonly RewardUnlockCard[];
    };

/** Everything one quest-complete screen shows. Leave a section out and it is not drawn. */
export interface QuestRewardSpec {
  readonly questTitle: string;
  readonly renderQuestIcon?: IconPainter;
  /** The quest giver's line. */
  readonly quote?: { readonly text: string; readonly speaker: string };
  readonly sections: readonly QuestRewardSection[];
  readonly footnote?: string;
  /**
   * Runs when the player dismisses this screen, and never when it is dropped
   * unread by a rewind or a teardown — the place for a quest to record that
   * the screen has been seen.
   */
  readonly onDismissed?: () => void;
}
