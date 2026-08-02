/**
 * The Smush blast: the pressure wave Carl's bare heel drives out of the floor.
 *
 * This is force, not fire — nothing here burns. What the player sees is air:
 * a slug of it punched out of the stamp, a ring of compression running out
 * across the ground, the floor's dust dragged along behind it, and whatever the
 * heel broke loose thrown clear.
 *
 * The compression ring is the whole effect. Compressed air bends light, so the
 * ring is drawn as a *pair* of bands rather than a stroke of some colour: one
 * that darkens what is under it and one just outside that brightens. Neither
 * band is a thing in the world — together they read as the floor being seen
 * through moving air, which is the only way a 2D canvas can show a shockwave
 * without inventing a colour for it.
 *
 * It is drawn rather than baked. The ability's radius grows with its level —
 * three and a half tiles at first, eight at the cap — and a sheet would either
 * have to be baked at the largest radius and scaled down (soft, and the ring
 * would arrive at the wrong distance) or baked once per level. Drawing it means
 * the ring ends exactly on the damage radius, which is the point: what the
 * player sees it sweep over is what the stamp actually hit.
 */

const TWO_PI = Math.PI * 2;

/** Frames the whole effect lives for. */
export const SMUSH_BLAST_FRAMES = 38;
/** Frames the leading wave takes to travel the full damage radius. */
const SHOCKWAVE_FRAMES = 20;
/**
 * Ripples behind the leading wave: each runs at a fraction of its speed and
 * reads fainter. A single ring is a hoop; a train of them is a pressure wave.
 */
const RIPPLES = [
  { rate: 0.72, strength: 0.55 },
  { rate: 0.48, strength: 0.3 },
] as const;

/**
 * The blast is authored against a level-1 radius; everything else is expressed
 * as growth away from it.
 */
const REFERENCE_RADIUS_PX = 112;
/** Radius of the burst of compressed air at the stamp, at the reference radius. */
const BURST_BASE_PX = 44;
/**
 * Sub-linear growth: doubling the damage radius makes the burst about half
 * again as big, not twice as big. A linear one fills a third of the screen at
 * the level cap.
 */
const BURST_GROWTH_EXPONENT = 0.55;
const FULL_POWER_BURST_BONUS = 1.18;

/** The world is seen at a slight tilt, so anything flat on the floor squashes. */
const GROUND_SQUASH = 0.55;

// ── Ground ───────────────────────────────────────────────────────────────────

/** Floor swept clean around the stamp — dust blown off it, not scorched. */
const SCUFF_RADIUS_FRACTION = 0.34;
const SCUFF_ALPHA = 0.3;

// ── Compression ring ─────────────────────────────────────────────────────────

/**
 * The two bands the refraction is made of. The dark one sits on the inside of
 * the wave front, where air is piling up; the pale one just outside it, on the
 * rarefied side. Reverse them and the ring reads as a solid object flying out.
 */
const LENS_DARK_WIDTH_PX = 13;
const LENS_LIGHT_WIDTH_PX = 5;
const LENS_DARK_ALPHA = 0.72;
const LENS_LIGHT_ALPHA = 0.55;
/** How far inside the wave front the dark band trails, as a fraction of radius. */
const LENS_DARK_TRAIL = 0.05;
/** The bands thin as the wave spends itself. */
const LENS_THIN_TO = 0.4;
/** Bluish rather than neutral: cool air against a warm dungeon floor. */
const LENS_DARK_TINT = '110, 124, 148';
const LENS_LIGHT_TINT = '226, 236, 246';

// ── Dust the wave drags with it ──────────────────────────────────────────────

const DUST_RING_WIDTH_PX = 30;
const DUST_RING_ALPHA = 0.4;
/** How far behind the wave front the dust lags — it cannot keep up. */
const DUST_RING_TRAIL = 0.14;
const DUST_TINT = '146, 128, 106';
const DUST_PLUME_COUNT = 20;
const DUST_PLUME_ARC = 0.16;
/** How far past the ring a plume may be flung, as a fraction of the ring radius. */
const DUST_PLUME_OVERRUN = 0.14;
const DUST_PLUME_SIZE = 0.1;
const DUST_PLUME_SIZE_FLOOR = 0.6;
const DUST_PLUME_SIZE_RANGE = 0.8;

// ── The slug of air out of the stamp ─────────────────────────────────────────

/** Frames the burst at the stamp lasts; it is over almost before it is seen. */
const BURST_FRAMES = 10;
/** The burst grows to this multiple of its radius as it dissipates. */
const BURST_SWELL = 1.7;
const BURST_ALPHA = 0.5;
/** How much taller than wide the burst stands — air goes up, not just out. */
const BURST_LOFT = 1.25;

