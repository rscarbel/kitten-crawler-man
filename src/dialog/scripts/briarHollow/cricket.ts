import { speakerLines } from '../../line';

const say = speakerLines('cricket');

const askAboutVillage = say.line("Water's good. Food's getting tight. Spirits are worse.");

export const CRICKET = {
  backstory:
    'Cricket maintains the village wells and drainage systems. He spends most of his life covered in mud and considers that an acceptable price for keeping the town supplied with clean water.',

  firstMeeting: say.line("Well's that way. Don't fall in it."),
  attackImminent: say.bark("Wells are sealed. Whatever happens, we're keeping the water clean."),
  afterVictory: say.bark("The wells are fine. That's something."),
  questActive: say.line("I've moved the water barrels behind the inner defenses."),
  fallbackQuestions: [askAboutVillage],

  askAboutVillage,
} as const;
