/**
 * Deuce, the Desperado Club's blackjack dealer — drawn at runtime like the rest
 * of the club's cast, in two renderings.
 *
 * The **world figure** stands behind the table on the club floor and sweeps a
 * hand across the felt while the table is open. The **portrait** lives inside
 * the panel and is the one the player actually looks at: an upper body with
 * sleeves, a visible shoe, and eyes that track the hand. The portrait carries
 * the character, so it gets the reactions.
 */

import { scaleHumanoidBox } from './humanoidScale';
import type { TablePhase } from '../systems/casino/BlackjackTable';
import type { RoundOutcome } from '../systems/casino/blackjackRules';

/**
 * What Deuce is doing. Driven by the table phase plus the settled outcome, so
 * the portrait always reflects the hand in front of it.
 */
export type DealerState =
  'idle' | 'dealing' | 'flipping' | 'waiting_on_player' | 'concede' | 'smug' | 'impressed' | 'bust';

const TWO_PI = Math.PI * 2;

// Deuce's palette: club green waistcoat over a pressed shirt, gold trim to match
// the table's brass and the club's lettering.
const SKIN = '#caa080';
const SKIN_SHADOW = '#a87f60';
const WAISTCOAT = '#14322a';
const SHIRT = '#ece4d2';
const SHIRT_SHADOW = '#cdc3ac';
const TIE = '#8c2434';
const GOLD = '#e0c060';
const GOLD_DARK = '#9a7f2e';
const HAIR = '#1a1208';
const INK = '#12100c';
const VISOR = '#1f6b4a';
const VISOR_GLASS = 'rgba(80,220,160,0.35)';
const CARD_WHITE = '#f4ecd8';
const CARD_EDGE = '#c8a840';
const PORTRAIT_FELT = 'rgba(8,32,24,0.85)';
/** The back of the hand is a shade deeper than the sleeve, as a real one is. */
const HAND_DEPTH_OF_SLEEVE = 1.05;
/** Index, middle, ring, little — middle longest, as a splayed hand reads. */
const FINGER_LENGTH_FRACTIONS: ReadonlyArray<number> = [0.4, 0.47, 0.43, 0.32];
const FINGER_WIDTH_OF_HAND = 0.2;
const THUMB_WIDTH_OF_HAND = 0.26;
/** How far the fingertips fan out from the knuckles. */
const FINGER_SPLAY = 1.2;
/** Card edges ruled across the squared deck, so it is not a plain white block. */
const DECK_EDGE_LINES = 4;

// ── Motion ──────────────────────────────────────────────────────────────────

/**
 * All motion is timed in **milliseconds**, not frames. Both callers hand this a
 * real clock; rates expressed per-frame here would run at whatever the frame
 * rate happens to be, which is how the breath ended up at roughly two cycles a
 * second and the tapping read as drumming.
 */
const TWO_PI_RADIANS = Math.PI * 2;
/** Neck clearance between the head's centre and the shoulder line. */
const NECK_LENGTH_IN_HEAD_RADII = 1.58;

/** A slow, even breath — a dealer at rest, not a figure vibrating in place. */
const BREATH_PERIOD_MS = 5400;
const BREATH_AMOUNT = 0.007;

/** One unhurried sweep of the dealing hand across the felt. */
const DEAL_SWEEP_PERIOD_MS = 1400;

/**
 * Squaring the deck is a thing a dealer does *now and then*. It fires for a
 * short beat out of a long cycle, so between hands Deuce is mostly still.
 */
const TAP_CYCLE_MS = 12000;
const TAP_ACTIVE_MS = 1100;
/** Half the active window is the hand going out, half is it coming back. */
const TAP_HALF = 0.5;
const TAP_REACH = 0.3;
const HAND_RESTING_REACH = -0.35;

const BLINK_CYCLE_MS = 5200;
const BLINK_MS = 130;
const EYE_CLOSED = 0.08;

function breathAt(phaseMs: number): number {
  return Math.sin((phaseMs / BREATH_PERIOD_MS) * TWO_PI_RADIANS) * BREATH_AMOUNT;
}

