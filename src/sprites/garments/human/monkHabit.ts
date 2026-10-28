/**
 * Brother Anselm's habit: an undyed wool robe from his throat to his
 * ankles, long-sleeved, its hood thrown back round his neck, girt at the
 * waist with a hemp rope whose knotted ends hang at his left hip; and the
 * plain leather sandals under it.
 *
 * The robe is painted as the wearer's own body in wool, so it bends where he
 * does: the torso and long sleeves through the torso part, the cloth over
 * each leg through the leg part, the seat between them through the hips, and
 * the skirt that closes the gap between his legs through the back part —
 * behind his legs head-on and edge-on, so a stride opens the robe round the
 * forward leg, and over them from behind. At the tile it is one grey-brown
 * column from shoulders to ankles with a pale rope across the middle and a
 * roll of hood under the chin.
 */

import type {
  BipedBackFrame,
  BipedHipsFrame,
  BipedLegFrame,
  BipedTorsoFrame,
} from '../../art/biped/bipedParts';
import { deriveRamp } from '../../art/biped/palette';
import type { TorsoFrame } from '../../art/biped/torso';
import { paintTrouserSeat, RIG_SEAT } from '../../art/human/legwear';
import { rgba, type Pt } from '../../art/bipedArt';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { coatSkirt, paintSkirt, skirtPieceIs, type SkirtCut } from './coatSkirt';
import { BOOT_SOLE, type BootLook, paintBootOnLeg } from './footwear';
import { paintBackHood, paintBackHoodRim, paintFacingHood, paintProfileHood } from './hoodDown';
import { skirtFrame } from './hipSkirt';
import {
  tracePolygon,
  matteRamp,
  paintCoverBody,
  strokeLine,
  withDeepShade,
  withinTorso,
} from './torsoCover';
import { paintLegCloth } from './townsfolkLegwear';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Undyed wool, the grey-brown of the fleece it was spun from: a step lighter
 * than the dungeon floor, so the robe stands off it, and well under the
 * pale ash of his staff, so the pole shows across it.
 */
export const MONK_WOOL = withDeepShade(matteRamp('#75614d'));
const HEMP = '#d9c49a';
const HEMP_SHADE = '#8f7a55';

/** Wool folds deep and soft, between leather's and a shirt's. */
const WOOL_FOLD_WEIGHT = 0.7;
const WOOL_SEAM_WEIGHT = 0.35;

/**
 * The sleeves run down to just short of his wrists and end in a loose
 * turned-back cuff, wide around the forearm: a robe's sleeve, not a shirt's.
 */
const SLEEVE_TO_WRIST = 0.82;
const ROBE_CUFF_BULK = 2.6;
const ROBE_SLEEVE_PADDING = 0.7;
/** Wool lies softer on the arm than padded leather's crisp cylinder. */
const WOOL_SLEEVE_CONTRAST = 0.7;

// ── The rope belt ────────────────────────────────────────────────────────────

/** The rope sits at the waist, as thick as a finger. */
const ROPE_HALF = 0.024;
/** Past his sides, so the torso's clip, not the band's end, finishes it. */
const ROPE_OVERREACH = 0.6;
/** The twist: short dark slants laid along the rope. */
const TWIST_PITCH = 0.045;
const TWIST_SLANT = 0.02;
const TWIST_WIDTH = 0.01;
const TWIST_ALPHA = 0.7;
/** The knot's lit face, a share of its radius, over its shaded bulk. */
const TWIST_HIGHLIGHT_SHARE = 0.65;
/** The knot at his left hip, as drawn head-on, and from behind on the same side of him. */
const KNOT_ACROSS = 0.13;
const KNOT_RADIUS = 0.034;
/** Edge-on the knot shows on the front of his waist. */
const PROFILE_KNOT_ACROSS = 0.15;

