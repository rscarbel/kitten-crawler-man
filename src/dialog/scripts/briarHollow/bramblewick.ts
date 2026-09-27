import { speakerLines } from '../../line';

const say = speakerLines('bramblewick');

const AFTER_VICTORY_TEXT =
  'They are gone. For the first time in many months, I may look beyond that gate without expecting the dead to take an interest in coming back.';
const QUEST_COMPLETE_TEXT =
  'You have saved Briar Hollow. I confess, I am uncertain what a village such as ours could possibly offer Crawlers of your distinction, but you have our sincerest gratitude.';

const askAboutVillage = say.line(
  'This is Briar Hollow. Small, quiet, and, until very recently, quite unremarkable. We farm, we trade, and, for the most part, we mind our own affairs.',
);
const askAboutNecromancer = say.line(
  'There is a necromancer in the ruins to the east. At first, he seemed content with travelers and the occasional unfortunate animal. In time, however, he developed an unfortunate interest in our people. Now he raises our dead against us, which has made village life considerably less pleasant.',
);

export const BRAMBLEWICK = {
  backstory:
    'Bramblewick has governed Briar Hollow for twelve seasons. He inherited a quiet farming settlement and has watched it become increasingly threatened by a necromancer in the nearby ruins. He keeps careful records of every villager lost and is determined to give the town one final chance to survive.',

  firstMeeting: say.line(
    'You two are Crawlers, I presume? Then perhaps Providence has sent you to us at precisely the proper moment. In my experience, your arrival and our troubles are rarely far apart.',
  ),
  attackImminent: say.bark(
    'They are coming. See everyone behind the defenses and prepare yourselves. We have done rather too much work to let them through without an argument.',
  ),
  attackStarted: say.bark(
    'They have breached the outer defenses! Hold the town, if you please. I should very much prefer that they not destroy it.',
  ),
  afterVictory: say.bark(AFTER_VICTORY_TEXT),
  fallbackQuestions: [askAboutVillage, askAboutNecromancer],

  askAboutVillage,
  askAboutNecromancer,
  questOffer: say.line([
    'A most troublesome necromancer, Vordrick Boneharrow, has taken to stealing our dead cattle and fallen comrades. He attacks us, removes whatever bodies he can find, and by the following day we are obliged to defend ourselves against our own departed. One does begin to feel that the dead ought to have the decency to remain buried.',
    'The attacks are becoming more frequent, and I fear we may not survive another. Please, help us fortify the village and stand with us when he comes. Do this, and you shall have our gratitude—and rather more, should we discover we possess it.',
  ]),
  questAccepted: say.line(
    'Excellent. Then there is scarcely a moment to lose. Oren shall see that you are properly equipped, Tikka knows what must be built, and the rest of us shall contribute whatever we can. It is remarkable what a village can accomplish when everyone has been given sufficient reason to be frightened.',
  ),
  questDeclined: say.line(
    'I understand. If you should reconsider, do return before the attack. I assure you, we shall still be here—unless, of course, matters take a rather unfortunate turn.',
  ),
  beforeTools: say.line(
    'You shall require an axe and a pickaxe before you may gather what we need. Oren keeps them at the forge, where he is generally to be found reminding people that tools do not repair themselves.',
  ),
  afterVillageDamage: say.line(
    'We shall rebuild what we can. Whatever they have destroyed, we may replace. Whoever they have taken, however, we shall not have that luxury.',
  ),
  questComplete: say.line(QUEST_COMPLETE_TEXT),
  briefing: say.line([
    'Tikka, Fenna, and Oren have told me of the excellent work you have been doing in preparing stronger defenses for Briar Hollow. It seems you have been considerably more useful than my usual advisers, which I shall endeavor not to hold against them.',
    'I hope it will be enough. Our scouts have seen Vordrick Boneharrow gathering allies for a most ambitious assault. His intention is to seize the life stone hidden within our clocktower.',
    'The life stone is imbued with powerful healing magic, which extends over the village and keeps us alive and well in this rather inhospitable world.',
    'Vordrick intends to take it for himself and use its power to strengthen the dead he raises. I should very much prefer that he not succeed, as I fear there would be precious little anyone could do to stop him thereafter.',
    'I am placing my soldiers under your command. Help us fortify the walls and establish enough defenses to repel his assault. When you are ready, come and tell me. We are, I assure you, relying upon you rather heavily.',
  ]),
  fortifyingAwaitingWord: say.line(
    'Do continue fortifying the walls. Come and tell me when you are ready. I confess I should sleep better knowing the matter is in progress.',
  ),
  moreTimeGranted: say.line(
    'Very well. We have been granted a little additional time, which is more than I had expected. Return to me when you are ready.',
  ),
  repelledFailed: say.line([
    'It appears we were not nearly so well prepared as we had imagined. How dreadfully inconvenient.',
    'Fortunately, I was able to replace the true life stone with a facsimile. The enchantment upon the false stone will fade before long, at which point Vordrick will return. We must repair the clocktower and restore our defenses before he does.',
  ]),
  repairBellReminder: say.line(
    'The clocktower still requires repair. Vordrick will return once the enchantment upon the facsimile expires, and I should hate to have him find us in a state of disrepair.',
  ),
} as const;
