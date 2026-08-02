/**
 * The four goblin weapons — sword, axe, mace and war hammer.
 *
 * Split out of `goblinArt.ts` because the weapons are as much of the art as the
 * body is: at 32 px the brief gives the ears and the weapon the whole job of
 * identifying which goblin a player is looking at, and the rig file is already
 * the biggest sprawl risk in this pipeline.
 *
 * Every painter works in **weapon-local space**: the origin is the primary
 * (near) hand, +X runs down the weapon toward its tip, and the caller has
 * already rotated by the wrist angle. Distances are tile units and come
 * straight from the brief's §3.3a table.
 *
 * Steel is bevelled along its own spine rather than lit from the scene's key
 * direction. A weapon swings through 180° in a single row, so any highlight
 * keyed to the world light would be wrong on most frames of every attack; an
 * edge bevel is both what a blade actually looks like and rotation-proof.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  FULL_CIRCLE_ANGLE,
  type GoblinPalette,
  type GoblinProp,
  type Ramp,
  lerp,
  mix,
  rgba,
} from './goblinArt';

// ── Shared material painters ─────────────────────────────────────────────────

/** Outline growth around every metal and wooden part, in tile units. */
const PART_OUTLINE = 0.014;
/** Where along a blade's width the bevel edge sits; 0 is the spine, 1 the edge. */
const BEVEL_FRACTION = 0.45;

/**
 * A tapered wooden haft with a bound grip, from `startX` to `endX` along +X.
 * The butt end is drawn thicker than the head end so the weapon reads as
 * something that was carved rather than extruded.
 */
function drawHaft(
  ctx: Ctx,
  startX: number,
  endX: number,
  buttHalfWidth: number,
  headHalfWidth: number,
  wood: Ramp,
  outline: string,
): void {
  const traceHaft = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(startX - grow, -buttHalfWidth - grow);
    ctx.lineTo(endX + grow, -headHalfWidth - grow);
    ctx.lineTo(endX + grow, headHalfWidth + grow);
    ctx.lineTo(startX - grow, buttHalfWidth + grow);
    ctx.closePath();
  };

  ctx.fillStyle = outline;
  traceHaft(PART_OUTLINE);
  ctx.fill();

  ctx.fillStyle = wood.mid;
  traceHaft(0);
  ctx.fill();

  // One lit edge and one shadowed one, along the haft's own length: a flat
  // brown bar is the fastest way to make a weapon look like a placeholder.
  ctx.fillStyle = rgba(wood.light, 0.75);
  ctx.beginPath();
  ctx.moveTo(startX, -buttHalfWidth);
  ctx.lineTo(endX, -headHalfWidth);
  ctx.lineTo(endX, -headHalfWidth * 0.3);
  ctx.lineTo(startX, -buttHalfWidth * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(wood.shadow, 0.55);
  ctx.beginPath();
  ctx.moveTo(startX, buttHalfWidth);
  ctx.lineTo(endX, headHalfWidth);
  ctx.lineTo(endX, headHalfWidth * 0.42);
  ctx.lineTo(startX, buttHalfWidth * 0.42);
  ctx.closePath();
  ctx.fill();
}

const WRAP_TURNS = 5;

