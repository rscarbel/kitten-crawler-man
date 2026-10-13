/**
 * Three weapons that exist as nothing but data: a plain arming sword (a light
 * one-hander), a spiked club (a heavy one-hander) and a two-handed felling
 * axe. Each is an item, a stat block and this look; no row, overlay or combat
 * code knows them by name.
 */

import type { Pt } from '../../art/carlArt';
import { addCapsule, shadeForm } from '../../art/carl/paint';
import { deriveRamp, receded, FAR_LIMB_SHADE } from '../../art/carl/palette';
import { defineHeldVisual, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill } from '../heldPaint';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';

type Ctx = CanvasRenderingContext2D;

const STEEL = '#9aa1ab';
const STEEL_LIT = '#d3d8de';
const STEEL_EDGE = '#f1f4f7';
const IRON = '#5d6066';
const IRON_LIT = '#8a8e95';
const LEATHER_GRIP = '#4a2e1f';

// ── Plain arming sword ───────────────────────────────────────────────────────

const SWORD_HANDLE_LENGTH = 0.17;
const SWORD_GRIP_POINT = 0.5;
const SWORD_BLADE_LENGTH = 0.62;
const SWORD_BLADE_HALF = 0.03;
/** Where the edges begin closing to the point, as a share of the blade. */
const SWORD_TAPER_FROM = 0.8;
const SWORD_GUARD_HALF_SPAN = 0.085;
const SWORD_GUARD_HALF_THICK = 0.018;
const SWORD_FULLER_WIDTH = 0.01;
const SWORD_FULLER_FROM = 0.05;
const SWORD_FULLER_TO = 0.7;

function traceSwordBlade(ctx: Ctx, base: number): void {
  const taper = base + SWORD_BLADE_LENGTH * SWORD_TAPER_FROM;
  const tip = base + SWORD_BLADE_LENGTH;
  ctx.beginPath();
  ctx.moveTo(base, -SWORD_BLADE_HALF);
  ctx.lineTo(taper, -SWORD_BLADE_HALF);
  ctx.lineTo(tip, 0);
  ctx.lineTo(taper, SWORD_BLADE_HALF);
  ctx.lineTo(base, SWORD_BLADE_HALF);
  ctx.closePath();
}

function traceSwordGuard(ctx: Ctx, base: number): void {
  ctx.beginPath();
  ctx.rect(
    base - SWORD_GUARD_HALF_THICK,
    -SWORD_GUARD_HALF_SPAN,
    SWORD_GUARD_HALF_THICK * 2,
    SWORD_GUARD_HALF_SPAN * 2,
  );
}

/** The blade's two bevels meet at the ridge; the one turned to the key light is pale. */
function paintSwordBlade(ctx: Ctx, look: HeldLook, base: number): void {
  traceSwordBlade(ctx, base);
  outlineAndFill(ctx, heldShade(STEEL, look));
  ctx.save();
  traceSwordBlade(ctx, base);
  ctx.clip();
  const litSide = look.light.y < 0 ? -1 : 1;
  ctx.fillStyle = heldShade(STEEL_LIT, look);
  ctx.fillRect(base, litSide < 0 ? -SWORD_BLADE_HALF : 0, SWORD_BLADE_LENGTH, SWORD_BLADE_HALF);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(base + SWORD_BLADE_LENGTH * SWORD_FULLER_FROM, 0);
  ctx.lineTo(base + SWORD_BLADE_LENGTH * SWORD_FULLER_TO, 0);
  ctx.strokeStyle = heldShade(STEEL_EDGE, look);
  ctx.lineWidth = SWORD_FULLER_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  traceSwordGuard(ctx, base);
  outlineAndFill(ctx, heldShade(IRON, look));
}

export const PLAIN_ARMING_SWORD = defineHeldVisual({
  id: 'plain_arming_sword',
  name: 'Plain arming sword',
  archetype: 'oneHandHaft',
  weight: 'light',
  handle: { length: SWORD_HANDLE_LENGTH, radius: 'thin' },
  head: { length: SWORD_BLADE_LENGTH + SWORD_GUARD_HALF_THICK, width: SWORD_GUARD_HALF_SPAN * 2 },
  gripPoint: SWORD_GRIP_POINT,
  phases: 1,
  handleLook: { colour: LEATHER_GRIP, butt: 'knob' },
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      paintSwordBlade(ctx, look, handle.headBase);
      return;
    }
    seenOnEdge(ctx, () => paintSwordBlade(ctx, look, handle.headBase));
    paintBladeEdgeGlint(ctx, handle.headBase, handle.headBase + SWORD_BLADE_LENGTH, STEEL_EDGE);
  },
});

