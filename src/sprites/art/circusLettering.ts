/**
 * Sign-painter's capitals for the circus: the marquee over the Big Top's door
 * and the side-show boards. Every glyph is a few brush strokes painted through
 * `paintBrushStroke`, so the lettering is world paint with a wet edge and dry
 * gaps rather than type.
 *
 * Only the letters the circus actually spells are drawn. A word with a letter
 * missing here throws, because a silently skipped letter would ship a sign
 * that reads wrong and passes every gate.
 */

import { paintBrushStroke, type BrushPigment, type Vec } from './brushStroke';
import { range, type Rng } from '../person/rng';

type Ctx = CanvasRenderingContext2D;

interface Glyph {
  /** Advance width as a fraction of the letter height's box width. */
  readonly widthFactor: number;
  /** Strokes in a unit box, x across and y down. */
  readonly strokes: ReadonlyArray<ReadonlyArray<Vec>>;
}

const OVAL_POINTS = 12;
/** The O's half-width in glyph units; a touch narrower than its half-height so it reads as a letter, not a ring. */
const OVAL_RADIUS_X = 0.44;
const OVAL_RADIUS_Y = 0.48;
function oval(): Vec[] {
  const points: Vec[] = [];
  for (let index = 0; index <= OVAL_POINTS; index++) {
    const angle = (index / OVAL_POINTS) * Math.PI * 2 - Math.PI / 2;
    points.push([0.5 + Math.cos(angle) * OVAL_RADIUS_X, 0.5 + Math.sin(angle) * OVAL_RADIUS_Y]);
  }
  return points;
}

const GLYPH_TABLE: Readonly<Record<string, Glyph>> = {
  A: {
    widthFactor: 1,
    strokes: [
      [
        [0.04, 1],
        [0.5, 0],
        [0.96, 1],
      ],
      [
        [0.24, 0.62],
        [0.76, 0.62],
      ],
    ],
  },
  D: {
    widthFactor: 0.9,
    strokes: [
      [
        [0.12, 0],
        [0.12, 1],
      ],
      [
        [0.12, 0.02],
        [0.55, 0.06],
        [0.9, 0.34],
        [0.9, 0.66],
        [0.55, 0.95],
        [0.12, 0.98],
      ],
    ],
  },
  E: {
    widthFactor: 0.8,
    strokes: [
      [
        [0.9, 0.02],
        [0.12, 0.02],
        [0.12, 0.98],
        [0.9, 0.98],
      ],
      [
        [0.12, 0.5],
        [0.72, 0.5],
      ],
    ],
  },
  F: {
    widthFactor: 0.78,
    strokes: [
      [
        [0.9, 0.02],
        [0.12, 0.02],
        [0.12, 1],
      ],
      [
        [0.12, 0.5],
        [0.7, 0.5],
      ],
    ],
  },
  G: {
    widthFactor: 0.95,
    strokes: [
      [
        [0.9, 0.16],
        [0.62, 0.01],
        [0.3, 0.04],
        [0.07, 0.32],
        [0.07, 0.68],
        [0.3, 0.97],
        [0.66, 0.99],
        [0.92, 0.8],
        [0.92, 0.56],
        [0.56, 0.56],
      ],
    ],
  },
  H: {
    widthFactor: 0.9,
    strokes: [
      [
        [0.12, 0],
        [0.12, 1],
      ],
      [
        [0.88, 0],
        [0.88, 1],
      ],
      [
        [0.12, 0.5],
        [0.88, 0.5],
      ],
    ],
  },
  I: {
    widthFactor: 0.34,
    strokes: [
      [
        [0.5, 0],
        [0.5, 1],
      ],
    ],
  },
  K: {
    widthFactor: 0.88,
    strokes: [
      [
        [0.12, 0],
        [0.12, 1],
      ],
      [
        [0.9, 0],
        [0.14, 0.58],
      ],
      [
        [0.36, 0.42],
        [0.92, 1],
      ],
    ],
  },
  L: {
    widthFactor: 0.76,
    strokes: [
      [
        [0.14, 0],
        [0.14, 0.98],
        [0.9, 0.98],
      ],
    ],
  },
  M: {
    widthFactor: 1.1,
    strokes: [
      [
        [0.06, 1],
        [0.1, 0],
        [0.5, 0.62],
        [0.9, 0],
        [0.94, 1],
      ],
    ],
  },
  N: {
    widthFactor: 0.95,
    strokes: [
      [
        [0.1, 1],
        [0.1, 0],
        [0.9, 1],
        [0.9, 0],
      ],
    ],
  },
  O: { widthFactor: 1, strokes: [oval()] },
  R: {
    widthFactor: 0.9,
    strokes: [
      [
        [0.12, 1],
        [0.12, 0.02],
        [0.6, 0.03],
        [0.88, 0.2],
        [0.86, 0.4],
        [0.6, 0.53],
        [0.12, 0.53],
      ],
      [
        [0.5, 0.53],
        [0.92, 1],
      ],
    ],
  },
  S: {
    widthFactor: 0.82,
    strokes: [
      [
        [0.9, 0.18],
        [0.7, 0.04],
        [0.3, 0.04],
        [0.1, 0.22],
        [0.3, 0.44],
        [0.7, 0.56],
        [0.9, 0.76],
        [0.7, 0.96],
        [0.3, 0.96],
        [0.08, 0.82],
      ],
    ],
  },
  T: {
    widthFactor: 0.9,
    strokes: [
      [
        [0.02, 0.04],
        [0.98, 0.04],
      ],
      [
        [0.5, 0.04],
        [0.5, 1],
      ],
    ],
  },
  U: {
    widthFactor: 0.92,
    strokes: [
      [
        [0.1, 0],
        [0.1, 0.7],
        [0.3, 0.98],
        [0.7, 0.98],
        [0.9, 0.7],
        [0.9, 0],
      ],
    ],
  },
  V: {
    widthFactor: 0.96,
    strokes: [
      [
        [0.04, 0],
        [0.5, 1],
        [0.96, 0],
      ],
    ],
  },
  W: {
    widthFactor: 1.2,
    strokes: [
      [
        [0.02, 0],
        [0.24, 1],
        [0.5, 0.3],
        [0.76, 1],
        [0.98, 0],
      ],
    ],
  },
  Z: {
    widthFactor: 0.85,
    strokes: [
      [
        [0.1, 0.03],
        [0.9, 0.03],
        [0.1, 0.97],
        [0.9, 0.97],
      ],
    ],
  },
  "'": {
    widthFactor: 0.3,
    strokes: [
      [
        [0.55, 0],
        [0.45, 0.3],
      ],
    ],
  },
  ' ': { widthFactor: 0.45, strokes: [] },
  C: {
    widthFactor: 0.9,
    strokes: [
      [
        [0.9, 0.18],
        [0.62, 0.01],
        [0.3, 0.04],
        [0.07, 0.32],
        [0.07, 0.68],
        [0.3, 0.97],
        [0.64, 0.99],
        [0.92, 0.82],
      ],
    ],
  },
  '&': {
    widthFactor: 0.95,
    strokes: [
      [
        [0.95, 0.98],
        [0.2, 0.36],
        [0.22, 0.08],
        [0.46, 0.02],
        [0.6, 0.18],
        [0.08, 0.66],
        [0.18, 0.96],
        [0.56, 0.94],
        [0.9, 0.52],
      ],
    ],
  },
  '.': {
    widthFactor: 0.3,
    strokes: [
      [
        [0.45, 0.9],
        [0.55, 0.98],
      ],
    ],
  },
  '—': {
    widthFactor: 1.2,
    strokes: [
      [
        [0.02, 0.52],
        [0.98, 0.5],
      ],
    ],
  },
};

