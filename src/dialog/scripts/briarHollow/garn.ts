import { speakerLines } from '../../line';

const say = speakerLines('garn');

const askHowToGather = say.line(
  "Walk up to a rock deposit and use your pickaxe. Keep working and it'll give you stone.",
);
const askAboutTrebuchetAmmunition = say.line(
  'Keep some pieces large and dense. Those make better trebuchet ammunition than loose rubble.',
);

export const GARN = {
  backstory:
    'Garn oversees stone gathering around the village. There is no formal deep quarry; the workers instead harvest usable stone from exposed rock formations and the remains of ruined structures surrounding the settlement.',

  firstMeeting: say.line("Stone's out there. Pickaxe is how you get it."),
  attackImminent: say.bark(
    "Drop the tools and head inside. We're not losing workers before the fighting even starts.",
  ),
  questActive: say.line(
    'Every stone you bring back is another piece of the wall between us and the dead.',
  ),
  fallbackQuestions: [askHowToGather, askAboutTrebuchetAmmunition],

  askHowToGather,
  collectionSpeed: say.line(
    'You get one stone for every stretch of time you spend working the deposit. Better tools make the work more efficient.',
  ),
  depositDepleted: say.bark("That one's finished. Find another rock deposit."),
  stoneDelivered: say.line(
    'Good load. Keep bringing it. Strong walls consume a shocking amount of stone.',
  ),
  askAboutTrebuchetAmmunition,
} as const;
