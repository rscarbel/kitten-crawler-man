/**
 * Lines a crawler says over their own head — an observation about a fight, a
 * reaction to a companion going down — read by `CrawlerBarkSystem`
 * (`src/systems/CrawlerBarkSystem.ts`).
 */

import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const carl = speakerLines('carl');
const donut = speakerLines('donut');

export const CRAWLER_BARKS: {
  readonly donutKnockedOut: BarkLine;
  /**
   * What a crawler says after landing several hits on a shield fairy's ward
   * with nothing to show for it — `Player.noteWardBlockedHit`'s threshold.
   * Said by whichever crawler triggers it, so both voices carry the same
   * words; the call site picks the one that matches whoever triggered it.
   */
  readonly wardExplainer: { readonly carl: NonEmpty<BarkLine>; readonly donut: NonEmpty<BarkLine> };
  /**
   * What the crawler whose quest slot was just taken over by another quest's
   * item says when Merrit's scythe was what got pushed out. Nothing is lost —
   * the scythe goes back on the barn wall — so this is a reminder, not an alarm.
   */
  readonly scytheLeftBehind: { readonly carl: BarkLine; readonly donut: BarkLine };
  /** The same reminder when it was Tikka's blueprints, which go home to Wendell's plan chest. */
  readonly blueprintsLeftBehind: { readonly carl: BarkLine; readonly donut: BarkLine };
} = {
  /** Carl's reaction to Donut going down, on the `crawlerKnockedOut` event. */
  donutKnockedOut: carl.bark('God dammit, Donut!'),
  wardExplainer: {
    carl: [
      carl.bark("I think these guys surrounded by blue can't be damaged."),
      carl.bark('I need to kill the shield fairy first.'),
    ],
    donut: [
      donut.bark("I think these guys surrounded by blue can't be damaged."),
      donut.bark('I need to kill the shield fairy first.'),
    ],
  },
  scytheLeftBehind: {
    carl: carl.bark('We left the scythe behind.'),
    donut: donut.bark('We left the scythe behind.'),
  },
  blueprintsLeftBehind: {
    carl: carl.bark('We left the blueprints behind.'),
    donut: donut.bark('We left the blueprints behind.'),
  },
};

/** The plain text of a pool of bark lines, in order — what `CrawlerBarkSystem.say` takes. */
export function barkTexts(pool: NonEmpty<BarkLine>): string[] {
  return pool.map((line) => line.paragraphs[0]);
}
