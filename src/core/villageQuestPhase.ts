/**
 * Where the Briar Hollow defense quest stands. Phases move forward in this
 * order, except `declined` and the two outcome branches, which are exits off
 * the normal path rather than steps on it.
 */
export type VillageQuestPhase =
  | 'unmet'
  | 'offered'
  | 'declined'
  | 'need_tools'
  | 'gathering'
  | 'fortifying'
  | 'imminent'
  | 'assault'
  | 'repelled_failed'
  | 'victory'
  | 'complete';

/** The quest's phases before the Mayor's offer has been accepted. */
const PHASES_BEFORE_MAYOR_ACCEPTED: ReadonlySet<VillageQuestPhase> = new Set([
  'unmet',
  'offered',
  'declined',
]);

/**
 * Whether the party has agreed to help the Mayor yet. Gates anything that
 * should only be available once the village has vouched for the crawlers,
 * such as the militia taking orders.
 */
export function hasAcceptedMayorRequest(phase: VillageQuestPhase): boolean {
  return !PHASES_BEFORE_MAYOR_ACCEPTED.has(phase);
}
