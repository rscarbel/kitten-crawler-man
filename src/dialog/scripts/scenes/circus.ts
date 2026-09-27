/**
 * "The Show Must Go On" — Tsarina Signet's questline outside the Big Top.
 *
 * Signet is theatrical, imperious, formal, and pivots between menace and
 * grief with no transition. Donut is ALL CAPS and treats a dead circus as an
 * engagement she is headlining. Carl is blunt, plain, and never raises his
 * voice.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import type { DialogReward } from '../../request';

const signet = speakerLines('signet');
const carl = speakerLines('carl');
const donut = speakerLines('donut');
const mordecai = speakerLines('mordecaiInEar');
const grimaldiInTent = speakerLines('grimaldiInTent');
/** The questline's own header, for a narration page with no more specific title to give it. */
const narrator = transientSpeaker('The Show Must Go On', 'narration');

// Scene A — the approach

export const CIRCUS_INTRO: NonEmpty<DialogLine> = [
  signet.line(
    'Well, hello there. How fortunate that you walked by. I could really use some help from someone like you.',
  ),
  donut.line('CARL. HER TATTOOS ARE MOVING. THE SHARK IS LOOKING AT ME, CARL.'),
  mordecai.line(
    '*Listen carefully. That is a level sixty Elite. She stars in a show, and trust me, you do NOT want to get involved. Do not engage. Get out of there. now.',
  ),
  carl.line("We're nobody. We saw lights over a dead circus and got curious. What do you want?"),
  signet.button(
    'Defend yoursef',
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
  carl.line("You're asking us to put down your friend?"),
  signet.line(
    'She is suffering. Grimaldi keeps bringing her back, and every time he does, she has to live through it again. That is what this place has become. They cannot die, and they cannot leave.',
  ),
  carl.button('Kill Heather', '...Fine.'),
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
    "*The tent keeps you in separate lanes, so take turns and watch each other's path. Half the gates on Carl's side open from Donut's side, and the other way round. Lookout for traps.*",
  ),
  donut.line(
    'A TWO-RING SHOW AND WE ARE THE HEADLINERS, CARL. FINALLY, A DUNGEON WITH TASTE. I WANT TOP BILLING AND SOMETHING SHINY TO SHOOT.',
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

const DONUT_CLOSING_LINE = donut.button(
  'Finish',
  'WELL, CARL. THE SHOW IS OVER, THE FAMILY IS FREE, AND NOBODY THANKED THE CAT WITH A CLOSING NUMBER. TYPICAL. I WILL BE ACCEPTING APPLAUSE AT THE EXIT.',
);

export function circusResolutionLines(mongoKidnapped: boolean): NonEmpty<DialogLine> {
  const lines = resolutionOpening();
  return mongoKidnapped
    ? [...lines, MONGO_RETURNED_LINE, DONUT_CLOSING_LINE]
    : [...lines, DONUT_CLOSING_LINE];
}
