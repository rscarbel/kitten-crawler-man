import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/** Body proportions (fractions of tile size). */
const LION_BODY_RX = 0.26;
const LION_BODY_RY = 0.18;
const LION_BODY_Y_OFFSET = 0.12;
const LION_HEAD_R = 0.15;
const LION_HEAD_Y_OFFSET = -0.1;
const LION_HEAD_X_OFFSET = 0.2;

/** Fungal mane — a ring of irregular mold-green blobs. */
const LION_MANE_BLOB_COUNT = 10;
const LION_MANE_R = 0.22;
const LION_MANE_BLOB_R_MIN = 0.05;
const LION_MANE_BLOB_R_MAX = 0.08;

/** Legs. */
const LION_LEG_WIDTH = 0.07;
const LION_LEG_HEIGHT = 0.16;
const LION_LEG_X_OFFSET = 0.16;
const LION_LEG_Y_OFFSET = 0.22;
const LION_LEG_SWING_AMP = 0.09;

/** Eyes and jaw. */
const LION_EYE_R = 0.035;
const LION_EYE_X_OFFSET = 0.06;
const LION_EYE_Y_OFFSET = -0.02;
const LION_EYE_GLOW_RADIUS = 5;
const LION_ATTACK_LUNGE = 0.1;

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
 * pulsating fungal growths that emit a poison aura.
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

  ctx.save();
  ctx.translate(cx, cy);
  if (facingX < 0) ctx.scale(-1, 1);

  const swayPhase = isMoving ? Math.sin(walkFrame) : 0;
  const lunge = attackAnim > 0 ? Math.sin(attackAnim * Math.PI) * LION_ATTACK_LUNGE * s : 0;

  // Legs
  ctx.fillStyle = '#5a6b3a';
  const legSwing = isMoving ? swayPhase * LION_LEG_SWING_AMP * s : 0;
  ctx.fillRect(
    -LION_LEG_X_OFFSET * s - LION_LEG_WIDTH * s * 0.5,
    LION_LEG_Y_OFFSET * s + legSwing,
    LION_LEG_WIDTH * s,
    LION_LEG_HEIGHT * s,
  );
  ctx.fillRect(
    LION_LEG_X_OFFSET * s - LION_LEG_WIDTH * s * 0.5,
    LION_LEG_Y_OFFSET * s - legSwing,
    LION_LEG_WIDTH * s,
    LION_LEG_HEIGHT * s,
  );

  // Body
  ctx.fillStyle = '#7a8a4a';
  ctx.beginPath();
  ctx.ellipse(lunge, LION_BODY_Y_OFFSET * s, LION_BODY_RX * s, LION_BODY_RY * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fungal mane — irregular mold-green blobs, gently pulsing
  const headX = lunge + LION_HEAD_X_OFFSET * s;
  const headY = LION_HEAD_Y_OFFSET * s;
  for (let i = 0; i < LION_MANE_BLOB_COUNT; i++) {
    const a = (i / LION_MANE_BLOB_COUNT) * Math.PI * 2;
    const wobble = Math.sin(auraPhase * 0.1 + i) * 0.15 + 1;
    const bx = headX + Math.cos(a) * LION_MANE_R * s * wobble;
    const by = headY + Math.sin(a) * LION_MANE_R * s * wobble;
    const r = (LION_MANE_BLOB_R_MIN + (i % 3) * 0.01) * s;
    ctx.fillStyle = i % 2 === 0 ? '#4a6b2a' : '#6a8a3a';
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(r, LION_MANE_BLOB_R_MIN * s * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5a7a3a';
  ctx.beginPath();
  ctx.arc(headX, headY, LION_MANE_BLOB_R_MAX * s * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#8a9a5a';
  ctx.beginPath();
  ctx.arc(headX, headY, LION_HEAD_R * s, 0, Math.PI * 2);
  ctx.fill();

  // Glowing toxic eyes
  ctx.save();
  ctx.shadowColor = '#c8f850';
  ctx.shadowBlur = LION_EYE_GLOW_RADIUS;
  ctx.fillStyle = '#d8ff70';
  ctx.beginPath();
  ctx.arc(
    headX + LION_EYE_X_OFFSET * s,
    headY + LION_EYE_Y_OFFSET * s,
    LION_EYE_R * s,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
