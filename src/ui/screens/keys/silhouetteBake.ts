/**
 * A key's glowing silhouette baked once and blitted after, for a ceremony that
 * holds still on it. The held pieces' glow is a shadow blur, the costliest
 * thing on the settled screen, and a settled screen would otherwise pay it
 * every frame for as long as the player reads.
 *
 * The slow shimmer across the held pieces still moves, so it is laid over the
 * bake each frame on a scratch surface, kept to the held pieces by a baked
 * mask of them alone.
 */

import {
  allocCanvas,
  freshSurfaceContext,
  releaseSurface,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import type { KeyKind } from '../../../core/keys/keyKinds';
import {
  KEY_ART_ASPECT,
  paintKeyFragment,
  paintKeySilhouette,
  warmKeyArt,
  type KeyArtPicture,
} from '../../../sprites/art/keyArt';
import { KEY_INK } from '../../theme/keyInk';
import { paintSoftBand } from '../../../sprites/lightMaps';

/** Room left round the key for its glow, as a share of the key's width either side. */
const GLOW_PAD = 0.12;
/** The shimmer band's width and lean, as shares of the key's width. */
const SHIMMER_WIDTH = 0.12;
const SHIMMER_LEAN = 0.06;
const SHIMMER_ALPHA = 0.4;
const HALF = 0.5;

interface Baked {
  readonly key: string;
  readonly surface: CanvasSurface;
  /** The held pieces alone, the only pixels the shimmer may light. */
  readonly mask: CanvasSurface;
  readonly scratch: CanvasSurface;
  readonly scratchCtx: CanvasRenderingContext2D;
}

export interface BakedSilhouette {
  readonly kind: KeyKind;
  readonly heldMask: readonly boolean[];
  readonly edgeGlow: number;
}

/** The key art a baked silhouette is composed from. */
function silhouettePictures(look: BakedSilhouette): readonly KeyArtPicture[] {
  const count = look.heldMask.length;
  const halo: readonly KeyArtPicture[] =
    look.edgeGlow > 0 ? [{ look: 'halo', held: look.heldMask }] : [];
  return [
    { look: 'socket', count },
    ...halo,
    ...look.heldMask.flatMap((held, index): KeyArtPicture[] =>
      held ? [{ look: 'fragment', index, count, yaws: [0] }] : [],
    ),
  ];
}

/** Every bake not yet disposed, so a lost canvas drops them all to be painted again. */
const liveBakes = new Set<SilhouetteBake>();
onCanvasRecovery(() => {
  for (const bake of liveBakes) bake.release();
});

export class SilhouetteBake {
  private baked: Baked | null = null;

  constructor() {
    liveBakes.add(this);
  }

  /**
   * Draws the silhouette `width` units wide centred on (`cx`, `cy`) from the
   * bake, painting the bake first when the key, its pieces, its size or the
   * canvas scale changed. `shimmer` (0..1) is where the sweep of light is.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    width: number,
    look: BakedSilhouette,
    shimmer: number | undefined,
  ): void {
    const transform = ctx.getTransform();
    const scale = Math.hypot(transform.a, transform.b);
    // Composed from the key art's own bakes, so it is kept only once every one of them is finished: a
    // bake composed from their stand-ins would keep the stand-ins' blur for as long as it is held.
    const piecesReady = warmKeyArt(ctx, width, look.kind, silhouettePictures(look));
    const baked = piecesReady ? this.bakeFor(width, scale, look) : null;
    if (baked === null) {
      paintKeySilhouette(ctx, cx, cy, width, look.kind, look.heldMask, {
        shimmer,
        edgeGlow: look.edgeGlow,
      });
      return;
    }
    const w = width * (1 + GLOW_PAD * 2);
    const h = width * (KEY_ART_ASPECT + GLOW_PAD * 2);
    const left = cx - w * HALF;
    const top = cy - h * HALF;
    if (shimmer === undefined) {
      ctx.drawImage(baked.surface, left, top, w, h);
      return;
    }
    const sctx = baked.scratchCtx;
    const sw = baked.scratch.width;
    const sh = baked.scratch.height;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, sw, sh);
    sctx.drawImage(baked.mask, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    const band = SHIMMER_WIDTH * sw;
    const lean = SHIMMER_LEAN * sw;
    const x = -band + shimmer * (sw + band * 2);
    const tint = KEY_INK[look.kind].glint;
    const angle = Math.atan2(lean * 2, sh);
    // Long enough to cross the whole scratch at its lean, so its ends never show.
    const halfLength = Math.hypot(sw, sh);
    paintSoftBand(sctx, { x, y: sh * HALF }, band, halfLength, angle, tint, SHIMMER_ALPHA);
    ctx.drawImage(baked.surface, left, top, w, h);
    ctx.drawImage(baked.scratch, left, top, w, h);
  }

  private bakeFor(width: number, scale: number, look: BakedSilhouette): Baked | null {
    const devicePx = Math.round(width * scale);
    const key = `${look.kind}|${look.heldMask.join(',')}|${devicePx}|${look.edgeGlow}`;
    if (this.baked?.key === key) return this.baked;
    this.release();
    const w = Math.ceil(devicePx * (1 + GLOW_PAD * 2));
    const h = Math.ceil(devicePx * (KEY_ART_ASPECT + GLOW_PAD * 2));
    if (w <= 0 || h <= 0) return null;
    const surface = allocCanvas('ui', w, h);
    const mask = allocCanvas('ui', w, h);
    const scratch = allocCanvas('ui', w, h);
    let bakeCtx: CanvasRenderingContext2D;
    let maskCtx: CanvasRenderingContext2D;
    let scratchCtx: CanvasRenderingContext2D;
    try {
      bakeCtx = freshSurfaceContext(surface);
      maskCtx = freshSurfaceContext(mask);
      scratchCtx = freshSurfaceContext(scratch);
    } catch {
      for (const made of [surface, mask, scratch]) releaseSurface(made);
      return null;
    }
    paintKeySilhouette(bakeCtx, w * HALF, h * HALF, devicePx, look.kind, look.heldMask, {
      edgeGlow: look.edgeGlow,
    });
    const count = look.heldMask.length;
    look.heldMask.forEach((held, index) => {
      if (held) paintKeyFragment(maskCtx, w * HALF, h * HALF, devicePx, look.kind, index, count);
    });
    this.baked = { key, surface, mask, scratch, scratchCtx };
    return this.baked;
  }

  /** Gives the bake's pixels back; the next draw paints it again. */
  release(): void {
    const baked = this.baked;
    if (baked === null) return;
    this.baked = null;
    releaseSurface(baked.surface);
    releaseSurface(baked.mask);
    releaseSurface(baked.scratch);
  }

  dispose(): void {
    this.release();
    liveBakes.delete(this);
  }
}
