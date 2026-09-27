import { speakerLines } from '../../line';

const say = speakerLines('midge');

const askAboutNecromancer = say.line(
  "It used to come from the east. Lately it's been testing the southern road too.",
);

export const MIDGE = {
  backstory:
    "Midge maintains the village lamps and warning bell. She has become unusually good at spotting movement in the surrounding ruins and was the first villager to realize the necromancer's attacks were changing.",

  firstMeeting: say.line('There were lights in the ruins last night. Blue ones.'),
  attackImminent: say.bark("Bell! They're moving through the ruins!"),
  afterVictory: say.bark("I'll ring the bell tomorrow. Hopefully it'll mean something good."),
  questActive: say.line("I've marked where we've seen movement. A patrol there might be useful."),
  fallbackQuestions: [askAboutNecromancer],

  askAboutNecromancer,
} as const;
