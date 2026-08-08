/**
 * The doorway: the one opening a player actually walks through.
 *
 * A door is the first thing a reader's eye lands on and the only feature whose
 * painted position is load-bearing — the blocked base course is emitted with a
 * gap at exactly `[door.col, door.col + door.gapTiles)`, and the opening is
 * painted centred on that gap so ink never drifts to one side of the slot the
 * player walks through. The painted opening may be *wider* than the gap: the
 * tiles either side are blocked whatever the art does, which is what lets a
 * grand double door read twice as wide as the way through it.
 *
 * Everything here is painted in **facade-plane** coordinates, which are inset
 * from frame space by the roof's overhang. Tile columns come through
 * `tileColumnToPlaneX` and frame-space heights through `planeY` for that reason;
 * a `col * scale` anywhere in this file is a bug, not a shortcut.
 *
 * The order of the passes is the order a mason and a joiner worked in: the hole
 * is cut and shadowed, the reveal darkens what is left of the wall inside it,
 * the leaf is hung in the hole, the head is built over it, the ironwork goes on
 * last and the step is laid at the foot. Painting the leaf before the recess is
 * what makes a door read as a picture glued to a wall.
 */

import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import type { NoiseField } from '../../tilegen/noise.js';
import { paintEdgeAo, paintEdgeLight, paintRecessAo, paintStructuralLine } from '../lighting.js';
import {
  ELEMENT_BOTTOM_SHADOW,
  ELEMENT_EDGE_PX,
  ELEMENT_HUE_JITTER,
  ELEMENT_TONE_JITTER,
  ELEMENT_TOP_LIGHT,
  JOINT_STRENGTH,
  JOINT_WANDER_PERIOD,
  JOINT_WANDER_PX,
  elementValue,
} from '../materials/kit.js';
import type { Plane, Projection } from '../projection.js';
import { tileColumnToPlaneX } from '../projection.js';
import {
  LIGHT_DIR_X,
  LIGHT_DIR_Y,
  getRamp,
  hueShift,
  rgb,
  rgba,
  sampleRamp,
  type Ramp,
} from '../ramps.js';
import type { BuildingSpec, DoorArch, DoorSpec, DoorStyle } from '../spec.js';
import { jointWander, planeNoise } from '../texture.js';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Keeps the door's own randomness clear of the wall's, which shares `spec.seed`. */
const DOOR_SEED_OFFSET = 4801;

/** Streams, so two properties of one plank never share a number. */
const STREAM_PLANK_TONE = 1;
const STREAM_PLANK_HUE = 2;
const STREAM_GRAIN = 3;
const STREAM_VOUSSOIR = 4;
const STREAM_HARDWARE = 5;
const STREAM_STEP = 6;

/**
 * A doorway is sized against the wall it is cut into, then clamped into the
 * range a person can walk through without ducking. Deriving it from the plane
 * alone gives a two-story building a comically tall front door.
 */
const DOOR_HEIGHT_PLANE_FRACTION = 0.52;
const DOOR_HEIGHT_MIN_TILES = 1.35;
const DOOR_HEIGHT_MAX_TILES = 1.68;

/** Wall that must survive between the door's head and the eaves. */
const DOOR_HEADROOM_PX = 6;

/** Below this the opening is a smear rather than a door, so nothing is painted. */
const MIN_PAINTABLE_PX = 8;

/** Depth of the occlusion inside the opening, and the reveal left around the leaf. */
const RECESS_DEPTH = 0.62;
const REVEAL_PX = 2;
const REVEAL_ALPHA = 0.72;
/** How dark the unlit interior behind an open head or a curtain sits on the ink ramp. */
const INTERIOR_RAMP_T = 0.08;

/** Boarding: nominal plank width, and the floor below which planks stop dividing. */
const PLANK_NOMINAL_PX = 11;
const PLANK_MIN_PX = 5;
const PLANK_GAP_PX = 1;
const PLANK_GRAIN_STREAKS = 3;
const PLANK_GRAIN_ALPHA = 0.18;
const PLANK_GRAIN_TONE_DROP = 0.22;
const GRAIN_WANDER_PX = 1.6;
const GRAIN_WANDER_PERIOD = 9;
const PLANK_EDGE_LIGHT_ALPHA = 0.6;
const PLANK_EDGE_SHADOW_ALPHA = 0.55;

/** The stile two leaves meet on, and the frame a grand door is hung in. */
const MEETING_STILE_PX = 3;
const GRAND_FRAME_PX = 5;
const GRAND_PANELS_PER_LEAF = 2;
const GRAND_PANEL_INSET_PX = 5;
const GRAND_PANEL_GAP_PX = 4;
const PANEL_TONE_LIFT = 0.16;
const PANEL_EDGE_ALPHA = 0.55;
const PANEL_EDGE_WIDTH_PX = 1.2;

