/**
 * The painter library behind the Skeleton Lord's effect sheets.
 *
 * Four effects share this file because they share a language: cold witch-light
 * green and dry cortical bone. What makes green magic read as *soul* rather
 * than as slime is that it is light, not liquid — a near-white core inside a
 * saturated body, with everything it touches lit from within and nothing
 * given a hard opaque edge. What makes bone read as bone is the opposite: hard
 * edges, and above all *gaps*. A hand is only skeletal if the dark shows
 * between its fingers.
 *
 *   soul bolt      — the projectile in flight, looping
 *   soul burst     — the impact where it lands, one-shot
 *   bone arrow     — a single frame, pointing along +X
 *   grasping hands — hands erupting from the ground, looping
 *
 * Coordinates are tile units with the origin at the effect's anchor and +Y
 * pointing down the screen.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { SOUL_CORE, SOUL_DEEP, SOUL_MID, SOUL_SHADOW } from '../src/sprites/soulPalette.js';

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/** Radii below this are degenerate; canvas rejects a negative arc or gradient. */
const MIN_RADIUS = 1e-4;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease that decelerates into its target. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Smooth 0→1 ease with no discontinuity at either end. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 - edge0 <= MIN_RADIUS) return x < edge1 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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
function rgba(rgb: Rgb, alpha: number): string {
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  const [r, g, b] = rgb;
  return `rgba(${r},${g},${b},${safe})`;
}

type Rgb = readonly [number, number, number];

// ── The palette ──────────────────────────────────────────────────────────────

// Witch-light green comes from `src/sprites/soulPalette.ts` rather than from
// here: the Lich's falling orbs are drawn live in the browser out of the same
// four values, and a second copy of them drifts on the first tweak.

/** Dry cortical bone, lit and shadowed. */
const BONE_LIT: Rgb = [239, 230, 207];
const BONE_SHADOW: Rgb = [168, 154, 124];
/**
 * The dark every bone is drawn on top of.
 *
 * Each segment is laid down twice — once oversized in this, once at true width
 * in bone — so that touching segments are always parted by a dark line. That
 * separation *is* the skeletal read: without it a hand bakes into one pale
 * mitten at the size the game draws it.
 */
const BONE_SEPARATION: Rgb = [26, 24, 20];

/**
 * Scavenged crow-feather fletching.
 *
 * Deliberately not the near-black separation colour: a dungeon floor is dark,
 * and a black tail simply disappears there — the arrow then reads as a headless
 * white dash with no back end.
 */
const FLETCH_DARK: Rgb = [62, 56, 48];
const FLETCH_LIT: Rgb = [122, 112, 96];

/** Turned earth around an eruption. */
const SOIL_DARK: Rgb = [38, 29, 22];
const SOIL_LIT: Rgb = [74, 58, 43];

// ── Shared drawing helpers ───────────────────────────────────────────────────

/**
 * The soft green bloom every witch-lit thing here sits inside.
 *
 * A gradient rather than `shadowBlur`: node-canvas's shadow blur is both slow
 * and inconsistent with the browser's, so a glow baked with it does not match
 * what the harness showed.
 */
function drawSoulGlow(ctx: Ctx, cx: number, cy: number, radius: number, strength: number): void {
  if (radius <= MIN_RADIUS || strength <= 0) return;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, rgba(SOUL_MID, 0.5 * strength));
  gradient.addColorStop(0.4, rgba(SOUL_DEEP, 0.26 * strength));
  gradient.addColorStop(1, rgba(SOUL_SHADOW, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
}

/**
 * A closed, irregular blob.
 *
 * Laid through quadratic curves rather than straight segments: at the sample
 * counts these effects can afford, a polyline blob bakes as a visibly faceted
 * shard, which reads as debris no matter what colour it is painted.
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

/**
 * A tapering ribbon that curves as it travels outward — the shape a wisp of
 * flame or of soul-stuff takes when it is being flung off something spinning.
 *
 * Straight spikes read as a starburst decal; the curl is what makes the same
 * five shapes read as *motion around the orb*.
 */
function wispPath(
  ctx: Ctx,
  angle: number,
  innerRadius: number,
  outerRadius: number,
  curl: number,
  halfWidth: number,
): void {
  const SAMPLES = 9;
  const spineAt = (t: number): readonly [number, number, number] => {
    const a = angle + curl * t * t;
    const r = innerRadius + (outerRadius - innerRadius) * t;
    return [Math.cos(a) * r, Math.sin(a) * r, a];
  };
  ctx.beginPath();
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const [x, y, a] = spineAt(t);
    const w = halfWidth * (1 - t) * (1 - t);
    const px = -Math.sin(a) * w;
    const py = Math.cos(a) * w;
    if (i === 0) ctx.moveTo(x + px, y + py);
    else ctx.lineTo(x + px, y + py);
  }
  for (let i = SAMPLES; i >= 0; i--) {
    const t = i / SAMPLES;
    const [x, y, a] = spineAt(t);
    const w = halfWidth * (1 - t) * (1 - t);
    ctx.lineTo(x + Math.sin(a) * w, y - Math.cos(a) * w);
  }
  ctx.closePath();
}

