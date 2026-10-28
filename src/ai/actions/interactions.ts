/**
 * The AI dealing with the player directly: achievements it writes and
 * questions it puts to them. Each is cheap and benign; what they cost is
 * screen time, which the per-floor caps and cooldowns ration.
 */
import { crawlerDisplayName } from '../../characters/characters';
import {
  AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS,
  AI_ACHIEVEMENT_TITLE_MAX_CHARS,
} from '../../core/progression/achievementSave';
import { AI_QUESTION_MAX_CHOICES } from '../interactions/types';
import {
  AI_CHEST_RARITIES,
  AI_CHARACTER_CAROLINE,
  CHEST_RARITY_POINTS,
  TARGET_PARAM,
  crawlerKind,
  crawlerNameForAI,
  notifyPlayer,
  resolveTarget,
} from './helpers';
import { enumParam, optionalTextParam, textParam, type ParamField } from './schema';
import { ok, refused, type AIActionCall, type AIActionDef } from './types';

const ACHIEVEMENT_COOLDOWN_MS = 60_000;
const QUESTION_COOLDOWN_MS = 60_000;

const ACHIEVEMENTS_PER_FLOOR = 3;
const QUESTIONS_PER_FLOOR = 4;

const ACHIEVEMENT_TITLE_MIN_CHARS = 3;
const ACHIEVEMENT_DESCRIPTION_MIN_CHARS = 8;
const QUESTION_MIN_CHARS = 8;
const QUESTION_MAX_CHARS = 140;
const CHOICE_MAX_CHARS = 32;

// ── grant_achievement ───────────────────────────────────────────────────────

const ACHIEVEMENT_TITLE = textParam('title', {
  minLength: ACHIEVEMENT_TITLE_MIN_CHARS,
  maxLength: AI_ACHIEVEMENT_TITLE_MAX_CHARS,
  description:
    'The achievement’s name: a precise classification of what just happened ("Retreated From A Rat"). Each title can be awarded once per crawler.',
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
    return `${crawlerNameForAI(scene, crawler)} already holds "${title}"`;
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
  characters: [AI_CHARACTER_CAROLINE],
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
    notifyPlayer(scene, `Special award for ${crawlerDisplayName(kind)}: ${award.name}`, {
      tone: 'accent',
      icon: 'trophy',
      urgent: true,
    });
    scene.getAudio?.()?.play('achievement_unlocked');
    scene.getInteractions?.()?.achievementAwarded({
      title: award.name,
      description: award.description,
      rarity,
      player: kind === 'human' ? 'Human' : 'Cat',
      awardedBy: characterName,
    });
    return ok((names) => `awarded "${award.name}" (${rarity} chest) to ${names.crawler(crawler)}`);
  },
};

function stageRefusal(call: AIActionCall, what: string): string | null {
  return (call.scene.getInteractions?.() ?? null) === null ? `${what} cannot run here` : null;
}

// ── ask_player ──────────────────────────────────────────────────────────────

const QUESTION = textParam('question', {
  minLength: QUESTION_MIN_CHARS,
  maxLength: QUESTION_MAX_CHARS,
  description:
    'The question, e.g. "Save the cat or the loot?". The answer comes back as a playerAnswered event.',
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
  const missing = stageRefusal(call, 'questions');
  if (missing !== null) return missing;
  if (call.scene.getInteractions?.()?.questionPending() === true)
    return 'a question is already waiting';
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
  characters: [AI_CHARACTER_CAROLINE],
  showsIndicator: false,
  refusal: questionRefusal,
  execute(call) {
    const refusal = questionRefusal(call);
    const stage = call.scene.getInteractions?.() ?? null;
    if (refusal !== null || stage === null) return refused(refusal ?? 'questions cannot run here');
    const question = call.params.get(QUESTION);
    const questionId = stage.ask({
      question,
      choices: choicesOf(call),
      askedBy: call.characterName,
    });
    return ok(
      () => `asked ${questionId}: ${question} (the answer arrives as a playerAnswered event)`,
    );
  },
};

export const INTERACTION_ACTIONS: readonly AIActionDef[] = [grantAchievement, askPlayer];