function ropeBand(ctx: Ctx, torso: TorsoFrame, across: number): void {
  const y = torso.waistY;
  strokeLine(
    ctx,
    [torso.at(-across, y), torso.at(across, y)],
    HEMP_SHADE,
    ROPE_HALF * 2 + TWIST_WIDTH,
  );
  strokeLine(ctx, [torso.at(-across, y), torso.at(across, y)], HEMP, ROPE_HALF * 2);
  ctx.strokeStyle = rgba(HEMP_SHADE, TWIST_ALPHA);
  ctx.lineWidth = TWIST_WIDTH;
  ctx.beginPath();
  for (let x = -across; x <= across; x += TWIST_PITCH) {
    const from = torso.at(x, y - ROPE_HALF);
    const to = torso.at(x + TWIST_SLANT, y + ROPE_HALF);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
}

function paintKnot(ctx: Ctx, at: Pt): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, KNOT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = HEMP_SHADE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(at.x, at.y, KNOT_RADIUS * TWIST_HIGHLIGHT_SHARE, 0, Math.PI * 2);
  ctx.fillStyle = HEMP;
  ctx.fill();
}

/** Which way across the torso frame his own left lies in a view: head-on the front view is a mirror. */
function leftHipAcross(frame: BipedTorsoFrame): number {
  return frame.view.mirrored ? KNOT_ACROSS : -KNOT_ACROSS;
}

// ── Torso ────────────────────────────────────────────────────────────────────

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  paintCoverBody(ctx, frame, context, MONK_WOOL, {
    foldWeight: WOOL_FOLD_WEIGHT,
    seamWeight: WOOL_SEAM_WEIGHT,
  });
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    ropeBand(ctx, torso, ROPE_OVERREACH);
    if (view.showsBack) paintBackHood(ctx, torso, MONK_WOOL);
  });
  if (view.profile) {
    paintKnot(ctx, torso.at(PROFILE_KNOT_ACROSS * torso.cut.profileDepth, torso.waistY));
    paintProfileHood(ctx, torso, MONK_WOOL);
    return;
  }
  paintKnot(ctx, torso.at(leftHipAcross(frame), torso.waistY));
}

function paintCollar(ctx: Ctx, frame: BipedTorsoFrame): void {
  const { torso, view } = frame;
  if (view.profile) return;
  if (view.showsBack) {
    paintBackHoodRim(ctx, torso, view, MONK_WOOL);
    return;
  }
  paintFacingHood(ctx, frame, MONK_WOOL);
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
}

// ── Below the waist ──────────────────────────────────────────────────────────

/** The rope's two ends hang from the knot to above his knee, a little apart, each tied off in a knot. */
const CORD_DROP_BELOW_HIP = 0.32;
const CORD_SPREAD = 0.025;
const CORD_SWING = 0.02;
const CORD_WIDTH = 0.022;
const CORD_END_KNOT = 0.026;

/** The hanging ends of the rope, painted over the seat so they lie over the robe's skirt below the waist. */
function paintCordEnds(ctx: Ctx, frame: BipedHipsFrame): void {
  const { view } = frame;
  if (view.showsBack) return;
  const { place } = skirtFrame(frame, CORD_DROP_BELOW_HIP);
  const across = view.profile
    ? PROFILE_KNOT_ACROSS * frame.look.garmentCut.profileDepth
    : view.mirrored
      ? KNOT_ACROSS
      : -KNOT_ACROSS;
  for (const offset of [-CORD_SPREAD, CORD_SPREAD]) {
    const top = place(across, 0);
    const end = place(across + offset + CORD_SWING * Math.sign(offset), 1);
    strokeLine(ctx, [top, end], HEMP_SHADE, CORD_WIDTH + TWIST_WIDTH);
    strokeLine(ctx, [top, end], HEMP, CORD_WIDTH);
    ctx.beginPath();
    ctx.arc(end.x, end.y, CORD_END_KNOT, 0, Math.PI * 2);
    ctx.fillStyle = HEMP_SHADE;
    ctx.fill();
  }
}

/**
 * Head-on and from behind the robe over his hips is a panel from his waist to
 * below the crotch, lit across like the column below it, so a leg folded out
 * of the column (kneeling) still has cloth over its hip.
 */
