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

  // "The Borrowed Blueprints": the fence, the grain and Midge.

  /** Her answer to the crawlers' good morning once Vordrick Boneharrow has been beaten. */
  blueprintsGreetingAfterPlea: say.line(
    "Howdy! Y'all did a great job giving Vordrick Boneharrow what for. Thank ya for helpin' us!",
  ),
  /** Her answer to the crawlers' good morning while the fight with him is still to come. */
  blueprintsGreetingBeforePlea: say.line(
    "Howdy! I heard y'all are helpin' us prepare for a big fight with Vordrick Boneharrow. I hope you give him what for.",
  ),
  blueprintsFenceTerms: say.line(
    "I dunno why you're makin' a fuss of that, it ain't unusual to sell one of my cows. I'll tell you what. We ain't got no good hands for construction around these parts; if y'all can replace my fence over yonder with somethin' more sturdy, then I'll give you a fine cow.",
  ),
  blueprintsFenceWaiting: say.line('I sure am looking forward to that new fence.'),
  blueprintsFenceDone: say.line(
    "That there is a fine lookin' fence! Whelp, I'm a rodent of her word, you can have Bramblewick over there.",
  ),
  blueprintsNotTheMayor: say.line(
    "Err. No. Sorry. I name the cows after some of the townsfolk. I was talkin' 'bout Bramblewick the cow.",
  ),
  blueprintsDairyTerms: say.line(
    "Hold up there. You didn't tell me it was a dairy cow you be needin'. If you're gonna get one of my dairy cows, I'm going to need some help with the harvest. Tell you what, if you get me 100 grain, then I can give you Midge. The cow, Midge.",
  ),
  blueprintsScytheOffer: say.line('You can use the scythe off the wall in my barn.'),
  blueprintsHarvestWaiting: say.line(
    "Grain's in the field, scythe's on the wall. Holler when you've got a hundred.",
  ),
  blueprintsGrainDelivered: say.line("That'll do."),
  /** Shouted across the pasture once the grain is in. */
  blueprintsCallMidge: say.bark('HERE MIDGE! COME HERE GIRL!'),
  /** Once Midge has come to the party: the conversation Merrit opens herself. */
  blueprintsMidgeArrived: say.line(
    "There she is. She'll follow you wherever you need to go. Just be careful of any mobs if you're steppin' outside. They got a taste for burger.",
  ),
} as const;

const ryan = speakerLines('ryan');
const belle = speakerLines('belle');

/**
 * The crawlers' side of Merrit's "Borrowed Blueprints" scenes. Either can be
 * the one talking, so each says the same beats in their own voice and the
 * scene picks whichever crawler the player is controlling.
 */
export const MERRIT_BLUEPRINTS_REPLIES = {
  ryan: {
    goodMorning: ryan.line('Morning, Merrit! Those winter crops are looking great.'),
    itsWhatWeDo: ryan.line("Happy to. It's kind of our thing."),
    askForCow: ryan.line(
      "Okay, there's no smooth way to ask this, so I'll just ask... Could we have one of your cows?",
    ),
    fenceAgreed: ryan.line("Deal. Leave it to us. That'll be the best fence in Briar Hollow."),
    theMayor: ryan.line('Wait. The mayor?'),
    needMilk: ryan.line('Ha! Good. We need a cow that gives milk, not one that runs a village.'),
  },
  belle: {
    goodMorning: belle.line('Good morning, Merrit! Your barn is so cozy.'),
    itsWhatWeDo: belle.line('We like helping! Helping is nice.'),
    askForCow: belle.line('Um... can we have a cow? A nice one? We will love her lots.'),
    fenceAgreed: belle.line("Okay! We'll make you the prettiest fence. Promise."),
    theMayor: belle.line("The mayor? He won't fit in the pasture..."),
    needMilk: belle.line('Oh good. Milk cow, not mayor cow. Milk is yummy.'),
  },
} as const;
