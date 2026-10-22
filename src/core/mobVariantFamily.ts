import type { VarietyTier } from './varietyTier';

/**
 * The looks one mob kind can wear, as data: which exist, how a spawn picks
 * one, and the one every spawn wears once the variety tier reaches
 * {@link sharedFromTier}.
 *
 * A look never changes how the mob fights beyond what the look itself names
 * (a goblin's weapon brings its own swing timing), so sharing a look keeps
 * every fight the same and only cuts the figures the cache has to hold.
 */
export interface MobVariantFamily<V> {
  readonly variants: readonly [V, ...V[]];
  /** One spawn's look while looks are not shared. */
  pick(random: () => number): V;
  /** The look every spawn wears from {@link sharedFromTier} on. */
  readonly canonical: V;
  readonly sharedFromTier: VarietyTier;
}

/** A variant and how often it turns up relative to its siblings. */
interface WeightedVariant<V> {
  readonly variant: V;
  readonly weight: number;
}

/** A family whose looks turn up in proportion to their weights. */
export function weightedVariantFamily<V>(
  weighted: readonly [WeightedVariant<V>, ...WeightedVariant<V>[]],
  canonical: V,
  sharedFromTier: VarietyTier,
): MobVariantFamily<V> {
  const [first, ...rest] = weighted;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const last = weighted[weighted.length - 1] ?? first;
  return {
    variants: [first.variant, ...rest.map((entry) => entry.variant)],
    canonical,
    sharedFromTier,
    pick(random) {
      let roll = random() * total;
      for (const entry of weighted) {
        roll -= entry.weight;
        if (roll <= 0) return entry.variant;
      }
      return last.variant;
    },
  };
}

/** A family whose looks are equally likely. */
export function uniformVariantFamily<V>(
  variants: readonly [V, ...V[]],
  canonical: V,
  sharedFromTier: VarietyTier,
): MobVariantFamily<V> {
  return {
    variants,
    canonical,
    sharedFromTier,
    pick(random) {
      const index = Math.min(variants.length - 1, Math.floor(random() * variants.length));
      return variants[index] ?? canonical;
    },
  };
}

/** Whether every spawn of `family` wears its canonical look at `tier`. */
export function isLookShared<V>(family: MobVariantFamily<V>, tier: VarietyTier): boolean {
  return tier >= family.sharedFromTier;
}

/** The look one spawn of `family` wears at `tier`. */
export function resolveVariant<V>(
  family: MobVariantFamily<V>,
  tier: VarietyTier,
  random: () => number,
): V {
  // The draw happens even when the look is shared, so a seeded stream advances
  // the same way at every tier and only the ladder changes what a seed brings.
  const picked = family.pick(random);
  return isLookShared(family, tier) ? family.canonical : picked;
}

/** Every look a spawn of `family` can wear at `tier`: what a warm-up must cover. */
export function variantsInPlay<V>(family: MobVariantFamily<V>, tier: VarietyTier): readonly V[] {
  return isLookShared(family, tier) ? [family.canonical] : family.variants;
}
