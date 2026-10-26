/**
 * The reward chest, painted procedurally for each rarity: a barrel-lidded
 * treasure chest seen from a little above and to one side, so the arch of its
 * lid reads in profile. The lid swings back about a hinge along the rear top
 * edge; the hasp flips up off the lock plate before it does.
 *
 * The chest is modelled as a few flat faces under an orthographic view. Each
 * flat face is an affine image of a rectangle, so its planks, straps, studs
 * and runes are drawn in the face's own 2D coordinates through one
 * `ctx.transform`. The curved lid is a ring of narrow flat strips, each
 * clipped to itself and drawn the same way, so straps run unbroken over it.
 *
 * Units: the chest is one unit wide. The caller passes the screen point under
 * the middle of its footprint and the width in pixels; squash, wobble and
 * shake are the caller's own transform around that point.
 */

import type { Rarity } from '../../core/items/defs/rarity';
import type { ChestInk, ChestMaterial } from '../../ui/theme/rewardChestInk';
import { mix, withAlpha } from '../../ui/theme/color';

/** Everything that moves on the chest, frame by frame. */
export interface ChestPose {
  readonly rarity: Rarity;
  /** Radians the lid has swung back from shut. */
  readonly lidAngle: number;
  /** 0 with the hasp down over the lock, 1 flipped up onto the lid. */
  readonly haspLift: number;
  /** 0 to 1: light leaking from the seam under the lid and the keyhole. */
  readonly seamGlow: number;
  /** 0 to 1: light pouring out of the open chest. */
  readonly innerGlow: number;
  /** 0 to 1: how bright the inlaid runes burn. */
  readonly runePulse: number;
  /** Frames since the chest appeared, for the halo, the wings and the glints. */
  readonly time: number;
}

/** Where things on the chest sit on screen, for the effects drawn round it. */
export interface ChestAnchors {
  /** The middle of the open mouth, where light and treasure come out. */
  readonly mouth: { readonly x: number; readonly y: number; readonly w: number };
  /** The keyhole, where light leaks while it is shut. */
  readonly keyhole: { readonly x: number; readonly y: number };
  /** The top of the shut lid. */
  readonly lidTop: number;
  /** Half the chest's widest reach on screen, wings included. */
  readonly halfSpan: number;
}

/** What a rarity's chest is built with, beyond its colours. */
interface ChestStyle {
  readonly planks: boolean;
  readonly knots: boolean;
  readonly cornerCaps: 'small' | 'large';
  readonly gildedPanels: boolean;
  readonly lionHasp: boolean;
  readonly runes: boolean;
  readonly filigree: boolean;
  readonly wings: boolean;
  readonly halo: boolean;
  readonly polishedBands: boolean;
}

const STYLE: Readonly<Record<Rarity, ChestStyle>> = {
  Common: {
    planks: true,
    knots: true,
    cornerCaps: 'small',
    gildedPanels: false,
    lionHasp: false,
    runes: false,
    filigree: false,
    wings: false,
    halo: false,
    polishedBands: false,
  },
  Uncommon: {
    planks: true,
    knots: false,
    cornerCaps: 'large',
    gildedPanels: false,
    lionHasp: false,
    runes: false,
    filigree: false,
    wings: false,
    halo: false,
    polishedBands: false,
  },
  Rare: {
    planks: true,
    knots: false,
    cornerCaps: 'small',
    gildedPanels: false,
    lionHasp: false,
    runes: false,
    filigree: false,
    wings: false,
    halo: false,
    polishedBands: true,
  },
  Epic: {
    planks: true,
    knots: false,
    cornerCaps: 'large',
    gildedPanels: false,
    lionHasp: false,
    runes: true,
    filigree: false,
    wings: false,
    halo: false,
    polishedBands: false,
  },
  Legendary: {
    planks: false,
    knots: false,
    cornerCaps: 'large',
    gildedPanels: true,
    lionHasp: true,
    runes: false,
    filigree: false,
    wings: false,
    halo: false,
    polishedBands: true,
  },
  Divine: {
    planks: false,
    knots: false,
    cornerCaps: 'large',
    gildedPanels: true,
    lionHasp: false,
    runes: false,
    filigree: true,
    wings: true,
    halo: true,
    polishedBands: true,
  },
};

// ── Geometry, in chest widths ───────────────────────────────────────────

const W = 1;
const D = 0.62;
const HB = 0.5;
const HL = 0.27;
const HALF = 0.5;
/** The view: turned this far round the vertical, tipped this far down. */
const YAW = 0.36;
const PITCH = 0.42;
const CA = Math.cos(YAW);
const SA = Math.sin(YAW);
const CB = Math.cos(PITCH);
const SB = Math.sin(PITCH);
const LID_STRIPS = 14;
/** Past this angle the open lid is behind the body, so it is drawn first. */
const LID_BEHIND_ANGLE = 0.9;
const WALL = 0.035;
const FLOOR_Y = 0.06;
/** The top of the treasure heap's rim, as a share of the body's height. */
const TREASURE_FILL_SHARE = 0.62;
const TREASURE_Y = HB * TREASURE_FILL_SHARE;
/** How far the middle of the treasure heap stands above its edges. */
const TREASURE_MOUND = 0.2;
/** The two straps' centres across the front, in chest widths from the left. */
const STRAP_INSET = 0.2;
const STRAP_U = [STRAP_INSET, W - STRAP_INSET] as const;
const STRAP_W = 0.075;
const TRIM_W = 0.045;
const PLATE_W = 0.17;
const PLATE_H = 0.2;
const PLATE_TOP = 0.02;
const KEYHOLE_V = 0.165;
const HASP_W = 0.1;
const HASP_L = 0.18;
const LION_HASP_W = 0.22;
const LION_HASP_L = 0.26;
const HASP_HINGE_DY = 0.05;
const HASP_PROUD = 0.014;
/** The hasp turns this far up as it flips: past straight out, onto the lid. */
const HASP_FLIP = Math.PI;
const HALO_RADIUS = 0.3;
/** How far above the shut lid the halo floats. */
const HALO_CLEARANCE = 0.3;
const HALO_HEIGHT = HB + HL + HALO_CLEARANCE;
/** The halo rises out of the opening lid's way. */
const HALO_OPEN_RISE = 0.32;
const HALO_SPIN_PER_FRAME = 0.02;
const HALO_GLINTS = 5;
const WING_FLAP_PER_FRAME = 0.045;
const WING_FLAP = 0.06;
const RUNE_SIZE = 0.075;
const LIGHT = normalize({ x: 0.35, y: 0.75, z: 0.55 });
const SHADE_AMBIENT = 0.32;
const OUTLINE_W = 0.008;
const SEAM_W = 0.006;
const FULL_TURN = Math.PI * 2;

interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Face {
  readonly o: V3;
  readonly u: V3;
  readonly v: V3;
}

function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}
function add(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}
function sub(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}
function scale(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}
function length(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function normalize(a: V3): V3 {
  return scale(a, 1 / length(a));
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function sx(p: V3): number {
  return p.x * CA + p.z * SA;
}
function sy(p: V3): number {
  return -p.y * CB + (-p.x * SA + p.z * CA) * SB;
}
/** Larger is nearer the viewer. */
function depth(p: V3): number {
  return (-p.x * SA + p.z * CA) * CB + p.y * SB;
}
function faces(n: V3): boolean {
  return depth(n) > 0;
}

function shadeOf(n: V3): number {
  return SHADE_AMBIENT + (1 - SHADE_AMBIENT) * Math.max(0, dot(normalize(n), LIGHT));
}

/** A material at a brightness from 0 (its shadow) to 1 (its highlight). */
function tone(m: ChestMaterial, s: number): string {
  const t = Math.max(0, Math.min(1, s));
  return t < HALF ? mix(m.dark, m.base, t / HALF) : mix(m.base, m.light, (t - HALF) / HALF);
}

function withFace(ctx: CanvasRenderingContext2D, face: Face, draw: () => void): void {
  ctx.save();
  ctx.transform(sx(face.u), sy(face.u), sx(face.v), sy(face.v), sx(face.o), sy(face.o));
  draw();
  ctx.restore();
}

function polygon(ctx: CanvasRenderingContext2D, points: readonly V3[]): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(sx(p), sy(p));
    else ctx.lineTo(sx(p), sy(p));
  });
  ctx.closePath();
}

/** Repeatable scatter in [0, 1) for grain, knots and coin heaps. */
function scatter(seed: number): number {
  const SCATTER_FREQUENCY = 12.9898;
  const SCATTER_SPREAD = 43758.5453;
  const value = Math.sin(seed * SCATTER_FREQUENCY) * SCATTER_SPREAD;
  return value - Math.floor(value);
}

