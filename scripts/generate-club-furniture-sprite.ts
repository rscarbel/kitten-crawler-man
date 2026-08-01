#!/usr/bin/env tsx
/**
 * Generates the Desperado Club furniture sprite sheets from procedural drawing
 * code — the bar, the market stalls, the casino table, the Meat Shields rack and
 * the VIP barrier.
 *
 * Every family is one PNG whose row 0 holds each *variant* as a frame, so a
 * layout can pick a different-looking counter or stool per slot from one sheet
 * and the club stops reading as five copies of the same prop.
 *
 * Frames are drawn at a 64px logical tile and downscaled by the runtime, which
 * is what buys the wood grain, bottle glass and felt shading enough resolution
 * to survive at the game's 32px tiles.
 *
 * Geometry convention shared by every family: the frame's bottom tile row is the
 * prop's *footprint* (the tiles it stands on and blocks), and everything above
 * that row is height the prop rises into the tiles behind it. `tileY` therefore
 * equals the headroom, so a caller draws at the footprint's top-left tile and
 * the art lands correctly without knowing how tall the piece is.
 *
 * Run: npx tsx scripts/generate-club-furniture-sprite.ts
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const TILE_SCALE = 64;
const TWO_PI = Math.PI * 2;

/** Height, in logical tiles, that most counter-height pieces rise above their footprint. */
const COUNTER_HEADROOM_TILES = 1;
/** A stool is barely taller than its own tile, so it needs only half the usual headroom. */
const STOOL_HEADROOM_TILES = 0.5;

// ── Deterministic noise ─────────────────────────────────────────────────────
// Sheets are committed to the repo, so the drawing has to be reproducible: a
// rebuild that shuffled every wood grain would show up as a spurious diff.

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ── Shared painting helpers ─────────────────────────────────────────────────

