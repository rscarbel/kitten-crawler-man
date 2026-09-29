/**
 * Shared vocabulary for Over City's painted art: the frame contract every
 * facade, street prop and piece of interior furniture is painted against,
 * the bake scale, and the light/shadow/outline rules that make a plaster
 * shopfront, a dressed-stone temple and a crate at the building line read as
 * one town rather than fifteen separate drawings.
 *
 * Mirrors `src/sprites/art/villageArt.ts` in shape and intent — a palette
 * module (`townPalette.ts`), a set of material painters (`townMaterials.ts`)
 * and this file's frame contract and lighting rules — so a caller who
 * already knows the village module recognises this one immediately. Over
 * City is a mixed human-and-skyfowl town rather than a ratkin village, and
 * three choices carry that everywhere: it is **lighter and cooler** than the
 * village's dark oiled wood, its masonry is **dressed and coursed** rather
 * than rounded fieldstone, and its hardware is **iron** rather than brass.
 * Light comes from the upper left, as it does for every prop in the repo.
 *
 * Painters are pure canvas calls with no filesystem, so the game (at floor
 * load) and the offline review bake paint the same pixels.
 */

import { fillSoftEllipse } from '../softShade';
import { mulberry32, range, type Rng } from '../../person/rng';
import {
  TOWN_CONTACT_SHADOW,
  TOWN_GROUND_SHADOW,
  TOWN_INK,
  TOWN_LIGHT_DIR_X,
  TOWN_LIGHT_DIR_Y,
} from './townPalette';
import type { RGB } from './townPalette';

export type Ctx = CanvasRenderingContext2D;

/**
 * Source pixels per game tile. `scripts/render-town-art.ts` bakes a
 * representative facade at 48 and 64 px/tile and measures both: 64 costs
 * ~69 MB more decoded residency across the whole facade set (to ~159 MB,
 * still under the game's pre-optimization 191 MB resident baseline —
 * `docs/asset-management.md`), while paint time grows only ~1.28×, well
 * under the 1.775× pixel-count ratio, because fixed per-call overhead
 * (gradient allocation, `Rng` draws, `save`/`restore`) doesn't scale with
 * pixel count. 64 also matches `VILLAGE_TILE_SCALE` and every existing
 * `FigureDef`'s bake scale, so a facade repaint (adopting this constant)
 * finally sits at the same source resolution as the figures standing in
 * front of it and the village across the map. `src/sprites/buildinggen/spec.ts`'s
 * `BUILDING_TILE_SCALE` stays 48 until a later work migrates the facades
 * onto this constant — nothing in this module changes shipped art on its own.
 */
export const TOWN_TILE_SCALE = 64;

/** The game's own on-screen tile size, in pixels — the display scale every ratio in this module (outline width, suppressed-detail threshold) is derived against. */
export const DISPLAY_TILE_PX = 32;

/**
 * Where one prop, or one facade element, is painted.
 *
 * The anchor is the footprint's **bottom-left** tile, matching
 * `VillagePropFrame` — a prop is Y-sorted on its anchor's foot, so a
 * multi-tile-deep prop must sort on its foot end, not its head. The art
 * extends right across `footprintW` tiles and up across `footprintH` tiles,
 * plus whatever headroom a caller allows for height.
 */