/** Leather cord bound round the grip, drawn as diagonal turns. */
function drawWrap(
  ctx: Ctx,
  startX: number,
  endX: number,
  halfWidth: number,
  leather: Ramp,
  outline: string,
): void {
  ctx.fillStyle = outline;
  ctx.fillRect(startX, -halfWidth * 1.24, endX - startX, halfWidth * 2.48);
  ctx.fillStyle = leather.mid;
  ctx.fillRect(startX, -halfWidth * 1.15, endX - startX, halfWidth * 2.3);

  const turnWidth = (endX - startX) / WRAP_TURNS;
  const SKEW = 0.4;
  for (let i = 0; i < WRAP_TURNS; i++) {
    const x = startX + i * turnWidth;
    ctx.fillStyle = i % 2 === 0 ? rgba(leather.light, 0.6) : rgba(leather.shadow, 0.6);
    ctx.beginPath();
    ctx.moveTo(x, -halfWidth * 1.15);
    ctx.lineTo(x + turnWidth * 0.55, -halfWidth * 1.15);
    ctx.lineTo(x + turnWidth * (0.55 + SKEW), halfWidth * 1.15);
    ctx.lineTo(x + turnWidth * SKEW, halfWidth * 1.15);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Fill a traced steel shape: dark outline, body, a bevel band inset from the
 * cutting edge, and a few nicks. `traceShape(grow)` must trace the same path
 * expanded by `grow` in every direction.
 */
function paintSteel(
  ctx: Ctx,
  traceShape: (grow: number) => void,
  iron: Ramp,
  outline: string,
  bevel: () => void,
): void {
  ctx.fillStyle = outline;
  traceShape(PART_OUTLINE);
  ctx.fill();

  ctx.fillStyle = iron.mid;
  traceShape(0);
  ctx.fill();

  ctx.save();
  traceShape(0);
  ctx.clip();
  bevel();
  ctx.restore();
}

/** Pitting and rust flecks, so no goblin weapon looks like it was maintained. */
const PIT_COUNT = 5;

function paintPitting(
  ctx: Ctx,
  minX: number,
  maxX: number,
  halfHeight: number,
  iron: Ramp,
  leather: Ramp,
  seed: () => number,
): void {
  const RUST = 0.5;
  const rust = mix(iron.shadow, leather.dark, RUST);
  for (let i = 0; i < PIT_COUNT; i++) {
    const x = lerp(minX, maxX, seed());
    const y = lerp(-halfHeight, halfHeight, seed());
    const size = halfHeight * lerp(0.06, 0.16, seed());
    ctx.fillStyle = rgba(seed() > 0.6 ? rust : iron.shadow, 0.45);
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * 0.7, 0, 0, FULL_CIRCLE_ANGLE);
    ctx.fill();
  }
}

// ── Sword ────────────────────────────────────────────────────────────────────
//
// A straight cut-down arming sword the goblin took off a body: no fuller, a
// crossguard bent out of a bar, and a pommel that is just a lump of iron.

const SWORD_OVERHANG = 0.1;
const SWORD_TIP = 0.74;
const SWORD_GUARD_HALF_WIDTH = 0.11;
const SWORD_GUARD_THICKNESS = 0.035;
const SWORD_BLADE_HALF_WIDTH = 0.028;
const SWORD_GRIP_END = 0.055;
const SWORD_POMMEL_RADIUS = 0.045;
/** Where the blade stops widening and starts running to the point. */
const SWORD_TAPER_START = 0.58;

export function makeSwordProp(palette: GoblinPalette, seed: () => number): GoblinProp {
  const { iron, leather, outline } = palette;
  return {
    tipDistance: SWORD_TIP,
    offGripDistance: null,
    headHalfHeight: SWORD_GUARD_HALF_WIDTH,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);

      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.arc(-SWORD_OVERHANG, 0, SWORD_POMMEL_RADIUS * 1.2, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = iron.dark;
      ctx.beginPath();
      ctx.arc(-SWORD_OVERHANG, 0, SWORD_POMMEL_RADIUS, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = rgba(iron.light, 0.5);
      ctx.beginPath();
      ctx.arc(-SWORD_OVERHANG * 1.12, -SWORD_POMMEL_RADIUS * 0.3, SWORD_POMMEL_RADIUS * 0.4, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();

      drawWrap(ctx, -SWORD_OVERHANG * 0.6, SWORD_GRIP_END, SWORD_BLADE_HALF_WIDTH * 0.9, leather, outline);

      const traceGuard = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(SWORD_GRIP_END - grow, -SWORD_GUARD_HALF_WIDTH - grow);
        ctx.lineTo(SWORD_GRIP_END + SWORD_GUARD_THICKNESS + grow, -SWORD_GUARD_HALF_WIDTH * 0.72 - grow);
        ctx.lineTo(SWORD_GRIP_END + SWORD_GUARD_THICKNESS + grow, SWORD_GUARD_HALF_WIDTH * 0.72 + grow);
        ctx.lineTo(SWORD_GRIP_END - grow, SWORD_GUARD_HALF_WIDTH + grow);
        ctx.closePath();
      };
      paintSteel(ctx, traceGuard, iron, outline, () => {
        ctx.fillStyle = rgba(iron.light, 0.55);
        ctx.fillRect(SWORD_GRIP_END, -SWORD_GUARD_HALF_WIDTH, SWORD_GUARD_THICKNESS, SWORD_GUARD_HALF_WIDTH * 0.5);
      });

      const bladeStart = SWORD_GRIP_END + SWORD_GUARD_THICKNESS;
      const traceBlade = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(bladeStart - grow, -SWORD_BLADE_HALF_WIDTH - grow);
        ctx.lineTo(SWORD_TIP * SWORD_TAPER_START, -SWORD_BLADE_HALF_WIDTH - grow);
        ctx.lineTo(SWORD_TIP + grow, -SWORD_BLADE_HALF_WIDTH * 0.1);
        ctx.lineTo(SWORD_TIP + grow, SWORD_BLADE_HALF_WIDTH * 0.1);
        ctx.lineTo(SWORD_TIP * SWORD_TAPER_START, SWORD_BLADE_HALF_WIDTH + grow);
        ctx.lineTo(bladeStart - grow, SWORD_BLADE_HALF_WIDTH + grow);
        ctx.closePath();
      };
      paintSteel(ctx, traceBlade, iron, outline, () => {
        // The spine stays dark and the edge band catches the light, which is
        // what makes a flat quad read as a ground blade.
        ctx.fillStyle = rgba(iron.rim, 0.62);
        ctx.fillRect(
          bladeStart,
          -SWORD_BLADE_HALF_WIDTH,
          SWORD_TIP - bladeStart,
          SWORD_BLADE_HALF_WIDTH * BEVEL_FRACTION,
        );
        ctx.fillStyle = rgba(iron.shadow, 0.5);
        ctx.fillRect(
          bladeStart,
          SWORD_BLADE_HALF_WIDTH * 0.25,
          SWORD_TIP - bladeStart,
          SWORD_BLADE_HALF_WIDTH * 0.75,
        );
        paintPitting(ctx, bladeStart, SWORD_TIP, SWORD_BLADE_HALF_WIDTH, iron, leather, seed);
      });

      ctx.restore();
    },
  };
}

