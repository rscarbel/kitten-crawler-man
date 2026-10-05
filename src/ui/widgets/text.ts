/**
 * Every string the UI draws goes through this module: one type ramp, word
 * wrap, alignment, ellipsis, letter spacing and tabular digits. It is the only
 * place in `src/ui/` outside the theme that touches canvas text directly.
 */

import type { Rect } from '../core/geom';
import type { PaintTarget } from './paint';
import { digitCellWidth, onUiFontLoaded } from '../theme/fonts';
import { skinsFor, type TextRole } from '../theme/skins';
import { fontFor, type Theme, type TypeStyle } from '../theme/tokens';

export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'middle' | 'bottom';

export interface TextOptions {
  readonly text: string;
  /** A text skin; its style and colour apply unless overridden. Defaults to `body`. */
  readonly role?: TextRole;
  readonly style?: TypeStyle;
  /** A palette or skin colour. */
  readonly color?: string;
  readonly align?: TextAlign;
  /** Defaults to `top` when wrapping and `middle` otherwise. */
  readonly valign?: TextVAlign;
  /** Break into lines no wider than the rect. Without it, a long line ends in an ellipsis. */
  readonly wrap?: boolean;
  /** With `wrap`, the most lines drawn; the last one ends in an ellipsis when text is left over. */
  readonly maxLines?: number;
  /** Set digits in equal-width cells, for numbers that change every frame. */
  readonly tabular?: boolean;
  /** A dark outline for text drawn over art (item quantities). */
  readonly halo?: string;
}

export interface TextResult {
  /** Width of the widest drawn line. */
  readonly width: number;
  readonly height: number;
  readonly lines: number;
  readonly truncated: boolean;
}

const ELLIPSIS = '…';
/**
 * A string measured for a rect and then laid into exactly that rect can come
 * back a hair wider from float rounding; it still fits.
 */
const FIT_TOLERANCE = 0.5;
/** Below this, letter spacing is invisible at UI sizes and the string is drawn whole, keeping kerning. */
const MIN_VISIBLE_LETTER_SPACING = 0.5;
/** Halo stroke width as a fraction of the font size. */
const HALO_WIDTH_RATIO = 0.22;

/** The style and colour a set of options resolves to. */
export interface ResolvedText {
  readonly style: TypeStyle;
  readonly color: string;
  readonly font: string;
}

export function resolveText(
  theme: Theme,
  opts: Pick<TextOptions, 'role' | 'style' | 'color'>,
): ResolvedText {
  const skin = skinsFor(theme).text[opts.role ?? 'body'];
  const style = opts.style ?? skin.style;
  return { style, color: opts.color ?? skin.color, font: fontFor(style, theme.fontFamily) };
}

function shown(text: string, style: TypeStyle): string {
  return style.upper === true ? text.toUpperCase() : text;
}

function spacingOf(style: TypeStyle): number {
  const spacing = style.letterSpacing ?? 0;
  return spacing >= MIN_VISIBLE_LETTER_SPACING ? spacing : 0;
}

const DIGIT = /[0-9]/;

/** Widths measured so far, by font, spacing, digit cell and string; the oldest go first past the cap. */
const measured = new Map<string, number>();
/** Enough for every string a HUD and a menu show at once, many times over. */
const MEASURE_CACHE_SIZE = 4096;
onUiFontLoaded(() => measured.clear());

/** Width of `text` in the context's current font, honouring spacing and tabular digits. */
function lineWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
  digitCell: number | null,
): number {
  const key = `${ctx.font}|${spacing}|${digitCell ?? ''}|${text}`;
  const known = measured.get(key);
  if (known !== undefined) return known;
  const width = measureLine(ctx, text, spacing, digitCell);
  measured.set(key, width);
  if (measured.size > MEASURE_CACHE_SIZE) {
    const oldest = measured.keys().next();
    if (oldest.done !== true) measured.delete(oldest.value);
  }
  return width;
}

function measureLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
  digitCell: number | null,
): number {
  if (spacing === 0 && digitCell === null) return ctx.measureText(text).width;
  let width = 0;
  for (const char of text) {
    width += digitCell !== null && DIGIT.test(char) ? digitCell : ctx.measureText(char).width;
  }
  return width + spacing * Math.max(0, Array.from(text).length - 1);
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  left: number,
  middleY: number,
  spacing: number,
  digitCell: number | null,
  halo: boolean,
): void {
  const draw = (chunk: string, x: number): void => {
    if (halo) ctx.strokeText(chunk, x, middleY);
    ctx.fillText(chunk, x, middleY);
  };
  if (spacing === 0 && digitCell === null) {
    draw(text, left);
    return;
  }
  let x = left;
  for (const char of text) {
    const natural = ctx.measureText(char).width;
    const isDigitCell = digitCell !== null && DIGIT.test(char);
    const cell = isDigitCell ? digitCell : natural;
    draw(char, x + (cell - natural) / 2);
    x += cell + spacing;
  }
}

