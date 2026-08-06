/**
 * The game's action → key binding table.
 *
 * Every keyboard consumer asks this module what an action is bound to rather
 * than comparing against a literal, which is what makes the Controls screen
 * able to both *show* the keymap and *change* it. Overrides are persisted
 * through `settings`, so they are device-local — the right scope for a
 * keyboard layout, which belongs to a machine rather than to an account.
 */

import type { InputManager } from './InputManager';
import { settings } from './Settings';

/** Every rebindable thing a player can do with the keyboard. */
export type GameAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'attack'
  | 'switchCharacter'
  | 'usePotion'
  | 'toggleInventory'
  | 'toggleGear'
  | 'companionFollow'
  | 'toggleMiniMap'
  | 'toggleQuestTracker'
  | 'buildSummon'
  | 'openChat'
  | 'hotbar1'
  | 'hotbar2'
  | 'hotbar3'
  | 'hotbar4'
  | 'hotbar5'
  | 'hotbar6'
  | 'hotbar7'
  | 'hotbar8';

/** How many keys one action may carry. Movement ships with two out of the box. */
export const MAX_KEYS_PER_ACTION = 2;

/** Hotbar actions in slot order, so a lookup can recover the slot index. */
export const HOTBAR_ACTIONS = [
  'hotbar1',
  'hotbar2',
  'hotbar3',
  'hotbar4',
  'hotbar5',
  'hotbar6',
  'hotbar7',
  'hotbar8',
] as const satisfies ReadonlyArray<GameAction>;

const SPACE_KEY = ' ';

/**
 * Reproduces the literals every consumer used before this table existed, so
 * installing the binding layer changed no defaults.
 */
const DEFAULT_BINDINGS: Record<GameAction, readonly string[]> = {
  moveUp: ['w', 'ArrowUp'],
  moveDown: ['s', 'ArrowDown'],
  moveLeft: ['a', 'ArrowLeft'],
  moveRight: ['d', 'ArrowRight'],
  attack: [SPACE_KEY],
  switchCharacter: ['Tab'],
  usePotion: ['q'],
  toggleInventory: ['i'],
  toggleGear: ['g'],
  companionFollow: ['f'],
  toggleMiniMap: ['m'],
  toggleQuestTracker: ['j'],
  buildSummon: ['r'],
  openChat: ['Enter'],
  hotbar1: ['1'],
  hotbar2: ['2'],
  hotbar3: ['3'],
  hotbar4: ['4'],
  hotbar5: ['5'],
  hotbar6: ['6'],
  hotbar7: ['7'],
  hotbar8: ['8'],
};

/**
 * Display order for the Controls screen. Explicit rather than derived from the
 * defaults table so movement can lead and the hotbar can trail.
 */
export const ACTION_ORDER: readonly GameAction[] = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'attack',
  'switchCharacter',
  'usePotion',
  'toggleInventory',
  'toggleGear',
  'companionFollow',
  'toggleMiniMap',
  'toggleQuestTracker',
  'buildSummon',
  'openChat',
  ...HOTBAR_ACTIONS,
];

/** Human-readable names, used by the Controls screen and by HUD hint lines. */
export const ACTION_LABELS: Record<GameAction, string> = {
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  attack: 'Attack / Interact',
  switchCharacter: 'Switch Crawler',
  usePotion: 'Drink Potion',
  toggleInventory: 'Inventory',
  toggleGear: 'Gear',
  companionFollow: 'Follower Orders',
  toggleMiniMap: 'Mini-Map',
  toggleQuestTracker: 'Quest Journal',
  buildSummon: 'Build / Summon Pet',
  openChat: 'Open Chat',
  hotbar1: 'Hotbar Slot 1',
  hotbar2: 'Hotbar Slot 2',
  hotbar3: 'Hotbar Slot 3',
  hotbar4: 'Hotbar Slot 4',
  hotbar5: 'Hotbar Slot 5',
  hotbar6: 'Hotbar Slot 6',
  hotbar7: 'Hotbar Slot 7',
  hotbar8: 'Hotbar Slot 8',
};

