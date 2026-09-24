/**
 * Everything a fairy's magic looks like once it leaves the fairy: chains,
 * tethers, rings, bolts, lobs, charges, flames and wisps.
 *
 * Every painter is a pure function of the state it is handed and a frame
 * counter, in screen pixels, so the same moment always draws the same picture —
 * a review render, a gate and the live game all see one image. Jitter is hashed
 * from `(seed, frame)` rather than rolled, which is also what keeps a chain from
 * strobing: its kinks re-roll on a fixed beat instead of every frame.
 *
 * Colour follows the kind: blue is a ward, green is healing, white-blue is ice,
 * red-orange is fire, violet-green is the necromancer. Each painter pairs an
 * opaque pass with an additive one (see `drawEmbermote`), so it keeps its hue on
 * snow and sand as well as glowing on a dark dungeon floor.
 */

import { drawEmbermote, drawGlow, hash01, hashRange, rgba, type Rgb } from '../status/statusPaint';
import { drawDangerCircle } from '../dangerTelegraph';

const TAU = Math.PI * 2;
const HALF = 0.5;

// ── Palettes ─────────────────────────────────────────────────────────────────

const WARD_DEEP: Rgb = [40, 96, 235];
const WARD_BLUE: Rgb = [70, 140, 255];
const WARD_PALE: Rgb = [190, 222, 255];
const WHITE: Rgb = [255, 255, 255];

const HEAL_DEEP: Rgb = [30, 150, 70];
const HEAL_GREEN: Rgb = [90, 225, 120];
const HEAL_PALE: Rgb = [210, 255, 190];
const HEAL_GOLD: Rgb = [245, 240, 150];

const ICE_DEEP: Rgb = [70, 150, 230];
const ICE_BLUE: Rgb = [150, 210, 255];
const ICE_WHITE: Rgb = [235, 248, 255];

const FIRE_DEEP: Rgb = [170, 30, 10];
const FIRE_RED: Rgb = [230, 60, 20];
const FIRE_ORANGE: Rgb = [255, 150, 40];
const FIRE_GOLD: Rgb = [255, 220, 120];
const FIRE_CORE: Rgb = [255, 250, 215];
const SMOKE: Rgb = [45, 35, 35];
const SOOT: Rgb = [20, 12, 10];

const NECRO_DARK: Rgb = [22, 10, 34];
const NECRO_VIOLET: Rgb = [160, 80, 255];
const NECRO_GREEN: Rgb = [120, 255, 170];
const NECRO_PALE: Rgb = [220, 200, 255];

/** One palette for a jittered energy line: its halo, its body and its core. */
interface ArcPalette {
  readonly halo: Rgb;
  readonly body: Rgb;
  readonly core: Rgb;
}

const WARD_ARC: ArcPalette = { halo: WARD_DEEP, body: WARD_BLUE, core: WARD_PALE };
const NECRO_ARC: ArcPalette = { halo: NECRO_DARK, body: NECRO_VIOLET, core: NECRO_GREEN };
const HEAL_ARC: ArcPalette = { halo: HEAL_DEEP, body: HEAL_GREEN, core: HEAL_PALE };

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Stride between the hash keys of one effect's successive particles. */
const KEY_STRIDE = 31;
/** Stride between two effects' key spaces, so neighbouring seeds never share a particle. */
const SEED_STRIDE = 7919;

function key(seed: number, index: number, salt = 0): number {
  return seed * SEED_STRIDE + index * KEY_STRIDE + salt;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t: number): number {
  const inverse = 1 - clamp01(t);
  return 1 - inverse * inverse * inverse;
}

/**
 * How far out an expanding ring's front has travelled, 0–1, at `progress`
 * through its expansion. Exported so whatever resolves a ring's effect reaches
 * each body on the frame the drawn front passes it, not before or after.
 */
export function waveFrontFraction(progress: number): number {
  return easeOutCubic(progress);
}

/** Rises over the first `inShare` of a life and falls over the last `outShare`. */
function envelope(progress: number, inShare: number, outShare: number): number {
  const rising = inShare <= 0 ? 1 : clamp01(progress / inShare);
  const falling = outShare <= 0 ? 1 : clamp01((1 - progress) / outShare);
  return Math.min(rising, falling);
}

/**
 * The kinked points of a line from (x1, y1) to (x2, y2). The ends stay put; each
 * interior point is pushed off the line by up to `jitterPx`, tapered towards the
 * ends so the arc always meets what it connects.
 */
function jitteredPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps: number,
  jitterPx: number,
  seed: number,
  beat: number,
): { x: number; y: number }[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;
  const points = [{ x: x1, y: y1 }];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const taper = Math.sin(t * Math.PI);
    const offset = (hash01(key(seed, i, beat)) - HALF) * 2 * jitterPx * taper;
    points.push({ x: x1 + dx * t + perpX * offset, y: y1 + dy * t + perpY * offset });
  }
  points.push({ x: x2, y: y2 });
  return points;
}

function strokePath(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

/** Widths of an arc's three passes, as multiples of its own nominal `widthPx`. */
const ARC_HALO_WIDTH_SCALE = 3;
const ARC_BODY_WIDTH_SCALE = 1.4;
const ARC_CORE_WIDTH_SCALE = 0.55;
/** An arc's core never draws thinner than a single pixel, however small `widthPx` gets. */
const ARC_CORE_MIN_WIDTH_PX = 1;
const ARC_HALO_ALPHA_SHARE = 0.45;
const ARC_BODY_ALPHA_SHARE = 0.9;

/** A three-pass jittered arc: a wide dark halo, a coloured body and a bright core. */
function drawArc(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  palette: ArcPalette,
  alpha: number,
  widthPx: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(palette.halo, alpha * ARC_HALO_ALPHA_SHARE);
  ctx.lineWidth = widthPx * ARC_HALO_WIDTH_SCALE;
  strokePath(ctx, points);
  ctx.strokeStyle = rgba(palette.body, alpha * ARC_BODY_ALPHA_SHARE);
  ctx.lineWidth = widthPx * ARC_BODY_WIDTH_SCALE;
  strokePath(ctx, points);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(palette.core, alpha);
  ctx.lineWidth = Math.max(ARC_CORE_MIN_WIDTH_PX, widthPx * ARC_CORE_WIDTH_SCALE);
  strokePath(ctx, points);
  ctx.globalCompositeOperation = 'source-over';
}

/** A flat ground ellipse: the game is top-down with a slight tilt, so rings squash a little. */
const GROUND_SQUASH = 0.62;

function groundEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, radius), Math.max(0, radius * GROUND_SQUASH), 0, 0, TAU);
}

// ── Shield: death chains and the living tether ──────────────────────────────

/** Frames a chain's kinks hold before re-rolling. Every frame strobes; this crackles. */
const CHAIN_BEAT_FRAMES = 3;
const CHAIN_STEP_PX = 14;
const CHAIN_MIN_STEPS = 4;
const CHAIN_JITTER_PX = 9;
const CHAIN_WIDTH_PX = 2.4;
/** Share of a chain's life spent reaching from the fairy to the ally. */
const CHAIN_REACH_SHARE = 0.22;
const CHAIN_FADE_SHARE = 0.45;
/** The second strand jitters wider, fainter and thinner than the first, so it reads as braided with it rather than doubled. */
const CHAIN_SECOND_STRAND_JITTER_SCALE = 1.4;
const CHAIN_SECOND_STRAND_ALPHA_SHARE = 0.4;
const CHAIN_SECOND_STRAND_WIDTH_SHARE = 0.6;
/** The spark on the ally at connection: a wide glow and a bright core, both flaring at the moment of contact. */
const CHAIN_CONNECT_GLOW_RADIUS_PX = 10;
const CHAIN_CONNECT_GLOW_FLARE_PX = 10;
const CHAIN_CONNECT_GLOW_ALPHA_BASE = 0.5;
const CHAIN_CONNECT_GLOW_ALPHA_FLARE = 0.5;
const CHAIN_CONNECT_FLASH_RADIUS_PX = 4;
const CHAIN_CONNECT_FLASH_FLARE_PX = 4;

/**
 * One blue energy chain from a dead shield fairy to an ally it is handing the
 * aegis to. `progress` runs 0 → 1 over the chain's life: it lashes out, crackles
 * and fades, with a spark flaring on the ally as it connects.
 */
export function drawAegisChain(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const reach = easeOutCubic(progress / CHAIN_REACH_SHARE);
  const alpha = envelope(progress, 0, CHAIN_FADE_SHARE);
  if (alpha <= 0 || reach <= 0) return;
  const tipX = fromX + (toX - fromX) * reach;
  const tipY = fromY + (toY - fromY) * reach;
  const steps = Math.max(
    CHAIN_MIN_STEPS,
    Math.round(Math.hypot(tipX - fromX, tipY - fromY) / CHAIN_STEP_PX),
  );
  const beat = Math.floor(frame / CHAIN_BEAT_FRAMES);

  ctx.save();
  drawArc(
    ctx,
    jitteredPath(fromX, fromY, tipX, tipY, steps, CHAIN_JITTER_PX, seed, beat),
    WARD_ARC,
    alpha,
    CHAIN_WIDTH_PX,
  );
  // A fainter second strand, offset in time, so the chain reads as braided energy.
  drawArc(
    ctx,
    jitteredPath(
      fromX,
      fromY,
      tipX,
      tipY,
      steps,
      CHAIN_JITTER_PX * CHAIN_SECOND_STRAND_JITTER_SCALE,
      seed + 1,
      beat + 1,
    ),
    WARD_ARC,
    alpha * CHAIN_SECOND_STRAND_ALPHA_SHARE,
    CHAIN_WIDTH_PX * CHAIN_SECOND_STRAND_WIDTH_SHARE,
  );
  if (reach >= 1) {
    ctx.globalCompositeOperation = 'lighter';
    const flare = 1 - clamp01((progress - CHAIN_REACH_SHARE) / CHAIN_REACH_SHARE);
    drawGlow(
      ctx,
      WARD_BLUE,
      toX,
      toY,
      CHAIN_CONNECT_GLOW_RADIUS_PX + CHAIN_CONNECT_GLOW_FLARE_PX * flare,
      alpha * (CHAIN_CONNECT_GLOW_ALPHA_BASE + CHAIN_CONNECT_GLOW_ALPHA_FLARE * flare),
    );
    drawGlow(
      ctx,
      WHITE,
      toX,
      toY,
      CHAIN_CONNECT_FLASH_RADIUS_PX + CHAIN_CONNECT_FLASH_FLARE_PX * flare,
      alpha * flare,
    );
  }
  ctx.restore();
}

const SHIELD_BURST_FADE_IN_SHARE = 0.05;
const SHIELD_BURST_FADE_OUT_SHARE = 0.7;
const SHIELD_BURST_OUTER_GLOW_TILE_BASE = 0.5;
const SHIELD_BURST_OUTER_GLOW_ALPHA_SHARE = 0.8;
const SHIELD_BURST_CORE_GLOW_TILE_SHARE = 0.3;
/** Every shard flying outward, so the sigil visibly comes apart into six-cornered pieces. */
const SHIELD_BURST_SHARD_COUNT = 8;
const SHIELD_BURST_SHARD_ANGLE_JITTER = 0.3;
const SHIELD_BURST_SHARD_DISTANCE_MIN = 0.6;
const SHIELD_BURST_SHARD_DISTANCE_MAX = 1.3;
const SHIELD_BURST_SHARD_SIZE_TILE_SHARE = 0.09;
const SHIELD_BURST_SHARD_SPIN_SPEED_MIN = 4;
const SHIELD_BURST_SHARD_SPIN_SPEED_MAX = 9;
const SHIELD_BURST_SHARD_SIDES = 6;

