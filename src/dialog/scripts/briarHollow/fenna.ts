import { speakerLines } from '../../line';

const say = speakerLines('fenna');

const ASK_HOW_LUMBER_YARD_WORKS_TEXT =
  'Bring me raw wood. From there, you can process it yourself one piece at a time, or pay me to process a whole batch.';
const MANUAL_PROCESSING_INSTRUCTIONS_TEXT =
  'Put your wood into the mill, choose boards or rope, and process it. One wood makes two boards. One wood makes one rope.';

const askHowLumberYardWorks = say.line(ASK_HOW_LUMBER_YARD_WORKS_TEXT);

export const FENNA = {
  backstory:
    "Fenna runs the village lumber yard and sawmill. She teaches workers how to use the machinery to process wood into boards or rope, and she offers a paid bulk-processing service for anyone who doesn't want to process each piece manually.",

  firstMeeting: say.line(
    "Logs go in there. Finished material comes out over here. Stand clear unless you want sawdust in places sawdust shouldn't be.",
  ),
  attackImminent: say.bark(
    "We're shutting down the mill. Get whatever materials you've got inside the walls.",
  ),
  questActive: say.line(
    "You keep bringing me wood and I'll keep turning it into something Tikka can use.",
  ),
  fallbackQuestions: [askHowLumberYardWorks],

  askHowLumberYardWorks,
  lumberYardWorksTopic: say.line([
    ASK_HOW_LUMBER_YARD_WORKS_TEXT,
    MANUAL_PROCESSING_INSTRUCTIONS_TEXT,
  ]),
  bulkProcessingService: say.line(
    "Or give me the wood and pay one coin per piece. I'll process as much as you tell me to, up to what you've got in your inventory.",
  ),
  bulkProcessingBoardsSelected: say.bark(
    "Boards it is. Tell me how many you want processed and I'll handle the batch.",
  ),
  bulkProcessingRopeSelected: say.bark(
    "Rope it is. Tell me how much you want processed and I'll handle the batch.",
  ),
  bulkProcessingFeeExplanation: say.line(
    'The fee is one coin per piece of wood processed. So ten wood costs ten coins.',
  ),
  bulkProcessingComplete: say.bark('Finished. Your processed materials are ready.'),
  bulkProcessingInsufficientFee: say.bark(
    "That's not enough coin for the amount you've asked me to process.",
  ),
  noLogs: say.bark("Come back with some wood. The mill isn't powered by optimism."),
  constructionExperience: say.bark(
    "Every bit of processing teaches you something. Don't tell Oren I said gathering counts as construction.",
  ),
  grantsAccess: say.line([
    "Tikka says you need access to my saw and rope walk huh? I don't normally let strangers touch my equipment, but considering this is literally a life or death situation for us, I think it will be okay if you use it.",
    "Just put in raw wood to either one of them and you can process the material into boards of wood with the saw, or rope with the rope walk. Why don't you go give it a try.",
  ]),
} as const;
