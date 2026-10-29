/**
 * The Current Goblin's telegraphs and attack effects as the power lab draws
 * them: the ring each shock grenade will land in, the grenade on its lob and
 * its burst on landing, the lanes a slam is about to send waves down, and the
 * waves themselves.
 *
 * Drawn rather than baked because every one of them has to sit exactly on the
 * ground it will hurt, and that ground moves with the fight. The warnings are
 * the game's red ground warnings (`dangerTelegraph.ts`); only the effects over
 * them (the grenade, its burst, the wave's crackle) wear his electric blue
 * from `worldPalette.electricGoblin`.
 */

import { worldPalette } from '../ui/theme/worldInk';
import { withAlpha } from '../ui/theme/color';
import type { ShockBurst, ShockGrenade, SlamLane, SlamWave } from '../creatures/ElectricGoblin';
import { SHOCK_BURST_FRAMES } from '../creatures/ElectricGoblin';
import { drawDangerCircle, drawDangerLane } from './dangerTelegraph';

const INK = worldPalette.electricGoblin;
const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/** The world is seen at a slight tilt, so anything flat on the floor squashes. */
const GROUND_SQUASH = 0.6;
/** Warnings are drawn at full strength: each is fixed the moment it appears. */
const WARNING_FADE = 1;

const GRENADE_RADIUS_PX = 4;
const GRENADE_GLOW_RADIUS_PX = 9;
const GRENADE_GLOW_ALPHA = 0.55;
const SHADOW_RADIUS_PX = 5;
/** `t(1 − t)` peaks at a quarter; this brings the lob's peak to its full arc height. */
const PARABOLA_PEAK_SCALE = 4;

/** The red band under a travelling wave reaches this far either side of its front, in its depth's halves. */
const WAVE_BAND_DEPTH_SCALE = 1;
/** A wave's band flashes as it runs, so the moving danger reads as live rather than as a marking. */
const WAVE_BAND_FLASH = 0.35;

/** The burst's flash grows to this many times the ring's radius at its brightest. */
const BURST_FLASH_RADIUS_SCALE = 1.1;
/** The share of the burst spent with the flash still rising. */
const BURST_FLASH_RISE_SHARE = 0.2;
const BURST_GLOW_ALPHA = 0.7;
const BURST_CORE_RADIUS_SCALE = 0.35;
/** Forks of lightning thrown out from the landing point. */
const BURST_ARC_COUNT = 7;
const BURST_ARC_SEGMENTS = 4;
const BURST_ARC_KINK_PX = 5;
const BURST_ARC_WIDTH_PX = 2;
/** The arcs are re-kinked this many times over the burst, so they flicker. */
const BURST_ARC_FLICKERS = 5;

const WAVE_GLOW_WIDTH_PX = 10;
const WAVE_CORE_WIDTH_PX = 3;
/** Kinks in the wave's front, so it reads as current crawling rather than a line. */
const WAVE_JITTER_STEPS = 6;
const WAVE_JITTER_PX = 4;
/** How long the wave's front is redrawn with the same kinks, in world pixels travelled. */
const WAVE_JITTER_PERIOD_PX = 12;

/** The red ring under a grenade in flight: where and how wide it will discharge, filling as it falls. */
export function drawGrenadeRing(
  ctx: CanvasRenderingContext2D,
  grenade: ShockGrenade,
  radiusPx: number,
  camX: number,
  camY: number,
): void {
  const progress = Math.min(1, grenade.elapsed / grenade.flightFrames);
  drawDangerCircle(ctx, grenade.landX - camX, grenade.landY - camY, radiusPx, WARNING_FADE, {
    fillProgress: progress,
    locked: true,
  });
}

/**
 * A grenade going off where it landed, whoever it caught: a white-blue flash
 * the width of its ring and forks of lightning thrown out from the middle,
 * fading over {@link SHOCK_BURST_FRAMES}.
 */
