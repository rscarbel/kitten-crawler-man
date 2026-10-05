/**
 * A multi-page explainer: how-to-play, rules sheets, tutorials, readable
 * notes. Each page has a title, a body and an optional illustration painted
 * every frame. Back / Next / Done sit in the footer with page dots between.
 *
 * Explainers are config objects ({@link PagedOverlayConfig}) mounted through
 * {@link pagedOverlaySurface}; the left and right arrows turn pages.
 */

import type { SoundId } from '../../audio/sounds';
import { centerIn, splitH, splitV, type Rect } from '../core/geom';
import type { Band, Surface, Ui } from '../core/UiRoot';
import type { PanelWidth } from '../theme/tokens';
import { button, measureButton } from './button';
import { fillRounded, roundRectPath } from './paint';
import { panel } from './panel';
import { scrollView } from './scrollView';
import { lineHeightOf, measureTextHeight, text } from './text';

export interface PagedOverlayPage {
  readonly title: string;
  /** Small spaced capitals above the title. */
  readonly overline?: string;
  /** Paragraphs separated by `\n`. */
  readonly body: string;
  readonly illustration?: {
    readonly height: number;
    /**
     * Width over height the art reads best at in a column of its own. Given,
     * a landscape screen too short for the art above the text puts it beside
     * the text instead, in a column no wider than this asks; without it the
     * art shrinks above the text, or is dropped.
     */
    readonly aspect?: number;
    /** `pageMs` is how long this page has been showing, so an animation starts from its first beat when the page is turned to. */
    readonly paint: (
      ctx: CanvasRenderingContext2D,
      rect: Rect,
      now: number,
      pageMs: number,
    ) => void;
  };
}

/** A row drawn between the page and the Back / Next row, the same on every page (a settings toggle). */
export interface PagedOverlayAccessory {
  readonly height: (ui: Ui) => number;
  readonly draw: (ui: Ui, rect: Rect) => void;
}

export interface PagedOverlayConfig {
  /** The surface id; unique per scene. */
  readonly id: string;
  /** Shown in the header above every page. */
  readonly title?: string;
  readonly pages: readonly PagedOverlayPage[];
  /** The last page's button. Defaults to "Got it". */
  readonly doneLabel?: string;
  /** Every other page's forward button. Defaults to "Next". */
  readonly nextLabel?: string;
  readonly width?: PanelWidth;
  readonly onDone: () => void;
  /** Escape and a header ✕ dismiss it (calling `onClose`). Defaults to true. */
  readonly closable?: boolean;
  /** What Escape, the header ✕ and the skip button do. Defaults to `onDone`. */
  readonly onClose?: () => void;
  /** Offer a Back button after the first page. Defaults to true. */
  readonly back?: boolean;
  /** A button in Back's place on the first page that closes the overlay (calling `onClose`). */
  readonly skipLabel?: string;
  /**
   * Played whenever the page shown changes, including when the overlay
   * opens; Back and Next then play nothing of their own. Only a surface
   * (which sees every frame) can play it.
   */
  readonly pageTurnSound?: SoundId;
  /** Played by Back, Next and Done when they fire; `null` when the owner plays its own. Defaults to the menu click. */
  readonly navSound?: SoundId | null;
  /** A tap anywhere (the scrim, the page) acts as the Next / Done button. Silent, like turning paper. */
  readonly advanceOnTapAnywhere?: boolean;
  /** Dim the screen behind the panel. Defaults to true. */
  readonly scrim?: boolean;
  readonly accessory?: PagedOverlayAccessory;
}

export interface PagedOverlayNav {
  readonly page: number;
  readonly setPage: (page: number) => void;
  /** When the page on screen was turned to, on `ui.now`'s clock. Defaults to the surface's open time. */
  readonly pageShownAt?: number;
}

/** Owns the page from outside the overlay, for a model that already keeps one. */
export interface PagedOverlayPager {
  readonly page: () => number;
  readonly setPage: (page: number) => void;
}

const DOT_SIZE = 6;
const DOT_ACTIVE_WIDTH = 18;
const DEFAULT_DONE_LABEL = 'Got it';
const DEFAULT_NEXT_LABEL = 'Next';
const BACK_LABEL = 'Back';
const NAV_BUTTON_MIN_WIDTH = 88;

function clampPage(config: Pick<PagedOverlayConfig, 'pages'>, page: number): number {
  return Math.min(Math.max(0, page), Math.max(0, config.pages.length - 1));
}

