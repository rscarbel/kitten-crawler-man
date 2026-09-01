/**
 * Dialog scripts for "The Show Must Go On".
 *
 * Signet is theatrical, imperious, formal, and pivots between menace and grief
 * with no transition. Donut is ALL CAPS and treats a dead circus as an
 * engagement she is headlining. Carl is blunt, plain, and never raises his
 * voice. Grimaldi speaks in a ringmaster's cadence stretched like taffy until
 * the cure tightens it back to a man's.
 *
 * Pure data; CircusQuestSystem and BigTopMazeSystem own pagination and rendering.
 */

import type { DialogPage } from '../ui/QuestDialog';

export type { DialogPage };

const SIGNET = 'Tsarina Signet';
const CARL = 'Carl';
const DONUT = 'Donut';
const MORDECAI = 'Mordecai (in your ear)';
const GRIMALDI = 'Grimaldi';
const NARRATOR = 'The Show Must Go On';

// Scene A

export const INTRO_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'Well, hello there. How fortunate that you walked by. I could really use some help from someone like you.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['CARL. HER TATTOOS ARE MOVING. THE SHARK IS LOOKING AT ME, CARL.'],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Listen carefully. That is a level sixty Elite. She stars in a show, and trust me, you do NOT want to get involved. Do not engage. Get out of there. now.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ["We're nobody. We saw lights over a dead circus and got curious. What do you want?"],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'I need your help for a spell casting. Mold Lions approach, and I think they will do just fine for my purposes.',
    ],
    button: 'Defend yoursef',
  },
];

//  Scene B: the ritual fails, and the story comes out

/**
 * The pages every telling shares, after the branch on whether Mongo is here to
 * be taken as surety.
 */
const RITUAL_FAILED_CLOSING_PAGES = [
  {
    title: SIGNET,
    lines: [
      "You're quite the fighter. I underestimated you and now my spell failed as a result of that mistake. You owe me now.",
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'There is a bear here named Heather. She was my friend. She danced here before all of this.',
      'Some part of her is still there, but Grimaldi brings her back every time she dies. And the next night, she has to do it all again.',
      'I need you to kill her.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ["You're asking us to put down your friend?"],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'She is suffering. Grimaldi keeps bringing her back, and every time he does, she has to live through it again.',
      'That is what this place has become. They cannot die, and they cannot leave.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ['...Fine.'],
    button: 'Kill Heather',
  },
] as const satisfies ReadonlyArray<DialogPage>;

export function buildRitualFailedDialog() {
  return [...RITUAL_FAILED_CLOSING_PAGES];
}

//  Scene C: Heather is down

export const HEATHER_RETURN_DIALOG = [
  {
    title: SIGNET,
    lines: ['It is done ...Good. I can feel my spell coming to life now.'],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Grimaldi has made all these poor people suffer for too long. Everyone here used to be my friend. I miss them, but I know they would never want this.',
      "It's time to end this.",
    ],
    button: 'Begin the assault',
  },
] as const satisfies ReadonlyArray<DialogPage>;

//  Scene D: the briefing at the tent door

/** The potion the tent's last act is performed with, granted so it cannot be missing. */
const BIGTOP_POTION_REWARD = {
  itemId: 'health_potion',
  displayName: 'Health Potion',
  lines: ['Mordecai says pouring a health potion over the Pestiferous Vine will poison it...'],
  xp: 0,
} as const;

