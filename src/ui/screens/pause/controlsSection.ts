/**
 * Controls: what every input does and, on the keyboard side, what it should
 * do instead.
 *
 * Two views rather than one per platform, because a phone player may still
 * pair a keyboard and a desktop player still wants to know what the phone
 * build does. The touch view is read-only: the touch scheme is positional and
 * gestural, not a keymap, so there is nothing to rebind.
 */

import {
  ACTION_LABELS,
  ACTION_ORDER,
  keybindings,
  MAX_KEYS_PER_ACTION,
  type GameAction,
} from '../../../core/Keybindings';
import { splitH, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import type { ButtonVariant } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { listRow, listRowHeight } from '../../widgets/listRow';
import { text } from '../../widgets/text';
import { choiceRow, wideButton, type Choice } from './parts';
import type { RebindCapture } from './rebindCapture';
import type { PauseSection, SectionLayout } from './section';

type ControlsView = 'keyboard' | 'touch';

/**
 * The touch scheme as the scenes implement it. Read-only: nothing here is a
 * key, so there is nothing to rebind; the list exists so a phone player can
 * discover the gestures.
 */
const TOUCH_CONTROL_ROWS: ReadonlyArray<{ readonly gesture: string; readonly effect: string }> = [
  { gesture: 'Hold anywhere', effect: 'Walk toward your finger.' },
  { gesture: 'Tap', effect: 'Attack, or use whatever you are standing beside.' },
  { gesture: 'Tap Switch', effect: 'Swap which crawler you are driving.' },
  { gesture: 'Tap Follower', effect: 'Give your companion movement and stance orders.' },
  { gesture: 'Tap Bag', effect: 'Open the pack.' },
  { gesture: 'Tap Summon', effect: 'Call Mongo to your side — the cat only.' },
  { gesture: 'Tap a hotbar slot', effect: 'Use that item.' },
  { gesture: 'Hold a dynamite slot', effect: 'Charge the throw; let go to send it.' },
  { gesture: 'Long-press an item', effect: 'Open its menu — use, equip, drop.' },
  { gesture: 'Tap the mini-map', effect: 'Expand it. Drag to scroll, tap again to shrink.' },
  { gesture: 'Tap Pause', effect: 'Open this menu.' },
];

/** Where each keyboard group starts, so movement reads apart from the hotbar. */
const KEYBOARD_GROUPS: ReadonlyArray<{ readonly header: string; readonly startsAt: GameAction }> = [
  { header: 'Movement', startsAt: 'moveUp' },
  { header: 'Actions', startsAt: 'attack' },
  { header: 'Hotbar', startsAt: 'hotbar1' },
];

/** A key chip is this many control heights wide. */
const CHIP_WIDTH_CONTROLS = 2;
/** The per-row Reset button is this many control heights wide. */
const RESET_WIDTH_CONTROLS = 1.8;

const VIEW_CHOICES: readonly Choice<ControlsView>[] = [
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'touch', label: 'Touch' },
];

function groupHeaderFor(action: GameAction): string | null {
  return KEYBOARD_GROUPS.find((group) => group.startsAt === action)?.header ?? null;
}

function hint(view: ControlsView, rebind: RebindCapture): string {
  if (view === 'touch') return 'Touch gestures are fixed — they are positions, not keys.';
  return rebind.active
    ? 'Press any key to bind it. Esc cancels.'
    : 'Tap a key to change it. Escape can never be rebound.';
}

function chipVariant(capturing: boolean, bound: boolean, actionUnbound: boolean): ButtonVariant {
  if (capturing) return 'primary';
  if (bound) return 'secondary';
  // An empty second slot is the normal state of most rows; an action with no
  // keys at all is a hole the player has to be able to spot.
  return actionUnbound ? 'danger' : 'ghost';
}