const SEAT_PANEL_HALF = 0.26;
const SEAT_PANEL_DROP = 0.3;

function paintSeatPanel(ctx: Ctx, frame: BipedHipsFrame): void {
  const { place } = skirtFrame(frame, SEAT_PANEL_DROP);
  const centre = place(0, 0);
  const light = ctx.createLinearGradient(
    centre.x - COLUMN_HALF_WIDTH,
    0,
    centre.x + COLUMN_HALF_WIDTH,
    0,
  );
  light.addColorStop(0, MONK_WOOL.light);
  light.addColorStop(HALF, MONK_WOOL.base);
  light.addColorStop(1, MONK_WOOL.dark);
  tracePolygon(ctx, [
    place(-SEAT_PANEL_HALF, 0),
    place(SEAT_PANEL_HALF, 0),
    place(SEAT_PANEL_HALF, 1),
    place(-SEAT_PANEL_HALF, 1),
  ]);
  ctx.fillStyle = light;
  ctx.fill();
}

/**
 * Edge-on the robe hangs from his hips as one skirt over both legs, from the
 * back of his seat to the front of his belly, out to a hand past whichever
 * ankle is furthest back and furthest forward at the hem: a stride swings
 * the hem open as a bell, and no gap opens between the legs.
 */
const PROFILE_SKIRT_BACK = 0.2;
const PROFILE_SKIRT_FRONT = 0.18;
const PROFILE_HEM_FLARE = 0.08;
/**
 * The hem reaches no further from his hips than the seat's own width and the
 * cloth's allowance past it: a kick or a long stride carries the leg out of
 * the robe rather than the robe out to a horizontal sheet.
 */
const PROFILE_HEM_REACH = 0.36;
/** Lying down or kicking, the hem still hangs no further than this below his hips. */
const PROFILE_HEM_DROP = 0.9;
/** A fold from the hip down to each ankle, where the leg inside pushes the cloth. */
const PROFILE_FOLD_WIDTH = 0.02;
const PROFILE_FOLD_ALPHA = 0.4;

/**
 * The skirt hangs as a bell only while he is upright: bent far over or lying
 * down the cloth follows his legs, which their own cloth already covers.
 */
const UPRIGHT_SPINE_TILT = Math.PI / 5;

function paintProfileSkirt(ctx: Ctx, frame: BipedHipsFrame): void {
  const { skeleton } = frame;
  const spineTilt = Math.atan2(
    Math.abs(skeleton.hip.x - skeleton.waist.x),
    skeleton.hip.y - skeleton.waist.y,
  );
  if (spineTilt > UPRIGHT_SPINE_TILT) return;
  const depth = frame.look.garmentCut.profileDepth;
  const { hip } = skeleton;
  const left = skeleton.leftLeg.end;
  const right = skeleton.rightLeg.end;
  const hemY = Math.min(hip.y + PROFILE_HEM_DROP, Math.max(left.y, right.y) - HEM_ABOVE_ANKLE);
  const backX = Math.max(hip.x - PROFILE_HEM_REACH, Math.min(left.x, right.x) - PROFILE_HEM_FLARE);
  const frontX = Math.min(hip.x + PROFILE_HEM_REACH, Math.max(left.x, right.x) + PROFILE_HEM_FLARE);
  const skirt = [
    { x: hip.x - PROFILE_SKIRT_BACK * depth, y: hip.y },
    { x: hip.x + PROFILE_SKIRT_FRONT * depth, y: hip.y },
    { x: Math.max(frontX, hip.x + PROFILE_SKIRT_FRONT * depth), y: hemY },
    { x: Math.min(backX, hip.x - PROFILE_SKIRT_BACK * depth), y: hemY },
  ];
  const light = ctx.createLinearGradient(backX, 0, frontX, 0);
  light.addColorStop(0, MONK_WOOL.dark);
  light.addColorStop(HALF, MONK_WOOL.base);
  light.addColorStop(1, MONK_WOOL.light);
  tracePolygon(ctx, skirt);
  ctx.fillStyle = light;
  ctx.fill();
  for (const ankle of [left, right]) {
    const foldX = Math.max(backX, Math.min(frontX, ankle.x));
    strokeLine(
      ctx,
      [hip, { x: foldX, y: hemY }],
      rgba(MONK_WOOL.deep, PROFILE_FOLD_ALPHA),
      PROFILE_FOLD_WIDTH,
    );
  }
  strokeLine(ctx, [skirt[3], skirt[2]], rgba(MONK_WOOL.deep, COLUMN_HEM_ALPHA), COLUMN_HEM_WIDTH);
}

