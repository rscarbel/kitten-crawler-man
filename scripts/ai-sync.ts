#!/usr/bin/env tsx
/**
 * Pushes the game's AI setup to the AI server, once per deploy rather than on
 * every page load: the characters, the tools generated from the action
 * registry, the world bible as the app's lore, and the event importance hints.
 *
 * Authenticates as a service account (client credentials) from `.env`:
 *   AI_SERVER_URL          the AI server (default http://localhost:3001)
 *   AI_APP_ID              the app the service account belongs to
 *   AI_SYNC_CLIENT_ID      the service account id
 *   AI_SYNC_CLIENT_SECRET  its secret
 *
 * The service account needs `characters:write` and `tools:write`, and
 * `lore:write` for the lore and importance hints. Each upload is one step in
 * `SYNC_STEPS`. An optional step whose endpoint the server does not have (it
 * answers 404), or whose scope the service account was not granted, is
 * skipped with a note, so the script works against servers older than the
 * endpoint.
 *
 *   npm run ai:sync
 *   npm run ai:sync -- --dry-run     print what would be sent, send nothing
 *   npm run ai:sync -- --snapshot=<file>
 *                                    write everything that would be sent to one
 *                                    JSON file (the AI server's bench fixture),
 *                                    send nothing
 */

import { writeFileSync } from 'fs';
import * as prettier from 'prettier';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { generateAIToolDefinitions } from '../src/ai/actions/registry';
import { AI_CHARACTERS, renderCharacterCore, renderCharacterPrompt } from '../src/ai/characters';
import type { AICharacterDefinition } from '../src/ai/characters';
import { EVENT_IMPORTANCE } from '../src/ai/context/eventImportance';
import { WORLD_BIBLE, WORLD_BIBLE_TITLE } from '../src/ai/context/worldBible';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const DEFAULT_AI_SERVER_URL = 'http://localhost:3001';
/** Without these nothing can be synced, so their absence fails the run. */
const REQUIRED_SCOPES = ['characters:write', 'tools:write'] as const;
/** The lore document and the importance hints. */
const LORE_SCOPE = 'lore:write';
const DRY_RUN = process.argv.includes('--dry-run');
const SNAPSHOT_FLAG = '--snapshot=';
const SNAPSHOT_PATH =
  process.argv.find((arg) => arg.startsWith(SNAPSHOT_FLAG))?.slice(SNAPSHOT_FLAG.length) ?? null;
/** A server error page is cut to this much in the failure message. */
const MAX_ERROR_CHARS = 300;

/** The endpoints that may not exist on every server. */
const LORE_PATH = '/v1/apps/{appId}/lore';
const EVENT_HINTS_PATH = '/v1/apps/{appId}/event-importance';

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const ToolsResponseSchema = z.object({ tools: z.array(z.object({ name: z.string() })) });

const ErrorBodySchema = z.object({ error: z.string() });

interface SyncConfig {
  readonly serverUrl: string;
  readonly appId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

interface SyncContext {
  readonly config: SyncConfig;
  readonly token: string;
  /** What the service account's token was granted, e.g. `lore:write` or `lore:*`. */
  readonly scopes: readonly string[];
}

interface SyncStep {
  readonly name: string;
  /** Returns a one-line summary of what was synced, or of why it was skipped. */
  run(ctx: SyncContext): Promise<string>;
}

class SyncError extends Error {
  /** The HTTP status that caused it, when a request did. */
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const HTTP_NOT_FOUND = 404;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new SyncError(
      `${name} is not set. Add it to .env (see .env.example and the README's "Syncing the AI setup").`,
    );
  }
  return value.trim();
}

function readConfig(): SyncConfig {
  return {
    serverUrl: (process.env.AI_SERVER_URL ?? DEFAULT_AI_SERVER_URL).replace(/\/+$/, ''),
    appId: requiredEnv('AI_APP_ID'),
    clientId: requiredEnv('AI_SYNC_CLIENT_ID'),
    clientSecret: requiredEnv('AI_SYNC_CLIENT_SECRET'),
  };
}

async function errorText(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data.error;
  } catch {
    // Not JSON: report the raw body.
  }
  return raw.slice(0, MAX_ERROR_CHARS);
}

interface IssuedToken {
  readonly token: string;
  readonly scopes: readonly string[];
}

/** Whether `granted` (which may hold wildcards such as `lore:*` or `*`) covers `required`. */
function scopeGranted(granted: readonly string[], required: string): boolean {
  const resource = required.split(':')[0];
  return granted.some((scope) => scope === '*' || scope === required || scope === `${resource}:*`);
}

/** Asks for the service account's own scopes rather than naming them, so a missing optional one skips its step instead of refusing the token. */
async function requestToken(config: SyncConfig): Promise<IssuedToken> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`${config.serverUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  if (!response.ok) {
    throw new SyncError(
      `Token request failed (${response.status.toString()}): ${await errorText(response)}`,
    );
  }
  const parsed = TokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new SyncError('The token response was not an OAuth token');
  const scopes = (parsed.data.scope ?? '').split(' ').filter((scope) => scope !== '');
  const missing = REQUIRED_SCOPES.filter((scope) => !scopeGranted(scopes, scope));
  if (missing.length > 0) {
    throw new SyncError(`The service account lacks ${missing.join(' and ')}; grant it and retry`);
  }
  return { token: parsed.data.access_token, scopes };
}

async function send(
  ctx: SyncContext,
  method: 'POST' | 'PUT',
  route: string,
  body: unknown,
): Promise<unknown> {
  if (DRY_RUN) {
    console.log(`  ${method} ${route}\n${JSON.stringify(body, null, 2)}`);
    return null;
  }
  const response = await fetch(`${ctx.config.serverUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new SyncError(
      `${method} ${route} failed (${response.status.toString()}): ${await errorText(response)}`,
      response.status,
    );
  }
  return response.json();
}

