import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { MOLD_LION_FIGURE } from './art/moldLionFigure';
import { figureFrameCount } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';

const IDLE_FPS = 6;
const MILLISECONDS_PER_SECOND = 1000;

export const MOLD_LION_STATES: ReadonlyArray<string> = ['idle', 'walk', 'attack'];

function frameCountOf(state: string): number {
  return Math.max(1, figureFrameCount(MOLD_LION_FIGURE, state));
}

/** Call when a spawn is scheduled, so a pride arriving together is not baked mid-frame. */
export function prewarmMoldLion(): void {
  for (const state of MOLD_LION_STATES) prewarmFigureState(MOLD_LION_FIGURE, state);
}

/** Poison aura — faint spore clouds that ooze outward from the mane. */
const AURA_PUFF_COUNT = 14;
/** Fraction of a puff's lifetime advanced per frame. */
const AURA_PUFF_DRIFT_SPEED = 0.0045;
/** Where in the aura radius a puff is born, as a fraction of the full radius. */
const AURA_PUFF_START_RADIUS_FRAC = 0.15;
const AURA_PUFF_END_RADIUS_FRAC = 1;
/** Puff blob size at birth and at full drift, as fractions of the aura radius. */
const AURA_PUFF_SIZE_START_FRAC = 0.16;
const AURA_PUFF_SIZE_END_FRAC = 0.42;
/** Peak opacity of a single puff; they overlap into a soft haze. */
const AURA_PUFF_PEAK_ALPHA = 0.16;
/** Extra opacity multiplier once the aura is actively poisoning. */
const AURA_ACTIVE_ALPHA_MULT = 2.1;
/** Sideways wobble of a drifting puff, as a fraction of the aura radius. */
const AURA_PUFF_WOBBLE_FRAC = 0.13;
const AURA_PUFF_WOBBLE_SPEED = 0.06;
/** Puffs sink slightly as they spread, so the cloud hugs the ground. */
const AURA_PUFF_SINK_FRAC = 0.12;
/** Irrational-ish angular step so puffs never form a visible spoke pattern. */
const AURA_PUFF_ANGLE_STEP = 2.399963;

/** Alpha ramp: a puff fades in over this fraction of its life, then fades out. */
const AURA_PUFF_FADE_IN_END = 0.25;
/** Vertical squash, so the cloud lies on the ground instead of forming a sphere. */
const AURA_PUFF_VERTICAL_SQUASH = 0.6;
/** Radial-gradient midpoint and its share of the puff's peak opacity. */
const AURA_PUFF_GRADIENT_MID_STOP = 0.55;
const AURA_PUFF_GRADIENT_MID_ALPHA_FRAC = 0.55;

/**
 * Resolution of the baked puff texture. The puff is a soft blob with no detail
 * to lose, so a small texture stretched to the puff's radius is indistinguishable
 * from a fresh gradient — and costs one drawImage instead of an allocation.
 */
const PUFF_TEXTURE_PX = 64;

const PUFF_CORE_COLOR = 'rgba(168, 226, 96, 1)';
const PUFF_MID_COLOR = `rgba(120, 190, 62, ${AURA_PUFF_GRADIENT_MID_ALPHA_FRAC})`;
const PUFF_EDGE_COLOR = 'rgba(96, 150, 48, 0)';

let puffTexture: CanvasSurface | null = null;

/**
 * The puff gradient is identical for every puff apart from position, size and
 * opacity — all of which the blit handles — so it is baked once at full opacity
 * instead of being reallocated fourteen times a frame per lion.
 */
function getPuffTexture(): CanvasSurface {
  if (puffTexture !== null) return puffTexture;
  const texture = allocCanvas(PUFF_TEXTURE_PX, PUFF_TEXTURE_PX);
  const texCtx = surfaceContext(texture);
  const radius = PUFF_TEXTURE_PX / 2;
  const gradient = texCtx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, PUFF_CORE_COLOR);
  gradient.addColorStop(AURA_PUFF_GRADIENT_MID_STOP, PUFF_MID_COLOR);
  gradient.addColorStop(1, PUFF_EDGE_COLOR);
  texCtx.fillStyle = gradient;
  texCtx.fillRect(0, 0, PUFF_TEXTURE_PX, PUFF_TEXTURE_PX);
  puffTexture = texture;
  return texture;
}

