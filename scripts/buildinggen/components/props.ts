/**
 * The clutter a building keeps at its feet, on its wall and over its door.
 *
 * Props are the only thing in the kit painted in **frame space**. A material
 * paints into a flat plane and lets `drawPlane` warp it, because a course of
 * stone is part of the wall's surface; a barrel is not on the wall, it stands in
 * front of it, and a barrel warped onto the facade quad would lean with the
 * building and shear with the roof. So everything here takes the finished frame
 * canvas and draws over the top of it.
 *
 * ## What every prop owes the picture
 *
 * 1. **A silhouette that survives the downsample.** These frames are baked at
 *    1.5x the display tile and sampled down, so the outline of a shape carries
 *    the read and interior detail mostly does not. A cauldron is a belly, three
 *    legs and a rim; adding rivets to it spends pixels that will not exist.
 * 2. **Contact with the world.** A prop with no shadow beneath it floats, and a
 *    floating barrel is the single loudest tell that art was composited rather
 *    than painted. Ground props get a soft ellipse under them; wall-mounted and
 *    hung props get their shadow on the wall behind instead, because an ellipse
 *    on the ground under an awning would land halfway up the facade.
 * 3. **The town's one sun.** Upper-left, the same as every plane: a lit top and
 *    left face, a shadowed lower-right.
 * 4. **Never one flat colour.** Every element samples its ramp with its own tone
 *    and hue jitter, the same law the materials obey.
 *
 * Props do not shade themselves by plane and do not ink their own silhouette —
 * `paint.ts` owns both, and a prop that inked itself would be outlined twice.
 */

import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import type { NoiseField } from '../../tilegen/noise.js';
import { paintEdgeAo, paintRecessAo, paintEdgeLight, paintWindowGlow } from '../lighting.js';
import { groundHeightToFrameY } from '../projection.js';
import type { Projection } from '../projection.js';
import { getRamp, hueShift, rgb, rgba, sampleRamp, type Ramp, type RGB } from '../ramps.js';
import type { PropKind, PropSpec, ReliefDevice } from '../spec.js';
import { jointWander } from '../texture.js';
import { ELEMENT_HUE_JITTER, ELEMENT_TONE_JITTER, elementValue } from '../materials/kit.js';

const TWO_PI = Math.PI * 2;

/**
 * Ramp positions a prop's faces are built from.
 *
 * Named rather than written at each call because the whole set of props has to
 * agree about what "the lit face" is worth — one prop lighting its top at 0.9
 * beside another lighting its top at 0.7 reads as two different suns.
 */
const TONE_DEEP = 0.08;
const TONE_SHADOW = 0.26;
const TONE_BODY = 0.5;
const TONE_LIT = 0.76;
const TONE_HIGHLIGHT = 0.94;

/** Streams, so two properties of one element never share a number. */
const STREAM_ELEMENT_TONE = 21;
const STREAM_ELEMENT_HUE = 22;
const STREAM_VARIANT = 23;
const STREAM_WOBBLE = 24;

/** How far a hand-drawn edge strays off true, and over what period. */
const PROP_WANDER_PX = 0.9;
const PROP_WANDER_PERIOD = 9;

/**
 * The contact shadow's peak alpha stays under the silhouette pass's opacity
 * threshold: an ellipse dark enough to count as part of the building gets inked
 * around its rim, and a barrel then stands in a drawn puddle.
 */
const CONTACT_SHADOW_ALPHA = 0.34;
const CONTACT_SHADOW_WIDTH_FACTOR = 0.66;
const CONTACT_SHADOW_HEIGHT_FACTOR = 0.17;
/** The shadow falls away from the sun, so it is pushed down and to the right. */
const CONTACT_SHADOW_OFFSET_X_FACTOR = 0.12;
const CONTACT_SHADOW_OFFSET_Y_FACTOR = 0.04;
const CONTACT_SHADOW_CORE_STOP = 0.45;
const CONTACT_SHADOW_CORE_FRACTION = 0.75;

/** A hung or fixed prop drops its shadow onto the wall, offset down and right. */
const WALL_SHADOW_ALPHA = 0.3;
const WALL_SHADOW_OFFSET_FACTOR = 0.16;
const WALL_SHADOW_REACH_FACTOR = 0.5;

/**
 * How a prop meets the world.
 *
 * `wall_open` exists because the box shadow a `wall` prop gets is the size of its
 * whole footprint, and a prop that is mostly gaps — a rack of hanging tools, a
 * cord of charms, a shed held up on two posts — then stands in front of a solid
 * dark panel and reads as a framed rectangle. Those paint a shadow shaped like
 * what they actually are, from inside their own painter.
 */
type PropMounting = 'ground' | 'wall' | 'wall_open';

/**
 * Exhaustive by construction: a kind added to `PropKind` without an entry here
 * fails to compile, which is the point — a prop whose mounting nobody decided
 * would silently be given a ground shadow in mid-air.
 */
const PROP_MOUNTING: Readonly<Record<PropKind, PropMounting>> = {
  barrel: 'ground',
  crate: 'ground',
  sack: 'ground',
  firewood: 'ground',
  wool_bale: 'ground',
  crook: 'ground',
  cart_wheel: 'ground',
  sawhorse: 'ground',
  plank_stack: 'ground',
  herb_bundle: 'wall_open',
  vine: 'wall',
  brazier: 'ground',
  lantern: 'wall',
  anvil: 'ground',
  quench_barrel: 'ground',
  tool_rack: 'wall_open',
  cauldron: 'ground',
  charm_string: 'wall_open',
  hay_bale: 'ground',
  pitchfork: 'ground',
  grain_sack: 'ground',
  weathervane: 'wall',
  rope_line: 'ground',
  suit_lantern: 'wall',
  awning: 'wall',
  letter_board: 'wall',
  relief_board: 'wall',
  bead_curtain: 'wall',
  boarded_window: 'wall_open',
  lean_to: 'wall_open',
  forge_mouth: 'wall',
};

/** A prop's footprint in frame space. `row` names its base, not its top. */
interface PropBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly centreX: number;
  readonly baseY: number;
}

