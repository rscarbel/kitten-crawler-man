import { frameTime } from '../../utils';

/**
 * The Wayfinder's Anchor and the shards it is welded from.
 *
 * The stone is a carved waystone, not a rock: a dark slate monolith with a
 * bevelled rim and a compass sigil inlaid in light. It has to read as "this
 * takes you somewhere" at hotbar size, so the shape does most of the work — a
 * tall standing stone with a pointed crown is a waymarker in every folk
 * tradition — and the glowing sigil does the rest. A shard is the same
 * stone's crown snapped off, carrying the top of the same sigil, so the
 * assembled stone looks like the sum of its parts.
 *
 * Two drawings, not four: the three shards differ only in which townsperson
 * parted with them, and a player reads "broken piece of the same stone" off the
 * silhouette long before they read a tint.
 */

type Point = readonly [number, number];

const FULL_CIRCLE = Math.PI * 2;

// ── Material, shared by stone and shards ────────────────────────────────────

/**
 * Bevel planes, light to dark. Five separate tones rather than a gradient: at
 * 24 px a smooth ramp collapses into one blob, so each bevel has to land on a
 * tone a reader can tell from its neighbour's.
 */
const SLATE_CROWN = '#7487a6';
const SLATE_LIT = '#566887';
const SLATE_FACE = '#34425a';
const SLATE_SHADE = '#222c3e';
const SLATE_DEEP = '#171e2c';
const SLATE_OUTLINE = '#0b0f19';
/** Teal is the stone's identity colour across the quest; the shards share it. */
const RUNE_COLOR = '#5eead4';
const RUNE_CORE_COLOR = '#fff4d6';
const RUNE_HALO_RGB = '94,234,212';
const RUNE_CORE_RGB = '255,236,190';

const ALPHA_DECIMALS = 3;

const OUTLINE_WIDTH_FRACTION = 0.05;
/** Lines thinner than a device pixel render as faint grey; never go below this. */
const MIN_LINE_WIDTH = 1;

// ── The waystone silhouette, as fractions of the icon square ────────────────

/**
 * A standing stone narrower at the shoulder than the foot, with a pointed
 * crown whose tip sits a touch right of centre so it reads as carved, not as a
 * gem. The foot chamfers in to a narrower base.
 */
const STONE_CENTRE_X = 0.5;
const STONE_TIP_X = 0.52;
const STONE_TIP_Y = 0.04;
const STONE_SHOULDER_Y = 0.195;
const STONE_SHOULDER_HALF_WIDTH = 0.225;
const STONE_FOOT_Y = 0.87;
const STONE_FOOT_HALF_WIDTH = 0.28;
const STONE_BASE_Y = 0.95;
const STONE_BASE_HALF_WIDTH = 0.15;
/** Clockwise from the tip; bevel tones below are indexed by the edge leaving each point. */
const STONE_OUTLINE_POINTS: readonly Point[] = [
  [STONE_TIP_X, STONE_TIP_Y],
  [STONE_CENTRE_X + STONE_SHOULDER_HALF_WIDTH, STONE_SHOULDER_Y],
  [STONE_CENTRE_X + STONE_FOOT_HALF_WIDTH, STONE_FOOT_Y],
  [STONE_CENTRE_X + STONE_BASE_HALF_WIDTH, STONE_BASE_Y],
  [STONE_CENTRE_X - STONE_BASE_HALF_WIDTH, STONE_BASE_Y],
  [STONE_CENTRE_X - STONE_FOOT_HALF_WIDTH, STONE_FOOT_Y],
  [STONE_CENTRE_X - STONE_SHOULDER_HALF_WIDTH, STONE_SHOULDER_Y],
];
/** The front face: the silhouette pulled toward this point, so every bevel is an even strip. */
const FACE_INSET_CENTRE_Y = 0.52;
const FACE_INSET_CENTRE: Point = [STONE_CENTRE_X, FACE_INSET_CENTRE_Y];
const FACE_INSET = 0.74;
const STONE_FACE_POINTS = insetOutline(STONE_OUTLINE_POINTS, FACE_INSET_CENTRE, FACE_INSET);
/**
 * Tone per bevel strip, indexed by the silhouette edge it lies along
 * (edge i joins point i to point i+1). The crown's two planes face the light
 * up and to the left; the right side and the foot fall into shade.
 */
const BEVEL_TONES = [
  SLATE_SHADE,
  SLATE_SHADE,
  SLATE_DEEP,
  SLATE_DEEP,
  SLATE_DEEP,
  SLATE_LIT,
  SLATE_CROWN,
] as const;