function blinkingAt(phaseMs: number): boolean {
  return phaseMs % BLINK_CYCLE_MS < BLINK_MS;
}

/**
 * The resting hand: still for most of the cycle, then one smooth out-and-back
 * squaring of the deck. Eased rather than switched, so it never snaps.
 */
function tapReachAt(phaseMs: number): number {
  const intoCycle = phaseMs % TAP_CYCLE_MS;
  if (intoCycle >= TAP_ACTIVE_MS) return HAND_RESTING_REACH;
  const throughTap = intoCycle / TAP_ACTIVE_MS;
  const eased = Math.sin(throughTap * Math.PI);
  return HAND_RESTING_REACH + (TAP_REACH - HAND_RESTING_REACH) * eased * TAP_HALF * 2;
}

interface DealerMotion {
  /** Vertical breath, as a fraction of the figure box. */
  breath: number;
  /** −1 (drawn back) → 1 (extended over the felt) for the dealing hand. */
  reach: number;
  /** Head tilt as a fraction of the figure box. */
  tilt: number;
  /** 0 closed, 1 wide. */
  eyeOpen: number;
  /** −1 frown, 0 neutral, 1 smile. */
  mouth: number;
  /** How far the brow drops — a raised brow reads as impressed. */
  brow: number;
}

const NEUTRAL_MOUTH = 0;
const SMILE = 1;
const FROWN = -1;

function motionFor(state: DealerState, phaseMs: number): DealerMotion {
  const breath = breathAt(phaseMs);
  const eyeOpen = blinkingAt(phaseMs) ? EYE_CLOSED : 1;

  switch (state) {
    case 'dealing':
      return {
        breath,
        reach: Math.sin((phaseMs / DEAL_SWEEP_PERIOD_MS) * TWO_PI_RADIANS),
        tilt: -0.01,
        eyeOpen,
        mouth: NEUTRAL_MOUTH,
        brow: 0,
      };
    case 'flipping':
      return { breath, reach: 0.7, tilt: 0.01, eyeOpen: 1, mouth: NEUTRAL_MOUTH, brow: -0.1 };
    case 'waiting_on_player':
      return {
        breath,
        reach: tapReachAt(phaseMs),
        tilt: 0.015,
        eyeOpen,
        mouth: NEUTRAL_MOUTH,
        brow: 0,
      };
    case 'concede':
      return { breath, reach: -0.2, tilt: 0.03, eyeOpen: 1, mouth: SMILE * 0.6, brow: 0.15 };
    case 'smug':
      return { breath, reach: -0.4, tilt: -0.02, eyeOpen: 0.75, mouth: SMILE * 0.3, brow: -0.05 };
    case 'impressed':
      return { breath, reach: 0.1, tilt: 0, eyeOpen: 1.25, mouth: SMILE, brow: 0.3 };
    case 'bust':
      return { breath, reach: -0.55, tilt: 0.05, eyeOpen: 1.1, mouth: FROWN * 0.5, brow: 0.25 };
    case 'idle':
      return {
        breath,
        reach: tapReachAt(phaseMs),
        tilt: 0,
        eyeOpen,
        mouth: NEUTRAL_MOUTH,
        brow: 0,
      };
  }
}

// ── The face ────────────────────────────────────────────────────────────────

/**
 * Head, hair, eyeshade and expression, centred on (cx, cy) with radius `r`.
 * `lookX`/`lookY` run −1→1 and aim the pupils, which is what makes Deuce look
 * *at* the hand on the felt rather than through it.
 *
 * The eyeshade sits on the brow with the eyes fully visible underneath. Drawn
 * across them it stopped reading as a dealer's visor and started reading as a
 * mask over the face.
 */
