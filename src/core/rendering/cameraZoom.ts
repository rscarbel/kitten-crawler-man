/**
 * The camera's zoom-out: something in the world asks for a rect to be kept on
 * screen, and the camera zooms out only as far as that rect needs and pans
 * only as far as it must, easing in and out rather than snapping.
 *
 * Owners ask by name and the highest priority's rect wins, the same way the
 * camera's focus overrides take turns, so two rooms or a room and a cutscene
 * never fight over the framing. The zoom is decided only when the winning
 * rect or the screen changes, so a framing never breathes as the party walks.
 */

import { clamp } from '../../utils';
import type { Rect } from '../../ui/core/geom';
import type { WorldRect } from './worldRect';
import type { WorldPx } from './camera';

/** Who may ask the camera to keep a rect in view, and whose ask wins: the higher number. */
const CAMERA_ZOOM_PRIORITY = {
  floodedPumpRoom: 1,
} as const satisfies Record<string, number>;

type CameraZoomOwner = keyof typeof CAMERA_ZOOM_PRIORITY;

/** The furthest the camera zooms out: below this the crawlers and their foes stop reading. */
const MIN_CAMERA_ZOOM = 0.6;
const NORMAL_ZOOM = 1;
/** How long a change of framing takes to ease in or out, in world ticks (60 a second). */
const ZOOM_EASE_FRAMES = 45;
/** How close to the edge of the view the camera's own focus may be pushed by a framing, in pixels. */
const FOCUS_EDGE_MARGIN_PX = 48;

const SMOOTHSTEP_QUADRATIC = 3;
const SMOOTHSTEP_CUBIC = 2;