// ── The lid's profile ───────────────────────────────────────────────────

/** A point on the lid's arch, `phi` 0 at the front edge to π at the hinge, swung back by `theta`. */
function lidPoint(phi: number, theta: number, x: number): V3 {
  const dz = (D / 2) * (1 + Math.cos(phi));
  const dy = HL * Math.sin(phi);
  return lidLocal(dz, dy, theta, x);
}

/** A point given in the shut lid's hinge frame (forward, up), swung back by `theta`. */
function lidLocal(dz: number, dy: number, theta: number, x: number): V3 {
  const rz = dz * Math.cos(theta) - dy * Math.sin(theta);
  const ry = dz * Math.sin(theta) + dy * Math.cos(theta);
  return v3(x, HB + ry, -D / 2 + rz);
}

function lidDirection(dz: number, dy: number, theta: number): V3 {
  return v3(
    0,
    dz * Math.sin(theta) + dy * Math.cos(theta),
    dz * Math.cos(theta) - dy * Math.sin(theta),
  );
}

const ARC: readonly number[] = (() => {
  const lengths = [0];
  for (let i = 1; i <= LID_STRIPS; i++) {
    const a = lidPoint((Math.PI * (i - 1)) / LID_STRIPS, 0, 0);
    const b = lidPoint((Math.PI * i) / LID_STRIPS, 0, 0);
    lengths.push((lengths[i - 1] ?? 0) + length(sub(b, a)));
  }
  return lengths;
})();
const ARC_TOTAL = ARC[LID_STRIPS] ?? 1;

// ── Surface decoration, in a face's own coordinates ─────────────────────

interface Decor {
  readonly ctx: CanvasRenderingContext2D;
  readonly ink: ChestInk;
  readonly style: ChestStyle;
  readonly pose: ChestPose;
  readonly shade: number;
}

/**
 * How far a part's tone sits from its face's own shade, from 0 (shadow) to 1
 * (highlight): a lit edge, a shaded edge, a recess cut into the surface.
 */
const TONE = {
  glint: 0.5,
  bright: 0.45,
  lit: 0.35,
  raised: 0.25,
  soft: 0.12,
  faint: 0.1,
  dim: 0.2,
  shaded: 0.35,
  recessed: 0.4,
  deep: 0.45,
  darkest: 0.5,
} as const;

/** Stroke widths, in chest widths. */
const LINE = {
  hair: 0.004,
  fine: 0.005,
  rule: 0.012,
  inlay: 0.011,
  rune: 0.016,
  runeGlow: 0.02,
  runeCore: 0.007,
  handle: 0.018,
} as const;

/** A strap's lit edge, polished streak and shaded edge, as shares of its width. */
const STRAP = {
  litShare: 0.22,
  streakFrom: 0.3,
  streakShare: 0.12,
  streakAlpha: 0.55,
  shadedFrom: 0.85,
  shadedShare: 0.15,
} as const;

function strapPaint(d: Decor, x: number, y: number, w: number, h: number): void {
  const { ctx, ink, style, shade } = d;
  ctx.fillStyle = tone(ink.band, shade);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = tone(ink.band, shade + TONE.lit);
  ctx.fillRect(x, y, w * STRAP.litShare, h);
  if (style.polishedBands) {
    ctx.fillStyle = withAlpha(ink.band.light, STRAP.streakAlpha);
    ctx.fillRect(x + w * STRAP.streakFrom, y, w * STRAP.streakShare, h);
  }
  ctx.fillStyle = tone(ink.band, shade - TONE.shaded);
  ctx.fillRect(x + w * STRAP.shadedFrom, y, w * STRAP.shadedShare, h);
}

/** A rivet's domed highlight: offset up and left, as shares of its radius. */
const RIVET = { highlightOffset: 0.25, highlightShare: 0.6 } as const;
const RIVET_R = { small: 0.009, plate: 0.009, cap: 0.011, strap: 0.012, handle: 0.014 } as const;

function rivet(d: Decor, x: number, y: number, r: number): void {
  const { ctx, ink, shade } = d;
  ctx.fillStyle = tone(ink.rivet, shade - TONE.recessed);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tone(ink.rivet, shade + TONE.raised);
  ctx.beginPath();
  const off = r * RIVET.highlightOffset;
  ctx.arc(x - off, y - off, r * RIVET.highlightShare, 0, FULL_TURN);
  ctx.fill();
}

/** A cabochon gem in its metal setting, as shares of the gem's radius. */
const GEM = {
  settingShare: 1.3,
  lightOffset: 0.35,
  lightCore: 0.1,
  baseStop: 0.45,
  facetAlpha: 0.5,
  facetWidth: 0.12,
  facetReach: 0.5,
  glintX: 0.35,
  glintY: 0.4,
  glintShare: 0.28,
} as const;
const GEM_R = { strap: 0.02, plate: 0.032, lid: 0.04, heap: 0.026 } as const;
/** How fast a gem's glint comes and goes, and how its timing varies gem to gem. */
const GLINT = { perFrame: 0.05, seedSpread: 1.7, floor: 0.55, swing: 0.45 } as const;

function gem(d: Decor, m: ChestMaterial, x: number, y: number, r: number, glint: number): void {
  const { ctx, ink, shade } = d;
  ctx.fillStyle = tone(ink.trim, shade - TONE.shaded);
  ctx.beginPath();
  ctx.arc(x, y, r * GEM.settingShare, 0, FULL_TURN);
  ctx.fill();
  const off = r * GEM.lightOffset;
  const body = ctx.createRadialGradient(x - off, y - off, r * GEM.lightCore, x, y, r);
  body.addColorStop(0, m.light);
  body.addColorStop(GEM.baseStop, m.base);
  body.addColorStop(1, m.dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = withAlpha(m.light, GEM.facetAlpha);
  ctx.lineWidth = r * GEM.facetWidth;
  const reach = r * GEM.facetReach;
  ctx.beginPath();
  ctx.moveTo(x - reach, y);
  ctx.lineTo(x, y - reach);
  ctx.lineTo(x + reach, y);
  ctx.stroke();
  if (glint > 0) {
    ctx.fillStyle = withAlpha(m.light, glint);
    ctx.beginPath();
    ctx.arc(x - r * GEM.glintX, y - r * GEM.glintY, r * GEM.glintShare, 0, FULL_TURN);
    ctx.fill();
  }
}

function gemGlint(pose: ChestPose, seed: number): number {
  const wave = Math.sin(pose.time * GLINT.perFrame + seed * GLINT.seedSpread);
  return GLINT.floor + GLINT.swing * Math.max(0, wave);
}

/** The gilded chests' recessed panels and the lattice engraved inside them. */
const PANEL = {
  pad: 0.035,
  bevel: 0.01,
  latticeInset: 0.015,
  latticeStep: 0.07,
  latticeAlpha: 0.25,
} as const;

/** Grain lines and knots along each plank, as shares of the plank and the face. */
const GRAIN = {
  lines: 3,
  firstShare: 0.25,
  stepShare: 0.25,
  wander: 0.1,
  alpha: 0.35,
  bowFrom: 0.3,
  bowTo: 0.6,
  bow: 0.012,
  tail: 0.006,
  seedStride: 7,
  knotChance: 0.35,
  knotFrom: 0.15,
  knotSpan: 0.7,
  knotSeedStride: 3,
  knotRx: 0.022,
  knotRy: 0.011,
  knotAlpha: 0.55,
  seamLightAlpha: 0.25,
} as const;

function lattice(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.beginPath();
  for (let k = -h; k < w; k += PANEL.latticeStep) {
    ctx.moveTo(k, 0);
    ctx.lineTo(k + h, h);
    ctx.moveTo(k + h, 0);
    ctx.lineTo(k, h);
  }
}

/** Planks (or gilded panels) across a `w` × `h` face, grain running along `u`. */
function woodFill(d: Decor, w: number, h: number, planks: number, seed: number): void {
  const { ctx, ink, style, shade } = d;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, tone(ink.body, shade + TONE.soft));
  grad.addColorStop(1, tone(ink.body, shade - TONE.dim));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  if (style.gildedPanels) {
    const { pad, bevel, latticeInset } = PANEL;
    ctx.strokeStyle = tone(ink.body, shade - TONE.deep);
    ctx.lineWidth = LINE.rule;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
    ctx.strokeStyle = tone(ink.body, shade + TONE.bright);
    ctx.lineWidth = LINE.fine;
    ctx.strokeRect(pad + bevel, pad + bevel, w - (pad + bevel) * 2, h - (pad + bevel) * 2);
    ctx.strokeStyle = withAlpha(ink.grain, PANEL.latticeAlpha);
    ctx.lineWidth = LINE.hair;
    ctx.save();
    const inner = pad + latticeInset;
    ctx.beginPath();
    ctx.rect(inner, inner, w - inner * 2, h - inner * 2);
    ctx.clip();
    lattice(ctx, w, h);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (!style.planks) return;
  const plankH = h / planks;
  for (let i = 0; i < planks; i++) {
    const top = i * plankH;
    ctx.strokeStyle = withAlpha(ink.grain, GRAIN.alpha);
    ctx.lineWidth = LINE.hair;
    for (let g = 0; g < GRAIN.lines; g++) {
      const wander = GRAIN.wander * (scatter(seed + i * GRAIN.seedStride + g) - HALF);
      const gy = top + plankH * (GRAIN.firstShare + GRAIN.stepShare * g + wander);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(
        w * GRAIN.bowFrom,
        gy + GRAIN.bow,
        w * GRAIN.bowTo,
        gy - GRAIN.bow,
        w,
        gy + GRAIN.tail,
      );
      ctx.stroke();
    }
    if (style.knots && scatter(seed + i) > GRAIN.knotChance) {
      const kx = w * (GRAIN.knotFrom + GRAIN.knotSpan * scatter(seed + i * GRAIN.knotSeedStride));
      ctx.fillStyle = withAlpha(ink.grain, GRAIN.knotAlpha);
      ctx.beginPath();
      ctx.ellipse(kx, top + plankH * HALF, GRAIN.knotRx, GRAIN.knotRy, 0, 0, FULL_TURN);
      ctx.fill();
    }
    if (i > 0) {
      ctx.fillStyle = ink.grain;
      ctx.fillRect(0, top - SEAM_W / 2, w, SEAM_W);
      ctx.fillStyle = withAlpha(ink.body.light, GRAIN.seamLightAlpha);
      ctx.fillRect(0, top + SEAM_W / 2, w, SEAM_W / 2);
    }
  }
}

/** A corner bracket's reach, its inner notch and its rivet, as shares of its size. */
const CORNER = { large: 0.13, small: 0.085, notchShare: 0.45, rivetShare: 0.28 } as const;

function cornerCaps(d: Decor, w: number, h: number): void {
  const { ctx, ink, style, shade } = d;
  const size = style.cornerCaps === 'large' ? CORNER.large : CORNER.small;
  const corners: readonly { x: number; y: number; dx: number; dy: number }[] = [
    { x: 0, y: 0, dx: 1, dy: 1 },
    { x: w, y: 0, dx: -1, dy: 1 },
    { x: 0, y: h, dx: 1, dy: -1 },
    { x: w, y: h, dx: -1, dy: -1 },
  ];
  for (const { x, y, dx, dy } of corners) {
    ctx.fillStyle = tone(ink.trim, shade);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * size, y);
    ctx.lineTo(x + dx * size * CORNER.notchShare, y + dy * size * CORNER.notchShare);
    ctx.lineTo(x, y + dy * size);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tone(ink.trim, shade + TONE.recessed);
    ctx.lineWidth = LINE.fine;
    ctx.stroke();
    const at = size * CORNER.rivetShare;
    rivet(d, x + dx * at, y + dy * at, RIVET_R.cap);
  }
}

