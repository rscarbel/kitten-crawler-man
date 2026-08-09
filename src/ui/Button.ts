/** Button drawing utility for canvas UI. All ctx state is saved/restored — zero side effects. */

import { drawBox } from './Box';
import { drawText } from './TextBox';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';

const RESET_MOUSE_POSITION = -99999;
const DEFAULT_BORDER_WIDTH = 1.5;
const DEFAULT_RADIUS = 4;
const DEFAULT_LABEL_SIZE = 13;
const DEFAULT_GLOW_BLUR = 20;
const DEFAULT_SHADOW_BLUR = 16;
const DISABLED_ALPHA_MULTIPLIER = 0.45;
const MIN_LINE_HEIGHT = 14;
const LINE_HEIGHT_MULTIPLIER = 1.4;
const BUTTON_LABEL_TOP_PAD = 8;
const LABEL_WRAP_WIDTH_PAD = 12;
/** Horizontal breathing room kept between a single-line label and the button edges. */
const LABEL_SIDE_PAD = 10;
/** Never shrink an auto-fit label below this, even if it still overflows. */
const MIN_FITTED_LABEL_SIZE = 8;
const HOVER_GLOW_BLUR = 6;
const PRESSED_OFFSET = 1;
const PRESSED_WIDTH_REDUCTION = 2;
const PRESSED_HEIGHT_REDUCTION = 2;
const PRESS_DARKENING_ALPHA = 0.18;
/** Radius large enough that any button using it reads as a pill, whatever its size. */
const CHIP_WELL_RADIUS = 999;

let _mouseX = RESET_MOUSE_POSITION;
let _mouseY = RESET_MOUSE_POSITION;
let _isDown = false;
let _audioManager: AudioManager | null = null;

/**
 * Buttons drawn since the last setButtonMouseState call.
 * drawButton pushes each rendered button here so notifyButtonClick can find it.
 * Iterated in reverse (last-drawn = topmost) for correct z-order hit testing.
 */
const _renderedButtons: Array<{
  x: number;
  y: number;
  w: number;
  h: number;
  sound: SoundId;
  space: PointerSpace;
}> = [];

/**
 * The coordinate space a button was drawn in. Everything is canvas-space by
 * default; a modal shrunk to fit a short viewport draws its buttons in its own
 * design-sized space instead, and the pointer has to be mapped into that space
 * or every hover and click sound misses by the shrink.
 */
interface PointerSpace {
  scale: number;
  pivotX: number;
  pivotY: number;
}

const CANVAS_POINTER_SPACE: PointerSpace = { scale: 1, pivotX: 0, pivotY: 0 };
let _pointerSpace: PointerSpace = CANVAS_POINTER_SPACE;

/** Gold, so the ring reads as focus against every preset's own border colour. */
const FOCUS_RING_COLOR = '#facc15';
const FOCUS_RING_BLUR = 10;
const FOCUS_RING_BORDER_WIDTH = 2.5;
/** Grown slightly outside the button so a gold-bordered preset still shows a ring. */
const FOCUS_RING_INSET = -2;

/**
 * One keyboard-navigable button, captured in draw order while a menu context is
 * declared. Carries its own pointer space so activation can synthesize a click
 * at the button's real canvas position.
 */
interface FocusEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  isPrimary: boolean;
  space: PointerSpace;
}

/** The ring the most recent completed render frame left behind. */
const _focusRing: FocusEntry[] = [];

/** The context declared by the last {@link beginMenuFocus} call of the frame. */
let _declaredContextId: string | null = null;

/** Whether buttons drawn right now still join the ring. */
let _ringOpen = false;

/** The context {@link _focusIndex} is an index into. */
let _focusedContextId: string | null = null;

/** Which ring entry is focused, or null while the player has not touched the keyboard. */
let _focusIndex: number | null = null;

/**
 * Whether an accept key has already been answered since the last render.
 *
 * The ring the keyboard aims at belongs to the last frame that drew, and
 * activating a button usually tears that frame's menu down. Without this a
 * second press arriving inside the same ~16 ms would synthesize a second click
 * at coordinates that no longer mean anything.
 */
