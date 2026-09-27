import { speakerLines } from '../../line';

const say = speakerLines('oren');

const askAboutAxe = say.line(
  "The axe is for timber. Walk up to a tree and use it. You don't need to equip anything manually; the tool will be used automatically.",
);
const askAboutPickaxe = say.line(
  'The pickaxe is for stone. Walk up to a rock deposit and use it. Same deal. The proper tool gets used automatically.',
);

const GRANT_BASIC_TOOLS_TEXT =
  "Mayor Bramblewick told me you have agreed to help us defend against Vordrick Boneharrow, the Necromancer. If you're going to help us build some defenses, you'll need to collect some resources to get started. Here, take a Basic Axe and a Basic Pickaxe. They'll get you started. Why don't you collect some wood from the lumber yard, some stone from the quarry, and then talk to Tikka to see what she can do with that.";
const EXPLAIN_RESOURCE_GATHERING_TEXT =
  "Here's the important part. Chop trees for wood. Mine rocks for stone. Bring the wood to the lumber yard and the stone to the quarry.";
const RESOURCING_SKILL_GRANTED_TEXT =
  "There. Now you know what you're doing. You've learned Resourcing.";
const DIRECTIONS_TO_LUMBER_YARD_TEXT =
  'Take that axe to the lumber yard. Or find any trees out on the map. Any tree will give you wood.';
const DIRECTIONS_TO_QUARRY_TEXT =
  "Take the pickaxe to the quarry. Any exposed rock deposit will do. You'll get stone while you're working it.";

export const OREN = {
  backstory:
    "Oren owns and operates the village smithy. He provides the player's initial gathering tools, sells increasingly powerful axe and pickaxe variants, and teaches the basics of resource gathering.",

  firstMeeting: say.line(
    "Welcome to the forge. If you're looking for something sharp or heavy, you're in the right place.",
  ),
  attackImminent: say.bark('Forge is shutting down. Weapons first. Tools can wait.'),
  questActive: say.line(
    'The engineer keeps sending me orders for fortifications. The least you can do is gather the materials.',
  ),
  fallbackQuestions: [askAboutAxe, askAboutPickaxe],

  shopOpen: say.bark(
    'Axes, pickaxes, repairs, improvements. Better tools cost more. Better tools also get the job done faster.',
  ),

  askAboutAxe,
  askAboutPickaxe,
  grantBasicTools: say.line(GRANT_BASIC_TOOLS_TEXT),
  basicToolsAlreadyOwned: say.line(
    "You've already got the basic tools. No point giving you another pair.",
  ),
  resourcingSkillGranted: say.line(RESOURCING_SKILL_GRANTED_TEXT),
  resourcingSkillAlreadyGranted: say.line(
    "I already taught you the basics. You don't need the lesson twice.",
  ),
  whereToUseTools: say.line([DIRECTIONS_TO_LUMBER_YARD_TEXT, DIRECTIONS_TO_QUARRY_TEXT]),
  grantAndLesson: say.line([
    GRANT_BASIC_TOOLS_TEXT,
    EXPLAIN_RESOURCE_GATHERING_TEXT,
    RESOURCING_SKILL_GRANTED_TEXT,
    DIRECTIONS_TO_LUMBER_YARD_TEXT,
    DIRECTIONS_TO_QUARRY_TEXT,
  ]),
  axeUpgradeAvailable: say.bark(
    "You've got enough coin for an upgrade. Your new axe will gather wood more efficiently.",
  ),
  pickaxeUpgradeAvailable: say.bark(
    "You've got enough coin for an upgrade. Your new pick will gather stone more efficiently.",
  ),
  alreadyMaxAxe: say.bark(
    "That's the best axe I've got. Beyond this, you're asking for a miracle.",
  ),
  alreadyMaxPickaxe: say.bark(
    "That's the finest pick I can make. I don't have anything better to sell you.",
  ),
  cannotAffordUpgrade: say.bark("Come back with more coin. The forge doesn't run on promises."),
  upgradePurchased: say.bark(
    "There you are. The upgrade replaces your old tool. You'll both benefit from it.",
  ),
  sharedUpgradeExplanation: say.bark(
    "You're working as a pair, so you don't need separate upgraded tools. Improve one and the upgrade applies to both of you.",
  ),
} as const;