function drawDeuceHead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  motion: DealerMotion,
  lookX: number,
  lookY: number,
): void {
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.86, r, 0, 0, TWO_PI);
  ctx.fill();

  // Hair over the crown and down the temples, drawn on top of the face so it
  // actually shows — a backing ellipse behind a same-sized head is invisible.
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.34, r * 0.87, r * 0.62, 0, Math.PI, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.74, cy - r * 0.12, r * 0.14, r * 0.3, 0, 0, TWO_PI);
  ctx.ellipse(cx + r * 0.74, cy - r * 0.12, r * 0.14, r * 0.3, 0, 0, TWO_PI);
  ctx.fill();

  // Ears, which do most of the work of making a bare oval read as a head.
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.84, cy + r * 0.1, r * 0.11, r * 0.17, 0, 0, TWO_PI);
  ctx.ellipse(cx + r * 0.84, cy + r * 0.1, r * 0.11, r * 0.17, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = SKIN_SHADOW;
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.beginPath();
  ctx.arc(cx - r * 0.84, cy + r * 0.1, r * 0.06, Math.PI * 0.4, Math.PI * 1.6);
  ctx.arc(cx + r * 0.84, cy + r * 0.1, r * 0.06, Math.PI * 1.4, Math.PI * 0.6);
  ctx.stroke();

  const eyeY = cy + r * 0.06;
  const eyeDX = r * 0.34;
  const eyeR = r * 0.125 * motion.eyeOpen;

  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.ellipse(cx - eyeDX, eyeY, r * 0.155, Math.max(r * 0.02, eyeR), 0, 0, TWO_PI);
  ctx.ellipse(cx + eyeDX, eyeY, r * 0.155, Math.max(r * 0.02, eyeR), 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = INK;
  const pupilDX = lookX * r * 0.07;
  const pupilDY = lookY * r * 0.04;
  const pupilR = Math.max(r * 0.02, r * 0.065 * motion.eyeOpen);
  ctx.beginPath();
  ctx.arc(cx - eyeDX + pupilDX, eyeY + pupilDY, pupilR, 0, TWO_PI);
  ctx.arc(cx + eyeDX + pupilDX, eyeY + pupilDY, pupilR, 0, TWO_PI);
  ctx.fill();

  // Brows carry most of the expression at small sizes.
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.lineCap = 'round';
  const browY = eyeY - r * 0.26 - motion.brow * r * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx - eyeDX - r * 0.18, browY + motion.brow * r * 0.06);
  ctx.lineTo(cx - eyeDX + r * 0.16, browY - motion.brow * r * 0.04);
  ctx.moveTo(cx + eyeDX - r * 0.16, browY - motion.brow * r * 0.04);
  ctx.lineTo(cx + eyeDX + r * 0.18, browY + motion.brow * r * 0.06);
  ctx.stroke();

  // Nose, then the moustache under it — Deuce's most recognisable feature.
  ctx.strokeStyle = SKIN_SHADOW;
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + r * 0.1);
  ctx.lineTo(cx, cy + r * 0.36);
  ctx.stroke();

  ctx.strokeStyle = HAIR;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy + r * 0.5);
  ctx.quadraticCurveTo(cx, cy + r * 0.42, cx + r * 0.3, cy + r * 0.5);
  ctx.stroke();

  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.06);
  const mouthY = cy + r * 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.2, mouthY);
  ctx.quadraticCurveTo(cx, mouthY + motion.mouth * r * 0.18, cx + r * 0.2, mouthY);
  ctx.stroke();

  drawEyeshade(ctx, cx, cy - r * 0.44, r);
}

/**
 * The green eyeshade: a band around the head with a translucent brim angled out
 * over the brow. The brim projects forward and downward *in front of* the face
 * rather than lying across it, which is what makes it read as headwear.
 */
function drawEyeshade(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Seen head-on, a real visor's brim is deeply foreshortened — it is a shallow
  // crescent under the band, not a plate hanging over the face. Drawn any
  // deeper it stops reading as headwear and starts reading as a sleep mask.
  ctx.fillStyle = VISOR_GLASS;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.94, cy + r * 0.04);
  ctx.quadraticCurveTo(cx, cy + r * 0.34, cx + r * 0.94, cy + r * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = VISOR;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();

  // The band, wrapping the forehead above the brows.
  ctx.fillStyle = VISOR;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.9, cy + r * 0.06);
  ctx.quadraticCurveTo(cx, cy - r * 0.16, cx + r * 0.9, cy + r * 0.06);
  ctx.lineTo(cx + r * 0.9, cy - r * 0.1);
  ctx.quadraticCurveTo(cx, cy - r * 0.32, cx - r * 0.9, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.stroke();
}

