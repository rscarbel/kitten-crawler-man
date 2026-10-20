import type { ActionSeverity } from '../actions/types';
import type { JsonObject } from './json';
import type { LiveInput, SessionInput } from './types';

/** A crawler below this share of max HP is "low" for the AI and for tool policies. */
export const LOW_HP_FRACTION = 0.25;
/** Under this many seconds on the collapse clock the AI should treat the floor as urgent. */
export const LEVEL_TIMER_LOW_SECONDS = 120;
const SECONDS_PER_MINUTE = 60;

/**
 * Boolean context flags. Tool policies name these in `requiresContext` /
 * `forbidsContext`, so each name is part of the server contract: rename one
 * and every policy naming it silently stops matching.
 *
 * - `lowHp`: the active crawler is below `LOW_HP_FRACTION` of max HP.
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
  const active = live.activeCrawler === 'Carl' ? live.carl : live.donut;
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
    lowHp: active.maxHp > 0 && active.hp / active.maxHp < LOW_HP_FRACTION,
    crawlerDown: live.carl.knockedOut || live.donut.knockedOut,
    indoors: session.indoors,
    levelTimerLow: timerLow,
    commentaryOnly,
  };
}

/**
 * The session half of `context_set`. Clocks are reported in whole minutes so
 * the payload only changes when something worth re-sending changed, not every
 * second.
 */
export function buildSessionContext(session: SessionInput, profile: JsonObject | null): JsonObject {
  const context: JsonObject = {
    floor: {
      number: session.floorNumber,
      levelId: session.levelId,
      name: session.floorName,
    },
    party: ['Carl', 'Donut', ...session.companions],
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
