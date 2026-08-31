/**
 * The two seam budgets every generated ground sheet is held to, wherever it is
 * generated. Shared by the review baker and by the seed sweep so a limit can
 * never be relaxed in one place and not the other.
 */

/**
 * A mask joint must never be a harder line than the masks' own interiors. Written
 * as `!(ratio <= limit)` at every call site so a NaN ratio — an all-flat mask set,
 * which would divide by a zero interior — fails rather than slipping through.
 */
export const MASK_SEAM_RATIO_LIMIT = 1;

/**
 * Largest acceptable ratio of joint difference to the patch's own strongest
 * internal edges. At 1.0 the joint is indistinguishable from the rest of the
 * patch; a little slack absorbs sampling noise without letting a seam through.
 */
export const SEAMLESS_RATIO_LIMIT = 1.15;
