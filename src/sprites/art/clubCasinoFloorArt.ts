/**
 * The Desperado Club casino's games, as furniture on the floor: the bank of
 * slot cabinets, the big upright Wheel of Fortune and Tito's croupier counter.
 *
 * Painted by the same conventions as the rest of the club's furniture
 * (`clubFurnitureArt.ts`): a 64px logical tile, the frame's bottom tile row as
 * the footprint, and everything above it rising into the tiles behind.
 *
 * Bulbs are split out of the cabinets and the wheel into their own light
 * sheets. The body is painted once with dim sockets, and each light sheet holds
 * a few chase phases of the lit bulbs alone, so a running marquee costs one
 * extra cached blit per prop rather than a repaint.
 */

import { BASE_WHEEL_BOARD } from '../../systems/casino/wheel/wheelBoard';
import {
  rotationForPointerAt,
  wedgeCenterAngle,
  wedgeEndAngle,
  wedgeStartAngle,
} from '../../systems/casino/wheel/wheelGeometry';
import {
  BRASS,
  BRASS_DARK,
  BRASS_LIGHT,
  CLUB_TILE_SCALE,
  MAHOGANY,
  WALNUT,
  paintContactShadow,
  paintRimLight,
  paintWoodGrain,
  roundRectPath,
  variantRng,
  verticalGradient,
  type ClubFrameGeometry,
  type Rect,
  type VariantSeed,
} from './clubFurnitureArt';
import { WHEEL_BULB, WHEEL_GOLD, WHEEL_POINTER, WHEEL_TONE_INK } from './wheelPalette';

type Ctx = CanvasRenderingContext2D;

const T = CLUB_TILE_SCALE;
const TWO_PI = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const HALF = 0.5;

/** Chase phases in every light sheet; the layout steps through them in order. */
export const CASINO_LIGHT_PHASES = 4;
/** Bulbs lit at once out of each run of `CASINO_LIGHT_PHASES`: a travelling pair. */
const CHASE_LIT_PER_RUN = 2;

/** Whether bulb `index` is lit in chase `phase`; the lit pair walks one bulb per phase. */
function bulbLit(index: number, phase: number): boolean {
  const offset =
    (((index - phase) % CASINO_LIGHT_PHASES) + CASINO_LIGHT_PHASES) % CASINO_LIGHT_PHASES;
  return offset < CHASE_LIT_PER_RUN;
}

const SHADOW_INK = 'rgba(0,0,0,0.45)';
const SOFT_SHADOW_INK = 'rgba(0,0,0,0.25)';
const LACQUER_GLINT = 'rgba(255,255,255,0.22)';
const RIM_LIGHT_INK = 'rgba(255,232,190,0.45)';
const CHROME = { light: '#f2f5f8', base: '#aab3bd', dark: '#4e5560' } as const;

// ── Bulbs ───────────────────────────────────────────────────────────────────

/** Glow radius as a multiple of the bulb's own radius. */
const BULB_GLOW_SCALE = 2.6;
const BULB_SOCKET_SCALE = 1.35;
const BULB_CORE_SCALE = 0.45;
const BULB_CORE_OFFSET = 0.25;

