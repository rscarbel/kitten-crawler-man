/**
 * The Big Top's shell, apart from its floor: the king pole, the dim clutter
 * glimpsed in the dark mass backstage, and the lamps in the interval rooms.
 *
 * The pole's foot and shadow and the clutter are painted into the chunk bake
 * by the tile painters; the rising mast is drawn in the Y-sorted decoration
 * pass (`tentPoleTiles.ts`), and the lamp is wall-hung dressing drawn live by
 * `BigTopMazeSystem`.
 */

import {
  decorHash,
  poleFootShadow,
  POLE_FOOT_LIFT_TILES,
  type PoleFootShadow,
} from '../../../map/bigTopMazeDecor';
import { getCircusRamp, getTownRamp } from '../town/townPalette';
import { rgba } from '../town/townArt';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const BACKSTAGE = getCircusRamp('circus_backstage');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const BLOOD = getCircusRamp('circus_blood');
const BONE = getCircusRamp('circus_bone');
const STRAW = getCircusRamp('circus_straw');
const VINE = getCircusRamp('circus_vine');
const BRASS = getCircusRamp('circus_brass');
const LIMELIGHT = getCircusRamp('circus_limelight');
const IRON = getTownRamp('iron_black');

// ── The king pole ───────────────────────────────────────────────────────────

/** Where one pole tile sits inside the pole it belongs to. */
export interface PoleCell {
  /** Tiles across and down the whole pole. */
  readonly blockWidth: number;
  readonly blockHeight: number;
  /** This tile's column and row within the pole. */
  readonly column: number;
  readonly row: number;
}

/** A pole wider than one tile is the ring's king pole, and gets the full treatment. */
const KING_POLE_MIN_TILES = 2;

const MAST_SHAFT_SHARE = 0.46;
/** The shaft's foot stands this far up from the bottom of the pole's tiles, in tiles. */
const MAST_FOOT_FLARE = 1.1;
const CONTACT_AO_ALPHA = 0.55;
/** Shading stops across the shaft: lit a third of the way in from the left, the upper-left sun indoors being the stage light. */
const SHAFT_LIT_STOP = 0.3;
const SHAFT_MID_STOP = 0.62;
const GRAIN_LINES = 5;
const GRAIN_ALPHA = 0.18;
const GRAIN_WIDTH_TILES = 0.025;
const BAND_HEIGHT_TILES = 0.45;
const BAND_PAINT_ALPHA = 0.35;
const BAND_WEAR_ALPHA = 0.25;
const COLLAR_HEIGHT_TILES = 0.09;
const COLLAR_OVERHANG_SHARE = 0.08;
const COLLAR_POSITIONS: ReadonlyArray<number> = [0.35, 0.8];
const COLLAR_RIVETS = 3;
const COLLAR_RIVET_RADIUS_TILES = 0.022;
const LASHING_TURNS = 3;
const LASHING_PITCH_TILES = 0.07;
const LASHING_WIDTH_TILES = 0.03;
const LASHING_ALPHA = 0.8;
const LASHING_LEAN_TILES = 0.06;
const VINE_TURNS = 5;
const VINE_SEGMENTS = 160;
const VINE_WIDTH_TILES = 0.07;
const VINE_ALPHA = 0.85;
const VINE_SHEEN_ALPHA = 0.5;
const VINE_LEAVES = 12;
const VINE_LEAF_RADIUS_TILES = 0.07;

/**
 * The floor under a pole tile: its share of the pole's contact shadow,
 * clipped to the tile. The mast itself stands in the Y-sorted pass
 * (`paintTentMast`), so a crawler north of the pole is drawn behind it.
 *
 * The shadow is one shape in tile units, shared with the sawdust round the
 * pole, so it is drawn in those units and meets the floor's half seamlessly.
 */
export function paintTentPoleBase(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  cell: PoleCell,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    ctx.translate(sx - cell.column * ts, sy - cell.row * ts);
    ctx.scale(ts, ts);
    paintPoleFootShadow(
      ctx,
      poleFootShadow(
        { x: cell.blockWidth / 2, y: cell.blockHeight / 2 },
        cell.blockWidth,
        cell.blockHeight,
      ),
    );
  } finally {
    ctx.restore();
  }
}

/**
 * How far a mast rises above the top of its own tiles, in tiles: past the top
 * of any view of the ring, so the pole reads as going on up into the dark of
 * the canvas roof rather than stopping at a line on the floor.
 */
export const MAST_RISE_TILES = 9;
/** The top of the rise fades to the roof's dark over this share of it. */
const RISE_FADE_SHARE = 0.55;

