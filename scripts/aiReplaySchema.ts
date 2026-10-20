/**
 * The zod schema of an AI replay fixture (`src/ai/replay/aiReplayFormat.ts`),
 * which the scripted recorder validates every fixture against and turns into
 * the `replay.schema.json` written beside them for the AI server's eval.
 */
import { z } from 'zod';
import { SESSION_FLAG_NAMES } from '../src/ai/context/sessionContext';
import {
  AI_REPLAY_FORMAT,
  AI_REPLAY_VERSION,
  type AIReplayFixture,
} from '../src/ai/replay/aiReplayFormat';

const jsonObject = z.record(z.string(), z.unknown());

const atMs = z
  .number()
  .int()
  .nonnegative()
  .describe('When the message was sent, in ms since the recording started.');

const gameEvent = z.object({
  ts: z.number().describe('Epoch ms as recorded; rebase with startedAtEpochMs.'),
  type: z.string(),
  data: jsonObject,
  summary: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  witnessedBy: z
    .array(z.string())
    .optional()
    .describe('Characters that perceived it; absent means only omniscient characters.'),
});

const flags = z.object(Object.fromEntries(SESSION_FLAG_NAMES.map((name) => [name, z.boolean()])));

const contextSet = z.object({
  atMs,
  type: z.literal('context_set'),
  payload: z.object({
    context: jsonObject,
    flags,
    policyMultiplier: z.number().optional(),
    allowedSeverities: z
      .array(z.enum(['benign', 'disruptive', 'harmful']))
      .readonly()
      .optional(),
  }),
});

const stateSnapshot = z.object({
  atMs,
  type: z.literal('state_snapshot'),
  payload: z
    .object({
      full: jsonObject.optional(),
      patch: jsonObject.optional().describe('RFC 7386 JSON merge patch on the last full state.'),
    })
    .describe('A full state first (and after every reconnect), merge patches after it.'),
});

const eventLog = z.object({
  atMs,
  type: z.literal('event_log'),
  payload: z.object({ events: z.array(gameEvent) }),
});

const playerMessage = z.object({
  atMs,
  type: z.literal('player_message'),
  payload: z.object({
    characterName: z.string(),
    text: z.string(),
    replyTo: z.string().optional(),
  }),
});

const actionResult = z.object({
  atMs,
  type: z.literal('action_result'),
  payload: z.object({ actionId: z.string(), ok: z.boolean(), detail: z.string().optional() }),
  answers: z
    .object({ characterName: z.string(), type: z.string(), params: z.unknown() })
    .optional()
    .describe(
      'The ai_action this result answered. Not sent on the wire; a replay issues fresh action ids.',
    ),
});

const recallExpectation = z.object({
  kind: z.literal('recall'),
  messageIndex: z
    .number()
    .int()
    .nonnegative()
    .describe('Index into messages of the player_message whose reply is checked.'),
  characterName: z.string(),
  mentionsAny: z
    .array(z.string())
    .min(1)
    .describe(
      'The reply passes when it contains any of these as a whole word or phrase (word boundaries at both ends), case-insensitively. None appears in the question.',
    ),
  description: z.string(),
});

export const aiReplayFixtureSchema = z
  .object({
    format: z.literal(AI_REPLAY_FORMAT),
    version: z.literal(AI_REPLAY_VERSION),
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string(),
    description: z.string(),
    source: z.enum(['browser', 'scripted']),
    recordedAt: z.iso.datetime(),
    startedAtEpochMs: z.number().int(),
    durationMs: z.number().int().nonnegative(),
    client: z.object({ sdk: z.string(), protocol: z.number().int() }),
    messages: z.array(
      z.discriminatedUnion('type', [
        contextSet,
        stateSnapshot,
        eventLog,
        playerMessage,
        actionResult,
      ]),
    ),
    expectations: z.array(recallExpectation),
  })
  .describe(
    'Kitten Crawler AI replay fixture: the outbound protocol v2 messages of one play session, in send order.',
  );

/**
 * Compile-time proof that every fixture the game writes is one the schema
 * describes: this stops compiling when the two drift apart.
 */
export function asSchemaInput(fixture: AIReplayFixture): z.input<typeof aiReplayFixtureSchema> {
  return fixture;
}

export function aiReplayJsonSchema(): unknown {
  return z.toJSONSchema(aiReplayFixtureSchema);
}
