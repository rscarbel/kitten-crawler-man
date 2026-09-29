/**
 * The inner face of a town building's own walls — what a player actually
 * sees looking across a room, not just the props standing in front of it.
 *
 * Drawn as an overlay pass directly over the flat ground-material fill
 * `drawGroundMaterialTile` already paints for an `INTERIOR_WALL` tile
 * (`src/map/tiles/terrainTiles.ts`). This file never touches the baked
 * `ground_interior` sheet, the tile type, walkability or sight — a wall
 * tile is exactly as solid and exactly as sight-blocking as it always was;
 * only what gets drawn on top of it changed.
 */

import { rgb, rgba, type Rng } from '../town/townArt';
import { getCircusRamp, getTownRamp, mix, sampleRamp, type Ramp } from '../town/townPalette';
import type { BigTopDrapeStyle } from '../../../map/bigTopMazeDecor';
import { paintPlasterWash, paintStoneCourses, paintPlankBoard } from '../town/townMaterials';
import { mulberry32 } from '../../person/rng';

type Ctx = CanvasRenderingContext2D;

/** Which finish a building's own walls are dressed in, chosen per building. */
export type TownInteriorWallMaterialId = 'plaster' | 'stone' | 'timber' | 'canvas';

const SKIRTING_HEIGHT_FRACTION = 0.2;
const CORNICE_HEIGHT_FRACTION = 0.07;
const CORNICE_ALPHA = 0.6;
const SKIRTING_LINE_ALPHA = 0.5;
const EDGE_BAND_FRACTION = 0.24;
const EDGE_LIT_ALPHA = 0.55;
const EDGE_SHADOW_ALPHA = 0.4;
const EDGE_SHADOW_BAND_SCALE = 0.55;
/** A tile-deterministic hash so the same wall tile always paints the same picture. */
const TILE_SEED_X_PRIME = 73856093;
const TILE_SEED_Y_PRIME = 19349663;
/** A plaster wall's timber-post hint appears on every third tile, not every one. */
const WALL_POST_TILE_SPACING = 3;
const WALL_POST_WIDTH_FRACTION = 0.05;
const WALL_POST_INSET_FRACTION = 0.5;
const WALL_POST_ALPHA = 0.3;

function tileRng(tx: number, ty: number): Rng {
  const seed = ((tx * TILE_SEED_X_PRIME) ^ (ty * TILE_SEED_Y_PRIME)) >>> 0;
  return mulberry32(seed);
}

function wallWoodRamp(): Ramp {
  return getTownRamp('oc_timber');
}
function wallStoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}
function wallPlasterRamp(): Ramp {
  return getTownRamp('oc_plaster');
}

function rampForMaterial(material: TownInteriorWallMaterialId): Ramp {
  if (material === 'canvas') return getCircusRamp('circus_backstage');
  if (material === 'timber') return wallWoodRamp();
  if (material === 'stone') return wallStoneRamp();
  return wallPlasterRamp();
}

/**
 * The tall, fully visible face of a wall tile whose south neighbour is
 * floor — a room's own north wall, the one elevation a player looking down
 * into the room actually sees standing up. A timber skirting or stone
 * plinth always runs along the foot regardless of the wall's own finish (a
 * plaster wall still stands on a real base), and a lit cornice line caps it.
 */
