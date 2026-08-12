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

// ── Scene A: caught spying ────────────────────────────────────────────────────

export const INTRO_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      "Well. Crawlers. On their bellies in the weeds, spying on my husband's circus. How bold. How stupid.",
      'Stand up. You will be of use.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'WE WERE NOT SPYING. WE WERE SCOUTING A VENUE. THERE IS A DIFFERENCE, AND THE DIFFERENCE IS CALLED SHOW BUSINESS.',
      'ALSO, CARL. HER TATTOOS ARE MOVING. THE OCTOPUS IS LOOKING AT ME, CARL.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Listen carefully. That is a level sixty Elite, and the show she stars in has a bigger budget than this entire floor. Be polite, do what she says, and whatever she asks for, do not negotiate.*',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "We're nobody. We saw lights over a dead circus and got curious. Curiosity is kind of our whole thing. What do you want?",
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Mold Lions approach. The mangy things can smell an audience. Hold them off while I finish this casting.',
      'And do try to bleed somewhere convenient. The ink drinks better warm.',
    ],
    button: 'Defend her',
  },
];

// ── Scene B: the ritual fails, and the story comes out ────────────────────────

/**
 * The pages every telling shares, after the branch on whether Mongo is here to
 * be taken as surety.
 */
const RITUAL_FAILED_CLOSING_PAGES: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'There is a bear. Heather. The crowds adored her. She danced, if you can believe it. What shuffles about in her skin now is not her. Though somewhere in there, deep down, a spark of the old girl is left.',
      'Hers is old circus blood, and old blood keeps its debts. It will wake my ink where yours failed.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ["You're asking us to put down your friend."],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'I am asking you to close a performance that has run eleven years past its final curtain. Kill her gently, if you can. Then return to me.',
    ],
    button: 'Hunt Heather',
  },
];

