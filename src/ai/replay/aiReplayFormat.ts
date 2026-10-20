/**
 * The AI replay fixture: everything the game sent the AI server during one
 * play session, in order, timed from the start of the recording. The AI
 * server's eval harness replays these files against a real model, so this
 * shape is a contract between the two repos; `AI_REPLAY_VERSION` changes
 * whenever a field is renamed, removed or changes meaning.
 *
 * The JSON Schema written beside the fixtures (`replay.schema.json`) is
 * generated from `scripts/aiReplaySchema.ts`, which is checked against these
 * types at compile time.
 */
import type { ContextMessage } from '../context/AIContextBuilder';

export const AI_REPLAY_FORMAT = 'kitten-crawler/ai-replay';
export const AI_REPLAY_VERSION = 1;

/** `player_message` as sent over the socket. */
export interface PlayerMessagePayload {
  characterName: string;
  text: string;
  /** The id of the reply button the player tapped, when the text is that button's label. */
  replyTo?: string;
}

/** `action_result` as sent over the socket. */
export interface ActionResultPayload {
  actionId: string;
  ok: boolean;
  detail?: string;
}

/**
 * The server's `ai_action` an `action_result` answers. Not part of the wire
 * message: a replay issues fresh action ids, so this is how it tells which
 * tool call a recorded result was about.
 */
export interface AnsweredAction {
  characterName: string;
  type: string;
  params: unknown;
}

/** One message the game sends the AI server, in the shape of protocol v2. */
export type AIOutboundMessage =
  | ContextMessage
  | { type: 'player_message'; payload: PlayerMessagePayload }
  | { type: 'action_result'; payload: ActionResultPayload; answers?: AnsweredAction };

export type AIOutboundMessageType = AIOutboundMessage['type'];

/** An outbound message stamped with when it was sent, in ms since the recording started. */
export type AIReplayMessage = AIOutboundMessage & { atMs: number };

/**
 * A check the eval makes on the reply to one recorded `player_message`: the
 * character's answer should bring up something that happened earlier in the
 * session.
 */
export interface AIReplayRecallExpectation {
  kind: 'recall';
  /** Index into `messages` of the `player_message` whose reply is checked. */
  messageIndex: number;
  characterName: string;
  /**
   * The reply passes when it contains any of these as a whole word or phrase
   * (word boundaries at both ends: `rat` never matches `congratulations`),
   * case-insensitively. None of them appears in the question itself, so a
   * reply that only echoes the question never passes.
   */
  mentionsAny: string[];
  description: string;
}

export type AIReplayExpectation = AIReplayRecallExpectation;

/** Where a fixture came from: a browser session or the scripted headless run. */
export type AIReplaySource = 'browser' | 'scripted';

export interface AIReplayFixture {
  format: typeof AI_REPLAY_FORMAT;
  version: typeof AI_REPLAY_VERSION;
  /** File-name-safe slug, e.g. `dynamite-incident`. */
  id: string;
  title: string;
  description: string;
  source: AIReplaySource;
  /** ISO 8601. */
  recordedAt: string;
  /**
   * Epoch ms at `atMs` 0. Event `ts` values are epoch ms as recorded, so a
   * replayer rebases them by `ts - startedAtEpochMs + <its own start>`.
   */
  startedAtEpochMs: number;
  durationMs: number;
  /** What the game announced in `hello`. */
  client: { sdk: string; protocol: number };
  messages: AIReplayMessage[];
  expectations: AIReplayExpectation[];
}
