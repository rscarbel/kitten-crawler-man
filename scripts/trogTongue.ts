/**
 * The Troglodyte's tongue: the only weapon it has, and the thing a player will
 * remember it by.
 *
 * Drawn as its own sheet rather than as a row on the creature's, because it
 * reaches three tiles — twenty times the creature's own width — and baking it
 * into the body's cells would inflate every one of them by that much. The
 * runtime anchors the root at the mouth and rotates the whole frame toward the
 * target, so everything here is drawn along +X from an origin at the mouth,
 * in tile units.
 *
 * What has to read at a 32 px tile, in order: that it is *long*, that it is
 * *wet*, and that the far end of it is loaded with something the player does
 * not want in them. The barbs and the sheen are for the first two; the sickly
 * green club on the tip is for the third, and it is deliberately the brightest
 * thing on either sheet.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { TWO_PI, clamp01, deg, hash1, lerp, rgba, traceOutline, type Pt } from './ratArt';
import { grownOutline } from './goreWound';

/**
 * How far the tongue reaches at full extension, in tiles.
 *
 * A little past `TONGUE_RANGE_TILES` in `src/creatures/Troglodyte.ts`: the hit
 * test allows a slight overreach, and a tongue that stops visibly short of the
 * player it just poisoned is the kind of thing that reads as a bug.
 */
export const TONGUE_REACH_TILES = 3.2;

const OUTLINE_INK = '#180a0e';

/**
 * The tongue's own palette. The four tones `trogGore.ts` also needs are
 * exported, because it paints the severed tongue and the two have to be the
 * same colour — a dismembered tongue that is a different red from the tongue
 * that just poisoned the player reads as having come off something else.
 *
 * Deliberately not named `MUSCLE_*`: `goreWound.ts` exports those exact three
 * names with different values, and this file imports from it.
 */
const TONGUE_SHADOW = '#4a1120';
export const TONGUE_MID = '#8a3d4a';
export const TONGUE_LIGHT = '#b06a76';
const VENOM_DARK = '#5d7220';
export const VENOM_MID = '#93ab3a';
export const VENOM_LIGHT = '#d7ea82';
const SLIME = '#dcb4b8';
const BARB_HORN = '#d9cfae';

const ROOT_HALF = 0.085;
const NECK_HALF = 0.022;
const CLUB_HALF = 0.055;
/**
 * Below this the whip is shorter than the venom head it carries, and the strike
 * reads as a bead stuck to the creature's chin rather than as something about
 * to happen. The generator floors its own extension above this.
 */
const SHORTEST_WHIP = 0.11;
/** How far back from the tip the club's neck pinches in. */
const CLUB_NECK_AT = 0.82;

/**
 * Sideways travel of the whip, as a share of however long it currently is.
 *
 * A share rather than an absolute: a constant amplitude on a growing whip is a
 * wave that flattens out to a rod, which is what the first pass baked. It does
 * fall away over the last stretch, because the frame the tongue connects on
 * wants to be taut.
 */
const WAVE_AMPLITUDE_SHARE = 0.11;
/** Where in the throw the wave starts settling out for the hit. */
const WAVE_SETTLE_FROM = 0.82;
/** How many half-waves fit along the whip. Two is a lash; more is a noodle. */
const WAVE_TURNS = 1.9;
/** How far the wave travels down the tongue as it extends. */
const WAVE_TRAVEL = 0.9;
const SPINE_STEPS = 26;

const BARB_COUNT = 5;
const BARB_FROM = 0.42;
const BARB_LENGTH = 0.03;
const BARB_SWEEP = deg(38);

const DROPLET_COUNT = 4;
const DROPLET_SEED = 8081;
const DROPLET_MAX_R = 0.024;
const DROPLET_TRAIL = 0.42;
const DROPLET_SPREAD = 0.16;

const RIDGE_ALPHA = 0.4;
const RIDGE_SHARE = 0.3;
const SLIME_ALPHA = 0.34;
const GLOW_ALPHA = 0.3;

/** 0 → 1 → 0 over the unit interval. */
function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** 0 below `start`, 1 above `end`, linear between. */
function ramp01(value: number, start: number, end: number): number {
  if (end === start) return value < start ? 0 : 1;
  return clamp01((value - start) / (end - start));
}