// ── Spiked club ──────────────────────────────────────────────────────────────

const CLUB_HANDLE_LENGTH = 0.3;
const CLUB_GRIP_POINT = 0.3;
const CLUB_HEAD_LENGTH = 0.34;
/** The head swells from the handle's girth at its neck to this at its crown. */
const CLUB_NECK_HALF = 0.04;
const CLUB_CROWN_HALF = 0.075;
const CLUB_WOOD = deriveRamp('#7a5230');
/** Spikes stand off the head in two rows, staggered, at these shares of its length. */
const CLUB_SPIKES_NEAR: readonly number[] = [0.35, 0.65, 0.92];
const CLUB_SPIKES_FAR: readonly number[] = [0.5, 0.8];
const CLUB_SPIKE_LENGTH = 0.07;
const CLUB_SPIKE_HALF_BASE = 0.024;
/** The crown carries one spike straight out of its end. */
const CLUB_CROWN_SPIKE_LENGTH = 0.045;

function clubHalfAt(share: number): number {
  return CLUB_NECK_HALF + (CLUB_CROWN_HALF - CLUB_NECK_HALF) * share;
}

function traceSpike(ctx: Ctx, root: Pt, outward: Pt, length: number): void {
  const across = { x: -outward.y, y: outward.x };
  ctx.moveTo(root.x + across.x * CLUB_SPIKE_HALF_BASE, root.y + across.y * CLUB_SPIKE_HALF_BASE);
  ctx.lineTo(root.x + outward.x * length, root.y + outward.y * length);
  ctx.lineTo(root.x - across.x * CLUB_SPIKE_HALF_BASE, root.y - across.y * CLUB_SPIKE_HALF_BASE);
  ctx.closePath();
}

function paintClubHead(ctx: Ctx, look: HeldLook, base: number): void {
  const neck = { x: base, y: 0 };
  const crown = { x: base + CLUB_HEAD_LENGTH, y: 0 };
  ctx.beginPath();
  const spikeRows: readonly (readonly [readonly number[], number])[] = [
    [CLUB_SPIKES_NEAR, 1],
    [CLUB_SPIKES_FAR, -1],
  ];
  for (const [shares, side] of spikeRows) {
    for (const share of shares) {
      const root = { x: base + CLUB_HEAD_LENGTH * share, y: side * clubHalfAt(share) };
      traceSpike(ctx, root, { x: 0, y: side }, CLUB_SPIKE_LENGTH);
    }
  }
  traceSpike(ctx, { x: crown.x + CLUB_CROWN_HALF, y: 0 }, { x: 1, y: 0 }, CLUB_CROWN_SPIKE_LENGTH);
  outlineAndFill(ctx, heldShade(STEEL_LIT, look));

  const wood = receded(CLUB_WOOD, look.shaded ? FAR_LIMB_SHADE : 0);
  const traceHead = (): void => {
    ctx.beginPath();
    addCapsule(ctx, neck, crown, CLUB_NECK_HALF, CLUB_CROWN_HALF);
  };
  traceHead();
  outlineAndFill(ctx, wood.base);
  shadeForm(ctx, traceHead, { from: neck, to: crown }, wood, {
    halfWidth: CLUB_CROWN_HALF,
    frameRotation: look.frameRotation,
    fillBase: false,
  });
}

export const SPIKED_CLUB = defineHeldVisual({
  id: 'spiked_club',
  name: 'Spiked club',
  archetype: 'oneHandHaft',
  weight: 'heavy',
  handle: { length: CLUB_HANDLE_LENGTH, radius: 'thick' },
  head: {
    length: CLUB_HEAD_LENGTH + CLUB_CROWN_HALF + CLUB_CROWN_SPIKE_LENGTH,
    width: (CLUB_CROWN_HALF + CLUB_SPIKE_LENGTH) * 2,
  },
  gripPoint: CLUB_GRIP_POINT,
  phases: 1,
  handleLook: { colour: LEATHER_GRIP, butt: 'knob' },
  paintHead: (ctx, look, handle) => paintClubHead(ctx, look, handle.headBase),
});

