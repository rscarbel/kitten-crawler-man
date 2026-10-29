/**
 * The safe-room doctor's clothes and kit, painted as attachments on the human
 * rig (`biped/figure.ts`): the dark shirt showing in the open front of a long
 * white coat, the stethoscope round the neck, and the clipboard and pen of
 * the writing row. The coat itself is the rig's torso garment recut long and
 * repainted white by the look (`doctorFigure.ts`).
 *
 * Everything here is drawn in the rig's figure units, in the coordinates the
 * figure is drawn in: head-on that is mirrored from the pose's own (his right
 * on the viewer's left), so a hand is looked up through `drawnSide`.
 *
 * At the 32 px tile the doctor reads by three things in this file and the
 * coat: the white block of the coat, the dark stripe of the open front down
 * its middle, and the dark loop of the stethoscope across the chest. Each is
 * a flat, high-contrast shape rather than modelled detail, which the tile
 * would only smear.
 */

import type { Pt } from './bipedArt';
import type { BipedAttachments } from './biped/figure';
import {
  type BodySide,
  type BoneChain,
  drawnSide,
  type Skeleton,
  type ViewSpec,
} from './biped/rig';
import type { GlossRamp, Ramp } from './biped/palette';
import { HIP_Y, WAIST_Y } from './biped/proportions';
import { castHeadReach, type CastHeadSpec, paintCastHead } from './human/castHead';
import { paintTrouserSeat } from './human/legwear';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * A white cotton coat. The shade side stays a cool grey well above the floor
 * it stands on: shaded down toward the dungeon's dark it reads as a grey coat,
 * not a white one.
 */
export const COAT_CLOTH: GlossRamp = {
  deep: '#6c7682',
  shadow: '#97a2ad',
  dark: '#b5bec7',
  mid: '#cbd3da',
  base: '#dfe5ea',
  light: '#eef2f5',
  rim: '#f8fafc',
  specular: '#ffffff',
};

/** The stethoscope's rubber tubing: near black, so it cuts across the white coat at the tile. */
const TUBING = '#1d1b20';
const TUBING_LIGHT = '#4a4652';
/** The chest piece and ear tips: polished steel. */
const STEEL: Ramp = {
  deep: '#3a4048',
  shadow: '#5d6670',
  dark: '#7f8994',
  mid: '#9aa4ae',
  base: '#b9c2ca',
  light: '#dde3e8',
  rim: '#f4f7f9',
};

/**
 * A hardboard clipboard, the paper on it, the steel clip and the lines
 * written on it. The board is a dark brown and shows as a frame round the
 * paper, which is a warm cream: white paper on the white coat is lost at the tile.
 */
const BOARD = '#5e3c22';
const BOARD_EDGE = '#3a2414';
const PAPER = '#efe3c4';
const PAPER_SHADE = '#c9b994';
const WRITING = '#5a6070';
const PEN = '#1f2a44';
const PEN_TIP = '#c9ced4';

// ── Measurements, in figure units ────────────────────────────────────────────

/** How far below the waist the coat's hem falls: about the knee. */
export const COAT_HEM_DROP = 0.8;

/**
 * The open front of the coat: the dark shirt in a V at the throat, then a
 * narrow stripe where the coat's two fronts part, down to the hem — where it
 * widens a little as the coat swings open below the last button.
 */
const V_HALF_WIDTH = 0.075;
const V_DEPTH = 0.2;
const FRONT_GAP_HALF_AT_WAIST = 0.022;
const FRONT_GAP_HALF_AT_HEM = 0.05;
/** The stripe stops this short of the hem, so it never pokes out under the coat's curved edge. */
const FRONT_GAP_HEM_CLEARANCE = 0.05;
/** The throat of the V sits this far above the shoulder line, under the collar. */
const V_TOP_ABOVE_SHOULDERS = 0.035;
/** The lapel's lit edge either side of the opening. */
const LAPEL_EDGE_WIDTH = 0.018;

/**
 * The stethoscope, round the back of the neck and hanging down the front in
 * two tubes: one ends at the chest piece, the other forks to the ear tips.
 * The tube is drawn thicker than real tubing so that it is a whole pixel at
 * the tile.
 */
const TUBE_WIDTH = 0.05;
const TUBE_HIGHLIGHT_WIDTH = 0.016;
const NECK_HALF_AT_SHOULDERS = 0.085;
const TUBE_TOP_ABOVE_SHOULDERS = 0.01;
/** Where the chest-piece tube ends, from the shoulder centre, on the viewer's right. */
const CHEST_PIECE_AT: Pt = { x: 0.1, y: 0.33 };
const CHEST_PIECE_RADIUS = 0.04;
/** The earpiece tube, on the viewer's left: it forks a little above its end into two ear tips. */
const EAR_FORK_AT: Pt = { x: -0.13, y: 0.22 };
const EAR_TIP_SPREAD = 0.035;
const EAR_TIP_DROP = 0.06;
const EAR_TIP_RADIUS = 0.018;
/** How far the tubes bow outward over the chest between the neck and their ends. */
const TUBE_BOW = 0.05;