function paintSeat(ctx: Ctx, frame: BipedHipsFrame): void {
  if (frame.view.profile) {
    paintTrouserSeat(ctx, frame.skeleton, frame.view, MONK_WOOL, RIG_SEAT, frame.look.limbs);
    paintProfileSkirt(ctx, frame);
  } else paintSeatPanel(ctx, frame);
  paintCordEnds(ctx, frame);
}

/**
 * Head-on and from behind the robe falls as one column from his hips to a
 * hand above his ankles, the legs inside it unseen: each leg paints its half,
 * from the outside of its thigh across to his middle and flaring past its
 * ankle at the hem, so the two halves meet down his centre. The light falls
 * across the whole column from one side, so the halves shade as one cloth.
 */
const HEM_ABOVE_ANKLE = 0.02;
const HALF = 0.5;
const THIGH_COVER = 0.13;
const HEM_FLARE = 0.15;
/** How far across the column the light runs from its lit edge to its shaded one. */
const COLUMN_HALF_WIDTH = 0.3;
const COLUMN_FOLD_WIDTH = 0.018;
const COLUMN_FOLD_ALPHA = 0.35;
const COLUMN_HEM_WIDTH = 0.03;
const COLUMN_HEM_ALPHA = 0.7;

function paintRobeColumn(ctx: Ctx, frame: BipedLegFrame): void {
  const { root, end } = frame.chain;
  const centreX = frame.skeleton.hip.x;
  const outward = Math.sign(end.x - centreX) || 1;
  const hemY = end.y - HEM_ABOVE_ANKLE;
  const hemOuter = { x: end.x + outward * HEM_FLARE, y: hemY };
  const half = [
    { x: root.x + outward * THIGH_COVER, y: root.y },
    { x: centreX, y: root.y },
    { x: centreX, y: hemY },
    hemOuter,
  ];
  const light = ctx.createLinearGradient(
    centreX - COLUMN_HALF_WIDTH,
    0,
    centreX + COLUMN_HALF_WIDTH,
    0,
  );
  light.addColorStop(0, MONK_WOOL.light);
  light.addColorStop(HALF, MONK_WOOL.base);
  light.addColorStop(1, MONK_WOOL.dark);
  tracePolygon(ctx, half);
  ctx.fillStyle = light;
  ctx.fill();
  // The cloth drapes from the knee, a soft fold down the middle of each half.
  const kneeFold = { x: (end.x + frame.chain.joint.x) / 2, y: frame.chain.joint.y };
  strokeLine(
    ctx,
    [kneeFold, { x: end.x, y: hemY }],
    rgba(MONK_WOOL.deep, COLUMN_FOLD_ALPHA),
    COLUMN_FOLD_WIDTH,
  );
  strokeLine(
    ctx,
    [{ x: centreX, y: hemY }, hemOuter],
    rgba(MONK_WOOL.deep, COLUMN_HEM_ALPHA),
    COLUMN_HEM_WIDTH,
  );
}

/**
 * Edge-on, and head-on wherever a leg is folded out of its column (a knee
 * driven at the camera, a thigh painted on its own), the robe is the cloth
 * over each leg; head-on a standing leg is painted as its half of the column.
 */
