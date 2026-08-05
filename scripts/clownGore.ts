/**
 * The six pieces the Evil Clown comes apart into.
 *
 * The cut face is not here — `scripts/goreWound.ts` owns that, and every wound
 * below routes through it so a dismembered clown's injuries are recognisably
 * the same ones a dismembered rat or llama has. What is here is the shape of
 * each piece and the costume still on it.
 *
 * The set is chosen for **silhouette**, not for anatomy: six cells tumbling
 * past at 16 px must not read as six identical dark blobs. So it spreads across
 * a pale sphere with the grin still on it (the head — nothing else in the game
 * drops anything that shape), a pleated ring (the ruff), a long harlequin slab
 * (the torso), a splayed oversized shoe, a spindly limb ending in a white glove,
 * and a fistful of unbroken vials still bleeding gas.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. The runtime pivots on the frame's *measured ink centre* rather than on
 * that origin (see `drawSpriteRotatedCenter`), so a piece painted off-centre
 * still tumbles in place.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import { TWO_PI, deg, lerp, mix, ovalOutline, rgba, traceOutline, type Pt } from './ratArt';
import {
  AMBIENT_ALPHA,
  BLOOD,
  BLOOD_DARK,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  RIM_ALPHA,
  drawWound,
  grownOutline,
  type CutSpec,
} from './goreWound';
import { type ClownPalette, type ClownStyle } from './clownArt';

/** Ambient top-light and rim, applied to every piece so none depends on its spin. */
const AMBIENT_LIGHT = '#fff6e6';
const RIM_LIGHT = '#bed7ff';

/**
 * Paint a closed piece: ink border, body fill, ambient wash, rim.
 *
 * Every piece shares this so the whole set holds together as one corpse rather
 * than as six unrelated props.
 */