/** The clipboard, seen tipped back toward his face, so it draws shorter than it is wide. */
const BOARD_HALF_WIDTH = 0.15;
const BOARD_HALF_HEIGHT = 0.11;
const PAPER_INSET = 0.035;
const CLIP_HALF_WIDTH = 0.04;
const CLIP_HEIGHT = 0.03;
const BOARD_EDGE_WIDTH = 0.012;
/**
 * Where the board's centre sits from the holding hand: inboard of it and well
 * above, so the forearm lies under the board's bottom edge and the hand grips
 * its lower outside corner. Any lower and both forearms cover the whole board.
 */
const BOARD_FROM_HAND: Pt = { x: 0.1, y: -0.14 };
const WRITTEN_LINE_COUNT = 3;
const WRITTEN_LINE_GAP = 0.045;
const WRITTEN_LINE_WIDTH = 0.012;
const WRITTEN_LINE_SHARE = 0.75;

/** The pen, along the writing hand: its butt above the knuckles and its tip just below the fingers. */
const PEN_BUTT_FROM_HAND: Pt = { x: -0.05, y: -0.06 };
const PEN_TIP_FROM_HAND: Pt = { x: 0.03, y: 0.05 };
const PEN_WIDTH = 0.02;
const PEN_TIP_SHARE = 0.85;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Who the attachments dress ────────────────────────────────────────────────

/** What one doctor's attachments are painted in: their own head and dark clothes. */
export interface DoctorDress {
  readonly head: CastHeadSpec;
  readonly shirt: GlossRamp;
  readonly trousers: GlossRamp;
}

/** What a frame of a row has in the doctor's hands, past whatever props the pose holds. */
export interface DoctorKit {
  /** The clipboard is held in his left hand. */
  readonly clipboard: boolean;
  /** The pen is held in his right hand. */
  readonly pen: boolean;
}

export const EMPTY_HANDS: DoctorKit = { clipboard: false, pen: false };

function armOf(skeleton: Skeleton, view: ViewSpec, side: BodySide): BoneChain {
  return drawnSide(side, view) === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/** Which way, on screen, his own `side` lies: head-on his right is on the viewer's left. */
function outboard(view: ViewSpec, side: BodySide): number {
  return drawnSide(side, view) === 'left' ? -1 : 1;
}

/** How much of its length the spine shows on screen: a torso pitched at the camera shortens. */
function spineShare(skeleton: Skeleton): number {
  return (skeleton.hip.y - skeleton.waist.y) / Math.abs(HIP_Y - WAIST_Y);
}

// ── Open front ───────────────────────────────────────────────────────────────

function paintOpenFront(ctx: Ctx, skeleton: Skeleton, dress: DoctorDress): void {
  const top = skeleton.shoulderCentre;
  const waist = skeleton.waist;
  const hemY = waist.y + (COAT_HEM_DROP - FRONT_GAP_HEM_CLEARANCE) * spineShare(skeleton);
  const hemX = mix1(waist.x, skeleton.hip.x, HALF);
  const throatY = top.y - V_TOP_ABOVE_SHOULDERS;
  const vBottom: Pt = { x: top.x, y: top.y + V_DEPTH };

  ctx.beginPath();
  ctx.moveTo(top.x - V_HALF_WIDTH, throatY);
  ctx.lineTo(top.x + V_HALF_WIDTH, throatY);
  ctx.lineTo(vBottom.x + FRONT_GAP_HALF_AT_WAIST, vBottom.y);
  ctx.lineTo(waist.x + FRONT_GAP_HALF_AT_WAIST, waist.y);
  ctx.lineTo(hemX + FRONT_GAP_HALF_AT_HEM, hemY);
  ctx.lineTo(hemX - FRONT_GAP_HALF_AT_HEM, hemY);
  ctx.lineTo(waist.x - FRONT_GAP_HALF_AT_WAIST, waist.y);
  ctx.lineTo(vBottom.x - FRONT_GAP_HALF_AT_WAIST, vBottom.y);
  ctx.closePath();
  ctx.fillStyle = dress.shirt.dark;
  ctx.fill();

  // Below the waist the opening shows the trousers rather than the shirt.
  ctx.beginPath();
  ctx.moveTo(waist.x + FRONT_GAP_HALF_AT_WAIST, waist.y);
  ctx.lineTo(hemX + FRONT_GAP_HALF_AT_HEM, hemY);
  ctx.lineTo(hemX - FRONT_GAP_HALF_AT_HEM, hemY);
  ctx.lineTo(waist.x - FRONT_GAP_HALF_AT_WAIST, waist.y);
  ctx.closePath();
  ctx.fillStyle = dress.trousers.shadow;
  ctx.fill();

  // The lapels' lit edges, so the opening reads as the coat parting and not as a stripe printed on it.
  ctx.strokeStyle = COAT_CLOTH.rim;
  ctx.lineWidth = LAPEL_EDGE_WIDTH;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(top.x + side * V_HALF_WIDTH, throatY);
    ctx.lineTo(vBottom.x + side * FRONT_GAP_HALF_AT_WAIST, vBottom.y);
    ctx.lineTo(waist.x + side * FRONT_GAP_HALF_AT_WAIST, waist.y);
    ctx.lineTo(hemX + side * FRONT_GAP_HALF_AT_HEM, hemY);
    ctx.stroke();
  }
}

