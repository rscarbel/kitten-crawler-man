/**
 * The painter library behind the acid glob's three figures.
 *
 * The material is slime, not fire, and every layer is chosen so nothing here
 * can be mistaken for burning: no orange, no embers, no tongues rising off the
 * floor. What says "acid" is wetness — a translucent body with a bright core
 * and a glossy highlight, droplets that fall rather than float, and a puddle
 * whose surface catches the light and slowly bubbles. The only thing that
 * rises is a thin pale-green vapour, which reads as fumes rather than smoke
 * because it is cold-coloured and never darker than the floor.
 *
 *   bolt    — the glob in flight, rotated to its heading by the runtime
 *   burst   — the wet splat where it lands
 *   puddle  — the toxic pool it leaves behind, looping
 *
 * Coordinates are tile units with the origin at the effect's anchor and +Y
 * pointing down the screen. The bolt is drawn travelling along +X.
 */

import { MIN_RADIUS, TWO_PI, blobPath, clamp01, easeOut, hash1, rgba } from './globEffectKit';

type Ctx = CanvasRenderingContext2D;
export type Rgb = readonly [number, number, number];

// ── The material ─────────────────────────────────────────────────────────────

/** From the hot white-green of the core out to the deep green of a thick edge. */
export const SLIME_CORE: Rgb = [238, 255, 168];
export const SLIME_BRIGHT: Rgb = [178, 240, 58];
const SLIME_MID: Rgb = [104, 196, 30];
const SLIME_DEEP: Rgb = [44, 112, 18];
/** The wet edge a body of slime is outlined by; dark enough to hold on a pale floor. */
const SLIME_RIM: Rgb = [22, 58, 10];
/** The specular glint on anything wet. */
const GLINT: Rgb = [244, 255, 226];
/** Fumes: pale, cold and never darker than the floor they rise from. */
const VAPOUR: Rgb = [176, 226, 132];
/** The bloom the glob sits inside, which keeps a 5 px blob legible on a dark floor. */
const HALO: Rgb = [150, 228, 64];
/** The stain the acid eats into the floor. */
const STAIN: Rgb = [20, 34, 10];

function fillWith(ctx: Ctx, [r, g, b]: Rgb, alpha: number): void {
  ctx.fillStyle = rgba(r, g, b, alpha);
}

function strokeWith(ctx: Ctx, [r, g, b]: Rgb, alpha: number): void {
  ctx.strokeStyle = rgba(r, g, b, alpha);
}

const HALO_INNER_ALPHA = 0.42;
const HALO_MID_ALPHA = 0.16;
const HALO_MID_STOP = 0.45;

/**
 * The soft acid bloom. Its own layer, wider than the shape it sits behind: the
 * bloom is what separates a small green glob from a mossy floor tile.
 */
function drawAcidHalo(ctx: Ctx, cx: number, cy: number, radius: number, strength: number): void {
  if (radius <= MIN_RADIUS || strength <= 0) return;
  const [r, g, b] = HALO;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, rgba(r, g, b, HALO_INNER_ALPHA * strength));
  gradient.addColorStop(HALO_MID_STOP, rgba(r, g, b, HALO_MID_ALPHA * strength));
  gradient.addColorStop(1, rgba(r, g, b, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
}

const GLINT_ALPHA = 0.85;
const GLINT_ASPECT = 0.55;
const GLINT_TILT = -0.5;

/** A small tilted specular highlight: the one mark that says the thing is wet. */
function drawGlint(ctx: Ctx, cx: number, cy: number, radius: number, strength: number): void {
  if (radius <= MIN_RADIUS) return;
  fillWith(ctx, GLINT, GLINT_ALPHA * strength);
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius, radius * GLINT_ASPECT, GLINT_TILT, 0, TWO_PI);
  ctx.fill();
}

/**
 * One droplet of slime: a bright body with a darker underside, so a scatter of
 * them reads as liquid with weight rather than as green confetti.
 */
