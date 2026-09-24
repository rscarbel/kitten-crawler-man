import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { SpiderLabRoomData } from '../../map/DungeonGenerator';
import { doorFrame } from '../../map/spiderLabLayout';

/**
 * The spider lab's ceiling light banks, and the darkness her roars leave when
 * they blow them out.
 *
 * The darkness is one mask per lighting phase, painted once at a quarter of
 * the room's resolution with the surviving banks' pools cut out of it, and
 * stretched over the room with a single blit. A full-resolution mask of a room
 * this size would be over a megabyte per phase at 1× and four times that on a
 * high-density screen; darkness is soft, so a quarter is indistinguishable.
 */

/** The mask is painted at this fraction of the room's world resolution. */
export const DARKNESS_MASK_SCALE = 0.25;

/**
 * A clear border round the mask, in mask pixels, that a blit never samples.
 * Stretching a source rectangle that touches its image's edge makes a CPU
 * canvas pad the edge for every sample, which measured nearly ten times the
 * cost of the same stretch kept clear of it.
 */
export const DARKNESS_MASK_PAD_PX = 2;

/** How dark a blown-out lab gets where no light reaches. */
const DARKNESS_RGB = '6,4,12';
const DARKNESS_ALPHA = 0.8;

/** A surviving bank's pool of light, in tiles: wide along the tubes, shallower across them. */
const POOL_RADIUS_TILES = 6.5;
const POOL_SQUASH = 0.72;
/** How much of a pool's radius is lit fully before it fades into the dark. */
const POOL_CORE = 0.35;
/** The life machines' lamps and the terminal's screen still throw a little light. */
const MACHINE_GLOW_TILES = 1.8;
const MACHINE_GLOW_STRENGTH = 0.55;
const TERMINAL_GLOW_TILES = 2.4;
const TERMINAL_GLOW_STRENGTH = 0.7;

/** The lighting phases: every bank lit, half blown by her first roar, one more by her second. */
export type LabLightPhase = 1 | 2 | 3;
/** The phases that begin with a roar, and so can blow a bank. */
export type BlowingPhase = Exclude<LabLightPhase, 1>;
/** Her last phase, whose roar leaves the room at its darkest. */
export const LAST_LIGHT_PHASE = 3;
/** The phase her first roar begins. */
export const FIRST_DARK_PHASE = 2;

export interface LightBank {
  /** The pool's centre on the floor, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** The phase whose roar blows this bank, or null for a bank that survives the fight. */
  readonly blownIn: BlowingPhase | null;
}

/**
 * Where the banks hang, in the doorway's frame as shares of the room's reach:
 * a pair over the entrance, one over the middle, a pair either side of it and
 * a pair over the far end. Her first roar takes the far pair and one flank; her
 * second takes the other flank, leaving the middle and the entrance lit.
 */
const BANK_LAYOUT: ReadonlyArray<{ along: number; depth: number; blownIn: BlowingPhase | null }> = [
  { along: -0.45, depth: 0.2, blownIn: null },
  { along: 0.45, depth: 0.2, blownIn: null },
  { along: 0, depth: 0.5, blownIn: null },
  { along: -0.55, depth: 0.5, blownIn: 2 },
  { along: 0.55, depth: 0.5, blownIn: 3 },
  { along: -0.45, depth: 0.82, blownIn: 2 },
  { along: 0.45, depth: 0.82, blownIn: 2 },
];

const HALF = 0.5;

/** The lab's light banks, placed against its doorway so the entrance stays lit. */
export function labLightBanks(room: SpiderLabRoomData): LightBank[] {
  const frame = doorFrame(room.bounds, room.entranceWall);
  return BANK_LAYOUT.map((bank) => {
    const tile = frame.toWorld({
      along: Math.round(bank.along * frame.alongMax),
      depth: Math.round(bank.depth * frame.depthMax),
    });
    return {
      x: (tile.x + HALF) * TILE_SIZE,
      y: (tile.y + HALF) * TILE_SIZE,
      blownIn: bank.blownIn,
    };
  });
}

/** Whether a bank still burns in a lighting phase. */
export function bankLitIn(bank: LightBank, phase: LabLightPhase): boolean {
  return bank.blownIn === null || bank.blownIn > phase;
}