function fitWithEllipsis(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth + FIT_TOLERANCE) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`;
    if (measure(candidate) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? ELLIPSIS : `${chars.slice(0, low).join('').trimEnd()}${ELLIPSIS}`;
}

/** Splits `text` into lines no wider than `maxWidth`; `\n` always breaks. Words wider than a line break by character. */
export function wrapToWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') lines.push(current);
      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }
      let piece = '';
      for (const char of word) {
        if (measure(piece + char) > maxWidth && piece !== '') {
          lines.push(piece);
          piece = char;
        } else {
          piece += char;
        }
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines;
}

interface LaidOut {
  readonly lines: readonly string[];
  readonly widths: readonly number[];
  readonly truncated: boolean;
  readonly resolved: ResolvedText;
  readonly spacing: number;
  readonly digitCell: number | null;
}

function layout(ui: PaintTarget, width: number, opts: TextOptions): LaidOut {
  const { ctx } = ui;
  const resolved = resolveText(ui.theme, opts);
  const spacing = spacingOf(resolved.style);
  const digitCell = opts.tabular === true ? digitCellWidth(ctx, resolved.font) : null;
  ctx.save();
  ctx.font = resolved.font;
  const measure = (s: string): number => lineWidth(ctx, s, spacing, digitCell);
  const content = shown(opts.text, resolved.style);
  let lines: string[];
  let truncated = false;
  if (opts.wrap === true) {
    lines = wrapToWidth(content, width, measure);
    const maxLines = opts.maxLines;
    if (maxLines !== undefined && lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      const lastIndex = kept.length - 1;
      kept[lastIndex] = fitWithEllipsis(`${kept[lastIndex]}${ELLIPSIS}`, width, measure);
      lines = kept;
      truncated = true;
    }
  } else {
    const fitted = fitWithEllipsis(content, width, measure);
    truncated = fitted !== content;
    lines = [fitted];
  }
  const widths = lines.map(measure);
  ctx.restore();
  return { lines, widths, truncated, resolved, spacing, digitCell };
}

/** Draws text into `rect`. */
export function text(ui: PaintTarget, rect: Rect, opts: TextOptions): TextResult {
  const laid = layout(ui, rect.w, opts);
  const { ctx } = ui;
  const { style, color, font } = laid.resolved;
  const blockHeight = laid.lines.length * style.lineHeight;
  const valign = opts.valign ?? (opts.wrap === true ? 'top' : 'middle');
  const top =
    valign === 'top'
      ? rect.y
      : valign === 'bottom'
        ? rect.y + rect.h - blockHeight
        : rect.y + (rect.h - blockHeight) / 2;
  const align = opts.align ?? 'left';
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const halo = opts.halo !== undefined;
  if (opts.halo !== undefined) {
    ctx.strokeStyle = opts.halo;
    ctx.lineWidth = style.size * HALO_WIDTH_RATIO;
    ctx.lineJoin = 'round';
  }
  laid.lines.forEach((line, index) => {
    const width = laid.widths[index] ?? 0;
    const left =
      align === 'left'
        ? rect.x
        : align === 'right'
          ? rect.x + rect.w - width
          : rect.x + (rect.w - width) / 2;
    const middle = top + index * style.lineHeight + style.lineHeight / 2;
    paintLine(ctx, line, left, middle, laid.spacing, laid.digitCell, halo);
  });
  ctx.restore();
  return {
    width: Math.max(0, ...laid.widths),
    height: blockHeight,
    lines: laid.lines.length,
    truncated: laid.truncated,
  };
}

/** A number (or a string of digits and punctuation) with every digit in an equal-width cell. */
export function tabularNumber(
  ui: PaintTarget,
  rect: Rect,
  opts: Omit<TextOptions, 'text' | 'tabular' | 'wrap' | 'maxLines'> & {
    readonly value: number | string;
  },
): TextResult {
  return text(ui, rect, { ...opts, text: String(opts.value), tabular: true });
}

/** Width of `content` on one line, unwrapped and untruncated. */
export function measureText(
  ui: PaintTarget,
  content: string,
  opts: Pick<TextOptions, 'role' | 'style' | 'tabular'> = {},
): number {
  const resolved = resolveText(ui.theme, opts);
  const { ctx } = ui;
  const digitCell = opts.tabular === true ? digitCellWidth(ctx, resolved.font) : null;
  ctx.save();
  ctx.font = resolved.font;
  const width = lineWidth(
    ctx,
    shown(content, resolved.style),
    spacingOf(resolved.style),
    digitCell,
  );
  ctx.restore();
  return width;
}

/** Height `content` takes when wrapped to `width`. */
export function measureTextHeight(
  ui: PaintTarget,
  width: number,
  opts: Omit<TextOptions, 'wrap' | 'align' | 'valign' | 'color' | 'halo'>,
): number {
  const laid = layout(ui, width, { ...opts, wrap: true });
  return laid.lines.length * laid.resolved.style.lineHeight;
}

/** One line's height for a role, for sizing rows round a label. */
export function lineHeightOf(ui: PaintTarget, role: TextRole): number {
  return skinsFor(ui.theme).text[role].style.lineHeight;
}