/** Streaks of air tearing outward, just behind the front. */
const GUST_COUNT = 16;
const GUST_FRAMES = 16;
const GUST_ALPHA = 0.34;
const GUST_LENGTH_FRACTION = 0.2;
const GUST_WIDTH_PX = 2.5;
const GUST_ANGLE_JITTER = 0.36;
const GUST_INSET = 0.72;

// ── Debris ───────────────────────────────────────────────────────────────────

const DEBRIS_COUNT = 12;
const DEBRIS_SIZE_PX = 5;
const DEBRIS_SPIN = 0.28;
const DEBRIS_SPEED_SPREAD = 0.5;
const DEBRIS_SPEED_FLOOR = 0.4;
const DEBRIS_ANGLE_JITTER = 0.5;
/** Height of the hop a chunk takes before it lands, as a fraction of the radius. */
const DEBRIS_ARC = 0.4;
const DEBRIS_SIZE_FLOOR = 0.6;
const DEBRIS_SIZE_RANGE = 0.9;
/** Turns the spin rate into radians over a chunk's whole life. */
const DEBRIS_SPIN_TURNS = 20;
/** Splits the noise range so half the chunks spin each way. */
const HALF = 0.5;

// ── Hanging dust ─────────────────────────────────────────────────────────────

const HAZE_PUFFS = 11;
const HAZE_STARTS_AT = 0.3;
const HAZE_RISE_PX = 34;
const HAZE_ALPHA = 0.2;
const HAZE_SPREAD = 1.3;
const HAZE_PUFF_FRACTION = 0.4;
const HAZE_PUFF_SQUASH = 0.75;
const HAZE_DRIFT_FLOOR = 0.9;
const HAZE_DRIFT_GAIN = 1.5;
const HAZE_PUFF_FLOOR = 0.5;
const HAZE_PUFF_RANGE = 0.7;

const HASH_SEED_SCALE = 12.9898;
const HASH_INDEX_SCALE = 78.233;
const HASH_MAGNITUDE = 43758.5453;