export function buildRitualFailedDialog(mongoPresent: boolean): DialogPage[] {
  const suretyPages: DialogPage[] = mongoPresent
    ? [
        {
          title: SIGNET,
          lines: [
            'As for insurance, your little beast comes with me. He will not be harmed. He will, in fact, be spoiled beyond recognition... so long as you do exactly as I say.',
          ],
          button: 'Continue',
        },
        {
          title: DONUT,
          lines: [
            'MONGO! CARL, SHE IS TAKING MONGO. THIS IS A KIDNAPPING. THIS IS AN ACTUAL KIDNAPPING AND SHE IS DOING IT POLITELY.',
          ],
          button: 'Continue',
        },
        {
          title: CARL,
          lines: ['He comes back fat and happy, or I stop being polite. Level sixty or not.'],
          button: 'Continue',
        },
      ]
    : [
        {
          title: SIGNET,
          lines: ['And before either of you gets any ideas about walking away...'],
          button: 'Continue',
        },
        {
          title: NARRATOR,
          lines: [
            "Signet closes her fist. White petals burst from the earth around Donut's paws and harden like porcelain. The cat is rooted to the ground, and the tattoos along Signet's arm go still, satisfied.",
          ],
          button: 'Continue',
        },
        {
          title: DONUT,
          lines: [
            'CARL. MY PAWS ARE FLOWERS. MY PAWS ARE FLOWERS AND I CANNOT FEEL MY DIGNITY. DO SOMETHING.',
          ],
          button: 'Continue',
        },
        {
          title: SIGNET,
          lines: [
            'The Water Lily holds until I release it. It can hold a week. It can hold a lifetime.',
            '...Forgive the theatre. A demonstration saves everyone the tedium of threats. Help me, and you will find that Signet pays her debts.',
          ],
          button: 'Continue',
        },
      ];

  return [
    {
      title: SIGNET,
      lines: [
        "Useless. Ash. The lions' blood is nothing. The ink wants old blood, blood that owes me, and all I fed it was vermin.",
        '...You fought well, for amateurs. Sit. Signet will tell you a story, and when it is finished you will understand why none of us is leaving.',
      ],
      button: 'Listen',
    },
    {
      title: SIGNET,
      lines: [
        'My mother was Lunette, tsarina of the naiads, murdered on the eve of her crowning. My blood father was Finian, king of the high elves. He never once looked at me. And when his trueborn daughter took his throne, she sent knives after every bastard he had scattered across the land.',
        'I was eight years old.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'I ran until the roads ran out, and at the end of the last one stood a circus. Redstone Grimaldi. A dwarf with a voice like a war drum and a heart three sizes too big for his ribs. He hid me from the knives. He fed me. He put me on a stage and gave me a family.',
        'When I cried that I should have been a tsarina, he bowed to the whole company and announced me: Tsarina Signet, princess of the high wire. It began as a joke. I have never been called anything truer.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'I grew up under that canvas. The child he saved grew into a woman, and the woman never once wanted to leave his side. Later, much later, we married.',
        'Laugh if you dare. Nobody who saw us together ever laughed.',
      ],
      button: 'Continue',
    },
    {
      title: DONUT,
      lines: [
        'CARL. A PERFORMER WITH A TRAGIC PAST, A STAGE NAME, AND A SHOWBIZ WEDDING.',
        'I HAVE NEVER RELATED TO ANYONE THIS HARD IN MY ENTIRE LIFE. GO ON. I AM LISTENING WITH BOTH EARS, WHICH I DO NOT DO FOR EVERYONE.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        "Then came Scolopendra's poison, rolling over the fairground on a show night, with every seat full. My family did not die. Worse. It folded my Grimaldi into a vine, and the vine keeps them all. Heather. The stilt-men. The lemurs. The clowns. Puppets on green strings, playing forever to empty seats.",
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        "The poison passed over me. And the tent will not let me pass at all. His last act as himself was to strike my name from the company's book. Banished. By my own husband, in his own hand.",
        'Eleven years I have come at night to end it. Eleven years the doors have opened for everything but me.',
      ],
      button: 'Continue',
    },
    {
      title: CARL,
      lines: ["So you can't get in. And everything that can get in is already his."],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'Precisely. First I need blood the ink will answer to. Then an army. Then two idiots the canvas has never met.',
      ],
      button: 'Continue',
    },
    ...suretyPages,
    ...RITUAL_FAILED_CLOSING_PAGES,
  ];
}

// ── Scene C: Heather is down ──────────────────────────────────────────────────

export const HEATHER_RETURN_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: ['It is done? ...Good.', 'Do not tell me how she looked at the end. Do not.'],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'SHE DANCED AT THE END. CARL IS MY WITNESS. I HAVE DECIDED THAT SHE DANCED, AND NOBODY IS GOING TO CORRECT ME.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      '...Thank you, little queen. She danced. We will all be saying so for the rest of our lives.',
      'Now watch, crawlers. Every mark on my skin is a debt owed to me, and tonight I call them all in.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'We clear the grounds act by act. The sideshows first. The lemurs, the stilt-men, whatever is left of Terror. Leave the big top for last.',
      'My husband is waiting, and I would have him see me coming.',
    ],
    button: 'Begin the assault',
  },
];

// ── Scene D: the briefing at the tent door ────────────────────────────────────

/** The potion the tent's last act is performed with, granted so it cannot be missing. */
const BIGTOP_POTION_REWARD = {
  itemId: 'health_potion',
  displayName: 'Health Potion',
  lines: ['Drink it to close your wounds.', 'Or pour it over something that needs closing more.'],
  xp: 0,
} as const;