function stoneBevelTone(edge: number): string {
  return BEVEL_TONES[edge] ?? SLATE_DEEP;
}

/** A soft contact shadow under the foot, so the stone stands rather than floats. */
const GROUND_SHADOW_CY = 0.95;
const GROUND_SHADOW_RX = 0.3;
const GROUND_SHADOW_RY = 0.045;
const GROUND_SHADOW_COLOR = 'rgba(0,0,0,0.45)';

// ── The compass sigil ───────────────────────────────────────────────────────

const SIGIL_CX = STONE_CENTRE_X;
const SIGIL_CY = 0.5;
const SIGIL_RING_R = 0.13;
/** The needle's long points run north–south and reach past the ring, so they read at 24 px. */
const SIGIL_NEEDLE_LONG = 0.2;
const SIGIL_NEEDLE_SHORT = 0.1;
const SIGIL_NEEDLE_WAIST = 0.035;
const SIGIL_LINE_WIDTH_FRACTION = 0.045;
/** A chevron carved above the sigil — the "this way" mark on a waymarker. */
const CHEVRON_Y = 0.235;
const CHEVRON_HALF_WIDTH = 0.08;
const CHEVRON_RISE = 0.05;

// ── Animation ───────────────────────────────────────────────────────────────

/** Slow enough to read as breathing, never as a blink. */
const ANCHOR_RUNE_BREATH_PERIOD_S = 3.2;
/** The gleam crosses the face once every two breaths. */
const GLEAM_PERIOD_S = ANCHOR_RUNE_BREATH_PERIOD_S * 2;
/** Every motion repeats on this period, so the gate can sample one whole loop. */
export const ANCHOR_ICON_LOOP_S = GLEAM_PERIOD_S;
const BREATH_MIN = 0.65;
const BREATH_MAX = 1;
/** The halo swells a little with each breath, so the glow seems to come from inside. */
const HALO_R_MIN = 0.24;
const HALO_R_SWELL = 0.06;
const HALO_PEAK_ALPHA = 0.4;
const HALO_CORE_ALPHA = 0.55;
/** The teal ring of the halo is fainter than its warm core, so the light seems to start deep inside. */
const HALO_TEAL_ALPHA_SCALE = 0.5;
/** Where the warm core gives way to teal, as a fraction of the halo radius. */
const HALO_CORE_STOP = 0.18;
const HALO_TEAL_STOP = 0.45;

/** Below this many pixels a mote or a gleam is a single stray pixel: noise, not magic. */
const ANCHOR_DETAIL_MIN_SIZE = 30;

const ANCHOR_MOTE_COUNT = 3;
const MOTE_RISE_PERIOD_S = ANCHOR_RUNE_BREATH_PERIOD_S;
const MOTE_START_Y = 0.9;
const MOTE_END_Y = 0.12;
/**
 * Motes rise beside the stone, not over its face, where they would muddy the
 * sigil; they alternate between a lane this far in from each side.
 */
const MOTE_LANE_INSET = 0.12;
const MOTE_SWAY = 0.035;
const MOTE_SWAY_CYCLES = 1.5;
const MOTE_RADIUS = 0.022;
const MOTE_HALO_SCALE = 2.2;
const MOTE_HALO_ALPHA = 0.3;
/** Fade in and out over this fraction of each rise, so a mote never pops. */
const MOTE_FADE = 0.25;

/** The gleam is visible for this fraction of its period and absent the rest. */
const GLEAM_ACTIVE_FRACTION = 0.16;
const GLEAM_HALF_WIDTH = 0.07;
const GLEAM_SLANT = 0.35;
const GLEAM_ALPHA = 0.35;
const GLEAM_TRAVEL_START = -0.2;
const GLEAM_TRAVEL_END = 1.2;
const GLEAM_RGB = '226,240,255';

/**
 * Draws the assembled Wayfinder's Anchor into a square icon region, animated
 * by the shared frame clock.
 */
export function drawAnchorStoneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  paintAnchorStoneAt(ctx, x, y, size, frameTime, alpha);
}

/**
 * The stone at an explicit time in seconds. The shipped icon passes the frame
 * clock; review tools pass chosen moments so a bake is repeatable.
 */