/** Deterministic 0–1 noise, so one blast's debris does not crawl per frame. */
function noise(seed: number, index: number): number {
  const mixed = Math.sin(seed * HASH_SEED_SCALE + index * HASH_INDEX_SCALE) * HASH_MAGNITUDE;
  return mixed - Math.floor(mixed);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** How big the burst of air at the stamp is for a blast of this damage radius. */
function burstRadius(damageRadius: number, fullPower: boolean): number {
  const growth = Math.pow(damageRadius / REFERENCE_RADIUS_PX, BURST_GROWTH_EXPONENT);
  return BURST_BASE_PX * growth * (fullPower ? FULL_POWER_BURST_BONUS : 1);
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
  gradient.addColorStop(0, `rgba(58, 50, 42, ${SCUFF_ALPHA * fade})`);
  gradient.addColorStop(0.7, `rgba(72, 62, 52, ${SCUFF_ALPHA * 0.45 * fade})`);
  gradient.addColorStop(1, 'rgba(72, 62, 52, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, scuffRadius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * One compression front: the paired bands that stand in for refraction.
 * `travel` is 0 at the stamp and 1 when the front has reached the full damage
 * radius.
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

/** The floor's own dust, dragged out behind the front and lagging it. */
function drawDustRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  travel: number,
  seed: number,
): void {
  if (travel <= 0 || travel >= 1) return;
  const fade = (1 - travel) * (1 - travel);
  const ringRadius = radius * travel * (1 - DUST_RING_TRAIL);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH);
  ctx.strokeStyle = `rgba(${DUST_TINT}, ${DUST_RING_ALPHA * fade})`;
  ctx.lineWidth = DUST_RING_WIDTH_PX * (1 - travel * 0.4);
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, TWO_PI);
  ctx.stroke();

  // Tongues thrown past the ring, so its edge is not a clean circle.
  for (let i = 0; i < DUST_PLUME_COUNT; i++) {
    const angle = (i / DUST_PLUME_COUNT) * TWO_PI + noise(seed, i) * DUST_PLUME_ARC;
    const reach = radius * travel * (1 + noise(seed, i + DUST_PLUME_COUNT) * DUST_PLUME_OVERRUN);
    const size =
      radius *
      DUST_PLUME_SIZE *
      (DUST_PLUME_SIZE_FLOOR + noise(seed, i + DUST_PLUME_COUNT * 2) * DUST_PLUME_SIZE_RANGE);
    ctx.fillStyle = `rgba(${DUST_TINT}, ${DUST_RING_ALPHA * fade})`;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * reach, Math.sin(angle) * reach, size, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The slug of air the heel punches out of the floor: a pale dome that swells
 * and is gone. Not a fireball — it has no colour of its own, it only lightens.
 */
function drawAirBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
): void {
  if (age >= BURST_FRAMES) return;
  const life = age / BURST_FRAMES;
  const fade = (1 - life) * (1 - life);
  const size = radius * (1 + life * (BURST_SWELL - 1));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH * BURST_LOFT);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  gradient.addColorStop(0, `rgba(236, 244, 252, ${BURST_ALPHA * fade})`);
  gradient.addColorStop(0.55, `rgba(198, 214, 232, ${BURST_ALPHA * 0.4 * fade})`);
  gradient.addColorStop(1, 'rgba(180, 198, 220, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Streaks of air tearing outward just behind the front. */
function drawGusts(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
  travel: number,
  seed: number,
): void {
  const life = clamp01(age / GUST_FRAMES);
  const fade = (1 - life) * clamp01(1 - travel);
  if (fade <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${LENS_LIGHT_TINT}, ${GUST_ALPHA * fade})`;
  ctx.lineWidth = GUST_WIDTH_PX;
  for (let i = 0; i < GUST_COUNT; i++) {
    const angle = (i / GUST_COUNT) * TWO_PI + noise(seed, i) * GUST_ANGLE_JITTER;
    const head = radius * travel * (GUST_INSET + noise(seed, i + GUST_COUNT) * (1 - GUST_INSET));
    const tail = head - radius * GUST_LENGTH_FRACTION * (1 - life);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * head, cy + Math.sin(angle) * head * GROUND_SQUASH);
    ctx.lineTo(cx + Math.cos(angle) * tail, cy + Math.sin(angle) * tail * GROUND_SQUASH);
    ctx.stroke();
  }
  ctx.restore();
}

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
    ctx.fillStyle = `rgba(58, 44, 34, ${fade})`;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/** What the wave kicked up, hanging and settling. Dust, not smoke. */
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
    const spread = radius * HAZE_SPREAD * noise(seed, i + HAZE_PUFFS) * drift;
    const puffRadius =
      radius *
      HAZE_PUFF_FRACTION *
      (HAZE_PUFF_FLOOR + noise(seed, i + HAZE_PUFFS * 2) * HAZE_PUFF_RANGE) *
      (1 + hazeLife);
    const x = cx + Math.cos(angle) * spread;
    const y = cy + Math.sin(angle) * spread * GROUND_SQUASH - HAZE_RISE_PX * hazeLife;
    // A flat fill gives every puff a hard rim, and eleven hard rims read as
    // bubbles rather than as dust.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, HAZE_PUFF_SQUASH);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, puffRadius);
    gradient.addColorStop(0, `rgba(${DUST_TINT}, ${fade})`);
    gradient.addColorStop(0.6, `rgba(${DUST_TINT}, ${fade * 0.55})`);
    gradient.addColorStop(1, `rgba(${DUST_TINT}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, puffRadius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export interface SmushBlastFrame {
  /** Blast centre in screen space. */
  cx: number;
  cy: number;
  /** Outer damage radius in px — where the compression wave stops. */
  damageRadius: number;
  /** Frames since the stamp landed. */
  age: number;
  /** Stable per-blast value; keeps gusts and debris from crawling. */
  seed: number;
  fullPower: boolean;
}

/**
 * Draw one blast at its current age. Layers run floor-upward: the swept floor,
 * the ripples behind the front, the dust the front drags, the front itself,
 * then the air out of the stamp and whatever it threw.
 */
export function drawSmushBlast(ctx: CanvasRenderingContext2D, blast: SmushBlastFrame): void {
  const { cx, cy, damageRadius, age, seed, fullPower } = blast;
  const life = clamp01(age / SMUSH_BLAST_FRAMES);
  const leadTravel = age / SHOCKWAVE_FRAMES;

  ctx.save();
  drawScuff(ctx, cx, cy, damageRadius, 1 - life);
  for (const ripple of RIPPLES) {
    drawCompressionRing(ctx, cx, cy, damageRadius, leadTravel * ripple.rate, ripple.strength);
  }
  drawDustRing(ctx, cx, cy, damageRadius, leadTravel, seed);
  drawGusts(ctx, cx, cy, damageRadius, age, leadTravel, seed);
  drawCompressionRing(ctx, cx, cy, damageRadius, leadTravel, 1);
  drawAirBurst(ctx, cx, cy, burstRadius(damageRadius, fullPower), age);
  drawDebris(ctx, cx, cy, damageRadius, life, seed);
  drawHaze(ctx, cx, cy, damageRadius, life, seed);
  ctx.restore();
}