// ── Axe ──────────────────────────────────────────────────────────────────────
//
// A bearded hand axe on a short haft: the beard is the hook below the bit that
// catches at the end of the light cleave, so it has to be visible.

const AXE_OVERHANG = 0.3;
const AXE_TIP = 0.66;
/**
 * Negative: the off hand grips the *butt*, behind the lead hand, rather than up
 * the haft in front of it.
 *
 * A forward off grip put both fists within a hand's width of each other with the
 * off arm stretched flat along the wood, and at 0.34 — right under the head
 * socket — that arm had to span further than it is long, so the rig clamped it
 * and left the fist floating off the haft on most frames rather than gripping
 * it. Gripping behind gives the off arm slack to fold, so the two arms open into
 * a triangle with the haft as its long side. G14 asserts the result.
 */
const AXE_OFF_GRIP = -0.2;
/** Leather at each grip; the lead hand's, then the butt the off hand holds. */
const AXE_LEAD_WRAP: readonly [number, number] = [-0.08, 0.11];
const AXE_BUTT_WRAP: readonly [number, number] = [-0.27, -0.13];
const AXE_HAFT_HALF_WIDTH = 0.028;
/**
 * The bit hangs off the **side** of the haft, and the haft carries on past it.
 *
 * The first version ran the bit forward along the haft to its far end, which
 * makes a symmetric slab mounted terminal to a stick — and four blind silhouette
 * reviews running named that a shovel, never an axe. What identifies an axe in
 * black at 32 px is the bit sitting beside the shaft with the shaft protruding
 * beyond it, and a beard dropping much further below the axis than the poll
 * rises above it.
 */
