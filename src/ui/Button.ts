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
const HOVER_GLOW_BLUR = 6;
const PRESSED_OFFSET = 1;
const PRESSED_WIDTH_REDUCTION = 2;
const PRESSED_HEIGHT_REDUCTION = 2;
const PRESS_DARKENING_ALPHA = 0.18;

let _mouseX = RESET_MOUSE_POSITION;
let _mouseY = RESET_MOUSE_POSITION;
let _isDown = false;
let _audioManager: AudioManager | null = null;

/**
 * Buttons drawn since the last setButtonMouseState call.
 * drawButton pushes each rendered button here so notifyButtonClick can find it.
 * Iterated in reverse (last-drawn = topmost) for correct z-order hit testing.
 */
const _renderedButtons: Array<{ x: number; y: number; w: number; h: number; sound: SoundId }> = [];

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
    if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
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
    label,
  } = opts;

  let x = opts.x;
  let y = opts.y;
  if (alignX === 'center') x -= width / 2;
  else if (alignX === 'right') x -= width;
  if (alignY === 'middle') y -= height / 2;
  else if (alignY === 'bottom') y -= height;

  const hovered =
    !disabled && _mouseX >= x && _mouseX <= x + width && _mouseY >= y && _mouseY <= y + height;
  const pressed = hovered && _isDown;

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

  if (hovered && !pressed) {
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
  const textY = labelWrap ? y + BUTTON_LABEL_TOP_PAD : Math.round(y + (height - labelSize) / 2 + 1);

  drawText(ctx, label, {
    x: labelWrap ? x + LABEL_WRAP_WIDTH_PAD : x + width / 2,
    y: textY,
    size: labelSize,
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
    _renderedButtons.push({ x: rx, y: ry, w: rw, h: rh, sound });
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
