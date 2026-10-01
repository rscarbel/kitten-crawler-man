/**
 * Painter for wall fixtures: the sconces, tubes, lamps, panels, cameras,
 * chains, banners and screens hung on dungeon wall faces.
 *
 * Drawn live every frame, because every one of them moves, glows or breaks.
 * Each is a handful of flat shapes in fixture space: one unit is one tile, x
 * runs across the face tile the fixture hangs on, and y = 1 is the face's
 * foot, so y below 0 climbs into the face's upper tile. Shapes follow the
 * shared prop light: a lit top edge, a mid-tone front, a short soft shadow
 * on the face below. Only a fixture's own emitter — a flame, a tube, a lens,
 * a screen — is painted bright; the light it throws is the lighting pass's.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import {
  BANNER_TEAR_STAGES,
  FIXTURE_HIT_FLASH_FRAMES,
  FIXTURE_SWING_FRAMES,
  type WallFixture,
} from '../../map/dungeon/wallFixtures';
import { UINT32_SPAN } from '../../core/WorldRandom';

type Ctx = CanvasRenderingContext2D;

/** What a fixture's draw needs besides the fixture. */
export interface WallFixtureView {
  readonly nowMs: number;
  readonly floor: DungeonFloorThemeId;
  /** Whether its light, if it has one, is on: whole, and its breaker too. */
  readonly lit: boolean;
  /**
   * Where the thing a camera watches is, in pixels from the face tile's
   * top-left; null when nothing is watched.
   */
  readonly watch: { readonly dx: number; readonly dy: number } | null;
}

interface MetalRamp {
  readonly dark: string;
  readonly mid: string;
  readonly lit: string;
  readonly shadow: string;
}

/** Floor 1 hangs blackened iron; floor 2 painted steel. */
const METAL: Readonly<Record<DungeonFloorThemeId, MetalRamp>> = {
  cellars: { dark: '#1f1b18', mid: '#3d3631', lit: '#6b6157', shadow: 'rgba(8,5,3,0.45)' },
  service_level: {
    dark: '#262b31',
    mid: '#4c545d',
    lit: '#8a949e',
    shadow: 'rgba(3,5,8,0.45)',
  },
};

const MS_PER_SECOND = 1000;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
/** Seeds are split into independent bits for the passes allowed to vary. */
const SEED_SHIFT_PHASE = 8;
const BYTE = 0xff;

function seedByte(seed: number, shift: number): number {
  return ((seed >>> shift) & BYTE) / BYTE;
}

/** Hash multipliers and shifts; any odd constants with good bit spread. */
const HASH_SEED_MIX = 0x9e3779b9;
const HASH_A = 0x85ebca6b;
const HASH_B = 0xc2b2ae35;
const HASH_C = 0x27d4eb2f;
const HASH_SHIFT_1 = 13;
const HASH_SHIFT_2 = 16;

/** A stable 0–1 hash of an integer pair, for flicker steps that must not use the frame's random stream. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ HASH_SEED_MIX, HASH_A) ^ Math.imul(b, HASH_B);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_1), HASH_C);
  return ((h ^ (h >>> HASH_SHIFT_2)) >>> 0) / UINT32_SPAN;
}

// ── Shared shapes ───────────────────────────────────────────────────────────

/** A box with a lit top edge and a soft shadow cast down the face below it. */
function plate(
  ctx: Ctx,
  ramp: MetalRamp,
  x: number,
  y: number,
  w: number,
  h: number,
  front: string = ramp.mid,
): void {
  ctx.fillStyle = ramp.shadow;
  ctx.fillRect(x + PLATE_SHADOW_INSET, y + h, w - PLATE_SHADOW_INSET * 2, PLATE_SHADOW_DEPTH);
  ctx.fillStyle = ramp.dark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = front;
  ctx.fillRect(x + PLATE_RIM, y + PLATE_RIM, w - PLATE_RIM * 2, h - PLATE_RIM * 2);
  ctx.fillStyle = ramp.lit;
  ctx.fillRect(x, y, w, PLATE_TOP_LIGHT);
}
const PLATE_RIM = 0.025;
const PLATE_TOP_LIGHT = 0.03;
const PLATE_SHADOW_INSET = 0.02;
const PLATE_SHADOW_DEPTH = 0.06;

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_TURN);
  ctx.fill();
}

