/**
 * The weapons a crawler scavenges rather than forges: a rebar shiv, a pipe
 * wrench, a fire axe pulled from its case and a gravedigger's spade. Each is
 * a tool or scrap first and a weapon second, so each reads by the colours and
 * silhouette of the thing it was before: rust and tape, red cast iron with a
 * hook jaw, a red axe head on a yellow haft, a long spade worn thin.
 */

import { mix } from '../../art/bipedArt';
import { defineHeldVisual, type HeldHandleGeometry, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill, paintSharedHandle } from '../heldPaint';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const OUTLINE_INK = '#1b120c';

/** The lit half of a flat form is whichever side of the haft the key light falls on. */
function litSideOf(look: HeldLook): number {
  return look.light.y < 0 ? -1 : 1;
}

// ── Rebar shiv ───────────────────────────────────────────────────────────────

const SHIV_HANDLE_LENGTH = 0.2;
const SHIV_GRIP_POINT = 0.5;
/** The tape is wound thicker than the bar it covers, so the grip reads as a lump of wrap. */
const SHIV_TAPE_HALF = 0.03;
/** Black electrical tape, so the grip end can never be mistaken for the bright ground point. */
const SHIV_TAPE = '#2e2c30';
const SHIV_TAPE_SEAM = '#5a575c';
/** Diagonal seams where each turn of tape overlaps the last, as shares of the handle. */
const SHIV_TAPE_SEAMS: readonly number[] = [0.18, 0.42, 0.66, 0.88];
const SHIV_TAPE_SEAM_SLANT = 0.022;
const SHIV_TAPE_SEAM_WIDTH = 0.01;
/** A loose tail of tape left hanging off the butt. */
const SHIV_TAPE_TAIL_LENGTH = 0.05;
const SHIV_TAPE_TAIL_DROP = 0.035;
const SHIV_TAPE_TAIL_HALF = 0.012;

const SHIV_BAR_LENGTH = 0.52;
/** Rebar is thin round bar; anything wider reads as a flat blade. */
const SHIV_BAR_HALF = 0.024;
/** Where the grinding begins, as a share of the bar from the handle. */
const SHIV_GRIND_FROM = 0.6;
const SHIV_RUST = '#7c4a2c';
const SHIV_RUST_LIT = '#a7683d';
const SHIV_IRON_DARK = '#3f3633';
/** The ground point is fresh bright steel against the rust: the whole read of a shiv at the tile. */
const SHIV_GROUND = '#c9ccd0';
const SHIV_GROUND_LIT = '#f1f3f5';
/** The bar's raised ribs, one every this much of its length, slanted the way rebar's helix runs. */
const SHIV_RIB_SPACING = 0.05;
const SHIV_RIB_SLANT = 0.018;
const SHIV_RIB_WIDTH = 0.009;

function traceShivBar(ctx: Ctx, base: number): void {
  const grind = base + SHIV_BAR_LENGTH * SHIV_GRIND_FROM;
  const tip = base + SHIV_BAR_LENGTH;
  ctx.beginPath();
  ctx.moveTo(base, -SHIV_BAR_HALF);
  ctx.lineTo(grind, -SHIV_BAR_HALF);
  ctx.lineTo(tip, 0);
  ctx.lineTo(grind, SHIV_BAR_HALF);
  ctx.lineTo(base, SHIV_BAR_HALF);
  ctx.closePath();
}

