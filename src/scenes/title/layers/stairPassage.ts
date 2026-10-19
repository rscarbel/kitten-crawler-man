/**
 * The stair passage seen through the hall's far doorway, projected with the
 * hall's own camera.
 *
 * The passage keeps the doorway's arched section and runs straight back from
 * the far wall: a short landing flush with the hall floor, then a flight
 * descending away, with its vault descending at the flight's pitch and
 * transverse ribs stepping down it. The eye stands a few tiles above the floor
 * and many tiles back, so its line of sight over the threshold falls far less
 * steeply than any stair: every tread past the landing lies below that line,
 * hidden by the threshold. What reads as "down" is the landing's nosing, a
 * dark drop behind it, and the vault and ribs sinking toward the threshold.
 */

import { TITLE_INK, titleRgb, titleRgba, type TitleRgb } from '../../../ui/theme/titleInk';
import type { TitleHall } from '../titleHall';

type Ctx = CanvasRenderingContext2D;

/** The flight's rise per tile run back from the doorway. */
const FLIGHT_PITCH = 0.62;
/** The flat landing between the doorway and the top step. */
const LANDING_TILES = 0.55;
/** Past this the passage is too dark to matter, whatever the camera. */
const MAX_PASSAGE_TILES = 14;
/** Run of each slice the passage is cut into; short enough that the vault's shading never bands. */
const SLICE_TILES = 0.2;
/** Segments in each half of the vault's round arch. */
const ARC_SEGMENTS = 14;

/** The ribs crossing the vault, how far apart they stand and how far they stand proud of it. */
const RIB_SPACING_TILES = 1.4;
const RIB_DEPTH_TILES = 0.09;
/** A rib's face is turned toward the hall and catches its light. */
const RIB_FACE_LIGHT = 1.25;

/** Light falls off with distance into the passage, since it only comes in through the doorway. */
const LIGHT_FALLOFF_TILES = 3.2;
const AMBIENT_LIGHT = 0.32;
const DIFFUSE_LIGHT = 0.6;
/** The key light, from the upper left like everything else in the game, in the passage's section. */
const KEY_LIGHT_X = -0.6;
const KEY_LIGHT_UP = 0.8;

/** The nosing's thickness, as a share of a tile at the doorway. */
const NOSING_WIDTH_TILES = 0.05;
const NOSING_ALPHA = 0.85;

const HALF = 0.5;
const HALF_TURN = Math.PI;

/** A point in the passage: across it, back from the far wall, and above the hall floor, in tiles. */
interface PassagePoint {
  readonly x: number;
  readonly back: number;
  readonly up: number;
}

/** A point of the passage's cross-section: across it and above its floor, in tiles. */
interface SectionVertex {
  readonly x: number;
  readonly up: number;
}

interface Section {
  readonly halfWidth: number;
  readonly springHeight: number;
  readonly outline: readonly SectionVertex[];
}

/** How far the passage has sunk below the hall floor `back` tiles from the doorway. */
function sinkAt(back: number): number {
  return Math.max(0, back - LANDING_TILES) * FLIGHT_PITCH;
}

function project(hall: TitleHall, point: PassagePoint): { x: number; y: number } {
  const scale = hall.farDistanceTiles / (hall.farDistanceTiles + point.back);
  const pxPerTile = hall.farPxPerTile * scale;
  return {
    x: hall.vanish.x + pxPerTile * point.x,
    y: hall.vanish.y + pxPerTile * (hall.eyeHeightTiles - point.up),
  };
}

/**
 * The doorway's arch as a closed loop in the passage's section, wound up the
 * west wall, over the vault and down the east wall, then back along the floor.
 * Inward is always to the right of the direction of travel.
 */
function archOutline(halfWidth: number, springHeight: number, inset: number): SectionVertex[] {
  const innerHalf = halfWidth - inset;
  const outline: SectionVertex[] = [{ x: -innerHalf, up: 0 }];
  for (let i = 0; i <= ARC_SEGMENTS * 2; i++) {
    const angle = HALF_TURN - (HALF_TURN * i) / (ARC_SEGMENTS * 2);
    outline.push({
      x: innerHalf * Math.cos(angle),
      up: springHeight + innerHalf * Math.sin(angle),
    });
  }
  outline.push({ x: innerHalf, up: 0 });
  return outline;
}

function sectionOf(hall: TitleHall): Section {
  const { door } = hall;
  const halfWidth = (door.w * HALF) / hall.farPxPerTile;
  const springRow = door.y + door.w * HALF;
  const springHeight = (hall.farFloorY - springRow) / hall.farPxPerTile;
  return { halfWidth, springHeight, outline: archOutline(halfWidth, springHeight, 0) };
}

function shaded(rgb: TitleRgb, light: number): string {
  return titleRgb([rgb[0] * light, rgb[1] * light, rgb[2] * light]);
}

function depthLight(back: number): number {
  return Math.exp(-back / LIGHT_FALLOFF_TILES);
}

/**
 * Whether the inner face of a section edge, swept back between `nearBack`
 * and `farBack`, faces the eye. The face's normal tilts toward the doorway as
 * the passage sinks, so it is taken from the swept quad itself.
 */
function facesEye(hall: TitleHall, quad: readonly PassagePoint[]): boolean {
  const [a, b, , d] = quad;
  const along = { x: b.x - a.x, back: b.back - a.back, up: b.up - a.up };
  const sweep = { x: d.x - a.x, back: d.back - a.back, up: d.up - a.up };
  const normal = {
    x: along.back * sweep.up - along.up * sweep.back,
    back: along.up * sweep.x - along.x * sweep.up,
    up: along.x * sweep.back - along.back * sweep.x,
  };
  const toEye = {
    x: -a.x,
    back: -hall.farDistanceTiles - a.back,
    up: hall.eyeHeightTiles - a.up,
  };
  return normal.x * toEye.x + normal.back * toEye.back + normal.up * toEye.up < 0;
}

