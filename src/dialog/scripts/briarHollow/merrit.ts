import { speakerLines } from '../../line';

const say = speakerLines('merrit');

const askAboutFarm = say.line(
  "We grow grain where the soil is decent and mushrooms where it isn't. The pasture's mostly for the cows.",
);
const askAboutCows = say.line(
  "They're harmless. You can pet them if you like. Just don't frighten the calves.",
);

export const MERRIT = {
  backstory:
    "Merrit tends Briar Hollow's grain, vegetables, mushrooms, and pasture. She was born in the village and has spent nearly her entire life farming its surrounding fields. She refuses to abandon the crops, even with the necromancer nearby.",

  firstMeeting: say.line('Watch your feet. Those are winter crops.'),
  attackImminent: say.bark("I've brought the tools inside. The fields can wait. People can't."),
  afterVictory: say.bark("Tomorrow I'll plant again. That's what farmers do."),
  questActive: say.line("You want to help? Keep the walls standing. I'll keep everyone fed."),
  fallbackQuestions: [askAboutFarm, askAboutCows],

  askAboutFarm,
  askAboutCows,
  cowPettedNearby: say.bark('See? Even a Crawler can make a cow happy.'),
} as const;