const AXE_EYE_START = 0.28;
const AXE_EYE_END = 0.5;
/** How far the cutting edge stands off the haft's axis, on the bit side. */
const AXE_BIT_DROP = 0.2;
/** The poll: the small counterweight on the other side of the eye. */
const AXE_BIT_RISE = 0.075;
const AXE_BEARD_START = 0.22;
const AXE_BEARD_END = 0.56;

export function makeAxeProp(palette: GoblinPalette, seed: () => number): GoblinProp {
  const { iron, leather, wood, outline } = palette;
  return {
    tipDistance: AXE_TIP,
    offGripDistance: AXE_OFF_GRIP,
    headHalfHeight: AXE_BIT_DROP,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);

      // Full length, and drawn first: the haft runs past the eye and out the far
      // side of the head, which is the detail that stops the bit reading as a
      // blade mounted on the end of a stick.
      drawHaft(ctx, -AXE_OVERHANG, AXE_TIP, AXE_HAFT_HALF_WIDTH * 1.15, AXE_HAFT_HALF_WIDTH * 0.85, wood, outline);
      drawWrap(ctx, AXE_LEAD_WRAP[0], AXE_LEAD_WRAP[1], AXE_HAFT_HALF_WIDTH, leather, outline);
      drawWrap(ctx, AXE_BUTT_WRAP[0], AXE_BUTT_WRAP[1], AXE_HAFT_HALF_WIDTH, leather, outline);

      const traceHead = (grow: number): void => {
        ctx.beginPath();
        // Poll: a stub of counterweight on the far side of the haft from the bit.
        ctx.moveTo(AXE_EYE_START - grow, -AXE_BIT_RISE - grow);
        ctx.lineTo(AXE_EYE_END + grow, -AXE_BIT_RISE - grow);
        // Upper cheek, sweeping off the eye down toward the top horn.
        ctx.quadraticCurveTo(
          AXE_EYE_END + grow,
          AXE_BIT_DROP * 0.35,
          AXE_BEARD_END + grow,
          AXE_BIT_DROP * 0.72 + grow,
        );
        // The cutting edge, bellied out into a convex arc. A flat bottom edge is
        // what makes a slab under a stick read as a spade, so the edge has to
        // curve away from the haft and back.
        ctx.quadraticCurveTo(
          AXE_BEARD_END * 0.9,
          AXE_BIT_DROP * 1.3 + grow * 1.4,
          (AXE_BEARD_START + AXE_BEARD_END) / 2,
          AXE_BIT_DROP * 1.34 + grow,
        );
        ctx.quadraticCurveTo(
          AXE_BEARD_START * 0.9,
          AXE_BIT_DROP * 1.2 + grow,
          AXE_BEARD_START - grow,
          AXE_BIT_DROP * 0.78 + grow,
        );
        // The beard hooks back toward the haft, well behind the eye — the hook
        // that catches at the end of the light cleave.
        ctx.quadraticCurveTo(
          AXE_EYE_START - grow,
          AXE_BIT_DROP * 0.5,
          AXE_EYE_START - grow,
          -AXE_BIT_RISE - grow,
        );
        ctx.closePath();
      };

      paintSteel(ctx, traceHead, iron, outline, () => {
        // The bevel runs along the edge itself, which is the outer arc.
        ctx.fillStyle = rgba(iron.rim, 0.6);
        ctx.beginPath();
        ctx.moveTo(AXE_BEARD_END, AXE_BIT_DROP * 0.66);
        ctx.lineTo(AXE_BEARD_END * 0.86, AXE_BIT_DROP);
        ctx.lineTo(AXE_BEARD_START, AXE_BIT_DROP * 0.94);
        ctx.lineTo(AXE_BEARD_START, AXE_BIT_DROP * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba(iron.shadow, 0.45);
        ctx.fillRect(AXE_EYE_START, -AXE_BIT_RISE, AXE_EYE_END - AXE_EYE_START, AXE_BIT_DROP * 0.5);
        paintPitting(ctx, AXE_EYE_START, AXE_BEARD_END, AXE_BIT_DROP * 0.5, iron, leather, seed);
      });

      // The socket band, which is what stops the head reading as a sticker.
      ctx.fillStyle = outline;
      ctx.fillRect(AXE_EYE_END - 0.02, -AXE_HAFT_HALF_WIDTH * 2, 0.028, AXE_HAFT_HALF_WIDTH * 4);
      ctx.fillStyle = iron.dark;
      ctx.fillRect(AXE_EYE_END - 0.016, -AXE_HAFT_HALF_WIDTH * 1.7, 0.02, AXE_HAFT_HALF_WIDTH * 3.4);

      ctx.restore();
    },
  };
}

