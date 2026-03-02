/**
 * Owns raw keyboard state. Only tracks which keys are pressed — game-specific
 * action bindings live in each Scene's onEnter/onExit.
 */
export class InputManager {
  private keys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.key));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  /** Returns true if the given key is currently held down. */
  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** Clears all key state — call when pausing/resuming to avoid sticky keys. */
  clear(): void {
    this.keys.clear();
  }
}
