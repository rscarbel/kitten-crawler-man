import { speakerLines } from '../../line';

const say = speakerLines('pru');

export const PRU = {
  backstory:
    'Pru worked at the lumber yard before joining the militia. She is physically strong, practical, and still carries a spear with a shaft she made herself.',

  firstMeeting: say.line("Don't mind the spear. It's mostly for monsters."),
  afterVictory: say.bark('My spear survived. Good enough for me.'),

  ordersNeedMayor: say.line('I take my orders from the Mayor. Square things with him first.'),
  commandFollow: say.line('Right behind you.'),
  commandStay: say.line("I'll stay here."),
  commandPatrol: say.line("I'll check the perimeter."),
  followActive: say.bark('Still with you.'),
  patrolReturn: say.bark('Nothing obvious out there.'),
} as const;
