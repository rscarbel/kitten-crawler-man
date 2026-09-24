import {
  BANNER_FRAMES,
  CAGE_BURST_FRAMES,
  CAGE_IDLE_FRAMES,
  CAGE_RATTLE_FRAMES,
  CHEER_FRAMES,
  MUD_SPLATTER_VARIANTS,
  PORTCULLIS_FRAMES,
  drawBanner,
  drawCage,
  drawCheeringSpectator,
  drawMudSplatter,
  drawPortcullis,
  type CageRow,
} from '../../art/colosseumArt';
import { COLOSSEUM_SPECTATOR_VARIANTS } from '../../../map/tiles/bossRooms/colosseumGeometry';
import type { FramePainter, PropSheetPlan } from '../propSheetPlan';
import { gymRoomSheetPlans } from './gymRoomSheets';

const GYM_PICKUPS_KEY = 'gym_pickups';

/** Source pixels per game tile: twice the game's own, so bars and rivets survive the downscale. */
export const COLOSSEUM_TILE_SCALE = 64;
const S = COLOSSEUM_TILE_SCALE;

/** The portcullis frame: the two-column door plus its jambs, and a tile of headroom for the lintel. */
const PORTCULLIS_FRAME_WIDTH = S * 2.5;
const PORTCULLIS_FRAME_HEIGHT = S * 2;
const PORTCULLIS_ANCHOR_X = S * 0.25;
const PORTCULLIS_ANCHOR_Y = S;
/**
 * A cage is one tile across, turned about the tile's middle; its frame reaches
 * further toward the pit (−y) than behind, for the doors swung open.
 */
const CAGE_FRAME_WIDTH = S;
const CAGE_FRAME_HEIGHT = S * 1.3125;
const CAGE_PIVOT_X = S / 2;
const CAGE_PIVOT_Y = S * 0.8125;
/** A cheering spectator: wide enough for flung-out arms, feet low in the frame so they have headroom. */
const CHEER_FRAME_WIDTH = S * 0.625;
const CHEER_FRAME_HEIGHT = S * 0.6875;
const CHEER_FEET_Y = S * 0.5625;
/** A banner hangs from the middle of its frame's top edge, a sliver below it. */
const BANNER_FRAME_WIDTH = S * 0.5;
const BANNER_FRAME_HEIGHT = S;
const BANNER_ANCHOR_X = BANNER_FRAME_WIDTH / 2;
const BANNER_ANCHOR_Y = S * 0.0625;
/** Mud splatter is centred in one tile. */
const SPLATTER_FRAME = S;
const SPLATTER_PIVOT = S / 2;

function frames(count: number, paint: (frame: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, frame) => paint(frame));
}

function cageRow(row: CageRow, count: number): PropSheetPlan['rows'][number] {
  return {
    state: row,
    frames: frames(count, (frame) => (ctx, x, y) => drawCage(ctx, x, y, S, row, frame)),
  };
}

/** The crowd's cheering row names, one per shirt palette. */
export const CHEER_ROWS = ['cheer0', 'cheer1', 'cheer2'] as const;

/**
 * The painted prop sheets that dress the Iron Colosseum. Its own art does not
 * vary with the floor: the ring is the same building on every run.
 */
export function colosseumSheetPlans(artSeed: number): PropSheetPlan[] {
  return [
    // The gym kit left lying in the ring is the gym's own pickup art, painted
    // here too because the gym's family is only requested on the gym's floor.
    ...gymRoomSheetPlans(artSeed).filter((plan) => plan.key === GYM_PICKUPS_KEY),
    {
      key: 'colosseum_portcullis',
      file: 'colosseum_portcullis.png',
      frameWidth: PORTCULLIS_FRAME_WIDTH,
      frameHeight: PORTCULLIS_FRAME_HEIGHT,
      tileX: PORTCULLIS_ANCHOR_X,
      tileY: PORTCULLIS_ANCHOR_Y,
      tileScale: S,
      rows: [
        {
          state: 'drop',
          frames: frames(
            PORTCULLIS_FRAMES,
            (frame) => (ctx, x, y) => drawPortcullis(ctx, x, y, S, frame),
          ),
        },
      ],
    },
    {
      key: 'colosseum_cage',
      file: 'colosseum_cage.png',
      frameWidth: CAGE_FRAME_WIDTH,
      frameHeight: CAGE_FRAME_HEIGHT,
      tileX: CAGE_PIVOT_X,
      tileY: CAGE_PIVOT_Y,
      tileScale: S,
      rows: [
        cageRow('idle', CAGE_IDLE_FRAMES),
        cageRow('rattle', CAGE_RATTLE_FRAMES),
        cageRow('burst', CAGE_BURST_FRAMES),
        cageRow('open', 1),
      ],
    },
    {
      key: 'colosseum_cheer',
      file: 'colosseum_cheer.png',
      frameWidth: CHEER_FRAME_WIDTH,
      frameHeight: CHEER_FRAME_HEIGHT,
      tileX: CHEER_FRAME_WIDTH / 2,
      tileY: CHEER_FEET_Y,
      tileScale: S,
      rows: CHEER_ROWS.slice(0, COLOSSEUM_SPECTATOR_VARIANTS).map((state, variant) => ({
        state,
        frames: frames(
          CHEER_FRAMES,
          (frame) => (ctx, x, y) => drawCheeringSpectator(ctx, x, y, S, variant, frame),
        ),
      })),
    },
    {
      key: 'colosseum_banner',
      file: 'colosseum_banner.png',
      frameWidth: BANNER_FRAME_WIDTH,
      frameHeight: BANNER_FRAME_HEIGHT,
      tileX: BANNER_ANCHOR_X,
      tileY: BANNER_ANCHOR_Y,
      tileScale: S,
      rows: [
        {
          state: 'sway',
          frames: frames(BANNER_FRAMES, (frame) => (ctx, x, y) => drawBanner(ctx, x, y, S, frame)),
        },
      ],
    },
    {
      key: 'colosseum_mud_splatter',
      file: 'colosseum_mud_splatter.png',
      frameWidth: SPLATTER_FRAME,
      frameHeight: SPLATTER_FRAME,
      tileX: SPLATTER_PIVOT,
      tileY: SPLATTER_PIVOT,
      tileScale: S,
      rows: [
        {
          state: 'splat',
          frames: frames(
            MUD_SPLATTER_VARIANTS,
            (variant) => (ctx, x, y) => drawMudSplatter(ctx, x, y, S, variant),
          ),
        },
      ],
    },
  ];
}
