import { PRONOUN_LABELS } from '../../characters/crawlerPronouns';
import { HUMAN_CRAWLER_APPEARANCE } from '../../characters/humanCrawlerLooks';
import { lookIdOf } from '../../characters/crawlerChoices';
import { playerIdentity } from '../../characters/playerIdentity';
import { isAtOrUnderLowHealth } from '../../core/combat/hpThresholds';
import { PET_KINDS, type PetNames } from '../../core/party/petNames';
import type { ActionSeverity } from '../actions/types';
import type { JsonObject } from './json';
import type { LiveInput, SessionInput } from './types';

/** Under this many seconds on the collapse clock the AI should treat the floor as urgent. */
export const LEVEL_TIMER_LOW_SECONDS = 120;
const SECONDS_PER_MINUTE = 60;

/**
 * Boolean context flags. Tool policies name these in `requiresContext` /
 * `forbidsContext`, so each name is part of the server contract: rename one
 * and every policy naming it silently stops matching.
 *
 * - `lowHp`: the active crawler is in the low-health band (`isAtOrUnderLowHealth`).
 * - `crawlerDown`: either crawler is knocked out and waiting for a revive.
 * - `levelTimerLow`: the collapse clock is running and under `LEVEL_TIMER_LOW_SECONDS`.
 * - `inMenu`: a menu or dialog other than the pause screen is up; `isPaused` covers both.
 * - `commentaryOnly`: the player's AI Intensity is Commentary. Every tool
 *   outside `COMMENTARY_ACTIONS` forbids it, which is how the server learns an
 *   allowlist that `allowedSeverities` cannot express.
 */
export const SESSION_FLAG_NAMES = [
  'inCombat',
  'inSafeRoom',
  'isPaused',
  'inMenu',
  'inBossFight',
  'lowHp',
  'crawlerDown',
  'indoors',
  'levelTimerLow',
  'commentaryOnly',
] as const;

export type SessionFlagName = (typeof SESSION_FLAG_NAMES)[number];
export type SessionFlags = Record<SessionFlagName, boolean>;

export interface ContextSetPayload {
  context: JsonObject;
  flags: SessionFlags;
  /** AI intensity: 0 stops AI-initiated activity; other values divide each tool's attention cost. */
  policyMultiplier?: number;
  /** Only tools of these severities may run; omitted allows every severity. */
  allowedSeverities?: readonly ActionSeverity[];
}

export function buildSessionFlags(
  session: SessionInput,
  live: LiveInput,
  commentaryOnly: boolean,
): SessionFlags {
  const active = live.crawlers[live.activeCrawler];
  const timerLow =
    session.levelTimerRunning &&
    session.levelTimerSeconds !== undefined &&
    session.levelTimerSeconds < LEVEL_TIMER_LOW_SECONDS;
  return {
    inCombat: live.combatInProgress || live.bossFightActive,
    inSafeRoom: live.location.inSafeRoom,
    isPaused: live.isPaused,
    inMenu: live.menuOpen,
    inBossFight: live.bossFightActive,
    lowHp: active.maxHp > 0 && isAtOrUnderLowHealth(active.hp, active.maxHp),
    crawlerDown: live.crawlers.human.knockedOut || live.crawlers.cat.knockedOut,
    indoors: session.indoors,
    levelTimerLow: timerLow,
    commentaryOnly,
  };
}

/**
 * The human crawler as the player made them. The name is text the player
 * typed; the AI server fences `humanCrawler.name` as untrusted player text,
 * so the name travels here and nowhere else in the context, live state,
 * events or action results, which name the human by `crawlerAIName`.
 */
function humanCrawlerJson(): JsonObject {
  const identity = playerIdentity();
  return {
    name: identity.name,
    pronouns: PRONOUN_LABELS[identity.body],
    appearance: HUMAN_CRAWLER_APPEARANCE[lookIdOf(identity)],
  };
}

/** The pets the player has named, by kind; the AI server fences each name as untrusted player text. */
function petNamesJson(petNames: PetNames): JsonObject {
  const named: JsonObject = {};
  for (const kind of PET_KINDS) {
    const name = petNames.nameOf(kind);
    if (name !== null) named[kind] = name;
  }
  return named;
}

/**
 * The session half of `context_set`. Clocks are reported in whole minutes so
 * the payload only changes when something worth re-sending changed, not every
 * second.
 */
export function buildSessionContext(
  session: SessionInput,
  petNames: PetNames,
  profile: JsonObject | null,
): JsonObject {
  const context: JsonObject = {
    floor: {
      number: session.floorNumber,
      levelId: session.levelId,
      name: session.floorName,
    },
    humanCrawler: humanCrawlerJson(),
    companions: [...session.companions],
    petNames: petNamesJson(petNames),
    difficulty: session.difficulty,
    minutesPlayed: Math.floor(session.secondsPlayed / SECONDS_PER_MINUTE),
    deaths: session.deaths,
    activeQuests: session.activeQuests.map((quest) => ({
      id: quest.id,
      name: quest.name,
      objective: quest.objective,
    })),
  };
  if (session.levelTimerSeconds !== undefined) {
    context.levelTimer = {
      minutesLeft: Math.ceil(session.levelTimerSeconds / SECONDS_PER_MINUTE),
      running: session.levelTimerRunning,
    };
  }
  if (profile !== null) context.playerProfile = profile;
  return context;
}
