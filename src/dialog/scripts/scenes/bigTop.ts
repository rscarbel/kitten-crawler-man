/**
 * The Big Top — the finale of "The Show Must Go On", inside the tent.
 *
 * Grimaldi speaks in a ringmaster's cadence stretched like taffy until the
 * cure tightens it back to a man's. Ryan talks him down the way he talks to
 * anyone: as a friend he has not made yet.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import { crawlerName } from '../../../characters/characters';

const HUMAN_NAME = crawlerName('human');
const CAT_NAME = crawlerName('cat');

/** The questline's own header, for a narration page with no more specific title to give it. */
const narrator = transientSpeaker('The Show Must Go On', 'narration');
const burned = transientSpeaker('Burned', 'narration');
const caught = transientSpeaker('Caught', 'narration');
const scorched = transientSpeaker('Scorched', 'narration');
const ryan = speakerLines('ryan');
const belle = speakerLines('belle');
const grimaldi = speakerLines('grimaldi');

// What put a crawler back at the top of an act.

export const BIGTOP_BURNOUT_FIRE: NonEmpty<DialogLine> = [
  burned.button('Get up', 'Oh F**k. Maybe nextime do not stand in the fire?'),
];

export const BIGTOP_BURNOUT_SPOTLIGHT: NonEmpty<DialogLine> = [
  caught.button('Try again', 'You had one job here; stay out of the light. Do better.'),
];

export const BIGTOP_BURNOUT_LIMELIGHT: NonEmpty<DialogLine> = [
  scorched.button(
    'Try again',
    "Oof that probably hurt. Maybe don't get in the way of a laser beam next time.",
  ),
];

// Act cards — shown once as each act's curtains part.

export const BIGTOP_ACT_TWO_CARD: NonEmpty<DialogLine> = [
  narrator.line('Walk through the former menagerie, keeping out of the lights.'),
  ryan.line(
    `${CAT_NAME}, see that brass bell on its stand? I bet it does something. Give it a go, because there's nothing like it over on my side.`,
  ),
  belle.line(`${HUMAN_NAME}, I think the audience has been asleep for years.`),
  belle.button('Onward', 'They look so cold. Maybe the lights will warm them up.'),
];

export const BIGTOP_ACT_THREE_CARD: NonEmpty<DialogLine> = [
  narrator.line(
    `The hall of mirrors. Every star must shine at the same time. Blue stars want ${HUMAN_NAME}'s light, red stars want ${CAT_NAME}'s, and a star split down the middle wants both at once. Light the whole board together and the way opens, and stays open. The gold star is an encore, for anyone showing off.`,
  ),
  ryan.line(
    'Check it out: a marquee over the exits, one bulb for every star. If a bulb goes dark, a star went dark with it. Fun!',
  ),
  belle.button(
    'Onward',
    "When every bulb on the marquee is lit, we can go. I like the bulbs. They're warm.",
  ),
];

// The centre ring.

export const BIGTOP_LAST_ACT: NonEmpty<DialogLine> = [
  narrator.line(
    'You enter the center ring. A massive pale-green vine fills the stage, spreading across the floor and reaching all the way to the ceiling. The circus is still running around it. The dead fill the seats. The performers keep moving. The lights come up, one by one, until every one of them is pointed at the vine. This is Grimaldi.',
  ),
  grimaldi.line('Ladies and gentlemen... please take your seats... The show is about to begin.'),
  belle.line(`${HUMAN_NAME}, the plant is talking. Hello, plant! Do you want to be friends?`),
  ryan.button(
    'Ready',
    `That's Grimaldi. The vine isn't holding him. That's what he is now. And he's keeping all of them alive. The performers, the animals, everyone. So we don't kill him. If he's still in there, we give him a reason to let go. We walk up to him. No attacking. No sudden moves. I'll talk to him. ${CAT_NAME}, paws to yourself for this one.`,
  ),
];

// The cure.

export const BIGTOP_GRIMALDI_CURE: NonEmpty<DialogLine> = [
  narrator.line(
    `${HUMAN_NAME} walks into the center of the ring with his hands open. The Pestiferous Vine does not attack. Its roots twitch across the floor, but the rest of it stays still. The lights remain fixed on the stage.`,
  ),
  ryan.line("Hey there, Grimaldi. Redstone Grimaldi. I know you're still in there."),
  grimaldi.line('Ladies and gentlemen... Please remain seated... The show must go on.'),
  ryan.line(
    "Nah. It really doesn't. Your people have been doing this for eleven years. They die, you bring them back, and then they do it all again. You think you're protecting them. I get that. But this isn't protecting them anymore. You're keeping them trapped.",
  ),
  grimaldi.line('They are my family... The show... must go on...'),
  ryan.line(
    "Signet is your family too. She's outside. She's been trying to get back to you this whole time. She doesn't want to kill you. She wants her husband back.",
  ),
  grimaldi.line('...Signet... My Tsarina... She is safe?'),
  ryan.button(
    'Pour the potion',
    `She's safe. And I'm not going to kill you, buddy. But I need you to stop holding on. ${CAT_NAME}, watch the doors. I'm giving him the potion.`,
  ),
];

/** After the potion has done its work, with his voice tightening back to normal. */
export const BIGTOP_GRIMALDI_FREED: NonEmpty<DialogLine> = [
  grimaldi.line(
    'The house lights... I remember the house lights. I remember my people. I remember Signet.',
  ),
  grimaldi.line(
    'The show is over. It has been over for a very long time. Tell my wife she can come home.',
  ),
  narrator.button(
    'Leave the tent',
    'The circus goes quiet. The performers stop moving. The lights dim. Across the tent, the roots of the Pestiferous Vine slowly pull back. For the first time in eleven years, Grimaldi is no longer trying to keep the show alive. Outside, the doors of the big top swing open.',
  ),
];
