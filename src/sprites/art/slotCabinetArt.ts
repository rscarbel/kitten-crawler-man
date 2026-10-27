/**
 * The slot machine's cabinet as art: the red lacquer body with its gold
 * pin-striping, the polished chrome frame, the lit marquee with the
 * CLOAK & DAGGER sign, the bezel round the reel glass, the control deck and the
 * pull lever. Everything here is still; the view bakes it once per size and
 * paints the moving parts (bulbs, reels, digits, buttons) over it.
 */

import type { Rect } from '../../ui/core/geom';
import { UI_FONT_STACK } from '../../ui/theme/fonts';
import { slotsInk } from '../../ui/theme/slotsInk';
import { worldText } from '../../ui/world/worldText';

const cab = slotsInk.cabinet;
const mq = slotsInk.marquee;
const reelInk = slotsInk.reel;
const leverInk = slotsInk.lever;

export interface CabinetArtRects {
  readonly cabinet: Rect;
  readonly marquee: Rect;
  readonly glass: Rect;
  readonly bezel: number;
  readonly deck: Rect | null;
  /** The meter's plate when it sits inside the cabinet. */
  readonly meter: Rect | null;
}

/** Every proportion below is a share of the named part's width or height. */
const CABINET = { corner: 0.06, chromeRing: 0.018, minChromeRingPx: 3 } as const;

const CHROME = {
  /** How far across the part the chrome's sheen runs before it reaches the bottom. */
  sheenRun: 0.35,
  /** The dark keyline outside the ring, as a share of the ring's width. */
  keyline: 0.12,
  minKeylinePx: 1,
} as const;

const BODY = {
  shadowBlur: 0.06,
  shadowDrop: 0.025,
  pinstripeInset: 0.022,
  minPinstripeInsetPx: 3,
  /** The pinstripe's corner, as a share of the body's corner. */
  pinstripeCorner: 0.8,
  pinstripeWidth: 0.004,
  minPinstripeWidthPx: 1,
} as const;

const MARQUEE = {
  cornerOfHeight: 0.35,
  cornerOfWidth: 0.06,
  /** The sunburst fans out from just below the marquee's bottom edge. */
  sunburstOrigin: 1.1,
  sunburstRays: 18,
  sunburstAlpha: 0.18,
  bulbBandOfHeight: 0.2,
  bulbBandOfWidth: 0.05,
  titleOfHeight: 0.46,
  titleOfWidth: 0.085,
  subtitleOfHeight: 0.16,
  subtitleOfWidth: 0.045,
  /** The title's centre, as a share of the face left between the bulb bands. */
  titleAt: 0.42,
  /** Title outline, glow and the subtitle's drop are shares of the title's size. */
  titleOutline: 0.12,
  titleGlow: 0.35,
  subtitleDrop: 0.62,
  ring: 0.05,
  minRingPx: 2,
} as const;

/** The bezel's corner, as a share of the bezel's width. */
const BEZEL_CORNER = 1.5;

const DECK = { corner: 0.12, trim: 0.02, minTrimPx: 1 } as const;

const METER_PLATE = { corner: 0.25, trim: 0.06, minTrimPx: 1.5 } as const;

/** The sheen's diagonal reaches this share across the glass by the bottom edge. */
const GLASS_SHEEN_RUN = 0.5;

const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;

/** Lever proportions, as shares of the lever's area unless noted. */
const LEVER = {
  socketWidth: 0.5,
  socketHeight: 0.22,
  socketTop: 0.55,
  /** Shares of the socket. */
  socketCorner: 0.3,
  pivotAcross: 0.62,
  pivotDown: 0.5,
  rodLength: 0.5,
  /** How far round the arc a full pull swings, as a share of a half turn. */
  swing: 0.95,
  /** The rod points toward the viewer, so its sideways sweep is foreshortened. */
  sideways: 0.55,
  rodWidth: 0.1,
  minRodWidthPx: 3,
  ballRadius: 0.26,
  minBallRadiusPx: 6,
  /** The ball's highlight, as shares of its radius. */
  highlightOffset: 0.35,
  highlightCore: 0.1,
} as const;

/** Bulb proportions; everything after `radius` is a share of the bulb's radius. */
const BULB = {
  radius: 0.22,
  glowCore: 0.5,
  rim: 1.25,
  highlightOffset: 0.3,
  highlightCore: 0.1,
} as const;

