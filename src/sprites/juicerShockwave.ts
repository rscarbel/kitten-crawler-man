/**
 * The wave the Juicer drives out of the gym floor when he puts both fists
 * through it.
 *
 * Same physics as Carl's stamp — compressed air bending the light over a ring
 * that runs outward — but a different floor. Carl lands on dungeon stone and
 * throws grit; the Juicer lands on rubber matting and throws chalk, so the
 * scuff is a black rubber burn, the dust is the pale powder off his hands, and
 * the chunks are torn mat rather than broken flagstone.
 *
 * It is drawn rather than baked for the reason every gameplay-sized effect is:
 * the ring has to stop exactly on the radius the punch damaged, so what the
 * player watches it sweep over is what it hit. There is no burst layer here —
 * a slug of air leaving the floor is the signature of a heel coming down from
 * height, and this is two fists driven forward into the ground.
 */

const TWO_PI = Math.PI * 2;

/** The world is seen at a slight tilt, so anything flat on the floor squashes. */
const GROUND_SQUASH = 0.55;

// ── The mat under his fists ──────────────────────────────────────────────────

/** Rubber scorched black where the knuckles landed, as a fraction of radius. */
const SCUFF_RADIUS_FRACTION = 0.3;
const SCUFF_ALPHA = 0.38;
const SCUFF_CORE_TINT = '24, 22, 24';
const SCUFF_EDGE_TINT = '46, 40, 38';
/** Where the scuff's mid stop sits, between its core and its transparent rim. */
const SCUFF_MID_STOP = 0.65;
const SCUFF_MID_ALPHA_SHARE = 0.45;

// ── Compression ring ─────────────────────────────────────────────────────────

/**
 * The refraction is two bands, never a stroke of some colour: the dark one on
 * the inside of the front where air is piling up, the pale one just outside on
 * the rarefied side. Reversed, the ring reads as a solid object flying out.
 */
const LENS_DARK_WIDTH_PX = 14;
const LENS_LIGHT_WIDTH_PX = 5;
const LENS_DARK_ALPHA = 0.7;
const LENS_LIGHT_ALPHA = 0.5;
/** How far inside the wave front the dark band trails, as a fraction of radius. */
const LENS_DARK_TRAIL = 0.05;
/** The bands thin as the wave spends itself. */
const LENS_THIN_TO = 0.4;
/** Warmer than Carl's cold dungeon air — a gym is lit yellow. */
const LENS_DARK_TINT = '104, 92, 78';
const LENS_LIGHT_TINT = '246, 240, 224';

/**
 * Ripples behind the leading front: each runs at a fraction of its speed and
 * reads fainter. One ring is a hoop; a train of them is a pressure wave.
 */
const RIPPLES = [
  { rate: 0.7, strength: 0.5 },
  { rate: 0.45, strength: 0.28 },
] as const;

// ── Chalk the wave drags with it ─────────────────────────────────────────────

const CHALK_RING_WIDTH_PX = 26;
const CHALK_RING_ALPHA = 0.42;
/** How far behind the front the powder lags — it cannot keep up. */
const CHALK_RING_TRAIL = 0.13;
/** How much the ring narrows by the time the front has spent itself. */
const CHALK_RING_THIN = 0.4;
const CHALK_TINT = '236, 232, 224';
const CHALK_PLUME_COUNT = 18;
const CHALK_PLUME_ARC = 0.17;
/** How far past the ring a plume may be flung, as a fraction of its radius. */
const CHALK_PLUME_OVERRUN = 0.15;
const CHALK_PLUME_SIZE = 0.1;
const CHALK_PLUME_SIZE_FLOOR = 0.6;
const CHALK_PLUME_SIZE_RANGE = 0.8;

// ── Torn matting ─────────────────────────────────────────────────────────────

const DEBRIS_COUNT = 10;
const DEBRIS_SIZE_PX = 5;
const DEBRIS_SPEED_FLOOR = 0.4;
const DEBRIS_SPEED_SPREAD = 0.5;
const DEBRIS_ANGLE_JITTER = 0.5;
/** Height of the hop a shred takes before it lands, as a fraction of radius. */
const DEBRIS_ARC = 0.36;
const DEBRIS_SIZE_FLOOR = 0.6;
const DEBRIS_SIZE_RANGE = 0.9;
/** Turns the spin rate into radians over a shred's whole life. */
const DEBRIS_SPIN_TURNS = 18;
const DEBRIS_SPIN = 0.28;
const DEBRIS_TINT = '38, 34, 34';
/** Splits the noise range so half the shreds spin each way. */
const HALF = 0.5;

// ── Chalk hanging in the air afterwards ──────────────────────────────────────