export function paintNorthInteriorWallFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  material: TownInteriorWallMaterialId,
  tx: number,
  ty: number,
): void {
  const rng = tileRng(tx, ty);
  const skirtH = h * SKIRTING_HEIGHT_FRACTION;
  const bodyH = h - skirtH;

  if (material === 'timber') {
    paintPlankBoard(ctx, x, y, w, bodyH, rng, {
      direction: 'vertical',
      boardPx: w / 2.4,
      ramp: wallWoodRamp(),
    });
  } else if (material === 'stone') {
    paintStoneCourses(ctx, x, y, w, bodyH, wallStoneRamp(), rng);
  } else {
    paintPlasterWash(ctx, x, y, w, bodyH, wallPlasterRamp(), rng);
    // A hint of a timber post, not a full framed bay: `paintTimberFraming`
    // draws corner posts, a head beam and a diagonal brace sized for one
    // continuous facade span, and calling it per one-tile wall segment
    // repeats its brace into a cramped sawtooth. A single quiet vertical
    // line every few tiles reads as "post glimpsed behind plaster" instead.
    if (tx % WALL_POST_TILE_SPACING === 0) {
      const postW = Math.max(1, w * WALL_POST_WIDTH_FRACTION);
      ctx.fillStyle = rgba(sampleRamp(wallWoodRamp(), 0.4), WALL_POST_ALPHA);
      ctx.fillRect(x + w * WALL_POST_INSET_FRACTION, y, postW, bodyH);
    }
  }

  const skirtRamp = material === 'stone' ? wallStoneRamp() : wallWoodRamp();
  ctx.fillStyle = rgb(sampleRamp(skirtRamp, 0.3));
  ctx.fillRect(x, y + bodyH, w, skirtH);
  ctx.strokeStyle = rgba(sampleRamp(skirtRamp, 0.6), SKIRTING_LINE_ALPHA);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + bodyH);
  ctx.lineTo(x + w, y + bodyH);
  ctx.stroke();

  const corniceRamp = material === 'stone' ? wallStoneRamp() : wallPlasterRamp();
  const corniceH = h * CORNICE_HEIGHT_FRACTION;
  ctx.fillStyle = rgba(sampleRamp(corniceRamp, 0.92), CORNICE_ALPHA);
  ctx.fillRect(x, y, w, corniceH);
}

/**
 * A side or south wall tile: the room's floor is visible from only one
 * side of it, so it reads as a clean thick edge (a lit outward face, a
 * shadowed inward one) rather than a full elevation — the same convention
 * a top-down room's near and side walls always use.
 */
export function paintEdgeInteriorWallFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  material: TownInteriorWallMaterialId,
  side: 'west' | 'east' | 'south',
): void {
  const ramp = rampForMaterial(material);
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.42));
  ctx.fillRect(x, y, w, h);

  const bandThickness = side === 'south' ? h * EDGE_BAND_FRACTION : w * EDGE_BAND_FRACTION;
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.78), EDGE_LIT_ALPHA);
  if (side === 'west') ctx.fillRect(x + w - bandThickness, y, bandThickness, h);
  else if (side === 'east') ctx.fillRect(x, y, bandThickness, h);
  else ctx.fillRect(x, y, w, bandThickness);

  const shadowThickness = bandThickness * EDGE_SHADOW_BAND_SCALE;
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.12), EDGE_SHADOW_ALPHA);
  if (side === 'west') ctx.fillRect(x, y, shadowThickness, h);
  else if (side === 'east') ctx.fillRect(x + w - shadowThickness, y, shadowThickness, h);
  else ctx.fillRect(x, y + h - shadowThickness, w, shadowThickness);
}

// ── Canvas: the Big Top's hanging sidewalls ─────────────────────────────────

const DRAPE_FADE_TOWARD_NAVY = 0.35;

/** The two ramps a drape's stripes alternate between, per act. */
const DRAPE_STRIPES: Readonly<Record<BigTopDrapeStyle, readonly [Ramp, Ramp]>> = {
  firewalk: [getCircusRamp('circus_blood'), getCircusRamp('circus_bone')],
  menagerie: [
    getCircusRamp('circus_navy'),
    {
      ...getCircusRamp('circus_bone'),
      // Faded toward the navy it hangs beside: the menagerie's canvas is the
      // one that has seen the most weather.
      mid: mix(
        getCircusRamp('circus_bone').mid,
        getCircusRamp('circus_navy').light,
        DRAPE_FADE_TOWARD_NAVY,
      ),
    },
  ],
  mirrors: [getCircusRamp('circus_bruise'), getCircusRamp('circus_backstage')],
  ring: [getCircusRamp('circus_blood'), getCircusRamp('circus_backstage')],
};

/** Two stripes per tile, one of each colour. */
const DRAPE_STRIPES_PER_TILE = 2;
/** Two pleats per stripe; each pleat is lit on its upper-left and falls into shade. */
const DRAPE_PLEATS_PER_STRIPE = 2;
const DRAPE_PLEAT_LIGHT_SHARE = 0.25;
const DRAPE_BASE_TONE = 0.4;
const DRAPE_PLEAT_TONE_RANGE = 0.22;
/** The canvas hangs from a point every this many tiles and sags between them. */
const DRAPE_HANG_SPAN_TILES = 2;
const DRAPE_SAG_FRACTION = 0.09;
const VALANCE_HEIGHT_FRACTION = 0.16;
const VALANCE_SCALLOP_FRACTION = 0.08;
const VALANCE_TONE = 0.4;
const VALANCE_TRIM_FRACTION = 0.035;
const VALANCE_TRIM_ALPHA = 0.7;
const DRAPE_TOP_SHADE_ALPHA = 0.5;
const DRAPE_TOP_SHADE_REACH = 0.55;
const DRAPE_SEAM_ALPHA = 0.3;
const DRAPE_SEAM_WIDTH_FRACTION = 1 / 32;
const HEM_DUST_FRACTION = 0.22;
const HEM_DUST_ALPHA = 0.42;
const HEM_AO_FRACTION = 0.1;
const HEM_AO_ALPHA = 0.55;

