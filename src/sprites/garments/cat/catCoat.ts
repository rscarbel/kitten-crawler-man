/**
 * The cat's coat: the base garment every cat outfit is built on. It paints
 * every piece of fur her anatomy lays out — skull, cheeks, ears, muzzle, body,
 * haunches, legs, paws and tail — in the coat patches the anatomy
 * places on each piece. Everything else she wears is painted after it, piece
 * by piece, so it sits on her fur and under whatever is painted next.
 */

import { paintFur, paintTailCoat } from '../../art/catArt';
import type { CatBodyFrame, CatHeadFrame, CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';

function paintHeadFur(ctx: CanvasRenderingContext2D, frame: CatHeadFrame): void {
  if (frame.piece === 'features' || frame.piece === 'top') return;
  paintFur(ctx, frame.fur);
}

function paintBodyFur(ctx: CanvasRenderingContext2D, frame: CatBodyFrame): void {
  paintFur(ctx, frame.fur);
}

function paintLegFur(ctx: CanvasRenderingContext2D, frame: CatLegFrame): void {
  paintFur(ctx, frame.fur);
}

/** Every view paints her fur the same way: the pieces already carry the view's shapes and patches. */
function everyView<P>(painter: P): Readonly<Record<'front' | 'side' | 'back', P>> {
  return { front: painter, side: painter, back: painter };
}

export const CAT_COAT = defineGarment({
  id: 'cat_coat',
  name: 'Coat',
  wearer: 'cat',
  base: true,
  layer: 'skin',
  region: ['head', 'body', 'foreleg', 'hindleg', 'tail'],
  paint: {
    head: withViewFallback(everyView(paintHeadFur), CAT_VIEW_FALLBACK),
    body: withViewFallback(everyView(paintBodyFur), CAT_VIEW_FALLBACK),
    foreleg: withViewFallback(everyView(paintLegFur), CAT_VIEW_FALLBACK),
    hindleg: withViewFallback(everyView(paintLegFur), CAT_VIEW_FALLBACK),
    tail: withViewFallback(everyView(paintTailCoat), CAT_VIEW_FALLBACK),
  },
});