function mix1(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Stethoscope ──────────────────────────────────────────────────────────────

function tubePath(ctx: Ctx, from: Pt, to: Pt, bowSide: number): void {
  const control: Pt = {
    x: (from.x + to.x) * HALF + bowSide * TUBE_BOW,
    y: (from.y + to.y) * HALF,
  };
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
}

function steelDot(ctx: Ctx, centre: Pt, radius: number): void {
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, FULL_TURN);
  ctx.fillStyle = STEEL.dark;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    centre.x - radius * HALF * HALF,
    centre.y - radius * HALF * HALF,
    radius * HALF,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = STEEL.light;
  ctx.fill();
}

function paintStethoscope(ctx: Ctx, skeleton: Skeleton): void {
  const top = skeleton.shoulderCentre;
  const tubeTopY = top.y - TUBE_TOP_ABOVE_SHOULDERS;
  const leftTop: Pt = { x: top.x - NECK_HALF_AT_SHOULDERS, y: tubeTopY };
  const rightTop: Pt = { x: top.x + NECK_HALF_AT_SHOULDERS, y: tubeTopY };
  const chestPiece: Pt = { x: top.x + CHEST_PIECE_AT.x, y: top.y + CHEST_PIECE_AT.y };
  const fork: Pt = { x: top.x + EAR_FORK_AT.x, y: top.y + EAR_FORK_AT.y };
  const tips: readonly Pt[] = [
    { x: fork.x - EAR_TIP_SPREAD, y: fork.y + EAR_TIP_DROP },
    { x: fork.x + EAR_TIP_SPREAD, y: fork.y + EAR_TIP_DROP },
  ];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = TUBING;
  ctx.lineWidth = TUBE_WIDTH;
  ctx.beginPath();
  tubePath(ctx, rightTop, chestPiece, 1);
  tubePath(ctx, leftTop, fork, -1);
  ctx.stroke();

  ctx.strokeStyle = STEEL.mid;
  ctx.lineWidth = TUBE_HIGHLIGHT_WIDTH * 2;
  ctx.beginPath();
  for (const tip of tips) {
    ctx.moveTo(fork.x, fork.y);
    ctx.lineTo(tip.x, tip.y);
  }
  ctx.stroke();

  // A lit line along the tubing keeps it a tube and not a crack in the coat.
  ctx.strokeStyle = TUBING_LIGHT;
  ctx.lineWidth = TUBE_HIGHLIGHT_WIDTH;
  ctx.beginPath();
  tubePath(ctx, rightTop, chestPiece, 1);
  ctx.stroke();

  for (const tip of tips) steelDot(ctx, tip, EAR_TIP_RADIUS);
  steelDot(ctx, chestPiece, CHEST_PIECE_RADIUS);
}

// ── Clipboard and pen ────────────────────────────────────────────────────────

