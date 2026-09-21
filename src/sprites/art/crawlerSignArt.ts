/**
 * The painted signboard an earlier crawler left standing at a dungeon junction.
 *
 * A plank board on two driven posts, with the word STAIRS brushed on in one
 * hand-mixed pigment; the arrow above it is painted separately. Everything is
 * measured in the caller's `tileScale` (the logical tile). The board, posts and
 * shadow all sit inside the one tile the sign blocks, so nothing ever draws over
 * a floor tile the player can stand on.
 *
 * The lettering sets the size, not the other way round. At the game's 32 px tile
 * each letter is about 8 px tall and 5 px wide, which is the least that still
 * reads as a word; anything smaller resolves to a smudge.
 */

import { mulberry32, range, type Rng } from '../person/rng';
import { paintBrushStroke, type BrushPigment, type Vec } from './brushStroke';

type Ctx = CanvasRenderingContext2D;

/** Room under the tile for the posts' shadow to fade into; a multiple of 1/8 so the frame is whole pixels. */
export const SIGN_FOOTROOM_TILES = 0.125;

const PAINT_SEED = 0x51a1c5;
const TWO_PI = Math.PI * 2;

const WOOD_DARK = '#2b1d12';
const WOOD_MID = '#5d4128';
const WOOD_LIGHT = '#87613a';
const WOOD_RIM = '#a98150';
const POST_SHADE = '#3b2917';
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.38)';

const BOARD_LEFT = 0.03;
const BOARD_RIGHT = 0.97;
const BOARD_TOP = 0.02;
const BOARD_BOTTOM = 0.76;
const BOARD_CORNER = 0.03;
const RIM_WIDTH = 0.03;
const OUTLINE_WIDTH = 0.02;
/** Fraction of the board face, from its top edge, lit by the light from above. */
const BOARD_HIGHLIGHT_FRACTION = 0.12;
const PLANK_SEAM_THICKNESS = 0.012;
const PLANK_SEAMS: ReadonlyArray<number> = [0.4];

const POST_TOP = 0.7;
const POST_BOTTOM = 0.95;
const POST_WIDTH = 0.1;
const POST_LIT_FRACTION = 0.5;
/** Pixels the dark outline stands proud of a post on each side. */
const POST_OUTLINE_PX = 1;
const POST_CENTRES: ReadonlyArray<number> = [0.25, 0.75];
const SHADOW_CENTRE_Y = 0.96;
const SHADOW_HALF_WIDTH = 0.4;
const SHADOW_HALF_HEIGHT = 0.04;

export const BOARD_CENTRE_X = 0.5;

const PIGMENT: BrushPigment = {
  body: '#e4d6a6',
  buildUp: '#f7efcf',
  wetEdge: '#b39a5c',
  bareSurface: '#4a331e',
  soak: '#a88d55',
};

/** Frame side of the arrow's own sprite, in tiles; the arrow is centred in it. */
export const SIGN_ARROW_FRAME_TILES = 0.5;
/**
 * Where the arrow's pivot sits on the board, in tiles from the anchor tile's top
 * edge. Low enough that the arrow's full turning circle clears the board's rim.
 */
export const SIGN_ARROW_CENTRE_Y_TILES = 0.27;
const ARROW_TAIL = -0.14;
const ARROW_TIP = 0.14;
const ARROW_STROKE_WIDTH = 0.07;
const ARROW_BARB_LENGTH = 0.15;
const ARROW_BARB_SPREAD_RADIANS = 0.62;
const ARROW_SEED = 0x7a11;

const LETTER_HEIGHT = 0.24;
const LETTER_WIDTH = 0.15;
const LETTER_GAP = 0.02;
const LETTER_STROKE_WIDTH = 0.05;
const WORD_BASELINE_Y = 0.68;
const LETTER_JITTER = 0.005;

interface Glyph {
  readonly widthFactor: number;
  /** Strokes in a unit box, x across and y down; the flag lets one stroke drip. */
  readonly strokes: ReadonlyArray<{ points: ReadonlyArray<Vec>; drips?: boolean }>;
}

