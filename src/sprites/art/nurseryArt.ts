/**
 * Painters for the goblin nursery's props: the boards nailed over a grate (at
 * every stage of being built and every stage of being torn apart), the wood
 * pile the boards come from, and the torches on the nursery's walls.
 *
 * Pure drawing, in multiples of the caller's `ts`, so `nurserySprites.ts` can
 * bake them at any resolution. One warm oak ramp for all the timber and one
 * cool iron ramp for nails and brackets, lit from the upper left like every
 * other prop in the dungeon.
 */

import { mulberry32, range, type Rng } from '../person/rng';

type Ctx = CanvasRenderingContext2D;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Palette ─────────────────────────────────────────────────────────────────
const WOOD_EDGE = '#2a1a0d';
const WOOD_SHADOW = '#4a2f17';
const WOOD_DARK = '#6a4522';
const WOOD_MID = '#8a5c2e';
const WOOD_LIGHT = '#a8753d';
const WOOD_RIM = '#c9975a';
/** Fresh-cut end grain and the bright inside of a split: paler than any face. */
const WOOD_FRESH = '#e0b67a';
const WOOD_GRAIN = 'rgba(58,34,14,0.45)';
const WOOD_KNOT = 'rgba(52,30,12,0.7)';
const GOUGE_LIGHT = 'rgba(236,200,146,0.75)';
const GOUGE_DARK = 'rgba(40,22,8,0.55)';
const CRACK_INK = '#1a0f07';
const IRON_EDGE = '#15171a';
const IRON_MID = '#4a5058';
const IRON_LIGHT = '#9aa4b0';
const DROP_SHADOW = 'rgba(0,0,0,0.42)';
const SAWDUST = 'rgba(214,184,132,0.55)';

// ── Barrier geometry ────────────────────────────────────────────────────────
/** Planks laid across a grate. */
export const BARRIER_PLANK_COUNT = 4;
/** Damage stages, pristine first; the last is the one about to give. */
export const BARRIER_DAMAGE_STAGES = 5;
/** Distinct board layouts, so a room of barriers is not one stamp repeated. */
export const BARRIER_VARIANTS = 3;
/** How far past the tile edge the art can reach — board overhang plus shadow. */
export const BARRIER_ART_MARGIN = 0.18;

const PLANK_LEFT = -0.06;
const PLANK_RIGHT = 1.06;
const PLANK_TOP = 0.02;
const PLANK_HEIGHT = 0.215;
const PLANK_GAP = 0.035;
const PLANK_LENGTH_JITTER = 0.05;
const PLANK_ANGLE_JITTER = 0.05;
const PLANK_SHIFT_JITTER = 0.015;
const GRAIN_LINES = 3;
const GRAIN_WAVE = 0.012;
const GRAIN_WIDTH = 0.012;
const KNOT_CHANCE = 0.5;
const KNOT_RADIUS = 0.028;
const OUTLINE_WIDTH = 0.02;
const END_GRAIN_WIDTH = 0.035;

/**
 * One brace nailed corner to corner across the planks: a diagonal is what
 * reads as "boarded up" at a glance, where square battens read as a crate lid.
 */
const BRACE_START = { x: 0.04, y: 0.02 } as const;
const BRACE_END = { x: 0.96, y: 0.96 } as const;
const BRACE_WIDTH = 0.15;
/** Each plank is nailed this far in from both of its ends, as well as under the brace. */
const END_NAIL_INSET = 0.07;
const NAIL_RADIUS = 0.024;

const SHADOW_OFFSET = 0.045;

// Damage dressing, by the stage it first appears at.
const STAGE_SCUFFED = 1;
const STAGE_CRACKED = 2;
const STAGE_SPLINTERED = 3;
const STAGE_FAILING = 4;
const GOUGE_COUNT = 3;
const GOUGE_LENGTH = 0.22;
const GOUGE_SPACING = 0.035;
const GOUGE_WIDTH = 0.014;
const CRACK_WIDTH = 0.022;
const CRACK_SEGMENTS = 5;
const CRACK_WANDER = 0.05;
const BREAK_GAP = 0.13;
const BREAK_TEETH = 4;
const BREAK_TOOTH_DEPTH = 0.05;
const BROKEN_SAG = 0.12;
const LOOSE_BRACE_ANGLE = 0.2;
/** Stub left nailed at each end of a plank torn clean away. */
const STUB_LENGTH = 0.2;
const SPLINTER_COUNT = 4;
const SPLINTER_LENGTH = 0.12;
const SPLINTER_WIDTH = 0.022;
const POPPED_NAIL_LIFT = 0.03;

