/**
 * The village trebuchet, painted live: a timber base frame, two A-frames
 * carrying the axle, a long throwing arm with a sling, a counterweight box,
 * and a stone bucket at its foot that shows how much ammunition is loaded.
 *
 * Top-down in the game's 3/4 view, two tiles wide and three deep. The axle
 * runs front to back between two A-frames, so the arm turns in the east–west
 * plane and on screen it simply rotates: cocked, its long end rests on the
 * ground to the west with the counterweight raised; loosed, it has swung over
 * the top and out to the east. Everything stays inside the
 * two tile columns — the arm and the A-frames may rise above the footprint,
 * which is height, but nothing reaches sideways onto ground a body can stand
 * on.
 *
 * Painted live rather than baked because the arm and the sling animate; the
 * frame is a few dozen fills, which is cheap for the handful a village holds.
 */

import { INK, IRON, LOG, STONE, WOOD, drawContactShadow, fillRoundRect } from './villageArt';
import { FLAME } from './villageArt';

/** Everything the painter needs to know about one trebuchet this frame. */
export interface TrebuchetDrawState {
  /**
   * The long arm's angle in radians, 0 pointing east and positive lifting it.
   * {@link TREBUCHET_COCKED_ANGLE} rests the long end on the ground to the
   * west; a throw runs the angle down to {@link TREBUCHET_LOOSED_ANGLE},
   * carrying the tip up over the top and out to the east.
   */
  readonly armAngle: number;
  /** 0 with the sling hanging from the arm's tip; the throw whips it once round (0–1). */
  readonly slingPhase: number;
  readonly broken: boolean;
  /** 0 intact, 1 cracked, 2 wrecked. */
  readonly damageStage: number;
  readonly spikes: boolean;
  /** 0 empty, 1 a full bucket. */
  readonly ammoFraction: number;
  /** The counterweight smoulders with embers. */
  readonly infernal: boolean;
  /** Scaffold state while it is being built, 0–1; 1 (or absent) is finished. */
  readonly progress?: number;
  /** Seconds, for the ember flicker. */
  readonly timeSeconds?: number;
}

/** Arm resting cocked, long end on the ground at the front. */
export const TREBUCHET_COCKED_ANGLE = (-122 * Math.PI) / 180;
/** Arm at the end of its throw, standing up past the axle. */
export const TREBUCHET_LOOSED_ANGLE = ((72 - 360) * Math.PI) / 180;

export const TREBUCHET_FOOTPRINT_W = 2;
export const TREBUCHET_FOOTPRINT_H = 3;
/** How far above its footprint a trebuchet's art can rise: a loosed arm standing tall. */
export const TREBUCHET_REACH_UP_TILES = 2.2;

// Geometry, in tiles from the footprint's top-left.
const SILL_INSET = 0.3;
const SILL_TOP = 0.45;
const SILL_BOTTOM = 2.85;
const BEAM_WIDTH = 0.16;
/** The two A-frames stand across the frame, front and back, with the axle running between their apexes. */
const BACK_FRAME_Y = 1.2;
const FRONT_FRAME_Y = 2.15;
const AXLE_WORLD_Y = (BACK_FRAME_Y + FRONT_FRAME_Y) / 2;
/** A cross-brace ties each A-frame's legs, this far up its height and in from each foot. */
const LEG_BRACE_AT = 0.35;
const LEG_BRACE_INSET = 0.22;
const BROKEN_LEG_TILT = 0.2;
const AXLE_HEIGHT = 1.35;
const LONG_ARM = 1.5;
const SHORT_ARM = 0.5;
const ARM_WIDTH = 0.17;
const WEIGHT_W = 0.62;
const WEIGHT_H = 0.42;
const SLING_LENGTH = 0.45;
/** The sling swings across the frame foreshortened: its sideways reach is this share of its drop. */
const SLING_ACROSS_FORESHORTEN = 0.35;
/** Angle the resting pouch lies at from the tip, down and a little to the west. */
const SLING_RESTING_SWING = Math.PI * 0.6;
const POUCH_RADIUS = 0.09;
const BUCKET_X = 1.46;
const BUCKET_Y = 2.52;
const BUCKET_RX = 0.24;
const BUCKET_RY = 0.13;
const BUCKET_DEPTH = 0.22;
const AMMO_STONES = 7;
const SPIKE_LENGTH = 0.22;
const INK_WIDTH = 0.025;
const EMBER_FLICKER_HZ = 3;
const EMBER_COUNT = 6;
/** Within this of the cocked angle the arm counts as at rest, its sling laid on the ground. */
const RESTING_TOLERANCE = 0.01;

