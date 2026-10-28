/**
 * What the human crawler wears on his hands and forearms: the Scrapper's
 * Wraps, the Silkspinner Gloves, the Iron Knuckle Gauntlet on his right hand
 * and the Hearthguard Bracers.
 *
 * A glove paints his hand through `gloves`: the figure draws the hand itself
 * in the glove's ramp, through every fist, open hand and grip, so it keeps the
 * hand's form and its place in front of or behind a held handle. The painter
 * here adds only what rides on the forearm — a cuff, a wrap, a bell of iron —
 * and the few marks on the hand that read at the tile.
 */

import type { BipedForearmFrame } from '../../art/biped/bipedParts';
import { crease } from '../../art/biped/paint';
import { deriveRamp, LIGHT, type Ramp } from '../../art/biped/palette';
import { drawnSide, type BodySide } from '../../art/biped/rig';
import { pt, rotate, TWO_PI } from '../../art/biped/geometry';
import { rgba } from '../../art/bipedArt';
import { fillSoftEllipse } from '../../art/softShade';
import { defineGarment } from '../garmentDef';
import {
  cuffHalfAt,
  type CuffFrame,
  type CuffShape,
  handReachOf,
  handReachOn,
  inArmShade,
  onHand,
  paintCuffForm,
  paintCuffRivet,
  paintForearmCuff,
  PROFILE_FAR_ARM,
} from './forearmCuff';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;
type ArmFrame = Extract<BipedForearmFrame, { piece: 'arm' }>;

// ── Scrapper's Wraps ──

/** Cloth wraps gone grey: light enough to part from his skin, dirty enough not to read as bandages. */
const WRAP_CLOTH: Ramp = deriveRamp('#c9c2b2');
/** Fresh tape at the wrist, a step whiter than the cloth it holds down. */
const WRAP_TAPE = '#efece4';
/** Old blood across the knuckles, dried brown. */
const WRAP_BLOOD = '#7a3a2a';
const WRAP_BLOOD_ALPHA = 0.85;
/** Where on the knuckles the stain sits, along the hand, and how big it spreads. */
const WRAP_BLOOD_AT = 0.78;
const WRAP_BLOOD_ALONG = 0.18;
const WRAP_BLOOD_ACROSS = 0.032;

/** The wraps run from the lower forearm over the wrist, wound tight: barely proud of the skin. */
const WRAPS: CuffShape = { from: 0.55, to: 1, proudFrom: 0.004, proudTo: 0.008, endBow: 0.3 };
/** The turns of the wrap: diagonal folds round the forearm, a fixed step apart. */
const WRAP_TURNS = [0.18, 0.42, 0.66] as const;
/** Each turn climbs this far along the arm as it crosses it, so it reads as wound rather than ringed. */
const WRAP_TURN_SLANT = 0.6;
const WRAP_TURN_WIDTH = 0.016;
const WRAP_TURN_OPACITY = 0.85;
/** The tape band round the wrist, as shares of the wrap's run. */
const TAPE_FROM = 0.82;
const TAPE_TO = 0.96;

function paintWrapTurns(ctx: Ctx, cuff: CuffFrame): void {
  paintCuffForm(ctx, cuff);
  const run = cuff.toX - cuff.fromX;
  for (const at of WRAP_TURNS) {
    const x = cuff.fromX + run * at;
    const half = cuffHalfAt(cuff, x);
    crease(
      ctx,
      () => {
        ctx.moveTo(x - half * WRAP_TURN_SLANT, -half);
        ctx.lineTo(x + half * WRAP_TURN_SLANT, half);
      },
      WRAP_TURN_WIDTH,
      cuff.ramp,
      WRAP_TURN_OPACITY,
      cuff.angle,
    );
  }
  const tapeFrom = cuff.fromX + run * TAPE_FROM;
  const tapeTo = cuff.fromX + run * TAPE_TO;
  const half = cuffHalfAt(cuff, tapeTo);
  ctx.fillStyle = inArmShade(WRAP_TAPE, cuff);
  ctx.fillRect(tapeFrom, -half, tapeTo - tapeFrom, half * 2);
  ctx.fillStyle = cuff.ramp.mid;
  ctx.fillRect(tapeFrom, 0, tapeTo - tapeFrom, half);
}

