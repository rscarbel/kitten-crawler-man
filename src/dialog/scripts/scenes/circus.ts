/**
 * "The Show Must Go On" — Tsarina Signet's questline outside the Big Top.
 *
 * Signet is theatrical, imperious, formal, and pivots between menace and
 * grief with no transition. Ryan makes friends with her anyway, grinning
 * through the menace. Belle sees a warm lady with moving pictures and wants
 * to sit with her.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import type { DialogReward } from '../../request';
import { crawlerName } from '../../../characters/characters';

const HUMAN_NAME = crawlerName('human');
const CAT_NAME = crawlerName('cat');

const signet = speakerLines('signet');
const ryan = speakerLines('ryan');
const belle = speakerLines('belle');
const mordecai = speakerLines('mordecaiInEar');
const grimaldiInTent = speakerLines('grimaldiInTent');
/** The questline's own header, for a narration page with no more specific title to give it. */
const narrator = transientSpeaker('The Show Must Go On', 'narration');

// Scene A — the approach

export const CIRCUS_INTRO: NonEmpty<DialogLine> = [
  signet.line(
    'Well, hello there. How fortunate that you walked by. I could really use some help from someone like you.',
  ),
  belle.line(`${HUMAN_NAME}! Her pictures are moving! The shark is looking at me. Hi, shark!`),
  mordecai.line(
    '*Listen carefully. That is a level sixty Elite. She stars in a show, and trust me, you do NOT want to get involved. Do not engage. Get out of there. now.',
  ),
  ryan.line(
    `Hi! ${HUMAN_NAME} and ${CAT_NAME}. We saw lights over a dead circus and couldn't resist. What can we do for you?`,
  ),
  signet.button(
    'Defend yourself',
    'I need your help for a spell casting. Mold Lions approach, and I think they will do just fine for my purposes.',
  ),
];

// Scene B — the ritual fails, and the story comes out

export const CIRCUS_RITUAL_FAILED: NonEmpty<DialogLine> = [
  signet.line(
    "You're quite the fighter. I underestimated you and now my spell failed as a result of that mistake. You owe me now.",
  ),
  signet.line(
    'There is a bear here named Heather. She was my friend. She danced here before all of this. Some part of her is still there, but Grimaldi brings her back every time she dies. And the next night, she has to do it all again. I need you to kill her.',
  ),
  ryan.line("Oh. You're asking us to put down your friend?"),
  signet.line(
    'She is suffering. Grimaldi keeps bringing her back, and every time he does, she has to live through it again. That is what this place has become. They cannot die, and they cannot leave.',
  ),
  ryan.button('Kill Heather', "...Okay. We'll make it quick for her."),
];

// Scene C — Heather is down

export const CIRCUS_HEATHER_RETURN: NonEmpty<DialogLine> = [
  signet.line('It is done ...Good. I can feel my spell coming to life now.'),
  signet.button(
    'Begin the assault',
    "Grimaldi has made all these poor people suffer for too long. Everyone here used to be my friend. I miss them, but I know they would never want this. It's time to end this.",
  ),
];

// Scene D — the briefing at the tent door

/** The potion the tent's last act is performed with, granted so it cannot be missing. */
export const BIGTOP_POTION_REWARD: DialogReward = {
  itemId: 'health_potion',
  displayName: 'Health Potion',
  lines: ['Mordecai says pouring a health potion over the Pestiferous Vine will poison it...'],
  xp: 0,
};

export const CIRCUS_BIGTOP_READY: NonEmpty<DialogLine> = [
  signet.line(
    'You can enter the tent now, however I cannot. Go and stop my former husband. I cannot bear to see what he has become, but he needs to be stopped. I love him, but Grimaldi would never have wanted this for his family.',
  ),
  mordecai.line(
    `*The tent keeps you in separate lanes, so take turns and watch each other's path. Half the gates on ${HUMAN_NAME}'s side open from ${CAT_NAME}'s side, and the other way round. Lookout for traps.*`,
  ),
  belle.line(
    `Two rings? One for you and one for me, ${HUMAN_NAME}. I hope there are big warm spotlights.`,
  ),
  signet.button('Enter the Big Top', 'Take this. Go. Finish the show.'),
];

// Scene H — outside, afterwards

function resolutionOpening(): NonEmpty<DialogLine> {
  return [
    signet.line('Is it over? Did you kill him?'),
    grimaldiInTent.line('Signet. Tsarina Signet. My love, the show is over. Come home.'),
    narrator.line('Every tattoo on Signet\'s body goes completely still. "...Redstone," she says.'),
    signet.line(
      "For eleven years, I thought the only way to save him was to kill him. I don't know what to do with the fact that I was wrong.",
    ),
    signet.line(
      "You gave me back my husband. I don't know how to repay that. But Signet does not forget a debt, crawlers. She will never forget this one.",
    ),
  ];
}

const MONGO_RETURNED_LINE = signet.line(
  'And your beast is returned, as promised. He bit three of my tattoos, ate a fourth, and slept through most of the week. I think I will miss him.',
);

const BELLE_CLOSING_LINE = belle.button(
  'Finish',
  `The show is over, and the family is together again. ${HUMAN_NAME}, everybody is hugging. Can I hug too? I'm going to hug Signet super tight.`,
);

export function circusResolutionLines(mongoKidnapped: boolean): NonEmpty<DialogLine> {
  const lines = resolutionOpening();
  return mongoKidnapped
    ? [...lines, MONGO_RETURNED_LINE, BELLE_CLOSING_LINE]
    : [...lines, BELLE_CLOSING_LINE];
}
