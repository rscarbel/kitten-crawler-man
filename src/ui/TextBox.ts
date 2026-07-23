/**
 * Unified text rendering for canvas. drawText() replaces direct ctx text calls.
 *
 * Key design principles:
 *   - y is always the TOP of the first line — no baseline math needed
 *   - Word-wrap is automatic when width is given (supports \n too)
 *   - Scrolling works out of the box when both width + height are given
 *   - All ctx state is saved/restored — zero side effects
 *
 * @example Minimal label
 *   drawText(ctx, "Score: 100", { x: 16, y: 28 });
 *
 * @example Bold gold value
 *   drawText(ctx, `${coins} coins`, { x: 16, y: 185, size: 13, bold: true, color: '#facc15' });
 *
 * @example Readable text over the game world (outline keeps it legible on any tile)
 *   drawText(ctx, mobName, { x, y, outline: true, ...TEXT_PRESETS.label });
 *
 * @example Scrollable description box with background
 *   const { scrollMax } = drawText(ctx, item.description, {
 *     x: px, y: py, width: 200, height: 120, padding: 8,
 *     background: 'rgba(8,10,20,0.97)', border: '#3b82f6',
 *     scrollY: this.scrollOffset,
 *   });
 *   this.scrollOffset = Math.min(this.scrollOffset, scrollMax);
 */

const DEFAULT_FONT_SIZE = 12;
const DEFAULT_OUTLINE_WIDTH = 3;
const DEFAULT_GLOW_BLUR = 12;
const DEFAULT_SHADOW_OFFSET_X = 2;
const DEFAULT_SHADOW_OFFSET_Y = 2;
const DEFAULT_SHADOW_BLUR_PX = 4;
const DEFAULT_BORDER_WIDTH = 1.5;
const MIN_LINE_HEIGHT = 14;
const LINE_HEIGHT_MULTIPLIER = 1.4;

/** All options accepted by drawText. Only x and y are required. */
export interface TextOptions {
  /** Left edge of the text anchor (standard canvas textAlign rules apply when no width is set). */
  x: number;
  /** Top edge of the first line of text. y always refers to the top — no baseline arithmetic needed. */
  y: number;

  /** Font size in px. Default: 12 */
  size?: number;
  /** Bold weight. Default: false */
  bold?: boolean;
  /** Font family. Default: 'monospace' */
  font?: string;
  /** Text fill color — any CSS color string. Default: '#e2e8f0' */
  color?: string;
  /** Opacity 0–1. Default: 1 */
  alpha?: number;
  /**
   * Contrasting stroke behind text — keeps text readable on any background.
   *   true           → near-black stroke
   *   '#rrggbb'/rgba → custom stroke color
   */
  outline?: boolean | string;
  /** Stroke width for outline. Default: 3 */
  outlineWidth?: number;
  /**
   * Radial glow — for magical, highlighted, or boss text.
   *   true           → glow using the text's own color
   *   '#rrggbb'/rgba → custom glow color
   */
  glow?: boolean | string;
  /** Glow blur radius in px. Default: 12 */
  glowBlur?: number;
  /**
   * Directional drop shadow for depth.
   *   true           → semi-transparent black shadow
   *   '#rrggbb'/rgba → custom shadow color
   */
  shadow?: boolean | string;
  /** Drop shadow pixel offset. Default: { x: 2, y: 2 } */
  shadowOffset?: { readonly x: number; readonly y: number };
  /** Drop shadow blur radius in px. Default: 4 */
  shadowBlurPx?: number;
  /** Horizontal alignment. Default: 'left' */
  align?: 'left' | 'center' | 'right';
  /**
   * Maximum content width in px. Enables automatic word-wrap.
   * Also required for: padding, height/scrollY, background, border.
   */
  width?: number;
  /** Distance between line tops in px. Default: size × 1.4, minimum 14 */
  lineHeight?: number;
  /** Inner padding on all sides — only active when width is set. Default: 0 */
  padding?: number;
  /**
   * Clips visible content to this height. Use scrollY to offset.
   * drawText returns scrollMax so you can clamp scrollY after the call.
   */
  height?: number;
  /** Vertical scroll offset in px. Default: 0 */
  scrollY?: number;
  /** Fill a rect behind the text box. Only drawn when width is set. */
  background?: string;
  /** Stroke a border around the text box. Only drawn when width is set. */
  border?: string;
  /** Border stroke width. Default: 1.5 */
  borderWidth?: number;
}