export function paintAnchorStoneAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  timeS: number,
  alpha = 1,
): void {
  const drawable =
    size > 0 && Number.isFinite(size) && Number.isFinite(timeS) && isVisibleAlpha(alpha);
  if (!drawable) return;
  const loopPhase = (periodS: number): number => {
    const raw = (timeS % periodS) / periodS;
    return raw < 0 ? raw + 1 : raw;
  };
  const breathWave = (1 - Math.cos(loopPhase(ANCHOR_RUNE_BREATH_PERIOD_S) * FULL_CIRCLE)) / 2;
  const breath = BREATH_MIN + (BREATH_MAX - BREATH_MIN) * breathWave;
  const showDetail = size >= ANCHOR_DETAIL_MIN_SIZE;

  ctx.save();
  try {
    ctx.globalAlpha = ctx.globalAlpha * Math.min(1, alpha);
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();

    paintGroundShadow(ctx, x, y, size);

    paintBevels(ctx, STONE_OUTLINE_POINTS, STONE_FACE_POINTS, stoneBevelTone, x, y, size);
    fillPolygon(ctx, STONE_FACE_POINTS, SLATE_FACE, x, y, size);

    paintHalo(ctx, x, y, size, breath, breathWave);
    paintSigil(ctx, x, y, size, breath);
    if (showDetail) paintGleam(ctx, x, y, size, loopPhase(GLEAM_PERIOD_S));

    strokePolygon(ctx, STONE_OUTLINE_POINTS, x, y, size);
    if (showDetail) paintMotes(ctx, x, y, size, loopPhase(MOTE_RISE_PERIOD_S));
  } finally {
    ctx.restore();
  }
}

/**
 * Alpha is written with fixed decimals because a tiny fade value stringifies
 * in exponent form (`1e-7`), which some canvas colour parsers misread as fully
 * opaque — a one-frame flash at the end of every fade.
 */
