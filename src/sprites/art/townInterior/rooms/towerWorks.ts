/**
 * The tower's working fittings the cats' chapters turn on: the dumbwaiter's
 * hatch and its bell pull, the larder door and the portcullis chain, the
 * archive's ward stones, the loose things a cat bats off a shelf top (the
 * archivist's key ring, a shelf board), and the great bells of the bell
 * storey and the gear train they drive, which move and so are painted live
 * rather than as placed props.
 *
 * Black iron and walnut, as the tower's other fittings are. Ward stones carry
 * the violet of the Warden's working, kept away from red, which only ground
 * about to hurt may wear. A thing standing on a shelf top is drawn lifted by the ledge's
 * rise, so it sits on the shelf rather than on the floor under it.
 */

import type { ToppleHeading } from '../../../../map/interiorMechanisms';
import { LEDGE_RISE_TILES } from '../../../../map/mobility';
import {
  footprintBox,
  withFootprintClip,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, type RGB, type Ramp } from '../../town/townPalette';
import { WALNUT, BRASS_DIM, BRASS_BRIGHT, ironRamp, slab, litEdge, glow } from './townCenterTower';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** Which way a wall fitting faces: set into the east wall, opening west, or into the west wall. */
export const WALL_FITTING_VARIANT = { east_wall: 0, west_wall: 1 } as const;
/** Which variant draws a loose thing on the floor, and which up on a shelf top. */
export const LOOSE_THING_VARIANT = { floor: 0, shelf_top: 1 } as const;
/** Which `larder_door` variant draws which state. */
export const LARDER_DOOR_VARIANT = { locked: 0, open: 1 } as const;
/** Which `ward_stone` variant draws which state. */
export const WARD_STONE_VARIANT = { lit: 0, broken: 1 } as const;

const WARD_CORE: RGB = [240, 232, 255];
const WARD_MID: RGB = [182, 156, 238];
const WARD_DIM: RGB = [86, 72, 120];
const SHAFT_DARK: RGB = [12, 10, 9];
const ROPE: RGB = [176, 138, 85];
const ROPE_SHADE: RGB = [112, 84, 48];
const PAPER: RGB = [228, 218, 192];
const PAW_INK: RGB = [62, 44, 34];

function liftFor(variant: number, ts: number): number {
  return variant === LOOSE_THING_VARIANT.shelf_top ? ts * LEDGE_RISE_TILES : 0;
}

// ── The dumbwaiter ─────────────────────────────────────────────────────────

const HATCH_DEPTH_TILES = 0.55;
const HATCH_RISE_TILES = 1.25;
const HATCH_FRAME_TILES = 0.06;
const HATCH_SILL_TILES = 0.1;
const HATCH_DOOR_STOP = 0.55;
const HATCH_SHAFT_SHARE = 0.55;
const HATCH_ROPE_TILES = 0.025;
const HATCH_ROPE_INSET_SHARE = 0.3;

/**
 * A dumbwaiter's hatch set into a side wall: a walnut frame round the dark
 * shaft, its sliding door pushed half up, the hoist ropes running down inside
 * it, and the sill a load is set on. Drawn against the wall side of its tile,
 * so the floor in front of it stays open.
 */
export function paintDumbwaiterHatch(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const depth = ts * HATCH_DEPTH_TILES;
    const onEast = variant === WALL_FITTING_VARIANT.east_wall;
    const left = onEast ? box.right - depth : box.left;
    const top = box.bottom - ts * HATCH_RISE_TILES;
    const height = box.bottom - top;
    slab(ctx, WALNUT, HATCH_DOOR_STOP, left, top, depth, height, ts);
    const inset = ts * HATCH_FRAME_TILES;
    const shaftTop = top + inset;
    const shaftHeight = height * HATCH_SHAFT_SHARE;
    ctx.fillStyle = rgb(SHAFT_DARK);
    ctx.fillRect(left + inset, shaftTop, depth - inset * 2, shaftHeight);
    ctx.fillStyle = rgb(ROPE);
    const ropeWidth = Math.max(1, ts * HATCH_ROPE_TILES);
    for (const share of [HATCH_ROPE_INSET_SHARE, 1 - HATCH_ROPE_INSET_SHARE]) {
      ctx.fillRect(left + depth * share, shaftTop, ropeWidth, shaftHeight);
    }
    const sillTop = shaftTop + shaftHeight;
    slab(ctx, WALNUT, WALNUT_SILL_STOP, left, sillTop, depth, ts * HATCH_SILL_TILES, ts);
    litEdge(ctx, WALNUT, left, sillTop, depth, ts);
    drawTownContactShadow(
      ctx,
      left + depth * HALF,
      box.bottom,
      depth * HALF,
      ts * CONTACT_SHADOW_Y_TILES,
      CONTACT_SHADOW_ALPHA,
    );
  });
}

const WALNUT_SILL_STOP = 0.8;
const CONTACT_SHADOW_Y_TILES = 0.06;
const CONTACT_SHADOW_ALPHA = 0.35;

const BELL_BRACKET_DEPTH_TILES = 0.26;
const BELL_BRACKET_RISE_TILES = 1.0;
const BELL_BRACKET_TILES = 0.05;
const PULL_BELL_RADIUS_TILES = 0.11;
const PULL_CORD_TILES = 0.02;
const PULL_HANDLE_TILES = 0.06;
const PULL_CORD_FOOT_TILES = 0.45;