function keyboardRow(
  layout: SectionLayout,
  ui: Ui,
  action: GameAction,
  rebind: RebindCapture,
  robbed: GameAction | null,
): void {
  const { space, size } = ui.theme;
  const rect = layout.row(buttonHeight(ui, 'sm'), space.sm);
  const chipW = size.control * CHIP_WIDTH_CONTROLS;
  const resetW = size.control * RESET_WIDTH_CONTROLS;
  const chipTracks = Array.from({ length: MAX_KEYS_PER_ACTION }, () => chipW);
  const [labelCell, ...controlCells] = splitH(rect, ['fill', ...chipTracks, resetW], space.xs);
  const unbound = keybindings.isUnbound(action);
  text(ui, labelCell, {
    text: ACTION_LABELS[action],
    role: unbound || robbed === action ? 'danger' : 'label',
  });
  const boundCount = keybindings.keysFor(action).length;
  for (let slot = 0; slot < MAX_KEYS_PER_ACTION; slot++) {
    const cell = controlCells[slot];
    const capturing = rebind.isCapturing(action, slot);
    const bound = slot < boundCount;
    // Slots fill left to right: the binding list is compact and cannot carry
    // a hole, so a chip past the first empty one would bind a different slot.
    const isNextFreeSlot = slot <= boundCount;
    const chipEnabled = bound || isNextFreeSlot;
    layout.track(
      cell,
      button(ui, cell, {
        id: `chip/${action}/${slot}`,
        label: capturing ? 'Press…' : keybindings.labelForSlot(action, slot),
        size: 'sm',
        variant: chipVariant(capturing, bound, unbound),
        disabled: !chipEnabled,
        onTap: () => rebind.begin(action, slot),
      }),
      { focusable: chipEnabled },
    );
  }
  const resetCell = controlCells[MAX_KEYS_PER_ACTION];
  const customized = keybindings.isCustomized(action);
  layout.track(
    resetCell,
    button(ui, resetCell, {
      id: `reset/${action}`,
      label: 'Reset',
      size: 'sm',
      variant: 'quiet',
      disabled: !customized,
      onTap: () => {
        const robbedFrom = keybindings.resetAction(action);
        const names = robbedFrom.map((other) => ACTION_LABELS[other]).join(', ');
        rebind.post(
          robbedFrom.length === 0
            ? `${ACTION_LABELS[action]} back to its default key.`
            : `${ACTION_LABELS[action]} back to default — taken from ${names}.`,
        );
      },
    }),
    { focusable: customized },
  );
}

function touchRows(layout: SectionLayout, ui: Ui): void {
  const rowH = listRowHeight(ui, true);
  for (const row of TOUCH_CONTROL_ROWS) {
    const rect: Rect = layout.row(rowH, ui.theme.space.xxs);
    listRow(ui, rect, { id: `touch/${row.gesture}`, title: row.gesture, subtitle: row.effect });
  }
}

export function controlsSection(rebind: RebindCapture): PauseSection {
  let view: ControlsView | null = null;
  const currentView = (ui: Ui): ControlsView =>
    view ?? (ui.density === 'touch' ? 'touch' : 'keyboard');

  return {
    id: 'controls',
    label: 'Controls',
    glyph: 'keyboard',
    subtitle: (_ctx, ui) => rebind.currentNotice()?.message ?? hint(currentView(ui), rebind),
    render: (layout, ctx) => {
      const { ui } = layout;
      const { space } = ui.theme;
      const shown = currentView(ui);

      choiceRow(layout, {
        id: 'controls-view',
        choices: VIEW_CHOICES,
        selected: shown,
        onPick: (picked) => {
          rebind.cancel();
          view = picked;
        },
      });
      layout.space(space.xs);

      if (shown === 'touch') {
        touchRows(layout, ui);
        return;
      }

      wideButton(layout, {
        id: 'restore-keys',
        label: 'Restore Default Keys',
        variant: 'danger',
        onTap: () => ctx.actions.requestRestoreKeys(),
      });
      layout.space(space.sm);

      const robbed = rebind.currentNotice()?.robbedAction ?? null;
      for (const action of ACTION_ORDER) {
        const header = groupHeaderFor(action);
        if (header !== null) layout.heading(header);
        keyboardRow(layout, ui, action, rebind, robbed);
      }
    },
    // The screen hands keys here only while this page shows, so an armed chip
    // owns every key, Tab and the arrows included.
    onKey: (key, mods) => {
      if (!rebind.active) return false;
      if (key === 'Escape') rebind.cancel();
      else if (mods.repeat !== true) rebind.feed(key);
      return true;
    },
    reset: () => {
      view = null;
      rebind.reset();
    },
  };
}
