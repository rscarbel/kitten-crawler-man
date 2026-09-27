/**
 * The goblin mother's plea to hold the nursery — the offer `DefendQuestSystem`
 * opens when a crawler first reaches her.
 */

import { speakerLines } from '../../line';

const say = speakerLines('goblinMother');

export const GOBLIN_MOTHER = {
  defendRequest: say.line(
    'Please — things are coming up through the floor grates, and my brood is in here. The road on is open; nobody is making you stop. But stay, and I bar the far door until it is over, win or lose. Hold with me until my child is back, and I will owe you for it.',
  ),
};