/** A small brass bell on an iron bracket at the hatch's side, with its pull cord hanging to a wooden handle. */
export function paintDumbwaiterBell(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const onEast = variant === WALL_FITTING_VARIANT.east_wall;
    const wallX = onEast ? box.right : box.left;
    const reach = ts * BELL_BRACKET_DEPTH_TILES * (onEast ? -1 : 1);
    const bracketY = box.bottom - ts * BELL_BRACKET_RISE_TILES;
    const iron = ironRamp();
    ctx.fillStyle = rgb(sampleRamp(iron, IRON_MID_STOP));
    ctx.fillRect(
      Math.min(wallX, wallX + reach),
      bracketY,
      Math.abs(reach),
      ts * BELL_BRACKET_TILES,
    );
    const bellX = wallX + reach;
    const bellRadius = ts * PULL_BELL_RADIUS_TILES;
    const bellY = bracketY + bellRadius;
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.beginPath();
    ctx.arc(bellX, bellY, bellRadius, Math.PI, FULL_TURN);
    ctx.lineTo(bellX + bellRadius, bellY + bellRadius * HALF);
    ctx.lineTo(bellX - bellRadius, bellY + bellRadius * HALF);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.fillRect(bellX - bellRadius * HALF, bellY - bellRadius * HALF, bellRadius * HALF, 1);
    const cordFoot = box.bottom - ts * PULL_CORD_FOOT_TILES;
    ctx.fillStyle = rgb(ROPE_SHADE);
    ctx.fillRect(
      bellX,
      bellY + bellRadius * HALF,
      Math.max(1, ts * PULL_CORD_TILES),
      cordFoot - bellY,
    );
    slab(
      ctx,
      WALNUT,
      HATCH_DOOR_STOP,
      bellX - ts * PULL_HANDLE_TILES * HALF,
      cordFoot,
      ts * PULL_HANDLE_TILES,
      ts * PULL_HANDLE_TILES * 2,
      ts,
    );
  });
}

const IRON_MID_STOP = 0.45;
const IRON_LIGHT_STOP = 0.8;

// ── The larder door and the portcullis chain ───────────────────────────────

const DOOR_RISE_TILES = 1.25;
const DOOR_PLANKS = 3;
const DOOR_BAND_AT = [0.2, 0.75] as const;
const DOOR_BAND_TILES = 0.06;
const LOCK_PLATE_TILES = 0.16;
const LOCK_PLATE_AT = 0.5;
const KEYHOLE_TILES = 0.03;
const OPEN_DOOR_EDGE_TILES = 0.16;
const DOOR_PLANK_STOP = 0.55;
const DOOR_SEAM_STOP = 0.15;

/**
 * The larder's oak door in its doorway. Variant 0 is shut on an iron lock
 * plate; 1 stands open, swung back against the jamb and seen edge-on, with
 * nothing else in the doorway, so the larder's own floor shows through it.
 * An opened door keeps its edge-on leaf so the doorway never reads as wall.
 */
export function paintLarderDoor(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const top = box.bottom - ts * DOOR_RISE_TILES;
    const height = box.bottom - top;
    if (variant === LARDER_DOOR_VARIANT.open) {
      const edge = ts * OPEN_DOOR_EDGE_TILES;
      slab(ctx, WALNUT, DOOR_PLANK_STOP, box.left, top, edge, height, ts);
      litEdge(ctx, WALNUT, box.left, top, edge, ts);
      return;
    }
    slab(ctx, WALNUT, DOOR_PLANK_STOP, box.left, top, box.width, height, ts);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, DOOR_SEAM_STOP));
    for (let plank = 1; plank < DOOR_PLANKS; plank++) {
      ctx.fillRect(box.left + (box.width * plank) / DOOR_PLANKS, top, 1, height);
    }
    const iron = ironRamp();
    for (const at of DOOR_BAND_AT) {
      ctx.fillStyle = rgb(sampleRamp(iron, IRON_MID_STOP));
      ctx.fillRect(box.left, top + height * at, box.width, ts * DOOR_BAND_TILES);
    }
    const plate = ts * LOCK_PLATE_TILES;
    const plateX = box.centreX - plate * HALF;
    const plateY = top + height * LOCK_PLATE_AT - plate * HALF;
    slab(ctx, iron, IRON_LIGHT_STOP, plateX, plateY, plate, plate, ts);
    ctx.fillStyle = rgb(SHAFT_DARK);
    ctx.fillRect(
      box.centreX - KEYHOLE_TILES * ts * HALF,
      plateY + plate * HALF,
      ts * KEYHOLE_TILES,
      plate * HALF,
    );
    litEdge(ctx, WALNUT, box.left, top, box.width, ts);
  });
}

const CHAIN_RISE_TILES = 1.8;
const CHAIN_LINK_TILES = 0.09;
const CHAIN_WIDTH_TILES = 0.06;
const CHAIN_WALL_INSET_TILES = 0.2;
const CHAIN_HOOK_TILES = 0.12;

/**
 * The portcullis chain coming down the larder's east wall from a slot in the
 * ceiling to a cleat, its links drawn one by one so it reads as iron, not rope.
 */
