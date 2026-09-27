/**
 * What Briar Hollow's four unnamed villagers say. They have no conversation,
 * only a bubble over their heads — when spoken to, and now and then when the
 * party passes — so a few lines each is all they need.
 */

export type UnnamedVillagerId = 'elder_bracken' | 'elder_thistle' | 'child_nib' | 'child_burr';

export const UNNAMED_VILLAGER_LINES: Readonly<Record<UnnamedVillagerId, readonly string[]>> = {
  elder_bracken: [
    'I remember when those ruins were only ruins.',
    "Mind the calves. They're braver than they look.",
  ],
  elder_thistle: [
    "Twelve seasons Bramblewick's been mayor. Twelve seasons of meetings.",
    'The bell used to mean supper.',
  ],
  child_nib: ['Are you really Crawlers? Is the cat really a cat?', "I'm not scared. Mostly."],
  child_burr: ['Mama says never go past the quarry.', 'Garn let me hold a rock once. A big one.'],
};

/** All any of them says while hiding from the siege. */
export const SHELTERING_LINE = '…';

/** Shown in the hover tooltip for a villager with no name of their own. */
export const UNNAMED_VILLAGER_DESCRIPTIONS: Readonly<Record<UnnamedVillagerId, string>> = {
  elder_bracken: "One of Briar Hollow's elders. Minds the cows and remembers quieter seasons.",
  elder_thistle: "One of Briar Hollow's elders. Has sat through twelve years of town meetings.",
  child_nib: 'A Briar Hollow child, endlessly curious about the Crawlers.',
  child_burr: 'A Briar Hollow child, warned to stay well clear of the quarry.',
};

const UNNAMED_VILLAGER_IDS: readonly UnnamedVillagerId[] = [
  'elder_bracken',
  'elder_thistle',
  'child_nib',
  'child_burr',
];

export function isUnnamedVillager(id: string): id is UnnamedVillagerId {
  return UNNAMED_VILLAGER_IDS.some((unnamed) => unnamed === id);
}
