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

const carl = speakerLines('carl');
const donut = speakerLines('donut');

/**
 * The crawlers' side of Merrit's "Borrowed Blueprints" scenes. Either can be
 * the one talking, so both voices carry the same words and the scene picks
 * whichever crawler the player is controlling.
 */
export const MERRIT_BLUEPRINTS_REPLIES = {
  carl: {
    goodMorning: carl.line('Good morning, Merrit.'),
    itsWhatWeDo: carl.line("It's what we do."),
    askForCow: carl.line(
      "Listen, I don't know how to bring this up casually... Can we have one of your cows?",
    ),
    fenceAgreed: carl.line("Got it. Leave it to us and we'll make your fence look great."),
    theMayor: carl.line('What? The mayor?'),
    needMilk: carl.line('Right. Well good, we need a cow to give milk, not to manage a village.'),
  },
  donut: {
    goodMorning: donut.line('Good morning, Merrit.'),
    itsWhatWeDo: donut.line("It's what we do."),
    askForCow: donut.line(
      "Listen, I don't know how to bring this up casually... Can we have one of your cows?",
    ),
    fenceAgreed: donut.line("Got it. Leave it to us and we'll make your fence look great."),
    theMayor: donut.line('What? The mayor?'),
    needMilk: donut.line('Right. Well good, we need a cow to give milk, not to manage a village.'),
  },
} as const;
