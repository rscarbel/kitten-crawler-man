import { speakerLines } from '../../line';

const say = speakerLines('marta');

export const MARTA = {
  backstory:
    "Marta is the most experienced fighter in the militia and acts as its unofficial captain. She is skilled at keeping frightened villagers organized and is trusted by the mayor to coordinate the town's defense.",

  firstMeeting: say.line("You want to help? Then listen when you're given an order."),
  attackImminent: say.bark('Positions! Everyone to the walls!'),
  enemyBreach: say.bark("They're inside! Fall back!"),
  afterVictory: say.bark("We held. That's all that matters."),

  ordersNeedMayor: say.line(
    "You don't give the orders here. Get the Mayor's word first, then we'll talk.",
  ),
  commandFollow: say.line("I'll follow your lead."),
  commandStay: say.line("I'll defend this position."),
  commandPatrol: say.line("I'll sweep the perimeter."),
  followActive: say.bark("I'm with you."),
  stayActive: say.bark('This position is secure.'),
  patrolActive: say.bark("I'm checking the perimeter."),
  patrolReturn: say.bark('No movement on the perimeter.'),
} as const;