export function paintPortcullisChain(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const x = box.right - ts * CHAIN_WALL_INSET_TILES;
    const top = box.bottom - ts * CHAIN_RISE_TILES;
    const link = ts * CHAIN_LINK_TILES;
    const width = ts * CHAIN_WIDTH_TILES;
    const iron = ironRamp();
    let index = 0;
    for (let y = top; y < box.bottom - link; y += link) {
      const stop = index % 2 === 0 ? IRON_MID_STOP : IRON_LIGHT_STOP;
      ctx.fillStyle = rgb(sampleRamp(iron, stop));
      ctx.fillRect(x - width * HALF, y, width, link * (1 - LINK_GAP_SHARE));
      index++;
    }
    slab(
      ctx,
      iron,
      IRON_MID_STOP,
      x - ts * CHAIN_HOOK_TILES,
      box.bottom - link * 2,
      ts * CHAIN_HOOK_TILES * 2,
      link,
      ts,
    );
  });
}

const LINK_GAP_SHARE = 0.2;

// ── Ward stones ────────────────────────────────────────────────────────────

const STONE_WIDTH_TILES = 0.56;
const STONE_HEIGHT_TILES = 0.82;
const STONE_SHOULDER_SHARE = 0.25;
const STONE_BODY_STOP = 0.5;
const RUNE_TILES = 0.12;
const RUNE_GLOW_TILES = 0.45;
const RUNE_GLOW_ALPHA = 0.55;
const RUNE_LINE_TILES = 0.025;
const CRACK_TILES = 0.018;
const SHARD_COUNT = 3;
const SHARD_SPREAD_TILES = 0.18;
const SHARD_SIZE_TILES = 0.12;

function wardStoneRamp(): Ramp {
  return getTownRamp('oc_stone');
}

/**
 * A ward stone: a waist-high standing stone with a rune cut in its face. Lit
 * (variant 0) its rune burns with the ward light it feeds along the floor;
 * broken (1) it is split down the middle with its top fallen off and the rune
 * dead.
 */
export function paintWardStone(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const stone = wardStoneRamp();
    const width = ts * STONE_WIDTH_TILES;
    const broken = variant === WARD_STONE_VARIANT.broken;
    const height = ts * STONE_HEIGHT_TILES * (broken ? BROKEN_HEIGHT_SHARE : 1);
    const left = box.centreX - width * HALF;
    const top = box.bottom - height;
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom,
      width * HALF,
      ts * CONTACT_SHADOW_Y_TILES,
      CONTACT_SHADOW_ALPHA,
    );
    ctx.fillStyle = rgb(sampleRamp(stone, STONE_BODY_STOP));
    ctx.beginPath();
    ctx.moveTo(left, box.bottom);
    ctx.lineTo(left, top + height * STONE_SHOULDER_SHARE);
    ctx.quadraticCurveTo(
      box.centreX,
      top - height * STONE_SHOULDER_SHARE,
      left + width,
      top + height * STONE_SHOULDER_SHARE,
    );
    ctx.lineTo(left + width, box.bottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const runeY = top + height * HALF;
    if (broken) {
      ctx.fillStyle = rgb(sampleRamp(stone, 0));
      ctx.fillRect(box.centreX, top, Math.max(1, ts * CRACK_TILES), height);
      ctx.fillStyle = rgb(WARD_DIM);
      ctx.fillRect(
        box.centreX - ts * RUNE_TILES * HALF,
        runeY,
        ts * RUNE_TILES,
        Math.max(1, ts * RUNE_LINE_TILES),
      );
      for (let shard = 0; shard < SHARD_COUNT; shard++) {
        const offset = (shard - 1) * ts * SHARD_SPREAD_TILES;
        slab(
          ctx,
          stone,
          STONE_BODY_STOP,
          box.centreX + offset,
          box.bottom - ts * SHARD_SIZE_TILES,
          ts * SHARD_SIZE_TILES,
          ts * SHARD_SIZE_TILES * HALF,
          ts,
        );
      }
      return;
    }
    glow(ctx, box.centreX, runeY, ts * RUNE_GLOW_TILES, WARD_MID, RUNE_GLOW_ALPHA);
    ctx.strokeStyle = rgb(WARD_CORE);
    ctx.lineWidth = Math.max(1, ts * RUNE_LINE_TILES);
    const rune = ts * RUNE_TILES;
    ctx.beginPath();
    ctx.moveTo(box.centreX, runeY - rune);
    ctx.lineTo(box.centreX, runeY + rune);
    ctx.moveTo(box.centreX - rune, runeY - rune * HALF);
    ctx.lineTo(box.centreX + rune, runeY + rune * HALF);
    ctx.stroke();
  });
}

const BROKEN_HEIGHT_SHARE = 0.6;

// ── Loose things on a shelf top ────────────────────────────────────────────

const RING_RADIUS_TILES = 0.13;
const KEY_COUNT = 3;
const KEY_LENGTH_TILES = 0.22;
const KEY_BIT_TILES = 0.07;
const KEY_SPREAD_RADIANS = 0.55;
const KEY_HANG_SHARE = 0.35;
const HOOK_TILES = 0.05;

/**
 * A ring of keys of the given overall size, centred on the origin: a brass
 * ring with three iron keys hanging from it. Shared by the archivist's key
 * ring on its shelf and its icon in the bag.
 */