/** Which plank breaks first: the middle ones, where the claws come up. */
const FIRST_BREAK_PLANK = 1;
const SECOND_BREAK_PLANK = 2;
/** At the last stage this plank is gone outright. */
const MISSING_PLANK = 2;

interface PlankPlan {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly angle: number;
  readonly hasKnot: boolean;
  readonly knotAt: number;
  readonly seed: number;
}

function planPlanks(variant: number): PlankPlan[] {
  const rng = mulberry32(variant * VARIANT_SEED_STRIDE + PLANK_SEED_SALT);
  return Array.from({ length: BARRIER_PLANK_COUNT }, (_, index) => ({
    top: PLANK_TOP + index * (PLANK_HEIGHT + PLANK_GAP) + range(rng, -1, 1) * PLANK_SHIFT_JITTER,
    left: PLANK_LEFT + range(rng, -1, 1) * PLANK_LENGTH_JITTER,
    right: PLANK_RIGHT + range(rng, -1, 1) * PLANK_LENGTH_JITTER,
    angle: range(rng, -1, 1) * PLANK_ANGLE_JITTER,
    hasKnot: rng() < KNOT_CHANCE,
    knotAt: range(rng, KNOT_MIN_ALONG, KNOT_MAX_ALONG),
    seed: Math.floor(rng() * SEED_RANGE),
  }));
}

const VARIANT_SEED_STRIDE = 7919;
const PLANK_SEED_SALT = 101;
const DAMAGE_SEED_SALT = 211;
const SEED_RANGE = 1_000_000;
const KNOT_MIN_ALONG = 0.3;
const KNOT_MAX_ALONG = 0.7;

/** What of a barrier to paint. */
export interface BarrierPose {
  readonly variant: number;
  /** 0 pristine … `BARRIER_DAMAGE_STAGES - 1` about to give. */
  readonly damageStage: number;
  /** Planks down so far; below `BARRIER_PLANK_COUNT` the battens are not on yet. */
  readonly planksLaid: number;
}

/**
 * Paints a barrier over the grate tile whose top-left corner is (x, y).
 */
export function paintBarrier(ctx: Ctx, x: number, y: number, ts: number, pose: BarrierPose): void {
  const planks = planPlanks(pose.variant);
  const damageRng = mulberry32(pose.variant * VARIANT_SEED_STRIDE + DAMAGE_SEED_SALT);
  const complete = pose.planksLaid >= BARRIER_PLANK_COUNT;
  const stage = complete ? pose.damageStage : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // One shadow for the whole panel, cast down-right onto the grate.
  ctx.fillStyle = DROP_SHADOW;
  for (let index = 0; index < pose.planksLaid; index++) {
    if (stage >= STAGE_FAILING && index === MISSING_PLANK) continue;
    const plank = planks[index];
    ctx.fillRect(
      ts * (plank.left + SHADOW_OFFSET),
      ts * (plank.top + SHADOW_OFFSET),
      ts * (plank.right - plank.left),
      ts * PLANK_HEIGHT,
    );
  }

  for (let index = 0; index < pose.planksLaid; index++) {
    const plank = planks[index];
    const broken =
      (stage >= STAGE_SPLINTERED && index === FIRST_BREAK_PLANK) ||
      (stage >= STAGE_FAILING && index === SECOND_BREAK_PLANK);
    if (stage >= STAGE_FAILING && index === MISSING_PLANK) {
      paintPlankStubs(ctx, ts, plank);
      continue;
    }
    if (broken) paintBrokenPlank(ctx, ts, plank);
    else paintPlank(ctx, ts, plank, plank.left, plank.right);
  }

  if (stage >= STAGE_SCUFFED) paintGouges(ctx, ts, planks[0], damageRng);
  if (stage >= STAGE_CRACKED) paintCrack(ctx, ts, planks[SECOND_BREAK_PLANK], damageRng);
  if (stage >= STAGE_FAILING) paintCrack(ctx, ts, planks[BARRIER_PLANK_COUNT - 1], damageRng);

  if (complete) {
    paintEndNails(ctx, ts, planks, stage);
    const braceAngle = stage >= STAGE_SPLINTERED ? LOOSE_BRACE_ANGLE : 0;
    paintBrace(ctx, ts, braceAngle);
    paintBraceNails(ctx, ts, planks, stage, braceAngle);
  }

  if (stage >= STAGE_SPLINTERED) paintSplinters(ctx, ts, planks[FIRST_BREAK_PLANK], damageRng);

  ctx.restore();
}