// ── Felling axe ──────────────────────────────────────────────────────────────

const AXE_KNOB_RUN = 0.05;
const AXE_HANDLE_LENGTH = 1.12;
const AXE_ASH = '#a07a48';
/** The eye wraps the haft's end; the bit stands off it on the leading side, the poll on the other. */
const AXE_EYE_HALF_ALONG = 0.05;
const AXE_POLL_REACH = 0.07;
const AXE_BIT_REACH = 0.3;
/** A felling bit is long and narrow, flaring evenly to a gently curved edge. */
const AXE_BIT_HALF_AT_EYE = 0.045;
const AXE_BIT_HALF_AT_EDGE = 0.12;
const AXE_EDGE_BELLY = 0.03;
const AXE_EDGE_BAND = 0.035;
/** The head sits this far back from the haft's end, so the haft shows through the eye's top. */
const AXE_HEAD_SET_BACK = 0.04;

function traceAxeHead(ctx: Ctx, eyeX: number): void {
  ctx.beginPath();
  ctx.moveTo(eyeX - AXE_EYE_HALF_ALONG, -AXE_POLL_REACH);
  ctx.lineTo(eyeX + AXE_EYE_HALF_ALONG, -AXE_POLL_REACH);
  ctx.lineTo(eyeX + AXE_BIT_HALF_AT_EYE, 0);
  ctx.lineTo(eyeX + AXE_BIT_HALF_AT_EDGE, AXE_BIT_REACH);
  ctx.quadraticCurveTo(
    eyeX,
    AXE_BIT_REACH + AXE_EDGE_BELLY * 2,
    eyeX - AXE_BIT_HALF_AT_EDGE,
    AXE_BIT_REACH,
  );
  ctx.lineTo(eyeX - AXE_BIT_HALF_AT_EYE, 0);
  ctx.closePath();
}

function paintFellingAxeHead(ctx: Ctx, look: HeldLook, base: number): void {
  const eyeX = base - AXE_HEAD_SET_BACK;
  traceAxeHead(ctx, eyeX);
  outlineAndFill(ctx, heldShade(IRON, look));
  ctx.save();
  traceAxeHead(ctx, eyeX);
  ctx.clip();
  const litAlong = look.light.x < 0 ? -1 : 1;
  ctx.fillStyle = heldShade(IRON_LIT, look);
  ctx.fillRect(
    litAlong < 0 ? eyeX - AXE_BIT_HALF_AT_EDGE : eyeX,
    -AXE_POLL_REACH,
    AXE_BIT_HALF_AT_EDGE,
    AXE_POLL_REACH + AXE_BIT_REACH + AXE_EDGE_BELLY * 2,
  );
  ctx.beginPath();
  ctx.moveTo(eyeX + AXE_BIT_HALF_AT_EDGE, AXE_BIT_REACH);
  ctx.quadraticCurveTo(
    eyeX,
    AXE_BIT_REACH + AXE_EDGE_BELLY * 2,
    eyeX - AXE_BIT_HALF_AT_EDGE,
    AXE_BIT_REACH,
  );
  ctx.strokeStyle = heldShade(STEEL_EDGE, look);
  ctx.lineWidth = AXE_EDGE_BAND;
  ctx.stroke();
  ctx.restore();
}

export const FELLING_AXE = defineHeldVisual({
  id: 'felling_axe',
  name: 'Felling axe',
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: AXE_HANDLE_LENGTH, radius: 'standard' },
  head: {
    length: AXE_BIT_HALF_AT_EDGE * 2,
    width: AXE_POLL_REACH + AXE_BIT_REACH + AXE_EDGE_BELLY,
  },
  gripPoint: AXE_KNOB_RUN / AXE_HANDLE_LENGTH,
  phases: 1,
  handleLook: { colour: AXE_ASH, butt: 'knob' },
  paintHead: (ctx, look, handle) => paintFellingAxeHead(ctx, look, handle.headBase),
});
