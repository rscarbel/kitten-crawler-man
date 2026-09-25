/**
 * Shared vocabulary for Briar Hollow's painted props: the frame contract every
 * prop painter is written against, the village palette, and the handful of
 * material painters (planks, fieldstone, wattle, logs, brass, the briar knot)
 * that make forty-odd props read as one village rather than forty drawings.
 *
 * The village is a ratkin settlement, and three choices carry that everywhere:
 * everything is **low** (a ratkin stands about two thirds of Carl's height, so
 * a table top sits well under a tile above the floor), everything is **dark,
 * oiled wood on grey-green fieldstone** (one step darker and warmer than the
 * town's plaster and timber, so the two never read as the same place), and the
 * metalwork is **brass** rather than iron. Light comes from the upper left, as
 * it does for every prop in the repo.
 *
 * Painters are pure canvas calls with no filesystem, so the game (at floor
 * load, through `villageSheets.ts`) and the offline review bake paint the same
 * pixels.
 */

import { VILLAGE_PROPS, type VillagePropId } from '../../map/overworld/briarHollowLayout';
import { mulberry32, range, type Rng } from '../person/rng';
import { fillSoftEllipse } from './softShade';

export type Ctx = CanvasRenderingContext2D;

/**
 * Source pixels per game tile. Twice `TILE_SIZE`, so a prop is 1:1 on a
 * Retina display — the village is dense small furniture, and at 32 px a
 * tile the dishes, shutters and knots all dissolve into mush.
 */
export const VILLAGE_TILE_SCALE = 64;

/**
 * Where one prop is painted.
 *
 * The anchor is the footprint's **bottom-left** tile — not the north-west tile
 * the map keys the prop on — because a prop is Y-sorted on its anchor's foot
 * and a two-tile-deep bed must sort on its foot end, not its head. The art
 * extends right across `footprintW` tiles and up across `footprintH` tiles plus
 * whatever headroom its sheet allows for height.
 */
export interface VillagePropFrame {
  /** Left edge of the footprint's bottom-left tile. */
  readonly originX: number;
  /** Top edge of the footprint's bottom-left tile. */
  readonly originY: number;
  readonly tileScale: number;
  readonly footprintW: number;
  readonly footprintH: number;
}

/**
 * The footprint's rectangle in absolute pixels. Ink must stay inside
 * `left..right` — horizontally past the blocked tiles is ground a crawler can
 * stand on while drawn behind the prop. Above `top` is fine: that is height.
 */
export interface FootprintBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly centreX: number;
}

export function footprintBox(frame: VillagePropFrame): FootprintBox {
  const ts = frame.tileScale;
  const left = frame.originX;
  const bottom = frame.originY + ts;
  const width = frame.footprintW * ts;
  const height = frame.footprintH * ts;
  return {
    left,
    right: left + width,
    top: bottom - height,
    bottom,
    width,
    height,
    centreX: left + width / 2,
  };
}

/** Paints one variant of a prop. `rng` is seeded per variant and per floor. */
export type VillagePropPainter = (
  ctx: Ctx,
  frame: VillagePropFrame,
  variant: number,
  rng: Rng,
) => void;

export interface VillagePropArt {
  /** How many variants the prop has — the frame count of its sheet row. */
  readonly variants: number;
  readonly paint: VillagePropPainter;
}

/** Every prop that is flat dressing, baked into the ground rather than standing up. */
export type VillageDecalPropId = {
  [K in VillagePropId]: (typeof VILLAGE_PROPS)[K]['kind'] extends 'decal' ? K : never;
}[VillagePropId];

/** Every prop that stands up and is painted from a sheet; decals are baked flat instead. */
export type VillageStandingPropId = Exclude<VillagePropId, VillageDecalPropId>;

export function isVillageStandingProp(prop: VillagePropId): prop is VillageStandingPropId {
  return VILLAGE_PROPS[prop].kind !== 'decal';
}

