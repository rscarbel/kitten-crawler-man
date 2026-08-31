/**
 * Which pictures the Desperado Club's furniture sheets carry.
 *
 * Ten families, each one sheet whose single `idle` row holds its *variants* as
 * frames, so a layout picks a counter or a stool by frame index and the club
 * stops reading as five copies of the same prop. Everything is painted by one
 * club engine (`src/sprites/art/clubFurnitureArt.ts`).
 *
 * Geometry convention shared by every family: the frame's bottom tile row is the
 * prop's *footprint* (the tiles it stands on and blocks), and everything above
 * that row is height the prop rises into the tiles behind it. `tileY` therefore
 * equals the headroom, so a draw site places the footprint's top-left tile and
 * the art lands correctly without knowing how tall the piece is.
 */

import {
  CLUB_TILE_SCALE,
  drawBarCounter,
  drawBarStool,
  drawCasinoTable,
  drawDrinkShelf,
  drawMarketBackdrop,
  drawMarketStall,
  drawMercDesk,
  drawVelvetRope,
  drawVipCounter,
  drawWeaponRack,
  type ClubFrameGeometry,
} from '../art/clubFurnitureArt';
import type { FrameEdge, PropSheetPlan, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/** Height, in logical tiles, that most counter-height pieces rise above their footprint. */
const COUNTER_HEADROOM_TILES = 1;
/** A stool is barely taller than its own tile, so it needs only half the usual headroom. */
const STOOL_HEADROOM_TILES = 0.5;

/**
 * Paints one variant of a family into a frame whose footprint row is described
 * by `geo`. The seed term is a floor's own art seed; a family with nothing
 * seeded in it simply takes fewer arguments.
 */
type ClubPainter = (
  ctx: CanvasRenderingContext2D,
  geo: ClubFrameGeometry,
  variant: number,
  seedTerm: number,
) => void;

interface ClubFamily {
  readonly key: SpriteKey;
  /** File a review bake writes, and the name the family has always gone by. */
  readonly file: string;
  /** Footprint width in logical tiles. */
  readonly widthTiles: number;
  /** Tiles of art above the footprint row. */
  readonly headroomTiles: number;
  readonly variants: number;
  readonly draw: ClubPainter;
}

const FAMILIES: ReadonlyArray<ClubFamily> = [
  {
    key: 'club_bar_counter',
    file: 'bar_counter.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawBarCounter,
  },
  {
    key: 'club_bar_stool',
    file: 'bar_stool.png',
    widthTiles: 1,
    headroomTiles: STOOL_HEADROOM_TILES,
    variants: 3,
    draw: drawBarStool,
  },
  {
    key: 'club_drink_shelf',
    file: 'drink_shelf.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawDrinkShelf,
  },
  {
    key: 'club_market_stall',
    file: 'market_stall.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawMarketStall,
  },
  {
    key: 'club_market_backdrop',
    file: 'market_backdrop.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawMarketBackdrop,
  },
  {
    key: 'club_weapon_rack',
    file: 'weapon_rack.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 3,
    draw: drawWeaponRack,
  },
  {
    key: 'club_merc_desk',
    file: 'merc_desk.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawMercDesk,
  },
  {
    key: 'club_casino_table',
    file: 'casino_table.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawCasinoTable,
  },
  {
    key: 'club_vip_counter',
    file: 'vip_counter.png',
    widthTiles: 6,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawVipCounter,
  },
  {
    key: 'club_velvet_rope',
    file: 'velvet_rope.png',
    widthTiles: 2,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawVelvetRope,
  },
];

function geometryFor(family: ClubFamily): ClubFrameGeometry {
  const headroom = family.headroomTiles * CLUB_TILE_SCALE;
  return {
    w: family.widthTiles * CLUB_TILE_SCALE,
    h: headroom + CLUB_TILE_SCALE,
    footTop: headroom,
    footBottom: headroom + CLUB_TILE_SCALE,
  };
}

function clubSheet(family: ClubFamily, seedTerm: number): PropSheetPlan {
  const geo = geometryFor(family);
  const frames: FramePainter[] = [];
  for (let variant = 0; variant < family.variants; variant++) {
    const paint: FramePainter = (ctx, originX, originY) => {
      ctx.save();
      try {
        // The painters draw in frame-local coordinates with the footprint row's
        // top edge at `footTop`; the anchor the plan hands them is that same
        // line, so the frame's own origin is one headroom above it.
        ctx.translate(originX, originY - geo.footTop);
        family.draw(ctx, geo, variant, seedTerm);
      } finally {
        ctx.restore();
      }
    };
    frames.push(paint);
  }
  return {
    key: family.key,
    file: family.file,
    frameWidth: geo.w,
    frameHeight: geo.h,
    tileX: 0,
    tileY: geo.footTop,
    tileScale: CLUB_TILE_SCALE,
    rows: [{ state: 'idle', frames }],
  };
}

/**
 * Every club furniture sheet, painted with `seedTerm` added to each family's
 * own fixed seed.
 *
 * The term is a parameter rather than read from the floor slot so a review bake
 * can paint the whole club at a candidate seed without pretending to be on a
 * floor.
 */
/**
 * The edges a club prop stands on rather than is sheared by.
 *
 * A club frame is the prop's own footprint box, so three of its four edges are
 * design boundaries rather than shears: a counter's lacquered top spans the full
 * width of the tiles it occupies, and its shadow pools on the bottom edge
 * because there is nowhere below the footprint row to pool into.
 *
 * The top edge is the one with slack, and it is the one that stays checked: an
 * awning, a swagged rope or a bottle that grew past its headroom would be
 * sheared off along a straight line there, which is exactly the fault a clipping
 * check exists to catch.
 */
export const CLUB_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>([
  'bottom',
  'left',
  'right',
]);

export function clubFurnitureSheetPlans(seedTerm: number): PropSheetPlan[] {
  return FAMILIES.map((family) => clubSheet(family, seedTerm));
}
