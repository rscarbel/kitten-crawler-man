/**
 * An outfit: the garments one crawler is painted in, resolved once when its
 * equipment changes. Its key names the painted figure, so two outfits that
 * look the same share one figure and a change of gear that shows nothing
 * costs nothing.
 */

import {
  GARMENT_LAYERS,
  type GarmentWearer,
  type GarmentDef,
  type GarmentFrameContext,
  type GarmentPart,
  type HideableFeature,
  type PartFrame,
} from './garmentDef';
import { baseGarmentsOf } from './garments';

export interface Outfit<W extends GarmentWearer> {
  readonly wearer: W;
  /**
   * Every garment that shows, base garments included, innermost layer first
   * and by id within a layer: the order is a function of the key, so the key
   * alone decides the picture.
   */
  readonly garments: readonly GarmentDef<W>[];
  /** Features of the wearer some garment hides. */
  readonly hidden: ReadonlySet<HideableFeature<W>>;
  /** A stable name for the look: the ids of the garments that show, sorted. */
  readonly key: string;
}

const KEY_SEPARATOR = '+';

function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function layerRank<W extends GarmentWearer>(garment: GarmentDef<W>): number {
  return GARMENT_LAYERS.indexOf(garment.layer);
}

/**
 * What a crawler of kind `wearer` looks like in `worn`, on top of the base
 * garments every outfit of theirs starts from. A garment another worn garment
 * hides is left off.
 */
export function outfitOf<W extends GarmentWearer>(
  wearer: W,
  worn: readonly GarmentDef<W>[],
): Outfit<W> {
  const all = [...baseGarmentsOf(wearer), ...worn.filter((garment) => !garment.base)];
  const unique = all.filter(
    (garment, index) => all.findIndex((other) => other.id === garment.id) === index,
  );
  const hiddenGarments = new Set<string>();
  for (const garment of unique) {
    for (const rule of garment.hides) {
      if (rule.kind === 'garment') hiddenGarments.add(rule.garment);
    }
  }
  const showing = unique.filter((garment) => !hiddenGarments.has(garment.id));
  const hidden = new Set<HideableFeature<W>>();
  for (const garment of showing) {
    for (const rule of garment.hides) {
      if (rule.kind === 'feature') hidden.add(rule.feature);
    }
  }
  const garments = [...showing].sort(
    (a, b) => layerRank(a) - layerRank(b) || byCodeUnit(a.id, b.id),
  );
  const key = showing
    .map((garment) => garment.id)
    .sort(byCodeUnit)
    .join(KEY_SEPARATOR);
  return { wearer, garments, hidden, key };
}

/** Whether two outfits paint the same figure. */
export function sameOutfit<W extends GarmentWearer>(a: Outfit<W>, b: Outfit<W>): boolean {
  return a.key === b.key;
}

/** Paints every garment of `outfit` that covers `part` onto one of its pieces, innermost first. */
export function paintOutfitPart<W extends GarmentWearer, P extends GarmentPart<W>>(
  ctx: CanvasRenderingContext2D,
  outfit: Outfit<W>,
  part: P,
  frame: PartFrame<W, P>,
  context: GarmentFrameContext<W>,
): void {
  for (const garment of outfit.garments) {
    const painters = garment.paint[part];
    if (painters === undefined) continue;
    ctx.save();
    painters[context.view](ctx, frame, context);
    ctx.restore();
  }
}
