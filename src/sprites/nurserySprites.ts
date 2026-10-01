/**
 * The goblin nursery's props on screen: baked barrier and wood-pile art, and
 * the live bits that cannot be baked — torch flames and their light, and the
 * things moving in the dark under an open grate.
 *
 * The barrier and pile are painted once per pose into small surfaces and
 * blitted from then on; a pose is a handful of discrete stages, so the set is
 * bounded (well under two megabytes all told) and is only ever built for a
 * floor that has a nursery.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import {
  BARRIER_ART_MARGIN,
  BARRIER_DAMAGE_STAGES,
  BARRIER_PLANK_COUNT,
  BARRIER_VARIANTS,
  TORCH_FLAME_ROOT,
  WOOD_PILE_OVERHANG,
  WOOD_PILE_RISE,
  paintBarrier,
  paintWallTorch,
  paintWoodPile,
  type BarrierPose,
} from './art/nurseryArt';
import { drawRadialGlow, type GlowStop } from './radialGlow';

/** Surface pixels per logical pixel: enough for a zoomed-in or high-DPI view to stay crisp. */
const ART_SCALE = 3;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

const surfaces = new Map<string, CanvasSurface>();

function bake(
  key: string,
  widthTiles: number,
  heightTiles: number,
  ts: number,
  paint: (ctx: CanvasRenderingContext2D, scaledTs: number) => void,
): CanvasSurface {
  const cached = surfaces.get(key);
  if (cached !== undefined) return cached;
  const scaledTs = ts * ART_SCALE;
  const surface = allocCanvas(Math.ceil(widthTiles * scaledTs), Math.ceil(heightTiles * scaledTs));
  paint(surfaceContext(surface), scaledTs);
  surfaces.set(key, surface);
  return surface;
}

/** Which of the barrier's damage stages a health fraction shows. */
export function barrierDamageStage(hpFraction: number): number {
  const damage = 1 - Math.max(0, Math.min(1, hpFraction));
  return Math.min(BARRIER_DAMAGE_STAGES - 1, Math.floor(damage * BARRIER_DAMAGE_STAGES));
}

/**
 * Draws a barrier over the grate tile at screen (sx, sy).
 *
 * `variant` is any integer (a grate's index works); `offsetX`/`offsetY` shake
 * the whole panel without re-baking it.
 */
export function drawNurseryBarrier(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  pose: BarrierPose,
): void {
  const variant = ((pose.variant % BARRIER_VARIANTS) + BARRIER_VARIANTS) % BARRIER_VARIANTS;
  const planksLaid = Math.max(0, Math.min(BARRIER_PLANK_COUNT, pose.planksLaid));
  if (planksLaid === 0) return;
  const damageStage = planksLaid < BARRIER_PLANK_COUNT ? 0 : pose.damageStage;
  const spanTiles = 1 + BARRIER_ART_MARGIN * 2;
  const surface = bake(
    `barrier:${ts}:${variant}:${damageStage}:${planksLaid}`,
    spanTiles,
    spanTiles,
    ts,
    (bakeCtx, scaledTs) => {
      const margin = scaledTs * BARRIER_ART_MARGIN;
      paintBarrier(bakeCtx, margin, margin, scaledTs, { variant, damageStage, planksLaid });
    },
  );
  const margin = ts * BARRIER_ART_MARGIN;
  ctx.drawImage(surface, sx - margin, sy - margin, ts * spanTiles, ts * spanTiles);
}

/** Draws the wood pile on the tile at screen (sx, sy). */
export function drawNurseryWoodPile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  stocked: boolean,
): void {
  const widthTiles = 1 + WOOD_PILE_OVERHANG * 2;
  const heightTiles = 1 + WOOD_PILE_RISE;
  const surface = bake(
    `pile:${ts}:${stocked ? 'stocked' : 'depleted'}`,
    widthTiles,
    heightTiles,
    ts,
    (bakeCtx, scaledTs) => {
      paintWoodPile(
        bakeCtx,
        scaledTs * WOOD_PILE_OVERHANG,
        scaledTs * WOOD_PILE_RISE,
        scaledTs,
        stocked,
      );
    },
  );
  ctx.drawImage(
    surface,
    sx - ts * WOOD_PILE_OVERHANG,
    sy - ts * WOOD_PILE_RISE,
    ts * widthTiles,
    ts * heightTiles,
  );
}

