/**
 * Emblems for the proficiency skills that train with a weapon, an element or
 * a blast: one bold silhouette each, built to the same rules as the rest of
 * `skillIcons.ts`, every measurement a fraction of the icon square.
 */

import type { ProficiencySkillId } from '../../core/skills/proficiency';
import { MIRROR_SIDES, TWO_PI, type EmblemPalette, type EmblemRenderer } from './skillEmblemTypes';

/** The proficiencies painted here; Mechanical Fist shares the fist drawing in `skillIcons.ts`. */
type PaintedProficiency = Exclude<ProficiencySkillId, 'mechanical_fist'>;

export const PROFICIENCY_PALETTES = {
  swordsmanship: {
    glow: '#1e3a8a',
    field: '#0a1430',
    rim: '#93c5fd',
    mark: '#e0ecff',
    accent: '#fde68a',
  },
  archery: {
    glow: '#166534',
    field: '#06210f',
    rim: '#86efac',
    mark: '#dcfce7',
    accent: '#ffffff',
  },
  clawmanship: {
    glow: '#9d174d',
    field: '#300716',
    rim: '#f9a8d4',
    mark: '#fce7f3',
    accent: '#ffffff',
  },
  magic_eye: {
    glow: '#86198f',
    field: '#2a0630',
    rim: '#f0abfc',
    mark: '#fae8ff',
    accent: '#ffffff',
  },
  blunt_proficiency: {
    glow: '#57534e',
    field: '#1c1917',
    rim: '#d6d3d1',
    mark: '#f5f5f4',
    accent: '#ffffff',
  },
  pyros_touch: {
    glow: '#c2410c',
    field: '#2e0d03',
    rim: '#fdba74',
    mark: '#fed7aa',
    accent: '#fef9c3',
  },
  demolitionist: {
    glow: '#a16207',
    field: '#271702',
    rim: '#fde047',
    mark: '#fef9c3',
    accent: '#ffffff',
  },
} as const satisfies Record<PaintedProficiency, EmblemPalette>;

// ── Swordsmanship: an upright sword, point to the sky ──────────────────────

const SWORD_TIP_Y = -0.36;
const SWORD_SHOULDER_Y = -0.24;
const SWORD_BLADE_HALF_W = 0.045;
const SWORD_GUARD_Y = 0.12;
const SWORD_GUARD_HALF_W = 0.17;
const SWORD_GUARD_H = 0.05;
const SWORD_GRIP_HALF_W = 0.028;
const SWORD_GRIP_BOTTOM = 0.29;
const SWORD_POMMEL_RADIUS = 0.045;
const SWORD_FULLER_HALF_W = 0.012;
const SWORD_FULLER_TOP = -0.2;

function drawSwordsmanshipEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * SWORD_TIP_Y);
  ctx.lineTo(cx + size * SWORD_BLADE_HALF_W, cy + size * SWORD_SHOULDER_Y);
  ctx.lineTo(cx + size * SWORD_BLADE_HALF_W, cy + size * SWORD_GUARD_Y);
  ctx.lineTo(cx - size * SWORD_BLADE_HALF_W, cy + size * SWORD_GUARD_Y);
  ctx.lineTo(cx - size * SWORD_BLADE_HALF_W, cy + size * SWORD_SHOULDER_Y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    cx - size * SWORD_FULLER_HALF_W,
    cy + size * SWORD_FULLER_TOP,
    size * SWORD_FULLER_HALF_W * 2,
    size * (SWORD_GUARD_Y - SWORD_FULLER_TOP),
  );

  ctx.fillStyle = palette.accent;
  ctx.fillRect(
    cx - size * SWORD_GUARD_HALF_W,
    cy + size * SWORD_GUARD_Y,
    size * SWORD_GUARD_HALF_W * 2,
    size * SWORD_GUARD_H,
  );
  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    cx - size * SWORD_GRIP_HALF_W,
    cy + size * (SWORD_GUARD_Y + SWORD_GUARD_H),
    size * SWORD_GRIP_HALF_W * 2,
    size * (SWORD_GRIP_BOTTOM - SWORD_GUARD_Y - SWORD_GUARD_H),
  );
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(cx, cy + size * SWORD_GRIP_BOTTOM, size * SWORD_POMMEL_RADIUS, 0, TWO_PI);
  ctx.fill();
}

// ── Archery: a drawn bow with its arrow nocked ─────────────────────────────

