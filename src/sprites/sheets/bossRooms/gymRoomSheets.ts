/**
 * The Juicer's gym, as painted sheets: its racks, its treadmills' belts and
 * consoles, the boombox, the shutter, the bowled plate, chalk, the mirror
 * crack, and the three pieces of kit a crawler can carry off (bench,
 * treadmill, dumbbell). The colosseum's pickups blit the same frames.
 *
 * Painted at twice the game's tile size so the chrome and the lettering survive
 * the downscale. Nothing here is seeded: a squat rack is the same squat rack on
 * every floor.
 */

import {
  GYM_BELT_FRAMES,
  GYM_CHALK_FRAMES,
  GYM_PLATE_FRAMES,
  GYM_RACK_SLOTS,
  GYM_SHUTTER_FRAMES,
  drawGymBeltTile,
  drawGymBoombox,
  drawGymCableStack,
  drawGymChalkPuff,
  drawGymMirrorCrack,
  drawGymPlate,
  drawGymRack,
  drawGymShutter,
  drawGymSquatRack,
  drawGymTreadmillConsole,
} from '../../art/gymRoomArt';
import {
  drawBenchPressFloor,
  drawDumbbellFloor,
  drawTreadmillFloor,
} from '../../gymEquipmentSprite';
import type { FramePainter, PropSheetPlan } from '../propSheetPlan';

/** Source pixels per game tile. */
export const GYM_TILE_SCALE = 64;
const S = GYM_TILE_SCALE;

/** A row of `count` frames, each painted by `paint(frameIndex)`. */
function frames(count: number, paint: (index: number) => FramePainter): FramePainter[] {
  return Array.from({ length: count }, (_, index) => paint(index));
}

/** Shares of a cycle a frame index stands for, so frame 0 is phase 0 and the last is just short of 1. */
function phaseOf(index: number, count: number): number {
  return index / count;
}

/**
 * Frame envelopes, in tiles: how tall each frame is and how far down it the
 * anchor tile's top edge sits — the headroom the art rises into above its tile.
 */
const RACK_FRAME_TILES = 1.75;
const RACK_HEADROOM_TILES = 0.75;
const TOWER_FRAME_TILES = 3;
const TOWER_HEADROOM_TILES = 1.75;
const CONSOLE_FRAME_TILES = 1.5;
const CONSOLE_HEADROOM_TILES = 0.75;
const BOOMBOX_FRAME_TILES = 1.25;
const BOOMBOX_HEADROOM_TILES = 0.25;
/** The chalk puff billows a quarter tile past its tile on every side. */
const PUFF_FRAME_TILES = 1.5;
const PUFF_MARGIN_TILES = 0.25;
/** The crack runs three tiles along the wall, with an eighth of a tile spare above and below. */
const CRACK_FRAME_WIDTH_TILES = 3;
const CRACK_FRAME_TILES = 1.25;
const CRACK_MARGIN_TILES = 0.125;
/** A pickup's bar and plates overhang half a tile each side, its console three quarters above. */
const PICKUP_FRAME_TILES = 2;
const PICKUP_SIDE_MARGIN_TILES = 0.5;
const PICKUP_HEADROOM_TILES = 0.75;

/** Two frames of a blink: lit, then dim. */
const BLINK_FRAMES = 2;
const THUMP_FRAMES = 2;
/** The shutter's last frame is fully down. */
const SHUTTER_LAST_FRAME = GYM_SHUTTER_FRAMES - 1;
/** The belt's frame tile sits one pixel in from the frame edge, so its full-bleed art touches no border. */
const BELT_FRAME_MARGIN_PX = 1;