function paintPiece(ctx: Ctx, outline: readonly Pt[], fill: string, outlineColor: string): void {
  traceOutline(ctx, grownOutline(outline, FLESH_OUTLINE_GROW));
  ctx.fillStyle = outlineColor;
  ctx.fill();

  traceOutline(ctx, outline);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  traceOutline(ctx, grownOutline(outline, -FLESH_AMBIENT_INSET));
  ctx.fillStyle = rgba(AMBIENT_LIGHT, AMBIENT_ALPHA);
  ctx.fill();
  ctx.restore();

  ctx.save();
  traceOutline(ctx, grownOutline(outline, -FLESH_RIM_INSET));
  ctx.strokeStyle = rgba(RIM_LIGHT, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/** Blood pooled and running off a piece, always away from its cut. */
function paintDrips(ctx: Ctx, from: Pt, runAngle: number, radius: number, seed: number): void {
  const DRIP_COUNT = 4;
  const DRIP_SPREAD = deg(38);
  for (let i = 0; i < DRIP_COUNT; i++) {
    const t = (i + 0.5) / DRIP_COUNT;
    const angle = runAngle + lerp(-DRIP_SPREAD, DRIP_SPREAD, t);
    const length = radius * lerp(0.5, 1.25, ((seed * (i + 3)) % 7) / 7);
    const width = radius * lerp(0.16, 0.3, ((seed * (i + 5)) % 5) / 5);
    ctx.fillStyle = i % 2 === 0 ? BLOOD : BLOOD_DARK;
    ctx.beginPath();
    ctx.ellipse(
      from.x + Math.cos(angle) * length * 0.6,
      from.y + Math.sin(angle) * length * 0.6,
      length * 0.55,
      width,
      angle,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** Every piece's wound shares these, so only what differs is stated per piece. */
function cut(palette: ClownPalette, spec: Omit<CutSpec, 'hide'>): CutSpec {
  return { ...spec, hide: palette.skinShade };
}

// ── The pieces ───────────────────────────────────────────────────────────────

const HEAD_RADIUS = 0.34;

/**
 * The head, grin intact. The single most important piece in the set: it is the
 * one that makes a player who has just killed this thing look at the floor.
 */
function paintHead(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const skull = ovalOutline(0, -0.03, HEAD_RADIUS * 0.92, HEAD_RADIUS, deg(-8), 3, 0.05);

  // Hanks first, so they lie under the skull the way they do on the living head.
  ctx.fillStyle = palette.hairShade;
  for (let i = 0; i < 5; i++) {
    const angle = lerp(deg(120), deg(300), i / 4);
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * HEAD_RADIUS * 0.9,
      Math.sin(angle) * HEAD_RADIUS * 0.9 + HEAD_RADIUS * 0.3,
      HEAD_RADIUS * 0.16,
      HEAD_RADIUS * 0.5,
      angle + deg(90),
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  paintPiece(ctx, skull, palette.paint, palette.outline);

  ctx.save();
  traceOutline(ctx, skull);
  ctx.clip();

  // Two black pits and a grin, tipped with the head — the face is the identity.
  ctx.fillStyle = palette.paintMark;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(
      side * HEAD_RADIUS * 0.36,
      -HEAD_RADIUS * 0.16,
      HEAD_RADIUS * 0.23,
      HEAD_RADIUS * 0.44,
      deg(-8),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.fillStyle = palette.eyeCore;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(side * HEAD_RADIUS * 0.36, -HEAD_RADIUS * 0.14, HEAD_RADIUS * 0.09, 0, TWO_PI);
    ctx.fill();
  }

  const grinY = HEAD_RADIUS * 0.36;
  const grinHalf = HEAD_RADIUS * 0.62;
  ctx.fillStyle = palette.mouthDark;
  ctx.beginPath();
  ctx.moveTo(-grinHalf, grinY - HEAD_RADIUS * 0.2);
  ctx.quadraticCurveTo(0, grinY + HEAD_RADIUS * 0.5, grinHalf, grinY - HEAD_RADIUS * 0.2);
  ctx.quadraticCurveTo(0, grinY + HEAD_RADIUS * 0.02, -grinHalf, grinY - HEAD_RADIUS * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.teeth;
  const TOOTH_COUNT = 6;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const x = lerp(-grinHalf * 0.85, grinHalf * 0.85, (i + 0.5) / TOOTH_COUNT);
    ctx.fillRect(x, grinY - HEAD_RADIUS * 0.18, grinHalf * 0.16, HEAD_RADIUS * 0.16);
  }
  ctx.restore();

  drawWound(
    ctx,
    cut(palette, {
      kind: 'torn',
      centre: { x: 0, y: HEAD_RADIUS * 0.86 },
      radius: HEAD_RADIUS * 0.42,
      squash: 0.5,
      angle: deg(4),
      bones: [{ at: { x: 0, y: 0 }, size: 0.5, hollow: true }],
      runAngle: deg(90),
      seed: 11,
    }),
  );
  paintDrips(ctx, { x: 0, y: HEAD_RADIUS * 1.0 }, deg(90), HEAD_RADIUS * 0.5, 11);
}

const RUFF_RADIUS = 0.3;

/** The ruff, torn off the neck: a pleated ring, yellowed and now soaked. */
function paintRuff(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const LOBE_COUNT = 9;
  for (let i = 0; i < LOBE_COUNT; i++) {
    const angle = (i / LOBE_COUNT) * TWO_PI;
    const lobe = ovalOutline(
      Math.cos(angle) * RUFF_RADIUS * 0.72,
      Math.sin(angle) * RUFF_RADIUS * 0.52,
      RUFF_RADIUS * 0.34,
      RUFF_RADIUS * 0.28,
      angle,
      i + 2,
      0.09,
    );
    paintPiece(ctx, lobe, i % 2 === 0 ? palette.ruff : palette.ruffShade, palette.outline);
  }
  // A ring with nothing in the middle is a doughnut; the stain is what says it
  // came off something that was bleeding.
  ctx.fillStyle = rgba(BLOOD, 0.75);
  ctx.beginPath();
  ctx.ellipse(0, 0, RUFF_RADIUS * 0.42, RUFF_RADIUS * 0.3, 0, 0, TWO_PI);
  ctx.fill();
  paintDrips(ctx, { x: 0, y: RUFF_RADIUS * 0.3 }, deg(80), RUFF_RADIUS * 0.5, 5);
}

const TORSO_HALF_WIDTH = 0.19;
const TORSO_HALF_HEIGHT = 0.36;

/** The trunk in its harlequin suit, opened at both ends. */
function paintTorso(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const shell = ovalOutline(0, 0, TORSO_HALF_WIDTH, TORSO_HALF_HEIGHT, deg(6), 7, 0.07);
  paintPiece(ctx, shell, palette.suitMid, palette.outline);

  ctx.save();
  traceOutline(ctx, shell);
  ctx.clip();
  const CELL_COLUMNS = 3;
  const CELL_ROWS = 5;
  const cellW = (TORSO_HALF_WIDTH * 2) / CELL_COLUMNS;
  const cellH = (TORSO_HALF_HEIGHT * 2) / CELL_ROWS;
  ctx.fillStyle = palette.suitLight;
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let col = -CELL_COLUMNS; col <= CELL_COLUMNS; col++) {
      if ((row + col) % 2 !== 0) continue;
      const cx = col * cellW * 0.5;
      const cy = -TORSO_HALF_HEIGHT + (row + 0.5) * cellH;
      ctx.beginPath();
      ctx.moveTo(cx, cy - cellH * 0.5);
      ctx.lineTo(cx + cellW * 0.5, cy);
      ctx.lineTo(cx, cy + cellH * 0.5);
      ctx.lineTo(cx - cellW * 0.5, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = palette.accent;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, lerp(-TORSO_HALF_HEIGHT * 0.5, TORSO_HALF_HEIGHT * 0.5, i / 2), 0.028, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();

  drawWound(
    ctx,
    cut(palette, {
      kind: 'crushed',
      centre: { x: 0, y: -TORSO_HALF_HEIGHT * 0.82 },
      radius: TORSO_HALF_WIDTH * 0.78,
      squash: 0.45,
      angle: deg(-4),
      bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
      runAngle: deg(-90),
      seed: 21,
    }),
  );
  drawWound(
    ctx,
    cut(palette, {
      kind: 'torn',
      centre: { x: 0, y: TORSO_HALF_HEIGHT * 0.84 },
      radius: TORSO_HALF_WIDTH * 0.7,
      squash: 0.42,
      angle: deg(6),
      bones: [],
      runAngle: deg(90),
      seed: 22,
    }),
  );
}

const SHOE_HALF_LENGTH = 0.32;
const SHOE_HALF_HEIGHT = 0.13;

/** One oversized shoe with the ankle still in it. */
function paintShoe(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const boot = ovalOutline(0.04, 0, SHOE_HALF_LENGTH, SHOE_HALF_HEIGHT, deg(-6), 13, 0.1);
  paintPiece(ctx, boot, palette.shoeDark, palette.outline);

  ctx.save();
  traceOutline(ctx, boot);
  ctx.clip();
  ctx.fillStyle = palette.shoe;
  ctx.beginPath();
  ctx.ellipse(
    0.1,
    -SHOE_HALF_HEIGHT * 0.3,
    SHOE_HALF_LENGTH * 0.5,
    SHOE_HALF_HEIGHT * 0.6,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = palette.suitTrim;
  ctx.fillRect(
    -SHOE_HALF_LENGTH,
    SHOE_HALF_HEIGHT * 0.5,
    SHOE_HALF_LENGTH * 2,
    SHOE_HALF_HEIGHT * 0.45,
  );
  ctx.restore();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(SHOE_HALF_LENGTH * 0.72, -SHOE_HALF_HEIGHT * 0.5, 0.045, 0, TWO_PI);
  ctx.fill();

  drawWound(
    ctx,
    cut(palette, {
      kind: 'clean',
      centre: { x: -SHOE_HALF_LENGTH * 0.86, y: -SHOE_HALF_HEIGHT * 0.2 },
      radius: SHOE_HALF_HEIGHT * 0.78,
      squash: 0.55,
      angle: deg(96),
      bones: [{ at: { x: 0, y: 0 }, size: 0.5 }],
      runAngle: deg(178),
      seed: 31,
    }),
  );
  paintDrips(ctx, { x: -SHOE_HALF_LENGTH, y: 0 }, deg(178), SHOE_HALF_HEIGHT * 0.9, 31);
}

const LIMB_HALF_LENGTH = 0.38;
const LIMB_WIDTH = 0.055;

/** An arm: a spindle of suit sleeve ending in a white glove. */
function paintArm(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const sleeve = ovalOutline(0, -0.04, LIMB_WIDTH, LIMB_HALF_LENGTH, deg(9), 17, 0.08);
  paintPiece(ctx, sleeve, palette.suitMid, palette.outline);

  const glove = ovalOutline(
    LIMB_HALF_LENGTH * 0.18,
    LIMB_HALF_LENGTH * 0.86,
    LIMB_WIDTH * 1.9,
    LIMB_WIDTH * 1.7,
    0,
    19,
    0.11,
  );
  paintPiece(ctx, glove, palette.paint, palette.outline);
  ctx.fillStyle = palette.paintShade;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(
      LIMB_HALF_LENGTH * 0.18 + lerp(-LIMB_WIDTH, LIMB_WIDTH, i / 2),
      LIMB_HALF_LENGTH * 0.86 + LIMB_WIDTH * 0.9,
      LIMB_WIDTH * 0.55,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  drawWound(
    ctx,
    cut(palette, {
      kind: 'torn',
      centre: { x: -LIMB_HALF_LENGTH * 0.16, y: -LIMB_HALF_LENGTH * 0.92 },
      radius: LIMB_WIDTH * 1.15,
      squash: 0.5,
      angle: deg(-82),
      bones: [{ at: { x: 0, y: 0 }, size: 0.55 }],
      runAngle: deg(-100),
      seed: 41,
    }),
  );
  paintDrips(
    ctx,
    { x: -LIMB_HALF_LENGTH * 0.2, y: -LIMB_HALF_LENGTH },
    deg(-100),
    LIMB_WIDTH * 2.2,
    41,
  );
}

const VIAL_CLUSTER_RADIUS = 0.26;

/** The vials he never got to throw, cracked and venting. */
function paintVials(ctx: Ctx, style: ClownStyle): void {
  const { palette } = style;
  const GLASS = '#b6cbb4';
  const GAS = '#9fbe33';
  const GAS_LIGHT = '#d7e86a';
  const VIAL_HALF_WIDTH = 0.062;
  const VIAL_HALF_HEIGHT = 0.13;

  // The escaping cloud sits behind the glass so the vials read as venting.
  const plume = ctx.createRadialGradient(0, -0.04, 0, 0, -0.04, VIAL_CLUSTER_RADIUS);
  plume.addColorStop(0, rgba(GAS_LIGHT, 0.5));
  plume.addColorStop(1, rgba(GAS_LIGHT, 0));
  ctx.fillStyle = plume;
  ctx.beginPath();
  ctx.arc(0, -0.04, VIAL_CLUSTER_RADIUS, 0, TWO_PI);
  ctx.fill();

  const VIAL_COUNT = 3;
  for (let i = 0; i < VIAL_COUNT; i++) {
    const angle = deg(-30) + (i / VIAL_COUNT) * deg(150);
    const cx = Math.cos(angle) * VIAL_CLUSTER_RADIUS * 0.4;
    const cy = Math.sin(angle) * VIAL_CLUSTER_RADIUS * 0.4;
    const body = ovalOutline(cx, cy, VIAL_HALF_WIDTH, VIAL_HALF_HEIGHT, angle, 23 + i, 0.05);
    paintPiece(ctx, body, mix(GLASS, GAS, 0.35), palette.outline);
    ctx.save();
    traceOutline(ctx, body);
    ctx.clip();
    ctx.fillStyle = GAS;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + VIAL_HALF_HEIGHT * 0.3,
      VIAL_HALF_WIDTH,
      VIAL_HALF_HEIGHT,
      angle,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }

  // Shards, so the cell is not three intact bottles sitting in a corpse pile.
  ctx.fillStyle = GLASS;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * TWO_PI + deg(20);
    const reach = VIAL_CLUSTER_RADIUS * 0.85;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    ctx.lineTo(Math.cos(angle + deg(10)) * reach * 0.6, Math.sin(angle + deg(10)) * reach * 0.6);
    ctx.lineTo(Math.cos(angle - deg(14)) * reach * 0.7, Math.sin(angle - deg(14)) * reach * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The pieces in the order `BodyPartGoreSystem` spawns them.
 *
 * `name` is not decoration: `generate-clown-sprites.ts` feeds it to the
 * manifest gate as the gore row's `colOffset` state names, so a rename or a
 * reorder here fails the bake instead of quietly spawning the wrong piece.
 * `EVIL_CLOWN_GORE_PARTS` in `src/sprites/evilClownSprite.ts` is the runtime
 * half of the same list and must match.
 */
export const EVIL_CLOWN_GORE_PIECES: ReadonlyArray<{
  readonly name: string;
  readonly paint: (ctx: Ctx, style: ClownStyle) => void;
}> = [
  { name: 'gore_head', paint: paintHead },
  { name: 'gore_ruff', paint: paintRuff },
  { name: 'gore_torso', paint: paintTorso },
  { name: 'gore_arm', paint: paintArm },
  { name: 'gore_shoe', paint: paintShoe },
  { name: 'gore_vials', paint: paintVials },
];