function paintShivBar(ctx: Ctx, look: HeldLook, base: number): void {
  const grind = base + SHIV_BAR_LENGTH * SHIV_GRIND_FROM;
  const litSide = litSideOf(look);
  traceShivBar(ctx, base);
  outlineAndFill(ctx, heldShade(SHIV_RUST, look));
  ctx.save();
  traceShivBar(ctx, base);
  ctx.clip();
  ctx.fillStyle = heldShade(SHIV_IRON_DARK, look);
  ctx.fillRect(base, litSide < 0 ? 0 : -SHIV_BAR_HALF, SHIV_BAR_LENGTH, SHIV_BAR_HALF);
  ctx.fillStyle = heldShade(SHIV_RUST_LIT, look);
  ctx.fillRect(
    base,
    litSide < 0 ? -SHIV_BAR_HALF : SHIV_BAR_HALF / 2,
    grind - base,
    SHIV_BAR_HALF / 2,
  );
  ctx.strokeStyle = heldShade(SHIV_IRON_DARK, look);
  ctx.lineWidth = SHIV_RIB_WIDTH;
  ctx.beginPath();
  for (let x = base + SHIV_RIB_SPACING / 2; x < grind; x += SHIV_RIB_SPACING) {
    ctx.moveTo(x - SHIV_RIB_SLANT, -SHIV_BAR_HALF);
    ctx.lineTo(x + SHIV_RIB_SLANT, SHIV_BAR_HALF);
  }
  ctx.stroke();
  ctx.fillStyle = heldShade(SHIV_GROUND, look);
  ctx.fillRect(grind, -SHIV_BAR_HALF, SHIV_BAR_LENGTH, SHIV_BAR_HALF * 2);
  ctx.fillStyle = heldShade(SHIV_GROUND_LIT, look);
  ctx.fillRect(grind, litSide < 0 ? -SHIV_BAR_HALF : 0, SHIV_BAR_LENGTH, SHIV_BAR_HALF);
  ctx.restore();
}

function paintShivTape(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  const { buttX, headBase } = handle;
  const run = headBase - buttX;
  ctx.beginPath();
  ctx.moveTo(buttX + SHIV_TAPE_HALF, 0);
  ctx.ellipse(
    buttX,
    SHIV_TAPE_TAIL_DROP,
    SHIV_TAPE_TAIL_HALF,
    SHIV_TAPE_TAIL_HALF,
    0,
    0,
    FULL_TURN,
  );
  ctx.rect(
    buttX - SHIV_TAPE_TAIL_LENGTH,
    SHIV_TAPE_TAIL_DROP - SHIV_TAPE_TAIL_HALF,
    SHIV_TAPE_TAIL_LENGTH,
    SHIV_TAPE_TAIL_HALF * 2,
  );
  outlineAndFill(ctx, heldShade(SHIV_TAPE_SEAM, look));
  ctx.beginPath();
  ctx.roundRect(buttX, -SHIV_TAPE_HALF, run, SHIV_TAPE_HALF * 2, SHIV_TAPE_HALF);
  outlineAndFill(ctx, heldShade(SHIV_TAPE, look));
  ctx.strokeStyle = heldShade(SHIV_TAPE_SEAM, look);
  ctx.lineWidth = SHIV_TAPE_SEAM_WIDTH;
  ctx.beginPath();
  for (const share of SHIV_TAPE_SEAMS) {
    const x = buttX + run * share;
    ctx.moveTo(x - SHIV_TAPE_SEAM_SLANT, -SHIV_TAPE_HALF);
    ctx.lineTo(x + SHIV_TAPE_SEAM_SLANT, SHIV_TAPE_HALF);
  }
  ctx.stroke();
}

export const REBAR_SHIV_HELD = defineHeldVisual({
  id: 'rebar_shiv',
  name: 'Rebar Shiv',
  archetype: 'oneHandHaft',
  weight: 'light',
  handle: { length: SHIV_HANDLE_LENGTH, radius: 'thin' },
  head: { length: SHIV_BAR_LENGTH, width: SHIV_TAPE_HALF * 2 },
  gripPoint: SHIV_GRIP_POINT,
  phases: 1,
  paintHandle: paintShivTape,
  // A round bar looks the same from any side, so edge-on is the same picture.
  paintHead: (ctx, look, handle) => paintShivBar(ctx, look, handle.headBase),
});

// ── Pipe wrench ──────────────────────────────────────────────────────────────

