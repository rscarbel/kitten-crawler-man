/**
 * Shared pieces for the "how it works" explainers and the other paged
 * tutorials: the page content they are written as, and turning it into
 * `pagedOverlay` pages whose illustrations keep their design proportions.
 */

import type { Rect } from '../../core/geom';
import type { IllustrationPainter, IllustrationRect } from '../../icons/explainerArt/illustration';
import type { PagedOverlayPage } from '../../widgets/pagedOverlay';

/** One explainer page as written: a subtitle, its paragraphs and its illustration. */
export interface ExplainerPageContent {
  readonly subtitle: string;
  readonly lines: readonly string[];
  readonly drawIllustration: IllustrationPainter;
}

/** The smallest band an illustration is laid out in; a bigger band is scaled to, a wider one spreads the scene sideways. */
export interface DesignSize {
  readonly width: number;
  readonly height: number;
}

/** The band the craft explainers' illustrations were painted for. */
export const EXPLAINER_DESIGN: DesignSize = { width: 504, height: 190 };

/** How tall an explainer's illustration is asked to be; the overlay caps it on short screens. */
export const EXPLAINER_ILLUSTRATION_HEIGHT = 250;

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

/** Frames of a 60 Hz animation that `ms` milliseconds cover. */
export function framesIn(ms: number): number {
  return Math.floor((ms / MS_PER_SECOND) * FRAMES_PER_SECOND);
}

/**
 * Paints `painter` into `rect` scaled uniformly so its design band fits.
 * `spread` hands it a band at least the design size and as wide or tall as
 * the rect's aspect allows; `contain` hands it exactly the design band,
 * centred, for a layout that must keep its proportions.
 */
export function paintInDesignSpace(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  design: DesignSize,
  pageMs: number,
  painter: IllustrationPainter,
  fit: 'spread' | 'contain' = 'spread',
): void {
  const scale = Math.min(rect.w / design.width, rect.h / design.height);
  if (scale <= 0) return;
  const spread = fit === 'spread';
  const width = spread ? rect.w / scale : design.width;
  const height = spread ? rect.h / scale : design.height;
  const band: IllustrationRect = { x: 0, y: 0, width, height };
  ctx.save();
  ctx.translate(rect.x + (rect.w - width * scale) / 2, rect.y + (rect.h - height * scale) / 2);
  ctx.scale(scale, scale);
  painter(ctx, band, framesIn(pageMs));
  ctx.restore();
}

/** An explainer page as a `pagedOverlay` page, paragraphs on their own lines. */
export function explainerPage(
  content: ExplainerPageContent,
  design: DesignSize = EXPLAINER_DESIGN,
): PagedOverlayPage {
  return {
    title: content.subtitle,
    body: content.lines.join('\n'),
    illustration: {
      height: EXPLAINER_ILLUSTRATION_HEIGHT,
      paint: (ctx, rect, _now, pageMs) =>
        paintInDesignSpace(ctx, rect, design, pageMs, content.drawIllustration),
    },
  };
}

/** One "how it works" explainer, as `CraftExplainers` hosts it. */
export interface ExplainerEntry {
  /** The header over every page. */
  readonly title: string;
  /** Built afresh on every open, so key labels follow the live bindings and touch screens get touch wording. */
  readonly pages: (touch: boolean) => readonly PagedOverlayPage[];
  /** Runs as it opens, before the first page is drawn. */
  readonly onOpen?: () => void;
}

/** A widget rect as the band an illustration painter takes. */
export function illustrationBand(rect: Rect): IllustrationRect {
  return { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
}