type Point = { x: number; y: number };

export function drawTrebuchet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  state: TrebuchetDrawState,
): void {
  const progress = Math.max(0, Math.min(1, state.progress ?? 1));
  const tp = (tx: number, ty: number): Point => ({ x: x + tx * ts, y: y + ty * ts });
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(
      x,
      y - TREBUCHET_REACH_UP_TILES * ts,
      TREBUCHET_FOOTPRINT_W * ts,
      (TREBUCHET_FOOTPRINT_H + TREBUCHET_REACH_UP_TILES) * ts,
    );
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawContactShadow(ctx, x + ts, y + ts * 1.75, ts * 0.95, ts * 1.2, 0.3);

    if (progress < 1) {
      drawBaseFrame(ctx, tp, ts, state.damageStage);
      drawRising(ctx, x, y, ts, progress, () => drawUpperWorks(ctx, tp, ts, state));
      drawScaffold(ctx, tp, ts, progress);
      return;
    }
    if (state.spikes) drawSpikes(ctx, tp, ts, 'back');
    drawBaseFrame(ctx, tp, ts, state.damageStage);
    drawUpperWorks(ctx, tp, ts, state);
    drawBucket(ctx, tp, ts, state.ammoFraction);
    if (state.spikes) drawSpikes(ctx, tp, ts, 'front');
  } finally {
    ctx.restore();
  }
}

/** Screen position of a point at world depth `worldY` (tiles) and height `z` (tiles), on column `tx`. */
function lift(tp: (tx: number, ty: number) => Point, tx: number, worldY: number, z: number): Point {
  return tp(tx, worldY - z);
}

function beam(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  width: number,
  color: string,
  ts: number,
): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + ts * INK_WIDTH * 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  // A lit edge along the upper-left of each timber.
  ctx.strokeStyle = WOOD.highlight;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, width * 0.25);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * width * 0.25;
  const ny = (dx / length) * width * 0.25;
  const offsetX = ny < 0 ? nx : -nx;
  const offsetY = ny < 0 ? ny : -ny;
  ctx.beginPath();
  ctx.moveTo(a.x + offsetX, a.y + offsetY);
  ctx.lineTo(b.x + offsetX, b.y + offsetY);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBaseFrame(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  damageStage: number,
): void {
  const width = BEAM_WIDTH * ts;
  const left = SILL_INSET;
  const right = TREBUCHET_FOOTPRINT_W - SILL_INSET;
  beam(ctx, tp(left, SILL_TOP), tp(right, SILL_TOP), width, WOOD.mid, ts);
  beam(ctx, tp(left, SILL_TOP), tp(left, SILL_BOTTOM), width, WOOD.body, ts);
  beam(ctx, tp(right, SILL_TOP), tp(right, SILL_BOTTOM), width, WOOD.body, ts);
  if (damageStage < 2) {
    beam(ctx, tp(left, SILL_BOTTOM), tp(right, SILL_BOTTOM), width, WOOD.mid, ts);
  } else {
    // The front cross-beam has sprung off one side.
    beam(ctx, tp(left, SILL_BOTTOM), tp(right - 0.35, SILL_BOTTOM - 0.18), width, WOOD.dark, ts);
  }
  for (const frameY of [BACK_FRAME_Y, FRONT_FRAME_Y]) {
    beam(ctx, tp(left, frameY), tp(right, frameY), width * 0.8, WOOD.dark, ts);
  }
  if (damageStage >= 1) crackAlong(ctx, tp(left, SILL_TOP + 0.4), tp(left, SILL_TOP + 1.1), ts);
}