let _activatedSinceRender = false;

/** Whether this frame's menu wants its primary shown as focused before any keypress. */
let _focusPrimaryByDefault = false;

/**
 * Declare that the buttons drawn after this call, in this frame, form a
 * keyboard-navigable ring. One call at the top of a menu's render is the whole
 * adoption cost.
 *
 * Calling it again in the same frame *restarts* the ring, which is how an inner
 * confirm dialog narrows focus to its own two buttons: the same trick its click
 * routing already plays by zeroing the hit-rect array.
 *
 * @param contextId - stable identity for this menu. Focus resets whenever the
 *   declared context changes, so a mouse user never sees a ring they did not ask for.
 * @param focusPrimaryByDefault - start with the primary button visibly focused
 *   rather than with nothing focused. Off by default, which is what keeps a
 *   mouse user from being shown a selection they never made. Turn it on for a
 *   menu whose expected answer is the one the player walked into — a doorway —
 *   and leave it off wherever the safe answer is to do nothing, so that the ring
 *   never draws a highlight on a button a stray press would regret.
 */
export function beginMenuFocus(contextId: string, focusPrimaryByDefault = false): void {
  _declaredContextId = contextId;
  _ringOpen = true;
  _focusPrimaryByDefault = focusPrimaryByDefault;
  _focusRing.length = 0;
}

/**
 * Close the ring at the end of a menu's render.
 *
 * Required, not optional: a scene keeps drawing after its topmost dialog —
 * quest UI, tutorial callouts, HUD chrome — and any button drawn while the ring
 * is still open would silently become tabbable from inside a modal that has
 * nothing to do with it.
 */
export function endMenuFocus(): void {
  _ringOpen = false;
}

/**
 * Declare a surface that owns the screen but offers nothing to focus — a
 * loot-box reveal, a chest award, an intro card, an advance-anywhere dialog.
 *
 * Without this the ring belongs to whichever menu drew last, which is not the
 * same as the menu on top: a buttonless overlay painted over an open pause menu
 * would otherwise leave the pause menu's ring live and let a press underneath it
 * activate Resume.
 */
export function suppressMenuFocus(contextId: string): void {
  beginMenuFocus(contextId);
  endMenuFocus();
}

/** Number of navigable buttons the last rendered frame registered. */
export function menuFocusRingSize(): number {
  return _focusRing.length;
}

/**
 * Which menu the last rendered frame declared, or null while play has the floor.
 *
 * The identity, not the size: a keyboard consumer that has to tell "a different
 * menu is up now" from "the same menu grew a button" cannot read that off the
 * ring length, and the difference decides whether a key already being held is a
 * request or a leftover.
 */
export function menuFocusContextId(): string | null {
  return _declaredContextId;
}

/**
 * Drop focus without touching the ring — used when a menu closes from something
 * other than a context change, so re-opening it starts unfocused.
 */
export function clearMenuFocus(): void {
  _focusedContextId = null;
  _focusIndex = null;
  _focusRing.length = 0;
  // The declaration goes with it, so `menuFocusContextId` never names a menu
  // that stopped being on screen — a scene swap would otherwise keep reporting
  // the outgoing scene's last menu until the incoming one first renders.
  _declaredContextId = null;
}

/**
 * Reconcile focus against the context the frame actually declared. A menu that
 * swapped tabs, opened a confirm dialog, or closed entirely gets a fresh ring
 * rather than an index pointing into somebody else's buttons.
 */
function adoptDeclaredContext(): void {
  if (_focusedContextId !== _declaredContextId) {
    _focusedContextId = _declaredContextId;
    _focusIndex = null;
    return;
  }
  // Inside one context the ring can still shrink — a tab whose content changed,
  // a row that became unaffordable. Clamping keeps focus near where the player
  // left it instead of throwing them back to the top of the menu.
  if (_focusIndex === null) return;
  if (_focusRing.length === 0) _focusIndex = null;
  else if (_focusIndex >= _focusRing.length) _focusIndex = _focusRing.length - 1;
}

