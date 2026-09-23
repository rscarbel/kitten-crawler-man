/**
 * Painters for Splash Zone's projectiles: the crossbow bolt, the travelling
 * wave he throws, and the splash either breaks into on impact.
 *
 * The bolt and the wave are **directional** and seen from above: both are
 * painted travelling along +X, and the runtime rotates the cell to the heading.
 * A wave drawn the way one looks from a beach — a curl rising off a horizon —
 * turns upside down the moment it travels north, so the crest here is read
 * from overhead instead: a crescent of foam on the leading edge, a dark band
 * under the curling lip just behind it, spray flung ahead, and the wash
 * streaming back and thinning out behind.
 *
 * The splash is not rotated: it is an upright burst, a crown of water rising
 * off a ripple on the floor, and it reads the same whatever hit it.
 *
 * Coordinates are tile units with the origin on the effect's anchor: the
 * bolt's tip, the wave crest's apex, the ground point under the splash.
 */

import { clamp01, hump, lerp, rgba, type Pt } from './carlArt';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

const WATER_DEEP = '#15508f';
const WATER_BASE = '#2f8fdc';
const WATER_LIGHT = '#86d4fa';
const FOAM = '#f2fbff';
const FOAM_SHADE = '#b8e2f6';

const SHAFT = '#d9c79c';
const SHAFT_DARK = '#6a5030';
const STEEL = '#c3cad3';
const STEEL_DARK = '#4f5761';
const FLETCH = '#d8262c';
const FLETCH_DARK = '#7c1015';
const NOCK = '#f5efe4';
const STREAK = '#f6f1e2';

