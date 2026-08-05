/**
 * The Controls screen: what every input does, and — on the keyboard side —
 * what it should do instead.
 *
 * Two sub-views rather than one platform-specific list, because a phone player
 * may still pair a keyboard and a desktop player still wants to know what the
 * mobile build does. The touch view is read-only by design: the mobile scheme
 * is positional and gestural, not a keymap, so there is nothing to rebind.
 */

import { type ButtonRect, type PauseTab } from './types';
import { addButton, beginMenuFocus, drawButton, endMenuFocus, BUTTON_PRESETS } from '../Button';
import { drawText } from '../TextBox';
import { drawBox, drawDivider, drawScrollbar, BOX_PRESETS } from '../Box';
import { platform } from '../../core/Platform';
import {
  keybindings,
  ACTION_ORDER,
  ACTION_LABELS,
  MAX_KEYS_PER_ACTION,
  type GameAction,
} from '../../core/Keybindings';
import {
  beginRebindCapture,
  cancelRebindCapture,
  currentRebindNotice,
  isCapturingChip,
  isRebindCaptureActive,
  postRebindNotice,
  resetRebindCapture,
} from './rebindCapture';

export type ControlsView = 'keyboard' | 'touch';

const TITLE_Y = 30;
const TITLE_SIZE = 18;

const SIDE_MARGIN = 16;
const VIEW_BUTTON_Y = 46;
const VIEW_BUTTON_H = 28;
const VIEW_BUTTON_GAP = 6;

/** Top of the scrolling list, measured from the box's top edge. */
export const CONTROLS_SCROLL_TOP_Y = 84;
/**
 * Height of the footer the list must not run into: a notice line plus the two
 * full-width buttons and the breathing room under them.
 */
export const CONTROLS_FOOTER_H = 126;

/** Breathing room above the first row so it clears the divider it scrolls under. */
const CONTENT_TOP_PAD = 8;
const ROW_HEIGHT = 32;
const ROW_LABEL_SIZE = 11;
const ROW_LABEL_COLOR = '#cbd5e1';
const UNBOUND_LABEL_COLOR = '#fca5a5';

const CHIP_W = 64;
const CHIP_H = 24;
const CHIP_GAP = 5;
const CHIP_LABEL_SIZE = 11;
const RESET_CHIP_W = 40;
const RESET_CHIP_LABEL_SIZE = 10;

const SECTION_LABEL_SIZE = 10;
const SECTION_LABEL_COLOR = '#64748b';
const SECTION_HEADER_H = 22;

const TOUCH_ROW_HEIGHT = 44;
const TOUCH_GESTURE_SIZE = 11;
const TOUCH_GESTURE_COLOR = '#e2e8f0';
const TOUCH_EFFECT_SIZE = 10;
const TOUCH_EFFECT_COLOR = '#94a3b8';
const TOUCH_EFFECT_Y_OFFSET = 15;

const HINT_SIZE = 10;
const HINT_COLOR = '#64748b';
const NOTICE_SIZE = 10;
const NOTICE_COLOR = '#facc15';

const SCROLLBAR_X_OFFSET = 7;
const SCROLLBAR_WIDTH = 3;

const FOOTER_BUTTON_H = 34;
const FOOTER_BUTTON_GAP = 8;
const NOTICE_Y_FROM_FOOTER_TOP = 14;
const HINT_Y_FROM_FOOTER_TOP = 16;
const FOOTER_FIRST_BUTTON_Y_FROM_FOOTER_TOP = 38;

const CONFIRM_DIALOG_H = 160;
const CONFIRM_DIALOG_SIDE_MARGIN = 20;
const CONFIRM_TITLE_Y_OFFSET = 28;
const CONFIRM_TITLE_SIZE = 16;
const CONFIRM_BODY_Y_OFFSET = 56;
const CONFIRM_BODY_SIZE = 12;
const CONFIRM_BTN_Y_OFFSET = 106;
const CONFIRM_BTN_H = 36;
const CONFIRM_BTN_SIDE_MARGIN = 12;
const CONFIRM_BTN_GAP = 8;
const CONFIRM_OVERLAY_ALPHA = 0.65;

