/**
 * What the cat crawler's strap harnesses share: a strap laid over a piece of
 * her fur, and a metal ring where straps meet. A strap is a band of colour
 * with a dark edge each side and a lit line along it, since at her in-game
 * size it is one or two pixels wide and only its edges say it lies on top of
 * her coat.
 */

import type { FabricRamp } from './clothInk';
import { strokeCurve } from './clothInk';
import { paintGlint, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

export interface StrapLook {
  readonly fabric: FabricRamp;
  readonly width: number;
  /** How far the dark edge shows past the strap on each side. */
  readonly edge: number;
}

/** The lit line along a strap, as a share of its width. */
const STRAP_LIGHT_SHARE = 0.35;
/** The lit line sits toward the strap's upper edge, where the key light falls. */
const STRAP_LIGHT_LIFT = 0.22;

/** A strap from `from` through `control` to `to`. */
export function paintStrap(ctx: Ctx, look: StrapLook, from: Pt, control: Pt, to: Pt): void {
  strokeCurve(ctx, from, control, to, look.fabric.edge, look.width + look.edge * 2);
  strokeCurve(ctx, from, control, to, look.fabric.base, look.width);
  const lift = look.width * STRAP_LIGHT_LIFT;
  strokeCurve(
    ctx,
    { x: from.x, y: from.y - lift },
    { x: control.x, y: control.y - lift },
    { x: to.x, y: to.y - lift },
    look.fabric.light,
    look.width * STRAP_LIGHT_SHARE,
  );
}

const FULL_TURN = Math.PI * 2;
/** A ring's band, as a share of its radius. */
const RING_BAND_SHARE = 0.55;
/** Its glint sits on its upper left, toward the key light. */
const RING_GLINT_OFFSET = 0.5;
const RING_GLINT_REACH = 0.9;

/** A metal ring of `radius` centred on `at`. */
export function paintRing(ctx: Ctx, metal: MetalRamp, at: Pt, radius: number): void {
  const band = radius * RING_BAND_SHARE;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_TURN);
  ctx.strokeStyle = metal.shadow;
  ctx.lineWidth = band * 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, FULL_TURN);
  ctx.strokeStyle = metal.base;
  ctx.lineWidth = band;
  ctx.stroke();
  paintGlint(
    ctx,
    metal,
    at.x - radius * RING_GLINT_OFFSET,
    at.y - radius * RING_GLINT_OFFSET,
    radius * RING_GLINT_REACH,
  );
}
