/**
 * The art behind the Brindled Vespa's acid spit — the projectile in flight and
 * its impact splatter — modelled on `magicMissileArt.ts`'s bolt/impact split.
 *
 * The projectile is a glowing acid-green glob: a core, a soft corrosive bloom
 * around it, a trailing drip, and a scatter of bubbles that pop at different
 * phases so the glob reads as boiling rather than static. The impact is the
 * same palette thrown outward — a bubbling splash that peaks fast and fades,
 * never a flat circle.
 *
 * Drawn in pixel space directly (unlike the tile-unit creature art) because
 * effects are baked at a fixed pixel size rather than scaled by a tile grid —
 * the same convention `magicMissileArt.ts` uses.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

const TWO_PI = Math.PI * 2;

function hash1(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

const ACID_CORE = '#e8ffb0';
const ACID_MID = '#a8e030';
const ACID_DARK = '#4c7a10';
const ACID_GLOW = 'rgba(150,230,40,0.55)';
const ACID_BUBBLE = 'rgba(220,255,170,0.8)';

export const TILE_SCALE = 64;
export const PROJECTILE_FRAME_SIZE = 40;
export const PROJECTILE_TILE_OFFSET = PROJECTILE_FRAME_SIZE / 2;
export const PROJECTILE_FRAME_COUNT = 6;

export const IMPACT_FRAME_SIZE = 96;
export const IMPACT_TILE_OFFSET = IMPACT_FRAME_SIZE / 2;
export const IMPACT_FRAME_COUNT = 8;

/**
 * The in-flight glob, drawn pulsing and dripping. `frame`/`frameCount` drive
 * the pulse and the bubble phase; the caller rotates the whole canvas to face
 * velocity, so nothing here needs a direction.
 */
export function drawVespaAcidProjectile(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const phase = frame / frameCount;
  const pulse = 1 + Math.sin(phase * TWO_PI) * 0.14;
  const coreRadius = 7 * pulse;
  const glowRadius = 15 * pulse;

  ctx.save();

  // A trailing drip behind the glob gives it a thrown-liquid read.
  const dripLength = 10 + Math.sin(phase * TWO_PI + 1) * 2;
  ctx.beginPath();
  ctx.moveTo(cx - coreRadius * 0.5, cy - 1);
  ctx.quadraticCurveTo(cx - dripLength * 0.6, cy, cx - dripLength, cy + 2);
  ctx.lineTo(cx - dripLength * 0.9, cy + 4);
  ctx.quadraticCurveTo(cx - dripLength * 0.5, cy + 3, cx - coreRadius * 0.4, cy + 2);
  ctx.closePath();
  ctx.fillStyle = ACID_MID;
  ctx.fill();

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  glow.addColorStop(0, ACID_GLOW);
  glow.addColorStop(1, 'rgba(80,160,10,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, TWO_PI);
  ctx.fill();

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
  core.addColorStop(0, ACID_CORE);
  core.addColorStop(0.55, ACID_MID);
  core.addColorStop(1, ACID_DARK);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, TWO_PI);
  ctx.fill();

  // Small bubbles orbiting the core, each on its own phase so the surface
  // reads as boiling rather than a static gradient ball.
  const BUBBLE_COUNT = 4;
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const bubblePhase = (phase + i / BUBBLE_COUNT) % 1;
    const angle = i * (TWO_PI / BUBBLE_COUNT) + phase * TWO_PI * 0.5;
    const orbit = coreRadius * 0.6;
    const bx = cx + Math.cos(angle) * orbit;
    const by = cy + Math.sin(angle) * orbit;
    const bubbleRadius = lerp(0.5, 2, Math.sin(bubblePhase * Math.PI));
    ctx.beginPath();
    ctx.arc(bx, by, bubbleRadius, 0, TWO_PI);
    ctx.fillStyle = ACID_BUBBLE;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx - coreRadius * 0.3, cy - coreRadius * 0.35, coreRadius * 0.3, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();

  ctx.restore();
}

/**
 * The impact splatter: a bubbling splash that peaks fast then fades, with a
 * scatter of droplets thrown outward — never a flat circle stamped down.
 */
export function drawVespaAcidImpact(
  ctx: Ctx,
  cx: number,
  cy: number,
  frame: number,
  frameCount: number,
): void {
  const t = clamp01(frame / (frameCount - 1));
  // Fast bloom, slow fade: the splash is biggest around a third of the way in.
  const bloom = Math.sin(Math.min(1, t / 0.35) * (Math.PI / 2));
  const fade = 1 - clamp01((t - 0.35) / 0.65);
  const radius = lerp(4, 22, bloom);
  const alpha = fade;

  ctx.save();
  ctx.globalAlpha = alpha;

  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  pool.addColorStop(0, ACID_CORE);
  pool.addColorStop(0.4, ACID_MID);
  pool.addColorStop(1, 'rgba(76,122,16,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();

  const DROPLET_COUNT = 7;
  for (let i = 0; i < DROPLET_COUNT; i++) {
    const angle = (i / DROPLET_COUNT) * TWO_PI + hash1(i) * 0.6;
    const reach = radius * lerp(0.7, 1.25, hash1(i + 10));
    const dropletRadius = lerp(1, 3, hash1(i + 20)) * bloom;
    const dx = cx + Math.cos(angle) * reach;
    const dy = cy + Math.sin(angle) * reach;
    ctx.beginPath();
    ctx.arc(dx, dy, dropletRadius, 0, TWO_PI);
    ctx.fillStyle = ACID_MID;
    ctx.fill();

    // A short corrosive smoke wisp curling off each droplet.
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.quadraticCurveTo(
      dx + Math.cos(angle) * 3,
      dy + Math.sin(angle) * 3 - 4 * bloom,
      dx + Math.cos(angle) * 4,
      dy - 7 * bloom,
    );
    ctx.strokeStyle = `rgba(170,220,90,${0.35 * fade})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // A few bubbles popping across the pool, offset per frame for a boiling read.
  const BUBBLE_COUNT = 5;
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const bubblePhase = (t * 3 + i / BUBBLE_COUNT) % 1;
    const angle = i * (TWO_PI / BUBBLE_COUNT) + 0.4;
    const orbit = radius * 0.55;
    const bx = cx + Math.cos(angle) * orbit;
    const by = cy + Math.sin(angle) * orbit;
    ctx.beginPath();
    ctx.arc(bx, by, lerp(0.5, 2.2, Math.sin(bubblePhase * Math.PI)), 0, TWO_PI);
    ctx.fillStyle = ACID_BUBBLE;
    ctx.fill();
  }

  ctx.restore();
}
