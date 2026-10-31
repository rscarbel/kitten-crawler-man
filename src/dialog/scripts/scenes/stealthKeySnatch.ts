/**
 * The stealth gate room: Snorgle, the gate guard, bored and very proud of the
 * Goblin High Security Prison's record; the prison's patrol guards; and the
 * goblins in its cells.
 */

import { speakerLines } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';

const gateGuard = speakerLines('prisonGateGuard');
const patrolGuard = speakerLines('prisonGuard');
const prisoner = speakerLines('goblinPrisoner');

export const GATE_GUARD_LINES: {
  /** The briefing: gate, key, prison, side door, and the prison's rules. Reading it starts the quest. */
  readonly firstTalk: NonEmpty<DialogLine>;
  /** One of these per talk while the party is looking for the key. */
  readonly briefedPool: NonEmpty<DialogLine>;
  /** Said while he takes the key and opens the gate. */
  readonly handOver: NonEmpty<DialogLine>;
  /** One of these per talk once the gate is open. */
  readonly afterPool: NonEmpty<DialogLine>;
} = {
  firstTalk: [
    gateGuard.line(
      "Halt. Nobody goes through this gate. It's locked. I'm the gate guard. It's a very important job. They gave me a hat.",
    ),
    gateGuard.line(
      "Gate needs a key. No key, no gate. The gate key's locked up in the Goblin High Security Prison. Nobody's ever got anything out of there. Well. Not since Tuesday.",
    ),
    gateGuard.line(
      "Prison's through the big door on the side, there. Prison rules: no pets, no hired muscle. They wait out here with me. Bring me the gate key and I'll open the gate. Probably.",
    ),
  ],
  briefedPool: [
    gateGuard.line(
      "Gate key's in the prison. Prison's through the side door. Gate's locked. Same as before.",
    ),
    gateGuard.line(
      "Nobody gets out of that prison. Except on Tuesday. We don't talk about Tuesday. Go get the gate key.",
    ),
    gateGuard.line('No key, no gate. I could say it slower.'),
  ],
  handOver: [
    gateGuard.line(
      "Is that... that's the gate key. Out of the prison? Huh. That's a first. Since Tuesday.",
    ),
    gateGuard.line(
      "Fine. Rules are rules. Key opens gate. Don't tell the warden. He thinks his record is perfect.",
    ),
  ],
  afterPool: [
    gateGuard.line("Gate's open. Go on, before I think about it too hard."),
    gateGuard.line("I'm writing this up as a drill. A drill I passed."),
  ],
};

/** The bark over the gate guard when a crawler tries the locked gate without the key. */
export const GATE_LOCKED_BARK: BarkLine = gateGuard.bark('Key. No key, no gate.');

/** The bark over the gate guard when a crawler unlocks the gate with the key himself. */
export const GATE_UNLOCKED_BARK: BarkLine = gateGuard.bark(
  "Hey, that's the gate key! ...Fine. Gate's open. I'm calling it a drill.",
);

/** Speech-bubble reactions to a blow, in each guard's own voice. */
export const PRISON_HIT_BARKS: {
  readonly gateGuard: NonEmpty<BarkLine>;
  readonly patrol: NonEmpty<BarkLine>;
} = {
  gateGuard: [
    gateGuard.bark('Ow! Assaulting an officer!'),
    gateGuard.bark('Hey! Hat!'),
    gateGuard.bark('Ouch. Still no.'),
  ],
  patrol: [patrolGuard.bark('Ow!'), patrolGuard.bark('Oi!'), patrolGuard.bark('Oof!')],
};

/** What the goblins in the cells shout through the bars. Flavour only. */
export const PRISONER_HECKLE_BARKS: NonEmpty<BarkLine> = [
  prisoner.bark("I'm innocent! Mostly!"),
  prisoner.bark('Psst. Got a spoon?'),
  prisoner.bark('Guards! GUARDS! ...Just checking.'),
  prisoner.bark('Tuesday was me. Do it again, I would.'),
  prisoner.bark("Don't eat the porridge."),
];

/** Interaction prompt labels for the gate room. */
export const STEALTH_GATE_PROMPTS = {
  talkToGuard: 'Talk to the guard',
  unlockGate: 'Unlock the gate',
  tryGate: 'Try the gate',
  readSign: 'Read the sign',
} as const;
