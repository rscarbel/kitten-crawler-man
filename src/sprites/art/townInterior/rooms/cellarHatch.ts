/**
 * Blackwood Lodge's cellar hatch: a two-by-two lid of heavy planks let flush
 * into the lodge's own floorboards, its timber collar the same oak as the
 * boards round it, and the well under it once the lid is up.
 *
 * Three painters share one geometry, so the baked prop and the runtime
 * opening line up to the pixel. `paintCellarTrapdoor` is the prop: collar and
 * shut lid, baked into the room's ground layer. Once the lid starts to lift,
 * `paintCellarWell` covers the shut lid with the dark shaft beneath it, and
 * `paintCellarLidLeaf` draws the lid swinging up on its north hinge.
 *
 * The lid's planks are seeded from a constant rather than the prop's rng, so
 * the leaf that replaces the baked lid on the first frame of the swing has
 * the same boards and does not visibly change.
 */

import {
  footprintBox,
  withFootprintClip,
  rgb,
  rgba,
  inkOutline,
  type TownPropFrame,
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, type Ramp, type RGB } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';
import { mulberry32 } from '../../../person/rng';

type Ctx = CanvasRenderingContext2D;

/** A rectangle in whatever pixels the caller paints in. */
export interface CellarHatchRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The opening, in tiles from the footprint's north-west corner. It covers
 * exactly the four footprint tiles in {@link CELLAR_WELL_TILES}, inset a
 * little, so a body blocked from those tiles while the lid is up never stands
 * over the drawn well.
 */
const OPENING_TILES = { left: 1.07, top: 1.05, right: 2.93, bottom: 2.86 } as const;
/** The timber collar round the opening, flush with the floor. */
const COLLAR_TILES = 0.12;

/** The footprint tiles the open well covers, from the footprint's north-west tile. */
export const CELLAR_WELL_TILES: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 1, dy: 1 },
  { dx: 2, dy: 1 },
  { dx: 1, dy: 2 },
  { dx: 2, dy: 2 },
];

/** The lid's opening, in pixels, for a footprint whose north-west corner is at (`left`, `top`). */
export function cellarHatchOpening(left: number, top: number, ts: number): CellarHatchRect {
  return {
    left: left + OPENING_TILES.left * ts,
    top: top + OPENING_TILES.top * ts,
    right: left + OPENING_TILES.right * ts,
    bottom: top + OPENING_TILES.bottom * ts,
  };
}

/** The lodge's floor oak, matched to the room's boards so the collar reads as part of the floor. */
const LODGE_OAK: Ramp = {
  shadow: [66, 46, 28],
  mid: [124, 91, 56],
  light: [152, 116, 73],
  accent: [178, 142, 96],
};
const INK: RGB = [42, 38, 36];
const BRASS: RGB = [196, 160, 84];
const BRASS_DARK: RGB = [130, 100, 48];
const CHALK: RGB = [226, 224, 214];
/** Wet stone at the top of the shaft, the only part of it the room's light reaches. */
const SHAFT_STONE: RGB = [74, 72, 66];
const SHAFT_MORTAR: RGB = [40, 38, 34];
const SHAFT_DARK: RGB = [12, 11, 10];
/** A thread loop left on the underside's brace, where the elves tied their offerings. */
const OFFERING_THREAD: RGB = [196, 72, 58];

function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}

const LID_PLANK_SEED = 0x0ce11a5;
const LID_UNDERSIDE_SEED = 0x0ce11a6;
const LID_PLANK_WIDTH_TILES = 0.3;
/** Where the two iron straps cross the lid, as fractions of its depth from the hinge. */
const STRAP_AT = [0.26, 0.7] as const;
const STRAP_HEIGHT_TILES = 0.12;
const STRAP_RIVETS = 6;
const RIVET_RADIUS_TILES = 0.025;
const STRAP_INSET_TILES = 0.04;
const STRAP_GLINT_TILES = 0.02;
const STRAP_GLINT_ALPHA = 0.5;
/** Where along the iron ramp each fitting is sampled: darker for flat straps, lighter for raised heads. */
const STRAP_IRON_SHADE = 0.4;
const STRAP_GLINT_IRON_SHADE = 1;
const RIVET_IRON_SHADE = 0.85;
const RING_IRON_SHADE = 0.55;
const RING_STAPLE_IRON_SHADE = 0.4;
const HASP_IRON_SHADE = 0.45;
/** Outline weights, as shares of a full ink outline, for fittings smaller than the lid itself. */
const FITTING_OUTLINE_SHARE = 0.8;
const SMALL_FITTING_OUTLINE_SHARE = 0.7;

