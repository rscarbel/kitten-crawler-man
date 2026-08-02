/**
 * Procedural playing-card art for the Desperado Club's blackjack table.
 *
 * Fifty-two faces at readable size is a large offline bake for art that is
 * fundamentally vector-simple, and the panel scales continuously across
 * viewports — so the cards are drawn at runtime, every dimension derived from a
 * single `width`.
 *
 * **The `ctx` boundary lives here.** Card chrome (body, border, rank index) goes
 * through `drawBox` / `drawText` like all other UI. Suit pips and court figures
 * are vector illustration with no shared-utility equivalent, so raw `ctx` path
 * drawing is confined to this module. It must not leak into the panel layout or
 * the table host.
 */

import { drawBox } from '../Box';
import { drawText } from '../TextBox';
import { type Card, type Rank, type Suit } from '../../systems/casino/Deck';

/** Poker-card proportions: height is width × this. */
export const CARD_ASPECT = 1.4;

export const SUIT_RED = '#b02a2a';
export const SUIT_BLACK = '#1a1410';
const FACE_FILL = '#f4ecd8';
const FACE_BORDER = '#c8a840';
const COURT_ROBE = '#7a2438';
const COURT_ROBE_LIGHT = '#a8394f';
const COURT_TRIM = '#c8a840';
const COURT_SKIN = '#e8cba8';
const COURT_INK = '#2a1f10';
/** Cool grey veil laid over a busted hand, so it desaturates rather than blacks out. */
const DIM_VEIL = '#2a2a2e';

// Card back — the club's green felt under a gold lattice.
const BACK_FELT = '#123a2c';
const BACK_FELT_EDGE = '#0a241b';
const BACK_LATTICE = 'rgba(200,168,64,0.55)';
const BACK_BORDER = '#c8a840';
const BACK_EMBLEM = '#e0c060';

// Everything below is a fraction of card width, so one `width` drives the art.
const BORDER_WIDTH_FRACTION = 0.028;
const RADIUS_FRACTION = 0.09;
const CORNER_INDEX_WIDTH_FRACTION = 0.26;
/**
 * A two-character rank gets a smaller index, exactly as a real card does — at
 * the full size "10" runs off the left edge and into the top-left pip.
 */
const WIDE_RANK_INDEX_WIDTH_FRACTION = 0.2;
const CORNER_INSET_X_FRACTION = 0.155;
const CORNER_INSET_Y_FRACTION = 0.045;
const CORNER_GLYPH_SIZE_FRACTION = 0.13;
const CORNER_GLYPH_GAP_FRACTION = 0.02;
const PIP_WIDTH_FRACTION = 0.18;
const ACE_PIP_WIDTH_FRACTION = 0.46;
/**
 * Half-width of the region the pip grid occupies. Narrow enough that the outer
 * pip columns clear the corner index columns, which is what keeps a 10 readable.
 */
const PIP_FIELD_HALF_WIDTH_FRACTION = 0.185;
const PIP_FIELD_HALF_HEIGHT_FRACTION = 0.3;
const COURT_INSET_X_FRACTION = 0.2;
/** Where the suit glyph sits on a court figure's robe, as a fraction of card height. */
const COURT_CHEST_Y_FRACTION = 0.62;
const COURT_CHEST_SUIT_FRACTION = 0.15;
const COURT_INSET_Y_FRACTION = 0.16;
const LIFT_SHADOW_BLUR_FRACTION = 0.14;
const LIFT_SHADOW_OFFSET_FRACTION = 0.05;
const HIGHLIGHT_GLOW_BLUR_FRACTION = 0.3;

const BACK_INSET_FRACTION = 0.08;
const BACK_LATTICE_SPACING_FRACTION = 0.22;
const BACK_LATTICE_WIDTH_FRACTION = 0.02;
const BACK_EMBLEM_RADIUS_FRACTION = 0.2;