export function isVillageDecalProp(prop: VillagePropId): prop is VillageDecalPropId {
  return VILLAGE_PROPS[prop].kind === 'decal';
}

// ── Palette ───────────────────────────────────────────────────────────────────

/** Dark oiled walnut and umber: every plank, post and board in the village. */
export const WOOD = {
  deep: '#2a1a10',
  dark: '#3e2818',
  body: '#5a3a22',
  mid: '#6e4a2c',
  light: '#8a6038',
  highlight: '#a87c4c',
  /** Worn and tail-polished: the pale sheen where bodies touch the wood. */
  worn: '#b89266',
} as const;

/** Unbarked and barked log colours: bark, the cut face, the growth rings. */
export const LOG = {
  bark: '#4a3424',
  barkDark: '#2f2118',
  barkLight: '#6a4c32',
  cut: '#c49a64',
  cutDark: '#9a7248',
  ring: '#8a6440',
} as const;

/** Cool grey-green fieldstone, the footing course under every wall. */
export const STONE = {
  deep: '#343a34',
  dark: '#4a524a',
  body: '#687068',
  light: '#8a928a',
  highlight: '#a8aea4',
} as const;

export const MOSS = {
  dark: '#3c4a22',
  body: '#56662e',
  light: '#74843c',
} as const;

/** Lantern frames, fittings, hoops and the bell. */
export const BRASS = {
  dark: '#6a4a18',
  body: '#a07a2c',
  light: '#d2aa50',
  glint: '#f4dc92',
} as const;

/** Iron is rare in the village and always darkened: blades, anvil, hooks. */
export const IRON = {
  dark: '#26282c',
  body: '#44484e',
  light: '#6e747c',
  glint: '#aab0b8',
} as const;

/** Household accent cloth: madder red, woad blue, weld yellow. */
export const CLOTH = {
  madder: { dark: '#6a2420', body: '#9a3a2e', light: '#c05a44' },
  woad: { dark: '#243a58', body: '#34547a', light: '#5a7aa0' },
  weld: { dark: '#7a6420', body: '#b0923a', light: '#d8bc62' },
  linen: { dark: '#8a7c62', body: '#c4b494', light: '#e2d6ba' },
} as const;

export type ClothColour = keyof typeof CLOTH;

/** Warm light from a flame or a lantern's glass. */
export const FLAME = {
  core: '#fff0b8',
  mid: '#ffb048',
  edge: '#d4581c',
  ember: '#b83a14',
} as const;

/** The darkest line in a prop: the outline and the shadow in a joint. */
export const INK = '#1c120a';

export const CONTACT_SHADOW = '#000000';

// ── Seeded helpers ────────────────────────────────────────────────────────────

/** A fresh stream for a sub-part of a painter, so one extra draw cannot reshuffle the rest. */
export function forkRng(rng: Rng): Rng {
  return mulberry32(Math.floor(rng() * UINT32_RANGE));
}
const UINT32_RANGE = 0x100000000;

/** A small signed jitter, in pixels. */
export function jitter(rng: Rng, amount: number): number {
  return range(rng, -amount, amount);
}

// ── Primitives ────────────────────────────────────────────────────────────────

const CONTACT_SHADOW_ALPHA = 0.38;
const CONTACT_SHADOW_CORE = 0.45;

/**
 * A soft pool of shadow under a prop. Keep `radiusX` inside the footprint —
 * the soft edge is allowed to fade to nothing at the footprint's side, never
 * past it.
 */
export function drawContactShadow(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  alpha = CONTACT_SHADOW_ALPHA,
): void {
  fillSoftEllipse(
    ctx,
    centreX,
    centreY,
    radiusX,
    radiusY,
    CONTACT_SHADOW,
    alpha,
    0,
    CONTACT_SHADOW_CORE,
  );
}

/** A filled rounded rectangle. */
export function fillRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  ctx.fill();
}