/**
 * A tent pole as a mast: banded timber on a flared foot, iron collars with
 * rope lashed under them, rising out of view into the dark of the tent roof.
 * The king pole also carries Grimaldi's vine, wound up from the roots and
 * climbing out of sight with the mast.
 *
 * Painted whole, from the pole's top-left tile corner `(originX, originY)`;
 * the art reaches `MAST_RISE_TILES` above that corner and never below or
 * beside the pole's own tiles.
 */
export function paintTentMast(
  ctx: Ctx,
  originX: number,
  originY: number,
  ts: number,
  blockWidth: number,
  blockHeight: number,
): void {
  const width = blockWidth * ts;
  const height = blockHeight * ts;
  const isKing = Math.min(blockWidth, blockHeight) >= KING_POLE_MIN_TILES;
  const centreX = originX + width / 2;
  const shaftWidth = width * MAST_SHAFT_SHARE;
  const shaftLeft = centreX - shaftWidth / 2;
  const footY = originY + height - POLE_FOOT_LIFT_TILES * ts;
  const topY = originY - MAST_RISE_TILES * ts;

  ctx.save();
  try {
    const shaft = ctx.createLinearGradient(shaftLeft, 0, shaftLeft + shaftWidth, 0);
    shaft.addColorStop(0, rgba(ROT_TIMBER.shadow, 1));
    shaft.addColorStop(SHAFT_LIT_STOP, rgba(ROT_TIMBER.light, 1));
    shaft.addColorStop(SHAFT_MID_STOP, rgba(ROT_TIMBER.mid, 1));
    shaft.addColorStop(1, rgba(ROT_TIMBER.shadow, 1));
    ctx.fillStyle = shaft;
    const flare = (shaftWidth * (MAST_FOOT_FLARE - 1)) / 2;
    const traceShaft = (): void => {
      ctx.beginPath();
      ctx.moveTo(shaftLeft, topY);
      ctx.lineTo(shaftLeft + shaftWidth, topY);
      ctx.lineTo(shaftLeft + shaftWidth, originY);
      ctx.lineTo(shaftLeft + shaftWidth + flare, footY);
      ctx.lineTo(shaftLeft - flare, footY);
      ctx.lineTo(shaftLeft, originY);
      ctx.closePath();
    };
    traceShaft();
    ctx.fill();

    ctx.save();
    try {
      traceShaft();
      ctx.clip();
      // Painted bands, worn back to the timber in places.
      const bandHeight = BAND_HEIGHT_TILES * ts;
      for (let band = 0, y = footY - bandHeight; y > topY - bandHeight; band++, y -= bandHeight) {
        if (band % 2 !== 0) continue;
        ctx.fillStyle = rgba(BLOOD.mid, BAND_PAINT_ALPHA);
        ctx.fillRect(shaftLeft - flare, y, shaftWidth + flare * 2, bandHeight);
        ctx.fillStyle = rgba(ROT_TIMBER.mid, BAND_WEAR_ALPHA * decorHash(band, blockWidth, 1));
        ctx.fillRect(shaftLeft, y, shaftWidth * decorHash(band, 2, 1), bandHeight);
      }
      ctx.strokeStyle = rgba(BACKSTAGE.shadow, GRAIN_ALPHA);
      ctx.lineWidth = GRAIN_WIDTH_TILES * ts;
      for (let line = 1; line <= GRAIN_LINES; line++) {
        const x = shaftLeft + (shaftWidth * line) / (GRAIN_LINES + 1);
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, footY);
        ctx.stroke();
      }
      if (isKing) paintMastVine(ctx, centreX, shaftWidth, topY, footY, ts);
    } finally {
      ctx.restore();
    }

    COLLAR_POSITIONS.forEach((position, index) => {
      const y = originY + (footY - originY) * position;
      // Rope is lashed only under the lowest collar, where the guys are made fast.
      const lashed = index === COLLAR_POSITIONS.length - 1;
      paintCollar(
        ctx,
        shaftLeft,
        shaftWidth,
        y,
        ts,
        lashed && isKing ? LASHING_TURNS : lashed ? 1 : 0,
      );
    });

    const fadeTop = topY;
    const fadeBottom = topY + (originY - topY) * RISE_FADE_SHARE;
    const dark = ctx.createLinearGradient(0, fadeTop, 0, fadeBottom);
    dark.addColorStop(0, rgba(BACKSTAGE.shadow, 1));
    dark.addColorStop(1, rgba(BACKSTAGE.shadow, 0));
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = dark;
    ctx.fillRect(shaftLeft - flare, fadeTop, shaftWidth + flare * 2, fadeBottom - fadeTop);
    ctx.globalCompositeOperation = 'destination-out';
    const vanish = ctx.createLinearGradient(0, fadeTop, 0, fadeTop + (fadeBottom - fadeTop) / 2);
    vanish.addColorStop(0, rgba(BACKSTAGE.shadow, 1));
    vanish.addColorStop(1, rgba(BACKSTAGE.shadow, 0));
    ctx.fillStyle = vanish;
    ctx.fillRect(shaftLeft - flare, fadeTop, shaftWidth + flare * 2, (fadeBottom - fadeTop) / 2);
  } finally {
    ctx.restore();
  }
}

