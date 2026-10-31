/**
 * The intro's glowing key silhouettes, painted once and blitted at a fading
 * opacity: the key's edge catching gold as the title lands, and each socket
 * lit as it is counted.
 *
 * The silhouette's glow is a canvas shadow blur, which costs a blur pass per
 * piece every frame it is drawn live; the intro holds each glow for a second
 * or more, so it paints each picture at full strength once and fades the copy.
 */

import type { KeyKind } from '../../../core/keys/keyKinds';
import {
  allocCanvas,
  freshSurfaceContext,
  releaseSurface,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import {
  KEY_ART_ASPECT,
  paintKeySilhouette,
  warmKeyArt,
  type KeyArtPicture,
} from '../../../sprites/art/keyArt';

/** Room round the key for its glow to spread into, as a share of the key's width. */
const GLOW_PAD = 0.15;
const HALF = 0.5;

/** Which glowing picture of the key: its whole edge, or one socket lit. */
export type KeyGlowPicture =
  | { readonly kind: 'edge' }
  | { readonly kind: 'socket'; readonly index: number; readonly litPieces: number };

function pictureKey(kind: KeyKind, sockets: number, size: number, picture: KeyGlowPicture): string {
  switch (picture.kind) {
    case 'edge':
      return `${kind}/${sockets}/${size}/edge`;
    case 'socket':
      return `${kind}/${sockets}/${size}/socket${picture.index}/${picture.litPieces}`;
    default: {
      const unhandled: never = picture;
      return unhandled;
    }
  }
}

function heldMaskFor(sockets: number, picture: KeyGlowPicture): readonly boolean[] {
  switch (picture.kind) {
    case 'edge':
      return Array.from({ length: sockets }, () => true);
    case 'socket':
      return Array.from({ length: sockets }, (_, index) => index === picture.index);
    default: {
      const unhandled: never = picture;
      return unhandled;
    }
  }
}

function litPiecesOf(picture: KeyGlowPicture): number {
  switch (picture.kind) {
    case 'edge':
      return 0;
    case 'socket':
      return picture.litPieces;
    default: {
      const unhandled: never = picture;
      return unhandled;
    }
  }
}

/** The key art a glow picture is painted from, which must be finished before the picture is kept. */
function artOf(sockets: number, picture: KeyGlowPicture): readonly KeyArtPicture[] {
  const held = heldMaskFor(sockets, picture);
  return [
    { look: 'socket', count: sockets },
    { look: 'halo', held },
    ...held.flatMap((isHeld, index): KeyArtPicture[] =>
      isHeld ? [{ look: 'fragment', index, count: sockets, yaws: [0] }] : [],
    ),
  ];
}

/** Every glow set holding pixels, so a lost canvas drops them all to be painted again. */
const holdingPixels = new Set<IntroKeyGlows>();
onCanvasRecovery(() => {
  for (const glows of holdingPixels) glows.release();
});

export class IntroKeyGlows {
  private readonly cache = new Map<string, CanvasSurface>();

  /**
   * Draws `picture` of a `sockets`-piece key `size` units wide, centred on
   * (`cx`, `cy`), at `alpha`. The edge picture includes the key's own body in
   * glow colour, so the caller draws the plain silhouette over it after.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    kind: KeyKind,
    sockets: number,
    size: number,
    cx: number,
    cy: number,
    picture: KeyGlowPicture,
    alpha: number,
  ): void {
    if (alpha <= 0) return;
    const transform = ctx.getTransform();
    const scale = Math.hypot(transform.a, transform.b);
    const pixelSize = Math.round(size * scale);
    const id = pictureKey(kind, sockets, pixelSize, picture);
    // Painted from the key art's own bakes, so it is kept only once they are finished: a copy of
    // their stand-ins would keep the stand-ins' blur for as long as it is held.
    const artReady = warmKeyArt(ctx, size, kind, artOf(sockets, picture));
    const glow =
      this.cache.get(id) ?? (artReady ? this.paint(id, kind, sockets, size, scale, picture) : null);
    ctx.save();
    try {
      ctx.globalAlpha *= alpha;
      if (glow === null) {
        paintKeySilhouette(ctx, cx, cy, size, kind, heldMaskFor(sockets, picture), {
          edgeGlow: 1,
          litPieces: litPiecesOf(picture),
        });
        return;
      }
      const pad = size * GLOW_PAD;
      const w = size + pad * 2;
      const h = size * KEY_ART_ASPECT + pad * 2;
      ctx.drawImage(glow, cx - w * HALF, cy - h * HALF, w, h);
    } finally {
      ctx.restore();
    }
  }

  /** Gives every cached picture's pixels back. */
  release(): void {
    for (const surface of this.cache.values()) releaseSurface(surface);
    this.cache.clear();
    holdingPixels.delete(this);
  }

  private paint(
    id: string,
    kind: KeyKind,
    sockets: number,
    size: number,
    scale: number,
    picture: KeyGlowPicture,
  ): CanvasSurface | null {
    const pad = size * GLOW_PAD;
    const w = size + pad * 2;
    const h = size * KEY_ART_ASPECT + pad * 2;
    const surface = allocCanvas('ui', Math.ceil(w * scale), Math.ceil(h * scale));
    let ctx: CanvasRenderingContext2D;
    try {
      ctx = freshSurfaceContext(surface);
    } catch {
      return null;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintKeySilhouette(ctx, w * HALF, h * HALF, size, kind, heldMaskFor(sockets, picture), {
      edgeGlow: 1,
      litPieces: litPiecesOf(picture),
    });
    this.cache.set(id, surface);
    holdingPixels.add(this);
    return surface;
  }
}
