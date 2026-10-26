/**
 * The Sequin Tailcoat on the cat crawler: a ringmaster's red coat crusted
 * with sequins, buttoned in gold down her chest, cut away over her belly in
 * profile, with two pointed tails hanging below her rump. The tails are what
 * part it from any other coat of hers: in profile both hang behind her hind
 * leg, from behind one hangs from each haunch either side of her tail.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { clipToOutline, fabricFill, strokeCurve, type FabricRamp } from './clothInk';
import { GOLD, paintGlint, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const RINGMASTER_RED: FabricRamp = {
  shadow: '#5e0612',
  base: '#d0202c',
  light: '#ff6a5c',
  edge: '#2a0206',
};
/** The sequins catch the light white-pink against the red. */
const SEQUIN: MetalRamp = {
  shadow: '#8a1020',
  base: '#ff9a8c',
  light: '#ffd6cc',
  glint: '#ffffff',
};
const SEQUIN_PITCH = 0.07;
const SEQUIN_REACH = 0.028;
/** One grid point in this many carries a sequin catching the light; the rest stay red. */
const SEQUIN_EVERY = 5;
/** Large odd multipliers and a fold that scatter the lit sequins. */
const SEQUIN_HASH_ROW = 0x9e3779b1;
const SEQUIN_HASH_COLUMN = 0x85ebca6b;
const SEQUIN_HASH_SHIFT = 13;

const TRIM_WIDTH = 0.022;
const BUTTON_RADIUS = 0.02;
const FULL_TURN = Math.PI * 2;
/** Room past a piece's ellipse every clip gives, as a share of its radii. */
const CLIP_SPREAD = 2;

/**
 * The tails hang from her haunch's middle to points below it: each this
 * share of the haunch's half-width across at its top, its point this far
 * below the haunch and this share of its half-width back from its middle.
 */
const TAIL_HALF_WIDTH = 0.38;
const TAIL_HANG = 0.17;
const TAIL_POINT_LEAN = 0.3;
/** The tails' sides bow out a little as they fall. */
const TAIL_BOW = 0.15;
/** In profile both tails show at the back of her haunch, the far one a little forward of the near one. */
const PROFILE_TAILS = [-0.05, -0.5] as const;
/** From behind each haunch carries one tail, this share of its half-width toward her midline. */
const BACK_TAIL_INWARD = 0.3;
/** From behind a tail hangs from this share of the haunch's half-height above its middle, under the coat's back. */
const BACK_TAIL_ROOT = 0.7;
/** Head-on the coat's front ends this share of her barrel's half-height below its middle, clear of her paws. */
const FRONT_HEM = 0.35;
/**
 * In profile the coat is cut away over her belly: its front hem leaves her
 * chest this share of the barrel's half-height below its middle and sweeps
 * back and down to her haunch, this share of the half-length behind the middle.
 */
const PROFILE_CUT_FRONT = 0.15;
const PROFILE_CUT_BACK = -0.45;

/** Head-on: how many gold buttons run down her chest ruff, over what share of its half-height. */
const FRONT_BUTTONS = 3;
const FRONT_BUTTON_SPAN = 0.5;
/** Head-on the lapels fall from her collar to this share of the ruff's half-height below its middle. */
const LAPEL_DEPTH = 0.3;
const LAPEL_SPREAD = 0.55;
/** In profile the two buttons sit this share of the chest's half-width behind its front. */
const PROFILE_BUTTON_IN = 0.3;
const PROFILE_BUTTON_HEIGHTS = [-0.15, 0.3] as const;

/** A small integer hash, so the lit sequins scatter across the grid with no rows or diagonals. */
function sequinAt(row: number, column: number): boolean {
  const mixed = Math.imul(row, SEQUIN_HASH_ROW) ^ Math.imul(column, SEQUIN_HASH_COLUMN);
  const spread = (mixed ^ (mixed >>> SEQUIN_HASH_SHIFT)) >>> 0;
  return spread % SEQUIN_EVERY === 0;
}

/** Red over everything inside the current clip, then its sequins. */
function fillCoat(ctx: Ctx, area: CatEllipse): void {
  ctx.fillStyle = fabricFill(
    ctx,
    RINGMASTER_RED,
    { x: area.cx - area.rx, y: area.cy - area.ry },
    { x: area.cx + area.rx, y: area.cy + area.ry },
  );
  ctx.fillRect(
    area.cx - area.rx * CLIP_SPREAD,
    area.cy - area.ry * CLIP_SPREAD,
    area.rx * CLIP_SPREAD * 2,
    area.ry * CLIP_SPREAD * 2,
  );
  const rows = Math.ceil((area.ry * 2) / SEQUIN_PITCH);
  const columns = Math.ceil((area.rx * 2) / SEQUIN_PITCH);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      if (!sequinAt(row, column)) continue;
      paintGlint(
        ctx,
        SEQUIN,
        area.cx - area.rx + column * SEQUIN_PITCH,
        area.cy - area.ry + row * SEQUIN_PITCH,
        SEQUIN_REACH,
      );
    }
  }
}

function coverWhole(ctx: Ctx, frame: CatBodyFrame): void {
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  fillCoat(ctx, frame.shape);
  ctx.restore();
}

function paintButton(ctx: Ctx, at: Pt): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, BUTTON_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = GOLD.base;
  ctx.fill();
  ctx.strokeStyle = GOLD.shadow;
  ctx.lineWidth = BUTTON_RADIUS / 2;
  ctx.stroke();
}

/**
 * One tail hanging from the middle of `haunch` at `atX` to a point below it,
 * leaning toward `back`, the side her tail is on. Unclipped: it hangs free of
 * her fur.
 */
