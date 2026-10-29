/**
 * Draws the Kraken's flooded pump room's props from their painted sheets
 * (`sheets/bossRooms/floodedPumpRoomSheets.ts`): rafts of any size, the pumps
 * and their outflow chutes, the barrels from their stack to the bottom of the
 * drained room, the floor drains and the dead shark.
 *
 * Every function is pure in its arguments: a position, a size or state, and
 * the world tick (`frame`) that drives its animation, so the room can draw the
 * same picture from a checkpoint as it did live. Positions are the screen
 * pixels of the anchor tile's top-left corner unless a function says
 * otherwise.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/rendering/canvasSurface';
import { getSpriteDef } from '../core/spriteAssets/SpriteLoader';
import { drawSpriteKey } from '../core/spriteAssets/SpriteRenderer';
import {
  BARREL_FLOAT_FRAMES,
  BARREL_SETTLED_VARIANTS,
  BARREL_SHATTER_FRAMES,
  BARREL_STACK_STEP_PX,
  CHUTE_DRIP_FRAMES,
  CHUTE_POUR_FRAMES,
  DRAIN_SWIRL_FRAMES,
  PUMP_RUNNING_FRAMES,
  PUMP_VALVE_CENTRE_TILES,
  RAFT_PLANK_VARIANTS,
  VALVE_SPOKES,
  VALVE_TURN_FRAMES,
  type BarrelStackHeight,
  type RaftCondition,
  type RaftPiece,
} from './art/floodedPumpRoomArt';
import { DEAD_SHARK_VARIANTS } from './art/deadSharkArt';

export {
  BARREL_STACK_HEIGHTS,
  OUTFLOW_PIPE_Y_TILES,
  PUMP_OUTFALL_OFFSET_TILES,
  PUMP_VALVE_CENTRE_TILES,
  type BarrelStackHeight,
  type RaftCondition,
} from './art/floodedPumpRoomArt';

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/** World ticks each animation frame holds for. */
const PUMP_TICKS_PER_FRAME = 4;
const CHUTE_TICKS_PER_FRAME = 5;
const CHUTE_DRIP_TICKS_PER_FRAME = 14;
const BARREL_FLOAT_TICKS_PER_FRAME = 18;
const DRAIN_SWIRL_TICKS_PER_FRAME = 6;

/** The barrel sheets are painted at the cellar barrel's own tile. */
const BARREL_TILE_SCALE = 64;

function loopFrame(frame: number, ticksPerFrame: number, count: number): number {
  const index = Math.floor(frame / ticksPerFrame) % count;
  return index < 0 ? index + count : index;
}

/** A small fixed hash, so a raft's tiles and phase come out the same every frame. */
function hash(seed: number, a: number, b: number): number {
  let h =
    Math.imul(seed ^ HASH_SALT_A, HASH_MUL_A) ^
    Math.imul(a + 1, HASH_MUL_B) ^
    Math.imul(b + 1, HASH_MUL_C);
  h ^= h >>> HASH_SHIFT;
  return h >>> 0;
}
const HASH_SALT_A = 0x5bd1e995;
const HASH_MUL_A = 0x27d4eb2d;
const HASH_MUL_B = 0x165667b1;
const HASH_MUL_C = 0x9e3779b1;
const HASH_SHIFT = 15;

// ── Rafts ────────────────────────────────────────────────────────────────────

/** The smallest raft, in tiles a side, whose pieces tile without a corner meeting a corner. */
const RAFT_MIN_ART_TILES = 2;

/** Ticks a raft takes to rise and fall once. */
const RAFT_BOB_PERIOD_TICKS = 150;
/** Pixels a raft rises and falls at the 32 px tile. */
const RAFT_BOB_AMPLITUDE_TILES = 1 / 32;
const RAFT_SHADOW = 'rgba(8, 12, 9, 0.3)';
const RAFT_SHADOW_DROP_TILES = 0.22;
const RAFT_SHADOW_SHIFT_TILES = 0.08;
const RAFT_SETTLED_SHADOW = 'rgba(8, 8, 6, 0.42)';
const RAFT_SETTLED_SHADOW_DROP_TILES = 0.12;
const RAFT_WATERLINE = 'rgba(196, 202, 182, 0.4)';
const RAFT_WATERLINE_PERIOD_TICKS = 90;
const RAFT_WATERLINE_REACH_TILES = 0.03;

/**
 * How far a floating raft has risen this tick, in whole screen pixels (up is
 * negative). Exposed so whoever stands on the raft can ride it.
 */