/** Everything a painter needs, resolved once so no painter re-derives geometry. */
interface PropDraw {
  readonly ctx: NodeCtx;
  readonly prop: PropSpec;
  readonly box: PropBox;
  readonly scale: number;
  readonly body: Ramp;
  readonly accent: Ramp;
  readonly noise: NoiseField;
  readonly seed: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Paints one prop over the finished walls.
 *
 * `seed` already carries the prop's position in its building's list, so two
 * barrels side by side differ without any painter being told which one it is.
 */
export function paintProp(
  ctx: NodeCtx,
  projection: Projection,
  prop: PropSpec,
  noise: NoiseField,
  seed: number,
): void {
  const draw: PropDraw = {
    ctx,
    prop,
    box: propBox(projection, prop),
    scale: projection.scale,
    body: getRamp(prop.ramp),
    accent: getRamp(prop.accentRamp),
    noise,
    seed,
  };

  paintMountingShadow(draw);

  switch (prop.kind) {
    case 'barrel':
      return paintBarrel(draw);
    case 'crate':
      return paintCrate(draw);
    case 'sack':
      return paintSack(draw);
    case 'firewood':
      return paintFirewood(draw);
    case 'wool_bale':
      return paintWoolBale(draw);
    case 'crook':
      return paintCrook(draw);
    case 'cart_wheel':
      return paintCartWheel(draw);
    case 'sawhorse':
      return paintSawhorse(draw);
    case 'plank_stack':
      return paintPlankStack(draw);
    case 'herb_bundle':
      return paintHerbBundle(draw);
    case 'vine':
      return paintVine(draw);
    case 'brazier':
      return paintBrazier(draw);
    case 'lantern':
      return paintLantern(draw);
    case 'anvil':
      return paintAnvil(draw);
    case 'quench_barrel':
      return paintQuenchBarrel(draw);
    case 'tool_rack':
      return paintToolRack(draw);
    case 'cauldron':
      return paintCauldron(draw);
    case 'charm_string':
      return paintCharmString(draw);
    case 'hay_bale':
      return paintHayBale(draw);
    case 'pitchfork':
      return paintPitchfork(draw);
    case 'grain_sack':
      return paintGrainSack(draw);
    case 'weathervane':
      return paintWeathervane(draw);
    case 'rope_line':
      return paintRopeLine(draw);
    case 'suit_lantern':
      return paintSuitLantern(draw);
    case 'awning':
      return paintAwning(draw);
    case 'letter_board':
      return paintLetterBoard(draw);
    case 'relief_board':
      return paintReliefBoard(draw);
    case 'bead_curtain':
      return paintBeadCurtain(draw);
    case 'boarded_window':
      return paintBoardedWindow(draw);
    case 'lean_to':
      return paintLeanTo(draw);
    case 'forge_mouth':
      return paintForgeMouth(draw);
  }

  return assertEveryKindPainted(prop.kind);
}

/**
 * A kind added to `PropKind` and not to the switch above arrives here with a
 * type that is no longer `never`, which is a compile error — rather than a prop
 * the spec asked for and the frame silently does not contain.
 */
function assertEveryKindPainted(kind: never): never {
  throw new Error(`Unpainted prop kind '${String(kind)}'`);
}

function propBox(projection: Projection, prop: PropSpec): PropBox {
  const width = prop.widthTiles * projection.scale;
  const height = prop.heightTiles * projection.scale;
  const left = prop.col * projection.scale;
  const baseY = groundHeightToFrameY(projection, prop.baseAboveGroundTiles);
  return {
    left,
    right: left + width,
    top: baseY - height,
    width,
    height,
    centreX: left + width / 2,
    baseY,
  };
}

// ── the shared vocabulary every painter draws with ─────────────────────────

/**
 * A ramp sample carrying the per-element tone and hue jitter.
 *
 * Every fill in this file goes through here rather than calling `sampleRamp`
 * directly, which is what keeps a stack of six planks from being six copies of
 * one colour.
 */
function elementColor(ramp: Ramp, tone: number, seed: number, index: number): RGB {
  const toneJitter =
    (elementValue(seed, STREAM_ELEMENT_TONE, index) - 0.5) * 2 * ELEMENT_TONE_JITTER;
  const hue = (elementValue(seed, STREAM_ELEMENT_HUE, index) - 0.5) * 2 * ELEMENT_HUE_JITTER;
  return hueShift(sampleRamp(ramp, clamp01(tone + toneJitter)), hue);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Deterministic value in [0, 1) for a prop's own choices — which suit, which device. */
function variant(draw: PropDraw, index: number): number {
  return elementValue(draw.seed, STREAM_VARIANT, index);
}

/** Sub-pixel stray so nothing in a prop is ruler-straight. */
function wanderAt(draw: PropDraw, x: number, y: number): number {
  return jointWander(draw.noise, x, y, draw.seed, PROP_WANDER_PX, PROP_WANDER_PERIOD);
}

function strokeLine(
  ctx: NodeCtx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: RGB,
  widthPx: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = Math.max(1, widthPx);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.restore();
}

function fillEllipse(
  ctx: NodeCtx,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  color: RGB,
  alpha = 1,
): void {
  ctx.save();
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.ellipse(centreX, centreY, Math.max(0.5, radiusX), Math.max(0.5, radiusY), 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * A solid with a lit top and left and a shadowed bottom and right.
 *
 * One pixel of light on the top edge and one of shadow on the bottom is what
 * turns a rectangle into an object, and it is the cheapest volume cue that
 * survives the downsample.
 */
const BLOCK_EDGE_FRACTION = 0.14;
const BLOCK_EDGE_MIN_PX = 1;
const BLOCK_EDGE_MAX_PX = 3;
const BLOCK_LIT_ALPHA = 0.8;
const BLOCK_SHADOW_ALPHA = 0.65;
const BLOCK_LEFT_LIGHT_FRACTION = 0.6;

function paintLitBlock(
  ctx: NodeCtx,
  rect: Rect,
  ramp: Ramp,
  tone: number,
  seed: number,
  index: number,
): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const edge = clampEdgePx(Math.min(rect.width, rect.height) * BLOCK_EDGE_FRACTION);

  ctx.fillStyle = rgb(elementColor(ramp, tone, seed, index));
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  ctx.fillStyle = rgba(elementColor(ramp, TONE_LIT, seed, index), BLOCK_LIT_ALPHA);
  ctx.fillRect(rect.x, rect.y, rect.width, edge);
  ctx.fillStyle = rgba(
    elementColor(ramp, TONE_LIT, seed, index),
    BLOCK_LIT_ALPHA * BLOCK_LEFT_LIGHT_FRACTION,
  );
  ctx.fillRect(rect.x, rect.y, edge, rect.height);

  ctx.fillStyle = rgba(elementColor(ramp, TONE_SHADOW, seed, index), BLOCK_SHADOW_ALPHA);
  ctx.fillRect(rect.x, rect.y + rect.height - edge, rect.width, edge);
  ctx.fillRect(rect.x + rect.width - edge, rect.y, edge, rect.height);
}

function clampEdgePx(value: number): number {
  return Math.min(BLOCK_EDGE_MAX_PX, Math.max(BLOCK_EDGE_MIN_PX, value));
}

/** A round shaft — a staff, a haft, a post — lit down its left flank. */
function paintShaft(
  ctx: NodeCtx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  thickness: number,
  ramp: Ramp,
  seed: number,
  index: number,
): void {
  const LIT_OFFSET_FRACTION = 0.28;
  const LIT_WIDTH_FRACTION = 0.32;
  strokeLine(ctx, fromX, fromY, toX, toY, elementColor(ramp, TONE_BODY, seed, index), thickness);
  const offset = thickness * LIT_OFFSET_FRACTION;
  strokeLine(
    ctx,
    fromX - offset,
    fromY,
    toX - offset,
    toY,
    elementColor(ramp, TONE_LIT, seed, index),
    thickness * LIT_WIDTH_FRACTION,
  );
}

// ── contact with the world ─────────────────────────────────────────────────

function paintMountingShadow(draw: PropDraw): void {
  switch (PROP_MOUNTING[draw.prop.kind]) {
    case 'ground':
      return paintContactShadow(draw);
    case 'wall':
      return paintWallShadow(draw);
    case 'wall_open':
      return;
  }
}

/** How far a hung shape's shadow falls from it, as a fraction of the prop's height. */
const CAST_SHADOW_OFFSET_FACTOR = 0.09;
const CAST_SHADOW_ALPHA = 0.42;

/**
 * The shadow one painted shape throws onto whatever is behind it.
 *
 * `source-atop` keeps it on the building for the same reason `paintWallShadow`
 * does — a shadow that spilled past the facade would be a dark smear in open sky
 * — and it is what separates a hanging tool from a stripe painted on the wall.
 */
function paintCastShadow(draw: PropDraw, trace: (ctx: NodeCtx) => void): void {
  const { ctx, box } = draw;
  const offset = Math.max(1, box.height * CAST_SHADOW_OFFSET_FACTOR);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = rgba(sampleRamp(getRamp('ground_shadow'), 0), CAST_SHADOW_ALPHA);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.translate(offset, offset);
  trace(ctx);
  ctx.restore();
}

/** The soft ellipse a standing prop sits in. */
function paintContactShadow(draw: PropDraw): void {
  const { ctx, box } = draw;
  const radiusX = box.width * CONTACT_SHADOW_WIDTH_FACTOR;
  const radiusY = box.width * CONTACT_SHADOW_HEIGHT_FACTOR;
  const centreX = box.centreX + box.width * CONTACT_SHADOW_OFFSET_X_FACTOR;
  const centreY = box.baseY + box.width * CONTACT_SHADOW_OFFSET_Y_FACTOR;
  const shadow = sampleRamp(getRamp('ground_shadow'), 0);

  const gradient = ctx.createRadialGradient(centreX, centreY, 0, centreX, centreY, radiusX);
  gradient.addColorStop(0, rgba(shadow, CONTACT_SHADOW_ALPHA));
  gradient.addColorStop(
    CONTACT_SHADOW_CORE_STOP,
    rgba(shadow, CONTACT_SHADOW_ALPHA * CONTACT_SHADOW_CORE_FRACTION),
  );
  gradient.addColorStop(1, rgba(shadow, 0));

  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(1, radiusY / Math.max(1, radiusX));
  ctx.translate(-centreX, -centreY);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centreX, centreY, radiusX, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * The shadow a fixed or hung prop drops on the wall behind it.
 *
 * `source-atop` keeps it on the building: a shadow that spilled past the facade
 * into open sky would be a dark smear floating beside the roof.
 */
function paintWallShadow(draw: PropDraw): void {
  const { ctx, box } = draw;
  const offset = Math.min(box.width, box.height) * WALL_SHADOW_OFFSET_FACTOR;
  const rect: Rect = {
    x: box.left + offset,
    y: box.top + offset,
    width: box.width,
    height: box.height,
  };
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = rgba(sampleRamp(getRamp('ground_shadow'), 0), WALL_SHADOW_ALPHA);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  paintEdgeAo(ctx, rect, 'top', {
    depth: WALL_SHADOW_ALPHA,
    reach: rect.height * WALL_SHADOW_REACH_FACTOR,
  });
}

// ── yard clutter ───────────────────────────────────────────────────────────

/** Bulge of a cask's waist past its ends, as a fraction of nominal width. */
const BARREL_BULGE_FRACTION = 0.12;
const BARREL_END_INSET_FRACTION = 0.08;
const BARREL_STAVE_COUNT = 7;
const BARREL_HOOP_COUNT = 3;
const BARREL_HOOP_THICKNESS_FRACTION = 0.07;
const BARREL_LID_RISE_FRACTION = 0.1;

function paintBarrel(draw: PropDraw): void {
  paintCask(draw, draw.box);
  paintCaskLid(draw, draw.box, draw.body, TONE_LIT);
}

/**
 * The staved body every cask in the town is built from.
 *
 * The bulge is the whole read: a straight-sided cylinder at this size is a tin
 * can, and the two curves are what say "coopered".
 */
function paintCask(draw: PropDraw, box: PropBox): void {
  const { ctx, body, accent, seed } = draw;
  const bulge = box.width * BARREL_BULGE_FRACTION;
  const endInset = box.width * BARREL_END_INSET_FRACTION;

  for (let stave = 0; stave < BARREL_STAVE_COUNT; stave++) {
    const leftFraction = stave / BARREL_STAVE_COUNT;
    const rightFraction = (stave + 1) / BARREL_STAVE_COUNT;
    // Staves nearest the left edge face the sun; the rightmost roll away from it.
    const tone = TONE_LIT - (TONE_LIT - TONE_SHADOW) * curveAcross(leftFraction);
    ctx.fillStyle = rgb(elementColor(body, tone, seed, stave));
    ctx.beginPath();
    traceStaveEdge(ctx, box, leftFraction, bulge, endInset, false);
    traceStaveEdge(ctx, box, rightFraction, bulge, endInset, true);
    ctx.closePath();
    ctx.fill();
  }

  const hoopThickness = box.height * BARREL_HOOP_THICKNESS_FRACTION;
  for (let hoop = 0; hoop < BARREL_HOOP_COUNT; hoop++) {
    const HOOP_TOP_MARGIN = 0.16;
    const HOOP_SPAN = 0.68;
    const down = HOOP_TOP_MARGIN + (hoop / Math.max(1, BARREL_HOOP_COUNT - 1)) * HOOP_SPAN;
    const y = box.top + box.height * down;
    const halfWidth = staveHalfWidth(box, down, bulge, endInset);
    ctx.fillStyle = rgb(elementColor(accent, TONE_SHADOW, seed, hoop));
    ctx.fillRect(box.centreX - halfWidth, y, halfWidth * 2, hoopThickness);
    paintEdgeLight(
      ctx,
      { x: box.centreX - halfWidth, y },
      { x: box.centreX + halfWidth, y },
      elementColor(accent, TONE_HIGHLIGHT, seed, hoop),
      1,
      BLOCK_LIT_ALPHA,
    );
  }
}

/** Where a cask's side sits at a given fraction down its height. */
function staveHalfWidth(box: PropBox, down: number, bulge: number, endInset: number): number {
  const waist = Math.sin(down * Math.PI);
  return box.width / 2 - endInset + bulge * waist;
}

function traceStaveEdge(
  ctx: NodeCtx,
  box: PropBox,
  fraction: number,
  bulge: number,
  endInset: number,
  reverse: boolean,
): void {
  const STEPS = 8;
  for (let step = 0; step <= STEPS; step++) {
    const down = reverse ? 1 - step / STEPS : step / STEPS;
    const halfWidth = staveHalfWidth(box, down, bulge, endInset);
    const x = box.centreX - halfWidth + halfWidth * 2 * fraction;
    const y = box.top + box.height * down;
    if (step === 0 && !reverse) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** The head of a cask, seen slightly from above so the barrel has a top. */
function paintCaskLid(draw: PropDraw, box: PropBox, ramp: Ramp, tone: number): void {
  const { ctx, seed } = draw;
  const LID_INDEX = 90;
  const radiusX = box.width / 2 - box.width * BARREL_END_INSET_FRACTION;
  const radiusY = box.height * BARREL_LID_RISE_FRACTION;
  fillEllipse(
    ctx,
    box.centreX,
    box.top,
    radiusX,
    radiusY,
    elementColor(ramp, tone, seed, LID_INDEX),
  );
  paintEdgeLight(
    ctx,
    { x: box.centreX - radiusX, y: box.top },
    { x: box.centreX, y: box.top - radiusY },
    elementColor(ramp, TONE_HIGHLIGHT, seed, LID_INDEX),
    1,
    BLOCK_LIT_ALPHA,
  );
}

/** Curve across a round body: 0 at the lit flank, 1 at the shadowed one. */
function curveAcross(fraction: number): number {
  const SHADOW_BIAS = 0.85;
  return Math.pow(fraction, 1 / (1 + SHADOW_BIAS));
}

const CRATE_SLAT_COUNT = 4;
const CRATE_BRACE_WIDTH_FRACTION = 0.13;
const CRATE_TOP_RISE_FRACTION = 0.14;

function paintCrate(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const slatHeight = box.height / CRATE_SLAT_COUNT;

  for (let slat = 0; slat < CRATE_SLAT_COUNT; slat++) {
    const SLAT_GAP_FRACTION = 0.12;
    const gap = slatHeight * SLAT_GAP_FRACTION;
    const wander = wanderAt(draw, box.left, box.top + slat * slatHeight);
    paintLitBlock(
      ctx,
      {
        x: box.left,
        y: box.top + slat * slatHeight + gap / 2 + wander,
        width: box.width,
        height: slatHeight - gap,
      },
      body,
      TONE_BODY,
      seed,
      slat,
    );
  }

  const braceWidth = box.width * CRATE_BRACE_WIDTH_FRACTION;
  const BRACE_INDEX_LEFT = 40;
  const BRACE_INDEX_RIGHT = 41;
  paintLitBlock(
    ctx,
    { x: box.left, y: box.top, width: braceWidth, height: box.height },
    accent,
    TONE_BODY,
    seed,
    BRACE_INDEX_LEFT,
  );
  paintLitBlock(
    ctx,
    { x: box.right - braceWidth, y: box.top, width: braceWidth, height: box.height },
    accent,
    TONE_SHADOW,
    seed,
    BRACE_INDEX_RIGHT,
  );

  const DIAGONAL_INDEX = 42;
  strokeLine(
    ctx,
    box.left + braceWidth,
    box.baseY,
    box.right - braceWidth,
    box.top,
    elementColor(accent, TONE_SHADOW, seed, DIAGONAL_INDEX),
    braceWidth * 0.7,
  );

  const TOP_INDEX = 43;
  const topRise = box.height * CRATE_TOP_RISE_FRACTION;
  ctx.fillStyle = rgb(elementColor(body, TONE_HIGHLIGHT, seed, TOP_INDEX));
  ctx.beginPath();
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.left + topRise, box.top - topRise);
  ctx.lineTo(box.right + topRise, box.top - topRise);
  ctx.lineTo(box.right, box.top);
  ctx.closePath();
  ctx.fill();
}

const SACK_NECK_FRACTION = 0.22;
const SACK_SLUMP_FRACTION = 0.18;
const SACK_FOLD_COUNT = 3;

function paintSack(draw: PropDraw): void {
  paintBag(draw, draw.box, SACK_SLUMP_FRACTION);
}

const GRAIN_TIE_DOWN_FRACTION = 0.26;
const GRAIN_BELLY_BULGE_FRACTION = 0.16;
const GRAIN_CUFF_FOLD_COUNT = 4;
const GRAIN_SEAM_INSET_FRACTION = 0.22;

/**
 * A full sack stood on its base: a heavy bulging body pinched into a tied neck
 * with the cloth above the tie folded back on itself.
 *
 * Every one of those three things is load-bearing. The bulge is what says the
 * contents are loose and heavy, the pinch is what makes the top a neck rather
 * than a shoulder, and the flared cuff above the tie is what stops the whole
 * thing reading as a pear.
 */
function paintGrainSack(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const SACK_INDEX = 0;
  const tieY = box.top + box.height * GRAIN_TIE_DOWN_FRACTION;
  const neckHalfWidth = box.width * 0.17;
  const bellyHalfWidth = box.width / 2;
  const baseHalfWidth = box.width * 0.42;
  const bulge = box.width * GRAIN_BELLY_BULGE_FRACTION;

  const traceSack = (): void => {
    ctx.beginPath();
    ctx.moveTo(box.centreX - neckHalfWidth, tieY);
    ctx.bezierCurveTo(
      box.centreX - bellyHalfWidth - bulge,
      tieY + box.height * 0.3,
      box.centreX - bellyHalfWidth,
      box.baseY - box.height * 0.1,
      box.centreX - baseHalfWidth,
      box.baseY,
    );
    ctx.lineTo(box.centreX + baseHalfWidth, box.baseY);
    ctx.bezierCurveTo(
      box.centreX + bellyHalfWidth,
      box.baseY - box.height * 0.1,
      box.centreX + bellyHalfWidth + bulge,
      tieY + box.height * 0.3,
      box.centreX + neckHalfWidth,
      tieY,
    );
    ctx.closePath();
  };

  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, SACK_INDEX));
  traceSack();
  ctx.fill();

  ctx.save();
  traceSack();
  ctx.clip();
  const FLANK_ALPHA = 0.55;
  fillEllipse(
    ctx,
    box.centreX - bellyHalfWidth * 0.45,
    box.top + box.height * 0.6,
    bellyHalfWidth * 0.6,
    box.height * 0.34,
    elementColor(body, TONE_LIT, seed, SACK_INDEX + 1),
    FLANK_ALPHA,
  );
  fillEllipse(
    ctx,
    box.centreX + bellyHalfWidth * 0.75,
    box.top + box.height * 0.75,
    bellyHalfWidth * 0.6,
    box.height * 0.4,
    elementColor(body, TONE_SHADOW, seed, SACK_INDEX + 2),
    FLANK_ALPHA,
  );
  // The seam runs off the tie and down the near face; it is the one straight
  // thing on the bag and the reason the cloth reads as sewn.
  const seamX = box.centreX - box.width * GRAIN_SEAM_INSET_FRACTION;
  strokeLine(
    ctx,
    seamX,
    tieY,
    seamX - box.width * 0.06,
    box.baseY,
    elementColor(body, TONE_SHADOW, seed, SACK_INDEX + 3),
    Math.max(1, box.width * 0.035),
  );
  strokeLine(
    ctx,
    seamX + Math.max(1, box.width * 0.03),
    tieY,
    seamX - box.width * 0.06 + Math.max(1, box.width * 0.03),
    box.baseY,
    elementColor(body, TONE_HIGHLIGHT, seed, SACK_INDEX + 4),
    1,
    BLOCK_LIT_ALPHA,
  );
  // Creases gathering into the tie.
  for (let crease = 0; crease < SACK_FOLD_COUNT; crease++) {
    const spread = (crease / (SACK_FOLD_COUNT - 1) - 0.5) * 2;
    strokeLine(
      ctx,
      box.centreX + spread * neckHalfWidth,
      tieY,
      box.centreX + spread * bellyHalfWidth * 1.3,
      tieY + box.height * 0.34,
      elementColor(body, TONE_SHADOW, seed, SACK_INDEX + 5 + crease),
      1,
      BLOCK_SHADOW_ALPHA,
    );
  }
  ctx.restore();

  paintSackCuff(draw, tieY, neckHalfWidth);

  const TIE_INDEX = 60;
  strokeLine(
    ctx,
    box.centreX - neckHalfWidth * 1.2,
    tieY,
    box.centreX + neckHalfWidth * 1.2,
    tieY,
    elementColor(accent, TONE_SHADOW, seed, TIE_INDEX),
    Math.max(2, box.height * 0.05),
  );
  paintEdgeLight(
    ctx,
    { x: box.centreX - neckHalfWidth * 1.2, y: tieY - Math.max(1, box.height * 0.025) },
    { x: box.centreX + neckHalfWidth * 1.2, y: tieY - Math.max(1, box.height * 0.025) },
    elementColor(accent, TONE_LIT, seed, TIE_INDEX + 1),
    1,
    BLOCK_LIT_ALPHA,
  );
}

/** The cloth above the tie, folded back over itself in a ragged flare. */
function paintSackCuff(draw: PropDraw, tieY: number, neckHalfWidth: number): void {
  const { ctx, box, body, seed } = draw;
  const CUFF_INDEX = 70;
  const cuffTop = box.top;
  const flare = neckHalfWidth * 1.7;
  for (let fold = 0; fold < GRAIN_CUFF_FOLD_COUNT; fold++) {
    const spread = (fold / (GRAIN_CUFF_FOLD_COUNT - 1) - 0.5) * 2;
    const tipY = cuffTop + Math.abs(spread) * (tieY - cuffTop) * 0.45;
    ctx.fillStyle = rgb(
      elementColor(body, fold % 2 === 0 ? TONE_LIT : TONE_BODY, seed, CUFF_INDEX + fold),
    );
    ctx.beginPath();
    ctx.moveTo(box.centreX + spread * neckHalfWidth * 0.9, tieY);
    ctx.lineTo(box.centreX + spread * flare, tipY);
    ctx.lineTo(box.centreX + (spread + 1 / (GRAIN_CUFF_FOLD_COUNT - 1)) * flare, tipY);
    ctx.lineTo(
      box.centreX + (spread + 1 / (GRAIN_CUFF_FOLD_COUNT - 1)) * neckHalfWidth * 0.9,
      tieY,
    );
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * A tied bag: wide and heavy at the floor, pinched at the neck.
 *
 * The pinch is what reads. A rounded rectangle is a pillow; the waist above the
 * tie is the only thing that says the contents are loose and heavy.
 */
function paintBag(draw: PropDraw, box: PropBox, slump: number): void {
  const { ctx, body, accent, seed } = draw;
  const BAG_INDEX = 0;
  const neckY = box.top + box.height * SACK_NECK_FRACTION;
  const neckHalfWidth = box.width * SACK_NECK_FRACTION;
  const bellyHalfWidth = box.width / 2;
  const lean = box.width * slump;

  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, BAG_INDEX));
  ctx.beginPath();
  ctx.moveTo(box.centreX - neckHalfWidth, neckY);
  ctx.bezierCurveTo(
    box.centreX - bellyHalfWidth - lean,
    neckY + box.height * 0.4,
    box.centreX - bellyHalfWidth,
    box.baseY,
    box.centreX - bellyHalfWidth * 0.7,
    box.baseY,
  );
  ctx.lineTo(box.centreX + bellyHalfWidth * 0.7, box.baseY);
  ctx.bezierCurveTo(
    box.centreX + bellyHalfWidth,
    box.baseY,
    box.centreX + bellyHalfWidth + lean,
    neckY + box.height * 0.4,
    box.centreX + neckHalfWidth,
    neckY,
  );
  ctx.closePath();
  ctx.fill();

  const LIT_FLANK_ALPHA = 0.55;
  const SHADOW_FLANK_ALPHA = 0.5;
  ctx.save();
  ctx.clip();
  fillEllipse(
    ctx,
    box.centreX - bellyHalfWidth * 0.4,
    box.top + box.height * 0.6,
    bellyHalfWidth * 0.55,
    box.height * 0.35,
    elementColor(body, TONE_LIT, seed, BAG_INDEX),
    LIT_FLANK_ALPHA,
  );
  fillEllipse(
    ctx,
    box.centreX + bellyHalfWidth * 0.7,
    box.top + box.height * 0.7,
    bellyHalfWidth * 0.5,
    box.height * 0.4,
    elementColor(body, TONE_SHADOW, seed, BAG_INDEX),
    SHADOW_FLANK_ALPHA,
  );
  for (let fold = 0; fold < SACK_FOLD_COUNT; fold++) {
    const foldX =
      box.centreX - neckHalfWidth + ((fold + 0.5) / SACK_FOLD_COUNT) * neckHalfWidth * 2;
    strokeLine(
      ctx,
      foldX,
      neckY,
      foldX + (foldX - box.centreX) * 1.6,
      box.top + box.height * 0.7,
      elementColor(body, TONE_SHADOW, seed, fold + 1),
      1,
      SHADOW_FLANK_ALPHA,
    );
  }
  ctx.restore();

  const TIE_INDEX = 60;
  const TIE_THICKNESS_FRACTION = 0.07;
  strokeLine(
    ctx,
    box.centreX - neckHalfWidth,
    neckY,
    box.centreX + neckHalfWidth,
    neckY,
    elementColor(accent, TONE_BODY, seed, TIE_INDEX),
    box.height * TIE_THICKNESS_FRACTION,
  );

  const GATHER_COUNT = 4;
  for (let gather = 0; gather < GATHER_COUNT; gather++) {
    const spread = (gather / (GATHER_COUNT - 1) - 0.5) * 2;
    strokeLine(
      ctx,
      box.centreX + spread * neckHalfWidth * 0.6,
      neckY,
      box.centreX + spread * neckHalfWidth * 1.4,
      box.top,
      elementColor(body, TONE_LIT, seed, gather + 10),
      Math.max(1, box.width * 0.05),
    );
  }
}

/** Quarter of a turn: the sun is upper-left, and `angle` runs from +x. */
const LEAF_LIGHT_TURNS = 0.25;

const FIREWOOD_LOG_ROWS = 3;
/** Prime, and larger than any row can hold, so no two logs share an index. */
const FIREWOOD_ROW_STRIDE = 31;
const FIREWOOD_BARK_FRACTION = 0.22;
const FIREWOOD_RING_COUNT = 2;
/** Spread of log diameters within a course, either side of the nominal. */
const FIREWOOD_DIAMETER_JITTER = 0.34;
/** How far into its neighbour each log is pushed, so a course has no gaps. */
const FIREWOOD_PACK_OVERLAP = 0.14;

/**
 * A cord of split logs, stacked end-on in courses.
 *
 * The dark backing is what makes this a stack rather than the field of loose
 * discs it used to be: with the wall showing between the ends, nothing holds the
 * logs together, and every gap reads as space around a separate object. Real
 * ends also vary in diameter — a course of identical circles is a bead string.
 */
function paintFirewood(draw: PropDraw): void {
  const { ctx, box, accent, seed } = draw;
  const rowHeight = box.height / FIREWOOD_LOG_ROWS;
  const nominalRadius = rowHeight / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();

  // Inset off the top so the uppermost course's round ends still break the
  // stack's outline; a backing flush with them would square the whole pile off.
  const BACKING_TOP_INSET = 0.5;
  ctx.fillStyle = rgb(sampleRamp(getRamp('ground_shadow'), TONE_DEEP));
  ctx.fillRect(
    box.left,
    box.top + nominalRadius * BACKING_TOP_INSET,
    box.width,
    box.height - nominalRadius * BACKING_TOP_INSET,
  );

  for (let row = 0; row < FIREWOOD_LOG_ROWS; row++) {
    const centreY = box.baseY - rowHeight * row - nominalRadius;
    let cursor = box.left;
    let log = 0;
    while (cursor < box.right) {
      // Strided by a prime well clear of any plausible logs-per-row, not by the
      // row count: at a stride of three over five logs a row, four logs in five
      // shared an index with the log above and came out as its exact copy.
      const index = row * FIREWOOD_ROW_STRIDE + log;
      const jitter =
        (elementValue(seed, STREAM_VARIANT, index) - 0.5) * 2 * FIREWOOD_DIAMETER_JITTER;
      const radius = nominalRadius * (1 + jitter);
      const centreX = cursor + radius;
      paintLogEnd(draw, centreX, centreY, radius, index);
      cursor += radius * 2 * (1 - FIREWOOD_PACK_OVERLAP);
      log++;
    }
    // A dark line along the course's top so the row above sits *on* this one.
    strokeLine(
      ctx,
      box.left,
      centreY - nominalRadius,
      box.right,
      centreY - nominalRadius,
      elementColor(accent, TONE_DEEP, seed, row + 50),
      1,
      BLOCK_SHADOW_ALPHA,
    );
  }

  ctx.restore();
}

/** One log end: bark, a split face, growth rings and a drying check. */
function paintLogEnd(
  draw: PropDraw,
  centreX: number,
  centreY: number,
  radius: number,
  index: number,
): void {
  const { ctx, body, accent, seed } = draw;
  const coreRadius = radius * (1 - FIREWOOD_BARK_FRACTION);
  fillEllipse(ctx, centreX, centreY, radius, radius, elementColor(accent, TONE_DEEP, seed, index));
  fillEllipse(
    ctx,
    centreX,
    centreY,
    coreRadius,
    coreRadius,
    elementColor(body, TONE_LIT, seed, index),
  );

  for (let ring = 1; ring <= FIREWOOD_RING_COUNT; ring++) {
    const ringRadius = coreRadius * (ring / (FIREWOOD_RING_COUNT + 1));
    ctx.save();
    ctx.strokeStyle = rgba(elementColor(body, TONE_SHADOW, seed, index + ring), BLOCK_SHADOW_ALPHA);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(centreX, centreY, ringRadius, ringRadius, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  // Half these ends are split billets rather than rounds: a straight chord and a
  // paler face, which is what a splitting maul leaves.
  const isSplit = elementValue(seed, STREAM_WOBBLE, index) < 0.5;
  if (isSplit) {
    const chordAngle = elementValue(seed, STREAM_ELEMENT_HUE, index) * TWO_PI;
    ctx.save();
    ctx.translate(centreX, centreY);
    ctx.rotate(chordAngle);
    ctx.fillStyle = rgba(
      elementColor(body, TONE_HIGHLIGHT, seed, index + FIREWOOD_RING_COUNT),
      BLOCK_LIT_ALPHA,
    );
    ctx.beginPath();
    ctx.moveTo(-coreRadius, 0);
    ctx.lineTo(coreRadius, 0);
    ctx.lineTo(coreRadius * 0.3, coreRadius);
    ctx.lineTo(-coreRadius * 0.3, coreRadius);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const checkAngle = elementValue(seed, STREAM_WOBBLE, index + FIREWOOD_ROW_STRIDE) * TWO_PI;
  strokeLine(
    ctx,
    centreX,
    centreY,
    centreX + Math.cos(checkAngle) * coreRadius,
    centreY + Math.sin(checkAngle) * coreRadius,
    elementColor(body, TONE_DEEP, seed, index),
    1,
  );
}

const BALE_CORNER_FRACTION = 0.14;
const BALE_CORD_COUNT = 2;
const BALE_TUFT_COUNT = 16;
const BALE_TOP_RISE_FRACTION = 0.16;

/**
 * A bound fleece: a soft-cornered block, corded, with wool escaping every edge.
 *
 * The block needs both a top face and a broken outline or it is a white slab.
 * The top face gives it depth, and the tufts breaking the rim are the only thing
 * that says the material is wool rather than plaster.
 */
function paintWoolBale(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const BALE_INDEX = 0;
  const corner = Math.min(box.width, box.height) * BALE_CORNER_FRACTION;
  const topRise = box.height * BALE_TOP_RISE_FRACTION;

  // The top face is painted first so the front face's own lit edge overlaps it,
  // which is what puts the two planes at an angle to each other.
  ctx.fillStyle = rgb(elementColor(body, TONE_HIGHLIGHT, seed, BALE_INDEX + 5));
  ctx.beginPath();
  ctx.moveTo(box.left + corner, box.top);
  ctx.lineTo(box.left + corner + topRise, box.top - topRise);
  ctx.lineTo(box.right - corner + topRise, box.top - topRise);
  ctx.lineTo(box.right - corner, box.top);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, BALE_INDEX));
  tracePillowPath(ctx, box, corner);
  ctx.fill();

  ctx.save();
  tracePillowPath(ctx, box, corner);
  ctx.clip();
  const LIT_FACE_FRACTION = 0.3;
  const SHADOW_FACE_FRACTION = 0.28;
  ctx.fillStyle = rgb(elementColor(body, TONE_LIT, seed, BALE_INDEX + 1));
  ctx.fillRect(box.left, box.top, box.width, box.height * LIT_FACE_FRACTION);
  ctx.fillStyle = rgba(elementColor(body, TONE_SHADOW, seed, BALE_INDEX + 2), BLOCK_SHADOW_ALPHA);
  ctx.fillRect(
    box.right - box.width * SHADOW_FACE_FRACTION,
    box.top,
    box.width * SHADOW_FACE_FRACTION,
    box.height,
  );
  ctx.restore();

  for (let cord = 0; cord < BALE_CORD_COUNT; cord++) {
    const x = box.left + box.width * ((cord + 1) / (BALE_CORD_COUNT + 1));
    strokeLine(
      ctx,
      x + topRise,
      box.top - topRise,
      x,
      box.baseY,
      elementColor(accent, TONE_SHADOW, seed, cord + BALE_TUFT_COUNT),
      Math.max(2, box.width * 0.05),
    );
  }

  paintFleeceTufts(draw, corner, topRise);
}

/** The wool bursting past the cords and over every edge of the bale. */
function paintFleeceTufts(draw: PropDraw, corner: number, topRise: number): void {
  const { ctx, box, body, seed } = draw;
  const TUFT_RADIUS_FRACTION = 0.075;
  const radius = Math.min(box.width, box.height) * TUFT_RADIUS_FRACTION;
  for (let tuft = 0; tuft < BALE_TUFT_COUNT; tuft++) {
    const along = (tuft + 0.5) / BALE_TUFT_COUNT;
    const onTop = tuft % 3 !== 0;
    const side = tuft % 6 === 0 ? box.left : box.right;
    // Side tufts take their height from the noise rather than from `along`,
    // which walked them evenly down the edge as a row of beads.
    const down = elementValue(seed, STREAM_WOBBLE, tuft);
    const x = onTop
      ? box.left + corner + topRise + (box.width - corner * 2) * along
      : side + wanderAt(draw, side, box.top + box.height * down);
    const y = onTop
      ? box.top - topRise + wanderAt(draw, x, box.top)
      : box.top + box.height * (0.15 + down * 0.75);
    const size = radius * (0.7 + elementValue(seed, STREAM_VARIANT, tuft) * 0.6);
    fillEllipse(
      ctx,
      x,
      y,
      size,
      size * 0.8,
      elementColor(body, tuft % 2 === 0 ? TONE_HIGHLIGHT : TONE_LIT, seed, tuft),
    );
  }
}

function tracePillowPath(ctx: NodeCtx, box: PropBox, corner: number): void {
  ctx.beginPath();
  ctx.moveTo(box.left + corner, box.top);
  ctx.lineTo(box.right - corner, box.top);
  ctx.quadraticCurveTo(box.right, box.top, box.right, box.top + corner);
  ctx.lineTo(box.right, box.baseY - corner);
  ctx.quadraticCurveTo(box.right, box.baseY, box.right - corner, box.baseY);
  ctx.lineTo(box.left + corner, box.baseY);
  ctx.quadraticCurveTo(box.left, box.baseY, box.left, box.baseY - corner);
  ctx.lineTo(box.left, box.top + corner);
  ctx.quadraticCurveTo(box.left, box.top, box.left + corner, box.top);
  ctx.closePath();
}

const LEAN_ANGLE_RADIANS = 0.22;
const CROOK_HOOK_RADIUS_FRACTION = 0.16;
const CROOK_THICKNESS_FRACTION = 0.09;

/** A shepherd's staff propped against the wall, hook up. */
function paintCrook(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const CROOK_INDEX = 0;
  const thickness = Math.max(2, box.width * CROOK_THICKNESS_FRACTION);
  const headX = box.centreX + box.height * Math.sin(LEAN_ANGLE_RADIANS);
  const hookRadius = box.height * CROOK_HOOK_RADIUS_FRACTION;

  paintShaft(
    ctx,
    box.centreX,
    box.baseY,
    headX,
    box.top + hookRadius,
    thickness,
    body,
    seed,
    CROOK_INDEX,
  );

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(elementColor(body, TONE_BODY, seed, CROOK_INDEX + 1));
  ctx.lineWidth = thickness;
  ctx.beginPath();
  const HOOK_START_ANGLE = Math.PI * 0.5;
  const HOOK_END_ANGLE = Math.PI * 1.9;
  ctx.arc(headX - hookRadius, box.top + hookRadius, hookRadius, HOOK_START_ANGLE, HOOK_END_ANGLE);
  ctx.stroke();
  ctx.restore();
}

const WHEEL_LEAN_SQUASH = 0.82;
const WHEEL_SPOKE_COUNT = 8;
const WHEEL_RIM_FRACTION = 0.13;
const WHEEL_HUB_FRACTION = 0.2;

/** A wheel leaning on the wall, so its circle projects to a tilted ellipse. */
function paintCartWheel(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const WHEEL_INDEX = 0;
  const radius = Math.min(box.width, box.height) / 2;
  const centreX = box.centreX;
  const centreY = box.baseY - radius * WHEEL_LEAN_SQUASH;

  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.rotate(LEAN_ANGLE_RADIANS);
  ctx.scale(1, WHEEL_LEAN_SQUASH);

  ctx.strokeStyle = rgb(elementColor(accent, TONE_SHADOW, seed, WHEEL_INDEX));
  ctx.lineWidth = radius * WHEEL_RIM_FRACTION;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();

  const feltRadius = radius * (1 - WHEEL_RIM_FRACTION);
  ctx.strokeStyle = rgb(elementColor(body, TONE_BODY, seed, WHEEL_INDEX + 1));
  ctx.lineWidth = radius * WHEEL_RIM_FRACTION * 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, feltRadius, 0, TWO_PI);
  ctx.stroke();

  for (let spoke = 0; spoke < WHEEL_SPOKE_COUNT; spoke++) {
    const angle = (spoke / WHEEL_SPOKE_COUNT) * TWO_PI;
    // Spokes on the sunward side of the hub catch the light; the far ones do not.
    const litness = (1 - Math.cos(angle)) / 2;
    strokeLine(
      ctx,
      0,
      0,
      Math.cos(angle) * feltRadius,
      Math.sin(angle) * feltRadius,
      elementColor(body, TONE_SHADOW + (TONE_LIT - TONE_SHADOW) * litness, seed, spoke),
      Math.max(1, radius * 0.07),
    );
  }

  fillEllipse(
    ctx,
    0,
    0,
    radius * WHEEL_HUB_FRACTION,
    radius * WHEEL_HUB_FRACTION,
    elementColor(body, TONE_LIT, seed, WHEEL_INDEX + 2),
  );
  ctx.restore();
}

const SAWHORSE_BEAM_HEIGHT_FRACTION = 0.16;
const SAWHORSE_LEG_SPLAY_FRACTION = 0.3;
const SAWHORSE_LEG_THICKNESS_FRACTION = 0.08;

function paintSawhorse(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const beamHeight = box.height * SAWHORSE_BEAM_HEIGHT_FRACTION;
  const legThickness = Math.max(2, box.width * SAWHORSE_LEG_THICKNESS_FRACTION);
  const splay = box.width * SAWHORSE_LEG_SPLAY_FRACTION;
  const beamBottom = box.top + beamHeight;

  // The far pair is drawn first and darker, which is the only depth cue a
  // trestle has at this size.
  const FAR_PAIR_OFFSET_FRACTION = 0.12;
  const farOffset = box.width * FAR_PAIR_OFFSET_FRACTION;
  paintSawhorseLegs(draw, beamBottom, splay, legThickness, farOffset, TONE_SHADOW, 0);
  paintSawhorseLegs(draw, beamBottom, splay, legThickness, 0, TONE_BODY, 2);

  const BEAM_INDEX = 20;
  paintLitBlock(
    ctx,
    { x: box.left, y: box.top, width: box.width, height: beamHeight },
    body,
    TONE_LIT,
    seed,
    BEAM_INDEX,
  );
}

function paintSawhorseLegs(
  draw: PropDraw,
  beamBottom: number,
  splay: number,
  thickness: number,
  offset: number,
  tone: number,
  indexBase: number,
): void {
  const { ctx, box, body, seed } = draw;
  const LEG_INSET_FRACTION = 0.18;
  const inset = box.width * LEG_INSET_FRACTION;
  const color = elementColor(body, tone, seed, indexBase);
  strokeLine(
    ctx,
    box.left + inset + offset,
    beamBottom,
    box.left + inset + offset - splay,
    box.baseY,
    color,
    thickness,
  );
  strokeLine(
    ctx,
    box.right - inset + offset,
    beamBottom,
    box.right - inset + offset + splay,
    box.baseY,
    color,
    thickness,
  );
  const BRACE_HEIGHT_FRACTION = 0.6;
  const braceY = beamBottom + (box.baseY - beamBottom) * BRACE_HEIGHT_FRACTION;
  strokeLine(
    ctx,
    box.left + inset + offset - splay * BRACE_HEIGHT_FRACTION,
    braceY,
    box.right - inset + offset + splay * BRACE_HEIGHT_FRACTION,
    braceY,
    elementColor(body, tone, seed, indexBase + 1),
    thickness * 0.6,
  );
}

const PLANK_MIN_COUNT = 4;
const PLANK_THICKNESS_PX = 6;
const PLANK_END_SLIP_FRACTION = 0.08;

/**
 * Sawn boards stacked flat, seen from the end.
 *
 * The end grain is lighter than the face, and no two boards in a real stack are
 * flush — the slip is what makes it a stack rather than a striped block.
 */
function paintPlankStack(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const count = Math.max(PLANK_MIN_COUNT, Math.round(box.height / PLANK_THICKNESS_PX));
  const thickness = box.height / count;

  for (let plank = 0; plank < count; plank++) {
    const slip =
      (elementValue(seed, STREAM_WOBBLE, plank) - 0.5) * 2 * box.width * PLANK_END_SLIP_FRACTION;
    const y = box.baseY - (plank + 1) * thickness;
    const PLANK_GAP_PX = 1;
    paintLitBlock(
      ctx,
      { x: box.left + slip, y, width: box.width, height: thickness - PLANK_GAP_PX },
      body,
      plank % 2 === 0 ? TONE_BODY : TONE_LIT,
      seed,
      plank,
    );
    const END_GRAIN_FRACTION = 0.18;
    ctx.fillStyle = rgba(
      elementColor(body, TONE_HIGHLIGHT, seed, plank),
      BLOCK_LIT_ALPHA * END_GRAIN_FRACTION * 2,
    );
    ctx.fillRect(box.left + slip, y, box.width * END_GRAIN_FRACTION, thickness - PLANK_GAP_PX);
  }
}

const HAY_STRAND_COUNT = 22;
/** Half-width of the elliptical end face, as a fraction of the bale's length. */
const HAY_END_FACE_FRACTION = 0.19;
const HAY_CORD_COUNT = 2;
const HAY_COIL_COUNT = 3;
const HAY_WHISKER_COUNT = 12;

/**
 * A bale lying on its side: a banded cylinder with one coiled end face showing.
 *
 * Drawn as a circle it was a coin, and a circle is what a bale seen end-on
 * genuinely is — so it is not seen end-on. The silhouette that says "bale" is a
 * long body with two rounded ends, and the coiled face at the near end is what
 * says the long body is rolled straw rather than a barrel.
 */
function paintHayBale(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const BALE_INDEX = 0;
  const halfHeight = box.height / 2;
  const axisY = box.baseY - halfHeight;
  const endRadiusX = Math.min(box.width * HAY_END_FACE_FRACTION, halfHeight);
  const faceX = box.left + endRadiusX;
  const backX = box.right - endRadiusX;

  const traceBody = (): void => {
    ctx.beginPath();
    ctx.moveTo(faceX, box.top);
    ctx.lineTo(backX, box.top);
    ctx.ellipse(backX, axisY, endRadiusX, halfHeight, 0, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(faceX, box.baseY);
    ctx.ellipse(faceX, axisY, endRadiusX, halfHeight, 0, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  };

  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, BALE_INDEX));
  traceBody();
  ctx.fill();

  ctx.save();
  traceBody();
  ctx.clip();
  paintHayStrands(draw, box.top, box.height);
  const LIT_BAND_FRACTION = 0.3;
  const SHADOW_BAND_FRACTION = 0.26;
  ctx.fillStyle = rgba(elementColor(body, TONE_LIT, seed, BALE_INDEX + 1), BLOCK_LIT_ALPHA);
  ctx.fillRect(box.left, box.top, box.width, box.height * LIT_BAND_FRACTION);
  ctx.fillStyle = rgba(elementColor(body, TONE_SHADOW, seed, BALE_INDEX + 2), BLOCK_SHADOW_ALPHA);
  ctx.fillRect(
    box.left,
    box.baseY - box.height * SHADOW_BAND_FRACTION,
    box.width,
    box.height * SHADOW_BAND_FRACTION,
  );
  ctx.restore();

  // The near end face, and the coils wound into it.
  fillEllipse(
    ctx,
    faceX,
    axisY,
    endRadiusX,
    halfHeight,
    elementColor(body, TONE_LIT, seed, BALE_INDEX + 3),
  );
  for (let coil = 1; coil <= HAY_COIL_COUNT; coil++) {
    const inward = coil / (HAY_COIL_COUNT + 1);
    ctx.save();
    ctx.strokeStyle = rgba(
      elementColor(body, coil % 2 === 0 ? TONE_HIGHLIGHT : TONE_SHADOW, seed, BALE_INDEX + coil),
      BLOCK_SHADOW_ALPHA,
    );
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      faceX + endRadiusX * inward * 0.4,
      axisY,
      endRadiusX * (1 - inward),
      halfHeight * (1 - inward),
      0,
      0,
      TWO_PI,
    );
    ctx.stroke();
    ctx.restore();
  }

  // Twine wrapping the barrel. Each band is an ellipse, because a straight line
  // across a cylinder is a line painted on it rather than a cord round it — and
  // it is clipped to the body, since a hoop standing proud of the silhouette is
  // a barrel band and this is not a barrel.
  ctx.save();
  traceBody();
  ctx.clip();
  for (let cord = 0; cord < HAY_CORD_COUNT; cord++) {
    const along = (cord + 1) / (HAY_CORD_COUNT + 1);
    const x = faceX + (backX - faceX) * along;
    ctx.strokeStyle = rgba(elementColor(accent, TONE_BODY, seed, cord + 30), BLOCK_SHADOW_ALPHA);
    ctx.lineWidth = Math.max(1, box.height * 0.035);
    ctx.beginPath();
    ctx.ellipse(x, axisY, endRadiusX * 0.75, halfHeight * 0.98, 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();

  paintStrawWhiskers(draw, box.top, box.baseY);
}

/** Loose straw breaking the bale's outline along its top and bottom edges. */
function paintStrawWhiskers(draw: PropDraw, topY: number, bottomY: number): void {
  const { ctx, box, body, seed } = draw;
  const WHISKER_LENGTH_FRACTION = 0.13;
  const length = box.height * WHISKER_LENGTH_FRACTION;
  for (let whisker = 0; whisker < HAY_WHISKER_COUNT; whisker++) {
    const along = (whisker + 0.5) / HAY_WHISKER_COUNT;
    const onTop = whisker % 2 === 0;
    const x = box.left + box.width * along;
    const y = onTop ? topY : bottomY;
    const angle =
      (onTop ? -Math.PI / 2 : Math.PI / 2) +
      (elementValue(seed, STREAM_WOBBLE, whisker) - 0.5) * Math.PI * 0.8;
    strokeLine(
      ctx,
      x,
      y,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      elementColor(body, onTop ? TONE_HIGHLIGHT : TONE_SHADOW, seed, whisker + 40),
      1,
    );
  }
}

function paintHayStrands(draw: PropDraw, top: number, height: number): void {
  const { ctx, box, body, seed } = draw;
  for (let strand = 0; strand < HAY_STRAND_COUNT; strand++) {
    const along = elementValue(seed, STREAM_WOBBLE, strand);
    const down = elementValue(seed, STREAM_VARIANT, strand);
    const x = box.left + box.width * along;
    const y = top + height * down;
    const STRAND_LENGTH_FRACTION = 0.18;
    const length = box.width * STRAND_LENGTH_FRACTION;
    const angle = (elementValue(seed, STREAM_ELEMENT_HUE, strand) - 0.5) * Math.PI;
    strokeLine(
      ctx,
      x,
      y,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      elementColor(body, strand % 2 === 0 ? TONE_HIGHLIGHT : TONE_SHADOW, seed, strand),
      1,
      BLOCK_SHADOW_ALPHA,
    );
  }
}

const PITCHFORK_TINE_COUNT = 3;
const PITCHFORK_HEAD_FRACTION = 0.28;
const PITCHFORK_HAFT_THICKNESS_FRACTION = 0.08;

function paintPitchfork(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const FORK_INDEX = 0;
  const headHeight = box.height * PITCHFORK_HEAD_FRACTION;
  const headY = box.top + headHeight;
  const topX = box.centreX + box.height * Math.sin(LEAN_ANGLE_RADIANS);
  const haftThickness = Math.max(2, box.width * PITCHFORK_HAFT_THICKNESS_FRACTION);

  paintShaft(ctx, box.centreX, box.baseY, topX, headY, haftThickness, body, seed, FORK_INDEX);

  const tineSpread = box.width * 0.4;
  for (let tine = 0; tine < PITCHFORK_TINE_COUNT; tine++) {
    const spread = (tine / (PITCHFORK_TINE_COUNT - 1) - 0.5) * 2;
    strokeLine(
      ctx,
      topX,
      headY,
      topX + spread * tineSpread,
      box.top,
      elementColor(accent, TONE_LIT, seed, tine),
      Math.max(1, haftThickness * 0.6),
    );
  }
}

// ── hung and fixed to the wall ─────────────────────────────────────────────

const HERB_STEM_COUNT = 7;
const HERB_LEAF_PER_STEM = 4;
const HERB_TIE_FRACTION = 0.16;
const HERB_MASS_HALF_WIDTH_FRACTION = 0.46;

/**
 * Drying herbs hung head-down from a nail: tied at the top, foliage below.
 *
 * A fan of separate stems is a handful of hairlines that vanish in the
 * downsample. The bundle is painted as a solid mass first — a teardrop hanging
 * point-down from the tie — and the stems and leaves are texture inside it, so
 * there is a silhouette left when the detail goes.
 */
function paintHerbBundle(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const MASS_INDEX = 0;
  const tieY = box.top + box.height * HERB_TIE_FRACTION;
  const massHalfWidth = box.width * HERB_MASS_HALF_WIDTH_FRACTION;
  const traceMass = (target: NodeCtx): void => {
    target.beginPath();
    target.moveTo(box.centreX, tieY);
    target.bezierCurveTo(
      box.centreX - massHalfWidth * 1.5,
      tieY + box.height * 0.34,
      box.centreX - massHalfWidth * 0.8,
      box.baseY,
      box.centreX,
      box.baseY,
    );
    target.bezierCurveTo(
      box.centreX + massHalfWidth * 0.8,
      box.baseY,
      box.centreX + massHalfWidth * 1.5,
      tieY + box.height * 0.34,
      box.centreX,
      tieY,
    );
    target.closePath();
  };

  paintCastShadow(draw, (shadowCtx) => {
    traceMass(shadowCtx);
    shadowCtx.fill();
  });

  ctx.fillStyle = rgb(elementColor(body, TONE_SHADOW, seed, MASS_INDEX));
  traceMass(ctx);
  ctx.fill();

  ctx.save();
  traceMass(ctx);
  ctx.clip();
  for (let stem = 0; stem < HERB_STEM_COUNT; stem++) {
    const spread = (stem / (HERB_STEM_COUNT - 1) - 0.5) * 2;
    const tipX = box.centreX + spread * massHalfWidth;
    const tipY = box.baseY - Math.abs(spread) * box.height * 0.14;
    strokeLine(
      ctx,
      box.centreX,
      tieY,
      tipX,
      tipY,
      elementColor(body, TONE_BODY, seed, stem),
      Math.max(1, box.width * 0.05),
    );
    for (let leaf = 0; leaf < HERB_LEAF_PER_STEM; leaf++) {
      const along = (leaf + 1) / (HERB_LEAF_PER_STEM + 1);
      const leafX = box.centreX + (tipX - box.centreX) * along;
      const leafY = tieY + (tipY - tieY) * along;
      fillEllipse(
        ctx,
        leafX,
        leafY,
        box.width * 0.11,
        box.height * 0.07,
        elementColor(body, leaf % 2 === 0 ? TONE_HIGHLIGHT : TONE_LIT, seed, stem * 10 + leaf),
      );
    }
  }
  ctx.restore();

  const TIE_INDEX = 80;
  strokeLine(
    ctx,
    box.centreX - box.width * 0.16,
    tieY,
    box.centreX + box.width * 0.16,
    tieY,
    elementColor(accent, TONE_SHADOW, seed, TIE_INDEX),
    Math.max(2, box.height * 0.06),
  );
  strokeLine(
    ctx,
    box.centreX,
    box.top,
    box.centreX,
    tieY,
    elementColor(accent, TONE_SHADOW, seed, TIE_INDEX + 1),
    Math.max(1, box.width * 0.04),
  );
  const NAIL_RADIUS_FRACTION = 0.06;
  const nailRadius = Math.max(1, box.width * NAIL_RADIUS_FRACTION);
  fillEllipse(
    ctx,
    box.centreX,
    box.top,
    nailRadius,
    nailRadius,
    elementColor(accent, TONE_HIGHLIGHT, seed, TIE_INDEX + 2),
  );
}

const VINE_SEGMENT_COUNT = 12;
const VINE_CLUSTER_LEAVES = 5;
const VINE_SWAY_FRACTION = 0.3;

/** A creeper climbing a corner, wandering as it rises. */
function paintVine(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  let previousX = box.centreX;
  let previousY = box.baseY;

  for (let segment = 1; segment <= VINE_SEGMENT_COUNT; segment++) {
    const up = segment / VINE_SEGMENT_COUNT;
    const sway =
      Math.sin(up * Math.PI * 2 + variant(draw, 0) * TWO_PI) * box.width * VINE_SWAY_FRACTION;
    const x = box.centreX + sway + wanderAt(draw, box.centreX, box.baseY - box.height * up);
    const y = box.baseY - box.height * up;
    strokeLine(
      ctx,
      previousX,
      previousY,
      x,
      y,
      elementColor(body, TONE_SHADOW, seed, segment),
      Math.max(1, box.width * 0.05 * (1 - up * 0.5)),
    );
    paintLeafCluster(draw, x, y, segment);
    previousX = x;
    previousY = y;
  }

  const TENDRIL_INDEX = 50;
  strokeLine(
    ctx,
    previousX,
    previousY,
    previousX + box.width * 0.25,
    previousY - box.height * 0.05,
    elementColor(accent, TONE_LIT, seed, TENDRIL_INDEX),
    1,
  );
}

function paintLeafCluster(draw: PropDraw, x: number, y: number, index: number): void {
  const { ctx, box, accent, seed } = draw;
  const leafRadius = box.width * 0.11;
  for (let leaf = 0; leaf < VINE_CLUSTER_LEAVES; leaf++) {
    const angle = (leaf / VINE_CLUSTER_LEAVES) * TWO_PI + elementValue(seed, STREAM_WOBBLE, index);
    // A leaf facing up-left catches the sun; one facing down-right does not.
    // Peaks toward the upper left, where the town's sun is. At three quarters of
    // pi it peaked upper *right*, so every vine in town was lit from the wrong
    // side — invisible on a leaf, obvious across a wall of them.
    const litness = (1 - Math.cos(angle - Math.PI * LEAF_LIGHT_TURNS)) / 2;
    fillEllipse(
      ctx,
      x + Math.cos(angle) * leafRadius,
      y + Math.sin(angle) * leafRadius,
      leafRadius,
      leafRadius * 0.75,
      elementColor(
        accent,
        TONE_SHADOW + (TONE_HIGHLIGHT - TONE_SHADOW) * litness,
        seed,
        index * 7 + leaf,
      ),
    );
  }
}

/**
 * Three charms, not five.
 *
 * The prop is under a tile wide. Five trinkets across it are five three-pixel
 * smudges after the downsample; three at nearly twice the size are three
 * objects, and a charm nobody can name is not worth the pixels.
 */
const CHARM_COUNT = 3;
const CHARM_CORD_SAG_FRACTION = 0.16;
const CHARM_SIZE_FRACTION = 0.19;

/** A skull, a bone and a bundle strung on a sagging cord across the wall. */
function paintCharmString(draw: PropDraw): void {
  const { ctx, box, accent, seed } = draw;
  const cordSag = box.height * CHARM_CORD_SAG_FRACTION;
  const cordAt = (along: number): number => box.top + Math.sin(along * Math.PI) * cordSag * 2;
  const traceCord = (target: NodeCtx): void => {
    target.save();
    target.lineWidth = Math.max(1, box.height * 0.04);
    target.beginPath();
    target.moveTo(box.left, box.top);
    target.quadraticCurveTo(box.centreX, box.top + cordSag * 4, box.right, box.top);
    target.stroke();
    target.restore();
  };

  paintCastShadow(draw, (shadowCtx) => {
    traceCord(shadowCtx);
    for (let charm = 0; charm < CHARM_COUNT; charm++) {
      const along = (charm + 0.5) / CHARM_COUNT;
      const x = box.left + box.width * along;
      const drop = box.height * (0.28 + variant(draw, charm) * 0.3);
      shadowCtx.beginPath();
      shadowCtx.ellipse(
        x,
        cordAt(along) + drop + box.width * CHARM_SIZE_FRACTION,
        box.width * CHARM_SIZE_FRACTION,
        box.width * CHARM_SIZE_FRACTION * 1.2,
        0,
        0,
        TWO_PI,
      );
      shadowCtx.fill();
    }
  });

  ctx.strokeStyle = rgb(elementColor(accent, TONE_SHADOW, seed, 0));
  traceCord(ctx);

  for (let charm = 0; charm < CHARM_COUNT; charm++) {
    const along = (charm + 0.5) / CHARM_COUNT;
    const x = box.left + box.width * along;
    const y = cordAt(along);
    const dropLength = box.height * (0.28 + variant(draw, charm) * 0.3);
    strokeLine(
      ctx,
      x,
      y,
      x,
      y + dropLength,
      elementColor(accent, TONE_SHADOW, seed, charm),
      Math.max(1, box.width * 0.03),
    );
    paintCharm(draw, x, y + dropLength, charm);
  }
}

/**
 * One hanging trinket, its shape fixed by its place on the cord.
 *
 * Fixed rather than seeded so a string always carries one of each: a seed that
 * happens to draw three bundles gives the shop three identical blobs, and the
 * variety is the only reason this reads as charms rather than as fringe.
 */
function paintCharm(draw: PropDraw, x: number, y: number, index: number): void {
  const { ctx, box, body, accent, seed } = draw;
  const size = box.width * CHARM_SIZE_FRACTION;
  const color = elementColor(body, TONE_HIGHLIGHT, seed, index);
  const shade = elementColor(body, TONE_SHADOW, seed, index + CHARM_COUNT);

  if (index % CHARM_COUNT === 0) {
    // A skull: a cranium, two sunken sockets and a shorter jaw below.
    fillEllipse(ctx, x, y + size, size, size * 0.9, color);
    fillEllipse(ctx, x, y + size * 1.7, size * 0.62, size * 0.5, color);
    fillEllipse(ctx, x - size * 0.4, y + size * 0.9, size * 0.3, size * 0.3, shade);
    fillEllipse(ctx, x + size * 0.4, y + size * 0.9, size * 0.3, size * 0.3, shade);
    return;
  }
  if (index % CHARM_COUNT === 1) {
    // A bone: two knuckles on a shaft.
    const BONE_LENGTH = 2.2;
    strokeLine(ctx, x, y + size * 0.4, x, y + size * BONE_LENGTH, color, Math.max(2, size * 0.5));
    for (const knuckleY of [y + size * 0.4, y + size * BONE_LENGTH]) {
      fillEllipse(ctx, x - size * 0.34, knuckleY, size * 0.42, size * 0.38, color);
      fillEllipse(ctx, x + size * 0.34, knuckleY, size * 0.42, size * 0.38, color);
    }
    return;
  }
  // A bound bundle: a fat teardrop under a dark whipping of cord.
  ctx.fillStyle = rgb(elementColor(accent, TONE_BODY, seed, index));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(
    x - size * 1.1,
    y + size * 1.1,
    x - size * 0.7,
    y + size * 2.4,
    x,
    y + size * 2.5,
  );
  ctx.bezierCurveTo(x + size * 0.7, y + size * 2.4, x + size * 1.1, y + size * 1.1, x, y);
  ctx.closePath();
  ctx.fill();
  strokeLine(
    ctx,
    x - size * 0.6,
    y + size * 0.85,
    x + size * 0.6,
    y + size * 0.85,
    elementColor(accent, TONE_DEEP, seed, index + 1),
    Math.max(1, size * 0.35),
  );
}

const TOOL_RACK_BOARD_FRACTION = 0.11;
const TOOL_COUNT = 3;
const TOOL_HANG_LENGTH_FRACTION = 0.74;

/**
 * A smith's tools hung on a board: a hammer, a pair of tongs and a pair of
 * pincers, each a distinct silhouette against the wall.
 *
 * Four evenly spaced identical hafts under a rail is a mullioned window, which
 * is what this was. Three tools of visibly different shape, each throwing its
 * own shadow onto the wall behind, is a rack.
 */
function paintToolRack(draw: PropDraw): void {
  const { ctx, box, accent, seed } = draw;
  const boardHeight = Math.max(2, box.height * TOOL_RACK_BOARD_FRACTION);
  const boardRect: Rect = { x: box.left, y: box.top, width: box.width, height: boardHeight };

  paintCastShadow(draw, (shadowCtx) => {
    shadowCtx.fillRect(boardRect.x, boardRect.y, boardRect.width, boardRect.height);
    for (let tool = 0; tool < TOOL_COUNT; tool++) {
      const x = box.left + box.width * ((tool + 0.5) / TOOL_COUNT);
      const width = box.width / TOOL_COUNT;
      shadowCtx.fillRect(x - width * 0.3, box.top, width * 0.6, box.height);
    }
  });

  paintLitBlock(ctx, boardRect, accent, TONE_BODY, seed, 0);

  const hangTop = box.top + boardHeight;
  const length = box.height * TOOL_HANG_LENGTH_FRACTION;
  const slot = box.width / TOOL_COUNT;
  for (let tool = 0; tool < TOOL_COUNT; tool++) {
    const x = box.left + slot * (tool + 0.5);
    if (tool === 0) paintHangingHammer(draw, x, hangTop, length, slot, tool);
    else if (tool === 1) paintHangingTongs(draw, x, hangTop, length, slot, tool);
    else paintHangingPincers(draw, x, hangTop, length, slot, tool);
  }
}

/** A hammer hung head-up: a heavy squared head over a tapering wooden haft. */
function paintHangingHammer(
  draw: PropDraw,
  x: number,
  top: number,
  length: number,
  slot: number,
  index: number,
): void {
  const { ctx, body, accent, seed } = draw;
  const HEAD_WIDTH_FRACTION = 0.72;
  const HEAD_HEIGHT_FRACTION = 0.24;
  const PEIN_FRACTION = 0.3;
  const HAFT_WIDTH_FRACTION = 0.19;
  const headWidth = slot * HEAD_WIDTH_FRACTION;
  const headHeight = length * HEAD_HEIGHT_FRACTION;
  const haftWidth = Math.max(2, slot * HAFT_WIDTH_FRACTION);

  paintLitBlock(
    ctx,
    { x: x - haftWidth / 2, y: top + headHeight, width: haftWidth, height: length - headHeight },
    accent,
    TONE_BODY,
    seed,
    index,
  );
  paintLitBlock(
    ctx,
    { x: x - headWidth * 0.36, y: top, width: headWidth * 0.72, height: headHeight },
    body,
    TONE_LIT,
    seed,
    index + 10,
  );
  // The cross pein is the half of the head that is not a block, and the only
  // reason the silhouette is a hammer and not a mallet.
  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, index + 20));
  ctx.beginPath();
  ctx.moveTo(x + headWidth * 0.36, top + headHeight * 0.1);
  ctx.lineTo(x + headWidth * 0.5, top + headHeight * PEIN_FRACTION);
  ctx.lineTo(x + headWidth * 0.5, top + headHeight * (1 - PEIN_FRACTION));
  ctx.lineTo(x + headWidth * 0.36, top + headHeight * 0.9);
  ctx.closePath();
  ctx.fill();
}

/** Tongs: two long straight legs off a pivot, splayed to jaws at the bottom. */
function paintHangingTongs(
  draw: PropDraw,
  x: number,
  top: number,
  length: number,
  slot: number,
  index: number,
): void {
  const { ctx, body, seed } = draw;
  const PIVOT_DOWN_FRACTION = 0.24;
  const JAW_SPREAD_FRACTION = 0.3;
  const REIN_SPREAD_FRACTION = 0.12;
  const pivotY = top + length * PIVOT_DOWN_FRACTION;
  const legThickness = Math.max(2, slot * 0.11);
  const spread = slot * JAW_SPREAD_FRACTION;
  const reinSpread = slot * REIN_SPREAD_FRACTION;

  for (const side of [-1, 1]) {
    strokeLine(
      ctx,
      x + side * reinSpread,
      top,
      x,
      pivotY,
      elementColor(body, side < 0 ? TONE_LIT : TONE_BODY, seed, index + (side < 0 ? 0 : 1)),
      legThickness,
    );
    strokeLine(
      ctx,
      x,
      pivotY,
      x + side * spread,
      top + length,
      elementColor(body, side < 0 ? TONE_LIT : TONE_SHADOW, seed, index + (side < 0 ? 2 : 3)),
      legThickness,
    );
  }
  const RIVET_RADIUS_FRACTION = 0.09;
  const rivet = Math.max(1, slot * RIVET_RADIUS_FRACTION);
  fillEllipse(ctx, x, pivotY, rivet, rivet, elementColor(body, TONE_HIGHLIGHT, seed, index + 4));
}

/**
 * Pincers: a broad crescent of jaws over two short handles splayed in a wide V.
 *
 * Everything about it is the opposite of the tongs beside it — wide where they
 * are narrow, short where they are long, curved where they are straight. Two
 * pairs of long straight legs on one rack are one tool drawn twice.
 */
function paintHangingPincers(
  draw: PropDraw,
  x: number,
  top: number,
  length: number,
  slot: number,
  index: number,
): void {
  const { ctx, body, seed } = draw;
  const JAW_HALF_WIDTH_FRACTION = 0.46;
  const JAW_DEPTH_FRACTION = 0.3;
  const HANDLE_SPREAD_FRACTION = 0.44;
  const HANDLE_LENGTH_FRACTION = 0.62;
  const jawHalfWidth = Math.max(2, slot * JAW_HALF_WIDTH_FRACTION);
  const jawDepth = Math.max(2, jawHalfWidth * JAW_DEPTH_FRACTION * 2);
  const pivotY = top + jawDepth * 1.4;
  const handleThickness = Math.max(2, slot * 0.11);

  ctx.fillStyle = rgb(elementColor(body, TONE_LIT, seed, index));
  ctx.beginPath();
  ctx.moveTo(x - jawHalfWidth, top + jawDepth);
  ctx.quadraticCurveTo(x, top - jawDepth * 0.5, x + jawHalfWidth, top + jawDepth);
  ctx.quadraticCurveTo(x, top + jawDepth * 0.5, x - jawHalfWidth, top + jawDepth);
  ctx.closePath();
  ctx.fill();

  for (const side of [-1, 1]) {
    strokeLine(
      ctx,
      x + side * jawHalfWidth * 0.85,
      top + jawDepth * 0.6,
      x,
      pivotY,
      elementColor(body, side < 0 ? TONE_LIT : TONE_BODY, seed, index + (side < 0 ? 5 : 6)),
      handleThickness,
    );
    strokeLine(
      ctx,
      x,
      pivotY,
      x + side * slot * HANDLE_SPREAD_FRACTION,
      top + length * HANDLE_LENGTH_FRACTION,
      elementColor(body, side < 0 ? TONE_LIT : TONE_SHADOW, seed, index + (side < 0 ? 7 : 8)),
      handleThickness,
    );
  }

  const RIVET_RADIUS_FRACTION = 0.1;
  const rivet = Math.max(1, slot * RIVET_RADIUS_FRACTION);
  fillEllipse(ctx, x, pivotY, rivet, rivet, elementColor(body, TONE_HIGHLIGHT, seed, index + 9));
}

const BEAD_STRING_COUNT = 9;
const BEADS_PER_STRING = 9;

/** A bead curtain hung in an open doorway. */
function paintBeadCurtain(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const RAIL_HEIGHT_PX = 2;
  ctx.fillStyle = rgb(elementColor(body, TONE_SHADOW, seed, 0));
  ctx.fillRect(box.left, box.top, box.width, RAIL_HEIGHT_PX);

  const beadRadius = box.width / (BEAD_STRING_COUNT * 2.6);
  for (let string = 0; string < BEAD_STRING_COUNT; string++) {
    const baseX = box.left + box.width * ((string + 0.5) / BEAD_STRING_COUNT);
    // Each string hangs at its own length and its own slight swing, so the
    // curtain has a bottom edge rather than a ruled line.
    const swing = (elementValue(seed, STREAM_WOBBLE, string) - 0.5) * 2 * beadRadius;
    const drop = box.height * (0.82 + elementValue(seed, STREAM_VARIANT, string) * 0.18);
    for (let bead = 0; bead < BEADS_PER_STRING; bead++) {
      const along = (bead + 0.5) / BEADS_PER_STRING;
      const x = baseX + swing * along;
      const y = box.top + drop * along;
      const ramp = bead % 3 === 0 ? accent : body;
      fillEllipse(
        ctx,
        x,
        y,
        beadRadius,
        beadRadius,
        elementColor(ramp, TONE_BODY, seed, string * 20 + bead),
      );
      fillEllipse(
        ctx,
        x - beadRadius * 0.3,
        y - beadRadius * 0.3,
        beadRadius * 0.35,
        beadRadius * 0.35,
        elementColor(ramp, TONE_HIGHLIGHT, seed, string * 20 + bead),
      );
    }
  }
}

const BOARD_COUNT = 3;
const BOARD_HEIGHT_FRACTION = 0.17;
/**
 * The angle each plank was nailed on at.
 *
 * Fixed rather than seeded, and none of them level: three planks within a couple
 * of degrees of horizontal are a set of stripes, and a stripe pattern is what
 * the eye settles on before it ever looks for a window.
 */
const BOARD_TILT_RADIANS: ReadonlyArray<number> = [-0.16, 0.11, -0.06];
/** How far past the opening a plank reaches to find wall to nail into. */
const BOARD_OVERHANG_FRACTION = 0.22;
const BOARD_NAIL_INSET_FRACTION = 0.07;
const BOARD_NAIL_RADIUS_FRACTION = 0.17;
const BOARD_SHADOW_OFFSET_FRACTION = 0.22;

/** A window nobody has opened in years: a dark hole crossed by nailed planks. */
function paintBoardedWindow(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const opening: Rect = { x: box.left, y: box.top, width: box.width, height: box.height };
  ctx.fillStyle = rgb(sampleRamp(getRamp('ink_outline'), TONE_DEEP));
  ctx.fillRect(opening.x, opening.y, opening.width, opening.height);
  paintRecessAo(ctx, opening, WALL_SHADOW_ALPHA);

  const boardHeight = Math.max(2, box.height * BOARD_HEIGHT_FRACTION);
  const overhang = box.width * BOARD_OVERHANG_FRACTION;
  const boardWidth = box.width + overhang * 2;
  const shadowOffset = Math.max(1, boardHeight * BOARD_SHADOW_OFFSET_FRACTION);

  for (let board = 0; board < BOARD_COUNT; board++) {
    const down = (board + 0.5) / BOARD_COUNT;
    const y = box.top + box.height * down - boardHeight / 2;
    const pivotY = y + boardHeight / 2;

    ctx.save();
    ctx.translate(box.centreX, pivotY);
    ctx.rotate(BOARD_TILT_RADIANS[board % BOARD_TILT_RADIANS.length]);
    ctx.translate(-box.centreX, -pivotY);

    // The plank's own shadow on the boarding behind it. Without it three planks
    // lie in the plane of the hole and the hole stops being a hole.
    ctx.fillStyle = rgba(sampleRamp(getRamp('ink_outline'), 0), CAST_SHADOW_ALPHA);
    ctx.fillRect(box.left - overhang + shadowOffset, y + shadowOffset, boardWidth, boardHeight);

    paintLitBlock(
      ctx,
      { x: box.left - overhang, y, width: boardWidth, height: boardHeight },
      body,
      board % 2 === 0 ? TONE_BODY : TONE_LIT,
      seed,
      board,
    );

    const nailInset = boardWidth * BOARD_NAIL_INSET_FRACTION;
    const nailRadius = Math.max(1, boardHeight * BOARD_NAIL_RADIUS_FRACTION);
    for (const nailX of [box.left - overhang + nailInset, box.right + overhang - nailInset]) {
      fillEllipse(
        ctx,
        nailX,
        pivotY,
        nailRadius,
        nailRadius,
        elementColor(accent, TONE_SHADOW, seed, board),
      );
      fillEllipse(
        ctx,
        nailX - nailRadius * 0.3,
        pivotY - nailRadius * 0.3,
        nailRadius * 0.45,
        nailRadius * 0.45,
        elementColor(accent, TONE_LIT, seed, board),
      );
    }
    ctx.restore();
  }
}

// ── fire, iron and water ───────────────────────────────────────────────────

const BRAZIER_BOWL_FRACTION = 0.42;
const BRAZIER_LEG_COUNT = 3;
const BRAZIER_COAL_COUNT = 7;
const BRAZIER_GLOW_INTENSITY = 0.7;
const BRAZIER_GLOW_BLEED_FRACTION = 0.6;

function paintBrazier(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const bowlHeight = box.height * BRAZIER_BOWL_FRACTION;
  const bowlTop = box.top + box.height * 0.22;
  const bowlBottom = bowlTop + bowlHeight;

  for (let leg = 0; leg < BRAZIER_LEG_COUNT; leg++) {
    const spread = (leg / (BRAZIER_LEG_COUNT - 1) - 0.5) * 2;
    strokeLine(
      ctx,
      box.centreX + spread * box.width * 0.2,
      bowlBottom,
      box.centreX + spread * box.width * 0.42,
      box.baseY,
      elementColor(body, spread < 0 ? TONE_LIT : TONE_SHADOW, seed, leg),
      Math.max(2, box.width * 0.07),
    );
  }

  const BOWL_INDEX = 10;
  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, BOWL_INDEX));
  ctx.beginPath();
  ctx.moveTo(box.left, bowlTop);
  ctx.lineTo(box.right, bowlTop);
  ctx.lineTo(box.right - box.width * 0.2, bowlBottom);
  ctx.lineTo(box.left + box.width * 0.2, bowlBottom);
  ctx.closePath();
  ctx.fill();
  paintEdgeLight(
    ctx,
    { x: box.left, y: bowlTop },
    { x: box.right, y: bowlTop },
    elementColor(body, TONE_HIGHLIGHT, seed, BOWL_INDEX),
    2,
    BLOCK_LIT_ALPHA,
  );