/** Timber lintel over a flat-headed door. */
const LINTEL_HEIGHT_PX = 8;
const LINTEL_OVERHANG_PX = 5;
const LINTEL_TONE = 0.52;
const LINTEL_LIGHT_ALPHA = 0.55;
const LINTEL_LIGHT_WIDTH_PX = 1.5;

/** Arched heads. An equilateral gothic arch rises by this fraction of its span. */
const ROUND_ARCH_RISE_FRACTION = 0.5;
const GOTHIC_ARCH_RISE_FRACTION = 0.866;
const GOTHIC_ARC_SWEEP = Math.PI / 3;
const VOUSSOIR_COUNT = 9;
const VOUSSOIR_DEPTH_PX = 9;
const VOUSSOIR_ARC_SEGMENTS = 4;
const VOUSSOIR_BASE_TONE = 0.5;
const VOUSSOIR_LIGHT_RANGE = 0.3;
const VOUSSOIR_JOINT_ALPHA = 0.5;

/** Ironmongery. */
const HINGE_STRAP_HEIGHT_PX = 4;
const HINGE_STRAP_LENGTH_FRACTION = 0.66;
const HINGE_UPPER_FRACTION = 0.22;
const HINGE_LOWER_FRACTION = 0.76;
const HINGE_STUD_RADIUS_PX = 1.1;
const HINGE_STUD_SPACING_PX = 8;
const HINGE_STUD_TONE = 0.72;
const IRON_TONE = 0.26;
const IRON_HIGHLIGHT_TONE = 0.78;
const IRON_HIGHLIGHT_ALPHA = 0.5;
const HANDLE_HEIGHT_FRACTION = 0.52;
const HANDLE_INSET_PX = 6;
const HANDLE_RING_RADIUS_PX = 4;
const HANDLE_RING_WIDTH_PX = 1.4;
const LATCH_WIDTH_PX = 7;
const LATCH_HEIGHT_PX = 3;
const RING_HANDLE_CHANCE = 0.5;

/** Threshold and the well a below-grade door sits in. */
const THRESHOLD_MIN_PX = 4;
const STEP_OVERHANG_PX = 4;
const STEP_COURSE_PX = 6;
const STEP_TONE = 0.54;
const STEP_TONE_JITTER = 0.18;
const STEP_LIGHT_ALPHA = 0.6;
const STEP_LIGHT_WIDTH_PX = 1.2;
const WELL_DARKEN_ALPHA = 0.82;
const WELL_NOSING_COUNT = 3;
const WELL_NOSING_ALPHA = 0.3;
/** Each descending nosing shows less of itself than the one above it. */
const WELL_NOSING_FORESHORTEN = 0.68;
const WELL_AO_DEPTH = 0.85;
const WELL_AO_REACH_FRACTION = 0.6;

/** The shadow the head drops onto the leaf, which is what states the leaf is set back. */
const HEAD_SHADOW_DEPTH = 0.68;
const HEAD_SHADOW_REACH_FRACTION = 0.24;

/** Signet's bead curtain, hung where a leaf would otherwise be. */
const BEAD_STRING_SPACING_PX = 6;
const BEAD_SPACING_PX = 5;
const BEAD_RADIUS_PX = 1.7;
const BEAD_SWAY_PX = 1.4;
const BEAD_SWAY_PERIOD = 11;
const BEAD_TONE_JITTER = 0.3;
const BEAD_GLINT_ALPHA = 0.55;
const BEAD_GLINT_TONE = 0.95;

