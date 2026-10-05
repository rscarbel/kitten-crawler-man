/**
 * Text painted into the game world: nameplates, floating combat numbers,
 * structure captions, prompts that hang over a tile. It works on a bare
 * canvas context in whatever space the caller is drawing (camera-relative
 * pixels, usually), and takes its looks from `WORLD_TEXT` in
 * `theme/worldInk.ts`.
 *
 * Text inside a UI surface uses the `text` widget instead. This painter also
 * serves screen-pixel text drawn outside any surface: the tutorial's hint
 * box, the labels inside preview scenes' art, item-icon stack counts and the
 * text painted inside explainer illustrations. It is the one other place,
 * beside that widget, that sets canvas text directly.
 *
 * `y` is the top of the first line unless `baseline` says otherwise. When
 * `width` is given the text wraps to it and `x` is the left edge of that
 * column, with `align` placing each line inside it; without `width`, `x` is
 * the alignment anchor, as with canvas `textAlign`.
 */

import { computeLineSpans } from '../../dialog/paginate';
import { digitCellWidth } from '../theme/fonts';
import {
  WORLD_TEXT,
  worldPalette,
  type WorldTextStyle,
  type WorldTextStyleId,
} from '../theme/worldInk';

export type WorldTextAlign = 'left' | 'center' | 'right';
export type WorldTextBaseline = 'top' | 'middle' | 'alphabetic';

export interface WorldTextOptions extends Partial<WorldTextStyle> {
  readonly x: number;
  readonly y: number;
  /** A named look, applied under any field given directly. Defaults to `plain`. */
  readonly style?: WorldTextStyleId;
  readonly italic?: boolean;
  /** Opacity, 0 to 1. */
  readonly alpha?: number;
  readonly outlineWidth?: number;
  /** A soft glow in the text's own colour, or in this one. */
  readonly glow?: boolean | string;
  readonly glowBlur?: number;
  /** A drop shadow in the default shadow colour, or in this one. Wins over `glow`. */
  readonly shadow?: boolean | string;
  readonly shadowOffset?: { readonly x: number; readonly y: number };
  readonly shadowBlur?: number;
  /** A rule through the middle of each line, in the text's colour or this one. */
  readonly strikethrough?: boolean | string;
  readonly align?: WorldTextAlign;
  /** What `y` names. Defaults to `top`. */
  readonly baseline?: WorldTextBaseline;
  /** Wrap to this width; `x` becomes the column's left edge. `\n` always breaks. */
  readonly width?: number;
  /** Set digits in equal-width cells, for numbers that change every frame. */
  readonly tabular?: boolean;
}

export interface WorldTextResult {
  /** Width of the widest line. */
  readonly width: number;
  /** Line count × line height. */
  readonly totalHeight: number;
  readonly lineCount: number;
}

/** Where a line's glyph ink starts and ends, in pixels below `y` for a top-baseline line. */
export interface WorldTextInkExtent {
  readonly top: number;
  readonly bottom: number;
}

const DEFAULT_OUTLINE_WIDTH = 3;
const DEFAULT_GLOW_BLUR = 12;
const DEFAULT_SHADOW_OFFSET = { x: 2, y: 2 } as const;
const DEFAULT_SHADOW_BLUR = 4;
const MIN_LINE_HEIGHT = 14;
const LINE_HEIGHT_MULTIPLIER = 1.4;
/** Where the strike rule sits between a line's top and the next line's top. */
const STRIKETHROUGH_CENTER_RATIO = 0.52;
const STRIKETHROUGH_THICKNESS_RATIO = 0.09;
const STRIKETHROUGH_MIN_THICKNESS = 1;
const BOLD_WEIGHT = 'bold';
const ITALIC_STYLE = 'italic';
const DIGIT = /[0-9]/;

type FontFields = Pick<WorldTextOptions, 'style' | 'size' | 'bold' | 'italic' | 'family'>;

interface ResolvedFont {
  readonly font: string;
  readonly size: number;
}

/**
 * Font strings by family, size and weight. World labels are drawn dozens of
 * times a frame across a handful of combinations, and building the string is
 * the allocation worth avoiding.
 */
const fontCache = new Map<string, Map<number, readonly [string, string]>>();

