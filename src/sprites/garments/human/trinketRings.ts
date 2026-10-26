/**
 * The trinkets on the human crawler: each charm worn as a ring on his hand,
 * and the Nimble Bangle round his right wrist.
 *
 * At the tile his hand is three pixels, so a ring is one bright pixel on it:
 * each is a thin band round the base of one finger with its charm set on the
 * back of the finger, sized and coloured so that pixel says copper, bone,
 * frost, ember or gold. Every ring has its own hand and finger, so the two he
 * can wear at once never sit on each other; a glove covers the rings on its
 * hand. A hand closed round a handle hides its rings in the grip.
 */

import type { BipedForearmFrame } from '../../art/biped/bipedParts';
import { angleBetween, TWO_PI } from '../../art/biped/geometry';
import { bareSegmentEdges } from '../../art/biped/limbs';
import { drawnSide, type BodySide } from '../../art/biped/rig';
import { mix, type Pt } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import type { HumanWornGarmentId } from '../garmentIds';
import { armDepthShade, handReachOf, onHand } from './forearmCuff';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;
type ArmFrame = Extract<BipedForearmFrame, { piece: 'arm' }>;

/** What a far arm's ring sinks toward in the body's shade. */
const RING_SHADE_TOWARD = '#1d1a20';

/** The band sits round the base of the finger, just past the knuckles. */
const BAND_ALONG = 0.66;
/** Across the hand, each finger's middle as a share of its half width, from the thumb side out. */
const FINGERS = [0.15, -0.15, -0.45] as const;
type Finger = 0 | 1 | 2;
/** The knuckles' half width, in figure units: where the fingers are spread across. */
const KNUCKLES_HALF = 0.05;
/** The band is a short bar across the finger. */
const BAND_HALF_ACROSS = 0.016;
const BAND_WIDTH = 0.018;

/** Where a ring is worn. */
interface RingPlace {
  readonly side: BodySide;
  readonly finger: Finger;
}

/** What a ring looks like at the tile: its band's metal and the charm set on it. */
interface RingLook {
  readonly band: string;
  /** `shade` sinks a colour into the shade a far arm stands in. */
  readonly paintCharm: (ctx: Ctx, at: Pt, angle: number, shade: (colour: string) => string) => void;
}

function sunk(colour: string, depthShade: number): string {
  return depthShade > 0 ? mix(colour, RING_SHADE_TOWARD, depthShade) : colour;
}

function disc(ctx: Ctx, at: Pt, radius: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
}

/** A point `along` and `across` from `at`, in the hand's own direction. */
function from(at: Pt, angle: number, along: number, across: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: at.x + cos * along - sin * across, y: at.y + sin * along + cos * across };
}

/** Paints the ring on the hand the frame dresses, or nothing on the other hand. */
function paintRing(ctx: Ctx, frame: ArmFrame, place: RingPlace, look: RingLook): void {
  if (frame.drawn !== drawnSide(place.side, frame.view)) return;
  const hand = handReachOf(frame);
  if (hand.gripping) return;
  const across = FINGERS[place.finger] * KNUCKLES_HALF;
  const at = onHand(hand, BAND_ALONG, across);
  const depthShade = armDepthShade(frame);
  const bandFrom = from(at, hand.angle, 0, -BAND_HALF_ACROSS);
  const bandTo = from(at, hand.angle, 0, BAND_HALF_ACROSS);
  ctx.strokeStyle = sunk(look.band, depthShade);
  ctx.lineWidth = BAND_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bandFrom.x, bandFrom.y);
  ctx.lineTo(bandTo.x, bandTo.y);
  ctx.stroke();
  look.paintCharm(ctx, at, hand.angle, (colour) => sunk(colour, depthShade));
}

/** Defines a ring garment for a trinket: worn at `place`, looking like `look`. */
function ringGarment(id: HumanWornGarmentId, name: string, place: RingPlace, look: RingLook) {
  return defineGarment({
    id,
    name,
    wearer: 'human',
    material: 'jewelry',
    layer: 'under',
    region: ['forearm'],
    covers: [place.side === 'left' ? 'leftHand' : 'rightHand'],
    paint: {
      forearm: humanEveryView((ctx: Ctx, frame: BipedForearmFrame) => {
        if (frame.piece === 'arm') paintRing(ctx, frame, place, look);
      }),
    },
  });
}

// ── The charms ──