/** The burst of blue light where a shield fairy died, as its wards come apart. */
export function drawShieldDeathBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  progress: number,
  seed: number,
): void {
  const alpha = envelope(progress, SHIELD_BURST_FADE_IN_SHARE, SHIELD_BURST_FADE_OUT_SHARE);
  if (alpha <= 0) return;
  const spread = easeOutCubic(progress);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    WARD_BLUE,
    cx,
    cy,
    tileSize * (SHIELD_BURST_OUTER_GLOW_TILE_BASE + spread),
    alpha * SHIELD_BURST_OUTER_GLOW_ALPHA_SHARE,
  );
  drawGlow(
    ctx,
    WHITE,
    cx,
    cy,
    tileSize * SHIELD_BURST_CORE_GLOW_TILE_SHARE * (1 - spread * HALF),
    alpha,
  );
  ctx.globalCompositeOperation = 'source-over';
  // Shards of the broken sigil, flying outward and tumbling.
  for (let i = 0; i < SHIELD_BURST_SHARD_COUNT; i++) {
    const angle =
      (i / SHIELD_BURST_SHARD_COUNT) * TAU +
      hashRange(key(seed, i), -SHIELD_BURST_SHARD_ANGLE_JITTER, SHIELD_BURST_SHARD_ANGLE_JITTER);
    const distance =
      tileSize *
      spread *
      hashRange(key(seed, i, 1), SHIELD_BURST_SHARD_DISTANCE_MIN, SHIELD_BURST_SHARD_DISTANCE_MAX);
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * GROUND_SQUASH;
    const size = tileSize * SHIELD_BURST_SHARD_SIZE_TILE_SHARE * (1 - progress * HALF);
    const spin =
      angle +
      progress *
        hashRange(
          key(seed, i, 2),
          SHIELD_BURST_SHARD_SPIN_SPEED_MIN,
          SHIELD_BURST_SHARD_SPIN_SPEED_MAX,
        );
    ctx.fillStyle = rgba(WARD_PALE, alpha);
    ctx.beginPath();
    for (let corner = 0; corner < SHIELD_BURST_SHARD_SIDES; corner++) {
      const theta = spin + (corner / SHIELD_BURST_SHARD_SIDES) * TAU;
      const px = x + Math.cos(theta) * size;
      const py = y + Math.sin(theta) * size;
      if (corner === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const TETHER_SAG_FRACTION = 0.12;
const TETHER_SAMPLES = 18;
const TETHER_PULSE_FRAMES = 70;
const TETHER_MOTE_COUNT = 3;
const TETHER_MOTE_SPEED = 0.012;
/** A tether's own breathing: how strongly `strength` scales its base alpha and how much the pulse adds on top. */
const TETHER_STRENGTH_ALPHA_BASE = 0.35;
const TETHER_STRENGTH_ALPHA_SCALE = 0.35;
const TETHER_PULSE_ALPHA_FLOOR_SHARE = 0.7;
const TETHER_PULSE_ALPHA_SHARE = 0.3;
const TETHER_HALO_WIDTH_PX = 3.5;
const TETHER_HALO_ALPHA_SHARE = 0.6;
const TETHER_BODY_WIDTH_PX = 1.6;
const TETHER_MOTE_RADIUS_PX = 3.5;
const TETHER_END_GLOW_RADIUS_PX = 6;
const TETHER_END_GLOW_PULSE_RADIUS_PX = 2;
const TETHER_END_GLOW_ALPHA_SHARE = 0.6;
/** Offsets each tether's pulse phase from its seed, so two tethers never breathe in lockstep. */
const TETHER_SEED_PHASE_STRIDE = 13;

/**
 * The thin, breathing link from a living shield fairy to an ally it wards. It
 * sags a little like a thread and carries motes of light *from* the fairy *to*
 * the ally, so the player reads the direction of the dependency: kill the end
 * the light comes from. `strength` (0–1) is how much of the ward is left.
 */
export function drawShieldTether(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  strength: number,
  frame: number,
  seed: number,
): void {
  drawEnergyTether(ctx, fromX, fromY, toX, toY, strength, frame, seed, WARD_ARC);
}

/** The necromancer's tether to a corpse it is raising; the same thread in violet. */
export function drawNecroTether(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  intensity: number,
  frame: number,
  seed: number,
): void {
  drawEnergyTether(ctx, fromX, fromY, toX, toY, intensity, frame, seed, NECRO_ARC);
}

function drawEnergyTether(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  strength: number,
  frame: number,
  seed: number,
  palette: ArcPalette,
): void {
  const length = Math.hypot(toX - fromX, toY - fromY);
  if (length < 1) return;
  const pulse =
    HALF + HALF * Math.sin(((frame + seed * TETHER_SEED_PHASE_STRIDE) / TETHER_PULSE_FRAMES) * TAU);
  const alpha =
    (TETHER_STRENGTH_ALPHA_BASE + TETHER_STRENGTH_ALPHA_SCALE * clamp01(strength)) *
    (TETHER_PULSE_ALPHA_FLOOR_SHARE + TETHER_PULSE_ALPHA_SHARE * pulse);
  const sag = length * TETHER_SAG_FRACTION;
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2 + sag;
  const pointAt = (t: number) => {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * fromX + 2 * inverse * t * midX + t * t * toX,
      y: inverse * inverse * fromY + 2 * inverse * t * midY + t * t * toY,
    };
  };
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= TETHER_SAMPLES; i++) points.push(pointAt(i / TETHER_SAMPLES));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(palette.halo, alpha * TETHER_HALO_ALPHA_SHARE);
  ctx.lineWidth = TETHER_HALO_WIDTH_PX;
  strokePath(ctx, points);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(palette.body, alpha);
  ctx.lineWidth = TETHER_BODY_WIDTH_PX;
  strokePath(ctx, points);
  for (let i = 0; i < TETHER_MOTE_COUNT; i++) {
    const raw = frame * TETHER_MOTE_SPEED + i / TETHER_MOTE_COUNT + hash01(key(seed, i));
    const t = raw - Math.floor(raw);
    const mote = pointAt(t);
    drawGlow(
      ctx,
      palette.core,
      mote.x,
      mote.y,
      TETHER_MOTE_RADIUS_PX,
      alpha * Math.sin(t * Math.PI),
    );
  }
  drawGlow(
    ctx,
    palette.body,
    toX,
    toY,
    TETHER_END_GLOW_RADIUS_PX + TETHER_END_GLOW_PULSE_RADIUS_PX * pulse,
    alpha * TETHER_END_GLOW_ALPHA_SHARE,
  );
  ctx.restore();
}

const GLYPH_SIDES = 6;
const GLYPH_RADIUS_TILES = 0.3;
const GLYPH_INNER_RADIUS_SHARE = 0.55;
const GLYPH_SPIN_PER_FRAME = 0.025;
const GLYPH_EDGE_WIDTH_PX = 1.8;
/** The inner hex waits until the outline is under way, so the glyph reads as being built. */
const GLYPH_INNER_START = 0.35;
/** The last stretch of the windup, where the glyph flares to say "it lands now". */
const GLYPH_FLARE_START = 0.8;
const GLYPH_MOTE_COUNT = 4;
const GLYPH_MOTE_SPEED = 0.03;
const GLYPH_MOTE_RADIUS_PX = 3;
const GLYPH_NODE_RADIUS_PX = 3.5;
const GLYPH_ALPHA_BASE = 0.55;
const GLYPH_ALPHA_BUILT_SHARE = 0.45;
const GLYPH_OUTER_HALO_WIDTH_SCALE = 2.5;
const GLYPH_OUTER_HALO_ALPHA_SHARE = 0.6;
const GLYPH_INNER_EDGE_WIDTH_SCALE = 0.7;
const GLYPH_NODE_ALPHA_SHARE = 0.8;
const GLYPH_FLARE_GLOW_RADIUS_BASE_SHARE = 0.8;
const GLYPH_FLARE_GLOW_ALPHA_BASE_SHARE = 0.3;
const GLYPH_FLARE_GLOW_ALPHA_FLARE_SHARE = 0.5;
const GLYPH_FLASH_RADIUS_SHARE = 0.5;

/** One corner of a hexagon of `radius` around (cx, cy), turned by `spin`, squashed onto the ground plane. */
function hexCorner(
  cx: number,
  cy: number,
  radius: number,
  spin: number,
  corner: number,
): { x: number; y: number } {
  const angle = spin + (corner / GLYPH_SIDES) * TAU;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * GROUND_SQUASH };
}

/** Strokes the first `fraction` (0–1) of a hexagon's perimeter, edge by edge. */
function strokePartialHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  spin: number,
  fraction: number,
): void {
  const edges = clamp01(fraction) * GLYPH_SIDES;
  if (edges <= 0) return;
  ctx.beginPath();
  const start = hexCorner(cx, cy, radius, spin, 0);
  ctx.moveTo(start.x, start.y);
  for (let edge = 0; edge < Math.ceil(edges); edge++) {
    const from = hexCorner(cx, cy, radius, spin, edge);
    const to = hexCorner(cx, cy, radius, spin, edge + 1);
    const along = Math.min(1, edges - edge);
    ctx.lineTo(from.x + (to.x - from.x) * along, from.y + (to.y - from.y) * along);
  }
  ctx.stroke();
}

/**
 * The ward a shield fairy is weaving, forming over the ally that will carry it.
 * `progress` runs 0 → 1 through the windup: the outline draws itself edge by
 * edge, an inner hex counter-turns inside it, and the whole glyph flares in the
 * last stretch. Motes stream from the fairy at (`fromX`, `fromY`) into it, so a
 * player can see which fairy to hit to stop it before it lands.
 */
export function drawWardGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fromX: number,
  fromY: number,
  tileSize: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const built = clamp01(progress);
  const radius = tileSize * GLYPH_RADIUS_TILES;
  const spin = frame * GLYPH_SPIN_PER_FRAME + seed;
  const flare = clamp01((built - GLYPH_FLARE_START) / (1 - GLYPH_FLARE_START));
  const alpha = GLYPH_ALPHA_BASE + GLYPH_ALPHA_BUILT_SHARE * built;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba(WARD_DEEP, alpha * GLYPH_OUTER_HALO_ALPHA_SHARE);
  ctx.lineWidth = GLYPH_EDGE_WIDTH_PX * GLYPH_OUTER_HALO_WIDTH_SCALE;
  strokePartialHex(ctx, cx, cy, radius, spin, easeOutCubic(built));
  ctx.strokeStyle = rgba(WARD_BLUE, alpha);
  ctx.lineWidth = GLYPH_EDGE_WIDTH_PX;
  strokePartialHex(ctx, cx, cy, radius, spin, easeOutCubic(built));

  const innerBuilt = clamp01((built - GLYPH_INNER_START) / (1 - GLYPH_INNER_START));
  ctx.strokeStyle = rgba(WARD_PALE, alpha * innerBuilt);
  ctx.lineWidth = GLYPH_EDGE_WIDTH_PX * GLYPH_INNER_EDGE_WIDTH_SCALE;
  strokePartialHex(ctx, cx, cy, radius * GLYPH_INNER_RADIUS_SHARE, -spin, innerBuilt);

  ctx.globalCompositeOperation = 'lighter';
  const cornersLit = Math.floor(easeOutCubic(built) * GLYPH_SIDES);
  for (let corner = 0; corner <= cornersLit && corner < GLYPH_SIDES; corner++) {
    const node = hexCorner(cx, cy, radius, spin, corner);
    drawGlow(ctx, WARD_PALE, node.x, node.y, GLYPH_NODE_RADIUS_PX, alpha * GLYPH_NODE_ALPHA_SHARE);
  }
  for (let i = 0; i < GLYPH_MOTE_COUNT; i++) {
    const raw = frame * GLYPH_MOTE_SPEED + i / GLYPH_MOTE_COUNT + hash01(key(seed, i));
    const t = raw - Math.floor(raw);
    const moteX = fromX + (cx - fromX) * t;
    const moteY = fromY + (cy - fromY) * t;
    drawGlow(ctx, WARD_BLUE, moteX, moteY, GLYPH_MOTE_RADIUS_PX, alpha * Math.sin(t * Math.PI));
  }
  drawGlow(
    ctx,
    WARD_BLUE,
    cx,
    cy,
    radius * (GLYPH_FLARE_GLOW_RADIUS_BASE_SHARE + flare),
    alpha * (GLYPH_FLARE_GLOW_ALPHA_BASE_SHARE + GLYPH_FLARE_GLOW_ALPHA_FLARE_SHARE * flare),
  );
  drawGlow(ctx, WHITE, cx, cy, radius * GLYPH_FLASH_RADIUS_SHARE * flare, flare);
  ctx.restore();
}