function fontString(family: string, size: number, bold: boolean, italic: boolean): string {
  let bySize = fontCache.get(family);
  if (bySize === undefined) {
    bySize = new Map();
    fontCache.set(family, bySize);
  }
  let byWeight = bySize.get(size);
  if (byWeight === undefined) {
    byWeight = [`${size}px ${family}`, `${BOLD_WEIGHT} ${size}px ${family}`];
    bySize.set(size, byWeight);
  }
  const base = bold ? byWeight[1] : byWeight[0];
  return italic ? `${ITALIC_STYLE} ${base}` : base;
}

function baseStyle(opts: Pick<WorldTextOptions, 'style'>): WorldTextStyle {
  return WORLD_TEXT[opts.style ?? 'plain'];
}

function resolveFont(opts: FontFields): ResolvedFont {
  const base = baseStyle(opts);
  const size = opts.size ?? base.size;
  return {
    size,
    font: fontString(
      opts.family ?? base.family,
      size,
      opts.bold ?? base.bold,
      opts.italic ?? false,
    ),
  };
}

/** The distance between line tops `worldText` uses for these options. */
export function worldLineHeight(
  opts: Pick<WorldTextOptions, 'style' | 'size' | 'lineHeight'>,
): number {
  const base = baseStyle(opts);
  const size = opts.size ?? base.size;
  // A named style's line height belongs to its size; a caller who resizes it gets one derived from the new size.
  const styleLineHeight = opts.size === undefined ? base.lineHeight : undefined;
  const derived = Math.max(MIN_LINE_HEIGHT, Math.ceil(size * LINE_HEIGHT_MULTIPLIER));
  return opts.lineHeight ?? styleLineHeight ?? derived;
}

function lineWidth(ctx: CanvasRenderingContext2D, line: string, digitCell: number | null): number {
  if (digitCell === null) return ctx.measureText(line).width;
  let width = 0;
  for (const char of line) {
    width += DIGIT.test(char) ? digitCell : ctx.measureText(char).width;
  }
  return width;
}

function splitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number | undefined,
  digitCell: number | null,
): string[] {
  if (width === undefined) return text.includes('\n') ? text.split('\n') : [text];
  const spans = computeLineSpans(text, width, (s) => lineWidth(ctx, s, digitCell));
  const lines = spans.map((span) => text.slice(span.offset, span.offset + span.length));
  return lines.length > 0 ? lines : [''];
}

/** Draws `line` with its left edge at `left`, every digit centred in a `digitCell`-wide cell. */
function paintTabularLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  left: number,
  y: number,
  digitCell: number,
  stroke: boolean,
): void {
  let x = left;
  for (const char of line) {
    const natural = ctx.measureText(char).width;
    const cell = DIGIT.test(char) ? digitCell : natural;
    const charX = x + (cell - natural) / 2;
    if (stroke) ctx.strokeText(char, charX, y);
    else ctx.fillText(char, charX, y);
    x += cell;
  }
}

function anchorFor(
  opts: Pick<WorldTextOptions, 'x' | 'width' | 'align'>,
  align: WorldTextAlign,
): number {
  if (opts.width === undefined) return opts.x;
  if (align === 'center') return opts.x + opts.width / 2;
  if (align === 'right') return opts.x + opts.width;
  return opts.x;
}

function leftEdge(anchor: number, align: WorldTextAlign, width: number): number {
  if (align === 'center') return anchor - width / 2;
  if (align === 'right') return anchor - width;
  return anchor;
}

/**
 * Paints `text` into the world. Saves and restores every bit of context state
 * it touches.
 */