/** Feet wear a paler band across the middle of the lid. */
const TRAFFIC_BAND_TILES = 0.5;
const TRAFFIC_BAND_OAK_SHADE = 0.95;
const TRAFFIC_BAND_ALPHA = 0.16;

/** The drop ring folded flat in the lid's middle, and the staple it hangs from. */
const RING_MIN_WIDTH_PX = 1.5;
const RING_WIDTH_TILES = 0.045;
const RING_DROP_TILES = 0.08;
const RING_RADIUS_X_TILES = 0.16;
const RING_RADIUS_Y_TILES = 0.11;
const RING_STAPLE_HALF_TILES = 0.06;
const RING_STAPLE_HEIGHT_TILES = 0.08;

/** The hasp plate on the lifting edge, and the brass padlock through it. */
const HASP_HALF_TILES = 0.07;
const HASP_RISE_TILES = 0.3;
const HASP_HEIGHT_TILES = 0.24;
const LOCK_HALF_TILES = 0.08;
const LOCK_RISE_TILES = 0.14;
const LOCK_HEIGHT_TILES = 0.13;
const SHACKLE_WIDTH_TILES = 0.025;
const SHACKLE_RADIUS_TILES = 0.05;

/** A bored watch's tally, scratched into the corner by the hinge. */
const TALLY_MARKS = 5;
const TALLY_ALPHA = 0.5;
const TALLY_WIDTH_TILES = 0.02;
const TALLY_IN_FROM_EDGE_TILES = 0.34;
const TALLY_PITCH_TILES = 0.05;
const TALLY_TOP_TILES = 0.05;
const TALLY_BOTTOM_TILES = 0.15;

const HAIRLINE_MIN_PX = 1;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/**
 * The lid's top face, in a frame where the hinge runs along `y` and the edge
 * a hand lifts by runs along `y + h`: the strapped planks, the drop ring
 * folded flat and the padlocked hasp on the lifting edge.
 */
