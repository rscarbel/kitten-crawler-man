/**
 * Caroline's line on the title screen: her welcome as the reveal lands,
 * then her quips while the player lingers, each in the sheer title variant of
 * Caroline's frame, unfolding as it opens and folding away as it ends.
 *
 * A readout, never a control: it registers no region and takes no keys. What
 * it shows is a function of the title clock and the latest line on the quip
 * channel, so a frozen review moment shows a line exactly as far decoded as a
 * player would see it.
 */

import { crawlerName } from '../../characters/characters';
import { carolineLines } from '../../dialog/caroline';
import type { Rect } from '../../ui/core/geom';
import type { Surface, Ui } from '../../ui/core/UiRoot';
import { panelWidths } from '../../ui/theme/tokens';
import {
  carolineBox,
  carolineCloseAt,
  carolineBoxChromeHeight,
  carolineLineHeight,
  carolineOpenAt,
  carolineOpenDurationMs,
  carolineRevealAt,
  measureCarolineBox,
} from '../../ui/widgets/carolineFrame';
import type { TitleClock } from './titleClock';
import type { TitleQuipChannel } from './titleEvents';
import { titleLogoGeometry, type TitleLogoGeometry } from './titleLogo';
import { stageRectInUi, type TitleStage } from './titleStage';

export const TITLE_SYSTEM_AI_SURFACE_ID = 'title-system-ai';

/** What Caroline says as the title reveal lands. */
export const TITLE_WELCOME_LINE = carolineLines.message(
  `${crawlerName('human')}. ${crawlerName('cat')}. You are awake. Proceed.`,
);
/** How long the welcome stays up, typing included, unless a quip takes the line first. */
export const TITLE_WELCOME_HOLD_MS = 7000;

/** Above the menu, the line takes at most this many lines. */
const ABOVE_MENU_MAX_LINES = 3;
/** Under the heroes the line needs this many, or a quip would end mid-sentence. */
const MIN_LINES_UNDER_HEROES = 2;
/** The dive takes the line down with the light, slowly at first. */
const DIVE_FADE_EXPONENT = 2;
/** The frame never stretches wider than a mid-size panel, so a line stays a glance across a wide screen. */
const MAX_FRAME_WIDTH = panelWidths.md;

export interface TitleSystemAiDeps {
  readonly clock: () => TitleClock;
  readonly quips: TitleQuipChannel;
  readonly stage: () => TitleStage;
  /** The menu's strip this frame, in UI units: held upright, the line sits just above it. */
  readonly menuStrip: (ui: Ui) => Rect;
}

export function titleSystemAiSurface(deps: TitleSystemAiDeps): Surface {
  let logo: { readonly stage: TitleStage; readonly geometry: TitleLogoGeometry } | null = null;
  const logoFoot = (stage: TitleStage): number => {
    const known = logo !== null && logo.stage === stage ? logo.geometry : null;
    const geometry = known ?? titleLogoGeometry(stage);
    logo = { stage, geometry };
    return geometry.footY;
  };

  /** The room between the logo and the menu's strip, across `span`; null when not a line fits. */
  const aboveMenu = (
    ui: Ui,
    lineHeight: number,
    span: { x: number; w: number },
  ): { rect: Rect; maxLines: number } | null => {
    const { space } = ui.theme;
    const chrome = carolineBoxChromeHeight(ui.theme);
    const strip = deps.menuStrip(ui);
    const bottom = strip.y - space.sm;
    const ceiling = logoFoot(deps.stage()) / ui.uiScale + space.sm;
    const fits = Math.floor((bottom - ceiling - chrome) / lineHeight);
    if (fits < 1) return null;
    const maxLines = Math.min(ABOVE_MENU_MAX_LINES, fits);
    const height = chrome + maxLines * lineHeight;
    const rect: Rect = { x: span.x, y: bottom - height, w: span.w, h: height };
    return { rect, maxLines };
  };

  /**
   * Where the line may go: under the heroes on a wide screen, or across the
   * screen between the logo and the menu where the room under the heroes is
   * too short for a quip (a phone on its side) or the menu is docked
   * under them. Null when not even one line fits anywhere.
   */
  const room = (
    ui: Ui,
    lineHeight: number,
  ): { rect: Rect; maxLines: number; centred: boolean } | null => {
    const stage = deps.stage();
    const { space } = ui.theme;
    const acrossScreen = { x: ui.viewport.x + space.md, w: ui.viewport.w - space.md * 2 };
    if (stage.composition === 'portrait') {
      const found = aboveMenu(ui, lineHeight, acrossScreen);
      return found === null ? null : { ...found, centred: true };
    }
    const rect = stageRectInUi(stage.promptRect, ui.uiScale);
    const maxLines = Math.floor((rect.h - carolineBoxChromeHeight(ui.theme)) / lineHeight);
    if (maxLines >= MIN_LINES_UNDER_HEROES) return { rect, maxLines, centred: false };
    const found = aboveMenu(ui, lineHeight, acrossScreen);
    const capacity = (option: { rect: Rect; maxLines: number }): number =>
      option.maxLines * option.rect.w;
    if (found !== null && capacity(found) >= capacity({ rect, maxLines }))
      return { ...found, centred: true };
    return maxLines < 1 ? null : { rect, maxLines, centred: false };
  };

  return {
    id: TITLE_SYSTEM_AI_SURFACE_ID,
    band: 'hud',
    haltsWorld: false,
    isOpen: () => deps.quips.current() !== null,
    render: (ui) => {
      const quip = deps.quips.current();
      if (quip === null) return;
      const clock = deps.clock();
      const sinceMs = clock.elapsedMs - quip.startedAtMs;
      if (sinceMs < 0 || sinceMs >= quip.durationMs) return;

      const { theme } = ui;
      const lineHeight = carolineLineHeight(theme);
      const space = room(ui, lineHeight);
      if (space === null) return;
      const { rect, maxLines, centred } = space;
      const width = Math.min(rect.w, MAX_FRAME_WIDTH);
      const height = measureCarolineBox(ui, width, quip.text, maxLines);
      const left = centred ? rect.x + (rect.w - width) / 2 : rect.x;
      const frame: Rect = { x: left, y: rect.y + rect.h - height, w: width, h: height };

      const openMs = carolineOpenDurationMs(theme);
      const closingFromMs = quip.durationMs - openMs;
      const open =
        sinceMs >= closingFromMs
          ? carolineCloseAt(theme, sinceMs - closingFromMs, clock.reducedMotion)
          : carolineOpenAt(theme, sinceMs, clock.reducedMotion);
      const reveal = carolineRevealAt(
        theme,
        quip.text,
        Math.max(0, sinceMs - openMs),
        clock.reducedMotion,
      );

      const { ctx } = ui;
      ctx.save();
      ctx.globalAlpha *= 1 - Math.pow(clock.diveProgress, DIVE_FADE_EXPONENT);
      carolineBox(ui, frame, {
        message: quip.text,
        reveal,
        nowMs: clock.elapsedMs,
        open,
        sheer: true,
        maxLines,
      });
      ctx.restore();
    },
  };
}