/** Bytes a mask of this room holds, for the memory gate. */
export function darknessMaskBytes(room: SpiderLabRoomData): number {
  const BYTES_PER_PIXEL = 4;
  const { width, height } = maskSize(room);
  const padded = (width + DARKNESS_MASK_PAD_PX * 2) * (height + DARKNESS_MASK_PAD_PX * 2);
  return padded * BYTES_PER_PIXEL;
}

/**
 * The rectangle the dark covers, in tiles: the room and the walls round it,
 * so the walls go dark with the floor instead of framing it in light.
 */
export function darknessBounds(room: SpiderLabRoomData): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: room.bounds.x - WALL_RING_TILES,
    y: room.bounds.y - WALL_RING_TILES,
    w: room.bounds.w + WALL_RING_TILES * 2,
    h: room.bounds.h + WALL_RING_TILES * 2,
  };
}
const WALL_RING_TILES = 2;
/** The outer ring of the dark thins out to nothing, so it has no hard edge on the corridor walls. */
const EDGE_FEATHER_TILES = 1.5;

function maskSize(room: SpiderLabRoomData): { width: number; height: number } {
  const bounds = darknessBounds(room);
  return {
    width: Math.ceil(bounds.w * TILE_SIZE * DARKNESS_MASK_SCALE),
    height: Math.ceil(bounds.h * TILE_SIZE * DARKNESS_MASK_SCALE),
  };
}

/**
 * Paints the darkness for one lighting phase: the room filled dark, with a
 * soft pool cut out under every bank still burning and a glimmer left round
 * the machines and the terminal.
 */
export function bakeDarknessMask(
  room: SpiderLabRoomData,
  banks: readonly LightBank[],
  phase: LabLightPhase,
): CanvasSurface {
  const { width, height } = maskSize(room);
  const surface = allocCanvas(width + DARKNESS_MASK_PAD_PX * 2, height + DARKNESS_MASK_PAD_PX * 2);
  const ctx = surfaceContext(surface);
  ctx.translate(DARKNESS_MASK_PAD_PX, DARKNESS_MASK_PAD_PX);
  ctx.fillStyle = `rgba(${DARKNESS_RGB},${DARKNESS_ALPHA})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-out';
  const feather = EDGE_FEATHER_TILES * TILE_SIZE * DARKNESS_MASK_SCALE;
  const edges: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0, 0, feather],
    [0, height, 0, height - feather],
    [0, 0, feather, 0],
    [width, 0, width - feather, 0],
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const ramp = ctx.createLinearGradient(x0, y0, x1, y1);
    ramp.addColorStop(0, 'rgba(0,0,0,1)');
    ramp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ramp;
    ctx.fillRect(0, 0, width, height);
  }
  const origin = darknessBounds(room);
  const toMask = (worldPx: number, originTiles: number): number =>
    (worldPx - originTiles * TILE_SIZE) * DARKNESS_MASK_SCALE;
  const cut = (
    x: number,
    y: number,
    radiusTiles: number,
    strength: number,
    squash: number,
  ): void => {
    const radius = radiusTiles * TILE_SIZE * DARKNESS_MASK_SCALE;
    ctx.save();
    try {
      ctx.translate(toMask(x, origin.x), toMask(y, origin.y));
      ctx.scale(1, squash);
      const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      pool.addColorStop(0, `rgba(0,0,0,${strength})`);
      pool.addColorStop(POOL_CORE, `rgba(0,0,0,${strength * POOL_CORE_KEEP})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    } finally {
      ctx.restore();
    }
  };
  for (const bank of banks) {
    if (bankLitIn(bank, phase)) cut(bank.x, bank.y, POOL_RADIUS_TILES, 1, POOL_SQUASH);
  }
  for (const machine of room.lifeMachineTiles) {
    cut(
      (machine.x + HALF) * TILE_SIZE,
      (machine.y + HALF) * TILE_SIZE,
      MACHINE_GLOW_TILES,
      MACHINE_GLOW_STRENGTH,
      1,
    );
  }
  cut(
    (room.computerTile.x + HALF) * TILE_SIZE,
    (room.computerTile.y + HALF) * TILE_SIZE,
    TERMINAL_GLOW_TILES,
    TERMINAL_GLOW_STRENGTH,
    1,
  );
  ctx.globalCompositeOperation = 'source-over';
  return surface;
}
/** How much of a pool's full cut is kept at the edge of its core. */
const POOL_CORE_KEEP = 0.85;
