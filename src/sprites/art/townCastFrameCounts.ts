/**
 * Frame counts baked per row for the town cast figure. They are low for a
 * figure on Carl's rig because every look in the closed set pays Carl's
 * per-cell cost (rig, cell and outline), and all of them share one figure
 * cache budget. Carl's own idle/talk pose functions carry
 * more going on per frame (breath, blink, a hand drift, a head turn) than
 * the person painter's plain settle did, so fewer samples still read as
 * more motion.
 *
 * Kept in their own module, separate from `townCastFigure.ts`, so that
 * `personCellBounds.ts` can import them without a cycle back through
 * `townCastFigure.ts`'s own import of `personCellGeometry`.
 */
export const WALK_FRAMES = 10;
export const IDLE_FRAMES = 4;
export const TALK_FRAMES = 6;
export const WORK_FRAMES = 0;