/** Coin proportions, as shares of its radius. */
const COIN = {
  /** Edge-on, a coin keeps this much width so it never vanishes mid-spin. */
  minSquash: 0.15,
  face: 0.82,
  glintOffset: 0.25,
  glintRadius: 0.28,
} as const;

function roundedPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
}

function chromeGradient(ctx: CanvasRenderingContext2D, r: Rect): CanvasGradient {
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w * CHROME.sheenRun, r.y + r.h);
  g.addColorStop(0, cab.chromeLight);
  g.addColorStop(0.18, cab.chrome);
  g.addColorStop(0.36, cab.chromeDark);
  g.addColorStop(0.52, cab.chromeLight);
  g.addColorStop(0.7, cab.chromeMid);
  g.addColorStop(0.86, cab.chrome);
  g.addColorStop(1, cab.chromeDark);
  return g;
}

function chromeRing(ctx: CanvasRenderingContext2D, r: Rect, radius: number, width: number): void {
  ctx.save();
  roundedPath(ctx, r, radius);
  ctx.lineWidth = width;
  ctx.strokeStyle = chromeGradient(ctx, r);
  ctx.stroke();
  ctx.lineWidth = Math.max(CHROME.minKeylinePx, width * CHROME.keyline);
  ctx.strokeStyle = cab.chromeDark;
  roundedPath(
    ctx,
    { x: r.x - width / 2, y: r.y - width / 2, w: r.w + width, h: r.h + width },
    radius + width / 2,
  );
  ctx.stroke();
  ctx.restore();
}

