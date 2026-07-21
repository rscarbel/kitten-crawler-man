/**
 * Box and container drawing utilities for canvas UI.
 *
 * Key design principles (mirrors TextBox.ts):
 *   - All ctx state is saved/restored — zero side effects
 *   - x/y are always the top-left corner unless alignX/alignY override
 *   - drawBox() returns BoxResult with inner content rect + hit-test helper
 *   - BOX_PRESETS / PROGRESS_PRESETS are ready-made visual styles
 *
 * @example Panel with text content
 *   const box = drawBox(ctx, { x: 8, y: 8, width: 200, height: 120, ...BOX_PRESETS.panel, padding: 8 });
 *   drawText(ctx, 'Score: 100', { x: box.inner.x, y: box.inner.y });
 *
 * @example Centered modal
 *   const modal = drawModal(ctx, {
 *     canvasWidth: cw, canvasHeight: ch, width: 380, height: 300,
 *     ...BOX_PRESETS.modal, padding: 20,
 *   });
 *
 * @example Button with hit-test
 *   const btn = drawBox(ctx, { x: bx, y: by, width: 160, height: 40, ...BOX_PRESETS.button });
 *   drawText(ctx, 'OK', { x: btn.x + btn.width / 2, y: btn.y + 12, align: 'center' });
 *   if (btn.contains(mouseX, mouseY)) handleClick();
 *
 * @example HP bar
 *   drawProgressBar(ctx, { x: 8, y: 48, width: 120, height: 8,
 *     value: hp / maxHp, ...PROGRESS_PRESETS.hp });
 *
 * @example Vertical stack layout
 *   const [titleY, descY, btnY] = stackV(modal.inner.y, 12, 28, 64, 40);
 */

// Box defaults
const DEFAULT_BORDER_WIDTH = 1.5;
const DEFAULT_GLOW_BLUR = 20;
const DEFAULT_SHADOW_BLUR = 16;
const DEFAULT_SHADOW_OFFSET_X = 4;
const DEFAULT_SHADOW_OFFSET_Y = 4;
const DEFAULT_OVERLAY_ALPHA = 0.6;
const DEFAULT_SCROLLBAR_WIDTH = 6;
const DEFAULT_SCROLLBAR_MIN_THUMB_HEIGHT = 20;

export type Padding = number | { top?: number; right?: number; bottom?: number; left?: number };

/** All options accepted by drawBox. x, y, width, height are required. */
export interface BoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;

  /**
   * Horizontal anchor meaning of x.
   *   'left'   → x is the left edge (default)
   *   'center' → x is the horizontal center
   *   'right'  → x is the right edge
   */
  alignX?: 'left' | 'center' | 'right';
  /**
   * Vertical anchor meaning of y.
   *   'top'    → y is the top edge (default)
   *   'middle' → y is the vertical center
   *   'bottom' → y is the bottom edge
   */
  alignY?: 'top' | 'middle' | 'bottom';

  /** Background fill color. Omit for a transparent background. */
  fill?: string;
  /** Border stroke color. Omit for no border. */
  border?: string;
  /** Border stroke width in px. Default: 1.5 */
  borderWidth?: number;
  /** Corner radius in px. Default: 0 (sharp corners) */
  radius?: number;

  /** Opacity 0–1 applied to the whole box. Default: 1 */
  alpha?: number;

  /**
   * Outer glow emanating from the box.
   *   true           → glow using the border color (falls back to white)
   *   '#rrggbb'/rgba → custom glow color
   */
  glow?: boolean | string;
  /** Glow blur radius in px. Default: 20 */
  glowBlur?: number;

  /**
   * Drop shadow beneath the box.
   *   true           → semi-transparent black shadow
   *   '#rrggbb'/rgba → custom shadow color
   */
  shadow?: boolean | string;
  /** Shadow blur radius in px. Default: 16 */
  shadowBlur?: number;
  /** Shadow pixel offset. Default: { x: DEFAULT_SHADOW_OFFSET_X, y: DEFAULT_SHADOW_OFFSET_Y } */
  shadowOffset?: { readonly x: number; readonly y: number };

  /**
   * Inner padding — shrinks the returned inner content rect.
   * Pass a number for uniform padding, or an object for per-side control.
   *
   * @example padding: 12
   * @example padding: { top: 8, left: 12, right: 12, bottom: 8 }
   */
  padding?: Padding;
}

