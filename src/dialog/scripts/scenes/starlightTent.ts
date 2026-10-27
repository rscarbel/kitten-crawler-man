/**
 * The Starlight Tent's maze: the notices that put a crawler back at the top of an
 * act, and the cards that open each act after the first.
 */

import { STARLIGHT_TENT_NAME } from '../../../map/overworld/circusGroundsLayout';
import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import { crawlerName } from '../../../characters/characters';

const HUMAN_NAME = crawlerName('human');
const CAT_NAME = crawlerName('cat');

/** The tent's own header, for a narration page with no more specific title to give it. */
const narrator = transientSpeaker(STARLIGHT_TENT_NAME, 'narration');
const burned = transientSpeaker('Burned', 'narration');
const caught = transientSpeaker('Caught', 'narration');
const scorched = transientSpeaker('Scorched', 'narration');
const ryan = speakerLines('ryan');
const belle = speakerLines('belle');

// What put a crawler back at the top of an act.

export const STARLIGHT_TENT_BURNOUT_FIRE: NonEmpty<DialogLine> = [
  burned.button('Get up', 'Oh F**k. Maybe nextime do not stand in the fire?'),
];

export const STARLIGHT_TENT_BURNOUT_SPOTLIGHT: NonEmpty<DialogLine> = [
  caught.button('Try again', 'You had one job here; stay out of the light. Do better.'),
];

export const STARLIGHT_TENT_BURNOUT_LIMELIGHT: NonEmpty<DialogLine> = [
  scorched.button(
    'Try again',
    "Oof that probably hurt. Maybe don't get in the way of a laser beam next time.",
  ),
];

// Act cards — shown once as each act's curtains part.

export const STARLIGHT_TENT_ACT_TWO_CARD: NonEmpty<DialogLine> = [
  narrator.line('Walk through the former menagerie, keeping out of the lights.'),
  ryan.line(
    `${CAT_NAME}, see that brass bell on its stand? I bet it does something. Give it a go, because there's nothing like it over on my side.`,
  ),
  belle.button('Onward', `Stay out of the lights, ring the bell. Easy, ${HUMAN_NAME}.`),
];

export const STARLIGHT_TENT_ACT_THREE_CARD: NonEmpty<DialogLine> = [
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
