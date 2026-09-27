import { speakerLines } from '../../line';

const say = speakerLines('vetch');

const askAboutTown = say.line(
  'The necromancer has been terrible for business. Terrible for the population as well, obviously. But business is what I notice first.',
);

export const VETCH = {
  backstory:
    "Vetch runs the village's general store and trading post. He deals in useful supplies, scavenged goods, and anything else people are willing to sell. He is perpetually concerned about inventory, profit margins, and the alarming cost of replacing merchandise destroyed by undead.",

  firstMeeting: say.line(
    "Welcome to Vetch's establishment. Everything is useful, everything is reasonably priced, and nothing here is stolen.",
  ),
  attackImminent: say.bark("Shop's closed. I'm moving anything valuable underground."),
  afterVictory: say.bark('Excellent. Everyone survived. That is very good for future business.'),
  questActive: say.line(
    "Everyone's buying rope, food, nails, and anything that can keep a wall from falling down.",
  ),
  fallbackQuestions: [askAboutTown],

  shopOpen: say.bark('Tools, supplies, provisions, odds and ends. Look around.'),

  askAboutTown,
  lowSupplies: say.line("We're getting low. Which means prices may become less friendly."),
} as const;