/**
 * Where focus sits right now, counting a default-focused primary as focused.
 *
 * Without this the first arrow press on a menu that shows a default selection
 * would jump to the top of the ring rather than stepping off the button the
 * player can see highlighted — the highlight and the movement would disagree.
 */
function resolvedFocusIndex(): number | null {
  if (_focusIndex !== null) return _focusIndex;
  if (!_focusPrimaryByDefault) return null;
  const primary = _focusRing.findIndex((entry) => entry.isPrimary);
  return primary === -1 ? null : primary;
}

/** Move focus forward, wrapping. The first press lands on the first button. */
export function focusNextButton(): void {
  adoptDeclaredContext();
  if (_focusRing.length === 0) return;
  const current = resolvedFocusIndex();
  _focusIndex = current === null ? 0 : (current + 1) % _focusRing.length;
}

/** Move focus backward, wrapping. The first press lands on the last button. */
export function focusPreviousButton(): void {
  adoptDeclaredContext();
  if (_focusRing.length === 0) return;
  const current = resolvedFocusIndex();
  _focusIndex =
    current === null
      ? _focusRing.length - 1
      : (current + _focusRing.length - 1) % _focusRing.length;
}

/** Canvas coordinates of a ring entry's centre — where a synthesized click lands. */
function entryCenterInCanvasSpace(entry: FocusEntry): { x: number; y: number } {
  const { scale, pivotX, pivotY } = entry.space;
  return {
    x: pivotX + (entry.x + entry.w / 2 - pivotX) * scale,
    y: pivotY + (entry.y + entry.h / 2 - pivotY) * scale,
  };
}

/**
 * Where an accept keypress should click.
 *
 * With a button focused that is the focused button; with nothing focused it is
 * the menu's primary button, which is what makes "spacebar accepts" true for
 * players who never press Tab. Returns null when neither exists, so the key
 * falls through to whatever else wanted it.
 */
export function focusedButtonClickPoint(): { x: number; y: number } | null {
  if (_activatedSinceRender) return null;
  adoptDeclaredContext();
  const target =
    _focusIndex !== null ? _focusRing[_focusIndex] : _focusRing.find((entry) => entry.isPrimary);
  if (target === undefined) return null;
  _activatedSinceRender = true;
  return entryCenterInCanvasSpace(target);
}

/**
 * Declare that buttons drawn from here on are in a scaled space — see
 * `fitModal` in `ui/Box.ts`. Reset with {@link resetButtonPointerSpace} once the
 * panel is drawn; the next `setButtonMouseState` resets it too.
 */
export function setButtonPointerSpace(scale: number, pivotX: number, pivotY: number): void {
  _pointerSpace = { scale, pivotX, pivotY };
}

export function resetButtonPointerSpace(): void {
  _pointerSpace = CANVAS_POINTER_SPACE;
}

function toSpace(coord: number, pivot: number, scale: number): number {
  return pivot + (coord - pivot) / scale;
}

/**
 * Register the audio manager. Call once per scene in render() alongside
 * setButtonMouseState(). Buttons use it to auto-play click sounds.
 *
 * @example
 *   setButtonAudio(this.audio);
 *   setButtonMouseState(this._mouseX, this._mouseY);
 */
export function setButtonAudio(audio: AudioManager | null): void {
  _audioManager = audio;
}

/**
 * Set the current mouse position for this render frame and clear the
 * registered-button list for the new frame.
 * Call once at the top of your scene's render method.
 *
 * @example
 *   setButtonMouseState(this._mouseX, this._mouseY);
 */