function paintWraps(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  paintForearmCuff(ctx, frame, WRAPS, WRAP_CLOTH, (cuff) => paintWrapTurns(ctx, cuff));
  const hand = handReachOf(frame);
  if (hand.gripping) return;
  const stain = onHand(hand, WRAP_BLOOD_AT);
  fillSoftEllipse(
    ctx,
    stain.x,
    stain.y,
    hand.length * WRAP_BLOOD_ALONG,
    WRAP_BLOOD_ACROSS,
    WRAP_BLOOD,
    WRAP_BLOOD_ALPHA,
    hand.angle,
  );
}

export const HUMAN_SCRAPPERS_WRAPS = defineGarment({
  id: 'human_scrappers_wraps',
  name: "Scrapper's Wraps",
  wearer: 'human',
  material: 'cloth',
  layer: 'outer',
  region: ['forearm'],
  covers: ['leftHand', 'rightHand'],
  gloves: { left: WRAP_CLOTH, right: WRAP_CLOTH },
  paint: { forearm: humanEveryView(paintWraps) },
});

// ── Silkspinner Gloves ──

/** Pale kid, faintly lilac: paler than his skin by a wide step, so the hands read white at the tile. */
const SILK_GLOVE: Ramp = deriveRamp('#e4dfe8');
/** The threads: spider silk catching the light. */
const SILK_THREAD = '#f7f4ff';
const SILK_THREAD_ALPHA = 1;
const SILK_THREAD_WIDTH = 0.016;
/** A short cuff of the same kid just past the wrist, flared a little. */
const SILK_CUFF: CuffShape = { from: 0.8, to: 1, proudFrom: 0.014, proudTo: 0.006, endBow: 0.35 };
/**
 * Threads leave the fingertips and hang: each starts across the tips, sags
 * under its own weight and trails back past the wrist. Across is a share of
 * the hand's width either side of its middle; the sag and the trail are
 * figure units, down and back along the hand.
 */
const SILK_THREADS = [
  { across: -0.03, sag: 0.11, trail: 0.08 },
  { across: 0, sag: 0.15, trail: 0.04 },
  { across: 0.03, sag: 0.09, trail: 0.1 },
] as const;
const SILK_TIP_AT = 1;
/** The thread's bow sits this share of the way down its fall. */
const SILK_BOW_AT = 0.6;

/**
 * The threads hang past his silhouette, so they are laid over the finished,
 * outlined figure: painted inside it they take its outline and read as dark
 * wire. Edge-on the far hand is behind his body, and its threads with it.
 */
function paintSilkThreads(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'overFinished') return;
  const sides: readonly BodySide[] = frame.view.profile ? [nearArmInProfile] : ['left', 'right'];
  ctx.strokeStyle = rgba(SILK_THREAD, SILK_THREAD_ALPHA);
  ctx.lineWidth = SILK_THREAD_WIDTH;
  ctx.lineCap = 'round';
  for (const drawn of sides) {
    const hand = handReachOn(frame, drawn);
    const back = { x: -Math.cos(hand.angle), y: -Math.sin(hand.angle) };
    for (const thread of SILK_THREADS) {
      const tip = onHand(hand, SILK_TIP_AT, thread.across);
      const end = pt(tip.x + back.x * thread.trail, tip.y + thread.sag);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.quadraticCurveTo(tip.x, tip.y + thread.sag * SILK_BOW_AT, end.x, end.y);
      ctx.stroke();
    }
  }
}
const nearArmInProfile: BodySide = PROFILE_FAR_ARM === 'left' ? 'right' : 'left';

function paintSilkspinner(ctx: Ctx, frame: BipedForearmFrame): void {
  paintSilkThreads(ctx, frame);
  if (frame.piece === 'arm') paintForearmCuff(ctx, frame, SILK_CUFF, SILK_GLOVE);
}

export const HUMAN_SILKSPINNER_GLOVES = defineGarment({
  id: 'human_silkspinner_gloves',
  name: 'Silkspinner Gloves',
  wearer: 'human',
  material: 'cloth',
  layer: 'outer',
  region: ['forearm'],
  covers: ['leftHand', 'rightHand'],
  gloves: { left: SILK_GLOVE, right: SILK_GLOVE },
  paint: { forearm: humanEveryView(paintSilkspinner) },
});

