/**
 * Framing for the camera inside a building.
 *
 * A room is a few screens across at most, and the player needs to see every
 * edge of it — the far wall and whatever stands against it most of all, since
 * the altar, the counter or the hearth is usually there. So the camera follows
 * the focus but clamps to the room's *visual* bounds rather than its tile grid:
 * the grid plus whatever art rises above the top row, grown by a small margin
 * so the room's edge never sits flush against the screen's edge. A room that
 * fits on an axis is centred on it instead.
 *
 * Framing is against the part of the screen the HUD leaves clear, not the
 * whole screen: a rat in the corner under the Pause button is a rat the player
 * cannot find, so the camera pans far enough to bring every floor tile out
 * from under the chrome.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { TileContent } from '../map/tileTypes';
import { clamp } from '../utils';
import { townInteriorPropArtRiseTiles } from '../sprites/art/townInterior/townInteriorProps';
import { intersect, type Rect } from '../ui/core/geom';

/** An axis-aligned rectangle in world pixels. */
export interface WorldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Empty dark space shown past every edge of a room once the camera has panned
 * to it, in tiles. Three-quarters of a tile reads as a border rather than as a
 * view into nothing, and is small enough not to cost a phone's narrow axis
 * much room.
 */
const INTERIOR_CAMERA_MARGIN_TILES = 0.75;
export const INTERIOR_CAMERA_MARGIN_PX = TILE_SIZE * INTERIOR_CAMERA_MARGIN_TILES;

/**
 * The least clear span, in tiles, pushing an occluder off an axis may leave.
 * Below it the party would be framed in a slot too thin to see what is coming.
 */
const MIN_CLEAR_SPAN_TILES = 4;
const MIN_CLEAR_SPAN_PX = TILE_SIZE * MIN_CLEAR_SPAN_TILES;
/** Where in its tile the camera's focus sits. */
const CENTRE_OF_TILE = 0.5;