function withPlankFrame(ctx: Ctx, ts: number, plank: PlankPlan, draw: () => void): void {
  const cx = ts * (plank.left + plank.right) * HALF;
  const cy = ts * (plank.top + PLANK_HEIGHT * HALF);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(plank.angle);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function plankFill(ctx: Ctx, ts: number, top: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, ts * top, 0, ts * (top + PLANK_HEIGHT));
  gradient.addColorStop(0, WOOD_RIM);
  gradient.addColorStop(PLANK_LIT_BAND, WOOD_LIGHT);
  gradient.addColorStop(PLANK_BODY_BAND, WOOD_MID);
  gradient.addColorStop(1, WOOD_DARK);
  return gradient;
}

const PLANK_LIT_BAND = 0.18;
const PLANK_BODY_BAND = 0.55;

/** A whole plank, or a run of one, from `left` to `right` (tile fractions). */
function paintPlank(ctx: Ctx, ts: number, plank: PlankPlan, left: number, right: number): void {
  withPlankFrame(ctx, ts, plank, () => {
    const x0 = ts * left;
    const x1 = ts * right;
    const y0 = ts * plank.top;
    const h = ts * PLANK_HEIGHT;
    ctx.fillStyle = plankFill(ctx, ts, plank.top);
    ctx.fillRect(x0, y0, x1 - x0, h);
    paintGrain(ctx, ts, plank, x0, x1);
    if (plank.hasKnot) {
      const knotX = ts * (plank.left + (plank.right - plank.left) * plank.knotAt);
      if (knotX > x0 && knotX < x1) {
        ctx.fillStyle = WOOD_KNOT;
        ctx.beginPath();
        ctx.ellipse(knotX, y0 + h * HALF, ts * KNOT_RADIUS * 2, ts * KNOT_RADIUS, 0, 0, FULL_TURN);
        ctx.fill();
      }
    }
    ctx.fillStyle = WOOD_SHADOW;
    if (left === plank.left) ctx.fillRect(x0, y0, ts * END_GRAIN_WIDTH, h);
    if (right === plank.right) ctx.fillRect(x1 - ts * END_GRAIN_WIDTH, y0, ts * END_GRAIN_WIDTH, h);
    ctx.strokeStyle = WOOD_EDGE;
    ctx.lineWidth = ts * OUTLINE_WIDTH;
    ctx.strokeRect(x0, y0, x1 - x0, h);
  });
}

function paintGrain(ctx: Ctx, ts: number, plank: PlankPlan, x0: number, x1: number): void {
  const rng = mulberry32(plank.seed);
  ctx.strokeStyle = WOOD_GRAIN;
  ctx.lineWidth = ts * GRAIN_WIDTH;
  for (let line = 1; line <= GRAIN_LINES; line++) {
    const baseY = ts * (plank.top + (PLANK_HEIGHT * line) / (GRAIN_LINES + 1));
    const phase = rng() * FULL_TURN;
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    const steps = GRAIN_STEPS;
    for (let step = 1; step <= steps; step++) {
      const x = x0 + ((x1 - x0) * step) / steps;
      ctx.lineTo(x, baseY + Math.sin(phase + step) * ts * GRAIN_WAVE);
    }
    ctx.stroke();
  }
}

const GRAIN_STEPS = 6;

/** A plank snapped in the middle, both halves sagging into the shaft. */
function paintBrokenPlank(ctx: Ctx, ts: number, plank: PlankPlan): void {
  const middle = (plank.left + plank.right) * HALF;
  const leftEnd = middle - BREAK_GAP * HALF;
  const rightStart = middle + BREAK_GAP * HALF;
  paintSaggingHalf(ctx, ts, plank, plank.left, leftEnd, BROKEN_SAG, 'end');
  paintSaggingHalf(ctx, ts, plank, rightStart, plank.right, -BROKEN_SAG, 'start');
}

function paintSaggingHalf(
  ctx: Ctx,
  ts: number,
  plank: PlankPlan,
  left: number,
  right: number,
  sag: number,
  jaggedSide: 'start' | 'end',
): void {
  const pivotX = ts * (jaggedSide === 'end' ? left : right);
  const pivotY = ts * (plank.top + PLANK_HEIGHT * HALF);
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(sag);
  ctx.translate(-pivotX, -pivotY);
  paintPlank(ctx, ts, plank, left, right);
  paintJaggedEnd(ctx, ts, plank, jaggedSide === 'end' ? right : left, jaggedSide);
  ctx.restore();
}