export function setButtonMouseState(mx: number, my: number, isDown = false): void {
  _mouseX = mx;
  _mouseY = my;
  _isDown = isDown;
  _renderedButtons.length = 0;
  // A completed frame that declared no menu context means every menu has closed,
  // so focus is dropped here rather than by each menu's own close path. Without
  // it a dialog reopening under the same context id would come up with the ring
  // already sitting on whatever the player last activated.
  if (_declaredContextId === null) clearMenuFocus();
  _focusRing.length = 0;
  _declaredContextId = null;
  _ringOpen = false;
  _focusPrimaryByDefault = false;
  _activatedSinceRender = false;
  _pointerSpace = CANVAS_POINTER_SPACE;
}

/**
 * Clear mouse state — call when the mouse leaves the canvas or on touch end.
 */
export function clearButtonMouseState(): void {
  _mouseX = RESET_MOUSE_POSITION;
  _mouseY = RESET_MOUSE_POSITION;
  _isDown = false;
  _renderedButtons.length = 0;
}

/**
 * Fire the click sound for whichever button is at (mx, my).
 * Call at the TOP of every scene's handleClick — one call covers all buttons.
 * Iterates registered buttons in reverse (topmost drawn = checked first).
 *
 * @example
 *   handleClick(mx: number, my: number): void {
 *     notifyButtonClick(mx, my);
 *     // ... rest of click routing
 *   }
 */
export function notifyButtonClick(mx: number, my: number): void {
  for (let i = _renderedButtons.length - 1; i >= 0; i--) {
    const btn = _renderedButtons[i];
    const x = toSpace(mx, btn.space.pivotX, btn.space.scale);
    const y = toSpace(my, btn.space.pivotY, btn.space.scale);
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      _audioManager?.play(btn.sound);
      return;
    }
  }
}

/** Full options for drawButton. x, y, width, height, and label are required. */
export interface ButtonOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text label centered inside the button. */
  label: string;

  /** Background fill color. Default: '#1e293b' */
  fill?: string;
  /** Border stroke color. Default: '#334155' */
  border?: string;
  /** Border stroke width in px. Default: 1.5 */
  borderWidth?: number;
  /** Corner radius in px. Default: 4 */
  radius?: number;
  /** Opacity 0–1 applied to the whole button. Default: 1 */
  alpha?: number;

  /** Label font size in px. Default: 13 */
  labelSize?: number;
  /** Label bold weight. Default: true */
  labelBold?: boolean;
  /** Label fill color. Default: '#e2e8f0' */
  labelColor?: string;
  /** Label font family. Default: 'monospace' */
  labelFont?: string;
  /**
   * Word-wrap the label to fit within button width.
   * The label top-aligns with a small top pad; height must be tall enough.
   * Default: false (single-line)
   */
  labelWrap?: boolean;

  /**
   * Horizontal anchor meaning of x.
   * 'left' (default) → x is the left edge
   * 'center'         → x is the horizontal midpoint
   * 'right'          → x is the right edge
   */
  alignX?: 'left' | 'center' | 'right';
  /**
   * Vertical anchor meaning of y.
   * 'top' (default) → y is the top edge
   * 'middle'        → y is the vertical midpoint
   * 'bottom'        → y is the bottom edge
   */
  alignY?: 'top' | 'middle' | 'bottom';

  /**
   * Outer glow emanating from the button.
   *   true           → glow using the border color
   *   '#rrggbb'/rgba → custom glow color
   */
  glow?: boolean | string;
  /** Glow blur radius in px. Default: 20 */
  glowBlur?: number;

  /**
   * Drop shadow beneath the button.
   *   true           → semi-transparent black shadow
   *   '#rrggbb'/rgba → custom shadow color
   */
  shadow?: boolean | string;
  /** Shadow blur radius in px. Default: 16 */
  shadowBlur?: number;
  /** Shadow pixel offset. */
  shadowOffset?: { readonly x: number; readonly y: number };

  /**
   * Dims the button (alpha × 0.45) and suppresses hover/press effects.
   * Label color is also desaturated.
   */
  disabled?: boolean;

  /**
   * Sound played when this button is clicked. Defaults to 'menu_click'.
   * Override per-button when a different sound is appropriate (e.g. 'menu_open').
   */
  sound?: SoundId;

  /**
   * Opt this button out of the keyboard focus ring declared by
   * {@link beginMenuFocus}. Use for decoration-only hit-rects and for chips a
   * player should reach with the pointer rather than by tabbing past everything.
   * Default: true (joins the ring).
   */
  focusable?: boolean;

  /**
   * Marks the menu's safe default — the button an accept keypress activates
   * when nothing is focused. Resume, Close, Continue and Cancel are primaries;
   * anything destructive or wagering never is.
   */
  primaryAction?: boolean;
}

