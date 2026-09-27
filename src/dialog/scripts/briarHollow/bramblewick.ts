import { speakerLines } from '../../line';

const say = speakerLines('bramblewick');

const AFTER_VICTORY_TEXT =
  "They're gone. For the first time in months, I can look beyond that gate without expecting the dead to come walking back.";
const QUEST_COMPLETE_TEXT =
  "You saved Briar Hollow. I don't know what a village like ours can possibly offer Crawlers, but you have our gratitude.";

const askAboutVillage = say.line(
  'This is Briar Hollow. Small, quiet, and until recently, rather unremarkable. We farm, trade, and keep to ourselves.',
);
const askAboutNecromancer = say.line(
  "There's a necromancer in the ruins east of here. At first it only took travelers and stray animals. Then it started taking our people. Now it raises our dead against us.",
);

export const BRAMBLEWICK = {
  backstory:
    'Bramblewick has governed Briar Hollow for twelve seasons. He inherited a quiet farming settlement and has watched it become increasingly threatened by a necromancer in the nearby ruins. He keeps careful records of every villager lost and is determined to give the town one final chance to survive.',

  firstMeeting: say.line(
    "You two are Crawlers, aren't you? Then perhaps you've arrived at exactly the right time. Around here, that usually means trouble has arrived as well.",
  ),
  attackImminent: say.bark(
    "They're coming. Get everyone behind the defenses and prepare yourselves.",
  ),
  attackStarted: say.bark("They're through the outer defenses! Hold the town!"),
  afterVictory: say.bark(AFTER_VICTORY_TEXT),
  fallbackQuestions: [askAboutVillage, askAboutNecromancer],

  askAboutVillage,
  askAboutNecromancer,
  questOffer: say.line(
    "The attacks are becoming more frequent. We may not survive another. Help us fortify the village and defend us when it comes. Do that, and you'll have our gratitude.",
  ),
  questAccepted: say.line(
    'Then we have work to do. Oren can outfit you, Tikka knows what we need built, and everyone else will do what they can.',
  ),
  questDeclined: say.line('I understand. If you change your mind, come back before the attack.'),
  beforeTools: say.line(
    "You'll need an axe and a pickaxe before you can gather what we need. Oren keeps them at the forge.",
  ),
  afterVillageDamage: say.line(
    'Rebuild what we can. Whatever they destroyed, we can replace. Whoever they took, we cannot.',
  ),
  questComplete: say.line(QUEST_COMPLETE_TEXT),
  briefing: say.line([
    "Tikka, Fenna, and Oren have told me about all the great work you've been doing to help setup stronger defenses around Briar Hollow.",
    'I hope it is enough. Scouts have spotted Vordrick Boneharrow gathering allies for a massive assault. He wants to take the life stone hidden in our clocktower.',
    'The life stone is imbued with powerful healing spells, and it radiates to this village, keeping us alive and well in this harsh world.',
    'Vordrick means to take it from us and use it to empower the dead minions he raises. I fear if he gets his hands on it, no one can stop him.',
    "I am placing my soldiers under your command. Help us fortify the walls and setup enough defenses to repel his attacks. Let me know when you're ready. We're counting on you!",
  ]),
  fortifyingAwaitingWord: say.line("Keep fortifying the walls. Let me know when you're ready."),
  moreTimeGranted: say.line(
    "That's fine, we have a little more time. Come back to me when you're ready.",
  ),
  repelledFailed: say.line([
    'It seems we were not as prepared as we thought.',
    'Fortunately, I was able to switch out the true life stone with a facsimile. The magic imbued in the false stone will wear off soon and Vordrick will be back. We should repair our clock tower and rebuild our defenses before that happens.',
  ]),
  repairBellReminder: say.line(
    'The bell tower still needs repairing. Vordrick will be back once the facsimile wears off.',
  ),
} as const;
