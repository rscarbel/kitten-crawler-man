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
  type PartFrame,
  type WornGarmentDef,
} from './garmentDef';
import type { Ramp } from '../art/biped/palette';
import type { BodySide } from '../art/biped/rig';
import type { SleeveCloth } from '../art/biped/sleeve';

export interface Outfit<W extends GarmentWearer> {
  readonly wearer: W;
  /**
   * Every garment that shows, base garments included, innermost layer first
   * and by id within a layer: the order is a function of the key, so the key
   * alone decides the picture.
   */
  readonly garments: readonly GarmentDef<W>[];
  /** A stable name for the look: the ids of the garments that show, sorted. */
  readonly key: string;
  /**
   * What was put on, before the base was added and before any garment hid
   * another: what to dress another wearer of the same kind in, whose base may
   * leave a different set showing.
   */
  readonly worn: readonly WornGarmentDef<W>[];
}

/**
 * What every outfit of one look starts from: the base garments it is always
 * painted in. A look carries these itself, so two looks on the same rig can
 * start from different clothes.
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
 * Whether `cover` leaves `other` off by covering its skin: `other` covers it
 * too, from a layer further in.
 */
function coversOver<W extends GarmentWearer>(cover: GarmentDef<W>, other: GarmentDef<W>): boolean {
  return cover.covers.some(
    (skin) => other.covers.includes(skin) && layerRank(other) < layerRank(cover),
  );
}

/**
 * What a look starting from `base` looks like in `worn`, on top of its base
 * garments. A garment another covers over is left off.
 */
export function outfitOf<W extends GarmentWearer>(
  base: OutfitBase<W>,
  worn: readonly WornGarmentDef<W>[],
): Outfit<W> {
  const all = [...base.baseGarments, ...worn];
  const unique = all.filter(
    (garment, index) => all.findIndex((other) => other.id === garment.id) === index,
  );
  const hiddenGarments = new Set<string>();
  for (const garment of unique) {
    for (const other of unique) {
      if (coversOver(garment, other)) hiddenGarments.add(other.id);
    }
  }
  const showing = unique.filter((garment) => !hiddenGarments.has(garment.id));
  const garments = [...showing].sort(
    (a, b) => layerRank(a) - layerRank(b) || byCodeUnit(a.id, b.id),
  );
  const key = showing
    .map((garment) => garment.id)
    .sort(byCodeUnit)
    .join(KEY_SEPARATOR);
  return { wearer: base.wearer, garments, key, worn };
}

/** The sleeves the outermost garment of `outfit` that has any brings, or null to keep the look's own. */
export function sleevesOf<W extends GarmentWearer>(outfit: Outfit<W>): SleeveCloth | null {
  const sleeved = outfit.garments.filter((garment) => garment.sleeves !== null);
  if (sleeved.length === 0) return null;
  return sleeved[sleeved.length - 1].sleeves;
}

/**
 * The ramp the outermost glove of `outfit` on his `side` hand paints it in,
 * or null for a bare hand.
 */
export function gloveOf<W extends GarmentWearer>(outfit: Outfit<W>, side: BodySide): Ramp | null {
  let glove: Ramp | null = null;
  for (const garment of outfit.garments) glove = garment.gloves?.[side] ?? glove;
  return glove;
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
