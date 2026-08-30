/**
 * What a procedurally painted figure declares about itself.
 *
 * This is the manifest entry, moved into TypeScript. A baked creature's
 * geometry lived in `manifest.json` — frame size, the anchor tying the cell to
 * the tile the creature stands on, the tile scale the runtime divides by, and
 * one row per animation state. A painted creature carries the same four things
 * plus the painter itself, so a call site that used to reach for a `SpriteKey`
 * reaches for a `FigureDef` and nothing downstream changes shape.
 *
 * The anchor is kept as `tileX`/`tileY` — pixel offsets from the cell's
 * top-left to the creature's tile origin — rather than as a "where the feet
 * sit" fraction, because those are the exact two numbers `drawSprite` subtracts
 * when it places a sheet cell. Keeping the same fields lets the cached blit be
 * the sheet blit with a different source image, which is what makes visual
 * parity a property of the code path instead of a thing to re-verify.
 */

/** A figure's animation state: one row of the sheet it replaces. */
export interface FigureStateDef {
  readonly frames: number;
}

/**
 * A figure's states by name. A map rather than a record because a state name
 * reaching this from a call site is a string the type system has stopped
 * tracking — the sheet path answers an unknown key with `undefined`, and so
 * must this one.
 */
export type FigureStateTable = ReadonlyMap<string, FigureStateDef>;

/** Builds a state table from a figure's own frame-count record. */
export function figureStates(frameCounts: Readonly<Record<string, number>>): FigureStateTable {
  return new Map(Object.entries(frameCounts).map(([name, frames]) => [name, { frames }]));
}

/**
 * Paints one frame into a cell whose coordinate space is the cell's own pixels:
 * (0, 0) is the cell's top-left and (frameWidth, frameHeight) its bottom-right.
 * Density is applied by the caller's transform, so the painter never knows
 * whether it is drawing a supersampled bake or a one-shot direct draw.
 */
export type FigurePainter = (ctx: CanvasRenderingContext2D, state: string, frame: number) => void;

/**
 * A stable identity for a figure, shared by every instance of it. Appearance is
 * fixed per figure — every goblin swinging an axe is the same pixels — so the
 * cache keys on this rather than on the mob object.
 */
export type FigureId = string;

export interface FigureDef {
  readonly id: FigureId;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Offset from the cell's left edge to the creature's tile origin, in cell pixels. */
  readonly tileX: number;
  /** Offset from the cell's top edge to the creature's tile origin, in cell pixels. */
  readonly tileY: number;
  /** Cell pixels per tile; the runtime scales by `tileSize / tileScale`. */
  readonly tileScale: number;
  readonly states: FigureStateTable;
  readonly paintFrame: FigurePainter;
}

/** The frame count of a state, or 0 when the figure declares no such state. */
export function figureFrameCount(def: FigureDef, state: string): number {
  return def.states.get(state)?.frames ?? 0;
}
