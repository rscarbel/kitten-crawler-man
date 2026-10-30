/**
 * The figure a human look is painted as in each outfit.
 *
 * A cached cell is keyed by figure, state and frame and shared by every draw,
 * so who is painted and what he wears cannot be a parameter of one draw: each
 * look in each outfit is a figure of its own, painted from the same rows,
 * keyed by the look, the outfit's garments and the grip his fist closes on.
 * Only one player human exists, so only his current outfit's figures are
 * resident, one per grip he draws with; the runtime swaps them when his
 * equipment changes and releases the old ones.
 */

import type { HumanGarmentRow } from '../biped/bipedParts';
import { type BipedPose } from '../biped/rig';
import { type FigureDef, figureStates } from '../../figure/figureDef';
import { defaultOutfitOf } from '../../garments/human/humanDressing';
import type { Outfit } from '../../garments/outfit';
import {
  HUMAN_ROW_BOOK,
  humanFigureId,
  type HumanFigurePainting,
  humanHeldLayers,
  type HumanPoseDresser,
  type HumanRowBook,
  type HumanRowName,
  humanStateFrames,
  paintDressedHumanFrame,
  type RowSpec,
  undressedDresser,
  undressedHumanFigure,
  undressedHumanPainting,
} from '../humanFigure';
import { type CarriedGrip, carriedGripKey, carryInMainHand } from './carry';
import { carryInOffHand, type OffHandGrip, offHandGripKey } from './offHand';
import { type HumanLook, withLookBuild } from '../../looks/humanLook';

// ── What a row tells the garments that move with it ──────────────────────────

/** What `row` tells a garment that moves with it. */
function garmentRowOf(row: RowSpec<string>): HumanGarmentRow {
  return { name: row.name };
}

// ── Figures ──────────────────────────────────────────────────────────────────

/**
 * A row's pose as it is painted in `outfit`: the outfit, and the row and frame
 * its garments read, laid onto it. For gates that pose a cell themselves.
 */
export function dressedPose(
  outfit: Outfit<'human'>,
  pose: BipedPose,
  row: RowSpec<string>,
  frame: number,
): BipedPose {
  return {
    ...pose,
    outfit: { outfit, row: garmentRowOf(row), frame, frameCount: row.frameCount },
  };
}

/** One of the human figures: the cells it paints, and how it paints them. */
export interface HumanFigure<R extends string = HumanRowName> {
  readonly def: FigureDef;
  readonly painting: HumanFigurePainting<R>;
}

/**
 * Built on first use rather than all up front: a `FigureDef` costs nothing
 * resident, but most outfits are never worn in a session.
 */
const figuresByKey = new Map<string, HumanFigure>();

/**
 * The key a figure is cached under: the look, the outfit, the handle in his
 * main hand if any and the shield on his off hand if any.
 */
function figureKey(
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null,
): string {
  const dressed = `${humanFigureId(look)}:${outfit.key}`;
  const holding = held === null ? dressed : `${dressed}:holding-${carriedGripKey(held)}`;
  return offHand === null ? holding : `${holding}:${offHandGripKey(offHand)}`;
}

/**
 * The figure `look` is painted as in `outfit`, his main hand closed on an
 * equipment-chosen item the way `held` says, or holding nothing, and his off
 * hand on a shield the way `offHand` says, or free. A look in its default
 * outfit holding nothing is its `undressedHumanFigure` itself; every other shares
 * its rows, cell and budget and differs in its id, in the look it paints, in
 * the garments laid on each pose and in what closes his fists.
 *
 * A held item is not part of the figure: only the fist closed round its
 * handle is, and each frame it closes on one is baked in two layers so the
 * item can be drawn between them.
 */
export function humanFigureFor(
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null = null,
): HumanFigure {
  const key = figureKey(look, outfit, held, offHand);
  const known = figuresByKey.get(key);
  if (known !== undefined) return known;
  if (isUndressed(look, outfit, held, offHand)) {
    const undressed: HumanFigure = {
      def: undressedHumanFigure(look),
      painting: undressedHumanPainting(look),
    };
    figuresByKey.set(key, undressed);
    return undressed;
  }
  const figure = figurePaintedFrom(HUMAN_ROW_BOOK, key, look, outfit, held, offHand);
  figuresByKey.set(key, figure);
  return figure;
}

/**
 * {@link humanFigureFor} painted from `rows` in place of the crawler's own:
 * the figure of one who plays rows on the rig the crawler never does. Its id
 * names the book, so its cells are never taken for the crawler's. Built anew
 * on each call: such a figure is made once, by the art that draws it.
 */
export function humanFigureWithRows<R extends string>(
  rows: HumanRowBook<R>,
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null = null,
): HumanFigure<R> {
  const key = `${figureKey(look, outfit, held, offHand)}:rows-${rows.id}`;
  return figurePaintedFrom(rows, key, look, outfit, held, offHand);
}

function isUndressed(
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null,
): boolean {
  return (
    figureKey(look, outfit, held, offHand) === figureKey(look, defaultOutfitOf(look), null, null)
  );
}

function dresserFor(
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null,
): HumanPoseDresser {
  if (isUndressed(look, outfit, held, offHand)) return undressedDresser(look);
  return (pose, row, frame) => {
    const dressed = withLookBuild(dressedPose(outfit, pose, row, frame), look);
    // The main hand first: it reads a closed left fist as his hands being busy.
    const inMainHand = held === null ? dressed : carryInMainHand(dressed, row, frame, held);
    return offHand === null ? inMainHand : carryInOffHand(inMainHand, row, offHand);
  };
}

function figurePaintedFrom<R extends string>(
  rows: HumanRowBook<R>,
  id: string,
  look: HumanLook,
  outfit: Outfit<'human'>,
  held: CarriedGrip | null,
  offHand: OffHandGrip | null,
): HumanFigure<R> {
  const painting: HumanFigurePainting<R> = {
    look,
    rows,
    dress: dresserFor(look, outfit, held, offHand),
    itemHandle: undressedHumanPainting(look).itemHandle,
  };
  return {
    def: {
      ...undressedHumanFigure(look),
      id,
      states: figureStates(humanStateFrames(rows)),
      paintFrame: (ctx, state, frame) => paintDressedHumanFrame(ctx, state, frame, painting),
      heldLayers: humanHeldLayers(painting),
    },
    painting,
  };
}

/** The figure `look` is painted as in `outfit`, holding nothing of equipment's choosing. */
export function humanFigureWearing(look: HumanLook, outfit: Outfit<'human'>): FigureDef {
  return humanFigureFor(look, outfit, null).def;
}
