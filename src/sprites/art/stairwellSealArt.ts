/**
 * The locked seal over a floor-exit stairwell, seen from above like the
 * stairwell under it, and every pose it goes through as its key opens it.
 *
 * Each place's seal is built of that place's own material: the cellars'
 * iron-strapped oak slab, the service level's riveted steel blast hatch in
 * worn hazard paint, and the town square's bronze grate bearing Taloncrest's
 * hawk, through which the top steps show dark. Every seal is fastened by one
 * large golden padlock at its centre, and the oak and the steel are bound
 * with chains crossed over them. The gold is `worldPalette.stairwellSeal`'s,
 * because gold on the lock is what makes the player think "key".
 *
 * The cover itself is a solid modelled and drawn at each angle it opens
 * through, by `stairwellCoverArt.ts`; the padlock and chains lie on its top.
 *
 * Positions are fractions of the stairwell's footprint. A frame reaches past
 * the footprint by {@link SEAL_MARGIN} on every side, so chains can slide off
 * the edges and a cover can stand up and swing back over the paving.
 */

import { worldPalette } from '../../ui/theme/worldInk';
import { withAlpha } from '../../ui/theme/color';
import type { StairwellStyleId } from './stairwellArt';
import {
  coverTopLift,
  paintCoverModel,
  traceCoverRunes,
  type CoverFrame,
} from './stairwellCoverArt';

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly [number, number, number];

interface Pt {
  readonly x: number;
  readonly y: number;
}

/**
 * The poses the padlock and chains go through as the key opens the seal, in
 * sheet order: the turn (a quarter, half way, home), the lit runes, the
 * burst, and the chains going. The locked pose, `sealed`, is a sheet of its
 * own: it is the only one a floor shows until a key arrives.
 */
export const SEAL_POSE_FRAMES = [
  'turnQuarter',
  'turnHalf',
  'turnFull',
  'runes',
  'burst',
  'chainsSlack',
  'chainsFalling',
] as const;

/** The cover's drawn angles, in the order it opens through them. */
export const SEAL_COVER_FRAMES = [
  'cover1',
  'cover2',
  'cover3',
  'cover4',
  'cover5',
  'cover6',
  'cover7',
  'cover8',
] as const;

export const SEAL_OPEN_FRAME_ORDER = [...SEAL_POSE_FRAMES, ...SEAL_COVER_FRAMES] as const;

export type SealOpenFrameId = (typeof SEAL_OPEN_FRAME_ORDER)[number];

/** Every pose a seal is painted in. */
export type SealFrameId = 'sealed' | SealOpenFrameId;

/**
 * Where an opening pose sits in its sheet: the padlock and chain poses on
 * one row, the cover's angles on another, so each row is one paced paint step.
 */
export function sealOpenCell(frame: SealOpenFrameId): {
  readonly row: 'open' | 'cover';
  readonly column: number;
} {
  const pose = SEAL_POSE_FRAMES.findIndex((candidate) => candidate === frame);
  if (pose >= 0) return { row: 'open', column: pose };
  return { row: 'cover', column: SEAL_COVER_FRAMES.findIndex((candidate) => candidate === frame) };
}

type CoverFrameId = (typeof SEAL_COVER_FRAMES)[number];

function isCoverFrame(frame: SealFrameId): frame is CoverFrameId {
  return SEAL_COVER_FRAMES.some((cover) => cover === frame);
}

/** How far open the cover is in a frame: 0 shut, 1 at rest open. */
function coverOpening(frame: SealFrameId): number {
  if (!isCoverFrame(frame)) return 0;
  return (SEAL_COVER_FRAMES.indexOf(frame) + 1) / SEAL_COVER_FRAMES.length;
}

/**
 * How far a frame reaches past the footprint, as fractions of its side. More
 * room above than elsewhere, because a hatch or a slab standing up rises up
 * the screen.
 */
export const SEAL_MARGIN = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.25 } as const;

/** The padlock's keyhole on the floor-level footprint, before the cover lifts it. */
const KEYHOLE: Pt = { x: 0.5, y: 0.58 };

/** The padlock's centre on the floor-level footprint, before the cover lifts it. */
const PADLOCK_CENTER: Pt = { x: 0.5, y: 0.56 };

/** Where a seal's padlock sits as drawn, lifted onto its shut cover's top face. */
export interface SealLockPoints {
  /** Where the key goes in. */
  readonly keyhole: Pt;
  /** Where the padlock's glint pulses, and where it bursts from. */
  readonly padlock: Pt;
}