function drawDroplet(ctx: Ctx, cx: number, cy: number, radius: number, alpha: number): void {
  if (radius <= MIN_RADIUS || alpha <= 0) return;
  fillWith(ctx, SLIME_RIM, DROPLET_RIM_ALPHA * alpha);
  ctx.beginPath();
  ctx.arc(cx, cy + radius * DROPLET_RIM_DROP, radius * DROPLET_RIM_SCALE, 0, TWO_PI);
  ctx.fill();
  fillWith(ctx, SLIME_BRIGHT, alpha);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
  fillWith(ctx, GLINT, DROPLET_GLINT_ALPHA * alpha);
  ctx.beginPath();
  ctx.arc(
    cx - radius * DROPLET_GLINT_OFFSET,
    cy - radius * DROPLET_GLINT_OFFSET,
    radius * DROPLET_GLINT_SCALE,
    0,
    TWO_PI,
  );
  ctx.fill();
}

const DROPLET_RIM_ALPHA = 0.7;
const DROPLET_RIM_DROP = 0.25;
const DROPLET_RIM_SCALE = 1.12;
const DROPLET_GLINT_ALPHA = 0.8;
const DROPLET_GLINT_OFFSET = 0.35;
const DROPLET_GLINT_SCALE = 0.32;

// ── Bolt ─────────────────────────────────────────────────────────────────────

/** Radius of the glob itself, in tile units. */
const BOLT_RADIUS = 0.15;
/** How far the dripping trail streams behind it, in tile units. */
const TRAIL_LENGTH = 0.58;
const TRAIL_SAMPLES = 12;
const TRAIL_BEADS = 3;
/** Beads swell a little wider than the thread they hang on. */
const TRAIL_BEAD_SWELL = 1.1;
/** How many waves of sway run down the trail's length. */
const TRAIL_SWAY_WAVES = 5;
/** The trail starts this wide (as a share of the glob) and thins to a thread. */
const TRAIL_START_WIDTH = 0.6;
const TRAIL_END_WIDTH = 0.12;
const TRAIL_SWAY = 0.03;
const TRAIL_ALPHA = 0.85;
const DRIP_COUNT = 3;
/** How far a drip falls below the trail before it is gone, in tile units. */
const DRIP_FALL = 0.2;
const DRIP_RADIUS = 0.035;
const BOLT_HALO_REACH = 2.9;
/** How far the outline wobbles, as a share of the radius. */
const BOLT_WOBBLE = 0.14;
/** The glob is stretched a little along its flight, as a thrown liquid is. */
const BOLT_STRETCH = 1.18;
const BOLT_BODY_ALPHA = 0.9;
const BOLT_CORE_SCALE = 0.55;
const BOLT_CORE_ALPHA = 0.9;
const BOLT_CORE_FORWARD = 0.18;
const BOLT_INNER_BUBBLES = 3;
const BOLT_RIM_WIDTH = 0.1;
const BOLT_RIM_ALPHA = 0.75;

/**
 * The glob in flight, travelling along +X with its trail behind it.
 *
 * `phase` runs 0–1 over the loop and only wobbles the outline and churns the
 * bubbles inside: the glob must not pulse in size, because the runtime rotates
 * this sprite to the heading and a size beat reads as the shot stuttering.
 */