// ── Healer: the death wave and the living heal stream ────────────────────────

const WAVE_LEAF_COUNT = 22;
/** The ring is drawn three times outward-in: a wide soft band, a bright crest, then a thin pale rim. */
const WAVE_BAND_WIDTH_PX = 9;
const WAVE_BAND_ALPHA_SHARE = 0.35;
const WAVE_CREST_WIDTH_PX = 3.5;
const WAVE_CREST_ALPHA_SHARE = 0.9;
const WAVE_RIM_WIDTH_PX = 1.2;
/** The rim sits one pixel inside the crest's own radius, so the two don't fully overlap. */
const WAVE_RIM_INSET_PX = 1;
const WAVE_SWEPT_FLOOR_ALPHA_SHARE = 0.1;
/** How far a leaf's angle, its lag behind the front, and its spin rate each jitter. */
const WAVE_LEAF_ANGLE_JITTER = 0.12;
const WAVE_LEAF_LAG_SHARE_MAX = 0.12;
const WAVE_LEAF_LIFT_PX_MIN = 2;
const WAVE_LEAF_LIFT_PX_MAX = 10;
const WAVE_LEAF_SPIN_RATE_MIN = 0.05;
const WAVE_LEAF_SPIN_RATE_MAX = 0.15;
const WAVE_LEAF_SIZE_PX = 3.2;
/** Every third leaf catches the light as gold instead of green. */
const WAVE_LEAF_GOLD_EVERY = 3;
const WAVE_AFTERGLOW_RADIUS_SHARE = 0.3;
const WAVE_AFTERGLOW_ALPHA_SHARE = 0.6;
const WAVE_FADE_IN_SHARE = 0.04;
const WAVE_FADE_OUT_SHARE = 0.4;

/**
 * The healer's death wave: a green ring of light rolling out across the floor
 * to `maxRadiusPx`, shedding leaves and sparkles as it goes. `progress` is 0 → 1
 * across the expansion; the ring keeps glowing briefly past it and fades.
 */
export function drawHealingWaveRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxRadiusPx: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const radius = maxRadiusPx * waveFrontFraction(progress);
  const alpha = envelope(progress, WAVE_FADE_IN_SHARE, WAVE_FADE_OUT_SHARE);
  if (alpha <= 0) return;
  ctx.save();
  // The swept floor behind the front, faint, so the area it covered stays readable.
  groundEllipse(ctx, cx, cy, radius);
  ctx.fillStyle = rgba(HEAL_GREEN, alpha * WAVE_SWEPT_FLOOR_ALPHA_SHARE);
  ctx.fill();
  // The front: a soft wide band, then a bright crest.
  ctx.lineWidth = WAVE_BAND_WIDTH_PX;
  ctx.strokeStyle = rgba(HEAL_DEEP, alpha * WAVE_BAND_ALPHA_SHARE);
  groundEllipse(ctx, cx, cy, radius);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = WAVE_CREST_WIDTH_PX;
  ctx.strokeStyle = rgba(HEAL_GREEN, alpha * WAVE_CREST_ALPHA_SHARE);
  groundEllipse(ctx, cx, cy, radius);
  ctx.stroke();
  ctx.lineWidth = WAVE_RIM_WIDTH_PX;
  ctx.strokeStyle = rgba(HEAL_PALE, alpha);
  groundEllipse(ctx, cx, cy, radius - WAVE_RIM_INSET_PX);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  // Leaves riding the crest, lifting and spinning as they go.
  for (let i = 0; i < WAVE_LEAF_COUNT; i++) {
    const angle =
      (i / WAVE_LEAF_COUNT) * TAU +
      hashRange(key(seed, i), -WAVE_LEAF_ANGLE_JITTER, WAVE_LEAF_ANGLE_JITTER);
    const lag = hashRange(key(seed, i, 1), 0, WAVE_LEAF_LAG_SHARE_MAX) * maxRadiusPx;
    const r = Math.max(0, radius - lag);
    const lift =
      hashRange(key(seed, i, 2), WAVE_LEAF_LIFT_PX_MIN, WAVE_LEAF_LIFT_PX_MAX) * progress;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * GROUND_SQUASH - lift;
    const spin =
      angle + frame * hashRange(key(seed, i, 3), WAVE_LEAF_SPIN_RATE_MIN, WAVE_LEAF_SPIN_RATE_MAX);
    const color = i % WAVE_LEAF_GOLD_EVERY === 0 ? HEAL_GOLD : HEAL_GREEN;
    drawLeaf(ctx, x, y, WAVE_LEAF_SIZE_PX, spin, color, alpha);
  }
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    HEAL_PALE,
    cx,
    cy,
    maxRadiusPx * WAVE_AFTERGLOW_RADIUS_SHARE * (1 - progress),
    alpha * WAVE_AFTERGLOW_ALPHA_SHARE,
  );
  ctx.restore();
}

/** How far each side of a leaf's outline bulges from its long axis, as a share of its length. */
const LEAF_BULGE_SHARE = 0.8;
const LEAF_VEIN_ALPHA_SHARE = 0.7;
const LEAF_VEIN_WIDTH_PX = 0.6;
/** The centre vein stops short of the leaf's own points. */
const LEAF_VEIN_REACH_SHARE = 0.8;

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: Rgb,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.quadraticCurveTo(0, -size * LEAF_BULGE_SHARE, size, 0);
  ctx.quadraticCurveTo(0, size * LEAF_BULGE_SHARE, -size, 0);
  ctx.fill();
  ctx.strokeStyle = rgba(HEAL_DEEP, alpha * LEAF_VEIN_ALPHA_SHARE);
  ctx.lineWidth = LEAF_VEIN_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(-size * LEAF_VEIN_REACH_SHARE, 0);
  ctx.lineTo(size * LEAF_VEIN_REACH_SHARE, 0);
  ctx.stroke();
  ctx.restore();
}

const STREAM_MOTES = 14;
const STREAM_SPEED = 0.022;
const STREAM_WAVE_PX = 5;
const STREAM_WAVES = 2;
/** How fast the ribbon's wave crawls along its length over time. */
const STREAM_PHASE_SPEED = 0.15;
const STREAM_RIBBON_ALPHA_SHARE = 0.55;
const STREAM_RIBBON_WIDTH_PX = 1.4;
/** Every fourth mote catches the light as gold instead of pale green. */
const STREAM_MOTE_GOLD_EVERY = 4;
const STREAM_MOTE_TWINKLE_SPEED = 0.4;
/** Offsets each mote's twinkle from the others', so they don't all flash in lockstep. */
const STREAM_MOTE_TWINKLE_PHASE_STRIDE = 1.7;
const STREAM_MOTE_RADIUS_PX = 2;
const STREAM_MOTE_TWINKLE_RADIUS_PX = 2;
const STREAM_HAND_GATHER_RADIUS_PX = 4;
const STREAM_HAND_GATHER_STRENGTH_RADIUS_PX = 6;
/** The bloom on the target: a wide glow and a smaller bright core, both flaring as the heal lands. */
const STREAM_RELEASE_GLOW_RADIUS_PX = 10;
const STREAM_RELEASE_GLOW_FLARE_PX = 14;
const STREAM_RELEASE_CORE_RADIUS_PX = 5;
const STREAM_RELEASE_CORE_FLARE_PX = 6;
const STREAM_RELEASE_LEAF_COUNT = 6;
const STREAM_RELEASE_LEAF_SPIN_SPEED = 0.05;
const STREAM_RELEASE_LEAF_REACH_PX = 8;
const STREAM_RELEASE_LEAF_REACH_SHRINK_PX = 10;
const STREAM_RELEASE_LEAF_LIFT_PX = 6;
const STREAM_RELEASE_LEAF_SIZE_PX = 2.8;

/**
 * The healer's living heal: a sinuous ribbon of green light and leaf sparkles
 * flowing from its hands to the ally it is mending. `intensity` (0–1) is how
 * far the cast has gathered; draw it through the windup and it swells towards
 * the release. Call with `releaseFlash` > 0 on the frames after release for the
 * bloom that lands on the target.
 */
export function drawHealStream(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  intensity: number,
  frame: number,
  seed: number,
  releaseFlash = 0,
): void {
  const length = Math.hypot(toX - fromX, toY - fromY);
  const strength = clamp01(intensity);
  if (length < 1 || (strength <= 0 && releaseFlash <= 0)) return;
  const perpX = -(toY - fromY) / length;
  const perpY = (toX - fromX) / length;
  const pointAt = (t: number, phase: number) => {
    const wave =
      Math.sin(t * Math.PI * STREAM_WAVES + phase) * STREAM_WAVE_PX * Math.sin(t * Math.PI);
    return {
      x: fromX + (toX - fromX) * t + perpX * wave,
      y: fromY + (toY - fromY) * t + perpY * wave,
    };
  };
  const phase = frame * STREAM_PHASE_SPEED;
  ctx.save();
  if (strength > 0) {
    const ribbon: { x: number; y: number }[] = [];
    for (let i = 0; i <= TETHER_SAMPLES; i++) ribbon.push(pointAt(i / TETHER_SAMPLES, phase));
    drawArc(ctx, ribbon, HEAL_ARC, strength * STREAM_RIBBON_ALPHA_SHARE, STREAM_RIBBON_WIDTH_PX);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < STREAM_MOTES; i++) {
      const raw = frame * STREAM_SPEED * (1 + strength) + i / STREAM_MOTES + hash01(key(seed, i));
      const t = raw - Math.floor(raw);
      const mote = pointAt(t, phase + i);
      const twinkle =
        HALF +
        HALF * Math.sin(frame * STREAM_MOTE_TWINKLE_SPEED + i * STREAM_MOTE_TWINKLE_PHASE_STRIDE);
      const color = i % STREAM_MOTE_GOLD_EVERY === 0 ? HEAL_GOLD : HEAL_PALE;
      drawGlow(
        ctx,
        color,
        mote.x,
        mote.y,
        STREAM_MOTE_RADIUS_PX + STREAM_MOTE_TWINKLE_RADIUS_PX * twinkle,
        strength * Math.sin(t * Math.PI),
      );
    }
    // Light gathering in the healer's hands.
    drawEmbermote(
      ctx,
      HEAL_GREEN,
      HEAL_PALE,
      fromX,
      fromY,
      STREAM_HAND_GATHER_RADIUS_PX + STREAM_HAND_GATHER_STRENGTH_RADIUS_PX * strength,
      strength,
    );
  }
  if (releaseFlash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(
      ctx,
      HEAL_GREEN,
      toX,
      toY,
      STREAM_RELEASE_GLOW_RADIUS_PX + STREAM_RELEASE_GLOW_FLARE_PX * releaseFlash,
      releaseFlash,
    );
    drawGlow(
      ctx,
      HEAL_PALE,
      toX,
      toY,
      STREAM_RELEASE_CORE_RADIUS_PX + STREAM_RELEASE_CORE_FLARE_PX * releaseFlash,
      releaseFlash,
    );
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < STREAM_RELEASE_LEAF_COUNT; i++) {
      const angle = (i / STREAM_RELEASE_LEAF_COUNT) * TAU + frame * STREAM_RELEASE_LEAF_SPIN_SPEED;
      const r =
        STREAM_RELEASE_LEAF_REACH_PX + STREAM_RELEASE_LEAF_REACH_SHRINK_PX * (1 - releaseFlash);
      drawLeaf(
        ctx,
        toX + Math.cos(angle) * r,
        toY + Math.sin(angle) * r - STREAM_RELEASE_LEAF_LIFT_PX * (1 - releaseFlash),
        STREAM_RELEASE_LEAF_SIZE_PX,
        angle,
        HEAL_GREEN,
        releaseFlash,
      );
    }
  }
  ctx.restore();
}

