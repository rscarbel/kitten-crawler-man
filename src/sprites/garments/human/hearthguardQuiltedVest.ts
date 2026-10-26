/**
 * The Hearthguard Quilted Vest on the human crawler: the garrison's linen
 * quilted flat and stitched through, closed down the front, with a padded
 * collar and a rolled hem bound in the garrison's brown. At the tile it is a
 * pale oat coat over his whole torso and arms, its padding ridged into
 * vertical channels and boxed by rows stitched across them. Its linen and
 * binding are the cat's coat's, so the pair match.
 */

import type { BipedHipsFrame, BipedTorsoFrame } from '../../art/biped/bipedParts';
import { crease, FIGURE_CREASE_LAYERS, shadeForm } from '../../art/biped/paint';
import type { GlossRamp } from '../../art/biped/palette';
import type { ViewSpec } from '../../art/biped/rig';
import { COTTON_SLEEVE_CONTRAST } from '../../art/biped/sleeve';
import { collarShape, traceCollar, type TorsoFrame } from '../../art/biped/torso';
import { rgba, type Pt } from '../../art/bipedArt';
import { strokeSoftCrease, withClip } from '../../art/softShade';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { skirtFrame, type SkirtFrame } from './hipSkirt';
import {
  fillPolygon,
  paintCoverBody,
  withDeepShade,
  strokeLine,
  tracePolygon,
  withinTorso,
} from './torsoCover';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/**
 * Oat linen on the cat's coat's values. Its deep steps stay warm and well
 * above black, so the quilting reads as soft troughs in cloth, not cuts.
 */
const LINEN: GlossRamp = {
  deep: '#6e6046',
  shadow: '#8a7a5a',
  dark: '#a29270',
  mid: '#b8a882',
  base: '#cdbd96',
  light: '#ece0c0',
  rim: '#f4ead2',
  specular: '#ece0c0',
};
/** The garrison's brown, binding the hem, the front edge and the collar. */
const BINDING = '#5a3e26';
const TIE = '#3a2818';

/** Twenty layers of padding fold soft and deep, between a shirt's and leather's. */
const PADDING_FOLD_WEIGHT = 0.6;
const PADDING_SEAM_WEIGHT = 0.3;

/** Padded sleeves stand off the arm and bunch thick where they are pushed up. */
const SLEEVE_CUFF_BULK = 2.2;
const SLEEVE_PADDING = 0.45;

/** Across-the-body spacing of the quilting seams. */
const CHANNEL_PITCH = 0.12;
/** Seams start above the shoulder line so the trapezius slope clips them. */
const CHANNEL_TOP_Y = -0.08;
/** Below the hem, so the silhouette clip ends every seam cleanly. */
const OVERREACH = 0.6;
const CHANNEL_HEM_OVERREACH = 0.05;
/** Padding swells over the chest: the seams bow out this much at mid-chest. */
const CHANNEL_CHEST_BOW = 1.08;
const CHANNEL_CHEST_Y = 0.15;
/** Seams wide and dark enough to stay a pixel at the tile; the lit ridge between them is what makes them quilting. */
const SEAM_WIDTH = 0.034;
const SEAM_OPACITY = 1;
const RIDGE_WIDTH = 0.05;
const RIDGE_ALPHA = 0.85;
const RIDGE_KEY_SHIFT = -0.014;
/** Rows stitched across the channels, so the padding puffs into boxes rather than pinstripes. */
const CROSS_SEAM_YS = [0.13, 0.27] as const;
const CROSS_SEAM_SAG = 0.012;
const CROSS_SEAM_OPACITY = 0.5;

/** The closed front: the left panel lapped over the right, bound in brown and tied. */
const OPENING_X = -0.015;
const OPENING_TOP_Y = -0.04;
const OPENING_BINDING_WIDTH = 0.026;
const TIE_YS = [0.07, 0.19, 0.31] as const;
const TIE_HALF = 0.02;
const TIE_WIDTH = 0.016;

/** The rolled hem: a padded band in the garrison's brown, its top edge catching the key. */
const HEM_ROLL_RISE = 0.07;
const HEM_LIP_WIDTH = 0.016;
const HEM_LIP_ALPHA = 0.5;

