/**
 * The Ball of Swine's anatomy and paint.
 *
 * The creature is a sphere of fused Tusklings, so the whole module is built on
 * one idea: a fixed table of *members* — faces, eyes, tusks, hooves, hands and
 * the shredded evening wear of whoever they ate — pinned to positions on a unit
 * sphere. Rolling advances a longitude, the sphere is projected orthographically,
 * and members stream across the visible face and vanish over the rim. That is
 * what makes it read as a rolling ball rather than a spinning decal.
 *
 * Coordinate contract: tile units, origin at the ball's centre, +Y down.
 *
 * The roll frames are painted **rotation-invariantly** — every tone here depends
 * on distance from the centre or on the surface normal, never on a screen
 * direction. The runtime rotates the sprite to the travel heading, so a baked
 * key light would carry its highlight around the ball with it. The directional
 * light lives in the separate `shade` overlay, which is drawn unrotated.
 *
 * The palette is copied from `scripts/tusklingArt.ts` rather than imported: that
 * module exports no colours and no primitives, and `scripts/tusklingGore.ts` set
 * the precedent of re-deriving its own tones.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { clamp01, easeInOut, lerp, mix, type Pt } from './carlArt.js';
import { hash1, rgba } from './ratArt.js';
import { BOS_BODY_RADIUS_TILES } from '../src/sprites/ballOfSwineSheet.js';

// ── Palette ──────────────────────────────────────────────────────────────────

interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

/** Dusty pig-pink, straight off the Tuskling so the ball reads as made of them. */
const HIDE: Ramp = { dark: '#4a2530', mid: '#ab5f69', light: '#dfa199' };
/** Thinner, paler hide — the stretched flesh between two fused bodies. */
const BELLY: Ramp = { dark: '#7a3f47', mid: '#cf948d', light: '#eec0b6' };
const OUTLINE = '#170a10';
const SNOUT: Ramp = { dark: '#7d3742', mid: '#b0616b', light: '#d18b8e' };
const NOSTRIL = '#33131c';
const MAW_INNER = '#4a121f';
const TOOTH = '#e7dcc4';
const TUSK: Ramp = { dark: '#9c8f6c', mid: '#e2d9bb', light: '#fbf6e4' };
const HOOF: Ramp = { dark: '#1e1820', mid: '#3a2f39', light: '#5d4d58' };
const EYE = '#0c0a10';
const EYE_SPARK = '#ffffff';
const EYE_WHITE = '#c9b6b0';
const BRISTLE = '#4d2a33';

/** The seam where two bodies fused: wet, dark, and never quite closed. */
const SEAM_DARK = '#2c1119';
const SEAM_WET = '#6d2530';

/** Black tie. The collar is the only pure white on the creature. */
const TUX_CLOTH: Ramp = { dark: '#080a10', mid: '#181c26', light: '#2c323e' };
const TUX_LINEN = '#e8e4dc';
/** Sequins: the one saturated note, and what makes the scraps read as a dress. */
const SEQUIN_CLOTH: Ramp = { dark: '#4a0713', mid: '#96101f', light: '#c8202f' };
const SEQUIN_SPARK = '#ff8f9a';

/** Sewage and rotten meat — the muck it drags around the arena. */
const MUCK: Ramp = { dark: '#241a10', mid: '#4a3a1e', light: '#6d5a2c' };
const BLOOD_DARK = '#2e0508';
const BLOOD = '#710d13';
const GUT: Ramp = { dark: '#5a1218', mid: '#9c2a2f', light: '#c05a52' };

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Ball radius in tiles, shared with the runtime.
 *
 * A tile carries about 6'4" of creature — the Tuskling is 4'6" at 0.71 of a tile —
 * so the source's "almost 15 feet" is a hair under 2.4 tiles across. Authored a
 * touch over that: at sprite scale the extra reads as mass, and it still leaves
 * the sheet smaller than the one it replaces.
 */
export const BALL_RADIUS = BOS_BODY_RADIUS_TILES;

/**
 * Widest anything may stray from the ball's centre, as a multiple of the radius —
 * the wallow's spread, the slam's bulge, the lobes, the spray and the burst debris.
 *
 * A contract with the bake gates, which crop their body measurements to it, and
 * the number the frame envelope is sized from. Kept tight on purpose: a cell has
 * to be square and wide enough to rotate the ball inside, so every extra tenth of
 * a radius spent on a handful of droplets is paid for by all forty cells, resident
 * for the whole session.
 */
export const BODY_REACH = BALL_RADIUS * 1.42;

/**
 * Furthest a thrown droplet or scrap of debris may be painted.
 *
 * Inside `BODY_REACH`, so debris never buys frame width of its own. Spray reads as
 * leaving the body because the body is *shrinking* under it — a slam compresses,
 * a burst collapses — not because it flies off the edge of the cell.
 */
const SPRAY_REACH = BALL_RADIUS * 1.34;

/** Samples around the silhouette. Enough that the lobes read as flesh, not as a polygon. */
const OUTLINE_SAMPLES = 128;
/**
 * How far a fused body may bulge the silhouette, as a fraction of the radius.
 *
 * Shallow on purpose. The thing has to read as a *ball* first and as lumpy
 * second: at three times this depth the outline stops being a circle with
 * ripples in it and becomes a crumpled paper bag, and the whole sense of a
 * rolling mass goes with it.
 */
const LOBE_DEPTH = 0.026;
/**
 * Lobe counts around the circumference — three overlapping bulge frequencies.
 *
 * High rather than low. Three lobes around a circle is a triangle; eleven is a
 * ripple, which is what the source describes.
 */
const LOBE_HARMONICS = [5, 8, 13] as const;

/**
 * Pixels the lobes may push the ink box off centre at bake scale.
 *
 * Derived from the declaration above rather than picked, so the concentricity
 * gate keeps measuring against the shape the art actually promises: the lobes
 * are a deliberate asymmetry, and a gate that forbade them would forbid the
 * ripple.
 */
export const LOBE_BOX_DRIFT = BALL_RADIUS * LOBE_DEPTH * LOBE_HARMONICS.length;

/** A member below this normal is edge-on; drawing it there smears it into a line. */
const MIN_FACE_NORMAL = 0.26;
/** Tusks and hooves survive closer to the rim, which is where they break the outline. */
const MIN_SPUR_NORMAL = 0.07;
/** Floor on the foreshortening scale, so the transform never collapses. */
const MIN_SQUASH = 0.12;

const TAU = Math.PI * 2;

// ── Small primitives ─────────────────────────────────────────────────────────

function traceEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  ctx.ellipse(cx, cy, Math.max(rx, 1e-4), Math.max(ry, 1e-4), rot, 0, TAU);
}

