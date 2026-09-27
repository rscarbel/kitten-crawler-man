/** What the cat crawler says about Mongo, over her own head. */

import { speakerLines } from '../line';

const say = speakerLines('donut');

export const MONGO_LINES = {
  noRoom: say.bark('No room for Mongo!'),
  summon: say.bark('Go Mongo!'),
  recall: say.bark('Mongo, come back!'),
  arrived: say.bark('Mongo!'),
  restUp: say.bark('Rest up, Mongo.'),
};