/** Return value from drawBox. Use for child layout and hit-testing. */
export interface BoxResult {
  /** Resolved outer rect (after alignment adjustments). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Inner content area after padding. Position children here. */
  inner: Readonly<{ x: number; y: number; width: number; height: number }>;
  /** Returns true if canvas point (px, py) falls inside the outer rect. */
  contains(px: number, py: number): boolean;
}

/** Options for drawModal — same as BoxOptions but x/y are derived from canvas center. */
export interface ModalOptions extends Omit<BoxOptions, 'x' | 'y' | 'alignX' | 'alignY'> {
  canvasWidth: number;
  canvasHeight: number;
  /** Horizontal offset from canvas center. Default: 0 */
  offsetX?: number;
  /** Vertical offset from canvas center. Default: 0 */
  offsetY?: number;
}

export interface ProgressBarOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fill ratio 0–1. Values outside this range are clamped. */
  value: number;
  /** Filled-portion color. Default: '#4ade80' */
  fill?: string;
  /** Empty-portion background color. Default: 'rgba(0,0,0,0.5)' */
  background?: string;
  /** Optional border color. */
  border?: string;
  /** Border stroke width. Default: 1 */
  borderWidth?: number;
  /** Corner radius. Default: 2 */
  radius?: number;
  /** Opacity 0–1. Default: 1 */
  alpha?: number;
}

export interface DividerOptions {
  x: number;
  y: number;
  /** Line length in px. */
  length: number;
  /** Line color. Default: '#334155' */
  color?: string;
  /** Stroke width in px. Default: 1 */
  lineWidth?: number;
  /** Opacity 0–1. Default: 1 */
  alpha?: number;
  /** Orientation. Default: 'horizontal' */
  direction?: 'horizontal' | 'vertical';
}

export interface OverlayOptions {
  canvasWidth: number;
  canvasHeight: number;
  /** Overlay color. Default: '#000' */
  color?: string;
  /** Overlay opacity 0–1. Default: 0.6 */
  alpha?: number;
}

type BoxPreset = Partial<Omit<BoxOptions, 'x' | 'y' | 'width' | 'height'>>;
type ProgressPreset = Partial<Omit<ProgressBarOptions, 'x' | 'y' | 'width' | 'height' | 'value'>>;

/**
 * Ready-made box styles for common use cases. Spread into drawBox or drawModal.
 *
 * @example
 *   drawModal(ctx, { canvasWidth: cw, canvasHeight: ch, width: 380, height: 300,
 *     ...BOX_PRESETS.modal, padding: 20 });
 *   const btn = drawBox(ctx, { x, y, width: 160, height: 40, ...BOX_PRESETS.button });
 */
export const BOX_PRESETS = {
  /** Translucent dark panel — HUD stats, sidebars. */
  panel: { fill: 'rgba(8,15,30,0.88)', border: '#334155', borderWidth: 1.5 },
  /** Opaque dark modal window — menus, dialogs. */
  modal: { fill: '#0f172a', border: '#334155', borderWidth: 2 },
  /** Compact floating tooltip. */
  tooltip: { fill: 'rgba(8,10,20,0.97)', border: '#3b82f6', borderWidth: 1 },
  /** Standard interactive button. */
  button: { fill: '#1e293b', border: '#475569', borderWidth: 1.5 },
  /** Destructive / delete button. */
  buttonDanger: { fill: '#991b1b', border: '#f87171', borderWidth: 2 },
  /** Positive / confirm button. */
  buttonSuccess: { fill: '#14532d', border: '#4ade80', borderWidth: 2 },
  /** Highlighted / selected item. */
  highlight: { fill: 'rgba(255,215,0,0.12)', border: '#ffd700', borderWidth: 1.5 },
  /** Achievement or legendary gold glow. */
  achievement: {
    fill: '#0a0a1a',
    border: '#ffd700',
    borderWidth: 3,
    glow: '#ffd700',
    glowBlur: 32,
  },
  /** Safe room green theme. */
  safeRoom: { fill: 'rgba(20,83,45,0.9)', border: '#4ade80', borderWidth: 1.5 },
  /** Danger / warning red. */
  danger: { fill: 'rgba(127,29,29,0.9)', border: '#ef4444', borderWidth: 1.5 },
  /** Boss encounter deep purple. */
  boss: {
    fill: 'rgba(30,10,50,0.95)',
    border: '#a855f7',
    borderWidth: 2,
    glow: '#a855f7',
    glowBlur: 24,
  },
} satisfies Record<string, BoxPreset>;

