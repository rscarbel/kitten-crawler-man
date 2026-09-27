/**
 * Briar Hollow's four unnamed villagers. They have no conversation, only a
 * bubble over their heads — when spoken to, and now and then when the party
 * passes — so a few lines each is all they need.
 */

import { transientSpeaker } from '../../line';
import type { BarkLine, NonEmpty } from '../../line';

export type UnnamedVillagerId = 'elder_bracken' | 'elder_thistle' | 'child_nib' | 'child_burr';

export interface UnnamedVillager {
  readonly description: string;
  readonly lines: NonEmpty<BarkLine>;
}

const elderBracken = transientSpeaker('Elder Bracken', 'townsfolk');
const elderThistle = transientSpeaker('Elder Thistle', 'townsfolk');
const childNib = transientSpeaker('Nib', 'townsfolk');
const childBurr = transientSpeaker('Burr', 'townsfolk');

export const ELDER_BRACKEN: UnnamedVillager = {
  description: "One of Briar Hollow's elders. Minds the cows and remembers quieter seasons.",
  lines: [
    elderBracken.bark('I remember when those ruins were only ruins.'),
    elderBracken.bark("Mind the calves. They're braver than they look."),
  ],
};

export const ELDER_THISTLE: UnnamedVillager = {
  description: "One of Briar Hollow's elders. Has sat through twelve years of town meetings.",
  lines: [
    elderThistle.bark("Twelve seasons Bramblewick's been mayor. Twelve seasons of meetings."),
    elderThistle.bark('The bell used to mean supper.'),
  ],
};

export const CHILD_NIB: UnnamedVillager = {
  description: 'A Briar Hollow child, endlessly curious about the Crawlers.',
  lines: [
    childNib.bark('Are you really Crawlers? Is the cat really a cat?'),
    childNib.bark("I'm not scared. Mostly."),
  ],
};

export const CHILD_BURR: UnnamedVillager = {
  description: 'A Briar Hollow child, warned to stay well clear of the quarry.',
  lines: [
    childBurr.bark('Mama says never go past the quarry.'),
    childBurr.bark('Garn let me hold a rock once. A big one.'),
  ],
};

/**
 * All any of them says while hiding from the siege — the same regardless of
 * who is sheltering, so it carries no speaker identity of its own.
 */
export const SHELTERING_LINE = '…';

const UNNAMED_VILLAGER_IDS: readonly UnnamedVillagerId[] = [
  'elder_bracken',
  'elder_thistle',
  'child_nib',
  'child_burr',
];

export function isUnnamedVillager(id: string): id is UnnamedVillagerId {
  return UNNAMED_VILLAGER_IDS.some((unnamed) => unnamed === id);
}