const BOW_CENTER_X = 0.1;
const BOW_RADIUS = 0.3;
/** Half the bow's sweep, either side of pointing straight ahead. */
const BOW_HALF_SWEEP_TURNS = 0.18;
const BOW_HALF_SWEEP = TWO_PI * BOW_HALF_SWEEP_TURNS;
const BOW_LINE_WIDTH = 0.06;
const BOW_STRING_WIDTH = 0.018;
const ARROW_TAIL_X = -0.3;
const ARROW_HEAD_BASE_X = 0.3;
const ARROW_TIP_X = 0.4;
const ARROW_SHAFT_HALF_H = 0.016;
const ARROW_HEAD_HALF_H = 0.06;
const FLETCH_LENGTH = 0.09;
const FLETCH_SPREAD = 0.06;

function drawArcheryEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const bowX = cx - size * BOW_CENTER_X;
  const upperTip = {
    x: bowX + Math.cos(-BOW_HALF_SWEEP) * size * BOW_RADIUS,
    y: cy + Math.sin(-BOW_HALF_SWEEP) * size * BOW_RADIUS,
  };
  const lowerTip = {
    x: bowX + Math.cos(BOW_HALF_SWEEP) * size * BOW_RADIUS,
    y: cy + Math.sin(BOW_HALF_SWEEP) * size * BOW_RADIUS,
  };

  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, size * BOW_STRING_WIDTH);
  ctx.beginPath();
  ctx.moveTo(upperTip.x, upperTip.y);
  ctx.lineTo(cx + size * ARROW_TAIL_X, cy);
  ctx.lineTo(lowerTip.x, lowerTip.y);
  ctx.stroke();

  ctx.strokeStyle = palette.mark;
  ctx.lineWidth = size * BOW_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(bowX, cy, size * BOW_RADIUS, -BOW_HALF_SWEEP, BOW_HALF_SWEEP);
  ctx.stroke();

  ctx.fillStyle = palette.accent;
  ctx.fillRect(
    cx + size * ARROW_TAIL_X,
    cy - size * ARROW_SHAFT_HALF_H,
    size * (ARROW_HEAD_BASE_X - ARROW_TAIL_X),
    size * ARROW_SHAFT_HALF_H * 2,
  );
  ctx.beginPath();
  ctx.moveTo(cx + size * ARROW_TIP_X, cy);
  ctx.lineTo(cx + size * ARROW_HEAD_BASE_X, cy - size * ARROW_HEAD_HALF_H);
  ctx.lineTo(cx + size * ARROW_HEAD_BASE_X, cy + size * ARROW_HEAD_HALF_H);
  ctx.closePath();
  ctx.fill();
  for (const side of MIRROR_SIDES) {
    ctx.beginPath();
    ctx.moveTo(cx + size * (ARROW_TAIL_X + FLETCH_LENGTH), cy);
    ctx.lineTo(cx + size * ARROW_TAIL_X, cy + side * size * FLETCH_SPREAD);
    ctx.lineTo(cx + size * ARROW_TAIL_X, cy);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Clawmanship: three hooked claws raking down across the disc ─────────────

const CLAW_COUNT = 3;
const CLAW_SPACING = 0.13;
const CLAW_TOP = -0.3;
const CLAW_BOTTOM = 0.3;
/** How far each claw's hook bows sideways at its middle. */
const CLAW_BOW = 0.12;
const CLAW_BASE_HALF_W = 0.045;
/** Each claw is drawn leaning, so the three read as one swipe rather than a fence. */
const CLAW_SLANT = 0.1;

function drawClawShape(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  cy: number,
  size: number,
): void {
  const topX = baseX + size * CLAW_SLANT;
  const bottomX = baseX - size * CLAW_SLANT;
  const top = cy + size * CLAW_TOP;
  const bottom = cy + size * CLAW_BOTTOM;
  ctx.beginPath();
  ctx.moveTo(topX - size * CLAW_BASE_HALF_W, top);
  ctx.quadraticCurveTo(baseX + size * CLAW_BOW, cy, bottomX, bottom);
  ctx.quadraticCurveTo(
    baseX + size * (CLAW_BOW + CLAW_BASE_HALF_W * 2),
    cy,
    topX + size * CLAW_BASE_HALF_W,
    top,
  );
  ctx.closePath();
  ctx.fill();
}

function drawClawmanshipEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const middle = (CLAW_COUNT - 1) / 2;
  for (let claw = 0; claw < CLAW_COUNT; claw++) {
    ctx.fillStyle = claw === middle ? palette.accent : palette.mark;
    drawClawShape(ctx, cx + size * CLAW_SPACING * (claw - middle), cy, size);
  }
}