export function drawAcidBolt(ctx: Ctx, phase: number): void {
  const spin = phase * TWO_PI;

  // The trail first, so the glob sits in front of its own wake: a thread of
  // slime dragged out of the body that thins to nothing, with a few beads
  // pinching off along it. A solid cone would read as a comet; beads alone
  // read as a string of separate shots.
  const trailPoint = (t: number, side: number): readonly [number, number] => {
    const width = TRAIL_START_WIDTH + (TRAIL_END_WIDTH - TRAIL_START_WIDTH) * t;
    const sway = Math.sin(spin + t * TRAIL_SWAY_WAVES) * TRAIL_SWAY * t;
    return [-TRAIL_LENGTH * t, sway + side * BOLT_RADIUS * width];
  };
  const thread = ctx.createLinearGradient(0, 0, -TRAIL_LENGTH, 0);
  thread.addColorStop(0, rgba(...SLIME_MID, TRAIL_ALPHA));
  thread.addColorStop(1, rgba(...SLIME_DEEP, 0));
  ctx.fillStyle = thread;
  ctx.beginPath();
  ctx.moveTo(0, -BOLT_RADIUS * TRAIL_START_WIDTH);
  for (let i = 1; i <= TRAIL_SAMPLES; i++) ctx.lineTo(...trailPoint(i / TRAIL_SAMPLES, -1));
  for (let i = TRAIL_SAMPLES; i >= 0; i--) ctx.lineTo(...trailPoint(i / TRAIL_SAMPLES, 1));
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < TRAIL_BEADS; i++) {
    const t = (i + phase) / TRAIL_BEADS;
    const [bx, by] = trailPoint(t, 0);
    const width = TRAIL_START_WIDTH + (TRAIL_END_WIDTH - TRAIL_START_WIDTH) * t;
    const radius = BOLT_RADIUS * width * TRAIL_BEAD_SWELL;
    fillWith(ctx, SLIME_BRIGHT, TRAIL_ALPHA * (1 - t));
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, TWO_PI);
    ctx.fill();
  }

  // Drips peel off the underside of the trail and fall, which is what tells a
  // glob of slime from a green spark.
  for (let i = 0; i < DRIP_COUNT; i++) {
    const t = (i / DRIP_COUNT + phase) % 1;
    const px = -TRAIL_LENGTH * (0.25 + i * 0.22) - t * BOLT_RADIUS;
    const py = BOLT_RADIUS * 0.3 + t * DRIP_FALL;
    const radius = DRIP_RADIUS * (1 - t * 0.5);
    fillWith(ctx, SLIME_BRIGHT, 1 - t);
    ctx.beginPath();
    ctx.ellipse(px, py, radius, radius * 1.4, 0, 0, TWO_PI);
    ctx.fill();
  }

  drawAcidHalo(ctx, 0, 0, BOLT_RADIUS * BOLT_HALO_REACH, 1);

  ctx.save();
  ctx.scale(BOLT_STRETCH, 1);
  const body = ctx.createRadialGradient(
    BOLT_RADIUS * BOLT_CORE_FORWARD,
    -BOLT_RADIUS * BOLT_CORE_FORWARD,
    0,
    0,
    0,
    BOLT_RADIUS * (1 + BOLT_WOBBLE),
  );
  body.addColorStop(0, rgba(...SLIME_CORE, BOLT_BODY_ALPHA));
  body.addColorStop(0.35, rgba(...SLIME_BRIGHT, BOLT_BODY_ALPHA));
  body.addColorStop(0.75, rgba(...SLIME_MID, BOLT_BODY_ALPHA));
  body.addColorStop(1, rgba(...SLIME_DEEP, BOLT_BODY_ALPHA));
  ctx.fillStyle = body;
  blobPath(ctx, 0, 0, BOLT_RADIUS, spin, BOLT_WOBBLE, 16);
  ctx.fill();
  strokeWith(ctx, SLIME_RIM, BOLT_RIM_ALPHA);
  ctx.lineWidth = BOLT_RADIUS * BOLT_RIM_WIDTH;
  ctx.stroke();

  // Bubbles drifting inside the body: the churn that keeps a still glob alive.
  ctx.save();
  blobPath(ctx, 0, 0, BOLT_RADIUS, spin, BOLT_WOBBLE, 16);
  ctx.clip();
  for (let i = 0; i < BOLT_INNER_BUBBLES; i++) {
    const orbit = spin + (i / BOLT_INNER_BUBBLES) * TWO_PI;
    const distance = BOLT_RADIUS * (0.3 + hash1(i * 2.9) * 0.35);
    const radius = BOLT_RADIUS * (0.14 + hash1(i * 4.7) * 0.08);
    strokeWith(ctx, SLIME_CORE, 0.7);
    ctx.lineWidth = BOLT_RADIUS * 0.06;
    ctx.beginPath();
    ctx.arc(Math.cos(orbit) * distance, Math.sin(orbit) * distance * 0.8, radius, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();

  fillWith(ctx, SLIME_CORE, BOLT_CORE_ALPHA);
  blobPath(
    ctx,
    BOLT_RADIUS * BOLT_CORE_FORWARD,
    -BOLT_RADIUS * BOLT_CORE_FORWARD * 0.5,
    BOLT_RADIUS * BOLT_CORE_SCALE * 0.6,
    spin * 2 + 1.3,
    0.2,
    12,
  );
  ctx.fill();
  ctx.restore();

  drawGlint(ctx, BOLT_RADIUS * 0.35, -BOLT_RADIUS * 0.45, BOLT_RADIUS * 0.28, 1);
}

// ── Burst ────────────────────────────────────────────────────────────────────

/** How far the furthest droplets land, in tile units. */
const BURST_REACH = 0.84;
const BURST_DROPLETS = 12;
const BURST_VAPOUR_PUFFS = 6;
const BURST_CROWN_SPIKES = 9;
/** Vertical squash of anything lying on the floor. */
const FLOOR_FLATTEN = 0.55;

/**
 * The wet splat where a glob lands. `progress` runs 0 at the impact frame to 1
 * at the last.
 *
 * The splash body is biggest a frame or two in and slumps from there; the
 * droplets fly on short arcs and land as spots; the vapour comes last and
 * lifts away. Order of layers: stain, droplets landed, splash, crown, droplets
 * in the air, vapour — the fumes go over everything because they are the part
 * still hanging there when the rest has fallen.
 */
export function drawAcidBurst(ctx: Ctx, progress: number): void {
  const t = clamp01(progress);
  const out = easeOut(t);
  const fade = 1 - t;

  // The stain the acid leaves in the floor stays put while everything else
  // moves, so the impact happened *to the floor* rather than in the air.
  const stainRadius = BURST_REACH * 0.5 * easeOut(Math.min(1, t * 3));
  if (stainRadius > MIN_RADIUS) {
    ctx.save();
    ctx.scale(1, FLOOR_FLATTEN);
    fillWith(ctx, STAIN, 0.55);
    blobPath(ctx, 0, 0, stainRadius, 2.3, 0.3, 20);
    ctx.fill();
    fillWith(ctx, SLIME_DEEP, 0.45 * (0.4 + 0.6 * fade));
    blobPath(ctx, 0, 0, stainRadius * 0.75, 5.1, 0.28, 18);
    ctx.fill();
    ctx.restore();
  }

  // The splash itself opens near full size and slumps as it spreads; a splat
  // that grew from nothing would read as a balloon inflating.
  const splashRadius = BURST_REACH * (0.5 - t * 0.25) * Math.min(1, 0.5 + t * 6);
  drawAcidHalo(ctx, 0, 0, splashRadius * 2.1, fade);
  if (splashRadius > MIN_RADIUS) {
    const splash = ctx.createRadialGradient(0, -splashRadius * 0.2, 0, 0, 0, splashRadius);
    splash.addColorStop(0, rgba(...SLIME_CORE, 0.95 * fade));
    splash.addColorStop(0.4, rgba(...SLIME_BRIGHT, 0.92 * fade));
    splash.addColorStop(0.8, rgba(...SLIME_MID, 0.88 * fade));
    splash.addColorStop(1, rgba(...SLIME_DEEP, 0.8 * fade));
    ctx.fillStyle = splash;
    ctx.save();
    ctx.scale(1, 0.8);
    blobPath(ctx, 0, 0, splashRadius, 1.3 + t * 3, 0.32, 22);
    ctx.fill();
    ctx.restore();
    drawGlint(ctx, -splashRadius * 0.3, -splashRadius * 0.4, splashRadius * 0.22, fade);
  }

  // A crown of liquid thrown straight up off the impact, gone by mid-burst.
  const crown = clamp01(1 - t * 2.4);
  if (crown > 0) {
    ctx.lineCap = 'round';
    for (let i = 0; i < BURST_CROWN_SPIKES; i++) {
      const angle = (i / BURST_CROWN_SPIKES) * TWO_PI + hash1(i * 3.7) * 0.4;
      const base = BURST_REACH * 0.28;
      const length = BURST_REACH * (0.18 + hash1(i * 5.3) * 0.16) * Math.min(1, 0.4 + t * 8);
      const bx = Math.cos(angle) * base;
      const by = Math.sin(angle) * base * FLOOR_FLATTEN;
      const tipX = Math.cos(angle) * (base + length);
      const tipY = Math.sin(angle) * (base + length) * FLOOR_FLATTEN - length * 0.6;
      strokeWith(ctx, SLIME_BRIGHT, 0.9 * crown);
      ctx.lineWidth = BURST_REACH * 0.06 * crown;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      drawDroplet(ctx, tipX, tipY, BURST_REACH * 0.04, crown);
    }
  }

  // Droplets on short ballistic arcs. Once down they stay as spots, so the
  // splat ends as a spray pattern on the floor rather than vanishing in air.
  for (let i = 0; i < BURST_DROPLETS; i++) {
    const angle = (i / BURST_DROPLETS) * TWO_PI + hash1(i * 4.1) * 0.5;
    const speed = 0.62 + hash1(i * 8.3) * 0.48;
    const distance = BURST_REACH * out * speed;
    const lift = Math.sin(Math.min(1, t * 1.6) * Math.PI) * BURST_REACH * 0.28;
    const landed = t * 1.6 >= 1;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance * FLOOR_FLATTEN - (landed ? 0 : lift);
    const radius = BURST_REACH * 0.05 * (0.6 + hash1(i * 2.2) * 0.8);
    if (landed) {
      fillWith(ctx, SLIME_MID, 0.85 * (0.5 + 0.5 * fade));
      ctx.beginPath();
      ctx.ellipse(px, py, radius * 1.3, radius * 1.3 * FLOOR_FLATTEN, 0, 0, TWO_PI);
      ctx.fill();
      continue;
    }
    drawDroplet(ctx, px, py, radius, 1);
  }

  // Fumes ramp in after the splash and drift up as they thin. Each puff is a
  // soft-edged gradient: a hard-edged puff reads as a pebble hanging in the air.
  const fumes = Math.sin(clamp01(t * 1.1) * Math.PI) * 0.45;
  for (let i = 0; i < BURST_VAPOUR_PUFFS; i++) {
    const angle = (i / BURST_VAPOUR_PUFFS) * TWO_PI + 0.6;
    const distance = BURST_REACH * out * (0.35 + hash1(i * 6.1) * 0.35);
    const radius = BURST_REACH * (0.1 + out * 0.2) * (0.7 + hash1(i * 9.4) * 0.5);
    if (radius <= MIN_RADIUS || fumes <= 0) continue;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance * FLOOR_FLATTEN - out * BURST_REACH * 0.35;
    const puff = ctx.createRadialGradient(px, py, 0, px, py, radius);
    puff.addColorStop(0, rgba(...VAPOUR, fumes));
    puff.addColorStop(0.55, rgba(...VAPOUR, fumes * 0.7));
    puff.addColorStop(1, rgba(...VAPOUR, 0));
    ctx.fillStyle = puff;
    blobPath(ctx, px, py, radius, i * 2.9, 0.25, 14);
    ctx.fill();
  }
}

// ── Puddle ───────────────────────────────────────────────────────────────────

/** Half-width of the puddle on the floor, in tile units. */
const PUDDLE_RADIUS = 0.56;
/** A pool lies flatter than a splat; this is its vertical squash. */
const PUDDLE_FLATTEN = 0.5;
const PUDDLE_HALO_REACH = 1.1;
const PUDDLE_HALO_STRENGTH = 0.3;
const PUDDLE_RIM_ALPHA = 0.72;
const PUDDLE_RIM_ROUGHNESS = 0.16;
const PUDDLE_SURFACE_SCALE = 0.86;
const PUDDLE_SURFACE_ALPHA = 0.82;
/** Darker and lighter patches drifting round the pool, so the surface is never still. */
const PUDDLE_MOTTLES = 5;
const PUDDLE_MOTTLE_ALPHA = 0.32;
const PUDDLE_BUBBLES = 7;
const PUDDLE_WISPS = 3;
/** How high a wisp of fumes climbs before it is gone, in tile units. */
const WISP_RISE = 0.3;
/** The share of a bubble's life spent swelling; the rest is the pop. */
const BUBBLE_SWELL_SHARE = 0.7;
const BUBBLE_MAX_RADIUS = 0.07;

/**
 * The toxic puddle left where a glob landed, looping on `phase` (0–1).
 *
 * `intensity` scales the whole thing from 0 to 1 so a caller can fade it in as
 * it spreads and out as it dries, rather than popping it.
 *
 * Read from the outside in: a dark wet rim where the acid has eaten the floor,
 * a translucent sickly-green surface with patches drifting through it and a
 * glossy highlight across the top, and bubbles that swell slowly, burst, and
 * leave a ring behind.
 */
export function drawAcidPuddle(ctx: Ctx, phase: number, intensity: number): void {
  const strength = clamp01(intensity);
  if (strength <= 0) return;
  const spin = phase * TWO_PI;
  const radius = PUDDLE_RADIUS * (0.8 + 0.2 * strength);
  const surfaceRadius = radius * PUDDLE_SURFACE_SCALE;

  ctx.save();
  ctx.scale(1, PUDDLE_FLATTEN);

  drawAcidHalo(ctx, 0, 0, radius * PUDDLE_HALO_REACH, strength * PUDDLE_HALO_STRENGTH);

  // The rim: the floor the acid has already eaten, darker than either the
  // floor or the pool, which is what gives the puddle an edge on any tile.
  // Its outline turns once a loop, so the edge creeps rather than sitting
  // still — and a whole turn is the only motion of an irregular outline that
  // lands back on its first frame.
  ctx.save();
  ctx.rotate(spin);
  blobPath(ctx, 0, 0, radius, 3.7, PUDDLE_RIM_ROUGHNESS, 28);
  ctx.restore();
  fillWith(ctx, STAIN, PUDDLE_RIM_ALPHA * strength);
  ctx.fill();

  const surface = ctx.createRadialGradient(
    -surfaceRadius * 0.2,
    -surfaceRadius * 0.3,
    0,
    0,
    0,
    surfaceRadius,
  );
  surface.addColorStop(0, rgba(...SLIME_BRIGHT, PUDDLE_SURFACE_ALPHA * strength));
  surface.addColorStop(0.55, rgba(...SLIME_MID, PUDDLE_SURFACE_ALPHA * strength));
  surface.addColorStop(1, rgba(...SLIME_DEEP, PUDDLE_SURFACE_ALPHA * strength));
  ctx.fillStyle = surface;
  blobPath(ctx, 0, 0, surfaceRadius, 6.2, 0.1, 26);
  ctx.fill();

  // Patches of thicker and thinner acid drifting round the pool. Clipped to
  // the surface so they never spill onto the rim.
  ctx.save();
  blobPath(ctx, 0, 0, surfaceRadius, 6.2, 0.1, 26);
  ctx.clip();
  for (let i = 0; i < PUDDLE_MOTTLES; i++) {
    const orbit = spin + (i / PUDDLE_MOTTLES) * TWO_PI;
    const distance = surfaceRadius * (0.3 + hash1(i * 3.9) * 0.35);
    const mx = Math.cos(orbit) * distance;
    const my = Math.sin(orbit) * distance;
    const mottleRadius = surfaceRadius * (0.22 + hash1(i * 6.7) * 0.14);
    fillWith(ctx, i % 2 === 0 ? SLIME_DEEP : SLIME_CORE, PUDDLE_MOTTLE_ALPHA * strength);
    blobPath(ctx, mx, my, mottleRadius, i * 2.3 + spin, 0.3, 14);
    ctx.fill();
  }
  ctx.restore();

  // Gloss: a broad soft sheen and a sharper streak across the far side of the
  // pool, the two marks that make it liquid rather than painted floor.
  fillWith(ctx, GLINT, 0.2 * strength);
  ctx.beginPath();
  ctx.ellipse(-radius * 0.18, -radius * 0.38, radius * 0.5, radius * 0.2, -0.12, 0, TWO_PI);
  ctx.fill();
  fillWith(ctx, GLINT, 0.6 * strength);
  ctx.beginPath();
  ctx.ellipse(-radius * 0.24, -radius * 0.48, radius * 0.26, radius * 0.06, -0.12, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // Bubbles, each on its own clock so they never swell in step. A bubble
  // swells as a dome, then bursts into a ring that spreads and fades.
  for (let i = 0; i < PUDDLE_BUBBLES; i++) {
    const seed = i * 3.3;
    const local = (phase + i / PUDDLE_BUBBLES + hash1(seed) * 0.1) % 1;
    const angle = hash1(seed + 1.7) * TWO_PI;
    const distance = surfaceRadius * (0.1 + hash1(seed + 2.9) * 0.55);
    const bx = Math.cos(angle) * distance;
    const by = Math.sin(angle) * distance * PUDDLE_FLATTEN;
    const size = BUBBLE_MAX_RADIUS * (0.6 + hash1(seed + 4.1) * 0.6);
    if (local < BUBBLE_SWELL_SHARE) {
      const swell = easeOut(local / BUBBLE_SWELL_SHARE);
      const r = size * swell;
      if (r <= MIN_RADIUS) continue;
      fillWith(ctx, SLIME_RIM, 0.5 * strength);
      ctx.beginPath();
      ctx.ellipse(bx, by + r * 0.2, r * 1.05, r * 0.6, 0, 0, TWO_PI);
      ctx.fill();
      fillWith(ctx, SLIME_BRIGHT, 0.9 * strength);
      ctx.beginPath();
      ctx.ellipse(bx, by - r * 0.15, r, r * 0.75, 0, 0, TWO_PI);
      ctx.fill();
      drawGlint(ctx, bx - r * 0.3, by - r * 0.45, r * 0.32, strength);
      continue;
    }
    const pop = (local - BUBBLE_SWELL_SHARE) / (1 - BUBBLE_SWELL_SHARE);
    const ringRadius = size * (1 + pop * 1.4);
    strokeWith(ctx, SLIME_CORE, 0.7 * (1 - pop) * strength);
    ctx.lineWidth = size * 0.35 * (1 - pop);
    ctx.beginPath();
    ctx.ellipse(bx, by, ringRadius, ringRadius * PUDDLE_FLATTEN, 0, 0, TWO_PI);
    ctx.stroke();
    // A fleck thrown up by the burst, falling back as the ring spreads.
    const fleckY = by - size * 2 * Math.sin(pop * Math.PI);
    drawDroplet(ctx, bx + size * 0.6, fleckY, size * 0.3 * (1 - pop), strength * (1 - pop));
  }

  // Thin fumes lifting off the surface. Faint on purpose: they say the pool
  // is still live without ever reading as smoke over a fire.
  for (let i = 0; i < PUDDLE_WISPS; i++) {
    const seed = i * 7.9;
    const local = (phase + i / PUDDLE_WISPS) % 1;
    const wx = (hash1(seed) - 0.5) * radius * 1.1 + Math.sin(spin + seed) * radius * 0.08;
    const wy = -local * WISP_RISE;
    const r = radius * (0.12 + local * 0.14);
    const alpha = Math.sin(local * Math.PI) * 0.26 * strength;
    if (alpha <= 0) continue;
    fillWith(ctx, VAPOUR, alpha);
    blobPath(ctx, wx, wy, r, seed + spin, 0.3, 12);
    ctx.fill();
  }
}
