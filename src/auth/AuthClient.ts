import type { PlayerSnapshot } from '../core/PlayerSnapshot';
import type { SerializedAbilityState } from '../core/AbilityManager';

/** HTTP status code for server error (fallback for API errors). */
const HTTP_SERVER_ERROR = 500;

export interface AuthUser {
  id: number;
  username: string;
}

export interface GameProgress {
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
  savedAt: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
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
    await apiFetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  }

  async loadProgress(): Promise<GameProgress | null> {
    const raw = await apiFetch('/api/progress');
    if (typeof raw !== 'object' || raw === null || !('data' in raw)) return null;
    if (raw.data === null) return null;
    // Trusted API contract — full nested PlayerSnapshot validation is disproportionate
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return raw.data as GameProgress;
  }

  async deleteProgress(): Promise<void> {
    await apiFetch('/api/progress', { method: 'DELETE' });
  }
}
