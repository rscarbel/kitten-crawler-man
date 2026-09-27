import { speakerLines } from '../../line';

const say = speakerLines('nella');

const askAboutTown = say.line(
  "Everyone's afraid. They just don't want to be the first one to say it.",
);

export const NELLA = {
  backstory:
    'Nella is the village seamstress and quietly one of its best sources of information. She notices everything happening around town and often knows which villagers are frightened or preparing for trouble before anyone else does.',

  firstMeeting: say.line("You're the Crawlers everyone is talking about."),
  attackImminent: say.bark("They're here."),
  afterVictory: say.bark('Tomorrow might almost feel normal.'),
  questActive: say.line(
    "I've been sewing gloves for the workers. Losing fingers to axes before the monsters arrive would be embarrassing.",
  ),
  fallbackQuestions: [askAboutTown],

  askAboutTown,
} as const;