const WRENCH_HANDLE_LENGTH = 0.36;
const WRENCH_GRIP_POINT = 0.35;
/** The cast handle flares from its butt toward the head, the way a pipe wrench's I-beam does. */
const WRENCH_BUTT_HALF = 0.026;
const WRENCH_NECK_HALF = 0.036;
const WRENCH_HANG_HOLE_RADIUS = 0.012;
const WRENCH_HANG_HOLE_IN = 0.03;
const WRENCH_RED = '#b3271d';
const WRENCH_RED_LIT = '#de5a3f';
const WRENCH_RED_DEEP = '#6a140f';
const WRENCH_RIB_WIDTH = 0.01;
const WRENCH_STEEL = '#8c9198';
const WRENCH_STEEL_LIT = '#d0d4d9';
const WRENCH_STEEL_DARK = '#4d5157';

/**
 * The head about its mount on the handle, in item-local units ahead of it:
 * the red housing the handle ends in, the heel jaw standing off it on the
 * leading side, and the steel hook jaw whose shank runs back through the
 * knurled nut, its jaw facing the heel across the mouth.
 */
const HOUSING_RUN = 0.09;
const HOUSING_HALF = 0.042;
const HEEL_FROM = 0.03;
const HEEL_TO = 0.08;
const HEEL_REACH = 0.115;
const HOOK_SHANK_FROM = 0.02;
const HOOK_SHANK_TOP = -0.034;
const HOOK_SHANK_BOTTOM = 0.012;
const HOOK_JAW_FROM = 0.115;
const HOOK_JAW_TO = 0.17;
const HOOK_JAW_REACH = 0.12;
const NUT_FROM = 0.07;
const NUT_TO = 0.11;
const NUT_TOP = -0.05;
const NUT_BOTTOM = 0.024;
const NUT_KNURLS = 4;
const TEETH = 3;
/** The heel jaw's teeth run along its outer part, past the housing. */
const HEEL_TEETH_FROM = 0.45;
const TOOTH_DEPTH = 0.012;
const KNURL_WIDTH = 0.007;

