/** Pieces the choice-modal dialogs share: the power-up hero, the attack-key swallow and the keyboard hint. */

import { keybindings } from '../../../core/Keybindings';
import { centerIn, splitV, type Rect } from '../../core/geom';
import { type KeyModifiers, type Ui, ACTIVATE_KEYS } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import type { GlyphId } from '../../theme/glyphs';
import type { TextRole } from '../../theme/skins';
import type { PanelWidth } from '../../theme/tokens';
import type { HeroArt } from '../../widgets/choiceModal';
import { panelBodyWidth } from '../../widgets/panel';
import { measureTextHeight, text } from '../../widgets/text';

/** The hero band's height round a power-up icon, leaving room for the glow ring to grow. */
const POWER_UP_HERO_HEIGHT = 104;
const POWER_UP_ICON_SIZE = 56;
/** Phones have a few hundred units of height: the hero shrinks so the card's words and OK fit unscrolled. */
const POWER_UP_HERO_HEIGHT_COMPACT = 60;
const POWER_UP_ICON_SIZE_COMPACT = 40;
const FULL_TURN = Math.PI * 2;
/** How many swells the icon makes over the pulse. */
const PULSE_SWELLS = 3;
const PULSE_SCALE_AMPLITUDE = 0.3;
/** The ring starts at the icon's half-width and grows by this much over the pulse. */
const GLOW_RADIUS_GROWTH = 24;
const GLOW_RING_ALPHA = 0.6;
/** How many times the ring flickers over the pulse. */
const GLOW_FLICKERS = 4;
const GLOW_RING_WIDTH = 2;
const HALF = 0.5;
/** The soft halo behind a settled icon. */
const SETTLED_HALO_ALPHA = 0.12;
const SETTLED_HALO_RADIUS_RATIO = 0.8;

export interface PowerUpHeroOptions {
  /** 0 to 1 through the pulse. */
  readonly pulse: number;
  readonly poweringUp: boolean;
  readonly paintIcon: (ctx: CanvasRenderingContext2D, icon: Rect) => void;
}

/**
 * The award cards' picture: the granted icon swelling in with a flickering
 * ring while it powers up, then resting on a soft halo.
 */
export function powerUpHero(ui: Ui, opts: PowerUpHeroOptions): HeroArt {
  const glow = ui.theme.palette.accent.base;
  const compact = ui.size === 'compact';
  const iconSize = compact ? POWER_UP_ICON_SIZE_COMPACT : POWER_UP_ICON_SIZE;
  return {
    height: compact ? POWER_UP_HERO_HEIGHT_COMPACT : POWER_UP_HERO_HEIGHT,
    paint: (ctx, rect) => {
      const icon = centerIn(rect, iconSize, iconSize);
      const cx = icon.x + icon.w * HALF;
      const cy = icon.y + icon.h * HALF;
      ctx.save();
      if (opts.poweringUp) {
        const swell = Math.sin(opts.pulse * FULL_TURN * PULSE_SWELLS) * PULSE_SCALE_AMPLITUDE;
        const scale = 1 + swell;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        const flicker = HALF + HALF * Math.sin(opts.pulse * FULL_TURN * GLOW_FLICKERS);
        ctx.strokeStyle = withAlpha(glow, opts.pulse * GLOW_RING_ALPHA * flicker);
        ctx.lineWidth = GLOW_RING_WIDTH;
        ctx.beginPath();
        ctx.arc(cx, cy, icon.w * HALF + opts.pulse * GLOW_RADIUS_GROWTH, 0, FULL_TURN);
        ctx.stroke();
      } else {
        ctx.fillStyle = withAlpha(glow, SETTLED_HALO_ALPHA);
        ctx.beginPath();
        ctx.arc(cx, cy, icon.w * SETTLED_HALO_RADIUS_RATIO, 0, FULL_TURN);
        ctx.fill();
      }
      opts.paintIcon(ctx, icon);
      ctx.restore();
    },
  };
}

/**
 * Consumes the attack key so a press aimed at a dialog never swings in the
 * world beneath it. While `defaultLive`, Space and Enter pass on so they can
 * press the dialog's default button.
 */
export function swallowAttackKey(key: string, mods: KeyModifiers, defaultLive: boolean): boolean {
  if (keybindings.actionFor(key) !== 'attack') return false;
  if (defaultLive && ACTIVATE_KEYS.has(key) && mods.repeat !== true) return false;
  return true;
}

/** One block of a choice modal's `extra` content. */
export interface ExtraPart {
  readonly height: number;
  readonly draw: (rect: Rect) => void;
}

/** Wrapped, centred text sized for a choice modal of `width`. */
export function textPart(ui: Ui, width: PanelWidth, content: string, role: TextRole): ExtraPart {
  const height = measureTextHeight(ui, panelBodyWidth(ui, width), { text: content, role });
  return {
    height,
    draw: (rect) => text(ui, rect, { text: content, role, align: 'center', wrap: true }),
  };
}

/** The parts one above another, `space.sm` apart; undefined when there are none. */
export function stackParts(ui: Ui, parts: readonly (ExtraPart | null)[]): ExtraPart | undefined {
  const present = parts.filter((part): part is ExtraPart => part !== null);
  if (present.length === 0) return undefined;
  const gap = ui.theme.space.sm;
  return {
    height: present.reduce((sum, part) => sum + part.height, 0) + gap * (present.length - 1),
    draw: (rect) => {
      const rows = splitV(
        rect,
        present.map((part) => part.height),
        gap,
      );
      present.forEach((part, index) => part.draw(rows[index] ?? rect));
    },
  };
}

/** A muted line naming the keys that answer a prompt; only where there is a keyboard. */
export function keyboardHint(ui: Ui, width: PanelWidth, hint: string): ExtraPart | null {
  return ui.density === 'pointer' ? textPart(ui, width, hint, 'muted') : null;
}

/** A prompt's icon disc, left off on phones where its height is better spent on the question. */
export function iconUnlessCompact(ui: Ui, glyph: GlyphId): GlyphId | undefined {
  return ui.size === 'compact' ? undefined : glyph;
}