export function drawShockBurst(
  ctx: CanvasRenderingContext2D,
  burst: ShockBurst,
  radiusPx: number,
  camX: number,
  camY: number,
): void {
  const t = Math.min(1, burst.elapsed / SHOCK_BURST_FRAMES);
  const rising = Math.min(1, t / BURST_FLASH_RISE_SHARE);
  const fading = 1 - t;
  const strength = Math.min(rising, fading / (1 - BURST_FLASH_RISE_SHARE));
  const x = burst.x - camX;
  const y = burst.y - camY;
  const flashRadius = radiusPx * BURST_FLASH_RADIUS_SCALE * (HALF + HALF * rising);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, GROUND_SQUASH);
  ctx.fillStyle = withAlpha(INK.burstGlow, BURST_GLOW_ALPHA * strength);
  ctx.beginPath();
  ctx.arc(0, 0, flashRadius, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = withAlpha(INK.burstCore, strength);
  ctx.beginPath();
  ctx.arc(0, 0, flashRadius * BURST_CORE_RADIUS_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  const flicker = Math.floor(t * BURST_ARC_FLICKERS);
  const seed = Math.floor(burst.x + burst.y) + flicker;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = withAlpha(INK.burstArc, fading);
  ctx.lineWidth = BURST_ARC_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let arc = 0; arc < BURST_ARC_COUNT; arc++) {
    const angle = (arc / BURST_ARC_COUNT) * TWO_PI + jitter(seed, arc);
    const reach = radiusPx * (HALF + HALF * rising);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let step = 1; step <= BURST_ARC_SEGMENTS; step++) {
      const along = (step / BURST_ARC_SEGMENTS) * reach;
      const kink = step === BURST_ARC_SEGMENTS ? 0 : jitter(seed + arc, step) * BURST_ARC_KINK_PX;
      const px = Math.cos(angle) * along - Math.sin(angle) * kink;
      const py = (Math.sin(angle) * along + Math.cos(angle) * kink) * GROUND_SQUASH;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The grenade itself on its lob, with its shadow on the floor beneath. */
export function drawGrenadeInFlight(
  ctx: CanvasRenderingContext2D,
  grenade: ShockGrenade,
  arcHeightPx: number,
  camX: number,
  camY: number,
): void {
  const t = Math.min(1, grenade.elapsed / grenade.flightFrames);
  const groundX = grenade.fromX + (grenade.landX - grenade.fromX) * t;
  const groundY = grenade.fromY + (grenade.landY - grenade.fromY) * t;
  const lift = arcHeightPx * PARABOLA_PEAK_SCALE * t * (1 - t);
  ctx.save();
  ctx.fillStyle = INK.shadow;
  ctx.beginPath();
  ctx.ellipse(
    groundX - camX,
    groundY - camY,
    SHADOW_RADIUS_PX,
    SHADOW_RADIUS_PX * GROUND_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  const x = groundX - camX;
  const y = groundY - lift - camY;
  ctx.fillStyle = withAlpha(INK.grenadeGlow, GRENADE_GLOW_ALPHA);
  ctx.beginPath();
  ctx.arc(x, y, GRENADE_GLOW_RADIUS_PX, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = INK.grenadeBody;
  ctx.beginPath();
  ctx.arc(x, y, GRENADE_RADIUS_PX, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A red lane a slam about to land will send a wave down, filling as the rods come up. */
export function drawSlamLane(
  ctx: CanvasRenderingContext2D,
  lane: SlamLane,
  halfWidthPx: number,
  camX: number,
  camY: number,
): void {
  drawDangerLane(
    ctx,
    lane.fromX - camX,
    lane.fromY - camY,
    lane.dirX,
    lane.dirY,
    lane.lengthPx,
    halfWidthPx,
    WARNING_FADE,
    { fillProgress: lane.progress, locked: true },
  );
}

/**
 * A wave of current running down the floor: the red band of ground it is
 * hurting this moment, with a crackle of current along its front.
 */
export function drawSlamWave(
  ctx: CanvasRenderingContext2D,
  wave: SlamWave,
  halfWidthPx: number,
  halfDepthPx: number,
  camX: number,
  camY: number,
): void {
  const frontX = wave.originX + wave.dirX * wave.travelled;
  const frontY = wave.originY + wave.dirY * wave.travelled;
  const bandReach = halfDepthPx * WAVE_BAND_DEPTH_SCALE;
  drawDangerLane(
    ctx,
    frontX - wave.dirX * bandReach - camX,
    frontY - wave.dirY * bandReach - camY,
    wave.dirX,
    wave.dirY,
    bandReach * 2,
    halfWidthPx,
    WARNING_FADE,
    { locked: true, strikeFlash: WAVE_BAND_FLASH },
  );
  const seed = Math.floor(wave.travelled / WAVE_JITTER_PERIOD_PX);
  ctx.save();
  ctx.translate(frontX - camX, frontY - camY);
  ctx.rotate(Math.atan2(wave.dirY, wave.dirX));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (): void => {
    ctx.beginPath();
    for (let i = 0; i <= WAVE_JITTER_STEPS; i++) {
      const across = -halfWidthPx + (i / WAVE_JITTER_STEPS) * halfWidthPx * 2;
      const kink = i === 0 || i === WAVE_JITTER_STEPS ? 0 : jitter(seed, i) * WAVE_JITTER_PX;
      if (i === 0) ctx.moveTo(kink, across);
      else ctx.lineTo(kink, across);
    }
  };
  path();
  ctx.strokeStyle = INK.waveGlow;
  ctx.lineWidth = WAVE_GLOW_WIDTH_PX;
  ctx.stroke();
  path();
  ctx.strokeStyle = INK.waveCore;
  ctx.lineWidth = WAVE_CORE_WIDTH_PX;
  ctx.stroke();
  ctx.restore();
}

const JITTER_SEED_SCALE = 12.9898;
const JITTER_INDEX_SCALE = 78.233;
const JITTER_MAGNITUDE = 43758.5453;

/** Deterministic noise in −1…1, so a wave's kinks hold still between redraws of one step. */
function jitter(seed: number, index: number): number {
  const mixed = Math.sin(seed * JITTER_SEED_SCALE + index * JITTER_INDEX_SCALE) * JITTER_MAGNITUDE;
  return (mixed - Math.floor(mixed)) * 2 - 1;
}
