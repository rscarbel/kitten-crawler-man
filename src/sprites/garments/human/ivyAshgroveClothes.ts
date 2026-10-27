/**
 * Ivy Ashgrove's own clothes under her jerkin: close-cut moss-brown riding
 * trousers, soft knee-high boots, and the leather bracer on her bow arm that
 * keeps the string off her sleeve. Worn over the rig's base, as the cast's
 * trousers and the hirelings' armband are; no item names them.
 */

import type { BipedForearmFrame, BipedHipsFrame, BipedLegFrame } from '../../art/biped/bipedParts';
import type { GlossRamp } from '../../art/biped/palette';
import { deriveRamp } from '../../art/biped/palette';
import { drawnSide } from '../../art/biped/rig';
import { lerp, type Pt } from '../../art/bipedArt';
import { paintTrouserSeat, RIG_SEAT, type SeatFit } from '../../art/human/legwear';
import { defineGarment } from '../garmentDef';
import { bootPainter } from './crawlerBoots';
import { BOOT_SOLE, type BootLook } from './footwear';
import { fillPolygon } from './torsoCover';
import { type LegCloth, paintLegCloth } from './townsfolkLegwear';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Moss-brown wool, a step lighter than her boots so the knee where the boot
 * ends still reads, and warm against the green jerkin above it.
 */
const TROUSER_WOOL: GlossRamp = {
  deep: '#1d1a12',
  shadow: '#2e2a1c',
  dark: '#433c28',
  mid: '#574d33',
  base: '#6d613f',
  light: '#958758',
  rim: '#b3a677',
  specular: '#bdb183',
};

const IVY_TROUSER_CLOTH: LegCloth = { cloth: TROUSER_WOOL, cut: 'slimTrousers' };

/** Riding trousers sit close: the rig's full seat would stand off her hips like a skirt. */
const RIDING_SEAT: SeatFit = {
  across: 0.72,
  depth: 0.62,
  drop: RIG_SEAT.drop,
  style: { kind: 'legs', cut: IVY_TROUSER_CLOTH.cut },
};

function paintSeat(ctx: Ctx, frame: BipedHipsFrame): void {
  paintTrouserSeat(
    ctx,
    frame.skeleton,
    frame.view,
    IVY_TROUSER_CLOTH.cloth,
    RIDING_SEAT,
    frame.look.limbs,
  );
}

function paintLegs(ctx: Ctx, frame: BipedLegFrame): void {
  paintLegCloth(ctx, frame, IVY_TROUSER_CLOTH);
}

export const IVY_TROUSERS = defineGarment({
  id: 'ivy_trousers',
  name: 'Riding trousers',
  wearer: 'human',
  material: 'cloth',
  layer: 'over',
  region: ['hips', 'leg'],
  paint: {
    hips: humanEveryView(paintSeat),
    leg: humanEveryView(paintLegs),
  },
});

/** Dark oiled leather, its ramp spread wide so the calf keeps its round form through it. */
const BOOT_LEATHER: GlossRamp = {
  deep: '#140c08',
  shadow: '#24160e',
  dark: '#382317',
  mid: '#4c3020',
  base: '#623f2a',
  light: '#8e6447',
  rim: '#b38a69',
  specular: '#c49c7c',
};
/** The shaft rises almost to the knee: a ranger's soft boot, not a townsman's shoe. */
const BOOT_SHAFT_TOP_AT = 0.12;

const RANGER_BOOTS: BootLook = {
  leather: BOOT_LEATHER,
  sole: deriveRamp('#1e1712'),
  shaftTopAt: BOOT_SHAFT_TOP_AT,
  soleBuild: BOOT_SOLE,
};

export const IVY_BOOTS = defineGarment({
  id: 'ivy_boots',
  name: 'Ranger boots',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(bootPainter(RANGER_BOOTS)) },
});

/**
 * Mid-brown hide, darker than any orange: a tan bracer read at the tile as a
 * second armband on the bow arm.
 */
const BRACER = '#7a5232';
const BRACER_LIGHT = '#a07554';
const BRACER_SHADE = '#4a2f1b';
const BRACER_LACE = '#3d2615';
/** Where the bracer runs down the forearm, from the elbow, as shares of its length. */
const BRACER_FROM = 0.42;
const BRACER_TO = 0.93;
/** Half its width across the arm: proud of the sleeve under it. */
const BRACER_HALF = 0.05;
/** The lit stripe along its upper edge and the shade along its lower. */
const BRACER_EDGE_SHARE = 0.32;
/** The laces across its back, as shares along it. */
const BRACER_LACES: readonly number[] = [0.3, 0.6];
const LACE_HALF_WIDTH = 0.012;

function along(from: Pt, to: Pt, share: number): Pt {
  return { x: lerp(from.x, to.x, share), y: lerp(from.y, to.y, share) };
}

/** The band of the arm between two points down its axis, `fromEdge`–`toEdge` of the way across. */
function strip(from: Pt, to: Pt, fromEdge: number, toEdge: number): readonly Pt[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const nx = (-(to.y - from.y) / length) * BRACER_HALF;
  const ny = ((to.x - from.x) / length) * BRACER_HALF;
  const across = (point: Pt, share: number): Pt => ({
    x: point.x + nx * (1 - 2 * share),
    y: point.y + ny * (1 - 2 * share),
  });
  return [across(from, fromEdge), across(to, fromEdge), across(to, toEdge), across(from, toEdge)];
}

function paintBracer(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  if (drawnSide(frame.drawn, frame.view) !== 'left') return;
  const { joint, end } = frame.chain;
  if (Math.hypot(end.x - joint.x, end.y - joint.y) === 0) return;
  const from = along(joint, end, BRACER_FROM);
  const to = along(joint, end, BRACER_TO);
  fillPolygon(ctx, strip(from, to, 0, 1), BRACER);
  fillPolygon(ctx, strip(from, to, 0, BRACER_EDGE_SHARE), BRACER_LIGHT);
  fillPolygon(ctx, strip(from, to, 1 - BRACER_EDGE_SHARE, 1), BRACER_SHADE);
  for (const share of BRACER_LACES) {
    const lace = along(from, to, share);
    const past = along(from, to, share + LACE_HALF_WIDTH * 2);
    fillPolygon(ctx, strip(lace, past, 0, 1), BRACER_LACE);
  }
}

export const IVY_BRACER = defineGarment({
  id: 'ivy_bracer',
  name: 'Archer’s bracer',
  wearer: 'human',
  material: 'leather',
  layer: 'overcoat',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintBracer) },
});