/**
 * The neck. Drawn before the torso so the collar and lapels close over its
 * base, and tapered outward into the shoulders — a straight rectangle laid over
 * the shirt reads as a plank stuck to the chest, because its bottom edge is a
 * visible horizontal line where no edge belongs.
 */
function drawNeck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  jawY: number,
  baseY: number,
  r: number,
): void {
  const topHalf = r * 0.36;
  const baseHalf = r * 0.62;

  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(cx - topHalf, jawY);
  ctx.lineTo(cx + topHalf, jawY);
  ctx.quadraticCurveTo(cx + topHalf, baseY - r * 0.2, cx + baseHalf, baseY);
  ctx.lineTo(cx - baseHalf, baseY);
  ctx.quadraticCurveTo(cx - topHalf, baseY - r * 0.2, cx - topHalf, jawY);
  ctx.closePath();
  ctx.fill();

  // The jaw casts down onto the neck; without it the two skin shapes merge.
  ctx.fillStyle = SKIN_SHADOW;
  ctx.beginPath();
  ctx.ellipse(cx, jawY, topHalf, r * 0.2, 0, 0, Math.PI);
  ctx.fill();
}

// ── The portrait ────────────────────────────────────────────────────────────

export interface DealerPortraitOpts {
  /** −1→1 horizontal aim for the pupils; the panel points them at the player's hand. */
  lookX?: number;
  lookY?: number;
  /** Draw the squared deck under the resting hand; false for the compact bust. */
  showDeck?: boolean;
}

/**
 * Deuce from the chest up, filling the rect (x, y, w, h). Everything scales off
 * the rect, so the wide panel's tall portrait and the compact header's little
 * bust are the same drawing at two sizes.
 */
export function drawDeucePortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  state: DealerState,
  phaseMs: number,
  opts: DealerPortraitOpts = {},
): void {
  const motion = motionFor(state, phaseMs);
  const cx = x + w / 2;
  // The figure is sized off the shorter axis so a tall narrow column and a
  // square bust both frame the head the same way.
  const unit = Math.min(w, h * 0.72);
  const headR = unit * 0.21;
  const headCY = y + h * 0.26 + motion.breath * h;
  // Enough clearance under the jaw for a neck; with the shoulders any closer the
  // head sits straight on the collar.
  const shoulderY = headCY + headR * NECK_LENGTH_IN_HEAD_RADII;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Neck first: everything the torso draws — collar, lapels, tie — has to sit
  // over its base, or the neck ends in a hard edge across the shirt.
  drawNeck(ctx, cx, headCY + headR * 0.74, shoulderY + headR * 0.55, headR);

  // Torso: the waistcoat is the body, with a shirt V and tie cut out of it.
  // Filling shirt first and laying panels over it left a pale dome across the
  // chest that read as neither collar nor lapel.
  const shoulderHalf = unit * 0.58;
  ctx.fillStyle = WAISTCOAT;
  ctx.beginPath();
  ctx.moveTo(cx - shoulderHalf, y + h);
  ctx.lineTo(cx - shoulderHalf * 0.94, shoulderY);
  ctx.quadraticCurveTo(cx, shoulderY - headR * 0.34, cx + shoulderHalf * 0.94, shoulderY);
  ctx.lineTo(cx + shoulderHalf, y + h);
  ctx.closePath();
  ctx.fill();

  const shirtV = headR * 0.9;
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.moveTo(cx - shirtV, shoulderY - headR * 0.2);
  ctx.lineTo(cx + shirtV, shoulderY - headR * 0.2);
  ctx.lineTo(cx, shoulderY + headR * 1.5);
  ctx.closePath();
  ctx.fill();

  // Gold lapel edges tracing the V — the waistcoat's only bright line.
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = Math.max(1, unit * 0.016);
  ctx.beginPath();
  ctx.moveTo(cx - shirtV, shoulderY - headR * 0.2);
  ctx.lineTo(cx, shoulderY + headR * 1.5);
  ctx.lineTo(cx + shirtV, shoulderY - headR * 0.2);
  ctx.stroke();

  // Collar, then the tie hanging out of it.
  ctx.fillStyle = SHIRT_SHADOW;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 0.6, shoulderY - headR * 0.24);
  ctx.lineTo(cx, shoulderY + headR * 0.34);
  ctx.lineTo(cx + headR * 0.6, shoulderY - headR * 0.24);
  ctx.lineTo(cx + headR * 0.36, shoulderY - headR * 0.34);
  ctx.lineTo(cx - headR * 0.36, shoulderY - headR * 0.34);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = TIE;
  ctx.beginPath();
  ctx.moveTo(cx, shoulderY - headR * 0.02);
  ctx.lineTo(cx + headR * 0.2, shoulderY + headR * 0.3);
  ctx.lineTo(cx + headR * 0.13, y + h);
  ctx.lineTo(cx - headR * 0.13, y + h);
  ctx.lineTo(cx - headR * 0.2, shoulderY + headR * 0.3);
  ctx.closePath();
  ctx.fill();

  drawSleevesAndHands(ctx, cx, unit, motion, x, y, w, h, opts.showDeck !== false);
  drawDeuceHead(
    ctx,
    cx + motion.tilt * unit,
    headCY,
    headR,
    motion,
    opts.lookX ?? 0,
    opts.lookY ?? 0,
  );

  ctx.restore();
}

