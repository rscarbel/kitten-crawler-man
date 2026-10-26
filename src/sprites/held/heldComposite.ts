/**
 * The one way a held item is put into a socket, whether it is a row's own prop
 * baked between a cell's two layers or an equipment-chosen item composited
 * between them at runtime: one transform from the socket, one painter.
 */

import type { Pt } from '../art/bipedArt';
import { drawHeldVisual } from './heldVisualCache';
import type { HeldVisualDef, ScriptedPropPlacement } from './heldVisualDef';
import { type HeldVisualTransform, paintHeldVisual, type Vec3 } from './heldPaint';

/** A socket as the compositor needs it, in whatever space the item is drawn into. */
export interface HeldSocketPlacement {
  readonly centre: Pt;
  readonly axis: Vec3;
  readonly palmNormal: Vec3;
  /** Which way the head's business side faces, where the socket decides it. */
  readonly leading?: Vec3;
  /** In a hand painted in the body's shade. */
  readonly shaded: boolean;
}

/**
 * The transform that puts an item's grip point on `socket`, at `scale`
 * destination units per rig unit.
 */
export function heldTransformAt(
  socket: HeldSocketPlacement,
  scale: number,
  phase = 0,
  scripted?: ScriptedPropPlacement,
): HeldVisualTransform {
  return {
    centre: socket.centre,
    axis: socket.axis,
    palmNormal: socket.palmNormal,
    ...(socket.leading === undefined ? {} : { leading: socket.leading }),
    scale,
    phase,
    shaded: socket.shaded,
    ...(scripted === undefined ? {} : { scripted }),
  };
}

/**
 * How the picture is made: painted afresh (a cell's bake, which happens once)
 * or from the held-art cache (every frame at runtime).
 */
export type HeldPainting = 'painted' | 'cached';

/** Draws `def` into `ctx` at `transform`. */
export function compositeHeldItem(
  ctx: CanvasRenderingContext2D,
  def: HeldVisualDef,
  transform: HeldVisualTransform,
  painting: HeldPainting,
): void {
  if (painting === 'painted') paintHeldVisual(ctx, def, transform);
  else drawHeldVisual(ctx, def, transform);
}

/** Ticks each of an item's pictures — a crackle, a flicker — is held before the next. */
const PHASE_HOLD_TICKS = 4;

/** Which of `def`'s pictures shows on `tick`. */
export function heldPhaseAt(def: HeldVisualDef, tick: number): number {
  return Math.floor(tick / PHASE_HOLD_TICKS) % def.phases;
}
