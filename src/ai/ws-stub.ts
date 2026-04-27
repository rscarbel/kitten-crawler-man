// Browser stub for the Node.js 'ws' package.
// The SDK bundles a WebSocket client that imports from 'ws', which is Node-only.
// We never instantiate GameServerWebSocket (we use the browser's native WebSocket directly),
// so this stub exists only to satisfy the bundler's import resolution.
export default class WebSocketStub {
  readonly readyState = 3; // CLOSED

  on(_event: string, _handler: (...args: unknown[]) => void): this {
    return this;
  }

  send(_data: string): void {
    void 0;
  }

  close(): void {
    void 0;
  }
}
