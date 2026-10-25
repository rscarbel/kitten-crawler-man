/**
 * An outfit: the garments one crawler is painted in, resolved once when its
 * equipment changes. Its key names the painted figure, so two outfits that
 * look the same share one figure and a change of gear that shows nothing
 * costs nothing.
 */

import {
  GARMENT_LAYERS,
  type BaseGarmentDef,
  type GarmentWearer,
  type GarmentDef,
  type GarmentFrameContext,
  type GarmentPart,
  type HideableFeature,
  type PartFrame,
  type WornGarmentDef,
} from './garmentDef';

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
  /**
   * What was put on, before the base was added, before any garment hid
   * another and before the base turned away any that need skin it covers:
   * what to dress another wearer of the same kind in, whose base may leave a
   * different set showing.
   */
  readonly worn: readonly WornGarmentDef<W>[];
}

/**
 * What every outfit of one look starts from: the base garments it is always
 * painted in, whose `covers` decide what bare skin is already covered. A look carries these itself, so
 * two looks on the same rig can start from different clothes.
 */
export interface OutfitBase<W extends GarmentWearer> {
  readonly wearer: W;
  readonly baseGarments: readonly BaseGarmentDef<W>[];
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
 * Whether a garment can go on over `base`'s own clothes: one needing bare skin
 * a base garment covers (`GarmentSpec.covers`) never shows.
 */
export function fitsOver<W extends GarmentWearer>(
  base: OutfitBase<W>,
  garment: GarmentDef<W>,
): boolean {
  const needs = garment.needsBare;
  return needs === null || !base.baseGarments.some((worn) => worn.covers.includes(needs));
}

/**
 * Whether `cover` leaves `other` off by covering its skin: `other` needs bare
 * what `cover` covers, or covers it too from a layer further in.
 */
function coversOver<W extends GarmentWearer>(cover: GarmentDef<W>, other: GarmentDef<W>): boolean {
  return cover.covers.some(
    (skin) =>
      other.needsBare === skin ||
      (other.covers.includes(skin) && layerRank(other) < layerRank(cover)),
  );
}

/**
 * What a look starting from `base` looks like in `worn`, on top of its base
 * garments. A garment another worn garment hides, or one needing bare skin the
 * base garments cover, is left off.
 */
export function outfitOf<W extends GarmentWearer>(
  base: OutfitBase<W>,
  worn: readonly WornGarmentDef<W>[],
): Outfit<W> {
  const overBase = worn.filter((garment) => fitsOver(base, garment));
  const all = [...base.baseGarments, ...overBase];
  const unique = all.filter(
    (garment, index) => all.findIndex((other) => other.id === garment.id) === index,
  );
  const hiddenGarments = new Set<string>();
  for (const garment of unique) {
    for (const rule of garment.hides) {
      if (rule.kind === 'garment') hiddenGarments.add(rule.garment);
    }
    for (const other of unique) {
      if (coversOver(garment, other)) hiddenGarments.add(other.id);
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
  return { wearer: base.wearer, garments, hidden, key, worn };
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
