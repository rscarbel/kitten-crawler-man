import type { SkillId } from '../../core/skills/SkillManager';
import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';
import { PROFICIENCY_EMBLEMS, PROFICIENCY_PALETTES } from './proficiencyEmblems';
import { MIRROR_SIDES, TWO_PI, type EmblemPalette, type EmblemRenderer } from './skillEmblemTypes';

/**
 * One emblem per trainable skill, drawn into a square region.
 *
 * The skill-book icon ({@link ../icons/skillBookIcon}) says "this is a book";
 * these say *which* skill. They are what the level-up overlay pulses, so each is
 * built from one bold silhouette that survives being scaled down to a 56px
 * dialog icon and blown up under the power-up glow.
 *
 * Every measurement is a fraction of the icon square, so an emblem is resolution
 * independent — the same code serves a card badge and a full-screen award.
 */

const CENTER = 0.5;

/** Disc the emblem sits on, so a light silhouette still reads on a light panel. */
const BACKDROP_RADIUS = 0.46;
const BACKDROP_INNER_STOP = 0.55;
const BACKDROP_RIM_WIDTH_FRACTION = 0.035;

const SKILL_PALETTES = {
  nine_lives: {
    glow: '#155e75',
    field: '#06222b',
    rim: '#22d3ee',
    mark: '#cffafe',
    accent: '#ffffff',
  },
  cat_reflexes: {
    glow: '#4c1d95',
    field: '#1c0b3a',
    rim: '#a78bfa',
    mark: '#ddd6fe',
    accent: '#ffffff',
  },
  pugilism: {
    glow: '#7f1d1d',
    field: '#2c0707',
    rim: '#f87171',
    mark: '#fecaca',
    accent: '#ffffff',
  },
  iron_stomach: {
    glow: '#3f6212',
    field: '#131f06',
    rim: '#a3e635',
    mark: '#d9f99d',
    accent: '#ffffff',
  },
  mechanical_fist: {
    glow: '#334155',
    field: '#0b1119',
    rim: '#94a3b8',
    mark: '#e2e8f0',
    accent: '#ffffff',
  },
  powerful_strike: {
    glow: '#92400e',
    field: '#2a1203',
    rim: '#fbbf24',
    mark: '#fde68a',
    accent: '#ffffff',
  },
  ...PROFICIENCY_PALETTES,
} as const satisfies Record<SkillId, EmblemPalette>;

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const radius = size * BACKDROP_RADIUS;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, palette.glow);
  grad.addColorStop(BACKDROP_INNER_STOP, palette.field);
  grad.addColorStop(1, palette.field);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();

  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, size * BACKDROP_RIM_WIDTH_FRACTION);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.stroke();
}

// ── 9 Lives: a cat's head ringed by its nine lives ─────────────────────────

const NINE_LIVES_COUNT = 9;
const LIFE_PIP_RING_RADIUS = 0.36;
const LIFE_PIP_RADIUS = 0.038;
/** The first pip sits at twelve o'clock so the ring reads as a count, not a decoration. */
const LIFE_PIP_START_ANGLE = -Math.PI / 2;
const CAT_HEAD_CENTER_Y = 0.04;
const CAT_HEAD_RX = 0.19;
const CAT_HEAD_RY = 0.16;
const CAT_EAR_BASE_INNER_X = 0.03;
const CAT_EAR_BASE_OUTER_X = 0.19;
const CAT_EAR_BASE_Y = -0.04;
const CAT_EAR_TIP_X = 0.16;
const CAT_EAR_TIP_Y = -0.25;
const CAT_EYE_OFFSET_X = 0.075;
const CAT_EYE_Y = 0.02;
const CAT_EYE_RX = 0.026;
const CAT_EYE_RY = 0.05;

function drawNineLivesEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.accent;
  for (let life = 0; life < NINE_LIVES_COUNT; life++) {
    const angle = LIFE_PIP_START_ANGLE + (life / NINE_LIVES_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * size * LIFE_PIP_RING_RADIUS,
      cy + Math.sin(angle) * size * LIFE_PIP_RING_RADIUS,
      size * LIFE_PIP_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.fillStyle = palette.mark;
  for (const side of MIRROR_SIDES) {
    ctx.beginPath();
    ctx.moveTo(cx + side * size * CAT_EAR_BASE_INNER_X, cy + size * CAT_EAR_BASE_Y);
    ctx.lineTo(cx + side * size * CAT_EAR_TIP_X, cy + size * CAT_EAR_TIP_Y);
    ctx.lineTo(cx + side * size * CAT_EAR_BASE_OUTER_X, cy + size * CAT_EAR_BASE_Y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + size * CAT_HEAD_CENTER_Y,
    size * CAT_HEAD_RX,
    size * CAT_HEAD_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = palette.field;
  for (const side of MIRROR_SIDES) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * size * CAT_EYE_OFFSET_X,
      cy + size * CAT_EYE_Y,
      size * CAT_EYE_RX,
      size * CAT_EYE_RY,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

// ── Cat-like Reflexes: a paw already gone, trailing its own afterimages ──────

const PAW_PAD_RX = 0.13;
const PAW_PAD_RY = 0.11;
const PAW_PAD_Y = 0.09;
const PAW_TOE_COUNT = 4;
const PAW_TOE_RADIUS = 0.052;
const PAW_TOE_ARC_RADIUS = 0.19;
const PAW_TOE_ARC_START_TURNS = 1.16;
const PAW_TOE_ARC_SWEEP_TURNS = 0.68;
const PAW_TOE_ARC_START = Math.PI * PAW_TOE_ARC_START_TURNS;
const PAW_TOE_ARC_SWEEP = Math.PI * PAW_TOE_ARC_SWEEP_TURNS;
const PAW_TOE_ARC_CENTER_Y = 0.07;
const AFTERIMAGE_COUNT = 2;
const AFTERIMAGE_STEP_X = 0.13;
const AFTERIMAGE_ALPHA_STEP = 0.3;
/** The live paw leads its trail by half a step, so the whole streak stays centred. */
const PAW_LEAD_STEPS = 0.5;

function drawPawShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * PAW_PAD_Y, size * PAW_PAD_RX, size * PAW_PAD_RY, 0, 0, TWO_PI);
  ctx.fill();
  for (let i = 0; i < PAW_TOE_COUNT; i++) {
    const angle = PAW_TOE_ARC_START + (i / (PAW_TOE_COUNT - 1)) * PAW_TOE_ARC_SWEEP;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * size * PAW_TOE_ARC_RADIUS,
      cy + size * PAW_TOE_ARC_CENTER_Y + Math.sin(angle) * size * PAW_TOE_ARC_RADIUS,
      size * PAW_TOE_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

function drawCatReflexesEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.save();
  ctx.fillStyle = palette.rim;
  for (let i = AFTERIMAGE_COUNT; i >= 1; i--) {
    ctx.globalAlpha = 1 - i * AFTERIMAGE_ALPHA_STEP;
    drawPawShape(ctx, cx - size * AFTERIMAGE_STEP_X * i, cy, size);
  }
  ctx.restore();

  ctx.fillStyle = palette.mark;
  drawPawShape(ctx, cx + size * AFTERIMAGE_STEP_X * PAW_LEAD_STEPS, cy, size);
}

// ── Pugilism: a clenched fist, knuckles forward ─────────────────────────────

const FIST_HALF_W = 0.16;
const FIST_TOP = -0.17;
const FIST_BOTTOM = 0.14;
const FIST_CORNER = 0.06;
const KNUCKLE_COUNT = 4;
const KNUCKLE_RADIUS = 0.038;
const KNUCKLE_Y = -0.09;
/** Knuckles are centred in their share of the fist's width, not on its edges. */
const KNUCKLE_SLOT_CENTER = 0.5;
const THUMB_RX = 0.06;
const THUMB_RY = 0.09;
const THUMB_X = 0.15;
const THUMB_Y = 0.05;
const WRIST_HALF_W = 0.11;
const WRIST_BOTTOM = 0.3;

function drawPugilismEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.rim;
  ctx.beginPath();
  ctx.rect(
    cx - size * WRIST_HALF_W,
    cy + size * FIST_BOTTOM - size * FIST_CORNER,
    size * WRIST_HALF_W * 2,
    size * (WRIST_BOTTOM - FIST_BOTTOM) + size * FIST_CORNER,
  );
  ctx.fill();

  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.roundRect(
    cx - size * FIST_HALF_W,
    cy + size * FIST_TOP,
    size * FIST_HALF_W * 2,
    size * (FIST_BOTTOM - FIST_TOP),
    size * FIST_CORNER,
  );
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(
    cx + size * THUMB_X,
    cy + size * THUMB_Y,
    size * THUMB_RX,
    size * THUMB_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = palette.accent;
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const t = (i + KNUCKLE_SLOT_CENTER) / KNUCKLE_COUNT;
    ctx.beginPath();
    ctx.arc(
      cx - size * FIST_HALF_W + t * size * FIST_HALF_W * 2,
      cy + size * KNUCKLE_Y,
      size * KNUCKLE_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

// ── Iron Stomach: a riveted iron belly-plate over a swallowed flask ─────────

const PLATE_HALF_W = 0.21;
const PLATE_TOP = -0.2;
const PLATE_BOTTOM = 0.22;
const PLATE_WAIST_FRACTION = 0.72;
const RIVET_RADIUS = 0.028;
const RIVET_INSET = 0.15;
const RIVET_ROW_SPACING = 0.13;
const RIVET_ROW_YS = [-RIVET_ROW_SPACING, 0, RIVET_ROW_SPACING] as const;
const FLASK_NECK_HALF_W = 0.045;
const FLASK_NECK_TOP = -0.12;
const FLASK_BODY_RADIUS = 0.085;
const FLASK_BODY_Y = 0.06;

function drawIronStomachEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.moveTo(cx - size * PLATE_HALF_W, cy + size * PLATE_TOP);
  ctx.lineTo(cx + size * PLATE_HALF_W, cy + size * PLATE_TOP);
  ctx.lineTo(cx + size * PLATE_HALF_W * PLATE_WAIST_FRACTION, cy + size * PLATE_BOTTOM);
  ctx.lineTo(cx - size * PLATE_HALF_W * PLATE_WAIST_FRACTION, cy + size * PLATE_BOTTOM);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.field;
  ctx.beginPath();
  ctx.rect(
    cx - size * FLASK_NECK_HALF_W,
    cy + size * FLASK_NECK_TOP,
    size * FLASK_NECK_HALF_W * 2,
    size * (FLASK_BODY_Y - FLASK_NECK_TOP),
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + size * FLASK_BODY_Y, size * FLASK_BODY_RADIUS, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = palette.accent;
  for (const rowY of RIVET_ROW_YS) {
    for (const side of MIRROR_SIDES) {
      ctx.beginPath();
      ctx.arc(cx + side * size * RIVET_INSET, cy + size * rowY, size * RIVET_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// ── Mechanical Fist: the pugilist's fist, plated and spiked ────────────────

/** How far the gauntlet plate overhangs the bare fist on each side. */
const PLATE_OVERHANG = 0.03;
const GAUNTLET_SPIKE_HEIGHT = 0.08;
const GAUNTLET_SPIKE_HALF_W = 0.03;
const GAUNTLET_BAND_TOP = 0.02;
const GAUNTLET_BAND_HEIGHT = 0.05;

function drawMechanicalFistEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    cx - size * WRIST_HALF_W,
    cy + size * FIST_BOTTOM - size * FIST_CORNER,
    size * WRIST_HALF_W * 2,
    size * (WRIST_BOTTOM - FIST_BOTTOM) + size * FIST_CORNER,
  );

  const plateHalfW = size * (FIST_HALF_W + PLATE_OVERHANG);

  // Spikes go down first so the plate's own edge cuts their bases off cleanly.
  ctx.fillStyle = palette.accent;
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const t = (i + KNUCKLE_SLOT_CENTER) / KNUCKLE_COUNT;
    const spikeCx = cx - plateHalfW + t * plateHalfW * 2;
    const baseY = cy + size * FIST_TOP + size * FIST_CORNER;
    ctx.beginPath();
    ctx.moveTo(spikeCx - size * GAUNTLET_SPIKE_HALF_W, baseY);
    ctx.lineTo(spikeCx, baseY - size * GAUNTLET_SPIKE_HEIGHT);
    ctx.lineTo(spikeCx + size * GAUNTLET_SPIKE_HALF_W, baseY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.roundRect(
    cx - plateHalfW,
    cy + size * FIST_TOP + size * FIST_CORNER,
    plateHalfW * 2,
    size * (FIST_BOTTOM - FIST_TOP) - size * FIST_CORNER,
    size * FIST_CORNER,
  );
  ctx.fill();

  ctx.fillStyle = palette.rim;
  ctx.fillRect(
    cx - plateHalfW,
    cy + size * GAUNTLET_BAND_TOP,
    plateHalfW * 2,
    size * GAUNTLET_BAND_HEIGHT,
  );
}

// ── Powerful Strike: a fist landing inside a burst ──────────────────────────

const BURST_SPIKE_COUNT = 8;
const BURST_INNER_RADIUS = 0.16;
const BURST_OUTER_RADIUS = 0.42;
const BURST_HALF_ANGLE = Math.PI / BURST_SPIKE_COUNT / 2;
const STRIKE_FIST_SCALE = 0.7;

function drawPowerfulStrikeEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.fillStyle = palette.rim;
  ctx.beginPath();
  for (let spike = 0; spike < BURST_SPIKE_COUNT; spike++) {
    const angle = (spike / BURST_SPIKE_COUNT) * TWO_PI;
    ctx.moveTo(
      cx + Math.cos(angle - BURST_HALF_ANGLE) * size * BURST_INNER_RADIUS,
      cy + Math.sin(angle - BURST_HALF_ANGLE) * size * BURST_INNER_RADIUS,
    );
    ctx.lineTo(
      cx + Math.cos(angle) * size * BURST_OUTER_RADIUS,
      cy + Math.sin(angle) * size * BURST_OUTER_RADIUS,
    );
    ctx.lineTo(
      cx + Math.cos(angle + BURST_HALF_ANGLE) * size * BURST_INNER_RADIUS,
      cy + Math.sin(angle + BURST_HALF_ANGLE) * size * BURST_INNER_RADIUS,
    );
    ctx.closePath();
  }
  ctx.fill();

  // Shrunk so the burst still reads as surrounding the blow rather than as a
  // frame the fist happens to touch.
  const fistHalfW = size * FIST_HALF_W * STRIKE_FIST_SCALE;
  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.roundRect(
    cx - fistHalfW,
    cy + size * FIST_TOP * STRIKE_FIST_SCALE,
    fistHalfW * 2,
    size * (FIST_BOTTOM - FIST_TOP) * STRIKE_FIST_SCALE,
    size * FIST_CORNER,
  );
  ctx.fill();

  ctx.fillStyle = palette.accent;
  for (let i = 0; i < KNUCKLE_COUNT; i++) {
    const t = (i + KNUCKLE_SLOT_CENTER) / KNUCKLE_COUNT;
    ctx.beginPath();
    ctx.arc(
      cx - fistHalfW + t * fistHalfW * 2,
      cy + size * KNUCKLE_Y * STRIKE_FIST_SCALE,
      size * KNUCKLE_RADIUS * STRIKE_FIST_SCALE,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

const SKILL_EMBLEMS = {
  nine_lives: drawNineLivesEmblem,
  cat_reflexes: drawCatReflexesEmblem,
  pugilism: drawPugilismEmblem,
  iron_stomach: drawIronStomachEmblem,
  mechanical_fist: drawMechanicalFistEmblem,
  powerful_strike: drawPowerfulStrikeEmblem,
  ...PROFICIENCY_EMBLEMS,
} as const satisfies Record<SkillId, EmblemRenderer>;

/** Draws a skill's emblem into a square icon region. */
export function drawSkillIcon(ctx: CanvasRenderingContext2D, rect: Rect, skillId: SkillId): void {
  const { x, y, size } = iconSquare(rect);
  const palette = SKILL_PALETTES[skillId];
  const cx = x + size * CENTER;
  const cy = y + size * CENTER;

  ctx.save();
  drawBackdrop(ctx, cx, cy, size, palette);
  SKILL_EMBLEMS[skillId](ctx, cx, cy, size, palette);
  ctx.restore();
}