/** A flip squashes the card to nothing at the midpoint; never fully to zero, which would vanish the stroke. */
const MIN_FLIP_SCALE = 0.02;
const FLIP_MIDPOINT = 0.5;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

export interface CardRect {
  x: number;
  y: number;
  /** Height is derived — `width * CARD_ASPECT`. */
  width: number;
  /** Rotation in radians about the card's centre. Default 0. */
  rotation?: number;
}

export interface CardDrawOpts {
  /** 0–1 through a flip; the horizontal squash. 0 or 1 draw the card unsquashed. */
  flipProgress?: number;
  alpha?: number;
  /** Drop a shadow under the card, for one in flight or lifted off the felt. */
  liftShadow?: boolean;
  /** Glow colour for the winning hand. */
  highlight?: string;
  /** Desaturating veil over a busted hand. */
  dim?: number;
}

export function cardHeight(width: number): number {
  return width * CARD_ASPECT;
}

const RED_SUITS: ReadonlyArray<Suit> = ['hearts', 'diamonds'];

export function suitColor(suit: Suit): string {
  return RED_SUITS.includes(suit) ? SUIT_RED : SUIT_BLACK;
}

// ── Suit glyphs ─────────────────────────────────────────────────────────────
// One drawer per suit behind a Record, so adding a suit is a compile error
// rather than a silent fallthrough.

type GlyphDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) => void;

const HEART_LOBE_OFFSET = 0.25;
const HEART_LOBE_RADIUS = 0.27;
const HEART_TIP_DROP = 0.48;
const HEART_SHOULDER = 0.5;

function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const lobe = size * HEART_LOBE_RADIUS;
  const dx = size * HEART_LOBE_OFFSET;
  const top = cy - size * HEART_LOBE_OFFSET;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - dx, top, lobe, 0, TWO_PI);
  ctx.arc(cx + dx, top, lobe, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - size * HEART_SHOULDER, top);
  ctx.quadraticCurveTo(cx - size * HEART_SHOULDER, cy, cx, cy + size * HEART_TIP_DROP);
  ctx.quadraticCurveTo(cx + size * HEART_SHOULDER, cy, cx + size * HEART_SHOULDER, top);
  ctx.closePath();
  ctx.fill();
}

const DIAMOND_HALF_WIDTH = 0.4;
const DIAMOND_HALF_HEIGHT = 0.56;

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * DIAMOND_HALF_HEIGHT);
  ctx.lineTo(cx + size * DIAMOND_HALF_WIDTH, cy);
  ctx.lineTo(cx, cy + size * DIAMOND_HALF_HEIGHT);
  ctx.lineTo(cx - size * DIAMOND_HALF_WIDTH, cy);
  ctx.closePath();
  ctx.fill();
}

const SPADE_TIP_RISE = 0.56;
const SPADE_SHOULDER = 0.48;
const SPADE_LOBE_RADIUS = 0.2;
const SPADE_LOBE_OFFSET = 0.2;
const SPADE_LOBE_Y = 0.14;
const STEM_HALF_WIDTH = 0.07;
const STEM_TOP = 0.16;
const STEM_BOTTOM = 0.46;
const STEM_FLARE = 0.15;

function drawStem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - size * STEM_HALF_WIDTH, cy + size * STEM_TOP);
  ctx.lineTo(cx + size * STEM_HALF_WIDTH, cy + size * STEM_TOP);
  ctx.lineTo(cx + size * STEM_FLARE, cy + size * STEM_BOTTOM);
  ctx.lineTo(cx - size * STEM_FLARE, cy + size * STEM_BOTTOM);
  ctx.closePath();
  ctx.fill();
}

