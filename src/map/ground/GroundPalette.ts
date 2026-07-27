/**
 * One generated ground sheet, plus every rule the six-pass renderer needs to
 * draw it: which material a tile type stands on, which material wins where two
 * meet, what a material spills onto its neighbours, and which of them get kerbs.
 *
 * `src/map/tiles/groundTiles.ts` is written against this interface rather than
 * against the overworld's materials, so pointing a new floor at the same
 * renderer is a palette and nothing else. There are two instances today:
 * `OVERWORLD_GROUND` (`src/map/town/groundMaterials.ts`) and `DUNGEON_GROUND`
 * (`src/map/dungeon/groundMaterials.ts`).
 *
 * The records are keyed by plain `string` rather than by each palette's own
 * material union. A `Record<'grass' | 'verge', number>` is not assignable to a
 * `Record<string, number>` parameter, so a generic `GroundPalette<M>` cannot be
 * consumed by a renderer that takes any palette — and the renderer taking *any*
 * palette is the whole point. Exhaustiveness is kept where it is actually
 * checkable: each palette declares its own records with
 * `satisfies Record<ItsOwnMaterial, ...>`, so a material added to a sheet without
 * a blend order is still a compile error at the declaration site.
 */

import type { SpriteKey } from '../../core/SpriteLoader';

/** How a material's loose material spills onto a harder neighbour. */
export interface GroundSpill {
  readonly kind: 'blades' | 'grit';
  readonly color: string;
}

export interface GroundPalette {
  /** Manifest key of the generated sheet, one material per row. */
  readonly sheetKey: SpriteKey;
  /**
   * Which material wins where two meet: the higher order bleeds over the lower
   * through the corner masks. Also the sheet's row order by convention — the
   * generator lays materials out softest-first.
   */
  readonly blendOrder: Readonly<Record<string, number>>;
  /** Drawn when the sheet has not loaded yet: each material's own mean. */
  readonly fallbackColor: Readonly<Record<string, string>>;
  /** What each material scatters onto a harder neighbour, or null for none. */
  readonly spill: Readonly<Record<string, GroundSpill | null>>;
  /** Materials that get a raised stone lip where they meet soft ground. */
  readonly kerbedMaterials: ReadonlySet<string>;
  /** The soft materials a kerb is laid against. */
  readonly kerbSoftMaterials: ReadonlySet<string>;
  /**
   * What a position with no material at all counts as inside the fringe.
   *
   * The fringe needs *a* material at every corner — see `drawFringe` — and the
   * stand-in has to be the same for both cells sharing that corner, so it is a
   * property of the palette rather than something invented per tile.
   */
  readonly fringeStandIn: string;
  /** The material a tile type stands on, or undefined when it is not this palette's ground. */
  materialForTileType(type: number): string | undefined;
}