function lockPointsOf(style: StairwellStyleId): SealLockPoints {
  const lift = coverTopLift(style);
  return {
    keyhole: { x: KEYHOLE.x, y: KEYHOLE.y - lift },
    padlock: { x: PADLOCK_CENTER.x, y: PADLOCK_CENTER.y - lift },
  };
}

const SEAL_LOCK_POINTS = {
  cellars: lockPointsOf('cellars'),
  service_level: lockPointsOf('service_level'),
  street: lockPointsOf('street'),
} as const satisfies Record<StairwellStyleId, SealLockPoints>;

/** The padlock and its keyhole of a style's seal as drawn, in footprint fractions. */
export function sealLockPoints(style: StairwellStyleId): SealLockPoints {
  return SEAL_LOCK_POINTS[style];
}

// ── Geometry, in footprint fractions ─────────────────────────────────────────

const PADLOCK = {
  bodyW: 0.2,
  bodyH: 0.16,
  radius: 0.035,
  shackleW: 0.13,
  shackleH: 0.1,
  shackleThick: 0.03,
  keyholeR: 0.021,
  keyholeSlotLength: 0.045,
  keyholeSlotWidth: 0.016,
  /** The slot widens toward its foot by this share of its top width. */
  keyholeSlotFlare: 0.75,
  /** The round of the keyhole sits this share of its radius above the hole's centre. */
  keyholeRoundRise: 0.4,
  /** The bevel round the keyhole, as a share of the hole's radius. */
  keyholeBevel: 1.35,
  keyholeBevelAlpha: 0.9,
  outline: 0.008,
  /** The shackle's lit stripe, as a share of its thickness. */
  shackleShine: 0.4,
  /** The body's gold, lit from the upper left: where each tone sits along the diagonal. */
  bodyLightStop: 0.25,
  bodyBaseStop: 0.7,
  /** The engraved border inset on the body's face, as shares of the body. */
  engraving: { w: 0.84, h: 0.8, radius: 0.6, stroke: 0.7, alpha: 0.8 },
  /** The polished catch-light along the body's top, as shares of the body. */
  shine: { x: -0.38, y: -0.44, w: 0.5, h: 0.08, alpha: 0.55 },
  /** The four rivets on the body's face, at these shares of its half-size. */
  rivets: [
    [-0.36, -0.32],
    [0.36, -0.32],
    [-0.36, 0.32],
    [0.36, 0.32],
  ],
  rivetRadius: 0.011,
  rivetGlint: 0.005,
  rivetGlintOffset: 0.003,
} as const;

/** How far the shackle has lifted, and how far the body has rocked, at each point of the turn. */
const TURN_POSES = {
  sealed: { lift: 0, rockDeg: 0 },
  turnQuarter: { lift: 0, rockDeg: -4 },
  turnHalf: { lift: 0.012, rockDeg: 3.5 },
  turnFull: { lift: 0.034, rockDeg: 0 },
} as const satisfies Partial<Record<SealFrameId, { lift: number; rockDeg: number }>>;