/** A rounded rectangle's outline. */
export function strokeRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
  ctx.stroke();
}

export type PlankDirection = 'horizontal' | 'vertical';

export interface PlankOptions {
  readonly direction: PlankDirection;
  /** Width of one board across its grain, in pixels. */
  readonly boardPx: number;
  readonly base?: string;
  readonly seam?: string;
  readonly grain?: string;
  readonly highlight?: string;
  /** Chance a board gets a nail pair at each end. */
  readonly nailChance?: number;
}

const PLANK_TONE_JITTER = 0.1;
const PLANK_GRAIN_LINES = 2;
const PLANK_GRAIN_ALPHA = 0.28;
const PLANK_SEAM_WIDTH_FRACTION = 0.09;
const PLANK_HIGHLIGHT_ALPHA = 0.22;
const PLANK_NAIL_RADIUS_FRACTION = 0.07;
const PLANK_NAIL_INSET_FRACTION = 0.3;
const DEFAULT_NAIL_CHANCE = 0.5;
/** Grain lines run within this band across a board, clear of its seams. */
const PLANK_GRAIN_BAND_START = 0.25;
const PLANK_GRAIN_BAND_END = 0.8;
const PLANK_GRAIN_WOBBLE = 0.12;

/**
 * A panel of boards: tone varies board to board, a dark seam between each, two
 * faint grain lines along the board, a lit top edge, and a nail pair at the
 * ends of some boards.
 */
