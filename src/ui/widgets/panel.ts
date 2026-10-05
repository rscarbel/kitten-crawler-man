/**
 * The one container every menu is built in. A panel picks a width token and
 * the shell decides the rest: a centred glass card on a scrim on tablets and
 * desktops, a bottom sheet on phones for `md` and wider. Panels never
 * shrink-scale; body content that doesn't fit scrolls.
 *
 * A panel blocks its own frame, so nothing under it can be tapped through it.
 * With a scrim it also blocks the whole screen.
 *
 * The open animation (fade, and a scale from `OPEN_SCALE_FROM` or a slide for
 * a sheet) is applied to the context and left in place for the rest of the
 * surface's render, so everything drawn into `body` animates with the frame.
 * `UiRoot` restores the context after each surface.
 */

import type { SoundId } from '../../audio/sounds';
import { inset, splitH, type Rect, type Track } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import type { GlyphId } from '../theme/glyphs';
import { skinsFor, type ButtonVariant, type ControlSize } from '../theme/skins';
import { OPEN_SCALE_FROM, SHEET_MAX_HEIGHT_FRACTION, type PanelWidth } from '../theme/tokens';
import { button, measureButton } from './button';
import { iconButton } from './iconButton';
import { drawGlass, openProgress } from './paint';
import { scrollView } from './scrollView';
import { lineHeightOf, text } from './text';

export interface FooterButton {
  readonly id?: string;
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly icon?: GlyphId;
  readonly disabled?: boolean | string;
  /** Enter activates it when nothing else is focused. */
  readonly primary?: boolean;
  readonly sound?: SoundId | null;
  readonly onTap: () => void;
}

export interface PanelOptions {
  /** Unique within the surface; prefixes the ids of the header and footer controls. */
  readonly id: string;
  readonly title?: string;
  /** A short line under the title. */
  readonly subtitle?: string;
  readonly width: PanelWidth;
  /** `content` sizes to `contentHeight` (capped by the screen); `fill` takes all the height there is. */
  readonly height?: 'content' | 'fill';
  /** The body's natural height, for `height: 'content'` and for `scrollBody`. */
  readonly contentHeight?: number;
  /** Draws ✕ in the header. Escape is wired by the surface's own `close()`. */
  readonly onClose?: () => void;
  /** Draws a back chevron in the header, for drill-in navigation. */
  readonly onBack?: () => void;
  readonly footer?: readonly FooterButton[];
  /** `end` right-aligns footer buttons at their natural width; `fill` shares the row equally. Phones always fill. */
  readonly footerLayout?: 'end' | 'fill';
  readonly footerSize?: ControlSize;
  /** Wrap the body in a scroll view; requires `content` and `contentHeight`. */
  readonly scrollBody?: boolean;
  /** Draws the body. Optional unless `scrollBody`: callers may instead fill the returned `body`. */
  readonly content?: (body: Rect) => void;
  /** Dim and block everything beneath. Defaults to true. */
  readonly scrim?: boolean;
  /** Tapping the scrim calls this (usually the same as `onClose`). */
  readonly onScrimTap?: () => void;
  /** Tapping the card anywhere no control of its own sits calls this. Without it the card only swallows the tap. */
  readonly onCardTap?: () => void;
}

export interface PanelResult {
  /** The panel's whole outline. */
  readonly frame: Rect;
  /** Where content goes. With `scrollBody`, the visible window. */
  readonly body: Rect;
  /** Drawn as a bottom sheet rather than a centred card. */
  readonly sheet: boolean;
}

/** Fewest units of screen edge kept clear round a centred card. */
const CARD_MARGIN_REGULAR = 24;
const CARD_MARGIN_COMPACT = 12;
/** How far a sheet slides up while it opens. */
const SHEET_SLIDE = 24;
/** Narrowest a footer button is drawn on a card, so a lone "OK" is still a comfortable target. */
const FOOTER_MIN_BUTTON_WIDTH = 96;

/** Surfaces already given their open transform this frame, so a second panel doesn't compound it. */
const animated = new WeakSet<Ui>();

/** The chrome height a panel adds round its body: padding, header and footer. */
export function panelChromeHeight(
  ui: Ui,
  opts: Pick<PanelOptions, 'title' | 'subtitle' | 'footer' | 'footerSize' | 'onClose' | 'onBack'>,
): number {
  const skin = skinsFor(ui.theme).panel.card;
  const { space } = ui.theme;
  const header = headerHeight(ui, opts);
  const footer = footerHeight(ui, opts);
  return (
    skin.padding * 2 + (header > 0 ? header + space.md : 0) + (footer > 0 ? footer + space.lg : 0)
  );
}

