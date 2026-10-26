/**
 * What worn gear looks like in the world: the relics floating at a crawler's
 * shoulder and what they throw, claw swipes and slash waves, and the marks a
 * trait leaves on its wearer while it runs.
 *
 * Every painter is a pure function of the state it is handed and a frame
 * counter, so a review render and the live game draw one image. Jitter is
 * hashed from a seed and a beat rather than rolled, which keeps an arc or a
 * bramble from strobing.
 *
 * Two rules hold for every picture here. They sit over a crowded fight, so
 * each is small, soft and brief: a glow is a cached disc (`drawGlow`), never a
 * blur, and nothing fills the screen. And none of them is light: they never
 * brighten, darken or reveal the scene around them, only mark the crawler or
 * the spot they belong to.
 */

import type { ClawTrail } from '../../core/items/equipment/weapons';
import type { RelicBehaviour } from '../../gear/traits';
import {
  drawEmbermote,
  drawGlow,
  drawGroundPool,
  hash01,
  hashRange,
  rgba,
  type Rgb,
} from '../status/statusPaint';

const TAU = Math.PI * 2;
const HALF = 0.5;

/** A point in whatever space the caller's context is set up in. */
export interface FxPoint {
  readonly x: number;
  readonly y: number;
}

// ── Palettes ─────────────────────────────────────────────────────────────────

const WHITE: Rgb = [255, 255, 255];
const SOOT: Rgb = [28, 14, 10];
const GROUND_SHADOW: Rgb = [0, 0, 0];

const FIRE_DEEP: Rgb = [190, 40, 14];
const FIRE_ORANGE: Rgb = [255, 140, 40];
const FIRE_GOLD: Rgb = [255, 214, 110];
const FIRE_CORE: Rgb = [255, 248, 220];

const STONE_DARK: Rgb = [62, 70, 82];
const STONE_MID: Rgb = [112, 122, 134];
const STONE_LIGHT: Rgb = [178, 188, 196];
const RUNE_LIT: Rgb = [150, 220, 255];
const RUNE_DIM: Rgb = [70, 86, 104];
const WARD_BLUE: Rgb = [90, 170, 255];
const WARD_PALE: Rgb = [205, 236, 255];

const SEED_DARK: Rgb = [84, 52, 28];
const SEED_MID: Rgb = [140, 92, 50];
const SEED_LIGHT: Rgb = [196, 146, 92];
const SHOOT: Rgb = [92, 170, 60];
const LEAF: Rgb = [128, 206, 84];
const LEAF_VEIN: Rgb = [196, 240, 150];
const SPROUT_GLOW: Rgb = [140, 230, 110];

const BRAMBLE_SOIL: Rgb = [34, 26, 16];
const BRAMBLE_RIM: Rgb = [70, 120, 46];
const BRAMBLE_STEM: Rgb = [108, 52, 48];
const BRAMBLE_STEM_LIGHT: Rgb = [168, 96, 80];
const BRAMBLE_THORN: Rgb = [236, 214, 170];

const GOLD: Rgb = [255, 210, 80];
const GOLD_PALE: Rgb = [255, 240, 180];
const MOON_SILVER: Rgb = [210, 222, 245];
const SAND: Rgb = [232, 186, 104];
const SAND_DEEP: Rgb = [176, 122, 50];
const BRASS: Rgb = [150, 104, 40];
const GLASS: Rgb = [235, 240, 250];
const HEAL_GREEN: Rgb = [120, 230, 140];
const HEAL_PALE: Rgb = [215, 255, 215];
const SMOKE: Rgb = [196, 188, 226];
const ARC_GLOW: Rgb = [80, 170, 255];
const ARC_CORE: Rgb = [220, 240, 255];
const AWAKEN: Rgb = [235, 210, 255];
const SHOCK: Rgb = [255, 236, 196];

/** A swipe's three layers: the soft rim that keeps it readable on any floor, the body, the hot core. */
interface TrailPalette {
  readonly rim: Rgb;
  /** How strongly the rim shows: a dark swipe leans on it to read on a dark floor. */
  readonly rimAlpha: number;
  readonly body: Rgb;
  readonly core: Rgb;
}

const TRAILS: Readonly<Record<ClawTrail, TrailPalette>> = {
  frost: { rim: [40, 110, 200], rimAlpha: 0.45, body: [150, 215, 255], core: [240, 250, 255] },
  venom: { rim: [30, 90, 20], rimAlpha: 0.45, body: [120, 220, 80], core: [220, 255, 190] },
  // Ink is black, so its rim is a pale violet: on a dark floor that rim is the swipe.
  ink: { rim: [190, 170, 235], rimAlpha: 0.85, body: [22, 16, 40], core: [90, 70, 130] },
  sunsteel: { rim: [220, 120, 20], rimAlpha: 0.45, body: [255, 210, 80], core: [255, 252, 225] },
};
/** A swipe or wave with no trail of its own: plain steel. */
const BARE_TRAIL: TrailPalette = {
  rim: [90, 100, 120],
  rimAlpha: 0.45,
  body: [225, 232, 240],
  core: WHITE,
};

// ── Shared helpers ──────────────────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOut(t: number): number {
  const inverse = 1 - clamp01(t);
  return 1 - inverse * inverse;
}

/** A four-pointed sparkle: the shape a reader takes for a glint at any size. */
function fillSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  waist: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + waist, y - waist);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - radius, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.closePath();
  ctx.fill();
}

/** A sparkle with a soft halo, in one colour with a white heart. */
function drawGlint(
  ctx: CanvasRenderingContext2D,
  colour: Rgb,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0 || radius <= 0) return;
  drawGlow(ctx, colour, x, y, radius * 1.8, alpha * 0.5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(colour, alpha);
  fillSparkle(ctx, x, y, radius, radius * 0.22);
  ctx.fillStyle = rgba(WHITE, alpha);
  fillSparkle(ctx, x, y, radius * 0.55, radius * 0.14);
}

// ── Relics ───────────────────────────────────────────────────────────────────

/** How a relic is drawn this frame. */
export interface RelicPose {
  readonly x: number;
  readonly y: number;
  /** Where the floor is under it, for its shadow. */
  readonly groundY: number;
  readonly frame: number;
  /** Ready to act: lit. Recharging: dimmed and smaller. */
  readonly ready: boolean;
}

/** A recharging relic keeps this share of its glow, so it is still plainly there. */
const RECHARGING_GLOW = 0.35;
/** A recharging relic shrinks a touch, so ready and recharging differ by shape as well as light. */
const RECHARGING_SCALE = 0.85;
const RELIC_SHADOW_RX = 3.2;
const RELIC_SHADOW_RY = 1.3;
const RELIC_SHADOW_ALPHA = 0.28;

