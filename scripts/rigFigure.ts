/**
 * A figure on the human rig as the gates see it, whatever row book it is
 * painted from. The runtime's figures only take a row of their own book; a
 * gate that holds several books to one check names rows as strings and asks
 * each figure, which answers nothing for a row its book does not hold.
 */

import { type FigureDef } from '../src/sprites/figure/figureDef.js';
import { type HumanFigure } from '../src/sprites/art/human/appearance.js';
import { type CarriedGrip } from '../src/sprites/art/human/carry.js';
import { type OffHandGrip } from '../src/sprites/art/human/offHand.js';
import {
  type HumanSocketFrames,
  humanSocketsAt,
  type SocketSource,
} from '../src/sprites/art/human/sockets.js';
import {
  type HumanFigurePainting,
  type HumanRowBook,
  paintDressedHumanLayers,
  type RowSpec,
} from '../src/sprites/art/humanFigure.js';
import {
  type BipedHeldDraw,
  type BipedStowedDraw,
  drawHumanFigureSelection,
  heldPxPerUnit,
} from '../src/sprites/humanSprite.js';
import type { Outfit } from '../src/sprites/garments/outfit.js';
import type { HumanLook } from '../src/sprites/looks/humanLook.js';

/** The row, frame and mirroring of one draw, the row named by string. */
export interface RigSelection {
  readonly row: string;
  readonly frame: number;
  readonly flipX: boolean;
}

/** One figure on the rig: its cells, and its rows, sockets and draws by row name. */
export interface RigFigure {
  readonly def: FigureDef;
  readonly painting: Pick<HumanFigurePainting<string>, 'look' | 'dress' | 'itemHandle'>;
  readonly rowOf: (name: string) => RowSpec<string> | undefined;
  /** Every socket on one frame of one of the figure's rows; null for a row it does not hold. */
  readonly socketsAt: (row: string, frame: number) => HumanSocketFrames | null;
  /** Cell pixels per figure unit of what the figure holds. */
  readonly heldPxPerUnit: number;
  readonly paintLayers: (
    back: CanvasRenderingContext2D,
    front: CanvasRenderingContext2D,
    row: string,
    frame: number,
  ) => void;
  /** Draws one cell through the runtime path; nothing for a row the figure does not hold. */
  readonly draw: (
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    s: number,
    selection: RigSelection,
    held: BipedHeldDraw | null,
    stowed?: BipedStowedDraw | null,
  ) => void;
}

/** `figure` as the gates see it. */
export function rigFigureOf<R extends string>(figure: HumanFigure<R>): RigFigure {
  const { painting } = figure;
  const source: SocketSource<R> = { id: figure.def.id, painting };
  return {
    def: figure.def,
    painting,
    rowOf: (name) => painting.rows.rowOf(name),
    socketsAt: (row, frame) => {
      const spec = painting.rows.rowOf(row);
      return spec === undefined ? null : humanSocketsAt(source, spec.name, frame);
    },
    heldPxPerUnit: heldPxPerUnit(source),
    paintLayers: (back, front, row, frame) =>
      paintDressedHumanLayers(back, front, row, frame, painting),
    draw: (ctx, sx, sy, s, selection, held, stowed = null) => {
      const spec = painting.rows.rowOf(selection.row);
      if (spec === undefined) return;
      drawHumanFigureSelection(
        ctx,
        figure,
        sx,
        sy,
        s,
        { row: spec.name, frame: selection.frame, flipX: selection.flipX },
        held,
        stowed,
      );
    },
  };
}

/** Builds the figure of one look, outfit and grip from one row book. */
export type RigFigureMaker = (
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand?: OffHandGrip | null,
) => RigFigure;

/** One row book on the rig, as the gates hold it: its rows in sheet order, and its figures. */
export interface RigRows {
  readonly id: string;
  readonly rows: readonly RowSpec<string>[];
  readonly rowOf: (name: string) => RowSpec<string> | undefined;
  readonly figureFor: RigFigureMaker;
}

/** `book` as the gates hold it, its figures built by `figureFor`. */
export function rigRowsOf<R extends string>(
  book: HumanRowBook<R>,
  figureFor: (
    look: HumanLook,
    outfit: Outfit<'human'>,
    held: CarriedGrip | null,
    offHand: OffHandGrip | null,
  ) => HumanFigure<R>,
): RigRows {
  return {
    id: book.id,
    rows: book.rows,
    rowOf: (name) => book.rowOf(name),
    figureFor: (look, outfit, held, offHand = null) =>
      rigFigureOf(figureFor(look, outfit, held, offHand)),
  };
}