/** One stroke of a rune, from (x0, y0) to (x1, y1) in its unit square. */
interface RuneStroke {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A few angular glyphs, each a list of strokes in a unit square. */
const RUNES: readonly (readonly RuneStroke[])[] = [
  [
    { x0: 0.5, y0: 0, x1: 0.5, y1: 1 },
    { x0: 0.5, y0: 0.2, x1: 0.85, y1: 0.45 },
    { x0: 0.5, y0: 0.55, x1: 0.15, y1: 0.8 },
  ],
  [
    { x0: 0.2, y0: 0, x1: 0.2, y1: 1 },
    { x0: 0.2, y0: 0, x1: 0.8, y1: 0.35 },
    { x0: 0.8, y0: 0.35, x1: 0.2, y1: 0.65 },
    { x0: 0.2, y0: 0.65, x1: 0.8, y1: 1 },
  ],
  [
    { x0: 0.5, y0: 0, x1: 0.1, y1: 0.5 },
    { x0: 0.1, y0: 0.5, x1: 0.5, y1: 1 },
    { x0: 0.5, y0: 1, x1: 0.9, y1: 0.5 },
    { x0: 0.9, y0: 0.5, x1: 0.5, y1: 0 },
    { x0: 0.5, y0: 0.3, x1: 0.5, y1: 0.7 },
  ],
  [
    { x0: 0.15, y0: 0, x1: 0.85, y1: 1 },
    { x0: 0.85, y0: 0, x1: 0.15, y1: 1 },
    { x0: 0.5, y0: 0, x1: 0.5, y1: 1 },
  ],
];

/** A rune's carved groove, its glow and its hot core, and how strongly each pulses. */
const RUNE_INK = {
  grooveAlpha: 0.9,
  glowFloor: 0.25,
  glowSwing: 0.5,
  coreFloor: 0.4,
  coreSwing: 0.6,
} as const;

function runeAt(d: Decor, index: number, x: number, y: number): void {
  const { ctx, ink, pose } = d;
  if (ink.rune === null) return;
  const strokes = RUNES[index % RUNES.length] ?? [];
  const s = RUNE_SIZE;
  const draw = (color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const { x0, y0, x1, y1 } of strokes) {
      ctx.moveTo(x + (x0 - HALF) * s, y + (y0 - HALF) * s);
      ctx.lineTo(x + (x1 - HALF) * s, y + (y1 - HALF) * s);
    }
    ctx.stroke();
  };
  draw(withAlpha(ink.grain, RUNE_INK.grooveAlpha), LINE.rune);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  draw(
    withAlpha(ink.rune, RUNE_INK.glowFloor + RUNE_INK.glowSwing * pose.runePulse),
    LINE.runeGlow,
  );
  draw(
    withAlpha(ink.glowCore, RUNE_INK.coreFloor + RUNE_INK.coreSwing * pose.runePulse),
    LINE.runeCore,
  );
  ctx.restore();
}

/** A point of a scroll, across (`t`, 0 at the middle to 1 at the edge) and down (`v`) its box. */
interface ScrollPoint {
  readonly t: number;
  readonly v: number;
}

/**
 * One half of the Divine chest's scrollwork, mirrored for the other half: a
 * curl that winds in to a bead, and a tail sweeping out beneath it. Each
 * curve is three points after the shared start.
 */
const SCROLL = {
  start: { t: 0.05, v: 0.5 },
  curl: [
    [
      { t: 0.4, v: 0.05 },
      { t: 0.9, v: 0.15 },
      { t: 0.85, v: 0.5 },
    ],
    [
      { t: 0.8, v: 0.8 },
      { t: 0.5, v: 0.75 },
      { t: 0.55, v: 0.55 },
    ],
    [
      { t: 0.6, v: 0.4 },
      { t: 0.72, v: 0.48 },
      { t: 0.68, v: 0.58 },
    ],
  ],
  tail: [
    { t: 0.35, v: 0.95 },
    { t: 0.7, v: 0.95 },
    { t: 0.95, v: 0.85 },
  ],
  bead: { t: 0.68, v: 0.58 },
  beadR: 0.008,
} as const satisfies {
  start: ScrollPoint;
  curl: readonly (readonly [ScrollPoint, ScrollPoint, ScrollPoint])[];
  tail: readonly [ScrollPoint, ScrollPoint, ScrollPoint];
  bead: ScrollPoint;
  beadR: number;
};

/** Mirrored gold scrollwork filling a `w` × `h` box at (x, y). */
function filigree(d: Decor, x: number, y: number, w: number, h: number): void {
  const { ctx, ink, shade } = d;
  if (ink.filigree === null) return;
  const scroll = (mirror: number): void => {
    const cx = x + w * HALF;
    const px = (p: ScrollPoint): number => cx + mirror * p.t * w * HALF;
    const py = (p: ScrollPoint): number => y + h * p.v;
    const curve = (c: readonly [ScrollPoint, ScrollPoint, ScrollPoint]): void =>
      ctx.bezierCurveTo(px(c[0]), py(c[0]), px(c[1]), py(c[1]), px(c[2]), py(c[2]));
    ctx.beginPath();
    ctx.moveTo(px(SCROLL.start), py(SCROLL.start));
    for (const c of SCROLL.curl) curve(c);
    ctx.moveTo(px(SCROLL.start), py(SCROLL.start));
    curve(SCROLL.tail);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px(SCROLL.bead), py(SCROLL.bead), SCROLL.beadR, 0, FULL_TURN);
    ctx.fill();
  };
  const fil = ink.filigree;
  ctx.lineCap = 'round';
  ctx.strokeStyle = tone(fil, shade - TONE.shaded);
  ctx.fillStyle = tone(fil, shade);
  ctx.lineWidth = LINE.inlay;
  scroll(1);
  scroll(-1);
  ctx.strokeStyle = tone(fil, shade + TONE.lit);
  ctx.lineWidth = LINE.fine;
  scroll(1);
  scroll(-1);
}