export const BIGTOP_READY_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'The grounds are clear. Only the big top remains, and at its doors my banishment holds. The canvas will part for you and close before me. You go where I cannot.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Listen well. The tent is trapped end to end. Grimaldi never once staged a show without a floor that opened, and the vine remembers every trick he ever built. The fire walk. The menagerie. The hall of mirrors, and the limelight that still burns.',
      'It will run you like an act. Two performers, two rings. Neither of you will walk it alone.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      "*A split bill. The tent keeps you in separate lanes, so take turns and watch each other's path. Half the gates on Carl's side open from Donut's side, and the other way round. And if a spotlight so much as warms your fur, you are already somewhere you should not be.*",
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'A TWO-RING SHOW AND WE ARE THE HEADLINERS, CARL. FINALLY, A DUNGEON WITH TASTE.',
      'I WANT TOP BILLING AND SOMETHING SHINY TO SHOOT.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Take this. You will want it, and I think... I think you will find a use for it I have not the stomach to name.',
      'The thing at the pole wears my husband like a coat. When you reach it, whatever you find underneath, be kinder to it than the poison was.',
      'Go. Finish the show.',
    ],
    button: 'Enter the Big Top',
    reward: BIGTOP_POTION_REWARD,
  },
];

// ── Scene E: inside the tent ──────────────────────────────────────────────────
//
// The act banners themselves live beside the sections they name, in
// `src/map/bigTopMazeLayout.ts` — they are a property of the floor plan rather
// than a page of dialog, and duplicating them here would give the tent two
// places to disagree about what act it is running.

export const ACT_TWO_CARD: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      "The menagerie. The cages stand open, but the acts never left. Ushers' lanterns sweep the crossings, keeping the oldest rule of the house: no one walks the floor during a performance.",
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Those lanterns are on a shift pattern, and that brass bell on its stand is the house call to clear the floor. Donut rings it, both lanes go dark, and whoever is standing at a crossing walks it clean.*',
      '*Miss the window and duck into the alcoves cut off the boards. They are there for exactly that. Wait, let the light go by, move again.*',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'CARL, THE AUDIENCE IS STILL IN THE SEATS. THEY HAVE BEEN DEAD FOR ELEVEN YEARS AND IT IS STILL A BETTER TURNOUT THAN SOME VENUES I COULD NAME.',
    ],
    button: 'Onward',
  },
];

export const ACT_THREE_CARD: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The hall of mirrors. Somewhere ahead a limelight burns, too white to look at, thrown from glass to glass. Until it strikes its first mirror it is still fire. After that, it is only light.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['I COUNT FOURTEEN OF ME, CARL, AND EVERY SINGLE ONE IS MAGNIFICENT.'],
    button: 'Onward',
  },
];

/**
 * What the tent tells the party when it hauls them back to their marks.
 *
 * One page each, and the button closes it — the maze has already put both
 * crawlers back at the top of the act by the time it is read, so there is
 * nothing here to agree to. It exists to explain the jump, which would
 * otherwise read as the room having gone wrong rather than as the price of the
 * act.
 */
export const BURNOUT_FIRE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Burned',
    lines: [
      'The floor opens under your act and the fire takes its due. When the white clears you are back at the top of the act, singed, with the sawdust already raked smooth for your next attempt.',
    ],
    button: 'Get up',
  },
];

export const BURNOUT_SPOTLIGHT_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Caught',
    lines: [
      'The lantern light pins you flat, and unseen hands haul you back to your mark. The rule of the house is old and it is patient: no one crosses the floor during a performance.',
    ],
    button: 'Try again',
  },
];

export const BURNOUT_LIMELIGHT_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Scorched',
    lines: [
      'The unbent limelight crosses you like a brand. You wake at the top of the act with your outline smoking on the boards behind you.',
    ],
    button: 'Try again',
  },
];

// ── Scene F: the centre ring ──────────────────────────────────────────────────