/** How high above its tile the stocked pile's top stands, for placing a label over it. */
export const WOOD_PILE_TOP_RISE_TILES = WOOD_PILE_RISE;

// ── Torches ─────────────────────────────────────────────────────────────────

const FLAME_HEIGHT = 0.34;
const FLAME_WIDTH = 0.16;
const FLAME_FLICKER_HZ_A = 7.3;
const FLAME_FLICKER_HZ_B = 11.9;
const FLAME_FLICKER_DEPTH = 0.18;
const FLAME_SWAY = 0.04;
const MS_PER_SECOND = 1000;
const FLAME_LAYERS: ReadonlyArray<{ scale: number; color: string }> = [
  { scale: 1, color: 'rgba(226,69,15,0.85)' },
  { scale: 0.72, color: 'rgba(255,138,30,0.95)' },
  { scale: 0.48, color: 'rgba(255,210,74,1)' },
  { scale: 0.26, color: 'rgba(255,246,207,1)' },
];
const EMBER_COUNT = 3;
const EMBER_RISE = 0.5;
const EMBER_PERIOD_MS = 1300;
const EMBER_SIZE = 0.03;
const EMBER_COLOR = 'rgba(255,170,70,';

/** Draws a wall torch — bracket, haft, live flame — on the wall tile at screen (sx, sy). */
export function drawNurseryTorch(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  nowMs: number,
  seed: number,
): void {
  const surface = bake(`torch:${ts}`, 1, 1, ts, (bakeCtx, scaledTs) => {
    paintWallTorch(bakeCtx, 0, 0, scaledTs);
  });
  ctx.drawImage(surface, sx, sy, ts, ts);

  const seconds = nowMs / MS_PER_SECOND + seed;
  const flicker =
    1 +
    FLAME_FLICKER_DEPTH *
      HALF *
      (Math.sin(seconds * FLAME_FLICKER_HZ_A) + Math.sin(seconds * FLAME_FLICKER_HZ_B));
  const rootX = sx + ts * TORCH_FLAME_ROOT.x;
  const rootY = sy + ts * TORCH_FLAME_ROOT.y;
  const sway = Math.sin(seconds * FLAME_FLICKER_HZ_A * HALF) * ts * FLAME_SWAY;
  for (const layer of FLAME_LAYERS) {
    const height = ts * FLAME_HEIGHT * layer.scale * flicker;
    const width = ts * FLAME_WIDTH * layer.scale;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(rootX - width * HALF, rootY);
    ctx.quadraticCurveTo(rootX - width * HALF, rootY - height * HALF, rootX + sway, rootY - height);
    ctx.quadraticCurveTo(rootX + width * HALF, rootY - height * HALF, rootX + width * HALF, rootY);
    ctx.quadraticCurveTo(rootX, rootY + width * HALF, rootX - width * HALF, rootY);
    ctx.fill();
  }
  for (let ember = 0; ember < EMBER_COUNT; ember++) {
    const phase =
      ((nowMs + (ember * EMBER_PERIOD_MS) / EMBER_COUNT + seed * MS_PER_SECOND) % EMBER_PERIOD_MS) /
      EMBER_PERIOD_MS;
    const x = rootX + Math.sin(phase * FULL_TURN + ember) * ts * FLAME_WIDTH * HALF;
    const y = rootY - ts * FLAME_HEIGHT - phase * ts * EMBER_RISE;
    const size = ts * EMBER_SIZE;
    ctx.fillStyle = `${EMBER_COLOR}${(1 - phase).toFixed(2)})`;
    ctx.fillRect(x, y, size, size);
  }
}

