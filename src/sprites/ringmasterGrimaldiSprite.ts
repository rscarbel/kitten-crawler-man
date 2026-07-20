/**
 * Visual span of the vine mass in tiles — the entity occupies one tile but
 * the boss reads as an enormous bush wrapped around the big top's pole.
 */
const VINE_SCALE = 3.2;

/** Layered bush mass (fractions of the scaled size). */
const BUSH_LAYER_COUNT = 3;
const BUSH_RX = 0.5;
const BUSH_RY = 0.34;
const BUSH_Y_OFFSET = 0.05;
const BREATHE_SPEED = 0.04;
const BREATHE_AMP = 0.02;

/** Central tent pole the vine is wrapped around. */
const POLE_WIDTH = 0.05;
const POLE_TOP_Y = -0.75;
const POLE_BASE_Y = 0.4;

/** Massive root limbs radiating out from the trunk. */
const LIMB_COUNT = 7;
const LIMB_SEGMENT_COUNT = 5;
const LIMB_LENGTH = 0.55;
const LIMB_BASE_WIDTH = 0.09;
const LIMB_TIP_WIDTH = 0.025;
const LIMB_SWAY_AMP = 0.05;
const LIMB_THORN_LEN = 0.045;

/** Wrapping coils climbing the pole above the bush. */
const COIL_COUNT = 3;
const COIL_SPACING = 0.16;
const COIL_RX = 0.1;
const COIL_RY = 0.045;

/** Faint overgrown face — bark knots where Grimaldi's features once were. */
const KNOT_EYE_X = 0.1;
const KNOT_EYE_Y = -0.08;
const KNOT_EYE_R = 0.035;
const KNOT_GLOW_RADIUS = 6;

/** Spore motes drifting over the mass. */
const SPORE_COUNT = 5;
const SPORE_R = 0.018;
const SPORE_DRIFT_SPEED = 0.013;
const SPORE_ORBIT_RX = 0.45;
const SPORE_ORBIT_RY = 0.3;

/** Invulnerability shimmer while tendrils are alive. */
const SHIELD_PULSE_SPEED = 0.06;
const SHIELD_ALPHA_BASE = 0.1;
const SHIELD_ALPHA_PULSE = 0.06;

/** Root-slam attack: one limb rears up then crashes down. */
const SLAM_LIMB_INDEX = 1;
const SLAM_LIFT_ANGLE = 0.9;

const VINE_DARK = '#2a4a1a';
const VINE_MID = '#5a8a4a';
const VINE_PALE = '#8fbf7a';
const VINE_HIGHLIGHT = '#a8d494';
const POLE_COLOR = '#4a3520';
const THORN_COLOR = '#1a3a0a';

/**
 * Draw Grimaldi the Pestiferous Vine — an enormous pale-green bush wrapped
 * around the big top's central tent pole, massive thorned roots radiating
 * from the trunk. What is left of the old dwarf ringmaster is only a
 * suggestion of a face in the bark knots.
 *
 * @param phase animation accumulator, incremented each frame by the caller.
 * @param invulnerable true while any vine tendril (root) is still alive.
 * @param attackAnim 0..1 root-slam progress: 0–0.5 rears the limb, 0.5–1 slams it down.
 */
export function drawRingmasterGrimaldiSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phase = 0,
  invulnerable = false,
  hitFlash = false,
  attackAnim = 0,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;
  const gs = s * VINE_SCALE;
  const breathe = Math.sin(phase * BREATHE_SPEED) * BREATHE_AMP;

  ctx.save();
  ctx.translate(cx, cy);

  // Tent pole rising through the mass
  ctx.fillStyle = POLE_COLOR;
  ctx.fillRect(
    -POLE_WIDTH * gs * 0.5,
    POLE_TOP_Y * gs,
    POLE_WIDTH * gs,
    (POLE_BASE_Y - POLE_TOP_Y) * gs,
  );

  // Vine coils wrapped around the pole above the bush
  ctx.strokeStyle = VINE_MID;
  ctx.lineWidth = Math.max(2, gs * 0.03);
  for (let i = 0; i < COIL_COUNT; i++) {
    const coilY = (POLE_TOP_Y + 0.12 + i * COIL_SPACING) * gs;
    const wobble = Math.sin(phase * BREATHE_SPEED + i) * 0.02 * gs;
    ctx.beginPath();
    ctx.ellipse(wobble, coilY, COIL_RX * gs, COIL_RY * gs, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Massive root limbs radiating from the trunk — drawn before the bush so
  // they emerge from underneath it.
  for (let i = 0; i < LIMB_COUNT; i++) {
    const spreadAngle = (i / (LIMB_COUNT - 1)) * Math.PI;
    const isSlamLimb = attackAnim > 0 && i === SLAM_LIMB_INDEX;
    // 0–0.5 rears the limb upward, 0.5–1 whips it back to the ground.
    const slamLift = isSlamLimb
      ? Math.sin(Math.min(attackAnim, 0.5) * Math.PI) * SLAM_LIFT_ANGLE
      : 0;
    const slamReturn = isSlamLimb && attackAnim > 0.5 ? (attackAnim - 0.5) * 2 : 0;
    const lift = slamLift * (1 - slamReturn);

    const dirX = Math.cos(spreadAngle);
    const baseDirY = 0.45 + 0.25 * Math.sin(spreadAngle);

    let prevX = 0;
    let prevY = BUSH_Y_OFFSET * gs;
    for (let seg = 1; seg <= LIMB_SEGMENT_COUNT; seg++) {
      const t = seg / LIMB_SEGMENT_COUNT;
      const sway = Math.sin(phase * 0.02 + i * 1.7 + t * 2) * LIMB_SWAY_AMP * gs * t;
      const px = dirX * t * LIMB_LENGTH * gs + sway;
      const py = BUSH_Y_OFFSET * gs + baseDirY * t * LIMB_LENGTH * gs - lift * t * LIMB_LENGTH * gs;
      const width = (LIMB_BASE_WIDTH + (LIMB_TIP_WIDTH - LIMB_BASE_WIDTH) * t) * gs;
      ctx.strokeStyle = t < 0.5 ? VINE_DARK : VINE_MID;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(px, py);
      ctx.stroke();

      // Thorn on alternating segments
      if (seg % 2 === 0) {
        const side = seg % 4 === 0 ? 1 : -1;
        ctx.strokeStyle = THORN_COLOR;
        ctx.lineWidth = Math.max(1, gs * 0.012);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + side * LIMB_THORN_LEN * gs, py - LIMB_THORN_LEN * gs * 0.5);
        ctx.stroke();
      }
      prevX = px;
      prevY = py;
    }
  }

  // Layered bush mass — dark base swelling to pale green highlights
  const layerColors = [VINE_DARK, VINE_PALE, VINE_HIGHLIGHT] as const;
  for (let layer = 0; layer < BUSH_LAYER_COUNT; layer++) {
    const shrink = 1 - layer * 0.28;
    const wobbleX = Math.sin(phase * BREATHE_SPEED + layer * 2) * 0.02 * gs;
    ctx.fillStyle = layerColors[layer];
    // Each layer is a cluster of overlapping lobes rather than one clean ellipse
    for (let lobe = -1; lobe <= 1; lobe++) {
      ctx.beginPath();
      ctx.ellipse(
        lobe * BUSH_RX * gs * 0.35 * shrink + wobbleX,
        (BUSH_Y_OFFSET - layer * 0.06 + Math.abs(lobe) * 0.05) * gs,
        BUSH_RX * gs * 0.62 * shrink * (1 + breathe),
        BUSH_RY * gs * shrink * (1 + breathe),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // The faint suggestion of the dwarf's face is only two ember-red knots in
  // the bark — no mouth, nothing that reads as an expression.
  ctx.save();
  ctx.shadowColor = '#ff3020';
  ctx.shadowBlur = KNOT_GLOW_RADIUS;
  ctx.fillStyle = hitFlash ? '#ffffff' : 'rgba(180,50,35,0.55)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * KNOT_EYE_X * gs, KNOT_EYE_Y * gs, KNOT_EYE_R * gs, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Spore motes drifting around the canopy
  ctx.fillStyle = 'rgba(200,240,150,0.6)';
  for (let i = 0; i < SPORE_COUNT; i++) {
    const a = phase * SPORE_DRIFT_SPEED + (i / SPORE_COUNT) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      Math.cos(a) * SPORE_ORBIT_RX * gs,
      BUSH_Y_OFFSET * gs - 0.1 * gs + Math.sin(a * 1.3) * SPORE_ORBIT_RY * gs,
      SPORE_R * gs,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Invulnerability shimmer while the roots protect the trunk
  if (invulnerable) {
    const pulse = SHIELD_ALPHA_BASE + Math.sin(phase * SHIELD_PULSE_SPEED) * SHIELD_ALPHA_PULSE;
    ctx.fillStyle = `rgba(120, 220, 90, ${Math.max(0, pulse)})`;
    ctx.beginPath();
    ctx.ellipse(0, BUSH_Y_OFFSET * gs, BUSH_RX * gs * 1.25, BUSH_RY * gs * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