function drawSpade(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * SPADE_TIP_RISE);
  ctx.quadraticCurveTo(
    cx + size * SPADE_SHOULDER,
    cy - size * SPADE_LOBE_OFFSET,
    cx + size * SPADE_LOBE_OFFSET,
    cy + size * SPADE_LOBE_Y,
  );
  ctx.lineTo(cx - size * SPADE_LOBE_OFFSET, cy + size * SPADE_LOBE_Y);
  ctx.quadraticCurveTo(
    cx - size * SPADE_SHOULDER,
    cy - size * SPADE_LOBE_OFFSET,
    cx,
    cy - size * SPADE_TIP_RISE,
  );
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    cx - size * SPADE_LOBE_OFFSET,
    cy + size * SPADE_LOBE_Y,
    size * SPADE_LOBE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.arc(
    cx + size * SPADE_LOBE_OFFSET,
    cy + size * SPADE_LOBE_Y,
    size * SPADE_LOBE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();
  drawStem(ctx, cx, cy, size, color);
}

const CLUB_LOBE_RADIUS = 0.25;
const CLUB_TOP_LOBE_Y = 0.24;
const CLUB_SIDE_LOBE_X = 0.26;
const CLUB_SIDE_LOBE_Y = 0.1;

function drawClub(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy - size * CLUB_TOP_LOBE_Y, size * CLUB_LOBE_RADIUS, 0, TWO_PI);
  ctx.arc(
    cx - size * CLUB_SIDE_LOBE_X,
    cy + size * CLUB_SIDE_LOBE_Y,
    size * CLUB_LOBE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.arc(
    cx + size * CLUB_SIDE_LOBE_X,
    cy + size * CLUB_SIDE_LOBE_Y,
    size * CLUB_LOBE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();
  drawStem(ctx, cx, cy, size, color);
}

const SUIT_GLYPHS: Record<Suit, GlyphDrawer> = {
  hearts: drawHeart,
  diamonds: drawDiamond,
  spades: drawSpade,
  clubs: drawClub,
};

/** Draw a suit glyph centred on (cx, cy), sized so `size` is roughly its width. */
export function drawSuitGlyph(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  SUIT_GLYPHS[suit](ctx, cx, cy, size, color);
}

// ── Pip layouts ─────────────────────────────────────────────────────────────
// Positions in a normalised card field: x and y each run -1 (top/left) to
// +1 (bottom/right). A pip below the centre line is drawn rotated 180°, which
// is what makes a real card readable from either end.

const LEFT = -1;
const CENTRE = 0;
const RIGHT = 1;
const TOP = -1;
const BOTTOM = 1;
/** The row a seven's odd pip sits on, between the top pair and the middle. */
const UPPER_QUARTER = -0.5;
const LOWER_QUARTER = 0.5;
/** Rows for the nine and ten, which pack four pips down each column. */
const NINE_UPPER = -0.34;
const NINE_LOWER = 0.34;
const TEN_ODD_UPPER = -0.67;
const TEN_ODD_LOWER = 0.67;

type PipPosition = readonly [number, number];

const PIP_LAYOUTS: Record<Rank, ReadonlyArray<PipPosition>> = {
  A: [[CENTRE, CENTRE]],
  '2': [
    [CENTRE, TOP],
    [CENTRE, BOTTOM],
  ],
  '3': [
    [CENTRE, TOP],
    [CENTRE, CENTRE],
    [CENTRE, BOTTOM],
  ],
  '4': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '5': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [CENTRE, CENTRE],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '6': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [LEFT, CENTRE],
    [RIGHT, CENTRE],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '7': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [CENTRE, UPPER_QUARTER],
    [LEFT, CENTRE],
    [RIGHT, CENTRE],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '8': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [CENTRE, UPPER_QUARTER],
    [LEFT, CENTRE],
    [RIGHT, CENTRE],
    [CENTRE, LOWER_QUARTER],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '9': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [LEFT, NINE_UPPER],
    [RIGHT, NINE_UPPER],
    [CENTRE, CENTRE],
    [LEFT, NINE_LOWER],
    [RIGHT, NINE_LOWER],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  '10': [
    [LEFT, TOP],
    [RIGHT, TOP],
    [CENTRE, TEN_ODD_UPPER],
    [LEFT, NINE_UPPER],
    [RIGHT, NINE_UPPER],
    [LEFT, NINE_LOWER],
    [RIGHT, NINE_LOWER],
    [CENTRE, TEN_ODD_LOWER],
    [LEFT, BOTTOM],
    [RIGHT, BOTTOM],
  ],
  J: [],
  Q: [],
  K: [],
};

// ── Court figures ───────────────────────────────────────────────────────────
// A simple two-tone figure per court rank: enough silhouette to tell J, Q and K
// apart at the smallest size the layout produces, without pretending to be a
// woodcut.

const COURT_HEAD_RADIUS_FRACTION = 0.2;
const COURT_EYE_RADIUS_FRACTION = 0.18;
const COURT_HEAD_Y_FRACTION = 0.24;
const COURT_SHOULDER_Y_FRACTION = 0.44;
const COURT_ROBE_HALF_WIDTH = 0.42;
const COURT_COLLAR_HALF_WIDTH = 0.26;
const COURT_TRIM_WIDTH_FRACTION = 0.06;
const CROWN_HALF_WIDTH = 0.26;
const CROWN_HEIGHT = 0.16;
const CROWN_POINTS = 3;
const TIARA_HALF_WIDTH = 0.2;
const TIARA_HEIGHT = 0.1;
const JACK_CAP_HALF_WIDTH = 0.24;
const JACK_CAP_HEIGHT = 0.13;
const JACK_FEATHER_RISE = 0.3;
const JACK_FEATHER_SPREAD = 0.34;

/**
 * The court body: robe, collar and head, in a box `w`×`h` centred at (cx, cy).
 * `accent` tints the robe so the three ranks are not one silhouette in three
 * hats.
 */
function drawCourtBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  w: number,
  h: number,
  accent: string,
): void {
  const headR = w * COURT_HEAD_RADIUS_FRACTION;
  const headY = top + h * COURT_HEAD_Y_FRACTION;
  const shoulderY = top + h * COURT_SHOULDER_Y_FRACTION;

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx - w * COURT_COLLAR_HALF_WIDTH, shoulderY);
  ctx.lineTo(cx + w * COURT_COLLAR_HALF_WIDTH, shoulderY);
  ctx.lineTo(cx + w * COURT_ROBE_HALF_WIDTH, top + h);
  ctx.lineTo(cx - w * COURT_ROBE_HALF_WIDTH, top + h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COURT_TRIM;
  ctx.fillRect(
    cx - w * COURT_TRIM_WIDTH_FRACTION * HALF,
    shoulderY,
    w * COURT_TRIM_WIDTH_FRACTION,
    top + h - shoulderY,
  );

  ctx.fillStyle = COURT_SKIN;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = COURT_INK;
  ctx.beginPath();
  ctx.arc(cx - headR * HALF, headY, headR * COURT_EYE_RADIUS_FRACTION, 0, TWO_PI);
  ctx.arc(cx + headR * HALF, headY, headR * COURT_EYE_RADIUS_FRACTION, 0, TWO_PI);
  ctx.fill();
}