function paintBulbSocket(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = WHEEL_BULB.socket;
  ctx.beginPath();
  ctx.arc(x, y, r * BULB_SOCKET_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WHEEL_BULB.unlit;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

function paintLitBulb(ctx: Ctx, x: number, y: number, r: number): void {
  const glowR = r * BULB_GLOW_SCALE;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  glow.addColorStop(0, WHEEL_BULB.glow);
  glow.addColorStop(1, WHEEL_BULB.glowEdge);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WHEEL_BULB.lit;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WHEEL_BULB.litCore;
  ctx.beginPath();
  ctx.arc(x - r * BULB_CORE_OFFSET, y - r * BULB_CORE_OFFSET, r * BULB_CORE_SCALE, 0, TWO_PI);
  ctx.fill();
}

// ── The Wheel of Fortune ────────────────────────────────────────────────────

const WHEEL = {
  centerYTiles: 1.36,
  radiusTiles: 1.1,
  rimTiles: 0.16,
  hubTiles: 0.2,
  hubJewelTiles: 0.07,
  bulbs: 24,
  bulbTiles: 0.042,
  pegTiles: 0.022,
  /** Pegs sit just inside the rim, on the wedge boundaries. */
  pegInsetTiles: 0.05,
  spokeWidth: 1.6,
  /** Inner and outer ends of the painted label, as fractions of the face radius. */
  labelFrom: 0.56,
  labelTo: 0.86,
  labelWidth: 1.8,
  /** A sliver narrower than this many units has no room for a label. */
  labelMinUnits: 1,
  pointerHalfTiles: 0.13,
  pointerRiseTiles: 0.14,
  pointerDropTiles: 0.12,
  pointerMountTiles: 0.07,
  plinthTopTiles: 2.28,
  plinthBottomTiles: 2.9,
  plinthInsetTiles: 0.62,
  plinthPanelInsetTiles: 0.08,
  plinthTrimTiles: 0.05,
  postHalfTiles: 0.09,
  shadowRyTiles: 0.16,
  glintFrom: 1.15 * Math.PI,
  glintTo: 1.55 * Math.PI,
  glintRadius: 0.82,
  glintWidth: 4,
  hubShadeStop: 0.35,
  rimEdgeWidth: 1.5,
} as const;

/** The wedge the idle prop shows under its pointer: a big good prize, like a window display. */
const WHEEL_DISPLAY_WEDGE = 1;

const WHEEL_PLINTH_FACE = { top: '#5e0d18', bottom: '#2a0409' } as const;

interface WheelLayout {
  cx: number;
  cy: number;
  outerR: number;
  faceR: number;
  bulbR: number;
}

function wheelLayout(geo: ClubFrameGeometry): WheelLayout {
  const outerR = WHEEL.radiusTiles * T;
  return {
    cx: geo.w * HALF,
    cy: WHEEL.centerYTiles * T,
    outerR,
    faceR: outerR - WHEEL.rimTiles * T,
    bulbR: outerR - (WHEEL.rimTiles * T) / 2,
  };
}

function bulbPosition(layout: WheelLayout, index: number): { x: number; y: number } {
  const angle = (index / WHEEL.bulbs) * TWO_PI - QUARTER_TURN;
  return {
    x: layout.cx + Math.cos(angle) * layout.bulbR,
    y: layout.cy + Math.sin(angle) * layout.bulbR,
  };
}

/** Canvas angle of a wheel-frame angle, with the board turned to show its display wedge. */
function canvasAngle(wheelAngle: number): number {
  const displayRotation = rotationForPointerAt(
    wedgeCenterAngle(BASE_WHEEL_BOARD, WHEEL_DISPLAY_WEDGE),
  );
  return wheelAngle + displayRotation - QUARTER_TURN;
}

/**
 * The upright wheel on its velvet plinth: the same ring of wedges, in the same
 * order and colours, as the board the wheel screen spins, framed in a gold rim
 * studded with bulb sockets and topped by the red pointer.
 */
export function drawFortuneWheel(ctx: Ctx, geo: ClubFrameGeometry): void {
  const layout = wheelLayout(geo);
  const { cx, cy, outerR, faceR } = layout;

  paintContactShadow(
    ctx,
    cx,
    WHEEL.plinthBottomTiles * T,
    geo.w * HALF - WHEEL.plinthInsetTiles * T + T * WHEEL.plinthTrimTiles,
    WHEEL.shadowRyTiles * T,
  );
  paintWheelPlinth(ctx, geo, cx, cy);
  paintWheelFace(ctx, layout);
  paintWheelRim(ctx, layout);
  paintWheelHub(ctx, cx, cy);

  for (let i = 0; i < WHEEL.bulbs; i++) {
    const { x, y } = bulbPosition(layout, i);
    paintBulbSocket(ctx, x, y, WHEEL.bulbTiles * T);
  }

  // Lacquer catching the room light across the upper left of the face.
  ctx.strokeStyle = LACQUER_GLINT;
  ctx.lineWidth = WHEEL.glintWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, faceR * WHEEL.glintRadius, WHEEL.glintFrom, WHEEL.glintTo);
  ctx.stroke();

  paintWheelPointer(ctx, cx, cy - outerR);
}

function paintWheelPlinth(ctx: Ctx, geo: ClubFrameGeometry, cx: number, cy: number): void {
  const postHalf = WHEEL.postHalfTiles * T;
  verticalGradient(
    ctx,
    { x: cx - postHalf, y: cy, w: postHalf * 2, h: WHEEL.plinthTopTiles * T - cy },
    [
      [0, BRASS_DARK],
      [1, WHEEL_GOLD.deep],
    ],
  );

  const inset = WHEEL.plinthInsetTiles * T;
  const plinth: Rect = {
    x: inset,
    y: WHEEL.plinthTopTiles * T,
    w: geo.w - inset * 2,
    h: (WHEEL.plinthBottomTiles - WHEEL.plinthTopTiles) * T,
  };
  verticalGradient(ctx, plinth, [
    [0, WHEEL_PLINTH_FACE.top],
    [1, WHEEL_PLINTH_FACE.bottom],
  ]);
  const panelInset = WHEEL.plinthPanelInsetTiles * T;
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = WHEEL.rimEdgeWidth;
  roundRectPath(
    ctx,
    {
      x: plinth.x + panelInset,
      y: plinth.y + panelInset,
      w: plinth.w - panelInset * 2,
      h: plinth.h - panelInset * 2,
    },
    panelInset,
  );
  ctx.stroke();
  const trim = WHEEL.plinthTrimTiles * T;
  verticalGradient(
    ctx,
    { x: plinth.x - trim, y: plinth.y - trim, w: plinth.w + trim * 2, h: trim * 2 },
    [
      [0, BRASS_LIGHT],
      [1, BRASS_DARK],
    ],
  );
  verticalGradient(
    ctx,
    { x: plinth.x - trim, y: plinth.y + plinth.h - trim, w: plinth.w + trim * 2, h: trim * 2 },
    [
      [0, BRASS],
      [1, BRASS_DARK],
    ],
  );
}

function paintWheelFace(ctx: Ctx, layout: WheelLayout): void {
  const { cx, cy, faceR } = layout;
  BASE_WHEEL_BOARD.forEach((wedge, index) => {
    const ink = WHEEL_TONE_INK[wedge.tone];
    const from = canvasAngle(wedgeStartAngle(BASE_WHEEL_BOARD, index));
    const to = canvasAngle(wedgeEndAngle(BASE_WHEEL_BOARD, index));
    const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, faceR);
    shade.addColorStop(0, ink.dark);
    shade.addColorStop(WHEEL.hubShadeStop, ink.base);
    shade.addColorStop(1, ink.light);
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, faceR, from, to);
    ctx.closePath();
    ctx.fill();

    if (wedge.units < WHEEL.labelMinUnits) return;
    // Text this small cannot be read, but a light stroke where the label sits
    // still reads as lettering, and the board's rhythm of light and dark marks
    // is what the eye matches against the wheel screen.
    const mid = canvasAngle(wedgeCenterAngle(BASE_WHEEL_BOARD, index));
    ctx.strokeStyle = ink.label;
    ctx.lineWidth = WHEEL.labelWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(mid) * faceR * WHEEL.labelFrom,
      cy + Math.sin(mid) * faceR * WHEEL.labelFrom,
    );
    ctx.lineTo(
      cx + Math.cos(mid) * faceR * WHEEL.labelTo,
      cy + Math.sin(mid) * faceR * WHEEL.labelTo,
    );
    ctx.stroke();
    ctx.lineCap = 'butt';
  });

  ctx.strokeStyle = WHEEL_GOLD.base;
  ctx.lineWidth = WHEEL.spokeWidth;
  const pegR = WHEEL.pegTiles * T;
  const pegRadius = faceR - WHEEL.pegInsetTiles * T;
  BASE_WHEEL_BOARD.forEach((_, index) => {
    const edge = canvasAngle(wedgeStartAngle(BASE_WHEEL_BOARD, index));
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(edge) * faceR, cy + Math.sin(edge) * faceR);
    ctx.stroke();
    ctx.fillStyle = WHEEL_GOLD.light;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(edge) * pegRadius, cy + Math.sin(edge) * pegRadius, pegR, 0, TWO_PI);
    ctx.fill();
  });
}