// ── Mace ─────────────────────────────────────────────────────────────────────
//
// A short flanged mace, one-handed and top-heavy. The flanges are what make it
// read as a mace rather than as a lollipop at 32 px, so they are drawn proud.

const MACE_OVERHANG = 0.09;
const MACE_TIP = 0.56;
const MACE_HEAD_RADIUS = 0.135;
const MACE_FLANGE_COUNT = 5;
const MACE_FLANGE_REACH = 1.52;
const MACE_HAFT_HALF_WIDTH = 0.025;
const MACE_BUTT_LENGTH = 0.055;

export function makeMaceProp(palette: GoblinPalette, seed: () => number): GoblinProp {
  const { iron, leather, wood, outline } = palette;
  const headCentre = MACE_TIP - MACE_HEAD_RADIUS * MACE_FLANGE_REACH;
  return {
    tipDistance: MACE_TIP,
    offGripDistance: null,
    headHalfHeight: MACE_HEAD_RADIUS * MACE_FLANGE_REACH,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);

      drawHaft(ctx, -MACE_OVERHANG, headCentre, MACE_HAFT_HALF_WIDTH * 1.2, MACE_HAFT_HALF_WIDTH, wood, outline);
      drawWrap(ctx, -MACE_OVERHANG * 0.7, MACE_OVERHANG * 1.6, MACE_HAFT_HALF_WIDTH, leather, outline);

      const traceFlanges = (grow: number): void => {
        ctx.beginPath();
        for (let i = 0; i < MACE_FLANGE_COUNT; i++) {
          const angle = (i / MACE_FLANGE_COUNT) * FULL_CIRCLE_ANGLE;
          const halfStep = FULL_CIRCLE_ANGLE / (MACE_FLANGE_COUNT * 2);
          // Alternating flange lengths: an evenly-spoked head is a shuriken.
          const FLANGE_STAGGER = 0.16;
          const stagger = 1 - (i % 2) * FLANGE_STAGGER;
          const reach = MACE_HEAD_RADIUS * MACE_FLANGE_REACH * stagger + grow;
          const root = MACE_HEAD_RADIUS * 0.58 + grow;
          const tipX = headCentre + Math.cos(angle) * reach;
          const tipY = Math.sin(angle) * reach;
          const beforeX = headCentre + Math.cos(angle - halfStep) * root;
          const beforeY = Math.sin(angle - halfStep) * root;
          const afterX = headCentre + Math.cos(angle + halfStep) * root;
          const afterY = Math.sin(angle + halfStep) * root;
          if (i === 0) ctx.moveTo(beforeX, beforeY);
          else ctx.lineTo(beforeX, beforeY);
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(afterX, afterY);
        }
        ctx.closePath();
      };

      paintSteel(ctx, traceFlanges, iron, outline, () => {
        ctx.fillStyle = rgba(iron.rim, 0.5);
        ctx.beginPath();
        ctx.arc(
          headCentre - MACE_HEAD_RADIUS * 0.3,
          -MACE_HEAD_RADIUS * 0.35,
          MACE_HEAD_RADIUS * 0.85,
          0,
          FULL_CIRCLE_ANGLE,
        );
        ctx.fill();
        paintPitting(ctx, headCentre - MACE_HEAD_RADIUS, MACE_TIP, MACE_HEAD_RADIUS, iron, leather, seed);
      });

      // A core disc behind the flanges, so the head has a body and the flanges
      // do not read as a loose star.
      ctx.fillStyle = iron.dark;
      ctx.beginPath();
      ctx.arc(headCentre, 0, MACE_HEAD_RADIUS * 0.72, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();
      ctx.fillStyle = rgba(iron.light, 0.4);
      ctx.beginPath();
      ctx.arc(headCentre - MACE_HEAD_RADIUS * 0.24, -MACE_HEAD_RADIUS * 0.28, MACE_HEAD_RADIUS * 0.34, 0, FULL_CIRCLE_ANGLE);
      ctx.fill();

      // A knurled iron butt behind the hand, so the weapon's outline is never
      // symmetric about its head.
      const traceButt = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(-MACE_OVERHANG + grow, -MACE_HAFT_HALF_WIDTH * 1.9 - grow);
        ctx.lineTo(-MACE_OVERHANG - MACE_BUTT_LENGTH - grow, -MACE_HAFT_HALF_WIDTH - grow);
        ctx.lineTo(-MACE_OVERHANG - MACE_BUTT_LENGTH - grow, MACE_HAFT_HALF_WIDTH + grow);
        ctx.lineTo(-MACE_OVERHANG + grow, MACE_HAFT_HALF_WIDTH * 1.9 + grow);
        ctx.closePath();
      };
      paintSteel(ctx, traceButt, iron, outline, () => {
        ctx.fillStyle = rgba(iron.light, 0.5);
        ctx.fillRect(
          -MACE_OVERHANG - MACE_BUTT_LENGTH,
          -MACE_HAFT_HALF_WIDTH * 1.9,
          MACE_BUTT_LENGTH,
          MACE_HAFT_HALF_WIDTH,
        );
      });

      ctx.restore();
    },
  };
}