function paintLegs(ctx: Ctx, frame: BipedLegFrame): void {
  const standingHeadOn = !frame.view.profile && frame.piece === 'leg' && frame.segments !== 'thigh';
  if (standingHeadOn) paintRobeColumn(ctx, frame);
  else paintLegCloth(ctx, frame, { cloth: MONK_WOOL, cut: 'robe' });
}

/**
 * The robe's skirt, from the waist to a hand above his ankles: about as wide
 * as his hips at the waist and falling straight, a little wider at the hem.
 * Edge-on it stands just behind his calves and just ahead of his shins, so a
 * stride opens it round the forward leg.
 */
const ROBE_SKIRT: SkirtCut = {
  length: 1.0,
  waistHalf: 0.2,
  hemHalf: 0.25,
  profileBehind: 0.12,
  profileFrontShare: 0.9,
  profileAhead: 0.08,
  splitRise: 0,
  splitOpen: 0,
};
/** The folds the skirt hangs in, down from the waist. */
const SKIRT_FOLD_ACROSS: readonly number[] = [-0.45, 0.1, 0.6];
const SKIRT_FOLD_TOP_V = 0.2;
const SKIRT_FOLD_WIDTH = 0.02;
const SKIRT_FOLD_ALPHA = 0.5;
const HEM_SHADE_WIDTH = 0.025;
const HEM_SHADE_ALPHA = 0.6;

/** Edge-on the skirt hangs behind his legs; head-on and from behind the column painted on the legs is the robe. */
function paintBack(ctx: Ctx, frame: BipedBackFrame): void {
  if (!frame.view.profile || !skirtPieceIs(frame)) return;
  const skirt = coatSkirt(frame, ROBE_SKIRT);
  const ramp = MONK_WOOL;
  paintSkirt(ctx, skirt, ramp, () => {
    for (const across of SKIRT_FOLD_ACROSS) {
      strokeLine(
        ctx,
        [skirt.at(across, SKIRT_FOLD_TOP_V), skirt.at(across, 1)],
        rgba(ramp.deep, SKIRT_FOLD_ALPHA),
        SKIRT_FOLD_WIDTH,
      );
    }
    strokeLine(
      ctx,
      [skirt.at(-1, 1), skirt.at(1, 1)],
      rgba(ramp.deep, HEM_SHADE_ALPHA),
      HEM_SHADE_WIDTH,
    );
  });
}

export const MONK_HABIT = defineGarment({
  id: 'monk_habit',
  name: 'Wool habit',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['torso', 'hips', 'leg', 'back'],
  covers: ['chest', 'throat'],
  sleeves: {
    cloth: MONK_WOOL,
    cut: {
      cuffAlongForearm: SLEEVE_TO_WRIST,
      cuffBulk: ROBE_CUFF_BULK,
      padding: ROBE_SLEEVE_PADDING,
      shadeContrast: WOOL_SLEEVE_CONTRAST,
    },
  },
  paint: {
    torso: humanEveryView(paintTorso),
    hips: humanEveryView(paintSeat),
    leg: humanEveryView(paintLegs),
    back: humanEveryView(paintBack),
  },
});

// ── Sandals ──────────────────────────────────────────────────────────────────

/** Plain tanned leather, a sole and straps with no upper: low on the foot, under the robe's hem. */
const SANDAL_LEATHER = matteRamp('#7b5434');
const SANDAL_SOLE = deriveRamp('#3b2a1c');
/** The straps come no higher than the ankle bone. */
const SANDAL_SHAFT_TOP_AT = 0.95;

const SANDAL: BootLook = {
  leather: SANDAL_LEATHER,
  sole: SANDAL_SOLE,
  shaftTopAt: SANDAL_SHAFT_TOP_AT,
  soleBuild: BOOT_SOLE,
};

function paintSandal(ctx: Ctx, frame: BipedLegFrame): void {
  if (frame.piece === 'kneeAtCamera' || frame.segments === 'thigh') return;
  paintBootOnLeg(ctx, frame, SANDAL);
}

export const MONK_SANDALS = defineGarment({
  id: 'monk_sandals',
  name: 'Sandals',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(paintSandal) },
});