const COPPER = '#c27a45';
const COPPER_LIGHT = '#f0b27a';
const COPPER_DARK = '#7a4424';
const BRASS = '#c9a24a';
const GOLD = '#e8c45a';
const GOLD_LIGHT = '#fff0b0';
const BONE_YELLOW = '#e6d39a';
const BONE_TIP = '#fbf4dc';
const WIRE = '#9aa0a8';
const FROST = '#bfe4f6';
const FROST_LIGHT = '#f4fbff';
const EMBER = '#ff7a26';
const EMBER_CORE = '#ffd36a';
const NAIL_IRON = '#2a2a30';
const RIME = '#d8f0ff';
const SAND = '#e9c27a';

/** A coin, a bead or a stone: a disc on the back of the finger, its lit side toward the key. */
const STONE_RADIUS = 0.024;
const STONE_LIGHT_RADIUS = 0.011;
const STONE_LIGHT_OFFSET = -0.008;

function stone(base: string, light: string): RingLook['paintCharm'] {
  return (ctx, at, _angle, shade) => {
    disc(ctx, at, STONE_RADIUS, shade(base));
    const lit = { x: at.x + STONE_LIGHT_OFFSET, y: at.y + STONE_LIGHT_OFFSET };
    disc(ctx, lit, STONE_LIGHT_RADIUS, shade(light));
  };
}

/** The penny: a copper disc with its punched hole showing dark. */
const PENNY_HOLE_RADIUS = 0.007;
const pennyCharm: RingLook['paintCharm'] = (ctx, at, angle, shade) => {
  stone(COPPER, COPPER_LIGHT)(ctx, at, angle, shade);
  disc(ctx, at, PENNY_HOLE_RADIUS, shade(COPPER_DARK));
};