/**
 * Ready-made progress bar styles. Spread into drawProgressBar.
 *
 * @example
 *   drawProgressBar(ctx, { x, y, width: 120, height: 8,
 *     value: hp / maxHp, ...PROGRESS_PRESETS.hp });
 */
export const PROGRESS_PRESETS = {
  hp: { fill: '#ef4444', background: 'rgba(0,0,0,0.5)', radius: 2 },
  mana: { fill: '#3b82f6', background: 'rgba(0,0,0,0.5)', radius: 2 },
  xp: { fill: '#facc15', background: 'rgba(0,0,0,0.5)', radius: 2 },
  stamina: { fill: '#4ade80', background: 'rgba(0,0,0,0.5)', radius: 2 },
  boss: {
    fill: '#a855f7',
    background: 'rgba(0,0,0,0.7)',
    border: '#7c3aed',
    borderWidth: 1,
    radius: 0,
  },
} satisfies Record<string, ProgressPreset>;

function resolvePadding(p: Padding | undefined): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  if (p === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr);
  ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r <= 0) {
    ctx.fillRect(x, y, w, h);
    return;
  }
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r <= 0) {
    ctx.strokeRect(x, y, w, h);
    return;
  }
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

/**
 * Draw a rectangular box with optional fill, border, rounded corners, shadow, and glow.
 *
 * All ctx state is saved and restored — zero side effects.
 * Returns a BoxResult you can use to position child elements or hit-test clicks.
 */
