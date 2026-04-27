import type { PlayerSnapshot } from '../core/PlayerSnapshot';

export interface AuthUser {
  id: number;
  username: string;
}

export interface GameProgress {
  levelId: string;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
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
  throw new ApiError('Invalid user response', 500);
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
}
