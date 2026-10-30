import type { PartyGroupId, PartyLocation } from '../../core/party/partySplit';
import type { ArrivalCard } from './partyTransfer';

/**
 * One stretch of a split played by one group. A quest that splits the party
 * declares its chapters as a `readonly` table of these, in play order, and
 * `SplitDirector.runChapters` plays them.
 */
export interface SplitChapter<QuestState> {
  /** The group that plays it. */
  readonly group: PartyGroupId;
  /** Where that group stands when the chapter opens, or null for wherever it was left. */
  readonly start: PartyLocation | null;
  /** The "Meanwhile…" card the chapter opens behind. */
  readonly card: ArrivalCard;
  /** True once the chapter is over, read off the owning quest's own state. */
  readonly endsWhen: (questState: QuestState) => boolean;
}