function puffAlphaEnvelope(life: number): number {
  if (life < AURA_PUFF_FADE_IN_END) return life / AURA_PUFF_FADE_IN_END;
  return 1 - (life - AURA_PUFF_FADE_IN_END) / (1 - AURA_PUFF_FADE_IN_END);
}

/**
 * Draw the drifting spore cloud that seeps off the lion's fungal mane. Each puff
 * is born near the body and expands outward as it fades, so the aura reads as
 * oozing gas rather than a flat coloured disc.
 */
function drawSporeCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  auraRadiusPx: number,
  auraPhase: number,
  isActive: boolean,
): void {
  const alphaMult = isActive ? AURA_ACTIVE_ALPHA_MULT : 1;

  const texture = getPuffTexture();

  ctx.save();
  for (let i = 0; i < AURA_PUFF_COUNT; i++) {
    const life = (((auraPhase * AURA_PUFF_DRIFT_SPEED + i / AURA_PUFF_COUNT) % 1) + 1) % 1;
    const alpha = puffAlphaEnvelope(life) * AURA_PUFF_PEAK_ALPHA * alphaMult;
    if (alpha <= 0) continue;

    const angle = i * AURA_PUFF_ANGLE_STEP;
    const distFrac =
      AURA_PUFF_START_RADIUS_FRAC +
      (AURA_PUFF_END_RADIUS_FRAC - AURA_PUFF_START_RADIUS_FRAC) * life;
    const wobble = Math.sin(auraPhase * AURA_PUFF_WOBBLE_SPEED + i) * AURA_PUFF_WOBBLE_FRAC;

    const px = cx + Math.cos(angle) * auraRadiusPx * distFrac + wobble * auraRadiusPx;
    const py =
      cy +
      Math.sin(angle) * auraRadiusPx * distFrac * AURA_PUFF_VERTICAL_SQUASH +
      life * AURA_PUFF_SINK_FRAC * auraRadiusPx;
    const puffRadius =
      auraRadiusPx *
      (AURA_PUFF_SIZE_START_FRAC + (AURA_PUFF_SIZE_END_FRAC - AURA_PUFF_SIZE_START_FRAC) * life);

    ctx.globalAlpha = alpha;
    const puffDiameter = puffRadius * 2;
    ctx.drawImage(texture, px - puffRadius, py - puffRadius, puffDiameter, puffDiameter);
  }
  ctx.restore();
}

/**
 * Draw a Mold Lion — a mutated lion bruiser whose mane has become a mass of
 * pulsating fungal growths that emit a poison aura. The aura is painted live,
 * not cached, because its puffs drift continuously.
 *
 * @param attackAnim 0–1 progress through the bite lunge (0 = idle/walk).
 * @param auraRadiusPx radius of the poison aura in screen pixels, 0 to hide it.
 * @param auraActive whether the aura is currently poisoning, which thickens the cloud.
 */
export function drawMoldLionSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
  auraRadiusPx = 0,
  auraPhase = 0,
  auraActive = false,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  if (auraRadiusPx > 0) {
    drawSporeCloud(ctx, cx, cy, auraRadiusPx, auraPhase, auraActive);
  }

  const flipX = facingX < 0;
  if (attackAnim > 0) {
    drawFigureCached(
      ctx,
      MOLD_LION_FIGURE,
      'attack',
      progressFrameIndex(attackAnim, frameCountOf('attack')),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  if (isMoving) {
    drawFigureCached(
      ctx,
      MOLD_LION_FIGURE,
      'walk',
      walkFrameIndex(walkFrame, frameCountOf('walk')),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }
  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
  drawFigureCached(
    ctx,
    MOLD_LION_FIGURE,
    'idle',
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf('idle')),
    sx,
    sy,
    s,
    { flipX },
  );
}