export function drawKeyRingShape(ctx: Ctx, size: number): void {
  const ringRadius = size * RING_RADIUS_SHARE;
  const ringY = -size * RING_LIFT_SHARE;
  ctx.strokeStyle = rgb(BRASS_DIM);
  ctx.lineWidth = Math.max(1, size * RING_LINE_SHARE);
  ctx.beginPath();
  ctx.arc(0, ringY, ringRadius, 0, FULL_TURN);
  ctx.stroke();
  ctx.strokeStyle = rgb(BRASS_BRIGHT);
  ctx.lineWidth = Math.max(1, size * RING_LINE_SHARE * HALF);
  ctx.beginPath();
  ctx.arc(0, ringY, ringRadius, Math.PI, Math.PI * KEY_RING_GLINT_END);
  ctx.stroke();
  const iron = ironRamp();
  for (let key = 0; key < KEY_COUNT; key++) {
    const angle = (key - 1) * KEY_SPREAD_RADIANS;
    ctx.save();
    ctx.translate(0, ringY + ringRadius * KEY_HANG_SHARE);
    ctx.rotate(angle);
    const length = size * KEY_LENGTH_SHARE;
    const width = Math.max(1, size * KEY_WIDTH_SHARE);
    ctx.fillStyle = rgb(sampleRamp(iron, key === 1 ? IRON_LIGHT_STOP : IRON_MID_STOP));
    ctx.fillRect(-width * HALF, 0, width, length);
    ctx.fillRect(-width * HALF, length - size * KEY_BIT_SHARE, size * KEY_BIT_SHARE, width * 2);
    ctx.restore();
  }
}

const RING_RADIUS_SHARE = 0.18;
const RING_LIFT_SHARE = 0.2;
const RING_LINE_SHARE = 0.07;
const KEY_RING_GLINT_END = 1.5;
const KEY_LENGTH_SHARE = 0.48;
const KEY_WIDTH_SHARE = 0.09;
const KEY_BIT_SHARE = 0.14;
/** The key ring's drawn size, as a share of a tile. */
const KEY_RING_SIZE_TILES = (RING_RADIUS_TILES + KEY_LENGTH_TILES + KEY_BIT_TILES) * 2;

/** The archivist's key ring, set down on a shelf top (variant 1) or lying on the floor (0). */
export function paintLooseKeyRing(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const foot = box.bottom - liftFor(variant, ts);
    drawTownContactShadow(
      ctx,
      box.centreX,
      foot,
      ts * RING_RADIUS_TILES * 2,
      ts * CONTACT_SHADOW_Y_TILES,
      CONTACT_SHADOW_ALPHA,
    );
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), IRON_MID_STOP));
    ctx.fillRect(
      box.centreX - ts * HOOK_TILES * HALF,
      foot - ts * KEY_RING_SIZE_TILES,
      ts * HOOK_TILES,
      ts * HOOK_TILES,
    );
    ctx.save();
    ctx.translate(box.centreX, foot - ts * KEY_RING_SIZE_TILES * HALF);
    drawKeyRingShape(ctx, ts * KEY_RING_SIZE_TILES);
    ctx.restore();
  });
}

/** The loose shelf board: long enough, fallen, to reach from the shelf top across a two-tile hole onto the floor beyond. */
const PLANK_LENGTH_TILES = 3;
const PLANK_WIDTH_TILES = 0.55;
const PLANK_THICK_TILES = 0.12;
/**
 * How tall an upright span is drawn, as a share of the same span lying on the
 * floor: the camera looks down at the room, so a board standing up is seen a
 * little short and grows as it falls away from the viewer.
 */
const PLANK_RISE_SHARE = 0.8;
/** Where the upright board's foot stands across its tile, as a share from the side away from the wall it leans on. */
const PLANK_FOOT_ACROSS_SHARE = 0.36;
/** How far back from the front of what it stands on the foot is set, so it stands on the top and not on the edge. */
const PLANK_FOOT_BACK_TILES = 0.3;
/** Its face is lit more as it tips back toward the light above. */
const PLANK_FACE_UPRIGHT_STOP = 0.5;
const PLANK_FACE_FLAT_STOP = 0.72;
const PLANK_EDGE_STOP = 0.18;
const PLANK_GRAIN_STOP = 0.3;
const PLANK_GRAIN_ALPHA = 0.55;
/** The grain lines run the board's length at these shares of its width. */
const PLANK_GRAIN_SHARES = [0.3, 0.68] as const;
const PLANK_NAIL_STOP = 0.15;
const PLANK_NAIL_TILES = 0.035;
/** Two old nail holes near each end, at this share of the length in from it. */
const PLANK_NAIL_INSET_SHARE = 0.07;
const PLANK_SHADOW_RADIUS_SHARE = 0.75;
const QUARTER_TURN = Math.PI * HALF;

/** A plank's pose in screen pixels: where its foot stands and how far it has fallen. */
interface PlankPose {
  /** The middle of its foot, where it stands and pivots as it falls. */
  readonly footX: number;
  readonly footY: number;
  /** Which way along the floor it falls: north is `{ dx: 0, dy: -1 }`. */
  readonly toward: ToppleHeading;
  /** How far over it has gone: 0 upright, 1 lying flat. */
  readonly fallen: number;
  /** How far its top leans to the right of the way it falls, in radians, while upright; it straightens as it falls. */
  readonly lean: number;
  readonly ts: number;
}

/** The plank's length on screen once fallen, in pixels: how far its far end lies from its foot. */
function plankLengthPx(ts: number): number {
  return ts * PLANK_LENGTH_TILES;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

function quad(ctx: Ctx, corners: readonly ScreenPoint[], dx: number, dy: number): void {
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x + dx, corner.y + dy);
    else ctx.lineTo(corner.x + dx, corner.y + dy);
  });
  ctx.closePath();
}

