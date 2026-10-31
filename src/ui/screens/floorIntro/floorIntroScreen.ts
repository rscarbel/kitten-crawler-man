/**
 * Paints one frame of a floor's "Find the Key" intro over the whole screen:
 * the floor's dark and ambience, its name, the key's silhouette counting its
 * sockets, the slammed title and the subline. A pure function of the
 * milliseconds since the intro started, so a gallery fixture is a frame count.
 */

import type { KeyKind } from '../../../core/keys/keyKinds';
import type { LevelId } from '../../../levels/levelIds';
import {
  fragmentPieceOffset,
  KEY_ART_ASPECT,
  paintKeySilhouette,
} from '../../../sprites/art/keyArt';
import type { Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { FLOOR_INTRO_TYPE } from '../../theme/introInk';
import { skinsFor } from '../../theme/skins';
import type { TypeStyle } from '../../theme/tokens';
import { measureText, measureTextHeight, text } from '../../widgets/text';
import { fitStyleToWidth } from '../dialogs/endScreenParts';
import { paintIntroAmbience } from './floorIntroAmbience';
import { stairwellKey } from '../../../core/keys/floorKeys';
import { floorIntroTheme, introSublineText, type FloorIntroTheme } from './floorIntroThemes';
import {
  introBeatAt,
  introTiming,
  type IntroBeatState,
  type IntroTiming,
} from './floorIntroTimeline';
import type { IntroKeyGlows, KeyGlowPicture } from './introKeyGlows';
import {
  alphaMap,
  drawStretched,
  paintSoftPool,
  paintVerticalRamp,
} from '../../../sprites/lightMaps';

const FIND_THE_KEY_TITLE = 'Find the Key';

/** What the intro paints with: a `Ui`, or one whose `ctx` is an off-screen layer. */
export type IntroPaintTarget = Pick<Ui, 'ctx' | 'theme' | 'viewport' | 'screen' | 'size'>;

/** What one floor's intro shows, gathered once from its theme and its key. */
export interface FloorIntroView {
  readonly theme: FloorIntroTheme;
  /** The key the floor's stairwells open for. */
  readonly keyKind: KeyKind;
  /** One socket per fragment of that key. */
  readonly sockets: number;
  readonly subline: string;
  /** Its beats, fitted to its swell. */
  readonly timing: IntroTiming;
}

export function floorIntroView(levelId: LevelId): FloorIntroView {
  const theme = floorIntroTheme(levelId);
  const key = stairwellKey(levelId);
  return {
    theme,
    keyKind: key.kind,
    sockets: key.fragments.length,
    subline: introSublineText(levelId, theme.subline),
    timing: introTiming(theme.swell, key.fragments.length),
  };
}

const HALF = 0.5;
/** The key's widest, as a share of the viewport's width, and its tallest, as a share of its height. */
const KEY_WIDTH_SHARE = 0.46;
const KEY_HEIGHT_SHARE = 0.22;
const KEY_MAX_WIDTH = 420;
/** How far below its place the silhouette starts its rise, as a share of its own width. */
const KEY_RISE_FROM = 0.35;
/** How much of a counted socket's gold shows at the top of its pulse. */
const SOCKET_LIT_PEAK = 0.55;
const SOCKET_GLOW_REACH = 0.32;
const SOCKET_GLOW_ALPHA = 0.55;
/** The roomy title never shrinks below twice the display step. */
const TITLE_FLOOR_SCALE = 2;
const TITLE_GLOW_ALPHA = 0.28;
const TITLE_GLOW_FLASH_ALPHA = 0.5;
/** The glow behind the title, as shares of the title's width and its line's height. */
const TITLE_GLOW_REACH = 0.7;
const TITLE_GLOW_HEIGHT = 1.3;
const FLASH_PEAK_ALPHA = 0.4;
const SHAKE_AMPLITUDE = 10;
const SHAKE_AMPLITUDE_COMPACT = 6;
const SHAKE_RATE_X = 0.091;
const SHAKE_RATE_Y = 0.117;
const VIGNETTE_ALPHA = 0.8;
/** Where the vignette starts darkening, as a share of the screen's half-diagonal. */
const VIGNETTE_INNER = 0.45;
const SUBLINE_MAX_LINES = 2;

interface IntroLayout {
  readonly kicker: Rect;
  readonly kickerStyle: TypeStyle;
  readonly keyCentre: { readonly x: number; readonly y: number };
  readonly keyWidth: number;
  readonly title: Rect;
  readonly titleStyle: TypeStyle;
  readonly subline: Rect;
  readonly sublineStyle: TypeStyle;
}

function layoutIntro(ui: IntroPaintTarget, view: FloorIntroView): IntroLayout {
  const { viewport, theme, size } = ui;
  const { space, type } = theme;
  const compact = size === 'compact';
  const width = viewport.w - space.lg * 2;
  const x = viewport.x + space.lg;
  const kickerStyle = fitStyleToWidth(
    ui,
    view.theme.kicker,
    FLOOR_INTRO_TYPE.kicker,
    type.label,
    width,
  );
  const logo = skinsFor(theme).titleLogo.style;
  const titleFloor: TypeStyle = compact
    ? type.display
    : {
        ...type.display,
        size: type.display.size * TITLE_FLOOR_SCALE,
        lineHeight: type.display.lineHeight * TITLE_FLOOR_SCALE,
      };
  const titleStyle = fitStyleToWidth(ui, FIND_THE_KEY_TITLE, logo, titleFloor, width);
  const sublineStyle = compact ? FLOOR_INTRO_TYPE.sublineCompact : FLOOR_INTRO_TYPE.subline;
  const sublineH = measureTextHeight(ui, width, {
    text: view.subline,
    style: sublineStyle,
    maxLines: SUBLINE_MAX_LINES,
  });
  const keyWidth = Math.min(
    viewport.w * KEY_WIDTH_SHARE,
    (viewport.h * KEY_HEIGHT_SHARE) / KEY_ART_ASPECT,
    KEY_MAX_WIDTH,
  );
  const keyHeight = keyWidth * KEY_ART_ASPECT;
  const gap = compact ? space.md : space.xl;
  const blockH =
    kickerStyle.lineHeight + gap + keyHeight + gap + titleStyle.lineHeight + space.sm + sublineH;
  const top = Math.max(viewport.y, viewport.y + (viewport.h - blockH) * HALF);
  const kicker: Rect = { x, y: top, w: width, h: kickerStyle.lineHeight };
  const keyTop = kicker.y + kicker.h + gap;
  const title: Rect = { x, y: keyTop + keyHeight + gap, w: width, h: titleStyle.lineHeight };
  const subline: Rect = { x, y: title.y + title.h + space.sm, w: width, h: sublineH };
  return {
    kicker,
    kickerStyle,
    keyCentre: { x: viewport.x + viewport.w * HALF, y: keyTop + keyHeight * HALF },
    keyWidth,
    title,
    titleStyle,
    subline,
    sublineStyle,
  };
}

/**
 * Paints `view` `ms` into its intro, opaque over the whole screen; the fade to
 * the floor lays this picture over the world from a layer. Takes no input.
 */
export function paintFloorIntro(
  ui: IntroPaintTarget,
  view: FloorIntroView,
  ms: number,
  glows: IntroKeyGlows,
): void {
  const { ctx, screen } = ui;
  const { ink } = view.theme;
  const beat = introBeatAt(ms, view.timing);
  const layout = layoutIntro(ui, view);
  ctx.save();

  paintVerticalRamp(ctx, screen, [
    { at: 0, color: ink.backdropTop },
    { at: 1, color: ink.backdropBottom },
  ]);

  paintVignette(ctx, screen, ink.vignette);
  const detail = ui.size === 'compact' ? 'lite' : 'full';
  paintIntroAmbience(ctx, screen, view.theme.ambience, ms, beat.ambience, detail);

  ctx.save();
  const amplitude = ui.size === 'compact' ? SHAKE_AMPLITUDE_COMPACT : SHAKE_AMPLITUDE;
  ctx.translate(
    Math.sin(ms * SHAKE_RATE_X) * amplitude * beat.shake,
    Math.cos(ms * SHAKE_RATE_Y) * amplitude * beat.shake,
  );
  paintKicker(ui, view, layout, beat);
  paintSilhouette(ui, view, layout, beat, glows);
  paintTitle(ui, view, layout, beat);
  paintSubline(ui, view, layout, beat);
  ctx.restore();

  if (beat.flash > 0) {
    ctx.fillStyle = withAlpha(ink.flash, beat.flash * FLASH_PEAK_ALPHA);
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  }
  ctx.restore();
}

/** The vignette's map: it darkens smoothly, so a small map stretched to the screen holds it. */
const VIGNETTE_MAP_SIZE = 256;

/**
 * Darkens the screen's edges toward `color`: clear out to {@link VIGNETTE_INNER}
 * of the half-diagonal, then deepening in a straight ramp to the corners.
 */
function paintVignette(ctx: CanvasRenderingContext2D, screen: Rect, color: string): void {
  const cx = screen.x + screen.w * HALF;
  const cy = screen.y + screen.h * HALF;
  const reach = Math.hypot(screen.w, screen.h) * HALF;
  const map = alphaMap('vignette', VIGNETTE_MAP_SIZE, VIGNETTE_MAP_SIZE, color, (u, v) => {
    const distance = Math.sqrt(u * u + v * v);
    return Math.min(1, Math.max(0, (distance - VIGNETTE_INNER) / (1 - VIGNETTE_INNER)));
  });
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.w, screen.h);
    ctx.clip();
    drawStretched(ctx, map, cx, cy, reach, reach, VIGNETTE_ALPHA);
  } finally {
    ctx.restore();
  }
}