/** Paints the relic a crawler wears, at its pose. */
export function drawRelic(
  ctx: CanvasRenderingContext2D,
  behaviour: RelicBehaviour,
  pose: RelicPose,
): void {
  ctx.save();
  drawGroundPool(
    ctx,
    GROUND_SHADOW,
    pose.x,
    pose.groundY,
    RELIC_SHADOW_RX,
    RELIC_SHADOW_RY,
    RELIC_SHADOW_ALPHA,
  );
  switch (behaviour) {
    case 'bolt':
      drawEmberWisp(ctx, pose);
      break;
    case 'ward':
      drawWardStone(ctx, pose);
      break;
    case 'bramble':
      drawSproutlingSeed(ctx, pose);
      break;
  }
  ctx.restore();
}

/** A teardrop flame: a round belly at (`x`, `y`) drawn up to a tip `height` above, leaning by `lean`. */
function traceFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  height: number,
  lean: number,
): void {
  const tipX = x + lean;
  const tipY = y - height;
  const shoulderY = y - height * 0.4;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.quadraticCurveTo(x + halfWidth * 1.15 + lean * 0.3, shoulderY, x + halfWidth, y);
  ctx.arc(x, y, halfWidth, 0, Math.PI);
  ctx.quadraticCurveTo(x - halfWidth * 1.15 + lean * 0.3, shoulderY, tipX, tipY);
  ctx.closePath();
  ctx.fill();
}

const WISP_HALF_WIDTH = 2.9;
const WISP_HEIGHT = 7.5;
const WISP_GLOW_RADIUS = 9;
/** It blinks for this many frames out of every blink period. */
const WISP_BLINK_PERIOD = 170;
const WISP_BLINK_FRAMES = 6;
const WISP_SPARKS = 2;
const WISP_SPARK_PERIOD = 34;
const WISP_SPARK_RISE = 7;

function drawEmberWisp(ctx: CanvasRenderingContext2D, pose: RelicPose): void {
  const { x, frame } = pose;
  const scale = pose.ready ? 1 : RECHARGING_SCALE;
  const glow = pose.ready ? 1 : RECHARGING_GLOW;
  // The belly sits below the pose point so the whole flame centres on it.
  const y = pose.y + WISP_HALF_WIDTH * 0.6;
  const flicker = Math.sin(frame * 0.23) * 0.7 + Math.sin(frame * 0.41) * 0.4;
  const lean = flicker * 0.9;
  const height = (WISP_HEIGHT + Math.sin(frame * 0.31) * 0.8) * scale;
  const halfWidth = WISP_HALF_WIDTH * scale;

  drawEmbermote(ctx, FIRE_ORANGE, FIRE_GOLD, x, y - halfWidth, WISP_GLOW_RADIUS, 0.55 * glow);

  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(FIRE_DEEP, 1);
  traceFlame(ctx, x, y, halfWidth, height, lean);
  ctx.fillStyle = rgba(FIRE_ORANGE, 1);
  traceFlame(ctx, x, y + 0.3, halfWidth * 0.74, height * 0.74, lean * 0.7);
  ctx.fillStyle = rgba(FIRE_GOLD, pose.ready ? 1 : 0.75);
  traceFlame(ctx, x, y + 0.5, halfWidth * 0.46, height * 0.46, lean * 0.4);

  // A face, because the description says it likes you.
  const blinking = frame % WISP_BLINK_PERIOD < WISP_BLINK_FRAMES;
  const eyeHeight = blinking ? 0.4 : 1.3;
  ctx.fillStyle = rgba(SOOT, 0.9);
  for (const side of [-1, 1]) {
    ctx.fillRect(x + side * 1.1 - 0.45 + lean * 0.15, y - 1.2 - eyeHeight / 2, 0.9, eyeHeight);
  }

  for (let spark = 0; spark < WISP_SPARKS; spark++) {
    const phase =
      ((frame + spark * (WISP_SPARK_PERIOD / WISP_SPARKS)) % WISP_SPARK_PERIOD) / WISP_SPARK_PERIOD;
    const sway = Math.sin((phase + spark) * TAU) * 1.5;
    const sparkY = y - height - phase * WISP_SPARK_RISE;
    drawEmbermote(ctx, FIRE_ORANGE, FIRE_CORE, x + lean + sway, sparkY, 1.6, (1 - phase) * glow);
  }
}

const STONE_RX = 4.4;
const STONE_RY = 3.5;
const STONE_GLOW_RADIUS = 9;
const STONE_RUNES = 6;
/** How fast it turns about its upright axis, in radians a frame. */
const STONE_TURN_PER_FRAME = 0.022;
const STONE_TILT = 0.12;

/** One small carved mark, `w` across and `h` tall, picked by `index`. */
function strokeRune(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x, y + h / 2);
  const variant = index % 3;
  if (variant === 0) {
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x + w, y - h / 6);
  } else if (variant === 1) {
    ctx.moveTo(x - w, y - h / 4);
    ctx.lineTo(x + w, y + h / 4);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y - h / 3);
    ctx.moveTo(x, y);
    ctx.lineTo(x - w, y - h / 3);
  }
  ctx.stroke();
}

function drawWardStone(ctx: CanvasRenderingContext2D, pose: RelicPose): void {
  const { x, y, frame } = pose;
  const scale = pose.ready ? 1 : RECHARGING_SCALE;
  const rx = STONE_RX * scale;
  const ry = STONE_RY * scale;
  const tilt = Math.sin(frame * 0.017) * STONE_TILT;

  if (pose.ready) drawGlow(ctx, WARD_BLUE, x, y, STONE_GLOW_RADIUS, 0.22);

  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(STONE_DARK, 1);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, tilt, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(STONE_MID, 1);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.12, y - ry * 0.14, rx * 0.84, ry * 0.8, tilt, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(STONE_LIGHT, 0.85);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.4, y - ry * 0.45, rx * 0.32, ry * 0.2, tilt - 0.3, 0, TAU);
  ctx.fill();

  // The ring of marks runs round its middle; only the near half shows, foreshortened
  // toward the edges, which is what makes the stone read as turning rather than sliding.
  const spin = frame * STONE_TURN_PER_FRAME;
  const runeColour = pose.ready ? RUNE_LIT : RUNE_DIM;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let rune = 0; rune < STONE_RUNES; rune++) {
    const around = spin + (rune / STONE_RUNES) * TAU;
    const facing = Math.cos(around);
    if (facing <= 0.15) continue;
    const runeX = x + Math.sin(around) * rx * 0.72;
    const runeY = y + Math.sin(around) * rx * 0.72 * Math.sin(tilt) + ry * 0.05;
    ctx.strokeStyle = rgba(runeColour, facing);
    strokeRune(ctx, runeX, runeY, 0.9 * facing, ry * 0.9, rune);
  }
}

