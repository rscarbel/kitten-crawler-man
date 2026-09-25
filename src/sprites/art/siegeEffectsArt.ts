/**
 * The moving pictures of the village's siege engines, painted live: a
 * tumbling boulder and the shadow it throws, the ring where it will land, the
 * burst of dust and stone where it does, the embers and miasma of an infernal
 * shot, and the soul-green marks of an enemy a snare has turned.
 *
 * Painted live because every one of them moves every frame and there are
 * only ever a handful at once. The systems that own them hand in positions
 * and a 0–1 progress; nothing here keeps state.
 */

const FULL_TURN = Math.PI * 2;

/**
 * Anything lying flat on the ground — a ring, a cloud, a shadow — is drawn
 * this much shorter than it is wide, the game's 3/4 view foreshortening the
 * ground plane. One number for all of them, so they sit on the same floor.
 */
const GROUND_SQUASH = 0.72;
/** A burst of dust hugs the ground more tightly than a painted ring: it is thrown along it. */
const DUST_SQUASH = 0.55;

// ── Boulders ────────────────────────────────────────────────────────────────

const BOULDER_RADIUS_TILES = 0.2;
/** How much a boulder turns each update of its flight. */
export const BOULDER_SPIN_PER_FRAME = 0.35;
/** Above this height a boulder's shadow is as small and faint as it gets. */
const SHADOW_MAX_HEIGHT_TILES = 3;
/** A grounded boulder's shadow, as a share of the boulder; it shrinks by the next share at full height. */
const SHADOW_GROUNDED_SCALE = 1.1;
const SHADOW_HEIGHT_SHRINK = 0.55;
const SHADOW_GROUNDED_ALPHA = 0.34;
const SHADOW_HEIGHT_FADE = 0.18;
/** The shadow is a flat ellipse, wider than the rock and far shallower. */
const SHADOW_WIDTH = 1.3;
const SHADOW_DEPTH = 0.6;

const BOULDER_LUMPS = 6;
/** Each lump bulges between these shares of the radius; the wave's rate keeps neighbours unlike. */
const LUMP_BASE = 0.88;
const LUMP_SWING = 0.14;
const LUMP_WAVE_RATE = 2.7;
/** The infernal glow reaches this many radii out, from a hot core this many radii across. */
const GLOW_REACH = 2.6;
const GLOW_CORE = 0.3;
const GLOW_CORE_ALPHA = 0.9;
/** The lit face: this far round from the spin, this far out, this big — all in radii. */
const FACE_ANGLE = 2.2;
const FACE_OFFSET = 0.35;
const FACE_RADIUS = 0.32;
/** The crack runs from near the centre most of the way out, a little ahead of the spin. */
const CRACK_START = 0.1;
const CRACK_END = 0.8;
const CRACK_LEAD = 0.4;

const STONE_LIGHT = '#b8b1a4';
const STONE_MID = '#8d877c';
const STONE_DARK = '#5a554d';
const EMBER_ROCK = '#6b3a22';
const EMBER_FACE = '#fdba74';
const EMBER_CRACK = '#fb923c';
const FIRE_CORE = 'rgba(255,214,120,';
const FIRE_EDGE = 'rgba(255,96,24,';
const DUST = 'rgba(150,132,104,';