function raftBobOffsetPx(frame: number, seed: number, tileSize: number): number {
  const phase = (hash(seed, 0, 0) / UINT32_RANGE) * TWO_PI;
  const wave = Math.sin((frame / RAFT_BOB_PERIOD_TICKS) * TWO_PI + phase);
  return Math.round(wave * tileSize * RAFT_BOB_AMPLITUDE_TILES);
}
const UINT32_RANGE = 0x100000000;

function raftPiece(col: number, row: number, widthTiles: number, heightTiles: number): RaftPiece {
  const north = row === 0;
  const south = row === heightTiles - 1;
  const west = col === 0;
  const east = col === widthTiles - 1;
  if (north) return west ? 'nw' : east ? 'ne' : 'n';
  if (south) return west ? 'sw' : east ? 'se' : 's';
  return west ? 'w' : east ? 'e' : 'c';
}

/**
 * A plank raft covering `widthTiles` × `heightTiles` tiles from (`sx`, `sy`).
 * Afloat it bobs with {@link raftBobOffsetPx}, throws a soft shadow into the
 * murk and laps a waterline round its edge; settled it sits flat on the
 * drained floor. `seed` picks its plank looks and bob phase, so give every
 * raft its own.
 */
export function drawFloodedPumpRaft(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  widthTiles: number,
  heightTiles: number,
  tileSize: number,
  condition: RaftCondition,
  frame: number,
  seed: number,
): void {
  const w = Math.max(RAFT_MIN_ART_TILES, widthTiles);
  const h = Math.max(RAFT_MIN_ART_TILES, heightTiles);
  const floating = condition === 'floating';
  const bob = floating ? raftBobOffsetPx(frame, seed, tileSize) : 0;

  ctx.fillStyle = floating ? RAFT_SHADOW : RAFT_SETTLED_SHADOW;
  const drop = tileSize * (floating ? RAFT_SHADOW_DROP_TILES : RAFT_SETTLED_SHADOW_DROP_TILES);
  ctx.fillRect(sx + tileSize * RAFT_SHADOW_SHIFT_TILES, sy + drop, w * tileSize, h * tileSize);

  const baked = bakedRaft(w, h, tileSize, condition, seed);
  if (baked !== null) ctx.drawImage(baked, sx, sy + bob);
  else paintRaftPlanks(ctx, sx, sy + bob, w, h, tileSize, condition, seed);

  if (floating) {
    const lap = (Math.sin((frame / RAFT_WATERLINE_PERIOD_TICKS) * TWO_PI) + 1) * HALF;
    const reach = tileSize * RAFT_WATERLINE_REACH_TILES * (1 + lap);
    ctx.strokeStyle = RAFT_WATERLINE;
    ctx.lineWidth = 1;
    ctx.globalAlpha = HALF + lap * HALF;
    ctx.strokeRect(
      sx - reach + HALF,
      sy - reach + bob + HALF,
      w * tileSize + reach * 2 - 1,
      h * tileSize + reach * 2 + tileSize * RAFT_FACE_TILES - 1,
    );
    ctx.globalAlpha = 1;
  }
}
/** The deck's thickness below the south edge, in tiles: the waterline laps round it too. */
const RAFT_FACE_TILES = 0.16;

function paintRaftPlanks(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  w: number,
  h: number,
  tileSize: number,
  condition: RaftCondition,
  seed: number,
): void {
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const piece = raftPiece(col, row, w, h);
      const variant = hash(seed, col, row) % RAFT_PLANK_VARIANTS;
      drawSpriteKey(
        ctx,
        'flooded_pump_raft',
        `${condition}_${piece}`,
        variant,
        sx + col * tileSize,
        sy + row * tileSize,
        tileSize,
      );
    }
  }
}

/**
 * A raft's planks painted once onto a surface of its own, so a room of rafts
 * costs a blit each rather than one per tile. A tile of room below the deck
 * holds the face that hangs under its south edge.
 */
const RAFT_BAKES = new Map<string, CanvasSurface>();

function bakedRaft(
  w: number,
  h: number,
  tileSize: number,
  condition: RaftCondition,
  seed: number,
): CanvasSurface | null {
  const key = `${w}x${h}@${tileSize}:${condition}:${seed}`;
  const cached = RAFT_BAKES.get(key);
  if (cached !== undefined) return cached;
  if (getSpriteDef('flooded_pump_raft') === undefined) return null;
  const surface = allocCanvas('props', w * tileSize, (h + 1) * tileSize);
  paintRaftPlanks(surfaceContext(surface), 0, 0, w, h, tileSize, condition, seed);
  RAFT_BAKES.set(key, surface);
  return surface;
}

// ── Pump, valve and chute ────────────────────────────────────────────────────