function pt(x: number, y: number): Pt {
  return { x, y };
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Stable 0..1 noise; seeded by index, never by frame, so nothing boils. */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function disc(ctx: Ctx, c: Pt, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(r, 0), 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

// ── Bolt ─────────────────────────────────────────────────────────────────────

const BOLT_HEAD_LENGTH = 0.085;
const BOLT_HEAD_HALF_WIDTH = 0.034;
const BOLT_SHAFT_HALF_WIDTH = 0.011;
const BOLT_FLETCH_LENGTH = 0.1;
const BOLT_FLETCH_HALF_WIDTH = 0.04;
const BOLT_STREAK_LENGTH = 0.2;
const BOLT_OUTLINE = 0.012;

/**
 * The crossbow bolt, tip on the origin, flying along +X. `length` runs from
 * the tip to the nock; the faint streak behind it shimmers with `phase`.
 */
export function drawBolt(ctx: Ctx, length: number, phase: number): void {
  const tail = -length;
  // Three streaks flickering in turn, so the bolt reads as fast even held still.
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const offset = (i - 1) * 0.022;
    const flicker = 0.25 + 0.2 * Math.abs(Math.sin((phase + i / 3) * Math.PI));
    const reach = BOLT_STREAK_LENGTH * (0.6 + 0.4 * fract(phase + i * 0.37));
    ctx.beginPath();
    ctx.moveTo(tail + 0.01, offset);
    ctx.lineTo(tail - reach, offset);
    ctx.lineWidth = 0.012;
    ctx.strokeStyle = rgba(STREAK, flicker);
    ctx.stroke();
  }

  // Red fletching, the lifeguard's colour, so a bolt reads as his.
  ctx.beginPath();
  ctx.moveTo(tail + BOLT_FLETCH_LENGTH, 0);
  ctx.lineTo(tail, -BOLT_FLETCH_HALF_WIDTH);
  ctx.lineTo(tail + 0.02, 0);
  ctx.lineTo(tail, BOLT_FLETCH_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = FLETCH;
  ctx.fill();
  ctx.lineWidth = BOLT_OUTLINE * HALF;
  ctx.strokeStyle = FLETCH_DARK;
  ctx.stroke();

  // Shaft, outlined so it survives on a pale floor.
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(-BOLT_HEAD_LENGTH * HALF, 0);
  ctx.lineWidth = BOLT_SHAFT_HALF_WIDTH * 2 + BOLT_OUTLINE;
  ctx.strokeStyle = SHAFT_DARK;
  ctx.stroke();
  ctx.lineWidth = BOLT_SHAFT_HALF_WIDTH * 2;
  ctx.strokeStyle = SHAFT;
  ctx.stroke();
  disc(ctx, pt(tail, 0), BOLT_SHAFT_HALF_WIDTH * 1.1, NOCK);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-BOLT_HEAD_LENGTH, -BOLT_HEAD_HALF_WIDTH);
  ctx.lineTo(-BOLT_HEAD_LENGTH * 0.78, 0);
  ctx.lineTo(-BOLT_HEAD_LENGTH, BOLT_HEAD_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = STEEL;
  ctx.fill();
  ctx.lineWidth = BOLT_OUTLINE * HALF;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.01, -0.004);
  ctx.lineTo(-BOLT_HEAD_LENGTH * 0.85, -BOLT_HEAD_HALF_WIDTH * 0.6);
  ctx.lineWidth = 0.008;
  ctx.strokeStyle = rgba(FOAM, 0.9);
  ctx.stroke();
}

// ── Wave ─────────────────────────────────────────────────────────────────────

/** How far the crest's horns trail behind its apex, as a share of the half-width. */
const CREST_BOW = 0.34;
/** How deep the wash behind the crest runs at the middle of the wave. */
const WASH_DEPTH = 0.6;
const WASH_RAGGEDNESS = 0.08;
const WASH_RAG_WAVES = 7;
const WAVE_SAMPLES = 32;
/** The lit face of the wave, a little behind the lip. */
const FACE_OFFSET = 0.1;
const FACE_WIDTH = 0.07;
const LIP_SHADOW_OFFSET = 0.035;
const FOAM_BLOBS = 26;
/** How far the rolling ripple pushes the lip forward, and how many ripples span it. */
const LIP_ROLL = 0.022;
const LIP_ROLL_WAVES = 0.8;
const SPILL_BLOBS = 14;
const WASH_STREAKS = 11;
const SPRAY_DROPS = 12;
/**
 * How many times each spray drop is flung per loop of the row. Whole, so a
 * drop is where it started when the loop wraps and nothing jumps at the seam.
 */
const SPRAY_CYCLES_PER_LOOP = 2;
const CURL_SHADOW_OFFSET = 0.06;
const CURL_SHADOW_WIDTH = 0.06;
const CURL_SHADOW_ALPHA = 0.4;
/**
 * The curling lip: a band of bright water thrown forward over the foam,
 * swelling and breaking once a loop so the crest visibly rolls.
 */
const CURL_REACH = 0.05;
const CURL_WIDTH = 0.045;
const WHITECAPS = 2;
/** How far behind the crest a whitecap forms before it rolls up into the lip. */
const WHITECAP_START = 0.34;
const WHITECAP_WIDTH = 0.022;
const WHITECAP_ALPHA = 0.42;
/** Share of the wave's width a whitecap spans; the horns stay clear. */
const WHITECAP_SPAN = 0.8;

/** Where the crest line is at `across` (-1..1 over the wave's width). */
function crestX(across: number, halfWidth: number): number {
  return -CREST_BOW * halfWidth * across * across;
}

/** How far a point along the crest is from the horns; the wave thins out toward them. */
function bodyShare(across: number): number {
  return Math.sqrt(Math.max(0, 1 - across * across));
}

/**
 * The travelling wave, crest apex on the origin, rolling along +X. `width` is
 * its extent across the direction of travel in tiles; `phase` rolls the foam
 * and streams the wash on a loop.
 */
export function drawWave(ctx: Ctx, width: number, phase: number): void {
  const halfWidth = width * HALF;
  const crest: Pt[] = [];
  const tail: Pt[] = [];
  for (let i = 0; i <= WAVE_SAMPLES; i++) {
    const across = -1 + (2 * i) / WAVE_SAMPLES;
    const y = across * halfWidth;
    const x = crestX(across, halfWidth);
    crest.push(pt(x, y));
    // The back of the wash is ragged and restless, not a clean lens.
    const ragged = WASH_RAGGEDNESS * Math.sin(across * WASH_RAG_WAVES + phase * TWO_PI);
    tail.push(pt(x - (WASH_DEPTH + ragged) * bodyShare(across) - 0.04, y * 0.96));
  }

  const traceBody = (): void => {
    ctx.beginPath();
    ctx.moveTo(crest[0].x, crest[0].y);
    for (const p of crest) ctx.lineTo(p.x, p.y);
    for (let i = tail.length - 1; i >= 0; i--) ctx.lineTo(tail[i].x, tail[i].y);
    ctx.closePath();
  };

  // The shadow the curling lip throws on the floor just ahead of it. From
  // above this is the only cue that the crest stands up off the ground and
  // overhangs, and without it the wave reads as a flat blue lens.
  ctx.beginPath();
  crest.forEach((p, i) => {
    const share = bodyShare(-1 + (2 * i) / WAVE_SAMPLES);
    const x = p.x + CURL_SHADOW_OFFSET * share;
    if (i === 0) ctx.moveTo(x, p.y);
    else ctx.lineTo(x, p.y);
  });
  ctx.lineCap = 'round';
  ctx.lineWidth = CURL_SHADOW_WIDTH;
  ctx.strokeStyle = rgba(WATER_DEEP, CURL_SHADOW_ALPHA);
  ctx.stroke();

  // The wash: thickest right behind the crest, thinning to nothing behind.
  traceBody();
  const wash = ctx.createLinearGradient(-WASH_DEPTH - 0.08, 0, 0, 0);
  wash.addColorStop(0, rgba(WATER_BASE, 0));
  wash.addColorStop(0.5, rgba(WATER_BASE, 0.45));
  wash.addColorStop(0.82, rgba(WATER_DEEP, 0.75));
  wash.addColorStop(1, rgba(WATER_BASE, 0.9));
  ctx.fillStyle = wash;
  ctx.fill();

  ctx.save();
  try {
    traceBody();
    ctx.clip();
    // The rising face just behind the lip catches the light: this bright band
    // against the darker trough behind it is what reads as height from above.
    ctx.lineJoin = 'round';
    ctx.beginPath();
    crest.forEach((p, i) => {
      const share = bodyShare(-1 + (2 * i) / WAVE_SAMPLES);
      const x = p.x - FACE_OFFSET * share;
      if (i === 0) ctx.moveTo(x, p.y);
      else ctx.lineTo(x, p.y);
    });
    ctx.lineWidth = FACE_WIDTH;
    ctx.strokeStyle = rgba(WATER_LIGHT, 0.7);
    ctx.stroke();
    // A soft shadow right under the curling lip.
    ctx.beginPath();
    crest.forEach((p, i) => {
      const x = p.x - LIP_SHADOW_OFFSET;
      if (i === 0) ctx.moveTo(x, p.y);
      else ctx.lineTo(x, p.y);
    });
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = rgba(WATER_DEEP, 0.55);
    ctx.stroke();
    // Streaks and foam flecks in the wash, streaming back as the wave rolls on.
    ctx.lineCap = 'round';
    for (let i = 0; i < WASH_STREAKS; i++) {
      const across = -0.85 + (1.7 * (i + HALF)) / WASH_STREAKS;
      const lane = across * halfWidth;
      const start = crestX(across, halfWidth) - 0.14 - fract(phase + hash1(i)) * WASH_DEPTH * 0.75;
      const run = 0.06 + 0.1 * hash1(i + 20);
      const fade = 1 - fract(phase + hash1(i));
      ctx.beginPath();
      ctx.moveTo(start, lane);
      ctx.lineTo(start - run, lane + (hash1(i + 40) - HALF) * 0.03);
      ctx.lineWidth = 0.016;
      ctx.strokeStyle = rgba(FOAM, 0.45 * fade);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }

  // Whitecaps rolling up the back of the wave to the crest: two staggered
  // lines that grow as they near the lip and fade into it, so the water is
  // always seen moving forward rather than only the foam jittering.
  for (let cap = 0; cap < WHITECAPS; cap++) {
    const age = fract(phase + cap / WHITECAPS);
    const behind = WHITECAP_START * (1 - age);
    const strength = hump(age);
    ctx.beginPath();
    for (let i = 0; i <= WAVE_SAMPLES; i++) {
      const across = (-1 + (2 * i) / WAVE_SAMPLES) * WHITECAP_SPAN;
      const x = crestX(across, halfWidth) - behind * bodyShare(across);
      const y = across * halfWidth;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = WHITECAP_WIDTH * (0.5 + strength);
    ctx.strokeStyle = rgba(FOAM, WHITECAP_ALPHA * strength);
    ctx.stroke();
  }

  // The curl itself, pitched forward under the foam that tops it: it grows
  // out and breaks back into the lip once a loop.
  const curl = hump(fract(phase));
  ctx.beginPath();
  crest.forEach((p, i) => {
    const across = -1 + (2 * i) / WAVE_SAMPLES;
    const share = bodyShare(across * WHITECAP_SPAN);
    const x = p.x + CURL_REACH * curl * share - 0.01;
    if (i === 0) ctx.moveTo(x, p.y * WHITECAP_SPAN);
    else ctx.lineTo(x, p.y * WHITECAP_SPAN);
  });
  ctx.lineCap = 'round';
  ctx.lineWidth = CURL_WIDTH * (0.4 + 0.6 * curl);
  ctx.strokeStyle = rgba(WATER_LIGHT, 0.55 + 0.35 * curl);
  ctx.stroke();

  // Foam spilling back off the lip: a looser, fainter scallop behind the crest.
  for (let i = 0; i < SPILL_BLOBS; i++) {
    const across = -0.88 + (1.76 * (i + HALF)) / SPILL_BLOBS;
    const share = bodyShare(across);
    const drift = fract(phase + hash1(i + 200));
    const x = crestX(across, halfWidth) - (0.04 + 0.1 * drift) * share;
    const radius = (0.018 + 0.02 * hash1(i + 220)) * share * (1 - drift * 0.6);
    disc(ctx, pt(x, across * halfWidth), radius, rgba(FOAM, 0.55 * (1 - drift)));
  }
  // The lip itself: a continuous white roll of uneven blobs that tumble along it.
  for (let i = 0; i < FOAM_BLOBS; i++) {
    const across = -0.94 + (1.88 * (i + HALF)) / FOAM_BLOBS;
    const share = bodyShare(across);
    const tumble = HALF + HALF * Math.sin((phase + hash1(i + 300)) * TWO_PI);
    const radius = (0.02 + 0.02 * hash1(i + 320) + 0.012 * tumble) * (0.4 + 0.6 * share);
    // A ripple runs along the lip each loop, so the crest visibly rolls and
    // breaks instead of sitting still with its foam jittering.
    const roll = LIP_ROLL * Math.sin((phase + across * LIP_ROLL_WAVES) * TWO_PI);
    const x = crestX(across, halfWidth) - radius * 0.3 + 0.01 * tumble + roll;
    const y = across * halfWidth + (hash1(i + 340) - HALF) * 0.02;
    disc(ctx, pt(x - radius * 0.3, y + radius * 0.2), radius, FOAM_SHADE);
    disc(ctx, pt(x, y), radius * 0.92, FOAM);
  }

  // Spray flung ahead of the crest.
  for (let i = 0; i < SPRAY_DROPS; i++) {
    const across = (hash1(i + 60) * 2 - 1) * 0.85;
    const age = fract(phase * SPRAY_CYCLES_PER_LOOP + hash1(i + 80));
    const x = crestX(across, halfWidth) + 0.03 + age * 0.2;
    const y = across * halfWidth + (hash1(i + 100) - HALF) * 0.06;
    const fade = 1 - age;
    disc(
      ctx,
      pt(x, y),
      (0.01 + 0.012 * hash1(i + 120)) * (0.6 + 0.4 * fade),
      rgba(FOAM, 0.9 * fade),
    );
  }
}

// ── Splash ───────────────────────────────────────────────────────────────────

const SPLASH_RIPPLE_REACH = 0.5;
const SPLASH_RIM = 0.16;
const SPLASH_FLOOR_SQUASH = 0.4;
const SPLASH_CROWN_SPIKES = 9;
const SPLASH_CROWN_HEIGHT = 0.42;
const SPLASH_DROPS = 12;
const SPLASH_GRAVITY = 1.6;

/**
 * An impact splash on the floor: a crown of water thrown up round the point
 * of impact, droplets arcing out of it, and a ripple spreading over the ground.
 * `progress` runs 0 at impact to 1 when the last ripple is gone.
 */
export function drawSplash(ctx: Ctx, progress: number): void {
  ctx.save();
  try {
    ctx.scale(SPLASH_SCALE, SPLASH_SCALE);
    paintSplash(ctx, progress);
  } finally {
    ctx.restore();
  }
}

/**
 * The splash is drawn larger than its authored size: at the in-game tile it
 * has to read as a burst of water on a hit, not a blue dot.
 */
const SPLASH_SCALE = 1.3;

function paintSplash(ctx: Ctx, progress: number): void {
  const p = clamp01(progress);
  const fade = 1 - p;

  const ripple = lerp(SPLASH_RIM, SPLASH_RIPPLE_REACH, Math.sqrt(p));
  ctx.beginPath();
  ctx.ellipse(0, 0, ripple * 0.85, ripple * 0.85 * SPLASH_FLOOR_SQUASH, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(WATER_BASE, 0.4 * fade);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, ripple, ripple * SPLASH_FLOOR_SQUASH, 0, 0, TWO_PI);
  ctx.lineWidth = 0.022 * (0.4 + fade);
  ctx.strokeStyle = rgba(FOAM, 0.85 * fade);
  ctx.stroke();

  // The crown: spikes rising off the rim then collapsing. Back half first.
  const rise = Math.sin(Math.min(1, p * 1.6) * Math.PI);
  const rim = SPLASH_RIM + 0.1 * p;
  const spike = (i: number): void => {
    const angle = (i / SPLASH_CROWN_SPIKES) * TWO_PI + 0.3;
    const base = pt(Math.cos(angle) * rim, Math.sin(angle) * rim * SPLASH_FLOOR_SQUASH);
    const height = SPLASH_CROWN_HEIGHT * rise * (0.7 + 0.3 * hash1(i));
    const lean = Math.cos(angle) * 0.1 * rise;
    const top = pt(base.x + lean, base.y - height);
    const halfBase = 0.045;
    ctx.beginPath();
    ctx.moveTo(base.x - halfBase, base.y);
    ctx.quadraticCurveTo(base.x - halfBase * 0.3, lerp(base.y, top.y, 0.6), top.x, top.y);
    ctx.quadraticCurveTo(
      base.x + halfBase * 0.3,
      lerp(base.y, top.y, 0.6),
      base.x + halfBase,
      base.y,
    );
    ctx.closePath();
    const front = Math.sin(angle) > 0;
    ctx.fillStyle = rgba(front ? WATER_LIGHT : WATER_BASE, 0.9 * fade + 0.1);
    ctx.fill();
    if (height > 0.03) disc(ctx, top, 0.022, rgba(FOAM, 0.95 * fade + 0.05));
  };
  for (let i = 0; i < SPLASH_CROWN_SPIKES; i++) {
    const angle = (i / SPLASH_CROWN_SPIKES) * TWO_PI + 0.3;
    if (Math.sin(angle) <= 0) spike(i);
  }
  // The column of water thrown straight up in the middle.
  const column = SPLASH_CROWN_HEIGHT * 1.2 * Math.sin(Math.min(1, p * 1.3) * Math.PI);
  if (column > 0.02) {
    ctx.beginPath();
    ctx.ellipse(0, -column * HALF, 0.05, column * HALF, 0, 0, TWO_PI);
    ctx.fillStyle = rgba(WATER_LIGHT, 0.75 * fade);
    ctx.fill();
    disc(ctx, pt(0, -column), 0.035, rgba(FOAM, 0.9 * fade));
  }
  for (let i = 0; i < SPLASH_CROWN_SPIKES; i++) {
    const angle = (i / SPLASH_CROWN_SPIKES) * TWO_PI + 0.3;
    if (Math.sin(angle) > 0) spike(i);
  }

  for (let i = 0; i < SPLASH_DROPS; i++) {
    const angle = hash1(i + 7) * TWO_PI;
    const speed = 0.4 + 0.4 * hash1(i + 13);
    const up = 0.9 + 0.6 * hash1(i + 19);
    const t = p * 0.9;
    const x = Math.cos(angle) * speed * t;
    const y = Math.sin(angle) * speed * t * SPLASH_FLOOR_SQUASH - up * t + SPLASH_GRAVITY * t * t;
    if (y > 0.02) continue;
    disc(ctx, pt(x, y - 0.02), 0.016 + 0.01 * hash1(i + 31), rgba(FOAM, 0.95 * fade));
  }
}
