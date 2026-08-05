/**
 * DungeonInputHandler — owns keyboard event listener lifecycle
 * for the dungeon scene. Translates raw key events into action
 * callbacks provided by the scene, keeping input wiring separate
 * from game logic.
 *
 * Which key means which action is `Keybindings`' business, so a player who
 * rebinds a key in the Controls screen changes this dispatch without any code
 * here knowing what a letter is. Escape is the exception: it is reserved, is
 * never routed through the table, and drives the dismiss chain directly.
 */

import { keybindings, HOTBAR_ACTIONS, type GameAction } from '../core/Keybindings';

/** Action callbacks the scene provides to the input handler. */
export interface DungeonInputActions {
  /** Whether input should be suppressed (pause, sleeping, etc.). */
  isSuppressed(): boolean;
  /** Whether the game is over. */
  isGameOver(): boolean;

  // Escape-level actions
  dismissChestDialog(): boolean;
  dismissDialog(): boolean;
  dismissStairwell(): boolean;
  dismissBuilding(): boolean;
  dismissFollowerMenu(): boolean;
  togglePause(): void;
  clearInput(): void;

  // Action key handlers
  /** Called when Space is pressed while a suppressible dialog is open. Returns true if consumed. */
  advanceDialog(): boolean;
  switchCharacter(): void;
  spaceAction(): void;
  usePotion(): void;
  toggleInventory(): void;
  toggleGear(): void;
  companionFollow(): void;
  toggleMiniMap(): void;
  mongoSummon(): void;
  buildAction(): void;
  hotbarActivation(idx: number): void;

  // Chat
  openChat(): void;

  // Key-up handlers
  dynamiteRelease(idx: number): boolean;
}

/**
 * Walking is polled from the held-key set every frame rather than driven by
 * keydown, so these actions have nothing to do in an event handler — and must
 * not be swallowed here, or an arrow key would be consumed on the way to it.
 */
const MOVEMENT_ACTIONS: ReadonlySet<GameAction> = new Set([
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
]);

/**
 * Actions whose entire keydown behaviour is calling scene callbacks. Movement,
 * the hotbar and the switch key are each handled ahead of this table because
 * they carry their own repeat or index rules.
 */
const SIMPLE_ACTION_HANDLERS: Partial<Record<GameAction, (actions: DungeonInputActions) => void>> =
  {
    openChat: (actions) => actions.openChat(),
    attack: (actions) => actions.spaceAction(),
    usePotion: (actions) => actions.usePotion(),
    toggleInventory: (actions) => actions.toggleInventory(),
    toggleGear: (actions) => actions.toggleGear(),
    companionFollow: (actions) => actions.companionFollow(),
    toggleMiniMap: (actions) => actions.toggleMiniMap(),
    buildSummon: (actions) => {
      actions.buildAction();
      actions.mongoSummon();
    },
  };

/** The hotbar slot an action drives, or null when the action is not a hotbar key. */
function hotbarIndexFor(action: GameAction): number | null {
  const index = HOTBAR_ACTIONS.findIndex((hotbarAction) => hotbarAction === action);
  return index === -1 ? null : index;
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
      if (actions.dismissChestDialog()) return;
      if (actions.dismissDialog()) return;
      if (actions.dismissStairwell()) return;
      if (actions.dismissBuilding()) return;
      if (actions.dismissFollowerMenu()) return;
      if (!actions.isGameOver()) {
        actions.togglePause();
      }
    };

    this.actionHandler = (e: KeyboardEvent) => {
      if (!e.repeat && actions.dismissChestDialog()) return;
      const action = keybindings.actionFor(e.key);
      // Ahead of the suppression gate on purpose: a dialog raised over the world
      // suppresses gameplay, and advancing it is the one thing the attack key
      // must still do while that is true.
      if (action === 'attack' && !e.repeat && actions.advanceDialog()) {
        e.preventDefault();
        return;
      }
      if (actions.isSuppressed()) return;
      if (action === null || MOVEMENT_ACTIONS.has(action)) return;

      // The only action that repeats: holding Switch cycles crawlers.
      if (action === 'switchCharacter') {
        e.preventDefault();
        actions.switchCharacter();
        return;
      }
      if (e.repeat) return;

      const hotbarIdx = hotbarIndexFor(action);
      if (hotbarIdx !== null) {
        e.preventDefault();
        actions.hotbarActivation(hotbarIdx);
        return;
      }

      const handler = SIMPLE_ACTION_HANDLERS[action];
      if (handler === undefined) return;
      e.preventDefault();
      handler(actions);
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      if (actions.isSuppressed() || actions.isGameOver()) return;
      const action = keybindings.actionFor(e.key);
      if (action === null) return;
      const idx = hotbarIndexFor(action);
      if (idx !== null) actions.dynamiteRelease(idx);
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