/**
 * Escape is the universal dismiss chain in both scenes and the cancel gesture
 * during rebind capture. Letting a player bind it away would leave them with no
 * way out of the very screen they bound it from.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape']);

/** Pressing one of these alone is a modifier, not a binding. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Dead',
]);

const SINGLE_CHARACTER_KEY_LENGTH = 1;

/**
 * Collapses the browser's shift/caps variants onto one canonical key string.
 * Without this, holding Shift while walking reports `'W'` and stops the player,
 * and every action key has to hand-pair its two cases.
 */
export function normalizeKey(key: string): string {
  if (key.length === SINGLE_CHARACTER_KEY_LENGTH) return key.toLowerCase();
  return key;
}

/** Whether a key may be assigned to an action at all. */
export function isBindableKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized === '') return false;
  if (RESERVED_KEYS.has(normalized)) return false;
  if (MODIFIER_KEYS.has(normalized)) return false;
  return true;
}

/** Keys whose raw value is unreadable on a chip; everything else is uppercased. */
const KEY_DISPLAY_LABELS: Record<string, string> = {
  [SPACE_KEY]: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Bksp',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** Shown on a chip whose slot carries no key. */
export const UNBOUND_KEY_LABEL = '—';

/** Shown in a hint line for an action nobody can trigger any more. */
export const UNBOUND_ACTION_LABEL = 'Unbound';

function isGameAction(value: string): value is GameAction {
  return Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS, value);
}

/**
 * Turns the loosely-typed stored payload into a binding table. Anything the
 * current build does not recognise is dropped rather than rejected wholesale,
 * so a save written by a future (or hand-edited) build still boots.
 */
function sanitizeOverrides(
  stored: Readonly<Record<string, readonly string[]>>,
): Map<GameAction, readonly string[]> {
  const overrides = new Map<GameAction, readonly string[]>();
  for (const [action, keys] of Object.entries(stored)) {
    if (!isGameAction(action)) continue;
    const cleaned: string[] = [];
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      const normalized = normalizeKey(key);
      if (!isBindableKey(normalized)) continue;
      if (cleaned.includes(normalized)) continue;
      cleaned.push(normalized);
      if (cleaned.length === MAX_KEYS_PER_ACTION) break;
    }
    overrides.set(action, cleaned);
  }
  return overrides;
}

/** What a rebind attempt did, so the Controls screen can explain itself. */
export interface RebindOutcome {
  /** False only when the key can never be bound (reserved or a bare modifier). */
  accepted: boolean;
  /** The action the key was taken away from, when the assignment stole it. */
  stolenFrom: GameAction | null;
}

class Keybindings {
  /** Only actions the player has actually changed, so future default changes still reach them. */
  private overrides = sanitizeOverrides(settings.bindings);
  private reverse = new Map<string, GameAction>();

  constructor() {
    this.rebuildReverse();
  }

  private rebuildReverse(): void {
    this.reverse.clear();
    for (const action of ACTION_ORDER) {
      for (const key of this.keysFor(action)) {
        // First writer wins so the reverse map matches the dispatch order the
        // action list is displayed in, even if a hostile payload double-bound a key.
        if (!this.reverse.has(key)) this.reverse.set(key, action);
      }
    }
  }

  /** The keys currently bound to an action, in slot order. May be empty. */
  keysFor(action: GameAction): readonly string[] {
    return this.overrides.get(action) ?? DEFAULT_BINDINGS[action];
  }

  /** The action a raw or normalized key triggers, or null when it is unbound. */
  actionFor(key: string): GameAction | null {
    return this.reverse.get(normalizeKey(key)) ?? null;
  }

  /** True while any key bound to the action is held down. */
  isHeld(input: InputManager, action: GameAction): boolean {
    for (const key of this.keysFor(action)) {
      if (input.has(key)) return true;
    }
    return false;
  }