// ── Ice: the death blast and the bolt ────────────────────────────────────────

const CHILL_SHARD_COUNT = 14;
const CHILL_FADE_IN_SHARE = 0.02;
const CHILL_FADE_OUT_SHARE = 0.5;
const CHILL_FLOOR_FROST_ALPHA_SHARE = 0.16;
const CHILL_BAND_WIDTH_PX = 7;
const CHILL_BAND_ALPHA_SHARE = 0.55;
const CHILL_CREST_WIDTH_PX = 2.5;
const CHILL_EDGE_WIDTH_PX = 1;
const CHILL_EDGE_ALPHA_SHARE = 0.9;
/** The cold-blue edge sits just outside the crest's own radius. */
const CHILL_EDGE_OUTSET_PX = 2.5;
const CHILL_SHARD_ANGLE_JITTER = 0.15;
const CHILL_SHARD_LEAD_MIN = 0.9;
const CHILL_SHARD_LEAD_MAX = 1.1;
const CHILL_SHARD_LENGTH_MIN = 4;
const CHILL_SHARD_LENGTH_MAX = 9;
const CHILL_SHARD_WIDTH_PX = 1.3;
const CHILL_SHARD_ALPHA_SHARE = 0.8;
const CHILL_SHARD_OUTLINE_WIDTH_PX = 0.6;
const CHILL_GLITTER_TWINKLE_SPEED = 0.5;
const CHILL_GLITTER_RADIUS_BASE_PX = 1.5;
const CHILL_GLITTER_RADIUS_TWINKLE_PX = 1.5;
const CHILL_GLITTER_LIFT_PX = 4;
const CHILL_CORE_GLOW_RADIUS_SHARE = 0.35;

/**
 * The ice fairy's death: a white-blue ring of frost bursting out to
 * `maxRadiusPx`, with shards thrown ahead of it and a mist left in its wake.
 */
export function drawChillBlastRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxRadiusPx: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const radius = maxRadiusPx * waveFrontFraction(progress);
  const alpha = envelope(progress, CHILL_FADE_IN_SHARE, CHILL_FADE_OUT_SHARE);
  if (alpha <= 0) return;
  ctx.save();
  groundEllipse(ctx, cx, cy, radius);
  ctx.fillStyle = rgba(ICE_WHITE, alpha * CHILL_FLOOR_FROST_ALPHA_SHARE);
  ctx.fill();
  ctx.lineWidth = CHILL_BAND_WIDTH_PX;
  ctx.strokeStyle = rgba(ICE_DEEP, alpha * CHILL_BAND_ALPHA_SHARE);
  groundEllipse(ctx, cx, cy, radius);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = CHILL_CREST_WIDTH_PX;
  ctx.strokeStyle = rgba(ICE_WHITE, alpha);
  groundEllipse(ctx, cx, cy, radius);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  // A thin cold-blue edge outside the white crest: on snow the white is the
  // ground colour, and this line is what still shows where the blast reached.
  ctx.lineWidth = CHILL_EDGE_WIDTH_PX;
  ctx.strokeStyle = rgba(ICE_DEEP, alpha * CHILL_EDGE_ALPHA_SHARE);
  groundEllipse(ctx, cx, cy, radius + CHILL_EDGE_OUTSET_PX);
  ctx.stroke();
  // Shards: thin white spikes pointing outward from the crest.
  for (let i = 0; i < CHILL_SHARD_COUNT; i++) {
    const angle =
      (i / CHILL_SHARD_COUNT) * TAU +
      hashRange(key(seed, i), -CHILL_SHARD_ANGLE_JITTER, CHILL_SHARD_ANGLE_JITTER);
    const lead = hashRange(key(seed, i, 1), CHILL_SHARD_LEAD_MIN, CHILL_SHARD_LEAD_MAX);
    const r = radius * lead;
    const length =
      hashRange(key(seed, i, 2), CHILL_SHARD_LENGTH_MIN, CHILL_SHARD_LENGTH_MAX) *
      (1 - progress * HALF);
    const baseX = cx + Math.cos(angle) * r;
    const baseY = cy + Math.sin(angle) * r * GROUND_SQUASH;
    const tipX = baseX + Math.cos(angle) * length;
    const tipY = baseY + Math.sin(angle) * length * GROUND_SQUASH;
    const sideX = -Math.sin(angle) * CHILL_SHARD_WIDTH_PX;
    const sideY = Math.cos(angle) * CHILL_SHARD_WIDTH_PX * GROUND_SQUASH;
    ctx.fillStyle = rgba(ICE_WHITE, alpha);
    ctx.strokeStyle = rgba(ICE_DEEP, alpha * CHILL_SHARD_ALPHA_SHARE);
    ctx.lineWidth = CHILL_SHARD_OUTLINE_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(baseX + sideX, baseY + sideY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX - sideX, baseY - sideY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Snow-glitter hanging in the air behind the front.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < CHILL_SHARD_COUNT; i++) {
    const angle = hash01(key(seed, i, 5)) * TAU;
    const r = radius * hash01(key(seed, i, 6));
    const twinkle = HALF + HALF * Math.sin(frame * CHILL_GLITTER_TWINKLE_SPEED + i);
    drawGlow(
      ctx,
      ICE_BLUE,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r * GROUND_SQUASH - CHILL_GLITTER_LIFT_PX * progress,
      CHILL_GLITTER_RADIUS_BASE_PX + CHILL_GLITTER_RADIUS_TWINKLE_PX * twinkle,
      alpha * twinkle,
    );
  }
  drawGlow(
    ctx,
    ICE_WHITE,
    cx,
    cy,
    maxRadiusPx * CHILL_CORE_GLOW_RADIUS_SHARE * (1 - progress),
    alpha,
  );
  ctx.restore();
}

/** One point of an ice bolt's recent path, in screen pixels. */
export interface IceBoltTrailPoint {
  readonly x: number;
  readonly y: number;
}

const ICE_BOLT_LENGTH_TILE_SHARE = 0.44;
const ICE_BOLT_WIDTH_TILE_SHARE = 0.16;
/** Where along the shard, from its tail, it is widest: a long point and a stubby back. */
const ICE_BOLT_SHOULDER_SHARE = 0.35;
const ICE_BOLT_CORE_SCALE = 0.45;
const ICE_BOLT_OUTLINE_WIDTH_PX = 1;
const ICE_BOLT_HALO_RADIUS_SCALE = 1.4;
const ICE_BOLT_HALO_ALPHA = 0.55;
const ICE_BOLT_TRAIL_WIDTH_SCALE = 0.9;
const ICE_BOLT_TRAIL_ALPHA = 0.55;
const ICE_BOLT_TRAIL_CORE_ALPHA = 0.7;
const ICE_BOLT_TRAIL_CORE_WIDTH_PX = 1;
const ICE_BOLT_FLAKES = 7;
const ICE_BOLT_FLAKE_SPREAD_PX = 5;
const ICE_BOLT_FLAKE_SIZE_MIN_PX = 1;
const ICE_BOLT_FLAKE_SIZE_MAX_PX = 2.2;
/** Flakes re-scatter on this beat, so the trail glitters without strobing. */
const ICE_BOLT_FLAKE_BEAT_FRAMES = 4;
const ICE_BOLT_GLINT_SPEED = 0.6;
const ICE_BOLT_GLINT_RADIUS_PX = 2.5;
/** The glint sits this far towards the point from the shard's centre. */
const ICE_BOLT_GLINT_LEAD_SHARE = 0.2;

/**
 * An ice fairy's bolt in flight: a pale shard pointing along its flight, a
 * cold halo round it, and a frost trail of fading line and glittering flakes
 * back along `trail` (oldest first). (`x`, `y`) is the shard's centre and
 * (`dirX`, `dirY`) its unit heading.
 */
export function drawIceBolt(
  ctx: CanvasRenderingContext2D,
  trail: readonly IceBoltTrailPoint[],
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  tileSize: number,
  frame: number,
  seed: number,
): void {
  const length = tileSize * ICE_BOLT_LENGTH_TILE_SHARE;
  const width = tileSize * ICE_BOLT_WIDTH_TILE_SHARE;
  const perpX = -dirY;
  const perpY = dirX;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const fade = i / trail.length;
    const from = trail[i - 1];
    const to = trail[i];
    ctx.strokeStyle = rgba(ICE_BLUE, fade * ICE_BOLT_TRAIL_ALPHA);
    ctx.lineWidth = width * ICE_BOLT_TRAIL_WIDTH_SCALE * fade;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(ICE_WHITE, ICE_BOLT_TRAIL_CORE_ALPHA);
  ctx.lineWidth = ICE_BOLT_TRAIL_CORE_WIDTH_PX;
  ctx.beginPath();
  trail.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(x, y);
  ctx.stroke();
  const beat = Math.floor(frame / ICE_BOLT_FLAKE_BEAT_FRAMES);
  for (let i = 0; i < ICE_BOLT_FLAKES && trail.length > 0; i++) {
    const anchor = trail[Math.floor(hash01(key(seed + beat, i)) * trail.length)];
    const flakeX = anchor.x + hashRange(key(seed + beat, i, 1), -1, 1) * ICE_BOLT_FLAKE_SPREAD_PX;
    const flakeY = anchor.y + hashRange(key(seed + beat, i, 2), -1, 1) * ICE_BOLT_FLAKE_SPREAD_PX;
    const size = hashRange(
      key(seed + beat, i, 3),
      ICE_BOLT_FLAKE_SIZE_MIN_PX,
      ICE_BOLT_FLAKE_SIZE_MAX_PX,
    );
    ctx.fillStyle = rgba(ICE_WHITE, 1);
    ctx.fillRect(flakeX - size / 2, flakeY - size / 2, size, size);
  }
  drawGlow(ctx, ICE_BLUE, x, y, length * ICE_BOLT_HALO_RADIUS_SCALE, ICE_BOLT_HALO_ALPHA);
  ctx.globalCompositeOperation = 'source-over';
  const shard = (scale: number): void => {
    const half = (length * scale) / 2;
    const shoulder = -half + length * scale * ICE_BOLT_SHOULDER_SHARE;
    const side = (width * scale) / 2;
    ctx.beginPath();
    ctx.moveTo(x + dirX * half, y + dirY * half);
    ctx.lineTo(x + dirX * shoulder + perpX * side, y + dirY * shoulder + perpY * side);
    ctx.lineTo(x - dirX * half, y - dirY * half);
    ctx.lineTo(x + dirX * shoulder - perpX * side, y + dirY * shoulder - perpY * side);
    ctx.closePath();
  };
  shard(1);
  ctx.fillStyle = rgba(ICE_BLUE, 1);
  ctx.fill();
  ctx.strokeStyle = rgba(ICE_DEEP, 1);
  ctx.lineWidth = ICE_BOLT_OUTLINE_WIDTH_PX;
  ctx.stroke();
  shard(ICE_BOLT_CORE_SCALE);
  ctx.fillStyle = rgba(ICE_WHITE, 1);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const glint = HALF + HALF * Math.sin(frame * ICE_BOLT_GLINT_SPEED + seed);
  const glintLead = length * ICE_BOLT_GLINT_LEAD_SHARE;
  drawGlow(
    ctx,
    ICE_WHITE,
    x + dirX * glintLead,
    y + dirY * glintLead,
    ICE_BOLT_GLINT_RADIUS_PX,
    glint,
  );
  ctx.restore();
}