function rgba(rgb: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${rgb},${clamped.toFixed(ALPHA_DECIMALS)})`;
}

function isVisibleAlpha(alpha: number): boolean {
  return Number.isFinite(alpha) && alpha > 0;
}

/** Pulls every point of an outline toward a centre, giving the face its bevels sit around. */
function insetOutline(points: readonly Point[], centre: Point, inset: number): readonly Point[] {
  const [cx, cy] = centre;
  return points.map(([px, py]) => [cx + (px - cx) * inset, cy + (py - cy) * inset]);
}

/** Traces an outline given in fractions of the icon square, placed at `x, y, size`. */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  x: number,
  y: number,
  size: number,
): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(x + px * size, y + py * size);
    else ctx.lineTo(x + px * size, y + py * size);
  });
  ctx.closePath();
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = color;
  tracePolygon(ctx, points, x, y, size);
  ctx.fill();
}

function strokePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  x: number,
  y: number,
  size: number,
): void {
  ctx.strokeStyle = SLATE_OUTLINE;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * OUTLINE_WIDTH_FRACTION);
  ctx.lineJoin = 'round';
  tracePolygon(ctx, points, x, y, size);
  ctx.stroke();
}

function paintGroundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = GROUND_SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    x + size * STONE_CENTRE_X,
    y + size * GROUND_SHADOW_CY,
    size * GROUND_SHADOW_RX,
    size * GROUND_SHADOW_RY,
    0,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

/** Each bevel is the quad between one silhouette edge and the matching face edge. */
function paintBevels(
  ctx: CanvasRenderingContext2D,
  outline: readonly Point[],
  face: readonly Point[],
  toneOf: (edge: number) => string,
  x: number,
  y: number,
  size: number,
): void {
  for (let edge = 0; edge < outline.length; edge++) {
    const next = (edge + 1) % outline.length;
    const [outerStartX, outerStartY] = outline[edge];
    const [outerEndX, outerEndY] = outline[next];
    const [innerEndX, innerEndY] = face[next];
    const [innerStartX, innerStartY] = face[edge];
    ctx.fillStyle = toneOf(edge);
    ctx.beginPath();
    ctx.moveTo(x + outerStartX * size, y + outerStartY * size);
    ctx.lineTo(x + outerEndX * size, y + outerEndY * size);
    ctx.lineTo(x + innerEndX * size, y + innerEndY * size);
    ctx.lineTo(x + innerStartX * size, y + innerStartY * size);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * One radial gradient instead of `shadowBlur`: the icon is repainted in the
 * hotbar every frame, and a blurred shadow per shape is the expensive path in
 * Chrome. Drawn additively so it lifts the slate rather than covering it.
 */
function paintHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  breath: number,
  breathWave: number,
): void {
  const cx = x + size * SIGIL_CX;
  const cy = y + size * SIGIL_CY;
  const radius = size * (HALO_R_MIN + HALO_R_SWELL * breathWave);
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  halo.addColorStop(0, rgba(RUNE_CORE_RGB, HALO_CORE_ALPHA * breath));
  halo.addColorStop(HALO_CORE_STOP, rgba(RUNE_CORE_RGB, HALO_PEAK_ALPHA * breath));
  halo.addColorStop(
    HALO_TEAL_STOP,
    rgba(RUNE_HALO_RGB, HALO_PEAK_ALPHA * breath * HALO_TEAL_ALPHA_SCALE),
  );
  halo.addColorStop(1, rgba(RUNE_HALO_RGB, 0));
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, FULL_CIRCLE);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/** The ring, the compass needle and the chevron, in one stroke and one fill. */
function paintSigil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  breath: number,
): void {
  const cx = x + size * SIGIL_CX;
  const cy = y + size * SIGIL_CY;
  ctx.save();
  try {
    ctx.globalAlpha = ctx.globalAlpha * breath;
    ctx.strokeStyle = RUNE_COLOR;
    ctx.lineWidth = Math.max(MIN_LINE_WIDTH, size * SIGIL_LINE_WIDTH_FRACTION);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, size * SIGIL_RING_R, 0, FULL_CIRCLE);
    const chevronY = y + size * CHEVRON_Y;
    ctx.moveTo(cx - size * CHEVRON_HALF_WIDTH, chevronY + size * CHEVRON_RISE);
    ctx.lineTo(cx, chevronY);
    ctx.lineTo(cx + size * CHEVRON_HALF_WIDTH, chevronY + size * CHEVRON_RISE);
    ctx.stroke();

    const long = size * SIGIL_NEEDLE_LONG;
    const short = size * SIGIL_NEEDLE_SHORT;
    const waist = size * SIGIL_NEEDLE_WAIST;
    ctx.fillStyle = RUNE_CORE_COLOR;
    ctx.beginPath();
    ctx.moveTo(cx, cy - long);
    ctx.lineTo(cx + waist, cy - waist);
    ctx.lineTo(cx + short, cy);
    ctx.lineTo(cx + waist, cy + waist);
    ctx.lineTo(cx, cy + long);
    ctx.lineTo(cx - waist, cy + waist);
    ctx.lineTo(cx - short, cy);
    ctx.lineTo(cx - waist, cy - waist);
    ctx.closePath();
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/** A slanted band of light that slides across the front face, clipped to it. */
function paintGleam(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  if (phase >= GLEAM_ACTIVE_FRACTION) return;
  const progress = phase / GLEAM_ACTIVE_FRACTION;
  const envelope = Math.sin(progress * Math.PI);
  const centreX = GLEAM_TRAVEL_START + (GLEAM_TRAVEL_END - GLEAM_TRAVEL_START) * progress;
  ctx.save();
  try {
    tracePolygon(ctx, STONE_FACE_POINTS, x, y, size);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(GLEAM_RGB, GLEAM_ALPHA * envelope);
    ctx.beginPath();
    ctx.moveTo(x + size * (centreX - GLEAM_HALF_WIDTH + GLEAM_SLANT), y);
    ctx.lineTo(x + size * (centreX + GLEAM_HALF_WIDTH + GLEAM_SLANT), y);
    ctx.lineTo(x + size * (centreX + GLEAM_HALF_WIDTH - GLEAM_SLANT), y + size);
    ctx.lineTo(x + size * (centreX - GLEAM_HALF_WIDTH - GLEAM_SLANT), y + size);
    ctx.closePath();
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/**
 * Motes rise in lanes beside the stone, never across it: a mote that passed
 * behind the stone would vanish in a single frame, which reads as a flicker.
 */
function paintMotes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    for (let mote = 0; mote < ANCHOR_MOTE_COUNT; mote++) {
      const moteProgress = (phase + mote / ANCHOR_MOTE_COUNT) % 1;
      const swayAngle = moteProgress * MOTE_SWAY_CYCLES * FULL_CIRCLE + mote;

      const fadeIn = Math.min(1, moteProgress / MOTE_FADE);
      const fadeOut = Math.min(1, (1 - moteProgress) / MOTE_FADE);
      const visibility = Math.min(fadeIn, fadeOut);
      const laneX = mote % 2 === 0 ? MOTE_LANE_INSET : 1 - MOTE_LANE_INSET;
      const mx = x + size * (laneX + Math.sin(swayAngle) * MOTE_SWAY);
      const my = y + size * (MOTE_START_Y + (MOTE_END_Y - MOTE_START_Y) * moteProgress);
      const radius = size * MOTE_RADIUS;

      ctx.fillStyle = rgba(RUNE_HALO_RGB, MOTE_HALO_ALPHA * visibility);
      ctx.beginPath();
      ctx.arc(mx, my, radius * MOTE_HALO_SCALE, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.fillStyle = rgba(RUNE_CORE_RGB, visibility);
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, FULL_CIRCLE);
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

// ── The shard ───────────────────────────────────────────────────────────────

/**
 * The crown of the waystone, snapped off: the same pointed top and bevelled
 * shoulders above, a jagged fracture below. Carrying the top of the sigil —
 * chevron, needle tip, the upper arc of the ring — it reads as a piece of the
 * finished stone rather than any rock.
 */
const SHARD_CENTRE_X = 0.5;
const SHARD_TIP_X = 0.48;
const SHARD_TIP_Y = 0.06;
const SHARD_SHOULDER_Y = 0.28;
const SHARD_SHOULDER_HALF_WIDTH = 0.32;
/** The right side snaps off high, the left low, so the break runs on a slant. */
const SHARD_BREAK_RIGHT_Y = 0.5;
const SHARD_BREAK_LEFT_Y = 0.86;
const SHARD_SIDE_FLARE = 0.015;
/** Inner corners of the fracture between its two ends, alternating up and down. */
const SHARD_FRACTURE_TEETH = 4;
const SHARD_FRACTURE_TOOTH_DEPTH = 0.075;

function shardOutlinePoints(): Point[] {
  const rightX = SHARD_CENTRE_X + SHARD_SHOULDER_HALF_WIDTH;
  const leftX = SHARD_CENTRE_X - SHARD_SHOULDER_HALF_WIDTH;
  const breakRight: Point = [rightX + SHARD_SIDE_FLARE, SHARD_BREAK_RIGHT_Y];
  const breakLeft: Point = [leftX - SHARD_SIDE_FLARE, SHARD_BREAK_LEFT_Y];
  const fracture: Point[] = [];
  for (let tooth = 1; tooth <= SHARD_FRACTURE_TEETH; tooth++) {
    const along = tooth / (SHARD_FRACTURE_TEETH + 1);
    const direction = tooth % 2 === 0 ? -1 : 1;
    fracture.push([
      breakRight[0] + (breakLeft[0] - breakRight[0]) * along,
      breakRight[1] +
        (breakLeft[1] - breakRight[1]) * along +
        direction * SHARD_FRACTURE_TOOTH_DEPTH,
    ]);
  }
  return [
    [SHARD_TIP_X, SHARD_TIP_Y],
    [rightX, SHARD_SHOULDER_Y],
    breakRight,
    ...fracture,
    breakLeft,
    [leftX, SHARD_SHOULDER_Y],
  ];
}

const SHARD_OUTLINE_POINTS: readonly Point[] = shardOutlinePoints();
/** Outline edges, by the point they leave: crown, right side, fracture…, left side, left crown. */
const SHARD_RIGHT_SIDE_EDGE = 1;
const SHARD_FIRST_FRACTURE_EDGE = 2;
const SHARD_LAST_FRACTURE_EDGE = SHARD_FIRST_FRACTURE_EDGE + SHARD_FRACTURE_TEETH;
const SHARD_LEFT_SIDE_EDGE = SHARD_LAST_FRACTURE_EDGE + 1;
const SHARD_LEFT_CROWN_EDGE = SHARD_LEFT_SIDE_EDGE + 1;

/**
 * The carved rim keeps the stone's lighting; the fracture edges are raw and
 * dark, lit only from inside.
 */
function shardBevelTone(edge: number): string {
  if (edge === SHARD_LEFT_CROWN_EDGE) return SLATE_CROWN;
  if (edge === SHARD_LEFT_SIDE_EDGE) return SLATE_LIT;
  if (edge <= SHARD_RIGHT_SIDE_EDGE) return SLATE_SHADE;
  return SLATE_DEEP;
}
const SHARD_INSET_CENTRE_Y = 0.48;
const SHARD_INSET_CENTRE: Point = [SHARD_CENTRE_X, SHARD_INSET_CENTRE_Y];
const SHARD_INSET = 0.74;
const SHARD_FACE_POINTS = insetOutline(SHARD_OUTLINE_POINTS, SHARD_INSET_CENTRE, SHARD_INSET);
/** The sigil sits low, so the break cuts through the ring and only its top survives. */
const SHARD_SIGIL_CX = 0.49;
const SHARD_SIGIL_CY = 0.7;
const SHARD_RING_R = 0.2;
const SHARD_NEEDLE_LONG = 0.3;
const SHARD_NEEDLE_WAIST = 0.05;
const SHARD_CHEVRON_Y = 0.3;
const SHARD_CHEVRON_HALF_WIDTH = 0.12;
const SHARD_CHEVRON_RISE = 0.07;
const SHARD_GLOW_R = 0.42;
const SHARD_GLOW_ALPHA = 0.3;
/** A broken stone has lost most of its light; its rune smoulders rather than shines. */
const SHARD_RUNE_ALPHA = 0.75;
const SHARD_FRACTURE_ALPHA = 0.5;
const SHARD_LINE_WIDTH_FRACTION = 0.055;

/** Draws one broken shard. Shared by all three — they are the same stone. */
export function drawAnchorShardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  const drawable = size > 0 && Number.isFinite(size) && isVisibleAlpha(alpha);
  if (!drawable) return;
  const lineWidth = Math.max(MIN_LINE_WIDTH, size * SHARD_LINE_WIDTH_FRACTION);

  ctx.save();
  try {
    ctx.globalAlpha = ctx.globalAlpha * Math.min(1, alpha);
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();

    paintBevels(ctx, SHARD_OUTLINE_POINTS, SHARD_FACE_POINTS, shardBevelTone, x, y, size);
    fillPolygon(ctx, SHARD_FACE_POINTS, SLATE_FACE, x, y, size);

    const sigilCx = x + size * SHARD_SIGIL_CX;
    const sigilCy = y + size * SHARD_SIGIL_CY;
    ctx.save();
    try {
      tracePolygon(ctx, SHARD_FACE_POINTS, x, y, size);
      ctx.clip();
      const glow = ctx.createRadialGradient(
        sigilCx,
        sigilCy,
        0,
        sigilCx,
        sigilCy,
        size * SHARD_GLOW_R,
      );
      glow.addColorStop(0, rgba(RUNE_HALO_RGB, SHARD_GLOW_ALPHA));
      glow.addColorStop(1, rgba(RUNE_HALO_RGB, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.fillRect(x, y, size, size);
      ctx.globalCompositeOperation = 'source-over';

      ctx.globalAlpha = ctx.globalAlpha * SHARD_RUNE_ALPHA;
      ctx.strokeStyle = RUNE_COLOR;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.arc(sigilCx, sigilCy, size * SHARD_RING_R, 0, FULL_CIRCLE);
      const chevronY = y + size * SHARD_CHEVRON_Y;
      ctx.moveTo(sigilCx - size * SHARD_CHEVRON_HALF_WIDTH, chevronY + size * SHARD_CHEVRON_RISE);
      ctx.lineTo(sigilCx, chevronY);
      ctx.lineTo(sigilCx + size * SHARD_CHEVRON_HALF_WIDTH, chevronY + size * SHARD_CHEVRON_RISE);
      ctx.stroke();

      const waist = size * SHARD_NEEDLE_WAIST;
      ctx.fillStyle = RUNE_CORE_COLOR;
      ctx.beginPath();
      ctx.moveTo(sigilCx, sigilCy - size * SHARD_NEEDLE_LONG);
      ctx.lineTo(sigilCx + waist, sigilCy);
      ctx.lineTo(sigilCx - waist, sigilCy);
      ctx.closePath();
      ctx.fill();
    } finally {
      ctx.restore();
    }

    ctx.save();
    try {
      ctx.globalAlpha = ctx.globalAlpha * SHARD_FRACTURE_ALPHA;
      ctx.strokeStyle = RUNE_COLOR;
      ctx.lineWidth = MIN_LINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (
        let corner = SHARD_FIRST_FRACTURE_EDGE;
        corner <= SHARD_LAST_FRACTURE_EDGE + 1;
        corner++
      ) {
        const [px, py] = SHARD_FACE_POINTS[corner];
        if (corner === SHARD_FIRST_FRACTURE_EDGE) ctx.moveTo(x + px * size, y + py * size);
        else ctx.lineTo(x + px * size, y + py * size);
      }
      ctx.stroke();
    } finally {
      ctx.restore();
    }

    strokePolygon(ctx, SHARD_OUTLINE_POINTS, x, y, size);
  } finally {
    ctx.restore();
  }
}