function paintCollar(
  ctx: Ctx,
  shaftLeft: number,
  shaftWidth: number,
  y: number,
  ts: number,
  lashingTurns: number,
): void {
  const overhang = shaftWidth * COLLAR_OVERHANG_SHARE;
  const collarHeight = COLLAR_HEIGHT_TILES * ts;
  const left = shaftLeft - overhang;
  const collarWidth = shaftWidth + overhang * 2;
  const iron = ctx.createLinearGradient(left, 0, left + collarWidth, 0);
  iron.addColorStop(0, rgba(IRON.shadow, 1));
  iron.addColorStop(SHAFT_LIT_STOP, rgba(IRON.light, 1));
  iron.addColorStop(1, rgba(IRON.shadow, 1));
  ctx.fillStyle = iron;
  ctx.fillRect(left, y - collarHeight / 2, collarWidth, collarHeight);
  ctx.fillStyle = rgba(IRON.accent, 1);
  for (let rivet = 1; rivet <= COLLAR_RIVETS; rivet++) {
    ctx.beginPath();
    ctx.arc(
      left + (collarWidth * rivet) / (COLLAR_RIVETS + 1),
      y,
      COLLAR_RIVET_RADIUS_TILES * ts,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  // Rope lashed under the collar, in diagonal turns.
  ctx.strokeStyle = rgba(STRAW.mid, LASHING_ALPHA);
  ctx.lineWidth = LASHING_WIDTH_TILES * ts;
  for (let turn = 0; turn < lashingTurns; turn++) {
    const ty = y + collarHeight / 2 + (turn + 1) * LASHING_PITCH_TILES * ts;
    ctx.beginPath();
    ctx.moveTo(shaftLeft, ty + LASHING_LEAN_TILES * ts);
    ctx.lineTo(shaftLeft + shaftWidth, ty);
    ctx.stroke();
  }
}

function paintMastVine(
  ctx: Ctx,
  centreX: number,
  shaftWidth: number,
  originY: number,
  footY: number,
  ts: number,
): void {
  const reachY = originY;
  const points: Array<[number, number]> = [];
  for (let step = 0; step <= VINE_SEGMENTS; step++) {
    const t = step / VINE_SEGMENTS;
    const angle = t * VINE_TURNS * FULL_TURN;
    points.push([centreX + (Math.sin(angle) * shaftWidth) / 2, footY - (footY - reachY) * t]);
  }
  const trace = (): void => {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = VINE_WIDTH_TILES * ts;
  ctx.strokeStyle = rgba(VINE.shadow, VINE_ALPHA);
  trace();
  ctx.lineWidth = (VINE_WIDTH_TILES * ts) / 3;
  ctx.strokeStyle = rgba(VINE.light, VINE_SHEEN_ALPHA);
  trace();
  ctx.fillStyle = rgba(VINE.mid, VINE_ALPHA);
  for (let leaf = 0; leaf < VINE_LEAVES; leaf++) {
    const point = points[Math.floor(((leaf + 0.5) / VINE_LEAVES) * points.length)];
    ctx.beginPath();
    ctx.ellipse(
      point[0],
      point[1],
      VINE_LEAF_RADIUS_TILES * ts,
      (VINE_LEAF_RADIUS_TILES * ts) / 2,
      leaf,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
}

/**
 * A soft elliptical contact shadow, darkest at the foot and fading to nothing
 * at its rim — scaled from a circle so the fade follows the ellipse.
 */
export function paintPoleFootShadow(ctx: Ctx, shadow: PoleFootShadow): void {
  ctx.save();
  try {
    ctx.translate(shadow.centre.x, shadow.centre.y);
    ctx.scale(1, shadow.radiusY / shadow.radiusX);
    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, shadow.radiusX);
    fade.addColorStop(0, rgba(BACKSTAGE.shadow, CONTACT_AO_ALPHA));
    fade.addColorStop(1, rgba(BACKSTAGE.shadow, 0));
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.arc(0, 0, shadow.radiusX, 0, FULL_TURN);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

// ── Backstage clutter ───────────────────────────────────────────────────────

export type BackstageClutter = 'trunk' | 'costumeRack' | 'pedestal';
const CLUTTER_KINDS: ReadonlyArray<BackstageClutter> = ['trunk', 'costumeRack', 'pedestal'];
/** One mass tile in this many that could hold something, does. */
const CLUTTER_RARITY = 18;
const CLUTTER_SALT = 41;

/** Which piece of clutter, if any, a deep mass tile shows. */
export function backstageClutterAt(tileX: number, tileY: number): BackstageClutter | null {
  if (decorHash(tileX, tileY, CLUTTER_SALT) * CLUTTER_RARITY >= 1) return null;
  const pick = Math.floor(decorHash(tileY, tileX, CLUTTER_SALT) * CLUTTER_KINDS.length);
  return CLUTTER_KINDS[pick] ?? null;
}

/** The silhouettes are barely above the mass: something is there, never somewhere to stand. */
const CLUTTER_BODY_ALPHA = 0.55;
const CLUTTER_RIM_ALPHA = 0.3;
const CLUTTER_RIM_WIDTH_TILES = 0.035;
const CLUTTER_SHADOW_ALPHA = 0.5;
/** A trunk's contact shadow is this many rim widths deep. */
const CLUTTER_SHADOW_DEPTH_RIMS = 2;

const TRUNK = {
  x: 0.18,
  y: 0.38,
  w: 0.64,
  h: 0.42,
  lid: 0.12,
  strap: 0.05,
  straps: [0.2, 0.75],
} as const;
const RACK = {
  bar: 0.22,
  left: 0.14,
  right: 0.86,
  foot: 0.86,
  hangers: 5,
  drop: 0.5,
  /** The shortest costume hangs this share of the longest. */
  shortestDrop: 0.7,
  width: 0.1,
  /** A costume flares from its shoulders to its hem by this much either side. */
  hemFlare: 0.7,
} as const;
const PEDESTAL = { cx: 0.5, top: 0.4, bottom: 0.82, rx: 0.3, ry: 0.1 } as const;

/**
 * A dim shape of backstage clutter in the dark mass — a trunk, a costume rack,
 * a lion's pedestal — lit only along its upper-left rim.
 */
export function paintBackstageClutter(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  kind: BackstageClutter,
): void {
  const body = rgba(BACKSTAGE.light, CLUTTER_BODY_ALPHA);
  const rim = rgba(BACKSTAGE.accent, CLUTTER_RIM_ALPHA);
  const shadow = rgba(BACKSTAGE.shadow, CLUTTER_SHADOW_ALPHA);
  ctx.save();
  try {
    ctx.lineWidth = CLUTTER_RIM_WIDTH_TILES * ts;
    if (kind === 'trunk') {
      const x = sx + TRUNK.x * ts;
      const y = sy + TRUNK.y * ts;
      const w = TRUNK.w * ts;
      const h = TRUNK.h * ts;
      ctx.fillStyle = shadow;
      const shadowDepth = ctx.lineWidth * CLUTTER_SHADOW_DEPTH_RIMS;
      ctx.fillRect(x + shadowDepth, y + h, w, shadowDepth);
      ctx.fillStyle = body;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = rim;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.moveTo(x, y + TRUNK.lid * ts);
      ctx.lineTo(x + w, y + TRUNK.lid * ts);
      ctx.stroke();
      ctx.fillStyle = shadow;
      for (const strap of TRUNK.straps) ctx.fillRect(x + w * strap, y, TRUNK.strap * ts, h);
      return;
    }
    if (kind === 'costumeRack') {
      ctx.strokeStyle = rim;
      ctx.beginPath();
      ctx.moveTo(sx + RACK.left * ts, sy + RACK.foot * ts);
      ctx.lineTo(sx + RACK.left * ts, sy + RACK.bar * ts);
      ctx.lineTo(sx + RACK.right * ts, sy + RACK.bar * ts);
      ctx.lineTo(sx + RACK.right * ts, sy + RACK.foot * ts);
      ctx.stroke();
      ctx.fillStyle = body;
      for (let hanger = 0; hanger < RACK.hangers; hanger++) {
        const x =
          sx + (RACK.left + ((RACK.right - RACK.left) * (hanger + 0.5)) / RACK.hangers) * ts;
        const drop =
          RACK.drop *
          (RACK.shortestDrop + (1 - RACK.shortestDrop) * decorHash(hanger, 0, CLUTTER_SALT));
        ctx.beginPath();
        ctx.moveTo(x - (RACK.width / 2) * ts, sy + RACK.bar * ts);
        ctx.lineTo(x + (RACK.width / 2) * ts, sy + RACK.bar * ts);
        ctx.lineTo(x + RACK.width * ts * RACK.hemFlare, sy + (RACK.bar + drop) * ts);
        ctx.lineTo(x - RACK.width * ts * RACK.hemFlare, sy + (RACK.bar + drop) * ts);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    const cx = sx + PEDESTAL.cx * ts;
    const top = sy + PEDESTAL.top * ts;
    const bottom = sy + PEDESTAL.bottom * ts;
    const rx = PEDESTAL.rx * ts;
    const ry = PEDESTAL.ry * ts;
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(cx + ry, bottom + ry / 2, rx, ry, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = body;
    ctx.fillRect(cx - rx, top, rx * 2, bottom - top);
    ctx.beginPath();
    ctx.ellipse(cx, bottom, rx, ry, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.ellipse(cx, top, rx, ry, 0, 0, FULL_TURN);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

// ── Interval-room lamp ──────────────────────────────────────────────────────

const LAMP_Y_SHARE = 0.34;
const LAMP_BRACKET_TILES = 0.26;
const LAMP_BRACKET_WIDTH_TILES = 0.05;
const LAMP_CUP_RADIUS_TILES = 0.1;
const LAMP_BULB_RADIUS_TILES = 0.065;
const LAMP_GLOW_RADIUS_TILES = 0.55;
const LAMP_GLOW_ALPHA = 0.3;
const LAMP_FLICKER_DEPTH = 0.12;
const LAMP_FLICKER_RATE = 0.11;
const LAMP_EDGE_INSET_TILES = 0.08;
/** The cup sits just under the bulb, this share of its radius below the bulb's centre. */
const LAMP_CUP_DROP_SHARE = 0.4;
const LAMP_GLINT_TILES = 0.02;
const LAMP_GLINT_RISE_SHARE = 0.6;

/**
 * A brass wall lamp on an interval room's side wall, reaching toward the
 * room. `facing` is the side the room is on.
 */
export function drawIntervalRoomLamp(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  facing: 'east' | 'west',
  frame: number,
): void {
  const direction = facing === 'east' ? 1 : -1;
  const wallX =
    facing === 'east' ? sx + ts - LAMP_EDGE_INSET_TILES * ts : sx + LAMP_EDGE_INSET_TILES * ts;
  const y = sy + ts * LAMP_Y_SHARE;
  const bulbX = wallX + direction * LAMP_BRACKET_TILES * ts;
  const flickerPhase = (1 + Math.sin(frame * LAMP_FLICKER_RATE)) / 2;
  const flicker = 1 - LAMP_FLICKER_DEPTH * flickerPhase;
  ctx.save();
  try {
    const glow = ctx.createRadialGradient(bulbX, y, 0, bulbX, y, LAMP_GLOW_RADIUS_TILES * ts);
    glow.addColorStop(0, rgba(LIMELIGHT.light, LAMP_GLOW_ALPHA * flicker));
    glow.addColorStop(1, rgba(LIMELIGHT.mid, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bulbX, y, LAMP_GLOW_RADIUS_TILES * ts, 0, FULL_TURN);
    ctx.fill();

    ctx.strokeStyle = rgba(IRON.mid, 1);
    ctx.lineWidth = LAMP_BRACKET_WIDTH_TILES * ts;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const cupRadius = LAMP_CUP_RADIUS_TILES * ts;
    const bracketBaseY = y + cupRadius;
    const cupY = y + cupRadius * LAMP_CUP_DROP_SHARE;
    ctx.moveTo(wallX, bracketBaseY);
    ctx.quadraticCurveTo((wallX + bulbX) / 2, bracketBaseY, bulbX, cupY);
    ctx.stroke();

    ctx.fillStyle = rgba(BRASS.mid, 1);
    ctx.beginPath();
    ctx.arc(bulbX, cupY, cupRadius, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = rgba(LIMELIGHT.accent, flicker);
    ctx.beginPath();
    ctx.arc(bulbX, y, LAMP_BULB_RADIUS_TILES * ts, 0, FULL_TURN);
    ctx.fill();
    const glintSize = LAMP_GLINT_TILES * ts;
    ctx.fillStyle = rgba(BONE.accent, 1);
    ctx.fillRect(
      bulbX - glintSize,
      y - LAMP_BULB_RADIUS_TILES * ts * LAMP_GLINT_RISE_SHARE,
      glintSize,
      glintSize,
    );
  } finally {
    ctx.restore();
  }
}