// ── The body ────────────────────────────────────────────────────────────

const FRONT: Face = { o: v3(-W / 2, HB, D / 2), u: v3(1, 0, 0), v: v3(0, -1, 0) };
const LEFT: Face = { o: v3(-W / 2, HB, -D / 2), u: v3(0, 0, 1), v: v3(0, -1, 0) };
const BODY_PLANKS = 3;
const FRONT_GRAIN_SEED = 1;
const LEFT_GRAIN_SEED = 5;

/** Where the front's runes and scrollwork sit, in the face's own units. */
const FRONT_RUNES: readonly { readonly glyph: number; readonly x: number; readonly y: number }[] = [
  { glyph: 0, x: 0.36, y: 0.3 },
  { glyph: 1, x: 0.64, y: 0.3 },
  { glyph: 2, x: 0.09, y: 0.27 },
  { glyph: 3, x: 0.91, y: 0.27 },
];
const FRONT_FILIGREE: readonly { readonly x: number; readonly y: number }[] = [
  { x: 0.27, y: 0.12 },
  { x: 0.55, y: 0.12 },
];
const FRONT_FILIGREE_SIZE = { w: 0.18, h: 0.3 } as const;
/** Studs (or rivets) down each front strap: how many, the first, and the step between. */
const FRONT_STUDS = { count: 3, from: 0.08, step: 0.15, seedStride: 10 } as const;
/** The lit rim along the body's top edge, as a share of the outline width. */
const TOP_RIM_SHARE = 0.6;

function paintFront(d: Decor): void {
  const { ctx, ink, style } = d;
  const decor = { ...d, shade: shadeOf(v3(0, 0, 1)) };
  withFace(ctx, FRONT, () => {
    woodFill(decor, W, HB, BODY_PLANKS, FRONT_GRAIN_SEED);
    for (const u of STRAP_U) strapPaint(decor, u - STRAP_W / 2, 0, STRAP_W, HB);
    strapPaint(decor, 0, HB - TRIM_W, W, TRIM_W);
    if (style.runes) for (const r of FRONT_RUNES) runeAt(decor, r.glyph, r.x, r.y);
    if (style.filigree) {
      for (const f of FRONT_FILIGREE) {
        filigree(decor, f.x, f.y, FRONT_FILIGREE_SIZE.w, FRONT_FILIGREE_SIZE.h);
      }
    }
    for (const u of STRAP_U) {
      for (let k = 0; k < FRONT_STUDS.count; k++) {
        const v = FRONT_STUDS.from + k * FRONT_STUDS.step;
        if (ink.studs.length > 0) {
          const m = ink.studs[(k + (u > HALF ? 1 : 0)) % ink.studs.length];
          gem(decor, m, u, v, GEM_R.strap, gemGlint(d.pose, k + u * FRONT_STUDS.seedStride));
        } else rivet(decor, u, v, RIVET_R.strap);
      }
    }
    cornerCaps(decor, W, HB);
    lockPlate(decor);
    ctx.strokeStyle = tone(ink.trim, decor.shade + TONE.glint);
    ctx.lineWidth = OUTLINE_W * TOP_RIM_SHARE;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.stroke();
  });
}

/** The lock plate under the hasp: its backing, rivets, gem, staple and keyhole. */
const PLATE = {
  backing: 0.006,
  backingRadius: 0.03,
  radius: 0.026,
  rivetInset: 0.022,
  gemV: 0.075,
  gemGlintSeed: 3,
  stapleHalfW: 0.022,
  stapleV: 0.085,
  stapleH: 0.03,
  stapleRadius: 0.008,
  keyBowRise: 0.008,
  keyBowR: 0.013,
  keyNeckHalf: 0.007,
  keyNeckRise: 0.004,
  keyFootHalf: 0.011,
  keyFootDrop: 0.024,
} as const;

function lockPlate(d: Decor): void {
  const { ctx, ink, shade, pose } = d;
  const x = W / 2 - PLATE_W / 2;
  const cx = W / 2;
  ctx.fillStyle = tone(ink.trim, shade - TONE.shaded);
  ctx.beginPath();
  ctx.roundRect(
    x - PLATE.backing,
    PLATE_TOP - PLATE.backing,
    PLATE_W + PLATE.backing * 2,
    PLATE_H + PLATE.backing * 2,
    PLATE.backingRadius,
  );
  ctx.fill();
  const g = ctx.createLinearGradient(x, PLATE_TOP, x + PLATE_W, PLATE_TOP + PLATE_H);
  g.addColorStop(0, tone(ink.trim, shade + TONE.recessed));
  g.addColorStop(1, tone(ink.trim, shade - TONE.dim));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, PLATE_TOP, PLATE_W, PLATE_H, PLATE.radius);
  ctx.fill();
  const rivetY = PLATE_TOP + PLATE_H - PLATE.rivetInset;
  rivet(d, x + PLATE.rivetInset, rivetY, RIVET_R.plate);
  rivet(d, x + PLATE_W - PLATE.rivetInset, rivetY, RIVET_R.plate);
  if (ink.keyGem !== null) {
    gem(d, ink.keyGem, cx, PLATE_TOP + PLATE.gemV, GEM_R.plate, gemGlint(pose, PLATE.gemGlintSeed));
  }
  ctx.fillStyle = tone(ink.trim, shade - TONE.recessed);
  ctx.beginPath();
  ctx.roundRect(
    cx - PLATE.stapleHalfW,
    PLATE_TOP + PLATE.stapleV,
    PLATE.stapleHalfW * 2,
    PLATE.stapleH,
    PLATE.stapleRadius,
  );
  ctx.fill();
  const keyY = PLATE_TOP + KEYHOLE_V;
  ctx.fillStyle = ink.interiorShadow;
  ctx.beginPath();
  ctx.arc(cx, keyY - PLATE.keyBowRise, PLATE.keyBowR, 0, FULL_TURN);
  ctx.moveTo(cx - PLATE.keyNeckHalf, keyY - PLATE.keyNeckRise);
  ctx.lineTo(cx + PLATE.keyNeckHalf, keyY - PLATE.keyNeckRise);
  ctx.lineTo(cx + PLATE.keyFootHalf, keyY + PLATE.keyFootDrop);
  ctx.lineTo(cx - PLATE.keyFootHalf, keyY + PLATE.keyFootDrop);
  ctx.fill();
  const leak = Math.max(pose.seamGlow, pose.innerGlow * HALF);
  if (leak > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha(ink.glowCore, leak);
    ctx.fill();
    ctx.restore();
  }
}

/** The carrying handle on the side, on its two pins, and the side's rune. */
const HANDLE = { from: 0.32, to: 0.68, pinV: 0.16, sagV: 0.27 } as const;
const SIDE_RUNE = { glyph: 2, at: 0.25, v: 0.36 } as const;

function paintLeft(d: Decor): void {
  const { ctx, style } = d;
  const decor = { ...d, shade: shadeOf(v3(-1, 0, 0)) };
  withFace(ctx, LEFT, () => {
    woodFill(decor, D, HB, BODY_PLANKS, LEFT_GRAIN_SEED);
    strapPaint(decor, D * HALF - STRAP_W / 2, 0, STRAP_W, HB);
    strapPaint(decor, 0, HB - TRIM_W, D, TRIM_W);
    const a = D * HANDLE.from;
    const b = D * HANDLE.to;
    ctx.strokeStyle = tone(d.ink.trim, decor.shade - TONE.dim);
    ctx.lineWidth = LINE.handle;
    ctx.beginPath();
    ctx.moveTo(a, HANDLE.pinV);
    ctx.bezierCurveTo(a, HANDLE.sagV, b, HANDLE.sagV, b, HANDLE.pinV);
    ctx.stroke();
    rivet(decor, a, HANDLE.pinV, RIVET_R.handle);
    rivet(decor, b, HANDLE.pinV, RIVET_R.handle);
    if (style.runes) runeAt(decor, SIDE_RUNE.glyph, D * SIDE_RUNE.at, SIDE_RUNE.v);
    cornerCaps(decor, D, HB);
  });
}

