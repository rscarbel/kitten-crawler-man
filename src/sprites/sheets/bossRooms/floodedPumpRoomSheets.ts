import {
  BARREL_FLOAT_FRAMES,
  BARREL_SETTLED_VARIANTS,
  BARREL_SHATTER_FRAMES,
  CHUTE_DRIP_FRAMES,
  CHUTE_POUR_FRAMES,
  DRAIN_SWIRL_FRAMES,
  PUMP_RUNNING_FRAMES,
  RAFT_CONDITIONS,
  RAFT_PIECES,
  RAFT_PLANK_VARIANTS,
  VALVE_TURN_FRAMES,
  paintBarrelStack,
  paintChute,
  paintDrainGrate,
  paintDrainSwirl,
  paintFloatingBarrel,
  paintPump,
  paintRaftTile,
  paintSettledBarrel,
  paintSettledBarrelBreak,
  paintUprightBarrel,
  paintValveWheel,
} from '../../art/floodedPumpRoomArt';
import { DEAD_SHARK_POSES, paintDeadShark } from '../../art/deadSharkArt';
import { PROP_VARIANT_COUNT } from '../../art/propPaint';
import type { FrameEdge, FramePainter, PropSheetPlan, PropSheetRow } from '../propSheetPlan';

/** Matches `TILE_SIZE`: the room's own sheets are blitted 1:1. */
const FLOODED_PUMP_ROOM_TILE_SCALE = 32;
const TS = FLOODED_PUMP_ROOM_TILE_SCALE;
/** The barrels are the cellar's own, painted at the destructible props' 64 px tile. */
const BARREL_TS = 64;

/** A raft tile is a tile of deck plus the deck's thickness hanging below a south edge. */
const RAFT_FRAME_HEIGHT = TS + TS / 4;
/** The pump overhangs half a tile each side and its riser climbs two tiles above its tile. */
const PUMP_FRAME_WIDTH = TS * 2;
const PUMP_TILE_X = TS / 2;
const PUMP_FRAME_HEIGHT = TS * 3;
const PUMP_TILE_Y = TS * 2;
/** The chute reaches two tiles back to the pump's riser and two and a half up to its pipe. */
const CHUTE_FRAME_SIZE = TS * 4;
const CHUTE_TILE_X = TS * 2;
const CHUTE_TILE_Y = TS * 2 + TS / 2;
/**
 * A dead great white lies across four tiles centred on its anchor tile, its
 * dorsal fin lifting half a tile above its row and its puddle spreading a tile
 * below it.
 */
const SHARK_FRAME_WIDTH = TS * 4;
const SHARK_TILE_X = TS + TS / 2;
const SHARK_FRAME_HEIGHT = TS * 2;
const SHARK_TILE_Y = TS / 2;
/** The cellar barrel's own envelope: a quarter tile round it for staves and splinters. */
const BARREL_FRAME_SIZE = BARREL_TS + BARREL_TS / 2;
const BARREL_TILE_OFFSET = BARREL_TS / 4;
/** Four barrels high, three of them above the anchor barrel. */
const STACK_FRAME_HEIGHT = BARREL_TS * 3 + BARREL_TS / 2;
const STACK_TILE_Y = BARREL_TS * 2 + BARREL_TS / 4;

function frames(count: number, paint: (frame: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, frame) => paint(frame));
}

function row(state: string, count: number, paint: (frame: number) => FramePainter): PropSheetRow {
  return { state, frames: frames(count, paint) };
}

/**
 * A raft's tiles, one row per piece position and condition, a frame per plank
 * look. Every edge is painted against on purpose: neighbouring tiles of one
 * raft meet edge to edge, and the face below a south edge fills the frame's
 * bottom.
 */
const raftPlan: PropSheetPlan = {
  key: 'flooded_pump_raft',
  file: 'flooded_pump_raft.png',
  frameWidth: TS,
  frameHeight: RAFT_FRAME_HEIGHT,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  groundedEdges: new Set<FrameEdge>(['top', 'bottom', 'left', 'right']),
  rows: RAFT_CONDITIONS.flatMap((condition) =>
    RAFT_PIECES.map((piece) =>
      row(
        `${condition}_${piece}`,
        RAFT_PLANK_VARIANTS,
        (variant) => (ctx, ox, oy) => paintRaftTile(ctx, ox, oy, TS, piece, condition, variant),
      ),
    ),
  ),
};

const pumpPlan: PropSheetPlan = {
  key: 'flooded_pump_pump',
  file: 'flooded_pump_pump.png',
  frameWidth: PUMP_FRAME_WIDTH,
  frameHeight: PUMP_FRAME_HEIGHT,
  tileX: PUMP_TILE_X,
  tileY: PUMP_TILE_Y,
  tileScale: TS,
  groundedEdges: new Set<FrameEdge>(['bottom']),
  rows: [
    row(
      'running',
      PUMP_RUNNING_FRAMES,
      (frame) => (ctx, ox, oy) => paintPump(ctx, ox, oy, TS, true, frame),
    ),
    row('off', 1, () => (ctx, ox, oy) => paintPump(ctx, ox, oy, TS, false, 0)),
  ],
};

const valvePlan: PropSheetPlan = {
  key: 'flooded_pump_valve',
  file: 'flooded_pump_valve.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  rows: [
    row(
      'turn',
      VALVE_TURN_FRAMES,
      (frame) => (ctx, ox, oy) => paintValveWheel(ctx, ox, oy, TS, frame),
    ),
  ],
};

