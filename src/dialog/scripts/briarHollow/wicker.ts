import { speakerLines } from '../../line';

const say = speakerLines('wicker');

export const WICKER = {
  backstory:
    "Wicker is the village carpenter and repairman. He builds doors, carts, ladders, shutters, and most of the structures nobody else has time to construct. During the siege, he helps reinforce the town's wooden defenses.",

  firstMeeting: say.line('Need something fixed?'),
  attackImminent: say.bark("I've barred every door that still closes."),
  afterVictory: say.bark("Give me some time and I'll make this place look like a village again."),
  questActive: say.line("Bring boards here and I'll turn them into something sturdier."),

  woodenWallBuilt: say.bark("That'll hold for a while. Don't ask me how long 'a while' is."),
  stoneUpgradeAvailable: say.line(
    "Stone can reinforce that. It'll cost more, but it'll take more punishment.",
  ),
} as const;
