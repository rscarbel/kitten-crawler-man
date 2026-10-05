/**
 * A centred decision: an optional icon or hero picture, a title, a body and
 * one or more buttons. Confirms, stair and door prompts, level-ups and reward
 * announcements are all this.
 *
 * Mount one as its own surface with {@link choiceModalSurface}; its config
 * says what Escape does and which button Enter presses.
 */

import type { SoundId } from '../../audio/sounds';
import { centerIn, splitV, type Rect } from '../core/geom';
import type { Band, KeyModifiers, Surface, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor, type ButtonVariant } from '../theme/skins';
import type { PanelWidth, Theme } from '../theme/tokens';
import { button, measureButton } from './button';
import { fillRounded, roundRectPath } from './paint';
import { panel, panelBodyMaxHeight, panelBodyWidth, type FooterButton } from './panel';
import { scrollGutterWidth } from './scrollView';
import { lineHeightOf, measureTextHeight, text } from './text';

export interface ChoiceButton {
  readonly id?: string;
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly icon?: GlyphId;
  readonly disabled?: boolean | string;
  readonly sound?: SoundId | null;
  /** The choice an active quest is waiting on: it wears the quest compass unless it has its own icon. */
  readonly questRelated?: boolean;
  readonly onTap: () => void;
}

/** The glyph a quest-related choice wears, matching the quest icon on the HUD. */
const QUEST_CHOICE_GLYPH: GlyphId = 'compass';

export type ChoiceTone = 'accent' | 'danger' | 'success' | 'info';

/** A picture across the top of the modal, painted every frame. */
export interface HeroArt {
  readonly height: number;
  readonly paint: (ctx: CanvasRenderingContext2D, rect: Rect, now: number) => void;
}

export interface ChoiceModalConfig {
  /** Unique within the surface. */
  readonly id: string;
  readonly title: string;
  /** Small spaced capitals above the title. */
  readonly overline?: string;
  /** Paragraphs, separated by blank space. */
  readonly body?: string | readonly string[];
  /** A glyph in a tinted disc above the title. Ignored when `hero` is given. */
  readonly icon?: GlyphId;
  readonly tone?: ChoiceTone;
  readonly hero?: HeroArt;
  /** Custom content between the body and the buttons (chips, a stepper). */
  readonly extra?: { readonly height: number; readonly draw: (rect: Rect) => void };
  /** In display order. The default button is drawn last on a wide row. */
  readonly buttons: readonly ChoiceButton[];
  /** Index into `buttons` that Enter presses when nothing is focused. */
  readonly defaultButton?: number;
  readonly width?: PanelWidth;
  /** Draw ✕ in the corner, calling this. */
  readonly onClose?: () => void;
  /** Tapping outside the card calls this. Without it the scrim only swallows the tap. */
  readonly onScrimTap?: () => void;
}

/** The icon disc's diameter. */
const ICON_DISC = 48;
const ICON_GLYPH = 24;
const ICON_DISC_ALPHA = 0.16;
/** A row holds this many buttons before they stack. */
const MAX_BUTTONS_PER_ROW = 2;

function toneColor(theme: Theme, tone: ChoiceTone): string {
  switch (tone) {
    case 'accent':
      return theme.palette.accent.base;
    case 'danger':
      return theme.palette.state.danger;
    case 'success':
      return theme.palette.state.success;
    case 'info':
      return theme.palette.state.info;
  }
}

function paragraphs(body: ChoiceModalConfig['body']): readonly string[] {
  if (body === undefined) return [];
  return typeof body === 'string' ? [body] : body;
}

interface Layout {
  readonly tracks: number[];
  /** Buttons stack in the body (more than a row holds); otherwise they sit pinned in the footer. */
  readonly stacked: boolean;
}

function stacksButtons(ui: Ui, config: ChoiceModalConfig, width: number): boolean {
  if (config.buttons.length > MAX_BUTTONS_PER_ROW) return true;
  const gap = ui.theme.space.sm;
  const natural = config.buttons.reduce(
    (sum, b) => sum + measureButton(ui, { ...b, size: 'lg' }),
    0,
  );
  return natural + gap * (config.buttons.length - 1) > width;
}

function stackedButtonHeight(ui: Ui): number {
  return skinsFor(ui.theme).controlSize.lg.height;
}

function layout(
  ui: Ui,
  config: ChoiceModalConfig,
  width: number,
  stackedOverride?: boolean,
): Layout {
  const { space } = ui.theme;
  const tracks: number[] = [];
  if (config.hero !== undefined) tracks.push(config.hero.height);
  else if (config.icon !== undefined) tracks.push(ICON_DISC);
  if (config.overline !== undefined) tracks.push(lineHeightOf(ui, 'overline'));
  tracks.push(measureTextHeight(ui, width, { text: config.title, role: 'heading' }));
  for (const paragraph of paragraphs(config.body)) {
    tracks.push(measureTextHeight(ui, width, { text: paragraph, role: 'secondary' }));
  }
  if (config.extra !== undefined) tracks.push(config.extra.height);
  const stacked = stackedOverride ?? stacksButtons(ui, config, width);
  if (stacked) {
    const count = config.buttons.length;
    tracks.push(count * stackedButtonHeight(ui) + (count - 1) * space.sm);
  }
  return { tracks, stacked };
}