function paintLidTop(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const iron = ironRamp();
  paintPlankBoard(ctx, x, y, w, h, mulberry32(LID_PLANK_SEED), {
    direction: 'vertical',
    boardPx: ts * LID_PLANK_WIDTH_TILES,
    ramp: LODGE_OAK,
  });
  const trafficBand = ts * TRAFFIC_BAND_TILES;
  ctx.fillStyle = rgba(sampleRamp(LODGE_OAK, TRAFFIC_BAND_OAK_SHADE), TRAFFIC_BAND_ALPHA);
  ctx.fillRect(x, y + h / 2 - trafficBand / 2, w, trafficBand);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);

  const strapH = ts * STRAP_HEIGHT_TILES;
  const strapInset = ts * STRAP_INSET_TILES;
  for (const share of STRAP_AT) {
    const sy = y + h * share;
    ctx.fillStyle = rgb(sampleRamp(iron, STRAP_IRON_SHADE));
    ctx.beginPath();
    ctx.rect(x + strapInset, sy - strapH / 2, w - strapInset * 2, strapH);
    ctx.fill();
    inkOutline(ctx, ts * FITTING_OUTLINE_SHARE);
    ctx.fillStyle = rgba(sampleRamp(iron, STRAP_GLINT_IRON_SHADE), STRAP_GLINT_ALPHA);
    ctx.fillRect(
      x + strapInset,
      sy - strapH / 2,
      w - strapInset * 2,
      Math.max(HAIRLINE_MIN_PX, ts * STRAP_GLINT_TILES),
    );
    ctx.fillStyle = rgb(sampleRamp(iron, RIVET_IRON_SHADE));
    for (let i = 0; i < STRAP_RIVETS; i++) {
      ctx.beginPath();
      ctx.arc(
        x + strapInset * 2 + ((w - strapInset * 4) * (i + HALF)) / STRAP_RIVETS,
        sy,
        ts * RIVET_RADIUS_TILES,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  }

  const ringX = x + w / 2;
  const ringY = y + h / 2;
  ctx.strokeStyle = rgb(sampleRamp(iron, RING_IRON_SHADE));
  ctx.lineWidth = Math.max(RING_MIN_WIDTH_PX, ts * RING_WIDTH_TILES);
  ctx.beginPath();
  ctx.ellipse(
    ringX,
    ringY + ts * RING_DROP_TILES,
    ts * RING_RADIUS_X_TILES,
    ts * RING_RADIUS_Y_TILES,
    0,
    0,
    FULL_TURN,
  );
  ctx.stroke();
  ctx.fillStyle = rgb(sampleRamp(iron, RING_STAPLE_IRON_SHADE));
  const stapleHalf = ts * RING_STAPLE_HALF_TILES;
  ctx.fillRect(
    ringX - stapleHalf,
    ringY - stapleHalf,
    stapleHalf * 2,
    ts * RING_STAPLE_HEIGHT_TILES,
  );

  const haspX = x + w / 2;
  const lip = y + h;
  const haspHalf = ts * HASP_HALF_TILES;
  ctx.fillStyle = rgb(sampleRamp(iron, HASP_IRON_SHADE));
  ctx.beginPath();
  ctx.rect(haspX - haspHalf, lip - ts * HASP_RISE_TILES, haspHalf * 2, ts * HASP_HEIGHT_TILES);
  ctx.fill();
  inkOutline(ctx, ts * SMALL_FITTING_OUTLINE_SHARE);
  const lockHalf = ts * LOCK_HALF_TILES;
  const lockTop = lip - ts * LOCK_RISE_TILES;
  ctx.fillStyle = rgb(BRASS);
  ctx.beginPath();
  ctx.rect(haspX - lockHalf, lockTop, lockHalf * 2, ts * LOCK_HEIGHT_TILES);
  ctx.fill();
  inkOutline(ctx, ts * SMALL_FITTING_OUTLINE_SHARE);
  ctx.strokeStyle = rgb(BRASS_DARK);
  ctx.lineWidth = Math.max(HAIRLINE_MIN_PX, ts * SHACKLE_WIDTH_TILES);
  ctx.beginPath();
  ctx.arc(haspX, lockTop, ts * SHACKLE_RADIUS_TILES, Math.PI, 0);
  ctx.stroke();

  ctx.strokeStyle = rgba(CHALK, TALLY_ALPHA);
  ctx.lineWidth = Math.max(HAIRLINE_MIN_PX, ts * TALLY_WIDTH_TILES);
  for (let i = 0; i < TALLY_MARKS; i++) {
    const tx = x + w - ts * TALLY_IN_FROM_EDGE_TILES + i * ts * TALLY_PITCH_TILES;
    ctx.beginPath();
    ctx.moveTo(tx, y + ts * TALLY_TOP_TILES);
    ctx.lineTo(tx, y + ts * TALLY_BOTTOM_TILES);
    ctx.stroke();
  }
}

/** The underside's boards, darker than the top, and the damp that creeps down from the hinge. */
const UNDERSIDE_SHADE_ALPHA = 0.38;
const DAMP_DEPTH_SHARE = 0.4;
const DAMP_ALPHA = 0.45;
/** The Z of battens holding the underside's boards, as shares of the lid's depth from the hinge. */
const BATTEN_HEIGHT_TILES = 0.16;
const BATTEN_INSET_TILES = 0.08;
const BATTEN_TOP_SHARE = 0.2;
const BATTEN_BOTTOM_SHARE = 0.78;
const BATTEN_OAK_SHADE = 0.3;
/** The thread loops hanging off the bottom batten. */
const THREAD_WIDTH_TILES = 0.025;
const THREAD_SWING_TILES = 0.05;
const THREAD_BELLY_TILES = 0.14;
const THREAD_TAIL_BACK_TILES = 0.02;
const THREAD_DROP_TILES = 0.2;

/**
 * The lid's underside, in the same hinge-at-`y` frame: rougher boards held
 * by a Z of battens, damp along the hinge, and thread still knotted to the
 * brace where the fur hung.
 */
function paintLidUnderside(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  paintPlankBoard(ctx, x, y, w, h, mulberry32(LID_UNDERSIDE_SEED), {
    direction: 'vertical',
    boardPx: ts * LID_PLANK_WIDTH_TILES,
    ramp: LODGE_OAK,
  });
  ctx.fillStyle = rgba(INK, UNDERSIDE_SHADE_ALPHA);
  ctx.fillRect(x, y, w, h);
  const dampDepth = h * DAMP_DEPTH_SHARE;
  const damp = ctx.createLinearGradient(0, y, 0, y + dampDepth);
  damp.addColorStop(0, rgba(SHAFT_DARK, DAMP_ALPHA));
  damp.addColorStop(1, rgba(SHAFT_DARK, 0));
  ctx.fillStyle = damp;
  ctx.fillRect(x, y, w, dampDepth);

  const battenH = ts * BATTEN_HEIGHT_TILES;
  const battenInset = ts * BATTEN_INSET_TILES;
  const battenTop = y + h * BATTEN_TOP_SHARE;
  const battenBottom = y + h * BATTEN_BOTTOM_SHARE;
  ctx.fillStyle = rgb(sampleRamp(LODGE_OAK, BATTEN_OAK_SHADE));
  for (const by of [battenTop, battenBottom]) {
    ctx.beginPath();
    ctx.rect(x + battenInset, by - battenH / 2, w - battenInset * 2, battenH);
    ctx.fill();
    inkOutline(ctx, ts * SMALL_FITTING_OUTLINE_SHARE);
  }
  ctx.beginPath();
  ctx.moveTo(x + battenInset, battenBottom - battenH / 2);
  ctx.lineTo(x + battenInset + battenH, battenBottom - battenH / 2);
  ctx.lineTo(x + w - battenInset, battenTop + battenH / 2);
  ctx.lineTo(x + w - battenInset - battenH, battenTop + battenH / 2);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * SMALL_FITTING_OUTLINE_SHARE);

  ctx.strokeStyle = rgb(OFFERING_THREAD);
  ctx.lineWidth = Math.max(HAIRLINE_MIN_PX, ts * THREAD_WIDTH_TILES);
  const threadLoops = [0.3, 0.52, 0.71] as const;
  for (const share of threadLoops) {
    const tx = x + w * share;
    ctx.beginPath();
    ctx.moveTo(tx, battenBottom);
    ctx.quadraticCurveTo(
      tx + ts * THREAD_SWING_TILES,
      battenBottom + ts * THREAD_BELLY_TILES,
      tx - ts * THREAD_TAIL_BACK_TILES,
      battenBottom + ts * THREAD_DROP_TILES,
    );
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/** Boots scuff the boards round the hatch: a wash, not a ring, centred a little south of the middle. */
const SCUFF_CENTRE_SHARE = 0.6;
const SCUFF_INNER_TILES = 0.6;
const SCUFF_OUTER_TILES = 1.6;
const SCUFF_ALPHA = 0.1;
const COLLAR_OAK_SHADE = 0.38;
const COLLAR_GLINT_OAK_SHADE = 1;
const COLLAR_GLINT_ALPHA = 0.35;
const COLLAR_GLINT_TILES = 0.025;
const MITRE_ALPHA = 0.45;
const MITRE_WIDTH_TILES = 0.02;
/** The dark gap round the shut lid, and how far it shows past the lid's edge. */
const LID_GAP_ALPHA = 0.7;
const LID_GAP_TILES = 0.02;

/**
 * The prop: the collar let into the boards and the lid shut in it. Ground
 * layer — it is floor, and a crawler walks straight over it.
 */
export function paintCellarTrapdoor(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const ts = frame.tileScale;
    const box = footprintBox(frame);
    const opening = cellarHatchOpening(box.left, box.top, ts);
    const collar = COLLAR_TILES * ts;
    const cl = opening.left - collar;
    const ct = opening.top - collar;
    const cw = opening.right - opening.left + collar * 2;
    const ch = opening.bottom - opening.top + collar * 2;

    const scuffX = cl + cw / 2;
    const scuffY = ct + ch * SCUFF_CENTRE_SHARE;
    const scuff = ctx.createRadialGradient(
      scuffX,
      scuffY,
      ts * SCUFF_INNER_TILES,
      scuffX,
      scuffY,
      ts * SCUFF_OUTER_TILES,
    );
    scuff.addColorStop(0, rgba(INK, SCUFF_ALPHA));
    scuff.addColorStop(1, rgba(INK, 0));
    ctx.fillStyle = scuff;
    ctx.fillRect(box.left, box.top, box.width, box.height);

    ctx.fillStyle = rgb(sampleRamp(LODGE_OAK, COLLAR_OAK_SHADE));
    ctx.fillRect(cl, ct, cw, ch);
    ctx.fillStyle = rgba(sampleRamp(LODGE_OAK, COLLAR_GLINT_OAK_SHADE), COLLAR_GLINT_ALPHA);
    ctx.fillRect(cl, ct, cw, Math.max(HAIRLINE_MIN_PX, ts * COLLAR_GLINT_TILES));
    // Mitred corners, so the collar reads as four joined timbers.
    ctx.strokeStyle = rgba(INK, MITRE_ALPHA);
    ctx.lineWidth = Math.max(HAIRLINE_MIN_PX, ts * MITRE_WIDTH_TILES);
    ctx.beginPath();
    ctx.moveTo(cl, ct);
    ctx.lineTo(opening.left, opening.top);
    ctx.moveTo(cl + cw, ct);
    ctx.lineTo(opening.right, opening.top);
    ctx.moveTo(cl, ct + ch);
    ctx.lineTo(opening.left, opening.bottom);
    ctx.moveTo(cl + cw, ct + ch);
    ctx.lineTo(opening.right, opening.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(cl, ct, cw, ch);
    inkOutline(ctx, ts);

    const gap = ts * LID_GAP_TILES;
    ctx.fillStyle = rgba(INK, LID_GAP_ALPHA);
    ctx.fillRect(
      opening.left - gap,
      opening.top - gap,
      opening.right - opening.left + gap * 2,
      opening.bottom - opening.top + gap * 2,
    );
    paintLidTop(
      ctx,
      opening.left,
      opening.top,
      opening.right - opening.left,
      opening.bottom - opening.top,
      ts,
    );
  });
}

/** How far the shaft's far wall shows below the north lip, as a share of the opening's depth. */
const FAR_WALL_SHARE = 0.62;
const SHAFT_COURSE_TILES = 0.2;
const LADDER_HALF_SPAN_TILES = 0.3;
const LADDER_RUNG_PITCH_TILES = 0.2;
const LADDER_FIRST_RUNG_TILES = 0.08;
const LADDER_RAIL_MIN_PX = 1.5;
const LADDER_RAIL_TILES = 0.05;
const LADDER_IRON_SHADE = 0.7;
/** The shaft's far wall fades from this much dark at the lip to all dark at its foot. */
const SHAFT_LIP_DARK_ALPHA = 0.15;
/** The collar's own shadow falling over the north lip. */
const COLLAR_SHADOW_ALPHA = 0.6;
const COLLAR_SHADOW_TILES = 0.06;

/**
 * The open shaft, painted over the shut lid: the far wall's top courses and
 * the iron ladder bolted to it, falling away into the dark.
 */
export function paintCellarWell(ctx: Ctx, opening: CellarHatchRect, ts: number): void {
  const w = opening.right - opening.left;
  const h = opening.bottom - opening.top;
  const iron = ironRamp();
  ctx.save();
  ctx.beginPath();
  ctx.rect(opening.left, opening.top, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(SHAFT_DARK);
  ctx.fillRect(opening.left, opening.top, w, h);

  const wallBottom = opening.top + h * FAR_WALL_SHARE;
  const course = ts * SHAFT_COURSE_TILES;
  ctx.fillStyle = rgb(SHAFT_MORTAR);
  ctx.fillRect(opening.left, opening.top, w, wallBottom - opening.top);
  let row = 0;
  for (let cy = opening.top; cy < wallBottom; cy += course, row++) {
    const blockW = course * 2;
    const offset = row % 2 === 0 ? 0 : blockW / 2;
    for (let cx = opening.left - offset; cx < opening.right; cx += blockW) {
      ctx.fillStyle = rgb(SHAFT_STONE);
      ctx.fillRect(cx + 1, cy + 1, blockW - 2, course - 2);
    }
  }

  const cx = opening.left + w / 2;
  const railW = Math.max(LADDER_RAIL_MIN_PX, ts * LADDER_RAIL_TILES);
  ctx.fillStyle = rgb(sampleRamp(iron, LADDER_IRON_SHADE));
  for (const side of [-1, 1] as const) {
    ctx.fillRect(cx + side * ts * LADDER_HALF_SPAN_TILES - railW / 2, opening.top, railW, h);
  }
  const firstRung = opening.top + ts * LADDER_FIRST_RUNG_TILES;
  for (let ry = firstRung; ry < opening.bottom; ry += ts * LADDER_RUNG_PITCH_TILES) {
    ctx.fillRect(cx - ts * LADDER_HALF_SPAN_TILES, ry, ts * LADDER_HALF_SPAN_TILES * 2, railW);
  }

  const fall = ctx.createLinearGradient(0, opening.top, 0, wallBottom);
  fall.addColorStop(0, rgba(SHAFT_DARK, SHAFT_LIP_DARK_ALPHA));
  fall.addColorStop(1, rgba(SHAFT_DARK, 1));
  ctx.fillStyle = fall;
  ctx.fillRect(opening.left, opening.top, w, wallBottom - opening.top);
  ctx.fillStyle = rgb(SHAFT_DARK);
  ctx.fillRect(opening.left, wallBottom, w, opening.bottom - wallBottom);

  ctx.fillStyle = rgba(SHAFT_DARK, COLLAR_SHADOW_ALPHA);
  ctx.fillRect(opening.left, opening.top, w, ts * COLLAR_SHADOW_TILES);
  ctx.restore();
}

/**
 * How tall a face standing straight up is drawn, against one lying flat. The
 * room is seen from above and to the south, where a standing face keeps its
 * full height.
 */
const UPRIGHT_HEIGHT_SCALE = 1;
const LID_THICKNESS_TILES = 0.1;
/** How fast the lifting edge's end grain comes into view as the lid leaves the collar. */
const EDGE_SHOW_RATE = 3;
/** The darkest the top face goes as it turns away from the room's light. */
const TOP_FACE_TURN_SHADE = 0.3;
const END_GRAIN_OAK_SHADE = 0.22;

/**
 * The lid swung `angle` radians up off the opening on its north hinge: 0 is
 * shut, a right angle stands it straight up. Past the point where it stands
 * edge-on to the room, its underside is the face that shows.
 */
export function paintCellarLidLeaf(
  ctx: Ctx,
  opening: CellarHatchRect,
  ts: number,
  angle: number,
): void {
  const w = opening.right - opening.left;
  const depth = opening.bottom - opening.top;
  const reach = Math.cos(angle) - UPRIGHT_HEIGHT_SCALE * Math.sin(angle);
  const farEdgeY = opening.top + reach * depth;
  const thickness = ts * LID_THICKNESS_TILES * Math.min(1, Math.sin(angle) * EDGE_SHOW_RATE);
  ctx.save();
  ctx.translate(opening.left, opening.top);
  ctx.scale(1, reach);
  if (reach >= 0) {
    paintLidTop(ctx, 0, 0, w, depth, ts);
    ctx.fillStyle = rgba(INK, TOP_FACE_TURN_SHADE * (1 - reach));
    ctx.fillRect(0, 0, w, depth);
  } else {
    paintLidUnderside(ctx, 0, 0, w, depth, ts);
  }
  ctx.restore();

  // The lifting edge's end grain, facing the room whichever way the lid leans.
  const edgeTop = reach >= 0 ? farEdgeY : farEdgeY - thickness;
  ctx.fillStyle = rgb(sampleRamp(LODGE_OAK, END_GRAIN_OAK_SHADE));
  ctx.beginPath();
  ctx.rect(opening.left, edgeTop, w, thickness);
  ctx.fill();
  inkOutline(ctx, ts * FITTING_OUTLINE_SHARE);
}
