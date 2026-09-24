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