/**
 * A long plank standing on its foot or anywhere on its way to lying flat:
 * it pivots on its foot, tipping away along `toward`, its broad face turning
 * from the viewer to the ceiling, and its thickness showing as end grain at
 * the top while upright and at the near end once down.
 */
function drawPlank(ctx: Ctx, pose: PlankPose): void {
  const { footX, footY, toward, ts } = pose;
  const angle = Math.max(0, Math.min(1, pose.fallen)) * QUARTER_TURN;
  const length = plankLengthPx(ts);
  const across = { x: -toward.dy, y: toward.dx };
  const upright = Math.cos(angle);
  const sideways = length * Math.sin(pose.lean) * upright;
  const height = length * Math.cos(pose.lean) * upright * PLANK_RISE_SHARE;
  const along = length * Math.sin(angle);
  const farX = footX + toward.dx * along + across.x * sideways;
  const farY = footY + toward.dy * along + across.y * sideways - height;
  const halfWidth = ts * PLANK_WIDTH_TILES * HALF;
  const corners: ScreenPoint[] = [
    { x: footX - across.x * halfWidth, y: footY - across.y * halfWidth },
    { x: footX + across.x * halfWidth, y: footY + across.y * halfWidth },
    { x: farX + across.x * halfWidth, y: farY + across.y * halfWidth },
    { x: farX - across.x * halfWidth, y: farY - across.y * halfWidth },
  ];
  const thick = ts * PLANK_THICK_TILES;
  const faceDx = -toward.dx * thick * upright;
  const faceDy = -toward.dy * thick * upright - thick * Math.sin(angle) * PLANK_RISE_SHARE;
  if (pose.fallen < 1) {
    drawTownContactShadow(
      ctx,
      footX,
      footY,
      halfWidth * PLANK_SHADOW_RADIUS_SHARE * 2,
      ts * CONTACT_SHADOW_Y_TILES,
      CONTACT_SHADOW_ALPHA * upright,
    );
  }
  ctx.fillStyle = rgb(sampleRamp(WALNUT, PLANK_EDGE_STOP));
  quad(ctx, corners, 0, 0);
  ctx.fill();
  inkOutline(ctx, ts);
  const faceStop =
    PLANK_FACE_UPRIGHT_STOP + (PLANK_FACE_FLAT_STOP - PLANK_FACE_UPRIGHT_STOP) * (1 - upright);
  ctx.fillStyle = rgb(sampleRamp(WALNUT, faceStop));
  quad(ctx, corners, faceDx, faceDy);
  ctx.fill();
  inkOutline(ctx, ts);
  const [footLeft, footRight, farRight, farLeft] = corners;
  ctx.strokeStyle = rgba(sampleRamp(WALNUT, PLANK_GRAIN_STOP), PLANK_GRAIN_ALPHA);
  ctx.lineWidth = Math.max(1, ts * PLANK_NAIL_TILES * HALF);
  for (const share of PLANK_GRAIN_SHARES) {
    ctx.beginPath();
    ctx.moveTo(
      footLeft.x + (footRight.x - footLeft.x) * share + faceDx,
      footLeft.y + (footRight.y - footLeft.y) * share + faceDy,
    );
    ctx.lineTo(
      farLeft.x + (farRight.x - farLeft.x) * share + faceDx,
      farLeft.y + (farRight.y - farLeft.y) * share + faceDy,
    );
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(WALNUT, PLANK_NAIL_STOP));
  const nail = Math.max(1, ts * PLANK_NAIL_TILES);
  for (const endShare of [PLANK_NAIL_INSET_SHARE, 1 - PLANK_NAIL_INSET_SHARE]) {
    const x = footX + (farX - footX) * endShare + faceDx;
    const y = footY + (farY - footY) * endShare + faceDy;
    ctx.fillRect(x - nail * HALF, y - nail * HALF, nail, nail);
  }
}

/**
 * The way the archive's shelf board falls: north, away from the viewer, across
 * the hole. Its standing and fallen art are drawn for this way alone, so the
 * archive's placement takes its heading from here.
 */
export const SHELF_BOARD_FALLS = { dx: 0, dy: -1 } as const satisfies ToppleHeading;

/** Where a plank's foot stands on its tile: on the shelf top when it is up on one. */
function plankFoot(frame: TownPropFrame, variant: number): ScreenPoint {
  const box = footprintBox(frame);
  const ts = frame.tileScale;
  return {
    x: box.left + box.width * PLANK_FOOT_ACROSS_SHARE,
    y: box.bottom - liftFor(variant, ts) - ts * PLANK_FOOT_BACK_TILES,
  };
}

/**
 * The lean that rests a plank standing at `foot` with its top against the
 * wall on its tile's east side.
 */
function plankLeanAgainstEastWall(foot: ScreenPoint, wallX: number, ts: number): number {
  const reach = wallX - ts * PLANK_WIDTH_TILES * HALF - foot.x;
  return Math.asin(Math.max(0, Math.min(1, reach / plankLengthPx(ts))));
}

/**
 * A tall loose shelf board standing on a shelf top (variant 1) or on the floor
 * (0), leaning its top against the wall on its tile's east side: long enough,
 * knocked over, to fall across a hole in the boards and be the way over it.
 */