  paintCoalBed(draw, bowlTop, BRAZIER_COAL_COUNT);
  paintFlame(draw, box.centreX, bowlTop, box.width * 0.4, box.height * 0.3);
  paintWindowGlow(
    ctx,
    { x: box.left, y: bowlTop - box.height * 0.1, width: box.width, height: bowlHeight },
    {
      rampId: draw.prop.accentRamp,
      intensity: BRAZIER_GLOW_INTENSITY,
      bleed: box.width * BRAZIER_GLOW_BLEED_FRACTION,
    },
  );
}

/** Embers heaped in a bowl: hot in the middle, spent at the rim. */
function paintCoalBed(draw: PropDraw, topY: number, count: number): void {
  const { ctx, box, accent, seed } = draw;
  const coalRadius = box.width * 0.09;
  for (let coal = 0; coal < count; coal++) {
    const along = (coal + 0.5) / count;
    const fromCentre = Math.abs(along - 0.5) * 2;
    const x = box.left + box.width * 0.12 + box.width * 0.76 * along;
    const y =
      topY - coalRadius * 0.4 + (elementValue(seed, STREAM_WOBBLE, coal) - 0.5) * coalRadius;
    fillEllipse(
      ctx,
      x,
      y,
      coalRadius,
      coalRadius * 0.7,
      elementColor(
        accent,
        TONE_HIGHLIGHT - fromCentre * (TONE_HIGHLIGHT - TONE_SHADOW),
        seed,
        coal,
      ),
    );
  }
}

