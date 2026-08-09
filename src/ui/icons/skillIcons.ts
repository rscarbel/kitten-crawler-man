import type { SkillId } from '../../core/SkillManager';

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
const TWO_PI = Math.PI * 2;
/** Left and right, for the parts of an emblem that come in mirrored pairs. */
const MIRROR_SIDES = [-1, 1] as const;

/** Disc the emblem sits on, so a light silhouette still reads on a light panel. */
const BACKDROP_RADIUS = 0.46;
const BACKDROP_INNER_STOP = 0.55;
const BACKDROP_RIM_WIDTH_FRACTION = 0.035;

interface EmblemPalette {
  /** Centre of the backdrop disc. */
  glow: string;
  /** Outer edge of the backdrop disc. */
  field: string;
  /** Ring drawn around the disc. */
  rim: string;
  /** The silhouette itself. */
  mark: string;
  /** Highlights picked out on the silhouette. */
  accent: string;
}

const SKILL_PALETTES: Record<SkillId, EmblemPalette> = {
  cockroach: {
    glow: '#6b4620',
    field: '#2a1a0c',
    rim: '#a9713a',
    mark: '#e0a35c',
    accent: '#fde8c6',
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
  night_vision: {
    glow: '#1e3a8a',
    field: '#080f26',
    rim: '#60a5fa',
    mark: '#bfdbfe',
    accent: '#ffffff',
  },
  iron_punch: {
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
};

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

// ── Cockroach: a roach seen from above, still going ──────────────────────────

const ROACH_BODY_RX = 0.15;
const ROACH_BODY_RY = 0.24;
const ROACH_HEAD_RX = 0.09;
const ROACH_HEAD_RY = 0.07;
const ROACH_HEAD_Y = -0.22;
/** Where each leg pair leaves the body, in multiples of the body's half-height. */
const ROACH_FRONT_LEG_ANCHOR = -0.75;
const ROACH_MIDDLE_LEG_ANCHOR = -0.1;
const ROACH_REAR_LEG_ANCHOR = 0.55;
const ROACH_LEG_ANCHORS = [
  ROACH_FRONT_LEG_ANCHOR,
  ROACH_MIDDLE_LEG_ANCHOR,
  ROACH_REAR_LEG_ANCHOR,
] as const;
/** How far down the body a leg's outer end lands from where it leaves it. */
const ROACH_LEG_RAKE = 0.4;
const ROACH_LEG_INNER = 0.13;
const ROACH_LEG_OUTER = 0.36;
const ROACH_ANTENNA_ROOT_X = 0.04;
const ROACH_ANTENNA_SPREAD = 0.16;
const ROACH_ANTENNA_TIP_Y = -0.42;
const ROACH_WING_SEAM_TOP = -0.12;
const ROACH_WING_SEAM_BOTTOM = 0.2;
const ROACH_LINE_WIDTH_FRACTION = 0.045;

function drawCockroachEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  const stroke = Math.max(1, size * ROACH_LINE_WIDTH_FRACTION);
  ctx.strokeStyle = palette.mark;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';

  for (const anchor of ROACH_LEG_ANCHORS) {
    for (const side of MIRROR_SIDES) {
      ctx.beginPath();
      ctx.moveTo(cx + side * size * ROACH_LEG_INNER, cy + size * anchor * ROACH_BODY_RY);
      ctx.lineTo(
        cx + side * size * ROACH_LEG_OUTER,
        cy + size * (anchor + ROACH_LEG_RAKE) * ROACH_BODY_RY,
      );
      ctx.stroke();
    }
  }

  ctx.beginPath();
  for (const side of MIRROR_SIDES) {
    ctx.moveTo(cx + side * size * ROACH_ANTENNA_ROOT_X, cy + size * ROACH_HEAD_Y);
    ctx.lineTo(cx + side * size * ROACH_ANTENNA_SPREAD, cy + size * ROACH_ANTENNA_TIP_Y);
  }
  ctx.stroke();

  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * ROACH_BODY_RX, size * ROACH_BODY_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + size * ROACH_HEAD_Y,
    size * ROACH_HEAD_RX,
    size * ROACH_HEAD_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.strokeStyle = palette.field;
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * ROACH_WING_SEAM_TOP);
  ctx.lineTo(cx, cy + size * ROACH_WING_SEAM_BOTTOM);
  ctx.stroke();
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

// ── Night Vision: a slit-pupilled eye, lit from inside ──────────────────────

const EYE_RX = 0.27;
const EYE_RY = 0.17;
const IRIS_RADIUS = 0.13;
const PUPIL_RX = 0.035;
const PUPIL_RY = 0.125;
const GLINT_RADIUS = 0.035;
const GLINT_OFFSET_X = -0.06;
const GLINT_OFFSET_Y = -0.05;
const LASH_COUNT = 3;
const LASH_INNER = 0.3;
const LASH_OUTER = 0.42;
/** Three lashes fanned above the eye, in radians off the positive x axis. */
const LASH_INNERMOST_ANGLE = -0.55;
const LASH_ANGLE_STEP = -0.35;
const LASH_WIDTH_FRACTION = 0.035;

function drawNightVisionEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
): void {
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, size * LASH_WIDTH_FRACTION);
  ctx.lineCap = 'round';
  for (let i = 0; i < LASH_COUNT; i++) {
    const angle = LASH_INNERMOST_ANGLE + i * LASH_ANGLE_STEP;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * size * LASH_INNER, cy + Math.sin(angle) * size * LASH_INNER);
    ctx.lineTo(cx + Math.cos(angle) * size * LASH_OUTER, cy + Math.sin(angle) * size * LASH_OUTER);
    ctx.stroke();
  }

  ctx.fillStyle = palette.mark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * EYE_RX, size * EYE_RY, 0, 0, TWO_PI);
  ctx.fill();

  const iris = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * IRIS_RADIUS);
  iris.addColorStop(0, palette.rim);
  iris.addColorStop(1, palette.glow);
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(cx, cy, size * IRIS_RADIUS, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = palette.field;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * PUPIL_RX, size * PUPIL_RY, 0, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(cx + size * GLINT_OFFSET_X, cy + size * GLINT_OFFSET_Y, size * GLINT_RADIUS, 0, TWO_PI);
  ctx.fill();
}