// ── Fire: lob, reticle, charge, flame patch, explosion ──────────────────────

/** One point of a fireball's recent path, in screen pixels (already lifted by its height). */
export interface FireballTrailPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Big enough to read as a thrown bomb at a glance, not a spark: the ball is
 * the thing a crawler has to track across a long, slow lob.
 */
const FIREBALL_RADIUS_TILE_SHARE = 0.28;
/** How much height it takes to halve the shadow's own scale, in tile heights. */
const FIREBALL_SHADOW_HEIGHT_HALVING_TILES = 2.5;
const FIREBALL_SHADOW_ALPHA_SCALE = 0.4;
const FIREBALL_SHADOW_ALPHA_FLOOR = 0.15;
const FIREBALL_SHADOW_WIDTH_SCALE = 1.6;
const FIREBALL_SHADOW_WIDTH_FLOOR_PX = 4;
const FIREBALL_SHADOW_HEIGHT_SCALE = 0.8;
const FIREBALL_SHADOW_HEIGHT_FLOOR_PX = 2;
const FIREBALL_TRAIL_SMOKE_LIFT_PX = 4;
const FIREBALL_TRAIL_SMOKE_RADIUS_BASE_SHARE = 0.8;
const FIREBALL_TRAIL_SMOKE_ALPHA_SHARE = 0.25;
const FIREBALL_TRAIL_FIRE_RADIUS_BASE_SHARE = 0.4;
const FIREBALL_TRAIL_FIRE_RADIUS_GROWTH_SHARE = 0.8;
const FIREBALL_TRAIL_FIRE_ALPHA_SHARE = 0.5;
const FIREBALL_TRAIL_GLOW_RADIUS_BASE_SHARE = 0.5;
const FIREBALL_TRAIL_GLOW_ALPHA_SHARE = 0.55;
/** Past this share of a trail point's age it reads as orange embers instead of red flame. */
const FIREBALL_TRAIL_ORANGE_AGE_SHARE = 0.6;
const FIREBALL_SPARK_CHANCE = 0.6;
const FIREBALL_SPARK_JITTER_X_PX = 4;
const FIREBALL_SPARK_JITTER_Y_MIN_PX = -4;
const FIREBALL_SPARK_JITTER_Y_MAX_PX = 2;
const FIREBALL_SPARK_RADIUS_PX = 1.5;
const FIREBALL_FLICKER_BASE = 0.85;
const FIREBALL_FLICKER_SHARE = 0.15;
const FIREBALL_FLICKER_SPEED = 0.9;
const FIREBALL_BODY_RADIUS_SCALE = 2;
const FIREBALL_CORE_OUTLINE_ALPHA_SHARE = 0.9;
const FIREBALL_CORE_OUTLINE_WIDTH_PX = 1;
const FIREBALL_CORE_RADIUS_SCALE = 0.8;
const FIREBALL_CORONA_RADIUS_SCALE = 1.1;
const FIREBALL_CORONA_ALPHA_SHARE = 0.9;
const FIREBALL_HEART_RADIUS_SCALE = 0.55;

/**
 * A fireball in flight. `trail` is its recent path, oldest first, ending at the
 * ball; the ground shadow is drawn at (`shadowX`, `shadowY`) and shrinks with
 * `heightPx`, which is what tells the player where it is going to come down.
 */
export function drawFireballFlight(
  ctx: CanvasRenderingContext2D,
  trail: readonly FireballTrailPoint[],
  shadowX: number,
  shadowY: number,
  heightPx: number,
  tileSize: number,
  frame: number,
  seed: number,
): void {
  if (trail.length === 0) return;
  const head = trail[trail.length - 1];
  const ballRadius = tileSize * FIREBALL_RADIUS_TILE_SHARE;
  ctx.save();
  // Ground shadow: sharper and larger the lower the ball is.
  const shadowScale = 1 / (1 + heightPx / (tileSize * FIREBALL_SHADOW_HEIGHT_HALVING_TILES));
  ctx.fillStyle = rgba(
    SOOT,
    FIREBALL_SHADOW_ALPHA_SCALE * shadowScale + FIREBALL_SHADOW_ALPHA_FLOOR,
  );
  ctx.beginPath();
  ctx.ellipse(
    shadowX,
    shadowY,
    ballRadius * FIREBALL_SHADOW_WIDTH_SCALE * shadowScale + FIREBALL_SHADOW_WIDTH_FLOOR_PX,
    ballRadius * FIREBALL_SHADOW_HEIGHT_SCALE * shadowScale + FIREBALL_SHADOW_HEIGHT_FLOOR_PX,
    0,
    0,
    TAU,
  );
  ctx.fill();

  // Trail: smoke first, then fire, then sparks, tapering towards the tail.
  const count = trail.length;
  for (let i = 0; i < count - 1; i++) {
    const t = (i + 1) / count;
    const point = trail[i];
    drawGlow(
      ctx,
      SMOKE,
      point.x,
      point.y - (1 - t) * FIREBALL_TRAIL_SMOKE_LIFT_PX,
      ballRadius * (FIREBALL_TRAIL_SMOKE_RADIUS_BASE_SHARE + (1 - t)),
      FIREBALL_TRAIL_SMOKE_ALPHA_SHARE * t,
    );
  }
  for (let i = 0; i < count - 1; i++) {
    const t = (i + 1) / count;
    const point = trail[i];
    drawGlow(
      ctx,
      FIRE_RED,
      point.x,
      point.y,
      ballRadius *
        (FIREBALL_TRAIL_FIRE_RADIUS_BASE_SHARE + FIREBALL_TRAIL_FIRE_RADIUS_GROWTH_SHARE * t),
      FIREBALL_TRAIL_FIRE_ALPHA_SHARE * t,
    );
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count - 1; i++) {
    const t = (i + 1) / count;
    const point = trail[i];
    drawGlow(
      ctx,
      t > FIREBALL_TRAIL_ORANGE_AGE_SHARE ? FIRE_ORANGE : FIRE_RED,
      point.x,
      point.y,
      ballRadius * (FIREBALL_TRAIL_GLOW_RADIUS_BASE_SHARE + t),
      FIREBALL_TRAIL_GLOW_ALPHA_SHARE * t,
    );
    if (hash01(key(seed, i, frame)) > FIREBALL_SPARK_CHANCE) {
      const sparkX =
        point.x +
        hashRange(key(seed, i, frame + 1), -FIREBALL_SPARK_JITTER_X_PX, FIREBALL_SPARK_JITTER_X_PX);
      const sparkY =
        point.y +
        hashRange(
          key(seed, i, frame + 2),
          FIREBALL_SPARK_JITTER_Y_MIN_PX,
          FIREBALL_SPARK_JITTER_Y_MAX_PX,
        );
      drawGlow(ctx, FIRE_GOLD, sparkX, sparkY, FIREBALL_SPARK_RADIUS_PX, t);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  // The ball: an opaque ember body, a flickering corona, and a white-hot heart.
  const flicker =
    FIREBALL_FLICKER_BASE +
    FIREBALL_FLICKER_SHARE * Math.sin(frame * FIREBALL_FLICKER_SPEED + seed);
  drawEmbermote(
    ctx,
    FIRE_RED,
    FIRE_ORANGE,
    head.x,
    head.y,
    ballRadius * FIREBALL_BODY_RADIUS_SCALE * flicker,
    1,
  );
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(FIRE_ORANGE, 1);
  ctx.strokeStyle = rgba(FIRE_DEEP, FIREBALL_CORE_OUTLINE_ALPHA_SHARE);
  ctx.lineWidth = FIREBALL_CORE_OUTLINE_WIDTH_PX;
  ctx.beginPath();
  ctx.arc(head.x, head.y, ballRadius * FIREBALL_CORE_RADIUS_SCALE, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    FIRE_GOLD,
    head.x,
    head.y,
    ballRadius * FIREBALL_CORONA_RADIUS_SCALE,
    FIREBALL_CORONA_ALPHA_SHARE,
  );
  drawGlow(ctx, FIRE_CORE, head.x, head.y, ballRadius * FIREBALL_HEART_RADIUS_SCALE, 1);
  ctx.restore();
}

/**
 * The small red reticle on the ground where a fire fairy has locked its throw.
 * Four brackets close in and spin slowly as `progress` (0 → 1 through the lock
 * and the flight) nears the landing, so the time left is readable at a glance.
 */
/** The brackets start this much wider than the landing radius and close in as the lock completes. */
const RETICLE_BRACKET_START_SCALE = 1.35;
const RETICLE_BRACKET_CLOSE_SCALE = 0.35;
const RETICLE_SPIN_SPEED = 0.03;
const RETICLE_PULSE_SPEED_BASE = 0.2;
const RETICLE_PULSE_SPEED_LOCK = 0.4;
const RETICLE_FILL_ALPHA_BASE = 0.08;
const RETICLE_FILL_ALPHA_LOCK = 0.12;
const RETICLE_BRACKET_COUNT = 4;
/** Each bracket's own arc length, radians, and the gap that opens it from the last one's end. */
const RETICLE_BRACKET_SWEEP = 0.7;
const RETICLE_BRACKET_GAP = 0.35;
const RETICLE_BRACKET_WIDTH_PX = 2;
const RETICLE_BRACKET_ALPHA_BASE = 0.55;
const RETICLE_BRACKET_ALPHA_LOCK = 0.35;
const RETICLE_CROSS_ALPHA_BASE = 0.4;
const RETICLE_CROSS_ALPHA_LOCK = 0.5;
const RETICLE_CROSS_WIDTH_PX = 1;
const RETICLE_CROSS_REACH_SHARE = 0.35;

export function drawLandingReticle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
  frame: number,
): void {
  const p = clamp01(progress);
  const radius = radiusPx * (RETICLE_BRACKET_START_SCALE - RETICLE_BRACKET_CLOSE_SCALE * p);
  const spin = frame * RETICLE_SPIN_SPEED;
  const pulse =
    HALF + HALF * Math.sin(frame * (RETICLE_PULSE_SPEED_BASE + RETICLE_PULSE_SPEED_LOCK * p));
  ctx.save();
  groundEllipse(ctx, cx, cy, radiusPx);
  ctx.fillStyle = rgba(FIRE_RED, RETICLE_FILL_ALPHA_BASE + RETICLE_FILL_ALPHA_LOCK * p);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = RETICLE_BRACKET_WIDTH_PX;
  ctx.strokeStyle = rgba(FIRE_RED, RETICLE_BRACKET_ALPHA_BASE + RETICLE_BRACKET_ALPHA_LOCK * pulse);
  for (let i = 0; i < RETICLE_BRACKET_COUNT; i++) {
    const start = spin + (i / RETICLE_BRACKET_COUNT) * TAU - RETICLE_BRACKET_GAP;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * GROUND_SQUASH, 0, start, start + RETICLE_BRACKET_SWEEP);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(FIRE_GOLD, RETICLE_CROSS_ALPHA_BASE + RETICLE_CROSS_ALPHA_LOCK * p);
  ctx.lineWidth = RETICLE_CROSS_WIDTH_PX;
  const cross = radiusPx * RETICLE_CROSS_REACH_SHARE;
  ctx.beginPath();
  ctx.moveTo(cx - cross, cy);
  ctx.lineTo(cx + cross, cy);
  ctx.moveTo(cx, cy - cross * GROUND_SQUASH);
  ctx.lineTo(cx, cy + cross * GROUND_SQUASH);
  ctx.stroke();
  ctx.restore();
}

const DANGER_FILL_RING_ALPHA_BASE = 0.55;
const DANGER_FILL_RING_ALPHA_SHARE = 0.45;
const DANGER_FILL_DISC_ALPHA_BASE = 0.18;
const DANGER_FILL_DISC_ALPHA_SHARE = 0.12;
const DANGER_FILL_RIM_WIDTH_PX = 1.5;
const DANGER_FILL_RIM_ALPHA_SHARE = 0.6;

/**
 * A danger circle that fills from the centre as `progress` runs 0 → 1: the
 * shared red warning at full size, plus a solid disc growing inside it, so how
 * long is left reads as how much of the circle is still empty.
 */
export function drawFillingDangerCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
): void {
  const p = clamp01(progress);
  drawDangerCircle(
    ctx,
    cx,
    cy,
    radiusPx,
    DANGER_FILL_RING_ALPHA_BASE + DANGER_FILL_RING_ALPHA_SHARE * p,
  );
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx * p, 0, TAU);
  ctx.fillStyle = rgba(FIRE_RED, DANGER_FILL_DISC_ALPHA_BASE + DANGER_FILL_DISC_ALPHA_SHARE * p);
  ctx.fill();
  ctx.lineWidth = DANGER_FILL_RIM_WIDTH_PX;
  ctx.strokeStyle = rgba(FIRE_ORANGE, DANGER_FILL_RIM_ALPHA_SHARE);
  ctx.stroke();
  ctx.restore();
}