function footerHeight(ui: Ui, opts: Pick<PanelOptions, 'footer' | 'footerSize'>): number {
  if (opts.footer === undefined || opts.footer.length === 0) return 0;
  return skinsFor(ui.theme).controlSize[opts.footerSize ?? 'md'].height;
}

function headerHeight(
  ui: Ui,
  opts: Pick<PanelOptions, 'title' | 'subtitle' | 'onClose' | 'onBack'>,
): number {
  const hasHeader =
    opts.title !== undefined || opts.onClose !== undefined || opts.onBack !== undefined;
  if (!hasHeader) return 0;
  const titleBlock =
    lineHeightOf(ui, 'title') + (opts.subtitle === undefined ? 0 : lineHeightOf(ui, 'caption'));
  return Math.max(ui.theme.size.control, titleBlock);
}

function isSheet(ui: Ui, width: PanelWidth): boolean {
  return ui.size === 'compact' && width !== 'sm';
}

function cardMargin(ui: Ui): number {
  return ui.size === 'compact' ? CARD_MARGIN_COMPACT : CARD_MARGIN_REGULAR;
}

function cardWidth(ui: Ui, width: PanelWidth): number {
  return Math.min(ui.theme.panelWidth[width], ui.viewport.w - cardMargin(ui) * 2);
}

function frameMaxHeight(ui: Ui, width: PanelWidth): number {
  return isSheet(ui, width)
    ? ui.viewport.h * SHEET_MAX_HEIGHT_FRACTION
    : ui.viewport.h - cardMargin(ui) * 2;
}

/** The width a panel of `width` gives its body on this viewport. */
export function panelBodyWidth(ui: Ui, width: PanelWidth): number {
  const frameW = isSheet(ui, width) ? ui.viewport.w : cardWidth(ui, width);
  return frameW - skinsFor(ui.theme).panel.card.padding * 2;
}

/** The tallest body a panel with these options can show before its content must scroll. */
export function panelBodyMaxHeight(
  ui: Ui,
  opts: Pick<
    PanelOptions,
    'width' | 'title' | 'subtitle' | 'footer' | 'footerSize' | 'onClose' | 'onBack'
  >,
): number {
  return Math.max(0, frameMaxHeight(ui, opts.width) - panelChromeHeight(ui, opts));
}

export function panel(ui: Ui, opts: PanelOptions): PanelResult {
  const { theme, ctx } = ui;
  const skins = skinsFor(theme);
  const skin = skins.panel.card;
  const compact = ui.size === 'compact';
  const sheet = isSheet(ui, opts.width);
  const view = ui.viewport;
  const chrome = panelChromeHeight(ui, opts);
  const progress = openProgress(ui);

  let frame: Rect;
  let content: Rect;
  const maxH = frameMaxHeight(ui, opts.width);
  if (sheet) {
    const screen = ui.screen;
    const bottomInset = screen.y + screen.h - (view.y + view.h);
    const naturalH =
      opts.height === 'fill' ? maxH : Math.min(maxH, chrome + (opts.contentHeight ?? 0));
    frame = { x: screen.x, y: view.y + view.h - naturalH, w: screen.w, h: naturalH + bottomInset };
    content = inset({ x: view.x, y: frame.y, w: view.w, h: naturalH }, skin.padding);
  } else {
    const w = cardWidth(ui, opts.width);
    const h = opts.height === 'fill' ? maxH : Math.min(maxH, chrome + (opts.contentHeight ?? 0));
    frame = { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h };
    content = inset(frame, skin.padding);
  }

  if (opts.scrim !== false) {
    ctx.save();
    ctx.globalAlpha *= progress;
    ctx.fillStyle = skins.scrim;
    ctx.fillRect(ui.screen.x, ui.screen.y, ui.screen.w, ui.screen.h);
    ctx.restore();
    if (opts.onScrimTap !== undefined) {
      const onScrimTap = opts.onScrimTap;
      ui.hit(`${opts.id}/scrim`, ui.screen, {
        onTap: () => onScrimTap(),
        focusable: false,
        sound: null,
      });
    } else {
      ui.block(ui.screen);
    }
  }

  if (!animated.has(ui) && progress < 1) {
    animated.add(ui);
    ctx.globalAlpha *= progress;
    if (sheet) {
      ctx.translate(0, (1 - progress) * SHEET_SLIDE);
    } else {
      const scale = OPEN_SCALE_FROM + (1 - OPEN_SCALE_FROM) * progress;
      const cx = frame.x + frame.w / 2;
      const cy = frame.y + frame.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }
  }

  const onCardTap = opts.onCardTap;
  if (onCardTap === undefined) {
    ui.block(frame);
  } else {
    ui.hit(`${opts.id}/card`, frame, { onTap: () => onCardTap(), focusable: false, sound: null });
  }
  const radius = sheet ? { tl: skin.radius, tr: skin.radius, br: 0, bl: 0 } : skin.radius;
  drawGlass(ui, frame, skin, radius);

  let cursorY = content.y;
  const headerH = headerHeight(ui, opts);
  if (headerH > 0) {
    drawHeader(ui, { x: content.x, y: cursorY, w: content.w, h: headerH }, opts);
    cursorY += headerH + theme.space.md;
  }

  const footer = opts.footer ?? [];
  const footerH = footerHeight(ui, opts);
  const bodyBottom = content.y + content.h - (footerH > 0 ? footerH + theme.space.lg : 0);
  const body: Rect = {
    x: content.x,
    y: cursorY,
    w: content.w,
    h: Math.max(0, bodyBottom - cursorY),
  };

  if (footerH > 0) {
    drawFooter(
      ui,
      { x: content.x, y: content.y + content.h - footerH, w: content.w, h: footerH },
      opts.id,
      footer,
      {
        fill: compact || opts.footerLayout === 'fill',
        size: opts.footerSize ?? 'md',
      },
    );
  }

  const draw = opts.content;
  if (draw !== undefined) {
    if (opts.scrollBody === true) {
      scrollView(ui, body, {
        id: `${opts.id}/body`,
        contentHeight: opts.contentHeight ?? body.h,
        draw,
      });
    } else {
      draw(body);
    }
  }

  return { frame, body, sheet };
}