// ── Iron Punch: the pugilist's fist, plated and spiked ─────────────────────

/** How far the gauntlet plate overhangs the bare fist on each side. */
const PLATE_OVERHANG = 0.03;
const GAUNTLET_SPIKE_HEIGHT = 0.08;
const GAUNTLET_SPIKE_HALF_W = 0.03;
const GAUNTLET_BAND_TOP = 0.02;
const GAUNTLET_BAND_HEIGHT = 0.05;

function drawIronPunchEmblem(
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

type EmblemRenderer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
) => void;

const SKILL_EMBLEMS: Record<SkillId, EmblemRenderer> = {
  cockroach: drawCockroachEmblem,
  cat_reflexes: drawCatReflexesEmblem,
  pugilism: drawPugilismEmblem,
  iron_stomach: drawIronStomachEmblem,
  night_vision: drawNightVisionEmblem,
  iron_punch: drawIronPunchEmblem,
  powerful_strike: drawPowerfulStrikeEmblem,
};

/** Draws a skill's emblem into a square icon region. */
export function drawSkillIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  skillId: SkillId,
): void {
  const palette = SKILL_PALETTES[skillId];
  const cx = x + size * CENTER;
  const cy = y + size * CENTER;

  ctx.save();
  drawBackdrop(ctx, cx, cy, size, palette);
  SKILL_EMBLEMS[skillId](ctx, cx, cy, size, palette);
  ctx.restore();
}