export function paintDoor(plane: Plane, projection: Projection, spec: BuildingSpec): void {
  const door = spec.door;
  const ctx = plane.ctx;
  const scale = projection.scale;
  const noise = planeNoise(plane);
  const seed = spec.seed + DOOR_SEED_OFFSET;
  const ramp = getRamp(door.ramp);

  const baseY = planeY(plane, projection, projection.facadeBaseY);
  const stepPx = door.stepTiles * scale;
  const raisedPx = Math.max(0, stepPx);
  const sunkenPx = Math.max(0, -stepPx);
  const leafBottomY = Math.min(plane.height, Math.max(0, baseY - raisedPx));

  const nominalHeight = clamp(
    plane.height * DOOR_HEIGHT_PLANE_FRACTION,
    DOOR_HEIGHT_MIN_TILES * scale,
    DOOR_HEIGHT_MAX_TILES * scale,
  );
  const width = door.paintedWidthTiles * scale;
  // An arched head is built on top of the opening, so it comes out of the same
  // headroom budget. Left out, a gothic head on a wide door springs straight
  // through the eaves and is painted over by the roof.
  const height = Math.min(
    nominalHeight,
    leafBottomY - DOOR_HEADROOM_PX - headRise(door.arch, width),
  );
  if (height < MIN_PAINTABLE_PX || width < MIN_PAINTABLE_PX) return;

  const gapCentreX = tileColumnToPlaneX(projection, door.col + door.gapTiles / 2);
  const opening: Rect = {
    x: gapCentreX - width / 2,
    y: leafBottomY - height,
    width,
    height,
  };

  paintRecessAo(ctx, opening, RECESS_DEPTH);
  paintHeadInterior(ctx, opening, door.arch);
  paintReveal(ctx, opening, ramp);

  const leaf: Rect = {
    x: opening.x + REVEAL_PX,
    y: opening.y + REVEAL_PX,
    width: opening.width - REVEAL_PX * 2,
    height: opening.height - REVEAL_PX,
  };
  if (leaf.width < MIN_PAINTABLE_PX || leaf.height < MIN_PAINTABLE_PX) return;

  paintLeaves(ctx, noise, seed, leaf, ramp, spec);
  paintArch(ctx, seed, opening, door.arch);
  if (door.hardware) paintHardware(ctx, seed, leaf, door);
  paintThreshold(ctx, seed, opening, baseY, leafBottomY, sunkenPx);

  paintEdgeAo(ctx, leaf, 'top', {
    depth: HEAD_SHADOW_DEPTH,
    reach: leaf.height * HEAD_SHADOW_REACH_FRACTION,
  });
}

/**
 * Facade-plane Y of a frame-space Y.
 *
 * The facade plane's own vertical span covers `eavesY .. facadeBaseY`, and it is
 * not the same number of pixels as that frame-space distance once a building
 * leans — so anything positioned from the projection converts here rather than
 * subtracting `eavesY` and hoping.
 */