/** The fang: a yellow tooth lying along the finger, bound to the band with wire. */
const FANG_LENGTH = 0.05;
const FANG_ROOT_HALF = 0.014;
const fangCharm: RingLook['paintCharm'] = (ctx, at, angle, shade) => {
  const root = from(at, angle, -FANG_LENGTH * HALF_SHARE, 0);
  const tip = from(at, angle, FANG_LENGTH * HALF_SHARE, 0);
  const rootA = from(root, angle, 0, -FANG_ROOT_HALF);
  const rootB = from(root, angle, 0, FANG_ROOT_HALF);
  ctx.fillStyle = shade(BONE_YELLOW);
  ctx.beginPath();
  ctx.moveTo(rootA.x, rootA.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(rootB.x, rootB.y);
  ctx.closePath();
  ctx.fill();
  disc(ctx, from(at, angle, FANG_LENGTH * TIP_LIGHT_SHARE, 0), STONE_LIGHT_RADIUS, shade(BONE_TIP));
  disc(ctx, root, STONE_LIGHT_RADIUS, shade(WIRE));
};
const HALF_SHARE = 0.5;
const TIP_LIGHT_SHARE = 0.15;

/** The cinder: an orange coal glowing inside a brass cage. */
const CAGE_RADIUS = 0.026;
const CAGE_BAR = 0.008;
const CINDER_RADIUS = 0.017;
const emberCharm: RingLook['paintCharm'] = (ctx, at, _angle, shade) => {
  disc(ctx, at, CAGE_RADIUS, shade(BRASS));
  disc(ctx, at, CINDER_RADIUS, shade(EMBER));
  disc(ctx, at, STONE_LIGHT_RADIUS, shade(EMBER_CORE));
  ctx.strokeStyle = shade(BRASS);
  ctx.lineWidth = CAGE_BAR;
  ctx.beginPath();
  ctx.moveTo(at.x - CAGE_RADIUS, at.y);
  ctx.lineTo(at.x + CAGE_RADIUS, at.y);
  ctx.stroke();
};

/** The fae-iron nail: the band itself is the black nail, half rimed white, half glowing. */
const NAIL_HALF = 0.028;
const NAIL_WIDTH = 0.02;
const faeIronCharm: RingLook['paintCharm'] = (ctx, at, angle, shade) => {
  const rimeEnd = from(at, angle, 0, -NAIL_HALF);
  const glowEnd = from(at, angle, 0, NAIL_HALF);
  ctx.lineCap = 'round';
  ctx.lineWidth = NAIL_WIDTH;
  ctx.strokeStyle = shade(RIME);
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(rimeEnd.x, rimeEnd.y);
  ctx.stroke();
  ctx.strokeStyle = shade(EMBER);
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(glowEnd.x, glowEnd.y);
  ctx.stroke();
  disc(ctx, at, STONE_LIGHT_RADIUS, shade(NAIL_IRON));
};

/** The hourglass: two gold-framed bulbs along the finger, the sand a warm dot in the upper one. */
const GLASS_BULB_RADIUS = 0.014;
const GLASS_BULB_APART = 0.016;
const hourglassCharm: RingLook['paintCharm'] = (ctx, at, angle, shade) => {
  const near = from(at, angle, -GLASS_BULB_APART, 0);
  const far = from(at, angle, GLASS_BULB_APART, 0);
  disc(ctx, near, GLASS_BULB_RADIUS, shade(GOLD));
  disc(ctx, far, GLASS_BULB_RADIUS, shade(GOLD));
  disc(ctx, far, STONE_LIGHT_RADIUS, shade(SAND));
  disc(ctx, near, STONE_LIGHT_RADIUS * HALF_SHARE, shade(GOLD_LIGHT));
};

export const HUMAN_LUCKY_PENNY_RING = ringGarment(
  'human_lucky_penny_ring',
  'Lucky Penny',
  { side: 'left', finger: 0 },
  { band: COPPER, paintCharm: pennyCharm },
);

export const HUMAN_FROSTWARD_RING = ringGarment(
  'human_frostward_ring',
  'Frostward Charm',
  { side: 'left', finger: 1 },
  { band: WIRE, paintCharm: stone(FROST, FROST_LIGHT) },
);

export const HUMAN_FAE_IRON_RING = ringGarment(
  'human_fae_iron_ring',
  'Fae-Iron Charm',
  { side: 'left', finger: 2 },
  { band: NAIL_IRON, paintCharm: faeIronCharm },
);

export const HUMAN_FANG_RING = ringGarment(
  'human_fang_ring',
  'Fang Charm',
  { side: 'right', finger: 0 },
  { band: WIRE, paintCharm: fangCharm },
);

export const HUMAN_EMBERWARD_RING = ringGarment(
  'human_emberward_ring',
  'Emberward Charm',
  { side: 'right', finger: 1 },
  { band: BRASS, paintCharm: emberCharm },
);

export const HUMAN_HOURGLASS_RING = ringGarment(
  'human_hourglass_ring',
  'Hourglass Charm',
  { side: 'right', finger: 2 },
  { band: GOLD, paintCharm: hourglassCharm },
);

// ── The Nimble Bangle ──

/** A thin copper band round the right wrist, sliding down onto the hand's heel. */
const BANGLE_SIDE: BodySide = 'right';
const BANGLE_AT = 0.97;
/** It hangs loose: proud of the wrist all round. */
const BANGLE_PROUD = 0.014;
const BANGLE_WIDTH = 0.022;
/** The bangle's lit edge toward the key, along its top. */
const BANGLE_LIGHT_WIDTH = 0.009;

function paintBangle(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  if (frame.drawn !== drawnSide(BANGLE_SIDE, frame.view)) return;
  const { chain, view } = frame;
  const depthShade = armDepthShade(frame);
  const angle = angleBetween(chain.joint, chain.end);
  const length = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const edges = bareSegmentEdges('forearm', BANGLE_AT, view.profile, frame.look.limbs);
  const half = Math.max(edges.plus, edges.minus) + BANGLE_PROUD;
  const x = length * BANGLE_AT;
  ctx.save();
  ctx.translate(chain.joint.x, chain.joint.y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  ctx.lineWidth = BANGLE_WIDTH;
  ctx.strokeStyle = sunk(COPPER, depthShade);
  ctx.beginPath();
  ctx.moveTo(x, -half);
  ctx.lineTo(x, half);
  ctx.stroke();
  ctx.lineWidth = BANGLE_LIGHT_WIDTH;
  ctx.strokeStyle = sunk(COPPER_LIGHT, depthShade);
  ctx.beginPath();
  ctx.moveTo(x - BANGLE_LIGHT_WIDTH, -half);
  ctx.lineTo(x - BANGLE_LIGHT_WIDTH, 0);
  ctx.stroke();
  ctx.restore();
}

export const HUMAN_NIMBLE_BANGLE = defineGarment({
  id: 'human_nimble_bangle',
  name: 'Nimble Bangle',
  wearer: 'human',
  material: 'jewelry',
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintBangle) },
});