function choiceButton(config: ChoiceModalConfig, b: ChoiceButton, index: number): FooterButton {
  const isDefault = index === config.defaultButton;
  const questIcon = b.questRelated === true ? QUEST_CHOICE_GLYPH : undefined;
  return {
    ...b,
    icon: b.icon ?? questIcon,
    id: b.id ?? b.label,
    variant: b.variant ?? (isDefault ? 'primary' : 'secondary'),
    primary: isDefault,
  };
}

/** Draws the modal. Call from a modal-band surface's `render`. */
export function choiceModal(ui: Ui, config: ChoiceModalConfig): void {
  const { theme, ctx } = ui;
  const { space, palette } = theme;
  const width = config.width ?? 'sm';
  const gap = space.md;
  const heightAt = (
    bodyW: number,
    stacked?: boolean,
  ): { contentHeight: number; stacked: boolean } => {
    const laid = layout(ui, config, bodyW, stacked);
    const contentHeight =
      laid.tracks.reduce((sum, h) => sum + h, 0) + gap * (laid.tracks.length - 1);
    return { contentHeight, stacked: laid.stacked };
  };
  const bodyW = panelBodyWidth(ui, width);
  const natural = heightAt(bodyW);
  const footer = natural.stacked
    ? undefined
    : config.buttons.map((b, index) => choiceButton(config, b, index));
  const maxBody = panelBodyMaxHeight(ui, {
    width,
    onClose: config.onClose,
    footer,
    footerSize: 'lg',
  });
  const scrollBody = natural.contentHeight > maxBody;
  const contentHeight = scrollBody
    ? heightAt(bodyW - scrollGutterWidth(ui), natural.stacked).contentHeight
    : natural.contentHeight;
  panel(ui, {
    id: config.id,
    width,
    height: 'content',
    contentHeight,
    onClose: config.onClose,
    onScrimTap: config.onScrimTap,
    footer,
    footerLayout: 'fill',
    footerSize: 'lg',
    scrollBody,
    content: (body) => {
      const { tracks, stacked } = layout(ui, config, body.w, natural.stacked);
      const rows = splitV(body, tracks, gap);
      let index = 0;
      const next = (): Rect => rows[index++] ?? { ...body, h: 0 };
      const tone = toneColor(theme, config.tone ?? 'accent');
      if (config.hero !== undefined) {
        const heroRect = next();
        ctx.save();
        roundRectPath(ctx, heroRect, theme.radius.md);
        ctx.clip();
        fillRounded(ctx, heroRect, theme.radius.md, palette.surface.sunken);
        config.hero.paint(ctx, heroRect, ui.now);
        ctx.restore();
      } else if (config.icon !== undefined) {
        const disc = centerIn(next(), ICON_DISC, ICON_DISC);
        fillRounded(ctx, disc, theme.radius.pill, withAlpha(tone, ICON_DISC_ALPHA));
        drawGlyph(ctx, config.icon, centerIn(disc, ICON_GLYPH, ICON_GLYPH), { color: tone });
      }
      if (config.overline !== undefined) {
        text(ui, next(), { text: config.overline, role: 'overline', color: tone, align: 'center' });
      }
      text(ui, next(), { text: config.title, role: 'heading', align: 'center', wrap: true });
      for (const paragraph of paragraphs(config.body)) {
        text(ui, next(), { text: paragraph, role: 'secondary', align: 'center', wrap: true });
      }
      if (config.extra !== undefined) config.extra.draw(next());
      if (!stacked) return;
      const cells = splitV(
        next(),
        config.buttons.map(() => stackedButtonHeight(ui)),
        space.sm,
      );
      config.buttons.forEach((b, buttonIndex) => {
        const footerButton = choiceButton(config, b, buttonIndex);
        button(ui, cells[buttonIndex], {
          ...footerButton,
          id: `${config.id}/${footerButton.id ?? b.label}`,
          size: 'lg',
        });
      });
    },
  });
}

/** What Escape does while the modal is on top. */
export type ChoiceEscape =
  /** Escape calls `onEscape` (usually the cancel button's action) and the modal is expected to close. */
  | { readonly kind: 'close'; readonly onEscape: () => void }
  /** Escape does nothing at all: the player must choose. */
  | { readonly kind: 'block' }
  /** Escape passes beneath, to whatever is under the modal (or the pause toggle). */
  | { readonly kind: 'pass' };

export interface ChoiceModalSurfaceConfig {
  /** The surface id; unique per scene. */
  readonly id: string;
  readonly band?: Extract<Band, 'modal' | 'system'>;
  readonly isOpen: () => boolean;
  /** Defaults to true. */
  readonly haltsWorld?: boolean;
  /** Keys no surface consumed are kept from gameplay even when the world runs on. Defaults to false. */
  readonly locksKeyboard?: boolean;
  readonly escape: ChoiceEscape;
  /** Sees each key before focus navigation and Escape; return true to consume it. */
  readonly onKey?: (key: string, mods: KeyModifiers) => boolean;
  /** Read every frame, so labels and enabled states stay live. */
  readonly content: (ui: Ui) => ChoiceModalConfig;
}

/** A surface that shows one choice modal. */
export function choiceModalSurface(config: ChoiceModalSurfaceConfig): Surface {
  const escape = config.escape;
  return {
    id: config.id,
    band: config.band ?? 'modal',
    haltsWorld: config.haltsWorld ?? true,
    locksKeyboard: config.locksKeyboard ?? false,
    blocksEscape: escape.kind === 'block',
    onKey: config.onKey,
    isOpen: () => config.isOpen(),
    close: escape.kind === 'close' ? () => escape.onEscape() : undefined,
    render: (ui) => choiceModal(ui, config.content(ui)),
  };
}
