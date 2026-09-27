/** Clarabelle, the Desperado Club's bouncer at the door. */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty, Paragraphs } from '../../line';

const say = speakerLines('clarabelle');
/** The door's own sign, for the narration page that sets the scene before Clarabelle speaks. */
const narrator = transientSpeaker('🔪  The Desperado Club  🔪', 'narration');

/** Clarabelle is immune to charm, and the cat is the crawler who leads with it. */
const CLARABELLE_CAT_LINE =
  '"And don\'t bother batting your eyes, furball. Charisma don\'t work on me."';

function greetingParagraphs(crawlerIsCat: boolean): Paragraphs {
  return crawlerIsCat
    ? [
        '"Yeah, yeah. Welcome to the Desperado Club. I\'m Clarabelle. I do the door."',
        '"Two house rules. I counted. No fighting inside — the club is neutral ground, always."',
        '"And spend money. That one\'s more of a feeling. It\'s my favourite one."',
        "\"First membership's free. Don't look at me, I didn't make it free. Take the Pass.\"",
        CLARABELLE_CAT_LINE,
      ]
    : [
        '"Yeah, yeah. Welcome to the Desperado Club. I\'m Clarabelle. I do the door."',
        '"Two house rules. I counted. No fighting inside — the club is neutral ground, always."',
        '"And spend money. That one\'s more of a feeling. It\'s my favourite one."',
        "\"First membership's free. Don't look at me, I didn't make it free. Take the Pass.\"",
      ];
}

function tattooGreetingParagraphs(crawlerIsCat: boolean): Paragraphs {
  return crawlerIsCat
    ? [
        '"Huh. That\'s a Desperado Pass. Tattooed on. So I can\'t sell you one. Great."',
        '"Two house rules: no fighting inside — the club is neutral ground, always. And spend money. Lots."',
        CLARABELLE_CAT_LINE,
      ]
    : [
        '"Huh. That\'s a Desperado Pass. Tattooed on. So I can\'t sell you one. Great."',
        '"Two house rules: no fighting inside — the club is neutral ground, always. And spend money. Lots."',
      ];
}

export const CLARABELLE = {
  /** Shown once, before the Desperado Pass is granted. */
  greeting(crawlerIsCat: boolean): NonEmpty<DialogLine> {
    return [
      narrator.line(
        "A lizard-faced Crocodilian in a bouncer's jacket leans across the doorway, chewing. She does not look up.",
      ),
      say.button('Take the Pass', greetingParagraphs(crawlerIsCat)),
    ];
  },

  /** Shown to a crawler who already earned the Pass as a tattoo from the Juicer. */
  tattooGreeting(crawlerIsCat: boolean): NonEmpty<DialogLine> {
    return [
      narrator.line(
        'A lizard-faced Crocodilian holds out a palm for the cover charge — then squints at the ink on your skin.',
      ),
      say.button('Enter the Club', tattooGreetingParagraphs(crawlerIsCat)),
    ];
  },

  /** A returning member with the Pass already in hand. */
  welcomeBack(crawlerIsCat: boolean): NonEmpty<DialogLine> {
    return crawlerIsCat
      ? [
          say.line('"You again. Pass is good. Rules ain\'t changed. Go spend something."'),
          say.line(CLARABELLE_CAT_LINE),
        ]
      : [say.line('"You again. Pass is good. Rules ain\'t changed. Go spend something."')];
  },
};