export const BIGTOP_READY_DIALOG = [
  {
    title: SIGNET,
    lines: [
      'You can enter the tent now, however I cannot.',
      'Go and stop my former husband. I cannot bear to see what he has become, but he needs to be stopped. I love him, but Grimaldi would never have wanted this for his family.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      "*The tent keeps you in separate lanes, so take turns and watch each other's path. Half the gates on Carl's side open from Donut's side, and the other way round. Lookout for traps.*",
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'A TWO-RING SHOW AND WE ARE THE HEADLINERS, CARL. FINALLY, A DUNGEON WITH TASTE. I WANT TOP BILLING AND SOMETHING SHINY TO SHOOT.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: ['Take this. Go. Finish the show.'],
    button: 'Enter the Big Top',
    reward: BIGTOP_POTION_REWARD,
  },
] as const satisfies ReadonlyArray<DialogPage>;

// Scene E: inside the tent
//
// The act banners themselves live beside the sections they name, in
// `src/map/bigTopMazeLayout.ts` — they are a property of the floor plan rather
// than a page of dialog, and duplicating them here would give the tent two
// places to disagree about what act it is running.

export const ACT_TWO_CARD = [
  {
    title: NARRATOR,
    lines: ['Walk through the former menagerie, keeping out of the lights.'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "Donut, I think there is something special about that brass bell on its stand. You may need to do something with that, because I don't see anything simlar on my side.",
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['CARL, I THINK THE AUDIENCE HAS BEEN DEAD FOR YEARS.'],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['HMM. IT IS STILL A BETTER TURNOUT THAN SOME DOG SHOWS I COULD NAME.'],
    button: 'Onward',
  },
] as const satisfies ReadonlyArray<DialogPage>;

export const ACT_THREE_CARD = [
  {
    title: NARRATOR,
    lines: [
      'The hall of mirrors. These can be turned and maybe if you shine the lights correctly, you can open the way forward.',
    ],
    button: 'Onward',
  },
] as const satisfies ReadonlyArray<DialogPage>;

/**
 * What the tent tells the party when it hauls them back to their marks.
 *
 * One page each, and the button closes it — the maze has already put both
 * crawlers back at the top of the act by the time it is read, so there is
 * nothing here to agree to. It exists to explain the jump, which would
 * otherwise read as the room having gone wrong rather than as the price of the
 * act.
 */
export const BURNOUT_FIRE_DIALOG = [
  {
    title: 'Burned',
    lines: ['Oh F**k. Maybe nextime do not stand in the fire?'],
    button: 'Get up',
  },
] as const satisfies ReadonlyArray<DialogPage>;

export const BURNOUT_SPOTLIGHT_DIALOG = [
  {
    title: 'Caught',
    lines: ['You had one job here; stay out of the light. Do better.'],
    button: 'Try again',
  },
] as const satisfies ReadonlyArray<DialogPage>;

export const BURNOUT_LIMELIGHT_DIALOG = [
  {
    title: 'Scorched',
    lines: ["Oof that probably hurt. Maybe don't get in the way of a laser beam next time."],
    button: 'Try again',
  },
] as const satisfies ReadonlyArray<DialogPage>;

// Scene F: the centre ring

export const LAST_ACT_DIALOG = [
  {
    title: NARRATOR,
    lines: [
      'You enter the center ring. A massive pale-green vine fills the stage, spreading across the floor and reaching all the way to the ceiling.',
      'The circus is still running around it. The dead fill the seats. The performers keep moving. The lights come up, one by one, until every one of them is pointed at the vine.',
      'This is Grimaldi.',
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['Ladies and gentlemen... please take your seats...', 'The show is about to begin.'],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['CARL. IT IS DOING A RINGMASTER VOICE. I NEED IT TO STOP DOING THE RINGMASTER VOICE.'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "That's Grimaldi. The vine isn't holding him. That's what he is now.",
      "And he's keeping all of them alive. The performers, the animals, everyone.",
      "So we don't kill him. If he's still in there somewhere, we give him a reason to let go.",
      'We walk up to him. No attacking. No sudden moves. I talk to him. You keep your paws to yourself.',
    ],
    button: 'Ready',
  },
] as const satisfies ReadonlyArray<DialogPage>;

// Scene G: the cure

/**
 * Everything up to the pour. The last page is Carl telling Donut to watch the
 * doors, which is the line the potion lands on.
 */
export const GRIMALDI_CURE_DIALOG = [
  {
    title: NARRATOR,
    lines: [
      'Carl walks into the center of the ring with his hands open.',
      'The Pestiferous Vine does not attack.',
      'Its roots twitch across the floor, but the rest of it stays still. The lights remain fixed on the stage.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ['Grimaldi. Redstone Grimaldi.', "I know you're still in there."],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['Ladies and gentlemen...', 'Please remain seated...', 'The show must go on.'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "No. It doesn't.",
      'Your people have been doing this for eleven years. They die, you bring them back, and then they do it all again.',
      "You think you're protecting them. I get that. But this isn't protecting them anymore.",
      "You're keeping them trapped.",
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['They are my family...', 'The show... must go on...'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'Signet is your family too.',
      "She's outside. She's been trying to get back to you this whole time.",
      "She doesn't want to kill you. She wants her husband back.",
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['...Signet...', 'My Tsarina...', 'She is safe?'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "She's safe.",
      "And I'm not going to kill you.",
      'But I need you to stop holding on.',
      "Donut, watch the doors. I'm giving him the potion.",
    ],
    button: 'Pour the potion',
  },
] as const satisfies ReadonlyArray<DialogPage>;

/** After the potion has done its work, with his voice tightening back to normal. */
export const GRIMALDI_FREED_DIALOG = [
  {
    title: GRIMALDI,
    lines: [
      'The house lights...',
      'I remember the house lights.',
      'I remember my people.',
      'I remember Signet.',
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: [
      'The show is over.',
      'It has been over for a very long time.',
      'Tell my wife she can come home.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'The circus goes quiet.',
      'The performers stop moving. The lights dim. Across the tent, the roots of the Pestiferous Vine slowly pull back.',
      'For the first time in eleven years, Grimaldi is no longer trying to keep the show alive.',
      'Outside, the doors of the big top swing open.',
    ],
    button: 'Leave the tent',
  },
] as const satisfies ReadonlyArray<DialogPage>;

// Scene H: outside, afterwards

export function buildResolutionDialog(mongoKidnapped: boolean): DialogPage[] {
  const pages: DialogPage[] = [
    {
      title: SIGNET,
      lines: ['Is it over? Did you kill him?'],
      button: 'Continue',
    },
    {
      title: `${GRIMALDI} (from within the tent)`,
      lines: ['Signet. Tsarina Signet.', 'My love, the show is over.', 'Come home.'],
      button: 'Continue',
    },
    {
      title: NARRATOR,
      lines: ["Every tattoo on Signet's body goes completely still.", '"...Redstone," she says.'],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'For eleven years, I thought the only way to save him was to kill him.',
        "I don't know what to do with the fact that I was wrong.",
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'You gave me back my husband.',
        "I don't know how to repay that.",
        'But Signet does not forget a debt, crawlers. She will never forget this one.',
      ],
      button: 'Continue',
    },
  ];

  if (mongoKidnapped) {
    pages.push({
      title: SIGNET,
      lines: [
        'And your beast is returned, as promised.',
        'He bit three of my tattoos, ate a fourth, and slept through most of the week.',
        'I think I will miss him.',
      ],
      button: 'Continue',
    });
  }

  pages.push({
    title: DONUT,
    lines: [
      'WELL, CARL. THE SHOW IS OVER, THE FAMILY IS FREE, AND NOBODY THANKED THE CAT WITH A CLOSING NUMBER.',
      'TYPICAL. I WILL BE ACCEPTING APPLAUSE AT THE EXIT.',
    ],
    button: 'Finish',
  });

  return pages;
}