const chutePlan: PropSheetPlan = {
  key: 'flooded_pump_chute',
  file: 'flooded_pump_chute.png',
  frameWidth: CHUTE_FRAME_SIZE,
  frameHeight: CHUTE_FRAME_SIZE,
  tileX: CHUTE_TILE_X,
  tileY: CHUTE_TILE_Y,
  tileScale: TS,
  rows: [
    row(
      'pour',
      CHUTE_POUR_FRAMES,
      (frame) => (ctx, ox, oy) => paintChute(ctx, ox, oy, TS, true, frame),
    ),
    row(
      'drip',
      CHUTE_DRIP_FRAMES,
      (frame) => (ctx, ox, oy) => paintChute(ctx, ox, oy, TS, false, frame),
    ),
  ],
};

const deadSharkPlan: PropSheetPlan = {
  key: 'flooded_pump_dead_shark',
  file: 'flooded_pump_dead_shark.png',
  frameWidth: SHARK_FRAME_WIDTH,
  frameHeight: SHARK_FRAME_HEIGHT,
  tileX: SHARK_TILE_X,
  tileY: SHARK_TILE_Y,
  tileScale: TS,
  rows: [
    {
      state: 'beached',
      frames: DEAD_SHARK_POSES.map(
        (pose): FramePainter =>
          (ctx, ox, oy) =>
            paintDeadShark(ctx, ox, oy, TS, pose),
      ),
    },
  ],
};

const barrelPlan: PropSheetPlan = {
  key: 'flooded_pump_barrel',
  file: 'flooded_pump_barrel.png',
  frameWidth: BARREL_FRAME_SIZE,
  frameHeight: BARREL_FRAME_SIZE,
  tileX: BARREL_TILE_OFFSET,
  tileY: BARREL_TILE_OFFSET,
  tileScale: BARREL_TS,
  rows: [
    row('upright', 1, () => (ctx, ox, oy) => paintUprightBarrel(ctx, ox, oy, BARREL_TS)),
    row(
      'floating',
      BARREL_FLOAT_FRAMES,
      (frame) => (ctx, ox, oy) => paintFloatingBarrel(ctx, ox, oy, BARREL_TS, frame),
    ),
    row(
      'settled',
      BARREL_SETTLED_VARIANTS,
      (variant) => (ctx, ox, oy) => paintSettledBarrel(ctx, ox, oy, BARREL_TS, variant),
    ),
    row(
      'damaged',
      PROP_VARIANT_COUNT,
      (variant) => (ctx, ox, oy) =>
        paintSettledBarrelBreak(ctx, ox, oy, BARREL_TS, 'damaged', variant),
    ),
    row(
      'shatter',
      BARREL_SHATTER_FRAMES,
      (frame) => (ctx, ox, oy) => paintSettledBarrelBreak(ctx, ox, oy, BARREL_TS, 'shatter', frame),
    ),
    row(
      'remains',
      PROP_VARIANT_COUNT,
      (variant) => (ctx, ox, oy) =>
        paintSettledBarrelBreak(ctx, ox, oy, BARREL_TS, 'remains', variant),
    ),
  ],
};

const barrelStackPlan: PropSheetPlan = {
  key: 'flooded_pump_barrel_stack',
  file: 'flooded_pump_barrel_stack.png',
  frameWidth: BARREL_FRAME_SIZE,
  frameHeight: STACK_FRAME_HEIGHT,
  tileX: BARREL_TILE_OFFSET,
  tileY: STACK_TILE_Y,
  tileScale: BARREL_TS,
  rows: [
    row('stack_3', 1, () => (ctx, ox, oy) => paintBarrelStack(ctx, ox, oy, BARREL_TS, 3)),
    row('stack_4', 1, () => (ctx, ox, oy) => paintBarrelStack(ctx, ox, oy, BARREL_TS, 4)),
  ],
};

/** A drain fills its tile; the swirl spreads over the water round it. */
const drainPlan: PropSheetPlan = {
  key: 'flooded_pump_drain',
  file: 'flooded_pump_drain.png',
  frameWidth: TS,
  frameHeight: TS,
  tileX: 0,
  tileY: 0,
  tileScale: TS,
  groundedEdges: new Set<FrameEdge>(['top', 'bottom', 'left', 'right']),
  rows: [
    row('grate', 1, () => (ctx, ox, oy) => paintDrainGrate(ctx, ox, oy, TS)),
    row(
      'swirl',
      DRAIN_SWIRL_FRAMES,
      (frame) => (ctx, ox, oy) => paintDrainSwirl(ctx, ox, oy, TS, frame),
    ),
  ],
};

/**
 * The painted prop sheets that dress the Kraken's flooded pump room. Requested
 * when the floor loads, so they are ready before the room is seen.
 *
 * The art does not vary with the floor's seed: a raft's look comes from where
 * each tile sits in it, not from the floor.
 */
export function floodedPumpRoomSheetPlans(_artSeed: number): PropSheetPlan[] {
  return [
    raftPlan,
    pumpPlan,
    valvePlan,
    chutePlan,
    deadSharkPlan,
    barrelPlan,
    barrelStackPlan,
    drainPlan,
  ];
}