const GLYPH_S: Glyph = {
  widthFactor: 0.8,
  strokes: [
    {
      points: [
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
      drips: true,
    },
  ],
};

const GLYPH_T: Glyph = {
  widthFactor: 0.9,
  strokes: [
    {
      points: [
        [0.02, 0.06],
        [0.98, 0.06],
      ],
    },
    {
      points: [
        [0.5, 0.06],
        [0.5, 0.98],
      ],
      drips: true,
    },
  ],
};

const GLYPH_A: Glyph = {
  widthFactor: 1,
  strokes: [
    {
      points: [
        [0.05, 0.98],
        [0.5, 0.04],
        [0.95, 0.98],
      ],
    },
    {
      points: [
        [0.25, 0.64],
        [0.75, 0.64],
      ],
    },
  ],
};

const GLYPH_I: Glyph = {
  widthFactor: 0.3,
  strokes: [
    {
      points: [
        [0.5, 0.04],
        [0.5, 0.98],
      ],
    },
  ],
};

const GLYPH_R: Glyph = {
  widthFactor: 0.9,
  strokes: [
    {
      points: [
        [0.15, 0.98],
        [0.15, 0.04],
      ],
    },
    {
      points: [
        [0.15, 0.06],
        [0.7, 0.06],
        [0.9, 0.22],
        [0.85, 0.42],
        [0.6, 0.52],
        [0.15, 0.52],
      ],
    },
    {
      points: [
        [0.5, 0.52],
        [0.92, 0.98],
      ],
    },
  ],
};

const WORD_GLYPHS: ReadonlyArray<Glyph> = [GLYPH_S, GLYPH_T, GLYPH_A, GLYPH_I, GLYPH_R, GLYPH_S];

function paintBoard(ctx: Ctx, ox: number, oy: number, t: number): void {
  const left = ox + BOARD_LEFT * t;
  const top = oy + BOARD_TOP * t;
  const width = (BOARD_RIGHT - BOARD_LEFT) * t;
  const height = (BOARD_BOTTOM - BOARD_TOP) * t;

  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, BOARD_CORNER * t);
  ctx.fill();

  const inset = OUTLINE_WIDTH * t;
  ctx.fillStyle = WOOD_RIM;
  ctx.beginPath();
  ctx.roundRect(left + inset, top + inset, width - inset * 2, height - inset * 2, BOARD_CORNER * t);
  ctx.fill();

  const face = (RIM_WIDTH + OUTLINE_WIDTH) * t;
  ctx.fillStyle = WOOD_MID;
  ctx.fillRect(left + face, top + face, width - face * 2, height - face * 2);

  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(
    left + face,
    top + face,
    width - face * 2,
    (height - face * 2) * BOARD_HIGHLIGHT_FRACTION,
  );

  ctx.fillStyle = WOOD_DARK;
  for (const seam of PLANK_SEAMS) {
    ctx.fillRect(
      left + face,
      oy + seam * t,
      width - face * 2,
      Math.max(1, t * PLANK_SEAM_THICKNESS),
    );
  }
}

function paintPosts(ctx: Ctx, ox: number, oy: number, t: number): void {
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    ox + BOARD_CENTRE_X * t,
    oy + SHADOW_CENTRE_Y * t,
    SHADOW_HALF_WIDTH * t,
    SHADOW_HALF_HEIGHT * t,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  for (const centre of POST_CENTRES) {
    const left = ox + (centre - POST_WIDTH / 2) * t;
    const top = oy + POST_TOP * t;
    const height = (POST_BOTTOM - POST_TOP) * t;
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(
      left - POST_OUTLINE_PX,
      top,
      POST_WIDTH * t + POST_OUTLINE_PX * 2,
      height + POST_OUTLINE_PX,
    );
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(left, top, POST_WIDTH * t * POST_LIT_FRACTION, height);
    ctx.fillStyle = POST_SHADE;
    ctx.fillRect(
      left + POST_WIDTH * t * POST_LIT_FRACTION,
      top,
      POST_WIDTH * t * (1 - POST_LIT_FRACTION),
      height,
    );
  }
}

function jitter(rng: Rng, amount: number, t: number): number {
  return range(rng, -amount, amount) * t;
}

function paintWord(ctx: Ctx, ox: number, oy: number, t: number, rng: Rng): void {
  const widths = WORD_GLYPHS.map((glyph) => glyph.widthFactor * LETTER_WIDTH * t);
  const gap = LETTER_GAP * t;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  const height = LETTER_HEIGHT * t;
  const top = oy + WORD_BASELINE_Y * t - height;

  let cursor = ox + BOARD_CENTRE_X * t - totalWidth / 2;
  WORD_GLYPHS.forEach((glyph, index) => {
    const width = widths[index];
    for (const stroke of glyph.strokes) {
      const points = stroke.points.map(([u, v]): Vec => [
        cursor + u * width + jitter(rng, LETTER_JITTER, t),
        top + v * height + jitter(rng, LETTER_JITTER, t),
      ]);
      paintBrushStroke(
        ctx,
        { points, width: LETTER_STROKE_WIDTH * t, drips: stroke.drips },
        PIGMENT,
        rng,
      );
    }
    cursor += width + gap;
  });
}

/**
 * Paints the board, posts and lettering with the anchor tile's top-left corner
 * at (`x`, `y`). The arrow is a separate sprite so it can turn to any bearing.
 */
export function drawCrawlerSignBoard(ctx: Ctx, x: number, y: number, tileScale: number): void {
  const rng = mulberry32(PAINT_SEED);
  paintPosts(ctx, x, y, tileScale);
  paintBoard(ctx, x, y, tileScale);
  paintWord(ctx, x, y, tileScale, rng);
}

/**
 * Paints the arrow pointing east, centred on (`centreX`, `centreY`), so the
 * caller can rotate the finished sprite about its own middle.
 */
export function drawCrawlerSignArrow(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  tileScale: number,
): void {
  const rng = mulberry32(ARROW_SEED);
  const width = ARROW_STROKE_WIDTH * tileScale;
  const at = (dx: number, dy: number): Vec => [centreX + dx * tileScale, centreY + dy * tileScale];
  const barb = (spread: number): Vec =>
    at(ARROW_TIP - Math.cos(spread) * ARROW_BARB_LENGTH, Math.sin(spread) * ARROW_BARB_LENGTH);
  paintBrushStroke(ctx, { points: [at(ARROW_TAIL, 0), at(ARROW_TIP, 0)], width }, PIGMENT, rng);
  for (const spread of [-ARROW_BARB_SPREAD_RADIANS, ARROW_BARB_SPREAD_RADIANS]) {
    paintBrushStroke(ctx, { points: [barb(spread), at(ARROW_TIP, 0)], width }, PIGMENT, rng);
  }
}