/**
 * A pump mounted at the foot of its wall, from its anchor tile. Running it shudders and its lamp
 * is lit; `valveTurns` is how far the crawler has hauled its hand-wheel round,
 * in whole turns, so a haul spins the wheel as the presses land.
 */
export function drawFloodedPump(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  running: boolean,
  valveTurns: number,
  frame: number,
): void {
  if (running) {
    drawSpriteKey(
      ctx,
      'flooded_pump_pump',
      'running',
      loopFrame(frame, PUMP_TICKS_PER_FRAME, PUMP_RUNNING_FRAMES),
      sx,
      sy,
      tileSize,
    );
  } else {
    drawSpriteKey(ctx, 'flooded_pump_pump', 'off', 0, sx, sy, tileSize);
  }
  const stepsPerTurn = VALVE_SPOKES * VALVE_TURN_FRAMES;
  const step = Math.floor(valveTurns * stepsPerTurn);
  const wheelFrame = ((step % VALVE_TURN_FRAMES) + VALVE_TURN_FRAMES) % VALVE_TURN_FRAMES;
  drawSpriteKey(
    ctx,
    'flooded_pump_valve',
    'turn',
    wheelFrame,
    sx + tileSize * (PUMP_VALVE_CENTRE_TILES.x - HALF),
    sy + tileSize * (PUMP_VALVE_CENTRE_TILES.y - HALF),
    tileSize,
  );
}

/** Which side of its pump a chute's outfall lies on. */
export type ChuteSide = 'east' | 'west';

/**
 * The outflow chute, from the tile its water lands in: the pump stands
 * {@link PUMP_OUTFALL_OFFSET_TILES} tiles away along the same row, on the
 * other side from `side`. Draw it after its pump so the elbow caps the riser.
 */
export function drawFloodedPumpChute(
  ctx: CanvasRenderingContext2D,
  outfallSx: number,
  outfallSy: number,
  tileSize: number,
  side: ChuteSide,
  pouring: boolean,
  frame: number,
): void {
  const flipX = side === 'west';
  if (pouring) {
    drawSpriteKey(
      ctx,
      'flooded_pump_chute',
      'pour',
      loopFrame(frame, CHUTE_TICKS_PER_FRAME, CHUTE_POUR_FRAMES),
      outfallSx,
      outfallSy,
      tileSize,
      { flipX },
    );
  } else {
    drawSpriteKey(
      ctx,
      'flooded_pump_chute',
      'drip',
      loopFrame(frame, CHUTE_DRIP_TICKS_PER_FRAME, CHUTE_DRIP_FRAMES),
      outfallSx,
      outfallSy,
      tileSize,
      { flipX },
    );
  }
}

// ── Dead sharks and drains ───────────────────────────────────────────────────

/**
 * A stranded great white across four tiles centred on its anchor tile, head
 * east unless flipped. `variant` picks how it lies: on its side, belly-up or
 * curled, in `DEAD_SHARK_POSES` order.
 */