interface Spine {
  readonly points: readonly Pt[];
  readonly halves: readonly number[];
  readonly tip: Pt;
  /** Direction the tongue is travelling at its tip, in radians. */
  readonly tipAngle: number;
  readonly length: number;
}

/**
 * The whip's centre line and the half-width along it.
 *
 * The wave amplitude grows toward the tip because the root is anchored in a
 * skull: a sine applied evenly along the whole length makes the mouth itself
 * appear to slide from side to side.
 */
function buildSpine(extension: number): Spine {
  const ext = clamp01(extension);
  const length = TONGUE_REACH_TILES * ext;
  const settle = 1 - ramp01(ext, WAVE_SETTLE_FROM, 1);
  const amplitude = length * WAVE_AMPLITUDE_SHARE * settle;
  const phase = ext * WAVE_TRAVEL * TWO_PI;
  const points: Pt[] = [];
  const halves: number[] = [];
  for (let i = 0; i <= SPINE_STEPS; i++) {
    const t = i / SPINE_STEPS;
    points.push({
      x: length * t,
      y: Math.sin(t * WAVE_TURNS * Math.PI + phase) * amplitude * t,
    });
    // The club is the whip's own profile swelling, not a separate shape parked
    // on the end of it. Drawn as its own oval it separates the moment the whip
    // curves and reads as a pea flying alongside the tongue.
    halves.push(halfWidthAt(t));
  }
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  return {
    points,
    halves,
    tip,
    tipAngle: Math.atan2(tip.y - before.y, tip.x - before.x),
    length,
  };
}

/**
 * The whip's half-width a fraction `t` along it: a long taper from the root,
 * swelling back out into the venom head over the last stretch.
 *
 * The head is the whip's own profile rather than a separate shape parked on the
 * end. Drawn as its own oval it separates the moment the whip curves, and a
 * venom bulb flying along beside a tongue is the worst thing this sheet can do.
 */
function halfWidthAt(t: number): number {
  const taper = lerp(ROOT_HALF, NECK_HALF, clamp01(t));
  if (t < CLUB_NECK_AT) return taper;
  const intoHead = (clamp01(t) - CLUB_NECK_AT) / (1 - CLUB_NECK_AT);
  return taper + (CLUB_HALF - NECK_HALF) * Math.sin(intoHead * Math.PI);
}

/** Offsets a centre line by its half-widths into a closed outline. */
function spineOutline(spine: Spine): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < spine.points.length; i++) {
    const here = spine.points[i];
    const prev = spine.points[Math.max(0, i - 1)];
    const next = spine.points[Math.min(spine.points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x) - Math.PI / 2;
    const half = spine.halves[i];
    const nx = Math.cos(angle) * half;
    const ny = Math.sin(angle) * half;
    left.push({ x: here.x + nx, y: here.y + ny });
    right.push({ x: here.x - nx, y: here.y - ny });
  }
  return [...left, ...right.reverse()];
}

/** A point a fraction of the way along the whip. */
function alongSpine(spine: Spine, t: number): Pt {
  const index = clamp01(t) * SPINE_STEPS;
  const low = Math.floor(index);
  const high = Math.min(SPINE_STEPS, low + 1);
  const frac = index - low;
  const a = spine.points[low];
  const b = spine.points[high];
  return { x: lerp(a.x, b.x, frac), y: lerp(a.y, b.y, frac) };
}