function paintWheelRim(ctx: Ctx, layout: WheelLayout): void {
  const { cx, cy, outerR, faceR } = layout;
  const rimGrad = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
  rimGrad.addColorStop(0, WHEEL_GOLD.light);
  rimGrad.addColorStop(HALF, WHEEL_GOLD.base);
  rimGrad.addColorStop(1, WHEEL_GOLD.dark);
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, TWO_PI);
  ctx.arc(cx, cy, faceR, 0, TWO_PI, true);
  ctx.fill('evenodd');

  ctx.lineWidth = WHEEL.rimEdgeWidth;
  ctx.strokeStyle = WHEEL_GOLD.deep;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, TWO_PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, TWO_PI);
  ctx.stroke();
}

function paintWheelHub(ctx: Ctx, cx: number, cy: number): void {
  const hubR = WHEEL.hubTiles * T;
  const hub = ctx.createRadialGradient(cx - hubR * HALF, cy - hubR * HALF, 0, cx, cy, hubR);
  hub.addColorStop(0, WHEEL_GOLD.glint);
  hub.addColorStop(HALF, WHEEL_GOLD.base);
  hub.addColorStop(1, WHEEL_GOLD.deep);
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WHEEL_POINTER.body;
  ctx.beginPath();
  ctx.arc(cx, cy, WHEEL.hubJewelTiles * T, 0, TWO_PI);
  ctx.fill();
}