function drapeSag(worldX: number, ts: number): number {
  const span = DRAPE_HANG_SPAN_TILES * ts;
  const phase = (((worldX % span) + span) % span) / span;
  return Math.sin(phase * Math.PI) * DRAPE_SAG_FRACTION * ts;
}

/**
 * The north face of a Big Top corridor: striped sidewall canvas hung from a
 * scalloped valance, sagging between its hanging points, pleated, shaded up
 * into the dark of the tent and dusted with sawdust at the hem.
 *
 * Every measure along the wall is taken from the world x, so a run of wall
 * tiles hangs as one continuous drape.
 */
export function paintCanvasDrapeNorthFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  style: BigTopDrapeStyle,
  tx: number,
): void {
  const [first, second] = DRAPE_STRIPES[style];
  const worldLeft = tx * w;
  const stripeWidth = w / DRAPE_STRIPES_PER_TILE;
  const pleatWidth = stripeWidth / DRAPE_PLEATS_PER_STRIPE;
  const valanceHeight = h * VALANCE_HEIGHT_FRACTION;
  const scallopDepth = h * VALANCE_SCALLOP_FRACTION;
  const trimHeight = Math.max(1, h * VALANCE_TRIM_FRACTION);
  const columns = Math.ceil(w);

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    for (let column = 0; column < columns; column++) {
      const worldX = worldLeft + column;
      const stripe = Math.floor(worldX / stripeWidth);
      const ramp = stripe % 2 === 0 ? first : second;
      const pleatPhase = (worldX % pleatWidth) / pleatWidth;
      // A sawtooth of light: bright where the pleat turns toward the light,
      // falling off across it into the fold behind the next.
      const pleatLight =
        pleatPhase < DRAPE_PLEAT_LIGHT_SHARE
          ? pleatPhase / DRAPE_PLEAT_LIGHT_SHARE
          : 1 - (pleatPhase - DRAPE_PLEAT_LIGHT_SHARE) / (1 - DRAPE_PLEAT_LIGHT_SHARE);
      const tone = DRAPE_BASE_TONE + (pleatLight - 0.5) * DRAPE_PLEAT_TONE_RANGE;
      const top = y + drapeSag(worldX, w) + valanceHeight;
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.fillRect(x + column, top, 1, y + h - top);
    }

    const stripeSeamWidth = Math.max(1, w * DRAPE_SEAM_WIDTH_FRACTION);
    ctx.fillStyle = rgba(sampleRamp(getCircusRamp('circus_backstage'), 0), DRAPE_SEAM_ALPHA);
    for (
      let seam = Math.ceil(worldLeft / stripeWidth);
      seam * stripeWidth < worldLeft + w;
      seam++
    ) {
      ctx.fillRect(x + seam * stripeWidth - worldLeft, y, stripeSeamWidth, h);
    }

    const shade = ctx.createLinearGradient(0, y, 0, y + h * DRAPE_TOP_SHADE_REACH);
    shade.addColorStop(0, rgba(getCircusRamp('circus_backstage').shadow, DRAPE_TOP_SHADE_ALPHA));
    shade.addColorStop(1, rgba(getCircusRamp('circus_backstage').shadow, 0));
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h * DRAPE_TOP_SHADE_REACH);

    // The valance: a band of the act's darker stripe, following the sag,
    // scalloped along its lower edge one scallop per stripe.
    for (let column = 0; column < columns; column++) {
      const worldX = worldLeft + column;
      const scallopPhase = (worldX % stripeWidth) / stripeWidth;
      const scallop = Math.sin(scallopPhase * Math.PI) * scallopDepth;
      const top = y + drapeSag(worldX, w);
      const stripe = Math.floor(worldX / stripeWidth);
      const ramp = stripe % 2 === 0 ? first : second;
      ctx.fillStyle = rgb(sampleRamp(ramp, VALANCE_TONE));
      ctx.fillRect(x + column, top, 1, valanceHeight + scallop);
      ctx.fillStyle = rgba(getCircusRamp('circus_brass').mid, VALANCE_TRIM_ALPHA);
      ctx.fillRect(x + column, top, 1, trimHeight);
    }

    const hemTop = y + h * (1 - HEM_DUST_FRACTION);
    const dust = ctx.createLinearGradient(0, hemTop, 0, y + h);
    dust.addColorStop(0, rgba(getCircusRamp('circus_straw').mid, 0));
    dust.addColorStop(1, rgba(getCircusRamp('circus_straw').mid, HEM_DUST_ALPHA));
    ctx.fillStyle = dust;
    ctx.fillRect(x, hemTop, w, h - (hemTop - y));
    const aoTop = y + h * (1 - HEM_AO_FRACTION);
    const ao = ctx.createLinearGradient(0, aoTop, 0, y + h);
    ao.addColorStop(0, rgba(getCircusRamp('circus_backstage').shadow, 0));
    ao.addColorStop(1, rgba(getCircusRamp('circus_backstage').shadow, HEM_AO_ALPHA));
    ctx.fillStyle = ao;
    ctx.fillRect(x, aoTop, w, h - (aoTop - y));
  } finally {
    ctx.restore();
  }
}

