/** The colours one skill's emblem is painted in. */
export interface EmblemPalette {
  /** Centre of the backdrop disc. */
  readonly glow: string;
  /** Outer edge of the backdrop disc. */
  readonly field: string;
  /** Ring drawn around the disc. */
  readonly rim: string;
  /** The silhouette itself. */
  readonly mark: string;
  /** Highlights picked out on the silhouette. */
  readonly accent: string;
}

/** Paints one skill's silhouette centred on (`cx`, `cy`) in an icon square `size` across. */
export type EmblemRenderer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  palette: EmblemPalette,
) => void;

export const TWO_PI = Math.PI * 2;

/** Left and right, for the parts of an emblem that come in mirrored pairs. */
export const MIRROR_SIDES = [-1, 1] as const;
