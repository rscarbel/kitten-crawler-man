/** What the cat crawler says about Deinonychus, over her own head. */

import type { PetWords } from '../../core/party/petNames';
import { speakerLines } from '../line';

const say = speakerLines('belle');

export const DEINONYCHUS_LINES = {
  noRoom: say.fn(({ referred }: PetWords) => `No room for ${referred}! Sorry.`),
  summon: say.fn(({ called }: PetWords) => `Go, ${called}! Go!`),
  recall: say.fn(({ called }: PetWords) => `${called}, come back! Cuddles!`),
  arrived: say.fn(({ called }: PetWords) => `${called}! Hi, ${called}!`),
  restUp: say.fn(({ called }: PetWords) => `Rest up, ${called}. Nap time.`),
};
