import { speakerLines } from '../../line';

const say = speakerLines('tikka');

export const TIKKA = {
  backstory:
    "Tikka manages the village's construction and defense preparations. She is practical, mechanically minded, and responsible for turning the materials gathered by the Crawlers into a functioning defensive position.",

  firstMeeting: say.line("You're the Crawlers. Good. I need labor more than I need introductions."),
  attackImminent: say.bark(
    "That's all the preparation we're getting. Whatever we've built is what we have.",
  ),
  afterVictory: say.bark("The walls held. Mostly. I'll take mostly."),

  questExplanation: say.line(
    "We're building defenses before the next attack. That means wood, stone, and a great deal of work.",
  ),
  toolsRequired: say.line('First things first. Get an axe and a pickaxe from Oren.'),
  axeTask: say.line('Take the axe and chop trees. Every tree out there can provide wood.'),
  pickaxeTask: say.line(
    'Take the pickaxe and gather stone from the rock deposits around the ruins.',
  ),
  woodProcessingTask: say.line(
    "Raw wood isn't what we build with. Take it to Fenna at the lumber yard and turn it into boards or rope.",
  ),
  constructionSkillAlreadyGranted: say.line(
    "You've already learned Construction. Go build something.",
  ),
  wallsTopic: say.line([
    'The fence around the town is flimsy. One hit can destroy it. Use five boards of wood to turn a section into a proper wooden wall.',
    'A wooden wall can be upgraded with five stone. That turns it into a much stronger stone wall.',
    'Stone can be reinforced further. Eight stone and two boards turns a stone wall into a fortified stone wall.',
    'Wooden walls are repaired with boards. Stone walls are repaired with stone. Repairs are cheaper than replacing the whole section.',
  ]),
  trebuchetsTopic: say.line([
    "A trebuchet needs fifteen boards and five rope. It occupies a two-by-three space, so make sure there's room.",
    'Trebuchets throw stone. They can hold twenty-five pieces of ammunition at once.',
    'If a trebuchet breaks, repair it with three boards and one rope. Damage can be repaired the same way.',
  ]),
  snareExplanation: say.line(
    'A snare takes three boards and one rope. It occupies one tile and stops enemies in place when they trigger it.',
  ),
  spikesUnlocked: say.line(
    "You've gotten good enough at Construction to add spikes. Hold the interaction menu on a construction and you'll see the option.",
  ),
  level10Construction: say.line(
    'Your construction skill is getting efficient. Resource costs are starting to drop.',
  ),
  level15Construction: say.line(
    "At this point, you're not really building anymore. You're performing miracles with lumber and stone.",
  ),
  reportPlans: say.line([
    "If you have the resources and skill, I'd like to show you some plans for a few contraptions I've designed that will rattle Vordrick Boneharrow.",
    "While I get those plans together, why don't you go over to Fenna Splintertail, and tell her we need you to be able to access the saw and rope walk.",
    "I can't do much with just the raw lumber you have. It needs to be refined into boards of wood and rope for me to do anything useful with it. Go there and bring me back 20 boards of wood and 5 rope.",
  ]),
  plansHandoff: say.line([
    'Wonderful! This is exactly what we needed to get started.',
    "Here, take a look at the plans I've drawn up, this should help you build up defenses around Briar Hollow. Why don't you try upgrading our fence to a wall and build some trebuchets to keep our village safe.",
  ]),
} as const;
