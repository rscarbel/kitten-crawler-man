/**
 * Where each crawler's mouth is painted on the cell being drawn, read off the
 * same rig the painter solves, so art at the mouth (the blood-vomit drip, its
 * spray) rides every head bob, run lean and turn instead of sliding off to an
 * ear. Cached per cell: the answer is fixed by the cell, and solving a rig
 * every frame for one drip is waste.
 */

import type { FigureMouth } from '../Player';
import { mouthInTile } from './art/human/probe';
import { HUMAN_ROW_TABLE } from './art/humanFigure';
import { catMouthInTile, catRowFacesWest, catRowView } from './art/catFigure';
import { isTurnedView } from './facingView';
import type { HumanRowSelection } from './humanSprite';
import type { CatCell } from './catSprite';

const humanMouthByCell = new Map<string, FigureMouth | null>();
const catMouthByCell = new Map<string, FigureMouth | null>();

/** Which way a cell's figure bends toward its face: turned views only, toward where it faces. */
function profileLean(profile: boolean, flipX: boolean): -1 | 0 | 1 {
  if (!profile) return 0;
  return flipX ? -1 : 1;
}

function withLean(point: { x: number; y: number } | null, lean: -1 | 0 | 1): FigureMouth | null {
  return point === null ? null : { x: point.x, y: point.y, lean };
}

/** Carl's mouth on the cell `selection` draws, in tile fractions; null when he faces away. */
export function humanMouthOf(selection: HumanRowSelection): FigureMouth | null {
  const key = `${selection.row}:${selection.frame}:${String(selection.flipX)}`;
  const known = humanMouthByCell.get(key);
  if (known !== undefined) return known;
  const profile = isTurnedView(HUMAN_ROW_TABLE[selection.row].view);
  const found = withLean(
    mouthInTile(selection.row, selection.frame, selection.flipX),
    profileLean(profile, selection.flipX),
  );
  humanMouthByCell.set(key, found);
  return found;
}

/** Donut's mouth on `cell`, in tile fractions; null when she faces away. */
export function catMouthOf(cell: CatCell): FigureMouth | null {
  const key = `${cell.state}:${cell.frame}:${String(cell.flipX)}`;
  const known = catMouthByCell.get(key);
  if (known !== undefined) return known;
  const view = catRowView(cell.state);
  const profile = view !== undefined && isTurnedView(view);
  const facesLeft = cell.flipX !== catRowFacesWest(cell.state);
  const found = withLean(
    catMouthInTile(cell.state, cell.frame, cell.flipX),
    profileLean(profile, facesLeft),
  );
  catMouthByCell.set(key, found);
  return found;
}
