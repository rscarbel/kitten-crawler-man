import { normalizeKey } from './Keybindings';

/**
 * Owns raw keyboard state. Only tracks which keys are pressed — which action a
 * key means is `Keybindings`' business, and which of those a scene listens for
 * is the scene's.
 *
 * Keys are stored normalized, so a crawler who holds Shift mid-walk keeps
 * walking instead of stopping on the `'W'` the browser reports.
 */
export class InputManager {
  private keys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(normalizeKey(e.key)));
    window.addEventListener('keyup', (e) => this.keys.delete(normalizeKey(e.key)));
  }

  /** Returns true if the given key is currently held down. */
  has(key: string): boolean {
    return this.keys.has(normalizeKey(key));
  }

  /** Clears all key state — call when pausing/resuming to avoid sticky keys. */
  clear(): void {
    this.keys.clear();
  }
}
