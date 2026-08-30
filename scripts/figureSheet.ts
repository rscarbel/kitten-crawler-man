/**
 * A contact sheet baked from a `FigureDef`'s painter.
 *
 * Every review harness used to load the creature's PNG and cut it into cells.
 * A painted creature has no PNG, so the sheet is assembled here instead — one
 * row per declared state, each cell painted supersampled and downsampled into
 * place exactly as the runtime cache bakes it, so what a reviewer looks at is
 * what the game blits.
 */

import { createCanvas, type Canvas } from 'canvas';

import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { asGameContext } from './nodeGameContext.js';

/** Density each cell is painted at before being downsampled, as the cache does. */
const SUPERSAMPLE = 2;

export interface FigureSheet {
  readonly canvas: Canvas;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The widest row's frame count — the sheet's column count. */
  readonly columns: number;
  /** The states, in the order their rows were laid down. */
  readonly states: readonly string[];
}

/** The declared states in a stable order: whatever order the def declares them. */
export function figureStateNames(def: FigureDef): string[] {
  return [...def.states.keys()];
}

export function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

/** Paints one cell of a figure at the given density onto its own canvas. */
export function paintFigureCell(def: FigureDef, state: string, frame: number, density = 1): Canvas {
  const width = Math.ceil(def.frameWidth * density);
  const height = Math.ceil(def.frameHeight * density);
  const cell = createCanvas(width, height);
  const ctx = asGameContext(cell.getContext('2d'));
  ctx.save();
  ctx.scale(density, density);
  def.paintFrame(ctx, state, frame);
  ctx.restore();
  return cell;
}

/** One cell, baked the way the runtime cache bakes it: supersampled, then down. */
export function bakeFigureCell(def: FigureDef, state: string, frame: number): Canvas {
  const supersampled = paintFigureCell(def, state, frame, SUPERSAMPLE);
  const cell = createCanvas(def.frameWidth, def.frameHeight);
  const ctx = cell.getContext('2d');
  ctx.drawImage(
    supersampled,
    0,
    0,
    supersampled.width,
    supersampled.height,
    0,
    0,
    def.frameWidth,
    def.frameHeight,
  );
  return cell;
}

/**
 * Lays every state out as a row of cells, in `states` order.
 *
 * @param states  The rows to include; defaults to every state the def declares.
 */
export function bakeFigureSheet(def: FigureDef, states = figureStateNames(def)): FigureSheet {
  if (states.length === 0) throw new Error(`${def.id} declares no states at all`);
  const columns = Math.max(...states.map((state) => frameCountOf(def, state)));
  const canvas = createCanvas(columns * def.frameWidth, states.length * def.frameHeight);
  const ctx = canvas.getContext('2d');

  states.forEach((state, rowIndex) => {
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame < frames; frame++) {
      ctx.drawImage(
        bakeFigureCell(def, state, frame),
        frame * def.frameWidth,
        rowIndex * def.frameHeight,
      );
    }
  });

  return {
    canvas,
    frameWidth: def.frameWidth,
    frameHeight: def.frameHeight,
    columns,
    states,
  };
}