function withLineAlpha(ui: IntroPaintTarget, alpha: number, draw: () => void): void {
  if (alpha <= 0) return;
  ui.ctx.save();
  ui.ctx.globalAlpha *= alpha;
  draw();
  ui.ctx.restore();
}

function paintKicker(
  ui: IntroPaintTarget,
  view: FloorIntroView,
  layout: IntroLayout,
  beat: IntroBeatState,
): void {
  withLineAlpha(ui, beat.kicker, () => {
    text(ui, layout.kicker, {
      text: view.theme.kicker,
      style: layout.kickerStyle,
      color: view.theme.ink.kicker,
      align: 'center',
      halo: view.theme.ink.halo,
    });
  });
}

function paintSilhouette(
  ui: IntroPaintTarget,
  view: FloorIntroView,
  layout: IntroLayout,
  beat: IntroBeatState,
  glows: IntroKeyGlows,
): void {
  const { ctx } = ui;
  const kind = view.keyKind;
  const size = layout.keyWidth;
  const cx = layout.keyCentre.x;
  const cy = layout.keyCentre.y + (1 - beat.silhouetteRise) * size * KEY_RISE_FROM;
  const nothingHeld = beat.socketPulse.map(() => false);
  withLineAlpha(ui, beat.silhouetteRise, () => {
    // The glowing key is laid under the empty one, so only the glow spilling
    // past its edges shows.
    glows.draw(ctx, kind, view.sockets, size, cx, cy, { kind: 'edge' }, beat.edgeCatch);
    paintKeySilhouette(ctx, cx, cy, size, kind, nothingHeld);
    for (const [index, pulse] of beat.socketPulse.entries()) {
      if (pulse <= 0) continue;
      const lit: KeyGlowPicture = { kind: 'socket', index, litPieces: SOCKET_LIT_PEAK };
      glows.draw(ctx, kind, view.sockets, size, cx, cy, lit, pulse);
      const offset = fragmentPieceOffset(index, view.sockets);
      const x = cx + offset.x * size;
      const y = cy + offset.y * size;
      const reach = size * SOCKET_GLOW_REACH;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const tint = view.theme.ink.socketGlow;
      paintSoftPool(ctx, x, y, reach, reach, tint, pulse * SOCKET_GLOW_ALPHA);
      ctx.restore();
    }
  });
}

