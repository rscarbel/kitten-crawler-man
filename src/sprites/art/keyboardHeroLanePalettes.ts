/**
 * The keyboard-hero lanes' colours: board art, painted into the lane beds,
 * keycaps, receptors and touch buttons, and checked by the board's contrast gates.
 */

/**
 * One fixed hue per lane — guitar hero's oldest readability trick, and the thing
 * that lets a player tell at a glance which falling note belongs to which key.
 *
 * The four are the Okabe-Ito colourblind-safe qualitative set, brightened for a
 * neon console: no two of them collapse together under deuteranopia,
 * protanopia or tritanopia, and they differ in luminance as well as hue so the
 * separation survives even in greyscale.
 */
export interface LanePalette {
  /** The lane's identity colour: note face, receptor ring, particles, glow. */
  readonly hue: string;
  /** A darker shade for bevel shadow and the lane bed's tint. */
  readonly shade: string;
  /** A lighter shade for the keycap's lit top bevel and flash states. */
  readonly light: string;
  /** Human-readable name, used by the review harness's captions. */
  readonly name: string;
  /** The arrow the lane's keycap carries. */
  readonly glyph: 'left' | 'up' | 'down' | 'right';
}

export const LANE_PALETTES: readonly [LanePalette, LanePalette, LanePalette, LanePalette] = [
  { hue: '#4fc3f7', shade: '#12475f', light: '#b6e7ff', name: 'sky', glyph: 'left' },
  { hue: '#ffa726', shade: '#6b3d05', light: '#ffe0ab', name: 'amber', glyph: 'up' },
  { hue: '#34d399', shade: '#0c4a3a', light: '#b4f5db', name: 'jade', glyph: 'down' },
  { hue: '#e879c0', shade: '#5c1c47', light: '#ffcdeb', name: 'orchid', glyph: 'right' },
];