/** Iron staples the chains are run through, set in the rim just outside the cover's corners. */
const CHAIN_ANCHORS: readonly Pt[] = [
  { x: 0.055, y: 0.085 },
  { x: 0.945, y: 0.085 },
  { x: 0.055, y: 0.955 },
  { x: 0.945, y: 0.955 },
];
/** Where each chain is threaded through the shackle, in anchor order. */
const CHAIN_SHACKLE_ENDS: readonly Pt[] = [
  { x: 0.465, y: 0.43 },
  { x: 0.535, y: 0.43 },
  { x: 0.465, y: 0.445 },
  { x: 0.535, y: 0.445 },
];
/** Where each chain comes to rest after slithering off the cover, in anchor order. */
const CHAIN_HEAPS: readonly Pt[] = [
  { x: -0.1, y: -0.02 },
  { x: 1.1, y: -0.02 },
  { x: -0.1, y: 1.1 },
  { x: 1.1, y: 1.1 },
];
const LINK_LENGTH = 0.05;
/** One chain link's shape, as shares of the link's length. */
const LINK = {
  flatRx: 0.6,
  flatRy: 0.34,
  stroke: 0.3,
  edgeLength: 0.62,
  edgeWidth: 0.28,
  /** The link's shadow on what it lies on, toward the lower right. */
  shadowOffset: { x: 0.06, y: 0.1 },
  shadowAlpha: 0.6,
  /** The arc of a flat link catching the key light, in turns of a half circle. */
  highlightFrom: 1.05,
  highlightTo: 1.65,
  highlightStroke: 0.45,
  edgeShade: 0.85,
  edgeHighlight: { x: -0.35, y: -0.3, w: 0.7, h: 0.25, alpha: 0.8 },
} as const;
/** How finely a chain's path is sampled before links are spaced along it. */
const LINK_PATH_SAMPLES = 200;
/** A taut chain still dips a little between its staple and the lock. */
const TAUT_SAG = 0.025;
/** How far a broken chain's end falls back from the lock once the shackle has gone. */
const BURST_RETREAT = 0.06;
const SLACK_RETREAT = 0.2;
const SLACK_WAVE = 0.07;
/** A falling chain is already this share of the way off the cover. */
const FALLING_LIP_SHARE = 0.35;
const HEAP_COIL_RADIUS = 0.045;
const HEAP_COIL_TURNS = 1.6;
/** The coil tightens toward its middle by this share of its radius. */
const HEAP_COIL_TIGHTEN = 0.6;
/** A coil lying on the floor is seen at a slant, squashed top to bottom. */
const HEAP_COIL_SQUASH = 0.7;
const HEAP_LINKS = 9;
/** An iron staple in the rim, as shares of its own radius. */
const STAPLE = {
  radius: 0.022,
  shadowOffset: { x: 0.2, y: 0.3 },
  shadowGrowth: 1.1,
  shadowAlpha: 0.4,
  ring: 0.55,
  ringStroke: 0.3,
} as const;

const RUNE_GLOW_WIDTH = 0.022;
const RUNE_CORE_WIDTH = 0.007;
const RUNE_GLOW_BLUR = 0.05;
const RUNE_GLOW_ALPHA = 0.7;

// ── Materials ────────────────────────────────────────────────────────────────

const IRON: Rgb = [46, 44, 47];
const IRON_LIGHT: Rgb = [118, 116, 122];
const CHAIN_IRON: Rgb = [52, 50, 56];
const CHAIN_LIGHT: Rgb = [170, 168, 178];
const CHAIN_SHADE: Rgb = [20, 18, 22];

function rgba(color: Rgb, light = 1, alpha = 1): string {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * light)));
  return `rgba(${channel(color[0])},${channel(color[1])},${channel(color[2])},${alpha})`;
}

function degrees(deg: number): number {
  return (deg * Math.PI) / 180;
}