function paintWrenchHandle(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  const { buttX, headBase } = handle;
  const litSide = litSideOf(look);
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(buttX, -WRENCH_BUTT_HALF);
    ctx.lineTo(headBase, -WRENCH_NECK_HALF);
    ctx.lineTo(headBase, WRENCH_NECK_HALF);
    ctx.lineTo(buttX, WRENCH_BUTT_HALF);
    ctx.arc(buttX, 0, WRENCH_BUTT_HALF, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, heldShade(WRENCH_RED, look));
  ctx.save();
  trace();
  ctx.clip();
  ctx.fillStyle = heldShade(WRENCH_RED_LIT, look);
  ctx.fillRect(
    buttX - WRENCH_BUTT_HALF,
    litSide < 0 ? -WRENCH_NECK_HALF : WRENCH_NECK_HALF / 2,
    headBase - buttX + WRENCH_BUTT_HALF,
    WRENCH_NECK_HALF / 2,
  );
  ctx.restore();
  ctx.strokeStyle = heldShade(WRENCH_RED_DEEP, look);
  ctx.lineWidth = WRENCH_RIB_WIDTH;
  ctx.beginPath();
  ctx.moveTo(buttX + WRENCH_HANG_HOLE_IN + WRENCH_HANG_HOLE_RADIUS * 2, 0);
  ctx.lineTo(headBase, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(buttX + WRENCH_HANG_HOLE_IN, 0, WRENCH_HANG_HOLE_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = OUTLINE_INK;
  ctx.fill();
}

function traceTeeth(ctx: Ctx, x: number, fromY: number, toY: number, facing: number): void {
  const step = (toY - fromY) / TEETH;
  ctx.moveTo(x, fromY);
  for (let tooth = 0; tooth < TEETH; tooth++) {
    ctx.lineTo(x + facing * TOOTH_DEPTH, fromY + step * (tooth + 0.5));
    ctx.lineTo(x, fromY + step * (tooth + 1));
  }
}

function paintWrenchHead(ctx: Ctx, look: HeldLook, base: number): void {
  const steel = heldShade(WRENCH_STEEL, look);
  ctx.beginPath();
  ctx.rect(
    base + HOOK_SHANK_FROM,
    HOOK_SHANK_TOP,
    HOOK_JAW_TO - HOOK_SHANK_FROM,
    HOOK_SHANK_BOTTOM - HOOK_SHANK_TOP,
  );
  ctx.rect(
    base + HOOK_JAW_FROM,
    HOOK_SHANK_TOP,
    HOOK_JAW_TO - HOOK_JAW_FROM,
    HOOK_JAW_REACH - HOOK_SHANK_TOP,
  );
  outlineAndFill(ctx, steel);
  ctx.fillStyle = heldShade(WRENCH_STEEL_LIT, look);
  ctx.fillRect(
    base + HOOK_JAW_FROM,
    HOOK_SHANK_TOP,
    (HOOK_JAW_TO - HOOK_JAW_FROM) / 2,
    HOOK_JAW_REACH - HOOK_SHANK_TOP,
  );
  ctx.beginPath();
  traceTeeth(ctx, base + HOOK_JAW_FROM, HOOK_SHANK_BOTTOM, HOOK_JAW_REACH, -1);
  ctx.fillStyle = steel;
  ctx.fill();

  ctx.beginPath();
  ctx.rect(base - WRENCH_NECK_HALF / 2, -HOUSING_HALF, HOUSING_RUN, HOUSING_HALF * 2);
  ctx.rect(base + HEEL_FROM, 0, HEEL_TO - HEEL_FROM, HEEL_REACH);
  outlineAndFill(ctx, heldShade(WRENCH_RED, look));
  ctx.beginPath();
  traceTeeth(ctx, base + HEEL_TO, HEEL_REACH * HEEL_TEETH_FROM, HEEL_REACH, 1);
  ctx.fillStyle = steel;
  ctx.fill();

  ctx.beginPath();
  ctx.rect(base + NUT_FROM, NUT_TOP, NUT_TO - NUT_FROM, NUT_BOTTOM - NUT_TOP);
  outlineAndFill(ctx, heldShade(WRENCH_STEEL_DARK, look));
  ctx.strokeStyle = heldShade(WRENCH_STEEL_LIT, look);
  ctx.lineWidth = KNURL_WIDTH;
  ctx.beginPath();
  const knurlStep = (NUT_TO - NUT_FROM) / (NUT_KNURLS + 1);
  for (let knurl = 1; knurl <= NUT_KNURLS; knurl++) {
    const x = base + NUT_FROM + knurlStep * knurl;
    ctx.moveTo(x, NUT_TOP);
    ctx.lineTo(x, NUT_BOTTOM);
  }
  ctx.stroke();
}

export const PIPE_WRENCH_HELD = defineHeldVisual({
  id: 'pipe_wrench',
  name: 'Pipe Wrench',
  archetype: 'oneHandHaft',
  weight: 'heavy',
  handle: { length: WRENCH_HANDLE_LENGTH, radius: 'standard' },
  head: { length: HOOK_JAW_TO, width: HOOK_JAW_REACH - NUT_TOP },
  gripPoint: WRENCH_GRIP_POINT,
  phases: 1,
  paintHandle: paintWrenchHandle,
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      paintWrenchHead(ctx, look, handle.headBase);
      return;
    }
    seenOnEdge(ctx, () => paintWrenchHead(ctx, look, handle.headBase));
  },
});

// ── Fire axe ─────────────────────────────────────────────────────────────────