/** How much of the key light an edge's inner face catches. */
function lambert(from: SectionVertex, to: SectionVertex): number {
  const dx = to.x - from.x;
  const dUp = to.up - from.up;
  const length = Math.hypot(dx, dUp);
  if (length === 0) return 0;
  const normalX = dUp / length;
  const normalUp = -dx / length;
  const keyLength = Math.hypot(KEY_LIGHT_X, KEY_LIGHT_UP);
  return Math.max(0, (normalX * KEY_LIGHT_X + normalUp * KEY_LIGHT_UP) / keyLength);
}

function fillQuad(ctx: Ctx, hall: TitleHall, quad: readonly PassagePoint[], fill: string): void {
  ctx.beginPath();
  quad.forEach((point, index) => {
    const { x, y } = project(hall, point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // A hairline of the same fill closes the seams anti-aliasing leaves between neighbouring quads.
  ctx.strokeStyle = fill;
  ctx.lineWidth = HALF;
  ctx.stroke();
}

function paintSlice(
  ctx: Ctx,
  hall: TitleHall,
  section: Section,
  nearBack: number,
  farBack: number,
): void {
  const nearSink = sinkAt(nearBack);
  const farSink = sinkAt(farBack);
  const light = depthLight((nearBack + farBack) * HALF);
  const { outline } = section;
  for (let i = 0; i < outline.length; i++) {
    const from = outline[i];
    const to = outline[(i + 1) % outline.length];
    const quad: PassagePoint[] = [
      { x: from.x, back: nearBack, up: from.up - nearSink },
      { x: to.x, back: nearBack, up: to.up - nearSink },
      { x: to.x, back: farBack, up: to.up - farSink },
      { x: from.x, back: farBack, up: from.up - farSink },
    ];
    if (!facesEye(hall, quad)) continue;
    const surfaceLight = (AMBIENT_LIGHT + DIFFUSE_LIGHT * lambert(from, to)) * light;
    fillQuad(ctx, hall, quad, shaded(TITLE_INK.hall.passageStone, surfaceLight));
  }
}

function traceSection(
  ctx: Ctx,
  hall: TitleHall,
  outline: readonly SectionVertex[],
  back: number,
): void {
  const sink = sinkAt(back);
  outline.forEach((vertex, index) => {
    const { x, y } = project(hall, { x: vertex.x, back, up: vertex.up - sink });
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** A rib's face toward the hall: the band between the vault and the rib's own soffit. */
function paintRib(ctx: Ctx, hall: TitleHall, section: Section, back: number): void {
  const soffit = archOutline(
    section.halfWidth,
    section.springHeight - RIB_DEPTH_TILES,
    RIB_DEPTH_TILES,
  );
  ctx.beginPath();
  traceSection(ctx, hall, section.outline, back);
  traceSection(ctx, hall, soffit, back);
  const light = Math.min(
    1,
    (AMBIENT_LIGHT + DIFFUSE_LIGHT * HALF) * RIB_FACE_LIGHT * depthLight(back),
  );
  ctx.fillStyle = shaded(TITLE_INK.hall.passageStone, light);
  ctx.fill('evenodd');
}

/** The landing's far edge, where the flight drops away. */
function paintNosing(ctx: Ctx, hall: TitleHall, section: Section): void {
  const west = project(hall, { x: -section.halfWidth, back: LANDING_TILES, up: 0 });
  const east = project(hall, { x: section.halfWidth, back: LANDING_TILES, up: 0 });
  ctx.strokeStyle = titleRgba(
    TITLE_INK.hall.passageNosing,
    NOSING_ALPHA * depthLight(LANDING_TILES),
  );
  ctx.lineWidth = NOSING_WIDTH_TILES * hall.farPxPerTile;
  ctx.beginPath();
  ctx.moveTo(west.x, west.y);
  ctx.lineTo(east.x, east.y);
  ctx.stroke();
}

/** The passage's far end: where its whole section has sunk below the threshold, or the dark has it. */
function passageLength(hall: TitleHall, section: Section): number {
  const crownHeight = section.springHeight + section.halfWidth;
  for (let back = 0; back < MAX_PASSAGE_TILES; back += SLICE_TILES) {
    const crown = project(hall, { x: 0, back, up: crownHeight - sinkAt(back) });
    if (crown.y >= hall.farFloorY) return back;
  }
  return MAX_PASSAGE_TILES;
}

/**
 * Paints the passage beyond the hall's doorway. The caller has already
 * clipped to the doorway and filled it with the void the passage sinks into.
 */
export function paintStairPassage(ctx: Ctx, hall: TitleHall): void {
  const section = sectionOf(hall);
  const length = passageLength(hall, section);
  const sliceCount = Math.ceil(length / SLICE_TILES);
  const ribEvery = Math.round(RIB_SPACING_TILES / SLICE_TILES);
  for (let slice = sliceCount - 1; slice >= 0; slice--) {
    const nearBack = slice * SLICE_TILES;
    paintSlice(ctx, hall, section, nearBack, nearBack + SLICE_TILES);
    const ribStandsHere = slice > 0 && slice % ribEvery === 0;
    if (ribStandsHere) paintRib(ctx, hall, section, nearBack);
  }
  paintNosing(ctx, hall, section);
}
