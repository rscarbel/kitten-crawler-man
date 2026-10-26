/**
 * The cat crawler's claw weapons: a cap or talon over each claw of both
 * forepaws. Each is painted on the paw after its fur, fitted to her own claws
 * (`catPawClaws`): sheathed, the caps sit on her toe tips and poke just past
 * them; out for a swipe, they ride the claws' tips. At the tile a paw is a
 * handful of pixels, so what reads is the row of coloured points along its
 * toes, their length and their hook; each set is told apart by those three.
 *
 * Every view paints the same way: the paw frame is the same shape in all of
 * them, toes toward +Y and her claws curling toward +X.
 */

import { catPawClaws, type Pt } from '../../art/catArt';
import type { CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CatClawGarmentId } from '../garmentIds';
import { defineGarment, withViewFallback, type WornGarmentDef } from '../garmentDef';
import { GOLD, metalFill, paintGlint, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;

/** What sets one pair of claw weapons apart from another. */
interface ClawLook {
  readonly id: CatClawGarmentId;
  readonly name: string;
  readonly ramp: MetalRamp;
  /** How far past the toe tip a cap reaches, in tile units. */
  readonly reach: number;
  /** How far forward a cap's point curls, in tile units. */
  readonly hook: number;
  readonly halfWidth: number;
  /** A polished or lacquered cap catches a glint; tin and blackened ones do not. */
  readonly glints: boolean;
  /** The colour its last stretch is dipped in, or null for a cap of one colour. */
  readonly dippedTip: string | null;
  /**
   * A heavy line round the cap's edge in a colour that stands off both cats'
   * fur, or null for a cap whose own colour already does: without it a black
   * cap vanishes on a black cat and a pale one on cream paws.
   */
  readonly edge: string | null;
}

/** Dull tin: grey with no shine, so it reads as cheap beside the polished sets. */
const TIN: MetalRamp = {
  shadow: '#5a5f66',
  base: '#b8bdc2',
  light: '#dcdfe2',
  glint: '#eceef0',
};
const VENOM_LACQUER: MetalRamp = {
  shadow: '#0e3a16',
  base: '#2fb648',
  light: '#a6f27e',
  glint: '#efffe0',
};
const FROST: MetalRamp = {
  shadow: '#24557a',
  base: '#7ccbf2',
  light: '#e2f7ff',
  glint: '#ffffff',
};
/** Blackened so it never catches the light: a matte charcoal ramp. */
const BLACKENED: MetalRamp = {
  shadow: '#08080a',
  base: '#2a2a32',
  light: '#5a5a68',
  glint: '#5a5a66',
};
/** Ink: glossy black with a cold violet sheen where it is still wet. */
const INK: MetalRamp = {
  shadow: '#030306',
  base: '#15121e',
  light: '#4a4070',
  glint: '#b8a8ff',
};
const INK_TIP = '#000000';
/** Dark gunmetal: the one edge of light a blackened hook gives back, never bright enough to read as steel. */
const PROWLER_SHEEN = '#6e7686';
/** Tin's own dark seam: its grey sits close to cream fur, so it is told apart by its edge. */
const TIN_SEAM = '#2a2e34';
/** The wet violet sheen the ink's swipe trail is rimmed in. */
const INK_SHEEN = '#b49cff';

const SHORT_CAP_REACH = 0.028;
const PROWLER_REACH = 0.07;
const TALON_REACH = 0.09;
const SLIGHT_HOOK = 0.004;
const PROWLER_HOOK = 0.02;
const TALON_HOOK = 0.016;
const CAP_HALF_WIDTH = 0.0095;
const PROWLER_HALF_WIDTH = 0.0085;
const TALON_HALF_WIDTH = 0.0095;

const TIN_CAPS: ClawLook = {
  id: 'cat_tin_claw_caps',
  name: 'Tin Claw Caps',
  ramp: TIN,
  reach: SHORT_CAP_REACH,
  hook: SLIGHT_HOOK,
  halfWidth: CAP_HALF_WIDTH,
  glints: false,
  dippedTip: null,
  edge: TIN_SEAM,
};

const VENOM_CAPS: ClawLook = {
  id: 'cat_venom_claws',
  name: 'Venom Claws',
  ramp: VENOM_LACQUER,
  reach: SHORT_CAP_REACH,
  hook: SLIGHT_HOOK,
  halfWidth: CAP_HALF_WIDTH,
  glints: true,
  dippedTip: null,
  edge: null,
};

const FROSTBITE_CAPS: ClawLook = {
  id: 'cat_frostbite_claws',
  name: 'Frostbite Claws',
  ramp: FROST,
  reach: SHORT_CAP_REACH,
  hook: SLIGHT_HOOK,
  halfWidth: CAP_HALF_WIDTH,
  glints: true,
  dippedTip: null,
  edge: null,
};

const PROWLER_HOOKS: ClawLook = {
  id: 'cat_prowler_claws',
  name: 'Prowler Claws',
  ramp: BLACKENED,
  reach: PROWLER_REACH,
  hook: PROWLER_HOOK,
  halfWidth: PROWLER_HALF_WIDTH,
  glints: false,
  dippedTip: null,
  edge: PROWLER_SHEEN,
};

const INK_DIPPED_CAPS: ClawLook = {
  id: 'cat_ink_dipped_claws',
  name: 'Ink-Dipped Claws',
  ramp: INK,
  reach: SHORT_CAP_REACH,
  hook: SLIGHT_HOOK,
  halfWidth: CAP_HALF_WIDTH,
  glints: true,
  dippedTip: INK_TIP,
  edge: INK_SHEEN,
};

const SUNSTEEL_TALONS: ClawLook = {
  id: 'cat_sunsteel_talons',
  name: 'Sunsteel Talons',
  ramp: GOLD,
  reach: TALON_REACH,
  hook: TALON_HOOK,
  halfWidth: TALON_HALF_WIDTH,
  glints: true,
  dippedTip: null,
  edge: null,
};

/** A cap's open end sits this far down the paw, as a share of its half-height: over the toe pad. */
const CAP_ROOT_ON_PAW = 0.62;
/**
 * A claw's back swells out behind it and its front is hollowed, so the point
 * reads as a hook curling forward rather than a peg.
 */
const BACK_BULGE = 1.6;
const FRONT_HOLLOW = 0.4;
/** The cap's rim bows up over the toe. */
const RIM_BOW = 0.5;
/** Where along the cap its sides start to close on the point. */
const SIDE_CLOSE_SHARE = 0.55;
/** The hard line round the rim that parts the cap from her fur. */
const RIM_LINE_WIDTH = 0.004;
/** Wide enough to survive the bake to the tile as a pixel of light. */
const EDGE_LINE_WIDTH = 0.008;
/** From where along a dipped cap the dip starts. */
const DIP_FROM = 0.45;
const GLINT_REACH = 0.016;
/** A paw darker than this is in the body's shade, where a cap catches no light. */
const LIT_SHADE_LIMIT = 0.1;
const SHADE_INK = '#0d0a08';

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function traceCap(ctx: Ctx, rootX: number, rootY: number, tip: Pt, look: ClawLook): void {
  const half = look.halfWidth;
  const closeY = rootY + (tip.y - rootY) * SIDE_CLOSE_SHARE;
  ctx.beginPath();
  ctx.moveTo(rootX - half, rootY);
  ctx.quadraticCurveTo(rootX - half * BACK_BULGE, tip.y, tip.x, tip.y);
  ctx.quadraticCurveTo(rootX + half * FRONT_HOLLOW, closeY, rootX + half, rootY);
  ctx.quadraticCurveTo(rootX, rootY - half * RIM_BOW, rootX - half, rootY);
  ctx.closePath();
}

function paintCap(ctx: Ctx, rootX: number, rootY: number, tip: Pt, look: ClawLook, shade: number) {
  const { ramp } = look;
  traceCap(ctx, rootX, rootY, tip, look);
  // Lit across its width, not along its length: shaded toward the point, a
  // cap's far half went to its shadow colour and read as the paw's outline.
  ctx.fillStyle = metalFill(
    ctx,
    ramp,
    rootX - look.halfWidth,
    rootY,
    rootX + look.halfWidth + look.hook,
    rootY,
  );
  ctx.fill();
  if (look.dippedTip !== null) {
    const dip = ctx.createLinearGradient(rootX, rootY, tip.x, tip.y);
    dip.addColorStop(0, 'rgba(0,0,0,0)');
    dip.addColorStop(DIP_FROM, 'rgba(0,0,0,0)');
    dip.addColorStop(DIP_FROM, look.dippedTip);
    dip.addColorStop(1, look.dippedTip);
    ctx.fillStyle = dip;
    ctx.fill();
  }
  ctx.strokeStyle = look.edge ?? ramp.shadow;
  ctx.lineWidth = look.edge === null ? RIM_LINE_WIDTH : EDGE_LINE_WIDTH;
  ctx.stroke();
  if (shade > 0) {
    ctx.globalAlpha = shade;
    ctx.fillStyle = SHADE_INK;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function paintClawsOnPaw(look: ClawLook) {
  return (ctx: Ctx, frame: CatLegFrame): void => {
    if (frame.piece !== 'paw') return;
    const rootY = frame.radiusY * CAP_ROOT_ON_PAW;
    const tips = catPawClaws(frame.claw).map((claw) => {
      const tipY = Math.max(claw.tip.y, frame.radiusY) + look.reach;
      return { rootX: claw.root.x, tip: { x: claw.tip.x + look.hook, y: tipY } };
    });
    ctx.save();
    for (const { rootX, tip } of tips) paintCap(ctx, rootX, rootY, tip, look, frame.shade);
    const glinted = look.glints && frame.shade < LIT_SHADE_LIMIT ? tips.slice(0, 1) : [];
    for (const { rootX, tip } of glinted) {
      const at = lerpPt({ x: rootX, y: rootY }, tip, DIP_FROM);
      paintGlint(ctx, look.ramp, at.x, at.y, GLINT_REACH);
    }
    ctx.restore();
  };
}

function defineClaws(look: ClawLook): WornGarmentDef<'cat'> {
  const painter = paintClawsOnPaw(look);
  return defineGarment({
    id: look.id,
    name: look.name,
    wearer: 'cat',
    material: 'metal',
    layer: 'outer',
    region: ['foreleg'],
    paint: {
      foreleg: withViewFallback(
        { front: painter, side: painter, back: painter },
        CAT_VIEW_FALLBACK,
      ),
    },
  });
}

/** Every claw weapon's garment, by id. */
export const CAT_CLAW_GARMENTS: Readonly<Record<CatClawGarmentId, WornGarmentDef<'cat'>>> = {
  cat_tin_claw_caps: defineClaws(TIN_CAPS),
  cat_venom_claws: defineClaws(VENOM_CAPS),
  cat_frostbite_claws: defineClaws(FROSTBITE_CAPS),
  cat_prowler_claws: defineClaws(PROWLER_HOOKS),
  cat_ink_dipped_claws: defineClaws(INK_DIPPED_CAPS),
  cat_sunsteel_talons: defineClaws(SUNSTEEL_TALONS),
};
