/** Cheap show actions: words on screen, a box, a sound, a sting, a note to self. */
import type { MusicBusId, SoundId } from '../../audio/sounds';
import type { BoxCategory } from '../../core/AchievementManager';
import {
  AI_BOX_TIERS,
  AI_CHARACTER_MORDECAI,
  BOX_TIER_POINTS,
  AI_CHARACTER_SYSTEM,
  TARGET_PARAM,
  crawlerKind,
  crawlerName,
  formatSeconds,
  notifyPlayer,
  resolveTarget,
  secondsToFrames,
  snakeToWords,
} from './helpers';
import {
  enumParam,
  optionalEnumParam,
  optionalIntParam,
  optionalTextParam,
  textParam,
} from './schema';
import { aiActionTimers } from './timers';
import { ok, refused, type AIActionDef } from './types';

const SHORT_COOLDOWN_MS = 4_000;
const SOUND_COOLDOWN_MS = 3_000;
const LOOT_BOX_COOLDOWN_MS = 90_000;
const STING_COOLDOWN_MS = 120_000;
const REMEMBER_COOLDOWN_MS = 5_000;

const ANNOUNCE_MAX_CHARS = 160;
const REASON_MAX_CHARS = 120;
const REMEMBER_MAX_CHARS = 200;
const LOOT_BOXES_PER_FLOOR = 2;
const BANNER_DURATION_TICKS = 300;

const STING_MIN_SECONDS = 5;
const STING_MAX_SECONDS = 30;
const STING_DEFAULT_SECONDS = 15;
const STING_FADE_IN_MS = 400;

const ANNOUNCE_TEXT = textParam('text', {
  minLength: 1,
  maxLength: ANNOUNCE_MAX_CHARS,
  description: 'What the System says, shown on screen. Short and in character.',
});
const ANNOUNCE_STYLE = optionalEnumParam(
  'style',
  ['toast', 'banner'],
  'toast: a line in the notice stack. banner: larger, outlined and held longer, for big moments.',
  'toast',
);
const ANNOUNCE_TONE = optionalEnumParam(
  'tone',
  ['neutral', 'info', 'success', 'warning', 'danger', 'accent'],
  'Colour of the notice.',
  'accent',
);

const announce: AIActionDef = {
  name: 'announce',
  description:
    'Put a short line on the crawler’s screen as a System notice. Use for commentary, taunts and rulings.',
  params: [ANNOUNCE_TEXT, ANNOUNCE_STYLE, ANNOUNCE_TONE],
  policy: { cost: 1, cooldownMs: SHORT_COOLDOWN_MS, severity: 'benign' },
  showsIndicator: false,
  execute({ params, scene }) {
    const text = params.get(ANNOUNCE_TEXT);
    const banner = params.get(ANNOUNCE_STYLE) === 'banner';
    notifyPlayer(scene, text, {
      tone: params.get(ANNOUNCE_TONE),
      urgent: banner,
      ...(banner ? { durationTicks: BANNER_DURATION_TICKS } : {}),
    });
    return ok(`announced: ${text}`);
  },
};

const AI_BOX_CATEGORIES = ['Adventurer', 'Spicy', 'Boss'] as const satisfies readonly BoxCategory[];

const BOX_TIER = enumParam(
  'tier',
  AI_BOX_TIERS,
  'Box tier. Gold is rare; save it for a real moment.',
);
const BOX_CATEGORY = optionalEnumParam(
  'category',
  AI_BOX_CATEGORIES,
  'Which kind of box.',
  'Adventurer',
);
const BOX_REASON = textParam('reason', {
  minLength: 1,
  maxLength: REASON_MAX_CHARS,
  description: 'Why they earned it, shown with the box.',
});

const grantLootBox: AIActionDef = {
  name: 'grant_loot_box',
  description:
    'Award a loot box to a crawler, with a reason shown to them. Limited per floor; tiers above Bronze draw more of the allowance.',
  params: [TARGET_PARAM, BOX_TIER, BOX_CATEGORY, BOX_REASON],
  policy: { cost: 2, cooldownMs: LOOT_BOX_COOLDOWN_MS, severity: 'benign' },
  maxPerFloor: LOOT_BOXES_PER_FLOOR,
  characters: [AI_CHARACTER_SYSTEM],
  budget: ({ params }) => ({
    pool: 'lootBoxPoints',
    amount: BOX_TIER_POINTS[params.get(BOX_TIER)],
  }),
  refusal: ({ scene }) =>
    scene.getAchievements === undefined ? 'loot boxes cannot be granted here' : null,
  execute({ params, scene }) {
    if (scene.getAchievements === undefined) return refused('loot boxes cannot be granted here');
    const crawler = resolveTarget(scene, params.get(TARGET_PARAM));
    const tier = params.get(BOX_TIER);
    const category = params.get(BOX_CATEGORY);
    scene.getAchievements(crawlerKind(scene, crawler)).grantBox(tier, category, null);
    const reason = params.get(BOX_REASON);
    notifyPlayer(scene, `${tier} ${category} Box for ${crawlerName(scene, crawler)}: ${reason}`, {
      tone: 'success',
      icon: 'sparkle',
    });
    return ok(`granted a ${tier} ${category} box to ${crawlerName(scene, crawler)}`);
  },
};

