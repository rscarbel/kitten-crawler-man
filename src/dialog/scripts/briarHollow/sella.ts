import { speakerLines } from '../../line';

const say = speakerLines('sella');

const askAboutHealing = say.line(
  "I'll restore you for a fee. No need to make a larger problem out of a smaller one.",
);

export const SELLA = {
  backstory:
    "Sella is Briar Hollow's physician and has years of experience treating injuries caused by monsters, accidents, and village raids. She has seen the consequences of the necromancer's attacks up close and is especially strict about making sure injured people are treated before returning to combat.",

  firstMeeting: say.line("You look healthy. Let's keep it that way."),
  attackImminent: say.bark(
    "I've moved the patients somewhere defensible. If anyone is hurt, bring them to me.",
  ),
  afterVictory: say.bark('Count your injuries later. For now, enjoy being alive.'),
  questActive: say.line(
    'The best treatment I can give this village is keeping the dead outside the walls.',
  ),
  fallbackQuestions: [askAboutHealing],

  // Sella's own header key was "service_menu" rather than "shop_open"; the
  // bark is the same kind of line every other vendor's menu opens with.
  shopOpen: say.bark(
    "I provide treatment for a fee. Sit down, I'll patch you up, and then you can go back to getting yourself injured.",
  ),
  cannotAfford: say.bark("I can sympathize, but medicine isn't free."),

  askAboutHealing,
  buyHealing: say.bark('Treatment will cost you. Hold still.'),
  healingComplete: say.bark('There. Good as new. Try not to make me undo my work.'),
  fullyHealthy: say.bark(
    "You're already fine. Spending money here would be an impressive waste of it.",
  ),
} as const;