const FIRE_AXE_HANDLE_LENGTH = 1.02;
const FIRE_AXE_KNOB_RUN = 0.05;
/** Yellow fibreglass under a red head: the pair that says "fire axe" at a glance. */
const FIRE_AXE_HAFT = '#d9ac1f';
/** The black rubber sleeve over the butt, where the off hand closes. */
const FIRE_AXE_SLEEVE = '#26221f';
const FIRE_AXE_SLEEVE_RUN = 0.2;
const FIRE_AXE_SLEEVE_SWELL = 1.25;
const FIRE_AXE_RED = '#c42a1e';
const FIRE_AXE_RED_LIT = '#ec5f43';
const FIRE_AXE_STEEL_EDGE = '#e7eaee';
/** The eye wraps the haft's end; the bit stands off it on the leading side, the pick on the other. */
const FIRE_AXE_EYE_HALF = 0.055;
const FIRE_AXE_HEAD_SET_BACK = 0.05;
/** A fire axe's bit is short and broad, flaring hard to a straight edge. */
const FIRE_AXE_BIT_REACH = 0.24;
const FIRE_AXE_BIT_HALF_AT_EDGE = 0.135;
const FIRE_AXE_EDGE_BELLY = 0.02;
const FIRE_AXE_EDGE_BAND = 0.065;
const FIRE_AXE_PICK_REACH = 0.16;
const FIRE_AXE_PICK_HALF_AT_EYE = 0.04;
/** The eye block's reach either side of the haft, and the cheek's waist below it. */
const FIRE_AXE_EYE_REACH = 0.045;
const FIRE_AXE_CHEEK_HALF = 0.04;
const FIRE_AXE_CHEEK_REACH = 0.11;
/** The pick curves down toward the edge, the way a firefighter's pick-head does. */
const FIRE_AXE_PICK_DROOP = 0.035;
/** The pick's point is ground bright like the edge, so both ends of the head read as steel. */
const FIRE_AXE_PICK_GROUND_SHARE = 0.4;

/**
 * The head about its eye: a squared eye block round the haft, the bit's
 * narrow cheek leaving it on the leading side and flaring to the edge, and a
 * straight pick spiking out the other side, drooping a little toward the
 * edge. The cheek's waist is what keeps the head from reading as a wedge.
 */
function traceFireAxeHead(ctx: Ctx, eyeX: number): void {
  ctx.beginPath();
  ctx.moveTo(eyeX - FIRE_AXE_PICK_HALF_AT_EYE, -FIRE_AXE_EYE_REACH);
  ctx.lineTo(eyeX - FIRE_AXE_PICK_DROOP, -FIRE_AXE_PICK_REACH);
  ctx.lineTo(eyeX + FIRE_AXE_PICK_HALF_AT_EYE, -FIRE_AXE_EYE_REACH);
  ctx.lineTo(eyeX + FIRE_AXE_EYE_HALF, -FIRE_AXE_EYE_REACH);
  ctx.lineTo(eyeX + FIRE_AXE_EYE_HALF, FIRE_AXE_EYE_REACH);
  ctx.lineTo(eyeX + FIRE_AXE_CHEEK_HALF, FIRE_AXE_CHEEK_REACH);
  ctx.lineTo(eyeX + FIRE_AXE_BIT_HALF_AT_EDGE, FIRE_AXE_BIT_REACH);
  ctx.quadraticCurveTo(
    eyeX,
    FIRE_AXE_BIT_REACH + FIRE_AXE_EDGE_BELLY * 2,
    eyeX - FIRE_AXE_BIT_HALF_AT_EDGE,
    FIRE_AXE_BIT_REACH,
  );
  ctx.lineTo(eyeX - FIRE_AXE_CHEEK_HALF, FIRE_AXE_CHEEK_REACH);
  ctx.lineTo(eyeX - FIRE_AXE_EYE_HALF, FIRE_AXE_EYE_REACH);
  ctx.lineTo(eyeX - FIRE_AXE_EYE_HALF, -FIRE_AXE_EYE_REACH);
  ctx.closePath();
}