/** The shadow under a boulder in flight: smaller and fainter the higher it is. */
export function drawBoulderShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heightPx: number,
  ts: number,
): void {
  const lift = Math.min(1, heightPx / (SHADOW_MAX_HEIGHT_TILES * ts));
  const radius = BOULDER_RADIUS_TILES * ts * (SHADOW_GROUNDED_SCALE - lift * SHADOW_HEIGHT_SHRINK);
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${(SHADOW_GROUNDED_ALPHA - lift * SHADOW_HEIGHT_FADE).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * SHADOW_WIDTH, radius * SHADOW_DEPTH, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** The landing ring's outline brightens from this alpha by the next over the flight. */
const RING_EDGE_ALPHA = 0.25;
const RING_EDGE_ALPHA_RISE = 0.5;
/** Its fill swells from nothing to the full ring, faint throughout. */
const RING_FILL_ALPHA = 0.06;
const RING_FILL_ALPHA_RISE = 0.14;
const RING_LINE_WIDTH = 1.5;
const RING_DASH: readonly number[] = [5, 4];

/**
 * The warning where a boulder will land, brightening as it falls. It spans
 * the whole shatter, so a friend standing inside it knows to step out.
 */
export function drawLandingRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusPx: number,
  progress: number,
  infernal: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = RING_EDGE_ALPHA + progress * RING_EDGE_ALPHA_RISE;
  ctx.strokeStyle = infernal ? '#fb923c' : '#fde68a';
  ctx.lineWidth = RING_LINE_WIDTH;
  ctx.setLineDash([...RING_DASH]);
  ctx.beginPath();
  ctx.ellipse(x, y, radiusPx, radiusPx * GROUND_SQUASH, 0, 0, FULL_TURN);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = RING_FILL_ALPHA + progress * RING_FILL_ALPHA_RISE;
  ctx.fillStyle = infernal ? '#f97316' : '#fef3c7';
  ctx.beginPath();
  ctx.ellipse(x, y, radiusPx * progress, radiusPx * GROUND_SQUASH * progress, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** A lumpy rock, tumbling: a lit face and a crack turn with `spin`. Infernal, it glows and smoulders. */
export function drawBoulder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  spin: number,
  infernal: boolean,
): void {
  const r = BOULDER_RADIUS_TILES * ts;
  ctx.save();
  if (infernal) {
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, y, r * GLOW_CORE, x, y, r * GLOW_REACH);
    glow.addColorStop(0, `${FIRE_CORE}${GLOW_CORE_ALPHA})`);
    glow.addColorStop(1, `${FIRE_EDGE}0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * GLOW_REACH, 0, FULL_TURN);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = infernal ? EMBER_ROCK : STONE_MID;
  ctx.beginPath();
  for (let i = 0; i <= BOULDER_LUMPS; i++) {
    const angle = spin + (i / BOULDER_LUMPS) * FULL_TURN;
    const bulge = r * (LUMP_BASE + LUMP_SWING * Math.sin(i * LUMP_WAVE_RATE));
    const px = x + Math.cos(angle) * bulge;
    const py = y + Math.sin(angle) * bulge;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = STONE_DARK;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = infernal ? EMBER_FACE : STONE_LIGHT;
  ctx.beginPath();
  ctx.arc(
    x + Math.cos(spin + FACE_ANGLE) * r * FACE_OFFSET,
    y + Math.sin(spin + FACE_ANGLE) * r * FACE_OFFSET,
    r * FACE_RADIUS,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.strokeStyle = infernal ? EMBER_CRACK : STONE_DARK;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(spin) * r * CRACK_START, y + Math.sin(spin) * r * CRACK_START);
  ctx.lineTo(
    x + Math.cos(spin + CRACK_LEAD) * r * CRACK_END,
    y + Math.sin(spin + CRACK_LEAD) * r * CRACK_END,
  );
  ctx.stroke();
  ctx.restore();
}

// ── Embers ──────────────────────────────────────────────────────────────────

/** Updates an ember shed by an infernal boulder lives. */
export const EMBER_FRAMES = 26;
/**
 * An ember's sideways drift is picked from this many evenly spaced steps,
 * walked by a stride coprime to it so neighbouring embers go different ways.
 */
const EMBER_DRIFT_STEPS = 11;
const EMBER_DRIFT_STRIDE = 37;
/** Pixels per update: sideways at full drift, and up — a little faster the further it drifts. */
const EMBER_SIDEWAYS_SPEED = 0.6;
const EMBER_RISE_SPEED = 0.4;
const EMBER_RISE_FROM_DRIFT = 0.4;
/** A fresh ember is white-hot for this share of its life, then cools to orange. */
const EMBER_HOT_LIFE = 0.4;
const EMBER_END_RADIUS = 1.6;
const EMBER_RADIUS_SHRINK = 1.2;

/** Which way the ember shed on update `seed` of a flight drifts, in pixels per update: up, and a little to one side. */
export function emberDrift(seed: number): { vx: number; vy: number } {
  const centred = 0.5;
  const drift = ((seed * EMBER_DRIFT_STRIDE) % EMBER_DRIFT_STEPS) / EMBER_DRIFT_STEPS - centred;
  return {
    vx: drift * EMBER_SIDEWAYS_SPEED,
    vy: -EMBER_RISE_SPEED - Math.abs(drift) * EMBER_RISE_FROM_DRIFT,
  };
}

export function drawEmber(ctx: CanvasRenderingContext2D, x: number, y: number, life: number): void {
  const alpha = Math.max(0, 1 - life);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `${life < EMBER_HOT_LIFE ? FIRE_CORE : FIRE_EDGE}${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(x, y, EMBER_END_RADIUS + (1 - life) * EMBER_RADIUS_SHRINK, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── Impact ──────────────────────────────────────────────────────────────────

/** Updates the burst where a boulder lands plays for. */
export const BURST_FRAMES = 32;
const BURST_FRAGMENTS = 9;
/** The dust ring starts at this share of the shatter and spreads by the next. */
const DUST_START = 0.3;
const DUST_SPREAD = 0.8;
const DUST_ALPHA = 0.45;
/** An infernal burst's fire sits inside the dust: this much of its width and depth. */
const FIRE_WIDTH = 0.6;
const FIRE_DEPTH = 0.35;
const FIRE_ALPHA = 0.5;
/** Fragments rise and fall once, over this share of the burst, peaking at half a tile. */
const HOP_LIFE_RATE = 1.4;
const HOP_HEIGHT_TILES = 0.5;
/** A fragment still glows for the first half of an infernal burst. */
const FRAGMENT_GLOW_LIFE = 0.5;
/** Fragment scatter comes from a small integer hash of the seed and the fragment's index. */
const JITTER_SEED_STRIDE = 7;
const JITTER_INDEX_STRIDE = 13;
const JITTER_STEPS = 10;
/** How far off its even spoke a fragment may fly, in radians at full jitter. */
const FRAGMENT_ANGLE_JITTER = 0.5;
/** Pixels per update a fragment flies, and the extra a fully jittered one gets. */
const FRAGMENT_SPEED = 1.4;
const FRAGMENT_SPEED_JITTER = 1.6;
/** Fragments are small squares of a few sizes, cycled by index. */
const FRAGMENT_MIN_SIZE = 3;
const FRAGMENT_SIZES = 3;
const FRAGMENT_SIZE_STRIDE = 5;

/**
 * Where a boulder lands: a ring of dust thrown along the ground (with fire
 * in it, for an infernal one) and stone fragments flying out and falling
 * back. `seed` varies the scatter between impacts.
 */
export function drawBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusPx: number,
  age: number,
  seed: number,
  infernal: boolean,
  ts: number,
): void {
  const t = age / BURST_FRAMES;
  ctx.save();
  const dustRadius = radiusPx * (DUST_START + t * DUST_SPREAD);
  ctx.fillStyle = `${DUST}${(DUST_ALPHA * (1 - t)).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x, y, dustRadius, dustRadius * DUST_SQUASH, 0, 0, FULL_TURN);
  ctx.fill();
  if (infernal) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `${FIRE_EDGE}${(FIRE_ALPHA * (1 - t)).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, dustRadius * FIRE_WIDTH, dustRadius * FIRE_DEPTH, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  const hop = Math.sin(Math.min(1, t * HOP_LIFE_RATE) * Math.PI) * ts * HOP_HEIGHT_TILES;
  ctx.globalAlpha = Math.max(0, 1 - t * t);
  ctx.fillStyle = infernal && t < FRAGMENT_GLOW_LIFE ? EMBER_FACE : STONE_DARK;
  for (let i = 0; i < BURST_FRAGMENTS; i++) {
    const jitter =
      ((seed * JITTER_SEED_STRIDE + i * JITTER_INDEX_STRIDE) % JITTER_STEPS) / JITTER_STEPS;
    const angle = (i / BURST_FRAGMENTS) * FULL_TURN + jitter * FRAGMENT_ANGLE_JITTER;
    const travel = (FRAGMENT_SPEED + jitter * FRAGMENT_SPEED_JITTER) * age;
    const size = FRAGMENT_MIN_SIZE + ((i * FRAGMENT_SIZE_STRIDE) % FRAGMENT_SIZES);
    const fx = x + Math.cos(angle) * travel;
    const fy = y + Math.sin(angle) * travel * DUST_SQUASH - hop;
    ctx.fillRect(fx - size / 2, fy - size / 2, size, size);
  }
  ctx.restore();
}

// ── Miasma ──────────────────────────────────────────────────────────────────

const MIASMA_VIOLET = 'rgba(126,58,190,';
const MIASMA_GREEN = 'rgba(132,190,60,';
const MIASMA_BLOBS = 5;
/** Radians per second the blobs circle the cloud's centre. */
const MIASMA_CHURN_RATE = 0.4;
/** Blobs orbit this share of the radius out across the ground, and less deep. */
const MIASMA_ORBIT_WIDTH = 0.45;
const MIASMA_ORBIT_DEPTH = 0.3;
/** Each blob breathes between these shares of the radius, at this rate. */
const MIASMA_BLOB_SIZE = 0.55;
const MIASMA_BLOB_BREATH = 0.1;
const MIASMA_BREATH_RATE = 1.3;
/** A blob's solid core, as a share of its radius, and its opacity at full strength. */
const MIASMA_CORE = 0.1;
const MIASMA_ALPHA = 0.42;

/**
 * A sickly violet haze shot with green, slowly churning — nothing like the
 * clown's yellow-green gas, so a player never mistakes their own cloud for
 * an enemy's. `strength` fades it in and out (0–1).
 */
export function drawMiasma(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusPx: number,
  strength: number,
  timeSeconds: number,
  seed: number,
): void {
  ctx.save();
  for (let i = 0; i < MIASMA_BLOBS; i++) {
    const angle = (i / MIASMA_BLOBS) * FULL_TURN + timeSeconds * MIASMA_CHURN_RATE + seed;
    const bx = x + Math.cos(angle) * radiusPx * MIASMA_ORBIT_WIDTH;
    const by = y + Math.sin(angle) * radiusPx * MIASMA_ORBIT_DEPTH;
    const br =
      radiusPx *
      (MIASMA_BLOB_SIZE + MIASMA_BLOB_BREATH * Math.sin(timeSeconds * MIASMA_BREATH_RATE + i));
    const gradient = ctx.createRadialGradient(bx, by, br * MIASMA_CORE, bx, by, br);
    const tint = i % 2 === 0 ? MIASMA_VIOLET : MIASMA_GREEN;
    gradient.addColorStop(0, `${tint}${(MIASMA_ALPHA * strength).toFixed(3)})`);
    gradient.addColorStop(1, `${tint}0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(bx, by, br, br * GROUND_SQUASH, 0, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.restore();
}

// ── Marks ───────────────────────────────────────────────────────────────────

/** The spanner's handle runs from its foot (lower left) to its neck, as shares of the icon. */
const WRENCH_FOOT = { x: 0.25, y: 0.8 } as const;
const WRENCH_NECK = { x: 0.65, y: 0.35 } as const;
const WRENCH_HANDLE_WIDTH = 0.2;
const WRENCH_HANDLE_MIN_PX = 2;
/** Its open jaw: a ring round this centre, broken where the handle meets it. */
const WRENCH_JAW = { x: 0.72, y: 0.28, radius: 0.2 } as const;
const WRENCH_JAW_WIDTH = 0.14;
const WRENCH_JAW_MIN_PX = 1.5;
const WRENCH_JAW_START = Math.PI * 0.9;
const WRENCH_JAW_END = Math.PI * 2.4;

/** A small spanner, the "needs repair" mark, in a square `size` wide. */
export function drawWrench(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#1e293b';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(WRENCH_HANDLE_MIN_PX, size * WRENCH_HANDLE_WIDTH);
  ctx.beginPath();
  ctx.moveTo(x + size * WRENCH_FOOT.x, y + size * WRENCH_FOOT.y);
  ctx.lineTo(x + size * WRENCH_NECK.x, y + size * WRENCH_NECK.y);
  ctx.stroke();
  ctx.lineWidth = Math.max(WRENCH_JAW_MIN_PX, size * WRENCH_JAW_WIDTH);
  ctx.beginPath();
  ctx.arc(
    x + size * WRENCH_JAW.x,
    y + size * WRENCH_JAW.y,
    size * WRENCH_JAW.radius,
    WRENCH_JAW_START,
    WRENCH_JAW_END,
  );
  ctx.stroke();
  ctx.restore();
}

const SOUL_GREEN = '#6ee7b7';
const SOUL_GREEN_DEEP = '#059669';
const PARTY_MARKER_SIZE = 7;

/** A small soul-green chevron over a turned enemy's head: on your side now. */
export function drawPartyMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const size = PARTY_MARKER_SIZE;
  ctx.save();
  ctx.fillStyle = SOUL_GREEN;
  ctx.strokeStyle = SOUL_GREEN_DEEP;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x, y);
  ctx.lineTo(x + size, y - size);
  ctx.lineTo(x, y - size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The flash starts this many tiles across and swells by the next. */
const FLASH_START_TILES = 0.3;
const FLASH_SWELL_TILES = 0.9;
const FLASH_CORE = 0.1;
const FLASH_ALPHA = 0.8;

/** The green flash of a conversion, swelling and fading over `t` (0–1). */
export function drawConvertFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  t: number,
): void {
  const radius = ts * (FLASH_START_TILES + t * FLASH_SWELL_TILES);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(x, y, radius * FLASH_CORE, x, y, radius);
  glow.addColorStop(0, `rgba(110,231,183,${(FLASH_ALPHA * (1 - t)).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(16,185,129,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

const CRUMBLE_MOTES = 14;
/** Motes spread this many tiles out over the crumble, on the ground plane. */
const CRUMBLE_SPREAD_TILES = 0.45;
/** Dust settles this far down; a wisp rises this far up. */
const DUST_SETTLE_TILES = 0.3;
const WISP_RISE_TILES = 0.8;
const DUST_MOTE_RADIUS = 2;
/** A wisp's motes shrink from the full radius to the last as they rise. */
const WISP_MOTE_RADIUS = 2.5;
const WISP_MOTE_END_RADIUS = 0.5;
const WISP_ALPHA = 0.8;
/** The pile of dust left on the ground, in tiles, and how solid it starts. */
const DUST_PILE_DROP_TILES = 0.3;
const DUST_PILE_WIDTH_TILES = 0.4;
const DUST_PILE_DEPTH_TILES = 0.14;
const DUST_PILE_ALPHA = 0.35;

/** A turned enemy's end, over `t` (0–1): bone dust settling for the undead, a green wisp rising for anything else. */
export function drawCrumble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  t: number,
  dust: boolean,
): void {
  ctx.save();
  const alpha = Math.max(0, 1 - t);
  for (let i = 0; i < CRUMBLE_MOTES; i++) {
    const angle = (i / CRUMBLE_MOTES) * FULL_TURN;
    const spread = ts * CRUMBLE_SPREAD_TILES * t;
    const drift = dust ? ts * DUST_SETTLE_TILES * t : -ts * WISP_RISE_TILES * t;
    const mx = x + Math.cos(angle) * spread;
    const my = y + Math.sin(angle) * spread * DUST_SQUASH + drift;
    ctx.fillStyle = dust
      ? `rgba(214,206,190,${alpha.toFixed(3)})`
      : `rgba(110,231,183,${(alpha * WISP_ALPHA).toFixed(3)})`;
    ctx.beginPath();
    const radius = dust ? DUST_MOTE_RADIUS : WISP_MOTE_RADIUS * (1 - t) + WISP_MOTE_END_RADIUS;
    ctx.arc(mx, my, radius, 0, FULL_TURN);
    ctx.fill();
  }
  if (dust) {
    ctx.fillStyle = `rgba(190,180,160,${(DUST_PILE_ALPHA * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + ts * DUST_PILE_DROP_TILES,
      ts * DUST_PILE_WIDTH_TILES,
      ts * DUST_PILE_DEPTH_TILES,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  ctx.restore();
}
