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
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError((body.error as string | undefined) ?? 'Request failed', res.status);
  return body;
}

export class AuthClient {
  async getMe(): Promise<AuthUser> {
    return apiFetch('/api/auth/me') as Promise<AuthUser>;
  }

  async login(username: string, password: string): Promise<AuthUser> {
    return apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }) as Promise<AuthUser>;
  }

  async register(username: string, password: string): Promise<AuthUser> {
    return apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }) as Promise<AuthUser>;
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
    const body = (await apiFetch('/api/progress')) as { data: GameProgress | null };
    return body.data;
  }
}