// ── Lurkers under an open grate ─────────────────────────────────────────────

const EYE_PERIOD_MS = 4200;
/** The share of each period the eyes are open; the rest they are shut or gone. */
const EYES_OPEN_FRACTION = 0.55;
const EYE_SPACING = 0.12;
const EYE_RADIUS = 0.028;
const EYE_WANDER = 0.12;
/** An eye's glint colour, open-ended so the caller appends its own alpha and `)`. */
export const EYE_COLOR = 'rgba(230,220,90,';
/** The faint halo round a pair of eyes in the dark. */
export const EYE_GLOW_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(210,220,90,0.3)' },
  { offset: 1, color: 'rgba(210,220,90,0)' },
];
const EYE_GLOW_RADIUS = 0.2;
const CLAW_PERIOD_MS = 2600;
const CLAW_SHOW_FRACTION = 0.35;
const CLAW_COUNT = 3;
const CLAW_LENGTH = 0.1;
const CLAW_SPACING = 0.06;
const CLAW_WIDTH = 0.025;
const CLAW_COLOR = '#d9d2bd';
const CLAW_EDGE = '#1a1410';
const LURKER_GRATE_TOP = 0.34;
/**
 * Draws what moves in the dark under an open grate at screen (sx, sy): eyes
 * that open and drift, and claws that hook over a bar and slide back. `urgency`
 * (0–1) shortens the cycle, so a wave in full flow scrabbles harder than the
 * staging countdown.
 */
export function drawGrateLurkers(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  nowMs: number,
  seed: number,
  urgency: number,
): void {
  const speed = 1 + urgency;
  const eyePhase = ((((nowMs * speed) / EYE_PERIOD_MS + seed * EYE_SEED_SPREAD) % 1) + 1) % 1;
  if (eyePhase < EYES_OPEN_FRACTION) {
    const open = Math.sin((eyePhase / EYES_OPEN_FRACTION) * Math.PI);
    const drift = Math.sin(eyePhase * FULL_TURN + seed) * ts * EYE_WANDER;
    const cx = sx + ts * HALF + drift;
    const cy = sy + ts * HALF;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawRadialGlow(ctx, cx, cy, ts * EYE_GLOW_RADIUS * open, EYE_GLOW_STOPS);
    ctx.restore();
    ctx.fillStyle = `${EYE_COLOR}${open.toFixed(2)})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        cx + side * ts * EYE_SPACING * HALF,
        cy,
        ts * EYE_RADIUS,
        ts * EYE_RADIUS * open,
        0,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  }

  const clawPhase = ((((nowMs * speed) / CLAW_PERIOD_MS + seed * CLAW_SEED_SPREAD) % 1) + 1) % 1;
  if (clawPhase < CLAW_SHOW_FRACTION) {
    const reach = Math.sin((clawPhase / CLAW_SHOW_FRACTION) * Math.PI);
    const baseX = sx + ts * (HALF - CLAW_SPACING);
    const barY = sy + ts * LURKER_GRATE_TOP;
    ctx.lineCap = 'round';
    for (let claw = 0; claw < CLAW_COUNT; claw++) {
      const x = baseX + claw * ts * CLAW_SPACING;
      const tipY = barY - ts * CLAW_LENGTH * reach;
      ctx.strokeStyle = CLAW_EDGE;
      ctx.lineWidth = ts * CLAW_WIDTH * CLAW_OUTLINE_SCALE;
      ctx.beginPath();
      ctx.moveTo(x, barY + ts * CLAW_LENGTH * HALF);
      ctx.quadraticCurveTo(x, tipY, x + ts * CLAW_HOOK, tipY + ts * CLAW_HOOK);
      ctx.stroke();
      ctx.strokeStyle = CLAW_COLOR;
      ctx.lineWidth = ts * CLAW_WIDTH;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

const EYE_SEED_SPREAD = 0.37;
const CLAW_SEED_SPREAD = 0.61;
const CLAW_OUTLINE_SCALE = 1.8;
const CLAW_HOOK = 0.03;
