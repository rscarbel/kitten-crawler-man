import { speakerLines } from '../../line';

const say = speakerLines('sedge');

export const SEDGE = {
  backstory:
    'Sedge is one of the younger members of the village militia. He joined after losing his older brother in an early necromancer raid. He is fast, alert, and eager to prove that he can protect the village.',

  firstMeeting: say.line("I'm on watch. Keep moving."),
  attackImminent: say.bark("They're coming!"),

  ordersNeedMayor: say.line("I don't take orders from strangers. Talk to the Mayor first."),
  commandFollow: say.line("Understood. I'll follow."),
  commandStay: say.line("I'll hold this position."),
  commandPatrol: say.line("I'll patrol the area."),
  followActive: say.bark('Still with you.'),
  stayActive: say.bark("I'm holding position."),
  patrolActive: say.bark("I'm sweeping the area."),
  patrolReturn: say.bark('Nothing moving nearby. Nothing I could see, anyway.'),
  enemySpotted: say.bark('Movement! Out there!'),
} as const;