/** How see-through the inner side wall is, and the reach and strength of the light inside. */
const INTERIOR = {
  sideWallAlpha: 0.7,
  glowReach: 0.6,
  glowCoreAlpha: 0.9,
  glowMidStop: 0.5,
  glowMidAlpha: 0.45,
} as const;

function paintInterior(d: Decor): void {
  const { ctx, ink, pose } = d;
  const rim = [
    v3(-W / 2, HB, -D / 2),
    v3(W / 2, HB, -D / 2),
    v3(W / 2, HB, D / 2),
    v3(-W / 2, HB, D / 2),
  ];
  const inner = [
    v3(-W / 2 + WALL, HB, -D / 2 + WALL),
    v3(W / 2 - WALL, HB, -D / 2 + WALL),
    v3(W / 2 - WALL, HB, D / 2 - WALL),
    v3(-W / 2 + WALL, HB, D / 2 - WALL),
  ];
  polygon(ctx, rim);
  ctx.fillStyle = tone(ink.trim, shadeOf(v3(0, 1, 0)));
  ctx.fill();
  ctx.save();
  polygon(ctx, inner);
  ctx.clip();
  ctx.fillStyle = ink.interiorShadow;
  ctx.fill();
  const backWall = [
    v3(-W / 2 + WALL, HB, -D / 2 + WALL),
    v3(W / 2 - WALL, HB, -D / 2 + WALL),
    v3(W / 2 - WALL, FLOOR_Y, -D / 2 + WALL),
    v3(-W / 2 + WALL, FLOOR_Y, -D / 2 + WALL),
  ];
  polygon(ctx, backWall);
  const wallGrad = ctx.createLinearGradient(
    0,
    sy(v3(0, HB, -D / 2)),
    0,
    sy(v3(0, FLOOR_Y, -D / 2)),
  );
  wallGrad.addColorStop(0, ink.interiorWall);
  wallGrad.addColorStop(1, ink.interiorShadow);
  ctx.fillStyle = wallGrad;
  ctx.fill();
  const sideWall = [
    v3(W / 2 - WALL, HB, -D / 2 + WALL),
    v3(W / 2 - WALL, HB, D / 2 - WALL),
    v3(W / 2 - WALL, FLOOR_Y, D / 2 - WALL),
    v3(W / 2 - WALL, FLOOR_Y, -D / 2 + WALL),
  ];
  polygon(ctx, sideWall);
  ctx.fillStyle = withAlpha(ink.interiorWall, INTERIOR.sideWallAlpha);
  ctx.fill();
  paintTreasure(d);
  if (pose.innerGlow > 0) {
    const mx = sx(v3(0, TREASURE_Y, 0));
    const my = sy(v3(0, TREASURE_Y, 0));
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, W * INTERIOR.glowReach);
    glow.addColorStop(0, withAlpha(ink.glowCore, INTERIOR.glowCoreAlpha * pose.innerGlow));
    glow.addColorStop(
      INTERIOR.glowMidStop,
      withAlpha(ink.glow, INTERIOR.glowMidAlpha * pose.innerGlow),
    );
    glow.addColorStop(1, withAlpha(ink.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(mx - W, my - W, W * 2, W * 2);
  }
  ctx.restore();
}

/** The treasure heap: how many coins, where they scatter, which are gems, and how each coin is cut. */
const HEAP = {
  coins: 60,
  angleSeed: 40,
  radiusSeed: 90,
  tiltSeed: 7,
  gemEvery: 9,
  gemAt: 4,
  litEvery: 3,
  coinR: 0.04,
  gemRise: 0.01,
  tiltSpread: 0.6,
  rimDrop: 0.008,
  rimTilt: 1.3,
  faceShare: 0.92,
  faceTilt: 1.15,
  ringShare: 0.6,
  ringTilt: 0.75,
  ringAlpha: 0.6,
} as const;

/** A heap of coins and a few gems mounded up inside, nearest drawn last. */
function paintTreasure(d: Decor): void {
  const { ctx, ink } = d;
  const heap: { p: V3; gem: ChestMaterial | null; seed: number }[] = [];
  const gems = [ink.keyGem, ...ink.studs].filter((m) => m !== null);
  for (let i = 0; i < HEAP.coins; i++) {
    const a = scatter(i + HEAP.angleSeed) * FULL_TURN;
    const r = Math.sqrt(scatter(i + HEAP.radiusSeed));
    const x = Math.cos(a) * r * (W / 2 - WALL * 2);
    const z = Math.sin(a) * r * (D / 2 - WALL * 2);
    const mound = (1 - r * r) * TREASURE_MOUND;
    const isGem = i % HEAP.gemEvery === HEAP.gemAt && gems.length > 0;
    const gemPick = isGem ? (gems[i % gems.length] ?? null) : null;
    heap.push({ p: v3(x, TREASURE_Y + mound, z), gem: gemPick, seed: i });
  }
  heap.sort((p, q) => depth(p.p) - depth(q.p));
  const r = HEAP.coinR;
  for (const { p, gem: g, seed } of heap) {
    const x = sx(p);
    const y = sy(p);
    if (g !== null) {
      gem(d, g, x, y - HEAP.gemRise, GEM_R.heap, 1);
      continue;
    }
    const tilt = (scatter(seed + HEAP.tiltSeed) - HALF) * HEAP.tiltSpread;
    ctx.fillStyle = ink.treasure.dark;
    ctx.beginPath();
    ctx.ellipse(x, y + HEAP.rimDrop, r, r * SB * HEAP.rimTilt, tilt, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = seed % HEAP.litEvery === 0 ? ink.treasure.light : ink.treasure.base;
    ctx.beginPath();
    ctx.ellipse(x, y, r * HEAP.faceShare, r * SB * HEAP.faceTilt, tilt, 0, FULL_TURN);
    ctx.fill();
    ctx.strokeStyle = withAlpha(ink.treasure.dark, HEAP.ringAlpha);
    ctx.lineWidth = LINE.hair;
    ctx.beginPath();
    ctx.ellipse(x, y, r * HEAP.ringShare, r * SB * HEAP.ringTilt, tilt, 0, FULL_TURN);
    ctx.stroke();
  }
}

// ── The lid ─────────────────────────────────────────────────────────────

/** Strips overlap by this much so no hairline of background shows between them. */
const STRIP_OVERLAP = 0.002;
/** How much darker a strip's inner face is than the same strip seen from outside. */
const INNER_FACE_SHADE = 0.55;

function paintLid(d: Decor): void {
  const { ctx, pose } = d;
  const theta = pose.lidAngle;
  interface Strip {
    readonly depth: number;
    readonly outward: boolean;
    readonly face: Face;
    readonly shade: number;
    readonly s0: number;
    readonly s1: number;
  }
  const strips: Strip[] = [];
  for (let i = 0; i < LID_STRIPS; i++) {
    const phi0 = (Math.PI * i) / LID_STRIPS;
    const phi1 = (Math.PI * (i + 1)) / LID_STRIPS;
    const a = lidPoint(phi0, theta, -W / 2);
    const b = lidPoint(phi1, theta, -W / 2);
    const chord = sub(b, a);
    const along = normalize(chord);
    const s0 = ARC[i] ?? 0;
    const s1 = ARC[i + 1] ?? s0;
    const mid = (phi0 + phi1) / 2;
    const normal = normalize(lidDirection(Math.cos(mid) / (D / 2), Math.sin(mid) / HL, theta));
    const outward = faces(normal);
    strips.push({
      depth: depth(add(a, scale(chord, HALF))),
      outward,
      face: { o: sub(a, scale(along, s0)), u: v3(1, 0, 0), v: along },
      shade: outward ? shadeOf(normal) : shadeOf(scale(normal, -1)) * INNER_FACE_SHADE,
      s0,
      s1,
    });
  }
  strips.sort((p, q) => p.depth - q.depth);
  for (const strip of strips) {
    withFace(ctx, strip.face, () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        -STRIP_OVERLAP,
        strip.s0 - STRIP_OVERLAP,
        W + STRIP_OVERLAP * 2,
        strip.s1 - strip.s0 + STRIP_OVERLAP * 2,
      );
      ctx.clip();
      const decor = { ...d, shade: strip.shade };
      if (strip.outward) lidOuter(decor);
      else lidInner(decor);
      ctx.restore();
    });
  }
  lidCap(d);
}

/**
 * The lid's outer face: its planks, grain, gilded panel, runes, scrollwork
 * and studs, laid out along the arc from the front edge (0) to the hinge.
 */
