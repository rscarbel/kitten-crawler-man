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
 * It is drawn in two layers, split by where each part is in the world. What
 * lies on the floor — the swept patch, the cracks, the compression rings, the
 * dust they drag — goes under the Y-sorted figures, because Carl stands on it:
 * drawn over him, it washes out the very legs and feet the stamp is about. What
 * is in the air — the slug of air, the thrown chips, the dust spurts and the
 * hanging haze — is split again by which side of the stamp it is on: the half
 * behind him goes under with the floor, the half in front goes over him.
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
/** The scuff's alpha at its midpoint stop, relative to its centre. */
const SCUFF_MID_ALPHA_SHARE = 0.45;

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
/** The ring thins to this share of its width by the time it reaches full travel. */
const DUST_RING_TAPER = 0.4;
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
/**
 * The burst's light on the floor is weighted to its rim: a disc bright to its
 * centre is a white puck under his feet, where a ring bright at its edge reads
 * as air driven out from under them.
 */
const BURST_GLOW_CENTRE_SHARE = 0.2;
/** Under a figure, a lit floor at full strength is a fog bank, not light. */
const BURST_GLOW_ALPHA_SHARE = 0.6;
const BURST_GLOW_RIM_STOP = 0.72;
/**
 * The dome itself is only its shell: whatever is inside it is Carl's feet,
 * and the half of the shell in front of him is drawn over them.
 */
const BURST_DOME_ALPHA_SHARE = 0.35;
const BURST_DOME_HOLLOW_STOP = 0.5;
const BURST_DOME_RIM_STOP = 0.85;
/** Room above and below the stamp a half-plane clip must cover, in radii. */
const HALF_PLANE_REACH = 3;

/** Streaks of air tearing outward, just behind the front. */
const GUST_COUNT = 16;
const GUST_FRAMES = 16;
const GUST_ALPHA = 0.34;
const GUST_LENGTH_FRACTION = 0.2;
const GUST_WIDTH_PX = 2.5;
const GUST_ANGLE_JITTER = 0.36;
const GUST_INSET = 0.72;

// ── Debris ───────────────────────────────────────────────────────────────────

/**
 * Chips of the floor the heel broke loose. Few, dark and stone-coloured: a
 * dozen bright squares scattered over the ring read as confetti.
 */
const DEBRIS_COUNT = 7;
const DEBRIS_SIZE_PX = 4;
const DEBRIS_SPIN = 0.28;
const DEBRIS_SPEED_SPREAD = 0.5;
const DEBRIS_SPEED_FLOOR = 0.3;
const DEBRIS_ANGLE_JITTER = 0.5;
/** Height of a chip's hop at its apex, as a fraction of the radius. */
const DEBRIS_ARC = 0.15;
const DEBRIS_ARC_FLOOR = 0.5;
const DEBRIS_SIZE_FLOOR = 0.6;
const DEBRIS_SIZE_RANGE = 0.8;
/** Frames a chip is in the air before it lands and lies where it fell. */
const DEBRIS_FLIGHT_FRAMES = 12;
const DEBRIS_FLIGHT_SPREAD = 6;
/** Turns the spin rate into radians over a chip's flight. */
const DEBRIS_SPIN_TURNS = 20;
/** Splits the noise range so half the chunks spin each way. */
const HALF = 0.5;
/**
 * Chips are held back this many frames and fade in over the next few: on the
 * stamp frame they would all sit on the heel and pile into one dark block
 * between his feet.
 */
const DEBRIS_DELAY_FRAMES = 3;
const DEBRIS_FADE_IN_FRAMES = 3;
/** Chips leave from outside his feet rather than from under the heel. */
const DEBRIS_START_PX = 14;
/** Stone: a shadowed body and a lit top face, so a chip reads as a lump. */
const DEBRIS_BODY_TINT = '66, 60, 54';
const DEBRIS_LIT_TINT = '124, 116, 104';
const DEBRIS_LIT_SHARE = 0.5;
const DEBRIS_SHADOW_ALPHA = 0.35;
const DEBRIS_SHADOW_SQUASH = 0.45;
/** Once landed, a chip is part of the floor and dims with the rest of it. */
const DEBRIS_REST_ALPHA = 0.8;

// ── The grind ────────────────────────────────────────────────────────────────