function drawHeader(ui: Ui, header: Rect, opts: PanelOptions): void {
  const side = ui.theme.size.control;
  let titleRect = header;
  const onBack = opts.onBack;
  if (onBack !== undefined) {
    iconButton(
      ui,
      { x: header.x, y: header.y, w: side, h: side },
      {
        id: `${opts.id}/back`,
        icon: 'back',
        label: 'Back',
        onTap: () => onBack(),
      },
    );
    titleRect = inset(titleRect, { l: side + ui.theme.space.sm });
  }
  const onClose = opts.onClose;
  if (onClose !== undefined) {
    iconButton(
      ui,
      { x: header.x + header.w - side, y: header.y, w: side, h: side },
      {
        id: `${opts.id}/close`,
        icon: 'close',
        label: 'Close',
        onTap: () => onClose(),
      },
    );
    titleRect = inset(titleRect, { r: side + ui.theme.space.sm });
  }
  if (opts.title === undefined) return;
  const titleH = lineHeightOf(ui, 'title');
  const subtitleH = opts.subtitle === undefined ? 0 : lineHeightOf(ui, 'caption');
  const top = titleRect.y + (Math.min(titleRect.h, side) - titleH - subtitleH) / 2;
  text(
    ui,
    { x: titleRect.x, y: top, w: titleRect.w, h: titleH },
    { text: opts.title, role: 'title' },
  );
  if (opts.subtitle !== undefined) {
    text(
      ui,
      { x: titleRect.x, y: top + titleH, w: titleRect.w, h: subtitleH },
      {
        text: opts.subtitle,
        role: 'caption',
      },
    );
  }
}

function drawFooter(
  ui: Ui,
  footer: Rect,
  panelId: string,
  buttons: readonly FooterButton[],
  layout: { readonly fill: boolean; readonly size: ControlSize },
): void {
  const gap = ui.theme.space.sm;
  const natural = buttons.map((b) =>
    Math.max(FOOTER_MIN_BUTTON_WIDTH, measureButton(ui, { ...b, size: layout.size })),
  );
  const naturalTotal = natural.reduce((sum, w) => sum + w, 0) + gap * (buttons.length - 1);
  const stretch = layout.fill || naturalTotal > footer.w;
  const widths: readonly Track[] = stretch ? buttons.map((): Track => 'fill') : natural;
  const rowW = stretch ? footer.w : naturalTotal;
  const row: Rect = { ...footer, x: footer.x + footer.w - rowW, w: rowW };
  const cells = splitH(row, widths, gap);
  buttons.forEach((b, index) => {
    const cell = cells[index];
    button(ui, cell, { ...b, size: layout.size, id: `${panelId}/${b.id ?? b.label}` });
  });
}
