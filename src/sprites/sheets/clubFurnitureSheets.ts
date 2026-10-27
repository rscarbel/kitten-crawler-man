/**
 * Which pictures the Cloak & Dagger's furniture sheets carry.
 *
 * Each family is one sheet whose single `idle` row holds its *variants* as
 * frames, so a layout picks a counter or a stool by frame index and the club
 * stops reading as five copies of the same prop. The casino's games are painted
 * by `src/sprites/art/clubCasinoFloorArt.ts`, the stages, the host stand and
 * the standing tables by `src/sprites/art/clubStageArt.ts`, and everything else
 * by `src/sprites/art/clubFurnitureArt.ts`, on the same conventions.
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
  drawPokerTable,
  type ClubFrameGeometry,
} from '../art/clubFurnitureArt';
import {
  CASINO_LIGHT_PHASES,
  SLOT_CABINET_VARIANTS,
  drawCroupierCounter,
  drawFortuneWheel,
  drawFortuneWheelLights,
  drawSlotCabinet,
  drawSlotCabinetBack,
  drawSlotCabinetLights,
} from '../art/clubCasinoFloorArt';
import {
  STANDING_TABLE_VARIANTS,
  drawClubStage,
  drawHostStand,
  drawStandingTable,
} from '../art/clubStageArt';
import type { FrameEdge, PropSheetPlan, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/spriteAssets/SpriteLoader';

/** Height, in logical tiles, that most counter-height pieces rise above their footprint. */
const COUNTER_HEADROOM_TILES = 1;
/** A stool is barely taller than its own tile, so it needs only half the usual headroom. */
const STOOL_HEADROOM_TILES = 0.5;
/** The upright wheel stands well over a crawler's head, so it rises two tiles. */
const WHEEL_HEADROOM_TILES = 2;
const WHEEL_WIDTH_TILES = 3;
/** A stage is three tiles square: a deck the dancer can circle a pole on. */
const STAGE_SIDE_TILES = 3;

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
  /** Edges this family paints against on purpose, in place of `CLUB_GROUNDED_EDGES`. */
  readonly groundedEdges?: ReadonlySet<FrameEdge>;
}

/**
 * A stage's deck is floor, raised: it fills its three tiles to the frame's
 * back line as well as its sides and front, so all four edges are its own.
 */
const STAGE_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>([
  'top',
  'bottom',
  'left',
  'right',
]);

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
    key: 'club_casino_table',
    file: 'casino_table.png',
    widthTiles: 3,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawCasinoTable,
  },
  {
    key: 'club_poker_table',
    file: 'poker_table.png',
    widthTiles: 2,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 2,
    draw: drawPokerTable,
  },
  {
    key: 'club_slot_cabinet',
    file: 'slot_cabinet.png',
    widthTiles: 1,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: SLOT_CABINET_VARIANTS,
    draw: drawSlotCabinet,
  },
  // The bank's far row faces away across the aisle, so it is seen from behind.
  {
    key: 'club_slot_cabinet_back',
    file: 'slot_cabinet_back.png',
    widthTiles: 1,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: SLOT_CABINET_VARIANTS,
    draw: drawSlotCabinetBack,
  },
  // A light sheet's frames are chase phases rather than variants: the lit
  // bulbs alone, laid over the cabinet or wheel at the same anchor.
  {
    key: 'club_slot_lights',
    file: 'slot_lights.png',
    widthTiles: 1,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: CASINO_LIGHT_PHASES,
    draw: drawSlotCabinetLights,
  },
  {
    key: 'club_fortune_wheel',
    file: 'fortune_wheel.png',
    widthTiles: WHEEL_WIDTH_TILES,
    headroomTiles: WHEEL_HEADROOM_TILES,
    variants: 1,
    draw: drawFortuneWheel,
  },
  {
    key: 'club_fortune_wheel_lights',
    file: 'fortune_wheel_lights.png',
    widthTiles: WHEEL_WIDTH_TILES,
    headroomTiles: WHEEL_HEADROOM_TILES,
    variants: CASINO_LIGHT_PHASES,
    draw: drawFortuneWheelLights,
  },
  {
    key: 'club_croupier_counter',
    file: 'croupier_counter.png',
    widthTiles: 1,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 1,
    draw: drawCroupierCounter,
  },
  {
    key: 'club_stage',
    file: 'stage.png',
    widthTiles: STAGE_SIDE_TILES,
    headroomTiles: STAGE_SIDE_TILES - 1,
    variants: 1,
    draw: drawClubStage,
    groundedEdges: STAGE_GROUNDED_EDGES,
  },
  {
    key: 'club_host_stand',
    file: 'host_stand.png',
    widthTiles: 2,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: 1,
    draw: drawHostStand,
  },
  {
    key: 'club_standing_table',
    file: 'standing_table.png',
    widthTiles: 1,
    headroomTiles: COUNTER_HEADROOM_TILES,
    variants: STANDING_TABLE_VARIANTS,
    draw: drawStandingTable,
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
    ...(family.groundedEdges === undefined ? {} : { groundedEdges: family.groundedEdges }),
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