/** The furthest the focus can travel along one axis, in world coordinates. */
export interface FocusSpan {
  readonly start: number;
  readonly end: number;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

/**
 * The camera offset along one axis. `focus` is the world coordinate to centre
 * on; `boundsStart`/`boundsEnd` the world span that must stay reachable;
 * `viewStart`/`viewEnd` the screen span it is shown in; and
 * `clearStart`/`clearEnd` the part of that span no on-screen chrome covers.
 * Everything is framed in the clear span: when the bounds fit it they are
 * centred in it and the focus is ignored — there is nothing to pan to.
 * Otherwise the focus is centred in it, clamped so neither end of the bounds
 * ever pulls inside it.
 *
 * On a small screen, centring the focus can stop short of an end: the party at
 * the last row it can reach is still in the middle of the clear span, and the
 * wall beyond is cut off. Given `focusSpan`, the camera eases from centred at
 * the span's middle to fully clamped at each end the centred camera cannot
 * reach, so walking to the far row always shows the far wall.
 */
export function followCameraAxis(
  focus: number,
  boundsStart: number,
  boundsEnd: number,
  viewStart: number,
  viewEnd: number,
  clearStart = viewStart,
  clearEnd = viewEnd,
  focusSpan: FocusSpan | null = null,
): number {
  const clearCentre = (clearStart + clearEnd) / 2;
  const boundsFitClear = boundsEnd - boundsStart <= clearEnd - clearStart;
  if (boundsFitClear) return (boundsStart + boundsEnd) / 2 - clearCentre;
  const cameraShowingStartEdge = boundsStart - clearStart;
  const cameraShowingEndEdge = boundsEnd - clearEnd;
  let camera = focus - clearCentre;
  if (focusSpan !== null) {
    const middle = (focusSpan.start + focusSpan.end) / 2;
    const centredAtMiddle = middle - clearCentre;
    const centredMissesStart = focusSpan.start - clearCentre > cameraShowingStartEdge;
    const centredMissesEnd = focusSpan.end - clearCentre < cameraShowingEndEdge;
    if (centredMissesStart && focus < middle && middle > focusSpan.start) {
      const towardMiddle = (focus - focusSpan.start) / (middle - focusSpan.start);
      camera = lerp(cameraShowingStartEdge, centredAtMiddle, towardMiddle);
    } else if (centredMissesEnd && focus > middle && focusSpan.end > middle) {
      const towardEnd = (focus - middle) / (focusSpan.end - middle);
      camera = lerp(centredAtMiddle, cameraShowingEndEdge, towardEnd);
    }
  }
  return clamp(camera, cameraShowingStartEdge, cameraShowingEndEdge);
}

/**
 * The camera for a focus point, bounds and screen rect — {@link followCameraAxis}
 * on both axes. `clear` is the part of `view` the bounds are framed in, the
 * whole view unless chrome covers some of it; `focusRange` the furthest the
 * focus can travel, when the caller knows it.
 */
export function followCamera(
  focus: { readonly x: number; readonly y: number },
  bounds: WorldRect,
  view: Rect,
  clear: Rect = view,
  focusRange: WorldRect | null = null,
): { x: number; y: number } {
  return {
    x: followCameraAxis(
      focus.x,
      bounds.left,
      bounds.right,
      view.x,
      view.x + view.w,
      clear.x,
      clear.x + clear.w,
      focusRange === null ? null : { start: focusRange.left, end: focusRange.right },
    ),
    y: followCameraAxis(
      focus.y,
      bounds.top,
      bounds.bottom,
      view.y,
      view.y + view.h,
      clear.y,
      clear.y + clear.h,
      focusRange === null ? null : { start: focusRange.top, end: focusRange.bottom },
    ),
  };
}

type Axis = 'x' | 'y';

interface AxisSpan {
  readonly start: number;
  readonly end: number;
}

function screenSpan(rect: Rect, axis: Axis): AxisSpan {
  return axis === 'x'
    ? { start: rect.x, end: rect.x + rect.w }
    : { start: rect.y, end: rect.y + rect.h };
}

function worldSpan(rect: WorldRect, axis: Axis): AxisSpan {
  return axis === 'x'
    ? { start: rect.left, end: rect.right }
    : { start: rect.top, end: rect.bottom };
}

function spansOverlap(a: AxisSpan, b: AxisSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Whether an occluder can ever lie over part of `mustSee` along one axis. On
 * an axis where the camera pans it can; on one where the bounds fit the clear
 * span, `mustSee` sits still on screen and either meets the occluder or never
 * does.
 */
function mayOverlapOnAxis(
  occluder: Rect,
  clear: Rect,
  bounds: WorldRect,
  mustSee: WorldRect,
  axis: Axis,
): boolean {
  const clearSpan = screenSpan(clear, axis);
  const boundsSpan = worldSpan(bounds, axis);
  const fits = boundsSpan.end - boundsSpan.start <= clearSpan.end - clearSpan.start;
  if (!fits) return true;
  const camera = (boundsSpan.start + boundsSpan.end) / 2 - (clearSpan.start + clearSpan.end) / 2;
  const seen = worldSpan(mustSee, axis);
  return spansOverlap(
    { start: seen.start - camera, end: seen.end - camera },
    screenSpan(occluder, axis),
  );
}

/**
 * The clear rect's new edge when an occluder is pushed off it along `axis`:
 * off whichever end of the view the occluder is nearer to.
 */
function pushOffAxis(clear: Rect, view: Rect, occluder: Rect, axis: Axis): Rect {
  const viewSpan = screenSpan(view, axis);
  const occluderSpan = screenSpan(occluder, axis);
  const clearSpan = screenSpan(clear, axis);
  const viewCentre = (viewSpan.start + viewSpan.end) / 2;
  const occluderCentre = (occluderSpan.start + occluderSpan.end) / 2;
  const fromStart = occluderCentre < viewCentre;
  const start = fromStart ? Math.max(clearSpan.start, occluderSpan.end) : clearSpan.start;
  const end = fromStart ? clearSpan.end : Math.min(clearSpan.end, occluderSpan.start);
  return axis === 'x'
    ? { ...clear, x: start, w: end - start }
    : { ...clear, y: start, h: end - start };
}

/**
 * The largest clear rect — by the share of each axis kept, multiplied — that
 * pushes every occluder off one axis or the other, trying every assignment:
 * the HUD comes in columns and rows (Pause, Gear and Bag under the minimap),
 * and choosing one piece at a time splits a column between two axes and pays
 * for both. A handful of occluders makes that a few hundred rects. Null when
 * no assignment leaves {@link MIN_CLEAR_SPAN_PX} on both axes.
 */
function bestClearFor(view: Rect, occluders: readonly Rect[]): Rect | null {
  const assignments = 1 << occluders.length;
  let best: Rect | null = null;
  let bestScore = -1;
  for (let assignment = 0; assignment < assignments; assignment++) {
    let clear = view;
    occluders.forEach((occluder, index) => {
      const axis: Axis = (assignment >> index) % 2 === 0 ? 'x' : 'y';
      clear = pushOffAxis(clear, view, occluder, axis);
    });
    if (clear.w < MIN_CLEAR_SPAN_PX || clear.h < MIN_CLEAR_SPAN_PX) continue;
    const score = (clear.w / view.w) * (clear.h / view.h);
    if (score > bestScore) {
      best = clear;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The part of `view` a room is framed in so that on-screen chrome — the HUD
 * panel, the name plate, the minimap column, a phone's buttons — never
 * permanently hides any of `mustSee`.
 *
 * Each occluder that could lie over `mustSee` is pushed off the nearer end of
 * one axis, with the axes chosen together to keep the most screen. The camera
 * centres its focus in the clear rect and clamps the room's edges to it, so
 * the tile the party stands on is always inside the clear rect — and so under
 * none of the chrome pushed out of it. Which occluders could lie over
 * `mustSee` depends on the clear rect itself — narrowing an axis can stop the
 * room fitting it — so the choice is repeated until it settles, and an
 * occluder once pushed out stays pushed out, or a room that fits only once
 * the HUD panel is cleared would flip between the two framings. If the chrome
 * leaves no workable rect at all, the occluder costliest to clear is let be,
 * one at a time, until one is found.
 */
export function hudClearView(
  view: Rect,
  occluders: readonly Rect[],
  bounds: WorldRect,
  mustSee: WorldRect,
): Rect {
  const onScreen = occluders.flatMap((occluder) => {
    const clipped = intersect(occluder, view);
    return clipped === null ? [] : [clipped];
  });
  let clear = view;
  const everActive = new Set<Rect>();
  for (let pass = 0; pass <= onScreen.length; pass++) {
    const current = clear;
    for (const occluder of onScreen) {
      const mayHide =
        mayOverlapOnAxis(occluder, current, bounds, mustSee, 'x') &&
        mayOverlapOnAxis(occluder, current, bounds, mustSee, 'y');
      if (mayHide) everActive.add(occluder);
    }
    let active = onScreen.filter((occluder) => everActive.has(occluder));
    let next = bestClearFor(view, active);
    while (next === null && active.length > 0) {
      const areaOf = (rect: Rect): number => rect.w * rect.h;
      const largest = active.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a));
      active = active.filter((occluder) => occluder !== largest);
      next = bestClearFor(view, active);
    }
    const settled = next ?? view;
    const unchanged =
      settled.x === clear.x &&
      settled.y === clear.y &&
      settled.w === clear.w &&
      settled.h === clear.h;
    clear = settled;
    if (unchanged) break;
  }
  return clear;
}

/** Grows a rect by `marginPx` on every side. */
export function expandWorldRect(rect: WorldRect, marginPx: number): WorldRect {
  return {
    left: rect.left - marginPx,
    top: rect.top - marginPx,
    right: rect.right + marginPx,
    bottom: rect.bottom + marginPx,
  };
}

interface CachedBounds {
  readonly structure: TileContent[][];
  readonly props: GameMap['placedInteriorProps'];
  readonly bounds: WorldRect;
}

/**
 * Keyed on the map, and revalidated against the two lists a regeneration
 * replaces, so a room rebuilt in place (a tower storey, a Big Top variant) is
 * re-measured while the camera's several reads a frame cost a lookup.
 */
const boundsCache = new WeakMap<GameMap, CachedBounds>();

function measureInteriorVisualBounds(map: GameMap): WorldRect {
  const ts = TILE_SIZE;
  const cols = map.structure[0]?.length ?? map.structure.length;
  const rows = map.structure.length;
  let left = 0;
  let top = 0;
  let right = cols * ts;
  let bottom = rows * ts;
  for (const placed of map.placedInteriorProps) {
    const riseTiles = townInteriorPropArtRiseTiles(placed.propId, placed.variant);
    top = Math.min(top, (placed.tile.y - riseTiles) * ts);
  }
  // Read in full before anything else can ask: the map hands back one reused list.
  for (const deco of map.getVisibleDecorationTiles(0, 0, right, bottom)) {
    left = Math.min(left, deco.tx * ts - deco.extents.left);
    top = Math.min(top, deco.ty * ts - deco.extents.up);
    right = Math.max(right, (deco.tx + 1) * ts + deco.extents.right);
    bottom = Math.max(bottom, (deco.ty + 1) * ts + deco.extents.down);
  }
  return { left, top, right, bottom };
}

/**
 * Everything a room draws, in world pixels: its tile grid, plus the art that
 * rises above the top row — a tall prop against the north wall, or a
 * decoration whose sprite reaches past its tile. Destroyed props are still
 * counted: the space they stood in is still the room.
 */
export function interiorVisualBounds(map: GameMap): WorldRect {
  const cached = boundsCache.get(map);
  if (cached?.structure === map.structure && cached.props === map.placedInteriorProps) {
    return cached.bounds;
  }
  const bounds = measureInteriorVisualBounds(map);
  boundsCache.set(map, {
    structure: map.structure,
    props: map.placedInteriorProps,
    bounds,
  });
  return bounds;
}

interface CachedWalkable {
  readonly structure: TileContent[][];
  readonly props: GameMap['placedInteriorProps'];
  readonly bounds: WorldRect;
}

const walkableCache = new WeakMap<GameMap, CachedWalkable>();

/**
 * The bounding box of every tile the party can stand on, in world pixels —
 * what on-screen chrome must never keep covered, since anything that walks
 * the room can stand there. Cached the way {@link interiorVisualBounds} is.
 */
export function interiorWalkableBounds(map: GameMap): WorldRect {
  const cached = walkableCache.get(map);
  if (cached?.structure === map.structure && cached.props === map.placedInteriorProps) {
    return cached.bounds;
  }
  const rows = map.structure.length;
  const cols = map.structure[0]?.length ?? rows;
  let minX = cols;
  let minY = rows;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!map.isWalkable(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const ts = TILE_SIZE;
  const bounds =
    maxX < 0
      ? { left: 0, top: 0, right: cols * ts, bottom: rows * ts }
      : { left: minX * ts, top: minY * ts, right: (maxX + 1) * ts, bottom: (maxY + 1) * ts };
  walkableCache.set(map, { structure: map.structure, props: map.placedInteriorProps, bounds });
  return bounds;
}

/**
 * What on-screen chrome must never keep covered: every tile the party can stand
 * on — anything that walks the room can stand there too — and, above them, the
 * far wall up to the top of its tallest art, where a room hangs its altar or
 * its hearth. The side and south walls are only walls, and a HUD corner over
 * them costs nothing.
 */
export function interiorMustSeeBounds(map: GameMap): WorldRect {
  const walkable = interiorWalkableBounds(map);
  const visual = interiorVisualBounds(map);
  const cached = mustSeeCache.get(map);
  if (cached?.walkable === walkable && cached.visual === visual) return cached.bounds;
  const bounds = { ...walkable, top: Math.min(walkable.top, visual.top) };
  mustSeeCache.set(map, { walkable, visual, bounds });
  return bounds;
}

interface CachedMustSee {
  readonly walkable: WorldRect;
  readonly visual: WorldRect;
  readonly bounds: WorldRect;
}

/**
 * Keyed on the two cached rects it is built from, so it is the same object for
 * exactly as long as they are — which lets {@link ClearViewMemo} compare it by
 * identity.
 */
const mustSeeCache = new WeakMap<GameMap, CachedMustSee>();

/**
 * The last clear view a room was framed in, and what it was computed from.
 * Searching every way of pushing the chrome aside ({@link hudClearView}) costs
 * a noticeable slice of a frame, and its inputs change only when the screen,
 * the chrome or the room does.
 */
export class ClearViewMemo {
  private last: {
    readonly map: GameMap;
    readonly mustSee: WorldRect;
    readonly key: string;
    readonly clear: Rect;
  } | null = null;

  /**
   * The clear view for `map`, recomputed through `compute` only when the map,
   * its {@link interiorMustSeeBounds} or `key` — everything else the view
   * depends on, serialised — differs from the last call.
   */
  clearView(map: GameMap, key: string, compute: (mustSee: WorldRect) => Rect): Rect {
    const mustSee = interiorMustSeeBounds(map);
    const last = this.last;
    if (last?.map === map && last.mustSee === mustSee && last.key === key) return last.clear;
    const clear = compute(mustSee);
    this.last = { map, mustSee, key, clear };
    return clear;
  }
}

/**
 * The furthest the camera's focus travels in a room: the centres of the
 * outermost tiles the party can stand on, where `computeCamera` centres.
 */
export function interiorFocusRange(map: GameMap): WorldRect {
  const walkable = interiorWalkableBounds(map);
  const halfTile = TILE_SIZE * CENTRE_OF_TILE;
  return {
    left: walkable.left + halfTile,
    top: walkable.top + halfTile,
    right: walkable.right - halfTile,
    bottom: walkable.bottom - halfTile,
  };
}

/** {@link interiorVisualBounds} grown by {@link INTERIOR_CAMERA_MARGIN_PX} — what the interior camera clamps to. */
export function interiorCameraBounds(map: GameMap): WorldRect {
  return expandWorldRect(interiorVisualBounds(map), INTERIOR_CAMERA_MARGIN_PX);
}
