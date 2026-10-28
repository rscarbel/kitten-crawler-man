/**
 * Caroline's objective intel: for every objective, where it is, what it is
 * and whether it is optional. She gives it once per objective, when the party
 * first walks into a safe room while it is current. How to survive the thing
 * is Dave's to say (`dave.ts`).
 */

import { carolineLines, type CarolineMessage } from '../caroline';
import type { AdviceObjectiveId } from '../../systems/daveAdvice';
import type { CardinalDirection } from '../../utils';

export interface CarolineIntelArgs {
  /** The objective's bearing from the room she is speaking into, or null when it has no place to point at. */
  readonly direction: CardinalDirection | null;
}

type Intel = (args: CarolineIntelArgs) => CarolineMessage;

/**
 * A message whose `located` sentence names the bearing, said only when there
 * is one. `facts` is the rest of the message, said either way.
 */
function intel(
  facts: string,
  located: (direction: CardinalDirection) => string,
  unlocated = '',
): Intel {
  return ({ direction }) => {
    const where = direction === null ? unlocated : located(direction);
    return carolineLines.message(where === '' ? facts : `${where} ${facts}`);
  };
}

/** A message with no bearing in it: said in the room it is about. */
function fixed(text: string): Intel {
  const message = carolineLines.message(text);
  return () => message;
}

export const CAROLINE_OBJECTIVE_INTEL = {
  trash_gremlin: intel(
    'Classification: guardian. It holds the route to the nearest stairwell. It is not optional.',
    (direction) => `The Trash Gremlin occupies the chamber through the hallway ${direction}.`,
    'The Trash Gremlin occupies the chamber ahead.',
  ),

  big_rooster: intel(
    'Two lesser roosters guard the door. The route to the stairwell passes through him. It is not optional.',
    (direction) => `Big Rooster occupies the gym ${direction} of this room.`,
    'Big Rooster occupies the gym ahead.',
  ),

  defend_goblin_mother: intel(
    'A goblin mother and her young are inside. Hostiles will rise through its floor grates. Defending it is optional. The kills yield experience.',
    (direction) => `A goblin nursery lies ${direction} of this room, on the route forward.`,
    'A goblin nursery lies on the route forward.',
  ),

  krakaren_clone: intel(
    'It is a copy of a Krakaren that existed in this dungeon. It stands between you and the stairwell. It is not optional.',
    (direction) => `The Krakaren Clone is ${direction} of this room.`,
    'The Krakaren Clone is ahead.',
  ),

  stealth_gate: intel(
    'Its guard will not open it without the key. The key is held in the goblin prison beside it.',
    (direction) => `A locked gate on the route forward stands ${direction} of this room.`,
    'A locked gate stands on the route forward.',
  ),

  spider_lab: intel(
    'He is offering a contract. It is optional. The route to the stairwell does not require it.',
    (direction) => `A scientist waits at a sealed hallway ${direction} of this room.`,
    'A scientist waits at a sealed hallway on this floor.',
  ),

  spider_lab_started: intel(
    "Pest Control is active. Dr. Moult's printers have produced a hostile organism. The encounter is optional.",
    (direction) => `The laboratory is ${direction} of this room.`,
  ),

  spider_lab_station: fixed(
    'This station serves the laboratory at the end of the hallway outside. The scientist there is offering a contract. It is optional.',
  ),

  ball_of_swine: intel(
    'Its strength exceeds anything else on this floor. It is optional. Killing it guarantees a stairwell down.',
    (direction) => `The Ball of Swine occupies the iron arena ${direction} of this room.`,
    'The Ball of Swine occupies the iron arena ahead.',
  ),

  ball_of_swine_distant: intel(
    'Inside is the Ball of Swine. Its strength exceeds anything else on this floor. It is optional. Killing it guarantees a stairwell down.',
    (direction) => `An iron arena stands ${direction} of here.`,
    'An iron arena stands on this floor.',
  ),

  krasue_murders: intel(
    'Citizens of Taloncrest are being killed. The city guard classifies the killer as an animal. The classification is wrong. Investigation is optional.',
    (direction) => `The first killing was ${direction} of here.`,
  ),

  shady_bounties: intel(
    'A man outside the tattoo parlour in the Low Quarter pays for kills in the ruins. The work is optional and repeatable.',
    (direction) => `He is usually ${direction} of here.`,
  ),

  anchor_offer: intel(
    'A fortune teller in the plaza sells a faster way back than walking. It is optional.',
    (direction) => `Her table is ${direction} of here.`,
  ),

  anchor_stone: fixed(
    'The stone Madame Voss made returns your party to the town square from anywhere in the city. Used in the square, it returns you to where you last stood. It needs time between uses.',
  ),

  speed_fizz_tip: intel(
    'The tinker sells Speed Fizz. It doubles movement speed for twenty-five seconds.',
    (direction) => `His stall is ${direction} of here.`,
  ),
} as const satisfies Record<AdviceObjectiveId, Intel>;