function crackAlong(ctx: CanvasRenderingContext2D, a: Point, b: Point, ts: number): void {
  ctx.strokeStyle = WOOD.deep;
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  const steps = 4;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wobble = (step % 2 === 0 ? 1 : -1) * ts * 0.025;
    const px = a.x + (b.x - a.x) * t + wobble;
    const py = a.y + (b.y - a.y) * t;
    if (step === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawUpperWorks(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  state: TrebuchetDrawState,
): void {
  const width = BEAM_WIDTH * ts;
  const left = SILL_INSET;
  const right = TREBUCHET_FOOTPRINT_W - SILL_INSET;
  const cx = TREBUCHET_FOOTPRINT_W / 2;
  const backApex = lift(tp, cx, BACK_FRAME_Y, AXLE_HEIGHT);
  const frontApex = lift(tp, cx, FRONT_FRAME_Y, AXLE_HEIGHT);
  // The back A-frame, then the arm between the frames, then the front A-frame over it.
  beam(ctx, tp(left, BACK_FRAME_Y), backApex, width, WOOD.dark, ts);
  beam(ctx, tp(right, BACK_FRAME_Y), backApex, width, WOOD.dark, ts);
  beam(
    ctx,
    tp(left + LEG_BRACE_INSET, BACK_FRAME_Y - AXLE_HEIGHT * LEG_BRACE_AT),
    tp(right - LEG_BRACE_INSET, BACK_FRAME_Y - AXLE_HEIGHT * LEG_BRACE_AT),
    width * 0.7,
    WOOD.deep,
    ts,
  );
  // The axle runs front to back between the two apexes.
  beam(ctx, backApex, frontApex, width * 0.75, WOOD.deep, ts);
  // A broken trebuchet stands on a leg knocked askew.
  const brokenTilt = state.broken ? BROKEN_LEG_TILT : 0;
  beam(ctx, tp(left, FRONT_FRAME_Y), frontApex, width, WOOD.body, ts);
  beam(
    ctx,
    tp(right - brokenTilt, FRONT_FRAME_Y + brokenTilt * 0.5),
    frontApex,
    width,
    WOOD.body,
    ts,
  );
  if (state.damageStage < 1) {
    beam(
      ctx,
      tp(left + LEG_BRACE_INSET, FRONT_FRAME_Y - AXLE_HEIGHT * LEG_BRACE_AT),
      tp(right - LEG_BRACE_INSET - brokenTilt * 0.5, FRONT_FRAME_Y - AXLE_HEIGHT * LEG_BRACE_AT),
      width * 0.7,
      WOOD.mid,
      ts,
    );
  } else {
    // The front brace has come loose and hangs from one leg.
    const braceRoot = tp(left + LEG_BRACE_INSET, FRONT_FRAME_Y - AXLE_HEIGHT * LEG_BRACE_AT);
    beam(
      ctx,
      braceRoot,
      tp(left + LEG_BRACE_INSET + 0.35, FRONT_FRAME_Y - 0.05),
      width * 0.7,
      WOOD.dark,
      ts,
    );
    drawSplinters(ctx, braceRoot, ts);
  }

  for (const cap of [backApex, frontApex]) {
    ctx.fillStyle = IRON.body;
    ctx.beginPath();
    ctx.arc(cap.x, cap.y, ts * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = IRON.glint;
    ctx.beginPath();
    ctx.arc(cap.x - ts * 0.02, cap.y - ts * 0.02, ts * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  // The arm last, over the front frame: it is what says "trebuchet" at a glance.
  drawArm(ctx, tp, ts, state);
}

/**
 * The arm's two ends on screen for a given angle. The arm turns in the
 * east–west plane about the axle's middle, so on screen it simply rotates:
 * angle 0 points east, and positive angles lift it.
 */
function armEnds(
  tp: (tx: number, ty: number) => Point,
  angle: number,
): { pivot: Point; long: Point; short: Point } {
  const cx = TREBUCHET_FOOTPRINT_W / 2;
  const pivot = lift(tp, cx, AXLE_WORLD_Y, AXLE_HEIGHT);
  const across = Math.cos(angle);
  const up = Math.sin(angle);
  const long = lift(tp, cx + across * LONG_ARM, AXLE_WORLD_Y, AXLE_HEIGHT + up * LONG_ARM);
  const short = lift(tp, cx - across * SHORT_ARM, AXLE_WORLD_Y, AXLE_HEIGHT - up * SHORT_ARM);
  return { pivot, long, short };
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  state: TrebuchetDrawState,
): void {
  const width = ARM_WIDTH * ts;
  const angle = state.broken ? TREBUCHET_COCKED_ANGLE : state.armAngle;
  const { pivot, long, short } = armEnds(tp, angle);
  // The counterweight hangs plumb from the short end, whichever way the arm points.
  beam(ctx, short, pivot, width, WOOD.mid, ts);
  drawCounterweight(ctx, short, ts, state);
  if (state.broken) {
    // Snapped a third of the way out: the stub, and the rest lying on the ground.
    const snap = { x: pivot.x + (long.x - pivot.x) * 0.35, y: pivot.y + (long.y - pivot.y) * 0.35 };
    beam(ctx, pivot, snap, width, WOOD.mid, ts);
    const fallen = tp(TREBUCHET_FOOTPRINT_W / 2 - 0.55, SILL_BOTTOM - 0.15);
    beam(ctx, { x: snap.x - ts * 0.04, y: snap.y + ts * 0.1 }, fallen, width, WOOD.body, ts);
    drawSplinters(ctx, snap, ts);
    // A loose rope trailing from the stub to the dirt.
    const ropeEnd = tp(1.45, SILL_BOTTOM - 0.3);
    ctx.strokeStyle = LOG.cut;
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(snap.x, snap.y);
    ctx.quadraticCurveTo(snap.x + ts * 0.4, snap.y + ts * 0.5, ropeEnd.x, ropeEnd.y);
    ctx.stroke();
    return;
  }
  beam(ctx, pivot, long, width, WOOD.light, ts);
  drawSling(ctx, long, ts, state.slingPhase, angle);
}

function drawSplinters(ctx: CanvasRenderingContext2D, at: Point, ts: number): void {
  ctx.strokeStyle = LOG.cut;
  ctx.lineWidth = Math.max(1, ts * 0.02);
  for (const [dx, dy] of [
    [0.08, -0.05],
    [-0.06, -0.08],
    [0.02, -0.11],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x + dx * ts, at.y + dy * ts);
    ctx.stroke();
  }
}

function drawCounterweight(
  ctx: CanvasRenderingContext2D,
  shortEnd: Point,
  ts: number,
  state: TrebuchetDrawState,
): void {
  const w = WEIGHT_W * ts;
  const h = WEIGHT_H * ts;
  const hangTop = shortEnd.y + ts * 0.06;
  const left = shortEnd.x - w / 2;
  ctx.strokeStyle = IRON.dark;
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.beginPath();
  ctx.moveTo(shortEnd.x, shortEnd.y);
  ctx.lineTo(shortEnd.x, hangTop);
  ctx.stroke();
  fillRoundRect(ctx, left, hangTop, w, h, ts * 0.03, WOOD.dark);
  // The box is full of fieldstone, showing over its rim.
  fillRoundRect(
    ctx,
    left + w * 0.08,
    hangTop - ts * 0.05,
    w * 0.84,
    ts * 0.12,
    ts * 0.05,
    STONE.body,
  );
  ctx.strokeStyle = WOOD.deep;
  ctx.lineWidth = Math.max(1, ts * 0.018);
  for (const at of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.moveTo(left, hangTop + h * at);
    ctx.lineTo(left + w, hangTop + h * at);
    ctx.stroke();
  }
  ctx.fillStyle = IRON.body;
  ctx.fillRect(left, hangTop, ts * 0.05, h);
  ctx.fillRect(left + w - ts * 0.05, hangTop, ts * 0.05, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.strokeRect(left, hangTop, w, h);
  if (state.infernal) {
    const t = state.timeSeconds ?? 0;
    const flicker = 0.75 + 0.25 * Math.sin(t * Math.PI * 2 * EMBER_FLICKER_HZ);
    const glow = ctx.createRadialGradient(
      shortEnd.x,
      hangTop + h / 2,
      ts * 0.05,
      shortEnd.x,
      hangTop + h / 2,
      w * 0.7,
    );
    glow.addColorStop(0, `rgba(255,170,70,${0.85 * flicker})`);
    glow.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(left - w * 0.2, hangTop - h * 0.3, w * 1.4, h * 1.6);
    // Coals glowing through the slats.
    ctx.fillStyle = `rgba(255,120,40,${0.7 * flicker})`;
    ctx.fillRect(left + ts * 0.05, hangTop + h * 0.2, w - ts * 0.1, h * 0.6);
    for (let ember = 0; ember < EMBER_COUNT; ember++) {
      const ex = left + w * ((ember * 0.37 + 0.1) % 1);
      const ey = hangTop - ts * 0.02 + ((ember * 0.53) % 1) * ts * 0.08;
      ctx.fillStyle = ember % 2 === 0 ? FLAME.mid : FLAME.edge;
      ctx.globalAlpha = flicker;
      ctx.beginPath();
      ctx.arc(ex, ey, ts * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Where the sling's pouch hangs from the arm's tip, in tiles. Resting cocked,
 * it lies on the ground beside the tip; in a throw it whips round.
 */
function pouchOffsetTiles(phase: number, armAngle: number): Point {
  const resting = armAngle >= TREBUCHET_COCKED_ANGLE - RESTING_TOLERANCE && phase <= 0;
  const swing = resting ? SLING_RESTING_SWING : Math.PI / 2 - phase * Math.PI * 2;
  return {
    x: Math.cos(swing) * SLING_LENGTH * SLING_ACROSS_FORESHORTEN,
    y: Math.sin(swing) * SLING_LENGTH,
  };
}

/** Where a boulder leaves the sling: its ground point and its height, in tiles from the footprint's top-left. */
export interface TrebuchetReleasePoint {
  /** Across the footprint, from its west edge. */
  readonly x: number;
  /** The ground row under the pouch, from the footprint's north edge. */
  readonly groundY: number;
  /** How far above that ground the pouch hangs. */
  readonly height: number;
}

/**
 * The sling's pouch for a given arm angle and sling phase, as the painter
 * draws it — exported so the boulder a throw releases leaves from the pouch
 * on screen, and the art and the shot cannot drift apart.
 */
export function trebuchetReleasePoint(armAngle: number, slingPhase: number): TrebuchetReleasePoint {
  const cx = TREBUCHET_FOOTPRINT_W / 2;
  const tipX = cx + Math.cos(armAngle) * LONG_ARM;
  const tipHeight = AXLE_HEIGHT + Math.sin(armAngle) * LONG_ARM;
  const pouch = pouchOffsetTiles(slingPhase, armAngle);
  // Screen y grows downward, so a pouch drawn below the tip hangs lower above the ground.
  return { x: tipX + pouch.x, groundY: AXLE_WORLD_Y, height: tipHeight - pouch.y };
}

function drawSling(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  ts: number,
  phase: number,
  armAngle: number,
): void {
  const offset = pouchOffsetTiles(phase, armAngle);
  const pouch = { x: tip.x + offset.x * ts, y: tip.y + offset.y * ts };
  ctx.strokeStyle = LOG.cutDark;
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.moveTo(tip.x - ts * 0.03, tip.y);
  ctx.lineTo(pouch.x, pouch.y);
  ctx.moveTo(tip.x + ts * 0.03, tip.y);
  ctx.lineTo(pouch.x, pouch.y);
  ctx.stroke();
  ctx.fillStyle = WOOD.light;
  ctx.beginPath();
  ctx.ellipse(pouch.x, pouch.y, POUCH_RADIUS * ts, POUCH_RADIUS * ts * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.stroke();
}

function drawBucket(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  ammoFraction: number,
): void {
  const rim = tp(BUCKET_X, BUCKET_Y);
  const rx = BUCKET_RX * ts;
  const ry = BUCKET_RY * ts;
  const depth = BUCKET_DEPTH * ts;
  drawContactShadow(ctx, rim.x, rim.y + depth, rx * 1.1, ry);
  // The body of the tub, then its dark mouth, then whatever stone is in it.
  ctx.fillStyle = STONE.dark;
  ctx.beginPath();
  ctx.ellipse(rim.x, rim.y + depth, rx * 0.9, ry, 0, 0, Math.PI);
  ctx.lineTo(rim.x - rx, rim.y);
  ctx.ellipse(rim.x, rim.y, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = STONE.deep;
  ctx.beginPath();
  ctx.ellipse(rim.x, rim.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.stroke();
  const shown = Math.round(Math.max(0, Math.min(1, ammoFraction)) * AMMO_STONES);
  for (let stone = 0; stone < shown; stone++) {
    const angle = stone * 2.4;
    const radius = (stone / AMMO_STONES) * 0.75;
    const sx = rim.x + Math.cos(angle) * rx * radius;
    const heap = ammoFraction > 0.7 ? ts * 0.05 * (1 - radius) : 0;
    const sy = rim.y + Math.sin(angle) * ry * radius - heap;
    ctx.fillStyle = stone % 3 === 0 ? STONE.light : STONE.body;
    ctx.beginPath();
    ctx.ellipse(sx, sy, ts * 0.06, ts * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, ts * 0.012);
    ctx.stroke();
  }
  ctx.strokeStyle = IRON.body;
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.beginPath();
  ctx.ellipse(rim.x, rim.y + depth * 0.55, rx * 0.95, ry, 0, 0, Math.PI);
  ctx.stroke();
}

/** A bristle of sharpened stakes along the base frame, angled outward. */
function drawSpikes(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  pass: 'back' | 'front',
): void {
  const stakes: Array<{ root: Point; tip: Point }> = [];
  const left = SILL_INSET;
  const right = TREBUCHET_FOOTPRINT_W - SILL_INSET;
  const outward = SPIKE_LENGTH;
  if (pass === 'back') {
    for (const tx of [0.45, 0.85, 1.15, 1.55]) {
      stakes.push({ root: tp(tx, SILL_TOP), tip: tp(tx, SILL_TOP - outward * 0.8) });
    }
    for (const ty of [0.8, 1.3, 1.8, 2.3]) {
      stakes.push({ root: tp(left, ty), tip: tp(left - outward * 0.9, ty - outward * 0.5) });
      stakes.push({ root: tp(right, ty), tip: tp(right + outward * 0.9, ty - outward * 0.5) });
    }
  } else {
    for (const tx of [0.4, 0.75, 1.25, 1.6]) {
      stakes.push({ root: tp(tx, SILL_BOTTOM - 0.05), tip: tp(tx, SILL_BOTTOM + outward * 0.55) });
    }
  }
  for (const { root, tip } of stakes) {
    const dx = tip.x - root.x;
    const dy = tip.y - root.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * ts * 0.04;
    const ny = (dx / length) * ts * 0.04;
    ctx.fillStyle = LOG.barkLight;
    ctx.beginPath();
    ctx.moveTo(root.x + nx, root.y + ny);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(root.x - nx, root.y - ny);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.stroke();
  }
}

/** The upper works clipped to how far they have risen from the ground. */
function drawRising(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  progress: number,
  paint: () => void,
): void {
  const bottom = y + TREBUCHET_FOOTPRINT_H * ts;
  const fullTop = y - TREBUCHET_REACH_UP_TILES * ts;
  const top = bottom - (bottom - fullTop) * progress;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, top, TREBUCHET_FOOTPRINT_W * ts, bottom - top);
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

/** Pale lashed poles and a ladder round the rising frame, tallest where the work is. */
function drawScaffold(
  ctx: CanvasRenderingContext2D,
  tp: (tx: number, ty: number) => Point,
  ts: number,
  progress: number,
): void {
  const height = AXLE_HEIGHT * Math.max(0.35, progress) + 0.2;
  const poles: Array<[number, number]> = [
    [0.12, 0.6],
    [1.88, 0.6],
    [0.12, 2.7],
    [1.88, 2.7],
  ];
  for (const [tx, ty] of poles) {
    beam(ctx, tp(tx, ty), tp(tx, ty - height), ts * 0.06, LOG.cut, ts);
  }
  for (const level of [0.4, 0.8]) {
    const z = height * level;
    beam(ctx, tp(0.12, 2.7 - z), tp(1.88, 2.7 - z), ts * 0.05, LOG.cutDark, ts);
    beam(ctx, tp(0.12, 0.6 - z), tp(1.88, 0.6 - z), ts * 0.05, LOG.cutDark, ts);
  }
  // A ladder leaning on the front.
  const foot = tp(1.35, 2.85);
  const top = tp(1.2, 2.85 - height * 0.9);
  for (const offset of [-0.1, 0.1]) {
    beam(
      ctx,
      { x: foot.x + offset * ts, y: foot.y },
      { x: top.x + offset * ts, y: top.y },
      ts * 0.035,
      LOG.cut,
      ts,
    );
  }
  const rungs = 5;
  ctx.strokeStyle = LOG.cutDark;
  ctx.lineWidth = Math.max(1, ts * 0.03);
  for (let rung = 1; rung < rungs; rung++) {
    const t = rung / rungs;
    const rx = foot.x + (top.x - foot.x) * t;
    const ry = foot.y + (top.y - foot.y) * t;
    ctx.beginPath();
    ctx.moveTo(rx - ts * 0.1, ry);
    ctx.lineTo(rx + ts * 0.1, ry);
    ctx.stroke();
  }
}