const CHARGE_FLICKER_RATE_BASE = 0.25;
/** The flicker speeds up quadratically as the fuse burns down, so the last instant reads as urgent rather than linear. */
const CHARGE_FLICKER_RATE_FUSE_SHARE = 0.9;
const CHARGE_RADIUS_TILE_BASE_SHARE = 0.14;
const CHARGE_RADIUS_TILE_FUSE_SHARE = 0.06;
const CHARGE_RADIUS_FLICKER_BASE = 0.85;
const CHARGE_RADIUS_FLICKER_SHARE = 0.3;
const CHARGE_SHADOW_ALPHA_SHARE = 0.5;
const CHARGE_SHADOW_LIFT_PX = 1;
const CHARGE_SHADOW_WIDTH_SCALE = 1.3;
const CHARGE_SHADOW_HEIGHT_SCALE = 0.6;
/** Where the ember body sits above the shadow, as a share of its own radius. */
const CHARGE_EMBER_LIFT_SHARE = 0.3;
const CHARGE_EMBER_RADIUS_SCALE = 2;
const CHARGE_CORONA_RADIUS_BASE_SHARE = 0.8;
const CHARGE_CORONA_RADIUS_FLICKER_SHARE = 0.4;
const CHARGE_CORONA_ALPHA_BASE = 0.7;
const CHARGE_CORONA_ALPHA_FUSE_SHARE = 0.3;
const CHARGE_HEART_RADIUS_SCALE = 0.45;
const CHARGE_HEART_ALPHA_BASE = 0.6;
const CHARGE_HEART_ALPHA_FLICKER_SHARE = 0.4;
const CHARGE_SPARK_COUNT = 5;
const CHARGE_SPARK_LIFE_SPEED = 0.05;
const CHARGE_SPARK_REACH_TILE_SHARE = 0.35;
const CHARGE_SPARK_LIFT_PX = 6;
const CHARGE_SPARK_RADIUS_PX = 1.4;
const CHARGE_SPARK_ALPHA_BASE = 0.5;
const CHARGE_SPARK_ALPHA_FUSE_SHARE = 0.5;

/**
 * A landed fireball waiting to go off: a glowing ember that flickers faster and
 * brighter as the fuse (`fuseProgress`, 0 → 1) burns down, with sparks spitting
 * off it.
 */
export function drawChargeCore(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  fuseProgress: number,
  frame: number,
  seed: number,
): void {
  const p = clamp01(fuseProgress);
  const rate = CHARGE_FLICKER_RATE_BASE + CHARGE_FLICKER_RATE_FUSE_SHARE * p * p;
  const flicker = HALF + HALF * Math.sin(frame * rate + seed);
  const radius =
    tileSize *
    (CHARGE_RADIUS_TILE_BASE_SHARE + CHARGE_RADIUS_TILE_FUSE_SHARE * p) *
    (CHARGE_RADIUS_FLICKER_BASE + CHARGE_RADIUS_FLICKER_SHARE * flicker);
  const emberLift = radius * CHARGE_EMBER_LIFT_SHARE;
  ctx.save();
  ctx.fillStyle = rgba(SOOT, CHARGE_SHADOW_ALPHA_SHARE);
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + CHARGE_SHADOW_LIFT_PX,
    radius * CHARGE_SHADOW_WIDTH_SCALE,
    radius * CHARGE_SHADOW_HEIGHT_SCALE,
    0,
    0,
    TAU,
  );
  ctx.fill();
  drawEmbermote(
    ctx,
    FIRE_DEEP,
    FIRE_ORANGE,
    cx,
    cy - emberLift,
    radius * CHARGE_EMBER_RADIUS_SCALE,
    1,
  );
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    FIRE_GOLD,
    cx,
    cy - emberLift,
    radius * (CHARGE_CORONA_RADIUS_BASE_SHARE + CHARGE_CORONA_RADIUS_FLICKER_SHARE * flicker),
    CHARGE_CORONA_ALPHA_BASE + CHARGE_CORONA_ALPHA_FUSE_SHARE * p,
  );
  drawGlow(
    ctx,
    FIRE_CORE,
    cx,
    cy - emberLift,
    radius * CHARGE_HEART_RADIUS_SCALE,
    CHARGE_HEART_ALPHA_BASE + CHARGE_HEART_ALPHA_FLICKER_SHARE * flicker,
  );
  for (let i = 0; i < CHARGE_SPARK_COUNT; i++) {
    const life = (frame * CHARGE_SPARK_LIFE_SPEED + hash01(key(seed, i))) % 1;
    const angle =
      hash01(key(seed, i, Math.floor(frame * CHARGE_SPARK_LIFE_SPEED + hash01(key(seed, i))))) *
      TAU;
    const r = radius + life * tileSize * CHARGE_SPARK_REACH_TILE_SHARE;
    drawGlow(
      ctx,
      FIRE_GOLD,
      cx + Math.cos(angle) * r,
      cy - emberLift + Math.sin(angle) * r * GROUND_SQUASH - life * CHARGE_SPARK_LIFT_PX,
      CHARGE_SPARK_RADIUS_PX,
      (1 - life) * (CHARGE_SPARK_ALPHA_BASE + CHARGE_SPARK_ALPHA_FUSE_SHARE * p),
    );
  }
  ctx.restore();
}

const FLAME_TONGUES = 16;
const FLAME_FADE_IN_SHARE = 0.06;
const FLAME_FADE_OUT_SHARE = 0.15;
const FLAME_SCORCH_ALPHA_SHARE = 0.35;
const FLAME_OUTER_GLOW_RADIUS_SCALE = 1.1;
const FLAME_OUTER_GLOW_ALPHA_SHARE = 0.5;
const FLAME_INNER_GLOW_RADIUS_SCALE = 0.9;
const FLAME_INNER_GLOW_ALPHA_SHARE = 0.45;
const FLAME_TONGUE_REACH_SHARE = 0.85;
const FLAME_TONGUE_CLOCK_SPEED_MIN = 0.12;
const FLAME_TONGUE_CLOCK_SPEED_MAX = 0.25;
const FLAME_TONGUE_HEIGHT_BASE_SHARE = 0.75;
const FLAME_TONGUE_HEIGHT_BOB_SHARE = 0.35;
/** The sway cycles more slowly than the height bob, so a tongue doesn't lean and grow in lockstep. */
const FLAME_TONGUE_SWAY_SPEED_SHARE = 0.7;
const FLAME_TONGUE_SWAY_REACH_SHARE = 0.12;
const FLAME_TONGUE_WIDTH_SHARE = 0.2;
/** A tongue's outline pinches to this share of its base width partway up, giving it a waisted teardrop shape. */
const TONGUE_WAIST_HEIGHT_SHARE = 0.6;
const TONGUE_INNER_LAYER_SCALE = 0.7;
const TONGUE_CORE_LAYER_SCALE = 0.4;
const TONGUE_OUTER_ALPHA_SHARE = 0.85;
const TONGUE_INNER_ALPHA_SHARE = 0.8;
const TONGUE_CORE_ALPHA_SHARE = 0.8;

/**
 * The fire fairy's death flame: a ring of ground fire licking up across
 * `radiusPx`, strongest as it lands and guttering as `lifeProgress` (0 → 1)
 * runs out. The danger circle for the explosion that follows is drawn apart.
 */
export function drawFlamePatch(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  lifeProgress: number,
  frame: number,
  seed: number,
): void {
  const alpha = envelope(lifeProgress, FLAME_FADE_IN_SHARE, FLAME_FADE_OUT_SHARE);
  if (alpha <= 0) return;
  ctx.save();
  groundEllipse(ctx, cx, cy, radiusPx);
  ctx.fillStyle = rgba(SOOT, FLAME_SCORCH_ALPHA_SHARE * alpha);
  ctx.fill();
  drawGlow(
    ctx,
    FIRE_DEEP,
    cx,
    cy,
    radiusPx * FLAME_OUTER_GLOW_RADIUS_SCALE,
    FLAME_OUTER_GLOW_ALPHA_SHARE * alpha,
  );
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    FIRE_RED,
    cx,
    cy,
    radiusPx * FLAME_INNER_GLOW_RADIUS_SCALE,
    FLAME_INNER_GLOW_ALPHA_SHARE * alpha,
  );
  ctx.globalCompositeOperation = 'source-over';
  // Tongues: each a teardrop of fire rooted on the patch, swaying and
  // re-lengthening on its own clock so the patch never pulses in unison.
  for (let i = 0; i < FLAME_TONGUES; i++) {
    const angle = hash01(key(seed, i)) * TAU;
    const reach = Math.sqrt(hash01(key(seed, i, 1))) * radiusPx * FLAME_TONGUE_REACH_SHARE;
    const baseX = cx + Math.cos(angle) * reach;
    const baseY = cy + Math.sin(angle) * reach * GROUND_SQUASH;
    const clock =
      frame *
        hashRange(key(seed, i, 2), FLAME_TONGUE_CLOCK_SPEED_MIN, FLAME_TONGUE_CLOCK_SPEED_MAX) +
      hash01(key(seed, i, 3)) * TAU;
    const height =
      radiusPx *
      (FLAME_TONGUE_HEIGHT_BASE_SHARE + FLAME_TONGUE_HEIGHT_BOB_SHARE * Math.sin(clock)) *
      alpha;
    const sway =
      Math.sin(clock * FLAME_TONGUE_SWAY_SPEED_SHARE) * radiusPx * FLAME_TONGUE_SWAY_REACH_SHARE;
    const width = radiusPx * FLAME_TONGUE_WIDTH_SHARE;
    drawTongue(ctx, baseX, baseY, width, height, sway, alpha);
  }
  ctx.restore();
}