function at(f: CoverFrame, p: Pt): Pt {
  return { x: f.ox + p.x * f.s, y: f.oy + p.y * f.s };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** How far the grate's hasps have sprung apart once the padlock is gone, as a footprint fraction. */
const HASP_SPREAD = {
  sealed: 0,
  turnQuarter: 0,
  turnHalf: 0,
  turnFull: 0,
  runes: 0,
  burst: 0.01,
  chainsSlack: 0.02,
  chainsFalling: 0.03,
  cover1: 0.03,
  cover2: 0.03,
  cover3: 0.03,
  cover4: 0.03,
  cover5: 0.03,
  cover6: 0.03,
  cover7: 0.03,
  cover8: 0.03,
} as const satisfies Record<SealFrameId, number>;

// ── Chains ───────────────────────────────────────────────────────────────────

function quadraticAt(a: Pt, control: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

/** Points spaced one link apart along a path given as a sampler over 0..1. */
function linkPoints(sample: (t: number) => Pt, samples = LINK_PATH_SAMPLES): Pt[] {
  const points: Pt[] = [sample(0)];
  let last = points[0];
  for (let i = 1; i <= samples; i++) {
    const p = sample(i / samples);
    if (Math.hypot(p.x - last.x, p.y - last.y) >= LINK_LENGTH) {
      points.push(p);
      last = p;
    }
  }
  return points;
}

/** A chain of links laid along `points`, alternating flat-on and edge-on. */
function paintChain(ctx: Ctx, f: CoverFrame, points: readonly Pt[], firstLink = 0): void {
  const linkPx = LINK_LENGTH * f.s;
  for (let i = 0; i < points.length - 1; i++) {
    const a = at(f, points[i]);
    const b = at(f, points[i + 1]);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    if ((i + firstLink) % 2 === 0) {
      ctx.beginPath();
      ctx.ellipse(
        linkPx * LINK.shadowOffset.x,
        linkPx * LINK.shadowOffset.y,
        linkPx * LINK.flatRx,
        linkPx * LINK.flatRy,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = rgba(CHAIN_SHADE, 1, LINK.shadowAlpha);
      ctx.lineWidth = linkPx * LINK.stroke;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, linkPx * LINK.flatRx, linkPx * LINK.flatRy, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(CHAIN_IRON);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        linkPx * LINK.flatRx,
        linkPx * LINK.flatRy,
        0,
        Math.PI * LINK.highlightFrom,
        Math.PI * LINK.highlightTo,
      );
      ctx.strokeStyle = rgba(CHAIN_LIGHT);
      ctx.lineWidth = linkPx * LINK.stroke * LINK.highlightStroke;
      ctx.stroke();
    } else {
      const length = linkPx * LINK.edgeLength * 2;
      const width = linkPx * LINK.edgeWidth * 2;
      const shine = LINK.edgeHighlight;
      roundRect(ctx, -length / 2, -width / 2, length, width, width / 2);
      ctx.fillStyle = rgba(CHAIN_IRON, LINK.edgeShade);
      ctx.fill();
      ctx.fillStyle = rgba(CHAIN_LIGHT, 1, shine.alpha);
      ctx.fillRect(length * shine.x, width * shine.y, length * shine.w, width * shine.h);
    }
    ctx.restore();
  }
}

function paintStaple(ctx: Ctx, f: CoverFrame, anchor: Pt): void {
  const p = at(f, anchor);
  const r = STAPLE.radius * f.s;
  disc(
    ctx,
    p.x + r * STAPLE.shadowOffset.x,
    p.y + r * STAPLE.shadowOffset.y,
    r * STAPLE.shadowGrowth,
    withAlpha(worldPalette.shade, STAPLE.shadowAlpha),
  );
  disc(ctx, p.x, p.y, r, rgba(IRON));
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * STAPLE.ring, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(IRON_LIGHT);
  ctx.lineWidth = r * STAPLE.ringStroke;
  ctx.stroke();
}

type ChainPose = 'taut' | 'broken' | 'slack' | 'falling' | 'heaped';

function chainPose(frame: SealFrameId): ChainPose {
  switch (frame) {
    case 'sealed':
    case 'turnQuarter':
    case 'turnHalf':
    case 'turnFull':
    case 'runes':
      return 'taut';
    case 'burst':
      return 'broken';
    case 'chainsSlack':
      return 'slack';
    case 'chainsFalling':
      return 'falling';
    case 'cover1':
    case 'cover2':
    case 'cover3':
    case 'cover4':
    case 'cover5':
    case 'cover6':
    case 'cover7':
    case 'cover8':
      return 'heaped';
    default: {
      const unhandled: never = frame;
      return unhandled;
    }
  }
}

function toward(from: Pt, to: Pt, share: number): Pt {
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
}

function chainPath(index: number, pose: ChainPose): Pt[] {
  const anchor = CHAIN_ANCHORS[index];
  const end = CHAIN_SHACKLE_ENDS[index];
  const heap = CHAIN_HEAPS[index];
  const length = Math.hypot(end.x - anchor.x, end.y - anchor.y);
  switch (pose) {
    case 'taut': {
      const control = { x: (anchor.x + end.x) / 2, y: (anchor.y + end.y) / 2 + TAUT_SAG };
      return linkPoints((t) => quadraticAt(anchor, control, end, t));
    }
    case 'broken': {
      const loose = toward(end, anchor, BURST_RETREAT / length);
      const control = { x: (anchor.x + loose.x) / 2, y: (anchor.y + loose.y) / 2 + TAUT_SAG * 2 };
      return linkPoints((t) => quadraticAt(anchor, control, loose, t));
    }
    case 'slack': {
      const loose = toward(end, anchor, SLACK_RETREAT / length);
      const nx = -(loose.y - anchor.y) / length;
      const ny = (loose.x - anchor.x) / length;
      return linkPoints((t) => {
        const base = toward(anchor, loose, t);
        const wave = Math.sin(t * Math.PI * 2) * SLACK_WAVE * Math.sin(t * Math.PI);
        return { x: base.x + nx * wave, y: base.y + ny * wave };
      });
    }
    case 'falling': {
      // Half off the cover already: from the staple, round over the edge and down onto the floor.
      const lip = toward(anchor, end, FALLING_LIP_SHARE);
      return linkPoints((t) => quadraticAt(lip, anchor, heap, t));
    }
    case 'heaped': {
      const lead = linkPoints((t) => toward(anchor, heap, t));
      const coil = linkPoints((t) => {
        const angle = t * HEAP_COIL_TURNS * Math.PI * 2;
        const radius = HEAP_COIL_RADIUS * (1 - t * HEAP_COIL_TIGHTEN);
        return {
          x: heap.x + Math.cos(angle) * radius,
          y: heap.y + Math.sin(angle) * radius * HEAP_COIL_SQUASH,
        };
      });
      return [...lead, ...coil.slice(0, HEAP_LINKS)];
    }
    default: {
      const unhandled: never = pose;
      return unhandled;
    }
  }
}

function paintChains(ctx: Ctx, f: CoverFrame, frame: SealFrameId): void {
  const pose = chainPose(frame);
  CHAIN_ANCHORS.forEach((anchor, index) => {
    paintChain(ctx, f, chainPath(index, pose), index);
    paintStaple(ctx, f, anchor);
  });
}

function hasChains(style: StairwellStyleId): boolean {
  switch (style) {
    case 'cellars':
    case 'service_level':
      return true;
    case 'street':
      return false;
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}

// ── The padlock ─────────────────────────────────────────────────────────────

const SEAL_INK = worldPalette.stairwellSeal;

function paintPadlock(ctx: Ctx, f: CoverFrame, lift: number, rockDeg: number): void {
  const center = at(f, PADLOCK_CENTER);
  const s = f.s;
  const bodyW = PADLOCK.bodyW * s;
  const bodyH = PADLOCK.bodyH * s;
  const outline = PADLOCK.outline * s;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(degrees(rockDeg));

  // Shackle: a thick gold U whose legs run down into the body.
  const shackleW = PADLOCK.shackleW * s;
  const shackleH = PADLOCK.shackleH * s;
  const thick = PADLOCK.shackleThick * s;
  const legTop = -bodyH / 2 - shackleH + shackleW / 2 - lift * s;
  const legFoot = -bodyH / 2 + thick;
  const traceShackle = (): void => {
    ctx.beginPath();
    ctx.moveTo(-shackleW / 2, legFoot);
    ctx.lineTo(-shackleW / 2, legTop);
    ctx.arc(0, legTop, shackleW / 2, Math.PI, 0);
    ctx.lineTo(shackleW / 2, legFoot - (lift > 0 ? lift * s : 0));
  };
  ctx.lineCap = 'round';
  traceShackle();
  ctx.strokeStyle = SEAL_INK.padlockOutline;
  ctx.lineWidth = thick + outline * 2;
  ctx.stroke();
  traceShackle();
  ctx.strokeStyle = SEAL_INK.padlockShade;
  ctx.lineWidth = thick;
  ctx.stroke();
  traceShackle();
  ctx.strokeStyle = SEAL_INK.padlockLight;
  ctx.lineWidth = thick * PADLOCK.shackleShine;
  ctx.stroke();

  // Body: lit gold from the upper left down to its shade.
  roundRect(
    ctx,
    -bodyW / 2 - outline,
    -bodyH / 2 - outline,
    bodyW + outline * 2,
    bodyH + outline * 2,
    PADLOCK.radius * s,
  );
  ctx.fillStyle = SEAL_INK.padlockOutline;
  ctx.fill();
  const body = ctx.createLinearGradient(-bodyW / 2, -bodyH / 2, bodyW / 2, bodyH / 2);
  body.addColorStop(0, SEAL_INK.padlockHighlight);
  body.addColorStop(PADLOCK.bodyLightStop, SEAL_INK.padlockLight);
  body.addColorStop(PADLOCK.bodyBaseStop, SEAL_INK.padlockBase);
  body.addColorStop(1, SEAL_INK.padlockShade);
  roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, PADLOCK.radius * s);
  ctx.fillStyle = body;
  ctx.fill();
  const engraving = PADLOCK.engraving;
  roundRect(
    ctx,
    (-bodyW * engraving.w) / 2,
    (-bodyH * engraving.h) / 2,
    bodyW * engraving.w,
    bodyH * engraving.h,
    PADLOCK.radius * s * engraving.radius,
  );
  ctx.strokeStyle = withAlpha(SEAL_INK.padlockShade, engraving.alpha);
  ctx.lineWidth = outline * engraving.stroke;
  ctx.stroke();
  const shine = PADLOCK.shine;
  ctx.fillStyle = withAlpha(SEAL_INK.padlockHighlight, shine.alpha);
  ctx.fillRect(bodyW * shine.x, bodyH * shine.y, bodyW * shine.w, bodyH * shine.h);

  const glintOffset = s * PADLOCK.rivetGlintOffset;
  for (const [rx, ry] of PADLOCK.rivets) {
    disc(ctx, rx * bodyW, ry * bodyH, s * PADLOCK.rivetRadius, SEAL_INK.padlockShade);
    disc(
      ctx,
      rx * bodyW - glintOffset,
      ry * bodyH - glintOffset,
      s * PADLOCK.rivetGlint,
      SEAL_INK.padlockHighlight,
    );
  }

  // The empty keyhole.
  const keyhole = {
    x: (KEYHOLE.x - PADLOCK_CENTER.x) * s,
    y: (KEYHOLE.y - PADLOCK_CENTER.y) * s,
  };
  const holeR = PADLOCK.keyholeR * s;
  const roundY = keyhole.y - holeR * PADLOCK.keyholeRoundRise;
  const slotHalf = (PADLOCK.keyholeSlotWidth * s) / 2;
  const slotFootHalf = PADLOCK.keyholeSlotWidth * s * PADLOCK.keyholeSlotFlare;
  const slotFootY = keyhole.y + PADLOCK.keyholeSlotLength * s;
  disc(
    ctx,
    keyhole.x,
    roundY,
    holeR * PADLOCK.keyholeBevel,
    withAlpha(SEAL_INK.padlockShade, PADLOCK.keyholeBevelAlpha),
  );
  disc(ctx, keyhole.x, roundY, holeR, SEAL_INK.keyhole);
  ctx.beginPath();
  ctx.moveTo(keyhole.x - slotHalf, roundY);
  ctx.lineTo(keyhole.x + slotHalf, roundY);
  ctx.lineTo(keyhole.x + slotFootHalf, slotFootY);
  ctx.lineTo(keyhole.x - slotFootHalf, slotFootY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Runes ───────────────────────────────────────────────────────────────────

/**
 * The lines gold light races along as the key turns: the shut cover's own,
 * placed by the cover model, and the chains lying on it in `onCover`.
 */
function traceRunes(ctx: Ctx, f: CoverFrame, onCover: CoverFrame, style: StairwellStyleId): void {
  ctx.beginPath();
  traceCoverRunes(ctx, f, style);
  if (!hasChains(style)) return;
  for (const index of CHAIN_ANCHORS.keys()) {
    chainPath(index, 'taut').forEach((p, step) => {
      const q = at(onCover, p);
      if (step === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
  }
}

function paintRunes(ctx: Ctx, f: CoverFrame, onCover: CoverFrame, style: StairwellStyleId): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  traceRunes(ctx, f, onCover, style);
  ctx.shadowColor = SEAL_INK.rune;
  ctx.shadowBlur = RUNE_GLOW_BLUR * f.s;
  ctx.strokeStyle = withAlpha(SEAL_INK.rune, RUNE_GLOW_ALPHA);
  ctx.lineWidth = RUNE_GLOW_WIDTH * f.s;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = SEAL_INK.runeCore;
  ctx.lineWidth = RUNE_CORE_WIDTH * f.s;
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints one pose of a stairwell's seal. (`originX`, `originY`) is the
 * footprint's top-left corner and `size` its side in pixels; the seal reaches
 * past it by {@link SEAL_MARGIN}. The `runes` frame holds only the lit
 * lines, to lay over the sealed pose as the light spreads.
 */
export function paintStairwellSeal(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  style: StairwellStyleId,
  frame: SealFrameId,
): void {
  const f: CoverFrame = { ox: originX, oy: originY, s: size };
  // What lies on the shut cover sits on its top face, which stands above the floor.
  const onCover: CoverFrame = { ox: f.ox, oy: f.oy - coverTopLift(style) * f.s, s: f.s };
  if (frame === 'runes') {
    paintRunes(ctx, f, onCover, style);
    return;
  }
  const chained = hasChains(style);
  const chainsUnder = chainPose(frame) === 'heaped';
  if (chained && chainsUnder) paintChains(ctx, f, frame);
  paintCoverModel(ctx, f, style, coverOpening(frame), HASP_SPREAD[frame]);
  if (chained && !chainsUnder) paintChains(ctx, onCover, frame);
  if (
    frame === 'sealed' ||
    frame === 'turnQuarter' ||
    frame === 'turnHalf' ||
    frame === 'turnFull'
  ) {
    const turn = TURN_POSES[frame];
    paintPadlock(ctx, onCover, turn.lift, turn.rockDeg);
  }
}