function planeY(plane: Plane, projection: Projection, frameY: number): number {
  const facadeSpan = projection.facadeBaseY - projection.eavesY;
  if (facadeSpan <= 0) return plane.height;
  return ((frameY - projection.eavesY) / facadeSpan) * plane.height;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Rise of an arched head above the opening's top edge, in plane pixels. */
function headRise(arch: DoorArch, span: number): number {
  switch (arch) {
    case 'round':
      return span * ROUND_ARCH_RISE_FRACTION;
    case 'gothic':
      return span * GOTHIC_ARCH_RISE_FRACTION;
    case 'flat_lintel':
    case 'none':
      return 0;
  }
}

/**
 * The opening's silhouette, arched head included.
 *
 * Used both to fill the dark interior behind an arch and to clip a leaf whose
 * own head follows it, which is the only way the two agree to the pixel.
 */
function openingPath(ctx: NodeCtx, rect: Rect, arch: DoorArch): void {
  const bottom = rect.y + rect.height;
  const rise = headRise(arch, rect.width);
  ctx.beginPath();
  if (rise <= 0) {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const springY = rect.y;
  ctx.moveTo(rect.x, bottom);
  ctx.lineTo(rect.x, springY);
  if (arch === 'gothic') {
    // Equilateral: each half is struck from the opposite springing point, which
    // is what gives the apex its corner instead of a rounded-off point.
    ctx.arc(rect.x + rect.width, springY, rect.width, Math.PI, Math.PI + GOTHIC_ARC_SWEEP, false);
    ctx.arc(rect.x, springY, rect.width, -GOTHIC_ARC_SWEEP, 0, false);
  } else {
    ctx.arc(rect.x + rect.width / 2, springY, rect.width / 2, Math.PI, 0, false);
  }
  ctx.lineTo(rect.x + rect.width, bottom);
  ctx.closePath();
}

/**
 * The dark tympanum an arched head leaves above a flat-topped leaf.
 *
 * Without it a round head over a plank door is a stone rainbow painted on solid
 * wall, because the arch's own soffit has nothing behind it.
 */
function paintHeadInterior(ctx: NodeCtx, opening: Rect, arch: DoorArch): void {
  if (headRise(arch, opening.width) <= 0) return;
  ctx.save();
  openingPath(ctx, opening, arch);
  ctx.fillStyle = rgb(sampleRamp(getRamp('ink_outline'), INTERIOR_RAMP_T));
  ctx.fill();
  ctx.restore();
}

/** The sliver of wall left inside the opening once the leaf is hung in it. */
function paintReveal(ctx: NodeCtx, opening: Rect, ramp: Ramp): void {
  ctx.save();
  ctx.fillStyle = rgba(sampleRamp(ramp, 0), REVEAL_ALPHA);
  ctx.fillRect(opening.x, opening.y, opening.width, opening.height);
  ctx.restore();
}

function paintLeaves(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  leaf: Rect,
  ramp: Ramp,
  spec: BuildingSpec,
): void {
  // The leaf takes its head from the arch built over it whenever there is one,
  // whatever the style says. A flat-topped leaf under a round head leaves a
  // tympanum half the doorway's width tall, and at in-game scale that dead
  // black semicircle is bigger and louder than the door itself.
  const style = spec.door.style;
  const leafArch = leafHeadArch(spec.door.arch, style);
  const rise = headRise(leafArch, leaf.width);

  // The clip is the head's shape; the boards must be laid over the ground the
  // head covers as well, or the arch is a black hole with a door under it.
  const boards: Rect =
    rise <= 0
      ? leaf
      : { x: leaf.x, y: leaf.y - rise, width: leaf.width, height: leaf.height + rise };

  ctx.save();
  if (rise > 0) {
    openingPath(ctx, leaf, leafArch);
    ctx.clip();
  }
  if (style === 'curtained') paintBeadCurtain(ctx, noise, seed, boards, ramp);
  else paintLeafBoards(ctx, noise, seed, boards, ramp, style);
  ctx.restore();
}

/** The head a leaf is cut to: the built arch if it has a rise, else the style's own. */
function leafHeadArch(arch: DoorArch, style: DoorStyle): DoorArch {
  if (arch === 'round' || arch === 'gothic') return arch;
  if (style === 'gothic') return 'gothic';
  if (style === 'arched') return 'round';
  return 'none';
}

function paintLeafBoards(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  leaf: Rect,
  ramp: Ramp,
  style: DoorStyle,
): void {
  if (style === 'double' || style === 'grand') {
    const frame = style === 'grand' ? GRAND_FRAME_PX : 0;
    const inner: Rect = {
      x: leaf.x + frame,
      y: leaf.y + frame,
      width: leaf.width - frame * 2,
      height: leaf.height - frame,
    };
    if (frame > 0) paintGrandFrame(ctx, leaf, inner, ramp);
    const leafWidth = (inner.width - MEETING_STILE_PX) / 2;
    if (leafWidth < PLANK_MIN_PX) return;
    const left: Rect = { x: inner.x, y: inner.y, width: leafWidth, height: inner.height };
    const right: Rect = {
      x: inner.x + leafWidth + MEETING_STILE_PX,
      y: inner.y,
      width: leafWidth,
      height: inner.height,
    };
    paintPlankLeaf(ctx, noise, seed, left, ramp);
    paintPlankLeaf(ctx, noise, seed + STREAM_PLANK_TONE, right, ramp);
    if (style === 'grand') {
      paintRaisedPanels(ctx, left, ramp);
      paintRaisedPanels(ctx, right, ramp);
    }
    paintMeetingStile(ctx, inner, leafWidth, ramp);
    return;
  }

  paintPlankLeaf(ctx, noise, seed, leaf, ramp);
}

/**
 * Vertical boarding.
 *
 * The three things that separate a plank door from a striped rectangle are all
 * per-plank: its own value, its own hue, and a gap that wanders instead of
 * ruling straight down. The along-grain streaks then cross the plank's whole
 * height, which is what stops the boards reading as flat colour swatches.
 */
function paintPlankLeaf(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  leaf: Rect,
  ramp: Ramp,
): void {
  const plankCount = Math.max(1, Math.round(leaf.width / PLANK_NOMINAL_PX));
  const plankWidth = Math.max(PLANK_MIN_PX, leaf.width / plankCount);
  const bottom = leaf.y + leaf.height;

  ctx.save();
  ctx.beginPath();
  ctx.rect(leaf.x, leaf.y, leaf.width, leaf.height);
  ctx.clip();

  for (let plank = 0; plank < plankCount; plank++) {
    const tone =
      0.5 + (elementValue(seed, STREAM_PLANK_TONE, plank) - 0.5) * 2 * ELEMENT_TONE_JITTER;
    const hue = (elementValue(seed, STREAM_PLANK_HUE, plank) - 0.5) * 2 * ELEMENT_HUE_JITTER;
    const left = leaf.x + plank * plankWidth;

    ctx.fillStyle = rgb(hueShift(sampleRamp(ramp, tone), hue));
    ctx.fillRect(left, leaf.y, plankWidth, leaf.height);

    // Sun from the upper left, so a board's left arris catches it and its right
    // one loses it — one pixel each, which is all a flat fill needs to round.
    ctx.fillStyle = rgba(
      sampleRamp(ramp, Math.min(1, tone + ELEMENT_TOP_LIGHT)),
      PLANK_EDGE_LIGHT_ALPHA,
    );
    ctx.fillRect(left, leaf.y, ELEMENT_EDGE_PX, leaf.height);
    ctx.fillStyle = rgba(
      sampleRamp(ramp, Math.max(0, tone - ELEMENT_BOTTOM_SHADOW)),
      PLANK_EDGE_SHADOW_ALPHA,
    );
    ctx.fillRect(left + plankWidth - ELEMENT_EDGE_PX, leaf.y, ELEMENT_EDGE_PX, leaf.height);

    paintGrain(ctx, noise, seed, plank, left, plankWidth, leaf.y, bottom, ramp, tone);

    if (plank < plankCount - 1) {
      ctx.fillStyle = rgba(sampleRamp(ramp, 0), JOINT_STRENGTH);
      for (let y = Math.floor(leaf.y); y < bottom; y++) {
        const gapX =
          left +
          plankWidth +
          jointWander(noise, left, y, seed, JOINT_WANDER_PX, JOINT_WANDER_PERIOD);
        ctx.fillRect(gapX, y, PLANK_GAP_PX, 1);
      }
    }
  }
  ctx.restore();
}

function paintGrain(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  plank: number,
  left: number,
  plankWidth: number,
  top: number,
  bottom: number,
  ramp: Ramp,
  tone: number,
): void {
  ctx.fillStyle = rgba(
    sampleRamp(ramp, Math.max(0, tone - PLANK_GRAIN_TONE_DROP)),
    PLANK_GRAIN_ALPHA,
  );
  for (let streak = 0; streak < PLANK_GRAIN_STREAKS; streak++) {
    const index = plank * PLANK_GRAIN_STREAKS + streak;
    const originX = left + elementValue(seed, STREAM_GRAIN, index) * plankWidth;
    for (let y = Math.floor(top); y < bottom; y++) {
      const x =
        originX +
        jointWander(noise, originX, y, seed + index, GRAIN_WANDER_PX, GRAIN_WANDER_PERIOD);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** The stile two leaves close against, lit on its left arris like every other upstand. */
function paintMeetingStile(ctx: NodeCtx, inner: Rect, leafWidth: number, ramp: Ramp): void {
  const x = inner.x + leafWidth;
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, 0.5 + PANEL_TONE_LIFT)));
  ctx.fillRect(x, inner.y, MEETING_STILE_PX, inner.height);
  paintStructuralLine(
    ctx,
    { x: x + MEETING_STILE_PX, y: inner.y },
    { x: x + MEETING_STILE_PX, y: inner.y + inner.height },
  );
}

/** The heavy surround a grand door is hung in — the Desperado's whole silhouette. */
function paintGrandFrame(ctx: NodeCtx, leaf: Rect, inner: Rect, ramp: Ramp): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, Math.min(1, 0.5 + PANEL_TONE_LIFT)));
  ctx.fillRect(leaf.x, leaf.y, leaf.width, leaf.height);
  paintEdgeLight(
    ctx,
    { x: leaf.x, y: leaf.y },
    { x: leaf.x + leaf.width, y: leaf.y },
    sampleRamp(ramp, 1),
    PANEL_EDGE_WIDTH_PX,
    PANEL_EDGE_ALPHA,
  );
  paintStructuralLine(ctx, { x: inner.x, y: inner.y }, { x: inner.x + inner.width, y: inner.y });
}