const LID = {
  planks: 4,
  grainLines: 8,
  grainFrom: 0.06,
  grainStep: 0.12,
  grainAlpha: 0.3,
  grainBowFrom: 0.3,
  grainBowTo: 0.7,
  grainBow: 0.01,
  seamLightAlpha: 0.22,
  panelX: 0.27,
  panelY: 0.06,
  panelBevel: 0.01,
  runeXs: { left: 0.4, middle: 0.5, right: 0.6 },
  runeGlyphs: { left: 3, middle: 0, right: 1 },
  filigreeX: 0.3,
  filigreeFrom: 0.25,
  filigreeW: 0.4,
  filigreeShare: 0.5,
  studs: 4,
  studFrom: 0.15,
  studStep: 0.23,
  studSeedStride: 7,
  crownGemSeed: 9,
  innerSeamAlpha: 0.6,
  innerGlowAlpha: 0.2,
} as const;

function lidOuter(d: Decor): void {
  const { ctx, ink, style } = d;
  ctx.fillStyle = tone(ink.body, d.shade);
  ctx.fillRect(0, 0, W, ARC_TOTAL);
  if (style.planks) {
    for (let k = 1; k < LID.planks; k++) {
      const s = (ARC_TOTAL * k) / LID.planks;
      ctx.fillStyle = ink.grain;
      ctx.fillRect(0, s - SEAM_W / 2, W, SEAM_W);
      ctx.fillStyle = withAlpha(ink.body.light, LID.seamLightAlpha);
      ctx.fillRect(0, s + SEAM_W / 2, W, SEAM_W / 2);
    }
    ctx.strokeStyle = withAlpha(ink.grain, LID.grainAlpha);
    ctx.lineWidth = LINE.hair;
    for (let g = 0; g < LID.grainLines; g++) {
      const s = ARC_TOTAL * (LID.grainFrom + LID.grainStep * g);
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(
        W * LID.grainBowFrom,
        s + LID.grainBow,
        W * LID.grainBowTo,
        s - LID.grainBow,
        W,
        s,
      );
      ctx.stroke();
    }
  }
  if (style.gildedPanels) {
    const panelW = W - LID.panelX * 2;
    const panelH = ARC_TOTAL - LID.panelY * 2;
    const bevel = LID.panelBevel;
    ctx.strokeStyle = tone(ink.body, d.shade - TONE.deep);
    ctx.lineWidth = LINE.rule;
    ctx.strokeRect(LID.panelX, LID.panelY, panelW, panelH);
    ctx.strokeStyle = tone(ink.body, d.shade + TONE.bright);
    ctx.lineWidth = LINE.fine;
    ctx.strokeRect(LID.panelX + bevel, LID.panelY + bevel, panelW - bevel * 2, panelH - bevel * 2);
  }
  if (style.runes) {
    const s = ARC_TOTAL * HALF;
    runeAt(d, LID.runeGlyphs.left, LID.runeXs.left, s);
    runeAt(d, LID.runeGlyphs.middle, LID.runeXs.middle, s);
    runeAt(d, LID.runeGlyphs.right, LID.runeXs.right, s);
  }
  if (style.filigree) {
    filigree(
      d,
      LID.filigreeX,
      ARC_TOTAL * LID.filigreeFrom,
      LID.filigreeW,
      ARC_TOTAL * LID.filigreeShare,
    );
  }
  strapPaint(d, 0, 0, W, TRIM_W);
  strapPaint(d, 0, ARC_TOTAL - TRIM_W, W, TRIM_W);
  for (const u of STRAP_U) {
    strapPaint(d, u - STRAP_W / 2, 0, STRAP_W, ARC_TOTAL);
    for (let k = 0; k < LID.studs; k++) {
      const s = ARC_TOTAL * (LID.studFrom + LID.studStep * k);
      if (ink.studs.length > 0) {
        const m = ink.studs[(k + (u > HALF ? 0 : 1)) % ink.studs.length];
        gem(d, m, u, s, GEM_R.strap, gemGlint(d.pose, k * 2 + u * LID.studSeedStride));
      } else rivet(d, u, s, RIVET_R.strap);
    }
  }
  if (style.gildedPanels && ink.keyGem !== null) {
    gem(d, ink.keyGem, W / 2, ARC_TOTAL * HALF, GEM_R.lid, gemGlint(d.pose, LID.crownGemSeed));
  }
}

function lidInner(d: Decor): void {
  const { ctx, ink, pose } = d;
  ctx.fillStyle = mix(ink.interiorWall, ink.body.dark, HALF);
  ctx.fillRect(0, 0, W, ARC_TOTAL);
  ctx.fillStyle = withAlpha(ink.interiorShadow, LID.innerSeamAlpha);
  for (let k = 1; k < LID.planks; k++) {
    ctx.fillRect(0, (ARC_TOTAL * k) / LID.planks, W, SEAM_W);
  }
  if (pose.innerGlow > 0) {
    ctx.fillStyle = withAlpha(ink.glow, LID.innerGlowAlpha * pose.innerGlow);
    ctx.fillRect(0, 0, W, ARC_TOTAL);
  }
  strapPaint(d, 0, 0, W, TRIM_W);
  strapPaint(d, 0, ARC_TOTAL - TRIM_W, W, TRIM_W);
  strapPaint(d, 0, 0, TRIM_W, ARC_TOTAL);
  strapPaint(d, W - TRIM_W, 0, TRIM_W, ARC_TOTAL);
}

/** The arched end's planks, its edging band and the bright line inside it, and its rivets. */
const CAP = {
  planks: 3,
  edgeHighlightShare: 0.25,
  edgeHighlightInset: 0.3,
  rivets: [
    { at: 0.15, rise: 0.42 },
    { at: 0.85, rise: 0.42 },
    { at: 0.5, rise: 0.9 },
  ],
} as const;

/** The lid's arched end, facing the viewer on the left. */
function lidCap(d: Decor): void {
  const { ctx, ink, pose } = d;
  const theta = pose.lidAngle;
  const shade = shadeOf(v3(-1, 0, 0));
  const face: Face = {
    o: lidLocal(0, 0, theta, -W / 2),
    u: lidDirection(1, 0, theta),
    v: lidDirection(0, 1, theta),
  };
  withFace(ctx, face, () => {
    const arch = (): void => {
      ctx.beginPath();
      ctx.moveTo(D, 0);
      ctx.ellipse(D / 2, 0, D / 2, HL, 0, 0, Math.PI, false);
      ctx.closePath();
    };
    arch();
    ctx.fillStyle = tone(ink.body, shade);
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (d.style.planks) {
      ctx.fillStyle = ink.grain;
      for (let k = 1; k < CAP.planks; k++) ctx.fillRect(0, (HL * k) / CAP.planks, D, SEAM_W);
    }
    ctx.restore();
    ctx.strokeStyle = tone(ink.band, shade);
    ctx.lineWidth = TRIM_W;
    arch();
    ctx.stroke();
    const inset = TRIM_W * CAP.edgeHighlightInset;
    ctx.strokeStyle = tone(ink.band, shade + TONE.lit);
    ctx.lineWidth = TRIM_W * CAP.edgeHighlightShare;
    ctx.beginPath();
    ctx.ellipse(D / 2, 0, D / 2 - inset, HL - inset, 0, 0, Math.PI, false);
    ctx.stroke();
    for (const r of CAP.rivets) rivet({ ...d, shade }, D * r.at, HL * r.rise, RIVET_R.strap);
  });
}

// ── The hasp ────────────────────────────────────────────────────────────

/** The hasp's hinge knuckle, its tab, the slot the staple passes through, and its rivet. */
const HASP = {
  knuckleFrom: 0.2,
  knuckleShare: 0.6,
  knuckleRise: 0.02,
  knuckleH: 0.03,
  tabFrom: 0.15,
  tabTo: 0.85,
  tabShoulder: 0.7,
  slotHalfW: 0.016,
  slotV: 0.55,
  slotH: 0.05,
  slotRadius: 0.01,
  tongueHalfW: 0.01,
  tongueV: 0.57,
  tongueH: 0.035,
  tongueRadius: 0.006,
  rivetV: 0.18,
} as const;