/** Return value from drawButton. */
export interface ButtonResult {
  /** Resolved outer rect (after alignment adjustments). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the cursor is inside the button rect (and button is not disabled). */
  hovered: boolean;
  /** True when hovered AND the primary mouse button is held. */
  pressed: boolean;
  /** Returns true if canvas point (px, py) falls inside the button rect. */
  contains(px: number, py: number): boolean;
}

type ButtonPreset = Partial<Omit<ButtonOptions, 'x' | 'y' | 'width' | 'height' | 'label'>>;

/**
 * Ready-made button styles. Spread into drawButton or addButton.
 *
 * @example
 *   drawButton(ctx, { x, y, width: 160, height: 40, label: 'OK',      ...BUTTON_PRESETS.primary });
 *   drawButton(ctx, { x, y, width: 210, height: 48, label: 'Restart', ...BUTTON_PRESETS.danger  });
 */
export const BUTTON_PRESETS = {
  /** Standard dark menu button — pause menus, dialogs. */
  primary: { fill: '#1e293b', border: '#334155', borderWidth: 1.5, radius: 4 },
  /** Destructive / delete action — danger red. */
  danger: { fill: '#991b1b', border: '#f87171', borderWidth: 2, radius: 4 },
  /** Positive / confirm action — green. */
  success: { fill: '#14532d', border: '#4ade80', borderWidth: 2, radius: 4 },
  /** Ability / legendary — purple. */
  purple: { fill: '#6d28d9', border: '#a855f7', borderWidth: 1.5, radius: 4 },
  /** Purple, with the pale label the award overlays read best against. */
  award: {
    fill: '#6d28d9',
    border: '#a855f7',
    borderWidth: 1.5,
    radius: 4,
    labelColor: '#ede9fe',
  },
  /** Level-complete / achievement — gold with glow. */
  gold: {
    fill: '#2e1065',
    border: '#ffd700',
    borderWidth: 2,
    radius: 8,
    glow: '#ffd700' as const,
    glowBlur: 14,
  },
  /** Safe-room / entry prompt — green tint. */
  safeRoom: { fill: 'rgba(20,83,45,0.9)', border: '#4ade80', borderWidth: 1.5, radius: 4 },
  /** Desktop HUD toggle button — inactive state. */
  toggle: { fill: 'rgba(0,0,0,0.55)', border: '#475569', borderWidth: 1, radius: 2, labelSize: 12 },
  /** Desktop HUD toggle button — open/active state. */
  toggleActive: {
    fill: 'rgba(59,130,246,0.45)',
    border: '#3b82f6',
    borderWidth: 1,
    radius: 2,
    labelSize: 12,
  },
  /** Mobile HUD large button — inactive. */
  mobile: { fill: 'rgba(0,0,0,0.65)', border: '#475569', borderWidth: 1.5, radius: 0 },
  /** Mobile HUD large button — active / toggled state (gold). */
  mobileActive: {
    fill: 'rgba(250,204,21,0.25)',
    border: '#facc15',
    borderWidth: 1.5,
    radius: 0,
  },
  /** Mobile HUD small button — inactive (Gear, Bag). */
  mobileSmall: { fill: 'rgba(0,0,0,0.65)', border: '#475569', borderWidth: 1, radius: 0 },
  /** Mobile HUD small button — active (blue). */
  mobileSmallActive: {
    fill: 'rgba(59,130,246,0.35)',
    border: '#3b82f6',
    borderWidth: 1,
    radius: 0,
  },
  /** Informational / navigation — dark blue with blue border. */
  blue: { fill: '#1e3a5f', border: '#60a5fa', borderWidth: 1.5, radius: 4 },
  /**
   * Armed and waiting for a keypress — the Controls screen's capturing chip.
   * No existing preset reads as "listening"; gold and glowing is the only state
   * on that screen that is asking the player for something.
   */
  listening: {
    fill: '#3f2d05',
    border: '#facc15',
    borderWidth: 2,
    radius: 4,
    labelColor: '#fde68a',
    glow: '#facc15' as const,
    glowBlur: 12,
  },
  /** An optional second slot with nothing in it — quiet, because it is not a fault. */
  emptyChip: {
    fill: 'rgba(15,23,42,0.5)',
    border: '#334155',
    borderWidth: 1,
    radius: 4,
    labelColor: '#475569',
  },
  /** The last slot of an action nobody can trigger any more — the hole has to be visible. */
  unboundChip: {
    fill: '#2b1414',
    border: '#f87171',
    borderWidth: 1.5,
    radius: 4,
    labelColor: '#fca5a5',
  },
  /**
   * A Journal row. Almost nothing but a hover target: the row's content is
   * drawn over it and has to stay the thing the eye lands on, so the fill is a
   * hair lighter than the panel behind it and the border is barely there.
   */
  trackerRow: {
    fill: 'rgba(30,41,59,0.6)',
    border: '#1e293b',
    borderWidth: 1,
    radius: 3,
  },
  /** The pinned Journal row — the one the world arrow is following. */
  trackerRowPinned: {
    fill: 'rgba(250,204,21,0.14)',
    border: '#facc15',
    borderWidth: 1.5,
    radius: 3,
  },
  /**
   * A bare equipment sub-slot on the paper doll. Recessed and quiet — an empty
   * slot is a place, not an offer.
   */
  equipSlotEmpty: { fill: '#1e293b', border: '#334155', borderWidth: 1, radius: 2 },
  /** An equipment sub-slot with something worn in it. */
  equipSlotFilled: { fill: '#0f1a2e', border: '#3b82f6', borderWidth: 1.5, radius: 2 },
  /**
   * The slot the player clicked to ask "what fits here?". Gold because it is the
   * one thing on the screen the dimmed bag is currently answering.
   */
  equipSlotFiltering: { fill: '#1e3a5f', border: '#facc15', borderWidth: 2, radius: 2 },
  /** A bag cell holding something this screen has no use for. */
  bagCell: { fill: '#1e293b', border: '#334155', borderWidth: 1, radius: 2 },
  /** A bag cell holding gear that can go on right now. */
  bagCellEligible: { fill: '#0f2318', border: '#4ade80', borderWidth: 1.5, radius: 2 },
  /** A bound key chip: quiet, reads as a keycap rather than an action. */
  keyChip: {
    fill: '#0f172a',
    border: '#475569',
    borderWidth: 1.5,
    radius: 4,
    labelColor: '#e2e8f0',
  },
  /**
   * Casino chip well: a recessed gold-rimmed pill that a chip is drawn into, so
   * the chip itself carries the colour and the button only carries the hit-rect,
   * hover and press.
   */
  casinoChip: {
    fill: 'rgba(8,32,24,0.75)',
    border: '#c8a840',
    borderWidth: 1.5,
    radius: CHIP_WELL_RADIUS,
  },
  /**
   * The painted betting circle on the felt. Transparent, because the chips
   * stacked on it are the visual — the button exists for the hit-rect, the hover
   * and the click sound.
   */
  casinoBetSpot: {
    fill: 'rgba(0,0,0,0)',
    border: 'rgba(0,0,0,0)',
    radius: CHIP_WELL_RADIUS,
  },
} satisfies Record<string, ButtonPreset>;