/** Return value from drawText — use for flow layout or scroll clamping. */
export interface TextResult {
  /** Full content height: (lineCount × lineHeight) + (2 × padding). */
  totalHeight: number;
  /** Number of lines after word-wrap expansion. */
  lineCount: number;
  /**
   * Maximum useful scrollY: max(0, totalHeight − height).
   * Zero when no height is set. Clamp your scrollY to this value.
   *
   * @example
   *   const { scrollMax } = drawText(ctx, text, opts);
   *   this.scroll = Math.min(this.scroll, scrollMax);
   */
  scrollMax: number;
}

/**
 * Ready-made partial styles for common use cases. Spread into drawText options.
 *
 * @example
 *   drawText(ctx, "Level Up!", { x, y, align: 'center', ...TEXT_PRESETS.title, glow: '#ffd700' });
 *   drawText(ctx, hint,        { x: 16, y: 46, ...TEXT_PRESETS.hint });
 */
export const TEXT_PRESETS = {
  /** Small readable label — outline keeps it legible on any tile or background. */
  label: { size: 11, color: '#e2e8f0', outline: true },
  /** Dimmed hint or secondary info. */
  hint: { size: 10, color: '#94a3b8' },
  /** Bold UI section heading. */
  heading: { size: 13, bold: true, color: '#e2e8f0' },
  /** Gold highlighted value — XP, coins, stats. */
  value: { size: 12, bold: true, color: '#facc15' },
  /** Green positive / success text. */
  success: { size: 12, color: '#4ade80' },
  /** Red danger / negative text. */
  danger: { size: 12, bold: true, color: '#ef4444' },
  /** Large title — readable over any background. */
  title: { size: 20, bold: true, color: '#f1f5f9', outline: true },
  /** Small tooltip body. */
  tooltip: { size: 10, color: '#cbd5e1', lineHeight: 14 },
  /** Very small controls/help text. */
  controls: { size: 9, color: '#64748b' },
  /** Muted stat/description text inside panels. */
  muted: { size: 10, color: '#64748b' },
  /** Blue human-player accent. */
  human: { size: 12, color: '#93c5fd' },
  /** Orange cat-player accent. */
  cat: { size: 12, color: '#fb923c' },
  /** Purple ability / legendary text. */
  ability: { size: 11, color: '#c084fc' },
} satisfies Record<string, Partial<Omit<TextOptions, 'x' | 'y'>>>;

function buildFontString(size: number, bold: boolean, font: string): string {
  return `${bold ? 'bold ' : ''}${size}px ${font}`;
}