/** Box width of a letter, as a fraction of its height: sign capitals run a little narrow. */
const LETTER_ASPECT = 0.62;
/** Gap between letters, as a fraction of the letter height. */
const LETTER_GAP_FRACTION = 0.12;
/** Brush width as a fraction of the letter height. */
const STROKE_WIDTH_FRACTION = 0.16;
/** A hand-painted letter does not sit on a ruler: each point strays by this much of the height. */
const LETTER_WOBBLE_FRACTION = 0.025;

const GLYPHS: ReadonlyMap<string, Glyph> = new Map(Object.entries(GLYPH_TABLE));

function glyphFor(letter: string): Glyph {
  const glyph = GLYPHS.get(letter);
  if (glyph === undefined) throw new Error(`circus lettering has no glyph for "${letter}"`);
  return glyph;
}

/** How wide a word paints at a letter height, in pixels. */
export function wordWidth(word: string, heightPx: number): number {
  const letters = Array.from(word);
  const advances = letters.map((letter) => glyphFor(letter).widthFactor * LETTER_ASPECT * heightPx);
  const gaps = Math.max(0, letters.length - 1) * LETTER_GAP_FRACTION * heightPx;
  return advances.reduce((sum, advance) => sum + advance, 0) + gaps;
}

/**
 * Paints a word centred on `centreX` with its letters' tops at `top`,
 * `heightPx` tall. Deterministic for a given `rng` state.
 */
export function paintWord(
  ctx: Ctx,
  word: string,
  centreX: number,
  top: number,
  heightPx: number,
  pigment: BrushPigment,
  rng: Rng,
): void {
  const wobble = LETTER_WOBBLE_FRACTION * heightPx;
  let cursor = centreX - wordWidth(word, heightPx) / 2;
  for (const letter of word) {
    const glyph = glyphFor(letter);
    const width = glyph.widthFactor * LETTER_ASPECT * heightPx;
    for (const stroke of glyph.strokes) {
      const points = stroke.map(([u, v]): Vec => [
        cursor + u * width + range(rng, -wobble, wobble),
        top + v * heightPx + range(rng, -wobble, wobble),
      ]);
      paintBrushStroke(ctx, { points, width: STROKE_WIDTH_FRACTION * heightPx }, pigment, rng);
    }
    cursor += width + LETTER_GAP_FRACTION * heightPx;
  }
}