// ── Magic Eye: an open eye, its iris lit, sparks at its corners ─────────────

const EYE_HALF_W = 0.34;
/** How far the lids bow from the eye's centre line. */
const EYE_LID_BOW = 0.24;
const IRIS_RADIUS = 0.12;
const PUPIL_RADIUS = 0.05;
const GLINT_RADIUS = 0.022;
const GLINT_OFFSET = 0.04;
const SPARK_DISTANCE = 0.33;
const SPARK_HALF_LENGTH = 0.06;
const SPARK_HALF_WIDTH = 0.016;
/** Sparks above the eye, up and out from each corner. */
const SPARK_RIGHT_TURNS = 0.125;
const SPARK_UP_TURNS = 0.25;
const SPARK_LEFT_TURNS = 0.375;
const SPARK_ANGLES = [SPARK_RIGHT_TURNS, SPARK_UP_TURNS, SPARK_LEFT_TURNS].map(
  (turns) => -TWO_PI * turns,
);

function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const long = size * SPARK_HALF_LENGTH;
  const thin = size * SPARK_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x, y - long);
  ctx.lineTo(x + thin, y - thin);
  ctx.lineTo(x + long, y);
  ctx.lineTo(x + thin, y + thin);
  ctx.lineTo(x, y + long);
  ctx.lineTo(x - thin, y + thin);
  ctx.lineTo(x - long, y);
  ctx.lineTo(x - thin, y - thin);
  ctx.closePath();
  ctx.fill();
}

function drawMagicEyeEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.moveTo(cx - size * EYE_HALF_W, cy);
  ctx.quadraticCurveTo(cx, cy - size * EYE_LID_BOW, cx + size * EYE_HALF_W, cy);
  ctx.quadraticCurveTo(cx, cy + size * EYE_LID_BOW, cx - size * EYE_HALF_W, cy);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * IRIS_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = palette.field;
  ctx.beginPath();
  ctx.arc(cx, cy, size * PUPIL_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(cx + size * GLINT_OFFSET, cy - size * GLINT_OFFSET, size * GLINT_RADIUS, 0, TWO_PI);
  ctx.fill();

  for (const angle of SPARK_ANGLES) {
    drawSpark(
      ctx,
      cx + Math.cos(angle) * size * SPARK_DISTANCE,
      cy + Math.sin(angle) * size * SPARK_DISTANCE,
      size,
    );
  }
}

// ── Blunt Proficiency: a studded mace, head up ─────────────────────────────

const MACE_HEAD_Y = -0.13;
const MACE_HEAD_RADIUS = 0.15;
const MACE_STUD_COUNT = 6;
const MACE_STUD_RADIUS = 0.04;
/** Studs sit just inside the head's rim so they read as part of its outline. */
const MACE_STUD_RING = 0.15;
const MACE_HAFT_HALF_W = 0.035;
const MACE_HAFT_BOTTOM = 0.34;
const MACE_GRIP_TOP = 0.18;
const MACE_GRIP_HALF_W = 0.045;

function drawBluntProficiencyEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    cx - size * MACE_HAFT_HALF_W,
    cy + size * MACE_HEAD_Y,
    size * MACE_HAFT_HALF_W * 2,
    size * (MACE_HAFT_BOTTOM - MACE_HEAD_Y),
  );
  ctx.fillStyle = palette.mark;
  ctx.fillRect(
    cx - size * MACE_GRIP_HALF_W,
    cy + size * MACE_GRIP_TOP,
    size * MACE_GRIP_HALF_W * 2,
    size * (MACE_HAFT_BOTTOM - MACE_GRIP_TOP),
  );

  const headY = cy + size * MACE_HEAD_Y;
  ctx.fillStyle = palette.accent;
  for (let stud = 0; stud < MACE_STUD_COUNT; stud++) {
    const angle = (stud / MACE_STUD_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * size * MACE_STUD_RING,
      headY + Math.sin(angle) * size * MACE_STUD_RING,
      size * MACE_STUD_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.arc(cx, headY, size * MACE_HEAD_RADIUS, 0, TWO_PI);
  ctx.fill();
}

// ── Pyro's Touch: a flame with a white-hot heart ───────────────────────────

const FLAME_TIP_Y = -0.36;
const FLAME_BASE_Y = 0.3;
const FLAME_HALF_W = 0.2;
/** Where the flame is widest, as a share of the way from tip to base. */
const FLAME_BELLY = 0.62;
const FLAME_LICK_X = 0.12;
const FLAME_LICK_Y = -0.12;
const FLAME_INNER_SCALE = 0.7;
const FLAME_HEART_SCALE = 0.5;
/** The heart sits low in the flame, where a real one burns hottest. */
const FLAME_HEART_DROP = 0.12;

function traceFlame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  size: number,
  scale: number,
): void {
  const tipY = baseY + size * (FLAME_TIP_Y - FLAME_BASE_Y) * scale;
  const bellyY = tipY + (baseY - tipY) * FLAME_BELLY;
  const halfW = size * FLAME_HALF_W * scale;
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.quadraticCurveTo(
    cx + size * FLAME_LICK_X * scale,
    bellyY + size * FLAME_LICK_Y * scale,
    cx + halfW,
    bellyY,
  );
  ctx.quadraticCurveTo(cx + halfW, baseY, cx, baseY);
  ctx.quadraticCurveTo(cx - halfW, baseY, cx - halfW, bellyY);
  ctx.quadraticCurveTo(cx - halfW, tipY + (bellyY - tipY) / 2, cx, tipY);
  ctx.closePath();
  ctx.fill();
}

function drawPyrosTouchEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const baseY = cy + size * FLAME_BASE_Y;
  ctx.fillStyle = palette.rim;
  traceFlame(ctx, cx, baseY, size, 1);
  const heartBaseY = baseY - size * FLAME_HEART_DROP * FLAME_HEART_SCALE;
  ctx.fillStyle = palette.mark;
  traceFlame(ctx, cx, heartBaseY, size, FLAME_INNER_SCALE);
  ctx.fillStyle = palette.accent;
  traceFlame(ctx, cx, heartBaseY, size, FLAME_HEART_SCALE);
}

// ── Demolitionist: a round bomb, fuse lit ──────────────────────────────────

const BOMB_Y = 0.07;
const BOMB_RADIUS = 0.22;
const BOMB_CAP_HALF_W = 0.07;
const BOMB_CAP_H = 0.07;
/** The cap leans with the fuse, toward the top right. */
const BOMB_CAP_TURNS = 0.1;
const BOMB_CAP_ANGLE = TWO_PI * BOMB_CAP_TURNS;
const FUSE_LENGTH = 0.14;
const FUSE_WIDTH = 0.025;
const FUSE_BEND = 0.06;
const SPARK_SIZE_SCALE = 1.3;
const BOMB_SHINE_X = -0.08;
const BOMB_SHINE_Y = -0.02;
const BOMB_SHINE_RADIUS = 0.05;

function drawDemolitionistEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const bombY = cy + size * BOMB_Y;
  const capDirX = Math.sin(BOMB_CAP_ANGLE);
  const capDirY = -Math.cos(BOMB_CAP_ANGLE);
  const capX = cx + capDirX * size * BOMB_RADIUS;
  const capY = bombY + capDirY * size * BOMB_RADIUS;
  const fuseEndX = capX + capDirX * size * (BOMB_CAP_H + FUSE_LENGTH);
  const fuseEndY = capY + capDirY * size * (BOMB_CAP_H + FUSE_LENGTH);

  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, size * FUSE_WIDTH);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(capX, capY);
  ctx.quadraticCurveTo(
    capX + capDirX * size * FUSE_LENGTH + size * FUSE_BEND,
    capY + capDirY * size * FUSE_LENGTH,
    fuseEndX,
    fuseEndY,
  );
  ctx.stroke();

  ctx.save();
  ctx.translate(capX, capY);
  ctx.rotate(BOMB_CAP_ANGLE);
  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    -size * BOMB_CAP_HALF_W,
    -size * BOMB_CAP_H,
    size * BOMB_CAP_HALF_W * 2,
    size * BOMB_CAP_H * 2,
  );
  ctx.restore();

  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.arc(cx, bombY, size * BOMB_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(
    cx + size * BOMB_SHINE_X,
    bombY + size * BOMB_SHINE_Y,
    size * BOMB_SHINE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = palette.accent;
  drawSpark(ctx, fuseEndX, fuseEndY, size * SPARK_SIZE_SCALE);
}

export const PROFICIENCY_EMBLEMS = {
  swordsmanship: drawSwordsmanshipEmblem,
  archery: drawArcheryEmblem,
  clawmanship: drawClawmanshipEmblem,
  magic_eye: drawMagicEyeEmblem,
  blunt_proficiency: drawBluntProficiencyEmblem,
  pyros_touch: drawPyrosTouchEmblem,
  demolitionist: drawDemolitionistEmblem,
} as const satisfies Record<PaintedProficiency, EmblemRenderer>;
