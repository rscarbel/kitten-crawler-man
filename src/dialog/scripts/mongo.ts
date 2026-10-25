/** What the cat crawler says about Mongo, over her own head. */

import { speakerLines } from '../line';

const say = speakerLines('belle');

export const MONGO_LINES = {
  noRoom: say.bark('No room for Mongo! Sorry.'),
  summon: say.bark('Go, Mongo! Go!'),
  recall: say.bark('Mongo, come back! Cuddles!'),
  arrived: say.bark('Mongo! Hi, Mongo!'),
  restUp: say.bark('Rest up, Mongo. Nap time.'),
};