/** Both sub-views, laid out left to right. */
const VIEW_CHOICES: ReadonlyArray<{ view: ControlsView; label: string }> = [
  { view: 'keyboard', label: 'Keyboard' },
  { view: 'touch', label: 'Touch' },
];

/**
 * The mobile scheme as it is actually implemented, in `MobileTouchState` and the
 * scenes' touch routing. Read-only: nothing here is a key, so there is nothing
 * to rebind — the screen exists so a phone player can discover the gestures.
 */
const MOBILE_CONTROL_ROWS: ReadonlyArray<{ gesture: string; effect: string }> = [
  { gesture: 'Hold anywhere', effect: 'Walk toward your finger.' },
  { gesture: 'Tap', effect: 'Attack, or use whatever you are standing beside.' },
  { gesture: 'Tap Switch', effect: 'Swap which crawler you are driving.' },
  { gesture: 'Tap Follower', effect: 'Give your companion movement and stance orders.' },
  { gesture: 'Tap Bag / Gear', effect: 'Open the pack or the equipment panel.' },
  { gesture: 'Tap Summon', effect: 'Call Mongo to your side — the cat only.' },
  { gesture: 'Tap a hotbar slot', effect: 'Use that item.' },
  { gesture: 'Hold a dynamite slot', effect: 'Charge the throw; let go to send it.' },
  { gesture: 'Long-press an item', effect: 'Open its menu — use, equip, drop.' },
  { gesture: 'Tap the mini-map', effect: 'Expand it. Drag to scroll, tap again to shrink.' },
  { gesture: 'Tap Pause', effect: 'Open this menu.' },
];

/** Where each keyboard section starts, so movement reads apart from the hotbar. */
const KEYBOARD_SECTIONS: ReadonlyArray<{ header: string; startsAt: GameAction }> = [
  { header: 'MOVEMENT', startsAt: 'moveUp' },
  { header: 'ACTIONS', startsAt: 'attack' },
  { header: 'HOTBAR', startsAt: 'hotbar1' },
];

function defaultView(): ControlsView {
  return platform.isMobile ? 'touch' : 'keyboard';
}

let currentView: ControlsView = defaultView();

/** Drop transient screen state — called when the pause menu leaves this tab. */
export function resetControlsTab(): void {
  currentView = defaultView();
  // Notice included: a "taken from …" line outliving the screen that explained
  // it would greet the next visitor with a change they did not just make.
  resetRebindCapture();
}

/** The visible slice of the list, so a half-scrolled row cannot own a hit-rect. */
interface ScrollBand {
  top: number;
  bottom: number;
}

/**
 * A row button that only becomes clickable once it is wholly inside the visible
 * band. Rows are clipped, not culled, so a chip half under the divider is still
 * painted — and without this it would keep a hit-rect out in the footer, where
 * the player can see nothing to aim at.
 *
 * The containment test reads `opts.y` as the top edge, so a caller must leave
 * `alignY` at its default.
 */
function addRowButton(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  band: ScrollBand,
  opts: Parameters<typeof addButton>[2],
): void {
  // `addButton` registers a hit-rect even for a disabled button, which is what
  // lets other menus swallow clicks on a greyed-out row. A greyed-out Reset here
  // means "already default", so it must do nothing at all rather than fire.
  const isWhollyVisible = opts.y >= band.top && opts.y + opts.height <= band.bottom;
  if (isWhollyVisible && opts.disabled !== true) {
    addButton(ctx, buttons, opts);
    return;
  }
  drawButton(ctx, opts);
}

function sectionHeaderFor(action: GameAction): string | null {
  return KEYBOARD_SECTIONS.find((section) => section.startsAt === action)?.header ?? null;
}

