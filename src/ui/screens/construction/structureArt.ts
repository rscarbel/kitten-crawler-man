/**
 * A buildable kind's picture for its Construction card, painted with the
 * same painters the world uses for the finished structure, scaled to fit.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import type { Rect } from '../../core/geom';
import type { BuildOption } from '../../../systems/briarHollow/ConstructionSystem';
import type { PalisadeTier } from '../../../map/tileTypes';
import { paintPalisadeForReview, PALISADE_DIRS } from '../../../map/tiles/hollowPalisadeTiles';
import {
  TREBUCHET_COCKED_ANGLE,
  TREBUCHET_FOOTPRINT_H,
  TREBUCHET_FOOTPRINT_W,
  drawTrebuchet,
} from '../../../sprites/art/trebuchetArt';
import { drawSnare } from '../../../sprites/art/snareArt';

type StructurePainter = (ctx: CanvasRenderingContext2D, box: Rect) => void;

/** A wall card shows a short run of this many palisade tiles. */
const WALL_RUN_TILES = 2;
/** A palisade piece's stakes rise this many tiles above its own footprint row. */
const WALL_STAKE_RISE_TILES = 1;
const WALL_RUN_HEIGHT_TILES = 1 + WALL_STAKE_RISE_TILES;
/** A cocked trebuchet's arm and counterweight rise this far above its footprint. */
const TREBUCHET_RISE_TILES = 0.6;
/** A set snare is a low loop on the ground; it is drawn at this share of the box so it reads. */
const SNARE_TILE_SHARE = 0.9;
/** A trebuchet's bucket is drawn this full, so the card shows it ready to throw. */
const TREBUCHET_AMMO_SHOWN = 0.6;

function wallPainter(tier: PalisadeTier): StructurePainter {
  return (ctx, box) => {
    const tile = Math.min(box.w / WALL_RUN_TILES, box.h / WALL_RUN_HEIGHT_TILES);
    const left = box.x + (box.w - tile * WALL_RUN_TILES) / 2;
    const runTop = box.y + (box.h - tile * WALL_RUN_HEIGHT_TILES) / 2;
    const footprintTop = runTop + tile * WALL_STAKE_RISE_TILES;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    for (let index = 0; index < WALL_RUN_TILES; index++) {
      const isFirst = index === 0;
      paintPalisadeForReview(ctx, left + index * tile, footprintTop, tile, {
        tier,
        stage: 0,
        mask: isFirst ? PALISADE_DIRS.east : PALISADE_DIRS.west,
        outside: 'south',
        spiked: false,
        buttress: false,
        variant: index,
      });
    }
    ctx.restore();
  };
}

const paintTrebuchet: StructurePainter = (ctx, box) => {
  const tallTiles = TREBUCHET_FOOTPRINT_H + TREBUCHET_RISE_TILES;
  const tile = Math.min(box.w / TREBUCHET_FOOTPRINT_W, box.h / tallTiles);
  const x = box.x + (box.w - tile * TREBUCHET_FOOTPRINT_W) / 2;
  const top = box.y + (box.h - tile * tallTiles) / 2;
  drawTrebuchet(ctx, x, top + tile * TREBUCHET_RISE_TILES, tile, {
    armAngle: TREBUCHET_COCKED_ANGLE,
    slingPhase: 0,
    broken: false,
    damageStage: 0,
    spikes: false,
    ammoFraction: TREBUCHET_AMMO_SHOWN,
    infernal: false,
  });
};

const paintSnare: StructurePainter = (ctx, box) => {
  const tile = Math.min(box.w, box.h) * SNARE_TILE_SHARE;
  drawSnare(ctx, box.x + (box.w - tile) / 2, box.y + (box.h - tile) / 2, tile, {
    look: 'set',
    spikes: false,
    timeSeconds: 0,
  });
};

const STRUCTURE_PAINTERS: Readonly<Record<BuildOption, StructurePainter>> = {
  wood: wallPainter('wood'),
  stone: wallPainter('stone'),
  fortified: wallPainter('fortified'),
  trebuchet: paintTrebuchet,
  snare: paintSnare,
};

/** `washed` drains the colour, for an option that cannot be built where the party is. */
export type StructureArtLook = 'normal' | 'washed';

const WASHED_FILTER = 'grayscale(1)';
/**
 * Pictures kept, keyed by option, device-pixel size and look. A panel's open
 * animation scales the context for a few frames, so a handful of sizes pass
 * through; past this many the cache starts over rather than growing.
 */
const MAX_CACHED_PICTURES = 48;
const cache = new Map<string, CanvasSurface>();

/**
 * Draws `option`'s finished structure centred in `box`, from a picture
 * painted once per size: the painters are static, and repainting a trebuchet
 * on every card every frame is wasted work.
 */
export function drawStructureArt(
  ctx: CanvasRenderingContext2D,
  option: BuildOption,
  box: Rect,
  look: StructureArtLook,
): void {
  const transform = ctx.getTransform();
  const deviceScale = Math.hypot(transform.a, transform.b);
  const pixelW = Math.ceil(box.w * deviceScale);
  const pixelH = Math.ceil(box.h * deviceScale);
  if (pixelW <= 0 || pixelH <= 0) return;
  const key = `${option}|${pixelW}x${pixelH}|${look}`;
  let picture = cache.get(key);
  if (picture === undefined) {
    if (cache.size >= MAX_CACHED_PICTURES) cache.clear();
    const surface = allocCanvas(pixelW, pixelH);
    const surfaceCtx = surfaceContext(surface);
    surfaceCtx.scale(pixelW / box.w, pixelH / box.h);
    if (look === 'washed') surfaceCtx.filter = WASHED_FILTER;
    paintStructureArt(surfaceCtx, option, { x: 0, y: 0, w: box.w, h: box.h });
    cache.set(key, surface);
    picture = surface;
  }
  ctx.drawImage(picture, box.x, box.y, box.w, box.h);
}

/** Paints `option`'s finished structure centred in `box`. */
function paintStructureArt(ctx: CanvasRenderingContext2D, option: BuildOption, box: Rect): void {
  STRUCTURE_PAINTERS[option](ctx, box);
}
