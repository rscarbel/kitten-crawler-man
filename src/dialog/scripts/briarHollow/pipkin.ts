import { speakerLines } from '../../line';

const say = speakerLines('pipkin');

const askAboutBurgers = say.line(
  'Fresh meat, a hot pan, bread, and enough seasoning to make it worth chewing. Simple. Reliable.',
);
const askAboutStew = say.line(
  "Stew is the filling option. It'll heal you the same way a health potion does.",
);

export const PIPKIN = {
  backstory:
    'Pipkin runs the village kitchen and sells simple meals to residents and travelers. His burgers and stew are the two staples of the village. He takes considerable pride in keeping everyone fed during difficult times.',

  firstMeeting: say.line(
    "Welcome! Hungry? I've got burgers, stew, and absolutely no patience for anyone asking what went into either one.",
  ),
  attackImminent: say.bark("Kitchen's closed! Get behind the walls!"),
  afterVictory: say.bark(
    "You survived, so I'll make something special. Don't ask what it is. It's a surprise.",
  ),
  questActive: say.line(
    "I've been cooking extra. The workers need food, the soldiers need food, and apparently Crawlers do too.",
  ),
  fallbackQuestions: [askAboutBurgers, askAboutStew],

  shopOpen: say.bark(
    "I've got two things on the menu today: burgers if you're in a hurry, and stew if you're planning to stay alive for a while.",
  ),
  cannotAfford: say.bark("Come back when you've got the coin."),

  askAboutBurgers,
  askAboutStew,
  buyBurger: say.bark('One burger coming up. Coins on the counter.'),
  buyStew: say.bark(
    "Good choice. Eat it whenever you need the same kind of recovery you'd get from a health potion.",
  ),
  stewCooldownActive: say.bark(
    "Not yet. Whatever's keeping you from using a health potion is keeping you from using my stew, too.",
  ),
} as const;
