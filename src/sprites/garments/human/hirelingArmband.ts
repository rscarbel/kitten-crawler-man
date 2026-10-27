/**
 * The Barracks Mercenaries' orange armband on a hireling built on the human
 * rig: a band of cloth tied round his right forearm just below the elbow,
 * over whatever sleeve he wears there. His right arm is the near one in
 * profile, so the band shows whichever way he faces.
 */

import type { BipedForearmFrame } from '../../art/biped/bipedParts';
import { drawnSide } from '../../art/biped/rig';
import { lerp, type Pt } from '../../art/bipedArt';
import { MERCENARY_ARMBAND } from '../../mercenaryArmband';
import { defineGarment } from '../garmentDef';
import { fillPolygon } from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** Where the band sits down the forearm, from the elbow, as shares of its length. */
const BAND_FROM = 0.04;
const BAND_TO = 0.32;
/** Half the band's width across the arm: round a robe's or a coat's sleeve, not the bare arm. */
const BAND_HALF = 0.072;
/** The lit stripe along the band's top edge and the shade along its bottom one. */
const EDGE_SHARE = 0.3;

function along(from: Pt, to: Pt, share: number): Pt {
  return { x: lerp(from.x, to.x, share), y: lerp(from.y, to.y, share) };
}

/** Fills the stretch of a band across the arm between two points down its axis. */
function fillAcross(ctx: Ctx, from: Pt, to: Pt, colour: string): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const nx = (-(to.y - from.y) / length) * BAND_HALF;
  const ny = ((to.x - from.x) / length) * BAND_HALF;
  fillPolygon(
    ctx,
    [
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
    ],
    colour,
  );
}

function paintBand(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  if (drawnSide(frame.drawn, frame.view) !== 'right') return;
  const { joint, end } = frame.chain;
  const at = (share: number): Pt => along(joint, end, share);
  fillAcross(ctx, at(BAND_FROM), at(BAND_TO), MERCENARY_ARMBAND.base);
  fillAcross(ctx, at(BAND_FROM), at(lerp(BAND_FROM, BAND_TO, EDGE_SHARE)), MERCENARY_ARMBAND.light);
  fillAcross(ctx, at(lerp(BAND_TO, BAND_FROM, EDGE_SHARE)), at(BAND_TO), MERCENARY_ARMBAND.shadow);
}

export const HIRELING_ARMBAND = defineGarment({
  id: 'hireling_armband',
  name: 'Mercenary armband',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintBand) },
});