/**
 * The coat's skirt falls past his hips to the tops of his thighs, flaring a
 * little: what makes it a coat at the tile rather than a quilted shirt.
 */
const SKIRT_DROP_BELOW_HIP = 0.25;
const SKIRT_TOP_HALF = 0.22;
const SKIRT_FLARE = 0.03;
const PROFILE_SKIRT_BACK_X = -0.14;
const PROFILE_SKIRT_FRONT_X = 0.12;
const SKIRT_SOFTNESS = 1.6;

/** Edge-on the channels run down his side, set across his depth. */
const PROFILE_CHANNEL_XS = [-0.2, -0.07, 0.06, 0.19] as const;
/** Edge-on the front edge's binding shows at his chest. */
const PROFILE_FRONT_BINDING_X = 0.24;

/** The padded collar: a thick roll of linen bound along its top in brown. */
const COLLAR_RAISE = 0.015;
const COLLAR_STITCH_SHARE = 0.5;
const COLLAR_STITCH_WIDTH = 0.012;
const COLLAR_STITCH_ALPHA = 0.6;
const COLLAR_BINDING_WIDTH = 0.022;

function strokeSeam(ctx: Ctx, points: readonly [Pt, Pt, Pt], opacity: number): void {
  const [from, control, to] = points;
  crease(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    SEAM_WIDTH,
    LINEN,
    opacity,
  );
}

function channelPath(torso: TorsoFrame, x: number): [Pt, Pt, Pt] {
  return [
    torso.at(x, CHANNEL_TOP_Y),
    torso.at(x * CHANNEL_CHEST_BOW, CHANNEL_CHEST_Y),
    torso.hem(x, CHANNEL_HEM_OVERREACH),
  ];
}

function paintRidge(ctx: Ctx, torso: TorsoFrame, x: number): void {
  const [from, control, to] = channelPath(torso, x + RIDGE_KEY_SHIFT);
  strokeSoftCrease(
    ctx,
    RIDGE_WIDTH,
    LINEN.light,
    () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    },
    RIDGE_ALPHA,
    FIGURE_CREASE_LAYERS,
  );
}

/** The midpoints between neighbouring seams, where the padding puffs up between them. */
function ridgeXs(seams: readonly number[]): number[] {
  return seams.slice(1).map((right, i) => (seams[i] + right) / 2);
}

/** Seams at `xs`, with a lit ridge puffed up halfway between each neighbouring pair. */
function paintChannels(ctx: Ctx, torso: TorsoFrame, xs: readonly number[]): void {
  for (const x of ridgeXs(xs)) paintRidge(ctx, torso, x);
  for (const x of xs) strokeSeam(ctx, channelPath(torso, x), SEAM_OPACITY);
}

function frontSeamXs(halfWidth: number): number[] {
  const xs: number[] = [];
  for (
    let x = -Math.ceil(halfWidth / CHANNEL_PITCH) * CHANNEL_PITCH;
    x <= halfWidth;
    x += CHANNEL_PITCH
  ) {
    xs.push(x);
  }
  return xs;
}

function paintCrossSeams(ctx: Ctx, torso: TorsoFrame): void {
  for (const y of CROSS_SEAM_YS) {
    strokeSeam(
      ctx,
      [torso.at(-OVERREACH, y), torso.at(0, y + CROSS_SEAM_SAG), torso.at(OVERREACH, y)],
      CROSS_SEAM_OPACITY,
    );
  }
}

function paintHemRoll(ctx: Ctx, torso: TorsoFrame): void {
  const top = (x: number): Pt => torso.hem(x, -HEM_ROLL_RISE);
  fillPolygon(
    ctx,
    [
      top(-OVERREACH),
      top(OVERREACH),
      torso.hem(OVERREACH, OVERREACH),
      torso.hem(-OVERREACH, OVERREACH),
    ],
    BINDING,
  );
  strokeLine(
    ctx,
    [top(-OVERREACH), top(OVERREACH)],
    rgba(LINEN.light, HEM_LIP_ALPHA),
    HEM_LIP_WIDTH,
  );
}