/** The default sound ID played on button click. */
export const BUTTON_CLICK_SOUND = 'menu_click' as const;

/**
 * Manual sound trigger for cases outside drawButton (e.g. keyboard shortcuts
 * that activate a button action without a mouse click).
 */
export function playButtonSound(
  audio: AudioManager | null,
  sound: SoundId = BUTTON_CLICK_SOUND,
): void {
  audio?.play(sound);
}

/**
 * Largest font size ≤ `baseSize` at which `label` fits within `maxWidth` on one
 * line, floored at {@link MIN_FITTED_LABEL_SIZE}. Returns `baseSize` unchanged
 * when the label already fits or `maxWidth` is non-positive.
 */
function fitLabelSize(
  ctx: CanvasRenderingContext2D,
  label: string,
  baseSize: number,
  bold: boolean,
  font: string,
  maxWidth: number,
): number {
  if (maxWidth <= 0) return baseSize;
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${baseSize}px ${font}`;
  const textWidth = ctx.measureText(label).width;
  ctx.restore();
  if (textWidth <= maxWidth) return baseSize;
  return Math.max(MIN_FITTED_LABEL_SIZE, Math.floor(baseSize * (maxWidth / textWidth)));
}

/**
 * Draw a button on a 2D canvas context.
 *
 * Saves and restores all ctx state — zero side effects.
 * Hover and press visuals are automatic via setButtonMouseState().
 * Sound fires automatically on click via notifyButtonClick() — no per-button wiring needed.
 */
export function drawButton(ctx: CanvasRenderingContext2D, opts: ButtonOptions): ButtonResult {
  const {
    width,
    height,
    alignX = 'left',
    alignY = 'top',
    fill = '#1e293b',
    border = '#334155',
    borderWidth = DEFAULT_BORDER_WIDTH,
    radius = DEFAULT_RADIUS,
    alpha = 1,
    labelSize = DEFAULT_LABEL_SIZE,
    labelBold = true,
    labelColor = '#e2e8f0',
    labelFont = 'monospace',
    labelWrap = false,
    glow = false,
    glowBlur = DEFAULT_GLOW_BLUR,
    shadow = false,
    shadowBlur = DEFAULT_SHADOW_BLUR,
    shadowOffset,
    disabled = false,
    sound = BUTTON_CLICK_SOUND,
    focusable = true,
    primaryAction = false,
    label,
  } = opts;

  let x = opts.x;
  let y = opts.y;
  if (alignX === 'center') x -= width / 2;
  else if (alignX === 'right') x -= width;
  if (alignY === 'middle') y -= height / 2;
  else if (alignY === 'bottom') y -= height;

  const pointerX = toSpace(_mouseX, _pointerSpace.pivotX, _pointerSpace.scale);
  const pointerY = toSpace(_mouseY, _pointerSpace.pivotY, _pointerSpace.scale);
  const hovered =
    !disabled && pointerX >= x && pointerX <= x + width && pointerY >= y && pointerY <= y + height;
  const pressed = hovered && _isDown;

  const joinsFocusRing = !disabled && focusable && _ringOpen;
  // Two ways to be the focused button: the player walked the ring onto this
  // index, or nobody has touched the ring yet and this menu asked for its
  // primary to start selected. The second is deliberately not gated on the
  // focused context matching — that reconciliation only runs on a keypress, and
  // a default selection has to be visible before the first one.
  const takenByKeyboard =
    _focusedContextId === _declaredContextId && _focusIndex === _focusRing.length;
  const defaultSelected = _focusIndex === null && _focusPrimaryByDefault && primaryAction;
  const focused = joinsFocusRing && (takenByKeyboard || defaultSelected);

  const effectiveAlpha = disabled ? alpha * DISABLED_ALPHA_MULTIPLIER : alpha;

  drawBox(ctx, {
    x,
    y,
    width,
    height,
    fill,
    border,
    borderWidth,
    radius,
    alpha: effectiveAlpha,
    glow,
    glowBlur,
    shadow,
    shadowBlur,
    shadowOffset,
  });

  if ((hovered || focused) && !pressed) {
    drawBox(ctx, {
      x,
      y,
      width,
      height,
      fill: 'rgba(255,255,255,0.09)',
      border,
      borderWidth,
      radius,
      alpha: effectiveAlpha,
      glow: border,
      glowBlur: HOVER_GLOW_BLUR,
    });
  }

  // Outside the button rather than on its border, so a preset that is already
  // gold-bordered still shows a visible ring rather than merging with it.
  if (focused) {
    drawBox(ctx, {
      x: x + FOCUS_RING_INSET,
      y: y + FOCUS_RING_INSET,
      width: width - FOCUS_RING_INSET * 2,
      height: height - FOCUS_RING_INSET * 2,
      fill: 'rgba(0,0,0,0)',
      border: FOCUS_RING_COLOR,
      borderWidth: FOCUS_RING_BORDER_WIDTH,
      radius: radius - FOCUS_RING_INSET,
      alpha: effectiveAlpha,
      glow: FOCUS_RING_COLOR,
      glowBlur: FOCUS_RING_BLUR,
    });
  }

  if (pressed) {
    drawBox(ctx, {
      x: x + PRESSED_OFFSET,
      y: y + PRESSED_OFFSET,
      width: width - PRESSED_WIDTH_REDUCTION,
      height: height - PRESSED_HEIGHT_REDUCTION,
      fill: `rgba(0,0,0,${PRESS_DARKENING_ALPHA})`,
      radius: Math.max(0, radius - PRESSED_OFFSET),
      alpha: effectiveAlpha,
    });
  }

  const lineHeight = Math.max(MIN_LINE_HEIGHT, Math.ceil(labelSize * LINE_HEIGHT_MULTIPLIER));

  // Single-line labels shrink to fit within the button so a long label (e.g.
  // "Close  [Space / Esc]") never runs to the edges. Wrapped labels flow instead.
  const fittedLabelSize = labelWrap
    ? labelSize
    : fitLabelSize(ctx, label, labelSize, labelBold, labelFont, width - LABEL_SIDE_PAD * 2);
  const textY = labelWrap
    ? y + BUTTON_LABEL_TOP_PAD
    : Math.round(y + (height - fittedLabelSize) / 2 + 1);

  drawText(ctx, label, {
    x: labelWrap ? x + LABEL_WRAP_WIDTH_PAD : x + width / 2,
    y: textY,
    size: fittedLabelSize,
    bold: labelBold,
    color: disabled ? '#475569' : labelColor,
    font: labelFont,
    align: 'center',
    alpha: effectiveAlpha,
    ...(labelWrap ? { width: width - LABEL_WRAP_WIDTH_PAD * 2, lineHeight } : {}),
  });

  const rx = x;
  const ry = y;
  const rw = width;
  const rh = height;

  if (!disabled) {
    _renderedButtons.push({ x: rx, y: ry, w: rw, h: rh, sound, space: _pointerSpace });
  }
  if (joinsFocusRing) {
    _focusRing.push({
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      isPrimary: primaryAction,
      space: _pointerSpace,
    });
  }

  return {
    x: rx,
    y: ry,
    width: rw,
    height: rh,
    hovered,
    pressed,
    contains(px: number, py: number): boolean {
      return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    },
  };
}

/**
 * Draw a button and push its hit-rect into a button array.
 * The direct replacement for the old menuBtn() helper.
 *
 * @example
 *   addButton(ctx, buttons, {
 *     x: bX, y: bY, width: bW, height: 40,
 *     label: 'Stats',
 *     ...BUTTON_PRESETS.primary,
 *     action: () => setTab('stats'),
 *   });
 */
export function addButton(
  ctx: CanvasRenderingContext2D,
  buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
    label?: string;
  }>,
  opts: ButtonOptions & { action: () => void },
): ButtonResult {
  const result = drawButton(ctx, opts);
  buttons.push({
    x: result.x,
    y: result.y,
    w: result.width,
    h: result.height,
    action: opts.action,
    label: opts.label,
  });
  return result;
}