function paintBody(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.save();
  ctx.shadowColor = cab.shadow;
  ctx.shadowBlur = r.w * BODY.shadowBlur;
  ctx.shadowOffsetY = r.w * BODY.shadowDrop;
  roundedPath(ctx, r, radius);
  const body = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
  body.addColorStop(0, cab.bodyDark);
  body.addColorStop(0.12, cab.body);
  body.addColorStop(0.3, cab.bodyLight);
  body.addColorStop(0.5, cab.body);
  body.addColorStop(0.85, cab.body);
  body.addColorStop(1, cab.bodyDark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  const stripeInset = Math.max(BODY.minPinstripeInsetPx, r.w * BODY.pinstripeInset);
  ctx.save();
  roundedPath(
    ctx,
    {
      x: r.x + stripeInset,
      y: r.y + stripeInset,
      w: r.w - stripeInset * 2,
      h: r.h - stripeInset * 2,
    },
    radius * BODY.pinstripeCorner,
  );
  ctx.lineWidth = Math.max(BODY.minPinstripeWidthPx, r.w * BODY.pinstripeWidth);
  ctx.strokeStyle = cab.trim;
  ctx.stroke();
  ctx.restore();
}

function paintMarquee(ctx: CanvasRenderingContext2D, r: Rect): void {
  const radius = Math.min(r.h * MARQUEE.cornerOfHeight, r.w * MARQUEE.cornerOfWidth);
  ctx.save();
  roundedPath(ctx, r, radius);
  const face = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  face.addColorStop(0, mq.faceLight);
  face.addColorStop(1, mq.face);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.clip();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h * MARQUEE.sunburstOrigin;
  const rays = MARQUEE.sunburstRays;
  ctx.globalAlpha = MARQUEE.sunburstAlpha;
  ctx.fillStyle = mq.titleGlow;
  for (let i = 0; i < rays; i++) {
    if (i % 2 === 1) continue;
    const a0 = Math.PI + (i / rays) * Math.PI;
    const a1 = Math.PI + ((i + 1) / rays) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r.w, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const bulbBand = Math.min(r.h * MARQUEE.bulbBandOfHeight, r.w * MARQUEE.bulbBandOfWidth);
  const titleSize = Math.min(r.h * MARQUEE.titleOfHeight, r.w * MARQUEE.titleOfWidth);
  const subtitleSize = Math.min(r.h * MARQUEE.subtitleOfHeight, r.w * MARQUEE.subtitleOfWidth);
  const titleY = r.y + bulbBand + (r.h - bulbBand * 2) * MARQUEE.titleAt;
  worldText(ctx, 'CLOAK & DAGGER', {
    x: cx,
    y: titleY,
    size: titleSize,
    bold: true,
    color: mq.title,
    outline: mq.titleOutline,
    outlineWidth: titleSize * MARQUEE.titleOutline,
    glow: mq.titleGlow,
    glowBlur: titleSize * MARQUEE.titleGlow,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
  worldText(ctx, '★  SLOTS  ★', {
    x: cx,
    y: titleY + titleSize * MARQUEE.subtitleDrop,
    size: subtitleSize,
    bold: true,
    color: mq.subtitle,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
  chromeRing(ctx, r, radius, Math.max(MARQUEE.minRingPx, r.h * MARQUEE.ring));
}

function paintBezel(ctx: CanvasRenderingContext2D, glass: Rect, bezel: number): void {
  const outer: Rect = {
    x: glass.x - bezel,
    y: glass.y - bezel,
    w: glass.w + bezel * 2,
    h: glass.h + bezel * 2,
  };
  ctx.save();
  roundedPath(ctx, outer, bezel * BEZEL_CORNER);
  ctx.fillStyle = cab.bodyDark;
  ctx.fill();
  ctx.restore();
  chromeRing(
    ctx,
    { x: glass.x - bezel / 2, y: glass.y - bezel / 2, w: glass.w + bezel, h: glass.h + bezel },
    bezel,
    bezel,
  );
}

function paintDeck(ctx: CanvasRenderingContext2D, deck: Rect): void {
  const radius = deck.h * DECK.corner;
  ctx.save();
  roundedPath(ctx, deck, radius);
  const g = ctx.createLinearGradient(0, deck.y, 0, deck.y + deck.h);
  g.addColorStop(0, cab.deckEdge);
  g.addColorStop(0.15, cab.deck);
  g.addColorStop(1, cab.bodyDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(DECK.minTrimPx, deck.h * DECK.trim);
  ctx.strokeStyle = cab.trim;
  ctx.stroke();
  ctx.restore();
}

function paintMeterPlate(ctx: CanvasRenderingContext2D, meter: Rect): void {
  const radius = meter.h * METER_PLATE.corner;
  ctx.save();
  roundedPath(ctx, meter, radius);
  ctx.fillStyle = slotsInk.meter.face;
  ctx.fill();
  ctx.lineWidth = Math.max(METER_PLATE.minTrimPx, meter.h * METER_PLATE.trim);
  ctx.strokeStyle = cab.trim;
  ctx.stroke();
  ctx.restore();
}

/** The whole still cabinet, in the caller's units. */
export function paintSlotCabinet(ctx: CanvasRenderingContext2D, rects: CabinetArtRects): void {
  const { cabinet } = rects;
  const shortSide = Math.min(cabinet.w, cabinet.h);
  const radius = shortSide * CABINET.corner;
  paintBody(ctx, cabinet, radius);
  chromeRing(
    ctx,
    cabinet,
    radius,
    Math.max(CABINET.minChromeRingPx, shortSide * CABINET.chromeRing),
  );
  paintMarquee(ctx, rects.marquee);
  if (rects.meter !== null) paintMeterPlate(ctx, rects.meter);
  paintBezel(ctx, rects.glass, rects.bezel);
  if (rects.deck !== null) paintDeck(ctx, rects.deck);
}

/** The meter plate on its own, for a meter that rides in a phone's header strip. */
export function paintSlotMeterPlate(ctx: CanvasRenderingContext2D, meter: Rect): void {
  paintMeterPlate(ctx, meter);
}

/**
 * The glass over the reels: the drum's curve darkening the top and bottom
 * rows and a diagonal sheen. Painted over the symbols every frame from a
 * bake, so it has to be transparent everywhere else.
 */
export function paintSlotGlass(ctx: CanvasRenderingContext2D, glass: Rect): void {
  const curve = ctx.createLinearGradient(0, glass.y, 0, glass.y + glass.h);
  curve.addColorStop(0, reelInk.curve);
  curve.addColorStop(0.2, reelInk.curveFade);
  curve.addColorStop(0.8, reelInk.curveFade);
  curve.addColorStop(1, reelInk.curve);
  ctx.fillStyle = curve;
  ctx.fillRect(glass.x, glass.y, glass.w, glass.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.w, glass.h);
  ctx.clip();
  const sheen = ctx.createLinearGradient(
    glass.x,
    glass.y,
    glass.x + glass.w * GLASS_SHEEN_RUN,
    glass.y + glass.h,
  );
  sheen.addColorStop(0, reelInk.glassSheen);
  sheen.addColorStop(0.35, reelInk.glassSheenFade);
  sheen.addColorStop(0.62, reelInk.glassSheenFade);
  sheen.addColorStop(0.7, reelInk.glassSheen);
  sheen.addColorStop(0.78, reelInk.glassSheenFade);
  ctx.fillStyle = sheen;
  ctx.fillRect(glass.x, glass.y, glass.w, glass.h);
  ctx.restore();
}

/**
 * The pull lever in its slot at the cabinet's side. `pull` runs 0 (up) to 1
 * (fully down); the ball swings through an arc and the rod foreshortens.
 */
export function paintSlotLever(ctx: CanvasRenderingContext2D, area: Rect, pull: number): void {
  const socketW = area.w * LEVER.socketWidth;
  const socketH = area.h * LEVER.socketHeight;
  const socketX = area.x;
  const socketY = area.y + area.h * LEVER.socketTop;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(socketX, socketY, socketW, socketH, socketH * LEVER.socketCorner);
  const socket = ctx.createLinearGradient(socketX, 0, socketX + socketW, 0);
  socket.addColorStop(0, leverInk.socket);
  socket.addColorStop(0.5, leverInk.socketLight);
  socket.addColorStop(1, leverInk.socket);
  ctx.fillStyle = socket;
  ctx.fill();
  ctx.restore();

  const pivotX = socketX + socketW * LEVER.pivotAcross;
  const pivotY = socketY + socketH * LEVER.pivotDown;
  const length = area.h * LEVER.rodLength;
  const angle = -QUARTER_TURN + pull * Math.PI * LEVER.swing;
  const ballX = pivotX + Math.cos(angle) * length * LEVER.sideways;
  const ballY = pivotY + Math.sin(angle) * length;
  const rodWidth = Math.max(LEVER.minRodWidthPx, area.w * LEVER.rodWidth);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = rodWidth;
  const rod = ctx.createLinearGradient(pivotX - rodWidth, 0, pivotX + rodWidth, 0);
  rod.addColorStop(0, leverInk.rodDark);
  rod.addColorStop(0.5, leverInk.rod);
  rod.addColorStop(1, leverInk.rodDark);
  ctx.strokeStyle = rod;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(ballX, ballY);
  ctx.stroke();
  const ballR = Math.max(LEVER.minBallRadiusPx, area.w * LEVER.ballRadius);
  const ball = ctx.createRadialGradient(
    ballX - ballR * LEVER.highlightOffset,
    ballY - ballR * LEVER.highlightOffset,
    ballR * LEVER.highlightCore,
    ballX,
    ballY,
    ballR,
  );
  ball.addColorStop(0, leverInk.ballLight);
  ball.addColorStop(0.5, leverInk.ball);
  ball.addColorStop(1, leverInk.ballDark);
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballR, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** One marquee bulb, lit or dark, centred in a square of side `size`. */
export function paintSlotBulb(ctx: CanvasRenderingContext2D, size: number, lit: boolean): void {
  const c = size / 2;
  const r = size * BULB.radius;
  if (lit) {
    const glow = ctx.createRadialGradient(c, c, r * BULB.glowCore, c, c, c);
    glow.addColorStop(0, mq.bulbGlow);
    glow.addColorStop(1, slotsInk.reel.curveFade);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.beginPath();
  ctx.arc(c, c, r * BULB.rim, 0, FULL_TURN);
  ctx.fillStyle = mq.bulbRim;
  ctx.fill();
  const face = ctx.createRadialGradient(
    c - r * BULB.highlightOffset,
    c - r * BULB.highlightOffset,
    r * BULB.highlightCore,
    c,
    c,
    r,
  );
  face.addColorStop(0, lit ? slotsInk.coin.spark : mq.bulbOff);
  face.addColorStop(1, lit ? mq.bulbOn : mq.bulbRim);
  ctx.beginPath();
  ctx.arc(c, c, r, 0, FULL_TURN);
  ctx.fillStyle = face;
  ctx.fill();
}

/** A gold coin seen at `spin` (its edge-on squash), centred on the origin. */
export function paintSlotCoin(ctx: CanvasRenderingContext2D, radius: number, spin: number): void {
  const coin = slotsInk.coin;
  const squash = Math.max(COIN.minSquash, Math.abs(Math.cos(spin)));
  ctx.save();
  ctx.scale(squash, 1);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_TURN);
  ctx.fillStyle = coin.dark;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius * COIN.face, 0, FULL_TURN);
  ctx.fillStyle = coin.face;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    -radius * COIN.glintOffset,
    -radius * COIN.glintOffset,
    radius * COIN.glintRadius,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = coin.light;
  ctx.fill();
  ctx.restore();
}
