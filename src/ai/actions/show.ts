/**
 * The show itself: achievements the AI writes, sponsor breaks, the crowd's
 * reactions on the favour meter, and questions put to the player. Each is
 * cheap and benign; what they cost is screen time, which the per-floor caps
 * and cooldowns ration.
 */
import {
  AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS,
  AI_ACHIEVEMENT_TITLE_MAX_CHARS,
} from '../../core/progression/AchievementManager';
import { AI_QUESTION_MAX_CHOICES, VIEWER_REACTIONS } from '../show/types';
import {
  AI_CHEST_RARITIES,
  AI_CHARACTER_SYSTEM,
  AI_CHARACTER_VIEWERS,
  CHEST_RARITY_POINTS,
  TARGET_PARAM,
  crawlerKind,
  crawlerName,
  notifyPlayer,
  resolveTarget,
} from './helpers';
import { enumParam, intParam, optionalTextParam, textParam, type ParamField } from './schema';
import { ok, refused, type AIActionCall, type AIActionDef } from './types';

const ACHIEVEMENT_COOLDOWN_MS = 60_000;
const SPONSOR_COOLDOWN_MS = 180_000;
const REACTION_COOLDOWN_MS = 10_000;
const QUESTION_COOLDOWN_MS = 60_000;

const ACHIEVEMENTS_PER_FLOOR = 3;
const SPONSOR_BREAKS_PER_FLOOR = 2;
const REACTIONS_PER_FLOOR = 20;
const QUESTIONS_PER_FLOOR = 4;

const ACHIEVEMENT_TITLE_MIN_CHARS = 3;
const ACHIEVEMENT_DESCRIPTION_MIN_CHARS = 8;
const SPONSOR_NAME_MIN_CHARS = 2;
const SPONSOR_NAME_MAX_CHARS = 40;
const SPONSOR_MESSAGE_MIN_CHARS = 8;
const SPONSOR_MESSAGE_MAX_CHARS = 200;
/** The most one reaction moves the 0–100 favour meter, either way. */
export const FAVOR_SWING_MAX = 10;
const REACTION_COMMENT_MAX_CHARS = 100;
const QUESTION_MIN_CHARS = 8;
const QUESTION_MAX_CHARS = 140;
const CHOICE_MAX_CHARS = 32;

// ── grant_achievement ───────────────────────────────────────────────────────

const ACHIEVEMENT_TITLE = textParam('title', {
  minLength: ACHIEVEMENT_TITLE_MIN_CHARS,
  maxLength: AI_ACHIEVEMENT_TITLE_MAX_CHARS,
  description:
    'The achievement’s name: snarky and specific to what just happened ("Fled From A Rat"). Each title can be awarded once per crawler.',
});
const ACHIEVEMENT_DESCRIPTION = textParam('description', {
  minLength: ACHIEVEMENT_DESCRIPTION_MIN_CHARS,
  maxLength: AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS,
  description: 'What they did to earn it, in your voice. Shown on the achievement card.',
});
const ACHIEVEMENT_RARITY = enumParam(
  'rarity',
  AI_CHEST_RARITIES,
  'The reward chest the achievement pays at once. Rare is scarce; save it for a real moment.',
);

function achievementRefusal({ params, scene }: AIActionCall): string | null {
  if (scene.getAwards === undefined) return 'achievements cannot be awarded here';
  const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
  const title = params.get(ACHIEVEMENT_TITLE);
  if (scene.getAwards().managerOf(crawlerKind(scene, crawler)).hasAIAchievement(title)) {
    return `${crawlerName(scene, crawler)} already holds "${title}"`;
  }
  return null;
}