function renderKeyboardRow(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  action: GameAction,
  bx: number,
  bw: number,
  rowY: number,
  band: ScrollBand,
  robbedAction: GameAction | null,
): void {
  const isUnbound = keybindings.isUnbound(action);
  const wasRobbed = robbedAction === action;
  drawText(ctx, ACTION_LABELS[action], {
    x: bx + SIDE_MARGIN,
    y: rowY + (ROW_HEIGHT - ROW_LABEL_SIZE) / 2,
    size: ROW_LABEL_SIZE,
    color: isUnbound || wasRobbed ? UNBOUND_LABEL_COLOR : ROW_LABEL_COLOR,
    bold: wasRobbed,
  });

  const rightEdge = bx + bw - SIDE_MARGIN;
  const resetX = rightEdge - RESET_CHIP_W;
  const chipY = rowY + (ROW_HEIGHT - CHIP_H) / 2;

  for (let slot = 0; slot < MAX_KEYS_PER_ACTION; slot++) {
    const slotsFromRight = MAX_KEYS_PER_ACTION - slot;
    const chipX = resetX - CHIP_GAP - slotsFromRight * (CHIP_W + CHIP_GAP) + CHIP_GAP;
    const boundKeyCount = keybindings.keysFor(action).length;
    const capturing = isCapturingChip(action, slot);
    const bound = slot < boundKeyCount;
    // Slots fill left to right: offering the second one while the first is empty
    // would put the key in a chip the player did not click, because the binding
    // list is compact and cannot carry a hole.
    const isNextFreeSlot = slot <= boundKeyCount;
    // An empty slot is only alarming when it is the *last* one: a second slot
    // nobody filled is the normal state of most rows, while an action with no
    // keys at all is a hole the player has to be able to spot.
    const emptySlotPreset = isUnbound ? BUTTON_PRESETS.unboundChip : BUTTON_PRESETS.emptyChip;
    addRowButton(ctx, buttons, band, {
      x: chipX,
      y: chipY,
      width: CHIP_W,
      height: CHIP_H,
      label: capturing ? 'Press…' : keybindings.labelForSlot(action, slot),
      ...(capturing ? BUTTON_PRESETS.listening : bound ? BUTTON_PRESETS.keyChip : emptySlotPreset),
      labelSize: CHIP_LABEL_SIZE,
      disabled: !bound && !isNextFreeSlot,
      // Kept out of the ring: the list scrolls, so rows below the fold are not
      // drawn and could never be tabbed to — a ring that silently covers only
      // part of the list is worse than one that covers none of it. Back is the
      // primary, so the keyboard always has a way out of this screen.
      focusable: false,
      action: () => {
        beginRebindCapture(action, slot);
      },
    });
  }

  addRowButton(ctx, buttons, band, {
    x: resetX,
    y: chipY,
    width: RESET_CHIP_W,
    height: CHIP_H,
    label: 'Reset',
    ...BUTTON_PRESETS.toggle,
    labelSize: RESET_CHIP_LABEL_SIZE,
    disabled: !keybindings.isCustomized(action),
    focusable: false,
    action: () => {
      const robbed = keybindings.resetAction(action);
      const robbedNames = robbed.map((other) => ACTION_LABELS[other]).join(', ');
      postRebindNotice(
        robbed.length === 0
          ? `${ACTION_LABELS[action]} back to its default key.`
          : `${ACTION_LABELS[action]} back to default — taken from ${robbedNames}.`,
      );
    },
  });
}

function renderTouchRow(
  ctx: CanvasRenderingContext2D,
  row: { gesture: string; effect: string },
  bx: number,
  bw: number,
  rowY: number,
): void {
  drawText(ctx, row.gesture, {
    x: bx + SIDE_MARGIN,
    y: rowY,
    size: TOUCH_GESTURE_SIZE,
    bold: true,
    color: TOUCH_GESTURE_COLOR,
  });
  drawText(ctx, row.effect, {
    x: bx + SIDE_MARGIN,
    y: rowY + TOUCH_EFFECT_Y_OFFSET,
    size: TOUCH_EFFECT_SIZE,
    color: TOUCH_EFFECT_COLOR,
    width: bw - SIDE_MARGIN * 2,
  });
}