/** One frame of the strike. `extension` runs 0 at the mouth to 1 at full reach. */
export function drawTongue(ctx: Ctx, extension: number): void {
  const ext = clamp01(extension);
  const spine = buildSpine(ext);
  if (spine.length <= SHORTEST_WHIP) return;

  const outline = spineOutline(spine);
  const trace = (grow: number): void => traceOutline(ctx, grownOutline(outline, grow));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Venom glow behind everything, so the club reads as lit rather than painted.
  const glowAt = alongSpine(spine, 1);
  const glow = ctx.createRadialGradient(
    glowAt.x,
    glowAt.y,
    0,
    glowAt.x,
    glowAt.y,
    CLUB_HALF * GLOW_RADIUS,
  );
  glow.addColorStop(0, rgba(VENOM_MID, GLOW_ALPHA));
  glow.addColorStop(1, rgba(VENOM_MID, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(glowAt.x, glowAt.y, CLUB_HALF * GLOW_RADIUS, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = OUTLINE_INK;
  trace(OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = TONGUE_MID;
  trace(0);
  ctx.fill();

  // A dark underside and a lit dorsal ridge, which is what makes the whip read
  // as round rather than as a flat ribbon.
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.strokeStyle = rgba(TONGUE_SHADOW, RIDGE_ALPHA);
  ctx.lineWidth = ROOT_HALF * RIDGE_SHARE * 2;
  strokeSpine(ctx, spine, ROOT_HALF * RIDGE_SHARE);
  ctx.strokeStyle = rgba(TONGUE_LIGHT, RIDGE_ALPHA);
  strokeSpine(ctx, spine, -ROOT_HALF * RIDGE_SHARE);
  ctx.restore();

  // Barbs down the leading half — the hooks that keep a bite in.
  ctx.fillStyle = BARB_HORN;
  for (let i = 0; i < BARB_COUNT; i++) {
    const at = lerp(BARB_FROM, CLUB_NECK_AT, (i + 0.5) / BARB_COUNT);
    const root = alongSpine(spine, at);
    const side = i % 2 === 0 ? 1 : -1;
    const backward = spine.tipAngle + Math.PI + BARB_SWEEP * side;
    const across = spine.tipAngle + (Math.PI / 2) * side;
    const half = lerp(ROOT_HALF, NECK_HALF, at);
    const base = { x: root.x + Math.cos(across) * half, y: root.y + Math.sin(across) * half };
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(
      base.x + Math.cos(backward) * BARB_LENGTH,
      base.y + Math.sin(backward) * BARB_LENGTH,
    );
    ctx.lineTo(root.x, root.y);
    ctx.closePath();
    ctx.fill();
  }

  // The venom loaded into the swollen head, painted *inside* the whip's own
  // silhouette so there is no shape to come detached.
  ctx.save();
  trace(0);
  ctx.clip();
  const neck = alongSpine(spine, CLUB_NECK_AT);
  const venom = ctx.createLinearGradient(neck.x, neck.y, spine.tip.x, spine.tip.y);
  venom.addColorStop(0, rgba(VENOM_DARK, 0));
  venom.addColorStop(VENOM_FADE_AT, VENOM_DARK);
  venom.addColorStop(1, VENOM_MID);
  ctx.fillStyle = venom;
  ctx.fillRect(-1, -1, TONGUE_REACH_TILES + 2, 2);
  ctx.fillStyle = rgba(VENOM_LIGHT, VENOM_CORE_ALPHA);
  const core = alongSpine(spine, CLUB_CORE_AT);
  ctx.beginPath();
  ctx.ellipse(core.x, core.y, CLUB_HALF * CLUB_CORE_RX, CLUB_HALF * CLUB_CORE_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // Barbs round the swollen head, swept back and standing out past the outline:
  // the hooks the whip carries in, and the only thing on this sheet that breaks
  // the silhouette. Placed *on the spine*, not in the tip's own rotated frame —
  // a straight frame on a curving whip walks them off it within a tile.
  ctx.fillStyle = BARB_HORN;
  for (let i = 0; i < CLUB_BARBS; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const at = lerp(CLUB_BARB_FROM, CLUB_BARB_TO, Math.floor(i / 2) / CLUB_BARB_ROWS);
    const root = alongSpine(spine, at);
    const back = alongSpine(spine, Math.max(0, at - SPINE_SAMPLE));
    const tangent = Math.atan2(root.y - back.y, root.x - back.x);
    const across = tangent + (Math.PI / 2) * side;
    const half = halfWidthAt(at);
    const base = { x: root.x + Math.cos(across) * half, y: root.y + Math.sin(across) * half };
    const outward = across - BARB_SWEEP * side;
    const rearward = tangent + Math.PI;
    ctx.beginPath();
    ctx.moveTo(
      root.x + Math.cos(across) * half * CLUB_BARB_MOUTH,
      root.y + Math.sin(across) * half * CLUB_BARB_MOUTH,
    );
    ctx.lineTo(
      base.x + Math.cos(outward) * CLUB_BARB_LENGTH,
      base.y + Math.sin(outward) * CLUB_BARB_LENGTH,
    );
    ctx.lineTo(
      base.x + Math.cos(rearward) * CLUB_BARB_LENGTH * CLUB_BARB_BASE,
      base.y + Math.sin(rearward) * CLUB_BARB_LENGTH * CLUB_BARB_BASE,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Slime highlights along the top of the whip.
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.globalAlpha = SLIME_ALPHA;
  ctx.strokeStyle = SLIME;
  ctx.lineWidth = SLIME_WIDTH;
  for (let i = 0; i < SLIME_STREAKS; i++) {
    const from = lerp(SLIME_FROM, CLUB_NECK_AT, i / SLIME_STREAKS);
    const to = from + SLIME_RUN;
    const a = alongSpine(spine, from);
    const b = alongSpine(spine, to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - lerp(ROOT_HALF, NECK_HALF, from) * SLIME_LIFT);
    ctx.lineTo(b.x, b.y - lerp(ROOT_HALF, NECK_HALF, to) * SLIME_LIFT);
    ctx.stroke();
  }
  ctx.restore();

  // Venom flung off the head, trailing back along the throw. Heaviest in
  // flight and thinning out as the whip goes taut, because a droplet hanging in
  // the air on the frame the tongue is fully out has nothing to have been
  // flung by.
  {
    ctx.globalAlpha = hump(ext) * DROPLET_ALPHA;
    ctx.fillStyle = VENOM_MID;
    for (let i = 0; i < DROPLET_COUNT; i++) {
      const back = lerp(0.06, DROPLET_TRAIL, (i + 0.5) / DROPLET_COUNT);
      const at = alongSpine(spine, Math.max(0, 1 - back));
      const across = (hash1(DROPLET_SEED + i * 3.1) - 0.5) * 2 * DROPLET_SPREAD;
      const radius = DROPLET_MAX_R * (1 - back / DROPLET_TRAIL) * DROPLET_SHRINK;
      ctx.beginPath();
      ctx.arc(
        at.x + Math.cos(spine.tipAngle + Math.PI / 2) * across,
        at.y + Math.sin(spine.tipAngle + Math.PI / 2) * across,
        Math.max(0, radius),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/** Strokes the centre line offset sideways by `across`, for the ridge shading. */
function strokeSpine(ctx: Ctx, spine: Spine, across: number): void {
  ctx.beginPath();
  for (let i = 0; i < spine.points.length; i++) {
    const here = spine.points[i];
    const prev = spine.points[Math.max(0, i - 1)];
    const next = spine.points[Math.min(spine.points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x) - Math.PI / 2;
    const x = here.x + Math.cos(angle) * across;
    const y = here.y + Math.sin(angle) * across;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const OUTLINE_GROW = 0.011;
const GLOW_RADIUS = 2;
const VENOM_FADE_AT = 0.45;
/** One spine step, for reading the local tangent under a barb. */
const SPINE_SAMPLE = 1 / SPINE_STEPS;
/** Where along the whip the head's barbs sit. */
const CLUB_BARB_FROM = 0.84;
const CLUB_BARB_TO = 0.96;
/** How far up the whip's own half-width a barb's inner corner starts. */
const CLUB_BARB_MOUTH = 0.55;
const CLUB_BARB_BASE = 0.45;
const CLUB_CORE_AT = 0.94;
const CLUB_CORE_RX = 0.7;
const CLUB_CORE_RY = 0.5;
const VENOM_CORE_ALPHA = 0.7;
const CLUB_BARBS = 4;
/** Barb pairs less one, so the run of positions spans 0 to 1 exactly. */
const CLUB_BARB_ROWS = CLUB_BARBS / 2 - 1;
const CLUB_BARB_LENGTH = 0.045;
const SLIME_STREAKS = 4;
const SLIME_FROM = 0.12;
const SLIME_RUN = 0.16;
const SLIME_WIDTH = 0.013;
const SLIME_LIFT = 0.45;
const DROPLET_ALPHA = 0.75;
/** How much of its nominal size a droplet is drawn at, before the trail taper. */
const DROPLET_SHRINK = 0.9;