/** Half the dark border laid around every bone, in tile units. */
const BONE_SEPARATION_WIDTH = 0.012;

/**
 * One bone: a capsule with knob ends, tapering from `halfWidthStart` to
 * `halfWidthEnd`, drawn over its own dark separation border.
 *
 * The knob ends are not decoration. A bone that ends in a flat cut reads as a
 * stick; the condyle bulge at each joint is most of what says "skeleton".
 */
function drawBone(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfWidthStart: number,
  halfWidthEnd: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length <= MIN_RADIUS) return;
  const angle = Math.atan2(dy, dx);

  const layCapsule = (w0: number, w1: number): void => {
    if (w0 <= MIN_RADIUS || w1 <= MIN_RADIUS) return;
    ctx.beginPath();
    ctx.arc(x0, y0, w0, angle + HALF_PI, angle + Math.PI + HALF_PI);
    ctx.arc(x1, y1, w1, angle - HALF_PI, angle + HALF_PI);
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = rgba(BONE_SEPARATION, 0.95);
  layCapsule(halfWidthStart + BONE_SEPARATION_WIDTH, halfWidthEnd + BONE_SEPARATION_WIDTH);

  // Lit along the spine and shadowed on one flank, so a round bone does not
  // bake as a flat pale lozenge.
  const across = Math.max(halfWidthStart, halfWidthEnd);
  const shade = ctx.createLinearGradient(
    x0 - Math.sin(angle) * across,
    y0 + Math.cos(angle) * across,
    x0 + Math.sin(angle) * across,
    y0 - Math.cos(angle) * across,
  );
  shade.addColorStop(0, rgba(BONE_LIT, 1));
  shade.addColorStop(0.55, rgba(BONE_LIT, 1));
  shade.addColorStop(1, rgba(BONE_SHADOW, 1));
  ctx.fillStyle = shade;
  layCapsule(halfWidthStart, halfWidthEnd);
}

// ── Soul bolt ────────────────────────────────────────────────────────────────

/** Radius of the orb's bright body, in tile units. */
export const BOLT_RADIUS = 0.17;
/** How far the glow and the wisps reach past the orb, in tile units. */
export const BOLT_REACH = 0.46;
const BOLT_WISP_COUNT = 5;
const BOLT_EDDY_COUNT = 3;
const BOLT_MOTE_COUNT = 4;
/** How much the orb breathes over one loop, as a fraction of its radius. */
const BOLT_PULSE_DEPTH = 0.08;

/**
 * The soul bolt in flight, looping on `phase` (0–1).
 *
 * The runtime does not rotate this sheet — a soul bolt has no nose — so the
 * motion has to live inside the frame: the wisps sweep around the orb and the
 * eddies counter-rotate inside it. A bolt whose only animation is a size pulse
 * reads as a plain circle blinking.
 */