function paintFireAxeHead(ctx: Ctx, look: HeldLook, base: number): void {
  const eyeX = base - FIRE_AXE_HEAD_SET_BACK;
  traceFireAxeHead(ctx, eyeX);
  outlineAndFill(ctx, heldShade(FIRE_AXE_RED, look));
  ctx.save();
  traceFireAxeHead(ctx, eyeX);
  ctx.clip();
  const litAlong = look.light.x < 0 ? -1 : 1;
  ctx.fillStyle = heldShade(FIRE_AXE_RED_LIT, look);
  ctx.fillRect(
    litAlong < 0 ? eyeX - FIRE_AXE_BIT_HALF_AT_EDGE : eyeX,
    -FIRE_AXE_PICK_REACH,
    FIRE_AXE_BIT_HALF_AT_EDGE,
    FIRE_AXE_PICK_REACH + FIRE_AXE_BIT_REACH + FIRE_AXE_EDGE_BELLY * 2,
  );
  ctx.beginPath();
  ctx.moveTo(eyeX + FIRE_AXE_BIT_HALF_AT_EDGE, FIRE_AXE_BIT_REACH);
  ctx.quadraticCurveTo(
    eyeX,
    FIRE_AXE_BIT_REACH + FIRE_AXE_EDGE_BELLY * 2,
    eyeX - FIRE_AXE_BIT_HALF_AT_EDGE,
    FIRE_AXE_BIT_REACH,
  );
  ctx.strokeStyle = heldShade(FIRE_AXE_STEEL_EDGE, look);
  ctx.lineWidth = FIRE_AXE_EDGE_BAND;
  ctx.stroke();
  ctx.fillStyle = heldShade(FIRE_AXE_STEEL_EDGE, look);
  ctx.fillRect(
    eyeX - FIRE_AXE_BIT_HALF_AT_EDGE,
    -FIRE_AXE_PICK_REACH,
    FIRE_AXE_BIT_HALF_AT_EDGE * 2,
    FIRE_AXE_PICK_REACH * FIRE_AXE_PICK_GROUND_SHARE,
  );
  ctx.restore();
}

function paintFireAxeHaft(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  paintSharedHandle(ctx, look, handle, { colour: FIRE_AXE_HAFT, butt: 'plain' });
  const sleeveHalf = handle.halfWidth * FIRE_AXE_SLEEVE_SWELL;
  ctx.beginPath();
  ctx.roundRect(
    handle.buttX - sleeveHalf / 2,
    -sleeveHalf,
    FIRE_AXE_SLEEVE_RUN,
    sleeveHalf * 2,
    sleeveHalf,
  );
  outlineAndFill(ctx, heldShade(FIRE_AXE_SLEEVE, look));
}

export const FIRE_AXE_HELD = defineHeldVisual({
  id: 'fire_axe',
  name: 'Fire Axe',
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: FIRE_AXE_HANDLE_LENGTH, radius: 'standard' },
  head: {
    length: FIRE_AXE_BIT_HALF_AT_EDGE * 2,
    width: FIRE_AXE_PICK_REACH + FIRE_AXE_BIT_REACH + FIRE_AXE_EDGE_BELLY,
  },
  gripPoint: FIRE_AXE_KNOB_RUN / FIRE_AXE_HANDLE_LENGTH,
  phases: 1,
  paintHandle: paintFireAxeHaft,
  paintHead: (ctx, look, handle) => paintFireAxeHead(ctx, look, handle.headBase),
});

// ── Gravedigger's spade ──────────────────────────────────────────────────────

const SPADE_HANDLE_LENGTH = 1.0;
const SPADE_KNOB_RUN = 0.05;
/** Ash gone grey-brown and greasy from a lifetime of hands. */
const SPADE_HAFT = '#8a6a48';
/** The iron socket runs up over the haft's end, held by two straps. */
const SPADE_SOCKET_BACK = 0.11;
const SPADE_SOCKET_HALF = 0.034;
const SPADE_STRAP_HALF = 0.022;
const SPADE_BLADE_LENGTH = 0.26;
/** A long-handled spade's blade: square shoulders, sides narrowing a little, a bottom worn round. */
const SPADE_SHOULDER_HALF = 0.1;
const SPADE_EDGE_HALF = 0.088;
const SPADE_WORN_BELLY = 0.05;
const SPADE_IRON = '#55524d';
const SPADE_IRON_LIT = '#7d7972';
const SPADE_IRON_DEEP = '#33302c';
/** The bottom edge is worn bright by every grave it opened. */
const SPADE_WORN_EDGE = '#cfcac0';
const SPADE_WORN_EDGE_BAND = 0.04;
/** The frog, the raised ridge down the blade from the socket, as a share of the blade. */
const SPADE_FROG_SHARE = 0.45;
const SPADE_FROG_WIDTH = 0.022;
/** The frog sits between the blade's iron and its deepest shade. */
const SPADE_FROG_TONE = 0.5;
/** A crust of old soil along one shoulder. */
const SPADE_SOIL = '#5a4632';
const SPADE_SOIL_RUN = 0.08;
const SPADE_SOIL_DEPTH = 0.035;