/** A soft disc's colour at its centre, fading to nothing at its rim, as `r,g,b`. */
type GlowRgb = string;

/** Pixels across a cached glow sprite; it is drawn scaled, so this only sets its smoothness. */
const GLOW_SPRITE_PX = 64;
const glowSprites = new Map<GlowRgb, CanvasSurface>();

/**
 * A soft disc of one colour, painted once and reused: a fixture draws every
 * frame, and a gradient built per draw is an allocation per fixture per frame.
 */
function glowSprite(rgb: GlowRgb): CanvasSurface {
  const cached = glowSprites.get(rgb);
  if (cached !== undefined) return cached;
  const sprite = allocCanvas(GLOW_SPRITE_PX, GLOW_SPRITE_PX);
  const c = surfaceContext(sprite);
  const radius = GLOW_SPRITE_PX * HALF;
  const gradient = c.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, `rgba(${rgb},1)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = gradient;
  c.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX);
  glowSprites.set(rgb, sprite);
  return sprite;
}

/** A soft disc of `rgb` at `(x, y)`, its centre at `alpha`. */
function glowDisc(ctx: Ctx, x: number, y: number, r: number, rgb: GlowRgb, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

// ── Sconce ──────────────────────────────────────────────────────────────────

const SCONCE = {
  plateX: 0.4,
  plateY: -0.34,
  plateW: 0.2,
  plateH: 0.62,
  armY: 0.16,
  armReach: 0.1,
  cupTopY: 0.0,
  cupBottomY: 0.14,
  cupHalfTop: 0.2,
  cupHalfBottom: 0.09,
  flameHeight: 0.42,
  flameHalfWidth: 0.11,
  coreShare: 0.55,
  sootY: -0.45,
  sootRadius: 0.32,
  sootRgb: '10,7,5',
  sootAlpha: 0.55,
  emberCount: 3,
  emberRise: 0.32,
  emberPeriodMs: 1400,
  emberRadius: 0.018,
  emberDrift: 0.05,
  /** The nursery sconce's two beat rates, so a floor's flames move as its reference does. */
  flameRateA: 7.3,
  flameRateB: 11.9,
  flameSway: 0.12,
  /** The second beat runs at twice the first's phase offset, so the two never line up. */
  secondBeatPhaseScale: 2,
  brokenTilt: 0.55,
} as const;

function drawSconce(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const s = SCONCE;
  glowDisc(ctx, HALF, s.sootY, s.sootRadius, s.sootRgb, s.sootAlpha);
  plate(ctx, ramp, s.plateX, s.plateY, s.plateW, s.plateH);
  const broken = fixture.state.broken;
  ctx.save();
  ctx.translate(HALF, s.armY);
  if (broken) ctx.rotate(s.brokenTilt * (seedByte(fixture.seed, 0) < HALF ? -1 : 1));
  ctx.fillStyle = ramp.dark;
  ctx.fillRect(-PLATE_RIM, -s.armReach, PLATE_RIM * 2, s.armReach);
  ctx.beginPath();
  ctx.moveTo(-s.cupHalfTop, s.cupTopY - s.armY);
  ctx.lineTo(s.cupHalfTop, s.cupTopY - s.armY);
  ctx.lineTo(s.cupHalfBottom, s.cupBottomY - s.armY);
  ctx.lineTo(-s.cupHalfBottom, s.cupBottomY - s.armY);
  ctx.closePath();
  ctx.fillStyle = broken ? ramp.dark : ramp.mid;
  ctx.fill();
  ctx.fillStyle = broken ? '#141110' : ramp.lit;
  ctx.fillRect(-s.cupHalfTop, s.cupTopY - s.armY, s.cupHalfTop * 2, PLATE_TOP_LIGHT);
  ctx.restore();
  if (broken || !view.lit) return;

  const seconds = view.nowMs / MS_PER_SECOND;
  const phase = seedByte(fixture.seed, SEED_SHIFT_PHASE) * FULL_TURN;
  const beat =
    HALF *
    (Math.sin(seconds * s.flameRateA + phase) +
      Math.sin(seconds * s.flameRateB + phase * s.secondBeatPhaseScale));
  const height = s.flameHeight * (1 + s.flameSway * beat);
  const lean = s.flameHalfWidth * s.flameSway * beat;
  const baseY = s.cupTopY;
  flame(ctx, HALF, baseY, s.flameHalfWidth, height, lean, '#ff9a3a');
  flame(ctx, HALF, baseY, s.flameHalfWidth * s.coreShare, height * s.coreShare, lean, '#fff0b8');
  for (let index = 0; index < s.emberCount; index++) {
    const t =
      (((view.nowMs + (index * s.emberPeriodMs) / s.emberCount) % s.emberPeriodMs) +
        phase * MS_PER_SECOND) %
      s.emberPeriodMs;
    const rise = t / s.emberPeriodMs;
    const x = HALF + Math.sin(rise * FULL_TURN + index) * s.emberDrift;
    const y = baseY - height * HALF - rise * s.emberRise;
    ctx.globalAlpha = 1 - rise;
    disc(ctx, x, y, s.emberRadius, '#ffb347');
  }
  ctx.globalAlpha = 1;
}

function flame(
  ctx: Ctx,
  x: number,
  baseY: number,
  halfWidth: number,
  height: number,
  lean: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.quadraticCurveTo(x - halfWidth, baseY - height * HALF, x + lean, baseY - height);
  ctx.quadraticCurveTo(x + halfWidth, baseY - height * HALF, x + halfWidth, baseY);
  ctx.closePath();
  ctx.fill();
}

// ── Fluorescent tube ────────────────────────────────────────────────────────

const TUBE = {
  x: 0.08,
  y: -0.5,
  w: 0.84,
  h: 0.13,
  tubeInset: 0.05,
  tubeH: 0.06,
  capW: 0.05,
  brokenStubW: 0.22,
  glowRgb: '200,230,255',
  glowAlpha: 0.35,
} as const;

function drawTube(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const t = TUBE;
  plate(ctx, ramp, t.x, t.y, t.w, t.h, ramp.dark);
  const tubeY = t.y + (t.h - t.tubeH) / 2;
  const tubeX = t.x + t.tubeInset;
  const tubeW = t.w - t.tubeInset * 2;
  ctx.fillStyle = ramp.lit;
  ctx.fillRect(tubeX - t.capW, tubeY, t.capW, t.tubeH);
  ctx.fillRect(tubeX + tubeW, tubeY, t.capW, t.tubeH);
  if (fixture.state.broken) {
    ctx.fillStyle = '#9aa3aa';
    ctx.fillRect(tubeX, tubeY, t.brokenStubW, t.tubeH);
    ctx.fillRect(tubeX + tubeW - t.brokenStubW * HALF, tubeY, t.brokenStubW * HALF, t.tubeH);
    return;
  }
  if (view.lit) {
    glowDisc(ctx, HALF, tubeY + t.tubeH / 2, t.w * HALF, t.glowRgb, t.glowAlpha);
    ctx.fillStyle = '#eef8ff';
  } else {
    ctx.fillStyle = '#7f8a92';
  }
  ctx.fillRect(tubeX, tubeY, tubeW, t.tubeH);
}

// ── Sodium lamp ─────────────────────────────────────────────────────────────

const SODIUM = {
  baseX: 0.32,
  baseY: -0.42,
  baseW: 0.36,
  baseH: 0.08,
  globeY: -0.22,
  globeRx: 0.15,
  globeRy: 0.12,
  cageBars: 3,
  cageBarW: 0.018,
  glowRgb: '255,160,50',
  glowAlpha: 0.45,
  /** The glow reaches this many globe radii out. */
  glowScale: 2,
} as const;

function drawSodium(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const s = SODIUM;
  plate(ctx, ramp, s.baseX, s.baseY, s.baseW, s.baseH);
  const broken = fixture.state.broken;
  const glass = broken ? '#2a1c12' : view.lit ? '#ffb24a' : '#6b4a2a';
  if (!broken && view.lit) {
    glowDisc(ctx, HALF, s.globeY, s.globeRx * s.glowScale, s.glowRgb, s.glowAlpha);
  }
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(HALF, s.globeY, s.globeRx, s.globeRy, 0, 0, FULL_TURN);
  ctx.fill();
  if (!broken && view.lit) {
    disc(ctx, HALF, s.globeY, s.globeRy * HALF, '#ffe7b0');
  }
  ctx.fillStyle = ramp.dark;
  for (let bar = 0; bar < s.cageBars; bar++) {
    const x = HALF - s.globeRx + ((bar + 1) * (s.globeRx * 2)) / (s.cageBars + 1);
    ctx.fillRect(x - s.cageBarW / 2, s.globeY - s.globeRy, s.cageBarW, s.globeRy * 2);
  }
  if (broken) crack(ctx, HALF, s.globeY, s.globeRx, fixture.seed);
}

// ── Emergency light ─────────────────────────────────────────────────────────

const EMERGENCY = {
  x: 0.32,
  y: -0.5,
  w: 0.36,
  h: 0.18,
  lensY: -0.33,
  lensR: 0.09,
  /** A slow breath, about every two seconds, the same beat the lighting pass gives it. */
  pulseRate: 2.8,
  glowRgb: '255,50,40',
  /** The glow's alpha at the bottom of a breath, and how much a full breath adds. */
  glowMinAlpha: 0.25,
  glowPulseAlpha: 0.3,
  /** The glow reaches this many lens radii out. */
  glowScale: 3,
} as const;

/** A glass lens's highlight: up and left of centre, toward the key light. */
const GLINT_SHARE = 0.3;

function drawEmergency(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const e = EMERGENCY;
  plate(ctx, ramp, e.x, e.y, e.w, e.h);
  if (fixture.state.broken || !view.lit) {
    disc(ctx, HALF, e.lensY, e.lensR, '#3a1414');
    if (fixture.state.broken) crack(ctx, HALF, e.lensY, e.lensR, fixture.seed);
    return;
  }
  const pulse = HALF + HALF * Math.sin((view.nowMs / MS_PER_SECOND) * e.pulseRate);
  const glowAlpha = e.glowMinAlpha + e.glowPulseAlpha * pulse;
  glowDisc(ctx, HALF, e.lensY, e.lensR * e.glowScale, e.glowRgb, glowAlpha);
  disc(ctx, HALF, e.lensY, e.lensR, pulse > HALF ? '#ff4a3a' : '#c62a22');
  const glint = e.lensR * GLINT_SHARE;
  disc(ctx, HALF - glint, e.lensY - glint, glint, '#ffb0a0');
}

// ── Fuse box ────────────────────────────────────────────────────────────────

const FUSE = {
  x: 0.24,
  y: -0.38,
  w: 0.52,
  h: 0.62,
  doorInset: 0.05,
  labelY: -0.28,
  labelR: 0.06,
  ledX: 0.68,
  ledY: -0.3,
  ledR: 0.022,
  ledPeriodMs: 1200,
  openDoorW: 0.16,
  breakerRows: 3,
  breakerW: 0.08,
  breakerH: 0.06,
  sparkWindowMs: 180,
  sparkChance: 0.35,
  sparkCount: 4,
  sparkReach: 0.14,
} as const;

function drawFuseBox(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const f = FUSE;
  if (!fixture.state.broken) {
    plate(ctx, ramp, f.x, f.y, f.w, f.h);
    ctx.fillStyle = ramp.dark;
    ctx.fillRect(f.x + f.doorInset, f.y + f.h * HALF, f.w - f.doorInset * 2, PLATE_RIM);
    hazardTriangle(ctx, HALF, f.labelY, f.labelR);
    const blink = view.nowMs % f.ledPeriodMs < f.ledPeriodMs * HALF;
    disc(ctx, f.ledX, f.ledY, f.ledR, blink ? '#7dff7a' : '#2f6a2e');
    return;
  }
  plate(ctx, ramp, f.x, f.y, f.w, f.h, '#0e0d0c');
  ctx.fillStyle = 'rgba(30,20,10,0.8)';
  ctx.fillRect(f.x + f.doorInset, f.y + f.doorInset, f.w - f.doorInset * 2, f.h - f.doorInset * 2);
  ctx.fillStyle = '#3b3b38';
  for (let row = 0; row < f.breakerRows; row++) {
    const y = f.y + f.doorInset * 2 + row * f.breakerH * 2;
    ctx.fillRect(f.x + f.doorInset * 2, y, f.breakerW, f.breakerH);
    ctx.fillRect(f.x + f.w - f.doorInset * 2 - f.breakerW, y, f.breakerW, f.breakerH);
  }
  ctx.fillStyle = ramp.mid;
  ctx.beginPath();
  ctx.moveTo(f.x + f.w, f.y);
  ctx.lineTo(f.x + f.w + f.openDoorW, f.y + f.doorInset);
  ctx.lineTo(f.x + f.w + f.openDoorW, f.y + f.h + f.doorInset);
  ctx.lineTo(f.x + f.w, f.y + f.h);
  ctx.closePath();
  ctx.fill();
  const window = Math.floor(view.nowMs / f.sparkWindowMs);
  if (hash01(window, fixture.seed) < f.sparkChance) {
    ctx.strokeStyle = '#fff4a0';
    ctx.lineWidth = PLATE_RIM;
    for (let spark = 0; spark < f.sparkCount; spark++) {
      const angle = hash01(window + spark, fixture.seed + 1) * FULL_TURN;
      const reach = f.sparkReach * hash01(window, spark);
      ctx.beginPath();
      ctx.moveTo(HALF, HALF * (f.y * 2 + f.h));
      ctx.lineTo(HALF + Math.cos(angle) * reach, HALF * (f.y * 2 + f.h) + Math.sin(angle) * reach);
      ctx.stroke();
    }
  }
}

/** The exclamation bar inside a hazard triangle, in shares of the triangle's radius. */
const HAZARD_BAR_HALF_WIDTH = 0.12;
const HAZARD_BAR_HEIGHT = 0.6;

function hazardTriangle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = '#e8c33a';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y + r * HALF);
  ctx.lineTo(x - r, y + r * HALF);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  const barHalfWidth = r * HAZARD_BAR_HALF_WIDTH;
  ctx.fillRect(x - barHalfWidth, y - r * HALF, barHalfWidth * 2, r * HAZARD_BAR_HEIGHT);
}

// ── Steam valve ─────────────────────────────────────────────────────────────

const VALVE = {
  pipeX: 0.44,
  pipeTop: -0.45,
  pipeW: 0.12,
  pipeBottom: 0.3,
  flangeY: -0.05,
  flangeH: 0.06,
  wheelY: 0.02,
  wheelR: 0.13,
  hubR: 0.03,
  spokes: 4,
  puffPeriodMs: 3800,
  puffLengthMs: 700,
  puffRise: 0.4,
  puffR: 0.1,
  hissPuffR: 0.22,
  hissFramesPerPuff: 30,
  /** The wheel's dark hub plate, as a share of the rim's radius. */
  wheelInnerShare: 0.75,
  spokeWidth: 0.04,
  /** The flange stands proud of the pipe by this much each side. */
  flangeOverhang: 0.05,
  puffMaxAlpha: 0.6,
} as const;

function drawSteamValve(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const v = VALVE;
  plate(ctx, ramp, v.pipeX, v.pipeTop, v.pipeW, v.pipeBottom - v.pipeTop);
  plate(
    ctx,
    ramp,
    v.pipeX - v.flangeOverhang,
    v.flangeY,
    v.pipeW + v.flangeOverhang * 2,
    v.flangeH,
  );
  disc(ctx, HALF, v.wheelY, v.wheelR, '#7a1d16');
  disc(ctx, HALF, v.wheelY, v.wheelR * v.wheelInnerShare, ramp.dark);
  ctx.strokeStyle = '#9c2a20';
  ctx.lineWidth = v.spokeWidth;
  for (let spoke = 0; spoke < v.spokes; spoke++) {
    const angle = (spoke / v.spokes) * Math.PI + seedByte(fixture.seed, 0);
    ctx.beginPath();
    ctx.moveTo(HALF - Math.cos(angle) * v.wheelR, v.wheelY - Math.sin(angle) * v.wheelR);
    ctx.lineTo(HALF + Math.cos(angle) * v.wheelR, v.wheelY + Math.sin(angle) * v.wheelR);
    ctx.stroke();
  }
  disc(ctx, HALF, v.wheelY, v.hubR, '#c9a14a');

  const offset = seedByte(fixture.seed, SEED_SHIFT_PHASE) * v.puffPeriodMs;
  const into = (view.nowMs + offset) % v.puffPeriodMs;
  if (into < v.puffLengthMs) puff(ctx, into / v.puffLengthMs, v.puffR, v.puffRise);
  const hiss = fixture.state.hissFrames;
  if (hiss > 0) {
    const share = 1 - (hiss % v.hissFramesPerPuff) / v.hissFramesPerPuff;
    puff(ctx, share, v.hissPuffR, v.puffRise);
  }
}

function puff(ctx: Ctx, share: number, radius: number, rise: number): void {
  ctx.globalAlpha = (1 - share) * VALVE.puffMaxAlpha;
  disc(
    ctx,
    HALF + share * radius * HALF,
    VALVE.flangeY - share * rise,
    radius * (HALF + share),
    '#e8eef0',
  );
  ctx.globalAlpha = 1;
}

// ── Camera dome ─────────────────────────────────────────────────────────────

const CAMERA = {
  armX: 0.47,
  armY: -0.5,
  armW: 0.06,
  armH: 0.12,
  domeY: -0.22,
  domeR: 0.2,
  lensR: 0.07,
  lensTravel: 0.09,
  ledX: 0.66,
  ledY: -0.36,
  ledR: 0.028,
  ledPeriodMs: 900,
  brokenDrop: 0.08,
} as const;

function drawCameraDome(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const c = CAMERA;
  plate(ctx, ramp, c.armX, c.armY, c.armW, c.armH);
  const broken = fixture.state.broken;
  const domeY = broken ? c.domeY + c.brokenDrop : c.domeY;
  ctx.fillStyle = ramp.lit;
  ctx.beginPath();
  ctx.arc(HALF, domeY - c.domeR * HALF, c.domeR, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = broken ? '#1b1d20' : '#2c3238';
  ctx.beginPath();
  ctx.arc(HALF, domeY - c.domeR * HALF, c.domeR, 0, Math.PI);
  ctx.fill();
  if (broken) {
    crack(ctx, HALF, domeY, c.domeR, fixture.seed);
    return;
  }
  let lensX = HALF;
  let lensY = domeY;
  if (view.watch !== null) {
    const angle = Math.atan2(view.watch.dy, view.watch.dx);
    lensX += Math.cos(angle) * c.lensTravel;
    lensY += Math.max(0, Math.sin(angle)) * c.lensTravel * HALF;
  }
  disc(ctx, lensX, lensY, c.lensR, '#0b0d10');
  const glint = c.lensR * GLINT_SHARE;
  disc(ctx, lensX - glint, lensY - glint, glint, '#6fa8c8');
  if (view.nowMs % c.ledPeriodMs < c.ledPeriodMs * HALF)
    disc(ctx, c.ledX, c.ledY, c.ledR, '#ff3a2a');
}

// ── Hanging chains ──────────────────────────────────────────────────────────

const CHAINS = {
  hookY: -0.55,
  hookR: 0.055,
  chainOffsets: [-0.12, 0.12],
  minLength: 0.75,
  lengthVariance: 0.35,
  linkLength: 0.09,
  linkWidth: 0.05,
  idleSway: 0.03,
  idleRate: 1.1,
  swingAmplitude: 0.45,
  swingRate: 6,
  manacleR: 0.06,
} as const;
/** Share of a link's pitch that is iron; the rest is the gap to the next link. */
const LINK_FILL = 0.8;

function drawChains(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const c = CHAINS;
  const seconds = view.nowMs / MS_PER_SECOND;
  const decay = fixture.state.swingFrames / FIXTURE_SWING_FRAMES;
  c.chainOffsets.forEach((offset, index) => {
    const length =
      c.minLength + seedByte(fixture.seed, index * SEED_SHIFT_PHASE) * c.lengthVariance;
    const swing =
      Math.sin(seconds * c.idleRate + index) * c.idleSway +
      Math.sin(seconds * c.swingRate + index) * c.swingAmplitude * decay;
    ctx.save();
    ctx.translate(HALF + offset, c.hookY);
    ctx.rotate(swing);
    ctx.fillStyle = ramp.shadow;
    ctx.fillRect(c.linkWidth * HALF, PLATE_SHADOW_DEPTH, c.linkWidth, length);
    for (let y = 0; y < length; y += c.linkLength) {
      const sideways = Math.floor(y / c.linkLength) % 2 === 0;
      ctx.fillStyle = sideways ? ramp.mid : ramp.lit;
      const w = sideways ? c.linkWidth * 2 : c.linkWidth;
      ctx.fillRect(-w / 2, y, w, c.linkLength * LINK_FILL);
    }
    ctx.strokeStyle = ramp.lit;
    ctx.lineWidth = c.linkWidth * HALF;
    ctx.beginPath();
    ctx.arc(0, length + c.manacleR, c.manacleR, 0, FULL_TURN);
    ctx.stroke();
    ctx.restore();
  });
  disc(ctx, HALF, c.hookY, c.hookR, ramp.lit);
}

// ── Torn banner ─────────────────────────────────────────────────────────────

const BANNER = {
  rodY: -0.55,
  rodX: 0.18,
  rodW: 0.64,
  rodH: 0.04,
  clothX: 0.24,
  clothW: 0.52,
  clothBottom: 0.45,
  tatters: 5,
  tatterDepth: 0.12,
  emblemY: -0.15,
  emblemR: 0.09,
  trimH: 0.04,
  /** Each tear stage takes this share of the cloth's length away. */
  tearShare: 0.13,
} as const;

const BANNER_COLOURS = ['#5e1b1b', '#22324f', '#2f4523'] as const;

function drawBanner(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const b = BANNER;
  const stage = Math.min(BANNER_TEAR_STAGES, fixture.state.tearStage);
  const colourIndex = Math.floor(seedByte(fixture.seed, 0) * BANNER_COLOURS.length);
  const cloth = BANNER_COLOURS[Math.min(BANNER_COLOURS.length - 1, colourIndex)];
  const top = b.rodY + b.rodH;
  const fullLength = b.clothBottom - top;
  const length = fullLength * (1 - stage * b.tearShare);
  const tatterWidth = b.clothW / b.tatters;

  ctx.fillStyle = ramp.shadow;
  ctx.fillRect(b.clothX + PLATE_SHADOW_INSET, top + PLATE_SHADOW_DEPTH, b.clothW, length);
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(b.clothX, top);
  ctx.lineTo(b.clothX + b.clothW, top);
  for (let index: number = b.tatters; index >= 0; index--) {
    const x = b.clothX + index * tatterWidth;
    // Rags hang in strips; a whole banner keeps a straight hem with a notch.
    const strip = stage === BANNER_TEAR_STAGES ? hash01(index, fixture.seed) : 0;
    const ragged = stage > 0 ? hash01(index, fixture.seed + stage) * b.tatterDepth : 0;
    ctx.lineTo(x, top + length - ragged - strip * length * HALF);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,150,0.18)';
  ctx.fillRect(b.clothX, top, b.clothW, b.trimH);
  if (stage < BANNER_TEAR_STAGES) disc(ctx, HALF, b.emblemY, b.emblemR, '#b8913f');
  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(10,6,4,0.8)';
    ctx.lineWidth = PLATE_RIM;
    ctx.beginPath();
    ctx.moveTo(b.clothX + tatterWidth, top + fullLength * b.tearShare);
    ctx.lineTo(b.clothX + b.clothW - tatterWidth, top + length * (1 - b.tearShare));
    ctx.stroke();
  }
  plate(ctx, ramp, b.rodX, b.rodY, b.rodW, b.rodH);
}

// ── Monitor bank ────────────────────────────────────────────────────────────

const MONITORS = {
  shelfX: 0.06,
  shelfY: 0.0,
  shelfW: 0.88,
  shelfH: 0.05,
  screens: [0.08, 0.52],
  screenW: 0.4,
  screenY: -0.36,
  screenH: 0.34,
  bezel: 0.04,
  bands: 4,
  staticStepMs: 90,
  /** A static band's alpha at its dimmest, and how much brighter it may roll. */
  staticMinAlpha: 0.12,
  staticRange: 0.35,
} as const;

function drawMonitors(ctx: Ctx, fixture: WallFixture, view: WallFixtureView): void {
  const ramp = METAL[view.floor];
  const m = MONITORS;
  plate(ctx, ramp, m.shelfX, m.shelfY, m.shelfW, m.shelfH);
  const step = Math.floor(view.nowMs / m.staticStepMs);
  m.screens.forEach((x, screen) => {
    plate(ctx, ramp, x, m.screenY, m.screenW, m.screenH, ramp.dark);
    const innerX = x + m.bezel;
    const innerY = m.screenY + m.bezel;
    const innerW = m.screenW - m.bezel * 2;
    const innerH = m.screenH - m.bezel * 2;
    if (fixture.state.broken || !view.lit) {
      ctx.fillStyle = '#070809';
      ctx.fillRect(innerX, innerY, innerW, innerH);
      if (fixture.state.broken)
        crack(
          ctx,
          x + m.screenW * HALF,
          innerY + innerH * HALF,
          innerW * HALF,
          fixture.seed + screen,
        );
      return;
    }
    ctx.fillStyle = '#1d4a5c';
    ctx.fillRect(innerX, innerY, innerW, innerH);
    const bandH = innerH / m.bands;
    for (let band = 0; band < m.bands; band++) {
      const level = hash01(step * m.bands + band, fixture.seed + screen);
      ctx.fillStyle = `rgba(170,230,255,${m.staticMinAlpha + m.staticRange * level})`;
      ctx.fillRect(innerX, innerY + band * bandH, innerW, bandH * HALF);
    }
  });
}

// ── Damage marks ────────────────────────────────────────────────────────────

const CRACK_RAYS = 4;

function crack(ctx: Ctx, x: number, y: number, r: number, seed: number): void {
  ctx.strokeStyle = 'rgba(220,230,235,0.75)';
  ctx.lineWidth = PLATE_RIM * HALF;
  for (let ray = 0; ray < CRACK_RAYS; ray++) {
    const angle = hash01(ray, seed) * FULL_TURN;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    ctx.stroke();
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

const HIT_FLASH_RADIUS = 0.45;
const HIT_FLASH_CENTRE_Y = -0.15;
const HIT_FLASH_MAX_ALPHA = 0.35;
const HIT_FLASH_RGB = '255,240,210';

/**
 * Draws one fixture with its face tile's top-left at `(sx, sy)` and a tile
 * `ts` pixels across.
 */
export function drawWallFixture(
  ctx: Ctx,
  fixture: WallFixture,
  sx: number,
  sy: number,
  ts: number,
  view: WallFixtureView,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(ts, ts);
  switch (fixture.kind) {
    case 'sconce':
      drawSconce(ctx, fixture, view);
      break;
    case 'fluorescent_tube':
      drawTube(ctx, fixture, view);
      break;
    case 'sodium_lamp':
      drawSodium(ctx, fixture, view);
      break;
    case 'emergency_light':
      drawEmergency(ctx, fixture, view);
      break;
    case 'fuse_box':
      drawFuseBox(ctx, fixture, view);
      break;
    case 'steam_valve':
      drawSteamValve(ctx, fixture, view);
      break;
    case 'camera_dome':
      drawCameraDome(ctx, fixture, view);
      break;
    case 'hanging_chains':
      drawChains(ctx, fixture, view);
      break;
    case 'torn_banner':
      drawBanner(ctx, fixture, view);
      break;
    case 'monitor_bank':
      drawMonitors(ctx, fixture, view);
      break;
  }
  const flash = fixture.state.hitFlashFrames;
  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const alpha = (flash / FIXTURE_HIT_FLASH_FRAMES) * HIT_FLASH_MAX_ALPHA;
    glowDisc(ctx, HALF, HIT_FLASH_CENTRE_Y, HIT_FLASH_RADIUS, HIT_FLASH_RGB, alpha);
  }
  ctx.restore();
}
