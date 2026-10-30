/**
 * The Town Center Tower's front door and the two guards posted at it:
 * groundfolk who have stood the tower's door for decades and have seen no
 * more of the Warden than a mask at the top of the stairs. The door never
 * opens. The night the Warden is gone the tower's bells stop, and the
 * guards stay at their post without knowing what for. After that an order
 * closes the tower, and nobody at the door knows who gave it.
 */

import { speakerLines } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';

const guard = speakerLines('towerGuard');
const humanCrawler = speakerLines('human_crawler');

/** Which side of the tower's door a guard is posted on. */
export type TowerDoorPost = 'west' | 'east';

/**
 * What the door and its guards answer with: the tower's long-standing rule,
 * the night its bells stopped, or the order that closed it after the Warden
 * was gone.
 */
export type TowerDoorStanding = 'barred' | 'bellsStopped' | 'closedByOrder';

/** One of these per talk, by the guard's post and what the door answers with. */
export const TOWER_DOOR_GUARD_LINES = {
  west: {
    barred: [
      guard.line("The tower's shut to the public. It's been shut as long as I've worn this."),
      guard.line(
        "Nobody goes up without the Warden's word. I haven't had the Warden's word in twenty-two years.",
      ),
      guard.line('I stand here, he stands there, and the door stays shut. I like the job.'),
    ],
    bellsStopped: [
      guard.line(
        "Those bells have rung the hours since before I was born. They stopped. I don't know what I'm meant to do about that.",
      ),
      guard.line("Nobody's come down. Nobody's said stand down either, so I'm standing."),
    ],
    closedByOrder: [
      guard.line(
        "Closed by order. Don't ask me whose. It came down the stairs the way they always have.",
      ),
      guard.line(
        "The tower's closed by order. Same paper, same hand. I'd like to know whose hand it is now.",
      ),
    ],
  },
  east: {
    barred: [
      guard.line(
        "Not this door. I've been up those stairs once. There was a mask at the top. I came back down.",
      ),
      guard.line("My mother stood this door before me. She didn't let anyone in either."),
      guard.line("The Warden's notices go up on the board. That's as close as anyone gets."),
    ],
    bellsStopped: [
      guard.line('Did you hear that? No, you did not. That is the trouble. The bells stopped.'),
      guard.line("If something's wrong up there, it isn't my door that's wrong. I'm staying put."),
    ],
    closedByOrder: [
      guard.line("Closed by order. Whose order, I couldn't tell you. Nobody up there answers."),
      guard.line("A new order came down this morning. Tower's closed. It wasn't signed."),
    ],
  },
} as const satisfies Record<TowerDoorPost, Record<TowerDoorStanding, NonEmpty<DialogLine>>>;

/**
 * The human walks out of the tower's front door past its guards, who never
 * saw him go in, and talks his way past them.
 */
export const TOWER_DOOR_WALK_OUT: NonEmpty<DialogLine> = [
  guard.line('Hey! How did you get in there?'),
  humanCrawler.line(
    'Uhh... I was bringing in an extra order of tuna. Boss said we needed a little extra right now.',
  ),
  guard.line('Okay. Just make sure our manager knows so he can tell us next time.'),
];

/** The toast the tower's front door answers a crawler with. */
export const TOWER_DOOR_REFUSALS = {
  barred: "The door is locked and magically sealed. There's no getting through.",
  bellsStopped: 'The tower door is barred from inside. Above it, the bells are silent.',
  closedByOrder: 'The tower door is barred. A fresh notice on it reads: Closed by order.',
} as const satisfies Record<TowerDoorStanding, string>;

/** Speech-bubble reactions to a blow, said by any tower guard. */
export const TOWER_GUARD_HIT_BARKS: NonEmpty<BarkLine> = [
  guard.bark('Ow!'),
  guard.bark('Hey!'),
  guard.bark('Mind the livery.'),
];

/** Interaction prompt labels at the tower's door. */
export const TOWER_DOOR_PROMPTS = {
  talkToGuard: 'Talk to the guard',
} as const;