function paintHasp(d: Decor): void {
  const { ctx, ink, style, pose } = d;
  const theta = pose.lidAngle;
  const flip = pose.haspLift * HASP_FLIP;
  const w = style.lionHasp ? LION_HASP_W : HASP_W;
  const l = style.lionHasp ? LION_HASP_L : HASP_L;
  const hinge = lidLocal(D + HASP_PROUD, HASP_HINGE_DY, theta, 0);
  const dir = lidDirection(Math.sin(flip), -Math.cos(flip), theta);
  const face: Face = { o: sub(hinge, v3(w / 2, 0, 0)), u: v3(1, 0, 0), v: dir };
  const normal = lidDirection(Math.cos(flip), Math.sin(flip), theta);
  const shade = shadeOf(faces(normal) ? normal : scale(normal, -1));
  const decor = { ...d, shade };
  withFace(ctx, face, () => {
    ctx.fillStyle = tone(ink.trim, shade - TONE.recessed);
    ctx.fillRect(w * HASP.knuckleFrom, -HASP.knuckleRise, w * HASP.knuckleShare, HASP.knuckleH);
    if (style.lionHasp) {
      lionHead(decor, w, l);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, tone(ink.trim, shade + TONE.lit));
    g.addColorStop(1, tone(ink.trim, shade - TONE.raised));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w * HASP.tabFrom, 0);
    ctx.lineTo(w * HASP.tabTo, 0);
    ctx.lineTo(w * HASP.tabTo, l * HASP.tabShoulder);
    ctx.quadraticCurveTo(w * HASP.tabTo, l, w / 2, l);
    ctx.quadraticCurveTo(w * HASP.tabFrom, l, w * HASP.tabFrom, l * HASP.tabShoulder);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tone(ink.trim, shade - TONE.darkest);
    ctx.lineWidth = LINE.fine;
    ctx.stroke();
    ctx.fillStyle = ink.interiorShadow;
    ctx.beginPath();
    ctx.roundRect(
      w / 2 - HASP.slotHalfW,
      l * HASP.slotV,
      HASP.slotHalfW * 2,
      HASP.slotH,
      HASP.slotRadius,
    );
    ctx.fill();
    ctx.fillStyle = tone(ink.trim, shade + TONE.faint);
    ctx.beginPath();
    ctx.roundRect(
      w / 2 - HASP.tongueHalfW,
      l * HASP.tongueV,
      HASP.tongueHalfW * 2,
      HASP.tongueH,
      HASP.tongueRadius,
    );
    ctx.fill();
    rivet(decor, w / 2, l * HASP.rivetV, RIVET_R.cap);
  });
}

/**
 * The Legendary hasp, a gold lion's head holding a ring in its jaws, as
 * shares of its radius from the face's middle: the mane's petals, the face,
 * brows, emerald eyes, nose, muzzle, chin bar and ring.
 */
const LION = {
  centreV: 0.42,
  radiusShare: 0.5,
  barShare: 0.15,
  petals: 14,
  petalSpread: 0.3,
  petalBase: 0.62,
  faceLightX: 0.2,
  faceLightY: 0.25,
  faceLightCore: 0.1,
  faceGlowR: 0.66,
  faceR: 0.64,
  faceRim: 0.06,
  browX: 0.24,
  browY: 0.32,
  browRx: 0.14,
  browRy: 0.1,
  browTilt: 0.5,
  eyeX: 0.24,
  eyeY: 0.18,
  eyeR: 0.08,
  noseHalf: 0.13,
  noseTop: 0.02,
  noseTip: 0.16,
  muzzleX: 0.13,
  muzzleY: 0.3,
  muzzleR: 0.16,
  chinTo: 0.34,
  chinWidth: 0.06,
  ringY: 0.72,
  ringR: 0.32,
  ringWidth: 0.12,
  ringShineWidth: 0.04,
  ringShineFrom: 1.1,
  ringShineTo: 1.6,
} as const;

function lionHead(d: Decor, w: number, l: number): void {
  const { ctx, ink, shade } = d;
  const cx = w / 2;
  const cy = l * LION.centreV;
  const r = w * LION.radiusShare;
  ctx.fillStyle = tone(ink.trim, shade - TONE.dim);
  ctx.fillRect(cx - w * LION.barShare, 0, w * LION.barShare * 2, cy);
  for (let i = 0; i < LION.petals; i++) {
    const a = (i / LION.petals) * FULL_TURN;
    const base = r * LION.petalBase;
    ctx.fillStyle = tone(ink.band, shade + (i % 2 === 0 ? -TONE.dim : TONE.raised));
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(a - LION.petalSpread) * base,
      cy + Math.sin(a - LION.petalSpread) * base,
    );
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(
      cx + Math.cos(a + LION.petalSpread) * base,
      cy + Math.sin(a + LION.petalSpread) * base,
    );
    ctx.closePath();
    ctx.fill();
  }
  const face = ctx.createRadialGradient(
    cx - r * LION.faceLightX,
    cy - r * LION.faceLightY,
    r * LION.faceLightCore,
    cx,
    cy,
    r * LION.faceGlowR,
  );
  face.addColorStop(0, ink.trim.light);
  face.addColorStop(1, tone(ink.trim, shade - TONE.dim));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, r * LION.faceR, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = tone(ink.band, shade - TONE.shaded);
  ctx.lineWidth = r * LION.faceRim;
  ctx.stroke();
  ctx.fillStyle = tone(ink.band, shade - TONE.faint);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.ellipse(
      cx + side * r * LION.browX,
      cy - r * LION.browY,
      r * LION.browRx,
      r * LION.browRy,
      -side * LION.browTilt,
      0,
      FULL_TURN,
    );
  }
  ctx.fill();
  const eye = ink.studs[1] ?? ink.trim;
  ctx.fillStyle = eye.base;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(cx + side * r * LION.eyeX + r * LION.eyeR, cy - r * LION.eyeY);
    ctx.arc(cx + side * r * LION.eyeX, cy - r * LION.eyeY, r * LION.eyeR, 0, FULL_TURN);
  }
  ctx.fill();
  ctx.fillStyle = tone(ink.band, shade - TONE.deep);
  ctx.beginPath();
  ctx.moveTo(cx - r * LION.noseHalf, cy + r * LION.noseTop);
  ctx.lineTo(cx + r * LION.noseHalf, cy + r * LION.noseTop);
  ctx.lineTo(cx, cy + r * LION.noseTip);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tone(ink.trim, shade + TONE.raised);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(cx + side * r * LION.muzzleX + r * LION.muzzleR, cy + r * LION.muzzleY);
    ctx.arc(cx + side * r * LION.muzzleX, cy + r * LION.muzzleY, r * LION.muzzleR, 0, FULL_TURN);
  }
  ctx.fill();
  ctx.strokeStyle = tone(ink.band, shade - TONE.recessed);
  ctx.lineWidth = r * LION.chinWidth;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * LION.noseTip);
  ctx.lineTo(cx, cy + r * LION.chinTo);
  ctx.stroke();
  ctx.strokeStyle = tone(ink.trim, shade);
  ctx.lineWidth = r * LION.ringWidth;
  ctx.beginPath();
  ctx.arc(cx, cy + r * LION.ringY, r * LION.ringR, 0, FULL_TURN);
  ctx.stroke();
  ctx.strokeStyle = tone(ink.trim, shade + TONE.bright);
  ctx.lineWidth = r * LION.ringShineWidth;
  ctx.beginPath();
  ctx.arc(
    cx,
    cy + r * LION.ringY,
    r * LION.ringR,
    Math.PI * LION.ringShineFrom,
    Math.PI * LION.ringShineTo,
  );
  ctx.stroke();
}

// ── Wings and halo ──────────────────────────────────────────────────────

/** One row of feathers in a folded wing: how many, how long and wide, the fan's angles, its tone. */
interface FeatherTier {
  readonly count: number;
  readonly length: number;
  readonly width: number;
  readonly from: number;
  readonly to: number;
  readonly tone: number;
}

/** Long flight feathers at the back, coverts over them, small down at the root. */
const WING_TIERS: readonly FeatherTier[] = [
  { count: 7, length: 0.72, width: 0.1, from: 3.35, to: 4.45, tone: 0.45 },
  { count: 6, length: 0.48, width: 0.09, from: 3.4, to: 4.4, tone: 0.7 },
  { count: 5, length: 0.27, width: 0.08, from: 3.5, to: 4.35, tone: 0.9 },
];
/** A feather's taper along the fan, its belly, quill, and the tones its gradient runs between. */
const FEATHER = {
  taper: 0.35,
  bellyShare: 0.7,
  outlineAlpha: 0.8,
  quillAlpha: 0.7,
  quillFrom: 0.1,
  quillTo: 0.92,
  toneSpread: 0.2,
} as const;
/** The right wing beats a little behind the left. */
const WING_LAG_FRAMES = 7;
/** Where the wings join the body, in chest units. */
const WING_ROOT = { rise: 0.7, back: 0.15 } as const;