export function drawBox(ctx: CanvasRenderingContext2D, opts: BoxOptions): BoxResult {
  const {
    width,
    height,
    alignX = 'left',
    alignY = 'top',
    fill,
    border,
    borderWidth = DEFAULT_BORDER_WIDTH,
    radius = 0,
    alpha = 1,
    glow = false,
    glowBlur = DEFAULT_GLOW_BLUR,
    shadow = false,
    shadowBlur = DEFAULT_SHADOW_BLUR,
    shadowOffset = { x: DEFAULT_SHADOW_OFFSET_X, y: DEFAULT_SHADOW_OFFSET_Y },
    padding,
  } = opts;

  let x = opts.x;
  let y = opts.y;
  if (alignX === 'center') x = opts.x - width / 2;
  else if (alignX === 'right') x = opts.x - width;
  if (alignY === 'middle') y = opts.y - height / 2;
  else if (alignY === 'bottom') y = opts.y - height;

  const pad = resolvePadding(padding);
  const inner = {
    x: x + pad.left,
    y: y + pad.top,
    width: Math.max(0, width - pad.left - pad.right),
    height: Math.max(0, height - pad.top - pad.bottom),
  };

  ctx.save();
  ctx.globalAlpha = alpha;

  const hasShadowEffect = shadow !== false || glow !== false;

  if (shadow !== false) {
    ctx.shadowColor = typeof shadow === 'string' ? shadow : 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffset.x;
    ctx.shadowOffsetY = shadowOffset.y;
  } else if (glow !== false) {
    ctx.shadowColor = typeof glow === 'string' ? glow : (border ?? '#ffffff');
    ctx.shadowBlur = glowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (fill !== undefined) {
    ctx.fillStyle = fill;
    fillRoundRect(ctx, x, y, width, height, radius);

    // Clear shadow so the border stroke is crisp, not blurry
    if (hasShadowEffect) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  if (border !== undefined) {
    ctx.strokeStyle = border;
    ctx.lineWidth = borderWidth;
    strokeRoundRect(ctx, x, y, width, height, radius);
  }

  ctx.restore();

  // Capture locals so the returned closure doesn't reference mutable `x`/`y`
  const rx = x;
  const ry = y;
  const rw = width;
  const rh = height;

  return {
    x: rx,
    y: ry,
    width: rw,
    height: rh,
    inner,
    contains(px: number, py: number): boolean {
      return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    },
  };
}

/**
 * Draw a box centered in the canvas.
 *
 * Identical to drawBox except x/y are derived from the canvas dimensions —
 * saves you from manually computing Math.round(cw / 2 - boxW / 2) every time.
 *
 * `width` is clamped to `canvasWidth` as a last-resort safety net so a modal
 * can never render wider than the viewport (a recurring mobile bug — fixed
 * pixel widths that overflow a narrow phone canvas). This is a floor, not a
 * design choice: for a nicer side margin, clamp your own ideal width against
 * `canvasWidth` before calling (e.g. `Math.min(IDEAL_WIDTH, canvasWidth - 40)`)
 * — see `QuestDialog.ts`. Either way, read the returned `width`/`inner.width`
 * for any further layout math (centering child content, card widths, etc.);
 * reusing the original unclamped constant is the mistake that reintroduces
 * the overflow one line down even when the box itself was clamped correctly.
 */
export function drawModal(ctx: CanvasRenderingContext2D, opts: ModalOptions): BoxResult {
  const { canvasWidth, canvasHeight, width, height, offsetX = 0, offsetY = 0, ...rest } = opts;
  const clampedWidth = Math.min(width, canvasWidth);
  const x = Math.round(canvasWidth / 2 - clampedWidth / 2) + offsetX;
  const y = Math.round(canvasHeight / 2 - height / 2) + offsetY;
  return drawBox(ctx, { x, y, width: clampedWidth, height, ...rest });
}

/**
 * Draw a horizontal progress / fill bar.
 *
 * The fill is clipped to the background rect, so partial fills with rounded
 * corners look correct at any value.
 */
export function drawProgressBar(ctx: CanvasRenderingContext2D, opts: ProgressBarOptions): void {
  const {
    x,
    y,
    width,
    height,
    value,
    fill = '#4ade80',
    background = 'rgba(0,0,0,0.5)',
    border,
    borderWidth = 1,
    radius = 2,
    alpha = 1,
  } = opts;

  const clamped = Math.max(0, Math.min(1, value));

  ctx.save();
  ctx.globalAlpha = alpha;

  // Background track
  ctx.fillStyle = background;
  fillRoundRect(ctx, x, y, width, height, radius);

  // Filled portion — clip to the outer shape so rounded corners stay intact
  if (clamped > 0) {
    ctx.save();
    if (radius > 0) {
      roundRectPath(ctx, x, y, width, height, radius);
      ctx.clip();
    }
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, clamped * width, height);
    ctx.restore();
  }

  if (border !== undefined) {
    ctx.strokeStyle = border;
    ctx.lineWidth = borderWidth;
    strokeRoundRect(ctx, x, y, width, height, radius);
  }

  ctx.restore();
}

/**
 * Draw a horizontal or vertical separator line.
 */
export function drawDivider(ctx: CanvasRenderingContext2D, opts: DividerOptions): void {
  const {
    x,
    y,
    length,
    color = '#334155',
    lineWidth = 1,
    alpha = 1,
    direction = 'horizontal',
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x, y);
  if (direction === 'horizontal') {
    ctx.lineTo(x + length, y);
  } else {
    ctx.lineTo(x, y + length);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Fill the entire canvas with a semi-transparent color.
 * Call before drawing modal dialogs or death / pause screens.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, opts: OverlayOptions): void {
  const { canvasWidth, canvasHeight, color = '#000', alpha = DEFAULT_OVERLAY_ALPHA } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

export interface ScrollbarOptions {
  /** X position of the scrollbar. */
  x: number;
  /** Top y of the scroll track. */
  trackY: number;
  /** Visible height of the track (viewport height). */
  trackH: number;
  /** Total scrollable content height. */
  contentH: number;
  /** Current scroll offset in px. */
  scrollY: number;
  /** Track and thumb width in px. Default: 6 */
  width?: number;
  /** Track fill color. Default: '#1e293b' */
  trackColor?: string;
  /** Thumb fill color. Default: '#64748b' */
  thumbColor?: string;
  /** Minimum thumb height in px. Default: 20 */
  minThumbH?: number;
}

/**
 * Draw a vertical scrollbar (track + thumb). No-ops when contentH ≤ trackH.
 */
export function drawScrollbar(ctx: CanvasRenderingContext2D, opts: ScrollbarOptions): void {
  const {
    x,
    trackY,
    trackH,
    contentH,
    scrollY,
    width = DEFAULT_SCROLLBAR_WIDTH,
    trackColor = '#1e293b',
    thumbColor = '#64748b',
    minThumbH = DEFAULT_SCROLLBAR_MIN_THUMB_HEIGHT,
  } = opts;

  if (contentH <= trackH) return;

  const thumbH = Math.max(minThumbH, (trackH / contentH) * trackH);
  const maxScroll = contentH - trackH;
  const thumbY = trackY + (scrollY / maxScroll) * (trackH - thumbH);

  ctx.save();
  ctx.fillStyle = trackColor;
  ctx.fillRect(x, trackY, width, trackH);
  ctx.fillStyle = thumbColor;
  ctx.fillRect(x, thumbY, width, thumbH);
  ctx.restore();
}

/**
 * Return the x that centers a child of `childWidth` inside a parent rect.
 *
 * @example
 *   const btnX = centerX(modal.inner.x, modal.inner.width, btnW);
 */
export function centerX(parentX: number, parentWidth: number, childWidth: number): number {
  return Math.round(parentX + (parentWidth - childWidth) / 2);
}

/**
 * Return the y that centers a child of `childHeight` inside a parent rect.
 *
 * @example
 *   const iconY = centerY(btn.y, btn.height, 16);
 */
export function centerY(parentY: number, parentHeight: number, childHeight: number): number {
  return Math.round(parentY + (parentHeight - childHeight) / 2);
}

/**
 * Return the y position of each item in a vertical stack.
 *
 * @param startY  Top edge of the first item.
 * @param gap     Vertical gap between items in px.
 * @param heights One height per item, in order.
 *
 * @example
 *   const [titleY, descY, btnY] = stackV(modal.inner.y, 12, 24, 80, 36);
 *   drawText(ctx, title, { x, y: titleY, ...TEXT_PRESETS.heading });
 *   drawText(ctx, desc,  { x, y: descY, width: w });
 *   drawBox(ctx,         { x, y: btnY, width: w, height: 36, ...BOX_PRESETS.button });
 */
export function stackV(startY: number, gap: number, ...heights: number[]): number[] {
  const positions: number[] = [];
  let cursor = startY;
  for (const h of heights) {
    positions.push(cursor);
    cursor += h + gap;
  }
  return positions;
}

/**
 * Return the x position of each item in a horizontal stack.
 *
 * @param startX Left edge of the first item.
 * @param gap    Horizontal gap between items in px.
 * @param widths One width per item, in order.
 *
 * @example
 *   const [cancelX, okX] = stackH(centerX(modal.x, modal.width, 216), 8, 104, 104);
 */
export function stackH(startX: number, gap: number, ...widths: number[]): number[] {
  const positions: number[] = [];
  let cursor = startX;
  for (const w of widths) {
    positions.push(cursor);
    cursor += w + gap;
  }
  return positions;
}