export function drawSoulBolt(ctx: Ctx, phase: number): void {
  const spin = phase * TWO_PI;
  const pulse = 1 + Math.sin(spin) * BOLT_PULSE_DEPTH;
  const orbRadius = BOLT_RADIUS * pulse;

  drawSoulGlow(ctx, 0, 0, BOLT_REACH, 1);

  // Wisps first, so the orb sits in front of the stuff streaming off it.
  for (let i = 0; i < BOLT_WISP_COUNT; i++) {
    const seed = i * 3.7;
    const angle = spin + (i / BOLT_WISP_COUNT) * TWO_PI;
    // Each wisp runs its own cycle, so they gutter out of step instead of
    // pinwheeling as one rigid star.
    const local = (phase + hash1(seed)) % 1;
    const life = Math.sin(local * Math.PI);
    const outer = BOLT_RADIUS + (BOLT_REACH - BOLT_RADIUS) * (0.45 + life * 0.55);
    const curl = (0.9 + hash1(seed + 1.3) * 0.8) * (i % 2 === 0 ? 1 : -1);
    const halfWidth = BOLT_RADIUS * (0.34 + hash1(seed + 2.1) * 0.16);

    ctx.fillStyle = rgba(SOUL_DEEP, 0.55 * life);
    wispPath(ctx, angle, BOLT_RADIUS * 0.7, outer, curl, halfWidth * 1.35);
    ctx.fill();
    ctx.fillStyle = rgba(SOUL_MID, 0.85 * life);
    wispPath(ctx, angle, BOLT_RADIUS * 0.7, outer * 0.9, curl, halfWidth);
    ctx.fill();
  }

  // The orb body. Painted core-out as a gradient so the near-white heart shows
  // through: an orb filled with flat mid-green reads as a painted marble.
  const body = ctx.createRadialGradient(
    -orbRadius * 0.22,
    -orbRadius * 0.24,
    0,
    0,
    0,
    orbRadius * 1.05,
  );
  body.addColorStop(0, rgba(SOUL_CORE, 1));
  body.addColorStop(0.3, rgba(SOUL_CORE, 0.95));
  body.addColorStop(0.62, rgba(SOUL_MID, 0.95));
  body.addColorStop(1, rgba(SOUL_DEEP, 0.55));
  ctx.fillStyle = body;
  blobPath(ctx, 0, 0, orbRadius, spin * 0.5 + 1.7, 0.1, 22);
  ctx.fill();

  // Eddies: darker crescents turning against the wisps. They are the only thing
  // in the frame that shows the orb is a *body* of moving stuff.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, orbRadius, 0, TWO_PI);
  ctx.clip();
  for (let i = 0; i < BOLT_EDDY_COUNT; i++) {
    const orbit = -spin * 1.4 + (i / BOLT_EDDY_COUNT) * TWO_PI;
    const distance = orbRadius * (0.34 + hash1(i * 4.9) * 0.34);
    const px = Math.cos(orbit) * distance;
    const py = Math.sin(orbit) * distance;
    ctx.fillStyle = rgba(SOUL_DEEP, 0.5);
    blobPath(ctx, px, py, orbRadius * 0.3, i * 5.3 + spin, 0.4, 12);
    ctx.fill();
  }
  ctx.restore();

  // A bright rim: a body of light is brightest where it is thinnest, and the
  // rim is what keeps the silhouette crisp against a dark dungeon floor.
  ctx.strokeStyle = rgba(SOUL_CORE, 0.55);
  ctx.lineWidth = orbRadius * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, orbRadius * 0.93, 0, TWO_PI);
  ctx.stroke();

  for (let i = 0; i < BOLT_MOTE_COUNT; i++) {
    const seed = i * 6.1;
    const local = (phase * (0.7 + hash1(seed) * 0.7) + hash1(seed + 2.4)) % 1;
    const distance = BOLT_RADIUS + (BOLT_REACH - BOLT_RADIUS) * local;
    const angle = hash1(seed + 5.5) * TWO_PI - spin * 0.6;
    const radius = BOLT_RADIUS * 0.13 * (1 - local);
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(SOUL_CORE, (1 - local) * 0.9);
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, radius, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Soul burst ───────────────────────────────────────────────────────────────

/** How far the burst's ring has reached by its last frame, in tile units. */
export const BURST_REACH = 0.7;
const BURST_WISP_COUNT = 9;
const BURST_MOTE_COUNT = 11;
/** Fraction of the burst spent on the white flash. */
const BURST_FLASH_END = 0.22;
/** Fraction of the burst over which the ring keeps a near-white leading edge. */
const RING_HIGHLIGHT_END = 0.4;

/**
 * The impact where a soul bolt lands. `progress` runs 0 on the first frame to
 * 1 on the last.
 *
 * The order is the whole effect: flash, then ring, then the wisps guttering
 * out through it. Shrink a disc instead and the impact reads as the bolt being
 * politely absorbed rather than as it coming apart.
 */
export function drawSoulBurst(ctx: Ctx, progress: number): void {
  const t = clamp01(progress);
  const out = easeOut(t);
  const fade = 1 - t;

  // Residual scorch: the last thing left, and the part that says the ground was
  // hit rather than the air above it.
  const scorchRadius = BURST_REACH * 0.42 * easeOut(Math.min(1, t * 4));
  if (scorchRadius > MIN_RADIUS) {
    ctx.fillStyle = rgba(SOUL_SHADOW, 0.3 * fade);
    blobPath(ctx, 0, 0, scorchRadius, 2.6, 0.26, 20);
    ctx.fill();
  }

  drawSoulGlow(ctx, 0, 0, BURST_REACH * (0.5 + out * 0.7), fade);

  // The flash: near-full brightness on frame 0 and gone within a fifth of the
  // burst. Every frame after it is dissipation, which is what makes the whole
  // thing read as violent rather than as a bloom opening.
  const flash = 1 - smoothstep(0, BURST_FLASH_END, t);
  if (flash > 0) {
    const flashRadius = BURST_REACH * (0.34 + out * 0.3);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, flashRadius);
    core.addColorStop(0, rgba(SOUL_CORE, flash));
    core.addColorStop(0.45, rgba(SOUL_MID, 0.85 * flash));
    core.addColorStop(1, rgba(SOUL_DEEP, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, flashRadius, 0, TWO_PI);
    ctx.fill();
  }

  // The ring: ragged, not circular, and green rather than white. Stroked in the
  // near-white core colour it bakes as a grey outline that outlives the fire —
  // the burst then reads as a smoke ring, which is exactly the shrinking-disc
  // failure this effect exists to avoid. It is also cubed out rather than
  // linearly faded, so the last third of the burst is only guttering wisps.
  const ringRadius = BURST_REACH * out;
  const ringLife = fade * fade * fade;
  if (ringRadius > MIN_RADIUS && ringLife > 0.02) {
    ctx.strokeStyle = rgba(SOUL_MID, 0.9 * ringLife);
    ctx.lineWidth = BURST_REACH * 0.16 * fade;
    blobPath(ctx, 0, 0, ringRadius, 4.2, 0.18, 26);
    ctx.stroke();
    const leadingEdge = 1 - smoothstep(0, RING_HIGHLIGHT_END, t);
    ctx.strokeStyle = rgba(SOUL_CORE, 0.8 * ringLife * leadingEdge);
    ctx.lineWidth = BURST_REACH * 0.05 * fade;
    blobPath(ctx, 0, 0, ringRadius * 0.96, 4.2, 0.18, 26);
    ctx.stroke();
  }

  // Wisps torn off the bolt, thrown outward and guttering as they go. Each has
  // its own speed so the burst never shows a ring of evenly spaced spikes.
  for (let i = 0; i < BURST_WISP_COUNT; i++) {
    const seed = i * 2.9;
    const angle = (i / BURST_WISP_COUNT) * TWO_PI + hash1(seed) * 0.7;
    // Thrown past the ring, not level with it: wisps that stop at the shockwave
    // read as decoration printed on it rather than as matter torn loose.
    const speed = 0.8 + hash1(seed + 1.7) * 0.6;
    const inner = BURST_REACH * out * speed * 0.4;
    const outer = BURST_REACH * out * speed;
    const life = fade * (0.5 + hash1(seed + 3.1) * 0.5);
    const halfWidth = BURST_REACH * 0.14 * fade * (0.6 + hash1(seed + 4.3) * 0.7);
    if (outer - inner <= MIN_RADIUS || halfWidth <= MIN_RADIUS) continue;
    const curl = (0.5 + hash1(seed + 5.9) * 0.9) * (i % 2 === 0 ? 1 : -1);
    ctx.fillStyle = rgba(SOUL_MID, 0.8 * life);
    wispPath(ctx, angle, inner, outer, curl, halfWidth);
    ctx.fill();
    ctx.fillStyle = rgba(SOUL_CORE, 0.7 * life * fade);
    wispPath(ctx, angle, inner, outer * 0.8, curl, halfWidth * 0.5);
    ctx.fill();
  }

  for (let i = 0; i < BURST_MOTE_COUNT; i++) {
    const seed = i * 7.3;
    const angle = hash1(seed) * TWO_PI;
    const distance = BURST_REACH * out * (0.5 + hash1(seed + 1.1) * 0.62);
    const radius = BURST_REACH * 0.045 * fade * (0.5 + hash1(seed + 2.2));
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(SOUL_CORE, fade);
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, radius, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Bone arrow ───────────────────────────────────────────────────────────────

/** Half the arrow's length, in tile units; it is drawn pointing along +X. */
export const ARROW_HALF_LENGTH = 0.6;
/** Half the height of the fletching, the arrow's tallest part, in tile units. */
export const ARROW_HALF_HEIGHT = 0.16;
const ARROW_SHAFT_HALF_WIDTH = 0.028;
/** How much thinner the shaft is at the nock than behind the head. */
const ARROW_NOCK_TAPER = 0.72;
const ARROW_HEAD_LENGTH = 0.24;
const ARROW_HEAD_HALF_WIDTH = 0.075;
const ARROW_FLETCH_COUNT = 3;

/**
 * A bone arrow, drawn once and rotated to its heading by the runtime.
 *
 * Everything about the shape is in service of being nameable at a 32 px tile,
 * where the whole arrow is about 38 px long and two px thick: the head is
 * oversized relative to a real arrow, the fletching is a dark mass rather than
 * feather detail, and the head is the only part allowed to be wide.
 */
export function drawBoneArrow(ctx: Ctx): void {
  const nockX = -ARROW_HALF_LENGTH;
  const headBaseX = ARROW_HALF_LENGTH - ARROW_HEAD_LENGTH;

  // Fletching first: it sits behind the shaft so the shaft's line runs
  // unbroken through it, which is what stops the tail reading as a second,
  // detached blob.
  for (let i = 0; i < ARROW_FLETCH_COUNT; i++) {
    const along = nockX + ARROW_HALF_LENGTH * (0.06 + i * 0.11);
    const sweep = ARROW_HALF_LENGTH * 0.24;
    const height = ARROW_HALF_HEIGHT * (1 - i * 0.16);
    for (const side of [-1, 1] as const) {
      const feather = (): void => {
        ctx.beginPath();
        ctx.moveTo(along, 0);
        // The ragged notch in the trailing edge: a smooth triangle reads as a
        // plastic dart flight, and this is meant to be scavenged crow feather.
        ctx.lineTo(along - sweep * 0.35, side * height);
        ctx.lineTo(along + sweep * 0.25, side * height * 0.7);
        ctx.lineTo(along + sweep * 0.55, side * height * 0.95);
        ctx.lineTo(along + sweep, 0);
        ctx.closePath();
      };
      ctx.fillStyle = rgba(FLETCH_DARK, 0.95 - i * 0.08);
      feather();
      ctx.fill();
      // A lit edge along the quill side; without it the three vanes merge into
      // one dark paddle at the size the game draws this.
      ctx.strokeStyle = rgba(FLETCH_LIT, 0.85);
      ctx.lineWidth = ARROW_SHAFT_HALF_WIDTH * 0.5;
      feather();
      ctx.stroke();
    }
  }

  drawBone(
    ctx,
    nockX,
    0,
    headBaseX,
    0,
    ARROW_SHAFT_HALF_WIDTH * ARROW_NOCK_TAPER,
    ARROW_SHAFT_HALF_WIDTH,
  );

  // The nock: a dark wedge cut into the tail. Two px of negative space, but it
  // is what tells the eye which end is the back.
  ctx.fillStyle = rgba(BONE_SEPARATION, 1);
  ctx.beginPath();
  ctx.moveTo(nockX - ARROW_SHAFT_HALF_WIDTH, -ARROW_SHAFT_HALF_WIDTH * 1.2);
  ctx.lineTo(nockX + ARROW_SHAFT_HALF_WIDTH * 2.2, 0);
  ctx.lineTo(nockX - ARROW_SHAFT_HALF_WIDTH, ARROW_SHAFT_HALF_WIDTH * 1.2);
  ctx.closePath();
  ctx.fill();

  // The head: a chipped flake, asymmetric on purpose. Both barbs equal and the
  // point reads as a machined arrowhead rather than as something knapped.
  const tipX = ARROW_HALF_LENGTH;
  const headPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(headBaseX - ARROW_HEAD_LENGTH * 0.15, -ARROW_HEAD_HALF_WIDTH * 0.5);
    ctx.lineTo(headBaseX + ARROW_HEAD_LENGTH * 0.12, -ARROW_HEAD_HALF_WIDTH);
    ctx.lineTo(headBaseX + ARROW_HEAD_LENGTH * 0.62, -ARROW_HEAD_HALF_WIDTH * 0.48);
    ctx.lineTo(tipX, 0);
    ctx.lineTo(headBaseX + ARROW_HEAD_LENGTH * 0.55, ARROW_HEAD_HALF_WIDTH * 0.62);
    ctx.lineTo(headBaseX + ARROW_HEAD_LENGTH * 0.1, ARROW_HEAD_HALF_WIDTH * 0.92);
    ctx.lineTo(headBaseX - ARROW_HEAD_LENGTH * 0.15, ARROW_HEAD_HALF_WIDTH * 0.44);
    ctx.closePath();
  };
  ctx.fillStyle = rgba(BONE_SEPARATION, 0.95);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = BONE_SEPARATION_WIDTH * 2;
  ctx.strokeStyle = rgba(BONE_SEPARATION, 0.95);
  headPath();
  ctx.stroke();
  ctx.restore();

  const headShade = ctx.createLinearGradient(0, -ARROW_HEAD_HALF_WIDTH, 0, ARROW_HEAD_HALF_WIDTH);
  headShade.addColorStop(0, rgba(BONE_LIT, 1));
  headShade.addColorStop(0.6, rgba(BONE_LIT, 1));
  headShade.addColorStop(1, rgba(BONE_SHADOW, 1));
  ctx.fillStyle = headShade;
  headPath();
  ctx.fill();

  // A flake scar down the middle of the head. Bone knapped to a point splits
  // along its grain, and the line also breaks up what would be a flat wedge.
  ctx.strokeStyle = rgba(BONE_SHADOW, 0.85);
  ctx.lineWidth = ARROW_SHAFT_HALF_WIDTH * 0.5;
  ctx.beginPath();
  ctx.moveTo(headBaseX + ARROW_HEAD_LENGTH * 0.1, -ARROW_HEAD_HALF_WIDTH * 0.15);
  ctx.lineTo(tipX - ARROW_HEAD_LENGTH * 0.12, ARROW_HEAD_HALF_WIDTH * 0.1);
  ctx.stroke();
}

// ── Grasping hands ───────────────────────────────────────────────────────────

/** Where the soil line sits relative to the patch anchor, in tile units. */
export const HANDS_GROUND_Y = 0.2;
/**
 * How far past the soil line the forearm is drawn, as a multiple of hand size.
 *
 * Enough that a leaning hand still meets the ground on both bones; the excess
 * is clipped away.
 */
const FOREARM_BURIED_OVERSHOOT = 0.3;
/** The broken hole in the soil an arm comes up through, in hand-size units. */
const SOCKET_HALF_WIDTH = 0.22;
const SOCKET_FLATTEN = 0.45;
/** Half-width of the turned earth the hands come out of, in tile units. */
export const HANDS_PATCH_HALF_WIDTH = 0.5;
/** Length of the main hand from wrist to fingertip, in tile units. */
const HAND_SIZE = 0.58;
const HAND_FINGER_COUNT = 4;
const HAND_PHALANX_COUNT = 3;
/** How far a hand travels up out of the ground, as a multiple of its size. */
const HAND_RISE_TRAVEL = 1;
const SOIL_CRACK_COUNT = 6;
const SOIL_CLOD_COUNT = 7;

/** Loop timeline: crack, burst up, claw, sink. */
const CRACK_END = 0.16;
const BURST_END = 0.44;
const CLAW_END = 0.76;

/** Relative length of each phalanx, fingertip last. */
const PHALANX_LENGTHS: readonly number[] = [0.2, 0.15, 0.11];
const PHALANX_HALF_WIDTHS: readonly number[] = [0.042, 0.036, 0.03];
/** How far each finger joint folds when the hand claws, in radians. */
const JOINT_CURL = 0.9;
/**
 * Relative finger lengths, index to little.
 *
 * Four fingers of equal length is the single loudest "this is a garden fork"
 * tell; the arch across the knuckles is most of what makes a hand a hand.
 */
const FINGER_LENGTH_SCALE: readonly number[] = [0.88, 1, 0.95, 0.78];
/** How much later each finger down the hand starts to close. */
const FINGER_CURL_LAG = 0.1;
/** How far the fingers gather together as they close. */
const SPREAD_CLOSE = 0.45;

function drawFinger(
  ctx: Ctx,
  baseX: number,
  baseY: number,
  size: number,
  spread: number,
  curl: number,
  lengthScale: number,
): void {
  let x = baseX;
  let y = baseY;
  let angle = -HALF_PI + spread;
  for (let joint = 0; joint < HAND_PHALANX_COUNT; joint++) {
    if (joint > 0) angle += curl * JOINT_CURL;
    const length = (PHALANX_LENGTHS[joint] ?? 0) * size * lengthScale;
    const nextX = x + Math.cos(angle) * length;
    const nextY = y + Math.sin(angle) * length;
    const halfWidth = (PHALANX_HALF_WIDTHS[joint] ?? 0) * size;
    const nextHalfWidth = (PHALANX_HALF_WIDTHS[joint + 1] ?? halfWidth * 0.85) * size;
    drawBone(ctx, x, y, nextX, nextY, halfWidth, nextHalfWidth);
    x = nextX;
    y = nextY;
  }
}

/**
 * One skeletal hand, wrist at the origin, fingers reaching up.
 *
 * `curl` 0 is a hand thrown open at the sky; 1 is a hand closing on something.
 * Every bone is drawn as its own capsule rather than as one silhouette: the
 * dark between the metacarpals and between the fingers is the entire reason
 * this reads as bone and not as a glove.
 */
function drawSkeletalHand(ctx: Ctx, size: number, curl: number, forearmLength: number): void {
  const FOREARM_SPLIT = 0.08;
  const KNUCKLE_ROW_Y = -0.1;
  const METACARPAL_SPREAD = 0.19;
  const FINGER_SPREAD = 0.4;
  /** How far the wrist cocks over as the hand closes, in radians. */
  const CLAW_TWIST = 0.22;

  // Radius and ulna as two separate bones with daylight between them. One fat
  // forearm capsule is the single fastest way to make a skeleton read as a
  // cartoon arm.
  for (const side of [-1, 1] as const) {
    drawBone(
      ctx,
      side * FOREARM_SPLIT * size * 0.6,
      0,
      side * FOREARM_SPLIT * size,
      forearmLength * size,
      0.05 * size,
      0.038 * size,
    );
  }

  // Carpals: the wrist reads as a knot of small lumps, never as a hinge.
  const CARPAL_COUNT = 3;
  const CARPAL_MIDDLE = (CARPAL_COUNT - 1) / 2;
  for (let i = 0; i < CARPAL_COUNT; i++) {
    const cx = (i - CARPAL_MIDDLE) * 0.055 * size;
    ctx.fillStyle = rgba(BONE_SEPARATION, 0.95);
    ctx.beginPath();
    ctx.arc(cx, 0, 0.048 * size, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(i === CARPAL_MIDDLE ? BONE_LIT : BONE_SHADOW, 1);
    ctx.beginPath();
    ctx.arc(cx, 0, 0.036 * size, 0, TWO_PI);
    ctx.fill();
  }

  // Only the hand cocks over as it closes; rotating the forearm too would swing
  // the whole arm in the socket it just came out of.
  ctx.save();
  ctx.rotate(curl * CLAW_TWIST);

  for (let i = 0; i < HAND_FINGER_COUNT; i++) {
    const offset = i - (HAND_FINGER_COUNT - 1) / 2;
    const knuckleX = offset * METACARPAL_SPREAD * size;
    // The knuckle row arches: the outer metacarpals sit lower on the palm.
    const knuckleY = KNUCKLE_ROW_Y * size + Math.abs(offset) * 0.026 * size;
    const fingerCurl = clamp01(
      curl * (1 + FINGER_CURL_LAG * HAND_FINGER_COUNT) - i * FINGER_CURL_LAG,
    );
    const spread = offset * FINGER_SPREAD * 0.32 * (1 - curl * SPREAD_CLOSE);
    drawBone(ctx, offset * 0.045 * size, 0, knuckleX, knuckleY, 0.035 * size, 0.03 * size);
    drawFinger(ctx, knuckleX, knuckleY, size, spread, fingerCurl, FINGER_LENGTH_SCALE[i] ?? 1);
  }

  // The thumb leaves the palm sideways and low; without it the hand is a rake.
  const thumbBaseX = -0.16 * size;
  const thumbBaseY = 0.06 * size;
  const thumbMidX = thumbBaseX - 0.15 * size + curl * 0.04 * size;
  const thumbMidY = thumbBaseY - 0.11 * size + curl * 0.05 * size;
  drawBone(ctx, thumbBaseX, thumbBaseY, thumbMidX, thumbMidY, 0.04 * size, 0.034 * size);
  drawBone(
    ctx,
    thumbMidX,
    thumbMidY,
    thumbMidX - 0.03 * size + curl * 0.14 * size,
    thumbMidY - 0.13 * size + curl * 0.06 * size,
    0.034 * size,
    0.026 * size,
  );
  ctx.restore();
}

interface HandInstance {
  readonly x: number;
  readonly size: number;
  /** Offset into the loop, so the hands do not erupt in lockstep. */
  readonly phaseOffset: number;
  readonly lean: number;
}

/**
 * Two hands rather than one: a single hand centred in the cell reads as a prop,
 * and the runtime overlaps several patches, so a little internal asymmetry is
 * what keeps a filled cone from looking stamped.
 */
const HAND_INSTANCES: readonly HandInstance[] = [
  { x: 0.06, size: HAND_SIZE, phaseOffset: 0, lean: -0.12 },
  { x: -0.24, size: HAND_SIZE * 0.68, phaseOffset: 0.24, lean: 0.3 },
];

function riseOf(t: number): number {
  if (t < CRACK_END) return 0;
  if (t < BURST_END) return easeOut((t - CRACK_END) / (BURST_END - CRACK_END));
  if (t < CLAW_END) return 1 - Math.sin((t - BURST_END) * Math.PI) * 0.06;
  return 1 - smoothstep(CLAW_END, 1, t) * 0.9;
}

/**
 * How far the fingers close at the top of the claw.
 *
 * Short of a fist on purpose: closed all the way, the phalanges overlap into
 * one pale lump and the negative space between the fingers — the entire reason
 * this reads as bone — is gone on exactly the frames the attack lands on.
 */
const MAX_CLAW = 0.62;
/** The fingers are never perfectly straight; a dead-straight hand reads as a rake. */
const RESTING_CURL = 0.12;

function curlOf(t: number): number {
  if (t < BURST_END) return RESTING_CURL;
  return RESTING_CURL + smoothstep(BURST_END, CLAW_END, t) * (MAX_CLAW - RESTING_CURL);
}

/**
 * Skeletal hands erupting from the ground, looping on `phase` (0–1).
 *
 * The patch is deliberately mostly transparent with its ink pulled toward the
 * centre: the runtime fills a cone with several overlapping copies of this
 * cell, and any ink near the cell wall bakes a visible seam grid into the cone.
 */
export function drawGraspingHands(ctx: Ctx, phase: number): void {
  const t = clamp01(phase);
  const breach = smoothstep(0, CRACK_END, t);

  // The mound of turned earth. Flattened hard: it lies on a floor seen from
  // above, and a round opaque lump reads as a boulder on the tile.
  const moundRadius = HANDS_PATCH_HALF_WIDTH * (0.5 + breach * 0.5);
  ctx.save();
  ctx.translate(0, HANDS_GROUND_Y);
  ctx.scale(1, 0.42);
  ctx.fillStyle = rgba(SOIL_DARK, 0.75);
  blobPath(ctx, 0, 0, moundRadius, 3.4, 0.3, 22);
  ctx.fill();
  ctx.fillStyle = rgba(SOIL_LIT, 0.5);
  blobPath(ctx, 0, -moundRadius * 0.2, moundRadius * 0.7, 8.2, 0.34, 18);
  ctx.fill();
  ctx.restore();

  // Cracks radiating out of the breach, and the green light coming up through
  // them — the grave is lit from below by the same witch-light as the bolts.
  ctx.lineCap = 'round';
  for (let i = 0; i < SOIL_CRACK_COUNT; i++) {
    const angle = (i / SOIL_CRACK_COUNT) * TWO_PI + hash1(i * 3.3) * 0.8;
    const reach = HANDS_PATCH_HALF_WIDTH * (0.5 + hash1(i * 5.1) * 0.45) * breach;
    ctx.strokeStyle = rgba(SOIL_DARK, 0.85);
    ctx.lineWidth = HANDS_PATCH_HALF_WIDTH * 0.05 * (1 - hash1(i * 2.2) * 0.4);
    ctx.beginPath();
    ctx.moveTo(0, HANDS_GROUND_Y);
    ctx.lineTo(Math.cos(angle) * reach, HANDS_GROUND_Y + Math.sin(angle) * reach * 0.42);
    ctx.stroke();
  }
  drawSoulGlow(
    ctx,
    0,
    HANDS_GROUND_Y,
    HANDS_PATCH_HALF_WIDTH * 0.85,
    breach * (0.35 + riseOf(t) * 0.45),
  );

  // Clods thrown clear at the moment of the breach.
  for (let i = 0; i < SOIL_CLOD_COUNT; i++) {
    const seed = i * 4.7;
    const throwLife = Math.sin(clamp01((t - CRACK_END) / (BURST_END - CRACK_END)) * Math.PI);
    if (throwLife <= 0) continue;
    const angle = hash1(seed) * TWO_PI;
    const distance = HANDS_PATCH_HALF_WIDTH * (0.35 + hash1(seed + 1.2) * 0.5) * throwLife;
    const radius = HANDS_PATCH_HALF_WIDTH * 0.06 * (0.5 + hash1(seed + 2.4)) * throwLife;
    if (radius <= MIN_RADIUS) continue;
    ctx.fillStyle = rgba(SOIL_LIT, 0.85 * throwLife);
    blobPath(
      ctx,
      Math.cos(angle) * distance,
      HANDS_GROUND_Y + Math.sin(angle) * distance * 0.5 - throwLife * HANDS_PATCH_HALF_WIDTH * 0.2,
      radius,
      seed,
      0.35,
      10,
    );
    ctx.fill();
  }

  for (const hand of HAND_INSTANCES) {
    const local = (t + hand.phaseOffset) % 1;
    const rise = riseOf(local);
    if (rise <= 0) continue;
    ctx.save();
    // Clipped at the soil line so the arm is *emerging* rather than floating:
    // an unclipped hand with its forearm ending in mid-air reads as a prop
    // someone dropped on the tile.
    ctx.beginPath();
    ctx.rect(
      -HANDS_PATCH_HALF_WIDTH * 2,
      -HANDS_PATCH_HALF_WIDTH * 3,
      HANDS_PATCH_HALF_WIDTH * 4,
      HANDS_PATCH_HALF_WIDTH * 3 + HANDS_GROUND_Y,
    );
    ctx.clip();
    // The dark socket the arm comes out of. Without it the bright forearm butts
    // straight into the lit mound and reads as a stick standing on the soil
    // rather than as something that broke through it.
    ctx.fillStyle = rgba(SOIL_DARK, 0.9);
    ctx.beginPath();
    ctx.ellipse(
      hand.x,
      HANDS_GROUND_Y,
      hand.size * SOCKET_HALF_WIDTH,
      hand.size * SOCKET_HALF_WIDTH * SOCKET_FLATTEN,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    const lift = rise * hand.size * HAND_RISE_TRAVEL;
    ctx.translate(hand.x, HANDS_GROUND_Y - lift);
    ctx.rotate(hand.lean * (1 - rise * 0.5));
    // The forearm is grown to reach back down past the soil line rather than
    // being a fixed length: drawn short, the arm ends in mid-air above the
    // crack it supposedly came out of and the hand reads as a prop someone
    // dropped on the tile. The overshoot is hidden by the clip.
    const forearmLength = lift / hand.size + FOREARM_BURIED_OVERSHOOT;
    drawSkeletalHand(ctx, hand.size, curlOf(local), forearmLength);
    ctx.restore();
  }
}