/**
 * The forearms across the bottom of the frame, resting on the felt.
 *
 * Drawn as one horizontal band of rolled sleeve with flat hands on it rather
 * than two arms hanging down: a dealer at a table has their forearms *on* the
 * baize. The right hand tracks `motion.reach`, which is what makes the portrait
 * look like it is working the table rather than posing for it.
 */
function drawSleevesAndHands(
  ctx: CanvasRenderingContext2D,
  cx: number,
  unit: number,
  motion: DealerMotion,
  x: number,
  y: number,
  w: number,
  h: number,
  showDeck: boolean,
): void {
  const forearmY = y + h * 0.84;
  const forearmThickness = unit * 0.115;
  const reachSpan = w * 0.14;

  // The felt strip the forearms rest on, so the band reads as a table edge
  // rather than a bar floating across the figure.
  ctx.fillStyle = PORTRAIT_FELT;
  ctx.fillRect(x, forearmY - forearmThickness, w, y + h - forearmY + forearmThickness);
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = Math.max(1, unit * 0.012);
  ctx.beginPath();
  ctx.moveTo(x, forearmY - forearmThickness);
  ctx.lineTo(x + w, forearmY - forearmThickness);
  ctx.stroke();

  const restingHandX = cx - unit * 0.26;
  const dealingHandX = cx + unit * 0.28 + motion.reach * reachSpan;

  /** One forearm running in from the frame edge to a hand on the felt. */
  const drawForearm = (handX: number, outerX: number, garterX: number): void => {
    ctx.strokeStyle = SHIRT;
    ctx.lineWidth = forearmThickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(outerX, forearmY + forearmThickness * 0.5);
    ctx.lineTo(handX, forearmY);
    ctx.stroke();

    // Gold sleeve garter — the dealer's tell, banded across the sleeve.
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = unit * 0.018;
    ctx.beginPath();
    ctx.moveTo(garterX, forearmY - forearmThickness * 0.42);
    ctx.lineTo(garterX, forearmY + forearmThickness * 0.42);
    ctx.stroke();

    drawHand(ctx, handX, forearmY, unit, forearmThickness, handX > cx ? 1 : -1);
  };

  drawForearm(restingHandX, x - unit * 0.05, restingHandX - unit * 0.2);
  drawForearm(dealingHandX, x + w + unit * 0.05, dealingHandX + unit * 0.2);

  // The squared deck sits between the hands, on top of the sleeves — anywhere
  // outboard of a hand and the sleeve, drawn after it, buries it.
  if (showDeck) drawSquaredDeck(ctx, cx, forearmY - unit * 0.02, unit);
}

/**
 * A hand lying flat on the felt, fingers pointing inward and the thumb tucked
 * toward the viewer.
 *
 * Drawn in a local space with the fingers pointing +x and mirrored into place,
 * so the geometry reads as a hand rather than as two mirrored special cases. The
 * back of the hand is as deep as the sleeve is thick: a hand narrower than the
 * cuff it comes out of reads as a stump.
 */