/**
 * On each frame the heel is ground into the floor after the stamp, the blast
 * answers it: a tight second compression ring out of the heel, a spurt of dust
 * at its edge, and the floor cracking a little further. It is what says the
 * stamp is held and pressed, not bounced off.
 */
/** Frames one grind's pulse lives: about the frame it is drawn on. */
const GRIND_PULSE_FRAMES = 7;
/** How far the grind's ring runs, as a multiple of the burst's radius. */
const GRIND_RING_REACH = 1.15;
/** The grind's own slug of air, as a share of the stamp's. */
const GRIND_BURST_SHARE = 0.55;
/** Each grind drives harder than the one before it. */
const GRIND_RING_STRENGTH = 0.85;
const GRIND_STRENGTH_PER_BEAT = 0.25;
const GRIND_PUFFS = 7;
const GRIND_PUFF_SIZE_PX = 6;
const GRIND_PUFF_ALPHA = 0.5;
/** Where the grind's dust spurts, as a share of the ring's reach, as it runs. */
const GRIND_PUFF_FROM = 0.35;
const GRIND_PUFF_TO = 0.8;
/** A spurt climbs as it spreads: it is dust thrown up, not dust sliding. */
const GRIND_PUFF_RISE_PX = 8;

const CRACK_COUNT = 5;
const CRACK_OPEN_FRAMES = 3;
/** How far each grind opens the cracks, as a share of the burst's radius. */
const CRACK_REACH_PER_BEAT = 0.32;
/** A crack is a few straight runs, each kinked off the last. */
const CRACK_SEGMENTS = 4;
const CRACK_KINK = 1.1;
const CRACK_ANGLE_JITTER = 0.8;
const CRACK_WIDTH_PX = 2;
const CRACK_ALPHA = 0.8;
/** The lit lip along a crack's far edge, which is what makes a dark line read as a split. */
const CRACK_LIP_OFFSET_PX = 1;
const CRACK_LIP_ALPHA = 0.35;
const CRACK_TINT = '34, 26, 20';
const CRACK_LIP_TINT = '196, 178, 150';
/** Noise offsets keeping the cracks' draws apart from every other layer's. */
const CRACK_NOISE_BASE = 200;
const GRIND_PUFF_NOISE_BASE = 300;

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
/** A puff's alpha at its midpoint stop, relative to its centre. */
const HAZE_PUFF_MID_ALPHA_SHARE = 0.55;

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
  gradient.addColorStop(0.7, `rgba(72, 62, 52, ${SCUFF_ALPHA * SCUFF_MID_ALPHA_SHARE * fade})`);
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
  ctx.lineWidth = DUST_RING_WIDTH_PX * (1 - travel * DUST_RING_TAPER);
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
 * Which side of the stamp an airborne part is on. Behind it is drawn with the
 * floor, under Carl; in front of it is drawn over him.
 */
type Side = 'behind' | 'front';

/** Restricts drawing to the half-plane above (behind) or below (front) the stamp. */
function clipToSide(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  reach: number,
  side: Side,
): void {
  const top = side === 'behind' ? cy - reach : cy;
  ctx.beginPath();
  ctx.rect(cx - reach, top, reach * 2, reach);
  ctx.clip();
}

/** How far through its life the burst of air is, and how bright it still is. */
function burstLife(age: number): { size: number; fade: number } | null {
  if (age >= BURST_FRAMES) return null;
  const life = age / BURST_FRAMES;
  return { size: 1 + life * (BURST_SWELL - 1), fade: (1 - life) * (1 - life) };
}

/**
 * The light the slug of air throws on the floor it bursts out of: brightest
 * at its rim, dim at the heel. Under Carl, so it lights the floor around his
 * feet rather than the feet themselves.
 */
function drawBurstGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
): void {
  const state = burstLife(age);
  if (state === null) return;
  const size = radius * state.size;
  const alpha = BURST_ALPHA * BURST_GLOW_ALPHA_SHARE * state.fade;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  gradient.addColorStop(0, `rgba(236, 244, 252, ${alpha * BURST_GLOW_CENTRE_SHARE})`);
  gradient.addColorStop(BURST_GLOW_RIM_STOP, `rgba(214, 228, 244, ${alpha})`);
  gradient.addColorStop(1, 'rgba(180, 198, 220, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * The slug of air the heel punches out of the floor, as a shell that swells
 * and is gone. Not a fireball — it has no colour of its own, it only lightens.
 * Hollow, because what is inside it is Carl's feet.
 */
function drawBurstDome(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
  side: Side,
): void {
  const state = burstLife(age);
  if (state === null) return;
  const size = radius * state.size;
  const alpha = BURST_ALPHA * BURST_DOME_ALPHA_SHARE * state.fade;

  ctx.save();
  clipToSide(ctx, cx, cy, size * HALF_PLANE_REACH, side);
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  ctx.scale(1, GROUND_SQUASH * BURST_LOFT);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  gradient.addColorStop(0, 'rgba(236, 244, 252, 0)');
  gradient.addColorStop(BURST_DOME_HOLLOW_STOP, 'rgba(236, 244, 252, 0)');
  gradient.addColorStop(BURST_DOME_RIM_STOP, `rgba(214, 228, 244, ${alpha})`);
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

/** Where one chip is: on the floor, and how high above it, or whether it has landed. */
interface ChipPlacement {
  x: number;
  y: number;
  height: number;
  landed: boolean;
  side: Side;
  size: number;
  spin: number;
  alpha: number;
}

function placeChip(
  cx: number,
  cy: number,
  radius: number,
  age: number,
  life: number,
  seed: number,
  index: number,
): ChipPlacement | null {
  const airborneFrames = age - DEBRIS_DELAY_FRAMES;
  if (airborneFrames < 0) return null;
  const shown = clamp01(airborneFrames / DEBRIS_FADE_IN_FRAMES);
  const flightFrames =
    DEBRIS_FLIGHT_FRAMES + noise(seed, index + DEBRIS_COUNT * 3) * DEBRIS_FLIGHT_SPREAD;
  const flight = clamp01(airborneFrames / flightFrames);
  const landed = flight >= 1;
  const angle = (index / DEBRIS_COUNT) * TWO_PI + noise(seed, index + 1) * DEBRIS_ANGLE_JITTER;
  const speed =
    radius * (DEBRIS_SPEED_FLOOR + noise(seed, index + DEBRIS_COUNT) * DEBRIS_SPEED_SPREAD);
  const travel = DEBRIS_START_PX + speed * flight;
  const apex =
    radius * DEBRIS_ARC * (DEBRIS_ARC_FLOOR + noise(seed, index + DEBRIS_COUNT * 4) * HALF);
  // Constant speed across, gravity on the way up and down: a parabola in time.
  const ballistic = 4 * flight * (1 - flight);
  const spinDirection = noise(seed, index) > HALF ? 1 : -1;
  const groundDy = Math.sin(angle) * travel * GROUND_SQUASH;
  return {
    x: cx + Math.cos(angle) * travel,
    y: cy + groundDy,
    height: apex * ballistic,
    landed,
    side: groundDy < 0 ? 'behind' : 'front',
    size:
      DEBRIS_SIZE_PX *
      (DEBRIS_SIZE_FLOOR + noise(seed, index + DEBRIS_COUNT * 2) * DEBRIS_SIZE_RANGE),
    spin: flight * DEBRIS_SPIN * DEBRIS_SPIN_TURNS * spinDirection,
    alpha: (1 - life) * shown * (landed ? DEBRIS_REST_ALPHA : 1),
  };
}

function drawChip(ctx: CanvasRenderingContext2D, chip: ChipPlacement): void {
  const half = chip.size / 2;
  ctx.save();
  ctx.translate(chip.x, chip.y - chip.height);
  ctx.rotate(chip.spin);
  ctx.fillStyle = `rgba(${DEBRIS_BODY_TINT}, ${chip.alpha})`;
  ctx.fillRect(-half, -half, chip.size, chip.size);
  ctx.fillStyle = `rgba(${DEBRIS_LIT_TINT}, ${chip.alpha})`;
  ctx.fillRect(-half, -half, chip.size, chip.size * DEBRIS_LIT_SHARE);
  ctx.restore();
}

/**
 * The floor's share of the chips: the shadow of each one in the air, each one
 * that has landed, and the ones flying behind the stamp.
 */
function drawDebrisOnFloor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
  life: number,
  seed: number,
): void {
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const chip = placeChip(cx, cy, radius, age, life, seed, i);
    if (chip === null || chip.alpha <= 0) continue;
    if (!chip.landed) {
      ctx.fillStyle = `rgba(0, 0, 0, ${DEBRIS_SHADOW_ALPHA * chip.alpha})`;
      ctx.beginPath();
      ctx.ellipse(
        chip.x,
        chip.y,
        chip.size / 2,
        (chip.size / 2) * DEBRIS_SHADOW_SQUASH,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    if (chip.landed || chip.side === 'behind') drawChip(ctx, chip);
  }
}

/** The chips still in the air in front of the stamp. */
function drawDebrisInFront(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  age: number,
  life: number,
  seed: number,
): void {
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const chip = placeChip(cx, cy, radius, age, life, seed, i);
    if (chip === null || chip.alpha <= 0 || chip.landed || chip.side !== 'front') continue;
    drawChip(ctx, chip);
  }
}

/** A grind on screen: which one, counted from 1, and frames since it showed. */
export interface SmushGrindPulse {
  readonly beat: number;
  readonly age: number;
}

function grindTravel(pulse: SmushGrindPulse): number | null {
  const travel = pulse.age / GRIND_PULSE_FRAMES;
  return travel >= 1 ? null : travel;
}

/** The grind's tight compression ring out of the heel, and its light on the floor. */
function drawGrindRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  burst: number,
  pulse: SmushGrindPulse,
): void {
  const travel = grindTravel(pulse);
  if (travel === null) return;
  const strength = GRIND_RING_STRENGTH + (pulse.beat - 1) * GRIND_STRENGTH_PER_BEAT;
  drawBurstGlow(ctx, cx, cy, burst * GRIND_BURST_SHARE, travel * BURST_FRAMES);
  // Started a hair out from the heel, or the first tick of the ring is a dot.
  const ringTravel = Math.max(travel, 1 / GRIND_PULSE_FRAMES);
  drawCompressionRing(ctx, cx, cy, burst * GRIND_RING_REACH, ringTravel, strength);
}

/** The grind's airborne half: its smaller slug of air and the dust it spurts. */
function drawGrindAir(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  burst: number,
  pulse: SmushGrindPulse,
  seed: number,
  side: Side,
): void {
  const travel = grindTravel(pulse);
  if (travel === null) return;
  drawBurstDome(ctx, cx, cy, burst * GRIND_BURST_SHARE, travel * BURST_FRAMES, side);

  const reach = burst * GRIND_RING_REACH;
  const fade = (1 - travel) * (1 - travel);
  const spurt = reach * (GRIND_PUFF_FROM + (GRIND_PUFF_TO - GRIND_PUFF_FROM) * travel);
  ctx.save();
  ctx.fillStyle = `rgba(${DUST_TINT}, ${GRIND_PUFF_ALPHA * fade})`;
  for (let i = 0; i < GRIND_PUFFS; i++) {
    const noiseIndex = GRIND_PUFF_NOISE_BASE + pulse.beat * GRIND_PUFFS + i;
    const angle = (i / GRIND_PUFFS) * TWO_PI + noise(seed, noiseIndex) * TWO_PI;
    const groundDy = Math.sin(angle) * spurt * GROUND_SQUASH;
    const puffSide: Side = groundDy < 0 ? 'behind' : 'front';
    if (puffSide !== side) continue;
    const size = GRIND_PUFF_SIZE_PX * (HALF + noise(seed, noiseIndex + 1)) * (1 + travel);
    ctx.beginPath();
    ctx.ellipse(
      cx + Math.cos(angle) * spurt,
      cy + groundDy - GRIND_PUFF_RISE_PX * travel,
      size,
      size * GROUND_SQUASH,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The floor split by the heel grinding into it: jagged cracks out of the
 * stamp, opened a step further by every grind and left open while the blast
 * lasts. `opened` is how many grinds' worth of reach they have.
 */
function drawCracks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  burst: number,
  opened: number,
  fade: number,
  seed: number,
): void {
  if (opened <= 0 || fade <= 0) return;
  const length = burst * CRACK_REACH_PER_BEAT * opened;
  const step = length / CRACK_SEGMENTS;
  const trace = (dx: number, dy: number): void => {
    ctx.beginPath();
    for (let i = 0; i < CRACK_COUNT; i++) {
      let angle =
        (i / CRACK_COUNT) * TWO_PI + noise(seed, CRACK_NOISE_BASE + i) * CRACK_ANGLE_JITTER;
      let x = cx;
      let y = cy;
      ctx.moveTo(x + dx, y + dy);
      for (let segment = 0; segment < CRACK_SEGMENTS; segment++) {
        const kink = noise(seed, CRACK_NOISE_BASE + CRACK_COUNT * (segment + 1) + i) - HALF;
        angle += kink * CRACK_KINK;
        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step * GROUND_SQUASH;
        ctx.lineTo(x + dx, y + dy);
      }
    }
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = CRACK_WIDTH_PX;
  ctx.strokeStyle = `rgba(${CRACK_LIP_TINT}, ${CRACK_LIP_ALPHA * fade})`;
  trace(0, CRACK_LIP_OFFSET_PX);
  ctx.strokeStyle = `rgba(${CRACK_TINT}, ${CRACK_ALPHA * fade})`;
  trace(0, 0);
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
    gradient.addColorStop(0.6, `rgba(${DUST_TINT}, ${fade * HAZE_PUFF_MID_ALPHA_SHARE})`);
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
  /** The grind on screen this frame, if the heel is being ground in. */
  grind?: SmushGrindPulse | null;
  /** How many grinds have opened the floor so far. */
  cracks?: number;
}

/** What both layers of one blast derive from its age. */
function blastClock(blast: SmushBlastFrame): {
  burst: number;
  life: number;
  leadTravel: number;
} {
  return {
    burst: burstRadius(blast.damageRadius, blast.fullPower),
    life: clamp01(blast.age / SMUSH_BLAST_FRAMES),
    leadTravel: blast.age / SHOCKWAVE_FRAMES,
  };
}

/**
 * The floor layer of one blast, drawn under the Y-sorted figures. Floor-upward:
 * the swept patch, the cracks, the ripples behind the front, the dust the front
 * drags, the front itself, the burst's light on the floor, and then everything
 * airborne on the far side of the stamp, which Carl stands in front of.
 */
export function drawSmushBlastGround(ctx: CanvasRenderingContext2D, blast: SmushBlastFrame): void {
  const { cx, cy, damageRadius, age, seed } = blast;
  const { burst, life, leadTravel } = blastClock(blast);

  ctx.save();
  drawScuff(ctx, cx, cy, damageRadius, 1 - life);
  // A crack opens across the first frames of its grind rather than all at once.
  const opening = blast.grind ? clamp01(blast.grind.age / CRACK_OPEN_FRAMES) : 1;
  const opened = Math.max(0, (blast.cracks ?? 0) - 1 + opening);
  drawCracks(ctx, cx, cy, burst, opened, 1 - life, seed);
  for (const ripple of RIPPLES) {
    drawCompressionRing(ctx, cx, cy, damageRadius, leadTravel * ripple.rate, ripple.strength);
  }
  drawDustRing(ctx, cx, cy, damageRadius, leadTravel, seed);
  drawGusts(ctx, cx, cy, damageRadius, age, leadTravel, seed);
  drawCompressionRing(ctx, cx, cy, damageRadius, leadTravel, 1);
  drawBurstGlow(ctx, cx, cy, burst, age);
  if (blast.grind) drawGrindRing(ctx, cx, cy, burst, blast.grind);
  drawBurstDome(ctx, cx, cy, burst, age, 'behind');
  if (blast.grind) drawGrindAir(ctx, cx, cy, burst, blast.grind, seed, 'behind');
  drawDebrisOnFloor(ctx, cx, cy, damageRadius, age, life, seed);
  ctx.restore();
}

/**
 * The air layer of one blast, drawn over the figures: the near half of the
 * slug of air and of the grind's dust, the chips flying toward the camera, and
 * the haze hanging over it all.
 */
export function drawSmushBlastAir(ctx: CanvasRenderingContext2D, blast: SmushBlastFrame): void {
  const { cx, cy, damageRadius, age, seed } = blast;
  const { burst, life } = blastClock(blast);

  ctx.save();
  drawBurstDome(ctx, cx, cy, burst, age, 'front');
  if (blast.grind) drawGrindAir(ctx, cx, cy, burst, blast.grind, seed, 'front');
  drawDebrisInFront(ctx, cx, cy, damageRadius, age, life, seed);
  drawHaze(ctx, cx, cy, damageRadius, life, seed);
  ctx.restore();
}
