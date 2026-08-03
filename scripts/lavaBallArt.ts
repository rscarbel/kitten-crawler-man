/**
 * The painter library behind the Lava Llama's projectile sheets.
 *
 * Three effects share this file because they share a material. What makes
 * something read as molten rock rather than as a fireball is that it is *rock
 * first*: a dark basalt crust that has chilled on the outside, broken into
 * plates, with the incandescent interior showing through the cracks between
 * them. A ball of pure orange is a fireball; a dark ball with hot seams is
 * lava, and every layer here exists to serve that read.
 *
 *   bolt   — the ball in flight, rotated to its heading by the runtime
 *   burst  — the mini explosion where it lands
 *   flame  — the fire patch it leaves behind, looping
 *
 * Coordinates are tile units with the origin at the effect's anchor and +Y
 * pointing down the screen. The bolt is drawn travelling along +X.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

export const TWO_PI = Math.PI * 2;
/** Radii below this are degenerate; canvas rejects a negative arc or gradient. */
const MIN_RADIUS = 1e-4;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
export function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

const ALPHA_PRECISION = 4;

/**
 * `rgba()` with the alpha rounded.
 *
 * A computed alpha can come out vanishingly small, and `String(5e-17)` is
 * exponent notation that node-canvas cannot parse — it drops the whole colour
 * and the shape bakes as an opaque smear.
 */