export const LAST_ACT_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The centre ring. The patient dead fill every seat, and at the pole something enormous uncoils, green and slow and hung with swollen galls. Every lantern in the house swings toward it. The house still knows its star.',
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: [
      'Laaadiiiies aaand gentlemennnn... be seeeated... be seeeated...',
      '...the shoooow... muuust... go onnnn.',
    ],
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
      "Look at him. The vine's grown through him like roots through brick. We start cutting, we lose the dwarf with the weed.",
      "So nobody swings at anything in here. He's not a boss. He's a man who has been on stage for eleven years and nobody has ever once told him he can stop.",
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['SO WHAT DO WE DO. WE CANNOT HIT IT. THAT IS MY ENTIRE STRATEGY.'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'We walk up to him. Both of us, where he can see us. And then I talk, and you keep your paws to yourself, and we finish this the way it should have finished eleven years ago.',
    ],
    button: 'Ready',
  },
];

// ── Scene G: the cure ─────────────────────────────────────────────────────────

/**
 * Everything up to the pour. The last page is Carl telling Donut to watch the
 * doors, which is the line the potion lands on.
 */
export const GRIMALDI_CURE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'Carl walks into the ring with his hands open, and the enormous thing at the pole does not strike. Something in the great vine lets go instead. The coils sag like rigging with the tension cut, and down among the green, for the first time, you can make out the shape of a dwarf. Eyes closed, mouth still moving, keeping the show going out of nothing but habit.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ["Grimaldi. Redstone Grimaldi. That's your name. Not the show's. Yours."],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['the shooow... the show must... who... whooo is Grimaldiii...?'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "The ringmaster. The man who hid a half-naiad kid from her sister's knives, watched her grow up, and married her under this canvas. Your wife is outside right now. She's been out there every night for eleven years, trying to get back in to you.",
      "You banished her. Your last act as yourself, so the vine couldn't take her with the rest. She never figured that out. She thinks she failed you.",
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: [
      '...Siiignet... my Tsarina... she was not in the seats... when the poison came... she was safe... she was safe...',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      "She's safe. And I'm not here to kill you, so quit flinching. Donut, watch the doors. This is going to be either medicine or fertilizer.",
    ],
    button: 'Pour the potion',
  },
];

/** After the potion has done its work, with his voice tightening back to normal. */
export const GRIMALDI_FREED_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: GRIMALDI,
    lines: [
      'Oh... oh, the house lights. I remember the house lights.',
      'Tell the house: the banishment is struck. Strike it from the banns, strike it from the book. Let my wife come home.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'All through the tent, canvas shivers. Every grille goes cold in the same breath, the lanterns dim to a house glow, and out front, for the first time in eleven years, the doors of the big top stand open to everyone.',
    ],
    button: 'Leave the tent',
  },
];

// ── Scene H: outside, afterwards ──────────────────────────────────────────────

export function buildResolutionDialog(mongoKidnapped: boolean): DialogPage[] {
  const pages: DialogPage[] = [
    {
      title: SIGNET,
      lines: ['Is it over? Did you kill him?'],
      button: 'Continue',
    },
    {
      title: `${GRIMALDI} (from within the tent)`,
      lines: [
        'Signet. Tsarina Signet. Princess of the high wire.',
        'The banishment is struck, my love. Come in from the dark. Come home.',
      ],
      button: 'Continue',
    },
    {
      title: NARRATOR,
      lines: ['Every tattoo on her body goes perfectly still.'],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: ['Redstone.'],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'I built eleven years out of vengeance. Stone by stone. I find I do not know what to do with a door that simply... opens.',
        'You have handed me back the only life I ever wanted. Signet does not forget her debts, crawlers. Signet will never forget this one.',
      ],
      button: 'Continue',
    },
  ];
  if (mongoKidnapped) {
    pages.push(
      {
        title: SIGNET,
        lines: [
          'Your beast is returned, as promised. He bit three of my tattoos, ate a fourth, and slept the rest of the week. I confess I will miss him.',
        ],
        button: 'Continue',
      },
      {
        title: DONUT,
        lines: [
          'MONGO! YOU ARE ALIVE, AND YOU HAVE CLEARLY BEEN A NIGHTMARE. I HAVE NEVER BEEN PROUDER.',
        ],
        button: 'Continue',
      },
    );
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