function paintClosure(ctx: Ctx, torso: TorsoFrame): void {
  strokeLine(
    ctx,
    [torso.at(OPENING_X, OPENING_TOP_Y), torso.hem(OPENING_X, CHANNEL_HEM_OVERREACH)],
    BINDING,
    OPENING_BINDING_WIDTH,
  );
  for (const y of TIE_YS) {
    strokeLine(
      ctx,
      [torso.at(OPENING_X - TIE_HALF, y), torso.at(OPENING_X + TIE_HALF, y)],
      TIE,
      TIE_WIDTH,
    );
  }
}

function paintBody(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  paintCoverBody(ctx, frame, context, LINEN, {
    foldWeight: PADDING_FOLD_WEIGHT,
    seamWeight: PADDING_SEAM_WEIGHT,
  });
  const { torso, view } = frame;
  withinTorso(ctx, frame, context, () => {
    if (view.profile) {
      const depth = torso.cut.profileDepth;
      paintChannels(
        ctx,
        torso,
        PROFILE_CHANNEL_XS.map((x) => x * depth),
      );
      paintCrossSeams(ctx, torso);
      const frontX = PROFILE_FRONT_BINDING_X * depth;
      strokeLine(
        ctx,
        [torso.at(frontX, OPENING_TOP_Y), torso.hem(frontX, CHANNEL_HEM_OVERREACH)],
        BINDING,
        OPENING_BINDING_WIDTH,
      );
      paintHemRoll(ctx, torso);
      return;
    }
    const seams = frontSeamXs(OVERREACH * view.girth);
    const closed = !view.showsBack;
    paintChannels(
      ctx,
      torso,
      closed ? seams.filter((x) => Math.abs(x) > CHANNEL_PITCH / 2) : seams,
    );
    paintCrossSeams(ctx, torso);
    paintHemRoll(ctx, torso);
    if (closed) paintClosure(ctx, torso);
  });
}

function paintCollar(ctx: Ctx, frame: BipedTorsoFrame): void {
  const collar = collarShape(frame.torso, frame.view, COLLAR_RAISE);
  traceCollar(ctx, collar);
  ctx.fillStyle = LINEN.light;
  ctx.fill();
  withClip(
    ctx,
    () => traceCollar(ctx, collar),
    () => {
      const mid = (a: Pt, b: Pt): Pt => ({
        x: a.x + (b.x - a.x) * COLLAR_STITCH_SHARE,
        y: a.y + (b.y - a.y) * COLLAR_STITCH_SHARE,
      });
      const left = mid(collar.bottomLeft, collar.topLeft);
      const centre = mid(collar.bottomMid, collar.topMid);
      const right = mid(collar.bottomRight, collar.topRight);
      ctx.lineWidth = COLLAR_STITCH_WIDTH;
      ctx.strokeStyle = rgba(LINEN.deep, COLLAR_STITCH_ALPHA);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.quadraticCurveTo(centre.x, centre.y, right.x, right.y);
      ctx.stroke();
    },
  );
}

function paintCollarBinding(ctx: Ctx, frame: BipedTorsoFrame, view: ViewSpec): void {
  const collar = collarShape(frame.torso, view, COLLAR_RAISE);
  ctx.lineCap = 'round';
  ctx.lineWidth = COLLAR_BINDING_WIDTH;
  ctx.strokeStyle = BINDING;
  ctx.beginPath();
  ctx.moveTo(collar.topLeft.x, collar.topLeft.y);
  ctx.quadraticCurveTo(collar.topMid.x, collar.topMid.y, collar.topRight.x, collar.topRight.y);
  ctx.stroke();
}

function skirtOutline(skirt: SkirtFrame, view: ViewSpec): Pt[] {
  const { place } = skirt;
  if (view.profile) {
    return [
      place(PROFILE_SKIRT_BACK_X, 0),
      place(PROFILE_SKIRT_FRONT_X, 0),
      place(PROFILE_SKIRT_FRONT_X + SKIRT_FLARE, 1),
      place(PROFILE_SKIRT_BACK_X - SKIRT_FLARE, 1),
    ];
  }
  const top = SKIRT_TOP_HALF * view.girth;
  const bottom = top + SKIRT_FLARE;
  return [place(-top, 0), place(top, 0), place(bottom, 1), place(-bottom, 1)];
}