/**
 * A character exactly as `PUT /api/characters/:name` keeps it. The server
 * strips unknown keys and, when `personality` is present, takes its identity
 * from `personality.core` and ignores `prompt`; so the role and the acting
 * rules' notes are folded into that core (`renderCharacterCore`), and only the
 * context flags of `actingConstraints` are sent. `prompt` is the same identity
 * flattened with voice, temperament and goals, for consumers of the snapshot
 * that read one block of text. `enabled` is the game's own switch and is not
 * sent: a disabled character is still registered, just never connected.
 */
function characterBody(character: AICharacterDefinition) {
  const { personality, actingConstraints } = character;
  return {
    prompt: renderCharacterPrompt(character),
    receiveLogStream: character.receiveLogStream,
    evolvePersonality: true,
    knowledgeScope: character.knowledgeScope,
    personality: { ...personality, core: renderCharacterCore(character) },
    allowedTools: character.allowedTools,
    actingConstraints: {
      requiresContext: actingConstraints.requiresContext,
      forbidsContext: actingConstraints.forbidsContext,
    },
  };
}

/** Runs an optional upload; a missing scope or a server without the endpoint (404) skips it with a note. */
async function optionalStep(
  ctx: SyncContext,
  pathTemplate: string,
  scope: string,
  what: string,
  upload: (route: string) => Promise<string>,
): Promise<string> {
  const route = pathTemplate.replace('{appId}', encodeURIComponent(ctx.config.appId));
  if (!DRY_RUN && !scopeGranted(ctx.scopes, scope)) {
    return `skipped: the service account lacks ${scope}, which ${what} needs`;
  }
  try {
    return await upload(route);
  } catch (error: unknown) {
    if (error instanceof SyncError && error.status === HTTP_NOT_FOUND) {
      return `skipped: this server has no ${route} for ${what}`;
    }
    throw error;
  }
}

const SYNC_STEPS: readonly SyncStep[] = [
  {
    name: 'tools',
    run: async (ctx) => {
      const tools = generateAIToolDefinitions();
      const result = await send(ctx, 'POST', '/api/tools', tools);
      if (result === null) return `${tools.length.toString()} tools (dry run)`;
      const parsed = ToolsResponseSchema.safeParse(result);
      if (!parsed.success) throw new SyncError('The tools response was not a tool list');
      return `${tools.length.toString()} tools sent; the app now has ${parsed.data.tools.length.toString()}`;
    },
  },
  {
    name: 'characters',
    run: async (ctx) => {
      for (const character of AI_CHARACTERS) {
        const route = `/api/characters/${encodeURIComponent(character.name)}`;
        await send(ctx, 'PUT', route, characterBody(character));
      }
      return AI_CHARACTERS.map((character) => character.name).join(', ');
    },
  },
  {
    name: 'lore',
    run: (ctx) =>
      optionalStep(ctx, LORE_PATH, LORE_SCOPE, 'the lore document', async (route) => {
        await send(ctx, 'PUT', route, { markdown: WORLD_BIBLE });
        return `"${WORLD_BIBLE_TITLE}" (${WORLD_BIBLE.length.toString()} characters)`;
      }),
  },
  {
    name: 'event importance hints',
    run: (ctx) =>
      optionalStep(ctx, EVENT_HINTS_PATH, LORE_SCOPE, 'event importance hints', async (route) => {
        await send(ctx, 'PUT', route, { hints: EVENT_IMPORTANCE });
        return `${Object.keys(EVENT_IMPORTANCE).length.toString()} event types`;
      }),
  },
];

/**
 * Everything a sync sends, in one document, for consumers that replay it
 * offline. Formatted the way the repo it lands in formats JSON, so that
 * repo's format check stays clean after a regeneration.
 */
async function writeSnapshot(file: string): Promise<void> {
  const snapshot = {
    source:
      'kitten-crawler-world `npm run ai:sync -- --snapshot` (tools, characters, lore, event importance hints)',
    tools: generateAIToolDefinitions(),
    characters: Object.fromEntries(
      AI_CHARACTERS.map((character) => [character.name, characterBody(character)]),
    ),
    lore: WORLD_BIBLE,
    eventImportance: EVENT_IMPORTANCE,
  };
  const target = path.resolve(process.cwd(), file);
  const config = (await prettier.resolveConfig(target)) ?? {};
  const text = await prettier.format(JSON.stringify(snapshot), { ...config, filepath: target });
  writeFileSync(target, text);
  console.log(`Wrote the sync snapshot to ${target}`);
}

async function main(): Promise<void> {
  if (SNAPSHOT_PATH !== null) {
    await writeSnapshot(SNAPSHOT_PATH);
    return;
  }
  const config = readConfig();
  const issued: IssuedToken = DRY_RUN ? { token: '', scopes: [] } : await requestToken(config);
  const ctx: SyncContext = { config, token: issued.token, scopes: issued.scopes };
  console.log(`Syncing app ${config.appId} on ${config.serverUrl}${DRY_RUN ? ' (dry run)' : ''}`);
  for (const step of SYNC_STEPS) {
    const summary = await step.run(ctx);
    console.log(`✓ ${step.name}: ${summary}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ ai:sync failed: ${message}`);
  if (!(error instanceof SyncError)) console.error(error);
  process.exit(1);
});