function traceSpadeBlade(ctx: Ctx, from: number): void {
  const to = from + SPADE_BLADE_LENGTH;
  ctx.beginPath();
  ctx.moveTo(from, -SPADE_SHOULDER_HALF);
  ctx.lineTo(to - SPADE_WORN_BELLY, -SPADE_EDGE_HALF);
  ctx.quadraticCurveTo(to + SPADE_WORN_BELLY, 0, to - SPADE_WORN_BELLY, SPADE_EDGE_HALF);
  ctx.lineTo(from, SPADE_SHOULDER_HALF);
  ctx.closePath();
}

function paintSpadeHead(ctx: Ctx, look: HeldLook, base: number): void {
  const socketFrom = base - SPADE_SOCKET_BACK;
  ctx.beginPath();
  ctx.moveTo(socketFrom, -SPADE_STRAP_HALF);
  ctx.lineTo(base, -SPADE_SOCKET_HALF);
  ctx.lineTo(base, SPADE_SOCKET_HALF);
  ctx.lineTo(socketFrom, SPADE_STRAP_HALF);
  ctx.closePath();
  outlineAndFill(ctx, heldShade(SPADE_IRON_DEEP, look));

  const litSide = litSideOf(look);
  traceSpadeBlade(ctx, base);
  outlineAndFill(ctx, heldShade(SPADE_IRON, look));
  ctx.save();
  traceSpadeBlade(ctx, base);
  ctx.clip();
  ctx.fillStyle = heldShade(SPADE_IRON_LIT, look);
  ctx.fillRect(
    base,
    litSide < 0 ? -SPADE_SHOULDER_HALF : 0,
    SPADE_BLADE_LENGTH + SPADE_WORN_BELLY,
    SPADE_SHOULDER_HALF,
  );
  const to = base + SPADE_BLADE_LENGTH;
  ctx.beginPath();
  ctx.moveTo(to - SPADE_WORN_BELLY, -SPADE_EDGE_HALF);
  ctx.quadraticCurveTo(to + SPADE_WORN_BELLY, 0, to - SPADE_WORN_BELLY, SPADE_EDGE_HALF);
  ctx.strokeStyle = heldShade(SPADE_WORN_EDGE, look);
  ctx.lineWidth = SPADE_WORN_EDGE_BAND;
  ctx.stroke();
  ctx.fillStyle = heldShade(SPADE_SOIL, look);
  ctx.fillRect(
    base,
    -litSide * SPADE_SHOULDER_HALF - (litSide < 0 ? 0 : SPADE_SOIL_DEPTH),
    SPADE_SOIL_RUN,
    SPADE_SOIL_DEPTH,
  );
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(base, 0);
  ctx.lineTo(base + SPADE_BLADE_LENGTH * SPADE_FROG_SHARE, 0);
  ctx.strokeStyle = heldShade(mix(SPADE_IRON_DEEP, SPADE_IRON, SPADE_FROG_TONE), look);
  ctx.lineWidth = SPADE_FROG_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

export const GRAVEDIGGERS_SPADE_HELD = defineHeldVisual({
  id: 'gravediggers_spade',
  name: "Gravedigger's Spade",
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: SPADE_HANDLE_LENGTH, radius: 'standard' },
  head: { length: SPADE_BLADE_LENGTH, width: SPADE_SHOULDER_HALF * 2 },
  gripPoint: SPADE_KNOB_RUN / SPADE_HANDLE_LENGTH,
  phases: 1,
  handleLook: { colour: SPADE_HAFT, butt: 'knob' },
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      paintSpadeHead(ctx, look, handle.headBase);
      return;
    }
    seenOnEdge(ctx, () => paintSpadeHead(ctx, look, handle.headBase));
    paintBladeEdgeGlint(
      ctx,
      handle.headBase,
      handle.headBase + SPADE_BLADE_LENGTH,
      SPADE_WORN_EDGE,
    );
  },
});