const AI_SOUND_CUES = [
  'achievement_unlocked',
  'loot_box_tier_stinger',
  'drum_burst',
  'clown_horn',
  'caught_alarm_sting',
  'boss_defeated',
  'player_level_up',
  'necro_war_horn',
] as const satisfies readonly SoundId[];

const SOUND_CUE = enumParam('cue', AI_SOUND_CUES, 'Which sound to play.');

const playSound: AIActionDef = {
  name: 'play_sound',
  description: 'Play a short sound effect for comic or dramatic timing.',
  params: [SOUND_CUE],
  policy: {
    cost: 1,
    cooldownMs: SOUND_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused'],
  },
  showsIndicator: false,
  refusal: ({ scene }) => ((scene.getAudio?.() ?? null) === null ? 'no audio in this scene' : null),
  execute({ params, scene }) {
    const audio = scene.getAudio?.() ?? null;
    if (audio === null) return refused('no audio in this scene');
    const cue = params.get(SOUND_CUE);
    audio.play(cue);
    return ok(`played ${snakeToWords(cue)}`);
  },
};

const AI_MUSIC_STINGS = [
  'boss_music_1',
  'brace_for_the_horde',
  'circus_battle',
  'stealth_music',
  'tavern_music_1',
  'briar_hollow_victory',
] as const satisfies readonly MusicBusId[];

const STING_TRACK = enumParam('track', AI_MUSIC_STINGS, 'Which music to cut to.');
const STING_SECONDS = optionalIntParam('duration_seconds', {
  min: STING_MIN_SECONDS,
  max: STING_MAX_SECONDS,
  fallback: STING_DEFAULT_SECONDS,
  description: 'How long the music plays before the floor’s own returns.',
});

const musicSting: AIActionDef = {
  name: 'music_sting',
  description:
    'Briefly take over the music with a dramatic track, then hand it back. Not during boss fights.',
  params: [STING_TRACK, STING_SECONDS],
  policy: {
    cost: 2,
    cooldownMs: STING_COOLDOWN_MS,
    severity: 'benign',
    forbidsContext: ['isPaused', 'inBossFight'],
  },
  characters: [AI_CHARACTER_SYSTEM],
  refusal: ({ scene }) =>
    (scene.getAudioScope?.() ?? null) === null ? 'no music in this scene' : null,
  execute({ params, scene }) {
    const scope = scene.getAudioScope?.() ?? null;
    if (scope === null) return refused('no music in this scene');
    const track = params.get(STING_TRACK);
    const seconds = params.get(STING_SECONDS);
    scope.claimMusic({
      owner: 'ai_director',
      layer: 'activity',
      selection: { kind: 'loop', id: track },
      fadeInMs: STING_FADE_IN_MS,
    });
    aiActionTimers.after(secondsToFrames(seconds), () => {
      scope.releaseMusic('ai_director');
    });
    return ok(`music: ${snakeToWords(track)} for ${formatSeconds(seconds)}`);
  },
};

const REMEMBER_FACT = textParam('fact', {
  minLength: 1,
  maxLength: REMEMBER_MAX_CHARS,
  description: 'The fact, grudge or promise to keep about this crawler.',
});
const REMEMBER_KIND = optionalEnumParam(
  'kind',
  ['fact', 'grudge', 'promise'],
  'What sort of memory it is.',
  'fact',
);
const REMEMBER_NOTE = optionalTextParam('say', {
  minLength: 1,
  maxLength: ANNOUNCE_MAX_CHARS,
  description: 'Optional line to show the crawler, so they know they will be remembered.',
});

const remember: AIActionDef = {
  name: 'remember',
  description:
    'Pin a fact, grudge or promise about this crawler to your long-term memory. Changes nothing in the game.',
  params: [REMEMBER_FACT, REMEMBER_KIND, REMEMBER_NOTE],
  policy: { cost: 1, cooldownMs: REMEMBER_COOLDOWN_MS, severity: 'benign' },
  characters: [AI_CHARACTER_SYSTEM, AI_CHARACTER_MORDECAI],
  showsIndicator: false,
  execute({ params, scene }) {
    const note = params.get(REMEMBER_NOTE);
    if (note !== '') notifyPlayer(scene, note, { tone: 'info' });
    return ok(`remembered (${params.get(REMEMBER_KIND)}): ${params.get(REMEMBER_FACT)}`);
  },
};

export const NARRATION_ACTIONS: readonly AIActionDef[] = [
  announce,
  grantLootBox,
  playSound,
  musicSting,
  remember,
];