/** A low flame: a teardrop with a paler heart. */
function paintFlame(
  draw: PropDraw,
  x: number,
  baseY: number,
  halfWidth: number,
  height: number,
): void {
  const { ctx, accent, seed } = draw;
  const FLAME_INDEX = 0;
  const lick = (variant(draw, FLAME_INDEX) - 0.5) * halfWidth;
  ctx.fillStyle = rgb(elementColor(accent, TONE_BODY, seed, FLAME_INDEX));
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.quadraticCurveTo(x - halfWidth * 0.7, baseY - height * 0.7, x + lick, baseY - height);
  ctx.quadraticCurveTo(x + halfWidth * 0.7, baseY - height * 0.6, x + halfWidth, baseY);
  ctx.closePath();
  ctx.fill();

  const HEART_FRACTION = 0.5;
  ctx.fillStyle = rgb(elementColor(accent, TONE_HIGHLIGHT, seed, FLAME_INDEX + 1));
  ctx.beginPath();
  ctx.moveTo(x - halfWidth * HEART_FRACTION, baseY);
  ctx.quadraticCurveTo(
    x - halfWidth * 0.3,
    baseY - height * 0.4,
    x + lick * HEART_FRACTION,
    baseY - height * HEART_FRACTION,
  );
  ctx.quadraticCurveTo(
    x + halfWidth * 0.3,
    baseY - height * 0.35,
    x + halfWidth * HEART_FRACTION,
    baseY,
  );
  ctx.closePath();
  ctx.fill();
}