export function drawPlanks(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
  options: PlankOptions,
): void {
  const horizontal = options.direction === 'horizontal';
  const across = horizontal ? h : w;
  const along = horizontal ? w : h;
  const boards = Math.max(1, Math.round(across / options.boardPx));
  const board = across / boards;
  const base = options.base ?? WOOD.body;
  const seamWidth = Math.max(1, board * PLANK_SEAM_WIDTH_FRACTION);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    for (let index = 0; index < boards; index++) {
      const start = index * board;
      const tone = jitter(rng, PLANK_TONE_JITTER);
      const [bx, by, bw, bh] = horizontal
        ? [x, y + start, along, board]
        : [x + start, y, board, along];
      ctx.fillStyle = tone > 0 ? `rgba(255,236,200,${tone})` : `rgba(0,0,0,${-tone})`;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = PLANK_GRAIN_ALPHA;
      ctx.strokeStyle = options.grain ?? WOOD.dark;
      ctx.lineWidth = 1;
      for (let line = 0; line < PLANK_GRAIN_LINES; line++) {
        const offset = start + board * range(rng, PLANK_GRAIN_BAND_START, PLANK_GRAIN_BAND_END);
        const wobble = jitter(rng, board * PLANK_GRAIN_WOBBLE);
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(x, y + offset);
          ctx.quadraticCurveTo(x + w / 2, y + offset + wobble, x + w, y + offset);
        } else {
          ctx.moveTo(x + offset, y);
          ctx.quadraticCurveTo(x + offset + wobble, y + h / 2, x + offset, y + h);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = PLANK_HIGHLIGHT_ALPHA;
      ctx.fillStyle = options.highlight ?? WOOD.highlight;
      if (horizontal) ctx.fillRect(bx, by, bw, seamWidth);
      else ctx.fillRect(bx, by, seamWidth, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = options.seam ?? WOOD.deep;
      if (horizontal) ctx.fillRect(bx, by + board - seamWidth, bw, seamWidth);
      else ctx.fillRect(bx + board - seamWidth, by, seamWidth, bh);
      if (rng() < (options.nailChance ?? DEFAULT_NAIL_CHANCE)) {
        const nail = Math.max(1, board * PLANK_NAIL_RADIUS_FRACTION);
        const inset = board * PLANK_NAIL_INSET_FRACTION;
        ctx.fillStyle = IRON.dark;
        for (const end of [0, 1]) {
          const cx = horizontal ? x + (end === 0 ? inset : w - inset) : bx + board / 2;
          const cy = horizontal ? by + board / 2 : y + (end === 0 ? inset : h - inset);
          ctx.beginPath();
          ctx.arc(cx, cy, nail, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } finally {
    ctx.restore();
  }
}

const STONE_ROW_OVERLAP = 0.18;
const STONE_WIDTH_MIN = 0.7;
const STONE_WIDTH_MAX = 1.25;
const STONE_HIGHLIGHT_ALPHA = 0.5;
const STONE_MOSS_ALPHA = 0.55;
/** Every other course is laid half a stone over, as a waller lays them. */
const STONE_COURSE_STAGGER = 0.5;
/** Stones are wider than they are tall. */
const STONE_ASPECT = 1.3;
/** Shares of stones in the dark and mid tones; the rest are light. */
const STONE_DARK_SHARE = 0.33;
const STONE_BODY_SHARE = 0.8;
const STONE_ROUNDING = 0.45;
/** The lit patch on a stone's upper left. */
const STONE_SHINE = { insetX: 1.8, insetY: 1.6, width: 0.55, height: 0.3, rounding: 0.2 } as const;
/** Moss caps the top of a stone. */
const STONE_MOSS_HEIGHT = 0.35;

/**
 * A course of rounded fieldstones filling a rectangle: dark mortar behind, then
 * each stone as a lumpy rounded block lit from the upper left. `mossChance`
 * greens the top of some stones — for faces that look north.
 */
export function drawFieldstones(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
  stoneHeightPx: number,
  mossChance = 0,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = STONE.deep;
    ctx.fillRect(x, y, w, h);
    const rows = Math.max(1, Math.round(h / stoneHeightPx));
    const rowHeight = h / rows;
    for (let row = 0; row < rows; row++) {
      let cursor = x - (row % 2 === 0 ? 0 : rowHeight * STONE_COURSE_STAGGER);
      const top = y + row * rowHeight;
      while (cursor < x + w) {
        const stoneWidth = rowHeight * range(rng, STONE_WIDTH_MIN, STONE_WIDTH_MAX) * STONE_ASPECT;
        const inset = (rowHeight * STONE_ROW_OVERLAP) / 2;
        const tone = rng();
        const face =
          tone < STONE_DARK_SHARE ? STONE.dark : tone < STONE_BODY_SHARE ? STONE.body : STONE.light;
        fillRoundRect(
          ctx,
          cursor + inset,
          top + inset,
          stoneWidth - inset * 2,
          rowHeight - inset * 2,
          rowHeight * STONE_ROUNDING,
          face,
        );
        ctx.globalAlpha = STONE_HIGHLIGHT_ALPHA;
        fillRoundRect(
          ctx,
          cursor + inset * STONE_SHINE.insetX,
          top + inset * STONE_SHINE.insetY,
          (stoneWidth - inset * 2) * STONE_SHINE.width,
          (rowHeight - inset * 2) * STONE_SHINE.height,
          rowHeight * STONE_SHINE.rounding,
          STONE.highlight,
        );
        if (rng() < mossChance) {
          ctx.globalAlpha = STONE_MOSS_ALPHA;
          fillRoundRect(
            ctx,
            cursor + inset,
            top + inset,
            stoneWidth - inset * 2,
            (rowHeight - inset * 2) * STONE_MOSS_HEIGHT,
            rowHeight * STONE_SHINE.rounding,
            MOSS.body,
          );
        }
        ctx.globalAlpha = 1;
        cursor += stoneWidth;
      }
    }
  } finally {
    ctx.restore();
  }
}

const WATTLE_ROD_ALPHA = 0.9;
/** Rods per panel height, and uprights spaced in rod gaps. */
const WATTLE_RODS_PER_PANEL = 6;
const WATTLE_UPRIGHT_SPACING = 2.2;
const WATTLE_ROD_THICKNESS = 0.8;
/** How far a rod bends over and under each upright: what makes it read as woven. */
const WATTLE_WEAVE_SWAY = 0.18;
const WATTLE_ROD_JITTER_PX = 0.8;
const WATTLE_ROD_START_JITTER_PX = 1;

/** Woven briar wattle between two stakes: horizontal rods over and under upright withies. */
export function drawWattle(ctx: Ctx, x: number, y: number, w: number, h: number, rng: Rng): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = WOOD.deep;
    ctx.fillRect(x, y, w, h);
    const rodGap = Math.max(2, h / WATTLE_RODS_PER_PANEL);
    const uprights = Math.max(2, Math.round(w / (rodGap * WATTLE_UPRIGHT_SPACING)));
    ctx.lineCap = 'round';
    for (let row = 0; row * rodGap < h + rodGap; row++) {
      const ry = y + row * rodGap + rodGap / 2;
      ctx.strokeStyle = row % 2 === 0 ? LOG.barkLight : LOG.bark;
      ctx.globalAlpha = WATTLE_ROD_ALPHA;
      ctx.lineWidth = rodGap * WATTLE_ROD_THICKNESS;
      ctx.beginPath();
      ctx.moveTo(x, ry + jitter(rng, WATTLE_ROD_START_JITTER_PX));
      for (let upright = 1; upright <= uprights; upright++) {
        const ux = x + (upright / uprights) * w;
        const sway = ((upright + row) % 2 === 0 ? -1 : 1) * rodGap * WATTLE_WEAVE_SWAY;
        ctx.quadraticCurveTo(
          ux - w / uprights / 2,
          ry + sway,
          ux,
          ry + jitter(rng, WATTLE_ROD_JITTER_PX),
        );
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } finally {
    ctx.restore();
  }
}

/** The lit ridge along a log's top, as shares of its radius. */
const LOG_SHINE = { alpha: 0.6, inset: 0.4, top: 0.75, height: 0.35 } as const;
/** Bark furrows across a log, as shares of its radius. */
const LOG_FURROW_WIDTH = 0.12;
const LOG_FURROW_SPACING = 1.3;
const LOG_FURROW_JITTER = 0.3;
const LOG_FURROW_TOP = 0.3;
const LOG_FURROW_BOTTOM = 0.6;
const LOG_FURROW_SLANT = 0.4;
/** The cut end is set into the log's length and seen slightly edge-on. */
const LOG_END_INSET = 0.35;
const LOG_END_SQUASH = 0.85;

/** A horizontal log seen side-on, with its cut end facing the viewer on the right if `showEnd`. */
export function drawLogSide(
  ctx: Ctx,
  x: number,
  y: number,
  length: number,
  radius: number,
  rng: Rng,
  showEnd = true,
): void {
  fillRoundRect(ctx, x, y - radius, length, radius * 2, radius, LOG.bark);
  ctx.fillStyle = LOG.barkLight;
  ctx.globalAlpha = LOG_SHINE.alpha;
  ctx.fillRect(
    x + radius * LOG_SHINE.inset,
    y - radius * LOG_SHINE.top,
    length - radius * LOG_SHINE.inset * 2,
    radius * LOG_SHINE.height,
  );
  ctx.globalAlpha = 1;
  ctx.strokeStyle = LOG.barkDark;
  ctx.lineWidth = Math.max(1, radius * LOG_FURROW_WIDTH);
  const furrows = Math.max(2, Math.round(length / (radius * LOG_FURROW_SPACING)));
  for (let furrow = 0; furrow < furrows; furrow++) {
    const fx = x + ((furrow + 1 / 2) / furrows) * length + jitter(rng, radius * LOG_FURROW_JITTER);
    ctx.beginPath();
    ctx.moveTo(fx, y - radius * LOG_FURROW_TOP);
    ctx.lineTo(fx + jitter(rng, radius * LOG_FURROW_SLANT), y + radius * LOG_FURROW_BOTTOM);
    ctx.stroke();
  }
  if (showEnd) {
    drawLogEnd(ctx, x + length - radius * LOG_END_INSET, y, radius * LOG_END_SQUASH, radius);
  }
}

/** The pale cut face inside the bark rim, and the growth rings on it, as shares of the end's radius. */
const LOG_END_FACE = 0.82;
const LOG_RING_WIDTH = 0.08;
const LOG_RINGS = [0.55, 0.3] as const;

/** The cut end of a log: pale face, dark rim, a few growth rings. */
export function drawLogEnd(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.fillStyle = LOG.barkDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = LOG.cut;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * LOG_END_FACE, ry * LOG_END_FACE, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LOG.ring;
  ctx.lineWidth = Math.max(1, ry * LOG_RING_WIDTH);
  for (const ring of LOG_RINGS) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * ring, ry * ring, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const KNOT_LOOPS = 3;
const KNOT_THORNS = 6;
const KNOT_STEPS = 48;
/** How far the loops pull in toward the centre between lobes. */
const KNOT_INNER = 0.55;
/** Thorns sprout from this ring, this long, from a base this wide. */
const KNOT_THORN_RING = 0.62;
const KNOT_THORN_LENGTH = 0.28;
const KNOT_THORN_BASE = 0.3;

/**
 * The briar knot, the village's emblem: a three-lobed looping thorn knot. Used
 * on lintels, the bell tower's finial and the signboards.
 */
export function drawBriarKnot(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  lineWidth: number,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = KNOT_STEPS;
    for (let step = 0; step <= steps; step++) {
      const t = (step / steps) * Math.PI * 2;
      const r = radius * (KNOT_INNER + (1 - KNOT_INNER) * Math.cos(KNOT_LOOPS * t));
      const px = cx + Math.cos(t) * r;
      const py = cy + Math.sin(t) * r;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let thorn = 0; thorn < KNOT_THORNS; thorn++) {
      const t = (thorn / KNOT_THORNS) * Math.PI * 2 + Math.PI / KNOT_THORNS;
      const r = radius * KNOT_THORN_RING;
      const px = cx + Math.cos(t) * r;
      const py = cy + Math.sin(t) * r;
      const outX = Math.cos(t) * radius * KNOT_THORN_LENGTH;
      const outY = Math.sin(t) * radius * KNOT_THORN_LENGTH;
      ctx.beginPath();
      ctx.moveTo(px - outY * KNOT_THORN_BASE, py + outX * KNOT_THORN_BASE);
      ctx.lineTo(px + outX, py + outY);
      ctx.lineTo(px + outY * KNOT_THORN_BASE, py - outX * KNOT_THORN_BASE);
      ctx.closePath();
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * A small brass lantern hanging from a point: hook, cap, glass with a warm
 * glow, base. `size` is the lantern's height in pixels. The glow halo is drawn
 * live in the effects pass, not here — a baked halo would be clipped by the cell.
 */
export function drawLantern(ctx: Ctx, hookX: number, hookY: number, size: number): void {
  const w = size * LANTERN.width;
  const capH = size * LANTERN.cap;
  const glassH = size * LANTERN.glass;
  const glassW = w * LANTERN.glassWidth;
  const top = hookY + size * LANTERN.hookDrop;
  ctx.strokeStyle = IRON.dark;
  ctx.lineWidth = Math.max(1, size * LANTERN.hookWidth);
  ctx.beginPath();
  ctx.moveTo(hookX, hookY);
  ctx.lineTo(hookX, top);
  ctx.stroke();
  fillRoundRect(ctx, hookX - w / 2, top, w, capH, capH / 2, BRASS.dark);
  fillRoundRect(
    ctx,
    hookX - glassW / 2,
    top + capH,
    glassW,
    glassH,
    w * LANTERN.glassRounding,
    FLAME.mid,
  );
  fillRoundRect(
    ctx,
    hookX - (w * LANTERN.flameWidth) / 2,
    top + capH + glassH * LANTERN.flameInset,
    w * LANTERN.flameWidth,
    glassH * (1 - LANTERN.flameInset * 2),
    w * LANTERN.flameRounding,
    FLAME.core,
  );
  ctx.strokeStyle = BRASS.body;
  ctx.lineWidth = Math.max(1, size * LANTERN.frameWidth);
  ctx.strokeRect(hookX - glassW / 2, top + capH, glassW, glassH);
  fillRoundRect(
    ctx,
    hookX - w / 2,
    top + capH + glassH,
    w,
    capH * LANTERN.base,
    capH * LANTERN.baseRounding,
    BRASS.dark,
  );
  ctx.fillStyle = BRASS.glint;
  ctx.fillRect(
    hookX - w * LANTERN.glintOffset,
    top + capH * LANTERN.glintTop,
    w * LANTERN.glintWidth,
    capH * LANTERN.glintHeight,
  );
}
/** A lantern's parts, as shares of its height (or, for widths, of its cap's width). */
const LANTERN = {
  width: 0.62,
  cap: 0.2,
  glass: 0.55,
  glassWidth: 0.84,
  glassRounding: 0.12,
  flameWidth: 0.44,
  flameInset: 0.2,
  flameRounding: 0.1,
  hookDrop: 0.12,
  hookWidth: 0.06,
  frameWidth: 0.05,
  base: 0.8,
  baseRounding: 0.3,
  glintOffset: 0.36,
  glintTop: 0.2,
  glintWidth: 0.2,
  glintHeight: 0.35,
} as const;

/** The crease between a box's top and front: fainter and finer than its outline. */
const BOX_EDGE_ALPHA = 0.5;
const BOX_EDGE_WIDTH = 0.7;

/** A thin dark outline traced round a path already on the context. */
export function inkOutline(ctx: Ctx, lineWidth: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * A simple box body in 3/4 view: a lit top face above a darker front face,
 * outlined. Most village furniture is a variation on this — a crate, a bin,
 * a counter, a table top on legs.
 */
export function drawBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  topDepth: number,
  frontHeight: number,
  top: string,
  front: string,
  outlineWidth: number,
): void {
  ctx.fillStyle = front;
  ctx.fillRect(x, y + topDepth, w, frontHeight);
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, topDepth);
  ctx.beginPath();
  ctx.rect(x, y, w, topDepth + frontHeight);
  inkOutline(ctx, outlineWidth);
  ctx.strokeStyle = INK;
  ctx.globalAlpha = BOX_EDGE_ALPHA;
  ctx.lineWidth = outlineWidth * BOX_EDGE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x, y + topDepth);
  ctx.lineTo(x + w, y + topDepth);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Who paints what ───────────────────────────────────────────────────────────

/**
 * The props painted in `villageOutdoorArt.ts`: the square, the farm, the lumber
 * yard, the quarry and the clutter that stands in the street. Everything else
 * — the furniture and fittings inside the buildings — is `villageIndoorArt.ts`.
 */
export const OUTDOOR_PROPS = [
  'bell_tower',
  'well',
  'notice_board',
  'lamp_post',
  'bench',
  'water_trough',
  'scarecrow',
  'mushroom_log_bed',
  'hay_bale',
  'feed_bin',
  'log_pile',
  'board_stack',
  'stone_pile',
  'chopping_block',
  'crate',
  'barrel',
  'sack',
  'half_built_cart',
  'broken_cart',
  'bucket',
  'sawmill_machine',
  'rope_frame',
] as const satisfies readonly VillageStandingPropId[];

export type OutdoorPropId = (typeof OUTDOOR_PROPS)[number];
export type IndoorPropId = Exclude<VillageStandingPropId, OutdoorPropId>;

/** A stand-in painter: a plain wooden block over the footprint. */
export function paintPlaceholderProp(ctx: Ctx, frame: VillagePropFrame): void {
  const box = footprintBox(frame);
  const inset = frame.tileScale * PLACEHOLDER_INSET_TILES;
  drawBox(
    ctx,
    box.left + inset,
    box.top + inset,
    box.width - inset * 2,
    box.height * PLACEHOLDER_TOP_SHARE,
    box.height * (1 - PLACEHOLDER_TOP_SHARE) - inset * 2,
    WOOD.light,
    WOOD.body,
    Math.max(1, frame.tileScale * PLACEHOLDER_OUTLINE_TILES),
  );
}
const PLACEHOLDER_INSET_TILES = 0.1;
const PLACEHOLDER_TOP_SHARE = 0.4;
const PLACEHOLDER_OUTLINE_TILES = 0.03;

// ── Live overlay anchors ──────────────────────────────────────────────────────
//
// Where `VillageAmbience` draws the moving and stateful parts over a prop's
// baked frame. Each is in tiles from the footprint's bottom-left corner: `x`
// rightward from its left edge, `up` upward from its bottom edge. The painter
// leaves room for what is drawn live (the bell's belfry is empty, the tool
// rack's handles carry no heads) and the ambience draws exactly here, so the
// two halves of one prop can never drift apart.

export interface OverlayAnchor {
  readonly x: number;
  readonly up: number;
}

/** The bell's pivot, under the belfry's cross-beam. The bell itself is drawn live so it can swing. */
export const BELL_PIVOT: OverlayAnchor = { x: 1, up: 3.35 };
/** The bell's height, in tiles, from its crown to its lip. */
export const BELL_HEIGHT_TILES = 0.55;

/**
 * Centre of the notice board's pinning area, where the siege's "call to arms"
 * poster goes up over the everyday notices.
 */
export const NOTICE_BOARD_POSTER: OverlayAnchor = { x: 0.5, up: 1.3 };
/** The poster's size, in tiles: most of the board's face. */
export const NOTICE_BOARD_POSTER_W_TILES = 0.56;
export const NOTICE_BOARD_POSTER_H_TILES = 0.66;

/** Centre of the sawmill's blade, which is painted still; the working blur is drawn over it. */
export const SAWMILL_BLADE: OverlayAnchor = { x: 1, up: 1.95 };
export const SAWMILL_BLADE_RADIUS_TILES = 0.42;

/** The forge's coal bed, where the flicker glows. */
export const FORGE_COALS: OverlayAnchor = { x: 1, up: 0.95 };
/** The forge chimney's mouth, where its smoke starts. */
export const FORGE_CHIMNEY_TOP: OverlayAnchor = { x: 1, up: 4.6 };

/** The cooking hearth's fire under the pot, and its flue's mouth. */
export const COOKING_FIRE: OverlayAnchor = { x: 0.65, up: 0.45 };
export const COOKING_CHIMNEY_TOP: OverlayAnchor = { x: 0.65, up: 2.75 };
/** The pot on the cooking hearth, where its steam starts. */
export const COOKING_POT: OverlayAnchor = { x: 1.35, up: 0.75 };

/** The hall's one-tile hearth: its fire and its flue's mouth. */
export const HALL_HEARTH_FIRE: OverlayAnchor = { x: 0.5, up: 0.4 };
export const HALL_HEARTH_CHIMNEY_TOP: OverlayAnchor = { x: 0.5, up: 2.75 };

/** The lamp post's lantern glass, where its glow is centred. */
export const LAMP_POST_LANTERN: OverlayAnchor = { x: 0.5, up: 2.3 };

/**
 * The tops of the two handles on Oren's tool rack, where the heads of the next
 * tier of axe and pick he sells are drawn live.
 */
export const TOOL_RACK_AXE_TOP: OverlayAnchor = { x: 0.32, up: 1.75 };
export const TOOL_RACK_PICK_TOP: OverlayAnchor = { x: 0.68, up: 1.75 };
