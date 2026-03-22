/**
 * DungeonInputHandler — owns keyboard event listener lifecycle
 * for the dungeon scene. Translates raw key events into action
 * callbacks provided by the scene, keeping input wiring separate
 * from game logic.
 */

/** Action callbacks the scene provides to the input handler. */
export interface DungeonInputActions {
  /** Whether input should be suppressed (pause, sleeping, etc.). */
  isSuppressed(): boolean;
  /** Whether the game is over. */
  isGameOver(): boolean;

  // Escape-level actions
  dismissDialog(): boolean;
  dismissStairwell(): boolean;
  dismissBuilding(): boolean;
  togglePause(): void;
  clearInput(): void;

  // Action key handlers
  switchCharacter(): void;
  spaceAction(): void;
  usePotion(): void;
  toggleInventory(): void;
  toggleGear(): void;
  companionFollow(): void;
  toggleMiniMap(): void;
  mongoSummon(): void;
  hotbarActivation(idx: number): void;

  // Key-up handlers
  dynamiteRelease(idx: number): boolean;
}

export class DungeonInputHandler {
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Bind keyboard listeners. Call from scene.onEnter(). */
  bind(actions: DungeonInputActions): void {
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (actions.dismissDialog()) return;
      if (actions.dismissStairwell()) return;
      if (actions.dismissBuilding()) return;
      if (!actions.isGameOver()) {
        actions.togglePause();
      }
    };

    this.actionHandler = (e: KeyboardEvent) => {
      if (actions.isSuppressed()) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        actions.switchCharacter();
        return;
      }

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        actions.spaceAction();
        return;
      }

      if ((e.key === 'q' || e.key === 'Q') && !e.repeat) {
        e.preventDefault();
        actions.usePotion();
        return;
      }

      if ((e.key === 'i' || e.key === 'I') && !e.repeat) {
        e.preventDefault();
        actions.toggleInventory();
        return;
      }

      if ((e.key === 'g' || e.key === 'G') && !e.repeat) {
        e.preventDefault();
        actions.toggleGear();
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        e.preventDefault();
        actions.companionFollow();
        return;
      }

      if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        e.preventDefault();
        actions.toggleMiniMap();
        return;
      }

      if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
        e.preventDefault();
        actions.mongoSummon();
        return;
      }

      const hotbarIdx = parseInt(e.key) - 1;
      if (!e.repeat && hotbarIdx >= 0 && hotbarIdx < 8) {
        e.preventDefault();
        actions.hotbarActivation(hotbarIdx);
        return;
      }
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      if (actions.isSuppressed() || actions.isGameOver()) return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < 8) {
        actions.dynamiteRelease(idx);
      }
    };

    window.addEventListener('keydown', this.escHandler);
    window.addEventListener('keydown', this.actionHandler);
    window.addEventListener('keyup', this.keyupHandler);
  }

  /** Remove keyboard listeners. Call from scene.onExit(). */
  unbind(): void {
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    if (this.actionHandler) window.removeEventListener('keydown', this.actionHandler);
    if (this.keyupHandler) window.removeEventListener('keyup', this.keyupHandler);
    this.escHandler = null;
    this.actionHandler = null;
    this.keyupHandler = null;
  }
}
