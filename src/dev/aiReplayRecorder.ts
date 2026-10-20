import { PROTOCOL_VERSION } from '@rscarbel/game-server-llm-sdk';
import { AI_SDK_NAME, type AIAdapter } from '../ai/AIAdapter';
import {
  AI_REPLAY_FORMAT,
  AI_REPLAY_VERSION,
  type AIOutboundMessage,
  type AIReplayExpectation,
  type AIReplayFixture,
  type AIReplayMessage,
  type AIReplaySource,
} from '../ai/replay/aiReplayFormat';

export interface AIReplayRecorderOptions {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: AIReplaySource;
  readonly now?: () => number;
}

/**
 * Collects what the AI adapter sends, stamped with the time since the
 * recording started, and turns it into an AI replay fixture. Hand `record`
 * to `AIAdapter.setOutboundListener`.
 */
export class AIReplayRecorder {
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly messages: AIReplayMessage[] = [];

  constructor(private readonly options: AIReplayRecorderOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  get messageCount(): number {
    return this.messages.length;
  }

  /** Index the next recorded message will have, for pointing an expectation at it. */
  get nextIndex(): number {
    return this.messages.length;
  }

  /**
   * A copy is kept, not the message itself: the builder hands out objects
   * it may reuse, and the fixture must hold what was sent at the time.
   */
  readonly record = (message: AIOutboundMessage): void => {
    this.messages.push({ ...structuredClone(message), atMs: this.now() - this.startedAt });
  };

  fixture(expectations: readonly AIReplayExpectation[] = []): AIReplayFixture {
    return {
      format: AI_REPLAY_FORMAT,
      version: AI_REPLAY_VERSION,
      id: this.options.id,
      title: this.options.title,
      description: this.options.description,
      source: this.options.source,
      recordedAt: new Date(this.startedAt).toISOString(),
      startedAtEpochMs: this.startedAt,
      durationMs: this.now() - this.startedAt,
      client: { sdk: AI_SDK_NAME, protocol: PROTOCOL_VERSION },
      messages: this.messages.map((message) => structuredClone(message)),
      expectations: [...expectations],
    };
  }
}

/** Saves the recording; chosen so it reaches no key the game or a browser binds. */
export const AI_REPLAY_EXPORT_KEY = 'F8';
const DEFAULT_REPLAY_ID = 'browser-session';
const JSON_INDENT = 2;

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, JSON_INDENT)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** `?ai-record=Dynamite run!` → `dynamite-run`. */
function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : DEFAULT_REPLAY_ID;
}

/**
 * `?ai-record` (optionally `?ai-record=<name>`): records every message the
 * page sends the AI server from load, and downloads it as an AI replay
 * fixture on each press of F8. Nothing is recorded while the AI is offline,
 * since nothing is sent.
 */
export function startBrowserReplayRecording(adapter: AIAdapter, name: string): void {
  const id = slugOf(name);
  const recorder = new AIReplayRecorder({
    id,
    title: name.length > 0 ? name : 'Browser session',
    description: `Recorded in the browser from ${window.location.href}.`,
    source: 'browser',
  });
  adapter.setOutboundListener(recorder.record);
  console.info(`[ai-record] recording AI traffic; press ${AI_REPLAY_EXPORT_KEY} to download it`);
  window.addEventListener('keydown', (event) => {
    if (event.key !== AI_REPLAY_EXPORT_KEY) return;
    event.preventDefault();
    const fixture = recorder.fixture();
    const stamp = fixture.recordedAt.replace(/[:.]/g, '-');
    downloadJson(`ai-replay-${id}-${stamp}.json`, fixture);
    console.info(`[ai-record] saved ${recorder.messageCount} messages`);
  });
}
