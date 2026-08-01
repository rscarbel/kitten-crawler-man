/**
 * One "X reached level N" announcement, queued for the LevelUpDialog.
 *
 * Deliberately free of any ability or skill type: the overlay counts a number up
 * and shows a perk line, which is the same ceremony whichever system leveled.
 * Callers resolve their own definition into this shape at enqueue time.
 */
export interface LevelUpEntry {
  /** Display name of the thing that leveled, e.g. "Magic Missile". */
  name: string;
  newLevel: number;
  /** What the new level unlocked, or null when the tier grants no new perk. */
  perkDescription: string | null;
  renderIcon: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    level: number,
  ) => void;
}
