/**
 * The Gilded Monocle on the human crawler: one heavy gold ring over his right
 * eye with a glint on its lens, and a fine gold chain falling from it down
 * his cheek to his collar.
 *
 * At the tile his eye is about a pixel, so what is legible is the ring — a
 * bright gold dot ringed in near-black over one eye only, which is what
 * tells it from spectacles — and its white glint. The chain is a pixel-wide
 * gold thread at best and reads only as a glimmer down the jaw; it is there
 * for the larger bakes and the portrait.
 */

import type { BipedHeadFrame } from '../../art/biped/bipedParts';
import { FACE_FEATURES, withFacePlane } from '../../art/biped/head';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from '../../art/biped/proportions';
import { type Pt } from '../../art/bipedArt';
import { GOLD, metalFill, paintGlint } from '../cat/metalInk';
import { defineGarment } from '../garmentDef';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const GLASS = 'rgba(214,236,250,0.8)';
const OUTER_EDGE = '#1c1204';

/** The ring is a touch wider than his eye, so the gold sits on the brow and cheek round it. */
const LENS_RADIUS = 0.036;
/** The rim is heavy: at the tile one gold ring is the whole read. */
const RIM_WIDTH = 0.03;
const OUTER_EDGE_WIDTH = 0.014;
const CHAIN_WIDTH = 0.007;
/** The chain's links: dashes of gold along it, so it reads as chain rather than wire. */
const LINK_LENGTH = 0.014;
const LINK_GAP = 0.008;
const GLINT_REACH = 0.045;
/** The glint sits high on the rim toward the light. */
const GLINT_ANGLE = -2.3;
/** Where the chain leaves the rim, as an angle round it: low on its outer side. */
const CHAIN_LEAVES_AT = 2.2;

/**
 * Head-on the monocle is over his right eye, on screen-left, and its chain
 * falls outside that cheek past the jaw corner to where his chin meets the
 * collar. Fractions of the head's half-width across and half-height down.
 */
const FACING_CHAIN_SAG: Pt = { x: -1.12, y: 0.75 };
const FACING_CHAIN_END: Pt = { x: -0.8, y: 1.3 };
/** Edge-on the lens is seen steeply, and the chain falls back along his jaw to under it. */
const PROFILE_SQUASH = 0.55;
const PROFILE_CHAIN_SAG: Pt = { x: 0.2, y: 0.85 };
const PROFILE_CHAIN_END: Pt = { x: -0.15, y: 1.18 };

function strokeChain(ctx: Ctx, from: Pt, sag: Pt, to: Pt): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(sag.x, sag.y, to.x, to.y);
  ctx.strokeStyle = GOLD.shadow;
  ctx.lineWidth = CHAIN_WIDTH + OUTER_EDGE_WIDTH / 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([LINK_LENGTH, LINK_GAP]);
  ctx.strokeStyle = GOLD.base;
  ctx.lineWidth = CHAIN_WIDTH;
  ctx.stroke();
  ctx.restore();
}

function paintRim(ctx: Ctx, at: Pt, squash: number): void {
  const r = LENS_RADIUS;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(squash, 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, FULL_TURN);
  ctx.fillStyle = GLASS;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r + RIM_WIDTH / 2, 0, FULL_TURN);
  ctx.strokeStyle = OUTER_EDGE;
  ctx.lineWidth = OUTER_EDGE_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, FULL_TURN);
  ctx.strokeStyle = metalFill(ctx, GOLD, -r, -r, r, r);
  ctx.lineWidth = RIM_WIDTH;
  ctx.stroke();
  paintGlint(ctx, GOLD, Math.cos(GLINT_ANGLE) * r, Math.sin(GLINT_ANGLE) * r, GLINT_REACH);
  ctx.restore();
}

/** The point on the rim where the chain leaves it; `mirror` −1 turns its outer side toward −X. */
function chainStart(at: Pt, squash: number, mirror: number): Pt {
  return {
    x: at.x + mirror * Math.cos(CHAIN_LEAVES_AT) * LENS_RADIUS * squash,
    y: at.y + Math.sin(CHAIN_LEAVES_AT) * LENS_RADIUS,
  };
}

function paintFacing(ctx: Ctx): void {
  const eye = { x: -FACE_FEATURES.eyeDx, y: FACE_FEATURES.eyeY };
  strokeChain(
    ctx,
    chainStart(eye, 1, -1),
    { x: HEAD_RX * FACING_CHAIN_SAG.x, y: HEAD_RY * FACING_CHAIN_SAG.y },
    { x: HEAD_RX * FACING_CHAIN_END.x, y: HEAD_RY * FACING_CHAIN_END.y },
  );
  paintRim(ctx, eye, 1);
}

function paintProfile(ctx: Ctx): void {
  const eye = { x: FACE_FEATURES.profileEyeX, y: FACE_FEATURES.eyeY };
  strokeChain(
    ctx,
    chainStart(eye, PROFILE_SQUASH, -1),
    { x: HEAD_DEPTH * PROFILE_CHAIN_SAG.x, y: HEAD_RY * PROFILE_CHAIN_SAG.y },
    { x: HEAD_DEPTH * PROFILE_CHAIN_END.x, y: HEAD_RY * PROFILE_CHAIN_END.y },
  );
  paintRim(ctx, eye, PROFILE_SQUASH);
}

/** From behind the monocle is hidden by his head, and so is its chain. */
function paintHead(ctx: Ctx, frame: BipedHeadFrame): void {
  if (frame.view.showsBack) return;
  if (frame.view.profile) {
    paintProfile(ctx);
    return;
  }
  withFacePlane(ctx, frame.pose, frame.view, () => paintFacing(ctx));
}

export const HUMAN_GILDED_MONOCLE = defineGarment({
  id: 'human_gilded_monocle',
  name: 'Gilded Monocle',
  wearer: 'human',
  material: 'jewelry',
  layer: 'outer',
  region: ['head'],
  paint: { head: humanEveryView(paintHead) },
});