/** An illustration never takes more than this share of the viewport's height, so the text keeps its room on a phone. */
const ILLUSTRATION_MAX_VIEWPORT_SHARE = 0.3;
/** On a screen too short for the page, the illustration shrinks to fit beside the text, and is dropped once it would be smaller than this. */
const ILLUSTRATION_MIN_HEIGHT = 64;
/** The narrowest body that splits into an illustration column and a text column. */
const ILLUSTRATION_BESIDE_MIN_WIDTH = 440;
/** The illustration's share of the body's width when it sits beside the text. */
const ILLUSTRATION_BESIDE_SHARE = 0.5;

function illustrationHeight(ui: Ui, page: PagedOverlayPage): number {
  if (page.illustration === undefined) return 0;
  return Math.min(page.illustration.height, ui.viewport.h * ILLUSTRATION_MAX_VIEWPORT_SHARE);
}

/**
 * Whether the page's illustration sits beside its text rather than above it:
 * on a landscape screen too short to give the art its full height above the
 * text, once the body is wide enough to split. Beside, the art runs the full
 * height of the body, down past the Back / Next row, which sits under the text.
 */
function illustrationBeside(ui: Ui, page: PagedOverlayPage, bodyWidth: number): boolean {
  if (page.illustration?.aspect === undefined) return false;
  const landscape = ui.viewport.w > ui.viewport.h;
  const squeezedAbove = illustrationHeight(ui, page) < page.illustration.height;
  return landscape && squeezedAbove && bodyWidth >= ILLUSTRATION_BESIDE_MIN_WIDTH;
}

/** The illustration's column and the text's column of a page laid out side by side. */
function besideColumns(ui: Ui, body: Rect, page: PagedOverlayPage): [Rect, Rect] {
  const share = body.w * ILLUSTRATION_BESIDE_SHARE;
  const aspect = page.illustration?.aspect;
  const artW = aspect === undefined ? share : Math.min(share, body.h * aspect);
  const [art = body, words = body] = splitH(body, [artW, 'fill'], ui.theme.space.lg);
  return [art, words];
}

function textHeight(ui: Ui, page: PagedOverlayPage, width: number): number {
  const { space } = ui.theme;
  let h = measureTextHeight(ui, width, { text: page.title, role: 'heading' });
  if (page.overline !== undefined) h += lineHeightOf(ui, 'overline') + space.xs;
  h += space.sm + measureTextHeight(ui, width, { text: page.body, role: 'secondary' });
  return h;
}

function pageHeight(ui: Ui, page: PagedOverlayPage, width: number): number {
  if (page.illustration !== undefined && illustrationBeside(ui, page, width)) {
    const [, words] = besideColumns(ui, { x: 0, y: 0, w: width, h: ui.viewport.h }, page);
    const chromeBesideText = pagedOverlayChromeHeight(ui, {});
    return Math.max(page.illustration.height - chromeBesideText, textHeight(ui, page, words.w));
  }
  const art =
    page.illustration === undefined ? 0 : illustrationHeight(ui, page) + ui.theme.space.lg;
  return art + textHeight(ui, page, width);
}

/** The body height a page's text and illustration take at `width`, for callers that paginate their own text to fit. */
export function pagedOverlayPageHeight(ui: Ui, page: PagedOverlayPage, width: number): number {
  return pageHeight(ui, page, width);
}

/** What the panel's body holds besides the page: the Back / Next row and any accessory row. */
export function pagedOverlayChromeHeight(
  ui: Ui,
  config: Pick<PagedOverlayConfig, 'accessory'>,
): number {
  const { space } = ui.theme;
  const accessory = config.accessory === undefined ? 0 : config.accessory.height(ui) + space.md;
  return ui.theme.size.control + space.lg + accessory;
}