/** The skirt's seams: its channels run on down from the body's, flaring with it. */
function skirtSeamXs(view: ViewSpec): number[] {
  if (view.profile) {
    const xs: number[] = [];
    for (let x = PROFILE_SKIRT_BACK_X; x <= PROFILE_SKIRT_FRONT_X; x += CHANNEL_PITCH) xs.push(x);
    return xs;
  }
  return frontSeamXs(SKIRT_TOP_HALF * view.girth);
}

function paintSkirt(ctx: Ctx, frame: BipedHipsFrame): void {
  const { view } = frame;
  const skirt = skirtFrame(frame, SKIRT_DROP_BELOW_HIP);
  const { place, length } = skirt;
  const outline = skirtOutline(skirt, view);
  const trace = (): void => tracePolygon(ctx, outline);
  const halfWidth = view.profile
    ? (PROFILE_SKIRT_FRONT_X - PROFILE_SKIRT_BACK_X) / 2
    : SKIRT_TOP_HALF * view.girth;
  const centreX = view.profile ? (PROFILE_SKIRT_FRONT_X + PROFILE_SKIRT_BACK_X) / 2 : 0;
  const along = (x: number): [Pt, Pt, Pt] => {
    const flareShare = x / halfWidth;
    return [place(x, 0), place(x, 1 / 2), place(x + flareShare * SKIRT_FLARE, 1)];
  };
  shadeForm(
    ctx,
    trace,
    { from: place(centreX, 0), to: place(centreX, 1) },
    LINEN,
    { halfWidth, softness: SKIRT_SOFTNESS },
    () => {
      const seams = skirtSeamXs(view).map((x) => x - centreX);
      for (const x of ridgeXs(seams)) {
        const [from, , to] = along(x + centreX + RIDGE_KEY_SHIFT);
        strokeSoftCrease(
          ctx,
          RIDGE_WIDTH,
          LINEN.light,
          () => {
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
          },
          RIDGE_ALPHA,
          FIGURE_CREASE_LAYERS,
        );
      }
      for (const x of seams) strokeSeam(ctx, along(x + centreX), SEAM_OPACITY);
      const rollTop = 1 - HEM_ROLL_RISE / length;
      fillPolygon(
        ctx,
        [
          place(-OVERREACH, rollTop),
          place(OVERREACH, rollTop),
          place(OVERREACH, 1),
          place(-OVERREACH, 1),
        ],
        BINDING,
      );
      strokeLine(
        ctx,
        [place(-OVERREACH, rollTop), place(OVERREACH, rollTop)],
        rgba(LINEN.light, HEM_LIP_ALPHA),
        HEM_LIP_WIDTH,
      );
      if (view.profile) {
        const front = PROFILE_SKIRT_FRONT_X + SKIRT_FLARE;
        strokeLine(
          ctx,
          [place(PROFILE_SKIRT_FRONT_X, 0), place(front, 1)],
          BINDING,
          OPENING_BINDING_WIDTH,
        );
      } else if (!view.showsBack) {
        strokeLine(ctx, [place(OPENING_X, 0), place(OPENING_X, 1)], BINDING, OPENING_BINDING_WIDTH);
      }
    },
  );
}

function paintTorso(ctx: Ctx, frame: BipedTorsoFrame, context: GarmentFrameContext<'human'>): void {
  if (frame.piece === 'jacket') paintBody(ctx, frame, context);
  else if (frame.piece === 'collar') paintCollar(ctx, frame);
  else paintCollarBinding(ctx, frame, frame.view);
}

export const HEARTHGUARD_QUILTED_VEST = defineGarment({
  id: 'human_hearthguard_quilted_vest',
  name: 'Hearthguard Quilted Vest',
  wearer: 'human',
  material: 'cloth',
  layer: 'outer',
  region: ['torso', 'hips'],
  covers: ['chest'],
  sleeves: {
    cloth: withDeepShade(LINEN),
    cut: {
      cuffBulk: SLEEVE_CUFF_BULK,
      padding: SLEEVE_PADDING,
      shadeContrast: COTTON_SLEEVE_CONTRAST,
    },
  },
  paint: { torso: humanEveryView(paintTorso), hips: humanEveryView(paintSkirt) },
});