/** Torn fibres across the width of a snapped end: pale inside, dark tips. */
function paintJaggedEnd(
  ctx: Ctx,
  ts: number,
  plank: PlankPlan,
  at: number,
  side: 'start' | 'end',
): void {
  withPlankFrame(ctx, ts, plank, () => {
    const direction = side === 'end' ? 1 : -1;
    const x = ts * at;
    const y0 = ts * plank.top;
    const toothHeight = (ts * PLANK_HEIGHT) / BREAK_TEETH;
    ctx.fillStyle = WOOD_FRESH;
    ctx.strokeStyle = WOOD_EDGE;
    ctx.lineWidth = ts * OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    for (let tooth = 0; tooth < BREAK_TEETH; tooth++) {
      const depth = ts * BREAK_TOOTH_DEPTH * (tooth % 2 === 0 ? 1 : HALF);
      ctx.lineTo(x + direction * depth, y0 + toothHeight * (tooth + HALF));
      ctx.lineTo(x, y0 + toothHeight * (tooth + 1));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

/** What is left of a plank torn clean away: a short nailed stub at each end. */
function paintPlankStubs(ctx: Ctx, ts: number, plank: PlankPlan): void {
  const leftStubEnd = plank.left + STUB_LENGTH;
  const rightStubStart = plank.right - STUB_LENGTH;
  paintPlank(ctx, ts, plank, plank.left, leftStubEnd);
  paintJaggedEnd(ctx, ts, plank, leftStubEnd, 'end');
  paintPlank(ctx, ts, plank, rightStubStart, plank.right);
  paintJaggedEnd(ctx, ts, plank, rightStubStart, 'start');
}

/** The brace's centre, length and lie, turned by `extraAngle` once it has been wrenched loose. */
function braceFrame(ts: number, extraAngle: number) {
  const startX = ts * BRACE_START.x;
  const startY = ts * BRACE_START.y;
  const endX = ts * BRACE_END.x;
  const endY = ts * BRACE_END.y;
  return {
    centreX: (startX + endX) * HALF,
    centreY: (startY + endY) * HALF,
    length: Math.hypot(endX - startX, endY - startY),
    angle: Math.atan2(endY - startY, endX - startX) + extraAngle,
  };
}

function paintBrace(ctx: Ctx, ts: number, extraAngle: number): void {
  const frame = braceFrame(ts, extraAngle);
  const width = ts * BRACE_WIDTH;
  ctx.save();
  ctx.translate(frame.centreX, frame.centreY);
  ctx.rotate(frame.angle);
  ctx.fillStyle = DROP_SHADOW;
  ctx.fillRect(
    -frame.length * HALF + ts * SHADOW_OFFSET,
    -width * HALF + ts * SHADOW_OFFSET,
    frame.length,
    width,
  );
  const gradient = ctx.createLinearGradient(0, -width * HALF, 0, width * HALF);
  gradient.addColorStop(0, WOOD_RIM);
  gradient.addColorStop(PLANK_LIT_BAND, WOOD_LIGHT);
  gradient.addColorStop(PLANK_BODY_BAND, WOOD_MID);
  gradient.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = gradient;
  ctx.fillRect(-frame.length * HALF, -width * HALF, frame.length, width);
  ctx.fillStyle = WOOD_FRESH;
  ctx.fillRect(-frame.length * HALF, -width * HALF, ts * END_GRAIN_WIDTH, width);
  ctx.fillRect(
    frame.length * HALF - ts * END_GRAIN_WIDTH,
    -width * HALF,
    ts * END_GRAIN_WIDTH,
    width,
  );
  ctx.strokeStyle = WOOD_GRAIN;
  ctx.lineWidth = ts * GRAIN_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-frame.length * HALF, 0);
  ctx.lineTo(frame.length * HALF, 0);
  ctx.stroke();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = ts * OUTLINE_WIDTH;
  ctx.strokeRect(-frame.length * HALF, -width * HALF, frame.length, width);
  ctx.restore();
}

/** Where the brace crosses each plank's middle line, nailed through. */
function paintBraceNails(
  ctx: Ctx,
  ts: number,
  planks: readonly PlankPlan[],
  stage: number,
  extraAngle: number,
): void {
  const frame = braceFrame(ts, extraAngle);
  const slope = Math.tan(frame.angle);
  planks.forEach((plank, index) => {
    if (stage >= STAGE_FAILING && index === MISSING_PLANK) return;
    const cy = ts * (plank.top + PLANK_HEIGHT * HALF);
    const cx = frame.centreX + (cy - frame.centreY) / slope;
    // A wrenched brace no longer sits over every plank; those nails pulled out with it.
    if (Math.abs(cx - frame.centreX) > frame.length * HALF) return;
    paintNail(ctx, cx, cy, ts, false);
  });
}

/** Two nails at each end of every plank; the first to work loose is the top plank's left one. */
function paintEndNails(ctx: Ctx, ts: number, planks: readonly PlankPlan[], stage: number): void {
  planks.forEach((plank, index) => {
    if (stage >= STAGE_FAILING && index === MISSING_PLANK) return;
    withPlankFrame(ctx, ts, plank, () => {
      const cy = ts * (plank.top + PLANK_HEIGHT * HALF);
      const popped = stage >= STAGE_SCUFFED && index === 0;
      const lift = popped ? ts * POPPED_NAIL_LIFT : 0;
      paintNail(ctx, ts * (plank.left + END_NAIL_INSET), cy - lift, ts, popped);
      paintNail(ctx, ts * (plank.right - END_NAIL_INSET), cy, ts, false);
    });
  });
}

function paintNail(ctx: Ctx, cx: number, cy: number, ts: number, popped: boolean): void {
  const radius = ts * NAIL_RADIUS;
  if (popped) {
    // A nail worked half out shows its shank as a short dark stroke.
    ctx.strokeStyle = IRON_EDGE;
    ctx.lineWidth = radius;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius, cy + radius * 2);
    ctx.stroke();
  }
  ctx.fillStyle = IRON_EDGE;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * NAIL_OUTLINE_SCALE, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = IRON_MID;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = IRON_LIGHT;
  ctx.beginPath();
  ctx.arc(cx - radius * HALF * HALF, cy - radius * HALF * HALF, radius * HALF, 0, FULL_TURN);
  ctx.fill();
}

const NAIL_OUTLINE_SCALE = 1.35;

/** Claw gouges: pale scored wood with a dark lip on the shadow side. */
function paintGouges(ctx: Ctx, ts: number, plank: PlankPlan, rng: Rng): void {
  withPlankFrame(ctx, ts, plank, () => {
    const startX = ts * range(rng, GOUGE_MIN_ALONG, GOUGE_MAX_ALONG);
    const startY = ts * (plank.top + PLANK_HEIGHT * GOUGE_ROW);
    ctx.lineWidth = ts * GOUGE_WIDTH;
    for (let gouge = 0; gouge < GOUGE_COUNT; gouge++) {
      const offset = ts * GOUGE_SPACING * gouge;
      ctx.strokeStyle = GOUGE_DARK;
      ctx.beginPath();
      ctx.moveTo(startX + offset, startY + ts * GOUGE_WIDTH);
      ctx.lineTo(startX + offset + ts * GOUGE_LENGTH, startY + ts * GOUGE_WIDTH + ts * GOUGE_SLOPE);
      ctx.stroke();
      ctx.strokeStyle = GOUGE_LIGHT;
      ctx.beginPath();
      ctx.moveTo(startX + offset, startY);
      ctx.lineTo(startX + offset + ts * GOUGE_LENGTH, startY + ts * GOUGE_SLOPE);
      ctx.stroke();
    }
  });
}

const GOUGE_MIN_ALONG = 0.25;
const GOUGE_MAX_ALONG = 0.5;
const GOUGE_ROW = 0.3;
const GOUGE_SLOPE = 0.08;

/** A split running along a plank's grain. */
function paintCrack(ctx: Ctx, ts: number, plank: PlankPlan, rng: Rng): void {
  withPlankFrame(ctx, ts, plank, () => {
    const y = ts * (plank.top + PLANK_HEIGHT * HALF);
    const start = plank.left + (plank.right - plank.left) * CRACK_START;
    const end = plank.left + (plank.right - plank.left) * CRACK_END;
    ctx.strokeStyle = CRACK_INK;
    ctx.lineWidth = ts * CRACK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(ts * start, y);
    for (let segment = 1; segment <= CRACK_SEGMENTS; segment++) {
      const x = start + ((end - start) * segment) / CRACK_SEGMENTS;
      ctx.lineTo(ts * x, y + ts * range(rng, -1, 1) * CRACK_WANDER);
    }
    ctx.stroke();
  });
}

const CRACK_START = 0.15;
const CRACK_END = 0.75;

/** Slivers standing up off a snapped plank. */
function paintSplinters(ctx: Ctx, ts: number, plank: PlankPlan, rng: Rng): void {
  const middle = (plank.left + plank.right) * HALF;
  const y = plank.top + PLANK_HEIGHT * HALF;
  for (let splinter = 0; splinter < SPLINTER_COUNT; splinter++) {
    const angle = range(rng, -Math.PI, 0);
    const baseX = ts * (middle + range(rng, -1, 1) * BREAK_GAP);
    const baseY = ts * (y + range(rng, -1, 1) * PLANK_HEIGHT * HALF);
    const tipX = baseX + Math.cos(angle) * ts * SPLINTER_LENGTH;
    const tipY = baseY + Math.sin(angle) * ts * SPLINTER_LENGTH;
    const sideX = -Math.sin(angle) * ts * SPLINTER_WIDTH;
    const sideY = Math.cos(angle) * ts * SPLINTER_WIDTH;
    ctx.fillStyle = WOOD_FRESH;
    ctx.strokeStyle = WOOD_EDGE;
    ctx.lineWidth = ts * OUTLINE_WIDTH * HALF;
    ctx.beginPath();
    ctx.moveTo(baseX + sideX, baseY + sideY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX - sideX, baseY - sideY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ── Wood pile ───────────────────────────────────────────────────────────────

/** How far the stacked pile stands above its tile's top edge. */
export const WOOD_PILE_RISE = 0.12;
/** Horizontal overhang of the pile past its tile, each side. */
export const WOOD_PILE_OVERHANG = 0.12;

/** Ground line the pile stands on, as a fraction down its tile. */
const PILE_GROUND = 0.9;
const PALLET_HEIGHT = 0.1;
const PILE_LEFT = -0.08;
const PILE_RIGHT = 1.08;
/** A board seen lying lengthwise: a thin lit top face over its sawn front edge. */
const BOARD_TOP_FACE = 0.075;
const BOARD_FRONT_FACE = 0.11;
const BOARD_END_JITTER = 0.05;
const STOCKED_FRONT_BOARDS = 5;
const STOCKED_BACK_BOARDS = 3;
const DEPLETED_FRONT_BOARDS = 1;
/** The back stack sits up and to the right of the front one, and a shade darker. */
const BACK_STACK_LIFT = 0.16;
const BACK_STACK_SHIFT = 0.1;
const BACK_STACK_SHADE = 'rgba(20,12,4,0.35)';
const END_GRAIN_SQUARE = 0.1;
const ROPE_COLOR = '#b89660';
const ROPE_SHADOW = '#6f5530';
const ROPE_WIDTH = 0.035;
const ROPE_LEFT_AT = 0.26;
const ROPE_RIGHT_AT = 0.74;
const OFFCUT_COUNT = 3;
const OFFCUT_LENGTH = 0.14;
const OFFCUT_HEIGHT = 0.06;
const SAWDUST_FLECKS = 26;
const SAWDUST_FLECK_SIZE = 0.022;
const CONTACT_ALPHA = 'rgba(0,0,0,0.4)';
const CONTACT_WIDTH = 0.66;
const CONTACT_HEIGHT = 0.12;
const PILE_SEED = 4242;

/**
 * Paints the wood pile on the tile whose top-left is (x, y). A `stocked` pile
 * is two bound stacks of sawn boards on a pallet; a picked-over one is the
 * pallet, a board, offcuts and the sawdust.
 */
export function paintWoodPile(ctx: Ctx, x: number, y: number, ts: number, stocked: boolean): void {
  const rng = mulberry32(PILE_SEED);
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.translate(ts * HALF, ts * PILE_GROUND);
  ctx.scale(1, CONTACT_HEIGHT / CONTACT_WIDTH);
  const contact = ctx.createRadialGradient(0, 0, 0, 0, 0, ts * CONTACT_WIDTH);
  contact.addColorStop(0, CONTACT_ALPHA);
  contact.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = contact;
  ctx.beginPath();
  ctx.arc(0, 0, ts * CONTACT_WIDTH, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = SAWDUST;
  for (let fleck = 0; fleck < SAWDUST_FLECKS; fleck++) {
    const size = ts * SAWDUST_FLECK_SIZE * range(rng, HALF, 1);
    ctx.fillRect(
      ts * range(rng, PILE_LEFT, PILE_RIGHT),
      ts * range(rng, PILE_GROUND - PALLET_HEIGHT, 1),
      size,
      size,
    );
  }

  const palletTop = PILE_GROUND - PALLET_HEIGHT;
  if (stocked) {
    paintBoardStack(
      ctx,
      ts,
      palletTop - BACK_STACK_LIFT,
      BACK_STACK_SHIFT,
      STOCKED_BACK_BOARDS,
      rng,
    );
    ctx.fillStyle = BACK_STACK_SHADE;
    ctx.fillRect(
      ts * (PILE_LEFT + BACK_STACK_SHIFT),
      ts * (palletTop - BACK_STACK_LIFT - STOCKED_BACK_BOARDS * BOARD_FRONT_FACE - BOARD_TOP_FACE),
      ts * (PILE_RIGHT - PILE_LEFT),
      ts * (STOCKED_BACK_BOARDS * BOARD_FRONT_FACE + BOARD_TOP_FACE),
    );
  }
  paintPallet(ctx, ts, palletTop);
  const frontBoards = stocked ? STOCKED_FRONT_BOARDS : DEPLETED_FRONT_BOARDS;
  paintBoardStack(ctx, ts, palletTop, 0, frontBoards, rng);
  if (stocked) {
    const stackTop = palletTop - frontBoards * BOARD_FRONT_FACE - BOARD_TOP_FACE;
    for (const at of [ROPE_LEFT_AT, ROPE_RIGHT_AT]) paintRope(ctx, ts, at, stackTop, palletTop);
  } else {
    paintOffcuts(ctx, ts, rng);
  }

  ctx.restore();
}

function paintPallet(ctx: Ctx, ts: number, top: number): void {
  const left = ts * PILE_LEFT;
  const width = ts * (PILE_RIGHT - PILE_LEFT);
  const height = ts * PALLET_HEIGHT;
  ctx.fillStyle = WOOD_SHADOW;
  ctx.fillRect(left, ts * top, width, height);
  ctx.fillStyle = WOOD_EDGE;
  for (const at of PALLET_GAPS) {
    ctx.fillRect(
      left + width * at,
      ts * top + height * HALF,
      width * PALLET_GAP_WIDTH,
      height * HALF,
    );
  }
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, ts * top, width, height * HALF);
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = ts * OUTLINE_WIDTH;
  ctx.strokeRect(left, ts * top, width, height);
}

/** The dark openings between a pallet's blocks, as fractions of its width. */
const PALLET_GAPS = [0.2, 0.62] as const;
const PALLET_GAP_WIDTH = 0.18;

/** `count` boards stacked on `base` (the stack's bottom edge), shifted right by `shift`. */
function paintBoardStack(
  ctx: Ctx,
  ts: number,
  base: number,
  shift: number,
  count: number,
  rng: Rng,
): void {
  for (let board = 0; board < count; board++) {
    const frontBottom = base - board * BOARD_FRONT_FACE;
    const left = PILE_LEFT + shift + range(rng, 0, BOARD_END_JITTER);
    const right = PILE_RIGHT + shift - range(rng, 0, BOARD_END_JITTER);
    paintLyingBoard(ctx, ts, left, right, frontBottom, board === count - 1);
  }
}

function paintLyingBoard(
  ctx: Ctx,
  ts: number,
  left: number,
  right: number,
  frontBottom: number,
  showTop: boolean,
): void {
  const x0 = ts * left;
  const width = ts * (right - left);
  const frontTop = ts * (frontBottom - BOARD_FRONT_FACE);
  const frontHeight = ts * BOARD_FRONT_FACE;
  const front = ctx.createLinearGradient(0, frontTop, 0, frontTop + frontHeight);
  front.addColorStop(0, WOOD_LIGHT);
  front.addColorStop(1, WOOD_DARK);
  ctx.fillStyle = front;
  ctx.fillRect(x0, frontTop, width, frontHeight);
  ctx.fillStyle = WOOD_GRAIN;
  ctx.fillRect(x0, frontTop + frontHeight * HALF, width, ts * GRAIN_WIDTH);
  ctx.fillStyle = WOOD_FRESH;
  ctx.fillRect(x0, frontTop, ts * END_GRAIN_SQUARE, frontHeight);
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = ts * OUTLINE_WIDTH;
  ctx.strokeRect(x0, frontTop, width, frontHeight);
  if (!showTop) return;
  const topY = frontTop - ts * BOARD_TOP_FACE;
  ctx.fillStyle = WOOD_RIM;
  ctx.fillRect(x0, topY, width, ts * BOARD_TOP_FACE);
  ctx.strokeRect(x0, topY, width, ts * BOARD_TOP_FACE);
}

function paintRope(ctx: Ctx, ts: number, at: number, top: number, bottom: number): void {
  const x = ts * (PILE_LEFT + (PILE_RIGHT - PILE_LEFT) * at);
  const width = ts * ROPE_WIDTH;
  ctx.fillStyle = ROPE_SHADOW;
  ctx.fillRect(x - width * HALF, ts * top, width, ts * (bottom - top));
  ctx.fillStyle = ROPE_COLOR;
  ctx.fillRect(x - width * HALF, ts * top, width * HALF, ts * (bottom - top));
}

/** Short sawn ends left on the floor by a picked-over pile. */
function paintOffcuts(ctx: Ctx, ts: number, rng: Rng): void {
  for (let offcut = 0; offcut < OFFCUT_COUNT; offcut++) {
    const left = range(rng, PILE_LEFT, PILE_RIGHT - OFFCUT_LENGTH);
    const bottom = range(rng, PILE_GROUND - PALLET_HEIGHT, 1);
    ctx.save();
    const cx = ts * (left + OFFCUT_LENGTH * HALF);
    const cy = ts * bottom;
    ctx.translate(cx, cy);
    ctx.rotate(range(rng, -1, 1) * OFFCUT_TILT);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = WOOD_MID;
    ctx.fillRect(ts * left, ts * (bottom - OFFCUT_HEIGHT), ts * OFFCUT_LENGTH, ts * OFFCUT_HEIGHT);
    ctx.fillStyle = WOOD_FRESH;
    ctx.fillRect(
      ts * left,
      ts * (bottom - OFFCUT_HEIGHT),
      ts * END_GRAIN_WIDTH,
      ts * OFFCUT_HEIGHT,
    );
    ctx.strokeStyle = WOOD_EDGE;
    ctx.lineWidth = ts * OUTLINE_WIDTH;
    ctx.strokeRect(
      ts * left,
      ts * (bottom - OFFCUT_HEIGHT),
      ts * OFFCUT_LENGTH,
      ts * OFFCUT_HEIGHT,
    );
    ctx.restore();
  }
}

const OFFCUT_TILT = 0.5;

// ── Wall torch ──────────────────────────────────────────────────────────────

const BRACKET_WIDTH = 0.26;
const BRACKET_HEIGHT = 0.1;
const BRACKET_Y = 0.62;
const HAFT_WIDTH = 0.1;
const HAFT_HEIGHT = 0.36;
const HAFT_TOP = 0.3;
const WRAP_HEIGHT = 0.1;
const WRAP_COLOR = '#3b2a1c';
const SOOT_COLOR = 'rgba(10,8,6,0.45)';
const SOOT_WIDTH = 0.32;
const SOOT_HEIGHT = 0.5;

/** Where on the torch's tile the flame's root sits, as tile fractions. */
export const TORCH_FLAME_ROOT = { x: 0.5, y: 0.3 } as const;

/**
 * Paints a wall torch — soot stain, iron bracket, wrapped haft — on the wall
 * tile whose top-left is (x, y). The flame is drawn live over it.
 */
export function paintWallTorch(ctx: Ctx, x: number, y: number, ts: number): void {
  ctx.save();
  ctx.translate(x, y);
  const soot = ctx.createRadialGradient(
    ts * HALF,
    ts * HAFT_TOP,
    0,
    ts * HALF,
    ts * HAFT_TOP,
    ts * SOOT_HEIGHT,
  );
  soot.addColorStop(0, SOOT_COLOR);
  soot.addColorStop(1, 'rgba(10,8,6,0)');
  ctx.fillStyle = soot;
  ctx.fillRect(ts * (HALF - SOOT_WIDTH), 0, ts * SOOT_WIDTH * 2, ts * (HAFT_TOP + SOOT_HEIGHT));

  const haftLeft = ts * (HALF - HAFT_WIDTH * HALF);
  const haft = ctx.createLinearGradient(haftLeft, 0, haftLeft + ts * HAFT_WIDTH, 0);
  haft.addColorStop(0, WOOD_LIGHT);
  haft.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = haft;
  ctx.fillRect(haftLeft, ts * HAFT_TOP, ts * HAFT_WIDTH, ts * HAFT_HEIGHT);
  ctx.fillStyle = WRAP_COLOR;
  ctx.fillRect(haftLeft, ts * HAFT_TOP, ts * HAFT_WIDTH, ts * WRAP_HEIGHT);
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = ts * OUTLINE_WIDTH;
  ctx.strokeRect(haftLeft, ts * HAFT_TOP, ts * HAFT_WIDTH, ts * HAFT_HEIGHT);

  const bracketLeft = ts * (HALF - BRACKET_WIDTH * HALF);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(bracketLeft, ts * BRACKET_Y, ts * BRACKET_WIDTH, ts * BRACKET_HEIGHT);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(bracketLeft, ts * BRACKET_Y, ts * BRACKET_WIDTH, ts * BRACKET_HEIGHT * HALF * HALF);
  ctx.strokeStyle = IRON_EDGE;
  ctx.strokeRect(bracketLeft, ts * BRACKET_Y, ts * BRACKET_WIDTH, ts * BRACKET_HEIGHT);
  ctx.restore();
}
