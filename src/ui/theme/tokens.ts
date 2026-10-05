/**
 * The design tokens every piece of UI chrome is drawn from: colour, spacing,
 * radius, type, elevation, motion and control sizes.
 *
 * Changing the look of the game's UI is an edit to this file (or to the skins
 * built from it in `skins.ts`), never a literal in a widget or a screen.
 */

import { UI_FONT_STACK } from './fonts';

export const palette = {
  surface: {
    base: 'rgba(14, 17, 26, 0.92)',
    raised: '#1A1F2C',
    sunken: '#0A0D14',
    scrim: 'rgba(4, 6, 10, 0.62)',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.07)',
    strong: 'rgba(255, 255, 255, 0.16)',
    focus: '#F5B83D',
  },
  text: {
    primary: '#F2F4F8',
    secondary: '#A9B2C3',
    muted: '#6C7589',
    inverse: '#0B0E14',
    disabled: '#4A5163',
  },
  accent: {
    base: '#F5B83D',
    hover: '#FFC95C',
    press: '#D99A22',
    soft: 'rgba(245, 184, 61, 0.14)',
  },
  state: { success: '#3DD68C', danger: '#FF5D5D', warning: '#FFB020', info: '#5AA9FF' },
  meter: {
    hp: '#FF5D5D',
    hpLow: '#FF8A3D',
    mana: '#4C9DFF',
    xp: '#9B87FF',
    stamina: '#3DD68C',
    boss: '#B36BFF',
    track: 'rgba(255, 255, 255, 0.08)',
    ghost: 'rgba(255, 255, 255, 0.35)',
  },
  crawler: { human: '#7FB2FF', cat: '#FF9F45' },
  category: {
    weapon: '#FF7A6B',
    armor: '#7FB2FF',
    consumable: '#3DD68C',
    tool: '#C9A46B',
    material: '#A9B2C3',
    book: '#B98CFF',
    quest: '#F5B83D',
    kit: '#5ED3D1',
  },
  /** Loot-box rarity, lowest to highest: the box's frame, rays and reward accents. */
  tier: {
    bronze: '#D08A4E',
    silver: '#C9D1DC',
    gold: '#F5C84C',
    legendary: '#B98CFF',
    celestial: '#5ED3F0',
  },
  /** Metal and felt for the game-show set pieces: reward plaques, the merc desk, the casino. */
  material: {
    brassLight: '#F4D58A',
    brass: '#C99A3E',
    brassDark: '#7A5418',
    felt: '#1F5C3E',
    chipRed: '#D9433B',
    chipBlue: '#2F6FD6',
    chipBlack: '#20232B',
    chipWhite: '#ECEFF4',
  },
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** One step of the type ramp. Sizes and line heights are UI units. */
export interface TypeStyle {
  readonly size: number;
  readonly weight: number;
  readonly lineHeight: number;
  /** Extra space between glyphs, in UI units. */
  readonly letterSpacing?: number;
  /** Render the string upper-cased. */
  readonly upper?: boolean;
}

export const type = {
  caption: { size: 11, weight: 500, lineHeight: 14 },
  body: { size: 13, weight: 400, lineHeight: 18 },
  label: { size: 12, weight: 600, lineHeight: 16, letterSpacing: 0.2 },
  title: { size: 16, weight: 700, lineHeight: 22 },
  heading: { size: 20, weight: 700, lineHeight: 26 },
  display: { size: 28, weight: 800, lineHeight: 34 },
  overline: { size: 10, weight: 700, lineHeight: 12, letterSpacing: 1.2, upper: true },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof type;

/** A soft drop shadow. */
export interface Elevation {
  readonly blur: number;
  readonly offsetY: number;
  readonly color: string;
}

export const elevation = {
  panel: { blur: 24, offsetY: 8, color: 'rgba(0, 0, 0, 0.45)' },
  hud: { blur: 12, offsetY: 4, color: 'rgba(0, 0, 0, 0.35)' },
} as const satisfies Record<string, Elevation>;

/** Durations in milliseconds. */
export const motion = { fast: 90, base: 140, slow: 220 } as const;

/** A surface opening scales up from this fraction of its size. */
export const OPEN_SCALE_FROM = 0.96;

/** Width of the focus ring and its gap outside the control, in UI units. */
export const FOCUS_RING = { width: 2, gap: 2, glowBlur: 8 } as const;

/** How far a pressed control drops, in UI units. */
export const PRESS_DROP = 1;

/** Fraction of the viewport height a compact-size bottom sheet may take. */
export const SHEET_MAX_HEIGHT_FRACTION = 0.9;

export const sizes = {
  control: { pointer: 32, touch: 44 },
  row: { pointer: 40, touch: 48 },
  slot: { pointer: 52, touch: 56 },
  icon: 18,
} as const;

/** Panel widths in UI units, picked by name rather than by number. */
export const panelWidths = { sm: 360, md: 520, lg: 760, xl: 960 } as const;

export type PanelWidth = keyof typeof panelWidths;

/** How the player is pointing: a finger needs bigger targets than a mouse. */
export type Density = 'touch' | 'pointer';

/** The control, row and slot sizes for one density. */
export interface ResolvedSizes {
  readonly control: number;
  readonly row: number;
  readonly slot: number;
  readonly icon: number;
}

/**
 * The tokens resolved for one density. Widgets read everything through
 * `ui.theme`, never from the raw token objects, so a density change is
 * a single swap.
 */
export interface Theme {
  readonly density: Density;
  readonly palette: typeof palette;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly type: typeof type;
  readonly elevation: typeof elevation;
  readonly motion: typeof motion;
  readonly size: ResolvedSizes;
  readonly panelWidth: typeof panelWidths;
  /** The CSS font-family stack every UI string is set in. */
  readonly fontFamily: string;
}

const resolvedThemes = new Map<Density, Theme>();

/** The theme for `density`. The same object is returned for the same density. */
export function resolveTheme(density: Density): Theme {
  const cached = resolvedThemes.get(density);
  if (cached !== undefined) return cached;
  const theme: Theme = {
    density,
    palette,
    space,
    radius,
    type,
    elevation,
    motion,
    size: {
      control: sizes.control[density],
      row: sizes.row[density],
      slot: sizes.slot[density],
      icon: sizes.icon,
    },
    panelWidth: panelWidths,
    fontFamily: UI_FONT_STACK,
  };
  resolvedThemes.set(density, theme);
  return theme;
}

/** The CSS `font` shorthand for one type style, e.g. `600 12px "Inter UI", system-ui, sans-serif`. */
export function fontFor(style: TypeStyle, family: string = UI_FONT_STACK): string {
  return `${style.weight} ${style.size}px ${family}`;
}
