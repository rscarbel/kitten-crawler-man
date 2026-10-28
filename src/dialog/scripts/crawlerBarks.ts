/**
 * Lines a crawler says over their own head — an observation about a fight, a
 * reaction to a companion going down — read by `CrawlerBarkSystem`
 * (`src/systems/CrawlerBarkSystem.ts`).
 */

import { crawlerDisplayName } from '../../characters/characters';
import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const humanCrawler = speakerLines('human_crawler');
const belle = speakerLines('belle');

export const CRAWLER_BARKS: {
  readonly catKnockedOut: BarkLine;
  /**
   * What a crawler says after landing several hits on a shield fairy's ward
   * with nothing to show for it — `Player.noteWardBlockedHit`'s threshold.
   * Each crawler says it in their own voice; the call site picks the one
   * that matches whoever triggered it.
   */
  readonly wardExplainer: { readonly human: NonEmpty<BarkLine>; readonly cat: NonEmpty<BarkLine> };
  /**
   * What the crawler whose quest slot was just taken over by another quest's
   * item says when Merrit's scythe was what got pushed out. Nothing is lost —
   * the scythe goes back on the barn wall — so this is a reminder, not an alarm.
   */
  readonly scytheLeftBehind: { readonly human: BarkLine; readonly cat: BarkLine };
  /** The same reminder when it was Tikka's blueprints, which go home to Wendell's plan chest. */
  readonly blueprintsLeftBehind: { readonly human: BarkLine; readonly cat: BarkLine };
} = {
  /** The human's reaction to the cat going down, on the `crawlerKnockedOut` event. */
  catKnockedOut: humanCrawler.bark(() => `Hang in there, ${crawlerDisplayName('cat')}! I got you!`),
  wardExplainer: {
    human: [
      humanCrawler.bark("Huh. The ones glowing blue aren't taking a scratch."),
      humanCrawler.bark('Shield fairy first, then. Easy.'),
    ],
    cat: [
      belle.bark("The blue ones won't get hurt. They're all glowy."),
      belle.bark('Get the shield fairy first. Then cuddles.'),
    ],
  },
  scytheLeftBehind: {
    human: humanCrawler.bark('Oops. We left the scythe behind.'),
    cat: belle.bark('We forgot the scythe! Poor scythe.'),
  },
  blueprintsLeftBehind: {
    human: humanCrawler.bark('Oops. We left the blueprints behind.'),
    cat: belle.bark('We forgot the blueprints! The paper ones.'),
  },
};

/** The plain text of a pool of bark lines, in order — what `CrawlerBarkSystem.say` takes. */
export function barkTexts(pool: NonEmpty<BarkLine>): string[] {
  return pool.map((line) => line.paragraphs[0]);
}
