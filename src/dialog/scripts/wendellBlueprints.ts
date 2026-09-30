/**
 * Wendell's part in "The Borrowed Blueprints": the Plumbline Farm resident
 * who has kept Fenna's plans since last year, and will only lend them back
 * for the dairy cow she once promised him.
 *
 * He was an architect who never found work as one, then a builder, and most
 * recently a farmer whose every cow died. He speaks the way he builds: more
 * carefully than the job strictly needs.
 */

import { speakerLines } from '../line';

const wendell = speakerLines('wendell');
const carl = speakerLines('carl');
const donut = speakerLines('donut');

export const WENDELL = {
  /** The first visit, after the crawlers ask about the blueprints. */
  remembersTheBlueprints: wendell.line([
    'A year already? I had thought it somewhat less than that, though I suppose that says more about my memory than about the calendar.',
    'Yes, I remember them. Fenna brought me the plans herself. I keep all such things, you see. A blueprint is not rubbish merely because the building has yet to be built.',
    'Saw station and rope walk. I have them here somewhere. I could produce them for you presently.',
  ]),
  /** The first visit, after the crawlers ask to borrow them: his price. */
  namesHisPrice: wendell.line([
    'Ah. That is rather less simple.',
    'You see, when Fenna left them with me, we had an understanding. I was to help her construct the saw station and rope walk, and she was to provide the materials.',
    "There was another part to the arrangement as well. When the work was done, she was to give me one of Merrit Roottail's dairy cows.",
    'I had a pasture prepared for it. Or, more accurately, I had a pasture prepared for several of them. I had grander notions when I began.',
    'The trouble is that all the cows I owned have since died, and I have consequently found myself without milk to sell to the taverns here—and without the animals themselves, which I admit I miss.',
    "So I am afraid I cannot simply hand over Fenna's plans as though our agreement had never existed.",
    'Get Fenna to agree to provide me with a healthy dairy cow, and the blueprints are yours to borrow. I shall even have them ready for you before you leave.',
  ]),
  /** The first visit, answering Donut. */
  missesTheCows: wendell.line([
    'Of course I do.',
    "One spends enough time alone in a field with an animal and eventually discovers that the animal has become part of one's daily life.",
    'They knew when I was coming, knew where I kept the feed, and had developed the unfortunate habit of staring at me whenever I was doing something they considered foolish.',
    'Which, I assure you, is a considerable portion of my activities.',
    'Besides, a pasture without cattle is merely an unusually expensive lawn.',
  ]),
  /** Every talk from naming his price until Midge is in his pasture. */
  waitingForCow: wendell.line(
    'The pasture is ready whenever the cow is. It has been ready for some time.',
  ),
  /** Midge is settled; he hands the blueprints over. */
  midgeDelivered: wendell.line("She's beautiful. Thank you! Here are the blueprints."),
  /** The blueprints were lost from the quest slot and found their way back to his plan chest. */
  blueprintsReturned: wendell.line(
    'Ah — they found their way home again. Blueprints have a habit of that. Here, and do try to keep hold of them this time.',
  ),
} as const;

/**
 * The crawler talking to Wendell on the first visit. Either can be the one
 * talking, so both voices carry the same words and the scene picks whichever
 * crawler the player is controlling.
 */
export const WENDELL_BLUEPRINTS_REPLIES = {
  carl: {
    askAboutBlueprints: carl.line(
      "Hi Wendell. Our friend Fenna from Briar Hollow mentioned she left some blueprints with you last year. They're for a saw station and a rope walk. Do you know which blueprints I mean?",
    ),
    askToBorrow: carl.line(
      "Wonderful! Could we have them back? It'll only be for a short while, and then we'll bring them right back to you.",
    ),
  },
  donut: {
    askAboutBlueprints: donut.line(
      "Hi Wendell. Our friend Fenna from Briar Hollow mentioned she left some blueprints with you last year. They're for a saw station and a rope walk. Do you know which blueprints I mean?",
    ),
    askToBorrow: donut.line(
      "Wonderful! Could we have them back? It'll only be for a short while, and then we'll bring them right back to you.",
    ),
  },
} as const;

/** The two lines on the first visit that belong to one crawler whoever is being controlled. */
export const WENDELL_BLUEPRINTS_ASIDES = {
  /** Donut, to Wendell, whoever asked about the blueprints. */
  donutAsksAboutCows: donut.line('You really miss the cows?'),
  /**
   * Carl, to Donut. He has not met Merrit yet, so the "he" is Carl guessing
   * at a farmer he has never seen.
   */
  carlPlansTheCow: carl.line(
    "It sounds like we just need to get one cow and collect some resources, that doesn't sound so bad. Let's go talk to the farmer in Briar Hollow to see if she'll give us a cow.",
  ),
} as const;