function renderRestoreConfirmDialog(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  onCancel: () => void,
  onConfirm: () => void,
): void {
  drawBox(ctx, {
    x: bx,
    y: by,
    width: bw,
    height: bh,
    fill: '#000000',
    alpha: CONFIRM_OVERLAY_ALPHA,
  });

  const dialogW = bw - CONFIRM_DIALOG_SIDE_MARGIN * 2;
  const dialogX = bx + CONFIRM_DIALOG_SIDE_MARGIN;
  const dialogY = by + Math.floor((bh - CONFIRM_DIALOG_H) / 2);

  drawBox(ctx, {
    x: dialogX,
    y: dialogY,
    width: dialogW,
    height: CONFIRM_DIALOG_H,
    ...BOX_PRESETS.danger,
    radius: 6,
  });

  drawText(ctx, 'Restore Default Keys?', {
    x: dialogX + dialogW / 2,
    y: dialogY + CONFIRM_TITLE_Y_OFFSET,
    size: CONFIRM_TITLE_SIZE,
    bold: true,
    color: '#fca5a5',
    align: 'center',
  });

  drawText(ctx, 'Every key you have changed goes back to stock.', {
    x: dialogX + CONFIRM_BTN_SIDE_MARGIN,
    y: dialogY + CONFIRM_BODY_Y_OFFSET,
    size: CONFIRM_BODY_SIZE,
    color: '#e2e8f0',
    align: 'center',
    width: dialogW - CONFIRM_BTN_SIDE_MARGIN * 2,
  });

  const btnY = dialogY + CONFIRM_BTN_Y_OFFSET;
  const btnW = Math.floor((dialogW - CONFIRM_BTN_SIDE_MARGIN * 2 - CONFIRM_BTN_GAP) / 2);
  const confirmX = dialogX + CONFIRM_BTN_SIDE_MARGIN;
  const cancelX = confirmX + btnW + CONFIRM_BTN_GAP;

  // Narrows both the click routing and the ring to the dialog's own two buttons.
  beginMenuFocus('pause-bindings-confirm');
  addButton(ctx, buttons, {
    x: confirmX,
    y: btnY,
    width: btnW,
    height: CONFIRM_BTN_H,
    label: 'Yes, Restore',
    ...BUTTON_PRESETS.danger,
    action: onConfirm,
  });
  addButton(ctx, buttons, {
    x: cancelX,
    y: btnY,
    width: btnW,
    height: CONFIRM_BTN_H,
    label: 'Cancel',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: onCancel,
  });
  endMenuFocus();
}

/**
 * @returns the scrollable content's total height, so `PauseMenu` can clamp scroll.
 */