export function gymRoomSheetPlans(_artSeed: number): PropSheetPlan[] {
  return [
    {
      key: 'gym_rack',
      file: 'gym_rack.png',
      frameWidth: S,
      frameHeight: S * RACK_FRAME_TILES,
      tileX: 0,
      tileY: S * RACK_HEADROOM_TILES,
      tileScale: S,
      rows: [
        {
          state: 'rack',
          frames: frames(
            GYM_RACK_SLOTS + 1,
            (filled) => (ctx, ox, oy) => drawGymRack(ctx, ox, oy, S, filled),
          ),
        },
      ],
    },
    {
      key: 'gym_squat_rack',
      file: 'gym_squat_rack.png',
      frameWidth: S,
      frameHeight: S * TOWER_FRAME_TILES,
      tileX: 0,
      tileY: S * TOWER_HEADROOM_TILES,
      tileScale: S,
      rows: [
        { state: 'loaded', frames: [(ctx, ox, oy) => drawGymSquatRack(ctx, ox, oy, S, true)] },
        { state: 'stripped', frames: [(ctx, ox, oy) => drawGymSquatRack(ctx, ox, oy, S, false)] },
      ],
    },
    {
      key: 'gym_cable_stack',
      file: 'gym_cable_stack.png',
      frameWidth: S,
      frameHeight: S * TOWER_FRAME_TILES,
      tileX: 0,
      tileY: S * TOWER_HEADROOM_TILES,
      tileScale: S,
      rows: [{ state: 'idle', frames: [(ctx, ox, oy) => drawGymCableStack(ctx, ox, oy, S)] }],
    },
    {
      key: 'gym_belt',
      file: 'gym_belt.png',
      frameWidth: S + BELT_FRAME_MARGIN_PX * 2,
      frameHeight: S + BELT_FRAME_MARGIN_PX * 2,
      tileX: BELT_FRAME_MARGIN_PX,
      tileY: BELT_FRAME_MARGIN_PX,
      tileScale: S,
      rows: [
        {
          state: 'run',
          frames: frames(
            GYM_BELT_FRAMES,
            (index) => (ctx, ox, oy) =>
              drawGymBeltTile(ctx, ox, oy, S, phaseOf(index, GYM_BELT_FRAMES), true),
          ),
        },
      ],
    },
    {
      key: 'gym_console',
      file: 'gym_console.png',
      frameWidth: S,
      frameHeight: S * CONSOLE_FRAME_TILES,
      tileX: 0,
      tileY: S * CONSOLE_HEADROOM_TILES,
      tileScale: S,
      rows: [
        {
          state: 'off',
          frames: [(ctx, ox, oy) => drawGymTreadmillConsole(ctx, ox, oy, S, 'off', false)],
        },
        {
          state: 'on',
          frames: frames(
            BLINK_FRAMES,
            (index) => (ctx, ox, oy) => drawGymTreadmillConsole(ctx, ox, oy, S, 'on', index === 0),
          ),
        },
        {
          state: 'beep',
          frames: frames(
            BLINK_FRAMES,
            (index) => (ctx, ox, oy) =>
              drawGymTreadmillConsole(ctx, ox, oy, S, 'beep', index === 0),
          ),
        },
      ],
    },
    {
      key: 'gym_boombox',
      file: 'gym_boombox.png',
      frameWidth: S,
      frameHeight: S * BOOMBOX_FRAME_TILES,
      tileX: 0,
      tileY: S * BOOMBOX_HEADROOM_TILES,
      tileScale: S,
      rows: [
        { state: 'intact', frames: [(ctx, ox, oy) => drawGymBoombox(ctx, ox, oy, S, 'intact', 0)] },
        {
          state: 'thump',
          frames: frames(
            THUMP_FRAMES,
            (index) => (ctx, ox, oy) =>
              drawGymBoombox(ctx, ox, oy, S, 'thump', phaseOf(index + 1, THUMP_FRAMES + 1)),
          ),
        },
        { state: 'broken', frames: [(ctx, ox, oy) => drawGymBoombox(ctx, ox, oy, S, 'broken', 0)] },
      ],
    },
    {
      key: 'gym_shutter',
      file: 'gym_shutter.png',
      frameWidth: S + BELT_FRAME_MARGIN_PX * 2,
      frameHeight: S + BELT_FRAME_MARGIN_PX * 2,
      tileX: BELT_FRAME_MARGIN_PX,
      tileY: BELT_FRAME_MARGIN_PX,
      tileScale: S,
      rows: [
        {
          state: 'roll',
          frames: frames(
            GYM_SHUTTER_FRAMES,
            (index) => (ctx, ox, oy) => drawGymShutter(ctx, ox, oy, S, index / SHUTTER_LAST_FRAME),
          ),
        },
      ],
    },
    {
      key: 'gym_plate',
      file: 'gym_plate.png',
      frameWidth: S,
      frameHeight: S,
      tileX: 0,
      tileY: 0,
      tileScale: S,
      rows: [
        {
          state: 'roll',
          frames: frames(
            GYM_PLATE_FRAMES,
            (index) => (ctx, ox, oy) => drawGymPlate(ctx, ox, oy, S, index),
          ),
        },
      ],
    },
    {
      key: 'gym_chalk_puff',
      file: 'gym_chalk_puff.png',
      frameWidth: S * PUFF_FRAME_TILES,
      frameHeight: S * PUFF_FRAME_TILES,
      tileX: S * PUFF_MARGIN_TILES,
      tileY: S * PUFF_MARGIN_TILES,
      tileScale: S,
      rows: [
        {
          state: 'puff',
          frames: frames(
            GYM_CHALK_FRAMES,
            (index) => (ctx, ox, oy) => drawGymChalkPuff(ctx, ox, oy, S, index),
          ),
        },
      ],
    },
    {
      key: 'gym_mirror_crack',
      file: 'gym_mirror_crack.png',
      frameWidth: S * CRACK_FRAME_WIDTH_TILES,
      frameHeight: S * CRACK_FRAME_TILES,
      tileX: 0,
      tileY: S * CRACK_MARGIN_TILES,
      tileScale: S,
      rows: [{ state: 'crack', frames: [(ctx, ox, oy) => drawGymMirrorCrack(ctx, ox, oy, S)] }],
    },
    {
      key: 'gym_pickups',
      file: 'gym_pickups.png',
      frameWidth: S * PICKUP_FRAME_TILES,
      frameHeight: S * PICKUP_FRAME_TILES,
      tileX: S * PICKUP_SIDE_MARGIN_TILES,
      tileY: S * PICKUP_HEADROOM_TILES,
      tileScale: S,
      rows: [
        { state: 'bench', frames: [(ctx, ox, oy) => drawBenchPressFloor(ctx, ox, oy, S)] },
        { state: 'treadmill', frames: [(ctx, ox, oy) => drawTreadmillFloor(ctx, ox, oy, S)] },
        { state: 'dumbbell', frames: [(ctx, ox, oy) => drawDumbbellFloor(ctx, ox, oy, S)] },
      ],
    },
  ];
}