function drawTongue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  sway: number,
  alpha: number,
): void {
  if (height <= 0) return;
  const shape = (scale: number) => {
    ctx.beginPath();
    ctx.moveTo(x - width * scale, y);
    ctx.quadraticCurveTo(
      x - width * scale,
      y - height * scale * TONGUE_WAIST_HEIGHT_SHARE,
      x + sway,
      y - height * scale,
    );
    ctx.quadraticCurveTo(
      x + width * scale,
      y - height * scale * TONGUE_WAIST_HEIGHT_SHARE,
      x + width * scale,
      y,
    );
    ctx.closePath();
  };
  shape(1);
  ctx.fillStyle = rgba(FIRE_RED, TONGUE_OUTER_ALPHA_SHARE * alpha);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  shape(TONGUE_INNER_LAYER_SCALE);
  ctx.fillStyle = rgba(FIRE_ORANGE, TONGUE_INNER_ALPHA_SHARE * alpha);
  ctx.fill();
  shape(TONGUE_CORE_LAYER_SCALE);
  ctx.fillStyle = rgba(FIRE_GOLD, TONGUE_CORE_ALPHA_SHARE * alpha);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

const EXPLOSION_DEBRIS = 16;
const EXPLOSION_SMOKE_PUFFS = 7;
/** The swell runs ahead of `progress` so the fireball is already near full size early on. */
const EXPLOSION_SWELL_RATE = 1.6;
const EXPLOSION_SCORCH_RADIUS_SHARE = 0.8;
const EXPLOSION_SCORCH_ALPHA_SHARE = 0.4;
const EXPLOSION_SMOKE_SPREAD_SHARE = 0.5;
const EXPLOSION_SMOKE_RISE_SHARE = 0.6;
const EXPLOSION_SMOKE_RADIUS_BASE_SHARE = 0.35;
const EXPLOSION_SMOKE_RADIUS_GROWTH_SHARE = 0.4;
const EXPLOSION_SMOKE_ALPHA_SHARE = 0.55;
const EXPLOSION_SMOKE_FADE_IN_SHARE = 0.2;
const EXPLOSION_SMOKE_FADE_OUT_SHARE = 0.6;
/** Share of the animation the fireball itself stays lit before the smoke takes over. */
const EXPLOSION_FIREBALL_FADE_OUT_SHARE = 0.65;
const EXPLOSION_FIREBALL_LIFT_SHARE = 0.15;
const EXPLOSION_FIREBALL_CORONA_SHARE = 0.7;
/** How many times faster than `progress` the opening flash burns out. */
const EXPLOSION_FLASH_RATE = 5;
const EXPLOSION_FLASH_RADIUS_SHARE = 1.1;
/** The shockwave's own radius runs ahead of `progress`, so it visibly outruns the fireball. */
const EXPLOSION_SHOCKWAVE_RATE = 1.3;
const EXPLOSION_SHOCKWAVE_WIDTH_PX = 3;
const EXPLOSION_SHOCKWAVE_ALPHA_SHARE = 0.8;
const EXPLOSION_DEBRIS_SPEED_MIN = 0.7;
const EXPLOSION_DEBRIS_SPEED_MAX = 1.25;
const EXPLOSION_DEBRIS_ARC_HEIGHT_SHARE = 0.35;
const EXPLOSION_DEBRIS_RADIUS_PX = 1.8;
/** Every third piece of debris is a hot white core instead of plain ember-orange. */
const EXPLOSION_DEBRIS_CORE_EVERY = 3;

/**
 * An explosion over `radiusPx`: a white flash, a fireball swelling out and
 * rolling up into smoke, a shockwave ring racing past it and burning debris.
 * `progress` runs 0 → 1 across the whole animation.
 */
export function drawExplosion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  progress: number,
  seed: number,
): void {
  const p = clamp01(progress);
  if (p >= 1) return;
  const swell = easeOutCubic(p * EXPLOSION_SWELL_RATE);
  ctx.save();
  // Scorch left on the floor.
  groundEllipse(ctx, cx, cy, radiusPx * EXPLOSION_SCORCH_RADIUS_SHARE);
  ctx.fillStyle = rgba(SOOT, EXPLOSION_SCORCH_ALPHA_SHARE * (1 - p));
  ctx.fill();
  // Smoke billowing up and out, darkening as the fire goes out of it.
  for (let i = 0; i < EXPLOSION_SMOKE_PUFFS; i++) {
    const angle = hash01(key(seed, i)) * TAU;
    const r = radiusPx * EXPLOSION_SMOKE_SPREAD_SHARE * swell * hash01(key(seed, i, 1));
    const rise = radiusPx * EXPLOSION_SMOKE_RISE_SHARE * p;
    drawGlow(
      ctx,
      SMOKE,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r * GROUND_SQUASH - rise,
      radiusPx * (EXPLOSION_SMOKE_RADIUS_BASE_SHARE + EXPLOSION_SMOKE_RADIUS_GROWTH_SHARE * p),
      EXPLOSION_SMOKE_ALPHA_SHARE *
        envelope(p, EXPLOSION_SMOKE_FADE_IN_SHARE, EXPLOSION_SMOKE_FADE_OUT_SHARE),
    );
  }
  // The fireball.
  const fireAlpha = envelope(p, 0, EXPLOSION_FIREBALL_FADE_OUT_SHARE);
  const fireballY = cy - radiusPx * EXPLOSION_FIREBALL_LIFT_SHARE * p;
  drawEmbermote(ctx, FIRE_RED, FIRE_ORANGE, cx, fireballY, radiusPx * swell, fireAlpha);
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    FIRE_GOLD,
    cx,
    fireballY,
    radiusPx * EXPLOSION_FIREBALL_CORONA_SHARE * swell,
    fireAlpha,
  );
  // The first frames' flash.
  const flash = clamp01(1 - p * EXPLOSION_FLASH_RATE);
  drawGlow(ctx, FIRE_CORE, cx, cy, radiusPx * EXPLOSION_FLASH_RADIUS_SHARE, flash);
  // Shockwave.
  const ring = easeOutCubic(p * EXPLOSION_SHOCKWAVE_RATE);
  ctx.lineWidth = EXPLOSION_SHOCKWAVE_WIDTH_PX * (1 - p);
  ctx.strokeStyle = rgba(FIRE_GOLD, EXPLOSION_SHOCKWAVE_ALPHA_SHARE * (1 - ring));
  groundEllipse(ctx, cx, cy, radiusPx * ring);
  ctx.stroke();
  // Burning debris thrown out along low arcs.
  for (let i = 0; i < EXPLOSION_DEBRIS; i++) {
    const angle = hash01(key(seed, i, 2)) * TAU;
    const speed = hashRange(
      key(seed, i, 3),
      EXPLOSION_DEBRIS_SPEED_MIN,
      EXPLOSION_DEBRIS_SPEED_MAX,
    );
    const r = radiusPx * speed * easeOutCubic(p);
    const arc = Math.sin(p * Math.PI) * radiusPx * EXPLOSION_DEBRIS_ARC_HEIGHT_SHARE * speed;
    drawGlow(
      ctx,
      i % EXPLOSION_DEBRIS_CORE_EVERY === 0 ? FIRE_CORE : FIRE_ORANGE,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r * GROUND_SQUASH - arc,
      EXPLOSION_DEBRIS_RADIUS_PX,
      1 - p,
    );
  }
  ctx.restore();
}

// ── Necromancer: wisps, the resurrection column, the telekinetic ring ────────

const WISP_COUNT = 9;
const WISP_RISE_SPEED = 0.018;
const WISP_POOL_RADIUS_TILE_SHARE = 0.55;
const WISP_POOL_RADIUS_BASE_SHARE = 0.6;
const WISP_POOL_RADIUS_STRENGTH_SHARE = 0.4;
const WISP_POOL_FILL_ALPHA_SHARE = 0.45;
const WISP_POOL_EDGE_WIDTH_PX = 1;
const WISP_POOL_EDGE_ALPHA_SHARE = 0.5;
/** At minimum strength, this share of the full wisp count still shows. */
const WISP_VISIBLE_COUNT_FLOOR_SHARE = 0.4;
const WISP_VISIBLE_COUNT_STRENGTH_SHARE = 0.6;
const WISP_RISE_SPEED_JITTER_MIN = 0.7;
const WISP_RISE_SPEED_JITTER_MAX = 1.3;
const WISP_START_RADIUS_TILE_SHARE = 0.4;
/** How many times a wisp curls as it rises, and how far it swings from its own straight line. */
const WISP_CURL_CYCLES = 1.5;
const WISP_CURL_REACH_TILE_SHARE = 0.12;
const WISP_RISE_HEIGHT_TILE_SHARE = 1.1;
const WISP_SHADOW_LIFT_PX = 1;
const WISP_SHADOW_RADIUS_TILE_SHARE = 0.1;
const WISP_SHADOW_ALPHA_SHARE = 0.5;
const WISP_BODY_RADIUS_TILE_SHARE = 0.09;

/**
 * Violet-green wisps curling up out of the ground at (`cx`, `cy`): the
 * necromancer's working, over a corpse it is raising or the ground a skeleton
 * is about to climb out of. `intensity` (0–1) sets how many and how bright.
 */
export function drawNecroWisps(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tileSize: number,
  intensity: number,
  frame: number,
  seed: number,
): void {
  const strength = clamp01(intensity);
  if (strength <= 0) return;
  ctx.save();
  groundEllipse(
    ctx,
    cx,
    cy,
    tileSize *
      WISP_POOL_RADIUS_TILE_SHARE *
      (WISP_POOL_RADIUS_BASE_SHARE + WISP_POOL_RADIUS_STRENGTH_SHARE * strength),
  );
  ctx.fillStyle = rgba(NECRO_DARK, WISP_POOL_FILL_ALPHA_SHARE * strength);
  ctx.fill();
  ctx.lineWidth = WISP_POOL_EDGE_WIDTH_PX;
  ctx.strokeStyle = rgba(NECRO_VIOLET, WISP_POOL_EDGE_ALPHA_SHARE * strength);
  ctx.stroke();
  const visible = Math.ceil(
    WISP_COUNT * (WISP_VISIBLE_COUNT_FLOOR_SHARE + WISP_VISIBLE_COUNT_STRENGTH_SHARE * strength),
  );
  for (let i = 0; i < visible; i++) {
    const raw =
      frame *
        WISP_RISE_SPEED *
        hashRange(key(seed, i), WISP_RISE_SPEED_JITTER_MIN, WISP_RISE_SPEED_JITTER_MAX) +
      hash01(key(seed, i, 1));
    const life = raw - Math.floor(raw);
    const startAngle = hash01(key(seed, i, 2)) * TAU;
    const startR = tileSize * WISP_START_RADIUS_TILE_SHARE * hash01(key(seed, i, 3));
    const curl =
      Math.sin(life * TAU * WISP_CURL_CYCLES + i) * tileSize * WISP_CURL_REACH_TILE_SHARE;
    const x = cx + Math.cos(startAngle) * startR * (1 - life * HALF) + curl;
    const y =
      cy +
      Math.sin(startAngle) * startR * GROUND_SQUASH -
      life * tileSize * WISP_RISE_HEIGHT_TILE_SHARE;
    const fade = Math.sin(life * Math.PI) * strength;
    const color = i % 2 === 0 ? NECRO_VIOLET : NECRO_GREEN;
    drawGlow(
      ctx,
      NECRO_DARK,
      x,
      y + WISP_SHADOW_LIFT_PX,
      tileSize * WISP_SHADOW_RADIUS_TILE_SHARE * (1 + life),
      fade * WISP_SHADOW_ALPHA_SHARE,
    );
    drawEmbermote(
      ctx,
      color,
      NECRO_PALE,
      x,
      y,
      tileSize * WISP_BODY_RADIUS_TILE_SHARE * (1 + life),
      fade,
    );
  }
  ctx.restore();
}

const COLUMN_FADE_IN_SHARE = 0.08;
const COLUMN_FADE_OUT_SHARE = 0.5;
const COLUMN_HEIGHT_TILE_SHARE = 1.8;
const COLUMN_HALF_WIDTH_TILE_SHARE = 0.55;
const COLUMN_GRADIENT_BASE_ALPHA_SHARE = 0.55;
const COLUMN_GRADIENT_MID_STOP = 0.5;
const COLUMN_GRADIENT_MID_ALPHA_SHARE = 0.4;
/** How far the column's silhouette waists inward, and how high, as shares of its own half-width and height. */
const COLUMN_WAIST_WIDTH_SHARE = 0.4;
const COLUMN_WAIST_HEIGHT_SHARE = 0.5;
const COLUMN_NECK_WIDTH_SHARE = 0.15;
const COLUMN_CROWN_GLOW_HEIGHT_TILE_SHARE = 0.3;
const COLUMN_CROWN_GLOW_RADIUS_TILE_SHARE = 0.6;
const COLUMN_CROWN_GLOW_ALPHA_SHARE = 0.4;