export function renderControlsTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  setTab: (tab: PauseTab) => void,
  scrollY: number,
  showRestoreConfirm: boolean,
  onRequestRestore: () => void,
  onCancelRestore: () => void,
): number {
  drawText(ctx, 'CONTROLS', {
    x: bx + bw / 2,
    y: by + TITLE_Y,
    bold: true,
    size: TITLE_SIZE,
    color: '#f1f5f9',
    align: 'center',
  });

  const rowWidth = bw - SIDE_MARGIN * 2;
  const viewButtonWidth = Math.floor(
    (rowWidth - VIEW_BUTTON_GAP * (VIEW_CHOICES.length - 1)) / VIEW_CHOICES.length,
  );
  VIEW_CHOICES.forEach(({ view, label }, index) => {
    addButton(ctx, buttons, {
      x: bx + SIDE_MARGIN + index * (viewButtonWidth + VIEW_BUTTON_GAP),
      y: by + VIEW_BUTTON_Y,
      width: viewButtonWidth,
      height: VIEW_BUTTON_H,
      label,
      ...(view === currentView ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
      action: () => {
        cancelRebindCapture();
        currentView = view;
      },
    });
  });

  const scrollTop = by + CONTROLS_SCROLL_TOP_Y;
  // Floored at zero so a viewport too short for the header and footer together
  // yields no list rather than an inside-out clip rect.
  const scrollHeight = Math.max(0, bh - CONTROLS_SCROLL_TOP_Y - CONTROLS_FOOTER_H);
  const scrollBottom = scrollTop + scrollHeight;

  drawDivider(ctx, {
    x: bx + SIDE_MARGIN,
    y: scrollTop,
    length: rowWidth,
  });

  const notice = currentRebindNotice();

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollHeight);
  ctx.clip();

  // Rows are positioned in screen space rather than by translating the context:
  // a button's hit-rect comes from the coordinates it is handed, so a translated
  // chip would register its click target at the un-scrolled position.
  const band: ScrollBand = { top: scrollTop, bottom: scrollBottom };
  let contentY = CONTENT_TOP_PAD;
  const screenYFor = (localY: number) => scrollTop + localY - scrollY;
  const isRowVisible = (screenY: number, height: number) =>
    screenY + height > scrollTop && screenY < scrollBottom;

  if (currentView === 'keyboard') {
    for (const action of ACTION_ORDER) {
      const header = sectionHeaderFor(action);
      if (header !== null) {
        const headerScreenY = screenYFor(contentY);
        if (isRowVisible(headerScreenY, SECTION_HEADER_H)) {
          drawText(ctx, header, {
            x: bx + SIDE_MARGIN,
            y: headerScreenY + SECTION_HEADER_H - SECTION_LABEL_SIZE,
            size: SECTION_LABEL_SIZE,
            bold: true,
            color: SECTION_LABEL_COLOR,
          });
        }
        contentY += SECTION_HEADER_H;
      }
      const rowScreenY = screenYFor(contentY);
      if (isRowVisible(rowScreenY, ROW_HEIGHT)) {
        renderKeyboardRow(
          ctx,
          buttons,
          action,
          bx,
          bw,
          rowScreenY,
          band,
          notice?.robbedAction ?? null,
        );
      }
      contentY += ROW_HEIGHT;
    }
  } else {
    for (const row of MOBILE_CONTROL_ROWS) {
      const rowScreenY = screenYFor(contentY);
      if (isRowVisible(rowScreenY, TOUCH_ROW_HEIGHT)) {
        renderTouchRow(ctx, row, bx, bw, rowScreenY);
      }
      contentY += TOUCH_ROW_HEIGHT;
    }
  }

  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - SCROLLBAR_X_OFFSET,
    trackY: scrollTop,
    trackH: scrollHeight,
    contentH: contentY,
    scrollY,
    width: SCROLLBAR_WIDTH,
  });

  const footerTop = by + bh - CONTROLS_FOOTER_H;
  drawDivider(ctx, {
    x: bx + SIDE_MARGIN,
    y: footerTop,
    length: rowWidth,
  });

  if (notice !== null) {
    drawText(ctx, notice.message, {
      x: bx + bw / 2,
      y: footerTop + NOTICE_Y_FROM_FOOTER_TOP,
      size: NOTICE_SIZE,
      color: NOTICE_COLOR,
      align: 'center',
      width: rowWidth,
    });
  } else {
    const hint =
      currentView === 'keyboard'
        ? isRebindCaptureActive()
          ? 'Press any key to bind it. Esc cancels.'
          : 'Tap a key to change it. Escape can never be rebound.'
        : 'Touch gestures are fixed — they are positions, not keys.';
    drawText(ctx, hint, {
      x: bx + bw / 2,
      y: footerTop + HINT_Y_FROM_FOOTER_TOP,
      size: HINT_SIZE,
      color: HINT_COLOR,
      align: 'center',
      width: rowWidth,
    });
  }

  const footerButtonY = footerTop + FOOTER_FIRST_BUTTON_Y_FROM_FOOTER_TOP;
  addButton(ctx, buttons, {
    x: bx + SIDE_MARGIN,
    y: footerButtonY,
    width: rowWidth,
    height: FOOTER_BUTTON_H,
    label: 'Restore Default Keys',
    ...BUTTON_PRESETS.danger,
    disabled: currentView !== 'keyboard',
    action: () => {
      // Guarded rather than relying on `disabled`, which dims the button without
      // taking its hit-rect out of the click routing.
      if (currentView === 'keyboard') onRequestRestore();
    },
  });

  addButton(ctx, buttons, {
    x: bx + SIDE_MARGIN,
    y: footerButtonY + FOOTER_BUTTON_H + FOOTER_BUTTON_GAP,
    width: rowWidth,
    height: FOOTER_BUTTON_H,
    label: '← Back',
    ...BUTTON_PRESETS.primary,
    primaryAction: true,
    action: () => setTab('settings'),
  });

  if (showRestoreConfirm) {
    buttons.length = 0;
    renderRestoreConfirmDialog(ctx, buttons, bx, by, bw, bh, onCancelRestore, () => {
      keybindings.resetAll();
      onCancelRestore();
      postRebindNotice('Every key is back to its default.');
    });
  }

  return contentY;
}