  /** True when the action has no key at all — the Controls screen flags this. */
  isUnbound(action: GameAction): boolean {
    return this.keysFor(action).length === 0;
  }

  /** Chip/hint text for a single key. */
  labelForKey(key: string): string {
    const normalized = normalizeKey(key);
    return KEY_DISPLAY_LABELS[normalized] ?? normalized.toUpperCase();
  }

  /** Chip/hint text for an action's primary key. */
  labelFor(action: GameAction): string {
    const keys = this.keysFor(action);
    if (keys.length === 0) return UNBOUND_ACTION_LABEL;
    return this.labelForKey(keys[0]);
  }

  /** Chip text for one slot of an action's row, blank-marked when the slot is empty. */
  labelForSlot(action: GameAction, slot: number): string {
    const keys = this.keysFor(action);
    if (slot >= keys.length) return UNBOUND_KEY_LABEL;
    return this.labelForKey(keys[slot]);
  }

  /**
   * Assign `key` to one slot of `action`, taking it from whatever held it.
   *
   * Stealing rather than blocking is deliberate: a hard conflict rule can wedge
   * a player who has run out of free keys into a screen they cannot finish, and
   * an action left unbound is visible and one click from repaired.
   */
  rebind(action: GameAction, slot: number, key: string): RebindOutcome {
    const normalized = normalizeKey(key);
    if (!isBindableKey(normalized)) return { accepted: false, stolenFrom: null };

    const previousOwner = this.actionFor(normalized);
    const stolenFrom = previousOwner !== null && previousOwner !== action ? previousOwner : null;

    if (stolenFrom !== null) {
      this.setKeys(
        stolenFrom,
        this.keysFor(stolenFrom).filter((k) => k !== normalized),
      );
    }

    const next = [...this.keysFor(action)];
    while (next.length <= slot && next.length < MAX_KEYS_PER_ACTION) next.push('');
    const targetSlot = Math.min(slot, next.length - 1);
    next[targetSlot] = normalized;
    this.setKeys(
      action,
      next.filter((k, index) => k !== '' && next.indexOf(k) === index),
    );

    this.rebuildReverse();
    this.persist();
    return { accepted: true, stolenFrom };
  }

  /**
   * Drop one action's overrides, returning it to the shipped keys.
   *
   * The shipped keys may have been taken by something else since, so this
   * steals them back the same way {@link rebind} does. Without that the reset
   * row would show a key that dispatches to whoever holds it first — a chip
   * that looks bound and does nothing, which is exactly the state the
   * steal-with-notice rule exists to make visible.
   *
   * @returns the actions the restore took keys from, so a notice can name them.
   */
  resetAction(action: GameAction): readonly GameAction[] {
    this.overrides.delete(action);
    const restoredKeys = DEFAULT_BINDINGS[action];
    const robbed: GameAction[] = [];
    for (const other of ACTION_ORDER) {
      if (other === action) continue;
      const existing = this.keysFor(other);
      const kept = existing.filter((key) => !restoredKeys.includes(key));
      if (kept.length === existing.length) continue;
      this.setKeys(other, kept);
      robbed.push(other);
    }
    this.rebuildReverse();
    this.persist();
    return robbed;
  }

  /** Drop every override at once. */
  resetAll(): void {
    this.overrides.clear();
    this.rebuildReverse();
    this.persist();
  }

  /** True when the player has changed this action away from the shipped keys. */
  isCustomized(action: GameAction): boolean {
    return this.overrides.has(action);
  }

  private setKeys(action: GameAction, keys: readonly string[]): void {
    const defaults = DEFAULT_BINDINGS[action];
    const matchesDefault =
      keys.length === defaults.length && keys.every((key, index) => key === defaults[index]);
    if (matchesDefault) this.overrides.delete(action);
    else this.overrides.set(action, keys);
  }

  private persist(): void {
    const payload: Record<string, readonly string[]> = {};
    for (const [action, keys] of this.overrides) payload[action] = keys;
    settings.setBindings(payload);
  }
}

export const keybindings = new Keybindings();
