/**
 * The siege's victory as a spectacle: the world dims under turning gold rays,
 * VICTORY! slams in over fireworks and confetti, and a last line hands the
 * party on to the Mayor, who gives the reward.
 *
 * It floats over live play and registers no regions, so the world runs on
 * and every tap passes through. The fireworks follow the siege's own launch
 * schedule (`fireworkSchedule`), the one its whistles and bursts are played
 * from, and step with the fanfare's frames rather than the render clock, so
 * they hold still under a pause along with the silence.
 */

import { UPDATES_PER_SECOND } from '../../systems/briarHollow/structureRules';
import {
  VICTORY_FANFARE_FRAMES,
  fireworkSchedule,
} from '../../systems/briarHollow/victoryFireworks';
import type { Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { condensedType, type TypeStyle } from '../theme/tokens';
import { text } from '../widgets/text';
import {
  Confetti,
  FireworkRockets,
  Sparkles,
  clamp01,
  confettiColors,
  drawBackdrop,
  drawRays,
  fitStyleToWidth,
  glowText,
  seconds,
  sparkleColors,
} from '../screens/dialogs/endScreenParts';

/** What the celebration reads each frame: frames since the siege was won. */
export interface SiegeVictoryCelebration {
  readonly ageFrames: number;
}

const HALF = 0.5;
const CUBIC = 3;
const HEADLINE = 'Victory!';
const SUBTITLE = 'Briar Hollow is saved!';
const HAND_OFF = 'Speak with Mayor Bramblewick for your reward';
const DIM_FADE_IN_SECONDS = 0.4;
const DIM_FADE_OUT_SECONDS = 1.5;
const BURST_SPARKS = 60;
/** A phone draws half the rockets and half the sparks, and none of the sparks' glow. */
const COMPACT_SHARE = 0.5;
const COMPACT_ROCKET_EVERY = 2;
const CONFETTI_FROM_SECONDS = 1;
const CONFETTI_SPAWN_EVERY_FRAMES = 2;
/** Rockets start this far below the screen's bottom edge, so they rise into view. */
const ROCKET_START_BELOW = 16;
/** The headline swells to this before settling, over {@link SLAM_SECONDS}. */
const SLAM_PEAK_SCALE = 1.15;
const SLAM_SECONDS = 0.5;
/** The share of the slam spent swelling to its peak; the rest settles. */
const SLAM_PEAK_SHARE = 0.6;
/** The settled headline breathes by this much either way. */
const BREATHE_SCALE = 0.02;
const BREATHE_RADIANS_PER_SECOND = 2.4;
/** The non-compact headline never shrinks below twice the display step. */
const HEADLINE_FLOOR_SCALE = 2;
const SUBTITLE_FROM_SECONDS = 0.4;
const HAND_OFF_FROM_SECONDS = 6;
const LINE_FADE_SECONDS = 0.4;
/** The headline block's middle sits this far down the screen. */
const BLOCK_CENTRE_FRACTION = 0.4;
/** The rays fan out from a box this many times the headline's height. */
const RAYS_REACH = 4;

function framesAt(secondsIn: number): number {
  return secondsIn * UPDATES_PER_SECOND;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** CUBIC;
}

/** The darkening and the effects fade in at the start and out over the last stretch. */
function envelope(ageFrames: number): number {
  const fadeIn = clamp01(ageFrames / framesAt(DIM_FADE_IN_SECONDS));
  const fadeOut = clamp01((VICTORY_FANFARE_FRAMES - ageFrames) / framesAt(DIM_FADE_OUT_SECONDS));
  return Math.min(fadeIn, fadeOut);
}

function headlineScale(ageFrames: number, nowSeconds: number): number {
  const t = clamp01(ageFrames / framesAt(SLAM_SECONDS));
  if (t < SLAM_PEAK_SHARE) return SLAM_PEAK_SCALE * easeOutCubic(t / SLAM_PEAK_SHARE);
  if (t < 1) {
    const settle = (t - SLAM_PEAK_SHARE) / (1 - SLAM_PEAK_SHARE);
    return SLAM_PEAK_SCALE + (1 - SLAM_PEAK_SCALE) * settle;
  }
  return 1 + BREATHE_SCALE * Math.sin(nowSeconds * BREATHE_RADIANS_PER_SECOND);
}

/** The particle state one mounted celebration carries, stepped to the fanfare's age. */
class CelebrationEffects {
  readonly sparkles = new Sparkles();
  readonly rockets = new FireworkRockets();
  readonly confetti = new Confetti();
  /** The age last stepped to; -1 before the first step. */
  private steppedTo = -1;

  /**
   * Steps every effect frame by frame up to `ageFrames`, catching up all at
   * once when the celebration is first drawn part-way through. A clock that
   * ran backwards is a new celebration, started from nothing.
   */
  stepTo(ui: Ui, ageFrames: number): void {
    if (ageFrames < this.steppedTo) this.reset();
    const compact = ui.size === 'compact';
    const sparksPerBurst = compact ? Math.round(BURST_SPARKS * COMPACT_SHARE) : BURST_SPARKS;
    const sparkColors = sparkleColors(ui.theme);
    const paperColors = confettiColors(ui.theme);
    const area = ui.screen;
    while (this.steppedTo < ageFrames) {
      this.steppedTo++;
      const frame = this.steppedTo;
      for (const rocket of fireworkSchedule(frame).launches) {
        if (compact && rocket.index % COMPACT_ROCKET_EVERY !== 0) continue;
        this.rockets.launch(
          area.x + area.w * rocket.xShare,
          area.y + area.h + ROCKET_START_BELOW,
          area.y + area.h * rocket.apexShare,
          rocket.burstFrame - rocket.launchFrame,
          sparksPerBurst,
        );
      }
      this.rockets.tick(this.sparkles, sparkColors);
      this.sparkles.tick();
      const spawnEvery = compact
        ? CONFETTI_SPAWN_EVERY_FRAMES * COMPACT_ROCKET_EVERY
        : CONFETTI_SPAWN_EVERY_FRAMES;
      const confettiFalls =
        frame >= framesAt(CONFETTI_FROM_SECONDS) &&
        frame < VICTORY_FANFARE_FRAMES - framesAt(DIM_FADE_OUT_SECONDS);
      if (confettiFalls && frame % spawnEvery === 0) this.confetti.spawn(area, paperColors);
      this.confetti.tick(area);
    }
  }

  private reset(): void {
    this.sparkles.clear();
    this.rockets.clear();
    this.confetti.clear();
    this.steppedTo = -1;
  }
}

interface Lines {
  readonly headline: Rect;
  readonly headlineStyle: TypeStyle;
  readonly subtitle: Rect;
  readonly subtitleStyle: TypeStyle;
  readonly handOff: Rect;
  readonly handOffStyle: TypeStyle;
}

function layoutLines(ui: Ui): Lines {
  const skin = skinsFor(ui.theme).siegeVictory;
  const { space, type } = ui.theme;
  const compact = ui.size === 'compact';
  const width = ui.viewport.w - space.lg * 2;
  const display = type.display;
  const floor: TypeStyle = compact
    ? display
    : {
        ...display,
        size: display.size * HEADLINE_FLOOR_SCALE,
        lineHeight: display.lineHeight * HEADLINE_FLOOR_SCALE,
      };
  const headlineStyle = fitStyleToWidth(ui, HEADLINE, skin.headline.style, floor, width);
  const subtitleStyle = compact ? type[condensedType.display] : skin.subtitle.style;
  const handOffStyle = compact ? type[condensedType.title] : skin.handOff.style;
  const blockH =
    headlineStyle.lineHeight +
    space.sm +
    subtitleStyle.lineHeight +
    space.md +
    handOffStyle.lineHeight;
  const top = ui.viewport.y + ui.viewport.h * BLOCK_CENTRE_FRACTION - blockH * HALF;
  const x = ui.viewport.x + space.lg;
  const headline: Rect = {
    x,
    y: Math.max(ui.viewport.y, top),
    w: width,
    h: headlineStyle.lineHeight,
  };
  const subtitle: Rect = {
    x,
    y: headline.y + headline.h + space.sm,
    w: width,
    h: subtitleStyle.lineHeight,
  };
  const handOff: Rect = {
    x,
    y: subtitle.y + subtitle.h + space.md,
    w: width,
    h: handOffStyle.lineHeight,
  };
  return { headline, headlineStyle, subtitle, subtitleStyle, handOff, handOffStyle };
}

function lineAlpha(ageFrames: number, fromSeconds: number): number {
  return clamp01((ageFrames - framesAt(fromSeconds)) / framesAt(LINE_FADE_SECONDS));
}

function renderCelebration(ui: Ui, effects: CelebrationEffects, ageFrames: number): void {
  const { ctx } = ui;
  const skin = skinsFor(ui.theme).siegeVictory;
  const nowSeconds = seconds(ui);
  const compact = ui.size === 'compact';
  effects.stepTo(ui, ageFrames);
  const shown = envelope(ageFrames);
  drawBackdrop(ui, skin.dimAlpha * shown);

  const lines = layoutLines(ui);
  const headlineCentreX = lines.headline.x + lines.headline.w * HALF;
  const headlineCentreY = lines.headline.y + lines.headline.h * HALF;
  const raysSide = lines.headline.h * RAYS_REACH;
  drawRays(
    ctx,
    {
      x: headlineCentreX - raysSide * HALF,
      y: headlineCentreY - raysSide * HALF,
      w: raysSide,
      h: raysSide,
    },
    skin.rays,
    shown,
    nowSeconds,
  );

  effects.rockets.draw(ctx, skin.rocketTrail, shown);
  effects.sparkles.draw(ctx, shown, nowSeconds, !compact);
  effects.confetti.draw(ctx, shown);

  ctx.save();
  ctx.globalAlpha *= shown;
  const scale = headlineScale(ageFrames, nowSeconds);
  if (scale > 0) {
    ctx.save();
    ctx.translate(headlineCentreX, headlineCentreY);
    ctx.scale(scale, scale);
    ctx.translate(-headlineCentreX, -headlineCentreY);
    glowText(ui, lines.headline, {
      text: HEADLINE,
      style: lines.headlineStyle,
      color: skin.headline.color,
      glow: skin.headlineGlow,
      glowBlur: compact ? 0 : skin.headlineGlowBlur,
    });
    ctx.restore();
  }
  const subtitleAlpha = lineAlpha(ageFrames, SUBTITLE_FROM_SECONDS);
  if (subtitleAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= subtitleAlpha;
    text(ui, lines.subtitle, {
      text: SUBTITLE,
      style: lines.subtitleStyle,
      color: skin.subtitle.color,
      align: 'center',
      halo: skin.dim,
    });
    ctx.restore();
  }
  const handOffAlpha = lineAlpha(ageFrames, HAND_OFF_FROM_SECONDS);
  if (handOffAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= handOffAlpha;
    text(ui, lines.handOff, {
      text: HAND_OFF,
      style: lines.handOffStyle,
      color: skin.handOff.color,
      align: 'center',
      halo: skin.dim,
    });
    ctx.restore();
  }
  ctx.restore();
}

/** The victory celebration as a floating surface over live play. Mount once. */
export function siegeVictorySurface(
  id: string,
  model: () => SiegeVictoryCelebration | null,
): Surface {
  const effects = new CelebrationEffects();
  return {
    id,
    band: 'toast',
    haltsWorld: false,
    isOpen: () => model() !== null,
    render: (ui) => {
      const celebration = model();
      if (celebration !== null) renderCelebration(ui, effects, celebration.ageFrames);
    },
  };
}
