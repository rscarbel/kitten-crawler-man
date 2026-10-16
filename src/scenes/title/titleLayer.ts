/**
 * The contract every slice of the title picture is written against: the
 * {@link TitleLayer} itself, the {@link TitleCamera} it reads its parallax
 * from, and the {@link TitleLightRig} through which layers share light.
 *
 * Layers never import each other. Anything two layers must agree on (where
 * the torches are, how bright each one burns this frame) flows through the
 * stage and its light rig, which the scene owns.
 */

import type { TitleClock } from './titleClock';
import type { TitleStage } from './titleStage';
import type { TitleCue } from './titleTimeline';
import type { TitleEventFire } from './titleEvents';

/** A point in canvas CSS pixels. */
export interface TitlePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How far into the picture a layer sits, from 0 (the far void, moves least)
 * to 1 (the nearest plane, moves most). Parallax and shake scale with it.
 */
export type TitleDepth = number;

/**
 * The title's camera: a slow parallax drift, a zoom about a fixed point and a
 * shake. Layers do not move themselves; they ask where their plane sits.
 */
export interface TitleCamera {
  /** The translation a plane at `depth` is drawn with this frame, in CSS pixels. */
  offsetFor(depth: TitleDepth): TitlePoint;
  /** 1 at rest; above 1 pushes in (the dive). */
  readonly zoom: number;
  /** The fixed point the zoom scales about, in CSS pixels. */
  readonly zoomOrigin: TitlePoint;
}

/**
 * The live state of one torch, parallel to `stage.torches` (the same index is
 * the same torch). The torch layer writes it; the light layer reads it.
 */
export interface TitleTorchLight {
  /** 0 unlit, 1 burning fully. */
  level: number;
  /** This frame's flicker multiplier on `level`, around 1. */
  flicker: number;
}

/**
 * Light shared between layers. Owned by the scene, reached through
 * `stage.lights`; survives a relayout, so a resize never relights or douses a
 * torch.
 */
export interface TitleLightRig {
  /** One entry per `stage.torches` anchor, in the same order. */
  readonly torches: readonly TitleTorchLight[];
  /** 0 (the darkest the hall gets) to 1 (fully lit); how far the darkness has lifted. */
  ambient: number;
  /** 0 off, 1 full: the game-show spotlight on the heroes. */
  spotlight: number;
}

/**
 * One independently paintable slice of the title picture.
 *
 * Every pass is handed a context in canvas CSS pixels, saved before the call
 * and restored after it, so a layer may change transform, alpha, composite
 * mode or clip freely without reaching the next layer.
 */
export interface TitleLayer {
  readonly id: string;
  /** Where the layer's plane sits; see {@link TitleDepth}. */
  readonly depth: TitleDepth;
  /**
   * Called once on enter and again whenever the viewport changes size. Bake
   * static art (a hall, a fog texture, a grain tile) to offscreen canvases here,
   * never per frame.
   */
  layout?(stage: TitleStage): void;
  /** One fixed update step (particles, actors). `clock.dt` is 0 while frozen. */
  update?(clock: TitleClock, stage: TitleStage): void;
  render(
    ctx: CanvasRenderingContext2D,
    clock: TitleClock,
    stage: TitleStage,
    camera: TitleCamera,
  ): void;
  /** A beat of the ignition or dive timeline. A layer ignores cues it does not know. */
  onCue?(cue: TitleCue): void;
  /** One of the idle loop's beats has begun. A layer ignores beats it does not stage. */
  onEvent?(fire: TitleEventFire): void;
  /** Called when the scene exits: let go of baked canvases and anything held. */
  dispose?(): void;
}

/** Builds a fresh layer for one title scene, so no state outlives the scene that made it. */
export type TitleLayerFactory = () => TitleLayer;

/**
 * Puts `ctx` on the plane at `depth`: the camera's zoom about its origin,
 * then the plane's parallax and shake. Call inside the layer's own render.
 */
export function applyTitleCamera(
  ctx: CanvasRenderingContext2D,
  camera: TitleCamera,
  depth: TitleDepth,
): void {
  const { zoom, zoomOrigin } = camera;
  ctx.translate(zoomOrigin.x, zoomOrigin.y);
  ctx.scale(zoom, zoom);
  ctx.translate(-zoomOrigin.x, -zoomOrigin.y);
  const offset = camera.offsetFor(depth);
  ctx.translate(offset.x, offset.y);
}