// ── War hammer ───────────────────────────────────────────────────────────────
//
// A pit-hammer head on a haft nearly as long as the goblin is tall: a face on
// one side, a spike on the other, and the whole thing plainly too heavy for the
// creature holding it. Its 1.00 reach is the loudest silhouette signal in the set.
//
// Swung **one-handed**, which is a deliberate retreat rather than an oversight.
// Two hands on this haft never read: the goblin's arms are shorter than the
// separation a two-handed grip needs, so a forward off grip stacked both fists
// on the same few pixels and left the off arm stretched flat along the wood,
// while a butt grip folded that arm into a lump against the chest. Three
// attempts, none of them clean. One hand on the grip and the other swinging free
// as a counterweight costs nothing that reads at 32 px, and a hammer this size
// held in one fist sells "too heavy for the creature" better than a correct grip
// ever did.

const HAMMER_OVERHANG = 0.24;
const HAMMER_TIP = 1.0;
/** Leather around the one grip there is. */
const HAMMER_GRIP_WRAP: readonly [number, number] = [-0.14, 0.14];
const HAMMER_HAFT_HALF_WIDTH = 0.034;
/**
 * The head is mounted **across** the haft near its far end, not on the end of it,
 * and it is one clean rectangular block.
 *
 * As a slab running along the axis it was the same shape as the old axe head and
 * a blind review named both "shovel". The first correction added a spike out the
 * far side to make a T — which cost the hammer its identity outright: at 32 px
 * the spike is two pixels, adds no information, and turns a rectangle into an
 * irregular radiating star, so the next review read the war hammer as a
 * *morningstar* and the mace as a hammer. The two archetypes swapped. A blunt
 * rectangle with flat parallel edges is the whole read; nothing else in the set
 * is a clean rectangle.
 */
