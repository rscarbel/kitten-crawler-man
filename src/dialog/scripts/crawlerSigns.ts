/** What a wayfinding sign left by an earlier crawler says, read by `CrawlerSignSystem`. */

import { transientSpeaker } from '../line';
import type { LineText } from '../line';
import type { CrawlerSignDirection } from '../../map/crawlerSigns';

const sign = transientSpeaker('Painted Sign', 'sign');

/** The sign's line, templated by the direction stored on its placement tile. */
export const signLine = sign.fn((args: { readonly direction: CrawlerSignDirection }): LineText => [
  'It looks like a different crawler left a message for anyone that came after them.',
  `It says, "Follow the hallway to the ${args.direction} to get to the stairwell."`,
]);
