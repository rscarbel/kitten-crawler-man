/**
 * GameplayInputHandler — owns the keyboard event listener lifecycle for any
 * scene the player fights and walks in. Translates raw key events into action
 * callbacks the scene provides, keeping input wiring separate from game logic.
 *
 * Scene-agnostic by construction: it imports nothing but `Keybindings`, and
 * every behaviour reaches it through {@link GameplayInputActions}. That is what
 * lets the dungeon and a building interior mean the same thing by `i`, `g`, `q`,
 * Space, Tab and 1-8 without either of them owning the other's key table.
 *
 * Which key means which action is `Keybindings`' business, so a player who
 * rebinds a key in the Controls screen changes this dispatch without any code
 * here knowing what a letter is. Escape is the exception: it is reserved, is
 * never routed through the table, and drives the dismiss chain directly.
 */

import { keybindings, HOTBAR_ACTIONS, type GameAction } from '../core/Keybindings';

/** Action callbacks the scene provides to the input handler. */
export interface GameplayInputActions {
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

  // Action key handlers
  /** Called when Space is pressed while a suppressible dialog is open. Returns true if consumed. */
  advanceDialog(): boolean;
  /**
   * The five below are optional because a scene that cannot honour one leaves it
   * out rather than binding a handler that does nothing: there is no pet, no
   * quest journal and no barrier-building indoors, and a building interior polls
   * Space and Tab from the held-key set instead, where its interaction chain can
   * order them against movement. The key is still swallowed either way, so an
   * unbound action can never leak through to the page.
   */
  switchCharacter?(): void;
  spaceAction?(): void;
  toggleQuestTracker?(): void;
  mongoSummon?(): void;
  buildAction?(): void;
  usePotion(): void;
  toggleInventory(): void;
  toggleGear(): void;
  companionFollow(): void;
  toggleMiniMap(): void;
  hotbarActivation(idx: number): void;

  // Chat
  openChat(): void;

  // Key-up handlers
  dynamiteRelease(idx: number): boolean;
  /**
   * A new interact press began, or the last one ended. Both are reported from
   * the key events rather than from the held-key set, which a scene cannot tell
   * apart from its own `input.clear()`.
   *
   * A scene needs both: the release is the ordinary re-arm, and the fresh press
   * is what stops a keyup the browser dropped — a window blurred mid-hold —
   * swallowing the press after it.
   */
  interactPressStarted?(): void;
  interactReleased?(): void;
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
const SIMPLE_ACTION_HANDLERS: Partial<Record<GameAction, (actions: GameplayInputActions) => void>> =
  {
    openChat: (actions) => actions.openChat(),
    attack: (actions) => actions.spaceAction?.(),
    usePotion: (actions) => actions.usePotion(),
    toggleInventory: (actions) => actions.toggleInventory(),
    toggleGear: (actions) => actions.toggleGear(),
    toggleMiniMap: (actions) => actions.toggleMiniMap(),
    toggleQuestTracker: (actions) => actions.toggleQuestTracker?.(),
    buildSummon: (actions) => {
      actions.buildAction?.();
      actions.mongoSummon?.();
    },
  };

/** The hotbar slot an action drives, or null when the action is not a hotbar key. */
function hotbarIndexFor(action: GameAction): number | null {
  const index = HOTBAR_ACTIONS.findIndex((hotbarAction) => hotbarAction === action);
  return index === -1 ? null : index;
}

export class GameplayInputHandler {
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Bind keyboard listeners. Call from scene.onEnter(). */
  bind(actions: GameplayInputActions): void {
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
      // Before the advance below, which is what spends the press: a scene that
      // edge-triggers off this has to see the press start before it can be told
      // the press is gone.
      if (action === 'attack' && !e.repeat) actions.interactPressStarted?.();
      // Ahead of the suppression gate on purpose: a dialog raised over the world
      // suppresses gameplay, and advancing it is the one thing the attack key
      // must still do while that is true.
      if (action === 'attack' && !e.repeat && actions.advanceDialog()) {
        e.preventDefault();
        return;
      }
      if (action === null || MOVEMENT_ACTIONS.has(action)) return;

      // Ahead of the suppression gate, and swallowed either way: letting Tab
      // through moves DOM focus off the canvas, and a menu being open is exactly
      // when the player is most likely to press it. The only action that
      // repeats, too — holding Switch cycles crawlers.
      if (action === 'switchCharacter') {
        e.preventDefault();
        if (!actions.isSuppressed()) actions.switchCharacter?.();
        return;
      }

      // Also ahead of the gate, for the same reason Escape is: the follower menu
      // suppresses the keyboard while it is open, so the key that opened it
      // would otherwise be the one key that cannot close it again.
      if (action === 'companionFollow' && !e.repeat) {
        e.preventDefault();
        if (actions.dismissFollowerMenu()) return;
        if (!actions.isSuppressed()) actions.companionFollow();
        return;
      }

      if (actions.isSuppressed()) return;
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
      const action = keybindings.actionFor(e.key);
      if (action === null) return;
      // Reported before the gates below: a key released while a menu is up is
      // still a key that came up, and a scene edge-triggering off it would
      // otherwise stay armed from before the menu opened.
      if (action === 'attack') actions.interactReleased?.();
      if (actions.isSuppressed() || actions.isGameOver()) return;
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