function fillEllipse(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  rot = 0,
): void {
  ctx.beginPath();
  traceEllipse(ctx, cx, cy, rx, ry, rot);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * A rounded quadrilateral through four points, used for cloth scraps and lapels.
 * Cloth wants a soft edge that is nonetheless not an ellipse, and a capsule is
 * the wrong shape for something torn.
 */
function tracePetal(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  const count = points.length;
  const first = points[0];
  const last = points[count - 1];
  ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
  for (let i = 0; i < count; i++) {
    const current = points[i];
    const next = points[(i + 1) % count];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

/** Alphas below this serialise as `5e-17` and node-canvas drops the whole colour. */
const MIN_ALPHA = 0.004;

function tinted(hex: string, alpha: number): string {
  return rgba(hex, Math.max(MIN_ALPHA, clamp01(alpha)));
}

// ── The member table ─────────────────────────────────────────────────────────

export type MemberKind = 'face' | 'eye' | 'snout' | 'hoof' | 'hand' | 'tuxedo' | 'sequin';

interface Member {
  readonly kind: MemberKind;
  /** Longitude in radians. The roll phase is added to this. */
  readonly longitude: number;
  /** Latitude as a signed fraction of the radius: −1 is the top of the ball. */
  readonly latitude: number;
  /** Scale multiplier on the member's own natural size. */
  readonly size: number;
  /** Roll about the member's own outward normal, in radians. */
  readonly spin: number;
  /** Per-member variation: which way a snout points, how many sequins, and so on. */
  readonly seed: number;
}

/**
 * How many of each kind ride the surface.
 *
 * Weighted so that a crawler looking at any one side of the ball sees at least
 * one face and one piece of clothing — roughly half the sphere is visible at a
 * time, so every count here is effectively halved on screen.
 */
const MEMBER_COUNTS: ReadonlyArray<readonly [MemberKind, number]> = [
  ['face', 5],
  ['eye', 4],
  ['snout', 5],
  ['hoof', 4],
  ['hand', 3],
  ['tuxedo', 2],
  ['sequin', 4],
];

/**
 * Members are laid out once, at module load.
 *
 * Not inside a paint closure: the bake paints every frame more than once — to
 * measure, then to render — and a table drawn from the RNG per call would give a
 * different creature each pass.
 */
function layOutMembers(): readonly Member[] {
  const members: Member[] = [];
  let index = 0;
  for (const [kind, count] of MEMBER_COUNTS) {
    for (let i = 0; i < count; i++) {
      const seed = index * 7.31 + 1.7;
      // A golden-angle spiral in longitude with jittered latitude: even coverage
      // without the visible banding a straight grid would give.
      const longitude = index * 2.399963 + hash1(seed) * 0.9;
      const latitude = (hash1(seed + 0.5) * 2 - 1) * 0.86;
      members.push({
        kind,
        longitude,
        latitude,
        size: 0.82 + hash1(seed + 1.5) * 0.44,
        spin: hash1(seed + 2.5) * TAU,
        seed,
      });
      index++;
    }
  }
  return members;
}

const MEMBERS = layOutMembers();

/** Where a member sits on screen this frame, and how face-on it is. */
interface Projected {
  readonly member: Member;
  readonly x: number;
  readonly y: number;
  /** Surface normal's component toward the camera: 1 dead centre, 0 at the rim. */
  readonly normal: number;
}

/**
 * Orthographic projection of the member sphere at a given roll phase.
 *
 * The ball rolls along +X, so the sphere turns about the screen-vertical axis and
 * the surface streams from the leading edge to the trailing one. For a unit
 * sphere the camera-facing normal is exactly `sqrt(1 − x² − y²)`, which is why
 * nothing here needs a depth buffer: the normal *is* the depth.
 */
function projectMembers(phase: number): Projected[] {
  const visible: Projected[] = [];
  for (const member of MEMBERS) {
    const ringRadius = Math.sqrt(Math.max(0, 1 - member.latitude * member.latitude));
    const longitude = member.longitude + phase;
    const towardCamera = ringRadius * Math.cos(longitude);
    if (towardCamera <= MIN_SPUR_NORMAL) continue;
    const across = ringRadius * Math.sin(longitude);
    visible.push({
      member,
      x: across * BALL_RADIUS,
      y: member.latitude * BALL_RADIUS,
      normal: towardCamera,
    });
  }
  // Painted rim-first so the members standing proudest of the surface finish on
  // top, which is the only ordering that reads as depth on a smooth silhouette.
  visible.sort((a, b) => a.normal - b.normal);
  return visible;
}

// ── Silhouette ───────────────────────────────────────────────────────────────

/**
 * Radius of the flesh at a given angle.
 *
 * `wobble` slides the lobes around the circumference so the mass ripples as it
 * rolls, and `bulge` lets the wallow and slam rows squash the whole body without
 * losing the lumps.
 */
function silhouetteRadius(angle: number, wobble: number, depth: number): number {
  let radius = 1;
  LOBE_HARMONICS.forEach((harmonic, index) => {
    // A whole number of turns per roll cycle, so the ripple closes across the loop
    // seam. At a fractional rate the silhouette arrives back at the first frame a
    // different shape from the one it left, and the ball visibly hitches once per
    // revolution — which is exactly what the loop-closure gate caught.
    const phase = wobble * (index + 1) + index * 2.1;
    radius += Math.cos(angle * harmonic + phase) * depth * (1 - index * 0.22);
  });
  return radius;
}

export interface BodyShape {
  /** Uniform scale on the whole body. */
  readonly scale: number;
  /** Horizontal stretch — above 1 for the wallowing spread, below for a slam. */
  readonly stretchX: number;
  readonly stretchY: number;
  /** Slides the silhouette lobes around the rim. */
  readonly wobble: number;
  /** Lobe depth as a fraction of the radius. */
  readonly lobeDepth: number;
  /** Centre offset, for a body sagging or shoved off its own axis. */
  readonly offset: Pt;
}

export function roundBody(wobble: number): BodyShape {
  return {
    scale: 1,
    stretchX: 1,
    stretchY: 1,
    wobble,
    lobeDepth: LOBE_DEPTH,
    offset: { x: 0, y: 0 },
  };
}

function traceBody(ctx: Ctx, shape: BodyShape, grow: number): void {
  ctx.beginPath();
  for (let i = 0; i <= OUTLINE_SAMPLES; i++) {
    const angle = (i / OUTLINE_SAMPLES) * TAU;
    const radius = (silhouetteRadius(angle, shape.wobble, shape.lobeDepth) + grow) * BALL_RADIUS;
    const x = shape.offset.x + Math.cos(angle) * radius * shape.stretchX * shape.scale;
    const y = shape.offset.y + Math.sin(angle) * radius * shape.stretchY * shape.scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ── Flesh ────────────────────────────────────────────────────────────────────

/**
 * Where the flesh stops holding its mid tone and starts turning into the rim.
 *
 * Late, so that most of the visible ball is *pink*. The description leads with
 * "rippling pink flesh", and a ball that spends two thirds of its area falling
 * off toward the outline is a maroon ball with a pink dot in the middle.
 */
const RIM_FALLOFF_START = 0.74;
/**
 * Bands of ambient tone from the centre outward.
 *
 * High enough that the band edges are invisible. At a seventh of this the steps
 * read as contour lines on a map, which is a very specific and very wrong look.
 */
const FLESH_BANDS = 40;

/**
 * Ambient flesh: concentric bands from a pale centre to a dark rim.
 *
 * Bands rather than `createRadialGradient` because the gradient version has to
 * be rebuilt per frame in tile-unit space, where its radii are fractions and a
 * squashed body needs it distorted anyway; forty overlapping ellipse fills cost
 * nothing offline and take the body's own stretch for free.
 *
 * Every tone is a function of radius alone, so the whole fill survives being
 * rotated to a travel heading — which is the constraint the entire module is
 * built around.
 */
function paintFlesh(ctx: Ctx, shape: BodyShape): void {
  ctx.save();
  traceBody(ctx, shape, 0);
  ctx.clip();

  const outer = BALL_RADIUS * shape.scale * Math.max(shape.stretchX, shape.stretchY) * 1.4;
  ctx.beginPath();
  ctx.rect(-outer, -outer, outer * 2, outer * 2);
  ctx.fillStyle = HIDE.dark;
  ctx.fill();

  for (let band = FLESH_BANDS; band >= 1; band--) {
    const t = band / FLESH_BANDS;
    const toward = clamp01((t - RIM_FALLOFF_START) / (1 - RIM_FALLOFF_START));
    const lit = mix(BELLY.light, HIDE.mid, easeInOut(t * 0.9));
    const tone = mix(lit, HIDE.dark, easeInOut(toward) * 0.95);
    ctx.beginPath();
    traceEllipse(
      ctx,
      shape.offset.x,
      shape.offset.y,
      BALL_RADIUS * shape.scale * shape.stretchX * t,
      BALL_RADIUS * shape.scale * shape.stretchY * t,
    );
    ctx.fillStyle = tone;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Slick highlights over the flesh.
 *
 * Pinned to the sphere like the members are, so the sheen streams with the surface
 * as it rolls. Sized and faded by the surface normal alone — never by a screen
 * direction — so it says "wet" without implying a light the rotated sprite would
 * then drag around the arena.
 */
function paintWetness(ctx: Ctx, shape: BodyShape, phase: number): void {
  const COUNT = 22;
  ctx.save();
  traceBody(ctx, shape, -0.02);
  ctx.clip();
  for (let i = 0; i < COUNT; i++) {
    const latitude = (hash1(i * 5.3 + 0.2) * 2 - 1) * 0.9;
    const ring = Math.sqrt(Math.max(0, 1 - latitude * latitude));
    const longitude = hash1(i * 5.3 + 1.4) * TAU + phase;
    const normal = ring * Math.cos(longitude);
    if (normal <= 0.14) continue;
    const across = ring * Math.sin(longitude);
    const r = BALL_RADIUS * (0.02 + hash1(i * 5.3 + 2.6) * 0.036) * normal;
    fillEllipse(
      ctx,
      shape.offset.x + across * BALL_RADIUS * shape.scale * shape.stretchX,
      shape.offset.y + latitude * BALL_RADIUS * shape.scale * shape.stretchY,
      r,
      r * 0.7,
      tinted(BELLY.light, 0.1 + normal * 0.16),
    );
  }
  ctx.restore();
}

/** Fused-body seams: wet crevices that follow the sphere's own longitude lines. */
function paintSeams(ctx: Ctx, shape: BodyShape, phase: number): void {
  const SEAM_COUNT = 5;
  ctx.save();
  traceBody(ctx, shape, -0.01);
  ctx.clip();
  ctx.lineCap = 'round';

  for (let seam = 0; seam < SEAM_COUNT; seam++) {
    const longitude = (seam / SEAM_COUNT) * TAU + phase;
    const towardCamera = Math.cos(longitude);
    if (towardCamera <= 0.02) continue;
    const across = Math.sin(longitude);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const latitude = -0.94 + (i / 24) * 1.88;
      const ring = Math.sqrt(Math.max(0, 1 - latitude * latitude));
      const x = across * ring * BALL_RADIUS * shape.scale * shape.stretchX;
      const y = latitude * BALL_RADIUS * shape.scale * shape.stretchY;
      if (i === 0) ctx.moveTo(shape.offset.x + x, shape.offset.y + y);
      else ctx.lineTo(shape.offset.x + x, shape.offset.y + y);
    }
    ctx.strokeStyle = tinted(SEAM_DARK, 0.72 * towardCamera + 0.18);
    ctx.lineWidth = BALL_RADIUS * 0.07 * towardCamera;
    ctx.stroke();
    ctx.strokeStyle = tinted(SEAM_WET, 0.42 * towardCamera);
    ctx.lineWidth = BALL_RADIUS * 0.026 * towardCamera;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Bristles: sparse black hairs along the seams. Cheap, and the one thing that
 * stops the flesh reading as a rubber ball at in-game size.
 */
function paintBristles(ctx: Ctx, shape: BodyShape, phase: number): void {
  const COUNT = 42;
  ctx.save();
  traceBody(ctx, shape, -0.02);
  ctx.clip();
  ctx.strokeStyle = tinted(BRISTLE, 0.6);
  ctx.lineWidth = BALL_RADIUS * 0.012;
  ctx.lineCap = 'round';
  for (let i = 0; i < COUNT; i++) {
    const latitude = (hash1(i * 3.1 + 0.4) * 2 - 1) * 0.92;
    const longitude = hash1(i * 3.1 + 1.9) * TAU + phase;
    const towardCamera = Math.sqrt(Math.max(0, 1 - latitude * latitude)) * Math.cos(longitude);
    if (towardCamera <= 0.12) continue;
    const across = Math.sqrt(Math.max(0, 1 - latitude * latitude)) * Math.sin(longitude);
    const x = shape.offset.x + across * BALL_RADIUS * shape.scale * shape.stretchX;
    const y = shape.offset.y + latitude * BALL_RADIUS * shape.scale * shape.stretchY;
    const length = BALL_RADIUS * 0.1 * towardCamera * (0.6 + hash1(i * 3.1 + 2.6));
    const lean = hash1(i * 3.1 + 3.3) * TAU;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(lean) * length, y + Math.sin(lean) * length);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The rim: an occlusion band inside the silhouette plus the ink line.
 *
 * Painted after the members so the flesh closes over anything sunk into it, and
 * clipped to the body so the tusks and hooves that break the outline stay clean.
 */
function paintRim(ctx: Ctx, shape: BodyShape): void {
  ctx.save();
  traceBody(ctx, shape, 0);
  ctx.clip();
  ctx.beginPath();
  traceBody(ctx, shape, 0);
  ctx.strokeStyle = tinted(HIDE.dark, 0.55);
  ctx.lineWidth = BALL_RADIUS * 0.1;
  ctx.stroke();
  ctx.strokeStyle = tinted(OUTLINE, 0.5);
  ctx.lineWidth = BALL_RADIUS * 0.04;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  traceBody(ctx, shape, 0);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = BALL_RADIUS * 0.026;
  ctx.stroke();
}

// ── Members ──────────────────────────────────────────────────────────────────

/**
 * How wide a member is drawn, before its own size multiplier, in tile units.
 *
 * Sized so that a face is about a third of the ball across. Smaller and the
 * members become a rash of dots at in-game size, which is the difference between
 * "a ball of pigs" and "a diseased ball".
 */
const MEMBER_UNIT = BALL_RADIUS * 0.52;

/** Everything a member's painter needs to know about the frame it is in. */
export interface MemberMood {
  /** 0 shut, 1 gaping. Raised for the wallow and the burst. */
  readonly maw: number;
  /** 0 relaxed, 1 bulging. */
  readonly glare: number;
  /** Blink phase in turns; each member offsets from it so they do not blink together. */
  readonly blinkPhase: number;
  /** 0 healthy, 1 split and leaking — the burst row. */
  readonly ruin: number;
}

export function calmMood(blinkPhase: number): MemberMood {
  return { maw: 0.12, glare: 0.1, blinkPhase, ruin: 0 };
}

/**
 * A pair of tusks springing from a jaw at the origin, pointing along +X.
 *
 * Drawn as a *spike*: wide at the gum, tapering to a point, with only a slight
 * hook. A tusk given an even width and a deep curl reads as a banana, and eight
 * bananas scattered over pink flesh read as maggots — which is a completely
 * different creature from the one being drawn.
 */
function drawTuskPair(ctx: Ctx, unit: number, spread: number, seed: number): void {
  for (const side of [-1, 1] as const) {
    const length = unit * (0.66 + hash1(seed + side + 4) * 0.3);
    const rootHalf = unit * 0.1;
    const hook = -unit * (0.12 + hash1(seed + side + 5) * 0.1);
    const rootY = side * spread;
    const tipY = rootY + side * hook;

    ctx.beginPath();
    ctx.moveTo(0, rootY - rootHalf);
    ctx.quadraticCurveTo(length * 0.62, tipY - rootHalf * 0.35, length, tipY);
    ctx.quadraticCurveTo(length * 0.58, tipY + rootHalf * 0.5, 0, rootY + rootHalf);
    ctx.closePath();
    // Root shaded toward the gum so the tusk emerges rather than lying on top.
    ctx.fillStyle = mix(TUSK.mid, TUSK.dark, 0.35);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = unit * 0.04;
    ctx.stroke();

    // The lit ridge along the outer edge, and a hard point at the tip.
    ctx.beginPath();
    ctx.moveTo(length * 0.1, rootY - rootHalf * 0.5);
    ctx.quadraticCurveTo(length * 0.66, tipY - rootHalf * 0.25, length * 0.96, tipY);
    ctx.strokeStyle = TUSK.light;
    ctx.lineWidth = unit * 0.045;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawPigEye(ctx: Ctx, unit: number, mood: MemberMood, seed: number): void {
  const lidPhase = (mood.blinkPhase + hash1(seed + 6)) % 1;
  // A blink is a brief event in a long cycle, so the window is narrow and the
  // easing runs shut-then-open inside it rather than across the whole turn.
  const blink = lidPhase < 0.09 ? Math.sin((lidPhase / 0.09) * Math.PI) : 0;
  const open = clamp01(1 - blink) * (0.7 + mood.glare * 0.5);
  const rx = unit * 0.26;
  const ry = unit * 0.26 * open;

  // A ring of swollen hide around the socket, so the eye is set *into* the flesh.
  // Without it a black eye on pink flesh is a hole in the ball — which is exactly
  // what the art this replaces looked like. Painted in the hide's own mid tone
  // rather than a pale one: a bright ring turns a pig's eye into a cartoon's.
  fillEllipse(ctx, 0, 0, rx * 1.42, Math.max(ry * 1.5, unit * 0.07), HIDE.mid);
  fillEllipse(ctx, 0, 0, rx * 1.2, Math.max(ry * 1.26, unit * 0.055), HIDE.dark);
  if (ry <= unit * 0.03) return;
  // Mostly pupil. A pig's eye is a wet black bead with a sliver of sclera at the
  // corners, and a large white sclera is the single strongest cartoon cue there is.
  fillEllipse(ctx, 0, 0, rx, ry, EYE_WHITE);
  fillEllipse(ctx, 0, 0, rx * 0.86, ry * 0.9, EYE);
  fillEllipse(ctx, -rx * 0.3, -ry * 0.32, rx * 0.17, Math.max(ry * 0.18, unit * 0.018), EYE_SPARK);
  // The upper lid, cutting the top off the bead the way a heavy brow does.
  fillEllipse(ctx, 0, -ry * 1.12, rx * 1.15, ry * 0.6, HIDE.mid);
  ctx.beginPath();
  traceEllipse(ctx, 0, 0, rx, ry);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.035;
  ctx.stroke();
}

/**
 * A snout and its tusks, with no eyes — a jaw fused into the mass face-down.
 *
 * Its own member kind because bare tusks were one: a tusk pair with nothing
 * behind it floats, and the cheapest thing that anchors it is the mouth it grew
 * out of.
 */
function drawSnout(ctx: Ctx, unit: number, mood: MemberMood, seed: number): void {
  const gape = clamp01(mood.maw + hash1(seed + 9) * 0.3);

  fillEllipse(ctx, -unit * 0.02, 0, unit * 0.44, unit * 0.4, HIDE.mid);
  ctx.save();
  ctx.translate(unit * 0.14, 0);
  drawTuskPair(ctx, unit, unit * 0.24, seed);
  ctx.restore();

  fillEllipse(ctx, unit * 0.24, 0, unit * 0.27, unit * 0.3, SNOUT.mid);
  fillEllipse(ctx, unit * 0.3, 0, unit * 0.18, unit * 0.22, SNOUT.light);
  for (const side of [-1, 1] as const) {
    fillEllipse(ctx, unit * 0.32, side * unit * 0.1, unit * 0.045, unit * 0.07, NOSTRIL);
  }
  ctx.beginPath();
  traceEllipse(ctx, unit * 0.24, 0, unit * 0.27, unit * 0.3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.045;
  ctx.stroke();

  if (gape > 0.2) {
    const mawR = unit * 0.22 * gape;
    fillEllipse(ctx, unit * 0.04, unit * 0.22, unit * 0.17, mawR, MAW_INNER, 0.35);
    fillEllipse(ctx, unit * 0.04, unit * 0.22 - mawR * 0.5, unit * 0.025, mawR * 0.4, TOOTH);
  }
}

/**
 * A whole fused head: snout disc, nostrils, maw, two eyes and a tusk pair.
 *
 * Drawn with the snout at +X — the member transform has already turned +X to
 * point out of the ball — because a face on a sphere looks away from its centre.
 */
function drawFace(ctx: Ctx, unit: number, mood: MemberMood, seed: number): void {
  const gape = clamp01(mood.maw + hash1(seed + 8) * 0.25);

  // Skull mass first, so the snout sits on something.
  fillEllipse(ctx, -unit * 0.1, 0, unit * 0.62, unit * 0.5, HIDE.mid);
  ctx.beginPath();
  traceEllipse(ctx, -unit * 0.1, 0, unit * 0.62, unit * 0.5);
  ctx.strokeStyle = tinted(OUTLINE, 0.55);
  ctx.lineWidth = unit * 0.045;
  ctx.stroke();

  ctx.save();
  ctx.translate(unit * 0.18, 0);
  drawTuskPair(ctx, unit, unit * 0.28, seed);
  ctx.restore();

  // Snout: a short disc. Anything longer reads as a beak at this size.
  const snoutX = unit * 0.42;
  fillEllipse(ctx, snoutX, 0, unit * 0.3, unit * 0.34, SNOUT.mid);
  fillEllipse(ctx, snoutX + unit * 0.06, 0, unit * 0.2, unit * 0.26, SNOUT.light);
  for (const side of [-1, 1] as const) {
    fillEllipse(ctx, snoutX + unit * 0.1, side * unit * 0.11, unit * 0.05, unit * 0.075, NOSTRIL);
  }
  ctx.beginPath();
  traceEllipse(ctx, snoutX, 0, unit * 0.3, unit * 0.34);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.045;
  ctx.stroke();

  if (gape > 0.16) {
    const mawR = unit * 0.26 * gape;
    fillEllipse(ctx, snoutX - unit * 0.16, unit * 0.24, unit * 0.2, mawR, MAW_INNER, 0.3);
    for (const tooth of [-1, 0, 1] as const) {
      fillEllipse(
        ctx,
        snoutX - unit * 0.16 + tooth * unit * 0.1,
        unit * 0.24 - mawR * 0.5,
        unit * 0.028,
        mawR * 0.42,
        TOOTH,
      );
    }
  }

  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(-unit * 0.14, side * unit * 0.27);
    drawPigEye(ctx, unit * 0.72, mood, seed + side);
    ctx.restore();
  }
}

/** A stubby leg ending in a cloven hoof, jutting out of the mass. */
function drawHoof(ctx: Ctx, unit: number, seed: number): void {
  const length = unit * (0.9 + hash1(seed + 11) * 0.5);
  const bend = (hash1(seed + 12) - 0.5) * unit * 0.5;
  ctx.beginPath();
  ctx.moveTo(-unit * 0.1, -unit * 0.19);
  ctx.quadraticCurveTo(length * 0.6, bend - unit * 0.14, length, bend);
  ctx.quadraticCurveTo(length * 0.6, bend + unit * 0.14, -unit * 0.1, unit * 0.19);
  ctx.closePath();
  ctx.fillStyle = HIDE.mid;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.05;
  ctx.stroke();

  fillEllipse(ctx, length * 0.98, bend, unit * 0.19, unit * 0.16, HOOF.mid);
  fillEllipse(ctx, length * 1.02, bend, unit * 0.12, unit * 0.13, HOOF.dark);
  ctx.beginPath();
  ctx.moveTo(length * 0.96, bend - unit * 0.14);
  ctx.lineTo(length * 1.1, bend);
  ctx.lineTo(length * 0.96, bend + unit * 0.14);
  ctx.strokeStyle = HOOF.light;
  ctx.lineWidth = unit * 0.032;
  ctx.stroke();
}

/** A splayed pig hand — three fat fingers, grabbing at nothing. */
function drawHand(ctx: Ctx, unit: number, seed: number): void {
  const reach = unit * (0.62 + hash1(seed + 14) * 0.3);
  ctx.beginPath();
  ctx.moveTo(-unit * 0.08, -unit * 0.16);
  ctx.quadraticCurveTo(reach * 0.7, -unit * 0.2, reach, -unit * 0.05);
  ctx.quadraticCurveTo(reach * 0.7, unit * 0.2, -unit * 0.08, unit * 0.16);
  ctx.closePath();
  ctx.fillStyle = BELLY.mid;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.045;
  ctx.stroke();
  for (const finger of [-1, 0, 1] as const) {
    const angle = finger * 0.5 + (hash1(seed + 15 + finger) - 0.5) * 0.3;
    const length = unit * (0.28 + hash1(seed + 16 + finger) * 0.16);
    ctx.beginPath();
    ctx.moveTo(reach * 0.9, finger * unit * 0.09);
    ctx.lineTo(
      reach * 0.9 + Math.cos(angle) * length,
      finger * unit * 0.09 + Math.sin(angle) * length,
    );
    ctx.strokeStyle = BELLY.mid;
    ctx.lineWidth = unit * 0.11;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = tinted(OUTLINE, 0.5);
    ctx.lineWidth = unit * 0.03;
    ctx.stroke();
  }
}

/**
 * A torn scrap of dinner jacket: black cloth, a white shirt front, a bow tie.
 *
 * Small, and the linen and the lit lapel edge are not optional. Black cloth on
 * dark flesh with nothing bright in it does not read as a jacket — it reads as a
 * hole in the ball, and a hole is the one thing this creature must not appear to
 * have.
 */
function drawTuxedoScrap(ctx: Ctx, unit: number, seed: number): void {
  const w = unit * (0.42 + hash1(seed + 18) * 0.16);
  const h = unit * (0.34 + hash1(seed + 19) * 0.16);
  const corners: readonly Pt[] = [
    { x: -w, y: -h * 0.8 },
    { x: w * 0.5, y: -h },
    { x: w, y: h * 0.4 },
    { x: -w * 0.6, y: h },
  ];
  tracePetal(ctx, corners);
  ctx.fillStyle = TUX_CLOTH.mid;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.035;
  ctx.stroke();

  // The shirt front, always: it is the only value contrast the scrap has.
  tracePetal(ctx, [
    { x: -w * 0.05, y: -h * 0.62 },
    { x: w * 0.55, y: -h * 0.5 },
    { x: w * 0.62, y: h * 0.2 },
    { x: w * 0.05, y: h * 0.4 },
  ]);
  ctx.fillStyle = TUX_LINEN;
  ctx.fill();
  ctx.strokeStyle = tinted(OUTLINE, 0.6);
  ctx.lineWidth = unit * 0.028;
  ctx.stroke();

  // The lapel folds back over the shirt — a jacket without one is a bib.
  ctx.beginPath();
  ctx.moveTo(-w * 0.75, -h * 0.7);
  ctx.quadraticCurveTo(w * 0.05, -h * 0.1, -w * 0.35, h * 0.7);
  ctx.lineTo(-w, h * 0.55);
  ctx.closePath();
  ctx.fillStyle = TUX_CLOTH.light;
  ctx.fill();
  ctx.strokeStyle = tinted(OUTLINE, 0.5);
  ctx.lineWidth = unit * 0.025;
  ctx.stroke();

  // Bow tie: two wings and a knot, at the collar end of the shirt front.
  const knotX = w * 0.28;
  const knotY = -h * 0.34;
  for (const wing of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(knotX, knotY);
    ctx.lineTo(knotX + wing * w * 0.3, knotY - h * 0.22);
    ctx.lineTo(knotX + wing * w * 0.3, knotY + h * 0.22);
    ctx.closePath();
    ctx.fillStyle = TUX_CLOTH.dark;
    ctx.fill();
  }
  fillEllipse(ctx, knotX, knotY, w * 0.07, h * 0.1, TUX_CLOTH.mid);
}

/** A torn scrap of red sequin dress. The specular dots are the whole point. */
function drawSequinScrap(ctx: Ctx, unit: number, seed: number): void {
  // Long and narrow, not round: a scrap torn off a dress hangs in a strip, and a
  // circular crimson patch dotted with white reads as a strawberry.
  const w = unit * (0.62 + hash1(seed + 23) * 0.26);
  const h = unit * (0.24 + hash1(seed + 24) * 0.12);
  const corners: readonly Pt[] = [
    { x: -w, y: -h * 0.5 },
    { x: w * 0.35, y: -h },
    { x: w, y: h * 0.35 },
    { x: -w * 0.55, y: h },
  ];
  tracePetal(ctx, corners);
  ctx.fillStyle = SEQUIN_CLOTH.mid;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = unit * 0.04;
  ctx.stroke();

  ctx.save();
  tracePetal(ctx, corners);
  ctx.clip();
  // Few and large. Sequins drawn at their true relative size blur into a flat
  // patch at 32px, and a flat crimson patch on pink flesh is a wound, not a dress.
  const rows = 2;
  const columns = 5;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const jitter = hash1(seed + row * 5.7 + column * 1.3);
      if (jitter < 0.18) continue;
      const x = lerp(-w * 0.8, w * 0.8, (column + (row % 2) * 0.5) / (columns - 1));
      const y = lerp(-h * 0.45, h * 0.45, row / (rows - 1));
      const r = unit * 0.075;
      fillEllipse(ctx, x, y, r, r * 0.88, jitter > 0.55 ? SEQUIN_SPARK : SEQUIN_CLOTH.light);
      fillEllipse(ctx, x - r * 0.32, y - r * 0.34, r * 0.36, r * 0.3, EYE_SPARK);
    }
  }
  ctx.restore();
  ctx.strokeStyle = tinted(SEQUIN_CLOTH.dark, 0.7);
  ctx.lineWidth = unit * 0.03;
  ctx.stroke();
}

function paintMember(ctx: Ctx, projected: Projected, mood: MemberMood): void {
  const { member, normal } = projected;
  const isSpur = member.kind === 'snout' || member.kind === 'hoof' || member.kind === 'hand';
  if (!isSpur && normal < MIN_FACE_NORMAL) return;

  const unit = MEMBER_UNIT * member.size * (0.52 + normal * 0.48);
  const radial = Math.atan2(projected.y, projected.x);

  ctx.save();
  ctx.translate(projected.x, projected.y);
  ctx.rotate(radial);
  ctx.scale(Math.max(MIN_SQUASH, normal), 1);
  ctx.rotate(member.spin);

  switch (member.kind) {
    case 'face':
      drawFace(ctx, unit, mood, member.seed);
      break;
    case 'eye':
      // A lone eye is a smaller feature than the pair set into a whole head:
      // scaled to the same unit it swallows a fifth of the ball.
      drawPigEye(ctx, unit * 0.62, mood, member.seed);
      break;
    case 'snout':
      drawSnout(ctx, unit * 0.86, mood, member.seed);
      break;
    case 'hoof':
      drawHoof(ctx, unit, member.seed);
      break;
    case 'hand':
      drawHand(ctx, unit, member.seed);
      break;
    case 'tuxedo':
      drawTuxedoScrap(ctx, unit, member.seed);
      break;
    case 'sequin':
      drawSequinScrap(ctx, unit, member.seed);
      break;
  }
  ctx.restore();

  // Members are half sunk into the flesh, so the mass closes over the joint. A
  // scrap of cloth without this floats like a sticker.
  ctx.save();
  ctx.translate(projected.x, projected.y);
  ctx.rotate(radial);
  ctx.beginPath();
  traceEllipse(ctx, -unit * 0.34, 0, unit * 0.42, unit * 0.62);
  ctx.fillStyle = tinted(HIDE.dark, 0.16 * normal);
  ctx.fill();
  ctx.restore();
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * One rolling frame.
 *
 * `phase` is the roll longitude in radians and drives everything that moves:
 * the members, the seams, the bristles and the silhouette's ripple.
 */
export function drawBallRoll(ctx: Ctx, phase: number): void {
  const shape = roundBody(phase);
  const mood = calmMood(phase / TAU);
  paintFlesh(ctx, shape);
  paintSeams(ctx, shape, phase);
  paintBristles(ctx, shape, phase);
  paintWetness(ctx, shape, phase);
  for (const projected of projectMembers(phase)) paintMember(ctx, projected, mood);
  paintRim(ctx, shape);
}

/**
 * The fixed key light, drawn unrotated over a rolling frame.
 *
 * Split out of the roll frames so the highlight stays put while the surface
 * turns underneath it — a lit ball rotated to its heading carries its own sun
 * around the arena.
 */
export function drawBallShade(ctx: Ctx): void {
  const shape = roundBody(0);
  ctx.save();
  traceBody(ctx, shape, -0.005);
  ctx.clip();

  // Occlusion first: down and away from the light, and heavier than the lift.
  ctx.beginPath();
  traceEllipse(ctx, BALL_RADIUS * 0.4, BALL_RADIUS * 0.44, BALL_RADIUS * 1.05, BALL_RADIUS * 1.0);
  ctx.fillStyle = tinted(OUTLINE, 0.16);
  ctx.fill();
  ctx.beginPath();
  traceEllipse(ctx, BALL_RADIUS * 0.62, BALL_RADIUS * 0.66, BALL_RADIUS * 0.92, BALL_RADIUS * 0.86);
  ctx.fillStyle = tinted(OUTLINE, 0.2);
  ctx.fill();

  // The lift, up and to the left.
  ctx.beginPath();
  traceEllipse(
    ctx,
    -BALL_RADIUS * 0.42,
    -BALL_RADIUS * 0.46,
    BALL_RADIUS * 0.72,
    BALL_RADIUS * 0.66,
  );
  ctx.fillStyle = tinted(BELLY.light, 0.13);
  ctx.fill();

  // Wet specular. Small and hard — it is what says the thing is slick.
  fillEllipse(
    ctx,
    -BALL_RADIUS * 0.44,
    -BALL_RADIUS * 0.52,
    BALL_RADIUS * 0.19,
    BALL_RADIUS * 0.12,
    tinted('#ffe9e0', 0.3),
    -0.5,
  );
  fillEllipse(
    ctx,
    -BALL_RADIUS * 0.47,
    -BALL_RADIUS * 0.55,
    BALL_RADIUS * 0.08,
    BALL_RADIUS * 0.05,
    tinted('#fffaf6', 0.42),
    -0.5,
  );
  ctx.restore();
}

/** The ground shadow, drawn unrotated *under* the ball. */
export function drawBallShadow(ctx: Ctx): void {
  fillEllipse(
    ctx,
    0,
    BALL_RADIUS * 0.86,
    BALL_RADIUS * 0.92,
    BALL_RADIUS * 0.3,
    tinted(OUTLINE, 0.42),
  );
  fillEllipse(
    ctx,
    0,
    BALL_RADIUS * 0.9,
    BALL_RADIUS * 0.62,
    BALL_RADIUS * 0.19,
    tinted(OUTLINE, 0.3),
  );
}

/**
 * Wallowing: momentum spent, the mass collapsed onto the floor and heaving.
 *
 * Deliberately not a roll frame with a squash — the members stop streaming and
 * the whole silhouette spreads sideways, so the vulnerable state is legible from
 * across the arena without reading the health bar.
 */
export function drawBallWallow(ctx: Ctx, cyclePhase: number): void {
  const heave = Math.sin(cyclePhase * TAU);
  const shape: BodyShape = {
    scale: 1,
    stretchX: 1.22 + heave * 0.05,
    stretchY: 0.76 - heave * 0.04,
    // Frozen longitude: a wallowing ball is not rolling, so its lumps hold still
    // and only the heave moves them.
    wobble: 1.7 + heave * 0.5,
    lobeDepth: LOBE_DEPTH * 1.7,
    offset: { x: 0, y: BALL_RADIUS * (0.24 - heave * 0.03) },
  };
  const mood: MemberMood = {
    maw: 0.72 + heave * 0.24,
    glare: 0.85,
    blinkPhase: cyclePhase * 0.5,
    ruin: 0,
  };

  paintFlesh(ctx, shape);
  paintSeams(ctx, shape, 1.7);
  paintBristles(ctx, shape, 1.7);
  paintWetness(ctx, shape, 1.7);
  const members = projectMembers(1.7);
  for (const projected of members) {
    // Squashed body, squashed member field: without this the faces float clear
    // of the flesh they are set into.
    paintMember(
      ctx,
      {
        member: projected.member,
        x: shape.offset.x + projected.x * shape.stretchX,
        y: shape.offset.y + projected.y * shape.stretchY,
        normal: projected.normal,
      },
      mood,
    );
  }
  paintRim(ctx, shape);
  paintMuckSpray(ctx, shape, cyclePhase, 0.5);
}

/** Spin-up: gathering itself off the floor, tusks clawing for purchase. */
export function drawBallSpinup(ctx: Ctx, progress: number): void {
  const rise = easeInOut(clamp01(progress));
  const shape: BodyShape = {
    scale: 1,
    stretchX: lerp(1.22, 1, rise),
    stretchY: lerp(0.76, 1, rise),
    wobble: lerp(1.7, 1.7 + TAU * 0.4, rise),
    lobeDepth: lerp(LOBE_DEPTH * 1.7, LOBE_DEPTH, rise),
    offset: { x: 0, y: BALL_RADIUS * lerp(0.24, 0, rise) },
  };
  const mood: MemberMood = {
    maw: lerp(0.72, 0.3, rise),
    glare: lerp(0.85, 0.5, rise),
    blinkPhase: progress * 0.3,
    ruin: 0,
  };
  const phase = shape.wobble;

  paintFlesh(ctx, shape);
  paintSeams(ctx, shape, phase);
  paintBristles(ctx, shape, phase);
  paintWetness(ctx, shape, phase);
  for (const projected of projectMembers(phase)) {
    paintMember(
      ctx,
      {
        member: projected.member,
        x: shape.offset.x + projected.x * shape.stretchX,
        y: shape.offset.y + projected.y * shape.stretchY,
        normal: projected.normal,
      },
      mood,
    );
  }
  paintRim(ctx, shape);
  paintMuckSpray(ctx, shape, progress, 1 - rise * 0.5);
}

/**
 * Slam: the mass compressed against a wall lying to +X.
 *
 * The runtime rotates this to the wall normal, so the flattened side is always
 * the side that hit.
 */
export function drawBallSlam(ctx: Ctx, progress: number): void {
  // Compression peaks in the middle of the row and is most of the way out by the
  // end, so the frame that reads hardest is the one the impact lands on.
  const crush = Math.sin(clamp01(progress) * Math.PI) ** 0.7;
  const shape: BodyShape = {
    scale: 1,
    stretchX: 1 - crush * 0.3,
    stretchY: 1 + crush * 0.28,
    wobble: 0.6,
    lobeDepth: LOBE_DEPTH * (1 + crush),
    // Centred, not shoved back off the wall. The runtime rotates this state about
    // the manifest anchor, so an offset body would make the ball jump sideways the
    // frame it stopped rolling and started slamming.
    offset: { x: 0, y: 0 },
  };
  const mood: MemberMood = { maw: 0.5 + crush * 0.45, glare: 1, blinkPhase: 0.5, ruin: 0 };

  paintFlesh(ctx, shape);
  paintSeams(ctx, shape, 0.6);
  paintBristles(ctx, shape, 0.6);
  paintWetness(ctx, shape, 0.6);
  for (const projected of projectMembers(0.6)) {
    paintMember(
      ctx,
      {
        member: projected.member,
        x: shape.offset.x + projected.x * shape.stretchX,
        y: shape.offset.y + projected.y * shape.stretchY,
        normal: projected.normal,
      },
      mood,
    );
  }
  paintRim(ctx, shape);

  // Spray thrown forward off the impact face.
  const SPRAY = 20;
  for (let i = 0; i < SPRAY; i++) {
    const spread = (hash1(i * 2.3 + 0.7) * 2 - 1) * 0.9;
    const distance = lerp(BALL_RADIUS * 0.95, SPRAY_REACH, crush * hash1(i * 2.3 + 1.1));
    const r = BALL_RADIUS * (0.02 + hash1(i * 2.3 + 1.9) * 0.035);
    fillEllipse(
      ctx,
      Math.cos(spread) * distance,
      Math.sin(spread) * distance * 0.9,
      r,
      r * 0.8,
      tinted(i % 3 === 0 ? BLOOD : MUCK.mid, 0.55 + crush * 0.35),
    );
  }
}

/**
 * Muck and sewage flung off the body. Shared by the wallow and the spin-up,
 * which are the two rows where the ball is grinding against the floor.
 */
function paintMuckSpray(ctx: Ctx, shape: BodyShape, phase: number, strength: number): void {
  if (strength <= 0.02) return;
  const COUNT = 16;
  for (let i = 0; i < COUNT; i++) {
    const drift = (phase + hash1(i * 1.7 + 0.3)) % 1;
    const angle = lerp(Math.PI * 0.15, Math.PI * 0.85, hash1(i * 1.7 + 1.1));
    const distance = lerp(BALL_RADIUS * 0.88, SPRAY_REACH, drift);
    const r = BALL_RADIUS * (0.018 + hash1(i * 1.7 + 2.4) * 0.03) * (1 - drift * 0.5);
    fillEllipse(
      ctx,
      Math.cos(angle) * distance,
      shape.offset.y + Math.sin(angle) * distance * shape.stretchY * 0.7,
      r,
      r * 0.8,
      tinted(i % 4 === 0 ? BLOOD_DARK : MUCK.mid, (1 - drift) * 0.7 * strength),
    );
  }
}

/**
 * Burst: the ball comes apart and its Tusklings fall out.
 *
 * The rip opens across the middle rather than blowing the whole silhouette
 * outward, because what has to read is *dismemberment* — the fight ends with the
 * crawler learning what the ball was made of.
 */
export function drawBallBurst(ctx: Ctx, progress: number): void {
  const t = clamp01(progress);
  const split = easeInOut(clamp01(t * 1.4));
  const collapse = easeInOut(clamp01((t - 0.5) / 0.5));
  const fade = 1 - collapse * 0.55;

  ctx.save();
  ctx.globalAlpha = Math.max(MIN_ALPHA, fade);

  for (const half of [-1, 1] as const) {
    const shape: BodyShape = {
      scale: lerp(1, 0.82, collapse),
      stretchX: 1 + split * 0.1,
      stretchY: lerp(1, 0.5, collapse) * 0.62,
      wobble: 0.9 + half,
      lobeDepth: LOBE_DEPTH * (1 + split * 1.6),
      offset: {
        x: half * BALL_RADIUS * split * 0.16,
        y: half * BALL_RADIUS * (0.34 + split * 0.34) + BALL_RADIUS * collapse * 0.4,
      },
    };
    const mood: MemberMood = { maw: 1, glare: 1, blinkPhase: 0.5, ruin: t };
    paintFlesh(ctx, shape);
    paintSeams(ctx, shape, 0.9 + half);
    for (const projected of projectMembers(0.9 + half)) {
      if (projected.member.latitude * half < 0) continue;
      paintMember(
        ctx,
        {
          member: projected.member,
          x: shape.offset.x + projected.x * shape.stretchX,
          y: shape.offset.y + projected.y * shape.stretchY * 0.62,
          normal: projected.normal,
        },
        mood,
      );
    }
    paintRim(ctx, shape);
  }

  // The wound between the halves: gut, blood, and a widening black gap.
  const gapHalf = BALL_RADIUS * split * 0.42;
  if (gapHalf > BALL_RADIUS * 0.02) {
    ctx.beginPath();
    traceEllipse(ctx, 0, BALL_RADIUS * collapse * 0.4, BALL_RADIUS * 0.96, gapHalf);
    ctx.fillStyle = BLOOD_DARK;
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const x = lerp(-BALL_RADIUS * 0.8, BALL_RADIUS * 0.8, i / 8);
      const r = BALL_RADIUS * (0.1 + hash1(i * 3.7 + 0.9) * 0.12) * split;
      fillEllipse(
        ctx,
        x,
        BALL_RADIUS * collapse * 0.4 + (hash1(i * 3.7 + 2.1) - 0.5) * gapHalf,
        r,
        r * 0.8,
        i % 2 === 0 ? GUT.mid : GUT.dark,
      );
    }
    fillEllipse(
      ctx,
      0,
      BALL_RADIUS * collapse * 0.4,
      BALL_RADIUS * 0.9,
      gapHalf * 0.4,
      tinted(BLOOD, 0.7),
    );
  }

  // Debris: heads, hooves and cloth thrown clear as the thing lets go.
  const DEBRIS = 14;
  for (let i = 0; i < DEBRIS; i++) {
    const angle = hash1(i * 4.1 + 0.5) * TAU;
    const distance = lerp(
      BALL_RADIUS * 0.3,
      SPRAY_REACH,
      easeInOut(t) * (0.5 + hash1(i * 4.1 + 1.3) * 0.5),
    );
    const r = BALL_RADIUS * (0.04 + hash1(i * 4.1 + 2.2) * 0.06);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance + BALL_RADIUS * collapse * 0.3;
    const which = hash1(i * 4.1 + 3.4);
    if (which > 0.72) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + t * 3);
      drawTuskPair(ctx, r * 2.4, r * 0.5, i * 4.1);
      ctx.restore();
    } else if (which > 0.5) {
      fillEllipse(ctx, x, y, r * 1.2, r, HOOF.mid, angle);
    } else {
      fillEllipse(ctx, x, y, r * 1.4, r * 0.9, which > 0.28 ? GUT.mid : BLOOD, angle);
      fillEllipse(ctx, x, y, r * 0.7, r * 0.5, tinted(BLOOD_DARK, 0.8), angle);
    }
  }
  ctx.restore();
}
