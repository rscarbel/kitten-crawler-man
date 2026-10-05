/**
 * Named looks for every kind of UI chrome, derived from the tokens in
 * `tokens.ts`. A widget picks a skin by intent (`primary`, `card`, `hp`, …)
 * and never invents colours or sizes of its own; a new look is a new entry
 * here.
 */

import { darken, lighten, mix, withAlpha } from './color';
import { FOCUS_RING, PRESS_DROP, type Elevation, type Theme, type TypeStyle } from './tokens';

export const BUTTON_VARIANTS = [
  'primary',
  'secondary',
  'ghost',
  'danger',
  'success',
  'quiet',
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
  'raised',
  'inset',
  'hud',
  'tooltip',
  'popover',
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
  readonly dialogChoice: DialogChoiceSkin;
  readonly questRewardBrass: BrassSkin;
  readonly mercenaryBrass: BrassSkin;
  readonly keycap: KeycapSkin;
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
const KEYCAP_SIZE = 20;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

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

function buildSkins(theme: Theme): Skins {
  const { palette, space, radius, type } = theme;
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
    dialogChoice: buildDialogChoice(theme),
    questRewardBrass: brass.quest,
    mercenaryBrass: brass.mercenary,
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

const skinCache = new WeakMap<Theme, Skins>();

/** The skins for `theme`, built once per resolved theme. */
export function skinsFor(theme: Theme): Skins {
  const cached = skinCache.get(theme);
  if (cached !== undefined) return cached;
  const skins = buildSkins(theme);
  skinCache.set(theme, skins);
  return skins;
}