function drawCrown(ctx: CanvasRenderingContext2D, cx: number, baseY: number, w: number): void {
  ctx.fillStyle = COURT_TRIM;
  ctx.beginPath();
  ctx.moveTo(cx - w * CROWN_HALF_WIDTH, baseY);
  for (let point = 0; point < CROWN_POINTS; point++) {
    const spanStart = cx + w * CROWN_HALF_WIDTH * (-1 + (point * 2) / CROWN_POINTS);
    const spanEnd = cx + w * CROWN_HALF_WIDTH * (-1 + ((point + 1) * 2) / CROWN_POINTS);
    ctx.lineTo((spanStart + spanEnd) * HALF, baseY - w * CROWN_HEIGHT);
    ctx.lineTo(spanEnd, baseY);
  }
  ctx.closePath();
  ctx.fill();
}

function drawTiara(ctx: CanvasRenderingContext2D, cx: number, baseY: number, w: number): void {
  ctx.fillStyle = COURT_TRIM;
  ctx.beginPath();
  ctx.moveTo(cx - w * TIARA_HALF_WIDTH, baseY);
  ctx.quadraticCurveTo(cx, baseY - w * TIARA_HEIGHT * 2, cx + w * TIARA_HALF_WIDTH, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawJackCap(ctx: CanvasRenderingContext2D, cx: number, baseY: number, w: number): void {
  ctx.fillStyle = COURT_ROBE;
  ctx.beginPath();
  ctx.moveTo(cx - w * JACK_CAP_HALF_WIDTH, baseY);
  ctx.lineTo(cx + w * JACK_CAP_HALF_WIDTH, baseY);
  ctx.lineTo(cx + w * JACK_CAP_HALF_WIDTH, baseY - w * JACK_CAP_HEIGHT);
  ctx.lineTo(cx - w * JACK_CAP_HALF_WIDTH, baseY - w * JACK_CAP_HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COURT_TRIM;
  ctx.lineWidth = Math.max(1, w * BACK_LATTICE_WIDTH_FRACTION);
  ctx.beginPath();
  ctx.moveTo(cx + w * JACK_CAP_HALF_WIDTH * HALF, baseY - w * JACK_CAP_HEIGHT);
  ctx.quadraticCurveTo(
    cx + w * JACK_FEATHER_SPREAD,
    baseY - w * JACK_FEATHER_RISE,
    cx + w * JACK_FEATHER_SPREAD * HALF,
    baseY - w * JACK_FEATHER_RISE,
  );
  ctx.stroke();
}

type CourtHatDrawer = (ctx: CanvasRenderingContext2D, cx: number, baseY: number, w: number) => void;

const COURT_HATS: Record<'J' | 'Q' | 'K', CourtHatDrawer> = {
  J: drawJackCap,
  Q: drawTiara,
  K: drawCrown,
};

const COURT_ROBES: Record<'J' | 'Q' | 'K', string> = {
  J: COURT_ROBE_LIGHT,
  Q: COURT_ROBE,
  K: COURT_ROBE,
};

function drawCourtFigure(
  ctx: CanvasRenderingContext2D,
  rank: 'J' | 'Q' | 'K',
  cx: number,
  top: number,
  w: number,
  h: number,
): void {
  drawCourtBody(ctx, cx, top, w, h, COURT_ROBES[rank]);
  const headTop = top + h * COURT_HEAD_Y_FRACTION - w * COURT_HEAD_RADIUS_FRACTION;
  COURT_HATS[rank](ctx, cx, headTop, w);
}

function courtRankOf(rank: Rank): 'J' | 'Q' | 'K' | null {
  if (rank === 'J' || rank === 'Q' || rank === 'K') return rank;
  return null;
}

// ── The card ────────────────────────────────────────────────────────────────

/**
 * Wrap `body` in the card's transform: centred, rotated, and squashed
 * horizontally by the flip. Returns without drawing when the squash has closed
 * the card to nothing.
 */
function withCardTransform(
  ctx: CanvasRenderingContext2D,
  rect: CardRect,
  opts: CardDrawOpts,
  body: (w: number, h: number) => void,
): void {
  const w = rect.width;
  const h = cardHeight(w);
  const flip = opts.flipProgress ?? 0;
  // The squash runs 1 → 0 → 1 across the flip; the caller swaps face for back at
  // the midpoint, which is where the card is edge-on and the swap is invisible.
  const squash = Math.max(MIN_FLIP_SCALE, Math.abs(flip - FLIP_MIDPOINT) / FLIP_MIDPOINT);
  const scaleX = flip === 0 ? 1 : squash;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.translate(rect.x + w * HALF, rect.y + h * HALF);
  if (rect.rotation !== undefined && rect.rotation !== 0) ctx.rotate(rect.rotation);
  ctx.scale(scaleX, 1);
  ctx.translate(-w * HALF, -h * HALF);
  body(w, h);
  ctx.restore();
}

function applyCardShadow(ctx: CanvasRenderingContext2D, w: number, opts: CardDrawOpts): void {
  if (opts.highlight !== undefined) {
    ctx.shadowColor = opts.highlight;
    ctx.shadowBlur = w * HIGHLIGHT_GLOW_BLUR_FRACTION;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  if (opts.liftShadow === true) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = w * LIFT_SHADOW_BLUR_FRACTION;
    ctx.shadowOffsetX = w * LIFT_SHADOW_OFFSET_FRACTION;
    ctx.shadowOffsetY = w * LIFT_SHADOW_OFFSET_FRACTION;
  }
}

function drawCardBody(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: CardDrawOpts,
): void {
  ctx.save();
  applyCardShadow(ctx, w, opts);
  drawBox(ctx, {
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: FACE_FILL,
    border: FACE_BORDER,
    borderWidth: Math.max(1, w * BORDER_WIDTH_FRACTION),
    radius: w * RADIUS_FRACTION,
  });
  ctx.restore();
}

function drawCornerIndex(
  ctx: CanvasRenderingContext2D,
  card: Card,
  w: number,
  h: number,
  color: string,
): void {
  const indexSize =
    w * (card.rank.length > 1 ? WIDE_RANK_INDEX_WIDTH_FRACTION : CORNER_INDEX_WIDTH_FRACTION);
  const glyphSize = w * CORNER_GLYPH_SIZE_FRACTION;
  const insetX = w * CORNER_INSET_X_FRACTION;
  const insetY = h * CORNER_INSET_Y_FRACTION;

  /** One corner, drawn at the origin; the bottom-right copy is the same block rotated 180°. */
  const drawCorner = (): void => {
    drawText(ctx, card.rank, {
      x: insetX,
      y: insetY,
      size: indexSize,
      bold: true,
      color,
      align: 'center',
    });
    drawSuitGlyph(
      ctx,
      card.suit,
      insetX,
      insetY + indexSize + glyphSize * HALF + w * CORNER_GLYPH_GAP_FRACTION,
      glyphSize,
      color,
    );
  };

  drawCorner();
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  drawCorner();
  ctx.restore();
}

function drawPipField(
  ctx: CanvasRenderingContext2D,
  card: Card,
  w: number,
  h: number,
  color: string,
): void {
  const layout = PIP_LAYOUTS[card.rank];
  if (layout.length === 0) return;

  const cx = w * HALF;
  const cy = h * HALF;
  const halfW = w * PIP_FIELD_HALF_WIDTH_FRACTION;
  const halfH = h * PIP_FIELD_HALF_HEIGHT_FRACTION;

  if (card.rank === 'A') {
    drawSuitGlyph(ctx, card.suit, cx, cy, w * ACE_PIP_WIDTH_FRACTION, color);
    return;
  }

  const pipSize = w * PIP_WIDTH_FRACTION;
  for (const [gx, gy] of layout) {
    const px = cx + gx * halfW;
    const py = cy + gy * halfH;
    if (gy > 0) {
      // Pips below the middle are inverted, exactly as on a real card.
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI);
      drawSuitGlyph(ctx, card.suit, 0, 0, pipSize, color);
      ctx.restore();
    } else {
      drawSuitGlyph(ctx, card.suit, px, py, pipSize, color);
    }
  }
}

function applyDim(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dim: number | undefined,
): void {
  if (dim === undefined || dim <= 0) return;
  // The opacity goes to drawBox, not to globalAlpha: drawBox sets its own alpha
  // from `opts.alpha` (default 1), which would overwrite an ambient one and turn
  // the veil into an opaque slab.
  drawBox(ctx, {
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: DIM_VEIL,
    radius: w * RADIUS_FRACTION,
    alpha: dim,
  });
}

export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  card: Card,
  rect: CardRect,
  opts: CardDrawOpts = {},
): void {
  withCardTransform(ctx, rect, opts, (w, h) => {
    drawCardBody(ctx, w, h, opts);
    const color = suitColor(card.suit);
    const court = courtRankOf(card.rank);
    if (court !== null) {
      drawCourtFigure(
        ctx,
        court,
        w * HALF,
        h * COURT_INSET_Y_FRACTION,
        w * (1 - COURT_INSET_X_FRACTION * 2),
        h * (1 - COURT_INSET_Y_FRACTION * 2),
      );
      // The suit sits on the figure's chest rather than under it: a centred
      // glyph at the foot of the card runs straight into the inverted index.
      drawSuitGlyph(
        ctx,
        card.suit,
        w * HALF,
        h * COURT_CHEST_Y_FRACTION,
        w * COURT_CHEST_SUIT_FRACTION,
        color,
      );
    } else {
      drawPipField(ctx, card, w, h, color);
    }
    drawCornerIndex(ctx, card, w, h, color);
    applyDim(ctx, w, h, opts.dim);
  });
}

export function drawCardBack(
  ctx: CanvasRenderingContext2D,
  rect: CardRect,
  opts: CardDrawOpts = {},
): void {
  withCardTransform(ctx, rect, opts, (w, h) => {
    ctx.save();
    applyCardShadow(ctx, w, opts);
    drawBox(ctx, {
      x: 0,
      y: 0,
      width: w,
      height: h,
      fill: BACK_FELT_EDGE,
      border: BACK_BORDER,
      borderWidth: Math.max(1, w * BORDER_WIDTH_FRACTION),
      radius: w * RADIUS_FRACTION,
    });
    ctx.restore();

    const inset = w * BACK_INSET_FRACTION;
    const innerW = w - inset * 2;
    const innerH = h - inset * 2;
    drawBox(ctx, {
      x: inset,
      y: inset,
      width: innerW,
      height: innerH,
      fill: BACK_FELT,
      radius: w * RADIUS_FRACTION * HALF,
    });

    // Diagonal lattice, clipped to the felt panel so it never crosses the border.
    ctx.save();
    ctx.beginPath();
    ctx.rect(inset, inset, innerW, innerH);
    ctx.clip();
    ctx.strokeStyle = BACK_LATTICE;
    ctx.lineWidth = Math.max(1, w * BACK_LATTICE_WIDTH_FRACTION);
    const spacing = w * BACK_LATTICE_SPACING_FRACTION;
    const span = innerW + innerH;
    for (let offset = -innerH; offset < span; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(inset + offset, inset);
      ctx.lineTo(inset + offset + innerH, inset + innerH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(inset + offset, inset + innerH);
      ctx.lineTo(inset + offset + innerH, inset);
      ctx.stroke();
    }
    ctx.restore();

    // Centred club emblem — the tell that stops the back reading as a face.
    const emblemR = w * BACK_EMBLEM_RADIUS_FRACTION;
    ctx.fillStyle = BACK_FELT_EDGE;
    ctx.beginPath();
    ctx.arc(w * HALF, h * HALF, emblemR, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = BACK_EMBLEM;
    ctx.lineWidth = Math.max(1, w * BACK_LATTICE_WIDTH_FRACTION);
    ctx.stroke();
    drawSuitGlyph(ctx, 'spades', w * HALF, h * HALF, emblemR, BACK_EMBLEM);
  });
}

/**
 * Draw a card mid-flip: the back until the halfway point, the face after it.
 * `flipProgress` runs 0 → 1; the swap happens where the card is edge-on.
 */
export function drawCardFlip(
  ctx: CanvasRenderingContext2D,
  card: Card,
  rect: CardRect,
  flipProgress: number,
  opts: CardDrawOpts = {},
): void {
  const withFlip = { ...opts, flipProgress };
  if (flipProgress < FLIP_MIDPOINT) drawCardBack(ctx, rect, withFlip);
  else drawCardFace(ctx, card, rect, withFlip);
}