const LANTERN_BRACKET_FRACTION = 0.22;
const LANTERN_BODY_FRACTION = 0.46;
const LANTERN_GLOW_INTENSITY = 0.85;
const LANTERN_GLOW_BLEED_FRACTION = 0.9;

/** A lamp on a wall bracket, with its light spilling onto the stone around it. */
function paintLantern(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const BRACKET_INDEX = 0;
  const bracketLength = box.width * LANTERN_BRACKET_FRACTION;
  const hangX = box.centreX;
  const bodyTop = box.top + box.height * (1 - LANTERN_BODY_FRACTION) * 0.7;
  const bodyHeight = box.height * LANTERN_BODY_FRACTION;
  const bodyWidth = box.width * 0.62;

  strokeLine(
    ctx,
    box.left,
    box.top,
    hangX,
    box.top + bracketLength * 0.3,
    elementColor(body, TONE_SHADOW, seed, BRACKET_INDEX),
    Math.max(1, box.width * 0.05),
  );
  strokeLine(
    ctx,
    hangX,
    box.top + bracketLength * 0.3,
    hangX,
    bodyTop,
    elementColor(body, TONE_SHADOW, seed, BRACKET_INDEX + 1),
    1,
  );

  paintLampBody(draw, hangX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  paintWindowGlow(
    ctx,
    { x: hangX - bodyWidth / 2, y: bodyTop, width: bodyWidth, height: bodyHeight },
    {
      rampId: draw.prop.accentRamp,
      intensity: LANTERN_GLOW_INTENSITY,
      bleed: box.width * LANTERN_GLOW_BLEED_FRACTION,
    },
  );
}

/** The glazed box a lantern's flame sits in: cap, panes, foot. */
function paintLampBody(draw: PropDraw, x: number, y: number, width: number, height: number): void {
  const { ctx, body, accent, seed } = draw;
  const LAMP_INDEX = 5;
  const CAP_FRACTION = 0.22;
  const FOOT_FRACTION = 0.14;
  const capHeight = height * CAP_FRACTION;
  const footHeight = height * FOOT_FRACTION;

  ctx.fillStyle = rgb(elementColor(accent, TONE_HIGHLIGHT, seed, LAMP_INDEX));
  ctx.fillRect(x, y + capHeight, width, height - capHeight - footHeight);

  ctx.fillStyle = rgb(elementColor(body, TONE_BODY, seed, LAMP_INDEX + 1));
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width, y + capHeight);
  ctx.lineTo(x, y + capHeight);
  ctx.closePath();
  ctx.fill();

  paintLitBlock(
    ctx,
    { x, y: y + height - footHeight, width, height: footHeight },
    body,
    TONE_BODY,
    seed,
    LAMP_INDEX + 2,
  );

  const MULLION_COUNT = 2;
  for (let mullion = 0; mullion < MULLION_COUNT; mullion++) {
    const mullionX = x + width * ((mullion + 1) / (MULLION_COUNT + 1));
    strokeLine(
      ctx,
      mullionX,
      y + capHeight,
      mullionX,
      y + height - footHeight,
      elementColor(body, TONE_DEEP, seed, LAMP_INDEX + 3),
      1,
    );
  }
}

const SUIT_COUNT = 4;
const SUIT_GLOW_INTENSITY = 0.9;
const SUIT_GLOW_BLEED_FRACTION = 0.8;

/**
 * A card-suit lamp over a gambling house door.
 *
 * The suit turns with the prop's seed, which already carries its index in the
 * building's prop list — so a row of four of them is a row of four suits rather
 * than four hearts.
 */
function paintSuitLantern(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const BRACKET_INDEX = 0;
  const suit = Math.floor(variant(draw, BRACKET_INDEX) * SUIT_COUNT);
  const suitSize = Math.min(box.width, box.height) * 0.7;
  const centreY = box.top + box.height * 0.55;

  strokeLine(
    ctx,
    box.centreX,
    box.top,
    box.centreX,
    centreY - suitSize / 2,
    elementColor(body, TONE_SHADOW, seed, BRACKET_INDEX),
    Math.max(1, box.width * 0.06),
  );

  ctx.save();
  ctx.fillStyle = rgb(elementColor(accent, TONE_HIGHLIGHT, seed, suit));
  traceSuitPath(ctx, suit, box.centreX, centreY, suitSize);
  ctx.fill();
  ctx.strokeStyle = rgb(elementColor(body, TONE_DEEP, seed, suit));
  ctx.lineWidth = Math.max(1, suitSize * 0.08);
  ctx.stroke();
  ctx.restore();

  paintWindowGlow(
    ctx,
    { x: box.centreX - suitSize / 2, y: centreY - suitSize / 2, width: suitSize, height: suitSize },
    {
      rampId: draw.prop.accentRamp,
      intensity: SUIT_GLOW_INTENSITY,
      bleed: suitSize * SUIT_GLOW_BLEED_FRACTION,
    },
  );
}

