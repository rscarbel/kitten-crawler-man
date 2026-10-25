/**
 * The cards Deuce handles: single cards lying flat or turning over in his
 * fingers, and the squared deck. Shared by the portrait and the figure on the
 * club floor, each passing its own card size.
 */

import { mix, type Pt } from '../bipedArt';
import {
  type Ctx,
  type Trace,
  fillTrace,
  outlineTrace,
  pt,
  strokeLine,
  tracePolygon,
} from './paint';
import { CARD_BACK, CARD_BACK_LINE, CARD_EDGE, CARD_FACE, CARD_RED, OUTLINE } from './palette';

export interface CardSize {
  width: number;
  height: number;
  /** A squared deck's depth, seen as its edge below the top card. */
  deckThickness: number;
}

/** The felt is seen from above at an angle: things lying on it are squashed. */
const FELT_FORESHORTEN = 0.62;
/** Card edges ruled across the deck's side, so it is not a plain block. */
const DECK_EDGE_LINES = 4;
const CARD_OUTLINE_PIXELS = 1.5;
const CARD_LINE_PIXELS = 0.8;
const DECK_EDGE_LINE_PIXELS = 0.7;
const DECK_EDGE_LINE_DEPTH = 0.3;

/** The back's coloured field sits inside a white border this share of the card. */
const CARD_BACK_INSET = 0.8;
const CENTRE_PIP_SIZE = 0.28;
const CORNER_PIP_SIZE = 0.1;
const CORNER_PIP_INSET = 0.35;
/** A turning card never goes thinner than this share of its width: it is seen as an edge. */
const EDGE_ON_WIDTH = 0.06;

/**
 * A heart pip as bezier handles in pip units: the point at the bottom, the two
 * lobes, the notch at the top.
 */
const HEART = {
  pointY: 0.55,
  lobeOuterX: 0.9,
  lobeOuterY: -0.05,
  lobeInnerX: 0.45,
  lobeTopY: -0.75,
  notchY: -0.25,
} as const;

/** A card lying on the felt (or held flat over it): a foreshortened rectangle. */
export function cardCorners(centre: Pt, angle: number, width: number, height: number): Pt[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = width / 2;
  const hh = height / 2;
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)].map((p) => {
    const x = p.x * c - p.y * s;
    const y = (p.x * s + p.y * c) * FELT_FORESHORTEN;
    return pt(centre.x + x, centre.y + y);
  });
}

function centreOf(corners: readonly Pt[]): Pt {
  return pt((corners[0].x + corners[2].x) / 2, (corners[0].y + corners[2].y) / 2);
}

export function paintCardBack(ctx: Ctx, corners: readonly Pt[]): void {
  const card: Trace = (c) => tracePolygon(c, corners);
  outlineTrace(ctx, card, CARD_OUTLINE_PIXELS);
  fillTrace(ctx, card, CARD_FACE);
  const centre = centreOf(corners);
  const inset = corners.map((p) =>
    pt(
      centre.x + (p.x - centre.x) * CARD_BACK_INSET,
      centre.y + (p.y - centre.y) * CARD_BACK_INSET,
    ),
  );
  fillTrace(ctx, (c) => tracePolygon(c, inset), CARD_BACK);
  strokeLine(ctx, [inset[0], inset[2]], CARD_BACK_LINE, CARD_LINE_PIXELS);
  strokeLine(ctx, [inset[1], inset[3]], CARD_BACK_LINE, CARD_LINE_PIXELS);
}

function paintHeart(ctx: Ctx, at: Pt, size: number): void {
  ctx.fillStyle = CARD_RED;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y + size * HEART.pointY);
  ctx.bezierCurveTo(
    at.x - size * HEART.lobeOuterX,
    at.y + size * HEART.lobeOuterY,
    at.x - size * HEART.lobeInnerX,
    at.y + size * HEART.lobeTopY,
    at.x,
    at.y + size * HEART.notchY,
  );
  ctx.bezierCurveTo(
    at.x + size * HEART.lobeInnerX,
    at.y + size * HEART.lobeTopY,
    at.x + size * HEART.lobeOuterX,
    at.y + size * HEART.lobeOuterY,
    at.x,
    at.y + size * HEART.pointY,
  );
  ctx.fill();
}

function paintCardFace(ctx: Ctx, corners: readonly Pt[]): void {
  const card: Trace = (c) => tracePolygon(c, corners);
  outlineTrace(ctx, card, CARD_OUTLINE_PIXELS);
  fillTrace(ctx, card, CARD_FACE);
  const centre = centreOf(corners);
  const size = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  paintHeart(ctx, centre, size * CENTRE_PIP_SIZE);
  const corner = corners[0];
  paintHeart(
    ctx,
    pt(
      corner.x + (centre.x - corner.x) * CORNER_PIP_INSET,
      corner.y + (centre.y - corner.y) * CORNER_PIP_INSET,
    ),
    size * CORNER_PIP_SIZE,
  );
}

/** A held card turning over about its long axis: narrows to an edge, then shows its face. */
export function paintTurningCard(
  ctx: Ctx,
  size: CardSize,
  centre: Pt,
  angle: number,
  flip: number,
): void {
  const turn = Math.cos(flip * Math.PI);
  const halfWidth = (size.width * Math.max(EDGE_ON_WIDTH, Math.abs(turn))) / 2;
  const halfHeight = size.height / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Held up off the felt while it turns, so it is seen nearly face-on.
  const corners = [
    pt(-halfWidth, -halfHeight),
    pt(halfWidth, -halfHeight),
    pt(halfWidth, halfHeight),
    pt(-halfWidth, halfHeight),
  ].map((p) => pt(centre.x + p.x * c - p.y * s, centre.y + p.x * s + p.y * c));
  if (turn >= 0) paintCardBack(ctx, corners);
  else paintCardFace(ctx, corners);
}

function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

/** A squared deck: the card-edge side toward the player, the top card's back on top. */
export function paintDeck(ctx: Ctx, size: CardSize, centre: Pt, angle: number): void {
  const top = cardCorners(centre, angle, size.width, size.height);
  const bottom = top.map((p) => pt(p.x, p.y + size.deckThickness));
  const sideTrace: Trace = (c) => tracePolygon(c, convexHull([...top, ...bottom]));
  outlineTrace(ctx, sideTrace, CARD_OUTLINE_PIXELS);
  fillTrace(ctx, sideTrace, CARD_EDGE);
  // Ruled card edges along the two faces that turn toward the player: the
  // edges either side of the top face's lowest corner.
  const lowest = top.reduce((best, p, i) => (p.y > top[best].y ? i : best), 0);
  const corners = top.length;
  const visibleRun = [
    top[(lowest + corners - 1) % corners],
    top[lowest],
    top[(lowest + 1) % corners],
  ];
  for (let edge = 1; edge < DECK_EDGE_LINES; edge++) {
    const drop = (size.deckThickness * edge) / DECK_EDGE_LINES;
    strokeLine(
      ctx,
      visibleRun.map((p) => pt(p.x, p.y + drop)),
      mix(CARD_EDGE, OUTLINE, DECK_EDGE_LINE_DEPTH),
      DECK_EDGE_LINE_PIXELS,
    );
  }
  paintCardBack(ctx, top);
}
