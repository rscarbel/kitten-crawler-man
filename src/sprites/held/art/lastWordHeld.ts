/**
 * The Last Word, asleep and awake. Asleep it is a plain, narrow blade of
 * dull grey steel on a black-corded grip, nothing about it asking to be
 * looked at. Awake it is the same blade in the same hand — the shape never
 * changes, so it is still unmistakably that sword — turned bright, with a
 * line of gold let into its ridge and a gilded guard and pommel.
 */

import { defineHeldVisual, type HeldHandleGeometry, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill, paintSharedHandle } from '../heldPaint';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';

type Ctx = CanvasRenderingContext2D;

const HANDLE_LENGTH = 0.19;
const GRIP_POINT = 0.5;
const BLADE_LENGTH = 0.68;
/** Narrower than an arming sword's: the blade is plain to the point of being overlooked. */
const BLADE_HALF = 0.022;
/** Where the edges begin to close, as a share of the blade: a long, needle-fine point. */
const TAPER_FROM = 0.7;
const GUARD_HALF_SPAN = 0.07;
const GUARD_HALF_THICK = 0.014;
/** The ridge runs from just past the guard to short of the point. */
const RIDGE_FROM = 0.04;
const RIDGE_TO = 0.86;
const RIDGE_WIDTH = 0.008;
const INLAY_WIDTH = 0.014;
/** The pommel is a plain round knob, this much wider than the grip. */
const POMMEL_SWELL = 1.6;

interface LastWordFinish {
  readonly steel: string;
  readonly steelLit: string;
  readonly ridge: string;
  readonly guard: string;
  readonly grip: string;
  readonly edge: string;
  /** The gold let into the ridge, or null while it sleeps. */
  readonly inlay: string | null;
}

const ASLEEP: LastWordFinish = {
  steel: '#6f737a',
  steelLit: '#979ba2',
  ridge: '#585b61',
  guard: '#3e3f43',
  grip: '#1f1c1d',
  edge: '#c3c6cb',
  inlay: null,
};

const AWAKE: LastWordFinish = {
  steel: '#c9ced8',
  steelLit: '#f2f4f8',
  ridge: '#ffffff',
  guard: '#d7a73c',
  grip: '#2a1d14',
  edge: '#ffffff',
  inlay: '#f3c64e',
};

function traceBlade(ctx: Ctx, base: number): void {
  const taper = base + BLADE_LENGTH * TAPER_FROM;
  const tip = base + BLADE_LENGTH;
  ctx.beginPath();
  ctx.moveTo(base, -BLADE_HALF);
  ctx.lineTo(taper, -BLADE_HALF);
  ctx.lineTo(tip, 0);
  ctx.lineTo(taper, BLADE_HALF);
  ctx.lineTo(base, BLADE_HALF);
  ctx.closePath();
}

function strokeAlongRidge(ctx: Ctx, base: number, colour: string, width: number): void {
  ctx.beginPath();
  ctx.moveTo(base + BLADE_LENGTH * RIDGE_FROM, 0);
  ctx.lineTo(base + BLADE_LENGTH * RIDGE_TO, 0);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintBlade(ctx: Ctx, look: HeldLook, base: number, finish: LastWordFinish): void {
  traceBlade(ctx, base);
  outlineAndFill(ctx, heldShade(finish.steel, look));
  ctx.save();
  traceBlade(ctx, base);
  ctx.clip();
  const litSide = look.light.y < 0 ? -1 : 1;
  ctx.fillStyle = heldShade(finish.steelLit, look);
  ctx.fillRect(base, litSide < 0 ? -BLADE_HALF : 0, BLADE_LENGTH, BLADE_HALF);
  ctx.restore();
  if (finish.inlay === null)
    strokeAlongRidge(ctx, base, heldShade(finish.ridge, look), RIDGE_WIDTH);
  else strokeAlongRidge(ctx, base, heldShade(finish.inlay, look), INLAY_WIDTH);
  ctx.beginPath();
  ctx.rect(base - GUARD_HALF_THICK, -GUARD_HALF_SPAN, GUARD_HALF_THICK * 2, GUARD_HALF_SPAN * 2);
  outlineAndFill(ctx, heldShade(finish.guard, look));
}

function lastWordHead(finish: LastWordFinish) {
  return (ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void => {
    if (look.facing === 'flat') {
      paintBlade(ctx, look, handle.headBase, finish);
      return;
    }
    seenOnEdge(ctx, () => paintBlade(ctx, look, handle.headBase, finish));
    paintBladeEdgeGlint(ctx, handle.headBase, handle.headBase + BLADE_LENGTH, finish.edge);
  };
}

/** The pommel takes the guard's metal, so a gilded guard is matched at the butt. */
function lastWordHandle(finish: LastWordFinish) {
  return (ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void => {
    paintSharedHandle(ctx, look, handle, { colour: finish.grip, butt: 'plain' });
    ctx.beginPath();
    ctx.arc(handle.buttX, 0, handle.halfWidth * POMMEL_SWELL, 0, Math.PI * 2);
    outlineAndFill(ctx, heldShade(finish.guard, look));
  };
}
const SHARED = {
  archetype: 'oneHandHaft',
  weight: 'light',
  handle: { length: HANDLE_LENGTH, radius: 'thin' },
  head: { length: BLADE_LENGTH + GUARD_HALF_THICK, width: GUARD_HALF_SPAN * 2 },
  gripPoint: GRIP_POINT,
  phases: 1,
} as const;

export const THE_LAST_WORD_HELD = defineHeldVisual({
  ...SHARED,
  id: 'the_last_word',
  name: 'The Last Word',
  paintHandle: lastWordHandle(ASLEEP),
  paintHead: lastWordHead(ASLEEP),
});

export const THE_LAST_WORD_AWAKENED_HELD = defineHeldVisual({
  ...SHARED,
  id: 'the_last_word_awakened',
  name: 'The Last Word (awakened)',
  paintHandle: lastWordHandle(AWAKE),
  paintHead: lastWordHead(AWAKE),
});