const HAMMER_EYE_START = 0.6;
const HAMMER_EYE_END = 0.92;
/** Half-height of the block, which straddles the haft evenly either side. */
const HAMMER_FACE_HALF = 0.145;

export function makeWarhammerProp(palette: GoblinPalette, seed: () => number): GoblinProp {
  const { iron, leather, wood, outline } = palette;
  return {
    tipDistance: HAMMER_TIP,
    offGripDistance: null,
    // The face, not the spike: the spike stands off the *other* side of the eye,
    // so it is the face that decides how close the head can get to the floor.
    headHalfHeight: HAMMER_FACE_HALF,
    paint: (ctx, hand, wristAngle) => {
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(wristAngle);

      drawHaft(ctx, -HAMMER_OVERHANG, HAMMER_TIP, HAMMER_HAFT_HALF_WIDTH * 1.2, HAMMER_HAFT_HALF_WIDTH * 0.9, wood, outline);
      drawWrap(ctx, HAMMER_GRIP_WRAP[0], HAMMER_GRIP_WRAP[1], HAMMER_HAFT_HALF_WIDTH, leather, outline);

      // A blunt rectangle straddling the haft. Flat parallel edges on purpose:
      // it is the only clean rectangle in the weapon set, and that is the whole
      // of the war hammer's identity at 32 px.
      const traceFace = (grow: number): void => {
        ctx.beginPath();
        ctx.moveTo(HAMMER_EYE_START - grow, -HAMMER_FACE_HALF - grow);
        ctx.lineTo(HAMMER_EYE_END + grow, -HAMMER_FACE_HALF - grow);
        ctx.lineTo(HAMMER_EYE_END + grow, HAMMER_FACE_HALF + grow);
        ctx.lineTo(HAMMER_EYE_START - grow, HAMMER_FACE_HALF + grow);
        ctx.closePath();
      };
      paintSteel(ctx, traceFace, iron, outline, () => {
        ctx.fillStyle = rgba(iron.rim, 0.45);
        ctx.fillRect(
          HAMMER_EYE_START,
          -HAMMER_FACE_HALF,
          HAMMER_EYE_END - HAMMER_EYE_START,
          HAMMER_FACE_HALF * 0.5,
        );
        // The struck face is battered flat and brighter than the rest.
        ctx.fillStyle = rgba(iron.light, 0.55);
        ctx.fillRect(
          HAMMER_EYE_END - (HAMMER_EYE_END - HAMMER_EYE_START) * 0.16,
          -HAMMER_FACE_HALF,
          (HAMMER_EYE_END - HAMMER_EYE_START) * 0.16,
          HAMMER_FACE_HALF * 2,
        );
        paintPitting(ctx, HAMMER_EYE_START, HAMMER_EYE_END, HAMMER_FACE_HALF, iron, leather, seed);
      });

      // The langets: iron straps down the haft either side of the eye, which is
      // what stops the head reading as a sticker laid over the wood.
      ctx.fillStyle = iron.dark;
      ctx.fillRect(HAMMER_EYE_START - 0.03, -HAMMER_HAFT_HALF_WIDTH * 1.6, 0.026, HAMMER_HAFT_HALF_WIDTH * 3.2);
      ctx.fillRect(HAMMER_EYE_END + 0.008, -HAMMER_HAFT_HALF_WIDTH * 1.6, 0.026, HAMMER_HAFT_HALF_WIDTH * 3.2);

      ctx.restore();
    },
  };
}

/** Every weapon, keyed the same way the archetypes are. */
export const WEAPON_FACTORIES = {
  sword: makeSwordProp,
  axe: makeAxeProp,
  mace: makeMaceProp,
  warhammer: makeWarhammerProp,
} as const;