const SEED_RX = 3.1;
const SEED_RY = 3.7;
const SHOOT_HEIGHT = 5.5;
const SEED_GLOW_RADIUS = 8;
const LEAF_LENGTH = 2.4;
const LEAF_WIDTH = 1.1;

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
): void {
  const length = LEAF_LENGTH * scale;
  const cx = x + Math.cos(angle) * length * HALF;
  const cy = y + Math.sin(angle) * length * HALF;
  ctx.fillStyle = rgba(LEAF, 1);
  ctx.beginPath();
  ctx.ellipse(cx, cy, length * HALF, LEAF_WIDTH * scale * HALF, angle, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(LEAF_VEIN, 0.8);
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * length * 0.8, y + Math.sin(angle) * length * 0.8);
  ctx.stroke();
}

function drawSproutlingSeed(ctx: CanvasRenderingContext2D, pose: RelicPose): void {
  const { x, frame } = pose;
  const scale = pose.ready ? 1 : RECHARGING_SCALE;
  const rx = SEED_RX * scale;
  const ry = SEED_RY * scale;
  // The pod sits a little low so pod and shoot together centre on the pose point.
  const y = pose.y + ry * 0.35;
  const rock = Math.sin(frame * 0.05) * 0.1;

  if (pose.ready) drawGlow(ctx, SPROUT_GLOW, x, y - ry, SEED_GLOW_RADIUS, 0.35);

  // The shoot first, so the pod's shoulder overlaps its root.
  const sway = Math.sin(frame * 0.06) * 1.2;
  const topX = x + rock * ry;
  const topY = y - ry * 0.8;
  const tipX = topX + sway + 1;
  const tipY = topY - SHOOT_HEIGHT * scale;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(SHOOT, 1);
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(topX, topY + 1);
  ctx.quadraticCurveTo(topX - 1.4, topY - SHOOT_HEIGHT * scale * 0.55, tipX, tipY);
  ctx.stroke();
  drawLeaf(ctx, tipX, tipY, -Math.PI * 0.15 + sway * 0.08, scale);
  drawLeaf(ctx, tipX, tipY + 0.5, -Math.PI * 0.85 + sway * 0.08, scale * 0.85);

  ctx.fillStyle = rgba(SEED_DARK, 1);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rock, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(SEED_MID, 1);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.12, y - ry * 0.1, rx * 0.8, ry * 0.82, rock, 0, TAU);
  ctx.fill();
  // The walnut's seam and its ridges are what tell a seed from a pebble.
  ctx.strokeStyle = rgba(SEED_DARK, 0.9);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(topX, y - ry * 0.85);
  ctx.quadraticCurveTo(x + rx * 0.25, y, x + rock * -ry, y + ry * 0.95);
  ctx.moveTo(x - rx * 0.55, y - ry * 0.45);
  ctx.quadraticCurveTo(x - rx * 0.75, y + ry * 0.1, x - rx * 0.4, y + ry * 0.6);
  ctx.stroke();
  ctx.fillStyle = rgba(SEED_LIGHT, 0.8);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.45, y - ry * 0.4, rx * 0.22, ry * 0.25, rock, 0, TAU);
  ctx.fill();
}

// ── What relics throw ────────────────────────────────────────────────────────

const BOLT_HEAD_RADIUS = 5.5;
const BOLT_TAIL_MOTES = 4;
const BOLT_TAIL_GAP = 2.6;