const grantAchievement: AIActionDef = {
  name: 'grant_achievement',
  description:
    'Write and award a brand-new achievement on the spot: your own title and description, shown on the achievement card and kept in the crawler’s achievements, with a reward chest of the rarity you choose, paid at once. Limited per floor.',
  params: [ACHIEVEMENT_TITLE, ACHIEVEMENT_DESCRIPTION, ACHIEVEMENT_RARITY, TARGET_PARAM],
  policy: {
    cost: 2,
    cooldownMs: ACHIEVEMENT_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused'],
  },
  maxPerFloor: ACHIEVEMENTS_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM],
  budget: ({ params }) => ({
    pool: 'rewardChestPoints',
    amount: CHEST_RARITY_POINTS[params.get(ACHIEVEMENT_RARITY)],
  }),
  refusal: achievementRefusal,
  showsIndicator: false,
  execute(call) {
    const { params, scene, characterName } = call;
    const refusal = achievementRefusal(call);
    if (refusal !== null || scene.getAwards === undefined) {
      return refused(refusal ?? 'achievements cannot be awarded here');
    }
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const kind = crawlerKind(scene, crawler);
    const rarity = params.get(ACHIEVEMENT_RARITY);
    const award = scene.getAwards().grantAIAchievement(kind, {
      title: params.get(ACHIEVEMENT_TITLE),
      description: params.get(ACHIEVEMENT_DESCRIPTION),
      rarity,
      awardedBy: characterName,
    });
    if (award === null) return refused('that achievement could not be filed');
    const name = crawlerName(scene, crawler);
    notifyPlayer(scene, `Special award for ${name}: ${award.name}`, {
      tone: 'accent',
      icon: 'trophy',
      urgent: true,
    });
    scene.getAudio?.()?.play('achievement_unlocked');
    scene.getShow?.()?.achievementAwarded({
      title: award.name,
      description: award.description,
      rarity,
      player: kind === 'human' ? 'Human' : 'Cat',
      awardedBy: characterName,
    });
    return ok(`awarded "${award.name}" (${rarity} chest) to ${name}`);
  },
};

// ── sponsor_message ─────────────────────────────────────────────────────────

const SPONSOR_NAME = textParam('sponsor', {
  minLength: SPONSOR_NAME_MIN_CHARS,
  maxLength: SPONSOR_NAME_MAX_CHARS,
  description: 'The (made-up, galactic) sponsor’s name, e.g. "Borant Snack Pellets".',
});
const SPONSOR_MESSAGE = textParam('message', {
  minLength: SPONSOR_MESSAGE_MIN_CHARS,
  maxLength: SPONSOR_MESSAGE_MAX_CHARS,
  description: 'The advert, typed out in your terminal voice. One or two punchy sentences.',
});

function showRefusal(call: AIActionCall, what: string): string | null {
  return (call.scene.getShow?.() ?? null) === null ? `${what} cannot run here` : null;
}

const sponsorMessage: AIActionDef = {
  name: 'sponsor_message',
  description:
    'Cut to a short, skippable fake sponsor break: the sponsor’s name and an advert typed out on screen. The game halts while it runs, so only away from fights.',
  params: [SPONSOR_NAME, SPONSOR_MESSAGE],
  policy: {
    cost: 1,
    cooldownMs: SPONSOR_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused', 'inCombat', 'inBossFight'],
  },
  maxPerFloor: SPONSOR_BREAKS_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM],
  showsIndicator: false,
  refusal: (call) => {
    const missing = showRefusal(call, 'sponsor breaks');
    if (missing !== null) return missing;
    return call.scene.getShow?.()?.sponsorBreakShowing() === true
      ? 'a sponsor break is already on screen'
      : null;
  },
  execute({ params, scene }) {
    const show = scene.getShow?.() ?? null;
    if (show === null) return refused('sponsor breaks cannot run here');
    const sponsor = params.get(SPONSOR_NAME);
    show.runSponsorBreak({ sponsor, message: params.get(SPONSOR_MESSAGE) });
    return ok(`ran a sponsor break for ${sponsor}`);
  },
};

// ── viewer_reaction ─────────────────────────────────────────────────────────

const REACTION = enumParam('reaction', VIEWER_REACTIONS, 'How the audience reacts.');
const REACTION_DELTA = intParam('delta', {
  min: -FAVOR_SWING_MAX,
  max: FAVOR_SWING_MAX,
  description:
    'How far the viewers’ favour meter (0–100) moves. Positive when they love it. High favour makes reward chests pay a little more; low favour costs the crawler nothing.',
});
const REACTION_COMMENT = optionalTextParam('comment', {
  minLength: 1,
  maxLength: REACTION_COMMENT_MAX_CHARS,
  description: 'What the crowd is shouting, shown with the reaction.',
});