function paintWing(
  ctx: CanvasRenderingContext2D,
  ink: ChestInk,
  root: { x: number; y: number },
  side: number,
  time: number,
): void {
  const feather = ink.feather;
  if (feather === null) return;
  const flap = Math.sin(time * WING_FLAP_PER_FRAME) * WING_FLAP;
  ctx.save();
  ctx.translate(root.x, root.y);
  ctx.scale(side, 1);
  ctx.rotate(-flap);
  for (const tier of WING_TIERS) {
    for (let i = 0; i < tier.count; i++) {
      const t = i / (tier.count - 1);
      const a = tier.from + (tier.to - tier.from) * t;
      const len = tier.length * (1 - FEATHER.taper * t);
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, tone(feather, tier.tone - FEATHER.toneSpread));
      g.addColorStop(1, tone(feather, tier.tone + FEATHER.toneSpread));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * HALF, -tier.width, len, 0);
      ctx.quadraticCurveTo(len * HALF, tier.width * FEATHER.bellyShare, 0, 0);
      ctx.fill();
      ctx.strokeStyle = withAlpha(feather.dark, FEATHER.outlineAlpha);
      ctx.lineWidth = LINE.hair;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(ink.trim.base, FEATHER.quillAlpha);
      ctx.beginPath();
      ctx.moveTo(len * FEATHER.quillFrom, 0);
      ctx.lineTo(len * FEATHER.quillTo, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The halo's band, its bright inner line, its glow and the glints running round it. */
const HALO = {
  glowBlur: 12,
  bandWidth: 0.035,
  lineWidth: 0.01,
  lineRise: 0.008,
  glintReach: 0.05,
  glintAlpha: 0.95,
} as const;

function paintHalo(
  ctx: CanvasRenderingContext2D,
  ink: ChestInk,
  pose: ChestPose,
  front: boolean,
): void {
  const metal = ink.halo;
  if (metal === null) return;
  const open = Math.min(1, pose.lidAngle / LID_BEHIND_ANGLE);
  const centre = v3(0, HALO_HEIGHT + HALO_OPEN_RISE * open, 0);
  const cx = sx(centre);
  const cy = sy(centre);
  const rx = HALO_RADIUS;
  const ry = HALO_RADIUS * SB;
  const start = front ? 0 : Math.PI;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = ink.glow;
  ctx.shadowBlur = HALO.glowBlur;
  ctx.strokeStyle = front ? metal.base : metal.dark;
  ctx.lineWidth = HALO.bandWidth;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, start, start + Math.PI);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = front ? metal.light : metal.base;
  ctx.lineWidth = HALO.lineWidth;
  ctx.beginPath();
  ctx.ellipse(cx, cy - HALO.lineRise, rx, ry, 0, start, start + Math.PI);
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < HALO_GLINTS; i++) {
    const a = pose.time * HALO_SPIN_PER_FRAME + (i / HALO_GLINTS) * FULL_TURN;
    const wrapped = ((a % FULL_TURN) + FULL_TURN) % FULL_TURN;
    const inFront = wrapped < Math.PI;
    if (inFront !== front) continue;
    const gx = cx + Math.cos(a) * rx;
    const gy = cy + Math.sin(a) * ry;
    const reach = HALO.glintReach;
    const glint = ctx.createRadialGradient(gx, gy, 0, gx, gy, reach);
    glint.addColorStop(0, withAlpha(ink.glowCore, HALO.glintAlpha));
    glint.addColorStop(1, withAlpha(ink.glow, 0));
    ctx.fillStyle = glint;
    ctx.fillRect(gx - reach, gy - reach, reach * 2, reach * 2);
  }
  ctx.restore();
}

/** The seam's glow: its blur at full strength, and how its line thickens as the lid lifts. */
const SEAM_GLOW = { blur: 18, width: 0.012, liftWidth: 0.05 } as const;

function paintSeam(ctx: CanvasRenderingContext2D, ink: ChestInk, pose: ChestPose): void {
  if (pose.seamGlow <= 0 || pose.lidAngle > LID_BEHIND_ANGLE) return;
  const lift = Math.min(1, pose.lidAngle / LID_BEHIND_ANGLE);
  const a = v3(-W / 2, HB, -D / 2);
  const b = v3(-W / 2, HB, D / 2);
  const c = v3(W / 2, HB, D / 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.shadowColor = ink.glow;
  ctx.shadowBlur = SEAM_GLOW.blur * pose.seamGlow;
  ctx.strokeStyle = withAlpha(ink.glowCore, pose.seamGlow);
  ctx.lineWidth = SEAM_GLOW.width + SEAM_GLOW.liftWidth * lift;
  ctx.beginPath();
  ctx.moveTo(sx(a), sy(a));
  ctx.lineTo(sx(b), sy(b));
  ctx.lineTo(sx(c), sy(c));
  ctx.stroke();
  ctx.restore();
}

// ── Public ──────────────────────────────────────────────────────────────

/** Half the chest's reach on screen, as a share of its width. */
const HALF_SPAN_SHARE = 0.6;
const BODY_SPAN = 1.2;
const WINGED_SPAN = 2.7;
/** The pool of shadow under the chest: its reach in chest widths and its darkness. */
const GROUND_SHADOW = { reach: 0.75, alpha: 0.55 } as const;

/** Where the chest's parts land on screen for a chest `width` pixels wide standing at (cx, baseY). */
export function chestAnchors(cx: number, baseY: number, width: number): ChestAnchors {
  const at = (p: V3): { x: number; y: number } => ({
    x: cx + sx(p) * width,
    y: baseY + sy(p) * width,
  });
  const mouth = at(v3(0, HB, 0));
  const keyhole = at(v3(0, HB - PLATE_TOP - KEYHOLE_V, D / 2));
  const lidTop = at(v3(0, HB + HL, 0)).y;
  return {
    mouth: { x: mouth.x, y: mouth.y, w: width * W * CA },
    keyhole,
    lidTop,
    halfSpan: width * HALF_SPAN_SHARE,
  };
}

/**
 * How far above its base the chest reaches, in chest widths, with its lid
 * swung back by `lidAngle` (the halo, where it has one, included).
 */
export function chestReachAbove(rarity: Rarity, lidAngle: number): number {
  let top = 0;
  for (let i = 0; i <= LID_STRIPS; i++) {
    for (const x of [-W / 2, W / 2]) {
      top = Math.max(top, -sy(lidPoint((Math.PI * i) / LID_STRIPS, lidAngle, x)));
    }
  }
  if (STYLE[rarity].halo) {
    const open = Math.min(1, lidAngle / LID_BEHIND_ANGLE);
    const halo = v3(0, HALO_HEIGHT + HALO_OPEN_RISE * open, 0);
    top = Math.max(top, -sy(halo) + HALO_RADIUS * SB);
  }
  return top;
}

/** How wide the chest stands on screen, in chest widths, wings included. */
export function chestSpan(rarity: Rarity): number {
  return STYLE[rarity].wings ? WINGED_SPAN : BODY_SPAN;
}

/** How far below its base the chest's front corners reach, in chest widths. */
export const CHEST_REACH_BELOW = D * HALF * CA * SB + W * HALF * SA * SB;

/** Paints the chest `width` pixels wide with the middle of its footprint at (cx, baseY). */
export function paintRewardChest(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  width: number,
  pose: ChestPose,
  ink: ChestInk,
): void {
  const style = STYLE[pose.rarity];
  const decor: Decor = { ctx, ink, style, pose, shade: 1 };
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(width, width);
  ctx.lineJoin = 'round';

  const reach = W * GROUND_SHADOW.reach;
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  shadow.addColorStop(0, withAlpha(ink.groundShadow, GROUND_SHADOW.alpha));
  shadow.addColorStop(1, withAlpha(ink.groundShadow, 0));
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(0, 0, reach, reach * SB, 0, 0, FULL_TURN);
  ctx.fill();

  if (style.halo) paintHalo(ctx, ink, pose, false);
  if (style.wings) {
    const left = v3(-W / 2, HB * WING_ROOT.rise, -D * WING_ROOT.back);
    const right = v3(W / 2, HB * WING_ROOT.rise, -D * WING_ROOT.back);
    paintWing(ctx, ink, { x: sx(left), y: sy(left) }, 1, pose.time);
    paintWing(ctx, ink, { x: sx(right), y: sy(right) }, -1, pose.time + WING_LAG_FRAMES);
  }

  const lidBehind = pose.lidAngle >= LID_BEHIND_ANGLE;
  if (lidBehind) {
    paintHasp(decor);
    paintLid(decor);
  }
  if (pose.lidAngle > 0) paintInterior(decor);
  paintLeft(decor);
  paintFront(decor);
  if (!lidBehind) {
    paintLid(decor);
    paintHasp(decor);
  }
  paintSeam(ctx, ink, pose);
  if (style.halo) paintHalo(ctx, ink, pose, true);
  ctx.restore();
}
