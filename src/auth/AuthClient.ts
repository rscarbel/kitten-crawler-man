import type { SavedWorld } from '../core/SavedWorld';
import type { PlayerSnapshot } from '../core/PlayerSnapshot';
import type { SerializedAbilityState } from '../core/AbilityManager';
import type { SerializedAchievements } from '../core/AchievementManager';
import type { GameStatsSnapshot } from '../core/GameStats';
import type { PartyCraftsState } from '../core/partyCrafts';
import type {
  OwedWheelItem,
  PendingWheelOutcome,
  WheelCrawler,
  WheelQuestFreeSpins,
} from '../core/WheelLedger';
import type { BloodVomitRemaining } from '../core/bloodVomitSave';
import type { SerializedMusicLibrary } from '../core/MusicLibrary';
import { parseGameProgress } from '../core/saveFormat';
import { PAGE_SAVE_LATCH, type ProgressStorage } from '../core/progressPersistence';
import { wipeOwed } from '../core/wipeMarker';

/** HTTP status code for server error (fallback for API errors). */
const HTTP_SERVER_ERROR = 500;

export interface AuthUser {
  id: number;
  username: string;
}

export interface GameProgress {
  /**
   * The payload's shape, as a semantic version — see `SAVE_FORMAT_VERSION` for
   * what each part promises. Saves written before it existed load as `1.0.0`.
   */
  version: string;
  levelId: string;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  /**
   * Ability levels and XP, which belong to the party rather than to either
   * crawler and so have no home in a `PlayerSnapshot`. Absent on saves written
   * before abilities were persisted at all — those resume at level 1.
   */
  abilityStates?: SerializedAbilityState[];
  /**
   * Whether the Krakaren chest has been opened and Mongo is available at all.
   *
   * Optional, like every field added after the fact: the server stores this
   * payload as one opaque JSON blob, so an older save simply arrives without it
   * and resumes with the pet still locked.
   */
  mongoUnlocked?: boolean;
  /** The pet's HP, which persists across summons and sessions. */
  mongoPetHp?: number;
  /**
   * Whether he is resting off a knockout, which blocks summoning until he is
   * back to full. Stored separately from the HP because it is a latch: the HP
   * alone cannot say whether a half-healed raptor is on his way back up from
   * zero or was simply recalled hurt.
   */
  mongoPetResting?: boolean;
  /**
   * Shared axe/pickaxe tiers and which craft-skill explainers have already
   * played. Party progress rather than either crawler's own — a tool upgrade
   * always applies to both inventories at once. Absent on saves predating
   * craft skills, which resume with no tools granted and every explainer unseen.
   */
  crafts?: PartyCraftsState;
  /**
   * Each crawler's unlocked achievements, unread notices and unopened loot
   * boxes. Absent on saves written before achievements were persisted — those
   * resume with none. Unknown until parsed: the server returns this blob as it
   * was stored, so it is screened by `AchievementManager.fromSerialized`.
   */
  humanAchievements?: SerializedAchievements;
  catAchievements?: SerializedAchievements;
  /**
   * The floor's generation seeds and the safe room to stand back in. Absent on
   * saves that predate it, and dropped on load when the generator has changed;
   * either way the party resumes on a freshly generated floor.
   */
  world?: SavedWorld;
  /**
   * The run's tallies for the Stats tab and the run-complete screen. Kept at
   * the top level rather than inside `world`, because the save a floor change
   * writes carries no `world` and the run's record has to cross floors.
   * Unknown until parsed, like the achievements.
   */
  gameStats?: GameStatsSnapshot;
  /**
   * The wheel's good prizes the party has already won, which it never draws
   * again. Top level because a floor change carries no `world`; cleared only by
   * a wipe.
   */
  wheelPrizesWon?: string[];
  /**
   * A spin committed before its wheel turned and not yet paid out. A load
   * applies it and clears it, so closing the tab mid-spin cannot undo it.
   */
  pendingWheelOutcome?: PendingWheelOutcome | null;
  /** The bet whose board a landed Spin Again still owes a free spin on. */
  wheelFreeSpinBet?: number | null;
  /** The crawler a wheel freeze is still owed to, spent on the next load. */
  wheelOwedFreeze?: WheelCrawler | null;
  /** Prize items held for a crawler outside the bag: read on load, never written. */
  wheelOwedItems?: OwedWheelItem[];
  /** Quest-earned wheel spins and the taped chain one is playing; older saves have none. */
  wheelQuestFreeSpins?: WheelQuestFreeSpins;
  /** Frames of blood vomiting each crawler has left. */
  bloodVomitRemaining?: BloodVomitRemaining;
  /** Whether Carl owns the attack cow. */
  attackCowOwned?: boolean;
  /** The cow's HP; absent while she is at a full health not yet measured. */
  attackCowHp?: number;
  /** Whether the cow is resting off a knockout, which holds her out until she is full. */
  attackCowResting?: boolean;
  /**
   * The songs the run has unlocked and heard. Top level because a floor change
   * carries no `world`. A save written before the library existed loads with
   * one backfilled from its progress.
   */
  musicLibrary?: SerializedMusicLibrary;
  /**
   * The viewers' favour meter, 0–100. Absent until the show's AI first moved
   * it, and on every save written before it existed; either way the run
   * carries on at the starting favour with the meter hidden.
   */
  viewerFavor?: number;
  savedAt: string;
}

/** A save as the scene hands it over — the version and timestamp are stamped on write. */
export type GameProgressInput = Omit<GameProgress, 'version' | 'savedAt'>;

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
    return parseGameProgress(raw.data);
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