function paintClipboard(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const hand = armOf(skeleton, view, 'left').end;
  const inward = -outboard(view, 'left');
  const centre: Pt = { x: hand.x + inward * BOARD_FROM_HAND.x, y: hand.y + BOARD_FROM_HAND.y };
  const left = centre.x - BOARD_HALF_WIDTH;
  const topY = centre.y - BOARD_HALF_HEIGHT;
  const width = BOARD_HALF_WIDTH * 2;
  const height = BOARD_HALF_HEIGHT * 2;

  ctx.fillStyle = BOARD_EDGE;
  ctx.fillRect(
    left - BOARD_EDGE_WIDTH,
    topY - BOARD_EDGE_WIDTH,
    width + BOARD_EDGE_WIDTH * 2,
    height + BOARD_EDGE_WIDTH * 2,
  );
  ctx.fillStyle = BOARD;
  ctx.fillRect(left, topY, width, height);
  ctx.fillStyle = PAPER_SHADE;
  ctx.fillRect(
    left + PAPER_INSET,
    topY + PAPER_INSET,
    width - PAPER_INSET * 2,
    height - PAPER_INSET,
  );
  ctx.fillStyle = PAPER;
  ctx.fillRect(
    left + PAPER_INSET,
    topY + PAPER_INSET,
    width - PAPER_INSET * 2,
    height - PAPER_INSET * 2,
  );

  ctx.strokeStyle = WRITING;
  ctx.lineWidth = WRITTEN_LINE_WIDTH;
  ctx.beginPath();
  for (let line = 1; line <= WRITTEN_LINE_COUNT; line++) {
    const y = topY + CLIP_HEIGHT + line * WRITTEN_LINE_GAP;
    ctx.moveTo(left + PAPER_INSET * 2, y);
    ctx.lineTo(left + PAPER_INSET * 2 + (width - PAPER_INSET * 4) * WRITTEN_LINE_SHARE, y);
  }
  ctx.stroke();

  ctx.fillStyle = STEEL.dark;
  ctx.fillRect(
    centre.x - CLIP_HALF_WIDTH,
    topY - BOARD_EDGE_WIDTH,
    CLIP_HALF_WIDTH * 2,
    CLIP_HEIGHT,
  );
  ctx.fillStyle = STEEL.light;
  ctx.fillRect(
    centre.x - CLIP_HALF_WIDTH,
    topY - BOARD_EDGE_WIDTH,
    CLIP_HALF_WIDTH * 2,
    CLIP_HEIGHT * HALF,
  );
}

function paintPen(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const hand = armOf(skeleton, view, 'right').end;
  const across = outboard(view, 'right');
  const butt: Pt = { x: hand.x + across * PEN_BUTT_FROM_HAND.x, y: hand.y + PEN_BUTT_FROM_HAND.y };
  const tip: Pt = { x: hand.x + across * PEN_TIP_FROM_HAND.x, y: hand.y + PEN_TIP_FROM_HAND.y };
  const nib: Pt = {
    x: butt.x + (tip.x - butt.x) * PEN_TIP_SHARE,
    y: butt.y + (tip.y - butt.y) * PEN_TIP_SHARE,
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = PEN_WIDTH;
  ctx.strokeStyle = PEN;
  ctx.beginPath();
  ctx.moveTo(butt.x, butt.y);
  ctx.lineTo(nib.x, nib.y);
  ctx.stroke();
  ctx.strokeStyle = PEN_TIP;
  ctx.beginPath();
  ctx.moveTo(nib.x, nib.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}

/** The extreme points the clipboard reaches from its hand, for the composing surface. */
function clipboardReach(skeleton: Skeleton, view: ViewSpec): readonly Pt[] {
  const hand = armOf(skeleton, view, 'left').end;
  const inward = -outboard(view, 'left');
  const centre: Pt = { x: hand.x + inward * BOARD_FROM_HAND.x, y: hand.y + BOARD_FROM_HAND.y };
  return [
    { x: centre.x - BOARD_HALF_WIDTH - PAPER_INSET, y: centre.y - BOARD_HALF_HEIGHT - CLIP_HEIGHT },
    { x: centre.x + BOARD_HALF_WIDTH + PAPER_INSET, y: centre.y + BOARD_HALF_HEIGHT + PAPER_INSET },
  ];
}

// ── The attachments ──────────────────────────────────────────────────────────

/**
 * Everything the doctor wears and holds past the rig's recut coat: the
 * trousers' seat, their own hair, the open coat front, the stethoscope, and
 * whatever `kit` this frame has in hand.
 */
export function doctorAttachments(dress: DoctorDress, kit: DoctorKit): BipedAttachments {
  return {
    overLegs: (ctx, skeleton, view) => paintTrouserSeat(ctx, skeleton, view, dress.trousers),
    over: (ctx, skeleton, view, pose) => {
      paintCastHead(ctx, skeleton, view, pose, dress.head);
      if (view.profile || view.showsBack) return;
      paintOpenFront(ctx, skeleton, dress);
      paintStethoscope(ctx, skeleton);
      if (kit.clipboard) paintClipboard(ctx, skeleton, view);
      if (kit.pen) paintPen(ctx, skeleton, view);
    },
    reach: (skeleton, view) => [
      ...castHeadReach(skeleton),
      ...(kit.clipboard ? clipboardReach(skeleton, view) : []),
    ],
  };
}
