/**
 * The pronouns text uses for each crawler. The human's follow the body the
 * player chose; the cat is always "she".
 */

import type { CrawlerKind } from '../core/skills/SkillManager';
import type { CrawlerBody } from './crawlerChoices';
import { playerIdentity } from './playerIdentity';

export interface CrawlerPronouns {
  /** "he" / "she" */
  readonly subject: string;
  /** "him" / "her" */
  readonly object: string;
  /** "his" / "her", before a noun. */
  readonly possessive: string;
  /** "his" / "hers", standing alone. */
  readonly possessivePronoun: string;
  /** "himself" / "herself" */
  readonly reflexive: string;
}

export const CRAWLER_PRONOUNS = {
  male: {
    subject: 'he',
    object: 'him',
    possessive: 'his',
    possessivePronoun: 'his',
    reflexive: 'himself',
  },
  female: {
    subject: 'she',
    object: 'her',
    possessive: 'her',
    possessivePronoun: 'hers',
    reflexive: 'herself',
  },
} as const satisfies Record<CrawlerBody, CrawlerPronouns>;

/** Each body's pronouns as the AI's session context names them. */
export const PRONOUN_LABELS = {
  male: 'he/him',
  female: 'she/her',
} as const satisfies Record<CrawlerBody, `${string}/${string}`>;

const CAT_PRONOUNS: CrawlerPronouns = CRAWLER_PRONOUNS.female;

/** Crawler `kind`'s pronouns, read when the text is built. */
export function crawlerPronouns(kind: CrawlerKind): CrawlerPronouns {
  return kind === 'human' ? CRAWLER_PRONOUNS[playerIdentity().body] : CAT_PRONOUNS;
}