/** Heart, spade, diamond, club — whichever `suit` names. */
function traceSuitPath(ctx: NodeCtx, suit: number, x: number, y: number, size: number): void {
  const half = size / 2;
  ctx.beginPath();
  if (suit === 0) {
    const LOBE_RISE = 0.35;
    ctx.moveTo(x, y + half);
    ctx.bezierCurveTo(
      x - half * 1.4,
      y - half * LOBE_RISE,
      x - half * 0.5,
      y - half,
      x,
      y - half * 0.3,
    );
    ctx.bezierCurveTo(x + half * 0.5, y - half, x + half * 1.4, y - half * LOBE_RISE, x, y + half);
    ctx.closePath();
    return;
  }
  if (suit === 1) {
    ctx.moveTo(x, y - half);
    ctx.bezierCurveTo(
      x + half * 1.3,
      y + half * 0.2,
      x + half * 0.4,
      y + half * 0.6,
      x,
      y + half * 0.25,
    );
    ctx.bezierCurveTo(x - half * 0.4, y + half * 0.6, x - half * 1.3, y + half * 0.2, x, y - half);
    ctx.closePath();
    ctx.moveTo(x - half * 0.22, y + half);
    ctx.lineTo(x + half * 0.22, y + half);
    ctx.lineTo(x, y + half * 0.25);
    ctx.closePath();
    return;
  }
  if (suit === 2) {
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half * 0.7, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half * 0.7, y);
    ctx.closePath();
    return;
  }
  const LOBE_RADIUS = 0.34;
  ctx.arc(x, y - half * 0.4, half * LOBE_RADIUS, 0, TWO_PI);
  ctx.closePath();
  ctx.moveTo(x - half * 0.35, y + half * 0.15);
  ctx.arc(x - half * 0.4, y + half * 0.1, half * LOBE_RADIUS, 0, TWO_PI);
  ctx.closePath();
  ctx.moveTo(x + half * 0.45, y + half * 0.15);
  ctx.arc(x + half * 0.4, y + half * 0.1, half * LOBE_RADIUS, 0, TWO_PI);
  ctx.closePath();
  ctx.moveTo(x - half * 0.16, y + half);
  ctx.lineTo(x + half * 0.16, y + half);
  ctx.lineTo(x, y + half * 0.2);
  ctx.closePath();
}

const ANVIL_STUMP_FRACTION = 0.45;
const ANVIL_WAIST_FRACTION = 0.35;

/** An anvil on its stump: horn to the left, heel to the right. */
function paintAnvil(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const stumpHeight = box.height * ANVIL_STUMP_FRACTION;
  const stumpTop = box.baseY - stumpHeight;
  const STUMP_INSET_FRACTION = 0.18;
  const stumpLeft = box.left + box.width * STUMP_INSET_FRACTION;
  const stumpWidth = box.width * (1 - STUMP_INSET_FRACTION * 2);
  const STUMP_INDEX = 0;

  paintLitBlock(
    ctx,
    { x: stumpLeft, y: stumpTop, width: stumpWidth, height: stumpHeight },
    body,
    TONE_BODY,
    seed,
    STUMP_INDEX,
  );
  fillEllipse(
    ctx,
    stumpLeft + stumpWidth / 2,
    stumpTop,
    stumpWidth / 2,
    stumpHeight * 0.12,
    elementColor(body, TONE_LIT, seed, STUMP_INDEX + 1),
  );

  const faceY = box.top + box.height * 0.12;
  const waistY = stumpTop - box.height * 0.04;
  const ANVIL_INDEX = 10;
  ctx.fillStyle = rgb(elementColor(accent, TONE_BODY, seed, ANVIL_INDEX));
  ctx.beginPath();
  ctx.moveTo(box.left, faceY + box.height * 0.06);
  ctx.lineTo(box.left + box.width * 0.25, faceY);
  ctx.lineTo(box.right, faceY);
  ctx.lineTo(box.right, faceY + box.height * 0.1);
  ctx.lineTo(box.centreX + box.width * ANVIL_WAIST_FRACTION * 0.5, faceY + box.height * 0.14);
  ctx.lineTo(box.centreX + box.width * ANVIL_WAIST_FRACTION * 0.4, waistY);
  ctx.lineTo(box.centreX - box.width * ANVIL_WAIST_FRACTION * 0.4, waistY);
  ctx.lineTo(box.centreX - box.width * ANVIL_WAIST_FRACTION * 0.5, faceY + box.height * 0.14);
  ctx.lineTo(box.left + box.width * 0.22, faceY + box.height * 0.12);
  ctx.closePath();
  ctx.fill();

  paintEdgeLight(
    ctx,
    { x: box.left + box.width * 0.25, y: faceY },
    { x: box.right, y: faceY },
    elementColor(accent, TONE_HIGHLIGHT, seed, ANVIL_INDEX + 1),
    2,
    BLOCK_LIT_ALPHA,
  );
}

const WATER_SURFACE_FRACTION = 0.14;

/** The smith's slack tub: a cask brimful of black water. */
function paintQuenchBarrel(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const WATER_INDEX = 95;
  paintCask(draw, box);

  const radiusX = box.width / 2 - box.width * BARREL_END_INSET_FRACTION;
  const radiusY = box.height * BARREL_LID_RISE_FRACTION;
  fillEllipse(
    ctx,
    box.centreX,
    box.top,
    radiusX,
    radiusY,
    sampleRamp(getRamp('dark_glass'), TONE_DEEP),
  );

  // One sky reflection off-centre. Water with no highlight is a hole in a barrel.
  const REFLECTION_WIDTH_FRACTION = 0.4;
  const REFLECTION_ALPHA = 0.5;
  fillEllipse(
    ctx,
    box.centreX - radiusX * 0.3,
    box.top - radiusY * 0.2,
    radiusX * REFLECTION_WIDTH_FRACTION,
    radiusY * WATER_SURFACE_FRACTION * 2,
    elementColor(body, TONE_HIGHLIGHT, seed, WATER_INDEX),
    REFLECTION_ALPHA,
  );
}

const CAULDRON_BELLY_FRACTION = 0.6;
const CAULDRON_TRIPOD_LEGS = 3;
const CAULDRON_RIM_FRACTION = 0.12;

/** A bellied pot on a tripod, its rim wider than its base. */
function paintCauldron(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const bellyHeight = box.height * CAULDRON_BELLY_FRACTION;
  const rimY = box.top + box.height * 0.14;
  const bellyBottom = rimY + bellyHeight;
  const bellyRadius = box.width / 2;
  const POT_INDEX = 0;

  for (let leg = 0; leg < CAULDRON_TRIPOD_LEGS; leg++) {
    const spread = (leg / (CAULDRON_TRIPOD_LEGS - 1) - 0.5) * 2;
    strokeLine(
      ctx,
      box.centreX + spread * bellyRadius * 0.5,
      bellyBottom - box.height * 0.05,
      box.centreX + spread * bellyRadius * 0.9,
      box.baseY,
      elementColor(body, spread < 0 ? TONE_BODY : TONE_SHADOW, seed, leg),
      Math.max(2, box.width * 0.06),
    );
  }

  ctx.fillStyle = rgb(elementColor(body, TONE_SHADOW, seed, POT_INDEX));
  ctx.beginPath();
  ctx.moveTo(box.centreX - bellyRadius, rimY);
  ctx.bezierCurveTo(
    box.centreX - bellyRadius * 1.1,
    rimY + bellyHeight * 0.7,
    box.centreX - bellyRadius * 0.5,
    bellyBottom,
    box.centreX,
    bellyBottom,
  );
  ctx.bezierCurveTo(
    box.centreX + bellyRadius * 0.5,
    bellyBottom,
    box.centreX + bellyRadius * 1.1,
    rimY + bellyHeight * 0.7,
    box.centreX + bellyRadius,
    rimY,
  );
  ctx.closePath();
  ctx.fill();

  const SHEEN_ALPHA = 0.45;
  fillEllipse(
    ctx,
    box.centreX - bellyRadius * 0.4,
    rimY + bellyHeight * 0.4,
    bellyRadius * 0.3,
    bellyHeight * 0.3,
    elementColor(body, TONE_LIT, seed, POT_INDEX + 1),
    SHEEN_ALPHA,
  );

  fillEllipse(
    ctx,
    box.centreX,
    rimY,
    bellyRadius,
    box.height * CAULDRON_RIM_FRACTION * 0.5,
    elementColor(body, TONE_BODY, seed, POT_INDEX + 2),
  );
  fillEllipse(
    ctx,
    box.centreX,
    rimY,
    bellyRadius * 0.82,
    box.height * CAULDRON_RIM_FRACTION * 0.38,
    elementColor(accent, TONE_BODY, seed, POT_INDEX + 3),
  );

  const HANDLE_RISE_FRACTION = 0.22;
  ctx.save();
  ctx.strokeStyle = rgb(elementColor(body, TONE_LIT, seed, POT_INDEX + 4));
  ctx.lineWidth = Math.max(1, box.width * 0.04);
  ctx.beginPath();
  ctx.moveTo(box.centreX - bellyRadius, rimY);
  ctx.quadraticCurveTo(
    box.centreX,
    rimY - box.height * HANDLE_RISE_FRACTION,
    box.centreX + bellyRadius,
    rimY,
  );
  ctx.stroke();
  ctx.restore();
}

const FORGE_ARCH_RISE_FRACTION = 0.4;
const FORGE_GLOW_INTENSITY = 0.95;
const FORGE_GLOW_BLEED_FRACTION = 0.7;
const FORGE_SOOT_HEIGHT_FRACTION = 0.7;
const FORGE_SOOT_ALPHA = 0.45;

/** The mouth of a forge: an arch, a hot interior, and years of soot above it. */
function paintForgeMouth(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const ARCH_INDEX = 0;
  const springY = box.top + box.height * FORGE_ARCH_RISE_FRACTION;

  paintSootPlume(draw);

  ctx.save();
  traceArchPath(ctx, box, springY);
  ctx.fillStyle = rgb(sampleRamp(getRamp('ink_outline'), TONE_DEEP));
  ctx.fill();
  ctx.clip();
  paintWindowGlow(
    ctx,
    { x: box.left, y: springY, width: box.width, height: box.baseY - springY },
    {
      rampId: draw.prop.accentRamp,
      intensity: FORGE_GLOW_INTENSITY,
      bleed: box.width * FORGE_GLOW_BLEED_FRACTION,
    },
  );
  ctx.restore();

  // The halo outside the arch is what makes the interior read as a fire rather
  // than as a painted orange hole.
  paintWindowGlow(
    ctx,
    { x: box.left, y: springY, width: box.width, height: box.baseY - springY },
    {
      rampId: draw.prop.accentRamp,
      intensity: FORGE_GLOW_INTENSITY * 0.5,
      bleed: box.width * FORGE_GLOW_BLEED_FRACTION,
    },
  );

  ctx.save();
  ctx.strokeStyle = rgb(elementColor(body, TONE_BODY, seed, ARCH_INDEX));
  ctx.lineWidth = Math.max(2, box.width * 0.09);
  traceArchPath(ctx, box, springY);
  ctx.stroke();
  ctx.restore();
}

function traceArchPath(ctx: NodeCtx, box: PropBox, springY: number): void {
  ctx.beginPath();
  ctx.moveTo(box.left, box.baseY);
  ctx.lineTo(box.left, springY);
  ctx.quadraticCurveTo(box.centreX, box.top, box.right, springY);
  ctx.lineTo(box.right, box.baseY);
  ctx.closePath();
}