const FOLD_WIDTH_FRACTION = 0.2;
const FOLD_SHADE_TONE = 0.2;
const FOLD_LIT_TONE = 0.55;
const FOLD_SHADOW_ALPHA = 0.45;
const FOLD_SHADOW_FRACTION = 0.08;

/**
 * A side or south wall of a Big Top corridor, seen from above: the backstage
 * mass with the drape's edge showing as a narrow rolled fold along the side
 * that faces the floor, shading into the dark behind it.
 */
export function paintCanvasDrapeEdgeFace(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  style: BigTopDrapeStyle,
  side: 'west' | 'east' | 'south',
  tx: number,
): void {
  const [first, second] = DRAPE_STRIPES[style];
  ctx.save();
  try {
    if (side === 'south') {
      const foldHeight = h * FOLD_WIDTH_FRACTION;
      const stripeWidth = w / DRAPE_STRIPES_PER_TILE;
      for (let stripe = 0; stripe < DRAPE_STRIPES_PER_TILE; stripe++) {
        const worldStripe = tx * DRAPE_STRIPES_PER_TILE + stripe;
        const ramp = worldStripe % 2 === 0 ? first : second;
        const fold = ctx.createLinearGradient(0, y, 0, y + foldHeight);
        fold.addColorStop(0, rgb(sampleRamp(ramp, FOLD_LIT_TONE)));
        fold.addColorStop(1, rgb(sampleRamp(ramp, FOLD_SHADE_TONE)));
        ctx.fillStyle = fold;
        ctx.fillRect(x + stripe * stripeWidth, y, stripeWidth, foldHeight);
      }
      ctx.fillStyle = rgba(getCircusRamp('circus_backstage').shadow, FOLD_SHADOW_ALPHA);
      ctx.fillRect(x, y + foldHeight, w, h * FOLD_SHADOW_FRACTION);
      return;
    }
    const foldWidth = w * FOLD_WIDTH_FRACTION;
    const foldLeft = side === 'west' ? x + w - foldWidth : x;
    const litEdge = side === 'west' ? foldLeft + foldWidth : foldLeft;
    const darkEdge = side === 'west' ? foldLeft : foldLeft + foldWidth;
    const fold = ctx.createLinearGradient(litEdge, 0, darkEdge, 0);
    fold.addColorStop(0, rgb(sampleRamp(first, FOLD_LIT_TONE)));
    fold.addColorStop(1, rgb(sampleRamp(first, FOLD_SHADE_TONE)));
    ctx.fillStyle = fold;
    ctx.fillRect(foldLeft, y, foldWidth, h);
    const shadowWidth = w * FOLD_SHADOW_FRACTION;
    ctx.fillStyle = rgba(getCircusRamp('circus_backstage').shadow, FOLD_SHADOW_ALPHA);
    ctx.fillRect(
      side === 'west' ? foldLeft - shadowWidth : foldLeft + foldWidth,
      y,
      shadowWidth,
      h,
    );
  } finally {
    ctx.restore();
  }
}