const SHADOW_COLOR = 'rgba(0,0,0,0.34)';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function verticalGradient(
  ctx: NodeCtx,
  rect: Rect,
  stops: ReadonlyArray<readonly [number, string]>,
): void {
  const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/** Streaky grain over a wood panel — the single biggest "this is a real plank" cue. */
function paintWoodGrain(ctx: NodeCtx, rect: Rect, rng: () => number, strokeCount: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.lineWidth = 1;
  for (let i = 0; i < strokeCount; i++) {
    const y = rect.y + rng() * rect.h;
    const length = rect.w * (0.25 + rng() * 0.6);
    const x = rect.x + rng() * (rect.w - length);
    const dark = rng() > 0.45;
    ctx.strokeStyle = dark ? 'rgba(30,16,6,0.28)' : 'rgba(255,215,160,0.14)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + length * 0.3,
      y - 1.5 + rng() * 3,
      x + length * 0.7,
      y - 1.5 + rng() * 3,
      x + length,
      y,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Soft contact shadow pooled under a piece so it sits on the floor instead of floating. */
function paintContactShadow(ctx: NodeCtx, cx: number, baseY: number, rx: number, ry: number): void {
  const grad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, rx);
  grad.addColorStop(0, SHADOW_COLOR);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function paintRimLight(ctx: NodeCtx, rect: Rect, color: string, thickness: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, thickness);
}

/** Rounded-rectangle path, used for every panel, drawer and cushion in the set. */
function roundRectPath(ctx: NodeCtx, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.w - r, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h - r);
  ctx.quadraticCurveTo(
    rect.x + rect.w,
    rect.y + rect.h,
    rect.x + rect.w - r,
    rect.y + rect.h,
  );
  ctx.lineTo(rect.x + r, rect.y + rect.h);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
}

// ── Palettes ────────────────────────────────────────────────────────────────

interface WoodTone {
  dark: string;
  base: string;
  light: string;
  /** A polished top surface catches far more light than the carcass under it. */
  top: string;
}

const MAHOGANY: WoodTone = { dark: '#2b1408', base: '#4d2612', light: '#7a4322', top: '#8a5a30' };
const OAK: WoodTone = { dark: '#33200c', base: '#5b3a18', light: '#8d6030', top: '#9c6b3a' };
const WALNUT: WoodTone = { dark: '#241608', base: '#3f2a14', light: '#69482a', top: '#7b4d2a' };

const WOODS: ReadonlyArray<WoodTone> = [MAHOGANY, OAK, WALNUT];

const BRASS_DARK = '#8a6a1e';
const BRASS = '#c9a13a';
const BRASS_LIGHT = '#f0d98a';

const BOTTLE_GLASS = [
  '#3aa8c8',
  '#c8455f',
  '#5fbf46',
  '#d9a832',
  '#9a4fd0',
  '#d2703a',
  '#2f7fc4',
  '#b8d24a',
] as const;

// ── Family geometry ─────────────────────────────────────────────────────────

type FamilyId =
  | 'bar_counter'
  | 'bar_stool'
  | 'drink_shelf'
  | 'market_stall'
  | 'market_backdrop'
  | 'weapon_rack'
  | 'merc_desk'
  | 'casino_table'
  | 'vip_counter'
  | 'velvet_rope';

interface Family {
  id: FamilyId;
  /** Footprint width in logical tiles. */
  widthTiles: number;
  /** Tiles of art above the footprint row. */
  headroomTiles: number;
  variants: number;
  draw: (ctx: NodeCtx, geo: FrameGeometry, variant: number) => void;
}

interface FrameGeometry {
  /** Frame width in pixels. */
  w: number;
  /** Frame height in pixels. */
  h: number;
  /** Y of the footprint row's top edge — the prop's visual "back" line. */
  footTop: number;
  /** Y of the footprint row's bottom edge — where the prop meets the floor. */
  footBottom: number;
}

// ── The Bar — counters, stools, back-bar shelving ───────────────────────────

/**
 * A bar top seen from the game's shallow three-quarter angle: a lacquered slab
 * whose back edge is the highest line, a panelled front the player faces, and a
 * brass foot rail at floor level.
 */
function drawBarCounter(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(1000 + variant * 17);
  const wood = WOODS[variant % WOODS.length];

  const topSurfaceH = TILE_SCALE * 0.42;
  const surfaceTop = geo.footTop - TILE_SCALE * 0.28;
  const frontTop = surfaceTop + topSurfaceH;
  const frontH = geo.footBottom - frontTop - TILE_SCALE * 0.08;

  paintContactShadow(
    ctx,
    geo.w / 2,
    geo.footBottom - TILE_SCALE * 0.06,
    geo.w * 0.52,
    TILE_SCALE * 0.16,
  );

  // Panelled front — the face the player walks up to.
  const front: Rect = { x: TILE_SCALE * 0.06, y: frontTop, w: geo.w - TILE_SCALE * 0.12, h: frontH };
  verticalGradient(ctx, front, [
    [0, wood.light],
    [0.35, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, front, rng, 46);

  // Recessed panels break the front into bays rather than one flat plank.
  const bays = 3;
  const bayGap = TILE_SCALE * 0.16;
  const bayW = (front.w - bayGap * (bays + 1)) / bays;
  for (let i = 0; i < bays; i++) {
    const bay: Rect = {
      x: front.x + bayGap + i * (bayW + bayGap),
      y: front.y + frontH * 0.18,
      w: bayW,
      h: frontH * 0.5,
    };
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRectPath(ctx, bay, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,150,0.12)';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, { ...bay, y: bay.y + 1.5 }, 4);
    ctx.stroke();
  }

  // Brass foot rail across the bottom.
  const railY = front.y + frontH * 0.78;
  verticalGradient(
    ctx,
    { x: front.x, y: railY, w: front.w, h: TILE_SCALE * 0.1 },
    [
      [0, BRASS_LIGHT],
      [0.5, BRASS],
      [1, BRASS_DARK],
    ],
  );

  // Lacquered top slab, lightest at the back lip where the room light catches it.
  const surface: Rect = { x: 0, y: surfaceTop, w: geo.w, h: topSurfaceH };
  verticalGradient(ctx, surface, [
    [0, wood.top],
    [0.55, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, surface, rng, 60);
  paintRimLight(ctx, surface, 'rgba(255,232,190,0.45)', 3);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(surface.x, surface.y + surface.h - 3, surface.w, 3);

  // Wet-look highlight streak along the polished top.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(
    geo.w * 0.34,
    surface.y + surface.h * 0.42,
    geo.w * 0.22,
    surface.h * 0.16,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

  drawCounterService(ctx, geo, surface, variant, rng);
}

/** Glassware and a spill mat on the bar top — different per variant so three counters read as three. */
function drawCounterService(
  ctx: NodeCtx,
  geo: FrameGeometry,
  surface: Rect,
  variant: number,
  rng: () => number,
): void {
  const restY = surface.y + surface.h * 0.35;

  if (variant % 3 === 0) {
    // Two poured pints and a bar towel.
    for (const [i, fx] of [0.2, 0.32].entries()) {
      drawPintGlass(ctx, geo.w * fx, restY, TILE_SCALE * 0.2, i === 0 ? '#c98a2a' : '#8f4d18');
    }
    ctx.fillStyle = 'rgba(230,226,210,0.85)';
    roundRectPath(
      ctx,
      { x: geo.w * 0.68, y: restY - TILE_SCALE * 0.02, w: TILE_SCALE * 0.34, h: TILE_SCALE * 0.12 },
      3,
    );
    ctx.fill();
  } else if (variant % 3 === 1) {
    // Cocktail service: a shaker and two coupes.
    drawShaker(ctx, geo.w * 0.72, restY, TILE_SCALE * 0.26);
    drawCoupeGlass(ctx, geo.w * 0.22, restY, TILE_SCALE * 0.18, '#d8567a');
    drawCoupeGlass(ctx, geo.w * 0.33, restY, TILE_SCALE * 0.18, '#4fb3c8');
  } else {
    // A tapped keg tray and a lone tumbler.
    const trayRect: Rect = {
      x: geo.w * 0.14,
      y: restY,
      w: TILE_SCALE * 0.7,
      h: TILE_SCALE * 0.14,
    };
    verticalGradient(ctx, trayRect, [
      [0, '#8d8f96'],
      [1, '#4a4c52'],
    ]);
    drawPintGlass(ctx, geo.w * 0.74, restY, TILE_SCALE * 0.19, '#d8b445');
  }

  // A few scattered coins catch the light on every variant.
  for (let i = 0; i < 3; i++) {
    const cx = geo.w * (0.45 + rng() * 0.2);
    const cy = surface.y + surface.h * (0.55 + rng() * 0.25);
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE_SCALE * 0.045, TILE_SCALE * 0.024, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BRASS_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, TILE_SCALE * 0.03, TILE_SCALE * 0.014, 0, 0, TWO_PI);
    ctx.fill();
  }
}

function drawPintGlass(ctx: NodeCtx, cx: number, baseY: number, h: number, brew: string): void {
  const w = h * 0.62;
  const top = baseY - h;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY, w * 0.6, h * 0.09, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = brew;
  ctx.fillRect(cx - w / 2, top + h * 0.22, w, h * 0.78);
  ctx.fillStyle = 'rgba(255,250,235,0.92)';
  ctx.beginPath();
  ctx.ellipse(cx, top + h * 0.22, w * 0.5, h * 0.12, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(cx - w * 0.36, top + h * 0.3, w * 0.14, h * 0.6);
  ctx.strokeStyle = 'rgba(220,240,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2, top + h * 0.18, w, h * 0.82);
}

function drawCoupeGlass(ctx: NodeCtx, cx: number, baseY: number, h: number, liquid: string): void {
  const bowlR = h * 0.42;
  const bowlY = baseY - h * 0.72;
  ctx.strokeStyle = 'rgba(230,244,255,0.75)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, bowlY);
  ctx.lineTo(cx, baseY - 1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - bowlR * 0.7, baseY);
  ctx.lineTo(cx + bowlR * 0.7, baseY);
  ctx.stroke();
  ctx.fillStyle = liquid;
  ctx.beginPath();
  ctx.ellipse(cx, bowlY, bowlR, bowlR * 0.55, 0, Math.PI, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, bowlY, bowlR, bowlR * 0.55, 0, 0, Math.PI);
  ctx.strokeStyle = 'rgba(235,248,255,0.85)';
  ctx.stroke();
}

function drawShaker(ctx: NodeCtx, cx: number, baseY: number, h: number): void {
  const w = h * 0.5;
  verticalGradient(ctx, { x: cx - w / 2, y: baseY - h, w, h }, [
    [0, '#e2e6ee'],
    [0.45, '#9aa2b0'],
    [1, '#5d636e'],
  ]);
  ctx.fillStyle = '#c8ced8';
  ctx.fillRect(cx - w * 0.6, baseY - h - h * 0.14, w * 1.2, h * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(cx - w * 0.3, baseY - h * 0.9, w * 0.16, h * 0.75);
}

/**
 * The back-bar: a mirrored shelving unit stacked with bottles. Rises a full tile
 * over the wall behind it, which is what makes the alcove read as a real bar.
 */
function drawDrinkShelf(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(2000 + variant * 29);
  const wood = WOODS[(variant + 1) % WOODS.length];

  const unit: Rect = {
    x: TILE_SCALE * 0.08,
    y: TILE_SCALE * 0.06,
    w: geo.w - TILE_SCALE * 0.16,
    h: geo.footBottom - TILE_SCALE * 0.1,
  };

  // Carcass.
  verticalGradient(ctx, unit, [
    [0, wood.light],
    [0.4, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, unit, rng, 50);

  // Mirrored back panel, inset — the bottles read against it.
  const backPanel: Rect = {
    x: unit.x + TILE_SCALE * 0.14,
    y: unit.y + TILE_SCALE * 0.12,
    w: unit.w - TILE_SCALE * 0.28,
    h: unit.h - TILE_SCALE * 0.3,
  };
  verticalGradient(ctx, backPanel, [
    [0, '#2c3038'],
    [0.5, '#1b1e24'],
    [1, '#101216'],
  ]);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#9fd4ff';
  ctx.beginPath();
  ctx.moveTo(backPanel.x, backPanel.y + backPanel.h);
  ctx.lineTo(backPanel.x + backPanel.w * 0.55, backPanel.y);
  ctx.lineTo(backPanel.x + backPanel.w * 0.78, backPanel.y);
  ctx.lineTo(backPanel.x + backPanel.w * 0.22, backPanel.y + backPanel.h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Three loaded shelves. The variant shifts bottle heights and colours so the
  // three sheets don't line up when placed side by side.
  const shelfCount = 3;
  const shelfSpacing = backPanel.h / shelfCount;
  for (let s = 0; s < shelfCount; s++) {
    const shelfY = backPanel.y + shelfSpacing * (s + 1) - TILE_SCALE * 0.04;
    const bottleCount = 7 + ((variant + s) % 3);
    const step = backPanel.w / bottleCount;
    for (let i = 0; i < bottleCount; i++) {
      const bx = backPanel.x + step * (i + 0.5);
      const bh = shelfSpacing * (0.5 + rng() * 0.32);
      const color = BOTTLE_GLASS[(i * 3 + s * 2 + variant) % BOTTLE_GLASS.length];
      drawBottle(ctx, bx, shelfY, bh, step * 0.44, color);
    }
    // Shelf plank the bottles stand on, drawn after so it overlaps their bases.
    const plank: Rect = {
      x: backPanel.x - TILE_SCALE * 0.06,
      y: shelfY,
      w: backPanel.w + TILE_SCALE * 0.12,
      h: TILE_SCALE * 0.09,
    };
    verticalGradient(ctx, plank, [
      [0, wood.top],
      [1, wood.dark],
    ]);
    paintRimLight(ctx, plank, 'rgba(255,228,180,0.35)', 1.5);
  }

  // Frame edges last so the carcass reads as a box around the shelves.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(unit.x, unit.y, unit.w, unit.h);
  paintRimLight(ctx, unit, 'rgba(255,226,180,0.4)', 2.5);
}

function drawBottle(
  ctx: NodeCtx,
  cx: number,
  baseY: number,
  h: number,
  maxW: number,
  color: string,
): void {
  const bodyW = Math.min(maxW, h * 0.34);
  const neckW = bodyW * 0.34;
  const shoulderY = baseY - h * 0.62;
  const topY = baseY - h;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, baseY);
  ctx.lineTo(cx - bodyW / 2, shoulderY);
  ctx.quadraticCurveTo(cx - neckW / 2, shoulderY, cx - neckW / 2, shoulderY - h * 0.12);
  ctx.lineTo(cx - neckW / 2, topY);
  ctx.lineTo(cx + neckW / 2, topY);
  ctx.lineTo(cx + neckW / 2, shoulderY - h * 0.12);
  ctx.quadraticCurveTo(cx + neckW / 2, shoulderY, cx + bodyW / 2, shoulderY);
  ctx.lineTo(cx + bodyW / 2, baseY);
  ctx.closePath();
  ctx.fill();

  // Glass highlight and a paper label.
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillRect(cx - bodyW * 0.34, shoulderY + h * 0.04, bodyW * 0.16, h * 0.5);
  ctx.fillStyle = 'rgba(240,232,208,0.9)';
  ctx.fillRect(cx - bodyW * 0.42, baseY - h * 0.4, bodyW * 0.84, h * 0.18);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cx - neckW / 2, topY, neckW, h * 0.07);
}

/** A padded bar stool: turned wooden legs, brass ring, leather seat. */
function drawBarStool(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(3000 + variant * 41);
  const wood = WOODS[variant % WOODS.length];
  const seatColors = ['#7a2230', '#2c4a63', '#3f5a2c'] as const;

  const cx = geo.w / 2;
  const seatY = geo.footTop + TILE_SCALE * 0.04;
  const seatRx = TILE_SCALE * 0.3;
  const seatRy = TILE_SCALE * 0.15;
  const baseY = geo.footBottom - TILE_SCALE * 0.06;

  paintContactShadow(ctx, cx, baseY, seatRx * 1.15, TILE_SCALE * 0.1);

  // Splayed legs.
  ctx.strokeStyle = wood.base;
  ctx.lineWidth = TILE_SCALE * 0.075;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * seatRx * 0.55, seatY + seatRy * 0.4);
    ctx.lineTo(cx + dir * seatRx * 0.85, baseY);
    ctx.stroke();
  }
  ctx.strokeStyle = wood.dark;
  ctx.lineWidth = TILE_SCALE * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx, seatY + seatRy * 0.5);
  ctx.lineTo(cx, baseY - TILE_SCALE * 0.02);
  ctx.stroke();

  // Brass foot ring.
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = TILE_SCALE * 0.045;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - TILE_SCALE * 0.2, seatRx * 0.68, seatRy * 0.42, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = BRASS_LIGHT;
  ctx.lineWidth = TILE_SCALE * 0.016;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - TILE_SCALE * 0.22, seatRx * 0.68, seatRy * 0.42, 0, Math.PI, TWO_PI);
  ctx.stroke();

  // Seat: leather cushion with a piped edge and a button tuft.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, seatY + seatRy * 0.5, seatRx, seatRy, 0, 0, TWO_PI);
  ctx.fill();
  const cushionGrad = ctx.createRadialGradient(
    cx - seatRx * 0.3,
    seatY - seatRy * 0.4,
    seatRx * 0.1,
    cx,
    seatY,
    seatRx,
  );
  cushionGrad.addColorStop(0, '#c9707c');
  cushionGrad.addColorStop(0.35, seatColors[variant % seatColors.length]);
  cushionGrad.addColorStop(1, '#1d0d12');
  ctx.fillStyle = cushionGrad;
  ctx.beginPath();
  ctx.ellipse(cx, seatY, seatRx, seatRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = BRASS_DARK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, seatY, TILE_SCALE * 0.022, TILE_SCALE * 0.014, 0, 0, TWO_PI);
  ctx.fill();

  // A scatter of brass tacks around the rim.
  const tacks = 8;
  for (let i = 0; i < tacks; i++) {
    const a = (i / tacks) * TWO_PI + rng() * 0.1;
    ctx.fillStyle = BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(a) * seatRx * 0.82,
      seatY + Math.sin(a) * seatRy * 0.82,
      TILE_SCALE * 0.014,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

// ── The Market — stalls and back racks ──────────────────────────────────────

const AWNING_STRIPES = [
  ['#b3405e', '#f2e6d2'],
  ['#3a6ea8', '#f2e6d2'],
  ['#2f7d54', '#f0e2c4'],
] as const;

/** A market stall front: plank counter heaped with produce and hung with a price slate. */
function drawMarketStall(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(4000 + variant * 53);
  const wood = WOODS[(variant + 2) % WOODS.length];

  const surfaceTop = geo.footTop - TILE_SCALE * 0.22;
  const surfaceH = TILE_SCALE * 0.34;
  const frontTop = surfaceTop + surfaceH;

  paintContactShadow(
    ctx,
    geo.w / 2,
    geo.footBottom - TILE_SCALE * 0.05,
    geo.w * 0.5,
    TILE_SCALE * 0.14,
  );

  // Trestle front made of visibly separate planks.
  const front: Rect = {
    x: TILE_SCALE * 0.08,
    y: frontTop,
    w: geo.w - TILE_SCALE * 0.16,
    h: geo.footBottom - frontTop - TILE_SCALE * 0.06,
  };
  verticalGradient(ctx, front, [
    [0, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, front, rng, 40);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  const plankCount = 6;
  for (let i = 1; i < plankCount; i++) {
    const px = front.x + (front.w / plankCount) * i;
    ctx.beginPath();
    ctx.moveTo(px, front.y);
    ctx.lineTo(px, front.y + front.h);
    ctx.stroke();
  }

  // Cloth valance pinned along the counter lip.
  const cloth = AWNING_STRIPES[variant % AWNING_STRIPES.length];
  const valanceH = TILE_SCALE * 0.2;
  const scallops = 8;
  ctx.fillStyle = cloth[0];
  ctx.beginPath();
  ctx.moveTo(front.x, frontTop);
  for (let i = 0; i < scallops; i++) {
    const x0 = front.x + (front.w / scallops) * i;
    const x1 = front.x + (front.w / scallops) * (i + 1);
    ctx.quadraticCurveTo((x0 + x1) / 2, frontTop + valanceH * 1.6, x1, frontTop);
  }
  ctx.lineTo(front.x + front.w, frontTop - 2);
  ctx.lineTo(front.x, frontTop - 2);
  ctx.closePath();
  ctx.fill();

  // Counter surface.
  const surface: Rect = { x: 0, y: surfaceTop, w: geo.w, h: surfaceH };
  verticalGradient(ctx, surface, [
    [0, wood.top],
    [0.6, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, surface, rng, 44);
  paintRimLight(ctx, surface, 'rgba(255,230,190,0.4)', 2.5);

  drawStallGoods(ctx, geo, surface, variant, rng);
}

/** Produce, sacks and wares heaped on a stall counter — the per-variant character. */
function drawStallGoods(
  ctx: NodeCtx,
  geo: FrameGeometry,
  surface: Rect,
  variant: number,
  rng: () => number,
): void {
  const restY = surface.y + surface.h * 0.42;

  // A woven basket of fruit at one end.
  const basketX = variant % 2 === 0 ? geo.w * 0.18 : geo.w * 0.8;
  drawBasket(ctx, basketX, restY, TILE_SCALE * 0.46, rng);

  // A stack of sacks at the other.
  const sackX = variant % 2 === 0 ? geo.w * 0.8 : geo.w * 0.18;
  for (let i = 0; i < 2; i++) {
    const sy = restY - i * TILE_SCALE * 0.16;
    const grad = ctx.createLinearGradient(sackX - 12, sy - 14, sackX + 12, sy);
    grad.addColorStop(0, '#c9b585');
    grad.addColorStop(1, '#7d6c46');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(sackX, sy - TILE_SCALE * 0.08, TILE_SCALE * 0.2, TILE_SCALE * 0.12, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,48,26,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Centre display: bottles of tincture, or a rack of blades, or coiled rope.
  const centreX = geo.w * 0.5;
  if (variant % 3 === 0) {
    for (const dx of [-0.06, 0, 0.06]) {
      drawBottle(
        ctx,
        centreX + geo.w * dx,
        restY,
        TILE_SCALE * 0.4,
        TILE_SCALE * 0.16,
        BOTTLE_GLASS[(variant + Math.round(dx * 100)) % BOTTLE_GLASS.length],
      );
    }
  } else if (variant % 3 === 1) {
    for (const dx of [-0.05, 0.02]) {
      const bx = centreX + geo.w * dx;
      ctx.strokeStyle = '#c4ccd8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx, restY);
      ctx.lineTo(bx + 4, restY - TILE_SCALE * 0.42);
      ctx.stroke();
      ctx.strokeStyle = '#4a3218';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx, restY);
      ctx.lineTo(bx + 1, restY - TILE_SCALE * 0.1);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = '#a08a58';
    ctx.lineWidth = TILE_SCALE * 0.05;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.ellipse(
        centreX,
        restY - TILE_SCALE * 0.03,
        TILE_SCALE * (0.1 + r * 0.05),
        TILE_SCALE * (0.05 + r * 0.024),
        0,
        0,
        TWO_PI,
      );
      ctx.stroke();
    }
  }
}

function drawBasket(ctx: NodeCtx, cx: number, baseY: number, w: number, rng: () => number): void {
  const h = w * 0.52;
  const top = baseY - h;
  ctx.fillStyle = '#8a6a34';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx + w / 2, top);
  ctx.lineTo(cx + w * 0.38, baseY);
  ctx.lineTo(cx - w * 0.38, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(50,34,12,0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = top + (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(cx - w * (0.5 - i * 0.03), y);
    ctx.lineTo(cx + w * (0.5 - i * 0.03), y);
    ctx.stroke();
  }
  // Heaped fruit spilling over the rim.
  const fruitColors = ['#c8402c', '#d9922c', '#4f9a34', '#8e3fa8'] as const;
  for (let i = 0; i < 7; i++) {
    const fx = cx - w * 0.4 + rng() * w * 0.8;
    const fy = top - rng() * h * 0.22;
    const r = w * (0.1 + rng() * 0.04);
    ctx.fillStyle = fruitColors[i % fruitColors.length];
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(fx - r * 0.3, fy - r * 0.35, r * 0.28, 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * The stall's back wall: corner posts carrying a striped awning, a hanging rail
 * of stock beneath it, and a bank of crates at the base. Everything hangs off
 * the two posts, so the piece reads as one structure rather than a floating
 * awning above unrelated boxes.
 */
function drawMarketBackdrop(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(5000 + variant * 67);
  const [stripeA, stripeB] = AWNING_STRIPES[variant % AWNING_STRIPES.length];
  const wood = WOODS[(variant + 1) % WOODS.length];

  const postW = TILE_SCALE * 0.15;
  const postXs = [TILE_SCALE * 0.08, geo.w - TILE_SCALE * 0.08 - postW];
  const postTop = TILE_SCALE * 0.3;
  const postBottom = geo.footBottom - TILE_SCALE * 0.06;

  paintContactShadow(
    ctx,
    geo.w / 2,
    postBottom,
    geo.w * 0.48,
    TILE_SCALE * 0.12,
  );

  // Backboard panelling between the posts — the wall the stock hangs against.
  const board: Rect = {
    x: postXs[0],
    y: postTop,
    w: postXs[1] + postW - postXs[0],
    h: postBottom - postTop,
  };
  verticalGradient(ctx, board, [
    [0, '#4b3a24'],
    [0.5, '#332615'],
    [1, '#1d140a'],
  ]);
  paintWoodGrain(ctx, board, rng, 40);

  // Hanging rail with bundled herbs and cured stock.
  const railY = postTop + TILE_SCALE * 0.2;
  verticalGradient(
    ctx,
    { x: board.x, y: railY, w: board.w, h: TILE_SCALE * 0.06 },
    [
      [0, '#8b8f98'],
      [1, '#3d4046'],
    ],
  );
  const hangCount = 7;
  for (let i = 0; i < hangCount; i++) {
    const hx = board.x + (board.w / hangCount) * (i + 0.5);
    const len = TILE_SCALE * (0.26 + rng() * 0.18);
    const bundle = ['#6f8a32', '#8d3f2a', '#9c7a28'][(i + variant) % 3];
    ctx.strokeStyle = '#c9b98c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, railY);
    ctx.lineTo(hx, railY + TILE_SCALE * 0.06);
    ctx.stroke();
    ctx.fillStyle = bundle;
    ctx.beginPath();
    ctx.moveTo(hx, railY + TILE_SCALE * 0.05);
    ctx.quadraticCurveTo(hx - TILE_SCALE * 0.09, railY + len * 0.6, hx, railY + len);
    ctx.quadraticCurveTo(hx + TILE_SCALE * 0.09, railY + len * 0.6, hx, railY + TILE_SCALE * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Crates stacked along the base, tucked between the posts.
  const crateRow = postBottom;
  const crateCount = 4;
  const crateSpan = board.w - TILE_SCALE * 0.1;
  const crateW = crateSpan / crateCount;
  for (let i = 0; i < crateCount; i++) {
    const ch = TILE_SCALE * (0.5 + ((i + variant) % 2) * 0.14);
    const crate: Rect = {
      x: board.x + TILE_SCALE * 0.05 + crateW * i,
      y: crateRow - ch,
      w: crateW - 3,
      h: ch,
    };
    verticalGradient(ctx, crate, [
      [0, '#8a6234'],
      [1, '#43290f'],
    ]);
    paintWoodGrain(ctx, crate, rng, 14);
    ctx.strokeStyle = 'rgba(46,28,8,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(crate.x, crate.y);
    ctx.lineTo(crate.x + crate.w, crate.y + crate.h);
    ctx.moveTo(crate.x + crate.w, crate.y);
    ctx.lineTo(crate.x, crate.y + crate.h);
    ctx.stroke();
    ctx.strokeStyle = '#2e1c08';
    ctx.lineWidth = 2;
    ctx.strokeRect(crate.x, crate.y, crate.w, crate.h);
    paintRimLight(ctx, crate, 'rgba(255,220,170,0.22)', 2);
  }

  // Posts last, so they overlap the boards and crates they carry.
  for (const px of postXs) {
    const post: Rect = { x: px, y: postTop, w: postW, h: postBottom - postTop };
    verticalGradient(ctx, post, [
      [0, wood.light],
      [0.5, wood.base],
      [1, wood.dark],
    ]);
    paintWoodGrain(ctx, post, rng, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(post.x, post.y, post.w, post.h);
  }

  // Striped awning across the top, scalloped along its lower edge and pitched
  // so its front lip overhangs the posts.
  const awningTop = TILE_SCALE * 0.02;
  const awningH = TILE_SCALE * 0.3;
  const stripes = 9;
  const stripeW = geo.w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? stripeA : stripeB;
    ctx.beginPath();
    ctx.moveTo(stripeW * i, awningTop);
    ctx.lineTo(stripeW * (i + 1), awningTop);
    ctx.lineTo(stripeW * (i + 1), awningTop + awningH);
    ctx.quadraticCurveTo(
      stripeW * (i + 0.5),
      awningTop + awningH + TILE_SCALE * 0.12,
      stripeW * i,
      awningTop + awningH,
    );
    ctx.closePath();
    ctx.fill();
  }
  // Shading under the awning's fold, plus the sunlit crest.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, awningTop + awningH * 0.7, geo.w, awningH * 0.3);
  paintRimLight(ctx, { x: 0, y: awningTop, w: geo.w, h: awningH }, 'rgba(255,255,255,0.3)', 3);
  // The awning's own shadow cast down onto the backboard.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(board.x, awningTop + awningH + TILE_SCALE * 0.1, board.w, TILE_SCALE * 0.07);
}

// ── Meat Shields — the weapon rack and the contract desk ────────────────────

const STEEL_EDGE = '#dfe5ee';
const STEEL_BODY = '#9aa3b0';
const STEEL_DEEP = '#4c535e';
const LEATHER = '#5a3a1e';

/**
 * A free-standing arms rack: an ironbound timber frame with blades, hafts and a
 * shield slung across it. Reads as a wall of steel rather than three stick
 * figures of weapons.
 */
function drawWeaponRack(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(6000 + variant * 71);
  const wood = WOODS[(variant + 1) % WOODS.length];

  paintContactShadow(
    ctx,
    geo.w / 2,
    geo.footBottom - TILE_SCALE * 0.06,
    geo.w * 0.48,
    TILE_SCALE * 0.13,
  );

  const frameTop = TILE_SCALE * 0.12;
  const frameBottom = geo.footBottom - TILE_SCALE * 0.1;
  const postW = TILE_SCALE * 0.16;

  // Weapons first so the frame's cross-beams overlap them.
  const slots = 6;
  for (let i = 0; i < slots; i++) {
    const sx = (geo.w / slots) * (i + 0.5);
    const kind = (i + variant * 2) % 4;
    drawRackedWeapon(ctx, sx, frameBottom, frameTop, kind, rng);
  }

  // Uprights.
  for (const px of [TILE_SCALE * 0.1, geo.w - TILE_SCALE * 0.1 - postW]) {
    const post: Rect = { x: px, y: frameTop, w: postW, h: frameBottom - frameTop };
    verticalGradient(ctx, post, [
      [0, wood.light],
      [0.5, wood.base],
      [1, wood.dark],
    ]);
    paintWoodGrain(ctx, post, rng, 16);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(post.x, post.y, post.w, post.h);
  }

  // Cross-beams with iron straps.
  for (const [beamY, beamH] of [
    [frameTop, TILE_SCALE * 0.16],
    [frameBottom - TILE_SCALE * 0.22, TILE_SCALE * 0.18],
  ] as const) {
    const beam: Rect = { x: TILE_SCALE * 0.1, y: beamY, w: geo.w - TILE_SCALE * 0.2, h: beamH };
    verticalGradient(ctx, beam, [
      [0, wood.light],
      [1, wood.dark],
    ]);
    paintWoodGrain(ctx, beam, rng, 20);
    for (let i = 0; i < 4; i++) {
      const strapX = beam.x + (beam.w / 4) * (i + 0.5) - TILE_SCALE * 0.03;
      verticalGradient(
        ctx,
        { x: strapX, y: beam.y - 1, w: TILE_SCALE * 0.06, h: beam.h + 2 },
        [
          [0, '#6d747f'],
          [1, '#31363d'],
        ],
      );
    }
    paintRimLight(ctx, beam, 'rgba(255,226,180,0.3)', 2);
  }

  // A battered round shield hung off-centre, different side per variant.
  const shieldX = variant % 2 === 0 ? geo.w * 0.24 : geo.w * 0.76;
  drawShield(ctx, shieldX, frameTop + TILE_SCALE * 0.5, TILE_SCALE * 0.34, variant);
}

function drawRackedWeapon(
  ctx: NodeCtx,
  cx: number,
  baseY: number,
  topY: number,
  kind: number,
  rng: () => number,
): void {
  const lean = (rng() - 0.5) * TILE_SCALE * 0.08;
  const tipY = topY + TILE_SCALE * 0.1;

  if (kind === 0) {
    // Broadsword, point down, hilt up.
    ctx.strokeStyle = LEATHER;
    ctx.lineWidth = TILE_SCALE * 0.06;
    ctx.beginPath();
    ctx.moveTo(cx + lean, tipY);
    ctx.lineTo(cx + lean, tipY + TILE_SCALE * 0.22);
    ctx.stroke();
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = TILE_SCALE * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx + lean - TILE_SCALE * 0.14, tipY + TILE_SCALE * 0.24);
    ctx.lineTo(cx + lean + TILE_SCALE * 0.14, tipY + TILE_SCALE * 0.24);
    ctx.stroke();
    const bladeGrad = ctx.createLinearGradient(cx + lean - 4, 0, cx + lean + 4, 0);
    bladeGrad.addColorStop(0, STEEL_DEEP);
    bladeGrad.addColorStop(0.45, STEEL_EDGE);
    bladeGrad.addColorStop(1, STEEL_BODY);
    ctx.fillStyle = bladeGrad;
    ctx.beginPath();
    ctx.moveTo(cx + lean - TILE_SCALE * 0.055, tipY + TILE_SCALE * 0.26);
    ctx.lineTo(cx + lean + TILE_SCALE * 0.055, tipY + TILE_SCALE * 0.26);
    ctx.lineTo(cx, baseY);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (kind === 1) {
    // Bearded axe on a long haft.
    ctx.strokeStyle = '#4a3218';
    ctx.lineWidth = TILE_SCALE * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + lean, tipY);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
    // Bit: a crescent that springs from the haft and sweeps out to a bearded edge.
    const hafX = cx + lean;
    const bitTop = tipY + TILE_SCALE * 0.04;
    const bitBottom = tipY + TILE_SCALE * 0.42;
    ctx.beginPath();
    ctx.moveTo(hafX, bitTop);
    ctx.quadraticCurveTo(
      hafX + TILE_SCALE * 0.34,
      tipY + TILE_SCALE * 0.14,
      hafX + TILE_SCALE * 0.26,
      bitBottom,
    );
    ctx.quadraticCurveTo(
      hafX + TILE_SCALE * 0.12,
      tipY + TILE_SCALE * 0.3,
      hafX,
      bitBottom - TILE_SCALE * 0.06,
    );
    ctx.closePath();
    const bitGrad = ctx.createLinearGradient(hafX, 0, hafX + TILE_SCALE * 0.34, 0);
    bitGrad.addColorStop(0, STEEL_DEEP);
    bitGrad.addColorStop(0.55, STEEL_BODY);
    bitGrad.addColorStop(1, STEEL_EDGE);
    ctx.fillStyle = bitGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,24,30,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    return;
  }

  if (kind === 2) {
    // Spear.
    ctx.strokeStyle = '#5a4426';
    ctx.lineWidth = TILE_SCALE * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx + lean, tipY + TILE_SCALE * 0.16);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
    ctx.fillStyle = STEEL_EDGE;
    ctx.beginPath();
    ctx.moveTo(cx + lean, tipY - TILE_SCALE * 0.04);
    ctx.lineTo(cx + lean - TILE_SCALE * 0.07, tipY + TILE_SCALE * 0.2);
    ctx.lineTo(cx + lean + TILE_SCALE * 0.07, tipY + TILE_SCALE * 0.2);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Mace with a flanged head.
  ctx.strokeStyle = LEATHER;
  ctx.lineWidth = TILE_SCALE * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx + lean, tipY + TILE_SCALE * 0.3);
  ctx.lineTo(cx, baseY);
  ctx.stroke();
  ctx.fillStyle = STEEL_DEEP;
  ctx.beginPath();
  ctx.arc(cx + lean, tipY + TILE_SCALE * 0.22, TILE_SCALE * 0.11, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = STEEL_BODY;
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(cx + lean, tipY + TILE_SCALE * 0.22);
    ctx.lineTo(
      cx + lean + Math.cos(a) * TILE_SCALE * 0.16,
      tipY + TILE_SCALE * 0.22 + Math.sin(a) * TILE_SCALE * 0.16,
    );
    ctx.lineTo(
      cx + lean + Math.cos(a + 0.5) * TILE_SCALE * 0.09,
      tipY + TILE_SCALE * 0.22 + Math.sin(a + 0.5) * TILE_SCALE * 0.09,
    );
    ctx.closePath();
    ctx.fill();
  }
}

function drawShield(ctx: NodeCtx, cx: number, cy: number, r: number, variant: number): void {
  const faceColors = ['#7a2a2a', '#26456e', '#2f5c38'] as const;
  ctx.fillStyle = '#2a2016';
  ctx.beginPath();
  ctx.arc(cx, cy + 2, r, 0, TWO_PI);
  ctx.fill();
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#c88a6a');
  grad.addColorStop(0.4, faceColors[variant % faceColors.length]);
  grad.addColorStop(1, '#1a0e0a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = STEEL_BODY;
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = STEEL_EDGE;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.24, 0, TWO_PI);
  ctx.fill();
  // Notches hacked out of the rim — these are hired swords, not parade gear.
  ctx.strokeStyle = 'rgba(20,14,10,0.8)';
  ctx.lineWidth = 2;
  for (const a of [0.6, 2.4, 4.1]) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
    ctx.stroke();
  }
}

/** Rosemarie's desk: a heavy contract table with ledgers, an inkwell and a strongbox. */
function drawMercDesk(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(7000 + variant * 83);
  const wood = WOODS[(variant + 2) % WOODS.length];

  const surfaceTop = geo.footTop - TILE_SCALE * 0.24;
  const surfaceH = TILE_SCALE * 0.36;
  const frontTop = surfaceTop + surfaceH;

  paintContactShadow(
    ctx,
    geo.w / 2,
    geo.footBottom - TILE_SCALE * 0.05,
    geo.w * 0.5,
    TILE_SCALE * 0.14,
  );

  const front: Rect = {
    x: TILE_SCALE * 0.06,
    y: frontTop,
    w: geo.w - TILE_SCALE * 0.12,
    h: geo.footBottom - frontTop - TILE_SCALE * 0.06,
  };
  verticalGradient(ctx, front, [
    [0, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, front, rng, 36);

  // Drawer bank with brass pulls.
  const drawers = 3;
  const dw = front.w / drawers;
  for (let i = 0; i < drawers; i++) {
    const drawer: Rect = {
      x: front.x + dw * i + 3,
      y: front.y + front.h * 0.16,
      w: dw - 6,
      h: front.h * 0.52,
    };
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    roundRectPath(ctx, drawer, 3);
    ctx.fill();
    ctx.fillStyle = BRASS;
    ctx.fillRect(
      drawer.x + drawer.w / 2 - TILE_SCALE * 0.08,
      drawer.y + drawer.h * 0.55,
      TILE_SCALE * 0.16,
      TILE_SCALE * 0.04,
    );
  }

  const surface: Rect = { x: 0, y: surfaceTop, w: geo.w, h: surfaceH };
  verticalGradient(ctx, surface, [
    [0, wood.top],
    [0.6, wood.base],
    [1, wood.dark],
  ]);
  paintWoodGrain(ctx, surface, rng, 40);
  paintRimLight(ctx, surface, 'rgba(255,230,190,0.42)', 2.5);

  // Green leather blotter, ledger, inkwell, strongbox.
  const restY = surface.y + surface.h * 0.4;
  ctx.fillStyle = '#22432f';
  roundRectPath(
    ctx,
    { x: geo.w * 0.34, y: restY - TILE_SCALE * 0.1, w: geo.w * 0.3, h: TILE_SCALE * 0.2 },
    3,
  );
  ctx.fill();
  ctx.fillStyle = '#e8dfc4';
  ctx.fillRect(geo.w * 0.38, restY - TILE_SCALE * 0.08, geo.w * 0.18, TILE_SCALE * 0.14);
  ctx.strokeStyle = 'rgba(60,50,30,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const ly = restY - TILE_SCALE * 0.06 + i * 3;
    ctx.beginPath();
    ctx.moveTo(geo.w * 0.39, ly);
    ctx.lineTo(geo.w * 0.54, ly);
    ctx.stroke();
  }
  ctx.fillStyle = '#171a20';
  ctx.beginPath();
  ctx.ellipse(geo.w * 0.66, restY, TILE_SCALE * 0.07, TILE_SCALE * 0.05, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = '#e8e2cc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(geo.w * 0.66, restY - TILE_SCALE * 0.02);
  ctx.lineTo(geo.w * 0.7, restY - TILE_SCALE * 0.3);
  ctx.stroke();

  const boxX = variant % 2 === 0 ? geo.w * 0.12 : geo.w * 0.84;
  const box: Rect = {
    x: boxX - TILE_SCALE * 0.16,
    y: restY - TILE_SCALE * 0.24,
    w: TILE_SCALE * 0.32,
    h: TILE_SCALE * 0.24,
  };
  verticalGradient(ctx, box, [
    [0, '#6a5330'],
    [1, '#2c2114'],
  ]);
  ctx.strokeStyle = BRASS_DARK;
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = BRASS;
  ctx.fillRect(box.x + box.w / 2 - 3, box.y + box.h * 0.4, 6, box.h * 0.35);
}

// ── The Casino — the high-low table ─────────────────────────────────────────

const FELT_TONES = ['#1a6b3e', '#6b1a2c'] as const;

/** An oval baize table with a padded leather rail, chip wells and a dealt hand. */
function drawCasinoTable(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(8000 + variant * 97);
  const felt = FELT_TONES[variant % FELT_TONES.length];

  const cx = geo.w / 2;
  const cy = geo.footTop + TILE_SCALE * 0.1;
  const rx = geo.w * 0.46;
  const ry = TILE_SCALE * 0.52;
  const skirtBottom = geo.footBottom - TILE_SCALE * 0.08;

  paintContactShadow(ctx, cx, skirtBottom, rx * 1.05, TILE_SCALE * 0.16);

  // Skirt: the table's visible side, from the rail's front edge down to the floor.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  ctx.lineTo(cx - rx, skirtBottom - ry * 0.5);
  ctx.quadraticCurveTo(cx, skirtBottom + ry * 0.5, cx + rx, skirtBottom - ry * 0.5);
  ctx.lineTo(cx + rx, cy);
  ctx.closePath();
  const skirtGrad = ctx.createLinearGradient(0, cy, 0, skirtBottom);
  skirtGrad.addColorStop(0, '#4a2c16');
  skirtGrad.addColorStop(1, '#180d05');
  ctx.fillStyle = skirtGrad;
  ctx.fill();
  ctx.restore();

  // Padded leather rail.
  const railGrad = ctx.createRadialGradient(cx, cy - ry * 0.4, ry * 0.2, cx, cy, rx);
  railGrad.addColorStop(0, '#7a4a26');
  railGrad.addColorStop(0.7, '#4a2a12');
  railGrad.addColorStop(1, '#22120a');
  ctx.fillStyle = railGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();

  // Baize inset.
  const feltRx = rx * 0.85;
  const feltRy = ry * 0.72;
  const feltGrad = ctx.createRadialGradient(
    cx - feltRx * 0.2,
    cy - feltRy * 0.4,
    feltRy * 0.2,
    cx,
    cy,
    feltRx,
  );
  feltGrad.addColorStop(0, felt);
  feltGrad.addColorStop(1, '#08301c');
  ctx.fillStyle = feltGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRx, feltRy, 0, 0, TWO_PI);
  ctx.fill();

  // Gold betting line and the house legend.
  ctx.strokeStyle = 'rgba(224,196,110,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRx * 0.72, feltRy * 0.62, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRx * 0.46, feltRy * 0.4, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // Brass tacks around the rail.
  const tacks = 26;
  for (let i = 0; i < tacks; i++) {
    const a = (i / tacks) * TWO_PI;
    ctx.fillStyle = BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(a) * rx * 0.93,
      cy + Math.sin(a) * ry * 0.93,
      TILE_SCALE * 0.018,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  // A dealt hand and chip stacks on the felt.
  drawPlayingCard(ctx, cx - TILE_SCALE * 0.3, cy - TILE_SCALE * 0.04, -0.16, '#c02424');
  drawPlayingCard(ctx, cx - TILE_SCALE * 0.05, cy - TILE_SCALE * 0.02, 0.1, '#161616');
  for (let s = 0; s < 3; s++) {
    const stackX = cx + TILE_SCALE * (0.42 + s * 0.24);
    const height = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < height; j++) {
      const chipY = cy + TILE_SCALE * 0.1 - j * TILE_SCALE * 0.05;
      ctx.fillStyle = ['#c8323c', '#2f5ec8', '#d8b432'][s];
      ctx.beginPath();
      ctx.ellipse(stackX, chipY, TILE_SCALE * 0.1, TILE_SCALE * 0.045, 0, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(stackX, chipY, TILE_SCALE * 0.1, TILE_SCALE * 0.045, 0, Math.PI, TWO_PI);
      ctx.stroke();
    }
  }

  // Light catches the back lip of the rail — traced along the ellipse so it
  // follows the curve instead of cutting a straight bar above the table.
  ctx.strokeStyle = 'rgba(255,226,170,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.97, ry * 0.97, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

function drawPlayingCard(
  ctx: NodeCtx,
  x: number,
  y: number,
  angle: number,
  pipColor: string,
): void {
  const w = TILE_SCALE * 0.26;
  const h = TILE_SCALE * 0.36;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(ctx, { x: -w / 2 + 1.5, y: -h / 2 + 2, w, h }, 3);
  ctx.fill();
  ctx.fillStyle = '#f6f0e0';
  roundRectPath(ctx, { x: -w / 2, y: -h / 2, w, h }, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,110,90,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = pipColor;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.2, 0, TWO_PI);
  ctx.fill();
  ctx.fillRect(-w * 0.36, -h * 0.42, w * 0.14, h * 0.16);
  ctx.restore();
}

// ── VIP Lounge — the podium counter and the velvet rope ─────────────────────

const VELVET = '#6d1730';
const VELVET_LIGHT = '#a22a4c';

/** The lounge's reception counter: dark lacquer, a velvet fascia and a gold rail. */
function drawVipCounter(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const rng = makeRng(9000 + variant * 101);

  const surfaceTop = geo.footTop - TILE_SCALE * 0.3;
  const surfaceH = TILE_SCALE * 0.4;
  const frontTop = surfaceTop + surfaceH;

  paintContactShadow(
    ctx,
    geo.w / 2,
    geo.footBottom - TILE_SCALE * 0.05,
    geo.w * 0.5,
    TILE_SCALE * 0.15,
  );

  const front: Rect = {
    x: TILE_SCALE * 0.04,
    y: frontTop,
    w: geo.w - TILE_SCALE * 0.08,
    h: geo.footBottom - frontTop - TILE_SCALE * 0.05,
  };
  verticalGradient(ctx, front, [
    [0, VELVET_LIGHT],
    [0.4, VELVET],
    [1, '#2a0812'],
  ]);

  // Buttoned velvet quilting.
  const cols = variant === 0 ? 10 : 8;
  const rows = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = 1.2;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const px = front.x + (front.w / cols) * c;
      const py = front.y + (front.h * 0.72 * r) / rows + front.h * 0.12;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + front.w / cols / 2, py + (front.h * 0.72) / rows / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - front.w / cols / 2, py + (front.h * 0.72) / rows / 2);
      ctx.stroke();
      ctx.fillStyle = BRASS;
      ctx.beginPath();
      ctx.arc(px, py, TILE_SCALE * 0.02, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Gold kick rail.
  verticalGradient(
    ctx,
    { x: front.x, y: front.y + front.h * 0.86, w: front.w, h: TILE_SCALE * 0.08 },
    [
      [0, BRASS_LIGHT],
      [1, BRASS_DARK],
    ],
  );

  // Black-lacquer top with a gold inlay stripe.
  const surface: Rect = { x: 0, y: surfaceTop, w: geo.w, h: surfaceH };
  verticalGradient(ctx, surface, [
    [0, '#3a3038'],
    [0.45, '#1a1418'],
    [1, '#0b080c'],
  ]);
  ctx.fillStyle = BRASS;
  ctx.fillRect(surface.x, surface.y + surface.h * 0.62, surface.w, 2);
  paintRimLight(ctx, surface, 'rgba(240,216,150,0.55)', 3);
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(
    geo.w * 0.3,
    surface.y + surface.h * 0.42,
    geo.w * 0.2,
    surface.h * 0.18,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

  // A guest book, a bell and a candelabra on the top.
  const restY = surface.y + surface.h * 0.42;
  ctx.fillStyle = '#e6dcc0';
  roundRectPath(
    ctx,
    { x: geo.w * 0.42, y: restY - TILE_SCALE * 0.08, w: TILE_SCALE * 0.4, h: TILE_SCALE * 0.14 },
    2,
  );
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.arc(geo.w * 0.62, restY - TILE_SCALE * 0.03, TILE_SCALE * 0.07, Math.PI, TWO_PI);
  ctx.fill();
  ctx.fillRect(geo.w * 0.62 - TILE_SCALE * 0.08, restY - TILE_SCALE * 0.03, TILE_SCALE * 0.16, 3);

  const candX = variant % 2 === 0 ? geo.w * 0.16 : geo.w * 0.86;
  drawCandelabra(ctx, candX, restY, rng);
}

function drawCandelabra(ctx: NodeCtx, cx: number, baseY: number, rng: () => number): void {
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = TILE_SCALE * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, baseY - TILE_SCALE * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - TILE_SCALE * 0.14, baseY - TILE_SCALE * 0.26);
  ctx.quadraticCurveTo(cx, baseY - TILE_SCALE * 0.38, cx + TILE_SCALE * 0.14, baseY - TILE_SCALE * 0.26);
  ctx.stroke();
  for (const dx of [-0.14, 0, 0.14]) {
    const wx = cx + TILE_SCALE * dx;
    const wy = baseY - TILE_SCALE * (dx === 0 ? 0.3 : 0.26);
    ctx.fillStyle = '#efe6cc';
    ctx.fillRect(wx - TILE_SCALE * 0.022, wy - TILE_SCALE * 0.14, TILE_SCALE * 0.044, TILE_SCALE * 0.14);
    const flameH = TILE_SCALE * (0.08 + rng() * 0.02);
    const flame = ctx.createRadialGradient(wx, wy - TILE_SCALE * 0.17, 0, wx, wy - TILE_SCALE * 0.17, flameH);
    flame.addColorStop(0, '#fff3c0');
    flame.addColorStop(0.5, '#f0a020');
    flame.addColorStop(1, 'rgba(240,120,20,0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(wx, wy - TILE_SCALE * 0.17, flameH, 0, TWO_PI);
    ctx.fill();
  }
}

/** Two gold stanchions joined by a swagged velvet rope — the lounge's barrier. */
function drawVelvetRope(ctx: NodeCtx, geo: FrameGeometry, variant: number): void {
  const postXs = [TILE_SCALE * 0.5, geo.w - TILE_SCALE * 0.5];
  const baseY = geo.footBottom - TILE_SCALE * 0.12;
  const postTop = geo.footTop - TILE_SCALE * 0.34;

  for (const px of postXs) {
    paintContactShadow(ctx, px, baseY, TILE_SCALE * 0.3, TILE_SCALE * 0.1);
  }

  // Swagged rope, drawn behind the posts so the finials sit in front of it.
  const ropeY = postTop + TILE_SCALE * 0.1;
  const sag = variant === 0 ? TILE_SCALE * 0.34 : TILE_SCALE * 0.22;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3d0c1c';
  ctx.lineWidth = TILE_SCALE * 0.13;
  ctx.beginPath();
  ctx.moveTo(postXs[0], ropeY);
  ctx.quadraticCurveTo(geo.w / 2, ropeY + sag * 2, postXs[1], ropeY);
  ctx.stroke();
  ctx.strokeStyle = VELVET;
  ctx.lineWidth = TILE_SCALE * 0.1;
  ctx.beginPath();
  ctx.moveTo(postXs[0], ropeY);
  ctx.quadraticCurveTo(geo.w / 2, ropeY + sag * 2, postXs[1], ropeY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,120,160,0.4)';
  ctx.lineWidth = TILE_SCALE * 0.03;
  ctx.beginPath();
  ctx.moveTo(postXs[0], ropeY - 2);
  ctx.quadraticCurveTo(geo.w / 2, ropeY + sag * 2 - 3, postXs[1], ropeY - 2);
  ctx.stroke();

  for (const px of postXs) {
    // Weighted base.
    const baseGrad = ctx.createLinearGradient(px - TILE_SCALE * 0.2, 0, px + TILE_SCALE * 0.2, 0);
    baseGrad.addColorStop(0, BRASS_DARK);
    baseGrad.addColorStop(0.45, BRASS_LIGHT);
    baseGrad.addColorStop(1, BRASS_DARK);
    ctx.fillStyle = baseGrad;
    ctx.beginPath();
    ctx.ellipse(px, baseY, TILE_SCALE * 0.2, TILE_SCALE * 0.08, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillRect(px - TILE_SCALE * 0.2, baseY - TILE_SCALE * 0.05, TILE_SCALE * 0.4, TILE_SCALE * 0.05);

    // Column.
    const colGrad = ctx.createLinearGradient(px - TILE_SCALE * 0.06, 0, px + TILE_SCALE * 0.06, 0);
    colGrad.addColorStop(0, BRASS_DARK);
    colGrad.addColorStop(0.4, BRASS_LIGHT);
    colGrad.addColorStop(1, BRASS_DARK);
    ctx.fillStyle = colGrad;
    ctx.fillRect(px - TILE_SCALE * 0.055, postTop, TILE_SCALE * 0.11, baseY - postTop);

    // Ball finial and rope eye.
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    ctx.arc(px, postTop, TILE_SCALE * 0.1, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(px - TILE_SCALE * 0.03, postTop - TILE_SCALE * 0.03, TILE_SCALE * 0.04, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Sheet assembly ──────────────────────────────────────────────────────────

const FAMILIES: ReadonlyArray<Family> = [
  {
    id: 'bar_counter',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawBarCounter,
  },
  {
    id: 'bar_stool',
    widthTiles: 1,
    headroomTiles: STOOL_HEADROOM_TILES,
    variants: 3,
    draw: drawBarStool,
  },
  {
    id: 'drink_shelf',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawDrinkShelf,
  },
  {
    id: 'market_stall',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawMarketStall,
  },
  {
    id: 'market_backdrop',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawMarketBackdrop,
  },
  {
    id: 'weapon_rack',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawWeaponRack,
  },
  {
    id: 'merc_desk',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawMercDesk,
  },
  {
    id: 'casino_table',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawCasinoTable,
  },
  {
    id: 'vip_counter',
    widthTiles: 6,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawVipCounter,
  },
  {
    id: 'velvet_rope',
    widthTiles: 2,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawVelvetRope,
  },
];

function geometryFor(family: Family): FrameGeometry {
  const w = family.widthTiles * TILE_SCALE;
  const headroom = family.headroomTiles * TILE_SCALE;
  return { w, h: headroom + TILE_SCALE, footTop: headroom, footBottom: headroom + TILE_SCALE };
}

function renderSheet(family: Family): Buffer {
  const geo = geometryFor(family);
  const canvas = createCanvas(geo.w * family.variants, geo.h);
  const ctx = canvas.getContext('2d');

  for (let variant = 0; variant < family.variants; variant++) {
    ctx.save();
    ctx.translate(geo.w * variant, 0);
    ctx.beginPath();
    ctx.rect(0, 0, geo.w, geo.h);
    ctx.clip();
    family.draw(ctx, geo, variant);
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

const outDir = resolve('src/images/environment/club');

console.log(`Generating Desperado Club furniture (tileScale=${TILE_SCALE})…`);

const manifest: Record<string, unknown> = {};
for (const family of FAMILIES) {
  const geo = geometryFor(family);
  writeFileSync(resolve(outDir, `${family.id}.png`), renderSheet(family));
  manifest[`club_${family.id}`] = {
    path: `environment/club/${family.id}.png`,
    frameWidth: geo.w,
    frameHeight: geo.h,
    tileX: 0,
    tileY: geo.footTop,
    tileScale: TILE_SCALE,
    states: { idle: { row: 0, frameCount: family.variants } },
  };
  console.log(
    `  ${family.id}.png — ${geo.w}×${geo.h}px frames × ${family.variants} variants, tileY=${geo.footTop}`,
  );
}

writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nDone. Sheets + manifest written to ${outDir}`);