function rgba(r: number, g: number, b: number, alpha: number): string {
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${r},${g},${b},${safe})`;
}

// ── The material ─────────────────────────────────────────────────────────────

/** Chilled crust, darkest where it has been exposed longest. */
const CRUST_COLD = '#1c1512';
const CRUST_WARM = '#3d2620';
/** The incandescent interior, from the coolest visible red to white heat. */
const MELT_DULL = '#8f1f06';
const MELT_MID = '#e0510a';
const MELT_HOT = '#ffa726';
const MELT_WHITE = '#fff3c4';

const HALO_RGB: readonly [number, number, number] = [255, 132, 40];
const SPARK_RGB: readonly [number, number, number] = [255, 214, 150];
const SMOKE_RGB: readonly [number, number, number] = [58, 48, 44];

/**
 * The soft heat bloom every hot thing here sits inside.
 *
 * Drawn as its own layer rather than baked into each shape: the bloom is what
 * makes a 6 px ball legible against a dark dungeon floor, and it has to extend
 * well past the object's own silhouette to do that.
 */
function drawHeatHalo(ctx: Ctx, cx: number, cy: number, radius: number, strength: number): void {
  if (radius <= MIN_RADIUS || strength <= 0) return;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const [r, g, b] = HALO_RGB;
  gradient.addColorStop(0, rgba(r, g, b, 0.55 * strength));
  gradient.addColorStop(0.45, rgba(r, g, b, 0.22 * strength));
  gradient.addColorStop(1, rgba(r, g, b, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
}

/**
 * A closed, irregular blob — the shape a chilled crust plate actually breaks
 * into, and the shape a puff of smoke rolls into.
 *
 * Laid through quadratic curves rather than straight segments: at the sample
 * counts these effects can afford, a polyline blob bakes as a visibly faceted
 * shard, which reads as a chunk of debris no matter what colour it is painted.
 */
function blobPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  roughness: number,
  steps = 18,
): void {
  const pointAt = (i: number): readonly [number, number] => {
    const angle = ((i % steps) / steps) * TWO_PI;
    const wobble =
      1 + roughness * (Math.sin(angle * 3 + seed) * 0.6 + Math.sin(angle * 7 - seed * 1.9) * 0.4);
    return [cx + Math.cos(angle) * radius * wobble, cy + Math.sin(angle) * radius * wobble];
  };
  const [firstX, firstY] = pointAt(0);
  const [lastX, lastY] = pointAt(steps - 1);
  ctx.beginPath();
  ctx.moveTo((lastX + firstX) / 2, (lastY + firstY) / 2);
  for (let i = 0; i < steps; i++) {
    const [cxp, cyp] = pointAt(i);
    const [nx, ny] = pointAt(i + 1);
    ctx.quadraticCurveTo(cxp, cyp, (cxp + nx) / 2, (cyp + ny) / 2);
  }
  ctx.closePath();
}

// ── Bolt ─────────────────────────────────────────────────────────────────────

/** Radius of the ball itself, in tile units. */
export const BOLT_RADIUS = 0.16;
/** How far the ember trail streams behind it, in tile units. */
const TRAIL_LENGTH = 0.55;
const TRAIL_PUFFS = 7;
const CRUST_PLATES = 6;
const CRACK_COUNT = 5;
const DRIP_COUNT = 3;

/**
 * The ball in flight, travelling along +X with its trail behind it.
 *
 * `phase` runs 0–1 over the loop and only churns the surface: the ball must not
 * pulse in size, because the runtime rotates this sprite to the heading and a
 * size beat then reads as the projectile stuttering rather than as it burning.
 */
export function drawLavaBolt(ctx: Ctx, phase: number): void {
  const spin = phase * TWO_PI;

  // Smoke and embers first, so the ball itself sits in front of its own wake.
  for (let i = 0; i < TRAIL_PUFFS; i++) {
    const t = (i + 1) / TRAIL_PUFFS;
    const drift = Math.sin(spin + i * 1.3) * 0.02 * t;
    const px = -TRAIL_LENGTH * t;
    const py = drift;
    const radius = BOLT_RADIUS * (0.95 - 0.5 * t);
    if (radius <= MIN_RADIUS) continue;
    const [sr, sg, sb] = SMOKE_RGB;
    ctx.fillStyle = rgba(sr, sg, sb, 0.55 * (1 - t));
    blobPath(ctx, px, py, radius * 1.35, i * 3.7 + spin, 0.3, 12);
    ctx.fill();
    // The embers in the wake are the part that says the trail is hot rather
    // than just dirty, so they stay bright well past where the smoke has faded.
    const [er, eg, eb] = HALO_RGB;
    ctx.fillStyle = rgba(er, eg, eb, 0.8 * (1 - t * 0.75));
    blobPath(ctx, px, py, radius * 0.62, i * 5.1 - spin, 0.35, 10);
    ctx.fill();
  }

  drawHeatHalo(ctx, 0, 0, BOLT_RADIUS * 3.1, 1);

  // The molten interior. Painted as a full disc first: every crust plate above
  // it is a hole punched in this, so anything it fails to cover shows as a gap
  // in the ball rather than as a seam of light.
  const melt = ctx.createRadialGradient(
    -BOLT_RADIUS * 0.2,
    -BOLT_RADIUS * 0.2,
    0,
    0,
    0,
    BOLT_RADIUS,
  );
  melt.addColorStop(0, MELT_WHITE);
  melt.addColorStop(0.35, MELT_HOT);
  melt.addColorStop(0.75, MELT_MID);
  melt.addColorStop(1, MELT_DULL);
  ctx.fillStyle = melt;
  ctx.beginPath();
  ctx.arc(0, 0, BOLT_RADIUS, 0, TWO_PI);
  ctx.fill();

  // Crust plates: dark islands that drift over the melt as the ball tumbles.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, BOLT_RADIUS, 0, TWO_PI);
  ctx.clip();
  for (let i = 0; i < CRUST_PLATES; i++) {
    const orbit = spin + (i / CRUST_PLATES) * TWO_PI;
    const distance = BOLT_RADIUS * (0.2 + hash1(i * 2.3) * 0.55);
    const px = Math.cos(orbit) * distance;
    const py = Math.sin(orbit * 1.1 + i) * distance * 0.8;
    const radius = BOLT_RADIUS * (0.3 + hash1(i * 5.9) * 0.22);
    ctx.fillStyle = i % 2 === 0 ? CRUST_COLD : CRUST_WARM;
    blobPath(ctx, px, py, radius, i * 4.4 + spin * 0.4, 0.32, 14);
    ctx.fill();
  }
  // A hot rim inside the silhouette — the edge of a molten body glows brightest
  // where it is thinnest, and without it the crust reads as a lump of coal.
  ctx.strokeStyle = rgba(255, 176, 74, 0.85);
  ctx.lineWidth = BOLT_RADIUS * 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, BOLT_RADIUS * 0.95, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();

  // Cracks: short bright seams laid over the plates.
  ctx.lineCap = 'round';
  for (let i = 0; i < CRACK_COUNT; i++) {
    const angle = spin * 0.6 + (i / CRACK_COUNT) * TWO_PI + hash1(i * 2.7) * 1.1;
    const inner = BOLT_RADIUS * (0.12 + hash1(i * 3.5) * 0.2);
    const outer = BOLT_RADIUS * (0.6 + hash1(i * 7.1) * 0.3);
    ctx.strokeStyle = rgba(255, 236, 180, 0.8);
    ctx.lineWidth = BOLT_RADIUS * 0.11;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle + 0.35) * outer, Math.sin(angle + 0.35) * outer);
    ctx.stroke();
  }

  // Molten drips shedding off the underside, which is what stops the ball
  // reading as a solid pellet with a texture painted on it.
  for (let i = 0; i < DRIP_COUNT; i++) {
    const t = (i + phase) % 1;
    const px = -BOLT_RADIUS * (0.2 + t * 0.9);
    const py = BOLT_RADIUS * (0.5 + t * 1.1);
    const radius = BOLT_RADIUS * 0.22 * (1 - t);
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(255, 150, 50, 1 - t);
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Burst ────────────────────────────────────────────────────────────────────

/** How far the shockwave ring reaches at the end of the burst, in tile units. */
export const BURST_REACH = 0.62;
const BURST_GOBS = 9;
const BURST_SMOKE_PUFFS = 6;

/**
 * The mini explosion where a bolt lands. `progress` runs 0 at the impact frame
 * to 1 at the last.
 *
 * The order matters more than any single layer: scorch, then smoke, then the
 * fireball, then the flung gobs, then the ring. Put the ring under the smoke
 * and the blast reads as a puff with a circle drawn on it.
 */
export function drawLavaBurst(ctx: Ctx, progress: number): void {
  const t = clamp01(progress);
  const out = easeOut(t);
  const fade = 1 - t;

  // The scorch stays put and outlives the fire, which is what makes the impact
  // feel like it happened *to the floor* rather than in the air above it.
  const scorchRadius = BURST_REACH * 0.5 * easeOut(Math.min(1, t * 3));
  if (scorchRadius > MIN_RADIUS) {
    ctx.fillStyle = rgba(24, 18, 16, 0.5);
    blobPath(ctx, 0, BURST_REACH * 0.08, scorchRadius, 3.1, 0.24, 20);
    ctx.fill();
  }

  // Smoke ramps in and thins out rather than being at full strength from the
  // first frame. Drawn dark and large behind an as-yet-small fireball, it turns
  // the whole burst into a brown mound with a fire painted in the middle of it —
  // the explosion has to be *bright* before it is ever dirty.
  const soot = Math.sin(clamp01(t * 1.15) * Math.PI) * 0.55;
  for (let i = 0; i < BURST_SMOKE_PUFFS; i++) {
    const angle = (i / BURST_SMOKE_PUFFS) * TWO_PI + 0.4;
    const distance = BURST_REACH * out * (0.75 + hash1(i * 3.3) * 0.6);
    const radius = BURST_REACH * (0.1 + out * 0.2) * (0.7 + hash1(i * 8.8) * 0.6);
    if (radius <= MIN_RADIUS) continue;
    const [sr, sg, sb] = SMOKE_RGB;
    ctx.fillStyle = rgba(sr, sg, sb, soot);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.7 - out * 0.16,
      radius,
      i * 2.7,
      0.3,
      14,
    );
    ctx.fill();
  }

  // The fireball opens near full size on the first frame and shrinks as it
  // burns out. An explosion that grows from nothing over ten frames reads as a
  // balloon inflating; the violence is all in the first two frames.
  const fireRadius = BURST_REACH * (0.72 - t * 0.3) * Math.min(1, 0.45 + t * 6);
  drawHeatHalo(ctx, 0, 0, fireRadius * 2.4, fade);
  if (fireRadius > MIN_RADIUS) {
    const fire = ctx.createRadialGradient(0, 0, 0, 0, 0, fireRadius);
    fire.addColorStop(0, rgba(255, 250, 228, fade));
    fire.addColorStop(0.32, rgba(255, 206, 96, fade));
    fire.addColorStop(0.66, rgba(255, 122, 24, 0.92 * fade));
    fire.addColorStop(1, rgba(174, 48, 8, 0));
    ctx.fillStyle = fire;
    blobPath(ctx, 0, 0, fireRadius, 1.7 + t * 4, 0.22, 22);
    ctx.fill();
  }

  // Gobs of molten rock thrown clear on ballistic arcs. They are the reason the
  // blast reads as *lava* landing rather than as a generic fire puff.
  for (let i = 0; i < BURST_GOBS; i++) {
    const angle = (i / BURST_GOBS) * TWO_PI + hash1(i * 4.6);
    const speed = 0.6 + hash1(i * 9.2) * 0.5;
    const distance = BURST_REACH * out * speed;
    const arc = Math.sin(t * Math.PI) * BURST_REACH * 0.3 * (0.4 + hash1(i * 6.4));
    const radius = BURST_REACH * 0.085 * (1 - t * 0.7) * (0.6 + hash1(i * 1.9) * 0.8);
    if (radius <= MIN_RADIUS) continue;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance * 0.55 - arc;
    ctx.fillStyle = t < 0.5 ? MELT_WHITE : MELT_HOT;
    blobPath(ctx, px, py, radius, i * 3.9, 0.35, 10);
    ctx.fill();
    ctx.fillStyle = rgba(60, 34, 26, 0.55 * t);
    blobPath(ctx, px, py, radius * 0.5, i * 7.3, 0.3, 8);
    ctx.fill();
  }

  const ringRadius = BURST_REACH * out;
  if (ringRadius > MIN_RADIUS && fade > 0.02) {
    ctx.strokeStyle = rgba(255, 190, 96, 0.7 * fade * fade);
    ctx.lineWidth = BURST_REACH * 0.07 * fade;
    ctx.beginPath();
    ctx.ellipse(0, BURST_REACH * 0.06, ringRadius, ringRadius * 0.52, 0, 0, TWO_PI);
    ctx.stroke();
  }
}

// ── Lingering flame ──────────────────────────────────────────────────────────

/** Radius of the burning patch on the floor, in tile units. */
export const FLAME_RADIUS = 0.34;
/** How far the ground pool is squashed vertically to read as lying flat. */
const POOL_FLATTEN = 0.55;
const FLAME_TONGUES = 5;
const FLAME_EMBERS = 5;
const CRACK_SEAMS = 4;

/**
 * The fire left burning where a bolt landed, looping on `phase` (0–1).
 *
 * `intensity` scales the whole thing from 0 to 1 so the caller can fade the
 * patch in as it catches and out as it dies, rather than popping it.
 *
 * The pool of cooling lava on the floor is drawn even at low intensity: it is
 * the part that tells the player the tile is still dangerous once the flames
 * have shrunk, and a patch that is only flames reads as safe between licks.
 */
export function drawLavaFlame(ctx: Ctx, phase: number, intensity: number): void {
  const strength = clamp01(intensity);
  if (strength <= 0) return;
  const spin = phase * TWO_PI;

  // The pool is flattened hard and kept semi-transparent: it lies on a floor
  // seen from above, and a round opaque disc reads as a boulder sitting on the
  // tile rather than as scorched ground the player can walk onto.
  const poolRadius = FLAME_RADIUS * (0.75 + 0.25 * strength);
  ctx.fillStyle = rgba(30, 21, 18, 0.5 * strength);
  blobPath(ctx, 0, 0, poolRadius, 2.4, 0.26, 24);
  ctx.fill();
  ctx.save();
  ctx.scale(1, POOL_FLATTEN);
  ctx.fillStyle = rgba(46, 30, 24, 0.42 * strength);
  blobPath(ctx, 0, 0, poolRadius * 0.8, 5.9, 0.3, 20);
  ctx.fill();
  ctx.restore();

  // Glowing seams through the cooling crust — the same crack language as the
  // bolt, so the patch reads as the thing that landed rather than as scenery.
  // They stop short of the centre and of each other: run through the middle,
  // two opposed seams join into one straight bar lying across the patch.
  ctx.lineCap = 'round';
  for (let i = 0; i < CRACK_SEAMS; i++) {
    const angle = (i / CRACK_SEAMS) * TWO_PI + hash1(i * 3.1) * 1.4 + Math.sin(spin + i) * 0.12;
    const flicker = 0.6 + 0.4 * Math.sin(spin * 2 + i * 2.1);
    const inner = poolRadius * 0.28;
    const outer = poolRadius * (0.6 + hash1(i * 6.2) * 0.28);
    ctx.strokeStyle = rgba(255, 138, 40, 0.85 * strength * flicker);
    ctx.lineWidth = poolRadius * 0.11;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner * POOL_FLATTEN);
    ctx.lineTo(Math.cos(angle + 0.4) * outer, Math.sin(angle + 0.4) * outer * POOL_FLATTEN);
    ctx.stroke();
  }

  drawHeatHalo(ctx, 0, -FLAME_RADIUS * 0.2, FLAME_RADIUS * 1.9, strength * 0.8);

  // Tongues. Each is an independent teardrop on its own phase — a single flame
  // shape scaled up and down pulses like a heartbeat, which no fire does.
  for (let i = 0; i < FLAME_TONGUES; i++) {
    const seed = i * 2.9;
    const local = (phase + hash1(seed)) % 1;
    const baseX = (hash1(seed + 1.1) - 0.5) * FLAME_RADIUS * 1.3;
    const baseY = (hash1(seed + 2.2) - 0.5) * FLAME_RADIUS * 0.4;
    const height = FLAME_RADIUS * (0.9 + hash1(seed + 3.3) * 0.7) * strength;
    const width = FLAME_RADIUS * (0.22 + hash1(seed + 4.4) * 0.14);
    const lean = Math.sin(spin + seed) * width * 0.9;
    // Tongues are born short, stretch, and are pinched out at the top of their
    // own cycle; the taper is what stops them reading as orange leaves.
    const rise = Math.sin(local * Math.PI);
    const tipY = baseY - height * (0.35 + rise * 0.65);

    for (const [inset, r, g, b] of [
      [0, 214, 62, 12],
      [0.3, 255, 138, 32],
      [0.62, 255, 226, 150],
    ] as const) {
      const w = width * (1 - inset);
      const h = tipY + (baseY - tipY) * inset;
      if (w <= MIN_RADIUS) continue;
      ctx.fillStyle = rgba(r, g, b, (0.9 - inset * 0.15) * strength);
      ctx.beginPath();
      ctx.moveTo(baseX - w, baseY);
      ctx.quadraticCurveTo(baseX - w * 0.9, h + (baseY - h) * 0.35, baseX + lean * (1 - inset), h);
      ctx.quadraticCurveTo(baseX + w * 0.9, h + (baseY - h) * 0.35, baseX + w, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  for (let i = 0; i < FLAME_EMBERS; i++) {
    const seed = i * 5.7;
    const local = (phase * (0.6 + hash1(seed) * 0.6) + hash1(seed + 8.1)) % 1;
    const px = (hash1(seed + 1.4) - 0.5) * FLAME_RADIUS * 1.5 + Math.sin(spin + seed) * 0.02;
    const py = -local * FLAME_RADIUS * 2.1;
    const radius = FLAME_RADIUS * 0.05 * (1 - local);
    if (radius <= MIN_RADIUS) continue;
    const [er, eg, eb] = SPARK_RGB;
    ctx.fillStyle = rgba(er, eg, eb, (1 - local) * strength);
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, TWO_PI);
    ctx.fill();
  }
}