const HAZE_PUFFS = 9;
/** How far into the effect the powder starts to hang, as a share of its life. */
const HAZE_STARTS_AT = 0.32;
const HAZE_RISE_PX = 26;
const HAZE_ALPHA = 0.22;
const HAZE_SPREAD = 1.2;
const HAZE_PUFF_FRACTION = 0.36;
const HAZE_PUFF_SQUASH = 0.75;
const HAZE_DRIFT_FLOOR = 0.9;
const HAZE_DRIFT_GAIN = 1.4;
const HAZE_PUFF_FLOOR = 0.5;
const HAZE_PUFF_RANGE = 0.7;
/** Where the puff gradient's mid stop sits, between core and transparent rim. */
const HAZE_MID_STOP = 0.6;
const HAZE_MID_ALPHA_SHARE = 0.55;

const HASH_SEED_SCALE = 12.9898;
const HASH_INDEX_SCALE = 78.233;
const HASH_MAGNITUDE = 43758.5453;

/** Deterministic 0–1 noise, so one wave's debris does not crawl per frame. */
function noise(seed: number, index: number): number {
  const mixed = Math.sin(seed * HASH_SEED_SCALE + index * HASH_INDEX_SCALE) * HASH_MAGNITUDE;
  return mixed - Math.floor(mixed);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function drawScuff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fade: number,
): void {
  const scuffRadius = radius * SCUFF_RADIUS_FRACTION;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH);
  // The gradient has to be built in the space it is painted in, or it lands at
  // twice the offset and paints nothing.
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, scuffRadius);
  gradient.addColorStop(0, `rgba(${SCUFF_CORE_TINT}, ${SCUFF_ALPHA * fade})`);
  gradient.addColorStop(
    SCUFF_MID_STOP,
    `rgba(${SCUFF_EDGE_TINT}, ${SCUFF_ALPHA * SCUFF_MID_ALPHA_SHARE * fade})`,
  );
  gradient.addColorStop(1, `rgba(${SCUFF_EDGE_TINT}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, scuffRadius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * One compression front. `travel` is 0 at the fists and 1 when the front has
 * reached the full punch radius.
 */
function drawCompressionRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  travel: number,
  strength: number,
): void {
  if (travel <= 0 || travel >= 1) return;
  const ringRadius = radius * travel;
  const fade = (1 - travel) * strength;
  const thin = 1 - travel * (1 - LENS_THIN_TO);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH);

  // Piled-up air on the inside of the front: darkens whatever it crosses.
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = `rgba(${LENS_DARK_TINT}, ${LENS_DARK_ALPHA * fade})`;
  ctx.lineWidth = LENS_DARK_WIDTH_PX * thin;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius * (1 - LENS_DARK_TRAIL), 0, TWO_PI);
  ctx.stroke();

  // Thinned air on the outside: brightens it. The two together are the lens.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(${LENS_LIGHT_TINT}, ${LENS_LIGHT_ALPHA * fade})`;
  ctx.lineWidth = LENS_LIGHT_WIDTH_PX * thin;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

/** The chalk off his hands and the mat, dragged out behind the front. */
function drawChalkRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  travel: number,
  seed: number,
): void {
  if (travel <= 0 || travel >= 1) return;
  const fade = (1 - travel) * (1 - travel);
  const ringRadius = radius * travel * (1 - CHALK_RING_TRAIL);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH);
  ctx.strokeStyle = `rgba(${CHALK_TINT}, ${CHALK_RING_ALPHA * fade})`;
  ctx.lineWidth = CHALK_RING_WIDTH_PX * (1 - travel * CHALK_RING_THIN);
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, TWO_PI);
  ctx.stroke();

  // Tongues thrown past the ring, so its edge is not a clean circle.
  for (let i = 0; i < CHALK_PLUME_COUNT; i++) {
    const angle = (i / CHALK_PLUME_COUNT) * TWO_PI + noise(seed, i) * CHALK_PLUME_ARC;
    // Clamped to `radius`: the module's own contract is that the wave never
    // reads as covering ground past what the punch actually damaged, so a
    // plume tongue may lag the ring but must never overshoot it.
    const reach = Math.min(
      radius,
      radius * travel * (1 + noise(seed, i + CHALK_PLUME_COUNT) * CHALK_PLUME_OVERRUN),
    );
    const size =
      radius *
      CHALK_PLUME_SIZE *
      (CHALK_PLUME_SIZE_FLOOR + noise(seed, i + CHALK_PLUME_COUNT * 2) * CHALK_PLUME_SIZE_RANGE);
    ctx.fillStyle = `rgba(${CHALK_TINT}, ${CHALK_RING_ALPHA * fade})`;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * reach, Math.sin(angle) * reach, size, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Shreds of rubber matting thrown clear of the crater. */
function drawDebris(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  life: number,
  seed: number,
): void {
  const fade = 1 - life;
  if (fade <= 0) return;
  ctx.save();
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const angle = (i / DEBRIS_COUNT) * TWO_PI + noise(seed, i + 1) * DEBRIS_ANGLE_JITTER;
    const speed =
      radius * (DEBRIS_SPEED_FLOOR + noise(seed, i + DEBRIS_COUNT) * DEBRIS_SPEED_SPREAD);
    const travel = speed * life;
    const arc = radius * DEBRIS_ARC * Math.sin(life * Math.PI);
    const x = cx + Math.cos(angle) * travel;
    const y = cy + Math.sin(angle) * travel * GROUND_SQUASH - arc;
    const size =
      DEBRIS_SIZE_PX * (DEBRIS_SIZE_FLOOR + noise(seed, i + DEBRIS_COUNT * 2) * DEBRIS_SIZE_RANGE);
    const spinDirection = noise(seed, i) > HALF ? 1 : -1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(life * DEBRIS_SPIN * DEBRIS_SPIN_TURNS * spinDirection);
    ctx.fillStyle = `rgba(${DEBRIS_TINT}, ${fade})`;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/** What the wave knocked into the air, hanging and settling. Chalk, not smoke. */
function drawHaze(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  life: number,
  seed: number,
): void {
  if (life < HAZE_STARTS_AT) return;
  const hazeLife = (life - HAZE_STARTS_AT) / (1 - HAZE_STARTS_AT);
  const fade = (1 - hazeLife) * HAZE_ALPHA;
  ctx.save();
  for (let i = 0; i < HAZE_PUFFS; i++) {
    const angle = (i / HAZE_PUFFS) * TWO_PI + noise(seed, i + 3);
    // Puffs have to drift apart as they climb: kept tight they close into one
    // disc that reads as a hole punched in the floor.
    const drift = HAZE_DRIFT_FLOOR + hazeLife * HAZE_DRIFT_GAIN;
    // Clamped to `radius` for the same reason as the chalk plumes above: the
    // haze is what the punch kicked up, and it must not read as covering
    // ground the hit radius didn't reach.
    const spread = Math.min(radius, radius * HAZE_SPREAD * noise(seed, i + HAZE_PUFFS) * drift);
    const puffRadius =
      radius *
      HAZE_PUFF_FRACTION *
      (HAZE_PUFF_FLOOR + noise(seed, i + HAZE_PUFFS * 2) * HAZE_PUFF_RANGE) *
      (1 + hazeLife);
    const x = cx + Math.cos(angle) * spread;
    const y = cy + Math.sin(angle) * spread * GROUND_SQUASH - HAZE_RISE_PX * hazeLife;
    // A flat fill gives every puff a hard rim, and nine hard rims read as
    // bubbles rather than as powder.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, HAZE_PUFF_SQUASH);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, puffRadius);
    gradient.addColorStop(0, `rgba(${CHALK_TINT}, ${fade})`);
    gradient.addColorStop(HAZE_MID_STOP, `rgba(${CHALK_TINT}, ${fade * HAZE_MID_ALPHA_SHARE})`);
    gradient.addColorStop(1, `rgba(${CHALK_TINT}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, puffRadius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export interface JuicerShockwaveFrame {
  /** Wave centre in screen space. */
  readonly cx: number;
  readonly cy: number;
  /** Outer damage radius in px — where the compression front stops. */
  readonly radius: number;
  /** 0 on the frame the fists land, 1 when the front reaches the radius. */
  readonly progress: number;
  /** Stable per-wave value; keeps the chalk and the shreds from crawling. */
  readonly seed: number;
}

/**
 * Draw one wave at its current progress. Layers run floor-upward: the burnt
 * mat, the ripples behind the front, the chalk the front drags, the front
 * itself, then what it tore loose and what is still hanging.
 */
export function drawJuicerShockwave(
  ctx: CanvasRenderingContext2D,
  frame: JuicerShockwaveFrame,
): void {
  const { cx, cy, radius, seed } = frame;
  const life = clamp01(frame.progress);

  ctx.save();
  drawScuff(ctx, cx, cy, radius, 1 - life);
  for (const ripple of RIPPLES) {
    drawCompressionRing(ctx, cx, cy, radius, life * ripple.rate, ripple.strength);
  }
  drawChalkRing(ctx, cx, cy, radius, life, seed);
  drawCompressionRing(ctx, cx, cy, radius, life, 1);
  drawDebris(ctx, cx, cy, radius, life, seed);
  drawHaze(ctx, cx, cy, radius, life, seed);
  ctx.restore();
}
