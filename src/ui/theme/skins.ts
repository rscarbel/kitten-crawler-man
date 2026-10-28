/**
 * Named looks for every kind of UI chrome, derived from the tokens in
 * `tokens.ts`. A widget picks a skin by intent (`primary`, `card`, `hp`, …)
 * and never invents colours or sizes of its own; a new look is a new entry
 * here.
 */

import { darken, lighten, mix, withAlpha } from './color';
import {
  carolineFrame,
  FOCUS_RING,
  PRESS_DROP,
  type Elevation,
  type Theme,
  type TypeStyle,
} from './tokens';

export const BUTTON_VARIANTS = [
  'primary',
  'secondary',
  'ghost',
  'danger',
  'success',
  'quiet',
  'glass',
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const CONTROL_SIZES = ['sm', 'md', 'lg'] as const;

export type ControlSize = (typeof CONTROL_SIZES)[number];

/** The three colours of a control in one interaction state. */
export interface ControlColors {
  readonly fill: string;
  readonly border: string;
  readonly text: string;
}

/** A button's colours in every state. Widgets tween between `rest` and `hover`. */
export interface ButtonSkin {
  readonly rest: ControlColors;
  readonly hover: ControlColors;
  readonly press: ControlColors;
  readonly disabled: ControlColors;
  readonly borderWidth: number;
  /** A soft outer glow at rest, or `null` for none. */
  readonly glow: string | null;
}

/** The geometry of a control at one size. */
export interface ControlSizeSkin {
  readonly height: number;
  readonly padX: number;
  /** Space between an icon and the label. */
  readonly gap: number;
  readonly radius: number;
  readonly text: TypeStyle;
  readonly icon: number;
  /** Narrowest the control is drawn, so a one-letter label still makes a target. */
  readonly minWidth: number;
}

export const PANEL_KINDS = [
  'card',
  'sheet',
  'solid',
  'raised',
  'inset',
  'hud',
  'tooltip',
  'popover',
  'caption',
  'glass',
] as const;

export type PanelKind = (typeof PANEL_KINDS)[number];

export interface PanelSkin {
  readonly fill: string;
  readonly border: string;
  readonly borderWidth: number;
  readonly radius: number;
  readonly shadow: Elevation | null;
  readonly padding: number;
}

export const TEXT_ROLES = [
  'caption',
  'body',
  'secondary',
  'muted',
  'label',
  'labelMuted',
  'title',
  'heading',
  'display',
  'overline',
  'value',
  'accent',
  'danger',
  'success',
  'warning',
  'info',
  'inverse',
  'disabled',
] as const;

export type TextRole = (typeof TEXT_ROLES)[number];

export interface TextSkin {
  readonly style: TypeStyle;
  readonly color: string;
}

export const METER_KINDS = [
  'hp',
  'mana',
  'xp',
  'stamina',
  'boss',
  'progress',
  'warning',
  'danger',
] as const;

export type MeterKind = (typeof METER_KINDS)[number];

export interface MeterSkin {
  readonly fill: string;
  /** Fill once the value drops below the low threshold; same as `fill` when the meter has no low state. */
  readonly fillLow: string;
  readonly track: string;
  /** The pale segment lost value leaves behind while it drains. */
  readonly ghost: string;
  readonly height: number;
  readonly radius: number;
}

export interface FocusRingSkin {
  readonly color: string;
  readonly width: number;
  readonly gap: number;
  readonly glow: string;
  readonly glowBlur: number;
}

/** A casino chip: a coloured face per denomination, a contrasting stripe ring and a brass rim. */
export interface CasinoChipSkin {
  readonly faces: readonly string[];
  readonly stripe: string;
  readonly rim: string;
  readonly text: string;
  readonly felt: string;
}

/** One poker chip value's face colour and the ink its value is printed in. */
export interface PokerChipFace {
  readonly face: string;
  readonly label: string;
}

/** A poker table's four chip values, smallest first. */
export type PokerChipSet = readonly [PokerChipFace, PokerChipFace, PokerChipFace, PokerChipFace];

/** The poker tables by stake, each with its own chip colours so a glance tells the stakes apart. */
export type PokerChipSetId = 'penny' | 'card_room' | 'high_rollers';

/** A dialog choice row. `quest` and `exit` tint the label to match the choice's tone. */
export interface DialogChoiceSkin {
  readonly rest: ControlColors;
  readonly hover: ControlColors;
  readonly press: ControlColors;
  readonly selected: ControlColors;
  readonly questText: string;
  readonly exitText: string;
  readonly keyHint: TextSkin;
  readonly text: TypeStyle;
  readonly radius: number;
  readonly height: number;
  readonly padX: number;
}

/** A polished-brass plate: the quest reward banner, the mercenary desk. */
export interface BrassSkin {
  readonly face: string;
  readonly highlight: string;
  readonly shadow: string;
  readonly edge: string;
  readonly text: string;
  readonly engraved: string;
  readonly radius: number;
}

/**
 * The celebration card for a prize the party has just taken (the prison key):
 * a gold-edged glass card with a burst of light behind the prize, big enough
 * to read across the room in the middle of a sneak.
 */
export interface PrizeBannerSkin {
  readonly panel: PanelSkin;
  /** The halo round the card and the burst behind the prize. */
  readonly glow: string;
  readonly glowBlur: number;
  /** The light rays turning behind the prize. */
  readonly rays: string;
  readonly overline: TextSkin;
  readonly title: TextSkin;
  /** The title one step down, for a compact screen. */
  readonly titleCompact: TextSkin;
  readonly subtitle: TextSkin;
  /** The prize's icon on the card, in UI units. */
  readonly iconSize: number;
}

/**
 * The siege's clocktower alert: a danger-edged card shouted across the upper
 * screen, the red pulse round the screen's edges while the bell is out of
 * sight, and the badge pinned to the edge pointing the way back to it.
 */
export interface SiegeAlertSkin {
  readonly panel: PanelSkin;
  /** The card's padding on a compact screen, where every unit of height counts. */
  readonly paddingCompact: number;
  /** The halo round the card. */
  readonly glow: string;
  readonly glowBlur: number;
  readonly headline: TextSkin;
  readonly detail: TextSkin;
  /** The outline round the card's words, which carries them where the see-through card cannot. */
  readonly textHalo: string;
  /** The alarm glyphs either side of the headline. */
  readonly glyph: string;
  readonly glyphSize: number;
  /** The colour the screen's edges pulse in, and how strongly at the pulse's peak. */
  readonly edgePulse: string;
  readonly edgePulsePeakAlpha: number;
  /** How far in from each edge the pulse reaches, in UI units. */
  readonly edgePulseDepth: number;
  /** The edge badge's disc, its glyph and chevron, and the outline round both. */
  readonly markerFill: string;
  readonly markerInk: string;
  readonly markerOutline: string;
  readonly markerSize: number;
  readonly markerCaption: TextSkin;
}

/**
 * The siege's victory: the screen dimmed under gold rays, a headline in the
 * wordmark's proportions, and fireworks over all of it.
 */
export interface SiegeVictorySkin {
  /** The darkening under the celebration, and how dark at its fullest. */
  readonly dim: string;
  readonly dimAlpha: number;
  readonly rays: string;
  readonly headline: TextSkin;
  readonly headlineGlow: string;
  readonly headlineGlowBlur: number;
  readonly subtitle: TextSkin;
  /** The hand-off line pointing the party to the Mayor. */
  readonly handOff: TextSkin;
  /** The fading streak a rocket leaves as it climbs. */
  readonly rocketTrail: string;
}

/** One colour of a {@link TextFillSkin}, `at` 0 (the em box's top) to 1 (its bottom). */
export interface GradientStop {
  readonly at: number;
  readonly color: string;
}

/** A vertical gradient a line of text is filled with, laid across each line's em box. */
export interface TextFillSkin {
  readonly stops: readonly GradientStop[];
}

/** The game's wordmark on the title screen. */
export interface TitleLogoSkin {
  readonly style: TypeStyle;
  /** Polished gold: bright crowns, a dark horizon across the middle, a lit lower lip. */
  readonly face: TextFillSkin;
}

/** A one-shot burst of light over a control: the title menu catching the logo's slam. */
export interface ControlFlashSkin {
  readonly fill: string;
  readonly border: string;
  readonly glow: string;
  readonly glowBlur: number;
}

/**
 * Caroline's frame: a chamfered terminal readout with a cyan hairline,
 * heavier corner brackets, a faint grid and drifting scanlines, a header
 * strip and decoding text. Worn by her alone.
 */
export interface CarolineSkin {
  readonly ground: string;
  readonly groundSheer: string;
  readonly hairline: string;
  readonly hairlineWidth: number;
  readonly bracket: string;
  readonly bracketWidth: number;
  readonly bracketLength: number;
  readonly chamfer: number;
  readonly grid: string;
  readonly gridStep: number;
  readonly scanline: string;
  readonly scanlineStep: number;
  readonly scanlineDriftMs: number;
  readonly padding: number;
  readonly paddingCompact: number;
  readonly label: TextSkin;
  readonly dot: string;
  readonly dotSize: number;
  readonly dotPulseMs: number;
  readonly rule: string;
  readonly ruleWidth: number;
  readonly prefix: TextSkin;
  readonly body: TextSkin;
  readonly cursor: string;
  readonly cursorBlinkMs: number;
  readonly characterMs: number;
  readonly scrambleStepMs: number;
  readonly decodeTail: number;
  readonly lineDrawMs: number;
  readonly unfoldMs: number;
}

/** The title's sound hint: quiet, but readable over the dark hall. */
export interface SoundHintSkin {
  readonly text: TextSkin;
  readonly halo: string;
}

/** A keyboard key drawn as a little cap with a darker bottom edge. */
export interface KeycapSkin {
  readonly fill: string;
  readonly border: string;
  readonly bottomEdge: string;
  /** How far the cap stands proud of its bottom edge, in UI units. */
  readonly depth: number;
  readonly text: TextSkin;
  readonly radius: number;
  readonly height: number;
  readonly minWidth: number;
  readonly padX: number;
}

export interface Skins {
  readonly button: Readonly<Record<ButtonVariant, ButtonSkin>>;
  /** The look of a toggled-on control (a selected tab, a chosen option), whatever its variant. */
  readonly selected: ButtonSkin;
  readonly controlSize: Readonly<Record<ControlSize, ControlSizeSkin>>;
  readonly panel: Readonly<Record<PanelKind, PanelSkin>>;
  readonly text: Readonly<Record<TextRole, TextSkin>>;
  readonly meter: Readonly<Record<MeterKind, MeterSkin>>;
  readonly focusRing: FocusRingSkin;
  /** How far a pressed control drops, in UI units. */
  readonly pressDrop: number;
  readonly scrim: string;
  readonly casinoChip: CasinoChipSkin;
  readonly pokerChips: Readonly<Record<PokerChipSetId, PokerChipSet>>;
  readonly dialogChoice: DialogChoiceSkin;
  readonly questRewardBrass: BrassSkin;
  readonly mercenaryBrass: BrassSkin;
  readonly prizeBanner: PrizeBannerSkin;
  readonly siegeAlert: SiegeAlertSkin;
  readonly siegeVictory: SiegeVictorySkin;
  readonly keycap: KeycapSkin;
  readonly titleLogo: TitleLogoSkin;
  readonly controlFlash: ControlFlashSkin;
  readonly caroline: CarolineSkin;
  readonly soundHint: SoundHintSkin;
}

const HOVER_LIGHTEN = 0.08;
/** The mercenary plate's darker face needs a stronger highlight than a hover to read as polished. */
const MERCENARY_HIGHLIGHT_LIGHTEN = 0.16;
const PRESS_DARKEN = 0.14;
const RAISED_HOVER_LIGHTEN = 0.06;
const GHOST_HOVER_ALPHA = 0.06;
const GHOST_PRESS_ALPHA = 0.03;
const TONE_FILL_ALPHA = 0.16;
const TONE_HOVER_ALPHA = 0.26;
const TONE_PRESS_ALPHA = 0.1;
const TONE_BORDER_ALPHA = 0.5;
const DISABLED_FILL_ALPHA = 0.6;
const PRIMARY_GLOW_ALPHA = 0.35;
const SELECTED_HOVER_ALPHA = 0.22;
const FOCUS_GLOW_ALPHA = 0.45;
const BORDER_WIDTH = 1;
const SMALL_ICON = 14;
const LARGE_ICON = 20;
const BOSS_METER_HEIGHT_STEP = 4;
const MERCENARY_FACE_DARKEN = 0.35;
const KEYCAP_DEPTH = 2;
/** The prize banner's title: past the ramp's display step, so it reads as the moment it is. */
const PRIZE_TITLE_STYLE = {
  size: 40,
  weight: 900,
  lineHeight: 46,
  letterSpacing: 1.5,
  upper: true,
} as const satisfies TypeStyle;
const PRIZE_BORDER_WIDTH = 2;
const PRIZE_GLOW_BLUR = 28;
const PRIZE_RAYS_ALPHA = 0.22;
const PRIZE_ICON_SIZE = 64;
const SIEGE_ALERT_BORDER_WIDTH = 2;
/** Low enough that the fight behind the card stays in view while it holds. */
const SIEGE_ALERT_FILL_ALPHA = 0.35;
const SIEGE_ALERT_GLOW_ALPHA = 0.6;
const SIEGE_ALERT_GLOW_BLUR = 32;
const SIEGE_ALERT_GLYPH_SIZE = 36;
const SIEGE_EDGE_PULSE_PEAK_ALPHA = 0.55;
const SIEGE_EDGE_PULSE_DEPTH = 72;
const SIEGE_MARKER_SIZE = 34;
/** The victory dims the world enough for the headline to own the screen, not hide the village. */
const SIEGE_VICTORY_DIM_ALPHA = 0.35;
const SIEGE_VICTORY_GLOW_BLUR = 36;
const SIEGE_ROCKET_TRAIL_ALPHA = 0.85;
const KEYCAP_SIZE = 20;
/**
 * Where the wordmark's gold changes along the em box. Capitals fill roughly
 * its middle three quarters, so the crown and the lip sit just inside that.
 */
const LOGO_FACE_STOPS = {
  crown: 0.14,
  upper: 0.38,
  horizon: 0.5,
  horizonShadow: 0.54,
  lower: 0.7,
  lip: 0.86,
} as const;
const LOGO_CROWN_LIGHTEN = 0.55;
const LOGO_HORIZON_DARKEN = 0.25;
const LOGO_LIP_LIGHTEN = 0.2;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/**
 * Glass that lets the picture behind it through: a menu laid over a scene
 * meant to be seen (the title), never over gameplay that needs a solid card.
 */
const GLASS_PANEL_ALPHA = 0.34;
const GLASS_BUTTON_ALPHA = 0.5;
const GLASS_BUTTON_HOVER_ALPHA = 0.66;
const GLASS_BUTTON_PRESS_ALPHA = 0.74;
const FLASH_FILL_ALPHA = 0.55;
const FLASH_GLOW_ALPHA = 0.8;

function toneButton(theme: Theme, tone: string): ButtonSkin {
  return {
    rest: {
      fill: withAlpha(tone, TONE_FILL_ALPHA),
      border: withAlpha(tone, TONE_BORDER_ALPHA),
      text: tone,
    },
    hover: {
      fill: withAlpha(tone, TONE_HOVER_ALPHA),
      border: tone,
      text: lighten(tone, HOVER_LIGHTEN),
    },
    press: { fill: withAlpha(tone, TONE_PRESS_ALPHA), border: tone, text: tone },
    disabled: disabledColors(theme),
    borderWidth: BORDER_WIDTH,
    glow: null,
  };
}

function disabledColors(theme: Theme): ControlColors {
  const { palette } = theme;
  return {
    fill: withAlpha(palette.surface.raised, DISABLED_FILL_ALPHA),
    border: palette.border.subtle,
    text: palette.text.disabled,
  };
}

function buildButtons(theme: Theme): Record<ButtonVariant, ButtonSkin> {
  const { palette } = theme;
  const disabled = disabledColors(theme);
  return {
    primary: {
      rest: { fill: palette.accent.base, border: palette.accent.base, text: palette.text.inverse },
      hover: {
        fill: palette.accent.hover,
        border: palette.accent.hover,
        text: palette.text.inverse,
      },
      press: {
        fill: palette.accent.press,
        border: palette.accent.press,
        text: palette.text.inverse,
      },
      disabled,
      borderWidth: BORDER_WIDTH,
      glow: withAlpha(palette.accent.base, PRIMARY_GLOW_ALPHA),
    },
    secondary: {
      rest: {
        fill: palette.surface.raised,
        border: palette.border.subtle,
        text: palette.text.primary,
      },
      hover: {
        fill: lighten(palette.surface.raised, RAISED_HOVER_LIGHTEN),
        border: palette.border.strong,
        text: palette.text.primary,
      },
      press: {
        fill: palette.surface.sunken,
        border: palette.border.strong,
        text: palette.text.primary,
      },
      disabled,
      borderWidth: BORDER_WIDTH,
      glow: null,
    },
    ghost: {
      rest: { fill: TRANSPARENT, border: palette.border.subtle, text: palette.text.primary },
      hover: {
        fill: withAlpha(palette.text.primary, GHOST_HOVER_ALPHA),
        border: palette.border.strong,
        text: palette.text.primary,
      },
      press: {
        fill: withAlpha(palette.text.primary, GHOST_PRESS_ALPHA),
        border: palette.border.strong,
        text: palette.text.secondary,
      },
      disabled: { ...disabled, fill: TRANSPARENT },
      borderWidth: BORDER_WIDTH,
      glow: null,
    },
    danger: toneButton(theme, palette.state.danger),
    success: toneButton(theme, palette.state.success),
    quiet: {
      rest: { fill: TRANSPARENT, border: TRANSPARENT, text: palette.text.secondary },
      hover: {
        fill: withAlpha(palette.text.primary, GHOST_HOVER_ALPHA),
        border: TRANSPARENT,
        text: palette.text.primary,
      },
      press: {
        fill: withAlpha(palette.text.primary, GHOST_PRESS_ALPHA),
        border: TRANSPARENT,
        text: palette.text.primary,
      },
      disabled: { fill: TRANSPARENT, border: TRANSPARENT, text: palette.text.disabled },
      borderWidth: 0,
      glow: null,
    },
    glass: {
      rest: {
        fill: withAlpha(palette.surface.solid, GLASS_BUTTON_ALPHA),
        border: palette.border.strong,
        text: palette.text.primary,
      },
      hover: {
        fill: withAlpha(palette.surface.raised, GLASS_BUTTON_HOVER_ALPHA),
        border: withAlpha(palette.accent.base, TONE_BORDER_ALPHA),
        text: palette.text.primary,
      },
      press: {
        fill: withAlpha(palette.surface.sunken, GLASS_BUTTON_PRESS_ALPHA),
        border: palette.border.strong,
        text: palette.text.primary,
      },
      disabled,
      borderWidth: BORDER_WIDTH,
      glow: null,
    },
  };
}

function buildSelected(theme: Theme): ButtonSkin {
  const { palette } = theme;
  return {
    rest: { fill: palette.accent.soft, border: palette.accent.base, text: palette.accent.base },
    hover: {
      fill: withAlpha(palette.accent.base, SELECTED_HOVER_ALPHA),
      border: palette.accent.hover,
      text: palette.accent.hover,
    },
    press: { fill: palette.accent.soft, border: palette.accent.press, text: palette.accent.press },
    disabled: disabledColors(theme),
    borderWidth: BORDER_WIDTH,
    glow: null,
  };
}

function buildControlSizes(theme: Theme): Record<ControlSize, ControlSizeSkin> {
  const { space, radius, type, size } = theme;
  return {
    sm: {
      height: size.control - space.sm,
      padX: space.sm,
      gap: space.xs,
      radius: radius.sm,
      text: type.caption,
      icon: SMALL_ICON,
      minWidth: size.control - space.sm,
    },
    md: {
      height: size.control,
      padX: space.md,
      gap: space.sm,
      radius: radius.md,
      text: type.label,
      icon: size.icon,
      minWidth: size.control,
    },
    lg: {
      height: size.control + space.md,
      padX: space.lg,
      gap: space.sm,
      radius: radius.md,
      text: type.title,
      icon: LARGE_ICON,
      minWidth: size.control + space.md,
    },
  };
}

function buildPanels(theme: Theme): Record<PanelKind, PanelSkin> {
  const { palette, radius, space, elevation } = theme;
  return {
    card: {
      fill: palette.surface.base,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.lg,
      shadow: elevation.panel,
      padding: space.lg,
    },
    sheet: {
      fill: palette.surface.base,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.lg,
      shadow: elevation.panel,
      padding: space.lg,
    },
    solid: {
      fill: palette.surface.solid,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.lg,
      shadow: elevation.panel,
      padding: space.lg,
    },
    raised: {
      fill: palette.surface.raised,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.md,
      shadow: null,
      padding: space.md,
    },
    inset: {
      fill: palette.surface.sunken,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.sm,
      shadow: null,
      padding: space.sm,
    },
    hud: {
      fill: palette.surface.base,
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.md,
      shadow: elevation.hud,
      padding: space.sm,
    },
    tooltip: {
      fill: palette.surface.raised,
      border: palette.border.strong,
      borderWidth: BORDER_WIDTH,
      radius: radius.sm,
      shadow: elevation.hud,
      padding: space.sm,
    },
    popover: {
      fill: palette.surface.base,
      border: palette.border.strong,
      borderWidth: BORDER_WIDTH,
      radius: radius.md,
      shadow: elevation.panel,
      padding: space.md,
    },
    glass: {
      fill: withAlpha(palette.surface.solid, GLASS_PANEL_ALPHA),
      border: palette.border.subtle,
      borderWidth: BORDER_WIDTH,
      radius: radius.lg,
      shadow: null,
      padding: space.sm,
    },
    // Opaque, so a caption reads at full contrast over any floor, fog or flash.
    caption: {
      fill: palette.surface.solid,
      border: palette.border.strong,
      borderWidth: BORDER_WIDTH,
      radius: radius.sm,
      shadow: elevation.hud,
      padding: space.sm,
    },
  };
}

function buildText(theme: Theme): Record<TextRole, TextSkin> {
  const { palette, type } = theme;
  return {
    caption: { style: type.caption, color: palette.text.secondary },
    body: { style: type.body, color: palette.text.primary },
    secondary: { style: type.body, color: palette.text.secondary },
    muted: { style: type.caption, color: palette.text.muted },
    label: { style: type.label, color: palette.text.primary },
    labelMuted: { style: type.label, color: palette.text.secondary },
    title: { style: type.title, color: palette.text.primary },
    heading: { style: type.heading, color: palette.text.primary },
    display: { style: type.display, color: palette.text.primary },
    overline: { style: type.overline, color: palette.text.muted },
    value: { style: type.title, color: palette.text.primary },
    accent: { style: type.label, color: palette.accent.base },
    danger: { style: type.body, color: palette.state.danger },
    success: { style: type.body, color: palette.state.success },
    warning: { style: type.body, color: palette.state.warning },
    info: { style: type.body, color: palette.state.info },
    inverse: { style: type.label, color: palette.text.inverse },
    disabled: { style: type.body, color: palette.text.disabled },
  };
}

function buildMeters(theme: Theme): Record<MeterKind, MeterSkin> {
  const { palette, space, radius } = theme;
  const meter = (fill: string, fillLow: string = fill): MeterSkin => ({
    fill,
    fillLow,
    track: palette.meter.track,
    ghost: palette.meter.ghost,
    height: space.sm,
    radius: radius.pill,
  });
  return {
    hp: meter(palette.meter.hp, palette.meter.hpLow),
    mana: meter(palette.meter.mana),
    xp: meter(palette.meter.xp),
    stamina: meter(palette.meter.stamina),
    boss: { ...meter(palette.meter.boss), height: space.sm + BOSS_METER_HEIGHT_STEP },
    progress: meter(palette.accent.base),
    warning: meter(palette.state.warning),
    danger: meter(palette.state.danger),
  };
}

function buildDialogChoice(theme: Theme): DialogChoiceSkin {
  const { palette, radius, size, space, type } = theme;
  return {
    rest: {
      fill: palette.surface.raised,
      border: palette.border.subtle,
      text: palette.text.primary,
    },
    hover: {
      fill: lighten(palette.surface.raised, RAISED_HOVER_LIGHTEN),
      border: palette.border.strong,
      text: palette.text.primary,
    },
    press: {
      fill: palette.surface.sunken,
      border: palette.border.strong,
      text: palette.text.primary,
    },
    selected: {
      fill: palette.accent.soft,
      border: palette.accent.base,
      text: palette.text.primary,
    },
    questText: palette.accent.base,
    exitText: palette.text.secondary,
    keyHint: { style: type.caption, color: palette.text.muted },
    text: type.body,
    radius: radius.md,
    height: size.row,
    padX: space.md,
  };
}

function buildBrass(theme: Theme): { quest: BrassSkin; mercenary: BrassSkin } {
  const { palette, radius } = theme;
  const { material } = palette;
  const quest: BrassSkin = {
    face: material.brass,
    highlight: material.brassLight,
    shadow: material.brassDark,
    edge: darken(material.brassDark, PRESS_DARKEN),
    text: palette.text.inverse,
    engraved: material.brassDark,
    radius: radius.md,
  };
  const mercenaryFace = mix(material.brass, material.brassDark, MERCENARY_FACE_DARKEN);
  return {
    quest,
    mercenary: {
      ...quest,
      face: mercenaryFace,
      highlight: lighten(mercenaryFace, MERCENARY_HIGHLIGHT_LIGHTEN),
      text: material.brassLight,
      engraved: darken(material.brassDark, PRESS_DARKEN),
      radius: radius.sm,
    },
  };
}

function buildTitleLogo(theme: Theme): TitleLogoSkin {
  const { material, accent } = theme.palette;
  return {
    style: theme.type.logo,
    face: {
      stops: [
        { at: LOGO_FACE_STOPS.crown, color: lighten(material.brassLight, LOGO_CROWN_LIGHTEN) },
        { at: LOGO_FACE_STOPS.upper, color: accent.celebrate },
        { at: LOGO_FACE_STOPS.horizon, color: material.brass },
        {
          at: LOGO_FACE_STOPS.horizonShadow,
          color: darken(material.brass, LOGO_HORIZON_DARKEN),
        },
        { at: LOGO_FACE_STOPS.lower, color: accent.celebrate },
        { at: LOGO_FACE_STOPS.lip, color: lighten(material.brassLight, LOGO_LIP_LIGHTEN) },
      ],
    },
  };
}

function buildCaroline(theme: Theme): CarolineSkin {
  const { palette, type, space, motion } = theme;
  const ink = palette.caroline;
  return {
    ground: ink.ground,
    groundSheer: ink.groundSheer,
    hairline: ink.hairline,
    hairlineWidth: carolineFrame.hairlineWidth,
    bracket: ink.bracket,
    bracketWidth: carolineFrame.bracketWidth,
    bracketLength: carolineFrame.bracketLength,
    chamfer: carolineFrame.chamfer,
    grid: ink.grid,
    gridStep: carolineFrame.gridStep,
    scanline: ink.scanline,
    scanlineStep: carolineFrame.scanlineStep,
    scanlineDriftMs: motion.carolineScanlineDrift,
    padding: space.md,
    paddingCompact: space.sm,
    label: { style: type.carolineLabel, color: ink.label },
    dot: ink.dot,
    dotSize: carolineFrame.dotSize,
    dotPulseMs: motion.carolineDotPulse,
    rule: ink.rule,
    ruleWidth: carolineFrame.ruleWidth,
    prefix: { style: type.body, color: ink.prefix },
    body: { style: type.body, color: ink.body },
    cursor: ink.cursor,
    cursorBlinkMs: motion.carolineCursorBlink,
    characterMs: motion.carolineCharacter,
    scrambleStepMs: motion.carolineScrambleStep,
    decodeTail: carolineFrame.decodeTail,
    lineDrawMs: motion.carolineLineDraw,
    unfoldMs: motion.carolineUnfold,
  };
}

function buildSkins(theme: Theme): Skins {
  const { palette, space, radius, type, elevation } = theme;
  const brass = buildBrass(theme);
  return {
    button: buildButtons(theme),
    selected: buildSelected(theme),
    controlSize: buildControlSizes(theme),
    panel: buildPanels(theme),
    text: buildText(theme),
    meter: buildMeters(theme),
    focusRing: {
      color: palette.border.focus,
      width: FOCUS_RING.width,
      gap: FOCUS_RING.gap,
      glow: withAlpha(palette.border.focus, FOCUS_GLOW_ALPHA),
      glowBlur: FOCUS_RING.glowBlur,
    },
    pressDrop: PRESS_DROP,
    scrim: palette.surface.scrim,
    casinoChip: {
      faces: [
        palette.material.chipWhite,
        palette.material.chipRed,
        palette.material.chipBlue,
        palette.material.chipBlack,
      ],
      stripe: palette.material.chipWhite,
      rim: palette.material.brass,
      text: palette.text.primary,
      felt: palette.material.felt,
    },
    pokerChips: buildPokerChips(theme),
    titleLogo: buildTitleLogo(theme),
    controlFlash: {
      fill: withAlpha(palette.accent.hover, FLASH_FILL_ALPHA),
      border: palette.accent.hover,
      glow: withAlpha(palette.accent.hover, FLASH_GLOW_ALPHA),
      glowBlur: space.xl,
    },
    caroline: buildCaroline(theme),
    soundHint: {
      text: { style: type.hint, color: palette.text.secondary },
      halo: palette.surface.sunken,
    },
    dialogChoice: buildDialogChoice(theme),
    questRewardBrass: brass.quest,
    mercenaryBrass: brass.mercenary,
    prizeBanner: {
      panel: {
        fill: palette.surface.base,
        border: palette.accent.base,
        borderWidth: PRIZE_BORDER_WIDTH,
        radius: radius.lg,
        shadow: elevation.panel,
        padding: space.lg,
      },
      glow: palette.accent.base,
      glowBlur: PRIZE_GLOW_BLUR,
      rays: withAlpha(palette.accent.hover, PRIZE_RAYS_ALPHA),
      overline: { style: type.overline, color: palette.state.success },
      title: { style: PRIZE_TITLE_STYLE, color: palette.accent.base },
      titleCompact: { style: { ...type.display, upper: true }, color: palette.accent.base },
      subtitle: { style: type.title, color: palette.text.primary },
      iconSize: PRIZE_ICON_SIZE,
    },
    siegeAlert: {
      panel: {
        fill: withAlpha(palette.surface.solid, SIEGE_ALERT_FILL_ALPHA),
        border: palette.state.danger,
        borderWidth: SIEGE_ALERT_BORDER_WIDTH,
        radius: radius.lg,
        shadow: null,
        padding: space.lg,
      },
      paddingCompact: space.sm,
      glow: withAlpha(palette.state.danger, SIEGE_ALERT_GLOW_ALPHA),
      glowBlur: SIEGE_ALERT_GLOW_BLUR,
      headline: { style: type.alarm, color: palette.state.danger },
      detail: { style: type.heading, color: palette.text.primary },
      textHalo: palette.surface.sunken,
      glyph: palette.state.danger,
      glyphSize: SIEGE_ALERT_GLYPH_SIZE,
      edgePulse: palette.state.danger,
      edgePulsePeakAlpha: SIEGE_EDGE_PULSE_PEAK_ALPHA,
      edgePulseDepth: SIEGE_EDGE_PULSE_DEPTH,
      markerFill: palette.surface.solid,
      markerInk: palette.state.danger,
      markerOutline: palette.surface.sunken,
      markerSize: SIEGE_MARKER_SIZE,
      markerCaption: { style: type.caption, color: palette.text.primary },
    },
    siegeVictory: {
      dim: palette.surface.sunken,
      dimAlpha: SIEGE_VICTORY_DIM_ALPHA,
      rays: palette.accent.base,
      headline: { style: type.fanfare, color: palette.material.brassLight },
      headlineGlow: palette.accent.base,
      headlineGlowBlur: SIEGE_VICTORY_GLOW_BLUR,
      subtitle: { style: type.display, color: palette.text.primary },
      handOff: { style: type.title, color: palette.accent.base },
      rocketTrail: withAlpha(palette.material.brassLight, SIEGE_ROCKET_TRAIL_ALPHA),
    },
    keycap: {
      fill: palette.surface.raised,
      border: palette.border.strong,
      bottomEdge: palette.surface.sunken,
      depth: KEYCAP_DEPTH,
      text: { style: type.label, color: palette.text.primary },
      radius: radius.sm,
      height: KEYCAP_SIZE,
      minWidth: KEYCAP_SIZE,
      padX: space.xs,
    },
  };
}

/**
 * The penny table plays the classic white, red, green and black; the card room
 * and the high rollers each get their own run of colours, so a stack of chips
 * says which table it came from before its value is read.
 */
function buildPokerChips(theme: Theme): Record<PokerChipSetId, PokerChipSet> {
  const { material, text: ink } = theme.palette;
  const light = (face: string): PokerChipFace => ({ face, label: ink.inverse });
  const dark = (face: string): PokerChipFace => ({ face, label: material.chipWhite });
  return {
    penny: [
      light(material.chipWhite),
      dark(material.chipRed),
      dark(material.chipGreen),
      dark(material.chipBlack),
    ],
    card_room: [
      dark(material.chipBlue),
      dark(material.chipOrange),
      dark(material.chipPurple),
      light(material.brass),
    ],
    high_rollers: [
      dark(material.chipBlack),
      dark(material.chipPink),
      dark(material.chipTeal),
      light(material.chipSilver),
    ],
  };
}

const skinCache = new WeakMap<Theme, Skins>();

/** The skins for `theme`, built once per resolved theme. */
export function skinsFor(theme: Theme): Skins {
  const cached = skinCache.get(theme);
  if (cached !== undefined) return cached;
  const skins = buildSkins(theme);
  skinCache.set(theme, skins);
  return skins;
}
