import type { LevelId } from '../levels/levelIds';
import type { SavedWorld } from '../core/save/SavedWorld';
import type { PlayerSnapshot } from '../core/save/playerSnapshotFormat';
import type { SerializedAbilityState } from '../core/skills/AbilityManager';
import type { SerializedAchievements } from '../core/progression/achievementSave';
import type { GameStatsSnapshot } from '../core/progression/GameStats';
import type { PartyCraftsState } from '../core/labour/partyCrafts';
import type {
  PendingWheelOutcome,
  WheelCrawler,
  WheelQuestFreeSpins,
} from '../core/save/WheelLedger';
import type { DoubleDamageRemaining } from '../core/save/doubleDamageSave';
import type { SerializedMusicLibrary } from '../core/music/MusicLibrary';
import type { StoryBeatId } from '../story/storyBeatIds';
import type { AdviceObjectiveId } from '../story/adviceObjectiveIds';
import type { SavedPetNames } from '../core/party/petNames';
import type { PlayerIdentity } from '../characters/playerIdentity';
import type { NewGameCarry } from '../core/save/newGameCarry';
import { parseGameProgress } from '../core/save/saveFormat';
import { PAGE_SAVE_LATCH, type ProgressStorage } from '../core/save/progressPersistence';
import { wipeOwed } from '../core/save/wipeMarker';

/** HTTP status code for server error (fallback for API errors). */
const HTTP_SERVER_ERROR = 500;

export interface AuthUser {
  id: number;
  username: string;
}

export interface GameProgress {
  levelId: LevelId;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  /**
   * Ability levels and XP, which belong to the party rather than to either
   * crawler and so have no home in a `PlayerSnapshot`.
   */
  abilityStates: SerializedAbilityState[];
  /** Whether the `dungeon_kills_200` achievement's chest has been opened and Deinonychus is available at all. */
  deinonychusUnlocked: boolean;
  /** The pet's HP, which persists across summons and sessions. */
  deinonychusPetHp: number;
  /**
   * Whether he is resting off a knockout, which blocks summoning until he is
   * back to full. Stored separately from the HP because it is a latch: the HP
   * alone cannot say whether a half-healed dinosaur is on his way back up from
   * zero or was simply recalled hurt.
   */
  deinonychusPetResting: boolean;
  /**
   * Shared axe/pickaxe tiers and which craft-skill explainers have already
   * played. Party progress rather than either crawler's own — a tool upgrade
   * always applies to both inventories at once.
   */
  crafts: PartyCraftsState;
  /**
   * Each crawler's unlocked achievements, unread notices and the paid rewards
   * still waiting for the reward screen.
   */
  humanAchievements: SerializedAchievements;
  catAchievements: SerializedAchievements;
  /**
   * The floor's generation seeds and the save point to stand back in. Absent
   * on the tutorial's saves and the level-complete save, whose party resumes
   * on a freshly generated floor.
   */
  world?: SavedWorld;
  /**
   * The run's tallies for the Stats tab and the run-complete screen. Kept at
   * the top level rather than inside `world`, because the save a floor change
   * writes carries no `world` and the run's record has to cross floors.
   */
  gameStats: GameStatsSnapshot;
  /**
   * The wheel's good prizes the party has already won, which it never draws
   * again. Top level because a floor change carries no `world`; cleared only by
   * a wipe.
   */
  wheelPrizesWon: string[];
  /**
   * A spin committed before its wheel turned and not yet paid out. A load
   * applies it and clears it, so closing the tab mid-spin cannot undo it.
   */
  pendingWheelOutcome: PendingWheelOutcome | null;
  /** The bet whose board a landed Spin Again still owes a free spin on. */
  wheelFreeSpinBet: number | null;
  /** The crawler a wheel freeze is still owed to, spent on the next load. */
  wheelOwedFreeze: WheelCrawler | null;
  /** Quest-earned wheel spins and the taped chain one is playing. */
  wheelQuestFreeSpins: WheelQuestFreeSpins;
  /** Frames of double damage each crawler has left. */
  doubleDamageRemaining: DoubleDamageRemaining;
  /** Whether the human crawler owns the attack cow. */
  attackCowOwned: boolean;
  /** The cow's HP; absent while she is at a full health not yet measured. */
  attackCowHp?: number;
  /** Whether the cow is resting off a knockout, which holds her out until she is full. */
  attackCowResting: boolean;
  /** The songs the run has unlocked and heard. Top level because a floor change carries no `world`. */
  musicLibrary: SerializedMusicLibrary;
  /**
   * The story beats the run has heard, in play order. Written the moment a
   * beat finishes as well as on every save, so a beat never plays twice.
   */
  storyBeatsSeen: readonly StoryBeatId[];
  /** The objectives Caroline has briefed the party on, written alongside the seen beats. */
  objectivesBriefed: readonly AdviceObjectiveId[];
  /** The names the player has given the party's pets this run. */
  petNames: SavedPetNames;
  /** The name, body and complexion the player chose for their human crawler. */
  playerIdentity: PlayerIdentity;
  /**
   * The world-held pieces the run carries across floor changes: a hire on a
   * carried contract and the Wayfinder's Anchor's repair. Top level because a
   * floor change carries no `world`.
   */
  carried: NewGameCarry;
  savedAt: string;
}

/** A save as the scene hands it over — the timestamp is stamped on write. */
export type GameProgressInput = Omit<GameProgress, 'savedAt'>;

const HTTP_UNAUTHORIZED = 401;

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Whether a failed request was refused for want of a signed-in session. */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === HTTP_UNAUTHORIZED;
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const rawBody: unknown = await res.json();
  if (!res.ok) {
    const errMsg =
      typeof rawBody === 'object' &&
      rawBody !== null &&
      'error' in rawBody &&
      typeof rawBody.error === 'string'
        ? rawBody.error
        : 'Request failed';
    throw new ApiError(errMsg, res.status);
  }
  return rawBody;
}

function extractUser(raw: unknown): AuthUser {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'id' in raw &&
    typeof raw.id === 'number' &&
    'username' in raw &&
    typeof raw.username === 'string'
  ) {
    return { id: raw.id, username: raw.username };
  }
  throw new ApiError('Invalid user response', HTTP_SERVER_ERROR);
}

export class AuthClient {
  async getMe(): Promise<AuthUser> {
    return extractUser(await apiFetch('/api/auth/me'));
  }

  async login(username: string, password: string): Promise<AuthUser> {
    return extractUser(
      await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }),
    );
  }

  async register(username: string, password: string): Promise<AuthUser> {
    return extractUser(
      await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }),
    );
  }

  async logout(): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  }

  async saveProgress(data: GameProgress): Promise<void> {
    if (PAGE_SAVE_LATCH.engaged) return;
    await apiFetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  }

  async loadProgress(): Promise<GameProgress | null> {
    if (wipeOwed()) return null;
    const raw = await apiFetch('/api/progress');
    if (typeof raw !== 'object' || raw === null || !('data' in raw)) return null;
    const noSaveOnServer = raw.data === null;
    if (noSaveOnServer) return null;
    const progress = parseGameProgress(raw.data);
    if (progress === null)
      console.warn('The save on the server failed validation; starting fresh.');
    return progress;
  }

  async deleteProgress(): Promise<void> {
    await apiFetch('/api/progress', { method: 'DELETE' });
  }

  /** The server row as a save slot for `ProgressPersistence`. */
  asProgressStorage(): ProgressStorage {
    return {
      write: (progress) => this.saveProgress(progress),
      remove: () => this.deleteProgress(),
    };
  }
}