// ── Iron Knuckle Gauntlet ──

/** Black iron, cold and dark: it has to read against his tan skin and the dungeon floor alike. */
const IRON: Ramp = {
  deep: '#121318',
  shadow: '#1f2128',
  dark: '#2e3139',
  mid: '#3e424b',
  base: '#535862',
  light: '#7c828d',
  rim: '#aab0ba',
};
const IRON_RIVET = '#d9dce2';
/** The gauntlet is the right hand's alone. */
const GAUNTLET_SIDE: BodySide = 'right';
/** A bell of iron from mid-forearm over the wrist, flared wide at its open end. */
const GAUNTLET_CUFF: CuffShape = {
  from: 0.42,
  to: 1,
  proudFrom: 0.05,
  proudTo: 0.016,
  endBow: 0.45,
};
/** Ridges hammered round the bell, as shares of its run. */
const GAUNTLET_RIDGES = [0.3, 0.62] as const;
const GAUNTLET_RIDGE_WIDTH = 0.018;
/** The rivets along the bell's open rim, as shares of its half width either side of the bone. */
const GAUNTLET_RIVET_ROW_AT = 0.12;
const GAUNTLET_RIVETS_ACROSS = [-0.6, 0, 0.6] as const;
const GAUNTLET_RIVET_RADIUS = 0.016;
/** The knuckle plate's lit ridge across the back of the fist. */
const KNUCKLE_RIDGE_AT = 0.72;
const KNUCKLE_RIDGE_HALF = 0.045;
const KNUCKLE_RIDGE_WIDTH = 0.02;
/** The rivets along the knuckle plate. */
const KNUCKLE_RIVETS_ACROSS = [-0.03, 0, 0.03] as const;
const KNUCKLE_RIVET_RADIUS = 0.011;

function paintGauntletRidges(ctx: Ctx, cuff: CuffFrame): void {
  const run = cuff.toX - cuff.fromX;
  for (const at of GAUNTLET_RIDGES) {
    const x = cuff.fromX + run * at;
    const half = cuffHalfAt(cuff, x);
    crease(
      ctx,
      () => {
        ctx.moveTo(x, -half);
        ctx.lineTo(x, half);
      },
      GAUNTLET_RIDGE_WIDTH,
      cuff.ramp,
      1,
      cuff.angle,
    );
  }
}

function paintGauntletRivets(ctx: Ctx, cuff: CuffFrame): void {
  const run = cuff.toX - cuff.fromX;
  const x = cuff.fromX + run * GAUNTLET_RIVET_ROW_AT;
  const half = cuffHalfAt(cuff, x);
  for (const across of GAUNTLET_RIVETS_ACROSS) {
    paintCuffRivet(ctx, cuff, pt(x, half * across), GAUNTLET_RIVET_RADIUS, IRON_RIVET);
  }
}