const viewerReaction: AIActionDef = {
  name: 'viewer_reaction',
  description: `Report how the galactic audience is taking what just happened, and move the Viewers favour meter on the HUD by up to ${FAVOR_SWING_MAX} either way.`,
  params: [REACTION, REACTION_DELTA, REACTION_COMMENT],
  policy: {
    cost: 1,
    cooldownMs: REACTION_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused'],
  },
  maxPerFloor: REACTIONS_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM, AI_CHARACTER_VIEWERS],
  showsIndicator: false,
  refusal: (call) => showRefusal(call, 'viewer reactions'),
  execute({ params, scene }) {
    const show = scene.getShow?.() ?? null;
    if (show === null) return refused('viewer reactions cannot run here');
    const reaction = params.get(REACTION);
    const { favor, moved } = show.reactViewers({
      reaction,
      delta: params.get(REACTION_DELTA),
      comment: params.get(REACTION_COMMENT),
    });
    const sign = moved > 0 ? '+' : '';
    return ok(`viewers ${reaction}: favour ${sign}${moved}, now ${favor}`);
  },
};

// ── ask_player ──────────────────────────────────────────────────────────────

const QUESTION = textParam('question', {
  minLength: QUESTION_MIN_CHARS,
  maxLength: QUESTION_MAX_CHARS,
  description:
    'The question, e.g. "Viewers want to know: save the cat or the loot?". The answer comes back as a playerAnswered event.',
});

function choiceParam(index: number, required: boolean): ParamField<string> {
  const bounds = {
    minLength: 1,
    maxLength: CHOICE_MAX_CHARS,
    description: `Answer button ${index}${required ? '' : ' (optional)'}.`,
  };
  return required
    ? textParam(`choice_${index}`, bounds)
    : optionalTextParam(`choice_${index}`, bounds);
}

const FIRST_OPTIONAL_CHOICE = 3;
const CHOICES: readonly ParamField<string>[] = Array.from(
  { length: AI_QUESTION_MAX_CHOICES },
  (_, offset) => choiceParam(offset + 1, offset + 1 < FIRST_OPTIONAL_CHOICE),
);

function choicesOf({ params }: AIActionCall): string[] {
  return CHOICES.map((field) => params.get(field)).filter((choice) => choice !== '');
}

function questionRefusal(call: AIActionCall): string | null {
  const missing = showRefusal(call, 'questions');
  if (missing !== null) return missing;
  if (call.scene.getShow?.()?.questionPending() === true) return 'a question is already waiting';
  const choices = choicesOf(call).map((choice) => choice.toLowerCase());
  if (new Set(choices).size !== choices.length) return 'two answers say the same thing';
  return null;
}

const askPlayer: AIActionDef = {
  name: 'ask_player',
  description:
    'Put a question to the player with two to four answer buttons. The game halts until they answer, so only away from fights. Returns at once with the question id; their answer (or silence) arrives later as a playerAnswered event worth remembering.',
  params: [QUESTION, ...CHOICES],
  policy: {
    cost: 1,
    cooldownMs: QUESTION_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused', 'inCombat', 'inBossFight'],
  },
  maxPerFloor: QUESTIONS_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM],
  showsIndicator: false,
  refusal: questionRefusal,
  execute(call) {
    const refusal = questionRefusal(call);
    const show = call.scene.getShow?.() ?? null;
    if (refusal !== null || show === null) return refused(refusal ?? 'questions cannot run here');
    const question = call.params.get(QUESTION);
    const questionId = show.ask({
      question,
      choices: choicesOf(call),
      askedBy: call.characterName,
    });
    return ok(`asked ${questionId}: ${question} (the answer arrives as a playerAnswered event)`);
  },
};

export const SHOW_ACTIONS: readonly AIActionDef[] = [
  grantAchievement,
  sponsorMessage,
  viewerReaction,
  askPlayer,
];
