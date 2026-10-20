import type { GameAiClient } from '@rscarbel/game-server-llm-sdk';
import type { ContextMessage } from './AIContextBuilder';
import { applyMergePatch, isJsonObject, type JsonObject } from './json';

/** Where the builder's messages go. */
export interface ContextTransport {
  /** Everything one builder tick produced, in order. */
  send(messages: readonly ContextMessage[]): void;
  /** The connection was (re)established and holds nothing yet. */
  reset(): void;
}

/** The part of the SDK client the context needs. */
export type ContextClient = Pick<GameAiClient, 'setContext' | 'updateState' | 'sendEvents'>;

/**
 * Sends the builder's messages through the SDK client. Context and events
 * pass through as they are. The client computes its own merge patches from
 * whole states (and re-sends the whole state after a reconnect), so the
 * builder's patches are applied to a local mirror and the client is handed
 * the mirror.
 */
export class SdkContextTransport implements ContextTransport {
  private state: JsonObject | null = null;

  constructor(private readonly client: ContextClient) {}

  reset(): void {
    this.state = null;
  }

  send(messages: readonly ContextMessage[]): void {
    for (const message of messages) {
      switch (message.type) {
        case 'context_set':
          this.client.setContext(message.payload);
          break;
        case 'state_snapshot':
          this.applySnapshot(message.payload.full, message.payload.patch);
          break;
        case 'event_log':
          this.client.sendEvents(message.payload.events);
          break;
      }
    }
  }

  private applySnapshot(full: JsonObject | undefined, patch: JsonObject | undefined): void {
    if (full !== undefined) this.state = full;
    if (patch !== undefined && this.state !== null) {
      const patched = applyMergePatch(this.state, patch);
      if (isJsonObject(patched)) this.state = patched;
    }
    // A patch before any full state has nothing to apply to; the builder sends a full state after every reset.
    if (this.state !== null) this.client.updateState(this.state);
  }
}