/** Fielded panels: a lit top-left arris and a shadowed bottom-right one, nothing more. */
function paintRaisedPanels(ctx: NodeCtx, leafRect: Rect, ramp: Ramp): void {
  const panelWidth = leafRect.width - GRAND_PANEL_INSET_PX * 2;
  const totalGap = GRAND_PANEL_GAP_PX * (GRAND_PANELS_PER_LEAF + 1);
  const panelHeight = (leafRect.height - totalGap) / GRAND_PANELS_PER_LEAF;
  if (panelWidth < MIN_PAINTABLE_PX || panelHeight < MIN_PAINTABLE_PX) return;

  for (let panel = 0; panel < GRAND_PANELS_PER_LEAF; panel++) {
    const x = leafRect.x + GRAND_PANEL_INSET_PX;
    const y = leafRect.y + GRAND_PANEL_GAP_PX + panel * (panelHeight + GRAND_PANEL_GAP_PX);
    ctx.fillStyle = rgba(sampleRamp(ramp, Math.min(1, 0.5 + PANEL_TONE_LIFT)), PANEL_EDGE_ALPHA);
    ctx.fillRect(x, y, panelWidth, panelHeight);
    paintEdgeLight(
      ctx,
      { x, y },
      { x: x + panelWidth, y },
      sampleRamp(ramp, 1),
      PANEL_EDGE_WIDTH_PX,
      PANEL_EDGE_ALPHA,
    );
    paintEdgeLight(
      ctx,
      { x, y },
      { x, y: y + panelHeight },
      sampleRamp(ramp, 1),
      PANEL_EDGE_WIDTH_PX,
      PANEL_EDGE_ALPHA,
    );
    paintEdgeAo(ctx, { x, y, width: panelWidth, height: panelHeight }, 'bottom', {
      depth: PANEL_EDGE_ALPHA,
      reach: GRAND_PANEL_GAP_PX,
    });
  }
}