/** The ember wisp's bolt: a hot head trailing embers back along its flight. */
export function drawRelicBolt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  frame: number,
): void {
  ctx.save();
  for (let mote = BOLT_TAIL_MOTES; mote >= 1; mote--) {
    const back = mote * BOLT_TAIL_GAP;
    const wobble = Math.sin(frame * 0.5 + mote * 1.7) * 0.8;
    const tailX = x - dirX * back - dirY * wobble;
    const tailY = y - dirY * back + dirX * wobble;
    const fade = 1 - mote / (BOLT_TAIL_MOTES + 1);
    drawEmbermote(ctx, FIRE_DEEP, FIRE_ORANGE, tailX, tailY, 2.4 + fade * 1.6, fade * 0.8);
  }
  const pulse = 1 + Math.sin(frame * 0.6) * 0.12;
  drawEmbermote(ctx, FIRE_ORANGE, FIRE_GOLD, x, y, BOLT_HEAD_RADIUS * pulse, 0.9);
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(FIRE_CORE, 1);
  ctx.beginPath();
  ctx.arc(x, y, 1.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

const SHARDS = 7;
const SHARD_REACH = 17;
const SHARD_SIZE = 3.4;
/** Shards drop this far as they fly, so the burst reads as glass rather than light. */
const SHARD_FALL = 4;
const SHATTER_FLASH_RADIUS = 10;

/** The ward stone's ward breaking on a blow: a blue flash and a spray of glassy shards. */
export function drawWardShatter(
  ctx: CanvasRenderingContext2D,
  at: FxPoint,
  progress: number,
): void {
  const left = 1 - progress;
  ctx.save();
  drawGlow(ctx, WARD_PALE, at.x, at.y, SHATTER_FLASH_RADIUS * (0.6 + progress), left * left);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(WARD_BLUE, left * 0.9);
  ctx.lineWidth = 1.4 * left + 0.3;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 3 + easeOut(progress) * SHARD_REACH * 0.8, 0, TAU);
  ctx.stroke();
  const reach = easeOut(Math.sqrt(progress)) * SHARD_REACH;
  for (let shard = 0; shard < SHARDS; shard++) {
    const angle = (shard / SHARDS) * TAU + hashRange(shard * 13 + 1, -0.3, 0.3);
    const distance = reach * hashRange(shard * 13 + 2, 0.7, 1.1);
    const sx = at.x + Math.cos(angle) * distance;
    const sy = at.y + Math.sin(angle) * distance + progress * progress * SHARD_FALL;
    const spin = angle + progress * hashRange(shard * 13 + 3, -6, 6);
    const size = SHARD_SIZE * (1 - progress * HALF);
    ctx.fillStyle = rgba(WARD_PALE, left);
    ctx.strokeStyle = rgba(STONE_DARK, left);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(spin) * size, sy + Math.sin(spin) * size);
    ctx.lineTo(sx + Math.cos(spin + 2.3) * size * 0.6, sy + Math.sin(spin + 2.3) * size * 0.6);
    ctx.lineTo(sx + Math.cos(spin + 3.9) * size * 0.7, sy + Math.sin(spin + 3.9) * size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

const BUCKLER_SPARKS = 5;
/** The sparks fan back toward the shot within this much of a half turn either side. */
const BUCKLER_SPARK_FAN = 0.9;
const BUCKLER_SPARK_REACH = 9;
/** Each spark flies between these shares of the reach, so the fan has a ragged edge. */
const BUCKLER_SPARK_NEAR_SHARE = 0.6;
const BUCKLER_SPARK_FAR_SHARE = 1.1;
const BUCKLER_SPARK_LENGTH = 2.6;
const BUCKLER_SPARK_WIDTH = 0.9;
/** Sparks dip as they fly, so they read as struck metal rather than light. */
const BUCKLER_SPARK_FALL = 3;
const BUCKLER_FLASH_RADIUS = 6;
const BUCKLER_GLINT_RADIUS = 4;
/** The clang's arc: a short bright crescent on the side the shot struck, this wide. */
const BUCKLER_CLANG_RADIUS = 4.5;
const BUCKLER_CLANG_SPREAD = 1.1;
const BUCKLER_CLANG_WIDTH = 1.3;
const BUCKLER_SPARK_SEED = 29;

/**
 * A shot glancing off a buckler: a hard white glint where it struck, a
 * bright crescent of steel on that side and a fan of sparks thrown back the
 * way the shot came. `toward` is the unit direction to the shooter.
 */
export function drawBucklerBlock(
  ctx: CanvasRenderingContext2D,
  at: FxPoint,
  toward: FxPoint,
  progress: number,
): void {
  const left = 1 - progress;
  const facing = Math.atan2(toward.y, toward.x);
  ctx.save();
  drawGlow(ctx, GOLD_PALE, at.x, at.y, BUCKLER_FLASH_RADIUS * (1 + progress), left * left);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(WHITE, left);
  ctx.lineWidth = BUCKLER_CLANG_WIDTH * left + BUCKLER_SPARK_WIDTH * HALF;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(
    at.x,
    at.y,
    BUCKLER_CLANG_RADIUS + progress * BUCKLER_CLANG_RADIUS,
    facing - BUCKLER_CLANG_SPREAD * HALF,
    facing + BUCKLER_CLANG_SPREAD * HALF,
  );
  ctx.stroke();
  const reach = easeOut(Math.sqrt(progress)) * BUCKLER_SPARK_REACH;
  ctx.lineWidth = BUCKLER_SPARK_WIDTH;
  for (let spark = 0; spark < BUCKLER_SPARKS; spark++) {
    const angleSeed = spark * BUCKLER_SPARK_SEED;
    const distanceSeed = angleSeed + 1;
    const angle = facing + hashRange(angleSeed, -BUCKLER_SPARK_FAN, BUCKLER_SPARK_FAN);
    const distance =
      reach * hashRange(distanceSeed, BUCKLER_SPARK_NEAR_SHARE, BUCKLER_SPARK_FAR_SHARE);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const headX = at.x + dirX * distance;
    const headY = at.y + dirY * distance + progress * progress * BUCKLER_SPARK_FALL;
    ctx.strokeStyle = rgba(GOLD, left);
    ctx.beginPath();
    ctx.moveTo(headX - dirX * BUCKLER_SPARK_LENGTH, headY - dirY * BUCKLER_SPARK_LENGTH);
    ctx.lineTo(headX, headY);
    ctx.stroke();
  }
  drawGlint(ctx, GOLD_PALE, at.x, at.y, BUCKLER_GLINT_RADIUS * left, left);
  ctx.restore();
}

/** How a bramble patch is drawn this frame. */
export interface BramblePose {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** The patch lies on the floor, so it is squashed to this share of its width. */
  readonly groundDepth: number;
  readonly ageFrames: number;
  readonly framesLeft: number;
  readonly frame: number;
}

const BRAMBLE_CANES = 12;
const BRAMBLE_GROW_FRAMES = 14;
const BRAMBLE_FADE_FRAMES = 20;
const BRAMBLE_CANE_MIN_HEIGHT = 6;
const BRAMBLE_CANE_MAX_HEIGHT = 11;
/** How far a cane reaches across before it arches back into the floor. */
const BRAMBLE_CANE_MIN_SPAN = 9;
const BRAMBLE_CANE_MAX_SPAN = 15;
const BRAMBLE_THORN_LENGTH = 2.2;
const BRAMBLE_THORNS_PER_CANE = 4;
/** Half the width of a thorn where it meets the cane. */
const BRAMBLE_THORN_BASE = 0.8;
/** The hash seed is the spot it was planted, so each patch grows its own way and keeps it. */
const BRAMBLE_SEED_STRIDE = 0.731;

interface CubicCurve {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x3: number;
  readonly y3: number;
}

function cubicAt(c: CubicCurve, t: number): { x: number; y: number; tx: number; ty: number } {
  const u = 1 - t;
  return {
    x: u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3,
    y: u * u * u * c.y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y3,
    tx: 3 * u * u * (c.x1 - c.x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (c.x3 - c.x2),
    ty: 3 * u * u * (c.y1 - c.y0) + 6 * u * t * (c.y2 - c.y1) + 3 * t * t * (c.y3 - c.y2),
  };
}

function strokeCubic(ctx: CanvasRenderingContext2D, c: CubicCurve): void {
  ctx.beginPath();
  ctx.moveTo(c.x0, c.y0);
  ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x3, c.y3);
  ctx.stroke();
}

/**
 * The sproutling seed's bramble: a thicket of thorny canes bursting up out of
 * the floor and arching back into it, the way a briar grows. The patch's rim
 * is drawn faintly so its reach, which is what roots a mob, can be read.
 */
export function drawBramble(ctx: CanvasRenderingContext2D, pose: BramblePose): void {
  const grow = easeOut(pose.ageFrames / BRAMBLE_GROW_FRAMES);
  const fade = clamp01(pose.framesLeft / BRAMBLE_FADE_FRAMES);
  if (fade <= 0) return;
  const rx = pose.radiusPx;
  const ry = pose.radiusPx * pose.groundDepth;
  const seed = Math.floor(pose.x) * BRAMBLE_SEED_STRIDE + Math.floor(pose.y);
  ctx.save();
  drawGroundPool(ctx, BRAMBLE_SOIL, pose.x, pose.y, rx * grow, ry * grow, 0.35 * fade);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(BRAMBLE_RIM, 0.5 * fade);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(pose.x, pose.y, rx * grow, ry * grow, 0, 0, TAU);
  ctx.stroke();

  const canes: Array<{ curve: CubicCurve; index: number; footY: number }> = [];
  for (let cane = 0; cane < BRAMBLE_CANES; cane++) {
    const key = seed + cane * 11.3;
    const angle = hash01(key) * TAU;
    const distance = Math.sqrt(hash01(key + 1)) * 0.8;
    const baseX = pose.x + Math.cos(angle) * rx * distance;
    const baseY = pose.y + Math.sin(angle) * ry * distance;
    // Each cane's growth lags a little behind the last, so they burst rather than rise as one.
    const rise = easeOut((pose.ageFrames - cane * HALF) / BRAMBLE_GROW_FRAMES);
    if (rise <= 0) continue;
    const height = hashRange(key + 2, BRAMBLE_CANE_MIN_HEIGHT, BRAMBLE_CANE_MAX_HEIGHT) * rise;
    const span = hashRange(key + 3, BRAMBLE_CANE_MIN_SPAN, BRAMBLE_CANE_MAX_SPAN) * rise;
    const heading = hash01(key + 4) * TAU;
    const sway = Math.sin(pose.frame * 0.05 + cane) * 0.5;
    const endX = baseX + Math.cos(heading) * span;
    const endY = baseY + Math.sin(heading) * span * pose.groundDepth;
    canes.push({
      curve: {
        x0: baseX,
        y0: baseY,
        // Up off the floor first, then over and down: the arch is what says briar.
        x1: baseX + (endX - baseX) * 0.1 + sway,
        y1: baseY - height * 1.4,
        x2: baseX + (endX - baseX) * 0.8 + sway,
        y2: endY - height * 1.2,
        x3: endX,
        y3: endY,
      },
      index: cane,
      footY: Math.max(baseY, endY),
    });
  }
  // Far canes first, so near ones cross in front of them.
  canes.sort((a, b) => a.footY - b.footY);
  ctx.lineCap = 'round';
  for (const { curve, index } of canes) {
    ctx.strokeStyle = rgba(SOOT, 0.8 * fade);
    ctx.lineWidth = 3;
    strokeCubic(ctx, curve);
    ctx.strokeStyle = rgba(BRAMBLE_STEM, fade);
    ctx.lineWidth = 1.9;
    strokeCubic(ctx, curve);
    ctx.strokeStyle = rgba(BRAMBLE_STEM_LIGHT, fade * 0.85);
    ctx.lineWidth = 0.6;
    strokeCubic(ctx, curve);

    ctx.fillStyle = rgba(BRAMBLE_THORN, fade);
    ctx.beginPath();
    for (let thorn = 1; thorn <= BRAMBLE_THORNS_PER_CANE; thorn++) {
      const at = cubicAt(curve, thorn / (BRAMBLE_THORNS_PER_CANE + 1));
      const tLength = Math.hypot(at.tx, at.ty);
      if (tLength === 0) continue;
      const side = thorn % 2 === 0 ? 1 : -1;
      // A thorn points out and back down the cane, the way a briar's hooks do.
      const outX = (-at.ty / tLength) * side - (at.tx / tLength) * HALF;
      const outY = (at.tx / tLength) * side - (at.ty / tLength) * HALF;
      // A thorn is a wedge, broad at the cane: a line that thin vanishes at in-game size.
      const alongX = (at.tx / tLength) * BRAMBLE_THORN_BASE;
      const alongY = (at.ty / tLength) * BRAMBLE_THORN_BASE;
      ctx.moveTo(at.x - alongX, at.y - alongY);
      ctx.lineTo(at.x + outX * BRAMBLE_THORN_LENGTH, at.y + outY * BRAMBLE_THORN_LENGTH);
      ctx.lineTo(at.x + alongX, at.y + alongY);
      ctx.closePath();
    }
    ctx.fill();
    if (index % 3 === 0) {
      const top = cubicAt(curve, HALF);
      ctx.globalAlpha = fade;
      drawLeaf(ctx, top.x, top.y, -Math.PI * (0.25 + hash01(seed + index) * HALF), 1);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// ── Claws ────────────────────────────────────────────────────────────────────

const CRESCENT_SAMPLES = 12;

/**
 * A tapered crescent along an arc: fat in the middle, sharp at both ends,
 * which is what tells a claw mark from a drawn line.
 */
function fillCrescent(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  halfWidth: number,
): void {
  ctx.beginPath();
  for (let sample = 0; sample <= CRESCENT_SAMPLES; sample++) {
    const t = sample / CRESCENT_SAMPLES;
    const angle = from + (to - from) * t;
    const r = radius + Math.sin(t * Math.PI) * halfWidth;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (sample === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let sample = CRESCENT_SAMPLES; sample >= 0; sample--) {
    const t = sample / CRESCENT_SAMPLES;
    const angle = from + (to - from) * t;
    const r = radius - Math.sin(t * Math.PI) * halfWidth;
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function fillLayeredCrescent(
  ctx: CanvasRenderingContext2D,
  colours: TrailPalette,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  halfWidth: number,
  alpha: number,
): void {
  ctx.fillStyle = rgba(colours.rim, alpha * colours.rimAlpha);
  fillCrescent(ctx, cx, cy, radius, from, to, halfWidth * 1.7);
  ctx.fillStyle = rgba(colours.body, alpha);
  fillCrescent(ctx, cx, cy, radius, from, to, halfWidth);
  ctx.fillStyle = rgba(colours.core, alpha * 0.9);
  fillCrescent(ctx, cx, cy, radius, from, to, halfWidth * 0.38);
}

/** A claw swipe to draw. */
export interface ClawSwipe {
  readonly trail: ClawTrail;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly reachPx: number;
}

const SWIPE_SPAN = TAU * 0.36;
const SWIPE_STRANDS = 3;
const SWIPE_STRAND_GAP = 3.2;
const SWIPE_HALF_WIDTH = 1.5;
/** The share of its life the swipe spends sweeping across; the rest it fades. */
const SWIPE_SWEEP_SHARE = 0.4;
const SWIPE_FLOURISHES = 4;

/** Three raked claw marks across her facing, in the trail's colours with its flourish. */
export function drawClawSwipe(
  ctx: CanvasRenderingContext2D,
  swipe: ClawSwipe,
  progress: number,
): void {
  const colours = TRAILS[swipe.trail];
  const facing = Math.atan2(swipe.dirY, swipe.dirX);
  const sweep = easeOut(progress / SWIPE_SWEEP_SHARE);
  const alpha =
    progress < SWIPE_SWEEP_SHARE ? 1 : 1 - (progress - SWIPE_SWEEP_SHARE) / (1 - SWIPE_SWEEP_SHARE);
  if (alpha <= 0) return;
  const from = facing - SWIPE_SPAN / 2;
  const to = from + SWIPE_SPAN * sweep;
  ctx.save();
  for (let strand = 0; strand < SWIPE_STRANDS; strand++) {
    const radius = swipe.reachPx - strand * SWIPE_STRAND_GAP;
    if (radius <= 0) continue;
    // The middle claw is the longest, as on a paw.
    const width = strand === 1 ? SWIPE_HALF_WIDTH * 1.15 : SWIPE_HALF_WIDTH;
    fillLayeredCrescent(ctx, colours, swipe.x, swipe.y, radius, from, to, width, alpha);
  }
  if (progress > SWIPE_SWEEP_SHARE * HALF) {
    drawSwipeFlourish(ctx, swipe, from, to, progress, alpha);
  }
  ctx.restore();
}

function drawSwipeFlourish(
  ctx: CanvasRenderingContext2D,
  swipe: ClawSwipe,
  from: number,
  to: number,
  progress: number,
  alpha: number,
): void {
  const colours = TRAILS[swipe.trail];
  for (let bit = 0; bit < SWIPE_FLOURISHES; bit++) {
    const along = hashRange(bit * 7 + 1, 0.15, 0.95);
    const angle = from + (to - from) * along;
    const radius = swipe.reachPx + hashRange(bit * 7 + 2, -2, 3);
    const px = swipe.x + Math.cos(angle) * radius;
    const py = swipe.y + Math.sin(angle) * radius;
    switch (swipe.trail) {
      case 'frost':
        drawGlint(ctx, colours.core, px, py, 1.8, alpha);
        break;
      case 'venom': {
        const drop = progress * 5;
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(colours.body, alpha);
        ctx.beginPath();
        ctx.ellipse(px, py + drop, 0.8, 1.2, 0, 0, TAU);
        ctx.fill();
        break;
      }
      case 'ink': {
        const flung = progress * 4;
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(colours.rim, alpha * 0.5);
        ctx.beginPath();
        ctx.arc(px + Math.cos(angle) * flung, py + Math.sin(angle) * flung, 1.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(colours.body, alpha);
        ctx.beginPath();
        ctx.arc(px + Math.cos(angle) * flung, py + Math.sin(angle) * flung, 1, 0, TAU);
        ctx.fill();
        break;
      }
      case 'sunsteel':
        drawEmbermote(ctx, colours.rim, colours.core, px, py, 3, alpha * 0.7);
        if (bit % 2 === 0) drawGlint(ctx, colours.body, px, py, 2.2, alpha);
        break;
    }
  }
}

/** A slash wave to draw. */
export interface SlashWavePose {
  readonly trail: ClawTrail | null;
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
  /** How much of its range it has travelled, 0 to 1. */
  readonly travelled: number;
  readonly frame: number;
}

const WAVE_RADIUS = 18;
const WAVE_SPAN = TAU * 0.3;
const WAVE_HALF_WIDTH = 4;
const WAVE_ECHOES = 2;
const WAVE_ECHO_GAP = 5;

/** The sunsteel talons' slash wave: a flying crescent with fading echoes behind it. */
export function drawSlashWave(ctx: CanvasRenderingContext2D, wave: SlashWavePose): void {
  const colours = wave.trail === null ? BARE_TRAIL : TRAILS[wave.trail];
  const facing = Math.atan2(wave.dirY, wave.dirX);
  const alpha = clamp01(1 - wave.travelled * wave.travelled * wave.travelled);
  if (alpha <= 0) return;
  // The crescent bows forward: its centre of curvature sits behind the wave's point.
  const cx = wave.x - wave.dirX * WAVE_RADIUS * HALF;
  const cy = wave.y - wave.dirY * WAVE_RADIUS * HALF;
  ctx.save();
  for (let echo = WAVE_ECHOES; echo >= 1; echo--) {
    const back = echo * WAVE_ECHO_GAP;
    fillLayeredCrescent(
      ctx,
      colours,
      cx - wave.dirX * back,
      cy - wave.dirY * back,
      WAVE_RADIUS,
      facing - WAVE_SPAN / 2,
      facing + WAVE_SPAN / 2,
      WAVE_HALF_WIDTH * (1 - echo * 0.25),
      alpha * (0.45 - echo * 0.12),
    );
  }
  if (wave.trail === 'sunsteel') {
    drawEmbermote(ctx, colours.rim, colours.core, wave.x, wave.y, 9, alpha * 0.45);
  }
  fillLayeredCrescent(
    ctx,
    colours,
    cx,
    cy,
    WAVE_RADIUS,
    facing - WAVE_SPAN / 2,
    facing + WAVE_SPAN / 2,
    WAVE_HALF_WIDTH,
    alpha,
  );
  ctx.restore();
}

// ── Marks on the wearer ──────────────────────────────────────────────────────

const TETHER_SAG = 5;
const TETHER_ALPHA = 0.3;
const TETHER_BEADS = 2;
const TETHER_BEAD_FRAMES = 150;

/** The locket pair's link: a faint sagging thread, sun-gold at his end and moon-silver at hers. */
export function drawPartnerTether(
  ctx: CanvasRenderingContext2D,
  sunEnd: FxPoint,
  moonEnd: FxPoint,
  frame: number,
): void {
  const midX = (sunEnd.x + moonEnd.x) / 2;
  const midY = (sunEnd.y + moonEnd.y) / 2 + TETHER_SAG;
  ctx.save();
  const thread = ctx.createLinearGradient(sunEnd.x, sunEnd.y, moonEnd.x, moonEnd.y);
  thread.addColorStop(0, rgba(GOLD, TETHER_ALPHA));
  thread.addColorStop(1, rgba(MOON_SILVER, TETHER_ALPHA));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = thread;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sunEnd.x, sunEnd.y);
  ctx.quadraticCurveTo(midX, midY, moonEnd.x, moonEnd.y);
  ctx.stroke();
  for (let bead = 0; bead < TETHER_BEADS; bead++) {
    const raw = (frame / TETHER_BEAD_FRAMES + bead / TETHER_BEADS) % 1;
    // One bead runs each way, so the link reads as shared rather than flowing to one of them.
    const t = bead % 2 === 0 ? raw : 1 - raw;
    const inverse = 1 - t;
    const bx = inverse * inverse * sunEnd.x + 2 * inverse * t * midX + t * t * moonEnd.x;
    const by = inverse * inverse * sunEnd.y + 2 * inverse * t * midY + t * t * moonEnd.y;
    const edgeFade = Math.sin(t * Math.PI);
    drawGlow(ctx, bead % 2 === 0 ? GOLD_PALE : MOON_SILVER, bx, by, 3, 0.45 * edgeFade);
  }
  ctx.restore();
}

const HALO_RX = 6.5;
const HALO_RY = 2.2;
const HALO_RISE = 6;
/** The ring opens already wider than her, so it never closes round her like a bowl. */
const NINTH_LIFE_RING_START = 14;
const NINTH_LIFE_RING_REACH = 24;
const NINTH_LIFE_SPARKLES = 6;

/**
 * The ninth life caught a downing blow: a gold halo flares over her head and
 * lifts away while a ring of gold breaks outward from her.
 */
export function drawNinthLife(
  ctx: CanvasRenderingContext2D,
  body: FxPoint,
  headY: number,
  progress: number,
): void {
  const left = 1 - progress;
  const flare = progress < 0.15 ? progress / 0.15 : left / 0.85;
  ctx.save();
  drawGlow(ctx, GOLD, body.x, body.y, 14 + progress * 8, flare * 0.2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(GOLD, left * 0.6);
  ctx.lineWidth = 0.8 * left + 0.4;
  ctx.beginPath();
  ctx.ellipse(
    body.x,
    body.y,
    NINTH_LIFE_RING_START + easeOut(progress) * NINTH_LIFE_RING_REACH,
    (NINTH_LIFE_RING_START + easeOut(progress) * NINTH_LIFE_RING_REACH) * HALF,
    0,
    0,
    TAU,
  );
  ctx.stroke();

  const haloY = headY - 3 - easeOut(progress) * HALO_RISE;
  drawGlow(ctx, GOLD_PALE, body.x, haloY, HALO_RX * 1.6, flare * 0.6);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(GOLD, flare);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(body.x, haloY, HALO_RX, HALO_RY, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(GOLD_PALE, flare);
  ctx.lineWidth = 0.6;
  ctx.stroke();

  for (let sparkle = 0; sparkle < NINTH_LIFE_SPARKLES; sparkle++) {
    const angle = (sparkle / NINTH_LIFE_SPARKLES) * TAU + 0.4;
    const reach = 6 + easeOut(progress) * 10;
    const sx = body.x + Math.cos(angle) * reach;
    const sy = body.y + Math.sin(angle) * reach * HALF - progress * 10;
    drawGlint(ctx, GOLD, sx, sy, 2.2 * left, left);
  }
  ctx.restore();
}

const AWAKEN_RAYS = 10;
const AWAKEN_REACH = 30;

/** A piece of gear awakened: violet-white rays burst from her and a ring rolls out. */
export function drawAwakening(
  ctx: CanvasRenderingContext2D,
  body: FxPoint,
  progress: number,
): void {
  const left = 1 - progress;
  const reach = easeOut(progress) * AWAKEN_REACH;
  ctx.save();
  drawGlow(ctx, AWAKEN, body.x, body.y, 16, left * 0.45);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  for (let ray = 0; ray < AWAKEN_RAYS; ray++) {
    const angle = (ray / AWAKEN_RAYS) * TAU + progress * 0.6;
    const inner = 4 + reach * 0.3;
    const outer = 6 + reach * (ray % 2 === 0 ? 0.75 : 0.5);
    ctx.strokeStyle = rgba(AWAKEN, left * 0.8);
    ctx.lineWidth = 1.2 * left + 0.3;
    ctx.beginPath();
    ctx.moveTo(body.x + Math.cos(angle) * inner, body.y + Math.sin(angle) * inner);
    ctx.lineTo(body.x + Math.cos(angle) * outer, body.y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(AWAKEN, left);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, reach, reach * HALF, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

const SHOCK_DEPTH = 0.55;

/** A nova rolling out across the floor: a flattened ring with a soft wake inside it. */
export function drawShockwave(
  ctx: CanvasRenderingContext2D,
  at: FxPoint,
  radiusPx: number,
  progress: number,
): void {
  const left = 1 - progress;
  const radius = easeOut(progress) * radiusPx;
  if (radius <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(SHOCK, left * 0.35);
  ctx.lineWidth = 5 * left + 1;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, radius * 0.92, radius * SHOCK_DEPTH * 0.92, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(SHOCK, left * 0.95);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, radius, radius * SHOCK_DEPTH, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

const SHIMMER_SPARKLES = 7;
const SHIMMER_RISE = 26;
const SHIMMER_RING_REACH = 22;

/**
 * A set came together on her: a ring in the set's rarity colour opens at her
 * feet and sparkles spiral up around her.
 */
export function drawSetShimmer(
  ctx: CanvasRenderingContext2D,
  feet: FxPoint,
  colour: string,
  progress: number,
): void {
  const left = 1 - progress;
  ctx.save();
  ctx.globalAlpha = left;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  const ring = 6 + easeOut(progress) * SHIMMER_RING_REACH;
  ctx.beginPath();
  ctx.ellipse(feet.x, feet.y, ring, ring * HALF * 0.8, 0, 0, TAU);
  ctx.stroke();
  for (let sparkle = 0; sparkle < SHIMMER_SPARKLES; sparkle++) {
    const stagger = sparkle / SHIMMER_SPARKLES;
    const rise = clamp01(progress * 1.4 - stagger * 0.4);
    if (rise <= 0 || rise >= 1) continue;
    const angle = stagger * TAU + rise * Math.PI * 1.5;
    const sx = feet.x + Math.cos(angle) * 9;
    const sy = feet.y + Math.sin(angle) * 3 - rise * SHIMMER_RISE;
    const size = 2.4 * Math.sin(rise * Math.PI);
    ctx.globalAlpha = left;
    ctx.fillStyle = colour;
    fillSparkle(ctx, sx, sy, size, size * 0.22);
    ctx.fillStyle = rgba(WHITE, 1);
    fillSparkle(ctx, sx, sy, size * 0.5, size * 0.12);
  }
  ctx.restore();
}

const HOURGLASS_HALF_WIDTH = 3.4;
const HOURGLASS_HALF_HEIGHT = 5;
const LAST_STAND_GRAINS = 5;
const LAST_STAND_GRAIN_PERIOD = 70;
const LAST_STAND_EDGE_ALPHA = 0.18;

/**
 * The world is slowed by her last stand: a little hourglass over her head runs
 * down, sand grains drift up around her, and the edges of the view take a
 * faint amber cast. The cast never reaches the middle of the view and is a
 * hue rather than a shade, so it hides nothing.
 */
export function drawLastStand(
  ctx: CanvasRenderingContext2D,
  body: FxPoint,
  hourglassAt: FxPoint,
  sandLeft: number,
  frame: number,
): void {
  ctx.save();
  for (let grain = 0; grain < LAST_STAND_GRAINS; grain++) {
    const phase =
      ((frame + grain * (LAST_STAND_GRAIN_PERIOD / LAST_STAND_GRAINS)) % LAST_STAND_GRAIN_PERIOD) /
      LAST_STAND_GRAIN_PERIOD;
    const angle = hash01(grain * 9 + 1) * TAU;
    const gx = body.x + Math.cos(angle) * 10 + Math.sin(phase * TAU + grain) * 1.5;
    const gy = body.y + 12 - phase * 26;
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(SAND, Math.sin(phase * Math.PI) * 0.9);
    ctx.fillRect(gx - 0.6, gy - 0.6, 1.2, 1.2);
  }

  const { x, y } = hourglassAt;
  const w = HOURGLASS_HALF_WIDTH;
  const h = HOURGLASS_HALF_HEIGHT;
  drawGlow(ctx, SAND, x, y, h * 2.4, 0.3);
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(GLASS, 0.35);
  ctx.beginPath();
  ctx.moveTo(x - w, y - h);
  ctx.lineTo(x + w, y - h);
  ctx.lineTo(x + 0.4, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x - w, y + h);
  ctx.lineTo(x - 0.4, y);
  ctx.closePath();
  ctx.fill();

  const share = clamp01(sandLeft);
  // Sand in the top bulb sits at its narrow end; the bottom bulb fills from its floor.
  const topDepth = h * share;
  ctx.fillStyle = rgba(SAND, 1);
  ctx.beginPath();
  ctx.moveTo(x - w * (topDepth / h) * 0.9, y - topDepth);
  ctx.lineTo(x + w * (topDepth / h) * 0.9, y - topDepth);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  const bottomDepth = h * (1 - share);
  ctx.beginPath();
  ctx.moveTo(x - w * 0.9, y + h);
  ctx.lineTo(x + w * 0.9, y + h);
  ctx.lineTo(x + w * 0.9 * (1 - bottomDepth / h), y + h - bottomDepth);
  ctx.lineTo(x - w * 0.9 * (1 - bottomDepth / h), y + h - bottomDepth);
  ctx.closePath();
  ctx.fill();
  if (share > 0 && frame % 4 !== 0) {
    ctx.fillStyle = rgba(SAND_DEEP, 1);
    ctx.fillRect(x - 0.3, y, 0.6, h - bottomDepth);
  }
  ctx.strokeStyle = rgba(BRASS, 1);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x - w - 0.6, y - h);
  ctx.lineTo(x + w + 0.6, y - h);
  ctx.moveTo(x - w - 0.6, y + h);
  ctx.lineTo(x + w + 0.6, y + h);
  ctx.stroke();
  ctx.restore();
}

/** The faint amber cast at the view's edges while a last stand runs, over a view of `w` by `h` at (`x`, `y`). */
export function drawLastStandEdges(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outer = Math.hypot(w, h) / 2;
  const edges = ctx.createRadialGradient(cx, cy, outer * 0.6, cx, cy, outer);
  edges.addColorStop(0, rgba(SAND, 0));
  edges.addColorStop(1, rgba(SAND, LAST_STAND_EDGE_ALPHA));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = edges;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

const RIPOSTE_GLINT_RADIUS = 3.6;

/** A riposte is armed: a steel glint winks at her striking hand. */
export function drawRiposteGlint(ctx: CanvasRenderingContext2D, at: FxPoint, frame: number): void {
  const twinkle = (Math.sin(frame * 0.14) + 1) / 2;
  ctx.save();
  drawGlint(
    ctx,
    WARD_PALE,
    at.x,
    at.y,
    RIPOSTE_GLINT_RADIUS * (0.6 + twinkle * 0.4),
    0.5 + twinkle * 0.5,
  );
  ctx.restore();
}

const ARC_KINKS = 6;
const ARC_JITTER = 5;
/** The arc re-rolls its kinks on this beat, so it crackles without strobing. */
const ARC_BEAT_FRAMES = 3;
const ARC_FORKS = 2;
const ARC_FORK_SHARE = 0.32;

function arcPoints(
  from: FxPoint,
  to: FxPoint,
  jitter: number,
  key: number,
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const points = [{ x: from.x, y: from.y }];
  if (length === 0) return points;
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let kink = 1; kink < ARC_KINKS; kink++) {
    const t = kink / ARC_KINKS;
    const offset = (hash01(key + kink * 3.7) - HALF) * 2 * jitter * Math.sin(t * Math.PI);
    points.push({ x: from.x + dx * t + normalX * offset, y: from.y + dy * t + normalY * offset });
  }
  points.push({ x: to.x, y: to.y });
  return points;
}

function strokePoints(ctx: CanvasRenderingContext2D, points: ReadonlyArray<FxPoint>): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

/** The chain spark jumping between two bodies: a jagged blue-white arc with two forks. */
export function drawChainArc(
  ctx: CanvasRenderingContext2D,
  from: FxPoint,
  to: FxPoint,
  ageFrames: number,
  progress: number,
): void {
  const left = 1 - progress;
  const key = Math.floor(from.x + to.y) + Math.floor(ageFrames / ARC_BEAT_FRAMES) * 17.3;
  const main = arcPoints(from, to, ARC_JITTER, key);
  const forks: Array<Array<{ x: number; y: number }>> = [];
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.hypot(to.x - from.x, to.y - from.y) * ARC_FORK_SHARE;
  for (let fork = 0; fork < ARC_FORKS; fork++) {
    const start = main[Math.min(main.length - 1, 2 + fork * 2)];
    const side = fork % 2 === 0 ? 1 : -1;
    const forkAngle = angle + side * hashRange(key + fork * 5.1, 0.4, 0.9);
    const end = {
      x: start.x + Math.cos(forkAngle) * length,
      y: start.y + Math.sin(forkAngle) * length,
    };
    forks.push(arcPoints(start, end, ARC_JITTER * HALF, key + fork * 9.9));
  }
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [colour, width, alpha] of [
    [ARC_GLOW, 3.5, 0.45],
    [ARC_CORE, 1.2, 1],
  ] as const) {
    ctx.strokeStyle = rgba(colour, alpha * left);
    ctx.lineWidth = width;
    strokePoints(ctx, main);
    ctx.lineWidth = width * 0.6;
    for (const fork of forks) strokePoints(ctx, fork);
  }
  drawGlow(ctx, ARC_CORE, to.x, to.y, 6, left * 0.6);
  ctx.restore();
}

const STILLNESS_MOTES = 5;
const STILLNESS_PERIOD = 60;
const STILLNESS_RISE = 24;
const STILLNESS_SWAY = 4;

/** Standing still is healing her: a faint green pool at her feet and small crosses drifting up. */
export function drawStillnessRegen(
  ctx: CanvasRenderingContext2D,
  feet: FxPoint,
  frame: number,
): void {
  const breathe = (Math.sin(frame * 0.05) + 1) / 2;
  ctx.save();
  drawGroundPool(ctx, HEAL_GREEN, feet.x, feet.y, 11, 4, 0.16 + breathe * 0.08);
  ctx.globalAlpha = 1;
  for (let mote = 0; mote < STILLNESS_MOTES; mote++) {
    const offset = (mote / STILLNESS_MOTES) * STILLNESS_PERIOD;
    const t = ((frame + offset) % STILLNESS_PERIOD) / STILLNESS_PERIOD;
    const sway = Math.sin((t + mote) * TAU) * STILLNESS_SWAY;
    const mx = feet.x + sway + (mote - (STILLNESS_MOTES - 1) / 2) * 3;
    const my = feet.y - 2 - t * STILLNESS_RISE;
    const alpha = Math.sin(t * Math.PI);
    drawGlow(ctx, HEAL_GREEN, mx, my, 3, alpha * 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(HEAL_PALE, alpha);
    ctx.fillRect(mx - 2, my - 0.6, 4, 1.2);
    ctx.fillRect(mx - 0.6, my - 2, 1.2, 4);
  }
  ctx.restore();
}

const VANISH_PUFFS = 6;
const VANISH_PERIOD = 80;

/** Enemies have lost her: thin smoke curls off her feet while she is drawn see-through. */
export function drawVanishWisps(ctx: CanvasRenderingContext2D, feet: FxPoint, frame: number): void {
  ctx.save();
  for (let puff = 0; puff < VANISH_PUFFS; puff++) {
    const offset = (puff / VANISH_PUFFS) * VANISH_PERIOD;
    const t = ((frame + offset) % VANISH_PERIOD) / VANISH_PERIOD;
    const side = puff % 2 === 0 ? 1 : -1;
    const px = feet.x + side * (5 + t * 4) + Math.sin(t * TAU + puff) * 1.5;
    const py = feet.y - t * 14;
    drawGlow(ctx, SMOKE, px, py, 4 + t * 4, Math.sin(t * Math.PI) * 0.7);
  }
  ctx.restore();
}