function paintKnucklePlate(ctx: Ctx, frame: ArmFrame): void {
  const hand = handReachOf(frame);
  if (hand.gripping) return;
  const from = onHand(hand, KNUCKLE_RIDGE_AT, -KNUCKLE_RIDGE_HALF);
  const to = onHand(hand, KNUCKLE_RIDGE_AT, KNUCKLE_RIDGE_HALF);
  ctx.strokeStyle = IRON.rim;
  ctx.lineWidth = KNUCKLE_RIDGE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.fillStyle = IRON_RIVET;
  for (const across of KNUCKLE_RIVETS_ACROSS) {
    const at = onHand(hand, KNUCKLE_RIDGE_AT, across);
    ctx.beginPath();
    ctx.arc(at.x, at.y, KNUCKLE_RIVET_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

function paintGauntlet(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  if (frame.drawn !== drawnSide(GAUNTLET_SIDE, frame.view)) return;
  paintForearmCuff(
    ctx,
    frame,
    GAUNTLET_CUFF,
    IRON,
    (cuff) => paintGauntletRidges(ctx, cuff),
    (cuff) => paintGauntletRivets(ctx, cuff),
  );
  paintKnucklePlate(ctx, frame);
}

export const HUMAN_IRON_KNUCKLE_GAUNTLET = defineGarment({
  id: 'human_iron_knuckle_gauntlet',
  name: 'Iron Knuckle Gauntlet',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['forearm'],
  covers: ['rightHand'],
  gloves: { right: IRON },
  paint: { forearm: humanEveryView(paintGauntlet) },
});

// ── Hearthguard Bracers ──

/**
 * Boiled leather goes hard and tan: a warm brown well under his skin's value
 * and well over a dark sleeve's, so a bracer reads as neither bare arm nor
 * sleeve.
 */
const BOILED_LEATHER: Ramp = {
  deep: '#2a170c',
  shadow: '#45291a',
  dark: '#664026',
  mid: '#875a34',
  base: '#a87547',
  light: '#d6a676',
  rim: '#f2cf9e',
};
/** Bright steel heads, cold against the warm leather so they never read as more of it. */
const BRACER_RIVET = '#f4f1ea';
/** A plate of leather from just below the elbow, up under any sleeve that ends there, to just short of the wrist. */
const BRACER: CuffShape = { from: 0.26, to: 0.94, proudFrom: 0.012, proudTo: 0.012, endBow: 0.4 };
/** Each end is a stiff rolled edge, a band a step darker than the plate. */
const BRACER_EDGE_WIDTH = 0.03;
/** A rivet sits just in from each of the plate's four corners. */
const BRACER_RIVET_IN = 0.07;
const BRACER_RIVET_ACROSS = 0.55;
const BRACER_RIVET_RADIUS = 0.02;

function paintBracerEdges(ctx: Ctx, cuff: CuffFrame): void {
  ctx.strokeStyle = cuff.ramp.dark;
  ctx.lineWidth = BRACER_EDGE_WIDTH;
  ctx.beginPath();
  for (const x of [cuff.fromX, cuff.toX]) {
    const half = cuffHalfAt(cuff, x);
    ctx.moveTo(x, -half);
    ctx.lineTo(x, half);
  }
  ctx.stroke();
}

/**
 * Boiled leather holds a hard lip down each long edge: lit where it turns to
 * the key, dark where it turns away. At the tile those two lines are what
 * make the plate read as a tube against the arm, whatever the skin under it,
 * because tan leather and deep brown skin share a value.
 */
function paintBracerLips(ctx: Ctx, cuff: CuffFrame): void {
  const light = rotate(LIGHT, -cuff.angle);
  const litSide = light.y <= 0 ? -1 : 1;
  ctx.lineWidth = BRACER_LIP_WIDTH;
  ctx.lineCap = 'round';
  for (const [side, colour] of [
    [litSide, inArmShade(cuff.ramp.rim, cuff)],
    [-litSide, cuff.ramp.deep],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(cuff.fromX, side * cuff.fromHalf * BRACER_LIP_ACROSS);
    ctx.lineTo(cuff.toX, side * cuff.toHalf * BRACER_LIP_ACROSS);
    ctx.stroke();
  }
}
/** Each lip runs just inside the plate's long edge, as wide as its rolled ends. */
const BRACER_LIP_ACROSS = 0.72;
const BRACER_LIP_WIDTH = 0.04;

function paintBracerRivets(ctx: Ctx, cuff: CuffFrame): void {
  for (const x of [cuff.fromX + BRACER_RIVET_IN, cuff.toX - BRACER_RIVET_IN]) {
    const half = cuffHalfAt(cuff, x) * BRACER_RIVET_ACROSS;
    for (const across of [-half, half]) {
      paintCuffRivet(ctx, cuff, pt(x, across), BRACER_RIVET_RADIUS, BRACER_RIVET);
    }
  }
}

function paintBracer(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  paintForearmCuff(
    ctx,
    frame,
    BRACER,
    BOILED_LEATHER,
    (cuff) => {
      paintCuffForm(ctx, cuff);
      paintBracerLips(ctx, cuff);
      paintBracerEdges(ctx, cuff);
    },
    (cuff) => paintBracerRivets(ctx, cuff),
  );
}

export const HUMAN_HEARTHGUARD_BRACERS = defineGarment({
  id: 'human_hearthguard_bracers',
  name: 'Hearthguard Bracers',
  wearer: 'human',
  material: 'leather',
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintBracer) },
});