function drawHand(
  ctx: CanvasRenderingContext2D,
  handX: number,
  handY: number,
  unit: number,
  sleeveThickness: number,
  fingerDir: number,
): void {
  const backDepth = sleeveThickness * HAND_DEPTH_OF_SLEEVE;
  const backHalf = backDepth * 0.5;
  const backBack = -backDepth * 0.55;
  const knuckleX = backDepth * 0.42;

  ctx.save();
  ctx.translate(handX, handY);
  // fingerDir is +1 for the hand on the right of the frame, whose fingers point
  // left; mirroring lets the drawing below always point them right.
  ctx.scale(-fingerDir, 1);

  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(backBack, -backHalf);
  ctx.lineTo(knuckleX * 0.7, -backHalf * 0.92);
  ctx.quadraticCurveTo(knuckleX, 0, knuckleX * 0.7, backHalf * 0.92);
  ctx.lineTo(backBack, backHalf);
  ctx.quadraticCurveTo(backBack - backHalf * 0.5, 0, backBack, -backHalf);
  ctx.closePath();
  ctx.fill();

  // Fingers: middle longest, little shortest, splayed slightly.
  ctx.strokeStyle = SKIN;
  ctx.lineCap = 'round';
  FINGER_LENGTH_FRACTIONS.forEach((lengthFraction, finger) => {
    const acrossHand = (finger / (FINGER_LENGTH_FRACTIONS.length - 1) - 0.5) * backDepth * 0.62;
    const length = backDepth * lengthFraction;
    ctx.lineWidth = backDepth * FINGER_WIDTH_OF_HAND;
    ctx.beginPath();
    ctx.moveTo(knuckleX * 0.6, acrossHand);
    ctx.lineTo(knuckleX * 0.6 + length, acrossHand * FINGER_SPLAY);
    ctx.stroke();
  });

  // The thumb sits off the near edge, shorter and thicker than a finger.
  ctx.lineWidth = backDepth * THUMB_WIDTH_OF_HAND;
  ctx.beginPath();
  ctx.moveTo(backBack * 0.5, backHalf * 0.5);
  ctx.lineTo(knuckleX * 0.5, backHalf * 1.65);
  ctx.stroke();

  // Knuckle line, so the back of the hand does not read as a flat paddle.
  ctx.strokeStyle = SKIN_SHADOW;
  ctx.lineWidth = Math.max(1, unit * 0.007);
  ctx.beginPath();
  ctx.moveTo(knuckleX * 0.6, -backHalf * 0.7);
  ctx.lineTo(knuckleX * 0.6, backHalf * 0.7);
  ctx.stroke();

  ctx.restore();
}

/**
 * The squared deck under Deuce's resting hand — a neat block of card edges. It
 * replaces the card shoe that used to sit in this corner: at portrait size an
 * angled box behind a hand read as an unidentifiable object attached to it.
 */
function drawSquaredDeck(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  feltY: number,
  unit: number,
): void {
  const deckW = unit * 0.16;
  const deckH = unit * 0.085;
  const left = centreX - deckW * 0.5;
  const top = feltY - deckH * 0.35;

  ctx.fillStyle = CARD_WHITE;
  ctx.fillRect(left, top, deckW, deckH);
  ctx.strokeStyle = CARD_EDGE;
  ctx.lineWidth = Math.max(1, unit * 0.01);
  ctx.strokeRect(left, top, deckW, deckH);

  // A few card edges, which is what tells a white block from a deck.
  ctx.strokeStyle = SKIN_SHADOW;
  ctx.lineWidth = Math.max(1, unit * 0.006);
  for (let edge = 1; edge < DECK_EDGE_LINES; edge++) {
    const edgeY = top + (deckH * edge) / DECK_EDGE_LINES;
    ctx.beginPath();
    ctx.moveTo(left + unit * 0.012, edgeY);
    ctx.lineTo(left + deckW - unit * 0.012, edgeY);
    ctx.stroke();
  }
}

// ── The world figure ────────────────────────────────────────────────────────