export function paintLooseShelfBoard(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const foot = plankFoot(frame, variant);
    drawPlank(ctx, {
      footX: foot.x,
      footY: foot.y,
      toward: SHELF_BOARD_FALLS,
      fallen: 0,
      lean: plankLeanAgainstEastWall(foot, box.right, frame.tileScale),
      ts: frame.tileScale,
    });
  });
}

/**
 * The same board once it has fallen from where it stood: lying north from its
 * foot across whatever is there, which is all a hole needs to be crossed.
 */
export function paintFallenShelfBoard(ctx: Ctx, frame: TownPropFrame, variant: number): void {
  withFootprintClip(ctx, frame, () => {
    const foot = plankFoot(frame, variant);
    drawPlank(ctx, {
      footX: foot.x,
      footY: foot.y,
      toward: SHELF_BOARD_FALLS,
      fallen: 1,
      lean: 0,
      ts: frame.tileScale,
    });
  });
}

/**
 * The shelf board placed on `tile` in `variant`, falling along `toward`,
 * `fallen` (0 to 1) of the way from leaning on its wall to lying across the
 * hole, in world pixels offset by the camera.
 */
export function paintShelfBoardToppling(
  ctx: Ctx,
  tile: { readonly x: number; readonly y: number },
  variant: number,
  toward: ToppleHeading,
  fallen: number,
  camX: number,
  camY: number,
  ts: number,
): void {
  const frame: TownPropFrame = {
    originX: tile.x * ts - camX,
    originY: tile.y * ts - camY,
    footprintW: 1,
    footprintH: 1,
    tileScale: ts,
  };
  const foot = plankFoot(frame, variant);
  drawPlank(ctx, {
    footX: foot.x,
    footY: foot.y,
    toward,
    fallen,
    lean: plankLeanAgainstEastWall(foot, footprintBox(frame).right, ts),
    ts,
  });
}

// ── Pumpkin's note ─────────────────────────────────────────────────────────

const NOTE_WIDTH_SHARE = 0.7;
const NOTE_HEIGHT_SHARE = 0.56;
const NOTE_TILT = -0.12;
const PAW_PAD_SHARE = 0.11;
const PAW_TOE_SHARE = 0.05;
const PAW_TOE_SPREAD_SHARE = 0.1;
const PAW_TOE_LIFT_SHARE = 0.12;
const PAW_TOES = 4;
const FOLD_SHADE_ALPHA = 0.18;