/** The flapper the pegs strike, pointing down into the top of the rim. */
function paintWheelPointer(ctx: Ctx, cx: number, rimTop: number): void {
  const half = WHEEL.pointerHalfTiles * T;
  const baseY = rimTop - WHEEL.pointerRiseTiles * T;
  const tipY = rimTop + WHEEL.pointerDropTiles * T + WHEEL.rimTiles * T;
  const body = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  body.addColorStop(0, WHEEL_POINTER.light);
  body.addColorStop(HALF, WHEEL_POINTER.body);
  body.addColorStop(1, WHEEL_POINTER.dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - half, baseY);
  ctx.lineTo(cx + half, baseY);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WHEEL_GOLD.deep;
  ctx.lineWidth = WHEEL.rimEdgeWidth;
  ctx.stroke();

  const mountR = WHEEL.pointerMountTiles * T;
  ctx.fillStyle = WHEEL_GOLD.light;
  ctx.beginPath();
  ctx.arc(cx, baseY + mountR, mountR, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = WHEEL_GOLD.deep;
  ctx.stroke();
}

/** One chase phase of the wheel's rim bulbs, lit, on a transparent frame. */
export function drawFortuneWheelLights(ctx: Ctx, geo: ClubFrameGeometry, phase: number): void {
  const layout = wheelLayout(geo);
  for (let i = 0; i < WHEEL.bulbs; i++) {
    if (!bulbLit(i, phase)) continue;
    const { x, y } = bulbPosition(layout, i);
    paintLitBulb(ctx, x, y, WHEEL.bulbTiles * T);
  }
}

// ── Slot cabinets ───────────────────────────────────────────────────────────

type SlotEmblem = 'cherries' | 'seven' | 'gem';

interface SlotLivery {
  readonly emblem: SlotEmblem;
  readonly body: string;
  readonly bodyLight: string;
  readonly bodyDark: string;
  readonly marquee: string;
  readonly marqueeDark: string;
}

/** West to east along the bank: blue, then red in the middle, then green. */
const SLOT_LIVERIES: ReadonlyArray<SlotLivery> = [
  {
    emblem: 'seven',
    body: '#1e3ea8',
    bodyLight: '#4a78e8',
    bodyDark: '#0a1448',
    marquee: '#ff5a8a',
    marqueeDark: '#8a1440',
  },
  {
    emblem: 'cherries',
    body: '#a8141e',
    bodyLight: '#e04040',
    bodyDark: '#4a0408',
    marquee: '#ffcf3a',
    marqueeDark: '#b0700a',
  },
  {
    emblem: 'gem',
    body: '#0e7a46',
    bodyLight: '#2fc078',
    bodyDark: '#04341c',
    marquee: '#ff8a2a',
    marqueeDark: '#94380a',
  },
];

/** One cabinet per livery; the layout picks them in turn so the bank never repeats side by side. */
export const SLOT_CABINET_VARIANTS = SLOT_LIVERIES.length;

const SLOT = {
  bodyInsetTiles: 0.16,
  bodyTopTiles: 0.42,
  bodyBottomTiles: 1.8,
  bodyRadius: 5,
  marqueeCenterYTiles: 0.44,
  marqueeRxTiles: 0.36,
  marqueeRyTiles: 0.28,
  marqueeBulbs: 9,
  bulbTiles: 0.034,
  /** The bulbs ride just outside the marquee's painted panel. */
  bulbRingScale: 1.08,
  marqueePanelScale: 0.8,
  reelTopTiles: 0.54,
  reelBottomTiles: 0.88,
  reelInsetTiles: 0.25,
  reelCount: 3,
  reelGap: 1.5,
  bezel: 2.5,
  symbolTiles: 0.06,
  deckTopTiles: 0.92,
  deckBottomTiles: 1.04,
  buttonTiles: 0.07,
  buttonGapTiles: 0.1,
  buttonHeight: 2,
  bellyTopTiles: 1.08,
  bellyBottomTiles: 1.58,
  bellyInsetTiles: 0.24,
  trayTopTiles: 1.62,
  trayHeightTiles: 0.1,
  trayInsetTiles: 0.27,
  plinthTopTiles: 1.78,
  plinthBottomTiles: 1.94,
  plinthInsetTiles: 0.12,
  leverBaseYTiles: 0.82,
  leverTopYTiles: 0.5,
  leverXTiles: 0.92,
  leverBallTiles: 0.06,
  leverWidth: 2,
  shadowRxTiles: 0.42,
  shadowRyTiles: 0.1,
  stripeCount: 4,
  stripeWidth: 3,
  paylineWidth: 1,
} as const;

const SLOT_REEL_FACE = { top: '#7a7468', mid: '#fbf6ea', bottom: '#7a7468' } as const;
const SLOT_GLASS = { top: '#1a1020', bottom: '#050308' } as const;
const SLOT_BUTTONS = ['#e8323a', '#f4c430', '#38c060'] as const;
const SLOT_SEVEN = '#d81e28';
const SLOT_CHERRY = '#c4101c';
const SLOT_BAR = '#1a1a1a';
const SLOT_PAYLINE = 'rgba(255,60,60,0.75)';
const SLOT_STRIPE = 'rgba(255,255,255,0.12)';
const SLOT_LEVER_BALL = '#e02028';

interface Point {
  x: number;
  y: number;
}

function marqueeBulbPoint(geo: ClubFrameGeometry, index: number): Point {
  const cx = geo.w * HALF;
  const cy = SLOT.marqueeCenterYTiles * T;
  const angle = Math.PI + (index / (SLOT.marqueeBulbs - 1)) * Math.PI;
  return {
    x: cx + Math.cos(angle) * SLOT.marqueeRxTiles * T * SLOT.bulbRingScale,
    y: cy + Math.sin(angle) * SLOT.marqueeRyTiles * T * SLOT.bulbRingScale,
  };
}

/**
 * An upright slot cabinet: arched marquee topper, three-reel window, button
 * deck, belly glass, coin tray and the pull lever down its right side. The
 * marquee's bulbs are sockets here; the lit chase is `drawSlotCabinetLights`.
 */
export function drawSlotCabinet(ctx: Ctx, geo: ClubFrameGeometry, variant: number): void {
  const livery = SLOT_LIVERIES[variant % SLOT_LIVERIES.length];
  const cx = geo.w * HALF;
  const inset = SLOT.bodyInsetTiles * T;

  paintContactShadow(
    ctx,
    cx,
    SLOT.plinthBottomTiles * T,
    SLOT.shadowRxTiles * T,
    SLOT.shadowRyTiles * T,
  );

  const plinthInset = SLOT.plinthInsetTiles * T;
  verticalGradient(
    ctx,
    {
      x: plinthInset,
      y: SLOT.plinthTopTiles * T,
      w: geo.w - plinthInset * 2,
      h: (SLOT.plinthBottomTiles - SLOT.plinthTopTiles) * T,
    },
    [
      [0, CHROME.base],
      [1, CHROME.dark],
    ],
  );

  const body: Rect = {
    x: inset,
    y: SLOT.bodyTopTiles * T,
    w: geo.w - inset * 2,
    h: (SLOT.bodyBottomTiles - SLOT.bodyTopTiles) * T,
  };
  const bodyGrad = ctx.createLinearGradient(body.x, 0, body.x + body.w, 0);
  bodyGrad.addColorStop(0, livery.bodyLight);
  bodyGrad.addColorStop(HALF, livery.body);
  bodyGrad.addColorStop(1, livery.bodyDark);
  ctx.fillStyle = bodyGrad;
  roundRectPath(ctx, body, SLOT.bodyRadius);
  ctx.fill();
  ctx.strokeStyle = SHADOW_INK;
  ctx.lineWidth = 1;
  ctx.stroke();

  paintSlotLever(ctx, geo);
  paintSlotMarquee(ctx, geo, livery);
  paintSlotReels(ctx, geo);
  paintSlotDeck(ctx, geo);
  paintSlotBelly(ctx, geo, livery);

  const trayInset = SLOT.trayInsetTiles * T;
  verticalGradient(
    ctx,
    {
      x: trayInset,
      y: SLOT.trayTopTiles * T,
      w: geo.w - trayInset * 2,
      h: SLOT.trayHeightTiles * T,
    },
    [
      [0, CHROME.dark],
      [HALF, CHROME.light],
      [1, CHROME.base],
    ],
  );

  for (let i = 0; i < SLOT.marqueeBulbs; i++) {
    const { x, y } = marqueeBulbPoint(geo, i);
    paintBulbSocket(ctx, x, y, SLOT.bulbTiles * T);
  }
}

function paintSlotMarquee(ctx: Ctx, geo: ClubFrameGeometry, livery: SlotLivery): void {
  const cx = geo.w * HALF;
  const cy = SLOT.marqueeCenterYTiles * T;
  const rx = SLOT.marqueeRxTiles * T;
  const ry = SLOT.marqueeRyTiles * T;
  const grad = ctx.createLinearGradient(0, cy - ry, 0, cy);
  grad.addColorStop(0, livery.marquee);
  grad.addColorStop(1, livery.marqueeDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = BRASS_LIGHT;
  ctx.lineWidth = 1;
  ctx.stroke();

  const panelRx = rx * SLOT.marqueePanelScale;
  const panelRy = ry * SLOT.marqueePanelScale;
  ctx.fillStyle = livery.bodyDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, panelRx, panelRy, 0, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.fill();
  paintSlotEmblem(ctx, cx, cy - panelRy * HALF, livery.emblem);
}

const EMBLEM = {
  sizeTiles: 0.1,
  cherryOffset: 0.5,
  stemRise: 1.1,
  sevenStroke: 2.4,
} as const;

/** The symbol on each cabinet's topper. */
function paintSlotEmblem(ctx: Ctx, cx: number, cy: number, emblem: SlotEmblem): void {
  const s = EMBLEM.sizeTiles * T;
  if (emblem === 'cherries') {
    ctx.strokeStyle = WHEEL_TONE_INK.green.base;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - s * EMBLEM.cherryOffset, cy + s * EMBLEM.cherryOffset);
    ctx.lineTo(cx, cy - s * EMBLEM.stemRise);
    ctx.lineTo(cx + s * EMBLEM.cherryOffset, cy + s * EMBLEM.cherryOffset);
    ctx.stroke();
    ctx.fillStyle = SLOT_CHERRY;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        cx + side * s * EMBLEM.cherryOffset,
        cy + s * EMBLEM.cherryOffset,
        s * HALF,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    return;
  }
  if (emblem === 'seven') {
    ctx.strokeStyle = WHEEL_GOLD.light;
    ctx.lineWidth = EMBLEM.sevenStroke;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy - s);
    ctx.lineTo(cx - s * HALF, cy + s);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = WHEEL_TONE_INK.neutral.light;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.fill();
}

function paintSlotReels(ctx: Ctx, geo: ClubFrameGeometry): void {
  const inset = SLOT.reelInsetTiles * T;
  const window: Rect = {
    x: inset,
    y: SLOT.reelTopTiles * T,
    w: geo.w - inset * 2,
    h: (SLOT.reelBottomTiles - SLOT.reelTopTiles) * T,
  };
  ctx.fillStyle = CHROME.base;
  roundRectPath(
    ctx,
    {
      x: window.x - SLOT.bezel,
      y: window.y - SLOT.bezel,
      w: window.w + SLOT.bezel * 2,
      h: window.h + SLOT.bezel * 2,
    },
    SLOT.bezel,
  );
  ctx.fill();
  ctx.fillStyle = SLOT_GLASS.bottom;
  ctx.fillRect(window.x, window.y, window.w, window.h);

  const reelW = (window.w - SLOT.reelGap * (SLOT.reelCount + 1)) / SLOT.reelCount;
  const symbolR = SLOT.symbolTiles * T;
  for (let i = 0; i < SLOT.reelCount; i++) {
    const reel: Rect = {
      x: window.x + SLOT.reelGap + i * (reelW + SLOT.reelGap),
      y: window.y + SLOT.reelGap,
      w: reelW,
      h: window.h - SLOT.reelGap * 2,
    };
    verticalGradient(ctx, reel, [
      [0, SLOT_REEL_FACE.top],
      [HALF, SLOT_REEL_FACE.mid],
      [1, SLOT_REEL_FACE.bottom],
    ]);
    const sx = reel.x + reel.w * HALF;
    const sy = reel.y + reel.h * HALF;
    if (i === 1) {
      ctx.fillStyle = SLOT_BAR;
      ctx.fillRect(sx - symbolR, sy - symbolR * HALF, symbolR * 2, symbolR);
    } else {
      ctx.fillStyle = i === 0 ? SLOT_SEVEN : SLOT_CHERRY;
      ctx.beginPath();
      ctx.arc(sx, sy, symbolR, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.strokeStyle = SLOT_PAYLINE;
  ctx.lineWidth = SLOT.paylineWidth;
  ctx.beginPath();
  ctx.moveTo(window.x, window.y + window.h * HALF);
  ctx.lineTo(window.x + window.w, window.y + window.h * HALF);
  ctx.stroke();
  ctx.fillStyle = LACQUER_GLINT;
  ctx.fillRect(window.x, window.y, window.w, SLOT.reelGap);
}

function paintSlotDeck(ctx: Ctx, geo: ClubFrameGeometry): void {
  const inset = SLOT.bodyInsetTiles * T;
  const deck: Rect = {
    x: inset,
    y: SLOT.deckTopTiles * T,
    w: geo.w - inset * 2,
    h: (SLOT.deckBottomTiles - SLOT.deckTopTiles) * T,
  };
  verticalGradient(ctx, deck, [
    [0, CHROME.light],
    [1, CHROME.dark],
  ]);
  const buttonW = SLOT.buttonTiles * T;
  const gap = SLOT.buttonGapTiles * T;
  const rowW = SLOT_BUTTONS.length * buttonW + (SLOT_BUTTONS.length - 1) * (gap - buttonW);
  let x = geo.w * HALF - rowW * HALF;
  for (const color of SLOT_BUTTONS) {
    ctx.fillStyle = color;
    ctx.fillRect(x, deck.y + deck.h * HALF - SLOT.buttonHeight * HALF, buttonW, SLOT.buttonHeight);
    x += gap;
  }
}

function paintSlotBelly(ctx: Ctx, geo: ClubFrameGeometry, livery: SlotLivery): void {
  const inset = SLOT.bellyInsetTiles * T;
  const belly: Rect = {
    x: inset,
    y: SLOT.bellyTopTiles * T,
    w: geo.w - inset * 2,
    h: (SLOT.bellyBottomTiles - SLOT.bellyTopTiles) * T,
  };
  verticalGradient(ctx, belly, [
    [0, SLOT_GLASS.top],
    [1, SLOT_GLASS.bottom],
  ]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(belly.x, belly.y, belly.w, belly.h);
  ctx.clip();
  ctx.strokeStyle = livery.marquee;
  ctx.lineWidth = SLOT.stripeWidth;
  const stride = belly.h / SLOT.stripeCount;
  for (let i = 0; i <= SLOT.stripeCount * 2; i++) {
    const y = belly.y + i * stride;
    ctx.globalAlpha = HALF;
    ctx.beginPath();
    ctx.moveTo(belly.x, y);
    ctx.lineTo(belly.x + belly.w, y - belly.w);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = SLOT_STRIPE;
  ctx.lineWidth = 1;
  ctx.strokeRect(belly.x, belly.y, belly.w, belly.h);
}

function paintSlotLever(ctx: Ctx, geo: ClubFrameGeometry): void {
  const baseX = geo.w - SLOT.bodyInsetTiles * T;
  const topX = SLOT.leverXTiles * T;
  const baseY = SLOT.leverBaseYTiles * T;
  const topY = SLOT.leverTopYTiles * T;
  ctx.strokeStyle = CHROME.base;
  ctx.lineWidth = SLOT.leverWidth;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(topX, baseY);
  ctx.lineTo(topX, topY);
  ctx.stroke();
  const ballR = SLOT.leverBallTiles * T;
  const ball = ctx.createRadialGradient(
    topX - ballR * HALF,
    topY - ballR * HALF,
    0,
    topX,
    topY,
    ballR,
  );
  ball.addColorStop(0, WHEEL_POINTER.light);
  ball.addColorStop(1, SLOT_LEVER_BALL);
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(topX, topY, ballR, 0, TWO_PI);
  ctx.fill();
}

/** One chase phase of a cabinet's marquee bulbs, lit, on a transparent frame. */
export function drawSlotCabinetLights(ctx: Ctx, geo: ClubFrameGeometry, phase: number): void {
  for (let i = 0; i < SLOT.marqueeBulbs; i++) {
    if (!bulbLit(i, phase)) continue;
    const { x, y } = marqueeBulbPoint(geo, i);
    paintLitBulb(ctx, x, y, SLOT.bulbTiles * T);
  }
}

// ── Tito's counter ───────────────────────────────────────────────────────────

const CROUPIER_COUNTER_SEED: VariantSeed = { base: 15000, stride: 31 };

const COUNTER = {
  surfaceRiseTiles: 0.26,
  surfaceTiles: 0.38,
  frontInsetTiles: 0.06,
  frontBottomInsetTiles: 0.07,
  panelInsetTiles: 0.12,
  panelRadius: 3,
  medallionTiles: 0.2,
  medallionWedges: 10,
  grainStrokes: 40,
  rimLight: 3,
  lipShadow: 3,
  railTiles: 0.08,
  railFromBottom: 0.2,
  shadowRxScale: 0.5,
  shadowRyTiles: 0.14,
  chipStackTiles: 0.07,
  chipThickness: 2,
  chipStackXFrom: 0.2,
  chipStackXStep: 0.16,
  chipStackHeights: [5, 3, 4],
  bellXFraction: 0.76,
  bellTiles: 0.08,
  bellBaseTiles: 0.1,
  surfaceItemYScale: 0.62,
} as const;

const COUNTER_PANEL = { top: '#7a0c18', bottom: '#3a040a' } as const;
const CHIP_TONES = ['#c8323c', '#2f5ec8', '#d8b432'] as const;
const CHIP_EDGE = 'rgba(255,255,255,0.55)';

/**
 * Tito's counter: a narrow mahogany croupier's stand, its lacquered red front set with
 * a little gilt wheel medallion, chips stacked on the top and the brass bell
 * he rings to call a spin.
 */
export function drawCroupierCounter(
  ctx: Ctx,
  geo: ClubFrameGeometry,
  variant: number,
  seedTerm: number,
): void {
  const rng = variantRng(CROUPIER_COUNTER_SEED, variant, seedTerm);
  const wood = MAHOGANY;
  const surfaceTop = geo.footTop - COUNTER.surfaceRiseTiles * T;
  const surfaceH = COUNTER.surfaceTiles * T;
  const frontTop = surfaceTop + surfaceH;

  paintContactShadow(
    ctx,
    geo.w * HALF,
    geo.footBottom - COUNTER.frontBottomInsetTiles * T,
    geo.w * COUNTER.shadowRxScale,
    COUNTER.shadowRyTiles * T,
  );

  const frontInset = COUNTER.frontInsetTiles * T;
  const front: Rect = {
    x: frontInset,
    y: frontTop,
    w: geo.w - frontInset * 2,
    h: geo.footBottom - frontTop - COUNTER.frontBottomInsetTiles * T,
  };
  verticalGradient(ctx, front, [
    [0, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, front, rng, COUNTER.grainStrokes);

  const panelInset = COUNTER.panelInsetTiles * T;
  const panel: Rect = {
    x: front.x + panelInset,
    y: front.y + panelInset * HALF,
    w: front.w - panelInset * 2,
    h: front.h - panelInset * 2,
  };
  verticalGradient(ctx, panel, [
    [0, COUNTER_PANEL.top],
    [1, COUNTER_PANEL.bottom],
  ]);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1;
  roundRectPath(ctx, panel, COUNTER.panelRadius);
  ctx.stroke();
  paintWheelMedallion(ctx, geo.w * HALF, panel.y + panel.h * HALF, COUNTER.medallionTiles * T);

  const rail: Rect = {
    x: front.x,
    y: front.y + front.h - COUNTER.railFromBottom * T,
    w: front.w,
    h: COUNTER.railTiles * T,
  };
  verticalGradient(ctx, rail, [
    [0, BRASS_LIGHT],
    [HALF, BRASS],
    [1, BRASS_DARK],
  ]);

  const surface: Rect = { x: 0, y: surfaceTop, w: geo.w, h: surfaceH };
  verticalGradient(ctx, surface, [
    [0, wood.top],
    [HALF, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, surface, rng, COUNTER.grainStrokes);
  paintRimLight(ctx, surface, RIM_LIGHT_INK, COUNTER.rimLight);
  ctx.fillStyle = SOFT_SHADOW_INK;
  ctx.fillRect(surface.x, surface.y + surface.h - COUNTER.lipShadow, surface.w, COUNTER.lipShadow);

  const itemY = surface.y + surface.h * COUNTER.surfaceItemYScale;
  COUNTER.chipStackHeights.forEach((height, i) => {
    const x = (COUNTER.chipStackXFrom + COUNTER.chipStackXStep * i) * geo.w;
    paintChipStack(ctx, x, itemY, height, CHIP_TONES[i % CHIP_TONES.length]);
  });
  paintServiceBell(ctx, geo.w * COUNTER.bellXFraction, itemY);
}

/** A gilt roundel of wedges in the wheel's own colours, so the stand reads as the wheel's. */
function paintWheelMedallion(ctx: Ctx, cx: number, cy: number, r: number): void {
  const tones = [
    WHEEL_TONE_INK.red,
    WHEEL_TONE_INK.gold,
    WHEEL_TONE_INK.red,
    WHEEL_TONE_INK.green,
    WHEEL_TONE_INK.red,
    WHEEL_TONE_INK.purple,
  ];
  for (let i = 0; i < COUNTER.medallionWedges; i++) {
    const from = (i / COUNTER.medallionWedges) * TWO_PI;
    const to = ((i + 1) / COUNTER.medallionWedges) * TWO_PI;
    ctx.fillStyle = tones[i % tones.length].base;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, from, to);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = WHEEL_GOLD.light;
  ctx.lineWidth = WHEEL.rimEdgeWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = WHEEL_GOLD.base;
  ctx.beginPath();
  ctx.arc(cx, cy, r * WHEEL.hubShadeStop, 0, TWO_PI);
  ctx.fill();
}

function paintChipStack(ctx: Ctx, cx: number, baseY: number, count: number, color: string): void {
  const r = COUNTER.chipStackTiles * T;
  for (let i = 0; i < count; i++) {
    const y = baseY - i * COUNTER.chipThickness;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, y, r, r * HALF, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = CHIP_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function paintServiceBell(ctx: Ctx, cx: number, baseY: number): void {
  const r = COUNTER.bellTiles * T;
  const baseR = COUNTER.bellBaseTiles * T;
  ctx.fillStyle = WALNUT.dark;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, baseR, baseR * HALF, 0, 0, TWO_PI);
  ctx.fill();
  const dome = ctx.createRadialGradient(cx - r * HALF, baseY - r, 0, cx, baseY - r * HALF, r);
  dome.addColorStop(0, BRASS_LIGHT);
  dome.addColorStop(1, BRASS_DARK);
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(cx, baseY - COUNTER.chipThickness, r, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.fill();
}