/**
 * Deuce standing at the table on the club floor, sized to a `s`-pixel tile box
 * exactly like the other club NPCs. `dealing` sweeps the working hand across the
 * felt while the table is open; otherwise the figure rests. `phaseMs` is a real
 * millisecond clock, like the portrait's.
 */
export function drawCasinoDealer(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phaseMs: number,
  dealing: boolean,
): void {
  const box = scaleHumanoidBox(sx, sy, s);
  const figureX = box.sx;
  const figureY = box.sy;
  const size = box.s;
  const cx = figureX + size * 0.5;
  const motion = motionFor(dealing ? 'dealing' : 'idle', phaseMs);
  const bodyY = figureY - motion.breath * size;

  ctx.save();

  const hipY = bodyY + size * 0.62;
  const shoulderY = bodyY + size * 0.4;

  // Legs.
  ctx.strokeStyle = '#141018';
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * size * 0.09, hipY);
    ctx.lineTo(cx + dir * size * 0.09, hipY + size * 0.24);
    ctx.stroke();
  }

  // Shirt torso with the waistcoat over it.
  const torsoW = size * 0.32;
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.moveTo(cx - torsoW / 2, shoulderY);
  ctx.lineTo(cx + torsoW / 2, shoulderY);
  ctx.lineTo(cx + torsoW * 0.42, hipY);
  ctx.lineTo(cx - torsoW * 0.42, hipY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = WAISTCOAT;
  ctx.fillRect(cx - torsoW / 2, shoulderY, torsoW * 0.34, hipY - shoulderY);
  ctx.fillRect(cx + torsoW * 0.16, shoulderY, torsoW * 0.34, hipY - shoulderY);
  ctx.fillStyle = TIE;
  ctx.fillRect(cx - size * 0.018, shoulderY, size * 0.036, (hipY - shoulderY) * 0.7);
  ctx.fillStyle = GOLD;
  ctx.fillRect(cx - torsoW / 2, shoulderY, torsoW, size * 0.012);

  // Arms — the right one sweeps across the felt while dealing.
  const armLen = size * 0.28;
  const drawArm = (dir: number, reach: number): void => {
    const shX = cx + dir * torsoW * 0.5;
    const handX = shX + dir * armLen * (0.5 + reach * 0.45);
    const handY = shoulderY + armLen * (0.75 - reach * 0.2);
    ctx.strokeStyle = SHIRT;
    ctx.lineWidth = size * 0.085;
    ctx.beginPath();
    ctx.moveTo(shX, shoulderY + size * 0.02);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = size * 0.018;
    ctx.beginPath();
    ctx.moveTo(shX + dir * armLen * 0.28, shoulderY + size * 0.05);
    ctx.lineTo(handX - dir * armLen * 0.18, handY - size * 0.02);
    ctx.stroke();
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(handX, handY, size * 0.055, 0, TWO_PI);
    ctx.fill();
  };
  drawArm(-1, -0.2);
  drawArm(1, Math.max(0, motion.reach));

  drawNeck(ctx, cx, bodyY + size * 0.34, shoulderY + size * 0.01, size * 0.13);
  drawDeuceHead(ctx, cx, bodyY + size * 0.24, size * 0.13, motion, 0, 0.2);
  ctx.restore();
}

/** Which portrait state a phase and outcome imply, so callers don't hand-roll the mapping. */
export function dealerStateFor(
  phase: TablePhase,
  outcomeKind: RoundOutcome['kind'] | null,
  dealerBusted: boolean,
  holeRevealed: boolean,
): DealerState {
  switch (phase) {
    case 'dealing':
      return 'dealing';
    case 'player_turn':
      return 'waiting_on_player';
    case 'dealer_turn':
      return holeRevealed ? 'dealing' : 'flipping';
    case 'settled':
      if (dealerBusted) return 'bust';
      if (outcomeKind === 'player_blackjack') return 'impressed';
      if (outcomeKind === 'player_win') return 'concede';
      if (outcomeKind === 'dealer_win') return 'smug';
      return 'idle';
    case 'betting':
    case 'turned_away':
      return 'idle';
  }
}