export interface TownPropFrame {
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
 * `left..right` and never below `bottom` — past either side is ground a
 * crawler can stand on while drawn behind the prop, and below the bottom is
 * ground drawn in front of it. Above `top` is fine: that is height.
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

export function footprintBox(frame: TownPropFrame): FootprintBox {
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

/**
 * How many tiles of headroom above the footprint a clip allows by default.
 * Generous enough for a two-storey shopfront's roof or a hanging trade sign,
 * but still a real bound — an unbounded clip would let a runaway painter
 * bleed into whatever the engine draws above the tile without the gate
 * catching it.
 */
export const DEFAULT_PROP_HEADROOM_TILES = 8;

/**
 * Enforces the frame contract for the duration of `paint`: clips to the
 * footprint's own width and bottom edge, and to `headroomTiles` above it.
 * Every material and prop painter in this module is written so that
 * clipping never visibly cuts anything off — the clip is a backstop for the
 * gate to catch a mistake, not a crutch a painter is expected to lean on.
 */
export function withFootprintClip(
  ctx: Ctx,
  frame: TownPropFrame,
  paint: () => void,
  headroomTiles = DEFAULT_PROP_HEADROOM_TILES,
): void {
  const box = footprintBox(frame);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(
      box.left,
      box.top - frame.tileScale * headroomTiles,
      box.width,
      box.height + frame.tileScale * headroomTiles,
    );
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

/** Paints one variant of a prop. `rng` is seeded per variant and per floor — the seed reaches only surface variation, never the footprint or the geometry it implies. */
export type TownPropPainter = (ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng) => void;

export interface TownPropArt {
  /** How many variants the prop has — the frame count of its sheet row. */
  readonly variants: number;
  readonly paint: TownPropPainter;
}

// ── Seeded helpers ────────────────────────────────────────────────────────────

export type { Rng };

/** A fresh stream for a sub-part of a painter, so one extra draw cannot reshuffle the rest (memory: "seeded sims need many streams"). */
export function forkRng(rng: Rng): Rng {
  return mulberry32(Math.floor(rng() * UINT32_RANGE));
}
const UINT32_RANGE = 0x100000000;

/** A small signed jitter, in the same units as `amount`. */
export function jitter(rng: Rng, amount: number): number {
  return range(rng, -amount, amount);
}

// ── Colour ────────────────────────────────────────────────────────────────────

/**
 * node-canvas drops an `rgba()` string whose alpha serialises in exponent
 * notation (memory: "node-canvas rejects exponent alpha"); every alpha this
 * module paints with passes through here.
 */
const MIN_SERIALISABLE_ALPHA = 0.004;
const ALPHA_DECIMALS = 3;

export function rgba(color: RGB, alpha: number): string {
  const safe = alpha <= 0 ? 0 : Math.min(1, Math.max(MIN_SERIALISABLE_ALPHA, alpha));
  if (safe === 0) return 'rgba(0,0,0,0)';
  const r = Math.round(Math.min(255, Math.max(0, color[0])));
  const g = Math.round(Math.min(255, Math.max(0, color[1])));
  const b = Math.round(Math.min(255, Math.max(0, color[2])));
  return `rgba(${r},${g},${b},${safe.toFixed(ALPHA_DECIMALS)})`;
}

export function rgb(color: RGB): string {
  return rgba(color, 1);
}

// ── Outline (one policy for buildings, props and figures) ─────────────────────

/** One screen pixel of outline at the game's 32 px/tile display, converted to whatever bake scale is in use. */
export function outlineWidthPx(tileScale: number): number {
  const OUTLINE_SCREEN_PX = 1;
  return Math.max(1, (OUTLINE_SCREEN_PX * tileScale) / DISPLAY_TILE_PX);
}

/** Peak alpha for the silhouette outline pass — one pass only; see `townMaterials.ts` for why a second full-strength stroke is never layered on top. */
export const OUTLINE_ALPHA = 0.85;

/** Strokes the current path as the town's silhouette outline: warm near-black ink, one screen pixel wide at 32 px/tile, one pass. */
export function inkOutline(ctx: Ctx, tileScale: number): void {
  ctx.strokeStyle = rgba(TOWN_INK, OUTLINE_ALPHA);
  ctx.lineWidth = outlineWidthPx(tileScale);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── Light, cast shadow, ambient occlusion ──────────────────────────────────────

const CAST_SHADOW_LENGTH_FACTOR = 0.3;
/** The light's own vector, flipped, normalised so the shadow's vertical drop is proportional to its horizontal run. */
const CAST_SHADOW_VECTOR_Y_FACTOR = Math.abs(TOWN_LIGHT_DIR_Y);
/** The light's own vector, flipped: which way (+1 right, -1 left) the shadow's horizontal run points. */
const CAST_SHADOW_RUN_SIGN = -Math.sign(TOWN_LIGHT_DIR_X);
const CAST_SHADOW_MID_STOP = 0.38;
const CAST_SHADOW_PEAK_ALPHA = 0.45;
const CAST_SHADOW_MID_ALPHA_FRACTION = 0.38;
const CAST_SHADOW_SPREAD_FACTOR = 1.6;
const CAST_SHADOW_NEAR_FACTOR = 0.6;

/**
 * Casts a building's (or any standing prop's) shadow onto the ground beside
 * it, falling down and away from the wall base along the light's own
 * vector, so an empty doorway or wall foot still reads as grounded rather
 * than pasted onto the street. `heightTiles` is `groundStoryTiles +
 * roof.depthTiles` for a facade, or a prop's own height.
 */
export function paintCastShadow(
  ctx: Ctx,
  wallRightX: number,
  groundY: number,
  heightTiles: number,
  tileScale: number,
): void {
  const length = heightTiles * CAST_SHADOW_LENGTH_FACTOR * tileScale;
  const dx = length * CAST_SHADOW_RUN_SIGN;
  const dy = length * CAST_SHADOW_VECTOR_Y_FACTOR;
  const gradient = ctx.createLinearGradient(wallRightX, groundY, wallRightX + dx, groundY + dy);
  gradient.addColorStop(0, rgba(TOWN_GROUND_SHADOW, CAST_SHADOW_PEAK_ALPHA));
  gradient.addColorStop(
    CAST_SHADOW_MID_STOP,
    rgba(TOWN_GROUND_SHADOW, CAST_SHADOW_PEAK_ALPHA * CAST_SHADOW_MID_ALPHA_FRACTION),
  );
  gradient.addColorStop(1, rgba(TOWN_GROUND_SHADOW, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(wallRightX, groundY);
  ctx.lineTo(wallRightX + dx, groundY + dy);
  ctx.lineTo(wallRightX + dx * CAST_SHADOW_SPREAD_FACTOR, groundY + dy);
  ctx.lineTo(wallRightX + dx * CAST_SHADOW_NEAR_FACTOR, groundY);
  ctx.closePath();
  ctx.fill();
}

export type AoEdge = 'top' | 'bottom' | 'left' | 'right';

const AO_MID_STOP = 0.5;
const AO_MID_DEPTH_FRACTION = 0.38;

/**
 * A soft ambient-occlusion band along one edge of a rect, matching
 * `paintEdgeAo`'s own 3-stop shape (`buildinggen/lighting.ts`): full
 * strength at the edge, ~38% of peak alpha at the middle stop, zero by
 * `depthPx`. Used at every ground contact — a doorway threshold, a
 * building-line prop's foot, a facade's own base — and under an eave.
 */
export function paintContactAo(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: AoEdge,
  depthPx: number,
  alpha: number,
): void {
  const gradient =
    edge === 'top' || edge === 'bottom'
      ? ctx.createLinearGradient(
          0,
          edge === 'top' ? y : y + h,
          0,
          edge === 'top' ? y + depthPx : y + h - depthPx,
        )
      : ctx.createLinearGradient(
          edge === 'left' ? x : x + w,
          0,
          edge === 'left' ? x + depthPx : x + w - depthPx,
          0,
        );
  gradient.addColorStop(0, rgba(TOWN_CONTACT_SHADOW, alpha));
  gradient.addColorStop(AO_MID_STOP, rgba(TOWN_CONTACT_SHADOW, alpha * AO_MID_DEPTH_FRACTION));
  gradient.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, 0));
  ctx.fillStyle = gradient;
  if (edge === 'top') ctx.fillRect(x, y, w, depthPx);
  else if (edge === 'bottom') ctx.fillRect(x, y + h - depthPx, w, depthPx);
  else if (edge === 'left') ctx.fillRect(x, y, depthPx, h);
  else ctx.fillRect(x + w - depthPx, y, depthPx, h);
}

/** Depth and reach for the standard ground-contact AO a doorway, prop foot or wall base carries. */
export const GROUND_CONTACT_AO_ALPHA = 0.55;
export const GROUND_CONTACT_AO_REACH_TILES = 0.4;
/** Depth and reach for the softer band an eave casts onto the wall under it. */
export const EAVE_AO_ALPHA = 0.45;
export const EAVE_AO_REACH_TILES = 0.5;

// ── A demonstration prop, proving the frame contract in the review harness ────

const PLACEHOLDER_INSET_TILES = 0.1;
const PLACEHOLDER_FILL_ALPHA = 0.12;

/**
 * A stand-in painter: a plain inked block over the footprint, ink clipped to
 * the frame contract via `withFootprintClip`. Exists so the review harness
 * and gate have something real to paint through the contract before any
 * actual street prop exists — every call site is meant to be replaced by a
 * real prop painter, never this function's contract.
 */
export function paintPlaceholderTownProp(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const inset = frame.tileScale * PLACEHOLDER_INSET_TILES;
    const innerX = box.left + inset;
    const innerY = box.top + inset;
    const innerW = box.width - inset * 2;
    const innerH = box.height - inset * 2;
    ctx.fillStyle = rgb(TOWN_INK);
    ctx.globalAlpha = PLACEHOLDER_FILL_ALPHA;
    ctx.fillRect(innerX, innerY, innerW, innerH);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.rect(innerX, innerY, innerW, innerH);
    inkOutline(ctx, frame.tileScale);
  });
}

/** A soft contact-pool shadow under a standing prop, radius kept inside the footprint. */
export function drawTownContactShadow(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  fillSoftEllipse(ctx, centreX, centreY, radiusX, radiusY, rgb(TOWN_CONTACT_SHADOW), alpha);
}
