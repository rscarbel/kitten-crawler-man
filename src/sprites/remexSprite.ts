/** Pillar proportions (fractions of tile size, centred coordinates). */
const REMEX_BASE_HALF_WIDTH = 0.22;
const REMEX_TOP_HALF_WIDTH = 0.13;
const REMEX_TOP_Y = -0.42;
const REMEX_BASE_Y = 0.45;

/** The face still visible in the flesh, halfway up the column. */
const REMEX_FACE_Y = -0.12;
const REMEX_EYE_R = 0.025;
const REMEX_EYE_X = 0.05;
const REMEX_MOUTH_HALF_WIDTH = 0.05;
const REMEX_MOUTH_Y_OFFSET = 0.09;

/** Soul conduits — glowing veins running up the column. */
const CONDUIT_COUNT = 3;
const CONDUIT_X_SPREAD = 0.1;
const CONDUIT_WAVE_AMP = 0.03;
const CONDUIT_WAVE_SPEED = 1.6;
const CONDUIT_SEGMENTS = 5;

/** The soul-charge orb pulsing at the crown. */
const ORB_R = 0.09;
const ORB_PULSE_AMP = 0.02;
const ORB_PULSE_SPEED = 3.2;
const ORB_GLOW_RADIUS = 10;

const MS_PER_SECOND = 1000;

const FLESH_COLOR = '#8a6a70';
const FLESH_SHADE = '#6c4f56';
const CONDUIT_COLOR = '#a78bfa';
const ORB_COLOR = '#c4b5fd';
const EYE_COLOR = '#f5f3ff';

/**
 * Draw Remex — Miss Quill's husband, transformed into a living soul
 * capacitor: a column of fused flesh threaded with glowing conduits, his
 * face still visible halfway up, a charge orb pulsing at the crown.
 *
 * @param phase monotonically increasing animation counter (frames).
 * @param hpFraction 0–1 — conduits dim as the capacitor is destroyed.
 */
export function drawRemexSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phase: number,
  hpFraction: number,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const timeSec = performance.now() / MS_PER_SECOND;

  ctx.save();
  ctx.translate(cx, cy);

  // Flesh column — a tapered trunk
  ctx.fillStyle = FLESH_COLOR;
  ctx.beginPath();
  ctx.moveTo(-REMEX_BASE_HALF_WIDTH * s, REMEX_BASE_Y * s);
  ctx.quadraticCurveTo(
    -REMEX_BASE_HALF_WIDTH * s * 1.1,
    0,
    -REMEX_TOP_HALF_WIDTH * s,
    REMEX_TOP_Y * s,
  );
  ctx.lineTo(REMEX_TOP_HALF_WIDTH * s, REMEX_TOP_Y * s);
  ctx.quadraticCurveTo(
    REMEX_BASE_HALF_WIDTH * s * 1.1,
    0,
    REMEX_BASE_HALF_WIDTH * s,
    REMEX_BASE_Y * s,
  );
  ctx.closePath();
  ctx.fill();

  // Shaded left flank for volume
  ctx.fillStyle = FLESH_SHADE;
  ctx.beginPath();
  ctx.moveTo(-REMEX_BASE_HALF_WIDTH * s, REMEX_BASE_Y * s);
  ctx.quadraticCurveTo(
    -REMEX_BASE_HALF_WIDTH * s * 1.1,
    0,
    -REMEX_TOP_HALF_WIDTH * s,
    REMEX_TOP_Y * s,
  );
  ctx.lineTo(-REMEX_TOP_HALF_WIDTH * s * 0.3, REMEX_TOP_Y * s);
  ctx.quadraticCurveTo(
    -REMEX_BASE_HALF_WIDTH * s * 0.5,
    0,
    -REMEX_BASE_HALF_WIDTH * s * 0.55,
    REMEX_BASE_Y * s,
  );
  ctx.closePath();
  ctx.fill();

  // Soul conduits climbing the column, dimming as HP falls
  const conduitAlpha = 0.35 + 0.65 * hpFraction;
  ctx.strokeStyle = CONDUIT_COLOR;
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.globalAlpha = conduitAlpha;
  for (let cIdx = 0; cIdx < CONDUIT_COUNT; cIdx++) {
    const baseX = (cIdx - (CONDUIT_COUNT - 1) / 2) * CONDUIT_X_SPREAD * s;
    ctx.beginPath();
    for (let seg = 0; seg <= CONDUIT_SEGMENTS; seg++) {
      const t = seg / CONDUIT_SEGMENTS;
      const y = REMEX_BASE_Y * s + (REMEX_TOP_Y - REMEX_BASE_Y) * s * t;
      const wave =
        Math.sin(timeSec * CONDUIT_WAVE_SPEED + cIdx * 2 + t * 5 + phase * 0.01) *
        CONDUIT_WAVE_AMP *
        s;
      if (seg === 0) ctx.moveTo(baseX + wave, y);
      else ctx.lineTo(baseX + wave, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The face — eyes shut tight, mouth a thin line of effort
  ctx.fillStyle = EYE_COLOR;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      side * REMEX_EYE_X * s,
      REMEX_FACE_Y * s,
      REMEX_EYE_R * s,
      REMEX_EYE_R * s * 0.4,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = FLESH_SHADE;
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.beginPath();
  ctx.moveTo(-REMEX_MOUTH_HALF_WIDTH * s, (REMEX_FACE_Y + REMEX_MOUTH_Y_OFFSET) * s);
  ctx.lineTo(REMEX_MOUTH_HALF_WIDTH * s, (REMEX_FACE_Y + REMEX_MOUTH_Y_OFFSET) * s);
  ctx.stroke();

  // Crown orb — the capacitor's soul charge
  const orbR = (ORB_R + Math.sin(timeSec * ORB_PULSE_SPEED) * ORB_PULSE_AMP) * s;
  ctx.save();
  ctx.shadowColor = ORB_COLOR;
  ctx.shadowBlur = ORB_GLOW_RADIUS * (0.4 + 0.6 * hpFraction);
  ctx.fillStyle = ORB_COLOR;
  ctx.globalAlpha = conduitAlpha;
  ctx.beginPath();
  ctx.arc(0, REMEX_TOP_Y * s - orbR * 0.6, orbR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