/**
 * The column a resurrected mob stands up in: a pillar of dark wisps and violet
 * light rising from where it fell, strongest as the rise begins and thinning to
 * nothing as `progress` (0 → 1 across the rise) completes.
 */
export function drawResurrectionColumn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  tileSize: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const alpha = envelope(progress, COLUMN_FADE_IN_SHARE, COLUMN_FADE_OUT_SHARE);
  if (alpha <= 0) return;
  const height = tileSize * COLUMN_HEIGHT_TILE_SHARE;
  const width = tileSize * COLUMN_HALF_WIDTH_TILE_SHARE;
  ctx.save();
  const gradient = ctx.createLinearGradient(cx, footY, cx, footY - height);
  gradient.addColorStop(0, rgba(NECRO_VIOLET, COLUMN_GRADIENT_BASE_ALPHA_SHARE * alpha));
  gradient.addColorStop(
    COLUMN_GRADIENT_MID_STOP,
    rgba(NECRO_DARK, COLUMN_GRADIENT_MID_ALPHA_SHARE * alpha),
  );
  gradient.addColorStop(1, rgba(NECRO_DARK, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cx - width, footY);
  ctx.quadraticCurveTo(
    cx - width * COLUMN_WAIST_WIDTH_SHARE,
    footY - height * COLUMN_WAIST_HEIGHT_SHARE,
    cx - width * COLUMN_NECK_WIDTH_SHARE,
    footY - height,
  );
  ctx.lineTo(cx + width * COLUMN_NECK_WIDTH_SHARE, footY - height);
  ctx.quadraticCurveTo(
    cx + width * COLUMN_WAIST_WIDTH_SHARE,
    footY - height * COLUMN_WAIST_HEIGHT_SHARE,
    cx + width,
    footY,
  );
  ctx.closePath();
  ctx.fill();
  drawNecroWisps(ctx, cx, footY, tileSize, alpha, frame, seed);
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(
    ctx,
    NECRO_GREEN,
    cx,
    footY - tileSize * COLUMN_CROWN_GLOW_HEIGHT_TILE_SHARE,
    tileSize * COLUMN_CROWN_GLOW_RADIUS_TILE_SHARE,
    alpha * COLUMN_CROWN_GLOW_ALPHA_SHARE,
  );
  ctx.restore();
}

/** Which half of the telekinetic wave is being drawn. */
export type TelekineticPhase = 'gather' | 'burst';

/**
 * The necromancer's shove. While it gathers, a dark ring contracts from
 * `radiusPx` onto the fairy with motes sucked in behind it; on release it
 * bursts outward as a distortion ring. `progress` is 0 → 1 through each phase.
 */
const TK_GATHER_RADIUS_CONTRACT_SHARE = 0.85;
const TK_GATHER_ALPHA_BASE = 0.35;
const TK_GATHER_ALPHA_SHARE = 0.55;
const TK_GATHER_HALO_WIDTH_BASE_PX = 2;
const TK_GATHER_HALO_WIDTH_SHARE_PX = 3;
const TK_GATHER_BODY_WIDTH_PX = 1;
const TK_GATHER_MOTE_ORBIT_SPEED = 0.04;
const TK_GATHER_MOTE_INWARD_SPEED = 0.05;
const TK_GATHER_MOTE_RADIUS_PX = 2;
const TK_GATHER_CORE_RADIUS_SHARE = 0.3;
const TK_GATHER_CORE_RADIUS_FLOOR_SHARE = 0.5;
const TK_BURST_HALO_WIDTH_SCALE = 6;
const TK_BURST_HALO_ALPHA_SHARE = 0.6;
const TK_BURST_BODY_WIDTH_SCALE = 2.5;
const TK_BURST_RIM_WIDTH_PX = 1;
/** The pale inner rim trails just inside the burst's own leading edge. */
const TK_BURST_RIM_RADIUS_SHARE = 0.92;
const TK_BURST_CORE_RADIUS_SHARE = 0.5;
const TK_BURST_CORE_ALPHA_SHARE = 0.5;

export function drawTelekineticRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  phase: TelekineticPhase,
  progress: number,
  frame: number,
  seed: number,
): void {
  const p = clamp01(progress);
  ctx.save();
  if (phase === 'gather') {
    const radius = radiusPx * (1 - easeOutCubic(p) * TK_GATHER_RADIUS_CONTRACT_SHARE);
    const alpha = TK_GATHER_ALPHA_BASE + TK_GATHER_ALPHA_SHARE * p;
    ctx.lineWidth = TK_GATHER_HALO_WIDTH_BASE_PX + TK_GATHER_HALO_WIDTH_SHARE_PX * p;
    ctx.strokeStyle = rgba(NECRO_DARK, alpha);
    groundEllipse(ctx, cx, cy, radius);
    ctx.stroke();
    ctx.lineWidth = TK_GATHER_BODY_WIDTH_PX;
    ctx.strokeStyle = rgba(NECRO_VIOLET, alpha);
    groundEllipse(ctx, cx, cy, radius);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < WISP_COUNT; i++) {
      const angle = (i / WISP_COUNT) * TAU + frame * TK_GATHER_MOTE_ORBIT_SPEED;
      const raw = frame * TK_GATHER_MOTE_INWARD_SPEED + hash01(key(seed, i));
      const life = raw - Math.floor(raw);
      const r = radiusPx * (1 - life);
      drawGlow(
        ctx,
        NECRO_GREEN,
        cx + Math.cos(angle) * r,
        cy + Math.sin(angle) * r * GROUND_SQUASH,
        TK_GATHER_MOTE_RADIUS_PX,
        life * p,
      );
    }
    drawGlow(
      ctx,
      NECRO_VIOLET,
      cx,
      cy,
      radiusPx * TK_GATHER_CORE_RADIUS_SHARE * (TK_GATHER_CORE_RADIUS_FLOOR_SHARE + p),
      p,
    );
  } else {
    const radius = radiusPx * easeOutCubic(p);
    const alpha = 1 - p;
    ctx.lineWidth = TK_BURST_HALO_WIDTH_SCALE * alpha;
    ctx.strokeStyle = rgba(NECRO_DARK, TK_BURST_HALO_ALPHA_SHARE * alpha);
    groundEllipse(ctx, cx, cy, radius);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = TK_BURST_BODY_WIDTH_SCALE * alpha;
    ctx.strokeStyle = rgba(NECRO_VIOLET, alpha);
    groundEllipse(ctx, cx, cy, radius);
    ctx.stroke();
    ctx.lineWidth = TK_BURST_RIM_WIDTH_PX;
    ctx.strokeStyle = rgba(NECRO_PALE, alpha);
    groundEllipse(ctx, cx, cy, radius * TK_BURST_RIM_RADIUS_SHARE);
    ctx.stroke();
    drawGlow(
      ctx,
      NECRO_VIOLET,
      cx,
      cy,
      radiusPx * TK_BURST_CORE_RADIUS_SHARE,
      alpha * TK_BURST_CORE_ALPHA_SHARE,
    );
  }
  ctx.restore();
}

/**
 * The shroud a resurrected mob stands up out of, drawn over it: dark smoke
 * covering the body that drains back into the ground as `progress` (0 → 1
 * across the rise) completes, head first, with a violet seam where it is
 * letting go. The mob reads as fading in from the dark rather than popping back.
 */
const VEIL_FULL_HEIGHT_TILE_SHARE = 1.15;
const VEIL_HALF_WIDTH_TILE_SHARE = 0.55;
/** Where the veil's own mid-fade sits along its top-to-bottom gradient. */
const VEIL_GRADIENT_MID_STOP = 0.25;
const VEIL_GRADIENT_MID_ALPHA_SHARE = 0.75;
const VEIL_GRADIENT_MID_ALPHA_FLOOR = 0.15;
const VEIL_GRADIENT_BOTTOM_ALPHA = 0.9;
/** The hem is traced as this many lobes billowing in and out, like smoke curling under itself. */
const VEIL_HEM_LOBES = 5;
const VEIL_BILLOW_SPEED = 0.15;
/** Offsets each lobe's billow phase from its neighbours', so they don't all curl in unison. */
const VEIL_BILLOW_PHASE_STRIDE = 1.9;
const VEIL_BILLOW_REACH_TILE_SHARE = 0.06;
const VEIL_HEM_ARCH_SHARE = 0.35;
const VEIL_SEAM_ALPHA_SHARE = 0.7;
const VEIL_SEAM_WIDTH_PX = 1.5;
/** The seam sits inset from the veil's own edges and bows up from the hem. */
const VEIL_SEAM_HALF_WIDTH_SHARE = 0.8;
const VEIL_SEAM_HEM_OFFSET_SHARE = 0.12;
const VEIL_SEAM_BOW_TILE_SHARE = 0.05;
const VEIL_SPARK_COUNT = 4;
/** Sparks hold their position for four frames at a time rather than jittering every frame. */
const VEIL_SPARK_HOLD_FRAME_SHIFT = 2;
const VEIL_SPARK_HEIGHT_SHARE = 0.1;
const VEIL_SPARK_RADIUS_PX = 2;

export function drawResurrectionVeil(
  ctx: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  tileSize: number,
  progress: number,
  frame: number,
  seed: number,
): void {
  const remaining = 1 - clamp01(progress);
  if (remaining <= 0) return;
  const fullHeight = tileSize * VEIL_FULL_HEIGHT_TILE_SHARE;
  const height = fullHeight * remaining;
  const halfWidth = tileSize * VEIL_HALF_WIDTH_TILE_SHARE;
  const topY = footY - height;
  ctx.save();
  const gradient = ctx.createLinearGradient(cx, topY, cx, footY);
  gradient.addColorStop(0, rgba(NECRO_DARK, 0));
  gradient.addColorStop(
    VEIL_GRADIENT_MID_STOP,
    rgba(NECRO_DARK, VEIL_GRADIENT_MID_ALPHA_SHARE * remaining + VEIL_GRADIENT_MID_ALPHA_FLOOR),
  );
  gradient.addColorStop(1, rgba(NECRO_DARK, VEIL_GRADIENT_BOTTOM_ALPHA));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, footY);
  for (let i = 0; i <= VEIL_HEM_LOBES; i++) {
    const t = i / VEIL_HEM_LOBES;
    const x = cx - halfWidth + t * halfWidth * 2;
    const billow =
      Math.sin(frame * VEIL_BILLOW_SPEED + i * VEIL_BILLOW_PHASE_STRIDE + seed) *
      tileSize *
      VEIL_BILLOW_REACH_TILE_SHARE;
    const y = topY + Math.abs(t - HALF) * height * VEIL_HEM_ARCH_SHARE + billow;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(cx + halfWidth, footY);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(NECRO_VIOLET, VEIL_SEAM_ALPHA_SHARE * remaining);
  ctx.lineWidth = VEIL_SEAM_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(
    cx - halfWidth * VEIL_SEAM_HALF_WIDTH_SHARE,
    topY + height * VEIL_SEAM_HEM_OFFSET_SHARE,
  );
  ctx.quadraticCurveTo(
    cx,
    topY - tileSize * VEIL_SEAM_BOW_TILE_SHARE,
    cx + halfWidth * VEIL_SEAM_HALF_WIDTH_SHARE,
    topY + height * VEIL_SEAM_HEM_OFFSET_SHARE,
  );
  ctx.stroke();
  for (let i = 0; i < VEIL_SPARK_COUNT; i++) {
    const x =
      cx + hashRange(key(seed, i, frame >> VEIL_SPARK_HOLD_FRAME_SHIFT), -halfWidth, halfWidth);
    drawGlow(
      ctx,
      NECRO_GREEN,
      x,
      topY + height * VEIL_SPARK_HEIGHT_SHARE,
      VEIL_SPARK_RADIUS_PX,
      remaining,
    );
  }
  ctx.restore();
}