/** Draws the overlay at `nav.page`. Call from a surface's `render`. */
export function pagedOverlay(ui: Ui, config: PagedOverlayConfig, nav: PagedOverlayNav): void {
  const { theme, ctx } = ui;
  const { space, palette, radius } = theme;
  if (config.pages.length === 0) return;
  const index = clampPage(config, nav.page);
  const page = config.pages[index];
  const isLast = index === config.pages.length - 1;
  const width = config.width ?? 'md';
  const closable = config.closable !== false;
  const close = config.onClose ?? config.onDone;
  const advance = (): void => (isLast ? config.onDone() : nav.setPage(index + 1));
  const tapAnywhere = config.advanceOnTapAnywhere === true ? advance : undefined;
  const estimateW = Math.min(theme.panelWidth[width], ui.viewport.w) - space.lg * 2;
  const contentHeight = Math.max(
    ...config.pages.map((candidate) => pageHeight(ui, candidate, estimateW)),
  );
  if (tapAnywhere !== undefined && config.scrim === false) {
    ui.hit(`${config.id}/outside`, ui.screen, {
      onTap: tapAnywhere,
      focusable: false,
      sound: null,
    });
  }
  const p = panel(ui, {
    id: config.id,
    title: config.title,
    width,
    height: 'content',
    contentHeight: contentHeight + pagedOverlayChromeHeight(ui, config),
    onClose: closable ? close : undefined,
    scrim: config.scrim,
    onScrimTap: tapAnywhere,
  });
  if (tapAnywhere !== undefined) {
    ui.hit(`${config.id}/page`, p.body, { onTap: tapAnywhere, focusable: false, sound: null });
  }
  const accessory = config.accessory;
  const tracks = accessory === undefined ? [] : [accessory.height(ui)];
  const beside = illustrationBeside(ui, page, p.body.w);
  const [artColumn, pageColumn] = beside ? besideColumns(ui, p.body, page) : [null, p.body];
  const [bodyArea = pageColumn, ...rows] = splitV(
    pageColumn,
    ['fill', ...tracks, theme.size.control],
    space.lg,
  );
  const navRow = rows[rows.length - 1] ?? p.body;
  if (accessory !== undefined && rows.length > 1) accessory.draw(ui, rows[0]);
  const pageMs = Math.max(0, ui.now - (nav.pageShownAt ?? ui.openedAt));
  const paintArt = (art: Rect): void => {
    if (page.illustration === undefined) return;
    ctx.save();
    roundRectPath(ctx, art, radius.md);
    ctx.clip();
    fillRounded(ctx, art, radius.md, palette.surface.sunken);
    page.illustration.paint(ctx, art, ui.now, pageMs);
    ctx.restore();
  };
  const drawText = (area: Rect): void => {
    let y = area.y;
    if (page.overline !== undefined) {
      const h = lineHeightOf(ui, 'overline');
      text(
        ui,
        { x: area.x, y, w: area.w, h },
        { text: page.overline, role: 'overline', color: palette.accent.base },
      );
      y += h + space.xs;
    }
    const titleH = measureTextHeight(ui, area.w, { text: page.title, role: 'heading' });
    text(
      ui,
      { x: area.x, y, w: area.w, h: titleH },
      { text: page.title, role: 'heading', wrap: true },
    );
    y += titleH + space.sm;
    text(
      ui,
      { x: area.x, y, w: area.w, h: area.y + area.h - y },
      { text: page.body, role: 'secondary', wrap: true },
    );
  };
  const drawScrolling = (area: Rect, contentH: number, draw: (inner: Rect) => void): void => {
    if (contentH > area.h) {
      scrollView(ui, area, { id: `${config.id}/page${index}`, contentHeight: contentH, draw });
    } else {
      draw(area);
    }
  };

  if (page.illustration !== undefined && artColumn !== null) {
    const artH = Math.min(page.illustration.height, artColumn.h);
    paintArt({ ...artColumn, h: artH });
    const wordsH = textHeight(ui, page, bodyArea.w);
    const words = wordsH <= bodyArea.h ? { ...bodyArea, h: wordsH } : bodyArea;
    drawScrolling(words, wordsH, drawText);
  } else {
    const fullArtH = illustrationHeight(ui, page);
    const artGap = page.illustration === undefined ? 0 : space.lg;
    const wordsH = textHeight(ui, page, bodyArea.w);
    const roomForArt = bodyArea.h - wordsH - artGap;
    const artFits =
      page.illustration !== undefined && roomForArt >= Math.min(fullArtH, ILLUSTRATION_MIN_HEIGHT);
    const artH = artFits ? Math.min(fullArtH, roomForArt) : 0;
    const naturalH = wordsH + (artFits ? artH + artGap : 0);
    drawScrolling(bodyArea, naturalH, (area) => {
      if (artFits) paintArt({ x: area.x, y: area.y, w: area.w, h: artH });
      const textTop = artFits ? artH + space.lg : 0;
      drawText({ ...area, y: area.y + textTop, h: area.h - textTop });
    });
  }

  const turnSound = config.pageTurnSound === undefined ? config.navSound : null;
  const skipLabel = index === 0 ? config.skipLabel : undefined;
  const showBack = index > 0 && config.back !== false;
  const backLabel = skipLabel ?? BACK_LABEL;
  const backW = Math.max(NAV_BUTTON_MIN_WIDTH, measureButton(ui, { label: backLabel }));
  const doneLabel = config.doneLabel ?? DEFAULT_DONE_LABEL;
  const nextLabel = isLast ? doneLabel : (config.nextLabel ?? DEFAULT_NEXT_LABEL);
  const nextW = Math.max(NAV_BUTTON_MIN_WIDTH, measureButton(ui, { label: nextLabel }));
  const [backCell, dotsCell, nextCell] = splitH(navRow, [backW, 'fill', nextW], space.sm);
  if (skipLabel !== undefined) {
    button(ui, backCell, {
      id: `${config.id}/skip`,
      label: skipLabel,
      variant: 'ghost',
      onTap: close,
    });
  } else if (showBack) {
    button(ui, backCell, {
      id: `${config.id}/back`,
      label: BACK_LABEL,
      icon: 'back',
      variant: 'ghost',
      sound: turnSound,
      onTap: () => nav.setPage(index - 1),
    });
  }
  button(ui, nextCell, {
    id: `${config.id}/next`,
    label: nextLabel,
    variant: 'primary',
    primary: true,
    sound: isLast ? config.navSound : turnSound,
    onTap: advance,
  });
  if (config.pages.length > 1) drawDots(ui, dotsCell, config, index);
}