function paintTitle(
  ui: IntroPaintTarget,
  view: FloorIntroView,
  layout: IntroLayout,
  beat: IntroBeatState,
): void {
  if (!beat.titleShown) return;
  const { ctx } = ui;
  const { ink } = view.theme;
  const rect = layout.title;
  const cx = rect.x + rect.w * HALF;
  const cy = rect.y + rect.h * HALF;
  const glowAlpha = TITLE_GLOW_ALPHA + TITLE_GLOW_FLASH_ALPHA * beat.flash;
  const titleStyle = { ...layout.titleStyle, upper: true };
  const glowReach = measureText(ui, FIND_THE_KEY_TITLE, { style: titleStyle }) * TITLE_GLOW_REACH;
  paintSoftPool(ctx, cx, cy, glowReach, rect.h * TITLE_GLOW_HEIGHT, ink.titleGlow, glowAlpha);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(beat.titleScale, beat.titleScale);
  ctx.translate(-cx, -cy);
  text(ui, rect, {
    text: FIND_THE_KEY_TITLE,
    style: titleStyle,
    fill: skinsFor(ui.theme).titleLogo.face,
    align: 'center',
    halo: ink.halo,
  });
  ctx.restore();
}

function paintSubline(
  ui: IntroPaintTarget,
  view: FloorIntroView,
  layout: IntroLayout,
  beat: IntroBeatState,
): void {
  withLineAlpha(ui, beat.subline, () => {
    text(ui, layout.subline, {
      text: view.subline,
      style: layout.sublineStyle,
      color: view.theme.ink.subline,
      align: 'center',
      wrap: true,
      maxLines: SUBLINE_MAX_LINES,
      halo: view.theme.ink.halo,
    });
  });
}