function paintTail(ctx: Ctx, haunch: CatEllipse, atX: number, back: number, rootY: number): void {
  const half = haunch.rx * TAIL_HALF_WIDTH;
  const left = { x: atX - half, y: rootY };
  const right = { x: atX + half, y: rootY };
  const point = {
    x: atX + back * half * TAIL_POINT_LEAN,
    y: haunch.cy + haunch.ry + TAIL_HANG,
  };
  const bowDrop = (point.y + rootY) / 2;
  const leftBow = { x: left.x - half * TAIL_BOW, y: bowDrop };
  const rightBow = { x: right.x + half * TAIL_BOW, y: bowDrop };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.quadraticCurveTo(leftBow.x, leftBow.y, point.x, point.y);
  ctx.quadraticCurveTo(rightBow.x, rightBow.y, right.x, right.y);
  ctx.closePath();
  ctx.clip();
  fillCoat(ctx, { cx: atX, cy: bowDrop, rx: half, ry: point.y - bowDrop });
  strokeCurve(ctx, left, leftBow, point, GOLD.base, TRIM_WIDTH);
  strokeCurve(ctx, right, rightBow, point, GOLD.base, TRIM_WIDTH);
  ctx.restore();
}

/** In profile her haunch is covered, and both tails hang from the back of it, her tail toward -X. */
function paintSideHaunch(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  coverWhole(ctx, frame);
  for (const across of PROFILE_TAILS)
    paintTail(ctx, shape, shape.cx + shape.rx * across, -1, shape.cy);
}

/** From behind her haunches show fur either side of the tails, one hanging down each toward her midline. */
function paintBackHaunch(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  const inward = frame.side === 'left' ? 1 : -1;
  const rootY = shape.cy - shape.ry * BACK_TAIL_ROOT;
  paintTail(ctx, shape, shape.cx + inward * shape.rx * BACK_TAIL_INWARD, inward, rootY);
}

/** In profile her barrel is covered but for her belly, where the coat's front is cut away toward her haunch. */
function paintSideBarrel(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  const front = {
    x: shape.cx + shape.rx * CLIP_SPREAD,
    y: shape.cy + shape.ry * PROFILE_CUT_FRONT,
  };
  const control = { x: shape.cx, y: front.y };
  const back = { x: shape.cx + shape.rx * PROFILE_CUT_BACK, y: shape.cy + shape.ry * CLIP_SPREAD };
  const left = shape.cx - shape.rx * CLIP_SPREAD;
  const top = shape.cy - shape.ry * CLIP_SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(front.x, top);
  ctx.lineTo(front.x, front.y);
  ctx.quadraticCurveTo(control.x, control.y, back.x, back.y);
  ctx.lineTo(left, back.y);
  ctx.closePath();
  ctx.clip();
  fillCoat(ctx, shape);
  strokeCurve(ctx, front, control, back, GOLD.base, TRIM_WIDTH);
  ctx.restore();
}

function paintSide(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  if (frame.piece === 'haunch') {
    paintSideHaunch(ctx, frame);
    return;
  }
  if (frame.piece === 'barrel') {
    paintSideBarrel(ctx, frame);
    return;
  }
  if (frame.piece !== 'chest') return;
  coverWhole(ctx, frame);
  for (const height of PROFILE_BUTTON_HEIGHTS) {
    paintButton(ctx, {
      x: shape.cx + shape.rx * (1 - PROFILE_BUTTON_IN),
      y: shape.cy + shape.ry * height,
    });
  }
}

function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'barrel') {
    coverWhole(ctx, frame);
    return;
  }
  if (frame.piece === 'haunch') paintBackHaunch(ctx, frame);
}

/** Head-on: her chest ruff in red, black-edged lapels falling from her collar and gold buttons down the middle. */
function paintRuff(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  coverWhole(ctx, frame);
  const collar = shape.cy - shape.ry;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  for (const side of [-1, 1]) {
    strokeCurve(
      ctx,
      { x: shape.cx + side * shape.rx * LAPEL_SPREAD, y: collar },
      { x: shape.cx + side * shape.rx * LAPEL_SPREAD, y: shape.cy },
      { x: shape.cx, y: shape.cy + shape.ry * LAPEL_DEPTH },
      RINGMASTER_RED.edge,
      TRIM_WIDTH,
    );
  }
  ctx.restore();
  for (let button = 0; button < FRONT_BUTTONS; button++) {
    const down = button / (FRONT_BUTTONS - 1);
    paintButton(ctx, {
      x: shape.cx,
      y: shape.cy + shape.ry * (LAPEL_DEPTH + down * FRONT_BUTTON_SPAN),
    });
  }
}

function paintFront(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'ruff') {
    paintRuff(ctx, frame);
    return;
  }
  if (frame.piece === 'blade') {
    coverWhole(ctx, frame);
    return;
  }
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  const hemY = shape.cy + shape.ry * FRONT_HEM;
  const left = shape.cx - shape.rx * CLIP_SPREAD;
  const width = shape.rx * CLIP_SPREAD * 2;
  const top = shape.cy - shape.ry * CLIP_SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.rect(left, top, width, hemY - top);
  ctx.clip();
  fillCoat(ctx, shape);
  strokeCurve(
    ctx,
    { x: left, y: hemY },
    { x: shape.cx, y: hemY },
    { x: left + width, y: hemY },
    GOLD.base,
    TRIM_WIDTH,
  );
  ctx.restore();
}

export const CAT_SEQUIN_TAILCOAT = defineGarment({
  id: 'cat_sequin_tailcoat',
  name: 'Sequin Tailcoat',
  wearer: 'cat',
  material: 'cloth',
  layer: 'outer',
  region: ['body'],
  paint: {
    body: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