/**
 * Word-wrap `text` to `maxWidth` under the ctx's current font, honoring explicit
 * `\n` breaks. Set the font before calling. Useful for measuring how tall a block
 * of text will be (line count) so a container can be sized before it's drawn.
 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return computeWrappedLines(ctx, text, maxWidth);
}

function computeWrappedLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      result.push('');
      continue;
    }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && current !== '') {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current !== '') result.push(current);
  }
  return result.length > 0 ? result : [''];
}

function resolveLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  innerW: number | undefined,
): string[] {
  return innerW !== undefined ? computeWrappedLines(ctx, text, innerW) : text.split('\n');
}

/**
 * Draw text on a 2D canvas context.
 *
 * Saves and restores all ctx state — this function has zero side effects.
 * y always refers to the TOP of the first line, regardless of font metrics.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: TextOptions,
): TextResult {
  const {
    x,
    y,
    size = DEFAULT_FONT_SIZE,
    bold = false,
    font = 'monospace',
    color = '#e2e8f0',
    alpha = 1,
    outline = false,
    outlineWidth = DEFAULT_OUTLINE_WIDTH,
    glow = false,
    glowBlur = DEFAULT_GLOW_BLUR,
    shadow = false,
    shadowOffset = { x: DEFAULT_SHADOW_OFFSET_X, y: DEFAULT_SHADOW_OFFSET_Y },
    shadowBlurPx = DEFAULT_SHADOW_BLUR_PX,
    align = 'left',
    width,
    padding = 0,
    height,
    scrollY = 0,
    background,
    border,
    borderWidth = DEFAULT_BORDER_WIDTH,
  } = opts;

  const lineHeight =
    opts.lineHeight ?? Math.max(MIN_LINE_HEIGHT, Math.ceil(size * LINE_HEIGHT_MULTIPLIER));
  const fontStr = buildFontString(size, bold, font);

  ctx.save();
  ctx.font = fontStr;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = alpha;

  const innerW = width !== undefined ? width - padding * 2 : undefined;
  const lines = resolveLines(ctx, text, innerW);

  const totalHeight = lines.length * lineHeight + padding * 2;
  const scrollMax = height !== undefined ? Math.max(0, totalHeight - height) : 0;

  if (width !== undefined) {
    const boxH = height ?? totalHeight;
    if (background !== undefined) {
      ctx.fillStyle = background;
      ctx.fillRect(x, y, width, boxH);
    }
    if (border !== undefined) {
      ctx.strokeStyle = border;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(x, y, width, boxH);
    }
  }

  if (height !== undefined && width !== undefined) {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  const resolvedGlowColor = typeof glow === 'string' ? glow : color;
  const resolvedOutlineColor = typeof outline === 'string' ? outline : 'rgba(0,0,0,0.9)';
  const resolvedShadowColor = typeof shadow === 'string' ? shadow : 'rgba(0,0,0,0.75)';

  if (shadow) {
    ctx.shadowColor = resolvedShadowColor;
    ctx.shadowBlur = shadowBlurPx;
    ctx.shadowOffsetX = shadowOffset.x;
    ctx.shadowOffsetY = shadowOffset.y;
  } else if (glow) {
    ctx.shadowColor = resolvedGlowColor;
    ctx.shadowBlur = glowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  let lineX: number;
  if (width !== undefined) {
    // x is the left edge of the box; anchor adjusts per alignment within content area
    ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    lineX =
      align === 'center' ? x + width / 2 : align === 'right' ? x + width - padding : x + padding;
  } else {
    // x is the alignment anchor directly (standard canvas behavior)
    ctx.textAlign = align;
    lineX = x;
  }

  const contentTop = y + padding - scrollY;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ly = contentTop + i * lineHeight;

    if (outline) {
      // Stroke pass — disable shadow so the outline edge is crisp, not blurry
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = resolvedOutlineColor;
      ctx.lineWidth = outlineWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, lineX, ly);
      ctx.restore(); // restores shadow/glow state for the fill pass below
    }

    ctx.fillStyle = color;
    ctx.fillText(line, lineX, ly);
  }

  ctx.restore();

  return { totalHeight, lineCount: lines.length, scrollMax };
}

/**
 * Measure how tall a block of text would be without rendering anything.
 * Useful for centering text vertically or checking overflow before drawing.
 *
 * @example
 *   const { totalHeight } = measureTextBox(ctx, desc, { width: 200, padding: 8, size: 11 });
 *   const centeredY = panelY + (panelH - totalHeight) / 2;
 *   drawText(ctx, desc, { x, y: centeredY, width: 200, padding: 8, size: 11 });
 */
export function measureTextBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: Pick<TextOptions, 'size' | 'bold' | 'font' | 'width' | 'padding' | 'lineHeight' | 'height'>,
): TextResult {
  const size = opts.size ?? DEFAULT_FONT_SIZE;
  const bold = opts.bold ?? false;
  const font = opts.font ?? 'monospace';
  const lineHeight =
    opts.lineHeight ?? Math.max(MIN_LINE_HEIGHT, Math.ceil(size * LINE_HEIGHT_MULTIPLIER));
  const padding = opts.padding ?? 0;
  const { width, height } = opts;

  ctx.save();
  ctx.font = buildFontString(size, bold, font);

  const innerW = width !== undefined ? width - padding * 2 : undefined;
  const lines = resolveLines(ctx, text, innerW);

  ctx.restore();

  const totalHeight = lines.length * lineHeight + padding * 2;
  const scrollMax = height !== undefined ? Math.max(0, totalHeight - height) : 0;

  return { totalHeight, lineCount: lines.length, scrollMax };
}
