import { speakerLines } from '../../line';

const say = speakerLines('fenna');

const ASK_HOW_LUMBER_YARD_WORKS_TEXT =
  'You bring me the raw wood. From there, you can run it through the mill yourself, one piece at a time, or pay me to handle the whole batch for you.';

const MANUAL_PROCESSING_INSTRUCTIONS_TEXT =
  "Put your wood in the mill, choose whether you want boards or rope, and let it do its work. One piece of wood'll make two boards, or one length of rope.";

const askHowLumberYardWorks = say.line(ASK_HOW_LUMBER_YARD_WORKS_TEXT);

export const FENNA = {
  backstory:
    "Fenna runs the village lumber yard and sawmill. She teaches workers how to use the machinery to process wood into boards or rope, and she offers a paid bulk-processing service for anyone who doesn't want to process each piece manually.",

  firstMeeting: say.line(
    "Logs go in yonder, finished material comes out over here. Mind where you're standin', though. I'd hate for you to wind up wearin' sawdust in places sawdust has no business bein'.",
  ),

  attackImminent: say.bark(
    "We're closin' up the mill! Get whatever materials you've got inside the walls and don't dawdle!",
  ),

  questActive: say.line(
    "You keep bringin' me wood, and I'll keep turnin' it into somethin' Tikka can put to good use.",
  ),

  fallbackQuestions: [askHowLumberYardWorks],

  askHowLumberYardWorks,
  lumberYardWorksTopic: say.line([
    ASK_HOW_LUMBER_YARD_WORKS_TEXT,
    MANUAL_PROCESSING_INSTRUCTIONS_TEXT,
  ]),

  bulkProcessingService: say.line(
    "Or hand me the wood, pay one coin apiece, and I'll run through as much of it as you tell me to. Long as you've got it in your pack, I'll get it done.",
  ),

  bulkProcessingBoardsSelected: say.bark(
    "Boards, then. Just tell me how many you want, and I'll take care of the whole batch.",
  ),

  bulkProcessingRopeSelected: say.bark(
    "Rope it is. Tell me how much you need, and I'll get it run through.",
  ),

  bulkProcessingFeeExplanation: say.line(
    "It's one coin for every piece of wood I process. Ten pieces'll run you ten coins. Fair enough, I'd say.",
  ),

  bulkProcessingComplete: say.bark('There we are. All finished. Your materials are ready to go.'),

  bulkProcessingInsufficientFee: say.bark(
    "Now hold on a minute. You ain't got enough coin to pay for all that. Cut back the order some, or come back with more money.",
  ),

  noLogs: say.bark(
    "Come back when you've got some wood. Ain't much I can do with an empty mill but stare at it.",
  ),

  constructionExperience: say.bark(
    "Every bit you process teaches you somethin'. Just don't go tellin' Oren I said haulin' lumber counts as construction.",
  ),

  grantsAccess: say.line([
    "Tikka says you need to use my saw and rope walk, huh? I don't usually let strangers anywhere near my equipment, but seein' as how we're all tryin' to stay alive, I reckon I can make an exception.",
    "Just put your raw wood in either one. The saw'll turn it into boards, and the rope walk'll make rope. Go on, give it a try.",
  ]),

  // "The Borrowed Blueprints": Fenna's own side quest to upgrade her stations.

  /** The offer, which ends on the accept/decline row. */
  blueprintsOffer: say.line([
    "Have you seen what Tikka's been dreaming up? Trebuchets! Walls that bite back! I can't keep up with that one.",
    "It reminds me. Last year Tikka had an idea for upgrading the work stations here. A proper saw bench, and a rope walk that doesn't need three of us on the crank.",
    'Would you help me upgrade the saw and the rope walk?',
  ]),

  /**
   * Accepted. `townWhereabouts` finishes "He lives at Plumbline Farm, in …":
   * the skyfowl town and which way it lies from the village.
   */
  blueprintsAccepted: say.fn((a: { readonly townWhereabouts: string }) => [
    `Wonderful! Only, I don't have the plans anymore. I gave the blueprints to Wendell. He lives at Plumbline Farm, in ${a.townWhereabouts}.`,
    "Wendell's done construction work. I haven't the faintest idea how to raise a building, so it made sense at the time.",
    'Could you go ask him if he still has them, and whether I can borrow them back?',
  ]),

  blueprintsDeclined: say.line(
    "No harm done. The saw isn't going anywhere. Come find me if you change your mind.",
  ),

  /** Her opening at every step while the quest is under way. */
  blueprintsInProgress: say.line('Any luck with those blueprints?'),

  /** Shouted the moment the second station is upgraded. */
  blueprintsComplete: say.bark("Would you look at that! Tikka's going to be green with envy."),
} as const;