export function drawDeadShark(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  variant: number,
  flipX: boolean,
): void {
  drawSpriteKey(
    ctx,
    'flooded_pump_dead_shark',
    'beached',
    variant % DEAD_SHARK_VARIANTS,
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

/** A floor drain's grate: ground art, drawn under the water. */
export function drawFloorDrain(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
) {
  drawSpriteKey(ctx, 'flooded_pump_drain', 'grate', 0, sx, sy, tileSize);
}

/** The whirlpool over a drain while the room empties: drawn over the water. */
export function drawDrainSwirl(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  frame: number,
): void {
  drawSpriteKey(
    ctx,
    'flooded_pump_drain',
    'swirl',
    loopFrame(frame, DRAIN_SWIRL_TICKS_PER_FRAME, DRAIN_SWIRL_FRAMES),
    sx,
    sy,
    tileSize,
  );
}

// ── Barrels ──────────────────────────────────────────────────────────────────

/** The barrel stack on its seat, from the bottom barrel's tile. */
export function drawBarrelStack(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  height: BarrelStackHeight,
): void {
  drawSpriteKey(
    ctx,
    'flooded_pump_barrel_stack',
    height === 3 ? 'stack_3' : 'stack_4',
    0,
    sx,
    sy,
    tileSize,
  );
}

/** A fallen barrel afloat, bobbing; `seed` offsets its bob so a row of them never bobs in step. */
export function drawFloatingBarrel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  frame: number,
  seed: number,
): void {
  const offset = hash(seed, 1, 1) % (BARREL_FLOAT_TICKS_PER_FRAME * BARREL_FLOAT_FRAMES);
  drawSpriteKey(
    ctx,
    'flooded_pump_barrel',
    'floating',
    loopFrame(frame + offset, BARREL_FLOAT_TICKS_PER_FRAME, BARREL_FLOAT_FRAMES),
    sx,
    sy,
    tileSize,
  );
}

/** What a barrel resting on the drained floor looks like, from whole to wreckage. */
export type SettledBarrelLook =
  | { readonly kind: 'intact'; readonly variant: number }
  | { readonly kind: 'damaged'; readonly variant: number }
  | { readonly kind: 'shatter'; readonly progress: number }
  | { readonly kind: 'remains'; readonly variant: number };

/** A fallen barrel on the drained floor, silted to where it floated; breakable once the fight ends. */
export function drawSettledBarrel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  look: SettledBarrelLook,
): void {
  switch (look.kind) {
    case 'intact':
      drawSpriteKey(
        ctx,
        'flooded_pump_barrel',
        'settled',
        look.variant % BARREL_SETTLED_VARIANTS,
        sx,
        sy,
        tileSize,
      );
      return;
    case 'damaged':
      drawSpriteKey(
        ctx,
        'flooded_pump_barrel',
        'damaged',
        look.variant % BARREL_SETTLED_VARIANTS,
        sx,
        sy,
        tileSize,
      );
      return;
    case 'shatter': {
      const last = BARREL_SHATTER_FRAMES - 1;
      const index = Math.min(last, Math.max(0, Math.floor(look.progress * BARREL_SHATTER_FRAMES)));
      drawSpriteKey(ctx, 'flooded_pump_barrel', 'shatter', index, sx, sy, tileSize);
      return;
    }
    case 'remains':
      drawSpriteKey(
        ctx,
        'flooded_pump_barrel',
        'remains',
        look.variant % BARREL_SETTLED_VARIANTS,
        sx,
        sy,
        tileSize,
      );
      return;
    default: {
      const unhandled: never = look;
      throw new Error(`unhandled settled barrel look ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Where a toppling barrel is headed: the screen top-left of the tile it lands in. */
export interface BarrelLanding {
  readonly sx: number;
  readonly sy: number;
}

/** The upright barrel's body centre in its own tile, as fractions: the point it tumbles about. */
const BARREL_PIVOT_X = 0.5;
const BARREL_PIVOT_Y = 0.55;
/** The share of the topple each lower barrel waits before it follows the one above. */
const TOPPLE_STAGGER = 0.14;
/** How high a barrel's arc carries it above the straight line to its landing, in tiles. */
const TOPPLE_ARC_TILES = 0.6;
/** A barrel lands on its side, a quarter turn from standing, plus the roll it carries in. */
const TOPPLE_TURNS = 0.25 + 0.5;

/**
 * The stack coming down: each barrel, top first, tips off the stack and
 * tumbles to its landing, then floats there. `progress` runs 0 to 1 over the
 * whole fall; `landings` lists a tile for each barrel from the bottom of the
 * stack up, so its length is the stack's height. At 0 this draws the standing
 * stack, at 1 the barrels afloat where they landed.
 */
export function drawBarrelStackTopple(
  ctx: CanvasRenderingContext2D,
  seatSx: number,
  seatSy: number,
  tileSize: number,
  landings: readonly BarrelLanding[],
  progress: number,
  frame: number,
): void {
  const scale = tileSize / BARREL_TILE_SCALE;
  const height = landings.length;
  landings.forEach((landing, level) => {
    const fromTop = height - 1 - level;
    const start = fromTop * TOPPLE_STAGGER;
    const span = 1 - (height - 1) * TOPPLE_STAGGER;
    const t = Math.min(1, Math.max(0, (progress - start) / span));
    if (t >= 1) {
      drawFloatingBarrel(ctx, landing.sx, landing.sy, tileSize, frame, level);
      return;
    }
    const startSx = seatSx;
    const startSy = seatSy - level * BARREL_STACK_STEP_PX * scale;
    const eased = t * t;
    const x = startSx + (landing.sx - startSx) * eased;
    const lift = Math.sin(t * Math.PI) * TOPPLE_ARC_TILES * tileSize;
    const y = startSy + (landing.sy - startSy) * eased - lift;
    const direction = landing.sx >= startSx ? 1 : -1;
    const angle = direction * eased * TOPPLE_TURNS * TWO_PI;
    const pivotX = x + tileSize * BARREL_PIVOT_X;
    const pivotY = y + tileSize * BARREL_PIVOT_Y;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    drawSpriteKey(
      ctx,
      'flooded_pump_barrel',
      'upright',
      0,
      -tileSize * BARREL_PIVOT_X,
      -tileSize * BARREL_PIVOT_Y,
      tileSize,
    );
    ctx.restore();
  });
}