/**
 * A curtain of strung beads over a black interior.
 *
 * No leaf at all: the doorway is open, and what the eye reads is the strings
 * catching light in front of a hole. Each string sways on its own phase of the
 * shared wander field, so the curtain hangs rather than ruling.
 */
function paintBeadCurtain(
  ctx: NodeCtx,
  noise: NoiseField,
  seed: number,
  leaf: Rect,
  ramp: Ramp,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(leaf.x, leaf.y, leaf.width, leaf.height);
  ctx.clip();

  ctx.fillStyle = rgb(sampleRamp(getRamp('ink_outline'), INTERIOR_RAMP_T));
  ctx.fillRect(leaf.x, leaf.y, leaf.width, leaf.height);

  const stringCount = Math.max(1, Math.round(leaf.width / BEAD_STRING_SPACING_PX));
  const spacing = leaf.width / stringCount;
  for (let string = 0; string < stringCount; string++) {
    const originX = leaf.x + (string + 0.5) * spacing;
    for (let y = leaf.y + BEAD_SPACING_PX; y < leaf.y + leaf.height; y += BEAD_SPACING_PX) {
      const sway = jointWander(noise, originX, y, seed + string, BEAD_SWAY_PX, BEAD_SWAY_PERIOD);
      const tone =
        0.5 +
        (elementValue(seed, STREAM_PLANK_TONE, string * VOUSSOIR_COUNT + Math.round(y)) - 0.5) *
          2 *
          BEAD_TONE_JITTER;
      ctx.fillStyle = rgb(sampleRamp(ramp, tone));
      ctx.beginPath();
      ctx.arc(originX + sway, y, BEAD_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(sampleRamp(ramp, BEAD_GLINT_TONE), BEAD_GLINT_ALPHA);
      ctx.fillRect(originX + sway - BEAD_RADIUS_PX / 2, y - BEAD_RADIUS_PX / 2, 1, 1);
    }
  }
  ctx.restore();
}

function paintArch(ctx: NodeCtx, seed: number, opening: Rect, arch: DoorArch): void {
  switch (arch) {
    case 'none':
      return;
    case 'flat_lintel':
      paintLintel(ctx, opening);
      return;
    case 'round':
      paintVoussoirRing(ctx, seed, {
        centreX: opening.x + opening.width / 2,
        centreY: opening.y,
        innerRadius: opening.width / 2,
        outerRadius: opening.width / 2 + VOUSSOIR_DEPTH_PX,
        startAngle: Math.PI,
        endAngle: Math.PI * 2,
        count: VOUSSOIR_COUNT,
      });
      return;
    case 'gothic': {
      const half = Math.max(1, Math.round(VOUSSOIR_COUNT / 2));
      paintVoussoirRing(ctx, seed, {
        centreX: opening.x + opening.width,
        centreY: opening.y,
        innerRadius: opening.width,
        outerRadius: opening.width + VOUSSOIR_DEPTH_PX,
        startAngle: Math.PI,
        endAngle: Math.PI + GOTHIC_ARC_SWEEP,
        count: half,
      });
      paintVoussoirRing(ctx, seed + half, {
        centreX: opening.x,
        centreY: opening.y,
        innerRadius: opening.width,
        outerRadius: opening.width + VOUSSOIR_DEPTH_PX,
        startAngle: -GOTHIC_ARC_SWEEP,
        endAngle: 0,
        count: half,
      });
      return;
    }
  }
}

/** A timber beam across the head, with the light on its top face. */
function paintLintel(ctx: NodeCtx, opening: Rect): void {
  const ramp = getRamp('oak_beam');
  const x = opening.x - LINTEL_OVERHANG_PX;
  const y = opening.y - LINTEL_HEIGHT_PX;
  const width = opening.width + LINTEL_OVERHANG_PX * 2;
  ctx.fillStyle = rgb(sampleRamp(ramp, LINTEL_TONE));
  ctx.fillRect(x, y, width, LINTEL_HEIGHT_PX);
  paintEdgeLight(
    ctx,
    { x, y },
    { x: x + width, y },
    sampleRamp(ramp, 1),
    LINTEL_LIGHT_WIDTH_PX,
    LINTEL_LIGHT_ALPHA,
  );
  paintEdgeAo(ctx, { x, y, width, height: LINTEL_HEIGHT_PX }, 'bottom', {
    depth: HEAD_SHADOW_DEPTH,
    reach: LINTEL_HEIGHT_PX,
  });
}

interface VoussoirRing {
  readonly centreX: number;
  readonly centreY: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly count: number;
}

/**
 * Individual wedge stones radiating from the arch's own centre.
 *
 * Each wedge is a polygon rather than an `arc()` sweep so the two halves of a
 * gothic head, which run in opposite directions, need no winding argument to
 * agree — a wedge drawn the wrong way round paints the complement of itself and
 * fills the whole doorway with stone.
 *
 * Value comes from the one sun: a wedge's outward normal dotted with the light
 * direction, which is why the upper-left of a head is bright and the springing
 * points are not.
 */
function paintVoussoirRing(ctx: NodeCtx, seed: number, ring: VoussoirRing): void {
  const ramp = getRamp('step_stone');
  const sweep = ring.endAngle - ring.startAngle;
  for (let wedge = 0; wedge < ring.count; wedge++) {
    const a0 = ring.startAngle + (sweep * wedge) / ring.count;
    const a1 = ring.startAngle + (sweep * (wedge + 1)) / ring.count;
    const mid = (a0 + a1) / 2;
    const lambert = Math.cos(mid) * LIGHT_DIR_X + Math.sin(mid) * LIGHT_DIR_Y;
    const jitter = (elementValue(seed, STREAM_VOUSSOIR, wedge) - 0.5) * 2 * ELEMENT_TONE_JITTER;
    const tone = clamp(VOUSSOIR_BASE_TONE + lambert * VOUSSOIR_LIGHT_RANGE + jitter, 0, 1);

    ctx.beginPath();
    for (let segment = 0; segment <= VOUSSOIR_ARC_SEGMENTS; segment++) {
      const angle = a0 + ((a1 - a0) * segment) / VOUSSOIR_ARC_SEGMENTS;
      const px = ring.centreX + Math.cos(angle) * ring.innerRadius;
      const py = ring.centreY + Math.sin(angle) * ring.innerRadius;
      if (segment === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let segment = VOUSSOIR_ARC_SEGMENTS; segment >= 0; segment--) {
      const angle = a0 + ((a1 - a0) * segment) / VOUSSOIR_ARC_SEGMENTS;
      ctx.lineTo(
        ring.centreX + Math.cos(angle) * ring.outerRadius,
        ring.centreY + Math.sin(angle) * ring.outerRadius,
      );
    }
    ctx.closePath();
    ctx.fillStyle = rgb(sampleRamp(ramp, tone));
    ctx.fill();
    ctx.strokeStyle = rgba(sampleRamp(getRamp('ink_outline'), 0.4), VOUSSOIR_JOINT_ALPHA);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Hinge straps and a handle.
 *
 * The straps run across the leaf from the hinged edge, which is the side the
 * handle is *not* on — putting both on one edge is the tell that says nobody
 * looked at a real door.
 */
function paintHardware(ctx: NodeCtx, seed: number, leaf: Rect, door: DoorSpec): void {
  const iron = getRamp('iron_black');
  const hingesOnLeft = elementValue(seed, STREAM_HARDWARE, door.col) < RING_HANDLE_CHANCE;
  const strapLength = leaf.width * HINGE_STRAP_LENGTH_FRACTION;

  for (const fraction of [HINGE_UPPER_FRACTION, HINGE_LOWER_FRACTION]) {
    const y = leaf.y + leaf.height * fraction;
    const startX = hingesOnLeft ? leaf.x : leaf.x + leaf.width - strapLength;
    paintHingeStrap(ctx, iron, startX, y, strapLength, hingesOnLeft);
  }

  const handleY = leaf.y + leaf.height * HANDLE_HEIGHT_FRACTION;
  const handleX = hingesOnLeft ? leaf.x + leaf.width - HANDLE_INSET_PX : leaf.x + HANDLE_INSET_PX;
  const wantsRing =
    elementValue(seed, STREAM_HARDWARE, door.col + door.gapTiles) < RING_HANDLE_CHANCE;
  if (wantsRing) {
    ctx.strokeStyle = rgb(sampleRamp(iron, IRON_TONE));
    ctx.lineWidth = HANDLE_RING_WIDTH_PX;
    ctx.beginPath();
    ctx.arc(handleX, handleY, HANDLE_RING_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(sampleRamp(iron, IRON_HIGHLIGHT_TONE), IRON_HIGHLIGHT_ALPHA);
    ctx.fillRect(handleX - HANDLE_RING_RADIUS_PX, handleY - HANDLE_RING_RADIUS_PX, 1, 1);
  } else {
    ctx.fillStyle = rgb(sampleRamp(iron, IRON_TONE));
    ctx.fillRect(handleX - LATCH_WIDTH_PX / 2, handleY, LATCH_WIDTH_PX, LATCH_HEIGHT_PX);
    ctx.fillStyle = rgba(sampleRamp(iron, IRON_HIGHLIGHT_TONE), IRON_HIGHLIGHT_ALPHA);
    ctx.fillRect(handleX - LATCH_WIDTH_PX / 2, handleY, LATCH_WIDTH_PX, 1);
  }
}

function paintHingeStrap(
  ctx: NodeCtx,
  iron: Ramp,
  startX: number,
  y: number,
  length: number,
  pointsRight: boolean,
): void {
  const radius = HINGE_STRAP_HEIGHT_PX / 2;
  const tipX = pointsRight ? startX + length : startX;
  ctx.fillStyle = rgb(sampleRamp(iron, IRON_TONE));
  ctx.fillRect(startX, y - radius, length, HINGE_STRAP_HEIGHT_PX);
  ctx.beginPath();
  ctx.arc(tipX, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgba(sampleRamp(iron, IRON_HIGHLIGHT_TONE), IRON_HIGHLIGHT_ALPHA);
  ctx.fillRect(startX, y - radius, length, 1);

  ctx.fillStyle = rgb(sampleRamp(iron, HINGE_STUD_TONE));
  for (
    let studX = startX + HINGE_STUD_SPACING_PX / 2;
    studX < startX + length;
    studX += HINGE_STUD_SPACING_PX
  ) {
    ctx.beginPath();
    ctx.arc(studX, y, HINGE_STUD_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The stone at the foot of the door: a step up to it, or a flight down into a
 * shadowed well when the building has settled below its own street.
 */
function paintThreshold(
  ctx: NodeCtx,
  seed: number,
  opening: Rect,
  baseY: number,
  leafBottomY: number,
  sunkenPx: number,
): void {
  if (sunkenPx > 0) {
    paintSunkenWell(ctx, opening, baseY, sunkenPx);
    return;
  }

  const ramp = getRamp('step_stone');
  const top = Math.min(leafBottomY, baseY - THRESHOLD_MIN_PX);
  const x = opening.x - STEP_OVERHANG_PX;
  const width = opening.width + STEP_OVERHANG_PX * 2;
  let courseIndex = 0;
  for (let y = top; y < baseY; y += STEP_COURSE_PX) {
    const courseHeight = Math.min(STEP_COURSE_PX, baseY - y);
    const tone =
      STEP_TONE + (elementValue(seed, STREAM_STEP, courseIndex) - 0.5) * 2 * STEP_TONE_JITTER;
    ctx.fillStyle = rgb(sampleRamp(ramp, tone));
    ctx.fillRect(x, y, width, courseHeight);
    paintEdgeLight(
      ctx,
      { x, y },
      { x: x + width, y },
      sampleRamp(ramp, 1),
      STEP_LIGHT_WIDTH_PX,
      STEP_LIGHT_ALPHA,
    );
    courseIndex++;
  }
  paintEdgeAo(ctx, { x, y: top, width, height: Math.max(1, baseY - top) }, 'bottom', {
    depth: HEAD_SHADOW_DEPTH,
    reach: THRESHOLD_MIN_PX,
  });
}

/**
 * Steps descending into darkness under the doorway.
 *
 * Each nosing shows less of itself than the one above it, which is the only cue
 * available in a flat elevation that the flight goes *away* from the viewer
 * rather than down the face of the wall.
 */
function paintSunkenWell(ctx: NodeCtx, opening: Rect, baseY: number, sunkenPx: number): void {
  const wellTop = Math.max(opening.y, baseY - sunkenPx);
  const height = baseY - wellTop;
  if (height <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(opening.x, wellTop, opening.width, height);
  ctx.clip();
  ctx.fillStyle = rgba(sampleRamp(getRamp('ink_outline'), INTERIOR_RAMP_T), WELL_DARKEN_ALPHA);
  ctx.fillRect(opening.x, wellTop, opening.width, height);

  const stone = getRamp('step_stone');
  let nosingY = baseY;
  let riser = height / WELL_NOSING_COUNT;
  for (let nosing = 0; nosing < WELL_NOSING_COUNT; nosing++) {
    nosingY -= riser;
    ctx.fillStyle = rgba(sampleRamp(stone, 1), WELL_NOSING_ALPHA);
    ctx.fillRect(opening.x, nosingY, opening.width, 1);
    riser *= WELL_NOSING_FORESHORTEN;
  }
  ctx.restore();

  paintEdgeAo(ctx, { x: opening.x, y: wellTop, width: opening.width, height }, 'bottom', {
    depth: WELL_AO_DEPTH,
    reach: height * WELL_AO_REACH_FRACTION,
  });
}
