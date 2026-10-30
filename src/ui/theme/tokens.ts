/**
 * The design tokens every piece of UI chrome is drawn from: colour, spacing,
 * radius, type, elevation, motion and control sizes.
 *
 * Changing the look of the game's UI is an edit to this file (or to the skins
 * built from it in `skins.ts`), never a literal in a widget or a screen.
 */

import { UI_FONT_STACK } from './fonts';
import { worldPalette } from './worldInk';

export const palette = {
  surface: {
    base: 'rgba(14, 17, 26, 0.92)',
    /** `base` with nothing showing through, for a sheet laid over bright, busy art. */
    solid: '#0E111A',
    raised: '#1A1F2C',
    /**
     * Also the loading screen's backdrop. The boot splash in `index.html`
     * repeats this colour, and its ember the `accent.base` amber, so the
     * handoff from the splash to the canvas shows no seam.
     */
    sunken: '#0A0D14',
    scrim: 'rgba(4, 6, 10, 0.62)',
    /** The black a full-screen card is laid over, faded by the card's own opacity. */
    blackout: '#000000',
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
    /** Pure white, for a call to act laid over full-screen art. */
    bright: '#FFFFFF',
  },
  accent: {
    base: '#F5B83D',
    hover: '#FFC95C',
    press: '#D99A22',
    soft: 'rgba(245, 184, 61, 0.14)',
    /** The bright gold of a win: the logo's face, a poker winner's glow, award sparkles. */
    celebrate: '#F5C84C',
    /** The cool spark thrown among the gold of an award. */
    celebrateCool: '#5ED3F0',
  },
  state: { success: '#3DD68C', danger: '#FF5D5D', warning: '#FFB020', info: '#5AA9FF' },
  /**
   * A cost checklist hung over the world: the same inks and edge as the
   * world-drawn checklist, so a cost line looks alike wherever it is set.
   */
  requirement: {
    met: worldPalette.ink.success,
    short: worldPalette.ink.dangerSoft,
    halo: worldPalette.outline,
  },
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
  /** A crawler's card glowing while something only they perceive is near: the scent's warm cream. */
  sense: { cue: '#FFE7B8' },
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
  /**
   * Each skill book's cover and spine, keyed by the skill it teaches: the one
   * thing a player reads to tell one book from another at slot size.
   */
  skillBook: {
    nine_lives: { cover: '#155e75', spine: '#083344' },
    warp_speed: { cover: '#4c1d95', spine: '#2a0f57' },
    pugilism: { cover: '#7f1d1d', spine: '#450a0a' },
    iron_stomach: { cover: '#3f6212', spine: '#1f3006' },
    mechanical_fist: { cover: '#3f4854', spine: '#1c2129' },
    powerful_strike: { cover: '#92400e', spine: '#4a1f04' },
    swordsmanship: { cover: '#1e3a8a', spine: '#0f1d47' },
    archery: { cover: '#166534', spine: '#08321a' },
    clawmanship: { cover: '#9d174d', spine: '#4a0a24' },
    magic_eye: { cover: '#86198f', spine: '#40083f' },
    blunt_proficiency: { cover: '#57534e', spine: '#292524' },
    pyros_touch: { cover: '#c2410c', spine: '#5c1f06' },
    demolitionist: { cover: '#a16207', spine: '#4a2c03' },
  },
  /**
   * The rarity ladder, lowest to highest: reward frames, rays and accents.
   * `base` is the rarity's own colour, `light` its highlight and sheen, `deep`
   * its shadow and rim, `glow` the halo and burst it throws.
   */
  rarity: {
    common: { base: '#C9B28C', light: '#EADCBF', deep: '#7A5F3C', glow: '#F2E4C6' },
    uncommon: { base: '#4CC46A', light: '#9EEBAE', deep: '#1E6B35', glow: '#7DFF9C' },
    rare: { base: '#4C8EFF', light: '#A0C4FF', deep: '#1D4AA6', glow: '#6FB2FF' },
    epic: { base: '#A86BFF', light: '#D4B6FF', deep: '#562BA3', glow: '#C68EFF' },
    legendary: { base: '#FF9A2E', light: '#FFCD7C', deep: '#A6530B', glow: '#FFB648' },
    /** Pearl white whose halo leans prismatic, so it never reads as a pale Common. */
    divine: { base: '#F4F1FF', light: '#FFFFFF', deep: '#B4ACD9', glow: '#B6F0FF' },
  },
  /** Metal and felt for the gilded set pieces: reward plaques, the merc desk, the casino. */
  material: {
    brassLight: '#F4D58A',
    brass: '#C99A3E',
    brassDark: '#7A5418',
    felt: '#1F5C3E',
    chipRed: '#D9433B',
    chipBlue: '#2F6FD6',
    chipBlack: '#20232B',
    chipWhite: '#ECEFF4',
    chipGreen: '#2E9E5B',
    chipOrange: '#E8822E',
    chipPurple: '#7C4BC9',
    chipPink: '#D9508F',
    chipTeal: '#1FA3A0',
    chipSilver: '#BCC4D0',
    /** The poker table's padded rail: dark leather round the felt. */
    rail: '#3A2416',
  },
  /**
   * Caroline, the System AI: a terminal readout rather than a panel, cold
   * cyan on blue-black with no brass and no glass, so nothing else on screen
   * can be mistaken for her speaking.
   */
  caroline: {
    ground: 'rgba(4, 9, 17, 0.95)',
    hairline: '#5ED3F0',
    bracket: '#8FE6FA',
    grid: 'rgba(94, 211, 240, 0.07)',
    scanline: 'rgba(94, 211, 240, 0.05)',
    rule: 'rgba(94, 211, 240, 0.38)',
    label: '#5ED3F0',
    dot: '#7CF0C8',
    prefix: '#8FE6FA',
    body: '#E8F6FA',
    cursor: '#8FE6FA',
  },
  /**
   * Paper laid inside a reading panel: a yellow legal pad with blue rules and
   * a red margin, and a cream slip pinned up as a note. The sheets beneath
   * the top one are a shade darker, so the stack reads without a border.
   */
  paper: {
    legal: {
      sheet: '#F7EBAE',
      under: '#E6D896',
      underDeep: '#D5C683',
      rule: 'rgba(72, 112, 176, 0.34)',
      margin: 'rgba(204, 62, 62, 0.62)',
      ink: '#1F2438',
    },
    note: {
      sheet: '#F4EFE3',
      under: '#E2DBCB',
      ink: '#2C2A36',
      pinHead: '#C8463C',
      pinShine: '#F3A79E',
    },
    /** The soft dark a sheet throws onto the one below it. */
    shadow: 'rgba(0, 0, 0, 0.32)',
    /** The hairline at a sheet's edge, warm so it reads as paper rather than a UI border. */
    edge: 'rgba(70, 52, 20, 0.22)',
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
  /**
   * The game's wordmark: the face's heaviest weight, tracked in tight. Drawn far
   * larger than any UI step, so a painter scales its size, line height and
   * spacing together from these proportions.
   */
  logo: { size: 96, weight: 900, lineHeight: 96, letterSpacing: -2.4, upper: true },
  /** The strip over every Caroline message, in the terminal face: small, wide-tracked capitals. */
  carolineLabel: { size: 10, weight: 700, lineHeight: 14, letterSpacing: 2.2, upper: true },
  /** A quiet line that still has to read across a big screen: the title's sound hint. */
  hint: { size: 15, weight: 500, lineHeight: 20, letterSpacing: 0.4 },
  /** A call to act over a full-screen card: the floor banner's "begin" line. */
  prompt: { size: 18, weight: 700, lineHeight: 24 },
  /** An alarm that must be read mid-fight from across the screen: the siege's clocktower alert. */
  alarm: { size: 40, weight: 900, lineHeight: 46, letterSpacing: 1.5, upper: true },
  /**
   * A win shouted across the whole screen: the siege's victory. The wordmark's
   * proportions, so it reads as the moment it is.
   */
  fanfare: { size: 96, weight: 900, lineHeight: 96, letterSpacing: -2.4, upper: true },
  /**
   * Text set on a legal sheet, in the document face. Larger than `body` because
   * a serif at body size reads small, and its line height is the pad's rule
   * spacing, so every line sits on a rule.
   */
  paperDocument: { size: 15, weight: 400, lineHeight: 23 },
  /** Text scribbled on a note, in the handwriting face, which runs small for its size. */
  paperHand: { size: 17, weight: 400, lineHeight: 23 },
  /** `paperDocument` on a phone's sheet, where every line of height counts. */
  paperDocumentCompact: { size: 14, weight: 400, lineHeight: 19 },
  /** `paperHand` on a phone's sheet. */
  paperHandCompact: { size: 15, weight: 400, lineHeight: 19 },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof type;

/**
 * One step down the ramp, for text that has to give room back: the top band's
 * lines on a phone, where the band shares the column the player stands in.
 */
export const condensedType: Readonly<Record<TypeRole, TypeRole>> = {
  display: 'heading',
  heading: 'title',
  title: 'label',
  label: 'caption',
  body: 'caption',
  caption: 'caption',
  overline: 'overline',
  logo: 'display',
  carolineLabel: 'carolineLabel',
  hint: 'body',
  prompt: 'title',
  alarm: 'display',
  fanfare: 'display',
  paperDocument: 'paperDocumentCompact',
  paperHand: 'paperHandCompact',
  paperDocumentCompact: 'paperDocumentCompact',
  paperHandCompact: 'paperHandCompact',
};

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
export const motion = {
  fast: 90,
  base: 140,
  slow: 220,
  /** One full bob-and-tilt of the now-playing card's note. */
  noteSway: 2400,
  /** How long each small note takes to drift up off the now-playing card and fade. */
  noteDrift: 1800,
  /** How long a song's credit card stays up, fade included. */
  nowPlayingDisplay: 5000,
  /** How long a sound caption stays up after the sound it reports, fade included. */
  captionDisplay: 2500,
  /** A Caroline frame opening: the line drawn across, then the box unfolding from it. Closing runs both backwards. */
  carolineLineDraw: 120,
  carolineUnfold: 160,
  /**
   * One character of Caroline's text appearing in her toasts and announcement
   * modals: a machine pace, about 135 characters a second.
   */
  carolineCharacter: 7.4,
  /**
   * One character of Caroline's text appearing in the dialog box: a machine
   * pace, about ninety characters a second. Slower than her notices, which
   * are a line or two to glance at, where a message is read through.
   */
  carolineSpeechCharacter: 11,
  /** How long a decoding character shows one random glyph before the next. */
  carolineScrambleStep: 34,
  carolineCursorBlink: 530,
  /** One breath of the status dot in her header strip. */
  carolineDotPulse: 1600,
  /** Her scanlines drift down by one step over this long: slow enough to sense rather than watch. */
  carolineScanlineDrift: 2400,
} as const;

/** The shape of a Caroline frame, in UI units. */
export const carolineFrame = {
  chamfer: 7,
  hairlineWidth: 1,
  bracketWidth: 2,
  bracketLength: 11,
  gridStep: 8,
  scanlineStep: 3,
  dotSize: 5,
  ruleWidth: 1,
  /** Characters still scrambling behind the newest locked one: each cycles about this many glyph steps before it locks. */
  decodeTail: 3,
} as const;

/** One sheet lying beneath the top one: how far it is shifted and how far it is turned, in radians. */
export interface PaperUnderSheet {
  readonly dx: number;
  readonly dy: number;
  readonly turn: number;
}

/** The kinds of paper a reading panel lays text on. */
export type PaperSheetVariant = 'legal' | 'note';

/**
 * How roomy a paper stack is drawn: `compact` for a phone's screen, where a
 * short landscape sheet leaves the page under a hundred units of height and
 * the pad's margins would otherwise eat it, `roomy` everywhere else.
 */
export type PaperScale = 'roomy' | 'compact';

/** What every kind of paper's shape table carries. */
interface PaperShapeBase {
  readonly maxWidth: number;
  /** Width over height the sheet keeps while its text is short. */
  readonly aspect: number;
  readonly radius: number;
  readonly under: readonly PaperUnderSheet[];
}

/** A legal pad page: ruled, with a double margin rule its text starts past. */
interface LegalPaperShape extends PaperShapeBase {
  readonly padTop: number;
  readonly padRight: number;
  readonly padBottom: number;
  readonly marginInset: number;
  readonly marginGap: number;
  readonly marginWidth: number;
  readonly ruleWidth: number;
  readonly ruleRise: number;
}

/** One tooth of a torn edge: how deep it bites, as a share of the tear's depth. */
export interface TornEdgeTooth {
  readonly bite: number;
}

/** A note slip, torn along its top and pinned up by it. */
interface NotePaperShape extends PaperShapeBase {
  readonly padTop: number;
  readonly padRight: number;
  readonly padBottom: number;
  readonly padLeft: number;
  readonly tearDepth: number;
  readonly tearStep: number;
  readonly pinRadius: number;
  readonly pinDrop: number;
  readonly pinShineShare: number;
}

/** Each kind of paper's shape table; keyed by every variant so a new one can't ship without its shape. */
type PaperShapesByVariant = Record<PaperSheetVariant, PaperShapeBase> & {
  readonly legal: LegalPaperShape;
  readonly note: NotePaperShape;
};

/**
 * The torn top edge of a note, tooth after tooth. Fixed rather than random,
 * so the tear holds still from frame to frame and reads as the same slip
 * every time it is opened.
 */
export const NOTE_TORN_EDGE: readonly TornEdgeTooth[] = [
  { bite: 0.2 },
  { bite: 0.9 },
  { bite: 0.35 },
  { bite: 1 },
  { bite: 0.1 },
  { bite: 0.7 },
  { bite: 0.45 },
  { bite: 0.95 },
  { bite: 0 },
  { bite: 0.6 },
];

/** A legal pad's page is 8.5 by 14 inches. */
const LEGAL_PAD_WIDTH_INCHES = 8.5;
const LEGAL_PAD_HEIGHT_INCHES = 14;
const LEGAL_PAD_ASPECT = LEGAL_PAD_WIDTH_INCHES / LEGAL_PAD_HEIGHT_INCHES;
/** A note slip is square, so it never reads as a page torn from the pad. */
const NOTE_SLIP_ASPECT = 1;

/**
 * The shape of each kind of paper at each scale, in UI units. A legal sheet
 * is a tall pad page, a note a smaller, squarer slip. `padTop`..`padLeft`
 * run from the sheet's edges to its text; a legal sheet's text starts a gap
 * past its margin rule instead, so it has no `padLeft`.
 */
export const paperSheetShapes = {
  roomy: {
    legal: {
      maxWidth: 440,
      aspect: LEGAL_PAD_ASPECT,
      radius: 2,
      padTop: 34,
      padRight: 22,
      padBottom: 26,
      /** From the sheet's left edge to its margin rule. */
      marginInset: 40,
      /** The pad's margin is two rules this far apart. */
      marginGap: 3,
      marginWidth: 1,
      ruleWidth: 1,
      /** How far above the bottom of a line of text its rule runs, so the writing sits on it. */
      ruleRise: 4,
      under: [
        { dx: 10, dy: 7, turn: 0.026 },
        { dx: -8, dy: 3, turn: -0.018 },
      ],
    },
    note: {
      maxWidth: 300,
      aspect: NOTE_SLIP_ASPECT,
      radius: 1,
      padTop: 30,
      padRight: 20,
      padBottom: 20,
      padLeft: 20,
      /** How deep the teeth of the torn top edge bite. */
      tearDepth: 3,
      /** How wide each tooth of the torn top edge is. */
      tearStep: 9,
      pinRadius: 6,
      /** The pin's head sits this far below the sheet's top edge. */
      pinDrop: 13,
      /** The highlight on the pin's head, as a share of its radius. */
      pinShineShare: 0.38,
      under: [{ dx: 6, dy: 5, turn: -0.05 }],
    },
  },
  /**
   * Thin margins, small offsets and barely turned sheets beneath, and a
   * wider legal sheet, so a phone's page keeps its height for writing and a
   * paragraph still fits on one page.
   */
  compact: {
    legal: {
      maxWidth: 720,
      aspect: LEGAL_PAD_ASPECT,
      radius: 2,
      padTop: 10,
      padRight: 12,
      padBottom: 6,
      marginInset: 20,
      marginGap: 2,
      marginWidth: 1,
      ruleWidth: 1,
      ruleRise: 3,
      under: [
        { dx: 5, dy: 3, turn: 0.008 },
        { dx: -4, dy: 2, turn: -0.006 },
      ],
    },
    note: {
      maxWidth: 300,
      aspect: NOTE_SLIP_ASPECT,
      radius: 1,
      padTop: 18,
      padRight: 12,
      padBottom: 8,
      padLeft: 12,
      tearDepth: 2,
      tearStep: 7,
      pinRadius: 4,
      pinDrop: 8,
      pinShineShare: 0.38,
      under: [{ dx: 4, dy: 3, turn: -0.012 }],
    },
  },
} as const satisfies Record<PaperScale, PaperShapesByVariant>;

/** What every stack of paper shares at each scale, whatever its kind. */
export const paperStack = {
  roomy: {
    /** How far a sheet's shadow falls below and right of it. */
    shadowOffset: 3,
    edgeWidth: 1,
    /** A short sheet still keeps its paper's proportions, up to this share of the screen's height. */
    minHeightViewportShare: 0.45,
  },
  compact: { shadowOffset: 2, edgeWidth: 1, minHeightViewportShare: 0.45 },
} as const satisfies Record<PaperScale, Record<string, number>>;

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

/**
 * How far an italic run leans: the shear the UI face is drawn with, since the
 * bundled Inter has no italic of its own. Horizontal shift per unit of height.
 */
export const ITALIC_SLANT = 0.2;

/** The CSS `font` shorthand for one type style, e.g. `600 12px "Inter UI", system-ui, sans-serif`. */
export function fontFor(style: TypeStyle, family: string = UI_FONT_STACK): string {
  return `${style.weight} ${style.size}px ${family}`;
}