function drawDots(ui: Ui, cell: Rect, config: PagedOverlayConfig, active: number): void {
  const { palette, space, radius } = ui.theme;
  const count = config.pages.length;
  const total = DOT_ACTIVE_WIDTH + (count - 1) * DOT_SIZE + (count - 1) * space.xs;
  const row = centerIn(cell, total, DOT_SIZE);
  let x = row.x;
  for (let dot = 0; dot < count; dot++) {
    const w = ui.tween(`${config.id}/dot${dot}`, dot === active ? DOT_ACTIVE_WIDTH : DOT_SIZE, {
      ms: ui.theme.motion.base,
    });
    fillRounded(
      ui.ctx,
      { x, y: row.y, w, h: DOT_SIZE },
      radius.pill,
      dot === active ? palette.accent.base : palette.border.strong,
    );
    x += w + space.xs;
  }
}

export interface PagedOverlaySurfaceConfig extends PagedOverlayConfig {
  readonly isOpen: () => boolean;
  readonly band?: Extract<Band, 'modal' | 'system'>;
  /** Defaults to true. */
  readonly haltsWorld?: boolean;
  /** Keys no surface consumed are kept from gameplay while it is open. Defaults to false. */
  readonly locksKeyboard?: boolean;
  /** When given and false, Escape passes beneath (to something drawn over it that has no `close`). */
  readonly wantsEscape?: () => boolean;
  /** Owns the page; without one the surface keeps its own, starting at the first page each time it opens. */
  readonly pager?: PagedOverlayPager;
  /** The left and right arrows turn pages. Defaults to true. */
  readonly arrowKeys?: boolean;
}

/** A surface showing the overlay. */
export function pagedOverlaySurface(config: PagedOverlaySurfaceConfig): Surface {
  let ownPage = 0;
  let seenOpenedAt: number | null = null;
  let shownPage: number | null = null;
  let pageShownAt = 0;
  const pager: PagedOverlayPager = config.pager ?? {
    page: () => ownPage,
    setPage: (next) => {
      ownPage = next;
    },
  };
  const currentPage = (): number => clampPage(config, pager.page());
  const setPage = (next: number): void => {
    const clamped = clampPage(config, next);
    if (clamped < currentPage() && config.back === false) return;
    pager.setPage(clamped);
  };
  const closable = config.closable !== false;
  const close = config.onClose ?? config.onDone;
  const wantsEscape = config.wantsEscape;
  const arrowKeys = config.arrowKeys !== false;
  return {
    id: config.id,
    band: config.band ?? 'modal',
    haltsWorld: config.haltsWorld ?? true,
    locksKeyboard: config.locksKeyboard ?? false,
    blocksEscape: !closable,
    isOpen: () => config.isOpen(),
    close: closable ? close : undefined,
    wantsEscape: wantsEscape === undefined ? undefined : () => wantsEscape(),
    onKey: (key) => {
      if (!arrowKeys) return false;
      if (key === 'ArrowRight') {
        setPage(currentPage() + 1);
        return true;
      }
      if (key === 'ArrowLeft') {
        setPage(currentPage() - 1);
        return true;
      }
      return false;
    },
    render: (ui) => {
      const opened = seenOpenedAt !== ui.openedAt;
      if (opened) {
        seenOpenedAt = ui.openedAt;
        if (config.pager === undefined) ownPage = 0;
      }
      const page = currentPage();
      if (opened || page !== shownPage) {
        shownPage = page;
        pageShownAt = ui.now;
        if (config.pageTurnSound !== undefined) ui.playSound(config.pageTurnSound);
      }
      pagedOverlay(ui, config, { page, setPage, pageShownAt });
    },
  };
}