function easeInOut(t: number): number {
  return t * t * (SMOOTHSTEP_QUADRATIC - SMOOTHSTEP_CUBIC * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Runs `draw` in the screen's own units from inside a world pass drawn under
 * a zoom of `zoom`: for screen chrome that has to sit between world layers.
 */
export function drawUnzoomed(ctx: CanvasRenderingContext2D, zoom: number, draw: () => void): void {
  ctx.save();
  ctx.scale(1 / zoom, 1 / zoom);
  try {
    draw();
  } finally {
    ctx.restore();
  }
}

/**
 * Runs `draw` in the world view's units from screen space: for world-anchored
 * guidance drawn after the world pass, so it lands where the zoomed world put
 * what it points at.
 */
export function drawInWorldView(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.scale(zoom, zoom);
  try {
    draw();
  } finally {
    ctx.restore();
  }
}

/**
 * A framing the camera is at or easing toward: its zoom, the rect it keeps in
 * view, the part of the screen it keeps that rect in, and how strongly it
 * pans to that rect (1 framed, 0 the camera's own).
 */
interface Framing {
  readonly zoom: number;
  readonly rect: WorldRect | null;
  readonly clear: Rect | null;
  readonly weight: number;
}

const NORMAL_FRAMING: Framing = { zoom: NORMAL_ZOOM, rect: null, clear: null, weight: 0 };

function sameRect(a: WorldRect | null, b: WorldRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

function sameScreenRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function lerpRect(from: WorldRect, to: WorldRect, t: number): WorldRect {
  return {
    left: lerp(from.left, to.left, t),
    top: lerp(from.top, to.top, t),
    right: lerp(from.right, to.right, t),
    bottom: lerp(from.bottom, to.bottom, t),
  };
}

function lerpScreenRect(from: Rect, to: Rect, t: number): Rect {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    w: lerp(from.w, to.w, t),
    h: lerp(from.h, to.h, t),
  };
}

/** Both ends of a framing set, the later one winning where only one has a value. */
function blend<T>(
  from: T | null,
  to: T | null,
  t: number,
  mix: (a: T, b: T, t: number) => T,
): T | null {
  if (from !== null && to !== null) return mix(from, to, t);
  return to ?? from;
}

/** How much `rect` must shrink to fit a `w` by `h` frame: below 1 it does not fit at full size. */
function fitScale(rect: WorldRect, w: number, h: number): number {
  const fitWidth = w / Math.max(1, rect.right - rect.left);
  const fitHeight = h / Math.max(1, rect.bottom - rect.top);
  return Math.min(fitWidth, fitHeight);
}

/** The least zoom that shows all of `rect` in a `w` by `h` frame, never past the limits. */
function zoomToFit(rect: WorldRect, w: number, h: number): number {
  return clamp(fitScale(rect, w, h), MIN_CAMERA_ZOOM, NORMAL_ZOOM);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The part of a `screenW` by `screenH` screen that none of `keepouts` (the
 * HUD's frames, minimap and hotbar) covers and that shows `rect` largest:
 * every rectangle whose sides are the screen's edges or the keepouts' edges is
 * tried. A full-width band between the top chrome and the hotbar suits a
 * portrait phone; the column between the frames and the minimap above the
 * hotbar suits a landscape one.
 */
function clearFrameFor(
  rect: WorldRect,
  screenW: number,
  screenH: number,
  keepouts: readonly Rect[],
): Rect {
  const screen: Rect = { x: 0, y: 0, w: screenW, h: screenH };
  const onScreen = keepouts.filter((keepout) => overlaps(keepout, screen));
  const lefts = [0, ...onScreen.map((k) => Math.round(k.x + k.w))];
  const rights = [screenW, ...onScreen.map((k) => Math.round(k.x))];
  const tops = [0, ...onScreen.map((k) => Math.round(k.y + k.h))];
  const bottoms = [screenH, ...onScreen.map((k) => Math.round(k.y))];
  let best = screen;
  let bestScale = Number.NEGATIVE_INFINITY;
  for (const left of lefts) {
    for (const right of rights) {
      if (right <= left || left < 0 || right > screenW) continue;
      for (const top of tops) {
        for (const bottom of bottoms) {
          if (bottom <= top || top < 0 || bottom > screenH) continue;
          const candidate: Rect = { x: left, y: top, w: right - left, h: bottom - top };
          if (onScreen.some((keepout) => overlaps(keepout, candidate))) continue;
          const scale = fitScale(rect, candidate.w, candidate.h);
          const roomier = scale === bestScale && candidate.w * candidate.h > best.w * best.h;
          if (scale > bestScale || roomier) {
            best = candidate;
            bestScale = scale;
          }
        }
      }
    }
  }
  return best;
}

/**
 * The camera's left (or top) edge on one axis moved as little as it takes to
 * bring `start`..`end` into the stretch `offset`..`offset + size` of the view.
 * A span longer than that stretch keeps the stretch inside the span instead,
 * as near where it was as it can be.
 */
function containAxis(
  camera: number,
  offset: number,
  size: number,
  start: number,
  end: number,
): number {
  const stretchStart = camera + offset;
  const contained =
    end - start <= size
      ? clamp(stretchStart, end - size, start)
      : clamp(stretchStart, start, end - size);
  return contained - offset;
}

export class CameraZoom {
  private readonly requests = new Map<CameraZoomOwner, WorldRect>();
  private from: Framing = NORMAL_FRAMING;
  private to: Framing = NORMAL_FRAMING;
  /** The rect {@link to} was fitted to, and the clear part of the screen it was fitted in. */
  private fittedRect: WorldRect | null = null;
  private fittedClear: Rect | null = null;
  private easedFrames = ZOOM_EASE_FRAMES;

  /** Ask for `rect` (world pixels) to be kept in view, or withdraw the ask with null. Call every tick it holds. */
  request(owner: CameraZoomOwner, rect: WorldRect | null): void {
    if (rect === null) this.requests.delete(owner);
    else this.requests.set(owner, rect);
  }

  /**
   * Advance the ease one world tick on a screen `screenW` by `screenH` CSS
   * pixels, framing the winning rect clear of `keepouts` (CSS pixels). The
   * framing is decided again only when the rect or the clear part of the
   * screen changes.
   */
  tick(screenW: number, screenH: number, keepouts: readonly Rect[]): void {
    const wanted = this.winningRequest();
    const clear = wanted === null ? null : clearFrameFor(wanted, screenW, screenH, keepouts);
    if (!sameRect(wanted, this.fittedRect) || !sameScreenRect(clear, this.fittedClear)) {
      this.retarget(wanted, clear);
    }
    this.easedFrames = Math.min(ZOOM_EASE_FRAMES, this.easedFrames + 1);
  }

  /** Drop every ask and snap back to the camera's own framing, for a world being left. */
  reset(): void {
    this.requests.clear();
    this.from = NORMAL_FRAMING;
    this.to = NORMAL_FRAMING;
    this.fittedRect = null;
    this.fittedClear = null;
    this.easedFrames = ZOOM_EASE_FRAMES;
  }

  /** CSS pixels per world pixel this tick: 1 at the camera's own framing, below 1 zoomed out. */
  get zoom(): number {
    return this.current().zoom;
  }

  /**
   * `camera` (the top-left of a view `viewW` by `viewH` world pixels) panned
   * toward the framed rect as far as the framing has eased in, never so far
   * that `focus` leaves the view.
   */
  keepInView(
    camera: { readonly x: number; readonly y: number },
    focus: { readonly x: number; readonly y: number },
    viewW: WorldPx,
    viewH: WorldPx,
  ): { x: number; y: number } {
    const framing = this.current();
    const { rect, clear, zoom } = framing;
    if (rect === null || clear === null || framing.weight === 0) {
      return { x: camera.x, y: camera.y };
    }
    const framedX = containAxis(camera.x, clear.x / zoom, clear.w / zoom, rect.left, rect.right);
    const framedY = containAxis(camera.y, clear.y / zoom, clear.h / zoom, rect.top, rect.bottom);
    const pannedX = lerp(camera.x, framedX, framing.weight);
    const pannedY = lerp(camera.y, framedY, framing.weight);
    return {
      x: clamp(pannedX, focus.x + FOCUS_EDGE_MARGIN_PX - viewW, focus.x - FOCUS_EDGE_MARGIN_PX),
      y: clamp(pannedY, focus.y + FOCUS_EDGE_MARGIN_PX - viewH, focus.y - FOCUS_EDGE_MARGIN_PX),
    };
  }

  private winningRequest(): WorldRect | null {
    let best: WorldRect | null = null;
    let bestPriority = Number.NEGATIVE_INFINITY;
    for (const [owner, rect] of this.requests) {
      const priority = CAMERA_ZOOM_PRIORITY[owner];
      if (priority > bestPriority) {
        best = rect;
        bestPriority = priority;
      }
    }
    return best;
  }

  private retarget(wanted: WorldRect | null, clear: Rect | null): void {
    this.from = this.current();
    this.to =
      wanted === null || clear === null
        ? NORMAL_FRAMING
        : { zoom: zoomToFit(wanted, clear.w, clear.h), rect: wanted, clear, weight: 1 };
    this.fittedRect = wanted;
    this.fittedClear = clear;
    this.easedFrames = 0;
  }

  private current(): Framing {
    const t = easeInOut(this.easedFrames / ZOOM_EASE_FRAMES);
    const { from, to } = this;
    return {
      zoom: lerp(from.zoom, to.zoom, t),
      rect: blend(from.rect, to.rect, t, lerpRect),
      clear: blend(from.clear, to.clear, t, lerpScreenRect),
      weight: lerp(from.weight, to.weight, t),
    };
  }
}