export function worldText(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: WorldTextOptions,
): WorldTextResult {
  const base = baseStyle(opts);
  const { font, size } = resolveFont(opts);
  const color = opts.color ?? base.color;
  const outline = opts.outline ?? base.outline;
  const align = opts.align ?? 'left';
  const lineHeight = worldLineHeight(opts);
  const glow = opts.glow ?? false;
  const shadow = opts.shadow ?? false;
  const strikethrough = opts.strikethrough ?? false;

  ctx.save();
  ctx.font = font;
  ctx.textBaseline = opts.baseline ?? 'top';
  ctx.globalAlpha = opts.alpha ?? 1;
  const digitCell = opts.tabular === true ? digitCellWidth(ctx, font) : null;
  const lines = splitLines(ctx, text, opts.width, digitCell);

  if (shadow !== false) {
    ctx.shadowColor = typeof shadow === 'string' ? shadow : worldPalette.shadow;
    ctx.shadowBlur = opts.shadowBlur ?? DEFAULT_SHADOW_BLUR;
    const offset = opts.shadowOffset ?? DEFAULT_SHADOW_OFFSET;
    ctx.shadowOffsetX = offset.x;
    ctx.shadowOffsetY = offset.y;
  } else if (glow !== false) {
    ctx.shadowColor = typeof glow === 'string' ? glow : color;
    ctx.shadowBlur = opts.glowBlur ?? DEFAULT_GLOW_BLUR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  const anchor = anchorFor(opts, align);
  ctx.textAlign = digitCell === null ? align : 'left';
  let widest = 0;

  lines.forEach((line, index) => {
    const lineY = opts.y + index * lineHeight;
    const width = lineWidth(ctx, line, digitCell);
    widest = Math.max(widest, width);
    const left = leftEdge(anchor, align, width);
    const draw = (stroke: boolean): void => {
      if (digitCell !== null) paintTabularLine(ctx, line, left, lineY, digitCell, stroke);
      else if (stroke) ctx.strokeText(line, anchor, lineY);
      else ctx.fillText(line, anchor, lineY);
    };

    if (outline !== false) {
      // The outline goes on crisp: a glow or shadow under the stroke would blur its edge.
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = typeof outline === 'string' ? outline : worldPalette.outline;
      ctx.lineWidth = opts.outlineWidth ?? DEFAULT_OUTLINE_WIDTH;
      ctx.lineJoin = 'round';
      draw(true);
      ctx.restore();
    }

    ctx.fillStyle = color;
    draw(false);

    if (strikethrough !== false && line !== '') {
      const thickness = Math.max(
        STRIKETHROUGH_MIN_THICKNESS,
        Math.round(size * STRIKETHROUGH_THICKNESS_RATIO),
      );
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = typeof strikethrough === 'string' ? strikethrough : color;
      ctx.fillRect(left, lineY + size * STRIKETHROUGH_CENTER_RATIO, width, thickness);
      ctx.restore();
    }
  });

  ctx.restore();
  return { width: widest, totalHeight: lines.length * lineHeight, lineCount: lines.length };
}

/** What `worldText` would report for these options, without painting. */
export function measureWorldText(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: Omit<WorldTextOptions, 'x' | 'y'>,
): WorldTextResult {
  const { font } = resolveFont(opts);
  ctx.save();
  ctx.font = font;
  const digitCell = opts.tabular === true ? digitCellWidth(ctx, font) : null;
  const lines = splitLines(ctx, text, opts.width, digitCell);
  const widest = Math.max(0, ...lines.map((line) => lineWidth(ctx, line, digitCell)));
  ctx.restore();
  return {
    width: widest,
    totalHeight: lines.length * worldLineHeight(opts),
    lineCount: lines.length,
  };
}

/** The lines `text` breaks into at `width` under these font options. */
export function wrapWorldText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  opts: FontFields & Pick<WorldTextOptions, 'tabular'> = {},
): string[] {
  const { font } = resolveFont(opts);
  ctx.save();
  ctx.font = font;
  const digitCell = opts.tabular === true ? digitCellWidth(ctx, font) : null;
  const lines = splitLines(ctx, text, width, digitCell);
  ctx.restore();
  return lines;
}

/**
 * Where the ink of one line actually sits, for a top-baseline line drawn at
 * `y`. A font size names the em box, not the ink: a `!` starts below the em's
 * top and stops at the baseline, so anything that must clear the glyph itself
 * needs this rather than the size.
 */
export function worldTextInkExtent(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: FontFields = {},
): WorldTextInkExtent {
  const { font } = resolveFont(opts);
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'top';
  const metrics = ctx.measureText(text);
  ctx.restore();
  return { top: -metrics.actualBoundingBoxAscent, bottom: metrics.actualBoundingBoxDescent };
}