/** Soot climbing the wall above an opening, widening and fading as it rises. */
function paintSootPlume(draw: PropDraw): void {
  const { ctx, box } = draw;
  const height = box.height * FORGE_SOOT_HEIGHT_FRACTION;
  const top = box.top - height;
  const SPREAD_AT_TOP = 1.6;
  const soot = sampleRamp(getRamp('smoke'), TONE_DEEP);
  const gradient = ctx.createLinearGradient(0, box.top, 0, top);
  gradient.addColorStop(0, rgba(soot, FORGE_SOOT_ALPHA));
  gradient.addColorStop(1, rgba(soot, 0));

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(box.left, box.top);
  ctx.lineTo(box.centreX - (box.width / 2) * SPREAD_AT_TOP, top);
  ctx.lineTo(box.centreX + (box.width / 2) * SPREAD_AT_TOP, top);
  ctx.lineTo(box.right, box.top);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── roof, shopfront and signage ────────────────────────────────────────────

const VANE_POST_THICKNESS_FRACTION = 0.08;
const VANE_ARM_FRACTION = 0.34;
const VANE_ROOSTER_FRACTION = 0.34;

/**
 * A weathervane, which stands on the roof rather than the ground — its `row` is
 * high in the frame and its shadow is the one the roof takes.
 */
function paintWeathervane(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const POST_INDEX = 0;
  const postThickness = Math.max(2, box.width * VANE_POST_THICKNESS_FRACTION);
  const armY = box.top + box.height * VANE_ROOSTER_FRACTION * 1.4;
  const armHalfWidth = box.width * VANE_ARM_FRACTION;

  paintShaft(
    ctx,
    box.centreX,
    box.baseY,
    box.centreX,
    box.top,
    postThickness,
    body,
    seed,
    POST_INDEX,
  );

  const armColor = elementColor(accent, TONE_BODY, seed, POST_INDEX + 1);
  strokeLine(
    ctx,
    box.centreX - armHalfWidth,
    armY,
    box.centreX + armHalfWidth,
    armY,
    armColor,
    postThickness * 0.7,
  );
  const CARDINAL_TIP_FRACTION = 0.18;
  strokeLine(
    ctx,
    box.centreX - armHalfWidth,
    armY - armHalfWidth * CARDINAL_TIP_FRACTION,
    box.centreX - armHalfWidth,
    armY + armHalfWidth * CARDINAL_TIP_FRACTION,
    armColor,
    postThickness * 0.7,
  );
  strokeLine(
    ctx,
    box.centreX + armHalfWidth,
    armY - armHalfWidth * CARDINAL_TIP_FRACTION,
    box.centreX + armHalfWidth,
    armY + armHalfWidth * CARDINAL_TIP_FRACTION,
    armColor,
    postThickness * 0.7,
  );

  paintRoosterSilhouette(
    draw,
    box.centreX,
    box.top + box.height * VANE_ROOSTER_FRACTION,
    box.height * VANE_ROOSTER_FRACTION,
  );
}

/**
 * The bird on top, as a filled silhouette.
 *
 * At this size the rooster is a body, a raised tail and a comb — anything more
 * detailed disappears in the downsample and only costs the outline its clarity.
 */
function paintRoosterSilhouette(draw: PropDraw, x: number, y: number, size: number): void {
  const { ctx, accent, seed } = draw;
  const ROOSTER_INDEX = 30;
  ctx.save();
  ctx.fillStyle = rgb(elementColor(accent, TONE_SHADOW, seed, ROOSTER_INDEX));
  ctx.beginPath();
  ctx.moveTo(x - size * 0.9, y - size * 0.9);
  ctx.quadraticCurveTo(x - size * 0.2, y - size * 0.4, x - size * 0.1, y);
  ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.1, x + size * 0.7, y - size * 0.35);
  ctx.lineTo(x + size * 0.85, y - size * 0.55);
  ctx.lineTo(x + size * 0.62, y - size * 0.55);
  ctx.quadraticCurveTo(x + size * 0.55, y - size * 0.95, x + size * 0.2, y - size * 0.75);
  ctx.quadraticCurveTo(x - size * 0.3, y - size * 0.55, x - size * 0.9, y - size * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const ROPE_STANCHION_WIDTH_FRACTION = 0.1;
const ROPE_SWAG_FRACTION = 0.45;

/** A velvet rope between two posts: the doorman's line. */
function paintRopeLine(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const postWidth = box.width * ROPE_STANCHION_WIDTH_FRACTION;
  const postTop = box.top + box.height * 0.1;

  for (const [index, postX] of [box.left + postWidth, box.right - postWidth].entries()) {
    paintLitBlock(
      ctx,
      { x: postX - postWidth / 2, y: postTop, width: postWidth, height: box.baseY - postTop },
      body,
      TONE_LIT,
      seed,
      index,
    );
    const FINIAL_RADIUS_FRACTION = 0.85;
    fillEllipse(
      ctx,
      postX,
      postTop,
      postWidth * FINIAL_RADIUS_FRACTION,
      postWidth * FINIAL_RADIUS_FRACTION,
      elementColor(body, TONE_HIGHLIGHT, seed, index + 2),
    );
    const BASE_WIDTH_FACTOR = 2.2;
    fillEllipse(
      ctx,
      postX,
      box.baseY,
      postWidth * BASE_WIDTH_FACTOR * 0.5,
      postWidth * 0.4,
      elementColor(body, TONE_BODY, seed, index + 4),
    );
  }

  const ROPE_INDEX = 6;
  const swagY = postTop + box.height * ROPE_SWAG_FRACTION;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(elementColor(accent, TONE_BODY, seed, ROPE_INDEX));
  ctx.lineWidth = Math.max(2, box.height * 0.07);
  ctx.beginPath();
  ctx.moveTo(box.left + postWidth, postTop + box.height * 0.06);
  ctx.quadraticCurveTo(
    box.centreX,
    swagY * 1.05,
    box.right - postWidth,
    postTop + box.height * 0.06,
  );
  ctx.stroke();
  // The lit face of a swag is its upper curve; without it the rope is a cable.
  ctx.strokeStyle = rgba(
    elementColor(accent, TONE_HIGHLIGHT, seed, ROPE_INDEX + 1),
    BLOCK_LIT_ALPHA,
  );
  ctx.lineWidth = Math.max(1, box.height * 0.025);
  ctx.beginPath();
  ctx.moveTo(box.left + postWidth, postTop + box.height * 0.04);
  ctx.quadraticCurveTo(box.centreX, swagY, box.right - postWidth, postTop + box.height * 0.04);
  ctx.stroke();
  ctx.restore();
}

const AWNING_STRIPE_COUNT = 7;
const AWNING_PROJECTION_FRACTION = 0.55;
const AWNING_VALANCE_FRACTION = 0.3;
const AWNING_SCALLOP_COUNT = 6;

/**
 * A canopy over a shopfront.
 *
 * Painted as a projecting slab rather than a flat stripe: the front edge sits
 * lower and further out than the wall line, and the wall under it goes into
 * shadow. Without the projection an awning is a striped rectangle stuck to a
 * wall, which is the exact failure the circus tents have.
 */
function paintAwning(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const projection = box.height * AWNING_PROJECTION_FRACTION;
  const canopyBottom = box.baseY - box.height * AWNING_VALANCE_FRACTION;
  const frontLeft = box.left - projection * 0.15;
  const frontRight = box.right + projection * 0.15;

  paintEdgeAo(
    ctx,
    {
      x: box.left,
      y: box.baseY,
      width: box.width,
      height: box.height,
    },
    'top',
    { depth: WALL_SHADOW_ALPHA, reach: box.height * WALL_SHADOW_REACH_FACTOR },
  );

  for (let stripe = 0; stripe < AWNING_STRIPE_COUNT; stripe++) {
    const from = stripe / AWNING_STRIPE_COUNT;
    const to = (stripe + 1) / AWNING_STRIPE_COUNT;
    const ramp = stripe % 2 === 0 ? body : accent;
    ctx.fillStyle = rgb(elementColor(ramp, TONE_LIT, seed, stripe));
    ctx.beginPath();
    ctx.moveTo(box.left + box.width * from, box.top);
    ctx.lineTo(box.left + box.width * to, box.top);
    ctx.lineTo(frontLeft + (frontRight - frontLeft) * to, canopyBottom);
    ctx.lineTo(frontLeft + (frontRight - frontLeft) * from, canopyBottom);
    ctx.closePath();
    ctx.fill();
    paintScallop(draw, frontLeft, frontRight, canopyBottom, ramp, stripe, from, to);
  }

  paintEdgeLight(
    ctx,
    { x: frontLeft, y: canopyBottom },
    { x: frontRight, y: canopyBottom },
    elementColor(body, TONE_HIGHLIGHT, seed, AWNING_STRIPE_COUNT),
    2,
    BLOCK_LIT_ALPHA,
  );
}

/** The scalloped valance hanging off the canopy's front edge. */
function paintScallop(
  draw: PropDraw,
  frontLeft: number,
  frontRight: number,
  canopyBottom: number,
  ramp: Ramp,
  index: number,
  from: number,
  to: number,
): void {
  const { ctx, box, seed } = draw;
  const valanceHeight = box.height * AWNING_VALANCE_FRACTION;
  const scallopWidth = (frontRight - frontLeft) / AWNING_SCALLOP_COUNT;
  const startX = frontLeft + (frontRight - frontLeft) * from;
  const endX = frontLeft + (frontRight - frontLeft) * to;

  ctx.save();
  ctx.beginPath();
  ctx.rect(startX, canopyBottom, endX - startX, valanceHeight);
  ctx.clip();
  ctx.fillStyle = rgb(elementColor(ramp, TONE_BODY, seed, index));
  ctx.beginPath();
  ctx.moveTo(frontLeft, canopyBottom);
  for (let scallop = 0; scallop < AWNING_SCALLOP_COUNT; scallop++) {
    const scallopLeft = frontLeft + scallop * scallopWidth;
    ctx.quadraticCurveTo(
      scallopLeft + scallopWidth / 2,
      canopyBottom + valanceHeight * 1.6,
      scallopLeft + scallopWidth,
      canopyBottom,
    );
  }
  ctx.lineTo(frontRight, canopyBottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** How much of the shed's height the sloping roof falls across its span. */
const LEAN_TO_SLOPE_FRACTION = 0.34;
/** Thickness of the roof slab, so the boarding has an edge rather than an outline. */
const LEAN_TO_ROOF_DEPTH_FRACTION = 0.12;
const LEAN_TO_POST_THICKNESS_FRACTION = 0.11;
const LEAN_TO_BOARD_COUNT = 7;
const LEAN_TO_BRACE_FRACTION = 0.42;

/**
 * A shed roof leaning on the wall: high where it meets the building, falling to
 * an eave carried on posts.
 *
 * The slope is the whole read. Drawn as a horizontal slab this is a table, which
 * is exactly what it was; the roof has to *fall away* from the wall it leans on,
 * and the shadow it drops on that wall is what puts it in front of the building
 * rather than beside it.
 */
function paintLeanTo(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const ridgeY = box.top;
  const eaveY = box.top + box.height * LEAN_TO_SLOPE_FRACTION;
  const roofDepth = Math.max(2, box.height * LEAN_TO_ROOF_DEPTH_FRACTION);
  const postThickness = Math.max(2, box.width * LEAN_TO_POST_THICKNESS_FRACTION);
  const traceRoof = (target: NodeCtx): void => {
    target.beginPath();
    target.moveTo(box.left, ridgeY);
    target.lineTo(box.right, eaveY);
    target.lineTo(box.right, eaveY + roofDepth);
    target.lineTo(box.left, ridgeY + roofDepth);
    target.closePath();
    target.fill();
  };

  paintCastShadow(draw, traceRoof);

  const eaveX = box.right - postThickness;
  const postXs = [box.left + postThickness * 1.5, eaveX];
  for (const [index, postX] of postXs.entries()) {
    const along = (postX - box.left) / Math.max(1, box.width);
    const postTop = ridgeY + (eaveY - ridgeY) * along + roofDepth;
    paintLitBlock(
      ctx,
      {
        x: postX - postThickness / 2,
        y: postTop,
        width: postThickness,
        height: box.baseY - postTop,
      },
      body,
      index === 0 ? TONE_SHADOW : TONE_BODY,
      seed,
      index,
    );
  }

  // One knee brace off the outer post. A shed on two bare legs is a trestle.
  const BRACE_INDEX = 5;
  const braceFoot = box.baseY - (box.baseY - eaveY) * LEAN_TO_BRACE_FRACTION;
  strokeLine(
    ctx,
    eaveX,
    braceFoot,
    eaveX - box.width * LEAN_TO_BRACE_FRACTION,
    eaveY + roofDepth,
    elementColor(body, TONE_SHADOW, seed, BRACE_INDEX),
    postThickness * 0.7,
  );

  for (let board = 0; board < LEAN_TO_BOARD_COUNT; board++) {
    const from = board / LEAN_TO_BOARD_COUNT;
    const to = (board + 1) / LEAN_TO_BOARD_COUNT;
    const fromX = box.left + box.width * from;
    const toX = box.left + box.width * to;
    const wander = wanderAt(draw, fromX, ridgeY);
    // Boards run down the slope, so each one is a parallelogram between the two
    // ends of the fall. Laid out horizontally they would contradict the pitch.
    ctx.fillStyle = rgb(
      elementColor(accent, board % 2 === 0 ? TONE_LIT : TONE_BODY, seed, board + 10),
    );
    ctx.beginPath();
    ctx.moveTo(fromX, ridgeY + (eaveY - ridgeY) * from + wander);
    ctx.lineTo(toX, ridgeY + (eaveY - ridgeY) * to + wander);
    ctx.lineTo(toX, ridgeY + (eaveY - ridgeY) * to + roofDepth);
    ctx.lineTo(fromX, ridgeY + (eaveY - ridgeY) * from + roofDepth);
    ctx.closePath();
    ctx.fill();
  }

  const FASCIA_INDEX = 20;
  paintEdgeLight(
    ctx,
    { x: box.left, y: ridgeY },
    { x: box.right, y: eaveY },
    elementColor(accent, TONE_HIGHLIGHT, seed, FASCIA_INDEX),
    2,
    BLOCK_LIT_ALPHA,
  );
  paintEdgeLight(
    ctx,
    { x: box.left, y: ridgeY + roofDepth },
    { x: box.right, y: eaveY + roofDepth },
    elementColor(accent, TONE_DEEP, seed, FASCIA_INDEX + 1),
    2,
    BLOCK_SHADOW_ALPHA,
  );
}

/**
 * The moulding's width, as a fraction of the plaque's *height*.
 *
 * Not of its shorter side, which is the same thing on a square plaque and a very
 * different thing on a wide one: a border scaled off `min(width, height)` on a
 * board three times as wide as it is tall eats a third of the only measure the
 * device has to be legible in.
 */
const RELIEF_BORDER_FRACTION = 0.13;
const RELIEF_BORDER_MIN_PX = 2;
const RELIEF_BEVEL_FRACTION = 0.5;
const RELIEF_DEVICE_INSET_FRACTION = 0.07;
/**
 * How far a device may be stretched across a wide field.
 *
 * A device fitted to the field's height alone is a stamp lost in the middle of a
 * long panel, and the height is already the smaller of the two measures on every
 * plaque in town. Carved devices on wide panels really are splayed wider than
 * they are tall, so the stretch reads as design rather than as distortion —
 * within this limit, past which a wheel is an egg.
 */
const RELIEF_DEVICE_MAX_ASPECT = 1.5;
/** How far a carved face stands proud of the field it was cut from. */
const RELIEF_CARVE_DEPTH_FRACTION = 0.055;
const RELIEF_CARVE_DEPTH_MIN_PX = 1;

/**
 * A carved plaque: a raised moulded border, a field sunk below it, and the
 * building's own device cut into that field.
 *
 * The device comes from the spec rather than from the seed, because the whole
 * job of a relief board is to say what the building is — crossed weapons over
 * the barracks door and a sun disc over the temple's are the same object
 * carrying different meanings, and one picked from a hash carries none. A board
 * whose spec names no device gets a plain moulded panel, which is a real thing a
 * mason makes; a guessed device is not.
 */
function paintReliefBoard(draw: PropDraw): void {
  const { ctx, box, body, seed } = draw;
  const MOULDING_INDEX = 0;
  paintLitBlock(
    ctx,
    { x: box.left, y: box.top, width: box.width, height: box.height },
    body,
    TONE_BODY,
    seed,
    MOULDING_INDEX,
  );

  const border = Math.max(RELIEF_BORDER_MIN_PX, box.height * RELIEF_BORDER_FRACTION);
  const field: Rect = {
    x: box.left + border,
    y: box.top + border,
    width: box.width - border * 2,
    height: box.height - border * 2,
  };
  ctx.fillStyle = rgb(elementColor(body, TONE_SHADOW, seed, MOULDING_INDEX + 1));
  ctx.fillRect(field.x, field.y, field.width, field.height);
  paintRecessAo(ctx, field, WALL_SHADOW_ALPHA);

  // The far walls of a recess are the ones facing the sun. Without them the
  // border is a painted frame rather than a moulding standing off the field.
  const bevel = Math.max(1, border * RELIEF_BEVEL_FRACTION);
  const litReveal = elementColor(body, TONE_HIGHLIGHT, seed, MOULDING_INDEX + 2);
  paintEdgeLight(
    ctx,
    { x: field.x, y: field.y + field.height },
    { x: field.x + field.width, y: field.y + field.height },
    litReveal,
    bevel,
    BLOCK_LIT_ALPHA,
  );
  paintEdgeLight(
    ctx,
    { x: field.x + field.width, y: field.y },
    { x: field.x + field.width, y: field.y + field.height },
    litReveal,
    bevel,
    BLOCK_LIT_ALPHA * BLOCK_LEFT_LIGHT_FRACTION,
  );

  const device = draw.prop.device;
  if (device === undefined) return;
  const inset = Math.min(field.width, field.height) * RELIEF_DEVICE_INSET_FRACTION;
  paintCarvedDevice(draw, {
    x: field.x + inset,
    y: field.y + inset,
    width: field.width - inset * 2,
    height: field.height - inset * 2,
  });
}

/**
 * Builds one device's outline in a unit box spanning -1..1 on both axes, centred
 * on the origin, y growing downward. Never fills or strokes: the carve pass owns
 * that, and owns the three passes the same path is filled in.
 *
 * `aspect` is how much wider than tall that unit box has been made on this
 * plaque. A device built of things that may be splayed ignores it; one built on
 * a circle divides its own x by it, because an oval cartwheel is a broken wheel
 * where a splayed sheaf is just a wide sheaf.
 */
type DeviceTracer = (ctx: NodeCtx, aspect: number) => void;

/**
 * Exhaustive by construction, the same law `PROP_MOUNTING` obeys: a device added
 * to `ReliefDevice` with no tracer here fails to compile rather than carving a
 * plaque that silently contains nothing.
 */
const RELIEF_DEVICE_TRACERS: Readonly<Record<ReliefDevice, DeviceTracer>> = {
  crossed_weapons: traceCrossedWeapons,
  sun_disc: traceSunDisc,
  mortar_and_pestle: traceMortarAndPestle,
  horn: traceHorn,
  wheat_sheaf: traceWheatSheaf,
  tankard: traceTankard,
  wheel: traceWheel,
};

/**
 * One device, cut into the sunken field.
 *
 * Three fills of a single path: the shadow the raised face throws down and
 * right, the sunlit chamfer up and left, then the face itself over both. Only
 * the two slivers that escape the face survive, and those slivers are the whole
 * reason a carving reads as cut into the stone rather than painted onto it.
 */
function paintCarvedDevice(draw: PropDraw, field: Rect): void {
  const { ctx, accent, seed } = draw;
  const device = draw.prop.device;
  if (device === undefined) return;
  const trace = RELIEF_DEVICE_TRACERS[device];
  const DEVICE_INDEX = 20;
  const depth = Math.max(
    RELIEF_CARVE_DEPTH_MIN_PX,
    Math.min(field.width, field.height) * RELIEF_CARVE_DEPTH_FRACTION,
  );
  const passes: ReadonlyArray<{ readonly offset: number; readonly tone: number }> = [
    { offset: depth, tone: TONE_DEEP },
    { offset: -depth, tone: TONE_HIGHLIGHT },
    { offset: 0, tone: TONE_BODY },
  ];

  const halfHeight = field.height / 2;
  const halfWidth = Math.min(field.width / 2, halfHeight * RELIEF_DEVICE_MAX_ASPECT);
  const centreX = field.x + field.width / 2;
  const centreY = field.y + field.height / 2;

  for (const [index, pass] of passes.entries()) {
    ctx.save();
    ctx.fillStyle = rgb(elementColor(accent, pass.tone, seed, DEVICE_INDEX + index));
    // The carve offset is a fixed number of frame pixels, so it is applied
    // before the fit — inside it a one-pixel chamfer would be stretched into a
    // three-pixel one on a wide plaque and the light would come from two
    // directions at once.
    ctx.translate(centreX + pass.offset, centreY + pass.offset);
    ctx.scale(halfWidth, halfHeight);
    trace(ctx, halfWidth / halfHeight);
    // Filled before the restore, because the fill style was set inside it: a
    // path built under a transform already carries frame-space points, but a
    // colour set inside a save does not outlive it.
    ctx.fill();
    ctx.restore();
  }
}

function traceCircle(
  ctx: NodeCtx,
  x: number,
  y: number,
  radius: number,
  anticlockwise = false,
): void {
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, Math.max(Number.MIN_VALUE, radius), 0, TWO_PI, anticlockwise);
  ctx.closePath();
}

function traceRect(ctx: NodeCtx, x: number, y: number, width: number, height: number): void {
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();
}

/**
 * Two swords crossed point-up, each with a guard, a grip and a pommel.
 *
 * The guards are what separate a pair of blades from a painted X, and they are
 * the first thing to go in the downsample, so they are drawn heavy.
 */
const SWORD_LEAN_RADIANS = 0.62;
/**
 * Where along each blade the two swords cross, measured from the point.
 *
 * Crossed at the hilts the two guards land on top of each other and the device
 * is a bowtie; crossed at mid-blade they sit well apart on the two lower arms,
 * which is the only place a reader can find them.
 */
const SWORD_CROSSING_Y = 0.52;

function traceCrossedWeapons(ctx: NodeCtx): void {
  ctx.beginPath();
  for (const lean of [-SWORD_LEAN_RADIANS, SWORD_LEAN_RADIANS]) {
    ctx.save();
    ctx.rotate(lean);
    traceSword(ctx);
    ctx.restore();
  }
}

/** One sword pointing up its own axis, its crossing point at the origin. */
function traceSword(ctx: NodeCtx): void {
  const TIP_Y = -1.14;
  const SHOULDER_Y = -0.82;
  const BLADE_HALF_WIDTH = 0.09;
  const GUARD_HALF_WIDTH = 0.44;
  const GUARD_HEIGHT = 0.17;
  const GRIP_HALF_WIDTH = 0.08;
  const GRIP_BOTTOM = 0.94;
  const POMMEL_RADIUS = 0.15;
  const guardTop = SWORD_CROSSING_Y;

  ctx.moveTo(0, TIP_Y);
  ctx.lineTo(BLADE_HALF_WIDTH, SHOULDER_Y);
  ctx.lineTo(BLADE_HALF_WIDTH, guardTop);
  ctx.lineTo(-BLADE_HALF_WIDTH, guardTop);
  ctx.lineTo(-BLADE_HALF_WIDTH, SHOULDER_Y);
  ctx.closePath();

  traceRect(ctx, -GUARD_HALF_WIDTH, guardTop, GUARD_HALF_WIDTH * 2, GUARD_HEIGHT);
  traceRect(
    ctx,
    -GRIP_HALF_WIDTH,
    guardTop + GUARD_HEIGHT,
    GRIP_HALF_WIDTH * 2,
    GRIP_BOTTOM - guardTop - GUARD_HEIGHT,
  );
  traceCircle(ctx, 0, GRIP_BOTTOM + POMMEL_RADIUS * 0.6, POMMEL_RADIUS);
}

const SUN_RAY_COUNT = 12;
const SUN_DISC_FRACTION = 0.46;
const SUN_RAY_HALF_ANGLE = (Math.PI / SUN_RAY_COUNT) * 0.5;

/** A rayed disc. The rays are wedges, not lines: a stroke has no face to light. */
function traceSunDisc(ctx: NodeCtx): void {
  ctx.beginPath();
  for (let ray = 0; ray < SUN_RAY_COUNT; ray++) {
    const angle = (ray / SUN_RAY_COUNT) * TWO_PI;
    ctx.moveTo(
      Math.cos(angle - SUN_RAY_HALF_ANGLE) * SUN_DISC_FRACTION,
      Math.sin(angle - SUN_RAY_HALF_ANGLE) * SUN_DISC_FRACTION,
    );
    ctx.lineTo(Math.cos(angle), Math.sin(angle));
    ctx.lineTo(
      Math.cos(angle + SUN_RAY_HALF_ANGLE) * SUN_DISC_FRACTION,
      Math.sin(angle + SUN_RAY_HALF_ANGLE) * SUN_DISC_FRACTION,
    );
    ctx.closePath();
  }
  traceCircle(ctx, 0, 0, SUN_DISC_FRACTION);
}

/** A footed bowl with the pestle standing in it, leaned out to the right. */
function traceMortarAndPestle(ctx: NodeCtx): void {
  const RIM_HALF_WIDTH = 0.6;
  const RIM_TOP = 0.0;
  const RIM_HEIGHT = 0.17;
  const BOWL_BOTTOM = 0.7;
  const BOWL_BASE_HALF_WIDTH = 0.3;
  const FOOT_HALF_WIDTH = 0.44;
  const FOOT_HEIGHT = 0.2;
  const PESTLE_HALF_WIDTH = 0.1;
  const PESTLE_LEAN_RADIANS = 0.44;
  const PESTLE_LENGTH = 1.1;
  const PESTLE_HEAD_RADIUS = 0.17;

  ctx.beginPath();
  traceRect(ctx, -RIM_HALF_WIDTH, RIM_TOP, RIM_HALF_WIDTH * 2, RIM_HEIGHT);
  ctx.moveTo(-RIM_HALF_WIDTH, RIM_TOP + RIM_HEIGHT);
  ctx.lineTo(RIM_HALF_WIDTH, RIM_TOP + RIM_HEIGHT);
  ctx.lineTo(BOWL_BASE_HALF_WIDTH, BOWL_BOTTOM);
  ctx.lineTo(-BOWL_BASE_HALF_WIDTH, BOWL_BOTTOM);
  ctx.closePath();
  traceRect(ctx, -FOOT_HALF_WIDTH, BOWL_BOTTOM, FOOT_HALF_WIDTH * 2, FOOT_HEIGHT);

  // The pestle leaning out of the bowl is the half of this device that is not a
  // pot; stood upright it would read as a spoon in a cup.
  ctx.save();
  ctx.translate(0, RIM_TOP);
  ctx.rotate(PESTLE_LEAN_RADIANS);
  traceRect(ctx, -PESTLE_HALF_WIDTH, -PESTLE_LENGTH, PESTLE_HALF_WIDTH * 2, PESTLE_LENGTH);
  traceCircle(ctx, 0, -PESTLE_LENGTH + PESTLE_HEAD_RADIUS * 0.6, PESTLE_HEAD_RADIUS);
  ctx.restore();
}

/** A drinking horn: a banded mouth at the left tapering to a point down-right. */
function traceHorn(ctx: NodeCtx): void {
  const MOUTH_X = -0.72;
  const MOUTH_TOP = -0.86;
  const MOUTH_BOTTOM = 0.16;
  const TIP_X = 0.92;
  const BORE_RADIUS_X = 0.12;
  const BAND_X = -0.16;
  const BAND_WIDTH = 0.18;

  ctx.beginPath();
  ctx.moveTo(MOUTH_X, MOUTH_TOP);
  ctx.bezierCurveTo(0.36, -1.0, 0.94, -0.14, TIP_X, 0.92);
  ctx.bezierCurveTo(0.5, 0.2, 0.06, 0.06, MOUTH_X, MOUTH_BOTTOM);
  ctx.closePath();
  // The bore, wound the other way. A hole in a carving is exactly a reversed
  // subpath, and an opening is what makes this a vessel rather than a tusk — but
  // only where nothing else in the path overlaps it, since two windings of the
  // same sign would fill the hole back in.
  ctx.moveTo(MOUTH_X + BORE_RADIUS_X, (MOUTH_TOP + MOUTH_BOTTOM) / 2);
  ctx.ellipse(
    MOUTH_X,
    (MOUTH_TOP + MOUTH_BOTTOM) / 2,
    BORE_RADIUS_X,
    (MOUTH_BOTTOM - MOUTH_TOP) * 0.34,
    0,
    0,
    TWO_PI,
    true,
  );
  ctx.closePath();
  // A mounted band clear of the mouth, so the taper reads as banded horn.
  traceRect(ctx, BAND_X, -0.62, BAND_WIDTH, 0.72);
}

const WHEAT_STALK_COUNT = 5;

/** A sheaf: stalks fanned from a bound waist, each ending in an ear of grain. */
function traceWheatSheaf(ctx: NodeCtx): void {
  const FAN_HALF_ANGLE = 0.58;
  const WAIST_Y = 0.42;
  const STALK_HALF_WIDTH = 0.05;
  const STALK_LENGTH = 1.34;
  const EAR_HALF_WIDTH = 0.17;
  const EAR_LENGTH = 0.62;
  const BUTT_LENGTH = 0.52;
  const BAND_HALF_WIDTH = 0.26;
  const BAND_HEIGHT = 0.22;

  ctx.beginPath();
  for (let stalk = 0; stalk < WHEAT_STALK_COUNT; stalk++) {
    const lean = ((stalk / (WHEAT_STALK_COUNT - 1)) * 2 - 1) * FAN_HALF_ANGLE;
    ctx.save();
    ctx.translate(0, WAIST_Y);
    ctx.rotate(lean);
    traceRect(ctx, -STALK_HALF_WIDTH, -STALK_LENGTH, STALK_HALF_WIDTH * 2, STALK_LENGTH);
    // The ear is a lozenge rather than an ellipse: the flat shoulders are what
    // survive the downsample as grain rather than as a berry.
    ctx.moveTo(0, -STALK_LENGTH);
    ctx.lineTo(EAR_HALF_WIDTH, -STALK_LENGTH + EAR_LENGTH * 0.34);
    ctx.lineTo(0, -STALK_LENGTH + EAR_LENGTH);
    ctx.lineTo(-EAR_HALF_WIDTH, -STALK_LENGTH + EAR_LENGTH * 0.34);
    ctx.closePath();
    // The cut butts continue past the band, which is what makes the waist a
    // binding rather than a hinge.
    traceRect(ctx, -STALK_HALF_WIDTH, 0, STALK_HALF_WIDTH * 2, BUTT_LENGTH);
    ctx.restore();
  }
  traceRect(ctx, -BAND_HALF_WIDTH, WAIST_Y - BAND_HEIGHT * 0.4, BAND_HALF_WIDTH * 2, BAND_HEIGHT);
}

/** A lidded tankard: tapered body, foot ring, and a C handle on the right. */
function traceTankard(ctx: NodeCtx): void {
  const TOP = -0.5;
  const BOTTOM = 0.72;
  const TOP_HALF_WIDTH = 0.34;
  const BASE_HALF_WIDTH = 0.42;
  const LID_HALF_WIDTH = 0.46;
  const LID_HEIGHT = 0.24;
  const FOOT_OVERHANG = 0.06;
  const FOOT_HEIGHT = 0.2;
  const HANDLE_REACH = 0.62;
  const HANDLE_THICKNESS = 0.18;

  ctx.beginPath();
  ctx.moveTo(-TOP_HALF_WIDTH, TOP);
  ctx.lineTo(TOP_HALF_WIDTH, TOP);
  ctx.lineTo(BASE_HALF_WIDTH, BOTTOM);
  ctx.lineTo(-BASE_HALF_WIDTH, BOTTOM);
  ctx.closePath();
  traceRect(ctx, -LID_HALF_WIDTH, TOP - LID_HEIGHT, LID_HALF_WIDTH * 2, LID_HEIGHT);
  traceRect(
    ctx,
    -(BASE_HALF_WIDTH + FOOT_OVERHANG),
    BOTTOM,
    (BASE_HALF_WIDTH + FOOT_OVERHANG) * 2,
    FOOT_HEIGHT,
  );

  const handleTop = TOP + 0.16;
  const handleBottom = BOTTOM - 0.2;
  ctx.moveTo(TOP_HALF_WIDTH, handleTop);
  ctx.bezierCurveTo(
    TOP_HALF_WIDTH + HANDLE_REACH,
    handleTop,
    TOP_HALF_WIDTH + HANDLE_REACH,
    handleBottom,
    TOP_HALF_WIDTH,
    handleBottom,
  );
  ctx.lineTo(TOP_HALF_WIDTH, handleBottom - HANDLE_THICKNESS);
  ctx.bezierCurveTo(
    TOP_HALF_WIDTH + HANDLE_REACH - HANDLE_THICKNESS,
    handleBottom - HANDLE_THICKNESS,
    TOP_HALF_WIDTH + HANDLE_REACH - HANDLE_THICKNESS,
    handleTop + HANDLE_THICKNESS,
    TOP_HALF_WIDTH,
    handleTop + HANDLE_THICKNESS,
  );
  ctx.closePath();
}

/** Two crossed spokes — four arms. Any more close into a rosette at this size. */
const WHEEL_DEVICE_SPOKE_COUNT = 2;

/** A cartwheel: a rim with a hole in it, four spoke arms and a hub. */
function traceWheel(ctx: NodeCtx, aspect: number): void {
  const RIM_FRACTION = 0.32;
  const HUB_RADIUS = 0.26;
  const SPOKE_HALF_WIDTH = 0.13;
  ctx.save();
  // Undone, because a wheel is the one device whose whole identity is a circle.
  ctx.scale(1 / aspect, 1);
  ctx.beginPath();
  traceCircle(ctx, 0, 0, 1);
  // Wound the other way, so the nonzero fill leaves a rim and not a disc.
  traceCircle(ctx, 0, 0, 1 - RIM_FRACTION, true);
  for (let spoke = 0; spoke < WHEEL_DEVICE_SPOKE_COUNT; spoke++) {
    const angle = (spoke / WHEEL_DEVICE_SPOKE_COUNT) * Math.PI;
    ctx.save();
    ctx.rotate(angle);
    traceRect(ctx, -SPOKE_HALF_WIDTH, -1, SPOKE_HALF_WIDTH * 2, 2);
    ctx.restore();
  }
  traceCircle(ctx, 0, 0, HUB_RADIUS);
  ctx.restore();
}

// ── hand-painted lettering ─────────────────────────────────────────────────

/**
 * A stroke in a letter's unit box: x0, y0, x1, y1, with y growing downward.
 *
 * The alphabet is data rather than a font because a system typeface would be the
 * one machine-made thing on a building whose every stone was placed by a loop
 * that jitters — a signwriter's capitals on a plank next to hand-laid rubble is
 * the join a reader notices first.
 */
type LetterStroke = readonly [number, number, number, number];

const LETTER_STROKES: Readonly<Record<string, ReadonlyArray<LetterStroke>>> = {
  ' ': [],
  A: [
    [0, 1, 0.5, 0],
    [0.5, 0, 1, 1],
    [0.16, 0.68, 0.84, 0.68],
  ],
  B: [
    [0, 0, 0, 1],
    [0, 0, 0.75, 0],
    [0, 0.5, 0.75, 0.5],
    [0, 1, 0.75, 1],
    [0.75, 0, 0.75, 0.5],
    [0.75, 0.5, 0.75, 1],
  ],
  C: [
    [1, 0, 0, 0],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
  ],
  D: [
    [0, 0, 0, 1],
    [0, 0, 0.68, 0.16],
    [0.68, 0.16, 1, 0.5],
    [1, 0.5, 0.68, 0.84],
    [0.68, 0.84, 0, 1],
  ],
  E: [
    [0, 0, 0, 1],
    [0, 0, 0.9, 0],
    [0, 0.5, 0.7, 0.5],
    [0, 1, 0.9, 1],
  ],
  F: [
    [0, 0, 0, 1],
    [0, 0, 0.9, 0],
    [0, 0.5, 0.7, 0.5],
  ],
  G: [
    [1, 0, 0, 0],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
    [1, 1, 1, 0.55],
    [1, 0.55, 0.5, 0.55],
  ],
  H: [
    [0, 0, 0, 1],
    [1, 0, 1, 1],
    [0, 0.5, 1, 0.5],
  ],
  I: [
    [0.5, 0, 0.5, 1],
    [0.16, 0, 0.84, 0],
    [0.16, 1, 0.84, 1],
  ],
  J: [
    [0.85, 0, 0.85, 0.8],
    [0.85, 0.8, 0.45, 1],
    [0.45, 1, 0.08, 0.76],
  ],
  K: [
    [0, 0, 0, 1],
    [1, 0, 0, 0.5],
    [0, 0.5, 1, 1],
  ],
  L: [
    [0, 0, 0, 1],
    [0, 1, 0.9, 1],
  ],
  M: [
    [0, 1, 0, 0],
    [0, 0, 0.5, 0.62],
    [0.5, 0.62, 1, 0],
    [1, 0, 1, 1],
  ],
  N: [
    [0, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 1, 1, 0],
  ],
  O: [
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 1, 0, 1],
    [0, 1, 0, 0],
  ],
  P: [
    [0, 1, 0, 0],
    [0, 0, 0.85, 0],
    [0.85, 0, 0.85, 0.5],
    [0.85, 0.5, 0, 0.5],
  ],
  Q: [
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 1, 0, 1],
    [0, 1, 0, 0],
    [0.6, 0.68, 1.06, 1.12],
  ],
  R: [
    [0, 1, 0, 0],
    [0, 0, 0.85, 0],
    [0.85, 0, 0.85, 0.5],
    [0.85, 0.5, 0, 0.5],
    [0.4, 0.5, 1, 1],
  ],
  S: [
    [1, 0, 0.16, 0],
    [0.16, 0, 0, 0.45],
    [0, 0.45, 1, 0.55],
    [1, 0.55, 0.85, 1],
    [0.85, 1, 0, 1],
  ],
  T: [
    [0, 0, 1, 0],
    [0.5, 0, 0.5, 1],
  ],
  U: [
    [0, 0, 0, 0.8],
    [0, 0.8, 0.5, 1],
    [0.5, 1, 1, 0.8],
    [1, 0.8, 1, 0],
  ],
  V: [
    [0, 0, 0.5, 1],
    [0.5, 1, 1, 0],
  ],
  W: [
    [0, 0, 0.2, 1],
    [0.2, 1, 0.5, 0.36],
    [0.5, 0.36, 0.8, 1],
    [0.8, 1, 1, 0],
  ],
  X: [
    [0, 0, 1, 1],
    [1, 0, 0, 1],
  ],
  Y: [
    [0, 0, 0.5, 0.5],
    [1, 0, 0.5, 0.5],
    [0.5, 0.5, 0.5, 1],
  ],
  Z: [
    [0, 0, 1, 0],
    [1, 0, 0, 1],
    [0, 1, 1, 1],
  ],
  "'": [[0.5, 0, 0.42, 0.28]],
  '.': [[0.5, 0.95, 0.5, 1]],
  '-': [[0.1, 0.5, 0.9, 0.5]],
  '&': [
    [1, 1, 0.15, 0.28],
    [0.15, 0.28, 0.55, 0],
    [0.55, 0, 0.62, 0.35],
    [0.62, 0.35, 0, 0.72],
    [0, 0.72, 0.45, 1],
    [0.45, 1, 0.9, 0.6],
  ],
};

const BOARD_PADDING_FRACTION = 0.14;
const LETTER_ASPECT = 0.62;
const LETTER_GAP_FRACTION = 0.3;
const LETTER_STROKE_FRACTION = 0.16;
const LETTER_WOBBLE_FRACTION = 0.05;
const LETTER_SHADOW_OFFSET_PX = 1;

/** A painted signboard fixed flat on the wall, carrying the prop's label. */
function paintLetterBoard(draw: PropDraw): void {
  const { ctx, box, body, accent, seed } = draw;
  const BOARD_INDEX = 0;
  paintLitBlock(
    ctx,
    { x: box.left, y: box.top, width: box.width, height: box.height },
    body,
    TONE_BODY,
    seed,
    BOARD_INDEX,
  );
  paintEdgeLight(
    ctx,
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    elementColor(body, TONE_HIGHLIGHT, seed, BOARD_INDEX + 1),
    1,
    BLOCK_LIT_ALPHA,
  );

  const label = (draw.prop.label ?? '').toUpperCase();
  if (label.length === 0) return;

  const padding = Math.min(box.width, box.height) * BOARD_PADDING_FRACTION;
  const availableWidth = box.width - padding * 2;
  const availableHeight = box.height - padding * 2;
  // The board's height caps the letters as hard as its width does: a long name
  // on a tall board must not paint capitals taller than the plank they sit on.
  const widthPerLetter = availableWidth / (label.length * (1 + LETTER_GAP_FRACTION));
  const letterHeight = Math.min(availableHeight, widthPerLetter / LETTER_ASPECT);
  const letterWidth = letterHeight * LETTER_ASPECT;
  const advance = letterWidth * (1 + LETTER_GAP_FRACTION);
  const textWidth = advance * label.length - letterWidth * LETTER_GAP_FRACTION;
  const startX = box.centreX - textWidth / 2;
  const startY = box.top + (box.height - letterHeight) / 2;

  for (let index = 0; index < label.length; index++) {
    paintLetter(
      draw,
      label.charAt(index),
      startX + advance * index,
      startY,
      letterWidth,
      letterHeight,
      index,
    );
  }

  // The board's own value under the paint, restated as an edge on the frame, so
  // lettering does not float off a plank that has no thickness.
  paintEdgeLight(
    ctx,
    { x: box.left, y: box.baseY },
    { x: box.right, y: box.baseY },
    elementColor(accent, TONE_DEEP, seed, BOARD_INDEX + 2),
    1,
    BLOCK_SHADOW_ALPHA,
  );
}

/**
 * One capital, stroked in its unit box.
 *
 * Each letter leans and shifts a hair on its own index, which is the difference
 * between a signwriter and a stencil.
 */
function paintLetter(
  draw: PropDraw,
  character: string,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number,
): void {
  const strokes = LETTER_STROKES[character];
  if (strokes === undefined || strokes.length === 0) return;
  const { ctx, accent, seed } = draw;
  const strokeWidth = Math.max(1, height * LETTER_STROKE_FRACTION);
  const wobbleX =
    (elementValue(seed, STREAM_WOBBLE, index) - 0.5) * 2 * width * LETTER_WOBBLE_FRACTION;
  const wobbleY =
    (elementValue(seed, STREAM_VARIANT, index) - 0.5) * 2 * height * LETTER_WOBBLE_FRACTION;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;

  // Painted twice: a dark ghost down-right, then the paint itself. Two passes at
  // one pixel of offset is what keeps lettering legible once the frame is
  // sampled down past the stroke's own width.
  const passes: ReadonlyArray<{
    readonly offset: number;
    readonly color: RGB;
    readonly alpha: number;
  }> = [
    {
      offset: LETTER_SHADOW_OFFSET_PX,
      color: sampleRamp(getRamp('ink_outline'), TONE_SHADOW),
      alpha: BLOCK_SHADOW_ALPHA,
    },
    { offset: 0, color: elementColor(accent, TONE_HIGHLIGHT, seed, index), alpha: 1 },
  ];

  for (const pass of passes) {
    ctx.strokeStyle = rgba(pass.color, pass.alpha);
    ctx.beginPath();
    for (const stroke of strokes) {
      ctx.moveTo(
        x + wobbleX + pass.offset + stroke[0] * width,
        y + wobbleY + pass.offset + stroke[1] * height,
      );
      ctx.lineTo(
        x + wobbleX + pass.offset + stroke[2] * width,
        y + wobbleY + pass.offset + stroke[3] * height,
      );
    }
    ctx.stroke();
  }
  ctx.restore();
}
