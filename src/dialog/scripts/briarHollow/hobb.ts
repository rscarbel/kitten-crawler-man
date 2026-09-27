import { speakerLines } from '../../line';

const say = speakerLines('hobb');

export const HOBB = {
  backstory:
    'Hobb has served as a village guard for most of his adult life. He is quiet, dependable, and particularly protective of the main gate, which he has repaired after every previous attack.',

  firstMeeting: say.line('State your business, then keep clear of the gate.'),
  enemyBreach: say.bark("They're through the outer defenses!"),

  ordersNeedMayor: say.line('Orders come from the Mayor, not from you.'),
  commandFollow: say.line("Aye. I'll follow."),
  commandStay: say.line("I'll hold here."),
  commandPatrol: say.line('Patrolling.'),
  followActive: say.bark('Lead on.'),
  patrolReturn: say.bark('Perimeter is clear for now.'),

  gateUnderAttack: say.bark("Gate's taking a beating!"),
} as const;