/** A torn scrap of paper stamped with one greasy paw print, centred on the origin. */
export function drawPawNoteShape(ctx: Ctx, size: number): void {
  const width = size * NOTE_WIDTH_SHARE;
  const height = size * NOTE_HEIGHT_SHARE;
  ctx.save();
  ctx.rotate(NOTE_TILT);
  ctx.fillStyle = rgb(PAPER);
  ctx.fillRect(-width * HALF, -height * HALF, width, height);
  ctx.fillStyle = rgba(PAW_INK, FOLD_SHADE_ALPHA);
  ctx.fillRect(0, -height * HALF, 1, height);
  ctx.fillStyle = rgb(PAW_INK);
  const padRadius = size * PAW_PAD_SHARE;
  ctx.beginPath();
  ctx.arc(0, padRadius * HALF, padRadius, 0, FULL_TURN);
  ctx.fill();
  for (let toe = 0; toe < PAW_TOES; toe++) {
    const x = (toe - (PAW_TOES - 1) * HALF) * size * PAW_TOE_SPREAD_SHARE;
    ctx.beginPath();
    ctx.arc(x, -size * PAW_TOE_LIFT_SHARE, size * PAW_TOE_SHARE, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.restore();
}

// ── The bell storey's bells ────────────────────────────────────────────────

const BELL_MOUTH_SHARE = 0.5;
const BELL_CROWN_SHARE = 0.22;
const BELL_HEIGHT_SHARE = 0.72;
const BELL_LIP_SHARE = 0.08;
const HEADSTOCK_STOP = 0.6;
const HEADSTOCK_SHARE = 0.9;
const HEADSTOCK_THICK_SHARE = 0.09;
const BELL_SHADE_STOP = 0.35;
const BELL_LIGHT_STOP = 0.75;
const CLAPPER_SHARE = 0.06;
const YOKE_WIDTH_SHARE = 0.05;
const YOKE_SPREAD_SHARE = 0.12;
const BELL_BRONZE: Ramp = {
  shadow: [62, 38, 18],
  mid: [132, 88, 40],
  light: [196, 148, 76],
  accent: [236, 198, 120],
};

/**
 * One great bell swung `angle` radians from hanging straight down about the
 * pivot of its headstock at (`pivotX`, `pivotY`), its crown on a yoke
 * `hangPx` below the pivot. `size` is the bell's mouth across, in pixels. A
 * live world painter: the bell storey swings its bells every frame.
 */
export function drawSwingingBell(
  ctx: Ctx,
  pivotX: number,
  pivotY: number,
  size: number,
  angle: number,
  hangPx: number,
): void {
  const headstock = size * HEADSTOCK_SHARE;
  const thick = size * HEADSTOCK_THICK_SHARE;
  slab(
    ctx,
    WALNUT,
    HEADSTOCK_STOP,
    pivotX - headstock * HALF,
    pivotY - thick * HALF,
    headstock,
    thick,
    size,
  );
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);
  const iron = ironRamp();
  ctx.fillStyle = rgb(sampleRamp(iron, IRON_MID_STOP));
  const yoke = Math.max(1, size * YOKE_WIDTH_SHARE);
  ctx.fillRect(-yoke * HALF - size * YOKE_SPREAD_SHARE, 0, yoke, hangPx);
  ctx.fillRect(-yoke * HALF + size * YOKE_SPREAD_SHARE, 0, yoke, hangPx);
  ctx.translate(0, hangPx);
  const mouth = size * BELL_MOUTH_SHARE;
  const crown = size * BELL_CROWN_SHARE;
  const height = size * BELL_HEIGHT_SHARE;
  const body = ctx.createLinearGradient(-mouth, 0, mouth, 0);
  body.addColorStop(0, rgb(sampleRamp(BELL_BRONZE, BELL_SHADE_STOP)));
  body.addColorStop(HALF, rgb(sampleRamp(BELL_BRONZE, BELL_LIGHT_STOP)));
  body.addColorStop(1, rgb(sampleRamp(BELL_BRONZE, 0)));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-crown, thick * HALF);
  ctx.quadraticCurveTo(-crown * 2, height * HALF, -mouth, height);
  ctx.lineTo(mouth, height);
  ctx.quadraticCurveTo(crown * 2, height * HALF, crown, thick * HALF);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, size);
  ctx.fillStyle = rgb(sampleRamp(BELL_BRONZE, 1));
  ctx.fillRect(-mouth, height - size * BELL_LIP_SHARE, mouth * 2, size * BELL_LIP_SHARE);
  ctx.fillStyle = rgb(sampleRamp(ironRamp(), IRON_MID_STOP));
  ctx.beginPath();
  ctx.arc(0, height, size * CLAPPER_SHARE, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── The bell storey's gear train ───────────────────────────────────────────

/** One iron gear: its centre and pitch radius in pixels, its tooth count, and how far it has turned. */
export interface IronGear {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly teeth: number;
  readonly angle: number;
}

/** A horizontal iron axle between two x positions at one height, in pixels. */
export interface IronShaft {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
}

/** A chain hanging plumb at `x` from `y0` to `y1`, its links run on `travel` pixels. */
export interface DriveChain {
  readonly x: number;
  readonly y0: number;
  readonly y1: number;
  readonly travel: number;
}

/** A grooved pulley wheel the chain turns over, its centre and radius in pixels. */
export interface ChainPulley {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly angle: number;
}

/** Everything the gear train draws for one frame, posed in screen pixels. */
export interface GearTrainPose {
  readonly shafts: ReadonlyArray<IronShaft>;
  readonly gears: ReadonlyArray<IronGear>;
  readonly chain: DriveChain;
  readonly pulley: ChainPulley;
}

const SHAFT_THICK_TILES = 0.09;
const GEAR_TOOTH_DEPTH_TILES = 0.11;
/** The share of each tooth's pitch the tooth itself fills; the rest is the gap a meshing tooth sits in. */
export const GEAR_TOOTH_SHARE = 0.5;
/** How much narrower a tooth's tip is than its root, as a share of the pitch on each flank. */
const GEAR_TOOTH_TAPER_SHARE = 0.1;
const GEAR_RIM_TILES = 0.08;
const GEAR_HUB_SHARE = 0.3;
const GEAR_SPOKES = 4;
/** How much of the gap between spokes is cut through the web, as a share of the angle between spokes. */
const GEAR_WINDOW_SHARE = 0.55;
const GEAR_BODY_STOP = 0.45;
const GEAR_RIM_STOP = 0.75;
const GEAR_HUB_STOP = 0.7;
const GEAR_SHADOW_ALPHA = 0.4;
const GEAR_SHADOW_DROP_TILES = 0.06;
/** The lit arc of a rim faces the room's light, up and to the west. */
const LIT_ARC_FROM = Math.PI * 0.75;
const LIT_ARC_TO = Math.PI * 1.85;
const RIM_LINE_TILES = 0.06;
const CHAIN_LINK_LENGTH_TILES = 0.16;
const CHAIN_LINK_WIDTH_TILES = 0.08;
const CHAIN_SHADE_STOP = 0.7;
const PULLEY_GROOVE_SHARE = 0.55;
const SHADOW_INK: RGB = [0, 0, 0];
/** Worn iron where a tooth's rim or a chain link catches the light, brighter than the iron ramp's own top so it reads against the shaft's black. */
const IRON_GLINT: RGB = [156, 158, 166];

/**
 * The bell storey's gear train, posed for one frame: the axles first, then
 * the chain, then the pulley it turns over, then the gears, so a gear hides
 * where the chain runs onto its sprocket. A live world painter, as the bells
 * are: the train turns as they swing.
 */
export function drawGearTrain(ctx: Ctx, pose: GearTrainPose, ts: number): void {
  const iron = ironRamp();
  for (const shaft of pose.shafts) drawIronShaft(ctx, iron, shaft, ts);
  drawDriveChain(ctx, iron, pose.chain, ts);
  drawChainPulley(ctx, iron, pose.pulley, ts);
  for (const gear of pose.gears) drawIronGear(ctx, iron, gear, ts);
}

function drawIronShaft(ctx: Ctx, iron: Ramp, shaft: IronShaft, ts: number): void {
  const thick = ts * SHAFT_THICK_TILES;
  const left = Math.min(shaft.x0, shaft.x1);
  const width = Math.abs(shaft.x1 - shaft.x0);
  slab(ctx, iron, IRON_MID_STOP, left, shaft.y - thick * HALF, width, thick, ts);
  litEdge(ctx, iron, left, shaft.y - thick * HALF, width, ts);
}

function toothedPath(ctx: Ctx, gear: IronGear, ts: number): void {
  const depth = ts * GEAR_TOOTH_DEPTH_TILES;
  const tip = gear.radius + depth * HALF;
  const root = gear.radius - depth * HALF;
  const pitch = FULL_TURN / gear.teeth;
  const toothEnd = pitch * GEAR_TOOTH_SHARE;
  const taper = pitch * GEAR_TOOTH_TAPER_SHARE;
  const points: ReadonlyArray<readonly [number, number]> = [
    [0, root],
    [taper, tip],
    [toothEnd - taper, tip],
    [toothEnd, root],
  ];
  ctx.beginPath();
  for (let tooth = 0; tooth < gear.teeth; tooth++) {
    for (const [along, reach] of points) {
      const at = tooth * pitch + along;
      ctx.lineTo(Math.cos(at) * reach, Math.sin(at) * reach);
    }
  }
  ctx.closePath();
}

function drawIronGear(ctx: Ctx, iron: Ramp, gear: IronGear, ts: number): void {
  const rim = ts * GEAR_RIM_TILES;
  const inner = gear.radius - ts * GEAR_TOOTH_DEPTH_TILES * HALF - rim;
  const hub = gear.radius * GEAR_HUB_SHARE;
  ctx.save();
  ctx.translate(gear.x, gear.y + ts * GEAR_SHADOW_DROP_TILES);
  ctx.rotate(gear.angle);
  toothedPath(ctx, gear, ts);
  ctx.fillStyle = rgba(SHADOW_INK, GEAR_SHADOW_ALPHA);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(gear.x, gear.y);
  ctx.save();
  ctx.rotate(gear.angle);
  toothedPath(ctx, gear, ts);
  ctx.fillStyle = rgb(sampleRamp(iron, GEAR_BODY_STOP));
  ctx.fill();
  inkOutline(ctx, ts);
  const spokeGap = FULL_TURN / GEAR_SPOKES;
  const windowArc = spokeGap * GEAR_WINDOW_SHARE;
  ctx.fillStyle = rgb(SHAFT_DARK);
  for (let spoke = 0; spoke < GEAR_SPOKES; spoke++) {
    const from = spoke * spokeGap + (spokeGap - windowArc) * HALF;
    ctx.beginPath();
    ctx.arc(0, 0, inner, from, from + windowArc);
    ctx.arc(0, 0, hub, from + windowArc, from, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = rgb(sampleRamp(iron, GEAR_RIM_STOP));
  ctx.lineWidth = Math.max(1, ts * RIM_LINE_TILES);
  ctx.beginPath();
  ctx.arc(0, 0, inner + rim * HALF, 0, FULL_TURN);
  ctx.stroke();
  ctx.strokeStyle = rgb(IRON_GLINT);
  ctx.beginPath();
  ctx.arc(0, 0, inner + rim * HALF, LIT_ARC_FROM, LIT_ARC_TO);
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(iron, GEAR_HUB_STOP));
  ctx.beginPath();
  ctx.arc(0, 0, hub, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.restore();
}

function drawDriveChain(ctx: Ctx, iron: Ramp, chain: DriveChain, ts: number): void {
  const link = ts * CHAIN_LINK_LENGTH_TILES;
  const width = ts * CHAIN_LINK_WIDTH_TILES;
  const top = Math.min(chain.y0, chain.y1);
  const bottom = Math.max(chain.y0, chain.y1);
  const phase = ((chain.travel % (link * 2)) + link * 2) % (link * 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(chain.x - width, top, width * 2, bottom - top);
  ctx.clip();
  for (let y = top - link * 2 + phase, index = 0; y < bottom; y += link, index++) {
    ctx.fillStyle = index % 2 === 0 ? rgb(IRON_GLINT) : rgb(sampleRamp(iron, CHAIN_SHADE_STOP));
    const linkWidth = index % 2 === 0 ? width : width * HALF;
    ctx.fillRect(chain.x - linkWidth * HALF, y, linkWidth, link);
  }
  ctx.restore();
}

function drawChainPulley(ctx: Ctx, iron: Ramp, pulley: ChainPulley, ts: number): void {
  ctx.save();
  ctx.translate(pulley.x, pulley.y);
  ctx.fillStyle = rgb(sampleRamp(iron, GEAR_BODY_STOP));
  ctx.beginPath();
  ctx.arc(0, 0, pulley.radius, 0, FULL_TURN);
  ctx.fill();
  inkOutline(ctx, ts);
  ctx.strokeStyle = rgb(IRON_GLINT);
  ctx.lineWidth = Math.max(1, ts * RIM_LINE_TILES);
  ctx.beginPath();
  ctx.arc(0, 0, pulley.radius * PULLEY_GROOVE_SHARE, LIT_ARC_FROM, LIT_ARC_TO);
  ctx.stroke();
  ctx.rotate(pulley.angle);
  ctx.strokeStyle = rgb(SHAFT_DARK);
  ctx.beginPath();
  ctx.moveTo(-pulley.radius * PULLEY_GROOVE_SHARE, 0);
  ctx.lineTo(pulley.radius * PULLEY_GROOVE_SHARE, 0);
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(iron, GEAR_HUB_STOP));
  ctx.beginPath();
  ctx.arc(0, 0, pulley.radius * GEAR_HUB_SHARE, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}
