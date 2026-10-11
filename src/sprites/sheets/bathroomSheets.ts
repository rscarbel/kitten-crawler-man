/**
 * The clogged bathroom's sheets: the stall in each door and tag state with its
 * "OUT OF ORDER" sign as a row of its own, the pipe access panel broken and
 * fixed, the wall sink for either side wall, and the floor pieces (the plunger
 * and the puddles).
 *
 * The stall and the pipe panel hang on the north wall face, so their frames are
 * anchored on the floor tile at the face's foot and rise two tiles above it;
 * the frame stops a thin lip into that tile, for the threshold shadow. They
 * paint the tiled wall edge to edge on purpose, so those two edges are grounded.
 * The sign shares the stall's envelope so it lands on the door it is taped to.
 */

import {
  FACE_FOOT_LIP_TILES,
  PUDDLE_VARIANTS,
  STALL_ART_WIDTH_TILES,
  paintBathroomSink,
  paintBathroomStall,
  paintOutOfOrderSign,
  paintPipeWall,
  paintPlunger,
  paintPuddle,
  type StallDoor,
  type StallTag,
} from '../art/bathroomRoomArt';
import type { FrameEdge, FramePainter, PropSheetPlan, PropSheetRow } from './propSheetPlan';

/** Source pixels per game tile: twice the game's tile, downscaled at draw time. */
export const BATHROOM_TILE_SCALE = 64;

/** A face is two tiles tall above the tile at its foot. */
const FACE_HEADROOM = BATHROOM_TILE_SCALE * 2;
const FACE_FOOT_LIP = Math.ceil(BATHROOM_TILE_SCALE * FACE_FOOT_LIP_TILES);
/** Clearance round a sink for its mirror's frame and its shadow. */
const SINK_MARGIN = 16;
/** The mirror strip rises a tile above the sink's own tile. */
const SINK_HEADROOM = BATHROOM_TILE_SCALE;

const FACE_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['left', 'right']);

/** Every door and tag a stall can show, in sheet order. */
export const STALL_STATES: ReadonlyArray<{ readonly door: StallDoor; readonly tag: StallTag }> = [
  { door: 'shut', tag: 'vacant' },
  { door: 'shut', tag: 'occupied' },
  { door: 'open', tag: 'vacant' },
  { door: 'open', tag: 'occupied' },
];

function single(paint: FramePainter): ReadonlyArray<FramePainter> {
  return [paint];
}

function stallSheet(): PropSheetPlan {
  const rows: PropSheetRow[] = STALL_STATES.map(({ door, tag }) => ({
    state: `${door}_${tag}`,
    frames: single((ctx, originX, originY) => {
      paintBathroomStall(ctx, originX, originY, BATHROOM_TILE_SCALE, door, tag);
    }),
  }));
  rows.push({
    state: 'out_of_order',
    frames: single((ctx, originX, originY) => {
      paintOutOfOrderSign(ctx, originX, originY, BATHROOM_TILE_SCALE);
    }),
  });
  return {
    key: 'bathroom_stall',
    file: 'bathroom_stall.png',
    tileScale: BATHROOM_TILE_SCALE,
    frameWidth: BATHROOM_TILE_SCALE * STALL_ART_WIDTH_TILES,
    frameHeight: FACE_HEADROOM + FACE_FOOT_LIP,
    tileX: 0,
    tileY: FACE_HEADROOM,
    rows,
    groundedEdges: FACE_EDGES,
  };
}

function pipeWallSheet(): PropSheetPlan {
  const rows: PropSheetRow[] = (['broken', 'fixed'] as const).map((state) => ({
    state,
    frames: single((ctx, originX, originY) => {
      paintPipeWall(ctx, originX, originY, BATHROOM_TILE_SCALE, state === 'broken');
    }),
  }));
  return {
    key: 'bathroom_pipe_wall',
    file: 'bathroom_pipe_wall.png',
    tileScale: BATHROOM_TILE_SCALE,
    frameWidth: BATHROOM_TILE_SCALE,
    frameHeight: FACE_HEADROOM + FACE_FOOT_LIP,
    tileX: 0,
    tileY: FACE_HEADROOM,
    rows,
    groundedEdges: FACE_EDGES,
  };
}

function sinkSheet(): PropSheetPlan {
  const rows: PropSheetRow[] = (['west', 'east'] as const).map((side) => ({
    state: side,
    frames: single((ctx, originX, originY) => {
      paintBathroomSink(ctx, originX, originY, BATHROOM_TILE_SCALE, side);
    }),
  }));
  return {
    key: 'bathroom_sink',
    file: 'bathroom_sink.png',
    tileScale: BATHROOM_TILE_SCALE,
    frameWidth: BATHROOM_TILE_SCALE + SINK_MARGIN * 2,
    frameHeight: SINK_HEADROOM + BATHROOM_TILE_SCALE + SINK_MARGIN,
    tileX: SINK_MARGIN,
    tileY: SINK_HEADROOM,
    rows,
  };
}

/** The floor pieces sit wholly inside their tile, so their frame is exactly one tile. */
function decalSheet(): PropSheetPlan {
  return {
    key: 'bathroom_decals',
    file: 'bathroom_decals.png',
    tileScale: BATHROOM_TILE_SCALE,
    frameWidth: BATHROOM_TILE_SCALE,
    frameHeight: BATHROOM_TILE_SCALE,
    tileX: 0,
    tileY: 0,
    rows: [
      {
        state: 'plunger',
        frames: single((ctx, originX, originY) => {
          paintPlunger(ctx, originX, originY, BATHROOM_TILE_SCALE);
        }),
      },
      {
        state: 'puddle',
        frames: Array.from(
          { length: PUDDLE_VARIANTS },
          (_, variant): FramePainter =>
            (ctx, originX, originY) => {
              paintPuddle(ctx, originX, originY, BATHROOM_TILE_SCALE, variant);
            },
        ),
      },
    ],
  };
}

/**
 * Every clogged-bathroom sheet. Unseeded: the fittings are the same in every
 * copy of the room on every run.
 */
export function bathroomSheetPlans(): PropSheetPlan[] {
  return [stallSheet(), pipeWallSheet(), sinkSheet(), decalSheet()];
}
